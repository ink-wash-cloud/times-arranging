#!/usr/bin/env node
/**
 * 一键打包安卓 APK
 *
 *   npm run apk
 *
 * 做的事：
 *   1. 自动探测本机局域网 IP，作为应用内置的默认同步地址
 *   2. 用该地址构建前端
 *   3. 同步进安卓工程（npx cap sync）
 *   4. 用 Gradle 打包
 *   5. 把产物复制到 release/时序-v1.0.apk
 *
 * 注意：这个脚本会用"带默认地址"的版本覆盖 dist。
 *       如果之后要让电脑上的网页版正常（走同源），重新跑一次 npm run build 即可。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, statSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// 产物文件名带上版本号：手机上「下载」里堆好几个包时能一眼分清哪个是新的
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const JAVA_HOME = process.env.JAVA_HOME || 'D:/android-toolchain/jdk';
const ANDROID_HOME = process.env.ANDROID_HOME || 'D:/android-toolchain/sdk';

function lanIP() {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal && !ni.address.startsWith('169.254.')) return ni.address;
    }
  }
  return '127.0.0.1';
}

// Windows 上系统 TEMP 里的 esbuild-* 临时目录会被安全软件占住，
// 清理时报 "Access is denied"，构建整个失败。把临时目录指到项目内就没这问题。
const LOCAL_TMP = join(ROOT, '.tmp');
try { mkdirSync(LOCAL_TMP, { recursive: true }); } catch { /* 忽略 */ }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    // 注意顺序：TEMP/TMP 必须放在最后，否则会被 process.env 里原有的值盖回去
    env: { ...process.env, ...opts.env, TEMP: LOCAL_TMP, TMP: LOCAL_TMP }
  });
  if (r.status !== 0) {
    console.error('\n  ✗ 失败：' + cmd + ' ' + args.join(' '));
    process.exit(r.status || 1);
  }
}

// --no-server：不把本机局域网地址烤进包。
// 给别人用的便携包里要用这个 —— 否则对方的手机一装上就一直在连你的电脑。
const noServer = process.argv.includes('--no-server');
const ip = lanIP();
const server = noServer ? '' : 'http://' + ip + ':8787';

console.log('');
console.log('  ┌──────────────────────────────────────────┐');
console.log('  │            打包安卓应用（时序）           │');
console.log('  └──────────────────────────────────────────┘');
console.log('   默认同步地址 : ' + (server || '（不内置 —— 由用户在设置里填自己的地址）'));
console.log('   JDK          : ' + JAVA_HOME);
console.log('   Android SDK  : ' + ANDROID_HOME);
console.log('');

if (!existsSync(JAVA_HOME)) {
  console.error('  ✗ 找不到 JDK：' + JAVA_HOME);
  console.error('    设置 JAVA_HOME 环境变量，或把 JDK 放到该路径');
  process.exit(1);
}
if (!existsSync(ANDROID_HOME)) {
  console.error('  ✗ 找不到 Android SDK：' + ANDROID_HOME);
  process.exit(1);
}

// 安卓包的版本号跟着 package.json 走，避免"网页端显示 1.0.3、安装包还是 1.0"
// 这种对不上的情况。改版本用 npm run bump。
const APP_VERSION = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '1.0.0'; }
  catch { return '1.0.0'; }
})();
try {
  const gradlePath = join(ROOT, 'android', 'app', 'build.gradle');
  const vm = APP_VERSION.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (vm) {
    const code = +vm[1] * 10000 + +vm[2] * 100 + +vm[3];
    let g = readFileSync(gradlePath, 'utf8');
    g = g.replace(/versionCode\s+\d+/, 'versionCode ' + code)
         .replace(/versionName\s+"[^"]*"/, 'versionName "' + APP_VERSION + '"');
    writeFileSync(gradlePath, g);
    console.log('   安卓版本     : v' + APP_VERSION + ' (versionCode ' + code + ')');
  }
} catch (e) {
  console.warn('   ⚠ 同步安卓版本号失败：' + String(e.message || e));
}

console.log('  [1/4] 构建前端…');
run('npm', ['run', 'build'], { env: { DEFAULT_SERVER: server } });

console.log('');
console.log('  [2/4] 同步到安卓工程…');
run('npx', ['cap', 'sync', 'android']);

console.log('');
console.log('  [3/4] Gradle 打包…');
// gradlew 在 android/ 目录里，必须在该目录执行，否则报 'gradlew.bat' 不是内部或外部命令
const androidDir = join(ROOT, 'android');
run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['assembleDebug', '--no-daemon'], {
  cwd: androidDir,
  env: { JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME }
});

console.log('');
console.log('  [4/4] 复制产物…');
const apkDir = join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
const apk = readdirSync(apkDir).find((f) => f.endsWith('.apk'));
if (!apk) { console.error('  ✗ 没找到 APK'); process.exit(1); }
// 不带默认地址的那个不能放进 release/：服务器会把 release 里最新的 apk
// 当作 /download/app.apk 发出去，那样我自己手机上装到的就成了"没地址"的版本。
const outDir = noServer ? join(ROOT, 'pack-files') : join(ROOT, 'release');
mkdirSync(outDir, { recursive: true });
// 用纯英文文件名：中文名在浏览器下载时会被错误编码
// （服务器会自己挑 release/ 里最新的那个 apk，不依赖固定名字）
const out = join(outDir, 'shixu-v' + VERSION + (noServer ? '-noserver' : '') + '.apk');
copyFileSync(join(apkDir, apk), out);

console.log('');
console.log('  ────────────────────────────────────────────');
console.log('  ✓ 打包完成：' + out.replace(ROOT, '.').replace(/\\\\/g, '/'));
console.log('    体积：' + (statSync(out).size / 1024 / 1024).toFixed(2) + ' MB');
console.log('  ────────────────────────────────────────────');
console.log('');
console.log('  安装到手机：把上面这个 apk 传到手机，点开安装');
console.log('  （首次需在系统里允许「安装未知来源应用」）');
console.log('');
if (noServer) {
  console.log('  提示：这个包没有内置同步地址，手机端第一次用要在「设置 → 服务器地址」里填；');
  console.log('        它放在 pack-files/ 而不是 release/，免得被当成最新安装包发出去。');
} else {
  console.log('  提示：这次构建的 dist 里带上了默认同步地址，安卓包开箱即用；');
}
console.log('        不管哪种，跑完都建议再跑一次 npm run build，让网页版回到同源。');
console.log('');
