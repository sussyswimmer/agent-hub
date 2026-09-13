// Deterministic sigil geometry (§7.4): a ring, 3–7 radial strokes, one interior glyph, derived
// from a hash of the familiar's name. Pure, so a test can assert that different names differ.

// Order and SigilState are defined once in Rust (crates/grimoire-core/src/types.rs) and
// generated into src/lib/generated. Re-exported here so the drawing code has one source.
export type { Order } from "@/lib/generated/Order";
export type { SigilState } from "@/lib/generated/SigilState";

import type { SigilState } from "@/lib/generated/SigilState";

export const ORDERS = ["quill", "lantern", "crucible", "compass", "ledger"] as const;

export interface Stroke {
  /** degrees, 0 = twelve o'clock */
  angle: number;
  /** distance from centre where the stroke starts, in viewBox units */
  inner: number;
  /** where it ends */
  outer: number;
  width: number;
}

export interface SigilGeometry {
  /** 3..7 */
  strokes: Stroke[];
  /** which interior mark, 0..7 */
  glyph: number;
  /** whole-sigil rotation offset in degrees */
  phase: number;
  ringRadius: number;
}

/** FNV-1a, 32-bit. Stable across runs and platforms, unlike a hashed object identity. */
export function hash(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A small deterministic sequence from one seed, so each geometry field gets its own draw. */
function* stream(seed: number): Generator<number> {
  let s = seed || 1;
  for (;;) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    yield s;
  }
}

export const RING_RADIUS = 38;

export function sigilGeometry(name: string): SigilGeometry {
  const g = stream(hash(name));
  const next = (n: number) => g.next().value % n;

  const count = 3 + next(5); // 3..7
  const phase = next(360);
  const strokes: Stroke[] = [];
  for (let i = 0; i < count; i++) {
    // Even spokes, nudged so the mark never looks machined.
    const base = (360 / count) * i;
    strokes.push({
      angle: (base + phase + next(11) - 5 + 360) % 360,
      inner: 17 + next(8),
      outer: RING_RADIUS + 2 + next(9),
      // Heavy enough to survive an 18px render: at that size one viewBox unit is 0.18 device px.
      width: 3 + next(4),
    });
  }
  return { strokes, glyph: next(8), phase, ringRadius: RING_RADIUS };
}

/** Polar to cartesian in a viewBox centred on the origin, 0° at twelve o'clock. */
export function polar(angleDeg: number, r: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

/**
 * The ring as an arc path. `gap` in degrees leaves it broken at one point (§7.4 banished).
 * Drawn as a path rather than a circle so the gap is a parameter, not a second code path.
 */
export function ringPath(r: number, gap = 0): string {
  if (gap <= 0) {
    return `M 0 ${-r} A ${r} ${r} 0 1 1 -0.01 ${-r} Z`;
  }
  const [sx, sy] = polar(gap / 2, r);
  const [ex, ey] = polar(360 - gap / 2, r);
  return `M ${sx.toFixed(3)} ${sy.toFixed(3)} A ${r} ${r} 0 1 1 ${ex.toFixed(3)} ${ey.toFixed(3)}`;
}

/**
 * One stroke of an interior mark: a run of points, open or closed.
 *
 * Polylines rather than arcs, and this is the reason: the rail draws sigils as SVG and the floor
 * draws them as WebGL geometry (§8.3). Two renderers describing the same eight marks in two
 * notations is two chances to disagree, and a familiar whose glyph changes when you look at it
 * from the floor is a bug nobody would think to test for. Both read this.
 */
export interface Mark {
  points: [number, number][];
  close: boolean;
}

/** Sample a circular or elliptical arc, in the same 0° = twelve o'clock frame as `polar`. */
function sweep(fromDeg: number, toDeg: number, rx: number, ry: number, steps = 24): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const deg = fromDeg + ((toDeg - fromDeg) * i) / steps;
    const a = ((deg - 90) * Math.PI) / 180;
    out.push([rx * Math.cos(a), ry * Math.sin(a)]);
  }
  return out;
}

/** One of eight interior marks. No text glyphs, no font dependency, no asset (§1). */
export function glyphMarks(which: number): Mark[] {
  const r = 14;
  switch (which % 8) {
    case 0:
      // upward triangle
      return [{ points: [polar(0, r), polar(120, r), polar(240, r)], close: true }];
    case 1:
      // lozenge
      return [{ points: [[0, -r], [r, 0], [0, r], [-r, 0]], close: true }];
    case 2:
      // crescent: a circle's left edge, cut back by a narrower ellipse
      return [{ points: [...sweep(0, -180, r, r), ...sweep(180, 360, r * 0.62, r)], close: true }];
    case 3:
      // cross of four bars
      return [
        { points: [[0, -r], [0, r]], close: false },
        { points: [[-r, 0], [r, 0]], close: false },
      ];
    case 4:
      // chevron
      return [{ points: [[-r, r * 0.45], [0, -r * 0.55], [r, r * 0.45]], close: false }];
    case 5:
      // ring
      return [{ points: sweep(0, 360, r, r), close: true }];
    case 6:
      // bar over dot
      return [
        { points: [[-r, -r * 0.35], [r, -r * 0.35]], close: false },
        { points: sweep(0, 360, 2.2, 2.2, 12).map(([x, y]) => [x, y + r * 0.45] as [number, number]), close: true },
      ];
    default:
      // square cornered to the compass points, barred across
      return [
        { points: [[0, -r], [r, 0], [0, r], [-r, 0]], close: true },
        { points: [[-r * 0.45, 0], [r * 0.45, 0]], close: false },
      ];
  }
}

/** The same marks as an SVG `d`, for the rail. Built from `glyphMarks`, never beside it. */
export function glyphPath(which: number): string {
  return glyphMarks(which)
    .map(({ points, close }) => {
      const [first, ...rest] = points;
      if (!first) return "";
      const head = `M ${first[0].toFixed(2)} ${first[1].toFixed(2)}`;
      const body = rest.map(([x, y]) => `L ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
      return `${head} ${body}${close ? " Z" : ""}`;
    })
    .filter(Boolean)
    .join(" ");
}

/** Whether a state paints the sigil in oxblood and breaks the ring (§7.4). */
export function isBroken(state: SigilState): boolean {
  return state === "banished" || state === "misfired";
}

/**
 * Seconds per revolution while the ring turns, or `null` when it is still.
 * Working is 8s (§7.4); stalled slows to 30s so a stuck familiar reads as stuck (§8.3).
 */
export function ringPeriod(state: SigilState): number | null {
  if (state === "working") return 8;
  if (state === "stalled") return 30;
  return null;
}
