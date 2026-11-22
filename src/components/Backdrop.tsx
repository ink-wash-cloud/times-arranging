import React from 'react';
import { useAppearance, backdropStyle } from '../lib/appearance';

/** 可自定义的应用背景层（不做玻璃/模糊处理，清晰呈现） */
export default function Backdrop() {
  const a = useAppearance();
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="bd-layer" style={backdropStyle(a)} />
      {a.blobs ? (
        <>
          <div className="bd-blob b1" />
          <div className="bd-blob b2" />
          <div className="bd-blob b3" />
        </>
      ) : null}
      <div className="bd-dim" />
    </div>
  );
}
