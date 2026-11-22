// 共享业务动作层：所有视图通过这里改数据，保证同步标记与联动逻辑一致
import { list, putRecord, patchRecord, removeRecord, newId, getOne } from './db';
import type { TaskData, HabitData, HabitLogData, AnniversaryData, CourseData, CourseChangeData, ExpenseData, BudgetData, LifeEventData } from '../types';
import { changeId } from './logic';
import { todayStr, addDays, parseYMD, ymd, currentMonth } from './date';
import { nextOccurrence } from './date';

/* ------------------------------- 习惯打卡 ------------------------------- */
export function habitLogId(habitId: string, date: string): string { return habitId + ':' + date; }

export function toggleHabitCheck(habitId: string, date = todayStr()): boolean {
  const id = habitLogId(habitId, date);
  const existing = list<HabitLogData>('habitLogs').find((l) => l.id === id);
  if (existing) { removeRecord('habitLogs', id); return false; }
  putRecord('habitLogs', id, { habitId, date, at: Date.now() });
  return true;
}

/**
 * 记录某天的完成量。设了"每日最低完成量"的习惯用这个，
 * 而不是二元的打卡。量减到 0 就把当天记录删掉。
 */
export function setHabitAmount(habitId: string, date: string, amount: number): number {
  const id = habitLogId(habitId, date);
  const v = Math.max(0, Math.round(amount));
  if (v <= 0) { removeRecord('habitLogs', id); return 0; }
  // 用 putRecord（按 id 覆盖或新建），因为当天可能还没有记录
  putRecord<HabitLogData>('habitLogs', id, { habitId, date, at: Date.now(), amount: v });
  return v;
}

export function isCheckedIn(habitId: string, date = todayStr()): boolean {
  return !!list<HabitLogData>('habitLogs').find((l) => l.id === habitLogId(habitId, date));
}

/* ------------------------------- 待办事项 ------------------------------- */
export function advanceRepeat(dueDate: string | null, rule: string): string | null {
  if (!dueDate) return null;
  const d = parseYMD(dueDate);
  if (rule === '每天') d.setDate(d.getDate() + 1);
  else if (rule === '每周') d.setDate(d.getDate() + 7);
  else if (rule === '每月') d.setMonth(d.getMonth() + 1);
  else if (rule === '每年') d.setFullYear(d.getFullYear() + 1);
  else return null;
  return ymd(d);
}

/** 纪念日进度 +10%（上限 100） */
export function bumpAnniversaryProgress(anniversaryId: string, delta = 10): number {
  const a = getOne<AnniversaryData>('anniversaries', anniversaryId);
  if (!a) return -1;
  const next = Math.max(0, Math.min(100, Math.round((Number(a.progress) || 0) + delta)));
  patchRecord<AnniversaryData>('anniversaries', anniversaryId, { progress: next });
  return next;
}

export function setTaskDone(taskId: string, done: boolean): { anniversaryBumped: number; spawned: string | null } {
  const t = getOne<TaskData>('tasks', taskId);
  if (!t) return { anniversaryBumped: -1, spawned: null };
  let anniversaryBumped = -1;
  let spawned: string | null = null;

  patchRecord<TaskData>('tasks', taskId, {
    status: done ? '已完成' : '未开始',
    completedAt: done ? Date.now() : null
  });

  if (done && t.anniversaryId) anniversaryBumped = bumpAnniversaryProgress(t.anniversaryId, 10);

  // 重复任务：完成后自动生成下一次
  if (done && t.repeat && t.repeat !== '不重复') {
    const nextDue = advanceRepeat(t.dueDate, t.repeat);
    if (nextDue) {
      const nid = newId();
      spawned = nid;
      putRecord<TaskData>('tasks', nid, {
        title: t.title, category: t.category, dueDate: nextDue, dueTime: t.dueTime,
        priority: t.priority, status: '未开始', estimateMinutes: t.estimateMinutes,
        repeat: t.repeat, note: t.note, anniversaryId: t.anniversaryId,
        completedAt: null, createdAt: Date.now()
      });
    }
  }
  return { anniversaryBumped, spawned };
}

/* ------------------------------- 预算记账 ------------------------------- */
export function addExpense(title: string, amount: number, category: string, date = todayStr()): string {
  const id = newId();
  putRecord<ExpenseData>('expenses', id, { title, amount: Number(amount) || 0, category, date, createdAt: Date.now() });
  return id;
}

export function setMonthBudget(month: string, amount: number): void {
  putRecord<BudgetData>('budgets', month, { amount: Number(amount) || 0 });
}

export function ensureBudget(month = currentMonth()): void {
  const b = getOne<BudgetData>('budgets', month);
  if (!b) putRecord<BudgetData>('budgets', month, { amount: 0 });
}

/* ------------------------- 课表：临时调课 / 停课 ------------------------- */
/** 记一次临时调整（换课、改地点、停课）。同一天同一门课只会留最新那条。 */
export function saveCourseChange(courseId: string, date: string, kind: 'cancel' | 'move' | 'edit',
  patch: { toDate?: string; startTime?: string; endTime?: string; location?: string; teacher?: string; note?: string } = {}): void {
  putRecord<CourseChangeData>('courseChanges', changeId(courseId, date), {
    courseId, date, kind,
    toDate: patch.toDate || '',
    startTime: patch.startTime || '',
    endTime: patch.endTime || '',
    location: patch.location || '',
    teacher: patch.teacher || '',
    note: patch.note || '',
    createdAt: Date.now()
  });
}

/** 撤销某天的临时调整，回到常规课表 */
export function clearCourseChange(courseId: string, date: string): void {
  removeRecord('courseChanges', changeId(courseId, date));
}

/* ---------------------------- 人生最新一次 ---------------------------- */
export function touchLifeEvent(id: string, date = todayStr()): void {
  patchRecord<LifeEventData>('lifeEvents', id, { lastDate: date });
}

/* ------------------------------ 纪念日 ------------------------------ */
export function anniversaryNext(id: string): string | null {
  const a = getOne<AnniversaryData>('anniversaries', id);
  if (!a) return null;
  return nextOccurrence(a.date, a.repeatYearly !== false);
}

/* ------------------------------- 课表 ------------------------------- */
export function addCourses(list_: Array<Omit<CourseData, 'createdAt'>>): number {
  for (const c of list_) {
    putRecord<CourseData>('courses', newId(), { ...c, createdAt: Date.now() });
  }
  return list_.length;
}

export function clearTimetable(): void {
  for (const c of list<CourseData>('courses')) removeRecord('courses', c.id);
}
