// 习惯「每日最低完成量」专项
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8794);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);

// 造一个"每日最低 20 个"的习惯
await p.evaluate(async () => {
  const s = window.__schedule;
  await s.putRecord('habits', 'h-quota', {
    name: '背单词', icon: '📖', color: '#6d8bff', paused: false, note: '',
    dailyMin: 20, unit: '个', createdAt: Date.now()
  });
  await s.putRecord('habits', 'h-plain', {
    name: '早起', icon: '🌅', color: '#6fbf94', paused: false, note: '', createdAt: Date.now()
  });
});
await sleep(1200);
await p.evaluate(() => { location.hash = '#habits'; });
await sleep(1200);

const card = (name) => p.evaluate((n) => {
  const c = Array.from(document.querySelectorAll('.habit-card')).find((x) => x.innerText.includes(n));
  return c ? c.innerText.replace(/\s+/g, ' ') : '';
}, name);

console.log('\n[1] 卡片形态');
let quota = await card('背单词');
console.log('   定额习惯: ' + quota.slice(0, 150));
ok('定额习惯显示「今日完成量 0 / 20个」', /0 \/ 20个/.test(quota), quota.slice(0, 90));
ok('定额习惯有「记满 20个」按钮', /记满 20个/.test(quota), quota.slice(0, 120));
const plain = await card('早起');
ok('没设量的习惯保持原来的「立即打卡」', /立即打卡/.test(plain), plain.slice(0, 110));

console.log('\n[2] 记满才达标');
const setAmount = async (v) => {
  await p.evaluate((val) => {
    const c = Array.from(document.querySelectorAll('.habit-card')).find((x) => x.innerText.includes('背单词'));
    const i = c.querySelector('input[type=number]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(i, String(val));
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await sleep(900);
};
await setAmount(10);
let st = await p.evaluate(() => {
  const s = window.__schedule;
  const logs = s.list('habitLogs').filter((l) => l.habitId === 'h-quota');
  return { logs: logs.length, amount: logs[0] ? logs[0].amount : null };
});
ok('记了 10 个，日志里存的是完成量', st.amount === 10, st);
let txt = await card('背单词');
ok('10 / 20 时还不算达标（没有 ✓ 已达标）', !/已达标/.test(txt), txt.slice(0, 120));
ok('显示「每日最低 20个」，说明规则', /每日最低 20个/.test(txt), txt.slice(0, 160));

await setAmount(20);
txt = await card('背单词');
ok('记满 20 之后变成已达标', /已达标/.test(txt), txt.slice(0, 130));
const streak20 = await p.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.habit-card')).find((x) => x.innerText.includes('背单词'));
  const nums = Array.from(c.querySelectorAll('.habit-num b')).map((x) => x.innerText.trim());
  return nums;
});
console.log('   连续/累计/最长: ' + JSON.stringify(streak20));
ok('达标后连续天数 +1', streak20[0] === '1', streak20);

console.log('\n[3] 掉回未达标');
await setAmount(5);
txt = await card('背单词');
const streak5 = await p.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.habit-card')).find((x) => x.innerText.includes('背单词'));
  return Array.from(c.querySelectorAll('.habit-num b')).map((x) => x.innerText.trim());
});
ok('降到 5 个之后不再算达标', !/已达标/.test(txt), txt.slice(0, 120));
ok('连续天数也跟着归零', streak5[0] === '0', streak5);

console.log('\n[4] 老数据兼容：没有 amount 的旧打卡记录仍然算达标');
await p.evaluate(async () => {
  const s = window.__schedule;
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const d = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
  await s.putRecord('habitLogs', 'h-quota:' + d, { habitId: 'h-quota', date: d, at: Date.now() });
});
await sleep(1000);
const legacy = await p.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.habit-card')).find((x) => x.innerText.includes('背单词'));
  return c.innerText.replace(/\s+/g, ' ').slice(0, 120);
});
ok('老记录（无 amount）按刚好达标处理，不会把以前的连续判死', /已达标|20 \/ 20/.test(legacy), legacy);

console.log('\n[5] 备注里写着「每天 200 个」时，编辑器给一键填上的入口');
await p.evaluate(async () => {
  const s = window.__schedule;
  await s.putRecord('habits', 'h-note', {
    name: '背单词', icon: '📖', color: '#6d8bff', paused: false,
    note: '每天 200 个', createdAt: Date.now()
  });
});
await sleep(1000);
await p.evaluate(() => { location.hash = '#habits'; });
await sleep(1200);
// 点开这张卡的「编辑」
await p.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.habit-card')).find((x) => x.innerText.includes('每天 200 个'));
  const btn = Array.from(c.querySelectorAll('button')).find((x) => x.innerText.trim() === '编辑');
  btn.click();
});
await sleep(1200);
const chip = await p.evaluate(() => {
  const m = document.querySelector('.modal');
  if (!m) return { open: false };
  const b = Array.from(m.querySelectorAll('button')).find((x) => /点一下填进去/.test(x.innerText));
  return { open: true, has: !!b, text: b ? b.innerText.trim() : '', label: m.innerText.indexOf('每日最低完成量') >= 0 };
});
ok('编辑框里有「每日最低完成量」这一项', chip.open && chip.label, chip);
ok('从备注认出了「每天 200 个」并给出提示', chip.has, chip.text);
if (chip.has) {
  await p.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.modal button')).find((x) => /点一下填进去/.test(x.innerText));
    b.click();
  });
  await sleep(700);
  const filled = await p.evaluate(() => {
    const m = document.querySelector('.modal');
    const nums = Array.from(m.querySelectorAll('input[type=number]')).map((x) => x.value);
    const unit = Array.from(m.querySelectorAll('input.input')).map((x) => x.value);
    return { nums, unit };
  });
  ok('点一下就把 200 填进了每日最低完成量', filled.nums.indexOf('200') >= 0, filled);
  ok('单位也跟着填成「个」', filled.unit.indexOf('个') >= 0, filled.unit);
  await p.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '保存');
    if (b) b.click();
  });
  await sleep(1200);
  const after = await p.evaluate(() => Array.from(document.querySelectorAll('.habit-card'))
    .map((x) => x.innerText.replace(/\s+/g, ' '))
    .find((t) => t.indexOf('200') >= 0) || '');
  ok('保存后卡片变成记量的形态（0 / 200个）', /0 \/ 200个/.test(after), after.slice(0, 140));
}

await b.close();
if (!process.argv[2]) stopIsolatedServer();
console.log('\n========================================');
console.log('  每日最低完成量验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
