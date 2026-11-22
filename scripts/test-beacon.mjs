// v1.5.1「自动发现 + 假同步」的服务端端到端验证
//
// 覆盖三件事：
//   1. UDP 信标：手机往 8799 发一个包，电脑要回自己的地址；回包里别带 announce=1
//      不然两台电脑会互相刷屏。
//   2. 游标回卷：客户端游标比服务器末尾还大（换电脑/重装/清库）时，服务端必须
//      把 rewound 标出来并把 cursor 压回真实末尾 —— 这是"两边都显示已同步、
//      实际各存各的"那个假同步的根子。
//   3. 设备体检：/api/devices 要能说清每台设备上次拉到第几条、落后多少、
//      有没有游标跑到服务器前面。
import { createSocket } from 'node:dgram';
import { startIsolatedServer, stopIsolatedServer } from './isoserver.mjs';

const PORT = Number(process.env.BEACON_TEST_PORT || 8830);
const BEACON = Number(process.env.BEACON_TEST_UDP || 18830);

let BASE = '';
let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); }
};
const get = async (p) => (await fetch(BASE + p)).json();
/* 时间戳必须是单调递增的：以前用 Date.now() + 随机毫秒，两个请求撞进同一毫秒时
   LWW 会按 deviceId 决胜，墓碑那几条断言就随机翻车（并行跑 CPU 一忙必现）。 */
let recTs = Date.now();
const rec = (id, v, extra = {}) => ({ collection: 'tasks', id, data: { title: v }, updatedAt: ++recTs, deviceId: 'devA', ...extra });
const push = (deviceId, records) => fetch(BASE + '/api/push', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ deviceId, deviceName: deviceId, platform: 'test', records })
}).then((r) => r.json());
// 注意：URLSearchParams 会把重复的 limit 都带上，服务端只读第一个 —— 要覆盖
// 默认值必须构造一份新参数表，不能像以前那样往后面再拼一个 &limit=1。
const pull = (deviceId, since, over = {}) => {
  const q = new URLSearchParams({
    since: String(since), limit: '1000', deviceId, name: deviceId, platform: 'test', ...over
  });
  return get('/api/pull?' + q.toString());
};

/** 往信标端口发一个包，等回包（或等到超时 = 没有回包） */
function udpAsk(payload, waitMs = 900) {
  return new Promise((resolve) => {
    const sock = createSocket({ type: 'udp4' });
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { sock.close(); } catch { /* 关掉了 */ } resolve(v); };
    sock.on('message', (msg) => {
      const s = msg.toString('utf8');
      try { finish(JSON.parse(s)); } catch { finish({ raw: s }); }
    });
    sock.on('error', () => finish(null));
    sock.bind(0, () => {
      try { sock.send(Buffer.from(payload, 'utf8'), BEACON, '127.0.0.1'); } catch { finish(null); }
    });
    setTimeout(() => finish(null), waitMs);
  });
}

async function main() {
  BASE = await startIsolatedServer(PORT, { SHIXU_BEACON_PORT: String(BEACON), SHIXU_BEACON: '1' });
  await new Promise((r) => setTimeout(r, 400));   // 等信标端口绑定

  /* ------------------------------ 1. 健康与标识 ------------------------------ */
  const h1 = await get('/api/health');
  ok('健康检查返回 ok', h1.ok === true, h1);
  ok('健康检查带 dbId（换库能被发现）', typeof h1.dbId === 'string' && h1.dbId.length >= 8, h1.dbId);
  ok('健康检查报出信标端口', Number(h1.beacon) === BEACON, h1.beacon);
  const h2 = await get('/api/health');
  ok('dbId 两次一致（同一个库）', h2.dbId === h1.dbId, { a: h1.dbId, b: h2.dbId });

  /* ------------------------------ 2. 推送与拉取 ------------------------------ */
  const p1 = await push('devA', [rec('t1', 'A1'), rec('t2', 'A2'), rec('t3', 'A3')]);
  ok('推送 3 条全部写入', p1.ok === true && p1.applied === 3, p1);
  ok('推送回包带 serverSeq/dbId', typeof p1.serverSeq === 'number' && p1.dbId === h1.dbId, p1);

  const r1 = await pull('devA', 0);
  ok('从 0 拉取能拿到 3 条', r1.records.length === 3, r1.records.length);
  ok('拉取回包带 serverSeq', typeof r1.serverSeq === 'number' && r1.serverSeq > 0, r1.serverSeq);
  ok('拉取回包带 recordsCount', r1.recordsCount === 3, r1.recordsCount);
  ok('正常拉取不会被标成 rewound', r1.rewound === false, r1.rewound);
  ok('cursor 等于最后一条的 seq', r1.cursor === r1.records[r1.records.length - 1].seq, { cursor: r1.cursor, last: r1.records.length ? r1.records[r1.records.length - 1].seq : null });

  /* -------------------------- 3. 游标回卷（假同步根因） -------------------------- */
  const big = 999999;
  const r2 = await pull('devA', big);
  ok('游标超过服务器末尾时标出 rewound', r2.rewound === true, r2.rewound);
  ok('rewound 时 cursor 压回服务器真实末尾', r2.cursor === r2.serverSeq && r2.cursor !== big, { cursor: r2.cursor, serverSeq: r2.serverSeq });
  ok('rewound 时仍然不返回记录（要客户端自己从头拉）', r2.records.length === 0, r2.records.length);

  /* ------------------------------ 4. 设备体检 ------------------------------ */
  const d1 = await get('/api/devices');
  ok('设备体检返回 ok', d1.ok === true, d1);
  ok('设备体检带 dbId / serverSeq', d1.dbId === h1.dbId && typeof d1.serverSeq === 'number', { dbId: d1.dbId, serverSeq: d1.serverSeq });
  ok('设备体检统计活记录 3 条', d1.records === 3, d1.records);
  ok('设备体检统计墓碑 0 条', d1.tombstones === 0, d1.tombstones);
  const devA = (d1.devices || []).find((d) => d.id === 'devA');
  ok('devA 已登记在设备表', !!devA, d1.devices);
  if (devA) {
    ok('devA 的 last_since 记录的是它问的游标', Number(devA.last_since) === big, devA.last_since);
    ok('devA 被标成 ahead（游标跑到服务器前面）', devA.ahead === true, devA.ahead);
    ok('ahead 的 devA 显示在线（120 秒内）', devA.online === true, devA.online);
  }

  // 另一台设备只拉 1 条 → 它必然落后
  await pull('devB', 0, { limit: '1' });
  const d2 = await get('/api/devices');
  const devB = (d2.devices || []).find((d) => d.id === 'devB');
  ok('devB 已登记', !!devB, d2.devices);
  if (devB) {
    ok('devB 的 last_given 只到第 1 条', Number(devB.last_given) === 1, devB.last_given);
    ok('devB 被算出落后多少条', devB.behindBy === d2.serverSeq - 1, { behindBy: devB.behindBy, serverSeq: d2.serverSeq });
    ok('落后的 devB 不算 ahead', devB.ahead === false, devB.ahead);
  }

  // 删一条 → 墓碑要算进 tombstones，活记录少一条
  await push('devA', [rec('t1', 'A1', { deleted: true })]);
  const d3 = await get('/api/devices');
  ok('墓碑后活记录变 2 条', d3.records === 2, d3.records);
  ok('墓碑后 tombstones 变 1 条', d3.tombstones === 1, d3.tombstones);

  /* ------------------------------ 5. UDP 信标 ------------------------------ */
  const ans = await udpAsk('who-is-there');
  ok('发一个查询包能收到回包', !!ans && typeof ans === 'object', ans);
  if (ans && typeof ans === 'object') {
    ok('回包带 shixu 标记（别的软件不会回）', ans.shixu === 1, ans.shixu);
    ok('回包带 HTTP 端口（不是 UDP 端口）', Number(ans.port) === PORT, { port: ans.port, http: PORT });
    ok('回包带 dbId', ans.dbId === h1.dbId, ans.dbId);
    ok('回包带可直连的地址列表', Array.isArray(ans.urls) && ans.urls.length > 0, ans.urls);
    ok('回包地址里有 loopback（本机测试场景）', JSON.stringify(ans.urls).includes('127.0.0.1'), ans.urls);
    ok('回包带当前游标 seq', typeof ans.seq === 'number', ans.seq);
    ok('查询的回包 announce 必须是 0', ans.announce === 0, ans.announce);
  }
  const shout = await udpAsk(JSON.stringify({ announce: 1 }));
  ok('别人喊 announce 不回包（防止两台电脑互相刷屏）', shout === null, shout);
}

try {
  await main();
} catch (e) {
  fail++;
  console.log('  FAIL  测试本身抛异常：' + (e && e.stack ? e.stack : e));
} finally {
  stopIsolatedServer();
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
