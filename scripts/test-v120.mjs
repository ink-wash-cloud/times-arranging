// v1.2.0 新功能专项：周次记忆 / 校正周次 / 节次时间 / 长按拖动 / 课程备注 / 待办提醒 / 进度档位
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8819);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2200);

const setVal = (sel, v) => p.evaluate((sel, v) => {
  const el = document.querySelector(sel);
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, sel, v);
const clickText = (text, scope) => p.evaluate((text, scope) => {
  const root = scope ? document.querySelector(scope) : document;
  const btn = Array.from(root.querySelectorAll('button')).find((x) => x.innerText.trim() === text);
  if (!btn) throw new Error('找不到按钮: ' + text);
  btn.click();
}, text, scope || null);
const bodyText = () => p.evaluate(() => (document.querySelector('.content-inner') || document.body).innerText.replace(/\s+/g, ' '));
// 校正周次 / 节次时间现在是二级页（.subpage），其它弹窗仍是 .modal
const panelText = () => p.evaluate(() => {
  const el = document.querySelector('.subpage') || document.querySelector('.modal');
  return el ? el.innerText.replace(/\s+/g, ' ') : '';
});

// 造数据：本周一的课，开学第一周 = 本周，于是"本周 = 第 1 教学周"
const info = await p.evaluate(async () => {
  const s = window.__schedule;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (x) => x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate());
  const wd = ((d.getDay() + 6) % 7) + 1;
  const monday = new Date(d); monday.setDate(d.getDate() - (wd - 1));
  const tomorrow = new Date(d); tomorrow.setDate(d.getDate() + 1);
  const minus = new Date(monday); minus.setDate(monday.getDate() - 14);
  s.cfg.termStart = fmt(monday);
  await s.putRecord('courses', 'c-math', {
    name: '高等数学', teacher: '蔡淑云', location: '北2229', className: '计26.1',
    weekday: wd, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 18,
    weekParity: 'all', color: '#4f8cff', note: '', createdAt: Date.now()
  });
  return { today: fmt(d), tomorrow: fmt(tomorrow), wd, monday: fmt(monday), minus14: fmt(minus) };
});
await sleep(700);
await p.evaluate(() => { location.hash = '#tt'; });
await sleep(1400);

console.log('\n[1] 校正周次：把本周告诉应用是第几周');
ok('默认显示第 1 教学周', /当前第 1 教学周/.test(await bodyText()), (await bodyText()).slice(0, 120));
await clickText('校正周次');
await sleep(600);
ok('打开「校正周次」二级页，不再盖弹窗', /本周是第几周/.test(await panelText()) && (await p.$('.modal')) === null, await panelText());
await setVal('.subpage input[type=number]', '3');
await sleep(300);
const hintTxt = await panelText();
ok('事先告诉你开学第一周周一会是哪天', hintTxt.includes(info.minus14), hintTxt.slice(0, 160));
await p.click('.subpage-right button');
await sleep(900);
const cal = await p.evaluate(() => ({ termStart: window.__schedule.cfg.termStart, text: document.querySelector('.content-inner').innerText.replace(/\s+/g, ' ') }));
ok('开学第一周周一被回推了 14 天', cal.termStart === info.minus14, cal.termStart);
ok('页面上变成第 3 教学周', /当前第 3 教学周/.test(cal.text), cal.text.slice(0, 130));

console.log('\n[2] 切换周次：选过就记住，下次打开自动回去');
await clickText('下一周 →');
await sleep(800);
const w4 = await p.evaluate(() => ({ ...window.__schedule.cfg, text: document.querySelector('.content-inner').innerText.replace(/\s+/g, ' ') }));
ok('切到了第 4 周', /正在看第 4 周/.test(w4.text), w4.text.slice(0, 130));
ok('选过的周次记进了配置', w4.ttWeek === 4 && w4.ttWeekMode === 'fixed', [w4.ttWeek, w4.ttWeekMode]);
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2600);
await p.evaluate(() => { if (location.hash !== '#tt') location.hash = '#tt'; });
await sleep(1600);
const afterReload = await p.evaluate(() => ({ ttWeek: window.__schedule.cfg.ttWeek, mode: window.__schedule.cfg.ttWeekMode, text: document.querySelector('.content-inner').innerText.replace(/\s+/g, ' ') }));
ok('重新打开还在第 4 周，不用再手动选', /正在看第 4 周/.test(afterReload.text), afterReload.text.slice(0, 140));
ok('配置也跟着回来了', afterReload.ttWeek === 4 && afterReload.mode === 'fixed', [afterReload.ttWeek, afterReload.mode]);

console.log('\n[3] 回到本周：选「本周」就跟着日期走');
await clickText('回到本周（第 3 周）');
await sleep(800);
const backNow = await p.evaluate(() => ({ mode: window.__schedule.cfg.ttWeekMode, week: window.__schedule.cfg.ttWeek, text: document.querySelector('.content-inner').innerText.replace(/\s+/g, ' ') }));
ok('不再锁在某一周（跟着时间自动推进）', backNow.mode === 'follow', backNow.mode);
ok('回到当前教学周', !/正在看第/.test(backNow.text) && /当前第 3 教学周/.test(backNow.text), backNow.text.slice(0, 130));

console.log('\n[4] 节次时间：自定义每节几点到几点');
await clickText('节次时间');
await sleep(700);
const peRows = await p.$$eval('.pe-row', (els) => els.length);
ok('列出了所有节次', peRows >= 6, peRows);
await p.evaluate(() => {
  const row = document.querySelector('.pe-row');
  const input = row.querySelectorAll('input[type=time]')[0];
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '07:30');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(300);
await p.click('.subpage-right button');
await sleep(900);
const pe = await p.evaluate(() => ({
  text: window.__schedule.cfg.periodsText,
  axis: (document.querySelector('.tt-time') || { innerText: '' }).innerText.replace(/\s+/g, ' ')
}));
ok('保存进了配置', /^1 07:30-08:45/.test(pe.text), pe.text.split('\n')[0]);
ok('课表左侧时间轴立刻跟着变', pe.axis.includes('07:30'), pe.axis);
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2400);
await p.evaluate(() => { if (location.hash !== '#tt') location.hash = '#tt'; });
await sleep(1500);
ok('重开之后节次时间还是改过的', /^1 07:30-08:45/.test(await p.evaluate(() => window.__schedule.cfg.periodsText)), await p.evaluate(() => window.__schedule.cfg.periodsText.split('\n')[0]));

console.log('\n[5] 长按拖动：拖到别的天 = 只改这一次');
// 目标日子以"页面上真实存在的周"为准：周日跑测试时"明天"已经落到下一周，
// 当前周表里根本没有那一天（旧写法在这里 target undefined 直接崩，用例每到周日就红）。
const geo1 = await p.evaluate(() => {
  const course = document.querySelector('.tt-course');
  const r0 = course.getBoundingClientRect();
  const courseDate = course.dataset.date || '';
  const all = Array.from(document.querySelectorAll('.tt-cell'));
  const dates = Array.from(new Set(all.map((c) => c.dataset.date).filter(Boolean)));
  const otherDay = dates.find((d) => d !== courseDate) || courseDate;
  const cells = all.filter((c) => c.dataset.date === otherDay);
  const target = cells[Math.min(2, cells.length - 1)];
  const r1 = target.getBoundingClientRect();
  return {
    x0: Math.round(r0.left + r0.width / 2), y0: Math.round(r0.top + 12),
    x1: Math.round(r1.left + r1.width / 2), y1: Math.round(r1.top + r1.height / 2),
    start: target.dataset.start, date: target.dataset.date
  };
});
await p.mouse.move(geo1.x0, geo1.y0);
await p.mouse.down();
await sleep(700);
const armed = await p.evaluate(() => ({ ghost: !!document.querySelector('.tt-ghost'), dragging: !!document.querySelector('.tt-course.dragging') }));
ok('按住约半秒就进入拖动状态（幽灵块跟手）', armed.ghost && armed.dragging, armed);
await p.mouse.move(geo1.x1, geo1.y1, { steps: 10 });
await sleep(200);
const dropHi = await p.evaluate(() => !!document.querySelector('.tt-cell.drop-target'));
ok('落点格子会高亮', dropHi, dropHi);
await p.mouse.up();
await sleep(1000);
const moved = await p.evaluate(() => {
  const s = window.__schedule;
  const ch = s.list('courseChanges');
  return { n: ch.length, kind: ch[0] ? ch[0].kind : '', to: ch[0] ? ch[0].toDate : '', start: ch[0] ? ch[0].startTime : '', modal: !!document.querySelector('.modal'), courseTop: (document.querySelector('.tt-course') || {}).style ? document.querySelector('.tt-course').style.top : '' };
});
ok('记成了一次「调课」而不是改整学期', moved.n === 1 && moved.kind === 'move', moved);
ok('目标是拖到的那一天 / 那一节', moved.to === geo1.date && moved.start === geo1.start, [moved.to, moved.start, geo1]);
ok('拖完不会误弹出操作面板', !moved.modal, moved.modal);

console.log('\n[6] 长按拖动：同一天换个节次');
await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.tt-change-chip button')).find((x) => x.innerText.includes('撤销'));
  if (b) b.click();
});
await sleep(900);
const geo2 = await p.evaluate((today) => {
  const course = document.querySelector('.tt-course');
  const r0 = course.getBoundingClientRect();
  const cells = Array.from(document.querySelectorAll('.tt-cell')).filter((c) => c.dataset.date === today);
  const target = cells[3];
  const r1 = target.getBoundingClientRect();
  return {
    x0: Math.round(r0.left + r0.width / 2), y0: Math.round(r0.top + 12),
    x1: Math.round(r1.left + r1.width / 2), y1: Math.round(r1.top + r1.height / 2),
    start: target.dataset.start, date: target.dataset.date
  };
}, info.today);
await p.mouse.move(geo2.x0, geo2.y0);
await p.mouse.down();
await sleep(700);
await p.mouse.move(geo2.x1, geo2.y1, { steps: 8 });
await sleep(150);
await p.mouse.up();
await sleep(900);
const shifted = await p.evaluate(() => {
  const s = window.__schedule;
  const ch = s.list('courseChanges');
  const day = Array.from(document.querySelectorAll('.day-course')).map((e) => e.innerText.replace(/\s+/g, ' '));
  const strip = document.querySelector('.tt-changes');
  return { kind: ch[0] ? ch[0].kind : '', start: ch[0] ? ch[0].startTime : '', day, strip: strip ? strip.innerText.replace(/\s+/g, ' ') : '' };
});
ok('同一天拖动记成「调整时间」', shifted.kind === 'edit' && shifted.start === geo2.start, [shifted.kind, shifted.start, geo2.start]);
ok('本周调整条里能看到这一条', /调整/.test(shifted.strip), shifted.strip);
ok('今日课程里的时间也跟着变了', shifted.day.some((t) => t.includes(geo2.start)), shifted.day);

console.log('\n[6b] 拖到屏幕下边缘会自动滚动，够得着下面几节');
await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.tt-change-chip button')).find((x) => x.innerText.includes('撤销'));
  if (b) b.click();
});
await sleep(900);
const geo3 = await p.evaluate((today) => {
  const course = document.querySelector('.tt-course');
  const r0 = course.getBoundingClientRect();
  const box = document.querySelector('.content');
  const rb = box.getBoundingClientRect();
  return {
    x0: Math.round(r0.left + r0.width / 2), y0: Math.round(r0.top + 12),
    x1: Math.round(r0.left + r0.width / 2), y1: Math.round(rb.bottom - 18),
    scrollTop: box.scrollTop,
    hidden: Array.from(document.querySelectorAll('.tt-cell')).filter((c) => c.dataset.date === today && c.getBoundingClientRect().top > window.innerHeight).length
  };
}, info.today);
ok('拖之前下面几节确实在屏幕外', geo3.hidden >= 2, geo3.hidden);
await p.mouse.move(geo3.x0, geo3.y0);
await p.mouse.down();
await sleep(700);
await p.mouse.move(geo3.x1, geo3.y1, { steps: 6 });
await sleep(1000);
const scrolled = await p.evaluate(() => ({
  scrollTop: document.querySelector('.content').scrollTop,
  drop: (document.querySelector('.tt-cell.drop-target') || { dataset: {} }).dataset.start || '',
  ghost: !!document.querySelector('.tt-ghost')
}));
ok('手指压在下边缘时页面自己往下滚', scrolled.scrollTop > geo3.scrollTop + 40, [geo3.scrollTop, scrolled.scrollTop]);
ok('幽灵块还在手上（没被滚动甩掉）', scrolled.ghost, scrolled.ghost);
ok('落点高亮跟到了滚动后露出来的格子', !!scrolled.drop, scrolled.drop);
await p.mouse.up();
await sleep(1000);
const dropResult = await p.evaluate(() => {
  const ch = window.__schedule.list('courseChanges');
  return { kind: ch[0] ? ch[0].kind : '', start: ch[0] ? ch[0].startTime : '' };
});
ok('松手就落到自动滚出来的那一节（不是原来那节）', dropResult.kind === 'edit' && dropResult.start === scrolled.drop && dropResult.start !== '08:00', [dropResult, scrolled.drop]);
await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.tt-change-chip button')).find((x) => x.innerText.includes('撤销'));
  if (b) b.click();
});
await sleep(900);

console.log('\n[7] 课程备注：写在面板里，整学期生效');
await p.evaluate(() => document.querySelector('.tt-course').click());
await sleep(700);
ok('面板里有「这门课的备注」', /这门课的备注/.test(await p.$eval('.modal', (e) => e.innerText)), await p.$eval('.modal', (e) => e.innerText.replace(/\s+/g, ' ').slice(0, 80)));
await p.evaluate(() => {
  const input = document.querySelector('.modal input[placeholder^="例如：带计算器"]');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '带计算器');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(400);
await clickText('保存', '.modal');
await sleep(900);
const noteSt = await p.evaluate(() => {
  const s = window.__schedule;
  const c = s.list('courses').find((x) => x.id === 'c-math');
  return { note: c ? c.note : '', mark: document.querySelectorAll('.tt-note').length };
});
ok('备注存进了课程本身', noteSt.note === '带计算器', noteSt.note);
ok('课表格子上多了 📝 标记', noteSt.mark === 1, noteSt.mark);
await p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => /关闭|✕/.test(x.innerText));
  if (b) b.click();
});
await sleep(500);

console.log('\n[8] 待办提醒：自己定的时间到点推通知');
await p.evaluate(async (today) => {
  const s = window.__schedule;
  await s.putRecord('tasks', 't-remind', {
    title: '交作业', category: '学习', dueDate: today, dueTime: '23:00',
    remindAt: today + 'T21:30', priority: 'P1', status: '未开始',
    estimateMinutes: 30, repeat: '不重复', note: '',
    anniversaryId: null, completedAt: null, createdAt: Date.now()
  });
}, info.today);
await sleep(600);
await p.evaluate(() => { location.hash = '#tasks'; });
await sleep(1300);
const remindRow = await p.evaluate(() => {
  const el = document.querySelector('.t-remind');
  return { text: el ? el.innerText : '', all: Array.from(document.querySelectorAll('.task-item')).map((x) => x.innerText.replace(/\s+/g, ' ')) };
});
ok('列表里显示提醒时间（🔔 今天 21:30）', /🔔/.test(remindRow.text) && /21:30/.test(remindRow.text), remindRow.text);
await p.evaluate(() => document.querySelector('.task-item').click());
await sleep(700);
const remindForm = await p.evaluate(() => {
  const m = document.querySelector('.modal');
  const dt = m.querySelector('input[type=datetime-local]');
  return {
    dt: dt ? dt.value : '',
    chips: Array.from(m.querySelectorAll('.chip')).map((x) => x.innerText.trim()),
    text: m.innerText.replace(/\s+/g, ' ')
  };
});
ok('编辑框里带着原来的提醒时间', remindForm.dt === info.today + 'T21:30', remindForm.dt);
ok('有四个快捷档位', ['10 分钟后', '1 小时后', '今晚 20:00', '明早 08:00'].every((x) => remindForm.chips.includes(x)), remindForm.chips.slice(0, 10));
await clickText('10 分钟后', '.modal');
await sleep(600);
const presetVal = await p.$eval('.modal input[type=datetime-local]', (e) => e.value);
ok('点快捷档位就填好了时间', /T/.test(presetVal) && presetVal !== info.today + 'T21:30', presetVal);
await clickText('保存', '.modal');
await sleep(900);
const saved = await p.evaluate(() => {
  const t = window.__schedule.list('tasks').find((x) => x.id === 't-remind');
  return t ? t.remindAt : '';
});
ok('提醒时间存下来了', saved === presetVal, [saved, presetVal]);

console.log('\n[9] 准备进度：快捷档位 + 任意数值');
await p.evaluate(async (today) => {
  const s = window.__schedule;
  await s.putRecord('anniversaries', 'a-1', {
    title: '室友生日', type: '生日', icon: '🎂', date: today, repeatYearly: true,
    progress: 30, note: '', createdAt: Date.now()
  });
}, info.today);
await sleep(600);
await p.evaluate(() => { location.hash = '#dates'; });
await sleep(1300);
const prog = await p.evaluate(() => {
  const hero = document.querySelector('.card.hero');
  const chips = Array.from(hero.querySelectorAll('button.chip')).map((x) => x.innerText.trim());
  return { chips, slider: !!hero.querySelector('input.range'), val: hero.querySelector('input.range') ? hero.querySelector('input.range').value : '' };
});
ok('有 %1 %2 %3 %5 %10 %25 六个快捷档', ['+1%', '+2%', '+3%', '+5%', '+10%', '+25%'].every((x) => prog.chips.includes(x)), prog.chips);
ok('有可拖动的进度滑杆，且值等于当前进度', prog.slider && prog.val === '30', prog.val);
await clickText('+25%', '.card.hero');
await sleep(900);
const after25 = await p.evaluate(() => {
  const a = window.__schedule.list('anniversaries').find((x) => x.id === 'a-1');
  return { p: a ? a.progress : -1, ring: (document.querySelector('.card.hero .ring b') || { innerText: '' }).innerText.replace(/\s+/g, '') };
});
ok('点 +25% 立刻累加到 55%', after25.p === 55, after25.p);
ok('环形进度也跟着变', after25.ring.includes('55'), after25.ring);
await clickText('自定义…', '.card.hero');
await sleep(700);
await setVal('.modal input[type=number]', '7');
await sleep(300);
await clickText('保存', '.modal-foot');
await sleep(900);
const afterCustom = await p.evaluate(() => {
  const a = window.__schedule.list('anniversaries').find((x) => x.id === 'a-1');
  return a ? a.progress : -1;
});
ok('任意数值（7%）也能精确设置', afterCustom === 7, afterCustom);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
stopIsolatedServer();
if (fail) process.exitCode = 1;
