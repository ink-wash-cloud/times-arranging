// 待办页第五个标签「长远目标」的专项回归。
//
// 这个视图是新增的：新建目标（含提醒预设换算）、记录进度、完成 / 恢复、
// 删除 + 撤销、空态、390px 单列，以及原有四列看板不被替换。
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
};

const URL = process.argv[2] || await startIsolatedServer(8881);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await browser.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const text = async (sel) => p.$eval(sel, (el) => el.innerText).then(norm).catch(() => '');
const rowText = async (i) => p.$$eval('.goal-row', (rows, idx) => (rows[idx] ? rows[idx].innerText : ''), i).then(norm);
const listGoals = () => p.evaluate(() => window.__schedule.list('goals'));

const clickText = async (sel, needle, exact = false) => {
  const found = await p.evaluate((s, n, ex) => {
    const el = Array.from(document.querySelectorAll(s)).find((x) => {
      const tx = (x.innerText || '').trim();
      return ex ? tx === n : tx.includes(n);
    });
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, sel, needle, exact);
  await sleep(350);
  if (!found) throw new Error('点不到：' + sel + ' / ' + needle);
  return found;
};

const clickRowButton = async (index, label) => {
  const found = await p.evaluate((i, l) => {
    const row = document.querySelectorAll('.goal-row')[i];
    if (!row) return false;
    const btn = Array.from(row.querySelectorAll('button')).find((b) => (b.innerText || '').trim() === l);
    if (!btn) return false;
    btn.click();
    return true;
  }, index, label);
  await sleep(400);
  if (!found) throw new Error('点不到目标行按钮：' + label);
};

const fill = async (sel, value) => {
  await p.click(sel, { clickCount: 3 });
  await p.keyboard.press('Backspace');
  if (value) await p.type(sel, value);
  await sleep(120);
};

const setDate = (sel, value) => p.evaluate((s, v) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, sel, value);

try {
  await p.setViewport({ width: 1440, height: 1000 });
  await p.goto(URL, { waitUntil: 'networkidle2' });
  await p.waitForSelector('.app');
  await p.evaluate(() => { location.hash = '#tasks'; });
  await p.waitForSelector('.tasks-tabs');
  await sleep(900);

  console.log('\n[1] 标签栏与原有四列');
  const tabs = await p.$$eval('.tasks-tab', (els) => els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()));
  ok('标签栏有 5 个标签', tabs.length === 5, tabs);
  ok('第 5 个是「长远目标」', tabs[4] && tabs[4].includes('长远目标'), tabs[4]);
  ok('默认四列看板还在', (await p.$$('.kanban .col')).length === 4, (await p.$$('.kanban .col')).length);
  await clickText('.tasks-tab', '未来 7 天', true);
  ok('前四个标签只跳转，不隐藏看板', (await p.$$('.kanban .col')).length === 4);
  await clickText('.tasks-tab', '长远目标');
  await p.waitForSelector('.goals-view');
  await clickText('.tasks-tab', '今日', true);
  await sleep(800);
  ok('从目标页点「今日」回到四列看板', (await p.$$('.kanban .col')).length === 4 && (await p.$('.goals-view')) === null);

  console.log('\n[2] 空态');
  await clickText('.tasks-tab', '长远目标');
  await p.waitForSelector('.goals-view');
  const empty = await text('.goal-empty');
  ok('空态说明', empty.includes('还没有长远目标'), empty);
  ok('空态提示', empty.includes('目标不占每天的时间，到点才提醒'), empty);
  ok('空态有新建入口', empty.includes('新建第一个目标'), empty);
  const stats0 = await text('.goal-stats-card');
  ok('统计是 0 / 0 次', stats0.includes('0 / 0 次'), stats0);
  ok('空态右侧新建卡还在', await p.$('.goal-create-card') !== null);
  await p.screenshot({ path: '.tmp/goal-empty.png' });

  console.log('\n[3] 新建目标：30 天后提醒');
  const expectedRemind = await p.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    const z = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T09:00';
  });
  await fill('.goal-create-card input.input', '考过英语四级');
  await clickText('.goal-create-card .goal-preset-row .chip', '30 天后', true);
  await fill('.goal-create-card textarea', '每天两篇阅读，周末一套真题');
  await clickText('.goal-create-card button', '创建目标', true);
  await sleep(700);
  let goals = await listGoals();
  ok('目标写进 goals 集合', goals.length === 1, goals.length);
  const g1 = goals[0] || {};
  ok('提醒预设换算成 30 天后 09:00', g1.remindAt === expectedRemind, { got: g1.remindAt, want: expectedRemind });
  ok('初始进度 0', g1.progress === 0, g1.progress);
  ok('初始状态进行中', g1.status === '进行中', g1.status);
  ok('目标日可以先空着', g1.targetDate === null, g1.targetDate);
  const card1 = await rowText(0);
  ok('卡片显示标题', card1.includes('考过英语四级'), card1);
  ok('卡片显示 0%', card1.includes('0%'), card1);
  ok('卡片显示提醒 chip', card1.includes('提醒：') && card1.includes('09:00'), card1);
  ok('卡片显示未设目标日', card1.includes('未设目标日'), card1);
  const activeTab1 = await text('.tasks-tab.on');
  ok('标签上的进行中数量变成 1', activeTab1.includes('长远目标1'), activeTab1);

  console.log('\n[4] 第二个目标：不提醒 + 目标日');
  const targetDate = await p.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 34);
    const z = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  });
  await fill('.goal-create-card input.input', '攒够 10000 元');
  await clickText('.goal-create-card .goal-preset-row .chip', '不提醒', true);
  await clickText('.goal-create-card .goal-preset-row .chip', '杂事', true);
  await setDate('.goal-create-card input[type=date]', targetDate);
  await fill('.goal-create-card textarea', '每月发工资先存 1500');
  await clickText('.goal-create-card button', '创建目标', true);
  await sleep(700);
  goals = await listGoals();
  ok('第二个目标创建成功', goals.length === 2, goals.length);
  const g2 = goals.find((g) => g.title === '攒够 10000 元') || {};
  ok('不提醒时 remindAt 为 null', g2.remindAt === null, g2.remindAt);
  ok('目标日写进去了', g2.targetDate === targetDate, { got: g2.targetDate, want: targetDate });
  ok('分类写进去了', g2.category === '杂事', g2.category);
  const secondRow = await p.$$eval('.goal-row', (rows) => {
    const row = rows.find((x) => x.innerText.includes('攒够 10000 元'));
    return row ? row.innerText : '';
  }).then(norm);
  ok('第二个卡片显示目标日和剩余天数', secondRow.includes('目标日 ' + targetDate) && secondRow.includes('还有 34 天'), secondRow);
  const activeTab2 = await text('.tasks-tab.on');
  ok('标签上的数量变成 2', activeTab2.includes('长远目标2'), activeTab2);
  await p.screenshot({ path: '.tmp/goal-list.png' });

  console.log('\n[5] 记录进度');
  await clickRowButton(0, '记录进度');
  await p.waitForSelector('.modal');
  ok('打开的是记录进度弹窗', (await text('.modal h3')) === '记录进度', await text('.modal h3'));
  await fill('.modal input[type=number]', '62');
  await fill('.modal textarea', '单词背完 2800/4500 · 真题 6/12 套');
  await clickText('.modal .goal-form-actions button', '保存', true);
  await sleep(700);
  goals = await listGoals();
  const g1b = goals.find((g) => g.title === '考过英语四级') || {};
  ok('进度存成 62', g1b.progress === 62, g1b.progress);
  ok('里程碑存进去了', g1b.milestones === '单词背完 2800/4500 · 真题 6/12 套', g1b.milestones);
  const progressed = await rowText(0);
  ok('卡片显示 62%', progressed.includes('62%'), progressed);
  ok('卡片显示里程碑', progressed.includes('里程碑：单词背完 2800/4500'), progressed);
  const stats1 = await text('.goal-stats-card');
  ok('本月推进次数变成 1 / 2 次', stats1.includes('1 / 2 次'), stats1);
  // v1.6.0 起进度时间戳跟着记录走（GoalData.progressLog），换设备也能同步，不再写 localStorage。
  const logLen = Array.isArray(g1b.progressLog) ? g1b.progressLog.length : 0;
  ok('进度日志跟着记录记了一条', logLen === 1, logLen);
  const staleLocal = await p.evaluate(() => localStorage.getItem('goalProgressLog'));
  ok('本机不再写旧的 localStorage 进度日志', staleLocal === null, staleLocal);

  console.log('\n[6] 完成与恢复');
  await clickRowButton(0, '编辑');
  ok('打开的是编辑目标弹窗', (await text('.modal h3')) === '编辑目标', await text('.modal h3'));
  await clickText('.modal .goal-edit-extra button', '标记为已完成', true);
  await sleep(700);
  goals = await listGoals();
  const doneGoal = goals.find((g) => g.title === '考过英语四级') || {};
  ok('状态变成已完成', doneGoal.status === '已完成', doneGoal.status);
  ok('completedAt 有值', typeof doneGoal.completedAt === 'number' && doneGoal.completedAt > 0, doneGoal.completedAt);
  ok('进行中只剩 1 个', (await p.$$('.goal-row')).length === 1, (await p.$$('.goal-row')).length);
  ok('已经做到分组出现 1 个', (await p.$$('.goal-done-row')).length === 1, (await p.$$('.goal-done-row')).length);
  const doneRow = await text('.goal-done-row');
  ok('已经做到行显示标题和完成日期', doneRow.includes('考过英语四级') && doneRow.includes('完成'), doneRow);
  ok('标签数量回到 1', (await text('.tasks-tab.on')).includes('长远目标1'), await text('.tasks-tab.on'));
  await p.screenshot({ path: '.tmp/goal-done.png' });

  await clickText('.goal-done-row button', '恢复', true);
  await sleep(600);
  goals = await listGoals();
  const restored = goals.find((g) => g.title === '考过英语四级') || {};
  ok('恢复为进行中', restored.status === '进行中' && restored.completedAt === null, restored);
  ok('进行中又回到 2 个', (await p.$$('.goal-row')).length === 2, (await p.$$('.goal-row')).length);
  ok('已经做到分组消失', (await p.$$('.goal-done-row')).length === 0, (await p.$$('.goal-done-row')).length);

  console.log('\n[7] 删除与撤销');
  const beforeDelete = await listGoals();
  const targetId = (beforeDelete.find((g) => g.title === '考过英语四级') || {}).id;
  await clickRowButton(0, '编辑');
  await clickText('.modal .goal-edit-extra button', '删除目标', true);
  await sleep(600);
  const modalTitles = await p.$$eval('.modal h3', (els) => els.map((e) => (e.innerText || '').trim()));
  ok('删除前有确认框', modalTitles.includes('删除目标'), modalTitles);
  await p.evaluate(() => {
    const modals = Array.from(document.querySelectorAll('.modal'));
    const top = modals[modals.length - 1];
    const btn = Array.from(top.querySelectorAll('.modal-foot button')).find((b) => (b.innerText || '').trim() === '删除');
    if (btn) btn.click();
  });
  await sleep(900);
  goals = await listGoals();
  ok('删除后只剩 1 个目标', goals.length === 1 && !goals.some((g) => g.id === targetId), goals.map((g) => g.title));
  const toastText = await text('.toast-wrap');
  ok('删除后有提示和撤销入口', toastText.includes('已删除') && (await p.$('.toast-act')) !== null, toastText);
  await p.click('.toast-act');
  await sleep(800);
  goals = await listGoals();
  const undone = goals.find((g) => g.id === targetId);
  ok('撤销后目标回来了', goals.length === 2 && !!undone, goals.map((g) => g.title));
  ok('撤销保留原进度', !!undone && undone.progress === 62, undone && undone.progress);

  console.log('\n[8] 390px 单列与新建弹窗');
  await p.setViewport({ width: 390, height: 844 });
  await sleep(700);
  const createCardDisplay = await p.$eval('.goal-create-card', (el) => getComputedStyle(el).display);
  ok('手机端隐藏右栏新建卡', createCardDisplay === 'none', createCardDisplay);
  const cols = await p.$eval('.goals-view', (el) => getComputedStyle(el).gridTemplateColumns);
  ok('手机端目标视图单列', cols.trim().split(/\s+/).length === 1, cols);
  const noOverflow = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok('390px 没有横向溢出', noOverflow, await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })));
  const tabsFit = await p.$$eval('.tasks-tab', (els) => els.every((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= -1 && r.right <= window.innerWidth + 1;
  }));
  ok('390px 五个标签都在屏幕内', tabsFit);
  const activeFit = await p.$eval('.tasks-tab.on', (el) => {
    const r = el.getBoundingClientRect();
    return r.left >= -1 && r.right <= window.innerWidth + 1;
  });
  ok('390px 当前标签可见', activeFit);
  await p.screenshot({ path: '.tmp/goal-mobile-list.png' });
  await clickText('.goal-new', '新建目标');
  await sleep(500);
  ok('手机端新建按钮打开弹窗', (await p.$('.modal')) !== null);
  ok('弹窗标题是新建长远目标', (await text('.modal h3')) === '新建长远目标', await text('.modal h3'));
  ok('弹窗里有目标名字输入框', (await p.$('.modal input.input')) !== null);
  await p.screenshot({ path: '.tmp/goal-mobile.png' });
  await p.click('.modal .card-h button');
  await sleep(400);

  console.log('\n[9] 控制台');
  ok('没有 JS 运行时错误', errs.length === 0, errs.slice(0, 3));
} catch (e) {
  fail++;
  console.log('  FATAL  ' + (e && e.stack ? e.stack : String(e)));
  try { await p.screenshot({ path: '.tmp/goal-fatal.png' }); } catch { /* 页面可能已经关了 */ }
} finally {
  await browser.close();
  if (!process.argv[2]) stopIsolatedServer();
}

console.log('\n========================================');
console.log('  长远目标验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
