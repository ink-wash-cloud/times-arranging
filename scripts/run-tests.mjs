#!/usr/bin/env node
/**
 * 一键跑测试。
 *
 * 为什么要有它：测试文件已经 40 多个，每次改动要跑哪几套、哪套挂了，
 * 靠手敲 node scripts/test-xxx.mjs 太容易漏。这里统一入口、统一汇总、统一退出码。
 *
 * 用法：
 *   node scripts/run-tests.mjs                 # 串行跑全部（浏览器套件一套一套来，省得互相抢 CPU）
 *   node scripts/run-tests.mjs --smoke         # 快速档：纯函数 + 服务端健壮性 + 一条真人流程
 *   node scripts/run-tests.mjs --only=test-habit,test-week
 *   node scripts/run-tests.mjs --skip=test-pwa
 *   node scripts/run-tests.mjs --jobs=2        # 并行两套（端口互不相同才能并行）
 *   node scripts/run-tests.mjs --list          # 只列套件
 *
 * 注意：
 *   · 每套测试自己起隔离服务器（scripts/isoserver.mjs）和临时数据库，不会污染真实数据；
 *   · 端口写在各测试文件里，新增测试请挑 8860 以后的端口，避免和其它套件/常驻程序撞车。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d = '') => {
  const hit = args.find((a) => a === '--' + k || a.startsWith('--' + k + '='));
  if (!hit) return d;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
};
const has = (k) => args.some((a) => a === '--' + k);

// 快速档：改一行代码后先跑这些，几十秒内知道有没有把基本盘弄坏
const SMOKE = [
  'test-logic', 'test-notes', 'test-s2t', 'test-server-robust',
  'test-human-day', 'test-sync-honest',
];

// 纯函数/服务端套件不需要浏览器，跑得快
const FAST = new Set(['test-logic', 'test-notes', 'test-s2t', 'test-server-robust', 'test-beacon', 'test-sync']);

const ALL = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .map((f) => f.replace(/\.mjs$/, ''))
  .concat(['browser-test'])
  .sort();

if (has('list')) {
  console.log(ALL.join('\n'));
  process.exit(0);
}

const only = arg('only');
const skip = arg('skip');
let suites = ALL;
if (has('smoke')) suites = SMOKE.filter((s) => ALL.includes(s));
if (only) suites = only.split(',').map((s) => s.trim()).filter((s) => ALL.includes(s));
if (skip) {
  const off = new Set(skip.split(',').map((s) => s.trim()));
  suites = suites.filter((s) => !off.has(s));
}
if (!suites.length) { console.log('没有要跑的套件'); process.exit(1); }

/**
 * 端口撞车检查。
 *
 * 起因：8831 被 test-sync-honest 和 test-syncdir 同时占、8832 被 test-ttswitches
 * 和 test-widget 同时占、8793 被 test-pwa 和 test-notify 同时占。--jobs=2 并行跑时，
 * 后起来的那套直接报「端口已被占用」，看起来像代码坏了，其实只是配置撞车，
 * 白排查半小时。所以跑之前先把每套测试自己声明的 8xxx 端口扫一遍。
 */
function suitePorts(name) {
  const src = readFileSync(join(ROOT, 'scripts', name + '.mjs'), 'utf8');
  const found = new Set();
  for (const m of src.matchAll(/startIsolatedServer\(([^\n]*)/g)) {
    const n = m[1].match(/8\d{3}/);
    if (n) found.add(n[0]);
  }
  for (const m of src.matchAll(/const PORT = [^\n]*/g)) {
    const n = m[0].match(/8\d{3}/);
    if (n) found.add(n[0]);
  }
  return [...found];
}

{
  const byPort = new Map();
  for (const s of suites) {
    for (const port of suitePorts(s)) {
      if (!byPort.has(port)) byPort.set(port, []);
      byPort.get(port).push(s);
    }
  }
  const clash = [...byPort].filter(([, list]) => list.length > 1);
  if (clash.length) {
    console.error('\n端口撞车：同一个端口被多套测试占用，并行跑会互相抢：');
    for (const [port, list] of clash) console.error('  ' + port + ' -> ' + list.join(' / '));
    console.error('给其中一套换成没人用的 88xx 端口再跑。\n');
    process.exit(1);
  }
}

const jobs = Math.max(1, Number(arg('jobs', '1')) || 1);
const TIMEOUT = Number(arg('timeout', '420'));

function runOne(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [join(ROOT, 'scripts', name + '.mjs')], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TEMP: join(ROOT, '.tmp'), TMP: join(ROOT, '.tmp'), FORCE_COLOR: '0' },
    });
    let out = '';
    const cap = (d) => { out += String(d); if (out.length > 400000) out = out.slice(-200000); };
    child.stdout.on('data', cap);
    child.stderr.on('data', cap);
    const timer = setTimeout(() => { try { child.kill(); } catch { /* 已退 */ } }, TIMEOUT * 1000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const ms = Date.now() - started;
      // 历史上的汇总格式都认：中文「通过 X 项，失败 Y 项」、英文「N passed, M failed」、只有 PASS/FAIL 行。
      // 一条测试里可能打印好几段小计（每个场景一行）再打一行总计，所以取通过数最大的那条。
      const sums = [
        ...out.matchAll(/通过\s*(\d+)\s*项[，,]\s*失败\s*(\d+)\s*项/g),
        ...out.matchAll(/(\d+)\s+passed\s*[,，]\s*(\d+)\s+failed/gi),
      ].map((x) => ({ pass: Number(x[1]), fail: Number(x[2]) }));
      let pass = 0, fail = 0;
      if (sums.length) {
        sums.sort((a, b) => b.pass - a.pass || b.fail - a.fail);
        pass = sums[0].pass;
        fail = sums[0].fail;
      } else {
        pass = (out.match(/^\s*PASS\b/gm) || []).length;
        fail = (out.match(/^\s*FAIL\b/gm) || []).length;
      }
      if (code !== 0 && fail === 0) fail = 1;   // 异常退出但没打印 FAIL：也算失败
      resolve({ name, code: code ?? -1, pass, fail, ms, out });
    });
    child.on('error', (e) => { clearTimeout(timer); resolve({ name, code: -1, pass: 0, fail: 1, ms: 0, out: 'spawn 失败: ' + e.message }); });
  });
}

const results = [];
let cursor = 0;
const t0 = Date.now();
process.stdout.write('\n跑 ' + suites.length + ' 套测试（jobs=' + jobs + '）...\n');

/**
 * 会自己重建 dist 的套件必须先单独跑完，再跑其余的。
 *
 * 起因：test-update 里两次 execSync('npm run build') 会把 dist 整个换掉。
 * --jobs>=2 时它还开着浏览器，另外几套同时在加载旧 dist，构建一落地那些套件
 * 就报「.app 等不到」「资源 404」，上一轮白跑了一整批。
 */
const REBUILDS_DIST = new Set(['test-update']);
const serial = suites.filter((s) => REBUILDS_DIST.has(s));
if (serial.length) {
  suites = suites.filter((s) => !REBUILDS_DIST.has(s));
  console.log('先单独跑会重建 dist 的套件：' + serial.join('、'));
  for (const name of serial) {
    process.stdout.write('  … ' + name + '\n');
    const r = await runOne(name);
    results.push(r);
    const bad = r.fail > 0 || r.code !== 0;
    process.stdout.write('  ' + (bad ? '✗' : '✓') + ' ' + name.padEnd(22) + (r.pass + ' passed, ' + r.fail + ' failed').padEnd(24) + (r.ms / 1000).toFixed(1) + 's\n');
  }
}

async function worker() {
  while (cursor < suites.length) {
    const name = suites[cursor++];
    process.stdout.write('  … ' + name + (FAST.has(name) ? '（快）' : '') + '\n');
    const r = await runOne(name);
    results.push(r);
    const bad = r.fail > 0 || r.code !== 0;
    process.stdout.write('  ' + (bad ? '✗' : '✓') + ' ' + name.padEnd(22) + (r.pass + ' passed, ' + r.fail + ' failed').padEnd(24) + (r.ms / 1000).toFixed(1) + 's\n');
  }
}
await Promise.all(Array.from({ length: jobs }, worker));

const failed = results.filter((r) => r.fail > 0 || r.code !== 0).sort((a, b) => a.name.localeCompare(b.name));
const totalPass = results.reduce((s, r) => s + r.pass, 0);
const totalFail = results.reduce((s, r) => s + r.fail, 0);
const secs = ((Date.now() - t0) / 1000).toFixed(1);

console.log('\n========================================');
console.log('  套件 ' + results.length + ' 套，断言 ' + totalPass + ' 通过 / ' + totalFail + ' 失败，用时 ' + secs + 's');
console.log('========================================');
if (failed.length) {
  for (const f of failed) {
    console.log('\n───── ' + f.name + ' 失败（exit ' + f.code + '，' + f.pass + ' passed / ' + f.fail + ' failed）─────');
    // 只打印失败相关行 + 最后 25 行，避免刷屏
    const lines = f.out.split('\n');
    const tail = lines.slice(-25).join('\n');
    const fails = lines.filter((l) => /\bFAIL\b/.test(l)).slice(0, 40).join('\n');
    console.log((fails ? fails + '\n…\n' : '') + tail);
  }
  process.exit(1);
}
