// 把"未来会发生的提醒"提前排给系统，这样应用关掉也能收到
import { list, cfg } from './db';
import type { Item } from './db';
import type {
  TaskData, AnniversaryData, HabitData, HabitLogData, LifeEventData, CourseData, CourseChangeData, GoalData
} from '../types';
import { todayStr, addDays, nextOccurrence, timeToMinutes, daysFromToday } from './date';
import { coursesOnDateX, habitStat } from './logic';
import type { DayCourse } from './logic';
import { isNativeApp, notifId, schedulePlanned, cancelPlanned } from './native';
import type { PlannedNotif } from './native';
import { reminderCfg } from './reminders';
import { t } from './i18n';

const HORIZON_DAYS = 7;
/** 安卓的定时通知排太多会被系统掐掉，留个上限（先保证最近的这些） */
const MAX_PLANNED = 400;

function at(date: string, hhmm: string): Date {
  const m = timeToMinutes(hhmm);
  const d = new Date(date + 'T00:00:00');
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d;
}

/* ----------------------- 习惯：自己设的提醒时刻 ----------------------- */

/** 把用户填的时刻整理成 HH:mm（去重、排序、丢掉非法值） */
function normalTimes(times?: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of times || []) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw || '').trim());
    if (!m) continue;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59) continue;
    const v = (hh < 10 ? '0' : '') + hh + ':' + m[2];
    if (seen[v]) continue;
    seen[v] = true;
    out.push(v);
  }
  return out.sort();
}

/** 这个习惯当天算不算已经达标（设了每日最低量就按量算） */
function habitDone(h: Item<HabitData>, logs: Array<Item<HabitLogData>>, day: string): boolean {
  if (!logs.some((l) => l.habitId === h.id && l.date === day)) return false;
  return habitStat(h.id, logs, day, Number(h.dailyMin) || 0).checkedToday;
}

/* ------------------------------ 上课提醒 ------------------------------ */

/** 相邻两节间隔不超过这么多分钟，就算"连着上" */
export const CLASS_GAP_MIN = 15;

/** 把一天的课按"课段"分组：段内相邻两节间隔 ≤ gapMin 就是连着上 */
export function classSegments(items: DayCourse[], gapMin = CLASS_GAP_MIN): DayCourse[][] {
  const segs: DayCourse[][] = [];
  let cur: DayCourse[] = [];
  for (const c of items) {
    const prev = cur[cur.length - 1];
    if (!prev) { cur = [c]; continue; }
    const gap = timeToMinutes(c.startTime) - timeToMinutes(prev.endTime);
    if (gap <= gapMin) cur.push(c);
    else { segs.push(cur); cur = [c]; }
  }
  if (cur.length) segs.push(cur);
  return segs;
}

function placeOf(c: DayCourse): string {
  const bits = [c.startTime, c.location || t('地点待定')];
  if (c.teacher) bits.push(c.teacher);
  return bits.join(' · ');
}

/**
 * 上课提醒：未来 7 天，每个"课段"的第一节前 30 分钟、10 分钟各提醒一次。
 *
 * 连着上的课（比如上午连四节）不逐节报——那样一上午能响八次，人会直接把通知关掉。
 * 后续节次改成课间提醒一次："下一节 高等数学 08:55 开始 · 北2229"。
 * 课间只有 5 分钟时就在课间开始时提醒，不会拖到上课那一刻。
 */
export function planClassReminders(
  now = Date.now(),
  opts: Partial<{ enabled: boolean; lead30: boolean; lead10: boolean; merge: boolean; gapMin: number }> = {}
): PlannedNotif[] {
  const out: PlannedNotif[] = [];
  const enabled = opts.enabled === undefined ? cfg.classNotif !== false : opts.enabled;
  if (!enabled) return out;
  const lead30 = opts.lead30 === undefined ? cfg.classLead30 !== false : opts.lead30;
  const lead10 = opts.lead10 === undefined ? cfg.classLead10 !== false : opts.lead10;
  const merge = opts.merge === undefined ? cfg.classMerge !== false : opts.merge;
  const gapMin = opts.gapMin || CLASS_GAP_MIN;

  const courses = list<CourseData>('courses');
  if (!courses.length) return out;
  const changes = list<CourseChangeData>('courseChanges');
  const today = todayStr();

  for (let d = 0; d < HORIZON_DAYS; d++) {
    const day = addDays(today, d);
    // 停课的（这次不上了）不提醒；临时改时间/地点/换日的按调整后的算
    const items = coursesOnDateX(courses, changes, day, cfg.termStart)
      .filter((c) => !(c.change && c.change.kind === 'cancel'));
    if (!items.length) continue;
    for (const seg of classSegments(items, gapMin)) {
      for (let i = 0; i < seg.length; i++) {
        const c = seg[i];
        const start = at(day, c.startTime).getTime();
        if (i === 0 || !merge) {
          if (lead30) {
            const w = start - 30 * 60000;
            if (w > now) {
              out.push({
                id: notifId('class30:' + c.id + ':' + day),
                key: 'class:' + c.id,
                title: t('⏰ 30 分钟后上课：{name}', { name: c.name }),
                body: placeOf(c),
                at: new Date(w)
              });
            }
          }
          if (lead10) {
            const w = start - 10 * 60000;
            if (w > now) {
              out.push({
                id: notifId('class10:' + c.id + ':' + day),
                key: 'class:' + c.id,
                title: t('🔔 10 分钟后上课：{name}', { name: c.name }),
                body: placeOf(c),
                at: new Date(w)
              });
            }
          }
          continue;
        }
        // 连堂的后续节次：只在课间提醒一次
        const prevEnd = timeToMinutes(seg[i - 1].endTime);
        const gap = Math.max(0, timeToMinutes(c.startTime) - prevEnd);
        const w = start - Math.min(10, gap) * 60000;
        if (w <= now) continue;
        out.push({
          id: notifId('classbd:' + c.id + ':' + day),
          key: 'classbd:' + c.id,
          title: t('🔔 课间提醒：下一节 {name}', { name: c.name }),
          body: t('{place}（上一节 {end} 下课）', { place: placeOf(c), end: seg[i - 1].endTime }),
          at: new Date(w)
        });
      }
    }
  }
  return out;
}

/** 未来 7 天内所有该提醒的时刻 */
export function planUpcoming(): PlannedNotif[] {
  const out: PlannedNotif[] = [];
  const today = todayStr();
  const now = Date.now();

  if (reminderCfg.taskOn) {
    for (const tk of list<TaskData>('tasks')) {
      if (tk.status === '已完成' || !tk.dueDate || !tk.dueTime) continue;
      const when = at(tk.dueDate, tk.dueTime);
      const remind = new Date(when.getTime() - reminderCfg.leadMinutes * 60000);
      if (remind.getTime() < now) continue;
      out.push({
        id: notifId('task:' + tk.id + ':' + tk.dueDate),
        key: 'task:' + tk.id,
        title: t('⏰ 即将截止：{title}', { title: tk.title }),
        body: t('{n} 分钟后截止（{time}）', { n: reminderCfg.leadMinutes, time: tk.dueTime }),
        at: remind
      });
    }
  }

  // 用户自己设的提醒：到点提醒一次。与上面「截止前 N 分钟」无关，
  // 所以任务不填截止时间也能单独提醒。
  for (const tk of list<TaskData>('tasks')) {
    if (tk.status === '已完成' || !tk.remindAt) continue;
    const parts = String(tk.remindAt).split('T');
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
    const when = at(parts[0], parts[1]);
    if (when.getTime() < now) continue;
    // 系统排期窗口给到 30 天；再远的等下次打开应用时重新排
    if (when.getTime() > now + 30 * 86400000) continue;
    out.push({
      id: notifId('taskrem:' + tk.id + ':' + tk.remindAt),
      key: 'taskrem:' + tk.id,
      title: '🔔 ' + tk.title,
      body: tk.note ? String(tk.note).slice(0, 60) : t('你设的提醒 · {time}', { time: parts[1] }),
      at: when
    });
  }

  if (reminderCfg.anniversaryOn) {
    for (const a of list<AnniversaryData>('anniversaries')) {
      for (let d = 0; d <= HORIZON_DAYS; d++) {
        const day = addDays(today, d);
        const next = nextOccurrence(a.date, a.repeatYearly !== false, day);
        const lead = daysFromToday(next) === reminderCfg.anniversaryDays ? 0 : (d === 0 ? 1 : -1);
        if (lead !== 0 && day !== today) continue;
        if (d > 0) continue;
        const when = at(today, '09:00');
        if (when.getTime() < now) continue;
        const dd = daysFromToday(next);
        if (dd < 0 || dd > reminderCfg.anniversaryDays) continue;
        out.push({
          id: notifId('ann:' + a.id + ':' + next),
          key: 'ann:' + a.id,
          title: dd === 0
            ? t('{icon} {title} 就是今天', { icon: a.icon || '🎂', title: a.title })
            : t('{icon} {title} 还有 {n} 天', { icon: a.icon || '🎂', title: a.title, n: dd }),
          body: t('准备进度 {n}%', { n: a.progress || 0 }),
          at: when
        });
        break;
      }
    }
  }

  if (reminderCfg.habitOn) {
    const habits = list<HabitData>('habits').filter((h) => !h.paused);
    for (let d = 0; d < HORIZON_DAYS; d++) {
      const day = addDays(today, d);
      const when = at(day, reminderCfg.habitAfter);
      if (when.getTime() < now) continue;
      out.push({
        id: notifId('habit:' + day),
        key: 'habit:' + day,
        title: t('🔥 今天的习惯还没打卡'),
        body: t('共 {n} 个进行中的习惯，别忘了', { n: habits.length }),
        at: when
      });
    }
  }

  // 每个习惯自己设的提醒时刻（早/中/晚，想设几个设几个）：
  // 到点各弹一条，走的是同一条 shixu-alerts-v2 渠道（importance=5 = 横幅 + 声音 + 震动），
  // 不是静默通知。当天已经达标的习惯当天就不再吵。
  if (cfg.habitTimes !== false) {
    const logs = list<HabitLogData>('habitLogs');
    for (const h of list<HabitData>('habits')) {
      if (h.paused) continue;
      const times = normalTimes(h.remindTimes);
      if (!times.length) continue;
      for (let d = 0; d < HORIZON_DAYS; d++) {
        const day = addDays(today, d);
        if (d === 0 && habitDone(h, logs, day)) continue;
        for (const hhmm of times) {
          const when = at(day, hhmm);
          if (when.getTime() <= now) continue;
          out.push({
            id: notifId('habitp:' + h.id + ':' + day + ':' + hhmm),
            key: 'habitp:' + h.id,
            title: (h.icon || '🔥') + ' ' + h.name,
            body: Number(h.dailyMin) > 0
              ? t('该打卡了 · {time}（今日最低 {n}{unit}）', { time: hhmm, n: h.dailyMin, unit: h.unit || '' })
              : t('该打卡了 · {time}', { time: hhmm }),
            at: when
          });
        }
      }
    }
  }

  // 上课提醒：常规课表 + 临时调课都算，连堂课只在课间提醒一次
  for (const n of planClassReminders(now)) out.push(n);

  if (reminderCfg.lifeOn) {
    for (const e of list<LifeEventData>('lifeEvents')) {
      const d = daysFromToday(e.lastDate);
      if (!(e.cycleDays > 0 && d >= e.cycleDays)) continue;
      const when = at(today, '09:00');
      if (when.getTime() < now) continue;
      out.push({
        id: notifId('life:' + e.id + ':' + today),
        key: 'life:' + e.id,
        title: t('{icon} 该安排了：{title}', { icon: e.icon || '🕰️', title: e.title }),
        body: t('上次 {date}，已过 {n} 天（建议 {m} 天）', { date: e.lastDate, n: d, m: e.cycleDays }),
        at: when
      });
    }
  }

  // 长远目标：只排用户自己选的那一次「到点提醒」（remindAt）。
  // 没有目标日也能提醒——就是单纯提醒你推进一下。
  for (const g of list<GoalData>('goals')) {
    if (g.status === '已完成') continue;
    const raw = String(g.remindAt || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) continue;
    const when = new Date(raw + ':00');
    if (!(when.getTime() > now)) continue;
    const left = g.targetDate ? daysFromToday(g.targetDate) : null;
    const pct = Math.round(Number(g.progress) || 0);
    out.push({
      id: notifId('goal:' + g.id + ':' + raw),
      key: 'goal:' + g.id,
      title: t('🎯 长远目标：{title}', { title: g.title }),
      body: left === null
        ? t('到点提醒你推进一下 · 当前 {p}%', { p: pct })
        : left >= 0
          ? t('目标日还有 {n} 天 · 当前 {p}%', { n: left, p: pct })
          : t('目标日已过 {n} 天 · 当前 {p}%', { n: -left, p: pct }),
      at: when
    });
  }

  // 排期数量兜底：安卓的定时通知排太多会被系统掐掉，先保证最近的那些
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out.length > MAX_PLANNED ? out.slice(0, MAX_PLANNED) : out;
}

let lastRun = 0;
let lastCount = 0;
let lastError = '';
let timer: ReturnType<typeof setTimeout> | null = null;

/** 上一次排期的结果，设置页的"系统通知自检"要显示 */
export const lastPlan = () => ({ at: lastRun, count: lastCount, error: lastError });

/** 重新排期（去抖，避免每次数据变动都重排） */
export function rescheduleNativeReminders(delay = 8000): void {
  if (!isNativeApp()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    if (!reminderCfg.enabled) { await cancelPlanned(); lastCount = 0; lastError = ''; return; }
    lastRun = Date.now();
    const r = await schedulePlanned(planUpcoming());
    lastCount = r.count;
    lastError = r.error;
  }, delay);
}

export async function rescheduleNow(): Promise<number> {
  if (!isNativeApp()) return 0;
  if (!reminderCfg.enabled) { await cancelPlanned(); lastCount = 0; lastError = ''; return 0; }
  lastRun = Date.now();
  const r = await schedulePlanned(planUpcoming());
  lastCount = r.count;
  lastError = r.error;
  return r.count;
}

export const lastPlannedAt = () => lastRun;
