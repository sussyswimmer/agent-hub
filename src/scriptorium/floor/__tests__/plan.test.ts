// The room has to hold two properties that are easy to get wrong by eye and impossible to get
// wrong by arithmetic: nothing overlaps, and nothing walks where it should not.

import { describe, expect, test } from "bun:test";

import {
  CENTRE,
  DESK_RADIUS,
  ORDERS,
  SIGIL_SIZE,
  STATIONS,
  WALL_INNER,
  WARD_RADIUS,
  at,
  deskCorners,
  deskLamp,
  distance,
  slot,
  station,
} from "../plan";
import { approach, route, walk } from "../paths";

import { reachesDesk } from "./figure";

/** The closest a line segment comes to a point — the question both wall and ward checks ask. */
function nearest(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  if (len === 0) return distance(a, p);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return distance({ x: a.x + t * dx, y: a.y + t * dy }, p);
}

describe("the room", () => {
  test("every station is inside the wall", () => {
    for (const s of STATIONS) {
      expect(distance(s.at, CENTRE)).toBeLessThanOrEqual(WALL_INNER);
    }
  });

  test("each order has its own desk, and no two desks touch", () => {
    const desks = ORDERS.map((o) => station(`desk-${o}`));
    expect(desks).toHaveLength(ORDERS.length);
    for (const a of desks) {
      for (const b of desks) {
        if (a === b) continue;
        // Desks are 150 long; the arc between two 72° apart at r=300 is about 377.
        expect(distance(a.at, b.at)).toBeGreaterThan(200);
      }
    }
  });

  test("a desk lies inside the room, corners and all", () => {
    for (const o of ORDERS) {
      for (const corner of deskCorners(station(`desk-${o}`))) {
        expect(distance(corner, CENTRE)).toBeLessThan(WALL_INNER);
      }
      expect(distance(deskLamp(station(`desk-${o}`)), CENTRE)).toBeLessThan(WALL_INNER);
    }
  });

  test("the desks clear the ward circle", () => {
    expect(DESK_RADIUS).toBeGreaterThan(WARD_RADIUS + SIGIL_SIZE);
  });
});

describe("where familiars stand", () => {
  // §8.2: "Never overlap two sigils."
  test("no two familiars at the same station overlap", () => {
    for (const s of STATIONS) {
      const places = Array.from({ length: 6 }, (_, i) => slot(s, i));
      for (let i = 0; i < places.length; i++) {
        for (let j = i + 1; j < places.length; j++) {
          expect(distance(places[i]!, places[j]!)).toBeGreaterThanOrEqual(SIGIL_SIZE);
        }
      }
    }
  });

  test("a familiar's place depends on its own index and nothing else", () => {
    // The property that keeps the room still: a sixth familiar arriving at the hearth must not
    // make the other five walk sideways.
    const hearth = station("hearth");
    const before = [0, 1, 2].map((i) => slot(hearth, i));
    const after = [0, 1, 2].map((i) => slot(hearth, i));
    expect(after).toEqual(before);
  });

  test("a familiar standing at a desk or the hearth does not reach onto any desk", () => {
    // The figures stand up out of the plan, head to the north of the feet. At the two desks on
    // the north side the first version stood them with their heads on the desktop, and when the
    // figures grew (DECISIONS 0028) the hearth's did the same to the Ledger desk.
    const places = [
      ...ORDERS.flatMap((o) => Array.from({ length: 6 }, (_, i) => slot(station(`desk-${o}`), i))),
      ...Array.from({ length: 6 }, (_, i) => slot(station("hearth"), i)),
    ];
    for (const p of places) expect(reachesDesk(p)).toBe(false);
  });

  test("a crowd at a desk stays out of the ward circle", () => {
    // Six of one order is more than anyone will bind, and still none of them is stood where a
    // familiar waiting on a seal would be.
    for (const o of ORDERS) {
      for (let i = 0; i < 6; i++) {
        expect(distance(slot(station(`desk-${o}`), i), CENTRE) - SIGIL_SIZE / 2).toBeGreaterThan(WARD_RADIUS);
      }
    }
  });

  test("everyone waiting on a seal stands in the ward circle", () => {
    // Feet inside and most of the ring with them. Five figures this size do not all fit inside
    // the painted line, so a second may stand with the edge of its ring across it.
    const ward = station("ward");
    for (let i = 0; i < 5; i++) {
      expect(distance(slot(ward, i), CENTRE) + SIGIL_SIZE / 4).toBeLessThanOrEqual(WARD_RADIUS);
    }
  });

  test("the first familiar to need a seal stands in the middle of the circle", () => {
    // §8.4 asks this to be readable without a click. Dead centre is the clearest it can be.
    expect(slot(station("ward"), 0)).toEqual(CENTRE);
  });

  test("dormant familiars rest at the hearth, on the south arc", () => {
    for (let i = 0; i < 5; i++) {
      const p = slot(station("hearth"), i);
      expect(p.y).toBeGreaterThan(CENTRE.y);
      expect(distance(p, CENTRE)).toBeLessThan(WALL_INNER);
    }
  });
});

describe("routes", () => {
  const ids = STATIONS.map((s) => s.id);

  test("every station can be reached from every other", () => {
    for (const from of ids) {
      for (const to of ids) {
        if (from === to) continue;
        expect(route(from, to).length).toBeGreaterThan(0);
      }
    }
  });

  test("no route leaves the room", () => {
    for (const from of ids) {
      for (const to of ids) {
        if (from === to) continue;
        const legs = [approach(station(from)), ...route(from, to)];
        for (const p of legs) expect(distance(p, CENTRE)).toBeLessThanOrEqual(WALL_INNER);
      }
    }
  });

  test("nothing walks through the ward circle unless that is where it is going", () => {
    // The reason the graph exists. Straight across the middle is always the shortest way, and
    // it says something untrue every time: the centre of this room is where a familiar stands
    // when it is waiting on you.
    for (const from of ids) {
      for (const to of ids) {
        if (from === to || from === "ward" || to === "ward") continue;
        const legs = [approach(station(from)), ...route(from, to)];
        for (let i = 1; i < legs.length; i++) {
          expect(nearest(legs[i - 1]!, legs[i]!, CENTRE)).toBeGreaterThanOrEqual(WARD_RADIUS);
        }
      }
    }
  });

  test("a familiar called to the seal does walk into the circle", () => {
    const legs = walk("desk-quill", "ward", CENTRE);
    expect(legs[legs.length - 1]).toEqual(CENTRE);
  });

  test("the short way round is the way taken", () => {
    // Quill sits at 324° and Lantern at 36°, which is 72° apart across the door — not 288°
    // apart the other way. A route that goes the long way is a route nobody would walk.
    const short = walk("desk-quill", "desk-lantern", at(36, 220));
    const long = walk("desk-quill", "desk-crucible", at(252, 220));
    const length = (legs: { x: number; y: number }[], from: string) =>
      legs.reduce((sum, p, i) => sum + distance(i === 0 ? approach(station(from)) : legs[i - 1]!, p), 0);
    expect(length(short, "desk-quill")).toBeLessThan(length(long, "desk-quill"));
  });

  test("a walk ending where it already stands has no final leg to divide by", () => {
    // One familiar at the ward circle stands exactly on the approach point. A zero-length last
    // leg would make the tween divide by nothing.
    for (const legs of [walk("desk-quill", "ward", CENTRE), walk("ward", "desk-quill", at(324, 220))]) {
      for (let i = 1; i < legs.length; i++) {
        expect(distance(legs[i - 1]!, legs[i]!)).toBeGreaterThan(0);
      }
    }
  });
});
