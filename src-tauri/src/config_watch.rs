
use crate::config_store::{self, ConfigReload};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

static WATCHER: Mutex<Option<RecommendedWatcher>> = Mutex::new(None);

const DEBOUNCE: Duration = Duration::from_millis(300);
const PARSE_RETRY: Duration = Duration::from_millis(400);
const PARSE_RETRIES: u32 = 5;
const RESTART_DELAY: Duration = Duration::from_secs(2);

pub fn spawn() {
    std::thread::Builder::new()
        .name("config-watch".into())
        .spawn(|| loop {
            match watch_loop() {
                Ok(()) => return,
                Err(e) => {
                    log::warn!("config watcher stopped ({e}); restarting in 2s");
                    std::thread::sleep(RESTART_DELAY);
                }
            }
        })
        .expect("failed to spawn config watcher thread");
}

fn watch_loop() -> Result<(), String> {
    let path = config_store::config_path();
    let dir = path
        .parent()
        .ok_or_else(|| "config path has no parent".to_string())?
        .to_path_buf();
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "invalid config file name".to_string())?
        .to_string();

    std::fs::create_dir_all(&dir).map_err(|e| format!("create config dir: {e}"))?;

    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, notify::Config::default())
        .map_err(|e| format!("create watcher: {e}"))?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| format!("watch {}: {e}", dir.display()))?;
    *WATCHER
        .lock()
        .map_err(|_| "watcher mutex poisoned".to_string())? = Some(watcher);
    log::info!("watching {} for config changes", dir.display());

    loop {
        let mut touched = recv_touch(&rx, &file_name)?;

        let deadline = Instant::now() + DEBOUNCE;
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
            loop {
                match rx.try_recv() {
                    Ok(ev) => touched |= touches(&ev, &file_name),
                    Err(std::sync::mpsc::TryRecvError::Empty) => break,
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        return Err("watch channel disconnected".into());
                    }
                }
            }
        }
        if !touched {
            continue;
        }

        let mut outcome = config_store::reload_if_changed();
        for _ in 0..PARSE_RETRIES {
            match outcome {
                ConfigReload::Unchanged | ConfigReload::Reloaded => break,
                ConfigReload::Pending(_) => {
                    std::thread::sleep(PARSE_RETRY);
                    outcome = config_store::reload_if_changed();
                }
            }
        }
    }
}

fn recv_touch(
    rx: &std::sync::mpsc::Receiver<notify::Result<Event>>,
    file_name: &str,
) -> Result<bool, String> {
    match rx.recv() {
        Ok(ev) => Ok(touches(&ev, file_name)),
        Err(_) => Err("watch channel disconnected".into()),
    }
}

fn touches(ev: &notify::Result<Event>, file_name: &str) -> bool {
    match ev {
        Ok(ev) => ev
            .paths
            .iter()
            .any(|p: &PathBuf| p.file_name().and_then(|n| n.to_str()) == Some(file_name)),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::TryRecvError;

    fn tmp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lumendeck-watch-test-{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn wait_for_touch(
        rx: &std::sync::mpsc::Receiver<notify::Result<Event>>,
        file_name: &str,
        limit: Duration,
    ) -> bool {
        let deadline = Instant::now() + limit;
        let mut touched = false;
        while Instant::now() < deadline {
            match rx.try_recv() {
                Ok(ev) => touched |= touches(&ev, file_name),
                Err(TryRecvError::Empty) => std::thread::sleep(Duration::from_millis(25)),
                Err(TryRecvError::Disconnected) => panic!("watch channel disconnected"),
            }
        }
        touched
    }

    #[test]
    fn watcher_sees_config_writes_and_filters_other_files() {
        let dir = tmp_dir("basic");
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
        let mut watcher = RecommendedWatcher::new(tx, notify::Config::default()).unwrap();
        watcher.watch(&dir, RecursiveMode::NonRecursive).unwrap();

        std::fs::write(dir.join("unrelated.txt"), b"hi").unwrap();
        assert!(
            !wait_for_touch(&rx, "config.json", Duration::from_secs(2)),
            "unrelated file must not trigger a config touch"
        );

        std::fs::write(dir.join("config.json"), b"{ }").unwrap();
        assert!(
            wait_for_touch(&rx, "config.json", Duration::from_secs(5)),
            "write to config.json must produce a touch event"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}
