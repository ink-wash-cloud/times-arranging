// 业务计算：习惯连续天数、待办分栏、纪念日倒计时、预算、今日课表
import type {
  TaskData, HabitLogData, AnniversaryData, CourseData, CourseChangeData, ExpenseData, BudgetData, LifeEventData
} from '../types';
import {
  todayStr, addDays, diffDays, daysFromToday, nextOccurrence, parityOfWeek, weekIndexOf, ymd, parseYMD, timeToMinutes
} from './date';
import type { Item } from './db';

/* ------------------------------- 习惯 ------------------------------- */
export interface HabitStat {
  streak: number;       // 当前连续天数
  best: number;         // 历史最长连续
  total: number;        // 累计打卡次数
  checkedToday: boolean;
  last7: Array<{ date: string; on: boolean; isToday: boolean }>;
  keepAlive: boolean;   // 今天没打但昨天打了（连续未断，今天补上仍延续）
  todayAmount: number;  // 今天记录到的完成量（设了每日最低量时才有意义）
}

/**
 * @param dailyMin 每日最低完成量。设了量之后，"达标"= 当天完成量 ≥ 这个数，
 *                 而不是"有没有记录"。老记录没有 amount 字段，按刚好达标算，
 *                 这样以前打的卡不会因为这次改动而断掉。
 */
export function habitStat(habitId: string, logs: Item<HabitLogData>[], today = todayStr(), dailyMin = 0): HabitStat {
  const amounts = new Map<string, number>();
  for (const l of logs) {
    if (l.habitId !== habitId || !l.date) continue;
    const raw = (l as unknown as { amount?: number }).amount;
    const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : (dailyMin > 0 ? dailyMin : 1);
    amounts.set(l.date, Math.max(amounts.get(l.date) || 0, v));
  }
  const done = (d: string) => {
    const v = amounts.get(d);
    if (v === undefined) return false;
    return dailyMin > 0 ? v >= dailyMin : true;
  };
  const dates = new Set<string>();
  amounts.forEach((_v, d) => { if (done(d)) dates.add(d); });
  const total = dates.size;
  const checkedToday = dates.has(today);
  const todayAmount = amounts.get(today) || 0;

  // 当前连续：今天已打卡从今天回溯；今天未打卡则从昨天回溯（当天尚未结束，连续暂不判死）
  let streak = 0;
  let cursor = checkedToday ? today : addDays(today, -1);
  while (dates.has(cursor)) { streak++; cursor = addDays(cursor, -1); }

  // 历史最长连续
  const sorted = Array.from(dates).sort();
  let best = 0, run = 0, prev = '';
  for (const d of sorted) {
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }

  const last7: HabitStat['last7'] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    last7.push({ date: d, on: dates.has(d), isToday: i === 0 });
  }
  return { streak, best: Math.max(best, streak), total, checkedToday, last7, keepAlive: !checkedToday && streak > 0, todayAmount };
}

/* ------------------------------- 待办 ------------------------------- */
export type BucketKey = 'overdue' | 'today' | 'next7' | 'done';

/** 显示用状态：未完成且已过期 → 已延期 */
export function displayStatus(t: Item<TaskData>, today = todayStr()): TaskData['status'] {
  if (t.status === '已完成') return '已完成';
  if (t.dueDate && t.dueDate < today) return '已延期';
  return t.status;
}

const prioRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function sortTasks(a: Item<TaskData>, b: Item<TaskData>): number {
  const ra = prioRank[a.priority] ?? 9;
  const rb = prioRank[b.priority] ?? 9;
  if (ra !== rb) return ra - rb;
  const da = a.dueDate || '9999-99-99', db = b.dueDate || '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

export function taskBuckets(tasks: Item<TaskData>[], today = todayStr()) {
  const horizon = addDays(today, 7);
  const overdue: Item<TaskData>[] = [];
  const todays: Item<TaskData>[] = [];
  const next7: Item<TaskData>[] = [];
  const later: Item<TaskData>[] = [];   // 7 天以后：单独成区，避免"消失"
  const done: Item<TaskData>[] = [];
  const pool: Item<TaskData>[] = [];

  for (const t of tasks) {
    if (t.status === '已完成') { done.push(t); continue; }
    if (!t.dueDate) { pool.push(t); continue; }
    if (t.dueDate < today) overdue.push(t);
    else if (t.dueDate === today) todays.push(t);
    else if (t.dueDate <= horizon) next7.push(t);
    else later.push(t);
  }
  overdue.sort(sortTasks); todays.sort(sortTasks); next7.sort(sortTasks); later.sort(sortTasks);
  done.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  pool.sort(sortTasks);
  return { overdue, today: todays, next7, later, done, pool };
}

export function todayProgress(tasks: Item<TaskData>[], today = todayStr()) {
  const relevant = tasks.filter((t) => t.status !== '已完成' ? (t.dueDate && t.dueDate <= today) : (t.completedAt && ymd(new Date(t.completedAt)) === today));
  const done = relevant.filter((t) => t.status === '已完成').length;
  return { done, total: relevant.length, pct: relevant.length ? Math.round((done / relevant.length) * 100) : 0 };
}

/* ------------------------------ 重要日期 ------------------------------ */
export interface AnnStat { id: string; days: number; next: string; isToday: boolean; progress: number; }

export function annStat(a: Item<AnniversaryData>, today = todayStr()): AnnStat {
  const next = nextOccurrence(a.date, a.repeatYearly !== false, today);
  const days = diffDays(today, next);
  return { id: a.id, days, next, isToday: days === 0, progress: Math.max(0, Math.min(100, a.progress || 0)) };
}

export function nearestAnniversary(list: Item<AnniversaryData>[], today = todayStr()) {
  const withStat = list.map((a) => ({ a, s: annStat(a, today) }));
  withStat.sort((x, y) => x.s.days - y.s.days);
  return withStat.length ? withStat[0] : null;
}

/* ------------------------------- 预算 ------------------------------- */
/**
 * 金额按「分」四舍五入。
 *
 * 0.1 + 0.2 在二进制里是 0.30000000000000004，直接显示会变成一长串小数；
 * 记一笔 55.8 也可能因为浮点累加显示成 55.80000000000001。
 * 统一在这里收口，后面所有金额、剩余、百分比都先过它。
 */
export function round2(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const sign = v < 0 ? -1 : 1;
  return Math.round((v + sign * Number.EPSILON) * 100) / 100;
}

export function budgetStat(expenses: Item<ExpenseData>[], budgets: Item<BudgetData>[], month: string) {
  const b = budgets.find((x) => x.id === month);
  const amount = round2(b ? Number(b.amount) || 0 : 0);
  const items = expenses.filter((e) => (e.date || '').slice(0, 7) === month);
  const spent = round2(items.reduce((s, e) => s + (Number(e.amount) || 0), 0));
  const remaining = round2(amount - spent);
  const pct = amount > 0 ? round2((spent / amount) * 100) : 0;
  const daysInMonth = new Date(parseYMD(month + '-01').getFullYear(), parseYMD(month + '-01').getMonth() + 1, 0).getDate();
  const dayNow = month === todayStr().slice(0, 7) ? parseYMD(todayStr()).getDate() : daysInMonth;
  const expectedPct = Math.round((dayNow / daysInMonth) * 100);
  return { amount, spent, remaining, pct, items, expectedPct, daysInMonth, dayNow };
}

/* --------------------------- 人生最新一次 --------------------------- */
export function latestLifeEvent(list: Item<LifeEventData>[], today = todayStr()) {
  const sorted = list.slice().sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));
  if (!sorted.length) return null;
  const e = sorted[0];
  const days = diffDays(e.lastDate, today);
  const cycle = Number(e.cycleDays) || 0;
  return { event: e, days, overdue: cycle > 0 && days >= cycle, ratio: cycle > 0 ? Math.min(100, Math.round((days / cycle) * 100)) : 0 };
}

/* ------------------------------- 课表 ------------------------------- */
export function currentWeek(termStart: string, today = todayStr()): number {
  if (!termStart) return 0;
  return weekIndexOf(termStart, today);
}

export function courseOnDate(c: Item<CourseData>, date: string, week: number): boolean {
  const wd = (parseYMD(date).getDay() + 6) % 7 + 1;  // 周一=1
  if (Number(c.weekday) !== wd) return false;
  if (!week) return true;   // 未设置开学日期时不做周次过滤
  const s = Number(c.startWeek) || 1;
  const e = Number(c.endWeek) || 16;
  if (week < s || week > e) return false;
  if (c.weekParity === 'odd' && parityOfWeek(week) !== 'odd') return false;
  if (c.weekParity === 'even' && parityOfWeek(week) !== 'even') return false;
  return true;
}

export function coursesOnDate(courses: Item<CourseData>[], date: string, termStart: string) {
  const week = currentWeek(termStart, date);
  return courses.filter((c) => courseOnDate(c, date, week))
    .sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
}

/* ------------------------------ 时间池 ------------------------------ */
/* --------------------- 课表：临时调课 / 停课 --------------------- */

/** 临时调整的记录 id：同一门课同一天只有一条 */
export function changeId(courseId: string, date: string): string {
  return courseId + ':' + date;
}

/** 这一天实际要上的课 = 常规课表 ± 临时调整。
 *  返回的每一项都可能带 change（那天被调过），movedFrom 表示"从哪天调过来的"。 */
export type DayCourse = Item<CourseData> & { change?: Item<CourseChangeData>; movedFrom?: string };

export function coursesOnDateX(
  courses: Item<CourseData>[],
  changes: Item<CourseChangeData>[],
  date: string,
  termStart: string
): DayCourse[] {
  const week = currentWeek(termStart, date);
  const out: DayCourse[] = [];
  for (const c of courses) {
    const mine = changes.filter((x) => x && x.courseId === c.id);
    const here = mine.find((x) => x.date === date);
    const movedIn = mine.find((x) => x.kind === 'move' && x.toDate === date);
    if (here && here.kind === 'cancel') { out.push({ ...c, change: here }); continue; }
    if (here && here.kind === 'edit') {
      out.push({
        ...c,
        startTime: here.startTime || c.startTime,
        endTime: here.endTime || c.endTime,
        location: here.location !== undefined && here.location !== '' ? here.location : c.location,
        teacher: here.teacher !== undefined && here.teacher !== '' ? here.teacher : c.teacher,
        change: here
      });
      continue;
    }
    if (movedIn) {
      out.push({
        ...c,
        startTime: movedIn.startTime || c.startTime,
        endTime: movedIn.endTime || c.endTime,
        location: movedIn.location !== undefined && movedIn.location !== '' ? movedIn.location : c.location,
        teacher: movedIn.teacher !== undefined && movedIn.teacher !== '' ? movedIn.teacher : c.teacher,
        change: movedIn,
        movedFrom: movedIn.date
      });
      continue;
    }
    if (here && here.kind === 'move') continue;          // 调到别的日子去了，今天不显示
    if (courseOnDate(c, date, week)) out.push(c);
  }
  return out.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
}

export function poolStat(tasks: Item<TaskData>[]) {
  const pool = tasks.filter((t) => t.status !== '已完成' && !t.dueDate);
  const minutes = pool.reduce((s, t) => s + (Number(t.estimateMinutes) || 0), 0);
  return { count: pool.length, minutes };
}
