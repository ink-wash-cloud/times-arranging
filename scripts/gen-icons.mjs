// 生成 PWA 图标：手写 PNG 编码，仅依赖 node:zlib
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function mix(a, b, t) { return a + (b - a) * t; }

function render(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const pad = maskable ? size * 0.10 : 0;
  const radius = maskable ? 0 : size * 0.22;
  const cx = size / 2, cy = size / 2;

  const inRounded = (x, y) => {
    const l = pad, r = size - pad, t = pad, b = size - pad;
    const rx = radius * (1 - pad / size * 2);
    if (x < l || x > r || y < t || y > b) return false;
    const pts = [[l + rx, t + rx, -1, -1], [r - rx, t + rx, 1, -1], [l + rx, b - rx, -1, 1], [r - rx, b - rx, 1, 1]];
    if (x > l + rx && x < r - rx) return true;
    if (y > t + rx && y < b - rx) return true;
    for (const [px, py, sx, sy] of pts) {
      if ((x - px) * sx > 0 && (y - py) * sy > 0) return ((x - px) ** 2 + (y - py) ** 2) <= rx * rx;
    }
    return true;
  };

  // 日历图形参数（相对尺寸）
  const cw = size * 0.52, chh = size * 0.44;
  const cl = cx - cw / 2, ct = cy - chh / 2 + size * 0.035;
  const barH = size * 0.11;
  const lineR = size * 0.022;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;

      if (inRounded(x + 0.5, y + 0.5)) {
        const t = (x / size) * 0.5 + (y / size) * 0.5;
        r = mix(0x6d, 0xa0, t); g = mix(0x8b, 0x6b, t); b = mix(0xff, 0xff, t);
        a = 255;
      }

      if (a > 0) {
        // 顶部挂环（圆头）
        const ringY = ct - size * 0.028;
        const rw = size * 0.026, rh = size * 0.048;
        for (const rx of [cx - cw * 0.28, cx + cw * 0.28]) {
          const dx = Math.abs(x - rx);
          const dy = Math.abs(y - ringY);
          const inRect = dx < rw && dy < rh;
          const inCap = dy >= rh && Math.hypot(dx, dy - rh) < rw;
          if (inRect || inCap) { r = 255; g = 255; b = 255; }
        }
        // 日历主体
        if (x > cl && x < cl + cw && y > ct && y < ct + chh) {
          r = 255; g = 255; b = 255;
          // 顶部色条
          if (y < ct + barH) { r = 0x2b; g = 0x33; b = 0x66; }
          else {
            // 网格点
            for (let row = 0; row < 2; row++) {
              for (let col = 0; col < 3; col++) {
                const dx = cl + cw * (0.22 + col * 0.28);
                const dy = ct + barH + chh * (0.26 + row * 0.30);
                if ((x - dx) ** 2 + (y - dy) ** 2 < (size * 0.030) ** 2) { r = 0x6d; g = 0x8b; b = 0xff; }
              }
            }
            // 对勾
            const inner = chh - barH;
            const p1 = [cl + cw * 0.30, ct + barH + inner * 0.66];
            const p2 = [cl + cw * 0.44, ct + barH + inner * 0.82];
            const p3 = [cl + cw * 0.70, ct + barH + inner * 0.34];
            const near = (p, q, w) => {
              const dx = q[0] - p[0], dy = q[1] - p[1];
              const L2 = dx * dx + dy * dy;
              let t = L2 ? ((x - p[0]) * dx + (y - p[1]) * dy) / L2 : 0;
              t = Math.max(0, Math.min(1, t));
              return Math.hypot(x - (p[0] + t * dx), y - (p[1] + t * dy)) < w;
            };
            if (near(p1, p2, lineR * 1.35) || near(p2, p3, lineR * 1.35)) { r = 0x16; g = 0xa3; b = 0x4a; }
          }
        }
      }
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
    }
  }
  return png(size, size, buf);
}

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false]
];
for (const [name, size, maskable] of targets) {
  writeFileSync(join(OUT, name), render(size, maskable));
  console.log('生成', name, size + 'x' + size);
}

/** 把 32x32 的 PNG 包成 ICO，避免浏览器请求 /favicon.ico 时 404 */
function toIco(pngBuf, size) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);   // reserved
  dir.writeUInt16LE(1, 2);   // type: icon
  dir.writeUInt16LE(1, 4);   // count
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;   // width
  entry[1] = size >= 256 ? 0 : size;   // height
  entry[2] = 0;                        // palette
  entry[3] = 0;                        // reserved
  entry.writeUInt16LE(1, 4);           // planes
  entry.writeUInt16LE(32, 6);          // bpp
  entry.writeUInt32BE(0, 8);
  entry.writeUInt32LE(pngBuf.length, 8);  // bytes in resource
  entry.writeUInt32LE(22, 12);            // offset
  return Buffer.concat([dir, entry, pngBuf]);
}
const icoOut = join(__dirname, '..', 'public', 'favicon.ico');
writeFileSync(icoOut, toIco(render(32, false), 32));
console.log('生成 favicon.ico  32x32');
