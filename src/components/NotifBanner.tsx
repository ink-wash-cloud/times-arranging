// 通知权限横幅：只在安卓包里、且权限确实没拿到时出现。
//
// 为什么要有它：授权框只会弹一次。用户当时随手点了"不允许"，之后系统就再
// 也不问了，应用里也什么都看不到——提醒静悄悄地全部失效。这条横幅把状态
// 摆到明面上，并给两个出口：再问一次 / 跳系统设置。
import React, { useState } from 'react';
import { isNativeApp } from '../lib/native';
import { useNotifSetup, checkNotificationPermission, openNotifSettings } from '../lib/notifSetup';
import { toast } from './ui';
import { t } from '../lib/i18n';

const OFF_KEY = 'notifBannerOff';

export default function NotifBanner() {
  const st = useNotifSetup();
  const [off, setOff] = useState(() => {
    try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);

  const native = isNativeApp();
  // prompt 也当作"没拿到"：说明问过了但没结果，界面不能装作没事
  const bad = st.state === 'denied' || st.state === 'unsupported' || st.state === 'prompt';
  if (!native || off || !bad) return null;

  const ask = async () => {
    setBusy(true);
    const p = await checkNotificationPermission(true);
    setBusy(false);
    if (p === 'granted') toast(t('通知权限已开启 🎉'), 'ok');
    else toast(t('系统还是没有授权，去「设置 → 应用 → 时序 → 通知」里手动打开'), 'err');
  };

  const goto = async () => {
    const okGo = await openNotifSettings();
    if (!okGo) toast(t('打开系统设置失败，请手动进入「设置 → 应用 → 时序 → 通知」'), 'err');
  };

  const dismiss = () => {
    setOff(true);
    try { localStorage.setItem(OFF_KEY, '1'); } catch { /* 忽略 */ }
  };

  return (
    <div className="card mb12 notif-banner">
      <div className="row-wrap" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 20, lineHeight: 1.2 }}>🔔</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <b>{t('通知权限没开，提醒发不出来')}</b>
          <div className="muted" style={{ marginTop: 4, lineHeight: 1.8 }}>
            {st.state === 'unsupported'
              ? t('系统通知组件没就绪（插件没装上或桥接层没起来）。待办截止、纪念日、习惯打卡的提醒现在都收不到。')
              : t('待办截止、纪念日、习惯打卡的提醒现在都收不到。安卓的通知授权框只会自动弹一次，之后就得去系统设置里手动开。')}
          </div>
        </div>
      </div>
      <div className="row-wrap mt12" style={{ gap: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={ask}>
          {busy ? t('正在申请…') : t('开启通知')}
        </button>
        <button className="btn btn-sm" onClick={goto}>{t('去系统设置')}</button>
        <button className="btn btn-sm btn-ghost" onClick={dismiss}>{t('以后再说')}</button>
      </div>
    </div>
  );
}
