import React, { useMemo, useState } from 'react';
import { list, useDB, putRecord, patchRecord, removeRecord, newId, withoutId, saveConfig, cfg } from '../lib/db';
import type { Item } from '../lib/db';
import type { HabitData, HabitLogData } from '../types';
import { HABIT_ICONS, COURSE_PALETTE } from '../types';
import { Modal, Field, toast, askConfirm, Empty, Bar } from '../components/ui';
import { SubPage, SetRow } from '../components/SubPage';
import { todayStr, addDays, WEEKDAY_SHORT, parseYMD } from '../lib/date';
import { habitStat } from '../lib/logic';
import { toggleHabitCheck, setHabitAmount } from '../lib/actions';
import { rescheduleNativeReminders } from '../lib/nativeReminders';
import { t } from '../lib/i18n';

/** 把提醒时刻整理成 HH:mm（去重、排序、丢掉非法值）。导出给测试用。 */
export function normTimes(times?: string[]): string[] {
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

/** 常见时间点：点一下加上，省得每次自己拨表 */
export const REMIND_SUGGEST = [
  { at: '07:00', label: '早起' },
  { at: '12:00', label: '中午' },
  { at: '19:00', label: '傍晚' },
  { at: '21:30', label: '晚上' },
  { at: '23:00', label: '睡前' }
];

/** 打卡规则的长说明：整段放在二级页，文案一个字没改 */
function RulesText() {
  return (
    <div className="muted" style={{ lineHeight: 1.9 }}>
      {'· '}<b>{t('每日最低完成量')}</b>{t('：给习惯设一个每天至少要做到的量（比如背单词 20 个、跑步 30 分钟），')}{' '}
      {t('记录当天做了多少，')}<b>{t('达到这个量才算达标')}</b>{t('；没达到当天不计入连续。')}<br />
      {'· '}{t('不设量的习惯保持原来的二元打卡：做了就算。')}<br />
      {'· '}{t('连续天数：从今天（今天未达标则从昨天）往前逐日回溯，连续达标即累计 +1。')}<br />
      {'· '}{t('断签重置：只要中间缺一天，连续天数归零；下一次打卡从 ')}<b>{t('1 天')}</b>{t(' 重新开始。')}<br />
      {'· '}{t('累计次数：该习惯历史上所有打卡日的数量，不会因断签减少。')}<br />
      {'· '}{t('补卡：点击上方一周内的小方格，可补打或取消任意一天的记录。')}<br />
      {'· '}{t('每日提醒：每个习惯可以单独设几个时间点（比如早 7:00、晚 21:30），到点各弹一条通知；')}{' '}
      {t('当天已经达标的习惯，当天剩下的时间点就不再打扰。')}
    </div>
  );
}

export default function Habits() {
  useDB();
  const today = todayStr();
  const habits = list<HabitData>('habits');
  const logs = list<HabitLogData>('habitLogs');
  const [editing, setEditing] = useState<Item<HabitData> | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  // 设了"每日最低完成量"的习惯，达标 = 当天完成量 ≥ 这个数
  const stats = useMemo(
    () => habits.map((h) => ({ h, s: habitStat(h.id, logs, today, Number(h.dailyMin) || 0) })),
    [habits, logs, today]
  );
  const active = stats.filter((x) => !x.h.paused);
  const doneToday = active.filter((x) => x.s.checkedToday).length;
  const bestStreak = stats.reduce((m, x) => Math.max(m, x.s.streak), 0);
  const totalChecks = logs.length;

  const openNew = () => setEditing({
    id: '', name: '', icon: '💪', color: '#6d8bff', paused: false, note: '',
    dailyMin: 0, unit: '', createdAt: Date.now()
  } as Item<HabitData>);

  // 打卡规则从「页尾一大段灰字」改成二级页：根页只留一行入口，点开才看细则
  if (rulesOpen) {
    return (
      <SubPage title={t('打卡规则')} onBack={() => setRulesOpen(false)}>
        <div className="card"><RulesText /></div>
      </SubPage>
    );
  }

  return (
    <>
      <div className="card mb12">
        <div className="row-wrap">
          <button className="btn btn-primary" onClick={openNew}>{t('＋ 新建习惯')}</button>
        </div>
        {/* 数字 + 小单位：和待办页同一套统计排法 */}
        <div className="stat-row mt12">
          <div className="stat">
            <span className="stat-u">{t('今日已达标')}</span>
            <span className="stat-n">{doneToday} / {active.length}</span>
          </div>
          <div className="stat">
            <span className="stat-u">{t('最长连续')}</span>
            <span className="stat-n">{bestStreak}</span><span className="stat-u">{t('天')}</span>
          </div>
          <div className="stat">
            <span className="stat-u">{t('累计打卡')}</span>
            <span className="stat-n">{totalChecks}</span><span className="stat-u">{t('次')}</span>
          </div>
        </div>
        <div className="mt12">
          <Bar value={active.length ? Math.round((doneToday / active.length) * 100) : 0} tone="good" />
        </div>
      </div>

      {habits.length === 0 ? (
        <div className="card"><Empty icon="🔥" text={t('还没有习惯')} hint={t('添加「早起」「背单词」「健身」这类每天想坚持的事')} /></div>
      ) : (
        <div className="habit-grid">
          {stats.map(({ h, s }) => (
            <div key={h.id} className={'card habit-card' + (h.paused ? ' paused' : '')}>
              {/* 中性行：左边圆点（打卡了才打勾）+ 名字，右边连续天数；不再用彩色胶囊 */}
              <div className={'habit-row' + (s.checkedToday ? ' on' : '')}>
                <span className="habit-dot">{s.checkedToday ? '✓' : ''}</span>
                <span className="habit-name">{h.name}</span>
                {normTimes(h.remindTimes).length > 0 && !h.paused && (
                  <span className="habit-times">🔔 {normTimes(h.remindTimes).join(' · ')}</span>
                )}
                <span className="habit-streak habit-num sm"><b>{s.streak}</b> {t('连续天数')}</span>
              </div>
              {/* 状态 + 累计/最长收成一行小字（顺序仍是连续 → 累计 → 最长，测试和读屏都按这个来） */}
              <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>
                {h.paused ? t('已暂停') : s.checkedToday ? t('今日已打卡') : s.keepAlive ? t('今天还没打卡，连续未断') : t('断签了，今天打卡从 1 天重新开始')}
                {' · '}{t('累计次数')}{' '}<span className="habit-num sm"><b>{s.total}</b></span>
                {' · '}{t('最长连续')}{' '}<span className="habit-num sm"><b>{s.best}</b></span>
              </div>

              <div className="week-dots">
                {s.last7.map((d) => {
                  const wd = WEEKDAY_SHORT[parseYMD(d.date).getDay()];
                  return (
                    <div
                      key={d.date}
                      className={'wd' + (d.on ? ' on' : '') + (d.isToday ? ' today' : '')}
                      title={d.date + t('（点击补卡/取消）')}
                      style={{ cursor: 'pointer' }}
                      onClick={() => { if (!h.paused) toggleHabitCheck(h.id, d.date); }}
                    >
                      {wd}<i />
                    </div>
                  );
                })}
              </div>

              {Number(h.dailyMin) > 0 ? (
                /* 设了每日最低完成量的习惯：记的是"今天做了多少"，不是二元打卡 */
                <div>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span className="muted">{t('今日完成量')}</span>
                    <b style={{ fontSize: 15, color: s.checkedToday ? 'var(--good)' : h.color }}>
                      {s.todayAmount} / {h.dailyMin}{h.unit || ''}
                    </b>
                  </div>
                  <div className="mt8">
                    <Bar value={Math.min(100, Math.round((s.todayAmount / Number(h.dailyMin)) * 100))} tone={s.checkedToday ? 'good' : undefined} />
                  </div>
                  <div className="row mt8" style={{ gap: 6 }}>
                    <button className="btn btn-sm" disabled={h.paused || s.todayAmount <= 0}
                      onClick={() => setHabitAmount(h.id, today, s.todayAmount - 1)}>−</button>
                    <input className="input" type="number" min={0} style={{ width: 74, textAlign: 'center' }}
                      disabled={h.paused} value={s.todayAmount}
                      onChange={(e) => setHabitAmount(h.id, today, Number(e.target.value) || 0)} />
                    <button className="btn btn-sm" disabled={h.paused}
                      onClick={() => setHabitAmount(h.id, today, s.todayAmount + 1)}>＋</button>
                    <button className={'btn btn-sm ' + (s.checkedToday ? '' : 'btn-primary')} style={{ flex: 1 }}
                      disabled={h.paused}
                      onClick={() => {
                        setHabitAmount(h.id, today, Number(h.dailyMin));
                        toast(s.checkedToday ? t('已记满今天的量') : t('{name} 今日达标 🎉 连续 {n} 天', { name: h.name, n: s.streak + 1 }), 'ok');
                      }}>
                      {s.checkedToday ? t('✓ 已达标') : t('记满 {n}{unit}', { n: h.dailyMin, unit: h.unit || '' })}
                    </button>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                    {t('每日最低 {n}{unit}，达到才算达标；没达到当天不计入连续', { n: h.dailyMin, unit: h.unit || '' })}
                  </div>
                </div>
              ) : (
                <div className="row" style={{ gap: 8 }}>
                  <button
                    className={'btn ' + (s.checkedToday ? '' : 'btn-primary')}
                    style={{ flex: 1 }}
                    disabled={h.paused}
                    onClick={() => {
                      const on = toggleHabitCheck(h.id, today);
                      toast(on ? t('{name} 打卡成功，连续 {n} 天', { name: h.name, n: s.streak + 1 }) : t('已取消今日打卡'), on ? 'ok' : 'info');
                    }}
                  >
                    {s.checkedToday ? t('✓ 今日已打卡（点击取消）') : h.paused ? t('已暂停') : t('立即打卡')}
                  </button>
                </div>
              )}

              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(h)}>{t('编辑')}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => {
                  patchRecord<HabitData>('habits', h.id, { paused: !h.paused });
                  toast(h.paused ? t('已恢复打卡') : t('已暂停打卡'), 'info');
                }}>{h.paused ? t('恢复') : t('暂停')}</button>
                <button className="btn btn-sm btn-danger" onClick={async () => {
                  const ok = await askConfirm(t('删除习惯'), t('将同时删除「{name}」的全部打卡记录，且同步到所有设备。', { name: h.name }), { okText: t('删除'), danger: true });
                  if (!ok) return;
                  const habitSnap = withoutId(h as HabitData & { id: string });
                  const logSnaps = logs.filter((l) => l.habitId === h.id).map((l) => ({ id: l.id, data: withoutId(l) }));
                  for (const l of logs) if (l.habitId === h.id) removeRecord('habitLogs', l.id);
                  removeRecord('habits', h.id);
                  toast(t('已删除习惯'), 'ok', {
                    label: t('撤销'),
                    run: () => {
                      putRecord<HabitData>('habits', h.id, habitSnap);
                      for (const s of logSnaps) putRecord<HabitLogData>('habitLogs', s.id, s.data);
                      toast(t('已恢复'), 'ok');
                    }
                  });
                }}>删除</button>
              </div>

              {h.note ? <div className="muted">{h.note}</div> : null}
            </div>
          ))}
        </div>
      )}

      <div className="card set-list mt16">
        <SetRow icon="📐" title={t('打卡规则')} desc={t('怎么算达标、连续天数与补卡')} onClick={() => setRulesOpen(true)} />
      </div>

      {editing && <HabitEditor habit={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function HabitEditor(props: { habit: Item<HabitData>; onClose: () => void }) {
  const isNew = !props.habit.id;
  const [f, setF] = useState<Item<HabitData>>({ ...props.habit });
  // 备注/名字里写了"每天 200 个"这类量词时，给一个一键填上的入口（不自动改数据，点了才填）
  const fromNote = (() => {
    if (Number(f.dailyMin) > 0) return null;
    const m = (String(f.note || '') + ' ' + String(f.name || '')).match(/每天\s*(\d+)\s*([个页次杯分钟公里题遍张])?/);
    if (!m) return null;
    const n = Number(m[1]);
    if (!(n > 0) || n > 100000) return null;
    return { n, unit: m[2] || '' };
  })();
  const set = (p: Partial<HabitData>) => setF((prev) => ({ ...prev, ...p }));
  // 提醒时间点：本地草稿，保存时统一整理写回去
  const [draft, setDraft] = useState('07:00');
  const [timesOn, setTimesOn] = useState(cfg.habitTimes !== false);
  const times = normTimes(f.remindTimes);
  const addTime = (raw: string) => {
    const v = normTimes([raw])[0];
    if (!v) { toast(t('时间格式不对'), 'err'); return; }
    if (times.indexOf(v) >= 0) { toast(t('这个时间点已经有了'), 'info'); return; }
    // 用函数式更新：手指连着点两个快捷档时，第二次不能拿上一次渲染前的旧列表覆盖掉刚加的那个
    setF((prev) => {
      const cur = normTimes(prev.remindTimes);
      if (cur.indexOf(v) >= 0) return prev;
      return { ...prev, remindTimes: normTimes(cur.concat([v])) };
    });
  };

  const save = () => {
    if (!f.name.trim()) { toast(t('请填写习惯名称'), 'err'); return; }
    const remindTimes = normTimes(f.remindTimes);
    putRecord<HabitData>('habits', isNew ? newId() : f.id, { ...f, name: f.name.trim(), remindTimes });
    // 改了提醒时间点要立刻重排系统通知，否则得等下次打开应用才生效
    rescheduleNativeReminders(600);
    toast(isNew ? t('已创建习惯') : t('已保存'), 'ok');
    props.onClose();
  };

  return (
    <Modal title={isNew ? t('新建习惯') : t('编辑习惯')} onClose={props.onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={props.onClose}>{t('取消')}</button>
        <button className="btn btn-primary" onClick={save}>{isNew ? t('创建') : t('保存')}</button>
      </>}>
      <div className="form-grid">
        <Field label={t('习惯名称 *')} full>
          <input className="input" autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={t('例如：早起 7:00 / 背单词 / 健身 30 分钟')} />
        </Field>
        <Field label={t('图标')} full>
          <div className="row-wrap">
            {HABIT_ICONS.map((i) => (
              <button key={i} className={'chip ' + (f.icon === i ? 'on' : '')} style={{ fontSize: 16 }} onClick={() => set({ icon: i })}>{i}</button>
            ))}
          </div>
        </Field>
        <Field label={t('颜色')} full>
          <div className="row-wrap">
            {COURSE_PALETTE.map((c) => (
              <button key={c} onClick={() => set({ color: c })}
                style={{ width: 26, height: 26, borderRadius: 8, background: c, border: f.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
            ))}
          </div>
        </Field>
        <Field label={t('每日最低完成量')} hint={t('填了就按「今天做了多少」记，达到这个量才算达标；留空或 0 表示不设量，做了就算')}>
          <input className="input" type="number" min={0} value={Number(f.dailyMin) || 0}
            onChange={(e) => set({ dailyMin: Math.max(0, Number(e.target.value) || 0) })} placeholder={t('例如：20')} />
          {/* 很多人把量写在备注里（"每天 200 个"）。认出来点一下就填上，别让人再敲一遍 */}
          {fromNote && (
            <button className="chip chip-hint mt8" style={{ alignSelf: 'flex-start' }}
              onClick={() => set({ dailyMin: fromNote.n, unit: fromNote.unit || f.unit })}>
              {t('备注里写着「每天 {n}{unit}」，点一下填进去', { n: fromNote.n, unit: fromNote.unit })}
            </button>
          )}
        </Field>
        <Field label={t('单位')} hint={t('个 / 页 / 分钟 / 公里…')}>
          <input className="input" value={f.unit || ''} onChange={(e) => set({ unit: e.target.value })} placeholder={t('例如：个')} />
        </Field>
        <Field label={t('每日提醒')} full
          hint={t('到点各弹一条通知（横幅 + 声音 + 震动），不是静默通知；想设几个设几个，早上中午晚上都行')}>
          <div className="row-wrap">
            {times.length === 0 && <span className="muted">{t('还没设时间点，下面点一个，或者自己拨一个')}</span>}
            {times.map((tm) => (
              <button key={tm} className="chip on" title={t('点一下删掉这个时间点')}
                onClick={() => setF((prev) => ({ ...prev, remindTimes: normTimes(prev.remindTimes).filter((x) => x !== tm) }))}>
                🔔 {tm} <span style={{ opacity: 0.72, marginLeft: 2 }}>✕</span>
              </button>
            ))}
          </div>
          <div className="row-wrap mt8">
            {REMIND_SUGGEST.map((s) => (
              <button key={s.at} className="chip" disabled={times.indexOf(s.at) >= 0}
                onClick={() => addTime(s.at)}>{t(s.label)} {s.at}</button>
            ))}
          </div>
          <div className="row mt8" style={{ gap: 8 }}>
            <input className="input" type="time" value={draft} style={{ width: 132 }}
              onChange={(e) => setDraft(e.target.value)} />
            <button className="btn btn-sm" onClick={() => addTime(draft)}>{t('添加这个时间点')}</button>
          </div>
          {times.length > 0 && !timesOn && (
            <div className="muted mt8" style={{ fontSize: 11.5 }}>
              {t('「按时间点提醒」总开关现在是关着的，这些时间点不会响。')}
              <button className="chip ml8" onClick={() => {
                void saveConfig({ habitTimes: true });
                setTimesOn(true);
                rescheduleNativeReminders(400);
              }}>{t('打开')}</button>
            </div>
          )}
        </Field>
        <Field label={t('备注')} full>
          <textarea className="textarea" value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder={t('想坚持它的理由…')} />
        </Field>
      </div>
      <label className="row mt12" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={f.paused} onChange={(e) => set({ paused: e.target.checked })} />
        <span>{t('暂停这个习惯（暂停后不计入今日待打卡，历史记录保留）')}</span>
      </label>
    </Modal>
  );
}
