// 课表导入专项：Excel 真文件、AI 识别（假服务端）、本地兜底
//
// AI 那条链路没法依赖真实大模型（要密钥、要联网、结果还不稳定），
// 所以在本地起一个 OpenAI 兼容的假服务端：它固定返回一份带代码围栏的 JSON，
// 顺便把收到的请求体记下来，用来断言"图确实传过去了""提示词里有节次表"。
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startIsolatedServer, stopIsolatedServer, ROOT } from './isoserver.mjs';
import * as XLSX from 'xlsx';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const AI_PORT = 8788;
const FENCE = String.fromCharCode(96).repeat(3);
mkdirSync('shots8', { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------- 假的 OpenAI 兼容服务端 ------------------------- */
const AI_REPLY = {
  courses: [
    { name: '高等数学A', teacher: '张建国', location: '教三201', day: 1, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 16, parity: 'all' },
    { name: '大学英语', teacher: '李梅', location: '外语楼305', day: '周一', startPeriod: 3, endPeriod: 4, startWeek: 1, endWeek: 16 },
    { name: '数据结构', teacher: '王强', location: '计算机楼A401', day: 2, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 16, parity: 'odd' },
    { name: '这门课没有星期', teacher: '某人', location: '某处', startTime: '08:00', endTime: '09:00' }
  ],
  termStart: '2026-09-07'
};

let lastBody = null;
let reqCount = 0;
const aiSrv = createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => {
    reqCount++;
    try { lastBody = JSON.parse(data || '{}'); } catch { lastBody = null; }
    // 故意套一层代码围栏，验证客户端的去围栏逻辑
    const content = FENCE + 'json\n' + JSON.stringify(AI_REPLY) + '\n' + FENCE;
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});
await new Promise((r) => aiSrv.listen(AI_PORT, '127.0.0.1', r));

/* ------------------------------ 真造一个 Excel ------------------------------ */
const xlsxPath = join(ROOT, 'shots8', '生成的真实课表.xlsx');
const ws = XLSX.utils.aoa_to_sheet([
  ['节次', '星期一', '星期二', '星期三'],
  ['1-2节', '高等数学A\n张建国\n教三201\n1-16周', '', '大学英语\n李梅\n外语楼305\n1-16周'],
  ['3-4节', '', '数据结构\n王强\n计算机楼A401\n1-16周', ''],
  ['5-6节', '计算机网络\n赵敏\n计算机楼A302\n1-16周双周', '', '']
]);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '课表');
writeFileSync(xlsxPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
console.log('  已生成测试用 Excel：' + xlsxPath);

const URL = await startIsolatedServer(Number(process.env.TEST_PORT || 8786));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.setViewport({ width: 1440, height: 1000 });
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForSelector('.app', { timeout: 20000 });
await sleep(2500);

const gotoTab = async (name) => {
  await page.evaluate((n) => {
    const b = Array.from(document.querySelectorAll('.nav-item, .tab')).find((x) => x.innerText.includes(n));
    if (b) b.click();
  }, name);
  await sleep(800);
};

/* ============================ 1. Excel 导入 ============================ */
console.log('\n[1] Excel 文件导入（.xlsx 真文件）');
await gotoTab('我的课表');
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.includes('导入课表'));
  if (b) b.click();
});
await sleep(700);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.seg button')).find((x) => x.innerText.includes('上传 Excel'));
  if (b) b.click();
});
await sleep(400);
const xlsInput = await page.$('input[accept=".xlsx,.xls,.csv,.txt"]');
ok('上传 Excel 的文件框存在', !!xlsInput);
await xlsInput.uploadFile(xlsxPath);
await sleep(1500);
const xlsPreview = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('.pool-item')).map((x) => x.innerText.replace(/\s+/g, ' ').trim());
  return { n: items.length, all: items.join(' || ').slice(0, 400) };
});
console.log('   预览：' + xlsPreview.all.slice(0, 220));
ok('Excel 解析出课程', xlsPreview.n >= 3, xlsPreview.n);
ok('认出了课程名', /高等数学A/.test(xlsPreview.all), xlsPreview.all.slice(0, 120));
ok('认出了教师与地点', /张建国/.test(xlsPreview.all) && /教三201/.test(xlsPreview.all), xlsPreview.all.slice(0, 120));
ok('认出了单双周', /双/.test(xlsPreview.all), xlsPreview.all.slice(0, 200));

/* ============================ 2. 配置 AI ============================ */
console.log('\n[2] 配置 AI 接口 + 测试连接');
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.includes('取消'));
  if (b) b.click();
});
await sleep(500);
await gotoTab('设置');
await sleep(600);
// v1.4.1：AI 识别面板在 'ai' 二级页
await page.evaluate(() => window.__schedule.ui.openSettingsPage('ai'));
await sleep(800);
await page.waitForFunction(() => document.body.innerText.includes('AI 识别'), { timeout: 10000 }).catch(() => {});
await page.evaluate((port) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const set = (el, v) => { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const inputs = Array.from(document.querySelectorAll('.subpage .card input.input'));
  const url = inputs.find((x) => (x.placeholder || '').includes('deepseek'));
  const key = inputs.find((x) => x.type === 'password');
  const model = inputs.find((x) => (x.placeholder || '') === 'deepseek-chat');
  if (url) set(url, 'http://127.0.0.1:' + port + '/v1');
  if (key) set(key, 'sk-test-key');
  if (model) set(model, 'fake-vl');
}, AI_PORT);
await sleep(400);
await page.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.subpage .card')).find((x) => x.innerText.includes('AI 识别'));
  const save = Array.from(card.querySelectorAll('button')).find((x) => x.innerText.trim() === '保存');
  if (save) save.click();
});
await sleep(600);
ok('保存后卡片显示已配置', await page.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.subpage .card')).find((x) => x.innerText.includes('AI 识别'));
  return /已配置/.test(card.innerText);
}));
await page.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.subpage .card')).find((x) => x.innerText.includes('AI 识别'));
  const t = Array.from(card.querySelectorAll('button')).find((x) => x.innerText.includes('测试连接'));
  if (t) t.click();
});
await sleep(1500);
ok('测试连接真的打通了假服务端', reqCount >= 1, { reqCount });

/* ============================ 3. AI 识别文本 ============================ */
console.log('\n[3] AI 识别：粘贴的乱文本');
await gotoTab('我的课表');
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.includes('导入课表'));
  if (b) b.click();
});
await sleep(700);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.seg button')).find((x) => x.innerText.includes('AI 识别'));
  if (b) b.click();
});
await sleep(400);
await page.evaluate(() => {
  const ta = document.querySelector('.modal textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '高数A 张建国 教三201 周一 1-2节 1-16周\n大英 李梅 外语楼305 周一 3-4节');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(300);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.includes('AI 识别并自动排课'));
  if (b) b.click();
});
await sleep(2000);
const aiPreview = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('.modal .pool-item')).map((x) => x.innerText.replace(/\s+/g, ' ').trim());
  const m = document.querySelector('.modal');
  return { n: items.length, all: items.join(' || '), hasNote: /AI 识别/.test(m.innerText) };
});
console.log('   预览：' + aiPreview.all.slice(0, 260));
ok('AI 返回的 JSON 被解析成课程', aiPreview.n >= 3, aiPreview.n);
ok('代码围栏被剥掉，没有当成内容', !/围栏/.test(aiPreview.all) && !aiPreview.all.includes(String.fromCharCode(96)), aiPreview.all.slice(0, 80));
ok('把“周一”这种写法也认成了星期', /周一/.test(aiPreview.all), aiPreview.all.slice(0, 200));
ok('用节次换算出时间（第3-4节 → 10:00 起）', /10:00/.test(aiPreview.all), aiPreview.all.slice(0, 300));
ok('提示词里带上了节次对照表', !!lastBody && JSON.stringify(lastBody).includes('第 1 节'), null);
ok('界面提示写明了识别结果', aiPreview.hasNote, aiPreview.hasNote);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.includes('确认导入'));
  if (b) b.click();
});
await sleep(1200);
const imported = await page.evaluate(() => {
  const s = window.__schedule;
  return { n: s.list('courses').length, term: s.cfg.termStart };
});
ok('确认后课程进了本地库', imported.n >= 3, imported.n);
ok('AI 识别出的开学日期被自动写入', !!imported.term, imported.term);
await page.screenshot({ path: 'shots8/01-ai-imported.png' });

/* ============================ 4. AI 识别图片 ============================ */
console.log('\n[4] AI 识别：课表图片');
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.includes('导入课表'));
  if (b) b.click();
});
await sleep(700);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.seg button')).find((x) => x.innerText.includes('AI 识别'));
  if (b) b.click();
});
await sleep(400);
await page.evaluate(async () => {
  const cv = document.createElement('canvas');
  cv.width = 640; cv.height = 360;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = '#000'; ctx.font = '28px sans-serif';
  ctx.fillText('课程表 星期一 高等数学A', 24, 60);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const file = new File([blob], '课表截图.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const input = document.querySelector('.modal input[accept="image/*"]');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
await sleep(1200);
const imgReady = await page.evaluate(() => {
  const img = document.querySelector('.modal img');
  return { hasImg: !!img, src: img ? img.src.slice(0, 24) : '' };
});
ok('图片被读取并显示成缩略图', imgReady.hasImg && imgReady.src.startsWith('data:image'), imgReady);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.includes('AI 识别并自动排课'));
  if (b) b.click();
});
await sleep(2000);
const bodyStr = JSON.stringify(lastBody || {});
ok('图片以 image_url 形式发给了模型', bodyStr.includes('image_url') && bodyStr.includes('data:image'), null);
ok('同一次请求里也带上了文本提示', bodyStr.includes('节次'), null);
const imgPreview = await page.evaluate(() => document.querySelectorAll('.modal .pool-item').length);
ok('图片识别结果同样进了预览', imgPreview >= 3, imgPreview);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.includes('取消'));
  if (b) b.click();
});
await sleep(500);

/* ============================ 5. 关掉 AI 的兜底 ============================ */
console.log('\n[5] 没配 AI 时的本地兜底');
await gotoTab('设置');
await sleep(600);
// 再次进入设置：同样要先进 'ai' 二级页（离开设置时已复位到根页）
await page.evaluate(() => window.__schedule.ui.openSettingsPage('ai'));
await sleep(800);
await page.waitForFunction(() => document.body.innerText.includes('AI 识别'), { timeout: 10000 }).catch(() => {});
await page.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.subpage .card')).find((x) => x.innerText.includes('AI 识别'));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const inputs = Array.from(card.querySelectorAll('input.input'));
  const url = inputs.find((x) => (x.placeholder || '').includes('deepseek'));
  if (url) { setter.call(url, ''); url.dispatchEvent(new Event('input', { bubbles: true })); }
  const save = Array.from(card.querySelectorAll('button')).find((x) => x.innerText.trim() === '保存');
  if (save) save.click();
});
await sleep(700);
await gotoTab('我的课表');
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.includes('导入课表'));
  if (b) b.click();
});
await sleep(700);
// 重开弹窗会回到第一个标签页，得先切到 AI 那一栏
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.seg button')).find((x) => x.innerText.includes('AI 识别'));
  if (b) b.click();
});
await sleep(400);
await page.evaluate(() => {
  const ta = document.querySelector('.modal textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, '线性代数 孙老师 教二108 周三 08:00-09:40 1-16周');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.includes('AI 识别并自动排课'));
  if (b) b.click();
});
await sleep(1500);
const localNote = await page.evaluate(() => {
  const m = document.querySelector('.modal');
  return { items: m.querySelectorAll('.pool-item').length, text: m.innerText.replace(/\s+/g, ' ').slice(0, 300) };
});
ok('没配 AI 时文本仍能解析并给出提示', localNote.items >= 1 && /本地规则解析/.test(localNote.text), localNote.text.slice(0, 160));

/* ============ 6. 真实整院课表（按班分行 + 大课制） ============ */
console.log('\n[6] 整院课表：按班分行 + 两节小课合成一节大课');
{
  const fixture = join(ROOT, 'tests', 'fixtures', '整院课表样例.xls');
  await gotoTab('我的课表');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.includes('导入课表'));
    if (b) b.click();
  });
  await sleep(700);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.seg button')).find((x) => x.innerText.includes('上传 Excel'));
    if (b) b.click();
  });
  await sleep(400);
  const inp = await page.$('input[accept=".xlsx,.xls,.csv,.txt"]');
  await inp.uploadFile(fixture);
  await sleep(2500);

  const chips = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.modal .chip')).map((x) => x.innerText.trim()));
  console.log('   检测到的班级: ' + JSON.stringify(chips.slice(0, 6)) + ' 共 ' + chips.length + ' 个');
  ok('认出了整院课表里的多个班级', chips.length >= 5, chips.slice(0, 6));
  ok('班级名被原样保留（计26.1(36)）', chips.indexOf('计26.1(36)') >= 0, chips.slice(0, 6));

  await page.evaluate(() => {
    const c = Array.from(document.querySelectorAll('.modal .chip')).find((x) => x.innerText.trim() === '计26.1(36)');
    if (c) c.click();
  });
  await sleep(1200);
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.modal .pool-item')).map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
  console.log('   计26.1 前 3 条: ' + rows.slice(0, 3).join(' || ').slice(0, 190));
  ok('切班之后只显示这个班', rows.length > 5 && rows.every((t) => t.indexOf('[计26.1(36)]') >= 0), rows.length);
  ok('大课制换算正确：01-02节 → 08:00-09:40', rows.some((t) => t.indexOf('08:00-09:40') >= 0), rows.slice(0, 3));
  ok('四节连排也对：05-08节 → 14:00-17:40', rows.some((t) => t.indexOf('14:00-17:40') >= 0), rows.slice(0, 4));
  ok('不连续周次被保留（5-6,8-13）', rows.some((t) => t.indexOf('5-6,8-13 周') >= 0), rows.slice(0, 4));
  ok('地点、教师都认出来了', rows.some((t) => t.indexOf('北2229') >= 0 && t.indexOf('蔡淑云') >= 0), rows.slice(0, 2));
  ok('课程名里的全角括号没被当成班级', rows.some((t) => t.indexOf('高等数学一（上）') >= 0), rows.slice(0, 2));

  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.includes('确认导入'));
    if (b) b.click();
  });
  await sleep(1500);
  const saved = await page.evaluate(() => window.__schedule.list('courses').filter((c) => c.className === '计26.1(36)').length);
  ok('导入后课程带着班级存进了本地库', saved >= 10, saved);
  const withWeeks = await page.evaluate(() =>
    window.__schedule.list('courses').filter((c) => c.className === '计26.1(36)' && Array.isArray(c.weeks) && c.weeks.length).length);
  ok('精确周次也存了下来', withWeeks >= 10, withWeeks);
  const grid = await page.evaluate(() => ({
    week: Number((document.body.innerText.match(/第 (\d+) 教学周/) || [])[1] || 0),
    blocks: document.querySelectorAll('.tt-course').length
  }));
  console.log('   当前第 ' + grid.week + ' 教学周，网格里 ' + grid.blocks + ' 个课块');
  ok('课表网格渲染出了课块', grid.blocks > 0, grid);

  // 版式按参考图来：一行就是一小节（第 1 节 08:00-08:45），
  // 两小节合成的大课就占两行——所以格子必须按"小节"切，不能按整点小时。
  const geo = await page.evaluate(() => {
    const col = document.querySelector('.tt-col');
    const cells = col ? Array.from(col.querySelectorAll('.tt-cell')) : [];
    const cr = col ? col.getBoundingClientRect() : null;
    const times = Array.from(document.querySelectorAll('.tt-time')).map((x) => x.innerText.replace(/\s+/g, ' ').trim());
    const courses = col ? Array.from(col.querySelectorAll('.tt-course')).map((x) => {
      const r = x.getBoundingClientRect();
      return { t: x.innerText.replace(/\s+/g, ' ').slice(0, 16), top: Math.round(r.top - cr.top), h: Math.round(r.height) };
    }) : [];
    const cellBoxes = cells.map((x) => {
      const r = x.getBoundingClientRect();
      return { top: Math.round(r.top - cr.top), h: Math.round(r.height) };
    });
    return { cellCount: cells.length, times, courses, cellBoxes };
  });
  console.log('   时间轴: ' + JSON.stringify(geo.times.slice(0, 4)));
  const rh = geo.cellBoxes.length ? geo.cellBoxes[0].h : 0;
  ok('背景方格按小节切（12 小节，不是整点小时）', geo.cellCount === 12 && rh > 40 && rh < 90, { n: geo.cellCount, rowH: rh });
  ok('时间轴是「第 N 节 + 起止时间」', /^1\s+08:00\s+08:45$/.test(geo.times[0] || ''), geo.times.slice(0, 3));
  ok('大课被拆成两小节的时间（08:00-08:45 / 08:55-09:40）',
    geo.times.some((t) => t.indexOf('08:45') >= 0) && geo.times.some((t) => t.indexOf('08:55') >= 0 && t.indexOf('09:40') >= 0),
    geo.times.slice(0, 3));
  // 08:00-09:40 的大课应该正好压满两行，而不是跨在两条线之间
  const two = geo.courses.find((c) => /高等数学A/.test(c.t));
  ok('两小节的大课正好占满两行', !!two && Math.abs(two.top - geo.cellBoxes[0].top) <= 5 && Math.abs(two.h - (geo.cellBoxes[1].top + geo.cellBoxes[1].h - geo.cellBoxes[0].top)) <= 14,
    two ? { top: two.top, h: two.h, row1: geo.cellBoxes[0], row2: geo.cellBoxes[1] } : geo.courses.slice(0, 3));
}

/* ============================ 7. 班级 ============================ */
console.log('\n[6] 班级：解析、筛选');
await gotoTab('我的课表');
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.includes('导入课表'));
  if (b) b.click();
});
await sleep(700);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.seg button')).find((x) => x.innerText.includes('粘贴文本'));
  if (b) b.click();
});
await sleep(300);
await page.evaluate(() => {
  const ta = document.querySelector('.modal textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, [
    '班级：计科2101',
    '高等数学A 张建国 教三201 周一 1-2节 1-16周',
    '班级：计科2102',
    '高等数学A 李梅 教三202 周一 3-4节 1-16周',
    '[软件2101] 数据结构 王强 计算机楼A401 周二 1-2节 1-16周'
  ].join('\n'));
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.trim() === '解析');
  if (b) b.click();
});
await sleep(1500);
const parsed = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.modal .pool-item')).map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
console.log('   预览：' + parsed.join(' || ').slice(0, 260));
ok('「班级：」分段能认出来（第 1 段）', parsed.some((t) => /\[计科2101\]/.test(t)), parsed.slice(0, 3));
ok('「班级：」分段能认出第二个班', parsed.some((t) => /\[计科2102\]/.test(t)), parsed.slice(0, 3));
ok('行首 [班级] 也能认', parsed.some((t) => /\[软件2101\]/.test(t)), parsed.slice(0, 3));
ok('同一门课分属两个班时是两条记录', parsed.filter((t) => /高等数学A/.test(t)).length === 2, parsed.length);

await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('.modal button')).find((x) => x.innerText.includes('确认导入'));
  if (b) b.click();
});
await sleep(1200);

// 用调试钩子确认数据里真的带上了班级
const inDb = await page.evaluate(() => window.__schedule.list('courses').map((c) => ({ n: c.name, k: c.className || '' })));
ok('课程记录里保存了班级字段', inDb.some((c) => c.k === '计科2101') && inDb.some((c) => c.k === '软件2101'), inDb.slice(0, 5));

// 筛选 UI：班级条就在课表卡里，跟"选第几周"并排
await sleep(600);
// 班级条是 .pick-line 里以「班级」开头的那一条（另一条是「周次」）
const classChips = () => page.evaluate(() => {
  const line = Array.from(document.querySelectorAll('.pick-line')).find((x) => x.innerText.indexOf('班级') === 0);
  return line ? Array.from(line.querySelectorAll('.chip')).map((x) => x.innerText.trim()) : null;
});
const chips = await classChips();
console.log('   班级选项：' + JSON.stringify(chips));
ok('课表里有「班级」选项条', Array.isArray(chips) && chips.length >= 2, chips);
ok('选项里有「全部」和识别出的班', !!chips && chips[0] === '全部' && chips.includes('计科2101'), chips);
ok('班级条和周次条并列在课表卡里', await page.evaluate(() => {
  const card = Array.from(document.querySelectorAll('.card')).find((x) => x.querySelector('.tt-wrap'));
  const lines = card ? Array.from(card.querySelectorAll('.pick-line')).map((x) => x.innerText.slice(0, 2)) : [];
  return lines.length === 2 && lines[0] === '班级' && lines[1] === '周次';
}));

const clickChip = async (name) => {
  await page.evaluate((n) => {
    const line = Array.from(document.querySelectorAll('.pick-line')).find((x) => x.innerText.indexOf('班级') === 0);
    const b = Array.from(line.querySelectorAll('.chip')).find((x) => x.innerText.trim() === n);
    if (b) b.click();
  }, name);
  await sleep(800);
  return page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.card')).find((x) => x.querySelector('.tt-wrap'));
    return {
      blocks: Array.from(document.querySelectorAll('.tt-course b')).map((x) => x.innerText.trim()),
      text: card ? card.innerText.replace(/\s+/g, ' ') : ''
    };
  });
};

const all = await clickChip('全部');
ok('「全部」显示全部课程', all.blocks.length >= 3, all.blocks.length);
const c1 = await clickChip('计科2101');
console.log('   选计科2101后：' + JSON.stringify(c1.blocks));
ok('选中某个班后只剩它自己的课', c1.blocks.length > 0 && c1.blocks.length < all.blocks.length, { all: all.blocks.length, one: c1.blocks.length });
ok('课表标题写明了正在看哪个班', /计科2101/.test(c1.text), c1.text.slice(0, 140));

// 班级选择要记住
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('.app');
await sleep(2500);
await gotoTab('我的课表');
const remembered = await page.evaluate(() => localStorage.getItem('ttClass'));
ok('刷新后还记得选的是哪个班', remembered === '计科2101', remembered);

/* ============================ 8. 控制台 ============================ */
console.log('\n[8] 控制台错误');
const real = errs.filter((e) => !/favicon|DevTools|Download the React/i.test(e));
ok('没有 JS 运行时错误', real.length === 0, real.slice(0, 4));

await browser.close();
stopIsolatedServer();
aiSrv.close();
console.log('\n========================================');
console.log('  课表导入验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
