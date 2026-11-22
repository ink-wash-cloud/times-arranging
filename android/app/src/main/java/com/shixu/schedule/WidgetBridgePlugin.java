package com.shixu.schedule;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

/**
 * 网页层和桌面小组件之间的桥：
 *   update  网页层把"今天显示什么"推给小组件（数据一变就推）
 *   drain   取走用户在小组件上点掉的操作，网页层再落到本地库并同步
 *   status  桌面上加了几个小组件（设置页用来提示"已添加 / 还没添加"）
 */
@CapacitorPlugin(name = "ShixuWidget")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void update(PluginCall call) {
        String json = call.getString("json", "{}");
        WidgetStore.setSnapshot(getContext(), json);
        TaskWidgetProvider.refreshAll(getContext());
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void drain(PluginCall call) {
        String ops = WidgetStore.ops(getContext());
        WidgetStore.setOps(getContext(), "[]");
        JSObject ret = new JSObject();
        try {
            ret.put("ops", new JSONArray(ops == null || ops.isEmpty() ? "[]" : ops));
        } catch (Exception e) {
            ret.put("ops", new JSONArray());
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void status(PluginCall call) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(getContext());
        int[] ids = mgr.getAppWidgetIds(new ComponentName(getContext(), TaskWidgetProvider.class));
        JSObject ret = new JSObject();
        ret.put("count", ids.length);
        call.resolve(ret);
    }
}
