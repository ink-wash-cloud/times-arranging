// v1.2.1 可读性算法：不管什么背景、什么画质档，字和滑块都要看得清。
//
// 判定标准（WCAG）：正文 4.5:1、次要文字 3:1、选中滑块 5:1。
// 这里不复用 src/lib/contrast.ts 的实现，而是自己再算一遍 —— 两边独立算出来才说明算法真的对。
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};

// ---- 独立的对比度实现 ----
const srgb = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (rgb) => 0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2]);
const contrast = (a, b) => { const la = lum(a), lb = lum(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };
const parseRgb = (s) => {
  const m = String(s).match(/rgba?\(([^)]+)\)/) || String(s).match(/^\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (!m) return null;
  const parts = m[1].split(',').map((x) => parseFloat(x));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
};
const alphaOf = (s) => { const m = String(s).match(/rgba\([^)]*?,\s*([\d.]+)\s*\)/); return m ? Number(m[1]) : null; };
const over = (fg, a, bg) => [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];

const URL = process.argv[2] || await startIsolatedServer(8820);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);

const setApp = async (patch, ms = 700) => {
  await p.evaluate((x) => window.__schedule.appearance.save(x), patch);
  await sleep(ms);
};
const vars = () => p.evaluate(() => {
  const r = document.documentElement;
  const g = (k) => r.style.getPropertyValue(k).trim();
  const card = document.querySelector('.card');
  const pill = document.querySelector('.seg.slide-host .slide-pill') || document.querySelector('.slide-pill');
  const active = document.querySelector('.seg.slide-host > .on') || document.querySelector('.slide-host > .on');
  return {
    ink: g('--text'), dim: g('--dim'), dim2: g('--dim-2'), halo: g('--ink-halo'),
    readFloor: g('--read-floor'), panelFloor: g('--panel-floor'),
    onAccent: g('--on-accent'), accentText: g('--accent-text'),
    pillA: g('--pill-tab-a'), pillB: g('--pill-tab-b'), pillInk: g('--pill-tab-ink'), pillRing: g('--pill-tab-ring'),
    accent: g('--accent'), accent2: g('--accent-2'),
    inkMode: r.dataset.ink || '', motion: r.dataset.motion || '', perf: r.dataset.perf || '', theme: r.dataset.theme || '',
    cardBg: card ? getComputedStyle(card).backgroundColor : '',
    pillBg: pill ? getComputedStyle(pill).backgroundImage : '',
    pillOpacity: pill ? getComputedStyle(pill).opacity : '',
    activeColor: active ? getComputedStyle(active).color : '',
    activeText: active ? active.innerText.replace(/\s+/g, ' ').trim().slice(0, 12) : '',
    leg: window.__schedule.appearance.legibility()
  };
});

// 卡片实际渲染出来的那层颜色（叠在某个背景亮度上）
const surfaceOn = (v, bgLum) => {
  const cardRgb = parseRgb(v.cardBg);
  const alpha = alphaOf(v.cardBg);
  if (!cardRgb || alpha === null) return null;
  const bg = [bgLum * 255, bgLum * 255, bgLum * 255];
  return over(cardRgb, alpha, bg);
};

// v1.4.1：设置根页是列表，具体控件在二级页（这里按测试需要切页）。
const openPage = async (id) => {
  await p.evaluate((x) => window.__schedule.ui.openSettingsPage(x), id);
  await sleep(500);
};
const goSettings = async () => {
  const done = await p.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.nav-item'));
    const t = items.find((x) => /设置与同步/.test(x.innerText));
    if (!t) return false;
    t.click();
    return true;
  });
  if (done) await sleep(900);
  return done;
};

console.log('\n[1] 默认外观：算法给出字色、描边和滑块配色');
let v = await vars();
console.log('   ink=' + v.ink + ' mode=' + v.inkMode + ' pillA=' + v.pillA + ' pillInk=' + v.pillInk);
ok('写了正文/次要文字/描边', !!v.ink && !!v.dim && !!v.dim2 && /rgba?\(/.test(v.halo), [v.ink, v.dim, v.dim2, v.halo]);
ok('写了卡面与面板的下限', Number(v.readFloor) >= 0 && Number(v.panelFloor) >= 0, [v.readFloor, v.panelFloor]);
ok('写了滑块四件套', /rgba?\(/.test(v.pillA) && !!v.pillInk && !!v.pillRing, [v.pillA, v.pillInk, v.pillRing]);
ok('算法读数：正文 ' + (v.leg ? v.leg.bodyC.toFixed(2) : '?') + ':1、滑块 ' + (v.leg ? v.leg.pillC.toFixed(2) : '?') + ':1',
  !!v.leg && v.leg.bodyC >= 4.5 && v.leg.pillC >= 5, v.leg && [v.leg.bodyC, v.leg.pillC]);
ok('次要文字不低 3.0:1', !!v.leg && v.leg.dimC >= 3, v.leg && v.leg.dimC);
ok('深字配白边、浅字配暗影（描边方向跟字色一致）',
  !!v.leg && ((v.leg.dark && /255/.test(v.halo)) || (!v.leg.dark && /0, 0, 0/.test(v.halo))), [v.leg && v.leg.dark, v.halo]);
ok('滑块字色和滑块底色真的不一样（不是白压白）',
  !!parseRgb(v.pillInk) && !!parseRgb(v.pillA) && contrast(parseRgb(v.pillInk), parseRgb(v.pillA)) >= 4.5,
  [v.pillInk, v.pillA, !!parseRgb(v.pillInk) && !!parseRgb(v.pillA) ? contrast(parseRgb(v.pillInk), parseRgb(v.pillA)).toFixed(2) : null]);

console.log('\n[2] 纯黑背景：字色是按"字下面那层卡面"选的，不是按裸背景选的');
await setApp({ mode: 'color', color: '#000000', tint: 20 });
v = await vars();
// 20% 通透度时卡面已经是 81% 的白，压在黑背景上依然是一块浅色板 —— 这时候用深字才是对的
const surfBlack = surfaceOn(v, 0);
ok('正文对比度 >= 4.5', v.leg.bodyC >= 4.5, v.leg.bodyC);
ok('实际渲染的卡面上正文读得出来', !!surfBlack && contrast(parseRgb(v.ink), surfBlack) >= 4.4,
  surfBlack && contrast(parseRgb(v.ink), surfBlack).toFixed(2));
ok('强调色当文字也达标（两个端点都算过）', v.leg.accentTextC >= 4.5, v.leg.accentTextC);

console.log('\n[2b] 黑背景 + 玻璃拖到全透：字必须翻成浅色');
await setApp({ mode: 'color', color: '#000000', tint: 0 });
v = await vars();
const surfBlack0 = surfaceOn(v, 0);
ok('翻成浅色字', v.inkMode === 'light', v.inkMode);
ok('全透卡面上正文至少是 AA 大字级（>=3:1）', !!surfBlack0 && contrast(parseRgb(v.ink), surfBlack0) >= 3,
  surfBlack0 && contrast(parseRgb(v.ink), surfBlack0).toFixed(2));
ok('抬卡面救不了的时候不硬抬（玻璃保持通透）', v.leg.cardFloor <= 0.26, v.leg.cardFloor);

console.log('\n[3] 纯白背景 + 全透玻璃：字翻回深色');
await setApp({ mode: 'color', color: '#ffffff', tint: 0 });
v = await vars();
ok('翻成深色字', v.inkMode === 'dark', v.inkMode);
ok('正文对比度 >= 4.5', v.leg.bodyC >= 4.5, v.leg.bodyC);
const surfWhite = surfaceOn(v, 1);
ok('白底上正文读得出来', !!surfWhite && contrast(parseRgb(v.ink), surfWhite) >= 4.4,
  surfWhite && contrast(parseRgb(v.ink), surfWhite).toFixed(2));

console.log('\n[4] 中间灰 + 最透的玻璃：靠抬卡面兜底');
await setApp({ mode: 'color', color: '#8a8a8a', tint: 0 });
v = await vars();
ok('正文对比度仍然 >= 4.5', v.leg.bodyC >= 4.5, v.leg.bodyC);
ok('卡面下限不超过 +0.28（不能为了看得清把玻璃糊死）', v.leg.cardFloor <= 0.28, v.leg.cardFloor);
const surf = surfaceOn(v, 0.54);
ok('实际渲染的卡面能托住正文', !!surf && contrast(parseRgb(v.ink), surf) >= 4.4, surf && contrast(parseRgb(v.ink), surf));
ok('滑块对比度仍然 >= 5', v.leg.pillC >= 5, v.leg.pillC);

console.log('\n[5] 自定义各部分颜色');
await setApp({ customColors: true, colors: { accent: '#123456', accent2: '', ink: '#ff3b30', pill: '#00ff88' } });
v = await vars();
ok('文字色被自定义盖过', /255,\s*59,\s*48/.test(v.ink), v.ink);
ok('滑块底色被自定义盖过', /0,\s*255,\s*136/.test(v.pillA), v.pillA);
ok('强调色被自定义盖过', v.accent === '#123456', v.accent);
ok('自定义颜色下也会重算滑块字色（不是残留白字）', !!parseRgb(v.pillInk) && contrast(parseRgb(v.pillInk), parseRgb(v.pillA)) >= 4.5,
  [v.pillInk, parseRgb(v.pillA) ? contrast(parseRgb(v.pillInk), parseRgb(v.pillA)).toFixed(2) : null]);

console.log('\n[6] 交回自动');
await setApp({ customColors: false, colors: { accent: '', accent2: '', ink: '', pill: '' } });
v = await vars();
ok('文字色回到算法算的值', !/255,\s*59,\s*48/.test(v.ink), v.ink);
ok('强调色被摘掉（回到主题自带）', v.accent === '', v.accent);
ok('正文对比度仍然达标', v.leg.bodyC >= 4.5, v.leg.bodyC);

console.log('\n[7] 极致性能档（关掉背景模糊）下滑块照样看得见');
await setApp({ perf: 'ultra' }, 900);
v = await vars();
ok('切到了极致性能档', v.perf === 'ultra', v.perf);
ok('滑块是实心色块，不依赖模糊', /linear-gradient/.test(v.pillBg) && v.pillOpacity === '1', [v.pillBg.slice(0, 60), v.pillOpacity]);
const pillSolid = parseRgb(v.pillA);
ok('滑块底色不透明度足够（不是 18% 的白）', pillSolid !== null && lum(pillSolid) < 0.8, pillSolid);
ok('滑块上的字对比 >= 4.5', contrast(parseRgb(v.pillInk), pillSolid) >= 4.5, contrast(parseRgb(v.pillInk), pillSolid).toFixed(2));
const activeRgb = parseRgb(v.activeColor);
ok('选中项的字色在滑块上也读得出来', !activeRgb || contrast(activeRgb, pillSolid) >= 4.4, [v.activeColor, v.pillInk]);
await setApp({ perf: 'balanced' }, 700);

console.log('\n[8] 动效开关');
v = await vars();
ok('默认是「始终开」（不受系统减弱动画影响）', v.motion === 'full', v.motion);
await setApp({ motion: 'calm' }, 500);
const calm = await p.evaluate(() => {
  const el = document.querySelector('.view-enter');
  return { motion: document.documentElement.dataset.motion, anim: el ? getComputedStyle(el).animationName : '' };
});
ok('切到「减弱」后入场动画被关掉', calm.motion === 'calm' && calm.anim === 'none', calm);
await setApp({ motion: 'auto' }, 500);
ok('切到「跟随系统」', (await vars()).motion === 'auto');
await setApp({ motion: 'full' }, 400);

console.log('\n[9] 面板上的新控件');
ok('能进到设置页', await goSettings());
await openPage('perf');
const panelMotion = await p.evaluate(() => {
  const box = Array.from(document.querySelectorAll('.card')).find((c) => /外观与性能/.test(c.innerText));
  if (!box) return null;
  const t = box.innerText.replace(/\s+/g, ' ');
  return { hasMotion: /动效 · 始终开/.test(t) && /跟随系统/.test(t) && /减弱/.test(t) };
});
ok('面板里有动效三档', !!panelMotion && panelMotion.hasMotion, panelMotion);
await openPage('colors');
const panel = await p.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.card'));
  const box = cards.find((c) => /外观与性能/.test(c.innerText));
  if (!box) return null;
  const t = box.innerText.replace(/\s+/g, ' ');
  return {
    hasCustom: /自定义各个部分的颜色/.test(t),
    hasReadout: /最差情况下的对比度/.test(t),
    colorInputs: box.querySelectorAll('[data-colors="1"] input[type=color]').length
  };
});
ok('面板里有「自定义各个部分的颜色」', !!panel && panel.hasCustom, panel && panel.hasCustom);
ok('面板里有对比度读数', !!panel && panel.hasReadout, panel && panel.hasReadout);
ok('没开自定义时不显示取色器', !!panel && panel.colorInputs === 0, panel && panel.colorInputs);
await setApp({ customColors: true }, 700);
const panel2 = await p.evaluate(() => {
  const box = Array.from(document.querySelectorAll('.card')).find((c) => /外观与性能/.test(c.innerText));
  return box ? box.querySelectorAll('[data-colors="1"] input[type=color]').length : -1;
});
ok('开了自定义出现 4 个取色器（强调色/副强调色/文字色/滑块）', panel2 === 4, panel2);
await setApp({ customColors: false }, 600);

console.log('\n[10] 图片模式：配色强度 + 分析能力');
const img = await p.evaluate(() => {
  const cv = document.createElement('canvas');
  cv.width = 240; cv.height = 240;
  const g = cv.getContext('2d');
  g.fillStyle = '#7fa8c9'; g.fillRect(0, 0, 240, 240);
  return cv.toDataURL('image/jpeg', 0.9);
});
await setApp({ mode: 'image', image: img, imageName: 'cold.jpg', tint: 20 }, 1500);
v = await vars();
ok('冷色背景也会给出冷调强调色（不再回落到暖色主题色）', !!v.leg && v.leg.accentTextC >= 4.5, v.leg && v.leg.accentTextC);
const acc = await p.evaluate(() => window.__schedule.appearance.accent());
ok('强调色是冷调（蓝 > 红）', acc.accent[2] > acc.accent[0], acc.accent);
const strength = await p.evaluate(() => {
  const box = Array.from(document.querySelectorAll('.card')).find((c) => /外观与性能/.test(c.innerText));
  if (!box) return null;
  const rows = Array.from(box.querySelectorAll('.slider'));
  return { count: rows.length, hasStrength: /配色强度/.test(box.innerText) };
});
ok('面板里有「配色强度」滑杆', !!strength && strength.hasStrength, strength && strength.hasStrength);
await setApp({ styleStrength: 0 }, 1200);
const acc0 = await p.evaluate(() => window.__schedule.appearance.accent());
await setApp({ styleStrength: 1 }, 1200);
const acc1 = await p.evaluate(() => window.__schedule.appearance.accent());
ok('强度 0 和 1 给出不同的强调色（滑杆真的接上了）', JSON.stringify(acc0.accent) !== JSON.stringify(acc1.accent), [acc0.accent, acc1.accent]);
ok('强度 1 时更贴背景（蓝更突出）', acc1.accent[2] - acc1.accent[0] >= acc0.accent[2] - acc0.accent[0], [acc0.accent, acc1.accent]);

console.log('\n[11] 全程没有报错');
ok('没有页面错误', errs.length === 0, errs.slice(0, 3));

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
await b.close();
stopIsolatedServer();
process.exit(fail ? 1 : 0);
