import { describe, expect, test } from "bun:test";

import { glyphPath, hash, ringPath, sigilGeometry } from "../../ui/sigil-geometry";

const NAMES = ["Vellum", "Sconce", "Astrolabe", "Anvil", "Tally"];

describe("sigil geometry", () => {
  test("is deterministic", () => {
    expect(sigilGeometry("Vellum")).toEqual(sigilGeometry("Vellum"));
    expect(hash("Vellum")).toBe(hash("Vellum"));
  });

  test("four different names give four visibly different marks", () => {
    const shapes = NAMES.slice(0, 4).map((n) => {
      const g = sigilGeometry(n);
      return JSON.stringify([g.glyph, g.strokes.length, g.strokes.map((s) => Math.round(s.angle))]);
    });
    expect(new Set(shapes).size).toBe(4);
  });

  test("stroke count stays in the 3..7 band for a wide spread of names", () => {
    for (let i = 0; i < 400; i++) {
      const g = sigilGeometry(`familiar-${i}`);
      expect(g.strokes.length).toBeGreaterThanOrEqual(3);
      expect(g.strokes.length).toBeLessThanOrEqual(7);
      expect(g.glyph).toBeGreaterThanOrEqual(0);
      expect(g.glyph).toBeLessThan(8);
      for (const s of g.strokes) {
        expect(s.angle).toBeGreaterThanOrEqual(0);
        expect(s.angle).toBeLessThan(360);
        expect(s.outer).toBeGreaterThan(s.inner);
      }
    }
  });

  test("all eight glyphs and both ring forms produce usable paths", () => {
    for (let i = 0; i < 8; i++) expect(glyphPath(i)).toMatch(/^M /);
    expect(ringPath(38)).toContain("Z");
    expect(ringPath(38, 34)).not.toContain("Z"); // broken ring is an open arc
  });
});
