# 局域网信标与网络状态插件

手机和电脑靠局域网 HTTP 同步。电脑换 Wi-Fi 后 IP 会变，手机里存的旧地址就失效了。
这两个原生插件负责「不用手输地址也能找回电脑」和「换网络时立刻知道」：

| 插件 | 作用 |
|---|---|
| `LanBeacon` | 往局域网广播一个探测包，收集电脑 UDP 8799 的回包 |
| `NetStatus` | 监听系统网络切换（Wi-Fi ↔ 流量 ↔ 有线），发 `change` 事件 |

两个插件都在 `MainActivity.onCreate()` 里、`super.onCreate()` 之前注册。没有新增
Gradle 依赖，也没有改 AndroidManifest（`INTERNET` / `ACCESS_NETWORK_STATE` 原来就有）。

## LanBeacon

### discover

```ts
const result = await (Capacitor.Plugins.LanBeacon as any).discover({
  port: 8799,      // 电脑 UDP 信标端口，默认 8799
  timeoutMs: 1200  // 最多等多久，默认 1200
});
// result = {
//   self: '192.168.1.23',       // 手机自己的 IPv4，可能为空串
//   port: 8799,                 // 本次使用的信标端口
//   tookMs: 42,                 // 实际花了多久
//   found: [{
//     url: 'http://192.168.1.7:8787', // 优先用电脑回包里的 urls[0]
//     host: '192.168.1.7',            // 回包来源 IP
//     port: 8787,                     // 电脑 HTTP 同步端口（回包里的 port）
//     seq: 123,                       // 可选，电脑当前服务器序号
//     dbId: '...',                    // 可选，电脑数据库 id
//     name: '时序'                    // 可选，电脑名字
//   }]
// }
```

行为约定：

- 无论找到几台都会 resolve；一台没找到时 `found` 是空数组，**不会 reject**。
- 最多返回 3 个不同 host 的结果；收到至少 1 台就提前结束，通常几十毫秒。
- 只接受带 `"shixu":1` 的 JSON 回包。8799 上可能有别的软件，不能见包就当真。
- 电脑回包里有 `urls[0]` 就优先用它；没有才拼 `http://来源IP:回包里的port`，
  回包里连 `port` 都没有时才退回请求参数里的 `port`。
- 发送目标为所有 up 且非 loopback 网卡的 IPv4 广播地址，再加 `255.255.255.255`；
  去重后逐个发，某张网卡（VPN/虚拟网卡）发不出去不影响其它网卡。
- 最多发 4 轮，轮间 150ms，单次收包超时 120ms；总时长受 `timeoutMs` 约束。

### info

```ts
const { hasWifi } = await (Capacitor.Plugins.LanBeacon as any).info();
// { ok: true, hasWifi: true }  // WIFI 或 ETHERNET 都算
```

设置页可以用它决定是否提示「手机和电脑要连同一个 Wi-Fi」。

## NetStatus

### start

```ts
const r = await (Capacitor.Plugins.NetStatus as any).start();
// { ok: true, minSdk: 33 }
// 失败时 { ok: false, minSdk: 33 }，不抛异常；网页层应降级成定时发现。
```

重复调用 `start()` 会先注销上一个 callback，保证同时只有一个监听。

### stop

```ts
await (Capacitor.Plugins.NetStatus as any).stop(); // { ok: true }
```

### info

```ts
const s = await (Capacitor.Plugins.NetStatus as any).info();
// { connected: true, type: 'wifi' | 'cellular' | 'ethernet' | 'other' }
```

### change 事件

```ts
const handle = await (Capacitor.Plugins.NetStatus as any).addListener('change', (e: {
  connected: boolean;
  type: 'wifi' | 'cellular' | 'ethernet' | 'other';
  at: number; // 毫秒时间戳
}) => {
  // 网络变了：重新 beaconScanDetailed()，别继续拿旧地址重试
  console.log('network changed', e);
});

// 页面卸载时：
await handle.remove();
```

`change` 用 retainUntilConsumed 发送：网页层刚启动、监听还没挂上时，也能拿到最后一次状态。
系统回调到达时会依次触发 `onAvailable` / `onCapabilitiesChanged`，同一轮可能收到两条事件，
网页层做去抖即可。

## Android 版本兼容

- 当前 `android/variables.gradle` 的 `minSdkVersion = 22`。
- `ConnectivityManager.registerDefaultNetworkCallback` 需要 API 24；插件里用
  `Build.VERSION.SDK_INT >= Build.VERSION_CODES.N` 判断，22/23 走
  `registerNetworkCallback(NetworkRequest, callback)` 兜底，两条分支都编译。
- 没有新增 gradle 依赖，只用 Android 平台 API + `com.getcapacitor.*` + `org.json`。

## 手动验证

```powershell
$env:JAVA_HOME='D:/android-toolchain/jdk'
$env:ANDROID_HOME='D:/android-toolchain/sdk'
cd android
./gradlew.bat --no-daemon :app:compileDebugJavaWithJavac
```

真机联调时可以用电脑端 `node server/index.mjs` 的启动日志确认 UDP 8799 已开启；
如果路由器开了 AP 隔离（访客 Wi-Fi 常见），广播到不了电脑，这是网络策略问题，
不是插件报错，设置页应提示用户换到同一个主 Wi-Fi。
