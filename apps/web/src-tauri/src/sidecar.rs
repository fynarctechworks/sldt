//! api.exe sidecar lifecycle.
//!
//! Spawns the packaged Node API (Task 2 produces api.exe) as a child process,
//! hands it the embedded-Postgres DATABASE_URL and the offline secrets over a
//! ONE-LINE JSON stdin handshake (never argv/env — those leak via the process
//! table), then health-gates on GET /health.
//!
//! Secrets over stdin, not argv: on Windows any process can read another's
//! command line, and inheritable env vars propagate to grandchildren
//! (Chromium). stdin is private to the child.
//!
//! When api.exe is not bundled (pure web-dev, or before Task 2 lands), spawn()
//! returns None and the web app keeps talking to VITE_API_URL as it does today.

use std::io::Write;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;

use crate::db_manager::DbHandle;

/// Port the sidecar API listens on (loopback). Distinct from the dev API's
/// 3001 so a running `npm run dev:api` doesn't collide during development.
pub const API_PORT: u16 = 3010;

pub struct Sidecar {
    child: Child,
}

impl Sidecar {
    /// Stop the sidecar AND its process tree. `child.kill()` alone maps to
    /// TerminateProcess on Windows, which does NOT kill grandchildren — the
    /// Chromium instances Puppeteer spawns for PDF rendering would be orphaned
    /// and pile up across a shift (memory exhaustion). So on Windows we
    /// `taskkill /T` the whole tree; elsewhere `kill()` + reap is fine.
    pub fn stop(&mut self) {
        #[cfg(windows)]
        {
            let pid = self.child.id();
            // /T = terminate the process and its child tree, /F = force.
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            // Fall back to a direct kill in case taskkill is unavailable.
            let _ = self.child.kill();
        }
        #[cfg(not(windows))]
        {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
    }
}

/// The stdin handshake payload. Extended in later tasks with LOCAL_JWT_SECRET
/// and ENCRYPTION_KEY (Task 3); DATABASE_URL and the schema-build flag are all
/// Task 1 needs.
#[derive(Serialize)]
struct Handshake<'a> {
    database_url: &'a str,
    /// When true, the sidecar must build the schema from scratch (drizzle
    /// push + migrate) before serving. When false, it applies only pending
    /// migrations. Derived from whether Postgres was freshly initialized.
    schema_bootstrap: bool,
    port: u16,
}

/// Locate api.exe. Release: bundled resource. Dev/CI: overridable via
/// SLDT_API_EXE. Returns None if not found (web-dev fallback).
fn resolve_api_exe(resource_dir: Option<&Path>) -> Option<std::path::PathBuf> {
    if let Some(p) = std::env::var_os("SLDT_API_EXE") {
        let p = std::path::PathBuf::from(p);
        if p.exists() {
            return Some(p);
        }
    }
    let name = if cfg!(windows) { "api.exe" } else { "api" };
    if let Some(res) = resource_dir {
        let bundled = res.join("api").join(name);
        if bundled.exists() {
            return Some(bundled);
        }
    }
    None
}

pub fn spawn(_app: &AppHandle, resource_dir: Option<&Path>, db: &DbHandle) -> Option<Sidecar> {
    let exe = match resolve_api_exe(resource_dir) {
        Some(p) => p,
        None => {
            log::warn!(
                "api sidecar not bundled — web app will use its configured API URL. \
                 (Expected until Task 2 packages api.exe.)"
            );
            return None;
        }
    };

    let handshake = Handshake {
        database_url: &db.database_url,
        schema_bootstrap: db.fresh,
        port: API_PORT,
    };
    let payload = match serde_json::to_string(&handshake) {
        Ok(s) => s,
        Err(e) => {
            log::error!("failed to serialize sidecar handshake: {e}");
            return None;
        }
    };

    let mut child = match Command::new(&exe)
        .env("SLDT_HANDSHAKE_STDIN", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            log::error!("failed to spawn api sidecar {}: {e}", exe.display());
            return None;
        }
    };

    // Write the handshake line and drop stdin so the child's reader unblocks.
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = writeln!(stdin, "{payload}") {
            log::error!("failed to write sidecar handshake: {e}");
            let _ = child.kill();
            return None;
        }
    }

    let sidecar = Sidecar { child };

    // Health-gate: block until /health responds or we give up. The web layer
    // shows a splash until this returns (wired via the frontend in Task 4).
    if !wait_health(Duration::from_secs(60)) {
        log::error!("api sidecar did not become healthy in time");
        // Return it anyway so the exit hook still reaps it; the UI surfaces
        // the unhealthy state.
    }

    Some(sidecar)
}

fn wait_health(timeout: Duration) -> bool {
    let url = format!("http://127.0.0.1:{API_PORT}/health");
    let deadline = Instant::now() + timeout;
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    loop {
        if let Ok(resp) = client.get(&url).send() {
            if resp.status().is_success() {
                return true;
            }
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}
