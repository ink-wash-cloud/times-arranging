// 设置页里的「同步」两个区块。
//
//  · SyncAddressPanel：电脑端把「手机该填哪个地址」直接亮出来（一键复制、虚拟网卡提示）；
//    手机端不 fetch 本机地址，改成「手机怎么连上电脑」+ 自动搜索 + 人话诊断。
//  · SyncDirectionPanel：同步方向（双向/只上传/只下载）+ 一次性覆盖 + 状态 + 出错时怎么办。
//
// 拆出来是因为 Settings.tsx 已经很长，而且这两块在网页端/原生端表现不同。
import { useEffect, useState } from 'react';
import type { SyncDir } from '../lib/db';
import {
  cfg, saveConfig, syncNow, syncForce, syncStat, syncVerdict, pendingCount, rememberAddress, useDB,
  serverHealth, repairConnection, realignFromServer, serverDevices, refreshDevices
} from '../lib/db';
import type { ServerDevice } from '../lib/db';
import { isNativeApp } from '../lib/native';
import {
  discoverServerDetailed, describeDiscovery, describeAttempts, lastDiscovery, portOf, isNetworkError
} from '../lib/discover';
import { t, useLang } from '../lib/i18n';
import { toast, askConfirm, Field } from './ui';

/* -------------------------------- 小工具 -------------------------------- */

/**
 * 复制到剪贴板。
 * 局域网 http 地址不是「安全上下文」，navigator.clipboard 可能是 undefined ——
 * 正是这个场景（手机/另一台电脑打开 http://192.168.x.x:8787）最需要复制，
 * 所以必须有 textarea + execCommand 的兜底。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 没权限 / 非安全上下文，走兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  return String(url || '').replace('https://', '').replace('http://', '').split('/')[0];
}

function timeText(at: number): string {
  if (!at) return t('还没成功同步过');
  return new Date(at).toLocaleString('zh-CN');
}

/* ------------------------------ 本机地址面板 ------------------------------ */

interface AddrItem {
  iface: string;
  address: string;
  url: string;
  internal: boolean;
  virtual: boolean;
  available: boolean;
  kind: 'lan' | 'virtual' | 'linklocal' | 'loopback';
  note: string;
}

interface AddrInfo {
  ok: boolean;
  port: number;
  host: string;
  loopbackOnly: boolean;
  localhost: string[];
  urls: AddrItem[];
  lanUrls: string[];
  primary: string;
  hint: string;
}

/** 电脑端：告诉用户「手机该填这个地址」。局域网地址会随 Wi-Fi 变，所以带刷新。 */
export function SyncAddressPanel() {
  useLang();
  const native = isNativeApp();
  const [info, setInfo] = useState<AddrInfo | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [loading, setLoading] = useState(!native);
  const [refreshKey, setRefreshKey] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [diag, setDiag] = useState(() => describeDiscovery(lastDiscovery()));
  const [detail, setDetail] = useState(() => describeAttempts(lastDiscovery()));

  useEffect(() => {
    if (native) return;
    let dead = false;
    setLoading(true);
    setLoadErr('');
    const cur = (cfg.serverUrl || '').replace(/\/+$/, '');
    const origin = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) ? location.origin : '';
    const bases: string[] = [];
    if (origin) bases.push(origin);
    if (cur && cur !== origin) bases.push(cur);
    (async () => {
      let err = '';
      for (const b of bases) {
        try {
          const r = await fetch(b + '/api/addresses', {
            cache: 'no-store',
            headers: cfg.syncToken ? { 'X-Sync-Token': cfg.syncToken } : {}
          });
          if (!r.ok) { err = 'HTTP ' + r.status; continue; }
          const j = (await r.json()) as AddrInfo;
          if (!j || !Array.isArray(j.urls)) { err = '返回格式不对'; continue; }
          if (!dead) { setInfo(j); setLoadErr(''); setLoading(false); }
          return;
        } catch (e) {
          err = String((e as Error)?.message || e);
        }
      }
      if (!dead) {
        setInfo(null);
        setLoadErr(err || '连不上服务');
        setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, [native, refreshKey]);

  const doCopy = async (url: string) => {
    const ok = await copyText(url);
    toast(ok ? t('已复制：{url}', { url }) : t('复制失败，请手动选中地址复制：{url}', { url }), ok ? 'ok' : 'err');
  };

  /** 手机端：扫一遍局域网找电脑 */
  const autoFind = async () => {
    setScanning(true);
    setDiag(t('正在扫描局域网，找电脑上的「时序」…'));
    setDetail('');
    try {
      const port = portOf(cfg.serverUrl, 8787);
      const r = await discoverServerDetailed(port, cfg.serverUrl);
      setDiag(describeDiscovery(r));
      setDetail(describeAttempts(r));
      if (!r.ok) {
        toast(t('没找到电脑：按下面的提示检查一下'), 'err');
        return;
      }
      await rememberAddress(r.url);
      const s = await syncNow('auto-find');
      toast(s.ok ? t('找到并连上了：{url}', { url: r.url }) : t('找到了 {url}，但同步失败：{msg}', { url: r.url, msg: s.message }), s.ok ? 'ok' : 'err');
      if (!s.ok) setDiag(s.message);
    } catch (e) {
      setDiag(t('搜索出错了：{msg}。也可以把电脑上的地址手动填到上面。', { msg: String((e as Error)?.message || e) }));
    } finally {
      setScanning(false);
    }
  };

  /* ---------------------------- 手机端（原生） ---------------------------- */
  if (native) {
    return (
      <div className="card mb12" data-testid="sync-addr-panel">
        <div className="card-h"><span className="ico">📶</span><h3>{t('手机怎么连上电脑')}</h3></div>
        <div className="muted" style={{ lineHeight: 2 }}>
          {t('1. 电脑上双击「启动时序」——窗口开着，服务就一直在跑；')}<b>{t('关掉窗口 = 同步停下')}</b><br />
          {t('2. 手机和电脑连同一个 Wi-Fi（手机别用流量，电脑别连手机热点以外的别的网络）')}<br />
          {t('3. 点下面的「自动搜索电脑」，或把电脑设置页里「这台电脑的地址」填到上面')}
        </div>
        <div className="row-wrap mt12">
          <button className="btn btn-primary" data-testid="sync-auto-find" disabled={scanning} onClick={autoFind}>
            {scanning ? t('正在扫局域网…') : t('自动搜索电脑')}
          </button>
          <span className="muted">{t('会挨个试同网段的 254 台设备，大约 3～8 秒')}</span>
        </div>
        {diag ? (
          <div className="mt12" data-testid="sync-diag" style={{
            fontSize: 12.5, lineHeight: 1.9, padding: '9px 12px', borderRadius: 12,
            background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)',
            color: diag.indexOf('找到') === 0 ? 'var(--good)' : 'var(--text)'
          }}>{diag}</div>
        ) : null}
        {detail ? <div className="muted mt8" data-testid="sync-diag-detail">{detail}</div> : null}
        <div className="muted mt12">
          {t('换 Wi-Fi 后电脑的 IP 会变，手机里存的是旧地址就再也连不上 —— 所以连不上时先点「自动搜索电脑」，或让电脑重新报一下地址。网页版没有扫描能力，只能在服务器地址里手填。')}
        </div>
      </div>
    );
  }

  /* ----------------------------- 电脑端（网页） ----------------------------- */
  const rows: { url: string; label: string; recommended: boolean }[] = [];
  if (info) {
    // 局域网网卡照旧列出来，但只有「服务监听局域网」时才算推荐地址；
    // 只监听本机的情况上面有红字警告，行尾也会标出来。
    for (const u of info.urls) {
      if (u.kind !== 'lan') continue;
      rows.push({
        url: u.url,
        label: u.iface + (u.note ? ' · ' + u.note : ''),
        recommended: u.available && u.url === info.primary
      });
    }
    for (const u of info.localhost) {
      rows.push({ url: u, label: t('仅本机 · 手机填这个连不上'), recommended: false });
    }
  }
  const ignored = info ? info.urls.filter((u) => u.kind === 'virtual' || u.kind === 'linklocal') : [];

  return (
    <div className="card mb12" data-testid="sync-addr-panel">
      <div className="card-h"><span className="ico">🖥️</span><h3>{t('这台电脑的地址')}</h3>
        <div className="right">
          <button className="btn btn-ghost btn-sm" data-testid="sync-addr-refresh"
            onClick={() => setRefreshKey((n) => n + 1)}>{t('刷新')}</button>
        </div>
      </div>
      <div className="muted mb12" style={{ lineHeight: 1.9 }}>
        {t('手机连同一个 Wi-Fi 后，在「设置与同步」的服务器地址里填下面带「推荐」的那条。电脑换 Wi-Fi 后 IP 会变，以这里显示的为准。')}
      </div>

      {loading ? <div className="muted" data-testid="sync-addr-hint">{t('正在读取本机地址…')}</div> : null}

      {!loading && !info ? (
        <div className="muted" data-testid="sync-addr-hint" style={{ lineHeight: 1.9 }}>
          {t('读不到本机地址（{err}）。可能这个页面不是从电脑上的「时序」打开的：用「启动时序」打开的地址才能看到手机该填的 IP；手机端请按上面步骤手动填。', { err: loadErr })}
        </div>
      ) : null}

      {info ? (
        <>
          {info.loopbackOnly ? (
            <div className="mb8" data-testid="sync-addr-warn" style={{ color: 'var(--bad)', fontSize: 12.5, lineHeight: 1.9 }}>
              ⚠ {t('同步服务只监听了本机（HOST={host}），手机连不上：关掉后重新运行「时序」（默认监听局域网）。', { host: info.host })}
            </div>
          ) : null}
          <div className="row-wrap" style={{ gap: 6 }} data-testid="sync-addr-list">
            {rows.map((r, i) => (
              <div key={r.url} className="addr-item" data-testid={'sync-addr-' + i} data-url={r.url}
                title={r.label} style={{ maxWidth: '100%' }}>
                {r.recommended ? <span className="muted" style={{ fontFamily: 'inherit', color: 'var(--good)' }}>{t('推荐')}</span> : null}
                <span style={{ overflowWrap: 'anywhere' }}>{r.url}</span>
                <button className="btn btn-sm btn-ghost" data-testid={'sync-copy-' + i}
                  onClick={() => doCopy(r.url)}>{t('复制')}</button>
                <span className="muted" style={{ fontFamily: 'inherit', fontSize: 11 }}>{r.label}</span>
              </div>
            ))}
            {!rows.length ? <span className="muted">{t('没检测到可用地址')}</span> : null}
          </div>
          {ignored.length ? (
            <div className="muted mt8" data-testid="sync-addr-ignored">
              {t('另外 {n} 个地址手机连不上，已忽略：', { n: ignored.length })}
              {Array.from(new Set(ignored.map((u) => u.iface + ' ' + u.address))).join('、')}
              {t('（虚拟网卡/临时地址，抄了也连不上）')}
            </div>
          ) : null}
          {info.hint ? <div className="muted mt8" data-testid="sync-addr-hint">{info.hint}</div> : null}
          <div className="muted mt12" style={{ lineHeight: 1.9 }}>
            {t('手机端：打开「设置与同步」→ 服务器地址 → 粘贴/手输上面带「推荐」的地址 → 保存并立即同步。手机浏览器也可以直接打开这个地址。')}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------ 同步方向面板 ------------------------------ */

const DIRS: { key: SyncDir; label: string; desc: string }[] = [
  { key: 'both', label: '双向同步', desc: '本机的改动上传，对方的新改动也拉下来。日常用这个就行。' },
  { key: 'push', label: '只上传', desc: '只把本机的改动推给对方；对方的新数据不会覆盖本机。适合临时「以这台设备为准」。' },
  { key: 'pull', label: '只下载', desc: '只把对方的数据拉下来；本机的改动留在本地「待上传」，不会传上去。' }
];

function dirOf(key: SyncDir) {
  return DIRS.find((d) => d.key === key) || DIRS[0];
}

function explainSync(): { title: string; tips: string[] } | null {
  const err = syncStat.state === 'error' ? (cfg.lastError || syncStat.error || '') : '';
  if (!err) {
    if (!cfg.lastSyncAt) {
      return {
        title: t('还没成功同步过'),
        tips: [
          t('先点下面的「保存并立即同步」；地址要和电脑设置页显示的一致。'),
          t('手机和电脑要连同一个 Wi-Fi。')
        ]
      };
    }
    return null;
  }
  if (isNetworkError(err)) {
    return {
      title: t('连不上 {host}', { host: hostOf(cfg.serverUrl) || t('服务器') }),
      tips: [
        t('电脑上的「时序」还开着吗？关闭窗口 = 同步服务停下（重新双击「启动时序」）。'),
        t('手机和电脑连的是同一个 Wi-Fi 吗？（手机用流量、电脑连别的网络都不行）'),
        t('地址是不是旧的？电脑换 Wi-Fi 后 IP 会变 —— 看电脑设置页「这台电脑的地址」，或在手机端点「自动搜索电脑」。')
      ]
    };
  }
  if (/^HTTP 401/.test(err)) {
    return { title: t('服务器要同步令牌'), tips: [t('把电脑启动时序时设置的 SYNC_TOKEN，填到上面的「同步令牌」里再保存。')] };
  }
  if (/^HTTP 404/.test(err)) {
    return { title: t('这个地址不是时序服务'), tips: [t('确认端口和电脑上显示的一致（默认 8787），地址后面不要带 /api。')] };
  }
  if (/^HTTP 5/.test(err)) {
    return { title: t('电脑上的同步服务出错了'), tips: [t('把电脑上的时序关掉重开；还不行就看电脑窗口里的报错原文。')] };
  }
  return {
    title: t('同步失败'),
    tips: [t('错误原文：{err}', { err }), t('可以先点「测试连接」确认地址通不通；不确定就重启电脑上的时序。')]
  };
}

/** 同步方向 + 一次性覆盖 + 当前状态 + 连不上时的人话诊断 */
export function SyncDirectionPanel() {
  useDB();
  useLang();
  const [busy, setBusy] = useState<'' | 'push' | 'pull' | 'sync'>('');
  const [forceMsg, setForceMsg] = useState('');
  const cur = dirOf(cfg.syncDir);
  const pending = pendingCount();
  const exp = explainSync();

  const setDir = async (d: SyncDir) => {
    if (d === cfg.syncDir) return;
    await saveConfig({ syncDir: d });
    toast(t('同步方向已改为「{dir}」', { dir: t(dirOf(d).label) }), 'ok');
  };

  const doSync = async () => {
    setBusy('sync');
    try {
      const r = await syncNow('manual');
      toast(r.message, r.ok ? 'ok' : 'err');
    } finally {
      setBusy('');
    }
  };

  const doForce = async (kind: 'push' | 'pull') => {
    const push = kind === 'push';
    const from = cfg.deviceName || t('这台设备');
    const ok = await askConfirm(
      push ? t('用本机数据覆盖对方') : t('用对方数据覆盖本机'),
      push
        ? t('会把「{device}」当前的全部数据盖上最新时间戳整体推给服务器，对方那些没同步的改动会被覆盖。建议先让对方同步一次。确定继续吗？', { device: from })
        : t('会从服务器拉回全部数据并直接覆盖本机（含删除记录），本机还没上传的改动会被覆盖掉。建议先导出备份。确定继续吗？'),
      { okText: push ? t('确定覆盖对方') : t('确定覆盖本机'), danger: true }
    );
    if (!ok) return;
    setBusy(kind);
    setForceMsg(push ? t('正在用本机数据覆盖对方…') : t('正在用对方数据覆盖本机…'));
    try {
      const r = await syncForce(kind);
      setForceMsg(r.message + t('（同步方向没有改，随时可以再覆盖回来）'));
      toast(r.message, r.ok ? 'ok' : 'err');
    } catch (e) {
      const m = t('覆盖失败：{msg}', { msg: String((e as Error)?.message || e) });
      setForceMsg(m);
      toast(m, 'err');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card mb12" data-testid="sync-dir-panel">
      <div className="card-h"><span className="ico">🧭</span><h3>{t('同步方向')}</h3>
        <div className="right">
          <button className="btn btn-sm" data-testid="sync-now-btn" disabled={busy !== ''} onClick={doSync}>
            {busy === 'sync' ? t('同步中…') : t('立即同步')}
          </button>
        </div>
      </div>
      <div className="row-wrap" style={{ gap: 6 }} data-testid="sync-dir-options">
        {DIRS.map((d) => (
          <button key={d.key} type="button" className={'chip' + (cfg.syncDir === d.key ? ' on' : '')}
            data-testid={'sync-dir-' + d.key} onClick={() => setDir(d.key)}>{t(d.label)}</button>
        ))}
      </div>
      <div className="muted mt8" data-testid="sync-dir-desc" style={{ lineHeight: 1.9 }}>{t(cur.desc)}</div>
      {cfg.syncDir === 'pull' && pending > 0 ? (
        <div className="muted mt8" data-testid="sync-pull-note" style={{ color: 'var(--warn)' }}>
          {t('只下载模式下，本机这 {n} 条改动不会上传；切成「双向同步」后会自动补传。', { n: pending })}
        </div>
      ) : null}

      <div className="mt12">
        <div className="stat-line"><span>{t('当前服务器')}</span>
          <span data-testid="sync-status-addr">{cfg.serverUrl || (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) ? location.origin + t('（同源）') : t('未设置'))}</span>
        </div>
        <div className="stat-line"><span>{t('上次成功')}</span><span data-testid="sync-status-last">{timeText(cfg.lastSyncAt || syncStat.lastSyncAt)}</span></div>
        <div className="stat-line"><span>{t('待上传')}</span><span data-testid="sync-status-pending">{t('{n} 条', { n: pending })}</span></div>
        <div className="stat-line"><span>{t('最近错误')}</span>
          <span data-testid="sync-status-err" style={{ color: syncStat.state === 'error' ? 'var(--bad)' : undefined }}>
            {syncStat.state === 'error' ? (cfg.lastError || syncStat.error || t('未知错误')) : t('无')}
          </span>
        </div>
      </div>

      {exp ? (
        <div className="mt12" data-testid="sync-explain" style={{
          fontSize: 12.5, lineHeight: 1.9, padding: '9px 12px', borderRadius: 12,
          background: 'rgba(255,107,125,.10)', border: '1px solid rgba(255,107,125,.28)'
        }}>
          <b>{exp.title}</b>
          {exp.tips.map((tip, i) => <div key={i} className="muted" style={{ fontSize: 12 }}>· {tip}</div>)}
        </div>
      ) : null}

      <div className="mt12">
        <Field label={t('一次性覆盖（平时不用点）')} hint={t('两个按钮都会先弹二次确认；方向不会因此改变，覆盖错了可以再点另一个覆盖回来。')}>
          <div className="row-wrap">
            <button className="btn btn-danger" data-testid="sync-force-push" disabled={busy !== ''} onClick={() => doForce('push')}>
              {busy === 'push' ? t('覆盖中…') : t('用本机数据覆盖对方')}
            </button>
            <button className="btn btn-danger" data-testid="sync-force-pull" disabled={busy !== ''} onClick={() => doForce('pull')}>
              {busy === 'pull' ? t('覆盖中…') : t('用对方数据覆盖本机')}
            </button>
          </div>
        </Field>
        {forceMsg ? <div className="muted mt8" data-testid="sync-force-msg">{forceMsg}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------ 连接体检 ------------------------------ */

/**
 * 「连接体检」——把同步的每个数字摊开给用户看。
 *
 * 为什么要有这一块：以前顶栏写「已同步」，用户没法自己验证，出了问题只能
 * 靠我猜。这里把本机条数、电脑条数、待上传、游标、能不能连上、每台设备
 * 落后多少全部列出来，一眼就能看出是哪一环断了；下面两个按钮就是对应的
 * 两种修法（换个地址重连 / 以电脑为准重新对齐）。
 */
export function ConnectionCheck() {
  useLang();
  useDB();
  const [busy, setBusy] = useState<'' | 'repair' | 'realign' | 'refresh'>('');
  const [msg, setMsg] = useState('');
  const [dev, setDev] = useState<{ ok: boolean; error: string; devices: ServerDevice[]; seq: number; records: number }>({
    ok: false, error: '', devices: [], seq: 0, records: 0
  });
  const verdict = syncVerdict();
  const local = syncStat.localRecords;
  const remote = syncStat.serverRecords;
  const sameCount = local === remote;

  const loadDevices = async () => {
    const r = await refreshDevices();
    setDev({ ok: r.ok, error: r.error, devices: r.devices, seq: r.serverSeq, records: r.records });
  };

  useEffect(() => {
    void loadDevices();
    // 只问一次：这块面板打开时看一眼就够了，不做轮询（顶栏自己在轮询）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doRepair = async () => {
    setBusy('repair');
    try {
      const r = await repairConnection();
      setMsg(r.message);
      toast(r.message, r.ok ? 'ok' : 'err');
      await loadDevices();
    } finally {
      setBusy('');
    }
  };

  const doRealign = async () => {
    const ok = await askConfirm(
      t('以电脑为准重新对齐'),
      t('会把本机游标清零，然后把电脑上的数据整份拉回来：本机还没传上去的改动会被盖掉。确定继续吗？'),
      { okText: t('开始对齐'), danger: true }
    );
    if (!ok) return;
    setBusy('realign');
    try {
      const r = await realignFromServer();
      setMsg(r.message);
      toast(r.message, r.ok ? 'ok' : 'err');
      await loadDevices();
    } finally {
      setBusy('');
    }
  };

  const refresh = async () => {
    setBusy('refresh');
    try {
      await serverHealth();
      const r = await refreshDevices();
      setDev({ ok: r.ok, error: r.error, devices: r.devices, seq: r.serverSeq, records: r.records });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card mb12" data-testid="conn-check">
      <div className="card-h"><span className="ico">🩺</span><h3>{t('连接体检')}</h3>
        <div className="right">
          <span className={'sync-pill ' + verdict.cls} data-testid="conn-verdict"><span className="dot" />{verdict.text}</span>
          <button className="btn btn-sm" data-testid="conn-refresh" disabled={busy !== ''} onClick={refresh}>
            {busy === 'refresh' ? t('检查中…') : t('重新检查')}
          </button>
        </div>
      </div>

      <div className="muted mb12" style={{ lineHeight: 1.9 }}>
        {t('下面每个数字都是这台设备和电脑各自报出来的实数。本机条数和电脑条数一样、待上传是 0，才叫真的同步上了。')}
      </div>

      <div className="stat-line"><span>{t('本机记录')}</span><span data-testid="conn-local">{t('{n} 条', { n: local })}</span></div>
      <div className="stat-line"><span>{t('电脑记录')}</span><span data-testid="conn-server">{t('{n} 条', { n: remote })}</span></div>
      <div className="stat-line"><span>{t('两边条数')}</span>
        <span data-testid="conn-same" style={{ color: sameCount ? undefined : 'var(--warn)' }}>
          {sameCount ? t('对得上') : t('对不上：有 {n} 条还没两边一致', { n: Math.abs(local - remote) })}
        </span>
      </div>
      <div className="stat-line"><span>{t('待上传')}</span><span data-testid="conn-pending">{t('{n} 条', { n: pendingCount() })}</span></div>
      <div className="stat-line"><span>{t('能不能连上电脑')}</span>
        <span data-testid="conn-reachable">{syncStat.reachable === 1 ? t('能连上') : t('连不上')}</span>
      </div>
      <div className="stat-line"><span>{t('电脑上的最新序号')}</span><span data-testid="conn-seq">{String(syncStat.serverSeq || 0)}</span></div>
      <div className="stat-line"><span>{t('本机已经拉到第几条')}</span><span data-testid="conn-cursor">{String(cfg.lastPulledSeq || 0)}</span></div>
      <div className="stat-line"><span>{t('上次核对')}</span><span data-testid="conn-checked">{syncStat.checkedAt ? new Date(syncStat.checkedAt).toLocaleTimeString() : t('还没核对过')}</span></div>

      {msg ? <div className="muted mt8" data-testid="conn-msg">{msg}</div> : null}

      <div className="row-wrap mt12" style={{ gap: 8 }}>
        <button className="btn btn-sm btn-primary" data-testid="conn-repair" disabled={busy !== ''} onClick={doRepair}>
          {busy === 'repair' ? t('正在重连…') : t('一键重连')}
        </button>
        <button className="btn btn-sm" data-testid="conn-realign" disabled={busy !== ''} onClick={doRealign}>
          {busy === 'realign' ? t('正在对齐…') : t('以电脑为准重新对齐')}
        </button>
      </div>

      <div className="mt12">
        <div className="muted" style={{ fontSize: 12.5 }}>
          {t('已经登录过这台电脑的设备（电脑自己也算一台）')}
        </div>
        {dev.ok ? (
          dev.devices.length === 0 ? (
            <div className="muted mt8" data-testid="conn-devices-empty">{t('还没有设备连过这台电脑')}</div>
          ) : (
            <div className="mt8" data-testid="conn-devices">
              {dev.devices.map((d) => (
                <div className="stat-line" key={d.id} data-testid="conn-device">
                  <span>
                    {d.name}{d.self ? t('（这台）') : ''}
                    <span className="muted">{' · '}{d.platform || t('未知系统')}</span>
                  </span>
                  <span style={{ color: d.ahead || d.behindBy > 0 ? 'var(--warn)' : undefined }}>
                    {d.online ? t('在线') : t('离线')}
                    {d.ahead ? t(' · 游标跑到前面了') : d.behindBy > 0 ? t(' · 还有 {n} 条没拉走', { n: d.behindBy }) : t(' · 已跟上')}
                  </span>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="muted mt8" data-testid="conn-devices-err" style={{ color: 'var(--warn)' }}>
            {t('拿不到设备列表：{msg}', { msg: dev.error || t('连不上电脑') })}
          </div>
        )}
      </div>
    </div>
  );
}
