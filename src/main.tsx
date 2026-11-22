import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { cfg, loadConfig, loadAll } from './lib/db';
import { initLang, t } from './lib/i18n';
import { loadAppearance, bindVisibilityPause } from './lib/appearance';
import { ensureWebFont } from './lib/fonts';
import { initPointerGlow } from './lib/pointerGlow';
import { initSlidingIndicators } from './lib/motion';
import { registerSW } from 'virtual:pwa-register';
import { watchForNewBuild } from './lib/updateCheck';
import { startKeepAlive } from './lib/keepAlive';
import { initWidget } from './lib/widget';
import { planUpcoming, lastPlan, rescheduleNow } from './lib/nativeReminders';
import ErrorBoundary from './components/ErrorBoundary';

// 异步里抛出的错误不会触发 React 的兜底，但同样会让界面停在半死不活的状态。
// 统一记到控制台，手机上接调试也能看到。
window.addEventListener('unhandledrejection', (e) => {
  try { console.error('[未处理的 Promise 错误]', e.reason); } catch { /* 忽略 */ }
});
window.addEventListener('error', (e) => {
  try { console.error('[未捕获错误]', e.error || e.message); } catch { /* 忽略 */ }
});

/** 启动阶段就挂掉时的兜底页。原来是一行红字配默认黑底，手机上看着就是"黑屏"。 */
function fatal(e: unknown): void {
  const el = document.getElementById('root');
  if (!el) return;
  const msg = String((e as Error)?.stack || e);
  el.innerHTML = '';
  // body 本身的底色来自主题变量（默认是深色），不盖掉的话边缘会露出黑边
  try { document.body.style.background = '#fbf5ee'; } catch { /* 忽略 */ }
  const box = document.createElement('div');
  box.setAttribute('style', [
    'min-height:100vh', 'padding:28px 18px', 'box-sizing:border-box',
    'background:#fbf5ee', 'color:#4b4249',
    'font:14px/1.85 -apple-system,"Noto Sans SC",system-ui,sans-serif'
  ].join(';'));
  box.innerHTML =
    '<div style="max-width:560px;margin:0 auto">' +
    '<div style="font-size:30px;margin-bottom:6px">😵</div>' +
    '<h1 style="font-size:19px;margin:0 0 10px">' + t('应用没能启动') + '</h1>' +
    '<p style="margin:0 0 6px;color:#7b6f76">' + t('数据都在本机／服务器上，没有丢。把下面这段发我就能修。') + '</p>' +
    '<p style="margin:0 0 12px;font-size:12px;color:#8b7f86">' + t('版本 v{version} · 构建 {build}', { version: __APP_VERSION__, build: __BUILD_ID__ }) + '</p>' +
    '<pre style="background:#fff;border:1px solid rgba(150,124,136,.28);border-radius:12px;padding:10px 12px;' +
    'font-size:11.5px;line-height:1.6;max-height:240px;overflow:auto;white-space:pre-wrap;word-break:break-word"></pre>' +
    '<div style="margin-top:16px"><button id="fix-retry" style="border:none;border-radius:999px;padding:9px 18px;' +
    'font-size:13.5px;background:#e08fa4;color:#fff">' + t('重新加载') + '</button></div>' +
    '<p style="margin-top:14px;font-size:12px;color:#8b7f86">' + t('如果一直起不来，试着清掉应用数据后重装。') + '</p>' +
    '</div>';
  el.appendChild(box);
  const pre = box.querySelector('pre');
  if (pre) pre.textContent = msg;
  box.querySelector('#fix-retry')?.addEventListener('click', () => location.reload());
}

async function boot() {
  await loadConfig();
  // 语言要在渲染前定下来：首帧就得是用户上次选的那一种，别先闪一下中文
  initLang(cfg.lang);
  await loadAppearance();
  await loadAll();
  ensureWebFont().catch(() => { /* 没放字库文件就用系统字体，不打扰用户 */ });

  const el = document.getElementById('root');
  createRoot(el as HTMLElement).render(
    React.createElement(React.StrictMode, null,
      React.createElement(ErrorBoundary, null, React.createElement(App)))
  );

  initPointerGlow();
  initSlidingIndicators();
  bindVisibilityPause();
  // 让服务器知道页面还开着（服务器可能是"跟随页面"模式启动的）
  startKeepAlive();

  // 手机桌面小组件：取回在桌面上点掉的待办，并把今天的清单推过去
  void initWidget();

  // 提醒排程的自检入口：设置页和自动化测试要能看清"到底排了哪几条通知"
  // （排期本身只在原生端真正下发给系统，网页里只是算出来）
  const hook = (window as unknown as { __schedule?: Record<string, unknown> }).__schedule;
  if (hook) hook.plan = { upcoming: planUpcoming, last: lastPlan, now: rescheduleNow };

  try {
    registerSW({ immediate: true });
  } catch (e) {
    console.warn('Service Worker 注册失败', e);
  }

  // 构建产物变了就自动换新的（Service Worker 会缓存旧页面，见该文件注释）
  watchForNewBuild();
}

boot().catch(fatal);
