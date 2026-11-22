// 首次体验用的示例数据（可一键清空）
import { putRecord, newId, list, dbStats, removeRecord } from './db';
import { todayStr, addDays } from './date';
import type { CourseData, TaskData, HabitData, HabitLogData, AnniversaryData, ExpenseData, BudgetData, LifeEventData, InspirationData } from '../types';
import { habitLogId } from './actions';

export function isEmptyDB(): boolean {
  return dbStats().total === 0;
}

export function seedDemo(): void {
  const today = todayStr();
  const now = Date.now();

  /* 课表 */
  const courses: Array<Omit<CourseData, 'createdAt'>> = [
    { name: '高等数学 A', teacher: '张建国', location: '教三 201', weekday: 1, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 16, weekParity: 'all', color: '#4f8cff', note: '' },
    { name: '大学英语（三）', teacher: '李梅', location: '外语楼 305', weekday: 1, startTime: '10:00', endTime: '11:40', startWeek: 1, endWeek: 16, weekParity: 'all', color: '#22c55e', note: '' },
    { name: '数据结构', teacher: '王强', location: '计算机楼 A401', weekday: 2, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 16, weekParity: 'all', color: '#ff7a59', note: '带实验' },
    { name: '线性代数', teacher: '陈立', location: '教二 108', weekday: 2, startTime: '14:00', endTime: '15:40', startWeek: 1, endWeek: 16, weekParity: 'all', color: '#a855f7', note: '' },
    { name: '大学物理', teacher: '刘洋', location: '理科楼 502', weekday: 3, startTime: '10:00', endTime: '11:40', startWeek: 1, endWeek: 16, weekParity: 'all', color: '#f59e0b', note: '' },
    { name: '计算机网络', teacher: '赵敏', location: '计算机楼 A302', weekday: 3, startTime: '16:00', endTime: '17:40', startWeek: 1, endWeek: 16, weekParity: 'even', color: '#06b6d4', note: '双周上课' },
    { name: '操作系统', teacher: '孙浩', location: '计算机楼 A305', weekday: 4, startTime: '08:00', endTime: '09:40', startWeek: 1, endWeek: 16, weekParity: 'all', color: '#ec4899', note: '' },
    { name: '体育（羽毛球）', teacher: '周伟', location: '体育馆', weekday: 4, startTime: '16:00', endTime: '17:40', startWeek: 1, endWeek: 16, weekParity: 'all', color: '#84cc16', note: '' },
    { name: '概率论与数理统计', teacher: '吴静', location: '教三 105', weekday: 5, startTime: '10:00', endTime: '11:40', startWeek: 1, endWeek: 16, weekParity: 'all', color: '#f43f5e', note: '' },
    { name: '算法设计与分析', teacher: '郑凯', location: '计算机楼 A401', weekday: 5, startTime: '14:00', endTime: '15:40', startWeek: 1, endWeek: 16, weekParity: 'odd', color: '#6366f1', note: '单周上课' }
  ];
  for (const c of courses) putRecord<CourseData>('courses', newId(), { ...c, createdAt: now });

  /* 重要日期（先建，供待办关联） */
  const annIds: string[] = [];
  const anns: Array<Omit<AnniversaryData, 'createdAt'>> = [
    { title: '妈妈生日', type: '生日', icon: '🎂', date: addDays(today, 12), repeatYearly: true, progress: 30, note: '准备一双舒适的鞋' },
    { title: '和 ta 在一起纪念日', type: '纪念日', icon: '❤️', date: addDays(today, 3), repeatYearly: true, progress: 60, note: '订餐厅、准备礼物' },
    { title: '期末考试周', type: '节日', icon: '📚', date: addDays(today, 45), repeatYearly: false, progress: 15, note: '复习计划已排' },
    { title: '室友生日', type: '生日', icon: '🎉', date: addDays(today, 26), repeatYearly: true, progress: 0, note: '' }
  ];
  for (const a of anns) {
    const id = newId();
    putRecord<AnniversaryData>('anniversaries', id, { ...a, createdAt: now });
    annIds.push(id);
  }

  /* 待办 */
  const tasks: Array<Partial<TaskData>> = [
    { title: '交高等数学作业第三章', category: '学习', dueDate: today, dueTime: '20:00', priority: 'P0', estimateMinutes: 60, repeat: '每周' },
    { title: '剪辑并发布本周 vlog', category: '自媒体', dueDate: today, priority: 'P1', estimateMinutes: 120, repeat: '每周' },
    { title: '复习数据结构第五章', category: '学习', dueDate: today, priority: 'P1', estimateMinutes: 90 },
    { title: '取快递', category: '杂事', dueDate: today, priority: 'P3', estimateMinutes: 15 },
    { title: '写计算机网络实验报告', category: '学习', dueDate: addDays(today, 2), priority: 'P0', estimateMinutes: 150 },
    { title: '为纪念日准备礼物', category: '杂事', dueDate: addDays(today, 3), priority: 'P0', estimateMinutes: 90, anniversaryId: annIds[1] },
    { title: '剪辑下期选题脚本', category: '自媒体', dueDate: addDays(today, 4), priority: 'P2', estimateMinutes: 60 },
    { title: '背 200 个考研单词', category: '学习', dueDate: addDays(today, 1), priority: 'P1', estimateMinutes: 45, repeat: '每天' },
    { title: '补交上周的英语作文', category: '学习', dueDate: addDays(today, -2), priority: 'P0', estimateMinutes: 40 },
    { title: '归还图书馆的书', category: '杂事', dueDate: addDays(today, -1), priority: 'P2', estimateMinutes: 20 },
    { title: '完成上月的账号数据复盘', category: '自媒体', dueDate: addDays(today, -5), priority: 'P1', estimateMinutes: 60, status: '已完成', completedAt: now - 86400000 },
    { title: '整理宿舍书桌', category: '杂事', dueDate: addDays(today, -3), priority: 'P3', estimateMinutes: 30, status: '已完成', completedAt: now - 2 * 86400000 },
    { title: '看完《深入理解计算机系统》第 3 章', category: '学习', estimateMinutes: 180 },
    { title: '研究新的封面模板', category: '自媒体', estimateMinutes: 90 },
    { title: '预约体检', category: '杂事', estimateMinutes: 15 }
  ];
  for (const t of tasks) {
    putRecord<TaskData>('tasks', newId(), {
      title: t.title || '', category: t.category || '杂事', dueDate: t.dueDate ?? null, dueTime: t.dueTime ?? null,
      priority: t.priority || 'P2', status: t.status || '未开始', estimateMinutes: t.estimateMinutes || 30,
      repeat: (t.repeat as TaskData['repeat']) || '不重复', note: t.note || '',
      anniversaryId: t.anniversaryId || null, completedAt: t.completedAt ?? null, createdAt: now
    });
  }

  /* 习惯 */
  const habits: Array<{ d: Omit<HabitData, 'createdAt'>; days: number }> = [
    { d: { name: '早起 7:00', icon: '🌙', color: '#6d8bff', paused: false, note: '' }, days: 7 },
    { d: { name: '背单词', icon: '📖', color: '#22c55e', paused: false, note: '每天 200 个' }, days: 15 },
    { d: { name: '健身 30 分钟', icon: '💪', color: '#ff7a59', paused: false, note: '' }, days: 3 },
    { d: { name: '喝够 8 杯水', icon: '💧', color: '#06b6d4', paused: false, note: '' }, days: 21 },
    { d: { name: '睡前阅读', icon: '📚', color: '#a855f7', paused: true, note: '考试周暂停' }, days: 5 }
  ];
  for (const h of habits) {
    const hid = newId();
    putRecord<HabitData>('habits', hid, { ...h.d, createdAt: now });
    for (let i = h.days - 1; i >= 0; i--) {
      const date = addDays(today, -i);
      putRecord<HabitLogData>('habitLogs', habitLogId(hid, date), { habitId: hid, date, at: now - i * 86400000 });
    }
  }

  /* 预算与支出 */
  const month = today.slice(0, 7);
  putRecord<BudgetData>('budgets', month, { amount: 2500 });
  const expenses: Array<[string, number, string, number]> = [
    ['食堂', 32, '餐饮', 0], ['奶茶', 18, '餐饮', 1], ['地铁', 6, '交通', 1],
    ['教材', 128, '学习', 3], ['外卖', 45, '餐饮', 4], ['电影票', 78, '娱乐', 6],
    ['超市采购', 156, '生活', 8], ['话费', 59, '通讯', 10]
  ];
  for (const [title, amount, cat, ago] of expenses) {
    putRecord<ExpenseData>('expenses', newId(), { title, amount, category: cat, date: addDays(today, -ago), createdAt: now });
  }

  /* 灵感池 */
  const ideas: Array<[string, InspirationData['kind'], number]> = [
    ['地铁上想到一个选题：把「大学四年」做成一条时间轴动画，比 vlog 更有记忆点', '灵感', 2 * 3600e3],
    ['食堂阿姨说「多吃点，看你瘦了」——有点想家', '事件', 26 * 3600e3],
    ['「我们总高估一年能做的事，低估十年能做的事。」', '摘录', 3 * 86400e3],
    ['论文可以用「先写图表再写正文」的顺序，效率会高很多', '灵感', 5 * 86400e3],
    ['图书馆三楼靠窗的位置下午有太阳，适合看书', '事件', 9 * 86400e3]
  ];
  for (const [text, kind, agoMs] of ideas) {
    putRecord<InspirationData>('inspirations', newId(), {
      text, kind, tag: '', pinned: false, archived: false, convertedTaskId: null, createdAt: now - agoMs
    });
  }

  /* 人生最新一次 */
  const life: Array<Omit<LifeEventData, 'createdAt'>> = [
    { title: '理发', icon: '✂️', lastDate: addDays(today, -34), cycleDays: 30, note: '' },
    { title: '体检', icon: '🩺', lastDate: addDays(today, -210), cycleDays: 365, note: '' },
    { title: '给家里打电话', icon: '📞', lastDate: addDays(today, -2), cycleDays: 3, note: '' },
    { title: '看完一部电影', icon: '🎬', lastDate: addDays(today, -9), cycleDays: 7, note: '' },
    { title: '整理照片备份', icon: '📷', lastDate: addDays(today, -61), cycleDays: 90, note: '' }
  ];
  for (const l of life) putRecord<LifeEventData>('lifeEvents', newId(), { ...l, createdAt: now });
}

/** 清空全部业务数据（写墓碑，会同步到其他设备） */
export function clearAllData(): number {
  let n = 0;
  const collections = ['tasks', 'habits', 'habitLogs', 'anniversaries', 'courses', 'budgets', 'expenses', 'lifeEvents', 'inspirations'] as const;
  for (const c of collections) {
    for (const it of list(c)) { removeRecord(c, it.id); n++; }
  }
  return n;
}
