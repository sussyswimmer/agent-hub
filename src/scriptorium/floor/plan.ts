// The tower, as an architect would set it out (§8.2).
//
// Everything here is data and arithmetic — no Pixi, no DOM — so the room can be reasoned about
// and tested without a canvas. `bake.ts` draws what this describes; `paths.ts` routes across it.
//
// **World units, not pixels.** The room is 1600 × 1600 and the viewport letterboxes to fit, so
// nothing in this file changes when the window does. A sigil is 44 units wherever it stands.
//
// It was 1000 until the owner asked for a bigger room with familiars that walk about in it
// (DECISIONS 0025). The familiars kept their size and the room grew around them, so there is
// floor to wander on. Every radius below was then measured off the painting it is registered
// to, `floor-plan.jpg`, rather than the other way round.
//
// §8.8 asks that adding a sixth order later mean editing one array rather than redrawing the
// room. It does: add to `ORDER_BEARINGS` and the desk, its waypoints and its routes follow.

import type { Order } from "@/lib/types";

export interface Point {
  x: number;
  y: number;
}

export const WORLD = 1600;
export const CENTRE: Point = { x: WORLD / 2, y: WORLD / 2 };

/** The wall is two hairlines with hatching between them, as a plan draws a wall. */
export const WALL_INNER = 716;
export const WALL_OUTER = 748;

/** The ward circle at the centre, where a familiar waiting on your seal stands. */
export const WARD_RADIUS = 114;

/** Where the order desks sit: inboard of the wall, outboard of the concourse. */
export const DESK_RADIUS = 500;
export const DESK_LENGTH = 180;
export const DESK_DEPTH = 54;

/** The ring familiars walk along. Between the ward circle and the desks, so neither is crossed. */
export const CONCOURSE_RADIUS = 300;

/** §8.3: the sigil is drawn at 44 world units. */
export const SIGIL_SIZE = 44;

/**
 * How far above where it stands a familiar's figure reaches, in world units. The figures are
 * painted standing, seen a little from the front, so a familiar's head is north of its feet —
 * and one standing just south of a desk has its head on the desk unless it stands further off.
 */
export const FIGURE_REACH = 57;

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

/**
 * How far from the centre the furniture against the wall stands, each as the painting has it.
 * Far enough in to leave the wall its thickness.
 */
export const WALL_FURNITURE = { reliquary: 622, hearth: 650, lectern: 660 } as const;

/** Where familiars stand in front of the furniture against the wall, and wait at the hearth. */
export const BEFORE_FURNITURE = 60;

/**
 * A desk the painting set nearer the centre than the plan's radius. The Ledger desk is painted
 * a chair's depth inboard, and familiars standing where the plan's desk would be stood on it.
 */
const DESK_NUDGE: Partial<Record<Order, number>> = { ledger: 478 };

export function deskRadius(order: Order): number {
  return DESK_NUDGE[order] ?? DESK_RADIUS;
}

/** Every station a familiar can occupy, plus the two that are only ever clicked (§8.2). */
export const STATIONS: Station[] = [
  { id: "door", kind: "door", bearing: 0, at: at(0, WALL_INNER), label: "the door" },
  { id: "ward", kind: "ward", bearing: 0, at: CENTRE, label: "the ward circle" },
  { id: "reliquary", kind: "cabinet", bearing: 90, at: at(90, WALL_FURNITURE.reliquary), label: "reliquary" },
  { id: "hearth", kind: "hearth", bearing: 180, at: at(180, WALL_FURNITURE.hearth), label: "the hearth" },
  { id: "lectern", kind: "lectern", bearing: 270, at: at(270, WALL_FURNITURE.lectern), label: "ledger" },
  ...ORDERS.map((order): Station => ({
    id: `desk-${order}`,
    kind: "desk",
    order,
    bearing: ORDER_BEARINGS[order],
    at: at(ORDER_BEARINGS[order], deskRadius(order)),
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

/**
 * Where each desk's candle stands in the painted floor, as a turn off the desk's bearing and a
 * distance from the centre. Measured from `floor-plan.jpg` after it was registered to this file
 * (DECISIONS 0020, 0025): a thread of ink that ends a hand's breadth from the flame it is meant
 * to run to reads as a thread to nothing. An order with no entry gets the drawn default.
 */
const LAMPS: Partial<Record<Order, { turn: number; radius: number }>> = {
  lantern: { turn: 9.3, radius: 483 },
  compass: { turn: 11, radius: 491 },
  ledger: { turn: 7, radius: 483 },
  crucible: { turn: 2.5, radius: 492 },
  quill: { turn: 4.6, radius: 475 },
};

/** The desk lamp, which is what a working familiar's thread of ink runs to (§8.3). */
export function deskLamp(s: Station): Point {
  const lamp = (s.order && LAMPS[s.order]) ?? { turn: 6, radius: distance(s.at, CENTRE) + 6 };
  return at(s.bearing + lamp.turn, lamp.radius);
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
      const inboard = deskInboard(s);
      if (index < 2) {
        // Either side of the desk, along its length.
        const offset = index === 0 ? -50 : 50;
        const spread = (Math.atan2(offset, inboard) * 180) / Math.PI;
        return at(s.bearing + spread, Math.hypot(offset, inboard));
      }
      // A short line, inboard, one behind another, a figure's height apart. Wider would say
      // more of each name and, with a long enough line, stand the last in the ward circle.
      return at(s.bearing, inboard - 64 * (index - 1));
    }
    case "ward": {
      // One familiar stands in the middle of the circle, which is the image §8.4 wants to be
      // unmistakable. A second stands beside it rather than displacing it.
      if (index === 0) return CENTRE;
      return at(((index - 1) * 72) % 360, 62);
    }
    case "hearth": {
      // Spread along the south arc between the Ledger desk and the fire, alternating out from
      // due south. The step is set by the name plates rather than by the sigils: marks that
      // clear each other with names that run together are worse than useless on the one
      // station where every dormant familiar ends up at once.
      const step = 10;
      const n = Math.floor((index + 1) / 2);
      const offset = index % 2 === 0 ? -n * step : n * step;
      return at(180 + offset, HEARTH_ARC);
    }
    default: {
      // Cabinet, lectern, door: stand in front of it, and queue inboard.
      return at(s.bearing, distance(s.at, CENTRE) - BEFORE_FURNITURE - 50 * index);
    }
  }
}

/**
 * Where a familiar stands at a desk: on the chair side, towards the centre, and further off a
 * desk that lies north of it by as much of its height as points that way.
 */
export function deskInboard(s: Station): number {
  const north = Math.max(0, Math.cos((s.bearing * Math.PI) / 180));
  return distance(s.at, CENTRE) - DESK_DEPTH / 2 - 40 - FIGURE_REACH * north;
}

/** The arc the hearth's familiars stand along: in front of the fire, behind the Ledger desk. */
export const HEARTH_ARC = 562;

/** The door is a gap in the wall, not a line across it. Degrees of arc it takes out. */
export const DOOR_ARC = 15;
