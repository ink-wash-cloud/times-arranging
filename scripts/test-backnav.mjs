// v1.2.2 需求②：手机侧滑 / 返回键应该"退一层"，不是直接退出应用；
// 已经在首页时第一次只提示「再滑一次退出应用」（防误触），2.5 秒内再滑才退出。
//
// 网页里没有返回键，但 pressBack() 是同一套逻辑（安卓那边只是把 backbutton 事件转进来），
// 所以这里直接调 __schedule.back.press() 验证分层拦截 + 防误触。
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};

const URL = process.argv[2] || await startIsolatedServer(8823);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2200);

const press = async () => {
  const r = await p.evaluate(() => window.__schedule.back.press());
  await sleep(320);
  return r;
};
const stats = () => p.evaluate(() => window.__schedule.back.stats());
const reset = () => p.evaluate(() => window.__schedule.back.reset());
const view = () => p.evaluate(() => {
  const on = document.querySelector('.nav-item.active');
  return on ? on.innerText.replace(/\s+/g, ' ').trim() : '';
});
const toastText = () => p.evaluate(() => {
  const w = document.querySelector('.toast-wrap');
  return w ? w.innerText.replace(/\s+/g, ' ').trim() : '';
});
const goNav = async (label) => {
  const hit = await p.evaluate((t) => {
    const items = Array.from(document.querySelectorAll('.nav-item'));
    const el = items.find((x) => x.innerText.includes(t));
    if (!el) return false;
    el.click();
    return true;
  }, label);
  await sleep(600);
  return hit;
};
const hasMask = () => p.evaluate(() => !!document.querySelector('.modal-mask'));

await reset();
if (await view() !== '今日总览' && !(await view()).includes('总览')) await goNav('今日总览');

console.log('\n[1] 首页第一次按返回：只提示，不退出');
let r = await press();
let s = await stats();
let t = await toastText();
ok('press() 返回 true（返回键被我们接管了）', r === true, r);
ok('只提示了一次', s.prompts === 1 && s.exits === 0, s);
ok('提示文案是「再滑一次退出应用」', t.includes('再滑一次退出应用'), t);
ok('还停在首页（没有跳页、也没有退出）', (await view()).includes('总览'), await view());

console.log('\n[2] 2.5 秒内再按一次：真的退出');
r = await press();
s = await stats();
ok('记录了退出动作', s.exits === 1, s);
ok('提示次数没再涨（第二下是执行退出）', s.prompts === 1, s.prompts);
ok('防误触计时器已归零', s.armed === false, s);

console.log('\n[3] 隔了 3 秒再按：又算"第一次"，只提示不退出');
await reset();
await sleep(3000);
await press();
s = await stats();
ok('慢速再按不退出', s.exits === 0, s);
ok('重新提示了一次', s.prompts === 1, s);

console.log('\n[4] 在别的页面按返回：回上一级，而不是退出');
await reset();
ok('先进待办页', await goNav('待办事项'), await view());
ok('现在在待办页', (await view()).includes('待办'), await view());
await press();
ok('回到了总览', (await view()).includes('总览'), await view());
s = await stats();
ok('这一下不算"要退出"（没有提示、没有退出）', s.prompts === 0 && s.exits === 0, s);

console.log('\n[5] 按来路一层层退（不是一律跳回首页）');
await goNav('待办事项');
await goNav('习惯打卡');
ok('现在在习惯页', (await view()).includes('习惯'), await view());
await press();
ok('退回待办页', (await view()).includes('待办'), await view());
await press();
ok('再退回总览页', (await view()).includes('总览'), await view());

console.log('\n[6] 有弹窗时先关弹窗');
await reset();
const fab = await p.evaluate(() => {
  const el = document.querySelector('.fab');
  if (!el) return false;
  el.click();
  return true;
});
await sleep(500);
ok('点 💡 打开了浮层', fab && (await hasMask()), await hasMask());
await press();
ok('返回键先关浮层', !(await hasMask()), await hasMask());
s = await stats();
ok('关浮层不算退出动作', s.prompts === 0 && s.exits === 0, s);
ok('页面还停在总览', (await view()).includes('总览'), await view());

console.log('\n[7] 设置页 > 关于 > 更新日志：返回键先关弹窗，再逐层退回');
await reset();
await goNav('设置与同步');
ok('进入设置页', (await view()).includes('设置'), await view());
// v1.4.1：设置根页是四组列表，先真实点开「使用说明与更新日志」二级页
const entered = await p.evaluate(() => {
  const row = document.querySelector('[data-testid="set-row-about"]');
  if (!row) return false;
  row.click();
  return true;
});
await sleep(600);
ok('从设置列表点进「使用说明与更新日志」', entered && await p.evaluate(() => !!document.querySelector('.subpage')), entered);
const opened = await p.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.trim() === '更新日志');
  if (!btn) return false;
  btn.click();
  return true;
});
await sleep(500);
ok('打开了更新日志弹窗', opened && (await hasMask()), [opened, await hasMask()]);
await press();
await sleep(450); // 等遮罩淡出动画结束（320ms 有时还抓得到正在淡出的遮罩）
ok('返回键先把弹窗关掉（还留在二级页）', !(await hasMask()) && (await view()).includes('设置'), [!await hasMask(), await view()]);
await press();
ok('再按一次退出二级页，回到设置根页', (await view()).includes('设置') && await p.evaluate(() => !!document.querySelector('.set-list')), await view());
await press();
ok('再按一次才退回总览', (await view()).includes('总览'), await view());

console.log('\n[8] 首页连按两次：退出且不改变当前页');
await reset();
const before = await view();
await press();
await press();
s = await stats();
ok('两下连按触发了退出', s.exits === 1 && s.prompts === 1, s);
ok('页面没有被莫名其妙地翻走', (await view()) === before, [before, await view()]);

console.log('\n[9] 全程没有报错');
ok('没有页面错误', errs.length === 0, errs.slice(0, 3));

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
await b.close();
stopIsolatedServer();
process.exit(fail ? 1 : 0);
