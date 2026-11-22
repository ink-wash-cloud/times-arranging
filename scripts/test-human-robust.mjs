// 真人流程测试：猴子点击 / 双击提交 / 极端输入（task-21）
//
// 目的：像真人一样乱点、连点、灌极端内容，确认应用不白屏、不重复提交、不崩。
// 所有操作都走真实鼠标坐标和真实键盘事件（scripts/e2e.mjs 的工具），不用 evaluate 直接改数据；
// 只有断言时才用 window.__schedule 读库里的真实条数。
//
// 跑法：node scripts/test-human-robust.mjs
// 环境：自带隔离服务器（端口 8867 + 临时 DATA_DIR），跑完自动关掉。

import { report, launch, openApp, clickText, typeInto, text, state, sleep } from './e2e.mjs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const PORT = 8867;
const SEED = 20261110;      // 固定种子：同样的乱点顺序每次都能复现
const VIEW_W = 1400;
const VIEW_H = 1000;

// 侧栏顺序（src/App.tsx 里固定不变）
const PAGES = [
  { idx: 0, name: '今日总览' },
  { idx: 1, name: '待办事项' },
  { idx: 2, name: '习惯打卡' },
  { idx: 3, name: '灵感池' },
  { idx: 4, name: '重要日期' },
  { idx: 5, name: '我的课表' },
  { idx: 6, name: '设置与同步' },
];

const r = report('真人流程：猴子点击 / 双击提交 / 极端输入');

let browser = null;
let page = null;
let errors = [];               // e2e.watchErrors 的实时数组（console error/warning + pageerror）
const pageErrors = [];         // 单独的 pageerror 记录，便于区分

// mulberry32：小巧、稳定、固定种子可复现
function makeRand(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = makeRand(SEED);

/* ------------------------------ 真人操作小工具 ------------------------------ */

// 点侧栏第 idx 项（真实鼠标坐标；弹窗打开时遮罩会先接住 mousedown）
async function navTo(idx, wait = 550) {
  const pt = await page.evaluate((i) => {
    const el = document.querySelectorAll('.nav-item')[i];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  }, idx);
  if (!pt) throw new Error('侧栏里没有第 ' + idx + ' 个导航项');
  await page.mouse.click(pt.x, pt.y);
  await sleep(wait);
}

// 连按 Escape，收掉可能开着的弹窗
async function escAll(n = 2) {
  for (let i = 0; i < n; i++) { await page.keyboard.press('Escape'); await sleep(80); }
}

// 页面状态快照。页面在重载/崩溃时 evaluate 会抛错，重试等它回来。
async function snap(retries = 25) {
  let last = null;
  for (let i = 0; i < retries; i++) {
    try {
      const st = await page.evaluate(() => {
        const navs = Array.from(document.querySelectorAll('.nav-item'));
        return {
          textLen: (document.body.innerText || '').length,
          app: !!document.querySelector('.app'),
          modals: document.querySelectorAll('.modal').length,
          active: navs.findIndex((n) => n.classList.contains('active')),
          nodes: document.querySelectorAll('*').length,
          url: location.href
        };
      });
      last = st;
      if (st && st.app) return st;
    } catch { /* 正在导航/重载，等下一轮 */ }
    await sleep(180);
  }
  return last;
}

// 按标题精确数任务条数（库里真实数据）
async function countTitle(title) {
  return state(page, (tt) => (window.__schedule.list('tasks') || []).filter((x) => x && x.title === tt).length, title);
}

async function countRecords(table) {
  return state(page, (tbl) => (window.__schedule.list(tbl) || []).length, table);
}

// 取某个元素中心点（先滚到中间）
async function pointOf(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), label: (el.innerText || '').trim().slice(0, 40) };
  }, selector);
}

// 总览「快速添加」那一行的按钮中心点
async function quickAddPoint() {
  return page.evaluate(() => {
    const input = document.querySelector('input[placeholder*="要做点什么"]');
    if (!input) return null;
    const btn = input.parentElement ? input.parentElement.querySelector('button') : null;
    if (!btn) return null;
    btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const b = btn.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), label: (btn.innerText || '').trim() };
  });
}

// 100ms 内点两下（两次真实 click，间隔 40ms）
async function doubleClickAt(pt) {
  await page.mouse.click(pt.x, pt.y);
  await sleep(40);
  await page.mouse.click(pt.x, pt.y);
}

// 打开待办页的新建弹窗
async function openTaskEditor() {
  await escAll(1);
  await navTo(1, 450);
  await clickText(page, 'button', '新建待办');
  await page.waitForSelector('.modal', { timeout: 8000 });
}

// 用弹窗新建一条待办（真人流程：点新建 → 填标题 → 点创建）
async function createTaskViaEditor(title) {
  await openTaskEditor();
  await typeInto(page, '.modal .form-grid .field.full input.input', title, { delay: 0, wait: 120 });
  await clickText(page, '.modal-foot button', '创建');
  try {
    await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 5000 });
  } catch { /* 弹窗没关的话，后面的断言会暴露 */ }
  await sleep(350);
}

async function searchTasks(q) {
  await typeInto(page, 'input[placeholder*="搜索待办"]', q, { delay: 0, wait: 500 });
}

// 量横向溢出：要求 documentElement 与 body 的 scrollWidth 都 <= 窗口宽 + 2
function okWidth(m) {
  return !!m && m.doc <= m.win + 2 && m.body <= m.win + 2;
}

async function layoutProbe(query) {
  try {
    await page.waitForFunction((q) => (document.body.innerText || '').includes(q), { timeout: 6000, polling: 120 }, query);
  } catch { /* 没渲染出来由 hit 断言报 */ }
  return state(page, (q) => {
    const titles = Array.from(document.querySelectorAll('.t-title')).map((el) => el.innerText);
    return {
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      win: window.innerWidth,
      app: !!document.querySelector('.app'),
      titles: titles.slice(0, 4),
      hit: titles.some((x) => x.includes(q))
    };
  }, query);
}

/* ------------------------------ 猴子点击工具 ------------------------------ */

// 随机点一个可点元素（.btn / .chip / .card button / 侧栏项）
async function clickRandomCandidate(u) {
  const info = await page.evaluate((u2) => {
    const all = Array.from(document.querySelectorAll('.btn, .chip, .card button, .nav-item'));
    const cands = all.filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.disabled) return false;
      if (el.closest('[disabled]')) return false;
      const act = el.getAttribute('data-act');
      // 这两个会开桌面挂件窗口 / 系统文件选择框，不是"点页面"，排除
      if (act === 'widget' || act === 'bg') return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const b = el.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) return false;
      return true;
    });
    if (!cands.length) return null;
    const el = cands[Math.floor(u2 * cands.length) % cands.length];
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const b = el.getBoundingClientRect();
    return {
      x: Math.round(b.left + b.width / 2),
      y: Math.round(b.top + b.height / 2),
      label: String(el.innerText || el.value || el.getAttribute('aria-label') || el.className || '').replace(/\s+/g, ' ').trim().slice(0, 40)
    };
  }, u);
  if (!info) return null;
  await page.mouse.click(info.x, info.y);
  return info;
}

// 点页面空白处（.main 内随机找 elementFromPoint 不是交互元素的位置）
async function clickBlank(u1, u2) {
  const pt = await page.evaluate((a, b) => {
    const main = document.querySelector('.main');
    if (!main) return { x: 20, y: 20, fallback: true, tag: 'none' };
    const rect = main.getBoundingClientRect();
    const x0 = Math.max(rect.left + 8, 8);
    const x1 = Math.min(rect.right - 8, window.innerWidth - 8);
    const y0 = Math.max(rect.top + 8, 8);
    const y1 = Math.min(rect.bottom - 8, window.innerHeight - 8);
    const bad = 'button,a,input,select,textarea,label,.chip,.nav-item,.card,.modal,.modal-mask,.t-title,.pool-title';
    for (let i = 0; i < 14; i++) {
      const x = Math.round(x0 + ((a + i * 0.137) % 1) * Math.max(1, x1 - x0));
      const y = Math.round(y0 + ((b + i * 0.173) % 1) * Math.max(1, y1 - y0));
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      if (el.closest(bad)) continue;
      return { x, y, fallback: false, tag: el.tagName };
    }
    // 找不到就点左下角的内边距，算一次「点空白」
    return { x: Math.round(x0 + 2), y: Math.round(y1 - 2), fallback: true, tag: 'main' };
  }, u1, u2);
  await page.mouse.click(pt.x, pt.y);
  return pt;
}

/* ---------------------------------- 主流程 ---------------------------------- */

try {
  const url = await startIsolatedServer(PORT);
  const launched = await launch({ width: VIEW_W, height: VIEW_H });
  browser = launched.browser;
  page = launched.page;
  errors = launched.errors;          // 必须是引用，不能拷贝
  page.on('pageerror', (e) => pageErrors.push(e && e.message ? e.message : String(e)));
  // 万一触发原生 alert，先关掉，避免卡死
  page.on('dialog', (d) => { try { d.dismiss(); } catch { /* 已处理 */ } });
  await openApp(page, url);

  r.note('隔离服务器 ' + url + '，窗口 ' + VIEW_W + 'x' + VIEW_H + '，种子 ' + SEED);

  // ── 0. 准备一批数据：点真人按钮「载入示例数据」 ───────────────────────────
  const firstBody = await text(page);
  const wasEmpty = firstBody.includes('载入示例数据');
  if (wasEmpty) {
    await clickText(page, 'button', '载入示例数据');
    await sleep(1500);
  }
  const quickReady = await page.evaluate(() => !!document.querySelector('input[placeholder*="要做点什么"]'));
  r.ok('点「载入示例数据」后总览出现快速添加输入框', quickReady, { wasEmpty });

  // ── 1. 双击提交：100ms 内连按两次 Enter ──────────────────────────────────
  const enterTitle = '回车双敲-' + Date.now();
  await navTo(0, 450);
  await typeInto(page, 'input[placeholder*="要做点什么"]', enterTitle, { wait: 120 });
  await page.keyboard.press('Enter');
  await sleep(40);
  await page.keyboard.press('Enter');
  await sleep(700);
  const enterCount = await countTitle(enterTitle);
  r.ok('快速添加：100ms 内连按两次 Enter 只新增 1 条', enterCount === 1, { count: enterCount, title: enterTitle });

  // ── 2. 双击提交：双击「添加」按钮 ────────────────────────────────────────
  const dblTitle = '双击添加-' + Date.now();
  await typeInto(page, 'input[placeholder*="要做点什么"]', dblTitle, { wait: 120 });
  const qa = await quickAddPoint();
  if (qa) await doubleClickAt(qa);
  await sleep(700);
  const dblCount = await countTitle(dblTitle);
  r.ok('快速添加：双击「添加」按钮只新增 1 条', !!qa && dblCount === 1, { count: dblCount, point: qa });

  // ── 3. 双击提交：弹窗里连点两次「创建」 ──────────────────────────────────
  const createTitle = '连点创建-' + Date.now();
  await openTaskEditor();
  await typeInto(page, '.modal .form-grid .field.full input.input', createTitle, { delay: 0, wait: 120 });
  const createBtn = await pointOf('.modal-foot .btn-primary');
  if (createBtn) await doubleClickAt(createBtn);
  await sleep(700);
  const createCount = await countTitle(createTitle);
  r.ok('新建待办：连点两次「创建」只新增 1 条', !!createBtn && createCount === 1, { count: createCount });
  await escAll(2);

  // ── 4. 极端输入：500 字长标题 ────────────────────────────────────────────
  const title500 = '超长标题'.repeat(125);   // 4 * 125 = 500 字
  await createTaskViaEditor(title500);
  const c500 = await countTitle(title500);
  await searchTasks('超长标题');
  const m500 = await layoutProbe('超长标题');
  r.ok('500 字长标题：能保存、能显示、不横向溢出', c500 === 1 && !!m500 && m500.hit && okWidth(m500),
    { count: c500, hit: m500 && m500.hit, doc: m500 && m500.doc, body: m500 && m500.body, win: m500 && m500.win });

  // ── 5. 极端输入：纯 emoji ────────────────────────────────────────────────
  const emojiTitle = '🚀🎉🌙🫧'.repeat(8);
  await createTaskViaEditor(emojiTitle);
  const cEmoji = await countTitle(emojiTitle);
  await searchTasks('🚀🎉');
  const mEmoji = await layoutProbe('🚀🎉');
  r.ok('纯 emoji 标题：能保存、emoji 原样显示、不横向溢出', cEmoji === 1 && !!mEmoji && mEmoji.hit && okWidth(mEmoji),
    { count: cEmoji, hit: mEmoji && mEmoji.hit, doc: mEmoji && mEmoji.doc, body: mEmoji && mEmoji.body, win: mEmoji && mEmoji.win });

  // ── 6. 极端输入：纯空白（应被拦下，不产生记录） ──────────────────────────
  const wsBefore = await countRecords('tasks');
  await openTaskEditor();
  await typeInto(page, '.modal .form-grid .field.full input.input', '   ', { delay: 0, wait: 120 });
  await clickText(page, '.modal-foot button', '创建');
  await sleep(600);
  const wsAfter = await countRecords('tasks');
  const wsState = await snap();
  r.ok('纯空白标题：保存被拦住，没有新增记录，弹窗还在', wsAfter === wsBefore && !!wsState && wsState.modals >= 1,
    { before: wsBefore, after: wsAfter, modals: wsState && wsState.modals });
  await escAll(2);

  // ── 7. 极端输入：HTML 标签必须按原文显示 ─────────────────────────────────
  const htmlTitle = '<b>test</b>';
  await createTaskViaEditor(htmlTitle);
  await searchTasks(htmlTitle);
  const htmlProbe = await state(page, () => {
    const titles = Array.from(document.querySelectorAll('.t-title')).map((el) => el.innerText);
    return {
      titles: titles.slice(0, 3),
      bTags: document.querySelectorAll('.t-title b').length,
      bodyHas: (document.body.innerText || '').includes('<b>test</b>')
    };
  });
  const mHtml = await layoutProbe('<b>test</b>');
  r.ok('HTML 标签按原文显示，没有被当成标签渲染', htmlProbe.bodyHas && htmlProbe.bTags === 0 && htmlProbe.titles.includes('<b>test</b>') && okWidth(mHtml),
    { titles: htmlProbe.titles, bTags: htmlProbe.bTags, bodyHas: htmlProbe.bodyHas, doc: mHtml && mHtml.doc, body: mHtml && mHtml.body, win: mHtml && mHtml.win });

  // ── 8. 极端输入：300 字无空格英文 ────────────────────────────────────────
  const wallTitle = 'W'.repeat(300);
  await createTaskViaEditor(wallTitle);
  const cWall = await countTitle(wallTitle);
  await searchTasks('WWWWWW');
  const mWall = await layoutProbe('WWWWWW');
  r.ok('300 字无空格英文：能保存、不横向溢出', cWall === 1 && !!mWall && mWall.hit && okWidth(mWall),
    { count: cWall, hit: mWall && mWall.hit, doc: mWall && mWall.doc, body: mWall && mWall.body, win: mWall && mWall.win });

  // ── 9. 空提交：什么都不填直接点「添加」 ───────────────────────────────────
  await navTo(0, 500);
  const emptyBefore = await countRecords('tasks');
  await typeInto(page, 'input[placeholder*="要做点什么"]', '', { clear: true, wait: 100 });
  const addPt = await quickAddPoint();
  if (addPt) await page.mouse.click(addPt.x, addPt.y);
  await sleep(600);
  const emptyAfter = await countRecords('tasks');
  const emptyState = await snap();
  r.ok('空提交：不填内容点「添加」不新增记录、页面正常', !!addPt && emptyAfter === emptyBefore && !!emptyState && emptyState.app,
    { before: emptyBefore, after: emptyAfter, app: emptyState && emptyState.app });

  // ── 10. 弹窗打开时点侧栏切页 ─────────────────────────────────────────────
  await openTaskEditor();
  const modalBefore = (await snap()).modals;
  await navTo(5, 800);   // 我的课表
  const afterNav = await snap();
  r.ok('弹窗打开时点侧栏：最多只留下 1 个弹窗，页面没坏', modalBefore === 1 && !!afterNav && afterNav.app && afterNav.modals <= 1,
    { before: modalBefore, after: afterNav && afterNav.modals, app: afterNav && afterNav.app });
  await escAll(2);

  // ── 11. 连续来回切页 30 次 ───────────────────────────────────────────────
  const pe30 = pageErrors.length;
  for (let i = 0; i < 30; i++) await navTo(i % 7, 170);   // 最后停在待办(1)
  const st30 = await snap();
  r.ok('连续来回切页 30 次后 DOM 节点数 < 4000（没有越切越臃肿）', !!st30 && st30.app && st30.nodes < 4000,
    { nodes: st30 && st30.nodes, app: st30 && st30.app });
  r.ok('连续切页 30 次全程没有 pageerror', pageErrors.length === pe30, pageErrors.slice(pe30));

  // ── 12. 猴子点击：七个主页面各随机点 40 次 ───────────────────────────────
  for (const pg of PAGES) {
    await escAll(2);
    await navTo(pg.idx, 650);
    const peBefore = pageErrors.length;
    const bad = [];
    let done = 0;
    for (let k = 0; k < 40; k++) {
      let action = null;
      try {
        if (rand() < 0.75) action = await clickRandomCandidate(rand());
        else action = await clickBlank(rand(), rand());
        if (!action) action = await clickBlank(rand(), rand());
      } catch (e) {
        bad.push({ at: k + 1, why: '点击本身抛错', error: String(e && e.message ? e.message : e).slice(0, 200) });
        break;
      }
      done++;
      await sleep(120);
      const st = await snap();
      if (!st) { bad.push({ at: k + 1, why: '连续 20+ 次读不到页面（白屏或崩溃）', action }); break; }
      if (!st.app || st.textLen <= 0) { bad.push({ at: k + 1, why: '白屏（.app 没了或页面没字）', action, st }); break; }
      if (pageErrors.length > peBefore) { bad.push({ at: k + 1, why: 'pageerror', error: pageErrors[pageErrors.length - 1], action }); break; }
      // 乱点可能点到侧栏换页：收掉浮层，回到本页继续
      if (st.active !== pg.idx) {
        await escAll(1);
        try { await navTo(pg.idx, 450); } catch { /* 下一轮再试 */ }
      }
    }
    r.ok(pg.name + '：40 次随机点击后不白屏、.app 还在、无 pageerror', bad.length === 0 && done === 40,
      { done, bad: bad[0] || null });
  }

  // ── 13. 全程零报错 ───────────────────────────────────────────────────────
  r.ok('全流程 console 报错为 0', errors.length === 0, errors.slice(0, 8));
  r.ok('全流程 pageerror 为 0', pageErrors.length === 0, pageErrors.slice(0, 8));

  if (errors.length) {
    r.note('console 报错前几条：');
    for (const e of errors.slice(0, 5)) console.log('      ' + String(e).slice(0, 300));
  }
} catch (e) {
  r.ok('测试脚本从头跑到尾（中途没抛异常）', false, String(e && e.stack ? e.stack : e).slice(0, 600));
} finally {
  try { if (browser) await browser.close(); } catch { /* 已关 */ }
  try { stopIsolatedServer(); } catch { /* 已停 */ }
  const c = r.counts;
  console.log('\n  极端操作验证通过 ' + c.pass + ' 项，失败 ' + c.fail + ' 项');
  process.exit(c.fail ? 1 : 0);
}
