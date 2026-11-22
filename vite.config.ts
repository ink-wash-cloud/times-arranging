import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 版本号只有一个来源：package.json。网页端显示它，安卓包也用它。 */
function appVersion(): string {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version || '0.0.0';
  } catch { return '0.0.0'; }
}
const APP_VERSION = appVersion();

/** 构建期探测 public/fonts/ 下放了哪个字库文件。
 *  放在构建期做，运行时就不需要发探测请求——否则每次打开页面都会产生 404 控制台噪音。 */
function detectFontUrl(): string {
  const names = [
    'hanyi-wenhei-85w.woff2',
    'hanyi-wenhei-85w.woff',
    'hanyi-wenhei-85w.otf',
    'hanyi-wenhei-85w.ttf'
  ];
  for (const n of names) {
    if (existsSync(join(process.cwd(), 'public', 'fonts', n))) return '/fonts/' + n;
  }
  return '';
}
const FONT_URL = detectFontUrl();

export default defineConfig({
  define: {
    __FONT_URL__: JSON.stringify(FONT_URL),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    // 安卓打包时用 DEFAULT_SERVER=http://192.168.x.x:8787 npm run build 注入默认同步地址
    __DEFAULT_SERVER__: JSON.stringify(process.env.DEFAULT_SERVER || ''),
    // 构建时间戳。界面上显示出来，方便一眼确认"浏览器跑的到底是不是最新版"
    // （Service Worker 缓存旧版本时最容易说不清楚）
    // 用构建机器的本地时间，这样显示的时钟和用户看到的一致
    __BUILD_ID__: JSON.stringify((() => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
        + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    })())
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          xlsx: ['xlsx'],
          react: ['react', 'react-dom']
        }
      }
    }
  },
  plugins: [
    {
      name: 'report-font',
      configResolved() {
        console.log(FONT_URL ? '  [字体] 找到字库文件 ' + FONT_URL : '  [字体] 未找到字库文件，将使用系统字体（放到 public/fonts/ 即可）');
      }
    },
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: '时序 · 个人日程与课表',
        short_name: '时序',
        description: '课表 · 待办 · 习惯 · 纪念日 · 预算 一体化个人日程应用，支持电脑手机双向同步',
        lang: 'zh-CN',
        // 跟随默认的 INS 奶油风。原来是深色，装成电脑应用后标题栏会和界面对不上。
        theme_color: '#fbf5ee',
        background_color: '#fbf5ee',
        display: 'standalone',
        // 有些浏览器不认 standalone 之外的值，给个兜底
        display_override: ['standalone', 'minimal-ui'],
        // 原来是 portrait-primary —— 那是给手机用的，装到电脑上会把窗口锁成一根竖条
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'lifestyle'],
        // 点任务栏图标时优先聚焦已经开着的窗口，而不是又开一个
        launch_handler: { client_mode: 'focus-existing' },
        // 任务栏图标右键的跳转列表
        shortcuts: [
          { name: '今日总览', short_name: '总览', url: '/#dash', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: '待办事项', short_name: '待办', url: '/#tasks', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
          { name: '习惯打卡', short_name: '习惯', url: '/#habits', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] }
        ],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // 新版本立刻接管已打开的页面，不用等标签页全关掉才生效
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // 字库可能十几 MB，不进预缓存（否则首次安装 Service Worker 会非常慢），改为访问时缓存
        globIgnores: ['**/fonts/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/api\/(pull|health|stats)/,
            handler: 'NetworkOnly'
          },
          {
            urlPattern: /\.(?:woff2?|ttf|otf)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-fonts',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ]
});
