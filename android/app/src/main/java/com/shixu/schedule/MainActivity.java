package com.shixu.schedule;

import android.graphics.Color;
import android.os.Bundle;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Full-screen / edge-to-edge setup.
 *
 * The web layer is allowed to draw under the status bar and the navigation bar,
 * and both bars are made transparent. So while the app is in the foreground the
 * status bar background IS the app's own background, instead of a solid strip
 * painted by the system.
 *
 * The CSS side reads env(safe-area-inset-*) to keep content clear of the bars.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before super.onCreate, otherwise the
        // bridge never sees them and the web layer gets "plugin not implemented".
        registerPlugin(NotifSettingsPlugin.class);
        registerPlugin(LanScanPlugin.class);
        registerPlugin(WidgetBridgePlugin.class);
        // UDP 信标发现 / 网络切换监听：换 Wi-Fi 或电脑 IP 变了时，手机不用手输地址也能找回服务器。
        registerPlugin(LanBeaconPlugin.class);
        registerPlugin(NetStatusPlugin.class);

        // Runs before super.onCreate so the WebView is laid out edge-to-edge
        // from the very first frame (otherwise there is a visible jump).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        super.onCreate(savedInstanceState);
    }
}
