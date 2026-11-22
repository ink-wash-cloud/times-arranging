#!/usr/bin/env node
/**
 * 日程软件 · 同步服务端
 * 零第三方依赖：node:http + node:sqlite(Node 22+ 内置)
 * 职责：
 *   1) 托管前端 PWA 静态产物（电脑/手机同一个地址，同源无跨域）
 *   2) 提供 /api/sync/push 与 /api/sync/pull 实现双向同步
 *   3) 提供 /api/export 全量备份
 */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { createSocket } from 'node:dgram';
import { randomUUID } from 'node:crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'dist');
const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data');
const DB_PATH = join(DATA_DIR, 'schedule.db');
const PORT = Number(process.env.PORT || 8787);
const STARTED_AT = Date.now(); // /api/health 的 uptime 以此为准

const HOST = process.env.HOST || '0.0.0.0';
const TOKEN = (process.env.SYNC_TOKEN || '').trim(); // 可选：设置后所有 /api 请求需带 ?token= 或 X-Sync-Token
/* 局域网自动发现的 UDP 端口（手机发一个查询包，服务端立刻回自己的地址）。
   换 Wi-Fi 后 IP 会变，靠它手机不用输地址就能重新找到电脑。 */
const BEACON_PORT = Number(process.env.SHIXU_BEACON_PORT || 8799);

// 安卓安装包：放在 release/ 下，用纯英文文件名，避免中文名在下载时被错误编码。
// 文件名带版本号（shixu-v1.0.6.apk），这里总是挑最新打包的那一个，
// 这样 /download/app.apk 永远是新的，用户也能从文件名看出装的是哪版。
const RELEASE_DIR = join(ROOT, 'release');
function latestApk() {
  try {
    const files = readdirSync(RELEASE_DIR).filter((f) => /\.apk$/i.test(f));
    if (!files.length) return null;
    let best = null;
    for (const f of files) {
      const st = statSync(join(RELEASE_DIR, f));
      if (!best || st.mtimeMs > best.mtimeMs) best = { name: f, size: st.size, mtimeMs: st.mtimeMs };
    }
    return best;
  } catch { return null; }
}

await mkdir(DATA_DIR, { recursive: true });

/* ---------------------------------- DB ---------------------------------- */
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    collection TEXT NOT NULL,
    id         TEXT NOT NULL,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    device_id  TEXT NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    seq        INTEGER NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE INDEX IF NOT EXISTS idx_records_seq ON records(seq);
  CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
  INSERT OR IGNORE INTO counters(k, v) VALUES ('seq', 0);
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT,
    platform TEXT,
    first_seen INTEGER,
    last_seen INTEGER,
    push_count INTEGER DEFAULT 0,
    pull_count INTEGER DEFAULT 0
  );
  /* 这台服务器的"身份证"。换网络/IP 会变，但它不该变：
     客户端靠它判断"对面还是不是同一台电脑的同一个库"，换了库就整库重拉，
     否则游标比新库还大 → 两边都显示已同步、实际什么都没同步。 */
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

/** 老库升级：缺的列补上（devices 表在 v1.5.1 之前没有这几列）。 */
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`); } catch { /* 并发建过就算了 */ }
  }
}
ensureColumn('devices', 'last_since', 'last_since INTEGER');
ensureColumn('devices', 'last_given', 'last_given INTEGER');
ensureColumn('devices', 'last_pull_at', 'last_pull_at INTEGER');
ensureColumn('devices', 'last_push_at', 'last_push_at INTEGER');
ensureColumn('devices', 'last_applied', 'last_applied INTEGER');

function metaGet(k) {
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
  return row ? row.v : null;
}
function metaPut(k, v) {
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, String(v));
}
const DB_ID = (() => {
  const existed = metaGet('dbId');
  if (existed) return existed;
  const id = randomUUID();
  metaPut('dbId', id);
  metaPut('createdAt', Date.now());
  return id;
})();

const nextSeqStmt = () => {
  db.exec("UPDATE counters SET v = v + 1 WHERE k = 'seq'");
  return db.prepare("SELECT v FROM counters WHERE k = 'seq'").get().v;
};
const currentSeq = () => db.prepare("SELECT v FROM counters WHERE k = 'seq'").get().v;

const selOne = db.prepare('SELECT * FROM records WHERE collection = ? AND id = ?');
const upsert = db.prepare(`
  INSERT INTO records (collection, id, data, updated_at, device_id, deleted, seq)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(collection, id) DO UPDATE SET
    data = excluded.data, updated_at = excluded.updated_at,
    device_id = excluded.device_id, deleted = excluded.deleted, seq = excluded.seq
`);
const pullStmt = db.prepare('SELECT collection, id, data, updated_at, device_id, deleted, seq FROM records WHERE seq > ? ORDER BY seq ASC LIMIT ?');
const touchDevice = db.prepare(`
  INSERT INTO devices (id, name, platform, first_seen, last_seen, push_count, pull_count)
  VALUES (?, ?, ?, ?, ?, 0, 0)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name, platform = excluded.platform, last_seen = excluded.last_seen
`);
const bumpDevice = (id, field, by) => db.prepare(`UPDATE devices SET ${field} = ${field} + ? WHERE id = ?`).run(by, id);

/* 设备最近一次拉取问了哪个游标（last_since）、服务器给了哪个（last_given）。
   这是排查"假同步"的关键证据：若某台设备 last_since 比 serverSeq 还大，
   说明它的游标越过了服务器真实末尾 → 它以为拉完了，其实服务器上的东西它没拿到。 */
const touchDevicePull = db.prepare(`
  INSERT INTO devices (id, name, platform, first_seen, last_seen, push_count, pull_count, last_since, last_given, last_pull_at)
  VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, platform = excluded.platform, last_seen = excluded.last_seen,
    pull_count = devices.pull_count + 1,
    last_since = excluded.last_since, last_given = excluded.last_given, last_pull_at = excluded.last_pull_at
`);
const touchDevicePush = db.prepare(`
  INSERT INTO devices (id, name, platform, first_seen, last_seen, push_count, pull_count, last_push_at, last_applied)
  VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, platform = excluded.platform, last_seen = excluded.last_seen,
    push_count = devices.push_count + 1,
    last_push_at = excluded.last_push_at, last_applied = excluded.last_applied
`);
const liveCount = () => db.prepare('SELECT COUNT(*) AS n FROM records WHERE deleted = 0').get().n;
const tombCount = () => db.prepare('SELECT COUNT(*) AS n FROM records WHERE deleted = 1').get().n;

/* ------------------------- 冲突解决：LWW + 设备号决胜 ------------------------- */
function wins(incoming, existing) {
  if (!existing) return true;
  if (incoming.updatedAt > existing.updated_at) return true;
  if (incoming.updatedAt < existing.updated_at) return false;
  return String(incoming.deviceId || '') > String(existing.device_id || '');
}

function mergeRecords(incoming) {
  let applied = 0, skipped = 0, cursor = currentSeq();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const rec of incoming) {
      if (!rec || typeof rec.collection !== 'string' || typeof rec.id !== 'string') { skipped++; continue; }
      const existing = selOne.get(rec.collection, rec.id);
      if (!wins(rec, existing)) { skipped++; continue; }
      const seq = nextSeqStmt();
      upsert.run(
        rec.collection, rec.id,
        JSON.stringify(rec.data ?? null),
        Number(rec.updatedAt) || Date.now(),
        String(rec.deviceId || 'unknown'),
        rec.deleted ? 1 : 0,
        seq
      );
      cursor = seq;
      applied++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { applied, skipped, cursor };
}

/* --------------------------------- HTTP --------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  // 连接可能已经被对端断了（比如手机切 Wi-Fi），writeHead 会抛 ERR_STREAM_WRITE_AFTER_END
  if (!res || res.destroyed || res.writableEnded) return;
  try {
    res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  } catch { /* 连接没了就不写了 */ }
}
function sendJSON(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((ok, no) => {
    const chunks = []; let size = 0; let done = false;
    const finish = (fn, v) => { if (!done) { done = true; fn(v); } };
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        const e = new Error('payload too large');
        e.code = 'E_BODY_TOO_LARGE';
        // 不再收数据了，但别 destroy：上层还要把 413 写回去
        req.pause();
        finish(no, e);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => finish(ok, Buffer.concat(chunks).toString('utf8')));
    req.on('error', (e) => finish(no, e));
    req.on('aborted', () => finish(no, Object.assign(new Error('client aborted'), { code: 'E_ABORTED' })));
  });
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Sync-Token,X-Device-Id'
};

/* ---------------------- 一条坏请求不该打死整个服务 ----------------------
   这台服务器是常驻的（手机随时来同步、页面 10 秒一次报到），
   以前只要有一条畸形请求没兜住，整个进程就退出了，手机那边立刻「连不上」。
   实际踩到的三颗雷：
     · Host: : 这种坏头 → new URL() 抛 ERR_INVALID_URL；
     · 路径里残缺的转义 /%E4 → decodeURIComponent() 抛 URIError；
     · 客户端传到一半断开 → req/res 抛 error 事件，没人接就变 uncaughtException。
   所以这里不依赖 Host 解析 URL、解码失败回 400、每个请求兜一层 try/catch、
   文件流挂 error 处理，最外层再加 uncaughtException / unhandledRejection 兜底。 */

/** 只取 pathname 和查询参数，绝不因为 Host 头畸形而抛错。 */
function parseUrl(req) {
  let raw = String(req.url || '/');
  // 代理/客户端可能发绝对形式：GET http://host:port/api/health
  const abs = raw.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*(\/.*)?$/);
  if (abs) raw = abs[1] || '/';
  const q = raw.indexOf('?');
  const pathname = (q >= 0 ? raw.slice(0, q) : raw) || '/';
  let searchParams;
  try { searchParams = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : ''); }
  catch { searchParams = new URLSearchParams(); }
  return { pathname, searchParams };
}

/** 解码失败返回 null（调用方回 400），不要让它抛。 */
function safeDecode(v) {
  try { return decodeURIComponent(v); } catch { return null; }
}

function sendSafe(res, status, body, headers) {
  if (!res || res.destroyed || res.writableEnded) return;
  try { send(res, status, body, headers); } catch { /* 连接已经断了，忽略 */ }
}

/** 传文件：流上必须挂 error，否则文件在 stat 之后被删/没权限会打崩进程。 */
function pipeFile(res, file, size, headers) {
  if (!res || res.destroyed) return;
  try { res.writeHead(200, headers); } catch { return; }
  const s = createReadStream(file);
  s.on('error', () => { try { res.destroy(); } catch { /* 忽略 */ } });
  res.on('close', () => { try { s.destroy(); } catch { /* 忽略 */ } });
  s.pipe(res);
}

/** 库里的 JSON 万一写坏了（断电、手工改库），读出来不该连带把接口打挂。 */
function safeJSON(text, fallback = null) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function clampInt(v, dflt, min, max) {
  // 注意：参数没传时是 null，而 Number(null) === 0 —— 直接 Number() 会把
  // "没传 limit" 当成 limit=0 再收敛成 1，于是每次只下发一条记录（同步看起来"正常"但永远追不上）。
  if (v === null || v === undefined || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

async function serveStatic(req, res, urlPath) {
  const decoded = safeDecode(urlPath.split('?')[0]);
  if (decoded === null) return sendSafe(res, 400, 'bad path encoding', { 'Content-Type': MIME['.txt'] });
  let rel = decoded;
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = normalize(join(DIST, rel));
  if (!target.startsWith(DIST + sep) && target !== DIST) return sendSafe(res, 403, 'forbidden');

  const ext = extname(target).toLowerCase();
  // 带扩展名的路径一定是静态资源，缺失时绝不能回退成 index.html，
  // 否则任何"文件是否存在"的探测都会拿到 200 + HTML（曾导致字体探测误判）
  const isAsset = ext !== '';

  try {
    const st = await stat(target);
    if (st.isDirectory()) throw new Error('dir');
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': rel === '/index.html' || rel === '/sw.js' ? 'no-cache' : 'public, max-age=604800'
    };
    if (req.method === 'HEAD') { res.writeHead(200, headers); res.end(); return; }
    pipeFile(res, target, st.size, headers);
  } catch {
    if (isAsset) return sendSafe(res, 404, 'not found: ' + rel, { 'Content-Type': MIME['.txt'] });
    // 只有无扩展名的路径才做 SPA 回退
    try {
      const html = await readFile(join(DIST, 'index.html'));
      sendSafe(res, 200, html, { 'Content-Type': MIME['.html'] });
    } catch {
      sendSafe(res, 404, '前端尚未构建：请先运行 npm run build', { 'Content-Type': MIME['.txt'] });
    }
  }
}

async function handle(req, res) {
  // 注意：不碰 req.headers.host —— 一个 Host: : 就能让 new URL() 抛错把进程带走
  const { pathname: p, searchParams } = parseUrl(req);

  if (req.method === 'OPTIONS') return send(res, 204, '', CORS);

  // 安卓安装包下载：手机浏览器直接打开这个地址就能装，不需要从电脑传文件
  if (p === '/download/app.apk') {
    const apk = latestApk();
    if (!apk) {
      send(res, 404, '还没有打包：在电脑上运行 npm run apk', { 'Content-Type': MIME['.txt'] });
      return;
    }
    // 带上版本号，手机「下载」里就能看出装的是哪一版
    if (req.method === 'HEAD') {
      try {
        res.writeHead(200, {
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Length': apk.size,
          'Content-Disposition': 'attachment; filename="' + apk.name + '"'
        });
        res.end();
      } catch { /* 忽略 */ }
      return;
    }
    // 用 pipeFile：文件在 stat 之后被删/被占用时不会把进程带走
    pipeFile(res, join(RELEASE_DIR, apk.name), apk.size, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': apk.size,
      'Content-Disposition': 'attachment; filename="' + apk.name + '"',
      'Cache-Control': 'no-cache'
    });
    return;
  }

  if (p.startsWith('/api/')) {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    const given = req.headers['x-sync-token'] || searchParams.get('token') || '';
    if (TOKEN && given !== TOKEN) return sendJSON(res, 401, { error: 'unauthorized' });

    try {
      if (p === '/api/health') {
        const now = Date.now();
        return sendJSON(res, 200, {
          ok: true, seq: currentSeq(), time: now, auth: !!TOKEN, autoExit: AUTO_EXIT,
          // 服务没重启过，uptime 就一直是往上涨的；突然变小 = 崩溃/重启过
          uptime: now - STARTED_AT,
          // 服务器身份 + 数据规模：客户端靠它判断"对面还是不是同一个库、我是不是落后了"
          dbId: DB_ID, records: liveCount(), tombstones: tombCount(), beacon: BEACON_PORT,
          // 排查"为什么关了应用服务器还在"用的：距上次报到/告别过了多久
          seenAgo: now - lastSeen,
          byeAgo: byeAt ? now - byeAt : null
        });
      }
      // 页面还开着 -> 报到。服务器据此判断"还有人用"，没人用就自己退出
      if (p === '/api/here') {
        lastSeen = Date.now();
        byeAt = 0;
        return sendJSON(res, 200, { ok: true, autoExit: AUTO_EXIT, idleMs: IDLE_MS });
      }
      // 关窗口 -> 告别。留一点宽限时间，页面刷新会紧接着重新报到，不会误退
      if (p === '/api/bye') {
        byeAt = Date.now();
        return sendJSON(res, 200, { ok: true });
      }
      if (p === '/api/app-info' && req.method === 'GET') {
        const apk = latestApk();
        if (!apk) return sendJSON(res, 200, { available: false, url: '/download/app.apk' });
        return sendJSON(res, 200, {
          available: true, name: apk.name, size: apk.size,
          updatedAt: apk.mtimeMs, url: '/download/app.apk'
        });
      }
      if (p === '/api/pull' && req.method === 'GET') {
        // 参数全部收敛成合法整数：NaN / 负数 / 超大值都不该让 SQLite 抛错，
        // 尤其 limit=-1 在 SQLite 里等于"不限量"，会把整库一次性吐出去。
        const since = clampInt(searchParams.get('since'), 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = clampInt(searchParams.get('limit'), 2000, 1, 5000);
        const deviceId = (searchParams.get('deviceId') || '').slice(0, 120);
        const rows = pullStmt.all(since, limit);
        const serverSeq = currentSeq();
        /* 客户端游标比服务器还大 = 这个库被换过/清过（重装、换电脑、恢复备份）。
           这时不能老实回"没有新记录"，否则客户端永远认为自己对上了，
           两边各自累积、都显示已同步——这就是"假同步"。
           把游标压回服务器真实末尾，客户端会当成"从头对齐"重拉一遍。 */
        const rewound = since > serverSeq;
        const cursor = rows.length ? rows[rows.length - 1].seq : (rewound ? serverSeq : since);
        if (deviceId) {
          const now = Date.now();
          touchDevicePull.run(deviceId, (searchParams.get('name') || '').slice(0, 120), (searchParams.get('platform') || '').slice(0, 40), now, now, since, cursor, now);
        }
        return sendJSON(res, 200, {
          records: rows.map((r) => ({
            collection: r.collection, id: r.id, data: safeJSON(r.data),
            updatedAt: r.updated_at, deviceId: r.device_id, deleted: !!r.deleted, seq: r.seq
          })),
          cursor,
          serverSeq,
          dbId: DB_ID,
          rewound,
          recordsCount: liveCount(),
          hasMore: rows.length === limit
        });
      }
      if (p === '/api/push' && req.method === 'POST') {
        let rawBody;
        try {
          rawBody = await readBody(req);
        } catch (e) {
          // 请求体超过上限：明确回 413，而不是 500 + 把连接半截挂在哪儿
          if (e && e.code === 'E_BODY_TOO_LARGE') return sendJSON(res, 413, { error: 'payload too large', limit: 32 * 1024 * 1024 });
          throw e;
        }
        let body;
        try { body = JSON.parse(rawBody || '{}'); }
        catch { return sendJSON(res, 400, { error: 'invalid json' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJSON(res, 400, { error: 'body must be an object' });
        const records = Array.isArray(body.records) ? body.records : [];
        if (records.length > 20000) return sendJSON(res, 413, { error: 'too many records in one push', count: records.length, limit: 20000 });
        const deviceId = body.deviceId || req.headers['x-device-id'] || '';
        const result = mergeRecords(records);
        if (deviceId) {
          const now = Date.now();
          touchDevicePush.run(deviceId, body.deviceName || '', body.platform || '', now, now, now, result.applied);
        }
        return sendJSON(res, 200, { ok: true, ...result, serverSeq: currentSeq(), dbId: DB_ID, recordsCount: liveCount(), time: Date.now() });
      }
      if (p === '/api/export' && req.method === 'GET') {
        const rows = db.prepare('SELECT collection, id, data, updated_at, device_id, deleted FROM records').all();
        return sendJSON(res, 200, {
          exportedAt: new Date().toISOString(), serverSeq: currentSeq(),
          count: rows.length,
          records: rows.map((r) => ({ collection: r.collection, id: r.id, data: safeJSON(r.data), updatedAt: r.updated_at, deviceId: r.device_id, deleted: !!r.deleted }))
        });
      }
      if (p === '/api/stats' && req.method === 'GET') {
        const rows = db.prepare('SELECT collection, COUNT(*) n FROM records WHERE deleted = 0 GROUP BY collection').all();
        const devices = db.prepare('SELECT id, name, platform, last_seen, push_count, pull_count FROM devices ORDER BY last_seen DESC').all();
        return sendJSON(res, 200, { collections: rows, devices, serverSeq: currentSeq(), dbId: DB_ID, dbPath: DB_PATH });
      }
      /* 设备体检：每台设备上次连上是什么时候、它拉取时问的是哪个游标。
         「手机排到的位置」比「服务器现在的位置」还大 → 手机拿不到东西，需要重新对齐。 */
      if (p === '/api/devices' && req.method === 'GET') {
        const now = Date.now();
        const devices = db.prepare(`
          SELECT id, name, platform, first_seen, last_seen, push_count, pull_count,
                 last_since, last_given, last_pull_at, last_push_at, last_applied
          FROM devices ORDER BY last_seen DESC
        `).all().map((d) => ({
          ...d,
          online: now - (d.last_seen || 0) < 120000,
          ahead: d.last_since != null && d.last_since > currentSeq(),
          behindBy: d.last_given != null ? Math.max(0, currentSeq() - d.last_given) : null
        }));
        return sendJSON(res, 200, {
          ok: true, now, dbId: DB_ID, serverSeq: currentSeq(),
          records: liveCount(), tombstones: tombCount(), devices
        });
      }
      // 本机地址：电脑端设置页把「手机该填哪个地址」直接亮出来。
      // 手机连不上十有八九是抄了旧 IP（换 Wi-Fi 后 IP 会变）或者抄了虚拟网卡，
      // 所以这里连"哪些地址手机根本连不上"一起标出来，而不是只回一串 IP。
      if (p === '/api/addresses' && req.method === 'GET') {
        return sendJSON(res, 200, addressInfo());
      }
      return sendJSON(res, 404, { error: 'unknown api', path: p });
    } catch (e) {
      return sendJSON(res, 500, { error: String(e && e.message || e) });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return sendSafe(res, 405, 'method not allowed');
  return serveStatic(req, res, p);
}

const server = createServer((req, res) => {
  // 客户端中途断开时 req/res 会发 error 事件；没人接就是 uncaughtException。
  req.on('error', () => { /* 对端断了，正常 */ });
  res.on('error', () => { /* 写回失败，正常 */ });
  handle(req, res).catch((e) => {
    console.error('   请求处理出错（服务继续运行）: ' + (e && e.stack ? e.stack : e));
    sendSafe(res, 500, 'internal error');
  });
});

/* 半开连接不该把服务拖死：本地小服务器没有长任务，30 秒足够传完一次全量同步。 */
server.requestTimeout = 30000;
server.headersTimeout = 20000;
server.keepAliveTimeout = 5000;
/* 解析不了请求行/头的连接（HTTP 垃圾、端口探测）回 400 就走，别抛。 */
server.on('clientError', (err, socket) => {
  try {
    if (socket && socket.writable && !socket.destroyed) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    } else if (socket) {
      socket.destroy();
    }
  } catch { /* 已经没了 */ }
});

/* 最后一道保险：任何漏网的异常都只记一笔，不让常驻服务退出。
   （宁可少一条请求，也不能让手机突然连不上。） */
process.on('uncaughtException', (e) => {
  console.error('   未捕获异常（服务继续运行）: ' + (e && e.stack ? e.stack : e));
});
process.on('unhandledRejection', (e) => {
  console.error('   未处理的 Promise 拒绝（服务继续运行）: ' + (e && e.stack ? e.stack : e));
});

function lanURLs() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal && !ni.address.startsWith('169.254.')) out.push({ iface: name, url: `http://${ni.address}:${PORT}` });
    }
  }
  return out;
}

/* ------------------------- 本机地址（给手机抄） -------------------------
   电脑端设置页 /api/addresses 用它：
     · localhost / 127.0.0.1 在电脑上永远能用，但手机填了连不上，标清楚；
     · 一张网卡可能同时有 VMware/VirtualBox/Hyper-V/WSL 的虚拟地址，
       手机连不上，还特别容易被抄错——单独标 virtual 并给 note；
     · 169.254 是没拿到 DHCP 时的临时地址，同样连不上。
   接口不猜"哪张网卡是 Wi-Fi"，只把 kind/available 摆出来，UI 负责挑。 */
const VIRTUAL_IFACE_RE = /(vethernet|vmware|virtualbox|vboxnet|hyper-v|wsl|docker|br-|utun|tun\d|tap\d|tailscale|zerotier|hamachi|radmin|npcap)/i;

function addressKind(iface, address, internal) {
  if (internal || /^127\./.test(address)) return 'loopback';
  if (/^169\.254\./.test(address)) return 'linklocal';
  if (VIRTUAL_IFACE_RE.test(iface)) return 'virtual';
  return 'lan';
}

function addressInfo() {
  // 监听范围决定"手机能不能用这些局域网地址"：只监听 127.0.0.1 时，
  // 本机照样能用 localhost，但手机连任何局域网 IP 都连不上。
  const loopbackOnly = /^(127\.|localhost$|::1$)/.test(String(HOST || '').trim().toLowerCase());
  const urls = [];
  for (const [iface, list] of Object.entries(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' && ni.family !== 4) continue;
      const kind = addressKind(iface, ni.address, ni.internal);
      const url = `http://${ni.address}:${PORT}`;
      urls.push({
        iface, address: ni.address, url,
        internal: kind === 'loopback',
        virtual: kind === 'virtual',
        available: kind === 'lan' && !loopbackOnly,
        kind,
        note: kind === 'lan' ? (loopbackOnly ? '服务只监听本机，手机连不上' : '')
          : kind === 'virtual' ? '虚拟网卡（虚拟机/容器），手机连不上'
          : kind === 'linklocal' ? '临时地址（没拿到 DHCP），手机连不上'
          : '仅这台电脑自己能用，手机连不上'
      });
    }
  }
  const rank = { lan: 0, virtual: 1, linklocal: 2, loopback: 3 };
  urls.sort((a, b) => rank[a.kind] - rank[b.kind] || a.address.localeCompare(b.address));
  const lanUrls = urls.filter((u) => u.available).map((u) => u.url);
  let hint = '';
  if (loopbackOnly) hint = `同步服务只监听了本机（HOST=${HOST}），手机连不上：关掉后重新运行「时序」（默认会监听局域网）。`;
  else if (!lanUrls.length) hint = '没检测到局域网地址：电脑可能没连 Wi-Fi/网线，手机暂时连不上。';
  return {
    ok: true,
    port: PORT, host: HOST, loopbackOnly,
    time: Date.now(),
    localhost: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
    urls, lanUrls,
    primary: lanUrls[0] || '',
    hint,
    autoExit: AUTO_EXIT
  };
}

/* ------------------------- 局域网自动发现（UDP 信标） -------------------------
   手机端不需要知道电脑的 IP：往 255.255.255.255:8799 发一个查询包，
   电脑立刻回一包自己的地址。换 Wi-Fi 后几毫秒就能重新找到，不用手输。

   同时每 3 秒向各网卡的广播地址喊一声（announce），
   给以后"另一台电脑 / 平板上的网页"这种没法主动发查询的客户端用。
   收到别人的 announce 不回包，否则两台电脑会互相刷屏。 */
function broadcastAddrs() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list || []) {
      if (!(ni.family === 'IPv4' || ni.family === 4) || ni.internal) continue;
      const ip = String(ni.address).split('.').map(Number);
      const mk = String(ni.netmask || '255.255.255.0').split('.').map(Number);
      if (ip.length !== 4 || mk.length !== 4 || ip.some((n) => !Number.isFinite(n)) || mk.some((n) => !Number.isFinite(n))) continue;
      const bc = ip.map((o, i) => ((o & mk[i]) | (~mk[i] & 255)) >>> 0);
      out.push({ iface: name, address: bc.join('.') });
    }
  }
  return out;
}

function beaconPayload(announce) {
  const info = addressInfo();
  const lan = info.lanUrls && info.lanUrls.length ? info.lanUrls : info.localhost;
  return Buffer.from(JSON.stringify({
    shixu: 1, announce: announce ? 1 : 0, name: '时序',
    port: PORT, seq: currentSeq(), dbId: DB_ID, records: liveCount(),
    urls: lan, time: Date.now()
  }), 'utf8');
}

let beaconSock = null;
function startBeacon() {
  if (process.env.SHIXU_BEACON === '0' || !BEACON_PORT) return;
  try {
    const sock = createSocket({ type: 'udp4', reuseAddr: true });
    beaconSock = sock;
    sock.on('error', (e) => {
      console.log('   自动发现 : UDP ' + BEACON_PORT + ' 没起来（' + e.message + '，不影响同步）');
      try { sock.close(); } catch { /* 已经关了 */ }
      beaconSock = null;
    });
    sock.on('message', (msg, rinfo) => {
      if (!msg || !msg.length) return;
      let itsAnnounce = false;
      try { itsAnnounce = JSON.parse(msg.toString('utf8')).announce === 1; } catch { /* 不是 JSON = 查询包 */ }
      if (itsAnnounce) return;
      try { sock.send(beaconPayload(false), rinfo.port, rinfo.address); } catch { /* 对方已走 */ }
    });
    sock.bind(BEACON_PORT, () => {
      try { sock.setBroadcast(true); } catch { /* 有些网卡不允许，退回只回包 */ }
      const shout = () => {
        let msg;
        try { msg = beaconPayload(true); } catch { return; }
        for (const b of broadcastAddrs()) {
          try { sock.send(msg, BEACON_PORT, b.address); } catch { /* 忽略单张网卡 */ }
        }
      };
      shout();
      setInterval(shout, 3000).unref();
      console.log('   自动发现 : UDP ' + BEACON_PORT + ' 已开启（手机换 Wi-Fi 后能自己找到这台电脑）');
    });
  } catch (e) {
    console.log('   自动发现 : 启动失败（' + e.message + '，不影响同步）');
  }
}

/* ---------------------- 随用随开的生命周期 ----------------------
   由启动器（启动时序.vbs）设置 SHIXU_AUTO_EXIT=1 时启用：
     · 页面每 10 秒打一次 /api/here 报到；
     · 关窗口时用 sendBeacon 发一次 /api/bye；
     · 收不到报到就自己退出——这样"关掉应用"不会留下后台进程。
   手动 npm start 不带这个变量，行为完全不变（常驻）。

   为什么超时是 100 秒而不是 30 秒：浏览器会把后台标签页的定时器降频到
   每分钟一次，超时太短会在窗口还在（只是没焦点/被挡住）时把服务器误杀。
   真正关窗口的情况走 /api/bye，10 秒就退，用户感觉是立刻的。 */
const AUTO_EXIT = process.env.SHIXU_AUTO_EXIT === '1';
const IDLE_MS = Number(process.env.SHIXU_IDLE_MS || 100000);
const BYE_GRACE_MS = Number(process.env.SHIXU_BYE_GRACE_MS || 10000);
let lastSeen = Date.now();
let byeAt = 0;
let exiting = false;

if (AUTO_EXIT) {
  let lastTick = Date.now();
  setInterval(() => {
    if (exiting) return;
    const now = Date.now();
    const drift = now - lastTick;
    lastTick = now;
    /* 定时器自己被挂起过（笔记本合盖睡眠、系统休眠、极端降频）：
       这段时间服务器根本没在跑，页面当然也没机会来报到。
       不能把这几个小时算成"页面已关闭"，否则一合盖再打开，同步服务就没了。
       所以把 lastSeen 直接推到当前时刻，等页面醒过来继续报到。 */
    if (drift > 5000) lastSeen = now;
    const idle = now - lastSeen;
    const closedLongEnough = byeAt > 0 && now - byeAt > BYE_GRACE_MS && idle > BYE_GRACE_MS;
    if (closedLongEnough) {
      exiting = true;
      console.log('\n   页面已关闭，同步服务自动退出（不带 --auto-exit 启动可常驻）');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    } else if (idle > IDLE_MS) {
      exiting = true;
      console.log('\n   ' + Math.round(IDLE_MS / 1000) + ' 秒没有客户端连接，同步服务自动退出');
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    }
  }, 2000).unref();
}

/* 端口被占用时别只打一堆栈：双击两次启动器是最常见的场景，
   第二个进程应该说明白"已经在运行"，然后安静退出。 */
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error('');
    console.error('   端口 ' + PORT + ' 已被占用 —— 时序多半已经在运行了。');
    console.error('   直接用浏览器打开 http://localhost:' + PORT + ' 就行；');
    console.error('   想另开一个（比如测试用）就换个端口，例如 PORT=8788 node server/index.mjs');
    console.error('');
    setTimeout(() => process.exit(0), 1200);
    return;
  }
  console.error('');
  console.error('   同步服务启动失败：' + (err && err.message ? err.message : err));
  console.error('');
  setTimeout(() => process.exit(1), 600);
});

server.listen(PORT, HOST, () => {
  const urls = lanURLs();
  console.log('');
  console.log('  ┌────────────────────────────────────────────────┐');
  console.log('  │            日程软件 · 同步服务已启动            │');
  console.log('  └────────────────────────────────────────────────┘');
  console.log(`   本机访问 : http://localhost:${PORT}`);
  for (const u of urls) console.log(`   手机访问 : ${u.url}   (${u.iface})`);
  for (const u of urls) console.log(`   装应用   : ${u.url}/download/app.apk   (手机浏览器直接打开即可下载安装)`);
  console.log(`   数据文件 : ${DB_PATH}`);
  console.log(`   鉴权     : ${TOKEN ? '已开启 SYNC_TOKEN' : '关闭（仅建议内网使用）'}`);
  console.log(`   生命周期 : ${AUTO_EXIT ? '跟随页面（关掉应用就退出）' : '常驻'}`);
  console.log('');
  startBeacon();
});
