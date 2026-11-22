// 长远目标的纯工具：提醒预设、排序、到点判断、本机进度日志。
// 这里只做计算，不碰 React；文案由 Tasks.tsx 在渲染时 t()。
import type { GoalData } from '../types';
import { addDays, diffDays, pad2, parseYMD, todayStr, ymd } from './date';

export type GoalRemindPreset = '30d' | '3m' | '6m' | '12m';

/** 新建目标面板上的四档提醒；label 是 t() 的 key，渲染时再翻译。 */
export const GOAL_REMIND_PRESETS: Array<{ key: GoalRemindPreset; label: string }> = [
  { key: '30d', label: '30 天后' },
  { key: '3m', label: '3 个月后' },
  { key: '6m', label: '半年后' },
  { key: '12m', label: '一年后' }
];

/** 按月加，月底会夹到目标月的最后一天（1 月 31 日 + 1 个月 = 2 月 28/29 日）。 */
export function addMonths(s: string, n: number): string {
  const d = parseYMD(s);
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return ymd(target);
}

/** 把「30 天后 / 3 个月后 / 半年后 / 一年后」换算成具体提醒时刻（09:00）。 */
export function presetRemindAt(key: GoalRemindPreset, from: string = todayStr()): string {
  if (key === '30d') return addDays(from, 30) + 'T09:00';
  const months = key === '3m' ? 3 : key === '6m' ? 6 : 12;
  return addMonths(from, months) + 'T09:00';
}

/** 自定义提醒的起点：明天 09:00，比空着好填。 */
export function defaultCustomRemindAt(): string {
  return addDays(todayStr(), 1) + 'T09:00';
}

export function localNowInput(): string {
  const d = new Date();
  return ymd(d) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function compareActive(a: GoalData, b: GoalData): number {
  const ar = a.remindAt || '9999-99-99T99:99';
  const br = b.remindAt || '9999-99-99T99:99';
  if (ar !== br) return ar < br ? -1 : 1;
  const at = a.targetDate || '9999-99-99';
  const bt = b.targetDate || '9999-99-99';
  if (at !== bt) return at < bt ? -1 : 1;
  return (a.title || '').localeCompare(b.title || '');
}

/** 正在推进按提醒时间升序（没提醒的排最后）；已经做到的按完成时间倒序。 */
export function goalStats<T extends GoalData>(rows: T[]) {
  const active = rows.filter((g) => g.status === '进行中').sort(compareActive);
  const completed = rows
    .filter((g) => g.status === '已完成')
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0) || (a.title || '').localeCompare(b.title || ''));
  const now = localNowInput();
  const next = active
    .filter((g) => !!g.remindAt && String(g.remindAt) >= now)
    .sort((a, b) => (String(a.remindAt) < String(b.remindAt) ? -1 : 1))[0] || null;
  return { active, completed, next, total: rows.length };
}

/** 提醒 chip 的显示方式：能算出「提前 N 天」时优先用它，否则显示具体时刻。 */
export function goalRemindChip(remindAt: string | null, targetDate: string | null):
  | { kind: 'before'; days: number; date: string; time: string }
  | { kind: 'same'; date: string; time: string }
  | { kind: 'when'; date: string; time: string }
  | null {
  if (!remindAt) return null;
  const parts = String(remindAt).split('T');
  const date = parts[0] || '';
  const time = (parts[1] || '').slice(0, 5);
  if (targetDate && date) {
    const d = diffDays(date, targetDate);
    if (d > 0) return { kind: 'before', days: d, date, time };
    if (d === 0) return { kind: 'same', date, time };
  }
  return { kind: 'when', date, time };
}

/** 提醒时刻是否刚好到点（只认 0~90 秒内，休眠唤醒后不补一堆旧提醒）。 */
export function goalReminderDue(remindAt: string | null, now: number = Date.now()): boolean {
  if (!remindAt) return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(remindAt));
  if (!m) return false;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0).getTime();
  const delta = now - at;
  return delta >= 0 && delta <= 90000;
}

const FIRED_KEY = 'goalRemindFired';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 记一次「推进」：返回新的时间戳列表（写回 GoalData.progressLog，跟着记录同步）。
 *  以前存在 localStorage 里，换台设备「本月累计推进」就归零了，现在跟记录走。 */
export function pushProgressStamps(prev: number[] | undefined, now: number = Date.now()): number[] {
  const cutoff = now - 400 * 86400000;
  const arr = (Array.isArray(prev) ? prev : []).filter((t) => typeof t === 'number' && t >= cutoff);
  arr.push(now);
  return arr.slice(-200);
}

/** 本月记录过几次进度：直接把每个目标的 progressLog 里落在本月的数一遍。 */
export function monthGoalProgressCount(goals: Array<{ progressLog?: number[] }>): number {
  const month = todayStr().slice(0, 7);
  let n = 0;
  for (const g of goals) {
    for (const at of Array.isArray(g.progressLog) ? g.progressLog : []) {
      if (typeof at === 'number' && ymd(new Date(at)).slice(0, 7) === month) n++;
    }
  }
  return n;
}

function readFired(): string[] {
  const arr = readJson<string[]>(FIRED_KEY, []);
  return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
}

export function wasGoalReminderFired(id: string, remindAt: string | null): boolean {
  if (!remindAt) return false;
  return readFired().includes(id + '|' + remindAt);
}

export function markGoalReminderFired(id: string, remindAt: string | null): void {
  if (!remindAt) return;
  const rows = readFired().filter((x) => x !== id + '|' + remindAt);
  rows.push(id + '|' + remindAt);
  try { localStorage.setItem(FIRED_KEY, JSON.stringify(rows.slice(-60))); } catch { /* 忽略 */ }
}
