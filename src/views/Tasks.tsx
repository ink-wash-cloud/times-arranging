import React, { useEffect, useMemo, useRef, useState } from 'react';
import { list, useDB, putRecord, patchRecord, removeRecord, newId, withoutId } from '../lib/db';
import type { Item } from '../lib/db';
import type { TaskData, Category, Priority, TaskStatus, RepeatRule, AnniversaryData, GoalData } from '../types';
import { CATEGORIES, PRIORITIES, STATUSES, REPEATS, CATEGORY_COLORS, PRIORITY_COLORS, STATUS_COLORS } from '../types';
import { Modal, Field, toast, askConfirm, Empty, Tag, Bar } from '../components/ui';
import { todayStr, relativeDay, humanMinutes, addDays, fmtCN, daysFromToday, pick, ymd } from '../lib/date';
import { taskBuckets, displayStatus, sortTasks } from '../lib/logic';
import { setTaskDone } from '../lib/actions';
import { rescheduleNativeReminders } from '../lib/nativeReminders';
import { t } from '../lib/i18n';
import {
  GOAL_REMIND_PRESETS, goalRemindChip, goalStats,
  monthGoalProgressCount, presetRemindAt, defaultCustomRemindAt, pushProgressStamps
} from '../lib/goals';
import type { GoalRemindPreset } from '../lib/goals';
import './goals.css';

/* ---- 提醒时间：datetime-local 要 'YYYY-MM-DDTHH:mm' 的本机时间 ---- */
const pad2 = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (d: Date) =>
  d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());

/** 快捷档位：每次点的时候现算，所以弹窗开着放久了也不会给出过期的时刻 */
export const REMIND_PRESETS: Array<{ label: string; at: () => string }> = [
  { label: '10 分钟后', at: () => toLocalInput(new Date(Date.now() + 10 * 60000)) },
  { label: '1 小时后', at: () => toLocalInput(new Date(Date.now() + 60 * 60000)) },
  { label: '今晚 20:00', at: () => { const d = new Date(); d.setHours(20, 0, 0, 0); return toLocalInput(d); } },
  { label: '明早 08:00', at: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return toLocalInput(d); } }
];

/** 列表里显示成「今天 14:30 / 明天 08:00 / 10-25 08:00」 */
export function fmtRemind(v?: string | null): string {
  if (!v) return '';
  const parts = String(v).split('T');
  if (parts.length !== 2) return String(v);
  const diff = daysFromToday(parts[0]);
  const hm = parts[1].slice(0, 5);
  if (diff === 0) return pick('今天 ', '今天 ', 'Today ', '今日 ') + hm;
  if (diff === 1) return pick('明天 ', '明天 ', 'Tomorrow ', '明日 ') + hm;
  if (diff === -1) return pick('昨天 ', '昨天 ', 'Yesterday ', '昨日 ') + hm;
  return parts[0].slice(5) + ' ' + hm;
}

export default function Tasks() {
  useDB();
  const today = todayStr();
  const all = list<TaskData>('tasks');
  const anns = list<AnniversaryData>('anniversaries');

  const [filter, setFilter] = useState<Category | '全部'>('全部');
  const [kw, setKw] = useState('');
  const [editing, setEditing] = useState<Item<TaskData> | null>(null);
  const [showPool, setShowPool] = useState(true);
  const [tab, setTab] = useState<'board' | 'goals'>('board');
  const [goalCreateOpen, setGoalCreateOpen] = useState(false);
  const [goalCreateSignal, setGoalCreateSignal] = useState(0);

  const goalRows = list<GoalData>('goals');
  const gs = goalStats(goalRows);
  // 到点提醒搬到了全局 GoalReminder（App 里挂载），这一页不再自己轮询。

  const tasks = useMemo(() => {
    let rows = all;
    if (filter !== '全部') rows = rows.filter((x) => x.category === filter);
    if (kw.trim()) {
      const k = kw.trim().toLowerCase();
      rows = rows.filter((x) => (x.title || '').toLowerCase().includes(k) || (x.note || '').toLowerCase().includes(k));
    }
    return rows;
  }, [all, filter, kw]);

  const b = useMemo(() => taskBuckets(tasks, today), [tasks, today]);
  const poolMinutes = b.pool.reduce((s, x) => s + (Number(x.estimateMinutes) || 0), 0);

  const openNew = () => setEditing({
    id: '', title: '', category: '学习', dueDate: today, dueTime: null, priority: 'P2',
    status: '未开始', estimateMinutes: 30, repeat: '不重复', note: '', anniversaryId: null,
    completedAt: null, createdAt: Date.now()
  } as Item<TaskData>);

  const toggle = (task: Item<TaskData>, done: boolean) => {
    const r = setTaskDone(task.id, done);
    if (done && r.anniversaryBumped >= 0) {
      const a = anns.find((x) => x.id === task.anniversaryId);
      toast(t('完成！「{name}」准备进度 +10% → {p}%', { name: a ? a.title : t('纪念日'), p: r.anniversaryBumped }), 'ok');
    } else if (done && r.spawned) {
      toast(t('已完成，重复任务的下一次已自动生成'), 'ok');
    } else {
      toast(done ? t('已完成') : t('已恢复为未开始'), done ? 'ok' : 'info');
    }
  };

  const del = async (task: Item<TaskData>) => {
    const ok = await askConfirm(t('删除待办'), t('确定删除「{name}」吗？该操作会同步到所有设备。', { name: task.title }), { okText: t('删除'), danger: true });
    if (!ok) return;
    removeRecord('tasks', task.id);
    rescheduleNativeReminders(600);   // 提醒已经排进系统闹钟了，删了得撤掉，不然到点还会响
    toast(t('已删除'), 'ok', {
      label: t('撤销'),
      run: () => {
        putRecord<TaskData>('tasks', task.id, withoutId(task));   // 用新的 updatedAt 写回，压过可能已经推出去的墓碑
        rescheduleNativeReminders(200);
        toast(t('已恢复'), 'ok');
      }
    });
  };

  const requestNewGoal = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
      setGoalCreateOpen(true);
    } else {
      setGoalCreateSignal((v) => v + 1);
    }
  };

  const jumpTo = (col: string) => {
    const go = () => document.getElementById('tasks-col-' + col)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (tab !== 'board') {
      setTab('board');
      window.setTimeout(go, 30);
    } else {
      go();
    }
  };

  return (
    <>
      <div className={'card mb12 tasks-top' + (tab === 'goals' ? ' is-goals' : '')}>
        <div className="tasks-tabs-row">
          <div className="tasks-tabs">
            <button className="tasks-tab" onClick={() => jumpTo('today')}>{t('今日')}</button>
            <button className="tasks-tab" onClick={() => jumpTo('next7')}>{t('未来 7 天')}</button>
            <button className="tasks-tab" onClick={() => jumpTo('overdue')}>{t('已逾期')}</button>
            <button className="tasks-tab" onClick={() => jumpTo('done')}>{t('已完成')}</button>
            <button className={'tasks-tab' + (tab === 'goals' ? ' on' : '')} onClick={() => setTab('goals')}>
              {t('🎯 长远目标')}{gs.active.length > 0 && <span className="n">{gs.active.length}</span>}
            </button>
          </div>
          {tab === 'goals' && (
            <button className="btn btn-sm btn-primary goal-new" onClick={requestNewGoal}>{t('＋ 新建目标')}</button>
          )}
        </div>
        {tab === 'board' && (
          <>
            <div className="row-wrap tasks-filter-row">
          <button className="btn btn-primary" onClick={openNew}>{t('＋ 新建待办')}</button>
          <div className="row chip-row" data-slide style={{ gap: 4 }}>
            <button className={'chip ' + (filter === '全部' ? 'on' : '')} onClick={() => setFilter('全部')}>{t('全部')}</button>
            {CATEGORIES.map((c) => (
              <button key={c} className={'chip ' + (filter === c ? 'on' : '')} onClick={() => setFilter(c)}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: CATEGORY_COLORS[c], display: 'inline-block' }} />
                {t(c)}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <input className="input" style={{ maxWidth: 200 }} placeholder={t('搜索待办…')} value={kw} onChange={(e) => setKw(e.target.value)} />
        </div>
            <div className="muted mt8">
              {t('共 {n} 条 · 7 天以后 {later}', { n: tasks.length, later: b.later.length })}
              {b.pool.length > 0 && ' · ' + t('时间池 {n} 条（{time}）', { n: b.pool.length, time: humanMinutes(poolMinutes) })}
            </div>
          </>
        )}
      </div>

      {tab === 'board' ? (
        <>
          <div className="kanban">
            <Column colId="today" title={t('今日')} icon="📌" color="#6d8bff" items={b.today} today={today} onToggle={toggle} onEdit={setEditing} onDelete={del} empty={t('今天没有待办')} />
            <Column colId="next7" title={t('未来 7 天')} icon="🗓️" color="#a06bff" items={b.next7} today={today} onToggle={toggle} onEdit={setEditing} onDelete={del} empty={t('未来 7 天暂无安排')} />
            <Column colId="overdue" title={t('已逾期')} icon="⚠️" color="#ff5a6a" items={b.overdue} today={today} onToggle={toggle} onEdit={setEditing} onDelete={del} empty={t('没有逾期，很棒')} />
            <Column colId="done" title={t('已完成')} icon="✅" color="#22c55e" items={b.done} today={today} onToggle={toggle} onEdit={setEditing} onDelete={del} empty={t('还没有完成的待办')} />
          </div>

      {/* 7 天以后的安排（不在四栏内，但不能被藏起来） */}
      {b.later.length > 0 && (
        <div className="card mt16">
          <div className="card-h">
            <span className="ico">🔭</span><h3>{t('7 天以后')}</h3>
            <span className="muted">{t('{n} 条 · 最近一条 {day}', { n: b.later.length, day: relativeDay(b.later[0].dueDate || today) })}</span>
          </div>
          <div className="pool">
            {b.later.slice(0, 12).map((task) => (
              <div key={task.id} className="pool-item">
                <span style={{ width: 7, height: 7, borderRadius: 4, background: CATEGORY_COLORS[task.category], flex: '0 0 7px' }} />
                <span style={{ flex: 1 }}>{task.title}</span>
                <Tag text={task.priority} color={PRIORITY_COLORS[task.priority]} />
                <span className="muted">{task.dueDate ? relativeDay(task.dueDate) : ''}</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(task)}>{t('编辑')}</button>
              </div>
            ))}
            {b.later.length > 12 && <div className="muted">{t('仅显示最近 12 条…')}</div>}
          </div>
        </div>
      )}

      {/* 待办时间池 */}
      <div className="card mt16">
        <div className="card-h">
          <span className="ico">⏳</span>
          <h3>{t('待办时间池')}</h3>
          <span className="muted">{t('未安排日期的事项，合计 {time}', { time: humanMinutes(poolMinutes) })}</span>
          <div className="right">
            <button className="btn btn-ghost btn-sm" onClick={() => setShowPool((v) => !v)}>{showPool ? t('收起') : t('展开')}</button>
          </div>
        </div>
        {showPool && (
          b.pool.length === 0
            ? <div className="muted">{t('时间池是空的 —— 每条待办都已经安排到了具体日期 👍')}</div>
            : (
              <div className="pool">
                {b.pool.map((task) => (
                  <div key={task.id} className="pool-item">
                    <span style={{ width: 7, height: 7, borderRadius: 4, background: CATEGORY_COLORS[task.category], flex: '0 0 7px' }} />
                    <span style={{ flex: 1 }}>{task.title}</span>
                    <Tag text={task.priority} color={PRIORITY_COLORS[task.priority]} />
                    <span className="muted">{humanMinutes(task.estimateMinutes)}</span>
                    <button className="btn btn-sm" onClick={() => { patchRecord<TaskData>('tasks', task.id, { dueDate: today }); toast(t('已安排到今天'), 'ok'); }}>{t('今天')}</button>
                    <button className="btn btn-sm" onClick={() => { patchRecord<TaskData>('tasks', task.id, { dueDate: addDays(today, 1) }); toast(t('已安排到明天'), 'ok'); }}>{t('明天')}</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(task)}>{t('编辑')}</button>
                  </div>
                ))}
              </div>
            )
        )}
      </div>
        </>
      ) : (
        <GoalsView goals={goalRows} createSignal={goalCreateSignal} onNewGoal={requestNewGoal} />
      )}

      {goalCreateOpen && (
        <Modal title={t('新建长远目标')} onClose={() => setGoalCreateOpen(false)}>
          <GoalForm mode="create" onSaved={() => setGoalCreateOpen(false)} onCancel={() => setGoalCreateOpen(false)} />
        </Modal>
      )}

      {editing && (
        <TaskEditor
          task={editing}
          anns={anns}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function goalDayText(day: string): string {
  const n = daysFromToday(day);
  if (n === 0) return t('就是今天');
  if (n > 0) return t('还有 {n} 天', { n });
  return t('已逾期 {n} 天', { n: Math.abs(n) });
}

function GoalsView(props: {
  goals: Item<GoalData>[];
  createSignal: number;
  onNewGoal: () => void;
}) {
  const stats = goalStats(props.goals);
  const [editing, setEditing] = useState<Item<GoalData> | null>(null);
  const [progressFor, setProgressFor] = useState<Item<GoalData> | null>(null);
  const createRef = useRef<HTMLInputElement>(null);
  const monthCount = monthGoalProgressCount(props.goals);

  useEffect(() => {
    if (props.createSignal > 0) createRef.current?.focus();
  }, [props.createSignal]);

  const restore = (goal: Item<GoalData>) => {
    patchRecord<GoalData>('goals', goal.id, { status: '进行中', completedAt: null });
    toast(t('已恢复为进行中'), 'ok');
  };

  return (
    <>
      <div className="goals-view">
        <div className="goals-main">
          <div className="card goal-stats-card">
            <div className="goal-stats">
              <div className="goal-stat">
                <span className="goal-stat-k">{t('本月累计推进')}</span>
                <span className="goal-stat-v">
                  {monthCount} <small>/ {stats.total} {t('次')}</small>
                </span>
              </div>
              <div className="goal-stat goal-stat-remind">
                <span className="goal-stat-k">{t('最近一个提醒')}</span>
                <span className="goal-stat-v">
                  {stats.next
                    ? <><b>「{stats.next.title}」</b><span className="when"> · {goalDayText((stats.next.remindAt || '').slice(0, 10))}</span></>
                    : t('暂无提醒')}
                </span>
              </div>
            </div>
            <span className="goal-hint">{t('目标不占每天的时间，到点才提醒')}</span>
          </div>

          {stats.active.length === 0 ? (
            <div className="card">
              <div className="goal-empty">
                <Empty icon="🎯" text={t('还没有长远目标')} hint={t('目标不占每天的时间，到点才提醒')} />
                <div className="goal-empty-action">
                  <button className="link-btn" onClick={props.onNewGoal}>{t('新建第一个目标')}</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card goal-list">
              <div className="card-h">
                <span className="ico">🎯</span><h3>{t('正在推进')}</h3>
                <span className="goal-list-hint">{t('{n} 个 · 按提醒时间排', { n: stats.active.length })}</span>
              </div>
              {stats.active.map((goal) => (
                <GoalCard key={goal.id} goal={goal} onProgress={setProgressFor} onEdit={setEditing} />
              ))}
            </div>
          )}
        </div>

        <div className="goals-side">
          <div className="card goal-create-card">
            <div className="card-h">
              <span className="ico">🎯</span><h3>{t('新建长远目标')}</h3>
            </div>
            <GoalForm mode="create" inputRef={createRef} />
          </div>

          {stats.completed.length > 0 && (
            <div className="card goal-list">
              <div className="card-h">
                <span className="ico">✅</span><h3>{t('已经做到的')}</h3>
                <span className="goal-list-hint">{t('{n} 个', { n: stats.completed.length })}</span>
              </div>
              {stats.completed.map((goal) => (
                <div className="goal-done-row" key={goal.id}>
                  <span className="goal-done-title">✓ {goal.title}</span>
                  <span className="goal-done-date">
                    {goal.completedAt ? ymd(new Date(goal.completedAt)) + ' ' + t('完成') : t('已完成')}
                  </span>
                  <button className="btn btn-sm btn-ghost" onClick={() => restore(goal)}>{t('恢复')}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <Modal title={t('编辑目标')} onClose={() => setEditing(null)}>
          <GoalForm key={editing.id} mode="edit" goal={editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
        </Modal>
      )}
      {progressFor && (
        <GoalProgressModal goal={progressFor} onClose={() => setProgressFor(null)} />
      )}
    </>
  );
}

function GoalCard(props: { goal: Item<GoalData>; onProgress: (g: Item<GoalData>) => void; onEdit: (g: Item<GoalData>) => void }) {
  const goal = props.goal;
  const progress = Math.max(0, Math.min(100, Number(goal.progress) || 0));
  const remind = goalRemindChip(goal.remindAt, goal.targetDate);
  let remindText = '';
  if (remind) {
    if (remind.kind === 'before') remindText = t('提醒：提前 {n} 天', { n: remind.days });
    else if (remind.kind === 'same') remindText = t('提醒：当天 {time}', { time: remind.time });
    else remindText = t('提醒：{date} {time}', { date: fmtCN(remind.date), time: remind.time });
  }

  return (
    <div className="goal-row">
      <div className="goal-row-top">
        <span className="goal-title">{goal.title}</span>
        <span className="goal-chips">
          <span className="goal-chip">{t(goal.category)}</span>
          {remindText && <span className="goal-chip">🔔 {remindText}</span>}
        </span>
        <span className="goal-date">
          {goal.targetDate ? t('目标日 {date}', { date: goal.targetDate }) + ' · ' + goalDayText(goal.targetDate) : t('未设目标日')}
        </span>
      </div>
      <div className="goal-progress">
        <Bar thin value={progress} />
        <span className="goal-pct">{progress}%</span>
        <div className="goal-actions">
          <button className="btn btn-sm" onClick={() => props.onProgress(goal)}>{t('记录进度')}</button>
          <button className="btn btn-sm btn-ghost" onClick={() => props.onEdit(goal)}>{t('编辑')}</button>
        </div>
      </div>
      {goal.milestones && <div className="goal-milestones">{t('里程碑：')}{goal.milestones}</div>}
      {goal.note && <div className="goal-note">{goal.note}</div>}
    </div>
  );
}

function GoalForm(props: {
  mode: 'create' | 'edit';
  goal?: Item<GoalData>;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const { mode, goal } = props;
  const [title, setTitle] = useState(goal?.title || '');
  const [category, setCategory] = useState<Category>(goal?.category || '学习');
  const [targetDate, setTargetDate] = useState(goal?.targetDate || '');
  const [remindAt, setRemindAt] = useState(goal?.remindAt || (mode === 'create' ? presetRemindAt('30d') : ''));
  const [preset, setPreset] = useState<GoalRemindPreset | 'custom' | 'none'>(
    mode === 'create' ? '30d' : (goal?.remindAt ? 'custom' : 'none')
  );
  const [note, setNote] = useState(goal?.note || '');
  const [progress, setProgress] = useState(Math.max(0, Math.min(100, Number(goal?.progress) || 0)));
  const [milestones, setMilestones] = useState(goal?.milestones || '');

  const reset = () => {
    setTitle('');
    setCategory('学习');
    setTargetDate('');
    setNote('');
    setPreset('30d');
    setRemindAt(presetRemindAt('30d'));
  };

  const choosePreset = (key: GoalRemindPreset) => {
    setPreset(key);
    setRemindAt(presetRemindAt(key));
  };

  const presetLabel = preset === 'custom'
    ? t('自定义日期…')
    : preset === 'none'
      ? t('不提醒')
      : t((GOAL_REMIND_PRESETS.find((p) => p.key === preset) || GOAL_REMIND_PRESETS[0]).label);
  const whenText = remindAt ? fmtCN(remindAt.slice(0, 10)) + ' ' + remindAt.slice(11, 16) : '';

  const save = () => {
    if (!title.trim()) {
      toast(t('请填写目标名字'), 'err');
      return;
    }
    let finalRemind: string | null = null;
    if (preset !== 'none') {
      finalRemind = (preset === 'custom' ? remindAt : presetRemindAt(preset)) || null;
    }
    const data: GoalData = {
      title: title.trim(),
      category,
      note: note.trim(),
      targetDate: targetDate || null,
      remindAt: finalRemind,
      progress: mode === 'edit' ? progress : 0,
      milestones: mode === 'edit' ? milestones.trim() : '',
      status: goal?.status || '进行中',
      completedAt: goal?.completedAt ?? null,
      createdAt: goal?.createdAt ?? Date.now()
    };
    const id = mode === 'edit' && goal ? goal.id : newId();
    putRecord<GoalData>('goals', id, data);
    toast(mode === 'edit' ? t('已保存修改') : t('已创建目标'), 'ok');
    if (mode === 'create') reset();
    props.onSaved?.();
  };

  const cancel = () => {
    if (props.onCancel) props.onCancel();
    else reset();
  };

  const markDone = () => {
    if (!goal) return;
    patchRecord<GoalData>('goals', goal.id, { status: '已完成', completedAt: Date.now() });
    toast(t('目标已完成'), 'ok');
    props.onSaved?.();
  };

  const restore = () => {
    if (!goal) return;
    patchRecord<GoalData>('goals', goal.id, { status: '进行中', completedAt: null });
    toast(t('已恢复为进行中'), 'ok');
    props.onSaved?.();
  };

  const del = async () => {
    if (!goal) return;
    const ok = await askConfirm(t('删除目标'), t('确定删除「{name}」吗？该操作会同步到所有设备。', { name: goal.title }), { okText: t('删除'), danger: true });
    if (!ok) return;
    removeRecord('goals', goal.id);
    toast(t('已删除'), 'ok', {
      label: t('撤销'),
      run: () => {
        putRecord<GoalData>('goals', goal.id, withoutId(goal));
        toast(t('已恢复'), 'ok');
      }
    });
    props.onSaved?.();
  };

  return (
    <div className="goal-form">
      <Field label={t('目标名字')} full>
        <input
          ref={props.inputRef}
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('例如：考过四级 / 攒够 1 万 / 学会游泳')}
        />
      </Field>

      <Field label={t('什么时候提醒我')} full>
        <div className="goal-preset-row">
          {GOAL_REMIND_PRESETS.map((p) => (
            <button key={p.key} className={'chip ' + (preset === p.key ? 'on' : '')} onClick={() => choosePreset(p.key)}>
              {t(p.label)}
            </button>
          ))}
          <button
            className={'chip ' + (preset === 'custom' ? 'on' : '')}
            onClick={() => { setPreset('custom'); if (!remindAt) setRemindAt(defaultCustomRemindAt()); }}
          >{t('自定义日期…')}</button>
          <button
            className={'chip ' + (preset === 'none' ? 'on' : '')}
            onClick={() => { setPreset('none'); setRemindAt(''); }}
          >{t('不提醒')}</button>
        </div>
        {preset === 'custom' && (
          <input
            className="input"
            style={{ marginTop: 8 }}
            type="datetime-local"
            value={remindAt}
            onChange={(e) => { setRemindAt(e.target.value); if (!e.target.value) setPreset('none'); }}
          />
        )}
        <div className="goal-form-note">
          {preset !== 'none' && whenText
            ? t('选「{label}」会在 {when} 提醒一次，到点弹系统通知。', { label: presetLabel, when: whenText })
            : t('不提醒也没关系，目标会一直留在这里。')}
        </div>
      </Field>

      <Field label={t('目标日（可选）')} full>
        <input className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
      </Field>

      <Field label={t('分类')} full>
        <div className="goal-preset-row">
          {CATEGORIES.map((c) => (
            <button key={c} className={'chip ' + (category === c ? 'on' : '')} onClick={() => setCategory(c)}>{t(c)}</button>
          ))}
        </div>
      </Field>

      {mode === 'edit' && (
        <>
          <Field label={t('当前进度')} full>
            <div className="goal-progress-edit">
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={progress}
                onChange={(e) => setProgress(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              />
              <b>%</b>
            </div>
          </Field>
          <Field label={t('里程碑')} full>
            <textarea
              className="textarea"
              rows={2}
              value={milestones}
              onChange={(e) => setMilestones(e.target.value)}
              placeholder={t('例如：单词背完 2800/4500 · 真题 6/12 套')}
            />
          </Field>
        </>
      )}

      <Field label={t('备注')} full>
        <textarea
          className="textarea"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('为什么要做这件事、怎么算完成…')}
        />
      </Field>

      <div className="goal-form-actions">
        <button className="btn btn-primary" onClick={save}>{mode === 'edit' ? t('保存') : t('创建目标')}</button>
        <button className="btn btn-ghost" onClick={cancel}>{t('取消')}</button>
      </div>

      {mode === 'edit' && goal && (
        <div className="goal-edit-extra">
          {goal.status === '进行中'
            ? <button className="btn btn-sm" onClick={markDone}>{t('标记为已完成')}</button>
            : <button className="btn btn-sm" onClick={restore}>{t('恢复为进行中')}</button>}
          <button className="btn btn-sm btn-danger goal-delete" onClick={del}>{t('删除目标')}</button>
        </div>
      )}
    </div>
  );
}

function GoalProgressModal(props: { goal: Item<GoalData>; onClose: () => void }) {
  const [progress, setProgress] = useState(Math.max(0, Math.min(100, Number(props.goal.progress) || 0)));
  const [milestones, setMilestones] = useState(props.goal.milestones || '');

  const save = () => {
    patchRecord<GoalData>('goals', props.goal.id, {
      progress, milestones: milestones.trim(), progressLog: pushProgressStamps(props.goal.progressLog)
    });
    toast(t('已记录进度'), 'ok');
    props.onClose();
  };

  return (
    <Modal title={t('记录进度')} onClose={props.onClose}>
      <div className="goal-form">
        <Field label={t('当前进度')} full>
          <div className="goal-progress-edit">
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              value={progress}
              onChange={(e) => setProgress(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            />
            <b>%</b>
          </div>
        </Field>
        <Field label={t('里程碑')} full>
          <textarea
            className="textarea"
            rows={3}
            value={milestones}
            onChange={(e) => setMilestones(e.target.value)}
            placeholder={t('例如：单词背完 2800/4500 · 真题 6/12 套')}
          />
        </Field>
        <div className="goal-form-actions">
          <button className="btn btn-primary" onClick={save}>{t('保存')}</button>
          <button className="btn btn-ghost" onClick={props.onClose}>{t('取消')}</button>
        </div>
      </div>
    </Modal>
  );
}

function Column(props: {
  colId: string; title: string; icon: string; color: string; items: Item<TaskData>[]; today: string; empty: string;
  onToggle: (t: Item<TaskData>, done: boolean) => void;
  onEdit: (t: Item<TaskData>) => void;
  onDelete: (t: Item<TaskData>) => void;
}) {
  return (
    <div className="col tasks-col" id={'tasks-col-' + props.colId}>
      <div className="col-h">
        <span style={{ color: props.color }}>{props.icon}</span>
        <span>{props.title}</span>
        <span className="n">{props.items.length}</span>
      </div>
      <div className="col-body">
        {props.items.length === 0 && <div className="muted" style={{ padding: '8px 2px' }}>{props.empty}</div>}
        {props.items.slice(0, 60).map((item) => <TaskItem key={item.id} task={item} today={props.today} onToggle={props.onToggle} onEdit={props.onEdit} onDelete={props.onDelete} />)}
        {props.items.length > 60 && <div className="muted">{t('仅显示前 60 条…')}</div>}
      </div>
    </div>
  );
}

function TaskItem(props: { task: Item<TaskData>; today: string; onToggle: (t: Item<TaskData>, d: boolean) => void; onEdit: (t: Item<TaskData>) => void; onDelete: (t: Item<TaskData>) => void }) {
  const task = props.task;
  const done = task.status === '已完成';
  const st = displayStatus(task, props.today);
  const ann = task.anniversaryId ? list<AnniversaryData>('anniversaries').find((a) => a.id === task.anniversaryId) : null;

  return (
    <div className={'task-item' + (done ? ' done' : '')} style={{ borderLeftColor: CATEGORY_COLORS[task.category] || '#888' }} onClick={() => props.onEdit(task)}>
      {/* 一行主信息 + 一行次要信息；整行点开编辑，右边只留一个「完成」勾选 */}
      <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-title">{task.title}</div>
          <div className="t-meta">
            <Tag text={task.priority} color={PRIORITY_COLORS[task.priority]} />
            {!done && st !== '未开始' && <Tag text={t(st)} color={STATUS_COLORS[st]} />}
            {task.dueDate ? <span>{relativeDay(task.dueDate)}{task.dueTime ? ' ' + task.dueTime : ''}</span> : <span>{t('未安排日期')}</span>}
            {task.estimateMinutes ? <span>⏱ {humanMinutes(task.estimateMinutes)}</span> : null}
            {task.repeat && task.repeat !== '不重复' ? <span>🔁 {t(task.repeat)}</span> : null}
            {!done && task.remindAt ? <span className="t-remind">🔔 {fmtRemind(task.remindAt)}</span> : null}
          </div>
          {ann && <div className="t-meta" style={{ marginTop: 4 }}><span>{t('🎯 关联「{name}」完成 +10%', { name: ann.title })}</span></div>}
          {task.note ? <div className="muted" style={{ marginTop: 5, whiteSpace: 'pre-wrap' }}>{task.note}</div> : null}
        </div>
        <button
          className={'check' + (done ? ' on' : '')}
          onClick={(e) => { e.stopPropagation(); props.onToggle(task, !done); }}
          title={done ? t('标记为未完成') : t('标记为已完成')}
        >✓</button>
      </div>
    </div>
  );
}

function TaskEditor(props: { task: Item<TaskData>; anns: Item<AnniversaryData>[]; onClose: () => void }) {
  const isNew = !props.task.id;
  const [f, setF] = useState<Item<TaskData>>({ ...props.task });
  const set = (patch: Partial<TaskData>) => setF((prev) => ({ ...prev, ...patch }));

  const save = () => {
    if (!f.title.trim()) { toast(t('请填写任务名称'), 'err'); return; }
    const data: TaskData = {
      ...withoutId(f),   // id 只做行键，不能跟着存进 data 里
      title: f.title.trim(),
      estimateMinutes: Number(f.estimateMinutes) || 0,
      note: f.note || ''
    };
    const id = isNew ? newId() : f.id;
    putRecord<TaskData>('tasks', id, data);
    rescheduleNativeReminders(1200);   // 设了提醒就不用等自动同步，尽快排进系统闹钟
    toast(isNew ? t('已创建待办') : t('已保存修改'), 'ok');
    props.onClose();
  };

  return (
    <Modal
      title={isNew ? t('新建待办') : t('编辑待办')}
      onClose={props.onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={props.onClose}>{t('取消')}</button>
        <button className="btn btn-primary" onClick={save}>{isNew ? t('创建') : t('保存')}</button>
      </>}
    >
      <div className="form-grid">
        <Field label={t('任务名称 *')} full>
          <input className="input" autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
            placeholder={t('例如：交高等数学作业')} />
        </Field>

        <Field label={t('所属类型')}>
          <div className="row" style={{ gap: 4 }}>
            {CATEGORIES.map((c) => (
              <button key={c} className={'chip ' + (f.category === c ? 'on' : '')} onClick={() => set({ category: c })}>{t(c)}</button>
            ))}
          </div>
        </Field>

        <Field label={t('优先级')}>
          <div className="row" style={{ gap: 4 }}>
            {PRIORITIES.map((p) => (
              <button key={p} className={'chip ' + (f.priority === p ? 'on' : '')} onClick={() => set({ priority: p })}>{p}</button>
            ))}
          </div>
        </Field>

        <Field label={t('截止日期')} hint={t('留空则进入「待办时间池」，稍后再安排')}>
          <input className="input" type="date" value={f.dueDate || ''} onChange={(e) => set({ dueDate: e.target.value || null })} />
        </Field>
        <Field label={t('截止时间')}>
          <input className="input" type="time" value={f.dueTime || ''} onChange={(e) => set({ dueTime: e.target.value || null })} />
        </Field>

        <Field label={t('提醒我')} hint={t('到点推送系统通知（需允许通知权限）；和按截止时间自动提醒互不影响')} full>
          <div className="row-wrap" style={{ gap: 6, alignItems: 'center' }}>
            <input className="input" style={{ minWidth: 210 }} type="datetime-local"
              value={f.remindAt || ''} onChange={(e) => set({ remindAt: e.target.value || null })} />
            {REMIND_PRESETS.map((p) => (
              <button key={p.label} className="chip" onClick={() => set({ remindAt: p.at() })}>{t(p.label)}</button>
            ))}
            {f.remindAt ? <button className="chip" onClick={() => set({ remindAt: null })}>{t('清除提醒')}</button> : null}
          </div>
        </Field>

        <Field label={t('状态')}>
          <select className="select" value={f.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
            {STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
          </select>
        </Field>
        <Field label={t('预计耗时（分钟）')}>
          <input className="input" type="number" min={0} step={5} value={f.estimateMinutes} onChange={(e) => set({ estimateMinutes: Number(e.target.value) })} />
        </Field>

        <Field label={t('是否重复')}>
          <select className="select" value={f.repeat} onChange={(e) => set({ repeat: e.target.value as RepeatRule })}>
            {REPEATS.map((r) => <option key={r} value={r}>{t(r)}</option>)}
          </select>
        </Field>
        <Field label={t('关联重要日期')} hint={t('完成后该纪念日准备进度自动 +10%')}>
          <select className="select" value={f.anniversaryId || ''} onChange={(e) => set({ anniversaryId: e.target.value || null })}>
            <option value="">{t('不关联')}</option>
            {props.anns.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.title}</option>)}
          </select>
        </Field>

        <Field label={t('备注')} full>
          <textarea className="textarea" value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder={t('补充说明、资料链接、检查清单…')} />
        </Field>
      </div>

      {f.dueDate && (
        <div className="muted mt8">{t('截止：{date}（{rel}）', { date: fmtCN(f.dueDate), rel: relativeDay(f.dueDate) })}{f.dueTime ? ' ' + f.dueTime : ''}</div>
      )}
      {f.remindAt && (
        <div className="muted mt4">{t('提醒：{time}', { time: f.remindAt.replace('T', ' ') })} <button className="chip" style={{ marginLeft: 6 }} onClick={() => set({ remindAt: null })}>{t('取消提醒')}</button></div>
      )}
      {!isNew && (
        <div className="mt12 row">
          <button className="btn btn-danger btn-sm" onClick={async () => {
            const ok = await askConfirm(t('删除待办'), t('确定删除这条待办吗？'), { okText: t('删除'), danger: true });
            if (!ok) return;
            const snap = props.task;
            removeRecord('tasks', f.id);
            rescheduleNativeReminders(600);
            toast(t('已删除'), 'ok', {
              label: t('撤销'),
              run: () => {
                putRecord<TaskData>('tasks', snap.id, withoutId(snap));
                rescheduleNativeReminders(200);
                toast(t('已恢复'), 'ok');
              }
            });
            props.onClose();
          }}>{t('删除这条待办')}</button>
        </div>
      )}
    </Modal>
  );
}
