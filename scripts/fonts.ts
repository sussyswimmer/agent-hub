#!/usr/bin/env bun
// Vendors the three faces from §7.3 into src/theme/fonts/ as woff2. No CDN at runtime.
//
//   bun run fonts
//
// EB Garamond and Iosevka come from @fontsource (OFL-1.1, ships woff2 + LICENSE).
// Junicode 2 ships its webfonts only in GitHub release archives. Where those are reachable
// this fetches them; where they are not (a sandbox with no github.com egress) it says so and
// leaves the face absent, and the @font-face stack falls through to EB Garamond. Re-run this
// on a machine with github.com access and Junicode appears with no code change.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "src", "theme", "fonts");
const TMP = join(ROOT, "target", "font-fetch");

// Only the cuts the design actually uses. Iosevka's latin subset is ~1 MB per file, so the
// terminal gets regular and bold and nothing else.
const CUTS: Record<string, string[]> = {
  "eb-garamond": ["400-normal", "400-italic", "600-normal"],
  iosevka: ["400-normal", "700-normal"],
};

async function sh(cmd: string[], cwd: string): Promise<boolean> {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  return (await p.exited) === 0;
}

/** npm pack a fontsource package and copy its latin woff2 + LICENSE into src/theme/fonts. */
async function fromFontsource(pkg: string, family: string): Promise<number> {
  mkdirSync(TMP, { recursive: true });
  if (!(await sh(["npm", "pack", `@fontsource/${pkg}@5.3.0`], TMP))) {
    console.error(`  ${family}: npm pack failed`);
    return 0;
  }
  const tgz = readdirSync(TMP).find((f) => f.startsWith(`fontsource-${pkg}-`) && f.endsWith(".tgz"));
  if (!tgz) return 0;
  const dir = join(TMP, pkg);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (!(await sh(["tar", "xzf", join(TMP, tgz), "-C", dir], TMP))) return 0;

  let n = 0;
  for (const cut of CUTS[pkg] ?? []) {
    const src = join(dir, "package", "files", `${pkg}-latin-${cut}.woff2`);
    if (!existsSync(src)) continue;
    writeFileSync(join(OUT, `${family}-${cut}.woff2`), readFileSync(src));
    n++;
  }
  const lic = join(dir, "package", "LICENSE");
  if (existsSync(lic)) writeFileSync(join(OUT, `${family}.LICENSE.txt`), readFileSync(lic));
  return n;
}

/** Junicode 2's webfonts live in release archives; try the documented locations. */
async function fetchJunicode(): Promise<number> {
  const candidates = [
    "https://raw.githubusercontent.com/psb1558/Junicode-font/master/dist/Junicode.woff2",
    "https://raw.githubusercontent.com/psb1558/Junicode-font/master/fonts/webfonts/Junicode.woff2",
    "https://github.com/psb1558/Junicode-font/releases/latest/download/Junicode.woff2",
  ];
  for (const url of candidates) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      // woff2 files begin with the signature "wOF2".
      if (buf.length < 4 || String.fromCharCode(...buf.slice(0, 4)) !== "wOF2") continue;
      writeFileSync(join(OUT, "junicode-400-normal.woff2"), buf);
      return 1;
    } catch {
      /* next candidate */
    }
  }
  // The licence is in the source tree even when the built fonts are not.
  try {
    const r = await fetch("https://raw.githubusercontent.com/psb1558/Junicode-font/master/OFL.txt");
    if (r.ok) writeFileSync(join(OUT, "junicode.LICENSE.txt"), await r.text());
  } catch {
    /* offline */
  }
  return 0;
}

mkdirSync(OUT, { recursive: true });
const garamond = await fromFontsource("eb-garamond", "eb-garamond");
const iosevka = await fromFontsource("iosevka", "iosevka");
const junicode = await fetchJunicode();
rmSync(TMP, { recursive: true, force: true });

console.log(`eb-garamond  ${garamond} files`);
console.log(`iosevka      ${iosevka} files`);
console.log(`junicode     ${junicode} files`);
if (junicode === 0) {
  console.log(
    "\nJunicode was not reachable. Display type falls back to EB Garamond until you re-run\n" +
      "`bun run fonts` somewhere with github.com access, or drop Junicode.woff2 into\n" +
      "src/theme/fonts/junicode-400-normal.woff2 yourself. See DECISIONS.md 0003.",
  );
}
if (garamond === 0 || iosevka === 0) process.exitCode = 1;
