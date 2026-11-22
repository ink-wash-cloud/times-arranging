// 服务器生命周期：页面在 = 服务器在；关掉应用服务器自己退出
//
// 两条路：
//   快路径  —— 页面卸载时 pagehide 里 sendBeacon('/api/bye')，服务器 10 秒后退出
//   兜底    —— 页面凭空消失（进程被杀/崩溃），服务器空闲超时后退出
// 真窗口点 ✕ 走的是快路径；这里用"导航离开页面"来触发同一套 pagehide，
// 比 puppeteer 的 browser.close()（直接杀进程，不触发卸载）更接近真实。
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startIsolatedServer, stopIsolatedServer, isolatedLog } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const alive = async (url) => {
  try { const r = await fetch(url + '/api/health', { signal: AbortSignal.timeout(1500) }); return r.ok; }
  catch { return false; }
};
const waitDead = async (url, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await sleep(400);
    if (!(await alive(url))) return Date.now() - t0;
  }
  return -1;
};
/** 服务器自己说的退出原因 */
const why = () => {
  const m = isolatedLog().match(/(页面已关闭[^\n]*|\d+ 秒没有客户端连接[^\n]*)/);
  return m ? m[1] : '(没看到退出原因)';
};
const show = (ms) => (ms < 0 ? '没退' : Math.round(ms / 1000) + ' 秒后退出');

const openPage = async (url) => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
  const p = await b.newPage();
  await p.goto(url, { waitUntil: 'networkidle2' });
  await p.waitForSelector('.app');
  await sleep(2000);
  return { b, p };
};

/* ============ 1. 跟随页面模式 ============ */
console.log('\n[1] 跟随页面模式（SHIXU_AUTO_EXIT=1）');
// 页面每 10 秒报一次到，空闲上限必须明显大于 10 秒
await startIsolatedServer(8875, { SHIXU_AUTO_EXIT: '1', SHIXU_IDLE_MS: '20000', SHIXU_BYE_GRACE_MS: '3000' });
const A = 'http://127.0.0.1:8875';
const h = await (await fetch(A + '/api/health')).json();
ok('服务器声明自己是跟随页面模式', h.ok === true && h.autoExit === true, h);

const { b: b1, p: p1 } = await openPage(A);
const pinged = await p1.evaluate(() => fetch('/api/here', { cache: 'no-store' }).then((r) => r.json()).catch(() => null));
ok('页面确实在报到（/api/here 有回应）', !!(pinged && pinged.ok), pinged);

console.log('   页面开着，等 26 秒（超过 20 秒的空闲上限）…');
await sleep(26000);
ok('页面开着时服务器不会被误杀（心跳生效）', await alive(A), why());

console.log('   让页面离开（触发 pagehide → sendBeacon 告别）…');
await p1.goto('about:blank', { waitUntil: 'domcontentloaded' }).catch(() => {});
const dead1 = await waitDead(A, 15000);
console.log('   ' + show(dead1) + ' · 原因：' + why());
ok('页面走了之后服务器很快退出', dead1 >= 0 && dead1 < 12000, dead1);
ok('走的是告别信号那条路（不是等 20 秒兜底）', /页面已关闭/.test(isolatedLog()), why());
await b1.close();

/* ============ 1b. 兜底：页面被强杀 ============ */
console.log('\n[1b] 页面被强杀（不会有 pagehide）');
await startIsolatedServer(8804, { SHIXU_AUTO_EXIT: '1', SHIXU_IDLE_MS: '12000', SHIXU_BYE_GRACE_MS: '3000' });
const D = 'http://127.0.0.1:8804';
const { b: bD } = await openPage(D);
await bD.close();          // 直接杀进程，模拟崩溃
const deadD = await waitDead(D, 30000);
console.log('   ' + show(deadD) + ' · 原因：' + why());
ok('页面凭空消失时靠空闲超时收尾（不会永远留着）', deadD >= 0, deadD);
stopIsolatedServer();

/* ============ 2. 常驻模式 ============ */
console.log('\n[2] 常驻模式（手动 npm start，不带 SHIXU_AUTO_EXIT）');
await startIsolatedServer(8802, { SHIXU_IDLE_MS: '6000' });
const B = 'http://127.0.0.1:8802';
ok('常驻模式声明 autoExit=false', (await (await fetch(B + '/api/health')).json()).autoExit === false, true);
const { b: b2, p: p2 } = await openPage(B);
await p2.goto('about:blank', { waitUntil: 'domcontentloaded' }).catch(() => {});
await b2.close();
console.log('   页面关了，等 12 秒…');
await sleep(12000);
ok('常驻模式下关页面也不会退（手动启动的行为不变）', await alive(B), why());
stopIsolatedServer();

/* ============ 3. 刷新不会把服务器带走 ============ */
console.log('\n[3] 刷新页面不会误退服务器');
await startIsolatedServer(8803, { SHIXU_AUTO_EXIT: '1', SHIXU_IDLE_MS: '25000', SHIXU_BYE_GRACE_MS: '3000' });
const C = 'http://127.0.0.1:8803';
const { b: b3, p: p3 } = await openPage(C);
for (let i = 0; i < 3; i++) {
  await p3.reload({ waitUntil: 'networkidle2' });
  await p3.waitForSelector('.app');
  await sleep(2500);
}
console.log('   刷新了 3 次，等 8 秒（超过 3 秒宽限）…');
await sleep(8000);
ok('刷新之后服务器还活着', await alive(C), why());
await p3.goto('about:blank', { waitUntil: 'domcontentloaded' }).catch(() => {});
const dead3 = await waitDead(C, 20000);
console.log('   最后离开，' + show(dead3) + ' · 原因：' + why());
ok('刷新完真正关掉，服务器照样会退', dead3 >= 0, dead3);
await b3.close();
stopIsolatedServer();

/* ============ 4. 端口被占用：说明白再退出 ============ */
console.log('\n[4] 端口被占用（双击了两次启动器）');
await startIsolatedServer(8805, {});
const E = 'http://127.0.0.1:8805';
ok('第一个实例正常起来了', await alive(E));
/* 第二个实例故意用一个独立的空数据目录：它连库都用不上，只该在 listen 上失败。 */
const secondDir = mkdtempSync(join(tmpdir(), 'shixu-second-'));
const second = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: '8805', HOST: '127.0.0.1', DATA_DIR: secondDir, SHIXU_BEACON: '0' }
});
let secondOut = '';
second.stdout.on('data', (d) => { secondOut += String(d); });
second.stderr.on('data', (d) => { secondOut += String(d); });
const secondExit = await new Promise((res) => {
  const t = setTimeout(() => res('timeout'), 12000);
  second.on('exit', (code) => { clearTimeout(t); res(code); });
});
ok('第二个实例自己退出（不会留一个死窗口）', secondExit !== 'timeout', secondExit);
ok('退出码是 0（"没事可做"而不是崩溃）', secondExit === 0, secondExit);
ok('说清了是端口被占用 / 已经在运行', /已被占用|已经在运行/.test(secondOut), secondOut.slice(-300));
ok('没有把栈甩到用户脸上', !/\bat\s+\/|Error:\s*listen EADDRINUSE/.test(secondOut), secondOut.slice(-300));
ok('第一个实例完全没受影响', await alive(E));
stopIsolatedServer();

console.log('\n========================================');
console.log('  生命周期验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
