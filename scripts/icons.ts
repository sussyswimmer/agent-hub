/**
 * Draws the application mark and writes every size the bundler asks for.
 *
 * §1 of CLAUDE.md forbids vendored art. Nothing here is vendored: the mark is the same
 * deterministic sigil the roster draws, rasterised by the small signed-distance routines
 * below, and the output lands in a gitignored folder so no image file ever enters the repo.
 * Tauri embeds these at compile time through `generate_context!()`, so they must exist before
 * any Rust build — `bun run dev` included. `beforeDevCommand` and `beforeBuildCommand` in
 * tauri.conf.json both run this first; `bun run icons` re-draws them by hand.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RING_RADIUS, polar, sigilGeometry } from "../src/ui/sigil-geometry";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src-tauri", "icons");

// Straight from src/theme/tokens.css. Kept as literals because a .css import here would
// drag Tailwind into a plain Bun script for four numbers.
const VOID: RGB = [0x14, 0x13, 0x1a];
const BRASS: RGB = [0xb0, 0x8d, 0x3f];
const BONE: RGB = [0xc9, 0xbf, 0xa4];

type RGB = [number, number, number];
type Pt = [number, number];

/** One drawable: a signed distance in viewBox units, plus what to paint where it is ≤ 0. */
interface Shape {
  sdf: (x: number, y: number) => number;
  colour: RGB;
}

const ring = (r: number, w: number, colour: RGB): Shape => ({
  colour,
  sdf: (x, y) => Math.abs(Math.hypot(x, y) - r) - w / 2,
});

const disc = (c: Pt, r: number, colour: RGB): Shape => ({
  colour,
  sdf: (x, y) => Math.hypot(x - c[0], y - c[1]) - r,
});

/** A segment with round caps: the distance from a point to the segment, less half the width. */
const bar = (a: Pt, b: Pt, w: number, colour: RGB): Shape => ({
  colour,
  sdf: (x, y) => {
    const [ax, ay] = a;
    const vx = b[0] - ax;
    const vy = b[1] - ay;
    const len2 = vx * vx + vy * vy || 1;
    let t = ((x - ax) * vx + (y - ay) * vy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(x - (ax + t * vx), y - (ay + t * vy)) - w / 2;
  },
});

/** The mark itself, in the same -50..50 viewBox the Sigil component uses. */
function mark(): Shape[] {
  const g = sigilGeometry("Grimoire");
  const shapes: Shape[] = [ring(RING_RADIUS, 5, BRASS)];

  for (const s of g.strokes) {
    shapes.push(bar(polar(s.angle, s.inner), polar(s.angle, s.outer), s.width, BRASS));
  }

  // A fixed interior lozenge rather than the hashed glyph: the app mark should not change
  // shape if the glyph table is ever extended. Four bars and a centre dot, all segments.
  const r = 13;
  const pts: Pt[] = [
    [0, -r],
    [r, 0],
    [0, r],
    [-r, 0],
  ];
  for (let i = 0; i < 4; i++) shapes.push(bar(pts[i]!, pts[(i + 1) % 4]!, 4, BONE));
  shapes.push(disc([0, 0], 3.2, BONE));

  return shapes;
}

const SHAPES = mark();

/** 3×3 supersampling. Enough at 32px, and the largest icon is only a megapixel. */
const SS = 3;

function render(size: number): Buffer {
  const px = Buffer.alloc(size * size * 4);
  // Leave a margin so the mark is not flush to the tile edge on macOS.
  const scale = size / 108;
  const half = size / 2;

  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      const acc: [number, number, number] = [0, 0, 0];
      let n = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxi + (sx + 0.5) / SS - half) / scale;
          const y = (py + (sy + 0.5) / SS - half) / scale;
          let c: RGB = VOID;
          let best = Infinity;
          for (const s of SHAPES) {
            const d = s.sdf(x, y);
            if (d <= 0 && d < best) {
              best = d;
              c = s.colour;
            }
          }
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
          n++;
        }
      }
      const o = (py * size + pxi) * 4;
      px[o] = Math.round(acc[0] / n);
      px[o + 1] = Math.round(acc[1] / n);
      px[o + 2] = Math.round(acc[2] / n);
      px[o + 3] = 255;
    }
  }
  return png(px, size);
}

// ── PNG ────────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(rgba: Buffer, size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte (0, "None") in front of each scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Containers ─────────────────────────────────────────────────────────────────────────

/** ICO is a directory of images; Windows Vista and later accept PNG payloads directly. */
function ico(entries: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir: Buffer[] = [];
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d[0] = e.size >= 256 ? 0 : e.size; // 0 means 256
    d[1] = e.size >= 256 ? 0 : e.size;
    d.writeUInt16LE(1, 4); // colour planes
    d.writeUInt16LE(32, 6); // bits per pixel
    d.writeUInt32LE(e.data.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.data.length;
    dir.push(d);
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
}

/** ICNS is a tagged chunk list; the ic07..ic14 tags take PNG data as-is. */
function icns(entries: { tag: string; data: Buffer }[]): Buffer {
  const chunks = entries.map((e) => {
    const head = Buffer.alloc(8);
    head.write(e.tag, 0, 4, "ascii");
    head.writeUInt32BE(e.data.length + 8, 4);
    return Buffer.concat([head, e.data]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, 4, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

// ── Write ──────────────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });

const SIZES = [16, 32, 64, 128, 256, 512, 1024];
const bySize = new Map<number, Buffer>();
for (const s of SIZES) bySize.set(s, render(s));

const files: [string, Buffer][] = [
  ["32x32.png", bySize.get(32)!],
  ["128x128.png", bySize.get(128)!],
  ["128x128@2x.png", bySize.get(256)!],
  ["icon.png", bySize.get(512)!],
  ["icon.ico", ico([32, 64, 128, 256].map((size) => ({ size, data: bySize.get(size)! })))],
  [
    "icon.icns",
    icns([
      { tag: "icp4", data: bySize.get(16)! },
      { tag: "icp5", data: bySize.get(32)! },
      { tag: "ic11", data: bySize.get(32)! },
      { tag: "ic12", data: bySize.get(64)! },
      { tag: "ic07", data: bySize.get(128)! },
      { tag: "ic13", data: bySize.get(256)! },
      { tag: "ic08", data: bySize.get(256)! },
      { tag: "ic14", data: bySize.get(512)! },
      { tag: "ic09", data: bySize.get(512)! },
      { tag: "ic10", data: bySize.get(1024)! },
    ]),
  ],
];

for (const [name, data] of files) {
  writeFileSync(join(OUT, name), data);
  console.log(`  ${name.padEnd(16)} ${(data.length / 1024).toFixed(1)} kB`);
}
console.log(`Drew ${files.length} files into src-tauri/icons/ (gitignored; §1 forbids vendored art).`);
