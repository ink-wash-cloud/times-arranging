// 课表导入解析：兼容「文本粘贴 / CSV / Excel 网格」三种来源
import type { CourseData } from '../types';
import { COURSE_PALETTE } from '../types';
import { pad2 } from './date';
import { t } from './i18n';

export type ParsedCourse = Omit<CourseData, 'createdAt'>;

/** 默认节次时间表（可在导入面板中修改） */
export const DEFAULT_PERIODS: Array<[string, string]> = [
  ['08:00', '08:45'], ['08:55', '09:40'], ['10:00', '10:45'], ['10:55', '11:40'],
  ['14:00', '14:45'], ['14:55', '15:40'], ['16:00', '16:45'], ['16:55', '17:40'],
  ['19:00', '19:45'], ['19:55', '20:40'], ['20:50', '21:35'], ['21:40', '22:25']
];

export function periodsToText(p: Array<[string, string]>): string {
  return p.map((x, i) => (i + 1) + ' ' + x[0] + '-' + x[1]).join('\n');
}

export function parsePeriods(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const tt = line.trim();
    if (!tt) continue;
    const m = tt.match(/(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~—－至到]\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (m) out.push([pad2(+m[1]) + ':' + m[2], pad2(+m[3]) + ':' + m[4]]);
  }
  return out.length ? out : DEFAULT_PERIODS.slice();
}

const WD_MAP: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7
};
const WD_EN: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

export function parseWeekday(s: string): number {
  const m = String(s).match(/(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
  if (m) return WD_MAP[m[1]] || 0;
  const e = String(s).match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*/i);
  if (e) return WD_EN[e[1].toLowerCase()] || 0;
  return 0;
}

export interface WeekRange { startWeek: number; endWeek: number; parity: 'all' | 'odd' | 'even'; }

/**
 * 找出文本里的"周次"片段。
 *
 * 不能直接用 search/match —— 房间号后面经常紧跟一个"周"字，会被当成周次：
 *   高等数学A 张建国 教三201 周一 1-16周
 * 旧实现从 "201 周" 里认出 "01周"，于是周次变成 1-1，地点还被从中间切成 "201"。
 * 所以这里逐个候选匹配，并要求它前面不是数字或字母（也就是房间号的一部分）。
 */
export function weekMatch(src: string): { index: number; a: number; b: number } | null {
  const re = /(\d{1,2})\s*(?:[-~—－至到]\s*(\d{1,2}))?\s*周[单双]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const prev = m.index > 0 ? src[m.index - 1] : '';
    if (/[0-9A-Za-z]/.test(prev)) continue;   // 是房间号的一部分，不是周次
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    return { index: m.index, a, b };
  }
  return null;
}

export function parseWeeks(s: string): WeekRange {
  const src = String(s || '');
  let parity: 'all' | 'odd' | 'even' = 'all';
  if (/单周|奇数周/.test(src)) parity = 'odd';
  else if (/双周|偶数周/.test(src)) parity = 'even';
  const withZhou = weekMatch(src);
  if (withZhou) {
    const { a, b } = withZhou;
    return { startWeek: Math.min(a, b), endWeek: Math.max(a, b), parity };
  }
  const bare = src.match(/(?:^|\s)(\d{1,2})\s*[-~—－至到]\s*(\d{1,2})(?:\s|$)/);
  if (bare) {
    const a = +bare[1], b = +bare[2];
    return { startWeek: Math.min(a, b), endWeek: Math.max(a, b), parity };
  }
  return { startWeek: 1, endWeek: 16, parity };
}

const TIME_RE = /(\d{1,2})\s*[:：.]\s*(\d{2})\s*[-~—－至到]\s*(\d{1,2})\s*[:：.]\s*(\d{2})/;
const PERIOD_RE = /第?\s*(\d{1,2})\s*[-~—－至到]\s*(\d{1,2})\s*节|第\s*(\d{1,2})\s*节/;

function toHM(h: string, m: string): string { return pad2(Math.min(23, +h)) + ':' + m; }

function periodToTime(text: string, periods: Array<[string, string]>): { startTime: string; endTime: string } | null {
  const m = String(text).match(PERIOD_RE);
  if (!m) return null;
  const a = +(m[1] || m[3]);
  const b = +(m[2] || m[3]);
  const p1 = periods[a - 1];
  const p2 = periods[b - 1];
  if (!p1) return null;
  return { startTime: p1[0], endTime: (p2 || p1)[1] };
}

// 地点写法很杂，除了带"楼/室/馆"的，还有一大堆"教三201""主楼201""图书馆305"
// 这种"短中文 + 房间号"的写法——没有这些字眼，只能靠"末尾一串房间号"来认。
// 房间号要求 ≥2 位，免得把"大学英语2"这种带序号的课名误判成教室。
const LOC_RE = /(楼|室|馆|场|区|中心|实验|机房|阶梯|报告厅|^[A-Za-z]{0,4}\d{1,4}$|[A-Za-z]\d{2,}|^[\u4e00-\u9fa5]{1,3}[A-Za-z]?\d{2,4}$)/;
const TEACHER_RE = /(老师|教授|讲师|教师|导师)$/;

function classifyTokens(tokens: string[], acc: { location: string; teacher: string; nameExtra: string[] }) {
  for (const raw of tokens) {
    const tok = raw.trim().replace(/^[·・\-—,，;；]+|[·・\-—,，;；]+$/g, '');
    if (!tok) continue;
    if (TEACHER_RE.test(tok)) { acc.teacher = acc.teacher || tok; continue; }
    if (LOC_RE.test(tok) && tok.length <= 18) { acc.location = acc.location || tok; continue; }
    if (/^[\u4e00-\u9fa5]{2,4}$/.test(tok)) {
      if (!acc.teacher) { acc.teacher = tok; continue; }
      acc.nameExtra.push(tok); continue;
    }
    if (/^[\u4e00-\u9fa5A-Za-z0-9（）()\-·]{2,30}$/.test(tok)) { acc.nameExtra.push(tok); continue; }
  }
}

function colorFor(i: number): string { return COURSE_PALETTE[i % COURSE_PALETTE.length]; }

/* --------------------------- 1) 自由文本 / 粘贴 --------------------------- */
export function parseTextCourses(text: string, periods: Array<[string, string]> = DEFAULT_PERIODS) {
  const courses: ParsedCourse[] = [];
  const errors: string[] = [];
  let currentWeekday = 0;
  let currentClass = '';
  const lines = String(text || '').split(/\r?\n/);

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    // 纯星期行：作为后续课程的归属
    if (/^(周|星期|礼拜)\s*[一二三四五六日天1-7]\s*$/.test(line)) {
      currentWeekday = parseWeekday(line);
      continue;
    }
    // 纯"班级：xxx"行：这行之后的课都归这个班。
    // 全年段的课表经常是一段一个班，这样粘一次就能全认出来。
    const cm = line.match(/^(?:班级|班别|教学班|行政班)\s*[:：]?\s*(.+)$/);
    if (cm) { currentClass = cm[1].trim(); continue; }
    // 行首挂方括号的，也当成班级：[计科2101] 高等数学A ...
    let lineClass = '';
    const br = line.match(/^[\[【]([^\]】]{1,20})[\]】]\s*/);
    if (br && !/(周|星期|礼拜|节)/.test(br[1])) {
      lineClass = br[1].trim();
      line = line.slice(br[0].length);
    }
    if (/^(上午|下午|晚上|中午|备注|课程表|课表)\s*$/.test(line)) continue;

    const wd = parseWeekday(line) || currentWeekday;
    const timeM = line.match(TIME_RE);
    const perM = line.match(PERIOD_RE);
    const wk = parseWeeks(line);

    // 课程名 = 第一个标识符之前的文本
    const markers: number[] = [];
    const wdIdx = line.search(/(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/);
    if (wdIdx > 0) markers.push(wdIdx);
    if (timeM && timeM.index && timeM.index > 0) markers.push(timeM.index);
    if (perM && perM.index && perM.index > 0) markers.push(perM.index);
    // 必须用 weekMatch：直接用正则找"数字+周"会把「教三201 周一」里的 201 算进来，
    // 于是课程名被从房间号中间切断，地点也跟着错
    const wkm = weekMatch(line);
    if (wkm && wkm.index > 0) markers.push(wkm.index);
    const cut = markers.length ? Math.min.apply(null, markers) : line.length;

    let name = line.slice(0, cut).trim().replace(/^[·・\-—,，;；|]+|[·・\-—,，;；|]+$/g, '');
    let rest = line.slice(cut);

    // 若课程名里含分隔符，取第一段
    if (/[\s|,，;；]/.test(name)) {
      const parts = name.split(/[\s|,，;；]+/).filter(Boolean);
      name = parts.shift() || name;
      rest = parts.join(' ') + ' ' + rest;
    }

    rest = rest
      .replace(TIME_RE, ' ')
      .replace(/第?\s*\d{1,2}\s*[-~—－至到]\s*\d{1,2}\s*节/g, ' ')
      .replace(/第\s*\d{1,2}\s*节/g, ' ')
      .replace(/(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/g, ' ')
      .replace(/\d{1,2}\s*[-~—－至到]\s*\d{1,2}\s*周[单双]?/g, ' ')
      .replace(/\d{1,2}\s*[-~—－至到]\s*\d{1,2}/g, ' ')
      .replace(/\d{1,2}\s*周/g, ' ');

    const acc = { location: '', teacher: '', nameExtra: [] as string[] };
    classifyTokens(rest.split(/[\s|,，;；\t]+/), acc);
    if (acc.nameExtra.length && name.length < 4) name = (name + ' ' + acc.nameExtra.join(' ')).trim();

    let startTime = '08:00', endTime = '09:40';
    if (timeM) { startTime = toHM(timeM[1], timeM[2]); endTime = toHM(timeM[3], timeM[4]); }
    else if (perM) {
      const pt = periodToTime(line, periods);
      if (pt) { startTime = pt.startTime; endTime = pt.endTime; }
    }

    if (!name) { errors.push(t('无法识别课程名：{line}', { line: line.slice(0, 40) })); continue; }
    if (!wd) { errors.push(t('无法识别星期，已默认归入周一：{name}', { name })); }

    courses.push({
      name: name.slice(0, 40),
      teacher: acc.teacher,
      location: acc.location,
      className: lineClass || currentClass,
      weekday: wd || 1,
      startTime, endTime,
      startWeek: wk.startWeek, endWeek: wk.endWeek, weekParity: wk.parity,
      color: colorFor(courses.length),
      note: ''
    });
  }
  return { courses, errors };
}

/* -------------------------------- 2) CSV -------------------------------- */
const HEAD_KEYS: Array<[RegExp, string]> = [
  [/课程|科目|名称|教学班/, 'name'],
  [/教师|老师|任课/, 'teacher'],
  [/地点|教室|场地|上课地/, 'location'],
  [/星期|周几|weekday|周次|上课日/, 'weekday'],
  [/开始时间|起始|开始|start/i, 'startTime'],
  [/结束时间|截止|结束|end/i, 'endTime'],
  [/节次|节/, 'period'],
  [/周次|周数|起止周/, 'weeks'],
  [/班级|班别|教学班|行政班|class/i, 'className']
];

export function looksLikeCSV(text: string): boolean {
  const first = String(text).split(/\r?\n/)[0] || '';
  if (!/[,，\t;；]/.test(first)) return false;
  const hits = HEAD_KEYS.filter((k) => k[0].test(first)).length;
  return hits >= 2;
}

function splitCSVLine(line: string): string[] {
  // 支持双引号包裹
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; continue; }
    if (!inQ && /[,，\t;；]/.test(c)) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCSVCourses(text: string, periods: Array<[string, string]> = DEFAULT_PERIODS) {
  const courses: ParsedCourse[] = [];
  const errors: string[] = [];
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { courses, errors: [t('CSV 内容为空')] };

  const header = splitCSVLine(lines[0]);
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    for (const k of HEAD_KEYS) { if (k[0].test(h) && idx[k[1]] === undefined) { idx[k[1]] = i; return; } }
  });

  for (let r = 1; r < lines.length; r++) {
    const c = splitCSVLine(lines[r]);
    const get = (k: string) => (idx[k] !== undefined ? String(c[idx[k]] || '').trim() : '');
    const name = get('name') || c[0];
    if (!name) continue;
    const wd = parseWeekday(get('weekday')) || (idx.weekday !== undefined ? Number(get('weekday')) || 0 : 0);
    const wk = parseWeeks(get('weeks') + ' ' + get('weekday'));
    let startTime = get('startTime'), endTime = get('endTime');
    if (!TIME_RE.test(startTime + '-' + endTime)) {
      const pt = periodToTime(get('period') + ' ' + get('weekday'), periods) || periodToTime('第' + (get('period') || '1') + '节', periods);
      startTime = pt ? pt.startTime : '08:00';
      endTime = pt ? pt.endTime : '09:40';
    } else {
      const m = (startTime + '-' + endTime).match(TIME_RE)!;
      startTime = toHM(m[1], m[2]); endTime = toHM(m[3], m[4]);
    }
    courses.push({
      name, teacher: get('teacher'), location: get('location'),
      className: get('className'),
      weekday: wd || 1, startTime, endTime,
      startWeek: wk.startWeek, endWeek: wk.endWeek, weekParity: wk.parity,
      color: colorFor(courses.length), note: ''
    });
    if (!wd) errors.push(t('第 {row} 行未识别到星期，已归入周一：{name}', { row: r + 1, name }));
  }
  return { courses, errors };
}

/* --------------------------- 3) Excel / 表格网格 --------------------------- */
export function parseGridCourses(rows: string[][], periods: Array<[string, string]> = DEFAULT_PERIODS) {
  const courses: ParsedCourse[] = [];
  const errors: string[] = [];
  if (!rows || !rows.length) return { courses, errors: [t('表格为空')] };

  // 定位表头行（含 >=3 个星期列）
  let headRow = -1;
  const colWeekday: Record<number, number> = {};
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const map: Record<number, number> = {};
    (rows[r] || []).forEach((cell, ci) => {
      const w = parseWeekday(String(cell || ''));
      if (w) map[ci] = w;
    });
    if (Object.keys(map).length >= 3) { headRow = r; Object.assign(colWeekday, map); break; }
  }
  if (headRow < 0) return { courses, errors: [t('未找到含「星期一…星期日」的表头行，请改用 CSV 或文本粘贴导入')] };

  const firstCol = Math.min.apply(null, Object.keys(colWeekday).map(Number));
  let seq = 0;

  for (let r = headRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    // 行首标记（节次 / 时间）合并判断
    const lead = row.slice(0, firstCol).map((x) => String(x || '')).join(' ').trim();
    let slot: { startTime: string; endTime: string } | null = periodToTime(lead, periods);
    if (!slot) {
      const tm = lead.match(TIME_RE);
      if (tm) slot = { startTime: toHM(tm[1], tm[2]), endTime: toHM(tm[3], tm[4]) };
    }
    const rowPeriodIndex = seq;
    seq++;

    for (const ciStr of Object.keys(colWeekday)) {
      const ci = Number(ciStr);
      const cellRaw = String(row[ci] === undefined || row[ci] === null ? '' : row[ci]).trim();
      if (!cellRaw) continue;
      const weekday = colWeekday[ci];
      const cellLines = cellRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

      let name = cellLines[0] || '';
      const restTokens: string[] = [];
      for (let i = 1; i < cellLines.length; i++) restTokens.push.apply(restTokens, cellLines[i].split(/[\s,，;；]+/));
      // 单元格里也可能一行写完
      if (cellLines.length === 1) {
        const parsed = parseTextCourses(cellRaw + ' 周' + '一二三四五六日'[weekday - 1], periods);
        if (parsed.courses.length) { courses.push(parsed.courses[0]); continue; }
      }

      const wkInfo = parseWeeks(cellRaw);
      const acc = { location: '', teacher: '', nameExtra: [] as string[] };
      classifyTokens(restTokens, acc);

      const slotFinal = slot || (function () {
        const p = periods[rowPeriodIndex];
        if (p) return { startTime: p[0], endTime: p[1] };
        return { startTime: '08:00', endTime: '09:40' };
      })();

      if (!name) { errors.push(t('第 {row} 行第 {col} 列内容无法识别', { row: r + 1, col: ci + 1 })); continue; }
      courses.push({
        name: name.replace(/\s+/g, ' ').slice(0, 40),
        teacher: acc.teacher, location: acc.location,
        weekday, startTime: slotFinal.startTime, endTime: slotFinal.endTime,
        startWeek: wkInfo.startWeek, endWeek: wkInfo.endWeek, weekParity: wkInfo.parity,
        color: colorFor(courses.length), note: ''
      });
    }
  }
  if (!courses.length) errors.push(t('表格解析结果为空，请检查表头是否包含星期列'));
  return { courses, errors };
}

/* ------------- 4) 按班分行的课表（教务系统导出的常见格式） ------------- */
//
// 这份格式和上面几种都不一样：
//   · 第 0 列是班级，一个班一行
//   · 表头是合并单元格的「星期一…星期日」，每个星期横跨若干列
//   · 列头是「0102 / 0304 / 0506 / 0708 / 0910」——两节小课合成一节大课
//   · 单元格里是换行分段的固定结构：课程名 / 教师 / 编号 (周次)(节次) / 地点
//   · 一门大课会横跨好几列、内容重复，要去重
// 所以周次和节次都以单元格里写的为准，列只用来判断星期几。

/** 形如 20102 (16-17周)(01-02节) 的行 */
const META_LINE = /^(\d{3,})?\s*[（(]([^)）]*周[^)）]*)[)）]\s*[（(]([^)）]*节[^)）]*)[)）]\s*$/;

/** 5-6,8-13周 → [5,6,8,9,10,11,12,13]；单双周在这里就过滤掉 */
export function parseWeekSet(text: string): number[] {
  const s = String(text || '');
  const parity = /单周|奇数周/.test(s) ? 'odd' : /双周|偶数周/.test(s) ? 'even' : 'all';
  const out = new Set<number>();
  const parts = s.replace(/周/g, ' ').replace(/[（()）,，、;；]/g, ' ').split(/\s+/).filter(Boolean);
  for (const part of parts) {
    const range = part.match(/^(\d{1,2})[-~—－至到](\d{1,2})$/);
    if (range) {
      const a = +range[1], b = +range[2];
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= 30) out.add(i);
      continue;
    }
    if (/^\d{1,2}$/.test(part)) { const v = +part; if (v >= 1 && v <= 30) out.add(v); }
  }
  let list = Array.from(out).sort((a, b) => a - b);
  if (parity === 'odd') list = list.filter((w) => w % 2 === 1);
  if (parity === 'even') list = list.filter((w) => w % 2 === 0);
  return list;
}

/** 01-02节 / 05-08节 → 具体起止时间。一节大课就是两节小课合起来的。 */
function periodRange(text: string, periods: Array<[string, string]>): { startTime: string; endTime: string } | null {
  const nums = String(text).match(/\d{1,2}/g);
  if (!nums || !nums.length) return null;
  const a = Math.max(1, Math.min(periods.length, +nums[0]));
  const b = Math.max(a, Math.min(periods.length, +nums[nums.length - 1]));
  const p1 = periods[a - 1], p2 = periods[b - 1];
  if (!p1 || !p2) return null;
  return { startTime: p1[0], endTime: p2[1] };
}

interface CellEntry {
  name: string; teacher: string; location: string;
  startTime: string; endTime: string;
  startWeek: number; endWeek: number; weekParity: 'all' | 'odd' | 'even';
  weeks: number[];
}

/** 把一个单元格拆成若干门课 */
function parseCellEntries(cell: string, periods: Array<[string, string]>): CellEntry[] {
  const out: CellEntry[] = [];
  const lines = String(cell || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return out;

  let headBuf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(META_LINE);
    if (!m) { headBuf.push(lines[i]); continue; }

    // 到 meta 行为止，缓冲里就是这门课的「课程名 / 教师」
    const name = (headBuf[0] || '').trim();
    const teacher = headBuf.length > 1 ? (headBuf[headBuf.length - 1] || '').trim() : '';
    headBuf = [];
    if (!name) continue;

    const weekText = m[2] || '';
    const slot = periodRange(m[3] || '', periods);
    if (!slot) continue;
    const weeks = parseWeekSet(weekText);
    if (!weeks.length) continue;

    // 紧跟 meta 的下一行是地点
    let location = '';
    const next = lines[i + 1];
    if (next && !META_LINE.test(next)) { location = next; i++; }

    out.push({
      name,
      teacher: /^[\u4e00-\u9fa5A-Za-z.·]{1,12}$/.test(teacher) ? teacher : '',
      location,
      startTime: slot.startTime, endTime: slot.endTime,
      startWeek: weeks[0], endWeek: weeks[weeks.length - 1],
      weekParity: /单周|奇数周/.test(weekText) ? 'odd' : /双周|偶数周/.test(weekText) ? 'even' : 'all',
      weeks
    });
  }
  return out;
}

export interface ClassSheetResult {
  courses: ParsedCourse[];
  errors: string[];
  /** 表格里出现的所有班级，按出现顺序 */
  classes: string[];
}

/** 解析「一班一行」的整院课表。认不出来就返回空，交给别的解析器。 */
export function parseClassRowSheet(rows: string[][], periods: Array<[string, string]> = DEFAULT_PERIODS): ClassSheetResult {
  const courses: ParsedCourse[] = [];
  const errors: string[] = [];
  const classes: string[] = [];
  if (!rows || rows.length < 3) return { courses, errors, classes };

  // 1) 找星期表头行（至少两个「星期X」）
  let headRow = -1;
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const hits = (rows[r] || []).filter((c) => /^(星期|周)[一二三四五六日天]$/.test(String(c).trim())).length;
    if (hits >= 2) { headRow = r; break; }
  }
  if (headRow < 0) return { courses, errors, classes };

  // 2) 合并单元格只在左上角有值，要向右填充，才知道每一列属于星期几
  const colDay = new Map<number, number>();
  let cur = 0;
  let width = 0;
  for (const r of rows) width = Math.max(width, (r || []).length);
  for (let c = 0; c < width; c++) {
    const cell = String((rows[headRow] || [])[c] || '').trim();
    const d = parseWeekday(cell);
    if (d) cur = d;
    else if (cell && /备注|说明|其他/.test(cell)) cur = 0;   // 备注列不算星期
    if (cur) colDay.set(c, cur);
  }
  if (!colDay.size) return { courses, errors, classes };

  // 3) 剩下的行：第 0 列是班级
  for (let r = headRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const klass = String(row[0] || '').trim();
    if (!klass || /^(星期|节次|备注|说明|课程)$/.test(klass)) continue;
    if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(klass)) continue;

    const seen = new Set<string>();
    let hit = 0;
    colDay.forEach((day, c) => {
      for (const e of parseCellEntries(String(row[c] || ''), periods)) {
        // 一门大课横跨多列、内容一模一样，按「星期+课名+周次+时间」去重
        const key = [day, e.name, e.teacher, e.startTime, e.endTime, e.weeks.join(',')].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        courses.push({
          name: e.name.slice(0, 40), teacher: e.teacher, location: e.location,
          className: klass, weekday: day,
          startTime: e.startTime, endTime: e.endTime,
          startWeek: e.startWeek, endWeek: e.endWeek, weekParity: e.weekParity,
          weeks: e.weeks,
          color: colorFor(courses.length), note: ''
        });
        hit++;
      }
    });
    if (hit) classes.push(klass);
  }

  if (classes.length) {
    errors.push(t('识别为「按班分行的整院课表」：共 {classCount} 个班、{courseCount} 条课程记录。可在预览里只留自己班。', { classCount: classes.length, courseCount: courses.length }));
  }
  return { courses, errors, classes };
}

/* ------------------------------ 统一入口 ------------------------------ */
export function parseAny(text: string, periods: Array<[string, string]> = DEFAULT_PERIODS) {
  if (looksLikeCSV(text)) return parseCSVCourses(text, periods);
  return parseTextCourses(text, periods);
}

/** 读取 xlsx / xls / csv 文件为二维数组 */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as unknown as string[][];
  return rows.map((r) => (r || []).map((c) => String(c === undefined || c === null ? '' : c)));
}
