// 清掉示例数据 + 以前测试脚本污染进来的记录
// 判据（不是靠标题猜的）：
//   1. createdAt === 示例种子时间 2026-09-21T05:57:06  → seedDemo() 造的
//   2. 示例灵感池的 5 条：createdAt = 种子时间减去各自的偏移
//   3. 测试脚本硬编码的特征值（shot-surfaces / shot-widget / shot 里的）
//   4. 属于被删习惯的打卡记录
import puppeteer from 'puppeteer-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DRY = process.argv.includes('--dry');
const SEED = Date.parse('2026-09-21T05:57:06.000Z');

const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const p = await b.newPage();
await p.goto('http://127.0.0.1:8787', { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(4000);
await p.evaluate(async () => { await window.__schedule.syncNow(); });
await sleep(2500);

const plan = await p.evaluate((seedMs) => {
  const S = window.__schedule;
  const all = (c) => S.list(c);
  const atSeed = (d) => d.createdAt && Math.abs(d.createdAt - seedMs) < 60000;

  const habits = all('habits').filter((h) => atSeed(h) || (h.unit === '次' && h.name === '背单词'));
  const habitIds = habits.map((h) => h.id);
  const logs = all('habitLogs').filter((l) => habitIds.includes(l.habitId));
  const anns = all('anniversaries').filter((a) => atSeed(a) || (a.title === '和 ta 在一起纪念日' && a.date === '2024-09-24'));
  const tasks = all('tasks').filter((t) => atSeed(t) || !t.createdAt);
  const expenses = all('expenses').filter(atSeed);
  // 灵感池这 5 条的 createdAt 是"种子时间减去各自的偏移"，用时间判不了，按原文匹配
  const demoTexts = [
    '地铁上想到一个选题：把「大学四年」做成一条时间轴动画，比 vlog 更有记忆点',
    '食堂阿姨说「多吃点，看你瘦了」——有点想家',
    '「我们总高估一年能做的事，低估十年能做的事。」',
    '论文可以用「先写图表再写正文」的顺序，效率会高很多',
    '图书馆三楼靠窗的位置下午有太阳，适合看书'
  ];
  const ideas = all('inspirations').filter((x) => demoTexts.includes(x.text));
  const life = all('lifeEvents').filter((l) => !l.createdAt || l.title === '拖拽稳定性探针' || atSeed(l));

  const groups = { habits, habitLogs: logs, anniversaries: anns, tasks, expenses, inspirations: ideas, lifeEvents: life };
  const doomed = new Set();
  for (const list of Object.values(groups)) for (const it of list) doomed.add(it.id);
  const keepOther = ['habits','anniversaries','tasks','expenses','inspirations','lifeEvents']
    .flatMap((c) => all(c).filter((x) => !doomed.has(x.id)).map((x) => c + ':' + (x.name || x.title || String(x.text).slice(0, 18))));
  return { ...groups, keepCourses: all('courses').length, keepOther };
}, SEED);

const groups = {
  habits: plan.habits, habitLogs: plan.habitLogs, anniversaries: plan.anniversaries,
  tasks: plan.tasks, expenses: plan.expenses, inspirations: plan.inspirations, lifeEvents: plan.lifeEvents
};
let total = 0;
for (const [c, list] of Object.entries(groups)) {
  total += list.length;
  const names = list.slice(0, 6).map((x) => x.name || x.title || (x.text ? String(x.text).slice(0, 20) : (String(x.habitId || '').slice(0, 8) + ' ' + x.date))).join('、');
  console.log('  ' + c.padEnd(15) + String(list.length).padStart(3) + ' 条  ' + names + (list.length > 6 ? ' …' : ''));
}
console.log('\n合计删除 ' + total + ' 条；课表 ' + plan.keepCourses + ' 条全部保留');
console.log('删除后剩下的非课表记录：' + (plan.keepOther.length ? plan.keepOther.join('、') : '（无）'));

if (DRY) { console.log('\n（--dry：只看不删）'); await b.close(); process.exit(0); }

const n = await p.evaluate(async (g) => {
  const S = window.__schedule;
  let k = 0;
  for (const [c, list] of Object.entries(g)) { for (const it of list) { await S.removeRecord(c, it.id); k++; } }
  await S.syncNow();
  return k;
}, groups);
console.log('\n已删除并同步 ' + n + ' 条');
await sleep(3000);
await b.close();
