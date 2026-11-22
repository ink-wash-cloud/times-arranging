// 领域模型与共享常量（前后端共用的数据契约）

export type CollectionName =
  | 'tasks' | 'habits' | 'habitLogs' | 'anniversaries'
  | 'courses' | 'courseChanges' | 'budgets' | 'expenses' | 'lifeEvents' | 'inspirations'
  | 'goals' | 'schedule' | 'settings';

/** 同步信封：本地 IndexedDB 与服务端 SQLite 使用同一结构 */
export interface Envelope<T = unknown> {
  collection: CollectionName;
  id: string;
  updatedAt: number;   // 毫秒时间戳（单调递增）
  deviceId: string;    // 设备指纹，时间戳相同时用于决胜
  deleted?: 0 | 1;     // 墓碑标记，用于跨设备删除同步
  dirty?: 0 | 1;       // 本地未推送标记（仅本地字段，不上传）
  data: T;
}

/* ------------------------------- 待办事项 ------------------------------- */
export const CATEGORIES = ['学习', '自媒体', '杂事'] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUSES = ['未开始', '进行中', '已完成', '已延期'] as const;
export type TaskStatus = (typeof STATUSES)[number];

export const REPEATS = ['不重复', '每天', '每周', '每月', '每年'] as const;
export type RepeatRule = (typeof REPEATS)[number];

export interface TaskData {
  title: string;
  category: Category;
  dueDate: string | null;      // YYYY-MM-DD；null 表示未安排（进入时间池）
  dueTime: string | null;      // HH:mm
  /** 自己设的提醒时刻（本机时间，'YYYY-MM-DDTHH:mm'）。
   *  与「截止前 N 分钟」那套自动提醒相互独立：到点直接推一条通知，清空即不再提醒。 */
  remindAt?: string | null;
  priority: Priority;
  status: TaskStatus;
  estimateMinutes: number;     // 预计耗时（分钟）
  repeat: RepeatRule;
  note: string;
  anniversaryId: string | null; // 关联的重要日期：完成后进度 +10%
  completedAt: number | null;
  createdAt: number;
}

/* ------------------------------- 习惯打卡 ------------------------------- */
export interface HabitData {
  name: string;
  icon: string;
  color: string;
  paused: boolean;   // 暂停后不再计入今日待打卡
  note: string;
  createdAt: number;
  /** 每日最低完成量。像"背单词 20 个""跑步 30 分钟"这种，
   *  记录的是当天做了多少，达到这个量才算达标。
   *  留空或 0 表示不设量，做了就算（老习惯的行为）。 */
  dailyMin?: number;
  /** 完成量的单位：个 / 页 / 分钟 / 公里… */
  unit?: string;
  /** 每天固定的提醒时刻，HH:mm 列表，想设几个设几个（早上七点、中午十二点、晚上九点…）。
   *  每个时刻到点都会单独弹一条系统通知，不是静默通知。
   *  总开关在设置 → 提醒，或者课表/习惯设置里的「按时间点提醒」。 */
  remindTimes?: string[];
}

export interface HabitLogData {
  habitId: string;
  date: string;   // YYYY-MM-DD
  at: number;
  /** 当天实际完成量。老记录没有这个字段，按"刚好达标"处理 */
  amount?: number;
}

/* ------------------------------- 重要日期 ------------------------------- */
export const ANNIVERSARY_TYPES = ['生日', '纪念日', '节日'] as const;
export type AnniversaryType = (typeof ANNIVERSARY_TYPES)[number];

export interface AnniversaryData {
  title: string;
  type: AnniversaryType;
  icon: string;
  date: string;          // 起始/发生日期 YYYY-MM-DD
  repeatYearly: boolean; // 每年重复（生日/纪念日/固定节日）
  progress: number;      // 准备进度 0-100
  note: string;
  createdAt: number;
}

/* -------------------------------- 课表 -------------------------------- */
export interface CourseData {
  name: string;
  teacher: string;
  location: string;
  /** 班级 / 教学班。课表是全年段共用的，靠它筛出自己班那一张。
   *  老数据没有这个字段，一律按空串（未分班）处理。 */
  className?: string;
  /** 精确周次集合。教务系统常给"5-6,8-13周"这种不连续周次，
   *  光用 startWeek~endWeek 一个区间表示不了，所以单独存一份。
   *  有它时以它为准，没有就退回到 startWeek/endWeek/单双周。 */
  weeks?: number[];
  weekday: number;        // 1=周一 ... 7=周日
  startTime: string;      // HH:mm
  endTime: string;        // HH:mm
  startWeek: number;
  endWeek: number;
  weekParity: 'all' | 'odd' | 'even';  // 单周/双周/每周
  color: string;
  note: string;
  createdAt: number;
}

/** 临时调课 / 停课：只改"某一天的那一次"，不动常规课表。
 *  老师临时换课、临时停课都走这里，期末一看记录也知道哪几次是调过的。
 *  id 规则：courseId + ':' + date（同一门课同一天只有一条） */
export interface CourseChangeData {
  courseId: string;
  /** 原定上课的那一天（YYYY-MM-DD） */
  date: string;
  kind: 'cancel' | 'move' | 'edit';
  /** kind='move'：调到哪一天 */
  toDate?: string;
  /** 调整后的时间 / 地点 / 老师，留空表示沿用原来的 */
  startTime?: string;
  endTime?: string;
  location?: string;
  teacher?: string;
  note?: string;
  createdAt: number;
}

/* ------------------------------- 灵感池 ------------------------------- */
export const INSPIRATION_KINDS = ['灵感', '事件', '摘录'] as const;
export type InspirationKind = (typeof INSPIRATION_KINDS)[number];

export interface InspirationData {
  text: string;
  kind: InspirationKind;
  tag: string;                     // 自由标签，便于事后归拢
  pinned: boolean;                 // 置顶
  archived: boolean;               // 归档（不删除，移出主列表）
  convertedTaskId: string | null;  // 已转为待办时记录任务 id
  createdAt: number;
}

/* ------------------------------- 预算记账 ------------------------------- */
export interface BudgetData {
  amount: number;   // 该月总预算
}

export interface ExpenseData {
  title: string;
  amount: number;
  category: string;
  date: string;      // YYYY-MM-DD
  createdAt: number;
}

/* ------------------------------- 长远目标 ------------------------------- */
/** 不像待办那样占每天的时间：只有目标日、进度和一次「到点提醒」。
 *  remindAt 由界面上的预设（30 天后 / 3 个月后 / 半年后 / 一年后）换算成具体时刻。 */
export interface GoalData {
  title: string;
  category: Category;
  note: string;
  targetDate: string | null;   // 目标日 YYYY-MM-DD
  remindAt: string | null;     // 提醒时刻 'YYYY-MM-DDTHH:mm'，null 表示不提醒
  progress: number;            // 0-100
  milestones: string;          // 自由文本：单词背完 2800/4500 这种
  /** 每次「记录进度」的时间戳（跟着记录一起同步）。
   *  顶栏的「本月累计推进 X 次」就是数它——存本地的话换台设备数字就变了。 */
  progressLog?: number[];
  status: '进行中' | '已完成';
  completedAt: number | null;
  createdAt: number;
}

/* ------------------------------- 日程表 ------------------------------- */
/** 一天里的一段安排。时间存「当天第几秒」，界面上任何一种缩放都不改它，
 *  只有拖拽/编辑时才按当前缩放档的最小刻度取整。 */
export interface ScheduleBlockData {
  title: string;
  date: string;                // YYYY-MM-DD
  start: number;               // 当天第几秒 0-86399
  end: number;                 // 当天第几秒，必须 > start
  color: string;
  category?: Category;
  note: string;
  done?: boolean;
  createdAt: number;
}

/* ----------------------------- 人生最新一次 ----------------------------- */
export interface LifeEventData {
  title: string;      // 例如：理发、体检、给家里打电话
  icon: string;
  lastDate: string;   // YYYY-MM-DD
  cycleDays: number;  // 期望间隔天数，用于提示「该做了」
  note: string;
  createdAt: number;
}

/* -------------------------------- 设置 -------------------------------- */
export interface SettingsData {
  nickname: string;
  serverUrl: string;
  syncToken: string;
  autoSync: boolean;
  lastPulledSeq: number;
  lastSyncAt: number;
}

/* ------------------------------ 展示用常量 ------------------------------ */
/* 低饱和莫兰迪色系：在 INS 奶油底与霓虹暗底上都耐看 */
export const CATEGORY_COLORS: Record<string, string> = {
  学习: '#8aa9e8', 自媒体: '#e9a08c', 杂事: '#ada6bb'
};
export const PRIORITY_COLORS: Record<string, string> = {
  P0: '#e07f8c', P1: '#e0aa78', P2: '#8aa9e8', P3: '#ada6bb'
};
export const STATUS_COLORS: Record<string, string> = {
  未开始: '#ada6bb', 进行中: '#8aa9e8', 已完成: '#77c39b', 已延期: '#e07f8c'
};
export const COURSE_PALETTE = [
  '#8aa9e8', '#77c39b', '#e9a08c', '#b79ae0', '#e6c27a',
  '#7fc7cf', '#e79ab8', '#a8c97f', '#e0857f', '#9a9ae0'
];
export const KIND_COLORS: Record<string, string> = {
  灵感: '#e6c27a', 事件: '#7fc7cf', 摘录: '#b79ae0'
};
export const KIND_ICONS: Record<string, string> = {
  灵感: '💡', 事件: '⚡', 摘录: '📎'
};
export const HABIT_ICONS = ['💪','📖','🏃','🧘','💧','🌙','✍️','🎯','🥗','🦷','💻','🎸'];
export const LIFE_ICONS = ['✂️','🩺','📞','🚿','🛒','🎬','🧹','💇','🏥','📷'];
export const ANNIVERSARY_ICONS = ['🎂','❤️','🎉','🎓','💍','🏮','🎄','🌸','⭐','🎁'];
