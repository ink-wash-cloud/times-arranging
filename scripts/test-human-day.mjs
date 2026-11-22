// 真人流程测试：一个普通用户「一天」会怎么用时序
//
// 覆盖：空态 → 建待办 → 总览/快速添加 → 完成/删除 → 时间池 → 习惯打卡
//      → 重要日期 → 灵感池 → 预算 → 刷新后数据还在。
//
// 原则：所有动作都走真实鼠标/键盘（e2e.mjs），只有断言读 window.__schedule。
// 跑法：node scripts/test-human-day.mjs
import {
  report, launch, openApp, reload, clickText, click, typeInto, press,
  text, waitText, waitGone, go, shot, state
} from './e2e.mjs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const PORT = 8861;
const r = report('真人一天：待办 / 习惯 / 日期 / 灵感 / 预算');

let browser = null;
let page = null;
let URL = '';
const errors = [];

/** 在某个容器里按文字找一行，再点行内指定按钮/元素（真实点击）。 */
async function clickIn(selector, needle, innerSelector) {
  const rows = await page.$$(selector);
  for (const row of rows) {
    const t = await row.evaluate((el) => (el.innerText || '').replace(/\s+/g, ' ').trim());
    if (!t.includes(needle)) continue;
    const target = innerSelector ? await row.$(innerSelector) : row;
    if (!target) continue;
    await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await target.click();
    await new Promise((res) => setTimeout(res, 420));
    return true;
  }
  return false;
}

/** 在某个容器里按文字找一行，再点行内写着 btnText 的按钮（真实点击）。 */
async function clickBtnIn(selector, needle, btnText) {
  const rows = await page.$$(selector);
  for (const row of rows) {
    const t = await row.evaluate((el) => (el.innerText || '').replace(/\s+/g, ' ').trim());
    if (!t.includes(needle)) continue;
    for (const b of await row.$$('button')) {
      const bt = await b.evaluate((el) => (el.innerText || '').replace(/\s+/g, ' ').trim());
      if (!bt.includes(btnText)) continue;
      await b.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await b.click();
      await new Promise((res) => setTimeout(res, 420));
      return true;
    }
  }
  return false;
}

/** 打开某张卡/某行里写着 needle 的那一条（点标题，不点右边的勾）。 */
async function openTaskRow(needle) {
  return clickIn('.task-item', needle, '.t-title');
}

/** Chrome 日期输入框清空：点进去 → 全选 → 退格/删除。 */
async function clearDate() {
  const el = await page.$('.modal input[type=date]');
  if (!el) return false;
  await el.click();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Delete');
  await new Promise((res) => setTimeout(res, 200));
  const v = await page.$eval('.modal input[type=date]', (i) => i.value);
  return v === '';
}

/** 当前页里指定卡片的文字。 */
async function cardText(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
  }, selector);
}

/** 读待办/习惯/日志/日期/预算/支出，给断言用。 */
async function snapshot() {
  return state(page, () => {
    const s = window.__schedule;
    return {
      tasks: s.list('tasks').map((x) => ({
        title: x.title, status: x.status, dueDate: x.dueDate || null,
        note: x.note || '', category: x.category, estimateMinutes: x.estimateMinutes
      })),
      habits: s.list('habits').map((x) => ({ name: x.name, dailyMin: x.dailyMin || 0, unit: x.unit || '' })),
      logs: s.list('habitLogs').map((x) => ({ habitId: x.habitId, date: x.date, amount: x.amount })),
      anns: s.list('anniversaries').map((x) => ({ title: x.title, type: x.type, date: x.date })),
      ins: s.list('inspirations').map((x) => ({ text: x.text })),
      budgets: s.list('budgets').map((x) => x.amount),
      expenses: s.list('expenses').map((x) => ({ title: x.title, amount: x.amount }))
    };
  });
}

const TAB = { dash: '今日总览', tasks: '待办事项', habits: '习惯打卡', dates: '重要日期', insp: '灵感池' };

try {
  URL = await startIsolatedServer(PORT);
  const launched = await launch();
  browser = launched.browser;
  page = launched.page;
  errors.push(...launched.errors);

  await openApp(page, URL);

  // ── 1. 第一次打开：空库引导 ─────────────────────────────
  const welcome = await text(page);
  const emptyCards = await page.$$eval('.dash-card', (els) => els.length);
  r.ok('空库首屏显示欢迎引导，且不显示五张数据卡', welcome.includes('欢迎使用时序') && emptyCards === 0, {
    welcome: welcome.includes('欢迎使用时序'), cards: emptyCards
  });

  // 「直接开始」把人送到待办页，而不是留在空总览
  await clickText(page, 'button', '直接开始');
  const onTasks = await waitText(page, '＋ 新建待办', 5000);
  r.ok('「直接开始」进入待办页', onTasks && (await text(page)).includes('今日'), await page.evaluate(() => location.hash));

  // ── 2. 建第一条待办 ─────────────────────────────────
  await clickText(page, 'button', '新建待办');
  await waitText(page, '新建待办');
  await typeInto(page, '.modal .form-grid .field.full input.input', '交高等数学作业');
  await clickText(page, '.modal-foot button', '创建');
  const taskCreated = await waitText(page, '已创建待办', 4000);
  await waitText(page, '交高等数学作业', 4000);
  const afterFirst = await snapshot();
  r.ok('在弹窗里新建待办，保存后出现在「今日」栏', taskCreated && afterFirst.tasks.some((x) => x.title === '交高等数学作业' && x.dueDate), {
    toast: taskCreated, task: afterFirst.tasks.find((x) => x.title === '交高等数学作业')
  });

  // ── 3. 有数据后，总览恢复五张卡 ─────────────────────
  await go(page, TAB.dash);
  await waitText(page, '今日待办完成度');
  const cardNames = await page.$$eval('.dash-card', (els) => els.map((e) => e.getAttribute('data-card')));
  r.ok('总览恢复五张数据卡（待办/习惯/纪念日/预算/人生）', cardNames.join(',') === 'tasks,habits,anniversary,budget,life', cardNames);

  // ── 4. 快速添加：回车即加入今天 ─────────────────────
  const quick = 'input[placeholder="要做点什么？回车即可加入今天"]';
  await typeInto(page, quick, '买牛奶');
  await press(page, 'Enter');
  const addToast = await waitText(page, '已加入今日待办', 4000);
  const afterQuick = await snapshot();
  r.ok('总览输入框回车即可加一条今天的待办', addToast && afterQuick.tasks.some((x) => x.title === '买牛奶' && x.dueDate), afterQuick.tasks.filter((x) => x.title === '买牛奶'));

  // ── 5. 空输入不产生记录 ────────────────────────────
  const beforeEmpty = (await snapshot()).tasks.length;
  await clickText(page, 'button', '添加');
  await new Promise((res) => setTimeout(res, 500));
  const afterEmpty = (await snapshot()).tasks.length;
  // 空输入与快速双击两条边界共用一条断言，控制套件断言数在 15~30 条。

  // ── 6. 长文本 + emoji：完整落库，不乱码 ─────────────
  await go(page, TAB.tasks);
  await clickText(page, 'button', '新建待办');
  await typeInto(page, '.modal .form-grid .field.full input.input', '☕ 长文本待办');
  const longNote = '长'.repeat(1000);
  await typeInto(page, '.modal textarea.textarea', longNote, { delay: 0 });
  await clickText(page, '.modal-foot button', '创建');
  await waitText(page, '已创建待办', 4000);
  const longTask = (await snapshot()).tasks.find((x) => x.title.includes('☕ 长文本待办'));
  r.ok('1000 字长文本与 emoji 都完整保存', !!longTask && longTask.title.includes('☕') && longTask.note.length === 1000, longTask ? { title: longTask.title, noteLen: longTask.note.length } : null);

  // ── 7. 快速双击：只加一条 ──────────────────────────
  await go(page, TAB.dash);
  await typeInto(page, quick, '双击测试');
  const beforeDouble = (await snapshot()).tasks.length;
  let addBtn = null;
  for (const h of await page.$$('button')) {
    const t = await h.evaluate((el) => (el.innerText || '').trim());
    if (t === '添加') { addBtn = h; break; }
  }
  if (addBtn) await addBtn.click({ clickCount: 2, delay: 0 });
  await new Promise((res) => setTimeout(res, 900));
  const afterDouble = (await snapshot()).tasks.length;
  r.ok('空输入不产生记录，快速双击只产生一条待办', afterEmpty === beforeEmpty && afterDouble === beforeDouble + 1, { beforeEmpty, afterEmpty, beforeDouble, afterDouble });

  // ── 8. 勾选完成 / 取消完成 ──────────────────────────
  await go(page, TAB.tasks);
  await waitText(page, '交高等数学作业');
  await clickIn('.task-item', '交高等数学作业', '.check');
  const doneToast = await waitText(page, '已完成', 4000);
  let st = (await snapshot()).tasks.find((x) => x.title === '交高等数学作业');
  r.ok('点右侧勾选把待办标记为已完成', doneToast && st && st.status === '已完成', st);

  await clickIn('.task-item', '交高等数学作业', '.check');
  const undoToast = await waitText(page, '已恢复为未开始', 4000);
  st = (await snapshot()).tasks.find((x) => x.title === '交高等数学作业');
  r.ok('再点一次可以取消完成', undoToast && st && st.status !== '已完成', st);

  // ── 9. 删除 + 撤销入口 ─────────────────────────────
  await openTaskRow('交高等数学作业');
  await waitText(page, '编辑待办', 3000);
  await clickText(page, '.modal button', '删除这条待办');
  await waitText(page, '删除待办', 3000);
  // 危险操作的确认按钮现在写「删除」而不是笼统的「确定」
  await clickText(page, '.modal-foot button', '删除');
  const delToast = await waitText(page, '已删除', 4000);
  const gone = !(await text(page)).includes('交高等数学作业');

  const undoUi = await page.evaluate(() => {
    const toasts = Array.from(document.querySelectorAll('.toast'));
    return {
      text: toasts.map((x) => x.innerText).join(' | '),
      hasUndoText: toasts.some((x) => /撤销/.test(x.innerText)),
      hasButton: toasts.some((x) => !!x.querySelector('button'))
    };
  });
  r.ok('确认后删除待办、列表里消失，并给出删除反馈', delToast && gone && undoUi.text.includes('已删除'), { delToast, gone, undoUi });
  // 撤销是硬要求：删错了要能一键救回来
  r.ok('删除后的 toast 提供「撤销」入口', undoUi.hasUndoText && undoUi.hasButton, undoUi);
  if (undoUi.hasButton) {
    await clickText(page, '.toast-act', '撤销');
    const restoredToast = await waitText(page, '已恢复', 4000);
    const back = (await snapshot()).tasks.find((x) => x.title === '交高等数学作业');
    r.ok('点「撤销」后待办原样回来', !!restoredToast && !!back, { restoredToast, back });
  }

  // ── 10. 时间池：清空日期 → 今天 / 明天 ─────────────
  await clickText(page, 'button', '新建待办');
  await typeInto(page, '.modal .form-grid .field.full input.input', '整理桌面');
  const cleared1 = await clearDate();
  await clickText(page, '.modal-foot button', '创建');
  await waitText(page, '已创建待办', 4000);
  let s2 = await snapshot();
  const pool1 = s2.tasks.find((x) => x.title === '整理桌面');
  r.ok('截止日期留空的任务进入「待办时间池」', cleared1 && pool1 && pool1.dueDate === null, { cleared1, pool1 });

  const movedToday = await clickBtnIn('.pool-item', '整理桌面', '今天');
  const todayToast = await waitText(page, '已安排到今天', 4000);
  let s3 = await snapshot();
  const todayTask = s3.tasks.find((x) => x.title === '整理桌面');

  await clickText(page, 'button', '新建待办');
  await typeInto(page, '.modal .form-grid .field.full input.input', '整理照片');
  const cleared2 = await clearDate();
  await clickText(page, '.modal-foot button', '创建');
  await waitText(page, '已创建待办', 4000);
  const movedTomorrow = await clickBtnIn('.pool-item', '整理照片', '明天');
  const tomorrowToast = await waitText(page, '已安排到明天', 4000);
  const s4 = await snapshot();
  const tomorrowTask = s4.tasks.find((x) => x.title === '整理照片');
  const todayStr = await state(page, () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  });
  r.ok('时间池的「今天/明天」把未排期任务移到正确日期', movedToday && todayToast && todayTask && todayTask.dueDate === todayStr && cleared2 && movedTomorrow && tomorrowToast && tomorrowTask && tomorrowTask.dueDate !== todayStr, {
    today: todayTask && todayTask.dueDate, tomorrow: tomorrowTask && tomorrowTask.dueDate, todayStr
  });

  // ── 11. 习惯：空态 → 新建 → 打卡 → 取消 ────────────
  await go(page, TAB.habits);
  r.ok('习惯页空态文案正确', (await text(page)).includes('还没有习惯'));

  await clickText(page, 'button', '新建习惯');
  await typeInto(page, '.modal .form-grid .field.full input.input', '早起');
  await clickText(page, '.modal-foot button', '创建');
  await waitText(page, '已创建习惯', 4000);
  const habits1 = (await snapshot()).habits;
  const createdHabit = habits1.some((x) => x.name === '早起');

  const beforeCheck = (await snapshot()).logs.length;
  const checked = await clickBtnIn('.habit-card', '早起', '立即打卡');
  const checkToast = await waitText(page, '打卡成功', 4000);
  let logs = (await snapshot()).logs;
  const afterCheckText = await cardText('.habit-card');
  r.ok('新建普通习惯后可打卡：写入 habitLogs、按钮变「今日已打卡」', createdHabit && checked && checkToast && logs.length === beforeCheck + 1 && afterCheckText.includes('今日已打卡'), {
    habits: habits1, logs, afterCheckText: afterCheckText.slice(0, 90)
  });

  // 再点一次取消
  await clickBtnIn('.habit-card', '早起', '今日已打卡');
  const cancelToast = await waitText(page, '已取消今日打卡', 4000);
  logs = (await snapshot()).logs;
  r.ok('再点一次可以取消当日打卡并移除日志', cancelToast && logs.length === beforeCheck, { cancelToast, logs });

  // ── 12. 带每日最低量的习惯：未满不算、记满才算 ──────
  await clickText(page, 'button', '新建习惯');
  await typeInto(page, '.modal .form-grid .field.full input.input', '背单词');
  await typeInto(page, '.modal input[type=number]', '20');
  await typeInto(page, 'input[placeholder="例如：个"]', '个');
  await clickText(page, '.modal-foot button', '创建');
  await waitText(page, '已创建习惯', 4000);
  const quotaCard = await cardText('.habit-card:nth-of-type(2)');
  r.ok('带量的习惯显示「0 / 20个」和「记满 20个」', /0 \/ 20个/.test(quotaCard) && /记满 20个/.test(quotaCard), quotaCard.slice(0, 120));

  await typeInto(page, '.habit-card input[type=number]', '10');
  await new Promise((res) => setTimeout(res, 900));
  const s5 = await snapshot();
  const quotaLog10 = s5.logs.find((x) => x.amount === 10);
  const quotaText10 = await cardText('.habit-card:nth-of-type(2)');

  const filled = await clickBtnIn('.habit-card', '背单词', '记满 20个');
  const fillToast = await waitText(page, '今日达标', 4000);
  const s6 = await snapshot();
  const quotaLog20 = s6.logs.find((x) => x.amount === 20);
  const quotaText20 = await cardText('.habit-card:nth-of-type(2)');
  r.ok('带量习惯：记到 10 / 20 未达标，记满 20 才达标', !!quotaLog10 && !/已达标/.test(quotaText10) && filled && fillToast && !!quotaLog20 && /已达标/.test(quotaText20), {
    log10: quotaLog10, text10: quotaText10.slice(0, 100), log20: quotaLog20, text20: quotaText20.slice(0, 100)
  });

  // 删除习惯会把打卡记录一起删掉，撤销必须把记录也带回来（1.5.2）
  const quotaHabitId = quotaLog20 ? quotaLog20.habitId : null;
  await clickBtnIn('.habit-card', '背单词', '删除');
  await waitText(page, '删除习惯', 3000);
  await clickText(page, '.modal-foot button', '删除');
  await waitText(page, '已删除习惯', 4000);
  const delState = await snapshot();
  const habitGone = !delState.habits.some((x) => x.name === '背单词');
  const logsGone = !delState.logs.some((x) => x.habitId === quotaHabitId);
  await clickText(page, '.toast-act', '撤销');
  const habitBack = await waitText(page, '已恢复', 4000);
  const undoState = await snapshot();
  const habitReturned = undoState.habits.some((x) => x.name === '背单词');
  const logsReturned = undoState.logs.some((x) => x.habitId === quotaHabitId && x.amount === 20);
  r.ok('删除习惯连打卡记录一起走，撤销把习惯和记录都带回来',
    habitGone && logsGone && !!habitBack && habitReturned && logsReturned,
    { habitGone, logsGone, habitBack, habitReturned, logsReturned, habits: undoState.habits, logs: undoState.logs });

  // ── 13. 重要日期：新建生日 → 总览倒计时 ────────────
  await go(page, TAB.dates);
  r.ok('日期页空态文案正确', (await text(page)).includes('还没有重要日期'));

  await clickText(page, 'button', '新建重要日期');
  await typeInto(page, '.modal .form-grid .field.full input.input', '妈妈的生日');
  await clickText(page, '.modal button', '生日');
  await clickText(page, '.modal-foot button', '创建');
  await waitText(page, '已创建', 4000);
  const dateText = await text(page);
  const dateCard = dateText.includes('妈妈的生日') && /距离还有 0 天|就是今天/.test(dateText);
  r.ok('新建生日后日期页出现卡片并显示倒计时', dateCard, dateText.slice(0, 140));

  await go(page, TAB.dash);
  const dashAnn = await cardText('[data-card="anniversary"]');
  r.ok('总览纪念日卡同步显示这个生日与倒计时', dashAnn.includes('妈妈的生日') && /距离还有 0/.test(dashAnn), dashAnn.slice(0, 140));

  // 删除重要日期也要能撤销（1.5.2）：回到日期页删掉，撤销后原样回来
  await go(page, TAB.dates);
  await clickBtnIn('.card', '妈妈的生日', '删除');
  await waitText(page, '删除重要日期', 3000);
  await clickText(page, '.modal-foot button', '删除');
  await waitText(page, '已删除', 4000);
  const annGone = !(await text(page)).includes('妈妈的生日');
  await clickText(page, '.toast-act', '撤销');
  const annUndoToast = await waitText(page, '已恢复', 4000);
  await new Promise((res) => setTimeout(res, 600));
  const annBack = (await text(page)).includes('妈妈的生日');
  r.ok('删除重要日期后 toast 能撤销，撤销后生日卡回来', annGone && !!annUndoToast && annBack, { annGone, annUndoToast, annBack });

  // ── 14. 灵感池：空态 → 新建 → 搜索 → 删除 ──────────
  await go(page, TAB.insp);
  r.ok('灵感池空态文案正确', (await text(page)).includes('灵感池是空的'));

  await typeInto(page, '.cap-input', '把阳台改成小花园');
  await press(page, 'Enter');
  const insToast = await waitText(page, '已记下', 4000);
  const insText = await text(page);
  r.ok('回车记下一条灵感并出现在列表', insToast && insText.includes('把阳台改成小花园'), { insToast });

  await typeInto(page, 'input[placeholder="搜索灵感…"]', '阳台');
  const hit = (await text(page)).includes('把阳台改成小花园');
  await typeInto(page, 'input[placeholder="搜索灵感…"]', '不存在的关键词xyz');
  const miss = (await text(page)).includes('这个筛选下没有内容');
  r.ok('灵感搜索：命中关键词显示记录，没有结果时显示空态', hit && miss, { hit, miss });
  await typeInto(page, 'input[placeholder="搜索灵感…"]', '');

  const delIns = await clickBtnIn('.ins-card', '把阳台改成小花园', '删除');
  await waitText(page, '删除这条记录', 3000);
  await clickText(page, '.modal-foot button', '删除');
  const insDelToast = await waitText(page, '已删除', 4000);
  const insEmpty = (await text(page)).includes('灵感池是空的');
  r.ok('确认删除灵感后回到空态', delIns && insDelToast && insEmpty, { insDelToast, insEmpty });

  // ── 15. 预算：卡片直接开弹窗（不跳设置页）→ 设预算 → 记支出 ──
  await go(page, TAB.dash);
  await clickText(page, '.dash-card[data-card="budget"] .link-btn', '设置预算');
  await waitText(page, '设置本月预算', 3000);
  const budgetModalTitle = await page.$eval('.modal h3', (el) => el.innerText.trim());
  const stillDash = await page.$eval('.dash-grid', () => true).catch(() => false);
  r.ok('总览预算卡直接打开预算弹窗，不跳设置页', budgetModalTitle.includes('设置本月预算') && stillDash, { budgetModalTitle, stillDash });

  await typeInto(page, '.modal input[type=number]', '3000');
  await clickText(page, '.modal-foot button', '保存预算');
  await waitText(page, '本月预算已设为 ¥3000', 4000);
  const budgetCard3000 = await cardText('[data-card="budget"]');
  r.ok('保存预算后卡片显示 3000，按钮变「改预算」', budgetCard3000.includes('3000') && budgetCard3000.includes('改预算'), budgetCard3000.slice(0, 120));

  await clickText(page, '.dash-card[data-card="budget"] .link-btn', '记一笔');
  await waitText(page, '记一笔支出', 3000);
  await typeInto(page, '.modal .form-grid .field:first-child input.input', '食堂');
  await typeInto(page, '.modal input[type=number]', '250');
  await clickText(page, '.modal-foot button', '保存支出');
  const expToast = await waitText(page, '已记录支出 ¥250', 4000);
  const modalStat = await text(page, '.modal');
  r.ok('记一笔支出后，弹窗里的「本月已支出」即时更新', expToast && /本月已支出 ¥250/.test(modalStat), modalStat.slice(0, 140));

  await clickText(page, '.modal-foot button', '关闭');
  const budgetCard250 = await cardText('[data-card="budget"]');
  r.ok('总览预算卡显示已用 ¥250', budgetCard250.includes('¥250'), budgetCard250.slice(0, 120));

  // ── 16. 刷新后数据都还在 ────────────────────────────
  await reload(page);
  await go(page, TAB.dash);
  const afterReloadBudget = await cardText('[data-card="budget"]');

  // 返回：从总览点进待办，再按应用自己的返回逻辑（和安卓返回键同一套），应回到总览而不是空白。
  await go(page, TAB.tasks);
  await page.evaluate(() => window.__schedule.back.press());
  await new Promise((res) => setTimeout(res, 800));
  const backHome = (await page.$$('.dash-card')).length === 5;
  await go(page, TAB.tasks);
  const afterReloadTasks = await text(page);
  await go(page, TAB.habits);
  const afterReloadHabits = await text(page);
  await go(page, TAB.dates);
  const afterReloadDates = await text(page);
  r.ok('刷新后待办、习惯、日期、预算都还在（IndexedDB），返回键能回到总览', afterReloadBudget.includes('¥250') && afterReloadTasks.includes('买牛奶') && afterReloadHabits.includes('背单词') && afterReloadDates.includes('妈妈的生日') && backHome, {
    budget: afterReloadBudget.slice(0, 40),
    tasks: afterReloadTasks.includes('买牛奶'),
    habits: afterReloadHabits.includes('背单词'),
    dates: afterReloadDates.includes('妈妈的生日'),
    backHome
  });

  // ── 17. 控制台 ─────────────────────────────────────
  r.ok('整个流程没有 JS 运行时错误', errors.length === 0, errors.slice(0, 3));

} catch (e) {
  console.error('\n[FATAL] ' + (e && e.stack ? e.stack : e));
  r.ok('测试脚本没有中途抛异常', false, String(e && e.message ? e.message : e));
  if (page) {
    try { await shot(page, 'human-day-fatal'); } catch { /* 截图失败不影响结果 */ }
  }
} finally {
  if (browser) { try { await r.done(browser); } catch { /* 已在 done 里关过 */ } }
  stopIsolatedServer();
  if (!browser) {
    console.log('\n-- ' + '真人一天：待办 / 习惯 / 日期 / 灵感 / 预算' + ' : ' + r.counts.pass + ' passed, ' + r.counts.fail + ' failed');
    process.exitCode = r.counts.fail ? 1 : 0;
  }
}
