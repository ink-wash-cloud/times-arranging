// 相册背景：验证「从相册选图」这条路真的能把背景换掉
import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 不传网址就自己起一台隔离服务器，免得连累正在用的那份数据
const URL = process.argv[2] || await startIsolatedServer(8796);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync('shots12', { recursive: true });
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 950, deviceScaleFactor: 2 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(3000);
await p.evaluate(() => { location.hash = '#settings'; });
await sleep(1500);

// 造一张测试图片（紫绿渐变，一眼能认出来）
const png = await p.evaluate(async () => {
  const cv = document.createElement('canvas');
  cv.width = 800; cv.height = 600;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 800, 600);
  grad.addColorStop(0, '#7b4bd6'); grad.addColorStop(1, '#2fbf8f');
  g.fillStyle = grad; g.fillRect(0, 0, 800, 600);
  g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.fillText('我的背景', 90, 320);
  return cv.toDataURL('image/png');
});
const tmp = join(ROOT, 'shots12', 'bg-test.png');
writeFileSync(tmp, Buffer.from(String(png).split(',')[1], 'base64'));

const info = await p.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.card')).find((x) => x.innerText.includes('自定义图片'));
  if (!card) return { found: false };
  const btn = Array.from(card.querySelectorAll('button')).find((x) => x.innerText.includes('自定义图片'));
  if (btn) btn.click();
  return { found: true };
});
console.log('找到「自定义图片」按钮: ' + JSON.stringify(info));
await sleep(1200);
const labels = await p.evaluate(() => Array.from(document.querySelectorAll('label.btn')).map((x) => x.innerText.trim()));
console.log('可选的选图入口: ' + JSON.stringify(labels));
const fileInput = await p.$('input[type=file][accept="image/*"]');
console.log('相册选图 input 存在: ' + !!fileInput);
await fileInput.uploadFile(tmp);
await sleep(2500);
const after = await p.evaluate(async () => {
  // appearance 存在 IndexedDB 里（不是 localStorage）
  const a = await window.__schedule.appearance.get();
  const bd = document.querySelector('.bd-layer');
  return {
    mode: a.mode, imageName: a.imageName, hasImage: !!a.image,
    imageLen: (a.image || '').length,
    backdrop: bd ? getComputedStyle(bd).backgroundImage.slice(0, 60) : '(没有 .bd-layer)',
    bodyHasImage: getComputedStyle(document.querySelector('.backdrop') || document.body).backgroundImage.slice(0, 40)
  };
});
console.log(JSON.stringify(after, null, 1));
await p.screenshot({ path: 'shots12/bg.png' });
await b.close();
if (!process.argv[2]) stopIsolatedServer();
console.log('背景图片换成功：' + (after.mode === 'image' && after.hasImage ? 'PASS' : 'FAIL'));
