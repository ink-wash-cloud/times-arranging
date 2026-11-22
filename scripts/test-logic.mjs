// 纯逻辑单元测试（esbuild 打包 TS 后直接运行，不依赖浏览器）
// 所有基准日期都相对"真实今天"推导，因此不受运行时钟影响
import { build } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';

mkdirSync('.tmp', { recursive: true });
await build({
  entryPoints: { logic: 'src/lib/logic.ts', date: 'src/lib/date.ts', tt: 'src/lib/timetable.ts', bg: 'src/lib/bgStyle.ts', log: 'src/lib/changelog.ts' },
  bundle: true, format: 'esm', platform: 'neutral', outdir: '.tmp', logLevel: 'silent',
  external: ['xlsx']
});

const L = await import('../.tmp/logic.js');
const D = await import('../.tmp/date.js');
const T = await import('../.tmp/tt.js');
const BG = await import('../.tmp/bg.js');
const LOG = await import('../.tmp/log.js');

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  -> ' + JSON.stringify(e) : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), { got: a, want: b });
const ago = (n) => D.addDays(TODAY, -n);
const ahead = (n) => D.addDays(TODAY, n);
/** 把某个具体日期改写成固定的 2000 年同月同日，用于"每年重复"的测试 */
const asYear = (ymd, year) => {
  const p = String(ymd).split('-');
  return year + '-' + p[1] + '-' + p[2];
};

const TODAY = D.todayStr();
console.log('基准日期（真实今天）: ' + TODAY + '\n');

console.log('[日期工具]');
eq('addDays 跨月', D.addDays('2026-02-27', 3), '2026-03-02');
eq('diffDays', D.diffDays('2026-03-01', '2026-03-10'), 9);
eq('relativeDay 今天', D.relativeDay(TODAY), '今天');
eq('relativeDay 明天', D.relativeDay(ahead(1)), '明天');
eq('relativeDay 逾期', D.relativeDay(ago(3)), '已逾期 3 天');
eq('startOfWeekMonday 得到周一', D.parseYMD(D.startOfWeekMonday(TODAY)).getDay(), 1);
eq('humanMinutes', D.humanMinutes(150), '2 小时 30 分');
eq('timeToMinutes', D.timeToMinutes('09:40'), 580);
eq('nextOccurrence 一次性事件原样返回', D.nextOccurrence('2026-03-10', false), '2026-03-10');
// 回归：倒计时必须以调用方传入的参考日期为准，而不是系统当前日期
eq('nextOccurrence 尊重传入的参考日期（未过）', D.nextOccurrence('2000-06-01', true, '2026-05-01'), '2026-06-01');
eq('nextOccurrence 尊重传入的参考日期（已过）', D.nextOccurrence('2000-06-01', true, '2026-07-01'), '2027-06-01');

console.log('\n[习惯：连续天数 / 断签重置]');
const mkLogs = (dates) => dates.map((d, i) => ({ id: 'h:' + d, habitId: 'h', date: d, at: i }));
let s = L.habitStat('h', mkLogs([ago(2), ago(1), TODAY]), TODAY);
eq('连续 3 天（含今天）', [s.streak, s.total, s.checkedToday], [3, 3, true]);
s = L.habitStat('h', mkLogs([ago(2), ago(1)]), TODAY);
eq('今日未打卡但连续未断', [s.streak, s.keepAlive], [2, true]);
s = L.habitStat('h', mkLogs([ago(5), ago(2), ago(1), TODAY]), TODAY);
eq('断签后当前连续只算新的一段', s.streak, 3);
eq('累计次数不受断签影响', s.total, 4);
s = L.habitStat('h', mkLogs([ago(9)]), TODAY);
eq('长期断签 → 当前连续为 0', s.streak, 0);
s = L.habitStat('h', mkLogs([ago(9), TODAY]), TODAY);
eq('断签后重新打卡从 1 天开始', s.streak, 1);
s = L.habitStat('h', mkLogs([ago(10), ago(9), ago(8), ago(7), TODAY]), TODAY);
eq('历史最长连续单独统计', [s.streak, s.best], [1, 4]);
eq('最近 7 天格子数', L.habitStat('h', mkLogs([TODAY]), TODAY).last7.length, 7);
eq('最近 7 天最后一格是今天', L.habitStat('h', mkLogs([TODAY]), TODAY).last7[6].isToday, true);

console.log('\n[待办：四栏分栏 + 时间池]');
const tasks = [
  { id: 't1', title: '今天', status: '未开始', dueDate: TODAY, priority: 'P2', category: '学习', createdAt: 1 },
  { id: 't2', title: '两天前到期未完成', status: '进行中', dueDate: ago(2), priority: 'P1', category: '杂事', createdAt: 2 },
  { id: 't3', title: '三天后', status: '未开始', dueDate: ahead(3), priority: 'P0', category: '学习', createdAt: 3 },
  { id: 't4', title: '十天后', status: '未开始', dueDate: ahead(10), priority: 'P1', category: '学习', createdAt: 4 },
  { id: 't5', title: '已完成', status: '已完成', dueDate: ago(1), priority: 'P3', category: '杂事', completedAt: 100, createdAt: 5 },
  { id: 't6', title: '没有日期', status: '未开始', dueDate: null, priority: 'P2', category: '自媒体', createdAt: 6 }
];
const b = L.taskBuckets(tasks, TODAY);
eq('今日栏', b.today.map((t) => t.id), ['t1']);
eq('已逾期栏', b.overdue.map((t) => t.id), ['t2']);
eq('未来 7 天栏', b.next7.map((t) => t.id), ['t3']);
eq('7 天以后栏（回归：以前会凭空消失）', b.later.map((t) => t.id), ['t4']);
eq('已完成栏', b.done.map((t) => t.id), ['t5']);
eq('无日期进入时间池', b.pool.map((t) => t.id), ['t6']);
eq('分栏互斥且覆盖全部（回归）',
  b.today.length + b.overdue.length + b.next7.length + b.later.length + b.done.length + b.pool.length, tasks.length);
eq('显示状态：过期未完成 → 已延期', L.displayStatus(tasks[1], TODAY), '已延期');
eq('显示状态：已完成保持', L.displayStatus(tasks[4], TODAY), '已完成');
eq('排序：P0 优先于 P1', L.sortTasks(tasks[2], tasks[3]) < 0, true);
eq('时间池合计耗时', L.poolStat([
  { id: 'a', status: '未开始', dueDate: null, estimateMinutes: 30 },
  { id: 'b', status: '未开始', dueDate: null, estimateMinutes: 45 }
]), { count: 2, minutes: 75 });

console.log('\n[重要日期：倒计时]');
const anns = [
  { id: 'a1', title: '三天后', date: asYear(ahead(3), 2000), repeatYearly: true, progress: 40 },
  { id: 'a2', title: '今天', date: asYear(TODAY, 1999), repeatYearly: true, progress: 0 },
  { id: 'a3', title: '已过', date: asYear(ago(1), 1990), repeatYearly: true, progress: 10 }
];
const near = L.nearestAnniversary(anns, TODAY);
eq('最近的是"今天"那个', near.a.id, 'a2');
eq('今天 → 0 天', near.s.days, 0);
eq('三天后 → next 正确', L.annStat(anns[0], TODAY).next, ahead(3));
eq('三天后 → 3 天', L.annStat(anns[0], TODAY).days, 3);
ok('已过的日期顺延到下一次', L.annStat(anns[2], TODAY).days > 0, L.annStat(anns[2], TODAY).days);

console.log('\n[预算]');
const budgets = [{ id: '2026-03', amount: 1000 }];
const exps = [
  { id: 'e1', date: '2026-03-01', amount: 300, title: 'a', category: '餐饮', createdAt: 1 },
  { id: 'e2', date: '2026-03-09', amount: 200, title: 'b', category: '交通', createdAt: 2 },
  { id: 'e3', date: '2026-02-28', amount: 999, title: '上个月的', category: '其他', createdAt: 3 }
];
const bs = L.budgetStat(exps, budgets, '2026-03');
eq('本月支出不含上月', bs.spent, 500);
eq('剩余', bs.remaining, 500);
eq('使用比例', bs.pct, 50);
eq('三月天数', bs.daysInMonth, 31);
eq('未设预算时不崩', L.budgetStat([], [], '2026-03').pct, 0);
eq('超支时为负剩余', L.budgetStat(exps, [{ id: '2026-03', amount: 100 }], '2026-03').remaining, -400);

console.log('\n[人生最新一次]');
const life = [
  { id: 'l1', title: '理发', lastDate: ago(37), cycleDays: 30, icon: '', note: '', createdAt: 1 },
  { id: 'l2', title: '体检', lastDate: ago(1), cycleDays: 365, icon: '', note: '', createdAt: 2 }
];
const ll = L.latestLifeEvent(life, TODAY);
eq('取最近发生的一件', ll.event.id, 'l2');
eq('距今天数', ll.days, 1);
eq('超过建议周期 → 提示该做了', L.latestLifeEvent([life[0]], TODAY).overdue, true);
eq('未超过建议周期', L.latestLifeEvent([life[1]], TODAY).overdue, false);

console.log('\n[课表：教学周与单双周]');
const termStart = D.startOfWeekMonday(TODAY);
const wdToday = ((D.parseYMD(TODAY).getDay() + 6) % 7) + 1;
const courses = [
  { id: 'c1', name: 'A', weekday: wdToday, startWeek: 1, endWeek: 16, weekParity: 'all', startTime: '08:00', endTime: '09:40' },
  { id: 'c2', name: 'B', weekday: wdToday, startWeek: 1, endWeek: 16, weekParity: 'even', startTime: '10:00', endTime: '11:40' },
  { id: 'c3', name: 'C', weekday: wdToday, startWeek: 5, endWeek: 16, weekParity: 'all', startTime: '14:00', endTime: '15:40' }
];
eq('今天属于第 1 教学周', L.currentWeek(termStart, TODAY), 1);
eq('第 1 周只显示每周课', L.coursesOnDate(courses, TODAY, termStart).map((c) => c.id), ['c1']);
// 同一星期几往后推 7 天 = 第 2 教学周的同一节课
eq('第 2 周显示每周课 + 双周课', L.coursesOnDate(courses, ahead(7), termStart).map((c) => c.id), ['c1', 'c2']);
eq('第 5 周起才显示 c3', L.coursesOnDate(courses, ahead(28), termStart).map((c) => c.id), ['c1', 'c3']);
eq('未设置开学日期时不过滤周次', L.coursesOnDate(courses, TODAY, '').length, 3);

console.log('\n[课表导入解析]');
const txt = ['周一', '高等数学A 张建国 教三201 08:00-09:40 1-16周', '大学英语 李梅 外语楼305 10:00-11:40 1-16周', '周二 数据结构 王强 A401 第3-4节 1-16周'].join('\n');
const r1 = T.parseTextCourses(txt, T.DEFAULT_PERIODS);
eq('文本解析出 3 门课', r1.courses.length, 3);
eq('课程名正确', r1.courses[0].name, '高等数学A');
eq('继承上一行的星期', r1.courses[1].weekday, 1);
eq('时间解析', [r1.courses[0].startTime, r1.courses[0].endTime], ['08:00', '09:40']);
eq('周次解析', [r1.courses[0].startWeek, r1.courses[0].endWeek], [1, 16]);
eq('“第 3-4 节”换算成时间', [r1.courses[2].startTime, r1.courses[2].endTime], ['10:00', '11:40']);
ok('地点被识别', /教三201|A401/.test(r1.courses[0].location + r1.courses[2].location), [r1.courses[0].location, r1.courses[2].location]);
ok('教师被识别', /张建国|王强/.test(r1.courses[0].teacher + r1.courses[2].teacher), [r1.courses[0].teacher, r1.courses[2].teacher]);

const csv = ['课程名,教师,地点,星期,节次,周次', '数据结构,王强,计算机楼A401,周二,1-2节,1-16周', '计算机网络,赵敏,A302,周三,7-8节,1-16周双周'].join('\n');
ok('识别为 CSV 表头', T.looksLikeCSV(csv));
const r2 = T.parseCSVCourses(csv, T.DEFAULT_PERIODS);
eq('CSV 解析出 2 门课', r2.courses.length, 2);
eq('CSV 星期', r2.courses[0].weekday, 2);
eq('CSV 双周识别', r2.courses[1].weekParity, 'even');

const grid = [
  ['节次', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'],
  ['1-2节', '', '数据结构\n王强\nA401\n1-16周', '', '', '', '', ''],
  ['3-4节', '高等数学\n张建国\n教三201\n1-16周', '', '', '', '', '', '']
];
const r3 = T.parseGridCourses(grid, T.DEFAULT_PERIODS);
eq('教务系统网格解析出 2 门课', r3.courses.length, 2);
eq('网格星期映射', r3.courses.map((c) => c.weekday).sort().join(','), '1,2');
ok('网格节次换算', r3.courses.some((c) => c.startTime === '08:00'), r3.courses.map((c) => c.startTime));

const bad = T.parseTextCourses('这是一行没有课程信息的说明文字');
ok('异常行不崩溃且有提示', Array.isArray(bad.courses) && Array.isArray(bad.errors));
eq('节次表可往返', T.parsePeriods(T.periodsToText(T.DEFAULT_PERIODS)).length, T.DEFAULT_PERIODS.length);

/* ==================== 背景图 → 玻璃参数 ==================== */
console.log('\n[背景图片：自动配玻璃]');

/** 造一张图：把一组颜色按比例铺满 w*h 的 RGBA 数组 */
function makePixels(w, h, paint) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x / w, y / h);
      const i = (y * w + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  return px;
}
const flat = (c) => () => c;
const N = 64;
const stats = (px) => BG.analyzePixels(px, N, N);

const dark = stats(makePixels(N, N, flat([24, 22, 38])));
const bright = stats(makePixels(N, N, flat([247, 242, 236])));
const orange = stats(makePixels(N, N, flat([232, 126, 62])));
const gray = stats(makePixels(N, N, flat([128, 128, 130])));
// 高反差棋盘 = "很花的照片"
const checker = stats(makePixels(N, N, (u, v) => ((((u * N) | 0) + ((v * N) | 0)) % 2 ? [250, 250, 250] : [12, 12, 16])));
// 明暗渐变 = "干净的照片"
const smooth = stats(makePixels(N, N, (u) => [200 - u * 60, 190 - u * 50, 210 - u * 40]));

console.log('   纯黑图: ' + JSON.stringify({ lum: +dark.lum.toFixed(3), detail: +dark.detail.toFixed(3), hueStrength: +dark.hueStrength.toFixed(3) }));
console.log('   亮奶油: ' + JSON.stringify({ lum: +bright.lum.toFixed(3), detail: +bright.detail.toFixed(3) }));
console.log('   橙色图: ' + JSON.stringify({ hue: Math.round(orange.hue), strength: +orange.hueStrength.toFixed(3) }));
console.log('   棋盘图: ' + JSON.stringify({ contrast: +checker.contrast.toFixed(3), detail: +checker.detail.toFixed(3) }));
console.log('   渐变图: ' + JSON.stringify({ contrast: +smooth.contrast.toFixed(3), detail: +smooth.detail.toFixed(3) }));

ok('暗图的 dark 判定为真', dark.dark === true, dark.dark);
ok('亮图的 dark 判定为假', bright.dark === false, bright.dark);
ok('纯色图没有细节', dark.detail < 0.02 && bright.detail < 0.02, [dark.detail, bright.detail]);
ok('橙色图能认出橙色相（30 度上下）', Math.abs(orange.hue - 30) < 14, Math.round(orange.hue));
ok('橙色图的主色很集中', orange.hueStrength > 0.8, orange.hueStrength);
ok('灰色图没有主色相', gray.hueStrength < 0.2, gray.hueStrength);
ok('棋盘图细节拉满、反差拉满', checker.detail > 0.9 && checker.contrast > 0.9, [checker.detail, checker.contrast]);
ok('平滑渐变图细节很低', smooth.detail < 0.12, smooth.detail);

const sDark = BG.deriveStyle(dark, 'ins');
const sBright = BG.deriveStyle(bright, 'ins');
const sCheck = BG.deriveStyle(checker, 'ins');
const sGray = BG.deriveStyle(gray, 'ins');

console.log('   INS 推导: 暗图 tint=' + sDark.tint + ' / 亮图 tint=' + sBright.tint + ' / 棋盘 tint=' + sCheck.tint);
console.log('   描述: 暗图「' + sDark.mood + '」 橙图「' + BG.deriveStyle(orange, 'ins').mood + '」');
console.log('   灰图强调色: ' + JSON.stringify(sGray.accent) + '（空 = 沿用主题自带）');
console.log('   橙图强调色: ' + BG.deriveStyle(orange, 'ins').accent + ' / ' + BG.deriveStyle(orange, 'ins').accent2);

ok('花的背景 → 玻璃更实（tint 更大）', sCheck.tint > sBright.tint, [sCheck.tint, sBright.tint]);
ok('干净的背景 → 玻璃更透（tint 更小）', sBright.tint < 20, sBright.tint);
ok('tint 落在 4..40 的合理区间', [sDark, sBright, sCheck, sGray].every((s) => s.tint >= 4 && s.tint <= 40), [sDark.tint, sBright.tint, sCheck.tint, sGray.tint]);
ok('暗图配浅色界面时玻璃更实（补了权重）', BG.deriveStyle(dark, 'ins').tint > BG.deriveStyle(dark, 'neon').tint, [BG.deriveStyle(dark, 'ins').tint, BG.deriveStyle(dark, 'neon').tint]);
ok('灰图不给强调色（沿用主题）', sGray.accent === '' && sGray.accent2 === '', [sGray.accent, sGray.accent2]);
ok('有色图给得出强调色', /^hsl\(/.test(BG.deriveStyle(orange, 'ins').accent), BG.deriveStyle(orange, 'ins').accent);
ok('两个强调色不是一个颜色', BG.deriveStyle(orange, 'ins').accent !== BG.deriveStyle(orange, 'ins').accent2, true);
ok('蒙版颜色是 r,g,b 三段', [sDark, sBright, sCheck].every((s) => s.washRgb.split(',').length === 3), [sDark.washRgb, sBright.washRgb]);
ok('蒙版强度落在 0.08..0.56', [sDark, sBright, sCheck, sGray].every((s) => s.washAlpha >= 0.08 && s.washAlpha <= 0.56), [sDark.washAlpha, sBright.washAlpha]);
ok('亮界面的玻璃底色接近白', BG.deriveStyle(bright, 'ins').cardRgb.split(',').every((v) => Number(v) > 220), BG.deriveStyle(bright, 'ins').cardRgb);
ok('暗界面的玻璃底色压得下来', BG.deriveStyle(bright, 'neon').cardRgb.split(',').every((v) => Number(v) < 120), BG.deriveStyle(bright, 'neon').cardRgb);
ok('主色预览给了几个颜色', orange.colors.length >= 1 && /^#[0-9a-f]{6}$/.test(orange.colors[0]), orange.colors);
ok('同样的图推两次结果一致', JSON.stringify(BG.deriveStyle(orange, 'ins')) === JSON.stringify(BG.deriveStyle(orange, 'ins')), true);
// 极端输入不该崩
ok('全黑图不崩', BG.analyzePixels(makePixels(8, 8, flat([0, 0, 0])), 8, 8).lum === 0, true);
ok('全白图不崩', BG.analyzePixels(makePixels(8, 8, flat([255, 255, 255])), 8, 8).lum > 0.99, true);
ok('1x1 也不崩', Number.isFinite(BG.analyzePixels(makePixels(1, 1, flat([9, 9, 9])), 1, 1).detail), true);

/* ==================== 更新日志 ==================== */
console.log('\n[更新日志]');
const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
const newest = LOG.CHANGELOG[0];
console.log('   当前版本 ' + pkgVersion + '，更新日志最新一条 ' + newest.v + '（' + newest.items.length + ' 项）');
ok('更新日志里有当前版本这一条（改了版本号就必须写更新内容）', newest.v === pkgVersion, { 日志: newest.v, package: pkgVersion });
ok('每个版本的更新内容都不为空', LOG.CHANGELOG.every((r) => r.items.length > 0), LOG.CHANGELOG.map((r) => r.v + ':' + r.items.length));
ok('版本号按从新到旧排列', LOG.CHANGELOG.every((r, i) => i === 0 || LOG.compareVersion(LOG.CHANGELOG[i - 1].v, r.v) > 0), LOG.CHANGELOG.map((r) => r.v));
ok('没有重复版本号', new Set(LOG.CHANGELOG.map((r) => r.v)).size === LOG.CHANGELOG.length, LOG.CHANGELOG.length);
ok('第一次装（没记过版本）不返回任何更新内容', LOG.notesSince('').length === 0, LOG.notesSince('').length);
ok('从上一版升上来只返回最新那一条', LOG.notesSince(LOG.CHANGELOG[1].v).length === 1, LOG.notesSince(LOG.CHANGELOG[1].v).map((r) => r.v));
ok('跨好几个版本升上来会一次列全', LOG.notesSince('1.0.7').length === LOG.CHANGELOG.findIndex((r) => r.v === '1.0.7'), LOG.notesSince('1.0.7').map((r) => r.v));
ok('版本比日志里最新的还新时不返回内容', LOG.notesSince('99.0.0').length === 0, LOG.notesSince('99.0.0').length);
ok('版本号比较：1.0.10 > 1.0.9（不能按字符串比）', LOG.compareVersion('1.0.10', '1.0.9') > 0, LOG.compareVersion('1.0.10', '1.0.9'));

console.log('\n========================================');
console.log('  逻辑单测通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
