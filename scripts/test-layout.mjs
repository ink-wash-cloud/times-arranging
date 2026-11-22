// 移动端布局检查：每个栏目都不能横向溢出
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
mkdirSync('shots4', { recursive: true });
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 默认起隔离实例：浏览器里的应用首次打开会自己播种一份演示数据并推送到服务器，
// 打真实库会凭空多出一整套重复的演示数据（任务/习惯/纪念日全部翻倍）。
// 需要打真实服务器时显式传 URL。
const EXPLICIT = process.argv[2] || '';
const URL = EXPLICIT || await startIsolatedServer(Number(process.env.TEST_PORT || 8792));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); } };

const VIEWS = [
  ['总览', 'dash'], ['待办事项', 'tasks'], ['习惯打卡', 'habits'],
  ['灵感池', 'insp'], ['重要日期', 'dates'], ['我的课表', 'tt'], ['设置与同步', 'settings']
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
try {
  for (const W of [320, 360, 390]) {
    const page = await (await browser.createBrowserContext()).newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.setViewport({ width: W, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto(URL, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.app');
    await page.waitForFunction(() => !/欢迎使用时序/.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
    await sleep(2000);

    // 「时间池」只列没有截止日期的待办。演示数据里可能一条都没有，
    // 那样下面针对时间池的断言会因为"元素根本不存在"而假失败。
    // 自己造一条，测试就不该依赖库里现成的数据。
    await page.evaluate(async () => {
      const s = window.__schedule;
      if (!s) return;
      await s.putRecord('tasks', s.newId(), {
        title: '布局检查用待办（故意不填截止日期，用来占据时间池）',
        category: '杂事', priority: 'P2', status: '未开始', dueDate: '',
        estimateMin: 30, repeat: 'none', note: ''
      });
    });
    await sleep(900);

    console.log('\n[宽度 ' + W + 'px]');
    for (const [label, key] of VIEWS) {
      await page.evaluate((k) => { const b = Array.from(document.querySelectorAll('.tab')).find((x) => x.getAttribute('data-k') === k) || Array.from(document.querySelectorAll('.tab')).find((x) => x.innerText.includes(k)); if (b) b.click(); }, key);
      await page.evaluate((idx) => { const tabs = document.querySelectorAll('.tabbar .tab'); if (tabs[idx]) tabs[idx].click(); }, VIEWS.findIndex((v) => v[0] === label));
      await sleep(700);
      const r = await page.evaluate(() => {
        const vw = window.innerWidth;
        const doc = document.documentElement;
        // 找出真正超出视口右边界的元素（排除自己就能横向滚动的容器）
        const offenders = [];
        document.querySelectorAll('.content-inner *').forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          if (rect.right > vw + 2) {
            // 只有明确用于横向滚动的容器（如课表 .tt-wrap）才豁免。
            // 注意：.content 是纵向滚动容器，它的 overflow-x 计算值也是 auto，
            //       不能用"有 overflow-x"来判断，否则会漏掉真正的溢出。
            let p = el.parentElement, scrollable = false;
            while (p && p !== document.body && !p.classList.contains('content')) {
              const cs = getComputedStyle(p);
              if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') { scrollable = true; break; }
              p = p.parentElement;
            }
            if (!scrollable) offenders.push((el.className || el.tagName).toString().split(' ').slice(0, 2).join('.') + ' → right=' + Math.round(rect.right));
          }
        });
        const inner = document.querySelector('.content-inner');
        const innerW = inner ? Math.round(inner.getBoundingClientRect().width) : vw;
        return { pageScrollW: doc.scrollWidth, vw, innerW, offenders: offenders.slice(0, 4) };
      });
      ok(label + ' 无横向溢出',
        r.pageScrollW <= r.vw + 2 && r.offenders.length === 0,
        { scrollW: r.pageScrollW, vw: r.vw, offenders: r.offenders });
      // v1.4.1：设置改成二级页后，子页也要单独检查（根页只有列表，不能代表子页）
      if (key === 'settings') {
        for (const id of ['look', 'bg', 'colors', 'sync']) {
          await page.evaluate((x) => window.__schedule.ui.openSettingsPage(x), id);
          await sleep(500);
          const sub = await page.evaluate(() => {
            const vw = window.innerWidth;
            const offenders = [];
            document.querySelectorAll('.content-inner *').forEach((el) => {
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) return;
              if (rect.right > vw + 2) {
                let p = el.parentElement, scrollable = false;
                while (p && p !== document.body && !p.classList.contains('content')) {
                  const cs = getComputedStyle(p);
                  if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') { scrollable = true; break; }
                  p = p.parentElement;
                }
                if (!scrollable) offenders.push((el.className || el.tagName).toString().split(' ').slice(0, 2).join('.') + ' → right=' + Math.round(rect.right));
              }
            });
            return { pageScrollW: document.documentElement.scrollWidth, vw, offenders: offenders.slice(0, 4) };
          });
          ok('设置 · ' + id + ' 无横向溢出', sub.pageScrollW <= sub.vw + 2 && sub.offenders.length === 0, sub);
        }
        await page.evaluate(() => window.__schedule.ui.openSettingsPage('root'));
        await sleep(300);
      }
    }

    if (W === 390) {
      // 专项：总览页「快速添加 + 时间池」在手机上必须是单列
      await page.evaluate(() => { const t = document.querySelectorAll('.tabbar .tab'); if (t[0]) t[0].click(); });
      await sleep(800);
      const two = await page.evaluate(() => {
        const g = document.querySelector('.two-col');
        if (!g) return null;
        const kids = Array.from(g.children).map((c) => c.getBoundingClientRect());
        const cs = getComputedStyle(g);
        return {
          columns: cs.gridTemplateColumns,
          stacked: kids.length >= 2 ? kids[1].top >= kids[0].bottom - 2 : true,
          cardW: Math.round(kids[0].width),
          vw: window.innerWidth
        };
      });
      ok('总览两列区在手机上折成单列', !!two && two.stacked, two);
      ok('时间池卡片宽度接近整屏', !!two && two.cardW > two.vw * 0.8, two);

      const pool = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.pool-item'));
        const over = items.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.right > window.innerWidth + 2;
        }).length;
        const btns = Array.from(document.querySelectorAll('.pool-item .btn'));
        const clipped = btns.filter((b) => { const r = b.getBoundingClientRect(); return r.right > window.innerWidth + 2; }).length;
        const titles = Array.from(document.querySelectorAll('.pool-title'));
        return { items: items.length, over, btns: btns.length, clipped, titles: titles.length };
      });
      ok('时间池条目没有超出屏幕', pool.over === 0, pool);
      ok('时间池按钮没有被挤出屏幕', pool.clipped === 0, pool);
      ok('时间池标题用了可省略样式', pool.titles > 0, pool);
      await page.evaluate(() => { const c = document.querySelector('.two-col'); if (c) c.scrollIntoView({ block: 'start' }); });
      await sleep(500);
      await page.screenshot({ path: 'shots4/pool-mobile.png' });
    }

    const real = errs.filter((e) => !/favicon|DevTools/i.test(e));
    ok('宽度 ' + W + ' 无 JS 错误', real.length === 0, real.slice(0, 3));
  }
} catch (e) {
  fail++; console.log('  FAIL  中断: ' + (e && e.stack || e));
} finally { await browser.close(); stopIsolatedServer(); }
console.log('\n========================================');
console.log('  布局检查通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
