// 液态玻璃「晕光」引擎
// 桌面：光标靠近玻璃表面时按距离浮现淡淡的柔光（越近越亮）
// 手机：点击任意玻璃/按钮时产生一次扩散晕光
//
// 性能要点（实测样式重算是最大开销：自定义属性会沿继承链让整棵子树失效）
//   1) 更新频率限到 ~38Hz —— 柔光是模糊光斑，肉眼分辨不出 60Hz 与 38Hz
//   2) 位置量化到 6px、强度量化到 0.06，值没变就完全不碰样式
//   3) 不再维护"注册表 + MutationObserver"：每次重算现查 DOM。
//      querySelectorAll + 十几个 getBoundingClientRect 在干净的布局下只要几十微秒，
//      比"注册表过期导致漏注册 / 全量重测导致卡顿"可靠得多。

const HOVER_SEL = '.card, .col, .widget, .modal, .toast, .sidebar, .topbar, .tabbar, .glass, .glow';
const TAP_SEL = HOVER_SEL + ', .btn, .chip, .nav-item, .tab, .task-item, .pool-item, .day-course, .swatch, .ins-card';

type St = { glow: number; mx: number; my: number };
const state = new Map<HTMLElement, St>();

const RADIUS = 165;        // 感应半径 px
const QUANT = 0.06;        // 强度量化步长
const POS_QUANT = 6;       // 位置量化步长 px
const MIN_INTERVAL = 26;   // 两次重算之间的最小间隔 ms（≈38Hz）

let hoverCapable = false;
let rafId = 0;
let trailing = 0;
let lastApplied = 0;
let px = -99999, py = -99999;

function decorate(el: HTMLElement) {
  el.classList.add('g-glow');
  // 圆角足够大的（胶囊）让光斑也走胶囊形状
  if (parseFloat(getComputedStyle(el).borderTopLeftRadius) >= 40) el.classList.add('g-round');
}

const offTimers = new WeakMap<HTMLElement, number>();

function lit(el: HTMLElement, st: St, q: number, mx: number, my: number) {
  const t = offTimers.get(el);
  if (t) { clearTimeout(t); offTimers.delete(el); }
  if (!el.classList.contains('g-on')) el.classList.add('g-on');
  if (Math.abs(q - st.glow) >= QUANT / 2) { el.style.setProperty('--glow', q.toFixed(2)); st.glow = q; }
  if (Math.abs(mx - st.mx) >= POS_QUANT) { el.style.setProperty('--mx', mx + 'px'); st.mx = mx; }
  if (Math.abs(my - st.my) >= POS_QUANT) { el.style.setProperty('--my', my + 'px'); st.my = my; }
}

function unlit(el: HTMLElement, st: St) {
  if (st.glow !== 0) { el.style.setProperty('--glow', '0'); st.glow = 0; }
  if (!el.classList.contains('g-on')) return;
  if (offTimers.has(el)) return;
  const id = window.setTimeout(() => { offTimers.delete(el); el.classList.remove('g-on'); }, 420);
  offTimers.set(el, id);
}

function distToRect(x: number, y: number, r: DOMRect): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.sqrt(dx * dx + dy * dy);
}

function frame() {
  rafId = 0;
  lastApplied = performance.now();

  const els = document.querySelectorAll<HTMLElement>(HOVER_SEL);
  let live = 0;
  els.forEach((el) => {
    let st = state.get(el);
    if (!st) {
      st = { glow: -1, mx: -9999, my: -9999 };
      state.set(el, st);
      decorate(el);
      // 新元素的 --mx/--my 取指针相对位置，避免第一次写入时跳变
    }
    live++;
    // 正在被拖拽的元素跳过（挂件拖拽时指针一定在它上面，不跳会白算一份样式）
    if (el.classList.contains('dragging')) { unlit(el, st); return; }
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) { unlit(el, st); return; }
    const d = distToRect(px, py, r);
    const target = d >= RADIUS ? 0 : 1 - d / RADIUS;
    const q = Math.round(target / QUANT) * QUANT;
    if (q <= 0) { unlit(el, st); return; }
    // 宿主自己是滚动容器时（如长弹窗），光斑层在滚动内容里，要补上已经滚过的距离，
    // 否则内容一滚光斑就被带走、不再落在指针下面
    const sx = el.scrollLeft;
    const sy = el.scrollTop;
    lit(el, st, q,
      Math.round((px - r.left + sx) / POS_QUANT) * POS_QUANT,
      Math.round((py - r.top + sy) / POS_QUANT) * POS_QUANT);
  });

  // 清理已经离开文档的元素
  if (state.size > live) {
    state.forEach((_v, k) => { if (!document.contains(k)) state.delete(k); });
  }
}

let suspended = false;

/** 拖拽等场景下临时挂起晕光：此时指针忙于拖拽，悬停光效既无意义又白吃性能 */
export function setGlowSuspended(v: boolean) {
  if (suspended === v) return;
  suspended = v;
  if (v) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (trailing) { clearTimeout(trailing); trailing = 0; }
    state.forEach((st, el) => { st.glow = -1; unlit(el, st); });
  }
}

function schedule() {
  if (suspended) return;
  if (!rafId) rafId = requestAnimationFrame(frame);
}

function onPointerMove(ev: PointerEvent) {
  if (!hoverCapable) return;
  px = ev.clientX; py = ev.clientY;
  const wait = MIN_INTERVAL - (performance.now() - lastApplied);
  if (wait <= 0) { schedule(); return; }
  // 补一次尾帧，保证停下时光斑停在指针最终位置
  if (!trailing) trailing = window.setTimeout(() => { trailing = 0; schedule(); }, wait);
}

function clearAll() {
  px = -99999; py = -99999;
  state.forEach((st, el) => { st.glow = -1; unlit(el, st); });
}

/** 点击/触摸时的一次性晕光 */
function burst(el: HTMLElement, x: number, y: number) {
  const r = el.getBoundingClientRect();
  const mx = Math.round(x - r.left + el.scrollLeft);
  const my = Math.round(y - r.top + el.scrollTop);
  el.style.setProperty('--mx', mx + 'px');
  el.style.setProperty('--my', my + 'px');
  const st = state.get(el);
  if (st) { st.mx = mx; st.my = my; }
  const t = offTimers.get(el);
  if (t) { clearTimeout(t); offTimers.delete(el); }
  el.classList.add('g-on');
  el.classList.remove('tapped');
  void el.offsetWidth;                 // 强制重排，让动画重新开始
  el.classList.add('tapped');
  window.setTimeout(() => {
    el.classList.remove('tapped');
    if (!(Number(el.style.getPropertyValue('--glow')) > 0)) el.classList.remove('g-on');
  }, 720);
}

function onPointerDown(ev: PointerEvent) {
  const t = ev.target as HTMLElement | null;
  if (!t || !t.closest) return;
  const host = t.closest(TAP_SEL) as HTMLElement | null;
  if (!host) return;
  burst(host, ev.clientX, ev.clientY);
}

export function initPointerGlow(): () => void {
  // 调试开关：加 ?noglow=1 可彻底停用晕光，用于性能归因
  if (typeof location !== 'undefined' && /[?&]noglow=1/.test(location.search)) return () => {};

  const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
  hoverCapable = mq.matches;
  const onMq = () => { hoverCapable = mq.matches; if (!hoverCapable) clearAll(); };
  mq.addEventListener?.('change', onMq);

  // 提前给玻璃表面打标记类：initPointerGlow 可能在 React 提交之前就跑完了，
  // 所以补几次延时扫描（一次性，不是常驻定时器），让第一次悬停就能立刻出效果。
  const tag = () => {
    document.querySelectorAll<HTMLElement>(HOVER_SEL).forEach((el) => {
      if (!state.has(el)) { state.set(el, { glow: -1, mx: -9999, my: -9999 }); decorate(el); }
    });
  };
  tag();
  const tagTimers = [260, 900, 2200].map((d) => window.setTimeout(tag, d));

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('scroll', onPointerMove as unknown as EventListener, { passive: true, capture: true });
  document.addEventListener('mouseleave', clearAll);

  return () => {
    mq.removeEventListener?.('change', onMq);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('scroll', onPointerMove as unknown as EventListener, true);
    document.removeEventListener('mouseleave', clearAll);
    tagTimers.forEach(clearTimeout);
    if (rafId) cancelAnimationFrame(rafId);
    if (trailing) clearTimeout(trailing);
  };
}

/** 供调试：当前处于发光状态的元素数量 */
export function litCount(): number { return document.querySelectorAll('.g-on').length; }
