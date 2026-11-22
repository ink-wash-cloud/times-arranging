import React, { useMemo, useRef, useState } from 'react';
import { list, useDB, putRecord, patchRecord, removeRecord, newId, withoutId } from '../lib/db';
import type { Item } from '../lib/db';
import type { InspirationData, InspirationKind, TaskData } from '../types';
import { INSPIRATION_KINDS, KIND_COLORS, KIND_ICONS } from '../types';
import { Modal, Field, toast, askConfirm, Empty, Tag } from '../components/ui';
import { fromNow, fullTime, todayStr } from '../lib/date';
import { t } from '../lib/i18n';

type FilterKey = '全部' | '未整理' | '已置顶' | '已转化' | '已归档';
const FILTERS: FilterKey[] = ['全部', '未整理', '已置顶', '已转化', '已归档'];

export default function Inspiration() {
  useDB();
  const all = list<InspirationData>('inspirations');

  const [draft, setDraft] = useState('');
  const [kind, setKind] = useState<InspirationKind>('灵感');
  const [filter, setFilter] = useState<FilterKey>('全部');
  const [kw, setKw] = useState('');
  const [editing, setEditing] = useState<Item<InspirationData> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const sorted = useMemo(() => {
    return all.slice().sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }, [all]);

  const shown = useMemo(() => {
    let t = sorted;
    if (filter === '未整理') t = t.filter((x) => !x.archived && !x.convertedTaskId);
    else if (filter === '已置顶') t = t.filter((x) => x.pinned && !x.archived);
    else if (filter === '已转化') t = t.filter((x) => !!x.convertedTaskId);
    else if (filter === '已归档') t = t.filter((x) => x.archived);
    else t = t.filter((x) => !x.archived);
    if (kw.trim()) {
      const k = kw.trim().toLowerCase();
      t = t.filter((x) => (x.text + ' ' + x.tag + ' ' + x.kind).toLowerCase().includes(k));
    }
    return t;
  }, [sorted, filter, kw]);

  const todayCount = all.filter((x) => new Date(x.createdAt).toDateString() === new Date().toDateString()).length;
  const converted = all.filter((x) => x.convertedTaskId).length;

  const save = () => {
    const text = draft.trim();
    if (!text) { inputRef.current?.focus(); return; }
    putRecord<InspirationData>('inspirations', newId(), {
      text, kind, tag: '', pinned: false, archived: false, convertedTaskId: null, createdAt: Date.now()
    });
    setDraft('');
    toast(t('已记下 ✓'), 'ok');
    inputRef.current?.focus();
  };

  const toTask = (it: Item<InspirationData>) => {
    if (it.convertedTaskId) { toast(t('这条已经转化过待办了'), 'info'); return; }
    const firstLine = it.text.split('\n')[0].trim();
    const title = (firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine) || t('来自灵感池');
    const taskId = newId();
    putRecord<TaskData>('tasks', taskId, {
      title, category: '杂事', dueDate: null, dueTime: null, priority: 'P2', status: '未开始',
      estimateMinutes: 30, repeat: '不重复',
      note: it.text.length > title.length ? it.text : '', anniversaryId: null, completedAt: null, createdAt: Date.now()
    });
    patchRecord<InspirationData>('inspirations', it.id, { convertedTaskId: taskId });
    toast(t('已放入待办时间池'), 'ok');
  };

  return (
    <>
      {/* 快速记录 */}
      <div className="card mb12 cap-card">
        <div className="card-h">
          <span className="ico">💡</span>
          <h3>{t('随手记')}</h3>
          <div className="right">
            <span className="muted">{t('回车保存 · Shift + 回车换行')}</span>
          </div>
        </div>
        <textarea
          ref={inputRef}
          className="textarea cap-input"
          value={draft}
          autoFocus
          placeholder={t('一瞬即逝的念头、路上看到的事、想说的一句话……先记下来，之后再说')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
          }}
        />
        <div className="row chip-row mt8" data-slide style={{ gap: 6 }}>
          {INSPIRATION_KINDS.map((k) => (
            <button key={k} className={'chip ' + (kind === k ? 'on' : '')} onClick={() => setKind(k)}>
              {KIND_ICONS[k]} {t(k)}
            </button>
          ))}
          <div className="spacer" />
          <button className="btn btn-primary" onClick={save} disabled={!draft.trim()}>{t('记下来')}</button>
        </div>
      </div>

      {/* 统计与筛选 */}
      <div className="card mb12">
        <div className="row-wrap">
          <div className="row chip-row" data-slide style={{ gap: 4 }}>
            {FILTERS.map((f) => (
              <button key={f} className={'chip ' + (filter === f ? 'on' : '')} onClick={() => setFilter(f)}>{t(f)}</button>
            ))}
          </div>
          <div className="spacer" />
          <input className="input" style={{ maxWidth: 190 }} placeholder={t('搜索灵感…')} value={kw} onChange={(e) => setKw(e.target.value)} />
        </div>
        <div className="muted mt8">
          {t('共 {n} 条 · 今天新增 {today} 条 · 已转化为待办 {converted} 条 · 已归档 {archived} 条', { n: all.length, today: todayCount, converted, archived: all.filter((x) => x.archived).length })}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card">
          <Empty
            icon="💡"
            text={all.length === 0 ? t('灵感池是空的') : t('这个筛选下没有内容')}
            hint={all.length === 0 ? t('上面写下第一条 —— 不用想格式，回车就存') : t('换个筛选条件试试')}
          />
        </div>
      ) : (
        <div className="ins-grid">
          {shown.map((it) => (
            <div key={it.id} className={'ins-card' + (it.pinned ? ' pinned' : '') + (it.archived ? ' archived' : '')}>
              <div className="ins-top">
                <span className="ins-kind" style={{ color: KIND_COLORS[it.kind], borderColor: KIND_COLORS[it.kind] + '66', background: KIND_COLORS[it.kind] + '1f' }}>
                  {KIND_ICONS[it.kind]} {t(it.kind)}
                </span>
                <span className="muted" title={fullTime(it.createdAt)}>{fromNow(it.createdAt)}</span>
                <div className="spacer" />
                <button className={'ins-icon' + (it.pinned ? ' on' : '')} title={it.pinned ? t('取消置顶') : t('置顶')}
                  onClick={() => patchRecord<InspirationData>('inspirations', it.id, { pinned: !it.pinned })}>📌</button>
              </div>

              <div className="ins-text" onClick={() => setEditing(it)}>{it.text}</div>

              <div className="ins-tags">
                {it.tag ? <Tag text={'#' + it.tag} color="#8aa9e8" /> : null}
                {it.convertedTaskId ? <Tag text={t('已转为待办')} color="#77c39b" /> : null}
                {it.archived ? <Tag text={t('已归档')} color="#ada6bb" /> : null}
              </div>

              <div className="ins-foot">
                <button className="btn btn-sm" disabled={!!it.convertedTaskId} onClick={() => toTask(it)}>
                  {it.convertedTaskId ? t('已转待办') : t('转为待办')}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(it)}>{t('编辑')}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => {
                  patchRecord<InspirationData>('inspirations', it.id, { archived: !it.archived });
                  toast(it.archived ? t('已移回列表') : t('已归档'), 'info');
                }}>{it.archived ? t('移回') : t('归档')}</button>
                <button className="btn btn-sm btn-danger" onClick={async () => {
                  const ok = await askConfirm(t('删除这条记录'), t('删除后还能撤销，也会同步到其他设备。'), { okText: t('删除'), danger: true });
                  if (!ok) return;
                  removeRecord('inspirations', it.id);
                  toast(t('已删除'), 'ok', {
                    label: t('撤销'),
                    run: () => {
                      putRecord<InspirationData>('inspirations', it.id, withoutId(it));
                      toast(t('已恢复'), 'ok');
                    }
                  });
                }}>{t('删除')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <Editor item={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function Editor(props: { item: Item<InspirationData>; onClose: () => void }) {
  const [f, setF] = useState<InspirationData>({ ...props.item });
  const set = (p: Partial<InspirationData>) => setF((prev) => ({ ...prev, ...p }));

  return (
    <Modal
      title={t('编辑这条记录')}
      onClose={props.onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={props.onClose}>{t('取消')}</button>
        <button className="btn btn-primary" onClick={() => {
          if (!f.text.trim()) { toast(t('内容不能为空'), 'err'); return; }
          putRecord<InspirationData>('inspirations', props.item.id, { ...f, text: f.text.trim() });
          toast(t('已保存'), 'ok');
          props.onClose();
        }}>{t('保存')}</button>
      </>}
    >
      <div className="form-grid">
        <Field label={t('内容')} full>
          <textarea className="textarea" style={{ minHeight: 130 }} value={f.text} onChange={(e) => set({ text: e.target.value })} />
        </Field>
        <Field label={t('类型')}>
          <div className="row" style={{ gap: 4 }}>
            {INSPIRATION_KINDS.map((k) => (
              <button key={k} className={'chip ' + (f.kind === k ? 'on' : '')} onClick={() => set({ kind: k })}>{KIND_ICONS[k]} {t(k)}</button>
            ))}
          </div>
        </Field>
        <Field label={t('标签')} hint={t('便于以后归拢，例如：选题 / 产品 / 读书')}>
          <input className="input" value={f.tag} onChange={(e) => set({ tag: e.target.value })} placeholder={t('不加也行')} />
        </Field>
      </div>
      <div className="muted mt12">{t('记于 {time}', { time: fullTime(f.createdAt) })}</div>
    </Modal>
  );
}
