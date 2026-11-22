// 背景图自动配色：看图调玻璃通透度和颜色
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8798);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);

// 造两张特征相反的图：一张干净柔和，一张又花又乱
const imgs = await p.evaluate(() => {
  const make = (kind) => {
    const cv = document.createElement('canvas');
    cv.width = 320; cv.height = 320;
    const g = cv.getContext('2d');
    if (kind === 'clean') {
      const grad = g.createLinearGradient(0, 0, 320, 320);
      grad.addColorStop(0, '#f6ece2'); grad.addColorStop(1, '#e8d9e6');
      g.fillStyle = grad; g.fillRect(0, 0, 320, 320);
    } else if (kind === 'busy') {
      for (let y = 0; y < 320; y += 8) {
        for (let x = 0; x < 320; x += 8) {
          g.fillStyle = ((x + y) / 8) % 2 ? '#0b0b12' : '#fdfdfd';
          g.fillRect(x, y, 8, 8);
        }
      }
    } else {
      g.fillStyle = '#e07a2c'; g.fillRect(0, 0, 320, 320);
    }
    return cv.toDataURL('image/jpeg', 0.9);
  };
  return { clean: make('clean'), busy: make('busy'), orange: make('orange') };
});

const vars = () => p.evaluate(() => {
  const root = document.documentElement;
  const side = document.querySelector('.sidebar');
  // --glass-a1 是个自定义属性，computed 出来还是没求值的 min(calc(...))，
  // 所以真正要看的是"用上它的那个元素"渲染成了什么样
  const bg = side ? getComputedStyle(side).backgroundImage : '';
  const alpha = (bg.match(/rgba\([^)]*?,\s*([\d.]+)\)/) || [])[1] || '';
  return {
    autostyle: root.dataset.autostyle,
    autofrozen: root.dataset.autofrozen,
    tint: root.style.getPropertyValue('--glass-tint'),
    tintPct: Math.round(Number(root.style.getPropertyValue('--glass-tint') || 0) * 100),
    glassRgb: root.style.getPropertyValue('--glass-rgb'),
    cardRgb: root.style.getPropertyValue('--card-rgb'),
    accent: root.style.getPropertyValue('--accent'),
    dimRgb: root.style.getPropertyValue('--dim-rgb'),
    bdDim: root.style.getPropertyValue('--bd-dim'),
    sidebarBg: bg.slice(0, 70),
    sidebarAlpha: Number(alpha)
  };
});
// v1.4.1：设置根页是列表，自动配色控件拆在「配色与对比度」二级页。
const openPage = async (id) => {
  await p.evaluate((x) => window.__schedule.ui.openSettingsPage(x), id);
  await sleep(500);
};
const apply = async (img, name) => {
  await p.evaluate((u, n) => window.__schedule.appearance.save({ mode: 'image', image: u, imageName: n }), img, name);
  await sleep(1400);
};

console.log('\n[1] 设了图之后自动接管');
await apply(imgs.clean, 'clean.jpg');
let v = await vars();
console.log('   干净图: ' + JSON.stringify(v));
ok('自动配色已生效（data-autostyle=1）', v.autostyle === '1', v.autostyle);
ok('写入了玻璃通透度', Number(v.tint) > 0, v.tint);
ok('写入了玻璃底色', /^\d+,\d+,\d+$/.test(v.glassRgb), v.glassRgb);
ok('写入了内容卡底色', /^\d+,\d+,\d+$/.test(v.cardRgb), v.cardRgb);
ok('写入了背景蒙版颜色和强度', /^\d+,\d+,\d+$/.test(v.dimRgb) && Number(v.bdDim) > 0, [v.dimRgb, v.bdDim]);
const cleanTint = v.tintPct;
const cleanAlpha = v.sidebarAlpha;

console.log('\n[2] 换一张花的图 → 玻璃变实');
await apply(imgs.busy, 'busy.jpg');
v = await vars();
const busyTint = v.tintPct;
console.log('   干净图 tint=' + cleanTint + '% 侧栏底色不透明度=' + cleanAlpha);
console.log('   花的图 tint=' + busyTint + '% 侧栏底色不透明度=' + v.sidebarAlpha);
ok('花的图让玻璃更实（tint 变大）', busyTint > cleanTint + 4, [cleanTint, busyTint]);
ok('玻璃真的变实了（实际渲染的不透明度跟着涨）', v.sidebarAlpha > cleanAlpha + 0.05, [cleanAlpha, v.sidebarAlpha]);
ok('花的图配色也没报错', errs.length === 0, errs.slice(0, 2));

console.log('\n[3] 换一张有主色的图 → 强调色跟着走');
await apply(imgs.orange, 'orange.jpg');
v = await vars();
console.log('   橙色图 accent=' + v.accent + ' cardRgb=' + v.cardRgb);
const orangeTint = v.tintPct;
ok('强调色变成了橙色调', /^hsl\(\s*(2[0-9]|3[0-9])[, ]/.test(v.accent), v.accent);
ok('玻璃底色带上了图片的暖调（红 > 蓝）', (() => {
  const c = v.cardRgb.split(',').map(Number);
  return c[0] > c[2];
})(), v.cardRgb);

console.log('\n[4] 关掉自动 → 保留 AI 算出来的这套颜色（v1.2.2 起）');
await p.evaluate(() => window.__schedule.appearance.save({ autoStyle: false }));
await sleep(900);
v = await vars();
console.log('   关闭后: ' + JSON.stringify(v));
ok('标记变成未启用', v.autostyle === '0', v.autostyle);
ok('玻璃底色没有交回主题，而是留着 AI 的数值', /^\d+,\d+,\d+$/.test(v.glassRgb) && /^\d+,\d+,\d+$/.test(v.cardRgb), [v.glassRgb, v.cardRgb]);
ok('强调色也留着 AI 的橙调', /^hsl\(\s*(2[0-9]|3[0-9])[, ]/.test(v.accent), v.accent);
ok('标记为「AI 固化」状态', v.autofrozen === '1', v.autofrozen);
ok('通透度对齐 AI 那档', v.tintPct === orangeTint, [v.tintPct, orangeTint]);
ok('蒙版也对齐 AI 那档', Math.abs(Number(v.bdDim) - 0.26) < 0.03, v.bdDim);
ok('侧栏用的仍是 AI 那档透明度（比手动的 20% 更透）', v.sidebarAlpha > 0.3 && v.sidebarAlpha < 0.55, v.sidebarAlpha);

console.log('\n[4b] 关掉之后滑杆还能自己调');
await p.evaluate(() => window.__schedule.appearance.save({ tint: 30, dim: 20 }));
await sleep(400);
v = await vars();
ok('通透度滑杆生效', Math.abs(v.tintPct - 30) < 0.5, v.tint);
ok('蒙版滑杆生效', Math.abs(Number(v.bdDim) - 0.2) < 0.01, v.bdDim);
ok('调滑杆不会把 AI 的颜色弄丢', /^\d+,\d+,\d+$/.test(v.glassRgb) && /^hsl\(/.test(v.accent), [v.glassRgb, v.accent]);

console.log('\n[4c] 离开图片模式 → 快照作废，交回主题');
await p.evaluate(() => window.__schedule.appearance.save({ mode: 'preset' }));
await sleep(900);
v = await vars();
console.log('   预设模式下: ' + JSON.stringify({ glassRgb: v.glassRgb, accent: v.accent, autofrozen: v.autofrozen }));
ok('固化标记清掉', v.autofrozen === '0', v.autofrozen);
ok('玻璃底色交回主题自带的纯白', v.glassRgb === '' && v.cardRgb === '', [v.glassRgb, v.cardRgb]);
ok('强调色交回主题自带的粉紫', v.accent === '', v.accent);
await p.evaluate(() => window.__schedule.appearance.save({ mode: 'image' }));
await sleep(1200);

console.log('\n[5] 再打开 → 立刻按图重算');
await p.evaluate(() => window.__schedule.appearance.save({ autoStyle: true }));
await sleep(1300);
v = await vars();
console.log('   重新开启后 tint=' + v.tintPct + '%（这张图上次算出来是 ' + orangeTint + '%）');
ok('重新接管', v.autostyle === '1', v.autostyle);
ok('按当前这张图重算了（和关之前一致）', v.tintPct === orangeTint, [v.tintPct, orangeTint]);

console.log('\n[6] 换主题会按新主题重算');
await p.evaluate(() => window.__schedule.appearance.save({ theme: 'neon' }));
await sleep(1500);
v = await vars();
console.log('   霓虹主题下: cardRgb=' + v.cardRgb + ' tint=' + v.tint);
ok('暗色主题下玻璃底色压暗了', (() => {
  const c = v.cardRgb.split(',').map(Number);
  return c.length === 3 && c.every((x) => x < 140);
})(), v.cardRgb);
ok('霓虹主题下依旧没有报错', errs.length === 0, errs.slice(0, 2));

console.log('\n[7] 面板上有这个功能');
await p.evaluate(() => window.__schedule.appearance.save({ theme: 'ins' }));
await sleep(1200);
await p.evaluate(() => { location.hash = '#settings'; });
await sleep(1200);
await openPage('colors');
const panel = await p.evaluate(() => {
  const t = document.body.innerText;
  // 开关本身就是个 checkbox：找到它，确认它绑的是 autoStyle
  const box = Array.from(document.querySelectorAll('input[type=checkbox]'))
    .find((x) => (x.closest('label') || {}).innerText && /自动配色/.test(x.closest('label').innerText));
  return {
    hasToggle: t.indexOf('自动配色') >= 0 && t.indexOf('根据背景图的风格自动调整玻璃通透度和颜色') >= 0,
    hasBox: !!box,
    boxChecked: box ? box.checked : null,
    boxDisabled: box ? box.disabled : null,
    hasMood: /🔍/.test(t),
    hasTint: /玻璃通透度定为\s*\d+%/.test(t),
    disabledSliders: Array.from(document.querySelectorAll('.slider')).filter((x) => x.disabled).length
  };
});
console.log('   面板: ' + JSON.stringify(panel));
ok('面板里有「自动配色」开关', panel.hasToggle, panel.hasToggle);
ok('开关是个可点的 checkbox，而且当前是开着的', panel.hasBox && panel.boxChecked === true && panel.boxDisabled === false, panel);
ok('列出了识别结果', panel.hasMood, panel.hasMood);
ok('列出了自动定下的通透度', panel.hasTint, panel.hasTint);
// 通透度 / 蒙版滑杆在「背景」页，换过去看它们是否被自动配色接管
await openPage('bg');
const bgDisabled = await p.evaluate(() => Array.from(document.querySelectorAll('.slider')).filter((x) => x.disabled).length);
ok('两个滑杆被置灰（说明由图片接管）', bgDisabled >= 2, bgDisabled);

console.log('\n[8] 随图生成：换了图，卡片和玻璃的颜色必须跟着变（v1.6.3）');
// 以前的算法是「白里掺 10~14% 的平均色」，两张不同的照片算出来都是 25x,24x,23x，
// 和白没差别 —— 用户的原话是「更换了图片后还是不变」。这里盯的就是这件事。
const pair = await p.evaluate(() => {
  const make = (a, b2) => {
    const cv = document.createElement('canvas');
    cv.width = 400; cv.height = 400;
    const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 400, 400);
    gr.addColorStop(0, a); gr.addColorStop(1, b2);
    g.fillStyle = gr; g.fillRect(0, 0, 400, 400);
    return cv.toDataURL('image/jpeg', 0.9);
  };
  return {
    lightBlue: make('#d8e6f7', '#b9cde8'),
    lightPeach: make('#f7e3cc', '#f0cdb2'),
    darkBlue: make('#0a1730', '#122a52')
  };
});
const shot = () => p.evaluate(() => {
  const r = document.documentElement;
  const st = window.__schedule.appearance.get();
  return {
    base: r.dataset.theme,
    cardRgb: r.style.getPropertyValue('--card-rgb'),
    glassRgb: r.style.getPropertyValue('--glass-rgb'),
    dimRgb: r.style.getPropertyValue('--dim-rgb'),
    key: st.frozen ? String(st.frozen.key) : ''
  };
});
const rgb = (s) => s.split(',').map(Number);
const applyAuto = async (img, name) => {
  await p.evaluate((u, n) => window.__schedule.appearance.save({ mode: 'image', image: u, imageName: n }), img, name);
  await sleep(1700);
};
await p.evaluate(() => window.__schedule.appearance.save({ theme: 'auto' }));
await sleep(1500);
await applyAuto(pair.lightBlue, 'light-blue.jpg');
const vBlue = await shot();
await applyAuto(pair.lightPeach, 'light-peach.jpg');
const vPeach = await shot();
console.log('   冷色图: ' + vBlue.base + ' card=' + vBlue.cardRgb + ' glass=' + vBlue.glassRgb);
console.log('   暖色图: ' + vPeach.base + ' card=' + vPeach.cardRgb + ' glass=' + vPeach.glassRgb);
const cb = rgb(vBlue.cardRgb), cp = rgb(vPeach.cardRgb);
const gb = rgb(vBlue.glassRgb), gp = rgb(vPeach.glassRgb);
ok('两张图都在浅色基色上（可比）', vBlue.base === 'ins' && vPeach.base === 'ins', [vBlue.base, vPeach.base]);
ok('冷色图的卡片偏冷（蓝 > 红）', cb[2] - cb[0] >= 8, vBlue.cardRgb);
ok('暖色图的卡片偏暖（红 > 蓝）', cp[0] - cp[2] >= 8, vPeach.cardRgb);
ok('换图后卡片底色真的变了（通道差 ≥ 10）', Math.max(...cb.map((x, i) => Math.abs(x - cp[i]))) >= 10, [vBlue.cardRgb, vPeach.cardRgb]);
ok('换图后玻璃底色也变了（通道差 ≥ 5）', Math.max(...gb.map((x, i) => Math.abs(x - gp[i]))) >= 5, [vBlue.glassRgb, vPeach.glassRgb]);
ok('冷色图玻璃也偏冷（蓝 > 红）', gb[2] - gb[0] >= 3, vBlue.glassRgb);
ok('着色之后卡片还是亮的（三通道都 ≥ 215）', cb.every((x) => x >= 215) && cp.every((x) => x >= 215), [vBlue.cardRgb, vPeach.cardRgb]);
ok('换图让快照失效并重算（背景指纹变了）', vBlue.key !== vPeach.key && vBlue.key.length > 0,
  [vBlue.key.slice(-28), vPeach.key.slice(-28)]);
await applyAuto(pair.darkBlue, 'dark-blue.jpg');
const vDark = await shot();
const cd = rgb(vDark.cardRgb);
console.log('   深色图: ' + vDark.base + ' card=' + vDark.cardRgb);
ok('深色图自动落到深色基色', vDark.base === 'neon', vDark.base);
ok('深色基色下卡片压得够暗（三通道都 ≤ 120）', cd.every((x) => x <= 120), vDark.cardRgb);
ok('深色基色下卡片仍是蓝调（蓝 > 红）', cd[2] > cd[0], vDark.cardRgb);
await p.screenshot({ path: 'shots-final/autostyle.png' });
await b.close();
if (!process.argv[2]) stopIsolatedServer();
console.log('\n========================================');
console.log('  看图配色验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
