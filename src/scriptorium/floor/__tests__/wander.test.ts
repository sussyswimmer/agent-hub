// Strolling must not say anything untrue about the room (§8.4): nobody wanders into the ward
// circle, onto a desk, out of the room, or into someone else's patch.

import { describe, expect, test } from "bun:test";

import type { SigilState } from "@/lib/types";

import { CENTRE, ORDERS, SIGIL_SIZE, WALL_INNER, WARD_RADIUS, deskCorners, distance, slot, station } from "../plan";
import { PERSONAL_SPACE, contains, pick, seeded, wanderArea } from "../wander";
import { reachesDesk } from "./figure";

/** Whether a point is on a desk, or within a sigil's half-width of one. */
function onDesk(p: { x: number; y: number }, order: (typeof ORDERS)[number]): boolean {
  const s = station(`desk-${order}`);
  const [a, b, , d] = deskCorners(s);
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const vx = d.x - a.x;
  const vy = d.y - a.y;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  const pu = ((p.x - a.x) * ux + (p.y - a.y) * uy) / lu;
  const pv = ((p.x - a.x) * vx + (p.y - a.y) * vy) / lv;
  const m = SIGIL_SIZE / 2;
  return pu > -m && pu < lu + m && pv > -m && pv < lv + m;
}

const samples = (state: SigilState, stationId: string, index: number, n = 400) => {
  const area = wanderArea(state, stationId, index);
  if (!area) return [];
  const rand = seeded(7 + index);
  return Array.from({ length: n }, () => pick(area, rand));
};

describe("who wanders", () => {
  test("working, waiting on a seal, bound and stalled familiars stand still", () => {
    for (const order of ORDERS) {
      for (const state of ["working", "bound", "stalled", "misfired"] as SigilState[]) {
        expect(wanderArea(state, `desk-${order}`, 0)).toBeNull();
      }
    }
    expect(wanderArea("awaiting-seal", "ward", 0)).toBeNull();
    expect(wanderArea("banished", "door", 0)).toBeNull();
  });

  test("a familiar queued behind a desk stays in the line", () => {
    expect(wanderArea("idle", "desk-quill", 2)).toBeNull();
  });

  test("idle familiars at their desks and dormant ones at the hearth do wander", () => {
    expect(wanderArea("idle", "desk-quill", 0)).not.toBeNull();
    expect(wanderArea("idle", "desk-quill", 1)).not.toBeNull();
    expect(wanderArea("dormant", "hearth", 4)).not.toBeNull();
  });
});

describe("where they go", () => {
  const cases: [SigilState, string, number][] = [
    ["dormant", "hearth", 0],
    ...ORDERS.flatMap((o): [SigilState, string, number][] => [
      ["idle", `desk-${o}`, 0],
      ["idle", `desk-${o}`, 1],
    ]),
  ];

  test("never out of the room, into the ward circle, or onto any desk", () => {
    for (const [state, id, index] of cases) {
      for (const p of samples(state, id, index)) {
        expect(distance(p, CENTRE) + SIGIL_SIZE / 2).toBeLessThan(WALL_INNER);
        expect(distance(p, CENTRE) - SIGIL_SIZE / 2).toBeGreaterThan(WARD_RADIUS);
        for (const order of ORDERS) expect(onDesk(p, order)).toBe(false);
      }
    }
  });

  test("the two either side of a desk each keep to their own side", () => {
    for (const order of ORDERS) {
      const left = samples("idle", `desk-${order}`, 0, 150);
      const right = samples("idle", `desk-${order}`, 1, 150);
      let closest = Infinity;
      for (const a of left) for (const b of right) closest = Math.min(closest, distance(a, b));
      expect(closest).toBeGreaterThanOrEqual(SIGIL_SIZE);
    }
  });

  test("a familiar's own resting place is inside the patch it wanders", () => {
    // So a stroll never has to leave the patch to get home.
    for (const [state, id, index] of cases) {
      expect(contains(wanderArea(state, id, index)!, slot(station(id), index))).toBe(true);
    }
  });

  test("nobody strolls with its head on a desk", () => {
    for (const [state, id, index] of cases) {
      for (const p of samples(state, id, index, 200)) expect(reachesDesk(p)).toBe(false);
    }
  });

  test("the patch is where it says it is", () => {
    for (const [state, id, index] of cases) {
      const area = wanderArea(state, id, index)!;
      for (const p of samples(state, id, index, 50)) expect(contains(area, p)).toBe(true);
    }
  });

  test("patches of different desks are far apart", () => {
    const all = ORDERS.flatMap((o) => [0, 1].map((i) => ({ o, pts: samples("idle", `desk-${o}`, i, 60) })));
    for (const a of all) {
      for (const b of all) {
        if (a.o === b.o) continue;
        for (const p of a.pts) for (const q of b.pts) expect(distance(p, q)).toBeGreaterThan(PERSONAL_SPACE);
      }
    }
  });

  test("the same seed walks the same way", () => {
    const area = wanderArea("dormant", "hearth", 0)!;
    const one = seeded(42);
    const two = seeded(42);
    expect(pick(area, one)).toEqual(pick(area, two));
  });
});
