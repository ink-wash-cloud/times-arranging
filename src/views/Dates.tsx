import React, { useMemo, useState } from 'react';
import { list, useDB, putRecord, patchRecord, removeRecord, newId, withoutId } from '../lib/db';
import type { Item } from '../lib/db';
import type { AnniversaryData, AnniversaryType } from '../types';
import { ANNIVERSARY_TYPES, ANNIVERSARY_ICONS, COURSE_PALETTE } from '../types';
import { Modal, Field, toast, askConfirm, Empty, Bar, Ring } from '../components/ui';
import { todayStr, fmtCN, nextOccurrence, diffDays, parseYMD } from '../lib/date';
import { annStat } from '../lib/logic';
import { bumpAnniversaryProgress } from '../lib/actions';
import { t } from '../lib/i18n';

/** 准备进度的快捷档位（用户点名要 1/2/3/5/25，10 是以前的老档位，保留） */
export const PROGRESS_STEPS = [1, 2, 3, 5, 10, 25];

export default function Dates() {
  useDB();
  const today = todayStr();
  const anns = list<AnniversaryData>('anniversaries');
  const [editing, setEditing] = useState<Item<AnniversaryData> | null>(null);

  const sorted = useMemo(() => {
    return anns.map((a) => ({ a, s: annStat(a, today) })).sort((x, y) => x.s.days - y.s.days);
  }, [anns, today]);

  const hero = sorted.length ? sorted[0] : null;

  const openNew = () => setEditing({
    id: '', title: '', type: '纪念日', icon: '❤️', date: today, repeatYearly: true, progress: 0, note: '', createdAt: Date.now()
  } as Item<AnniversaryData>);

  return (
    <>
      {hero && (
        <div className="card hero mb16">
          <div className="ann-hero">
            <Ring value={hero.s.progress} size={116} stroke={11} color="#a06bff" color2="#6d8bff">
              <b style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{hero.s.progress}<span style={{ fontSize: 14 }}>%</span></b>
              <small>{t('准备进度')}</small>
            </Ring>
            <div style={{ flex: 1, minWidth: 220 }}>
              {/* 一屏最响的数字只留一个：天数用大数字 + 小单位，进度交给左边的环 */}
              <div className="muted">{t('距离下一次')}</div>
              <div className="hero-stat">
                {hero.s.days === 0
                  ? <span className="hero-title">{t('就是今天 🎉')}</span>
                  : <><span className="hero-n">{hero.s.days}</span><span className="hero-u">{t('天后')}</span></>}
              </div>
              <div className="hero-title" style={{ marginTop: 4 }}>{hero.a.icon} {hero.a.title}</div>
              <div className="muted" style={{ fontSize: 'var(--fs-micro)', marginTop: 4 }}>{fmtCN(hero.s.next)} · {t(hero.a.type)}{hero.a.repeatYearly ? ' · ' + t('每年重复') : ' · ' + t('一次性')}</div>
              <div className="mt8"><Bar value={hero.s.progress} /></div>
              <div className="row-wrap mt12" style={{ gap: 6, alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 'var(--fs-cap)', marginRight: 2 }}>{t('加进度')}</span>
                {PROGRESS_STEPS.map((n) => (
                  <button key={n} className="chip" onClick={() => {
                    const v = bumpAnniversaryProgress(hero.a.id, n);
                    toast(t('准备进度 +{n}% → {v}%', { n, v }), 'ok');
                  }}>+{n}%</button>
                ))}
              </div>
              <div className="row mt8" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(hero.a)}>{t('自定义…')}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => {
                  patchRecord<AnniversaryData>('anniversaries', hero.a.id, { progress: 100 });
                  toast(t('已标记为准备完成'), 'ok');
                }}>{t('直接拉满')}</button>
              </div>
              <div className="mt8">
                <ProgressSlider
                  key={hero.a.id + ':' + hero.s.progress}
                  value={hero.s.progress}
                  onCommit={(v) => {
                    patchRecord<AnniversaryData>('anniversaries', hero.a.id, { progress: v });
                    toast(t('准备进度已设为 {v}%', { v }), 'ok');
                  }}
                />
              </div>
            </div>
          </div>
          {hero.a.note ? <div className="muted mt12">{t('备注：{note}', { note: hero.a.note })}</div> : null}
        </div>
      )}

      <div className="card mb12">
        <div className="row-wrap">
          <button className="btn btn-primary" onClick={openNew}>{t('＋ 新建重要日期')}</button>
          <span className="muted">{t('共 {n} 个 · 生日 / 纪念日 / 节日', { n: anns.length })}</span>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="card"><Empty icon="🎂" text={t('还没有重要日期')} hint={t('添加生日、在一起纪念日、考试周等，系统会自动倒计时')} /></div>
      ) : (
        <div className="ann-list">
          {sorted.map(({ a, s }) => (
            <div key={a.id} className="card">
              <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <div style={{ fontSize: 24 }}>{a.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{a.title}</div>
                  <div className="muted">
                    {t(a.type)} · {a.repeatYearly ? t('每年') : t('一次性')} · {a.date}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 17, fontWeight: 600, letterSpacing: '-.2px', fontVariantNumeric: 'tabular-nums' }}>
                    {s.days === 0 ? t('就是今天 🎉') : t('距离还有 {n} 天', { n: s.days })}
                  </div>
                  <div className="muted" style={{ marginTop: 2 }}>{t('下次：{date} · 准备进度 {p}%', { date: fmtCN(s.next), p: s.progress })}</div>
                  <div className="mt8"><Bar value={s.progress} thin /></div>
                </div>
              </div>
              <div className="row mt12" style={{ gap: 6 }}>
                <button className="btn btn-sm" onClick={() => {
                  const v = bumpAnniversaryProgress(a.id, 10);
                  toast(t('准备进度 +10% → {v}%', { v }), 'ok');
                }}>+10%</button>
                <button className="btn btn-sm" onClick={() => setEditing(a)}>{t('编辑')}</button>
                <button className="btn btn-sm btn-danger" onClick={async () => {
                  const ok = await askConfirm(t('删除重要日期'), t('确定删除「{name}」吗？关联的待办不会被删除。', { name: a.title }), { okText: t('删除'), danger: true });
                  if (!ok) return;
                  const snap = withoutId(a as AnniversaryData & { id: string });
                  removeRecord('anniversaries', a.id);
                  toast(t('已删除'), 'ok', {
                    label: t('撤销'),
                    run: () => { putRecord<AnniversaryData>('anniversaries', a.id, snap); toast(t('已恢复'), 'ok'); }
                  });
                }}>删除</button>
              </div>
              {a.note ? <div className="muted mt8">{t('备注：{note}', { note: a.note })}</div> : null}
            </div>
          ))}
        </div>
      )}

      {editing && <AnnEditor ann={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function AnnEditor(props: { ann: Item<AnniversaryData>; onClose: () => void }) {
  const isNew = !props.ann.id;
  const [f, setF] = useState<Item<AnniversaryData>>({ ...props.ann });
  const set = (p: Partial<AnniversaryData>) => setF((prev) => ({ ...prev, ...p }));
  const preview = f.date ? nextOccurrence(f.date, f.repeatYearly) : '';
  const days = preview ? diffDays(todayStr(), preview) : 0;

  const save = () => {
    if (!f.title.trim()) { toast(t('请填写名称'), 'err'); return; }
    if (!f.date) { toast(t('请选择日期'), 'err'); return; }
    putRecord<AnniversaryData>('anniversaries', isNew ? newId() : f.id, {
      ...f, title: f.title.trim(), progress: Math.max(0, Math.min(100, Number(f.progress) || 0))
    });
    toast(isNew ? t('已创建') : t('已保存'), 'ok');
    props.onClose();
  };

  return (
    <Modal title={isNew ? t('新建重要日期') : t('编辑重要日期')} onClose={props.onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={props.onClose}>{t('取消')}</button>
        <button className="btn btn-primary" onClick={save}>{isNew ? t('创建') : t('保存')}</button>
      </>}>
      <div className="form-grid">
        <Field label={t('名称 *')} full>
          <input className="input" autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={t('例如：妈妈生日 / 在一起纪念日 / 期末考试')} />
        </Field>
        <Field label={t('类型')}>
          <div className="row" style={{ gap: 4 }}>
            {ANNIVERSARY_TYPES.map((ty) => (
              <button key={ty} className={'chip ' + (f.type === ty ? 'on' : '')} onClick={() => set({ type: ty })}>{t(ty)}</button>
            ))}
          </div>
        </Field>
        <Field label={t('图标')}>
          <div className="row-wrap">
            {ANNIVERSARY_ICONS.map((i) => (
              <button key={i} className={'chip ' + (f.icon === i ? 'on' : '')} style={{ fontSize: 15 }} onClick={() => set({ icon: i })}>{i}</button>
            ))}
          </div>
        </Field>
        <Field label={t('日期 *')} hint={t('生日请填写出生那年的日期，每年自动顺延')}>
          <input className="input" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <Field label={t('准备进度（%）')} hint={t('0–100 的任意数值，点档位可以累加')} full>
          <div className="row-wrap" style={{ gap: 6, alignItems: 'center' }}>
            <input className="input" style={{ width: 96 }} type="number" min={0} max={100} step={1}
              value={f.progress}
              onChange={(e) => set({ progress: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
            {PROGRESS_STEPS.map((n) => (
              <button key={n} className="chip" onClick={() => set({ progress: Math.min(100, (Number(f.progress) || 0) + n) })}>+{n}%</button>
            ))}
            <button className="chip" onClick={() => set({ progress: 0 })}>{t('清零')}</button>
            <button className="chip" onClick={() => set({ progress: 100 })}>100%</button>
          </div>
          <ProgressSlider value={f.progress} onChange={(v) => set({ progress: v })} />
        </Field>
        <Field label={t('备注')} full>
          <textarea className="textarea" value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder={t('要准备什么？礼物、餐厅、行程…')} />
        </Field>
      </div>
      <label className="row mt12" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={f.repeatYearly} onChange={(e) => set({ repeatYearly: e.target.checked })} />
        <span>{t('每年重复（生日、纪念日、固定节日请勾选；一次性事件如考试请取消）')}</span>
      </label>
      {preview ? (
        <div className="muted mt12">
          {t('下一次：{date}', { date: fmtCN(preview) })} · {days === 0 ? t('就是今天') : t('还有 {n} 天', { n: days })}
        </div>
      ) : null}
    </Modal>
  );
}
/** 准备进度滑杆：绑定本地值，松手（或按键、失焦）才提交，拖动过程中不发写请求 */
function ProgressSlider(props: { value: number; onChange?: (v: number) => void; onCommit?: (v: number) => void }) {
  const controlled = typeof props.onChange === 'function';
  const [local, setLocal] = useState(props.value);
  const v = controlled ? props.value : local;
  const set = (n: number) => { setLocal(n); props.onChange?.(n); };
  const commit = () => {
    if (!controlled && props.onCommit && local !== props.value) props.onCommit(local);
  };
  return (
    <div className="row" style={{ gap: 10, alignItems: 'center' }}>
      <input
        className="range" type="range" min={0} max={100} step={1} value={v} aria-label={t('准备进度')}
        onChange={(e) => set(Number(e.target.value))}
        onPointerUp={commit} onTouchEnd={commit} onKeyUp={commit} onBlur={commit}
        style={{ '--fill': v + '%' } as React.CSSProperties}
      />
      <b style={{ minWidth: 46, textAlign: 'right', fontSize: 13 }}>{v}%</b>
    </div>
  );
}
