import React, { useEffect } from 'react';
import { pushBackHandler } from '../lib/backNav';
import { t } from '../lib/i18n';

/**
 * 二级页面（仿 iOS 的"点进去看详情"）。
 *
 * 为什么要有它：设置页原来把所有东西堆在一屏，滚动条长得离谱，
 * 用户根本不知道里面还藏着多少项。现在根页面只列"有什么"，
 * 具体调整都放到二级页，返回按钮固定在标题左边，安卓返回键/侧滑也走同一套。
 *
 * 用法：
 *   {page === 'root' ? <列表/> : <SubPage title="..." desc="..." onBack={() => setPage('root')}>...</SubPage>}
 * 注意 SubPage 自己会注册返回键处理器（backNav），卸载时自动注销。
 */
export function SubPage(props: {
  title: string;
  desc?: React.ReactNode;
  onBack: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { onBack } = props;
  useEffect(() => pushBackHandler(() => { onBack(); return true; }), [onBack]);
  return (
    <section className="subpage">
      <div className="subpage-h">
        <button className="subpage-back" onClick={onBack} aria-label={t('返回')}>
          <span className="subpage-back-c" aria-hidden>‹</span>
          <span>{t('返回')}</span>
        </button>
        <div className="subpage-titles">
          <h2 className="subpage-t">{props.title}</h2>
          {props.desc ? <div className="subpage-d">{props.desc}</div> : null}
        </div>
        {props.right ? <div className="subpage-right">{props.right}</div> : null}
      </div>
      <div className="subpage-body">{props.children}</div>
    </section>
  );
}

/** 设置页里的一行：图标 + 标题 + 副标题 + 右侧值 + 箭头。onClick 为空时渲染成静态行 */
export function SetRow(props: {
  icon?: React.ReactNode;
  title: string;
  desc?: React.ReactNode;
  value?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  children?: React.ReactNode;
  testId?: string;
}) {
  const inner = (
    <>
      {props.icon !== undefined && <span className="set-row-ico" aria-hidden>{props.icon}</span>}
      <span className="set-row-main">
        <span className="set-row-t">{props.title}</span>
        {props.desc ? <span className="set-row-d">{props.desc}</span> : null}
      </span>
      {props.value !== undefined && <span className="set-row-v">{props.value}</span>}
      {props.children}
      {props.onClick ? <span className="set-row-chev" aria-hidden>›</span> : null}
    </>
  );
  if (!props.onClick) {
    return <div className={'set-row' + (props.danger ? ' danger' : '')} data-testid={props.testId}>{inner}</div>;
  }
  return (
    <button className={'set-row' + (props.danger ? ' danger' : '')} data-testid={props.testId} onClick={props.onClick}>
      {inner}
    </button>
  );
}
