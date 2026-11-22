// 版本更新弹窗专项。
//
// 规则：改了版本号、第一次打开应用时必须把更新内容告诉用户。
// 第一次装（本机没记过任何版本）不弹 —— 对新人来说没有「更新」可言。
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8815);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);

const notesModal = () => p.evaluate(() => {
  const m = document.querySelector('.modal');
  if (!m) return null;
  const title = (m.querySelector('h3') || { innerText: '' }).innerText.trim();
  if (!title.includes('已更新到')) return null;
  return { title: title, text: m.innerText.replace(/\s+/g, ' '), items: m.querySelectorAll('li').length };
});
const seen = () => p.evaluate(() => localStorage.getItem('seenVersion'));

console.log('\n[1] 全新安装：不该弹更新弹窗');
await p.evaluate(() => { localStorage.removeItem('seenVersion'); });
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);
ok('第一次装不弹更新内容', (await notesModal()) === null, await notesModal());
const v0 = await seen();
console.log('   记下的版本: ' + v0);
ok('但会把当前版本记下来（下次升级才有对比）', !!v0 && /^\d+\.\d+\.\d+$/.test(v0), v0);

console.log('\n[2] 从老版本升上来：应该弹，并且列出改了什么');
await p.evaluate(() => { localStorage.setItem('seenVersion', '1.0.7'); });
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2800);
const m = await notesModal();
console.log('   弹窗标题: ' + (m ? m.title : '(没弹)'));
if (m) console.log('   内容前 160 字: ' + m.text.slice(0, 160));
ok('弹出了更新弹窗', !!m, m);
ok('标题写明更新到哪个版本', !!m && m.title.includes(v0), m && m.title);
ok('列出了更新条目', !!m && m.items >= 3, m && m.items);
ok('提到了这次修的两个 bug（预算 / 换网络）', !!m && m.text.includes('预算') && m.text.includes('Wi-Fi'), m && m.text.slice(0, 120));
ok('更新完就把版本记下了', (await seen()) === v0, await seen());

console.log('\n[3] 点「知道了」关掉，刷新不再弹');
await p.evaluate(() => {
  const b2 = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '知道了');
  if (b2) b2.click();
});
await sleep(700);
ok('弹窗关掉了', (await notesModal()) === null, null);
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);
ok('同一个版本不会反复弹', (await notesModal()) === null, await notesModal());

console.log('\n[4] 设置里能随时查更新日志');
await p.evaluate(() => { location.hash = '#settings'; });
await sleep(1200);
// v1.4.1：设置根页只剩四组列表，更新日志在「使用说明与更新日志」二级页。
// 这里点真实的行（而不是直接调调试钩子），顺便验证列表导航是通的。
const entered = await p.evaluate(() => {
  const row = document.querySelector('[data-testid="set-row-about"]');
  if (!row) return false;
  row.click();
  return true;
});
await sleep(700);
ok('从设置列表点进「使用说明与更新日志」', entered, entered);
const hasBtn = await p.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.card')).find((x) => x.innerText.includes('关于'));
  return !!(card && Array.from(card.querySelectorAll('button')).find((x) => x.innerText.includes('更新日志')));
});
ok('关于卡片里有「更新日志」按钮', hasBtn, hasBtn);
await p.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.card')).find((x) => x.innerText.includes('关于'));
  const b2 = Array.from(card.querySelectorAll('button')).find((x) => x.innerText.includes('更新日志'));
  b2.click();
});
await sleep(900);
const log = await p.evaluate(() => {
  const m = document.querySelector('.modal');
  if (!m) return null;
  return { title: (m.querySelector('h3') || { innerText: '' }).innerText.trim(), versions: m.innerText.match(/v\d+\.\d+\.\d+/g) || [] };
});
console.log('   日志弹窗: ' + JSON.stringify(log && log.versions && log.versions.slice(0, 5)));
ok('打开的是更新日志', !!log && log.title === '更新日志', log && log.title);
ok('列出了多个历史版本', !!log && log.versions.length >= 5, log && log.versions.length);

await b.close();
if (!process.argv[2]) stopIsolatedServer();
console.log('\n========================================');
console.log('  更新弹窗验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
