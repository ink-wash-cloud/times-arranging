// v1.6.2 四档主题：INS / 霓虹 / 随图生成 / 自定义，以及自定义全部参数
import puppeteer from 'puppeteer-core';
import { rmSync } from 'node:fs';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const URL = process.argv[2] || await startIsolatedServer(8883);
const PROFILE = '.tmp/pptr-theme-profile';
rmSync(PROFILE, { recursive: true, force: true });
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', userDataDir: PROFILE, args: ['--no-sandbox','--disable-gpu'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message)));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(URL, { waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2500);

const openLook = async () => {
  await p.evaluate(() => { location.hash = '#settings'; });
  await sleep(650);
  const onLook = await p.evaluate(() => !!document.querySelector('[data-testid="theme-ins"]'));
  if (!onLook) {
    await p.evaluate(() => {
      const el = document.querySelector('[data-testid="set-row-look"]');
      if (el) el.click();
    });
    await sleep(700);
  }
  return p.evaluate(() => !!document.querySelector('[data-testid="theme-ins"]'));
};

const vars = () => p.evaluate(() => {
  const r = document.documentElement;
  const cs = getComputedStyle(r);
  const st = window.__schedule.appearance.get();
  const inline = (k) => r.style.getPropertyValue(k);
  const c = (v) => v.trim();
  return {
    style: r.dataset.style,
    theme: r.dataset.theme,
    autostyle: r.dataset.autostyle,
    autofrozen: r.dataset.autofrozen,
    tint: inline('--glass-tint'),
    bdDim: inline('--bd-dim'),
    glow: inline('--glow-strength'),
    strength: inline('--style-strength'),
    accent: c(cs.getPropertyValue('--accent')),
    accentInline: inline('--accent'),
    accent2Inline: inline('--accent-2'),
    text: c(cs.getPropertyValue('--text')),
    pill: c(cs.getPropertyValue('--pill-tab-a')),
    cardRgb: inline('--card-rgb'),
    rxs: inline('--r-xs'),
    rsm: inline('--r-sm'),
    rmd: inline('--r-md'),
    rlg: inline('--r-lg'),
    state: {
      theme: st.theme, base: st.base, tint: st.tint, dim: st.dim, glow: st.glow,
      styleStrength: st.styleStrength, cardShade: st.cardShade, radius: st.radius,
      colors: st.colors
    }
  };
});

const click = async (sel) => {
  const done = await p.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
  await sleep(500);
  return done;
};
const clickText = async (sel, text) => {
  const done = await p.evaluate((s, x) => {
    const el = Array.from(document.querySelectorAll(s)).find((n) => (n.textContent || '').trim() === x);
    if (!el) return false;
    el.click();
    return true;
  }, sel, text);
  await sleep(450);
  return done;
};
const setInput = async (sel, value) => {
  const done = await p.evaluate((s, v) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, sel, value);
  await sleep(350);
  return done;
};
const rgbBrightness = (s) => {
  const c = String(s || '').split(',').map(Number);
  return c.length === 3 ? c[0] + c[1] + c[2] : NaN;
};

console.log('\n[1] 设置 → 主题与字体：四档都在');
ok('设置根页能进入「主题与字体」', await openLook());
let v = await vars();
const labels = await p.evaluate(() => Array.from(document.querySelectorAll('.seg button'))
  .map((x) => (x.textContent || '').trim()).filter(Boolean));
console.log('   四档按钮: ' + JSON.stringify(labels.slice(0, 8)));
ok('有 INS 奶油风', labels.includes('INS 奶油风'), labels);
ok('有 暮色霓虹', labels.includes('暮色霓虹'), labels);
ok('有 随图生成', labels.includes('随图生成'), labels);
ok('有 自定义', labels.includes('自定义'), labels);
ok('卡头仍是「外观与性能」', (await p.evaluate(() => document.body.innerText)).includes('外观与性能'));

console.log('\n[2] 旧两档原样生效');
await click('[data-testid="theme-ins"]');
v = await vars();
const insAccent = v.accent;
ok('INS：data-style=ins', v.style === 'ins', v.style);
ok('INS：data-theme=ins', v.theme === 'ins', v.theme);
ok('INS：强调色落到了 --accent', v.accent.length > 0, v.accent);
await click('[data-testid="theme-neon"]');
v = await vars();
const neonAccent = v.accent;
ok('霓虹：data-style=neon', v.style === 'neon', v.style);
ok('霓虹：data-theme=neon', v.theme === 'neon', v.theme);
ok('霓虹：强调色与奶油风不同', neonAccent !== insAccent, [insAccent, neonAccent]);

console.log('\n[3] 随图生成（没设图时按预设渐变分析）');
await click('[data-testid="theme-auto"]');
await sleep(1300);
v = await vars();
console.log('   随图: ' + JSON.stringify({ style: v.style, theme: v.theme, tint: v.tint, accent: v.accent, state: v.state }));
ok('切到随图生成：data-style=auto', v.style === 'auto', v.style);
ok('随图生成落到一个明暗基色（data-theme=ins/neon）', v.theme === 'ins' || v.theme === 'neon', v.theme);
ok('随图生成接管了玻璃通透度', Number(v.tint) > 0, v.tint);
ok('标记了 AI 接管', v.autostyle === '1' && v.autofrozen === '1', [v.autostyle, v.autofrozen]);
ok('四档面板出现色板和建议值', await p.evaluate(() => !!document.querySelector('[data-testid="theme-auto-snapshot"]') && document.body.innerText.includes('建议通透度')));
ok('随图生成状态里存了快照（frozen.tint 有值）', await p.evaluate(() => {
  const g = window.__schedule.appearance.get();
  return !!(g.frozen && g.frozen.theme === 'auto' && typeof g.frozen.tint === 'number');
}));

console.log('\n[4] 换一张有主色的图 → 随图色相跟着走');
const orange = await p.evaluate(() => {
  const cv = document.createElement('canvas');
  cv.width = 320; cv.height = 320;
  const g = cv.getContext('2d');
  g.fillStyle = '#e07a2c'; g.fillRect(0, 0, 320, 320);
  return cv.toDataURL('image/jpeg', 0.9);
});
await p.evaluate((u) => window.__schedule.appearance.save({ mode: 'image', image: u, imageName: 'orange.jpg' }), orange);
await sleep(1700);
v = await vars();
console.log('   橙图随图: ' + JSON.stringify({ theme: v.theme, accent: v.accent, tint: v.tint }));
ok('橙图分析后强调色是橙调 hsl(20-39)', /hsl\(\s*(2[0-9]|3[0-9])[, ]/.test(v.accent), v.accent);
ok('橙图仍保持随图生成四档', v.style === 'auto', v.style);
ok('橙图重新算了快照而非沿用旧色', await p.evaluate(() => {
  const g = window.__schedule.appearance.get();
  return !!(g.frozen && g.frozen.key && g.frozen.accent);
}));

console.log('\n[5] 自定义：所有参数都列出来');
await click('[data-testid="theme-custom"]');
await sleep(550);
v = await vars();
ok('切到自定义：data-style=custom', v.style === 'custom', v.style);
ok('自定义面板出现', await p.evaluate(() => !!document.querySelector('[data-testid="theme-custom-panel"]')));
const controls = await p.evaluate(() => ({
  ranges: Array.from(document.querySelectorAll('[data-testid="theme-custom-panel"] input[type=range]')).length,
  colors: Array.from(document.querySelectorAll('[data-testid="theme-custom-panel"] input[type=color]')).length,
  radius: Array.from(document.querySelectorAll('[data-testid="theme-custom-panel"] [data-testid^="theme-radius-"]')).length,
  text: document.querySelector('[data-testid="theme-custom-panel"]').innerText
}));
console.log('   控件: ' + JSON.stringify({ ranges: controls.ranges, colors: controls.colors, radius: controls.radius }));
ok('5 个滑杆参数都在', controls.ranges >= 5, controls.ranges);
ok('圆角三档都在', controls.radius >= 3, controls.radius);
ok('4 个颜色参数都在', controls.colors >= 4, controls.colors);
ok('参数名与当前值可见', ['玻璃通透度','背景柔化','晕光强度','配色强度','卡片明暗','圆角档位','强调色','副强调色','文字色','选中滑块','底色基调'].every((x) => controls.text.includes(x)), controls.text.slice(0, 200));

console.log('\n[5b] 390px 手机宽：自定义参数可见、可滚动、截图');
await p.setViewport({ width: 390, height: 844 });
await sleep(550);
const mobile = await p.evaluate(() => {
  const doc = document.documentElement;
  const sc = document.querySelector('.content');
  const before = sc ? sc.scrollTop : 0;
  if (sc) sc.scrollTop = 300;
  const after = sc ? sc.scrollTop : 0;
  return {
    sw: doc.scrollWidth, cw: doc.clientWidth,
    sh: sc ? sc.scrollHeight : 0, ch: sc ? sc.clientHeight : 0,
    before, after,
    hasCustom: !!document.querySelector('[data-testid="theme-custom-panel"]'),
    hasShade: document.body.innerText.includes('卡片明暗')
  };
});
console.log('   手机: ' + JSON.stringify(mobile));
ok('390 宽没有横向溢出', mobile.sw <= mobile.cw + 1, mobile);
ok('手机上有自定义参数列表', mobile.hasCustom && mobile.hasShade, mobile);
ok('手机上的参数列表可滚动', mobile.after > mobile.before && mobile.sh > mobile.ch + 20, mobile);
await p.evaluate(() => { const sc = document.querySelector('.content'); if (sc) sc.scrollTop = 0; });
await sleep(300);
await p.screenshot({ path: '.tmp/v162-theme-mobile.png' });

await p.setViewport({ width: 1440, height: 1000 });
await sleep(550);
await p.evaluate(() => { const sc = document.querySelector('.content'); if (sc) sc.scrollTop = 0; });
await sleep(250);
await p.screenshot({ path: '.tmp/v162-theme-desktop.png' });


console.log('\n[6] 自定义每个参数落到对应 CSS 变量');
ok('拖通透度到 35', await setInput('[data-testid="theme-tint"]', 35));
v = await vars();
ok('通透度 → --glass-tint=0.35', Math.abs(Number(v.tint) - 0.35) < 0.005, v.tint);
ok('拖柔化到 27', await setInput('[data-testid="theme-dim"]', 27));
v = await vars();
ok('柔化 → --bd-dim=0.27', Math.abs(Number(v.bdDim) - 0.27) < 0.005, v.bdDim);
ok('拖晕光到 150', await setInput('[data-testid="theme-glow"]', 150));
v = await vars();
ok('晕光 → --glow-strength=1.5', Math.abs(Number(v.glow) - 1.5) < 0.005, v.glow);
ok('拖配色强度到 40', await setInput('[data-testid="theme-strength"]', 40));
v = await vars();
ok('配色强度 → --style-strength=0.4', Math.abs(Number(v.strength) - 0.4) < 0.005, v.strength);
ok('拖卡片明暗到 10', await setInput('[data-testid="theme-shade"]', 10));
const dark = await vars();
ok('卡片明暗 10 → --card-rgb 变暗', rgbBrightness(dark.cardRgb) < 300, dark.cardRgb);
ok('拖卡片明暗到 90', await setInput('[data-testid="theme-shade"]', 90));
const light = await vars();
ok('卡片明暗 90 → --card-rgb 变亮', rgbBrightness(light.cardRgb) > rgbBrightness(dark.cardRgb) + 200, [dark.cardRgb, light.cardRgb]);
ok('拖回卡片明暗 50', await setInput('[data-testid="theme-shade"]', 50));

ok('点圆角「大」', await click('[data-testid="theme-radius-2"]'));
v = await vars();
ok('圆角大 → --r-lg=28px / --r-md=22px / --r-sm=16px / --r-xs=12px',
  v.rlg === '28px' && v.rmd === '22px' && v.rsm === '16px' && v.rxs === '12px', [v.rxs, v.rsm, v.rmd, v.rlg]);
ok('点圆角「小」', await click('[data-testid="theme-radius-0"]'));
v = await vars();
ok('圆角小 → --r-lg=16px / --r-xs=7px', v.rlg === '16px' && v.rxs === '7px', [v.rxs, v.rlg]);

ok('选强调色 #123456', await setInput('[data-testid="theme-accent"]', '#123456'));
v = await vars();
ok('强调色 → --accent=#123456', v.accentInline.toLowerCase() === '#123456', v.accentInline);
ok('选副强调色 #abcdef', await setInput('[data-testid="theme-accent2"]', '#abcdef'));
v = await vars();
ok('副强调色 → --accent-2=#abcdef', v.accent2Inline.toLowerCase() === '#abcdef', v.accent2Inline);
ok('选文字色 #ff3b30', await setInput('[data-testid="theme-ink"]', '#ff3b30'));
v = await vars();
ok('文字色参与了 --text（红色分量 255）', /255\s*,\s*59\s*,\s*48/.test(v.text), v.text);
ok('选选中滑块 #00ff88', await setInput('[data-testid="theme-pill"]', '#00ff88'));
v = await vars();
ok('选中滑块 → --pill-tab-a（绿色分量 255）', /0\s*,\s*255\s*,\s*136/.test(v.pill), v.pill);

console.log('\n[7] 自定义的明暗基色与刷新保持');
await click('[data-testid="theme-base-neon"]');
v = await vars();
ok('切深色基色 → data-theme=neon', v.theme === 'neon', v.theme);
ok('深色基色卡片仍是自定义明暗', rgbBrightness(v.cardRgb) > 0, v.cardRgb);
await click('[data-testid="theme-base-ins"]');
v = await vars();
ok('切回浅色基色 → data-theme=ins', v.theme === 'ins', v.theme);

const beforeReload = await vars();
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2300);
await openLook();
await sleep(400);
v = await vars();
console.log('   刷新后: ' + JSON.stringify(v.state));
ok('刷新后仍是自定义', v.style === 'custom' && v.state.theme === 'custom', [v.style, v.state.theme]);
ok('刷新后通透度保持 35', v.state.tint === 35, v.state.tint);
ok('刷新后柔化保持 27', v.state.dim === 27, v.state.dim);
ok('刷新后晕光保持 150', v.state.glow === 150, v.state.glow);
ok('刷新后配色强度保持 40%', Math.abs(v.state.styleStrength - 0.4) < 0.005, v.state.styleStrength);
ok('刷新后强调色保持 #123456', String(v.state.colors.accent).toLowerCase() === '#123456', v.state.colors.accent);
ok('刷新后圆角档位保持小', v.state.radius === 0, v.state.radius);
ok('刷新后卡片明暗保持 50', v.state.cardShade === 50, v.state.cardShade);

console.log('\n[8] 旧配置兼容（没有 base/cardShade/radius 的 v1.6.1 配置）');
await p.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('schedule-app', 1);
  req.onerror = () => reject(req.error);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('meta', 'readwrite');
    const os = tx.objectStore('meta');
    const g = os.get('appearance');
    g.onsuccess = () => {
      const row = g.result;
      const old = Object.assign({}, row ? row.v : {});
      old.theme = 'ins';
      old.mode = 'preset';
      old.preset = 'cream';
      old.autoStyle = true;
      delete old.base;
      delete old.cardShade;
      delete old.radius;
      delete old.frozen;
      os.put({ k: 'appearance', v: old });
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  };
}));
await p.reload({ waitUntil: 'networkidle2' });
await p.waitForSelector('.app');
await sleep(2300);
const legacy = await p.evaluate(() => {
  const st = window.__schedule.appearance.get();
  return { theme: st.theme, base: st.base, cardShade: st.cardShade, radius: st.radius, style: document.documentElement.dataset.style };
});
console.log('   旧配置读回: ' + JSON.stringify(legacy));
ok('旧配置能正常读出主题', legacy.theme === 'ins' && legacy.base === 'ins' && legacy.style === 'ins', legacy);
ok('旧配置缺失的 cardShade 补成默认 50', legacy.cardShade === 50, legacy.cardShade);
ok('旧配置缺失的 radius 补成默认中', legacy.radius === 1, legacy.radius);

ok('全程没有页面错误', errs.length === 0, errs.slice(0, 3));

await b.close();
if (!process.argv[2]) stopIsolatedServer();
console.log('\n========================================');
console.log('  四档主题验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
