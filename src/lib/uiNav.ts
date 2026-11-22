// 二级页面的位置记在这里，好让：① 安卓返回键退一层；② 测试和深链接直接跳到某一页
//
// 只放"当前在哪个二级页"，不放具体 UI —— 组件自己订阅即可。
export type SettingsPageId =
  | 'root'
  | 'look'      // 主题与字体
  | 'bg'        // 背景与其他
  | 'perf'      // 性能与动效
  | 'colors'    // 自动配色 / 自定义各部分颜色
  | 'lang'      // 界面语言
  | 'sync'      // 数据与同步
  | 'remind'    // 提醒
  | 'widget'    // 桌面小组件
  | 'apps'      // 装到电脑/手机上
  | 'ai'        // AI 助手
  | 'about';    // 使用说明与更新日志

let page: SettingsPageId = 'root';
const subs = new Set<() => void>();

export function settingsPage(): SettingsPageId {
  return page;
}

export function openSettingsPage(next: SettingsPageId) {
  if (next === page) return;
  page = next;
  subs.forEach((f) => {
    try { f(); } catch { /* 单个订阅出错不影响别的 */ }
  });
}

export function subscribeSettingsPage(fn: () => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}
