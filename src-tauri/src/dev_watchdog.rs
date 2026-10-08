
#![cfg(debug_assertions)]

use std::time::Duration;

fn dev_server_port(app: &tauri::AppHandle) -> Option<u16> {
    let dev_url = app.config().build.dev_url.as_ref()?;
    let s = serde_json::to_value(dev_url).ok()?.as_str()?.to_string();
    let after = s.rsplit(':').next()?;
    let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

pub fn spawn(app: tauri::AppHandle) {
    std::thread::Builder::new()
        .name("dev-watchdog".into())
        .spawn(move || {
            let mut was_up: Option<bool> = None;
            loop {
                std::thread::sleep(Duration::from_secs(2));
                let Some(port) = dev_server_port(&app) else {
                    return;
                };
                let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
                let up = std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(500))
                    .is_ok();
                if was_up == Some(false) && up {
                    log::info!("[dev-watchdog] dev server recovered; reloading webviews");
                    let inner = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        use tauri::Manager;
                        for (_label, w) in inner.webview_windows() {
                            let _ = w.eval("window.location.reload()");
                        }
                    });
                }
                was_up = Some(up);
            }
        })
        .ok();
}
