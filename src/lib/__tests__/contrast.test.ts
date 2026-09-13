// §7.2 is non-negotiable and must be measured, not eyeballed. This parses the real tokens.css
// so the assertion tracks the file rather than a copy of it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const CSS = readFileSync(join(import.meta.dir, "../../theme/tokens.css"), "utf8");

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(CSS);
  if (!m) throw new Error(`token --${name} not found in tokens.css`);
  return m[1]!.toLowerCase();
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("§7.2 contrast", () => {
  test("known pair sanity: black on white is 21:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  test("bone on ink-void is at least 7:1", () => {
    expect(contrast(token("bone"), token("ink-void"))).toBeGreaterThanOrEqual(7);
  });

  test("bone-dim on ink-void is at least 4.5:1", () => {
    expect(contrast(token("bone-dim"), token("ink-void"))).toBeGreaterThanOrEqual(4.5);
  });

  test("body text also clears on the raised surface", () => {
    expect(contrast(token("bone"), token("ink-panel"))).toBeGreaterThanOrEqual(7);
    expect(contrast(token("bone-dim"), token("ink-panel"))).toBeGreaterThanOrEqual(4.5);
  });

  test("every state colour used as text has a variant clearing 4.5:1 on both surfaces", () => {
    for (const name of ["brass", "verdigris", "oxblood", "slate"]) {
      const text = token(`${name}-text`);
      expect(contrast(text, token("ink-void"))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(text, token("ink-panel"))).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("the saturated oxblood is not accidentally used as a text token", () => {
    // It reads at 1.8:1 — it is a fill and rule colour only. This guards a tempting mistake.
    expect(contrast(token("oxblood"), token("ink-void"))).toBeLessThan(4.5);
    expect(token("oxblood-text")).not.toBe(token("oxblood"));
  });
});
