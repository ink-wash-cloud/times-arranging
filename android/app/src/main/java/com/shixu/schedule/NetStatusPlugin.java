package com.shixu.schedule;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 监听手机网络切换，给网页层一个「网络变了，重新找电脑」的信号。
 *
 * 为什么需要它：手机从 Wi-Fi A 走到 Wi-Fi B，或者 Wi-Fi 断开切到流量，
 * 旧电脑地址立刻失效。只靠页面可见性或定时器发现，会晚几十秒甚至更久；
 * 系统在网络切换的瞬间回调，这里马上 notifyListeners，网页层就能重新信标发现。
 *
 * 事件：change { connected, type: "wifi"|"cellular"|"ethernet"|"other", at }
 * 注意：registerDefaultNetworkCallback 要 API 24；本项目 minSdk 22，
 * 22/23 退回 registerNetworkCallback(NetworkRequest, callback)，行为等价。
 */
@CapacitorPlugin(name = "NetStatus")
public class NetStatusPlugin extends Plugin {

    private ConnectivityManager.NetworkCallback callback;
    private volatile String lastType = "other";

    /**
     * 开始监听；重复调用会先注销上一个 callback，保证同时只有一个。
     * 返回：{ ok, minSdk }（失败时 ok=false，不抛异常）
     */
    @PluginMethod
    public void start(PluginCall call) {
        JSObject ret = new JSObject();
        int minSdk = Build.VERSION.SDK_INT;
        try {
            ConnectivityManager cm = connectivityManager();
            if (cm == null) {
                ret.put("ok", false);
                ret.put("minSdk", minSdk);
                call.resolve(ret);
                return;
            }

            unregisterCallback();

            callback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    try {
                        emit(true, cm.getNetworkCapabilities(network));
                    } catch (Exception ignored) {
                    }
                }

                @Override
                public void onLost(Network network) {
                    try {
                        emit(false, null);
                    } catch (Exception ignored) {
                    }
                }

                @Override
                public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) {
                    try {
                        emit(caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET), caps);
                    } catch (Exception ignored) {
                    }
                }
            };

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                cm.registerDefaultNetworkCallback(callback);
            } else {
                // API 22/23 没有 registerDefaultNetworkCallback，用显式 NetworkRequest 兜底。
                NetworkRequest request = new NetworkRequest.Builder()
                        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                        .build();
                cm.registerNetworkCallback(request, callback);
            }
            ret.put("ok", true);
        } catch (Exception ignored) {
            // 权限被改、系统服务异常等：保持静默，网页层拿 ok=false 自行降级到定时发现。
            callback = null;
            ret.put("ok", false);
        }
        ret.put("minSdk", minSdk);
        call.resolve(ret);
    }

    /** 停止监听。页面退出或用户关掉自动发现时调用，避免后台常驻回调。 */
    @PluginMethod
    public void stop(PluginCall call) {
        unregisterCallback();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /**
     * 当前网络快照，用于页面刚打开时先判断一次，不用等下一次切换。
     * 返回：{ connected, type }
     */
    @PluginMethod
    public void info(PluginCall call) {
        boolean connected = false;
        String type = "other";
        try {
            ConnectivityManager cm = connectivityManager();
            if (cm != null && cm.getActiveNetwork() != null) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
                connected = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                type = typeOf(caps);
            }
        } catch (Exception ignored) {
        }
        JSObject ret = new JSObject();
        ret.put("connected", connected);
        ret.put("type", type);
        call.resolve(ret);
    }

    private ConnectivityManager connectivityManager() {
        return (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    private void unregisterCallback() {
        ConnectivityManager.NetworkCallback old = callback;
        callback = null;
        if (old == null) return;
        try {
            ConnectivityManager cm = connectivityManager();
            if (cm != null) cm.unregisterNetworkCallback(old);
        } catch (Exception ignored) {
            // 已经注销过 / 系统正在切换网络，忽略即可。
        }
    }

    private void emit(boolean connected, NetworkCapabilities caps) {
        String type = typeOf(caps);
        lastType = type;
        JSObject data = new JSObject();
        data.put("connected", connected);
        data.put("type", type);
        data.put("at", System.currentTimeMillis());
        // retainUntilConsumed=true：网页层刚启动还没挂上监听时，也能拿到最后一次状态。
        notifyListeners("change", data, true);
    }

    private String typeOf(NetworkCapabilities caps) {
        if (caps == null) return lastType;
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cellular";
        if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return "ethernet";
        return "other";
    }
}
