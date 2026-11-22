// 语言选项：简体中文 / 繁體中文 / English / 日本語（v1.5.0）
//
// 断言尽量不依赖具体译文（译文由词典决定，可能微调），而是看语言标记、字体、
// 文字构成比例、以及"中文原文有没有真的消失"。
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8850, { SHIXU_AUTO_EXIT: '0' });
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2200);

const read = () => p.evaluate(() => {
  const root = document.documentElement;
  // 侧栏/底栏的 innerText 是「图标 + 换行 + 文字」，取最后一行，免得断言被 emoji 带偏
  const label = (x) => (x.innerText || '').trim().split(/\n/).pop().replace(/^[^\p{L}]+/u, '').trim();
  const nav = Array.from(document.querySelectorAll('.nav-item')).map(label);
  const tabs = Array.from(document.querySelectorAll('.tabbar .tab')).map(label);
  const title = (document.querySelector('.topbar h1') || {}).innerText || '';
  const text = document.body.innerText || '';
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const lang = root.lang;
  const dataLang = root.getAttribute('data-lang');
  const cjkFlag = root.getAttribute('data-cjk');
  const fontApp = getComputedStyle(document.body).fontFamily;
  return { lang, dataLang, cjkFlag, nav, tabs, title, cjk, kana, latin, fontApp, len: text.length };
});

const openPage = async (id) => {
  await p.evaluate((x) => window.__schedule.ui.openSettingsPage(x), id);
  await sleep(400);
};
const goSettings = async () => {
  await p.evaluate(() => { location.hash = '#settings'; });
  await sleep(1200);
};
/** 通过设置页的真实 UI 选语言（不直接调内部函数，顺便验证菜单能点到） */
const pickLang = async (id) => {
  await goSettings();
  // 可能还停在上一次打开的语言二级页里，先回到设置根页
  await p.evaluate(() => window.__schedule.ui.openSettingsPage('root'));
  // 切语言会让整页重挂载，设置根页要重渲染一遍，轮询等它出现
  for (let i = 0; i < 20 && !(await p.evaluate(() => !!document.querySelector('[data-testid="set-row-lang"]'))); i++) await sleep(250);
  const clickedRow = await p.evaluate(() => {
    const row = document.querySelector('[data-testid="set-row-lang"]');
    if (!row) {
      const ci = document.querySelector('.content-inner');
      window.__dbg = { hash: location.hash, sub: window.__schedule.ui.settingsPage(), rows: document.querySelectorAll('[data-testid^="set-row-"]').length, cls: ci ? ci.className : '', text: ci ? ci.innerText.slice(0, 160) : '' };
      return false;
    }
    row.click();
    return true;
  });
  await sleep(600);
  const clickedOpt = await p.evaluate((x) => {
    const btn = document.querySelector('[data-lang-id="' + x + '"]');
    if (!btn) return false;
    btn.click();
    return true;
  }, id);
  await sleep(1000);
  const dbg = await p.evaluate(() => window.__dbg || null);
  return { clickedRow, clickedOpt, dbg };
};

console.log('\n[1] 默认是简体中文');
let v = await read();
console.log('   ' + JSON.stringify({ lang: v.lang, dataLang: v.dataLang, cjk: v.cjkFlag, nav: v.nav.slice(0, 3) }));
ok('html lang 是 zh-Hans', v.lang === 'zh-Hans', v.lang);
ok('data-lang 标记是 zh-Hans', v.dataLang === 'zh-Hans', v.dataLang);
ok('data-cjk=1（用自带中文字库）', v.cjkFlag === '1', v.cjkFlag);
ok('侧栏是中文', v.nav[0] === '今日总览' && v.nav[1] === '待办事项', v.nav.slice(0, 2));
ok('底栏是中文短名', v.tabs[0] === '总览', v.tabs.slice(0, 2));
ok('字体栈里有汉仪文黑', /WenHei|汉仪/.test(v.fontApp), v.fontApp.slice(0, 60));

console.log('\n[2] 设置页里有「语言」入口，能点开');
await goSettings();
const hasRow = await p.evaluate(() => !!document.querySelector('[data-testid="set-row-lang"]'));
ok('设置根页有语言这一行', hasRow);
await openPage('lang');
const opts = await p.evaluate(() => Array.from(document.querySelectorAll('[data-lang-id]')).map((x) => x.getAttribute('data-lang-id')));
ok('语言页列出四种语言', opts.length === 4 && opts.indexOf('en') >= 0 && opts.indexOf('ja') >= 0, opts);

console.log('\n[3] 切到 English');
const r3 = await pickLang('en');
ok('点得到语言行和选项', r3.clickedRow && r3.clickedOpt, r3);
v = await read();
console.log('   ' + JSON.stringify({ lang: v.lang, dataLang: v.dataLang, cjk: v.cjkFlag, nav: v.nav.slice(0, 3), ratio: [v.cjk, v.latin] }));
ok('html lang 变成 en', v.lang === 'en', v.lang);
ok('data-lang=en', v.dataLang === 'en', v.dataLang);
ok('data-cjk=0（英文不再用中文字库）', v.cjkFlag === '0', v.cjkFlag);
ok('侧栏没有「今日总览」了', v.nav.indexOf('今日总览') < 0, v.nav);
ok('侧栏是英文', /^[A-Za-z]/.test(v.nav[0]), v.nav[0]);
ok('底栏也换成英文', /^[A-Za-z]/.test(v.tabs[0]), v.tabs[0]);
ok('整页中文明显变少（<40 字）', v.cjk < 40, v.cjk);
ok('英文模式下页面以拉丁字母为主', v.latin > v.cjk * 3, [v.latin, v.cjk]);
ok('字体栈换回系统字体', !/WenHei|汉仪/.test(v.fontApp), v.fontApp.slice(0, 60));

console.log('\n[4] 刷新后还是英文（存进了本机配置）');
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(1800);
v = await read();
ok('刷新后仍是英文', v.lang === 'en' && v.nav.indexOf('今日总览') < 0, [v.lang, v.nav[0]]);
const cfgLang = await p.evaluate(() => window.__schedule.cfg.lang);
ok('配置里记为 en', cfgLang === 'en', cfgLang);

console.log('\n[5] 切到 日本語');
const r5 = await pickLang('ja');
ok('日语选项点得到', r5.clickedRow && r5.clickedOpt, r5);
v = await read();
console.log('   ' + JSON.stringify({ lang: v.lang, nav: v.nav.slice(0, 3), kana: v.kana }));
ok('html lang 变成 ja', v.lang === 'ja', v.lang);
ok('data-cjk=0（日文也用系统字体）', v.cjkFlag === '0', v.cjkFlag);
ok('页面里出现假名', v.kana > 3, v.kana);
ok('侧栏没有「今日总览」', v.nav.indexOf('今日总览') < 0, v.nav);

console.log('\n[6] 切到 繁體中文');
const r6 = await pickLang('zh-Hant');
ok('繁体选项点得到', r6.clickedRow && r6.clickedOpt, r6);
v = await read();
console.log('   ' + JSON.stringify({ lang: v.lang, cjk: v.cjkFlag, nav: v.nav.slice(0, 3) }));
ok('html lang 变成 zh-Hant', v.lang === 'zh-Hant', v.lang);
ok('data-cjk=1（繁体照样用自带字库）', v.cjkFlag === '1', v.cjkFlag);
ok('界面已是繁体（没有「设置与同步」）', v.nav.indexOf('设置与同步') < 0, v.nav);
ok('出现繁体字「設」', /設/.test(v.nav.join('')), v.nav);
ok('底栏也是繁体', !/总览/.test(v.tabs[0]), v.tabs.slice(0, 2));

console.log('\n[7] 切回简体');
await pickLang('zh-Hans');
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(1600);
v = await read();
ok('回到简体', v.lang === 'zh-Hans' && v.nav[0] === '今日总览', [v.lang, v.nav[0]]);
ok('字体恢复汉仪文黑', /WenHei|汉仪/.test(v.fontApp), v.fontApp.slice(0, 60));

console.log('\n[8] 英语模式下五个页面都换得过来，且不报错');
await pickLang('en');
const pages = ['dash', 'tasks', 'habits', 'insp', 'dates', 'tt', 'settings'];
const bad = [];
for (const key of pages) {
  await p.evaluate((k) => { location.hash = '#' + k; }, key);
  await sleep(700);
  const s = await p.evaluate(() => {
    const title = (document.querySelector('.topbar h1') || {}).innerText || '';
    return { title, cjk: ((document.querySelector('.content-inner') || {}).innerText || '').match(/[\u4e00-\u9fa5]/g)?.length || 0 };
  });
  if (!s.title || /[\u4e00-\u9fa5]/.test(s.title)) bad.push([key, s.title]);
}
ok('每一页的大标题都是英文', bad.length === 0, bad);

console.log('\n[9] 没有报错');
const realErrs = errs.filter((e) => !/favicon|404|Failed to load resource/i.test(e));
ok('控制台没有 JS 报错', realErrs.length === 0, realErrs.slice(0, 3));

console.log('\n结果：' + pass + ' passed / ' + fail + ' failed');
await b.close();
stopIsolatedServer();
process.exit(fail ? 1 : 0);
