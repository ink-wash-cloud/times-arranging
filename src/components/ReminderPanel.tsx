import React, { useEffect, useState } from 'react';
import { Field, toast } from './ui';
import {
  reminderCfg, permissionState, requestPermission, scanNow, onReminder, lastNativePushError
} from '../lib/reminders';
import { isNativeApp, nativeNotifyNow, ensureChannel } from '../lib/native';
import { rescheduleNow, planUpcoming, lastPlan } from '../lib/nativeReminders';
import { useNotifSetup, checkNotificationPermission, openNotifSettings } from '../lib/notifSetup';
import { cfg, saveConfig } from '../lib/db';
import { t, useLang } from '../lib/i18n';

export default function ReminderPanel() {
  useLang();
  const native = isNativeApp();
  const notif = useNotifSetup();      // 启动时那次自动申请的结果
  const [perm, setPerm] = useState('');
  const [planned, setPlanned] = useState<number | null>(null);
  const [channelReady, setChannelReady] = useState(false);
  const [err, setErr] = useState('');
  const [, force] = useState(0);

  // 显示用：本页刚问出来的结果优先，其次用启动自检的
  const shown = perm || (notif.state === 'idle' || notif.state === 'checking' ? '' : notif.state);

  const refresh = async () => {
    const p = await permissionState().catch(() => 'unsupported');
    setPerm(p);
    if (!native) return;
    setPlanned(await rescheduleNow().catch(() => 0));
    const lp = lastPlan();
    setErr(lp.error || lastNativePushError() || '');
  };

  // 授权请求不在这里做：App 启动时已经由 initNotifications() 问过了
  // （它会在 window.Capacitor 注入晚的时候错开时间重试，这里再问一遍反而容易抢跑）
  useEffect(() => { void refresh(); }, [native]);

  /** 跳系统通知设置；插件不可用时给文字指引 */
  const gotoSystem = async () => {
    const okGo = await openNotifSettings();
    if (!okGo) toast(t('请手动进入「设置 → 应用 → 时序 → 通知」打开'), 'info');
  };

  /** 一键跑完整条链路：要权限 → 建渠道 → 排期 → 发一条测试通知 */
  const selfCheck = async () => {
    const p = await checkNotificationPermission(true);
    setPerm(p);
    if (p !== 'granted') {
      setErr(t('通知权限没给，系统会把通知直接丢掉。请到「设置 → 应用 → 时序 → 通知」里打开'));
      toast(t('通知权限没给，点下面的「去系统设置」打开'), 'err');
      return;
    }
    const ch = await ensureChannel();
    setChannelReady(ch);
    const n = await rescheduleNow();
    setPlanned(n);
    const r = await nativeNotifyNow(t('🔔 时序提醒测试'), t('看到这条说明系统通知链路是通的'), 'selfcheck:' + Date.now());
    setErr(r.ok ? '' : r.error);
    toast(r.ok ? t('链路正常：已排 {n} 条，并发了测试通知，去通知栏看看', { n }) : t('发送失败：{msg}', { msg: r.error }), r.ok ? 'ok' : 'err');
  };

  useEffect(() => onReminder((msg) => toast(msg, 'ok')), []);

  const set = (patch: Partial<typeof reminderCfg>) => {
    Object.assign(reminderCfg, patch);
    try { localStorage.setItem('reminderCfg', JSON.stringify(reminderCfg)); } catch { /* 忽略 */ }
    force((v) => v + 1);
  };

  const ask = async () => {
    const p = native ? await checkNotificationPermission(true) : await requestPermission();
    setPerm(p);
    if (p === 'granted') {
      set({ enabled: true });
      if (native) setPlanned(await rescheduleNow());
      toast(t('通知已开启'), 'ok');
    } else if (p === 'denied') {
      toast(native ? t('系统拒绝了通知权限 —— 系统只会自动问一次，现在得去系统设置里手动开') : t('浏览器拒绝了通知权限，请在站点设置里手动允许'), 'err');
    } else {
      toast(t('未获得授权'), 'info');
    }
  };

  const permText = !shown ? t('检测中…')
    : shown === 'granted' ? t('已授权')
    : shown === 'denied' ? t('已被拒绝')
    : shown === 'unsupported' ? t('当前环境不支持')
    : t('未授权');

  return (
    <div className="card mb12">
      <div className="card-h">
        <span className="ico">🔔</span>
        <h3>{t('事项临近提醒')}</h3>
        <div className="right"><span className={'chip static' + (shown === 'granted' ? ' on' : '')}>{t('通知权限：{status}', { status: permText })}</span></div>
      </div>

      <div className="muted mb12" style={{ lineHeight: 1.9 }}>
        {native ? (
          <>{t('当前运行在')}<b>{t('安卓应用')}</b>{t('里：提醒会以')}<b>{t('系统通知')}</b>{t('的形式出现在手机的')}<b>{t('通知栏')}</b>{t('上，关掉应用也能按时弹出。未来 7 天内的待办截止、纪念日、习惯打卡会自动排期给系统，数据一变动就自动重排。')}{planned !== null && ' ' + t('当前已排 {n} 条。', { n: planned })}</>
        ) : (
          <>{t('当前是')}<b>{t('网页版')}</b>{t('：提醒由浏览器通知发出，需要')}<b>{t('页面保持打开')}</b>{t('（或已添加到主屏）。安装安卓应用后会改用系统级本地通知，关掉应用也能收到提醒。')}</>
        )}
      </div>

      <div className="row-wrap mb12">
        <button className="btn btn-primary" onClick={ask}>{t('请求通知权限')}</button>
        {native && <button className="btn" onClick={gotoSystem}>{t('去系统设置')}</button>}
        <button className="btn" onClick={() => {
          const n = scanNow(true);
          toast(n > 0 ? t('触发 {n} 条提醒', { n }) : t('当前没有满足条件的提醒'), n > 0 ? 'ok' : 'info');
        }}>{t('立即检查一次')}</button>
        <button className="btn btn-ghost" onClick={async () => {
          if (native) {
            if (shown !== 'granted') { const r = await checkNotificationPermission(true); setPerm(r); if (r !== 'granted') { toast(t('请先允许通知权限'), 'err'); return; } }
            const r = await nativeNotifyNow(t('🔔 时序提醒测试'), t('如果你在通知栏看到这条，说明提醒链路是通的'), 'test:' + Date.now());
            toast(r.ok ? t('已发送，请下拉通知栏查看') : t('发送失败：{msg}', { msg: r.error }), r.ok ? 'ok' : 'err');
            if (!r.ok) setErr(r.error);
            return;
          }
          if (typeof Notification === 'undefined') { toast(t('当前环境不支持通知'), 'err'); return; }
          if (Notification.permission !== 'granted') { toast(t('请先点击「请求通知权限」'), 'err'); return; }
          new Notification(t('🔔 时序提醒测试'), { body: t('如果你看到这条通知，说明提醒链路是通的'), icon: '/icons/icon-192.png' });
        }}>{t('发送测试通知')}</button>
        {native && (
          <button className="btn btn-ghost" onClick={async () => {
            const n = await rescheduleNow();
            setPlanned(n);
            toast(n > 0 ? t('已排期 {n} 条系统通知', { n }) : t('未来 7 天没有需要提醒的事项'), n > 0 ? 'ok' : 'info');
          }}>{t('重新排期到系统')}</button>
        )}
      </div>

      {native && (
        <div className="mt12" style={{ fontSize: 13, lineHeight: 2 }}>
          <div className="muted mb8">{t('系统通知自检')}</div>
          <div>· {t('通知权限：')}<b>{permText}</b>
            {shown === 'denied' && <span style={{ color: '#d9534f' }}> —— {t('没给权限的话，系统会把通知直接丢掉，只剩下应用内的提示')}</span>}
          </div>
          <div>· {t('启动时自动申请：')}<b>{notif.tries > 0 ? t('已试 {n} 次', { n: notif.tries }) : t('还没跑')}</b>
            <span className="muted">{t('（安卓 13+ 必须运行时授权；系统只会弹一次框，之后只能去系统设置里开）')}</span>
          </div>
          <div>· {t('通知渠道：')}<b>{(channelReady || notif.channel) ? t('已创建（最高优先级，会弹横幅 + 响铃 + 震动）') : t('待确认')}</b></div>
          <div>· {t('已排给系统的提醒：')}<b>{planned ?? 0}</b> {t('条')} <span className="muted">{t('（排好的通知即使关掉应用也会按时弹到通知栏）')}</span></div>
          {err && <div style={{ color: '#d9534f' }}>· {t('最近一次错误：')}{err}</div>}
          <div className="row-wrap mt8">
            <button className="btn btn-sm btn-primary" onClick={selfCheck}>{t('一键自检并发送测试通知')}</button>
            <button className="btn btn-sm" onClick={gotoSystem}>{t('去系统设置')}</button>
            <span className="muted">{t('一次性把「要权限 → 建渠道 → 排期 → 发一条」整条链路跑一遍')}</span>
          </div>
        </div>
      )}

      <label className="row mb12" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={reminderCfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>{native ? t('开启提醒（关闭应用也会按时弹出）') : t('开启提醒（页面打开时每 30 秒自动检查一次）')}</span>
      </label>

      <div className="form-grid">
        <Field label={t('待办截止前提醒（分钟）')} hint={t('仅在待办填写了具体截止时间时生效')}>
          <input className="input" type="number" min={5} step={5} value={reminderCfg.leadMinutes}
            onChange={(e) => set({ leadMinutes: Number(e.target.value) || 60 })} />
        </Field>
        <Field label={t('纪念日提前提醒（天）')}>
          <input className="input" type="number" min={0} max={30} value={reminderCfg.anniversaryDays}
            onChange={(e) => set({ anniversaryDays: Number(e.target.value) || 0 })} />
        </Field>
        <Field label={t('习惯打卡提醒时间')} hint={t('到点仍未打卡的习惯会一起提醒')}>
          <input className="input" type="time" value={reminderCfg.habitAfter}
            onChange={(e) => set({ habitAfter: e.target.value || '20:00' })} />
        </Field>
        <Field label={t('按习惯自己的时间点提醒')} hint={t('每个习惯可以在习惯编辑里设多个时间点（早上、中午、晚上都行），到点各弹一条横幅通知')}>
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={cfg.habitTimes !== false} onChange={(e) => {
              void saveConfig({ habitTimes: e.target.checked });
              force((v) => v + 1);
              void rescheduleNow().then((n) => setPlanned(n)).catch(() => undefined);
            }} />
            <span>{cfg.habitTimes !== false ? t('已开启 —— 到时间点在通知栏弹出') : t('已关闭 —— 习惯的时间点都不会响')}</span>
          </label>
        </Field>
        <Field label={t('提醒类型')}>
          <div className="row-wrap">
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={reminderCfg.taskOn} onChange={(e) => set({ taskOn: e.target.checked })} /><span>{t('待办')}</span>
            </label>
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={reminderCfg.anniversaryOn} onChange={(e) => set({ anniversaryOn: e.target.checked })} /><span>{t('纪念日')}</span>
            </label>
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={reminderCfg.habitOn} onChange={(e) => set({ habitOn: e.target.checked })} /><span>{t('习惯')}</span>
            </label>
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={reminderCfg.lifeOn} onChange={(e) => set({ lifeOn: e.target.checked })} /><span>{t('人生最新一次')}</span>
            </label>
          </div>
        </Field>
      </div>
    </div>
  );
}
