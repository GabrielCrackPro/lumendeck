//! Desktop notifications, via the official notification plugin.
//!
//! This replaces a 490-line hand-written Win32 module, and the reason it was so
//! long is worth recording. LumenDeck wanted a tray balloon at startup. Tauri
//! exposed no balloon API, so the old code drove `Shell_NotifyIcon` directly.
//! A balloon has to belong to a *registered* tray icon — but the app's real
//! icon is owned by Tauri, whose internal id is not addressable from outside.
//! So each balloon had to mint a throwaway icon of its own, add it in the
//! `NIS_HIDDEN` state (hidden icons take no slot in the notification area but
//! their balloons still appear), build a hidden window, run a message-pump
//! thread, pick the right frame out of the embedded .ico, and tear all four
//! down afterwards.
//!
//! `tauri-plugin-notification` goes through WinRT toasts instead, which need no
//! tray icon at all. Same visible result, no icon surgery.
//!
//! Two behaviours differ from the old balloon, and both are worth knowing:
//!
//! - A WinRT toast is identified by an AppUserModelID, which Windows shows
//!   reliably only when a Start Menu shortcut carries the same ID. An installed
//!   build has one. From `cargo run` in a build directory the toast may not
//!   appear, and there is no way to detect that from here.
//! - The plugin exposes no desktop activation callback, so a click no longer
//!   runs a Rust closure. The OS still activates the app, but focus handling is
//!   the OS's business now rather than ours. See [focus_main] for what we do
//!   instead.

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// Show a notification, if the platform will take it.
///
/// Errors are logged rather than propagated. Every caller is startup or tray
/// code where a notification is a courtesy, and there is nowhere useful for an
/// `Err` to go — failing a boot over a toast would be absurd.
pub fn notify(app: &AppHandle, title: &str, body: &str) {
    let result = app.notification().builder().title(title).body(body).show();
    match result {
        Ok(()) => log::info!("notification shown: {title}"),
        Err(e) => log::warn!("notification could not be shown: {e}"),
    }
}

/// Bring the dashboard forward.
///
/// The old balloon ran this from its message pump when clicked. The plugin has
/// no equivalent callback on desktop, so this is for callers that already know
/// the user is in the app — a tray menu item, say — and not for notification
/// clicks.
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

    /// `focus_main` has to survive being called before the dashboard window
    /// exists: the tray comes up first, and an autostart launch can reach this
    /// with no windows at all.
    ///
    /// This is a compile-time assertion that the signature is generic over
    /// `Runtime` and takes `&AppHandle`, which is what lets it be called from
    /// both `run()` and a command.
    #[test]
    fn focus_main_accepts_any_runtime() {
        fn accepts<R: tauri::Runtime>(_f: fn(&AppHandle<R>)) {}
        accepts::<tauri::Wry>(super::focus_main);
    }
}