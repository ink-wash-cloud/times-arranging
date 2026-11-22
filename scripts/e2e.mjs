// 真人操作测试的公共工具箱（新测试都用它，别各写一套）
//
// 为什么要有这个文件：
//   老测试大量用 page.evaluate(直接改 store) —— 那是在测数据层，不是在测"人点得动吗"。
//   这里的每个动作都尽量走浏览器真实事件（真实点击坐标、真实键盘输入），
//   所以「按钮被浮层挡住」「输入框拿不到焦点」「点了没反应」这类问题才会被抓到。
//
// 用法：
//   import { report, launch, openApp, clickText, typeInto } from './e2e.mjs';
//   const r = report('待办：新建');
//   const { browser, page, errors } = await launch();
//   await openApp(page, URL);
//   await clickText(page, 'button', '新建待办');
//   r.ok('弹窗打开了', await waitText(page, '保存'));
//   await r.done(browser);

import puppeteer from 'puppeteer-core';

export const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 收集控制台/页面错误。只放过明确无害的噪音，pageerror 一律算错。 */
const NOISE = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /favicon/i,
  /Download the React DevTools/i,
  /WebSocket connection to .* failed/i,   // vite 的 HMR，生产包不该有，但 dev 预览会有
  /\[vite\]/i,
];
export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e && e.message ? e.message : String(e))));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const t = m.text();
    if (NOISE.some((re) => re.test(t))) return;
    if (/Warning: Each child in a list/i.test(t)) return;
    errors.push(m.type() + ': ' + t);
  });
  return errors;
}

export async function launch(opts = {}) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: opts.headless === false ? false : 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
    defaultViewport: { width: opts.width || 1400, height: opts.height || 1000 },
  });
  const page = await browser.newPage();
  const errors = watchErrors(page);
  return { browser, page, errors };
}

/** 打开应用并等到首屏渲染完（含 1 秒让首屏动画落定）。 */
export async function openApp(page, url, opts = {}) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.app', { timeout: 20000 });
  await sleep(opts.settle || 1800);
  return page;
}

export async function reload(page, opts = {}) {
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.app', { timeout: 20000 });
  await sleep(opts.settle || 1500);
}

/** 页面可见文字（压缩空白）。断言文案用它。 */
export async function text(page, selector = 'body') {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
  }, selector);
}

/** 等某段文字出现（返回 true/false，不抛异常，方便写 ok()）。 */
export async function waitText(page, needle, timeout = 8000) {
  try {
    await page.waitForFunction((n) => (document.body.innerText || '').includes(n), { timeout, polling: 120 }, needle);
    return true;
  } catch { return false; }
}

/** 等某段文字消失。 */
export async function waitGone(page, needle, timeout = 8000) {
  try {
    await page.waitForFunction((n) => !(document.body.innerText || '').includes(n), { timeout, polling: 120 }, needle);
    return true;
  } catch { return false; }
}

/** 找第一个文本包含 needle 的元素（在 selector 匹配的集合里）。 */
async function find(page, selector, needle, index = 0) {
  const handles = await page.$$(selector);
  let seen = 0;
  for (const h of handles) {
    const t = await h.evaluate((el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim());
    if (t.includes(needle)) {
      if (seen++ < index) continue;
      return h;
    }
  }
  return null;
}

/** 真人点击：滚动到中间 → 真鼠标点 → 等一下让动画/请求落地。 */
export async function clickText(page, selector, needle, opts = {}) {
  const h = await find(page, selector, needle, opts.index || 0);
  if (!h) throw new Error('点不到「' + needle + '」（' + selector + '）');
  await h.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  await sleep(80);
  await h.click();
  await sleep(opts.wait || 320);
  return h;
}

/** 按选择器点（第一个/第 n 个）。 */
export async function click(page, selector, opts = {}) {
  const list = await page.$$(selector);
  const h = list[opts.index || 0];
  if (!h) throw new Error('点不到 ' + selector);
  await h.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await sleep(60);
  await h.click();
  await sleep(opts.wait || 320);
  return h;
}

/** 真人打字：点进输入框 → Ctrl+A → 输入（带按键间隔）。 */
export async function typeInto(page, selector, value, opts = {}) {
  const h = (await page.$$(selector))[opts.index || 0];
  if (!h) throw new Error('找不到输入框 ' + selector);
  await h.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await h.click();
  await sleep(60);
  if (opts.clear !== false) {
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
  }
  await page.keyboard.type(String(value), { delay: opts.delay ?? 12 });
  await sleep(opts.wait || 120);
}

export async function press(page, key, opts = {}) {
  if (opts.times) { for (let i = 0; i < opts.times; i++) { await page.keyboard.press(key); await sleep(60); } }
  else await page.keyboard.press(key);
  await sleep(opts.wait || 200);
}

/** 侧栏/底栏切页：点导航文字，等标题出现。 */
export async function go(page, label) {
  const navs = await page.$$('.nav-item, .tabbar-item, .nav a, .side-nav button');
  for (const n of navs) {
    const t = await n.evaluate((el) => (el.innerText || '').replace(/\s+/g, ' ').trim());
    if (t.includes(label)) {
      await n.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await n.click();
      await sleep(700);
      return true;
    }
  }
  // 兜底：直接改 hash（老测试的做法），但记一笔
  await page.evaluate((h) => { location.hash = '#' + h; }, label);
  await sleep(700);
  return false;
}

/** 给失败截图，方便复盘（不放进回答里）。 */
export async function shot(page, name) {
  const dir = 'shots-final';
  try {
    await page.screenshot({ path: dir + '/' + name + '.png' });
    return dir + '/' + name + '.png';
  } catch { return ''; }
}

/** 断言器：每个测试用它统计 PASS/FAIL，结束打印一行汇总。 */
export function report(title) {
  let pass = 0, fail = 0;
  const failures = [];
  console.log('\n== ' + title + ' ==');
  return {
    ok(name, cond, extra) {
      if (cond) { pass++; console.log('  PASS  ' + name); }
      else {
        fail++;
        failures.push(name);
        console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : ''));
      }
    },
    note(msg) { console.log('  ·  ' + msg); },
    get counts() { return { pass, fail }; },
    async done(browser) {
      if (browser) { try { await browser.close(); } catch { /* 已关 */ } }
      console.log('\n-- ' + title + ' : ' + pass + ' passed, ' + fail + ' failed');
      if (failures.length) console.log('   失败项: ' + failures.join(' / '));
      process.exitCode = fail ? 1 : 0;
      return { pass, fail };
    },
  };
}

/** 页面里读写应用状态的小帮手（断言"数据真的存了"时用，不代替点击）。 */
export async function state(page, fn, ...args) {
  return page.evaluate(fn, ...args);
}
