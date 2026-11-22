// 设置页（v1.4.1）—— iOS 式二级页面。
//
// 根页只回答"设置里有什么"：四组、每行一句当前值，点进去才是具体调整。
// 二级页的位置记在 src/lib/uiNav.ts（模块级状态），这样从别的页面切回来、
// 或者浏览器/安卓返回键，都能回到"设置根页"而不是停在上次打开的子页。
import React, { useCallback, useEffect, useState } from 'react';
import { cfg, saveConfig, useDB } from '../lib/db';
import { aiReady, loadAiConfig } from '../lib/ai';
import { reminderCfg } from '../lib/reminders';
import {
  useAppearance, THEME_LABEL, THEME_IDS, saveAppearance, resetAppearance, presetsFor, presetById,
  refreshBgStyle, currentAutoSnapshot, currentLegibility, accentFor, DIM_BY_THEME
} from '../lib/appearance';
import type { ThemeId } from '../lib/appearance';
import { settingsPage, openSettingsPage, subscribeSettingsPage } from '../lib/uiNav';
import { LANGS, langMeta, setLang, useLang, t } from '../lib/i18n';
import type { Lang } from '../lib/i18n';
import type { SettingsPageId } from '../lib/uiNav';
import { pushBackHandler } from '../lib/backNav';
import { SubPage, SetRow } from '../components/SubPage';
import SettingsSection from '../components/SettingsSection';
import AppearancePanel, { PERF_LABEL, MOTION_LABEL } from '../components/AppearancePanel';
import ReminderPanel from '../components/ReminderPanel';
import AppDownloadPanel from '../components/AppDownloadPanel';
import DesktopAppPanel from '../components/DesktopAppPanel';
import AiPanel from '../components/AiPanel';
import WidgetPanel from '../components/WidgetPanel';
import SyncSettingsPage from '../components/SyncSettingsPage';
import { Field, Modal, toast } from '../components/ui';
import { FONT_MODE_LABEL, useFontStatus } from '../lib/fonts';
import type { FontMode } from '../lib/fonts';
import { toHex } from '../lib/contrast';
import { ReleaseList, ALL_NOTES } from '../components/UpdateNotes';

const DIR_TEXT: Record<string, string> = { both: '双向同步', push: '只上传', pull: '只下载' };

export default function Settings() {
  const [page, setPage] = useState<SettingsPageId>(() => settingsPage());
  const [helpOpen, setHelpOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const a = useAppearance();
  const lang = useLang();
  useDB();

  useEffect(() => { void loadAiConfig().then(() => setAiOn(aiReady())); }, []);
  // 页面切换由 uiNav 统一广播：调试钩子、返回键、子页里的按钮都走这一条。
  // 挂载时先对齐一次模块状态：切语言会让整页重挂载，不这样做可能停在上一份状态的二级页上。
  useEffect(() => {
    setPage(settingsPage());
    return subscribeSettingsPage(() => setPage(settingsPage()));
  }, []);
  // 切到别的 tab 时由 App 统一把二级页复位到根页（不再在这里做卸载回调：
  // 切语言也会触发卸载，会把正在看的二级页一起清掉）。
  useEffect(() => {
    const el = document.querySelector('.content-inner');
    if (el) el.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [page]);

  const back = useCallback(() => openSettingsPage('root'), []);
  const closeModals = useCallback(() => { setHelpOpen(false); setLogOpen(false); }, []);
  const go = (id: SettingsPageId) => () => openSettingsPage(id);
  // 切语言要两件事：改运行时（立即重渲染）+ 落盘（下次打开还是这个语言）
  const pickLang = (next: Lang) => {
    setLang(next);
    void saveConfig({ lang: next });
    toast(t('已切换到 {lang}', { lang: langMeta(next).native }));
  };

  const bgText = a.mode === 'color' ? t('纯色') : a.mode === 'image' ? t('自定义图片') : t('预设渐变');
  const perfText = t(PERF_LABEL[a.perf].replace('（推荐）', '')) + ' · ' + t(MOTION_LABEL[a.motion]);
  const colorsText = a.customColors ? t('自定义颜色') : t('自动配色');
  const syncText = t(DIR_TEXT[cfg.syncDir] || '双向同步');

  const root = (
    <>
      <SettingsSection title={t('外观')} desc={t('主题、字体、背景、动效与配色，只作用于这台设备。')}>
        <div className="card set-list">
          <SetRow icon="🌏" title={t('语言')} desc={t('界面文字的语言，只对这一台设备生效')}
            value={langMeta(lang).native} onClick={go('lang')} testId="set-row-lang" />
          <SetRow icon="🎨" title={t('主题与字体')} desc={t('奶油风 / 霓虹风，汉仪文黑 85W 或系统字体')}
            value={t(THEME_LABEL[a.theme])} onClick={go('look')} testId="set-row-look" />
          <SetRow icon="🖼️" title={t('背景')} desc={t('预设、纯色、图片与蒙层')}
            value={bgText} onClick={go('bg')} testId="set-row-bg" />
          <SetRow icon="⚡" title={t('性能与动效')} desc={t('性能档位、实时帧率与动效强度')}
            value={perfText} onClick={go('perf')} testId="set-row-perf" />
          <SetRow icon="🎯" title={t('配色与对比度')} desc={t('自动配色、各部分的颜色与对比度读数')}
            value={colorsText} onClick={go('colors')} testId="set-row-colors" />
        </div>
      </SettingsSection>

      <SettingsSection title={t('数据与同步')} desc={t('连接电脑同步，或手动备份、导入导出和重置。')}>
        <div className="card set-list">
          <SetRow icon="🔗" title={t('连接地址')} desc={t('电脑与手机双向同步的服务器地址')}
            value={cfg.serverUrl || t('本机（同源）')} onClick={go('sync')} testId="set-row-sync-addr" />
          <SetRow icon="🔄" title={t('同步与备份')} desc={t('同步方向、备份恢复与重置')}
            value={syncText} onClick={go('sync')} testId="set-row-sync-backup" />
        </div>
      </SettingsSection>

      <SettingsSection title={t('提醒')} desc={t('到点提醒与通知权限。')}>
        <div className="card set-list">
          <SetRow icon="🔔" title={t('提醒设置')} desc={t('事项临近提醒、习惯与纪念日提醒')}
            value={reminderCfg.enabled ? t('已开启') : t('已关闭')} onClick={go('remind')} testId="set-row-remind" />
        </div>
      </SettingsSection>

      <SettingsSection title={t('应用')} desc={t('桌面小组件、安装包与 AI 识别。')}>
        <div className="card set-list">
          <SetRow icon="🧩" title={t('桌面小组件')} desc={t('手机桌面上的今日待办')}
            value={t('手机端')} onClick={go('widget')} testId="set-row-widget" />
          <SetRow icon="📦" title={t('装到电脑 / 手机')} desc={t('桌面独立应用与安卓安装包')}
            value={t('桌面版 · 安卓')} onClick={go('apps')} testId="set-row-apps" />
          <SetRow icon="🤖" title={t('AI 助手')} desc={t('课表截图识别与文本解析')}
            value={aiOn ? t('已配置') : t('未配置')} onClick={go('ai')} testId="set-row-ai" />
          <SetRow icon="📖" title={t('使用说明与更新日志')} desc={t('关于本应用的使用方法与每一次版本变化')}
            value={'v' + __APP_VERSION__} onClick={go('about')} testId="set-row-about" />
        </div>
      </SettingsSection>

      {/* 版本 / 设备 / 同步情况压成一行次要灰字，不占卡片 */}
      <div className="set-about">
        <span>{t('版本 v{ver}（构建 {build}）', { ver: __APP_VERSION__, build: __BUILD_ID__ })}</span>
        <span>{t('本机设备：{name}', { name: cfg.deviceName || t('本设备') })}</span>
        <span>{cfg.serverUrl ? t('数据保存在本地，与服务器双向同步') : t('数据保存在本地，尚未配置服务器')}</span>
      </div>
    </>
  );

  const sub = () => {
    switch (page) {
      case 'lang':
        return (
          <SubPage title={t('语言')} desc={t('界面文字的语言。只改这一台设备，不同步到服务器。')} onBack={back}>
            <LanguagePanel value={lang} onChange={pickLang} />
          </SubPage>
        );
      case 'look':
        return (
          <SubPage title={t('主题与字体')} desc={t('整站主题与字库；只作用于这台设备。')} onBack={back}>
            <ThemeLookPanel />
          </SubPage>
        );
      case 'bg':
        return (
          <SubPage title={t('背景')} desc={t('预设渐变、纯色或自定义图片，以及蒙层和柔化。')} onBack={back}>
            <AppearancePanel part="bg" />
          </SubPage>
        );
      case 'perf':
        return (
          <SubPage title={t('性能与动效')} desc={t('性能档位、实时帧率与动效强度。')} onBack={back}>
            <AppearancePanel part="perf" />
          </SubPage>
        );
      case 'colors':
        return (
          <SubPage title={t('配色与对比度')} desc={t('自动配色强度、各部分的颜色，以及对比度读数。')} onBack={back}>
            <AppearancePanel part="colors" />
          </SubPage>
        );
      case 'sync':
        return (
          <SubPage title={t('数据与同步')} desc={t('电脑与手机双向同步；也可以手动备份、导入导出和重置本机数据。')} onBack={back}>
            <SyncSettingsPage />
          </SubPage>
        );
      case 'remind':
        return (
          <SubPage title={t('提醒')} desc={t('哪些事要在到点前提醒你；通知权限也在这里开。')} onBack={back}>
            <ReminderPanel />
          </SubPage>
        );
      case 'widget':
        return (
          <SubPage title={t('桌面小组件')} desc={t('手机桌面上的今日待办，点一下就能完成。')} onBack={back}>
            <WidgetPanel />
          </SubPage>
        );
      case 'apps':
        return (
          <SubPage title={t('装到电脑 / 手机')} desc={t('桌面独立应用、安卓安装包与安装步骤。')} onBack={back}>
            <DesktopAppPanel />
            <AppDownloadPanel />
          </SubPage>
        );
      case 'ai':
        return (
          <SubPage title={t('AI 助手')} desc={t('用 AI 从课表截图或文本里识别课程；不配置也能用。')} onBack={back}>
            <AiPanel />
          </SubPage>
        );
      case 'about':
        return (
          <SubPage title={t('使用说明与更新日志')} desc={t('关于本应用的使用方法、每一次版本变化，以及换设备时的迁移步骤。')} onBack={back}>
            <div className="card mb12">
              <div className="card-h"><span className="ico">📖</span><h3>{t('使用说明与更新日志')}</h3>
                <div className="right">
                  <button className="btn btn-ghost btn-sm" onClick={() => setHelpOpen(true)}>{t('查看完整说明书')}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setLogOpen(true)}>{t('更新日志')}</button>
                </div>
              </div>
              <div className="muted">{t('关于本应用的使用方法与每一次版本变化，点上面的按钮查看；换设备时的迁移步骤也写在说明书里。')}</div>
            </div>
          </SubPage>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {page === 'root' ? root : sub()}
      {/* 弹窗打开时由这个空组件占住返回键：它是后挂载的，注册顺序在 SubPage 之后，
          返回键才会先关弹窗，而不是先退出二级页。 */}
      {(helpOpen || logOpen) && <ModalBackGuard onClose={closeModals} />}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {logOpen && (
        <Modal title={t('更新日志')} onClose={() => setLogOpen(false)}
          footer={<button className="btn btn-primary" onClick={() => setLogOpen(false)}>{t('知道了')}</button>}>
          <ReleaseList notes={ALL_NOTES} />
        </Modal>
      )}
    </>
  );
}

/** 弹窗打开时占住返回键（后注册优先）：先关弹窗，再谈退二级页。 */
function ModalBackGuard(props: { onClose: () => void }) {
  useEffect(() => pushBackHandler(() => { props.onClose(); return true; }), [props.onClose]);
  return null;
}

function HelpModal(props: { onClose: () => void }) {
  return (
    <Modal wide title={t('时序 · 使用说明书（速览）')} onClose={props.onClose}
      footer={<button className="btn btn-primary" onClick={props.onClose}>{t('知道了')}</button>}>
      <div className="muted" style={{ lineHeight: 2, fontSize: 13 }}>
        <b style={{ color: 'var(--text)' }}>{t('一、手机与电脑如何互通')}</b><br />
        {t('1. 在电脑上启动服务端（npm start），控制台会打印「手机访问」地址；')}<br />
        {t('2. 手机连同一个 WiFi，用浏览器打开该地址；')}<br />
        {t('3. 在手机浏览器菜单里选择「添加到主屏幕」，即可像 App 一样使用；')}<br />
        {t('4. 两端改动会自动双向同步，离线时改动先存本地，联网后自动补传。')}<br /><br />

        <b style={{ color: 'var(--text)' }}>{t('二、导入大学课表')}</b><br />
        {t('我的课表 → 导入课表，三种方式：粘贴文本（每行一门课）、上传 .csv、上传教务系统导出的 .xlsx。')}<br />
        {t('解析后先预览，确认无误再导入；如果学校用「第 3-4 节」，可在导入面板修改节次时间表。')}<br /><br />

        <b style={{ color: 'var(--text)' }}>{t('三、待办与纪念日联动')}</b><br />
        {t('在待办编辑面板选择「关联重要日期」，任务完成时该纪念日准备进度自动 +10%（上限 100%）。')}<br /><br />

        <b style={{ color: 'var(--text)' }}>{t('四、重复任务')}</b><br />
        {t('设为「每天 / 每周 / 每月 / 每年」的待办，完成后会自动生成下一次。')}<br /><br />

        <b style={{ color: 'var(--text)' }}>{t('五、各页面速览')}</b><br />
        · <b>{t('今日总览')}</b>{t('：五张卡片 —— 待办完成度、习惯打卡、最近纪念日倒计时、本月预算使用、人生最新一次。')}<br />
        · <b>{t('待办事项')}</b>{t('：支持类型 / 优先级 / 状态 / 预计耗时 / 重复 / 备注，分「今日 / 未来 7 天 / 已逾期 / 已完成」四栏；不填日期的会进入')}<b>{t('待办时间池')}</b>{t('。')}<br />
        · <b>{t('习惯打卡')}</b>{t('：连续天数自动累计，断签后从 1 天重新开始；可点击一周内的小方格补卡。')}<br />
        · <b>{t('重要日期')}</b>{t('：倒计时 hero 卡 + 准备进度，每次点击 +10%；待办关联后完成也会 +10%。')}<br />
        · <b>{t('我的课表')}</b>{t('：支持粘贴文本 / CSV / Excel 导入，设置开学日期后自动计算教学周与单双周。')}
      </div>
    </Modal>
  );
}
/* ---------------- 主题与字体（四档：手选两档 + 随图生成 + 自定义） ---------------- */

function LookFontStatus() {
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

function ColorField(props: { label: string; value: string; auto: string; testId: string; onChange: (v: string) => void }) {
  useLang();
  const shown = props.value || props.auto;
  return (
    <div className="field">
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: '0 0 auto' }}>{props.label}</span>
        <input
          type="color"
          value={shown}
          title={props.label}
          data-testid={props.testId}
          onChange={(e) => props.onChange(e.target.value)}
          style={{ width: 44, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,.25)', background: 'transparent', cursor: 'pointer' }}
        />
        <input
          className="input"
          style={{ flex: '1 1 110px', minWidth: 0 }}
          value={props.value}
          placeholder={t('自动')}
          onChange={(e) => props.onChange(e.target.value)}
        />
        {props.value
          ? <button className="chip" onClick={() => props.onChange('')}>{t('自动')}</button>
          : <span className="chip static" style={{ cursor: 'default', fontSize: 11 }}>{t('自动')}</span>}
      </div>
      <div className="muted" style={{ fontSize: 11.5 }}>{t('自动')} · {props.auto}</div>
    </div>
  );
}

function ThemeLookPanel() {
  useLang();
  const a = useAppearance();
  const [busy, setBusy] = useState(false);
  const snap = currentAutoSnapshot();
  const leg = currentLegibility();
  const acc = accentFor(a);
  const autoAccent = toHex(acc.accent);
  const autoAccent2 = toHex(acc.accent2);
  const autoInk = (leg && leg.ink) || '#28212a';
  const autoPill = (leg && leg.pillA) || '#201a22';
  const sourceText = a.mode === 'image'
    ? (a.image ? (a.imageName || t('自定义图片')) : t('（未选择图片，回退为预设）'))
    : a.mode === 'color'
      ? t('纯色 {color}', { color: a.color })
      : t('预设「{name}」', { name: t(presetById(a.preset, a.theme).name) });

  const pickTheme = (th: ThemeId) => {
    if (th === 'ins' || th === 'neon') {
      void saveAppearance({ theme: th, preset: presetsFor(th)[0].id, dim: DIM_BY_THEME[th] });
    } else {
      void saveAppearance({ theme: th });
    }
  };

  const reanalyze = async () => {
    setBusy(true);
    try {
      const s = await refreshBgStyle();
      if (s) toast(t('已重新识别：{mood}', { mood: t(s.mood) }), 'ok');
      else toast(t('当前没有可分析的背景图'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const radiusText = a.radius === 0 ? t('小') : a.radius === 1 ? t('中') : t('大');

  return (
    <div className="card mb12">
      <div className="card-h">
        <span className="ico">🎨</span>
        <h3>{t('外观与性能')}</h3>
        <div className="right">
          <button className="btn btn-ghost btn-sm" onClick={async () => { await resetAppearance(); toast(t('已恢复默认外观'), 'ok'); }}>{t('恢复默认')}</button>
        </div>
      </div>

      {/* 四档风格 */}
      <div className="mb12">
        <div className="muted mb8">{t('整体风格')} · {t(THEME_LABEL[a.theme])}</div>
        <div className="seg" style={{ flexWrap: 'wrap' }}>
          {THEME_IDS.map((th) => (
            <button key={th} className={a.theme === th ? 'on' : ''} data-testid={'theme-' + th}
              onClick={() => pickTheme(th)}>
              {t(THEME_LABEL[th])}
            </button>
          ))}
        </div>
      </div>

      {/* 随图生成：显示这张背景分析出来的色板和建议值 */}
      {a.theme === 'auto' && (
        <div className="mb12" data-testid="theme-auto-panel" style={{
          padding: '10px 12px', borderRadius: 14,
          background: 'rgba(255,255,255,.10)', border: '1px solid rgba(255,255,255,.18)'
        }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <b>{t('从当前背景图提取配色')}</b>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void reanalyze()}>
              {busy ? t('正在分析当前背景…') : t('重新识别')}
            </button>
          </div>
          <div className="muted mt8" style={{ lineHeight: 1.8 }}>
            {t('会分析当前背景的色相、明暗和主色，生成玻璃、卡片、强调色和文字色；选中时固化这一套，换图或换背景后自动重算。')}
          </div>
          <div className="muted" style={{ lineHeight: 1.8 }}>{t('当前背景：')}{sourceText}</div>
          {snap ? (
            <div className="mt8" data-testid="theme-auto-snapshot">
              <div className="row-wrap" style={{ gap: 8 }}>
                <span className="chip static">{t('建议通透度 {n}%', { n: Math.round(snap.tint || 0) })}</span>
                <span className="chip static">{t('建议柔化 {n}%', { n: Math.round(snap.dim || 0) })}</span>
                <span className="chip static">{t('底色')} · {a.base === 'neon' ? t('深色') : t('浅色')}</span>
              </div>
              <div className="row mt8" style={{ gap: 8, flexWrap: 'wrap' }}>
                {snap.accent && <span className="row" style={{ gap: 4 }}><span style={{ width: 22, height: 22, borderRadius: 8, background: snap.accent, border: '1px solid rgba(255,255,255,.25)' }} />{t('强调色')}</span>}
                {snap.accent2 && <span className="row" style={{ gap: 4 }}><span style={{ width: 22, height: 22, borderRadius: 8, background: snap.accent2, border: '1px solid rgba(255,255,255,.25)' }} />{t('副强调色')}</span>}
                <span className="row" style={{ gap: 4 }}><span style={{ width: 22, height: 22, borderRadius: 8, background: 'rgb(' + snap.cardRgb + ')', border: '1px solid rgba(255,255,255,.25)' }} />{t('卡片')}</span>
                <span className="row" style={{ gap: 4 }}><span style={{ width: 22, height: 22, borderRadius: 8, background: 'rgb(' + snap.glassRgb + ')', border: '1px solid rgba(255,255,255,.25)' }} />{t('玻璃')}</span>
              </div>
            </div>
          ) : (
            <div className="muted mt8">{t('正在分析当前背景…')}</div>
          )}
        </div>
      )}

      {/* 自定义：把每个参数都摆出来 */}
      {a.theme === 'custom' && (
        <div className="mb12" data-testid="theme-custom-panel" style={{
          padding: '10px 12px', borderRadius: 14,
          background: 'rgba(255,255,255,.10)', border: '1px solid rgba(255,255,255,.18)'
        }}>
          <div className="muted" style={{ lineHeight: 1.8 }}>
            {t('每个参数都会立刻生效；颜色留空就交给算法自动。')}
          </div>

          <div className="mb12 mt12">
            <div className="muted mb8">{t('底色基调')} · {a.base === 'neon' ? t('深色') : t('浅色')}</div>
            <div className="seg">
              <button className={a.base === 'ins' ? 'on' : ''} data-testid="theme-base-ins" onClick={() => void saveAppearance({ base: 'ins' })}>{t('浅色')}</button>
              <button className={a.base === 'neon' ? 'on' : ''} data-testid="theme-base-neon" onClick={() => void saveAppearance({ base: 'neon' })}>{t('深色')}</button>
            </div>
          </div>

          <div className="form-grid mt12">
            <Field label={t('玻璃通透度') + ' · ' + a.tint + '%'}>
              <input className="slider" type="range" min={2} max={45} value={a.tint} data-testid="theme-tint"
                onChange={(e) => void saveAppearance({ tint: Number(e.target.value) })} />
            </Field>
            <Field label={t('背景柔化') + ' · ' + a.dim + '%'}>
              <input className="slider" type="range" min={0} max={70} value={a.dim} data-testid="theme-dim"
                onChange={(e) => void saveAppearance({ dim: Number(e.target.value) })} />
            </Field>
            <Field label={t('晕光强度') + ' · ' + a.glow + '%'}>
              <input className="slider" type="range" min={0} max={180} value={a.glow} data-testid="theme-glow"
                onChange={(e) => void saveAppearance({ glow: Number(e.target.value) })} />
            </Field>
            <Field label={t('配色强度') + ' · ' + Math.round(a.styleStrength * 100) + '%'}>
              <input className="slider" type="range" min={0} max={100} value={Math.round(a.styleStrength * 100)} data-testid="theme-strength"
                onChange={(e) => void saveAppearance({ styleStrength: Number(e.target.value) / 100 })} />
            </Field>
            <Field label={t('卡片明暗') + ' · ' + Math.round(a.cardShade)}>
              <input className="slider" type="range" min={0} max={100} value={a.cardShade} data-testid="theme-shade"
                onChange={(e) => void saveAppearance({ cardShade: Number(e.target.value) })} />
            </Field>
            <Field label={t('圆角档位') + ' · ' + radiusText}>
              <div className="seg">
                {([0, 1, 2] as const).map((r) => (
                  <button key={r} className={a.radius === r ? 'on' : ''} data-testid={'theme-radius-' + r}
                    onClick={() => void saveAppearance({ radius: r })}>
                    {r === 0 ? t('小') : r === 1 ? t('中') : t('大')}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <div className="form-grid mt12" data-testid="theme-colors">
            <ColorField label={t('强调色')} value={a.colors.accent} auto={autoAccent} testId="theme-accent"
              onChange={(v) => void saveAppearance({ colors: { ...a.colors, accent: v } })} />
            <ColorField label={t('副强调色')} value={a.colors.accent2} auto={autoAccent2} testId="theme-accent2"
              onChange={(v) => void saveAppearance({ colors: { ...a.colors, accent2: v } })} />
            <ColorField label={t('文字色')} value={a.colors.ink} auto={autoInk} testId="theme-ink"
              onChange={(v) => void saveAppearance({ colors: { ...a.colors, ink: v } })} />
            <ColorField label={t('选中滑块')} value={a.colors.pill} auto={autoPill} testId="theme-pill"
              onChange={(v) => void saveAppearance({ colors: { ...a.colors, pill: v } })} />
          </div>
        </div>
      )}

      {/* 字体三档 */}
      <div className="mb12">
        <div className="muted mb8">{t('字体')} · {t(FONT_MODE_LABEL[a.font] || FONT_MODE_LABEL.hanyi)}</div>
        <div className="seg mb8">
          {(['hanyi', 'hanyi-title', 'system'] as FontMode[]).map((f) => (
            <button key={f} className={a.font === f ? 'on' : ''} onClick={() => void saveAppearance({ font: f })}>
              {f === 'hanyi' ? t('全站 85W') : f === 'hanyi-title' ? t('仅标题 85W') : t('系统默认')}
            </button>
          ))}
        </div>
        <LookFontStatus />
      </div>
    </div>
  );
}

/**
 * 语言选择。
 * 每种语言用它的本名显示（繁體中文 / English / 日本語），这样不管当前界面是哪种
 * 语言，用户都能一眼找到自己那一项；下面再补一句该语言的说明。
 */
function LanguagePanel(props: { value: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="card">
      <div className="card-h"><span className="ico">🌏</span><h3>{t('界面语言')}</h3></div>
      <div className="muted mb12" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
        {t('切换后立刻生效，不需要重启。语言只记在这台设备上，不会同步到别的设备。中文界面使用应用自带的汉仪文黑 85W 字库，其他语言使用系统字体。')}
      </div>
      <div className="lang-list">
        {LANGS.map((m) => (
          <button key={m.id}
            className={'lang-item' + (m.id === props.value ? ' on' : '')}
            data-lang-id={m.id}
            onClick={() => props.onChange(m.id)}>
            <span className="lang-native">{m.native}</span>
            <span className="lang-sub">{t(LANG_HINT[m.id])}</span>
            {m.id === props.value && <span className="lang-check">✓</span>}
          </button>
        ))}
      </div>
      <div className="muted mt12" style={{ fontSize: 12 }}>
        {t('当前：')}{LANGS.filter((m) => m.id === props.value).map((m) => m.native)[0] || '简体中文'}
      </div>
    </div>
  );
}

const LANG_HINT: Record<Lang, string> = {
  'zh-Hans': '简体中文 · 自带 85W 字库',
  'zh-Hant': '繁体中文 · 由简体逐句转换，个别用词可能仍偏大陆习惯',
  en: 'English · system font',
  ja: '日本語 · システムフォント'
};
