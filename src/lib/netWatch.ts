// 换了 Wi-Fi 就自动把电脑找回来。
//
// 手机上报「同步不了」十次有九次是换了网络：回家连家里的 Wi-Fi、到学校连校园网、
// 出门只剩流量。电脑的 IP 一变，手机里存的地址就成了死地址；以前要用户自己去
// 设置页点「自动搜索电脑」，不懂网络的人根本不知道要去点。
//
// 现在系统一报网络变化（原生端是 NetStatus 插件，网页端是 online 事件），我们
// 就自己重连一次：先按现在的地址同步，不行就由 repairConnection 依次试地址池、
// 局域网广播、逐台扫描，找到就把地址换掉。全程不需要用户点什么。
import { isNativeApp } from './native';
import { repairConnection, syncNow } from './db';

export interface NetEvent {
  kind: 'net' | 'online';
  connected?: boolean;
  type?: string;
  at?: number;
}

type NetPlugin = {
  start?: () => Promise<unknown>;
  stop?: () => Promise<unknown>;
  info?: () => Promise<{ connected?: boolean; type?: string }>;
  addListener?: (ev: string, cb: (d: NetEvent) => void) => unknown;
  removeAllListeners?: () => Promise<unknown> | unknown;
};

/** 上一次网络变化后重连的结果（测试和设置页都能读） */
export const netWatchStat = {
  running: false,
  via: 'none' as 'native' | 'web' | 'none',
  events: 0,
  lastAt: 0,
  lastOk: false,
  lastMessage: '',
  lastType: ''
};

function netPlugin(): NetPlugin | null {
  const c = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const p = c && c.Plugins ? (c.Plugins.NetStatus as NetPlugin | undefined) : undefined;
  return p && typeof p.start === 'function' ? p : null;
}

export type NetOutcome = { ok: boolean; message: string; via: string };

/**
 * 装上看门狗。返回解绑函数（页面卸载时调用）。
 * @param onOutcome 重连有结果时回调（App 用它弹 toast；测试也可以接管）
 */
export function startNetWatch(onOutcome?: (r: NetOutcome) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dead = false;

  const run = async () => {
    if (dead) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    // 先按现在的地址同步一次：多数情况下地址还是对的，换网只是断了一下
    let r: NetOutcome;
    const first = await syncNow('network');
    if (first.ok) {
      r = { ok: true, message: first.message, via: 'direct' };
    } else {
      // 同步不通：自己去把电脑找出来（地址池 → 广播 → 扫网段）
      const rep = await repairConnection();
      r = { ok: rep.ok, message: rep.message, via: rep.via };
    }
    if (dead) return;
    netWatchStat.lastAt = Date.now();
    netWatchStat.lastOk = r.ok;
    netWatchStat.lastMessage = r.message;
    netWatchStat.via = netWatchStat.via === 'none' ? 'web' : netWatchStat.via;
    if (onOutcome) onOutcome(r);
  };

  // 网络回调经常连着来好几下（先掉线再连上、先 IPv6 再 IPv4），压成一个节拍
  const fire = (ev: NetEvent) => {
    netWatchStat.events++;
    netWatchStat.lastType = String(ev.type || '');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void run(); }, 700);
  };

  const onOnline = () => fire({ kind: 'online' });

  if (isNativeApp()) {
    const p = netPlugin();
    if (p && p.start) {
      try {
        void p.start();
        if (typeof p.addListener === 'function') {
          p.addListener('change', (d: NetEvent) => {
            // 只说"断了"的时候不用管：等它连上再说
            if (d && d.connected === false) return;
            fire({ kind: 'net', connected: d ? d.connected : true, type: d ? d.type : '', at: d ? d.at : Date.now() });
          });
        }
        netWatchStat.running = true;
        netWatchStat.via = 'native';
      } catch {
        /* 插件没装上就只用网页那套 */
      }
    }
  }
  // 网页端（含电脑端、手机浏览器）也监听一下：至少"断线又连上"能立刻重试
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
  if (!netWatchStat.running) { netWatchStat.running = true; netWatchStat.via = 'web'; }
  // 调试/测试用：挂在 __schedule 上，不 import db（否则和 db→netWatch 成环）
  const w = window as unknown as { __schedule?: Record<string, unknown> };
  if (w.__schedule) w.__schedule.netWatch = netWatchStat;

  return () => {
    dead = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    const p = netPlugin();
    if (p && typeof p.removeAllListeners === 'function') {
      try { void p.removeAllListeners(); } catch { /* 忽略 */ }
    }
    netWatchStat.running = false;
  };
}
