import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 安卓打包配置
 * - webDir 指向 Vite 的构建产物；打包后网页资源内置在 APK 里，离线也能用
 * - androidScheme 用 http：这样应用自身的源是 http://localhost，
 *   去请求局域网里的同步服务（http://192.168.x.x:8787）就不算混合内容，
 *   否则 https 页面请求 http 接口会被 WebView 直接拦掉
 */
const config: CapacitorConfig = {
  appId: 'com.shixu.schedule',
  appName: '时序',
  webDir: 'dist',
  server: {
    androidScheme: 'http'
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: false,
    // WebView 的底色（首帧渲染出来之前露出来的那块）。
    // 原来是深蓝，全屏之后会在状态栏和刘海区域闪一下深色，
    // 改成和默认的 INS 奶油底一致，启动过程才是"整块应用"。
    backgroundColor: '#fbf5ee'
  }
};

export default config;
