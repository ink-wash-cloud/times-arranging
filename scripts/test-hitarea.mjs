// 全站「点得到」体检：每个看得见的控件，用中心点做命中测试
//
// 起因：课表工具栏的「⋯ 更多」菜单被下面那张课表卡盖住了。
// .card 带 backdrop-filter，每张卡自己就是一个层叠上下文，菜单的 z-index: 60
// 只在卡片内部有效，出了卡片就按卡片顺序排（后一张卡压在上面）。
// 于是「清空课表」这个菜单项画得出来、点不到 —— 只查 DOM 的断言永远发现不了，
// 必须用 elementFromPoint 看那个坐标上到底是谁。
//
// 这里把「所有可见控件中心点必须命中它自己」当成一条通用不变量，每个页面扫一遍；
// 再把课表的「更多」菜单单独展开，逐个菜单项扫。
import { launch, openApp, clickText, click, go, sleep, text, waitText, report } from './e2e.mjs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const PORT = Number(process.env.TEST_PORT || 8878);
const r = report('全站可点性');
const PAGES = [
  ['今日总览', '.dash'],
  ['待办事项', '.tasks, .task-page, .list-page'],
  ['习惯打卡', '.habits, .habit-page'],
  ['灵感池', '.insp, .insp-page'],
  ['重要日期', '.dates, .date-page'],
  ['我的课表', '.tt'],
  ['设置与同步', '.set-list, .settings, .set-page'],
];

/* 固定悬浮层：它们本来就盖在内容上，被盖到的控件不算 bug（记 skip） */
const FLOATING = ['.fab', '.toast', '.notif-banner', '.fps-meter'];

async function scan(page) {
  return page.evaluate((floatingSel) => {
    const txt = (el) => ((el.innerText || el.getAttribute('aria-label') || el.title || el.tagName) + '').replace(/\s+/g, ' ').trim().slice(0, 30);
    const covers = floatingSel
      .flatMap((s) => Array.from(document.querySelectorAll(s)))
      .filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      })
      .map((el) => el.getBoundingClientRect());

    const insideCover = (x, y) => covers.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
    const bad = [];
    const skipped = [];
    const nodes = Array.from(document.querySelectorAll('button, .chip, a[href], [role="menuitem"], [role="button"], .nav-item, .tabbar-item'));
    for (const el of nodes) {
      if (el.disabled) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (el.closest('.modal-mask')) continue;           // 弹窗里的另算
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const b = el.getBoundingClientRect();
      if (b.width < 8 || b.height < 8) continue;
      const x = b.left + b.width / 2;
      const y = b.top + b.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      if (insideCover(x, y)) { skipped.push(txt(el)); continue; }
      const hit = document.elementFromPoint(x, y);
      if (!hit) { bad.push({ el: txt(el), hit: '(命中不到任何元素)' }); continue; }
      if (hit === el || el.contains(hit)) continue;
      // 命中了它的祖先（自己 pointer-events: none 之类）也算点不到
      bad.push({ el: txt(el), hit: hit.tagName.toLowerCase() + '.' + String(hit.className || '').split(' ').filter(Boolean).slice(0, 2).join('.'), byName: (hit.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24) });
    }
    return { bad, skipped, total: nodes.length };
  }, floatingSel);
}

/* 展开的菜单/弹层：逐个条目做同样的命中测试 */
async function scanPopover(page, itemSel) {
  return page.evaluate((sel) => {
    const bad = [];
    const items = Array.from(document.querySelectorAll(sel));
    for (const el of items) {
      const b = el.getBoundingClientRect();
      if (b.width < 8 || b.height < 8) continue;
      const x = b.left + b.width / 2;
      const y = b.top + b.height / 2;
      const hit = document.elementFromPoint(x, y);
      const label = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20);
      if (!hit || !(hit === el || el.contains(hit))) {
        bad.push({ item: label, hit: hit ? hit.tagName.toLowerCase() + '.' + String(hit.className || '').split(' ').filter(Boolean).slice(0, 2).join('.') : '(空)' });
      }
    }
    return { bad, count: items.length };
  }, itemSel);
}

const floatingSel = FLOATING;
let browser = null;
try {
  const URL = await startIsolatedServer(PORT);
  const L = await launch({ width: 1400, height: 1000 });
  browser = L.browser;
  const page = L.page;
  await openApp(page, URL);

  // 先造一门课，课表的「更多」菜单才会出现「清空课表」那一项
  await go(page, '我的课表');
  await page.waitForSelector('.tt', { timeout: 8000 });
  await sleep(500);
  await clickText(page, 'button', '更多');
  await sleep(350);
  await clickText(page, '[role="menuitem"]', '手动添加课程');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await page.evaluate(() => {
    const inp = document.querySelector('.modal input.input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '可点性探测课');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(200);
  await clickText(page, '.modal-foot button', '添加');
  await sleep(1000);

  for (const [label, sel] of PAGES) {
    await go(page, label);
    await sleep(700);
    const res = await scan(page);
    r.ok('「' + label + '」所有可见控件都点得到（' + res.total + ' 个候选）', res.bad.length === 0, res.bad.slice(0, 6));
    if (res.skipped.length) r.note(label + ' 有 ' + res.skipped.length + ' 个控件被悬浮层盖住，已跳过');
  }

  // 课表「⋯ 更多」菜单：这是这次真被盖住的地方
  await go(page, '我的课表');
  await page.waitForSelector('.tt', { timeout: 8000 });
  await sleep(600);
  await clickText(page, 'button', '更多');
  await sleep(450);
  const menu = await scanPopover(page, '.tt-more-item');
  r.ok('课表「⋯ 更多」菜单的每一项都点得到（' + menu.count + ' 项）', menu.count >= 4 && menu.bad.length === 0, menu);

  // 收菜单有两条路：Esc（v1.6.0 加的）和点别处。
  // 注意：以前这里点左边「空白处」的固定坐标（24,420），侧栏加到 9 项后那个点正好压在
  // 「消费记录」上，点完就跳页了，后面的用例全都点不到「更多」。现在改成点顶栏标题，
  // 它不会触发任何导航。
  const menuOpen = () => page.evaluate(() => { const el = document.querySelector('.tt-more-menu'); return !!el && getComputedStyle(el).display !== 'none'; });
  await page.keyboard.press('Escape');
  await sleep(320);
  r.ok('按 Esc 能收起「⋯ 更多」菜单', !(await menuOpen()), null);

  await clickText(page, 'button', '更多');
  await sleep(350);
  const title = await page.$('.topbar h1');
  if (title) { await title.click(); } else { await page.mouse.click(400, 20); }
  await sleep(350);
  if (await menuOpen()) { await page.keyboard.press('Escape'); await sleep(250); }
  const stillOnTt = (await text(page, '.topbar h1')).includes('我的课表');
  r.ok('点别处能收起「⋯ 更多」菜单，且不会顺手跳到别的页', !(await menuOpen()) && stillOnTt, { open: await menuOpen(), title: await text(page, '.topbar h1') });

  // 弹窗里的按钮也扫一遍（用「手动添加课程」这个弹窗）
  await clickText(page, 'button', '更多');
  await sleep(350);
  await clickText(page, '[role="menuitem"]', '手动添加课程');
  await page.waitForSelector('.modal', { timeout: 5000 });
  await sleep(400);
  const modalScan = await page.evaluate(() => {
    const bad = [];
    const box = document.querySelector('.modal');
    for (const el of Array.from(box.querySelectorAll('button, a[href], [role="button"]'))) {
      if (el.disabled) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const b = el.getBoundingClientRect();
      if (b.width < 8 || b.height < 8) continue;
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) {
        bad.push({ el: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20), hit: hit ? hit.tagName.toLowerCase() : '(空)' });
      }
    }
    return bad;
  });
  r.ok('课程编辑弹窗里的按钮都点得到', modalScan.length === 0, modalScan.slice(0, 6));
  await page.keyboard.press('Escape');
  await sleep(300);

  await r.done(browser);
  browser = null;
} catch (e) {
  console.error('测试中途出错：', e && e.message ? e.message : e);
  r.ok('测试脚本未中途抛错', false, String(e && e.message ? e.message : e));
  if (browser) { try { await browser.close(); } catch { /* 已关 */ } }
  process.exitCode = 1;
} finally {
  try { stopIsolatedServer(); } catch { /* 没起来 */ }
}
