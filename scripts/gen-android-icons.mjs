// 从已生成的 PWA 图标派生出安卓各密度图标（用 canvas 重采样，避免再写一遍 PNG 编码）
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const SRC = join(ROOT, 'public', 'icons', 'icon-512.png');

const b64 = readFileSync(SRC).toString('base64');
const dataUrl = 'data:image/png;base64,' + b64;

// 密度 -> 启动图标尺寸
const DENSITY = [
  ['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]
];

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

async function draw(size, mode) {
  return page.evaluate(async (url, size, mode) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');

    if (mode === 'circle') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 0, 0, size, size);
      ctx.restore();
      // 圆形图标常见做法：再套一圈留白，这里直接输出裁好的圆
      return cv.toDataURL('image/png');
    }

    if (mode === 'foreground') {
      // 自适应图标前景：整块 108 单位，内容放在中间安全区（约 66%）
      const inner = Math.round(size * 0.66);
      const off = Math.round((size - inner) / 2);
      ctx.drawImage(img, off, off, inner, inner);
      return cv.toDataURL('image/png');
    }

    ctx.drawImage(img, 0, 0, size, size);
    return cv.toDataURL('image/png');
  }, dataUrl, size, mode);
}

let n = 0;
for (const [density, size] of DENSITY) {
  const dir = join(RES, 'mipmap-' + density);
  mkdirSync(dir, { recursive: true });
  const fgSize = Math.round(size * 108 / 48);   // 108dp 画布
  const jobs = [
    ['ic_launcher.png', size, 'square'],
    ['ic_launcher_round.png', size, 'circle'],
    ['ic_launcher_foreground.png', fgSize, 'foreground']
  ];
  for (const [name, px, mode] of jobs) {
    const url = await draw(px, mode);
    writeFileSync(join(dir, name), Buffer.from(url.split(',')[1], 'base64'));
    n++;
  }
  console.log('  mipmap-' + density + '  启动图标 ' + size + 'px  前景 ' + fgSize + 'px');
}

await browser.close();
console.log('  共生成 ' + n + ' 个图标文件');
