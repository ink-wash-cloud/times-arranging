import React from 'react';

/**
 * 设置页的分组容器（v1.4.0「清晰版」）。
 *
 * 结构类名统一由 src/styles.css 末尾的「v1.4.0 清晰版」层定义：
 *   .set-group      分组之间的 32px 留白
 *   .set-group-h    16px / 600 的组标题
 *   .set-group-desc 12.5px 的一行说明
 *   .set-group-body 组内卡片 16px 间距
 *
 * 这里只管语义结构，不写死任何视觉值，方便整体调样式。
 */
export default function SettingsSection(props: {
  /** 组标题，比如「外观」「数据与同步」 */
  title: string;
  /** 组标题下那一行说明，一句话讲清这组能干什么 */
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="set-group">
      <h2 className="set-group-h">{props.title}</h2>
      {props.desc ? <div className="set-group-desc">{props.desc}</div> : null}
      <div className="set-group-body">{props.children}</div>
    </section>
  );
}
