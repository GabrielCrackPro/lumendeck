// Generates LumenDeck icons: PNG (32, 128, 256) + ICO wrapping the 256 PNG.
// Pure Node: raw RGBA rasterizer + zlib PNG encoder. Run: pnpm icons.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

// ---------- tiny PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- rasterizer ----------
function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // alpha-over blend
    const na = a / 255;
    const oa = buf[i + 3] / 255;
    const outA = na + oa * (1 - na);
    if (outA <= 0) return;
    buf[i] = Math.round((r * na + buf[i] * oa * (1 - na)) / outA);
    buf[i + 1] = Math.round((g * na + buf[i + 1] * oa * (1 - na)) / outA);
    buf[i + 2] = Math.round((b * na + buf[i + 2] * oa * (1 - na)) / outA);
    buf[i + 3] = Math.round(outA * 255);
  };
  const radius = size * 0.22;
  const inside = (x, y) => {
    // rounded-rect SDF
    const hw = size / 2 - 0.5;
    const dx = Math.abs(x - hw) - (hw - radius);
    const dy = Math.abs(y - hw) - (hw - radius);
    const ox = Math.max(dx, 0);
    const oy = Math.max(dy, 0);
    return Math.hypot(ox, oy) <= radius;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inside(x, y)) continue;
      // diagonal gradient sky -> fuchsia
      const t = (x + y) / (2 * size);
      const r = Math.round(56 + (217 - 56) * t);
      const g = Math.round(189 + (70 - 189) * t);
      const b = Math.round(248 + (239 - 248) * t);
      put(x, y, r, g, b, 255);
    }
  }
  // glow ring (lumen)
  const cx = size / 2;
  const cy = size * 0.46;
  const ringR = size * 0.26;
  const thick = size * 0.055;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const band = Math.max(0, 1 - Math.abs(d - ringR) / thick);
      if (band > 0) put(x, y, 255, 255, 255, Math.round(230 * band));
      // bulb base tick
      const bx = size * 0.36;
      const bwd = size * 0.28;
      if (y > cy + ringR + size * 0.06 && y < cy + ringR + size * 0.14 && x > bx && x < bx + bwd) {
        put(x, y, 255, 255, 255, 200);
      }
    }
  }
  return buf;
}

function renderPngBuffer(size) {
  const rgba = render(size);
  // Wrap raw buffer with row stride already correct; encodePng expects Buffer rgba
  return encodePng(size, size, rgba);
}

for (const size of [32, 128, 256]) {
  writeFileSync(join(outDir, `${size}x${size}.png`), renderPngBuffer(size));
}
writeFileSync(join(outDir, "icon.png"), renderPngBuffer(256));

// ICO with classic 32bpp DIB entries (RC.EXE rejects PNG-compressed entries).
function icoDibEntry(size, rgba) {
  // BITMAPINFOHEADER with doubled height (XOR + AND masks).
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(32, 14); // bpp
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(0, 20); // image size (BI_RGB => may be 0)
  // XOR mask: bottom-up BGRA.
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      const di = ((size - 1 - y) * size + x) * 4;
      xor[di] = rgba[si + 2]; // B
      xor[di + 1] = rgba[si + 1]; // G
      xor[di + 2] = rgba[si]; // R
      xor[di + 3] = rgba[si + 3]; // A
    }
  }
  // AND mask: 1 bit per pixel, rows padded to 32 bits, bottom-up. All zeros
  // (fully opaque); alpha channel governs transparency.
  const rowBytes = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(rowBytes * size);
  return Buffer.concat([header, xor, and]);
}

function buildIco(entries) {
  // entries: { size, data }[] — data is the DIB blob
  const count = entries.length;
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // type icon
  dir.writeUInt16LE(count, 4);
  const headerSize = 6 + 16 * count;
  const infos = [];
  let offset = headerSize;
  for (const e of entries) {
    const info = Buffer.alloc(16);
    info.writeUInt8(e.size >= 256 ? 0 : e.size, 0);
    info.writeUInt8(e.size >= 256 ? 0 : e.size, 1);
    info.writeUInt8(0, 2); // palette
    info.writeUInt8(0, 3); // reserved
    info.writeUInt16LE(1, 4); // planes
    info.writeUInt16LE(32, 6); // bpp
    info.writeUInt32LE(e.data.length, 8);
    info.writeUInt32LE(offset, 12);
    offset += e.data.length;
    infos.push(info);
  }
  return Buffer.concat([dir, ...infos, ...entries.map((e) => e.data)]);
}

const icoEntries = [32, 48, 256].map((s) => ({
  size: s,
  data: icoDibEntry(s, render(s)),
}));
writeFileSync(join(outDir, "icon.ico"), buildIco(icoEntries));

console.log(`icons written to ${outDir}`);
