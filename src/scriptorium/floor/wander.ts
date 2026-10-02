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

import { CENTRE, DESK_SIDE, HEARTH_ARC, SIGIL_SIZE, type Point, alongDesk, at, deskInboard, station } from "./plan";

/**
 * A patch of floor. Either an annular sector about the room's centre, in bearings and radii, or
 * a rectangle set out against a desk: `u` along it and `v` out from the centre (`alongDesk`).
 */
export type Area =
  | {
      kind: "sector";
      /** Clockwise from `from` to `to`, in degrees. `to` may pass 360. */
      from: number;
      to: number;
      inner: number;
      outer: number;
    }
  | { kind: "desk"; station: string; u0: number; u1: number; v0: number; v1: number };

/** How fast a stroll goes, in world units a second. Unhurried: a person crossing a study. */
export const STROLL_SPEED = 52;

/** How long a familiar stands between strolls, in ms: at least the first, up to both together. */
export const PAUSE_MIN = 2200;
export const PAUSE_SPREAD = 5200;

/** Two familiars never choose to stroll to within this of each other (§8.2: never overlap). */
export const PERSONAL_SPACE = SIGIL_SIZE + 10;

/**
 * The patch of floor a familiar may stroll about, or null if it should stand still.
 *
 * `slotIndex` is its place at the station: at a desk only the two either side of it wander,
 * each on its own side, so they cannot meet in the middle. At the hearth, likewise, each keeps
 * to its own side of the Ledger desk.
 */
export function wanderArea(state: SigilState, stationId: string, slotIndex: number): Area | null {
  if (state === "dormant" && stationId === "hearth") {
    // Beside the fire, either side of the Ledger desk and clear of it, heads and all: the gap
    // straight between the desk and the fire is shallower than a familiar is tall.
    const side = slotIndex % 2 === 0 ? -1 : 1;
    const near = 180 + side * 14;
    const far = 180 + side * 44;
    return { kind: "sector", from: Math.min(near, far), to: Math.max(near, far), inner: HEARTH_ARC - 20, outer: HEARTH_ARC + 28 };
  }
  if (state === "idle" && stationId.startsWith("desk-") && slotIndex < 2) {
    const inboard = deskInboard(station(stationId));
    const side = slotIndex === 0 ? -1 : 1;
    // Its own side of the desk, from a little off the middle to its end, and from the chair out
    // towards the middle of the room. Never onto the desk: the far edge is where it stands to
    // work, which is already set back by its own height from a desk to its north. No further
    // round than that, or the two desks either side of the door meet in front of it.
    const near = side * (DESK_SIDE - 26);
    const far = side * (DESK_SIDE + 40);
    return {
      kind: "desk",
      station: stationId,
      u0: Math.min(near, far),
      u1: Math.max(near, far),
      v0: inboard - 90,
      v1: inboard + 6,
    };
  }
  return null;
}

/** A point in the area. `rand` is 0..1 and called twice, so a seeded source gives a repeatable walk. */
export function pick(area: Area, rand: () => number): Point {
  if (area.kind === "desk") {
    const u = area.u0 + (area.u1 - area.u0) * rand();
    const v = area.v0 + (area.v1 - area.v0) * rand();
    return alongDesk(station(area.station), u, v);
  }
  const bearing = area.from + (area.to - area.from) * rand();
  // Uniform over the sector's area rather than its radius, or the inner edge would be crowded.
  const r2 = area.inner ** 2 + (area.outer ** 2 - area.inner ** 2) * rand();
  return at(bearing, Math.sqrt(r2));
}

/** Whether a point is in the area, give or take a hair for rounding. */
export function contains(area: Area, p: Point): boolean {
  const e = 0.01;
  const rx = p.x - CENTRE.x;
  const ry = p.y - CENTRE.y;
  if (area.kind === "desk") {
    // Undo `alongDesk`: v is the part of the offset out from the centre on the desk's bearing,
    // u the part along the desk.
    const t = (station(area.station).bearing * Math.PI) / 180;
    const v = rx * Math.sin(t) - ry * Math.cos(t);
    const u = rx * Math.cos(t) + ry * Math.sin(t);
    return u >= area.u0 - e && u <= area.u1 + e && v >= area.v0 - e && v <= area.v1 + e;
  }
  const r = Math.hypot(rx, ry);
  const bearing = ((Math.atan2(rx, -ry) * 180) / Math.PI + 360) % 360;
  return r >= area.inner - e && r <= area.outer + e && bearing >= area.from - e && bearing <= area.to + e;
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
