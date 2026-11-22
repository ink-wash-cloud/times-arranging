// 简繁转换字表（src/lib/i18n/s2t.ts）：纯函数层回归，不需要浏览器。
//
//   node scripts/test-s2t.mjs
//
// 检查三件事：①常用词该转的字都转了 ②一字多义不能转错（里/只/干/周）
// ③字表本身没有重复项。esbuild 现编一份 ESM 再用 node 直接 import。
import fs from 'node:fs';
import { build } from 'esbuild';

const out = '.tmp/s2t.mjs';
await build({ entryPoints: ['src/lib/i18n/s2t.ts'], bundle: true, format: 'esm', outfile: out, logLevel: 'error' });
const { toHant, hantCoverage } = await import('../' + out);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
};

console.log('\n[1] 常用界面词');
const cases = [
  ['设置与同步', '設定與同步'],
  ['待办事项', '待辦事項'],
  ['习惯打卡', '習慣打卡'],
  ['节省', '節省'],
  ['数据', '資料'],
  ['默认', '預設'],
  ['保存', '儲存'],
  ['网络', '網路'],
  ['搜索', '搜尋'],
  ['界面', '介面'],
  ['周一', '週一'],
  ['头发', '頭髮'],
  ['干燥', '乾燥'],
  ['一只', '一隻'],
];
for (const [src, want] of cases) ok(src + ' → ' + want, toHant(src) === want, toHant(src));

console.log('\n[2] 一字多义不能转错');
const keep = [
  ['公里', '公里'],
  ['只有', '只有'],
  ['干净', '乾淨'],
  ['周围', '周圍'],
  ['这里', '這裡'],
  ['里面', '裡面'],
  ['后台', '後臺'],
  ['台湾', '臺灣'],
];
for (const [src, want] of keep) ok(src + ' 保持/正确', toHant(src) === want, toHant(src));

console.log('\n[3] 非中文原样返回');
for (const s of ['Today', '10:00', '🔥', 'v1.2.3', '']) ok(JSON.stringify(s) + ' 不变', toHant(s) === s, toHant(s));

console.log('\n[4] 字表体检');
const src = fs.readFileSync('src/lib/i18n/s2t.ts', 'utf8');
const pairsBlock = src.slice(src.indexOf('const PAIRS'), src.indexOf('const PHRASES'));
const pairs = [...pairsBlock.matchAll(/"([^"]{2})"/g)].map((m) => [m[1].charAt(0), m[1].charAt(1)]);
ok('单字对数 > 300', pairs.length > 300, pairs.length);
const seen = new Set(); const dup = [];
for (const [a] of pairs) { if (seen.has(a)) dup.push(a); seen.add(a); }
ok('单字表没有重复的左值', dup.length === 0, dup.slice(0, 5));
const badLen = pairs.filter(([a, b]) => a.length !== 1 || b.length !== 1);
ok('单字表每项都是单字', badLen.length === 0, badLen.slice(0, 5));
ok('没有把简体字映射成自己', pairs.filter(([a, b]) => a === b).length === 0, pairs.filter(([a, b]) => a === b).slice(0, 5));
const cov = hantCoverage();
ok('字表覆盖的字数 > 300', cov > 300, cov);

console.log('\n[5] 长句转换');
const long = '关于后台服务器与网络设置，默认保存到本地，搜索数据不会上传。';
const t2 = toHant(long);
ok('长句里该转的都转了', !/[关后网络设备默认储蓄数据库]/.test(t2), t2);
ok('长句不改变长度', t2.length === long.length, [t2.length, long.length]);
ok('长句里没有简体残留（抽 6 个高频字）', !/[个们来时会说这那为]/.test(t2), t2);

console.log('\n结果：' + pass + ' passed / ' + fail + ' failed');
process.exit(fail ? 1 : 0);