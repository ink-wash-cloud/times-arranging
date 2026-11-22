// 换 Wi-Fi 之后的同步专项。
//
// 场景：同步地址是个局域网 IP，电脑换一个网络地址就变了，手机里存的还是老地址，
// 于是两边一直同步不上、而且看不出原因。
// 现在：先试记过的几个地址（地址池），都不行就在局域网里扫一遍（扫描是安卓专有，
// 浏览器里跑不了，所以这里只测地址池那一段）。
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const GOOD = 'http://127.0.0.1:8816';
const DEAD = 'http://127.0.0.1:9';   // 9 号端口是 discard，本机上没人监听，连它会立刻被拒
const URL = process.argv[2] || await startIsolatedServer(8816);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);
await p.evaluate(async () => { await window.__schedule.loadAll(); });
await sleep(1500);

const sync = () => p.evaluate(async () => {
  const r = await window.__schedule.syncNow('manual');
  return { ok: r.ok, message: r.message, serverUrl: window.__schedule.cfg.serverUrl, pool: window.__schedule.cfg.serverUrls.slice() };
});

console.log('\n[1] 地址失效时，先试池子里的其他地址');
await p.evaluate((dead, good) => {
  window.__schedule.cfg.serverUrl = dead;
  window.__schedule.cfg.serverUrls = [dead, good];
}, DEAD, GOOD);
const r1 = await sync();
console.log('   结果: ok=' + r1.ok + '  当前地址=' + r1.serverUrl);
console.log('   消息: ' + r1.message);
ok('同步最终成功了（自动切到了能用的那个）', r1.ok, r1);
ok('当前地址换成了能用的那个', r1.serverUrl === GOOD, r1.serverUrl);
ok('消息里说明了是自动切换的', r1.message.includes('自动切换') || r1.message.includes('已自动'), r1.message);
ok('两个地址都还在池子里', r1.pool.includes(DEAD) && r1.pool.includes(GOOD), r1.pool);

console.log('\n[2] 再同步一次：直接用已经切好的地址，不该再折腾');
const r2 = await sync();
console.log('   消息: ' + r2.message);
ok('第二次同步正常', r2.ok, r2);
ok('没有再去试那个坏地址', !r2.message.includes('自动切换'), r2.message);

console.log('\n[3] 池子里全是坏地址：应当如实报错，不能假装成功');
await p.evaluate((dead) => {
  window.__schedule.cfg.serverUrl = dead;
  window.__schedule.cfg.serverUrls = [dead];
}, DEAD);
const r3 = await sync();
console.log('   结果: ok=' + r3.ok + '  消息: ' + r3.message.slice(0, 80));
ok('同步失败并且说清楚了', !r3.ok && r3.message.length > 0, r3);
ok('提示里带了原始错误（不是一句空话）', r3.message.includes('同步失败'), r3.message.slice(0, 90));

console.log('\n[4] 设置页能看到这些地址');
await p.evaluate((good) => {
  window.__schedule.cfg.serverUrl = good;
  window.__schedule.cfg.serverUrls = [good, 'http://192.168.1.7:8787'];
}, GOOD);
await p.evaluate(() => { location.hash = '#settings'; });
await sleep(1200);
await p.evaluate(() => { location.hash = '#dash'; });
await sleep(600);
await p.evaluate(() => { location.hash = '#settings'; });
await sleep(1200);
// v1.4.1 设置页是「根列表 + 二级页」，连接地址/地址池搬进了「数据与同步」二级页
await p.evaluate(() => window.__schedule.ui.openSettingsPage('sync'));
await sleep(600);
await p.waitForSelector('[data-testid="addr-pool"]', { timeout: 5000 });
const list = await p.evaluate(() => {
  // 只数「已知地址池」那一块：页面上另有一块「这台电脑的地址」（候选地址列表），
  // 两份都用 .addr-item，混在一起数会把候选地址也算进来
  const box = document.querySelector('[data-testid="addr-pool"]');
  const items = box ? Array.from(box.querySelectorAll('.addr-item')) : [];
  return {
    count: items.length,
    texts: items.map((x) => x.innerText.replace(/\s+/g, ' ').trim()),
    hasCurrentMark: items.some((x) => x.classList.contains('on') && x.innerText.includes('使用中'))
  };
});
console.log('   地址列表: ' + JSON.stringify(list.texts));
ok('列出了两个已知地址', list.count === 2, list);
ok('当前那个标了「使用中」', list.hasCurrentMark, list.texts);
ok('另一个给了「使用 / 移除」按钮', list.texts.some((t) => t.includes('使用') && t.includes('移除')), list.texts);

await b.close();
if (!process.argv[2]) stopIsolatedServer();
console.log('\n========================================');
console.log('  换网络同步验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
