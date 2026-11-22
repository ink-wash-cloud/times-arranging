package com.shixu.schedule;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 桌面小组件与网页层之间的中转站。
 *
 * 分两块：
 *   snapshot —— 小组件该显示什么（网页层每次数据变化后推过来）
 *   ops      —— 用户在小组件上点掉的操作，排在这儿等应用来取
 *
 * 之所以要中转：网页层的数据在 WebView 的 IndexedDB 里，原生这边读不到；
 * 而小组件必须在应用没打开时也能显示、也能点，所以各存一份。
 */
public class WidgetStore {
    private static final String PREF = "shixu_widget";
    private static final String KEY_SNAPSHOT = "snapshot";
    private static final String KEY_OPS = "ops";

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    public static String snapshot(Context c) {
        return prefs(c).getString(KEY_SNAPSHOT, "");
    }

    public static void setSnapshot(Context c, String json) {
        prefs(c).edit().putString(KEY_SNAPSHOT, json == null ? "" : json).apply();
    }

    public static String ops(Context c) {
        return prefs(c).getString(KEY_OPS, "[]");
    }

    public static void setOps(Context c, String json) {
        prefs(c).edit().putString(KEY_OPS, json == null ? "[]" : json).apply();
    }

    public static void addOp(Context c, JSONObject op) {
        try {
            JSONArray arr = new JSONArray(ops(c));
            arr.put(op);
            setOps(c, arr.toString());
        } catch (Exception ignored) {
            // 队列坏了就重开一个，不能让它把点击也一起卡住
            JSONArray fresh = new JSONArray();
            fresh.put(op);
            setOps(c, fresh.toString());
        }
    }
}
