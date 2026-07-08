mod db_manager;
mod sidecar;

use std::sync::Mutex;

use tauri::Manager;

/// Process-wide state we must tear down on exit: the embedded Postgres handle
/// and the api.exe sidecar child. Held in Tauri state so the exit hook can
/// stop them in the right order (sidecar first, then Postgres).
struct AppProcs {
    db: Mutex<Option<db_manager::DbHandle>>,
    sidecar: Mutex<Option<sidecar::Sidecar>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppProcs {
            db: Mutex::new(None),
            sidecar: Mutex::new(None),
        })
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(if cfg!(debug_assertions) {
                        log::LevelFilter::Info
                    } else {
                        log::LevelFilter::Warn
                    })
                    .build(),
            )?;

            // Resource dir holds the bundled pgsql/ and api sidecar in release.
            let resource_dir = app.path().resource_dir().ok();

            // 1. Bring up embedded Postgres (initdb on first run, WAL-recover
            //    on a prior power loss, health-gated).
            let db = match db_manager::start(resource_dir.as_deref()) {
                Ok(handle) => handle,
                Err(e) => {
                    log::error!("embedded Postgres failed to start: {e:#}");
                    return Err(format!("database start failed: {e}").into());
                }
            };
            log::info!("embedded Postgres up (fresh={})", db.fresh);

            // 2. Spawn the api.exe sidecar, handing it DATABASE_URL over the
            //    stdin handshake, and health-gate on /health. When the sidecar
            //    binary is not present (pre-Task-2 / pure web-dev), this is a
            //    no-op and the app falls back to the configured VITE_API_URL.
            let sidecar = sidecar::spawn(app.handle(), resource_dir.as_deref(), &db);

            let procs = app.state::<AppProcs>();
            *procs.db.lock().unwrap() = Some(db);
            *procs.sidecar.lock().unwrap() = sidecar;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let procs = window.state::<AppProcs>();
                // Stop the sidecar first so no new writes hit Postgres, then
                // stop Postgres cleanly (fast checkpoint → no WAL replay next
                // launch).
                if let Some(mut sc) = procs.sidecar.lock().unwrap().take() {
                    sc.stop();
                }
                if let Some(db) = procs.db.lock().unwrap().take() {
                    if let Err(e) = db_manager::stop(&db) {
                        log::warn!("error stopping Postgres: {e:#}");
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
