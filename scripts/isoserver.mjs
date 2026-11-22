// 测试专用隔离服务器：临时起一个实例 + 临时数据库。
// 测试脚本会大量新建/改动数据，跑在真实库上会污染你自己的数据，
// 所以除了显式传 URL 的情况，一律用这个。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let child = null;
let dir = null;
let log = '';

/** 服务器自己打印的东西（排查"为什么退了"时很有用） */
export function isolatedLog() { return log; }

/**
 * 端口是不是已经被别人占了。
 *
 * 起因：8790 上常驻着 InkMusic，以前这里会傻等 20 秒再说「启动超时」，
 * 看起来像时序服务器挂了，其实是端口压根没抢到。
 */
async function portBusy(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => s.close(() => resolve(false)));
    s.listen(port, '127.0.0.1');
  });
}

export async function startIsolatedServer(port, extraEnv = {}) {
  if (await portBusy(port)) {
    throw new Error('端口 ' + port + ' 已经被别的程序占用，换一个端口（环境变量或直接改脚本里的默认值）再跑');
  }
  dir = mkdtempSync(join(tmpdir(), 'shixu-test-'));
  log = '';
  const url = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', ...extraEnv }
  });
  child.stdout.on('data', (d) => { log += String(d); });
  child.stderr.on('data', (d) => { log += String(d); });
  child.on('exit', (code) => { log += '\n[进程退出 code=' + code + ']\n'; });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(url + '/api/health'); if (r.ok) return url; } catch { /* 还在启动 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('隔离服务器启动超时（端口 ' + port + '）');
}

export function stopIsolatedServer() {
  if (child) { try { child.kill(); } catch { /* 已退出 */ } child = null; }
  child = null;
  if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ } dir = null; }
}
