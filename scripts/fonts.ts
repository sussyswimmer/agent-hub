#!/usr/bin/env bun
// Vendors the three faces from §7.3 into src/theme/fonts/ as woff2. No CDN at runtime.
//
//   bun run fonts
//
// EB Garamond and Iosevka come from @fontsource (OFL-1.1, ships woff2 + LICENSE) and are
// committed, so a clean clone already has them and running this is optional.
// Junicode 2 ships its webfonts only in GitHub release archives. Where those are reachable
// this fetches them; where they are not (a sandbox with no github.com egress) it says so and
// leaves the face absent, and the display stack falls through to EB Garamond. Either way the
// last thing this writes is src/theme/fonts/vendored.css, holding the Junicode @font-face when
// the woff2 is there and nothing when it is not — a rule pointing at a missing file is a build
// error, so the file and the rule have to appear together.
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

const PREAMBLE = `/* Written by \`bun run fonts\`. Committed so the build never points at a file that is not there.

   Everything §7.3 asks for that could be vendored is declared in ../fonts.css directly. This
   file holds only the faces whose presence depends on where \`bun run fonts\` was run — today
   that is Junicode, which ships its webfonts in GitHub release archives and so is absent from
   any checkout made without github.com access. Run \`bun run fonts\` on a machine that has it
   and the rule appears below; run it on one that does not and this file returns to a comment.
   See DECISIONS.md 0003. */
`;

const JUNICODE_FACE = `
@font-face {
  font-family: "Junicode";
  src: url("./junicode-400-normal.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
`;

/**
 * Rewrites the generated stylesheet so it declares exactly the optional faces that are on disk.
 * Called on every run, the failing ones included: a stale rule left behind after its woff2 has
 * gone breaks the build just as surely as a missing rule leaves the face unused.
 */
function writeVendoredCss(present: boolean): void {
  writeFileSync(join(OUT, "vendored.css"), present ? PREAMBLE + JUNICODE_FACE : PREAMBLE);
}

mkdirSync(OUT, { recursive: true });
const garamond = await fromFontsource("eb-garamond", "eb-garamond");
const iosevka = await fromFontsource("iosevka", "iosevka");
const junicode = await fetchJunicode();
writeVendoredCss(existsSync(join(OUT, "junicode-400-normal.woff2")));
rmSync(TMP, { recursive: true, force: true });

console.log(`eb-garamond  ${garamond} files`);
console.log(`iosevka      ${iosevka} files`);
console.log(`junicode     ${junicode} files`);
if (junicode === 0) {
  console.log(
    "\nJunicode was not reachable. Display type falls back to EB Garamond until you re-run\n" +
      "`bun run fonts` somewhere with github.com access, or drop Junicode.woff2 into\n" +
      "src/theme/fonts/junicode-400-normal.woff2 yourself and re-run this to declare it.\n" +
      "See DECISIONS.md 0003.",
  );
}
if (garamond === 0 || iosevka === 0) process.exitCode = 1;
