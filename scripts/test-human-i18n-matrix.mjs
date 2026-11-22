// 真人流程测试：四种语言 × 全界面矩阵（task-19）
//
// 覆盖：
//   1. 简体基线：标题、字体、data-cjk、空态、日期
//   2. English / 日本語：九个页面（总览/待办/习惯/灵感/日期/课表/设置根页）
//      大标题与主要按钮不出现中文；正文不残留中文（日文允许汉字，查简体专用字）
//   3. 繁體中文：設定 / 資料 / 儲存 / 介面 / 這裡 / 週一，且无简体专有词
//   4. data-cjk 与 computed font-family 随语言切换（中文汉仪文黑，英日系统字体）
//   5. 刷新后语言保持
//   6. 日期/星期本地化：Oct 5, Mon / 10月5日（月）/ 10月5日 週一
//   7. 切语言不白屏，全程无 pageerror / 控制台错误
//
// 时钟固定到 2026-10-05 10:00（周一），让日期断言可复现；所有导航/切换都点真实控件。
// 「乾淨」目前只出现在图片分析结果里，没有稳定可达的 UI 入口，因此不做硬断言。
//
// 跑法：node scripts/test-human-i18n-matrix.mjs [url]
//   不给 url 时自己起隔离服务器（端口 8865）。
import {
  report, launch, openApp, reload, click, clickText, shot, state, sleep,
} from './e2e.mjs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const PORT = 8865;
const TITLE = '真人流程 · 四种语言全界面矩阵';
const r = report(TITLE);

// v1.6.0 侧栏新增「日程表」「消费记录」，共 9 项；设置仍然排最后。
const ZH = ['今日总览', '待办事项', '习惯打卡', '灵感池', '重要日期', '我的课表', '日程表', '消费记录', '设置与同步'];
const EN = ['Today', 'Tasks', 'Habit check-ins', 'Ideas', 'Dates', 'Timetable', 'Schedule', 'Expenses', 'Settings'];
const JA = ['今日の概要', 'タスク', '習慣チェックイン', 'アイデア', '記念日', '時間割', 'スケジュール', '支出記録', '設定と同期'];

// 只在日文界面里绝不出现的简体专用字（日文用新字体/繁体形，不会用这些字形）。
// 故意不放「数 体 会 国 与 当 条 称 据」等日文也在用的字。
const SIMPLIFIED_ONLY = /[设这们么过还删检阅让给对开关闭时间见车马门问闻读写说话语认识请谢边达运远进习惯灵发电报为课试验页题预备复务单张线变种积确简类统记忆应译输转换]/;

const cjk = (s) => (String(s).match(/[\u4e00-\u9fa5]/g) || []).length;
const kana = (s) => (String(s).match(/[\u3040-\u30ff]/g) || []).length;

let browser = null;
let page = null;
let errors = [];
const blank = [];

/** 读页面现状：只读，不改任何 store。 */
async function snap() {
  return page.evaluate(() => {
    const clean = (x) => (x ? (x.innerText || x.textContent || '') : '').replace(/\s+/g, ' ').trim();
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const navLabel = (el) => ((el.innerText || '').trim().split(/\n/).map((v) => v.trim()).filter(Boolean).pop() || '')
      .replace(/^[^\p{L}]+/u, '').trim();
    const root = document.documentElement;
    return {
      lang: root.getAttribute('data-lang'),
      htmlLang: root.lang,
      cjkFlag: root.getAttribute('data-cjk'),
      font: getComputedStyle(document.body).fontFamily,
      title: clean(document.querySelector('.topbar h1')),
      sub: clean(document.querySelector('.topbar .sub')),
      content: clean(document.querySelector('.content-inner')),
      body: document.body.innerText || '',
      nav: q('.nav-item').map(navLabel),
      buttons: Array.from(new Set(q('.content-inner button, .content-inner .btn, .topbar .btn').map(clean).filter(Boolean))),
      ttHead: q('.tt-head').map(clean).join(' | '),
      hasLangRow: !!document.querySelector('[data-testid="set-row-lang"]'),
      hasBack: !!document.querySelector('.subpage-back'),
      langOptions: q('[data-lang-id]').map((x) => x.getAttribute('data-lang-id')),
    };
  });
}

/** 真点侧栏；文字找不到时兜底按序号点，让后面的断言报出实际标题。 */
async function navTo(label, index) {
  try {
    await clickText(page, '.nav-item', label, { wait: 450 });
  } catch {
    await click(page, '.nav-item', { index, wait: 450 });
  }
  await sleep(250);
}

/** 设置页可能停在上一次的语言二级页，点返回回到根页。 */
async function ensureSettingsRoot() {
  if (await page.$('.subpage-back')) {
    await click(page, '.subpage-back', { wait: 500 });
  }
  await page.waitForSelector('[data-testid="set-row-lang"]', { timeout: 6000 });
  await sleep(250);
}

/** 打开 设置 → 语言（真实点击）。 */
async function openLangPanel() {
  // 设置是侧栏最后一项：按位置点，语言切换后文字会变
  await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.nav-item'));
    const last = items[items.length - 1];
    if (last) last.click();
  });
  await sleep(600);
  await ensureSettingsRoot();
  await click(page, '[data-testid="set-row-lang"]', { wait: 500 });
  await page.waitForSelector('[data-lang-id]', { timeout: 6000 });
  await sleep(250);
}

/** 通过设置页真实点选语言，并等到 html data-lang 变化。 */
async function switchLang(id) {
  await openLangPanel();
  await click(page, '[data-lang-id="' + id + '"]', { wait: 900 });
  await page.waitForFunction((x) => document.documentElement.getAttribute('data-lang') === x, { timeout: 8000 }, id);
  await sleep(600);
}

/** 依次点开九个页面并抓快照（最后一页是设置根页）。 */
async function scanPages(labels) {
  const rows = [];
  for (let i = 0; i < labels.length; i++) {
    await navTo(labels[i], i);
    if (i === labels.length - 1) await ensureSettingsRoot();
    rows.push(await snap());
  }
  return rows;
}

function noteBlank(tag, s) {
  if (!s.title || s.content.replace(/\s+/g, '').length < 20) blank.push(tag + '：' + (s.title || '(空标题)'));
}

try {
  const URL = process.argv[2] || await startIsolatedServer(PORT);
  const launched = await launch();
  browser = launched.browser;
  page = launched.page;
  errors = launched.errors;

  // 固定时钟：2026-10-05 10:00（Asia/Shanghai，周一）
  await page.evaluateOnNewDocument(() => {
    const RealDate = Date;
    const target = RealDate.parse('2026-10-05T02:00:00Z');
    const offset = target - RealDate.now();
    function FakeDate(...args) {
      if (args.length === 0) return new RealDate(RealDate.now() + offset);
      return new RealDate(...args);
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => RealDate.now() + offset;
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    window.Date = FakeDate;
  });

  await openApp(page, URL);
  let s = await snap();

  // ── 1. 简体基线 ─────────────────────────────────────
  r.ok('首次打开是简体中文（data-lang / html lang）', s.lang === 'zh-Hans' && s.htmlLang === 'zh-Hans', [s.lang, s.htmlLang]);
  r.ok('简体 data-cjk=1，字体是汉仪文黑', s.cjkFlag === '1' && /WenHei|汉仪/.test(s.font), { cjk: s.cjkFlag, font: s.font.slice(0, 100) });
  r.ok('首屏大标题是「今日总览」', s.title === '今日总览', s.title);
  r.ok('侧栏九个入口都是中文', s.nav.length === 9 && s.nav.join('|') === ZH.join('|'), s.nav);
  r.ok('假时钟生效：顶栏日期是「10月5日 周一」', s.sub.includes('10月5日 周一'), s.sub);
  r.ok('空库总览显示欢迎空态与「载入示例数据」', s.content.includes('这里还没有任何数据') && s.buttons.some((b) => b.includes('载入示例数据')), {
    text: s.content.includes('这里还没有任何数据'), buttons: s.buttons.slice(0, 8),
  });

  // ── 2. English ──────────────────────────────────────
  await switchLang('en');
  s = await snap();
  r.ok('切到 English：data-lang=en、html lang=en、data-cjk=0', s.lang === 'en' && s.htmlLang === 'en' && s.cjkFlag === '0', [s.lang, s.htmlLang, s.cjkFlag]);
  r.ok('English：字体换成系统字体（不再用汉仪文黑）', !/WenHei|汉仪/.test(s.font), s.font.slice(0, 100));
  noteBlank('切 English 后', s);

  const enRows = await scanPages(EN);
  const enTitleBad = enRows.map((x, i) => (x.title === EN[i] ? null : { page: EN[i], actual: x.title })).filter(Boolean);
  r.ok('English：九个页面大标题全部是英文', enTitleBad.length === 0, enTitleBad);

  const enBtnBad = [];
  enRows.forEach((x, i) => {
    const hit = x.buttons.filter((b) => cjk(b) > 0);
    if (hit.length) enBtnBad.push({ page: EN[i], hit: hit.slice(0, 3) });
  });
  r.ok('English：九个页面主要按钮无中文字符', enBtnBad.length === 0, enBtnBad);

  const enBodyBad = enRows.map((x, i) => (cjk(x.content) ? { page: EN[i], count: cjk(x.content), sample: x.content.slice(0, 90) } : null)).filter(Boolean);
  r.ok('English：九个页面正文无中文字符', enBodyBad.length === 0, enBodyBad);

  r.ok('English：顶栏日期/星期本地化为「Oct 5, Mon」', enRows[0].sub.includes('Oct 5, Mon'), enRows[0].sub);
  // 设置页永远是最后一页（v1.6.0 起是第 9 页），别再写死 6。
  const enSettings = enRows[EN.length - 1];
  r.ok('English：设置根页可见，语言行当前值是 English', enSettings.hasLangRow && /English/.test(enSettings.content), {
    hasRow: enSettings.hasLangRow, sample: enSettings.content.slice(0, 140),
  });

  // ── 3. 刷新后保持 ────────────────────────────────────
  await reload(page);
  await sleep(400);
  s = await snap();
  const cfgLang = await state(page, () => window.__schedule && window.__schedule.cfg && window.__schedule.cfg.lang);
  r.ok('刷新后仍是 English（界面与落盘配置都保持）', s.lang === 'en' && s.title === 'Settings' && cfgLang === 'en', { lang: s.lang, title: s.title, cfgLang });

  // ── 4. 日本語 ───────────────────────────────────────
  await switchLang('ja');
  s = await snap();
  r.ok('切到 日本語：data-lang=ja、data-cjk=0、字体为系统字体', s.lang === 'ja' && s.htmlLang === 'ja' && s.cjkFlag === '0' && !/WenHei|汉仪/.test(s.font), {
    lang: s.lang, cjk: s.cjkFlag, font: s.font.slice(0, 100),
  });
  noteBlank('切 日本語 后', s);

  const jaRows = await scanPages(JA);
  const jaTitleBad = jaRows.map((x, i) => (x.title === JA[i] ? null : { page: JA[i], actual: x.title })).filter(Boolean);
  r.ok('日本語：九个页面大标题全部是日文', jaTitleBad.length === 0, jaTitleBad);

  const jaBtnBad = [];
  jaRows.forEach((x, i) => {
    const hit = x.buttons.filter((b) => SIMPLIFIED_ONLY.test(b));
    if (hit.length) jaBtnBad.push({ page: JA[i], hit: hit.slice(0, 3) });
  });
  r.ok('日本語：九个页面主要按钮无简体专用字', jaBtnBad.length === 0, jaBtnBad);

  const jaBodyBad = jaRows.map((x, i) => {
    const m = x.content.match(SIMPLIFIED_ONLY);
    return m ? { page: JA[i], char: m[0], sample: x.content.slice(0, 90) } : null;
  }).filter(Boolean);
  r.ok('日本語：九个页面正文无简体专用字', jaBodyBad.length === 0, jaBodyBad);

  const kanaTotal = jaRows.reduce((n, x) => n + kana(x.content) + kana(x.title), 0);
  r.ok('日本語：页面确实显示假名（走了日文词典，不是回落中文）', kanaTotal > 120, kanaTotal);
  r.ok('日本語：顶栏日期是「10月5日（月）」', jaRows[0].sub.includes('10月5日（月）'), jaRows[0].sub);
  r.ok('日本語：课表页出现「月曜日」', (jaRows[5].ttHead + jaRows[5].content).includes('月曜日'), jaRows[5].ttHead.slice(0, 80));

  // ── 5. 繁體中文抽查 ─────────────────────────────────
  await switchLang('zh-Hant');
  s = await snap();
  r.ok('切到 繁體中文：data-lang=zh-Hant、data-cjk=1、字体恢复汉仪文黑', s.lang === 'zh-Hant' && s.htmlLang === 'zh-Hant' && s.cjkFlag === '1' && /WenHei|汉仪/.test(s.font), {
    lang: s.lang, cjk: s.cjkFlag, font: s.font.slice(0, 100),
  });
  noteBlank('切 繁體中文 后', s);

  await ensureSettingsRoot();
  s = await snap();
  r.ok('繁體：主题行右值转成「INS 奶油風」，不残留简体「奶油风」', s.content.includes('INS 奶油風') && !s.content.includes('奶油风'), s.content.slice(0, 160));
  const needTrad = ['設定', '資料', '儲存', '介面'];
  const missTrad = needTrad.filter((w) => !s.body.includes(w));
  r.ok('繁體：設定 / 資料 / 儲存 / 介面 都转换正确', missTrad.length === 0, { missing: missTrad, sample: s.body.slice(0, 160) });

  const simpLeft = ['设置', '数据', '保存', '界面', '这里'].filter((w) => s.body.includes(w));
  r.ok('繁體：设置根页不残留「设置/数据/保存/界面/这里」', simpLeft.length === 0, simpLeft);

  await navTo('今日總覽', 0);
  s = await snap();
  r.ok('繁體：总览空态出现「這裡」，没有简体「这里」', s.content.includes('這裡') && !s.content.includes('这里'), {
    hasHere: s.content.includes('這裡'), simplified: s.content.includes('这里'),
  });

  await navTo('我的課表', 5);
  s = await snap();
  r.ok('繁體：课表周条与顶栏日期都显示「週一」', s.ttHead.includes('週一') && s.sub.includes('10月5日 週一'), {
    ttHead: s.ttHead.slice(0, 80), sub: s.sub,
  });

  // ── 6. 切回简体 ─────────────────────────────────────
  await switchLang('zh-Hans');
  await navTo('今日总览', 0);
  s = await snap();
  r.ok('切回简体：界面与日期恢复（今日总览 / 10月5日 周一）', s.lang === 'zh-Hans' && s.title === '今日总览' && s.nav[0] === '今日总览' && s.sub.includes('10月5日 周一'), {
    lang: s.lang, title: s.title, nav: s.nav[0], sub: s.sub,
  });

  // ── 7. 总检查 ───────────────────────────────────────
  r.ok('全程没有 pageerror / 控制台错误', errors.length === 0, errors.slice(0, 5));
  r.ok('每次切换语言都没有白屏', blank.length === 0, blank);

} catch (e) {
  console.error('\n[FATAL] ' + (e && e.stack ? e.stack : e));
  r.ok('测试脚本没有中途抛异常', false, String(e && e.message ? e.message : e));
  if (page) {
    try { await shot(page, 'human-i18n-matrix-fatal'); } catch { /* 截图失败不影响结果 */ }
  }
} finally {
  if (browser) { try { await r.done(browser); } catch { /* 已在 done 里关过 */ } }
  stopIsolatedServer();
  if (!browser) {
    console.log('\n-- ' + TITLE + ' : ' + r.counts.pass + ' passed, ' + r.counts.fail + ' failed');
    process.exitCode = r.counts.fail ? 1 : 0;
  }
  // 给页面/服务器留一点退出时间，避免 Windows 上文件句柄没释放
  await sleep(300);
}