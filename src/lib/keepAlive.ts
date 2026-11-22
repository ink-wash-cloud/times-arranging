// 页面心跳：告诉服务器"我还开着"，关窗口时说声再见。
//
// 服务器带 SHIXU_AUTO_EXIT=1 启动时（也就是从「时序」快捷方式启动时），
// 收不到心跳就自己退出——这样关掉电脑端应用不会留下后台的 node 进程。
// 手动 npm start 不带那个变量，服务器照旧常驻。

import { isNativeApp } from './native';

const HERE_MS = 10000;

export function startKeepAlive(): () => void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return () => {};
  let stopped = false;

  const ping = () => {
    if (stopped) return;
    // keepalive 让请求在页面正在卸载时也能发出去
    fetch('/api/here', { method: 'GET', cache: 'no-store', keepalive: true }).catch(() => { /* 服务器没开就算了 */ });
  };

  const bye = () => {
    // 手机的 WebView 切到后台、锁屏也会触发 pagehide，这时候把服务器带走就没人给手机同步了。
    // 所以只有电脑端网页才发告别信。
    if (isNativeApp()) return;
    try { navigator.sendBeacon?.('/api/bye'); } catch { /* 忽略 */ }
  };

  const onVisible = () => { if (document.visibilityState === 'visible') ping(); };

  ping();
  const timer = window.setInterval(ping, HERE_MS);
  // 刷新也会触发 pagehide，但新页面会立刻重新报到，服务器有 10 秒宽限期，退不掉
  window.addEventListener('pagehide', bye);
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('pagehide', bye);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
