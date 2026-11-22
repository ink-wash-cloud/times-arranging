// "看得清"算法：不靠审美，靠算。
//
// 输入是背景的亮度分布、玻璃卡面的颜色/不透明度、主题强调色；
// 输出是一整套被"钉死"在可读区间里的颜色（正文、次要字、滑块、按钮字、强调字）。
//
// 三条原则（也就是用户提的"不管什么背景什么画质档位都要看得清"）：
// 1. 背景最亮和最暗的地方都要算：一张照片上面是白天空、下面是黑地面，
//    字压在哪一边都要过关，所以对比度取两端的"最坏值"。
// 2. 先调字色，实在不行才抬卡面。卡面抬得越少，用户的通透度滑杆越有效
//    （最多抬 28 个百分点，抬到"够用"为止）。
// 3. 滑块（底部导栏当前项）不依赖 backdrop-filter：性能档位关了模糊之后，
//    它是把强调色推到"离卡面足够远"再叠一圈同字色的描边，所以白卡黑卡上都跳得出来。

import type { RGB } from './contrast';
import {
  alphaForContrast, clamp, composite, contrast, grayOfLum, mix, pushApartAll,
  relLum, rgb2hsl, triple
} from './contrast';

export type ThemeId = 'ins' | 'neon';

/** 背景的亮度画像（p10/p90 = 最暗/最亮的那 10% 区域的亮度，用来算最坏情况） */
export interface BgProfile {
  lum: number;
  p10: number;
  p90: number;
  rgb: RGB;
  warm: number;
}

export interface LegibilityInput {
  theme: ThemeId;
  bg: BgProfile;
  cardRgb: RGB;
  cardAlpha: number;
  accent: RGB;
  accent2: RGB;
  /** 用户自己指定的文字色（自定义颜色）：还是按它算，卡面该抬就抬 */
  inkOverride?: RGB | null;
  /** 用户自己指定的滑块色 */
  pillOverride?: RGB | null;
}

export interface Legibility {
  dark: boolean;
  /** 正文色 */
  ink: string;
  /** 次要文字（自动淡到刚好还看得清） */
  dim: string;
  /** 第三级文字 */
  dim2: string;
  /** 文字外描边，压在照片上时救命 */
  halo: string;
  /** 卡面不透明度的下限（原 --card-alpha 不够时抬到这里） */
  cardFloor: number;
  /** 正文 / 次要 / 三级 的最坏对比度，调试与测试用 */
  bodyC: number;
  dimC: number;
  dim2C: number;
  /** 底部导栏当前项滑块：渐变两端 + 上面的字色 + 描边 */
  pillA: string;
  pillB: string;
  pillInk: string;
  pillRing: string;
  /** 滑块字的最坏对比度 */
  pillC: number;
  /** 主按钮上的字色 */
  onAccent: string;
  onAccentC: number;
  /** 强调色版本：能当文字/图标用的（保证 ≥4.5） */
  accentText: string;
  accentTextC: number;
}

// 目标对比度：正文按 WCAG AA 的 4.5 抬一点；次要文字 3.6（AA 大字 3.0 之上）；
// 三级 3.0；滑块上的字要比正文更清楚（5.0），因为它周围还有渐变和光晕。
export const TARGET = { body: 4.6, dim: 3.6, dim2: 3.0, pill: 5.0, accentText: 4.5 };

const INK_DARK: RGB = [38, 32, 40];
const INK_DARK_NEON: RGB = [16, 18, 24];
const INK_LIGHT: RGB = [255, 252, 250];
const INK_LIGHT_NEON: RGB = [238, 242, 255];
const PILL_DARK: RGB = [32, 26, 34];
const PILL_LIGHT: RGB = [255, 255, 255];

export function defaultProfile(theme: ThemeId): BgProfile {
  // 没拿到背景信息时给一个和主题一致的中性画像：ins 偏亮、neon 偏暗
  return theme === 'ins'
    ? { lum: 0.84, p10: 0.62, p90: 0.97, rgb: [244, 236, 232], warm: 0.18 }
    : { lum: 0.16, p10: 0.05, p90: 0.34, rgb: [22, 26, 40], warm: -0.2 };
}

/** 从一个背景色（纯色模式 / 预设里的某一档）推出画像 */
export function profileOfColor(rgb: RGB, spread = 0.12): BgProfile {
  const l = relLum(rgb);
  return {
    lum: l,
    p10: clamp(l - spread, 0, 1),
    p90: clamp(l + spread, 0, 1),
    rgb,
    warm: clamp((rgb[0] - rgb[2]) / 255, -1, 1)
  };
}

/** 由多个颜色（渐变预设的几档）合成画像 */
export function profileOfColors(colors: RGB[]): BgProfile {
  const list = colors.filter(Boolean);
  if (!list.length) return defaultProfile('ins');
  const lums = list.map(relLum).sort((a, b) => a - b);
  const avg: RGB = [0, 0, 0];
  for (const c of list) { avg[0] += c[0]; avg[1] += c[1]; avg[2] += c[2]; }
  const n = list.length;
  return {
    lum: (lums[0] + lums[n - 1]) / 2,
    p10: lums[0],
    p90: lums[n - 1],
    rgb: [avg[0] / n, avg[1] / n, avg[2] / n],
    warm: clamp((avg[0] / n - avg[2] / n) / 255, -1, 1)
  };
}

const worstOn = (ink: RGB, card: RGB, a: number, bg: BgProfile): number =>
  Math.min(
    contrast(ink, composite(card, a, grayOfLum(bg.p10))),
    contrast(ink, composite(card, a, grayOfLum(bg.p90)))
  );

/**
 * 把卡面往"更实"的方向走，走到刚够达到 target 就停（越透越好，保住通透度滑杆的手感）。
 * 注意这一步不一定有用：浅色玻璃越实，卡面越亮，浅字反而更看不清 ——
 * 所以它只是给 deriveLegibility 提供"抬了会怎样"的一个候选，由调用方比较后再决定用不用。
 */
function liftFor(ink: RGB, card: RGB, from: number, bg: BgProfile, target: number, maxLift = 0.28) {
  const cap = Math.min(0.97, from + maxLift);
  const steps = Math.max(0, Math.round((cap - from) / 0.02));
  let alpha = from;
  let score = worstOn(ink, card, from, bg);
  for (let i = 1; i <= steps; i++) {
    const a = Math.round((from + i * 0.02) * 100) / 100;
    const s = worstOn(ink, card, a, bg);
    if (s > score + 1e-6) { score = s; alpha = a; }
    if (s >= target) break;
  }
  return { alpha, score };
}

/** 把颜色推到"离参照物足够远"，用于滑块（照参照物亮度差判断） */
function pushAwayColor(rgb: RGB, ref: RGB, minDelta = 0.16): RGB {
  let out = rgb;
  const dir = relLum(out) >= relLum(ref) ? 1 : -1;
  const goal: RGB = dir > 0 ? [255, 255, 255] : [0, 0, 0];
  for (let k = 0; k < 16 && Math.abs(relLum(out) - relLum(ref)) < minDelta; k++) out = mix(out, goal, 0.1);
  return out;
}

/**
 * 选中项滑块：把强调色推到"离它下面的卡面足够远"，再按滑块自己的亮度挑字色。
 * 关键是不依赖 backdrop-filter —— 性能档位把模糊关掉以后它照样看得见。
 */
export function pillPair(main: RGB, accent2: RGB, ref: RGB, target = TARGET.pill) {
  let a = pushAwayColor(main, ref, 0.16);
  let b = pushAwayColor(accent2, ref, 0.16);
  let ink = PILL_DARK;
  let c = 0;
  for (let round = 0; round < 12; round++) {
    const mid = mix(a, b, 0.5);
    const useDark = contrast(PILL_DARK, mid) >= contrast(PILL_LIGHT, mid);
    const cand = useDark ? PILL_DARK : PILL_LIGHT;
    c = Math.min(contrast(cand, a), contrast(cand, b));
    ink = cand;
    if (c >= target) break;
    // 字色定了就按它的反方向继续推滑块，直到字够清楚
    const away: RGB = useDark ? [255, 255, 255] : [0, 0, 0];
    a = mix(a, away, 0.09);
    b = mix(b, away, 0.09);
  }
  return {
    a: 'rgb(' + triple(a) + ')',
    b: 'rgb(' + triple(b) + ')',
    ink: 'rgb(' + triple(ink) + ')',
    ring: 'rgba(' + triple(ink) + ',.18)',
    c: Math.round(c * 100) / 100
  };
}

export function deriveLegibility(input: LegibilityInput): Legibility {
  const theme = input.theme;
  const neon = theme === 'neon';
  const bg = input.bg || defaultProfile(theme);
  const card = input.cardRgb;
  const a0 = clamp(input.cardAlpha, 0.05, 1);

  // 1) 选字色：深浅两套里挑"最坏情况最清楚"的（用户指定了就直接用指定的）
  const cands = neon ? [INK_LIGHT_NEON, INK_DARK_NEON] : [INK_DARK, INK_LIGHT];
  const inks = input.inkOverride ? [input.inkOverride] : cands;

  // 2) 选"字色 + 卡面实度"的组合。
  //    两组候选一起比：不抬卡面的，和抬到刚好够用的。
  //    · 有不抬就过关的 → 用不抬的（玻璃尽量透）
  //    · 只有抬了才过关的 → 用抬的（把字救回来）
  //    · 怎么都过不了（比如全透玻璃压在纯黑照片上：抬白玻璃只会越抬越看不清浅字）
  //      → 保持不抬，挑最清楚的那套字色，靠 --ink-halo 描边兜底，不为无望的情况把玻璃糊死
  type Pick = { ink: RGB; alpha: number; score: number };
  const base: Pick[] = inks.map((c) => ({ ink: c, alpha: a0, score: worstOn(c, card, a0, bg) }));
  const lifted: Pick[] = [];
  for (const p of base) {
    const r = liftFor(p.ink, card, a0, bg, TARGET.body);
    if (r.alpha > a0 + 1e-6) lifted.push({ ink: p.ink, alpha: r.alpha, score: r.score });
  }
  const pickOne = (list: Pick[]) => list.reduce((m, p) => (p.score > m.score + 1e-6 ? p : m));
  const okFlat = base.filter((p) => p.score >= TARGET.body);
  const okLift = lifted.filter((p) => p.score >= TARGET.body);
  const pick: Pick = okFlat.length ? pickOne(okFlat) : okLift.length ? pickOne(okLift) : pickOne(base);
  const ink = pick.ink;
  const cardFloor = pick.alpha;
  const bodyC = pick.score;

  const surfLow = composite(card, cardFloor, grayOfLum(bg.p10));
  const surfHigh = composite(card, cardFloor, grayOfLum(bg.p90));
  const surfMid = composite(card, cardFloor, grayOfLum(clamp(bg.lum, 0, 1)));

  // 3) 次要 / 三级文字：颜色同一个，只放低透明度；能多淡就多淡，但不低于目标对比度
  const dimA = Math.min(alphaForContrast(ink, surfLow, TARGET.dim), alphaForContrast(ink, surfHigh, TARGET.dim));
  const dim2A = Math.min(alphaForContrast(ink, surfLow, TARGET.dim2), alphaForContrast(ink, surfHigh, TARGET.dim2));
  const dim = 'rgba(' + triple(ink) + ',' + dimA + ')';
  const dim2 = 'rgba(' + triple(ink) + ',' + dim2A + ')';
  const dimC = Math.min(contrast(composite(ink, dimA, surfLow), surfLow), contrast(composite(ink, dimA, surfHigh), surfHigh));
  const dim2C = Math.min(contrast(composite(ink, dim2A, surfLow), surfLow), contrast(composite(ink, dim2A, surfHigh), surfHigh));

  // 4) 底部导栏滑块：强调色推到离卡面足够远，再按滑块自身亮度定字色
  const pill = input.pillOverride
    ? pillPair(input.pillOverride, mix(input.pillOverride, [255, 255, 255], 0.12), surfMid)
    : pillPair(input.accent, input.accent2, surfMid);

  // 5) 主按钮上的字
  const btnMid = mix(input.accent, input.accent2, 0.5);
  const onAccent = contrast(INK_LIGHT, btnMid) >= contrast(INK_DARK, btnMid) ? INK_LIGHT : INK_DARK;
  const onAccentC = contrast(onAccent, btnMid);

  // 6) 强调色当文字用（链接、图标、chip 上的字）：不够就加深，够就保持
  const accentText = pushApartAll(input.accent, [surfLow, surfHigh], TARGET.accentText);
  const accentTextC = Math.min(contrast(accentText, surfLow), contrast(accentText, surfHigh));

  return {
    dark: relLum(ink) < 0.4,
    ink: 'rgb(' + triple(ink) + ')',
    dim,
    dim2,
    halo: relLum(ink) < 0.4 ? '0 1px 0 rgba(255,255,255,.5)' : '0 1px 2px rgba(0,0,0,.32)',
    cardFloor,
    bodyC: Math.round(bodyC * 100) / 100,
    dimC: Math.round(dimC * 100) / 100,
    dim2C: Math.round(dim2C * 100) / 100,
    pillA: pill.a,
    pillB: pill.b,
    pillInk: pill.ink,
    pillRing: pill.ring,
    pillC: Math.round(pill.c * 100) / 100,
    onAccent: 'rgb(' + triple(onAccent) + ')',
    onAccentC: Math.round(onAccentC * 100) / 100,
    accentText: 'rgb(' + triple(accentText) + ')',
    accentTextC: Math.round(accentTextC * 100) / 100
  };
}

/** 背景的色相（-1 = 没有明显色相），给"按键颜色跟背景走"用 */
export function hueOf(rgb: RGB): { h: number; s: number } {
  const c = rgb2hsl(rgb);
  return { h: c.h, s: c.s };
}
