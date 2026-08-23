// Generates the PWA icons (solid-color art, no deps) as PNGs.
// Run: node scripts/make-icons.mjs — writes icons/*.png, committed to the repo.
import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt(x, y);
      const o = row + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// pointy-top hexagon membership, R = vertical radius
const inHex = (dx, dy, R) => {
  const q = Math.abs(dx), r = Math.abs(dy);
  return q <= (Math.sqrt(3) / 2) * R && r <= R - q / Math.sqrt(3);
};

const INK = [6, 20, 25];
const PANEL = [16, 38, 46];
const GOLD = [224, 164, 55];
const PARCH = [239, 230, 210];

function art(size) {
  const c = size / 2;
  const R = size * 0.36;
  return png(size, (x, y) => {
    const dx = x - c, dy = y - c;
    if (!inHex(dx, dy, R)) return INK;
    if (!inHex(dx, dy, R * 0.86)) return GOLD;        // hex ring
    // sail: a tall triangle, mast offset slightly left
    const sx = dx + R * 0.05, sy = dy + R * 0.08;
    const inSail = sy > -R * 0.52 && sy < R * 0.18 && sx > 0 && sx < (sy + R * 0.52) * 0.62;
    if (inSail) return PARCH;
    // hull: a shallow trapezoid under the sail
    const hy = dy - R * 0.32;
    if (hy > 0 && hy < R * 0.16 && Math.abs(dx) < R * 0.42 - hy * 0.8) return GOLD;
    return PANEL;
  });
}

mkdirSync("icons", { recursive: true });
for (const size of [512, 192, 180]) {
  writeFileSync(`icons/icon-${size}.png`, art(size));
  console.log(`icons/icon-${size}.png`);
}
