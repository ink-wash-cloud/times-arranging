import { useEffect } from 'react';
import { list, useDB } from '../lib/db';
import type { GoalData } from '../types';
import { toast } from '../components/ui';
import { t } from '../lib/i18n';
import {
  goalReminderDue, markGoalReminderFired, wasGoalReminderFired
} from '../lib/goals';

/**
 * 长远目标的到点提醒。
 * 以前挂在「待办事项」页里，只有停在那一页且窗口开着才会弹；现在挂到 App 全局，
 * 切到课表、日程表、消费记录任意一页都照常提醒。
 * 原生（安卓）系统通知由 lib/nativeReminders.ts 另排一份，两条路互不影响。
 */
export default function GoalReminder() {
  useDB();
  const rows = list<GoalData>('goals');
  const key = rows.map((g) => g.id + '|' + g.status + '|' + (g.remindAt || '')).join(',');

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      for (const goal of list<GoalData>('goals')) {
        if (goal.status !== '进行中' || !goalReminderDue(goal.remindAt, now)) continue;
        if (wasGoalReminderFired(goal.id, goal.remindAt)) continue;
        markGoalReminderFired(goal.id, goal.remindAt);
        const title = t('目标提醒：{title}', { title: goal.title });
        toast(title, 'info');
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification(title, { body: t('到点了，记一笔进度吧') });
          }
        } catch { /* 浏览器不许就直接算了，页面里已经有 toast */ }
      }
    };
    const timer = window.setInterval(tick, 30000);
    tick();
    return () => window.clearInterval(timer);
  }, [key]);

  return null;
}
