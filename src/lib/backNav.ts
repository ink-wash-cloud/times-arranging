// 安卓返回键 / 侧滑手势：先退一层，退到底才提示"再滑一次退出应用"
//
// 背景：以前项目里没有 @capacitor/app，安卓返回键走的是 Capacitor 的默认行为
// （webview 都没得回退就直接 finish 掉 Activity），所以手机上侧滑一下就退出应用了，
// 用户会以为是崩了。现在装了 @capacitor/app：BridgeActivity 的 OnBackPressedCallback
// 会把返回键变成 JS 上的 backbutton 事件（见 AppPlugin.java 40-62 行），
// 并且不再自动退出，退不退由我们决定。
//
// 分层拦截顺序（后注册的优先）：
//   1. 弹窗 / 浮层：自己注册处理器，返回键先关它们
//   2. 页面栈：不是首页就回上一级（App.tsx 里注册）
//   3. 首页：第一次只提示，2.5 秒内再滑一次才真的退出（防误触）
import { App } from '@capacitor/app';
import { isNativeApp } from './native';

/** 返回处理器：返回 true 表示"这一下我处理了，别再往外层传" */
export type BackHandler = () => boolean;

/** 两次返回最多间隔多久算"连按"（毫秒） */
export const EXIT_GAP = 2500;

const stack: BackHandler[] = [];
let lastRootAt = 0;
const stats = { prompts: 0, exits: 0 };
let notify: ((msg: string) => void) | null = null;

/** 轻提示的实现由界面层注入（免得 lib 反过来 import 组件） */
export function setBackNotifier(fn: ((msg: string) => void) | null) {
  notify = fn;
}

/** 注册一个返回处理器，返回注销函数。组件卸载时务必调用 */
export function pushBackHandler(fn: BackHandler): () => void {
  stack.push(fn);
  return () => {
    const i = stack.indexOf(fn);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** 从最内层往外问一圈：有没有人处理这一下返回 */
export function runBackHandlers(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      if (stack[i]()) return true;
    } catch {
      // 单个处理器抛错不能把整个返回链路吃掉
    }
  }
  return false;
}

/** 真的退出应用（只在本机壳里有效；网页里就是个空动作） */
export async function exitApp(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await App.exitApp();
  } catch {
    // 插件不可用时什么都不做，总比抛出去让界面报错好
  }
}

/**
 * 按一下返回键。
 * @returns 恒为 true：返回键一律由我们接管，不会再落到系统默认的"退出应用"
 */
export function pressBack(): boolean {
  if (runBackHandlers()) return true;
  const now = Date.now();
  if (now - lastRootAt < EXIT_GAP) {
    // 第二次：真的退出（防误触的另一半是下面那句提示）
    lastRootAt = 0;
    stats.exits += 1;
    void exitApp();
    return true;
  }
  lastRootAt = now;
  stats.prompts += 1;
  if (notify) notify('再滑一次退出应用');
  return true;
}

/** 调试 / 测试用：看清提示过几次、真的要退出几次，以及把计时器归零 */
export function backStats() {
  return { ...stats, armed: lastRootAt > 0 };
}
export function resetBackState() {
  lastRootAt = 0;
  stats.prompts = 0;
  stats.exits = 0;
}

/** 监听安卓返回键 / 侧滑。网页里没有返回键，直接返回空注销函数 */
export async function initBackNav(): Promise<() => void> {
  if (!isNativeApp()) return () => {};
  try {
    const h = await App.addListener('backButton', () => { pressBack(); });
    return () => { void h.remove(); };
  } catch {
    return () => {};
  }
}
