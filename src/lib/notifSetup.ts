// 通知权限的启动自检
//
// 安卓 13（API 33）起 POST_NOTIFICATIONS 必须运行时授权，不给的话系统会把
// 通知直接丢掉——表现就是"提醒像是没做"。这里负责：
//   建通知渠道 → 查权限 → 需要就问一次 → 拿到了就把未来 7 天的提醒排给系统。
//
// 两个坑，都在代码里绕开了：
//  1. window.Capacitor 不一定在 React 挂载时已经注入完，isNativeApp() 可能先
//     返回 false。只问一遍的话就永远不问了，所以要错开时间连试几次。
//  2. 系统授权框只会弹一次，之后 requestPermissions() 会静默返回 denied。
//     所以状态要摆在界面上，并且留一个"去系统设置"的出口。
import { useSyncExternalStore } from 'react';
import { isNativeApp, nativePermissionState, requestNativePermission, ensureChannel, openNotificationSettings } from './native';
import type { PermState } from './native';
import { rescheduleNow } from './nativeReminders';

export interface NotifSetup {
  state: PermState | 'idle' | 'checking';
  at: number;        // 上次查完的时间
  tries: number;     // 启动阶段试了几次
  channel: boolean;  // 通知渠道建好了没
}

let cur: NotifSetup = { state: 'idle', at: 0, tries: 0, channel: false };
const subs = new Set<() => void>();
const emit = () => { subs.forEach((f) => f()); };
const set = (patch: Partial<NotifSetup>) => { cur = { ...cur, ...patch }; emit(); };

export const getNotifSetup = () => cur;

export function useNotifSetup(): NotifSetup {
  return useSyncExternalStore(
    (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    getNotifSetup, getNotifSetup
  );
}

/** 查一遍权限；ask=true 时如果还没决定过就弹系统授权框 */
export async function checkNotificationPermission(ask = true): Promise<PermState> {
  if (!isNativeApp()) { set({ state: 'unsupported', at: Date.now() }); return 'unsupported'; }
  set({ state: 'checking' });
  const channel = await ensureChannel();
  let p: PermState = await nativePermissionState();
  if (ask && p === 'prompt') p = await requestNativePermission();
  set({ state: p, at: Date.now(), channel });
  if (p === 'granted') {
    try { await rescheduleNow(); } catch { /* 排期失败不影响权限判断 */ }
  }
  return p;
}

/**
 * 启动时调用。window.Capacitor 可能还没注入好，就错开时间多试几次；
 * 一旦拿到明确结论（granted / denied）就停。
 */
export async function initNotifications(): Promise<PermState> {
  const gaps = [0, 600, 1500, 3000];
  let last: PermState = 'unsupported';
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i]) await new Promise((r) => setTimeout(r, gaps[i]));
    last = await checkNotificationPermission(true);
    set({ tries: i + 1 });
    if (last !== 'unsupported') return last;
  }
  return last;
}

/** 跳系统通知设置；插件不可用时返回 false，调用方给文字指引 */
export async function openNotifSettings(): Promise<boolean> {
  return openNotificationSettings();
}
