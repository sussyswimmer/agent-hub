//! Sidebar vibrancy (CLAUDE.md §9.1). macOS only; a no-op elsewhere.

#[cfg(target_os = "macos")]
pub fn apply(window: &tauri::WebviewWindow) {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
    if let Err(e) = apply_vibrancy(window, NSVisualEffectMaterial::Sidebar, Some(NSVisualEffectState::FollowsWindowActiveState), None) {
        tracing::warn!("vibrancy unavailable: {e}");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn apply(_window: &tauri::WebviewWindow) {}
