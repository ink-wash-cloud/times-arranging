// AI 识别：把"一坨乱的课表信息"变成结构化课程，然后自动填进课表
//
// 走的是 OpenAI 兼容的 /chat/completions 接口，所以 DeepSeek、通义、Kimi、智谱、
// 本地 Ollama / LM Studio 都能直接用——只要填对地址和模型名。
// 没配置接口时不让功能空转：文本和表格走本地规则解析，图片则明确告诉用户
// "图片识别需要模型"，而不是假装能识别。
import { metaGet, metaSet } from './idb';
import { t } from './i18n';
import { parseAny, parseGridCourses, parseWeekday, DEFAULT_PERIODS } from './timetable';
import { COURSE_PALETTE } from '../types';
import type { ParsedCourse } from './timetable';

export interface AiConfig {
  baseUrl: string;   // 例如 https://api.deepseek.com/v1
  apiKey: string;
  model: string;     // 例如 deepseek-chat / gpt-4o-mini / qwen2.5vl
}

export const ai: AiConfig = { baseUrl: '', apiKey: '', model: '' };

let loaded = false;

export async function loadAiConfig(): Promise<void> {
  ai.baseUrl = await metaGet('aiBaseUrl', '');
  ai.apiKey = await metaGet('aiApiKey', '');
  ai.model = await metaGet('aiModel', '');
  loaded = true;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await loadAiConfig();
}

export async function saveAiConfig(patch: Partial<AiConfig>): Promise<void> {
  Object.assign(ai, patch);
  if ('baseUrl' in patch) await metaSet('aiBaseUrl', ai.baseUrl.trim());
  if ('apiKey' in patch) await metaSet('aiApiKey', ai.apiKey.trim());
  if ('model' in patch) await metaSet('aiModel', ai.model.trim());
}

/** 配好了才走 AI，否则退回本地解析 */
export function aiReady(): boolean {
  return !!(ai.baseUrl.trim() && ai.model.trim());
}

/** 当前模型能不能看图（按模型名猜，猜错只是提示，不影响调用） */
export function looksVisionCapable(): boolean {
  return /vl|vision|gpt-4o|gpt-4\.1|gemini|claude|qwen-?vl|internvl|glm-4v|yi-vision/i.test(ai.model);
}

/* ------------------------------- 调用接口 ------------------------------- */

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface ChatMessage {
  role: 'system' | 'user';
  content: string | ContentPart[];
}

/** 兼容各种写法：有的服务商要 /v1/chat/completions，有的地址里已经带了 /v1 */
function endpoint(): string {
  const b = ai.baseUrl.trim().replace(/\/+$/, '');
  return /\/v\d+$/.test(b) ? b + '/chat/completions' : b + '/v1/chat/completions';
}

async function chat(messages: ChatMessage[], maxTokens = 4000): Promise<string> {
  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ai.apiKey.trim() ? { Authorization: 'Bearer ' + ai.apiKey.trim() } : {})
    },
    body: JSON.stringify({
      model: ai.model.trim(),
      messages,
      temperature: 0,
      max_tokens: maxTokens
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body
      ? t('接口返回 HTTP {status}：{body}', { status: res.status, body: body.slice(0, 200) })
      : t('接口返回 HTTP {status}', { status: res.status }));
  }
  const j = await res.json().catch(() => null) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error(t('接口没有返回内容'));
  return content;
}

/** 探活：随便问一句，确认地址/密钥/模型都对 */
export async function testAiConnection(): Promise<string> {
  await ensureLoaded();
  if (!aiReady()) throw new Error(t('还没填接口地址和模型名'));
  const reply = await chat([{ role: 'user', content: '回复两个字：可用' }], 20);
  return reply.trim().slice(0, 40);
}

/* ------------------------------- 提示词 ------------------------------- */

const SYSTEM = [
  '你是一个课表结构化助手。用户会给你大学课表的信息，可能来自教务系统复制的乱文本、',
  'Excel/CSV 表格、聊天记录，或者一张课表截图。你要把它解析成结构化数据。',
  '',
  '输出要求：只输出一个 JSON 对象，不要解释、不要 Markdown 代码块。格式：',
  '{',
  '  "courses": [',
  '    { "name": "高等数学A", "teacher": "张建国", "location": "教三201", "className": "计科2101",',
  '      "day": 1, "startTime": "08:00", "endTime": "09:40",',
  '      "startWeek": 1, "endWeek": 16, "parity": "all", "note": "" }',
  '  ],',
  '  "termStart": "2026-02-23",',
  '  "periods": [["08:00","08:45"], ["08:55","09:40"]]',
  '}',
  '',
  '字段说明：',
  '- className：班级 / 教学班。原文里写了就照抄（例如"计科2101""计算机2101班"），没有就给空串。',
  '- startTime/endTime：HH:MM。原文写"第3-4节"这类节次时，按下面给出的节次表换算。',
  '- startWeek/endWeek：整数周次。原文只有"1-16周"就填 1 和 16；完全没提就填 1 和 16。',
  '- parity："all" 每周 / "odd" 单周 / "even" 双周。',
  '- termStart：只有原文明确写了开学日期或第 1 周日期时才填，否则省略这个字段。',
  '- periods：只有原文明确给出作息时间表时才填，否则省略。',
  '',
  '注意：同一门课出现在多个星期或多个节次，要拆成多条记录，不要合并。',
  '课程名里不要带教师名和地点。'
].join('\n');

function periodTable(periods: Array<[string, string]>): string {
  return periods.map((p, i) => '  第 ' + (i + 1) + ' 节：' + p[0] + '-' + p[1]).join('\n');
}

/* ------------------------------- 结果解析 ------------------------------- */

// 反引号在源码里太容易被转义搞坏，用 charCode 拼出来
const FENCE = String.fromCharCode(96).repeat(3);

function extractJson(text: string): unknown {
  let s = text.trim();
  // 模型经常忍不住套一层代码围栏
  s = s.replace(new RegExp('^' + FENCE + '(?:json)?\s*', 'i'), '');
  s = s.replace(new RegExp(FENCE + '\s*$'), '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function int(v: unknown, def: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? '').replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(n) ? n : def;
}

function hhmm(v: unknown): string {
  const m = str(v).match(/(\d{1,2})\s*[:：.时]\s*(\d{1,2})?/);
  if (!m) return '';
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const mi = m[2] ? Math.min(59, Math.max(0, parseInt(m[2], 10))) : 0;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}

/** 把模型返回的一条记录规整成课程；缺关键字段就返回 null */
function toCourse(o: unknown, periods: Array<[string, string]>, index: number): ParsedCourse | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const name = str(r.name || r.title || r.course);
  if (!name) return null;

  // 星期：可能是 1-7，也可能被写成"周一"/"星期一"
  let day = 0;
  if (typeof r.day === 'number' || /^\d+$/.test(str(r.day))) day = int(r.day, 0);
  else day = parseWeekday(str(r.day || r.weekday));
  if (day < 1 || day > 7) return null;

  // 时间：优先用明确的起止时间；否则用节次换算
  let start = hhmm(r.startTime || r.start);
  let end = hhmm(r.endTime || r.end);
  const sp = int(r.startPeriod ?? r.startSection ?? 0, 0);
  const ep = int(r.endPeriod ?? r.endSection ?? 0, 0);
  if ((!start || !end) && sp >= 1 && sp <= periods.length) {
    start = start || periods[sp - 1][0];
    end = end || periods[Math.min(periods.length, ep || sp) - 1][1];
  }
  if (!start || !end) return null;

  const parityRaw = str(r.parity || r.weekType).toLowerCase();
  const parity: 'all' | 'odd' | 'even' =
    /odd|单/.test(parityRaw) ? 'odd' : /even|双/.test(parityRaw) ? 'even' : 'all';

  const sw = Math.max(1, int(r.startWeek, 1));
  const ew = Math.max(sw, int(r.endWeek, 16));

  return {
    name,
    teacher: str(r.teacher),
    location: str(r.location || r.room || r.place),
    className: str(r.className || r.class || r.klass),
    weekday: day,
    startTime: start,
    endTime: end,
    startWeek: sw,
    endWeek: ew,
    weekParity: parity,
    color: COURSE_PALETTE[index % COURSE_PALETTE.length],
    note: str(r.note)
  };
}

/* ------------------------------- 对外入口 ------------------------------- */

export interface AnalyzeInput {
  text?: string;
  rows?: string[][];
  image?: string;                              // dataURL
  periods?: Array<[string, string]>;
}

export interface AnalyzeResult {
  courses: ParsedCourse[];
  termStart?: string;
  source: 'ai' | 'local';
  note: string;
}

/** 表格转成给模型看的文本；带 | 分隔更利于它理解列含义 */
function rowsToText(rows: string[][]): string {
  return rows
    .filter((r) => r.some((c) => String(c).trim()))
    .map((r) => r.map((c) => String(c).replace(/\s+/g, ' ').trim()).join(' | '))
    .join('\n');
}

/** 本地兜底：就是原来那套规则解析器，不联网也能用 */
function localAnalyze(input: AnalyzeInput, periods: Array<[string, string]>): AnalyzeResult {
  let courses: ParsedCourse[] = [];
  if (input.rows && input.rows.length) {
    courses = parseGridCourses(input.rows, periods).courses;
    if (!courses.length) courses = parseAny(rowsToText(input.rows), periods).courses;
  } else if (input.text) {
    courses = parseAny(input.text, periods).courses;
  }
  return {
    courses,
    source: 'local',
    note: t('本地规则解析：{n} 门（配置 AI 接口后，潦草的文本和课表截图也能认）', { n: courses.length })
  };
}

export async function analyzeTimetable(input: AnalyzeInput): Promise<AnalyzeResult> {
  await ensureLoaded();
  const periods = input.periods && input.periods.length ? input.periods : DEFAULT_PERIODS;
  const hasImage = !!input.image;

  if (!aiReady()) {
    if (hasImage) {
      throw new Error(t('图片识别需要先配置 AI 接口（设置与同步 → AI 识别），本地解析读不了图片'));
    }
    return localAnalyze(input, periods);
  }

  const parts: ContentPart[] = [];
  const lines: string[] = [];
  lines.push('节次时间对照表（用来把"第N节"换算成具体时间）：');
  lines.push(periodTable(periods));
  lines.push('');
  if (input.text && input.text.trim()) {
    lines.push('课表文本：');
    lines.push(input.text.trim().slice(0, 20000));
  }
  if (input.rows && input.rows.length) {
    lines.push('课表表格（每行用 | 分隔，第一行可能是表头）：');
    lines.push(rowsToText(input.rows).slice(0, 20000));
  }
  if (!lines.length && !hasImage) throw new Error(t('没有可识别的内容'));

  parts.push({ type: 'text', text: lines.join('\n') });
  if (hasImage) parts.push({ type: 'image_url', image_url: { url: input.image as string } });

  let raw = '';
  try {
    raw = await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: parts }]);
  } catch (e) {
    // 接口挂了不能让用户白忙一场：文本/表格还能退回本地解析
    if (!hasImage) {
      const fb = localAnalyze(input, periods);
      fb.note = t('AI 调用失败（{msg}），已改用本地规则解析出 {n} 门', { msg: String((e as Error).message || e), n: fb.courses.length });
      return fb;
    }
    throw e;
  }

  let data: unknown;
  try {
    data = extractJson(raw);
  } catch {
    throw new Error(t('AI 返回的不是合法 JSON，可以重试一次或换个模型'));
  }

  const obj = (data && typeof data === 'object' && !Array.isArray(data)) ? data as Record<string, unknown> : null;
  const list = Array.isArray(data) ? data : (obj && Array.isArray(obj.courses) ? obj.courses : []);
  const courses = list
    .map((o, i) => toCourse(o, periods, i))
    .filter((c): c is ParsedCourse => !!c);

  if (!courses.length) throw new Error(t('AI 没解析出任何课程，可以检查原图是否清晰，或换一个模型'));

  const res: AnalyzeResult = {
    courses,
    source: 'ai',
    note: t('AI 识别：{n} 门{skipped}', {
      n: courses.length,
      skipped: list.length > courses.length ? t('（另有 {k} 条缺少星期/时间被跳过）', { k: list.length - courses.length }) : ''
    })
  };
  const ts = obj ? str(obj.termStart) : '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(ts)) res.termStart = ts;
  return res;
}
