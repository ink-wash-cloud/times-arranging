import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync('shots-final', { recursive: true });
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 940, deviceScaleFactor: 2 });
await p.goto('http://127.0.0.1:8787', { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(4000);
console.log('版本: ' + await p.evaluate(() => (document.body.innerText.match(/v\d+\.\d+\.\d+/) || [''])[0]));

// 习惯编辑框：备注「每天 200 个」的一键填上
await p.evaluate(() => { location.hash = '#habits'; });
await sleep(2000);
const opened = await p.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.habit-card')).find((x) => x.innerText.includes('每天 200 个'));
  if (!c) return '没有带备注的习惯卡';
  const btn = Array.from(c.querySelectorAll('button')).find((x) => x.innerText.trim() === '编辑');
  if (!btn) return '没找到编辑按钮';
  btn.click(); return 'ok';
});
await sleep(1500);
console.log('打开编辑框: ' + opened);
await p.screenshot({ path: 'shots-final/habit-editor.png' });

await p.keyboard.press('Escape');
await sleep(800);
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await sleep(1500);
await p.screenshot({ path: 'shots-final/mobile.png' });
const bar = await p.evaluate(() => document.querySelector('.topbar').innerText.replace(/\s+/g, ' '));
console.log('手机顶栏: ' + bar);
await b.close();
