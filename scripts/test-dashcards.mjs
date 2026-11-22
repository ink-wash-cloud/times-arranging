// 总览页卡片：长按（手机）/ 右键（电脑）拿掉，页尾的通栏 ＋ 自己加回来
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8801);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000 });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2200);

const ids = () => p.$$eval('.dash-card[data-card]', (els) => els.map((e) => e.getAttribute('data-card')));
const modalText = async () => p.$eval('.modal', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
const clickFoot = async (word) => p.evaluate((w) => {
  const btn = Array.from(document.querySelectorAll('.modal-foot button')).find((x) => x.innerText.includes(w));
  if (btn) btn.click();
}, word);

// 造一条待办 + 本月预算，免得停在欢迎页
await p.evaluate(async () => {
  const s = window.__schedule;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const month = d.getFullYear() + '-' + pad(d.getMonth() + 1);
  await s.putRecord('tasks', 't-dash-1', {
    title: '测试待办', category: '学习', dueDate: today, dueTime: null, priority: 'P2',
    status: '未开始', estimateMinutes: 30, repeat: '不重复', note: '', anniversaryId: null,
    completedAt: null, createdAt: Date.now()
  });
  await s.putRecord('budgets', month, { amount: 1200 });
});
await sleep(1200);
await p.evaluate(() => { location.hash = '#dash'; });
await sleep(900);

console.log('\n[1] 默认布局');
let list = await ids();
ok('默认五张卡片、顺序固定', list.join(',') === 'tasks,habits,anniversary,budget,life', list);
const place = await p.evaluate(() => {
  const add = document.querySelector('.dash-add');
  const cards = Array.from(document.querySelectorAll('.content-inner > .card, .content-inner > .two-col'))
    .filter((el) => !el.classList.contains('dash-add'));
  const last = cards[cards.length - 1];
  return {
    exists: !!add,
    text: add ? add.innerText.replace(/\s+/g, ' ') : '',
    inGrid: !!document.querySelector('.dash-grid .dash-add'),
    addTop: add ? Math.round(add.getBoundingClientRect().top) : -1,
    lastTop: last ? Math.round(last.getBoundingClientRect().top) : -2,
    lastText: last ? last.innerText.slice(0, 12) : ''
  };
});
ok('页尾有「＋ 添加卡片」通栏', place.exists && /＋/.test(place.text) && /添加卡片/.test(place.text), place.text);
ok('加号不在卡片格里了', !place.inGrid);
ok('加号排在总览最下面（今日课程之后）', place.addTop > place.lastTop, place);

console.log('\n[2] 长按拿掉一张');
const box = await (await p.$('.dash-card[data-card="budget"]')).boundingBox();
await p.mouse.move(box.x + box.width / 2, box.y + 22);
await p.mouse.down();
await sleep(260);
ok('按住 260ms 出现「继续按住可拿掉」的反馈', await p.$eval('.dash-card[data-card="budget"]', (e) => e.classList.contains('armed')));
ok('还没到时间，不提前弹窗', !(await p.$('.modal')));
await sleep(420);
await p.mouse.up();
await sleep(700);
const dlg = await modalText();
ok('长按后弹确认框', /本月预算使用/.test(dlg) && /拿掉/.test(dlg), dlg.slice(0, 90));
await clickFoot('拿掉');
await sleep(800);
list = await ids();
ok('预算卡片从总览消失', !list.includes('budget') && list.length === 4, list);
const cfgCards = await p.evaluate(() => window.__schedule.cfg.dashCards);
ok('布局记进了本机配置', Array.isArray(cfgCards) && cfgCards.length === 4 && !cfgCards.includes('budget'), cfgCards);
const toastTxt = await p.$eval('.toast-wrap', (e) => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
ok('提示里说了还能加回来', /加回来/.test(toastTxt), toastTxt);

console.log('\n[3] 安卓式长按：系统先发 contextmenu');
const hb2 = await (await p.$('.dash-card[data-card="habits"]')).boundingBox();
await p.mouse.move(hb2.x + hb2.width / 2, hb2.y + 20);
await p.mouse.down();
await sleep(280);
await p.evaluate(() => {
  const el = document.querySelector('.dash-card[data-card="habits"]');
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
});
await sleep(400);
const dlgA = await modalText();
ok('系统长按信号到了就直接弹确认框', /今日习惯打卡/.test(dlgA), dlgA.slice(0, 80));
await p.mouse.up();
await sleep(300);
await clickFoot('取消');
await sleep(500);
list = await ids();
ok('取消之后卡片还在', list.includes('habits') && list.length === 4, list);

console.log('\n[4] 刷新后还在');
await p.reload({ waitUntil: 'networkidle2' });
await sleep(2600);
list = await ids();
ok('刷新之后布局不变', !list.includes('budget') && list.length === 4, list);

console.log('\n[5] 页尾的 ＋ 自己挑');
await p.click('.dash-add');
await sleep(700);
const rows = await p.$$eval('.dash-pick', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
ok('面板列出全部五张卡片', rows.length === 5, rows.length);
ok('已在总览上的标「已添加」', /已添加/.test(rows.find((r) => r.includes('今日待办完成度')) || ''), rows[0]);
ok('拿掉的卡片给出「添加」按钮', /添加/.test(rows.find((r) => r.includes('本月预算使用')) || ''), rows[3]);
await p.evaluate(() => {
  const t = Array.from(document.querySelectorAll('.dash-pick')).find((e) => e.innerText.includes('本月预算使用'));
  t.querySelector('button').click();
});
await sleep(800);
list = await ids();
ok('点「添加」之后卡片回到总览', list.includes('budget') && list.length === 5, list);
await clickFoot('完成');
await sleep(500);

console.log('\n[6] 卡片里的按钮不受影响');
const btn = await p.$('.dash-card[data-card="tasks"] .dash-foot button');
const bb = await btn.boundingBox();
await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await p.mouse.down();
await sleep(820);
await p.mouse.up();
await sleep(700);
ok('长按卡片里的按钮不会弹确认框', !(await p.$('.modal')));
await p.evaluate(() => { location.hash = '#dash'; });
await sleep(800);

console.log('\n[7] 电脑右键 + 恢复默认');
const hb = await (await p.$('.dash-card[data-card="life"]')).boundingBox();
await p.mouse.click(hb.x + 26, hb.y + 20, { button: 'right' });
await sleep(700);
const dlg2 = await modalText();
ok('右键也能拿掉卡片', /人生最新一次/.test(dlg2), dlg2.slice(0, 80));
await clickFoot('拿掉');
await sleep(800);
list = await ids();
ok('右键拿掉生效', !list.includes('life') && list.length === 4, list);
await p.click('.dash-add');
await sleep(600);
await clickFoot('恢复默认');
await sleep(800);
list = await ids();
ok('「恢复默认」把五张都放回来', list.length === 5 && list.includes('life'), list);
const resetCfg = await p.evaluate(() => window.__schedule.cfg.dashCards);
ok('默认清单写回本机配置', Array.isArray(resetCfg) && resetCfg.length === 5, resetCfg);
await clickFoot('完成');
await sleep(500);
await p.screenshot({ path: 'shots-final/dash-cards.png' });

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
await b.close();
stopIsolatedServer();
process.exit(fail ? 1 : 0);
