// 课表：真人操作测试（加课 / 编辑 / 周次 / 固定周 / 导入分班 / 拖动 / 锁定 / 停课删除）
//
// 所有数据都用真实 UI 操作产生，不用 window.__schedule 直接写库。
// 只读 window.__schedule 做"数据真的落库了吗"的断言。
import {
  launch, openApp, reload, text, waitText, clickText, click, typeInto, press, go, report, sleep, state
} from './e2e.mjs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const PORT = 8862;
const r = report('课表：真人操作');
let browser = null;
let srv = null;

const cellSel = (date, start) => '.tt-cell[data-date="' + date + '"][data-start="' + start + '"]';
const courseTexts = (page) => page.$$eval('.tt-course', (els) => els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()));
const courseNames = async (page) => (await courseTexts(page)).map((t) => t.split(' ')[0]);
const count = async (page, sel) => (await page.$$(sel)).length;
const modalText = (page) => text(page, '.modal');

async function openCourse(page, name) {
  await clickText(page, '.tt-course', name);
  await page.waitForSelector('.modal', { timeout: 5000 });
  await sleep(350);
}

async function closeModal(page) {
  if (await page.$('.modal')) { await press(page, 'Escape'); await sleep(350); }
}

async function pickLineChip(page, label, chip) {
  const lines = await page.$$('.pick-line');
  for (const line of lines) {
    const lab = await line.$eval('.pick-label', (el) => (el.innerText || '').trim()).catch(() => '');
    if (lab !== label) continue;
    const chips = await line.$$('.chip');
    for (const c of chips) {
      const t = await c.evaluate((el) => (el.innerText || '').trim());
      if (t === chip) {
        await c.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
        await sleep(60);
        await c.click();
        await sleep(450);
        return true;
      }
    }
  }
  throw new Error('找不到「' + label + '」里的 chip：' + chip);
}

async function setNumberField(page, sel, index, value) {
  await page.evaluate((s, i, v) => {
    const el = document.querySelectorAll(s)[i];
    if (!el) throw new Error('找不到第 ' + i + ' 个输入框：' + s);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, sel, index, value);
  await sleep(200);
}

async function setDateInput(page, value) {
  await page.evaluate((val) => {
    const el = document.querySelector('input[type="date"]');
    if (!el) throw new Error('页面上没有日期输入框');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await sleep(500);
}

async function rectOf(page, sel, textNeedle) {
  await page.evaluate((s, needle) => {
    const list = Array.from(document.querySelectorAll(s));
    const el = needle ? list.find((x) => (x.innerText || '').includes(needle)) : list[0];
    if (el) el.scrollIntoView({ block: 'center', inline: 'center' });
  }, sel, textNeedle || '');
  await sleep(300);
  return page.evaluate((s, needle) => {
    const list = Array.from(document.querySelectorAll(s));
    const el = needle ? list.find((x) => (x.innerText || '').includes(needle)) : list[0];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, sel, textNeedle || '');
}

async function longPressAt(page, pt, ms) {
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await sleep(ms);
}

try {
  srv = await startIsolatedServer(PORT);
  const L = await launch({ width: 1400, height: 1000 });
  browser = L.browser;
  const page = L.page;
  const errors = L.errors;
  await openApp(page, srv);

  const info = await page.evaluate(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (x) => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
    const wd = ((d.getDay() + 6) % 7) + 1;
    const monday = new Date(d); monday.setDate(d.getDate() - (wd - 1));
    const tuesday = new Date(monday); tuesday.setDate(monday.getDate() + 1);
    return { today: fmt(d), todayWd: wd, monday: fmt(monday), tuesday: fmt(tuesday), nextWd: wd % 7 + 1 };
  });

  // 进课表
  await go(page, '我的课表');
  await page.waitForSelector('.tt', { timeout: 15000 });
  await sleep(600);

  // ---------- 1. 空态 + 点空白格加课 ----------
  const empty = (await text(page)).includes('课表还是空的');
  const gridReady = !!(await page.$('.tt'));

  await click(page, cellSel(info.today, '08:00'));
  await page.waitForSelector('.modal', { timeout: 5000 });
  const newTitle = await modalText(page);
  const times = await page.$$eval('.modal input[type="time"]', (els) => els.map((e) => e.value));
  r.ok('空课表点空白格弹出「添加课程」且默认 08:00-08:45', gridReady && empty && newTitle.includes('添加课程') && times[0] === '08:00' && times[1] === '08:45', { empty, newTitle: newTitle.slice(0, 80), times });

  const I = '.modal .form-grid input.input';
  await typeInto(page, I, '高等数学A', { index: 0 });
  await typeInto(page, I, '张建国', { index: 1 });
  await typeInto(page, I, '教三201', { index: 2 });
  // 起始周 / 结束周用弹窗默认的 1-16（type=number 输入框里 Ctrl+A 清不干净，会变成 11-1616）
  await clickText(page, '.modal-foot button', '添加');
  const addToast = await waitText(page, '已添加课程', 3000);
  await sleep(500);
  const card1 = (await courseTexts(page))[0] || '';
  const total1 = await state(page, () => window.__schedule.list('courses').length);
  r.ok('保存后出现卡片（名称/教室/教师/周次）并提示已添加',
    addToast && card1.includes('高等数学A') && card1.includes('@教三201') && card1.includes('张建国') && card1.includes('1-16周') && total1 === 1,
    { addToast, card1, total1 });

  // ---------- 2. 点卡片编辑（改教室） ----------
  await openCourse(page, '高等数学A');
  const sheetText = await modalText(page);
  r.ok('点课程卡片弹出这一天的调整面板', sheetText.includes('高等数学A') && sheetText.includes('这次'), sheetText.slice(0, 120));

  await clickText(page, '.modal button', '编辑这门课');
  await sleep(600);
  const editTitle = await modalText(page);
  const vals = await page.$$eval(I, (els) => els.map((e) => e.value));
  r.ok('编辑弹窗预填名称/教师/地点', editTitle.includes('编辑课程') && vals[0] === '高等数学A' && vals[1] === '张建国' && vals[2] === '教三201', vals.slice(0, 3));

  await typeInto(page, I, '教三305', { index: 2 });
  await clickText(page, '.modal-foot button', '保存');
  await waitText(page, '已保存', 3000);
  await sleep(500);
  const card2 = (await courseTexts(page))[0] || '';

  await openCourse(page, '高等数学A');
  await clickText(page, '.modal button', '编辑这门课');
  await sleep(600);
  const loc2 = (await page.$$eval(I, (els) => els.map((e) => e.value)))[2];
  r.ok('改教室后卡片与重开编辑框都同步为 教三305', card2.includes('@教三305') && loc2 === '教三305', { card2, loc2 });
  await clickText(page, '.modal-foot button', '取消');
  await sleep(400);

  // ---------- 3. 手动添加第二门课（第 2 周） ----------
  await clickText(page, 'button', '更多');
  await sleep(300);
  await clickText(page, '[role="menuitem"]', '手动添加课程');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await typeInto(page, I, '大学英语', { index: 0 });
  await page.select('.modal select', String(info.nextWd));
  await sleep(200);
  // type=number 输入框里 Ctrl+A 清不干净（会变成 12-162），改用原生 setter 写值
  await setNumberField(page, I, 6, '2');
  await setNumberField(page, I, 7, '2');
  await clickText(page, '.modal-foot button', '添加');
  await sleep(700);
  const names3 = await courseNames(page);
  r.ok('第二门课添加成功（全部周次下两门都在）', names3.includes('高等数学A') && names3.includes('大学英语'), names3);

  // ---------- 4. 周次 chip 过滤 ----------
  await pickLineChip(page, '周次', '第 1 周');
  const w1 = await courseNames(page);
  await pickLineChip(page, '周次', '第 2 周');
  const w2 = await courseNames(page);
  await pickLineChip(page, '周次', '第 3 周');
  const w3 = await courseNames(page);
  await pickLineChip(page, '周次', '全部');
  const wa = await courseNames(page);
  r.ok('第 1/2/3 周与「全部」各自只显示该周有课的课程',
    w1.length === 1 && w1[0] === '高等数学A' && w2.length === 2 && w2.includes('大学英语') && w2.includes('高等数学A') && w3.length === 1 && w3[0] === '高等数学A' && wa.length === 2,
    { w1, w2, w3, wa });

  // ---------- 5. 开学日期 / 固定周 / 重开记忆 / 解除固定 ----------
  await setDateInput(page, info.monday);
  const heads = await page.$$eval('.tt-head', (els) => els.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()));
  const weekLabel = (await text(page)).includes('当前第 1 教学周');
  r.ok('填开学第一周周一后显示第 1 教学周、列头日期对得上',
    weekLabel && heads[0] && heads[0].includes(info.monday.slice(5)) && heads[1] && heads[1].includes(info.tuesday.slice(5)),
    { weekLabel, heads: heads.slice(0, 2) });

  await pickLineChip(page, '周次', '第 1 周');
  const n1 = await text(page, '.tt-week-n');
  const m1 = await text(page, '.tt-week-mode');
  r.ok('点本周的周次 = 跟着今天走', n1.includes('第 1 周') && m1.includes('跟随今天'), { n1, m1 });

  await pickLineChip(page, '周次', '第 2 周');
  const n2 = await text(page, '.tt-week-n');
  const m2 = await text(page, '.tt-week-mode');
  const pinText = await text(page, '.tt-pin');
  r.ok('点第 2 周后固定住并显示提示条', n2.includes('第 2 周') && m2.includes('已固定') && pinText.includes('已固定在第 2 周'), { n2, m2, pinText: pinText.slice(0, 80) });

  await reload(page);
  try { await page.waitForSelector('.tt', { timeout: 8000 }); } catch { await go(page, '我的课表'); await page.waitForSelector('.tt', { timeout: 8000 }); }
  await sleep(700);
  const rn = await text(page, '.tt-week-n');
  const rm = await text(page, '.tt-week-mode');
  const rp = await count(page, '.tt-pin');
  r.ok('重开应用仍回到第 2 周（固定周记忆）', rn.includes('第 2 周') && rm.includes('已固定') && rp === 1, { rn, rm, rp });

  await clickText(page, '.tt-pin button', '解除固定');
  await sleep(500);
  const un = await text(page, '.tt-week-n');
  const um = await text(page, '.tt-week-mode');
  const up = await count(page, '.tt-pin');
  r.ok('解除固定回到「跟着今天走」第 1 周', un.includes('第 1 周') && um.includes('跟随今天') && up === 0, { un, um, up });

  await setDateInput(page, '');
  await sleep(500);
  const cleared = (await text(page)).includes('未设置时不做周次过滤，所有课程都会显示');
  const wc = await courseNames(page);
  r.ok('清空开学日期后不做周次过滤、两门课都在', cleared && wc.length === 2, { cleared, wc });

  // ---------- 6. 导入两门分属不同班级的课 ----------
  await clickText(page, 'button', '导入课表');
  await waitText(page, '导入大学课表', 5000);
  const importLines = '[计26.1] 线性代数 刘洋 教二101 周三 10:00-11:40 1-16周\n[计26.2] 大学物理 陈静 教二202 周四 14:00-15:40 1-16周';
  await typeInto(page, '.modal textarea', importLines, { index: 0 });
  await clickText(page, '.modal button', '解析');
  const previewOk = await waitText(page, '解析预览（2 门', 5000);
  await clickText(page, '.modal-foot button', '确认导入');
  await sleep(900);
  const afterImport = await text(page);
  const names6 = await courseNames(page);
  r.ok('导入两班两门后共 4 门、班级 chip 出现',
    previewOk && afterImport.includes('共 4 门课') && afterImport.includes('计26.1') && afterImport.includes('计26.2') && names6.length === 4,
    { previewOk, names6, has26_1: afterImport.includes('计26.1') });

  await pickLineChip(page, '班级', '计26.1');
  const c1 = await courseNames(page);
  await pickLineChip(page, '班级', '计26.2');
  const c2 = await courseNames(page);
  await pickLineChip(page, '班级', '全部');
  const cAll = await courseNames(page);
  r.ok('班级 chip 各只显示该班、点「全部」恢复 4 门',
    c1.length === 1 && c1[0] === '线性代数' && c2.length === 1 && c2[0] === '大学物理' && cAll.length === 4 && cAll.includes('高等数学A') && cAll.includes('大学英语'),
    { c1, c2, cAll });

  // ---------- 6b. 手动加的课也要能存住班级 ----------
  // 回归：CourseEditor 组装 data 时漏了 className，编辑框填了也存不进库，班级筛选对手动建的课失效。
  await openCourse(page, '高等数学A');
  await clickText(page, '.modal button', '编辑这门课');
  await sleep(600);
  await typeInto(page, I, '计26.3', { index: 3 });
  await clickText(page, '.modal-foot button', '保存');
  await waitText(page, '已保存', 3000);
  await sleep(700);
  const clsStored = await page.evaluate(() => {
    const c = window.__schedule.list('courses').find((x) => x.name === '高等数学A') || {};
    return c.className || '';
  });
  const chipHas = (await text(page)).includes('计26.3');
  await pickLineChip(page, '班级', '计26.3');
  const clsOnly = await courseNames(page);
  await pickLineChip(page, '班级', '全部');
  r.ok('手动加的课能存住班级，并出现在班级筛选里',
    clsStored === '计26.3' && chipHas && clsOnly.length === 1 && clsOnly[0] === '高等数学A',
    { clsStored, chipHas, clsOnly });

  // ---------- 7. 长按拖动（第 1 节 → 第 3 节） ----------
  await pickLineChip(page, '周次', '全部');
  const mathPt = await rectOf(page, '.tt-course', '高等数学A');
  if (!mathPt) throw new Error('找不到高等数学A的卡片，无法拖动');
  await longPressAt(page, mathPt, 750);
  const ghost1 = await count(page, '.tt-ghost');

  const diagAt = (pt) => page.evaluate((x, y) => {
    const el = document.elementFromPoint(x, y);
    return {
      tag: el ? el.tagName : null,
      cls: el ? String(el.className || '') : '',
      cell: !!(el && el.closest && el.closest('.tt-cell')),
      ghost: document.querySelectorAll('.tt-ghost').length,
      dropTarget: document.querySelectorAll('.drop-target').length
    };
  }, pt.x, pt.y);
  const diagStart = await diagAt(mathPt);
  const targetPt = await rectOf(page, cellSel(info.today, '10:00'));
  await page.mouse.move(targetPt.x, targetPt.y, { steps: 12 });
  await sleep(500);
  const diagOver = await diagAt(targetPt);
  await page.mouse.up();
  await sleep(1000);
  const chState = await state(page, () => {
    const s = window.__schedule;
    return s.list('courseChanges').map((c) => ({ kind: c.kind, date: c.date, startTime: c.startTime, endTime: c.endTime }));
  });
  const moveToast = (await text(page, '.toast-wrap')).includes('已挪到 10:00');
  const strip1 = await text(page, '.tt-changes');
  r.ok('长按出现幽灵块、拖到 10:00 后记下一次性调整（kind=edit）并提示、格子高亮',
    ghost1 === 1 && diagOver.dropTarget === 1 && chState.length === 1 && chState[0].kind === 'edit' && chState[0].startTime === '10:00' && moveToast && strip1.includes('改时间/地点'),
    { ghost1, chState, moveToast, strip1: strip1.slice(0, 80), mathPt, targetPt, diagStart, diagOver });

  await clickText(page, '.tt-change-chip button', '撤销');
  await sleep(700);
  const undoState = await state(page, () => {
    const s = window.__schedule;
    const c = s.list('courses').find((x) => x.name === '高等数学A');
    return { n: s.list('courseChanges').length, startTime: c ? c.startTime : '' };
  });
  const strip2 = await count(page, '.tt-changes');
  r.ok('撤销拖动后记录清空、课程回到 08:00', undoState.n === 0 && undoState.startTime === '08:00' && strip2 === 0, { undoState, strip2 });

  // ---------- 7b. 拖到「已经排了课」的时段也要能落点 ----------
  // 回归：背景格子（.tt-cell）和课程块（.tt-course）是同一列里的兄弟节点，
  // 落点压在课块上时 elementFromPoint 拿不到格子。老版本 hitCell 返回 null，
  // finish() 直接 return —— 不记调整、不提示，用户以为拖不动。
  // 今天 10:00 空不空要看星期几（导入的线性代数在周三 10:00），
  // 所以这里自己造一门占位课，跟日期无关。
  await clickText(page, 'button', '更多');
  await sleep(300);
  await clickText(page, '[role="menuitem"]', '手动添加课程');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await typeInto(page, I, '占位课', { index: 0 });
  await page.select('.modal select', String(info.todayWd));
  await sleep(250);
  await page.evaluate(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const list = Array.from(document.querySelectorAll('.modal input[type="time"]'));
    [['14:00', 0], ['14:45', 1]].forEach((pair) => {
      const el = list[pair[1]];
      if (!el) return;
      set.call(el, pair[0]);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await sleep(300);
  await clickText(page, '.modal-foot button', '添加');
  await waitText(page, '已添加课程', 3000);
  await sleep(800);
  const hasBlocker = (await courseNames(page)).includes('占位课');

  await pickLineChip(page, '周次', '全部');
  const mathPt1b = await rectOf(page, '.tt-course', '高等数学A');
  if (!mathPt1b) throw new Error('找不到高等数学A的卡片，无法测「拖到有课的格子」');
  await longPressAt(page, mathPt1b, 750);
  const ghostOcc = await count(page, '.tt-ghost');
  const occRect = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.tt-course')).find((x) => (x.innerText || '').includes('占位课'));
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, inView: b.top >= 0 && b.bottom <= window.innerHeight };
  });
  let dropCount = 0;
  if (occRect && occRect.inView) {
    await page.mouse.move(occRect.x, occRect.y, { steps: 12 });
    await sleep(500);
    dropCount = await count(page, '.drop-target');
  }
  await page.mouse.up();
  await sleep(1000);
  const chOcc = await state(page, () => window.__schedule.list('courseChanges').map((c) => ({ kind: c.kind, startTime: c.startTime })));
  const occToast = (await text(page, '.toast-wrap')).includes('已挪到 14:00');
  r.ok('拖到已经有课的格子上照样高亮、记下调整并提示（不再静默失败）',
    hasBlocker && ghostOcc === 1 && !!occRect && occRect.inView && dropCount === 1 && chOcc.length === 1 && chOcc[0].kind === 'edit' && chOcc[0].startTime === '14:00' && occToast,
    { hasBlocker, ghostOcc, occRect, dropCount, chOcc, occToast });

  await clickText(page, '.tt-change-chip button', '撤销');
  await sleep(700);
  const occUndo = await state(page, () => {
    const s = window.__schedule;
    const c = s.list('courses').find((x) => x.name === '高等数学A');
    return { n: s.list('courseChanges').length, start: c ? c.startTime : '' };
  });
  r.ok('撤销后高等数学A回到 08:00，占位课没被牵连',
    occUndo.n === 0 && occUndo.start === '08:00' && (await courseNames(page)).includes('占位课'), occUndo);

  // 占位课用完就删掉，后面的段落还按「4 门课」数
  await openCourse(page, '占位课');
  await clickText(page, '.modal button', '删除这门课');
  await waitText(page, '删除「占位课」？', 4000);
  await clickText(page, '.modal-foot button', '删除');
  await sleep(900);
  const totalAfterBlocker = await state(page, () => window.__schedule.list('courses').length);
  r.ok('占位课删掉后课程数回到 4', totalAfterBlocker === 4 && !(await courseNames(page)).includes('占位课'), totalAfterBlocker);
  // 等删除 toast 的「撤销」过掉，免得后面 clickText('.toast-act') 点错
  await page.waitForFunction(() => document.querySelectorAll('.toast-act').length === 0, { timeout: 12000 });
  await sleep(300);

  // ---------- 8. 课表设置：六个开关 + 锁定 ----------
  await click(page, '[data-k="tt-settings"]');
  await waitText(page, '课表设置', 4000);
  await sleep(400);
  const swN = await count(page, '[data-k^="sw-"]');
  r.ok('课表设置里有 6 个开关', swN === 6, swN);

  await click(page, '[data-k="sw-classNotif"]');
  await sleep(650);
  const notifOff = await page.$eval('[data-k="sw-classNotif"]', (el) => el.getAttribute('aria-checked'));
  const lead30Off = await page.$eval('[data-k="sw-classLead30"]', (el) => el.disabled);


  await click(page, '[data-k="sw-classNotif"]');
  await sleep(650);
  const lead30On = await page.$eval('[data-k="sw-classLead30"]', (el) => el.disabled);
  r.ok('「上课提醒」关掉后子项变灰、重开后又可点', notifOff === 'false' && lead30Off === true && lead30On === false, { notifOff, lead30Off, lead30On });

  await click(page, '[data-k="sw-ttLocked"]');
  await sleep(700);
  const lockToast = (await text(page, '.toast-wrap')).includes('课表已锁定，改动入口都禁用了');
  await clickText(page, 'button', '完成');
  await page.waitForSelector('.tt', { timeout: 5000 });
  await sleep(400);
  const hint = await count(page, '.tt-lock-hint');
  const pill = await count(page, '[data-k="lock-pill"]');
  r.ok('锁定后课表出现锁定提示与已锁定标记', lockToast && hint === 1 && pill === 1, { lockToast, hint, pill });

  await click(page, cellSel(info.today, '16:00'));
  await sleep(400);
  const blockedToast = (await text(page, '.toast-wrap')).includes('课表已锁定，先到课表设置里解锁');
  const blockedModal = await count(page, '.modal');
  r.ok('锁定时点空白格加课被拦并明确提示', blockedToast && blockedModal === 0, { blockedToast, blockedModal });

  const mathPt2 = await rectOf(page, '.tt-course', '高等数学A');
  await longPressAt(page, mathPt2, 750);
  const ghostLocked = await count(page, '.tt-ghost');
  await page.mouse.up();
  await sleep(500);
  const changesLocked = await state(page, () => window.__schedule.list('courseChanges').length);
  r.ok('锁定时长按不能拖动（无幽灵块、无新调整）', ghostLocked === 0 && changesLocked === 0, { ghostLocked, changesLocked });

  if (!(await page.$('.modal'))) await openCourse(page, '高等数学A');
  else await sleep(300);
  const lockSheet = await modalText(page);
  const actStates = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.modal button'));
    const want = ['改时间', '调到别的日期', '这次停课', '编辑这门课', '删除这门课'];
    return want.map((label) => {
      const b = btns.find((x) => (x.innerText || '').includes(label));
      return { label, found: !!b, disabled: b ? !!b.disabled : null };
    });
  });
  r.ok('锁定面板有提示条且改/调/停/编辑/删除全部禁用',
    lockSheet.includes('课表已锁定：改时间、调课、停课、删除都暂时不可用') && actStates.every((x) => x.found && x.disabled),
    actStates);

  await clickText(page, '.tt-locked-banner button', '解锁');
  await waitText(page, '课表已解锁，可以改了', 3000);
  await clickText(page, '.modal-foot button', '关闭');
  await sleep(600);
  const hint2 = await count(page, '.tt-lock-hint');
  const pill2 = await count(page, '[data-k="lock-pill"]');
  r.ok('从锁定面板解锁后提示消失、改动恢复', hint2 === 0 && pill2 === 0, { hint2, pill2 });

  // ---------- 9. 停课（标记）/ 撤销 / 删除 ----------
  await openCourse(page, '高等数学A');
  await clickText(page, '.modal button', '这次停课');
  await sleep(800);
  const cancelled = await count(page, '.tt-course.cancelled');
  const cancelStrip = await text(page, '.tt-changes');


  await clickText(page, '.tt-change-chip button', '撤销');
  await sleep(700);
  const cancelled2 = await count(page, '.tt-course.cancelled');
  const changes2 = await state(page, () => window.__schedule.list('courseChanges').length);
  r.ok('这次停课会标记且可撤销、撤销后恢复常规课表',
    cancelled === 1 && cancelStrip.includes('停课') && cancelStrip.includes('撤销') && cancelled2 === 0 && changes2 === 0,
    { cancelled, cancelStrip: cancelStrip.slice(0, 100), cancelled2, changes2 });

  await openCourse(page, '大学英语');
  await clickText(page, '.modal button', '删除这门课');
  const confirmText = await waitText(page, '删除「大学英语」？', 4000);
  await clickText(page, '.modal-foot button', '删除');
  await sleep(900);
  const names9 = await courseNames(page);
  const total9 = await state(page, () => window.__schedule.list('courses').length);
  r.ok('删除整门课后卡片消失、课程数减一', confirmText && !names9.includes('大学英语') && total9 === 3, { confirmText, names9, total9 });

  // 删整门课也要能撤销：点撤销后课和字段原样回来（1.5.2）
  await clickText(page, '.toast-act', '撤销');
  const courseUndoToast = await waitText(page, '已恢复', 4000);
  const names9b = await courseNames(page);
  const total9b = await state(page, () => window.__schedule.list('courses').length);
  r.ok('删除整门课的 toast 能撤销，撤销后课原样回来',
    !!courseUndoToast && names9b.includes('大学英语') && total9b === 4,
    { courseUndoToast, names9b, total9b });

  // 再删一次，后面的段落按「这门课已经没了」继续
  await openCourse(page, '大学英语');
  await clickText(page, '.modal button', '删除这门课');
  await waitText(page, '删除「大学英语」？', 4000);
  await clickText(page, '.modal-foot button', '删除');
  await sleep(900);
  const total9c = await state(page, () => window.__schedule.list('courses').length);
  r.ok('再删一次依然能删掉，课程数回到 3', total9c === 3, { total9c });

  // ---------- 9b. 编辑弹窗删课也要连临时调整一起删 ----------
  // 回归：详情面板删课会清掉这门课的 courseChanges，编辑弹窗里的删除却只删课，
  // 留下孤儿的「（课程已删除）」调整条，还会同步到手机上。
  await openCourse(page, '高等数学A');
  await clickText(page, '.modal button', '这次停课');
  await sleep(800);
  const chBeforeDel = await state(page, () => window.__schedule.list('courseChanges').length);
  await openCourse(page, '高等数学A');
  await clickText(page, '.modal button', '编辑这门课');
  await sleep(700);
  await clickText(page, '.modal button', '删除这门课');
  const confirmDel = await waitText(page, '确定删除「高等数学A」吗？', 4000);
  await clickText(page, '.modal-foot button', '删除');
  await sleep(900);
  const afterDel = await state(page, () => ({ courses: window.__schedule.list('courses').length, changes: window.__schedule.list('courseChanges').length }));
  const stripAfter = await count(page, '.tt-changes');
  const orphanText = (await text(page)).includes('（课程已删除）');
  r.ok('编辑弹窗删课会连临时调整一起删，改动条不留孤儿',
    !!confirmDel && chBeforeDel === 1 && afterDel.changes === 0 && afterDel.courses === 2 && stripAfter === 0 && !orphanText,
    { confirmDel, chBeforeDel, afterDel, stripAfter, orphanText });

  await clickText(page, '.toast-act', '撤销');
  await waitText(page, '已恢复', 4000);
  await sleep(700);
  const restored9b = await state(page, () => ({ courses: window.__schedule.list('courses').length, changes: window.__schedule.list('courseChanges').length }));
  const stripRestored = await text(page, '.tt-changes');
  r.ok('撤销后课程和那条临时调整都回来',
    restored9b.courses === 3 && restored9b.changes === 1 && stripRestored.includes('停课'),
    { restored9b, stripRestored: stripRestored.slice(0, 90) });

  // 清掉这条调整，后面段落还按干净课表走
  await clickText(page, '.tt-change-chip button', '撤销');
  await sleep(700);
  const clean9b = await state(page, () => window.__schedule.list('courseChanges').length);
  r.ok('点调整条上的撤销后临时调整清空', clean9b === 0, clean9b);

  // ---------- 10. 长按拖动开关真的生效 ----------
  await click(page, '[data-k="tt-settings"]');
  await waitText(page, '课表设置', 4000);
  await click(page, '[data-k="sw-ttDrag"]');
  await sleep(500);
  await clickText(page, 'button', '完成');
  await page.waitForSelector('.tt', { timeout: 5000 });
  await sleep(400);
  const mathPt3 = await rectOf(page, '.tt-course', '高等数学A');
  await longPressAt(page, mathPt3, 750);
  const ghostOff = await count(page, '.tt-ghost');
  await page.mouse.up();
  await sleep(500);
  await closeModal(page);


  await click(page, '[data-k="tt-settings"]');
  await waitText(page, '课表设置', 4000);
  await click(page, '[data-k="sw-ttDrag"]');
  await sleep(500);
  await clickText(page, 'button', '完成');
  await page.waitForSelector('.tt', { timeout: 5000 });
  await sleep(400);
  const mathPt4 = await rectOf(page, '.tt-course', '高等数学A');
  await longPressAt(page, mathPt4, 750);
  const ghostOn = await count(page, '.tt-ghost');
  await page.mouse.up();
  await sleep(500);
  await closeModal(page);
  r.ok('长按拖动开关关掉拖不起来、打开后能拖起', ghostOff === 0 && ghostOn === 1, { ghostOff, ghostOn });

  // ---------- 11. 今日课程：课表页与总览一致 ----------
  const dayTt = await text(page, '.day-courses');
  const ttDayOk = dayTt.includes('高等数学A') && dayTt.includes('教三305') && dayTt.includes('张建国') && dayTt.includes('08:00');
  await go(page, '今日总览');
  await page.waitForSelector('.day-courses', { timeout: 8000 }).catch(() => {});
  await sleep(600);
  const dayHome = await text(page, '.day-courses');
  const homeDayOk = dayHome.includes('高等数学A') && dayHome.includes('教三305') && dayHome.includes('张建国') && dayHome.includes('08:00') && !dayHome.includes('大学英语');
  r.ok('今日课程在课表页与总览一致', ttDayOk && homeDayOk, { ttDayOk, dayTt: dayTt.slice(0, 120), homeDayOk, dayHome: dayHome.slice(0, 120) });

  // ---------- 12b. 清空课表：连临时调整一起清，并且能撤销 ----------
  await go(page, '我的课表');
  await page.waitForSelector('.tt', { timeout: 8000 });
  await sleep(600);
  await openCourse(page, '线性代数');
  await clickText(page, '.modal button', '这次停课');
  await sleep(800);
  const beforeClear = await state(page, () => ({ courses: window.__schedule.list('courses').length, changes: window.__schedule.list('courseChanges').length }));
  await clickText(page, 'button', '更多');
  await sleep(350);
  await clickText(page, '[role="menuitem"]', '清空课表');
  const clearAsk = await waitText(page, '将删除全部', 4000);
  if (!clearAsk) {
    const dbg = await page.evaluate(() => ({
      modals: Array.from(document.querySelectorAll('.modal')).map((m) => (m.querySelector('h3')?.textContent || '?') + '|' + Array.from(m.querySelectorAll('.modal-foot button')).map((b) => b.textContent).join(',')),
      menuOpen: !!document.querySelector('.tt-more-menu') && getComputedStyle(document.querySelector('.tt-more-menu')).display,
      masks: document.querySelectorAll('.modal-mask').length,
      toasts: Array.from(document.querySelectorAll('.toast')).map((x) => x.textContent),
      settings: (window.__schedule.list('settings') || []).map((s) => JSON.stringify(s.data).slice(0, 160)),
      menuItems: Array.from(document.querySelectorAll('.tt-more-item')).map((b) => b.textContent),
    }));
    console.log('DEBUG 清空课表没弹确认框 ' + JSON.stringify(dbg));
  }
  await clickText(page, '.modal-foot button', '清空');
  await sleep(1000);
  const clearedAll = await state(page, () => ({ courses: window.__schedule.list('courses').length, changes: window.__schedule.list('courseChanges').length }));
  const clearedStrip = await count(page, '.tt-changes');
  await clickText(page, '.toast-act', '撤销');
  await waitText(page, '已恢复', 4000);
  await sleep(800);
  const backAgain = await state(page, () => ({ courses: window.__schedule.list('courses').length, changes: window.__schedule.list('courseChanges').length }));
  r.ok('清空课表连临时调整一起清干净，撤销后课程和调整都回来',
    !!clearAsk && beforeClear.changes === 1 && clearedAll.courses === 0 && clearedAll.changes === 0 && clearedStrip === 0
      && backAgain.courses === beforeClear.courses && backAgain.changes === 1,
    { clearAsk, beforeClear, clearedAll, clearedStrip, backAgain });
  await clickText(page, '.tt-change-chip button', '撤销');
  await sleep(600);

  // ---------- 12. 无 console 报错 ----------
  r.ok('全程无 console / pageerror', errors.length === 0, errors.slice(0, 3));
} catch (e) {
  console.error(e && e.stack ? e.stack : e);
  r.ok('测试脚本未中途抛错', false, String((e && e.message) || e));
} finally {
  try { await r.done(browser); } catch { /* 浏览器可能已关 */ }
  stopIsolatedServer();
}
