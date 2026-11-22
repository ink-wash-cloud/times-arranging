// 桌面挂件的「外部窗口」
//
// 之前挂件只是应用窗口内部的一个浮层：最小化浏览器、或者切到别的程序，
// 它跟着一起消失，根本谈不上"显示在桌面上"。
//
// 现在走 Document Picture-in-Picture（Chrome / Edge 116+）：浏览器会给一个
// 真正的独立系统窗口，而且**由系统保证置顶**——这才是桌面挂件该有的样子。
// 不支持 PiP 的浏览器退化成 window.open 弹窗（独立窗口，但不保证置顶）。
// 两者都不行（比如手机浏览器）就继续用页面内浮层。

export type WidgetWindowMode = 'pip' | 'popup';

export interface WidgetWindowHandle {
  win: Window;
  mode: WidgetWindowMode;
}

/** documentPictureInPicture 还没进 TS 的标准库，自己声明一下 */
interface DocumentPiP {
  requestWindow: (opts?: { width?: number; height?: number; disallowReturnToOpener?: boolean }) => Promise<Window>;
  window: Window | null;
}
declare global {
  interface Window { documentPictureInPicture?: DocumentPiP; }
}

let handle: WidgetWindowHandle | null = null;
const listeners = new Set<() => void>();
const emit = () => { listeners.forEach((f) => f()); };

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function currentWidgetWindow(): WidgetWindowHandle | null {
  // 用户直接点窗口的关闭按钮时，window 会变成 closed，这里顺手自愈
  if (handle && handle.win.closed) handle = null;
  return handle;
}

/** 能不能开真正的置顶小窗 */
export function pipSupported(): boolean {
  return typeof window !== 'undefined'
    && !!window.documentPictureInPicture
    && typeof window.documentPictureInPicture.requestWindow === 'function';
}

/**
 * 把主文档的样式和主题搬到挂件窗口里。
 *
 * 新窗口是 about:blank：既不继承样式表，也不继承 :root 上的 CSS 变量和
 * data-theme 属性。不搬的话挂件在里面就是一坨没有样式的裸 HTML。
 */
function mirrorDocument(win: Window): void {
  const doc = win.document;
  const srcRoot = document.documentElement;

  // about:blank 没有地址基准，字体这类根路径资源会解析失败，补一个 <base>
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  doc.head.appendChild(meta);
  const baseEl = doc.createElement('base');
  baseEl.href = location.href;
  doc.head.appendChild(baseEl);

  // 样式表整体内联过去（同源，能读 cssRules；读不到就退化成外链）
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
      const style = doc.createElement('style');
      style.textContent = css;
      doc.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        doc.head.appendChild(link);
      }
    }
  }

  doc.title = '时序 · 桌面挂件';
  syncWidgetRoot(win);
  doc.body.className = 'widget-host';
}

// 换肤不会让挂件重新渲染（外观状态和数据库是两套订阅），
// 所以直接盯着根元素的属性变化，变了就把主题推过去。
let rootObserver: MutationObserver | null = null;

function watchRoot(): void {
  if (rootObserver) return;
  rootObserver = new MutationObserver(() => syncWidgetRoot());
  rootObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-perf', 'data-bd-mode', 'data-blobs', 'style']
  });
}

function unwatchRoot(): void {
  rootObserver?.disconnect();
  rootObserver = null;
}

/** 主题、性能档位、背景参数都挂在根元素上；换肤时要同步过去 */
export function syncWidgetRoot(win?: Window | null): void {
  const target = win || handle?.win;
  if (!target || target.closed) return;
  const src = document.documentElement;
  const dst = target.document.documentElement;
  dst.dataset.theme = src.dataset.theme || 'ins';
  dst.dataset.perf = src.dataset.perf || 'balanced';
  dst.dataset.bdMode = src.dataset.bdMode || 'preset';
  dst.dataset.blobs = src.dataset.blobs || 'static';
  dst.dataset.fog = src.dataset.fog || '1';
  // 语言也同步过去：挂件窗口是独立的文档，字体靠 data-cjk 决定要不要用自带中文字库
  if (src.dataset.lang) dst.dataset.lang = src.dataset.lang;
  if (src.dataset.cjk) dst.dataset.cjk = src.dataset.cjk;
  if (src.lang) dst.lang = src.lang;
  dst.style.cssText = src.style.cssText;      // --glass-tint / --bd-dim 等内联变量
}

/** 打开桌面挂件窗口；返回 null 表示这个浏览器两条路都走不通 */
export async function openWidgetWindow(width = 340, height = 470): Promise<WidgetWindowHandle | null> {
  const existing = currentWidgetWindow();
  if (existing) return existing;

  let win: Window | null = null;
  let mode: WidgetWindowMode = 'pip';

  if (pipSupported()) {
    try {
      win = await window.documentPictureInPicture!.requestWindow({ width, height });
    } catch {
      win = null;      // 没有用户手势 / 被策略拦住，走下面的退路
    }
  }
  if (!win) {
    mode = 'popup';
    const left = Math.max(0, (window.screen?.availWidth || 1280) - width - 40);
    win = window.open('', 'shixu-widget',
      'popup=1,width=' + width + ',height=' + height + ',left=' + left + ',top=90');
  }
  if (!win) return null;      // 弹窗被拦

  const handleWin = win;
  handle = { win: handleWin, mode };
  mirrorDocument(handleWin);
  watchRoot();
  // 用户点窗口自己的关闭按钮时把状态收回来
  handleWin.addEventListener('pagehide', () => {
    if (handle && handle.win === handleWin) { unwatchRoot(); handle = null; emit(); }
  });
  emit();
  return handle;
}

export function closeWidgetWindow(): void {
  const h = handle;
  handle = null;
  unwatchRoot();
  try { h?.win.close(); } catch { /* 已经关了 */ }
  emit();
}
