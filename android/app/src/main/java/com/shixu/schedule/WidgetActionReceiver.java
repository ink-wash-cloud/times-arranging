package com.shixu.schedule;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 小组件上点掉一行待办。
 *
 * 分两步：
 *   1. 立刻把这一行从快照里拿掉并重画 —— 用户点完马上看到"没了"，不依赖应用在不在跑
 *   2. 把这次操作排进队列，等应用下次打开时取走，落到本地库并同步到电脑
 *
 * 之所以不在这儿直接发 HTTP：本地库才是数据的正本，原生这边只拿得到快照，
 * 直接推给服务器会把任务里其它字段一起冲掉。
 */
public class WidgetActionReceiver extends BroadcastReceiver {
    public static final String ACTION_DONE = "com.shixu.schedule.WIDGET_DONE";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_DONE.equals(intent.getAction())) return;
        String id = intent.getStringExtra("id");
        if (id == null || id.isEmpty()) return;
        String opKind = intent.getStringExtra("op");
        if (opKind == null || opKind.isEmpty()) opKind = "task-done";
        if ("open".equals(opKind)) {                       // 课程 / 只看的信息行：点了就开应用
            Intent app = new Intent(context, MainActivity.class);
            app.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(app);
            return;
        }
        try {
            String raw = WidgetStore.snapshot(context);
            JSONObject s = new JSONObject(raw == null || raw.isEmpty() ? "{}" : raw);
            JSONArray items = s.optJSONArray("items");
            JSONArray keep = new JSONArray();
            if (items != null) {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject it = items.optJSONObject(i);
                    if (it == null) continue;
                    if (id.equals(it.optString("id"))) continue;   // 完成的直接消失
                    keep.put(it);
                }
            }
            s.put("items", keep);
            JSONObject counts = s.optJSONObject("counts");
            if (counts != null) {
                int left = Math.max(0, counts.optInt("todo", 0) - 1);
                counts.put("todo", left);
                s.put("counts", counts);
            }
            WidgetStore.setSnapshot(context, s.toString());

            JSONObject op = new JSONObject();
            op.put("type", opKind);
            op.put("id", id);
            op.put("at", System.currentTimeMillis());
            WidgetStore.addOp(context, op);
        } catch (Exception ignored) {
            // 忽略：至少别崩
        }
        TaskWidgetProvider.refreshAll(context);
    }
}
