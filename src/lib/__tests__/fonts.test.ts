// §7.3 self-hosts every face, so every url() in the theme has to name a file that is really
// there. Phase 7 shipped the opposite mistake: the woff2 Junicode arrived as, and the rule
// that would have used it, were two separate things, and `bun run fonts` could place the file
// and change nothing. These walk the real stylesheets, so they track the files rather than a
// copy of them.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const THEME = join(import.meta.dir, "../../theme");
const SHEETS = [join(THEME, "fonts.css"), join(THEME, "fonts", "vendored.css")];

/** Every `url("…")` in a stylesheet, resolved against the stylesheet's own directory. */
function referenced(sheet: string): string[] {
  const css = readFileSync(sheet, "utf8");
  return [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) =>
    resolve(dirname(sheet), m[1]!),
  );
}

/** Every `@font-face` family named by a stylesheet. */
function families(sheet: string): string[] {
  const css = readFileSync(sheet, "utf8");
  return [...css.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

describe("the vendored faces", () => {
  test("every url() in the theme resolves to a file that exists", () => {
    for (const sheet of SHEETS) {
      for (const file of referenced(sheet)) {
        expect({ sheet, file, exists: existsSync(file) }).toEqual({ sheet, file, exists: true });
      }
    }
  });

  test("the faces §7.3 names are the only ones declared", () => {
    const declared = new Set(SHEETS.flatMap(families));
    for (const family of declared) {
      expect(["Junicode", "EB Garamond", "Iosevka"]).toContain(family);
    }
    // The two that are committed must always be declared; Junicode depends on where
    // `bun run fonts` was last run, and the first test covers whichever way that went.
    expect(declared.has("EB Garamond")).toBe(true);
    expect(declared.has("Iosevka")).toBe(true);
  });

  test("fonts.css pulls in the generated sheet, or a fetched Junicode would go unused", () => {
    expect(readFileSync(join(THEME, "fonts.css"), "utf8")).toContain(
      '@import "./fonts/vendored.css"',
    );
  });

  test("a placed woff2 and its @font-face are one event", () => {
    // The bug this pins: the file arriving without the rule. Junicode is the only optional
    // face, so if its woff2 is on disk, vendored.css must declare it.
    const woff2 = join(THEME, "fonts", "junicode-400-normal.woff2");
    const declared = families(join(THEME, "fonts", "vendored.css")).includes("Junicode");
    expect(declared).toBe(existsSync(woff2));
  });
});
