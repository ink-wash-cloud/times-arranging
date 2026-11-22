// 桌面挂件：验证它真的能弹成"桌面上的独立小窗"，而不是页面里的浮层
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EXPLICIT = process.argv[2] || '';
// 8790 常驻着 InkMusic（不是时序），默认改成空闲的 8832
const URL = EXPLICIT || await startIsolatedServer(Number(process.env.TEST_PORT || 8872));
const OUT = 'shots7';
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

await page.setViewport({ width: 1440, height: 960 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('.app', { timeout: 20000 });
// 等演示数据播种完成，否则挂件里会是空的，验证不到真实内容
await page.waitForFunction(() => !/欢迎使用时序/.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
await sleep(3000);

console.log('\n[1] 能力检测');
const caps = await page.evaluate(() => ({
  pip: !!window.documentPictureInPicture,
  req: typeof window.documentPictureInPicture?.requestWindow === 'function'
}));
console.log('   documentPictureInPicture: ' + JSON.stringify(caps));
ok('浏览器提供 Document PiP（置顶小窗的前提）', caps.pip && caps.req, caps);

// 隔离库里是空的（演示数据要手动载入），先自己造两条待办，
// 不然挂件弹出来是"今天没有待办"，验证不到真实内容。
await page.evaluate(async () => {
  const s = window.__schedule;
  if (!s) return;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const base = { category: '学习', status: '未开始', estimateMin: 30, repeat: 'none', note: '' };
  await s.putRecord('tasks', s.newId(), { ...base, title: '挂件验证用今日待办', priority: 'P1', dueDate: today });
  await s.putRecord('tasks', s.newId(), { ...base, title: '挂件验证用逾期待办', priority: 'P0', dueDate: '2020-01-01', category: '杂事' });
});
await sleep(800);

console.log('\n[2] 点击「桌面挂件」');
const clicked = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.topbar button')).find((x) => x.innerText.includes('桌面挂件'));
  if (!b) return false;
  b.click();
  return true;
});
ok('找到了顶栏的桌面挂件按钮', clicked);
await sleep(2500);

const st = await page.evaluate(() => {
  const w = window.documentPictureInPicture ? window.documentPictureInPicture.window : null;
  if (!w) return { hasWin: false };
  const d = w.document;
  const el = d.querySelector('.widget');
  const cs = el ? w.getComputedStyle(el) : null;
  return {
    hasWin: true,
    closed: w.closed,
    bodyClass: d.body.className,
    hasWidget: !!el,
    widgetClass: el ? el.className : null,
    position: cs ? cs.position : null,
    height: cs ? Math.round(parseFloat(cs.height)) : null,
    winH: w.innerHeight,
    bg: cs ? cs.backgroundColor : null,
    fontFamily: cs ? cs.fontFamily : null,
    sheetCount: d.styleSheets.length,
    rootTheme: d.documentElement.dataset.theme || null,
    items: d.querySelectorAll('.wg-item').length,
    text: (d.body.innerText || '').replace(/\s+/g, ' ').slice(0, 140)
  };
});
console.log('   ' + JSON.stringify(st).slice(0, 420));
ok('弹出了独立的挂件窗口', st.hasWin && !st.closed, st);
ok('挂件内容渲染在那个窗口里', st.hasWidget, st.widgetClass);
ok('窗口里带上了样式表', (st.sheetCount || 0) > 0, st.sheetCount);
ok('挂件铺满窗口（不是浮层的 fixed 定位）',
  st.position === 'static' && Math.abs(st.height - st.winH) <= 2,
  { p: st.position, h: st.height, winH: st.winH });
ok('窗口里字体生效（样式确实搬过去了）', !!st.fontFamily && st.fontFamily !== '', st.fontFamily);
ok('主题同步到了窗口', st.rootTheme === 'ins', st.rootTheme);
const pending = Number((st.text.match(/(\d+) 待处理/) || [])[1] || 0);
ok('窗口里显示的是真实数据（有待处理项）', pending > 0, { pending, text: st.text });
ok('窗口里列出了具体待办条目', st.items > 0, { items: st.items });

console.log('\n[3] 主页面不再重复渲染挂件');
const mainHasWidget = await page.evaluate(() => {
  const w = document.querySelector('.widget');
  // portal 渲染在另一个文档里，主文档里不该再有可见的挂件
  return !!w && w.getBoundingClientRect().width > 0;
});
ok('主页面里没有重复的挂件浮层', !mainHasWidget, mainHasWidget);

console.log('\n[4] 换肤后窗口跟着变');
await page.evaluate(() => { location.hash = '#settings'; });
await sleep(800);
// 设置页改成 iOS 列表 + 二级页后，主题开关在「主题与字体」二级页里
await page.evaluate(() => { window.__schedule.ui.openSettingsPage('look'); });
await sleep(700);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.trim() === '暮色霓虹');
  if (b) b.click();
});
await sleep(900);
const themed = await page.evaluate(() => {
  const w = window.documentPictureInPicture.window;
  return { theme: w.document.documentElement.dataset.theme, bg: w.getComputedStyle(w.document.body).backgroundColor };
});
ok('窗口根元素跟着换成霓虹主题', themed.theme === 'neon', themed);
ok('窗口底色也跟着换（不是一直奶油色）', themed.bg !== 'rgb(251, 245, 238)', themed);

console.log('\n[5] 关闭');
await page.evaluate(() => {
  const w = window.documentPictureInPicture.window;
  const b = Array.from(w.document.querySelectorAll('.wg-btn')).pop();
  if (b) b.click();
});
await sleep(1200);
const after = await page.evaluate(() => ({
  pipWin: window.documentPictureInPicture.window ? window.documentPictureInPicture.window.closed : true,
  mainWidget: !!document.querySelector('.widget'),
  stored: localStorage.getItem('widget')
}));
ok('点 ✕ 后独立窗口被关掉', after.pipWin === true, after);
ok('主页面同时收起挂件', after.mainWidget === false, after);
ok('关闭状态已记住', after.stored === '0', after.stored);

console.log('\n[6] 控制台错误');
const real = errs.filter((e) => !/favicon|DevTools|Download the React/i.test(e));
ok('没有 JS 运行时错误', real.length === 0, real.slice(0, 4));

await browser.close();
stopIsolatedServer();
console.log('\n========================================');
console.log('  桌面挂件验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
