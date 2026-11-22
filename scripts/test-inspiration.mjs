// 灵感池端到端验证
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
mkdirSync('shots3', { recursive: true });
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 默认起隔离实例，别把测试数据写进真实库：node scripts/test-inspiration.mjs http://host:port 可指定
const EXPLICIT = process.argv[2] || '';
const URL = EXPLICIT || await startIsolatedServer(Number(process.env.TEST_PORT || 8795));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); } };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000'] });
try {
  const page = await (await browser.createBrowserContext()).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app');
  await sleep(2500);
  const t0 = await page.evaluate(() => document.body.innerText);
  if (/载入示例数据/.test(t0)) { await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.includes('载入示例数据')); if (b) b.click(); }); await sleep(1500); }

  console.log('\n[1] 灵感池入口与初始数据');
  ok('侧栏出现「灵感池」', await page.evaluate(() => Array.from(document.querySelectorAll('.nav-item')).some((n) => n.innerText.includes('灵感池'))));
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.innerText.includes('灵感池')); if (b) b.click(); });
  await sleep(800);
  const cards0 = await page.$$eval('.ins-card', (e) => e.length);
  ok('示例灵感已展示（' + cards0 + ' 条）', cards0 >= 5, cards0);
  ok('有「随手记」输入区', await page.evaluate(() => !!document.querySelector('.cap-input')));

  console.log('\n[2] 随手记：输入 + 回车保存');
  const before = await page.evaluate(() => window.__schedule.list('inspirations').length);
  await page.click('.cap-input');
  await page.type('.cap-input', '测试灵感：把日程软件做成液态玻璃质感', { delay: 5 });
  await page.keyboard.press('Enter');
  await sleep(700);
  const after = await page.evaluate(() => window.__schedule.list('inspirations').length);
  ok('回车后新增一条记录', after === before + 1, { before, after });
  ok('输入框已清空', await page.evaluate(() => document.querySelector('.cap-input').value === ''));
  const saved = await page.evaluate(() => window.__schedule.list('inspirations').map((x) => x.text).find((t) => t.includes('液态玻璃')));
  ok('内容正确保存', !!saved, saved);
  ok('新记录出现在列表里', await page.evaluate(() => document.body.innerText.includes('液态玻璃质感')));

  console.log('\n[3] Shift+回车换行不提交');
  await page.click('.cap-input');
  await page.type('.cap-input', '第一行', { delay: 5 });
  await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
  await page.keyboard.type('第二行', { delay: 5 });
  const multi = await page.evaluate(() => document.querySelector('.cap-input').value);
  ok('Shift+回车只换行不保存', multi.includes('\n') && multi.includes('第二行'), JSON.stringify(multi));
  await page.evaluate(() => { document.querySelector('.cap-input').value = ''; });
  await page.evaluate(() => {
    const ta = document.querySelector('.cap-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });

  console.log('\n[4] 筛选与搜索');
  const filterWorks = await page.evaluate(async () => {
    const chips = Array.from(document.querySelectorAll('.chip')).filter((c) => c.innerText.trim() === '已置顶');
    if (!chips.length) return null;
    chips[0].click();
    return true;
  });
  await sleep(500);
  ok('可以切到「已置顶」筛选', filterWorks === true);
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.chip')).find((x) => x.innerText.trim() === '全部'); if (c) c.click(); });
  await sleep(400);
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.chip')).find((x) => x.innerText.trim() === '已归档'); if (c) c.click(); });
  await sleep(400);
  // 只要筛选后展示的卡片全都是"已归档"，就说明筛选生效（不依赖具体条数，测试可重复运行）
  const archivedView = await page.$$eval('.ins-card', (els) => ({ total: els.length, allArchived: els.every((e) => e.classList.contains('archived')) }));
  ok('「已归档」筛选只展示已归档条目', archivedView.allArchived, archivedView);
  await page.evaluate(() => { const c = Array.from(document.querySelectorAll('.chip')).find((x) => x.innerText.trim() === '全部'); if (c) c.click(); });
  await sleep(400);

  console.log('\n[5] 置顶 / 归档 / 转为待办');
  const pinOk = await page.evaluate(() => {
    const btn = document.querySelector('.ins-card .ins-icon');
    if (!btn) return null;
    btn.click();
    return true;
  });
  await sleep(600);
  ok('置顶按钮可用', pinOk === true);
  ok('置顶后卡片排到最前', await page.evaluate(() => document.querySelector('.ins-card').classList.contains('pinned')));

  const tasksBefore = await page.evaluate(() => window.__schedule.list('tasks').length);
  const conv = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ins-card button')).find((x) => x.innerText.trim() === '转为待办');
    if (!b) return null;
    b.click();
    return true;
  });
  await sleep(800);
  const tasksAfter = await page.evaluate(() => window.__schedule.list('tasks').length);
  ok('「转为待办」按钮存在且可点', conv === true);
  ok('待办数量 +1', tasksAfter === tasksBefore + 1, { tasksBefore, tasksAfter });
  const st = await page.evaluate(() => {
    const i = window.__schedule.list('inspirations').find((x) => x.convertedTaskId);
    const t = i ? window.__schedule.list('tasks').find((x) => x.id === i.convertedTaskId) : null;
    return { source: i ? i.text.slice(0, 20) : null, task: t ? { title: t.title, dueDate: t.dueDate, category: t.category } : null, linked: !!i };
  });
  ok('生成的待办进入时间池（无截止日期）', !!st.task && st.task.dueDate === null, st);
  ok('灵感记录标记为已转化并回链', st.linked === true, st);

  console.log('\n[6] 归档');
  const arch = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.ins-card button')).find((x) => x.innerText.trim() === '归档');
    if (!b) return null;
    b.click();
    return true;
  });
  await sleep(600);
  ok('归档按钮可用', arch === true);
  const total = await page.evaluate(() => window.__schedule.list('inspirations').length);
  const shownNow = await page.$$eval('.ins-card', (e) => e.length);
  ok('归档后从主列表消失但未被删除', shownNow < total && total > 0, { total, shownNow });

  console.log('\n[7] 全局快捷记录按钮');
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.innerText.includes('总览')); if (b) b.click(); });
  await sleep(700);
  ok('总览页也有 💡 浮动按钮', await page.evaluate(() => !!document.querySelector('.fab')));
  await page.click('.fab');
  await sleep(500);
  ok('弹出快捷记录面板', await page.evaluate(() => !!document.querySelector('.modal textarea')));
  await page.type('.modal textarea', '从任意页面记下的念头', { delay: 5 });
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '记下来'); if (b) b.click(); });
  await sleep(800);
  const fromFab = await page.evaluate(() => window.__schedule.list('inspirations').some((x) => x.text === '从任意页面记下的念头'));
  ok('从任意页面记录成功进入灵感池', fromFab === true);
  await page.screenshot({ path: 'shots3/inspiration.png' });

  console.log('\n[8] 光晕已完全收敛（不再外溢）');
  const glowCheck = await page.evaluate(async () => {
    const sel = ['.card', '.topbar', '.ins-card', '.col'];
    const out = [];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (!el) continue;
      el.classList.add('g-on');
      const cs = getComputedStyle(el, '::after');
      out.push({ sel: s, top: cs.top, left: cs.left, right: cs.right, bottom: cs.bottom });
      el.classList.remove('g-on');
    }
    return out;
  });
  const allContained = glowCheck.every((g) => g.top === '0px' && g.left === '0px' && g.right === '0px' && g.bottom === '0px');
  ok('所有玻璃表面的柔光四边都是 0（无外扩光晕）', allContained, glowCheck);

  console.log('\n[9] 控制台错误');
  const real = errs.filter((e) => !/favicon|DevTools/i.test(e));
  ok('无 JS 运行时错误', real.length === 0, real.slice(0, 4));
} catch (e) {
  fail++;
  console.log('  FAIL  中断: ' + (e && e.stack || e));
} finally {
  await browser.close();
stopIsolatedServer();
}
console.log('\n========================================');
console.log('  灵感池验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
