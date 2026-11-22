package com.shixu.schedule;

import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 小组件里的列表。用集合型小组件（ListView + RemoteViewsService）而不是一行行拼，
 * 这样才能在小组件框里上下滚动 —— 事项多、或者用户把小组件拉小了，都能滑着看。
 */
public class WidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static class Factory implements RemoteViewsService.RemoteViewsFactory {
        private final Context ctx;
        private JSONArray items = new JSONArray();

        Factory(Context c) { this.ctx = c; }

        @Override public void onCreate() { load(); }
        @Override public void onDataSetChanged() { load(); }
        @Override public void onDestroy() { items = new JSONArray(); }

        private void load() {
            try {
                String raw = WidgetStore.snapshot(ctx);
                JSONObject s = new JSONObject(raw == null || raw.isEmpty() ? "{}" : raw);
                JSONArray arr = s.optJSONArray("items");
                items = arr == null ? new JSONArray() : arr;
            } catch (Exception e) {
                items = new JSONArray();
            }
        }

        @Override public int getCount() { return items.length(); }

        @Override public RemoteViews getViewAt(int position) {
            RemoteViews row = new RemoteViews(ctx.getPackageName(), R.layout.widget_shixu_row);
            JSONObject it = items.optJSONObject(position);
            if (it == null) return row;
            String kind = it.optString("kind", "task");
            row.setTextViewText(R.id.row_mark, it.optString("mark", kind.equals("course") ? "🕘" : "○"));
            row.setTextViewText(R.id.row_text, it.optString("text", ""));
            String meta = it.optString("meta", "");
            row.setViewVisibility(R.id.row_meta, meta.isEmpty() ? View.GONE : View.VISIBLE);
            row.setTextViewText(R.id.row_meta, meta);

            String id = it.optString("id", "");
            String op = it.optString("op", "");
            // 整行：待办=完成、习惯=打卡；课程/信息行点了就打开应用
            Intent main = new Intent();
            main.putExtra("id", id);
            main.putExtra("op", op.isEmpty() ? "open" : op);
            row.setOnClickFillInIntent(R.id.row_root, main);
            // 右边的 ✕：只从桌面清掉，不改数据（比如"这件事我今天不打算做了"）
            Intent hide = new Intent();
            hide.putExtra("id", id);
            hide.putExtra("op", "widget-hide");
            row.setOnClickFillInIntent(R.id.row_dismiss, hide);
            row.setViewVisibility(R.id.row_dismiss, id.isEmpty() ? View.GONE : View.VISIBLE);
            return row;
        }

        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }
    }
}
