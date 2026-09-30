/**
 * Composes the application mark and writes every size the bundler asks for.
 *
 * The mark itself is a Higgsfield generation the owner commissioned — the Grimoire sigil made as
 * an engraved brass medallion — committed at `src/assets/higgsfield/app-mark.png` with its
 * provenance beside it (DECISIONS 0020). What is drawn here, in code, is everything around it:
 * the tile on Apple's 1024 grid, its lamplight, and the medallion's shadow. Then every size is
 * derived from one 1024 composition, so the dock icon and the 16px favicon cannot disagree.
 *
 * The output lands in `src-tauri/icons/`, which stays gitignored: it is a build product. Tauri
 * embeds these at compile time through `generate_context!()`, so they must exist before any Rust
 * build — `beforeDevCommand` and `beforeBuildCommand` in tauri.conf.json both run this first.
 */
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src-tauri", "icons");
const MARK = join(ROOT, "src", "assets", "higgsfield", "app-mark.png");

// Straight from src/theme/tokens.css. Kept as literals because a .css import here would
// drag Tailwind into a plain Bun script for four numbers.
const VOID: RGB = [0x14, 0x13, 0x1a];
const PANEL: RGB = [0x1e, 0x1c, 0x27];
const RULE: RGB = [0x33, 0x2f, 0x40];
const BRASS: RGB = [0xb0, 0x8d, 0x3f];

type RGB = [number, number, number];

/** Premultiplied RGBA in 0..1, row-major. Every operation below stays premultiplied. */
interface Img {
  size: number;
  px: Float32Array;
}

// ── The composition, on Apple's grid ──────────────────────────────────────────────────

const CANVAS = 1024;
/** macOS: an 824 tile centred on the 1024 canvas, with continuous-looking corners. */
const TILE_HALF = 412;
const TILE_RADIUS = 186;
/** How wide the medallion stands on the tile. */
const MARK_SIZE = 700;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function roundedRectDistance(x: number, y: number): number {
  const qx = Math.abs(x) - (TILE_HALF - TILE_RADIUS);
  const qy = Math.abs(y) - (TILE_HALF - TILE_RADIUS);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - TILE_RADIUS;
}

function over(dst: Float32Array, o: number, r: number, g: number, b: number, a: number) {
  // Source premultiplied: r, g, b already carry a.
  const k = 1 - a;
  dst[o] = r + dst[o]! * k;
  dst[o + 1] = g + dst[o + 1]! * k;
  dst[o + 2] = b + dst[o + 2]! * k;
  dst[o + 3] = a + dst[o + 3]! * k;
}

function compose(mark: Img): Img {
  const px = new Float32Array(CANVAS * CANVAS * 4);
  const half = CANVAS / 2;

  // The tile: ink, lifted toward the panel colour where the lamp is (upper left), a hairline of
  // rule colour at its edge. Coverage is analytic, so the corner is smooth at every size.
  for (let y = 0; y < CANVAS; y++) {
    for (let x = 0; x < CANVAS; x++) {
      const cx = x + 0.5 - half;
      const cy = y + 0.5 - half;
      const d = roundedRectDistance(cx, cy);
      const coverage = clamp01(0.5 - d);
      if (coverage === 0) continue;
      const lamp = clamp01(1 - Math.hypot(cx + 150, cy + 190) / 640);
      const glow = lamp * lamp * 0.16;
      const lift = clamp01((TILE_HALF - cy) / (2 * TILE_HALF)) * 0.6;
      const edge = clamp01(1 - Math.abs(d + 2.5) / 1.5) * 0.9;
      const c = [0, 1, 2].map((i) => {
        const base = VOID[i]! + (PANEL[i]! - VOID[i]!) * lift;
        const lit = base + (BRASS[i]! - base) * glow;
        return (lit + (RULE[i]! - lit) * edge) / 255;
      });
      over(px, (y * CANVAS + x) * 4, c[0]! * coverage, c[1]! * coverage, c[2]! * coverage, coverage);
    }
  }

  // The medallion's shadow: its own alpha, blurred and dropped toward the floor of the tile.
  const placed = resample(mark, MARK_SIZE);
  const offset = (CANVAS - MARK_SIZE) / 2;
  const shadow = blurAlpha(placed, 14, 3);
  for (let y = 0; y < MARK_SIZE; y++) {
    for (let x = 0; x < MARK_SIZE; x++) {
      const a = shadow[y * MARK_SIZE + x]! * 0.55;
      const ty = y + offset + 18;
      const tx = x + offset;
      if (a > 0 && ty < CANVAS) over(px, (ty * CANVAS + tx) * 4, 0, 0, 0, a);
    }
  }
  for (let y = 0; y < MARK_SIZE; y++) {
    for (let x = 0; x < MARK_SIZE; x++) {
      const s = (y * MARK_SIZE + x) * 4;
      const a = placed.px[s + 3]!;
      if (a > 0) {
        over(px, ((y + offset) * CANVAS + x + offset) * 4, placed.px[s]!, placed.px[s + 1]!, placed.px[s + 2]!, a);
      }
    }
  }
  return { size: CANVAS, px };
}

// ── Resampling ────────────────────────────────────────────────────────────────────────

/** Area-average resample to `size`: every source pixel contributes by how much of it is covered. */
function resample(src: Img, size: number): Img {
  const ratio = src.size / size;
  const weights: { i: number; w: number }[][] = [];
  for (let d = 0; d < size; d++) {
    const from = d * ratio;
    const to = from + ratio;
    const row: { i: number; w: number }[] = [];
    for (let i = Math.floor(from); i < Math.min(src.size, Math.ceil(to)); i++) {
      const w = Math.min(to, i + 1) - Math.max(from, i);
      if (w > 0) row.push({ i, w: w / ratio });
    }
    weights.push(row);
  }
  // Horizontal, then vertical.
  const mid = new Float32Array(size * src.size * 4);
  for (let y = 0; y < src.size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      for (const { i, w } of weights[x]!) {
        const s = (y * src.size + i) * 4;
        for (let c = 0; c < 4; c++) mid[o + c]! += src.px[s + c]! * w;
      }
    }
  }
  const px = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      for (const { i, w } of weights[y]!) {
        const s = (i * size + x) * 4;
        for (let c = 0; c < 4; c++) px[o + c]! += mid[s + c]! * w;
      }
    }
  }
  return { size, px };
}

/** A box blur of the alpha channel, `passes` times — near enough to a gaussian for a shadow. */
function blurAlpha(img: Img, radius: number, passes: number): Float32Array {
  const n = img.size;
  let a = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) a[i] = img.px[i * 4 + 3]!;
  const span = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    for (const horizontal of [true, false]) {
      const out = new Float32Array(n * n);
      for (let line = 0; line < n; line++) {
        let sum = 0;
        const read = (k: number) => {
          if (k < 0 || k >= n) return 0;
          return horizontal ? a[line * n + k]! : a[k * n + line]!;
        };
        for (let k = -radius; k <= radius; k++) sum += read(k);
        for (let k = 0; k < n; k++) {
          const at = horizontal ? line * n + k : k * n + line;
          out[at] = sum / span;
          sum += read(k + radius + 1) - read(k - radius);
        }
      }
      a = out;
    }
  }
  return a;
}

// ── PNG in ────────────────────────────────────────────────────────────────────────────

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Enough of a PNG decoder for one file this repository controls: 8-bit RGBA, not interlaced. */
function decodePng(file: Buffer, name: string): Img {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${name} is not a PNG.`);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (pos < file.length) {
    const length = file.readUInt32BE(pos);
    const type = file.toString("ascii", pos + 4, pos + 8);
    const data = file.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) {
        throw new Error(`${name} must be 8-bit RGBA and not interlaced. Re-save it that way.`);
      }
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + length;
  }
  if (width !== height) throw new Error(`${name} must be square; it is ${width}×${height}.`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const bytes = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? bytes[y * stride + x - 4]! : 0;
      const b = y > 0 ? bytes[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y > 0 ? bytes[(y - 1) * stride + x - 4]! : 0;
      let v = raw[line + x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`${name} uses an unknown PNG filter (${filter}).`);
      bytes[y * stride + x] = v & 0xff;
    }
  }

  const px = new Float32Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const a = bytes[i * 4 + 3]! / 255;
    px[i * 4] = (bytes[i * 4]! / 255) * a;
    px[i * 4 + 1] = (bytes[i * 4 + 1]! / 255) * a;
    px[i * 4 + 2] = (bytes[i * 4 + 2]! / 255) * a;
    px[i * 4 + 3] = a;
  }
  return { size: width, px };
}

/** Back to straight 8-bit RGBA, then through the encoder below. */
function encode(img: Img): Buffer {
  const out = Buffer.alloc(img.size * img.size * 4);
  for (let i = 0; i < img.size * img.size; i++) {
    const a = img.px[i * 4 + 3]!;
    const un = (v: number) => Math.round(clamp01(a > 0 ? v / a : 0) * 255);
    out[i * 4] = un(img.px[i * 4]!);
    out[i * 4 + 1] = un(img.px[i * 4 + 1]!);
    out[i * 4 + 2] = un(img.px[i * 4 + 2]!);
    out[i * 4 + 3] = Math.round(clamp01(a) * 255);
  }
  return png(out, img.size);
}

// ── PNG out ────────────────────────────────────────────────────────────────────────────────

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

let source: Buffer;
try {
  source = readFileSync(MARK);
} catch {
  throw new Error(`The application mark is missing: ${MARK}. It is committed; check out the repository again.`);
}
const full = compose(decodePng(source, "app-mark.png"));

const SIZES = [16, 32, 64, 128, 256, 512, 1024];
const bySize = new Map<number, Buffer>();
for (const s of SIZES) bySize.set(s, encode(s === CANVAS ? full : resample(full, s)));

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
console.log(`Composed ${files.length} files into src-tauri/icons/ from src/assets/higgsfield/app-mark.png.`);
