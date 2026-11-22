// 课表「选择第几周」专项
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8797);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);

/* 开学第一周 = 四个星期前的那个周一，于是"今天"正好落在第 5 教学周。
   这样断言跟真实日期无关，哪天跑都一样。 */
const termStart = await p.evaluate(() => {
  const d = new Date();
  const back = d.getDay() === 0 ? 6 : d.getDay() - 1;
  d.setDate(d.getDate() - back - 28);
  const z = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
});
console.log('   开学第一周周一 = ' + termStart + '（今天应为第 5 周）');

const seed = [
  { id: 'wk-a', name: '周一早课', weekday: 1, startTime: '08:00', endTime: '09:40', weeks: [5] },
  { id: 'wk-b', name: '周一第六周', weekday: 1, startTime: '10:00', endTime: '11:40', weeks: [6] },
  { id: 'wk-c', name: '周二两次', weekday: 2, startTime: '08:00', endTime: '09:40', weeks: [5, 6] },
  { id: 'wk-d', name: '周三单周', weekday: 3, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 16, weekParity: 'odd' }
];
await p.evaluate(async (rows) => {
  const s = window.__schedule;
  for (const r of rows) {
    await s.putRecord('courses', r.id, {
      name: r.name, teacher: '老师', location: 'A101', weekday: r.weekday,
      startTime: r.startTime, endTime: r.endTime, color: '#4f8cff', note: '',
      startWeek: r.startWeek || 1, endWeek: r.endWeek || 16, weekParity: r.weekParity || 'all',
      weeks: r.weeks || undefined
    });
  }
}, seed);

// 通过界面上的日期框设置开学第一周（走真实路径）
await p.evaluate(() => { location.hash = '#tt'; });
await sleep(1500);
await p.evaluate((v) => {
  const i = document.querySelector('input[type=date]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, v);
  i.dispatchEvent(new Event('change', { bubbles: true }));
}, termStart);
await sleep(1500);

const state = () => p.evaluate(() => ({
  chips: Array.from(document.querySelectorAll('.week-row .chip')).map((x) => x.innerText.trim()),
  on: (document.querySelector('.week-row .chip.on') || {}).innerText || '',
  now: (document.querySelector('.week-row .chip.now') || {}).innerText || '',
  // 课表那张卡的标题：从周次条往上找到它所属的卡片，别按序号猜
  head: (() => {
    const wr = document.querySelector('.week-row');
    const card = wr ? wr.closest('.card') : null;
    const h = card ? card.querySelector('.card-h h3') : null;
    return h ? h.innerText.replace(/\s+/g, ' ') : '';
  })(),
  blocks: Array.from(document.querySelectorAll('.tt-course')).map((x) => x.innerText.replace(/\s+/g, ' ')),
  dayDates: Array.from(document.querySelectorAll('.tt-head')).map((x) => x.innerText.replace(/\s+/g, ' ')),
  scrollW: document.documentElement.scrollWidth, vw: window.innerWidth
}));
const names = (s) => s.blocks.map((t) => (t.match(/^(\S+?)\s/) || [])[1]).filter(Boolean).sort().join(',');

console.log('\n[1] 周次条');
let s = await state();
console.log('   胶囊: ' + JSON.stringify(s.chips.slice(0, 4)) + ' … 共 ' + s.chips.length + ' 个');
ok('第一个是「全部」', s.chips[0] === '全部', s.chips[0]);
ok('有第 1 周', s.chips.indexOf('第 1 周') >= 0, s.chips.slice(0, 6));
ok('至少能选到第 20 周', s.chips.indexOf('第 20 周') >= 0, s.chips.length);
ok('本周那颗标了出来（第 5 周）', s.now === '第 5 周', s.now);
ok('默认就停在当前教学周', s.on === '第 5 周', s.on);
ok('标题写了第几周', /第 5 教学周/.test(s.head), s.head);
ok('标题带了日期（填了开学日期就该有）', /\d\d\/\d\d 起的一周/.test(s.head), s.head);

console.log('\n[2] 第 5 周该上什么');
console.log('   课块: ' + JSON.stringify(s.blocks.map((t) => t.slice(0, 14))));
ok('第 5 周只有 [5] 周那门和 [5,6] 周那门，加上单周的', names(s) === '周一早课,周三单周,周二两次', names(s));
ok('第 6 周才上的课没混进来', names(s).indexOf('周一第六周') < 0, names(s));

console.log('\n[3] 直接点第 6 周');
await p.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.week-row .chip')).find((x) => x.innerText.trim() === '第 6 周');
  c.click();
});
await sleep(1200);
s = await state();
console.log('   课块: ' + JSON.stringify(s.blocks.map((t) => t.slice(0, 14))));
ok('切到第 6 周', s.on === '第 6 周' && /第 6 教学周/.test(s.head), s.head);
ok('第 6 周的内容是对的（[5] 那门消失，双周的还在）', names(s) === '周一第六周,周二两次', names(s));
ok('单周的课在第 6 周不出现', names(s).indexOf('周三单周') < 0, names(s));

console.log('\n[4] 上一周 / 下一周');
await p.evaluate(() => {
  const b2 = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.indexOf('下一周') >= 0);
  b2.click();
});
await sleep(1100);
s = await state();
ok('下一周 → 第 7 周', s.on === '第 7 周', s.on);
await p.evaluate(() => {
  const b2 = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.indexOf('上一周') >= 0);
  b2.click();
});
await sleep(1100);
s = await state();
ok('上一周 → 回到第 6 周', s.on === '第 6 周', s.on);

// 一路往回点，应该停在第 1 周，不会点到第 0 周去
for (let i = 0; i < 8; i++) {
  await p.evaluate(() => {
    const b2 = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.indexOf('上一周') >= 0);
    b2.click();
  });
  await sleep(320);
}
s = await state();
ok('一直往回点会停在第 1 周（不会出现第 0 周）', s.on === '第 1 周', s.on);

console.log('\n[5] 全部');
await p.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.week-row .chip')).find((x) => x.innerText.trim() === '全部');
  c.click();
});
await sleep(1200);
s = await state();
ok('全部周次 = 4 门课都在', names(s) === '周一早课,周一第六周,周三单周,周二两次', names(s));
ok('全部时标题不写第几周', /全部周次/.test(s.head), s.head);

console.log('\n[6] 没填开学日期时也能按周次筛');
await p.evaluate(() => {
  const i = document.querySelector('input[type=date]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(i, '');
  i.dispatchEvent(new Event('change', { bubbles: true }));
});
await sleep(1500);
s = await state();
ok('没有开学日期时默认「全部」（不会一进来就空表）', s.on === '全部' && names(s).length > 0, { on: s.on, n: names(s) });
await p.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.week-row .chip')).find((x) => x.innerText.trim() === '第 5 周');
  c.click();
});
await sleep(1200);
s = await state();
ok('照样能筛第 5 周', names(s) === '周一早课,周三单周,周二两次', names(s));
ok('日期算不准时就不显示日期（免得误导）', s.head.indexOf('起的一周') < 0, s.head);
ok('表头也不显示具体日期', s.dayDates.every((t) => t.indexOf('/') < 0), s.dayDates.slice(0, 3));

console.log('\n[7] 布局与错误');
ok('周次条没有把页面撑宽', s.scrollW <= s.vw + 2, { scrollW: s.scrollW, vw: s.vw });
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await sleep(1200);
const m = await p.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, vw: window.innerWidth, chips: document.querySelectorAll('.week-row .chip').length }));
ok('手机宽度下也不横向溢出', m.scrollW <= m.vw + 2 && m.chips > 20, m);
ok('没有 JS 运行时错误', errs.length === 0, errs.slice(0, 2));

await b.close();
if (!process.argv[2]) stopIsolatedServer();
console.log('\n========================================');
console.log('  选周验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
