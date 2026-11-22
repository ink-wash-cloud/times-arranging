// 电脑端「应用版」专项验证
//   1. manifest 满足"可安装"的硬性条件（Chrome/Edge 缺一项就不给安装入口）
//   2. Service Worker 能注册并激活（离线可用的前提）
//   3. 图标资源都能取到
//   4. 设置页出现「电脑应用」卡片，且状态文案符合当前环境
//   5. 本机地址下确实拿到了安装入口
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EXPLICIT = process.argv[2] || '';
const URL = EXPLICIT || await startIsolatedServer(Number(process.env.TEST_PORT || 8870));
const OUT = 'shots6';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

// 在应用脚本之前挂钩子，记录浏览器有没有给出安装入口
await page.evaluateOnNewDocument(() => {
  window.__bip = false;
  window.__bipDetail = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    window.__bip = true;
    window.__bipDetail = { platforms: e.platforms || [] };
  });
});

await page.setViewport({ width: 1440, height: 960 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('.app', { timeout: 20000 });
await sleep(3500);   // 等 SW 注册 + 安装条件判定

console.log('\n[1] 可安装条件（manifest）');
const man = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return null;
  const m = await (await fetch(link.href)).json();
  return { href: link.getAttribute('href'), ...m };
});
ok('页面挂上了 manifest', !!man, man && man.href);
if (man) {
  ok('manifest 有 name / short_name', !!man.name && !!man.short_name, { name: man.name, short: man.short_name });
  ok('display 是 standalone（独立窗口，不是浏览器标签）', man.display === 'standalone', man.display);
  ok('orientation 没有被锁成竖屏', man.orientation === 'any', man.orientation);
  ok('start_url 与 scope 存在', !!man.start_url && !!man.scope, { s: man.start_url, c: man.scope });
  ok('有 id（Windows 上应用身份稳定）', !!man.id, man.id);
  const sizes = (man.icons || []).map((i) => i.sizes);
  ok('包含 192 与 512 图标', sizes.includes('192x192') && sizes.includes('512x512'), sizes);
  ok('包含 maskable 图标（安卓桌面不变形）', (man.icons || []).some((i) => (i.purpose || '').includes('maskable')), sizes);
  ok('主题色跟随界面（奶油色，不是旧的深蓝）', man.theme_color === '#fbf5ee', man.theme_color);
  ok('有任务栏跳转列表 shortcuts', (man.shortcuts || []).length >= 3, (man.shortcuts || []).map((s) => s.url));
}

console.log('\n[2] Service Worker（离线可用）');
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return { has: !!reg, active: !!(reg && reg.active), scope: reg && reg.scope };
});
ok('Service Worker 已注册', sw.has, sw);
ok('Service Worker 已激活', sw.active, sw);

console.log('\n[3] 图标资源');
for (const p of ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', '/favicon.ico']) {
  const res = await page.evaluate(async (u) => {
    const r = await fetch(u, { method: 'HEAD' });
    return { s: r.status, t: r.headers.get('content-type') };
  }, p);
  ok('可取到 ' + p, res.s === 200 && /image/.test(res.t || ''), res);
}

console.log('\n[4] 设置页「电脑应用」卡片');
await page.evaluate(() => { location.hash = '#settings'; });
await sleep(900);
// v1.4.1：电脑应用（DesktopAppPanel）在 'apps' 二级页
await page.evaluate(() => window.__schedule.ui.openSettingsPage('apps'));
await sleep(700);
await page.waitForFunction(() => document.body.innerText.includes('电脑应用'), { timeout: 10000 }).catch(() => {});
const card = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.subpage .card'));
  const c = cards.find((x) => (x.innerText || '').includes('电脑应用'));
  return c ? { text: c.innerText.replace(/\s+/g, ' ').trim().slice(0, 260) } : null;
});
ok('设置页有「电脑应用」卡片', !!card, card);
if (card) {
  ok('卡片说明了装成应用后的好处', /独立窗口|没有地址栏/.test(card.text), card.text.slice(0, 80));
  ok('卡片给出了可操作的入口', /安装到电脑|应用窗口|localhost|Edge|Chrome/.test(card.text), card.text.slice(0, 120));
}

console.log('\n[5] 浏览器是否给出安装入口');
const bip = await page.evaluate(() => ({ bip: window.__bip, detail: window.__bipDetail, mode: matchMedia('(display-mode: standalone)').matches }));
console.log('   beforeinstallprompt:', JSON.stringify(bip));
ok('本机地址下拿到了安装入口（无头模式可能不触发，仅作参考）', bip.bip === true || process.env.ALLOW_NO_BIP === '1', bip);

console.log('\n[6] 控制台错误');
const real = errs.filter((e) => !/favicon|DevTools|Download the React/i.test(e));
ok('没有 JS 运行时错误', real.length === 0, real.slice(0, 4));

await page.screenshot({ path: OUT + '/desktop-app-panel.png', fullPage: false });
await browser.close();
stopIsolatedServer();

console.log('\n========================================');
console.log('  电脑应用版验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
