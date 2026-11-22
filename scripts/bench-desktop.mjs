// 电脑端帧率评测：分场景测「不加帧率上限」时的真实吞吐
import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--window-size=1600,1000']   // 不禁用 GPU：要的是没有帧率上限的真实吞吐
});
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1600, height: 1000 });
const client = await page.createCDPSession();
await client.send('Performance.enable');
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForSelector('.app');
await page.waitForFunction(() => !/欢迎使用时序/.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
await sleep(2500);

const pick = (m, k) => (m.metrics.find((x) => x.name === k) || {}).value || 0;

async function phase(label, script, ms = 2500) {
  const before = await client.send('Performance.getMetrics');
  const r = await page.evaluate((body, dur) => new Promise((res) => {
    const deltas = []; let last = 0, frames = 0;
    const t = performance.now();
    const step = new Function('frames', 't', body);
    function tick(x) { if (last) deltas.push(x - last); last = x; frames++; step(frames, x); if (performance.now() - t < dur) requestAnimationFrame(tick); else { const d = performance.now() - t; const s = deltas.slice().sort((a, b) => a - b); res({ frames, dur: d, p50: s[Math.floor(s.length * .5)] || 0, p95: s[Math.floor(s.length * .95)] || 0 }); } }
    requestAnimationFrame(tick);
  }), script, ms);
  const after = await client.send('Performance.getMetrics');
  const budget = 1000 / 120;
  console.log('  ' + label.padEnd(16) + String(Math.round(r.frames / (r.dur / 1000))).padStart(5) + ' FPS   p50 ' +
    r.p50.toFixed(2).padStart(5) + 'ms  p95 ' + r.p95.toFixed(2).padStart(5) + 'ms   ' +
    '脚本 ' + ((pick(after, 'ScriptDuration') - pick(before, 'ScriptDuration')) * 1000).toFixed(0).padStart(4) + 'ms  ' +
    '样式 ' + ((pick(after, 'RecalcStyleDuration') - pick(before, 'RecalcStyleDuration')) * 1000).toFixed(0).padStart(4) + 'ms  ' +
    '布局 ' + ((pick(after, 'LayoutDuration') - pick(before, 'LayoutDuration')) * 1000).toFixed(0).padStart(3) + 'ms   ' +
    '| 120FPS 预算 ' + ((r.p50 / budget) * 100).toFixed(0) + '%');
  return r.frames / (r.dur / 1000);
}

console.log('');
console.log('  电脑端 1600x1000 · 不加帧率上限 · 目标 120FPS（8.33ms/帧）');
console.log('');
const results = [];
results.push(await phase('静置', 'void frames;'));
results.push(await phase('光标扫过卡片', 'let mx=200,d=1; mx+=26*d; if(mx>1300||mx<260)d*=-1; window.dispatchEvent(new PointerEvent("pointermove",{clientX:mx,clientY:300+Math.sin(frames/8)*170,pointerType:"mouse"}));'));
results.push(await phase('滚动列表', 'if(frames%18===0){const c=document.querySelector(".content"); if(c) c.scrollTop += 90; if(c && c.scrollTop + c.clientHeight >= c.scrollHeight-2) c.scrollTop = 0;}'));
results.push(await phase('连续切换栏目', 'if(frames%12===0){const n=document.querySelectorAll(".nav-item"); const i=Math.floor(frames/12)%n.length; n[i].click();}'));
results.push(await phase('连续点选项芯片', 'if(frames%10===0){const c=document.querySelectorAll(".chip-row .chip"); if(c.length){const i=Math.floor(frames/10)%c.length; c[i].click();}}'));
results.push(await phase('全部叠加', 'let mx=200,d=1; mx+=30*d; if(mx>1300||mx<260)d*=-1; window.dispatchEvent(new PointerEvent("pointermove",{clientX:mx,clientY:400,pointerType:"mouse"})); if(frames%14===0){const c=document.querySelector(".content"); if(c) c.scrollTop += 70; if(frames%42===0){const n=document.querySelectorAll(".nav-item"); n[Math.floor(frames/42)%n.length].click();}}'));

const min = Math.min.apply(null, results);
console.log('');
console.log('  最低场景帧率 ' + Math.round(min) + ' FPS  —— ' + (min >= 120 ? '✓ 全部场景都在 120 以上' : '✗ 有场景低于 120'));
await browser.close();
