// Where a familiar may stroll while it has nothing to walk to (DECISIONS 0025).
//
// The owner asked for familiars that "walk around like normal, casually": idle ones pottering
// about near their own desk, dormant ones milling about the hearth. What they may not do is say
// something untrue about the room — §8.4 reads the floor by where a familiar stands — so each
// area is a patch of floor that belongs to the station it is already at, and nothing strays
// into the ward circle, onto a desk, or across to someone else's.
//
// Working familiars stay at their desks, and one waiting on a seal stays in the circle: those
// two positions *are* the information. So do familiars queued behind a desk, who are in a line.
//
// Pure data and arithmetic, like `plan.ts`, so the areas can be checked without a canvas.

import type { SigilState } from "@/lib/types";

import { HEARTH_ARC, type Point, at, deskInboard, station } from "./plan";

/** A patch of floor: an annular sector about the room's centre, in bearings and radii. */
export interface Area {
  /** Clockwise from `from` to `to`, in degrees. `to` may pass 360. */
  from: number;
  to: number;
  inner: number;
  outer: number;
}

/** How fast a stroll goes, in world units a second. Unhurried: a person crossing a study. */
export const STROLL_SPEED = 38;

/** How long a familiar stands between strolls, in ms: at least the first, up to both together. */
export const PAUSE_MIN = 2200;
export const PAUSE_SPREAD = 5200;

/** Two familiars never choose to stroll to within this of each other (§8.2: never overlap). */
export const PERSONAL_SPACE = 52;

/**
 * The patch of floor a familiar may stroll about, or null if it should stand still.
 *
 * `slotIndex` is its place at the station: at a desk only the two either side of it wander,
 * each on its own side, so they cannot meet in the middle.
 */
export function wanderArea(state: SigilState, stationId: string, slotIndex: number): Area | null {
  if (state === "dormant" && stationId === "hearth") {
    // In front of the fire, behind the Ledger desk and clear of both.
    // The inner edge clears the Ledger desk's corners, which a straight desk pushes out past a
    // curved line.
    return { from: 150, to: 210, inner: HEARTH_ARC - 22, outer: HEARTH_ARC + 26 };
  }
  if (state === "idle" && stationId.startsWith("desk-") && slotIndex < 2) {
    const s = station(stationId);
    const inboard = deskInboard(s);
    const side = slotIndex === 0 ? -1 : 1;
    // Its own side of the desk, from a little off the centre line to past the desk's end, and
    // from the chair out towards the middle of the room — never onto the desk itself.
    const near = s.bearing + side * 4.5;
    const far = s.bearing + side * 16;
    // Out to just past its own place, which sits a little further out than the desk's centre
    // line because it is off to one side.
    return { from: Math.min(near, far), to: Math.max(near, far), inner: inboard - 110, outer: inboard + 6 };
  }
  return null;
}

/** A point in the area. `rand` is 0..1 and called twice, so a seeded source gives a repeatable walk. */
export function pick(area: Area, rand: () => number): Point {
  const bearing = area.from + (area.to - area.from) * rand();
  // Uniform over the sector's area rather than its radius, or the inner edge would be crowded.
  const r2 = area.inner ** 2 + (area.outer ** 2 - area.inner ** 2) * rand();
  return at(bearing, Math.sqrt(r2));
}

/** A small seeded generator, so each familiar's strolls are its own and a reload repeats them. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
