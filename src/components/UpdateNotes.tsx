// 版本更新弹窗：版本号变了之后第一次打开应用时弹一次。
//
// 记在 localStorage 里的 seenVersion 是「用户已经看过哪一版」。
// 第一次装（没有这个键）不弹 —— 对新人来说没有「更新」可言，只是记下来。
import React, { useEffect, useState } from 'react';
import { Modal } from './ui';
import { CHANGELOG, notesSince } from '../lib/changelog';
import type { ReleaseNote } from '../lib/changelog';
import { t } from '../lib/i18n';

const SEEN_KEY = 'seenVersion';

function readSeen(): string {
  try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; }
}
function writeSeen(v: string): void {
  try { localStorage.setItem(SEEN_KEY, v); } catch { /* 忽略 */ }
}

/** 更新内容列表，弹窗和设置页共用 */
export function ReleaseList(props: { notes: ReleaseNote[] }) {
  return (
    <div>
      {props.notes.map((r) => (
        <div key={r.v} className="mb12">
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <b style={{ fontSize: 14 }}>v{r.v}</b>
            <span className="muted">{r.date}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9, fontSize: 13.5 }}>
            {r.items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function UpdateNotes() {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<ReleaseNote[]>([]);

  useEffect(() => {
    const seen = readSeen();
    if (!seen) { writeSeen(__APP_VERSION__); return; }   // 第一次装：只记版本，不弹
    if (seen === __APP_VERSION__) return;
    const list = notesSince(seen);
    writeSeen(__APP_VERSION__);
    if (!list.length) return;
    setNotes(list);
    setOpen(true);
  }, []);

  if (!open) return null;
  const total = notes.reduce((n, r) => n + r.items.length, 0);
  return (
    <Modal title={t('已更新到 v{version}', { version: __APP_VERSION__ })} onClose={() => setOpen(false)}
      footer={<button className="btn btn-primary" onClick={() => setOpen(false)}>{t('知道了')}</button>}>
      <div className="muted mb12">
        {t('你上次用的是 v{prev}，这次有 {total} 处变化：', { prev: notes[notes.length - 1].v, total })}
      </div>
      <ReleaseList notes={notes} />
    </Modal>
  );
}

/** 设置里点「查看更新日志」用得到 */
export const ALL_NOTES = CHANGELOG;
