// 背景图 → 玻璃参数：看一眼用户选的图，决定玻璃要多实、偏什么色、强调色用什么。
//
// 做法：把图缩到 64x64 画在 canvas 上，统计
//   亮度 / 饱和度 / 明暗反差 / 细节密度 / 主色相
// 再据此推导：
//   通透度（背景越花越乱，玻璃越要实，不然压不住字）
//   玻璃底色（图片平均色往白/深色里拉，只留一点点色相）
//   背景蒙版（把图片往界面基调上拉一把）
//   强调色（照片有明显主色就用它，灰照片沿用主题自带色）
//
// 另外还统计亮度的分布（p10/p90）和冷暖，这两项是 src/lib/legibility.ts
// 算"字压在背景上到底看不看得清"的输入。
//
// analyzePixels / deriveStyle 是纯计算，不碰 DOM，方便在 node 里单测。

import { mixHue } from './contrast';
import { t } from './i18n';

export interface BgStats {
  lum: number;          // 平均亮度 0..1
  sat: number;          // 平均饱和度 0..1
  contrast: number;     // 亮度标准差，归一化到 0..1
  detail: number;       // 相邻像素亮度差的均值，归一化到 0..1
  hue: number;          // 主色相 0..360
  hueStrength: number;  // 主色相的集中程度 0..1（灰度图接近 0）
  lumP10?: number;      // 最暗那 10% 区域的亮度（可读性算法用它算"最坏情况"）
  lumP90?: number;      // 最亮那 10% 区域的亮度
  warm?: number;        // 冷暖 -1（蓝）..+1（红）
  avg: [number, number, number];
  dark: boolean;
  colors: string[];     // 出现最多的几种颜色，给面板做预览
}

export interface BgStyle extends BgStats {
  tint: number;         // 推荐的玻璃通透度 4..40（越大越实，对应外观里的 tint）
  washRgb: string;      // 背景蒙版颜色 "r,g,b"
  washAlpha: number;    // 背景蒙版强度 0..1
  glassRgb: string;     // 玻璃高光面底色
  cardRgb: string;      // 内容卡底色
  overlayRgb: string;   // 浮层底色
  accent: string;       // 强调色（空串 = 图太灰，沿用主题自带的）
  accent2: string;
  mood: string;         // 给用户看的一句话
}

export type StyleTheme = 'ins' | 'neon';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const to255 = (c: number) => Math.max(0, Math.min(255, Math.round(c)));
const rgbStr = (c: [number, number, number]) => to255(c[0]) + ',' + to255(c[1]) + ',' + to255(c[2]);
const hex2 = (n: number) => to255(n).toString(16).padStart(2, '0');
const toHex = (c: [number, number, number]) => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);

/** t=0 取 a，t=1 取 b */
function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function hsl(h: number, s: number, l: number): string {
  return 'hsl(' + Math.round(((h % 360) + 360) % 360) + ', ' + Math.round(s * 100) + '%, ' + Math.round(l * 100) + '%)';
}

/** hsl → [r,g,b]（--card-rgb / --glass-rgb 这些变量只认 "r,g,b" 三元组，不认 hsl） */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360;
  const sat = clamp(s, 0, 1);
  const li = clamp(l, 0, 1);
  if (sat <= 0.0001) return [li * 255, li * 255, li * 255];
  const q = li < 0.5 ? li * (1 + sat) : li + sat - li * sat;
  const p0 = 2 * li - q;
  const hue2rgb = (t0: number) => {
    let t1 = t0;
    if (t1 < 0) t1 += 1;
    if (t1 > 1) t1 -= 1;
    if (t1 < 1 / 6) return p0 + (q - p0) * 6 * t1;
    if (t1 < 1 / 2) return q;
    if (t1 < 2 / 3) return p0 + (q - p0) * (2 / 3 - t1) * 6;
    return p0;
  };
  return [hue2rgb(hh + 1 / 3) * 255, hue2rgb(hh) * 255, hue2rgb(hh - 1 / 3) * 255];
}

function hueName(h: number): string {
  const x = ((h % 360) + 360) % 360;
  if (x < 15 || x >= 345) return '红调';
  if (x < 45) return '橙调';
  if (x < 70) return '黄调';
  if (x < 160) return '绿调';
  if (x < 200) return '青调';
  if (x < 260) return '蓝调';
  if (x < 300) return '紫调';
  return '粉调';
}

/**
 * 统计一张图的小样。px 是 RGBA 顺序的扁平数组（canvas 的 getImageData().data）。
 * 传 64x64 左右就够了：再大只是浪费，结论不会变。
 */
export function analyzePixels(px: ArrayLike<number>, w: number, h: number): BgStats {
  const n = Math.max(1, w * h);
  const lums = new Float32Array(n);
  let sr = 0, sg = 0, sb = 0, ssat = 0, sum = 0, sum2 = 0;
  let hx = 0, hy = 0, hw = 0;
  // 颜色分桶：键是量化后的颜色，值是"这一桶里有多少像素 + 各通道累加"
  interface Bucket { c: number; r: number; g: number; b: number }
  const buckets = new Map<number, Bucket>();

  for (let i = 0; i < n; i++) {
    const r = (px[i * 4] || 0) / 255;
    const g = (px[i * 4 + 1] || 0) / 255;
    const b = (px[i * 4 + 2] || 0) / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lums[i] = lum;
    sr += r; sg += g; sb += b;
    sum += lum; sum2 += lum * lum;

    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const d = mx - mn;
    const sat = mx > 0 ? d / mx : 0;
    ssat += sat;

    if (sat > 0.10 && mx > 0.10 && d > 0) {
      let deg: number;
      if (mx === r) deg = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      else if (mx === g) deg = ((b - r) / d + 2) * 60;
      else deg = ((r - g) / d + 4) * 60;
      const rad = (deg * Math.PI) / 180;
      // 又灰又暗的像素不该左右主色，按 饱和度x明度 加权
      const wgt = sat * mx;
      hx += Math.cos(rad) * wgt;
      hy += Math.sin(rad) * wgt;
      hw += wgt;
    }

    const key = ((r * 5) | 0) * 36 + ((g * 5) | 0) * 6 + ((b * 5) | 0);
    let bkt = buckets.get(key);
    if (!bkt) { bkt = { c: 0, r: 0, g: 0, b: 0 }; buckets.set(key, bkt); }
    bkt.c++; bkt.r += r; bkt.g += g; bkt.b += b;
  }

  // 细节密度：相邻像素亮度差。用"下采样后的图"衡量，天然偏向大结构而不是噪点
  let dsum = 0, dn = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x + 1 < w) { dsum += Math.abs(lums[i + 1] - lums[i]); dn++; }
      if (y + 1 < h) { dsum += Math.abs(lums[i + w] - lums[i]); dn++; }
    }
  }

  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const avg: [number, number, number] = [(sr / n) * 255, (sg / n) * 255, (sb / n) * 255];

  let hue = 0, hueStrength = 0;
  if (hw > 0.0001) {
    const len = Math.sqrt(hx * hx + hy * hy) / hw;   // 0=各方向都有（灰），1=颜色一致
    hue = ((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360;
    hueStrength = clamp(len, 0, 1);
  }

  const colors = Array.from(buckets.values())
    .sort((a, b) => b.c - a.c)
    .slice(0, 4)
    .map((b) => toHex([(b.r / b.c) * 255, (b.g / b.c) * 255, (b.b / b.c) * 255]));

  // 亮度分布：把亮度排序后取 10% / 90% 分位。字压在照片上时，最坏情况不是平均值，
  // 而是"最暗那一块"和"最亮那一块"——两处都得看得清，所以两头都留下来。
  const sorted = Array.prototype.slice.call(lums).sort((a: number, b: number) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] || 0;

  return {
    lum: mean,
    sat: ssat / n,
    contrast: clamp(sd / 0.30, 0, 1),
    detail: clamp((dn ? dsum / dn : 0) / 0.22, 0, 1),
    hue,
    hueStrength,
    lumP10: at(0.1),
    lumP90: at(0.9),
    warm: clamp((avg[0] - avg[2]) / 255, -1, 1),
    avg,
    dark: mean < 0.45,
    colors
  };
}

/**
 * 把统计结果翻译成一组玻璃参数。
 * strength = "配色强度" 0..1：按钮/强调色跟背景走多远。
 *   0  = 完全沿用主题自带色（用户自己接管）；
 *   0.7 = 默认，背景有一点色调就跟着偏过去，不会出现"冷背景 + 暖按钮"；
 *   1  = 尽量贴着背景的主色。
 */
export function deriveStyle(s: BgStats, theme: StyleTheme = 'ins', strength = 0.7): BgStyle {
  const light = theme === 'ins';

  // 通透度：背景越花、反差越大，玻璃越得实，不然底下的图会把字压掉。
  // 系数是拿真实照片（Windows 壁纸 + 截图）量出来的：
  //   干净柔和的图 contrast≈0.1 detail≈0.03 → tint≈11（玻璃很透，好看）
  //   普通照片   contrast≈0.5 detail≈0.06 → tint≈18（跟默认的 20 差不多）
  //   很花的图   contrast≈0.8 detail≈0.19 → tint≈29（玻璃发实，字才压得住）
  // 再往上就没意义了：ins 主题里 tint≥28 就已经是 min(.95) 封顶。
  // 饱和度单独算一项：艳丽的大图（壁纸那种 sat 0.7~0.95）比同亮度的素净图
  // 更容易透过玻璃把字搅花；截图/灰调照片 sat 只有 0.1 上下，几乎不加分。
  let tint = 8 + s.contrast * 16 + s.detail * 40 + s.sat * 6;
  if (light && s.dark) tint += 3;      // 浅色玻璃压在暗图上，反差更凶
  if (!light && !s.dark) tint += 2;    // 反过来也一样
  tint = Math.round(clamp(tint, 4, 40));

  // 背景蒙版：把图片往界面基调上拉。亮界面加奶白，暗界面加墨蓝
  const washBase: [number, number, number] = light ? [255, 250, 246] : [8, 10, 20];
  // 蒙版也多吃一点图的平均色（0.16 → 0.22）：换图时那层雾也该跟着变，而不是永远奶白
  const washRgb = rgbStr(mix(washBase, s.avg, 0.22));
  // 蒙版同理：颜色越艳，越要靠蒙版把背景往回拉一点
  const washAlpha = light
    ? clamp(0.08 + (1 - s.lum) * 0.30 + s.sat * 0.06, 0.08, 0.42)
    : clamp(0.20 + s.lum * 0.30 + s.sat * 0.05, 0.18, 0.52);

  // 表面颜色（v1.6.3 重做）：
  // 以前是「白里掺 10~14% 的平均色」，两张完全不同的照片算出来是 252,243,235 和
  // 233,244,236 —— 和白几乎没有差别，换了图用户也看不出颜色变过。
  // 现在按「图的主色相」生成一层淡着色面：色相跟着图走，明度锁在安全区间
  // （浅色 0.94~0.98 / 深色 0.09~0.20），所以字照样压得住，但一眼能看出冷暖。
  // 灰图（sat 与 hueStrength 都接近 0）不染色，退回中性白 / 墨色。
  const chroma = clamp(s.sat * 1.15 + s.hueStrength * 0.30, 0, 1);
  const hued = s.hueStrength > 0.05 && s.sat > 0.045;
  const hue = hued ? s.hue : (light ? 343 : 225);
  const tintAmt = hued ? chroma : 0;

  // 明度压到 0.93~0.97 这一带：再白就染不出色（HSL 在高明度区几乎没有彩度），
  // 再暗就会压到正文字。卡片最暗通道仍在 220 以上，浅色主题的"奶油白"观感不变。
  const cardL = light
    ? clamp(0.950 - s.lum * 0.020, 0.930, 0.958)
    : clamp(0.113 + s.lum * 0.045, 0.100, 0.190);
  const cardS = light ? clamp(0.06 + 0.80 * tintAmt, 0, 0.86) : clamp(0.18 + 0.52 * tintAmt, 0, 0.62);
  const glassL = light
    ? clamp(0.968 - s.lum * 0.012, 0.950, 0.972)
    : clamp(0.885 + s.lum * 0.050, 0.860, 0.940);
  const glassS = light ? clamp(0.03 + 0.52 * tintAmt, 0, 0.58) : clamp(0.02 + 0.32 * tintAmt, 0, 0.38);
  const overlayL = light
    ? clamp(0.958 - s.lum * 0.014, 0.940, 0.964)
    : clamp(0.100 + s.lum * 0.030, 0.090, 0.140);
  const overlayS = light ? clamp(0.03 + 0.50 * tintAmt, 0, 0.56) : clamp(0.14 + 0.42 * tintAmt, 0, 0.50);

  const glassRgb = rgbStr(hslToRgb(hue, glassS, glassL));
  const cardRgb = rgbStr(hslToRgb(hue, cardS, cardL));
  const overlayRgb = rgbStr(hslToRgb(hue, overlayS, overlayL));

  // 强调色（按钮/图标的颜色）：
  //   主色明显 → 直接用图的色相（这一档以前就有，观感最好，别动）；
  //   只有一点点色调（雾霾蓝、灰粉这类）→ 从主题色相往图的色相插值，
  //     以前这种图会被判成"没颜色"，于是冷色背景配了暖色按钮，正是用户提的那个不协调；
  //   真灰图 → 返回空串，沿用主题自带色。
  const strong = s.hueStrength > 0.16 && s.sat > 0.14;
  const themeHue = light ? 343 : 225;
  const conf = clamp((s.hueStrength - 0.04) * 2.0 + s.sat * 1.1, 0, 1);
  const follow = strength <= 0.02 ? 0 : strong ? 1 : clamp((0.30 + clamp(strength, 0, 1) * 0.62) * conf, 0, 0.94);
  const aHue = hued ? mixHue(themeHue, s.hue, follow) : themeHue;
  const accent = hued && follow > 0.02 ? hsl(aHue, light ? 0.58 : 0.62, light ? 0.68 : 0.72) : '';
  // 第二个色和第二色相差 -88 度，跟主题里"粉→香芋"的关系保持一致
  const accent2 = hued && follow > 0.02 ? hsl(aHue - 88, light ? 0.48 : 0.54, light ? 0.70 : 0.74) : '';

  const tone = s.dark ? '偏暗' : s.lum > 0.75 ? '明亮' : '中性';
  const temp = hued ? hueName(s.hue) : '灰调';
  const busy = s.detail > 0.15 ? '细节很多' : s.detail > 0.06 ? '细节适中' : '画面干净';
  const soft = s.contrast > 0.6 ? '反差大' : s.contrast < 0.2 ? '反差柔和' : '';
  return {
    ...s,
    tint, washRgb, washAlpha, glassRgb, cardRgb, overlayRgb,
    accent, accent2,
    // 描述在读取时才翻译：切语言后外观面板里的这句话会立刻跟着变
    get mood() {
      return [t(tone), t(temp), soft ? t(soft) : '', t(busy)].filter(Boolean).join(' · ');
    }
  };
}

/** 浏览器里用：把图片画到小画布上取样，得出风格 */
export function analyzeImage(src: string, theme: StyleTheme = 'ins', size = 64, strength = 0.7): Promise<BgStyle> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') { reject(new Error(t('没有浏览器环境'))); return; }
    const img = new Image();
    img.onerror = () => reject(new Error(t('这张图读不出来')));
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = size; cv.height = size;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        if (!ctx) { reject(new Error(t('画布不可用'))); return; }
        // 按 cover 画：取到的正是用户实际会看到的那一块
        const scale = Math.max(size / img.width, size / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
        const data = ctx.getImageData(0, 0, size, size).data;
        resolve(deriveStyle(analyzePixels(data, size, size), theme, strength));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    img.src = src;
  });
}
