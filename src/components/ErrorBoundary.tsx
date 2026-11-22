import React from 'react';
import { saveAppearance } from '../lib/appearance';
import { t } from '../lib/i18n';

/**
 * 崩溃兜底。
 *
 * 之前任何一处渲染出错，React 会把整棵树卸载掉，用户看到的就是**纯黑屏**——
 * 而且因为出错信息只进了控制台，手机上根本看不到，等于完全没法排查。
 * 这里把错误接住，显示成一张能读、能复制的卡片，并给一个"安全模式"逃生口。
 */

interface State { error: Error | null; info: string; }

/** 最近一次未捕获错误，便于别处展示 */
export const lastCrash: { message: string; at: number } = { message: '', at: 0 };

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null, info: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    lastCrash.message = String(error && error.stack || error);
    lastCrash.at = Date.now();
    // body 的底色来自主题变量（默认深色），不盖掉的话四周会露黑边，看着还是"黑屏"
    try { document.body.style.background = '#fbf5ee'; } catch { /* 忽略 */ }
    try { console.error('[崩溃]', error, info && info.componentStack); } catch { /* 忽略 */ }
    this.setState({ info: String(info && info.componentStack || '').slice(0, 800) });
  }

  /** 安全模式：把可能压垮渲染的外观设置恢复默认（自定义背景图是头号嫌疑），再重启 */
  safeMode = async () => {
    try {
      // 全部换成最省的一档：不要自定义背景图、不要光斑、关晕光、性能档拉满
      await saveAppearance({
        mode: 'preset', preset: 'cream', image: '', imageName: '',
        blobs: false, blobsMove: false, glow: 0, perf: 'ultra'
      });
    } catch { /* 忽略 */ }
    location.reload();
  };

  reload = () => location.reload();

  copy = async () => {
    const text = [
      t('时序 崩溃报告'),
      t('版本 v{v}（构建 {build}）', { v: __APP_VERSION__, build: __BUILD_ID__ }),
      t('时间 {time}', { time: new Date().toISOString() }),
      'UA ' + navigator.userAgent,
      t('地址 {url}', { url: location.href }),
      '',
      String(this.state.error && this.state.error.stack || this.state.error),
      this.state.info
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      alert(t('错误信息已复制，可以直接发给我'));
    } catch {
      alert(text);
    }
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{
        minHeight: '100vh', padding: '28px 18px', boxSizing: 'border-box',
        background: '#fbf5ee', color: '#4b4249',
        font: '14px/1.85 -apple-system, "Noto Sans SC", system-ui, sans-serif'
      }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>😵</div>
          <h1 style={{ fontSize: 19, margin: '0 0 10px' }}>{t('界面出错了')}</h1>
          <p style={{ margin: '0 0 6px', color: '#7b6f76' }}>
            {t('应用遇到了一个错误，所以停在了这里。你的数据没有丢，都在本机／服务器上。可以先把下面这段信息复制发我，我照着修。')}
          </p>
          <p style={{ margin: '0 0 14px', fontSize: 12, color: '#8b7f86' }}>
            {t('版本 v{v} · 构建 {build}', { v: __APP_VERSION__, build: __BUILD_ID__ })}
          </p>

          <pre style={{
            background: '#fff', border: '1px solid rgba(150,124,136,.28)', borderRadius: 12,
            padding: '10px 12px', fontSize: 11.5, lineHeight: 1.6, maxHeight: 220,
            overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
          }}>{String(error && error.stack || error)}{this.state.info ? '\n' + this.state.info : ''}</pre>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
            <button onClick={this.copy} style={btn(true)}>{t('复制错误信息')}</button>
            <button onClick={this.reload} style={btn(false)}>{t('重新加载')}</button>
            <button onClick={this.safeMode} style={btn(false)}>{t('安全模式重启')}</button>
          </div>
          <p style={{ marginTop: 14, fontSize: 12, color: '#8b7f86' }}>
            {t('「安全模式」会把背景板、主题这些外观设置恢复默认（自定义背景图最容易压垮手机渲染），然后再重启一次。数据、课表、待办都不受影响。')}
          </p>
        </div>
      </div>
    );
  }
}

function btn(primary: boolean): React.CSSProperties {
  return {
    border: 'none', borderRadius: 999, padding: '9px 18px', fontSize: 13.5, cursor: 'pointer',
    background: primary ? '#e08fa4' : 'rgba(255,255,255,.85)',
    color: primary ? '#fff' : '#4b4249',
    boxShadow: primary ? '0 6px 16px rgba(224,143,164,.35)' : '0 2px 8px rgba(150,124,136,.18)'
  };
}
