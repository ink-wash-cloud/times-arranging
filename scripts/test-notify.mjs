// 通知链路专项
//
// 真机上的系统通知没法在浏览器里测，但有两个关键点可以测：
//   1. 提醒默认必须是"开着"的（以前默认关着，用户不勾就什么都没有）
//   2. 出错必须说出来。以前排期失败是 catch { return 0 }，用户只看到"没提醒"，
//      根本不知道是权限没给还是渠道没建。
// 这里用注入 window.Capacitor 的方式把网页伪装成安卓端，再故意让插件不可用，
// 验证错误确实会被显示出来，而不是静默消失。
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};

const URL = await startIsolatedServer(Number(process.env.TEST_PORT || 8793));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });

const openSettings = async (page) => {
  await page.evaluate(() => { location.hash = '#settings'; });
  await sleep(900);
  // v1.4.1：提醒面板搬进了二级页，直接进 'remind'
  await page.evaluate(() => window.__schedule.ui.openSettingsPage('remind'));
  await sleep(700);
};

/**
 * 把网页伪装成安卓端。
 * 必须用 Proxy：@capacitor/core 每次被 import 都会往 window.Capacitor 上重新写
 * isNativePlatform，普通对象会被它改回真实实现，伪装当场失效。
 */
const fakeAndroid = (page) => page.evaluate(() => {
  const target = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      NotifSettings: { open: () => { window.__notifSettingsOpened = true; return Promise.resolve(); } }
    },
    registerPlugin: () => ({}),
    isPluginAvailable: () => false
  };
  const fake = new Proxy(target, {
    set(t, k, v) { if (k === 'isNativePlatform' || k === 'getPlatform') return true; t[k] = v; return true; },
    defineProperty(t, k, d) { if (k === 'isNativePlatform' || k === 'getPlatform') return true; return Reflect.defineProperty(t, k, d); }
  });
  Object.defineProperty(window, 'Capacitor', {
    configurable: true,
    get: () => fake,
    set: () => { /* 吞掉覆盖 */ }
  });
  return window.Capacitor.isNativePlatform();
});

/* ===================== 1. 网页端：默认开着、不显示自检块 ===================== */
console.log('\n[1] 网页端');
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app', { timeout: 20000 });
  await sleep(2500);
  await openSettings(page);

  const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem('reminderCfg') || 'null'));
  console.log('   localStorage 里的提醒配置: ' + JSON.stringify(cfg));
  const enabled = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.subpage .card')).find((x) => x.innerText.includes('事项临近提醒'));
    const cb = card.querySelector('input[type=checkbox]');
    return cb ? cb.checked : null;
  });
  ok('提醒默认就是开启的（以前默认关着，用户不勾就什么都收不到）', enabled === true, enabled);
  const cardText = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.subpage .card')).find((x) => x.innerText.includes('事项临近提醒'));
    return card.innerText.replace(/\s+/g, ' ');
  });
  ok('网页端不显示安卓专属的自检块', !/系统通知自检/.test(cardText), cardText.slice(0, 120));
  await page.close();
}

/* ===================== 2. 模拟安卓端 ===================== */
console.log('\n[2] 模拟安卓端（注入 window.Capacitor）');
{
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 900, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app', { timeout: 20000 });
  await sleep(2500);
  // 注意：注入 window.Capacitor 是没用的 —— @capacitor/core 的 web 运行时会自己
  // 建一个 Capacitor 全局对象并覆盖掉，它的 isNativePlatform() 恒为 false。
  // 所以要在它建完之后打补丁。插件本身依然不存在，正好验证失败会不会被说出来。
  // 简单的赋值钉不住：一旦动态 import 了 @capacitor/*，它的 web 运行时会重新
  // 给 window.Capacitor 赋值，把补丁冲掉。用 getter + 空 setter 让它覆盖不了。
  const patched = await fakeAndroid(page);
  ok('成功把网页伪装成安卓端（且钉住不被覆盖）', patched === true, patched);
  await openSettings(page);
  await sleep(500);

  const cardText = await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.subpage .card')).find((x) => x.innerText.includes('事项临近提醒'));
    return card ? card.innerText.replace(/\s+/g, ' ') : '';
  });
  console.log('   卡片文案: ' + cardText.slice(0, 200));
  ok('安卓端出现「系统通知自检」块', /系统通知自检/.test(cardText), cardText.slice(0, 160));
  ok('文案明确说了会出现在通知栏', /通知栏/.test(cardText), cardText.slice(0, 200));
  ok('自检块列出了权限状态', /通知权限/.test(cardText), null);
  ok('自检块列出了通知渠道状态', /通知渠道/.test(cardText), null);
  ok('自检块列出了已排期条数', /已排给系统的提醒/.test(cardText), null);

  // 点"一键自检"：插件不可用，错误必须被显示出来
  await page.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.subpage .card')).find((x) => x.innerText.includes('事项临近提醒'));
    const b = Array.from(card.querySelectorAll('button')).find((x) => x.innerText.includes('一键自检'));
    if (b) b.click();
  });
  await sleep(2500);
  // 注意别只看那张卡片：插件被 import 之后 @capacitor/core 会重建 window.Capacitor，
  // 我们的伪装就失效了，组件重渲染会切回"网页版"文案（真实安卓端不会）。所以看整页文本。
  const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('   自检后页面文本: ' + after.slice(0, 200));
  ok('插件不可用时把错误显示出来了（不再静默吞掉）', /没给|最近一次错误|发送失败|通知权限/.test(after), after.slice(0, 220));

  await page.close();
}

/* ============ 3. 启动时自动申请 + 没拿到就出横幅 ============ */
// 以前的问题是：全应用只有设置页里那个按钮会申请权限，用户不去点就永远没有权限，
// 表现就是"提醒完全没生效"。现在启动时会自己问，而且 window.Capacitor 注入晚了
// 也会错开时间重试。
console.log('\n[3] 通知权限：启动自动申请 + 兜底横幅');
{
  const page = await browser.newPage();
  // 这一节要盯着运行时错误：加载通知插件时曾经踩过一个 thenable 坑 ——
  // LocalNotifications 是 Proxy，取任何属性都返回函数（包括 then），
  // 于是 Promise 把它当 thenable 去调 .then()，抛 "then() is not implemented"，
  // 被 catch 吞掉后插件被判成不可用 —— 权限永远不申请、提醒静默失效。
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setViewport({ width: 420, height: 900, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app', { timeout: 20000 });
  await sleep(1200);

  // 这时候启动自检已经跑过一次了（那时还不是"安卓端"）。现在才伪装成安卓，
  // 正好验证它会不会重试 —— 真机上就是桥接层注入慢的情况。
  //
  // 用 Proxy 而不是普通对象：@capacitor/core 每次被 import 都会往
  // window.Capacitor 上重新写 isNativePlatform，普通对象会被它改回真实实现，
  // 伪装当场失效（这就是上一版测试为什么一直测不出东西）。
  await fakeAndroid(page);
  console.log('   已伪装成安卓端（插件故意不可用），等它重试…');
  await sleep(7000);

  const seen = await page.evaluate(() => {
    const el = document.querySelector('.notif-banner');
    return {
      has: !!el,
      text: el ? el.innerText.replace(/\s+/g, ' ') : '',
      buttons: el ? Array.from(el.querySelectorAll('button')).map((b) => b.innerText.trim()) : []
    };
  });
  console.log('   横幅: ' + JSON.stringify(seen.text.slice(0, 110)));
  ok('重试之后（桥接层晚到）认出了安卓端并给出结论', seen.has, seen);
  ok('横幅说清后果：提醒收不到', /通知权限没开/.test(seen.text) && /收不到/.test(seen.text), seen.text.slice(0, 120));
  ok('横幅给了三个出口', seen.buttons.join(',').includes('开启通知') && seen.buttons.join(',').includes('去系统设置') && seen.buttons.join(',').includes('以后再说'), seen.buttons);

  // 去系统设置：应当调用原生小插件
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.notif-banner button')).find((x) => x.innerText.includes('去系统设置'));
    if (b) b.click();
  });
  await sleep(900);
  const opened = await page.evaluate(() => window.__notifSettingsOpened === true);
  ok('「去系统设置」会调用原生插件跳通知设置页', opened, opened);

  // 以后再说：横幅消失且记住
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.notif-banner button')).find((x) => x.innerText.includes('以后再说'));
    if (b) b.click();
  });
  await sleep(700);
  const gone = await page.evaluate(() => ({
    has: !!document.querySelector('.notif-banner'),
    flag: localStorage.getItem('notifBannerOff')
  }));
  ok('「以后再说」把横幅收起来', !gone.has, gone);
  ok('收起的选择被记住（不会每次进来都烦人）', gone.flag === '1', gone.flag);

  // 回归守卫：插件必须真的能被加载，不能再被 thenable 坑掉
  const thenableErr = errs.filter((e) => /then\(\)|not implemented on web/i.test(e));
  console.log('   运行时报错: ' + JSON.stringify(errs.slice(0, 3)));
  ok('加载通知插件不再被 thenable 坑（没有 then() not implemented）', thenableErr.length === 0, thenableErr.slice(0, 2));

  await page.close();
}

/* ============ 4. 网页端不该出现这条横幅 ============ */
console.log('\n[4] 网页端不弹通知横幅');
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app', { timeout: 20000 });
  await sleep(4000);
  const has = await page.evaluate(() => !!document.querySelector('.notif-banner'));
  ok('浏览器里不显示安卓专属的通知横幅', !has, has);
  await page.close();
}

await browser.close();
stopIsolatedServer();
console.log('\n========================================');
console.log('  通知链路验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
