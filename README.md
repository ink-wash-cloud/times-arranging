<p align="center">
  <img src="public/icons/icon-512.png" width="110" alt="时序图标">
</p>

<h1 align="center">时序</h1>

<p align="center">
  <strong>课表 · 待办 · 习惯 · 日程 · 消费记录</strong><br>
  一个本地优先的个人日程应用，手机和电脑可以互相同步。
</p>

<p align="center">
  <a href="https://github.com/ink-wash-cloud/times-arranging">GitHub 仓库</a> ·
  <a href="https://github.com/ink-wash-cloud/times-arranging/issues">问题反馈</a> ·
  <a href="#快速开始">快速开始</a>
</p>

---

## 这是什么

时序是一个给自己用的个人日程应用。它把每天会用到的东西放进同一个界面：今天要做什么、课上到第几周、习惯有没有断、这个月花了多少、重要的日子还有几天。

- **网页版**：浏览器直接打开，也可以安装成电脑应用或手机主屏幕应用
- **安卓版**：用 Capacitor 打包的 APK，支持 Android 5.1（API 22）及以上
- **本地优先**：数据默认存在本机，不需要注册账号，也不依赖云端
- **可选同步**：自己启动一个同步服务，电脑和手机在同一局域网内双向同步
- **四种语言**：简体中文、繁體中文、English、日本語

> 仓库名 `times-arranging` 是英文项目名，应用本身叫「时序」。

## 功能

| 模块 | 能做什么 |
|---|---|
| 今日总览 | 把今天的待办、习惯、预算、课表和重要日期集中在一页，完成情况一眼看到 |
| 待办事项 | 按今日、未来 7 天、已逾期、已完成分组；「长远目标」支持目标日、进度条、里程碑和到点提醒 |
| 习惯打卡 | 记录连续天数、每日完成量和提醒时间，支持查看历史打卡情况 |
| 灵感池 | 随手记下想法、句子和待整理的内容，之后再回来处理 |
| 重要日期 | 生日、纪念日、节日等日期倒计时，提前提醒 |
| 我的课表 | 周课表；支持导入 Excel 课表、调课/停课/固定周次、上课提醒和锁定课表 |
| 日程表 | 时间轴支持 1 天、1 小时、15 分、1 分、1 秒五档缩放；拖动方块上下边改时长；可叠加当天课表；支持导出 |
| 消费记录 | 本月、上月、今年三张汇总卡；按分类筛选、单笔编辑/删除、导出 CSV、设置预算 |
| 外观 | 主题、背景图、随图配色、动效强度、文字对比度等外观设置 |
| 设置与同步 | 连接体检、一键重连、同步方向、备份与恢复、界面语言 |

## 技术栈

- **前端**：React 19 + TypeScript + Vite 6
- **移动端**：Capacitor 6（Android，`minSdkVersion 22`，`compileSdkVersion 34`）
- **本地数据**：浏览器 IndexedDB
- **同步服务**：Node.js 22+，只用 `node:http` 和 `node:sqlite`，没有额外的服务端依赖
- **PWA**：`vite-plugin-pwa`，可安装到桌面或手机主屏幕

## 快速开始

### 1. 准备环境

- [Node.js](https://nodejs.org/) 22 或更高版本
- npm（随 Node.js 一起安装）
- 只有打包安卓 APK 时才需要 JDK 和 Android SDK，见「安卓打包」

### 2. 克隆并安装依赖

```bash
git clone https://github.com/ink-wash-cloud/times-arranging.git
cd times-arranging
npm install
```

### 3. 启动网页开发版

```bash
npm run dev
```

浏览器打开 <http://localhost:5173>。

开发模式下只跑前端也能正常使用，数据保存在当前浏览器里。需要和手机同步时，再在另一个终端启动同步服务：

```bash
npm run build
npm start
```

然后打开 <http://localhost:8787>。

## 电脑端

### 用浏览器直接使用

```bash
npm run build
npm start
```

打开 <http://localhost:8787>。这个地址同时提供网页和同步接口。

### 安装成电脑应用

用 Chrome 或 Edge 打开 <http://localhost:8787>，点地址栏右侧的「安装」图标，即可把时序装成一个独立窗口的应用。

> 安装入口只在 `localhost` / `127.0.0.1` 下出现；用局域网 IP 打开时，浏览器通常不提供安装按钮。

### Windows 快捷方式

仓库里带了 `启动时序.vbs`，双击可以免开终端启动。也可以运行：

```bash
npm run app
```

生成桌面图标和快捷方式（脚本会读取当前项目路径）。

### 桌面挂件（可选）

设置里的桌面挂件使用 Document Picture-in-Picture，需要 Chrome 或 Edge 116 及以上版本。不支持时该入口不会生效，不影响其他功能。

## 手机端（安卓）

### 自己打包 APK

先准备：

- JDK 17 或更高版本
- Android SDK（`compileSdkVersion 34`）
- 设置好 `JAVA_HOME` 和 `ANDROID_HOME`

打包脚本默认会找作者本机的路径 `D:/android-toolchain/jdk` 和 `D:/android-toolchain/sdk`；如果你的 JDK / SDK 不在那里，请先设置环境变量。

```bash
npm run apk
```

脚本会依次构建网页、同步到 `android/`、执行 Gradle 的 `assembleDebug`，输出：

```text
release/shixu-v<版本号>.apk
```

这个包会把打包时电脑的局域网地址写成默认同步地址，适合自己用。

如果要发给别人，构建一个不内置服务器地址的版本：

```bash
npm run apk -- --no-server
```

输出：

```text
pack-files/shixu-v<版本号>-noserver.apk
```

对方安装后在「设置与同步」里自己填电脑地址（或者用局域网自动发现）。

### 安装到手机

1. 把 APK 传到手机（数据线、聊天工具或网盘都可以）。
2. 在手机上点开 APK，按提示允许「安装未知来源应用」。
3. 如果手机里已经装了同一个包名、但签名不同的旧版本，需要先卸载旧版再安装；卸载会清掉应用本地数据，操作前先在旧版里做备份。

> 当前的 `android/app/build.gradle` 没有配置 `signingConfigs`，默认使用 debug 签名。自己用没问题；如果要长期分发或上架应用商店，请生成自己的 keystore，并配置 release 签名。换签名后不能直接覆盖安装旧包。

### 一键发版（维护者）

```bash
npm run release
```

这个脚本会先检查 `package.json` 版本号与 `src/lib/changelog.ts` 最新条目是否一致，再跑多语言检查，然后构建网页、两个 APK 和便携版压缩包。普通使用者不需要执行它。

## 数据与同步

### 数据放在哪

- 网页端 / 安卓端：数据默认存在本机浏览器的 IndexedDB 中。
- 同步服务：数据存在项目下的 `data/schedule.db`（已被 `.gitignore` 排除，不会提交到仓库）。
- 设置里有「备份 / 恢复」，换设备或重装前建议先导出一份。

### 启动同步服务

```bash
npm run build
npm start
```

默认监听 `0.0.0.0:8787`，同时用 UDP 8799 做局域网发现。手机和电脑连同一个 Wi-Fi 后，在手机「设置与同步」里填电脑地址，或者点自动发现。

可选：设置同步口令，避免同一局域网内其他设备随意写入。

```bash
SYNC_TOKEN=你的口令 npm start
```

Windows PowerShell 里可以这样设置：

```powershell
$env:SYNC_TOKEN = "你的口令"
npm start
```

设置口令后，手机端也要填同样的口令。

### 安全提醒

同步服务是给家庭局域网用的，不要直接把 8787 端口暴露到公网。需要外网访问时，请放在 HTTPS 反向代理后面，并设置 `SYNC_TOKEN`。

## 项目结构

```text
src/                React 前端
  views/            各功能页面
  components/       通用组件
  lib/              数据、同步、提醒、多语言等逻辑
server/             零依赖同步服务（Node.js 22+）
android/            Capacitor 安卓工程
scripts/            构建、打包、测试、发版脚本
docs/               设计与多语言约定
public/             图标、字体等静态资源
```

`dist/`、`release/`、`pack-files/`、`node_modules/`、`data/` 都是生成物或本机数据，不提交到仓库。

## 开发与测试

```bash
# 类型检查
npx tsc --noEmit

# 快速测试（建议改完代码先跑这个）
node scripts/run-tests.mjs --smoke

# 全部测试
node scripts/run-tests.mjs
```

测试脚本的更多用法：

```bash
node scripts/run-tests.mjs --list
node scripts/run-tests.mjs --only=test-logic,test-sync
node scripts/run-tests.mjs --skip=test-pwa
```

`npm run build:lock` 是带构建锁的构建命令，适合同时开着多个构建任务时使用。

## 常见问题

### 手机连不上电脑

按顺序检查：

1. 电脑上 `npm start` 是否还在运行；
2. 手机和电脑是否在同一个 Wi-Fi；
3. 电脑防火墙是否放行 8787（TCP）和 8799（UDP）；
4. 手机「设置与同步」里的地址是否还是旧 IP，可以点「连接体检」或「一键重连」。

### 浏览器里没有「安装应用」按钮

用 `http://localhost:8787` 或 `http://127.0.0.1:8787` 打开，不要用 `192.168.x.x` 的局域网地址。安装 PWA 要求安全上下文，`localhost` 是例外。

### APK 安装失败

- 确认手机允许安装未知来源应用；
- 如果提示签名冲突，先卸载旧版再装（先备份数据）；
- 如果提示「解析包出错」，确认下载的 APK 完整，或重新执行 `npm run apk`。

### 数据会不会上传到云端

默认不会。数据只存在本机；只有你自己启动同步服务，并让手机连接它时，数据才会在你的设备和电脑之间传输。项目没有账号系统，也没有第三方云存储。

例外是「AI 识别课表」：如果你在设置里配置了 AI 接口，并主动使用这个功能，你提交的课表文本或图片会发到你填写的接口地址（例如 DeepSeek、通义、Kimi，或本机的 Ollama / LM Studio）。不配置接口时，这个功能不会联网。

## 贡献

欢迎提 Issue 和 Pull Request。提交前建议：

1. 先开 Issue 说明要改什么，避免和现有计划冲突；
2. 跑 `npx tsc --noEmit` 和 `node scripts/run-tests.mjs --smoke`；
3. UI 改动附上修改前后的截图。

## 许可证

暂未添加 `LICENSE` 文件（许可证待定）。在许可证确定之前，请不要默认可以复制、分发或商用。
