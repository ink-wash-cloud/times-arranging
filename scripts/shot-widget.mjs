// 给弹出来的挂件小窗截图
// 注意：挂件弹出去之后就不在主页面里了，普通 page.screenshot 只能拍到主窗口，
// 必须通过 CDP 找到那个独立目标再单独截。
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EXPLICIT = process.argv[2] || '';
const URL = EXPLICIT || await startIsolatedServer(Number(process.env.TEST_PORT || 8789));
mkdirSync('shots7', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForSelector('.app');
await sleep(2500);

// 造点像样的数据，别让挂件里是"今天没有待办"
await page.evaluate(async () => {
  const s = window.__schedule;
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const b = { status: '未开始', estimateMin: 30, repeat: 'none', note: '' };
  await s.putRecord('tasks', s.newId(), { ...b, title: '交高等数学作业第三章', category: '学习', priority: 'P0', dueDate: today });
  await s.putRecord('tasks', s.newId(), { ...b, title: '复习数据结构第五章', category: '学习', priority: 'P1', dueDate: today });
  await s.putRecord('tasks', s.newId(), { ...b, title: '剪辑并发布本周 vlog', category: '自媒体', priority: 'P2', dueDate: today, estimateMin: 120 });
  await s.putRecord('tasks', s.newId(), { ...b, title: '取快递', category: '杂事', priority: 'P3', dueDate: '2020-01-01', estimateMin: 15 });
  await s.putRecord('anniversaries', s.newId(), { title: '和 ta 在一起纪念日', type: '纪念日', date: '2024-09-24', repeat: 'yearly', progress: 80, note: '' });
  await s.putRecord('habits', s.newId(), { name: '背单词', icon: '📖', target: 1, unit: '次', paused: false, createdAt: today });
});
await sleep(700);
await page.evaluate(async () => {
  const s = window.__schedule;
  const h = s.list('habits')[0];
  if (h) await s.putRecord('habitLogs', s.newId(), { habitId: h.id, date: new Date().toISOString().slice(0, 10) });
});
await sleep(700);

await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.topbar button')).find((x) => x.innerText.includes('桌面挂件'));
  if (b) b.click();
});
await sleep(2800);

// 无头模式下 PiP 窗口不参与合成，CDP 直接截是白的。
// 把那个窗口的 DOM（含已内联的样式表）原样搬到一个普通页面里渲染再截，效果等价。
const html = await page.evaluate(() => {
  const w = window.documentPictureInPicture && window.documentPictureInPicture.window;
  if (!w) return '';
  return '<!doctype html>' + w.document.documentElement.outerHTML;
});
if (!html) {
  console.log('✗ 没拿到挂件窗口（浏览器可能没给 PiP）');
  await browser.close();
  stopIsolatedServer();
  process.exit(1);
}
writeFileSync('shots7/widget-window.html', html);
const mirror = await browser.newPage();
await mirror.setViewport({ width: 340, height: 470, deviceScaleFactor: 2 });
await mirror.setContent(html, { waitUntil: 'load' });
await sleep(1500);
await mirror.screenshot({ path: 'shots7/widget-window.png' });
await page.screenshot({ path: 'shots7/widget-main.png' });
console.log('✓ shots7/widget-window.png（挂件小窗）+ shots7/widget-main.png（主窗口）');
await browser.close();
stopIsolatedServer();
