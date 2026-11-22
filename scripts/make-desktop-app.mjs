#!/usr/bin/env node
/**
 * 把「时序」装成电脑上的应用程序
 *
 *   npm run app                    生成图标 + 建桌面/开始菜单快捷方式
 *   npm run app -- --no-shortcut   只生成图标
 *
 * 做的事：
 *   1. 由 public/icons/icon-512.png 生成多尺寸 Windows 图标 public/icons/shixu.ico
 *   2. 在桌面和开始菜单放一个「时序」快捷方式，指向 启动时序.vbs
 *
 * 快捷方式只是"启动方式"，不动注册表、不写系统目录，删掉 .lnk 就干净了。
 */
import puppeteer from 'puppeteer-core';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PNG = join(ROOT, 'public', 'icons', 'icon-512.png');
const ICO = join(ROOT, 'public', 'icons', 'shixu.ico');
const VBS = join(ROOT, '启动时序.vbs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const NO_SHORTCUT = process.argv.includes('--no-shortcut');

if (!existsSync(SRC_PNG)) {
  console.error('  ✗ 找不到 ' + SRC_PNG + '（先用 npm run build 生成）');
  process.exit(1);
}
if (!existsSync(VBS)) {
  console.error('  ✗ 找不到启动器 ' + VBS);
  process.exit(1);
}

/* ---------- 1. 生成 Windows .ico ---------- */
// ICO 从 Vista 起支持直接内嵌 PNG，不必自己写 BMP 编码器。
// 把常用尺寸都塞进去，Windows 会按需自取（任务栏、开始菜单、Alt+Tab 用的尺寸都不同）。
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const b64 = readFileSync(SRC_PNG).toString('base64');
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

const entries = [];
for (const size of SIZES) {
  const dataUrl = await page.evaluate(async (url, px) => {
    const img = new Image();
    img.src = url;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = px; cv.height = px;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, px, px);
    return cv.toDataURL('image/png');
  }, 'data:image/png;base64,' + b64, size);
  entries.push({ size, png: Buffer.from(dataUrl.split(',')[1], 'base64') });
}
await browser.close();

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);              // reserved
header.writeUInt16LE(1, 2);              // 1 = icon
header.writeUInt16LE(entries.length, 4);

const dir = Buffer.alloc(16 * entries.length);
let offset = 6 + dir.length;
entries.forEach((e, i) => {
  const b = i * 16;
  dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 0);   // 256 用 0 表示
  dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1);
  dir.writeUInt8(0, b + 2);              // 调色板数量（真彩色填 0）
  dir.writeUInt8(0, b + 3);              // reserved
  dir.writeUInt16LE(1, b + 4);           // color planes
  dir.writeUInt16LE(32, b + 6);          // bits per pixel
  dir.writeUInt32LE(e.png.length, b + 8);
  dir.writeUInt32LE(offset, b + 12);
  offset += e.png.length;
});
writeFileSync(ICO, Buffer.concat([header, dir, ...entries.map((e) => e.png)]));
console.log('  ✓ 应用图标  public/icons/shixu.ico  ' + SIZES.join('/') + 'px  ' +
  (readFileSync(ICO).length / 1024).toFixed(1) + ' KB');

if (NO_SHORTCUT) {
  console.log('');
  console.log('  （--no-shortcut：跳过创建快捷方式）');
  process.exit(0);
}

/* ---------- 2. 建快捷方式 ---------- */
// 用 PowerShell 的 WScript.Shell 建 .lnk。
// 写成 UTF-8 BOM 的临时 .ps1 再执行：把中文路径直接塞进 -Command 会因为
// 命令行代码页问题变成乱码，而 PowerShell 5.1 能正确识别带 BOM 的 UTF-8 文件。
// 路径全部用 Join-Path 拼，避免在模板里到处转义反斜杠。
const ps = [
  "$ErrorActionPreference = 'Stop'",
  '$root = $args[0]',
  '$ws = New-Object -ComObject WScript.Shell',
  "$wscript = Join-Path (Join-Path $env:SystemRoot 'System32') 'wscript.exe'",
  "$vbs  = Join-Path $root '启动时序.vbs'",
  "$icon = (Join-Path (Join-Path (Join-Path $root 'public') 'icons') 'shixu.ico') + ',0'",
  '$targets = @(',
  "  (Join-Path ([Environment]::GetFolderPath('Desktop')) '时序.lnk'),",
  "  (Join-Path (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs') '时序.lnk')",
  ')',
  'foreach ($p in $targets) {',
  '  $dir = Split-Path $p -Parent',
  '  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }',
  '  $lnk = $ws.CreateShortcut($p)',
  '  $lnk.TargetPath       = $wscript',
  "  $lnk.Arguments        = '\"' + $vbs + '\"'",
  '  $lnk.WorkingDirectory = $root',
  '  $lnk.IconLocation     = $icon',
  "  $lnk.Description      = '时序 · 个人日程与课表'",
  '  $lnk.Save()',
  '  Write-Output $p',
  '}',
  ''
].join('\n');

const tmp = join(ROOT, '.make-shortcut.tmp.ps1');
mkdirSync(dirname(tmp), { recursive: true });
writeFileSync(tmp, '\ufeff' + ps, 'utf8');
const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp, ROOT], { encoding: 'utf8' });
try { unlinkSync(tmp); } catch { /* 忽略 */ }

if (r.status !== 0) {
  console.error('  ✗ 创建快捷方式失败：' + String(r.stderr || r.stdout || '').trim());
  console.error('    图标已生成，可以手动把「启动时序.vbs」拖到桌面。');
  process.exit(1);
}

console.log('  ✓ 快捷方式');
for (const line of String(r.stdout).split(/\r?\n/).filter(Boolean)) console.log('      ' + line.trim());
console.log('');
console.log('  以后双击桌面的「时序」图标即可启动：');
console.log('    自动在后台拉起同步服务 → 打开无地址栏的应用窗口');
console.log('  不想要了直接删掉这两个快捷方式，不留其他痕迹。');
console.log('');
