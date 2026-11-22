import React, { useRef, useState } from 'react';
import {
  useAppearance, saveAppearance, resetAppearance, presetsFor, presetById,
  backdropStyle, fileToDataURL, DIM_BY_THEME, THEME_LABEL,
  currentBgStyle, refreshBgStyle, currentLegibility, accentFor, EMPTY_COLORS, currentFrozen
} from '../lib/appearance';
import type { MotionMode, PerfMode, ThemeId } from '../lib/appearance';
import { parseColor, toHex } from '../lib/contrast';
import { FONT_MODE_LABEL, useFontStatus, ensureWebFont } from '../lib/fonts';
import type { FontMode } from '../lib/fonts';
import { Field, toast } from './ui';
import { t, useLang } from '../lib/i18n';

export const PERF_LABEL: Record<PerfMode, string> = {
  ultra: '极致性能',
  balanced: '均衡（推荐）',
  quality: '画质优先'
};
const PERF_DESC: Record<PerfMode, string> = {
  ultra: '完全关闭背景模糊与混合模式，阴影简化，帧率最高',
  balanced: '只在侧栏/顶栏/底栏/挂件/弹窗这几处保留背景模糊，其余用半透明填充',
  quality: '所有玻璃表面都开启背景模糊，最接近毛玻璃观感，最吃性能'
};

export const MOTION_LABEL: Record<MotionMode, string> = {
  full: '始终开',
  auto: '跟随系统',
  calm: '减弱'
};
const MOTION_DESC: Record<MotionMode, string> = {
  full: '过渡、弹性、滑块滑动都照常播，不受系统「动画效果」开关影响（推荐：关掉它的话整个界面会变成静音版，容易以为是应用的问题）',
  auto: '跟着系统的「减弱动态效果」走：系统开了就自动少动',
  calm: '保留颜色与透明度的变化，去掉位移、循环动画和惯性回弹'
};

/** 一行取色器：选色板、手填色值、或者在"自动"之间切换 */
function ColorRow(props: { label: string; value: string; auto: string; onChange: (v: string) => void }) {
  useLang();
  const shown = props.value || props.auto;
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <input
        type="color"
        value={shown}
        title={props.label}
        onChange={(e) => props.onChange(e.target.value)}
        style={{ width: 44, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,.25)', background: 'transparent', cursor: 'pointer' }}
      />
      <span className="muted" style={{ minWidth: 68 }}>{props.label}</span>
      <input
        className="input"
        style={{ maxWidth: 96 }}
        value={props.value}
        placeholder={t('自动')}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.value
        ? <button className="chip" onClick={() => props.onChange('')} title={t('交回自动：{color}', { color: props.auto })}>{t('自动')}</button>
        : <span className="chip static" style={{ cursor: 'default', fontSize: 11 }}>{props.auto}</span>}
    </div>
  );
}

function FontStatusLine() {
  useLang();
  const st = useFontStatus();
  return (
    <div className="muted" style={{ lineHeight: 1.8 }}>
      {!st.ready && t('正在检测字库…')}
      {st.ready && st.webFontUrl && <span style={{ color: 'var(--good)' }}>{t('✓ 已加载字库文件 {url}（手机端也会生效）', { url: st.webFontUrl })}</span>}
      {st.ready && !st.webFontUrl && st.localInstalled && <span style={{ color: 'var(--good)' }}>{t('✓ 检测到本机已安装汉仪文黑，直接使用（但手机端没有这个字体）')}</span>}
      {st.ready && !st.webFontUrl && !st.localInstalled && (
        <span style={{ color: 'var(--warn)' }}>
          {t('未找到字库：本机未安装汉仪文黑，public/fonts/ 下也没有字库文件，当前回落到系统字体。把 85W 的字库放到')} <b>public/fonts/hanyi-wenhei-85w.woff2</b>{t('（或 .otf / .ttf）即可生效。')}
        </span>
      )}
      {st.ready && !st.webFontUrl && (
        <button className="btn btn-sm btn-ghost" style={{ marginLeft: 8 }}
          onClick={() => { location.reload(); }}>{t('放好后点此重新检测')}</button>
      )}
    </div>
  );
}

export type AppearancePart = 'look' | 'bg' | 'perf' | 'colors' | 'all';

export default function AppearancePanel(props: { part?: AppearancePart }) {
  useLang();
  const part = props.part || 'all';
  // part 把同一张卡拆成二级页：'all' 仍是旧行为，四块全显示。
  const on = (p: Exclude<AppearancePart, 'all'>) => part === 'all' || part === p;
  const a = useAppearance();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  // refreshBgStyle() 里会 emit，所以这里直接读就是最新的
  const style = currentBgStyle();
  const autoOn = !!(a.autoStyle && a.mode === 'image' && a.image);
  // 关掉自动配色后，AI 那套值会固化成快照留在这儿，让用户接着改
  const frozen = currentFrozen();
  // 取色器的兜底值 = 算法当前算出来的颜色，这样"自动"是真的自动，不是写死的色号
  const leg = currentLegibility();
  const acc = accentFor(a);
  const hex = (v: string | null | undefined, fallback: string) => {
    const c = v ? parseColor(v) : null;
    return c ? toHex(c) : fallback;
  };
  const autoAccent = toHex(acc.accent);
  const autoAccent2 = toHex(acc.accent2);
  const autoInk = hex(leg && leg.ink, '#28212a');
  const autoPill = hex(leg && leg.pillA, '#201a22');

  const pickImage = async (file: File) => {
    setBusy(true);
    try {
      const img = await fileToDataURL(file);
      await saveAppearance({ mode: 'image', image: img, imageName: file.name });
      toast(t('背景图片已应用'), 'ok');
    } catch (e) {
      toast(t('图片处理失败：{msg}', { msg: String((e as Error).message || e) }), 'err');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="card mb12">
      <div className="card-h">
        <span className="ico">🎨</span>
        <h3>{t('外观与性能')}</h3>
        <div className="right">
          <button className="btn btn-ghost btn-sm" onClick={async () => { await resetAppearance(); toast(t('已恢复默认外观'), 'ok'); }}>{t('恢复默认')}</button>
        </div>
      </div>

      {on('bg') && (
        <div className="bg-preview mb12" style={backdropStyle(a)}>
          <div className="pv-glass">{t('背景清晰不模糊 · 玻璃靠高光与半透明呈现')}</div>
        </div>
      )}

      {on('look') && (<>
      {/* 整体风格 */}
      <div className="mb12">
        <div className="muted mb8">{t('整体风格')} · {t(THEME_LABEL[a.theme])}</div>
        <div className="seg">
          {(['ins', 'neon'] as ThemeId[]).map((th) => (
            <button key={th} className={a.theme === th ? 'on' : ''}
              onClick={() => saveAppearance({ theme: th, preset: presetsFor(th)[0].id, dim: DIM_BY_THEME[th] })}>
              {t(THEME_LABEL[th])}
            </button>
          ))}
        </div>
      </div>

      {/* 字体 */}
      <div className="mb12">
        <div className="muted mb8">{t('字体')} · {t(FONT_MODE_LABEL[a.font] || FONT_MODE_LABEL.hanyi)}</div>
        <div className="seg mb8">
          {(['hanyi', 'hanyi-title', 'system'] as FontMode[]).map((f) => (
            <button key={f} className={a.font === f ? 'on' : ''} onClick={() => saveAppearance({ font: f })}>
              {f === 'hanyi' ? t('全站 85W') : f === 'hanyi-title' ? t('仅标题 85W') : t('系统默认')}
            </button>
          ))}
        </div>
        <FontStatusLine />
      </div>
      </>)}

      {on('perf') && (<>
      {/* 性能档位 */}
      <div className="mb12">
        <div className="muted mb8">{t('性能档位')} · {t(PERF_LABEL[a.perf])}</div>
        <div className="seg">
          {(['ultra', 'balanced', 'quality'] as PerfMode[]).map((p) => (
            <button key={p} className={a.perf === p ? 'on' : ''} onClick={() => saveAppearance({ perf: p })}>{t(PERF_LABEL[p].replace('（推荐）', ''))}</button>
          ))}
        </div>
        <div className="muted" style={{ marginTop: 6 }}>{t(PERF_DESC[a.perf])}</div>
      </div>

      <label className="row mb12" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={a.fpsMeter} onChange={(e) => saveAppearance({ fpsMeter: e.target.checked })} />
        <span>{t('显示实时帧率（左下角，格式为「当前 FPS / 屏幕刷新率」）')}</span>
      </label>
      {a.fpsMeter && (
        <div className="muted mb12" style={{ lineHeight: 1.9 }}>
          {t('在手机上看这两个数就能判断高刷有没有真正生效：')}<br />
          · {t('后面的数字是屏幕刷新率，120Hz 屏正常会显示 120；')}<br />
          · {t('前面的数字是实际帧率，能贴近屏幕刷新率就说明跑满了；')}<br />
          · {t('如果屏幕显示 120 但帧率长期只有 60，多半是浏览器或系统把网页限到了 60 帧（安卓 Chrome / Edge 一般不限；微信内置浏览器、部分国产浏览器、系统省电模式会限）。')}
        </div>
      )}

      {/* 动效：以前只认系统的 prefers-reduced-motion，系统一关"动画效果"就全静音 */}
      <div className="mb12">
        <div className="muted mb8">{t('动效')} · {t(MOTION_LABEL[a.motion])}</div>
        <div className="seg">
          {(['full', 'auto', 'calm'] as MotionMode[]).map((m) => (
            <button key={m} className={a.motion === m ? 'on' : ''} onClick={() => saveAppearance({ motion: m })}>{t(MOTION_LABEL[m])}</button>
          ))}
        </div>
        <div className="muted" style={{ marginTop: 6, lineHeight: 1.7 }}>{t(MOTION_DESC[a.motion])}</div>
      </div>
      </>)}

      {on('bg') && (<>
      <div className="seg mb12">
        <button className={a.mode === 'preset' ? 'on' : ''} onClick={() => saveAppearance({ mode: 'preset' })}>{t('预设渐变')}</button>
        <button className={a.mode === 'color' ? 'on' : ''} onClick={() => saveAppearance({ mode: 'color' })}>{t('纯色')}</button>
        <button className={a.mode === 'image' ? 'on' : ''} onClick={() => saveAppearance({ mode: 'image' })}>{t('自定义图片')}</button>
      </div>

      {a.mode === 'preset' && (
        <div className="row-wrap mb12">
          {presetsFor(a.theme).map((p) => (
            <div
              key={p.id}
              className={'swatch' + (a.preset === p.id ? ' on' : '')}
              title={t(p.name)}
              onClick={() => saveAppearance({ preset: p.id })}
              style={{ background: 'radial-gradient(circle at 30% 25%, ' + p.a + ', transparent 72%), radial-gradient(circle at 75% 30%, ' + p.b + ', transparent 72%), radial-gradient(circle at 50% 90%, ' + p.c + ', transparent 72%), ' + p.base }}
            >
              <span>{t(p.name)}</span>
            </div>
          ))}
        </div>
      )}

      {a.mode === 'color' && (
        <Field label={t('背景颜色')} full>
          <div className="row">
            <input type="color" value={a.color} onChange={(e) => saveAppearance({ color: e.target.value })}
              style={{ width: 52, height: 36, borderRadius: 11, border: '1px solid rgba(255,255,255,.25)', background: 'transparent', cursor: 'pointer' }} />
            <input className="input" value={a.color} onChange={(e) => saveAppearance({ color: e.target.value })} style={{ maxWidth: 140 }} />
            <span className="muted">{t('选一个低饱和的深色，玻璃质感最好')}</span>
          </div>
        </Field>
      )}

      {a.mode === 'image' && (
        <Field label={t('自定义背景板')} full hint={t('手机点「从相册选」直接进相册；图片只存在本机（IndexedDB），自动压到最长边 1920px，不会上传服务器')}>
          <div className="row-wrap">
            <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
              🖼 {busy ? t('处理中…') : t('从相册选')}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) pickImage(f); }} />
            </label>
            <label className="btn" style={{ cursor: 'pointer' }}>
              📷 {t('现拍一张')}
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) pickImage(f); }} />
            </label>
            {a.image && <button className="btn btn-ghost" onClick={() => saveAppearance({ image: '', imageName: '' })}>{t('移除图片')}</button>}
            {a.imageName ? <span className="muted">{a.imageName}</span> : <span className="muted">{t('尚未选择图片')}</span>}
          </div>
        </Field>
      )}
      </>)}

      {/* 看图配色：这个功能的开关。选了图就一直显示，没选图时置灰并说明原因 */}
      {(part === 'colors' || (part === 'all' && a.mode === 'image')) && (
        <div className="mb12" style={{
          padding: '10px 12px', borderRadius: 14,
          background: 'rgba(125,155,255,.07)', border: '1px dashed rgba(125,155,255,.42)'
        }}>
          <label className="row" style={{ cursor: a.image ? 'pointer' : 'not-allowed', opacity: a.image ? 1 : .55 }}>
            <input type="checkbox" checked={a.autoStyle} disabled={!a.image}
              onChange={(e) => saveAppearance({ autoStyle: e.target.checked })} />
            <span><b>{t('自动配色')}</b> · {t('根据背景图的风格自动调整玻璃通透度和颜色')}</span>
            <span className="spacer" />
            <span className="chip static" style={{ cursor: 'default', fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' }}>
              {!a.image ? t('先选一张图') : a.autoStyle ? t('已开启') : t('已关闭')}
            </span>
          </label>

          {!a.image && (
            <div className="muted mt8">{t('先在「背景」里选一张图片当背景，这个开关就能用了。')}</div>
          )}

          {a.image && a.autoStyle && style && (
            <div className="muted mt8" style={{ lineHeight: 1.9 }}>
              <div className="row-wrap" style={{ gap: 6, marginBottom: 6 }}>
                <span className="chip static" style={{ cursor: 'default' }}>🔍 {t(style.mood)}</span>
                {style.colors.map((c) => (
                  <span key={c} title={c} style={{
                    width: 16, height: 16, borderRadius: 5, background: c,
                    border: '1px solid rgba(150,124,136,.28)', display: 'inline-block'
                  }} />
                ))}
              </div>
              · {t('玻璃通透度定为 {n}%：图越花、反差越大，玻璃就越实，不然底下的图会把字压掉', { n: style.tint })}<br />
              · {t('玻璃底色取图片的平均色往白里拉，只留一点色相，所以卡片会隐约带照片的调子')}<br />
              · {t('背景蒙版强度定为 {n}%，把图片往界面基调上拉一把', { n: Math.round(style.washAlpha * 100) })}
              {style.accent
                ? <><br />· {t('强调色跟着图里的主色走：')}<span style={{ color: style.accent }}>{style.accent}</span> / <span style={{ color: style.accent2 }}>{style.accent2}</span></>
                : <><br />· {t('这张图没有明显主色，强调色沿用主题自带的')}</>}
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-sm btn-ghost" onClick={async () => {
                  const s = await refreshBgStyle();
                  toast(s ? t('已重新识别：{mood}', { mood: t(s.mood) }) : t('这张图没读出结果'), s ? 'ok' : 'err');
                }}>{t('重新识别')}</button>
              </div>
            </div>
          )}
          {a.image && a.autoStyle && !style && <div className="muted mt8">{t('正在分析这张图…')}</div>}
          {a.image && !a.autoStyle && (
            <div className="muted mt8" style={{ lineHeight: 1.9 }}>
              {frozen ? (
                <>
                  <div>{t('已关闭自动调整：')}<b>{t('AI 算出来的这套颜色保留着')}</b>{t('，刚才那一下界面不会跳。')}</div>
                  <div className="row-wrap" style={{ gap: 6, marginTop: 6 }}>
                    {frozen.accent && (
                      <>
                        <span className="chip static" style={{ cursor: 'default' }}>{t('强调色 {color}', { color: frozen.accent })}</span>
                        <span className="chip static" style={{ cursor: 'default' }}>{t('副色 {color}', { color: frozen.accent2 })}</span>
                      </>
                    )}
                    <span className="chip static" style={{ cursor: 'default' }}>{t('玻璃底色 rgb({rgb})', { rgb: frozen.glassRgb })}</span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {t('通透度和背景蒙版已经对齐成 AI 的数值，直接拖下面的滑杆就能在这套配色上接着调； 想改强调色就去下面的「自定义各个部分的颜色」。重新勾上自动配色会重新分析这张图。')}
                  </div>
                </>
              ) : (
                <>{t('已关闭：玻璃通透度、玻璃颜色、强调色都交回给下面的滑杆和主题，完全手动。')}</>
              )}
            </div>
          )}
        </div>
      )}

      {/* 配色强度：自动配色关着的时候也露出来（置灰），免得用户找不到 */}
      {(part === 'colors' || part === 'all') && a.mode === 'image' && a.image && (
        <div className="mb12" style={{
          padding: '10px 12px', borderRadius: 14,
          background: 'rgba(255,255,255,.10)', border: '1px solid rgba(255,255,255,.18)',
          opacity: a.autoStyle ? 1 : .6
        }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{t('配色强度 · AI 分析背景主色')}</span><b>{Math.round(a.styleStrength * 100)}%</b>
          </div>
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            disabled={!a.autoStyle}
            value={Math.round(a.styleStrength * 100)}
            onChange={(e) => saveAppearance({ styleStrength: Number(e.target.value) / 100 })}
          />
          <div className="muted">
            {t('AI 会先分析背景图的色相、明暗和主色占比，再按这个强度把按钮/强调色往图的色调上靠： 0% = 完全用主题自带的颜色，100% = 尽量贴着背景主色。淡冷色的图以前会被判成"没有主色"，于是回落到暖色主题色，出现冷背景配暖按钮 —— 现在也会往图的冷调上靠。')}
            {!a.autoStyle ? t('（打开上面的「自动配色」才会生效）') : ''}
          </div>
        </div>
      )}

      {/* 自定义各部分颜色：算法算出来的每一项都能被手动覆盖 */}
      {on('colors') && (<div className="mb12" data-colors="1" style={{
        padding: '10px 12px', borderRadius: 14,
        background: 'rgba(255,255,255,.10)', border: '1px solid rgba(255,255,255,.18)'
      }}>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={a.customColors} onChange={(e) => saveAppearance({ customColors: e.target.checked })} />
          <span><b>{t('自定义各个部分的颜色')}</b>{t(' · 强调色、文字色、滑块色都可以自己定')}</span>
          <span className="spacer" />
          <span className="chip static" style={{ cursor: 'default', fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' }}>{a.customColors ? t('自定义中') : t('由算法自动')}</span>
        </label>

        {a.customColors && (
          <div className="mt8" style={{ display: 'grid', gap: 6 }}>
            <ColorRow label={t('强调色')} value={a.colors.accent} auto={autoAccent}
              onChange={(v) => saveAppearance({ colors: { ...a.colors, accent: v } })} />
            <ColorRow label={t('副强调色')} value={a.colors.accent2} auto={autoAccent2}
              onChange={(v) => saveAppearance({ colors: { ...a.colors, accent2: v } })} />
            <ColorRow label={t('文字色')} value={a.colors.ink} auto={autoInk}
              onChange={(v) => saveAppearance({ colors: { ...a.colors, ink: v } })} />
            <ColorRow label={t('选中滑块')} value={a.colors.pill} auto={autoPill}
              onChange={(v) => saveAppearance({ colors: { ...a.colors, pill: v } })} />
            <div className="row-wrap" style={{ gap: 6 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => saveAppearance({ colors: { ...EMPTY_COLORS } })}>{t('全部交回自动')}</button>
            </div>
          </div>
        )}

        {leg && (
          <div className="muted mt8" style={{ lineHeight: 1.8 }}>
            · {t('最差情况下的对比度：正文')} <b style={{ color: leg.bodyC >= 4.5 ? 'var(--good)' : 'var(--warn)' }}>{leg.bodyC.toFixed(1)}:1</b>
            {' · '}{t('次要文字')} {leg.dimC.toFixed(1)}:1{' · '}{t('选中滑块')} {leg.pillC.toFixed(1)}:1
            {leg.cardFloor > 0.01 ? t('（为了让字读得出来，卡面不透明度补到 {n}%）', { n: Math.round(leg.cardFloor * 100) }) : ''}
          </div>
        )}
        <div className="muted" style={{ marginTop: 6 }}>
          {t('对比度是按背景最亮和最暗的两端各算一遍、取最差的那个；正文按 WCAG 的 4.5:1 定线， 不够就自动把卡面调实一点、或把字色再拉开，颜色随手改也不会改到看不清。')}
        </div>
      </div>)}

      {/* 背景蒙层：那层让人以为"背景发白/发灰"的雾，可以整层关掉看原图 */}
      {on('bg') && (<>
      <div className="mb12" data-fog-box="1" style={{
        padding: '10px 12px', borderRadius: 14,
        background: 'rgba(255,255,255,.10)', border: '1px solid rgba(255,255,255,.18)'
      }}>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={a.fog !== false}
            onChange={(e) => saveAppearance({ fog: e.target.checked })} />
          <span><b>{t('背景蒙层')}</b>{t(' · 背景上那层白／灰的雾')}</span>
          <span className="spacer" />
          <span className="chip static" style={{ cursor: 'default', fontSize: 11 }}>
            {a.fog !== false ? t('开着') : t('已关闭')}
          </span>
        </label>
        <div className="muted" style={{ marginTop: 6 }}>
          {a.fog !== false
            ? t('关掉后背景直接显示原图或纯色，一层半透明都不压；字还是读得清 —— 自适应算法会按背景明暗把卡面补实一点。')
            : t('已关闭：背景是原图原样，下面的「背景柔化／压暗」不再生效。想再压一层雾随时勾回来。')}
        </div>
      </div>

      <div className="form-grid mt12">
        <Field
          label={(a.theme === 'ins' ? t('背景柔化') : t('背景压暗')) + ' · ' + (a.fog === false
            ? t('已关闭')
            : (autoOn && style ? t('{n}%（自动）', { n: Math.round(style.washAlpha * 100) }) : a.dim + '%'))}
          hint={a.fog === false
            ? t('上面「背景蒙层」关着，这一项不生效')
            : (autoOn && style
              ? t('正在由背景图接管，关掉上面的「自动配色」就能手动拖')
              : (a.theme === 'ins' ? t('用暖白蒙版把背景调柔，建议 10–25%') : t('太亮会压不住玻璃上的文字，建议 25–45%')))}>
          <input className="slider" type="range" min={0} max={70} value={autoOn && style ? Math.round(style.washAlpha * 100) : a.dim}
            disabled={(autoOn && !!style) || a.fog === false}
            onChange={(e) => saveAppearance({ dim: Number(e.target.value) })} />
        </Field>
        <Field label={t('玻璃通透度') + ' · ' + (autoOn && style ? t('{n}%（自动）', { n: style.tint }) : a.tint + '%')}
          hint={autoOn && style ? t('正在由背景图接管，关掉上面的「自动配色」就能手动拖') : t('数值越大玻璃越实、越不透背景；拖到 0 基本就是全清透')}>
          <input className="slider" type="range" min={0} max={45} value={autoOn && style ? style.tint : a.tint}
            disabled={autoOn && !!style}
            onChange={(e) => saveAppearance({ tint: Number(e.target.value) })} />
        </Field>
        <Field label={t('晕光强度') + ' · ' + a.glow + '%'} hint={t('鼠标靠近玻璃时柔光的明显程度')}>
          <input className="slider" type="range" min={0} max={180} value={a.glow}
            onChange={(e) => saveAppearance({ glow: Number(e.target.value) })} />
        </Field>
        <Field label={t('背景光斑')}>
          <div className="column" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={a.blobs} onChange={(e) => saveAppearance({ blobs: e.target.checked })} />
              <span>{t('显示光斑')}</span>
            </label>
            <label className="row" style={{ cursor: 'pointer', opacity: a.blobs ? 1 : .45 }}>
              <input type="checkbox" disabled={!a.blobs} checked={a.blobsMove} onChange={(e) => saveAppearance({ blobsMove: e.target.checked })} />
              <span>{t('让光斑缓慢漂移')}<em className="muted" style={{ fontStyle: 'normal' }}>{t('（会持续重绘，明显吃帧率）')}</em></span>
            </label>
          </div>
        </Field>
      </div>

      <div className="muted mt12">
        {t('当前背景：')}{a.mode === 'preset' ? t('预设「{name}」', { name: t(presetById(a.preset).name) }) : a.mode === 'color' ? t('纯色 {color}', { color: a.color }) : a.image ? t('自定义图片') : t('（未选择图片，回退为预设）')}
        {' · '}{t('外观设置只作用于本设备')}
      </div>
      </>)}
    </div>
  );
}
