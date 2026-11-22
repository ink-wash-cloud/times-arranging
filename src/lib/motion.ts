// 选项之间的滑动过渡：给一组相邻选项加一个"会滑过去的选中块"
//
// 性能取向：滑块用 transform + width 过渡，且是绝对定位元素，
// 不参与兄弟节点的排版；动画本身走合成器，不占主线程。

const HOST_SEL = '.seg, .tabbar, .nav-list, [data-slide]';

function findActive(host: HTMLElement): HTMLElement | null {
  for (const child of Array.from(host.children)) {
    const el = child as HTMLElement;
    if (el.classList.contains('slide-pill')) continue;
    if (el.classList.contains('on') || el.classList.contains('active')) return el;
  }
  return null;
}

function ensurePill(host: HTMLElement): HTMLElement {
  let pill = host.querySelector(':scope > .slide-pill') as HTMLElement | null;
  if (!pill) {
    pill = document.createElement('span');
    pill.className = 'slide-pill';
    host.insertBefore(pill, host.firstChild);
  }
  return pill;
}

function place(host: HTMLElement, animate: boolean) {
  const pill = ensurePill(host);
  const active = findActive(host);
  if (!active) { pill.style.opacity = '0'; return; }

  const hr = host.getBoundingClientRect();
  const ar = active.getBoundingClientRect();
  const x = ar.left - hr.left + host.scrollLeft;
  const y = ar.top - hr.top + host.scrollTop;

  if (!animate) {
    pill.style.transition = 'none';
    pill.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    pill.style.width = ar.width + 'px';
    pill.style.height = ar.height + 'px';
    // 强制一帧后再恢复过渡，避免首帧从 (0,0) 滑过来
    void pill.offsetWidth;
    pill.style.transition = '';
  } else {
    pill.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
    pill.style.width = ar.width + 'px';
    pill.style.height = ar.height + 'px';
  }
  pill.style.opacity = '1';
}

function initHost(host: HTMLElement) {
  if (host.dataset.slideReady === '1') { place(host, false); return; }
  host.dataset.slideReady = '1';
  host.classList.add('slide-host');
  // 只有本来就是 static 的容器才需要 relative；
  // 直接写 CSS 会把 .tabbar 的 position: fixed 覆盖掉，手机底栏会掉进文档流
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  ensurePill(host);
  // 布局稳定后再定位，避免首帧测量到 0 宽
  requestAnimationFrame(() => place(host, false));

  // 点任意一个选项就滑过去（用捕获阶段，先于 React 的 onClick 完成定位）
  host.addEventListener('pointerdown', (e) => {
    const t = (e.target as HTMLElement).closest('.chip, .seg > button, .tab, .nav-item') as HTMLElement | null;
    // 必须是本容器的直接子元素，避免把旁边的普通按钮误当成选项
    if (!t || t.parentElement !== host || t.classList.contains('slide-pill')) return;
    const hr = host.getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    const pill = ensurePill(host);
    // 点击后立刻滑到目标位置，不等 React 重渲染
    pill.style.transform = 'translate3d(' + (tr.left - hr.left) + 'px,' + (tr.top - hr.top) + 'px,0)';
    pill.style.width = tr.width + 'px';
    pill.style.height = tr.height + 'px';
    pill.style.opacity = '1';
  }, true);

  // 选中态变化 / 尺寸变化后重新对位
  const mo = new MutationObserver(() => place(host, true));
  mo.observe(host, { subtree: true, attributes: true, attributeFilter: ['class'] });
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => place(host, true));
    ro.observe(host);
  }
  window.addEventListener('resize', () => place(host, true));
}

export function initSlidingIndicators(): () => void {
  const seen = new WeakSet<HTMLElement>();
  const scan = () => {
    document.querySelectorAll<HTMLElement>(HOST_SEL).forEach((h) => {
      if (seen.has(h)) return;
      seen.add(h);
      initHost(h);
    });
  };
  scan();
  // 视图切换会重建 DOM，用 MutationObserver 增量补挂
  const mo = new MutationObserver(() => scan());
  mo.observe(document.body, { childList: true, subtree: true });
  const t = window.setTimeout(scan, 400);
  return () => { mo.disconnect(); window.clearTimeout(t); };
}
