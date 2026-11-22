#!/usr/bin/env node
/**
 * 一键安装汉仪文黑 85W
 *
 *   npm run font:install                              # 自动在 下载/桌面/文档 里找
 *   npm run font:install -- "D:/某处/HYWenHei-85W.ttf" # 指定文件或目录
 *   npm run font:install -- --subset                   # 额外裁剪掉生僻字，体积最小
 *
 * 流程：找到字库 -> 压缩成 woff2（默认无损，保留全部字形）-> 放到 public/fonts/ -> 提示重新构建
 *
 * 为什么默认不裁剪：实测 汉仪文黑 85W 原始 3.13 MB，
 *   无损转 woff2 后 1.50 MB（10316 个字形一个不少）；
 *   裁剪到 7625 常用字后 1.04 MB —— 只小 0.46 MB，却会让生僻字回落到系统字体，不划算。
 *
 * 说明：汉仪文黑是商业字体，本项目不内置字库。请先到官网下载并确认授权范围：
 *   https://www.hanyi.com.cn/productdetail.php?id=992&type=0
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'fonts');
const OUT_WOFF2 = join(OUT_DIR, 'hanyi-wenhei-85w.woff2');
const OUT_RAW = join(OUT_DIR, 'hanyi-wenhei-85w' + '.ttf');   // 没有 fonttools 时的降级方案

const FONT_EXTS = ['.woff2', '.otf', '.ttf', '.ttc', '.woff'];
const NAME_RE = /hanyi|wenhei|汉仪|文黑/i;
const MAX_DEPTH = 5;

const wantSubset = process.argv.includes('--subset');
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const roots = arg
  ? [arg]
  : [
      join(homedir(), 'Downloads'),
      join(homedir(), 'Desktop'),
      join(homedir(), 'Documents'),
      join(homedir(), 'OneDrive', 'Desktop')
    ].filter(existsSync);

function walk(dir, depth = 0, acc = { fonts: [], zips: [] }) {
  if (depth > MAX_DEPTH || !existsSync(dir)) return acc;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (/node_modules|\.git|AppData/i.test(e.name)) continue;
      walk(full, depth + 1, acc);
    } else {
      const ext = extname(e.name).toLowerCase();
      if (FONT_EXTS.includes(ext)) acc.fonts.push(full);
      else if (ext === '.zip' && NAME_RE.test(e.name)) acc.zips.push(full);
    }
  }
  return acc;
}

console.log('');
console.log('  正在查找汉仪文黑 85W 字库文件…');
console.log('  搜索范围：' + roots.join('  |  '));

const found = { fonts: [], zips: [] };
for (const r of roots) {
  if (!existsSync(r)) continue;
  if (statSync(r).isFile()) {
    const ext = extname(r).toLowerCase();
    if (FONT_EXTS.includes(ext)) found.fonts.push(r);
  } else {
    walk(r, 0, found);
  }
}

// 压缩包：解压到临时目录再找
let tempDir = '';
if (found.zips.length) {
  tempDir = join(tmpdir(), 'hanyi-font-' + Date.now());
  mkdirSync(tempDir, { recursive: true });
  for (const z of found.zips) {
    console.log('  发现压缩包，正在解压：' + basename(z));
    const ps = spawnSync('powershell', ['-NoProfile', '-Command',
      'Expand-Archive -LiteralPath "' + z + '" -DestinationPath "' + tempDir + '" -Force'],
      { stdio: 'inherit' });
    if (ps.status === 0) walk(tempDir, 0, found);
  }
}

const named = found.fonts.filter((f) => NAME_RE.test(basename(f)));
const picked = (named.length ? named : [])
  .sort((a, b) => FONT_EXTS.indexOf(extname(a).toLowerCase()) - FONT_EXTS.indexOf(extname(b).toLowerCase()))[0];

if (!picked) {
  console.log('');
  console.log('  ✗ 没有找到汉仪文黑的字库文件。');
  console.log('');
  if (found.fonts.length) {
    console.log('  这几个字体文件在搜索范围里，但文件名对不上（前 10 个）：');
    found.fonts.slice(0, 10).forEach((f) => console.log('    ' + f));
    console.log('');
  }
  console.log('  请先到官网下载（需登录并同意个人非商用协议）：');
  console.log('    https://www.hanyi.com.cn/productdetail.php?id=992&type=0');
  console.log('');
  console.log('  下载后可以直接指定路径再跑一次，例如：');
  console.log('    npm run font:install -- "C:/Users/你/Downloads/汉仪文黑-85W.ttf"');
  console.log('');
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  process.exit(1);
}

console.log('');
console.log('  ✓ 找到字库：' + picked + '  (' + (statSync(picked).size / 1024 / 1024).toFixed(1) + ' MB)');
mkdirSync(OUT_DIR, { recursive: true });

const ext = extname(picked).toLowerCase();
let installed = '';

if (ext === '.woff2') {
  copyFileSync(picked, OUT_WOFF2);
  installed = OUT_WOFF2;
  console.log('  已经是 woff2，直接放入。');
} else {
  console.log(wantSubset
    ? '  正在裁剪字库（只保留常用字，体积最小）…'
    : '  正在无损压缩成 woff2（保留全部字形）…');
  const pyArgs = wantSubset
    ? [join(ROOT, 'scripts', 'subset-font.py'), picked, OUT_WOFF2]
    : [join(ROOT, 'scripts', 'subset-font.py'), '--no-subset', picked, OUT_WOFF2];
  const py = spawnSync('python', pyArgs, {
    stdio: 'inherit',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }   // 否则 PowerShell 下中文输出会乱码
  });
  if (py.status === 0 && existsSync(OUT_WOFF2)) {
    installed = OUT_WOFF2;
  } else {
    console.log('');
    console.log('  ! 裁剪失败（多半是没装 fonttools），改为直接放入原始文件。');
    console.log('    想减小体积可以执行：python -m pip install fonttools brotli');
    copyFileSync(picked, OUT_RAW);
    installed = OUT_RAW;
  }
}

if (tempDir) rmSync(tempDir, { recursive: true, force: true });

console.log('');
console.log('  ────────────────────────────────────────────');
console.log('  已安装：' + installed.replace(ROOT, '.').replace(/\\\\/g, '/'));
console.log('  体积：' + (statSync(installed).size / 1024 / 1024).toFixed(2) + ' MB');
console.log('  ────────────────────────────────────────────');
console.log('');
console.log('  接下来执行：npm run build');
console.log('  然后刷新页面，设置 → 外观与性能 → 字体 会显示「已加载字库文件」。');
console.log('');
