import React, { useEffect, useRef, useState } from 'react';
import { putRecord, newId } from '../lib/db';
import type { InspirationData, InspirationKind } from '../types';
import { INSPIRATION_KINDS, KIND_ICONS } from '../types';
import { Modal, toast } from './ui';
import { t } from '../lib/i18n';

/** 全局快捷记录：任何页面右下角的 💡 都能一键盘记下一个念头 */
export default function CaptureSheet(props: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<InspirationKind>('灵感');
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (props.open) setTimeout(() => ref.current?.focus(), 60);
  }, [props.open]);

  if (!props.open) return null;

  const save = () => {
    const content = text.trim();
    if (!content) return;
    putRecord<InspirationData>('inspirations', newId(), {
      text: content, kind, tag: '', pinned: false, archived: false, convertedTaskId: null, createdAt: Date.now()
    });
    setText('');
    toast(t('已记入灵感池 ✓'), 'ok');
    props.onClose();
  };

  return (
    <Modal
      title={t('💡 记一个念头')}
      onClose={props.onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={props.onClose}>{t('取消')}</button>
        <button className="btn btn-primary" onClick={save} disabled={!text.trim()}>{t('记下来')}</button>
      </>}
    >
      <textarea
        ref={ref}
        className="textarea"
        style={{ minHeight: 120 }}
        value={text}
        placeholder={t('想到什么就写什么，不用组织语言…（Ctrl / ⌘ + 回车 直接保存）')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }}
      />
      <div className="row-wrap mt12">
        {INSPIRATION_KINDS.map((k) => (
          <button key={k} className={'chip ' + (kind === k ? 'on' : '')} onClick={() => setKind(k)}>{KIND_ICONS[k]} {t(k)}</button>
        ))}
      </div>
    </Modal>
  );
}
