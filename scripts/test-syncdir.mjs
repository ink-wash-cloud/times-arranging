// 同步方向 + 连接诊断专项（v1.2.4 需求①）
//
// 验的是"手机连不上电脑时用户能不能自己解决"，所以不只调函数，走真实 UI：
//   · 电脑端设置页看得到本机地址、能复制、能选同步方向、能一键互相覆盖（有二次确认）
//   · 只上传 / 只下载 / 双向 三种方向真的按语义工作（用服务器 /api/export 做权威断言）
//   · 手机端（注入 Capacitor 模拟原生）拿不到本机地址时不报错，LAN 扫描失败有人话兜底
//   · 全程没有 console 报错
import puppeteer from 'puppeteer-core';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
};

// HOST=0.0.0.0 贴近真实启动方式（默认监听局域网），这样「这台电脑的地址」能给出推荐项；
// 隔离服务器照旧用 127.0.0.1 访问，临时数据库不碰 data/schedule.db。
const PORT = 8831;
const BASE = process.argv[2] || await startIsolatedServer(PORT, { HOST: '0.0.0.0' });
const BASE_OTHER = 'http://localhost:' + (new URL(BASE)).port;
const serverExport = async () => (await fetch(BASE + '/api/export')).json();
const serverIds = async () => ((await serverExport()).records || []).map((r) => r.id);
const serverTitle = async (id) => {
  const rec = ((await serverExport()).records || []).find((r) => r.id === id);
  return rec && rec.data ? rec.data.title : null;
};
const waitFor = async (fn, timeout = 8000, step = 150) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(step);
  }
  return null;
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
let A, B, N;
const errsA = [], errsB = [], errsN = [];
let reqsN = [];

const textOf = (p, sel) => p.evaluate((sel) => {
  const el = document.querySelector(sel);
  return el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
}, sel);
const bodyText = (p) => p.evaluate(() => (document.querySelector('.content-inner') || document.body).innerText.replace(/\s+/g, ' '));
const toastText = (p) => p.evaluate(() => {
  const w = document.querySelector('.toast-wrap');
  return w ? w.innerText.replace(/\s+/g, ' ').trim() : '';
});
// v1.4.1 设置页变成「根列表 + 二级页」：先照常点底部「设置」进根页，
// 再进「数据与同步」二级页。opts.viaRow = true 时走真实点击（点 .set-row），
// 用来验证用户真的能点进去；其余地方用 uiNav 调试钩子直达，省时间也更稳。
const goSettings = async (p, opts = {}) => {
  await p.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.nav-item'));
    const el = items.find((x) => x.innerText.includes('设置'));
    if (el) el.click();
  });
  await sleep(1100);
  if (opts.viaRow) {
    const sel = '[data-testid="set-row-sync-addr"]';
    await p.waitForSelector(sel, { timeout: 5000 });
    await p.evaluate((sel) => document.querySelector(sel).click(), sel);
  } else {
    await p.evaluate(() => window.__schedule.ui.openSettingsPage('sync'));
  }
  await sleep(450);
};
const setVal = async (p, testid, v) => {
  await p.evaluate((testid, v) => {
    const el = document.querySelector('[data-testid="' + testid + '"]');
    if (!el) throw new Error('找不到输入框: ' + testid);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, testid, v);
  await sleep(200);
};
const clickText = async (p, text, scope) => {
  await p.evaluate((text, scope) => {
    const root = scope ? document.querySelector(scope) : document;
    const btn = Array.from(root.querySelectorAll('button')).find((x) => x.innerText.trim() === text);
    if (!btn) throw new Error('找不到按钮: ' + text);
    btn.click();
  }, text, scope || null);
  await sleep(400);
};
// 用 DOM click 而不是 page.click：page.click 会走 IntersectionObserver 判断可见性，
// 后台标签页（我们同时开着两台设备）不跑渲染，会一直等不到回调。DOM click 没这个问题。
const clickTestId = async (p, id) => {
  const sel = '[data-testid="' + id + '"]';
  await p.waitForSelector(sel, { timeout: 5000 });
  await p.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('找不到元素: ' + sel);
    el.click();
  }, sel);
  await sleep(350);
};
const putTask = async (p, id, title) => {
  await p.evaluate((id, title) => {
    window.__schedule.putRecord('tasks', id, {
      title, category: '学习', status: '未开始', priority: 'P1',
      dueDate: '', dueTime: '', estimateMinutes: 30, repeat: '不重复',
      note: '', createdAt: Date.now()
    });
  }, id, title);
  await sleep(300);
};
const idsOn = (p) => p.evaluate(() => window.__schedule.list('tasks').map((x) => x.id));
const titleOn = (p, id) => p.evaluate((id) => {
  const it = window.__schedule.list('tasks').find((x) => x.id === id);
  return it ? it.title : null;
}, id);
const pendingOn = (p) => p.evaluate(() => window.__schedule.pendingCount());
const syncNowIn = async (p, why) => {
  const r = await p.evaluate((why) => window.__schedule.syncNow(why), why || 'test');
  await sleep(250);
  return r;
};
const dirOn = (p) => p.evaluate(() => window.__schedule.cfg.syncDir);
const modalInfo = (p) => p.evaluate(() => {
  const m = document.querySelector('.modal');
  if (!m) return null;
  return { text: m.innerText.replace(/\s+/g, ' '), danger: !!m.querySelector('.btn-danger') };
});
const mkPage = async (url, opts = {}) => {
  const page = await browser.newPage();
  const errs = opts.errs || [];
  await page.setViewport({ width: 1440, height: 1000 });
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  if (opts.init) await page.evaluateOnNewDocument(opts.init);
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app');
  await sleep(2200);
  await page.evaluate(() => { window.__schedule.cfg.autoSync = false; });
  return page;
};

try {
  A = await mkPage(BASE, { errs: errsA });
  B = await mkPage(BASE_OTHER, { errs: errsB });
  // 第一次走真实路径：设置根页 →「连接地址」行 → 同步二级页
  await goSettings(A, { viaRow: true });
  await goSettings(B);

  /* ===================================================================== */
  console.log('\n[1] 电脑端：设置页直接告诉用户「手机该填这个地址」');

  const api = await (await fetch(BASE + '/api/addresses')).json();
  ok('服务端 /api/addresses 返回成功', api && api.ok === true, api);
  ok('返回 localhost 与 127.0.0.1', Array.isArray(api.localhost) && api.localhost.includes('http://localhost:' + PORT) && api.localhost.includes('http://127.0.0.1:' + PORT), api.localhost);
  ok('每个地址都带 url / 是否可用 / 分类', Array.isArray(api.urls) && api.urls.length >= 1 && api.urls.every((u) => typeof u.url === 'string' && typeof u.available === 'boolean' && typeof u.kind === 'string'), api.urls);
  ok('回环地址被标成 loopback（手机连不上）', api.urls.some((u) => u.kind === 'loopback' && u.available === false), api.urls.map((u) => u.kind));
  ok('监听 0.0.0.0 时给出推荐地址', api.loopbackOnly === false && !!api.primary && api.lanUrls.includes(api.primary), { loopbackOnly: api.loopbackOnly, primary: api.primary });

  await A.waitForSelector('[data-testid="sync-addr-panel"]', { timeout: 5000 });
  const addrPanel = await textOf(A, '[data-testid="sync-addr-panel"]');
  ok('出现「这台电脑的地址」区块', addrPanel.includes('这台电脑的地址'), addrPanel.slice(0, 80));
  ok('页面上有手机要填的局域网地址', addrPanel.includes(api.primary), addrPanel.slice(0, 200));
  ok('页面上也有 localhost（并说明手机连不上）', addrPanel.includes('http://localhost:' + PORT) && /手机填这个连不上/.test(addrPanel), addrPanel.slice(0, 240));
  ok('地址旁有「复制」按钮', (await A.$$eval('[data-testid="sync-addr-panel"] [data-testid^="sync-copy-"]', (els) => els.length)) >= 2);
  ok('首页提示「手机连同一个 Wi-Fi」', /同一个 Wi-Fi/.test(addrPanel));
  ok('推荐地址被标出来', addrPanel.includes('推荐'), addrPanel.slice(0, 160));

  // 复制：优先走 navigator.clipboard；这里替换成桩，验证点下去真的复制了对应地址
  const rowUrl = await A.$eval('[data-testid="sync-addr-0"]', (el) => el.getAttribute('data-url'));
  await A.evaluate(() => {
    window.__copied = '';
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t) => { window.__copied = String(t); return Promise.resolve(); } }
      });
    } catch (e) { window.__copyErr = String(e); }
  });
  await clickTestId(A, 'sync-copy-0');
  const copied = await A.evaluate(() => window.__copied);
  ok('点「复制」把这一行的地址写进剪贴板', copied === rowUrl, { copied, rowUrl });
  ok('复制后有「已复制」反馈', /已复制/.test(await toastText(A)), await toastText(A));

  await clickTestId(A, 'sync-addr-refresh');
  ok('点「刷新」后地址仍在（重新拉取成功）', (await textOf(A, '[data-testid="sync-addr-panel"]')).includes(api.primary));
  ok('电脑端没有报「读不到本机地址」', !/读不到本机地址/.test(await textOf(A, '[data-testid="sync-addr-panel"]')));

  /* ===================================================================== */
  console.log('\n[2] 同步方向：三个选项、点一下立刻生效并持久化');

  const dirPanel = await textOf(A, '[data-testid="sync-dir-panel"]');
  ok('三个方向项都在', ['双向同步', '只上传', '只下载'].every((x) => dirPanel.includes(x)), dirPanel.slice(0, 120));
  ok('默认是「双向同步」（高亮）', await A.$eval('[data-testid="sync-dir-both"]', (el) => el.className.includes('on')));
  ok('默认方向写的是 both', (await dirOn(A)) === 'both', await dirOn(A));

  await clickTestId(A, 'sync-dir-push');
  ok('点「只上传」写进配置', (await dirOn(A)) === 'push', await dirOn(A));
  ok('说明文字跟着变成只上传的语义', /不会覆盖本机/.test(await textOf(A, '[data-testid="sync-dir-desc"]')), await textOf(A, '[data-testid="sync-dir-desc"]'));
  ok('切换方向有 toast 反馈', /同步方向已改为/.test(await toastText(A)), await toastText(A));

  await A.reload({ waitUntil: 'networkidle2' });
  await A.waitForSelector('.app');
  await sleep(2200);
  await A.evaluate(() => { window.__schedule.cfg.autoSync = false; });
  await goSettings(A);
  ok('重开之后方向仍是「只上传」（真的持久化了）', (await dirOn(A)) === 'push', await dirOn(A));
  ok('重开后「只上传」仍是高亮', await A.$eval('[data-testid="sync-dir-push"]', (el) => el.className.includes('on')));

  await clickTestId(A, 'sync-dir-pull');
  ok('点「只下载」写进配置', (await dirOn(A)) === 'pull', await dirOn(A));
  await clickTestId(A, 'sync-dir-both');
  ok('再点回「双向同步」', (await dirOn(A)) === 'both', await dirOn(A));

  /* ===================================================================== */
  console.log('\n[3] 连上服务器：准备两台设备');

  await setVal(A, 'sync-server-input', BASE);
  await clickText(A, '保存并立即同步');
  await sleep(1300);
  ok('A 的服务器地址已保存', (await A.evaluate(() => window.__schedule.cfg.serverUrl)) === BASE, await A.evaluate(() => window.__schedule.cfg.serverUrl));

  await putTask(A, 'a-shared', 'A 的待办');
  const s0 = await syncNowIn(A, 'setup');
  ok('A 首次同步成功', s0.ok === true, s0);
  await syncNowIn(B, 'setup');
  ok('B 拉到 A 的记录', (await idsOn(B)).includes('a-shared'), await idsOn(B));

  /* ===================================================================== */
  console.log('\n[4] 只上传（push）：本机改动上传，对方的新数据不覆盖本机');

  // 先在 B 上造一条 A 还没见过的数据
  await putTask(B, 'b-only', 'B 独有的待办');
  const sb = await syncNowIn(B, 'b-push');
  ok('B 的新记录已到服务器', (await serverIds()).includes('b-only'), await serverIds());
  ok('A 这时本机还没有 B 的记录', !(await idsOn(A)).includes('b-only'));

  await clickTestId(A, 'sync-dir-push');
  await putTask(A, 'a-only', 'A 独有的待办');
  const rPush = await syncNowIn(A, 'push-mode');
  ok('只上传：本机新改动确实上传了', (await serverIds()).includes('a-only'), await serverIds());
  ok('只上传：对方的新数据没有进本机', !(await idsOn(A)).includes('b-only'), await idsOn(A));
  ok('只上传：同步结果是「上传…（只上传）」', rPush.ok && /只上传/.test(rPush.message), rPush.message);
  ok('只上传：本机待上传已清零', (await pendingOn(A)) === 0, await pendingOn(A));

  // 游标在 push 模式里也被推进了：切回双向不会把旧数据一股脑补拉回来
  await clickTestId(A, 'sync-dir-both');
  await syncNowIn(A, 'back-both');
  ok('切回双向也不会把较早的对方数据补拉回来（游标已推进）', !(await idsOn(A)).includes('b-only'), await idsOn(A));

  await syncNowIn(B, 'b-pull');
  ok('B 拿到了 A 上传的记录', (await idsOn(B)).includes('a-only'), await idsOn(B));

  /* ===================================================================== */
  console.log('\n[5] 只下载（pull）：对方数据能进来，本机改动不上传');

  await clickTestId(A, 'sync-dir-pull');
  await putTask(A, 'a-pull-local', '只在本机的改动');
  const rPull = await syncNowIn(A, 'pull-mode');
  ok('只下载：本机新改动没有上传', !(await serverIds()).includes('a-pull-local'), await serverIds());
  ok('只下载：本机改动留在「待上传」里', (await pendingOn(A)) >= 1, await pendingOn(A));
  ok('只下载：结果里标明「只下载」', rPull.ok && /只下载/.test(rPull.message), rPull.message);
  ok('只下载：页面上提示这些改动不会上传', /不会上传/.test(await textOf(A, '[data-testid="sync-dir-panel"]')), await textOf(A, '[data-testid="sync-dir-panel"]'));

  await putTask(B, 'b-while-pull', 'B 在 A 只下载期间新增');
  await syncNowIn(B, 'b-add');
  await syncNowIn(A, 'pull-mode-2');
  ok('只下载：对方的新数据能进来', (await idsOn(A)).includes('b-while-pull'), await idsOn(A));
  ok('只下载：本机改动仍然没上传', !(await serverIds()).includes('a-pull-local'), await serverIds());

  await clickTestId(A, 'sync-dir-both');
  await syncNowIn(A, 'flush');
  ok('切回双向后，积压的本机改动自动补传', (await serverIds()).includes('a-pull-local'), await serverIds());
  ok('补传后待上传清零', (await pendingOn(A)) === 0, await pendingOn(A));

  /* ===================================================================== */
  console.log('\n[6] 一键覆盖：用本机数据覆盖对方（二次确认 / 可取消 / 有反馈）');

  await putTask(A, 'shared-1', 'A 的版本');
  await syncNowIn(A, 'shared-a');
  await syncNowIn(B, 'shared-a-pull');
  ok('两端先有同一份记录', (await titleOn(B, 'shared-1')) === 'A 的版本', await titleOn(B, 'shared-1'));

  await putTask(B, 'shared-1', 'B 后来改的版本');
  await syncNowIn(B, 'shared-b');
  ok('服务器上是 B 较新的版本', (await serverTitle('shared-1')) === 'B 后来改的版本', await serverTitle('shared-1'));
  ok('A 本机仍是旧版本（还没同步）', (await titleOn(A, 'shared-1')) === 'A 的版本', await titleOn(A, 'shared-1'));

  await clickTestId(A, 'sync-force-push');
  const m1 = await modalInfo(A);
  ok('点「用本机数据覆盖对方」先弹二次确认', !!m1, m1);
  ok('确认框写清了覆盖风险', !!m1 && /覆盖/.test(m1.text) && /建议/.test(m1.text), m1 && m1.text);
  ok('确认按钮是危险样式', !!m1 && m1.danger === true, m1);
  await clickText(A, '取消', '.modal-foot');
  ok('点取消后确认框关闭', (await modalInfo(A)) === null);
  ok('取消不会真的覆盖服务器', (await serverTitle('shared-1')) === 'B 后来改的版本', await serverTitle('shared-1'));

  await clickTestId(A, 'sync-force-push');
  await clickText(A, '确定覆盖对方', '.modal-foot');
  const pushed = await waitFor(async () => (await serverTitle('shared-1')) === 'A 的版本');
  ok('确认后用本机数据覆盖了对方', pushed === true, await serverTitle('shared-1'));
  const fmsg = await waitFor(async () => {
    const t = await textOf(A, '[data-testid="sync-force-msg"]');
    return /覆盖/.test(t) ? t : '';
  });
  ok('页面上有覆盖结果反馈', !!fmsg, fmsg);
  ok('覆盖后待上传清零', (await pendingOn(A)) === 0, await pendingOn(A));

  await syncNowIn(B, 'after-force-push');
  ok('对方下次同步就变成以本机为准的版本', (await titleOn(B, 'shared-1')) === 'A 的版本', await titleOn(B, 'shared-1'));

  /* ===================================================================== */
  console.log('\n[7] 一键覆盖：用对方数据覆盖本机');

  await putTask(B, 'shared-1', 'B 最新的版本');
  await syncNowIn(B, 'shared-b2');
  ok('服务器换成 B 最新版本', (await serverTitle('shared-1')) === 'B 最新的版本', await serverTitle('shared-1'));

  await clickTestId(A, 'sync-force-pull');
  const m2 = await modalInfo(A);
  ok('点「用对方数据覆盖本机」也先弹二次确认', !!m2 && /覆盖本机/.test(m2.text), m2 && m2.text);
  ok('说明会盖掉本机没上传的改动', !!m2 && /没上传/.test(m2.text), m2 && m2.text);
  await clickText(A, '确定覆盖本机', '.modal-foot');
  const pulled = await waitFor(async () => (await titleOn(A, 'shared-1')) === 'B 最新的版本');
  ok('确认后用对方数据覆盖了本机', pulled === true, await titleOn(A, 'shared-1'));
  ok('覆盖后待上传清零（不会把旧版本又推回去）', (await pendingOn(A)) === 0, await pendingOn(A));
  ok('一次性覆盖不会改掉用户选的同步方向', (await dirOn(A)) === 'both', await dirOn(A));
  ok('覆盖结果有文字反馈', /覆盖/.test(await textOf(A, '[data-testid="sync-force-msg"]')), await textOf(A, '[data-testid="sync-force-msg"]'));

  /* ===================================================================== */
  console.log('\n[8] 连不上时：给「下一步做什么」，不是只有 Failed to fetch');

  // 直接把内存里的地址指到一个没人监听的端口（不写进配置，测完就恢复）。
  // autoSync 已在内存里关掉，因此 syncNow 不会再去扫局域网，失败会很快返回。
  await A.evaluate(() => { window.__schedule.cfg.serverUrl = 'http://127.0.0.1:8899'; });
  await clickTestId(A, 'sync-now-btn');
  const explain = await waitFor(async () => {
    const t = await textOf(A, '[data-testid="sync-explain"]');
    return /连不上/.test(t) ? t : '';
  }, 12000);
  ok('连不上时出现诊断区块', !!explain, explain);
  ok('诊断第一句说清「连不上哪台/哪来的」', !!explain && /连不上/.test(explain), explain);
  ok('提醒用户看电脑上的时序是不是关着', !!explain && /时序/.test(explain) && /关/.test(explain), explain);
  ok('提醒两个设备要连同一个 Wi-Fi', !!explain && /同一个 Wi-Fi/.test(explain), explain);
  ok('提醒地址会变、可以重新找', !!explain && /IP 会变|自动搜索/.test(explain), explain);
  ok('状态栏的最近错误不再是「无」', (await textOf(A, '[data-testid="sync-status-err"]')) !== '无', await textOf(A, '[data-testid="sync-status-err"]'));

  // 恢复地址，确认诊断会自己消失、重新同步正常
  await A.evaluate((base) => { window.__schedule.cfg.serverUrl = base; }, BASE);
  await clickTestId(A, 'sync-now-btn');
  const restored = await waitFor(async () => {
    const t = await textOf(A, '[data-testid="sync-explain"]');
    return t === '' ? 'gone' : '';
  }, 12000);
  ok('地址恢复后诊断自动消失', restored === 'gone', await textOf(A, '[data-testid="sync-explain"]'));

  /* ===================================================================== */
  console.log('\n[9] 手机端（原生）：拿不到本机地址也不报错，扫描失败有人话兜底');

  // 模拟安卓原生：@capacitor/core 初始化时会把 window.Capacitor 上的
  // isNativePlatform / getPlatform 覆盖掉，所以除了直接给值，还要设
  // CapacitorCustomPlatform —— 这是它认的"自定义平台"，最终 getPlatform() 仍是 android。
  const nativeStub = () => {
    window.CapacitorCustomPlatform = { name: 'android' };
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        LanScan: {
          scan: async () => ({ self: '192.168.99.5', prefix: '192.168.99.', hosts: [] })
        }
      }
    };
  };
  N = await mkPage(BASE, { errs: errsN, init: nativeStub });
  N.on('request', (req) => reqsN.push(req.url()));
  await goSettings(N);
  await N.waitForSelector('[data-testid="sync-addr-panel"]', { timeout: 5000 });
  const nPanel = await textOf(N, '[data-testid="sync-addr-panel"]');
  ok('手机端换成「手机怎么连上电脑」步骤', nPanel.includes('手机怎么连上电脑'), nPanel.slice(0, 100));
  ok('手机端没有去请求本机地址接口', reqsN.filter((u) => u.includes('/api/addresses')).length === 0, reqsN.filter((u) => u.includes('/api/addresses')));
  ok('手机端没有因为拿不到本机地址报错', !/读不到本机地址|正在读取本机地址/.test(nPanel), nPanel.slice(0, 200));
  ok('手机端有「自动搜索电脑」入口', nPanel.includes('自动搜索电脑'), nPanel.slice(0, 200));
  ok('手机端讲清了「关窗口 = 服务停下」', /关掉窗口 = 同步停下|关闭窗口/.test(nPanel), nPanel.slice(0, 260));

  // 让扫描端口跟着服务器走（真实手机上这个值来自已保存的服务器地址）
  await N.evaluate((base) => { window.__schedule.cfg.serverUrl = base; }, BASE);
  await clickTestId(N, 'sync-auto-find');
  const diag1 = await waitFor(async () => {
    const t = await textOf(N, '[data-testid="sync-diag"]');
    return /扫了 254 台/.test(t) ? t : '';
  }, 12000);
  ok('扫不到时给出人话诊断（扫了 254 台…）', !!diag1, diag1);
  ok('诊断里让用户确认「时序是不是关着」', !!diag1 && /关着|关掉窗口|窗口开着/.test(diag1), diag1);
  ok('诊断里提醒「同一个 Wi-Fi」', !!diag1 && /同一个 Wi-Fi/.test(diag1), diag1);
  ok('诊断里给出下一步（再搜/手输地址）', !!diag1 && /再搜|手输|填/.test(diag1), diag1);
  ok('扫描失败后按钮恢复可点', await N.$eval('[data-testid="sync-auto-find"]', (el) => el.disabled === false));

  // 模拟扫到了本机：点一下应该自动填地址并连上
  await N.evaluate((base) => {
    const host = String(base).replace('http://', '').split(':')[0];
    window.Capacitor.Plugins.LanScan.scan = async () => ({ self: host, prefix: host + '.', hosts: [host] });
  }, BASE);
  await clickTestId(N, 'sync-auto-find');
  const diag2 = await waitFor(async () => {
    const t = await textOf(N, '[data-testid="sync-diag"]');
    return /找到电脑/.test(t) ? t : '';
  }, 12000);
  ok('扫到后直接连上并提示找到服务器', !!diag2, diag2);
  ok('扫描结果自动填进服务器地址', (await N.evaluate(() => window.__schedule.cfg.serverUrl)) === BASE, await N.evaluate(() => window.__schedule.cfg.serverUrl));
  ok('扫描成功后仍有扫描入口（可再搜）', (await N.$('[data-testid="sync-auto-find"]')) !== null);

  /* ===================================================================== */
  console.log('\n[10] 搬进二级页的备份/恢复/示例数据/重置仍然可用，文案没变');

  const syncPage = await bodyText(A);
  ok('「备份与恢复」区块还在', /备份与恢复/.test(syncPage));
  ok('导出/恢复/导入三个入口文案没变',
    syncPage.includes('导出本机备份（JSON）') && syncPage.includes('从服务器恢复全量') && syncPage.includes('导入备份文件'));
  ok('示例数据与重置区块还在', /示例数据与重置/.test(syncPage) && syncPage.includes('载入示例数据') && syncPage.includes('清空全部数据'));

  // 导出：拦截 a.click 与 createObjectURL，避免 headless 真下载，但验证点击确实走到了浏览器下载
  await A.evaluate(() => {
    window.__exportClick = 0;
    window.__origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.__exportClick++; };
    window.__origCreateObjectURL = URL.createObjectURL;
    window.__origRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:stub';
    URL.revokeObjectURL = () => {};
  });
  await clickText(A, '导出本机备份（JSON）');
  const exported = await waitFor(async () => (await A.evaluate(() => window.__exportClick)) > 0, 3000);
  ok('导出本机备份仍然会生成并下载 JSON', exported === true, await A.evaluate(() => window.__exportClick));
  ok('导出后有「备份文件已下载」反馈', /备份文件已下载/.test(await toastText(A)), await toastText(A));
  await A.evaluate(() => {
    HTMLAnchorElement.prototype.click = window.__origAnchorClick;
    URL.createObjectURL = window.__origCreateObjectURL;
    URL.revokeObjectURL = window.__origRevokeObjectURL;
  });

  // 从服务器恢复全量：先二次确认，取消不改变任何数据
  await clickText(A, '从服务器恢复全量');
  const restoreModal = await waitFor(async () => modalInfo(A), 3000);
  ok('从服务器恢复全量仍会先二次确认', !!restoreModal && /重置本地增量游标/.test(restoreModal.text), restoreModal);
  await clickText(A, '取消', '.modal-foot');
  ok('取消恢复后确认框关闭', (await modalInfo(A)) === null);
  ok('取消恢复不会清空本机数据', (await idsOn(A)).length > 0, (await idsOn(A)).length);

  // 示例数据
  const beforeDemo = (await idsOn(A)).length;
  await clickText(A, '载入示例数据');
  const demoOk = await waitFor(async () => /示例数据已载入/.test(await toastText(A)), 3000);
  const afterDemo = (await idsOn(A)).length;
  ok('载入示例数据仍有成功提示', demoOk === true, await toastText(A));
  ok('载入示例数据真的写入了待办', afterDemo > beforeDemo, { beforeDemo, afterDemo });

  // 清空全部数据：危险确认 + 备份提醒；先取消验证可撤销，再确认验证真的清空
  await clickText(A, '清空全部数据');
  const clearModal = await waitFor(async () => modalInfo(A), 3000);
  ok('清空全部数据仍是危险确认', !!clearModal && clearModal.danger === true, clearModal);
  ok('清空确认里提醒先导出备份', !!clearModal && /建议先导出备份/.test(clearModal.text), clearModal && clearModal.text);
  await clickText(A, '取消', '.modal-foot');
  ok('取消清空后数据还在', (await idsOn(A)).length === afterDemo, (await idsOn(A)).length);

  await clickText(A, '清空全部数据');
  await waitFor(async () => modalInfo(A), 3000);
  await clickText(A, '全部清空', '.modal-foot');
  const cleared = await waitFor(async () => (await idsOn(A)).length === 0, 5000);
  ok('确认后真的清空了本机数据', cleared === true, (await idsOn(A)).length);
  ok('清空后有反馈', /已清空/.test(await toastText(A)), await toastText(A));

  /* ===================================================================== */
  console.log('\n[11] 无 console 报错');

  // 上面故意连了一个没人监听的端口，浏览器必然会在 console 留一条网络错误日志；
  // 那是"故意断网"的证据，不是代码报错。其余一条都不允许。
  const errsAReal = errsA.filter((e) => !/ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|Failed to load resource|Failed to fetch/i.test(e));
  ok('电脑端设置页没有 console 报错（故意断网那次的网络日志除外）', errsAReal.length === 0, errsAReal.slice(0, 5));
  ok('第二台设备页面没有 console 报错', errsB.length === 0, errsB.slice(0, 5));
  const nReal = errsN.filter((e) => !/capacitor|LocalNotifications|plugin/i.test(e));
  ok('手机端页面没有未捕获异常（Capacitor 桩自身的提示不算）', nReal.length === 0, nReal.slice(0, 5));
} catch (e) {
  fail++;
  console.log('  FAIL  测试执行异常: ' + String((e && e.stack) || e));
} finally {
  try { await browser.close(); } catch { /* 忽略 */ }
  stopIsolatedServer();
}

console.log('\n通过 ' + pass + ' / ' + (pass + fail));
process.exit(fail ? 1 : 0);
