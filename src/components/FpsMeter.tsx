import React, { useEffect, useRef, useState } from 'react';
import { useAppearance } from '../lib/appearance';
import { t } from '../lib/i18n';

/** 常见屏幕刷新率，用于把估算值吸附到合理档位 */
const COMMON_HZ = [30, 48, 60, 90, 120, 144, 165, 240];

function snapHz(raw: number): number {
  if (!isFinite(raw) || raw <= 0) return 0;
  let best = COMMON_HZ[0];
  for (const h of COMMON_HZ) if (Math.abs(h - raw) < Math.abs(best - raw)) best = h;
  // 偏差超过 12% 就不吸附，直接给估算值
  return Math.abs(best - raw) / best > 0.12 ? Math.round(raw) : best;
}

/**
 * 帧率表：同时显示「当前帧率」和「屏幕刷新率」。
 * 屏幕刷新率由 rAF 的最小间隔估算——它反映的是浏览器允许我们跑多快，
 * 也就是 120Hz 手机上到底有没有真的放开 120 帧。
 */
export default function FpsMeter() {
  const a = useAppearance();
  const [fps, setFps] = useState(0);
  const [worst, setWorst] = useState(0);
  const [hz, setHz] = useState(0);
  // hzMax 记录整个会话内见过的最高刷新率：屏幕刷新率是硬件属性，
  // 不该因为我们自己掉帧就被误报成 60Hz
  const ref = useRef({ frames: 0, t0: 0, worst: 0, minDelta: Infinity, hzMax: 0 });

  useEffect(() => {
    if (!a.fpsMeter) return;
    let raf = 0;
    const st = ref.current;
    st.frames = 0; st.t0 = performance.now(); st.worst = 0; st.minDelta = Infinity;
    let last = performance.now();

    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      if (dt > st.worst) st.worst = dt;
      // 忽略明显异常的小间隔（标签页恢复等）
      if (dt > 1 && dt < st.minDelta) st.minDelta = dt;
      st.frames++;
      const span = t - st.t0;
      if (span >= 500) {
        setFps(Math.round((st.frames * 1000) / span));
        setWorst(Math.round(st.worst));
        const now = snapHz(1000 / st.minDelta);
        if (now > st.hzMax) { st.hzMax = now; setHz(now); }
        st.frames = 0; st.t0 = t; st.worst = 0; st.minDelta = Infinity;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [a.fpsMeter]);

  if (!a.fpsMeter) return null;

  const tone = hz > 0
    ? (fps >= hz * 0.92 ? '#34d97a' : fps >= hz * 0.7 ? '#ffb055' : '#ff6b7d')
    : (fps >= 55 ? '#34d97a' : fps >= 40 ? '#ffb055' : '#ff6b7d');

  return (
    <div className="fps-meter" title={t('当前帧率 / 屏幕刷新率 / 最近 0.5 秒内最慢的一帧')}>
      <b style={{ color: tone }}>{fps}</b>
      <span className="fps-sep">/</span>
      <b style={{ color: 'var(--dim)' }}>{hz || '--'}</b>
      <span>{t('FPS / 屏幕 {hz}', { hz: hz ? hz + 'Hz' : '--' })}</span>
      <span>{t('最慢 {ms}ms', { ms: worst })}</span>
    </div>
  );
}
