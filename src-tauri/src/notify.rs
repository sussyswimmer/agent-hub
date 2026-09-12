//! macOS notifications through tauri-plugin-notification. Failures are logged, never fatal.
//! Quiet hours, per-type toggles and click routing arrive in Phase 4.

use tauri_plugin_notification::NotificationExt;

pub fn send(app: &tauri::AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        tracing::warn!("notification failed: {e}");
    }
}
