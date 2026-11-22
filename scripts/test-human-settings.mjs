// 真人流程：设置页与全部二级页（task-17）
// 跑法：node scripts/test-human-settings.mjs
//
// 这个套件只做一件事：像人一样把设置页点一遍。
// 动作尽量走真实鼠标/键盘；state() 只用来读结果做断言，不拿来改 store。
import fs from 'node:fs';
import path from 'node:path';
import {
  report, launch, openApp, clickText, click, typeInto, press, text,
  waitText, waitGone, go, shot, state
} from './e2e.mjs';
import { startIsolatedServer, stopIsolatedServer, ROOT } from './isoserver.mjs';

const PORT = 8863;
const TOKEN = 'human-settings-token-17';
const TITLE = '真人流程：设置页与全部二级页';
const r = report(TITLE);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let browser = null;
let page = null;
let errors = [];
let url = '';

/* ------------------------------ 页面读数 ------------------------------ */

async function readUi() {
  return state(page, () => {
    const root = document.documentElement;
    const q = (s) => document.querySelector(s);
    const qa = (s) => Array.from(document.querySelectorAll(s));
    const txt = (el) => (el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '');
    const app = window.__schedule;
    const rows = qa('[data-testid^="set-row-"]');
    const rowText = {};
    rows.forEach((el) => { rowText[el.getAttribute('data-testid')] = txt(el); });
    let reminder = {};
    try { reminder = JSON.parse(localStorage.getItem('reminderCfg') || '{}'); } catch { reminder = {}; }
    return {
      settingsPage: app && app.ui ? app.ui.settingsPage() : '',
      groups: qa('.set-group-h').map(txt),
      rows: rows.length,
      rowText,
      hasRow: !!q('[data-testid="set-row-lang"]'),
      subTitle: txt(q('.subpage-t')),
      subBody: txt(q('.subpage-body')),
      hasSub: !!q('.subpage'),
      hasBack: !!q('.subpage-back'),
      theme: root.dataset.theme || '',
      font: root.dataset.font || '',
      mode: root.dataset.bdMode || '',
      lang: root.lang || '',
      dataLang: root.getAttribute('data-lang') || '',
      cjk: root.getAttribute('data-cjk') || '',
      topTitle: txt(q('.topbar h1')),
      appVisible: !!q('.app'),
      bodyLen: (document.body.innerText || '').length,
      vars: {
        dim: getComputedStyle(root).getPropertyValue('--bd-dim').trim(),
        tint: getComputedStyle(root).getPropertyValue('--glass-tint').trim(),
        glow: getComputedStyle(root).getPropertyValue('--glow-strength').trim()
      },
      appState: app && app.appearance ? app.appearance.get() : null,
      cfg: app ? app.cfg : null,
      reminder
    };
  });
}

async function readLang() {
  return state(page, () => {
    const root = document.documentElement;
    const q = (s) => document.querySelector(s);
    const txt = (el) => (el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : '');
    return {
      page: window.__schedule.ui.settingsPage(),
      hasRow: !!q('[data-testid="set-row-lang"]'),
      title: txt(q('.subpage-t')),
      topTitle: txt(q('.topbar h1')),
      langs: document.querySelectorAll('[data-lang-id]').length,
      lang: root.lang || '',
      dataLang: root.getAttribute('data-lang') || '',
      cjk: root.getAttribute('data-cjk') || ''
    };
  });
}

async function readSlider() {
  return state(page, () => {
    const a = window.__schedule.appearance.get();
    const cs = getComputedStyle(document.documentElement);
    return {
      dim: a.dim, tint: a.tint, glow: a.glow,
      vars: {
        dim: cs.getPropertyValue('--bd-dim').trim(),
        tint: cs.getPropertyValue('--glass-tint').trim(),
        glow: cs.getPropertyValue('--glow-strength').trim()
      }
    };
  });
}

async function readLayer() {
  return state(page, () => {
    const el = document.querySelector('.bd-layer');
    if (!el) return { exists: false, image: '', inlineImage: '', background: '' };
    return {
      exists: true,
      image: getComputedStyle(el).backgroundImage,
      inlineImage: el.style.backgroundImage || '',
      background: el.style.background || ''
    };
  });
}

async function waitRoot() {
  for (let i = 0; i < 35; i++) {
    const s = await readUi();
    if (s.settingsPage === 'root' && s.rows === 12 && !s.hasSub) return s;
    await sleep(120);
  }
  return readUi();
}

/* ------------------------------ 页面动作 ------------------------------ */

async function backToRoot() {
  let s = await readUi();
  if (s.hasSub) {
    await click(page, '.subpage-back', { wait: 450 });
  }
  return waitRoot();
}

async function dragSlider(label, ratio = 0.82) {
  const handle = await page.evaluateHandle((needle) => {
    const fields = Array.from(document.querySelectorAll('.field'));
    for (const f of fields) {
      const lab = f.querySelector('label');
      if (lab && (lab.textContent || '').includes(needle)) {
        return f.querySelector('input[type="range"]');
      }
    }
    return null;
  }, label);
  const el = handle.asElement();
  if (!el) { await handle.dispose(); return false; }
  await el.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await sleep(120);
  const box = await el.boundingBox();
  if (!box) { await handle.dispose(); return false; }
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.12, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ratio, y, { steps: 10 });
  await page.mouse.up();
  await sleep(350);
  await handle.dispose();
  return true;
}

const VISITS = [
  { name: '语言', row: 'set-row-lang', id: 'lang', title: '语言', content: '界面语言' },
  { name: '主题与字体', row: 'set-row-look', id: 'look', title: '主题与字体', content: '整体风格' },
  { name: '背景', row: 'set-row-bg', id: 'bg', title: '背景', content: '预设渐变' },
  { name: '性能与动效', row: 'set-row-perf', id: 'perf', title: '性能与动效', content: '性能档位' },
  { name: '配色与对比度', row: 'set-row-colors', id: 'colors', title: '配色与对比度', content: '自定义各个部分的颜色' },
  { name: '数据与同步', row: 'set-row-sync-addr', id: 'sync', title: '数据与同步', content: '这台电脑的地址', content2: '同步方向' },
  { name: '提醒', row: 'set-row-remind', id: 'remind', title: '提醒', content: '事项临近提醒' },
  { name: '桌面小组件', row: 'set-row-widget', id: 'widget', title: '桌面小组件', content: '手机版才有的功能' },
  { name: '装到电脑 / 手机', row: 'set-row-apps', id: 'apps', title: '装到电脑 / 手机', content: '电脑应用' },
  { name: 'AI 助手', row: 'set-row-ai', id: 'ai', title: 'AI 助手', content: 'AI 识别' },
  { name: '使用说明与更新日志', row: 'set-row-about', id: 'about', title: '使用说明与更新日志', content: '更新日志' }
];

async function visitPage(def) {
  let entered = false;
  let returned = false;
  let info = null;
  try {
    await click(page, '[data-testid="' + def.row + '"]', { wait: 500 });
    for (let i = 0; i < 20; i++) {
      info = await readUi();
      if (info.settingsPage === def.id && info.hasSub) break;
      await sleep(120);
    }
    entered = info.settingsPage === def.id && info.hasBack &&
      info.subTitle === def.title &&
      info.subBody.includes(def.content) &&
      (!def.content2 || info.subBody.includes(def.content2));
    await click(page, '.subpage-back', { wait: 450 });
    const root = await waitRoot();
    returned = root.settingsPage === 'root' && root.rows === 12 && !root.hasSub;
  } catch (e) {
    info = { error: String((e && e.message) || e) };
    try {
      await state(page, () => window.__schedule.ui.openSettingsPage('root'));
      await sleep(400);
    } catch { /* 恢复失败就交给后面的断言暴露 */ }
  }
  r.ok('进入「' + def.name + '」看到专属内容，再返回根页',
    entered && returned,
    { entered, returned, page: info && info.settingsPage, title: info && info.subTitle, error: info && info.error });
}

/* ------------------------------ 语言动作 ------------------------------ */

async function ensureLangPage() {
  let s = await readLang();
  if (s.page === 'lang') return s;
  if (!s.hasRow) {
    // 语言切换会重挂整页；万一停在别的页面，用 hash 回到设置，再走真实点击。
    await state(page, () => { location.hash = '#settings'; });
    await sleep(900);
  }
  await click(page, '[data-testid="set-row-lang"]', { wait: 500 });
  return readLang();
}

async function pickLang(id) {
  await ensureLangPage();
  await click(page, '[data-lang-id="' + id + '"]', { wait: 1000 });
  await sleep(450);
  let s = await readLang();
  if (s.page !== 'lang') {
    s = await ensureLangPage();
  }
  return s;
}

/* ------------------------------ 主流程 ------------------------------ */

try {
  const pngPath = path.join(ROOT, '.tmp', 'human-settings-bg.png');
  fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  fs.writeFileSync(pngPath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  ));

  url = await startIsolatedServer(PORT, { SHIXU_AUTO_EXIT: '0' });
  const launched = await launch();
  browser = launched.browser;
  page = launched.page;
  errors = launched.errors;
  await openApp(page, url);

  console.log('\n[1] 设置根页：四组、入口、默认值');
  const navOk = await go(page, '设置与同步');
  await waitText(page, '外观');
  const root = await waitRoot();
  r.note('任务书写「10 行」，当前实现是 ' + root.rows + ' 行：外观 5 + 数据与同步 2 + 提醒 1 + 应用 4；同步的两行进入同一个二级页');
  r.ok('侧栏能进设置；四组顺序正确且共 12 行',
    navOk && root.settingsPage === 'root' &&
    root.groups.length === 4 &&
    root.groups.join('|') === '外观|数据与同步|提醒|应用' &&
    root.rows === 12,
    { navOk, groups: root.groups, rows: root.rows });

  const rowIds = [
    'set-row-lang', 'set-row-look', 'set-row-bg', 'set-row-perf', 'set-row-colors',
    'set-row-sync-addr', 'set-row-sync-backup', 'set-row-remind',
    'set-row-widget', 'set-row-apps', 'set-row-ai', 'set-row-about'
  ];
  r.ok('12 个入口的 testid 都在，默认值能看见',
    rowIds.every((id) => !!root.rowText[id]) &&
    /INS 奶油风/.test(root.rowText['set-row-look'] || '') &&
    /预设渐变/.test(root.rowText['set-row-bg'] || '') &&
    /本机（同源）/.test(root.rowText['set-row-sync-addr'] || '') &&
    /双向同步/.test(root.rowText['set-row-sync-backup'] || '') &&
    /已开启/.test(root.rowText['set-row-remind'] || '') &&
    /v\d+\.\d+\.\d+/.test(root.rowText['set-row-about'] || ''),
    root.rowText);

  console.log('\n[2] 逐个进入二级页，再点「‹ 返回」回根页');
  for (const def of VISITS) await visitPage(def);

  console.log('\n[3] 安卓返回键：back.press 只退一层');
  await click(page, '[data-testid="set-row-look"]', { wait: 500 });
  await state(page, () => window.__schedule.back.press());
  const backRoot = await waitRoot();
  r.ok('back.press 从二级页回到设置根页，没有一次退到首页',
    backRoot.settingsPage === 'root' && backRoot.rows === 12 && !backRoot.hasSub &&
    backRoot.topTitle === '设置与同步',
    { page: backRoot.settingsPage, rows: backRoot.rows, title: backRoot.topTitle });

  console.log('\n[4] 主题：INS 奶油风 ↔ 暮色霓虹');
  // 上一步 back.press 已经回到根页，重新走真实入口。
  await click(page, '[data-testid="set-row-look"]', { wait: 500 });
  await clickText(page, '.seg button', '暮色霓虹', { wait: 600 });
  const neon = await readUi();
  await clickText(page, '.seg button', 'INS 奶油风', { wait: 600 });
  const ins = await readUi();
  r.ok('主题双向切换生效，页面没有白屏',
    neon.theme === 'neon' && neon.appState && neon.appState.theme === 'neon' &&
    neon.appVisible && neon.bodyLen > 200 && neon.subBody.includes('外观与性能') &&
    ins.theme === 'ins' && ins.appState && ins.appState.theme === 'ins' &&
    ins.appVisible && ins.bodyLen > 200 && ins.subBody.includes('外观与性能'),
    { neon: [neon.theme, neon.appState && neon.appState.theme, neon.bodyLen], ins: [ins.theme, ins.appState && ins.appState.theme, ins.bodyLen] });

  console.log('\n[5] 字体三档：data-font 与 data-cjk');
  await clickText(page, '.seg button', '仅标题 85W', { wait: 400 });
  const fTitle = await readUi();
  await clickText(page, '.seg button', '系统默认', { wait: 400 });
  const fSystem = await readUi();
  await clickText(page, '.seg button', '全站 85W', { wait: 400 });
  const fAll = await readUi();
  r.ok('仅标题 / 系统默认 / 全站三档都生效，data-font 与 data-cjk 对得上',
    fTitle.font === 'hanyi-title' && fTitle.cjk === '1' &&
    fSystem.font === 'system' && fSystem.cjk === '1' &&
    fAll.font === 'hanyi' && fAll.cjk === '1',
    { title: [fTitle.font, fTitle.cjk], system: [fSystem.font, fSystem.cjk], all: [fAll.font, fAll.cjk] });

  console.log('\n[6] 背景：纯色 → 自定义图片 → 切回预设');
  await backToRoot();
  await click(page, '[data-testid="set-row-bg"]', { wait: 500 });
  await clickText(page, '.seg button', '纯色', { wait: 500 });
  const pure = await readUi();
  await clickText(page, '.seg button', '自定义图片', { wait: 500 });
  const custom = await readUi();

  let uploaded = false;
  const fileInputs = await page.$$('input[type="file"][accept="image/*"]');
  if (fileInputs.length) {
    await fileInputs[0].uploadFile(pngPath);
    for (let i = 0; i < 35; i++) {
      const s = await readUi();
      if (s.appState && s.appState.image && s.appState.image.length > 100) { uploaded = true; break; }
      await sleep(150);
    }
  }
  let imageLayer = await readLayer();
  for (let i = 0; i < 20 && !(imageLayer.image || '').includes('data:image'); i++) {
    await sleep(150);
    imageLayer = await readLayer();
  }
  r.ok('纯色模式生效；自定义图片空态提示可见，上传后背景真的显示图片',
    pure.mode === 'color' && pure.appState && pure.appState.mode === 'color' &&
    custom.mode === 'image' && custom.appState && custom.appState.mode === 'image' &&
    custom.subBody.includes('尚未选择图片') &&
    uploaded && /data:image/.test(imageLayer.image || ''),
    { pure: pure.mode, custom: custom.mode, emptyHint: custom.subBody.includes('尚未选择图片'), uploaded, layer: String(imageLayer.image || '').slice(0, 90) });

  await clickText(page, '.seg button', '预设渐变', { wait: 700 });
  const preset = await readUi();
  const presetLayer = await readLayer();
  r.ok('切回预设渐变后背景恢复渐变，没有残留破图',
    preset.mode === 'preset' && preset.appState && preset.appState.mode === 'preset' &&
    preset.subBody.includes('预设「奶油」') &&
    !/url\(/.test(presetLayer.image || '') && !/data:image/.test(presetLayer.inlineImage || ''),
    { mode: preset.mode, layer: String(presetLayer.image || '').slice(0, 100), inline: presetLayer.inlineImage });

  console.log('\n[7] 三个滑杆：真实拖动后 CSS 变量跟着变');
  const slider0 = await readSlider();
  const dragTint = await dragSlider('玻璃通透度', 0.82);
  const slider1 = await readSlider();
  r.ok('玻璃通透度拖动后 --glass-tint 与状态都变化',
    dragTint && slider1.vars.tint !== slider0.vars.tint && slider1.tint !== slider0.tint,
    { before: slider0, after: slider1 });

  const dragDim = await dragSlider('背景柔化', 0.82);
  const slider2 = await readSlider();
  r.ok('背景柔化拖动后 --bd-dim 与状态都变化',
    dragDim && slider2.vars.dim !== slider1.vars.dim && slider2.dim !== slider1.dim,
    { before: slider1, after: slider2 });

  const dragGlow = await dragSlider('晕光强度', 0.82);
  const slider3 = await readSlider();
  r.ok('晕光强度拖动后 --glow-strength 与状态都变化',
    dragGlow && slider3.vars.glow !== slider2.vars.glow && slider3.glow !== slider2.glow,
    { before: slider2, after: slider3 });

  console.log('\n[8] 数据与同步：改令牌后仅保存设置');
  await backToRoot();
  await click(page, '[data-testid="set-row-sync-addr"]', { wait: 600 });
  await typeInto(page, '[data-testid="sync-token-input"]', TOKEN, { wait: 150 });
  await clickText(page, 'button', '仅保存设置', { wait: 500 });
  let tokenSaved = false;
  for (let i = 0; i < 25; i++) {
    const v = await state(page, () => ({ token: window.__schedule.cfg.syncToken }));
    if (v.token === TOKEN) { tokenSaved = true; break; }
    await sleep(150);
  }
  r.ok('同步页填入令牌，点「仅保存设置」后 cfg 里已生效', tokenSaved, { token: TOKEN });

  console.log('\n[9] 提醒开关：关掉后回显，再打开');
  await backToRoot();
  await click(page, '[data-testid="set-row-remind"]', { wait: 500 });
  await clickText(page, '.subpage label', '开启提醒', { wait: 500 });
  const off = await state(page, () => {
    try { return JSON.parse(localStorage.getItem('reminderCfg') || '{}'); } catch { return {}; }
  });
  const rootOff = await backToRoot();
  const rowOff = /已关闭/.test(rootOff.rowText['set-row-remind'] || '');
  await click(page, '[data-testid="set-row-remind"]', { wait: 500 });
  await clickText(page, '.subpage label', '开启提醒', { wait: 500 });
  const on = await state(page, () => {
    try { return JSON.parse(localStorage.getItem('reminderCfg') || '{}'); } catch { return {}; }
  });
  r.ok('提醒开关能关能开：关闭后根页显示「已关闭」，再打开落盘为 true',
    off.enabled === false && rowOff && on.enabled === true,
    { off, rowOff, on });

  console.log('\n[10] 语言：四种语言逐个切，日语刷新后保持');
  await backToRoot();
  await click(page, '[data-testid="set-row-lang"]', { wait: 600 });
  const zhHans = await readLang();
  r.ok('默认简体：语言页标题、topbar、data-cjk 都对，四种语言都在',
    zhHans.page === 'lang' && zhHans.title === '语言' && zhHans.topTitle === '设置与同步' &&
    zhHans.lang === 'zh-Hans' && zhHans.dataLang === 'zh-Hans' && zhHans.cjk === '1' && zhHans.langs === 4,
    zhHans);

  const zhHant = await pickLang('zh-Hant');
  r.ok('切到繁體：标题变「語言」，topbar 变「設定與同步」',
    zhHant.lang === 'zh-Hant' && zhHant.dataLang === 'zh-Hant' && zhHant.title === '語言' &&
    zhHant.topTitle === '設定與同步' && zhHant.cjk === '1',
    zhHant);

  const en = await pickLang('en');
  r.ok('切到 English：标题变 Language，data-cjk=0',
    en.lang === 'en' && en.dataLang === 'en' && en.title === 'Language' &&
    en.topTitle === 'Settings' && en.cjk === '0',
    en);

  const jaNow = await pickLang('ja');
  const jaBefore = jaNow.lang === 'ja' && jaNow.dataLang === 'ja' &&
    jaNow.title === '言語' && jaNow.topTitle === '設定と同期' && jaNow.cjk === '0';
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.app', { timeout: 20000 });
  await sleep(1200);
  let jaAfterState = await readLang();
  if (jaAfterState.page !== 'lang') jaAfterState = await ensureLangPage();
  const jaAfter = jaAfterState.lang === 'ja' && jaAfterState.dataLang === 'ja' &&
    jaAfterState.title === '言語' && jaAfterState.cjk === '0';
  r.ok('切到日本語，刷新后仍是日语且标题保持', jaBefore && jaAfter,
    { before: jaNow, after: jaAfterState });

  // 收尾切回简体，后面才能按简体文案核对持久化。
  const backHans = await pickLang('zh-Hans');
  r.note('已切回简体：' + [backHans.lang, backHans.title].join(' / '));
  await backToRoot();
  const saved = await state(page, () => {
    const a = window.__schedule.appearance.get();
    let reminder = {};
    try { reminder = JSON.parse(localStorage.getItem('reminderCfg') || '{}'); } catch { reminder = {}; }
    return {
      lang: document.documentElement.lang,
      dataLang: document.documentElement.getAttribute('data-lang'),
      theme: a.theme, font: a.font, mode: a.mode,
      dim: a.dim, tint: a.tint, glow: a.glow,
      token: window.__schedule.cfg.syncToken,
      reminder: reminder.enabled
    };
  });

  console.log('\n[11] 刷新后所有设置保持');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.app', { timeout: 20000 });
  await sleep(1600);
  const after = await readUi();
  r.ok('刷新后主题 / 字体 / 背景模式 / 三个滑杆数值都保持',
    after.theme === saved.theme && after.font === saved.font && after.mode === saved.mode &&
    after.appState && after.appState.theme === saved.theme &&
    after.appState.font === saved.font && after.appState.mode === saved.mode &&
    after.appState.dim === saved.dim && after.appState.tint === saved.tint && after.appState.glow === saved.glow,
    { saved, after: after.appState && { theme: after.appState.theme, font: after.appState.font, mode: after.appState.mode, dim: after.appState.dim, tint: after.appState.tint, glow: after.appState.glow } });

  r.ok('刷新后语言回简体、同步令牌和提醒开关也都还在',
    after.lang === 'zh-Hans' && after.dataLang === 'zh-Hans' &&
    after.cfg && after.cfg.syncToken === TOKEN && after.reminder.enabled === true,
    { lang: after.lang, token: after.cfg && after.cfg.syncToken, reminder: after.reminder && after.reminder.enabled });

  const realErrors = (errors || []).filter((e) => !/favicon|404|Failed to load resource/i.test(e));
  r.ok('整个流程没有 JS / 控制台报错', realErrors.length === 0, realErrors.slice(0, 3));
} catch (e) {
  console.error(e);
  try { await shot(page, 'human-settings-error'); } catch { /* 截图失败不掩盖原错误 */ }
  r.ok('测试流程完整跑完', false, { error: String((e && e.stack) || e) });
} finally {
  try { stopIsolatedServer(); } catch { /* 已停 */ }
  await r.done(browser);
}
