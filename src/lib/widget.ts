// 手机桌面小组件（安卓）：把"今天要做什么"推到桌面上，并取回用户在小组件上点掉的操作。
//
// 为什么要这么绕：网页层的数据在 WebView 的 IndexedDB 里，原生读不到；而小组件
// 必须在应用没打开时也能显示、也能点。所以
//   · 数据一变（或回到前台）→ 推一份快照给原生，小组件照着画
//   · 用户点掉一行 → 原生先把那行从快照里删掉（立刻见效），操作排进队列
//   · 应用下次打开 / 回到前台 → 取走队列，落到本地库并同步到电脑
//
// 各家的叫法不一样：小组件 / 小部件 / 微件 / 桌面工具，指的都是同一个东西。
import { registerPlugin } from '@capacitor/core';
import { list, patchRecord, subscribe, syncNow, cfg, saveConfig } from './db';
import type { Item } from './db';
import type { TaskData, CourseData, CourseChangeData, HabitData, HabitLogData, AnniversaryData, BudgetData, ExpenseData, LifeEventData } from '../types';
import { taskBuckets, coursesOnDateX, habitStat, nearestAnniversary, budgetStat, latestLifeEvent } from './logic';
import { toggleHabitCheck } from './actions';
import { todayStr, weekdayName, humanMinutes, parseYMD, currentMonth } from './date';
import { t } from './i18n';

/** 小组件上能放哪些块（顺序就是显示顺序） */
export const WIDGET_BLOCKS: Array<{ id: string; icon: string; name: string; desc: string }> = [
  { id: 'tasks', icon: '✅', name: '今日待办', desc: '点一下就在桌面完成，不用打开应用' },
  { id: 'habits', icon: '🔥', name: '今日习惯', desc: '点一下等于打卡，那一行立刻消失' },
  { id: 'courses', icon: '📅', name: '今日课程', desc: '今天几点上什么课、在哪' },
  { id: 'anniversary', icon: '🎂', name: '最近的纪念日', desc: '还有几天' },
  { id: 'budget', icon: '💰', name: '本月预算', desc: '花了多少 / 还剩多少' },
  { id: 'life', icon: '🕰️', name: '人生最新一次', desc: '比如上次理发过了多少天' }
];
export const DEFAULT_WIDGET_BLOCKS = ['tasks', 'habits', 'courses'];

export function widgetBlocks(): string[] {
  const on = (cfg.widgetBlocks && cfg.widgetBlocks.length ? cfg.widgetBlocks : DEFAULT_WIDGET_BLOCKS)
    .filter((id) => WIDGET_BLOCKS.some((b) => b.id === id));
  return on.length ? on : DEFAULT_WIDGET_BLOCKS;
}

interface WidgetOp { type: string; id: string; at?: number }
interface WidgetPlugin {
  update(o: { json: string }): Promise<{ ok: boolean }>;
  drain(): Promise<{ ops: WidgetOp[] }>;
  status(): Promise<{ count: number }>;
}

let plugin: WidgetPlugin | null = null;
let probeDone = false;

/** 只有装在手机里（原生壳）才有小组件；网页版返回 null，所有调用自动跳过 */
function getPlugin(): WidgetPlugin | null {
  if (probeDone) return plugin;
  probeDone = true;
  try {
    const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!c || !c.isNativePlatform || !c.isNativePlatform()) { plugin = null; return null; }
    plugin = registerPlugin<WidgetPlugin>('ShixuWidget');
  } catch {
    plugin = null;
  }
  return plugin;
}

export function widgetSupported(): boolean {
  return !!getPlugin();
}

/** 现在该在桌面上显示什么（任务在前，课程在后，最多给原生 6 行） */
/** 桌面上被 ✕ 清掉的行：今天之内不再推上去（不改数据，只是不在桌面显示） */
export function hiddenToday(): string[] {
  const h = (cfg as unknown as { widgetHidden?: { date?: string; ids?: string[] } }).widgetHidden;
  if (!h || h.date !== todayStr()) return [];
  return Array.isArray(h.ids) ? h.ids : [];
}

export function buildWidgetPayload(): string {
  const today = todayStr();
  const on = widgetBlocks();
  const hidden = hiddenToday();
  const kindOf = (id: string) => (on.indexOf(id) >= 0 ? 'live' : 'skip');
  const items: Array<Record<string, string | boolean>> = [];
  const counts: Record<string, number> = {};
  const parts: string[] = [];
  const MAX = 6;

  /* 今日待办：可以点掉 */
  let todo = 0;
  if (kindOf('tasks') === 'live') {
    const buckets = taskBuckets(list<TaskData>('tasks'), today);
    const list_ = buckets.overdue.concat(buckets.today).filter((t: Item<TaskData>) => t.status !== '已完成');
    todo = list_.length;
    counts.todo = todo;
    if (todo) parts.push(t('待办 {n}', { n: todo }));
    // 还开了别的块时，待办最多占 3 行 —— 不然 4 条待办就把纪念日/预算挤没了
    const others = on.filter((x) => x !== 'tasks');
    for (const task of list_.filter((x) => hidden.indexOf(x.id) < 0).slice(0, others.length ? 3 : 4)) {
      if (items.length >= MAX) break;
      const overdue = task.dueDate && task.dueDate < today;
      items.push({
        kind: 'task', op: 'task-done', id: task.id, mark: '○', text: task.title,
        meta: overdue ? t('逾期') : (Number(task.estimateMinutes) > 0 ? humanMinutes(Number(task.estimateMinutes)) : '')
      });
    }
  }

  /* 今日习惯：点一下 = 打卡（和待办一样划掉） */
  if (kindOf('habits') === 'live') {
    const habits = list<HabitData>('habits').filter((h) => !h.paused);
    const logs = list<HabitLogData>('habitLogs');
    let left = 0;
    for (const h of habits) {
      const st = habitStat(h.id, logs, today, Number(h.dailyMin) || 0);
      if (st.checkedToday) continue;
      if (hidden.indexOf(h.id) >= 0) continue;
      left++;
      if (items.length >= MAX) continue;
      items.push({ kind: 'habit', op: 'habit-check', id: h.id, mark: '○', text: (h.icon || '') + ' ' + h.name, meta: t('打卡') });
    }
    counts.habits = left;
    if (left) parts.push(t('习惯 {n}', { n: left }));
  }

  /* 今日课程：点一下打开应用看课表 */
  if (kindOf('courses') === 'live') {
    const changes = list<CourseChangeData>('courseChanges');
    let classes = 0;
    for (const c of coursesOnDateX(list<CourseData>('courses'), changes, today, '')) {
      if (c.change && c.change.kind === 'cancel') continue;
      classes++;
      if (items.length >= MAX) continue;
      items.push({ kind: 'course', id: c.id, mark: '🕘', text: c.name, meta: c.startTime + (c.location ? ' · ' + c.location : '') });
    }
    counts.classes = classes;
    if (classes) parts.push(t('课 {n}', { n: classes }));
  }

  /* 三个"只看"的块，各占一行 */
  if (kindOf('anniversary') === 'live') {
    const near = nearestAnniversary(list<AnniversaryData>('anniversaries'), today);
    if (near && items.length < MAX) {
      items.push({ kind: 'info', id: 'ann', mark: (near.a.icon || '🎂'), text: near.a.title, meta: t('还有 {days} 天', { days: near.s.days }) });
      parts.push(t('纪念日 {days} 天', { days: near.s.days }));
    }
  }
  if (kindOf('budget') === 'live') {
    const b = budgetStat(list<ExpenseData>('expenses'), list<BudgetData>('budgets'), currentMonth());
    if (items.length < MAX) {
      items.push({
        kind: 'info', id: 'budget', mark: '💰', text: t('本月已花 ¥{spent}', { spent: b.spent }),
        meta: b.amount > 0 ? (b.remaining >= 0 ? t('剩 ¥{n}', { n: b.remaining }) : t('超 ¥{n}', { n: Math.abs(b.remaining) })) : t('未设预算')
      });
      if (b.amount > 0) parts.push(t('预算 {pct}%', { pct: b.pct }));
    }
  }
  if (kindOf('life') === 'live') {
    const last = latestLifeEvent(list<LifeEventData>('lifeEvents'));
    if (last && items.length < MAX) {
      items.push({ kind: 'info', id: 'life', mark: (last.event.icon || '🕰️'), text: last.event.title, meta: t('已 {days} 天', { days: last.days }) });
    }
  }

  const wd = weekdayName(parseYMD(today).getDay());
  const sub = parts.length ? parts.join(' · ') : t('今天很空');
  return JSON.stringify({ title: t('时序 · {wd}', { wd }), sub, items, counts, updatedAt: Date.now() });
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

/** 推快照给小组件。数据变动很密集，所以攒一下再推。 */
export function pushWidget(now = false): void {
  if (!getPlugin()) return;
  if (now) {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    void send();
    return;
  }
  if (pushTimer) return;
  pushTimer = setTimeout(() => { pushTimer = null; void send(); }, 700);
}

async function send(): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  try { await p.update({ json: buildWidgetPayload() }); } catch { /* 小组件没加上也不影响应用 */ }
}

/** 把用户在小组件上点掉的待办落到本地库，然后同步 */
export async function drainWidgetOps(): Promise<number> {
  const p = getPlugin();
  if (!p) return 0;
  let ops: WidgetOp[] = [];
  try { ops = (await p.drain()).ops || []; } catch { return 0; }
  if (!ops.length) return 0;
  let n = 0;
  for (const op of ops) {
    if (!op || !op.id) continue;
    if (op.type === 'task-done') {
      const t = list<TaskData>('tasks').find((x) => x.id === op.id);
      if (!t || t.status === '已完成') continue;
      patchRecord<TaskData>('tasks', op.id, { status: '已完成', completedAt: op.at || Date.now() });
      n++;
    } else if (op.type === 'widget-hide') {
      // 只是从桌面清掉，不动数据；今天之内不再推上去
      const today = todayStr();
      const cur = hiddenToday();
      if (cur.indexOf(op.id) < 0) {
        await saveConfig({ widgetHidden: { date: today, ids: cur.concat([op.id]) } } as never);
        n++;
      }
    } else if (op.type === 'habit-check') {
      const h = list<HabitData>('habits').find((x) => x.id === op.id);
      if (!h) continue;
      const done = habitStat(h.id, list<HabitLogData>('habitLogs'), todayStr(), Number(h.dailyMin) || 0).checkedToday;
      if (done) continue;
      toggleHabitCheck(op.id, todayStr());
      n++;
    }
  }
  if (n) await syncNow('widget');
  return n;
}

/** 桌面上加了几个小组件（设置页用来显示"已添加 / 还没添加"） */
export async function widgetCount(): Promise<number> {
  const p = getPlugin();
  if (!p) return -1;
  try { return (await p.status()).count; } catch { return -1; }
}

// 调试/自动化钩子：网页端也能直接看到"小组件现在会显示什么"
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__shixuWidget = {
    payload: buildWidgetPayload, blocks: widgetBlocks, supported: widgetSupported, push: pushWidget, drain: drainWidgetOps
  };
}

let started = false;

/** 启动时调一次：先把小组件上的操作收集回来，再保持推送 */
export async function initWidget(): Promise<void> {
  if (!getPlugin() || started) return;
  started = true;
  try {
    const n = await drainWidgetOps();
    if (n) console.log('[小组件] 收回了 ' + n + ' 条在桌面上点掉的待办');
  } catch { /* 忽略 */ }
  subscribe(() => pushWidget());
  pushWidget(true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    void drainWidgetOps().then((n) => { if (n) pushWidget(true); });
    pushWidget(true);
  });
}
