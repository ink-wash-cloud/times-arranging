// 颜色与对比度的纯计算（不碰 DOM，可在页面里直接跑、也能单测）。
//
// 为什么需要它：背景图可以是纯白、纯黑、也可能是很花的照片；玻璃能被拖到几乎全透明；
// 性能档位又不保证有背景模糊。这时候"字糊在背景上"不是审美问题，是不可用。
// 所以把"看得清"变成可算的数字：算 WCAG 对比度，不够就按需要调整字色 / 卡面不透明度 /
// 选中滑块的深浅，而不是指望某一张背景刚好合适。

export type RGB = [number, number, number];

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

const hex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

export function toHex(c: RGB): string {
  return '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
}

/** 'r,g,b' 形式，给 rgba(var(--x), a) 用 */
export function triple(c: RGB): string {
  return Math.round(clamp(c[0], 0, 255)) + ',' + Math.round(clamp(c[1], 0, 255)) + ',' + Math.round(clamp(c[2], 0, 255));
}

export function rgbCss(c: RGB, alpha = 1): string {
  return 'rgba(' + triple(c) + ',' + (Math.round(alpha * 1000) / 1000) + ')';
}

/** '#rgb' / '#rrggbb' / rgb() / rgba() / hsl() / hsla() 都认，认不出返回 null */
export function parseColor(input: string): RGB | null {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (s.charAt(0) === '#') {
    const h = s.slice(1);
    if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    if (h.length >= 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return null;
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    if (p.length >= 3 && p.slice(0, 3).every((x) => typeof x === 'number' && !isNaN(x))) return [p[0], p[1], p[2]];
    return null;
  }
  const mh = s.match(/^hsla?\(([^)]+)\)$/);
  if (mh) {
    const p = mh[1].split(/[,/\s]+/).filter(Boolean);
    if (p.length >= 3) return hsl2rgb(Number(p[0]), Number(p[1].replace('%', '')) / 100, Number(p[2].replace('%', '')) / 100);
  }
  return null;
}

/** 相对亮度（WCAG 定义，0 黑 1 白） */
export function relLum(c: RGB): number {
  const f = (v: number) => {
    const x = clamp(v, 0, 255) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** WCAG 对比度，1（一样）~ 21（黑白） */
export function contrast(a: RGB, b: RGB): number {
  const la = relLum(a), lb = relLum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** 一个亮度值对应的中性灰（背景图的 p10 / p90 就是用它换算成"最坏情况下垫在卡后面的颜色"） */
export function grayOfLum(lum: number): RGB {
  const l = clamp(lum, 0, 1);
  const enc = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  const v = enc * 255;
  return [v, v, v];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** 半透明前景叠在背景上的实际颜色 */
export function composite(fg: RGB, alpha: number, bg: RGB): RGB {
  return mix(bg, fg, clamp(alpha, 0, 1));
}

export function hsl2rgb(h: number, s: number, l: number): RGB {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 1), ll = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function rgb2hsl(c: RGB): { h: number; s: number; l: number } {
  const r = clamp(c[0], 0, 255) / 255, g = clamp(c[1], 0, 255) / 255, b = clamp(c[2], 0, 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const d = mx - mn;
  const l = (mx + mn) / 2;
  let h = 0;
  if (d > 0.0001) {
    if (mx === r) h = (((g - b) / d) % 6) * 60;
    else if (mx === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  const s = d > 0.0001 ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h: (h + 360) % 360, s: clamp(s, 0, 1), l };
}

/** 色相环上插值（走最短的那一边），t=0 取 a、t=1 取 b */
export function mixHue(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * clamp(t, 0, 1) + 360) % 360;
}

/** 冷暖：-1 全是蓝、+1 全是红 */
export function warmth(c: RGB): number {
  return clamp((c[0] - c[2]) / 255, -1, 1);
}

/** 把 ink 往"离 surf 更远"的方向推，直到对比度达标（用于次要/提示文字的加深减淡） */
export function pushApart(ink: RGB, surf: RGB, target: number): RGB {
  let out = ink;
  const dir = relLum(ink) > relLum(surf) ? 1 : -1;
  const goal: RGB = dir > 0 ? [255, 255, 255] : [0, 0, 0];
  for (let k = 0; k < 24 && contrast(out, surf) < target; k++) out = mix(out, goal, 0.08);
  return out;
}

/**
 * 同上，但要同时满足"好几个背景"（卡片最亮/最暗两端都算一遍）。
 * 只按其中一端推是不够的：深色背景上把字往黑里推，对亮的那端早就够了，
 * 对暗的那端却刚好差一点（实测 4.24 < 4.5）。
 * 做法是把两个方向都试一遍：哪个先达标就用哪个，都不达标就取最接近的那个。
 */
export function pushApartAll(ink: RGB, surfaces: RGB[], target: number): RGB {
  const worst = (c: RGB) => surfaces.reduce((m, s) => Math.min(m, contrast(c, s)), 99);
  if (worst(ink) >= target) return ink;
  let bestOut: RGB = ink;
  let bestScore = worst(ink);
  const goals: RGB[] = [[0, 0, 0], [255, 255, 255]];
  for (const goal of goals) {
    let out = ink;
    for (let k = 0; k < 24 && worst(out) < target; k++) out = mix(out, goal, 0.08);
    const sc = worst(out);
    if (sc >= target) return out;
    if (sc > bestScore) { bestScore = sc; bestOut = out; }
  }
  return bestOut;
}

/**
 * 同样的字色，用多低的透明度还能达到 target 对比度。
 * 次要文字就是靠这个自动定下来的：不写死 70% / 48%，而是"能多淡就多淡，但保证读得清"。
 */
export function alphaForContrast(ink: RGB, surf: RGB, target: number, start = 1): number {
  let a = clamp(start, 0.08, 1);
  while (a > 0.1 && contrast(composite(ink, a, surf), surf) < target) a -= 0.02;
  return Math.max(0.1, Math.round(a * 100) / 100);
}

/** 两套候选字色里挑"最坏情况下最清楚"的那套 */
export function pickInk(candidates: RGB[], surfaces: RGB[]): { ink: RGB; worst: number } {
  let best = candidates[0], bestWorst = -1;
  for (const c of candidates) {
    let w = 99;
    for (const s of surfaces) w = Math.min(w, contrast(c, s));
    if (w > bestWorst) { bestWorst = w; best = c; }
  }
  return { ink: best, worst: bestWorst };
}
