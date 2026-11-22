// 响应式本地数据库 + 双向同步引擎
// 写入策略：Local-first。任何修改先落 IndexedDB 并立即刷新界面，后台异步推送。
import { useSyncExternalStore } from 'react';
import type { CollectionName, Envelope } from '../types';
import { idbAll, idbDirty, idbPut, idbPutMany, idbClearAll, idbDeleteMany, metaGet, metaSet } from './idb';
import { accentFor, currentFrozen, currentLegibility, getAppearance, profileFor, saveAppearance } from './appearance';
import { backStats, pressBack, resetBackState } from './backNav';
import { rescheduleNativeReminders } from './nativeReminders';
import { isNativeApp } from './native';
import { describeDiscovery, discoverServer, discoverServerDetailed, healthOf, portOf, isNetworkError, probeUrl } from './discover';
import type { HealthInfo } from './discover';
import { getFontStatus } from './fonts';
import { openSettingsPage, settingsPage } from './uiNav';
import { DEFAULT_LANG, LANGS, getLang, isLang, missingKeys, setLang, t } from './i18n';
import type { Lang } from './i18n';

export { metaGet, metaSet };

export type Item<T> = T & { id: string };

type Cache = Map<string, Envelope>;

const cache: Cache = new Map();
const key = (c: string, id: string) => c + '\u0000' + id;

let version = 0;
const listeners = new Set<() => void>();
let derived = new Map<string, unknown>();

function notify() {
  version++;
  derived = new Map();
  listeners.forEach((fn) => fn());
  // 原生端：数据变了就（去抖后）重排系统通知，保证关掉应用也能提醒
  rescheduleNativeReminders();
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export const getVersion = () => version;

/** React Hook：订阅整个本地库 */
export function useDB(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

export function list<T>(collection: CollectionName): Item<T>[] {
  const ck = 'list:' + collection;
  if (derived.has(ck)) return derived.get(ck) as Item<T>[];
  const out: Item<T>[] = [];
  cache.forEach((env) => {
    if (env.collection === collection && !env.deleted) {
      out.push({ ...(env.data as object), id: env.id } as Item<T>);
    }
  });
  derived.set(ck, out);
  return out;
}

export function allEnvelopes(collection: CollectionName): Envelope[] {
  const out: Envelope[] = [];
  cache.forEach((env) => { if (env.collection === collection && !env.deleted) out.push(env); });
  return out;
}

export function getOne<T>(collection: CollectionName, id: string): Item<T> | null {
  const env = cache.get(key(collection, id));
  if (!env || env.deleted) return null;
  return { ...(env.data as object), id: env.id } as Item<T>;
}

/* ------------------------------ 时间戳与写入 ------------------------------ */
let lastStamp = 0;
export function nextStamp(): number {
  const t = Date.now();
  lastStamp = t > lastStamp ? t : lastStamp + 1;
  return lastStamp;
}

export function deviceId(): string {
  return cfg.deviceId;
}

/** 同步方向：both 双向 / push 只把本机改动推给对方 / pull 只把对方的改动拉过来 */
export type SyncDir = 'both' | 'push' | 'pull';

interface Config {
  deviceId: string;
  deviceName: string;
  serverUrl: string;      // 当前正在用的同步地址
  serverUrls: string[];   // 已知地址池：家里 / 学校 / 热点各存一个，挨个试
  syncToken: string;
  autoSync: boolean;
  lastPulledSeq: number;
  lastSyncAt: number;
  lastError: string;
  termStart: string;   // 教学周第一周周一（YYYY-MM-DD），空串表示未设置
  periodsText: string; // 自定义节次表文本
  ttWeek: number;      // 上次选的周次（0 表示没选过）
  ttWeekMode: 'follow' | 'fixed'; // follow=跟着当天自动走，fixed=锁在你选的那一周
  ttWeekAt: string;    // 上次选周次的日期（用于判断"过了几周"）
  dashCards: string[]; // 总览页显示哪几张卡片（本机偏好，不上传服务器）
  widgetBlocks: string[]; // 桌面小组件显示哪些块：tasks / habits / courses / anniversary / budget / life
  syncDir: SyncDir;    // 同步方向（见上面的 SyncDir）
  classNotif: boolean; // 课表 · 上课提醒总开关
  classLead30: boolean; // 课表 · 上课前 30 分钟提醒
  classLead10: boolean; // 课表 · 上课前 10 分钟提醒
  classMerge: boolean;  // 课表 · 连堂课只在课间提醒一次（不逐节重复报 30/10 分钟）
  ttLocked: boolean;    // 课表 · 锁定：禁止拖动、加课、删课等改动
  ttDrag: boolean;      // 课表 · 长按拖动调课（课表设置里的第六个开关，双端同步）
  habitTimes: boolean;  // 习惯 · 按每个习惯自己设的时间点提醒
  lang: Lang;           // 界面语言（本机偏好，不上传服务器）
}

export const cfg: Config = {
  deviceId: '',
  deviceName: '',
  serverUrl: '',
  serverUrls: [],
  syncToken: '',
  autoSync: true,
  lastPulledSeq: 0,
  lastSyncAt: 0,
  lastError: '',
  termStart: '',
  periodsText: '',
  ttWeek: 0,
  ttWeekMode: 'follow',
  ttWeekAt: '',
  dashCards: [],
  widgetBlocks: [],
  syncDir: 'both',
  classNotif: true,
  classLead30: true,
  classLead10: true,
  classMerge: true,
  ttLocked: false,
  ttDrag: true,
  habitTimes: true,
  lang: DEFAULT_LANG
};

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
export const newId = uuid;

function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Macintosh/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Web';
}

export async function loadConfig(): Promise<void> {
  cfg.deviceId = await metaGet('deviceId', '');
  if (!cfg.deviceId) {
    cfg.deviceId = uuid();
    await metaSet('deviceId', cfg.deviceId);
  }
  cfg.deviceName = await metaGet('deviceName', detectPlatform() + '-' + cfg.deviceId.slice(0, 4));
  // 默认同步地址只在"原生应用"里生效：
  //   · 网页版由服务端托管，走同源（留空即可）
  //   · 安卓包没有同源概念，用构建期注入的局域网地址，用户之后可在设置页改
  const defaultServer = (() => {
    try {
      const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      const native = !!(c && c.isNativePlatform && c.isNativePlatform());
      return native && typeof __DEFAULT_SERVER__ === 'string' ? __DEFAULT_SERVER__ : '';
    } catch { return ''; }
  })();
  cfg.serverUrl = await metaGet('serverUrl', defaultServer);
  cfg.serverUrls = await metaGet<string[]>('serverUrls', defaultServer ? [defaultServer] : []);
  if (!Array.isArray(cfg.serverUrls)) cfg.serverUrls = [];
  // 当前地址永远算数，别出现"在用它但不在列表里"的怪状态
  if (cfg.serverUrl && cfg.serverUrls.indexOf(cfg.serverUrl) < 0) cfg.serverUrls.unshift(cfg.serverUrl);
  cfg.syncToken = await metaGet('syncToken', '');
  cfg.autoSync = await metaGet('autoSync', true);
  cfg.lastPulledSeq = await metaGet('lastPulledSeq', 0);
  cfg.lastSyncAt = await metaGet('lastSyncAt', 0);
  cfg.termStart = await metaGet('termStart', '');
  cfg.periodsText = await metaGet('periodsText', '');
  cfg.ttWeek = Number(await metaGet('ttWeek', 0)) || 0;
  cfg.ttWeekMode = (await metaGet('ttWeekMode', 'follow')) === 'fixed' ? 'fixed' : 'follow';
  cfg.ttWeekAt = (await metaGet('ttWeekAt', '')) || '';
  const blocks = await metaGet<string[]>('widgetBlocks', []);
  cfg.widgetBlocks = Array.isArray(blocks) ? blocks.filter((x) => typeof x === 'string') : [];
  const cards = await metaGet<string[]>('dashCards', []);
  cfg.dashCards = Array.isArray(cards) ? cards.filter((x) => typeof x === 'string') : [];
  const dir = await metaGet('syncDir', 'both');
  cfg.syncDir = dir === 'push' || dir === 'pull' ? dir : 'both';
  cfg.classNotif = (await metaGet('classNotif', true)) !== false;
  cfg.classLead30 = (await metaGet('classLead30', true)) !== false;
  cfg.classLead10 = (await metaGet('classLead10', true)) !== false;
  cfg.classMerge = (await metaGet('classMerge', true)) !== false;
  cfg.ttLocked = (await metaGet('ttLocked', false)) === true;
  cfg.ttDrag = (await metaGet('ttDrag', true)) !== false;
  cfg.habitTimes = (await metaGet('habitTimes', true)) !== false;
  const lang = await metaGet('lang', DEFAULT_LANG);
  cfg.lang = isLang(lang) ? lang : DEFAULT_LANG;
}

export async function saveConfig(patch: Partial<Config>): Promise<void> {
  Object.assign(cfg, patch);
  for (const k of Object.keys(patch)) {
    if (k === 'lastError') continue;
    await metaSet(k, (cfg as unknown as Record<string, unknown>)[k]);
  }
  notify();
}

export async function loadAll(): Promise<void> {
  cache.clear();
  const rows = await idbAll();
  for (const r of rows) cache.set(key(r.collection, r.id), r);
  // 修正脏索引：老数据可能缺 dirty 字段
  const fix: Envelope[] = [];
  cache.forEach((env) => {
    if (env.dirty !== 0 && env.dirty !== 1) { env.dirty = 0; fix.push(env); }
  });
  if (fix.length) await idbPutMany(fix);
  // 启动时先把「本机有多少条」算好：顶栏要拿它和服务器比条数，
  // 不然刚打开应用时 localRecords 还是 0，会误报「两边条数对不上」
  syncStat.localRecords = liveLocalCount();
  syncStat.pending = pendingCount();
  notify();
}

/* -------------------------------- 增删改 -------------------------------- */
function applyLocal(collection: CollectionName, id: string, data: unknown, keepDirty = false): Envelope {
  const existing = cache.get(key(collection, id));
  const env: Envelope = {
    collection,
    id,
    data,
    updatedAt: nextStamp(),
    deviceId: cfg.deviceId,
    deleted: 0,
    dirty: keepDirty ? (existing?.dirty ?? 1) : 1
  };
  cache.set(key(collection, id), env);
  return env;
}

const writeQueue: Envelope[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function queueWrite(env: Envelope) {
  writeQueue.push(env);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const batch = writeQueue.splice(0, writeQueue.length);
    idbPutMany(batch).catch((e) => console.warn('IndexedDB 写入失败', e));
  }, 30);
}

export function putRecord<T extends object>(collection: CollectionName, id: string, data: T): string {
  const env = applyLocal(collection, id, data);
  queueWrite(env);
  notify();
  scheduleAutoSync();
  return id;
}

/**
 * 把 list() 拿到的一条记录拆回「id + 纯数据」。
 * 删除后撤销要用它：原样写回同一条记录，不能把 id 也塞进 data 里。
 */
export function withoutId<T extends { id: string }>(item: T): Omit<T, 'id'> {
  const copy: Record<string, unknown> = { ...item };
  delete copy.id;
  return copy as Omit<T, 'id'>;
}

/** 局部更新：读取现有 data 后浅合并 */
export function patchRecord<T extends object>(collection: CollectionName, id: string, patch: Partial<T>): void {
  const cur = cache.get(key(collection, id));
  const base = (cur?.data as object) || {};
  putRecord(collection, id, { ...base, ...patch } as T);
}

export function removeRecord(collection: CollectionName, id: string): void {
  const cur = cache.get(key(collection, id));
  if (!cur) return;
  const env: Envelope = { ...cur, deleted: 1, updatedAt: nextStamp(), deviceId: cfg.deviceId, dirty: 1 };
  cache.set(key(collection, id), env);
  queueWrite(env);
  notify();
  scheduleAutoSync();
}

export function deleteHard(collection: CollectionName, id: string): void {
  // 仅用于本地「清空」场景，仍写墓碑保证其他设备删除
  removeRecord(collection, id);
}

/* -------------------------------- 同步引擎 -------------------------------- */
export type SyncState = 'idle' | 'syncing' | 'ok' | 'error' | 'offline';

/**
 * 同步状态。这里的每个数字都是「能验证的事实」，不是感觉：
 * 顶栏只说这些数字能证明的话，所以不会出现「显示已同步、其实没同步」。
 */
export const syncStat = {
  state: 'idle' as SyncState,
  lastSyncAt: 0,
  pending: 0,
  pushed: 0,
  pulled: 0,
  error: '',
  /** 服务器当前最大序号（电脑上最后一条改动的编号） */
  serverSeq: 0,
  /** 服务器上的活记录数 */
  serverRecords: 0,
  /** 本机的活记录数（墓碑不算） */
  localRecords: 0,
  /** 本机游标落后服务器多少条，0 = 已经追上 */
  behind: 0,
  /** 上次到底是连上了(1)还是根本连不上(0) —— 顶栏靠它说真话 */
  reachable: 0,
  /** 服务器库的唯一标识；变了说明换了电脑或重装了，得从头拉一遍 */
  dbId: '',
  /** 最近一次核对服务器状态的时间 */
  checkedAt: 0,
  /** 这次同步自动修过游标（服务器库被换过） */
  healed: 0,
  /** 除本机外，现在还有几台设备在线 */
  othersOnline: 0,
  /** 在线的其他设备里，有几台还没追上电脑（顶栏据此说真话） */
  othersBehind: 0
};

function bumpStat(patch: Partial<typeof syncStat>) {
  Object.assign(syncStat, patch);
  notify();
}

type PullResp = {
  records: Envelope[];
  cursor: number;
  hasMore: boolean;
  serverSeq?: number;
  dbId?: string;
  /** 本机游标比服务器末尾还大：服务器被换过/清过 */
  rewound?: boolean;
  recordsCount?: number;
};

export function pendingCount(): number {
  let n = 0;
  cache.forEach((e) => { if (e.dirty === 1) n++; });
  return n;
}

/** 本机活记录数（墓碑不算） */
function liveLocalCount(): number {
  let n = 0;
  cache.forEach((e) => { if (!e.deleted) n++; });
  return n;
}

/** 上次同步时服务器报的 dbId，用来发现「换了电脑 / 重装过」 */
let lastDbId = '';

function baseUrl(): string {
  return (cfg.serverUrl || '').replace(/\/+$/, '');
}

/** 把某个地址设为当前，并记进地址池（最多留 8 个，新的排前面） */
export async function rememberAddress(url: string): Promise<void> {
  const u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return;
  const rest = (cfg.serverUrls || []).filter((x) => x && x !== u);
  await saveConfig({ serverUrl: u, serverUrls: [u].concat(rest).slice(0, 8) });
}

/** 从地址池里删掉一个（当前正在用的不让删） */
export async function forgetAddress(url: string): Promise<void> {
  const u = String(url || '').trim().replace(/\/+$/, '');
  await saveConfig({ serverUrls: (cfg.serverUrls || []).filter((x) => x !== u) });
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.syncToken) headers['X-Sync-Token'] = cfg.syncToken;
  const url = baseUrl() + path;
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('HTTP ' + res.status + ' ' + txt.slice(0, 160));
  }
  return res.json();
}

let syncing = false;
let reSyncQueued = false;

async function syncOnce(reason: string): Promise<{ ok: boolean; message: string }> {
  if (syncing) {
    // 同步进行中：排队，等本轮结束后立刻再跑一次，避免改动被搁置到下一次心跳
    reSyncQueued = true;
    return { ok: false, message: t('正在同步中，已排队下一次') };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    bumpStat({ state: 'offline', error: t('设备离线') });
    return { ok: false, message: t('当前离线，已保存到本地，联网后自动同步') };
  }
  syncing = true;
  bumpStat({ state: 'syncing', error: '' });
  let pushed = 0, pulled = 0;
  const dir: SyncDir = cfg.syncDir === 'push' || cfg.syncDir === 'pull' ? cfg.syncDir : 'both';
  try {
    /* 1) 推送本地脏数据（「只接收」模式下不推） */
    const dirty = dir === 'pull' ? [] : await idbDirty();
    const sent = dirty.map((d) => ({ collection: d.collection, id: d.id, updatedAt: d.updatedAt }));
    if (dirty.length) {
      const payload = {
        deviceId: cfg.deviceId,
        deviceName: cfg.deviceName,
        platform: detectPlatform(),
        records: dirty.map((d) => ({
          collection: d.collection, id: d.id, data: d.data,
          updatedAt: d.updatedAt, deviceId: d.deviceId, deleted: !!d.deleted
        }))
      };
      // 分批，避免单次请求过大
      const CHUNK = 400;
      for (let i = 0; i < payload.records.length; i += CHUNK) {
        const part = { ...payload, records: payload.records.slice(i, i + CHUNK) };
        const r = (await api('/api/push', { method: 'POST', body: JSON.stringify(part) })) as { applied: number };
        pushed += r.applied || 0;
      }
    }

    /* 2) 拉取服务端增量（可能多页） */
    let cursor = cfg.lastPulledSeq || 0;
    if (!lastDbId) lastDbId = String(await metaGet('lastDbId', ''));
    const applied: Envelope[] = [];
    let serverSeq = 0, serverRecords = 0, dbId = '', healed = 0, rewoundTried = false;
    for (let guard = 0; guard < 200; guard++) {
      const q = '/api/pull?since=' + cursor + '&limit=1000&deviceId=' + encodeURIComponent(cfg.deviceId) +
        '&name=' + encodeURIComponent(cfg.deviceName) + '&platform=' + encodeURIComponent(detectPlatform());
      const r = (await api(q)) as PullResp;
      if (typeof r.serverSeq === 'number') serverSeq = r.serverSeq;
      if (typeof r.recordsCount === 'number') serverRecords = r.recordsCount;
      if (r.dbId) dbId = String(r.dbId);
      // 服务器库被换过（换电脑 / 重装 / 恢复备份 / 清过库）：本机游标可能比服务器
      // 末尾还大，那样 /api/pull 永远返回空 —— 两边都显示「已同步」，实际各存各的。
      // 服务端会把这种情况标成 rewound，这里归零从头拉一遍，一次修好。
      const changedDb = !!dbId && !!lastDbId && dbId !== lastDbId;
      if (!rewoundTried && (r.rewound === true || changedDb)) {
        rewoundTried = true;
        healed = 1;
        cursor = 0;
        cfg.lastPulledSeq = 0;
        await metaSet('lastPulledSeq', 0);
        continue;
      }
      for (const rec of r.records) {
        // 「只发送」模式：不把对方的改动拉回来，只把游标推过去，免得以后一开双向就涌回一堆旧数据
        if (dir === 'push') continue;
        const ck = key(rec.collection, rec.id);
        const local = cache.get(ck);
        const newer = !local || rec.updatedAt > local.updatedAt ||
          (rec.updatedAt === local.updatedAt && String(rec.deviceId) > String(local.deviceId));
        if (newer) {
          const env: Envelope = { ...rec, deleted: rec.deleted ? 1 : 0, dirty: 0 };
          cache.set(ck, env);
          applied.push(env);
          pulled++;
        }
      }
      cursor = r.cursor || cursor;
      if (!r.hasMore || !r.records.length) { if (r.records.length) cursor = r.cursor; break; }
    }
    if (dbId && dbId !== lastDbId) { lastDbId = dbId; await metaSet('lastDbId', dbId); }
    if (applied.length) await idbPutMany(applied);

    /* 3) 清除已确认推送的脏标记（仅当本地未被再次修改） */
    const clear: Envelope[] = [];
    for (const s of sent) {
      const cur = cache.get(key(s.collection, s.id));
      if (cur && cur.dirty === 1 && cur.updatedAt === s.updatedAt) {
        cur.dirty = 0;
        clear.push(cur);
      }
    }
    if (clear.length) await idbPutMany(clear);

    cfg.lastPulledSeq = cursor;
    cfg.lastSyncAt = Date.now();
    await metaSet('lastPulledSeq', cursor);
    await metaSet('lastSyncAt', cfg.lastSyncAt);

    bumpStat({
      state: 'ok', lastSyncAt: cfg.lastSyncAt, pushed, pulled, error: '',
      serverSeq, serverRecords, behind: Math.max(0, serverSeq - cursor),
      reachable: 1, dbId: dbId || syncStat.dbId, checkedAt: Date.now(), healed,
      localRecords: liveLocalCount()
    });
    notify();
    const message = dir === 'push'
      ? t('同步完成：上传 {pushed} 条，下载 {pulled} 条（只上传）', { pushed, pulled })
      : dir === 'pull'
        ? t('同步完成：上传 {pushed} 条，下载 {pulled} 条（只下载）', { pushed, pulled })
        : t('同步完成：上传 {pushed} 条，下载 {pulled} 条', { pushed, pulled });
    return { ok: true, message: healed ? message + t('（电脑那边的库换过了，已从头发重新拉取）') : message };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    cfg.lastError = msg;
    bumpStat({ state: 'error', error: msg, reachable: isNetworkError(msg) ? 0 : 1, checkedAt: Date.now() });
    return { ok: false, message: t('同步失败：{msg}（数据已安全保存在本地）', { msg }) };
  } finally {
    syncing = false;
    bumpStat({ pending: pendingCount(), localRecords: liveLocalCount() });
    // 同步途中又有改动：本轮结束后立刻补一次，别等到下一次心跳
    if (reSyncQueued) {
      reSyncQueued = false;
      setTimeout(() => { syncNow('queued'); }, 60);
    }
  }
}

let lastDiscoverAt = 0;
const DISCOVER_COOLDOWN = 45000;   // 别每 15 秒就扫一遍局域网，太费电

/**
 * 同步。
 *
 * 连不上时会在局域网里自动找一遍服务器：同步地址是一个局域网 IP，电脑换个 Wi-Fi
 * 就会变（192.168.10.249 → 192.168.1.7），手机里存的还是老地址，两边就会一直
 * 同步不上、而且看不出原因。找到新地址后自动改掉并重试一次。
 */
export async function syncNow(reason = 'manual'): Promise<{ ok: boolean; message: string }> {
  const first = await syncOnce(reason);
  if (first.ok) return first;
  if (!cfg.autoSync) return first;
  if (!isNetworkError(first.message)) return first;   // 服务端返回错误就不是地址问题

  // ① 先试地址池里的其他地址。
  //    同一台电脑在不同网络里地址不同（家里 192.168.10.x、学校 192.168.1.x），
  //    存过一次就不用再问用户，切换网络时自己就切过去了。
  const others = (cfg.serverUrls || []).filter((u) => u && u !== baseUrl());
  for (const u of others) {
    if (await probeUrl(u)) {
      await rememberAddress(u);
      const r = await syncOnce(reason);
      if (r.ok) return { ok: true, message: t('已自动切换到 {url} · {msg}', { url: u, msg: r.message }) };
    }
  }

  // ② 一个都不通，就扫局域网找（只有安卓端能扫：浏览器没有这个能力）
  if (!isNativeApp()) return first;
  const now = Date.now();
  if (now - lastDiscoverAt < DISCOVER_COOLDOWN) return first;
  lastDiscoverAt = now;

  bumpStat({ state: 'syncing', error: t('连不上，正在局域网里找服务器…') });
  const found = await discoverServer(portOf(cfg.serverUrl), cfg.serverUrl);
  if (!found || found.url === baseUrl()) return first;

  await saveConfig({ serverUrl: found.url });
  const retry = await syncOnce(reason);
  if (retry.ok) {
    return { ok: true, message: t('已自动找到服务器 {url}（扫了 {scanned} 台，试了 {tried} 台）· {msg}', { url: found.url, scanned: found.scanned, tried: found.tried, msg: retry.message }) };
  }
  return retry;
}

/* ------------------------- 连接体检 · 一键重连 ------------------------- */

/** 只问电脑一句「你现在怎么样」，不动任何数据 */
export async function serverHealth(): Promise<HealthInfo> {
  const h = await healthOf(baseUrl());
  const cursor = cfg.lastPulledSeq || 0;
  if (h.ok) {
    bumpStat({
      reachable: 1, checkedAt: Date.now(), localRecords: liveLocalCount(),
      serverSeq: h.seq, serverRecords: h.records, dbId: h.dbId || syncStat.dbId,
      behind: Math.max(0, h.seq - cursor)
    });
  } else {
    bumpStat({ reachable: 0, checkedAt: Date.now(), localRecords: liveLocalCount() });
  }
  return h;
}

export interface RepairResult {
  ok: boolean;
  message: string;
  url: string;
  via: 'direct' | 'pool' | 'beacon' | 'scan' | 'none';
}

/**
 * 一键重连 —— 给「不懂网络的小白」的那一个按钮。
 *
 * 顺序：现在的地址 → 地址池里存过的地址 → 局域网广播 → 逐台扫描。
 * 找到就改地址并立刻同步一次；一个都不通，就把原因说成人话（谁的网没连、
 * 电脑上的时序是不是关着），而不是丢一个 Failed to fetch。
 */
export async function repairConnection(): Promise<RepairResult> {
  if (syncing) return { ok: false, message: t('正在同步中，稍等一下再试'), url: baseUrl(), via: 'none' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    bumpStat({ state: 'offline', error: t('设备离线'), reachable: 0, checkedAt: Date.now() });
    return { ok: false, message: t('这台设备现在没有网络：连上 Wi-Fi 再点一次'), url: baseUrl(), via: 'none' };
  }

  // ① 现在的地址还好用就直接同步，别乱换地址
  const here = await healthOf(baseUrl());
  if (here.ok) {
    bumpStat({ reachable: 1, checkedAt: Date.now(), serverSeq: here.seq, serverRecords: here.records, dbId: here.dbId || syncStat.dbId });
    const r = await syncOnce('repair');
    return { ok: r.ok, message: r.message, url: baseUrl(), via: 'direct' };
  }

  // ② 地址池里存过的别的地址（同一台电脑在不同 Wi-Fi 下地址不同）
  for (const u of (cfg.serverUrls || [])) {
    if (!u || u === baseUrl()) continue;
    const h = await healthOf(u);
    if (!h.ok) continue;
    await rememberAddress(u);
    const r = await syncOnce('repair');
    bumpStat({ reachable: 1, checkedAt: Date.now(), serverSeq: h.seq, serverRecords: h.records });
    return { ok: r.ok, message: t('已自动切换到 {url} · {msg}', { url: u, msg: r.message }), url: u, via: 'pool' };
  }

  // ③ 局域网里找一遍（不看冷却时间：这是用户自己点的）
  if (isNativeApp()) {
    bumpStat({ state: 'syncing', error: t('连不上，正在局域网里找服务器…') });
    const d = await discoverServerDetailed(portOf(cfg.serverUrl), cfg.serverUrl);
    const via: RepairResult['via'] = d.via === 'beacon' ? 'beacon' : 'scan';
    if (d.ok) {
      await rememberAddress(d.url);
      const r = await syncOnce('repair');
      return {
        ok: r.ok,
        message: t('已自动找到服务器 {url}（扫了 {scanned} 台，试了 {tried} 台）· {msg}', { url: d.url, scanned: d.scanned, tried: d.tried, msg: r.message }),
        url: d.url, via
      };
    }
    bumpStat({ state: 'error', error: d.error || t('连不上电脑'), reachable: 0, checkedAt: Date.now() });
    return { ok: false, message: describeDiscovery(d), url: '', via };
  }

  bumpStat({ state: 'error', error: here.error || t('连不上电脑'), reachable: 0, checkedAt: Date.now() });
  return { ok: false, message: here.error || t('连不上电脑'), url: '', via: 'none' };
}

/**
 * 「以电脑为准重新对齐」：游标清零，然后把电脑上的数据整份拉回来覆盖本机。
 * 用在两边长期各存各的、逐条比时间已经说不清谁对的情况。
 */
export async function realignFromServer(): Promise<{ ok: boolean; message: string }> {
  await resetCursor();
  return syncForce('pull');
}

/* ------------------------------ 设备体检 ------------------------------ */

export interface ServerDevice {
  id: string;
  name: string;
  platform: string;
  online: boolean;
  lastSeenAt: number;
  /** 这台设备上次拉取时问的游标（-1 = 从没拉过） */
  lastSince: number;
  /** 这台设备上次拉取后到达的游标（-1 = 从没拉过） */
  lastGiven: number;
  /** 游标跑到服务器前面了：它拿不到新数据，需要重新对齐 */
  ahead: boolean;
  /** 服务器上还有多少条它没拉走（-1 = 不知道） */
  behindBy: number;
  pushCount: number;
  pullCount: number;
  self: boolean;
}

export interface DevicesReport {
  ok: boolean;
  error: string;
  dbId: string;
  serverSeq: number;
  records: number;
  tombstones: number;
  now: number;
  devices: ServerDevice[];
}

/** 服务器上登记过的设备：谁在线、谁落后、谁的游标跑到了服务器前面 */
export async function serverDevices(): Promise<DevicesReport> {
  const empty: DevicesReport = { ok: false, error: '', dbId: '', serverSeq: 0, records: 0, tombstones: 0, now: Date.now(), devices: [] };
  try {
    const j = (await api('/api/devices')) as {
      ok?: boolean; now?: number; dbId?: string; serverSeq?: number;
      records?: number; tombstones?: number; devices?: Array<Record<string, unknown>>;
    };
    const devices: ServerDevice[] = (Array.isArray(j.devices) ? j.devices : []).map((d) => {
      const id = String(d.id || '');
      return {
        id,
        name: String(d.name || id.slice(0, 8)),
        platform: String(d.platform || ''),
        online: d.online === true,
        lastSeenAt: Number(d.last_seen) || 0,
        lastSince: d.last_since == null ? -1 : Number(d.last_since),
        lastGiven: d.last_given == null ? -1 : Number(d.last_given),
        ahead: d.ahead === true,
        behindBy: d.behindBy == null ? -1 : Number(d.behindBy),
        pushCount: Number(d.push_count) || 0,
        pullCount: Number(d.pull_count) || 0,
        self: id === cfg.deviceId
      };
    });
    return {
      ok: true, error: '', now: Number(j.now) || Date.now(), dbId: String(j.dbId || ''),
      serverSeq: Number(j.serverSeq) || 0, records: Number(j.records) || 0,
      tombstones: Number(j.tombstones) || 0, devices
    };
  } catch (e) {
    return { ...empty, error: String((e as Error)?.message || e) };
  }
}

/** 刷新设备列表，顺手把「有没有别的设备正落后」记进 syncStat（顶栏要用） */
export async function refreshDevices(): Promise<DevicesReport> {
  const r = await serverDevices();
  if (r.ok) {
    let online = 0, behind = 0;
    for (const d of r.devices) {
      if (d.self) continue;
      if (!d.online) continue;
      online++;
      if (d.behindBy > 0 || d.ahead) behind++;
    }
    bumpStat({
      othersOnline: online, othersBehind: behind, checkedAt: Date.now(),
      serverSeq: r.serverSeq, serverRecords: r.records, dbId: r.dbId || syncStat.dbId
    });
  }
  return r;
}

/* ------------------------------ 顶栏那句话 ------------------------------ */

export type SyncVerdictKind =
  | 'syncing'      // 正在同步
  | 'unreachable'  // 根本连不上电脑
  | 'failed'       // 连上了，但服务器回了错
  | 'pending'      // 连上了，本机有改动还没传上去
  | 'drift'        // 连上了、也没待传，但两边条数对不上 —— 以前的「假同步」就藏在这里
  | 'others'       // 本机没问题，别的设备落后
  | 'ok'
  | 'idle';        // 还没同步过

export interface SyncVerdict {
  kind: SyncVerdictKind;
  text: string;
  cls: '' | 'ok' | 'error' | 'syncing' | 'offline';
  /** 两边条数不一致。顶栏、设置页、测试都读这一个判断，不各算一遍 */
  drift: boolean;
}

/**
 * 顶栏那句「已同步」到底能不能说，由这里统一决定。
 *
 * 以前各页面各写各的，只看 state==='ok' —— 电脑端连的是自己这台服务器，
 * 永远是 ok，于是手机能不能连上它都显示已同步。现在只要有任何一个数字
 * 对不上，就说对不上的那件事。
 */
export function syncVerdict(): SyncVerdict {
  const pending = pendingCount();
  const drift =
    cfg.syncDir === 'both' && syncStat.reachable === 1 && pending === 0 &&
    (syncStat.localRecords > 0 || syncStat.serverRecords > 0) &&
    syncStat.localRecords !== syncStat.serverRecords;
  const base = { drift } as Pick<SyncVerdict, 'drift'>;
  if (syncStat.state === 'syncing') return { ...base, kind: 'syncing', cls: 'syncing', text: t('同步中…') };
  const checked = syncStat.checkedAt > 0 || !!syncStat.lastSyncAt;
  if (checked && syncStat.reachable === 0) return { ...base, kind: 'unreachable', cls: 'error', text: t('离线 · 已存本地') };
  if (syncStat.state === 'error' && syncStat.reachable === 1) return { ...base, kind: 'failed', cls: 'error', text: t('同步失败 · 已存本地') };
  if (pending > 0) return { ...base, kind: 'pending', cls: 'syncing', text: t('待上传 {n} 条', { n: pending }) };
  if (drift) return { ...base, kind: 'drift', cls: 'offline', text: t('两边条数对不上 · 点我重连') };
  // 设备列表每 30 秒刷一次；超过 3 分钟没刷新就别拿旧数字下结论，
  // 否则网络断一下、/api/devices 失败一次，顶栏会一直挂着「有 N 台设备没跟上」。
  const freshOthers = syncStat.othersBehind > 0 && Date.now() - syncStat.checkedAt < 180000;
  if (freshOthers) return { ...base, kind: 'others', cls: 'offline', text: t('有 {n} 台设备没跟上', { n: syncStat.othersBehind }) };
  if (syncStat.lastSyncAt) return { ...base, kind: 'ok', cls: 'ok', text: t('已同步') };
  return { ...base, kind: 'idle', cls: '', text: t('点击同步') };
}

/* ------------------------------------------------------------------ */
/* 单向同步：以哪一边为准的一次性裁决                                    */
/* ------------------------------------------------------------------ */

/** 从服务器从头把全部记录拉下来并按服务端为准覆盖本机（含墓碑）。 */
async function pullAll(): Promise<{ pulled: number; cleared: number }> {
  let cursor = 0;
  let n = 0;
  const seen = new Set<string>();
  for (let guard = 0; guard < 500; guard++) {
    const q = '/api/pull?since=' + cursor + '&limit=1000&deviceId=' + encodeURIComponent(cfg.deviceId) +
      '&name=' + encodeURIComponent(cfg.deviceName) + '&platform=' + encodeURIComponent(detectPlatform());
    const r = (await api(q)) as { records: Envelope[]; cursor: number; hasMore: boolean };
    const envs: Envelope[] = r.records.map((rec) => ({ ...rec, deleted: rec.deleted ? 1 : 0, dirty: 0 }));
    for (const e of envs) { cache.set(key(e.collection, e.id), e); seen.add(key(e.collection, e.id)); }
    if (envs.length) await idbPutMany(envs);
    n += envs.length;
    cursor = r.cursor || cursor;
    if (!r.hasMore) break;
  }
  // 「以对方为准」要真的以对方为准：服务器上没有的记录（本机独有、从没上传过的），
  // 覆盖后不该在下次同步时又推回服务器，把"覆盖率"打折。
  const ghosts: Array<{ collection: CollectionName; id: string }> = [];
  for (const e of Array.from(cache.values())) {
    if (!seen.has(key(e.collection, e.id))) ghosts.push({ collection: e.collection, id: e.id });
  }
  for (const g of ghosts) cache.delete(key(g.collection, g.id));
  if (ghosts.length) await idbDeleteMany(ghosts);
  cfg.lastPulledSeq = cursor;
  await metaSet('lastPulledSeq', cursor);
  return { pulled: n, cleared: ghosts.length };
}

/**
 * 手动「以本机为准」或「以对方为准」把两边对齐一次。
 *
 * 日常同步是逐条比 updatedAt；但两边长期错开时（比如手机一个月没连上，同名记录
 * 的时间戳各不相同），逐条比较的结果往往不是用户直觉里的那个。所以另给一个明确的
 * 裁决：push = 本机全部记录盖一遍新时间戳推上去；pull = 服务器数据直接覆盖本机。
 * 只在这一次生效，做完把 syncDir 还给用户。
 */
export async function syncForce(kind: 'push' | 'pull'): Promise<{ ok: boolean; message: string }> {
  if (syncing) return { ok: false, message: t('正在同步中，稍等一下再试') };
  // 电脑端网页版是从服务本身打开的，serverUrl 可以留空（相对路径就是它自己），
  // 所以只在原生端（手机 App 必然要显式填地址）才拦。
  if (!baseUrl() && isNativeApp()) return { ok: false, message: t('还没填服务器地址，先填电脑上显示的地址') };
  const old: SyncDir = cfg.syncDir;
  try {
    if (kind === 'push') {
      // 每条都改成"刚刚改过"，让对方按 LWW 全部接受；留出 1ms 间隔，免得同毫秒时靠 deviceId 决定胜负
      const stamp = Date.now();
      const all = Array.from(cache.values());
      const stamped: Envelope[] = [];
      let i = 0;
      for (const e of all) {
        e.updatedAt = stamp + i;
        e.deviceId = cfg.deviceId;
        e.dirty = 1;
        i++;
        stamped.push(e);
      }
      if (stamped.length) await idbPutMany(stamped);
      notify();
      cfg.syncDir = 'push';
      const r = await syncOnce('force-push');
      return r.ok ? { ok: true, message: t('已用这台设备的数据覆盖对方：{msg}', { msg: r.message }) } : r;
    }
    const got = await pullAll();
    cfg.lastSyncAt = Date.now();
    await metaSet('lastSyncAt', cfg.lastSyncAt);
    bumpStat({ state: 'ok', lastSyncAt: cfg.lastSyncAt, pushed: 0, pulled: got.pulled, error: '' });
    notify();
    return {
      ok: true,
      message: got.cleared
        ? t('已用对方的数据覆盖本机：拉回 {pulled} 条，清掉本机独有 {cleared} 条', { pulled: got.pulled, cleared: got.cleared })
        : t('已用对方的数据覆盖本机：拉回 {pulled} 条', { pulled: got.pulled })
    };
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    bumpStat({ state: 'error', error: msg });
    return { ok: false, message: t('覆盖失败：{msg}', { msg }) };
  } finally {
    cfg.syncDir = old;
    void saveConfig({ syncDir: old });
    bumpStat({ pending: pendingCount() });
  }
}

let autoTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleAutoSync(delay = 1500) {
  if (!cfg.autoSync) return;
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => { autoTimer = null; syncNow('auto'); }, delay);
}

export function startBackgroundSync(): () => void {
  const onOnline = () => { syncNow('online'); };
  const onVisible = () => { if (document.visibilityState === 'visible') syncNow('visible'); };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const iv = setInterval(() => { if (navigator.onLine !== false) syncNow('interval'); }, 60000);
  syncNow('startup');
  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(iv);
  };
}

/* --------------------------- 备份 / 恢复 / 维护 --------------------------- */
export async function exportLocal(): Promise<string> {
  const rows = await idbAll();
  return JSON.stringify({
    app: 'schedule-app', version: 1, exportedAt: new Date().toISOString(),
    deviceId: cfg.deviceId, records: rows
  }, null, 2);
}

export async function importLocal(json: string, mode: 'merge' | 'replace'): Promise<number> {
  const parsed = JSON.parse(json);
  const rows: Envelope[] = Array.isArray(parsed) ? parsed : parsed.records || [];
  if (mode === 'replace') { await idbClearAll(); cache.clear(); }
  if (!rows.length) return 0;
  const batch: Envelope[] = [];
  if (mode === 'replace') {
    // 整体导入：视为本设备的新写入，以便推送到服务端
    for (const r of rows) {
      const env: Envelope = {
        collection: r.collection, id: r.id, data: r.data,
        updatedAt: nextStamp(), deviceId: cfg.deviceId, deleted: r.deleted ? 1 : 0, dirty: 1
      };
      cache.set(key(env.collection, env.id), env);
      batch.push(env);
    }
  } else {
    for (const r of rows) {
      const ck = key(r.collection, r.id);
      const local = cache.get(ck);
      const newer = !local || r.updatedAt > local.updatedAt ||
        (r.updatedAt === local.updatedAt && String(r.deviceId) > String(local.deviceId));
      if (!newer) continue;
      const env: Envelope = {
        collection: r.collection, id: r.id, data: r.data,
        updatedAt: nextStamp(), deviceId: cfg.deviceId, deleted: r.deleted ? 1 : 0, dirty: 1
      };
      cache.set(ck, env);
      batch.push(env);
    }
  }
  await idbPutMany(batch);
  notify();
  return batch.length;
}

/** 重置增量游标：下次同步将重新拉取服务端全量数据 */
export async function resetCursor(): Promise<void> {
  cfg.lastPulledSeq = 0;
  await metaSet('lastPulledSeq', 0);
  notify();
}

export async function wipeLocal(): Promise<void> {
  await idbClearAll();
  cache.clear();
  cfg.lastPulledSeq = 0;
  await metaSet('lastPulledSeq', 0);
  notify();
}

/** 调试/自动化钩子：在浏览器控制台可直接查看与驱动同步 */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__schedule = {
    cfg, syncStat, pendingCount, syncNow, syncForce, list, dbStats, exportLocal, importLocal, resetCursor,
    serverHealth, repairConnection, realignFromServer, serverDevices, refreshDevices, syncVerdict,
    loadAll, putRecord, patchRecord, removeRecord, newId,
    appearance: {
      get: getAppearance, save: saveAppearance, legibility: currentLegibility,
      accent: accentFor, profile: profileFor, frozen: currentFrozen
    },
    // 返回键 / 侧滑：网页里没有返回键，但逻辑一样跑，测试和调试可以手动按一下
    back: { press: pressBack, stats: backStats, reset: resetBackState },
    // 二级页面：测试可以直接跳到某一页，不用一路点进去
    ui: { settingsPage, openSettingsPage },
    font: getFontStatus,
    // 语言：测试可以直接切语言并读回没翻译的原文
    i18n: { get: getLang, set: setLang, missing: missingKeys, langs: LANGS }
  };
}

export function dbStats() {
  const byCollection: Record<string, number> = {};
  let tombstones = 0, total = 0;
  cache.forEach((e) => {
    total++;
    if (e.deleted) { tombstones++; return; }
    byCollection[e.collection] = (byCollection[e.collection] || 0) + 1;
  });
  return { total, tombstones, byCollection, cached: cache.size };
}
