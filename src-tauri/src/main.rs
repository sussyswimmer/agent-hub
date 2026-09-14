#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;

/// One binary, two jobs.
///
/// Run plainly, this is Grimoire. Run as `grimoire seal-hook`, it is the tiny process the engine
/// spawns before every tool call (§6.4, DECISIONS.md 0004) — it reads the pending call on stdin,
/// asks the application over a local socket, and prints the engine's answer.
///
/// One binary rather than two, because the settings file that installs the hook has to name an
/// executable, and `current_exe()` is an answer that cannot go stale or go missing. A second
/// artifact would be one more thing to ship, find, and keep in step.
///
/// The branch happens here, before anything else starts: the hook must not build a window, open
/// the database, or take a lock. It has one job and a deadline.
fn main() {
    let mut args = std::env::args().skip(1);
    let mode = args.next();
    if mode.as_deref() == Some("seal-hook") {
        let socket = args
            .next()
            .map(std::path::PathBuf::from)
            .or_else(|| grimoire_core::Paths::resolve().ok().map(|p| p.seal_socket()))
            .unwrap_or_else(|| std::path::PathBuf::from("/nonexistent/seal.sock"));

        let reply = grimoire_core::seal::hook::run(&socket, &mut std::io::stdin());

        // Printed on stdout, which is where the engine reads its answer from. Anything that
        // goes wrong past this point still leaves a decision on the wire, because the reply was
        // built to fail closed before it got here.
        let mut out = std::io::stdout();
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
        return;
    }
    // The live hook and the owner's seal resolution do all proposal work. This helper is
    // intentionally incapable of dispatching when invoked outside that path.
    if mode.as_deref() == Some("archivist-propose") {
        return;
    }

    grimoire_app_lib::run()
}
