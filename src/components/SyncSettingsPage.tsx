// 设置 →「数据与同步」二级页（v1.4.1）。
//
// v1.4.1 把设置页改成 iOS 式二级页面：根页只列"有什么"，具体调整点进去。
// 这里承接原来堆在 Settings.tsx 里的连接地址、在线存储、同步方向、本机数据、
// 备份恢复、示例数据与重置；Settings.tsx 只负责列表与路由。
//
// 注意：本组件只渲染若干 .card，不套 SubPage（SubPage 由 Settings 统一给）。
import React, { useEffect, useRef, useState } from 'react';
import {
  cfg, saveConfig, syncNow, syncStat, syncVerdict, exportLocal, importLocal,
  dbStats, resetCursor, rememberAddress, forgetAddress, useDB
} from '../lib/db';
import { Field, toast, askConfirm } from './ui';
import { seedDemo, clearAllData, isEmptyDB } from '../lib/demo';
import { todayStr } from '../lib/date';
import { SyncAddressPanel, SyncDirectionPanel, ConnectionCheck } from './SyncPanel';
import { t, useLang } from '../lib/i18n';

export default function SyncSettingsPage() {
  useLang();
  // 同步状态、地址池变化时要跟着重渲染（syncStat 走 notify）。
  useDB();
  const [server, setServer] = useState(cfg.serverUrl);
  const [token, setToken] = useState(cfg.syncToken);
  const [name, setName] = useState(cfg.deviceName);
  const [testing, setTesting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const stats = dbStats();

  useEffect(() => { setServer(cfg.serverUrl); setToken(cfg.syncToken); setName(cfg.deviceName); }, []);
  // 手机端点「自动搜索电脑」会直接改 cfg.serverUrl（rememberAddress），
  // 这里跟上，免得输入框还显示旧地址、看起来像没搜到。
  useEffect(() => { setServer(cfg.serverUrl); }, [cfg.serverUrl]);

  const test = async () => {
    setTesting(true);
    try {
      const base = (server || '').replace(/\/+$/, '');
      const res = await fetch(base + '/api/health', { headers: token ? { 'X-Sync-Token': token } : {} });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      toast(t('连接成功 · 服务器记录序号 {seq}', { seq: j.seq }), 'ok');
    } catch (e) {
      toast(t('连接失败：{msg}（请检查地址与手机是否同一 WiFi）', { msg: String((e as Error).message || e) }), 'err');
    } finally {
      setTesting(false);
    }
  };

  const saveConn = async () => {
    await saveConfig({ syncToken: token.trim(), deviceName: name.trim() });
    // 填进来的地址会自动进"已知地址池"，下次换网络会自动挨个试
    if (server.trim()) await rememberAddress(server.trim());
    toast(t('已保存连接设置'), 'ok');
  };

  /** 切到地址池里的另一个地址 */
  const switchTo = async (u: string) => {
    setServer(u);
    await rememberAddress(u);
    const r = await syncNow('manual');
    toast(r.ok ? t('已切到 {url}', { url: u }) : t('切到 {url} 也连不上：{msg}', { url: u, msg: r.message }), r.ok ? 'ok' : 'err');
  };

  const doExport = async () => {
    const json = await exportLocal();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = t('时序备份-{date}.json', { date: todayStr() });
    a.click();
    URL.revokeObjectURL(a.href);
    toast(t('备份文件已下载'), 'ok');
  };

  const doImport = async (file: File) => {
    const ok = await askConfirm(t('导入备份'), t('将把备份文件合并进当前数据（同 ID 取较新版本），并推送到服务器。确定继续吗？'), { okText: t('导入') });
    if (!ok) return;
    try {
      const n = await importLocal(await file.text(), 'merge');
      toast(t('已导入 {n} 条记录', { n }), 'ok');
      syncNow('after-import');
    } catch (e) {
      toast(t('导入失败：{msg}', { msg: String((e as Error).message || e) }), 'err');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const pullAll = async () => {
    const ok = await askConfirm(t('从服务器恢复全量'), t('将重置本地增量游标，把服务器上的全部数据重新拉取一遍（不会删除本地数据，冲突按修改时间取新）。'), { okText: t('开始恢复') });
    if (!ok) return;
    await resetCursor();
    const r = await syncNow('full-restore');
    toast(r.message, r.ok ? 'ok' : 'err');
  };

  return (
    <>
      {/* 手机连不上时最需要的一块：直接告诉用户「手机该填这个地址」 */}
      <SyncAddressPanel />

      {/* 同步到底真不真：本机/电脑条数、待上传、游标、每台设备落后多少 */}
      <ConnectionCheck />

      <div className="card mb12">
        <div className="card-h"><span className="ico">🔄</span><h3>{t('在线存储与双向同步')}</h3>
          {/* 这里和顶栏说同一句话：连不上就不许写「同步正常」 */}
          <div className="right"><span className={'sync-pill ' + syncVerdict().cls} data-testid="sync-card-pill">
            <span className="dot" />{syncVerdict().text}
          </span></div>
        </div>
        <div className="muted mb12" style={{ lineHeight: 1.9 }}>
          {t('数据默认保存在本机浏览器（IndexedDB），离线也能正常使用。配置好服务器地址后，本机会把改动推送到服务器，并拉取其他设备的改动，实现「电脑 ↔ 手机」双向同步。冲突解决策略：同一记录按修改时间取新，时间相同时按设备号决胜。')}
        </div>
        <div className="form-grid">
          <Field label={t('服务器地址')} full hint={t('手机端填电脑上「这台电脑的地址」里带推荐的那条（电脑换 Wi-Fi 后 IP 会变）。留空表示与当前页面同源。')}>
            <input className="input" data-testid="sync-server-input" value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://192.168.1.10:8787" />
          </Field>
          <Field label={t('同步令牌（可选）')} hint={t('服务器启动时设置 SYNC_TOKEN 环境变量后，这里填入相同值')}>
            <input className="input" data-testid="sync-token-input" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t('留空表示不鉴权')} />
          </Field>
          <Field label={t('本机设备名')}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        {/* 已知地址池：家里 / 学校 / 热点各存一个，换网络时自动挨个试 */}
        {cfg.serverUrls.length > 0 && (
          <div className="mt12" data-testid="addr-pool">
            <div className="muted mb8">
              {t('已知地址')} <span style={{ opacity: .7 }}>{t('（{n} 个 · 连不上时会自动挨个试，能通就用它）', { n: cfg.serverUrls.length })}</span>
            </div>
            <div className="row-wrap" style={{ gap: 6 }}>
              {cfg.serverUrls.map((u) => {
                const current = u === (cfg.serverUrl || '').replace(/\/+$/, '');
                return (
                  <div key={u} className={'addr-item' + (current ? ' on' : '')}>
                    <span>{u}</span>
                    {current ? <span className="muted">{t('使用中')}</span> : (
                      <>
                        <button className="btn btn-sm btn-ghost" onClick={() => switchTo(u)}>{t('使用')}</button>
                        <button className="btn btn-sm btn-ghost" title={t('从列表里删掉')}
                          onClick={async () => { await forgetAddress(u); toast(t('已移除 {url}', { url: u }), 'info'); }}>{t('移除')}</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="row-wrap mt12">
          <button className="btn btn-primary" onClick={async () => { await saveConn(); const r = await syncNow('manual'); toast(r.message, r.ok ? 'ok' : 'err'); }}>{t('保存并立即同步')}</button>
          <button className="btn" disabled={testing} onClick={test}>{testing ? t('测试中…') : t('测试连接')}</button>
          <button className="btn" onClick={saveConn}>{t('仅保存设置')}</button>
          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={cfg.autoSync} onChange={(e) => { saveConfig({ autoSync: e.target.checked }); toast(e.target.checked ? t('已开启自动同步') : t('已关闭自动同步'), 'info'); }} />
            <span>{t('自动同步（改动后 1.5 秒推送，每分钟心跳一次）')}</span>
          </label>
        </div>
      </div>

      {/* 方向选择与一次性覆盖放在连接设置下面：先填地址，再决定怎么同步 */}
      <SyncDirectionPanel />

      {/* 只留 SyncDirectionPanel 里没有的底层信息，免得同一份状态在两处重复 */}
      <div className="card mb12">
        <div className="card-h"><span className="ico">🗂️</span><h3>{t('本机数据')}</h3></div>
        <div className="stat-line"><span>{t('设备 ID')}</span><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{cfg.deviceId || '—'}</span></div>
        <div className="stat-line"><span>{t('已拉取到的服务器序号')}</span><span>{cfg.lastPulledSeq}</span></div>
        <div className="stat-line"><span>{t('本机记录总数')}</span><span>{t('{n} 条（墓碑 {tomb}）', { n: stats.total - stats.tombstones, tomb: stats.tombstones })}</span></div>
        <div className="mt12">
          <div className="muted mb8">{t('各模块记录数')}</div>
          <div className="row-wrap">
            {Object.entries(stats.byCollection).map(([k, v]) => (
              <span key={k} className="chip static">{k} · {v}</span>
            ))}
            {!Object.keys(stats.byCollection).length && <span className="muted">{t('暂无数据')}</span>}
          </div>
        </div>
      </div>

      <div className="card mb12">
        <div className="card-h"><span className="ico">💾</span><h3>{t('备份与恢复')}</h3></div>
        <div className="row-wrap">
          <button className="btn" onClick={doExport}>{t('导出本机备份（JSON）')}</button>
          <button className="btn" onClick={pullAll}>{t('从服务器恢复全量')}</button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            {t('导入备份文件')}
            <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) doImport(f); }} />
          </label>
        </div>
        <div className="muted mt8">{t('备份包含本机全部记录（含删除标记），可用于换设备迁移或误删恢复。')}</div>
      </div>

      <div className="card mb12">
        <div className="card-h"><span className="ico">🧪</span><h3>{t('示例数据与重置')}</h3></div>
        <div className="row-wrap">
          <button className="btn" onClick={() => { seedDemo(); toast(t('示例数据已载入'), 'ok'); }}>{t('载入示例数据')}</button>
          <button className="btn btn-danger" onClick={async () => {
            const ok = await askConfirm(t('清空全部数据'), t('将删除本机所有待办、习惯、纪念日、课表、账目（会同步到其他设备）。建议先导出备份。'), { okText: t('全部清空'), danger: true });
            if (!ok) return;
            const n = clearAllData();
            toast(t('已清空 {n} 条记录', { n }), 'ok');
          }}>{t('清空全部数据')}</button>
        </div>
        {isEmptyDB() && <div className="muted mt8">{t('当前数据库为空，可载入示例数据快速体验。')}</div>}
      </div>
    </>
  );
}
