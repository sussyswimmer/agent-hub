// Everything the floor does when you touch it (§8.5, §8.7).
//
// The canvas has no DOM inside it, so none of this comes free: hover, click, zoom, pan and
// keyboard focus are all worked out here from pointer coordinates and a world transform.
//
// **Every one of these has a twin outside the floor** (§8.7). Clicking a sigil is selecting a
// familiar in the rail; the ward circle is the seal queue in the rail; the lectern is the ledger.
// Nothing is reachable only by hitting the right pixel.

import { Graphics, Point as PixiPoint } from "pixi.js";

import type { Actors } from "./actors";
import { arcAt, type Palette } from "./bake";
import { CENTRE, type Point, SIGIL_SIZE, WARD_RADIUS, distance, station } from "./plan";
import { MAX_ZOOM, MIN_ZOOM, type Stage } from "./stage";

/** §8.5: 120ms in, instant out. Long enough not to flicker across a crowded desk. */
const HOVER_DELAY = 120;

/** How far the pointer may travel between down and up and still count as a click, not a drag. */
const DRAG_SLOP = 4;

export interface Handlers {
  onHover(id: string | null, screen: Point | null): void;
  onSelect(id: string): void;
  /** The ward circle, the lectern and the door: the three pieces of furniture that do something. */
  onStation(id: "ward" | "lectern" | "door"): void;
  /** Focus left the floor entirely — §8.5 sends it back to the roster rail. */
  onEscape(): void;
}

export interface Interaction {
  /** Drawn each frame, because the sigil it rings may be walking. */
  drawFocus(): void;
  focused(): string | null;
  destroy(): void;
}

export function attachInteraction(
  host: HTMLElement,
  stage: Stage,
  actors: Actors,
  p: Palette,
  handlers: Handlers,
): Interaction {
  const ring = new Graphics();
  stage.actors.addChild(ring);

  let focused: string | null = null;
  let hovering: string | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let dragging = false;
  let dragMoved = 0;
  let last = { x: 0, y: 0 };

  const toWorld = (e: { clientX: number; clientY: number }): Point => {
    const box = host.getBoundingClientRect();
    const local = stage.world.toLocal(new PixiPoint(e.clientX - box.left, e.clientY - box.top));
    return { x: local.x, y: local.y };
  };

  /** Which piece of furniture, if any, is under a world point. */
  function furnitureAt(world: Point): "ward" | "lectern" | "door" | null {
    if (distance(world, CENTRE) <= WARD_RADIUS) return "ward";
    if (distance(world, station("lectern").at) <= 70) return "lectern";
    if (distance(world, station("door").at) <= 70) return "door";
    return null;
  }

  function setHover(id: string | null, screen: Point | null) {
    if (id === hovering) return;
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (id === null) {
      // Instant out. A card that lingers while the pointer is somewhere else is a card that
      // is describing the wrong thing.
      hovering = null;
      handlers.onHover(null, null);
      return;
    }
    hoverTimer = setTimeout(() => {
      hovering = id;
      handlers.onHover(id, screen);
    }, HOVER_DELAY);
  }

  function onPointerMove(e: PointerEvent) {
    if (dragging) {
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      stage.setView({ panX: stage.view.panX + dx, panY: stage.view.panY + dy });
      last = { x: e.clientX, y: e.clientY };
      return;
    }
    const world = toWorld(e);
    const id = actors.at(world);
    const box = host.getBoundingClientRect();
    setHover(id, id ? { x: e.clientX - box.left, y: e.clientY - box.top } : null);
    host.style.cursor = id || furnitureAt(world) ? "pointer" : "default";
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    dragging = true;
    dragMoved = 0;
    last = { x: e.clientX, y: e.clientY };
    host.setPointerCapture(e.pointerId);
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
    // A drag that panned the room is not also a click on whatever it started over.
    if (dragMoved > DRAG_SLOP) return;

    const world = toWorld(e);
    const id = actors.at(world);
    if (id) {
      focused = id;
      handlers.onSelect(id);
      return;
    }
    const furniture = furnitureAt(world);
    if (furniture) handlers.onStation(furniture);
  }

  function onPointerLeave() {
    setHover(null, null);
    dragging = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const box = host.getBoundingClientRect();
    const cursor = new PixiPoint(e.clientX - box.left, e.clientY - box.top);

    // Zoom toward the cursor: the world point under it before the change has to be the world
    // point under it after, or the room slides out from under the pointer.
    const before = stage.world.toLocal(cursor);
    const factor = Math.exp(-e.deltaY / 400);
    stage.setView({ zoom: stage.view.zoom * factor });
    const after = stage.world.toLocal(cursor);
    stage.setView({
      panX: stage.view.panX + (after.x - before.x) * stage.scale(),
      panY: stage.view.panY + (after.y - before.y) * stage.scale(),
    });
    actors.setZoom(stage.view.zoom);
  }

  function onDoubleClick(e: MouseEvent) {
    if (actors.at(toWorld(e))) return;
    reset();
  }

  function reset() {
    stage.setView({ zoom: 1, panX: 0, panY: 0 });
    actors.setZoom(1);
  }

  function step(by: number) {
    stage.setView({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, stage.view.zoom * by)) });
    actors.setZoom(stage.view.zoom);
  }

  function cycle(backwards: boolean) {
    const order = actors.clockwise();
    if (order.length === 0) return;
    const current = focused ? order.indexOf(focused) : -1;
    const next = backwards
      ? (current <= 0 ? order.length : current) - 1
      : (current + 1) % order.length;
    focused = order[next] ?? null;
  }

  function onKeyDown(e: KeyboardEvent) {
    switch (e.key) {
      case "Tab":
        // §8.5: Tab cycles the sigils clockwise rather than leaving the floor. Escape is the
        // way out, and every one of these targets also exists in the rail (§8.7), so this is a
        // shortcut through the room and not the only road into it.
        e.preventDefault();
        cycle(e.shiftKey);
        break;
      case "Enter":
      case " ":
        if (focused) {
          e.preventDefault();
          handlers.onSelect(focused);
        }
        break;
      case "Escape":
        focused = null;
        handlers.onEscape();
        break;
      case "+":
      case "=":
        step(1.2);
        break;
      case "-":
      case "_":
        step(1 / 1.2);
        break;
      case "0":
        reset();
        break;
      case "ArrowLeft":
        stage.setView({ panX: stage.view.panX + 40 });
        break;
      case "ArrowRight":
        stage.setView({ panX: stage.view.panX - 40 });
        break;
      case "ArrowUp":
        stage.setView({ panY: stage.view.panY + 40 });
        break;
      case "ArrowDown":
        stage.setView({ panY: stage.view.panY - 40 });
        break;
      default:
        return;
    }
  }

  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointerleave", onPointerLeave);
  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("dblclick", onDoubleClick);
  host.addEventListener("keydown", onKeyDown);

  return {
    drawFocus() {
      ring.clear();
      if (!focused) return;
      const where = actors.positionOf(focused);
      if (!where) return;
      // Brass, and drawn as a broken ring so it reads as an annotation on the plan rather than
      // as another state the familiar might be in.
      const r = SIGIL_SIZE / 2 + 9;
      for (const from of [20, 110, 200, 290]) {
        arcAt(ring, where, r, from, from + 50).stroke({ width: 2.5, color: p.brass, cap: "round" });
      }
    },
    focused: () => focused,
    destroy() {
      if (hoverTimer) clearTimeout(hoverTimer);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointerleave", onPointerLeave);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("dblclick", onDoubleClick);
      host.removeEventListener("keydown", onKeyDown);
      ring.destroy();
    },
  };
}
