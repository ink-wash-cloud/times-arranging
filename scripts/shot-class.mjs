// 班级筛选在电脑端和手机端的成品截图
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = await startIsolatedServer(8790);
mkdirSync('shots9', { recursive: true });
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--font-render-hinting=none'] });

const seed = async (p) => {
  await p.evaluate(async () => {
    const s = window.__schedule;
    const mk = (name, k, wd, st, en, loc, teacher) => s.putRecord('courses', s.newId(), {
      name, teacher, location: loc, className: k, weekday: wd, startTime: st, endTime: en,
      startWeek: 1, endWeek: 16, weekParity: 'all', color: '#4f8cff', note: ''
    });
    await mk('高等数学A', '计科2101', 1, '08:00', '09:40', '教三201', '张建国');
    await mk('数据结构', '计科2101', 1, '10:00', '11:40', '计算机楼A401', '王强');
    await mk('计算机网络', '计科2101', 2, '08:00', '09:40', '计算机楼A302', '赵敏');
    await mk('大学英语', '计科2102', 1, '08:00', '09:40', '外语楼305', '李梅');
    await mk('线性代数', '软件2101', 3, '14:00', '15:40', '教二108', '孙老师');
  });
  await sleep(1000);
};

const shot = async (p, file) => { await sleep(800); await p.screenshot({ path: 'shots9/' + file }); };
const pick = async (p, name) => {
  await p.evaluate((n) => {
    const c = Array.from(document.querySelectorAll('.card')).find((x) => x.innerText.includes('按班级看课表'));
    const b = c && Array.from(c.querySelectorAll('.chip')).find((x) => x.innerText.trim() === n);
    if (b) b.click();
  }, name);
  await sleep(800);
};

// 电脑端
const d = await b.newPage();
await d.setViewport({ width: 1440, height: 1000 });
await d.goto(URL, { waitUntil: 'networkidle2' });
await d.waitForSelector('.app');
await sleep(2500);
await seed(d);
await d.evaluate(() => { location.hash = '#tt'; });
await sleep(1200);
await shot(d, 'desktop-all.png');
await pick(d, '计科2101');
await shot(d, 'desktop-class.png');
await d.close();

// 手机端
const m = await b.newPage();
await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await m.goto(URL, { waitUntil: 'networkidle2' });
await m.waitForSelector('.app');
await sleep(2500);
await seed(m);
await m.evaluate(() => { location.hash = '#tt'; });
await sleep(1200);
await shot(m, 'mobile-all.png');
await pick(m, '计科2101');
await shot(m, 'mobile-class.png');
await m.close();

await b.close();
stopIsolatedServer();
console.log('已保存 shots9/');
