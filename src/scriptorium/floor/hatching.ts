// The hatch that fills the wall, drawn rather than fetched (§1: every visual is generated).
//
// A plan hatches a wall with close parallel strokes. Drawing every stroke of a 470-unit annulus
// as geometry is hundreds of lines for something that is, by construction, the same eight pixels
// over and over — so it is one small tile, made once, and repeated.

import { Texture } from "pixi.js";

/** The tile's side. Small enough to stay in cache, large enough that the repeat is not a moiré. */
const TILE = 16;

let cached: Texture | null = null;

/**
 * The hatch tile: 45° hairlines on nothing.
 *
 * Transparent rather than filled, so the wall's own colour shows between the strokes and the
 * tile can sit over whatever the floor is without carrying a background with it.
 */
export function hatchTexture(): Texture {
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    // No 2D context is not a reason to have no floor. An empty texture leaves the wall as two
    // hairlines with nothing between them, which is still a wall.
    cached = Texture.EMPTY;
    return cached;
  }

  ctx.strokeStyle = "rgba(201, 191, 164, 0.42)";
  ctx.lineWidth = 1;
  // Three strokes, offset by the tile so the pattern joins itself at every edge.
  for (const offset of [-TILE, 0, TILE]) {
    ctx.beginPath();
    ctx.moveTo(offset, TILE);
    ctx.lineTo(offset + TILE, 0);
    ctx.stroke();
  }

  cached = Texture.from(canvas);
  // Both axes, and on the source's style rather than only the shorthand: clamped at its edges
  // the "repeat" is one tile and a long smear of its last column, which is what the wall looked
  // like — patches of hatching in two places and bare hairline everywhere else.
  cached.source.style.addressModeU = "repeat";
  cached.source.style.addressModeV = "repeat";
  cached.source.style.update();
  return cached;
}

/** Tests build more than one floor in one process; the tile is per-document, not per-floor. */
export function forgetHatch() {
  cached = null;
}

export const _tile = TILE;
