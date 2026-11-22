import React, { useEffect, useState } from 'react';
import { toast } from './ui';
import { t, useLang } from '../lib/i18n';

interface AppInfo { available: boolean; name?: string; size?: number; updatedAt?: number; url: string; }

/**
 * 安卓安装包下载入口。
 * 手机浏览器打开应用后，在这里点一下就能下载安装——不需要从电脑传文件。
 */
export default function AppDownloadPanel() {
  useLang();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [lan, setLan] = useState('');

  useEffect(() => {
    fetch('/api/app-info')
      .then((r) => r.json())
      .then((d: AppInfo) => setInfo(d))
      .catch(() => setInfo({ available: false, url: '/download/app.apk' }));
    setLan(location.origin);
  }, []);

  const sizeText = info?.size ? (info.size / 1024 / 1024).toFixed(2) + ' MB' : '';
  const isAndroid = /Android/i.test(navigator.userAgent);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('链接已复制'), 'ok');
    } catch {
      toast(t('复制失败，请手动选中'), 'err');
    }
  };

  return (
    <div className="card mb12">
      <div className="card-h">
        <span className="ico">📱</span>
        <h3>{t('安卓应用')}</h3>
        <div className="right">
          {info?.available
            ? <span className="chip static on">{t('安装包已就绪')} {sizeText}</span>
            : <span className="chip static">{t('尚未打包')}</span>}
        </div>
      </div>

      {info?.available ? (
        <>
          <div className="muted mb12" style={{ lineHeight: 1.9 }}>
            {t('装成应用后：桌面有独立图标、没有浏览器地址栏，')}<b>{t('事项提醒会走系统通知，关掉应用也能按时弹')}</b>{t('。数据仍是本地优先、与电脑双向同步。')}
          </div>

          <div className="row-wrap mb12">
            <a className="btn btn-primary" href={info.url} download>
              {sizeText ? t('⬇ 下载安卓安装包（{size}）', { size: sizeText }) : t('⬇ 下载安卓安装包')}
            </a>
            {!isAndroid && (
              <span className="muted">{t('电脑上只能下载，装不了；请在手机上打开下面的地址下载')}</span>
            )}
          </div>

          <div className="muted mb8">{t('手机上这样装：')}</div>
          <div className="muted" style={{ lineHeight: 2 }}>
            {t('1. 手机连同一个 WiFi，用浏览器打开')} <b>{lan}</b>
            <button className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }} onClick={() => copy(lan)}>{t('复制')}</button><br />
            {t('2. 在应用里进入「设置与同步」，点上面的')}<b>{t('下载安卓安装包')}</b><br />
            {t('3. 系统提示「不允许安装未知来源应用」时，按提示允许你用的浏览器')}<br />
            {t('4. 装好后打开「时序」，把服务器地址确认为')} <b>{lan}</b>
          </div>

          <div className="muted mt12" style={{ lineHeight: 1.9 }}>
            {t('也可以直接把这个地址发到手机上打开：')}<br />
            <b>{lan}{info.url}</b>
            <button className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }} onClick={() => copy(lan + info.url)}>{t('复制')}</button>
          </div>
        </>
      ) : (
        <div className="muted" style={{ lineHeight: 1.9 }}>
          {t('还没有生成安装包。在电脑上运行')} <b>npm run apk</b> {t('即可打包，产物会出现在')} <b>release/</b> {t('目录，之后回到这一页就能下载。')}
        </div>
      )}
    </div>
  );
}
