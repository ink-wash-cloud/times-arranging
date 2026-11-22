import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.argv[2] || await startIsolatedServer(8790);
mkdirSync('shots10', { recursive: true });
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu','--font-render-hinting=none'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);
await p.evaluate(async () => {
  const s = window.__schedule;
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const base = { status: '未开始', repeat: 'none', note: '', estimateMin: 30 };
  await s.putRecord('tasks', s.newId(), { ...base, title: '交高等数学作业第三章', category: '学习', priority: 'P0', dueDate: today, dueTime: '18:00' });
  await s.putRecord('tasks', s.newId(), { ...base, title: '剪辑并发布本周 vlog', category: '自媒体', priority: 'P1', dueDate: today });
  await s.putRecord('tasks', s.newId(), { ...base, title: '取快递', category: '杂事', priority: 'P2', dueDate: today });
  await s.putRecord('habits', s.newId(), { name: '背单词', icon: '📖', target: 1, unit: '次', paused: false, createdAt: today });
  await s.putRecord('anniversaries', s.newId(), { title: '和 ta 在一起纪念日', type: '纪念日', date: '2024-09-24', repeat: 'yearly', progress: 60, note: '' });
});
await sleep(1500);
await p.screenshot({ path: 'shots10/dash.png' });
await p.evaluate(() => { location.hash = '#settings'; });
await sleep(1500);
await p.screenshot({ path: 'shots10/settings.png' });
// 打开一个二级菜单（弹窗）
await p.evaluate(() => { location.hash = '#dates'; });
await sleep(1200);
await p.evaluate(() => { const x = Array.from(document.querySelectorAll('button')).find(y=>y.innerText.includes('新建')); if(x) x.click(); });
await sleep(900);
const info = await p.evaluate(() => {
  const m = document.querySelector('.modal');
  const c = document.querySelector('.card');
  return {
    modalBg: m ? getComputedStyle(m).backgroundColor : null,
    cardBefore: c ? getComputedStyle(c, '::before').content : null,
    topbarBefore: getComputedStyle(document.querySelector('.topbar'), '::before').backgroundImage.slice(0, 40)
  };
});
console.log(JSON.stringify(info));
await p.screenshot({ path: 'shots10/modal.png' });
await b.close();
if (!process.argv[2]) stopIsolatedServer();
console.log('已保存 shots10/');
