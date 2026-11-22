import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDB, syncStat, syncVerdict, syncNow, startBackgroundSync, list, cfg, refreshDevices } from './lib/db';
import { startNetWatch } from './lib/netWatch';
import { taskBuckets } from './lib/logic';
import type { TaskData } from './types';
import { Toaster, ConfirmHost, toast } from './components/ui';
import Backdrop from './components/Backdrop';
import DeskWidget from './components/DeskWidget';
import FpsMeter from './components/FpsMeter';
import { startReminders } from './lib/reminders';
import Dashboard from './views/Dashboard';
import Tasks from './views/Tasks';
import Habits from './views/Habits';
import Dates from './views/Dates';
import Timetable from './views/Timetable';
import Schedule from './views/Schedule';
import Expenses from './views/Expenses';
import Inspiration from './views/Inspiration';
import Settings from './views/Settings';
import CaptureSheet from './components/CaptureSheet';
import { todayStr, fmtCN } from './lib/date';
import { openWidgetWindow, closeWidgetWindow, pipSupported } from './lib/widgetWindow';
import {
  initSystemBars, toggleFullscreen, isFullscreen, fullscreenSupported, onFullscreenChange
} from './lib/fullscreen';
import { initNotifications } from './lib/notifSetup';
import NotifBanner from './components/NotifBanner';
import UpdateNotes from './components/UpdateNotes';
import GoalReminder from './components/GoalReminder';
import { saveAppearance, fileToDataURL } from './lib/appearance';
import { initBackNav, pushBackHandler, setBackNotifier } from './lib/backNav';
import { t, useLang } from './lib/i18n';
import { openSettingsPage } from './lib/uiNav';

export type ViewKey = 'dash' | 'tasks' | 'habits' | 'insp' | 'dates' | 'tt' | 'schedule' | 'expenses' | 'settings';

/** 安卓包本身就是全屏应用窗口，不需要"网页全屏"这个按钮 */
function isNativeAppShell(): boolean {
  const c = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  try { return !!(c && c.isNativePlatform && c.isNativePlatform()); } catch { return false; }
}

const NAV: Array<{ key: ViewKey; label: string; short: string; icon: string; sub: string; tab?: boolean }> = [
  { key: 'dash', label: '今日总览', short: '总览', icon: '🏠', sub: '五张卡片一眼看清今天' },
  { key: 'tasks', label: '待办事项', short: '待办', icon: '✅', sub: '今日 / 未来 7 天 / 已逾期 / 已完成' },
  { key: 'habits', label: '习惯打卡', short: '习惯', icon: '🔥', sub: '连续天数自动累计，断签从 1 重新开始' },
  { key: 'insp', label: '灵感池', short: '灵感', icon: '💡', sub: '随手记下一瞬即逝的念头与事件' },
  { key: 'dates', label: '重要日期', short: '日期', icon: '🎂', sub: '生日 · 纪念日 · 节日倒计时' },
  { key: 'tt', label: '我的课表', short: '课表', icon: '📅', sub: '周课表与今日课程，支持一键导入' },
  { key: 'schedule', label: '日程表', short: '日程', icon: '🗓', sub: '精确到秒的每日安排，拖块上下边改时长' },
  // 手机底栏只有 8 个位置，消费记录从总览的预算卡和设置页进
  { key: 'expenses', label: '消费记录', short: '消费', icon: '🧾', sub: '全部历史消费与预算，可按月翻到第一笔', tab: false },
  { key: 'settings', label: '设置与同步', short: '设置', icon: '⚙️', sub: '设备、服务器、备份' }
];

export default function App() {
  useDB();  // 订阅本地库变化
  // 语言变了要让整棵树换文案：下面的 key 带上 lang，切语言时当前页会重新挂载
  const lang = useLang();
  const [view, setView] = useState<ViewKey>(() => (localStorage.getItem('view') as ViewKey) || 'dash');
  const [booted, setBooted] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(() => localStorage.getItem('widget') === '1');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [fs, setFs] = useState(false);
  const bgRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const stop = startBackgroundSync();
    startReminders();
    // 安卓包：系统栏设成透明并让内容铺满，状态栏背后就是应用自己的背景
    initSystemBars();
    // 安卓 13+ 的通知权限必须运行时授权，不给的话系统会把通知直接丢掉。
    // 放在启动时问一次，用户不用先去翻设置页，提醒才真的是开箱可用。
    // 注意别在这里判断 isNativeApp()：window.Capacitor 有可能还没注入完，
    // 那样就永远不会问了——initNotifications() 自己会错开时间重试。
    void initNotifications();
    setFs(isFullscreen());
    const offFs = onFullscreenChange(setFs);
    setBooted(true);
    const onHash = () => {
      const h = location.hash.replace('#', '') as ViewKey;
      if (NAV.some((n) => n.key === h)) setView(h);
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => { stop(); offFs(); window.removeEventListener('hashchange', onHash); };
  }, []);

  // 换了 Wi-Fi、换了热点：自己把电脑找回来，不需要用户点任何按钮。
  // 只有真的换了地址（地址池/广播/扫描里找到了别的地址）才弹提示；
  // 原地址直接连上的不打扰。
  useEffect(() => {
    return startNetWatch((r) => {
      if (r.via === 'direct') return;
      toast(r.message, r.ok ? 'ok' : 'err');
    });
  }, []);

  // 每 30 秒问一次服务器「还有几台设备没跟上」，顶栏那句「有 N 台设备没跟上」
  // 靠它。连不上就静默，不要每半分钟弹一次错误。
  useEffect(() => {
    void refreshDevices();
    const id = setInterval(() => {
      if (document.hidden) return;
      void refreshDevices();
    }, 30000);
    return () => clearInterval(id);
  }, []);

  // 记住"从哪一页来的"：安卓返回键要按来路回退，而不是一律跳回首页
  const navHist = useRef<ViewKey[]>([]);
  const viewRef = useRef<ViewKey>(view);
  viewRef.current = view;
  const applyView = (k: ViewKey) => {
    setView(k);
    localStorage.setItem('view', k);
    if (location.hash !== '#' + k) history.replaceState(null, '', '#' + k);
  };
  const applyViewRef = useRef(applyView);
  applyViewRef.current = applyView;

  const go = (k: ViewKey) => {
    if (k !== view) {
      navHist.current.push(view);
      if (navHist.current.length > 12) navHist.current.shift();
    }
    applyView(k);
  };

  // 安卓返回键 / 侧滑：① 有弹窗先关弹窗 ② 不是首页就回上一级 ③ 首页由 backNav 做
  // "再滑一次退出应用"的防误触（以前没装 @capacitor/app，侧滑一下就退出应用）。
  useEffect(() => {
    setBackNotifier((msg) => toast(msg, 'info'));
    return pushBackHandler(() => {
      // ① 所有弹窗都走通用的 Modal（src/components/ui.tsx 已经监听 Escape）
      if (document.querySelector('.modal-mask')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return true;
      }
      // ② 按来路回退一层
      const prev = navHist.current.pop();
      if (prev && prev !== viewRef.current) { applyViewRef.current(prev); return true; }
      if (viewRef.current !== 'dash') { applyViewRef.current('dash'); return true; }
      // ③ 已经在首页：交回给 backNav（第一次提示，第二次退出）
      return false;
    });
  }, []);

  useEffect(() => {
    let off: (() => void) | null = null;
    let dead = false;
    void initBackNav().then((fn) => { if (dead) fn(); else off = fn; });
    return () => { dead = true; if (off) off(); };
  }, []);

  // 离开设置页就把二级页复位到根页。放在这里而不是设置页的卸载回调里：
  // 切语言会整页重挂载，卸载回调会把「语言」二级页也一起清掉。
  useEffect(() => {
    if (view !== 'settings') openSettingsPage('root');
  }, [view]);

  const cur = useMemo(() => NAV.find((n) => n.key === view) || NAV[0], [view]);

  // 顶栏只说实话：该说哪一句由 db.syncVerdict() 统一决定（设置页也用它）。
  // 以前各页面各写一套，只看 state==='ok' —— 电脑端连的是自己这台服务器，
  // 永远 ok，手机根本连不上也照样显示已同步。这就是那个"假同步"。
  const pill = syncVerdict();
  const pillClass = pill.cls;
  // 最后同步的时刻单独一段：手机顶栏放不下时靠 CSS 把它藏掉，只留「已同步」三个字，
  // 比把整句截成「已同步 1…」好看
  const pillTime = (() => {
    if (pill.cls !== 'ok' || !syncStat.lastSyncAt) return '';
    const d = new Date(syncStat.lastSyncAt);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  })();
  const pillDone = pill.text;

  const doSync = async () => {
    const r = await syncNow('manual');
    toast(r.message, r.ok ? 'ok' : 'err');
  };

  const toggleWidget = async () => {
    if (widgetOpen) {
      closeWidgetWindow();
      setWidgetOpen(false);
      localStorage.setItem('widget', '0');
      toast(t('桌面挂件已关闭'), 'info');
      return;
    }
    // 必须由点击这类用户手势触发：Document PiP 和 window.open 都要求手势，
    // 所以做不到"刷新后自动恢复窗口"，只能恢复成页面内浮层。
    const h = await openWidgetWindow().catch(() => null);
    setWidgetOpen(true);
    localStorage.setItem('widget', '1');
    if (h?.mode === 'pip') toast(t('挂件已弹出为桌面置顶小窗，切到别的程序也一直在'), 'ok');
    else if (h) toast(t('挂件已弹出为独立窗口（当前浏览器不保证置顶）'), 'ok');
    else toast(t('浏览器拦住了弹出窗口，已在页面内显示挂件'), 'err');
  };

  return (
    <>
    <Backdrop />
    {widgetOpen && <DeskWidget onClose={() => { setWidgetOpen(false); localStorage.setItem('widget', '0'); }} />}
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">时</div>
          <div>
            <div className="brand-name">{t('时序')}</div>
            <div className="brand-sub">{t('个人日程 · 课表 · 习惯')}</div>
          </div>
        </div>
        <div className="nav-list">
          {NAV.map((n) => (
            <button key={n.key} className={'nav-item' + (view === n.key ? ' active' : '')} onClick={() => go(n.key)}>
              <span className="nav-ico">{n.icon}</span>
              <span>{t(n.label)}</span>
              {n.key === 'tasks' && <TaskBadge />}
            </button>
          ))}
        </div>
        <div className="sidebar-foot">
          <div>{t('本机设备：{name}', { name: cfg.deviceName || t('本设备') })}</div>
          <div style={{ marginTop: 4 }}>{t('数据保存在本地，自动双向同步')}</div>
          <div style={{ marginTop: 4, opacity: .7 }} title={t('版本号 + 构建时间，用来确认跑的是不是最新版')}>
            v{__APP_VERSION__} · {__BUILD_ID__}
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{t(cur.label)}</h1>
            <div className="sub">{booted ? fmtCN(todayStr()) + ' · ' + t(cur.sub) : t('正在载入…')}</div>
          </div>
          <div className="topbar-right">
            <div className="topbar-tools">
            {/* 手机浏览器不支持 Document PiP，挂件按钮在那边点了也没用，直接不显示 */}
            {pipSupported() && (
              <button
                data-act="widget"
                className={'btn btn-sm ' + (widgetOpen ? 'btn-primary' : 'btn-ghost')}
                onClick={toggleWidget}
                title={t('桌面挂件：把今日待办弹出成始终置顶的桌面小窗，切到别的程序也不会消失')}
              >
                🖥️ <span className="hide-sm">{t('桌面挂件')}</span>
              </button>
            )}
            {/* 换背景以前埋在「外观与性能」里面，不好找；这里放一个直达入口 */}
            <input ref={bgRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                try {
                  const url = await fileToDataURL(f);
                  await saveAppearance({ mode: 'image', image: url, imageName: f.name || t('照片') });
                  toast(t('背景已换成这张图（只存在本机，不上传）'), 'ok');
                } catch (err) {
                  toast(t('读取图片失败：{msg}', { msg: String((err as Error).message || err) }), 'err');
                } finally {
                  if (bgRef.current) bgRef.current.value = '';
                }
              }} />
            <button data-act="bg" className="btn btn-sm btn-ghost" onClick={() => bgRef.current?.click()}
              title={t('从相册选一张图当背景（也可以现拍一张）')}>
              🖼 <span className="hide-sm">{t('换背景')}</span>
            </button>
            <button
              data-act="appearance"
              className={'btn btn-sm ' + (view === 'settings' ? 'btn-primary' : 'btn-ghost')}
              onClick={() => go('settings')}
              title={t('外观与背景')}
            >
              🎨 <span className="hide-sm">{t('外观')}</span>
            </button>
            {fullscreenSupported() && !isNativeAppShell() && (
              <button
                data-act="fullscreen"
                className={'btn btn-sm ' + (fs ? 'btn-primary' : 'btn-ghost')}
                onClick={() => { void toggleFullscreen(); }}
                title={fs ? t('退出全屏（Esc）') : t('全屏：把浏览器自己的界面也收起来')}
              >
                {fs ? '⤡' : '⛶'} <span className="hide-sm">{fs ? t('退出全屏') : t('全屏')}</span>
              </button>
            )}
            </div>
            <button className={'sync-pill ' + pillClass} data-testid="sync-pill" onClick={doSync} title={t('点击立即同步')}>
              <span className="dot" />
              <span>
                {pillDone}
                {pillTime && <span className="sync-time">{' ' + pillTime}</span>}
              </span>
            </button>
          </div>
        </header>

        <div className="content">
          <div className="content-inner view-enter" key={view + ':' + lang}>
            {/* 通知权限没拿到时，这里会顶一条横幅出来 */}
            <NotifBanner />
            {view === 'dash' && <Dashboard onGo={go} />}
            {view === 'tasks' && <Tasks />}
            {view === 'habits' && <Habits />}
            {view === 'insp' && <Inspiration />}
            {view === 'dates' && <Dates />}
            {view === 'tt' && <Timetable />}
            {view === 'schedule' && <Schedule />}
            {view === 'expenses' && <Expenses />}
            {view === 'settings' && <Settings />}
          </div>
        </div>
      </main>

      <nav className="tabbar">
        {NAV.filter((n) => n.tab !== false).map((n) => (
          <button key={n.key} className={'tab' + (view === n.key ? ' active' : '')} onClick={() => go(n.key)}>
            <span className="ti">{n.icon}</span>
            <span>{t(n.short)}</span>
          </button>
        ))}
      </nav>

      {/* 设置页不放这个按钮：它会浮在列表右侧盖住「当前值」，而设置页本来也用不上随手记。
          日程表也不放：手机底部那条「＋ 加一段日程 / 导出」是固定条，按钮正好落在它右端，
          点「导出」会先点到这颗浮球（v1.6.0 实测 390px 下遮挡）。 */}
      {view !== 'settings' && view !== 'schedule' && view !== 'expenses' && (
        <button className="fab" onClick={() => setCaptureOpen(true)} title={t('记一个念头（存入灵感池）')} aria-label={t('记一个念头')}>
          💡
        </button>
      )}
      <CaptureSheet open={captureOpen} onClose={() => setCaptureOpen(false)} />

      {/* 版本变了之后第一次打开，弹一次更新内容 */}
      <UpdateNotes />
      {/* 长远目标到点提醒：全局挂载，不依赖停在哪个页面 */}
      <GoalReminder />
      <FpsMeter />
      <Toaster />
      <ConfirmHost />
    </div>
    </>
  );
}

function TaskBadge() {
  useDB();
  const n = taskBuckets(list<TaskData>('tasks')).overdue.length;
  if (!n) return null;
  return <span className="nav-badge">{n}</span>;
}
