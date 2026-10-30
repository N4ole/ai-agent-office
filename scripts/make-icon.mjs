// Generates build/icon.png (256x256 pixel-art agent at a desk) with no image dependency.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const N = 32, S = 8, W = N * S;
const px = Array.from({ length: N }, () => Array(N).fill(null));
const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (i >= 0 && j >= 0 && i < N && j < N) px[j][i] = c; };
rect(0, 0, 32, 32, [27, 27, 42]); rect(1, 1, 30, 30, [36, 36, 58]);
rect(2, 2, 28, 9, [77, 171, 247]); rect(2, 10, 28, 1, [27, 27, 38]); rect(15, 2, 2, 9, [27, 27, 38]);
rect(11, 9, 10, 2, [43, 29, 22]); rect(10, 11, 12, 2, [43, 29, 22]); rect(11, 13, 10, 5, [246, 211, 179]);
rect(13, 14, 2, 2, [27, 27, 38]); rect(17, 14, 2, 2, [27, 27, 38]); rect(14, 17, 4, 1, [201, 142, 102]);
rect(9, 18, 14, 6, [232, 89, 12]); rect(9, 22, 2, 2, [246, 211, 179]); rect(21, 22, 2, 2, [246, 211, 179]);
rect(4, 24, 24, 3, [192, 138, 82]); rect(4, 27, 24, 3, [125, 85, 48]);
rect(22, 17, 7, 6, [33, 37, 41]); rect(23, 18, 5, 4, [105, 219, 124]); rect(25, 23, 1, 1, [33, 37, 41]);
rect(3, 12, 6, 4, [248, 249, 250]); rect(4, 13, 1, 1, [92, 95, 102]); rect(6, 13, 1, 1, [92, 95, 102]); rect(8, 16, 1, 1, [248, 249, 250]);
const raw = Buffer.alloc((W * 4 + 1) * W);
for (let y = 0; y < W; y++) {
  raw[y * (W * 4 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const c = px[Math.floor(y / S)][Math.floor(x / S)] ?? [0, 0, 0];
    const o = y * (W * 4 + 1) + 1 + x * 4;
    raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
  }
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
mkdirSync('build', { recursive: true }); mkdirSync('src/renderer/public', { recursive: true });
writeFileSync('build/icon.png', png); writeFileSync('src/renderer/public/icon.png', png);
console.log('icon written', png.length, 'bytes');
