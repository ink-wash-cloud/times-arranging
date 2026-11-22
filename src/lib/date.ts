// 日期工具：全项目统一使用本地时区的 YYYY-MM-DD 字符串
//
// 文案随界面语言变（getLang()）：中文用「10月5日 周一」，英文 "Oct 5, Mon"，
// 日文「10月5日（月）」。繁体单独写死一套（週一，不用字表转换——日期里全是短词，
// 明确写出来比猜字表更准）。
import { getLang } from './i18n';

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** 四语言取值器：简体 / 繁体 / 英文 / 日文，按当前界面语言挑一个 */
export function pick(zhHans: string, zhHant: string, en: string, ja: string): string {
  const l = getLang();
  if (l === 'en') return en;
  if (l === 'ja') return ja;
  if (l === 'zh-Hant') return zhHant;
  return zhHans;
}

export const ymd = (d: Date) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

export const todayStr = () => ymd(new Date());

export function parseYMD(s: string): Date {
  const p = String(s || '').split('-').map(Number);
  return new Date(p[0] || 1970, (p[1] || 1) - 1, p[2] || 1);
}

export function addDays(s: string, n: number): string {
  const d = parseYMD(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** b - a，单位天 */
export function diffDays(a: string, b: string): number {
  const ms = parseYMD(b).getTime() - parseYMD(a).getTime();
  return Math.round(ms / 86400000);
}

/** 距今天还有几天（正数=未来，0=今天，负数=已过） */
export const daysFromToday = (s: string) => diffDays(todayStr(), s);

export const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKDAY_TW = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 当前语言下的星期名 */
export function weekdayName(dow: number): string {
  const l = getLang();
  if (l === 'en') return WEEKDAY_EN[dow] || '';
  if (l === 'ja') return WEEKDAY_JA[dow] + '曜日';
  if (l === 'zh-Hant') return WEEKDAY_TW[dow] || '';
  return WEEKDAY_CN[dow] || '';
}

export const weekdayOf = (s: string) => parseYMD(s).getDay();

export const monthOf = (s: string) => String(s).slice(0, 7);
export const currentMonth = () => todayStr().slice(0, 7);

export function nowHM(): string {
  const d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** 今天已过去的比例 0-1，用于课表当前时间线 */
export function dayProgress(): number {
  const d = new Date();
  return (d.getHours() * 60 + d.getMinutes()) / 1440;
}

export function fmtCN(s: string): string {
  const d = parseYMD(s);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const w = d.getDay();
  return pick(
    m + '月' + day + '日 ' + WEEKDAY_CN[w],
    m + '月' + day + '日 ' + WEEKDAY_TW[w],
    MON_EN[d.getMonth()] + ' ' + day + ', ' + WEEKDAY_EN[w],
    m + '月' + day + '日（' + WEEKDAY_JA[w] + '）'
  );
}

/** 相对今天的口语化描述 */
export function relativeDay(s: string): string {
  const n = daysFromToday(s);
  if (n === 0) return pick('今天', '今天', 'Today', '今日');
  if (n === 1) return pick('明天', '明天', 'Tomorrow', '明日');
  if (n === 2) return pick('后天', '後天', 'In 2 days', '明後日');
  if (n === -1) return pick('昨天', '昨天', 'Yesterday', '昨日');
  if (n < 0) {
    const a = Math.abs(n);
    return pick('已逾期 ' + a + ' 天', '已逾期 ' + a + ' 天', a + 'd overdue', a + '日超過');
  }
  return pick(n + ' 天后', n + ' 天後', 'In ' + n + 'd', n + '日後');
}

/** 本周一 */
export function startOfWeekMonday(s?: string): string {
  const base = s || todayStr();
  const d = parseYMD(base);
  const w = d.getDay();            // 0=周日
  const back = w === 0 ? 6 : w - 1;
  return addDays(base, -back);
}

/** "刚刚 / N 分钟前 / 昨天 / 3 天前 / 5月8日" */
export function fromNow(ts: number, now = Date.now()): string {
  const d = Math.max(0, now - ts);
  if (d < 60_000) return pick('刚刚', '剛剛', 'Just now', 'たった今');
  if (d < 3_600_000) {
    const n = Math.floor(d / 60_000);
    return pick(n + ' 分钟前', n + ' 分鐘前', n + ' min ago', n + '分前');
  }
  if (d < 86_400_000) {
    const n = Math.floor(d / 3_600_000);
    return pick(n + ' 小时前', n + ' 小時前', n + 'h ago', n + '時間前');
  }
  const days = Math.floor(d / 86_400_000);
  if (days === 1) return pick('昨天', '昨天', 'Yesterday', '昨日');
  if (days < 7) return pick(days + ' 天前', days + ' 天前', days + 'd ago', days + '日前');
  const dt = new Date(ts);
  const m = dt.getMonth() + 1;
  const day = dt.getDate();
  const sameYear = dt.getFullYear() === new Date(now).getFullYear();
  return pick(
    (sameYear ? '' : dt.getFullYear() + '年') + m + '月' + day + '日',
    (sameYear ? '' : dt.getFullYear() + '年') + m + '月' + day + '日',
    (sameYear ? '' : dt.getFullYear() + ' ') + MON_EN[dt.getMonth()] + ' ' + day,
    (sameYear ? '' : dt.getFullYear() + '年') + m + '月' + day + '日'
  );
}

/** 完整时间，用于 title 悬浮提示 */
export function fullTime(ts: number): string {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

export function humanMinutes(min: number): string {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return pick(m + ' 分钟', m + ' 分鐘', m + ' min', m + '分');
  const h = Math.floor(m / 60), r = m % 60;
  if (r) return pick(h + ' 小时 ' + r + ' 分', h + ' 小時 ' + r + ' 分', h + 'h ' + r + 'm', h + '時間' + r + '分');
  return pick(h + ' 小时', h + ' 小時', h + 'h', h + '時間');
}

/** 某个日期的下一次发生（用于生日/纪念日/节日倒计时） */
export function nextOccurrence(dateStr: string, repeatYearly: boolean, from?: string): string {
  if (!repeatYearly) return dateStr;
  const today = from || todayStr();
  const d = parseYMD(dateStr);
  const cur = parseYMD(today);
  let cand = ymd(new Date(cur.getFullYear(), d.getMonth(), d.getDate()));
  // 2/29 落在平年时顺延到 3/1
  if (d.getMonth() === 1 && d.getDate() === 29 && parseYMD(cand).getMonth() !== 1) {
    cand = ymd(new Date(cur.getFullYear(), 2, 1));
  }
  if (diffDays(today, cand) < 0) {
    let nc = ymd(new Date(cur.getFullYear() + 1, d.getMonth(), d.getDate()));
    if (d.getMonth() === 1 && d.getDate() === 29 && parseYMD(nc).getMonth() !== 1) {
      nc = ymd(new Date(cur.getFullYear() + 1, 2, 1));
    }
    cand = nc;
  }
  return cand;
}

export function timeToMinutes(t: string): number {
  const p = String(t || '0:0').split(':').map(Number);
  return (p[0] || 0) * 60 + (p[1] || 0);
}

export function addMinutesToHM(t: string, delta: number): string {
  const total = timeToMinutes(t) + delta;
  const h = Math.floor(total / 60) % 24, m = ((total % 60) + 60) % 60;
  return pad2(h) + ':' + pad2(m);
}

/** 判断某周次是否为单/双周 */
export function parityOfWeek(w: number): 'odd' | 'even' {
  return w % 2 === 1 ? 'odd' : 'even';
}

/** 第 1 周周一为开学日，计算某天是第几教学周 */
export function weekIndexOf(termStart: string, date: string): number {
  return Math.floor(diffDays(termStart, date) / 7) + 1;
}