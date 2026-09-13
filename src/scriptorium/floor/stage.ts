// The canvas, its three layers, and the rule about when any of it is allowed to cost anything
// (§8.6).
//
// One `Application`. Three layers, in the order they are read: the room, which is baked and
// blitted; the threads of ink, which are the only thing redrawn every frame; and the familiars.
//
// **A floor nobody is looking at costs nothing.** The ticker runs at 60 while the window is
// focused, drops to 20 when it is not, and stops outright when the floor is not the visible tab.
// Stopping is not throttling: a stopped ticker renders no frames at all, which is the difference
// between a background window at 0% and one quietly burning a core to redraw a hidden canvas.

import { Application, Container, Sprite, type Renderer, Ticker } from "pixi.js";

import { type Baked, bake } from "./bake";
import { CENTRE, WORLD } from "./plan";

export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 2.0;

/** §8.6: honour the display, but a 3× panel does not get a 3× framebuffer for this. */
const MAX_RESOLUTION = 2;

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Stage {
  app: Application;
  renderer: Renderer;
  canvas: HTMLCanvasElement;
  /** Pans and zooms. Everything in the room is a child of this. */
  world: Container;
  threads: Container;
  actors: Container;
  view: View;
  /** How many world units one CSS pixel covers at the current view. */
  scale(): number;
  setView(next: Partial<View>): void;
  resize(width: number, height: number): void;
  setVisible(visible: boolean): void;
  setFocused(focused: boolean): void;
  /** Frames actually rendered, and the ticker's own reading. §10 asks for its number, not a feel. */
  stats: { frames: number; fps: number; running: boolean };
  destroy(): void;
}

export async function createStage(host: HTMLElement): Promise<Stage> {
  const app = new Application();
  await app.init({
    preference: "webgl",
    antialias: true,
    resolution: Math.min(globalThis.devicePixelRatio || 1, MAX_RESOLUTION),
    autoDensity: true,
    backgroundAlpha: 0,
    // The application's own ticker is the one thing that must not start on its own: the floor
    // may well be mounted into a tab nobody is looking at.
    autoStart: false,
  });

  // Pixi sizes the canvas in CSS pixels, and until the first `resize` that size is its own
  // idea rather than the host's. Left to itself it can be wider than the pane it sits in.
  app.canvas.style.display = "block";
  app.canvas.style.maxWidth = "100%";
  app.canvas.style.maxHeight = "100%";
  host.appendChild(app.canvas);

  const world = new Container();
  const staticLayer = new Container();
  const threads = new Container();
  const actors = new Container();
  world.addChild(staticLayer, threads, actors);
  app.stage.addChild(world);

  const view: View = { zoom: 1, panX: 0, panY: 0 };
  let width = host.clientWidth || 1;
  let height = host.clientHeight || 1;
  let visible = true;
  let focused = true;
  let baked: Baked | null = null;
  const floor = new Sprite();
  staticLayer.addChild(floor);

  /** The room letterboxed into the viewport, before the reader's own zoom. */
  const fit = () => Math.min(width, height) / WORLD;
  const scale = () => fit() * view.zoom;

  function applyView() {
    const s = scale();
    world.scale.set(s);
    world.position.set(width / 2 - CENTRE.x * s + view.panX, height / 2 - CENTRE.y * s + view.panY);
  }

  /**
   * Re-draw the room, but only when the answer would differ.
   *
   * §8.6 allows two reasons: the viewport changed size, so the texture wants a different number
   * of texels; or the zoom crossed 0.9×, where the station labels come and go. Re-baking on
   * every zoom step would mean a full vector re-draw per wheel notch.
   */
  function rebake(force = false) {
    const plates = view.zoom >= 0.9;
    if (!force && baked && baked.plates === plates) return;
    baked?.destroy();
    baked = bake(app.renderer, scale() * (globalThis.devicePixelRatio || 1));
    floor.texture = baked.texture;
    floor.setSize(WORLD, WORLD);
  }

  const stats = { frames: 0, fps: 0, running: false };
  app.ticker.add(() => {
    stats.frames++;
    stats.fps = app.ticker.FPS;
  });

  function applyTickerPolicy() {
    if (!visible) {
      app.ticker.stop();
      stats.running = false;
      return;
    }
    app.ticker.maxFPS = focused ? 60 : 20;
    if (!stats.running) {
      app.ticker.start();
      stats.running = true;
    }
  }

  function resize(nextWidth: number, nextHeight: number) {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    app.renderer.resize(width, height);
    applyView();
    rebake(true);
  }

  resize(width, height);
  applyTickerPolicy();

  return {
    app,
    renderer: app.renderer,
    canvas: app.canvas,
    world,
    threads,
    actors,
    view,
    scale,
    stats,
    setView(next) {
      if (next.zoom !== undefined) {
        view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next.zoom));
      }
      if (next.panX !== undefined) view.panX = next.panX;
      if (next.panY !== undefined) view.panY = next.panY;
      applyView();
      rebake();
    },
    resize,
    setVisible(next) {
      visible = next;
      applyTickerPolicy();
    },
    setFocused(next) {
      focused = next;
      applyTickerPolicy();
    },
    destroy() {
      app.ticker.stop();
      baked?.destroy();
      // `destroy` on the application takes the canvas, the renderer and every texture it made.
      app.destroy({ removeView: true }, { children: true });
    },
  };
}

export { Ticker };
