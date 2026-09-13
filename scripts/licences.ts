/**
 * Regenerates THIRD-PARTY.md from the two lockfiles.
 *
 * CLAUDE.md §1: "Third-party libraries keep their licences. Maintain THIRD-PARTY.md listing
 * every runtime dependency and its licence." Runtime means what ships inside the app, so
 * dev-only and build-only dependencies are walked over, not listed.
 *
 * `bun run licences` should leave no diff. If it does, a dependency moved and the file is stale.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Entry {
  name: string;
  version: string;
  licence: string;
}

const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name);

// ── Rust ───────────────────────────────────────────────────────────────────────────────

/**
 * Walks the resolved graph from the workspace members, following normal dependencies only.
 * Dev-dependencies (test harnesses) and build-dependencies (codegen that runs once on this
 * machine) never reach the shipped binary, so they are out of scope.
 */
function rustCrates(): Entry[] {
  const meta = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--all-features"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    }),
  );

  const nodes = new Map<string, any>(meta.resolve.nodes.map((n: any) => [n.id, n]));
  const pkgs = new Map<string, any>(meta.packages.map((p: any) => [p.id, p]));
  const members: string[] = meta.workspace_members;

  const seen = new Set<string>();
  const queue = [...members];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      // dep_kinds carries one entry per (kind, target). kind is null for a normal dependency.
      const normal = (dep.dep_kinds ?? []).some((k: any) => k.kind == null);
      if (normal) queue.push(dep.pkg);
    }
  }

  const out: Entry[] = [];
  for (const id of seen) {
    if (members.includes(id)) continue; // our own crates
    const p = pkgs.get(id);
    if (!p) continue;
    out.push({
      name: p.name,
      version: p.version,
      licence: p.license ?? (p.license_file ? `see ${p.license_file}` : "unstated"),
    });
  }
  return out.sort(byName);
}

// ── npm ────────────────────────────────────────────────────────────────────────────────

/** bun.lock is JSONC: it carries trailing commas. */
function readLock(path: string): any {
  return JSON.parse(readFileSync(path, "utf8").replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * Walks the `dependencies` closure of the root workspace. devDependencies are the toolchain
 * (Vite, Playwright, the Tauri CLI); none of them is served to the user.
 */
function npmPackages(): Entry[] {
  const lock = readLock(join(ROOT, "bun.lock"));
  const root = lock.workspaces[""] ?? {};

  // key → [descriptor, registry, meta, integrity]
  const entries = new Map<string, any[]>(Object.entries(lock.packages ?? {}));

  const seen = new Set<string>();
  const queue = Object.keys(root.dependencies ?? {});
  while (queue.length) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    const row = entries.get(name);
    if (!row) continue;
    seen.add(name);
    for (const d of Object.keys(row[2]?.dependencies ?? {})) queue.push(d);
  }

  const out: Entry[] = [];
  for (const name of seen) {
    const descriptor: string = entries.get(name)![0];
    const version = descriptor.slice(descriptor.lastIndexOf("@") + 1);
    out.push({ name, version, licence: npmLicence(name) });
  }
  return out.sort(byName);
}

/** The lockfile does not record licences, so read each package's own manifest. */
function npmLicence(name: string): string {
  const manifest = join(ROOT, "node_modules", name, "package.json");
  if (!existsSync(manifest)) return "unstated (not installed)";
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l: any) => l.type ?? l).join(" OR ");
  return "unstated";
}

// ── Fonts ──────────────────────────────────────────────────────────────────────────────

/**
 * The vendored faces are not in either lockfile: scripts/fonts.ts copies the woff2 out of
 * node_modules into src/theme/fonts/ so nothing is fetched at runtime. They still need listing.
 */
const FONTS: [string, string, string][] = [
  ["EB Garamond", "OFL-1.1", "src/theme/fonts/eb-garamond.LICENSE.txt"],
  ["Iosevka", "OFL-1.1", "src/theme/fonts/iosevka.LICENSE.txt"],
];

// ── Write ──────────────────────────────────────────────────────────────────────────────

function table(rows: Entry[]): string {
  return [
    "| Package | Version | Licence |",
    "| --- | --- | --- |",
    ...rows.map((r) => `| \`${r.name}\` | ${r.version} | ${r.licence} |`),
  ].join("\n");
}

const rust = rustCrates();
const npm = npmPackages();

const doc = `# Third-party licences

Generated by \`bun run licences\`. Do not edit by hand; edit \`scripts/licences.ts\` and re-run.

Only **runtime** dependencies are listed: what ships inside the application. Dev-dependencies
(the test harnesses) and build-dependencies (code generation that runs once on the build
machine) are excluded, because they are not distributed.

Grimoire itself is MIT. No art assets are vendored from anywhere: every mark in the interface
is drawn in code (see \`src/ui/sigil-geometry.ts\` and \`scripts/icons.ts\`).

## Typefaces

Vendored as woff2 into \`src/theme/fonts/\` by \`bun run fonts\`, so the app makes no network
request for type. Each licence text sits beside its files.

| Face | Licence | Text |
| --- | --- | --- |
${FONTS.map(([n, l, p]) => `| ${n} | ${l} | \`${p}\` |`).join("\n")}

## Rust crates (${rust.length})

${table(rust)}

## npm packages (${npm.length})

${table(npm)}
`;

writeFileSync(join(ROOT, "THIRD-PARTY.md"), doc);
console.log(`THIRD-PARTY.md: ${rust.length} crates, ${npm.length} npm packages, ${FONTS.length} faces.`);
