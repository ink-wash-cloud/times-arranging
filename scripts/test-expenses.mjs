// 消费记录页专项回归：全量历史、四类筛选、记账/编辑/删除撤销、CSV、200 条分页、390px。
//
// 关键回归点是金额：0.1 + 0.2 必须显示 ¥0.30，不能冒出 0.30000000000000004；
// 预算剩余和百分比也必须跟着一起走 round2。
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
};

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const y = now.getFullYear();
const m = now.getMonth() + 1;
const curMonth = y + '-' + pad(m);
const prevD = new Date(y, m - 2, 1);
const prevMonth = prevD.getFullYear() + '-' + pad(prevD.getMonth() + 1);
const priorYear = (y - 1) + '-12-31';
const yearExpected = (m === 1 ? 0.3 : 25.8).toFixed(2);

const URL = process.argv[2] || await startIsolatedServer(8882);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.setViewport({ width: 1440, height: 1000 });
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForSelector('.app');
await sleep(2200);
await page.evaluate(() => { location.hash = '#expenses'; });
await sleep(1500);

const txt = (sel) => page.$eval(sel, (el) => el.innerText.replace(/\s+/g, ' ').trim());
const countRows = () => page.$$eval('.exp-row', (els) => els.length);
const hasSel = async (sel) => !!(await page.$(sel));
const clickChip = (label) => page.evaluate((label) => {
  const b = [...document.querySelectorAll('.exp-filters .chip')].find((x) => x.innerText.trim() === label);
  if (b) b.click();
  return !!b;
}, label);
const setField = (testid, value) => page.evaluate((id, value) => {
  const el = document.querySelector('[data-testid="' + id + '"]');
  if (!el) return false;
  const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  if (el.tagName !== 'SELECT') el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, testid, value);
const clickRowButton = (title, label) => page.evaluate((title, label) => {
  const row = [...document.querySelectorAll('.exp-row')].find((r) => r.innerText.includes(title));
  if (!row) return false;
  const b = [...row.querySelectorAll('button')].find((x) => x.innerText.trim() === label);
  if (!b) return false;
  b.click();
  return true;
}, title, label);

// 先塞三条会暴露浮点误差和“今年”口径的数据：0.1 + 0.2、上个月、去年。
await page.evaluate(async (curMonth, prevMonth, priorYear) => {
  const put = window.__schedule.putRecord;
  await put('expenses', 'seed-food', { title: '早餐', amount: 0.1, category: '餐饮', date: curMonth + '-05', createdAt: Date.now() - 3 });
  await put('expenses', 'seed-traffic', { title: '地铁', amount: 0.2, category: '交通', date: curMonth + '-10', createdAt: Date.now() - 2 });
  await put('expenses', 'seed-shopping', { title: '超市', amount: 25.5, category: '购物', date: prevMonth + '-10', createdAt: Date.now() - 1 });
  await put('expenses', 'seed-last-year', { title: '去年的书', amount: 99, category: '学习', date: priorYear, createdAt: Date.now() - 4 });
  await put('budgets', curMonth, { amount: 100 });
}, curMonth, prevMonth, priorYear);
await sleep(1600);

console.log('\n[1] 汇总卡：金额按分显示，预算剩余/百分比跟着 round2');
ok('消费记录页渲染出来了', await hasSel('[data-testid="expenses-page"]'));
const summary = await txt('[data-testid="exp-summary"]');
ok('本月已花是 ¥0.30（0.1 + 0.2 没有长小数）', summary.includes('¥0.30') && !summary.includes('000000'), summary);
ok('预算剩余 ¥99.70', summary.includes('预算 ¥100.00') && summary.includes('剩余 ¥99.70'), summary);
ok('预算百分比按分显示 0.3%', summary.includes('已用 0.3%'), summary);
ok('上月是 ¥25.50', summary.includes('¥25.50'), summary);
ok('今年合计不含去年的记录', summary.includes('¥' + yearExpected), { summary, yearExpected });
ok('列表头显示共 4 笔', (await txt('.exp-count')).includes('共 4 笔'));

console.log('\n[1b] 总览预算卡也走 round2，并能跳到全部记录');
await page.evaluate(() => { location.hash = '#dash'; });
await sleep(1100);
const dashCard = await page.evaluate(() => {
  const c = [...document.querySelectorAll('.card')].find((x) => x.innerText.includes('本月预算使用'));
  return c ? c.innerText.replace(/\s+/g, ' ').trim() : '';
});
ok('总览预算卡显示 ¥0.30 / ¥100.00', dashCard.includes('¥0.30') && dashCard.includes('¥100.00'), dashCard);
ok('总览预算卡剩余 ¥99.70、已用 0.3%', dashCard.includes('剩余 ¥99.70') && dashCard.includes('已用 0.3%'), dashCard);
ok('总览预算卡有「全部记录 →」', dashCard.includes('全部记录'));
const jumped = await page.evaluate(() => {
  const c = [...document.querySelectorAll('.card')].find((x) => x.innerText.includes('本月预算使用'));
  const b = c && [...c.querySelectorAll('button,a')].find((x) => x.innerText.includes('全部记录'));
  if (b) b.click();
  return !!b;
});
await sleep(1000);
ok('点「全部记录 →」真的进了消费记录页', jumped && (await page.evaluate(() => location.hash)) === '#expenses' && (await hasSel('[data-testid="expenses-page"]')));

console.log('\n[2] 按月份分组、组头合计与笔数');
ok('渲染出 3 个月份组', (await page.$$eval('.exp-group', (x) => x.length)) === 3);
const groupText = await page.$$eval('.exp-group-head', (els) => els.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
ok('本月组头是 ¥0.30 · 2 笔', groupText.some((x) => x.includes('¥0.30') && x.includes('2 笔')), groupText);
ok('上月组头是 ¥25.50 · 1 笔', groupText.some((x) => x.includes('¥25.50') && x.includes('1 笔')), groupText);
ok('老分类「学习」显示成「其它」', (await txt('[data-testid="exp-list"]')).includes('去年的书') && (await txt('[data-testid="exp-list"]')).includes('其它'));

console.log('\n[3] 四类筛选');
ok('点「餐饮」筛出 1 笔', await clickChip('餐饮'));
await sleep(400);
ok('餐饮筛选后只有 1 行', (await countRows()) === 1);
ok('筛选计数是「筛出 1 笔 · 共 4 笔」', (await txt('.exp-count')).includes('筛出 1 笔') && (await txt('.exp-count')).includes('共 4 笔'));
ok('筛选不影响上方汇总（仍是 ¥0.30）', (await txt('[data-testid="exp-summary"]')).includes('¥0.30'));
await clickChip('购物'); await sleep(300);
ok('购物筛选能筛到上个月的超市记录', (await txt('[data-testid="exp-list"]')).includes('超市'));
await clickChip('其它'); await sleep(300);
ok('其它筛选包含老分类「学习」', (await txt('[data-testid="exp-list"]')).includes('去年的书'));
await clickChip('全部'); await sleep(300);
ok('回到全部后 4 行', (await countRows()) === 4);

console.log('\n[4] 记一笔：日期可选、金额两位小数');
await page.click('[data-testid="exp-add"]');
await sleep(600);
ok('打开记一笔弹窗', (await txt('.modal h3')).includes('记一笔'));
await setField('exp-title', '打印资料');
await setField('exp-amount', '24');
await setField('exp-date', curMonth + '-12');
await setField('exp-cat', '其它');
await page.click('[data-testid="exp-save"]');
await sleep(1100);
ok('弹窗关闭', !(await hasSel('.modal')));
ok('新记录出现在列表里', (await txt('[data-testid="exp-list"]')).includes('打印资料'));
ok('新记录金额显示 ¥24.00', (await txt('[data-testid="exp-list"]')).includes('¥24.00'));
const afterAdd = await txt('[data-testid="exp-summary"]');
ok('本月已花变成 ¥24.30', afterAdd.includes('¥24.30'), afterAdd);
ok('预算剩余同步变成 ¥75.70', afterAdd.includes('剩余 ¥75.70'), afterAdd);
ok('预算百分比同步变成 24.3%', afterAdd.includes('已用 24.3%'), afterAdd);

console.log('\n[5] 编辑：改金额和日期，汇总/分组跟着变');
ok('找到打印资料的编辑按钮', await clickRowButton('打印资料', '编辑'));
await sleep(600);
ok('弹窗标题是编辑记录', (await txt('.modal h3')).includes('编辑记录'));
ok('编辑弹窗回填名称', (await page.$eval('[data-testid="exp-title"]', (e) => e.value)) === '打印资料');
await setField('exp-amount', '25.5');
await setField('exp-date', prevMonth + '-20');
await page.click('[data-testid="exp-save"]');
await sleep(1100);
const afterEdit = await txt('[data-testid="exp-summary"]');
ok('改到上月后本月已花回到 ¥0.30', afterEdit.includes('¥0.30'), afterEdit);
ok('上月合计变成 ¥51.00', afterEdit.includes('¥51.00'), afterEdit);
const editedGroups = await page.$$eval('.exp-group-head', (els) => els.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
ok('上月组头变成 2 笔', editedGroups.some((x) => x.includes('¥51.00') && x.includes('2 笔')), editedGroups);

console.log('\n[6] 删除 + 撤销');
ok('找到打印资料的删除按钮', await clickRowButton('打印资料', '删除'));
await sleep(500);
ok('删除后列表里没有打印资料', !(await txt('[data-testid="exp-list"]')).includes('打印资料'));
const delToast = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.toast')].find((x) => x.innerText.includes('已删除'));
  return el ? { text: el.innerText.replace(/\s+/g, ' ').trim(), hasUndo: !!el.querySelector('.toast-act') } : null;
});
ok('删除提示带撤销按钮', !!delToast && delToast.hasUndo && delToast.text.includes('撤销'), delToast);
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.toast')].find((x) => x.innerText.includes('已删除'));
  const b = el && el.querySelector('.toast-act');
  if (b) b.click();
});
await sleep(900);
ok('点撤销后记录回来了', (await txt('[data-testid="exp-list"]')).includes('打印资料'));
ok('撤销后金额仍是 ¥25.50', (await txt('[data-testid="exp-list"]')).includes('¥25.50'));

console.log('\n[7] 导出 CSV：表头、行数、字段');
const dbCount = await page.evaluate(() => window.__schedule.list('expenses').length);
await page.evaluate(() => {
  window.__csv = null;
  window.__csvBytes = null;
  window.__csvName = '';
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    blob.arrayBuffer().then((buf) => {
      const u = new Uint8Array(buf);
      window.__csvBytes = [u[0], u[1], u[2]];
      window.__csv = new TextDecoder('utf-8').decode(u);
    });
    return orig(blob);
  };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { window.__csvName = this.download; };
  window.__restoreCsvClick = () => { HTMLAnchorElement.prototype.click = origClick; };
});
await page.click('[data-testid="exp-export"]');
await sleep(900);
const csv = await page.evaluate(() => window.__csv);
const csvBytes = await page.evaluate(() => window.__csvBytes);
const csvName = await page.evaluate(() => window.__csvName);
ok('导出的文件名是 csv', /^expenses-\d{4}-\d{2}-\d{2}\.csv$/.test(csvName), csvName);
ok('CSV 文件头是 UTF-8 BOM（Excel 打开中文不乱码）', !!csvBytes && csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf, csvBytes);
const csvText = csv || '';
const csvLines = csvText.split(/\r?\n/);
ok('CSV 表头正确', csvLines[0] === '日期,名称,分类,金额', csvLines[0]);
ok('CSV 行数 = 数据库记录数 + 表头', csvLines.filter((x) => x.trim()).length === dbCount + 1, { got: csvLines.length, dbCount });
ok('CSV 里金额是两位小数', csvText.includes('打印资料,其它,25.50'), csvText.slice(0, 300));
await page.evaluate(() => window.__restoreCsvClick && window.__restoreCsvClick());

console.log('\n[8] 一次渲染 200 条 + 显示更多');
await page.evaluate(async (curMonth) => {
  const put = window.__schedule.putRecord;
  for (let i = 0; i < 205; i++) {
    await put('expenses', 'bulk-' + i, {
      title: '批量 ' + i, amount: 1, category: '餐饮', date: curMonth + '-01', createdAt: Date.now() + i
    });
  }
}, curMonth);
let first200 = false;
try {
  await page.waitForFunction(() => document.querySelectorAll('.exp-row').length === 200, { timeout: 20000 });
  first200 = true;
} catch { /* 落到下面的断言，输出实际行数 */ }
ok('先只渲染 200 行', first200 && (await countRows()) === 200, await countRows());
ok('显示更多按钮提示还有 10 条', first200 && (await txt('[data-testid="exp-show-more"]')).includes('还有 10 条'));
if (first200) {
  await page.click('[data-testid="exp-show-more"]');
  let all210 = false;
  try {
    await page.waitForFunction(() => document.querySelectorAll('.exp-row').length === 210, { timeout: 10000 });
    all210 = true;
  } catch { /* 同上 */ }
  ok('点显示更多后 210 行全出来', all210 && (await countRows()) === 210, await countRows());
} else {
  ok('点显示更多后 210 行全出来', false, '前一步没到 200 行');
}

console.log('\n[9] 390px 手机宽不横向溢出');
await page.setViewport({ width: 390, height: 844 });
await sleep(700);
const overflow = await page.evaluate(() => ({
  scroll: document.documentElement.scrollWidth,
  client: document.documentElement.clientWidth,
  page: (document.querySelector('.exp-page') || {}).getBoundingClientRect ? document.querySelector('.exp-page').getBoundingClientRect().width : 0
}));
ok('390px 下没有横向滚动', overflow.scroll <= overflow.client + 1, overflow);
ok('消费页仍然渲染', await hasSel('[data-testid="expenses-page"]'));

console.log('\n[10] 控制台');
ok('没有 JS 运行时错误', errs.length === 0, errs.slice(0, 3));

await browser.close();
if (!process.argv[2]) stopIsolatedServer();
console.log('\n========================================');
console.log('  消费记录验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
