import React, { useEffect, useMemo, useRef, useState } from 'react';
import { list, useDB, putRecord, patchRecord, removeRecord, newId, withoutId, cfg, saveConfig } from '../lib/db';
import type { Item } from '../lib/db';
import type { CourseData, CourseChangeData } from '../types';
import { Modal, Field, toast, askConfirm, Empty, Tag } from '../components/ui';
import { SubPage } from '../components/SubPage';
import { todayStr, addDays, weekdayName, pick, timeToMinutes, startOfWeekMonday, parseYMD, pad2 } from '../lib/date';
import { coursesOnDateX, currentWeek, changeId } from '../lib/logic';
import { saveCourseChange, clearCourseChange } from '../lib/actions';
import {
  DEFAULT_PERIODS, periodsToText, parsePeriods, parseAny, parseGridCourses, readSpreadsheet,
  parseClassRowSheet
} from '../lib/timetable';
import type { ParsedCourse } from '../lib/timetable';
import { analyzeTimetable, aiReady } from '../lib/ai';
import { fileToDataURL } from '../lib/appearance';
import { rescheduleNativeReminders } from '../lib/nativeReminders';
import { t } from '../lib/i18n';

/** 把周次集合压成"5-6,8-13"这种好读的形式 */
function fmtWeeks(weeks?: number[], startWeek?: number, endWeek?: number, parity?: string): string {
  const unit = pick(' 周', ' 週', ' wks', '週');
  if (!weeks || !weeks.length) {
    const tail = parity === 'odd' ? pick('（单）', '（單）', ' (odd)', '（奇数）')
      : parity === 'even' ? pick('（双）', '（雙）', ' (even)', '（偶数）') : '';
    return (startWeek || 1) + '-' + (endWeek || 16) + unit + tail;
  }
  const out: string[] = [];
  let a = weeks[0], b = weeks[0];
  const flush = () => { out.push(a === b ? String(a) : a + '-' + b); };
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i] === b + 1) { b = weeks[i]; continue; }
    flush(); a = weeks[i]; b = weeks[i];
  }
  flush();
  return out.join(',') + unit;
}

/** 课程块上用的一行周次：1-16周单 / 1-16周双 */
function fmtWeekSpan(startWeek?: number, endWeek?: number, parity?: string): string {
  const tail = parity === 'odd' ? pick('单', '單', ' odd', '・奇数')
    : parity === 'even' ? pick('双', '雙', ' even', '・偶数') : '';
  return (startWeek || 1) + '-' + (endWeek || 16) + pick('周', '週', ' wks', '週') + tail;
}

// 纵向不再按"整点小时"切格，而是按**节次**切。学校排课是按节次的，
// 一格 = 一节大课（两节小课），这样课程才会正好占满整格，
// 而不是像以前那样跨在两条整点线之间、看着永远对不上。
// 1.5px/分钟 → 一节大课(100分钟) = 150px，方块够大看得清。
const PX_PER_MIN = 1.5;
const SLOT_GAP = 4;         // 格子之间留一点缝，看起来像"方块"而不是一张网

export default function Timetable() {
  useDB();
  const courses = list<CourseData>('courses');
  const [importOpen, setImportOpen] = useState(false);
  // 看第几周：数字 = 第 N 教学周，'all' = 不按周次过滤，null = 还没手动选过（跟着今天走）
  // 上次锁定了某一周（比如为了复习停在 12 周）就回到那一周；选的是「本周」则跟着时间走
  const [weekPick, setWeekPick] = useState<number | 'all' | null>(
    cfg.ttWeekMode === 'fixed' && cfg.ttWeek ? cfg.ttWeek : null
  );
  const [form, setForm] = useState<(Partial<CourseData> & { id?: string }) | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [weekPickOpen, setWeekPickOpen] = useState(false);
  // 第六个「课表功能开关」：长按拖动调课。和其他课表开关一样存在 Config 里，双端同步
  const dragOff = cfg.ttDrag === false;
  // 锁定只挡「改」，不挡「看」：翻周、看今日课程、点开课程详情都照常
  const locked = cfg.ttLocked;
  const lockTip = () => toast(t('课表已锁定，先到课表设置里解锁'), 'err');

  // 课表是全年段共用的：同一门课不同班的上课时间不一样，靠班级筛出自己那一张。
  // 选中的班记在本地，下次进来还是那一张。
  const [klass, setKlass] = useState(() => localStorage.getItem('ttClass') || '');
  const classOf = (c: CourseData) => (c.className || '').trim();
  const classes = useMemo(
    () => Array.from(new Set(courses.map(classOf).filter(Boolean))).sort(),
    [courses]
  );
  const shown = useMemo(
    () => (klass ? courses.filter((c) => classOf(c) === klass) : courses),
    [courses, klass]
  );
  const pickClass = (k: string) => { setKlass(k); try { localStorage.setItem('ttClass', k); } catch { /* 忽略 */ } };

  const today = todayStr();
  const week = currentWeek(cfg.termStart, today);
  // 临时调课 / 停课：只改某一天的那一次，常规课表不动
  const changes = list<CourseChangeData>('courseChanges');
  const todayList = useMemo(() => coursesOnDateX(shown, changes, today, cfg.termStart), [shown, changes, today, cfg.termStart]);
  /** 点开某一天某门课的"调整 / 编辑"面板 */
  const [sheet, setSheet] = useState<{ course: Item<CourseData>; date: string } | null>(null);
  const changeOf = (courseId: string, date: string) => changes.find((x) => x.courseId === courseId && x.date === date);
  /** 某一列（某一天）实际要显示的课：常规 ± 临时调整，调进来的也算在这一天 */
  const dayCourses = (date: string, wd: number) => {
    const out: Array<{ c: Item<CourseData>; change?: Item<CourseChangeData>; movedIn?: boolean }> = [];
    for (const c of visible) {
      if (Number(c.weekday) !== wd) continue;
      const ch = changeOf(c.id, date);
      if (ch && ch.kind === 'cancel') { out.push({ c, change: ch }); continue; }
      if (ch && ch.kind === 'move') continue;                 // 调到别的日子了
      if (ch && ch.kind === 'edit') {
        out.push({
          c: { ...c, startTime: ch.startTime || c.startTime, endTime: ch.endTime || c.endTime, location: ch.location || c.location },
          change: ch
        });
        continue;
      }
      out.push({ c });
    }
    for (const ch of changes) {
      if (ch.kind !== 'move' || ch.toDate !== date) continue;
      const c = visible.find((x) => x.id === ch.courseId);
      if (!c) continue;
      out.push({
        c: { ...c, startTime: ch.startTime || c.startTime, endTime: ch.endTime || c.endTime, location: ch.location || c.location },
        change: ch, movedIn: true
      });
    }
    return out;
  };

  // 第 1 周从「开学第一周周一」算起。没填开学日期时算不出教学周，
  // 这时也能按课程自己的周次（"5-17 周"这种）筛——导入的课表本来就带周次。
  const termMonday = cfg.termStart ? startOfWeekMonday(cfg.termStart) : '';
  const thisWeek = cfg.termStart ? (currentWeek(cfg.termStart, today) || 1) : 0;
  const showWeek: number | 'all' = weekPick === null ? (thisWeek || 'all') : weekPick;
  const anchor = useMemo(
    () => (termMonday && typeof showWeek === 'number')
      ? addDays(termMonday, (showWeek - 1) * 7)
      : startOfWeekMonday(),
    [termMonday, showWeek]
  );
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)), [anchor]);
  // 没填开学日期又指定了第几周时，日期是算不准的——那就别摆出来误导人
  const datesKnown = !!termMonday || showWeek === 'all';
  /** 现在是"固定看某一周"还是"跟着今天走"——顶部 chip 和提示条都靠它 */
  const isFixed = typeof showWeek === 'number' && cfg.ttWeekMode === 'fixed';

  /** 某一门课在不在第 w 周（w=0 表示不筛） */
  const matchWeek = (c: Item<CourseData>, w: number): boolean => {
    if (!w) return true;
    // 教务系统常给"5-6,8-13周"这种不连续周次，单靠起止周表示不了，
    // 有精确周次集合时以它为准
    if (c.weeks && c.weeks.length) return c.weeks.indexOf(w) >= 0;
    if (w < (Number(c.startWeek) || 1) || w > (Number(c.endWeek) || 16)) return false;
    if (c.weekParity === 'odd' && w % 2 === 0) return false;
    if (c.weekParity === 'even' && w % 2 === 1) return false;
    return true;
  };

  /** 这一周实际要上的课。泳道排布只看它们，不然不同周次的课会白占一条道 */
  const visible = useMemo(
    () => shown.filter((c) => matchWeek(c, typeof showWeek === 'number' ? showWeek : 0)),
    [shown, showWeek]
  );

  /** 课表里出现过的最大周次，决定"能选到第几周" */
  const maxWeek = useMemo(() => {
    const src = shown.length ? shown : courses;
    let m = 0;
    for (const c of src) {
      if (Array.isArray(c.weeks)) for (const w of c.weeks) if (w > m) m = w;
      const e = Number(c.endWeek) || 0;
      if (e > m) m = e;
    }
    return Math.max(20, Math.min(30, m));
  }, [shown, courses]);

  /**
   * 选周次。用户点过之后要"记住"：
   *   - 选的就是本周 → follow，下次打开跟着时间自动走（过一周自动变成第 N+1 周）
   *   - 选的是别的周 → fixed，下次打开直接回到这一周，不用再点
   */
  const pickWeek = (n: number) => {
    const v = Math.max(1, Math.min(maxWeek, Math.round(n)));
    setWeekPick(v);
    const fix = v !== thisWeek;
    saveConfig({ ttWeek: v, ttWeekMode: fix ? 'fixed' : 'follow', ttWeekAt: today });
    if (fix) toast(t('已固定在第 {n} 周', { n: v }), 'ok');
  };
  const stepWeek = (d: number) => pickWeek((typeof showWeek === 'number' ? showWeek : (thisWeek || 1)) + d);
  /** 解除固定：回到"跟着今天走" */
  const followToday = () => {
    setWeekPick(null);
    saveConfig({ ttWeek: thisWeek || 0, ttWeekMode: 'follow', ttWeekAt: today });
    toast(thisWeek ? t('已回到第 {n} 周，跟着日期走', { n: thisWeek }) : t('已回到跟随日期'), 'ok');
  };
  /**
   * 把选中的这一周当成"本周"重新对齐开学日期。
   * 教务系统上的周次和这里算出来的对不上时，用户不用去算日期，选个周说一句"就是这周"就行。
   */
  const calibrateTo = (n: number) => {
    const v = Math.max(1, Math.min(maxWeek, Math.round(n)));
    const start = addDays(startOfWeekMonday(today), -7 * (v - 1));
    saveConfig({ termStart: start, ttWeek: v, ttWeekMode: 'follow', ttWeekAt: today });
    setWeekPick(null);
    setWeekPickOpen(false);
    toast(t('已按「第 {n} 周」重新对齐，现在就是第 {n} 周', { n: v }), 'ok');
  };
  /** 课表设置里的「长按拖动」开关 */
  const setDragEnabled = (on: boolean) => {
    void saveConfig({ ttDrag: on });
    toast(on ? t('长按拖动已开启') : t('长按拖动已关闭，点开课程仍然可以调课'), 'ok');
  };

  // 周次条 / 班级条手机上要滑才看得全：把选中的那一项滚到中间。
  // 只动这一条的 scrollLeft，不碰整页（碰整页会把页面带跑）
  const weekRowRef = useRef<HTMLDivElement | null>(null);
  const classRowRef = useRef<HTMLDivElement | null>(null);
  const centerChip = (box: HTMLDivElement | null) => {
    if (!box) return;
    const on = box.querySelector('.chip.on') as HTMLElement | null;
    if (!on) return;
    const target = on.offsetLeft - (box.clientWidth - on.offsetWidth) / 2;
    box.scrollLeft = Math.max(0, Math.min(box.scrollWidth - box.clientWidth, target));
  };
  useEffect(() => { centerChip(weekRowRef.current); }, [showWeek, maxWeek]);
  useEffect(() => { centerChip(classRowRef.current); }, [klass, classes]);

  // 一行 = 一节小课（第 1 节、第 2 节…），左边标序号和起止时间，
  // 一门课跨几行就占几行——就是常见课表的样子
  const periods = useMemo(
    () => parsePeriods(cfg.periodsText || periodsToText(DEFAULT_PERIODS)),
    [cfg.periodsText]
  );
  const rows = useMemo(() => periods.map((p, i) => ({
    key: i,
    n: i + 1,
    start: p[0],
    end: p[1],
    startMin: timeToMinutes(p[0]),
    endMin: timeToMinutes(p[1])
  })).filter((r) => r.endMin > r.startMin), [periods]);

  /** 某个时刻落在第几节（落在课间就归到相邻的那一节） */
  const rowOf = (min: number): number => {
    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i++) if (min >= rows[i].startMin && min <= rows[i].endMin) return i;
    if (min < rows[0].startMin) return 0;
    for (let i = rows.length - 1; i >= 0; i--) if (min > rows[i].endMin) return i;
    return rows.length - 1;
  };

  const PERIOD_H = 66;                     // 每节一行的高度
  const axisH = rows.length * PERIOD_H;    // 整张表的高度

  /**
   * 泳道排布：同一天里时间重叠的课并排显示，而不是叠在一起看不清。
   * 现实里很容易遇到——同一门课不同周次、或者从不同来源重复导入，
   * 时间上就会打架。
   */
  const lanes = useMemo(() => {
    type Row = Item<CourseData>;
    const byDay = new Map<number, Row[]>();
    for (const c of visible) {
      const d = Number(c.weekday) || 1;
      const arr = byDay.get(d);
      if (arr) arr.push(c); else byDay.set(d, [c]);
    }
    const out = new Map<string, { left: number; width: number }>();
    byDay.forEach((list) => {
      const items = list.slice().sort((a, b) =>
        timeToMinutes(a.startTime) - timeToMinutes(b.startTime) ||
        timeToMinutes(b.endTime) - timeToMinutes(a.endTime));
      let i = 0;
      while (i < items.length) {
        const cluster: Array<{ c: Row; lane: number }> = [];
        const laneEnds: number[] = [];
        let clusterEnd = timeToMinutes(items[i].startTime);
        let j = i;
        while (j < items.length) {
          const s = timeToMinutes(items[j].startTime);
          if (cluster.length && s >= clusterEnd) break;
          const e = timeToMinutes(items[j].endTime);
          let lane = laneEnds.findIndex((end) => end <= s);
          if (lane < 0) { lane = laneEnds.length; laneEnds.push(e); } else { laneEnds[lane] = e; }
          if (e > clusterEnd) clusterEnd = e;
          cluster.push({ c: items[j], lane });
          j++;
        }
        // 最多分两列。真实课表里同时段三门以上的情况极少，
        // 而分成四列之后每列只剩几十像素，字全竖着排，反而没法看。
        // 多出来的并到最后一列，视觉上叠着，但至少主体是清楚的。
        const n = Math.min(2, Math.max(1, laneEnds.length));
        for (const item of cluster) {
          const lane = Math.min(item.lane, n - 1);
          out.set(item.c.id, { left: lane / n, width: 1 / n });
        }
        i = j;
      }
    });
    return out;
  }, [visible]);

  const openNew = (weekday: number, startTime: string) => {
    if (cfg.ttLocked) { lockTip(); return; }
    setForm({
      name: '', teacher: '', location: '', className: klass, weekday, startTime, endTime: addMinutes(startTime, 45),
      startWeek: 1, endWeek: 16, weekParity: 'all', color: '#4f8cff', note: ''
    });
  };

  // ---------------- 长按拖动：按住课程 420ms 进入拖动，松手落到哪一格就改到哪 ----------------
  // x0 / y0 是长按成立那一瞬间手指的位置，也就是这颗课程块所在的位置。
  // 幽灵块第一帧就必须画在这里——否则 position:fixed 还没拿到坐标时会先出现在
  // 文档流的位置（屏幕左上角），看起来像"从左上角飞下来"。
  const [drag, setDrag] = useState<{ id: string; name: string; color: string; x0: number; y0: number } | null>(null);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [weekOpen, setWeekOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    course: Item<CourseData>; fromDate: string; x: number; y: number;
    armed: boolean; timer: number; cell: HTMLElement | null;
  } | null>(null);
  const suppressClick = useRef(false);
  /** 拖动松手后浏览器还会补一个 click，落在课程/格子/整列上都可能，统一在这里挡掉 */
  const swallowClick = () => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  };
  const pointRef = useRef({ x: 0, y: 0 });

  /** 「⋯ 更多」展开时，点菜单外面就收起来；只管开关，不拦任何点击 */
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    // 键盘用户习惯按 Esc 收菜单；以前只有点别处能收。
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setMoreOpen(false); }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);
  /** 锁定状态下长按课程的提示定时器（轻点看详情不打扰，按住了再提示） */
  const lockTipTimer = useRef(0);
  const scrollRaf = useRef(0);
  const scrollerRef = useRef<HTMLElement | null>(null);

  /** 找最近的可滚动祖先：课表在 .content 里滚动，将来换容器也不用改这里 */
  const findScroller = (el: HTMLElement | null): HTMLElement | null => {
    let cur: HTMLElement | null = el;
    while (cur && cur !== document.body) {
      const st = window.getComputedStyle(cur);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && cur.scrollHeight > cur.clientHeight + 2) return cur;
      cur = cur.parentElement;
    }
    const doc = document.scrollingElement as HTMLElement | null;
    return doc && doc.scrollHeight > doc.clientHeight + 2 ? doc : null;
  };

  /** 拖到可视区上下边缘时自动滚动，否则下半天的课根本够不着 */
  const autoScrollTick = () => {
    scrollRaf.current = 0;
    const st = dragRef.current;
    const box = scrollerRef.current;
    if (!st || !st.armed || !box) return;
    const r = box.getBoundingClientRect();
    const edge = 76;
    const y = pointRef.current.y;
    let dy = 0;
    if (y < r.top + edge) dy = -Math.min(18, Math.ceil((r.top + edge - y) / 4));
    else if (y > r.bottom - edge) dy = Math.min(18, Math.ceil((y - (r.bottom - edge)) / 4));
    if (!dy) return;
    const before = box.scrollTop;
    box.scrollTop = before + dy;
    if (box.scrollTop !== before) {
      // 手指没动，但底下的格子换了：落点高亮要跟着滚
      const cell = hitCell(pointRef.current.x, pointRef.current.y);
      if (cell && cell !== st.cell) {
        if (st.cell) st.cell.classList.remove('drop-target');
        cell.classList.add('drop-target');
        st.cell = cell;
      }
    }
    scrollRaf.current = window.requestAnimationFrame(autoScrollTick);
  };
  const kickAutoScroll = () => {
    if (!scrollRaf.current) scrollRaf.current = window.requestAnimationFrame(autoScrollTick);
  };
  const stopAutoScroll = () => {
    if (scrollRaf.current) window.cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = 0;
  };

  const moveGhostTo = (x: number, y: number) => {
    const g = ghostRef.current;
    if (!g) return;
    g.style.setProperty('--gx', x + 'px');
    g.style.setProperty('--gy', y + 'px');
  };
  /** 手指下面是不是一个可落点的格子 */
  const hitCell = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el || !el.closest) return null;
    const cell = el.closest('.tt-cell') as HTMLElement | null;
    if (cell && cell.dataset.date && cell.dataset.start) return cell;
    // 落点压在另一门课上：课块和背景格子是同一列里的兄弟节点，这时候点不到格子。
    // 以前这里直接返回 null → 拖到已经有课的时段松手"什么都没发生"，也没有提示。
    // 现在按纵坐标算出它压在第几节，照旧认这一格；两门课重叠时会自动并排显示。
    const col = el.closest('.tt-col') as HTMLElement | null;
    if (!col) return null;
    const cells = col.querySelectorAll('.tt-cell');
    if (!cells.length) return null;
    const box = col.getBoundingClientRect();
    const idx = Math.max(0, Math.min(cells.length - 1, Math.floor((y - box.top) / PERIOD_H)));
    const hit = cells[idx] as HTMLElement | undefined;
    if (!hit || !hit.dataset.date || !hit.dataset.start) return null;
    return hit;
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      if (!st.armed) {
        // 长按还没成立就滑开了：当成滚动，别抢用户的手势
        if (Math.abs(e.clientX - st.x) > 12 || Math.abs(e.clientY - st.y) > 12) {
          window.clearTimeout(st.timer);
          dragRef.current = null;
        }
        return;
      }
      pointRef.current = { x: e.clientX, y: e.clientY };
      moveGhostTo(e.clientX, e.clientY);
      kickAutoScroll();
      const cell = hitCell(e.clientX, e.clientY);
      if (cell && cell !== st.cell) {
        if (st.cell) st.cell.classList.remove('drop-target');
        cell.classList.add('drop-target');
        st.cell = cell;
      }
    };
    const finish = (apply: boolean) => () => {
      // 锁定提示：手指抬起来就取消，轻点不该弹"已锁定"
      window.clearTimeout(lockTipTimer.current);
      const st = dragRef.current;
      if (!st) return;
      window.clearTimeout(st.timer);
      dragRef.current = null;
      stopAutoScroll();
      if (!st.armed) return;
      suppressClick.current = true;          // 拖完别再把操作面板弹出来
      window.setTimeout(() => { suppressClick.current = false; }, 600);
      if (st.cell) st.cell.classList.remove('drop-target');
      setDrag(null);
      const cell = st.cell;
      if (!apply || !cell || !cell.dataset.date || !cell.dataset.start) return;
      const toDate = cell.dataset.date;
      const start = cell.dataset.start;
      const dur = timeToMinutes(st.course.endTime) - timeToMinutes(st.course.startTime);
      const end = addMinutes(start, dur > 0 ? dur : 45);
      if (toDate === st.fromDate && start === st.course.startTime) return;
      if (toDate === st.fromDate) {
        saveCourseChange(st.course.id, st.fromDate, 'edit', { startTime: start, endTime: end });
        toast(t('已挪到 {time} · 只改这一次', { time: start }), 'ok');
      } else {
        saveCourseChange(st.course.id, st.fromDate, 'move', { toDate, startTime: start, endTime: end });
        toast(t('已调到 {date} {time} · 只改这一次', { date: toDate.slice(5), time: start }), 'ok');
      }
    };
    const onUp = finish(true);
    const onCancel = finish(false);
    // 拖动过程中要拦住页面滚动，touchmove 必须是非被动监听
    const stopTouch = (e: TouchEvent) => { if (dragRef.current && dragRef.current.armed) e.preventDefault(); };
    // 浏览器自带的 HTML5 拖拽（拖选中文字/图片）会直接把我们的手势 pointercancel 掉
    const stopNativeDrag = (e: Event) => { if (dragRef.current) e.preventDefault(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('touchmove', stopTouch, { passive: false });
    window.addEventListener('dragstart', stopNativeDrag, true);
    window.addEventListener('selectstart', stopNativeDrag, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('touchmove', stopTouch);
      window.removeEventListener('dragstart', stopNativeDrag, true);
      window.removeEventListener('selectstart', stopNativeDrag, true);
    };
  }, []);

  const armDrag = (course: Item<CourseData>, date: string, x: number, y: number) => {
    window.clearTimeout(lockTipTimer.current);
    if (cfg.ttLocked) {
      // 轻点只是看详情，别弹提示；按住约半秒才提示"已锁定"
      lockTipTimer.current = window.setTimeout(lockTip, 420);
      return;
    }
    if (dragOff) return;   // 课表设置里关掉了"长按拖动调课"，当普通点击处理
    window.clearTimeout(dragRef.current ? dragRef.current.timer : 0);
    const st = {
      course, fromDate: date, x, y, armed: false, timer: 0,
      cell: null as HTMLElement | null
    };
    pointRef.current = { x, y };
    scrollerRef.current = findScroller(document.querySelector('.tt') as HTMLElement | null);
    st.timer = window.setTimeout(() => {
      st.armed = true;
      setDrag({ id: course.id, name: course.name, color: course.color, x0: st.x, y0: st.y });
      const cell = hitCell(st.x, st.y);
      if (cell) {
        cell.classList.add('drop-target');
        st.cell = cell;
      }
      kickAutoScroll();
    }, 420);
    dragRef.current = st;
  };

  // 设置类页面走二级页（SubPage 自己接了返回键），不再用弹窗盖在网格上。
  // 三个开关只决定「显示哪个二级页」，网格、拖动、锁定的逻辑一行没动。
  if (settingsOpen) return <TtSettings onClose={() => setSettingsOpen(false)} dragOn={!dragOff} onDrag={setDragEnabled} />;
  if (periodOpen) return <PeriodEditor onClose={() => setPeriodOpen(false)} />;
  if (weekOpen) return <WeekCalibrate current={week || 1} onClose={() => setWeekOpen(false)} />;

  return (
    <>
      {/* tt-toolbar：这一块要压在下方的课表卡上面，否则「⋯ 更多」菜单会被课表卡盖住
          （.card 带 backdrop-filter，每张卡自己就是层叠上下文，菜单的 z-index 出不去）。 */}
      <div className="card mb12 tt-toolbar">
        {/* 顶部只留三组：左边翻周/选周，右边「导入」「课表设置」，剩下的收进「⋯ 更多」 */}
        <div className="tt-tools">
          <div className="tt-tools-left">
            <button className="btn btn-sm" onClick={() => stepWeek(-1)}>{t('← 上一周')}</button>
            <button className={'tt-week-chip' + (isFixed ? ' fixed' : '')} data-k="week-chip"
              onClick={() => setWeekPickOpen(true)} title={t('点开选周次：固定看某一周，或者跟着今天走')}>
              <span className="tt-week-n">{typeof showWeek === 'number' ? t('第 {n} 周', { n: showWeek }) : t('全部周次')}</span>
              <span className="tt-week-mode">{isFixed ? t('已固定') : (typeof showWeek === 'number' ? t('跟随今天') : t('不按周筛'))}</span>
              <span className="tt-week-caret">▾</span>
            </button>
            <button className="btn btn-sm" onClick={() => stepWeek(1)}>{t('下一周 →')}</button>
            {thisWeek > 0 && showWeek !== thisWeek && (
              <button className="btn btn-sm" onClick={() => pickWeek(thisWeek)}>{t('回到本周（第 {n} 周）', { n: thisWeek })}</button>
            )}
          </div>
          <div className="tt-tools-right">
            <button className="btn btn-primary btn-sm" onClick={() => { if (cfg.ttLocked) { lockTip(); return; } setImportOpen(true); }}>{t('⬆ 导入课表')}</button>
            <button className={'btn btn-sm tt-settings-btn' + (locked ? ' on' : '')} data-k="tt-settings"
              onClick={() => setSettingsOpen(true)}>
              {locked ? t('🔒 课表设置') : t('⚙ 课表设置')}
            </button>
            {/* 菜单常驻 DOM（只是隐藏，不卸载），自动化测试仍能找到这些入口 */}
            <div ref={moreRef} style={{ position: 'relative' }}>
              <button className="btn btn-sm" aria-haspopup="menu" aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}>{t('⋯ 更多')}</button>
              <div className="tt-more-menu" role="menu" style={moreOpen ? undefined : { display: 'none' }}>
                <button className="tt-more-item" role="menuitem"
                  onClick={() => { setMoreOpen(false); openNew(1, '08:00'); }}>{t('＋ 手动添加课程')}</button>
                <button className="tt-more-item" role="menuitem"
                  onClick={() => { setMoreOpen(false); setWeekOpen(true); }}>{t('校正周次')}</button>
                <button className="tt-more-item" role="menuitem"
                  onClick={() => { setMoreOpen(false); setPeriodOpen(true); }}>{t('节次时间')}</button>
                {courses.length > 0 && (
                  <button className="tt-more-item danger" role="menuitem"
                    onClick={async () => {
                      setMoreOpen(false);
                      if (cfg.ttLocked) { lockTip(); return; }
                      const ok = await askConfirm(t('清空课表'), t('将删除全部 {n} 门课程，并同步到所有设备。', { n: courses.length }), { okText: t('清空'), danger: true });
                      if (!ok) return;
                      // 课程连同它的临时调整一起清（只删课程会留下「（课程已删除）」的孤儿调整），
                      // 并且留一份快照给「撤销」
                      const courseSnaps = courses.map((c) => ({ id: c.id, data: withoutId(c as CourseData & { id: string }) }));
                      const chs = list<CourseChangeData>('courseChanges');
                      const chSnaps = chs.map((ch) => ({ id: ch.id, data: withoutId(ch) }));
                      for (const c of courses) removeRecord('courses', c.id);
                      for (const ch of chs) clearCourseChange(ch.courseId, ch.date);
                      toast(t('课表已清空'), 'ok', {
                        label: t('撤销'),
                        run: () => {
                          for (const s of courseSnaps) putRecord<CourseData>('courses', s.id, s.data);
                          for (const s of chSnaps) putRecord<CourseChangeData>('courseChanges', s.id, s.data);
                          toast(t('已恢复'), 'ok');
                        }
                      });
                    }}>{t('清空课表')}</button>
                )}
              </div>
            </div>
          </div>
        </div>

        {isFixed && typeof showWeek === 'number' && (
          <div className="tt-pin" data-k="tt-pinned">
            <span className="tt-pin-ico">📌</span>
            <span className="tt-pin-text">{t('已固定在第 {n} 周', { n: showWeek })}</span>
            <span className="muted">{t('不会跟着日期往后走，下次打开还是这一周')}</span>
            <button className="btn btn-sm btn-ghost" onClick={followToday}>{t('解除固定')}</button>
          </div>
        )}

        <div className="row-wrap mt12">
          <div className="field" style={{ flex: '0 0 auto' }}>
            <label>{t('开学第一周周一（用于计算教学周与单双周）')}</label>
            <input className="input" type="date" style={{ width: 190 }} value={cfg.termStart}
              onChange={(e) => { saveConfig({ termStart: e.target.value }); toast(t('已保存开学日期'), 'ok'); }} />
          </div>
          <div style={{ paddingTop: 18 }} className="muted">
            {cfg.termStart ? t('当前第 {n} 教学周', { n: week || 1 }) : t('未设置时不做周次过滤，所有课程都会显示')}
            {' · ' + (klass ? t('「{klass}」{n} 门课', { klass, n: shown.length }) : t('共 {n} 门课', { n: courses.length }))}
          </div>
          {typeof showWeek === 'number' && thisWeek > 0 && showWeek !== thisWeek && (
            <div style={{ paddingTop: 18 }} className="muted">{t('正在看第 {n} 周', { n: showWeek })}</div>
          )}
          {locked && (
            <div className="tt-lock-hint" style={{ paddingTop: 18 }}>
              {t('🔒 课表已锁定：拖动 / 加课 / 调课 / 删除都不可用')}
              <button className="chip" style={{ marginLeft: 6 }} onClick={() => { saveConfig({ ttLocked: false }); toast(t('课表已解锁，可以改了'), 'ok'); }}>{t('解锁')}</button>
            </div>
          )}
        </div>
      </div>

      {drag && (
        <div
          ref={ghostRef}
          className="tt-ghost"
          style={{ '--gx': drag.x0 + 'px', '--gy': drag.y0 + 'px' } as React.CSSProperties}
        >
          <div className="tt-ghost-in" style={{ background: drag.color }}>{drag.name}</div>
        </div>
      )}

      {/* 周课表网格 */}
      <div className="card mb16">
        <div className="card-h">
          <span className="ico">📅</span>
          <h3>
            {typeof showWeek === 'number' ? t('第 {n} 教学周', { n: showWeek }) : t('全部周次')}
            {datesKnown ? pick(' · ' + anchor.slice(5).replace('-', '/') + ' 起的一周', ' · ' + anchor.slice(5).replace('-', '/') + ' 起的一週', ' · week of ' + anchor.slice(5).replace('-', '/'), ' · ' + anchor.slice(5).replace('-', '/') + 'からの1週間') : ''}
            {klass ? ' · ' + klass : ''}
          </h3>
          <div className="right tt-grid-hint">
            <span className="muted">
              {locked ? t('已锁定 · 翻周看课不受影响')
                : dragOff ? t('点空白格加课 · 点课程可调课/停课/删除')
                  : t('点空白格加课 · 点课程可调课/停课/删除 · 长按课程可拖动')}
            </span>
            {locked && (
              <button className="tt-lock-pill" data-k="lock-pill" onClick={() => setSettingsOpen(true)}
                title={t('课表已锁定，点这里去解锁')}>{t('🔒 已锁定')}</button>
            )}
          </div>
        </div>

        {/* 选班级：课表是全年段共用的，先选班再看自己那一张 */}
        {classes.length > 0 && (
          <div className="pick-line">
            <span className="pick-label">{t('班级')}</span>
            <div className="week-row" ref={classRowRef}>
              <button className={'chip ' + (klass === '' ? 'on' : '')} onClick={() => pickClass('')}>{t('全部')}</button>
              {classes.map((k) => (
                <button key={k} className={'chip ' + (klass === k ? 'on' : '')} onClick={() => pickClass(k)}>{k}</button>
              ))}
            </div>
          </div>
        )}
        {klass && !classes.includes(klass) && (
          <div className="muted mb8" style={{ fontSize: 11.5 }}>
            {t('「{klass}」已经不在课表里了（可能是重新导入后班级名变了）', { klass })}
            <button className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }} onClick={() => pickClass('')}>{t('看全部')}</button>
          </div>
        )}

        {/* 选第几周：直接点周次跳过去，不用一周一周翻 */}
        <div className="pick-line">
          <span className="pick-label">{t('周次')}</span>
          <div className="week-row" ref={weekRowRef}>
            <button className={'chip ' + (showWeek === 'all' ? 'on' : '')} onClick={() => setWeekPick('all')}>{t('全部')}</button>
            {Array.from({ length: maxWeek }, (_, i) => i + 1).map((n) => (
              <button key={n}
                className={'chip ' + (showWeek === n ? 'on' : '') + (n === thisWeek ? ' now' : '')}
                onClick={() => pickWeek(n)}>
                {t('第 {n} 周', { n })}
              </button>
            ))}
          </div>
        </div>
        {!cfg.termStart && (
          <div className="muted mb8" style={{ fontSize: 11.5 }}>
            {t('还没填开学日期：现在按课程自己的周次筛。在上面填上「开学第一周周一」，日期也会跟着对上')}
          </div>
        )}

        {/* 本周有临时调整就摆出来，一条条能撤销 */}
        {(() => {
          const weekChanges = changes.filter((ch) => days.indexOf(ch.date) >= 0 || (ch.toDate ? days.indexOf(ch.toDate) >= 0 : false));
          if (!weekChanges.length) return null;
          return (
            <div className="tt-changes">
              <span className="pick-label">{t('本周调整')}</span>
              {weekChanges.map((ch) => {
                const c = shown.find((x) => x.id === ch.courseId) || courses.find((x) => x.id === ch.courseId);
                const what = ch.kind === 'cancel' ? t('停课')
                  : ch.kind === 'move' ? t('调到 {when}', { when: (ch.toDate || '').slice(5) + (ch.startTime ? ' ' + ch.startTime : '') })
                    : t('改时间/地点');
                return (
                  <span key={ch.id} className="tt-change-chip">
                    <b>{c ? c.name : t('（课程已删除）')}</b>
                    <span>{what}</span>
                    <em>{ch.date.slice(5)}</em>
                    <button className="btn btn-sm btn-ghost" onClick={() => {
                      if (cfg.ttLocked) { lockTip(); return; }
                      clearCourseChange(ch.courseId, ch.date);
                      toast(t('已恢复常规课表'), 'ok');
                    }}>{t('撤销')}</button>
                  </span>
                );
              })}
            </div>
          );
        })()}

        <div className={'tt-wrap' + (locked ? ' tt-locked' : '')}>
          <div className="tt" style={{ gridTemplateRows: 'auto ' + axisH + 'px' }}>
            <div />
            {days.map((d, i) => (
              <div key={d} className={'tt-head' + (datesKnown && d === today ? ' today' : '')}>
                {weekdayName(parseYMD(d).getDay())}
                {datesKnown && <div className="muted" style={{ fontSize: 10 }}>{d.slice(5)}</div>}
              </div>
            ))}

            {/* 左侧时间轴：第几节 + 起止时间 */}
            <div style={{ position: 'relative' }}>
              {rows.map((r, i) => (
                <div key={r.key} className="tt-time" style={{ position: 'absolute', top: i * PERIOD_H, height: PERIOD_H, right: 0, left: 0 }}>
                  <em>{r.n}</em>
                  <span><b>{r.start}</b><i>{r.end}</i></span>
                </div>
              ))}
            </div>

            {days.map((d) => {
              const wd = ((parseYMD(d).getDay() + 6) % 7) + 1;
              const list_ = dayCourses(d, wd);
              return (
                <div key={d} className="tt-col"
                  style={{ position: 'relative', background: datesKnown && d === today ? 'rgba(109,139,255,.05)' : 'transparent', borderRadius: 8 }}
                  onClick={(e) => {
                    if (swallowClick()) return;
                    if (e.target !== e.currentTarget) return;
                    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const idx = Math.max(0, Math.min(rows.length - 1, Math.floor((e.clientY - box.top) / PERIOD_H)));
                    openNew(wd, rows[idx] ? rows[idx].start : '08:00');
                  }}
                >
                  {/* 背景格子 = 一节一行；课程跨几节就占几行 */}
                  {rows.map((r, i) => (
                    <div key={r.key} className="tt-cell" title={t('第 {n} 节 {start}-{end} · 点一下加课', { n: r.n, start: r.start, end: r.end })}
                      data-date={d} data-start={r.start} data-end={r.end}
                      onClick={() => { if (swallowClick()) return; openNew(wd, r.start); }}
                      style={{ position: 'absolute', left: 0, right: 0, top: i * PERIOD_H, height: PERIOD_H - 3 }} />
                  ))}
                  {list_.map(({ c, change, movedIn }) => {
                    // 课程按"跨几节"占位，和左边的节次严格对齐
                    const r0 = rowOf(timeToMinutes(c.startTime));
                    const r1 = Math.max(r0, rowOf(timeToMinutes(c.endTime)));
                    const top = r0 * PERIOD_H + 3;
                    const h = Math.max(30, (r1 - r0 + 1) * PERIOD_H - 8);
                    const lane = lanes.get(c.id) || { left: 0, width: 1 };
                    const pad = lane.width < 1 ? 1 : 2;
                    return (
                      <div key={c.id}
                        draggable={false}
                        data-date={d} data-start={c.startTime}
                        className={'tt-course' + (change && change.kind === 'cancel' ? ' cancelled' : '') + (drag && drag.id === c.id ? ' dragging' : '')}
                        onPointerDown={(e) => {
                          if (e.button > 0) return;
                          if (change && change.kind === 'cancel') return;   // 停课的块不用拖
                          armDrag(c, d, e.clientX, e.clientY);
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        onClick={() => {
                          // 刚拖完松手会补一个 click，别让它把操作面板弹出来
                          if (swallowClick()) return;
                          setSheet({ course: c, date: d });
                        }}
                        style={{
                          top, height: h,
                          left: 'calc(' + (lane.left * 100).toFixed(3) + '% + ' + pad + 'px)',
                          right: 'auto',
                          width: 'calc(' + (lane.width * 100).toFixed(3) + '% - ' + (pad * 2) + 'px)',
                          background: c.color + '33', borderLeftColor: c.color
                        }}>
                        {change ? (
                          <span className="tt-flag">{change.kind === 'cancel' ? t('停课') : movedIn ? t('调课来') : t('已调整')}</span>
                        ) : null}
                        <b>{c.name}</b>
                        {c.location ? <span className="tt-loc">@{c.location}</span> : null}
                        {c.teacher ? <span className="tt-teacher">{c.teacher}</span> : null}
                        {c.note ? <span className="tt-note" title={c.note}>📝</span> : null}
                        {/* 周次必须显示：同一门课同一时段、不同周次是两条记录（教务系统就这么给），
                            不写周次根本分不清该上哪一门 */}
                        <span className="tt-weeks">
                          {c.weeks && c.weeks.length
                            ? fmtWeeks(c.weeks)
                            : fmtWeekSpan(c.startWeek, c.endWeek, c.weekParity)}
                        </span>

                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        {courses.length === 0 && <Empty icon="📅" text={t('课表还是空的')} hint={t('点上方「导入课表」粘贴或上传你的大学课表')} />}
        {courses.length > 0 && shown.length === 0 && (
          <Empty icon="👥" text={t('「{klass}」还没有课程', { klass })} hint={t('换一个班，或者点班级条上的「全部」看完整课表')} />
        )}
      </div>

      {/* 今日课程 */}
      <div className="card">
        <div className="card-h"><span className="ico">🌞</span><h3>{t('今日课程')} · {weekdayName(new Date().getDay())}</h3></div>
        {todayList.length === 0 ? <div className="muted">{t('今天没有课 🎉')}</div> : (
          <div className="day-courses">
            {todayList.map((c) => (
              <div key={c.id} className={'day-course' + (c.change && c.change.kind === 'cancel' ? ' cancelled' : '')} style={{ borderLeftColor: c.color }}>
                <div className="ct">{c.startTime}<br />{c.endTime}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>
                    {c.name}
                    {c.change ? <Tag text={c.change.kind === 'cancel' ? t('停课') : c.movedFrom ? t('调课') : t('已调整')} color={c.change.kind === 'cancel' ? '#e0838f' : '#dfa96f'} /> : null}
                  </div>
                  <div className="muted">
                    {[c.location, c.teacher].filter(Boolean).join(' · ') || '—'}
                    {c.movedFrom ? ' · ' + t('从 {date} 调来', { date: c.movedFrom.slice(5) }) : ''}
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => setSheet({ course: c, date: today })}>{t('调整')}</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
      {sheet && (
        <CourseActions
          course={sheet.course}
          date={sheet.date}
          locked={locked}
          onUnlock={() => { saveConfig({ ttLocked: false }); toast(t('课表已解锁，可以改了'), 'ok'); }}
          onClose={() => setSheet(null)}
          onEdit={() => { if (cfg.ttLocked) { lockTip(); return; } setForm({ ...sheet.course }); setSheet(null); }}
        />
      )}
      {form && <CourseEditor form={form} onClose={() => setForm(null)} />}
      {weekPickOpen && (
        <WeekPicker
          current={showWeek}
          thisWeek={thisWeek}
          maxWeek={maxWeek}
          fixed={isFixed}
          onPick={(n) => { pickWeek(n); setWeekPickOpen(false); }}
          onFollow={() => { followToday(); setWeekPickOpen(false); }}
          onCalibrate={calibrateTo}
          onClose={() => setWeekPickOpen(false)}
        />
      )}
    </>
  );
}

/* --------------------------- 临时调课 / 停课 --------------------------- */
/**
 * 点开课表里的一节课：临时换课走这里，改整学期走「编辑这门课」。
 * 老师临时换教室、临时停课、把课调到别的时间，都是"只改这一天这一次"，
 * 所以单独记一条 courseChanges，不去动常规课表。
 */
function CourseActions(props: {
  course: Item<CourseData>; date: string; onClose: () => void; onEdit: () => void;
  /** 课表锁着的时候只让看，所有"改"的入口都禁用 */
  locked?: boolean; onUnlock?: () => void;
}) {
  useDB();
  const changes = list<CourseChangeData>('courseChanges');
  const cur = changes.find((x) => x.id === changeId(props.course.id, props.date));
  const [mode, setMode] = useState<'' | 'move' | 'edit'>('');
  const [toDate, setToDate] = useState(props.date);
  const [start, setStart] = useState(props.course.startTime);
  const [end, setEnd] = useState(props.course.endTime);
  const [loc, setLoc] = useState(props.course.location);
  const [note, setNote] = useState('');
  // 课程备注是"整学期"的（区别于上面这次调整的备注），单独一个 state
  const [courseNote, setCourseNote] = useState(props.course.note || '');
  const dayLabel = props.date === todayStr() ? t('今天') : t('{date} 那天', { date: props.date.slice(5) });
  const locked = !!props.locked;

  return (
    <Modal title={t('「{name}」· {day}', { name: props.course.name, day: dayLabel })} onClose={props.onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={props.onClose}>{t('关闭')}</button>
        {cur && (
          <button className="btn" disabled={locked} onClick={() => {
            clearCourseChange(props.course.id, props.date);
            toast(t('已恢复常规课表'), 'ok');
            props.onClose();
          }}>{t('撤销这次调整')}</button>
        )}
      </>}>
      {locked && (
        <div className="tt-locked-banner">
          <span>{t('🔒 课表已锁定：改时间、调课、停课、删除都暂时不可用')}</span>
          <button className="btn btn-sm btn-primary" onClick={() => { if (props.onUnlock) props.onUnlock(); }}>{t('解锁')}</button>
        </div>
      )}
      <div className="muted mb12">
        {t('这里改的是')} <b>{dayLabel}</b> {t('这一次（老师临时换课、换教室、停课都走这儿），常规课表不动；')}
        {t('要改整学期的安排，点下面「编辑这门课」。')}
      </div>
      {cur && (
        <div className="mb12">
          <Tag text={cur.kind === 'cancel' ? t('已记为停课') : cur.kind === 'move' ? t('已调到 {date}', { date: (cur.toDate || '').slice(5) }) : t('已调整时间/地点')} color="#dfa96f" />
        </div>
      )}
      {mode === '' ? (
        <div className="row-wrap" style={{ gap: 8 }}>
          <button className="btn" disabled={locked} onClick={() => setMode('edit')}>{t('改时间 / 地点')}</button>
          <button className="btn" disabled={locked} onClick={() => setMode('move')}>{t('调到别的日期')}</button>
          <button className="btn btn-danger" disabled={locked} onClick={() => {
            saveCourseChange(props.course.id, props.date, 'cancel');
            toast(t('已记为停课'), 'ok');
            props.onClose();
          }}>{t('这次停课')}</button>
          <button className="btn btn-primary" disabled={locked} onClick={props.onEdit}>{t('编辑这门课（整学期）')}</button>
          <button className="btn btn-ghost" disabled={locked} onClick={async () => {
            const yes = await askConfirm(t('删除「{name}」？', { name: props.course.name }), t('这门课会从课表里整门删掉（连同它的临时调整），并同步到所有设备。只想停这一次请用「这次停课」。'), { okText: t('删除'), danger: true });
            if (!yes) return;
            const all = list<CourseChangeData>('courseChanges').filter((x) => x.courseId === props.course.id);
            // 整门课连同临时调整都会被删掉，先留一份快照给「撤销」用
            const courseSnap = withoutId(props.course as CourseData & { id: string });
            const changeSnaps = all.map((ch) => ({ id: ch.id, data: withoutId(ch) }));
            for (const ch of all) clearCourseChange(ch.courseId, ch.date);
            removeRecord('courses', props.course.id);
            toast(t('已删除「{name}」', { name: props.course.name }), 'ok', {
              label: t('撤销'),
              run: () => {
                putRecord<CourseData>('courses', props.course.id, courseSnap);
                for (const s of changeSnaps) putRecord<CourseChangeData>('courseChanges', s.id, s.data);
                toast(t('已恢复'), 'ok');
              }
            });
            props.onClose();
          }}>{t('删除这门课')}</button>
        </div>
      ) : (
        <div className="form-grid">
          {mode === 'move' && (
            <Field label={t('调到哪一天')}>
              <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </Field>
          )}
          <Field label={t('上课时间')}>
            <div className="row">
              <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </Field>
          <Field label={t('地点')}>
            <input className="input" value={loc} onChange={(e) => setLoc(e.target.value)} placeholder={props.course.location || t('例如 北2229')} />
          </Field>
          <Field label={t('备注')} full>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('例如：老师出差，补课')} />
          </Field>
          <div className="row" style={{ gridColumn: '1 / -1' }}>
            <button className="btn btn-primary" disabled={locked} onClick={() => {
              if (mode === 'move') saveCourseChange(props.course.id, props.date, 'move', { toDate, startTime: start, endTime: end, location: loc, note });
              else saveCourseChange(props.course.id, props.date, 'edit', { startTime: start, endTime: end, location: loc, note });
              toast(mode === 'move' ? t('已调到 {date}', { date: toDate }) : t('已记下这次的调整'), 'ok');
              props.onClose();
            }}>{t('保存这次调整')}</button>
            <button className="btn btn-ghost" onClick={() => setMode('')}>{t('返回')}</button>
          </div>
        </div>
      )}

      <div className="mt16" style={{ borderTop: '1px solid rgba(var(--card-rgb), .18)', paddingTop: 10 }}>
        <Field label={t('这门课的备注')} hint={t('整学期生效，课表上会显示一个 📝 标记')}>
          <div className="row">
            {/* 锁定时不给 Tab 停：readOnly 原生仍可聚焦，键盘用户会卡在一个改不动的框里 */}
            <input className="input" value={courseNote} placeholder={t('例如：带计算器 / 每周交一次作业')}
              readOnly={locked}
              tabIndex={locked ? -1 : 0}
              aria-readonly={locked || undefined}
              onChange={(e) => setCourseNote(e.target.value)} />
            <button className="btn btn-sm btn-primary"
              disabled={locked || courseNote === (props.course.note || '')}
              onClick={() => {
                patchRecord<CourseData>('courses', props.course.id, { note: courseNote.trim() });
                toast(courseNote.trim() ? t('备注已保存') : t('备注已清除'), 'ok');
              }}>{t('保存')}</button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function addMinutes(t: string, d: number): string {
  const total = timeToMinutes(t) + d;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

/* ------------------------------- 课程编辑 ------------------------------- */
function CourseEditor(props: { form: Partial<CourseData> & { id?: string }; onClose: () => void }) {
  const isNew = !props.form.id;
  const [f, setF] = useState<Partial<CourseData> & { id?: string }>({ ...props.form });
  const set = (p: Partial<CourseData>) => setF((prev) => ({ ...prev, ...p }));
  const palette = ['#4f8cff', '#22c55e', '#ff7a59', '#a855f7', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16', '#f43f5e', '#6366f1'];

  return (
    <Modal title={isNew ? t('添加课程') : t('编辑课程')} onClose={props.onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={props.onClose}>{t('取消')}</button>
        <button className="btn btn-primary" onClick={() => {
          if (!f.name || !String(f.name).trim()) { toast(t('请填写课程名称'), 'err'); return; }
          const data: CourseData = {
            name: String(f.name).trim(), teacher: f.teacher || '', location: f.location || '',
            weekday: Number(f.weekday) || 1, startTime: f.startTime || '08:00', endTime: f.endTime || '09:40',
            startWeek: Number(f.startWeek) || 1, endWeek: Number(f.endWeek) || 16,
            weekParity: f.weekParity || 'all', color: f.color || '#4f8cff', note: f.note || '',
            // 班级原来漏在这里了：编辑框能填、导入能带，但手动加课/编辑存不进库，
            // 于是「按班级筛选」对手动建的课完全失效。
            className: (f.className || '').trim(),
            createdAt: f.createdAt || Date.now()
          };
          putRecord<CourseData>('courses', isNew ? newId() : String(f.id), data);
          toast(isNew ? t('已添加课程') : t('已保存'), 'ok');
          props.onClose();
        }}>{isNew ? t('添加') : t('保存')}</button>
      </>}>
      <div className="form-grid">
        <Field label={t('课程名称 *')} full>
          <input className="input" autoFocus value={f.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder={t('例如：高等数学 A')} />
        </Field>
        <Field label={t('教师')}><input className="input" value={f.teacher || ''} onChange={(e) => set({ teacher: e.target.value })} /></Field>
        <Field label={t('地点')}><input className="input" value={f.location || ''} onChange={(e) => set({ location: e.target.value })} placeholder={t('例如：教三 201')} /></Field>
        <Field label={t('班级')} hint={t('课表按班级筛选时用，留空表示不分班')}>
          <input className="input" value={f.className || ''} onChange={(e) => set({ className: e.target.value })} placeholder={t('例如：计科 2101')} />
        </Field>
        <Field label={t('星期')}>
          <select className="select" value={f.weekday || 1} onChange={(e) => set({ weekday: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{weekdayName(d === 7 ? 0 : d)}</option>)}
          </select>
        </Field>
        <Field label={t('周次类型')}>
          <select className="select" value={f.weekParity || 'all'} onChange={(e) => set({ weekParity: e.target.value as CourseData['weekParity'] })}>
            <option value="all">{t('每周')}</option>
            <option value="odd">{t('单周')}</option>
            <option value="even">{t('双周')}</option>
          </select>
        </Field>
        <Field label={t('开始时间')}><input className="input" type="time" value={f.startTime || '08:00'} onChange={(e) => set({ startTime: e.target.value })} /></Field>
        <Field label={t('结束时间')}><input className="input" type="time" value={f.endTime || '09:40'} onChange={(e) => set({ endTime: e.target.value })} /></Field>
        <Field label={t('起始周')}><input className="input" type="number" min={1} max={30} value={f.startWeek || 1} onChange={(e) => set({ startWeek: Number(e.target.value) })} /></Field>
        <Field label={t('结束周')}><input className="input" type="number" min={1} max={30} value={f.endWeek || 16} onChange={(e) => set({ endWeek: Number(e.target.value) })} /></Field>
        <Field label={t('颜色')} full>
          <div className="row-wrap">
            {palette.map((c) => (
              <button key={c} onClick={() => set({ color: c })}
                style={{ width: 26, height: 26, borderRadius: 8, background: c, border: f.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} />
            ))}
          </div>
        </Field>
        <Field label={t('备注')} full>
          <input className="input" value={f.note || ''} onChange={(e) => set({ note: e.target.value })} placeholder={t('例如：带实验 / 需要带电脑')} />
        </Field>
      </div>
      {!isNew && (
        <div className="mt12">
          <button className="btn btn-danger btn-sm" onClick={async () => {
            const ok = await askConfirm(t('删除课程'), t('确定删除「{name}」吗？', { name: String(f.name) }), { okText: t('删除'), danger: true });
            if (!ok) return;
            const cid = String(f.id);
            const snap = withoutId({ ...(f as CourseData), id: cid });
            // 这里和详情面板的删除要保持一致：整门课连它的临时调整一起删。
            // 以前只删课，剩下的调整会在「本周调整」里变成一条「（课程已删除）」，还同步到手机。
            const chs = list<CourseChangeData>('courseChanges').filter((x) => x.courseId === cid);
            const chSnaps = chs.map((ch) => ({ id: ch.id, data: withoutId(ch) }));
            for (const ch of chs) clearCourseChange(ch.courseId, ch.date);
            removeRecord('courses', cid);
            toast(t('已删除'), 'ok', {
              label: t('撤销'),
              run: () => {
                putRecord<CourseData>('courses', cid, snap);
                for (const s of chSnaps) putRecord<CourseChangeData>('courseChanges', s.id, s.data);
                toast(t('已恢复'), 'ok');
              }
            });
            props.onClose();
          }}>{t('删除这门课')}</button>
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------- 导入 -------------------------------- */
function ImportModal(props: { onClose: () => void }) {
  const [tab, setTab] = useState<'text' | 'file' | 'ai'>('text');
  const [text, setText] = useState('');
  const [periodsText, setPeriodsText] = useState(cfg.periodsText || periodsToText(DEFAULT_PERIODS));
  const [preview, setPreview] = useState<ParsedCourse[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const aiImgRef = useRef<HTMLInputElement | null>(null);
  const aiCamRef = useRef<HTMLInputElement | null>(null);
  const aiXlsRef = useRef<HTMLInputElement | null>(null);
  const [aiImage, setAiImage] = useState('');      // dataURL
  const [aiImageName, setAiImageName] = useState('');
  const [aiRows, setAiRows] = useState<string[][]>([]);
  const [aiRowsName, setAiRowsName] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');
  // 全年段的课表通常一次只导一个班：填在这里，解析出来的课没带班级就都归它
  const [defaultClass, setDefaultClass] = useState(() => { try { return localStorage.getItem('ttClass') || ''; } catch { return ''; } });
  // 「按班分行」的整院课表里会出现很多班，解析出来后让用户直接挑
  const [foundClasses, setFoundClasses] = useState<string[]>([]);
  const [allParsed, setAllParsed] = useState<ParsedCourse[]>([]);

  /** 按班级筛预览；空班级表示全部 */
  const applyClass = (k: string, list?: ParsedCourse[]) => {
    const src = list || allParsed;
    setPreview(k ? src.filter((c) => (c.className || '') === k) : src);
  };
  const withClass = (list: ParsedCourse[]) =>
    list.map((c) => ({ ...c, className: (c.className || '').trim() || defaultClass.trim() }));

  /* ---------------------------- AI 识别并排课 ---------------------------- */
  const doAi = async () => {
    setAiBusy(true);
    setAiNote('');
    try {
      const per = parsePeriods(periodsText);
      // 表格先过一遍确定性解析器：能算准的就不麻烦模型，
      // 模型只在"格式没见过"（比如课表截图）时才上场，这样结果才稳
      if (aiRows.length && !text.trim() && !aiImage) {
        const cls = parseClassRowSheet(aiRows, per);
        if (cls.courses.length) {
          setFoundClasses(cls.classes);
          setAllParsed(cls.courses);
          const want = defaultClass.trim();
          const list = want ? cls.courses.filter((c) => c.className === want) : cls.courses;
          setPreview(withClass(list.length ? list : cls.courses));
          setErrors(cls.errors);
          setAiNote(t('本地结构化解析：{n} 门（这种整院课表格式很固定，不用 AI 也不会错）', { n: list.length ? list.length : cls.courses.length }));
          toast(t('解析出 {n} 门课程', { n: list.length || cls.courses.length }), 'ok');
          return;
        }
      }
      const r = await analyzeTimetable({
        text,
        rows: aiRows.length ? aiRows : undefined,
        image: aiImage || undefined,
        periods: per
      });
      setPreview(withClass(r.courses));
      setErrors([]);
      setAiNote(r.note);
      // AI 如果从原文里认出了开学日期，而本地还没设过，就顺手设上——
      // 教学周没设的话「第几周」是算不出来的，排完课表也是空的
      if (r.termStart && !cfg.termStart) {
        await saveConfig({ termStart: r.termStart });
        setAiNote(r.note + ' · ' + t('顺便把开学日期设成了 {date}', { date: r.termStart }));
      }
      toast(r.courses.length ? r.note : t('没识别出课程，换个模型或换张更清晰的图试试'),
        r.courses.length ? 'ok' : 'err');
    } catch (e) {
      toast(String((e as Error).message || e), 'err');
    } finally {
      setAiBusy(false);
      if (aiImgRef.current) aiImgRef.current.value = '';
      if (aiCamRef.current) aiCamRef.current.value = '';
    }
  };

  const pickAiImage = async (file: File) => {
    try {
      setAiImage(await fileToDataURL(file, 1920, 0.86));
      setAiImageName(file.name || t('照片'));
    } catch (e) {
      toast(t('读取图片失败：{msg}', { msg: String((e as Error).message || e) }), 'err');
    }
  };

  const pickAiSheet = async (file: File) => {
    try {
      setAiRows(await readSpreadsheet(file));
      setAiRowsName(file.name);
    } catch (e) {
      toast(t('读取表格失败：{msg}', { msg: String((e as Error).message || e) }), 'err');
    } finally {
      if (aiXlsRef.current) aiXlsRef.current.value = '';
    }
  };

  const doParseText = () => {
    const r = parseAny(text, parsePeriods(periodsText));
    setPreview(withClass(r.courses));
    setErrors(r.errors);
    if (!r.courses.length) toast(t('没有解析到课程，请检查格式'), 'err');
    else toast(t('解析出 {n} 门课程', { n: r.courses.length }), 'ok');
  };

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const name = file.name.toLowerCase();
      let r;
      if (name.endsWith('.csv') || name.endsWith('.txt')) {
        const content = await file.text();
        setText(content);
        r = parseAny(content, parsePeriods(periodsText));
      } else {
        const rows = await readSpreadsheet(file);
        const per = parsePeriods(periodsText);
        // 先试「按班分行」的整院课表：这是教务系统导出最常见的一种，结构很固定，
        // 确定性解析比让模型猜靠谱得多
        const cls = parseClassRowSheet(rows, per);
        if (cls.courses.length) {
          setFoundClasses(cls.classes);
          setAllParsed(cls.courses);
          const want = defaultClass.trim();
          r = { courses: want ? cls.courses.filter((c) => c.className === want) : cls.courses, errors: cls.errors.slice() };
          if (want && !r.courses.length) {
            r = { courses: cls.courses, errors: cls.errors.concat([t('没有找到「{name}」，下面先列出全部班级的课程', { name: want })]) };
          }
        } else {
          setFoundClasses([]);
          setAllParsed([]);
          r = parseGridCourses(rows, per);
          if (!r.courses.length) {
            // 退回文本解析
            r = parseAny(rows.map((row) => row.join(' ')).join('\n'), per);
          }
        }
      }
      setPreview(withClass(r.courses));
      setErrors(r.errors);
      toast(r.courses.length ? t('解析出 {n} 门课程', { n: r.courses.length }) : t('未能解析，请检查文件格式', {}), r.courses.length ? 'ok' : 'err');
    } catch (e) {
      toast(t('读取失败：{msg}', { msg: String((e as Error).message || e) }), 'err');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doImport = () => {
    if (!preview.length) { toast(t('没有可导入的课程'), 'err'); return; }
    saveConfig({ periodsText });
    if (defaultClass.trim()) { try { localStorage.setItem('ttClass', defaultClass.trim()); } catch { /* 忽略 */ } }
    for (const c of preview) putRecord<CourseData>('courses', newId(), { ...c, createdAt: Date.now() });
    toast(t('已导入 {n} 门课程', { n: preview.length }), 'ok');
    props.onClose();
  };

  const sample = '高等数学A 张建国 教三201 周一 08:00-09:40 1-16周';
  const gridSample = [
    '课程名,教师,地点,星期,节次,周次',
    '数据结构,王强,计算机楼A401,周二,1-2节,1-16周',
    '计算机网络,赵敏,计算机楼A302,周三,7-8节,1-16周双周'
  ].join('\n');

  return (
    <Modal wide title={t('导入大学课表')} onClose={props.onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={props.onClose}>{t('取消')}</button>
        <button className="btn btn-primary" disabled={!preview.length || busy} onClick={doImport}>
          {preview.length ? t('确认导入（{n}）', { n: preview.length }) : t('确认导入')}
        </button>
      </>}>
      <div className="seg mb12">
        <button className={tab === 'text' ? 'on' : ''} onClick={() => setTab('text')}>{t('粘贴文本 / CSV')}</button>
        <button className={tab === 'file' ? 'on' : ''} onClick={() => setTab('file')}>{t('上传 Excel / CSV 文件')}</button>
        <button className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}>{t('AI 识别 / 图片排课')}</button>
      </div>

      {tab === 'text' ? (
        <>
          <Field label={t('粘贴课表内容')} full hint={t('每行一门课，例如：高等数学A 张建国 教三201 周一 08:00-09:40 1-16周；也支持从教务系统复制的多行文本')}>
            <textarea className="textarea" style={{ minHeight: 150, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}
              value={text} onChange={(e) => setText(e.target.value)} placeholder={sample} />
          </Field>
          <div className="row mt8">
            <button className="btn btn-sm" onClick={() => setText(sample + '\n大学英语 李梅 外语楼305 周一 10:00-11:40 1-16周')}>{t('填入示例')}</button>
            <button className="btn btn-sm" onClick={() => setText(gridSample)}>{t('填入 CSV 示例')}</button>
            <div className="spacer" />
            <button className="btn btn-primary btn-sm" onClick={doParseText}>{t('解析')}</button>
          </div>
        </>
      ) : tab === 'file' ? (
        <>
          <Field label={t('选择文件')} full hint={t('支持 .xlsx / .xls / .csv，会自动寻找含「星期一…星期日」的表头行')}>
            <input ref={fileRef} className="input" type="file" accept=".xlsx,.xls,.csv,.txt"
              onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onFile(f); }} />
          </Field>
          <div className="muted mt8">{t('已识别的教务系统格式：首行为星期表头、首列为节次或时间的网格型课表。')}</div>
          <div className="muted mt8">{t('如果这份表格解析不出来（排版太怪），切到「AI 识别」那一栏把同一个文件丢给 AI 试试。')}</div>
        </>
      ) : (
        <>
          <div className="muted mb12" style={{ lineHeight: 1.9 }}>
            {t('丢一张')}<b>{t('课表截图或相册里的照片')}</b>{t('进来，AI 会认出课程、教师、地点、节次和周次，直接排成课表。')}
            {t('也可以上传 Excel，或者在下面粘贴教务系统复制出来的一坨乱文本。')}
            {!aiReady() && <><br /><b>{t('当前没有配置 AI 接口')}</b>{t('：图片认不了，文本和 Excel 会走本地规则解析，结果一样能导入。')}</>}
          </div>

          <div className="row-wrap mb12">
            <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
              {t('🖼 从相册选课表图')}
              <input ref={aiImgRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) pickAiImage(f); }} />
            </label>
            <label className="btn" style={{ cursor: 'pointer' }}>
              {t('📷 现拍一张')}
              <input ref={aiCamRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) pickAiImage(f); }} />
            </label>
            <label className="btn" style={{ cursor: 'pointer' }}>
              {t('📊 选 Excel 给 AI')}
              <input ref={aiXlsRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) pickAiSheet(f); }} />
            </label>
          </div>

          {(aiImage || aiRowsName) && (
            <div className="row-wrap mb12" style={{ alignItems: 'center' }}>
              {aiImage && <img src={aiImage} alt={t('课表预览')} style={{ maxWidth: 180, maxHeight: 120, borderRadius: 10 }} />}
              <span className="muted">
                {aiImageName}{aiRowsName ? (aiImageName ? ' · ' : '') + aiRowsName + t('（{n} 行）', { n: aiRows.length }) : ''}
              </span>
              <button className="btn btn-sm btn-ghost"
                onClick={() => { setAiImage(''); setAiImageName(''); setAiRows([]); setAiRowsName(''); }}>{t('清除')}</button>
            </div>
          )}

          <Field label={t('也可以直接粘贴文本')} full hint={t('教务系统复制的、聊天记录里的、手打的都行，格式乱一点没关系')}>
            <textarea className="textarea" style={{ minHeight: 110, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}
              value={text} onChange={(e) => setText(e.target.value)}
              placeholder={t('例如：高等数学A 张建国 教三201 周一 3-4节 1-16周')} />
          </Field>

          <div className="row-wrap mt12">
            <button className="btn btn-primary" onClick={doAi}
              disabled={aiBusy || (!aiImage && !text.trim() && !aiRows.length)}>
              {aiBusy ? t('识别中…（图片可能要十几秒）') : t('✨ AI 识别并自动排课')}
            </button>
            {!aiReady() && <span className="muted">{t('未配置 AI 接口，将使用本地规则解析')}</span>}
          </div>

          {aiNote && <div className="mt12" style={{ fontSize: 13 }}>{aiNote}</div>}
        </>
      )}

      <div className="mt12">
        <Field label={t('默认班级')} full hint={t('这次导入的课没写班级就都归它。全年段的课表按班分几次导入，之后在课表页切换班级即可')}>
          <input className="input" value={defaultClass} onChange={(e) => setDefaultClass(e.target.value)}
            placeholder={t('例如：计科 2101（留空表示不分班）')} />
        </Field>
        <Field label={t('节次时间表（可修改，用于「第 3-4 节」这类写法）')} full>
          <textarea className="textarea" style={{ minHeight: 90, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}
            value={periodsText} onChange={(e) => setPeriodsText(e.target.value)} />
        </Field>
        <button className="btn btn-sm" onClick={() => setPeriodsText(periodsToText(DEFAULT_PERIODS))}>{t('恢复默认节次')}</button>
      </div>

      {foundClasses.length > 0 && (
        <div className="mt12">
          <div className="muted mb8">{t('这份课表里有 {n} 个班，点一个只看它的课：', { n: foundClasses.length })}</div>
          <div className="row chip-row" data-slide style={{ gap: 6 }}>
            <button className={'chip ' + (defaultClass === '' ? 'on' : '')}
              onClick={() => { setDefaultClass(''); applyClass(''); }}>{t('全部')}</button>
            {foundClasses.map((k) => (
              <button key={k} className={'chip ' + (defaultClass === k ? 'on' : '')}
                onClick={() => {
                  setDefaultClass(k);
                  applyClass(k);
                  toast(t('已切到「{name}」，确认导入即可', { name: k }), 'ok');
                }}>{k}</button>
            ))}
          </div>
          <div className="muted mt8" style={{ fontSize: 12 }}>
            {t('选好之后点「确认导入」。同一份表可以分几次导入不同班，之后在课表页随时切换。')}
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="mt12">
          <div className="muted mb8">{t('解析提示（{n}）', { n: errors.length })}</div>
          <div className="pre">{errors.slice(0, 12).join('\n')}</div>
        </div>
      )}

      {preview.length > 0 && (
        <div className="mt12">
          <div className="muted mb8">{t('解析预览（{n} 门，可逐条删除）', { n: preview.length })}</div>
          <div className="pool" style={{ maxHeight: 300, overflow: 'auto' }}>
            {preview.map((c, i) => (
              <div key={i} className="pool-item">
                <span style={{ width: 8, height: 8, borderRadius: 4, background: c.color, flex: '0 0 8px' }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                  <b>{c.name}</b>
                  <div className="muted">
                    {c.className ? <b style={{ marginRight: 6 }}>[{c.className}]</b> : null}
                    {weekdayName(c.weekday === 7 ? 0 : c.weekday)} {c.startTime}-{c.endTime} · {c.weeks && c.weeks.length ? fmtWeeks(c.weeks) : fmtWeeks(undefined, c.startWeek, c.endWeek, c.weekParity)} · {[c.location, c.teacher].filter(Boolean).join(' / ') || '—'}
                  </div>
                </span>
                <button className="btn btn-sm btn-ghost" onClick={() => setPreview((p) => p.filter((_, k) => k !== i))}>{t('移除')}</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------- 节次时间：每节几点到几点 ----------------
/** 分钟 → 「HH:mm」 */
function hhmm(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

export function PeriodEditor(props: { onClose: () => void }) {
  const [rows, setRows] = useState<Array<[string, string]>>(() => {
    const p = parsePeriods(cfg.periodsText || periodsToText(DEFAULT_PERIODS));
    return p.map((x) => [x[0], x[1]] as [string, string]);
  });
  const setRow = (i: number, k: 0 | 1, v: string) => setRows((rs) => rs.map((r, j) => (
    j === i ? [(k === 0 ? v : r[0]), (k === 1 ? v : r[1])] as [string, string] : r
  )));
  const addRow = () => setRows((rs) => {
    const last = rs[rs.length - 1];
    const s = last ? hhmm(timeToMinutes(last[1]) + 10) : '08:00';
    return rs.concat([[s, hhmm(timeToMinutes(s) + 45)]]);
  });
  const delRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  /** 从第一节开始按「45 分钟上课 + 10 分钟课间」重排，节数不变 */
  const autoFill = () => setRows((rs) => {
    const start0 = rs.length ? timeToMinutes(rs[0][0]) : 8 * 60;
    return rs.map((_, i) => {
      const s = start0 + i * 55;
      return [hhmm(s), hhmm(s + 45)] as [string, string];
    });
  });
  const save = () => {
    const clean = rows.filter((r) => r[0] && r[1] && timeToMinutes(r[1]) > timeToMinutes(r[0]));
    if (clean.length < 2) { toast(t('至少要留 2 节，并且结束时间要晚于开始时间'), 'err'); return; }
    saveConfig({ periodsText: periodsToText(clean) });
    toast(t('已保存 {n} 节的时间表', { n: clean.length }), 'ok');
    props.onClose();
  };
  return (
    <SubPage title={t('节次时间')} onBack={props.onClose}
      desc={t('课表每一格就是一节。各校作息不一样（早八、午休、晚课），按你们学校的作息改这里，改完网格立刻跟着变。')}
      right={<button className="btn btn-sm btn-primary" onClick={save}>{t('保存')}</button>}>
      <div className="card">
        <div className="pe-list">
          {rows.map((r, i) => (
            <div className="pe-row" key={i}>
              <span className="pe-no">{t('第 {n} 节', { n: i + 1 })}</span>
              <input className="input" type="time" value={r[0]} onChange={(e) => setRow(i, 0, e.target.value)} />
              <span className="muted">—</span>
              <input className="input" type="time" value={r[1]} onChange={(e) => setRow(i, 1, e.target.value)} />
              <button className="btn btn-sm btn-ghost pe-del" onClick={() => delRow(i)} aria-label={t('删除这一节')}>✕</button>
            </div>
          ))}
        </div>
        <div className="row row-wrap mt12">
          <button className="btn btn-sm" onClick={addRow}>{t('＋ 加一节')}</button>
          <button className="btn btn-sm" onClick={autoFill}>{t('45 分钟一节重排')}</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setRows(DEFAULT_PERIODS.map((x) => [x[0], x[1]] as [string, string]))}>{t('恢复默认')}</button>
        </div>
      </div>
    </SubPage>
  );
}

// ---------------- 校正周次：现在这一周到底是第几周 ----------------
export function WeekCalibrate(props: { current: number; onClose: () => void }) {
  const [n, setN] = useState(String(props.current || 1));
  const num = Math.max(1, Math.min(30, Math.round(Number(n) || 1)));
  const monday = startOfWeekMonday(todayStr());
  const start = addDays(monday, -7 * (num - 1));
  const save = () => {
    saveConfig({ termStart: start, ttWeek: num, ttWeekMode: 'follow', ttWeekAt: todayStr() });
    toast(t('已校正：本周是第 {n} 周', { n: num }), 'ok');
    props.onClose();
  };
  return (
    <SubPage title={t('校正周次')} onBack={props.onClose}
      desc={t('用教务系统上的实际周次校正一次，之后每周都自动往前推。')}
      right={<button className="btn btn-sm btn-primary" onClick={save}>{t('保存')}</button>}>
      <div className="card">
        <Field label={t('本周是第几周')} hint={t('开学第一周周一 = {date}', { date: start })}>
          <div className="row">
            <button className="btn btn-sm" onClick={() => setN(String(Math.max(1, num - 1)))}>−</button>
            <input className="input" type="number" min={1} max={30} step={1} value={n}
              style={{ width: 90, textAlign: 'center' }}
              onChange={(e) => setN(e.target.value)} />
            <button className="btn btn-sm" onClick={() => setN(String(Math.min(30, num + 1)))}>＋</button>
          </div>
        </Field>
        <div className="row row-wrap mt12">
          {[1, 8, 12, 16, 18, 20].map((w) => (
            <button key={w} className={'chip' + (num === w ? ' on' : '')} onClick={() => setN(String(w))}>{t('第 {n} 周', { n: w })}</button>
          ))}
        </div>
      </div>
    </SubPage>
  );
}

/* ----------------------- 课表设置：功能开关 ----------------------- */
/**
 * 一行开关。整行都是点击区域（手机上比小滑块好点），右侧是一个方形勾选框。
 * role=switch + aria-checked 让读屏和测试都能读到"开/关"。
 * 这里保留 tt-sw-row 类只为吃到它已有的 .disabled 降透明度样式，排版交给 .set-row。
 */
function TtSwitch(props: {
  k: string; label: string; desc: string; on: boolean;
  disabled?: boolean; onChange: (v: boolean) => void;
}) {
  const box: React.CSSProperties = {
    width: 20, height: 20, flex: '0 0 20px', borderRadius: 6,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, lineHeight: 1,
    color: props.on ? '#fff' : 'transparent',
    background: props.on ? 'var(--accent)' : 'transparent',
    border: '1px solid ' + (props.on ? 'var(--accent)' : 'var(--ui-line)'),
    transition: 'background .16s ease, border-color .16s ease'
  };
  return (
    <button type="button" role="switch" aria-checked={props.on} aria-label={props.label}
      data-k={'sw-' + props.k} disabled={props.disabled}
      className={'set-row tt-sw-row' + (props.disabled ? ' disabled' : '')}
      onClick={() => props.onChange(!props.on)}>
      <span className="set-row-main">
        <span className="set-row-t">{props.label}</span>
        <span className="set-row-d">{props.desc}</span>
      </span>
      <span aria-hidden style={box}>{props.on ? '✓' : ''}</span>
    </button>
  );
}

/**
 * 课表设置：和课表有关的功能都收在这一处，免得满屏都是开关。
 * 提醒三项由 nativeReminders 的排程读取同一批 cfg 字段，这里切完顺手让排程立刻重算。
 */
function TtSettings(props: { onClose: () => void; dragOn: boolean; onDrag: (on: boolean) => void }) {
  const notifOn = !!cfg.classNotif;
  const remind = (patch: { classNotif?: boolean; classLead30?: boolean; classLead10?: boolean; classMerge?: boolean }, msg: string) => {
    // saveConfig 会同步把 patch 并进 cfg，紧接着重排就能读到新开关；
    // 已经排进系统的通知必须立刻撤掉，否则关掉提醒后它还会照常响。
    void saveConfig(patch);
    rescheduleNativeReminders(400);
    toast(msg, 'ok');
  };
  const groupTitle: React.CSSProperties = {
    fontSize: 'var(--fs-cap)', fontWeight: 600, margin: '0 0 6px 2px'
  };
  return (
    <SubPage title={t('课表设置')} onBack={props.onClose}
      right={<button className="btn btn-sm btn-primary" onClick={props.onClose}>{t('完成')}</button>}>
      <div className="muted" style={groupTitle}>{t('🔔 上课提醒')}</div>
      <div className="card set-list">
        <TtSwitch k="classNotif" label={t('上课提醒')} on={notifOn}
          desc={t('快上课时提醒你出门、进教室。关掉后课表不再提醒（待办、习惯的提醒不受影响）。')}
          onChange={(v) => remind({ classNotif: v }, v ? t('已开启上课提醒') : t('已关闭上课提醒'))} />
        {!notifOn && <div className="tt-set-tip">{t('总开关关着，下面三项先灰掉；打开「上课提醒」就能单独调。')}</div>}
        <TtSwitch k="classLead30" label={t('提前 30 分钟')} on={!!cfg.classLead30} disabled={!notifOn}
          desc={t('离上课还有半小时就提醒一次，适合要从宿舍或家里出发的早八。')}
          onChange={(v) => remind({ classLead30: v }, v ? t('已开启提前 30 分钟提醒') : t('已关闭提前 30 分钟提醒'))} />
        <TtSwitch k="classLead10" label={t('提前 10 分钟')} on={!!cfg.classLead10} disabled={!notifOn}
          desc={t('快到教学楼时再提醒一次，临时换教室也来得及。')}
          onChange={(v) => remind({ classLead10: v }, v ? t('已开启提前 10 分钟提醒') : t('已关闭提前 10 分钟提醒'))} />
        <TtSwitch k="classMerge" label={t('连堂课只在课间提醒一次')} on={!!cfg.classMerge} disabled={!notifOn}
          desc={t('上午四节连着上时，只在你走进教室前提醒一次；课间只提醒下一节，不会每节课前都响。')}
          onChange={(v) => remind({ classMerge: v }, v ? t('连堂课合并提醒已开启') : t('连堂课每节都会提醒'))} />
      </div>

      <div className="muted" style={{ ...groupTitle, margin: '16px 0 6px 2px' }}>{t('🔒 防误改')}</div>
      <div className="card set-list">
        <TtSwitch k="ttLocked" label={t('锁定课表')} on={!!cfg.ttLocked}
          desc={t('锁定后不能拖动、加课、调课、删课，也不影响翻周看课。上课时开着，避免手滑改掉课表。')}
          onChange={(v) => {
            saveConfig({ ttLocked: v });
            toast(v ? t('课表已锁定，改动入口都禁用了') : t('课表已解锁，可以改了'), 'ok');
          }} />
        <TtSwitch k="ttDrag" label={t('长按拖动调课')} on={props.dragOn}
          desc={t('关掉后长按课程不会再把它拎起来（点开课程仍然可以调课、停课）。经常误拖的人可以关掉。')}
          onChange={props.onDrag} />
      </div>

      <div className="muted" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.7 }}>
        {t('提醒真正响不响还取决于系统的通知权限；这里只决定「要不要提醒」和「提醒几次」。')}
      </div>
    </SubPage>
  );
}

/* --------------------------- 选周次 / 固定周 --------------------------- */
/**
 * 顶部「第 N 周 · 跟随今天」点开就是这里：
 * 选任意一周固定住，或者解除固定回到跟着今天走；周次对不上还能就地对齐。
 */
function WeekPicker(props: {
  current: number | 'all'; thisWeek: number; maxWeek: number; fixed: boolean;
  onPick: (n: number) => void; onFollow: () => void; onCalibrate: (n: number) => void; onClose: () => void;
}) {
  const [n, setN] = useState<number>(typeof props.current === 'number' ? props.current : (props.thisWeek || 1));
  const clamp = (v: number) => Math.max(1, Math.min(props.maxWeek, Math.round(v) || 1));
  const cur = clamp(n);
  return (
    <Modal title={t('选周次')} onClose={props.onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={props.onClose}>{t('取消')}</button>
        <button className="btn btn-primary" data-k="wk-apply" onClick={() => props.onPick(cur)}>
          {cur === props.thisWeek ? t('回到本周（跟随日期）') : t('固定在第 {n} 周', { n: cur })}
        </button>
      </>}>
      <div className="tt-wk-now">
        {props.thisWeek > 0
          ? <>{t('今天是')}<b>{t('第 {n} 周', { n: props.thisWeek })}</b>{t('；现在看的是')}<b>{typeof props.current === 'number' ? t('第 {n} 周', { n: props.current }) : t('全部周次')}</b>{props.fixed ? t('（已固定）') : t('（跟着今天走）')}</>
          : <>{t('还没设开学日期。先选一周固定看，或者关掉这个框点「校正周次」把本周对一下。')}</>}
      </div>

      <div className="tt-wk-pick">
        <button className="btn btn-sm" onClick={() => setN(clamp(cur - 1))} aria-label={t('上一周')}>−</button>
        <input className="input" type="number" min={1} max={props.maxWeek} step={1} value={String(cur)}
          style={{ width: 88, textAlign: 'center' }}
          onChange={(e) => setN(clamp(Number(e.target.value)))} />
        <span className="muted">{t('周')}</span>
        <button className="btn btn-sm" onClick={() => setN(clamp(cur + 1))} aria-label={t('下一周')}>＋</button>
        <div className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => setN(clamp(props.thisWeek || 1))}>{t('回到本周')}</button>
      </div>

      <div className="week-row tt-wk-chips">
        {Array.from({ length: props.maxWeek }, (_, i) => i + 1).map((v) => (
          <button key={v} className={'chip' + (v === cur ? ' on' : '') + (v === props.thisWeek ? ' now' : '')}
            onClick={() => setN(v)}>{t('第 {n} 周', { n: v })}</button>
        ))}
      </div>

      <div className="muted tt-wk-explain">
        {t('固定之后，每次打开课表都停在这一周，不会跟着日期往后跑；想恢复「跟着今天走」，点下面那颗按钮。')}
      </div>

      <div className="tt-wk-calib">
        <div>
          <b>{t('周次对不上？')}</b>
          <div className="muted" style={{ marginTop: 2 }}>
            {t('如果教务系统上本周其实是另一个周次，点右边按「第 {n} 周」重新对齐开学日期，之后每周照常往前推。', { n: cur })}
          </div>
        </div>
        <button className="btn btn-sm" data-k="wk-calibrate" onClick={() => props.onCalibrate(cur)}>{t('把这一周设为本周')}</button>
      </div>

      <div className="row-wrap mt12">
        <button className="btn btn-sm btn-ghost" data-k="wk-follow" onClick={props.onFollow}>{t('解除固定，跟着今天走')}</button>
      </div>
    </Modal>
  );
}

