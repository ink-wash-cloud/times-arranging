// 长按 / 右键触发一个动作 —— 总览页用它来做「长按移除卡片」。
//
// 为什么用事件委托挂在容器上，而不是给每张卡片套一层组件：
//   · .dash-grid 是按直接子元素排网格的，套一层 div 会把卡片变成"格子里再套一层"
//   · 委托只需要卡片上带 data-card，鼠标 / 触摸 / 右键走同一套判断
//
// 手感与容错：
//   · 按住 220ms 才加 armed 类（普通点击不会闪一下"继续按住"的提示）
//   · 按住 560ms 才真正触发
//   · 中途移动超过 12px 就取消 —— 手机上那多半是在滚动页面
//   · 落在按钮 / 输入框上的长按不触发，免得和卡片里的按钮打架
import { useEffect, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

export interface LongPressOptions {
  /** 命中这些元素才算长按目标，例如 '.dash-card[data-card]' */
  selector: string;
  onLongPress: (el: HTMLElement) => void;
  /** 按住多久触发，默认 480ms（比安卓系统的长按信号早一点，先给自己的反馈） */
  ms?: number;
  /** 按住多久开始给视觉反馈，默认 150ms */
  armAfter?: number;
  /** 手指/鼠标移动超过多少像素就取消，默认 12 */
  moveTolerance?: number;
  /** 命中这些子元素时不触发 */
  ignore?: string;
  /** 视觉反馈用的类名，默认 armed */
  armedClass?: string;
}

const DEFAULT_IGNORE = 'button, a, input, select, textarea, label, [data-nolongpress]';

export function useLongPressContainer(opts: LongPressOptions) {
  const cb = useRef(opts.onLongPress);
  useEffect(() => { cb.current = opts.onLongPress; });

  const st = useRef({
    el: null as HTMLElement | null,
    t1: 0, t2: 0, x: 0, y: 0,
    fired: false
  });

  const handlers = useMemo(() => {
    const cls = opts.armedClass || 'armed';
    const ignore = opts.ignore || DEFAULT_IGNORE;
    const ms = opts.ms ?? 480;
    const armAfter = opts.armAfter ?? 150;
    const tol = opts.moveTolerance ?? 12;

    const cancel = () => {
      const s = st.current;
      if (s.t1) { clearTimeout(s.t1); s.t1 = 0; }
      if (s.t2) { clearTimeout(s.t2); s.t2 = 0; }
      if (s.el) s.el.classList.remove(cls);
      s.el = null;
    };

    return {
      onPointerDown: (e: ReactPointerEvent) => {
        const s = st.current;
        if (e.pointerType === 'mouse' && e.button !== 0) return;   // 只认左键
        const target = e.target as HTMLElement;
        const host = target.closest ? (target.closest(opts.selector) as HTMLElement | null) : null;
        if (!host) return;
        if (target.closest && target.closest(ignore)) return;
        cancel();
        s.el = host; s.x = e.clientX; s.y = e.clientY; s.fired = false;
        s.t1 = window.setTimeout(() => {
          if (s.el !== host) return;
          host.classList.add(cls);
          s.t2 = window.setTimeout(() => {
            if (s.el !== host) return;
            s.fired = true;
            cancel();
            cb.current(host);
          }, Math.max(0, ms - armAfter));
        }, armAfter);
      },
      onPointerMove: (e: ReactPointerEvent) => {
        const s = st.current;
        if (!s.el) return;
        // 手指比鼠标抖，容差放宽一点，不然"按住不动"也会被判成在滚动
        const limit = e.pointerType === 'touch' ? Math.max(tol, 18) : tol;
        if (Math.abs(e.clientX - s.x) > limit || Math.abs(e.clientY - s.y) > limit) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      onContextMenu: (e: ReactMouseEvent) => {
        const target = e.target as HTMLElement;
        const host = target.closest ? (target.closest(opts.selector) as HTMLElement | null) : null;
        if (!host) return;
        if (target.closest && target.closest(ignore)) return;
        e.preventDefault();
        const s = st.current;
        // 安卓的长按：系统大约 500ms 就把 contextmenu 发过来了，这时自己的
        // 定时器往往还没到点。以前这里直接 cancel，等于把"按住不放"这一下
        // 整个吃掉 —— 手机上就表现为"长按完全没反应"。现在把它当成确认信号。
        if (s.el === host) {
          s.fired = true;
          cancel();
          cb.current(host);
          return;
        }
        // 已经触发过、或者正按着别的卡片：这一次当重复信号丢掉，别弹两次
        if (s.el || s.fired) { cancel(); return; }
        cancel();
        st.current.fired = false;   // 电脑右键之后不会再跟着一个 click
        cb.current(host);
      },
      // 长按结束后浏览器还会补一个 click，这里把它吞掉，
      // 免得"松手"顺手点到了卡片里的按钮
      onClickCapture: (e: ReactMouseEvent) => {
        const s = st.current;
        if (!s.fired) return;
        s.fired = false;
        e.preventDefault();
        e.stopPropagation();
      }
    };
  }, [opts.selector, opts.ms, opts.armAfter, opts.moveTolerance, opts.ignore, opts.armedClass]);

  return { handlers };
}
