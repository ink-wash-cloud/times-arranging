// 多语言运行时。
//
// 设计取舍（重要，改之前先读）：
//   · **字典的 key 就是简体中文原文**。组件里写 t('今天没有待办')，繁体走字表转换，
//     英语/日语走 dict/ 下面的对照表。这样迁移时不用先给上千句话起英文 key 名，
//     已有测试断言的简体文案也一行都不用改。
//   · 找不到译文时**回落到简体原文**，并把 key 记进 missing（scripts/check-i18n.mjs 会查），
//     界面永远不会出现空白或 undefined。
//   · 语言是「这台设备」的偏好，存在 Config.lang 里，不跟着服务器同步
//     （家里的电脑用中文、借给别人时切英文，互不影响）。
import { useSyncExternalStore } from 'react';
import { EN, JA } from './dicts';
import { toHant } from './s2t';

export type Lang = 'zh-Hans' | 'zh-Hant' | 'en' | 'ja';

export interface LangMeta {
  id: Lang;
  /** 用当前界面语言写的名字（列表里显示这个） */
  name: string;
  /** 该语言自己的写法，切换时好认 */
  native: string;
  /** 写进 <html lang> */
  html: string;
}

export const LANGS: LangMeta[] = [
  { id: 'zh-Hans', name: '简体中文', native: '简体中文', html: 'zh-Hans' },
  { id: 'zh-Hant', name: '繁體中文', native: '繁體中文', html: 'zh-Hant' },
  { id: 'en', name: 'English', native: 'English', html: 'en' },
  { id: 'ja', name: '日本語', native: '日本語', html: 'ja' }
];

export const DEFAULT_LANG: Lang = 'zh-Hans';

export function isLang(v: unknown): v is Lang {
  return v === 'zh-Hans' || v === 'zh-Hant' || v === 'en' || v === 'ja';
}

export function langMeta(l: Lang): LangMeta {
  for (const m of LANGS) if (m.id === l) return m;
  return LANGS[0];
}

/** 是不是中文（中文才用项目自带的 85W 字库，英/日走系统字体） */
export function isChinese(l: Lang = cur): boolean {
  return l === 'zh-Hans' || l === 'zh-Hant';
}

let cur: Lang = DEFAULT_LANG;
const subs = new Set<() => void>();
/** 记下没翻译的原文，测试和 check-i18n 脚本用 */
const missing = new Set<string>();

export function getLang(): Lang { return cur; }

export function subscribeLang(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/** React Hook：语言变了就重渲染 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

export function missingKeys(): string[] { return [...missing]; }
export function clearMissing(): void { missing.clear(); }

/** 纯函数：把简体原文翻成目标语言（找不到就回原文） */
export function translate(l: Lang, zh: string): string {
  if (!zh) return '';
  if (l === 'zh-Hans') return zh;
  if (l === 'zh-Hant') return toHant(zh);
  const table = l === 'en' ? EN : JA;
  const hit = table[zh];
  if (typeof hit === 'string' && hit) return hit;
  missing.add(l + ':' + zh);
  return zh;
}

const PARAM = /\{(\w+)\}/g;

function fill(text: string, params?: Record<string, string | number | undefined | null>): string {
  if (!params) return text;
  return text.replace(PARAM, (all, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? all : String(v);
  });
}

/**
 * 翻译 + 占位符替换。
 *   t('还有 {n} 天', { n: 3 })  →  zh: 还有 3 天 / en: 3 days left / ja: あと3日
 * 占位符写成 {n} 这种，别用字符串拼句子——语序和语法的差别全在字典里解决。
 */
export function t(zh: string, params?: Record<string, string | number | undefined | null>): string {
  return fill(translate(cur, zh), params);
}

/** 指定语言翻译（系统通知这种「排程时写入、到点才弹」的场景要用） */
export function tIn(l: Lang, zh: string, params?: Record<string, string | number | undefined | null>): string {
  return fill(translate(l, zh), params);
}

function applyDom(l: Lang): void {
  try {
    const r = document.documentElement;
    const m = langMeta(l);
    r.lang = m.html;
    r.setAttribute('data-lang', l);
    r.setAttribute('data-cjk', isChinese(l) ? '1' : '0');
  } catch { /* 服务端渲染/测试环境没有 document */ }
}

/** 切语言：只改运行时和 <html>，落盘由调用方 saveConfig({ lang }) 负责 */
export function setLang(l: Lang): void {
  const next = isLang(l) ? l : DEFAULT_LANG;
  applyDom(next);
  if (next === cur) return;
  cur = next;
  subs.forEach((fn) => { try { fn(); } catch { /* 单个订阅出错不影响别的 */ } });
}

/** 启动时确认一次（刷新后 <html> 上的标记要跟着配置走） */
export function initLang(l: Lang): void {
  const next = isLang(l) ? l : DEFAULT_LANG;
  cur = next;
  applyDom(next);
}
