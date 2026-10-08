import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "icons");
const pubDir = join(root, "public");
mkdirSync(outDir, { recursive: true });

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
  ihdr[8] = 8;
  ihdr[9] = 6;
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

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
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
  const hw = size / 2 - 0.5;
  const cornerDist = (x, y) => {
    const dx = Math.abs(x - hw) - (hw - radius);
    const dy = Math.abs(y - hw) - (hw - radius);
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  };
  const top = [0x22, 0x26, 0x30];
  const bottom = [0x0c, 0x0e, 0x13];
  const cx = hw;
  const cy = hw;
  const ringR = size * 0.3;
  const thick = size * 0.075;
  const bandSigma = thick / 4.5;
  const arcs = [
    { start: -60, color: [248, 76, 92] },
    { start: 60, color: [86, 220, 130] },
    { start: 180, color: [96, 140, 255] }, // blue
  ];
  const ARC = 100;
  const FEATHER = 3;
  const angleOf = (x, y) => {
    let a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
    if (a < 0) a += 360;
    return a;
  };
  const arcAlpha = (ang, arc) => {
    const d = (ang - arc.start + 360) % 360;
    if (d > ARC) return 0;
    const edge = Math.min(d, ARC - d);
    if (edge >= FEATHER) return 1;
    return edge / FEATHER;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = cornerDist(x, y);
      const tileA = Math.max(0, Math.min(1, radius + 0.5 - d));
      if (tileA <= 0) continue;
      const t = y / Math.max(1, size - 1);
      const r0 = Math.round(top[0] + (bottom[0] - top[0]) * t);
      const g0 = Math.round(top[1] + (bottom[1] - top[1]) * t);
      const b0 = Math.round(top[2] + (bottom[2] - top[2]) * t);
      put(x, y, r0, g0, b0, Math.round(255 * tileA));
      const dist = Math.hypot(x - cx, y - cy);
      const band = Math.exp(-((dist - ringR) ** 2) / (2 * bandSigma ** 2));
      if (band > 0.05) {
        const ang = angleOf(x, y);
        for (const arc of arcs) {
          const aa = arcAlpha(ang, arc) * band;
          if (aa < 0.02) continue;
          const [cr, cg, cb] = arc.color;
          const boost = 1 + 0.25 * Math.max(0, (dist - ringR) / thick);
          put(x, y, Math.min(255, cr * boost), Math.min(255, cg * boost), Math.min(255, cb * boost), Math.round(245 * aa));
        }
      }
      const coreR = size * 0.07;
      const bloomR = size * 0.14;
      if (dist < bloomR) {
        const bloom = Math.exp(-(dist ** 2) / (2 * (coreR * 0.6) ** 2));
        const core = Math.max(0, 1 - dist / coreR);
        const a = Math.round(255 * Math.min(1, core + 0.18 * bloom));
        put(x, y, 255, 255, 252, a);
      }
    }
  }
  return buf;
}

function renderPngBuffer(size) {
  const rgba = render(size);
  return encodePng(size, size, rgba);
}

for (const size of [32, 128, 256]) {
  writeFileSync(join(outDir, `${size}x${size}.png`), renderPngBuffer(size));
}
writeFileSync(join(outDir, "icon.png"), renderPngBuffer(256));
writeFileSync(join(pubDir, "app-icon.png"), renderPngBuffer(256));

function icoDibEntry(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(0, 20);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      const di = ((size - 1 - y) * size + x) * 4;
      xor[di] = rgba[si + 2];
      xor[di + 1] = rgba[si + 1];
      xor[di + 2] = rgba[si];
      xor[di + 3] = rgba[si + 3];
    }
  }
  const rowBytes = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(rowBytes * size);
  return Buffer.concat([header, xor, and]);
}

function buildIco(entries) {
  const count = entries.length;
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(count, 4);
  const headerSize = 6 + 16 * count;
  const infos = [];
  let offset = headerSize;
  for (const e of entries) {
    const info = Buffer.alloc(16);
    info.writeUInt8(e.size >= 256 ? 0 : e.size, 0);
    info.writeUInt8(e.size >= 256 ? 0 : e.size, 1);
    info.writeUInt8(0, 2);
    info.writeUInt8(0, 3);
    info.writeUInt16LE(1, 4);
    info.writeUInt16LE(32, 6);
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
