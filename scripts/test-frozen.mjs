// v1.2.2 需求①：关掉「AI 自动配色」时保持 AI 的结果不变，让用户在其上继续微调。
//
// 判定点：
//   1. 关闭的那一刻，AI 算出来的强调色 / 玻璃颜色一帧都不跳（不是回落到主题暖色）
//   2. 通透度、背景蒙版对齐成 AI 的数值，滑杆立刻能动，动了真生效
//   3. 自定义颜色仍然优先于固化快照
//   4. 重新打开自动配色 / 换一张图，快照作废
//   5. 刷新页面后快照还在（存在 IndexedDB 的 appearance 里）
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};

const URL = process.argv[2] || await startIsolatedServer(8822);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);

// v1.4.1：设置根页是列表，外观控件拆在 look/bg/perf/colors 二级页。
const openPage = async (id) => {
  await p.evaluate((x) => window.__schedule.ui.openSettingsPage(x), id);
  await sleep(500);
};
const setApp = async (patch, ms = 800) => {
  await p.evaluate((x) => window.__schedule.appearance.save(x), patch);
  await sleep(ms);
};
const vars = () => p.evaluate(() => {
  const r = document.documentElement;
  const g = (k) => r.style.getPropertyValue(k).trim();
  const st = window.__schedule.appearance.get();
  return {
    accent: g('--accent'), accent2: g('--accent-2'),
    glassRgb: g('--glass-rgb'), cardRgb: g('--card-rgb'),
    overlayRgb: g('--overlay-rgb'), dimRgb: g('--dim-rgb'),
    tint: g('--glass-tint'), bdDim: g('--bd-dim'),
    autostyle: r.dataset.autostyle || '', autofrozen: r.dataset.autofrozen || '',
    state: { tint: st.tint, dim: st.dim, autoStyle: st.autoStyle, mode: st.mode, styleStrength: st.styleStrength },
    frozen: window.__schedule.appearance.frozen(),
    leg: window.__schedule.appearance.legibility()
  };
});
const makeImg = (color) => p.evaluate((c) => {
  const cv = document.createElement('canvas');
  cv.width = 240; cv.height = 240;
  const g = cv.getContext('2d');
  g.fillStyle = c; g.fillRect(0, 0, 240, 240);
  return cv.toDataURL('image/jpeg', 0.9);
}, color);

// 冷色图：用户说的"冷背景配暖按钮"就是这张图以前会翻车
const cold = await makeImg('#7fa8c9');
const warm = await makeImg('#d98b5f');

console.log('\n[1] 图片 + 自动配色：先让 AI 算出一套值');
await setApp({ mode: 'image', image: cold, imageName: 'cold.jpg', autoStyle: true, customColors: false, styleStrength: 0.9 }, 2200);
let v = await vars();
console.log('   accent=' + v.accent + ' cardRgb=' + v.cardRgb + ' tint=' + v.tint);
ok('自动配色已接管（dataset.autostyle=1）', v.autostyle === '1', v.autostyle);
ok('AI 给出了强调色', !!v.accent, v.accent);
ok('AI 定了通透度（写进 --glass-tint）', Number(v.tint) > 0, v.tint);
const ai = { accent: v.accent, accent2: v.accent2, glassRgb: v.glassRgb, cardRgb: v.cardRgb, overlayRgb: v.overlayRgb, dimRgb: v.dimRgb, tint: v.tint };

console.log('\n[2] 关掉自动配色：AI 的结果必须原样留着');
await setApp({ autoStyle: false }, 900);
v = await vars();
ok('强调色一帧都没变（不再回落成暖色主题色）', v.accent === ai.accent, [ai.accent, v.accent]);
ok('副强调色也没变', v.accent2 === ai.accent2, [ai.accent2, v.accent2]);
ok('玻璃底色 / 卡面 / 浮层底色都留着', v.glassRgb === ai.glassRgb && v.cardRgb === ai.cardRgb && v.overlayRgb === ai.overlayRgb && v.dimRgb === ai.dimRgb,
  [v.glassRgb, v.cardRgb, v.overlayRgb, v.dimRgb]);
ok('dataset.autofrozen=1（界面能看出"这套值来自 AI"）', v.autofrozen === '1', v.autofrozen);
ok('通透度对齐成 AI 的数值（滑杆不会跳回旧值）', Math.abs(v.state.tint / 100 - Number(ai.tint)) < 0.011, [v.state.tint, ai.tint]);
ok('背景蒙版也对齐成 AI 的数值', Math.abs(v.state.dim / 100 - Number(v.bdDim)) < 0.011, [v.state.dim, v.bdDim]);
ok('快照记下了图与主题', !!v.frozen && !!v.frozen.image && !!v.frozen.theme, v.frozen && [v.frozen.image ? 'img' : '', v.frozen.theme]);
ok('可读性算法仍然用 AI 的强调色', !!v.leg && v.leg.accentTextC >= 4.5, v.leg && v.leg.accentTextC);

console.log('\n[3] 关掉之后照样能手调');
await setApp({ tint: 4 }, 700);
v = await vars();
ok('拖通透度滑杆立刻生效（--glass-tint 跟着走）', Math.abs(Number(v.tint) - 0.04) < 0.001, v.tint);
ok('调通透度不会把 AI 的强调色弄丢', v.accent === ai.accent, [ai.accent, v.accent]);
ok('快照还在（不会被一次滑杆操作清掉）', !!v.frozen, !!v.frozen);
await setApp({ dim: 30 }, 600);
v = await vars();
ok('背景蒙版也能手调', Math.abs(Number(v.bdDim) - 0.3) < 0.01, v.bdDim);

console.log('\n[4] 自定义颜色优先于固化快照');
await setApp({ customColors: true, colors: { accent: '#ff3b30', accent2: '#00a3ff', ink: '', pill: '' } }, 700);
v = await vars();
ok('自定义强调色盖过 AI 的', String(v.accent).toLowerCase().includes('255, 59, 48') || String(v.accent).toLowerCase() === '#ff3b30', v.accent);
await setApp({ customColors: false }, 700);
v = await vars();
ok('关掉自定义后回到 AI 固化的那套', v.accent === ai.accent, [ai.accent, v.accent]);

console.log('\n[5] 面板文案：说明"AI 的值已固化"');
const panel = await p.evaluate(() => {
  const items = Array.from(document.querySelectorAll('.nav-item'));
  const t = items.find((x) => /设置与同步/.test(x.innerText));
  if (t) t.click();
  return !!t;
});
await sleep(1200);
await openPage('colors');
const panelText = await p.evaluate(() => {
  const box = Array.from(document.querySelectorAll('.card')).find((c) => /外观与性能/.test(c.innerText));
  return box ? box.innerText : '';
});
ok('进入了设置页并能看到外观面板', panel && panelText.length > 0, [panel, panelText.length]);
ok('面板写着 AI 那套颜色保留着', /AI 算出来的这套颜色保留着/.test(panelText), panelText.slice(0, 200));
await openPage('bg');
const sliders = await p.evaluate(() => {
  const box = Array.from(document.querySelectorAll('.card')).find((c) => /外观与性能/.test(c.innerText));
  if (!box) return null;
  return Array.from(box.querySelectorAll('input[type=range]')).map((r) => ({ max: r.max, value: r.value, disabled: r.disabled }));
});
const tintSlider = sliders && sliders.find((s) => s.max === '45');
const dimSlider = sliders && sliders.find((s) => s.max === '70');
ok('通透度滑杆不再是禁用的（关掉自动配色后交回用户）', !!tintSlider && tintSlider.disabled === false, tintSlider);
ok('通透度滑杆的当前值就是刚才手调的 4%', !!tintSlider && Number(tintSlider.value) === 4, tintSlider && tintSlider.value);
ok('背景蒙版滑杆也能用了', !!dimSlider && dimSlider.disabled === false && Number(dimSlider.value) === 30, dimSlider);

console.log('\n[6] 重新打开自动配色 → 快照作废，交回 AI');
await setApp({ autoStyle: true }, 2000);
v = await vars();
ok('autostyle 重新为 1', v.autostyle === '1', v.autostyle);
ok('autofrozen 归零', v.autofrozen === '0', v.autofrozen);
ok('快照已清空', v.frozen === null, v.frozen);
ok('强调色回到 AI 实时算出来的那套', v.accent === ai.accent, [ai.accent, v.accent]);

console.log('\n[7] 换图后快照失效（不把旧图的颜色硬套到新图上）');
await setApp({ autoStyle: false }, 900);
v = await vars();
ok('先固化一份快照', !!v.frozen, !!v.frozen);
await setApp({ image: warm, imageName: 'warm.jpg' }, 2000);
v = await vars();
ok('换图后 autofrozen 归零', v.autofrozen === '0', v.autofrozen);
ok('换图后快照被丢掉', v.frozen === null, v.frozen);

console.log('\n[8] 刷新后快照还在（存进了 IndexedDB）');
await setApp({ autoStyle: true }, 2000);
await setApp({ autoStyle: false }, 900);
const keep = (await vars()).accent;
ok('固化下来的强调色不是空的（否则下面比不出东西）', !!keep, keep);
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2600);
v = await vars();
ok('刷新后仍然是关闭状态', v.state.autoStyle === false, v.state.autoStyle);
ok('刷新后强调色还是那套', v.accent === keep, [keep, v.accent]);
ok('刷新后快照还在', !!v.frozen, !!v.frozen);

console.log('\n[9] 全程没有报错');
ok('没有页面错误', errs.length === 0, errs.slice(0, 3));

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
await b.close();
stopIsolatedServer();
process.exit(fail ? 1 : 0);
