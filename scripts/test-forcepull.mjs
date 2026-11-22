// 一次性覆盖：用对方数据覆盖本机（含清掉本机独有） / 用本机数据覆盖对方
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8841);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

// A 设备：这台电脑
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2200);
// 同一次执行里建完就覆盖：自动同步有 1.5 秒延迟，来不及把它推给服务器，
// 这样它确实是"只在电脑上"的那一条
await p.evaluate(async () => {
  const s = window.__schedule;
  await s.putRecord('tasks', 'only-local', { title: '只在电脑上的一条', status: '待办', priority: '中', type: '学习', note: '', createdAt: Date.now(), estimate: 0, repeat: 'none', dueDate: '', dueTime: '' });
  window.__beforeIds = s.list('tasks').map((t) => t.id);
  window.__r1 = await new Promise((r) => setTimeout(async () => r(await s.syncForce('pull')), 30));
});
await sleep(1200);

console.log('\n[1] 用对方数据覆盖本机：本机独有的记录会被清掉');
const before = await p.evaluate(() => window.__beforeIds);
ok('覆盖前本机有这条独有记录', before.includes('only-local'), before);
const r1 = await p.evaluate(() => window.__r1);

const after = await p.evaluate(() => ({ ids: window.__schedule.list('tasks').map((t) => t.id), pending: window.__schedule.pendingCount(), dir: window.__schedule.cfg.syncDir }));
ok('覆盖后这条没了', !after.ids.includes('only-local'), after.ids);
ok('没有残留的待上传记录', after.pending === 0, after.pending);
ok('同步方向没有被改掉', after.dir === 'both', after.dir);
ok('结果里说清拉回几条、清掉几条', /拉回 \d+ 条/.test(r1.message) && /清掉本机独有 1 条/.test(r1.message), r1);

console.log('\n[2] 覆盖之后再来一次普通同步，也不会把它推回去');
await p.evaluate(() => window.__schedule.syncNow());
await sleep(1500);
const pulled = await (await fetch(URL + '/api/pull?since=0&limit=1000')).text();
ok('服务器上也没有这条', !pulled.includes('only-local'), pulled.slice(0, 160));

console.log('\n[3] 用本机数据覆盖对方：另一台设备同步后能看到');
await p.evaluate(async () => {
  await window.__schedule.putRecord('tasks', 'from-pc', { title: '电脑上新加的一条', status: '待办', priority: '高', type: '学习', note: '', createdAt: Date.now(), estimate: 0, repeat: 'none', dueDate: '', dueTime: '' });
});
await sleep(600);
const r2 = await p.evaluate(() => window.__schedule.syncForce('push'));
await sleep(1200);
ok('覆盖对方成功', r2.ok === true, r2);
// 换一个主机名就换了源：127.0.0.1 和 localhost 的 IndexedDB / localStorage 不互通，
// 这样才是"另一台设备"，而不是同一个浏览器里的第二个标签页
const phoneUrl = URL.includes('127.0.0.1') ? URL.replace('127.0.0.1', 'localhost') : URL.replace('localhost', '127.0.0.1');
ok('第二台设备用的是另一个源', phoneUrl !== URL, { URL, phoneUrl });
const phone = await b.newPage();
await phone.setViewport({ width: 420, height: 880 });
await phone.goto(phoneUrl, { waitUntil: 'networkidle2' });
await phone.waitForSelector('.app');
await sleep(2000);
await phone.evaluate(() => window.__schedule.syncNow());
await sleep(1800);
const seen = await phone.evaluate(() => window.__schedule.list('tasks').map((t) => t.title));
ok('另一台设备拉到了电脑刚推的那条', seen.includes('电脑上新加的一条'), seen);

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
try { await b.close(); } catch { /* 忽略 */ }
if (!process.argv[2]) await stopIsolatedServer();
process.exit(fail ? 1 : 0);
