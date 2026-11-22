// 构建版本自检：产物变了就自动换成新的
//
// 为什么需要这个：Service Worker 会把上一次构建的页面整套缓存下来。
// 代码改了、dist 重新构建了，但如果用户一直开着旧页面（尤其是电脑端那个应用窗口，
// 它可能几天都不关），拿到的仍然是旧版本——看起来就像"更新了但没生效"。
// 这个坑已经踩过一次，所以做成自愈的。
//
// 做法：定期（以及每次切回前台时）用 no-store 拉一次 index.html，
// 比对它引用的 assets/index-XXXX.js 和当前正在跑的是不是同一个。
// 不一样就刷新；如果刷新过一次还是旧的，直接把 Service Worker 和缓存全删掉再来一次。

const RELOAD_KEY = 'shixu.updateReloadedFor';

function runningBundle(): string {
  const s = document.querySelector('script[type="module"][src*="/assets/index-"]');
  return s ? (s.getAttribute('src') || '') : '';
}

async function servedBundle(): Promise<string> {
  const res = await fetch('/index.html?t=' + Date.now(), { cache: 'no-store' });
  if (!res.ok) return '';
  const m = (await res.text()).match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  return m ? m[0] : '';
}

/** 等新 Service Worker 接管页面（clientsClaim 生效），最多等 8 秒 */
function waitForController(): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 8000);
    navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/** 兜底方案：注销 Service Worker 并清掉所有缓存，保证下次拿到的就是服务器上的文件 */
async function nukeCaches(): Promise<void> {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* 没有就算了 */ }
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* 同上 */ }
}

async function check(): Promise<void> {
  if (document.hidden) return;
  let served = '';
  try {
    served = await servedBundle();
  } catch {
    return;                      // 服务没跑/离线，下一轮再说
  }
  if (!served) return;
  const running = runningBundle();
  if (!running || running.includes(served)) return;   // 已经是最新

  // 同一个新版本只硬刷一次，避免新版拿不到时无限刷新
  if (sessionStorage.getItem(RELOAD_KEY) === served) {
    await nukeCaches();
    sessionStorage.removeItem(RELOAD_KEY);
    location.reload();
    return;
  }
  sessionStorage.setItem(RELOAD_KEY, served);
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update();
      await waitForController();
    }
  } catch { /* 忽略，直接刷 */ }
  location.reload();
}

let started = false;

export function watchForNewBuild(): void {
  if (started || !runningBundle()) return;
  started = true;
  // 启动时先查一次：应用窗口常年不关，光靠"下次打开"是不够的
  setTimeout(() => { void check(); }, 2500);
  setInterval(() => { void check(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
  window.addEventListener('focus', () => { void check(); });
}
