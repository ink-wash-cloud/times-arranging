// 多语言覆盖率检查：从源码里抽出所有 t('原文') 的原文，核对英/日词典有没有。
//
//   node scripts/check-i18n.mjs            只看统计
//   node scripts/check-i18n.mjs --missing  列出缺的原文（按文件分组）
//   node scripts/check-i18n.mjs --strict   有缺失或占位符对不上就 exit 1（打包前跑）
//
// 繁体不需要词典：它由 src/lib/i18n/s2t.ts 的字表逐句转换。
//
// 顺带两道体检（以前是人工看，出过「译文把 {n} 丢了，切英文后数字消失」这类事故）：
//   1. 占位符：原文里的 {name} / {n} 必须在译文里一个不少、也不多；
//   2. 重复 key：同一个词典文件里同一条原文写两遍，后面的会静默覆盖前面的。
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const SRC = path.join(root, 'src');
const DICT_DIR = path.join(SRC, 'lib/i18n/dict');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'i18n' || e.name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** 抓 t('…') / t("…") / tIn(x, '…') 的单引号中文原文 */
const RE = /\bt(?:In\(\s*[a-zA-Z0-9_.'"]+\s*,\s*)?\(\s*(['"])((?:\\.|(?!\1).)+)\1/g;

const used = new Map(); // key -> Set(file)
for (const file of walk(SRC)) {
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = RE.exec(src))) {
    const key = m[2].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (!/[\u4e00-\u9fa5]/.test(key)) continue;
    const rel = path.relative(root, file).replace(/\\/g, '/');
    if (!used.has(key)) used.set(key, new Set());
    used.get(key).add(rel);
  }
}

/** 把源码里的转义还原（字典里写成 \" 的 key 也要能和源码里的 " 对上） */
function unesc(s) {
  return String(s).replace(/\\\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|n|r|t|.)/g, (m, c) => {
    if (c[0] === 'u') return String.fromCharCode(parseInt(c.slice(1), 16));
    if (c[0] === 'x') return String.fromCharCode(parseInt(c.slice(1), 16));
    return { n: '\\n', r: '\\r', t: '\\t' }[c] || c;
  });
}

/** 读 dict 里 "export const en: … = { … };" 这一块的 key → value */
function dictOf(src, lang) {
  const start = src.indexOf('export const ' + lang);
  if (start < 0) return new Map();
  const rest = src.slice(start);
  const endIdx = rest.indexOf('\n};');
  const block = endIdx < 0 ? rest : rest.slice(0, endIdx);
  const body = block.slice(block.indexOf('{') + 1);
  const re = /(['"])((?:\\.|(?!\1).)+)\1\s*:\s*(['"])((?:\\.|(?!\3).)*)\3/g;
  const map = new Map();
  let m;
  while ((m = re.exec(body))) map.set(unesc(m[2]), unesc(m[4]));
  return map;
}

const langs = { en: new Map(), ja: new Map() };
const dupes = [];
for (const name of fs.readdirSync(DICT_DIR)) {
  if (!/\.ts$/.test(name)) continue;
  const src = fs.readFileSync(path.join(DICT_DIR, name), 'utf8');
  for (const l of ['en', 'ja']) {
    const start = src.indexOf('export const ' + l);
    if (start < 0) continue;
    const rest = src.slice(start);
    const endIdx = rest.indexOf('\n};');
    const block = endIdx < 0 ? rest : rest.slice(0, endIdx);
    const body = block.slice(block.indexOf('{') + 1);
    const seen = new Set();
    for (const m of body.matchAll(/^\s*(['"])((?:\\.|(?!\1).)+)\1\s*:/gm)) {
      const dk = unesc(m[2]);
      if (seen.has(dk)) dupes.push(l + ' · dict/' + name + ' · ' + dk);
      seen.add(dk);
    }
    for (const [k, v] of dictOf(src, l)) langs[l].set(k, v);
  }
}

const total = used.size;
const missEn = [...used.keys()].filter((k) => !langs.en.has(k));
const missJa = [...used.keys()].filter((k) => !langs.ja.has(k));
const pct = (n) => (total ? ((100 * (total - n)) / total).toFixed(1) : '100.0');

const holders = (s) => {
  const set = new Set();
  for (const m of String(s).matchAll(/\{(\w+)\}/g)) set.add(m[1]);
  return set;
};

/** 占位符对不上的条目：{en: [...], ja: [...]} */
const badPh = { en: [], ja: [] };
for (const k of used.keys()) {
  const want = holders(k);
  for (const l of ['en', 'ja']) {
    const v = langs[l].get(k);
    if (typeof v !== 'string') continue;
    const got = holders(v);
    const missing = [...want].filter((x) => !got.has(x));
    const extra = [...got].filter((x) => !want.has(x));
    if (missing.length || extra.length) {
      badPh[l].push({ key: k, value: v, missing, extra });
    }
  }
}

console.log('源码里用到的原文条数：' + total);
console.log('英文词典：' + (total - missEn.length) + ' / ' + total + '（' + pct(missEn.length) + '%），缺 ' + missEn.length);
console.log('日文词典：' + (total - missJa.length) + ' / ' + total + '（' + pct(missJa.length) + '%），缺 ' + missJa.length);
if (dupes.length) console.log('重复 key：' + dupes.length + ' 处');
for (const l of ['en', 'ja']) {
  if (badPh[l].length) console.log('占位符对不上（' + l + '）：' + badPh[l].length + ' 条');
}

if (process.argv.includes('--missing')) {
  const show = (list, name) => {
    if (!list.length) return;
    console.log('\n=== 缺 ' + name + ' ===');
    for (const k of list) {
      const files = [...used.get(k)].join(', ');
      console.log('  ' + JSON.stringify(k) + '   ' + files);
    }
  };
  show(missEn, '英文');
  show(missJa, '日文');
  for (const l of ['en', 'ja']) {
    if (!badPh[l].length) continue;
    console.log('\n=== 占位符对不上 ' + l + ' ===');
    for (const b of badPh[l]) {
      const bits = [];
      if (b.missing.length) bits.push('少了 ' + b.missing.map((x) => '{' + x + '}').join(' '));
      if (b.extra.length) bits.push('多了 ' + b.extra.map((x) => '{' + x + '}').join(' '));
      console.log('  ' + JSON.stringify(b.key) + ' → ' + JSON.stringify(b.value) + '   ' + bits.join('，'));
    }
  }
  if (dupes.length) {
    console.log('\n=== 重复 key ===');
    for (const d of dupes) console.log('  ' + d);
  }
}

const dirty = missEn.length || missJa.length || dupes.length || badPh.en.length || badPh.ja.length;
if (!dirty) process.exit(0);
if (process.argv.includes('--strict')) {
  console.error('\n✗ 多语言检查没通过（缺 ' + (missEn.length + missJa.length) + ' 条译文、' +
    (badPh.en.length + badPh.ja.length) + ' 条占位符问题、' + dupes.length + ' 处重复 key）');
  process.exit(1);
}
