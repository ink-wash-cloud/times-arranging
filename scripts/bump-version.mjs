#!/usr/bin/env node
/**
 * 版本号自增
 *
 *   npm run bump            补丁位 +1    1.2.0 -> 1.2.1
 *   npm run bump -- minor   次版本 +1    1.2.3 -> 1.3.0
 *   npm run bump -- major   主版本 +1    1.9.9 -> 2.0.0
 *   npm run bump -- 1.2.5   直接指定
 *
 * 规则（用户定的）：**除第一位外，其余各位都只能是 0-9，逢十进一**。
 *   - 补丁位到 10 就向次版本位进 1，次版本位到 10 就向主版本位进 1
 *   - 所以不存在 1.0.20 这种写法，它等价于 1.2.0
 *   - 传进来的 x.y.z 若次/补丁位 >= 10，会先自动进位再写盘
 *
 * 版本号只有 package.json 一个来源：
 *   - 网页端构建时注入 __APP_VERSION__，侧边栏和崩溃报告都会显示
 *   - 安卓打包时同步写进 build.gradle 的 versionName / versionCode
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'package.json');
const arg = (process.argv[2] || 'patch').trim();

const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const cur = String(pkg.version || '0.0.0');
const m = cur.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!m) { console.error('  当前版本号不是 x.y.z 形式：' + cur); process.exit(1); }
let [major, minor, patch] = [+m[1], +m[2], +m[3]];

/** 逢十进一：把次/补丁位收敛到 0-9 */
function carry(a, b, c) {
  let ma = a, mi = b, pa = c;
  ma += Math.floor(mi / 10); mi = mi % 10;
  mi += Math.floor(pa / 10); pa = pa % 10;
  ma += Math.floor(mi / 10); mi = mi % 10;
  return [ma, mi, pa];
}

if (/^\d+\.\d+\.\d+$/.test(arg)) {
  [major, minor, patch] = arg.split('.').map(Number);
  const raw = major + '.' + minor + '.' + patch;
  [major, minor, patch] = carry(major, minor, patch);
  if (raw !== major + '.' + minor + '.' + patch) {
    console.log('  按「逢十进一」把 ' + raw + ' 收敛为 ' + major + '.' + minor + '.' + patch);
  }
} else if (arg === 'major') { major++; minor = 0; patch = 0; }
else if (arg === 'minor') { minor++; patch = 0; [major, minor, patch] = carry(major, minor, patch); }
else if (arg === 'patch') { patch++; [major, minor, patch] = carry(major, minor, patch); }
else { console.error('  用法：npm run bump [major|minor|patch|x.y.z]'); process.exit(1); }

if (minor > 9 || patch > 9) {
  console.error('  版本号不符合规则：第二位和第三位只能是 0-9（逢十进一）');
  process.exit(1);
}

const next = major + '.' + minor + '.' + patch;
pkg.version = next;
writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');

// 安卓包也用同一个号：versionCode 用 major*10000+minor*100+patch
const code = major * 10000 + minor * 100 + patch;
const gradlePath = join(ROOT, 'android', 'app', 'build.gradle');
let gradleNote = '（没找到 build.gradle，安卓侧未同步）';
try {
  let g = readFileSync(gradlePath, 'utf8');
  const before = g;
  g = g.replace(/versionCode\s+\d+/, 'versionCode ' + code);
  g = g.replace(/versionName\s+"[^"]*"/, 'versionName "' + next + '"');
  if (g !== before) { writeFileSync(gradlePath, g); gradleNote = '（安卓 versionName ' + next + ' / versionCode ' + code + '）'; }
} catch { /* 忽略 */ }

console.log('  版本号 ' + cur + ' -> ' + next + ' ' + gradleNote);
console.log('  记得在 src/lib/changelog.ts 顶部加一条 v: \'' + next + '\' 的更新内容，否则打包会被拦。');
