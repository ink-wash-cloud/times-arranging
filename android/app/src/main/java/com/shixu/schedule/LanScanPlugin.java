package com.shixu.schedule;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Finds the ShiXu server on the local network.
 *
 * Why this exists: the sync address is a LAN IP, and that IP changes whenever
 * the PC joins a different Wi-Fi. Without this the phone keeps dialling the old
 * address forever and the two devices silently stop syncing.
 *
 * It takes the phone's own IPv4 address, assumes the usual /24, and tries a TCP
 * connect to every host on that subnet in parallel. Only the port is probed here;
 * the web layer then asks each responder /api/health to confirm it really is ShiXu.
 */
@CapacitorPlugin(name = "LanScan")
public class LanScanPlugin extends Plugin {

    @PluginMethod
    public void scan(PluginCall call) {
        final int port = call.getInt("port", 8787);
        final int timeoutMs = call.getInt("timeoutMs", 350);
        // the scan takes a couple of seconds, so keep the call open
        call.setKeepAlive(true);

        new Thread(() -> {
            try {
                String self = null;
                String prefix = null;
                for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!nif.isUp() || nif.isLoopback()) continue;
                    for (InterfaceAddress ia : nif.getInterfaceAddresses()) {
                        InetAddress a = ia.getAddress();
                        if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                            self = a.getHostAddress();
                            prefix = self.substring(0, self.lastIndexOf('.') + 1);
                            break;
                        }
                    }
                    if (prefix != null) break;
                }
                if (prefix == null) {
                    call.reject("没有找到局域网地址，请确认手机连着 Wi-Fi");
                    return;
                }

                final List<String> found = Collections.synchronizedList(new ArrayList<String>());
                ExecutorService pool = Executors.newFixedThreadPool(48);
                final CountDownLatch latch = new CountDownLatch(254);
                for (int i = 1; i <= 254; i++) {
                    final String host = prefix + i;
                    pool.execute(() -> {
                        Socket s = new Socket();
                        try {
                            s.connect(new InetSocketAddress(host, port), timeoutMs);
                            found.add(host);
                        } catch (Exception ignored) {
                            // nobody listening there
                        } finally {
                            try { s.close(); } catch (Exception ignored) { }
                            latch.countDown();
                        }
                    });
                }
                latch.await(timeoutMs + 5000L, TimeUnit.MILLISECONDS);
                pool.shutdownNow();

                JSArray arr = new JSArray();
                for (String h : found) arr.put(h);
                JSObject ret = new JSObject();
                ret.put("self", self);
                ret.put("prefix", prefix);
                ret.put("hosts", arr);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("扫描失败: " + e.getMessage());
            }
        }).start();
    }
}
