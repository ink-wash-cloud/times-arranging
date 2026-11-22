#!/usr/bin/env node
/**
 * 一条命令出全套产物：网页版 + 两个 APK + 便携包
 *
 *   npm run release
 *
 * 顺序是有讲究的：
 *   0. 先查「版本号 ↔ 更新日志」是否配对 —— 对不上直接停，免得发出一个
 *      用户打开却看不到"改了什么"的包
 *   1. vite build        电脑端用的同源版本
 *   2. build-apk         内置本机局域网地址，自己手机装
 *   3. build-apk --no-server  不带地址，放进便携包给别人
 *   4. vite build 再来一次   第 2、3 步会把"带地址"的 dist 留在磁盘上，
 *                            不重跑的话电脑端页面会去连手机才该用的地址
 *   5. pack              便携包 zip（自带 node.exe + 教程 + 不带地址的 APK）
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const rel = (p) => p.replace(ROOT, '.').replace(/\\/g, '/');
const MB = (p) => (statSync(p).size / 1024 / 1024).toFixed(1) + ' MB';

// Windows 上系统 TEMP 里的 esbuild-* 临时目录会被安全软件占住，清理时报
// "Access is denied" 导致构建失败；临时目录指到项目内就没事了。
const LOCAL_TMP = join(ROOT, '.tmp');
try { mkdirSync(LOCAL_TMP, { recursive: true }); } catch { /* 忽略 */ }

function run(cmd, args) {
  console.log('\n  ▶ ' + cmd + ' ' + args.join(' '));
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    // 注意顺序：TEMP/TMP 必须放在最后，否则会被 process.env 里原有的值盖回去
    env: { ...process.env, TEMP: LOCAL_TMP, TMP: LOCAL_TMP }
  });
  if (r.status !== 0) {
    console.error('\n  ✗ 失败：' + cmd + ' ' + args.join(' '));
    process.exit(r.status || 1);
  }
}

/* ---- 0) 版本 / 更新日志守卫 ---- */
const chg = readFileSync(join(ROOT, 'src', 'lib', 'changelog.ts'), 'utf8');
const newest = (chg.match(/v:\s*'([\d.]+)'/) || [])[1] || '';
if (newest !== VERSION) {
  console.error('\n  ✗ 更新日志里最新的版本是 v' + (newest || '（没找到）') + '，package.json 是 v' + VERSION);
  console.error('    先在 src/lib/changelog.ts 最上面加一条 v' + VERSION + ' 的更新内容再打包：');
  console.error('    用户下次打开应用就是靠它弹「这次改了什么」。');
  process.exit(1);
}
console.log('\n  发布 v' + VERSION + '（更新日志已配对）');

/* ---- 0.5) 多语言守卫：少了译文就打不出包，免得用户切英文看到一堆中文 ---- */
{
  const r = spawnSync('node', ['scripts/check-i18n.mjs', '--strict'], {
    cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32'
  });
  if (r.status !== 0) {
    console.error('\n  ✗ 英文/日文词典还没补齐（缺的原文用 node scripts/check-i18n.mjs --missing 看）');
    console.error('    补齐 src/lib/i18n/dict/*.ts 之后再打包。');
    process.exit(1);
  }
}

run('npm', ['run', 'build']);
run('node', ['scripts/build-apk.mjs']);
run('node', ['scripts/build-apk.mjs', '--no-server']);
run('npm', ['run', 'build']);
run('node', ['scripts/pack.mjs']);

/* ---- 报告 ---- */
const apk = join(ROOT, 'release', 'shixu-v' + VERSION + '.apk');
const zip = join(ROOT, 'release', '时序-便携版-v' + VERSION + '.zip');
const noserver = join(ROOT, 'pack-files', 'shixu-v' + VERSION + '-noserver.apk');
console.log('\n  ═════════════ v' + VERSION + ' 全部产物 ═════════════');
for (const [label, p] of [['手机安装包', apk], ['便携包', zip], ['包内 APK', noserver]]) {
  console.log('  ' + (existsSync(p) ? '✓' : '✗') + ' ' + label + '  ' + rel(p) + (existsSync(p) ? '  (' + MB(p) + ')' : '  （没生成！）'));
}
console.log('  ═════════════════════════════════════════\n');
