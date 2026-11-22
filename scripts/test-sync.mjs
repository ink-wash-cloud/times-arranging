// 端到端验证双向同步协议：模拟两台设备并发读写与冲突
//
// 重要：本脚本会往服务器塞大量合成记录（task-1 / ok-1 / bulk-* …）。
// 默认自建一台隔离服务器 + 临时数据库，绝不污染你的真实数据；
// 确实要打真实服务器时再显式传 URL：node scripts/test-sync.mjs http://host:port
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXPLICIT = process.argv[2] || '';
let BASE = EXPLICIT;
let server = null;
let tmpDir = null;

async function startIsolatedServer() {
  tmpDir = mkdtempSync(join(tmpdir(), 'shixu-sync-'));
  const PORT = Number(process.env.SYNC_TEST_PORT || 8799);
  BASE = 'http://127.0.0.1:' + PORT;
  server = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, DATA_DIR: tmpDir, PORT: String(PORT), HOST: '127.0.0.1' }
  });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('隔离服务器启动超时');
}

function stopIsolatedServer() {
  if (server) { try { server.kill(); } catch { /* 已退出 */ } server = null; }
  if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 忽略 */ } tmpDir = null; }
}
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}

const api = async (path, init) => {
  const res = await fetch(BASE + path, init);
  if (!res.ok) throw new Error(path + ' -> HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
};
const rec = (collection, id, data, updatedAt, deviceId, deleted) => ({ collection, id, data, updatedAt, deviceId, deleted: !!deleted });

async function main() {
  if (!EXPLICIT) await startIsolatedServer();
  console.log('目标服务器: ' + BASE + (EXPLICIT ? '（外部实例，会写入合成数据）' : '（隔离实例 + 临时库，不污染真实数据）') + '\n');

  const health = await api('/api/health');
  ok('健康检查 /api/health', health.ok === true, health);

  /* ---------- 场景 1：A 设备新建，B 设备拉到 ---------- */
  console.log('\n[场景 1] 设备 A 新建待办 → 设备 B 拉取');
  const t1 = { title: 'A 创建的待办', category: '学习', dueDate: '2026-01-01', priority: 'P0' };
  const pushA = await api('/api/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'devA', deviceName: '电脑', records: [rec('tasks', 'task-1', t1, 1000, 'devA')] })
  });
  ok('A 推送被接受 (applied=1)', pushA.applied === 1, pushA);

  const pullB = await api('/api/pull?since=0&deviceId=devB');
  const got1 = pullB.records.find((r) => r.id === 'task-1');
  ok('B 能拉到 A 的记录', !!got1 && got1.data.title === 'A 创建的待办', got1);
  ok('B 拉取游标前进', pullB.cursor > 0, pullB.cursor);

  /* ---------- 场景 2：B 修改后 A 拉取（双向） ---------- */
  console.log('\n[场景 2] 设备 B 修改 → 设备 A 拉取（反向同步）');
  const t1b = { ...t1, title: 'B 改过的标题' };
  await api('/api/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'devB', records: [rec('tasks', 'task-1', t1b, 2000, 'devB')] })
  });
  const pullA2 = await api('/api/pull?since=0&deviceId=devA');
  const gotA = pullA2.records.find((r) => r.id === 'task-1');
  ok('A 能拉到 B 的修改', !!gotA && gotA.data.title === 'B 改过的标题', gotA);
  ok('服务端保留最新版本', gotA.updatedAt === 2000, gotA.updatedAt);

  /* ---------- 场景 3：冲突 —— 旧写入必须被拒绝 ---------- */
  console.log('\n[场景 3] 冲突：A 用旧时间戳覆盖 → 应被拒绝');
  const stale = await api('/api/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'devA', records: [rec('tasks', 'task-1', { ...t1, title: 'A 的过期修改' }, 1500, 'devA')] })
  });
  ok('过期写入被跳过 (applied=0, skipped=1)', stale.applied === 0 && stale.skipped === 1, stale);
  const after = await api('/api/pull?since=0');
  ok('数据未被旧版本污染', after.records.find((r) => r.id === 'task-1').data.title === 'B 改过的标题');

  /* ---------- 场景 4：时间戳相同 → 设备号决胜 ---------- */
  console.log('\n[场景 4] 时间戳相同：按设备号决胜（大者胜）');
  await api('/api/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'devC', records: [rec('tasks', 'task-2', { title: '来自 devC' }, 3000, 'devC')] })
  });
  const tie = await api('/api/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'devA', records: [rec('tasks', 'task-2', { title: '来自 devA' }, 3000, 'devA')] })
  });
  ok('devA < devC，写入被拒', tie.applied === 0, tie);
  const tie2 = await api('/api/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'devZ', records: [rec('tasks', 'task-2', { title: '来自 devZ' }, 3000, 'devZ')] })
  });
  ok('devZ > devC，写入被接受', tie2.applied === 1, tie2);

  /* ---------- 场景 5：删除通过墓碑同步 ---------- */
  console.log('\n[场景 5] 删除墓碑跨设备同步');
  await api('/api/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'devA', records: [rec('tasks', 'task-1', t1b, 9000, 'devA', true)] })
  });
  const delPull = await api('/api/pull?since=0&deviceId=devB');
  ok('墓碑已下发 (deleted=true)', delPull.records.find((r) => r.id === 'task-1').deleted === true);

  /* ---------- 场景 6：多集合 + 序号单调 + 分页 ---------- */
  console.log('\n[场景 6] 多集合、序号单调、分页游标');
  const bulk = [];
  for (let i = 0; i < 250; i++) bulk.push(rec('habitLogs', 'log-' + i, { habitId: 'h1', date: '2026-01-0' + ((i % 9) + 1) }, 10000 + i, 'devA'));
  const bulkRes = await api('/api/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'devA', records: bulk })
  });
  ok('批量推送 250 条全部接受', bulkRes.applied === 250, bulkRes);

  let cursor = 0, seen = 0, pages = 0;
  for (;;) {
    const page = await api('/api/pull?since=' + cursor + '&limit=100');
    pages++;
    seen += page.records.length;
    for (const r of page.records) if (r.seq <= cursor) { ok('序号必须严格递增', false, r); }
    cursor = page.cursor;
    if (!page.hasMore || !page.records.length || pages > 30) break;
  }
  ok('分页拉取覆盖全部记录（>=250）', seen >= 250, seen);
  ok('分页次数合理', pages <= 30, pages);

  /* ---------- 场景 7：全量导出 ---------- */
  console.log('\n[场景 7] 全量导出备份');
  const exp = await api('/api/export');
  ok('导出包含记录与序号', Array.isArray(exp.records) && exp.records.length >= 250, { n: exp.records.length, seq: exp.serverSeq });

  /* ---------- 场景 8：非法输入 ---------- */
  console.log('\n[场景 8] 非法输入健壮性');
  const bad = await api('/api/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'devA', records: [null, { foo: 1 }, { collection: 'tasks', id: 'ok-1', data: { a: 1 }, updatedAt: 5, deviceId: 'devA' }] })
  });
  ok('非法记录被跳过，合法记录仍写入', bad.applied === 1 && bad.skipped === 2, bad);

  console.log('\n========================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  stopIsolatedServer();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('测试异常：', e);
  stopIsolatedServer();
  process.exit(1);
});
