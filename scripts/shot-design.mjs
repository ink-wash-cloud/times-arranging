// 设计改版用的截图：把主要页面在电脑端/手机端各拍一遍，人工看凌乱点
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || await startIsolatedServer(8797);
const OUT = process.argv[3] || 'shots-design/before';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIEWS = [
  ['dash', '总览'],
  ['tasks', '待办'],
  ['habits', '习惯'],
  ['dates', '日期'],
  ['timetable', '课表'],
  ['inspiration', '灵感'],
  ['settings', '设置']
];
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const ctx = await b.createBrowserContext();
const p = await ctx.newPage();
await p.setViewport({ width: 1440, height: 950 });
await p.goto(URL, { waitUntil: 'networkidle2', timeout: 40000 });
await p.waitForSelector('.app', { timeout: 20000 });
await sleep(2200);
const txt = await p.evaluate(() => document.body.innerText);
if (/载入示例数据/.test(txt)) {
  await p.evaluate(() => { const x = Array.from(document.querySelectorAll('button')).find((n) => n.innerText.includes('载入示例数据')); if (x) x.click(); });
  await sleep(2000);
}
for (const [key, label] of VIEWS) {
  await p.evaluate((name) => { const n = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.innerText.includes(name)); if (n) n.click(); }, label);
  await sleep(900);
  await p.screenshot({ path: OUT + '/pc-' + key + '.png' });
  console.log('shot ' + OUT + '/pc-' + key + '.png');
}
// 设置页的二级页面（v1.4.1）：每页各拍一张，方便看层级是否清爽
const SUBS = ['look', 'bg', 'perf', 'colors', 'sync', 'remind', 'widget', 'apps', 'ai', 'about'];
await p.evaluate((name) => { const n = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.innerText.includes(name)); if (n) n.click(); }, '设置');
await sleep(700);
for (const id of SUBS) {
  await p.evaluate((page) => { window.__schedule.ui.openSettingsPage(page); }, id);
  await sleep(500);
  await p.screenshot({ path: OUT + '/pc-set-' + id + '.png' });
  console.log('shot ' + OUT + '/pc-set-' + id + '.png');
}
await p.evaluate(() => { window.__schedule.ui.openSettingsPage('root'); });
await sleep(400);

await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await sleep(800);
for (const [key, label] of VIEWS) {
  await p.evaluate((name) => { const n = Array.from(document.querySelectorAll('.tabbar button, .tab')).find((x) => x.innerText.includes(name)); if (n) n.click(); }, label);
  await sleep(700);
  await p.screenshot({ path: OUT + '/ph-' + key + '.png' });
  console.log('shot ' + OUT + '/ph-' + key + '.png');
}
await b.close();
if (!process.argv[2]) await stopIsolatedServer();
console.log('done');
