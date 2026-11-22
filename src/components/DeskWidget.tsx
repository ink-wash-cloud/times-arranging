import React, { useEffect, useMemo, useRef, useState } from 'react';
import { list, useDB, metaGet, metaSet } from '../lib/db';
import type { TaskData, HabitData, HabitLogData, AnniversaryData } from '../types';
import { CATEGORY_COLORS, PRIORITY_COLORS } from '../types';
import { taskBuckets, nearestAnniversary, habitStat } from '../lib/logic';
import { setTaskDone } from '../lib/actions';
import { todayStr, relativeDay, humanMinutes } from '../lib/date';
import { toast } from './ui';
import { t } from '../lib/i18n';
import { setGlowSuspended } from '../lib/pointerGlow';
import { createPortal } from 'react-dom';
import {
  currentWidgetWindow, subscribe as subscribeWidgetWindow, closeWidgetWindow,
  syncWidgetRoot, pipSupported, type WidgetWindowHandle
} from '../lib/widgetWindow';

interface Pos { x: number; y: number; }
const KEY = 'widgetPos';
const EDGE = 6;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 桌面挂件（网页 Demo 预览版）
 * 打包为桌面应用后，它会变成一个无边框、可置顶常驻桌面的独立小窗。
 *
 * 拖拽性能要点：
 *   1) 位置用 transform 而不是 left/top —— 移动只走合成器，不触发重排
 *   2) 拖拽过程中直接改 DOM，不经过 React state
 *      （原先每次 pointermove 都 setState，3 秒拖拽要跑近 900 次重渲染）
 *   3) 拖拽中给元素加 .dragging，关掉 backdrop-filter 并提升为独立合成层
 *   4) 写 DOM 用 requestAnimationFrame 合并，指针事件比屏幕刷新快时不会白写
 */
export default function DeskWidget(props: { onClose: () => void }) {
  useDB();
  const today = todayStr();
  const [pos, setPos] = useState<Pos | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // 挂件可能被弹到独立窗口（Document PiP / 弹窗）里，开关状态要跟着走
  const [win, setWin] = useState<WidgetWindowHandle | null>(currentWidgetWindow());

  const boxRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef<Pos>({ x: 16, y: 16 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const pendingRef = useRef<Pos | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    metaGet<Pos | null>(KEY, null).then((p) => {
      const init = p && Number.isFinite(p.x) ? p : { x: 16, y: Math.max(16, window.innerHeight - 300) };
      posRef.current = init;
      setPos(init);
    });
  }, []);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setGlowSuspended(false);
  }, []);

  useEffect(() => subscribeWidgetWindow(() => setWin(currentWidgetWindow())), []);

  // 外观是挂在根元素上的（data-theme / 内联 CSS 变量），换肤后要同步到挂件窗口。
  // 依赖故意留空：同步很便宜，每次渲染顺带做一次最省心。
  useEffect(() => { syncWidgetRoot(win?.win); });

  const tasks = list<TaskData>('tasks');
  const b = useMemo(() => taskBuckets(tasks, today), [tasks, today]);
  const ann = useMemo(() => nearestAnniversary(list<AnniversaryData>('anniversaries'), today), [today]);
  const habits = list<HabitData>('habits').filter((h) => !h.paused);
  const logs = list<HabitLogData>('habitLogs');
  const habitDone = habits.filter((h) => habitStat(h.id, logs, today, Number(h.dailyMin) || 0).checkedToday).length;
  const show = b.overdue.concat(b.today).slice(0, 6);

  /** 只改 transform，不碰布局；同时更新实时位置，
   *  这样拖拽途中即使因为数据变化触发重渲染，读到的也是当前位置而不是旧值 */
  const paint = (p: Pos) => {
    const prev = posRef.current;
    if (prev.x === p.x && prev.y === p.y) return;   // 位置没变就别碰样式
    posRef.current = p;
    const el = boxRef.current;
    if (el) el.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)';
  };

  const onDown = (e: React.PointerEvent) => {
    const el = boxRef.current;
    if (!el) return;
    // 合成事件没有真实指针，setPointerCapture 会抛错，包一层保证拖拽逻辑不受影响
    try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* 忽略 */ }
    dragRef.current = { dx: e.clientX - posRef.current.x, dy: e.clientY - posRef.current.y };
    el.classList.add('dragging');
    setGlowSuspended(true);      // 拖拽期间不更新悬停晕光
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const el = boxRef.current;
    if (!el) return;
    const w = el.offsetWidth || 320;
    const h = el.offsetHeight || 260;
    pendingRef.current = {
      x: clamp(e.clientX - d.dx, EDGE, Math.max(EDGE, window.innerWidth - w - EDGE)),
      y: clamp(e.clientY - d.dy, EDGE, Math.max(EDGE, window.innerHeight - h - EDGE))
    };
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const p = pendingRef.current;
        if (p) paint(p);
      });
    }
  };

  const onUp = () => {
    if (!dragRef.current) return;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    boxRef.current?.classList.remove('dragging');
    setGlowSuspended(false);
    dragRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (p) {
      paint(p);
      setPos(p);              // 落一次 state，之后由它接管渲染
      metaSet(KEY, p);        // 只有松手时才落库
    }
  };

  if (!pos) return null;

  const inWindow = !!win;
  const close = () => {
    if (inWindow) closeWidgetWindow();
    props.onClose();
  };

  const ui = (
    <div
      ref={boxRef}
      className={'glass widget' + (inWindow ? ' widget-docked' : '')}
      /* 用 posRef（实时值）而非 pos（state），避免拖拽中的重渲染把位置打回去。
         独立窗口里位置由系统/用户拖窗口决定，不能再套一层 transform。 */
      style={inWindow ? undefined : { transform: 'translate3d(' + posRef.current.x + 'px,' + posRef.current.y + 'px,0)', width: 320 }}
    >
      <div
        className="wg-head"
        /* 独立窗口里拖拽标题栏没有意义（窗口位置由系统管），索性不挂手势 */
        onPointerDown={inWindow ? undefined : onDown}
        onPointerMove={inWindow ? undefined : onMove}
        onPointerUp={inWindow ? undefined : onUp}
        onPointerCancel={inWindow ? undefined : onUp}
      >
        {!inWindow && <span className="wg-grip">⠿</span>}
        <b>{t('今日任务')}</b>
        <span className="spacer" />
        <button className="wg-btn" onClick={() => setCollapsed((v) => !v)} title={collapsed ? t('展开') : t('收起')}>
          {collapsed ? '▢' : '—'}
        </button>
        <button className="wg-btn" onClick={close} title={inWindow ? t('关闭挂件窗口') : t('关闭挂件')}>✕</button>
      </div>

      {!collapsed && (
        <div className="wg-body">
          <div className="wg-stats">
            <span><b>{b.today.length + b.overdue.length}</b> {t('待处理')}</span>
            <span><b>{habitDone}/{habits.length}</b> {t('习惯')}</span>
            {ann && <span>🎂 <b>{ann.s.days}</b> {t('天')}</span>}
          </div>

          {show.length === 0 ? (
            <div className="wg-empty">{t('今天没有待办 🎉')}</div>
          ) : (
            <div className="wg-list">
              {show.map((task) => (
                <div key={task.id} className="wg-item" style={{ borderLeftColor: CATEGORY_COLORS[task.category] }}>
                  <button
                    className="check"
                    onClick={() => { setTaskDone(task.id, true); toast(t('已完成：{title}', { title: task.title }), 'ok'); }}
                    title={t('标记完成')}
                  >✓</button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="wg-title">{task.title}</div>
                    <div className="wg-meta">
                      <span style={{ color: PRIORITY_COLORS[task.priority], fontWeight: 600 }}>{task.priority}</span>
                      <span>{task.dueDate ? relativeDay(task.dueDate) : t('未安排')}</span>
                      {task.estimateMinutes ? <span>{humanMinutes(task.estimateMinutes)}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {b.overdue.length > 0 && (
            <div className="wg-warn">⚠️ {t('有 {n} 条已逾期', { n: b.overdue.length })}</div>
          )}
          <div className="wg-hint">
            {inWindow
              ? (win?.mode === 'pip'
                ? t('已置顶常驻桌面 · 拖窗口边缘可调整大小')
                : t('独立窗口 · 当前浏览器不保证置顶'))
              : (pipSupported()
                ? t('拖拽标题栏可移动 · 点顶栏「桌面挂件」弹出为置顶小窗')
                : t('拖拽标题栏可移动 · 当前浏览器不支持桌面小窗'))}
          </div>
        </div>
      )}
    </div>
  );

  // 弹到独立窗口时，用 portal 把同一棵 React 树渲染到那个窗口的 body 里
  return win ? createPortal(ui, win.win.document.body) : ui;
}
