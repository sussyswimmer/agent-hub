// The tower, as an architect would set it out (§8.2).
//
// Everything here is data and arithmetic — no Pixi, no DOM — so the room can be reasoned about
// and tested without a canvas. `bake.ts` draws what this describes; `paths.ts` routes across it.
//
// **World units, not pixels.** The room is 1000 × 1000 and the viewport letterboxes to fit, so
// nothing in this file changes when the window does. A sigil is 44 units wherever it stands.
//
// §8.8 asks that adding a sixth order later mean editing one array rather than redrawing the
// room. It does: add to `ORDER_BEARINGS` and the desk, its waypoints and its routes follow.

import type { Order } from "@/lib/types";

export interface Point {
  x: number;
  y: number;
}

export const WORLD = 1000;
export const CENTRE: Point = { x: WORLD / 2, y: WORLD / 2 };

/** The wall is two hairlines with hatching between them, as a plan draws a wall. */
export const WALL_INNER = 448;
export const WALL_OUTER = 470;

/** The ward circle at the centre, where a familiar waiting on your seal stands. */
export const WARD_RADIUS = 90;

/** Where the order desks sit: inboard of the wall, outboard of the concourse. */
export const DESK_RADIUS = 300;
export const DESK_LENGTH = 150;
export const DESK_DEPTH = 46;

/** The ring familiars walk along. Between the ward circle and the desks, so neither is crossed. */
export const CONCOURSE_RADIUS = 196;

/** §8.3: the sigil is drawn at 44 world units. */
export const SIGIL_SIZE = 44;

/** Below this zoom the name plates come off, as §8.3 asks. */
export const PLATE_ZOOM = 0.9;

/**
 * A point at a bearing from the room's centre. 0° is twelve o'clock and degrees run clockwise,
 * which is how a plan is read and how §8.5's `Tab` order is defined.
 *
 * Screen y grows downward, so north is a *smaller* y. Getting this backwards mirrors the room.
 */
export function at(bearing: number, radius: number, from: Point = CENTRE): Point {
  const t = (bearing * Math.PI) / 180;
  return { x: from.x + radius * Math.sin(t), y: from.y - radius * Math.cos(t) };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Where each order's desk stands, in degrees clockwise from the door.
 *
 * Offset from the cardinals so the door at 0° stays clear, and ordered so the plan reads like
 * §8.2's sketch: Quill and Lantern at the top of the room, Crucible and Compass at the bottom,
 * Ledger on the south axis with the hearth behind it.
 */
export const ORDER_BEARINGS: Record<Order, number> = {
  lantern: 36,
  compass: 108,
  ledger: 180,
  crucible: 252,
  quill: 324,
};

export const ORDERS = Object.keys(ORDER_BEARINGS) as Order[];

export type StationKind = "desk" | "hearth" | "ward" | "cabinet" | "lectern" | "door";

export interface Station {
  id: string;
  kind: StationKind;
  /** The station's own position — the furniture, not where a familiar stands. */
  at: Point;
  bearing: number;
  /** What the plan writes beside it. */
  label: string;
  order?: Order;
}

/** Where the furniture against the wall sits. Far enough in to leave the wall its thickness. */
const WALL_FURNITURE = 404;

/** Every station a familiar can occupy, plus the two that are only ever clicked (§8.2). */
export const STATIONS: Station[] = [
  { id: "door", kind: "door", bearing: 0, at: at(0, WALL_INNER), label: "the door" },
  { id: "ward", kind: "ward", bearing: 0, at: CENTRE, label: "the ward circle" },
  { id: "reliquary", kind: "cabinet", bearing: 90, at: at(90, WALL_FURNITURE), label: "reliquary" },
  { id: "hearth", kind: "hearth", bearing: 180, at: at(180, WALL_FURNITURE), label: "the hearth" },
  { id: "lectern", kind: "lectern", bearing: 270, at: at(270, WALL_FURNITURE), label: "ledger" },
  ...ORDERS.map((order): Station => ({
    id: `desk-${order}`,
    kind: "desk",
    order,
    bearing: ORDER_BEARINGS[order],
    at: at(ORDER_BEARINGS[order], DESK_RADIUS),
    label: order,
  })),
];

export const STATION_BY_ID = new Map(STATIONS.map((s) => [s.id, s]));

export function station(id: string): Station {
  const s = STATION_BY_ID.get(id);
  if (!s) throw new Error(`no station called ${id}`);
  return s;
}

export function deskFor(order: Order): Station {
  return station(`desk-${order}`);
}

/**
 * The four corners of a desk, drawn as a plan draws one: a bar lying along the wall's tangent.
 *
 * Returned rather than drawn so the same rectangle can be baked into the floor and used to work
 * out where its lamp goes, without the two drifting apart.
 */
export function deskCorners(s: Station): [Point, Point, Point, Point] {
  const t = (s.bearing * Math.PI) / 180;
  // Along the desk (tangential) and across it (radial, outward).
  const along = { x: Math.cos(t), y: Math.sin(t) };
  const across = { x: Math.sin(t), y: -Math.cos(t) };
  const halfL = DESK_LENGTH / 2;
  const halfD = DESK_DEPTH / 2;
  const corner = (u: number, v: number): Point => ({
    x: s.at.x + along.x * u * halfL + across.x * v * halfD,
    y: s.at.y + along.y * u * halfL + across.y * v * halfD,
  });
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
}

/** The desk lamp, which is what a working familiar's thread of ink runs to (§8.3). */
export function deskLamp(s: Station): Point {
  return at(s.bearing + 5, DESK_RADIUS + DESK_DEPTH / 2 + 12);
}

/**
 * Where the nth familiar at a station stands.
 *
 * **A familiar's place depends on its own index and nothing else.** Spreading `count` evenly
 * would be prettier, and would mean every familiar already at a station walks sideways whenever
 * another arrives — a room full of shuffling for no information. These offsets are fixed, so
 * arriving somewhere moves only the one arriving.
 *
 * §8.2: two of an order share a desk by standing either side of it; three or more queue behind.
 * Nothing overlaps: a sigil is 44 units across and the closest two slots are 84 apart.
 */
export function slot(s: Station, index: number): Point {
  switch (s.kind) {
    case "desk": {
      const inboard = DESK_RADIUS - DESK_DEPTH / 2 - 34;
      if (index < 2) {
        // Either side of the desk, along its length.
        const offset = index === 0 ? -42 : 42;
        const spread = (Math.atan2(offset, inboard) * 180) / Math.PI;
        return at(s.bearing + spread, Math.hypot(offset, inboard));
      }
      // A short line, inboard, one behind another.
      return at(s.bearing, inboard - 52 * (index - 1));
    }
    case "ward": {
      // One familiar stands in the middle of the circle, which is the image §8.4 wants to be
      // unmistakable. A second stands beside it rather than displacing it.
      if (index === 0) return CENTRE;
      return at(((index - 1) * 72) % 360, 52);
    }
    case "hearth": {
      // Spread along the south arc, alternating out from due south. The step is set by the name
      // plates rather than by the sigils: at 13° the marks cleared each other and the names
      // underneath them ran together, which is worse than useless on the one station where
      // every dormant familiar ends up at once.
      const step = 18;
      const n = Math.floor((index + 1) / 2);
      const offset = index % 2 === 0 ? -n * step : n * step;
      return at(180 + offset, WALL_FURNITURE - 44);
    }
    default: {
      // Cabinet, lectern, door: stand in front of it, and queue inboard.
      return at(s.bearing, WALL_FURNITURE - 46 - 50 * index);
    }
  }
}

/** The door is a gap in the wall, not a line across it. Degrees of arc it takes out. */
export const DOOR_ARC = 15;
