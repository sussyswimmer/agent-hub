// The familiars on the floor: where each one stands, what its mark is doing, and how it gets
// from one station to another (§8.3).
//
// One container per familiar, holding the sigil, its name plate, and the arc that shows what the
// commission has spent. The thread of ink is drawn on its own layer, because it is the one thing
// redrawn every frame and it should not drag a container's transform along with it.
//
// The sigil geometry comes from `ui/sigil-geometry`, the same module the rail's SVG reads, so a
// familiar's mark is the same mark in both places rather than two drawings that happen to agree.

import { Container, Graphics, Sprite, Text } from "pixi.js";

import {
  type Mark,
  RING_RADIUS,
  type SigilGeometry,
  glyphMarks,
  isBroken,
  polar,
  ringPeriod,
  sigilGeometry,
} from "@/ui/sigil-geometry";
import type { Order, SigilState } from "@/lib/types";

import { arcAt, type Palette } from "./bake";
import {
  CENTRE,
  PLATE_ZOOM,
  type Point,
  SIGIL_SIZE,
  deskLamp,
  distance,
  slot,
  station,
  WARD_RADIUS,
} from "./plan";
import { walk } from "./paths";
import type { Portraits } from "./art";

/** §8.3: the walk is 1.1s, ease-in-out, along the waypoints. */
const WALK_MS = 1100;

/** The gap left in the ring when a familiar is banished or misfired (§7.4). */
const BREAK_DEGREES = 34;

/**
 * How tall a portrait stands, in the sigil's 100-unit frame, and where its feet fall. The width
 * follows from each image's own proportions, so no figure is stretched to fit a box.
 */
const PORTRAIT_HEIGHT = 150;
const PORTRAIT_ANCHOR_Y = 0.72;

/** What the floor needs to know about one familiar. Everything else is the room's business. */
export interface ActorInput {
  id: string;
  name: string;
  order: Order;
  state: SigilState;
  /** How much of the token budget is spent, 0..1, or null where the binding sets none (§6.5). */
  spent: number | null;
}

/** Which station a state puts a familiar at (§8.3). */
export function stationFor(state: SigilState, order: Order): string {
  switch (state) {
    case "dormant":
      return "hearth";
    case "awaiting-seal":
      return "ward";
    case "banished":
      return "door";
    default:
      return `desk-${order}`;
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

interface Actor {
  input: ActorInput;
  geometry: SigilGeometry;
  container: Container;
  ring: Container;
  ringMark: Graphics;
  /** What bobs and steps: the portrait if one loaded, otherwise the figure drawn in `body`. */
  figure: Container;
  body: Graphics;
  portrait: Sprite | null;
  arc: Graphics;
  dot: Graphics;
  plate: Text;
  /** Where it is now, in world units. */
  at: Point;
  stationId: string;
  slotIndex: number;
  /** The remaining legs of a walk, and how far into the current one. */
  legs: Point[];
  legFrom: Point;
  legElapsed: number;
  /**
   * The whole walk's length, measured when it is set out.
   *
   * Measured once because it has to be: each leg takes a share of the 1.1s in proportion to its
   * length, and re-measuring what is *left* each frame makes that share grow as the journey
   * shortens — the familiar accelerates, and the last leg alone is given the full 1.1s.
   */
  walkLength: number;
  /** Radians of ring rotation accumulated. */
  spin: number;
  /** 0..1, so a summoned familiar fades in rather than appearing (§8.3). */
  opacity: number;
  /** A stable offset so every familiar's small motions do not move in lockstep. */
  rhythm: number;
}

export interface Actors {
  /** Take the roster as it now is: add, remove, and set anyone walking who should be. */
  sync(inputs: ActorInput[]): void;
  /** Advance every tween, rotation and pulse. `ms` is wall-clock, not frames. */
  tick(ms: number): void;
  /** Redraw the threads of ink. Separate because it is the only per-frame drawing (§8.6). */
  drawThreads(ms: number): void;
  setZoom(zoom: number): void;
  /** The familiar under a world-space point, if any. */
  at(point: Point): string | null;
  positionOf(id: string): Point | null;
  /** Clockwise from the door, which is the order `Tab` walks (§8.5). */
  clockwise(): string[];
  /** True while anything is mid-walk — the a11y mirror waits for the room to settle. */
  moving(): boolean;
  destroy(): void;
}

export interface ActorsOptions {
  actors: Container;
  threads: Container;
  palette: Palette;
  /** §8.7: no walking, no rotation, no breathing. */
  reducedMotion: boolean;
  /** Already loaded (`loadArt`). An order with none is drawn in code instead. */
  portraits?: Portraits;
}

export function createActors(options: ActorsOptions): Actors {
  const { actors: layer, threads, palette: p, reducedMotion, portraits = {} } = options;
  const byId = new Map<string, Actor>();
  const threadGraphics = new Graphics();
  threads.addChild(threadGraphics);
  let zoom = 1;

  const colourOf = (a: Actor) =>
    isBroken(a.input.state) ? tone("--oxblood", 0x7a1f2b) : (p.order[a.input.order] ?? p.bone);

  // Read here rather than through bake's palette so the oxblood override has one spelling.
  function tone(name: string, fallback: number): number {
    if (typeof document === "undefined") return fallback;
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(raw);
    return hex ? parseInt(hex[1]!, 16) : fallback;
  }

  /** The ring, spokes and glyph, in sigil units. The container scales it down to 44. */
  function drawSigil(a: Actor) {
    const colour = colourOf(a);
    const broken = isBroken(a.input.state);

    a.ringMark.clear();
    if (broken) {
      arcAt(a.ringMark, { x: 0, y: 0 }, RING_RADIUS, BREAK_DEGREES / 2, 360 - BREAK_DEGREES / 2)
        .stroke({ width: 4.5, color: colour, cap: "round" });
    } else {
      a.ringMark.circle(0, 0, RING_RADIUS).stroke({ width: 4.5, color: colour });
    }

    // §8.7: with motion reduced, a static brass tick at the top of the ring stands in for the
    // rotation. It has to be *visible* rather than merely present — it is the only remaining
    // sign that this familiar is working.
    if (reducedMotion && ringPeriod(a.input.state) !== null) {
      const [x1, y1] = polar(0, RING_RADIUS - 9);
      const [x2, y2] = polar(0, RING_RADIUS + 9);
      a.ringMark.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 5, color: p.brass, cap: "round" });
    }

    // Bound: a brass chord drawn across the ring (§7.4).
    if (a.input.state === "bound") {
      const [x1, y1] = polar(305, RING_RADIUS);
      const [x2, y2] = polar(125, RING_RADIUS);
      a.ringMark.moveTo(x1, y1).lineTo(x2, y2).stroke({ width: 4, color: p.brass, cap: "round" });
    }

    // The generated familiar is the actor where its portrait loaded; the state ring and aether
    // arc stay vector work either way, so interaction and state changes are exact.
    if (a.portrait) {
      a.body.clear();
    } else {
      drawPixelFamiliar(a, colour);
    }
  }

  function drawMark(g: Graphics, mark: Mark, colour: number) {
    const [first, ...rest] = mark.points;
    if (!first) return;
    g.moveTo(first[0], first[1]);
    for (const [x, y] of rest) g.lineTo(x, y);
    if (mark.close) g.closePath();
    g.stroke({ width: 3, color: colour, cap: "round", join: "round" });
  }

  /**
   * An original tiny familiar, built from a deliberately chunky 6-unit grid rather than an
   * imported sprite sheet. The name selects hair, skin and robe variations, so the room gains
   * a cast of characters without an asset pipeline or a licensing dependency.
   */
  function drawPixelFamiliar(a: Actor, accent: number) {
    const g = a.body;
    const seed = hash(a.input.name);
    const px = 6;
    const skin = [0xf2c6a6, 0xd99673, 0x9b6246, 0x6c4234][seed % 4]!;
    const hair = [0x24202a, 0x5f3834, 0xa35e45, 0xd3a347, 0x413449][(seed >>> 3) % 5]!;
    const robe = [p.order[a.input.order] ?? accent, 0x6d7f9a, 0x8a6074, 0x507f78][(seed >>> 7) % 4]!;
    const outline = 0x17131d;
    const rect = (x: number, y: number, w: number, h: number, color: number, alpha = 1) =>
      g.rect(x * px, y * px, w * px, h * px).fill({ color, alpha });

    g.clear();
    // A one-pixel ground shadow anchors the animation while the feet step above it.
    rect(-4, 6, 8, 1, outline, 0.55);
    // Robe and two alternating legs. The tick moves the whole character, while the asymmetric
    // feet keep the silhouette readable at the tiny scale.
    rect(-3, 0, 6, 5, outline);
    rect(-2, 0, 4, 5, robe);
    rect(-2, 5, 2, 2, outline);
    rect(1, 5, 2, 2, outline);
    rect(-3, 5, 2, 1, outline);
    rect(2, 5, 2, 1, outline);
    // Head, ears, hair cap, and a one-pixel face. The light eye gives every actor a gaze
    // without borrowing a character design from the supplied references.
    rect(-3, -6, 6, 6, outline);
    rect(-2, -5, 4, 5, skin);
    rect(-3, -4, 1, 2, skin);
    rect(2, -4, 1, 2, skin);
    rect(-3, -6, 6, 2, hair);
    rect(-3, -4, 1, 2, hair);
    if ((seed >>> 11) % 2 === 0) rect(2, -4, 1, 2, hair);
    rect(-1, -3, 1, 1, outline);
    rect(1, -3, 1, 1, outline);
    rect(0, -1, 1, 1, 0xf5e9c8);
    // An order-coloured shoulder clasp ties the character back to the familiar's sigil.
    rect(2, 0, 1, 1, accent);
    if (a.input.state === "working") {
      rect(4, -1, 1, 1, p.brass);
      rect(5, -2, 1, 1, p.brass, 0.75);
    }
    if (a.input.state === "bound") rect(-3, 2, 6, 1, p.brass);
    if (a.input.state === "misfired") rect(-2, -2, 4, 1, p.panel);
  }

  function hash(text: string): number {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) {
      value ^= text.charCodeAt(i);
      value = Math.imul(value, 16777619);
    }
    return value >>> 0;
  }

  /**
   * The aether arc: a thin arc around the sigil filling clockwise as the budget goes (§8.3).
   * Verdigris while there is room, brass past 80%, oxblood at the line.
   */
  function drawArc(a: Actor) {
    a.arc.clear();
    const spent = a.input.spent;
    if (spent === null || spent <= 0) return;
    const fraction = Math.min(1, spent);
    const colour =
      fraction >= 1
        ? tone("--oxblood", 0x7a1f2b)
        : fraction >= 0.8
          ? p.brass
          : tone("--verdigris", 0x4e7a6b);
    const r = RING_RADIUS + 14;
    arcAt(a.arc, { x: 0, y: 0 }, r, 0, 360 * fraction).stroke({ width: 3.5, color: colour, cap: "round" });
  }

  function make(input: ActorInput): Actor {
    const container = new Container();
    const ring = new Container();
    const ringMark = new Graphics();
    const body = new Graphics();
    const figure = new Container();
    figure.addChild(body);
    const texture = portraits[input.order];
    let portrait: Sprite | null = null;
    if (texture) {
      portrait = new Sprite(texture);
      portrait.anchor.set(0.5, PORTRAIT_ANCHOR_Y);
      portrait.position.set(0, 5);
      // Fitted once, here. Everything that moves it moves `figure`, so nothing can reset this
      // scale to 1 and draw the image at its native size across half the room.
      portrait.scale.set(PORTRAIT_HEIGHT / texture.height);
      figure.addChild(portrait);
    }
    const arc = new Graphics();
    const dot = new Graphics();
    ring.addChild(ringMark);

    const plate = new Text({
      text: input.name,
      // Outlined in the void so the name reads on lit flagstone as well as on the plain plan.
      style: {
        fontFamily: "Junicode, EB Garamond, Georgia, serif",
        fontSize: 12,
        fill: p.boneDim,
        stroke: { color: p.void, width: 3, join: "round" },
      },
    });
    plate.anchor.set(0.5, 0);
    plate.resolution = 2;

    // The sigil is drawn in its own 100-unit frame and scaled to the 44 §8.3 asks for, so the
    // geometry module never has to know how big the floor draws things.
    const marks = new Container();
    marks.addChild(figure, ring, arc, dot);
    marks.scale.set(SIGIL_SIZE / 100);
    container.addChild(marks);

    plate.position.set(0, SIGIL_SIZE / 2 + 4);
    container.addChild(plate);

    const stationId = stationFor(input.state, input.order);
    const actor: Actor = {
      input,
      geometry: sigilGeometry(input.name),
      container,
      ring,
      ringMark,
      figure,
      body,
      portrait,
      arc,
      dot,
      plate,
      at: CENTRE,
      stationId,
      slotIndex: 0,
      legs: [],
      legFrom: CENTRE,
      legElapsed: 0,
      walkLength: 1,
      spin: 0,
      opacity: input.state === "dormant" ? 0.4 : 1,
      rhythm: (hash(input.id) % 628) / 100,
    };
    layer.addChild(container);
    return actor;
  }

  /** Who stands where at a station, settled by id so the answer never depends on arrival order. */
  function assignSlots(inputs: ActorInput[]) {
    const atStation = new Map<string, string[]>();
    for (const input of [...inputs].sort((a, b) => a.id.localeCompare(b.id))) {
      const id = stationFor(input.state, input.order);
      atStation.set(id, [...(atStation.get(id) ?? []), input.id]);
    }
    for (const [stationId, ids] of atStation) {
      ids.forEach((id, index) => {
        const actor = byId.get(id);
        if (actor) {
          actor.stationId = stationId;
          actor.slotIndex = index;
        }
      });
    }
  }

  function send(a: Actor, fromStation: string) {
    const finish = slot(station(a.stationId), a.slotIndex);
    if (reducedMotion) {
      // §8.7: no walking. It is standing where it belongs, with no journey in between.
      a.at = finish;
      a.legs = [];
      return;
    }
    a.legs = walk(fromStation, a.stationId, finish);
    a.legFrom = a.at;
    a.legElapsed = 0;
    a.walkLength = Math.max(
      1,
      a.legs.reduce((sum, leg, i) => sum + distance(i === 0 ? a.at : a.legs[i - 1]!, leg), 0),
    );
  }

  return {
    sync(inputs) {
      const wanted = new Set(inputs.map((i) => i.id));
      for (const [id, a] of byId) {
        if (!wanted.has(id)) {
          a.container.destroy({ children: true });
          byId.delete(id);
        }
      }

      const fresh: Actor[] = [];
      for (const input of inputs) {
        let a = byId.get(input.id);
        if (!a) {
          a = make(input);
          byId.set(input.id, a);
          fresh.push(a);
        }
      }

      const before = new Map(
        [...byId].map(([id, a]) => [id, { station: a.stationId, state: a.input.state, slot: a.slotIndex }]),
      );
      for (const input of inputs) {
        const a = byId.get(input.id);
        if (a) a.input = input;
      }
      assignSlots(inputs);

      for (const a of byId.values()) {
        const was = before.get(a.input.id);
        const newcomer = fresh.includes(a);

        if (newcomer) {
          // Nothing walks in from nowhere on the first draw; the room is simply already like
          // this. A familiar that is summoned *after* the floor is open does walk, below.
          a.at = slot(station(a.stationId), a.slotIndex);
          a.legs = [];
        } else if (
          was &&
          (was.station !== a.stationId || was.state !== a.input.state || was.slot !== a.slotIndex)
        ) {
          // §8.3: a familiar leaving the hearth enters by the door rather than strolling out
          // of the fireplace, because the door is where a summoning comes from (§8.2).
          const from =
            was.state === "dormant" && a.input.state !== "dormant" ? "door" : was.station;
          if (from === "door" && was.station !== "door") {
            a.at = slot(station("door"), 0);
            a.opacity = 0;
          }
          send(a, from);
        }

        drawSigil(a);
        drawArc(a);
      }
    },

    tick(ms) {
      for (const a of byId.values()) {
        // Walking.
        if (a.legs.length > 0) {
          a.legElapsed += ms;
          const target = a.legs[0]!;
          const span = Math.max(1, distance(a.legFrom, target));
          // Each leg gets a share of the 1.1s in proportion to its length, so a long crossing
          // and a short shuffle move at the same speed rather than taking the same time.
          const legMs = WALK_MS * (span / a.walkLength);
          const t = Math.min(1, a.legElapsed / Math.max(1, legMs));
          const e = easeInOut(t);
          a.at = { x: a.legFrom.x + (target.x - a.legFrom.x) * e, y: a.legFrom.y + (target.y - a.legFrom.y) * e };
          if (t >= 1) {
            a.legFrom = target;
            a.legs.shift();
            a.legElapsed = 0;
          }
        }

        // Fading in on arrival, and out on the way through the door (§8.3).
        const wanted = a.input.state === "dormant" ? 0.4 : a.input.state === "banished" && a.legs.length === 0 ? 0 : 1;
        a.opacity += Math.sign(wanted - a.opacity) * Math.min(Math.abs(wanted - a.opacity), ms / 500);
        a.container.alpha = a.opacity;

        // The ring turns while it works, and slows to a crawl when it stalls (§8.3).
        const period = ringPeriod(a.input.state);
        if (period !== null && !reducedMotion) {
          a.spin += (ms / 1000 / period) * Math.PI * 2;
          a.ring.rotation = a.spin;
        } else {
          a.ring.rotation = 0;
        }

        // Awaiting a seal: a brass dot pulsing at 1s (§7.4). The one thing on this floor that
        // is asking for something, so it is the one thing that blinks.
        a.dot.clear();
        if (a.input.state === "awaiting-seal") {
          const phase = reducedMotion ? 1 : 0.45 + 0.55 * (0.5 + 0.5 * Math.cos((Date.now() / 1000) * Math.PI * 2));
          a.dot.circle(0, -RING_RADIUS, 8).fill({ color: p.brass, alpha: phase });
        }

        // Pixel figures are alive even when their rings are still: a quiet breathing loop at
        // the desks, a firmer bounce while working, and a quick two-step gait while walking.
        // All of it is pinned to the reduced-motion preference in the same place as the sigil.
        if (reducedMotion) {
          a.figure.position.set(0, 0);
          a.figure.scale.set(1);
        } else {
          const moving = a.legs.length > 0;
          const speed = moving ? 11 : a.input.state === "working" ? 7 : 4;
          const wave = Math.sin(Date.now() / 1000 * speed + a.rhythm);
          a.figure.position.set(moving ? wave * 2 : 0, moving ? Math.abs(wave) * -5 : wave * -1.4);
          a.figure.scale.set(1, moving ? 1 + Math.abs(wave) * 0.08 : 1);
        }

        a.container.position.set(a.at.x, a.at.y);
        a.plate.visible = zoom >= PLATE_ZOOM;
      }
    },

    drawThreads(_ms) {
      // Everything on this layer is redrawn every frame, because all of it depends on where a
      // familiar is standing this instant or on a clock. The room underneath is baked and does
      // not move (§8.6).
      threadGraphics.clear();
      const breath = reducedMotion ? 0.5 : 0.5 + 0.2 * Math.sin((Date.now() / 4000) * Math.PI * 2);

      // §8.3: the ward circle's ring lights brass while anyone is standing in it.
      //
      // This is §8.4's first question — "is anything waiting on me?" — and it is meant to be
      // answerable from across the room without picking a small pulsing dot out of a plan. The
      // circle is the largest thing on the floor, so the circle is what changes.
      //
      // The painted floor already has a brass ring there, so a brass line alone changes nothing
      // anyone can see. It is lit with a band of light around the ring as well, which the unlit
      // painting never has.
      if ([...byId.values()].some((a) => a.input.state === "awaiting-seal")) {
        threadGraphics
          .circle(CENTRE.x, CENTRE.y, WARD_RADIUS)
          .stroke({ width: 22, color: p.brass, alpha: reducedMotion ? 0.3 : 0.18 + 0.16 * breath });
        threadGraphics
          .circle(CENTRE.x, CENTRE.y, WARD_RADIUS)
          .stroke({ width: 2.5, color: p.brass, alpha: reducedMotion ? 0.9 : 0.55 + 0.35 * breath });
      }

      // §8.3: a misfired familiar's desk lamp goes dark.
      //
      // The lamp is part of the baked floor, so it cannot be un-drawn — it is covered instead,
      // with the panel colour the desk itself is filled in. Re-baking the whole room to put out
      // one lamp would cost a full vector redraw for a circle seven units across.
      for (const a of byId.values()) {
        if (a.input.state !== "misfired") continue;
        const lamp = deskLamp(station(`desk-${a.input.order}`));
        threadGraphics.circle(lamp.x, lamp.y, 8).fill({ color: p.panel });
        threadGraphics.circle(lamp.x, lamp.y, 7).stroke({ width: 1.5, color: p.rule });
      }

      // §8.3: a 1px brass line from a working familiar to its desk lamp, breathing between 0.3
      // and 0.7 over four seconds. The only ambient motion on the floor, and the first thing
      // §8.6 says to cut if the frame budget is missed.
      for (const a of byId.values()) {
        if (a.input.state !== "working" && a.input.state !== "stalled") continue;
        const lamp = deskLamp(station(`desk-${a.input.order}`));
        threadGraphics
          .moveTo(a.at.x, a.at.y)
          .lineTo(lamp.x, lamp.y)
          .stroke({ width: 1, color: p.brass, alpha: a.input.state === "stalled" ? breath * 0.4 : breath });
      }
    },

    setZoom(next) {
      zoom = next;
    },

    at(point) {
      // Nearest first, so two sigils that do touch answer with the one actually under the mouse.
      let best: { id: string; d: number } | null = null;
      for (const [id, a] of byId) {
        const d = distance(a.at, point);
        if (d <= SIGIL_SIZE / 2 + 6 && (!best || d < best.d)) best = { id, d };
      }
      return best?.id ?? null;
    },

    positionOf(id) {
      return byId.get(id)?.at ?? null;
    },

    clockwise() {
      // §8.5's `Tab` order. Bearing from the room's centre, from the door, going clockwise —
      // which is how the room is read, and stable as familiars move because it is recomputed.
      return [...byId.values()]
        .map((a) => ({
          id: a.input.id,
          bearing: (Math.atan2(a.at.x - CENTRE.x, CENTRE.y - a.at.y) * 180) / Math.PI,
        }))
        .sort((x, y) => ((x.bearing + 360) % 360) - ((y.bearing + 360) % 360))
        .map((x) => x.id);
    },

    moving() {
      return [...byId.values()].some((a) => a.legs.length > 0);
    },

    destroy() {
      for (const a of byId.values()) a.container.destroy({ children: true });
      byId.clear();
      threadGraphics.destroy();
    },
  };
}
