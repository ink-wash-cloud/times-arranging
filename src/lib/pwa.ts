// 电脑端「应用版」支持
//
// 浏览器（Chrome / Edge）允许把站点装成真正的桌面应用：独立窗口、没有地址栏、
// 开始菜单和任务栏有独立图标、可固定、离线可用。触发安装的唯一入口是
// beforeinstallprompt 事件，而且它只在"满足可安装条件"时才触发、且只能问一次，
// 所以必须在页面加载的最早期就拦下来存好，等用户点按钮时再用。

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const emit = () => { listeners.forEach((f) => f()); };

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // 拦下浏览器自己弹的迷你提示条，改由应用内的「安装到电脑」按钮来触发，
    // 这样用户知道自己在装什么、装到哪。
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    justInstalled = true;
    emit();
  });
}

/** 当前是否运行在"应用窗口"里（而不是普通浏览器标签页） */
export function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** 浏览器是否已经把安装入口交给我们了 */
export function canInstall(): boolean { return !!deferred; }

/** 已经装好了（本次会话刚装完，或本来就跑在应用窗口里） */
export function isInstalled(): boolean { return justInstalled || isStandalone(); }

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export type InstallResult = 'accepted' | 'dismissed' | 'unavailable';

/** 弹出系统安装确认框 */
export async function promptInstall(): Promise<InstallResult> {
  const ev = deferred;
  if (!ev) return 'unavailable';
  deferred = null;          // 这个事件只能问一次，用完即弃
  emit();
  try {
    await ev.prompt();
  } catch {
    return 'unavailable';
  }
  const choice = await ev.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  if (choice.outcome === 'accepted') justInstalled = true;
  emit();
  return choice.outcome;
}

/** 当前浏览器名，用来给"手动安装"指路 */
export function browserName(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return '当前浏览器';
}

/** 是不是本机地址（只有本机地址或 HTTPS 才允许装成应用） */
export function isLocalOrigin(): boolean {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
}
