import React, { useEffect, useState } from 'react';
import { toast } from './ui';
import { t, useLang } from '../lib/i18n';
import { isNativeApp } from '../lib/native';
import {
  canInstall, isInstalled, promptInstall, subscribe, browserName, isLocalOrigin
} from '../lib/pwa';

/**
 * 「电脑应用」入口。
 *
 * 网页版是装在浏览器标签页里的，关掉标签页就没了、也没有独立图标。
 * 这里让电脑端也能像手机端那样变成一个真正的应用程序：
 * 独立窗口（无地址栏）、开始菜单/任务栏图标、离线可用、开机固定。
 *
 * 三条路径，按可用性依次降级：
 *   1. 浏览器给了安装入口 → 一键「安装到电脑」
 *   2. 已经装过 / 正跑在应用窗口里 → 直接告诉他怎么固定
 *   3. 浏览器不给（Firefox、或不是本机地址）→ 给手动安装步骤 + 免安装的启动器
 */
export default function DesktopAppPanel() {
  useLang();
  const [, force] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(location.origin);
    return subscribe(() => force((n) => n + 1));
  }, []);

  // 安卓应用里没必要显示"把电脑版装成应用"
  if (isNativeApp()) return null;

  const installed = isInstalled();
  const ready = canInstall();
  const local = isLocalOrigin();
  const browser = browserName();

  const install = async () => {
    setInstalling(true);
    try {
      const r = await promptInstall();
      if (r === 'accepted') toast(t('已开始安装，稍等片刻桌面会出现「时序」图标'), 'ok');
      else if (r === 'dismissed') toast(t('已取消安装'), 'err');
      else toast(t('浏览器没有给出安装入口，请按下面的步骤手动安装'), 'err');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="card mb12">
      <div className="card-h">
        <span className="ico">💻</span>
        <h3>{t('电脑应用')}</h3>
        <div className="right">
          {installed
            ? <span className="chip static on">{t('已在应用窗口中运行')}</span>
            : ready
              ? <span className="chip static on">{t('可以一键安装')}</span>
              : <span className="chip static">{t('需要手动安装')}</span>}
        </div>
      </div>

      <div className="muted mb12" style={{ lineHeight: 1.9 }}>
        {t('装成应用后：')}<b>{t('独立窗口、没有地址栏')}</b>{t('，开始菜单和任务栏有独立的「时序」图标，可以固定到任务栏、开机自启，断网也能打开（数据本来就在本地）。')}
      </div>

      {installed ? (
        <>
          <div className="mb12" style={{ lineHeight: 1.9 }}>
            {t('✅ 你现在就是通过应用窗口打开的，已经是一个独立的电脑程序了。')}
          </div>
          <div className="muted" style={{ lineHeight: 2 }}>
            · {t('想固定到任务栏：在任务栏图标上右键 →')} <b>{t('固定到任务栏')}</b><br />
            · {t('想开机自启：任务管理器 → 启动应用 → 把「时序」设为启用')}<br />
            · {t('想卸载：Windows 设置 → 应用 → 找到「时序」→ 卸载')}
          </div>
        </>
      ) : ready ? (
        <>
          <div className="row-wrap mb12">
            <button className="btn btn-primary" onClick={install} disabled={installing}>
              {installing ? t('安装中…') : t('⬇ 安装到电脑')}
            </button>
            <span className="muted">{t('会弹一次系统确认框，点「安装」即可')}</span>
          </div>
          <div className="muted" style={{ lineHeight: 1.9 }}>
            {t('装完之后这一栏会变成「已在应用窗口中运行」，之后从开始菜单或桌面图标打开就是独立应用了。')}
          </div>
        </>
      ) : (
        <>
          <div className="muted mb8" style={{ lineHeight: 1.9 }}>
            {local
              ? t('当前是 {browser}。这个浏览器没有提供应用安装入口，按下面的步骤手动装。', { browser })
              : t('当前是 {browser}，而且你是用局域网地址 {origin} 打开的。浏览器只允许把「本机地址或 HTTPS」的页面装成应用——请在电脑上改用下面的地址打开。', { browser, origin })}
          </div>

          {!local && (
            <div className="mb12" style={{ lineHeight: 1.9 }}>
              {t('请用这个地址打开：')}<b>http://localhost:8787</b>
              <button className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }}
                onClick={async () => {
                  // 剪贴板可能被浏览器拒绝（非 HTTPS 的局域网地址、或没给权限），别让它变成未捕获的 rejection
                  try {
                    await navigator.clipboard.writeText('http://localhost:8787');
                    toast(t('已复制'), 'ok');
                  } catch {
                    toast(t('复制失败，请手动选中地址复制'), 'err');
                  }
                }}>
                {t('复制')}
              </button>
            </div>
          )}

          {local && (
            <div className="muted" style={{ lineHeight: 2 }}>
              <b>Edge</b>{t('：右上角「…」→ 应用 →')} <b>{t('将此站点作为应用安装')}</b><br />
              <b>Chrome</b>{t('：地址栏最右侧的')} <b>{t('⊕ / 显示器图标')}</b>{t('，或「…」→ 投放、保存和共享 → 安装页面为应用')}<br />
              {t('装好后同样会出现在开始菜单里。')}
            </div>
          )}

          <div className="muted mt12" style={{ lineHeight: 1.9 }}>
            {t('不想安装也行：双击项目根目录的')} <b>启动时序.vbs</b>{t('，它会自动在后台拉起同步服务、并打开一个无地址栏的应用窗口，效果基本一样。')}
          </div>
        </>
      )}
    </div>
  );
}
