const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(size, getPixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = getPixel(x, y);
      const p = rowStart + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function drawShield(size) {
  const M = 0.07 * size;
  const topY = 0.04 * size;
  const midY = 0.78 * size;
  const bottomY = size - M;
  const cornerR = 0.14 * size;

  const inRoundedRect = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.max(x0 + r, Math.min(x, x1 - r));
    const cy = Math.max(y0 + r, Math.min(y, y1 - r));
    return Math.hypot(x - cx, y - cy) <= r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
  };

  const inTriangle = (x, y, x0, y0, x1, y1, x2, y2) => {
    const s = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
    const t = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
    const u = (x0 - x2) * (y - y2) - (x - x2) * (y0 - y2);
    return (s >= 0 && t >= 0 && u >= 0) || (s <= 0 && t <= 0 && u <= 0);
  };

  // shield dark teal
  const body = [13, 110, 104];
  const shade = [10, 90, 87];

  return (x, y) => {
    const bodyShape =
      inRoundedRect(x, y, M, topY, size - M, midY, cornerR) ||
      inTriangle(x, y, M, midY, size / 2, bottomY, size - M, midY);
    if (!bodyShape) return [0, 0, 0, 0];

    const grad = y / size;
    let r = body[0] + (shade[0] - body[0]) * grad;
    let g = body[1] + (shade[1] - body[1]) * grad;
    let b = body[2] + (shade[2] - body[2]) * grad;

    if (distToSegment(x, y, 0.30 * size, 0.60 * size, 0.46 * size, 0.72 * size) < 0.075 * size ||
        distToSegment(x, y, 0.46 * size, 0.72 * size, 0.72 * size, 0.40 * size) < 0.07 * size) {
      r = 255; g = 255; b = 255;
    }
    return [r, g, b, 255];
  };
}

const outDir = path.join(__dirname, "..", "assets");
fs.mkdirSync(outDir, { recursive: true });
for (const s of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${s}.png`), encodePNG(s, drawShield(s)));
  console.log(`wrote icon${s}.png`);
}