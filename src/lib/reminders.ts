// 事项临近提醒
// 网页版：浏览器通知，需要页面处于打开状态
// 安卓包：走系统本地通知，应用关掉也能按时弹
import { list, cfg } from './db';
import { isNativeApp, nativePermissionState, requestNativePermission, nativeNotifyNow } from './native';
import type { TaskData, AnniversaryData, LifeEventData } from '../types';
import { todayStr, nowHM, daysFromToday, timeToMinutes, nextOccurrence, diffDays, pick } from './date';
import { t } from './i18n';

export interface ReminderConfig {
  enabled: boolean;
  leadMinutes: number;     // 截止前多少分钟提醒
  taskOn: boolean;
  anniversaryOn: boolean;
  anniversaryDays: number; // 提前多少天提醒
  habitOn: boolean;
  habitAfter: string;      // 到点还没打卡就提醒 HH:mm
  lifeOn: boolean;
}

function loadCfg(): ReminderConfig {
  const base: ReminderConfig = {
    // 默认就开着。以前默认 false，用户不在设置里手动勾上就什么都收不到，
    // 表现就是"提醒功能像是没有"。
    enabled: true, leadMinutes: 60, taskOn: true, anniversaryOn: true,
    anniversaryDays: 3, habitOn: true, habitAfter: '20:00', lifeOn: true
  };
  try {
    const raw = localStorage.getItem('reminderCfg');
    if (raw) Object.assign(base, JSON.parse(raw));
  } catch { /* 忽略损坏的配置 */ }
  return base;
}

export const reminderCfg: ReminderConfig = loadCfg();

const fired = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(msg: string) => void>();

export function onReminder(fn: (msg: string) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export async function permissionState(): Promise<string> {
  if (isNativeApp()) return nativePermissionState();
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestPermission(): Promise<string> {
  if (isNativeApp()) return requestNativePermission();
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    const p = await Notification.requestPermission();
    return p;
  } catch {
    return 'denied';
  }
}

let lastPushError = '';
/** 最近一次"发系统通知"失败的原因，设置页要能看到 */
export const lastNativePushError = () => lastPushError;

/**
 * @param systemToo 是否连系统通知一起发。
 *   安卓端已经由 nativeReminders 把"未来 7 天"整批排给系统了，
 *   那些类别（纪念日 / 习惯 / 人生最新一次 / 有具体截止时间的待办）
 *   如果这里再发一次，用户在通知栏会看到两条一模一样的提醒。
 *   所以只有"排期覆盖不到"的类别（已逾期、只填了日期没填时间的今日待办）
 *   才需要在这里补一条系统通知。
 */
function push(title: string, body: string, systemToo = true) {
  // 应用内也提示一下（用户正看着应用时不用去翻通知栏）
  listeners.forEach((f) => f(title + ' · ' + body));
  if (isNativeApp()) {
    if (!systemToo) return;
    nativeNotifyNow(title, body, title).then((r) => { lastPushError = r.ok ? '' : r.error; })
      .catch((e) => { lastPushError = String(e); });
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag: title + body, icon: '/icons/icon-192.png' });
    setTimeout(() => n.close(), 12000);
  } catch { /* 部分浏览器要求 ServiceWorkerRegistration.showNotification */ }
}

function once(key: string): boolean {
  if (fired.has(key)) return false;
  fired.add(key);
  if (fired.size > 500) fired.clear();
  return true;
}

export function scanNow(force = false): number {
  if (!reminderCfg.enabled && !force) return 0;
  const today = todayStr();
  const nowMin = timeToMinutes(nowHM());
  let n = 0;

  if (reminderCfg.taskOn) {
    for (const task of list<TaskData>('tasks')) {
      if (task.status === '已完成' || !task.dueDate) continue;
      const dd = daysFromToday(task.dueDate);
      const due = task.dueDate === today && task.dueTime ? timeToMinutes(task.dueTime) : null;
      if (dd < 0 && once('overdue:' + task.id + ':' + today)) {
        // 逾期是排期覆盖不到的（排期只排未来的时刻），要补系统通知
        push(t('⏰ 已逾期：{title}', { title: task.title }), t('截止 {date}，该处理一下了', { date: task.dueDate }), true);
        n++; continue;
      }
      if (dd === 0 && due !== null) {
        const left = due - nowMin;
        if (left <= reminderCfg.leadMinutes && left >= -5 && once('due:' + task.id + ':' + today)) {
          // 有具体时间的待办已经在排期里了，这里只做应用内提示
          push(t('⏰ 即将截止：{title}', { title: task.title }), left <= 0 ? t('已到截止时间') : t('还有 {n} 分钟（{time}）', { n: left, time: task.dueTime }), false);
          n++;
        }
      } else if (dd === 0 && once('today:' + task.id + ':' + today)) {
        // 只填日期没填时间的，排期排不出来，补系统通知
        push(t('📌 今日待办：{title}', { title: task.title }), t('预计耗时 {n} 分钟', { n: task.estimateMinutes || 0 }), true);
        n++;
      }
    }
  }

  if (reminderCfg.anniversaryOn) {
    for (const a of list<AnniversaryData>('anniversaries')) {
      const next = nextOccurrence(a.date, a.repeatYearly !== false, today);
      const d = diffDays(today, next);
      if (d <= reminderCfg.anniversaryDays && d >= 0 && once('ann:' + a.id + ':' + next)) {
        // 纪念日已由排期覆盖（当天 09:00），这里只做应用内提示
        push((a.icon || '🎂') + ' ' + a.title + (d === 0 ? ' ' + t('就是今天') : ' ' + t('还有 {n} 天', { n: d })), t('准备进度 {n}%', { n: a.progress || 0 }), false);
        n++;
      }
    }
  }

  if (reminderCfg.habitOn && nowMin >= timeToMinutes(reminderCfg.habitAfter)) {
    const done = new Set(list<{ habitId: string; date: string }>('habitLogs').filter((l) => l.date === today).map((l) => l.habitId));
    const pending = list<{ name: string; paused: boolean }>('habits').filter((h) => !h.paused && !done.has(h.id));
    if (pending.length && once('habit:' + today + ':' + pending.length)) {
      push(t('🔥 今天还有 {n} 个习惯没打卡', { n: pending.length }), pending.slice(0, 4).map((h) => h.name).join(pick('、', '、', ', ', '、')), false);
      n++;
    }
  }

  if (reminderCfg.lifeOn) {
    for (const e of list<LifeEventData>('lifeEvents')) {
      const d = daysFromToday(e.lastDate);
      if (e.cycleDays > 0 && d >= e.cycleDays && once('life:' + e.id + ':' + d)) {
        push((e.icon || '🕰️') + ' ' + t('该安排了：{title}', { title: e.title }), t('上次 {date}，已过 {n} 天（建议 {m} 天）', { date: e.lastDate, n: d, m: e.cycleDays }), false);
        n++;
      }
    }
  }
  return n;
}

export function startReminders() {
  stopReminders();
  timer = setInterval(() => { scanNow(); }, 30000);
  setTimeout(() => scanNow(), 4000);
}

export function stopReminders() {
  if (timer) { clearInterval(timer); timer = null; }
}
