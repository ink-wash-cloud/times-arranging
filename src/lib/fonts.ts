// 字体：汉仪文黑-85W
// 说明：汉仪文黑是商业字体，本项目不内置字库文件。两种让它生效的方式——
//   1) 本机已安装该字体：直接命中系统字体，零下载
//   2) 把字库文件放到 public/fonts/ 下（见该目录的 README），会自动以 @font-face 加载，
//      这样手机端也能用上（手机通常没装这个字体）
import { useEffect, useState } from 'react';

export type FontMode = 'hanyi' | 'hanyi-title' | 'system';

export const FALLBACK_STACK =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif";

/** 本地已安装时可能出现的几种族名写法都列上 */
export const HANYI_STACK =
  "'WenHei85', 'HYWenHei 85W', 'HYWenHei', 'Hanyi WenHei 85W', 'HanyiWenHei-85W', '汉仪文黑-85W', '汉仪文黑 85W', '汉仪文黑', " + FALLBACK_STACK;

export const FONT_MODE_LABEL: Record<FontMode, string> = {
  hanyi: '汉仪文黑 85W（全站）',
  'hanyi-title': '汉仪文黑 85W（仅标题）',
  system: '系统默认'
};

/** public/fonts/ 下按优先级尝试的文件名（构建期 vite.config.ts 里探测） */
const CANDIDATES: Array<{ file: string; format: string }> = [
  { file: 'hanyi-wenhei-85w.woff2', format: 'woff2' },
  { file: 'hanyi-wenhei-85w.woff', format: 'woff' },
  { file: 'hanyi-wenhei-85w.otf', format: 'opentype' },
  { file: 'hanyi-wenhei-85w.ttf', format: 'truetype' }
];

/** 构建期就已经知道有没有字库，因此运行时不需要发任何探测请求 */
function builtFontUrl(): string {
  try { return typeof __FONT_URL__ === 'string' ? __FONT_URL__ : ''; } catch { return ''; }
}

export interface FontStatus {
  webFontUrl: string;      // 命中的字库文件（空 = 没放）
  localInstalled: boolean; // 本机是否已安装同名字体
  ready: boolean;
}

const STYLE_ID = 'hanyi-font-face';

/** 用 canvas 量文字宽度来探测本机是否装了某个族名的字体 */
export function isLocalFontAvailable(family: string): boolean {
  try {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    if (!ctx) return false;
    const probe = '汉仪文黑字形宽度探测ABC0123';
    ctx.font = '32px monospace';
    const base = ctx.measureText(probe).width;
    ctx.font = '32px "' + family + '", monospace';
    return Math.abs(ctx.measureText(probe).width - base) > 0.5;
  } catch {
    return false;
  }
}

let status: FontStatus = { webFontUrl: '', localInstalled: false, ready: false };
const subs = new Set<() => void>();
export const getFontStatus = () => status;
function setStatus(patch: Partial<FontStatus>) {
  status = { ...status, ...patch };
  subs.forEach((f) => f());
}

/** 检查 public/fonts/ 下是否有可用的字库文件，有就注入 @font-face */
export async function ensureWebFont(): Promise<FontStatus> {
  if (status.ready) return status;

  const localInstalled =
    isLocalFontAvailable('汉仪文黑-85W') ||
    isLocalFontAvailable('Hanyi WenHei 85W') ||
    isLocalFontAvailable('汉仪文黑');

  let hit = builtFontUrl();

  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (hit) {
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    const fmt = (CANDIDATES.find((c) => hit.endsWith(c.file)) || CANDIDATES[0]).format;
    // hit 由构建期注入，这里只是把它落到 @font-face 上
    // font-weight 声明成区间，让这一个字重覆盖所有 font-weight，避免浏览器再合成伪粗体
    style.textContent =
      '@font-face{font-family:"WenHei85";src:url("' + hit + '") format("' + fmt + '");' +
      'font-weight:100 900;font-style:normal;font-display:swap;}';
    try { await document.fonts.load('400 32px "WenHei85"'); } catch { /* 忽略 */ }
  } else if (style) {
    style.remove();
  }

  setStatus({ webFontUrl: hit, localInstalled, ready: true });
  return status;
}

export function useFontStatus(): FontStatus {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((v) => v + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return status;
}

/** 把字体栈写到 CSS 变量上（data-font 决定具体用哪一套） */
export function applyFontMode(mode: FontMode) {
  const r = document.documentElement;
  r.dataset.font = mode;
  r.style.setProperty('--font-hanyi', HANYI_STACK);
  r.style.setProperty('--font-sans', FALLBACK_STACK);
}