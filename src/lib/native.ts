// 原生（Capacitor）桥接层：网页版走浏览器 API，安卓包走系统能力
// 所有原生插件都用动态 import，网页构建不会把它们打进包里

interface CapGlobal { isNativePlatform?: () => boolean; getPlatform?: () => string; }

export function capGlobal(): CapGlobal | null {
  const c = (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
  return c && typeof c.isNativePlatform === 'function' ? c : null;
}

export function isNativeApp(): boolean {
  const c = capGlobal();
  try { return !!(c && c.isNativePlatform && c.isNativePlatform()); } catch { return false; }
}

export function platformName(): string {
  const c = capGlobal();
  try { return (c && c.getPlatform && c.getPlatform()) || 'web'; } catch { return 'web'; }
}

type LN = typeof import('@capacitor/local-notifications').LocalNotifications;

/**
 * 拿到本地通知插件实例。
 *
 * 这里有个非常阴的坑，整个通知功能之前就是死在这上面：
 *   LocalNotifications 是个 Proxy，取【任何】属性都会返回一个函数 —— 包括 then。
 *   于是它同时是个 thenable。只要哪个 Promise 把【它本身】当作兑现值，引擎就会
 *   把它当 thenable，去调 plugin.then(resolve, reject)，最后抛
 *     "LocalNotifications.then() is not implemented"
 *   这个错误被 catch 吞掉之后，插件就被判成"不可用"—— 权限永远不申请、提醒静默失效。
 *
 * 所以：这个 Proxy 绝不能作为 Promise 的兑现值出现（async 函数的 return 也不行）。
 * 必须包在普通对象里穿过 Promise（下面这样），或者只作为回调参数出现。
 */
let lnBox: Promise<{ plugin: LN } | null> | null = null;

function loadLN(): Promise<{ plugin: LN } | null> {
  if (!lnBox) {
    lnBox = import('@capacitor/local-notifications')
      .then((m) => ({ plugin: m.LocalNotifications }))
      .catch(() => null);
  }
  return lnBox;
}

/** 插件到底能不能用（上层据此判断 unsupported） */
export async function lnotifAvailable(): Promise<boolean> {
  if (!isNativeApp()) return false;
  const box = await loadLN();
  return !!box;
}

export type PermState = 'granted' | 'denied' | 'prompt' | 'unsupported';

/**
 * 各平台对"还没决定"的叫法不一样：
 *   安卓桥接层给 'prompt'
 *   插件的 web 实现直接把浏览器的 'default' 透出来
 *   iOS 还可能给 'prompt-with-rationale'
 * 不归一化的话，'default' 这种值会既不等于 prompt 也不等于 granted，
 * 结果就是"该弹框的时候不弹、该提示的时候不提示"。
 */
export function normPerm(s: unknown): PermState {
  const v = String(s == null ? '' : s);
  if (v === 'granted') return 'granted';
  if (v === 'denied') return 'denied';
  if (v === 'prompt' || v === 'default' || v.startsWith('prompt')) return 'prompt';
  return 'unsupported';
}

export async function nativePermissionState(): Promise<PermState> {
  if (!isNativeApp()) return 'unsupported';
  const box = await loadLN();
  if (!box) return 'unsupported';
  const ln = box.plugin;
  try {
    const r = await ln.checkPermissions();
    return normPerm(r.display);
  } catch { return 'unsupported'; }
}

export async function requestNativePermission(): Promise<PermState> {
  if (!isNativeApp()) return 'unsupported';
  const box = await loadLN();
  if (!box) return 'unsupported';
  const ln = box.plugin;
  try {
    const r = await ln.requestPermissions();
    // 问完还是 prompt 说明没问出结果，按"没给"处理，别让界面以为已经拿到了
    const p = normPerm(r.display);
    return p === 'prompt' ? 'denied' : p;
  } catch { return 'denied'; }
}

/**
 * 跳到系统的「应用通知设置」页。
 * 安卓的授权框只会弹一次，用户要是当时点了拒绝，之后再问就是静默 denied，
 * 网页层没有任何办法把他引回去——所以专门加了这个原生小插件。
 * 返回 false 表示插件不可用（比如跑在浏览器里），调用方负责给文字指引。
 */
export async function openNotificationSettings(): Promise<boolean> {
  const c = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const p = c && c.Plugins ? (c.Plugins.NotifSettings as { open?: () => Promise<void> } | undefined) : undefined;
  if (!p || typeof p.open !== 'function') return false;
  try { await p.open(); return true; } catch { return false; }
}

/** 用字符串稳定地推出一个 32 位通知 id，保证同一条提醒重复调度时能覆盖而不是堆积 */
export function notifId(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2000000000;
}

export interface PlannedNotif { id: number; key: string; title: string; body: string; at: Date; }

const SCHED_KEY = 'nativeNotifIds';

// 渠道 id 带版本号：Android 的渠道一旦创建，**重要性就改不了了**，
// 老版本用低重要性建过 'shixu'，再写 importance:5 也不会生效。
// 换个新 id 才能拿到"横幅弹出 + 声音 + 震动 + 显示在通知栏顶部"的行为。
const CHANNEL_ID = 'shixu-alerts-v2';

let lastError = '';
/** 最近一次系统通知相关的错误，面板上要显示出来（以前是静默吞掉的） */
export const lastNotifError = () => lastError;

/**
 * 建/确认通知渠道。
 * importance: 5（MAX）→ 通知会以横幅弹出、响铃、震动，并常驻通知栏；
 * 用默认重要性的话，通知会静静地躺在通知栏底部，很容易被当成"没提醒"。
 */
export async function ensureChannel(): Promise<boolean> {
  if (!isNativeApp()) return false;
  const box = await loadLN();
  if (!box) { lastError = '本地通知插件不可用'; return false; }
  const ln = box.plugin;
  try {
    await ln.createChannel({
      id: CHANNEL_ID,
      name: '时序提醒',
      description: '待办截止、纪念日、习惯打卡、上课提醒、人生最新一次',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#e08fa4'
    });
    return true;
  } catch (e) {
    lastError = '创建通知渠道失败：' + String((e as Error).message || e);
    return false;
  }
}

/** 取消上一轮排期的全部通知 */
export async function cancelPlanned(): Promise<void> {
  if (!isNativeApp()) return;
  const box = await loadLN();
  if (!box) return;
  const ln = box.plugin;
  let ids: number[] = [];
  try { ids = JSON.parse(localStorage.getItem(SCHED_KEY) || '[]'); } catch { /* 忽略 */ }
  if (!ids.length) return;
  try { await ln.cancel({ notifications: ids.map((id) => ({ id })) }); } catch { /* 忽略 */ }
  localStorage.setItem(SCHED_KEY, '[]');
}

export interface ScheduleResult { ok: boolean; count: number; error: string; }

/** 把计划好的通知交给系统（应用关掉也会按时弹） */
export async function schedulePlanned(items: PlannedNotif[]): Promise<ScheduleResult> {
  lastError = '';
  if (!isNativeApp()) return { ok: false, count: 0, error: '本地通知插件不可用（不是原生环境？）' };
  const box = await loadLN();
  if (!box) return { ok: false, count: 0, error: '本地通知插件不可用（不是原生环境？）' };
  const ln = box.plugin;
  await cancelPlanned();
  const now = Date.now();
  const valid = items.filter((i) => i.at.getTime() > now + 5000);
  if (!valid.length) return { ok: true, count: 0, error: '' };
  await ensureChannel();
  try {
    await ln.schedule({
      notifications: valid.map((i) => ({
        id: i.id,
        title: i.title,
        body: i.body,
        channelId: CHANNEL_ID,
        autoCancel: true,
        schedule: { at: i.at, allowWhileIdle: true }
      }))
    });
    localStorage.setItem(SCHED_KEY, JSON.stringify(valid.map((i) => i.id)));
    return { ok: true, count: valid.length, error: '' };
  } catch (e) {
    // 以前这里是 catch { return 0 }，出了问题用户完全看不出来，
    // 只能看到"没有提醒"——所以现在把原因带出去，显示在设置页。
    lastError = '排期失败：' + String((e as Error).message || e);
    return { ok: false, count: 0, error: lastError };
  }
}

export interface NotifyResult { ok: boolean; error: string; }

/** 立即弹一条系统通知（提醒到点时用，也会出现在通知栏） */
export async function nativeNotifyNow(title: string, body: string, key: string): Promise<NotifyResult> {
  lastError = '';
  if (!isNativeApp()) return { ok: false, error: '本地通知插件不可用' };
  const box = await loadLN();
  if (!box) return { ok: false, error: '本地通知插件不可用' };
  const ln = box.plugin;
  // 必须确保渠道存在：渠道不存在时通知会走默认渠道，重要性低、不弹横幅
  await ensureChannel();
  try {
    await ln.schedule({
      notifications: [{
        id: notifId(key + ':' + Date.now()),
        title,
        body,
        channelId: CHANNEL_ID,
        autoCancel: true,
        schedule: { at: new Date(Date.now() + 300) }
      }]
    });
    return { ok: true, error: '' };
  } catch (e) {
    lastError = '发送失败：' + String((e as Error).message || e);
    return { ok: false, error: lastError };
  }
}
