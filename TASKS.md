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

- [ ] `summon/pty.rs`: `portable-pty` spawn with cwd, scrubbed env, `PtySize`
- [ ] Reader thread to a Tauri `ipc::Channel`, coalesced on a ~16 ms tick with a byte cap
- [ ] Writer for typed input; `resize()` on panel resize
- [ ] `summon/lifecycle.rs`: SIGINT → 5 s → SIGTERM → 3 s → SIGKILL, on the process **group**
- [ ] Binary resolution: workbench path → `PATH`; missing binary disables Summon with the reason
- [ ] xterm.js with fit + webgl addons, Iosevka, tokens applied
- [ ] **First-run onboarding.** An interactive `claude` in a fresh environment opens a theme
      picker and further first-run screens before it will accept a turn. A summoning has to
      either pre-seed that state or drive past it, or the familiar looks hung on first use.
      Found while verifying DECISIONS.md 0004; not yet solved.
- [ ] Confirm `--append-system-prompt` and `--model` behave in interactive mode; record it

**Acceptance**

- [ ] Summon and hold a real conversation
- [ ] Resize mid-run without corrupting the buffer
- [ ] `cat` a 50k-line file with the UI responsive
- [ ] Quit leaves no orphan — `ps` check plus a test asserting the child group is gone
- [ ] An honest written report of `portable-pty` friction against the one-session budget in §5.
      **This is the Tauri-vs-Electron decision point.**

---

## Phase 2 — Bindings as files

- [ ] `~/.grimoire/bindings/*.binding.md`, watcher with 250 ms debounce, re-parse only what changed
- [ ] YAML frontmatter → serde + JSON Schema in Rust **and** Zod in TypeScript
- [ ] Body after the frontmatter is the writ, verbatim, with only `{{intake.*}}` substitution
- [ ] Unknown keys are a warning, not an error (§4) — no blanket `deny_unknown_fields`
- [ ] `~` expands; relative paths resolve against the bindings folder
- [ ] A binding that fails validation appears in oxblood with the error inline, never dropped
- [ ] `engine != claude` loads and lists, Summon disabled, reason on hover (DECISIONS.md 0004)
- [ ] Five seed bindings
- [ ] Per-familiar workspace: commission · terminal · outputs · codex
- [ ] Intake form generated from the binding; required fields block submit

---

## Later phases

Phases 3–9 are unstarted. Two things are worth carrying forward now because they were
discovered early:

- **Phase 4, the seal.** The mechanism is settled and verified — see DECISIONS.md 0004. The
  hook must enforce its own deadline and deny on expiry, because Claude Code's own hook timeout
  **fails open**. That was measured, not assumed.
- **Phase 4, unreachable app.** The hook must also deny when it cannot reach Grimoire at all.
  Unreachable is a refusal.

---

## Blocked here — needs the Mac

This container is headless Linux. Each of the following is real work that this environment
cannot check, and none of it is claimed as done anywhere in this repository.

| What | Phase | Why it cannot be checked here |
| --- | --- | --- |
| Native window chrome, traffic lights, overlay title bar | 0 | macOS window server |
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
