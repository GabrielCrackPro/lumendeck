
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    let result = app.notification().builder().title(title).body(body).show();
    match result {
        Ok(()) => log::info!("notification shown: {title}"),
        Err(e) => log::warn!("notification could not be shown: {e}"),
    }
}

pub fn focus_main(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::AppHandle;

    #[test]
    fn focus_main_accepts_any_runtime() {
        fn accepts<R: tauri::Runtime>(_f: fn(&AppHandle<R>)) {}
        accepts::<tauri::Wry>(super::focus_main);
    }
}