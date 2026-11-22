// 两台设备「真人操作」同步测试（v1.5.x）
//
// 目的：不复用 page.evaluate 改 store 的捷径，全部通过真实点击/键盘完成：
//   电脑新建待办 → 手机同步看到 → 手机完成 → 电脑同步看到；
//   两端改同一条（LWW 新时间胜 / 同时间 deviceId 大胜）；
//   服务器停掉后顶栏必须说「离线」，不能假同步；
//   同端口重启新库后游标自愈、两端合并；
//   设置页连接体检、一键重连、以电脑为准重新对齐；二级页按返回键能回根页。
//
// 端口：8864（隔离临时库，不污染 8787 生产库）。
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';
import {
  report, launch, openApp, sleep, click, clickText, typeInto, waitText,
  text, state, watchErrors,
} from './e2e.mjs';

const PORT = Number(process.env.HUMAN_SYNC_PORT || 8864);
const TASK_TITLE = '同步测试-买牛奶';
const CONFLICT_PC = '冲突-电脑版';
const CONFLICT_PHONE = '冲突-手机版';
const TIE_TITLE = '平局-deviceId-大者胜';
const OFFLINE_TITLE = '离线-电脑版';

const r = report('真人同步：两台设备');
let browser = null;
let started = false;
let desktopErrors = [];
let phoneErrors = [];

const sleepMs = sleep;
const json = async (url) => (await fetch(url)).json();

async function waitForFn(page, fn, arg, timeout = 10000) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 120 }, arg);
    return true;
  } catch { return false; }
}

async function countTasks(page) {
  return page.$$eval('.task-item', (els) => els.length);
}

async function titles(page) {
  return page.$$eval('.task-item .t-title', (els) => els.map((e) => e.innerText.trim()));
}

async function waitTitle(page, title, timeout = 10000) {
  return waitForFn(page, (t) => [...document.querySelectorAll('.task-item .t-title')]
    .some((e) => e.innerText.trim() === t), title, timeout);
}

async function taskDone(page, title) {
  return page.evaluate((t) => {
    const el = [...document.querySelectorAll('.task-item')]
      .find((e) => (e.innerText || '').includes(t));
    return !!el && el.classList.contains('done');
  }, title);
}

async function waitTaskDone(page, title, timeout = 10000) {
  return waitForFn(page, (t) => {
    const el = [...document.querySelectorAll('.task-item')]
      .find((e) => (e.innerText || '').includes(t));
    return !!el && el.classList.contains('done');
  }, title, timeout);
}

async function pillInfo(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="sync-pill"]');
    return el ? { text: el.innerText.replace(/\s+/g, ' ').trim(), cls: el.className } : null;
  });
}

async function waitPill(page, needle, timeout = 10000) {
  return waitForFn(page, (n) => {
    const el = document.querySelector('[data-testid="sync-pill"]');
    return !!el && (el.innerText || '').includes(n);
  }, needle, timeout);
}

async function syncByPill(page) {
  await click(page, '[data-testid="sync-pill"]', { wait: 1000 });
  await sleepMs(250);
}

async function openSyncSettings(page, mobile) {
  if (mobile) await clickText(page, '.tab', '设置');
  else await clickText(page, '.nav-item', '设置与同步');
  await sleepMs(700);
  await click(page, '[data-testid="set-row-sync-addr"]', { wait: 500 });
  await page.waitForSelector('[data-testid="sync-server-input"]', { timeout: 6000 });
  await sleepMs(450);
}

async function goTasks(page, mobile) {
  if (mobile) await clickText(page, '.tab', '待办');
  else await clickText(page, '.nav-item', '待办事项');
  await sleepMs(700);
}

/** 用 UI 关掉自动同步，避免 1.5 秒自动推送打乱冲突/断网时序。 */
async function disableAutoSync(page) {
  const on = await state(page, () => !!window.__schedule.cfg.autoSync);
  if (on) await clickText(page, 'label', '自动同步', { wait: 650 });
  return state(page, () => !!window.__schedule.cfg.autoSync);
}

/** 打开编辑框、改标题、保存；全部走真实点击/键盘。 */
async function editTitle(page, oldTitle, newTitle, { cancel = false } = {}) {
  await clickText(page, '.t-title', oldTitle, { wait: 450 });
  await page.waitForSelector('.modal input.input', { timeout: 5000 });
  await typeInto(page, '.modal input.input', newTitle);
  if (cancel) await clickText(page, '.modal .btn-ghost', '取消', { wait: 500 });
  else await clickText(page, '.modal .btn-primary', '保存', { wait: 750 });
  await waitForFn(page, () => !document.querySelector('.modal'), null, 5000);
}

async function waitServerDown(timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { await fetch('http://127.0.0.1:' + PORT + '/api/health'); }
    catch { return true; }
    await sleepMs(150);
  }
  return false;
}

async function startServerWithRetry() {
  for (let i = 0; i < 5; i++) {
    try { return await startIsolatedServer(PORT); }
    catch (e) { if (i === 4) throw e; await sleepMs(500); }
  }
}

try {
  let URL = await startIsolatedServer(PORT);
  started = true;
  const h0 = await json(URL + '/api/health');
  const dbId0 = h0.dbId;

  const { browser: b, page: desktop, errors } = await launch();
  browser = b;
  desktopErrors = errors;

  // 手机用独立 BrowserContext：IndexedDB/设备 ID 才会是另一台设备。
  const ctxPhone = await browser.createBrowserContext();
  const phone = await ctxPhone.newPage();
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  phoneErrors = watchErrors(phone);

  await openApp(desktop, URL);
  await openApp(phone, URL, { settle: 2200 });
  r.note('电脑 1400×1000 / 手机 390×844，隔离服务器 ' + URL);

  await goTasks(desktop, false);
  await goTasks(phone, true);
  const [d0, p0] = await Promise.all([countTasks(desktop), countTasks(phone)]);
  r.ok('初始空态：服务器空库、两端都没有待办',
    h0.ok === true && h0.records === 0 && d0 === 0 && p0 === 0,
    { health: h0, desktop: d0, phone: p0 });

  // 两端的自动同步都关掉，后续手动点顶栏，冲突时序才可控。
  await openSyncSettings(desktop, false);
  const dAuto = await disableAutoSync(desktop);
  await openSyncSettings(phone, true);
  const pAuto = await disableAutoSync(phone);
  r.note('自动同步已关闭：电脑=' + dAuto + ' 手机=' + pAuto);
  await goTasks(desktop, false);
  await goTasks(phone, true);

  /* ---------- 1. 电脑新建 → 手机同步看到 ---------- */
  await clickText(desktop, 'button', '新建待办', { wait: 500 });
  await desktop.waitForSelector('.modal input.input', { timeout: 5000 });
  await typeInto(desktop, '.modal input.input', TASK_TITLE);
  await clickText(desktop, '.modal .btn-primary', '创建', { wait: 800 });
  const created = await waitTitle(desktop, TASK_TITLE);
  r.ok('电脑用 UI 新建待办成功', created && (await countTasks(desktop)) === 1, await titles(desktop));

  await syncByPill(desktop);
  const dPill1 = await pillInfo(desktop);
  r.ok('电脑手动同步后顶栏显示已同步', dPill1 && dPill1.text.includes('已同步'), dPill1);

  await syncByPill(phone);
  const phoneSees = await waitTitle(phone, TASK_TITLE);
  r.ok('手机同步后看到电脑新建的待办', phoneSees, await titles(phone));

  /* ---------- 2. 手机完成 → 电脑同步看到完成状态 ---------- */
  await click(phone, '.task-item .check', { wait: 700 });
  const phoneDone = await waitTaskDone(phone, TASK_TITLE);
  r.ok('手机勾选后任务标记为已完成', phoneDone, await titles(phone));

  await syncByPill(phone);
  await syncByPill(desktop);
  const desktopSeesDone = await waitTaskDone(desktop, TASK_TITLE);
  r.ok('手机同步后电脑看到完成状态', desktopSeesDone, await taskDone(desktop, TASK_TITLE));

  /* ---------- 3. 冲突：同一条两端改，LWW 新时间胜 ---------- */
  await editTitle(desktop, TASK_TITLE, '冲突-草稿', { cancel: true });
  const draftTitles = await titles(desktop);
  r.ok('编辑弹窗点取消不会保存草稿', draftTitles.includes(TASK_TITLE) && !draftTitles.includes('冲突-草稿'), draftTitles);

  await editTitle(desktop, TASK_TITLE, CONFLICT_PC);
  const pcSaved = await waitTitle(desktop, CONFLICT_PC);
  r.ok('冲突：电脑版标题已保存', pcSaved, await titles(desktop));

  await sleepMs(180); // 确保手机这次保存的 updatedAt 明确更晚
  await editTitle(phone, TASK_TITLE, CONFLICT_PHONE);
  const phoneSaved = await waitTitle(phone, CONFLICT_PHONE);
  r.ok('冲突：手机版标题已保存', phoneSaved, await titles(phone));

  await syncByPill(desktop); // 电脑旧版本先上服务器
  await syncByPill(phone);   // 手机新版本后上，按 updatedAt 胜出
  await syncByPill(desktop); // 电脑再拉一次
  const pcConflict = await waitTitle(desktop, CONFLICT_PHONE);
  const phoneConflict = await waitTitle(phone, CONFLICT_PHONE);
  r.ok('两端同步后按修改时间取新（手机版）',
    pcConflict && phoneConflict &&
    (await titles(desktop)).includes(CONFLICT_PHONE) &&
    (await titles(phone)).includes(CONFLICT_PHONE),
    { desktop: await titles(desktop), phone: await titles(phone) });

  /* ---------- 3b. 边界：同一 updatedAt，deviceId 大者胜 ---------- */
  const pullAll = await json(URL + '/api/pull?since=0&limit=1000');
  const rec = (pullAll.records || []).find((x) => x.data && x.data.title === CONFLICT_PHONE) || (pullAll.records || [])[0];
  let tieApplied = false;
  let tieInfo = null;
  if (rec) {
    const tieDevice = 'zzz-tie-break-device';
    const tieRes = await fetch(URL + '/api/push', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: tieDevice,
        deviceName: '同时间决胜测试',
        platform: 'test',
        records: [{
          collection: rec.collection,
          id: rec.id,
          data: { ...rec.data, title: TIE_TITLE },
          updatedAt: rec.updatedAt,
          deviceId: tieDevice,
          deleted: false,
        }],
      }),
    });
    tieInfo = await tieRes.json();
    tieApplied = tieInfo && tieInfo.applied === 1;
  }
  r.ok('同一 updatedAt 时 deviceId 大的版本被服务器接受', tieApplied, { rec: rec && { id: rec.id, updatedAt: rec.updatedAt, deviceId: rec.deviceId }, tieInfo });

  await syncByPill(desktop);
  await syncByPill(phone);
  const pcTie = await waitTitle(desktop, TIE_TITLE);
  const phoneTie = await waitTitle(phone, TIE_TITLE);
  r.ok('平局版本同步后两端一致', pcTie && phoneTie, { desktop: await titles(desktop), phone: await titles(phone) });

  /* ---------- 4. 服务器停掉：离线必须是真的 ---------- */
  stopIsolatedServer();
  started = false;
  const down = await waitServerDown();
  r.note('服务器已停止：' + down);

  await editTitle(desktop, TIE_TITLE, OFFLINE_TITLE);
  const offlineSaved = await waitTitle(desktop, OFFLINE_TITLE);
  r.ok('服务器停掉后电脑仍能保存本地改动', offlineSaved, await titles(desktop));

  await syncByPill(desktop);
  const offlineShown = await waitPill(desktop, '离线', 12000);
  const offlinePill = await pillInfo(desktop);
  r.ok('停服后顶栏显示离线且绝不显示已同步',
    offlineShown && offlinePill && offlinePill.text.includes('离线') && !offlinePill.text.includes('已同步'),
    offlinePill);

  const offlineStat = await state(desktop, () => ({
    reachable: window.__schedule.syncStat.reachable,
    state: window.__schedule.syncStat.state,
    lastError: window.__schedule.cfg.lastError,
  }));
  r.ok('停服后 syncStat.reachable 变成 0',
    offlineStat.reachable === 0 && offlineStat.state === 'error',
    offlineStat);

  /* ---------- 5. 同端口重启新库：合并、游标自愈 ---------- */
  URL = await startServerWithRetry();
  started = true;
  const h1 = await json(URL + '/api/health');
  r.ok('同端口重启后是新库（dbId 变了且从 0 条开始）',
    h1.ok === true && h1.dbId !== dbId0 && h1.records === 0,
    { oldDb: dbId0, newDb: h1.dbId, records: h1.records });

  await syncByPill(desktop);
  const ds1 = await state(desktop, () => ({
    healed: window.__schedule.syncStat.healed,
    localRecords: window.__schedule.syncStat.localRecords,
    serverRecords: window.__schedule.syncStat.serverRecords,
  }));
  const pcAfterRestart = await waitTitle(desktop, OFFLINE_TITLE);
  r.ok('电脑重启后游标自愈且数据还在',
    ds1.healed === 1 && ds1.localRecords === 1 && ds1.serverRecords === 1 && pcAfterRestart,
    { stat: ds1, titles: await titles(desktop) });

  await syncByPill(phone);
  const ps1 = await state(phone, () => ({
    healed: window.__schedule.syncStat.healed,
    localRecords: window.__schedule.syncStat.localRecords,
    serverRecords: window.__schedule.syncStat.serverRecords,
  }));
  const phoneAfterRestart = await waitTitle(phone, OFFLINE_TITLE);
  r.ok('手机重启后游标自愈并拉到电脑版本',
    ps1.healed === 1 && phoneAfterRestart && ps1.localRecords === 1 && ps1.serverRecords === 1,
    { stat: ps1, titles: await titles(phone) });

  await syncByPill(desktop);
  const [finalPc, finalPhone] = [await titles(desktop), await titles(phone)];
  const finalStats = await Promise.all([
    state(desktop, () => ({ local: window.__schedule.syncStat.localRecords, server: window.__schedule.syncStat.serverRecords })),
    state(phone, () => ({ local: window.__schedule.syncStat.localRecords, server: window.__schedule.syncStat.serverRecords })),
  ]);
  r.ok('重启后两端最终一致',
    finalPc.includes(OFFLINE_TITLE) && finalPhone.includes(OFFLINE_TITLE) &&
    finalStats[0].local === 1 && finalStats[0].server === 1 &&
    finalStats[1].local === 1 && finalStats[1].server === 1,
    { desktop: finalPc, phone: finalPhone, stats: finalStats });

  /* ---------- 6. 连接体检 ---------- */
  await openSyncSettings(desktop, false);
  const hasCheck = await desktop.waitForSelector('[data-testid="conn-check"]', { timeout: 6000 }).then(() => true).catch(() => false);
  await sleepMs(900);
  const [cl, cr, same, pending, reachable] = await Promise.all([
    text(desktop, '[data-testid="conn-local"]'),
    text(desktop, '[data-testid="conn-server"]'),
    text(desktop, '[data-testid="conn-same"]'),
    text(desktop, '[data-testid="conn-pending"]'),
    text(desktop, '[data-testid="conn-reachable"]'),
  ]);
  r.ok('连接体检：本机/电脑条数对得上、待上传 0',
    hasCheck && cl === '1 条' && cr === '1 条' && same.includes('对得上') && pending === '0 条',
    { cl, cr, same, pending });

  r.ok('连接体检：显示能连上', reachable.includes('能连上'), reachable);

  const deviceCount = await desktop.$$eval('[data-testid="conn-device"]', (els) => els.length);
  r.ok('连接体检：设备列表至少两台', deviceCount >= 2, deviceCount);

  await click(desktop, '[data-testid="conn-repair"]', { wait: 1000 });
  const repairShown = await desktop.waitForSelector('[data-testid="conn-msg"]', { timeout: 6000 }).then(() => true).catch(() => false);
  const repairMsg = repairShown ? await text(desktop, '[data-testid="conn-msg"]') : '';
  r.ok('一键重连有反馈且不报错',
    repairShown && repairMsg.length > 0 && !/失败|连不上/.test(repairMsg),
    repairMsg);

  await click(desktop, '[data-testid="conn-realign"]', { wait: 450 });
  const modalShown = await desktop.waitForSelector('.modal', { timeout: 5000 }).then(() => true).catch(() => false);
  const modalText = modalShown ? await text(desktop, '.modal') : '';
  r.ok('以电脑为准重新对齐会先弹二次确认',
    modalShown && modalText.includes('以电脑为准重新对齐') && modalText.includes('开始对齐'),
    modalText.slice(0, 160));

  await clickText(desktop, '.modal button', '开始对齐', { wait: 1200 });
  const realignMsg = await text(desktop, '[data-testid="conn-msg"]');
  r.ok('确认对齐后有覆盖/拉回反馈且不报错',
    realignMsg.length > 0 && realignMsg !== repairMsg &&
    /覆盖|拉回/.test(realignMsg) && !/失败|连不上/.test(realignMsg),
    realignMsg);

  /* ---------- 7. 返回键：同步二级页回设置根页，再进得去 ---------- */
  // 浏览器里没有安卓返回键，按项目约定用同一套 back.press() 走真实 backNav 逻辑。
  const backPressed = await desktop.evaluate(() => window.__schedule.back.press());
  await sleepMs(500);
  const backToRoot = !!(await desktop.$('[data-testid="set-row-sync-addr"]')) &&
    !(await desktop.$('[data-testid="conn-check"]'));
  r.ok('同步二级页按返回键回到设置根页',
    backPressed === true && backToRoot,
    { backPressed, backToRoot });

  await click(desktop, '[data-testid="set-row-sync-addr"]', { wait: 500 });
  const reentered = await desktop.waitForSelector('[data-testid="conn-check"]', { timeout: 6000 })
    .then(() => true).catch(() => false);
  r.ok('返回根页后还能再次进入同步二级页', reentered, { reentered });

  /* ---------- 8. 无 console 报错 ---------- */
  r.ok('两端都没有 console 报错',
    desktopErrors.length === 0 && phoneErrors.length === 0,
    { desktop: desktopErrors, phone: phoneErrors });
} catch (e) {
  console.error(e && e.stack ? e.stack : e);
  r.ok('测试过程完整跑完，没有抛异常', false, String(e && e.message ? e.message : e));
} finally {
  if (started) stopIsolatedServer();
  if (browser) { try { await browser.close(); } catch { /* 已关闭 */ } }
}

await r.done(browser);
