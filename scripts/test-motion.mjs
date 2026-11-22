import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
// 默认起隔离实例，别把测试数据写进真实库：node scripts/test-motion.mjs http://host:port 可指定
const EXPLICIT = process.argv[2] || '';
const URL = EXPLICIT || await startIsolatedServer(Number(process.env.TEST_PORT || 8874));
mkdirSync('shots4', { recursive: true });
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); } };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--window-size=1600,1000'] });
try {
  const page = await (await browser.createBrowserContext()).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app');
  await page.waitForFunction(() => !/欢迎使用时序/.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
  await sleep(2500);

  console.log('\n[1] 滑块是否挂上');
  const hosts = await page.evaluate(() => ({
    total: document.querySelectorAll('.slide-host').length,
    withPill: document.querySelectorAll('.slide-host > .slide-pill').length,
    navList: !!document.querySelector('.nav-list.slide-host'),
    tabbar: !!document.querySelector('.tabbar.slide-host')
  }));
  ok('已为选项组挂上滑块容器', hosts.total > 0 && hosts.withPill > 0, hosts);
  ok('侧栏导航有滑块', hosts.navList === true, hosts.navList);
  ok('手机底栏有滑块', hosts.tabbar === true, hosts.tabbar);

  console.log('\n[2] 滑块位置是否跟随选中项');
  const navAlign = await page.evaluate(() => {
    const host = document.querySelector('.nav-list');
    const pill = host.querySelector('.slide-pill');
    const active = Array.from(host.children).find((c) => c.classList.contains('active'));
    if (!pill || !active) return null;
    const hr = host.getBoundingClientRect(), pr = pill.getBoundingClientRect(), ar = active.getBoundingClientRect();
    return { dx: Math.round(pr.left - ar.left), dy: Math.round(pr.top - ar.top), dw: Math.round(pr.width - ar.width), opacity: getComputedStyle(pill).opacity };
  });
  ok('滑块与选中项对齐', navAlign && Math.abs(navAlign.dx) <= 2 && Math.abs(navAlign.dy) <= 2 && Math.abs(navAlign.dw) <= 2, navAlign);

  console.log('\n[3] 点击相邻选项时滑块会移动');
  const before = await page.evaluate(() => {
    const host = document.querySelector('.nav-list');
    return host.querySelector('.slide-pill').getBoundingClientRect().top;
  });
  await page.evaluate(() => {
    const host = document.querySelector('.nav-list');
    const target = Array.from(host.children).find((c) => c.innerText.includes('灵感池'));
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    target.click();
  });
  await sleep(120);
  const mid = await page.evaluate(() => document.querySelector('.nav-list .slide-pill').getBoundingClientRect().top);
  await sleep(500);
  const after = await page.evaluate(() => {
    const host = document.querySelector('.nav-list');
    const pill = host.querySelector('.slide-pill');
    const active = Array.from(host.children).find((c) => c.classList.contains('active'));
    return { top: pill.getBoundingClientRect().top, activeTop: active.getBoundingClientRect().top };
  });
  ok('点击后滑块开始移动（不是瞬移）', Math.abs(mid - before) > 1 || Math.abs(after.top - before) > 1, { before, mid, after: after.top });
  ok('动画结束后对齐到新选中项', Math.abs(after.top - after.activeTop) <= 2, after);

  console.log('\n[4] 切换栏目有入场过渡');
  // 机器上如果关了 Windows 的「动画效果」，Chrome 会报 prefers-reduced-motion: reduce，
  // 应用会（正确地）把入场动画关掉 —— 那是系统设置，不是回归。这里固定成 no-preference 再测。
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.innerText.includes('今日总览')); if (b) b.click(); });
  await sleep(400);
  const viewAnim = await page.evaluate(() => {
    const el = document.querySelector('.content-inner');
    return { cls: el.className, anim: getComputedStyle(el).animationName, dur: getComputedStyle(el).animationDuration };
  });
  ok('内容区带 view-enter 入场动画', viewAnim.cls.includes('view-enter') && viewAnim.anim === 'viewIn', viewAnim);

  console.log('\n[4b] 极致画质档：入场不做淡入，卡片毛玻璃从第一帧就在');
  // 带 opacity 的祖先会变成新的 backdrop root，卡片上的 backdrop-filter 在
  // 动画期间等于失效（看着像退回极致性能档、动画跑完才糊上）。这一档改用
  // 只做位移的 viewInSolid，透明度全程保持 1。
  await page.evaluate(async () => { await window.__schedule.appearance.save({ perf: 'quality' }); });
  await sleep(500);
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.innerText.includes('灵感池')); if (b) b.click(); });
  await sleep(90);
  const qAnim = await page.evaluate(() => {
    const el = document.querySelector('.content-inner');
    const cs = getComputedStyle(el);
    const card = document.querySelector('.card');
    return {
      name: cs.animationName,
      opacity: cs.opacity,
      cardBd: card ? (getComputedStyle(card).backdropFilter || getComputedStyle(card).webkitBackdropFilter || '') : ''
    };
  });
  ok('这一档的入场换成不带淡入的 viewInSolid', qAnim.name === 'viewInSolid', qAnim);
  ok('动画进行中内容区透明度仍是 1（不新建 backdrop root）', Number(qAnim.opacity) > 0.99, qAnim);
  ok('这一档卡片确实开着毛玻璃', /blur/.test(qAnim.cardBd), qAnim.cardBd);
  await page.evaluate(async () => { await window.__schedule.appearance.save({ perf: 'balanced' }); });
  await sleep(400);

  console.log('\n[5] 芯片组滑块');
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.innerText.includes('灵感池')); if (b) b.click(); });
  await sleep(700);
  const chipHost = await page.evaluate(() => {
    const hosts = Array.from(document.querySelectorAll('.chip-row.slide-host'));
    const h = hosts[0];
    if (!h) return null;
    const pill = h.querySelector('.slide-pill');
    const active = Array.from(h.children).find((c) => c.classList.contains('on'));
    if (!pill || !active) return { hosts: hosts.length, aligned: false };
    const pr = pill.getBoundingClientRect(), ar = active.getBoundingClientRect();
    return { hosts: hosts.length, dx: Math.round(pr.left - ar.left), aligned: Math.abs(pr.left - ar.left) <= 2 && Math.abs(pr.width - ar.width) <= 2 };
  });
  ok('芯片筛选组也有滑块对齐', chipHost && chipHost.aligned === true, chipHost);

  console.log('\n[6] 控制台错误');
  const real = errs.filter((e) => !/favicon|DevTools/i.test(e));
  ok('无 JS 运行时错误', real.length === 0, real.slice(0, 4));

  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.innerText.includes('总览')); if (b) b.click(); });
  await sleep(600);
  await page.screenshot({ path: 'shots4/motion-desktop.png' });

  const m = await (await browser.createBrowserContext()).newPage();
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.goto(URL, { waitUntil: 'networkidle2' });
  await m.waitForSelector('.app');
  await m.waitForFunction(() => !/欢迎使用时序/.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
  await sleep(2500);
  const mt = await m.evaluate(() => {
    const host = document.querySelector('.tabbar');
    const pill = host.querySelector('.slide-pill');
    const active = Array.from(host.children).find((c) => c.classList.contains('active'));
    if (!pill || !active) return null;
    return { dx: Math.round(pill.getBoundingClientRect().left - active.getBoundingClientRect().left), aligned: Math.abs(pill.getBoundingClientRect().left - active.getBoundingClientRect().left) <= 2 };
  });
  ok('手机底栏滑块对齐', mt && mt.aligned === true, mt);

  const layout = await m.evaluate(() => {
    const tb = document.querySelector('.tabbar');
    const cs = getComputedStyle(tb);
    const r = tb.getBoundingClientRect();
    const app = document.querySelector('.app').getBoundingClientRect();
    return { position: cs.position, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, appBottom: Math.round(app.bottom) };
  });
  ok('手机底栏仍固定在底部（回归：滑块不能覆盖 fixed 定位）',
    layout.position === 'fixed' && layout.top > layout.vh / 2 && layout.bottom > layout.vh - 80, layout);
  const topbar = await m.evaluate(() => {
    const t = document.querySelector('.topbar').getBoundingClientRect();
    return { w: Math.round(t.width), h: Math.round(t.height), vw: window.innerWidth };
  });
  ok('顶栏没有被挤成竖排', topbar.w > topbar.vw * 0.6 && topbar.h < 140, topbar);
  await m.screenshot({ path: 'shots4/motion-mobile.png' });
} catch (e) {
  fail++; console.log('  FAIL  中断: ' + (e && e.stack || e));
} finally { await browser.close(); stopIsolatedServer(); }
console.log('\n========================================');
console.log('  过渡动画验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
