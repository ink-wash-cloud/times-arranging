package com.shixu.schedule;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 桌面小组件：今天要做什么，摆在桌面上直接点掉，不用进应用。
 *
 * 数据来自 WidgetStore 里的快照（网页层推过来的）。行有两种：
 *   kind=task   点一下 = 完成（划掉并消失，和系统备忘/日程一个手感）
 *   kind=course 点一下 = 打开应用看课表
 * 最多显示 6 行，多了就只显示最靠前的几件。
 */
public class TaskWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) render(context, mgr, id);
    }

    /** 桌面上所有小组件重画一遍 */
    public static void refreshAll(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(context, TaskWidgetProvider.class));
        for (int id : ids) render(context, mgr, id);
    }

    private static PendingIntent openApp(Context context, int req) {
        Intent i = new Intent(context, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, req, i,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void render(Context context, AppWidgetManager mgr, int widgetId) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_shixu);
        try {
            String raw = WidgetStore.snapshot(context);
            JSONObject s = new JSONObject(raw == null || raw.isEmpty() ? "{}" : raw);
            v.setTextViewText(R.id.widget_title, s.optString("title", "时序 · 今天"));
            v.setTextViewText(R.id.widget_sub, s.optString("sub", ""));
            JSONArray items = s.optJSONArray("items");
            v.setViewVisibility(R.id.widget_empty, items == null || items.length() == 0 ? View.VISIBLE : View.GONE);
        } catch (Exception ignored) {
            // 快照坏了就当空列表，不能把小组件整崩
        }

        // 列表数据由 WidgetService 提供：这样小组件框里装不下时可以上下滚动
        Intent svc = new Intent(context, WidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(android.net.Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.widget_list, svc);

        // 行内的点击靠"模板 + 填充"：整行=完成/打卡，右边的 ✕=只从桌面清掉
        Intent tap = new Intent(context, WidgetActionReceiver.class);
        tap.setAction(WidgetActionReceiver.ACTION_DONE);
        PendingIntent template = PendingIntent.getBroadcast(context, widgetId, tap,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        v.setPendingIntentTemplate(R.id.widget_list, template);
        v.setEmptyView(R.id.widget_list, R.id.widget_empty);

        v.setOnClickPendingIntent(R.id.widget_head, openApp(context, widgetId));
        mgr.updateAppWidget(widgetId, v);
        mgr.notifyAppWidgetViewDataChanged(widgetId, R.id.widget_list);
    }
}
