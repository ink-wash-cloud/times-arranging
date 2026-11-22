// 为新 UI 截图，并验证「晕光」确实生效
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 默认起隔离实例，别把测试数据写进真实库：node scripts/shot.mjs http://host:port 可指定
const EXPLICIT = process.argv[2] || '';
const URL = EXPLICIT || await startIsolatedServer(Number(process.env.TEST_PORT || 8796));
const OUT = 'shots2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); } };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1600,1000']
});

try {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.app', { timeout: 20000 });
  await sleep(2500);

  let txt = await page.evaluate(() => document.body.innerText);
  if (/载入示例数据/.test(txt)) {
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.includes('载入示例数据'));
      if (b) b.click();
    });
    await sleep(1500);
  }

  console.log('\n[1] 液态玻璃结构');
  // .g-glow 是晕光引擎在 frame() 里第一次"见到"元素时才挂上的，
  // 页面刚加载完可能还没跑过首帧，直接数会数到个位数 —— 属于时序问题，不是功能问题。
  // 先动一下鼠标强制重算一次，再数。
  await page.mouse.move(320, 300, { steps: 4 });
  await sleep(250);
  await page.mouse.move(0, 0, { steps: 4 });
  await sleep(250);
  const glassCount = await page.evaluate(() => document.querySelectorAll('.g-glow').length);
  ok('JS 已为玻璃表面挂上发光层', glassCount > 5, glassCount);
  const hasSpecular = await page.evaluate(() => {
    const c = document.querySelector('.topbar');
    if (!c) return false;
    const cs = getComputedStyle(c, '::before');
    return cs.backgroundImage.includes('gradient') && String(cs.maskComposite || cs.webkitMaskComposite).includes('exclude');
  });
  ok('系统栏有折射高光边缘 (::before + mask-composite)', hasSpecular);
  // 表面分级之后，内容卡不再套高光边（一屏几十道亮边太吵），
  // 只有系统栏和浮层保留
  const cardPlain = await page.evaluate(() => {
    const c = document.querySelector('.card');
    if (!c) return null;
    return getComputedStyle(c, '::before').content === 'none';
  });
  ok('内容卡不再套折射高光边（表面分级）', cardPlain === true, cardPlain);
  const modalSolid = await page.evaluate(() => {
    // 二级菜单（弹窗）必须够实，否则背后的字会透上来重叠
    const m = document.querySelector('.modal');
    if (!m) return null;
    const bg = getComputedStyle(m).backgroundColor;
    const a = Number((bg.match(/rgba?\([^)]*?([\d.]+)\)$/) || [])[1]);
    return { bg, alpha: Number.isFinite(a) ? a : 1 };
  });
  if (modalSolid) ok('二级菜单不够透（不透明度 ≥ .95）', modalSolid.alpha >= 0.95, modalSolid);
  // 性能取舍：只有"大件"表面保留背景模糊，卡片一律走纯半透明填充
  const perfSplit = await page.evaluate(() => {
    const bd = (el) => { const cs = getComputedStyle(el); return (cs.backdropFilter || cs.webkitBackdropFilter || 'none'); };
    const bar = document.querySelector('.topbar');
    const card = document.querySelector('.card');
    let count = 0;
    document.querySelectorAll('*').forEach((el) => { if (bd(el) !== 'none') count++; });
    return { topbar: bd(bar), card: bd(card), total: count };
  });
  ok('顶栏等"大件"保留背景模糊', perfSplit.topbar.includes('blur'), perfSplit.topbar);
  ok('卡片不再使用背景模糊（性能优先）', !perfSplit.card.includes('blur'), perfSplit.card);
  ok('全页背景模糊元素控制在个位数', perfSplit.total <= 8, perfSplit.total);

  console.log('\n[2] 鼠标靠近 → 晕光');
  const hoverCapable = await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches);
  console.log('  环境支持 hover:', hoverCapable);
  // 移到第一张总览卡的正上方
  const box = await page.evaluate(() => {
    const el = document.querySelector('.dash-card');
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
  await page.mouse.move(box.x, box.y, { steps: 8 });
  await sleep(450);
  const near = await page.evaluate(() => {
    const el = document.querySelector('.dash-card');
    return { glow: el.style.getPropertyValue('--glow'), mx: el.style.getPropertyValue('--mx') };
  });
  ok('光标落在卡片上时 --glow 被点亮', Number(near.glow) > 0.5, near);
  const shotGlow = await page.evaluate(() => {
    const el = document.querySelector('.dash-card');
    const cs = getComputedStyle(el, '::after');
    return { opacity: cs.opacity, on: el.classList.contains('g-on'), hasGradient: cs.backgroundImage.includes('radial-gradient') };
  });
  ok('发光元素已被点亮并生成柔光层', Number(shotGlow.opacity) > 0.2 && shotGlow.on && shotGlow.hasGradient, shotGlow);
  const offLayer = await page.evaluate(() => document.querySelectorAll('.g-on').length);
  ok('只有附近的少数元素在发光（性能优化生效）', offLayer > 0 && offLayer <= 8, offLayer);
  await page.screenshot({ path: OUT + '/01-hover-glow.png' });

  // 移到卡片附近（不接触）也应有效果，且比正上方弱
  await page.mouse.move(box.right + 90, box.y, { steps: 8 });
  await sleep(420);
  const nearish = await page.evaluate(() => Number(document.querySelector('.dash-card').style.getPropertyValue('--glow') || 0));
  ok('光标在附近（未接触）时仍有淡淡晕光', nearish > 0 && nearish < Number(near.glow), { nearish, onCard: Number(near.glow) });

  // 远离后熄灭
  await page.mouse.move(10, 990, { steps: 8 });
  await sleep(450);
  const far = await page.evaluate(() => Number(document.querySelector('.dash-card').style.getPropertyValue('--glow') || 0));
  ok('光标远离后晕光熄灭', far === 0, far);
  await sleep(700);
  const released = await page.evaluate(() => document.querySelector('.dash-card').classList.contains('g-on'));
  ok('熄灭后释放该元素的合成层', released === false, released);

  await page.mouse.move(0, 0);
  await sleep(400);
  await page.screenshot({ path: OUT + '/02-dashboard-glass.png' });

  console.log('\n[3] 自定义背景');
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.innerText.includes('设置'));
    if (b) b.click();
  });
  await sleep(700);
  txt = await page.evaluate(() => document.body.innerText);
  ok('设置页出现「外观与性能」', /外观与性能/.test(txt));
  ok('设置页有性能档位选择', /性能档位/.test(txt));
  ok('设置页有帧率开关', /显示实时帧率/.test(txt));
  ok('设置页出现「事项临近提醒」', /事项临近提醒/.test(txt));
  await page.screenshot({ path: OUT + '/03-appearance.png', fullPage: false });

  // 切换背景预设（不依赖具体主题）
  const swInfo = await page.evaluate(() => {
    const sw = Array.from(document.querySelectorAll('.swatch'));
    if (sw.length < 2) return { count: sw.length };
    const before = window.__schedule.appearance.get().preset;
    sw[1].click();
    return { count: sw.length, before, after: window.__schedule.appearance.get().preset };
  });
  ok('有 6 个背景预设可选', swInfo.count === 6, swInfo);
  ok('点击色板能切换预设', swInfo.before !== swInfo.after, swInfo);
  await sleep(700);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.innerText.includes('总览'));
    if (b) b.click();
  });
  await sleep(800);
  await page.screenshot({ path: OUT + '/04-preset-sunset.png' });

  console.log('\n[4] 桌面挂件');
  const clickWidget = () => page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.topbar button')).find((x) => x.innerText.includes('桌面挂件'));
    if (b) b.click();
  });

  // 4a：正常情况 —— 应该弹成独立置顶小窗，而不是页面里的浮层
  await clickWidget();
  await sleep(1800);
  const pipWg = await page.evaluate(() => {
    const w = window.documentPictureInPicture && window.documentPictureInPicture.window;
    if (!w || w.closed) return null;
    return {
      items: w.document.querySelectorAll('.wg-item').length,
      hasWidget: !!w.document.querySelector('.widget'),
      mainDup: !!document.querySelector('.widget')
    };
  });
  ok('挂件弹成了独立的置顶小窗', !!pipWg && pipWg.hasWidget, pipWg);
  ok('小窗里列出了今日任务', !!pipWg && pipWg.items > 0, pipWg && pipWg.items);
  ok('主页面里不再重复渲染挂件', !!pipWg && pipWg.mainDup === false, pipWg && pipWg.mainDup);
  await clickWidget();          // 关掉
  await sleep(900);

  // 4b：两条路都走不通时（Firefox / 手机 / 弹窗被拦）应退回页面内浮层，
  //     下面这些拖拽相关断言校验的就是这条退路
  await page.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { value: undefined, configurable: true });
    window.__origOpen = window.open;
    window.open = () => null;
  });
  await clickWidget();
  await sleep(1000);
  const wg = await page.evaluate(() => {
    const w = document.querySelector('.widget');
    if (!w) return null;
    return { exists: true, items: w.querySelectorAll('.wg-item').length, rect: w.getBoundingClientRect().toJSON() };
  });
  ok('开不了桌面小窗时退回页面内浮层并列出今日任务', !!wg && wg.items > 0, wg && wg.items);

  // 拖拽途中触发一次数据变化（重渲染），挂件不能跳回旧位置
  const dragStable = await page.evaluate(async () => {
    const head = document.querySelector('.wg-head');
    const box = document.querySelector('.widget');
    const r = box.getBoundingClientRect();
    const opt = { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'mouse', isPrimary: true, buttons: 1 };
    head.dispatchEvent(new PointerEvent('pointerdown', { ...opt, clientX: r.left + 60, clientY: r.top + 12 }));
    head.dispatchEvent(new PointerEvent('pointermove', { ...opt, clientX: r.left + 300, clientY: r.top + 200 }));
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const midX = box.getBoundingClientRect().left;
    // 故意制造一次 store 变化 -> React 重渲染
    window.__schedule.putRecord('lifeEvents', 'drag-probe-' + Date.now(), {
      title: '拖拽稳定性探针', icon: '🧪', lastDate: '2026-01-01', cycleDays: 30, note: '', createdAt: Date.now()
    });
    await new Promise((res) => setTimeout(res, 260));
    const afterX = box.getBoundingClientRect().left;
    head.dispatchEvent(new PointerEvent('pointerup', { ...opt, clientX: r.left + 300, clientY: r.top + 200 }));
    return { midX: Math.round(midX), afterX: Math.round(afterX), jumped: Math.abs(afterX - midX) > 2 };
  });
  ok('拖拽途中发生重渲染也不会把挂件弹回原位', dragStable.jumped === false, dragStable);
  ok('挂件位置用 transform 定位（不触发布局）',
    await page.evaluate(() => { const w = document.querySelector('.widget'); return getComputedStyle(w).position === 'fixed' && w.style.transform.includes('translate3d'); }));
  await page.screenshot({ path: OUT + '/05-widget.png' });
  // 恢复被顶掉的浏览器能力，后面的用例还要正常跑
  await page.evaluate(() => {
    delete window.documentPictureInPicture;
    if (window.__origOpen) { window.open = window.__origOpen; delete window.__origOpen; }
    const b = Array.from(document.querySelectorAll('.topbar button')).find((x) => x.innerText.includes('桌面挂件'));
    if (b) b.click();          // 收起挂件
  });
  await sleep(700);

  console.log('\n[5] 手机端：点击晕光 + 布局');
  const mctx = await browser.createBrowserContext();
  const m = await mctx.newPage();
  m.on('pageerror', (e) => errs.push('mobile: ' + e.message));
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await m.waitForSelector('.app', { timeout: 20000 });
  await sleep(2500);
  await m.screenshot({ path: OUT + '/06-mobile-glass.png' });

  const tap = await m.evaluate(() => {
    const el = document.querySelector('.dash-card');
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + 60;
    const target = document.elementFromPoint(x, y);
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerType: 'touch' }));
    const host = target.closest('.g-glow');
    return { host: !!host, tapped: host ? host.classList.contains('tapped') : false, mx: host ? host.style.getPropertyValue('--mx') : null };
  });
  ok('手机端点击玻璃会触发一次性晕光', tap.host && tap.tapped && !!tap.mx, tap);
  await sleep(120);
  await m.screenshot({ path: OUT + '/07-mobile-tap-glow.png' });
  await sleep(900);
  const cleaned = await m.evaluate(() => document.querySelectorAll('.tapped').length);
  ok('晕光动画结束后自动清理 class', cleaned === 0, cleaned);

  console.log('\n[6] 回归：基础设计令牌 / 导航圆角 / 背景无方块');
  const tokens = await page.evaluate(() => {
    const rs = getComputedStyle(document.documentElement);
    const tb = document.querySelector('.tabbar');
    const card = document.querySelector('.card');
    return {
      safeB: rs.getPropertyValue('--safe-b').trim(),
      rLg: rs.getPropertyValue('--r-lg').trim(),
      rPill: rs.getPropertyValue('--r-pill').trim(),
      theme: document.documentElement.dataset.theme,
      cardRadius: getComputedStyle(card).borderRadius,
      topbarRadius: getComputedStyle(document.querySelector('.topbar')).borderRadius,
      tabbarRadius: getComputedStyle(tb).borderRadius,
      tabbarPos: getComputedStyle(tb).position
    };
  });
  ok('基础令牌在默认档位下可解析（--safe-b/--r-lg/--r-pill）',
    !!tokens.safeB && !!tokens.rLg && !!tokens.rPill && tokens.rLg !== '', tokens);
  ok('卡片使用大圆角', parseFloat(tokens.cardRadius) >= 20, tokens.cardRadius);
  ok('顶栏是胶囊形（圆角撑满高度）', parseFloat(tokens.topbarRadius) >= 100, tokens.topbarRadius);

  // 先把光标移到顶栏上，让它处于发光状态
  const tbBox = await page.evaluate(() => {
    const r = document.querySelector('.topbar').getBoundingClientRect();
    return { x: r.left + r.width * 0.6, y: r.top + r.height / 2 };
  });
  await page.mouse.move(tbBox.x, tbBox.y, { steps: 6 });
  await sleep(450);
  const barGlow = await page.evaluate(() => {
    const el = document.querySelector('.topbar');
    const cs = getComputedStyle(el, '::after');
    return { lit: el.classList.contains('g-on'), top: cs.top, left: cs.left, right: cs.right, bottom: cs.bottom, radius: cs.borderRadius, elRadius: getComputedStyle(el).borderRadius };
  });
  ok('顶栏处于发光状态（前置条件）', barGlow.lit === true, barGlow);
  ok('任务栏柔光收在本体上（四边 inset 均为 0，不外溢）',
    barGlow.top === '0px' && barGlow.left === '0px' && barGlow.right === '0px' && barGlow.bottom === '0px', barGlow);
  ok('任务栏柔光跟随本体的圆角', barGlow.radius === barGlow.elRadius, barGlow);

  const blobCss = await page.evaluate(() => {
    const b = document.querySelector('.bd-blob');
    if (!b) return { exists: false };
    const cs = getComputedStyle(b);
    return { exists: true, filter: cs.filter, radius: cs.borderTopLeftRadius, bg: cs.backgroundImage.slice(0, 60) };
  });
  ok('背景光斑不再使用 filter: blur（否则会被裁成方块）', blobCss.exists && (blobCss.filter === 'none' || !blobCss.filter.includes('blur')), blobCss);
  ok('光斑用 closest-side 渐变收在内切圆内', blobCss.bg.includes('closest-side') || blobCss.bg.includes('radial-gradient'), blobCss.bg);

  const mobileTb = await (async () => {
    const t = await m.evaluate(() => {
      const tb = document.querySelector('.tabbar');
      const r = tb.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, radius: getComputedStyle(tb).borderRadius };
    });
    return t;
  })();
  ok('手机端底栏固定在屏幕底部（回归：曾被令牌作用域问题顶到顶部）',
    mobileTb.bottom > mobileTb.vh - 80 && mobileTb.top > mobileTb.vh / 2, mobileTb);
  ok('手机端底栏是胶囊形', parseFloat(mobileTb.radius) >= 100, mobileTb.radius);

  console.log('\n[7] 字体与静态资源回退');
  const fontInfo = await page.evaluate(() => {
    const rs = getComputedStyle(document.documentElement);
    return {
      dataFont: document.documentElement.dataset.font,
      fontApp: rs.getPropertyValue('--font-app').trim(),
      bodyFont: getComputedStyle(document.body).fontFamily,
      faceInjected: !!document.getElementById('hanyi-font-face'),
      synth: getComputedStyle(document.body).fontSynthesis || getComputedStyle(document.body).webkitFontSynthesis
    };
  });
  ok('已设置字体模式 data-font', !!fontInfo.dataFont, fontInfo.dataFont);
  ok('--font-app 变量可解析', fontInfo.fontApp.length > 0, fontInfo.fontApp.slice(0, 40));
  ok('字体栈首选汉仪文黑 85W', /WenHei85|汉仪文黑/.test(fontInfo.bodyFont), fontInfo.bodyFont.slice(0, 60));
  ok('禁止合成伪粗体（85W 本身已很重）', String(fontInfo.synth).includes('none'), fontInfo.synth);
  const fontState = await page.evaluate(() => window.__schedule.font());
  ok('@font-face 的注入与构建期探测结果一致',
    fontInfo.faceInjected === (fontState.webFontUrl !== ''), { injected: fontInfo.faceInjected, detected: fontState.webFontUrl });
  ok('字体状态可查询（设置页据此提示）', typeof fontState.ready === 'boolean', fontState);
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.nav-item')).find((x) => x.innerText.includes('设置')); if (b) b.click(); });
  await sleep(600);
  ok('设置页有字体切换', await page.evaluate(() => document.body.innerText.includes('全站 85W')));

  console.log('\n[8] 控制台错误');
  const real = errs.filter((e) => !/favicon|DevTools/i.test(e));
  ok('无 JS 运行时错误', real.length === 0, real.slice(0, 5));

  // 放在最后：下面会故意请求不存在的文件，必然产生 404 控制台日志
  console.log('\n[9] 静态资源回退（故意制造 404）');
  const staticFallback = await page.evaluate(async () => {
    const a = await fetch('/assets/__nope__.js', { method: 'HEAD' });
    const b = await fetch('/fonts/__nope__.woff2', { method: 'HEAD' });
    const c = await fetch('/some/spa/route');
    return { asset: a.status, font: b.status, spa: c.status, spaIsHtml: (c.headers.get('content-type') || '').includes('html') };
  });
  ok('缺失的 js 资源返回 404（不再被 SPA 回退骗成 200）', staticFallback.asset === 404, staticFallback);
  ok('缺失的字体文件返回 404', staticFallback.font === 404, staticFallback);
  ok('无扩展名的前端路由仍正常回退到 index.html', staticFallback.spa === 200 && staticFallback.spaIsHtml, staticFallback);
} catch (e) {
  fail++;
  console.log('  FAIL  中断: ' + (e && e.stack || e));
} finally {
  await browser.close();
stopIsolatedServer();
}

console.log('\n========================================');
console.log('  UI 验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
