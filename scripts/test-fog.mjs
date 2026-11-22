// 背景蒙层开关：关掉后直接显示原图，不再压一层白/灰的雾（v1.2.3）
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8824);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);

// v1.4.1：设置根页是列表，具体控件在二级页。默认外观控件拆在「背景」页。
const openPage = async (id) => {
  await p.evaluate((x) => window.__schedule.ui.openSettingsPage(x), id);
  await sleep(500);
};

const read = () => p.evaluate(() => {
  const root = document.documentElement;
  const dim = document.querySelector('.bd-dim');
  const layer = document.querySelector('.bd-layer');
  const cs = dim ? getComputedStyle(dim) : null;
  const ls = layer ? getComputedStyle(layer) : null;
  const leg = window.__schedule.appearance.legibility() || {};
  return {
    fog: root.dataset.fog,
    dimRgb: getComputedStyle(root).getPropertyValue('--dim-rgb').trim(),
    dimVar: root.style.getPropertyValue('--bd-dim'),
    dimDisplay: cs ? cs.display : 'missing',
    dimBg: cs ? cs.backgroundColor : '',
    layerBg: ls ? ls.backgroundImage.slice(0, 50) : '',
    layerFilter: ls ? ls.filter : '',
    bodyC: Number(leg.bodyC || 0)
  };
});

console.log('\n[1] 默认：蒙层是开着的');
let v = await read();
console.log('   ' + JSON.stringify(v));
ok('默认标记为开着', v.fog === '1', v.fog);
ok('蒙层那层还在渲染', v.dimDisplay !== 'none', v.dimDisplay);
ok('蒙层的颜色和强度都有值', v.dimRgb.length > 0 && Number(v.dimVar) > 0, [v.dimRgb, v.dimVar]);
ok('蒙层真的压了半透明色', /rgba?\(/.test(v.dimBg), v.dimBg);

// 一张特征明显的图：左半深蓝、右半亮橙
const img = await p.evaluate(() => {
  const cv = document.createElement('canvas');
  cv.width = 320; cv.height = 320;
  const g = cv.getContext('2d');
  g.fillStyle = '#16324f'; g.fillRect(0, 0, 160, 320);
  g.fillStyle = '#e58a3a'; g.fillRect(160, 0, 160, 320);
  return cv.toDataURL('image/jpeg', 0.9);
});

console.log('\n[2] 图片背景 + 关掉蒙层 → 直接显示原图');
await p.evaluate((u) => window.__schedule.appearance.save({ mode: 'image', image: u, imageName: 'fog.jpg' }), img);
await sleep(1500);
const before = await read();
ok('背景换成了这张图', /url\("data:image/.test(before.layerBg), before.layerBg);
ok('自动配色开着时蒙层也还在', before.dimDisplay !== 'none', before.dimDisplay);
await p.evaluate(() => window.__schedule.appearance.save({ fog: false }));
await sleep(700);
v = await read();
console.log('   关掉后: ' + JSON.stringify(v));
ok('标记变成关闭', v.fog === '0', v.fog);
ok('蒙层整层不渲染了', v.dimDisplay === 'none', v.dimDisplay);
ok('背景还是那张原图', v.layerBg === before.layerBg, [before.layerBg, v.layerBg]);
ok('背景层没被加滤镜', v.layerFilter === 'none', v.layerFilter);
ok('原图直出时正文照样够清楚（≥4.5:1）', v.bodyC >= 4.5, v.bodyC);

console.log('\n[3] 面板里有这个开关');
await p.evaluate(() => { location.hash = '#settings'; });
await sleep(1500);
await openPage('bg');
const panel = await p.evaluate(() => {
  const box = document.querySelector('[data-fog-box="1"]');
  const cb = box ? box.querySelector('input[type=checkbox]') : null;
  const t = document.body.innerText;
  const fld = Array.from(document.querySelectorAll('.field'))
    .find((f) => /背景(柔化|压暗)/.test(((f.querySelector('label') || {}).textContent) || ''));
  const sl = fld ? fld.querySelector('input.slider') : null;
  return {
    hasBox: !!box,
    checked: cb ? cb.checked : null,
    hasTitle: /背景蒙层/.test(t),
    offText: /已关闭：背景是原图原样/.test(t),
    sliderDisabled: sl ? sl.disabled : null
  };
});
console.log('   面板: ' + JSON.stringify(panel));
ok('面板里有「背景蒙层」开关', panel.hasBox && panel.hasTitle, panel);
ok('当前状态是关着的', panel.checked === false, panel.checked);
ok('说明文案写清了关掉的效果', panel.offText, panel);
ok('「背景柔化／压暗」滑杆变成不可拖', panel.sliderDisabled === true, panel.sliderDisabled);

console.log('\n[4] 刷新之后仍然关着');
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);
v = await read();
ok('刷新后标记还是关闭', v.fog === '0', v.fog);
ok('刷新后蒙层还是不渲染', v.dimDisplay === 'none', v.dimDisplay);
ok('刷新后背景图也在', /url\("data:image/.test(v.layerBg), v.layerBg);

console.log('\n[5] 从面板勾回来 → 蒙层恢复');
await p.evaluate(() => { location.hash = '#settings'; });
await sleep(1500);
await openPage('bg');
await p.evaluate(() => {
  const cb = document.querySelector('[data-fog-box="1"] input[type=checkbox]');
  if (cb) cb.click();
});
await sleep(900);
v = await read();
console.log('   勾回来后: ' + JSON.stringify({ fog: v.fog, dimDisplay: v.dimDisplay, dimBg: v.dimBg }));
ok('勾回来后蒙层又出现了', v.fog === '1' && v.dimDisplay !== 'none', [v.fog, v.dimDisplay]);
ok('蒙层又压上了半透明色', /rgba?\(/.test(v.dimBg), v.dimBg);
const dimHint = await p.evaluate(() => {
  const fld = Array.from(document.querySelectorAll('.field'))
    .find((f) => /背景(柔化|压暗)/.test(((f.querySelector('label') || {}).textContent) || ''));
  return fld ? (((fld.querySelector('.muted') || {}).textContent) || '') : null;
});
console.log('   滑杆说明: ' + JSON.stringify(dimHint));
ok('置灰原因换回「自动配色在接管」，不再怪蒙层', /接管/.test(dimHint || '') && !/背景蒙层」关着/.test(dimHint || ''), dimHint);

console.log('\n[6] 预设背景（不是图片）也能关');
await p.evaluate(() => window.__schedule.appearance.save({ mode: 'preset', fog: false }));
await sleep(900);
v = await read();
console.log('   预设模式下: ' + JSON.stringify({ fog: v.fog, dimDisplay: v.dimDisplay, layerBg: v.layerBg.slice(0, 24) }));
ok('预设模式下蒙层同样能关掉', v.fog === '0' && v.dimDisplay === 'none', [v.fog, v.dimDisplay]);
ok('预设自带的渐变背景还在', /gradient/.test(v.layerBg), v.layerBg);
ok('预设模式下正文照样读得清', v.bodyC >= 4.5, v.bodyC);
await p.evaluate(() => window.__schedule.appearance.save({ fog: true }));
await sleep(700);
const dimSlider = await p.evaluate(() => {
  const fld = Array.from(document.querySelectorAll('.field'))
    .find((f) => /背景(柔化|压暗)/.test(((f.querySelector('label') || {}).textContent) || ''));
  const sl = fld ? fld.querySelector('input.slider') : null;
  return sl ? { disabled: sl.disabled, max: sl.max } : null;
});
ok('预设 + 蒙层开着时，这颗滑杆可以拖', !!dimSlider && dimSlider.disabled === false, dimSlider);

console.log('\n[7] 全程没有报错');
ok('没有页面错误', errs.length === 0, errs.slice(0, 3));

await p.screenshot({ path: 'shots-final/fog-off.png' });
await b.close();
if (!process.argv[2]) stopIsolatedServer();
console.log('\n========================================');
console.log('  背景蒙层开关验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
