// 习惯：每个习惯可设多个提醒时间点，每个点都单独弹通知
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8834);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2200);

const setup = await p.evaluate(async () => {
  const s = window.__schedule;
  await s.putRecord('habits', 'h1', {
    name: '早起', icon: '🌅', color: '#6d8bff', paused: false, note: '',
    dailyMin: 0, unit: '', createdAt: Date.now(), remindTimes: ['07:00', '12:30', '21:30']
  });
  await s.putRecord('habits', 'h2', {
    name: '冥想', icon: '🧘', color: '#77c39b', paused: false, note: '',
    dailyMin: 0, unit: '', createdAt: Date.now(), remindTimes: []
  });
  await s.putRecord('habits', 'h3', {
    name: '早睡', icon: '🌙', color: '#b79ae0', paused: true, note: '',
    dailyMin: 0, unit: '', createdAt: Date.now(), remindTimes: ['22:30']
  });
  return { today: (() => { const d = new Date(); const pad = (x) => String(x).padStart(2, '0'); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); })() };
});
await sleep(1200);

// 只挑「早起」这个习惯的提醒（另外两个习惯本段不参与断言）
const plan = () => p.evaluate(() => {
  const pad = (x) => String(x).padStart(2, '0');
  const hhmm = (v) => { const d = new Date(v); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const day = (v) => { const d = new Date(v); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  return window.__schedule.plan.upcoming()
    .filter((n) => /该打卡了/.test(n.body) && /早起/.test(n.title))
    .map((n) => ({ title: n.title, body: n.body, at: hhmm(n.at), day: day(n.at) }));
});
// 今天已经过去的时刻不算，未来 7 天按 3 个时间点铺开
const expected = await p.evaluate(() => {
  const pad = (x) => String(x).padStart(2, '0');
  const fmt = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const now = Date.now();
  const times = ['07:00', '12:30', '21:30'];
  let todayCount = 0;
  for (const t of times) {
    const d = new Date();
    const hm = t.split(':');
    d.setHours(Number(hm[0]), Number(hm[1]), 0, 0);
    if (d.getTime() > now) todayCount++;
  }
  const today = fmt(new Date());
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const last = new Date(day0); last.setDate(day0.getDate() + 6);
  return { today, todayCount, total: todayCount + 18, lastDay: fmt(last) };
});

console.log('\n[1] 三个时间点各自排一条，铺满 7 天');
let rows = await plan();
ok('总数 = 今天剩余 + 未来 6 天 × 3', rows.length === expected.total, { got: rows.length, want: expected.total, todayCount: expected.todayCount });
ok('今天的条数与已过的时刻对得上', rows.filter((r) => r.day === expected.today).length === expected.todayCount, rows.filter((r) => r.day === expected.today).map((r) => r.at));
ok('最后一天正好是第 7 天', rows.some((r) => r.day === expected.lastDay), rows.map((r) => r.day));
ok('提醒正文写明是哪个时间点', rows.some((r) => r.body.includes('该打卡了 · 12:30')), rows.slice(0, 4).map((r) => r.body));
ok('标题带习惯名，是弹窗不是静默', rows.every((r) => r.title.includes('早起')) && rows.every((r) => r.body.includes('该打卡了')), rows.slice(0, 2));
ok('同一天的三个点各排一条', (() => { const d = rows.find((r) => r.day !== expected.today); if (!d) return false; return rows.filter((r) => r.day === d.day).length === 3; })(), rows.map((r) => r.day + ' ' + r.at));

console.log('\n[2] 当天已经达标就不再打扰');
await p.evaluate(async (day) => {
  await window.__schedule.putRecord('habitLogs', 'l1', { habitId: 'h1', date: day, count: 1, amount: 1, createdAt: Date.now() });
}, setup.today);
await sleep(900);
rows = await plan();
ok('今天剩下的时间点全部撤掉', rows.filter((r) => r.day === setup.today).length === 0, rows.filter((r) => r.day === setup.today));
ok('未来几天照旧保留', rows.length === 18, rows.length);
await p.evaluate(() => window.__schedule.removeRecord('habitLogs', 'l1'));
await sleep(700);

console.log('\n[3] 暂停的习惯不提醒');
rows = (await plan()).filter((r) => /早睡/.test(r.title));
ok('暂停的「早睡」一条都不排', rows.length === 0, rows);

console.log('\n[4] 总开关：关掉后所有时间点都不响');
await p.evaluate(() => { window.__schedule.cfg.habitTimes = false; });
rows = await plan();
ok('关掉「按时间点提醒」后一条都没有', rows.length === 0, rows.length);
await p.evaluate(() => { window.__schedule.cfg.habitTimes = true; });
rows = await plan();
ok('打开后又回来了', rows.length === expected.total, rows.length);

console.log('\n[5] 习惯编辑里能加、能删时间点');
await p.evaluate(() => { location.hash = '#habits'; });
await sleep(1600);
const card = await p.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.habit-card')).find((x) => /早起/.test(x.innerText));
  return c ? c.innerText.replace(/\s+/g, ' ') : '';
});
ok('习惯卡片上显示 🔔 和三个时间点', /🔔/.test(card) && /07:00/.test(card) && /21:30/.test(card), card.slice(0, 160));
await p.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.habit-card')).find((x) => /冥想/.test(x.innerText));
  Array.from(c.querySelectorAll('button')).find((x) => x.innerText.trim() === '编辑').click();
});
await sleep(800);
const editor = await p.$eval('.modal', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
ok('编辑弹窗里有「每日提醒」', /每日提醒/.test(editor), editor.slice(0, 200));
ok('弹窗里有快捷时间点', /早起 07:00/.test(editor) && /晚上 21:30/.test(editor), editor.slice(0, 240));
await p.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.modal button'));
  btns.find((x) => /早起 07:00/.test(x.innerText)).click();
  btns.find((x) => /晚上 21:30/.test(x.innerText)).click();
});
await sleep(500);
const chips = await p.evaluate(() => Array.from(document.querySelectorAll('.modal .chip.on'))
  .map((x) => x.innerText.replace(/\s+/g, ' ').trim())
  .filter((t) => t.includes('🔔')));
ok('点完出现两个已选时间点', chips.length === 2 && chips.some((t) => /07:00/.test(t)) && chips.some((t) => /21:30/.test(t)), chips);
await p.evaluate(() => {
  Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '保存').click();
});
await sleep(1200);
const saved = await p.evaluate(() => {
  const h = window.__schedule.list('habits').find((x) => x.name === '冥想');
  return h ? h.remindTimes : null;
});
ok('保存后写进习惯（按时间排序）', Array.isArray(saved) && saved.join(',') === '07:00,21:30', saved);

console.log('\n[6] 再打开可以删掉某个时间点');
await p.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.habit-card')).find((x) => /冥想/.test(x.innerText));
  Array.from(c.querySelectorAll('button')).find((x) => x.innerText.trim() === '编辑').click();
});
await sleep(800);
await p.evaluate(() => {
  const chip = Array.from(document.querySelectorAll('.modal .chip.on')).find((x) => /🔔/.test(x.innerText) && /07:00/.test(x.innerText));
  chip.click();
});
await sleep(400);
await p.evaluate(() => {
  Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '保存').click();
});
await sleep(1200);
const saved2 = await p.evaluate(() => {
  const h = window.__schedule.list('habits').find((x) => x.name === '冥想');
  const c = Array.from(document.querySelectorAll('.habit-card')).find((x) => /冥想/.test(x.innerText));
  return { times: h ? h.remindTimes : null, card: c ? c.innerText.replace(/\s+/g, ' ') : '' };
});
ok('删掉 07:00 后只剩 21:30', Array.isArray(saved2.times) && saved2.times.join(',') === '21:30', saved2.times);
ok('卡片跟着更新', /🔔/.test(saved2.card) && /21:30/.test(saved2.card) && !/07:00/.test(saved2.card), saved2.card.slice(0, 160));

console.log('\n[7] 设置页有「按习惯自己的时间点提醒」总开关');
await p.evaluate(() => { location.hash = '#settings'; });
await sleep(900);
await p.evaluate(() => window.__schedule.ui.openSettingsPage('remind'));
await sleep(700);
const panel = await p.evaluate(() => {
  const el = Array.from(document.querySelectorAll('.subpage .card')).find((x) => /按习惯自己的时间点提醒/.test(x.innerText));
  return el ? el.innerText.replace(/\s+/g, ' ') : '';
});
ok('设置页能看到这个开关', /按习惯自己的时间点提醒/.test(panel) && /已开启/.test(panel), panel.slice(0, 200));
const toggled = await p.evaluate(() => {
  const el = Array.from(document.querySelectorAll('.subpage .card')).find((x) => /按习惯自己的时间点提醒/.test(x.innerText));
  if (!el) return null;
  const cb = Array.from(el.querySelectorAll('input[type=checkbox]')).find((x) => /已开启|已关闭/.test(x.parentElement.innerText));
  if (!cb) return null;
  cb.click();
  return true;
});
await sleep(900);
const offNow = await p.evaluate(() => window.__schedule.cfg.habitTimes);
ok('点一下关掉并写进配置', toggled === true && offNow === false, { toggled, offNow });

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
try { await b.close(); } catch { /* 忽略 */ }
if (!process.argv[2]) await stopIsolatedServer();
process.exit(fail ? 1 : 0);
