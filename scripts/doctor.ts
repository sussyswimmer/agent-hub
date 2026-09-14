#!/usr/bin/env bun
/**
 * Says whether this machine can build and run Grimoire, and what to do about each thing that
 * cannot.
 *
 *   bun run doctor
 *
 * This is the thing to run when something does not start. It reads; it never installs, never
 * writes to `~/.grimoire`, and never touches the network (§11). Lines are written to §3's
 * voice: what happened, and what to do about it — never "something went wrong."
 *
 * Exit code is 1 when a requirement is missing, 0 when only the optional things are.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = process.env.GRIMOIRE_HOME || join(homedir(), ".grimoire");
const MAC = platform() === "darwin";

type Verdict = "found" | "missing" | "absent";

interface Check {
  /** What is being looked for, in the same nouns the rest of the app uses. */
  what: string;
  verdict: Verdict;
  /** Present tense on a "found", the remedy on anything else. */
  note: string;
}

const checks: Check[] = [];

function found(what: string, note: string) {
  checks.push({ what, verdict: "found", note });
}
/** Required: the build or the app does not work without it. */
function missing(what: string, note: string) {
  checks.push({ what, verdict: "missing", note });
}
/** Optional: Grimoire runs, with less in it. */
function absent(what: string, note: string) {
  checks.push({ what, verdict: "absent", note });
}

/** First line of a command's output, or null when the command is not there or fails. */
function ask(cmd: string, args: string[]): string | null {
  try {
    const out = execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n")[0]!.trim() || null;
  } catch {
    return null;
  }
}

/** Where a binary is on PATH, resolved the way the summoner resolves it (summon/binary.rs). */
function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":").filter(Boolean)) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ── What the build needs ───────────────────────────────────────────────────────────────

const cargo = ask("cargo", ["--version"]);
if (cargo) found("Rust", cargo);
else
  missing(
    "Rust",
    "`cargo` isn't on your PATH. Install stable Rust from https://rustup.rs, then open a new shell.",
  );

found("Bun", `bun ${Bun.version}`);

if (MAC) {
  const sdk = ask("xcode-select", ["-p"]);
  if (sdk) found("Xcode command line tools", sdk);
  else
    missing(
      "Xcode command line tools",
      "Tauri builds against the system webview and needs them. Run `xcode-select --install`.",
    );
} else {
  absent(
    "Xcode command line tools",
    `Not checked — this is ${platform()}, not macOS. Grimoire is built for macOS first (§2).`,
  );
}

if (existsSync(join(ROOT, "node_modules"))) found("Dependencies", "node_modules is in place.");
else missing("Dependencies", "Run `bun install` in the repository root.");

// ── What the build generates ───────────────────────────────────────────────────────────

const ICONS = join(ROOT, "src-tauri", "icons");
const WANTED = ["32x32.png", "128x128.png", "icon.icns", "icon.ico"];
const drawn = WANTED.filter((f) => existsSync(join(ICONS, f)));
if (drawn.length === WANTED.length) found("Application mark", `${drawn.length} files in src-tauri/icons.`);
else
  // Not fatal here, because `bun run tauri dev` draws them on the way past. Worth saying when
  // someone is reading this because a build failed on a missing icon.
  absent(
    "Application mark",
    "Not drawn yet. `bun run tauri dev` draws it for you; `bun run icons` does it now.",
  );

const FONTS = join(ROOT, "src", "theme", "fonts");
const faces = existsSync(FONTS) ? readdirSync(FONTS).filter((f) => f.endsWith(".woff2")) : [];
const junicode = faces.includes("junicode-400-normal.woff2");
if (faces.length === 0)
  missing("Typefaces", "src/theme/fonts is empty. Run `bun run fonts` to vendor them.");
else if (junicode) found("Typefaces", `${faces.length} faces, Junicode among them.`);
else
  absent(
    "Typefaces",
    `${faces.length} faces. Junicode isn't one of them, so display sizes are EB Garamond. ` +
      "Run `bun run fonts` on a machine that can reach github.com to add it (DECISIONS.md 0003).",
  );

// ── What running it needs ──────────────────────────────────────────────────────────────

const claude = onPath("claude");
if (claude) found("The `claude` engine", claude);
else
  absent(
    "The `claude` engine",
    "The `claude` binary isn't on your PATH. Grimoire still opens; Summon is disabled with the " +
      "reason on hover until you install it or set its location in the workbench.",
  );

if (existsSync(HOME)) {
  const dir = join(HOME, "bindings");
  const bound = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".binding.md")) : [];
  found("Your study", `${HOME} — ${bound.length} ${bound.length === 1 ? "binding" : "bindings"}.`);
} else {
  absent("Your study", `${HOME} doesn't exist yet. The first run creates it and places the five seeds.`);
}

// ── Say it ─────────────────────────────────────────────────────────────────────────────

const MARK: Record<Verdict, string> = { found: "·", missing: "✗", absent: "–" };
const width = Math.max(...checks.map((c) => c.what.length));

for (const c of checks) {
  console.log(`${MARK[c.verdict]} ${c.what.padEnd(width)}  ${c.note}`);
}

const blocked = checks.filter((c) => c.verdict === "missing");
console.log("");
if (blocked.length === 0) {
  console.log("Nothing is in the way. `bun run tauri dev` opens the study.");
} else {
  const list = blocked.map((c) => c.what).join(", ");
  console.log(`${blocked.length === 1 ? "One thing is" : `${blocked.length} things are`} missing: ${list}.`);
  console.log("Grimoire will not build until each line marked ✗ above is dealt with.");
  process.exitCode = 1;
}
