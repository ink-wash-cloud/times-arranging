import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EXPLICIT = process.argv[2] || '';
const URL = EXPLICIT || await startIsolatedServer(Number(process.env.TEST_PORT || 8791));
const OUT = 'shots5';
mkdirSync(OUT, { recursive: true });

const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--font-render-hinting=none'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = (p, sel, t) => p.evaluate((sel, t) => {
  const el = Array.from(document.querySelectorAll(sel)).find((x) => (x.innerText || '').includes(t));
  if (el) el.click();
}, sel, t);

// ---- 手机：今日总览（时间池所在页）----
const m = await b.newPage();
await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await m.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await m.waitForSelector('.app', { timeout: 20000 });
await sleep(900);
await m.screenshot({ path: OUT + '/m-overview.png' });
const box = await m.evaluate(() => {
  const el = document.querySelector('.two-col');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const scroll = document.querySelector('.content');
  return { top: Math.round(r.top + (scroll ? scroll.scrollTop : 0)), h: Math.round(r.height) };
});
if (box) {
  await m.evaluate((top) => { const s = document.querySelector('.content'); if (s) s.scrollTop = Math.max(0, top - 90); }, box.top);
  await sleep(500);
  await m.screenshot({ path: OUT + '/m-pool.png' });
}

// ---- 手机：待办 / 设置 ----
await clickText(m, '.tab-item, .tabbar *', '待办');
await sleep(700);
await m.screenshot({ path: OUT + '/m-tasks.png' });
await clickText(m, '.tab-item, .tabbar *', '设置');
await sleep(700);
await m.screenshot({ path: OUT + '/m-settings.png' });
await m.close();

// ---- 电脑：总览 / 表单 / 看板 ----
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await p.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await p.waitForSelector('.app', { timeout: 20000 });
await sleep(900);
await p.screenshot({ path: OUT + '/d-overview.png' });
await clickText(p, '.nav-item', '待办事项');
await sleep(700);
await p.screenshot({ path: OUT + '/d-tasks.png' });
await clickText(p, '.nav-item', '重要日期');
await sleep(600);
await clickText(p, '.btn', '新建');
await sleep(700);
await p.screenshot({ path: OUT + '/d-form.png' });
await p.close();

// ---- 手机 320px 极窄 ----
const n = await b.newPage();
await n.setViewport({ width: 320, height: 720, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await n.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await n.waitForSelector('.app', { timeout: 20000 });
await sleep(900);
await n.screenshot({ path: OUT + '/m320-overview.png' });
await n.close();

await b.close();
stopIsolatedServer();
console.log('saved to ' + OUT + '/');
