// 打一个"解压即用"的便携包：
//   · 自带绿色版 node.exe（对方不用装任何东西）
//   · 附带 Node 官方安装包（想正式安装的人用）
//   · 只放运行必需的东西：dist(去掉商业字体) + server + apk
//   · 绝不带上你自己的 data/ 和 node_modules
import { mkdirSync, rmSync, cpSync, existsSync, statSync, readdirSync, readFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const NAME = '时序-便携版-v' + VERSION;
const PACK = join(ROOT, '.pack');
const STAGE = join(PACK, NAME);

const MB = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
const size = (p) => {
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  let sum = 0;
  for (const e of readdirSync(p, { withFileTypes: true })) {
    sum += size(join(p, e.name));
  }
  return sum;
};

console.log('\n  打包 ' + NAME + '\n');

if (existsSync(PACK)) rmSync(PACK, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

/* ---- 1. 服务器（只有一个文件，零依赖） ---- */
cpSync(join(ROOT, 'server'), join(STAGE, 'server'), { recursive: true });
const serverFiles = readdirSync(join(STAGE, 'server'));

/* ---- 2. 网页本体（去掉 fonts：汉仪文黑是商业字体，不能随包分发） ---- */
cpSync(join(ROOT, 'dist'), join(STAGE, 'dist'), { recursive: true });
const fontDir = join(STAGE, 'dist', 'fonts');
const hadFont = existsSync(fontDir);
if (hadFont) rmSync(fontDir, { recursive: true, force: true });

/* ---- 3. 手机安装包 ---- */
mkdirSync(join(STAGE, 'release'), { recursive: true });
const apkDir = join(ROOT, 'release');
// 优先用"不带内置地址"的那个版本（给别人的包不能指向我的局域网 IP）
const packDir = join(ROOT, 'pack-files');
// 只认版本号对得上的包：把 v1.0.14 的 apk 改名成 v1.0.15 塞进便携包，
// 对方装上会一脸问号，所以对不上就停下来喊人重打。
const wantNoServer = 'shixu-v' + VERSION + '-noserver.apk';
const wantServer = 'shixu-v' + VERSION + '.apk';
const noServerApk = existsSync(join(packDir, wantNoServer)) ? wantNoServer : null;
const serverApk = existsSync(join(apkDir, wantServer)) ? wantServer : null;
const apk = noServerApk || serverApk;
if (!apk) {
  const have = []
    .concat(existsSync(packDir) ? readdirSync(packDir).filter((f) => /\.apk$/i.test(f)) : [])
    .concat(existsSync(apkDir) ? readdirSync(apkDir).filter((f) => /\.apk$/i.test(f)) : []);
  console.error('  ✗ 没有 v' + VERSION + ' 的 apk（现有的：' + (have.join('、') || '一个都没有') + '）');
  console.error('    先跑 npm run release（或 node scripts/build-apk.mjs --no-server）');
  process.exit(1);
}
const apkSrc = noServerApk ? join(packDir, apk) : join(apkDir, apk);
// 包内统一叫 shixu-vX.Y.Z.apk，服务器按名字发给手机
const apkOut = 'shixu-v' + VERSION + '.apk';
copyFileSync(apkSrc, join(STAGE, 'release', apkOut));

/* ---- 4. 绿色版 Node 运行时 ---- */
mkdirSync(join(STAGE, 'node'), { recursive: true });
copyFileSync(process.execPath, join(STAGE, 'node', 'node.exe'));

/* ---- 5. 附带的 Node 官方安装包（普通使用不需要） ---- */
const msiCandidates = [
  process.env.NODE_MSI,
  'D:\\node-v24.20.0-x64.msi',
  'D:\\node-v24.20.0-x64.exe'
].filter(Boolean);
const msi = msiCandidates.find((p) => existsSync(p));
if (msi) {
  mkdirSync(join(STAGE, '安装包'), { recursive: true });
  copyFileSync(msi, join(STAGE, '安装包', 'Node-' + msi.split(/[\\/]/).pop().replace(/^node-/, '')));
} else {
  console.log('  提示：没找到 Node 官方安装包，跳过（绿色版已经够用）');
}

/* ---- 6. 教程 + 启动器 ---- */
for (const f of ['新手教程.html', '启动时序.cmd']) {
  copyFileSync(join(ROOT, 'pack-files', f), join(STAGE, f));
}

/* ---- 7. 压缩 ---- */
mkdirSync(apkDir, { recursive: true });
const zip = join(apkDir, NAME + '.zip');
if (existsSync(zip)) rmSync(zip, { force: true });
console.log('  正在压缩（Node 运行时比较占体积，稍等）…');
const r = spawnSync('powershell', [
  '-NoProfile', '-Command',
  'Compress-Archive -Path "' + STAGE + '" -DestinationPath "' + zip + '" -CompressionLevel Optimal'
], { stdio: 'inherit' });
if (r.status !== 0) { console.error('  ✗ 压缩失败'); process.exit(1); }

/* ---- 8. 报告 ---- */
console.log('');
console.log('  ────────────────────────────────────────────');
console.log('  ✓ ' + zip.replace(ROOT + '\\', '').replace(ROOT, '.'));
console.log('    压缩包 ' + MB(size(zip)));
console.log('    解压后 ' + MB(size(STAGE)));
console.log('  ────────────────────────────────────────────');
console.log('    自带 Node   : ' + MB(size(join(STAGE, 'node'))));
console.log('    网页本体    : ' + MB(size(join(STAGE, 'dist'))) + (hadFont ? '（已剔除商业字体）' : ''));
console.log('    手机安装包  : ' + apkOut + '  ' + MB(size(join(STAGE, 'release'))) + (noServerApk ? '（不含内置地址，对方自己填）' : '（注意：含本机地址）'));
if (msi) console.log('    Node 安装包 : ' + MB(size(join(STAGE, '安装包'))) + '（可选）');
console.log('    服务器      : ' + serverFiles.join('、'));
console.log('    数据        : 不含（对方第一次启动会自己建）');
console.log('');
