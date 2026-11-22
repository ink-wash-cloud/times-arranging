// 多人（多个 agent 并行改代码）时构建必须排队。
// vite 每次都会清空 dist，两个构建撞在一起会产出半个包，
// 跑测试的人会以为是自己哪里改坏了。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const LOCK = join(TMP, 'build.lock');
mkdirSync(TMP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mine = false;
const deadline = Date.now() + 8 * 60 * 1000;
while (Date.now() < deadline) {
  if (!existsSync(LOCK)) {
    writeFileSync(LOCK, String(process.pid) + ' ' + new Date().toISOString());
    mine = true;
    break;
  }
  try {
    const st = statSync(LOCK);
    if (Date.now() - st.mtimeMs > 5 * 60 * 1000) rmSync(LOCK, { force: true });   // 僵尸锁
  } catch { /* 忽略 */ }
  await sleep(1500);
}

if (!mine) {
  console.error('[build-lock] 等锁超时：' + LOCK);
  process.exit(1);
}

let code = 1;
try {
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const r = spawnSync(process.execPath, [vite, 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    // esbuild 的临时目录被安全软件占住会报 Access is denied，统一指到项目内
    env: { ...process.env, TEMP: TMP, TMP }
  });
  code = r.status == null ? 1 : r.status;
} finally {
  try { rmSync(LOCK, { force: true }); } catch { /* 忽略 */ }
}
process.exit(code);
