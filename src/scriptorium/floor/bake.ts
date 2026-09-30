// The floor itself: walls, hatching, furniture and labels, drawn once into a texture (§8.6).
//
// None of this moves. Re-drawing a few hundred vector operations every frame to produce an
// identical image is the easiest 60fps to give away, so it is drawn once and blitted.
//
// **Baked in world space, not screen space.** The texture covers the 1000 × 1000 room and lives
// inside the container that pans and zooms, so panning and zooming cost nothing and change
// nothing. It is re-made only when the window resizes — where a larger viewport wants more
// texels — or when the zoom crosses 0.9×, where the station labels come and go (§8.3).

import { Container, Graphics, type Renderer, RenderTexture, Text } from "pixi.js";

import { hatchTexture } from "./hatching";
import {
  CENTRE,
  DESK_DEPTH,
  DOOR_ARC,
  ORDERS,
  STATIONS,
  type Station,
  WALL_INNER,
  WALL_OUTER,
  WARD_RADIUS,
  WORLD,
  at,
  deskCorners,
  deskLamp,
  station,
} from "./plan";

/** Pixi measures angles from three o'clock; the plan measures bearings from twelve. */
export const rad = (bearing: number) => ((bearing - 90) * Math.PI) / 180;

/**
 * An arc that begins its own subpath.
 *
 * **`arc()` does not lift the pen.** Like the canvas call it mirrors, it draws a line from
 * wherever the path currently is to where the arc starts — so an arc issued after any other
 * drawing gets a chord attached to it. Baking the room drew a 26-unit-wide band clean across
 * the floor, from the end of the lectern's spine to the start of the hearth, and the wall's
 * hairlines picked up smaller ones at the door. Every arc in this file goes through here.
 */
export function arcAt(
  g: Graphics,
  centre: { x: number; y: number },
  radius: number,
  fromBearing: number,
  toBearing: number,
): Graphics {
  const start = at(fromBearing, radius, centre);
  return g.moveTo(start.x, start.y).arc(centre.x, centre.y, radius, rad(fromBearing), rad(toBearing));
}

/** A theme token as a number Pixi can take. The floor must not hard-code the palette (§7.2). */
export function tone(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(raw);
  return hex ? parseInt(hex[1]!, 16) : fallback;
}

export interface Palette {
  void: number;
  panel: number;
  rule: number;
  /**
   * What the plan is drawn in.
   *
   * `--ink-rule` is the hairline colour for dividers between panels, and it is right there and
   * wrong here: at floor scale a room drawn in it is a rumour. §7.1 wants the sigil to be the
   * loudest thing on screen, which it still is — this is ink on the page underneath it, set
   * back with alpha rather than with a colour nobody can see.
   */
  ink: number;
  bone: number;
  boneDim: number;
  brass: number;
  order: Record<string, number>;
}

export function palette(): Palette {
  return {
    void: tone("--ink-void", 0x14131a),
    panel: tone("--ink-panel", 0x1e1c27),
    rule: tone("--ink-rule", 0x332f40),
    ink: tone("--bone-dim", 0x8c8474),
    bone: tone("--bone", 0xc9bfa4),
    boneDim: tone("--bone-dim", 0x8c8474),
    brass: tone("--brass", 0xb08d3f),
    order: {
      quill: tone("--brass", 0xb08d3f),
      lantern: tone("--verdigris", 0x4e7a6b),
      crucible: tone("--oxblood", 0x7a1f2b),
      compass: tone("--slate", 0x5a6b8c),
      ledger: tone("--bone", 0xc9bfa4),
    },
  };
}

/** A desk, as a plan draws one: a bar, with the grain of the top. Its lamp is `drawLamp`. */
function drawDesk(g: Graphics, s: Station, p: Palette) {
  const [a, b, c, d] = deskCorners(s);

  g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y])
    .fill({ color: p.panel })
    .stroke({ width: 1.6, color: p.ink, alpha: 0.5 });

  // One line along the desk, a hand's breadth from the inboard edge — the way a plan shows a
  // worktop rather than a plinth.
  const inset = (from: typeof a, to: typeof d, t: number) => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  });
  const p1 = inset(a, d, 0.3);
  const p2 = inset(b, c, 0.3);
  g.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y).stroke({ width: 1.2, color: p.ink, alpha: 0.3 });
}

/**
 * The lamp. A working familiar's thread of ink runs to this (§8.3), so it is drawn in the
 * order's colour. On the painted floor it rings the candle the painting lit there, which is the
 * one thing that says whose desk is whose.
 */
function drawLamp(g: Graphics, s: Station, p: Palette) {
  const colour = p.order[s.order ?? "ledger"] ?? p.bone;
  const lamp = deskLamp(s);
  g.circle(lamp.x, lamp.y, 7).stroke({ width: 2, color: colour, alpha: 0.8 });
}

function drawWall(g: Graphics, p: Palette) {
  const from = DOOR_ARC / 2;
  const to = 360 - DOOR_ARC / 2;

  // The hatch between the hairlines, laid as a thick stroke carrying the tile rather than as a
  // masked sprite. Same picture, one object, no mask to keep in step with the geometry.
  const mid = (WALL_INNER + WALL_OUTER) / 2;
  arcAt(g, CENTRE, mid, from, to).stroke({
    width: WALL_OUTER - WALL_INNER,
    texture: hatchTexture(),
  });

  for (const r of [WALL_INNER, WALL_OUTER]) {
    arcAt(g, CENTRE, r, from, to).stroke({ width: 2, color: p.ink, alpha: 0.55 });
  }

  // The door: the wall's two ends closed off, and the swing drawn as a plan draws one — a leaf
  // and the quarter-circle it sweeps.
  for (const bearing of [DOOR_ARC / 2, -DOOR_ARC / 2]) {
    const inner = at(bearing, WALL_INNER);
    const outer = at(bearing, WALL_OUTER);
    g.moveTo(inner.x, inner.y).lineTo(outer.x, outer.y).stroke({ width: 2, color: p.ink, alpha: 0.55 });
  }
  const hinge = at(-DOOR_ARC / 2, WALL_INNER);
  const leaf = at(-DOOR_ARC / 2 - 4, WALL_INNER - 74);
  g.moveTo(hinge.x, hinge.y).lineTo(leaf.x, leaf.y).stroke({ width: 2, color: p.ink, alpha: 0.5 });
  arcAt(g, hinge, 74, 168, 258).stroke({ width: 1.2, color: p.ink, alpha: 0.35 });
}

function drawWard(g: Graphics, p: Palette) {
  // Two rings and a set of ticks: a figure drawn on the floor, not a piece of furniture.
  g.circle(CENTRE.x, CENTRE.y, WARD_RADIUS).stroke({ width: 2, color: p.ink, alpha: 0.5 });
  g.circle(CENTRE.x, CENTRE.y, WARD_RADIUS - 11).stroke({ width: 1.2, color: p.ink, alpha: 0.35 });
  for (let bearing = 0; bearing < 360; bearing += 30) {
    const a = at(bearing, WARD_RADIUS - 11);
    const b = at(bearing, WARD_RADIUS);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.2, color: p.ink, alpha: 0.35 });
  }
}

function drawFurniture(g: Graphics, p: Palette) {
  // The reliquary cabinet, east: a case against the wall with its doors shown open.
  const cabinet = station("reliquary");
  const [ca, cb, cc, cd] = deskCorners({ ...cabinet, bearing: cabinet.bearing } as Station);
  g.poly([ca.x, ca.y, cb.x, cb.y, cc.x, cc.y, cd.x, cd.y])
    .fill({ color: p.panel })
    .stroke({ width: 1.6, color: p.ink, alpha: 0.5 });
  for (const bearing of [cabinet.bearing - 8, cabinet.bearing + 8]) {
    const a = at(bearing, 380);
    const b = at(bearing, 330);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.2, color: p.ink, alpha: 0.35 });
  }

  // The ledger lectern, west: a sloped reading desk, drawn as the plan symbol for one.
  const lectern = station("lectern");
  const [la, lb, lc, ld] = deskCorners({ ...lectern } as Station);
  g.poly([la.x, la.y, lb.x, lb.y, lc.x, lc.y, ld.x, ld.y])
    .fill({ color: p.panel })
    .stroke({ width: 1.6, color: p.ink, alpha: 0.5 });
  // The open book on it. Bounded by the lectern's own length — set out by bearing it ran on
  // past both ends of the furniture it is supposed to be lying on.
  const spine = [at(lectern.bearing - 8, 404), at(lectern.bearing + 8, 404)];
  g.moveTo(spine[0]!.x, spine[0]!.y).lineTo(spine[1]!.x, spine[1]!.y).stroke({ width: 1.2, color: p.bone, alpha: 0.45 });

  // The hearth, south: a recess in the wall with a fire back.
  const hearth = station("hearth");
  arcAt(g, CENTRE, 432, hearth.bearing - 22, hearth.bearing + 22).stroke({ width: 26, color: p.panel });
  arcAt(g, CENTRE, 419, hearth.bearing - 22, hearth.bearing + 22)
    .stroke({ width: 1.6, color: p.ink, alpha: 0.5 });
  for (const bearing of [hearth.bearing - 22, hearth.bearing + 22]) {
    const a = at(bearing, 419);
    const b = at(bearing, 445);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.6, color: p.ink, alpha: 0.5 });
  }
}

/** Station labels, in the body face, the size a plan writes them. */
function drawLabels(into: Container, p: Palette) {
  for (const s of STATIONS) {
    const label = new Text({
      text: s.label,
      style: {
        fontFamily: "EB Garamond, Georgia, serif",
        fontSize: 17,
        fill: p.boneDim,
        letterSpacing: 0.4,
        // Outlined in the void, as the name plates are, so a label reads on the painted floor.
        stroke: { color: p.void, width: 4, join: "round" },
      },
    });
    label.anchor.set(0.5);
    label.resolution = 2;

    // Set beside what it names, pushed off the centre line so it never sits under a sigil.
    const where =
      s.kind === "desk"
        ? at(s.bearing, DESK_RADIUS_LABEL)
        : s.kind === "ward"
          ? at(180, WARD_RADIUS + 22)
          : at(s.bearing, 446);
    label.position.set(where.x, where.y);
    into.addChild(label);
  }
}

const DESK_RADIUS_LABEL = 300 + DESK_DEPTH / 2 + 30;

export interface Baked {
  texture: RenderTexture;
  /** The zoom band it was baked for, so the caller knows when it has gone stale. */
  plates: boolean;
  destroy: () => void;
}

export interface BakeOptions {
  /**
   * How many device pixels one world unit may come to occupy, which sets the texels. The stage
   * passes what the *largest* zoom needs, so zooming in never outgrows the texture and never
   * needs another bake. Capped at 3: past that the texture costs memory to hold detail no
   * display resolves.
   */
  resolution: number;
  /**
   * Whether the station labels are drawn: the reader's zoom at or above `PLATE_ZOOM`, the same
   * rule as the name plates (§8.3). Passed in rather than worked out here from `resolution`,
   * which counts device pixels — the two answers disagreed on a 1× display, and every pan
   * re-baked the room (DECISIONS 0022).
   */
  plates: boolean;
  /** A painted floor lies underneath, so only lamps and labels are drawn (DECISIONS 0020). */
  painted?: boolean;
}

/** Draw the room into a texture. */
export function bake(renderer: Renderer, options: BakeOptions): Baked {
  const p = palette();
  const { plates } = options;

  const room = new Container();
  const g = new Graphics();

  // Under a painted floor registered to this plan (DECISIONS 0020), the walls, desks, hearth,
  // cabinet, lectern and ward circle are already there, in the same places. Drawing them again
  // would be a second room laid a few units off the first. The plan is drawn in full only when
  // there is no painting — which is also what a machine that fails to load it sees.
  if (!options.painted) {
    // The floor inside the wall, a shade off the void so the room reads as a room.
    g.circle(CENTRE.x, CENTRE.y, WALL_INNER).fill({ color: p.void });
    drawWall(g, p);
    drawWard(g, p);
    drawFurniture(g, p);
    for (const order of ORDERS) drawDesk(g, station(`desk-${order}`), p);
  }
  for (const order of ORDERS) drawLamp(g, station(`desk-${order}`), p);
  room.addChild(g);

  // Below 0.9× the labels are illegible anyway, and drawing them turns the plan into a smear.
  if (plates) drawLabels(room, p);

  const resolution = Math.max(1, Math.min(3, options.resolution));
  const texture = RenderTexture.create({ width: WORLD, height: WORLD, resolution, antialias: true });
  renderer.render({ container: room, target: texture, clear: true });
  room.destroy({ children: true });

  return { texture, plates, destroy: () => texture.destroy(true) };
}
