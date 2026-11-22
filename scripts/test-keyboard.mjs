// 真人流程测试：键盘与焦点（task-20）
//
// 只测用户真的能用键盘走完的路径：
//   1. 侧栏导航可以用 Tab 依次聚焦，焦点可见，Enter 能进入当前项
//   2. 待办输入 + Enter 提交，Escape 关闭弹窗
//   3. 弹窗内 Tab 不把焦点带到弹窗外，关闭后焦点回到触发按钮
//   4. 安卓返回键语义：设置二级页 -> 设置根页 -> 上一个主页面；首页防误触
//   5. disabled / 只读控件不参与 Tab 聚焦
//   6. 全程 console 报错 / pageerror 为 0
//
// 跑法：node scripts/test-keyboard.mjs
// 端口固定 8866（不要抢 8790，那是常驻的 InkMusic）。
import {
  launch, openApp, reload, sleep, text, waitText, clickText, click,
  typeInto, press, go, state
} from './e2e.mjs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const PORT = 8866;
const r = reportLike();
let browser = null;
let page = null;
let URL = '';
let errors = [];

function reportLike() {
  let pass = 0, fail = 0;
  const failed = [];
  return {
    get pass() { return pass; },
    get fail() { return fail; },
    get failed() { return failed; },
    item(name, ok, evidence) {
      if (ok) { pass++; console.log('  PASS  ' + name); }
      else {
        fail++;
        failed.push({ name, evidence });
        console.log('  FAIL  ' + name);
        if (evidence) console.log('        证据: ' + (typeof evidence === 'string' ? evidence : JSON.stringify(evidence)));
      }
    }
  };
}

/** 当前激活的侧栏项文字（用文字判断页面，避免依赖内部 view 变量）。 */
async function activeView() {
  return state(page, () => {
    const el = document.querySelector('.nav-item.active');
    return el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '';
  });
}

async function hasModal() {
  return state(page, () => !!document.querySelector('.modal-mask'));
}

async function closeOverlays() {
  for (let i = 0; i < 3; i++) {
    if (!(await hasModal())) return;
    await page.keyboard.press('Escape');
    await sleep(180);
  }
}

/** 按文字点按钮（只点可见、精确包含的按钮）。 */
async function clickButtonContains(needle) {
  const h = await page.evaluateHandle((n) => {
    const list = Array.from(document.querySelectorAll('button'));
    return list.find((b) => (b.innerText || '').replace(/\s+/g, ' ').trim().includes(n)
      && b.offsetParent !== null) || null;
  }, needle);
  const el = h.asElement();
  if (!el) throw new Error('找不到可见按钮：' + needle);
  await el.evaluate((b) => b.scrollIntoView({ block: 'center' }));
  await sleep(80);
  await el.click();
  await sleep(350);
}

/** 当前焦点元素的完整描述，给证据用。 */
async function focusInfo() {
  return state(page, () => {
    const el = document.activeElement;
    if (!el) return { tag: '(null)' };
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      cls: String(el.className || '').slice(0, 90),
      text: (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 70),
      nav: !!el.closest('.nav-item'),
      modal: !!el.closest('.modal'),
      disabled: !!el.disabled,
      readOnly: !!el.readOnly,
      focusVisible: el.matches(':focus-visible'),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      boxShadow: cs.boxShadow
    };
  });
}

async function backPress() {
  const ok = await state(page, () => window.__schedule.back.press());
  await sleep(260);
  return ok;
}

/** ---------------------------------- 1 ---------------------------------- */
async function testNavKeyboard() {
  console.log('\n[1] 纯键盘主流程：Tab 聚焦侧栏导航、焦点可见、Enter 进入');
  // v1.6.0 侧栏多了「日程表」「消费记录」两项，共 9 项（设置与同步仍在最后）。
  const expected = ['今日总览', '待办事项', '习惯打卡', '灵感池', '重要日期', '我的课表', '日程表', '消费记录', '设置与同步'];
  const seen = [];
  for (let i = 0; i < expected.length; i++) {
    await page.keyboard.press('Tab');
    await sleep(90);
    seen.push(await focusInfo());
  }

  const allNav = seen.every((s) => s.nav);
  const labelsOk = expected.every((label, i) => (seen[i] && (seen[i].text || '').includes(label)));
  const styleOk = seen.every((s) => s.focusVisible
    && ((s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none')));
  r.item('Tab 依次进入 9 个侧栏导航项', allNav && labelsOk, {
    got: seen.map((s) => s.text)
  });
  r.item('键盘焦点有可见样式（:focus-visible + outline/box-shadow）', styleOk, {
    focus: seen.map((s) => ({ text: s.text, focusVisible: s.focusVisible, outline: s.outlineStyle + ' ' + s.outlineWidth, shadow: s.boxShadow }))
  });

  const before = await activeView();
  await page.keyboard.press('Enter');
  await sleep(650);
  const after = await activeView();
  r.item('Enter 触发当前聚焦的导航项', before !== after && after.includes('设置'), { before, after });
}

/** ---------------------------------- 2 ---------------------------------- */
async function testTaskEnter() {
  console.log('\n[2] 待办：Tab 进输入框、输入、Enter 提交，Escape 关闭弹窗');
  await closeOverlays();
  await go(page, '待办');
  await sleep(500);
  const title = '键盘 Enter 测试 ' + Date.now();

  await clickText(page, 'button', '新建待办');
  await waitText(page, '新建待办');
  await sleep(250);

  const initialFocus = await focusInfo();
  r.item('新建待办弹窗打开后焦点在标题输入框', initialFocus.modal && initialFocus.tag === 'INPUT', initialFocus);

  await typeInto(page, '.modal .form-grid .field.full input.input', title);
  await page.keyboard.press('Enter');
  await sleep(650);

  const exists = await state(page, (t) => window.__schedule.list('tasks').some((x) => x.title === t), title);
  const modalStill = await hasModal();
  r.item('在待办弹窗里按 Enter 能提交并加进列表', exists, { title, exists, modalStillOpen: modalStill });

  const draft = await state(page, () => {
    const el = document.querySelector('.modal .form-grid .field.full input.input');
    return el ? el.value : '(no input)';
  });
  // Enter 现在就是"提交"：提交成功弹窗会关掉；万一还开着，输入内容必须原样保留（不能清空却不保存）
  r.item('Enter 提交后不会把输入内容清空却又不保存', !modalStill || draft === title, { draft, modalStill });

  // Escape 必须能关掉弹窗，且页面回到可操作状态
  await page.keyboard.press('Escape');
  await sleep(400);
  const closed = !(await hasModal());
  const pageText = await text(page, '.content-inner');
  r.item('Escape 关闭新建待办弹窗', closed, { closed, pageText: pageText.slice(0, 80) });

  // 重新打开时是一份干净表单，不残留上一条
  await clickText(page, 'button', '新建待办');
  await waitText(page, '新建待办');
  await sleep(250);
  const fresh = await state(page, () => {
    const el = document.querySelector('.modal .form-grid .field.full input.input');
    return el ? el.value : '(no input)';
  });
  r.item('重新打开时输入框是空的（无错乱）', fresh === '', { fresh });
  await page.keyboard.press('Escape');
  await sleep(300);

  // 对照：总览页的“快速添加今日待办”输入框支持 Enter；说明键盘链路本身可用，
  // 缺的是待办页这条入口。
  // 总览在空库时只显示欢迎卡片、不渲染快速添加；先种一条待办把空态跨过去。
  await state(page, async () => {
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    await window.__schedule.putRecord('tasks', 'kb-seed-task', {
      title: '种子待办（键盘测试）', category: '学习', dueDate: today, dueTime: null,
      priority: 'P2', status: '未开始', createdAt: Date.now()
    });
  });
  await go(page, '今日总览');
  await sleep(900);
  const quick = await page.$('input[placeholder*="要做点什么"]');
  if (!quick) {
    r.item('对照：总览快速添加输入框存在', false, '找不到 input[placeholder*="要做点什么"]');
  } else {
    const qtitle = '键盘快速添加 ' + Date.now();
    await quick.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await quick.click();
    await page.keyboard.type(qtitle, { delay: 8 });
    await page.keyboard.press('Enter');
    await sleep(600);
    const qexists = await state(page, (t) => window.__schedule.list('tasks').some((x) => x.title === t), qtitle);
    const qval = await state(page, () => {
      const el = document.querySelector('input[placeholder*="要做点什么"]');
      return el ? el.value : '(gone)';
    });
    r.item('对照：总览快速添加支持 Enter 提交', qexists && qval === '', { qexists, qval });
  }
}

/** ---------------------------------- 3 ---------------------------------- */
async function testModalFocus() {
  console.log('\n[3] 弹窗焦点不外逃，关闭后回到触发按钮');
  await closeOverlays();
  await go(page, '待办');
  await sleep(450);

  await clickText(page, 'button', '新建待办');
  await waitText(page, '新建待办');
  await sleep(250);

  const start = await focusInfo();
  r.item('打开弹窗后初始焦点在弹窗内', start.modal === true, start);

  const trail = [];
  let escapedAt = -1;
  let escapedInfo = null;
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    await sleep(80);
    const f = await focusInfo();
    trail.push(f);
    if (!f.modal && escapedAt < 0) { escapedAt = i + 1; escapedInfo = f; }
  }
  r.item('连续 Tab 12 次焦点始终在 .modal 内', escapedAt < 0, {
    escapedAt,
    firstEscaped: escapedInfo,
    trail: trail.map((x) => ({ tag: x.tag, cls: x.cls, modal: x.modal, text: x.text }))
  });

  // 先在焦点仍在弹窗内时关闭，单独验证“关闭后焦点回到触发按钮”。
  await page.keyboard.press('Escape');
  await sleep(450);
  const closed = !(await hasModal());
  r.item('Escape 关闭弹窗', closed, { closed });

  const focusBack = await state(page, () => {
    const el = document.activeElement;
    if (!el) return { returned: false, tag: '(null)' };
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.offsetParent !== null && (b.innerText || '').includes('新建待办'));
    return {
      returned: !!btn && el === btn,
      tag: el.tagName,
      cls: String(el.className || ''),
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      triggerFound: !!btn
    };
  });
  r.item('关闭后焦点回到「新建待办」触发按钮', focusBack.returned, focusBack);

  const leftovers = await state(page, () => ({
    masks: document.querySelectorAll('.modal-mask').length,
    modals: document.querySelectorAll('.modal').length
  }));
  r.item('关闭后没有残留的弹窗节点', leftovers.masks === 0 && leftovers.modals === 0, leftovers);

  // 再打开一次，专门测真正的焦点陷阱：12 次可能还没走完表单里的全部控件，
  // 超过控件总数后仍留在弹窗里才说明陷阱生效。
  await clickText(page, 'button', '新建待办');
  await waitText(page, '新建待办');
  await sleep(250);
  const focusableCount = await state(page, () => Array.from(
    document.querySelectorAll('.modal button, .modal input, .modal select, .modal textarea, .modal a[href]')
  ).filter((el) => el.offsetParent !== null && !el.disabled && el.tabIndex >= 0).length);
  const extraTabs = Math.max(20, focusableCount + 15);
  escapedAt = -1;
  escapedInfo = null;
  for (let i = 0; i < extraTabs; i++) {
    await page.keyboard.press('Tab');
    await sleep(70);
    const f = await focusInfo();
    if (!f.modal && escapedAt < 0) { escapedAt = i + 1; escapedInfo = f; }
  }
  r.item('焦点陷阱：Tab 超过弹窗内可聚焦控件数后仍不逃逸', escapedAt < 0, {
    focusableCount,
    totalTabs: extraTabs,
    escapedAt,
    firstEscaped: escapedInfo
  });

  await page.keyboard.press('Escape');
  await sleep(350);
}

/** ---------------------------------- 4 ---------------------------------- */
async function testBackLayers() {
  console.log('\n[4] 安卓返回键语义：设置二级页 -> 设置根页 -> 上一个主页面');
  await closeOverlays();
  await go(page, '待办');
  await sleep(500);
  await go(page, '设置');
  await sleep(600);
  await click(page, '[data-testid="set-row-lang"]');
  await sleep(500);

  const subOpen = await state(page, () => ({
    sub: !!document.querySelector('.subpage'),
    view: document.querySelector('.nav-item.active')?.innerText.replace(/\s+/g, ' ').trim() || '',
    settingsPage: window.__schedule.ui.settingsPage()
  }));
  r.item('已进入设置二级页（语言）', subOpen.sub && subOpen.settingsPage === 'lang', subOpen);

  await state(page, () => window.__schedule.back.reset());
  await backPress();
  const first = await state(page, () => ({
    sub: !!document.querySelector('.subpage'),
    view: document.querySelector('.nav-item.active')?.innerText.replace(/\s+/g, ' ').trim() || '',
    settingsPage: window.__schedule.ui.settingsPage(),
    body: (document.querySelector('.content-inner')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90)
  }));
  r.item('第一次返回：关二级页，停在设置根页（没有一次跳首页）',
    !first.sub && first.settingsPage === 'root' && first.view.includes('设置'), first);

  await backPress();
  const second = await state(page, () => ({
    view: document.querySelector('.nav-item.active')?.innerText.replace(/\s+/g, ' ').trim() || '',
    sub: !!document.querySelector('.subpage'),
    body: (document.querySelector('.content-inner')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90)
  }));
  r.item('第二次返回：回到上一个主页面（待办），不是直接回首页', second.view.includes('待办'), second);

  // 首页防误触：重新加载清空 App 内部的 navHist，再从首页连按两次
  await page.evaluate(() => {
    try { localStorage.setItem('view', 'dash'); } catch { /* 忽略 */ }
    location.hash = '#dash';
  });
  await reload(page);
  await state(page, () => window.__schedule.back.reset());
  const atDash = await activeView();
  await backPress();
  await sleep(120);
  await backPress();
  const stats = await state(page, () => window.__schedule.back.stats());
  const alive = await state(page, () => ({
    app: !!document.querySelector('.app'),
    body: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
    masks: document.querySelectorAll('.modal-mask').length
  }));
  r.item('首页第一次返回只提示，2.5 秒内第二次才执行退出',
    atDash.includes('总览') && stats.prompts === 1 && stats.exits === 1, { atDash, stats });
  r.item('退出动作之后网页不白屏（根节点和文字都还在）',
    alive.app && alive.body.length > 30 && alive.body.includes('今日总览'), { app: alive.app, textLen: alive.body.length, head: alive.body.slice(0, 90) });

  console.log('  · 任务书写的是 window.history.back()，但当前应用没有 popstate/history 集成；');
  console.log('    按 AGENTS.md，浏览器里用 __schedule.back.press() 走同一套返回链路，本项按真实语义测。');
}

/** ---------------------------------- 5 ---------------------------------- */
async function testDisabledAndReadOnly() {
  console.log('\n[5] disabled / 只读控件不参与 Tab 聚焦');
  await closeOverlays();

  // 给课表准备一门今天的课，后面用「锁定课表」把改动入口全禁掉。
  const info = await state(page, async () => {
    const s = window.__schedule;
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (x) => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
    const d = new Date();
    const wd = ((d.getDay() + 6) % 7) + 1;
    const mon = new Date(d); mon.setDate(d.getDate() - (wd - 1));
    s.cfg.termStart = fmt(mon);
    await s.putRecord('courses', 'kb-lock-course', {
      name: '键盘锁定测试课', teacher: '测试老师', location: '测试楼 101', className: '',
      weekday: wd, startTime: '08:00', endTime: '08:45', startWeek: 1, endWeek: 30,
      weekParity: 'all', color: '#4f8cff', note: '', createdAt: Date.now()
    });
    return { wd, termStart: s.cfg.termStart, courses: s.list('courses').length };
  });

  await go(page, '我的课表');
  await waitText(page, '键盘锁定测试课', 10000);
  await sleep(400);
  const hasCourse = await waitText(page, '键盘锁定测试课', 3000);
  r.item('测试课程已出现在课表里（准备锁定场景）', hasCourse, info);

  if (hasCourse) {
    await click(page, '[data-k="tt-settings"]');
    await waitText(page, '锁定课表', 5000);
    await sleep(300);
    await click(page, '[data-k="sw-ttLocked"]');
    await sleep(550);
    const lockState = await state(page, () => ({
      checked: document.querySelector('[data-k="sw-ttLocked"]')?.getAttribute('aria-checked'),
      locked: !!window.__schedule.cfg.ttLocked,
      toast: (document.querySelector('.toast-wrap')?.innerText || '').replace(/\s+/g, ' ').trim()
    }));
    r.item('通过界面锁定课表成功', lockState.checked === 'true' && lockState.locked, lockState);

    await clickButtonContains('完成');
    await sleep(450);
    const pill = await state(page, () => ({
      pill: !!document.querySelector('[data-k="lock-pill"]'),
      course: !!document.querySelector('.tt-course')
    }));
    r.item('锁定后课表仍能看（出现「已锁定」标记）', pill.pill && pill.course, pill);

    await click(page, '.tt-course');
    await waitText(page, '课表已锁定', 5000);
    await sleep(300);
    const modal = await state(page, () => ({
      open: !!document.querySelector('.modal'),
      text: (document.querySelector('.modal')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      disabled: Array.from(document.querySelectorAll('.modal button[disabled], .modal input[disabled], .modal select[disabled], .modal textarea[disabled]'))
        .map((el) => ({ tag: el.tagName, text: (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 40) })),
      readonly: Array.from(document.querySelectorAll('.modal input[readonly]'))
        .map((el) => ({ tag: el.tagName, value: el.value, placeholder: el.placeholder }))
    }));
    r.item('锁定后的课程详情里确实有 disabled 控件和只读输入框',
      modal.open && modal.disabled.length > 0 && modal.readonly.length > 0, modal);

    // 从弹窗最上方的关闭按钮开始，连续 Tab，看看会不会进 disabled / readonly。
    const focusedAtStart = await page.$eval('.modal button[aria-label="关闭"]', (el) => { el.focus(); return true; }).catch(() => false);
    const trail = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      await sleep(80);
      trail.push(await focusInfo());
    }
    const disabledFocused = trail.find((x) => x.disabled);
    const readOnlyFocused = trail.findIndex((x) => x.readOnly);
    r.item('disabled 控件不会被 Tab 聚焦', !disabledFocused, {
      startFocus: focusedAtStart,
      disabledFocused: disabledFocused || null,
      trail: trail.map((x) => ({ tag: x.tag, disabled: x.disabled, readOnly: x.readOnly, cls: x.cls, text: x.text }))
    });
    r.item('锁定的只读输入框不会被 Tab 聚焦（产品要求）', readOnlyFocused < 0, {
      readOnlyFocusedAtTab: readOnlyFocused + 1,
      focused: readOnlyFocused >= 0 ? trail[readOnlyFocused] : null,
      readonly: modal.readonly
    });

    await page.keyboard.press('Escape');
    await sleep(300);
  }
}

/** ---------------------------------- 7 ---------------------------------- */
async function testNestedModalEscape() {
  console.log('\n[7] 嵌套弹窗：编辑弹窗里开确认框，Escape 只关最上面那层');
  await closeOverlays();
  await go(page, '待办');
  await sleep(500);
  const title = '嵌套弹窗测试 ' + Date.now();
  await clickText(page, 'button', '新建待办');
  await waitText(page, '新建待办');
  await sleep(250);
  await typeInto(page, '.modal .form-grid .field.full input.input', title);
  await page.keyboard.press('Enter');          // 顺带再走一遍 Enter 提交
  await sleep(500);

  await clickText(page, '.task-item', title);
  await waitText(page, '编辑待办');
  await sleep(300);
  await clickText(page, '.modal button', '删除这条待办');
  await waitText(page, '删除待办');
  await sleep(300);

  const two = await state(page, () => ({
    masks: document.querySelectorAll('.modal-mask').length,
    titles: Array.from(document.querySelectorAll('.modal h3')).map((h) => (h.innerText || '').trim())
  }));
  r.item('删除确认框叠在编辑弹窗上面（两层）', two.masks === 2, two);

  await page.keyboard.press('Escape');
  await sleep(400);
  const afterOne = await state(page, () => ({
    masks: document.querySelectorAll('.modal-mask').length,
    text: (document.querySelector('.modal')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    stillTask: window.__schedule.list('tasks').some((x) => (x.title || '').indexOf('嵌套弹窗测试') === 0)
  }));
  r.item('第一次 Escape 只关掉确认框，编辑弹窗还在', afterOne.masks === 1 && afterOne.text.includes('编辑待办'), afterOne);
  r.item('关确认框时没有顺手把待办删掉', afterOne.stillTask, afterOne);

  await page.keyboard.press('Escape');
  await sleep(350);
  const afterTwo = await state(page, () => ({ masks: document.querySelectorAll('.modal-mask').length }));
  r.item('第二次 Escape 才关掉编辑弹窗', afterTwo.masks === 0, afterTwo);
}

/** ---------------------------------- 6 ---------------------------------- */
async function testNoConsoleErrors() {
  console.log('\n[6] 全流程 console 报错 / pageerror');
  const list = errors.slice();
  r.item('全流程 console 报错和 pageerror 为 0', list.length === 0, list.slice(0, 8));
  if (list.length) {
    console.log('  · 错误明细（最多 8 条）：');
    list.slice(0, 8).forEach((e, i) => console.log('    ' + (i + 1) + '. ' + e));
  }
}

/** --------------------------------- main --------------------------------- */
try {
  URL = await startIsolatedServer(PORT);
  const launched = await launch({ width: 1400, height: 1000 });
  browser = launched.browser;
  page = launched.page;
  errors = launched.errors;
  await openApp(page, URL);

  await testNavKeyboard();
  await testTaskEnter();
  await testModalFocus();
  await testBackLayers();
  await testDisabledAndReadOnly();
  await testNestedModalEscape();
  await testNoConsoleErrors();
} catch (err) {
  console.log('\n  FATAL  ' + (err && err.stack ? err.stack : String(err)));
  process.exitCode = 1;
} finally {
  try { if (browser) await browser.close(); } catch { /* 已关 */ }
  try { await stopIsolatedServer(); } catch { /* 已停 */ }
}

const passItems = r.pass;
const failItems = r.fail;
if (r.failed.length) {
  console.log('\n  发现的键盘/焦点问题：');
  r.failed.forEach((f, i) => {
    console.log('   ' + (i + 1) + '. ' + f.name);
    if (f.evidence) console.log('      ' + JSON.stringify(f.evidence).slice(0, 500));
  });
}
console.log('\n  键盘与焦点验证通过 ' + passItems + ' 项，失败 ' + failItems + ' 项');
process.exit(failItems ? 1 : (process.exitCode || 0));
