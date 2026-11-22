// 构建版本自检：改完代码，已经开着的页面/应用窗口必须能自己换成新版本
//
// 这个测试会真的构建两次（第二次内容必然不同，因为版本号精确到秒），
// 然后验证页面在"切回前台"时能自己发现并切到新构建。
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { startIsolatedServer, stopIsolatedServer, ROOT } from './isoserver.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};

const build = () => execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });

console.log('  构建第一版…');
build();
const URL = await startIsolatedServer(Number(process.env.TEST_PORT || 8873));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('.app', { timeout: 20000 });
await sleep(3000);

const running = () => page.evaluate(() => {
  const s = document.querySelector('script[type="module"][src*="/assets/index-"]');
  return s ? s.getAttribute('src') : '';
});
const a = await running();
console.log('  当前页面跑的是: ' + a);
ok('页面加载了第一版构建', !!a, a);

const swA = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return !!(r && r.active);
});
ok('Service Worker 已激活（就是它会缓存旧页面）', swA);

console.log('  构建第二版…');
await sleep(1200);
build();

const served = await page.evaluate(async () => {
  const r = await fetch('/index.html?t=' + Date.now(), { cache: 'no-store' });
  const m = (await r.text()).match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  return m ? '/' + m[0] : '';
});
console.log('  服务器上是: ' + served);
ok('两次构建产出了不同文件名（构建确实是新的）', !!served && served !== a, { a, served });

const poke = async () => {
  try {
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
  } catch { /* 正在刷新，忽略 */ }
};
await poke();
await sleep(6000);
await poke();
await sleep(6000);

let now = '';
try { now = await running(); } catch { /* 可能正在导航 */ }
console.log('  自检之后跑的是: ' + now);
ok('页面自动换成新构建（不用用户手动硬刷新）', now === served, { now, served });

const navs = await page.evaluate(() => performance.getEntriesByType('navigation').length);
await poke();
await sleep(3000);
const navs2 = await page.evaluate(() => performance.getEntriesByType('navigation').length);
ok('稳定在新版本上，没有反复刷新', navs === navs2 && (await running()) === served, { navs, navs2 });

await browser.close();
stopIsolatedServer();
console.log('\n========================================');
console.log('  自动更新验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
