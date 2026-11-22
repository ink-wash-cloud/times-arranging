// 黑屏兜底专项
//
// 用户报的"一进设置就黑屏、重启也不行"，最大的问题是**看不到错误**：
// React 渲染一出错就把整棵树卸载，屏幕上什么都不剩，而错误信息只在控制台里，
// 手机上看不到。这个测试故意让应用在两个阶段出错，验证现在会给出可读的界面。
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};

const URL = await startIsolatedServer(Number(process.env.TEST_PORT || 8789));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

const readScreen = (page) => page.evaluate(() => {
  const root = document.getElementById('root');
  return {
    rootLen: root ? root.innerHTML.length : -1,
    text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 220),
    bg: getComputedStyle(document.body).backgroundColor,
    // 兜底页是自己塞进 #root 的 div，特征是有 inline 的 cream 背景
    hasFallbackBox: !!(root && root.querySelector('div[style*="background"]')),
    buttons: Array.from(document.querySelectorAll('#root button')).map((b) => b.innerText.trim())
  };
});

/* ---------------- 1. 正常情况：不该出现兜底页 ---------------- */
console.log('\n[1] 正常启动');
{
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await p.goto(URL, { waitUntil: 'networkidle2' });
  await p.waitForSelector('.app', { timeout: 20000 });
  await sleep(2000);
  const s = await readScreen(p);
  ok('正常情况下渲染出的是应用本体', await p.evaluate(() => !!document.querySelector('.app')), s.text.slice(0, 60));
  ok('正常情况下不出现错误页', !/应用没能启动|界面出错了/.test(s.text), s.text.slice(0, 80));
  // 手机上侧边栏是隐藏的，版本号放在设置页的「关于」卡里，哪儿都看得到
  await p.evaluate(() => { location.hash = '#settings'; });
  await sleep(1200);
  const ver = await p.evaluate(() => (document.body.innerText.match(/v\d+\.\d+\.\d+/g) || [])[0] || '');
  ok('设置页显示版本号（手机上没有侧边栏）', /^v\d+\.\d+\.\d+$/.test(ver), ver);
  ok('设置页有「关于」卡片', await p.evaluate(() => /关于/.test(document.body.innerText)));
  await p.close();
}

/* ---------------- 2. 启动阶段就挂：应该是可读的页面，不是黑屏 ---------------- */
console.log('\n[2] 启动阶段失败（模拟存储不可用）');
{
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await p.evaluateOnNewDocument(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() { throw new Error('模拟：IndexedDB 不可用'); }
    });
  });
  await p.goto(URL, { waitUntil: 'networkidle2' });
  await sleep(3000);
  const s = await readScreen(p);
  console.log('   屏幕文本: ' + s.text.slice(0, 120));
  console.log('   背景色: ' + s.bg);
  ok('没有停在黑屏（背景是奶油色而不是近黑）', !/rgb\(11, 14, 24\)|rgb\(0, 0, 0\)/.test(s.bg), s.bg);
  ok('显示了「应用没能启动」而不是空白', /应用没能启动/.test(s.text), s.text.slice(0, 80));
  ok('把错误内容也显示出来了', /模拟：IndexedDB 不可用|Error/.test(s.text), s.text.slice(0, 160));
  ok('给了重新加载的按钮', s.buttons.some((b) => b.includes('重新加载')), s.buttons);
  await p.screenshot({ path: 'shots9/crash-boot.png' });
  await p.close();
}

/* ---------------- 3. 渲染阶段挂：ErrorBoundary 接住 ---------------- */
console.log('\n[3] 渲染阶段失败（模拟读取本地设置时抛错）');
{
  const p = await browser.newPage();
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await p.evaluateOnNewDocument(() => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) {
      if (k === 'view') throw new Error('模拟：读取本地设置失败');
      return orig.call(this, k);
    };
  });
  await p.goto(URL, { waitUntil: 'networkidle2' });
  await sleep(3500);
  const s = await readScreen(p);
  console.log('   屏幕文本: ' + s.text.slice(0, 140));
  console.log('   按钮: ' + JSON.stringify(s.buttons));
  ok('渲染崩溃不再是黑屏，而是错误页', /界面出错了/.test(s.text), s.text.slice(0, 90));
  ok('页面背景是浅色（不是黑）', !/rgb\(11, 14, 24\)|rgb\(0, 0, 0\)/.test(s.bg), s.bg);
  ok('给出了复制错误信息 / 重新加载 / 安全模式三个出口',
    ['复制错误信息', '重新加载', '安全模式重启'].every((t) => s.buttons.includes(t)), s.buttons);
  ok('错误信息里带着版本号，方便对上号', /v\d+\.\d+\.\d+/.test(s.text), s.text.slice(0, 120));
  await p.screenshot({ path: 'shots9/crash-render.png' });
  await p.close();
}

await browser.close();
stopIsolatedServer();
console.log('\n========================================');
console.log('  黑屏兜底验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
