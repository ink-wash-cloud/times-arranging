// 日程表：精确到秒的一天视图。数据全部走本地 IndexedDB，服务端只负责同步。
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { askConfirm, Field, Modal, Tag, toast } from '../components/ui';
import type { CourseChangeData, CourseData, ScheduleBlockData } from '../types';
import { CATEGORIES, CATEGORY_COLORS, COURSE_PALETTE } from '../types';
import { addDays, fmtCN, todayStr } from '../lib/date';
import { cfg, list, newId, patchRecord, putRecord, removeRecord, useDB, withoutId, type Item } from '../lib/db';
import {
  SECONDS_PER_DAY, buildCsv, buildIcs, clampNum, courseSlotsForDate, dateRange, dayTotal,
  fmtAxis, fmtDuration, fmtHMS, layoutBlocks, parseHMS, readableInk, rgba, snapSeconds
} from '../lib/schedule';
import { t } from '../lib/i18n';
import './schedule.css';

type ZoomKey = 'day' | 'hour' | 'quarter' | 'minute' | 'second';

interface ZoomSpec {
  key: ZoomKey;
  label: string;
  pxPerHour: number;
  snap: number;
  major: number;
}

const ZOOMS: ZoomSpec[] = [
  { key: 'day', label: '1 天', pxPerHour: 48, snap: 1800, major: 7200 },
  { key: 'hour', label: '1 小时', pxPerHour: 110, snap: 900, major: 3600 },
  { key: 'quarter', label: '15 分', pxPerHour: 440, snap: 900, major: 900 },
  { key: 'minute', label: '1 分', pxPerHour: 2160, snap: 60, major: 60 },
  { key: 'second', label: '1 秒', pxPerHour: 108000, snap: 1, major: 5 }
];

const PALETTE = COURSE_PALETTE;

function zoomOf(key: ZoomKey): ZoomSpec {
  return ZOOMS.find((z) => z.key === key) || ZOOMS[1];
}

function nowSeconds(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/**
 * 红色当前时间线。独立组件、独立 state：每秒只重渲染这一条线，
 * 不会把整张日程表（块/刻度/浮框）跟着重渲染。
 * 计时对齐到整秒边界；页面隐藏时停表，回到前台立刻补一次。
 */
function NowMarker({ pxPerSec }: { pxPerSec: number }) {
  const [now, setNow] = useState(nowSeconds);

  useEffect(() => {
    let timer = 0;
    let stopped = false;
    const clear = () => {
      if (timer) { window.clearTimeout(timer); timer = 0; }
    };
    const schedule = () => {
      clear();
      if (stopped) return;
      // +4ms 给 setTimeout 的调度抖动留余量，保证落在下一整秒之后
      const delay = 1000 - (Date.now() % 1000) + 4;
      timer = window.setTimeout(() => {
        timer = 0;
        if (stopped) return;
        // 页面不可见时不重排下一次计时，交给 visibilitychange 回到前台时立即补一次。
        if (document.visibilityState !== 'visible') return;
        setNow(nowSeconds());
        schedule();
      }, delay);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setNow(nowSeconds());
        schedule();
      } else {
        clear();
      }
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="sch-now" data-k="sch-now" style={{ top: now * pxPerSec }}>
      <span className="sch-now-dot" />
      <span className="sch-now-label">{fmtHMS(now)}</span>
    </div>
  );
}

function readOverlay(): boolean {
  try {
    return localStorage.getItem('schedule.overlay') !== '0';
  } catch {
    return true;
  }
}

interface EditorState {
  id?: string;
  date: string;
  title: string;
  startText: string;
  endText: string;
  color: string;
  category: string;
  note: string;
  done: boolean;
  createdAt: number;
}

interface DragState {
  id: string;
  edge: 'start' | 'end';
  origStart: number;
  origEnd: number;
  start: number;
  end: number;
  step: number;
  pxPerSec: number;
  startY: number;
}

interface BubbleState {
  x: number;
  y: number;
  text: string;
}

export default function Schedule() {
  useDB();
  const [date, setDate] = useState(todayStr);
  const [zoom, setZoom] = useState<ZoomKey>('hour');
  const [overlay, setOverlay] = useState(readOverlay);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailPos, setDetailPos] = useState<{ left: number; top: number } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportDays, setExportDays] = useState(1);
  const [dragPreview, setDragPreview] = useState<{ id: string; start: number; end: number } | null>(null);
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 650 });
  const [mobileDetail, setMobileDetail] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 720);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const blankRef = useRef<{ x: number; y: number; sec: number } | null>(null);
  const scrollKeyRef = useRef('');
  // 换缩放档时要守住的时间点（当天第几秒，= 视口顶部那一行）。见 changeZoom / 下面的 effect
  const anchorSecRef = useRef<number | null>(null);

  const z = zoomOf(zoom);
  const pxPerSec = z.pxPerHour / 3600;
  const totalH = SECONDS_PER_DAY * pxPerSec;

  const allBlocks = list<ScheduleBlockData>('schedule');
  const dayBlocks = useMemo(
    () => allBlocks.filter((b) => b.date === date).sort((a, b) => a.start - b.start || a.createdAt - b.createdAt),
    [allBlocks, date]
  );
  const courses = list<CourseData>('courses');
  const changes = list<CourseChangeData>('courseChanges');
  const overlaySlots = useMemo(
    () => (overlay ? courseSlotsForDate(courses, changes, date, cfg.termStart || '') : []),
    [overlay, courses, changes, date]
  );
  const placed = useMemo(() => layoutBlocks(dayBlocks), [dayBlocks]);
  const total = dayTotal(dayBlocks, date);
  const selected = selectedId ? dayBlocks.find((b) => b.id === selectedId) || null : null;
  const isToday = date === todayStr();

  const visibleTicks = useMemo(() => {
    const from = Math.max(0, viewport.top - 120);
    const to = viewport.top + viewport.height + 120;
    const out: number[] = [];
    for (let s = 0; s <= SECONDS_PER_DAY; s += z.major) {
      const y = s * pxPerSec;
      if (y >= from && y <= to) out.push(s);
    }
    return out;
  }, [viewport, z.major, pxPerSec]);

  const editorStart = editor ? parseHMS(editor.startText) : null;
  const editorEnd = editor ? parseHMS(editor.endText) : null;
  const editorDuration = editorStart !== null && editorEnd !== null && editorEnd > editorStart ? editorEnd - editorStart : 0;

  const syncViewport = () => {
    const el = scrollRef.current;
    if (!el) return;
    setViewport({ top: el.scrollTop, height: el.clientHeight || 650 });
  };

  useEffect(() => {
    syncViewport();
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncViewport();
        setSelectedId(null);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const onResize = () => {
      syncViewport();
      setMobileDetail(window.innerWidth <= 720);
    };
    window.addEventListener('resize', onResize);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // 进入页面 / 换日期：把视口带到有内容的地方（今天带到当前时间附近）。
  // 换缩放档不走这里 —— 那条路要守住"当前看到的那个时间点"，见 changeZoom。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (scrollKeyRef.current === date) return;
    const raf = requestAnimationFrame(() => {
      const targetSec = zoom === 'day' ? 0 : (date === todayStr() ? Math.max(0, nowSeconds() - 1800) : 7 * 3600);
      const target = Math.max(0, targetSec * pxPerSec - 16);
      el.scrollTop = Math.min(target, Math.max(0, el.scrollHeight - el.clientHeight));
      scrollKeyRef.current = date;
      syncViewport();
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // 换缩放档：把视口顶部的时间点原样搬到新精度上（1 天 → 1 秒都停在同一个时刻）。
  // 用 rAF 等新的画布高度生效后再设 scrollTop，否则会按旧高度夹取。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sec = anchorSecRef.current;
    if (sec === null) return;
    anchorSecRef.current = null;
    const raf = requestAnimationFrame(() => {
      const target = Math.min(sec * pxPerSec, Math.max(0, el.scrollHeight - el.clientHeight));
      el.scrollTop = Math.max(0, target);
      syncViewport();
    });
    return () => cancelAnimationFrame(raf);
  }, [zoom, pxPerSec]);

  /** 切换精度：先记下"视口顶部是当天第几秒"，渲染完再按新比例放回去 */
  function changeZoom(next: ZoomKey) {
    if (next === zoom) return;
    const el = scrollRef.current;
    if (el) anchorSecRef.current = el.scrollTop / pxPerSec;
    setSelectedId(null);
    setZoom(next);
  }

  useEffect(() => {
    if (selectedId && !dayBlocks.some((b) => b.id === selectedId)) setSelectedId(null);
  }, [dayBlocks, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const onDown = (e: PointerEvent) => {
      if (detailRef.current && !detailRef.current.contains(e.target as Node)) setSelectedId(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [selectedId]);

  function persistOverlay(next: boolean) {
    setOverlay(next);
    try { localStorage.setItem('schedule.overlay', next ? '1' : '0'); } catch { /* 本地存储不可用时只在本次生效 */ }
  }

  function moveDay(delta: number) {
    setSelectedId(null);
    setDate((d) => addDays(d, delta));
  }

  function openDetail(b: Item<ScheduleBlockData>, el: HTMLElement) {
    if (mobileDetail) {
      setDetailPos(null);
    } else {
      const rect = el.getBoundingClientRect();
      const width = 344;
      const height = 352;
      let left = rect.right + 12;
      if (left + width > window.innerWidth - 8) left = rect.left - width - 12;
      if (left < 8) left = 8;
      let top = rect.top;
      if (top + height > window.innerHeight - 12) top = window.innerHeight - height - 12;
      if (top < 72) top = 72;
      setDetailPos({ left, top });
    }
    setSelectedId(b.id);
  }

  function openEditor(b?: Item<ScheduleBlockData>) {
    setSelectedId(null);
    if (b) {
      setEditor({
        id: b.id, date: b.date, title: b.title || '', startText: fmtHMS(b.start), endText: fmtHMS(b.end),
        color: b.color || PALETTE[0], category: b.category || '', note: b.note || '', done: !!b.done,
        createdAt: b.createdAt || Date.now()
      });
    } else {
      setEditor({
        date, title: '', startText: '', endText: '', color: PALETTE[dayBlocks.length % PALETTE.length],
        category: '', note: '', done: false, createdAt: Date.now()
      });
    }
  }

  function openNewAt(startSec: number) {
    let start = clampNum(snapSeconds(startSec, z.snap), 0, SECONDS_PER_DAY - 60);
    let end = Math.min(SECONDS_PER_DAY, start + 3600);
    if (end - start < 60) {
      start = Math.max(0, end - 3600);
      end = SECONDS_PER_DAY;
    }
    setSelectedId(null);
    setEditor({
      date, title: '', startText: fmtHMS(start), endText: fmtHMS(end),
      color: PALETTE[dayBlocks.length % PALETTE.length], category: '', note: '', done: false, createdAt: Date.now()
    });
  }

  function openDefaultNew() {
    const base = isToday ? Math.floor(nowSeconds() / 900) * 900 : 9 * 3600;
    openNewAt(base);
  }

  function saveEditor() {
    if (!editor) return;
    const start = parseHMS(editor.startText);
    const end = parseHMS(editor.endText);
    if (start === null || end === null) {
      toast(t('时间格式不对，请用「时:分:秒」'), 'err');
      return;
    }
    if (start >= SECONDS_PER_DAY) {
      toast(t('开始时间要在 24:00 之前'), 'err');
      return;
    }
    if (end > SECONDS_PER_DAY) {
      toast(t('结束时间不能超过 24:00'), 'err');
      return;
    }
    if (end <= start) {
      toast(t('结束时间要晚于开始时间'), 'err');
      return;
    }
    const title = editor.title.trim() || t('未命名日程');
    const data: ScheduleBlockData = {
      title, date: editor.date, start, end, color: editor.color,
      category: editor.category ? (editor.category as ScheduleBlockData['category']) : undefined,
      note: editor.note.trim(), done: editor.done, createdAt: editor.createdAt
    };
    if (editor.id) {
      const old = allBlocks.find((b) => b.id === editor.id);
      const snapshot = old ? withoutId(old) : null;
      patchRecord<ScheduleBlockData>('schedule', editor.id, data);
      toast(t('已保存日程'), 'ok', snapshot ? {
        label: t('撤销'),
        run: () => { putRecord<ScheduleBlockData>('schedule', editor.id as string, snapshot); toast(t('已恢复'), 'ok'); }
      } : undefined);
    } else {
      const id = newId();
      putRecord<ScheduleBlockData>('schedule', id, data);
      toast(t('已添加日程'), 'ok', {
        label: t('撤销'),
        run: () => { removeRecord('schedule', id); toast(t('已撤销'), 'ok'); }
      });
    }
    setEditor(null);
  }

  async function deleteBlock(b: Item<ScheduleBlockData>) {
    const ok = await askConfirm(t('删除这段日程？'), t('「{title}」将从这一天移除；删除后还能撤销。', { title: b.title }), {
      okText: t('删除'), danger: true
    });
    if (!ok) return;
    const snapshot = withoutId(b);
    removeRecord('schedule', b.id);
    setSelectedId(null);
    setEditor(null);
    toast(t('已删除「{title}」', { title: b.title }), 'ok', {
      label: t('撤销'),
      run: () => { putRecord<ScheduleBlockData>('schedule', b.id, snapshot); toast(t('已恢复'), 'ok'); }
    });
  }

  function toggleDone(b: Item<ScheduleBlockData>) {
    patchRecord<ScheduleBlockData>('schedule', b.id, { done: !b.done });
    toast(!b.done ? t('已标记完成') : t('已取消完成'), 'ok');
  }

  function startBlockPress(e: ReactPointerEvent<HTMLDivElement>, b: Item<ScheduleBlockData>, el: HTMLElement) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let long = false;
    const timer = window.setTimeout(() => {
      long = true;
      openEditor(b);
    }, 500);
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
        moved = true;
        cleanup();
      }
    };
    const onUp = () => {
      cleanup();
      if (!moved && !long) openDetail(b, el);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function startResize(e: ReactPointerEvent, b: Item<ScheduleBlockData>, edge: 'start' | 'end') {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(null);
    const drag: DragState = {
      id: b.id, edge, origStart: b.start, origEnd: b.end, start: b.start, end: b.end,
      step: z.snap, pxPerSec, startY: e.clientY
    };
    dragRef.current = drag;
    setDragPreview({ id: b.id, start: b.start, end: b.end });
    setBubble({ x: e.clientX, y: e.clientY, text: t('开始 {time}', { time: fmtHMS(b.start) }) });

    const onMove = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const seconds = (ev.clientY - cur.startY) / cur.pxPerSec;
      // 吸附的是「位移」，不是绝对时间：原来 10:21:30 的事件拖 30 分钟就该变成 10:51:30，
      // 不能因为对齐 15 分钟刻度反而只延长了 16 分 30 秒。
      const delta = Math.round(seconds / cur.step) * cur.step;
      if (cur.edge === 'start') {
        cur.start = clampNum(cur.origStart + delta, 0, cur.origEnd - 1);
      } else {
        cur.end = clampNum(cur.origEnd + delta, cur.origStart + 1, SECONDS_PER_DAY);
      }
      setDragPreview({ id: cur.id, start: cur.start, end: cur.end });
      setBubble({
        x: ev.clientX, y: ev.clientY,
        text: (cur.edge === 'start' ? t('开始 {time}', { time: fmtHMS(cur.start) }) : t('结束 {time}', { time: fmtHMS(cur.end) }))
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setDragPreview(null);
      setBubble(null);
      const cur = drag;
      if (cur.start === cur.origStart && cur.end === cur.origEnd) return;
      const snapshot = withoutId(b);
      patchRecord<ScheduleBlockData>('schedule', b.id, { start: cur.start, end: cur.end });
      toast(t('已调整「{title}」的时间', { title: b.title }), 'ok', {
        label: t('撤销'),
        run: () => { putRecord<ScheduleBlockData>('schedule', b.id, snapshot); toast(t('已恢复'), 'ok'); }
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onLaneDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.sch-block') || target.closest('.sch-course')) return;
    const lane = laneRef.current;
    if (!lane) return;
    const rect = lane.getBoundingClientRect();
    const y = clampNum(e.clientY - rect.top, 0, rect.height - 1);
    blankRef.current = { x: e.clientX, y: e.clientY, sec: y / pxPerSec };
  }

  function onLaneUp(e: ReactPointerEvent<HTMLDivElement>) {
    const blank = blankRef.current;
    blankRef.current = null;
    if (!blank) return;
    if (Math.hypot(e.clientX - blank.x, e.clientY - blank.y) > 6) return;
    openNewAt(blank.sec);
  }

  function download(kind: 'csv' | 'ics') {
    const dates = dateRange(date, exportDays);
    const blocks = allBlocks.filter((b) => dates.indexOf(b.date) >= 0);
    const useCourses = overlay ? dates.flatMap((d) => courseSlotsForDate(courses, changes, d, cfg.termStart || '')) : [];
    const text = kind === 'csv' ? buildCsv(blocks, useCourses, dates) : buildIcs(blocks, useCourses, dates);
    const mime = kind === 'csv' ? 'text/csv;charset=utf-8' : 'text/calendar;charset=utf-8';
    const filename = 'shili-schedule-' + date + (exportDays > 1 ? '-7d' : '') + '.' + kind;
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(t('已导出 {n} 条日程', { n: blocks.length + useCourses.length }), 'ok');
    setExportOpen(false);
  }

  const showNow = isToday;
  const overlayCount = overlaySlots.length;

  return (
    <div className="sch-page">
      <section className="card sch-toolbar">
        <div className="sch-toolbar-top">
          <div className="sch-date-nav">
            <button className="sch-icon-btn" data-k="sch-prev" aria-label={t('前一天')} onClick={() => moveDay(-1)}>‹</button>
            <div className="sch-date-label" data-k="sch-date-label">
              <strong>{fmtCN(date)}</strong>
              <span>{date} · {t('精确到秒')}</span>
            </div>
            <button className="sch-icon-btn" data-k="sch-next" aria-label={t('后一天')} onClick={() => moveDay(1)}>›</button>
            <button className={'btn btn-sm' + (isToday ? ' btn-primary' : '')} data-k="sch-today" onClick={() => { setSelectedId(null); setDate(todayStr()); }}>{t('今天')}</button>
          </div>
          <div className="sch-date-quick">
            <button className="btn btn-sm btn-ghost" data-k="sch-yesterday" onClick={() => moveDay(-1)}>{t('昨天')}</button>
            <button className="btn btn-sm btn-ghost" data-k="sch-tomorrow" onClick={() => moveDay(1)}>{t('明天')}</button>
            <span className="sch-date-field">
              <span className="sch-date-face" aria-hidden="true">{date.replace(/-/g, '/')}</span>
              <input className="sch-date-input" data-k="sch-date-input" type="date" value={date}
                aria-label={t('跳到任意日期')} onChange={(e) => { if (!e.target.value) return; setSelectedId(null); setDate(e.target.value); }} />
            </span>
            <span className="muted hide-sm">{t('可跳到任意日期，前后都能看')}</span>
          </div>
          <div className="sch-toolbar-actions">
            <label className="sch-toggle" title={t('把当天课表以虚线叠在时间轴上')}>
              <input type="checkbox" data-k="sch-overlay" checked={overlay} onChange={(e) => persistOverlay(e.target.checked)} />
              <span className="sch-toggle-track" aria-hidden="true"><span /></span>
              <span className="sch-toggle-text">{t('课表')}</span>
            </label>
            <button className="btn btn-primary btn-sm sch-export-btn" data-k="sch-export" onClick={() => { setSelectedId(null); setExportDays(1); setExportOpen(true); }}>{t('导出日程')}</button>
          </div>
        </div>
        <div className="sch-controls">
          <div className="sch-zoom" role="group" aria-label={t('缩放')}>
            {ZOOMS.map((item) => (
              <button key={item.key} data-k={'sch-zoom-' + item.key} className={zoom === item.key ? 'on' : ''}
                title={t('1 小时 = {n}px', { n: item.pxPerHour })}
                onClick={() => changeZoom(item.key)}>
                {t(item.label)}
                {item.key === 'hour' && <span className="sch-px hide-sm"> = {item.pxPerHour}px</span>}
              </button>
            ))}
          </div>
          <span className="sch-hint hide-sm">{t('缩放只改显示精度；时间本身一直精确到秒')}</span>
          <span className="sch-total" data-k="sch-total">
            <span className="sch-total-label">{t(isToday ? '今日合计 {d}' : '当日合计 {d}', { d: '' }).trim()}</span>
            <span className="sch-total-value">{fmtDuration(total)}</span>
          </span>
        </div>
        {overlay && (
          <div className="sch-legend" data-k="sch-legend">
            <span className="sch-legend-dot" />
            {t('课表叠加：当天 {n} 节课（虚线，不影响编辑）', { n: overlayCount })}
          </div>
        )}
      </section>

      <div className="sch-board card" data-zoom={zoom}>
        <div className="sch-scroll" ref={scrollRef}>
          <div className="sch-canvas" style={{ height: totalH, '--sch-hour': Math.round(pxPerSec * 3600) + 'px' } as React.CSSProperties}>
            <div className="sch-axis" aria-hidden="true">
              {visibleTicks.map((s) => (
                <span key={s} className="sch-axis-label" style={{ top: Math.max(0, s * pxPerSec - 8) }}>
                  {fmtAxis(s, zoom === 'second')}
                </span>
              ))}
            </div>
            <div className="sch-lane" ref={laneRef} data-k="sch-lane" onPointerDown={onLaneDown} onPointerUp={onLaneUp} onPointerCancel={() => { blankRef.current = null; }}>
              {visibleTicks.map((s) => (
                <div key={'line-' + s} className={'sch-gridline' + (s % 3600 === 0 ? ' hour' : '')} style={{ top: s * pxPerSec }} />
              ))}

              {overlaySlots.map((c) => {
                const h = Math.max((c.end - c.start) * pxPerSec, 18);
                return (
                  <div key={'course-' + c.id + '-' + c.start} className="sch-course" data-id={'course-' + c.id}
                    style={{ top: c.start * pxPerSec, height: h, background: rgba(c.color, 0.14), borderColor: c.color }}>
                    <div className="sch-course-name">📚 {c.name}</div>
                    {h >= 42 && <div className="sch-course-meta">{fmtHMS(c.start)} – {fmtHMS(c.end)}{c.location ? ' · ' + c.location : ''}{c.teacher ? ' · ' + c.teacher : ''}{c.week ? ' · ' + t('第 {n} 周', { n: c.week }) : ''}</div>}
                  </div>
                );
              })}

              {placed.map((p) => {
                const b = p.source;
                const live = dragPreview && dragPreview.id === b.id ? dragPreview : null;
                const start = live ? live.start : b.start;
                const end = live ? live.end : b.end;
                const h = Math.max((end - start) * pxPerSec, 34);
                const compact = h < 48;
                const base = 100 / p.cols;
                const style = {
                  top: start * pxPerSec,
                  height: h,
                  left: 'calc(' + (p.col * base) + '% + ' + (2 + p.stack * 9) + 'px)',
                  width: 'calc(' + base + '% - ' + (7 + p.stack * 9) + 'px)',
                  background: b.color || PALETTE[0],
                  color: readableInk(b.color || PALETTE[0])
                };
                return (
                  <div key={b.id} className={'sch-block' + (b.done ? ' done' : '') + (compact ? ' compact' : '')} data-id={b.id}
                    data-cols={p.cols} data-col={p.col} style={style}
                    title={b.title + ' · ' + fmtHMS(b.start) + ' – ' + fmtHMS(b.end)}
                    onPointerDown={(e) => startBlockPress(e, b, e.currentTarget)}>
                    <div className="sch-block-title">{b.done ? '✓ ' : ''}{b.title}</div>
                    <div className="sch-block-time">{fmtHMS(start)} – {fmtHMS(end)}</div>
                    {!compact && <div className="sch-block-dur">{fmtDuration(end - start)}</div>}
                    <div className="sch-handle top" data-handle="start" onPointerDown={(e) => startResize(e, b, 'start')} />
                    <div className="sch-handle bottom" data-handle="end" onPointerDown={(e) => startResize(e, b, 'end')} />
                  </div>
                );
              })}

              {showNow && <NowMarker pxPerSec={pxPerSec} />}

              {dayBlocks.length === 0 && overlaySlots.length === 0 && (
                <div className="sch-empty-tip" data-k="sch-empty">
                  <div className="sch-empty-icon">🗓</div>
                  <div>{t('这一天还没有日程')}</div>
                  <div className="muted">{t('点时间轴空白处，或点下方「加一段日程」')}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="sch-mobile-actions">
        <button className="btn btn-primary" data-k="sch-add-mobile" onClick={openDefaultNew}>{t('＋ 加一段日程')}</button>
        <button className="btn" data-k="sch-export-mobile" onClick={() => { setSelectedId(null); setExportDays(1); setExportOpen(true); }}>{t('导出')}</button>
      </div>

      {selected && (
        <div ref={detailRef} className={'sch-pop' + (mobileDetail ? ' mobile' : '')} data-k="sch-detail"
          style={!mobileDetail && detailPos ? { left: detailPos.left, top: detailPos.top } : undefined}
          role="dialog" aria-label={selected.title}>
          <div className="sch-pop-head">
            <div className="sch-pop-title">
              <span className="sch-dot" style={{ background: selected.color }} />
              <strong>{selected.title}</strong>
              {selected.category && <Tag text={t(selected.category)} color={CATEGORY_COLORS[selected.category]} />}
            </div>
            <button className="sch-pop-x" aria-label={t('关闭')} onClick={() => setSelectedId(null)}>×</button>
          </div>
          {selected.done && <div className="sch-done-note">✓ {t('已完成')}</div>}
          <div className="sch-kv">
            <div><span>{t('开始')}</span><b>{selected.date} {fmtHMS(selected.start)}</b></div>
            <div><span>{t('结束')}</span><b>{selected.date} {fmtHMS(selected.end)}</b></div>
            <div><span>{t('时长')}</span><b>{fmtDuration(selected.end - selected.start)}</b></div>
            {selected.note && <div className="note"><span>{t('备注')}</span><b>{selected.note}</b></div>}
          </div>
          <div className="sch-pop-actions">
            <button className="btn btn-primary btn-sm" data-k="sch-detail-edit" onClick={() => openEditor(selected)}>{t('编辑')}</button>
            <button className="btn btn-sm" data-k="sch-detail-done" onClick={() => toggleDone(selected)}>{selected.done ? t('取消完成') : t('完成')}</button>
            <button className="btn btn-danger btn-sm" data-k="sch-detail-del" onClick={() => { void deleteBlock(selected); }}>{t('删除')}</button>
          </div>
          <div className="sch-pop-hint">{t('长按方块可直接进入编辑')}</div>
        </div>
      )}

      {editor && (
        <Modal title={editor.id ? t('编辑日程') : t('新建日程')} onClose={() => setEditor(null)}
          footer={<>
            <button className="btn" onClick={() => setEditor(null)}>{t('取消')}</button>
            <button className="btn btn-primary" data-k="sch-edit-save" onClick={saveEditor}>{t('保存')}</button>
          </>}>
          <div className="form-grid sch-editor">
            <Field label={t('标题')} full>
              <input className="input" data-k="sch-edit-title" value={editor.title} autoFocus
                placeholder={t('例如：写需求文档')} onChange={(e) => setEditor({ ...editor, title: e.target.value })} />
            </Field>
            <Field label={t('日期')}>
              <input className="input" data-k="sch-edit-date" type="date" value={editor.date}
                onChange={(e) => setEditor({ ...editor, date: e.target.value || editor.date })} />
            </Field>
            <Field label={t('时长')} hint={t('结束减开始，落库精确到秒')}>
              <div className="sch-duration-preview" data-k="sch-edit-duration">{editorDuration > 0 ? fmtDuration(editorDuration) : '—'}</div>
            </Field>
            <Field label={t('开始（时:分:秒）')}>
              <input className="input" data-k="sch-edit-start" value={editor.startText} inputMode="numeric"
                placeholder="09:40:30" onChange={(e) => setEditor({ ...editor, startText: e.target.value })} />
            </Field>
            <Field label={t('结束（时:分:秒）')}>
              <input className="input" data-k="sch-edit-end" value={editor.endText} inputMode="numeric"
                placeholder="10:20:30" onChange={(e) => setEditor({ ...editor, endText: e.target.value })} />
            </Field>
            <Field label={t('颜色')} full>
              <div className="sch-colors" role="group" aria-label={t('颜色')}>
                {PALETTE.map((color, i) => (
                  <button key={color} type="button" className={'sch-color' + (editor.color === color ? ' on' : '')}
                    data-k={'sch-color-' + i} style={{ background: color }} aria-label={t('颜色 {n}', { n: i + 1 })}
                    onClick={() => setEditor({ ...editor, color })} />
                ))}
              </div>
            </Field>
            <Field label={t('分类')} full>
              <div className="sch-chips">
                <button type="button" className={'chip' + (!editor.category ? ' on' : '')} data-k="sch-cat-none"
                  onClick={() => setEditor({ ...editor, category: '' })}>{t('不分类')}</button>
                {CATEGORIES.map((cat) => (
                  <button key={cat} type="button" className={'chip' + (editor.category === cat ? ' on' : '')}
                    data-k={'sch-cat-' + cat} onClick={() => setEditor({ ...editor, category: cat })}>{t(cat)}</button>
                ))}
              </div>
            </Field>
            <Field label={t('备注')} full>
              <textarea className="input textarea" data-k="sch-edit-note" rows={3} value={editor.note}
                placeholder={t('可选：地点、链接、要带的东西…')} onChange={(e) => setEditor({ ...editor, note: e.target.value })} />
            </Field>
            <Field label={t('状态')} full>
              <label className="sch-check">
                <input type="checkbox" data-k="sch-edit-done" checked={editor.done}
                  onChange={(e) => setEditor({ ...editor, done: e.target.checked })} />
                {t('已完成')}
              </label>
            </Field>
          </div>
        </Modal>
      )}

      {exportOpen && (
        <Modal title={t('导出日程')} onClose={() => setExportOpen(false)}>
          <div className="sch-export">
            <Field label={t('导出范围')}>
              <div className="sch-chips">
                <button type="button" className={'chip' + (exportDays === 1 ? ' on' : '')} data-k="sch-export-1"
                  onClick={() => setExportDays(1)}>{t('这一天')}</button>
                <button type="button" className={'chip' + (exportDays === 7 ? ' on' : '')} data-k="sch-export-7"
                  onClick={() => setExportDays(7)}>{t('最近 7 天')}</button>
              </div>
            </Field>
            <p className="muted">
              {exportDays === 1
                ? t('导出 {date} 这一天；课表叠加打开时，虚线课程也会一起导出。', { date })
                : t('从 {date} 起连续 7 天；课表叠加打开时，虚线课程也会一起导出。', { date })}
            </p>
            <div className="sch-export-actions">
              <button className="btn btn-primary" data-k="sch-export-csv" onClick={() => download('csv')}>{t('导出 CSV')}</button>
              <button className="btn" data-k="sch-export-ics" onClick={() => download('ics')}>{t('导出 ICS')}</button>
            </div>
            <p className="muted">{t('CSV 给 Excel 看；ICS 可以直接导入系统日历，时间精确到秒。')}</p>
          </div>
        </Modal>
      )}

      {bubble && (
        <div className="sch-bubble" style={{ left: bubble.x + 14, top: bubble.y - 12 }}>{bubble.text}</div>
      )}
    </div>
  );
}
