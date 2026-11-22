// 桌面小组件（手机）：设置页里的一段说明 + 两个手动按钮。
//
// 各家对它的叫法不一样 —— 小组件 / 小部件 / 微件 / 桌面工具，指的都是同一个东西，
// 所以文案里把几种叫法都写出来，用户照着找得到。
import React, { useEffect, useState } from 'react';
import { toast } from './ui';
import { widgetSupported, widgetCount, pushWidget, drainWidgetOps, WIDGET_BLOCKS, widgetBlocks } from '../lib/widget';
import { cfg, saveConfig } from '../lib/db';
import { t, useLang } from '../lib/i18n';

export default function WidgetPanel() {
  useLang();
  const [count, setCount] = useState<number | null>(null);
  const [blocks, setBlocks] = useState<string[]>(widgetBlocks());
  const supported = widgetSupported();

  const refresh = async () => { setCount(await widgetCount()); };
  useEffect(() => { void refresh(); }, []);

  if (!supported) {
    return (
      <div className="card mb12">
        <div className="card-h"><span className="ico">🧩</span><h3>{t('桌面小组件')}</h3></div>
        <div className="muted">
          {t('桌面小组件是手机版才有的功能。手机上装好「时序」之后，回到这里就能看到怎么加到桌面。')}
        </div>
      </div>
    );
  }

  return (
    <div className="card mb12">
      <div className="card-h">
        <span className="ico">🧩</span><h3>{t('桌面小组件')}</h3>
        <div className="right muted">
          {count === null ? '' : count > 0 ? t('桌面上已添加 {n} 个', { n: count }) : t('还没加到桌面')}
        </div>
      </div>
      <div className="muted mb12">
        {t('各家手机的叫法不一样 —— ')}<b>{t('小组件 / 小部件 / 微件 / 桌面工具')}</b>{t('，说的都是它。')}
      </div>
      <div className="muted mb12" style={{ lineHeight: 1.9 }}>
        <b>{t('怎么加到桌面：')}</b>{t('长按桌面空白处 → 找到「小组件」（有的叫「添加工具」「微件」）→')}{' '}{t('在列表里找')} <b>{t('时序 · 今日待办')}</b> → {t('按住拖到桌面上。')}
      </div>
      <div className="muted mb12" style={{ lineHeight: 1.9 }}>
        <b>{t('怎么用：')}</b>{t('桌面上直接看到今天要做什么；')}<b>{t('点一下待办就完成了')}</b>{t('，那一行会立刻从桌面消失，不用打开应用。回到应用时会自动把这些改动同步到电脑那边。')}
      </div>
      <div className="muted mb8"><b>{t('桌面上显示哪些：')}</b>{t('勾选后立刻生效（可以多选）')}</div>
      <div className="mb12">
        {WIDGET_BLOCKS.map((b) => {
          const on = blocks.indexOf(b.id) >= 0;
          return (
            <label key={b.id} className="row" style={{ gap: 8, alignItems: 'flex-start', padding: '6px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={on} onChange={(e) => {
                const next = e.target.checked ? blocks.concat([b.id]) : blocks.filter((x) => x !== b.id);
                // 至少留一项，不然桌面上就是一块空白
                saveConfig({ widgetBlocks: next.length ? next : [b.id] });
                setBlocks(next.length ? next : [b.id]);
                pushWidget(true);
              }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{b.icon} {t(b.name)}</b>
                <div className="muted" style={{ fontSize: 12 }}>{t(b.desc)}</div>
              </span>
            </label>
          );
        })}
      </div>
      <div className="row-wrap" style={{ gap: 8 }}>
        <button className="btn" onClick={async () => { pushWidget(true); await refresh(); toast(t('已把今天的清单推到桌面小组件'), 'ok'); }}>
          {t('刷新小组件')}
        </button>
        <button className="btn" onClick={async () => {
          const n = await drainWidgetOps();
          await refresh();
          toast(n ? t('收回了 {n} 条在桌面上点掉的待办', { n }) : t('桌面上暂时没有待处理的点击'), n ? 'ok' : 'info');
        }}>
          {t('同步桌面上的改动')}
        </button>
      </div>
    </div>
  );
}
