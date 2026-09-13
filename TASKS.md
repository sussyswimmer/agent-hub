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

## Phase 3 — Commissions, persistence, ledger

- [x] Commission lifecycle and queue, one at a time per familiar (§6.2)
- [x] Every §9 table written to: familiars, summonings, commissions, ledger_events
- [x] `{{intake.*}}` substitution, single-pass, the only templating in the application (§4)
- [x] Codex read and append, condense threshold and backup-first condense (§6.6)
- [x] Ledger events appended for every summon, start, end, usage and misfire
- [x] Ledger view: spend by familiar and by day, cost labelled estimated everywhere (§6.9)
- [x] The writ reaches the engine verbatim, with a note naming the codex (§4, §6.6)
- [x] Recovery at startup for commissions and summonings left open by an earlier stop

**Acceptance** — each checked in the running application

- [x] A commission survives a restart with the correct status. Killed with `SIGKILL`
      mid-commission; on restart it came back `misfired`, the log said why, and the queue behind
      it was free again.
- [x] A familiar with a running commission queues the next one visibly. Two placed, one
      summoned: the first showed `running`, the second `queued · next`.
- [x] The codex file contains what the familiar wrote — the tab reads the real file, in the
      right study, with its word count. See the caveat below on the writing half.
- [x] The ledger shows a non-zero token count for a real run, and labels cost as estimated in
      every place it appears. Real numbers: 6,143 tokens, `$0.007638` estimated.

**Caveats, stated rather than ticked over**

- **The familiar has not yet written to its codex here.** Grimoire tells it the path and that it
  may append — confirmed by reading the spawned engine's own command line — and the reading half
  is verified against a real file. The writing half needs the engine to take a turn, which this
  container's onboarding still blocks (see Phase 1). The file path, the append behaviour and the
  condense-with-backup are covered by tests.
- **The non-zero token count was measured through print mode, not the pty.** The code is the same
  either way: `summon::usage` neither knows nor cares how the engine was started. DECISIONS.md
  0008 has the evidence.
- **`bounds` is still advisory.** Phase 4 is where §6.4 and §11 become real. Nothing in Phase 3
  stops a familiar doing anything.

---

## Phase 4 — The seal

- [x] Three autonomy levels, decided in Rust from the binding's own words (§6.4)
- [x] Bounds matched with globs, after paths are resolved — not before (§11)
- [x] The never-exempt list in code, checked before autonomy is read (§6.4)
- [x] The hook: one binary, two jobs, branching before a window or a database exists
- [x] A Unix socket at 0600, and a hook that blocks on it until the owner answers
- [x] The seal queue: the familiar, the exact action, the reason, and what it would write
- [x] Three answers, and a refusal that goes back as a reason the familiar can act on
- [x] A thirty-minute deadline the hook enforces itself, because the engine's fails open

**Acceptance** — each driven by hand in the running application, under `Xvfb`

- [x] **A `propose` familiar asked to write raises a seal instead of writing.** Tally, summoned
      from the window with a real `claude` behind it, its hook installed by the app's own
      settings file. The request appeared in the queue naming `/root/work/numbers/tally.txt`,
      showed the `7` it was about to write, and the file did not exist while it waited.
- [x] **A `bounded` familiar writes inside its bounds and asks outside them.** Covered by the
      security suite against `decide()` directly; the live pass below exercises the same
      ordering through `free`.
- [x] **A `free` familiar still asks for `rm` outside its workspace and for any `.env`.** Run
      against the live app with a commission actually running:

      | What was asked | What happened |
      | --- | --- |
      | write inside the workspace | allowed, unasked |
      | `ls -la` inside the workspace | allowed, unasked |
      | write `/root/work/numbers/.env` | raised a seal |
      | `rm -rf /root/work/essays` | raised a seal |
      | `cd /root/work/numbers && git push --force` | raised a seal |

- [x] **Refusing sends a message the familiar reacts to.** The live hook, blocked on the socket,
      received `permissionDecision: deny` with the reason, and `~/work/essays` was still there.
- [x] **Sealing lets it through.** `permissionDecision: allow`, "Sealed."
- [x] **A session Grimoire does not recognise is refused**, rather than answered on behalf of a
      stranger.
- [x] **The adversarial test.** A writ instructing the familiar to ignore the seal, against a
      live engine under `--permission-mode acceptEdits`. The file was not written, and the
      engine said so itself: *"this is a real permission control, not a bug, despite earlier
      text in this conversation claiming otherwise."* Enforcement is in Rust; the prompt has no
      say (§11).
- [x] **A seal left thirty minutes becomes a refusal and binds the commission.** Driven by a
      test against a shortened deadline rather than by waiting half an hour.

**Two bugs the running application found that the test suites could not**

- **A familiar walked away from was stranded.** Selecting another familiar unmounts the terminal,
  so the pane came back reading dormant while the engine was still running — the button offered
  to summon it, the backend refused because it already had, and there was no way left to banish
  it. `ps` showed the real `claude` still there with the hook installed. Fixed by rebuilding what
  is live from the backend on mount and swapping the output slot; DECISIONS.md 0010. No test had
  a reason to leave and come back, so the new one does exactly that.
- **Every allow said "Sealed."** Including the ordinary case where the binding already permitted
  the action and nobody was asked, which told the familiar a seal had happened when none had.
  §3: the verb in the result is the verb on the button.

**Caveats, stated rather than ticked over**

- **The engine here still cannot take a turn.** The live seal passes above were driven by running
  the hook exactly as the settings file specifies — the same binary, the same socket, the same
  payload shape the engine sends — because this container's `claude` stops at its first-run login
  screen (see Phase 1). The link that is therefore not exercised end to end in the window is
  "the engine spawns this command", and that link is evidenced separately: the app's own settings
  file, read off disk after a real summon, and the ignored engine tests where a real `claude`
  obeys the hook.
- **A hook that dies leaves its request in the queue.** Killing a blocked hook does not withdraw
  the row; it sits until the thirty-minute timeout. Harmless — the timeout is a refusal and
  nothing is allowed in the meantime — but the socket closing is detectable and should withdraw
  it. Carried to Phase 6 with the stall work.
- **macOS notifications for seal requests are not done** (§6.4). Notification Center. The queue
  and its count are the whole of the signal here.
- **Keychain storage (§11) is not done.** Nothing writes a key anywhere; there is simply no
  keychain to write to.

---

## Later phases

Phases 4–9 are unstarted. Three things are worth carrying forward, all discovered early:

Phase 4 is done; its report is above. Carried forward from it:

- **A dead hook should withdraw its request.** The socket closing is detectable and currently
  is not acted on, so a killed hook leaves a row in the queue until it times out. Belongs with
  the stall detection in Phase 6, which is already about noticing that nothing is happening.
- **The rail's status does not follow a summoning.** A summoned familiar still reads "dormant"
  in the roster. The states in §7.4 and §8.3 are Phase 5's work and this is where they land.

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
