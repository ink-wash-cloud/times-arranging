// 全屏与系统栏适配
//
// 目标：应用在前台时，状态栏（顶部的时间/电量那条）背后就是应用自己的背景，
// 而不是系统糊上去的一条纯色。
//
// 做法是 edge-to-edge：内容铺满整个窗口（含状态栏和导航栏区域），
// 两条系统栏设成透明，于是"透出来的"就是应用的背景本身。
// 网页端则用 Fullscreen API 把浏览器自己的界面也收掉。
import { isNativeApp } from './native';

/* --------------------------- 安卓：edge-to-edge --------------------------- */

async function applyBars(theme: 'ins' | 'neon'): Promise<void> {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setOverlaysWebView({ overlay: true });
    // ins 是奶油底 → 要深色图标；neon 是深色底 → 要浅色图标
    await StatusBar.setStyle({ style: theme === 'ins' ? Style.Dark : Style.Light });
  } catch {
    // 插件不可用（网页端/旧包）就算了，不影响别的功能
  }
}

let barsInited = false;

/** 应用启动时调一次；之后主题变了会自动跟着换图标颜色 */
export function initSystemBars(): void {
  if (barsInited || !isNativeApp()) return;
  barsInited = true;
  const apply = () => {
    const t = (document.documentElement.dataset.theme === 'neon' ? 'neon' : 'ins');
    void applyBars(t);
  };
  apply();
  // 外观状态和数据库是两套订阅，换肤不会让 App 重渲染，直接盯根元素最省事
  new MutationObserver(apply).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
}

/* ---------------------------- 网页：全屏开关 ---------------------------- */

export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
}

export function isFullscreen(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenElement;
}

/** 返回切换后是否处于全屏 */
export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return false;
    }
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch {
    return isFullscreen();
  }
}

/** 全屏状态变化时回调（例如用户按 Esc 退出），返回取消订阅函数 */
export function onFullscreenChange(fn: (on: boolean) => void): () => void {
  const h = () => fn(isFullscreen());
  document.addEventListener('fullscreenchange', h);
  return () => document.removeEventListener('fullscreenchange', h);
}
