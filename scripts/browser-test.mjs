// 真实浏览器验证：界面渲染、四大模块交互、跨设备双向同步
//
// 默认自建一台隔离服务器 + 临时数据库：本脚本会大量新建/改动数据
// （纪念日进度会顶到 100%、还会写入合成待办），跑在真实库上会污染数据、
// 并且第二次运行就会因为「进度已经是 100%」而假失败。
// 需要打真实服务器时显式传 URL：node scripts/browser-test.mjs http://host:port
import puppeteer from 'puppeteer-core';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 注意：下面有 let URL 会遮蔽全局 URL 构造器，这里不能用 new URL()
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPLICIT = process.argv[2] || '';
let URL = EXPLICIT;
let isoServer = null;
let isoDir = null;

async function startIsolatedServer() {
  isoDir = mkdtempSync(join(tmpdir(), 'shixu-e2e-'));
  const PORT = Number(process.env.E2E_PORT || 8877);
  URL = 'http://127.0.0.1:' + PORT;
  isoServer = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, DATA_DIR: isoDir, PORT: String(PORT), HOST: '127.0.0.1' }
  });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(URL + '/api/health'); if (r.ok) return; } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('隔离服务器启动超时');
}

function stopIsolatedServer() {
  if (isoServer) { try { isoServer.kill(); } catch { /* 已退出 */ } isoServer = null; }
  if (isoDir) { try { rmSync(isoDir, { recursive: true, force: true }); } catch { /* 忽略 */ } isoDir = null; }
}
const SHOTS = 'shots';
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickText(page, text) {
  const h = await page.evaluateHandle((t) => {
    const els = Array.from(document.querySelectorAll('button, a, .chip, .nav-item, .tab, label.btn'));
    const vis = els.filter((e) => e.offsetParent !== null);
    return vis.find((e) => (e.textContent || '').trim().includes(t)) || null;
  }, text);
  const el = h.asElement();
  if (!el) throw new Error('未找到可点击元素: ' + text);
  await el.click();
  return true;
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);

async function boot(browser, label) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  await page.setViewport({ width: 1440, height: 1080, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.app', { timeout: 20000 });
  await sleep(600);
  return { ctx, page, errs, label };
}

if (!EXPLICIT) await startIsolatedServer();
console.log('测试目标: ' + URL + (EXPLICIT ? '（外部实例，会写入数据）' : '（隔离实例 + 临时库）') + '\n');

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
});

try {
  /* =================== A. 桌面端首次启动 =================== */
  console.log('\n[1] 桌面端首次加载');
  const A = await boot(browser, 'desktop');
  let txt = await bodyText(A.page);
  ok('应用已挂载 (.app 存在)', true);
  ok('首次进入显示引导页或总览', /欢迎使用时序|今日待办完成度/.test(txt));

  if (/载入示例数据/.test(txt)) { await clickText(A.page, '载入示例数据'); await sleep(900); }
  txt = await bodyText(A.page);

  console.log('\n[2] 今日总览五张卡片');
  const cards = await A.page.$$eval('.dash-card', (els) => els.map((e) => {
    const h = e.querySelector('h3');
    return h ? h.innerText.trim() : e.innerText.slice(0, 20);
  }));
  ok('总览页有 5 张主卡', cards.length === 5, cards);
  for (const key of ['待办完成度', '习惯打卡', '纪念日', '预算', '人生最新一次']) {
    ok('包含卡片：' + key, cards.some((c) => c.includes(key)), cards);
  }
  ok('总览含今日课程区', /今日课程/.test(txt));
  ok('总览含待办时间池', /待办时间池/.test(txt));
  await A.page.screenshot({ path: SHOTS + '/01-dashboard.png', fullPage: false });

  console.log('\n[3] 待办事项：四栏分栏 + 新建');
  await clickText(A.page, '待办事项');
  await sleep(500);
  const cols = await A.page.$$eval('.col .col-h', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  ok('存在 4 个分栏', cols.length === 4, cols);
  for (const k of ['今日', '未来 7 天', '已逾期', '已完成']) ok('分栏：' + k, cols.some((c) => c.includes(k)), cols);

  await clickText(A.page, '＋ 新建待办');
  await sleep(400);
  await A.page.type('.modal input.input', '浏览器自动化测试待办', { delay: 8 });
  await clickText(A.page, '创建');
  await sleep(700);
  txt = await bodyText(A.page);
  ok('新建的待办出现在列表中', /浏览器自动化测试待办/.test(txt));
  await clickText(A.page, '全部');
  await sleep(400);
  await A.page.screenshot({ path: SHOTS + '/02-tasks.png' });

  console.log('\n[4] 完成待办 → 关联纪念日进度 +10%');
  await clickText(A.page, '待办事项');
  await sleep(500);
  // 勾选第一条关联纪念日的待办
  const clicked = await A.page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.task-item'));
    const target = items.find((i) => i.innerText.includes('关联'));
    if (!target) return null;
    const btn = target.querySelector('.check');
    if (!btn) return null;
    const title = target.querySelector('.t-title').innerText;
    btn.click();
    return title;
  });
  ok('找到并勾选了关联纪念日的待办', !!clicked, clicked);
  await sleep(800);
  const after = await bodyText(A.page);
  ok('弹出 +10% 提示', /\+10%/.test(after), after.match(/进度[^\n]*/)?.[0]);
  await A.page.screenshot({ path: SHOTS + '/03-anniversary-bump.png' });

  console.log('\n[5] 习惯打卡');
  await clickText(A.page, '习惯打卡');
  await sleep(600);
  txt = await bodyText(A.page);
  ok('显示连续天数/累计次数', /连续天数/.test(txt) && /累计次数/.test(txt));
  ok('显示断签规则说明', /断签/.test(txt));
  const beforeStreak = await A.page.$$eval('.habit-num b', (els) => els.map((e) => e.innerText));
  const didCheck = await A.page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.habit-card'));
    const card = cards.find((c) => !c.className.includes('paused'));
    if (!card) return false;
    const b = Array.from(card.querySelectorAll('button')).find((x) => /打卡/.test(x.innerText || ''));
    if (!b) return false;
    b.click();
    return b.innerText.trim();
  });
  await sleep(800);
  ok('可以点击打卡/取消打卡', !!didCheck, didCheck);
  const afterStreak = await A.page.$$eval('.habit-num b', (els) => els.map((e) => e.innerText));
  ok('打卡后数值发生变化', JSON.stringify(beforeStreak) !== JSON.stringify(afterStreak), { beforeStreak, afterStreak });
  await A.page.screenshot({ path: SHOTS + '/04-habits.png' });

  console.log('\n[6] 重要日期 +10%');
  await clickText(A.page, '重要日期');
  await sleep(600);
  txt = await bodyText(A.page);
  ok('hero 卡显示倒计时文案', /距离还有|还有 \d+ 天|就是今天/.test(txt));
  const pBefore = await A.page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.trim() === '+10%');
    const card = b ? b.closest('.card') : null;
    const bar = card ? card.querySelector('.bar > i') : null;
    return bar ? bar.style.width : null;
  });
  await clickText(A.page, '+10%');
  await sleep(800);
  const pAfter = await A.page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.trim() === '+10%');
    const card = b ? b.closest('.card') : null;
    const bar = card ? card.querySelector('.bar > i') : null;
    return bar ? bar.style.width : null;
  });
  ok('点击 +10% 后进度条变长', pBefore !== pAfter, { pBefore, pAfter });
  await A.page.screenshot({ path: SHOTS + '/05-dates.png' });

  console.log('\n[7] 课表');
  await clickText(A.page, '我的课表');
  await sleep(700);
  const courseCount = await A.page.$$eval('.tt-course', (els) => els.length);
  ok('周课表渲染出课程块', courseCount > 0, courseCount);
  txt = await bodyText(A.page);
  ok('显示教学周信息', /教学周|开学第一周/.test(txt));
  await A.page.screenshot({ path: SHOTS + '/06-timetable.png' });

  console.log('\n[8] 导入课表解析（界面内自测）');
  const parseResult = await A.page.evaluate(() => {
    // 直接验证打包后的解析器可用性通过 UI：打开导入面板
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('导入课表'));
    if (btn) btn.click();
    return !!btn;
  });
  ok('可打开导入面板', parseResult);
  await sleep(500);
  await clickText(A.page, '填入示例');
  await sleep(300);
  await clickText(A.page, '解析');
  await sleep(600);
  txt = await bodyText(A.page);
  ok('解析出预览结果', /解析预览/.test(txt));
  await A.page.screenshot({ path: SHOTS + '/07-import.png' });
  await clickText(A.page, '取消');
  await sleep(300);

  console.log('\n[9] 同步状态与设置页');
  await clickText(A.page, '设置与同步');
  await sleep(600);
  // v1.4.1：设置根页是列表，点「连接地址」进「数据与同步」二级页
  await clickText(A.page, '连接地址');
  await sleep(700);
  txt = await bodyText(A.page);
  ok('设置页显示同步状态', /在线存储与双向同步/.test(txt));
  await clickText(A.page, '测试连接');
  await sleep(1200);
  txt = await bodyText(A.page);
  await A.page.screenshot({ path: SHOTS + '/08-settings.png' });

  console.log('\n[10] 等待自动同步推送');
  await sleep(3500);
  const server = await (await fetch(URL + '/api/pull?since=0&limit=5000')).json();
  const byCol = {};
  for (const r of server.records) byCol[r.collection] = (byCol[r.collection] || 0) + 1;
  console.log('  服务端已收到：', JSON.stringify(byCol));
  ok('服务端收到 tasks', (byCol.tasks || 0) > 0, byCol);
  ok('服务端收到 habits/habitLogs', (byCol.habits || 0) > 0 && (byCol.habitLogs || 0) > 0, byCol);
  ok('服务端收到 anniversaries', (byCol.anniversaries || 0) > 0, byCol);
  ok('服务端收到 courses', (byCol.courses || 0) > 0, byCol);
  ok('服务端收到 expenses/budgets', (byCol.expenses || 0) > 0 && (byCol.budgets || 0) > 0, byCol);
  ok('服务端收到 lifeEvents', (byCol.lifeEvents || 0) > 0, byCol);
  const pushed = server.records.find((r) => r.collection === 'tasks' && r.data.title === '浏览器自动化测试待办');
  ok('浏览器中新建的待办已上传到服务器', !!pushed, server.records.filter(r => r.collection === 'tasks').map(r => r.data.title));

  console.log('\n[11] 模拟手机端（全新存储）拉取同步');
  const B = await boot(browser, 'phone');
  await B.page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await B.page.reload({ waitUntil: 'networkidle2' });
  await B.page.waitForSelector('.app', { timeout: 20000 });
  await sleep(3000);
  const phoneTxt = await bodyText(B.page);
  ok('手机端不再是空库（已同步到数据）', !/欢迎使用时序/.test(phoneTxt), phoneTxt.slice(0, 80));
  const phoneTasks = await B.page.evaluate(() => (window.__schedule ? window.__schedule.list('tasks').map((t) => t.title) : null));
  ok('手机端本地库已同步到桌面端数据', Array.isArray(phoneTasks) && phoneTasks.length > 10, phoneTasks && phoneTasks.length);
  ok('手机端能看到桌面端新建的待办', !!phoneTasks && phoneTasks.includes('浏览器自动化测试待办'), phoneTasks && phoneTasks.filter((t) => t.includes('浏览器')));
  const phoneHasDemo = /待办完成度|今日待办完成度/.test(phoneTxt);
  ok('手机端渲染出总览卡片', phoneHasDemo, phoneTxt.slice(0, 120));
  // 底栏项数跟着导航走：v1.6.0 加了「日程表」变 8 个（消费记录不进底栏，走侧栏与总览入口）
  ok('移动端底部标签栏出现', await B.page.$$eval('.tabbar .tab', (e) => e.length) === 8);
  await B.page.screenshot({ path: SHOTS + '/09-mobile-dashboard.png' });

  console.log('\n[12] 反向同步：手机端改动回流到服务器');
  const phoneAction = await B.page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.innerText || '').includes('待办') && b.className.includes('tab'));
    return !!btn;
  });
  await B.page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.tab')).find((b) => b.innerText.includes('待办'));
    if (btn) btn.click();
  });
  await sleep(800);
  await B.page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.includes('新建待办'));
    if (b) b.click();
  });
  await sleep(500);
  await B.page.type('.modal input.input', '来自手机的待办', { delay: 8 });
  await B.page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '创建');
    if (b) b.click();
  });
  await sleep(1200);
  const diag = await B.page.evaluate(() => {
    const s = window.__schedule;
    return {
      hasHook: !!s,
      deviceId: s ? s.cfg.deviceId : null,
      serverUrl: s ? s.cfg.serverUrl : null,
      autoSync: s ? s.cfg.autoSync : null,
      pending: s ? s.pendingCount() : null,
      syncState: s ? s.syncStat.state : null,
      syncError: s ? s.syncStat.error : null,
      localTitles: s ? s.list('tasks').map((t) => t.title) : null,
      modalOpen: !!document.querySelector('.modal')
    };
  });
  console.log('  手机端诊断:', JSON.stringify({
    hasHook: diag.hasHook, deviceId: diag.deviceId, serverUrl: diag.serverUrl, autoSync: diag.autoSync,
    pending: diag.pending, syncState: diag.syncState, syncError: diag.syncError, modalOpen: diag.modalOpen
  }));
  ok('手机上新建的待办已进入本地库', !!diag.localTitles && diag.localTitles.includes('来自手机的待办'), diag.localTitles && diag.localTitles.filter((t) => t.includes('手机')));

  await sleep(4000);
  let server2 = await (await fetch(URL + '/api/pull?since=0&limit=5000')).json();
  let phonePush = server2.records.find((r) => r.collection === 'tasks' && r.data.title === '来自手机的待办');
  ok('手机端新建的待办已回流到服务器（自动同步）', !!phonePush, { pending: diag.pending, syncState: diag.syncState, error: diag.syncError });

  if (!phonePush) {
    console.log('  自动同步未生效，改为手动触发同步以定位问题…');
    await B.page.evaluate(() => window.__schedule.syncNow('diagnostic'));
    await sleep(2500);
    const diag2 = await B.page.evaluate(() => ({
      pending: window.__schedule.pendingCount(),
      state: window.__schedule.syncStat.state,
      error: window.__schedule.syncStat.error,
      pushed: window.__schedule.syncStat.pushed
    }));
    console.log('  手动同步结果:', JSON.stringify(diag2));
    server2 = await (await fetch(URL + '/api/pull?since=0&limit=5000')).json();
    phonePush = server2.records.find((r) => r.collection === 'tasks' && r.data.title === '来自手机的待办');
    ok('手动同步后回流到服务器', !!phonePush, diag2);
  }
  ok('该记录来自不同设备 ID', !!phonePush && phonePush.deviceId !== pushed.deviceId, phonePush && { phone: phonePush.deviceId, pc: pushed.deviceId });
  await B.page.screenshot({ path: SHOTS + '/10-mobile-tasks.png' });

  console.log('\n[13] 回归测试：同步进行中发生的修改不能丢失');
  // 先在手机端发起一次同步，紧接着写入一条新记录（模拟"同步进行中又改了数据"）
  const race = await B.page.evaluate(async () => {
    const s = window.__schedule;
    const before = s.syncStat.lastSyncAt;
    s.syncNow('busy');                       // 不 await：制造同步进行中
    const busyReply = await s.syncNow('collide');  // 立刻再请求一次，应被排队
    const id = s.newId();
    s.putRecord('tasks', id, {
      title: '并发写入回归测试', category: '杂技'.replace('技', '事'), dueDate: null, dueTime: null,
      priority: 'P2', status: '未开始', estimateMinutes: 10, repeat: '不重复', note: '',
      anniversaryId: null, completedAt: null, createdAt: Date.now()
    });
    return { busyReply, id, before };
  });
  ok('同步进行中的第二次请求被排队而非丢弃', /排队/.test(race.busyReply.message), race.busyReply);
  await sleep(6000);
  const server3 = await (await fetch(URL + '/api/pull?since=0&limit=5000')).json();
  const raced = server3.records.find((r) => r.collection === 'tasks' && r.data.title === '并发写入回归测试');
  const finalState = await B.page.evaluate(() => ({
    pending: window.__schedule.pendingCount(), state: window.__schedule.syncStat.state, lastSyncAt: window.__schedule.syncStat.lastSyncAt
  }));
  ok('并发期间写入的记录最终已同步到服务器', !!raced, { finalState });
  ok('同步完成后本地待上传数归零', finalState.pending === 0, finalState);
  ok('最后一次同步时间已推进', finalState.lastSyncAt >= race.before, { before: race.before, after: finalState.lastSyncAt });

  console.log('\n[14] 控制台错误检查');
  const allErrs = A.errs.concat(B.errs).filter((e) => !/favicon|Download the React DevTools/i.test(e));
  ok('两个端都没有 JS 运行时错误', allErrs.length === 0, allErrs.slice(0, 6));
} catch (e) {
  fail++;
  console.log('\n  FAIL  测试中断: ' + (e && e.stack || e));
} finally {
  await browser.close();
  stopIsolatedServer();
}

console.log('\n========================================');
console.log('  浏览器端通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
