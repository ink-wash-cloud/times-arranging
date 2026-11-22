// 日程表（v1.6.0 线 A）专项回归：日期、缩放、详情、编辑、长按、拖动、增删撤销、
// 课表叠加开关、CSV/ICS 导出、手机窄屏、console 无报错。
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8880;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
};
const pad = (n) => String(n).padStart(2, '0');
const addDays = (s, n) => {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};
const parseRgb = (s) => {
  const m = String(s || '').match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
  return p.length >= 3 ? { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 } : null;
};
const channelLum = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const relLum = (c) => 0.2126 * channelLum(c[0]) + 0.7152 * channelLum(c[1]) + 0.0722 * channelLum(c[2]);
const contrastRatio = (fg, bg) => {
  const f = fg.a < 1
    ? [fg.r * fg.a + bg[0] * (1 - fg.a), fg.g * fg.a + bg[1] * (1 - fg.a), fg.b * fg.a + bg[2] * (1 - fg.a)]
    : [fg.r, fg.g, fg.b];
  const L1 = relLum(f), L2 = relLum(bg);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
};

const base = process.argv[2] || await startIsolatedServer(PORT);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
});
const page = await browser.newPage();
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.setViewport({ width: 1440, height: 1000 });
await page.goto(base, { waitUntil: 'networkidle2' });
await page.waitForSelector('.app');
await sleep(2200);

// 以浏览器本地日期为准生成数据，避免测试机和 Node 时区不一致。
const today = await page.evaluate(() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
});
const yesterday = addDays(today, -1);
const twoDaysAgo = addDays(today, -2);
const tomorrow = addDays(today, 1);
const termStart = addDays(today, -7);

console.log('\n[0] 造数据：3 段重叠/相邻日程 + 当天 1 节课');
await page.evaluate(async ({ today, termStart }) => {
  const S = window.__schedule;
  S.cfg.termStart = termStart;
  const wd = ((new Date(today + 'T00:00:00').getDay() + 6) % 7) + 1;
  await S.putRecord('courses', 'c1', {
    name: '高等数学', weekday: wd, startTime: '09:00', endTime: '09:45',
    startWeek: 1, endWeek: 16, weekParity: 'all', weeks: [],
    location: '北2229', teacher: '蔡淑云', color: '#8aa9e8', note: '',
    createdAt: Date.now() - 5000
  });
  await S.putRecord('schedule', 'a1', {
    title: '写需求文档', date: today, start: 9 * 3600 + 40 * 60 + 30,
    end: 10 * 3600 + 20 * 60 + 30, color: '#8aa9e8', category: '学习',
    note: '写「长远目标」那一段，顺手把预算 bug 的复现步骤记下来', done: false,
    createdAt: Date.now() - 4000
  });
  await S.putRecord('schedule', 'b1', {
    title: '重叠块', date: today, start: 9 * 3600 + 50 * 60,
    end: 10 * 3600 + 10 * 60, color: '#e9a08c', category: '', note: '',
    done: false, createdAt: Date.now() - 3000
  });
  await S.putRecord('schedule', 'c1block', {
    title: '午饭', date: today, start: 14 * 3600, end: 14 * 3600 + 30 * 60,
    color: '#b79ae0', category: '杂事', note: '', done: false,
    createdAt: Date.now() - 2000
  });
}, { today, termStart });
await sleep(500);
await page.evaluate(() => { location.hash = '#schedule'; });
await sleep(1800);
await page.waitForSelector('.sch-page');

const text = (sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim());
const exists = (sel) => page.$(sel).then((el) => !!el);
const blocks = () => page.evaluate(() => window.__schedule.list('schedule'));
const getBlock = async (id) => (await blocks()).find((b) => b.id === id) || null;
const setField = (k, v) => page.evaluate(({ k, v }) => {
  const el = document.querySelector('[data-k="' + k + '"]');
  if (!el) throw new Error('field not found: ' + k);
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, { k, v });
const clickK = async (k) => {
  const el = await page.$('[data-k="' + k + '"]');
  if (!el) throw new Error('button not found: ' + k);
  await el.click();
};
const toggleOverlay = () => page.evaluate(() => {
  const el = document.querySelector('[data-k="sch-overlay"]');
  if (el) el.click();
});
const modalTitle = () => page.evaluate(() => {
  const m = document.querySelector('.modal');
  return m ? (m.querySelector('h3') || {}).innerText.trim() : null;
});
const clickModalText = (label) => page.evaluate((label) => {
  const m = document.querySelector('.modal');
  if (!m) return false;
  const btn = Array.from(m.querySelectorAll('button')).find((x) => x.innerText.trim() === label);
  if (!btn) return false;
  btn.click();
  return true;
}, label);
const scrollBlockIntoView = async (id) => {
  await page.evaluate((id) => {
    const el = document.querySelector('.sch-block[data-id="' + id + '"]');
    if (el) el.scrollIntoView({ block: 'center' });
  }, id);
  await sleep(350);
};
const mouseClickBlock = async (id, holdMs = 0) => {
  await scrollBlockIntoView(id);
  const box = await page.evaluate((id) => {
    const el = document.querySelector('.sch-block[data-id="' + id + '"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  if (!box) throw new Error('block not found: ' + id);
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  if (holdMs) await sleep(holdMs);
  await page.mouse.up();
  await sleep(450);
};

console.log('\n[1] 首屏渲染与秒级精度');
ok('路由进入日程表', await exists('.sch-page'));
ok('日期标题含今天', (await text('[data-k="sch-date-label"]')) === (await page.evaluate(() => {
  const d = new Date();
  const w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + w + ' ' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' · 精确到秒';
})), await text('[data-k="sch-date-label"]'));
ok('3 段日程都渲染', (await page.$$('.sch-block')).length === 3, (await page.$$('.sch-block')).length);
ok('块上显示 HH:MM:SS – HH:MM:SS', (await text('.sch-block[data-id="a1"]')).includes('09:40:30 – 10:20:30'));
ok('今日合计 1 小时 30 分', (await text('[data-k="sch-total"]')).includes('1 小时 30 分 0 秒'), await text('[data-k="sch-total"]'));
ok('重叠日程自动分两列', await page.$eval('.sch-block[data-id="a1"]', (el) => el.dataset.cols === '2'));
ok('今天显示当前时间红线', await exists('[data-k="sch-now"]'));
const radii = await page.evaluate(() => {
  const read = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).borderRadius : null;
  };
  const block = document.querySelector('.sch-block[data-id="a1"]');
  const bar = block ? getComputedStyle(block, '::before') : null;
  return { toolbar: read('.sch-toolbar'), board: read('.sch-board'), block: read('.sch-block'), barWidth: bar && bar.width, barRadius: bar && bar.borderRadius };
});
ok('工具条大卡 20px 圆角', radii.toolbar === '20px', radii);
ok('时间轴大卡 20px 圆角', radii.board === '20px', radii);
ok('日程块 16px 圆角 + 左侧 3px 色条', radii.block === '16px' && radii.barWidth === '3px' && radii.barRadius === '16px', radii);

console.log('\n[2] 日期导航：前后天 + 任意跳 + 回到今天');
await clickK('sch-prev');
await sleep(500);
ok('前一天箭头回到昨天', (await page.$eval('[data-k="sch-date-input"]', (el) => el.value)) === yesterday);
ok('昨天没有日程时显示空态', await exists('[data-k="sch-empty"]'));
ok('看昨天时不显示当前时间线', !(await exists('[data-k="sch-now"]')));
await clickK('sch-next');
await sleep(400);
await clickK('sch-tomorrow');
await sleep(400);
ok('明天快捷按钮', (await page.$eval('[data-k="sch-date-input"]', (el) => el.value)) === tomorrow);
await clickK('sch-today');
await sleep(300);
await clickK('sch-prev');
await sleep(300);
await clickK('sch-prev');
await sleep(300);
ok('可以继续翻到前天', (await page.$eval('[data-k="sch-date-input"]', (el) => el.value)) === twoDaysAgo);
await setField('sch-date-input', today);
await sleep(500);
ok('日期选择器可跳回今天', (await page.$eval('[data-k="sch-date-input"]', (el) => el.value)) === today);
await clickK('sch-prev'); await sleep(250);
await clickK('sch-today'); await sleep(400);
ok('「今天」按钮回今天', (await page.$eval('[data-k="sch-date-input"]', (el) => el.value)) === today);

console.log('\n[3] 缩放档');
const canvasH = () => page.$eval('.sch-canvas', (el) => parseFloat(el.style.height));
const hHour = await canvasH();
ok('1 小时档画布高约 2640px', Math.abs(hHour - 2640) < 2, hHour);
await clickK('sch-zoom-day');
await sleep(350);
const hDay = await canvasH();
ok('1 天档变矮（48px/小时）', Math.abs(hDay - 1152) < 2, hDay);
ok('1 天档缩放按钮高亮', await page.$eval('[data-k="sch-zoom-day"]', (el) => el.classList.contains('on')));
ok('切档后块里仍是秒级时间', (await text('.sch-block[data-id="a1"]')).includes('09:40:30 – 10:20:30'));
await clickK('sch-zoom-quarter');
await sleep(350);
const hQuarter = await canvasH();
ok('15 分档画布变高（440px/小时）', Math.abs(hQuarter - 10560) < 2, hQuarter);
await clickK('sch-zoom-minute');
await sleep(350);
const hMinute = await canvasH();
ok('1 分档继续变高（2160px/小时）', Math.abs(hMinute - 51840) < 2, hMinute);
ok('1 分档刻度显示分钟', await page.evaluate(() => {
  const el = Array.from(document.querySelectorAll('.sch-axis-label')).find((x) => /^\d{2}:\d{2}$/.test(x.innerText.trim()));
  return !!el;
}));
await clickK('sch-zoom-second');
await sleep(350);
ok('1 秒档刻度显示秒', await page.evaluate(() => Array.from(document.querySelectorAll('.sch-axis-label')).some((x) => /^\d{2}:\d{2}:\d{2}$/.test(x.innerText.trim()))));

console.log('\n[3.5] 红线每秒实时走，但不重渲染整页');
await clickK('sch-zoom-second');
await sleep(500);
const nowBefore = await page.evaluate(() => {
  const line = document.querySelector('[data-k="sch-now"]');
  const block = document.querySelector('.sch-block[data-id="a1"]');
  const canvas = document.querySelector('.sch-canvas');
  return {
    label: (document.querySelector('.sch-now-label') || {}).textContent || '',
    top: line ? parseFloat(line.style.top) : NaN,
    blockTop: block ? block.style.top : 'missing',
    canvasH: canvas ? canvas.style.height : 'missing'
  };
});
await sleep(2600);
const nowAfter = await page.evaluate(() => {
  const line = document.querySelector('[data-k="sch-now"]');
  const block = document.querySelector('.sch-block[data-id="a1"]');
  const canvas = document.querySelector('.sch-canvas');
  return {
    label: (document.querySelector('.sch-now-label') || {}).textContent || '',
    top: line ? parseFloat(line.style.top) : NaN,
    blockTop: block ? block.style.top : 'missing',
    canvasH: canvas ? canvas.style.height : 'missing'
  };
});
const secOf = (s) => {
  const m = String(s).match(/^(\d{2}):(\d{2}):(\d{2})$/);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN;
};
let nowDeltaSec = (secOf(nowAfter.label) - secOf(nowBefore.label) + 86400) % 86400;
const nowTopDelta = nowAfter.top - nowBefore.top;
ok('红线标签 2.6 秒内真的在跳（1-4 秒）', nowBefore.label !== nowAfter.label && nowDeltaSec >= 1 && nowDeltaSec <= 4, { before: nowBefore, after: nowAfter, nowDeltaSec });
ok('红线 top 与秒差匹配（1 秒档 30px/秒）', Math.abs(nowTopDelta - nowDeltaSec * 30) <= 2, { nowTopDelta, nowDeltaSec });
ok('红线自己动，日程块与画布 style 不动', nowAfter.blockTop === nowBefore.blockTop && nowAfter.canvasH === nowBefore.canvasH, {
  blockBefore: nowBefore.blockTop, blockAfter: nowAfter.blockTop,
  canvasBefore: nowBefore.canvasH, canvasAfter: nowAfter.canvasH
});

const hiddenStart = await page.evaluate(() => {
  try {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    return { ok: true, label: (document.querySelector('.sch-now-label') || {}).textContent || '' };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
await sleep(1800);
const nowHidden = await page.evaluate(() => {
  const line = document.querySelector('[data-k="sch-now"]');
  return { label: (document.querySelector('.sch-now-label') || {}).textContent || '', top: line ? parseFloat(line.style.top) : NaN };
});
await page.evaluate(() => {
  delete document.visibilityState;
  document.dispatchEvent(new Event('visibilitychange'));
});
await sleep(350);
const nowResumed = await page.evaluate(() => {
  const line = document.querySelector('[data-k="sch-now"]');
  return { label: (document.querySelector('.sch-now-label') || {}).textContent || '', top: line ? parseFloat(line.style.top) : NaN };
});
const hiddenDelta = (secOf(nowResumed.label) - secOf(nowHidden.label) + 86400) % 86400;
ok('页面隐藏时红线停表（1.8 秒内标签不动）', hiddenStart.ok === true && nowHidden.label === hiddenStart.label, { hiddenStart, nowHidden: nowHidden.label });
ok('回到前台立即补到正确时间', nowResumed.label !== nowHidden.label && hiddenDelta >= 1 && hiddenDelta <= 4 && Math.abs(nowResumed.top - secOf(nowResumed.label) * 30) <= 2, { nowHidden, nowResumed, hiddenDelta });
await clickK('sch-zoom-hour');
await sleep(500);

console.log('\n[3.6] 5 档缩放红线位置都对');
for (const [key, pps] of [['day', 48 / 3600], ['hour', 110 / 3600], ['quarter', 440 / 3600], ['minute', 2160 / 3600], ['second', 30]]) {
  await clickK('sch-zoom-' + key);
  await sleep(260);
  const nowInfo = await page.evaluate(() => {
    const line = document.querySelector('[data-k="sch-now"]');
    return {
      label: (document.querySelector('.sch-now-label') || {}).textContent || '',
      top: line ? parseFloat(line.style.top) : NaN
    };
  });
  const nowSec = secOf(nowInfo.label);
  ok(key + ' 档红线 top 与当前秒匹配', Number.isFinite(nowSec) && Math.abs(nowInfo.top - nowSec * pps) <= 2, { ...nowInfo, nowSec, pps });
}
await clickK('sch-zoom-hour');
await sleep(500);

console.log('\n[4] 点块看详情 + 编辑落库');
await mouseClickBlock('a1');
ok('点块打开详情浮框', await exists('[data-k="sch-detail"]'));
const detail1 = await text('[data-k="sch-detail"]');
ok('详情显示标题', detail1.includes('写需求文档'));
ok('详情显示开始/结束秒数', detail1.includes('09:40:30') && detail1.includes('10:20:30'), detail1.slice(0, 200));
ok('详情显示时长', detail1.includes('40 分 0 秒'), detail1);
ok('详情显示备注', detail1.includes('预算 bug'));
await clickK('sch-detail-edit');
await sleep(450);
ok('打开编辑弹窗', (await modalTitle()) === '编辑日程', await modalTitle());
ok('编辑弹窗 22px 圆角', (await page.$eval('.modal', (el) => getComputedStyle(el).borderRadius)) === '22px');
ok('编辑弹窗带出原开始时间', (await page.$eval('[data-k="sch-edit-start"]', (el) => el.value)) === '09:40:30');
ok('编辑弹窗带出原结束时间', (await page.$eval('[data-k="sch-edit-end"]', (el) => el.value)) === '10:20:30');
ok('编辑弹窗实时算时长', (await text('[data-k="sch-edit-duration"]')).includes('40 分 0 秒'));
await setField('sch-edit-title', '写需求文档（改）');
await setField('sch-edit-start', '09:41:30');
await setField('sch-edit-end', '10:21:30');
await clickK('sch-edit-save');
await sleep(600);
const edited = await getBlock('a1');
ok('编辑后标题落库', edited && edited.title === '写需求文档（改）', edited && edited.title);
ok('编辑后开始/结束落库（秒级）', edited && edited.start === 9 * 3600 + 41 * 60 + 30 && edited.end === 10 * 3600 + 21 * 60 + 30, edited && [edited.start, edited.end]);
ok('保存后块上文字更新', (await text('.sch-block[data-id="a1"]')).includes('09:41:30 – 10:21:30'));

console.log('\n[5] 长按 500ms 直接进编辑');
await mouseClickBlock('a1', 650);
ok('长按打开编辑弹窗', (await modalTitle()) === '编辑日程', await modalTitle());
await clickModalText('取消');
await sleep(300);
ok('取消后关闭弹窗', !(await exists('.modal')));

console.log('\n[6] 拖下边改结束时间');
await scrollBlockIntoView('a1');
const beforeDrag = await getBlock('a1');
const handleBox = await page.evaluate(() => {
  const el = document.querySelector('.sch-block[data-id="a1"] [data-handle="end"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
ok('块上边/下边都有拖拽热区', !!(await page.$('.sch-block[data-id="a1"] [data-handle="start"]')) && !!handleBox);
if (handleBox) {
  await page.mouse.move(handleBox.x, handleBox.y);
  await page.mouse.down();
  await page.mouse.move(handleBox.x, handleBox.y + 56, { steps: 4 });
  const bubble = await exists('.sch-bubble');
  ok('拖动时出现实时时间气泡', bubble);
  await page.mouse.up();
  await sleep(650);
}
const afterDrag = await getBlock('a1');
ok('拖下边不改开始时间', afterDrag && afterDrag.start === beforeDrag.start, afterDrag && [beforeDrag.start, afterDrag.start]);
ok('拖 56px 结束时间按 15 分钟吸附', afterDrag && Math.abs(afterDrag.end - (beforeDrag.end + 1800)) <= 60, afterDrag && [beforeDrag.end, afterDrag.end]);
ok('松手后气泡消失', !(await exists('.sch-bubble')));

console.log('\n[7] 空白处新建、删除、撤销');
await page.evaluate(() => {
  const sc = document.querySelector('.sch-scroll');
  sc.scrollTop = 14.5 * 3600 * (110 / 3600) - 160;
});
await sleep(500);
const lanePoint = await page.evaluate(() => {
  const lane = document.querySelector('[data-k="sch-lane"]');
  const r = lane.getBoundingClientRect();
  const pps = r.height / 86400;
  return { x: r.left + r.width * 0.62, y: r.top + 14.5 * 3600 * pps };
});
await page.mouse.click(lanePoint.x, lanePoint.y);
await sleep(600);
ok('点空白处打开新建弹窗', (await modalTitle()) === '新建日程', await modalTitle());
ok('新建开始时间按 15 分钟取整', (await page.$eval('[data-k="sch-edit-start"]', (el) => el.value)) === '14:30:00', await page.$eval('[data-k="sch-edit-start"]', (el) => el.value));
ok('新建默认一小时', (await page.$eval('[data-k="sch-edit-end"]', (el) => el.value)) === '15:30:00');
await setField('sch-edit-title', '新日程 E2E');
await setField('sch-edit-note', '地点：图书馆');
await clickK('sch-edit-save');
await sleep(650);
const newBlock = (await blocks()).find((b) => b.title === '新日程 E2E');
ok('新建日程落库（精确到秒）', !!newBlock && newBlock.start === 14.5 * 3600 && newBlock.end === 15.5 * 3600, newBlock && [newBlock.start, newBlock.end]);
if (newBlock) {
  await mouseClickBlock(newBlock.id);
  ok('新日程点开详情', await exists('[data-k="sch-detail"]'));
  await clickK('sch-detail-del');
  await sleep(500);
  ok('删除前弹出确认框', (await modalTitle()) === '删除这段日程？', await modalTitle());
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('.modal-foot button')).find((x) => x.innerText.trim() === '删除');
    if (btn) btn.click();
  });
  await sleep(650);
  ok('确认后记录从库里移除', !(await getBlock(newBlock.id)));
  const undo = await page.evaluate(() => {
    const acts = Array.from(document.querySelectorAll('.toast-act'));
    const el = acts[acts.length - 1];
    if (!el) return false;
    el.click();
    return true;
  });
  await sleep(600);
  ok('删除后的 toast 撤销可恢复', undo && !!(await getBlock(newBlock.id)));
}

console.log('\n[8] 课表叠加开关');
ok('默认显示当天课程虚线块', (await page.$$('.sch-course')).length === 1, (await page.$$('.sch-course')).length);
ok('虚线块不抢点击（pointer-events: none）', await page.$eval('.sch-course', (el) => getComputedStyle(el).pointerEvents === 'none'));
ok('legend 显示当天节数', (await text('[data-k="sch-legend"]')).includes('1 节课'), await text('[data-k="sch-legend"]'));
await toggleOverlay();
await sleep(450);
ok('关掉开关后虚线块消失', (await page.$$('.sch-course')).length === 0);
ok('开关状态写入 localStorage', (await page.evaluate(() => localStorage.getItem('schedule.overlay'))) === '0');
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('.sch-page');
await sleep(1500);
ok('刷新后关状态保持', !(await page.$eval('[data-k="sch-overlay"]', (el) => el.checked)) && (await page.$$('.sch-course')).length === 0);
await toggleOverlay();
await sleep(500);
ok('重新打开后课程出现', (await page.$$('.sch-course')).length === 1);
ok('刷新后开状态保持', await page.evaluate(() => localStorage.getItem('schedule.overlay')) === '1');

console.log('\n[9] CSV / ICS 导出');
await page.evaluate(() => {
  window.__dl = null; window.__blob = null;
  URL.createObjectURL = (b) => { window.__blob = b; return 'blob:mock'; };
  HTMLAnchorElement.prototype.click = function () { window.__dl = this.download; };
});
await clickK('sch-export');
await sleep(400);
const exportOpened = (await modalTitle()) === '导出日程';
ok('导出弹窗打开', exportOpened);
if (!exportOpened) {
  console.log('DEBUG export', await page.evaluate(() => {
    const el = document.querySelector('[data-k="sch-export"]');
    const r = el ? el.getBoundingClientRect() : null;
    return {
      viewport: [innerWidth, innerHeight], scrollY,
      rect: r && [r.x, r.y, r.width, r.height],
      display: el && getComputedStyle(el).display,
      modals: [...document.querySelectorAll('.modal')].map((x) => x.innerText.slice(0, 30)),
      masks: document.querySelectorAll('.modal-mask').length,
      btnTexts: [...document.querySelectorAll('button')].filter((x) => x.innerText.includes('导出')).map((x) => [x.dataset.k, getComputedStyle(x).display, x.getBoundingClientRect().width])
    };
  }));
}
await clickK('sch-export-7');
await sleep(250);
ok('切到最近 7 天范围', (await page.$eval('[data-k="sch-export-7"]', (el) => el.classList.contains('on'))));
await clickK('sch-export-csv');
await sleep(500);
const dl1 = await page.evaluate(async () => {
  const buf = window.__blob ? new Uint8Array(await window.__blob.arrayBuffer()) : new Uint8Array();
  const text = window.__blob ? await window.__blob.text() : '';
  return { name: window.__dl, text, bytes: Array.from(buf.slice(0, 3)) };
});
ok('CSV 触发了下载文件名', !!dl1.name && dl1.name.startsWith('shili-schedule-') && dl1.name.endsWith('-7d.csv'), dl1.name);
ok('CSV 字节带 UTF-8 BOM 与表头', dl1.bytes.join(',') === '239,187,191' && dl1.text.startsWith('日期,开始,结束,时长,标题,分类,备注,完成,来源'), { bytes: dl1.bytes, head: dl1.text.slice(0, 50) });
ok('CSV 含个人日程的秒级起止与时长', dl1.text.includes(today + ',09:41:30,10:51:30,01:10:00,写需求文档（改）'), dl1.text.slice(0, 400));
ok('CSV 含课程行', dl1.text.includes(',高等数学,课程,'));
const courseRows = dl1.text.split('\r\n').filter((line) => line.includes('高等数学')).length;
ok('最近 7 天导出时课程不会重复 7 次', courseRows === 1, courseRows);

await clickK('sch-export');
await sleep(350);
await clickK('sch-export-ics');
await sleep(500);
const dl2 = await page.evaluate(async () => ({ name: window.__dl, text: window.__blob ? await window.__blob.text() : '' }));
ok('ICS 下载文件名', !!dl2.name && dl2.name.endsWith('.ics'), dl2.name);
ok('ICS 是合法 VCALENDAR', dl2.text.includes('BEGIN:VCALENDAR') && dl2.text.includes('END:VCALENDAR'));
ok('ICS 时间是浮动本地秒级', dl2.text.includes('DTSTART:' + today.replace(/-/g, '') + 'T094130'), dl2.text.slice(0, 500));
ok('ICS 含标题与备注', dl2.text.includes('SUMMARY:写需求文档（改）') && dl2.text.includes('DESCRIPTION:'));
ok('ICS 含课程', dl2.text.includes('SUMMARY:高等数学'));

console.log('\n[10] 手机窄屏 320 / 360 / 390：高对比背景 + autoStyle 下工具条可见可读');
// 老板截图场景：自定义深色高对比背景 + 高通透 + AI 自动配色 + ins 主题。
// 先切到手机视口再造图，避免桌面尺寸下的分析结果和手机排布不一致。
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('.sch-page');
await page.evaluate(async () => {
  const S = window.__schedule;
  const cv = document.createElement('canvas');
  cv.width = 390; cv.height = 844;
  const g = cv.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 390, 844);
  lg.addColorStop(0, '#071f27'); lg.addColorStop(.48, '#123a42'); lg.addColorStop(1, '#051015');
  g.fillStyle = lg; g.fillRect(0, 0, 390, 844);
  g.fillStyle = '#1d5a63'; g.beginPath(); g.moveTo(0, 260); g.lineTo(390, 90); g.lineTo(390, 560); g.closePath(); g.fill();
  g.fillStyle = '#e8f6f0'; g.globalAlpha = .78; g.beginPath(); g.arc(250, 700, 70, 0, 7); g.fill();
  g.globalAlpha = 1;
  await S.appearance.save({
    mode: 'image', image: cv.toDataURL('image/jpeg', .9), imageName: 'v162-test.jpg',
    autoStyle: true, tint: 45, dim: 0, fog: false, theme: 'ins'
  });
});
await sleep(3200);

const mobileChecks = [];
const contrastGroups = { zoom: '精度档', dateNav: '日期导航按钮', quick: '快捷日期按钮', total: '今日合计' };
for (const width of [320, 360, 390]) {
  await page.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.sch-page');
  await sleep(1800);
  const m = await page.evaluate(() => {
    const rectOf = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { sel, x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
    };
    const parts = ['.sch-date-nav', '.sch-date-quick', '.sch-zoom', '.sch-total'].map(rectOf);
    const toggle = rectOf('.sch-toggle');
    return {
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      inner: window.innerWidth,
      innerHeight: window.innerHeight,
      parts,
      rows: {
        navBottom: parts[0] && parts[0].bottom,
        quickTop: parts[1] && parts[1].y,
        quickBottom: parts[1] && parts[1].bottom,
        zoomTop: parts[2] && parts[2].y,
        zoomCenter: parts[2] && (parts[2].y + parts[2].h / 2),
        totalCenter: parts[3] && (parts[3].y + parts[3].h / 2),
        toggleCenter: toggle && (toggle.y + toggle.h / 2),
        quickCenter: parts[1] && (parts[1].y + parts[1].h / 2)
      },
      addVisible: (() => {
        const el = document.querySelector('[data-k="sch-add-mobile"]');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })(),
      toolbarRadius: (() => {
        const el = document.querySelector('.sch-toolbar');
        return el ? getComputedStyle(el).borderRadius : null;
      })(),
      exportHidden: (() => {
        const el = document.querySelector('[data-k="sch-export"]');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return getComputedStyle(el).display === 'none' && r.width === 0 && r.height === 0;
      })(),
      dateInputW: (() => {
        const el = document.querySelector('[data-k="sch-date-input"]');
        return el ? el.getBoundingClientRect().width : 0;
      })(),
      dateFace: (() => {
        const el = document.querySelector('.sch-date-face');
        if (!el) return null;
        return { text: el.textContent || '', overflow: el.scrollWidth - el.clientWidth, visible: getComputedStyle(el).display !== 'none' };
      })(),
      zoomOverflow: [...document.querySelectorAll('.sch-zoom button')].map((el) => el.scrollWidth - el.clientWidth),
      totalValue: (() => {
        const el = document.querySelector('.sch-total-value');
        if (!el) return null;
        return { text: el.textContent || '', overflow: el.scrollWidth - el.clientWidth };
      })(),
      // 手机底部固定条右端的「导出」以前被全局灵感浮球盖住，点不到（v1.6.0 用 elementFromPoint 验）
      fabHidden: !document.querySelector('.fab'),
      exportHit: (() => {
        const btn = Array.from(document.querySelectorAll('button')).find((x) => (x.innerText || '').trim() === '导出');
        if (!btn) return 'no-btn';
        const r = btn.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        return !!(el && (el === btn || btn.contains(el)));
      })()
    };
  });
  mobileChecks.push({ width, ...m });

  ok(width + 'px 无横向溢出', m.doc <= width + 1 && m.body <= width + 1, m);
  ok(width + 'px 底部加日程按钮可见', m.addVisible, m);
  ok(width + 'px 导出按钮没被灵感浮球盖住', m.exportHit === true && m.fabHidden, m);
  const partsOk = m.parts.every((p) => p && p.w > 2 && p.h > 2 &&
    p.x >= -1 && p.right <= m.inner + 1 && p.y >= -1 && p.bottom <= m.innerHeight + 1);
  ok(width + 'px 日期导航/快捷日期/精度档/合计都在视口内', partsOk, m.parts);
  ok(width + 'px 工具条固定三段（导航 / 快捷+开关 / 精度+合计）',
    m.rows.navBottom <= m.rows.quickTop + 1 &&
    m.rows.quickBottom <= m.rows.zoomTop + 1 &&
    Math.abs(m.rows.toggleCenter - m.rows.quickCenter) <= 6,
    m.rows);
  ok(width + 'px 精度档与合计同一行', Math.abs(m.rows.zoomCenter - m.rows.totalCenter) <= 5, m.rows);
  ok(width + 'px 工具条大卡 24px 圆角', m.toolbarRadius === '24px', m.toolbarRadius);
  ok(width + 'px 桌面导出按钮已收起（手机用底部导出）', m.exportHidden, m.exportHidden);
  ok(width + 'px 日期输入框没被挤没（>= 96px）', m.dateInputW >= 96, m.dateInputW);
  ok(width + 'px 日期文字完整显示 YYYY/MM/DD', !!m.dateFace && m.dateFace.visible && m.dateFace.text === today.replace(/-/g, '/') && m.dateFace.overflow <= 1, m.dateFace);
  ok(width + 'px 5 档精度文字不溢出按钮', m.zoomOverflow.every((n) => n <= 1), m.zoomOverflow);
  ok(width + 'px 合计数值整体不拆行', !!m.totalValue && m.totalValue.overflow <= 1 && /\d+ 小时|\d+ 分|\d+ 秒/.test(m.totalValue.text), m.totalValue);

  // 真截图采样：取按钮自身「可见表面」的像素（不是拿卡面色算），再和文字色算对比。
  const shot64 = await page.screenshot({ encoding: 'base64', type: 'png' });
  const shotPath = '.tmp/v162-sch-' + width + '.png';
  fs.writeFileSync(shotPath, Buffer.from(shot64, 'base64'));
  ok(width + 'px 截图已生成 ' + shotPath, fs.existsSync(shotPath) && fs.statSync(shotPath).size > 10000);

  const colors = await page.evaluate(async ({ b64 }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const sx = img.width / window.innerWidth;
    const sy = img.height / window.innerHeight;
    const read = (cssX, cssY) => {
      const x = Math.max(0, Math.min(img.width - 1, Math.round(cssX * sx)));
      const y = Math.max(0, Math.min(img.height - 1, Math.round(cssY * sy)));
      const p = ctx.getImageData(x, y, 1, 1).data;
      return [p[0], p[1], p[2]];
    };
    const targets = [];
    const add = (group, el) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      // 取胶囊左侧内边距（竖向中线）：避开文字，又在圆角之内
      const x = r.left + Math.min(2.5, Math.max(1.5, r.width * .08));
      const y = r.top + r.height / 2;
      targets.push({
        group, text: (el.textContent || '').trim().slice(0, 18),
        color: getComputedStyle(el).color, sample: read(x, y)
      });
    };
    document.querySelectorAll('.sch-zoom button').forEach((el) => add('zoom', el));
    document.querySelectorAll('.sch-date-nav button').forEach((el) => add('dateNav', el));
    document.querySelectorAll('.sch-date-quick .btn').forEach((el) => add('quick', el));
    add('total', document.querySelector('.sch-total'));
    return targets;
  }, { b64: shot64 });

  for (const [group, label] of Object.entries(contrastGroups)) {
    const rows = colors.filter((c) => c.group === group).map((c) => {
      const fg = parseRgb(c.color);
      return { text: c.text, color: c.color, sample: c.sample, ratio: fg ? contrastRatio(fg, c.sample) : 0 };
    });
    const worst = rows.reduce((a, b) => (!a || b.ratio < a.ratio ? b : a), null);
    ok(width + 'px ' + label + ' 文字/可见表面对比 >= 4.5',
      rows.length > 0 && worst.ratio >= 4.5, { worst, all: rows.slice(0, 8) });
  }
}
const badMobile = mobileChecks.filter((x) => x.doc > x.width + 1 || x.body > x.width + 1);
ok('三档窄屏整体无溢出', badMobile.length === 0, badMobile);
await page.screenshot({ path: '.tmp/schedule-mobile.png' });

// 还原默认外观，桌面截图仍是产品默认的奶油风
await page.evaluate(async () => {
  await window.__schedule.appearance.save({ mode: 'preset', preset: 'cream', theme: 'ins', tint: 20, dim: 16, fog: true, autoStyle: true });
});
await page.setViewport({ width: 1200, height: 900 });
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('.sch-page');
await sleep(1500);
await page.screenshot({ path: '.tmp/schedule-desktop.png' });

const ignore = (s) => /favicon|ERR_ABORTED|net::ERR_FAILED/i.test(s);
ok('没有未捕获的 pageerror', pageErrors.filter((s) => !ignore(s)).length === 0, pageErrors.slice(0, 5));
ok('没有 console error', consoleErrors.filter((s) => !ignore(s)).length === 0, consoleErrors.slice(0, 5));

await page.close();
await browser.close();
if (!process.argv[2]) await stopIsolatedServer();
console.log('\n===== ' + pass + ' passed, ' + fail + ' failed =====');
process.exit(fail ? 1 : 0);
