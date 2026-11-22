// 外观 / 背景自定义：模块级 store + CSS 变量下发（仅本机生效，不上传服务器）
import { useSyncExternalStore } from 'react';
import { metaGet, metaSet } from './idb';
import { applyFontMode } from './fonts';
import type { FontMode } from './fonts';
import { analyzeImage, analyzePixels, deriveStyle } from './bgStyle';
import type { BgStats, BgStyle } from './bgStyle';
import { clamp, composite, contrast, grayOfLum, mix, parseColor, relLum, triple } from './contrast';
import type { RGB } from './contrast';
import { defaultProfile, deriveLegibility, profileOfColor, profileOfColors } from './legibility';
import type { BgProfile, Legibility } from './legibility';
import { t } from './i18n';

export type { BgStyle } from './bgStyle';

export type PerfMode = 'ultra' | 'balanced' | 'quality';
/** 明暗基色：styles.css 只按 data-theme="ins" / not([data-theme="ins"]) 区分两套画风 */
export type BaseTheme = 'ins' | 'neon';
/** 整体风格：两档手选 + 随图生成 + 自定义 */
export type ThemeId = BaseTheme | 'auto' | 'custom';
export const THEME_IDS: ThemeId[] = ['ins', 'neon', 'auto', 'custom'];

/** 把任意风格落到明暗基色（auto/custom 的基色另外存在 Appearance.base 里） */
export function baseOfTheme(theme: ThemeId): BaseTheme {
  return theme === 'neon' ? 'neon' : 'ins';
}

/** 动效：full 始终开（默认，跟系统设置无关）/ auto 跟随系统 / calm 减弱 */
export type MotionMode = 'full' | 'auto' | 'calm';

/** 自定义各部分颜色，空串 = 交给算法自动 */
export interface CustomColors {
  accent: string;
  accent2: string;
  ink: string;
  pill: string;
}

export const EMPTY_COLORS: CustomColors = { accent: '', accent2: '', ink: '', pill: '' };

/**
 * 关掉「AI 自动配色」的那一刻，把 AI 刚算出来的这套值固化成快照。
 * 目的：开关一关界面完全不变，用户再接着拖通透度滑杆、改自定义颜色去微调，
 * 而不是眼睁睁看着按钮从冷色跳回暖色。
 * 快照只在「图没换、主题没换、自动配色没重新打开」时有效。
 */
export interface FrozenStyle {
  image: string;      // 这份快照是对哪张图算的（随图生成没图时为空串）
  theme: ThemeId;
  glassRgb: string;
  cardRgb: string;
  overlayRgb: string;
  washRgb: string;
  accent: string;
  accent2: string;
  /* 以下是「随图生成」快照的元信息；旧版快照没有这些字段也照样能用 */
  base?: BaseTheme;
  key?: string;       // 这张快照对应哪份背景（换图/换色/换强度就失效）
  tint?: number;      // 固化时 AI 建议的玻璃通透度 2..45
  dim?: number;       // 固化时 AI 建议的背景柔化 0..70
  lum?: number;
  p10?: number;
  p90?: number;
  warm?: number;
  avg?: [number, number, number];
}

export interface Appearance {
  theme: ThemeId;     // 整体风格：INS 奶油风 / 暮色霓虹 / 随图生成 / 自定义
  /** 明暗基色；theme 是 ins/neon 时与 theme 相同，auto/custom 时单独保留 */
  base: BaseTheme;
  font: FontMode;     // 字体：汉仪文黑 85W / 仅标题 / 系统默认
  mode: 'preset' | 'color' | 'image';
  preset: string;
  color: string;
  image: string;      // dataURL
  imageName: string;
  dim: number;        // 背景蒙版强度 0-70（INS 下是"柔化"，霓虹下是"压暗"）
  tint: number;       // 玻璃通透度 2-45
  glow: number;       // 晕光强度 0-180
  blobs: boolean;
  blobsMove: boolean;
  perf: PerfMode;
  fpsMeter: boolean;
  /** 设了自定义图片后，自动看图配玻璃的通透度和颜色（默认开） */
  autoStyle: boolean;
  /** 配色强度 0..1：按钮/强调色跟着背景色调走多远（0 = 完全用主题自带色） */
  styleStrength: number;
  /** 动效开关（默认始终开，不再被系统的"减少动画"一键灭掉） */
  motion: MotionMode;
  /** 打开后，下面四个颜色会盖过算法算出来的值 */
  customColors: boolean;
  colors: CustomColors;
  /** 关掉 AI 自动配色时保留下来的那份 AI 结果（用户可以在它基础上接着改） */
  frozen: FrozenStyle | null;
  /** 背景蒙层：那层让背景发白（INS）/ 发灰（霓虹）的"雾"。关掉就直接显示原图 */
  fog: boolean;
  /** 自定义：卡片明暗 0（全黑）.. 50（跟当前基色一样）.. 100（纯白） */
  cardShade: number;
  /** 自定义：圆角档位 0 小 / 1 中 / 2 大 */
  radius: 0 | 1 | 2;
}

export interface Preset { id: string; name: string; a: string; b: string; c: string; base: string; }

/** INS 风：奶油、蜜桃、雾霾蓝、抹茶、香芋、燕麦 */
export const INS_PRESETS: Preset[] = [
  { id: 'cream', name: '奶油', a: '#f8e0c8', b: '#f2cfda', c: '#d9d0f0', base: '#fbf5ee' },
  { id: 'peach', name: '蜜桃', a: '#ffd8c2', b: '#ffc4c0', c: '#f4d2e8', base: '#fff4ed' },
  { id: 'haze', name: '雾霾蓝', a: '#d3e3f6', b: '#c8dcf4', c: '#dbd6f2', base: '#f4f8fd' },
  { id: 'matcha', name: '抹茶', a: '#d7e9c8', b: '#c8e0bb', c: '#e0e9cf', base: '#f8fcf4' },
  { id: 'taro', name: '香芋', a: '#e0d0f2', b: '#cfbdea', c: '#ecd6ee', base: '#f9f5fd' },
  { id: 'oat', name: '燕麦', a: '#e9dcc7', b: '#dbcbb1', c: '#e6dbc6', base: '#fbf7f0' }
];

/** 霓虹风：极光、暮色、深海、森野、糖果、石墨 */
export const NEON_PRESETS: Preset[] = [
  { id: 'aurora', name: '极光', a: '#1b2a6b', b: '#5b2a86', c: '#0e7c86', base: '#0b0e18' },
  { id: 'sunset', name: '暮色', a: '#5b2145', b: '#8a3b1f', c: '#2a1740', base: '#0b0e18' },
  { id: 'ocean', name: '深海', a: '#0b2545', b: '#134e5e', c: '#0a1a2f', base: '#0b0e18' },
  { id: 'forest', name: '森野', a: '#14301f', b: '#1f4d3a', c: '#0d1f18', base: '#0b0e18' },
  { id: 'candy', name: '糖果', a: '#4a1f5e', b: '#8e2d6b', c: '#2b1a52', base: '#0b0e18' },
  { id: 'mono', name: '石墨', a: '#1a1c22', b: '#2b2f3a', c: '#101216', base: '#0b0e18' }
];

/** 兼容旧引用 */
export const PRESETS = INS_PRESETS;

/** 当前生效的明暗基色：auto/custom 没有固定主题，取状态里保存的 base */
let activeBase: BaseTheme = 'ins';

function presetsOf(base: BaseTheme): Preset[] {
  return base === 'neon' ? NEON_PRESETS : INS_PRESETS;
}

/** 当前实际明暗基色（auto/custom 用状态里保存的 base） */
function baseThemeOf(a: Appearance): BaseTheme {
  return a.base === 'neon' ? 'neon' : 'ins';
}

export function presetsFor(theme: ThemeId): Preset[] {
  // ins/neon 直接用自身；auto/custom 跟着当前基色走，这样面板里的预设列表不会空
  return presetsOf(theme === 'ins' || theme === 'neon' ? theme : activeBase);
}

export function presetById(id: string, theme: ThemeId = state.theme): Preset {
  const list = presetsFor(theme);
  return list.find((p) => p.id === id) || list[0];
}

const DEFAULTS: Appearance = {
  theme: 'ins', base: 'ins', font: 'hanyi', mode: 'preset', preset: 'cream', color: '#f7f2ee', image: '', imageName: '',
  dim: 16, tint: 20, glow: 100, blobs: true, blobsMove: false,
  perf: 'balanced', fpsMeter: false, autoStyle: true,
  styleStrength: 0.7, motion: 'full', customColors: false, colors: { ...EMPTY_COLORS },
  frozen: null, fog: true, cardShade: 50, radius: 1
};

/* ---------------------- 看图配色：当前这张图分析出来的结果 ---------------------- */
let bgStyle: BgStyle | null = null;
let bgStyleFor = '';      // 这份结果是对哪张图算的（换图就作废）
let bgStyleTheme: ThemeId | '' = '';

/** 这份分析结果现在还算数吗 */
function autoStyleActive(a: Appearance): boolean {
  return !!(a.autoStyle && a.mode === 'image' && a.image && bgStyle && bgStyleFor === a.image && bgStyleTheme === a.theme);
}

export function currentBgStyle(): BgStyle | null {
  return autoStyleActive(state) ? bgStyle : null;
}

/** 这份固化快照现在还算数吗（换图 / 换主题 / 重新打开自动配色都会作废） */
function frozenActive(a: Appearance): FrozenStyle | null {
  const f = a.frozen;
  if (!f) return null;
  // 旧版「关自动配色」的快照只服务 ins/neon；auto/custom 的冻结走 autoSnapActive
  if (a.theme !== 'ins' && a.theme !== 'neon') return null;
  if (a.autoStyle) return null;
  if (a.mode !== 'image' || !a.image) return null;
  if (f.image !== a.image || f.theme !== a.theme) return null;
  return f;
}

/** 当前生效的固化快照（面板上要提示"这套颜色来自 AI"） */
export function currentFrozen(): FrozenStyle | null {
  return frozenActive(state);
}

/** 「随图生成」当前这套快照：面板上要显示建议通透度、柔化与色板 */
export function currentAutoSnapshot(): FrozenStyle | null {
  return autoSnapActive(state);
}

/* ---------------- 随图生成：把当前背景分析成一份冻结快照 ---------------- */

/** 背景的指纹：换图 / 换色 / 换预设 / 换基色 / 改配色强度，快照就失效并重算 */
function autoKey(a: Appearance, base: BaseTheme): string {
  const raw = a.mode === 'image' ? a.image : a.mode === 'color' ? a.color : a.preset;
  return [a.mode, fingerprint(raw || ''), Math.round(clamp(a.styleStrength, 0, 1) * 100), base].join('|');
}

/**
 * 背景指纹（v1.6.3）：以前长图只取头 32 + 长度 + 尾 32，
 * 而所有 JPEG 的 dataURL 开头都是 data:image/jpeg;base64,/9j/4AAQSk... 一模一样，
 * 于是「换了一张图」只靠长度和结尾来判断，理论上两张同长度的图会判成同一张、不重算。
 * 现在整串走一遍 FNV-1a，任何一张不同的图都会得到不同的指纹。
 */
function fingerprint(raw: string): string {
  if (!raw) return '';
  if (raw.length <= 4000) return raw;
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return raw.slice(0, 24) + '|' + raw.length + '|' + h.toString(16);
}

/** 随图生成的快照现在还算数吗 */
function autoSnapActive(a: Appearance): FrozenStyle | null {
  const f = a.frozen;
  if (!f || a.theme !== 'auto' || f.theme !== 'auto' || !f.key) return null;
  if (f.base !== a.base) return null;
  if (f.key !== autoKey(a, a.base)) return null;
  return f;
}

/** 把分析结果拍成随图快照（选择「随图生成」时调用） */
function autoSnapshotOf(a: Appearance, s: BgStyle, base: BaseTheme, key: string): FrozenStyle {
  return {
    image: a.mode === 'image' ? a.image : '',
    theme: 'auto',
    base,
    key,
    tint: clamp(Math.round(s.tint), 2, 45),
    dim: clamp(Math.round(s.washAlpha * 100), 0, 70),
    glassRgb: s.glassRgb,
    cardRgb: s.cardRgb,
    overlayRgb: s.overlayRgb,
    washRgb: s.washRgb,
    accent: s.accent || '',
    accent2: s.accent2 || '',
    lum: s.lum,
    p10: typeof s.lumP10 === 'number' ? s.lumP10 : clamp(s.lum - 0.2, 0, 1),
    p90: typeof s.lumP90 === 'number' ? s.lumP90 : clamp(s.lum + 0.2, 0, 1),
    warm: typeof s.warm === 'number' ? s.warm : (s.avg[0] - s.avg[2]) / 255,
    avg: [s.avg[0], s.avg[1], s.avg[2]]
  };
}

/** 自动配色接管的那几个变量；关掉时要逐个摘掉，不能让上次的值黏在 :root 上 */
const AUTO_VARS = ['--glass-rgb', '--card-rgb', '--overlay-rgb', '--accent', '--accent-2', '--dim-rgb'];

function applyAutoVars(a: Appearance) {
  const r = document.documentElement;
  // 随图生成：整套颜色 + 建议通透度/柔化都来自冻结快照
  const snap = autoSnapActive(a);
  if (snap) {
    r.dataset.autostyle = '1';
    r.dataset.autofrozen = '1';
    if (typeof snap.tint === 'number') r.style.setProperty('--glass-tint', String(snap.tint / 100));
    if (typeof snap.dim === 'number') r.style.setProperty('--bd-dim', String(snap.dim / 100));
    r.style.setProperty('--glass-rgb', snap.glassRgb);
    r.style.setProperty('--card-rgb', snap.cardRgb);
    r.style.setProperty('--overlay-rgb', snap.overlayRgb);
    r.style.setProperty('--dim-rgb', snap.washRgb);
    if (snap.accent) {
      r.style.setProperty('--accent', snap.accent);
      r.style.setProperty('--accent-2', snap.accent2);
    } else {
      r.style.removeProperty('--accent');
      r.style.removeProperty('--accent-2');
    }
    return;
  }
  const s = autoStyleActive(a) ? bgStyle : null;
  const f = frozenActive(a);
  if (!s && f) {
    // 关掉自动配色了，但 AI 算出来的颜色留着（固化成快照）。
    // 只写颜色，不写 --glass-tint / --bd-dim —— 那两个交回给滑杆，
    // 否则用户想在这套配色上再调通透度就调不动了。
    r.dataset.autostyle = '0';
    r.dataset.autofrozen = '1';
    r.style.setProperty('--glass-rgb', f.glassRgb);
    r.style.setProperty('--card-rgb', f.cardRgb);
    r.style.setProperty('--overlay-rgb', f.overlayRgb);
    r.style.setProperty('--dim-rgb', f.washRgb);
    if (f.accent) {
      r.style.setProperty('--accent', f.accent);
      r.style.setProperty('--accent-2', f.accent2);
    } else {
      r.style.removeProperty('--accent');
      r.style.removeProperty('--accent-2');
    }
    return;
  }
  if (!s) {
    // 只摘"自动配色专属"的那几个。
    // --glass-tint / --bd-dim 不能摘：applyAppearance 刚按用户的滑杆写过它们，
    // 摘掉会回落到 CSS 默认值，滑杆就白拖了。
    for (const k of AUTO_VARS) r.style.removeProperty(k);
    r.dataset.autostyle = '0';
    r.dataset.autofrozen = '0';
    return;
  }
  r.dataset.autostyle = '1';
  r.dataset.autofrozen = '0';
  r.style.setProperty('--glass-tint', String(s.tint / 100));
  r.style.setProperty('--glass-rgb', s.glassRgb);
  r.style.setProperty('--card-rgb', s.cardRgb);
  r.style.setProperty('--overlay-rgb', s.overlayRgb);
  r.style.setProperty('--dim-rgb', s.washRgb);
  r.style.setProperty('--bd-dim', String(s.washAlpha));
  if (s.accent) {
    r.style.setProperty('--accent', s.accent);
    r.style.setProperty('--accent-2', s.accent2);
  } else {
    r.style.removeProperty('--accent');
    r.style.removeProperty('--accent-2');
  }
}

/* ---------------------- 可读性：算完再下发 ---------------------- */
// 用户的要求是"不管什么背景、什么画质档位，字都要看得清"。
// 做法：算出背景的亮度分布 → 让 legibility.ts 挑字色、必要时抬卡面、
// 把滑块推到"离卡面足够远"的地方。算出来的值全部落成 :root 上的变量，
// styles.css 只负责用它们（不再自己写死 rgba 数字），所以规则只改一处。

const THEME_ACCENT: Record<BaseTheme, [string, string]> = {
  ins: ['#e08fa4', '#b3a0dd'],
  neon: ['#7d9bff', '#b98cff']
};
const THEME_CARD_RGB: Record<BaseTheme, RGB> = { ins: [255, 255, 255], neon: [24, 29, 48] };
const THEME_GLASS_RGB: Record<BaseTheme, RGB> = { ins: [255, 255, 255], neon: [255, 255, 255] };

/** 自定义卡片明暗：0 全黑 → 50 当前基色 → 100 纯白 */
function cardRgbOf(base: BaseTheme, shade: number): string {
  const mid = THEME_CARD_RGB[base];
  const t = clamp(Number(shade) || 0, 0, 100) / 100;
  const c = t < 0.5 ? mix([0, 0, 0], mid, t / 0.5) : mix(mid, [255, 255, 255], (t - 0.5) / 0.5);
  return triple(c);
}

/** 自定义圆角档位：小 / 中 / 大，对应 --r-xs..--r-lg */
const RADIUS: Record<0 | 1 | 2, [number, number, number, number]> = {
  0: [7, 9, 12, 16],
  1: [9, 11, 16, 22],
  2: [12, 16, 22, 28]
};

function applyThemeVars(a: Appearance) {
  const r = document.documentElement;
  r.style.setProperty('--style-strength', String(clamp(Number(a.styleStrength) || 0, 0, 1)));
  if (a.theme === 'custom') {
    r.style.setProperty('--card-rgb', cardRgbOf(a.base, a.cardShade));
    const rr = RADIUS[a.radius] || RADIUS[1];
    r.style.setProperty('--r-xs', rr[0] + 'px');
    r.style.setProperty('--r-sm', rr[1] + 'px');
    r.style.setProperty('--r-md', rr[2] + 'px');
    r.style.setProperty('--r-lg', rr[3] + 'px');
  } else {
    // 交回 styles.css 的默认圆角，别把自定义的内联值黏在 :root 上
    for (const k of ['--r-xs', '--r-sm', '--r-md', '--r-lg']) r.style.removeProperty(k);
  }
}

/** 'r,g,b' → RGB */
function rgbOf(value: string, fallback: RGB): RGB {
  const parts = String(value || '').split(',').map((x) => Number(x.trim()));
  return parts.length === 3 && parts.every((n) => typeof n === 'number' && !isNaN(n))
    ? ([parts[0], parts[1], parts[2]] as RGB)
    : fallback;
}

/** 和 styles.css 的 --card-alpha 同一套公式（改一处记得改两处） */
export function cardAlphaOf(theme: BaseTheme, tint: number): number {
  return theme === 'ins' ? clamp(0.24 + tint * 2.85, 0.24, 0.9) : clamp(0.22 + tint * 2.6, 0.22, 0.86);
}

/** 当前真正生效的通透度（自动配色 / 随图快照会接管 tint） */
function tintOf(a: Appearance): number {
  const snap = autoSnapActive(a);
  if (snap && typeof snap.tint === 'number') return clamp(snap.tint / 100, 0, 0.6);
  const auto = autoStyleActive(a) ? bgStyle : null;
  return clamp((auto ? auto.tint : a.tint) / 100, 0, 0.6);
}

/** 背景的亮度画像：图片模式用实测分布，纯色/预设从颜色推 */
export function profileFor(a: Appearance = state): BgProfile {
  const snap = autoSnapActive(a);
  if (snap && typeof snap.lum === 'number') {
    return {
      lum: snap.lum,
      p10: typeof snap.p10 === 'number' ? snap.p10 : clamp(snap.lum - 0.2, 0, 1),
      p90: typeof snap.p90 === 'number' ? snap.p90 : clamp(snap.lum + 0.2, 0, 1),
      rgb: snap.avg ? [snap.avg[0], snap.avg[1], snap.avg[2]] : [128, 128, 128],
      warm: typeof snap.warm === 'number' ? snap.warm : 0
    };
  }
  if (a.mode === 'image' && bgStyle && bgStyleFor === a.image) {
    const b = bgStyle;
    return {
      lum: b.lum,
      p10: typeof b.lumP10 === 'number' ? b.lumP10 : clamp(b.lum - 0.2, 0, 1),
      p90: typeof b.lumP90 === 'number' ? b.lumP90 : clamp(b.lum + 0.2, 0, 1),
      rgb: [b.avg[0], b.avg[1], b.avg[2]],
      warm: typeof b.warm === 'number' ? b.warm : (b.avg[0] - b.avg[2]) / 255
    };
  }
  const base = baseThemeOf(a);
  if (a.mode === 'color') {
    const c = parseColor(a.color);
    return c ? profileOfColor(c) : defaultProfile(base);
  }
  const list = presetsOf(base);
  const p = list.find((x) => x.id === a.preset) || list[0];
  const cols = [p.a, p.b, p.c, p.base].map((x) => parseColor(x)).filter(Boolean) as RGB[];
  return cols.length ? profileOfColors(cols) : defaultProfile(base);
}

/** 当前实际的强调色：自定义 > 随图快照 > 看图配色 > 主题自带 */
export function accentFor(a: Appearance = state): { accent: RGB; accent2: RGB } {
  const snap = autoSnapActive(a);
  const auto = autoStyleActive(a) ? bgStyle : null;
  const fro = frozenActive(a);
  const c = a.theme === 'custom' || a.customColors ? a.colors : EMPTY_COLORS;
  const base = THEME_ACCENT[baseThemeOf(a)] || THEME_ACCENT.ins;
  const a1 = parseColor(c.accent) || parseColor((snap && snap.accent) || (auto && auto.accent) || (fro && fro.accent) || '') || parseColor(base[0]) || ([224, 143, 164] as RGB);
  const a2 = parseColor(c.accent2) || parseColor((snap && snap.accent2) || (auto && auto.accent2) || (fro && fro.accent2) || '') || parseColor(base[1]) || ([179, 160, 221] as RGB);
  return { accent: a1, accent2: a2 };
}

/**
 * 系统栏 / 底栏这类"玻璃面板"的最低不透明度。
 * 卡片有 --read-floor 兜底，但侧栏、顶栏、底部导栏用的是另一套填充，
 * 在很黑或很白的照片上照样会糊，所以单独给一个下限（最多 0.8，还能看见背景）。
 */
function panelFloorOf(theme: ThemeId, ink: RGB, bg: BgProfile, target = 3.0): number {
  const glass = THEME_GLASS_RGB[theme];
  const at = (alpha: number) => Math.min(
    contrast(ink, composite(glass, alpha, grayOfLum(bg.p10))),
    contrast(ink, composite(glass, alpha, grayOfLum(bg.p90)))
  );
  if (at(0.02) >= target) return 0;
  let alpha = 0.02;
  while (alpha < 0.8 && at(alpha) < target) alpha += 0.02;
  return Math.round(Math.min(alpha, 0.8) * 100) / 100;
}

let legibility: Legibility | null = null;
/** 最近一次算出来的可读性结果（面板上给读数、测试里核对） */
export function currentLegibility(): Legibility | null { return legibility; }

function applyLegibility(a: Appearance) {
  const r = document.documentElement;
  const base = baseThemeOf(a);
  const snap = autoSnapActive(a);
  const auto = autoStyleActive(a) ? bgStyle : null;
  const fro = frozenActive(a);
  const bg = profileFor(a);
  const cardRgb = snap
    ? rgbOf(snap.cardRgb, THEME_CARD_RGB[base])
    : auto
      ? rgbOf(auto.cardRgb, THEME_CARD_RGB[base])
      : fro
        ? rgbOf(fro.cardRgb, THEME_CARD_RGB[base])
        : a.theme === 'custom'
          ? rgbOf(cardRgbOf(base, a.cardShade), THEME_CARD_RGB[base])
          : THEME_CARD_RGB[base];
  const { accent, accent2 } = accentFor(a);
  const c = a.theme === 'custom' || a.customColors ? a.colors : EMPTY_COLORS;
  const leg = deriveLegibility({
    theme: base,
    bg,
    cardRgb,
    cardAlpha: cardAlphaOf(base, tintOf(a)),
    accent,
    accent2,
    inkOverride: parseColor(c.ink),
    pillOverride: parseColor(c.pill)
  });
  legibility = leg;
  const inkRgb = parseColor(leg.ink) || ([38, 32, 40] as RGB);
  r.style.setProperty('--text', leg.ink);
  r.style.setProperty('--dim', leg.dim);
  r.style.setProperty('--dim-2', leg.dim2);
  r.style.setProperty('--ink-halo', leg.halo);
  r.style.setProperty('--read-floor', String(leg.cardFloor));
  r.style.setProperty('--panel-floor', String(panelFloorOf(base, inkRgb, bg)));
  r.style.setProperty('--on-accent', leg.onAccent);
  r.style.setProperty('--accent-text', leg.accentText);
  r.style.setProperty('--pill-tab-a', leg.pillA);
  r.style.setProperty('--pill-tab-b', leg.pillB);
  r.style.setProperty('--pill-tab-ink', leg.pillInk);
  r.style.setProperty('--pill-tab-ring', leg.pillRing);
  r.dataset.ink = leg.dark ? 'dark' : 'light';
}

/** 自定义颜色：盖过自动配色（关了就把内联值撤掉，让上层规则重新生效） */
function applyCustomColors(a: Appearance) {
  const r = document.documentElement;
  // 「自定义」这档本身就是让用户接管颜色，不再需要额外勾选
  const c = a.theme === 'custom' || a.customColors ? a.colors : EMPTY_COLORS;
  // 自动配色 / 随图快照正在提供强调色时，这里不能去摘它
  const keep = autoStyleActive(a) || !!frozenActive(a) || !!autoSnapActive(a);
  if (c.accent) r.style.setProperty('--accent', c.accent);
  else if (!keep) r.style.removeProperty('--accent');
  if (c.accent2) r.style.setProperty('--accent-2', c.accent2);
  else if (!keep) r.style.removeProperty('--accent-2');
}

/** 用当前预设/纯色合成一张小样，让「随图生成」没设图时也能分析出配色 */
function statsFromSource(a: Appearance): BgStats {
  const w = 24, h = 24;
  const px = new Uint8ClampedArray(w * h * 4);
  const base = baseThemeOf(a);
  let c1: RGB, c2: RGB, c3: RGB, c4: RGB;
  if (a.mode === 'color') {
    c1 = c2 = c3 = c4 = parseColor(a.color) || [247, 242, 238];
  } else {
    const list = presetsOf(base);
    const p = list.find((x) => x.id === a.preset) || list[0];
    c1 = parseColor(p.a) || [247, 242, 238];
    c2 = parseColor(p.b) || c1;
    c3 = parseColor(p.c) || c2;
    c4 = parseColor(p.base) || c1;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tx = w > 1 ? x / (w - 1) : 0;
      const ty = h > 1 ? y / (h - 1) : 0;
      const top = mix(c1, c2, tx);
      const bottom = mix(c3, c4, tx);
      const c = mix(top, bottom, ty);
      const i = (y * w + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  return analyzePixels(px, w, h);
}

/** 「随图生成」：有图按图分析，没图按当前预设/纯色分析，然后冻结成快照 */
async function refreshAutoStyle(): Promise<BgStyle | null> {
  const a = state;
  let s: BgStyle | null = null;
  try {
    if (a.mode === 'image' && a.image) {
      const raw = await analyzeImage(a.image, 'ins', 64, a.styleStrength);
      const base: BaseTheme = raw.dark ? 'neon' : 'ins';
      s = deriveStyle(raw, base, a.styleStrength);
      const key = autoKey({ ...state, base }, base);
      state = { ...state, base, frozen: autoSnapshotOf({ ...state, base }, s, base, key) };
      bgStyle = s; bgStyleFor = key; bgStyleTheme = base;
    } else {
      const stats = statsFromSource(a);
      const base: BaseTheme = stats.dark ? 'neon' : 'ins';
      s = deriveStyle(stats, base, a.styleStrength);
      const key = autoKey({ ...state, base }, base);
      state = { ...state, base, frozen: autoSnapshotOf({ ...state, base }, s, base, key) };
      bgStyle = s; bgStyleFor = key; bgStyleTheme = base;
    }
  } catch {
    s = null;
    state = { ...state, frozen: null };
    bgStyle = null; bgStyleFor = ''; bgStyleTheme = '';
  }
  applyAppearance();
  emit();
  await metaSet('appearance', state);
  return bgStyle;
}

/** 重新看一遍背景图，算出新的玻璃参数（没图就清空） */
export async function refreshBgStyle(): Promise<BgStyle | null> {
  // 注意：即使关掉了"自动配色"也要分析 —— 可读性算法需要背景的亮度分布。
  // 自动配色开关只决定"要不要接管通透度和玻璃颜色"，不决定要不要看图。
  if (state.theme === 'auto') return refreshAutoStyle();
  if (!(state.mode === 'image' && state.image)) {
    bgStyle = null; bgStyleFor = ''; bgStyleTheme = '';
    applyAppearance();
    emit();
    return null;
  }
  const img = state.image, base = baseThemeOf(state);
  try {
    const s = await analyzeImage(img, base, 64, state.styleStrength);
    bgStyle = s; bgStyleFor = img; bgStyleTheme = base;
  } catch {
    bgStyle = null; bgStyleFor = ''; bgStyleTheme = '';
  }
  applyAppearance();
  emit();
  return bgStyle;
}

/** 切换主题时的推荐蒙版强度（auto/custom 用中性值，实际以分析结果/滑杆为准） */
export const DIM_BY_THEME: Record<ThemeId, number> = { ins: 16, neon: 34, auto: 16, custom: 20 };
export const THEME_LABEL: Record<ThemeId, string> = {
  ins: 'INS 奶油风',
  neon: '暮色霓虹',
  auto: '随图生成',
  custom: '自定义'
};

let state: Appearance = { ...DEFAULTS };
const subs = new Set<() => void>();
const emit = () => { subs.forEach((f) => f()); };

const appSub = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
export const getAppearance = () => state;
export function useAppearance(): Appearance {
  return useSyncExternalStore(appSub, getAppearance, getAppearance);
}

export function applyAppearance(a: Appearance = state) {
  const r = document.documentElement;
  activeBase = baseThemeOf(a);
  r.style.setProperty('--bd-dim', String(a.dim / 100));
  r.style.setProperty('--glass-tint', String(a.tint / 100));
  r.style.setProperty('--glow-strength', String(a.glow / 100));
  applyFontMode(a.font || 'hanyi');
  r.dataset.bdMode = a.mode;
  r.dataset.perf = a.perf;
  // styles.css 的明暗画风只认 ins / neon：auto 与 custom 落到当前基色上，
  // 四档本身另放 data-style，测试和面板都读它。
  r.dataset.theme = activeBase;
  r.dataset.style = a.theme;
  r.dataset.blobs = a.blobs && a.blobsMove ? 'move' : 'static';
  // 背景蒙层（那层白/灰的雾）：关掉后 CSS 直接把 .bd-dim 藏起来，一层都不压
  r.dataset.fog = a.fog === false ? '0' : '1';
  // 动效：full 始终开 / auto 跟随系统 / calm 减弱。默认 full ——
  // 以前是纯 CSS 媒体查询，系统一关"动画效果"整个界面就变成了静音版。
  r.dataset.motion = a.motion || 'full';
  // 放最后：自动配色要盖过上面按滑杆写进去的值，自定义颜色再盖过自动配色，
  // 可读性最后算 —— 它要读"最终生效"的强调色和卡面颜色。
  applyAutoVars(a);
  applyThemeVars(a);
  applyCustomColors(a);
  applyLegibility(a);
}

/** 切到后台时暂停动画，回来再恢复——避免后台空跑吃电 */
export function bindVisibilityPause(): () => void {
  const onVis = () => { document.documentElement.dataset.hidden = document.hidden ? '1' : '0'; };
  document.addEventListener('visibilitychange', onVis);
  onVis();
  return () => document.removeEventListener('visibilitychange', onVis);
}

export async function loadAppearance(): Promise<Appearance> {
  const saved = await metaGet<Partial<Appearance>>('appearance', {});
  state = { ...DEFAULTS, ...(saved || {}) };
  // 旧配置里没有 theme/base/cardShade/radius，这里逐个补默认值并校验
  if (THEME_IDS.indexOf(state.theme) < 0) state.theme = 'ins';
  state.base = state.theme === 'ins' || state.theme === 'neon'
    ? state.theme
    : (saved && (saved.base === 'neon' || saved.base === 'ins') ? saved.base : 'ins');
  state.colors = { ...EMPTY_COLORS, ...((saved && saved.colors) || {}) };
  state.styleStrength = clamp(Number(state.styleStrength) || 0, 0, 1);
  if (state.styleStrength === 0 && !(saved && typeof saved.styleStrength === 'number')) state.styleStrength = DEFAULTS.styleStrength;
  if (!state.motion) state.motion = 'full';
  const shade = Number(state.cardShade);
  state.cardShade = Number.isFinite(shade) ? clamp(shade, 0, 100) : DEFAULTS.cardShade;
  state.radius = state.radius === 0 || state.radius === 2 ? state.radius : 1;
  // 老版本没存过 frozen；存过也要校验，缺字段就当没有（免得用一张空快照把颜色弄丢）
  const fz = state.frozen;
  const legacyFrozen = !!(fz && fz.image && (fz.theme === 'ins' || fz.theme === 'neon'));
  const autoFrozen = !!(fz && fz.theme === 'auto' && fz.key && (fz.base === 'ins' || fz.base === 'neon') && typeof fz.tint === 'number');
  state.frozen = state.theme === 'auto' ? (autoFrozen ? fz : null) : (legacyFrozen ? fz : null);
  if (state.theme === 'auto' && state.frozen && state.frozen.base) state.base = state.frozen.base;
  // 老版本没存过 fog：默认开着（和以前一样有蒙层）
  state.fog = state.fog !== false;
  activeBase = state.base;
  // 主题与预设必须匹配，否则回落到该主题的第一个预设
  const list = presetsOf(state.base);
  if (!list.some((p) => p.id === state.preset)) state.preset = list[0].id;
  applyAppearance();
  emit();
  // 开机时如果停在自定义图片/随图生成上，异步补一次分析（分析完会自己重画）
  void refreshBgStyle();
  return state;
}

/** 把此刻 AI 算出来的结果拍成快照 */
function snapOf(a: Appearance): FrozenStyle | null {
  if (!autoStyleActive(a) || !bgStyle) return null;
  return {
    image: a.image,
    theme: a.theme,
    glassRgb: bgStyle.glassRgb,
    cardRgb: bgStyle.cardRgb,
    overlayRgb: bgStyle.overlayRgb,
    washRgb: bgStyle.washRgb,
    accent: bgStyle.accent || '',
    accent2: bgStyle.accent2 || ''
  };
}

export async function saveAppearance(patch: Partial<Appearance>): Promise<void> {
  const before = state;
  const next: Appearance = { ...state, ...patch };
  if (THEME_IDS.indexOf(next.theme) < 0) next.theme = 'ins';
  // 明暗基色：切回 ins/neon 时跟着主题，auto/custom 保留/继承
  if (next.theme === 'ins' || next.theme === 'neon') next.base = next.theme;
  else if (patch.base === 'ins' || patch.base === 'neon') next.base = patch.base;
  else next.base = before.base;
  if (patch.colors) next.colors = { ...before.colors, ...patch.colors };
  const themeChanged = next.theme !== before.theme;
  const autoSnapBefore = autoSnapActive(before);
  state = next;
  activeBase = state.base;
  state.colors = { ...EMPTY_COLORS, ...state.colors };
  const shade = Number(state.cardShade);
  state.cardShade = Number.isFinite(shade) ? clamp(shade, 0, 100) : DEFAULTS.cardShade;
  state.radius = state.radius === 0 || state.radius === 2 ? state.radius : 1;

  if (themeChanged) state.frozen = null;
  // 从「随图生成」切到「自定义」时，把刚才那套 AI 结果带过去当起点，
  // 用户一进来就能接着微调，而不是颜色突然跳回主题自带色。
  if (themeChanged && state.theme === 'custom' && autoSnapBefore) {
    if (typeof autoSnapBefore.tint === 'number') state.tint = clamp(autoSnapBefore.tint, 2, 45);
    if (typeof autoSnapBefore.dim === 'number') state.dim = clamp(autoSnapBefore.dim, 0, 70);
    state.colors = {
      ...state.colors,
      accent: autoSnapBefore.accent || state.colors.accent,
      accent2: autoSnapBefore.accent2 || state.colors.accent2
    };
    state.customColors = true;
  }

  if (state.theme === 'auto') {
    // 随图生成的快照绑定在背景/强度/基色上；其中任何一项变了都重算
    if (
      themeChanged || patch.image !== undefined || patch.mode !== undefined ||
      patch.preset !== undefined || patch.color !== undefined ||
      patch.styleStrength !== undefined || patch.base !== undefined
    ) {
      state.frozen = null;
    }
  } else if (patch.autoStyle === false) {
    // 关掉「AI 自动配色」：把 AI 此刻的结果固化下来 —— 颜色留着，通透度/蒙版写进滑杆，
    // 开关一关界面一帧都不跳，用户再接着拖滑杆、改自定义颜色去微调。
    const f = snapOf(before);
    if (f) {
      state.frozen = f;
      if (bgStyle) {
        state.tint = clamp(Math.round(bgStyle.tint), 0, 45);
        state.dim = clamp(Math.round(bgStyle.washAlpha * 100), 0, 70);
      }
    }
  } else if (
    patch.autoStyle === true || patch.image !== undefined ||
    patch.mode !== undefined || patch.theme !== undefined
  ) {
    state.frozen = null;
  }

  // 主题与预设必须匹配，否则回落到该基色的第一个预设
  const list = presetsOf(state.base);
  if (!list.some((p) => p.id === state.preset)) state.preset = list[0].id;

  applyAppearance();
  emit();
  await metaSet('appearance', state);
  // 换了图 / 换了主题 / 改了配色强度，都要重新看一遍图
  if (state.theme === 'auto') {
    if (
      themeChanged || patch.image !== undefined || patch.mode !== undefined ||
      patch.preset !== undefined || patch.color !== undefined ||
      patch.styleStrength !== undefined || patch.base !== undefined
    ) {
      void refreshBgStyle();
    }
  } else if (
    patch.image !== undefined || patch.mode !== undefined ||
    patch.autoStyle !== undefined || patch.theme !== undefined ||
    patch.styleStrength !== undefined
  ) {
    void refreshBgStyle();
  }
}

export async function resetAppearance(): Promise<void> {
  state = { ...DEFAULTS, colors: { ...EMPTY_COLORS }, frozen: null };
  activeBase = 'ins';
  bgStyle = null; bgStyleFor = ''; bgStyleTheme = '';
  applyAppearance();
  emit();
  await metaSet('appearance', state);
}

/** 读取用户选择的图片并压到合理体积，避免 IndexedDB 里塞入超大 base64 */
export function fileToDataURL(file: File, maxSide = 1920, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t('读取图片失败')));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(t('图片格式不支持')));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        if (!ctx) { resolve(String(reader.result)); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** 供 Backdrop 组件使用的内联样式 */
export function backdropStyle(a: Appearance): React.CSSProperties {
  if (a.mode === 'color') return { background: a.color };
  if (a.mode === 'image' && a.image) {
    return { backgroundImage: 'url(' + a.image + ')', backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  const list = presetsOf(baseThemeOf(a));
  const p = list.find((x) => x.id === a.preset) || list[0];
  return {
    background:
      'radial-gradient(1100px 700px at 12% 6%, ' + p.a + ' 0%, transparent 62%),' +
      'radial-gradient(900px 700px at 88% 12%, ' + p.b + ' 0%, transparent 58%),' +
      'radial-gradient(1000px 800px at 55% 100%, ' + p.c + ' 0%, transparent 62%),' +
      'linear-gradient(160deg, ' + p.base + ', ' + p.base + ')'
  };
}
