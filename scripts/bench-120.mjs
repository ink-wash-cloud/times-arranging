// 120Hz 可行性评测：去掉帧率上限，看每帧还剩多少预算
import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--window-size=420,900']   // 不禁用 GPU：要的是"没有帧率上限"的真实吞吐
});

const measure = async (page, client, label, throttle, phase) => {
  await client.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await sleep(500);
  const before = await client.send('Performance.getMetrics');
  const t0 = Date.now();
  const promise = page.evaluate((d) => new Promise((res) => {
    const deltas = []; let last = 0, frames = 0;
    const t = performance.now();
    function tick(x) { if (last) deltas.push(x - last); last = x; frames++; if (performance.now() - t < d) requestAnimationFrame(tick); else { const dur = performance.now() - t; const s = deltas.slice().sort((a, b) => a - b); res({ frames, dur, p50: s[Math.floor(s.length * .5)] || 0, p95: s[Math.floor(s.length * .95)] || 0 }); } }
    requestAnimationFrame(tick);
  }), 2500);

  let scrollDone = Promise.resolve();
  if (phase === 'scroll') {
    scrollDone = client.send('Input.synthesizeScrollGesture', {
      x: 210, y: 500, xDistance: 0, yDistance: -2600, speed: 2600, gestureSourceType: 'touch'
    }).catch(() => {});
  }
  const r = await promise;
  await scrollDone;
  const after = await client.send('Performance.getMetrics');
  const pick = (m, k) => (m.metrics.find((x) => x.name === k) || {}).value || 0;
  const frames = r.frames, dur = r.dur / 1000;
  const fps = frames / dur;
  const budget = 1000 / 120;
  const usedPct = (r.p50 / budget) * 100;
  console.log('  ' + label.padEnd(22) + String(Math.round(fps)).padStart(5) + ' FPS   p50 ' + r.p50.toFixed(2).padStart(5) +
    'ms  p95 ' + r.p95.toFixed(2).padStart(5) + 'ms   ' +
    '脚本 ' + ((pick(after, 'ScriptDuration') - pick(before, 'ScriptDuration')) * 1000).toFixed(0).padStart(4) + 'ms  ' +
    '样式 ' + ((pick(after, 'RecalcStyleDuration') - pick(before, 'RecalcStyleDuration')) * 1000).toFixed(0).padStart(4) + 'ms  ' +
    '布局 ' + ((pick(after, 'LayoutDuration') - pick(before, 'LayoutDuration')) * 1000).toFixed(0).padStart(3) + 'ms  ' +
    '| 8.33ms 预算用了 ' + usedPct.toFixed(0) + '%');
  return { fps, budgetUsed: usedPct };
};

const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const client = await page.createCDPSession();
await client.send('Performance.enable');
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForSelector('.app');
await page.waitForFunction(() => !/欢迎使用时序/.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
await sleep(2000);

console.log('');
console.log('  手机视口 390x844 · 不加帧率上限（GPU 渲染）');
console.log('  目标：8.33ms/帧 = 120FPS 预算');
console.log('');
console.log('  ── 静置 ──');
for (const t of [1, 4, 6, 8]) await measure(page, client, 'CPU ' + t + 'x', t, 'idle');
console.log('');
console.log('  ── 滚动列表（120Hz 最容易被感知的场景）──');
for (const t of [1, 4, 6, 8]) await measure(page, client, 'CPU ' + t + 'x', t, 'scroll');

await browser.close();
