# Tasks

Working state. Phases and their acceptance criteria come from CLAUDE.md §12; this file tracks
what is done, what is not, and what cannot be checked from here.

Legend: `[x]` done and verified · `[~]` done but not verifiable in this environment ·
`[ ]` not started.

---

## Phase 0 — Scaffold

- [x] Quintet stripped; workspace scaffolded at the repo root (`crates/grimoire-core`, `src-tauri`, `src`)
- [x] `tokens.css` with the nine §7.2 colours, the 12/16/21/28/37/50 scale, 2px radius on controls only
- [x] EB Garamond and Iosevka vendored as woff2, no CDN, licences beside the files
- [ ] Junicode vendored — unreachable from this sandbox, see DECISIONS.md 0003
- [x] `Sigil.tsx`: deterministic mark from a hash of the name, six states from §7.4
- [x] `prefers-reduced-motion` swaps ring rotation for a static brass tick
- [x] Migration `001` with every §9 table, tested against a seeded database
- [x] Scriptorium shell at §7.5: 240px rail, four tabs, aether meters pinned bottom
- [x] `bun run licences` generates `THIRD-PARTY.md` from both lockfiles
- [x] `bun run icons` draws the app mark in code; output gitignored (DECISIONS.md 0005)
- [x] `DECISIONS.md` and `TASKS.md` exist

**Acceptance**

- [x] Layout correct at 1280×800 and 1024×640 — Playwright, both viewports
- [x] A real WCAG relative-luminance test: `--bone` on `--ink-void` ≥ 7:1, `--bone-dim` ≥ 4.5:1
- [x] Four names produce four visibly distinct sigils
- [x] App launches — built and run under `Xvfb`, migration applied, scriptorium rendered
- [x] Ring rotation fixed for WebKit, with a regression test (DECISIONS.md 0006)

---

## Phase 1 — One real familiar

- [x] `summon/pty.rs`: `portable-pty` spawn with cwd, scrubbed env, `PtySize`
- [x] Reader thread to a Tauri `ipc::Channel`, coalesced on a 16 ms tick with a 64 KB cap
- [x] Writer for typed input; `resize()` on panel resize
- [x] `summon/lifecycle.rs`: SIGINT → 5 s → SIGTERM → 3 s → SIGKILL, on the process **group**
- [x] Binary resolution: workbench path → `PATH`; missing binary disables Summon with the reason
- [x] xterm.js with fit and webgl addons, Iosevka, tokens applied
- [x] Restore intent persisted on quit — the stop runs on `RunEvent::Exit` and on `SIGTERM`
- [x] **First-run onboarding** understood. A fresh machine opens a theme picker and a
      login-method screen before the engine will take a turn. Grimoire shows them and the owner
      answers them once, as in any terminal. It deliberately does not pre-write
      `hasCompletedOnboarding` to skip a consent screen that is not ours to skip.

**Acceptance**

- [x] Summon a real engine — `claude` 2.1.270 runs in the app, drawing its full interface
- [x] Type into it — a keystroke advanced the engine from one screen to the next
- [~] Hold a full model turn — blocked by this container's onboarding, see below
- [ ] Resize mid-run without corrupting the buffer — mechanism tested, window resize needs a WM
- [x] `cat` 50k lines with the interface responsive
- [x] Quit leaves no orphan — verified from the log, not merely from `ps`
- [x] An honest report of `portable-pty` friction — **DECISIONS.md 0007: stay on Tauri**

**The two criteria not fully met here, and why**

- **A full model turn through the interactive interface.** This container has never run `claude`
  interactively, so `hasCompletedOnboarding` is unset and the first-run flow asks to choose a
  login method — even though `oauthAccount` is present and `claude -p` answers normally with
  exactly the environment `scrubbed_env` provides. Completing it wants an OAuth code pasted from
  a browser, which a sandbox cannot do. Everything up to the model turn is verified: the engine
  runs, draws, and advances screens in response to keystrokes sent through the application.
  **On a machine where the CLI has been used once, this should work with no change.**
- **Resizing the window mid-run.** The geometry change is tested directly in Rust, where a
  resize is reflected in `stty size` inside the pty, and the front-end wires a `ResizeObserver`
  to that call. What could not be done here is dragging the window: `Xvfb` runs with no window
  manager, so the window has no resizable frame.

## Phase 2 — Bindings as files

- [x] `~/.grimoire/bindings/*.binding.md`, watched with a 250 ms debounce, only touched files re-read
- [x] YAML frontmatter → serde in Rust, Zod at the IPC boundary in TypeScript
- [x] The body is the writ, verbatim. Nothing templates it; `{{intake.*}}` waits for Phase 3
- [x] Unknown keys are a warning, not an error — including keys nested inside `bounds` and `aether`
- [x] `~` expands; relative paths resolve against the bindings folder
- [x] A binding that fails validation appears in oxblood with the error inline, never dropped
- [x] `engine != claude` loads and lists, with the reason on hover (DECISIONS.md 0004)
- [x] Five seeds, placed on first run and never overwritten
- [x] Per-familiar workspace: commission · terminal · outputs · codex
- [x] Intake form generated from the binding; required fields block submit

**Acceptance** — every one checked in the running application, not only in tests

- [x] A new `.binding.md` appears within 2 s with no restart
- [x] Deleting one removes it
- [x] A bad `order` shows its error in oxblood without crashing
- [x] All five seeds load, with no warnings
- [x] The intake form blocks submit on a missing required field, and says which

**Two things worth carrying forward**

- **The seeds are placed only when the folder is completely empty.** Deleting one and restarting
  does not bring it back, which is right — deleting a familiar is a decision. `seed::place` will
  restore a missing one, so a "restore the shipped bindings" button in the workbench is a one-line
  call whenever Phase 9 wants it.
- **`bounds` is still advisory.** Nothing in Phase 2 enforces it; §6.4 and §11 put enforcement in
  Rust in Phase 4. A binding that lists deny paths under the wrong autonomy already warns, but a
  binding under `bounded` is not yet held to anything. Until Phase 4 lands, the writ is the only
  thing asking a familiar to behave, and §11 is explicit that the prompt is advisory.

## Later phases

Phases 3–9 are unstarted. Two things are worth carrying forward now because they were
discovered early:

- **Phase 4, the seal.** The mechanism is settled and verified — see DECISIONS.md 0004. The
  hook must enforce its own deadline and deny on expiry, because Claude Code's own hook timeout
  **fails open**. That was measured, not assumed.
- **Phase 4, unreachable app.** The hook must also deny when it cannot reach Grimoire at all.
  Unreachable is a refusal.
- **Phase 4, verify the hook interactively.** DECISIONS.md 0004 measured the hook in print mode
  only. Phase 1 now has a real pty that can drive an interactive engine
  (`crates/grimoire-core/tests/engine.rs`), so the first thing Phase 4 should do is repeat the
  deny probe there rather than assume it carries over.

---

## Blocked here — needs the Mac

This container is headless Linux. Each of the following is real work that this environment
cannot check, and none of it is claimed as done anywhere in this repository.

| What | Phase | Why it cannot be checked here |
| --- | --- | --- |
| Native window chrome, traffic lights, overlay title bar | 0 | macOS window server |
| Dragging the window to resize a live terminal | 1 | `Xvfb` has no window manager, so no resizable frame. The pty side is tested directly. |
| A full model turn through the interactive interface | 1 | This container's CLI is not onboarded and its login flow needs a browser |
| macOS notifications | 4, 7 | Notification Center |
| Menu-bar residency, closing to the tray | 7 | `NSStatusItem` |
| Keychain storage for API keys (§11) | 4 | macOS keychain. Nothing may fall back to a file. |
| `.dmg`, signing, notarisation | 9 | `tauri build --target aarch64-apple-darwin` on a Mac |
| VoiceOver on the floor (§8.4) | 5 | VoiceOver |
| Retina rendering of the floor at 2× | 5 | No Retina display |

Everything else — the PTY, the breaker, the ward arithmetic, path canonicalisation and the
symlink escape case, binding validation, the whole interface through the mock IPC backend — is
verifiable on Linux and is expected to be verified here.

The application itself turned out to be one of those: WebKitGTK and GTK 3 are installed, so the
real binary runs under `Xvfb` and its window can be read straight out of the framebuffer. That
is worth keeping up. **The Chromium-based Playwright run is not a substitute**: it passed
sixteen tests green while the real WebKit build was drawing a sigil on top of its own status
line. Run the binary at the end of every phase, look at it, and only then call the phase done.
