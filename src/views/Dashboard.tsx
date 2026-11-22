import React, { useMemo, useState } from 'react';
import { list, useDB, cfg, saveConfig, putRecord, newId, patchRecord } from '../lib/db';
import type { TaskData, HabitData, HabitLogData, AnniversaryData, ExpenseData, BudgetData, LifeEventData, CourseData, CourseChangeData, Category } from '../types';
import { CATEGORIES, CATEGORY_COLORS } from '../types';
import { Ring, Bar, Empty, Modal, Field, toast, Tag, askConfirm } from '../components/ui';
import { useLongPressContainer } from '../lib/longPress';
import { todayStr, addDays, fmtCN, relativeDay, humanMinutes, currentMonth, daysFromToday, weekdayName } from '../lib/date';
import { taskBuckets, habitStat, nearestAnniversary, budgetStat, latestLifeEvent, coursesOnDateX, poolStat, round2 } from '../lib/logic';
import { toggleHabitCheck, addExpense, setMonthBudget, touchLifeEvent } from '../lib/actions';
import { isEmptyDB, seedDemo } from '../lib/demo';
import type { ViewKey } from '../App';
import { t } from '../lib/i18n';

/** 金额统一显示成两位小数：55.8 显示 ¥55.80，不会再冒出 55.80000000000001。 */
const money = (n: number) => '¥' + round2(n).toFixed(2);

/** 总览页可以自己挑的卡片。顺序固定，"显示 / 不显示"存在本机配置里。 */
export const DASH_CARDS: { id: string; icon: string; title: string; desc: string }[] = [
  { id: 'tasks', icon: '✅', title: '今日待办完成度', desc: '今天完成了多少、有没有逾期' },
  { id: 'habits', icon: '🔥', title: '今日习惯打卡', desc: '一键打卡，看连续天数' },
  { id: 'anniversary', icon: '🎂', title: '最近的纪念日', desc: '还有几天、准备进度' },
  { id: 'budget', icon: '💰', title: '本月预算使用', desc: '这个月花了多少、超没超' },
  { id: 'life', icon: '🕰️', title: '人生最新一次', desc: '理发、体检这类周期提醒' }
];
export const DEFAULT_DASH_CARDS = DASH_CARDS.map((c) => c.id);

export default function Dashboard(props: { onGo: (k: ViewKey) => void }) {
  useDB();
  const today = todayStr();

  const tasks = list<TaskData>('tasks');
  const habits = list<HabitData>('habits');
  const logs = list<HabitLogData>('habitLogs');
  const anns = list<AnniversaryData>('anniversaries');
  const expenses = list<ExpenseData>('expenses');
  const budgets = list<BudgetData>('budgets');
  const life = list<LifeEventData>('lifeEvents');
  const courses = list<CourseData>('courses');
  const courseChanges = list<CourseChangeData>('courseChanges');

  // false = 关着；'expense' = 记一笔；'budget' = 设置预算
  const [expenseOpen, setExpenseOpen] = useState<false | 'expense' | 'budget'>(false);
  const [quick, setQuick] = useState('');
  const [quickCat, setQuickCat] = useState<Category>('学习');
  const [lifeOpen, setLifeOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // 总览上放哪几张卡片：本机偏好（每台设备可以不一样），没设置过就是默认五张
  const cards = (cfg.dashCards && cfg.dashCards.length ? cfg.dashCards : DEFAULT_DASH_CARDS)
    .filter((id) => DASH_CARDS.some((c) => c.id === id));

  const removeCard = async (id: string) => {
    const def = DASH_CARDS.find((c) => c.id === id);
    if (!def || !cards.includes(id)) return;
    const yes = await askConfirm(t('把「{name}」从总览拿掉？', { name: t(def.title) }),
      t('只是不显示这张卡片，里面的数据一条都不会动。末尾的 + 随时能加回来。'),
      { okText: t('拿掉'), danger: true });
    if (!yes) return;
    await saveConfig({ dashCards: cards.filter((x) => x !== id) });
    toast(t('已拿掉「{name}」，末尾 + 可以加回来', { name: t(def.title) }), 'info');
  };

  const addCard = async (id: string) => {
    const def = DASH_CARDS.find((c) => c.id === id);
    if (!def || cards.includes(id)) return;
    await saveConfig({ dashCards: cards.concat([id]) });
    toast(t('已添加「{name}」', { name: t(def.title) }), 'ok');
  };

  const resetCards = async () => {
    await saveConfig({ dashCards: DEFAULT_DASH_CARDS });
    toast(t('已恢复成默认的五张卡片'), 'ok');
  };

  // 卡片上长按（手机）或右键（电脑）＝ 拿掉这张卡片
  const lp = useLongPressContainer({
    selector: '.dash-card[data-card]',
    onLongPress: (el) => { void removeCard(el.getAttribute('data-card') || ''); }
  });

  const buckets = useMemo(() => taskBuckets(tasks, today), [tasks, today]);
  const taskStat = useMemo(() => {
    const doneToday = tasks.filter((t) => t.status === '已完成' && t.completedAt && new Date(t.completedAt).toDateString() === new Date().toDateString()).length;
    const total = buckets.today.length + buckets.overdue.length + doneToday;
    return { done: doneToday, total, pct: total ? Math.round((doneToday / total) * 100) : 0 };
  }, [tasks, buckets, today]);

  const activeHabits = habits.filter((h) => !h.paused);
  const habitToday = activeHabits.filter((h) => habitStat(h.id, logs, today, Number(h.dailyMin) || 0).checkedToday).length;
  const habitPct = activeHabits.length ? Math.round((habitToday / activeHabits.length) * 100) : 0;

  const near = useMemo(() => nearestAnniversary(anns, today), [anns, today]);
  const budget = useMemo(() => budgetStat(expenses, budgets, currentMonth()), [expenses, budgets]);
  const lastLife = useMemo(() => latestLifeEvent(life), [life]);
  // 今天实际要上的课：常规课表 ± 临时调课/停课
  const todayCourses = useMemo(
    () => coursesOnDateX(courses, courseChanges, today, cfg.termStart),
    [courses, courseChanges, today, cfg.termStart]
  );
  const pool = useMemo(() => poolStat(tasks), [tasks]);

  if (isEmptyDB()) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '44px 20px' }}>
        <div style={{ fontSize: 44 }}>🌤️</div>
        <h2 style={{ margin: '10px 0 6px' }}>{t('欢迎使用时序')}</h2>
        <div className="muted" style={{ maxWidth: 460, margin: '0 auto 18px' }}>
          {t('这里还没有任何数据。你可以先载入一份示例数据感受一下，也可以直接点右上角开始创建自己的第一条待办。')}
        </div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => { seedDemo(); toast(t('示例数据已载入'), 'ok'); }}>{t('载入示例数据')}</button>
          <button className="btn" onClick={() => props.onGo('tasks')}>{t('直接开始')}</button>
        </div>
      </div>
    );
  }

  const quickAdd = () => {
    const title = quick.trim();
    if (!title) return;
    putRecord<TaskData>('tasks', newId(), {
      title, category: quickCat, dueDate: today, dueTime: null, priority: 'P2', status: '未开始',
      estimateMinutes: 30, repeat: '不重复', note: '', anniversaryId: null, completedAt: null, createdAt: Date.now()
    });
    setQuick('');
    toast(t('已加入今日待办'), 'ok');
  };

  return (
    <>
      {/* 卡片可以自己挑：卡片上长按（电脑上右键）能拿掉，末尾的 + 再加回来 */}
      <div className="dash-grid" {...lp.handlers}>
        {cards.length === 0 && (
          <div className="muted" style={{ gridColumn: '1 / -1', padding: '2px 2px 0' }}>
            {t('卡片都收起来了 —— 滑到页面最下面，点「＋ 添加卡片」挑几张放回来。')}
          </div>
        )}
        {/* ① 待办完成度 */}
        {cards.includes('tasks') && (
        <div className="card dash-card" data-card="tasks">
          <div className="card-h"><span className="ico">✅</span><h3>{t('今日待办完成度')}</h3></div>
          <div className="row" style={{ gap: 16 }}>
            <Ring value={taskStat.pct} size={92} color="#6d8bff" color2="#a06bff">
              <b>{taskStat.pct}<span style={{ fontSize: 14 }}>%</span></b>
              <small>{t('完成率')}</small>
            </Ring>
            <div>
              <div className="dash-big">{taskStat.done}<small>{t('/ {n} 项', { n: taskStat.total })}</small></div>
              <div className="muted" style={{ marginTop: 6 }}>
                {t('今日 {a} 项 · 未来 7 天 {b} 项', { a: buckets.today.length, b: buckets.next7.length })}
              </div>
              {buckets.overdue.length > 0 && (
                <div style={{ marginTop: 6 }}><Tag text={t('已逾期 {n} 项', { n: buckets.overdue.length })} color="#ff5a6a" /></div>
              )}
            </div>
          </div>
          <div className="dash-foot">
            <button className="link-btn" onClick={() => props.onGo('tasks')}>{t('去看待办 →')}</button>
          </div>
        </div>
        )}

        {/* ② 习惯打卡 */}
        {cards.includes('habits') && (
        <div className="card dash-card" data-card="habits">
          <div className="card-h"><span className="ico">🔥</span><h3>{t('今日习惯打卡')}</h3></div>
          <div className="row" style={{ gap: 16 }}>
            <Ring value={habitPct} size={92} color="#22c55e" color2="#84cc16">
              <b>{habitToday}<span style={{ fontSize: 14 }}>/{activeHabits.length}</span></b>
              <small>{t('已打卡')}</small>
            </Ring>
            <div style={{ flex: 1, minWidth: 0 }}>
              {activeHabits.length === 0 && <div className="muted">{t('还没有进行中的习惯')}</div>}
              <div className="habit-mini">
                {activeHabits.slice(0, 4).map((h) => {
                  const st = habitStat(h.id, logs, today, Number(h.dailyMin) || 0);
                  return (
                    <button
                      key={h.id}
                      className={'habit-mini-row' + (st.checkedToday ? ' on' : '')}
                      onClick={() => {
                        const ok = toggleHabitCheck(h.id, today);
                        toast(ok ? t('{name} 打卡成功，连续 {n} 天', { name: h.name, n: st.streak + 1 }) : t('已取消打卡'), ok ? 'ok' : 'info');
                      }}
                    >
                      <span className="dot">{st.checkedToday ? '✓' : ''}</span>
                      <span className="nm">{h.name}</span>
                      <span className="st">{t('{n} 天', { n: st.streak })}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="dash-foot">
            <button className="link-btn" onClick={() => props.onGo('habits')}>{t('管理习惯 →')}</button>
          </div>
        </div>
        )}

        {/* ③ 最近纪念日倒计时 */}
        {cards.includes('anniversary') && (
        <div className="card dash-card hero" data-card="anniversary">
          <div className="card-h"><span className="ico">🎂</span><h3>{t('最近的纪念日')}</h3></div>
          {near ? (
            <>
              <div className="hero-title">{near.a.icon} {near.a.title}</div>
              <div className="hero-days" style={{ marginTop: 6 }}>
                {t('距离还有 {n}', { n: near.s.days })}<small> {t('天')}</small>
              </div>
              <div className="muted" style={{ marginBottom: 8 }}>{t('{date} · 准备进度 {p}%', { date: fmtCN(near.s.next), p: near.s.progress })}</div>
              <Bar value={near.s.progress} />
            </>
          ) : (
            <Empty icon="🎈" text={t('还没有添加重要日期')} hint={t('生日、纪念日、节日都可以')} />
          )}
          <div className="dash-foot">
            <button className="link-btn" onClick={() => props.onGo('dates')}>{t('查看全部 →')}</button>
          </div>
        </div>
        )}

        {/* ④ 本月预算使用 */}
        {cards.includes('budget') && (
        <div className="card dash-card" data-card="budget">
          <div className="card-h"><span className="ico">💰</span><h3>{t('本月预算使用')}</h3></div>
          <div className="dash-big">
            {money(budget.spent)}
            <small>/ {budget.amount > 0 ? money(budget.amount) : t('未设置')}</small>
          </div>
          <div style={{ margin: '10px 0 6px' }}>
            <Bar value={budget.pct} tone={budget.pct > 100 ? 'bad' : budget.pct > budget.expectedPct + 10 ? 'warn' : 'good'} />
          </div>
          <div className="muted">
            {t('已用 {p}% · 时间进度 {e}%', { p: budget.pct, e: budget.expectedPct })}
            {budget.amount > 0 && (budget.remaining >= 0
              ? ' · ' + t('剩余') + ' ' + money(budget.remaining)
              : ' · ' + t('超支') + ' ' + money(Math.abs(budget.remaining)))}
          </div>
          <div className="dash-foot row" style={{ gap: 14 }}>
            <button className="link-btn" onClick={() => setExpenseOpen('expense')}>{t('记一笔')}</button>
            {/* 以前这里跳的是"设置"页，而设置页里根本没有预算入口，等于点了个死路。
                应用里本来就有一个带"本月总预算"的弹窗，直接开它，并聚焦到预算那一栏。 */}
            <button className="link-btn muted-link" onClick={() => setExpenseOpen('budget')}>
              {budget.amount > 0 ? t('改预算') : t('设置预算')}
            </button>
            <button className="link-btn muted-link" onClick={() => props.onGo('expenses')}>{t('全部记录 →')}</button>
          </div>
        </div>
        )}

        {/* ⑤ 人生最新一次 */}
        {cards.includes('life') && (
        <div className="card dash-card" data-card="life">
          <div className="card-h"><span className="ico">🕰️</span><h3>{t('人生最新一次')}</h3></div>
          {lastLife ? (
            <>
              <div className="hero-title">{lastLife.event.icon} {lastLife.event.title}</div>
              <div className="dash-big" style={{ marginTop: 6 }}>
                {t('已 {n}', { n: lastLife.days })}<small> {t('天')}</small>
              </div>
              {lastLife.event.cycleDays > 0 && (
                <>
                  <div style={{ margin: '10px 0 6px' }}>
                    <Bar value={lastLife.ratio} tone={lastLife.overdue ? 'bad' : lastLife.ratio > 70 ? 'warn' : 'good'} thin />
                  </div>
                  <div className="muted">
                    {lastLife.overdue
                      ? t('建议周期 {n} 天，该安排了', { n: lastLife.event.cycleDays })
                      : t('建议周期 {n} 天', { n: lastLife.event.cycleDays })}
                  </div>
                </>
              )}
              <div className="dash-foot row" style={{ gap: 14 }}>
                <button className="link-btn" onClick={() => { touchLifeEvent(lastLife.event.id, today); toast(t('已记录为今天'), 'ok'); }}>
                  {t('今天做了')}
                </button>
                <button className="link-btn muted-link" onClick={() => setLifeOpen(true)}>{t('全部记录')}</button>
              </div>
            </>
          ) : (
            <Empty icon="🕰️" text={t('还没有记录')} hint={t('比如「理发」「体检」「给家里打电话」')} />
          )}
        </div>
        )}

      </div>

      {/* 快速添加 + 时间池 */}
      <div className="mt16 two-col">
        <div className="card">
          <div className="card-h">
            <span className="ico">⚡</span><h3>{t('快速添加今日待办')}</h3>
            <div className="right">
              <div className="row chip-row" data-slide style={{ gap: 4 }}>
                {CATEGORIES.map((c) => (
                  <button key={c} className={'chip ' + (quickCat === c ? 'on' : '')} onClick={() => setQuickCat(c)}>{c}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder={t('要做点什么？回车即可加入今天')}
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') quickAdd(); }}
            />
            <button className="btn btn-primary" onClick={quickAdd}>{t('添加')}</button>
          </div>
          <div className="mt12">
            <div className="card-h" style={{ marginBottom: 8 }}><span className="ico">📌</span><h3>{t('今日待办')}</h3></div>
            {buckets.today.length === 0 ? <div className="muted">{t('今天还没有安排待办')}</div> : (
              <div className="pool">
                {buckets.today.slice(0, 6).map((t) => (
                  <div key={t.id} className="pool-item">
                    <span className="dot" style={{ background: CATEGORY_COLORS[t.category] || '#888', width: 8, height: 8, borderRadius: 4, flex: '0 0 8px' }} />
                    <span className="pool-title">{t.title}</span>
                    <span className="muted" style={{ flex: '0 0 auto' }}>{humanMinutes(t.estimateMinutes)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <span className="ico">⏳</span><h3>{t('待办时间池')}</h3>
            <div className="right"><span className="muted">{t('{n} 条 · 合计 {time}', { n: pool.count, time: humanMinutes(pool.minutes) })}</span></div>
          </div>
          {pool.count === 0 ? <div className="muted">{t('时间池是空的，所有待办都已安排日期 👍')}</div> : (
            <div className="pool">
              {tasks.filter((task) => task.status !== '已完成' && !task.dueDate).slice(0, 5).map((task) => (
                <div key={task.id} className="pool-item">
                  <span className="pool-title">{task.title}</span>
                  <button className="btn btn-sm" onClick={() => { patchRecord<TaskData>('tasks', task.id, { dueDate: today }); toast(t('已安排到今天'), 'ok'); }}>{t('→今天')}</button>
                  <button className="btn btn-sm" onClick={() => { patchRecord<TaskData>('tasks', task.id, { dueDate: addDays(today, 1) }); toast(t('已安排到明天'), 'ok'); }}>{t('→明天')}</button>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm mt8" onClick={() => props.onGo('tasks')}>{t('查看全部 {n} 条 →', { n: pool.count })}</button>
            </div>
          )}
        </div>
      </div>

      {/* 今日课程 */}
      <div className="card mt16">
        <div className="card-h">
          <span className="ico">📅</span><h3>{t('今日课程')} · {weekdayName(new Date().getDay())}</h3>
          <div className="right">
            {cfg.termStart ? <span className="muted">{t('第 {n} 教学周', { n: Math.floor(daysFromToday(cfg.termStart) / 7) + 1 })}</span> : <span className="muted">{t('未设置开学日期（不做周次过滤）')}</span>}
          </div>
        </div>
        {todayCourses.length === 0 ? (
          <div className="muted">{t('今天没有课 🎉')} {courses.length === 0 && <button className="btn btn-ghost btn-sm" onClick={() => props.onGo('tt')}>{t('去导入课表')}</button>}</div>
        ) : (
          <div className="day-courses">
            {todayCourses.map((c) => (
              <div key={c.id} className="day-course" style={{ borderLeftColor: c.color }}>
                <div className="ct">{c.startTime}<br />{c.endTime}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {c.name}
                    {c.change ? <Tag text={c.change.kind === 'cancel' ? t('停课') : c.movedFrom ? t('调课') : t('已调整')} color={c.change.kind === 'cancel' ? '#e0838f' : '#dfa96f'} /> : null}
                  </div>
                  <div className="muted">
                    {[c.location, c.teacher].filter(Boolean).join(' · ') || '—'}
                    {c.movedFrom ? ' · ' + t('从 {date} 调来', { date: c.movedFrom.slice(5) }) : ''}
                    {c.change && c.change.kind === 'cancel' ? ' · ' + t('这次不上了') : ''}
                    {' · '}{t('{a}-{b} 周', { a: c.startWeek, b: c.endWeek })}{c.weekParity === 'odd' ? t('（单周）') : c.weekParity === 'even' ? t('（双周）') : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 总览最下面：挑要放哪几张卡片（放页尾，滑到底就能看到） */}
      <button type="button" className="card dash-add dash-add-bottom" onClick={() => setPickerOpen(true)} title={t('添加卡片')}>
        <span className="plus">＋</span>
        <span className="lb">{t('添加卡片')}</span>
      </button>

      {pickerOpen && (
        <Modal title={t('添加卡片')} onClose={() => setPickerOpen(false)}
          footer={<>
            {cards.length !== DEFAULT_DASH_CARDS.length && (
              <button className="btn btn-ghost" onClick={resetCards}>{t('恢复默认')}</button>
            )}
            <button className="btn btn-primary" onClick={() => setPickerOpen(false)}>{t('完成')}</button>
          </>}>
          <div className="muted mb12">
            {t('总览上的卡片可以自己挑。不想要的，在卡片上长按（电脑上右键）就能拿掉，这里随时加回来。')}
          </div>
          {DASH_CARDS.map((c) => {
            const on = cards.includes(c.id);
            return (
              <div key={c.id} className="dash-pick">
                <span className="ico">{c.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t(c.title)}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{t(c.desc)}</div>
                </div>
                {on
                  ? <Tag text={t('已添加')} color="#6fbf94" />
                  : <button className="btn btn-sm btn-primary" onClick={() => addCard(c.id)}>{t('添加')}</button>}
              </div>
            );
          })}
        </Modal>
      )}
      {expenseOpen && <ExpenseModal focus={expenseOpen} onClose={() => setExpenseOpen(false)} />}
      {lifeOpen && <LifeModal onClose={() => setLifeOpen(false)} />}
    </>
  );
}

function ExpenseModal(props: { onClose: () => void; focus?: 'expense' | 'budget' }) {
  useDB();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [cat, setCat] = useState('餐饮');
  const [date, setDate] = useState(todayStr());
  const month = currentMonth();
  const budgets = list<BudgetData>('budgets');
  const expenses = list<ExpenseData>('expenses');
  const stat = budgetStat(expenses, budgets, month);
  const [budgetInput, setBudgetInput] = useState(String(stat.amount || ''));
  // 从"设置预算"进来时，预算那一栏放最上面并自动聚焦，省得用户还要找
  const budgetFirst = props.focus === 'budget';

  const saveBudget = () => {
    setMonthBudget(month, Number(budgetInput) || 0);
    toast(Number(budgetInput) > 0 ? t('本月预算已设为 ¥{n}', { n: Number(budgetInput) }) : t('已清除本月预算'), 'ok');
  };

  const budgetField = (
    <Field label={t('本月（{month}）总预算', { month })} full
      hint={t('设置后总览页会显示使用进度与超支预警；填 0 表示不设预算')}>
      <div className="row">
        <input className="input" type="number" value={budgetInput} autoFocus={budgetFirst}
          onChange={(e) => setBudgetInput(e.target.value)} placeholder={t('例如 2500')} />
        <button className="btn" onClick={saveBudget}>{t('保存预算')}</button>
      </div>
    </Field>
  );

  const expenseFields = (
    <>
      <Field label={t('支出名称')}><input className="input" value={title} autoFocus={!budgetFirst} onChange={(e) => setTitle(e.target.value)} placeholder={t('例如：食堂、地铁')} /></Field>
      <Field label={t('金额（元）')}><input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></Field>
      <Field label={t('分类')}>
        <select className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
          {['餐饮', '交通', '学习', '生活', '娱乐', '通讯', '医疗', '其他'].map((c) => <option key={c} value={c}>{t(c)}</option>)}
        </select>
      </Field>
      <Field label={t('日期')}><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
    </>
  );

  return (
    <Modal title={budgetFirst ? t('设置本月预算') : t('记一笔支出')} onClose={props.onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={props.onClose}>{t('关闭')}</button>
        {budgetFirst ? (
          <button className="btn btn-primary" onClick={() => { saveBudget(); props.onClose(); }}>{t('保存预算')}</button>
        ) : (
          <button className="btn btn-primary" onClick={() => {
            if (!title.trim() || !Number(amount)) { toast(t('请填写名称和金额'), 'err'); return; }
            addExpense(title.trim(), Number(amount), cat, date);
            toast(t('已记录支出 ¥{n}', { n: Number(amount) }), 'ok');
            setTitle(''); setAmount('');
          }}>{t('保存支出')}</button>
        )}
      </>}>
      <div className="form-grid">
        {budgetFirst ? <>{budgetField}{expenseFields}</> : <>{expenseFields}{budgetField}</>}
      </div>
      <div className="mt12">
        <div className="stat-line"><span>{t('本月已支出')}</span><span>{money(stat.spent)}</span></div>
        <div className="stat-line"><span>{t('预算')}</span><span>{stat.amount > 0 ? money(stat.amount) : t('未设置')}</span></div>
        <div className="stat-line"><span>{t('剩余')}</span><span>{stat.amount > 0 ? money(stat.remaining) : '—'}</span></div>
      </div>
      {stat.items.length > 0 && (
        <div className="mt12">
          <div className="muted mb8">{t('最近记录（点击可删除）')}</div>
          <div className="pool">
            {stat.items.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8).map((e) => (
              <div key={e.id} className="pool-item">
                <span style={{ flex: 1, fontSize: 13 }}>{e.title} <span className="muted">{e.category}</span></span>
                <span className="muted">{e.date}</span>
                <b>{money(e.amount)}</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function LifeModal(props: { onClose: () => void }) {
  useDB();
  const life = list<LifeEventData>('lifeEvents').slice().sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));
  const today = todayStr();
  return (
    <Modal title={t('人生最新一次 · 全部记录')} onClose={props.onClose}
      footer={<button className="btn btn-primary" onClick={props.onClose}>{t('完成')}</button>}>
      {life.length === 0 ? <Empty icon="🕰️" text={t('还没有记录')} /> : (
        <div className="pool">
          {life.map((l) => {
            const d = daysFromToday(l.lastDate);
            const over = l.cycleDays > 0 && d >= l.cycleDays;
            return (
              <div key={l.id} className="pool-item">
                <span style={{ fontSize: 18 }}>{l.icon}</span>
                <span style={{ flex: 1 }}>{l.title}<div className="muted">{t('上次 {date}', { date: l.lastDate })}</div></span>
                <Tag text={t('已 {n} 天', { n: d })} color={over ? '#ff5a6a' : '#22c55e'} />
                <button className="btn btn-sm" onClick={() => { touchLifeEvent(l.id, today); toast(t('已更新为今天'), 'ok'); }}>{t('今天做了')}</button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
