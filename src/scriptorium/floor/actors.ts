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
  FIGURE_HALF_WIDTH,
  FIGURE_REACH,
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
import { PAUSE_MIN, PAUSE_SPREAD, PERSONAL_SPACE, STROLL_SPEED, pick, seeded, wanderArea } from "./wander";

/**
 * §8.3: the walk is 1.1s, ease-in-out, along the waypoints — at least. In the bigger room
 * (DECISIONS 0025) a crossing is long enough that 1.1s was a dash, so a walk goes at a walking
 * pace and takes 1.1s only when it is short.
 */
const WALK_MS = 1100;
const WALK_SPEED = 340;

/** How far one step carries a familiar, in world units: sets the gait against the ground. */
const STEP_LENGTH = 44;

/** The gap left in the ring when a familiar is banished or misfired (§7.4). */
const BREAK_DEGREES = 34;

/**
 * How tall a portrait stands, in the sigil's 100-unit frame, and where its feet fall. The width
 * follows from each image's own proportions, so no figure is stretched to fit a box.
 */
const PORTRAIT_ANCHOR_Y = 0.72;
/** Tall enough that its head reaches `FIGURE_REACH` above its feet, which the plan stands it by. */
const PORTRAIT_HEIGHT = (FIGURE_REACH * 100) / SIGIL_SIZE / PORTRAIT_ANCHOR_Y;
const PORTRAIT_REACH = FIGURE_REACH;

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
  /** Whether the walk under way is a stroll about its own patch rather than a journey. */
  strolling: boolean;
  /** How long it stands before the next stroll, in ms. */
  pause: number;
  /** Its own random source, so its strolls are its own and repeat on a reload. */
  rand: () => number;
  /** Which way the figure faces: 1 as painted, -1 mirrored. It turns to face where it walks. */
  facing: 1 | -1;
  /** How far through its gait, in half-steps; advanced by distance walked, not by time. */
  stride: number;
  /** A drawn shadow under the portrait's feet, which stays on the ground when it steps. */
  shadow: Graphics;
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
  /** True while anyone is on a journey between stations. A stroll about its own patch is not one. */
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
  // Drawn nearest-last, so a familiar standing south of another is in front of it when their
  // figures overlap in passing.
  layer.sortableChildren = true;
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

  /**
   * The figure's own motion. A gait while it walks, and while it stands, something that says
   * what it is doing: breathing when idle, a quick nod over the desk while it works, shifting
   * its weight while it waits on a seal, slumped when bound. The figure only — the ring, the arc
   * and the dot are marks on a plan and stay put (§8.3). All of it stops with motion reduced
   * (§8.7), and none of it moves the familiar off where it stands.
   */
  function animate(a: Actor, now: number, ms: number) {
    if (reducedMotion) {
      a.figure.position.set(0, 0);
      a.figure.rotation = 0;
      a.figure.scale.set(1, 1);
      a.shadow.scale.set(1, 1);
      return;
    }
    if (a.legs.length > 0) {
      // Two steps a stride, counted in distance so the feet keep pace with the ground: up on
      // each step, a lean into it, a little squash as it lands.
      const step = Math.sin(a.stride * Math.PI);
      const lift = Math.abs(step);
      a.figure.position.set(0, -lift * 7);
      a.figure.rotation = step * 0.07;
      a.figure.scale.set(a.facing * (1 - lift * 0.02), 1 + lift * 0.05);
      a.shadow.scale.set(1 - lift * 0.18, 1);
      return;
    }
    a.shadow.scale.set(1, 1);
    const r = a.rhythm;
    switch (a.input.state) {
      case "working": {
        // At the desk, turned to its lamp, nodding over the work as if writing.
        const lamp = deskLamp(station(`desk-${a.input.order}`));
        a.facing = lamp.x < a.at.x ? -1 : 1;
        const nod = Math.abs(Math.sin(now * 5.2 + r));
        a.figure.position.set(0, -nod * 2.4);
        a.figure.rotation = a.facing * 0.05 + Math.sin(now * 2.6 + r) * 0.025;
        a.figure.scale.set(a.facing, 1 - nod * 0.02);
        return;
      }
      case "awaiting-seal": {
        // Shifting its weight from foot to foot: waiting on you.
        const sway = Math.sin(now * 2.2 + r);
        a.figure.position.set(sway * 1.5, -Math.abs(sway) * 1.2);
        a.figure.rotation = sway * 0.06;
        a.figure.scale.set(a.facing, 1);
        return;
      }
      case "bound": {
        a.figure.position.set(0, 2);
        a.figure.rotation = 0;
        a.figure.scale.set(a.facing, 0.95);
        return;
      }
      case "stalled": {
        const drift = Math.sin(now * 0.7 + r);
        a.figure.position.set(0, -drift);
        a.figure.rotation = drift * 0.02;
        a.figure.scale.set(a.facing, 1);
        return;
      }
      case "misfired":
      case "banished": {
        a.figure.position.set(0, 0);
        a.figure.rotation = 0;
        a.figure.scale.set(a.facing, 1);
        return;
      }
      default: {
        // Idle or resting: breathing, and every so often a look the other way.
        const breath = Math.sin(now * 1.7 + r);
        a.figure.position.set(0, -breath * 0.8);
        a.figure.rotation = 0;
        a.figure.scale.set(a.facing, 1 + breath * 0.018);
        if (a.rand() < ms / 9000) a.facing = a.facing === 1 ? -1 : 1;
      }
    }
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
    const shadow = new Graphics();
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
      // Where the painted feet are: the anchor, plus what of the figure lies below it.
      const feet = 5 + PORTRAIT_HEIGHT * (1 - PORTRAIT_ANCHOR_Y) - 8;
      shadow.ellipse(0, feet, 30, 8).fill({ color: p.void, alpha: 0.42 });
    }
    const arc = new Graphics();
    const dot = new Graphics();
    ring.addChild(ringMark);

    const plate = new Text({
      text: input.name,
      // Outlined in the void so the name reads on lit flagstone as well as on the plain plan.
      style: {
        fontFamily: "Junicode, EB Garamond, Georgia, serif",
        // World units, like everything else here. 19 read as about 9 pixels on a laptop, which is
        // to say it did not read; 32 is about 15 (DECISIONS 0028).
        fontSize: 32,
        fill: p.boneDim,
        stroke: { color: p.void, width: 4, join: "round" },
      },
    });
    plate.anchor.set(0.5, 0);
    plate.resolution = 2;

    // The sigil is drawn in its own 100-unit frame and scaled to the 44 §8.3 asks for, so the
    // geometry module never has to know how big the floor draws things.
    const marks = new Container();
    marks.addChild(shadow, figure, ring, arc, dot);
    marks.scale.set(SIGIL_SIZE / 100);
    container.addChild(marks);

    plate.position.set(0, SIGIL_SIZE / 2 + 6);
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
      strolling: false,
      pause: 0,
      rand: seeded(hash(input.id)),
      facing: 1,
      stride: 0,
      shadow,
    };
    actor.pause = firstPause(actor);
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
    a.strolling = false;
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
    // A moment to settle in before it starts pottering about.
    a.pause = PAUSE_MIN + a.rand() * PAUSE_SPREAD;
  }

  /** A first stroll staggered per familiar, so a room that opens does not all set off at once. */
  function firstPause(a: Actor): number {
    return 600 + a.rand() * (PAUSE_MIN + PAUSE_SPREAD);
  }

  /**
   * Set off on a stroll, if it has a patch to wander and somewhere in it is free.
   *
   * A third of the time it heads home, so over an afternoon it stays about its own place rather
   * than drifting to one edge of its patch. Anywhere within arm's reach of another familiar, or
   * of where another is heading, is passed over (§8.2: never overlap two sigils).
   */
  function stroll(a: Actor) {
    const area = wanderArea(a.input.state, a.stationId, a.slotIndex);
    if (!area) return;
    const home = slot(station(a.stationId), a.slotIndex);
    const others = [...byId.values()].filter((o) => o !== a);
    const clear = (q: Point) =>
      others.every(
        (o) =>
          distance(o.at, q) >= PERSONAL_SPACE &&
          (o.legs.length === 0 || distance(o.legs[o.legs.length - 1]!, q) >= PERSONAL_SPACE),
      );
    for (let tries = 0; tries < 6; tries++) {
      const target = tries === 0 && a.rand() < 0.33 ? home : pick(area, a.rand);
      if (distance(target, a.at) < 14 || !clear(target)) continue;
      a.legs = [target];
      a.legFrom = a.at;
      a.legElapsed = 0;
      a.walkLength = distance(a.at, target);
      a.strolling = true;
      return;
    }
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
      const now = Date.now() / 1000;
      for (const a of byId.values()) {
        // Standing about, until it is time for a stroll. Never with motion reduced (§8.7).
        if (a.legs.length === 0 && !reducedMotion) {
          a.pause -= ms;
          if (a.pause <= 0) {
            a.pause = PAUSE_MIN + a.rand() * PAUSE_SPREAD;
            stroll(a);
          }
        }

        // Walking.
        const was = a.at;
        if (a.legs.length > 0) {
          a.legElapsed += ms;
          const target = a.legs[0]!;
          const span = Math.max(1, distance(a.legFrom, target));
          // Each leg gets a share of the whole walk's time in proportion to its length, so a
          // long crossing and a short shuffle move at the same speed rather than taking the
          // same time. A stroll goes at an amble.
          const total = a.strolling
            ? (a.walkLength / STROLL_SPEED) * 1000
            : Math.max(WALK_MS, (a.walkLength / WALK_SPEED) * 1000);
          const legMs = total * (span / a.walkLength);
          const t = Math.min(1, a.legElapsed / Math.max(1, legMs));
          // A walk of one leg eases in and out. A journey of several keeps an even pace from
          // leg to leg — easing each one stopped the familiar dead at every waypoint.
          const e = a.walkLength - span < 1 ? easeInOut(t) : t;
          a.at = { x: a.legFrom.x + (target.x - a.legFrom.x) * e, y: a.legFrom.y + (target.y - a.legFrom.y) * e };
          // Turn to face the way it is going, when that is more than straight up or down.
          const dx = target.x - a.legFrom.x;
          if (Math.abs(dx) > 4) a.facing = dx < 0 ? -1 : 1;
          if (t >= 1) {
            a.legFrom = target;
            a.legs.shift();
            a.legElapsed = 0;
            if (a.legs.length === 0) a.strolling = false;
          }
        }
        a.stride += distance(was, a.at) / STEP_LENGTH;

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

        animate(a, now, ms);

        a.container.position.set(a.at.x, a.at.y);
        a.container.zIndex = a.at.y;
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
        // The ring, or the figure standing in it: a portrait's head is well above the ring,
        // and a click on a familiar's head that selected nothing would be a click wasted.
        const dx = point.x - a.at.x;
        const dy = point.y - a.at.y;
        const onFigure =
          a.portrait !== null && Math.abs(dx) <= FIGURE_HALF_WIDTH && dy >= -PORTRAIT_REACH && dy <= SIGIL_SIZE / 2;
        if ((d <= SIGIL_SIZE / 2 + 6 || onFigure) && (!best || d < best.d)) best = { id, d };
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
      return [...byId.values()].some((a) => a.legs.length > 0 && !a.strolling);
    },

    destroy() {
      for (const a of byId.values()) a.container.destroy({ children: true });
      byId.clear();
      threadGraphics.destroy();
    },
  };
}
