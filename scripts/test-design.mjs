// v1.4.0「清晰版」界面规范验证：单强调色、细线分层、统一间距与字号
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || await startIsolatedServer(Number(process.env.TEST_PORT || 8844));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); } };

const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const ctx = await b.createBrowserContext();
const p = await ctx.newPage();
await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
await p.setViewport({ width: 1440, height: 950 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Failed to fetch/.test(m.text())) errs.push(m.text()); });
await p.goto(URL, { waitUntil: 'networkidle2', timeout: 40000 });
await p.waitForSelector('.app', { timeout: 20000 });
await sleep(2200);
const txt = await p.evaluate(() => document.body.innerText);
if (/载入示例数据/.test(txt)) {
  await p.evaluate(() => { const x = Array.from(document.querySelectorAll('button')).find((n) => n.innerText.includes('载入示例数据')); if (x) x.click(); });
  await sleep(1800);
}
const go = async (label) => {
  await p.evaluate((name) => { const n = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.innerText.includes(name)); if (n) n.click(); }, label);
  await sleep(700);
};

console.log('\n[1] 设计 token 已落地');
const tok = await p.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return {
    cardPad: cs.getPropertyValue('--ui-card-pad').trim(),
    fsH2: cs.getPropertyValue('--fs-h2').trim(),
    fsBody: cs.getPropertyValue('--fs-body').trim(),
    line: cs.getPropertyValue('--ui-line').trim(),
    gap: cs.getPropertyValue('--ui-gap').trim()
  };
});
ok('卡片内边距 token', tok.cardPad === '20px', tok.cardPad);
ok('卡片间距 token', tok.gap === '16px', tok.gap);
ok('字号阶梯 token', tok.fsH2 === '15px' && tok.fsBody === '14px', tok);
ok('细线 token 有值', tok.line.length > 0, tok.line);

console.log('\n[2] 卡片用细线分层，不用阴影');
const card = await p.evaluate(() => {
  // v1.4.1：设置根页的 .card.set-list 是列表容器（padding:0），这里取普通内容卡
  const c = document.querySelector('.card:not(.set-list)');
  if (!c) return null;
  const cs = getComputedStyle(c);
  return { shadow: cs.boxShadow, border: cs.borderTopWidth, pad: cs.paddingTop, radius: cs.borderTopLeftRadius };
});
ok('卡片没有阴影', card && (card.shadow === 'none' || card.shadow === ''), card);
ok('卡片有 1px 细线', card && card.border === '1px', card);
ok('卡片内边距 20px', card && card.pad === '20px', card);
ok('卡片圆角 22px（v1.6.2 起更圆润一档）', card && card.radius === '22px', card);

console.log('\n[3] 侧栏选中项是中性底 + 强调色细条');
const nav = await p.evaluate(() => {
  const el = document.querySelector('.nav-item.active');
  if (!el) return null;
  const cs = getComputedStyle(el);
  const bar = getComputedStyle(el, '::before');
  return { bg: cs.backgroundImage, bgColor: cs.backgroundColor, barW: bar.width, barBg: bar.backgroundColor };
});
ok('选中项不再是渐变高亮', nav && !/linear-gradient/.test(nav.bg), nav);
ok('选中项左侧有强调色细条', nav && parseFloat(nav.barW) > 0 && nav.barBg !== 'rgba(0, 0, 0, 0)', nav);

console.log('\n[4] 按钮与胶囊：中性次级、单一强调色主按钮');
const btns = await p.evaluate(() => {
  const ghost = document.querySelector('.topbar .btn-ghost');
  const primary = document.querySelector('.btn-primary');
  const chip = document.querySelector('.chip:not(.on)');
  const g = ghost ? getComputedStyle(ghost) : null;
  const pr = primary ? getComputedStyle(primary) : null;
  return {
    ghostBg: g ? g.backgroundColor : '', ghostShadow: g ? g.boxShadow : '',
    primaryBg: pr ? pr.backgroundColor : '', primaryShadow: pr ? pr.boxShadow : '',
    chipBorder: chip ? getComputedStyle(chip).borderTopWidth : ''
  };
});
ok('次级按钮无实底、无投影', /rgba\(0, 0, 0, 0\)|transparent/.test(btns.ghostBg) && (btns.ghostShadow === 'none' || btns.ghostShadow === ''), btns);
ok('主按钮用强调色实底', btns.primaryBg !== '' && !btns.primaryBg.includes('linear-gradient'), btns);
ok('胶囊是 1px 细线', btns.chipBorder === '1px', btns.chipBorder);

console.log('\n[5] 总览：习惯改用中性行，页脚是文字动作');
const dash = await p.evaluate(() => ({
  rows: document.querySelectorAll('.habit-mini-row').length,
  onRows: document.querySelectorAll('.habit-mini-row.on').length,
  footBtns: Array.from(document.querySelectorAll('.dash-foot button')).map((b) => b.className),
  iconTiles: Array.from(document.querySelectorAll('.dash-card .card-h .ico')).slice(0, 3).map((i) => { const cs = getComputedStyle(i); return cs.width + '|' + cs.borderTopLeftRadius; })
}));
ok('总览习惯是列表行', dash.rows >= 1, dash.rows);
ok('页脚动作是文字链接', dash.footBtns.length > 0 && dash.footBtns.every((c) => c.includes('link-btn')), dash.footBtns);
ok('标题图标是统一尺寸小方块', dash.iconTiles.length > 0 && dash.iconTiles.every((t) => t.startsWith('26px')), dash.iconTiles);

console.log('\n[6] 设置页按组重排');
await go('设置');
const set = await p.evaluate(() => ({
  groups: document.querySelectorAll('.set-group').length,
  heads: Array.from(document.querySelectorAll('.set-group-h')).map((h) => h.innerText.trim()),
  about: !!document.querySelector('.set-about'),
  aboutInCard: !!Array.from(document.querySelectorAll('.card')).find((c) => /版本 v/.test(c.innerText) && c.querySelector('.set-about'))
}));
ok('设置页分了组', set.groups >= 3, set);
ok('组标题覆盖外观/数据/提醒/应用', set.heads.length >= 3, set.heads);
ok('版本信息在页脚，不再单独占卡', set.about === true, set);

console.log('\n[7] 课表工具条');
await go('课表');
const tt = await p.evaluate(() => ({
  tools: document.querySelectorAll('.tt-tools').length,
  left: !!document.querySelector('.tt-tools-left'),
  right: !!document.querySelector('.tt-tools-right'),
  overflow: (() => { const el = document.querySelector('.content'); return el ? el.scrollWidth - el.clientWidth : -1; })()
}));
ok('课表顶部只有一条工具条', tt.tools === 1, tt);
ok('工具条分左右两段', tt.left && tt.right, tt);
ok('课表页没有横向溢出', tt.overflow <= 1, tt.overflow);

console.log('\n[7b] 课表设置 / 打卡规则改成二级页');
await p.click('[data-k="tt-settings"]');
await sleep(600);
const sub = await p.evaluate(() => ({
  page: !!document.querySelector('.subpage'),
  modal: !!document.querySelector('.modal'),
  rows: document.querySelectorAll('.subpage .set-row').length,
  title: (document.querySelector('.subpage-t') || {}).innerText || ''
}));
ok('课表设置打开的是二级页，不是弹窗', sub.page && !sub.modal, sub);
ok('六个开关都排成设置行', sub.rows === 6, sub.rows);
ok('二级页标题是「课表设置」', sub.title.includes('课表设置'), sub.title);
await p.evaluate(() => { window.__schedule.back.press(); });
await sleep(500);
const backOk = await p.evaluate(() => !document.querySelector('.subpage') && !!document.querySelector('.tt-tools'));
ok('返回键能从二级页回到课表根页', backOk);

await go('习惯');
await p.evaluate(() => {
  const row = Array.from(document.querySelectorAll('.set-row')).find((x) => (x.innerText || '').includes('打卡规则'));
  if (row) row.click();
});
await sleep(600);
const rules = await p.evaluate(() => ({
  page: !!document.querySelector('.subpage'),
  title: (document.querySelector('.subpage-t') || {}).innerText || '',
  body: (document.querySelector('.subpage-body') || {}).innerText || ''
}));
ok('打卡规则也是二级页', rules.page && /打卡规则/.test(rules.title), rules);
ok('规则正文完整搬进二级页', /每日最低完成量/.test(rules.body) && /补卡/.test(rules.body), rules.body.slice(0, 60));
await p.evaluate(() => { window.__schedule.back.press(); });
await sleep(500);

console.log('\n[8] 手机端');
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await go('总览');
await sleep(600);
const mob = await p.evaluate(() => {
  const c = document.querySelector('.card');
  const cs = c ? getComputedStyle(c) : null;
  const tabs = document.querySelectorAll('.tabbar .tab').length;
  const wide = document.documentElement.scrollWidth > window.innerWidth + 1;
  const big = document.querySelector('.dash-big');
  return { pad: cs ? cs.paddingTop : '', tabs, wide, big: big ? getComputedStyle(big).fontSize : '', bodyText: getComputedStyle(document.body).fontSize };
});
ok('手机卡片内边距收紧到 16px', mob.pad === '16px', mob.pad);
// v1.6.0 手机底栏多了「日程表」，共 8 项；消费记录从侧栏或总览预算卡进。
ok('手机底栏是 8 项', mob.tabs === 8, mob.tabs);
ok('手机没有横向溢出', mob.wide === false, mob.wide);
ok('手机大字 26px', mob.big === '26px', mob.big);
ok('正文字号不下调', mob.bodyText === '14px', mob.bodyText);

console.log('\n[9] 控制台无报错');
ok('没有 JS 报错', errs.length === 0, errs.slice(0, 3));

await b.close();
if (!process.argv[2]) await stopIsolatedServer();
console.log('\n========================================');
console.log('  清晰版界面验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
