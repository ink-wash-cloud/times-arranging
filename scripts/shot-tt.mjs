import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.argv[2];
mkdirSync('shots11', { recursive: true });
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--font-render-hinting=none'] });
const p = await b.newPage();
await p.setViewport({ width: 1500, height: 1100, deviceScaleFactor: 2 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(3000);
await p.evaluate(() => { location.hash = '#tt'; });
await sleep(2000);
// 选一个班看
await p.evaluate(() => {
  const c = Array.from(document.querySelectorAll('.chip')).find((x) => x.innerText.trim() === '计26.1(36)');
  if (c) c.click();
});
await sleep(1200);
const info = await p.evaluate(() => {
  const cells = Array.from(document.querySelectorAll('.tt-col'))[0];
  const c0 = cells ? cells.querySelectorAll('.tt-cell') : [];
  let sum = 0;
  for (const c of c0) sum += c.getBoundingClientRect().height;
  const col = cells ? cells.getBoundingClientRect().height : 0;
  const first = document.querySelector('.tt-course');
  const fr = first ? first.getBoundingClientRect() : null;
  const colLeft = cells ? cells.getBoundingClientRect() : null;
  // 08:00 那条线在哪儿
  const timeEls = Array.from(document.querySelectorAll('.tt-time')).map((x) => ({ t: x.innerText, top: Math.round(x.getBoundingClientRect().top) }));
  return {
    cellCount: c0.length,
    cellSum: Math.round(sum),
    colHeight: Math.round(col),
    firstCourse: first ? { text: first.innerText.replace(/\s+/g,' ').slice(0, 24), top: Math.round(fr.top), h: Math.round(fr.height), relTop: Math.round(fr.top - colLeft.top) } : null,
    times: timeEls.slice(0, 6),
    ttMinWidth: getComputedStyle(document.querySelector('.tt')).minWidth
  };
});
console.log(JSON.stringify(info, null, 1));
await p.screenshot({ path: process.env.SHOT || 'shots11/live-tt.png', fullPage: false });
await b.close();
