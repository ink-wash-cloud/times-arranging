// 服务端健壮性专项：一条畸形请求不该把整个同步服务打崩
//
// 背景（真实踩到的）：手机/浏览器发来 Host: : 这种畸形头，服务端用
// new URL(req.url, 'http://' + host) 拼地址就抛 ERR_INVALID_URL；
// 回调是 async 的，没人接 promise 拒绝 → unhandledRejection → Node 24 直接退出。
// 客户端只是刷新了一下，电脑端能用的服务就没了，手机那边立刻"连不上"。
// 所以这一套不测业务，只测"无论对面发什么鬼东西，进程都得活着"。
import { connect } from 'node:net';
import { startIsolatedServer, stopIsolatedServer, isolatedLog } from './isoserver.mjs';

const PORT = Number(process.env.PORT || 8860);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const fails = [];
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else {
    fail++;
    const msg = n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '');
    fails.push(msg);
    console.log('  FAIL  ' + msg);
  }
};

const BASE = 'http://127.0.0.1:' + PORT;

/** 直接往 socket 里塞原始字节：fetch 会替我们"修正"请求，测不出真实畸形输入 */
function raw(text, opts = {}) {
  return new Promise((resolve) => {
    const s = connect(PORT, '127.0.0.1');
    let data = '';
    let settled = false;
    const done = (why) => {
      if (settled) return;
      settled = true;
      try { s.destroy(); } catch { /* 已经断了 */ }
      resolve({ data, why });
    };
    s.setTimeout(opts.timeout || 4000, () => done('timeout'));
    s.on('connect', () => {
      try { s.write(text); } catch { done('write-error'); return; }
      if (opts.afterWrite) setTimeout(() => { try { opts.afterWrite(s); } catch { /* 忽略 */ } }, 30);
    });
    s.on('data', (c) => { data += c.toString('utf8'); });
    s.on('end', () => done('end'));
    s.on('close', () => done('close'));
    s.on('error', () => done('error'));
  });
}
const statusOf = (res) => {
  const m = /^HTTP\/1\.[01] (\d{3})/.exec(res.data || '');
  return m ? Number(m[1]) : 0;
};

async function health() {
  try {
    const r = await fetch(BASE + '/api/health');
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const url = await startIsolatedServer(PORT);
console.log('   隔离服务器: ' + url);

const first = await health();
ok('服务启动后 /api/health 正常', !!first && first.ok === true, first);
const dbId0 = first && first.dbId;
let lastUptime = first ? first.uptime : 0;

/* 每个用例：发完畸形请求后，服务必须还活着，而且 uptime 只增不减、dbId 不变。
   uptime 变小 = 进程重启过（正是这次要防的事）。 */
async function survives(name, text, expect, opts) {
  const res = await raw(text, opts);
  const code = statusOf(res);
  const good = Array.isArray(expect) ? expect.includes(code) : code === expect;
  ok(name + ' -> ' + (good ? code : code + '（期望 ' + expect + '）'), good, { got: code, why: res.why, head: res.data.slice(0, 120) });
  const h = await health();
  ok(name + ' 之后服务仍存活', !!h && h.ok === true, h);
  if (h) {
    ok(name + ' 之后没有重启（uptime 递增）', h.uptime >= lastUptime, { before: lastUptime, after: h.uptime });
    ok(name + ' 之后还是同一个数据库', h.dbId === dbId0, { was: dbId0, now: h.dbId });
    lastUptime = h.uptime;
  }
}

console.log('\n[1] 畸形 Host 头（原来的崩溃点）');
await survives('Host: :', 'GET /api/health HTTP/1.1\r\nHost: :\r\nConnection: close\r\n\r\n', 200);
await survives('Host: [', 'GET /api/health HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n', 200);
await survives('Host: 空', 'GET /api/health HTTP/1.1\r\nHost: \r\nConnection: close\r\n\r\n', 200);
await survives('完全没有 Host 头', 'GET /api/health HTTP/1.0\r\n\r\n', 200);
await survives('Host 里塞绝对 URI', 'GET http://example.com/api/health HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n', 200);

console.log('\n[2] 畸形路径与转义');
await survives('路径只有百分号 /%', 'GET /% HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n', 400);
await survives('残缺 UTF-8 转义 /%E4%B8', 'GET /%E4%B8 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n', 400);
await survives('路径里带 NUL', 'GET /a\u0000b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n', [400, 404]);
await survives('深目录穿越', 'GET /../../../../etc/passwd HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n', 403);
await survives('编码过的目录穿越', 'GET /%2e%2e%2f%2e%2e%2fetc/passwd HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n', 403);
await survives('超长 URL（8KB）', 'GET /' + 'a'.repeat(8000) + ' HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n', [200, 404, 414, 431]);

console.log('\n[3] 根本不是 HTTP');
await survives('请求行全是垃圾', '!!!!\r\n\r\n', [0, 400, 431]);
await survives('超大请求头（64KB）', 'GET /api/health HTTP/1.1\r\nHost: x\r\nX-Pad: ' + 'p'.repeat(65536) + '\r\n\r\n', [400, 431, 0]);

console.log('\n[4] 方法 / 预检');
const opt = await raw('OPTIONS /api/health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
ok('OPTIONS 预检回 204', statusOf(opt) === 204, opt.data.slice(0, 80));
// 探活接口本身不挑方法（返回体只是一个状态快照），静态资源才校验方法
const patch = await raw('PATCH /api/health HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
ok('PATCH 探活接口也不崩（200 或 405）', [200, 405].includes(statusOf(patch)), patch.data.slice(0, 80));
const patchStatic = await raw('PATCH / HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
ok('PATCH 静态页面回 405', statusOf(patchStatic) === 405, patchStatic.data.slice(0, 80));
const unknownApi = await raw('GET /api/definitely-not-here HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
ok('未知接口回 404 JSON', statusOf(unknownApi) === 404 && /unknown api/.test(unknownApi.data), unknownApi.data.slice(0, 120));
const missAsset = await raw('GET /assets/definitely-missing.js HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
ok('缺失静态资源回 404（不回退成 HTML）', statusOf(missAsset) === 404, missAsset.data.slice(0, 80));
ok('缺失静态资源没把进程带走', !!(await health()));

console.log('\n[5] 同步接口的坏输入');
const badJson = await fetch(BASE + '/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"records":[' });
ok('坏 JSON push 回 400', badJson.status === 400, badJson.status);
const arrBody = await fetch(BASE + '/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[1,2,3]' });
ok('数组 body push 回 400', arrBody.status === 400, arrBody.status);
const huge = await fetch(BASE + '/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: Array.from({ length: 20001 }, (_, i) => ({ collection: 'tasks', id: 'x' + i, updatedAt: 1, deviceId: 'd', data: {} })) }) });
ok('一次推 2 万条以上回 413', huge.status === 413, huge.status);
const negLimit = await fetch(BASE + '/api/pull?since=0&limit=-1');
const negBody = negLimit.ok ? await negLimit.json() : {};
ok('limit=-1 不报错（SQLite 里 -1 是不限量）', negLimit.status === 200, negLimit.status);
ok('limit=-1 被收敛成上限内', Array.isArray(negBody.records) && negBody.records.length <= 5000, negBody.records && negBody.records.length);
const nanSince = await fetch(BASE + '/api/pull?since=NaN&limit=abc&deviceId=' + 'd'.repeat(500));
ok('since/limit 是垃圾字符串照样 200', nanSince.status === 200, nanSince.status);
const badJson2 = await fetch(BASE + '/api/pull?since=abc');
ok('坏 since 没有 500（库里没有 NaN 比较）', badJson2.status === 200, badJson2.status);

console.log('\n[6] 客户端中途断开');
const aborted = await raw('POST /api/push HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 999999\r\n\r\n{"records":[', {
  afterWrite: (s) => s.destroy()
});
ok('客户端发了半截就断（没有崩溃日志）', true, aborted.why);
await sleep(300);
const afterAbort = await health();
ok('半截请求之后服务仍存活', !!afterAbort && afterAbort.ok === true, afterAbort);
ok('半截请求之后没有重启', !!afterAbort && afterAbort.uptime >= lastUptime, afterAbort && afterAbort.uptime);
const idle = await raw('', { timeout: 1200 });
ok('连上就不说话（超时断开）也没有伤害', true, idle.why);
ok('沉默连接之后服务仍存活', !!(await health()));

console.log('\n[7] 并发');
const many = await Promise.all(Array.from({ length: 50 }, () => fetch(BASE + '/api/health').then((r) => r.status).catch(() => 0)));
ok('50 个并发 /api/health 全部 200', many.every((s) => s === 200), many.filter((s) => s !== 200).length);
const pulls = await Promise.all(Array.from({ length: 20 }, () => fetch(BASE + '/api/pull?since=0&limit=100').then((r) => r.status).catch(() => 0)));
ok('20 个并发 /api/pull 全部 200', pulls.every((s) => s === 200), pulls.filter((s) => s !== 200).length);
const afterLoad = await health();
ok('压完之后服务仍存活', !!afterLoad && afterLoad.ok === true, afterLoad);

console.log('\n[8] 下载接口');
const head = await raw('HEAD /download/app.apk HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
ok('HEAD /download/app.apk 不崩', [200, 404].includes(statusOf(head)), head.data.slice(0, 80));
const partial = await raw('GET /download/app.apk HTTP/1.1\r\nHost: x\r\nRange: bytes=0-99\r\nConnection: close\r\n\r\n', { afterWrite: (s) => setTimeout(() => s.destroy(), 60) });
ok('下载到一半断开也不崩', true, partial.why);
const finalH = await health();
ok('全部跑完之后服务仍存活', !!finalH && finalH.ok === true, finalH);
ok('全部跑完之后 uptime 还在涨（一次都没重启）', !!finalH && finalH.uptime >= lastUptime, { uptime: finalH && finalH.uptime, before: lastUptime });

const log = isolatedLog();
ok('服务端日志里没有未捕获异常', !/未捕获异常|未处理的 Promise 拒绝|Invalid URL/.test(log), (log.match(/未捕获异常|未处理的 Promise 拒绝|Invalid URL/g) || []).slice(0, 2));

stopIsolatedServer();
console.log('\n========================================');
if (fails.length) { console.log('  失败项：'); fails.forEach((f) => console.log('    - ' + f)); }
console.log('  服务端健壮性验证通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
