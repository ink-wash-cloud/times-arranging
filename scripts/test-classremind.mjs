// 上课提醒：提前 30 / 10 分钟，连堂课只在课间提醒一次
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8833);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2200);

// 装好数据：明天上午连四节（间隔 5 分钟＝连堂）+ 下午单独一节
const info = await p.evaluate(async () => {
  const s = window.__schedule;
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (x) => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  const d = new Date();
  const wd = ((d.getDay() + 6) % 7) + 1;
  const monday = new Date(d); monday.setDate(d.getDate() - (wd - 1));
  s.cfg.termStart = fmt(monday);
  const t = new Date(d); t.setDate(d.getDate() + 1);
  const twd = ((t.getDay() + 6) % 7) + 1;
  const mk = async (id, name, startTime, endTime) => {
    await s.putRecord('courses', id, {
      name, teacher: '蔡淑云', location: '北2229', className: '计26.1',
      weekday: twd, startTime, endTime, startWeek: 1, endWeek: 18,
      weekParity: 'all', color: '#4f8cff', note: '', createdAt: Date.now()
    });
  };
  await mk('c1', '高等数学', '08:00', '08:45');
  await mk('c2', '线性代数', '08:50', '09:35');
  await mk('c3', '大学英语', '09:40', '10:25');
  await mk('c4', '程序设计', '10:30', '11:15');
  await mk('c5', '体育', '14:00', '14:45');
  return { tomorrow: fmt(t), twd };
});
await sleep(1200);

// 读回排期，把时间压成 HH:mm 方便断言
const plan = () => p.evaluate(() => {
  const pad = (x) => String(x).padStart(2, '0');
  const hhmm = (v) => { const d = new Date(v); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const day = (v) => { const d = new Date(v); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  return window.__schedule.plan.upcoming().map((n) => ({ title: n.title, body: n.body, at: hhmm(n.at), day: day(n.at) }));
});
const isClass = (n) => /分钟后上课|课间提醒/.test(n.title);

console.log('\n[1] 连堂四节只发两条提醒 + 三次课间');
let all = await plan();
let cls = all.filter(isClass);
// 上午连堂四节算一个课段：只有第一节报 30/10，后面三节各一条课间；
// 下午单独一节是另一个课段，自己也有一条 30/10 —— 合计 4 + 3 = 7 条
ok('一共 7 条课程提醒（上午 4 + 课间 3）', cls.length === 7, cls.map((c) => c.title + '@' + c.at));
ok('30 分钟提醒只给每个课段的第一节', cls.filter((c) => c.title.includes('30 分钟')).length === 2
  && cls.some((c) => c.title.includes('30 分钟') && c.title.includes('高等数学') && c.at === '07:30')
  && cls.some((c) => c.title.includes('30 分钟') && c.title.includes('体育') && c.at === '13:30'), cls.filter((c) => c.title.includes('30 分钟')).map((c) => c.at + ' ' + c.title));
ok('连堂的第二三节不会被单独提前提醒', !cls.some((c) => /分钟后上课/.test(c.title) && /线性代数|大学英语|程序设计/.test(c.title)), cls.map((c) => c.title));
ok('10 分钟提醒同样只给每段第一节', cls.filter((c) => c.title.includes('10 分钟')).length === 2
  && cls.some((c) => c.title.includes('10 分钟') && c.title.includes('高等数学') && c.at === '07:50'), cls.filter((c) => c.title.includes('10 分钟')).map((c) => c.at));
ok('后面三节各自一条课间提醒', cls.filter((c) => c.title.includes('课间')).length === 3, cls.filter((c) => c.title.includes('课间')).map((c) => c.title));
ok('课间 5 分钟时在上一节下课那刻就提醒', cls.some((c) => c.title.includes('线性代数') && c.at === '08:45'), cls.filter((c) => c.title.includes('课间')).map((c) => c.at));
ok('课间提醒正文写明上一节几点下课', cls.some((c) => c.title.includes('线性代数') && c.body.includes('上一节 08:45 下课')), cls.filter((c) => c.title.includes('课间')).map((c) => c.body));
ok('下午单独一节照样有自己的 30/10', cls.filter((c) => c.title.includes('体育')).length === 2, cls.filter((c) => c.title.includes('体育')).map((c) => c.at + ' ' + c.title));
ok('提醒都排在明天', cls.every((c) => c.day === info.tomorrow), cls.map((c) => c.day));

console.log('\n[2] 关掉「连堂只提醒一次」就逐节都提醒');
await p.evaluate(() => { window.__schedule.cfg.classMerge = false; });
all = await plan();
cls = all.filter(isClass);
ok('五节各两条 = 10 条', cls.length === 10, cls.length);
ok('不再有课间提醒', cls.filter((c) => c.title.includes('课间')).length === 0);
await p.evaluate(() => { window.__schedule.cfg.classMerge = true; });

console.log('\n[3] 这次停课的那节不提醒');
await p.evaluate(async (day) => {
  await window.__schedule.putRecord('courseChanges', 'c1:' + day, {
    courseId: 'c1', date: day, kind: 'cancel', createdAt: Date.now()
  });
}, info.tomorrow);
await sleep(700);
all = await plan();
cls = all.filter(isClass);
ok('停掉第一节后不再提它', !cls.some((c) => c.title.includes('高等数学')), cls.map((c) => c.title));
ok('剩下的课段重新算：线性代数拿到 30/10 各一条', cls.filter((c) => c.title.includes('线性代数')).length >= 2, cls.filter((c) => c.title.includes('线性代数')).map((c) => c.at + ' ' + c.title));
await p.evaluate(async (day) => { await window.__schedule.removeRecord('courseChanges', 'c1:' + day); }, info.tomorrow);
await sleep(700);

console.log('\n[4] 单个开关分别管住 30 分钟 / 10 分钟 / 全部');
await p.evaluate(() => { window.__schedule.cfg.classLead30 = false; });
cls = (await plan()).filter(isClass);
ok('关掉 30 分钟后只剩 10 分钟与课间', !cls.some((c) => c.title.includes('30 分钟')) && cls.some((c) => c.title.includes('10 分钟')), cls.map((c) => c.title));
await p.evaluate(() => { window.__schedule.cfg.classLead30 = true; window.__schedule.cfg.classLead10 = false; });
cls = (await plan()).filter(isClass);
ok('关掉 10 分钟后只剩 30 分钟与课间', !cls.some((c) => c.title.includes('10 分钟')) && cls.some((c) => c.title.includes('30 分钟')), cls.map((c) => c.title));
await p.evaluate(() => { window.__schedule.cfg.classLead10 = true; window.__schedule.cfg.classNotif = false; });
cls = (await plan()).filter(isClass);
ok('总开关关掉后一条课程提醒都没有', cls.length === 0, cls);
await p.evaluate(() => { window.__schedule.cfg.classNotif = true; });

console.log('\n[5] 课表设置里的开关写进配置、刷新后还在');
await p.evaluate(() => { location.hash = '#tt'; });
await sleep(1600);
const hasSettings = await p.evaluate(() => Array.from(document.querySelectorAll('.tt-wrap button, .tt-head-wrap button, button')).some((x) => /课表设置|提醒设置/.test(x.innerText || '')));
ok('课表页有设置入口', hasSettings, await p.evaluate(() => Array.from(document.querySelectorAll('button')).map((x) => (x.innerText || '').trim()).filter((t) => t && t.length < 12).slice(0, 30)));
const clicked = await p.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((x) => /课表设置|提醒设置/.test(x.innerText || ''));
  if (!btn) return false;
  btn.click(); return true;
});
await sleep(800);
// 课表设置现在是二级页（.subpage），不再是弹窗
const modal = clicked ? await p.evaluate(() => {
  const el = document.querySelector('.subpage') || document.querySelector('.modal');
  return el ? el.innerText.replace(/\s+/g, ' ') : '';
}) : '';
ok('设置二级页里有课程提醒相关开关', /上课提醒|课程提醒/.test(modal), modal.slice(0, 200));

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
try { await b.close(); } catch { /* 忽略 */ }
if (!process.argv[2]) await stopIsolatedServer();
process.exit(fail ? 1 : 0);
