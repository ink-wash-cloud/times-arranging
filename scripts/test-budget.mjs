// 预算卡上的「设置预算」专项回归。
//
// 原来的 bug：那个按钮直接 onGo('settings') 跳到设置页，而设置页里根本没有预算入口，
// 等于点了个死路 —— 用户永远设不了本月预算。电脑端和手机端都有这个问题。
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8814);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
await p.setViewport({ width: 1440, height: 1000 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);

// 空库时总览页显示的是欢迎引导页，没有卡片。塞一条记录让它变成正常的总览。
await p.evaluate(async () => {
  await window.__schedule.putRecord('tasks', 'seed-one', {
    title: '随便一条待办', category: '杂事', dueDate: null, dueTime: null, priority: 'P2',
    status: '未开始', estimateMinutes: 30, repeat: '不重复', note: '', anniversaryId: null,
    completedAt: null, createdAt: Date.now()
  });
});
await sleep(1500);
await p.evaluate(() => { location.hash = '#dash'; });
await sleep(1500);

const budgetBtn = async () => p.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.card')).find((x) => x.innerText.includes('本月预算使用'));
  if (!card) return null;
  const b2 = Array.from(card.querySelectorAll('button')).find((x) => x.innerText.includes('预算'));
  return b2 ? b2.innerText.trim() : null;
});
const clickBudget = () => p.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.card')).find((x) => x.innerText.includes('本月预算使用'));
  const b2 = Array.from(card.querySelectorAll('button')).find((x) => x.innerText.includes('预算'));
  b2.click();
});
const cardText = () => p.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.card')).find((x) => x.innerText.includes('本月预算使用'));
  return card ? card.innerText.replace(/\s+/g, ' ') : '';
});
const modalInfo = () => p.evaluate(() => {
  const m = document.querySelector('.modal');
  if (!m) return null;
  const nums = Array.from(m.querySelectorAll('input[type=number]'));
  const budgetInput = nums.find((i) => {
    const f = i.closest('.field');
    return f && f.innerText.includes('总预算');
  });
  return {
    title: (m.querySelector('h3') || { innerText: '' }).innerText.trim(),
    hasBudget: !!budgetInput,
    budgetValue: budgetInput ? budgetInput.value : null,
    focused: budgetInput ? document.activeElement === budgetInput : false,
    buttons: Array.from(m.querySelectorAll('button')).map((x) => x.innerText.trim()).filter(Boolean),
    // 弹窗里有两个"保存预算"：表单里那个只存不关，底部那个存完关窗。测试要点底部那个。
    footButtons: Array.from(m.querySelectorAll('.modal-foot button')).map((x) => x.innerText.trim())
  };
});

console.log('\n[1] 总览页的预算卡');
const first = await budgetBtn();
console.log('   按钮文案: ' + JSON.stringify(first));
ok('预算卡上有设置预算的按钮', first !== null, first);
ok('还没设预算时显示未设置', (await cardText()).includes('未设置'), (await cardText()).slice(0, 80));

console.log('\n[2] 点它会打开设置预算的弹窗（而不是跳去设置页）');
await clickBudget();
await sleep(1000);
const m1 = await modalInfo();
console.log('   弹窗: ' + JSON.stringify(m1));
ok('弹出了一个弹窗', !!m1, m1);
ok('标题是「设置本月预算」', !!m1 && m1.title.includes('设置本月预算'), m1 && m1.title);
ok('弹窗里有本月总预算输入框', !!m1 && m1.hasBudget, m1);
ok('光标直接落在预算输入框上（不用自己找）', !!m1 && m1.focused, m1);
ok('底部主按钮是「保存预算」', !!m1 && m1.footButtons.includes('保存预算'), m1 && m1.footButtons);
const onDash = await p.evaluate(() => !!document.querySelector('.dash-grid'));
ok('没有跳到设置页（总览还在）', onDash, onDash);

console.log('\n[3] 填个数保存');
await p.evaluate(() => {
  const m = document.querySelector('.modal');
  const nums = Array.from(m.querySelectorAll('input[type=number]'));
  const input = nums.find((i) => i.closest('.field').innerText.includes('总预算'));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '3000');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(500);
await p.evaluate(() => {
  const b2 = Array.from(document.querySelectorAll('.modal-foot button')).find((x) => x.innerText.trim() === '保存预算');
  b2.click();
});
await sleep(1500);
const after = await cardText();
console.log('   卡片: ' + after.slice(0, 90));
ok('保存后卡片显示 3000', after.includes('3000'), after.slice(0, 90));
ok('弹窗关掉了', (await modalInfo()) === null, null);
ok('按钮变成「改预算」', (await budgetBtn()) === '改预算', await budgetBtn());
const stored = await p.evaluate(() => window.__schedule.list('budgets').map((x) => x.amount));
ok('预算真的存进去了', stored.includes(3000), stored);

console.log('\n[4] 再点开时回填原来的数字');
await clickBudget();
await sleep(1000);
const m2 = await modalInfo();
ok('回填了 3000', !!m2 && m2.budgetValue === '3000', m2 && m2.budgetValue);
await p.evaluate(() => {
  const b2 = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '关闭');
  if (b2) b2.click();
});
await sleep(700);

console.log('\n[5] 记一笔那个入口还是原来的样子');
await p.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.card')).find((x) => x.innerText.includes('本月预算使用'));
  const b2 = Array.from(card.querySelectorAll('button')).find((x) => x.innerText.trim() === '记一笔');
  b2.click();
});
await sleep(1000);
const m3 = await modalInfo();
ok('「记一笔」打开的是记支出弹窗', !!m3 && m3.title === '记一笔支出', m3 && m3.title);
ok('记支出的主按钮是「保存支出」', !!m3 && m3.footButtons.includes('保存支出'), m3 && m3.footButtons);

console.log('\n[6] 控制台');
ok('没有 JS 运行时错误', errs.length === 0, errs.slice(0, 2));

await b.close();
if (!process.argv[2]) stopIsolatedServer();
console.log('\n========================================');
console.log('  预算设置验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
