// 课表：临时调课 / 停课（只改某一天那一次）
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8807);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2200);

const todayInfo = await p.evaluate(async () => {
  const s = window.__schedule;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (x) => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  const wd = ((d.getDay() + 6) % 7) + 1;             // 1=周一
  const monday = new Date(d); monday.setDate(d.getDate() - (wd - 1));
  const tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
  // 开学第一周 = 本周一，这样"今天"就在第 1 教学周里
  s.cfg.termStart = fmt(monday);
  await s.putRecord('courses', 'c-math', {
    name: '高等数学', teacher: '蔡淑云', location: '北2229', className: '计26.1',
    weekday: wd, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 18,
    weekParity: 'all', color: '#4f8cff', note: '', createdAt: Date.now()
  });
  return { today: fmt(d), tomorrow: fmt(tomorrow), wd };
});
await sleep(900);
await p.evaluate(() => { location.hash = '#tt'; });
await sleep(1500);

console.log('\n[1] 点课表里的课会弹出调整面板');
const gridHit = await p.$$eval('.tt-course', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
ok('课表网格里有这门课', gridHit.some((t) => t.includes('高等数学')), gridHit);
await p.evaluate(() => document.querySelector('.tt-course').click());
await sleep(700);
const sheet = await p.$eval('.modal', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
ok('弹出的是"这一天"的调整面板', /这次/.test(sheet) && /这次停课/.test(sheet) && /编辑这门课/.test(sheet), sheet.slice(0, 120));

console.log('\n[2] 这次停课');
await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '这次停课');
  b.click();
});
await sleep(900);
const st1 = await p.evaluate(() => {
  const s = window.__schedule;
  const ch = s.list('courseChanges');
  const grid = Array.from(document.querySelectorAll('.tt-course')).map((e) => e.innerText.replace(/\s+/g, ' '));
  const day = Array.from(document.querySelectorAll('.day-course')).map((e) => e.innerText.replace(/\s+/g, ' '));
  const strip = document.querySelector('.tt-changes');
  return { n: ch.length, kind: ch[0] ? ch[0].kind : '', date: ch[0] ? ch[0].date : '', grid, day, strip: strip ? strip.innerText.replace(/\s+/g, ' ') : '' };
});
ok('记下了一条临时调整', st1.n === 1 && st1.kind === 'cancel', st1);
ok('记的是今天那一天', st1.date === todayInfo.today, st1.date);
ok('课表格子上标了「停课」', st1.grid.some((t) => t.includes('停课')), st1.grid);
ok('今日课程里也标了「停课」', st1.day.some((t) => t.includes('停课')), st1.day);
ok('「本周调整」条里能看到并撤销', /停课/.test(st1.strip) && /撤销/.test(st1.strip), st1.strip);

console.log('\n[3] 撤销就回到常规课表');
await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.tt-change-chip button')).find((x) => x.innerText.includes('撤销'));
  b.click();
});
await sleep(900);
const st2 = await p.evaluate(() => {
  const s = window.__schedule;
  const grid = Array.from(document.querySelectorAll('.tt-course')).map((e) => e.innerText.replace(/\s+/g, ' '));
  return { n: s.list('courseChanges').length, grid, strip: !!document.querySelector('.tt-changes') };
});
ok('调整记录被清掉', st2.n === 0, st2.n);
ok('课表格子恢复原样', !st2.grid.some((t) => t.includes('停课')), st2.grid);
ok('「本周调整」条消失', !st2.strip);

console.log('\n[4] 调到别的日期');
await p.evaluate(() => document.querySelector('.tt-course').click());
await sleep(600);
await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '调到别的日期');
  b.click();
});
await sleep(500);
await p.evaluate((d) => {
  const input = document.querySelector('.modal input[type=date]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, d);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, todayInfo.tomorrow);
await sleep(400);
await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.includes('保存这次调整'));
  b.click();
});
await sleep(1000);
const st3 = await p.evaluate(() => {
  const s = window.__schedule;
  const ch = s.list('courseChanges');
  const day = Array.from(document.querySelectorAll('.day-course')).map((e) => e.innerText.replace(/\s+/g, ' '));
  return { kind: ch[0] ? ch[0].kind : '', to: ch[0] ? ch[0].toDate : '', day };
});
ok('记下的是「调课」并且带了目标日期', st3.kind === 'move' && st3.to === todayInfo.tomorrow, st3);
ok('今天的课已经不显示了', !st3.day.some((t) => t.includes('高等数学')), st3.day);

console.log('\n[5] 今天没有课的时候提示照旧');
const empty = await p.$$eval('.day-courses', (els) => els.length);
ok('今日课程区块还在（只是空了）', empty === 0, empty);

console.log('\n[6] 点空白格加课 / 删除整门课');
await p.evaluate(() => { const c = document.querySelector('.tt-cell'); c.click(); });
await sleep(800);
const addForm = await p.$eval('.modal', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
ok('点空白格弹出「添加课程」', /添加课程/.test(addForm), addForm.slice(0, 90));
const prefill = await p.evaluate(() => {
  const t = Array.from(document.querySelectorAll('.modal input[type=time]')).map((i) => i.value);
  return t;
});
ok('带上了这一节的时间', prefill.length >= 2 && /^\d\d:\d\d$/.test(prefill[0]), prefill);
await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => /取消|关闭/.test(x.innerText));
  if (b) b.click();
});
await sleep(600);

// 把课调回今天，再测删除
await p.evaluate(async () => {
  const s = window.__schedule;
  const ch = s.list('courseChanges');
  for (const c of ch) await s.removeRecord('courseChanges', c.id);
});
await sleep(900);
await p.evaluate(() => document.querySelector('.tt-course').click());
await sleep(700);
await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '删除这门课');
  b.click();
});
await sleep(700);
const delDlg = await p.$$eval('.modal', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')).join(' || ')).catch(() => '');
ok('删除前有确认框', /删除「高等数学」/.test(delDlg), delDlg.slice(0, 120));
await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '删除');
  b.click();
});
await sleep(900);
const after = await p.evaluate(() => window.__schedule.list('courses').length);
ok('整门课被删掉了', after === 0, after);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
stopIsolatedServer();
process.exit(fail ? 1 : 0);
