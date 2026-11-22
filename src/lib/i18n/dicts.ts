// 汇总各领域的译文表。加新的领域文件时：① 在这里 import ② 展开到 EN/JA 里。
import * as core from './dict/core';
import * as tt from './dict/tt';
import * as tasks from './dict/tasks';
import * as settings from './dict/settings';
import * as libs from './dict/libs';
import * as goals from './dict/goals';
import * as schedule from './dict/schedule';
import * as expenses from './dict/expenses';

export const EN: Record<string, string> = {
  ...core.en, ...tt.en, ...tasks.en, ...settings.en, ...libs.en,
  ...goals.en, ...schedule.en, ...expenses.en
};

export const JA: Record<string, string> = {
  ...core.ja, ...tt.ja, ...tasks.ja, ...settings.ja, ...libs.ja,
  ...goals.ja, ...schedule.ja, ...expenses.ja
};

/** 所有领域文件，供 check-i18n 做覆盖率检查 */
export const DOMAINS = { core, tt, tasks, settings, libs, goals, schedule, expenses };
