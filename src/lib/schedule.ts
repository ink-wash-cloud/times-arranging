// 日程表：纯计算工具（时间、布局、课表叠加、导出）。
// 这里不放 React；页面只负责渲染与交互，所有可测的规则尽量落在这里。
import type { CourseChangeData, CourseData, ScheduleBlockData } from '../types';
import { COURSE_PALETTE } from '../types';
import type { Item } from './db';
import { pad2, timeToMinutes } from './date';
import { t } from './i18n';
import { coursesOnDateX, currentWeek } from './logic';

export const SECONDS_PER_DAY = 86400;

/** 把秒数限制在 [min,max] */
export function clampNum(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** 09:40:30；24:00:00 也合法（表示一天结束） */
export function fmtHMS(sec: number): string {
  const total = clampNum(Math.round(Number(sec) || 0), 0, SECONDS_PER_DAY);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

/** 时间轴刻度：HH:MM，秒档才显示秒 */
export function fmtAxis(sec: number, withSeconds = false): string {
  const total = clampNum(Math.round(Number(sec) || 0), 0, SECONDS_PER_DAY);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return pad2(h) + ':' + pad2(m) + (withSeconds ? ':' + pad2(s) : '');
}

/** 解析 HH:MM 或 HH:MM:SS，返回当天秒数；非法返回 null。支持 9:40。 */
export function parseHMS(raw: string): number | null {
  const text = String(raw || '').trim();
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = m[3] === undefined ? 0 : Number(m[3]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  if (h > 24 || min > 59 || sec > 59) return null;
  if (h === 24 && (min || sec)) return null;
  return h * 3600 + min * 60 + sec;
}

/** 时长对人类友好：40 分 0 秒 / 4 小时 12 分 37 秒 / 12 秒 */
export function fmtDuration(sec: number): string {
  const total = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return t('{h} 小时 {m} 分 {s} 秒', { h, m, s });
  if (m > 0) return t('{m} 分 {s} 秒', { m, s });
  return t('{s} 秒', { s });
}

/** 导出用：00:40:00 */
export function fmtDurationClock(sec: number): string {
  const total = Math.max(0, Math.round(Number(sec) || 0));
  return pad2(Math.floor(total / 3600)) + ':' + pad2(Math.floor((total % 3600) / 60)) + ':' + pad2(total % 60);
}

/** 按当前缩放档吸附到最小刻度 */
export function snapSeconds(sec: number, step: number): number {
  const s = Math.max(1, Math.round(step) || 1);
  return clampNum(Math.round(sec / s) * s, 0, SECONDS_PER_DAY);
}

export interface LayoutInput {
  id: string;
  start: number;
  end: number;
}

export interface PlacedBlock<T extends LayoutInput> extends LayoutInput {
  col: number;
  cols: number;
  stack: number;
  source: T;
}

/**
 * 重叠的日程自动分列：重叠簇内按列排，最多显示 3 列；
 * 第 4 列起轻微错位叠放（stack），避免完全盖住。
 * 首尾相接（9:00-10:00 和 10:00-11:00）不算重叠。
 */
export function layoutBlocks<T extends LayoutInput>(items: T[]): PlacedBlock<T>[] {
  const sorted = items.slice().sort((a, b) => (
    a.start - b.start || b.end - a.end || String(a.id).localeCompare(String(b.id))
  ));
  const out: PlacedBlock<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const active: Array<{ col: number; end: number }> = [];
    const recs: Array<{ item: T; col: number }> = [];
    for (const it of cluster) {
      for (let i = active.length - 1; i >= 0; i--) {
        if (active[i].end <= it.start) active.splice(i, 1);
      }
      let col = 0;
      while (active.some((a) => a.col === col)) col++;
      active.push({ col, end: it.end });
      recs.push({ item: it, col });
    }
    const maxCol = recs.reduce((m, r) => Math.max(m, r.col), 0);
    const cols = Math.min(3, maxCol + 1);
    for (const r of recs) {
      const visibleCol = Math.min(r.col, 2);
      out.push({
        ...r.item,
        col: visibleCol,
        cols,
        stack: Math.min(2, Math.max(0, r.col - 2)),
        source: r.item
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const it of sorted) {
    const end = Math.max(it.end, it.start + 1);
    if (!cluster.length || it.start >= clusterEnd) {
      flush();
      cluster = [it];
      clusterEnd = end;
    } else {
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, end);
    }
  }
  flush();
  return out;
}

/** 按背景色亮度决定块内文字用白还是深色 */
export function readableInk(hex: string): string {
  const raw = String(hex || '').replace('#', '');
  let value = raw;
  if (raw.length === 3) value = raw.split('').map((x) => x + x).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return '#ffffff';
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.62 ? '#17202b' : '#ffffff';
}

/** #rrggbb + 透明度 -> rgba()，用于课表叠加的淡底 */
export function rgba(hex: string, alpha: number): string {
  const raw = String(hex || '').replace('#', '');
  const value = raw.length === 3 ? raw.split('').map((x) => x + x).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return 'rgba(138,169,232,' + alpha + ')';
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/** 与课表页完全一致的周次判断：有精确 weeks 时以它为准 */
export function matchWeek(c: CourseData, week: number): boolean {
  if (!week) return true;
  if (c.weeks && c.weeks.length) return c.weeks.indexOf(week) >= 0;
  const start = Number(c.startWeek) || 1;
  const end = Number(c.endWeek) || 16;
  if (week < start || week > end) return false;
  if (c.weekParity === 'odd' && week % 2 === 0) return false;
  if (c.weekParity === 'even' && week % 2 === 1) return false;
  return true;
}

export interface CourseOverlay {
  id: string;
  date: string;
  name: string;
  start: number;
  end: number;
  color: string;
  location: string;
  teacher: string;
  note: string;
  week: number;
  changeKind: string;
}

function colorForCourse(c: CourseData): string {
  if (c.color) return c.color;
  let sum = 0;
  for (const ch of String(c.name || '')) sum += ch.charCodeAt(0);
  return COURSE_PALETTE[sum % COURSE_PALETTE.length] || COURSE_PALETTE[0];
}

/** 某天实际要上的课（含调课/停课），并按与课表页一致的周次规则过滤 */
export function courseSlotsForDate(
  courses: Item<CourseData>[],
  changes: Item<CourseChangeData>[],
  date: string,
  termStart: string
): CourseOverlay[] {
  const week = termStart ? (currentWeek(termStart, date) || 1) : 0;
  return coursesOnDateX(courses, changes, date, termStart)
    .filter((c) => c.change?.kind !== 'cancel' && matchWeek(c, week))
    .map((c) => {
      const start = Math.max(0, Math.min(86399, timeToMinutes(c.startTime || '08:00') * 60));
      let end = Math.max(0, Math.min(86400, timeToMinutes(c.endTime || '09:00') * 60));
      if (end <= start) end = Math.min(SECONDS_PER_DAY, start + 45 * 60);
      return {
        id: c.id,
        date,
        name: c.name,
        start,
        end,
        color: colorForCourse(c),
        location: c.location || '',
        teacher: c.teacher || '',
        note: c.note || '',
        week,
        changeKind: c.change?.kind || ''
      };
    })
    .sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
}

/** 从 date 起连续 n 天 */
export function dateRange(date: string, days: number): string[] {
  const out: string[] = [];
  const base = new Date(date + 'T00:00:00');
  if (Number.isNaN(base.getTime())) return [date];
  for (let i = 0; i < Math.max(1, days); i++) {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + i);
    out.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()));
  }
  return out;
}

type ExportBlock = ScheduleBlockData & { id?: string };

function csvCell(value: string | number): string {
  const s = String(value == null ? '' : value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function courseDescription(c: CourseOverlay): string {
  return [c.location, c.teacher, c.note].filter(Boolean).join(' · ');
}

/** CSV（带 BOM，Excel 打开中文不乱码） */
export function buildCsv(blocks: ExportBlock[], courses: CourseOverlay[], dates: string[]): string {
  const header = [t('日期'), t('开始'), t('结束'), t('时长'), t('标题'), t('分类'), t('备注'), t('完成'), t('来源')];
  const rows: string[][] = [];
  for (const date of dates) {
    for (const b of blocks.filter((x) => x.date === date).sort((a, b2) => a.start - b2.start)) {
      rows.push([
        date, fmtHMS(b.start), fmtHMS(b.end), fmtDurationClock(b.end - b.start),
        b.title, b.category || '', b.note || '', b.done ? t('是') : t('否'), t('日程')
      ]);
    }
    for (const c of courses.filter((x) => x.date === date)) {
      rows.push([
        date, fmtHMS(c.start), fmtHMS(c.end), fmtDurationClock(c.end - c.start),
        c.name, t('课程'), courseDescription(c), '', t('课表')
      ]);
    }
  }
  return '\ufeff' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function icsEscape(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function icsDateTime(date: string, sec: number): string {
  const dayOffset = Math.floor(sec / SECONDS_PER_DAY);
  const rem = sec - dayOffset * SECONDS_PER_DAY;
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + dayOffset);
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + 'T' +
    pad2(Math.floor(rem / 3600)) + pad2(Math.floor((rem % 3600) / 60)) + pad2(rem % 60);
}

function icsStamp(): string {
  const d = new Date();
  return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + 'T' +
    pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
}

function icsUid(id: string, date: string, start: number): string {
  return String(id).replace(/[^A-Za-z0-9_-]/g, '') + '-' + date.replace(/-/g, '') + '-' + start + '@shili';
}

/** ICS：时间用浮动本地时间（不加 Z），导入日历后就是当地的 09:40:30 */
export function buildIcs(blocks: ExportBlock[], courses: CourseOverlay[], dates: string[]): string {
  const stamp = icsStamp();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ShiLi//Schedule//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];
  for (const date of dates) {
    for (const b of blocks.filter((x) => x.date === date).sort((a, b2) => a.start - b2.start)) {
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + icsUid(b.id || 'block', date, b.start));
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART:' + icsDateTime(date, b.start));
      lines.push('DTEND:' + icsDateTime(date, b.end));
      lines.push('SUMMARY:' + icsEscape(b.title || t('未命名日程')));
      if (b.note) lines.push('DESCRIPTION:' + icsEscape(b.note));
      if (b.category) lines.push('CATEGORIES:' + icsEscape(b.category));
      if (b.done) lines.push('STATUS:COMPLETED');
      lines.push('END:VEVENT');
    }
    for (const c of courses.filter((x) => x.date === date)) {
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + icsUid('course-' + c.id, date, c.start));
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART:' + icsDateTime(date, c.start));
      lines.push('DTEND:' + icsDateTime(date, c.end));
      lines.push('SUMMARY:' + icsEscape(c.name));
      const desc = courseDescription(c);
      if (desc) lines.push('DESCRIPTION:' + icsEscape(desc));
      lines.push('CATEGORIES:' + icsEscape(t('课程')));
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** 当前页面某天的合计时长（只算个人日程） */
export function dayTotal(blocks: ScheduleBlockData[], date: string): number {
  return blocks.filter((b) => b.date === date).reduce((s, b) => s + Math.max(0, b.end - b.start), 0);
}
