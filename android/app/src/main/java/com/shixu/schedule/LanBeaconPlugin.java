package com.shixu.schedule;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 局域网里的「时序」服务器发现（UDP 信标）。
 *
 * 为什么需要它：电脑换 Wi-Fi 后局域网 IP 会变，手机里存的旧地址还在，
 * 两边看起来都「已同步」，实际早就互相传不到了。TCP /24 扫描要等好几秒，
 * 而且会撞上端口没开的主机；这里改成往各网卡的广播地址发一个很小的探测包，
 * 电脑上的同步服务收到后立刻回一包自己的地址，通常几十毫秒就能找到。
 *
 * 协议（与 server/index.mjs 的 startBeacon() 对应）：
 *   手机 -> 广播:8799  任意字节（本插件发 "SHIXU-DISCOVER"）
 *   电脑 -> 手机来源端口  JSON，必须有 "shixu":1；urls[0] 是可用的电脑地址
 * 8799 上可能有别的软件，所以只认带 shixu:1 的 JSON，不会把无关回包当成服务器。
 */
@CapacitorPlugin(name = "LanBeacon")
public class LanBeaconPlugin extends Plugin {

    private static final String DISCOVER_PAYLOAD = "SHIXU-DISCOVER";
    private static final int DEFAULT_BEACON_PORT = 8799;
    private static final int DEFAULT_TIMEOUT_MS = 1200;
    private static final int SOCKET_TIMEOUT_MS = 120;
    private static final int MAX_ROUNDS = 4;
    private static final int ROUND_GAP_MS = 150;
    private static final int MAX_FOUND = 3;
    private static final String LIMITED_BROADCAST = "255.255.255.255";

    /**
     * 主动在局域网里找电脑。
     *
     * 参数：{ port?: 8799, timeoutMs?: 1200 }
     * 返回：{ self, port, tookMs, found: [{ url, host, port, seq?, dbId?, name? }] }
     * 无论有没有找到都会 resolve；找不到时 found 是空数组，不 reject，
     * 这样网页层可以直接显示「没找到，检查一下 Wi-Fi」而不是抛一个异常。
     */
    @PluginMethod
    public void discover(PluginCall call) {
        final int beaconPort = Math.max(1, call.getInt("port", DEFAULT_BEACON_PORT));
        final int timeoutMs = Math.max(1, call.getInt("timeoutMs", DEFAULT_TIMEOUT_MS));
        // 发现要等广播回包，先把这次 call 留住，避免 bridge 提前回收。
        call.setKeepAlive(true);

        new Thread(() -> {
            final long startedAt = System.currentTimeMillis();
            final String self = selfAddress();
            final Map<String, JSObject> found = new LinkedHashMap<>();
            DatagramSocket socket = null;

            try {
                socket = new DatagramSocket(null);
                socket.setReuseAddress(true);
                socket.setBroadcast(true);
                socket.bind(new InetSocketAddress(0));
                socket.setSoTimeout(SOCKET_TIMEOUT_MS);

                final byte[] payload = DISCOVER_PAYLOAD.getBytes(StandardCharsets.UTF_8);
                final List<InetAddress> targets = broadcastTargets();

                for (int round = 0; round < MAX_ROUNDS; round++) {
                    if (found.size() >= MAX_FOUND) break;
                    long now = System.currentTimeMillis();
                    if (now - startedAt >= timeoutMs) break;

                    for (InetAddress target : targets) {
                        try {
                            socket.send(new DatagramPacket(payload, payload.length, target, beaconPort));
                        } catch (Exception ignored) {
                            // 某张网卡不允许广播（例如 VPN），换下一张，不影响其它网卡。
                        }
                    }

                    // 一轮发完后连续收包，直到 120ms 没有新回包（或已经收满 3 台）。
                    while (found.size() < MAX_FOUND && System.currentTimeMillis() - startedAt < timeoutMs) {
                        byte[] buf = new byte[4096];
                        DatagramPacket packet = new DatagramPacket(buf, buf.length);
                        try {
                            socket.receive(packet);
                        } catch (SocketTimeoutException timeout) {
                            break;
                        } catch (Exception ignored) {
                            break;
                        }
                        handlePacket(packet, beaconPort, found);
                    }

                    // 收到一台就够了：已经能确定电脑在哪，提前结束，少等一秒。
                    if (!found.isEmpty()) break;
                    if (round < MAX_ROUNDS - 1 && System.currentTimeMillis() - startedAt + ROUND_GAP_MS < timeoutMs) {
                        Thread.sleep(ROUND_GAP_MS);
                    }
                }
            } catch (Exception ignored) {
                // 没有 Wi-Fi、广播被系统拒绝、socket 建不起来……都按「没找到」返回，
                // 由网页层给出「检查同一 Wi-Fi / 电脑是否开着」的提示。
            } finally {
                if (socket != null) {
                    try { socket.close(); } catch (Exception ignored) { }
                }
            }

            JSObject ret = new JSObject();
            ret.put("self", self == null ? "" : self);
            ret.put("port", beaconPort);
            ret.put("tookMs", (int) (System.currentTimeMillis() - startedAt));
            JSArray arr = new JSArray();
            for (JSObject item : found.values()) arr.put(item);
            ret.put("found", arr);
            call.resolve(ret);
        }).start();
    }

    /**
     * 当前网络是不是 Wi-Fi / 有线。设置页用它决定要不要提示「连同一个 Wi-Fi」。
     * 返回：{ ok: true, hasWifi: boolean }
     */
    @PluginMethod
    public void info(PluginCall call) {
        boolean hasWifi = false;
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null && cm.getActiveNetwork() != null) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
                hasWifi = caps != null && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                        || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
            }
        } catch (Exception ignored) {
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("hasWifi", hasWifi);
        call.resolve(ret);
    }

    /** 解析一包回包；只有 shixu:1 的 JSON 才算，避免把 8799 上别的服务当成时序。 */
    private void handlePacket(DatagramPacket packet, int fallbackPort, Map<String, JSObject> found) {
        try {
            String text = new String(packet.getData(), packet.getOffset(), packet.getLength(), StandardCharsets.UTF_8).trim();
            if (text.isEmpty()) return;
            JSONObject json = new JSONObject(text);
            if (json.optInt("shixu", 0) != 1) return;

            String host = packet.getAddress() == null ? "" : packet.getAddress().getHostAddress();
            if (host.isEmpty() || found.containsKey(host)) return;

            int httpPort = json.optInt("port", fallbackPort);
            String url = "";
            JSONArray urls = json.optJSONArray("urls");
            if (urls != null && urls.length() > 0) {
                String first = urls.optString(0, "").trim();
                if (first.startsWith("http://") || first.startsWith("https://")) url = first;
            }
            if (url.isEmpty()) url = "http://" + host + ":" + httpPort;

            JSObject item = new JSObject();
            item.put("url", url);
            item.put("host", host);
            item.put("port", httpPort);
            if (json.has("seq")) item.put("seq", json.optLong("seq"));
            if (json.has("dbId")) item.put("dbId", json.optString("dbId", ""));
            if (json.has("name")) item.put("name", json.optString("name", ""));
            found.put(host, item);
        } catch (Exception ignored) {
            // 不是 JSON / 不是时序的回包，直接忽略。
        }
    }

    /** 本机第一个可用的 IPv4（优先 192.168/10/172 这类局域网地址），没有就返回空串。 */
    private String selfAddress() {
        String fallback = "";
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                for (InterfaceAddress ia : nif.getInterfaceAddresses()) {
                    InetAddress address = ia.getAddress();
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress() || address.isLinkLocalAddress()) continue;
                    String ip = address.getHostAddress();
                    if (address.isSiteLocalAddress()) return ip;
                    if (fallback.isEmpty()) fallback = ip;
                }
            }
        } catch (Exception ignored) {
        }
        return fallback;
    }

    /** 所有 up 且非 loopback 网卡的 IPv4 广播地址，再加上 255.255.255.255，去重。 */
    private List<InetAddress> broadcastTargets() {
        List<InetAddress> out = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                for (InterfaceAddress ia : nif.getInterfaceAddresses()) {
                    if (!(ia.getAddress() instanceof Inet4Address)) continue;
                    InetAddress broadcast = ia.getBroadcast();
                    if (broadcast == null) continue; // 点对点网卡没有广播地址
                    if (seen.add(broadcast.getHostAddress())) out.add(broadcast);
                }
            }
        } catch (Exception ignored) {
        }
        try {
            InetAddress limited = InetAddress.getByName(LIMITED_BROADCAST);
            if (seen.add(LIMITED_BROADCAST)) out.add(limited);
        } catch (Exception ignored) {
        }
        return out;
    }
}
