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

## Phase 5 — The floor

- [x] `plan.ts`: the room as data — wall, ward circle, five order desks 72° apart, hearth,
      reliquary cabinet, ledger lectern, door. `slot()` places the nth familiar at a station.
- [x] `paths.ts`: waypoint graph, all ninety routes solved once at load
- [x] `hatching.ts` / `bake.ts`: procedural hatch tile, the room baked into a `RenderTexture`
- [x] `stage.ts`: one Pixi application, three layers, 60 focused / 20 unfocused / stopped hidden
- [x] `actors.ts`: the §8.3 state table, walking, ring rotation, ink threads, aether arcs
- [x] `interaction.ts`: hover, click-through, zoom toward the cursor, pan, `Tab`/`Enter`/`Esc`,
      `+ - 0`, arrows, the brass focus ring
- [x] `marginalia.tsx`, `a11y.tsx`, `Floor.tsx`, the Floor/Roster toggle, the dev state override

**Acceptance** — driven by hand in the real binary under `Xvfb`, on WebKitGTK

- [x] **Five real familiars at the stations their real states put them at.** All five dormant at
      the hearth on a fresh study, each in its order's colour, name plates legible.
- [x] **Summoning walks one from the door to its desk.** Sconce, summoned from the rail, left
      the hearth and arrived at the lantern desk.
- [x] **A familiar raising a seal walks to the ward circle, and the circle lights.** Both — the
      familiar stands in the middle of the circle and the ring itself goes brass.
- [x] **`working` draws the thread of ink** from the sigil to its own desk lamp.
- [x] **`bound` draws the brass chord across the ring**; **`misfired` breaks the ring in oxblood
      and puts the desk lamp out**; **`stalled` renders**. Driven from the dev-only override
      panel, which is what §10 asks for while the breaker is still Phase 6.
- [x] **`Tab` reaches every sigil with a visible brass focus ring**, clockwise from the door.
- [x] **The marginalia card appears beside the sigil** with the familiar, its order and what it
      is doing.
- [x] **A hidden floor renders nothing.** The ticker's own frame counter is on the element, and
      it stops moving the moment the tab is hidden — measured, not felt.
- [x] **No image files were added.** `git status` is clean of them; every mark is a `Graphics`
      call or generated text (§1).

**Three bugs the running binary found that neither test suite could**

- **A 26-unit band drawn clean across the room.** Pixi's `arc()`, like the canvas call it is
  named after, does not lift the pen — it draws a line from wherever the path is to where the
  arc starts. Every arc now goes through `arcAt()`. DECISIONS.md 0012. The Playwright suite does
  not look at pixels and the unit tests check geometry, so nothing but running it would have
  found this.
- **Every familiar reported `dormant` for ever.** The roster came straight from the binding, so
  §7.4's states and the whole of §8.3 were decorative — the floor drew a state table nothing
  could move. `list_familiars` now overlays the live summoning, the commission and any pending
  seal. DECISIONS.md 0013.
- **Summoning a familiar that had never been given a commission failed** with `database: FOREIGN
  KEY constraint failed`. The roster is read from disk, so a familiar with no commission had no
  row for `summonings` to reference. Fixed with one `ensure_familiar` used by both paths, and
  pinned by a test. It is the first thing anyone would do with a fresh study, and §12 asks that
  a failure say what happened and what to do — this one said neither.

**Caveats, stated rather than ticked over**

- **The 60fps number is not from this container.** The headless runner is software-rendered and
  the Xvfb session has no GPU at all (`libEGL: DRI3 error` on every launch), so the figure the
  ticker reports here measures the software rasteriser, not the budget §8.6 sets. What is
  asserted in the suite is that twelve familiars with five working does not collapse the frame
  rate, and that a hidden floor renders nothing. The honest 60fps measurement is one for the
  owner's machine, and it is listed below with the other Mac work.
- **The intermediate frames of a walk were not caught on camera.** Positions before and after
  are right, and the pacing — every journey 1.1s, split between legs in proportion to their
  length, measured once rather than re-measured as it shrinks — has its own test.
- **`prefers-reduced-motion` was exercised through the media query in Playwright, not in the
  real binary.** Nothing in this container sets the GTK setting the webview reads.
- **VoiceOver on the floor is not done** (§10). macOS. The live region it would read is here and
  its wording is asserted, but the screen reader itself is not.

---

## Phase 6 — Aether and the breaker

- [x] Three meters per commission, read from the engine's transcript and the clock (§6.5)
- [x] 80% steers once, and says which of the three budgets is the tight one
- [x] `on_exceed` at the line: `steer` re-warns every 10%, `bind` stops the tool calls and asks
      to extend, `banish` walks the stop ladder
- [x] The runaway guard, which has no `on_exceed` parameter and cannot be given one
- [x] A five-second heartbeat, and a ten-minute stall raised for the owner rather than acted on
- [x] The meters on screen, the rule brass at 80%, and the floor's arcs on the same reading

**Acceptance** — every one driven in the real binary, against a real engine in a real pty

- [x] **A commission trips at 100% and does what `on_exceed` says.** Tally, given
      `minutes: 1, on_exceed: banish`: steered at 83% ("Prioritise finishing over exploring"),
      banished at the line, the commission marked `banished`, the summoning row closed
      `exit_reason: banished`. Both are in the ledger.
- [x] **`banish` leaves no orphaned process.** `ps` after the trip: none.
- [x] **`bind` stops the tool calls and asks.** The request appears in the queue as "Tally · out
      of aether · extend this commission's aether", and a `free` familiar reading inside its own
      workspace is refused while it stands.
- [x] **Sealing it lets the familiar go on, and keeps it going.** Allowed immediately, and still
      allowed twelve seconds and two ticks later — which is the bug below.
- [x] **The runaway guard fires at 200 tool calls even with `on_exceed: steer`.** Fired at 201,
      with `steer` in the binding: *"201 tool calls in one commission. That is past the runaway
      guard, which is not a budget and does not answer to `on_exceed`."*
- [x] **A stalled agent is surfaced within 10 minutes and is not killed silently.** Clock started
      01:18:42, raised 01:28:42 — "Stalled — steer, or banish?", with "Nothing has been done to
      it" in the reason. Afterwards: commission `awaiting_seal`, summoning still open, engine
      still on the process table. Raised once; five more ticks added nothing.
- [x] **The floor's arc matches the pane's meters.** They are the same object — one map in the
      store, refreshed on one tick, read by both.

**Three bugs the running application found**

- **Extending bought four seconds.** Sealing the request unbound the familiar and left the budget
  where it was, so the next tick read the same overspend, bound it again, and queued a second
  identical request. Both rows were in the table. Extending now moves the line. DECISIONS.md 0015.
- **The rail disagreed with itself.** A seal raised by the breaker wrote its row without telling
  the window, so the count read "none waiting" beside a familiar whose own row said it was
  waiting on a seal.
- **And the reason it stayed broken after that was fixed:** the Zod enum at the IPC boundary had
  never heard of the two new seal kinds, so `sealsPending()` was throwing inside a `catch` —
  no error anywhere, just a number that would not move. Those enums are checked against the
  generated types now. DECISIONS.md 0016.

**Caveats, stated rather than ticked over**

- **The trip was driven on minutes, not tokens.** §10's example is `tokens: 2000`, and tokens
  come from the engine's own transcript — which needs the engine to take a turn, which this
  container's login screen still blocks (see Phase 1). Minutes are wall-clock and exercise the
  identical path: the same `read`, the same `decide`, the same act. The token half of `read` is
  covered by tests, including that cache tokens count towards the budget.
- **`$X`, the spend cap, has no workbench UI.** It is a setting with a default of $10 and there
  is no workbench view yet to change it in. The guard reads it; nothing writes it.
- **macOS notifications on a breaker trip are not done** (§6.5's "notify"). Notification Center.
  The ledger, the seal queue and the rail all carry it.

---

## Phase 7 — Standing wards and the menu bar

- [x] `ward::due`, a pure function of schedule, last turn and now — so every timing rule is
      testable without waiting for a clock
- [x] Five-field crontab expressions, read in the machine's own time zone
- [x] The prompt sent verbatim, every run (§6.7)
- [x] Skip if busy, without queueing; a missed window is one run and not a backlog
- [x] Wards stored, listed, stood down and dismissed, with a panel on the familiar
- [x] A menu-bar item; closing the window hides it; quit is explicit and warns first

**Acceptance** — in the running binary under `Xvfb`

- [x] **A ward set two minutes out fires with the window closed.** Set at 02:06:58 for minute 8,
      window closed at 02:07:18, fired 02:08:02 with the window still gone and the process still
      up. The commission was in the database before the window came back.
- [x] **The prompt sent is byte-identical to the stored prompt.** Ward and commission both read
      `plan the week. keep tuesday clear.` — and the Rust test drives the same property through
      leading spaces, a blank line and a trailing tab, which is what trimming would eat.
- [x] **A ward whose familiar is busy records `skipped: busy` and does not queue.** Came round at
      02:10:01 while Astrolabe was working: `skipped — Astrolabe was busy`, and the commission
      count did not move. Held over thirty-three further turns.
- [x] **Closing the window does not quit, and does not stop the work.** Closed with Vellum live:
      app up, engine on the process table, summoning row still open.
- [x] **Quitting stops everything properly.** `stopped on quit id=vellum how=Interrupt`, the row
      closed `quit`, no orphaned engine.
- [x] **Reopening shows the floor already right.** The Roster/Floor preference survived, the
      roster came back in its current state, and nothing was replayed.

**A bug the running application found**

- **A skipped ward was asked again on every heartbeat.** Leaving the clock alone on a skip
  reasoned that a skipped ward had not run — true, but it had come round, and being due again
  immediately meant due every five seconds. Thirty-three skips in two and a half minutes, each a
  write. Nothing ever queued, which is the rule §6.7 states outright, but that is not what
  "skipped 30 times" means. A turn is now spent whether or not it became a commission.
  DECISIONS.md 0018.

**Caveats, stated rather than ticked over**

- **The menu bar could not be shown here.** There is no session bus in this container —
  `libayatana-appindicator` cannot reach `dbus-launch` — so the tray icon never appears and its
  menu cannot be clicked. The application says so and carries on, which is the behaviour it was
  written to have; what could not be exercised is the tray → "Quit Grimoire" → warning chain.
  The warning itself, its wording and both its answers are covered in Playwright, and closing
  the window was driven with a real `WM_DELETE_WINDOW`.
- **This is a Linux tray, not a macOS menu bar.** Tauri's tray is cross-platform, but §6.7 means
  `NSStatusItem`, and a menu-bar item that lives beside the clock is a different thing from an
  icon in a panel that does not exist here.
- **Notifications were not exercised.** Same reason: no notification daemon. §6.7 wants one per
  ward run and per seal request, and §6.5 one on a breaker trip.
- **The ward panel is per-familiar.** §6.7 does not ask for a global list, but a study with
  wards on five familiars has them in five places. Worth revisiting with the workbench.

---

## Later phases

Phases 4 through 7 are done; their reports are above. Carried forward:

- **The ward panel is per-familiar, with no global list.** §6.7 does not ask for one, but with
  five familiars there is nowhere to see every schedule at once.
- **The workbench does not exist.** §6.5 puts the runaway guard's spend cap there, §6.1 puts the
  engine binary's path there, and §11 puts transcript deletion there. All are settings with
  sensible defaults and no view. It is the largest thing left before Phase 9.
- **Phase 8 is the archivist**, and its whole point is that it cannot dispatch. §6.8 is blunt
  about why: "a coordinating agent with dispatch rights is the single most expensive failure
  mode in this class of app." The test §10 asks for is one that tries and fails.

---

## Making it runnable — the owner asked when they could test it

The answer should have been "today". It was not, and none of the reasons were in the code.

**A fresh clone would not have compiled.** §1 forbids vendored art, so `src-tauri/icons/` is
gitignored and `scripts/icons.ts` draws the mark instead — but there was no `icons` entry in
`package.json` and nothing invoked it, while Tauri embeds those files at compile time through
`generate_context!()`. The README even told the reader to run `bun run icons`, which failed with
"script not found". It is a script now, and chained into `beforeDevCommand` and
`beforeBuildCommand`, so it is not a step anyone has to remember.

Verified by being a clean clone: cloned the pushed branch into a scratch directory, where the
icons are genuinely absent, and followed the new README. The log reads

```
Running BeforeDevCommand (`bun run icons && bun run dev`)
Drew 6 files into src-tauri/icons/ (gitignored; §1 forbids vendored art).
```

then it compiled, opened, created its `~/.grimoire`, placed the five seeds, and drew the roster
with all five dormant. It opened on Roster rather than the floor, which is stale `localStorage`
in this container's shared webview data directory from earlier sessions — `src/store.ts` defaults
to the floor unless `"0"` is stored. On a new machine it will open on the floor; that is read
from the code, not seen here.

**Junicode arrived and did nothing.** `scripts/fonts.ts` fetches it where github.com is
reachable, but `fonts.css` declared no `@font-face` for it. The owner would have run
`bun run fonts`, read `junicode  1 files`, and gone on reading EB Garamond with nothing to say
why. DECISIONS.md 0003 claimed the file appearing was enough; it was not, and the entry is
amended to say so. `src/theme/fonts/vendored.css` is generated and committed now, rewritten on
every run to match what was placed, and a test walks both stylesheets asserting every `url()`
resolves and that a woff2 on disk implies a rule declaring it.

**`bun run doctor`** checks Rust, Bun, the Xcode command line tools, dependencies, the drawn
mark, the vendored faces, `claude` on `PATH` and whether `~/.grimoire` exists. On the clean
clone before `bun install` it said `✗ Dependencies  Run \`bun install\` in the repository root.`
and exited 1; with `claude` off `PATH` it says so without treating it as fatal.

**A bug the suite found by failing twice and then refusing to fail again.** Two Playwright tests
failed in a full run and passed on every rerun of that file alone — twenty-four repeats at double
the workers, all green. Pressing Summon inside the window where the pane is still asking the
backend whether this familiar is already running made the answer come back "yes", because the
summon that had just started was what it found. The pane wrote "reattached" over a terminal that
had just started and left two `onData` handlers on the same xterm: **every keystroke reached the
engine twice**, `abc` sending `aabbcc`. Fixed with a ref set before the first `await`, and pinned
by a test that widens the race with a delay knob in the mock rather than hoping load reproduces
it. DECISIONS.md 0019.

Calling that a flake would have shipped doubled keystrokes to the owner's engine.

**HANDOFF.md** is new: what is built, what is missing in priority order, what has never run on a
Mac, and what to do first. The README gained a "What to distrust" section pointing here.

At the end of this pass: 238 Rust tests, 37 unit tests, 122 Playwright tests, clippy clean,
`bun run licences` leaving no diff, and `git ls-files` showing no image file.

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
| The floor's real frame rate | 5 | Measured on a software rasteriser, which is not a measurement |
| That the `.app` builds at all | 9 | No macOS toolchain here. The Rust is plain POSIX and the config is aimed at macOS, but neither is proof. |
| `.dmg`, signing, notarisation | 9 | `tauri build --target aarch64-apple-darwin` on a Mac |
| VoiceOver on the floor (§8.4) | 5 | VoiceOver |
| Retina rendering of the floor at 2× | 5 | No Retina display |
| The floor's real frame rate (§8.6, §10) | 5 | No GPU. `Xvfb` reports `libEGL: DRI3 error` and falls back to software, so any number measured here is the rasteriser's, not the budget's. |
| `prefers-reduced-motion` in the real binary | 5 | Nothing here sets the GTK setting the webview reads. The media-query path is covered in Playwright. |
| Notifications when the breaker trips (§6.5) | 6 | Notification Center. The ledger, the queue and the rail all carry it. |
| The menu bar as `NSStatusItem` (§6.7) | 7 | No session bus here, so no tray at all — and a Linux panel icon is not a macOS menu-bar item either. Closing-is-not-quitting was driven with a real `WM_DELETE_WINDOW`. |
| Notifications on a ward run or a seal request (§6.7) | 7 | No notification daemon. |
| A budget tripped on *tokens* rather than minutes | 6 | Tokens come from the engine's transcript, which needs a turn this container's login screen blocks. Same code path either way. |

---

## Continuation — Workbench and first-run repair

- [x] Workbench route in the rail, preserving the study's existing visual language
- [x] Engine binary overrides with resolved source and actionable failures
- [x] Runaway guard spend-cap control, defaulting visibly to the existing $10 policy
- [x] Local transcript inventory and one-click deletion by safe filename
- [x] Restore missing shipped bindings without overwriting any existing binding
- [x] Platform-correct `PATH` traversal, including Windows `PATHEXT` command shims
- [ ] Mac-only checks remain blocked on a Mac: notifications, keychain, NSStatusItem, VoiceOver, Retina, `.app`, signing, and notarisation

---

## Continuation — Phase 8 archivist

- [x] `archivist: true` binding capability, rejected when paired with `autonomy: free`
- [x] Astrolabe designated as the shipped archivist
- [x] Read-only roster, commission queue, and recent ledger snapshot in the archivist preamble
- [x] Structured proposal command recognized only for the live designated archivist session
- [x] Proposal seal kind with no commission-wide approval shortcut
- [x] A sealed proposal queues work; refusal queues nothing
- [x] The `archivist-propose` helper is a no-op and has no direct dispatch implementation

Everything else — the PTY, the breaker, the ward arithmetic, path canonicalisation and the
symlink escape case, binding validation, the whole interface through the mock IPC backend — is
verifiable on Linux and is expected to be verified here.

The application itself turned out to be one of those: WebKitGTK and GTK 3 are installed, so the
real binary runs under `Xvfb` and its window can be read straight out of the framebuffer. That
is worth keeping up. **The Chromium-based Playwright run is not a substitute**: it passed
sixteen tests green while the real WebKit build was drawing a sigil on top of its own status
line. Run the binary at the end of every phase, look at it, and only then call the phase done.

---

## Phase 9 — the art, the icon, and a floor that did not open

The owner's instruction for this session: carry on to the next step, and use Higgsfield for the
rest of the generations. The next step in §10 is Phase 9. Its code-side item is the app icon,
and the owner's ruling changes how that icon is made (DECISIONS 0020).

**The first thing found was that the floor had never drawn in a packaged build.** In the
releases, Pixi refused to start under the CSP (it wants `eval` for its shaders), and the owner's
first-light scene caught it without saying why. Under `tauri dev` and in the browser, where there
is no CSP, it got further and then took the whole window down: it built the familiars from an
image nobody had loaded, the first draw threw, and React unmounted everything, rail included.
Every test in `floor.spec.ts` had been timing out since that commit. DECISIONS 0021 has both,
and the four faults behind them, three of which only the binary could show.

- [x] `pixi.js/unsafe-eval`: the floor draws under the CSP without loosening it. Seen in the binary
- [x] Art loaded through `Assets.load` before any actor exists, on the main thread, with a time limit
- [x] Asset URLs resolved before Pixi sees them: under `tauri://localhost` it dropped the host. Seen in the binary
- [x] A line on the floor says what art did not load and why
- [x] A missing portrait is the familiar drawn in code; a missing painting is the whole vector plan
- [x] `FloorBoundary`: a floor that throws takes only the floor with it, and offers the roster
- [x] The first-light scene says why the renderer failed and offers the roster, not a restore of
      bindings that are already there; its figures no longer spill across the heading in WebKitGTK
- [x] Five transparent familiars from Higgsfield, one per order, replacing the captioned sheet
- [x] A top-down floor painting from Higgsfield, generated from a diagram of `plan.ts` and registered
      to it, drawn inside the world so it pans and zooms with the plan
- [x] Lamps moved to where the painting lit them (`LAMPS` in `plan.ts`)
- [x] The lit ward circle made visible against a painted brass ring (§8.4's first question)
- [x] Name plates and station labels outlined so they read on the painting
- [x] The app mark from Higgsfield; `scripts/icons.ts` composes every icon size from it on Apple's grid
- [x] `src/assets/higgsfield/PROVENANCE.md`: every generated file, its job, prompt, references and post-processing
- [x] `bun run typecheck` passes again. The first art commit had broken it: the node config
      reached the floor through a unit test and had no type for a `.png` import
- [x] DECISIONS 0020 (the ruling), 0021 (the floor); 0005 marked superseded; README, HANDOFF,
      THIRD-PARTY brought up to date
- [x] `cargo test --workspace` compiles again: three test fixtures had been missing the
      `archivist` field since a6642e9, so no Rust test had run since
- [x] `bun run bindings:check` clean: `BindingFrontmatter.ts` regenerated for the archivist's doc comment
- [x] CLAUDE.md §1 amended at the owner's request: Higgsfield art is the owner's, under five rules
- [ ] The week of use on a Mac (§10 Phase 9). Blocked on the owner's machine, as before

**Higgsfield spend.** 11 generations, 19 credits (698.53 before, 679.53 after): five sprites,
two framed icon drafts, two medallions, two floor paintings. The drafts and the second of each pair were not used;
their job ids are in `PROVENANCE.md` so nothing is lost if one is wanted later.

**Checked in the binary.** `tauri build --debug --no-bundle`, run under `Xvfb` with a scratch
`GRIMOIRE_HOME`. This container arrived without WebKitGTK's development packages, so
`libwebkit2gtk-4.1-dev` and `libgtk-3-dev` were installed first; the earlier note that "the real
binary runs here" was true of a different container. Seen, in order: the first-light scene with
Pixi's unsafe-eval refusal written on it; then the plan drawn in code with the drawn figures and
the note "the quill familiar's portrait: Failed to load tauri://assets/quill-….png"; then the
painted floor with all five portraits at the hearth. Hovering Vellum showed the marginalia card,
and clicking opened the workspace with the painted floor as the strip above. A build with Pixi's
workers left on sat without familiars for eight seconds and then said "the painted floor: no
answer in 8s", which is the hang the limit exists for.

**A test that failed once.** The first full Playwright run had one failure: the terminal did
not echo typed text (`terminal.spec.ts`, desk). It did not come back in 60 isolated runs, in 26
more run while forcing the two things suspected of causing it (files being written under `src/`,
and 46 Tailwind CSS hot updates), or in two further full runs. No cause was found. It is written
down here rather than called a flake, because the last test in this repository that failed only
in a full run was a race that doubled every keystroke (DECISIONS 0019). If it is seen again, the
trace is the thing to keep.

At the end of this pass: 238 Rust tests (5 ignored, needing a live engine), 41 unit tests, 128
Playwright tests, clippy clean, typecheck clean, `bun run licences` and `bun run bindings:check`
leaving no diff, and the debug binary opening on the painted floor under `Xvfb`.

**Fixed at the owner's request: the floor re-baked on every pan at 1×.** `stage.ts` judged the
baked layer stale from the zoom, while `bake.ts` judged its labels from zoom × device pixels; on
a 1× display the two never agreed, and one drag and six wheel notches cost 13 to 15 full
re-bakes. The stage now decides the label band and hands it over, and the texture is sized for
the largest zoom so a zoom inside its band stays sharp without another bake. The test counts
bakes and failed on the old stage. Station labels now show at the default zoom on 1× displays,
as §8.3 says. DECISIONS 0022.


---

## Release 1.0.3

Cut from the merge of PR #1: the floor draws in a packaged build for the first time, with the
Higgsfield art, the composed icon and the 1× re-bake fix. Version bumped in `Cargo.toml`,
`Cargo.lock`, `package.json` and `tauri.conf.json`; the README's download links point at the
v1.0.3 assets. The debug binary of this commit was built and opened on the painted floor under
`Xvfb` before the release commit was made.

- [x] Version 1.0.3, merged to `claude/sharp-euler-l2gy92` as b687829 (#2)
- [ ] The tag. This session's GitHub access may push its working branch and nothing else: the
      tag push was refused with a 403. Create `v1.0.3` from GitHub's release form ("Choose a
      tag", target `claude/sharp-euler-l2gy92`), which tags that branch's tip and makes the
      release page in one step. Every commit from b687829 on is version 1.0.3.
- [ ] Installers. CI has not assigned a runner since 14 September (every run fails in seconds,
      before checkout), and this container cannot build for macOS. 1.0.1 and 1.0.2 were built
      and attached by hand; 1.0.3 needs the same: `bun run dist` on the Mac for both
      architectures, and the Windows build, attached as `Grimoire_1.0.3_aarch64.dmg`,
      `Grimoire_1.0.3_x64.dmg` and `Grimoire_1.0.3_x64-setup.exe` — the names the README links.

Release notes, for the release page:

> Grimoire 1.0.3
>
> The floor now draws in the packaged app. In 1.0.1 and 1.0.2 it never did: the renderer
> refused to start under the app's security policy, and you saw "The tower lost its lens"
> instead.
>
> - The floor is a top-down painting of the tower, aligned with the plan, so what you click
>   is where it is drawn. It pans and zooms with the room.
> - Five new familiar figures, one per order.
> - A new app icon: the Grimoire sigil as a brass medallion.
> - If any art fails to load, the floor is drawn in code and says what failed. If the floor
>   itself cannot start, it says why and offers the roster.
> - Panning and zooming no longer redraw the whole room on non-Retina displays, and station
>   labels now show at the default zoom there.
>
> Unsigned and not notarized: macOS may ask you to approve it in Privacy & Security on first
> launch.

---

## CI that can build the installers

CI had not run since 14 September. The one workflow built installers on two macOS runners and a
Windows runner for every push to every branch; on a private repository that bills at 10× and
2×, and the account's allowance was gone after nine runs. Every job since failed in seconds with
no runner and no log. DECISIONS 0023.

- [x] `ci.yml`: every push and pull request runs the whole suite on Linux, and never a Mac
- [x] `release.yml`: installers on a `v*` tag or by hand; version checked on Linux first; the
      `.dmg` ×2, `.exe` and `.msi` attached to a draft release for the owner to publish
- [x] `.github/release-notes/v1.0.3.md` holds the 1.0.3 notes the workflow uses
- [x] Both workflows pass actionlint; the version check was run against v1.0.3 (passes) and
      v1.0.4 (fails, naming both versions); the Linux job's steps were run in order in a fresh
      clone with `CI=1`
- [ ] Nothing has run on GitHub yet. The first CI run was one Linux job, and it was refused in
      two seconds like every Mac job before it, so the block is the whole account, not macOS.
      Actions needs its allowance back — the monthly reset, or a spending budget in the
      account's billing settings — before any job will start
- [ ] 1.0.3's installers: once Actions can run, **Actions → Release → Run workflow** with tag
      `v1.0.3` builds all three and makes a draft release; publishing it creates the tag

**The first real run.** With the repository public, runners were assigned at once. The version
check passed and all three installers built (Release run 36704551350, attempt 2); attaching them
failed on the Windows artifact's `nsis/` and `msi/` folders, after the draft "Grimoire 1.0.3" had
been made with both `.dmg`s on it. Fixed, and the upload step run locally against that exact
layout. A run by hand for an existing tag now builds the tagged commit.

- [ ] Rebuild 1.0.3: **Run workflow** on Release with `v1.0.3`, which fills in the `.exe` and
      `.msi` on the existing draft
- [ ] CLAUDE.md §1: the repository is public now, and §1 asks for a LICENSE and attribution pass
      when that happens. The README and `Cargo.toml` already say MIT; there is no LICENSE file


---

## Making it usable: delivery, one button, a tour, a bigger room

The owner's first real use: "it's very confusing how to use the summons and how to actually do
anything", and a bigger map with familiars that walk about. Asked, they chose a bigger room
painted fresh, and strolling near each familiar's own spot.

- [x] **A commission reaches its familiar.** It never did: it was written to the table, marked
      running, and not sent. Now it is the engine's first message at summon (`claude … -- <task>`),
      and typed in as a paste when handed to a familiar already running. Intake answers the task
      does not place are sent after it. DECISIONS 0024
- [x] **Mark done**, which hands the familiar the next in its queue in the same session, with
      each commission metered from its own start (`Usage::since`)
- [x] Tested through a real pty against a stand-in engine that prints its arguments and echoes
      its input: the task after `--`, a busy familiar refusing a second, the next handed over as
      one paste and then Enter, banish ending only the one in hand. `claude -p -- "-v …"`
      confirmed the engine reads a dash-led task after `--` as words
- [x] **One button** on the commission tab that says what it will do — *Summon and start*,
      *Start*, *Add to queue* — with *Queue for later* beside it, and a sentence above it saying
      what the familiar is doing with *Mark done* / *Watch it work* / *Open the seals*. The
      header's Summon summons and its Banish banishes
- [x] The terminal stays mounted while other tabs are open. Found by the new Playwright test:
      a commission handed over from the commission tab went into a terminal nobody was keeping
- [x] **The tour**, on first launch, and **How it works** in the rail: the six steps, every
      noun explained, how to read the floor, the tour again. DECISIONS 0026
- [x] **The bigger room**: 1600 units, painted by Higgsfield from a diagram of the new plan and
      registered to it; the plan's radii and candles measured back off the painting.
      PROVENANCE.md, DECISIONS 0025
- [x] **Wandering and animation**: idle familiars stroll their side of their desk, dormant ones
      the hearth; a gait counted in distance, turning to face the way they walk, breathing,
      nodding over the desk while working, shifting weight while waiting on a seal. Checked by
      unit tests that no patch reaches the ward circle, a desk, the wall or another's patch
- [x] Found on looking at it: the figures stand up out of the plan, and at the two north desks
      their heads were on the desktop. A test now fails if any figure reaches onto a desk
- [ ] A real `claude` taking a pasted commission mid-session — the container's engine will not
      run interactively. Try it on the Mac: give a summoned familiar a second commission

**Release.** 1.0.3 was built from before any of this, so these changes are 1.0.4: version bumped
in all three places, notes in `.github/release-notes/v1.0.4.md`, and the README's download links
pointing at v1.0.4. Built by Release run 36720186684 into a draft with all four installers.

The first 1.0.4 notes said 1.0.3 had never been published and repeated its changes. It had been:
the owner published it at 11:55 on 30 September, while this work was under way, and nothing here
checked the release's state again before writing the notes. Corrected in the notes file; the
draft's own copy is edited on the release page, which no tool in this session can change.

---

## The Mac app would not open

The owner downloaded 1.0.4 and macOS called it damaged. It had never been signed; DECISIONS 0027.

- [x] Ad-hoc signing (`signingIdentity: "-"`), per Tauri's documentation
- [x] The Release workflow verifies the app inside each `.dmg` before attaching anything
- [x] README and the 1.0.4 notes say how to open it the first time, and how to open 1.0.3
- [ ] Rebuild 1.0.4's installers with the fix, and open the new `.dmg` on the Mac
