// 手机桌面小组件：显示哪些块、点一下代表什么操作
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8808);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2200);

await p.evaluate(async () => {
  const s = window.__schedule;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const wd = ((d.getDay() + 6) % 7) + 1;
  const monday = new Date(d); monday.setDate(d.getDate() - (wd - 1));
  s.cfg.termStart = monday.getFullYear() + '-' + pad(monday.getMonth() + 1) + '-' + pad(monday.getDate());
  s.cfg.widgetBlocks = ['tasks', 'habits', 'courses'];
  await s.putRecord('tasks', 'w-t1', { title: '交作业', category: '学习', dueDate: today, dueTime: null, priority: 'P2', status: '未开始', estimateMinutes: 30, repeat: '不重复', note: '', anniversaryId: null, completedAt: null, createdAt: Date.now() });
  await s.putRecord('tasks', 'w-t2', { title: '买牛奶', category: '生活', dueDate: today, dueTime: null, priority: 'P2', status: '未开始', estimateMinutes: 0, repeat: '不重复', note: '', anniversaryId: null, completedAt: null, createdAt: Date.now() });
  await s.putRecord('tasks', 'w-done', { title: '已经做完的', category: '学习', dueDate: today, dueTime: null, priority: 'P2', status: '已完成', estimateMinutes: 0, repeat: '不重复', note: '', anniversaryId: null, completedAt: Date.now(), createdAt: Date.now() });
  await s.putRecord('habits', 'w-h1', { name: '背单词', icon: '📖', color: '#6d8bff', paused: false, note: '', dailyMin: 20, unit: '个', createdAt: Date.now() });
  await s.putRecord('courses', 'w-c1', { name: '高等数学', teacher: '蔡', location: '北2229', weekday: wd, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 18, weekParity: 'all', color: '#4f8cff', note: '', createdAt: Date.now() });
  await s.putRecord('anniversaries', 'w-a1', { title: '室友生日', icon: '🎂', date: today, type: '每年', remindDays: 3, note: '', createdAt: Date.now() });
  await s.putRecord('lifeEvents', 'w-l1', { title: '给家里打电话', icon: '📞', lastDate: today, cycleDays: 3, note: '', createdAt: Date.now() });
  await s.putRecord('budgets', d.getFullYear() + '-' + pad(d.getMonth() + 1), { amount: 1000 });
  await s.putRecord('expenses', 'w-e1', { title: '食堂', amount: 26, category: '餐饮', date: today, createdAt: Date.now() });
});
await sleep(1400);

const payload = async () => JSON.parse(await p.evaluate(() => window.__shixuWidget.payload()));

console.log('\n[1] 默认三块：待办 + 习惯 + 课程');
let s = await payload();
const kinds = s.items.map((i) => i.kind);
ok('有待办行', kinds.includes('task'), kinds);
ok('有习惯行', kinds.includes('habit'), kinds);
ok('有课程行', kinds.includes('course'), kinds);
ok('已完成的待办不出现', !s.items.some((i) => i.text === '已经做完的'), s.items.map((i) => i.text));
ok('待办行带 op=task-done', s.items.filter((i) => i.kind === 'task').every((i) => i.op === 'task-done'), s.items[0]);
ok('习惯行带 op=habit-check', s.items.filter((i) => i.kind === 'habit').every((i) => i.op === 'habit-check'), s.items.find((i) => i.kind === 'habit'));
ok('课程行不带 op（点了只开应用）', s.items.filter((i) => i.kind === 'course').every((i) => !i.op), s.items.find((i) => i.kind === 'course'));
ok('副标题里报了数量', /待办 2/.test(s.sub) && /习惯 1/.test(s.sub) && /课 1/.test(s.sub), s.sub);

console.log('\n[2] 勾选更多块');
await p.evaluate(() => { window.__schedule.cfg.widgetBlocks = ['tasks', 'habits', 'courses', 'anniversary', 'budget', 'life']; });
s = await payload();
const texts = s.items.map((i) => i.text);
ok('纪念日进来了', texts.some((t) => /室友生日/.test(t)), texts);
ok('预算进来了', texts.some((t) => /本月已花/.test(t)), texts);
ok('最多只给原生 6 行', s.items.length <= 6, s.items.length);
await p.evaluate(() => { window.__schedule.cfg.widgetBlocks = ['life']; });
s = await payload();
ok('人生最新一次能单独显示', s.items.some((i) => /给家里打电话/.test(i.text)), s.items.map((i) => i.text));

console.log('\n[3] 只留习惯');
await p.evaluate(() => { window.__schedule.cfg.widgetBlocks = ['habits']; });
s = await payload();
ok('只剩习惯行', s.items.length === 1 && s.items[0].kind === 'habit', s.items.map((i) => i.kind));
ok('副标题只剩习惯', /^习惯 1/.test(s.sub), s.sub);

console.log('\n[4] 打完卡的习惯不再出现');
await p.evaluate(async () => {
  const s = window.__schedule;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  await s.putRecord('habitLogs', 'w-h1:' + today, { habitId: 'w-h1', date: today, amount: 20, at: Date.now() });
});
await sleep(900);
s = await payload();
ok('打卡过的习惯从桌面消失', !s.items.some((i) => i.kind === 'habit'), s.items);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
stopIsolatedServer();
process.exit(fail ? 1 : 0);
