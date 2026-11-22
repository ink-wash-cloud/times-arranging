// 在同一局域网里找时序服务器。
//
// 为什么需要：同步地址是一个局域网 IP，电脑换一个 Wi-Fi 就会变（192.168.10.249
// 变成 192.168.1.7 之类），而手机里存的还是老地址，于是两边静悄悄地再也同步不上。
//
// 做法：让安卓侧扫一遍本机所在的 /24 网段（只探端口），再把应答的主机逐个问
// /api/health，确认真的是时序服务。找到就由调用方把地址改掉。
//
// 除了"找到/没找到"，这里还把过程留成 DiscoveryReport：扫了多少台、试了哪些
// 地址、每个为什么失败。设置页据此说人话（"扫了 254 台都没响应：电脑上的
// 时序是不是关着？"），而不是只丢一个 Failed to fetch。
import { isNativeApp } from './native';
import { getLang, t } from './i18n';

export interface ScanResult { self: string; prefix: string; hosts: string[]; scanned?: number }

/** /24 网段一共 254 个可用主机（安卓插件就是逐个试这 254 个） */
export const LAN_HOST_COUNT = 254;

type ScanPlugin = { scan?: (opts: Record<string, unknown>) => Promise<ScanResult> };

function scanPlugin(): ScanPlugin | null {
  const c = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const p = c && c.Plugins ? (c.Plugins.LanScan as ScanPlugin | undefined) : undefined;
  return p && typeof p.scan === 'function' ? p : null;
}

/* ------------------------------ 扫描细节 ------------------------------ */

export type ScanFailure = 'ok' | 'not-native' | 'no-plugin' | 'scan-error' | 'bad-result';

export interface ScanDetail {
  scan: ScanResult | null;
  /** 失败原因，人话；成功时为空串 */
  error: string;
  failure: ScanFailure;
  tookMs: number;
}

/** 扫描本机所在网段，连同失败原因一起返回（设置页要拿它做诊断） */
export async function scanLanDetailed(port: number, timeoutMs = 350): Promise<ScanDetail> {
  const t0 = Date.now();
  if (!isNativeApp()) {
    return { scan: null, error: t('网页版没有局域网扫描能力'), failure: 'not-native', tookMs: 0 };
  }
  const p = scanPlugin();
  if (!p || !p.scan) {
    return { scan: null, error: t('这个安装包不支持局域网扫描'), failure: 'no-plugin', tookMs: 0 };
  }
  try {
    const r = await p.scan({ port: port, timeoutMs: timeoutMs });
    if (!r || !Array.isArray(r.hosts)) {
      return { scan: null, error: t('扫描没有返回结果'), failure: 'bad-result', tookMs: Date.now() - t0 };
    }
    return { scan: r, error: '', failure: 'ok', tookMs: Date.now() - t0 };
  } catch (e) {
    const msg = String((e as { message?: string }) && (e as { message?: string }).message || e || t('扫描失败'));
    return { scan: null, error: msg, failure: 'scan-error', tookMs: Date.now() - t0 };
  }
}

/** 扫描本机所在网段，返回开着这个端口的主机。非安卓端返回 null。 */
export async function scanLan(port: number, timeoutMs = 350): Promise<ScanResult | null> {
  const d = await scanLanDetailed(port, timeoutMs);
  return d.scan;
}

/* --------------------------- 广播发现（快路径） --------------------------- */

/**
 * 服务端的 UDP 信标端口（和 server/index.mjs 的 BEACON_PORT 一致）。
 *
 * 为什么要有：挨个扫 254 台要 3～8 秒，而且换个 Wi-Fi 就容易落空。服务端每 3 秒
 * 往局域网广播一次"我在这个地址"，手机发一个空包也能立刻收到回应 —— 通常 1 次
 * 往返（几十毫秒）就找到电脑，扫网段只在没广播时兜底。
 */
export const BEACON_PORT = 8799;

export interface BeaconHit { url: string; host: string; port: number; seq: number; dbId: string }

export type BeaconFailure = 'ok' | 'not-native' | 'no-plugin' | 'bad-result' | 'error' | 'empty';

export interface BeaconDetail {
  hits: BeaconHit[];
  failure: BeaconFailure;
  /** 失败原因，人话；成功时为空串 */
  error: string;
  tookMs: number;
  self: string;
}

type RawHit = { url?: string; host?: string; port?: number; seq?: number; dbId?: string };
type BeaconPlugin = {
  discover?: (opts: Record<string, unknown>) => Promise<{ self?: string; found?: RawHit[] }>;
};

function beaconPlugin(): BeaconPlugin | null {
  const c = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const p = c && c.Plugins ? (c.Plugins.LanBeacon as BeaconPlugin | undefined) : undefined;
  return p && typeof p.discover === 'function' ? p : null;
}

/** 发一次广播、收回应答。找不到也正常返回（hits 为空 + 原因） */
export async function beaconScanDetailed(port = BEACON_PORT, timeoutMs = 1200): Promise<BeaconDetail> {
  const t0 = Date.now();
  if (!isNativeApp()) {
    return { hits: [], failure: 'not-native', error: t('网页版没有局域网广播能力'), tookMs: 0, self: '' };
  }
  const p = beaconPlugin();
  if (!p || !p.discover) {
    return { hits: [], failure: 'no-plugin', error: t('这个安装包不支持局域网自动发现'), tookMs: 0, self: '' };
  }
  try {
    const r = await p.discover({ port: port, timeoutMs: timeoutMs });
    const raw = r && Array.isArray(r.found) ? r.found : [];
    if (r && r.found !== undefined && !Array.isArray(r.found)) {
      return { hits: [], failure: 'bad-result', error: t('广播没有返回结果'), tookMs: Date.now() - t0, self: '' };
    }
    const hits: BeaconHit[] = [];
    const seen: Record<string, boolean> = {};
    for (const h of raw) {
      const host = String(h.host || hostOf(String(h.url || ''))).trim();
      const hp = Number(h.port) > 0 ? Number(h.port) : portOf(String(h.url || ''), 8787);
      let url = String(h.url || '').trim();
      if (!/^https?:\/\//i.test(url)) url = host ? 'http://' + host + ':' + hp : '';
      url = trimSlash(url);
      if (!url || seen[url]) continue;
      seen[url] = true;
      hits.push({ url, host: host || hostOf(url), port: hp, seq: Number(h.seq) || 0, dbId: String(h.dbId || '') });
    }
    return {
      hits, failure: hits.length ? 'ok' : 'empty',
      error: hits.length ? '' : t('没收到电脑的广播：手机和电脑可能不在同一个 Wi-Fi'),
      tookMs: Date.now() - t0,
      self: String((r && r.self) || '')
    };
  } catch (e) {
    const msg = String((e as { message?: string }) && (e as { message?: string }).message || e || t('广播失败'));
    return { hits: [], failure: 'error', error: msg, tookMs: Date.now() - t0, self: '' };
  }
}

/* ------------------------------ 探测细节 ------------------------------ */

/** 带超时的 fetch：老一点的 WebView 没有 AbortSignal.timeout，自己包一层 */
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(function () { try { if (ctl) ctl.abort(); } catch (e) { /* 忽略 */ } }, ms);
  try {
    return await fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
  } finally {
    clearTimeout(timer);
  }
}

/** 去掉结尾的斜杠 */
function trimSlash(url: string): string {
  let u = String(url || '').trim();
  while (u.length > 0 && u.charAt(u.length - 1) === '/') u = u.slice(0, -1);
  return u;
}

export interface ProbeResult { ok: boolean; url: string; ms: number; error: string }

/** 问一次 /api/health，带"为什么失败"的说明 */
export async function probeUrlDetailed(url: string, ms = 1500): Promise<ProbeResult> {
  const base = trimSlash(url);
  if (!base) return { ok: false, url: '', ms: 0, error: t('地址为空') };
  const t0 = Date.now();
  try {
    const r = await fetchWithTimeout(base + '/api/health', ms);
    if (!r.ok) return { ok: false, url: base, ms: Date.now() - t0, error: t('HTTP {status}（端口开着，但不是时序服务）', { status: r.status }) };
    const j = (await r.json()) as { ok?: boolean; seq?: number };
    if (!(j && j.ok === true && typeof j.seq === 'number')) {
      return { ok: false, url: base, ms: Date.now() - t0, error: t('这个端口上不是时序的同步服务') };
    }
    return { ok: true, url: base, ms: Date.now() - t0, error: '' };
  } catch (e) {
    const raw = String((e as { message?: string }) && (e as { message?: string }).message || e || '');
    const timeout = /abort|timeout|timed out/i.test(raw);
    return { ok: false, url: base, ms: Date.now() - t0, error: timeout ? t('超时没有响应（{ms}ms）', { ms }) : (raw || t('连不上')) };
  }
}

export interface HealthInfo {
  ok: boolean;
  url: string;
  ms: number;
  error: string;
  /** 服务器当前最大序号 */
  seq: number;
  /** 服务器上的活记录数（已删除的不算） */
  records: number;
  tombstones: number;
  /** 服务器库的唯一标识：换电脑/重装/恢复备份之后它会变 */
  dbId: string;
  /** 服务端 UDP 信标端口，0 表示没开 */
  beacon: number;
}

/**
 * 问一次 /api/health，把内容带回来（连不上也正常返回，不抛异常）。
 * url 传空串表示「和页面同源」—— 电脑端就是这样，服务就在自己身上。
 */
export async function healthOf(url: string, ms = 2500): Promise<HealthInfo> {
  const base = trimSlash(url);
  const target = base ? base + '/api/health' : '/api/health';
  const t0 = Date.now();
  const fail = function (error: string): HealthInfo {
    return { ok: false, url: base, ms: Date.now() - t0, error: error, seq: 0, records: 0, tombstones: 0, dbId: '', beacon: 0 };
  };
  try {
    const r = await fetchWithTimeout(target, ms);
    if (!r.ok) return fail(t('HTTP {status}（端口开着，但不是时序服务）', { status: r.status }));
    const j = (await r.json()) as { ok?: boolean; seq?: number; records?: number; tombstones?: number; dbId?: string; beacon?: number };
    if (!(j && j.ok === true && typeof j.seq === 'number')) return fail(t('这个端口上不是时序的同步服务'));
    return {
      ok: true, url: base, ms: Date.now() - t0, error: '',
      seq: Number(j.seq) || 0,
      records: Number(j.records) || 0,
      tombstones: Number(j.tombstones) || 0,
      dbId: String(j.dbId || ''),
      beacon: Number(j.beacon) || 0
    };
  } catch (e) {
    const raw = String((e as { message?: string }) && (e as { message?: string }).message || e || '');
    const timeout = /abort|timeout|timed out/i.test(raw);
    return fail(timeout ? t('超时没有响应（{ms}ms）', { ms }) : (raw || t('连不上')));
  }
}

/** 这个地址上是不是时序的同步服务 */
export async function probeUrl(url: string, ms = 1500): Promise<boolean> {
  return (await probeUrlDetailed(url, ms)).ok;
}

export async function probeServer(host: string, port: number, ms = 1500): Promise<boolean> {
  return probeUrl('http://' + host + ':' + port, ms);
}

/* ------------------------------ 一次发现 ------------------------------ */

export interface DiscoveryAttempt { url: string; host: string; ok: boolean; ms: number; error: string }

export type DiscoveryFailure =
  | 'ok' | 'not-native' | 'no-plugin' | 'scan-error' | 'bad-result'
  | 'no-hosts' | 'all-rejected';

export interface DiscoveryReport {
  ok: boolean;
  url: string;
  self: string;
  prefix: string;
  /** 这次一共探了多少台（/24 就是 254） */
  scanned: number;
  /** 挨个请求 /api/health 的台数 */
  tried: number;
  /** 扫到几台「开着这个端口」 */
  hosts: number;
  attempts: DiscoveryAttempt[];
  failure: DiscoveryFailure;
  /** 失败原因，人话 */
  error: string;
  port: number;
  scanMs: number;
  elapsedMs: number;
  /** 怎么找到的：广播（快）还是逐台扫描（慢） */
  via: 'beacon' | 'scan' | 'none';
  /** 广播这轮花了多久 */
  beaconMs: number;
  /** 广播收到了几台电脑 */
  beaconHits: number;
}

let last: DiscoveryReport | null = null;

/** 最近一次局域网发现的结果（设置页刷新后还能把诊断文案接上） */
export function lastDiscovery(): DiscoveryReport | null { return last; }

/** 把 http://host:port/path 里的主机名抠出来 */
function hostOf(url: string): string {
  return String(url || '').replace('https://', '').replace('http://', '').split(':')[0].split('/')[0];
}

function sortHosts(hosts: string[], want: string): string[] {
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  for (const h of hosts) {
    const s = String(h || '').trim();
    if (!s || seen[s]) continue;
    seen[s] = true;
    out.push(s);
  }
  out.sort(function (a, b) {
    const na = Number(a.split('.').pop()) || 0;
    const nb = Number(b.split('.').pop()) || 0;
    return na - nb || a.localeCompare(b);
  });
  if (want) {
    const i = out.indexOf(want);
    if (i > 0) { out.splice(i, 1); out.unshift(want); }
  }
  return out;
}

/**
 * 扫一遍再逐个确认，返回完整过程。
 * @param port   同步服务端口
 * @param prefer 当前配置里那个地址 —— 它还在的话优先试，省得来回跳
 */
export async function discoverServerDetailed(port: number, prefer = ''): Promise<DiscoveryReport> {
  const t0 = Date.now();

  /* ① 先听广播：服务端每 3 秒喊一次，通常一次往返就找到，比扫 254 台快几十倍 */
  const b = await beaconScanDetailed();
  const attempts: DiscoveryAttempt[] = [];
  const cands: string[] = [];
  const seenUrl: Record<string, boolean> = {};
  for (const h of b.hits) {
    if (!seenUrl[h.url]) { seenUrl[h.url] = true; cands.push(h.url); }
  }
  const want = trimSlash(prefer);
  if (want && seenUrl[want]) {
    const i = cands.indexOf(want);
    if (i > 0) { cands.splice(i, 1); cands.unshift(want); }
  }
  const base: DiscoveryReport = {
    ok: false, url: '', self: b.self, prefix: '',
    scanned: 0, tried: 0, hosts: cands.length, attempts: attempts,
    failure: 'ok', error: '', port,
    scanMs: b.tookMs, elapsedMs: 0,
    via: 'none', beaconMs: b.tookMs, beaconHits: b.hits.length
  };
  for (const url of cands) {
    const r = await probeUrlDetailed(url);
    attempts.push({ url, host: hostOf(url), ok: r.ok, ms: r.ms, error: r.error });
    if (r.ok) {
      const rep: DiscoveryReport = {
        ...base,
        ok: true, url, self: b.self || hostOf(url),
        tried: attempts.length, failure: 'ok', error: '',
        elapsedMs: Date.now() - t0, via: 'beacon'
      };
      last = rep;
      return rep;
    }
  }
  /* 广播里那台没应答（可能刚关掉）：接着逐台扫，别只信广播 */

  /* ② 退回逐台扫描 */
  const d = await scanLanDetailed(port);
  const scanBase: DiscoveryReport = { ...base, via: 'scan', scanned: 0, scanMs: d.tookMs };
  if (!d.scan) {
    const rep: DiscoveryReport = {
      ...scanBase,
      tried: attempts.length,
      failure: d.failure === 'not-native' || d.failure === 'no-plugin' || d.failure === 'bad-result' ? d.failure : 'scan-error',
      // 广播也没人应，扫描也做不了：给广播的理由更贴切（多半是没连同一个 Wi-Fi）
      error: b.failure === 'empty' || b.failure === 'error' ? b.error : d.error,
      self: b.self || '',
      elapsedMs: Date.now() - t0
    };
    last = rep;
    return rep;
  }
  const scan = d.scan;
  const scanned = Number(scan.scanned) > 0 ? Number(scan.scanned) : LAN_HOST_COUNT;
  const hosts = sortHosts(scan.hosts || [], hostOf(prefer));
  if (!hosts.length) {
    const rep: DiscoveryReport = {
      ...scanBase,
      scanned,
      tried: attempts.length,
      failure: 'no-hosts',
      error: t('扫了 {n} 台都没响应', { n: scanned }),
      self: String(scan.self || b.self || ''), prefix: String(scan.prefix || ''),
      elapsedMs: Date.now() - t0
    };
    last = rep;
    return rep;
  }
  for (const h of hosts) {
    const url = 'http://' + h + ':' + port;
    const r = await probeUrlDetailed(url);
    attempts.push({ url, host: h, ok: r.ok, ms: r.ms, error: r.error });
    if (r.ok) {
      const rep: DiscoveryReport = {
        ...scanBase,
        ok: true, url, self: String(scan.self || b.self || ''), prefix: String(scan.prefix || ''),
        scanned, tried: attempts.length, hosts: hosts.length, attempts,
        failure: 'ok', error: '',
        elapsedMs: Date.now() - t0
      };
      last = rep;
      return rep;
    }
  }
  const rep: DiscoveryReport = {
    ...scanBase,
    scanned, tried: attempts.length, hosts: hosts.length, attempts,
    failure: 'all-rejected',
    error: t('扫到 {hosts} 台开着 {port} 端口的设备，但都不是时序', { hosts: hosts.length, port }),
    self: String(scan.self || b.self || ''), prefix: String(scan.prefix || ''),
    elapsedMs: Date.now() - t0
  };
  last = rep;
  return rep;
}

export interface DiscoveryResult { url: string; self: string; scanned: number; tried: number; attempts?: DiscoveryAttempt[]; prefix?: string }

/** 兼容旧调用：找到返回结果，找不到返回 null（细节用 discoverServerDetailed / lastDiscovery） */
export async function discoverServer(port: number, prefer = ''): Promise<DiscoveryResult | null> {
  const r = await discoverServerDetailed(port, prefer);
  if (!r.ok) return null;
  return { url: r.url, self: r.self, scanned: r.scanned, tried: r.tried, attempts: r.attempts, prefix: r.prefix };
}

/* ------------------------------ 说人话 ------------------------------ */

/**
 * 把发现结果翻成一句可操作的诊断。
 * 这句话就是用户连不上时最需要看到的东西，别只给 Failed to fetch。
 */
export function describeDiscovery(r: DiscoveryReport | null): string {
  if (!r) return '';
  if (r.ok) {
    if (r.via === 'beacon') {
      return t('找到电脑了：{url}（局域网广播，{ms}ms）', { url: r.url, ms: r.elapsedMs });
    }
    return t('找到电脑了：{url}（扫了 {scanned} 台，试了 {tried} 台）', { url: r.url, scanned: r.scanned, tried: r.tried });
  }
  switch (r.failure) {
    case 'not-native':
      return t('网页版不能自己扫局域网：把电脑设置页上「这台电脑的地址」填到上面就行。');
    case 'no-plugin':
      return t('这个安装包不带局域网扫描：直接把电脑设置页上的地址填进来（同一 Wi-Fi 下就能同步）。');
    case 'scan-error':
      return t('扫描失败了：{error}。确认手机连着 Wi-Fi（别用流量），再点一次「自动搜索电脑」。', { error: r.error || t('不知道原因') });
    case 'bad-result':
      return t('扫描没有返回结果：再点一次「自动搜索电脑」；还不行就把电脑上的地址手输进来。');
    case 'no-hosts':
      return t('扫了 {n} 台都没响应：电脑上的「时序」是不是关着？（关闭窗口 = 同步服务停下）确认手机和电脑连的是同一个 Wi-Fi，再搜一次；也可以把电脑设置页上的地址手输进来。', { n: r.scanned || LAN_HOST_COUNT });
    case 'all-rejected':
      return t('{error}：可能这个端口被别的程序占了，或电脑上的时序还没启动完，等几秒再搜；也可以把地址手输进来。', { error: r.error });
    default:
      return '';
  }
}

/** 诊断的细节行：试过哪些地址、各自为什么失败（最多几条，避免刷屏） */
export function describeAttempts(r: DiscoveryReport | null, limit = 3): string {
  if (!r || !r.attempts.length) return '';
  const parts = r.attempts.slice(0, limit).map(function (a) {
    return t('{host}（{result}）', { host: a.host, result: a.ok ? t('可以') : a.error });
  });
  const more = r.attempts.length > limit ? t(' 等 {n} 台', { n: r.attempts.length }) : '';
  const sep = getLang() === 'en' ? ', ' : '、';
  return t('试过：{list}{more}', { list: parts.join(sep), more });
}

/* ------------------------------ 小工具 ------------------------------ */

/** 从同步地址里取出端口，取不到就用 8787 */
export function portOf(url: string, fallback = 8787): number {
  const s = String(url || '');
  const i = s.lastIndexOf(':');
  if (i < 0) return fallback;
  const n = Number(s.slice(i + 1).split('/')[0]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 这个错误像是「连不上」，而不是服务端返回了错误状态码 */
export function isNetworkError(msg: string): boolean {
  const s = String(msg || '');
  if (s.indexOf('HTTP ') === 0) return false;
  return /failed to fetch|networkerror|network error|load failed|err_|net::|timeout|timed out|abort/i.test(s);
}
