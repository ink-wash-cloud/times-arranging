// 通用 UI 组件：模态框 / 环形进度 / 轻提示 / 确认框
import React, { useEffect, useState } from 'react';
import { t } from '../lib/i18n';

/**
 * 弹窗栈。后开的压在上面（确认框常在编辑弹窗里打开），
 * Escape / Tab 陷阱只归最上面那个，否则一次 Escape 会把下面那层一起关掉。
 */
const modalStack: object[] = [];

export function Modal(props: {
  title?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  footer?: React.ReactNode;
}) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  // 在"还没挂载"的第一次渲染时记下是谁打开的弹窗（此时 DOM 未变，activeElement 就是那个按钮）。
  // 不能放到 useEffect 里取：那时子组件的 autoFocus 已经把焦点挪进弹窗了。
  const triggerRef = React.useRef<HTMLElement | null | undefined>(undefined);
  if (triggerRef.current === undefined) triggerRef.current = document.activeElement as HTMLElement | null;

  // onClose 每次渲染都是新函数，放依赖里会让清理逻辑（把焦点还回去）在弹窗还开着时就跑一遍
  const onCloseRef = React.useRef(props.onClose);
  onCloseRef.current = props.onClose;

  useEffect(() => {
    const token = {};
    modalStack.push(token);
    const isTop = () => modalStack[modalStack.length - 1] === token;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isTop()) onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 焦点陷阱：Tab 只在弹窗里转圈，不能跑到背后的页面去（键盘用户会直接"掉进"背景）
    const SEL = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => {
      const box = boxRef.current;
      if (!box) return [] as HTMLElement[];
      return Array.from(box.querySelectorAll<HTMLElement>(SEL))
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
    };
    // 打开时把焦点送进弹窗（第一次 Tab 从弹窗里开始）
    // 子组件自己 autoFocus 过的就别抢（比如记支出的金额框）
    if (!boxRef.current?.contains(document.activeElement)) {
      const autofocus = boxRef.current?.querySelector<HTMLElement>('[data-autofocus]');
      // 优先送到第一个输入框，而不是右上角的 ✕
      const firstInput = boxRef.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
      if (autofocus) autofocus.focus();
      else if (firstInput) firstInput.focus();
      else {
        const all = focusables();
        if (all.length) all[0].focus();
      }
    }

    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTop()) return;
      const all = focusables();
      if (!all.length) { e.preventDefault(); return; }
      const first = all[0];
      const last = all[all.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && !!boxRef.current?.contains(active);
      if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onTab, true);

    return () => {
      const at = modalStack.indexOf(token);
      if (at >= 0) modalStack.splice(at, 1);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onTab, true);
      document.body.style.overflow = prevOverflow;
      // 关掉之后焦点还给点开它的那个按钮，别让键盘用户回到页面顶部
      const back = triggerRef.current;
      if (back && document.contains(back) && typeof back.focus === 'function') back.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className={'modal' + (props.wide ? ' wide' : '')} ref={boxRef} role="dialog" aria-modal="true">
        {props.title ? (
          <div className="card-h" style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 16 }}>{props.title}</h3>
            <div className="right">
              <button className="btn btn-ghost btn-sm" onClick={props.onClose} aria-label={t('关闭')}>✕</button>
            </div>
          </div>
        ) : null}
        {/* 内容自己滚（标题和底部按钮钉住）：晕光层挂在 .modal 上，
            弹窗本体不滚，光斑才会一直跟着鼠标 —— 更新日志那种几千像素的长列表尤其明显 */}
        <div className="modal-body">{props.children}</div>
        {props.footer ? <div className="modal-foot">{props.footer}</div> : null}
      </div>
    </div>
  );
}

export function Ring(props: {
  value: number; size?: number; stroke?: number; color?: string; color2?: string;
  children?: React.ReactNode;
}) {
  const size = props.size || 108;
  const stroke = props.stroke || 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, props.value || 0));
  const id = 'g' + Math.round(size) + String(props.color || '').replace('#', '');
  const c1 = props.color || '#6d8bff';
  const c2 = props.color2 || '#a06bff';
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.09)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={'url(#' + id + ')'} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c.toFixed(2)} strokeDashoffset={(c * (1 - pct / 100)).toFixed(2)}
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.4,0,.2,1)' }}
        />
      </svg>
      <div className="val">{props.children}</div>
    </div>
  );
}

export function Bar(props: { value: number; tone?: 'good' | 'warn' | 'bad' | ''; thin?: boolean }) {
  const v = Math.max(0, Math.min(100, props.value || 0));
  return (
    <div className={'bar' + (props.thin ? ' thin' : '') + ' ' + (props.tone || '')}>
      <i style={{ width: v + '%' }} />
    </div>
  );
}

export function Empty(props: { icon?: string; text: string; hint?: string }) {
  return (
    <div className="empty">
      <span className="big">{props.icon || '🗂️'}</span>
      <div>{props.text}</div>
      {props.hint ? <div style={{ marginTop: 4, fontSize: 12, opacity: .75 }}>{props.hint}</div> : null}
    </div>
  );
}

/* -------------------------------- 轻提示 -------------------------------- */
interface ToastItem { id: number; msg: string; kind: 'ok' | 'err' | 'info'; action?: { label: string; run: () => void }; }
let toastSeq = 0;
let items: ToastItem[] = [];
const toastSubs = new Set<(v: ToastItem[]) => void>();

function dropToast(id: number) {
  items = items.filter((x) => x.id !== id);
  toastSubs.forEach((f) => f(items));
}

/**
 * 轻提示。第三个参数给一个动作按钮——删除类操作靠它提供「撤销」，
 * 免得手一滑点错就永久没了（删除还会同步到别的设备）。
 */
export function toast(msg: string, kind: 'ok' | 'err' | 'info' = 'info', action?: { label: string; run: () => void }) {
  const it: ToastItem = { id: ++toastSeq, msg, kind, action };
  items = items.concat([it]);
  toastSubs.forEach((f) => f(items));
  // 带撤销的留久一点，够手指找到并点下去
  setTimeout(() => dropToast(it.id), action ? 6500 : 2600);
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    const f = (v: ToastItem[]) => setList(v.slice());
    toastSubs.add(f);
    return () => { toastSubs.delete(f); };
  }, []);
  return (
    <div className="toast-wrap">
      {list.map((item) => (
        <div key={item.id} className={'toast ' + (item.kind === 'ok' ? 'ok' : item.kind === 'err' ? 'err' : '')}>
          <span>{item.msg}</span>
          {item.action && (
            <button className="toast-act" onClick={() => {
              const run = item.action!.run;
              dropToast(item.id);
              run();
            }}>{item.action.label}</button>
          )}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- 确认框 -------------------------------- */
interface ConfirmReq { title: string; body?: string; okText?: string; danger?: boolean; resolve: (v: boolean) => void; }
let confirmReq: ConfirmReq | null = null;
const confirmSubs = new Set<(v: ConfirmReq | null) => void>();

export function askConfirm(title: string, body?: string, opts?: { okText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    confirmReq = { title, body, okText: opts?.okText, danger: opts?.danger, resolve };
    confirmSubs.forEach((f) => f(confirmReq));
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(confirmReq);
  useEffect(() => {
    const f = (v: ConfirmReq | null) => setReq(v);
    confirmSubs.add(f);
    return () => { confirmSubs.delete(f); };
  }, []);
  if (!req) return null;
  const close = (v: boolean) => {
    confirmReq = null;
    confirmSubs.forEach((f) => f(null));
    req.resolve(v);
  };
  return (
    <Modal
      title={req.title}
      onClose={() => close(false)}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => close(false)}>{t('取消')}</button>
          <button className={'btn ' + (req.danger ? 'btn-danger' : 'btn-primary')} onClick={() => close(true)}>
            {req.okText || t('确定')}
          </button>
        </>
      }
    >
      <div style={{ color: 'var(--dim)', fontSize: 13.5 }}>{req.body || t('此操作不可撤销，确定继续吗？')}</div>
    </Modal>
  );
}

/* -------------------------------- 表单件 -------------------------------- */
export function Field(props: { label: string; children: React.ReactNode; full?: boolean; hint?: string }) {
  return (
    <div className={'field' + (props.full ? ' full' : '')}>
      <label>{props.label}</label>
      {props.children}
      {props.hint ? <div className="muted" style={{ fontSize: 11 }}>{props.hint}</div> : null}
    </div>
  );
}

export function Seg<T extends string>(props: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {props.options.map((o) => (
        <button key={o} className={props.value === o ? 'on' : ''} onClick={() => props.onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

export function Tag(props: { text: string; color?: string }) {
  const c = props.color || '#8b93a7';
  return <span className="tag" style={{ background: c + '26', color: c, border: '1px solid ' + c + '55' }}>{props.text}</span>;
}
