// v1.5.1「假同步」修复的浏览器端验证 + 连接体检面板
//
// 用户原话：「电脑和手机会出现假同步的问题，电脑端显示同步但是实际并未同步」。
// 根因不是数据没同步，而是顶栏只看 state==='ok' 就说「已同步」——电脑端连的是
// 自己这台服务器，永远 ok。这个测试专门盯这件事：
//   连不上 → 必须说「离线」，不许说「已同步」
//   两边条数不一样 → 必须说出来
//   别的设备落后 → 必须说出来
//   真的同步上了 → 才可以说「已同步」
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.HONEST_TEST_PORT || 8871);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};

const URL0 = await startIsolatedServer(PORT);

/** 直接以另一台设备（手机）的身份往服务器写一条，模拟"手机有的电脑没有" */
const pushAs = async (deviceId, collection, id, data) => {
  const r = await fetch(URL0 + '/api/push', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId, deviceName: deviceId, platform: 'test',
      records: [{ collection, id, data, updatedAt: Date.now() + 500, deviceId, deleted: false }]
    })
  });
  return r.json();
};
const pullAs = async (deviceId, since, limit) => {
  const q = new URLSearchParams({ since: String(since), limit: String(limit), deviceId, name: deviceId, platform: 'test' });
  return (await fetch(URL0 + '/api/pull?' + q.toString())).json();
};

let browser = null;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e)));
  // 第 3 步会故意把地址指到一个关掉的端口，浏览器必然打印一条资源加载失败，
  // 那不是 bug；真正的 JS 异常记在 pageerror 里，保持严格。
  const noise = /Failed to load resource|net::ERR_|ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED/i;
  page.on('console', (m) => { if (m.type() === 'error' && !noise.test(m.text())) errors.push(m.text()); });

  await page.goto(URL0, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.app', { timeout: 20000 });
  await sleep(1500);

  const hasHook = await page.evaluate(() => typeof (window.__schedule || {}).syncVerdict === 'function');
  ok('调试钩子暴露了 syncVerdict（顶栏和设置页共用一个判断）', hasHook);

  const verdict = () => page.evaluate(() => window.__schedule.syncVerdict());
  const pillDom = () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="sync-pill"]');
    return el ? { text: el.innerText.trim(), cls: el.className, hasDot: !!el.querySelector('.dot') } : null;
  });

  /* 1. 有改动还没上传 → 「待上传 N 条」 */
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((d) => window.__schedule.putRecord('tasks', 'honest-1', { title: '体检用', date: d }), today);
  await sleep(300);
  const v1 = await verdict();
  ok('有待上传时说「待上传 1 条」', v1.kind === 'pending' && v1.text.includes('待上传'), v1);

  /* 2. 真同步一次 → 才允许说「已同步」 */
  const s1 = await page.evaluate(() => window.__schedule.syncNow('test'));
  await sleep(500);
  const v2 = await verdict();
  ok('同步调用本身成功', s1.ok === true, s1);
  ok('同步上之后才说「已同步」', v2.kind === 'ok' && v2.text === '已同步', v2);
  const p2 = await pillDom();
  // 已同步状态下顶栏还会带一个时间（已同步 20:44），只比前缀
  ok('顶栏 DOM 和结论一致', p2 && p2.text.startsWith('已同步') && /\bok\b/.test(p2.cls), p2);
  const stat2 = await page.evaluate(() => ({ ...window.__schedule.syncStat }));
  ok('同步后本机条数 = 电脑条数', stat2.localRecords === stat2.serverRecords && stat2.localRecords === 1, stat2);

  /* 3. 连不上电脑 → 必须说「离线 · 已存本地」，不许说「已同步」 */
  await page.evaluate(async () => {
    window.__schedule.cfg.serverUrl = 'http://127.0.0.1:9/';   // 关掉的端口，立刻拒绝
    window.__schedule.cfg.serverUrls = [];                      // 别让地址池拖时间
  });
  const s2 = await page.evaluate(() => window.__schedule.syncNow('test'));
  await sleep(500);
  const v3 = await verdict();
  ok('连不上时同步返回失败', s2.ok === false, s2);
  ok('连不上时结论是 unreachable', v3.kind === 'unreachable', v3);
  ok('连不上时顶栏写「离线 · 已存本地」', v3.text === '离线 · 已存本地', v3.text);
  const p3 = await pillDom();
  ok('连不上时顶栏是红色错误样式', p3 && /\berror\b/.test(p3.cls), p3);
  ok('连不上时顶栏绝不出现「已同步」', p3 && !p3.text.includes('已同步'), p3);

  /* 4. 恢复地址 → 又能说已同步 */
  await page.evaluate(async () => {
    window.__schedule.cfg.serverUrl = '';
    await window.__schedule.syncNow('test');
  });
  await sleep(500);
  const v4 = await verdict();
  ok('地址恢复后回到已同步', v4.kind === 'ok', v4);

  /* 5. 两边条数对不上 → 这是以前被藏起来的那种情况 */
  await pushAs('phone', 'tasks', 'phone-1', { title: '手机加的', date: today });
  await page.evaluate(() => window.__schedule.refreshDevices());
  await sleep(400);
  const stat5 = await page.evaluate(() => ({ ...window.__schedule.syncStat }));
  const v5 = await verdict();
  ok('刷新设备后电脑条数变成 2，本机还是 1', stat5.serverRecords === 2 && stat5.localRecords === 1, stat5);
  ok('两边条数对不上时不再说「已同步」', v5.kind === 'drift' && !v5.text.includes('已同步'), v5);
  ok('对不上时顶栏直接邀请用户点一下', v5.text === '两边条数对不上 · 点我重连', v5.text);
  ok('drift 标记为真（设置页也读同一个判断）', v5.drift === true, v5.drift);

  /* 6. 再同步一次 → 把缺的那条拉回来，结论回到已同步 */
  await page.evaluate(() => window.__schedule.syncNow('test'));
  await sleep(600);
  const stat6 = await page.evaluate(() => ({ ...window.__schedule.syncStat }));
  const v6 = await verdict();
  ok('拉回来之后本机也有 2 条了', stat6.localRecords === 2, stat6);
  ok('修好之后才重新说「已同步」', v6.kind === 'ok' && v6.drift === false, v6);

  /* 7. 别的设备落后 → 顶栏点名 */
  await pullAs('phone', 0, 1);                       // 手机只拉走 1 条 → 落后
  await page.evaluate(() => window.__schedule.refreshDevices());
  await sleep(400);
  const v7 = await verdict();
  ok('别的设备落后时会点名', v7.kind === 'others' && v7.text.includes('台设备没跟上'), v7);

  /* 8. 连接体检面板 */
  await page.evaluate(() => { location.hash = '#settings'; });
  await sleep(800);
  await page.evaluate(() => window.__schedule.ui.openSettingsPage('sync'));
  await page.waitForSelector('[data-testid="conn-check"]', { timeout: 15000 });
  await sleep(600);
  const panel = await page.evaluate(() => {
    const q = (s) => document.querySelector('[data-testid="' + s + '"]');
    const t = (s) => { const el = q(s); return el ? el.innerText.trim() : null; };
    return {
      exists: !!q('conn-check'),
      local: t('conn-local'),
      server: t('conn-server'),
      same: t('conn-same'),
      pending: t('conn-pending'),
      reachable: t('conn-reachable'),
      seq: t('conn-seq'),
      cursor: t('conn-cursor'),
      checked: t('conn-checked'),
      verdictText: t('conn-verdict'),
      cardPill: t('sync-card-pill'),
      canRepair: !!q('conn-repair'),
      canRealign: !!q('conn-realign'),
      devices: document.querySelectorAll('[data-testid="conn-device"]').length
    };
  });
  ok('设置页里有「连接体检」', panel.exists);
  ok('体检列出本机记录数', /2/.test(String(panel.local)), panel.local);
  ok('体检列出电脑记录数', /2/.test(String(panel.server)), panel.server);
  ok('体检说两边对得上', String(panel.same).includes('对得上'), panel.same);
  ok('体检列出待上传', /0/.test(String(panel.pending)), panel.pending);
  ok('体检说能连上电脑', String(panel.reachable).includes('能连上'), panel.reachable);
  ok('体检列出电脑序号与本机游标', Number(panel.seq) >= 2 && Number(panel.cursor) >= 2, panel);
  ok('体检有上次核对时间', !!panel.checked && !String(panel.checked).includes('还没'), panel.checked);
  ok('体检的结论和顶栏同一个判断', String(panel.verdictText) === String(v7.text), { panel: panel.verdictText, pill: v7.text });
  ok('设置页的同步胶囊也不说假话', String(panel.cardPill) !== '同步正常', panel.cardPill);
  ok('体检有两个修复按钮', panel.canRepair && panel.canRealign);
  ok('体检列出至少一台设备（自己）', panel.devices >= 1, panel.devices);

  /* 9. 一键重连能跑通并给出人话结论 */
  await page.click('[data-testid="conn-repair"]');
  await sleep(2500);
  const repairMsg = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="conn-msg"]');
    return el ? el.innerText.trim() : '';
  });
  ok('一键重连有结果说明', !!repairMsg, repairMsg);
  ok('一键重连后顶栏不是错误态', await page.evaluate(() => window.__schedule.syncStat.reachable === 1));

  /* 10. 网络变化看门狗（网页端靠 online 事件） */
  const before = await page.evaluate(() => (window.__schedule.netWatch || {}).events || 0);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await sleep(2200);
  const nw = await page.evaluate(() => ({ ...(window.__schedule.netWatch || {}) }));
  ok('网络一变化就记一次事件', nw.events > before, { before, after: nw.events });
  ok('网络变化后真的重连了一次并留下结论', !!nw.lastMessage && nw.lastAt > 0, nw);
  ok('网页端也装上了看门狗（via=web）', nw.via === 'web' && nw.running === true, nw);

  ok('全程没有 JS 报错', errors.length === 0, errors.slice(0, 4));
} catch (e) {
  fail++;
  console.log('  FAIL  测试本身抛异常：' + (e && e.stack ? e.stack : e));
} finally {
  if (browser) { try { await browser.close(); } catch { /* 已关 */ } }
  stopIsolatedServer();
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
