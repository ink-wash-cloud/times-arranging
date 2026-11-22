/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** 构建期注入：public/fonts/ 下命中的字库文件路径，空串表示没有 */
declare const __FONT_URL__: string;

/** 构建期注入：安卓包里预设的同步服务器地址，空串表示不预设 */
declare const __DEFAULT_SERVER__: string;
/** 构建时间戳：用来一眼确认当前跑的是不是最新版 */
declare const __BUILD_ID__: string;

/** 应用版本号，来自 package.json，每次改动都要往上加 */
declare const __APP_VERSION__: string;
