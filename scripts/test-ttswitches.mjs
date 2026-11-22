// v1.2.3 课表专项：固定周 / 课表设置六个开关 / 锁定
// 端口默认 8832（本项目其他测试已占用 8790-8824 里的若干端口），只连隔离服务器的临时库。
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};

const PORT = Number(process.env.TT_PORT) || 8832;
const URL = process.argv[2] || await startIsolatedServer(PORT);
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu']
});
const p = await browser.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await p.setViewport({ width: 1400, height: 1000 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2200);

const setVal = (sel, v) => p.evaluate((sel, v) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error('找不到输入框: ' + sel);
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, sel, v);
const clickText = (text, scope) => p.evaluate((text, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const btn = Array.from(root.querySelectorAll('button')).find((x) => x.innerText.trim() === text);
  if (!btn) throw new Error('找不到按钮: ' + text);
  btn.click();
}, text, scope || null);
const bodyText = () => p.evaluate(() => (document.querySelector('.content-inner') || document.body).innerText.replace(/\s+/g, ' '));
// 设置类页面已改成二级页（.subpage），选周 / 课程详情仍是弹窗（.modal）；两种都读得到
const modalText = () => p.evaluate(() => {
  const el = document.querySelector('.subpage') || document.querySelector('.modal');
  return el ? el.innerText.replace(/\s+/g, ' ') : '';
});
const toastText = () => p.evaluate(() => Array.from(document.querySelectorAll('.toast')).map((e) => e.innerText).join(' | '));
const cfg = () => p.evaluate(() => {
  const c = window.__schedule.cfg;
  return {
    termStart: c.termStart, ttWeek: c.ttWeek, ttWeekMode: c.ttWeekMode,
    classNotif: c.classNotif, classLead30: c.classLead30, classLead10: c.classLead10,
    classMerge: c.classMerge, ttLocked: c.ttLocked, ttDrag: c.ttDrag
  };
});
const swState = (k) => p.$eval('[data-k="sw-' + k + '"]', (e) => ({
  on: e.getAttribute('aria-checked') === 'true', disabled: e.disabled
}));
const pickWeekChip = (n) => p.evaluate((n) => {
  const chip = Array.from(document.querySelectorAll('.modal .chip')).find((x) => x.innerText.trim() === '第 ' + n + ' 周');
  if (!chip) return false;
  chip.click();
  return true;
}, n);

// 造数据：一门本周的课 + 开学第一周 = 本周一，于是「本周 = 第 1 教学周」
const info = await p.evaluate(async () => {
  const s = window.__schedule;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (x) => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  const wd = ((d.getDay() + 6) % 7) + 1;
  const monday = new Date(d); monday.setDate(d.getDate() - (wd - 1));
  const minus35 = new Date(monday); minus35.setDate(monday.getDate() - 35);
  const minus14 = new Date(monday); minus14.setDate(monday.getDate() - 14);
  await s.putRecord('courses', 'c-math', {
    name: '高等数学', teacher: '蔡淑云', location: '北2229', className: '',
    weekday: wd, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 18,
    weekParity: 'all', color: '#4f8cff', note: '', createdAt: Date.now()
  });
  return { today: fmt(d), wd, monday: fmt(monday), minus14: fmt(minus14), minus35: fmt(minus35) };
});
await sleep(400);
await p.evaluate(() => { location.hash = '#tt'; });
await sleep(1500);
// 开学日期走真实 UI 填（顺便验证这一行没被改坏）
await setVal('.content-inner input[type=date]', info.monday);
await sleep(900);

// 手机竖屏下也能点到的那颗周次入口，先记一下位置：后面窄屏检查用它
console.log('\n[1] 固定周：顶部入口 / 随意选周 / 重开回到那一周');
ok('顶部有周次入口，写着「第 1 周 · 跟随今天」',
  /第 1 周/.test(await p.$eval('[data-k="week-chip"]', (e) => e.innerText.replace(/\s+/g, ' '))) &&
  /跟随今天/.test(await p.$eval('[data-k="week-chip"]', (e) => e.innerText)), await p.$eval('[data-k="week-chip"]', (e) => e.innerText));
ok('课表设置按钮就在顶栏，不用进二级菜单', (await p.$('[data-k="tt-settings"]')) !== null);
await p.click('[data-k="week-chip"]');
await sleep(600);
const pickTxt = await modalText();
ok('点开是「选周次」面板，先告诉你今天是第几周', /选周次/.test(pickTxt) && /今天是/.test(pickTxt), pickTxt.slice(0, 120));
ok('面板里列出 1..20 周可以直接点', (await p.$$('.modal .week-row .chip')).length >= 20);
ok('选中第 5 周', await pickWeekChip(5));
await sleep(300);
const applyTxt = await p.$eval('[data-k="wk-apply"]', (e) => e.innerText.trim());
ok('主按钮写明「固定在第 5 周」，不是含糊的确定', /固定在第 5 周/.test(applyTxt), applyTxt);
await p.click('[data-k="wk-apply"]');
await sleep(900);
const c1 = await cfg();
ok('固定到第 5 周已写进配置', c1.ttWeek === 5 && c1.ttWeekMode === 'fixed', c1);
const t1 = await bodyText();
ok('页面出现「已固定在第 5 周」提示条', /已固定在第 5 周/.test(t1), t1.slice(0, 150));
ok('周表切到第 5 教学周', /第 5 教学周/.test(t1), t1.slice(0, 150));
const chip1 = await p.$eval('[data-k="week-chip"]', (e) => e.innerText.replace(/\s+/g, ' '));
ok('chip 变成「第 5 周 · 已固定」', /第 5 周/.test(chip1) && /已固定/.test(chip1), chip1);
ok('提示条上有「解除固定」', await p.$eval('[data-k="tt-pinned"]', (e) => /解除固定/.test(e.innerText)));

await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2600);
const c2 = await cfg();
const t2 = await bodyText();
ok('重开应用还停在第 5 周（不用再点一次）', c2.ttWeek === 5 && c2.ttWeekMode === 'fixed', c2);
ok('重开后页面仍显示「已固定在第 5 周 / 正在看第 5 周」',
  /已固定在第 5 周/.test(t2) && /正在看第 5 周/.test(t2), t2.slice(0, 170));

console.log('\n[2] 解除固定：回到跟着今天走');
await clickText('解除固定', '[data-k="tt-pinned"]');
await sleep(900);
const c3 = await cfg();
const t3 = await bodyText();
ok('解除固定后模式回到 follow', c3.ttWeekMode === 'follow', c3);
ok('固定提示条消失', !/已固定在第/.test(t3));
ok('回到本周（第 1 周），不再有「正在看第」', /当前第 1 教学周/.test(t3) && !/正在看第/.test(t3), t3.slice(0, 170));

console.log('\n[3] 面板里的「回跟随」和「就地校准」');
await p.click('[data-k="week-chip"]');
await sleep(600);
await pickWeekChip(4);
await sleep(250);
await p.click('[data-k="wk-apply"]');
await sleep(800);
const c4 = await cfg();
ok('先固定到第 4 周', c4.ttWeek === 4 && c4.ttWeekMode === 'fixed', c4);
await p.click('[data-k="week-chip"]');
await sleep(600);
await p.click('[data-k="wk-follow"]');
await sleep(900);
const c5 = await cfg();
ok('面板底部「解除固定，跟着今天走」同样生效', c5.ttWeekMode === 'follow' && !/已固定在第/.test(await bodyText()), c5);
await p.click('[data-k="week-chip"]');
await sleep(600);
await pickWeekChip(6);
await sleep(250);
await p.click('[data-k="wk-calibrate"]');
await sleep(900);
const c6 = await cfg();
const t6 = await bodyText();
ok('周次对不上时可就地校准：开学日期回推 35 天', c6.termStart === info.minus35, [c6.termStart, info.minus35]);
ok('校准后本周就是第 6 周，而且不锁定在 6', c6.ttWeekMode === 'follow' && /当前第 6 教学周/.test(t6), t6.slice(0, 170));

console.log('\n[4] 课表设置：六个开关都在，关掉真的变');
await p.click('[data-k="tt-settings"]');
await sleep(700);
const swCount = await p.$$eval('[data-k^="sw-"]', (els) => els.length);
ok('设置面板里一共六个开关', swCount === 6, swCount);
const labels = await p.$$eval('[data-k^="sw-"]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
const need = ['上课提醒', '提前 30 分钟', '提前 10 分钟', '连堂课', '锁定课表', '长按拖动调课'];
ok('六个开关语义清楚（没有「功能 A/B」这种）', need.every((k) => labels.some((x) => x.includes(k))), labels);
const states0 = await p.$$eval('[data-k^="sw-"]', (els) => {
  const o = {};
  els.forEach((e) => { o[e.dataset.k.slice(3)] = e.getAttribute('aria-checked') === 'true'; });
  return o;
});
ok('默认：提醒三项/合并/拖动开着，锁定关着',
  states0.classNotif && states0.classLead30 && states0.classLead10 && states0.classMerge && states0.ttDrag && !states0.ttLocked, states0);

await p.click('[data-k="sw-classLead30"]');
await sleep(450);
let cc = await cfg();
ok('关掉「提前 30 分钟」立刻写进配置', cc.classLead30 === false && (await swState('classLead30')).on === false, cc.classLead30);
await p.click('[data-k="sw-classLead10"]');
await sleep(350);
await p.click('[data-k="sw-classMerge"]');
await sleep(450);
cc = await cfg();
ok('关掉「提前 10 分钟」和「连堂课合并」也都落盘',
  cc.classLead10 === false && cc.classMerge === false, [cc.classLead10, cc.classMerge]);
const toastAfter = await toastText();
ok('每切一下都有 toast 回执（不是静默改了）', /提醒/.test(toastAfter), toastAfter);

await p.click('[data-k="sw-classNotif"]');
await sleep(500);
cc = await cfg();
const deps = [await swState('classLead30'), await swState('classLead10'), await swState('classMerge')];
ok('关掉总开关后三个子项一起灰掉', cc.classNotif === false && deps.every((x) => x.disabled), { notif: cc.classNotif, deps });
ok('灰掉时有一句解释，不是莫名点不动', /总开关关着/.test(await modalText()));
await p.evaluate(() => document.querySelector('[data-k="sw-classLead10"]').click());
await sleep(400);
ok('灰掉时点它不会偷偷改状态', (await cfg()).classLead10 === false);
await p.click('[data-k="sw-classNotif"]');
await sleep(500);
const depOn = [await swState('classLead30'), await swState('classLead10'), await swState('classMerge')];
ok('重新打开总开关，三项恢复可点', (await cfg()).classNotif === true && depOn.every((x) => !x.disabled));

await p.click('[data-k="sw-ttLocked"]');
await sleep(500);
ok('锁定开关打开后 ttLocked=true', (await cfg()).ttLocked === true);
await p.click('[data-k="sw-ttDrag"]');
await sleep(350);
ok('关掉「长按拖动调课」写进配置', (await cfg()).ttDrag === false, await cfg());
await p.click('[data-k="sw-ttDrag"]');
await sleep(350);
ok('再打开恢复默认', (await cfg()).ttDrag === true, await cfg());
await p.click('.subpage-right button');
await sleep(800);

await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2600);
const c7 = await cfg();
ok('开关状态重开后都在（不是只活在内存里）',
  c7.classNotif === true && c7.classLead30 === false && c7.classLead10 === false &&
  c7.classMerge === false && c7.ttLocked === true, c7);
ok('拖动开关重开后仍在配置里', c7.ttDrag === true, c7.ttDrag);

console.log('\n[5] 锁定：只挡改，不挡看');
const t8 = await bodyText();
ok('重开后处于锁定态，顶部有明确提示', /课表已锁定/.test(t8), t8.slice(0, 200));
ok('网格标题旁有「🔒 已锁定」胶囊', (await p.$('[data-k="lock-pill"]')) !== null);
ok('网格容器带上 tt-locked 标记', (await p.$('.tt-locked')) !== null);

// 找一格不是课程所在列的空白格（避免点到课程块）
const blankPoint = async () => p.evaluate((wd) => {
  const cells = Array.from(document.querySelectorAll('.tt-cell[data-date][data-start]'));
  const cell = cells.find((c) => {
    const d = new Date(c.dataset.date + 'T00:00:00');
    return ((d.getDay() + 6) % 7) + 1 !== wd;
  });
  if (!cell) return null;
  cell.scrollIntoView({ block: 'center', inline: 'center' });
  const r = cell.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}, info.wd);
let pt = await blankPoint();
ok('页面上找得到空白格子', !!pt);
await p.mouse.click(pt.x, pt.y);
await sleep(700);
ok('锁定后点空白格不会弹加课面板', (await p.$('.modal')) === null);
ok('点空白格会明确说「课表已锁定」', /课表已锁定/.test(await toastText()), await toastText());

await p.click('.tt-course');
await sleep(700);
const mt = await modalText();
ok('锁定后点课程仍能看详情（只是不能改）', /这门课的备注/.test(mt), mt.slice(0, 120));
ok('详情顶部有锁定横幅 + 就地解锁按钮', /课表已锁定/.test(mt) && /解锁/.test(mt));
const dis = await p.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.modal button'));
  const find = (t) => btns.find((b) => b.innerText.trim() === t);
  return {
    time: find('改时间 / 地点') ? find('改时间 / 地点').disabled : null,
    move: find('调到别的日期') ? find('调到别的日期').disabled : null,
    cancel: find('这次停课') ? find('这次停课').disabled : null,
    edit: find('编辑这门课（整学期）') ? find('编辑这门课（整学期）').disabled : null,
    del: find('删除这门课') ? find('删除这门课').disabled : null
  };
});
ok('锁定后 改时间/调课/停课/编辑/删除 全部禁用',
  dis.time === true && dis.move === true && dis.cancel === true && dis.edit === true && dis.del === true, dis);
const beforeDel = await p.evaluate(() => window.__schedule.list('courses').length);
await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '删除这门课');
  if (b) b.click();
});
await sleep(600);
const afterDel = await p.evaluate(() => window.__schedule.list('courses').length);
ok('禁用状态下点「删除」不会真的删掉', afterDel === beforeDel && afterDel === 1, [beforeDel, afterDel]);
await clickText('关闭', '.modal-foot');
await sleep(500);

// 锁定时长按：不该把课拎起来，但要提示
const coursePoint = async () => p.$eval('.tt-course', (e) => {
  e.scrollIntoView({ block: 'center', inline: 'center' });
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
let cp = await coursePoint();
await p.mouse.move(cp.x, cp.y);
await p.mouse.down();
await sleep(800);
const ghostLocked = await p.$('.tt-ghost');
const toastLocked = await toastText();
await p.mouse.up();
await sleep(700);
ok('锁定后长按不会出现拖影', ghostLocked === null);
ok('长按会提示「课表已锁定」', /课表已锁定/.test(toastLocked), toastLocked);
if (await p.$('.modal')) { await clickText('关闭', '.modal-foot'); await sleep(400); }

console.log('\n[6] 解锁：入口恢复');
await p.click('[data-k="lock-pill"]');
await sleep(700);
ok('点锁定胶囊直接打开课表设置', /课表设置/.test(await modalText()));
await p.click('[data-k="sw-ttLocked"]');
await sleep(600);
ok('在设置里解锁，ttLocked=false', (await cfg()).ttLocked === false);
await p.click('.subpage-right button');
await sleep(700);
ok('解锁后顶部锁定提示和胶囊都消失',
  !/课表已锁定/.test(await bodyText()) && (await p.$('.tt-locked')) === null && (await p.$('[data-k="lock-pill"]')) === null);

pt = await blankPoint();
await p.mouse.click(pt.x, pt.y);
await sleep(700);
ok('解锁后点空白格又能加课', /添加课程/.test(await modalText()), (await modalText()).slice(0, 80));
if (await p.$('.modal')) { await clickText('取消', '.modal-foot'); await sleep(400); }

const cAfter = await p.evaluate(() => {
  const btns = [];
  return btns;
});
void cAfter;
await p.click('.tt-course');
await sleep(700);
const delEnabled = await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '删除这门课');
  return b ? !b.disabled : false;
});
ok('解锁后详情里的「删除这门课」恢复可点', delEnabled);
await clickText('关闭', '.modal-foot');
await sleep(400);

console.log('\n[7] 第六个开关：长按拖动可以关掉');
await p.click('[data-k="tt-settings"]');
await sleep(600);
await p.click('[data-k="sw-ttDrag"]');
await sleep(400);
await p.click('.subpage-right button');
await sleep(600);
cp = await coursePoint();
await p.mouse.move(cp.x, cp.y);
await p.mouse.down();
await sleep(800);
const ghostOff = await p.$('.tt-ghost');
await p.mouse.up();
await sleep(700);
ok('关掉「长按拖动调课」后长按不再拎起课程', ghostOff === null);
if (await p.$('.modal')) { await clickText('关闭', '.modal-foot'); await sleep(400); }

await p.click('[data-k="tt-settings"]');
await sleep(600);
await p.click('[data-k="sw-ttDrag"]');
await sleep(400);
await p.click('.subpage-right button');
await sleep(600);
cp = await coursePoint();
await p.mouse.move(cp.x, cp.y);
await p.mouse.down();
await sleep(800);
const ghostOn = await p.$('.tt-ghost');
await p.mouse.up();
await sleep(800);
ok('重新打开后长按又出现拖影（拖动恢复）', ghostOn !== null);
if (await p.$('.modal')) { await clickText('关闭', '.modal-foot'); await sleep(400); }

console.log('\n[8] 控制台干净');
const realErrs = errs.filter((e) => !/favicon|DevTools|ERR_BLOCKED|Failed to load resource.*404/i.test(e));
ok('没有 console / page 报错', realErrs.length === 0, realErrs.slice(0, 6));

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await browser.close();
stopIsolatedServer();
if (fail) process.exitCode = 1;
