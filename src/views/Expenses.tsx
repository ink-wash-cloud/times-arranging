// 消费记录：全部历史按月份分组，支持记账 / 编辑 / 删除撤销 / 筛选 / 导出 CSV。
//
// 金额只在「显示」时统一走 money()，也就是 round2 后保留两位小数；
// 数据库里仍然存原始数值，避免改显示时悄悄改到账。
import React, { useMemo, useState } from 'react';
import { list, useDB, putRecord, removeRecord } from '../lib/db';
import type { ExpenseData, BudgetData } from '../types';
import { Modal, Field, Empty, toast } from '../components/ui';
import { todayStr, currentMonth, weekdayName, parseYMD } from '../lib/date';
import { budgetStat, round2 } from '../lib/logic';
import { addExpense } from '../lib/actions';
import { t } from '../lib/i18n';
import './expenses.css';

const CATS = ['餐饮', '交通', '购物', '其它'] as const;
type Cat = (typeof CATS)[number];
type ExpenseRow = ExpenseData & { id: string };

const CAT_KEY: Record<Cat, string> = { 餐饮: 'food', 交通: 'traffic', 购物: 'shopping', 其它: 'other' };

/** 老数据里有「学习 / 生活 / 娱乐 / 通讯 / 医疗 / 其他」这些分类，统一收进四类筛选里。 */
function bucketOf(raw: string): Cat {
  const c = String(raw || '').trim();
  if (c === '餐饮') return '餐饮';
  if (c === '交通') return '交通';
  if (c === '购物' || c === '生活') return '购物';
  return '其它';
}

/** 二位小数金额；整数也补 .00，彻底避免 55.80000000000001。 */
const money = (n: number) => '¥' + round2(n).toFixed(2);

const pad2 = (n: number) => String(n).padStart(2, '0');

function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}

function daysInMonth(month: string): number {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(y, m, 0).getDate();
}

function sumOf(rows: ExpenseRow[]): number {
  return round2(rows.reduce((s, e) => s + (Number(e.amount) || 0), 0));
}

function csvCell(v: string): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export default function Expenses() {
  useDB();
  const month = currentMonth();
  const today = todayStr();
  const expenses = list<ExpenseData>('expenses') as ExpenseRow[];
  const budgets = list<BudgetData>('budgets');

  const [filter, setFilter] = useState<'all' | Cat>('all');
  const [limit, setLimit] = useState(200);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);

  const sorted = useMemo(
    () => expenses.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0))),
    [expenses]
  );

  const filtered = useMemo(
    () => (filter === 'all' ? sorted : sorted.filter((e) => bucketOf(e.category) === filter)),
    [sorted, filter]
  );

  const monthRows = sorted.filter((e) => (e.date || '').slice(0, 7) === month);
  const monthSum = sumOf(monthRows);
  const prevMonth = shiftMonth(month, -1);
  const prevRows = sorted.filter((e) => (e.date || '').slice(0, 7) === prevMonth);
  const prevSum = sumOf(prevRows);
  const prevAvg = prevRows.length ? round2(prevSum / daysInMonth(prevMonth)) : 0;
  const yearRows = sorted.filter((e) => (e.date || '').slice(0, 4) === today.slice(0, 4));
  const yearSum = sumOf(yearRows);
  const budget = budgetStat(expenses, budgets, month);

  // 组头用完整月份的合计和笔数；渲染时再按 limit 截断，翻页不会改掉汇总口径。
  const groups = useMemo(() => {
    const out: Array<{ month: string; total: number; count: number; rows: ExpenseRow[] }> = [];
    for (const e of filtered) {
      const key = (e.date || '').slice(0, 7);
      let g = out[out.length - 1];
      if (!g || g.month !== key) {
        g = { month: key, total: 0, count: 0, rows: [] };
        out.push(g);
      }
      g.rows.push(e);
      g.total = round2(g.total + (Number(e.amount) || 0));
      g.count++;
    }
    return out;
  }, [filtered]);

  const shownGroups = useMemo(() => {
    const out: typeof groups = [];
    let left = limit;
    for (const g of groups) {
      if (left <= 0) break;
      const rows = g.rows.slice(0, left);
      out.push({ ...g, rows });
      left -= rows.length;
    }
    return out;
  }, [groups, limit]);

  const pickFilter = (v: 'all' | Cat) => {
    setFilter(v);
    setLimit(200);
  };

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (e: ExpenseRow) => { setEditing(e); setFormOpen(true); };

  const removeOne = (e: ExpenseRow) => {
    const data: ExpenseData = {
      title: e.title, amount: e.amount, category: e.category, date: e.date, createdAt: e.createdAt
    };
    removeRecord('expenses', e.id);
    toast(t('已删除'), 'ok', {
      label: t('撤销'),
      run: () => {
        putRecord<ExpenseData>('expenses', e.id, data);
        toast(t('已恢复'), 'ok');
      }
    });
  };

  const exportCsv = () => {
    const head = [t('日期'), t('名称'), t('分类'), t('金额')];
    const lines = [head.map(csvCell).join(',')];
    for (const e of sorted) {
      lines.push([e.date || '', e.title || '', t(bucketOf(e.category)), round2(e.amount).toFixed(2)].map(csvCell).join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'expenses-' + today + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="exp-page" data-testid="expenses-page">
      <div className="exp-top">
      <div className="exp-summary" data-testid="exp-summary">
        <div className="card exp-stat">
          <div className="exp-stat-label">{t('本月已花')}</div>
          <div className="exp-stat-value">{money(monthSum)}</div>
          <div className="exp-stat-sub">
            {budget.amount > 0
              ? t('预算 {amount} · 剩余 {remaining}', { amount: money(budget.amount), remaining: money(budget.remaining) }) +
                ' · ' + t('已用 {p}%', { p: budget.pct })
              : t('未设预算 · {n} 笔', { n: monthRows.length })}
          </div>
        </div>
        <div className="card exp-stat">
          <div className="exp-stat-label">{t('上月')}</div>
          <div className="exp-stat-value">{money(prevSum)}</div>
          <div className="exp-stat-sub">{t('{n} 笔 · 日均 {amount}', { n: prevRows.length, amount: money(prevAvg) })}</div>
        </div>
        <div className="card exp-stat">
          <div className="exp-stat-label">{t('今年合计')}</div>
          <div className="exp-stat-value">{money(yearSum)}</div>
          <div className="exp-stat-sub">{t('共 {n} 笔', { n: yearRows.length })}</div>
        </div>
      </div>

      <div className="card exp-actions">
        <div className="exp-actions-btns">
          <button className="btn btn-primary" data-testid="exp-add" onClick={openAdd}>{t('＋ 记一笔')}</button>
          <button className="btn" data-testid="exp-export" onClick={exportCsv}>{t('导出 CSV')}</button>
        </div>
        <div className="exp-actions-note">{t('金额一律按「分」四舍五入，整数也显示两位小数。')}</div>
      </div>
      </div>

      <div className="card exp-list-card">
        <div className="exp-list-head">
          <div className="exp-list-title">🧾 {t('全部记录')}</div>
          <div className="exp-filters" data-testid="exp-filters">
            <button className={'chip' + (filter === 'all' ? ' on' : '')} onClick={() => pickFilter('all')}>{t('全部')}</button>
            {CATS.map((c) => (
              <button key={c} className={'chip' + (filter === c ? ' on' : '')} data-cat={c} onClick={() => pickFilter(c)}>{t(c)}</button>
            ))}
          </div>
          <div className="exp-count">
            {filter === 'all'
              ? t('共 {n} 笔 · 可翻到最早一条', { n: sorted.length })
              : t('筛出 {n} 笔 · 共 {total} 笔', { n: filtered.length, total: sorted.length })}
          </div>
        </div>

        {sorted.length === 0 ? (
          <Empty icon="🧾" text={t('还没有消费记录')} hint={t('点「＋ 记一笔」开始记第一笔')} />
        ) : filtered.length === 0 ? (
          <Empty icon="🔍" text={t('这个分类下还没有记录')} hint={t('换个分类，或者点「＋ 记一笔」')} />
        ) : (
          <div className="exp-groups" data-testid="exp-list">
            {shownGroups.map((g) => (
              <section key={g.month} className="exp-group" data-month={g.month}>
                <div className="exp-group-head">
                  <h3>{t('{y} 年 {m} 月', { y: g.month.slice(0, 4), m: Number(g.month.slice(5, 7)) })}</h3>
                  <span>{t('{amount} · {n} 笔', { amount: money(g.total), n: g.count })}</span>
                </div>
                {g.rows.map((e) => (
                  <div className="exp-row" key={e.id} data-id={e.id}>
                    <div className="exp-date">{e.date.slice(5)} <span>{weekdayName(parseYMD(e.date).getDay())}</span></div>
                    <div className="exp-title">{e.title}</div>
                    <span className={'exp-cat exp-cat-' + CAT_KEY[bucketOf(e.category)]}>{t(bucketOf(e.category))}</span>
                    <div className="exp-amount">{money(e.amount)}</div>
                    <div className="exp-row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(e)}>{t('编辑')}</button>
                      <button className="btn btn-ghost btn-sm exp-del" onClick={() => removeOne(e)}>{t('删除')}</button>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}

        {filtered.length > limit && (
          <div className="exp-more">
            <button className="btn" data-testid="exp-show-more" onClick={() => setLimit(limit + 200)}>
              {t('显示更多（还有 {n} 条）', { n: filtered.length - limit })}
            </button>
          </div>
        )}
      </div>

      {formOpen && (
        <ExpenseForm
          key={editing ? editing.id : 'new'}
          initial={editing}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  );
}

function ExpenseForm(props: { initial: ExpenseRow | null; onClose: () => void }) {
  const init = props.initial;
  const [title, setTitle] = useState(init ? init.title : '');
  const [amount, setAmount] = useState(init ? String(init.amount) : '');
  const [cat, setCat] = useState<Cat>(init ? bucketOf(init.category) : '餐饮');
  const [date, setDate] = useState(init ? init.date : todayStr());

  const save = () => {
    const n = Number(amount);
    if (!title.trim() || !Number.isFinite(n) || n <= 0) {
      toast(t('请填写名称和金额'), 'err');
      return;
    }
    const value = round2(n);
    if (init) {
      putRecord<ExpenseData>('expenses', init.id, {
        title: title.trim(), amount: value, category: cat, date, createdAt: init.createdAt || Date.now()
      });
      toast(t('已保存'), 'ok');
    } else {
      addExpense(title.trim(), value, cat, date);
      toast(t('已记录支出 ¥{n}', { n: value.toFixed(2) }), 'ok');
    }
    props.onClose();
  };

  return (
    <Modal
      title={init ? t('编辑记录') : t('记一笔')}
      onClose={props.onClose}
      footer={<>
        <button className="btn btn-ghost" onClick={props.onClose}>{t('取消')}</button>
        <button className="btn btn-primary" data-testid="exp-save" onClick={save}>{t('保存')}</button>
      </>}
    >
      <div className="form-grid">
        <Field label={t('名称')} full>
          <input className="input" data-testid="exp-title" value={title} autoFocus
            onChange={(e) => setTitle(e.target.value)} placeholder={t('例如：食堂、地铁')} />
        </Field>
        <Field label={t('金额（元）')}>
          <input className="input" data-testid="exp-amount" type="number" step="0.01" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label={t('日期')}>
          <input className="input" data-testid="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('分类')} full>
          <select className="select" data-testid="exp-cat" value={cat} onChange={(e) => setCat(e.target.value as Cat)}>
            {CATS.map((c) => <option key={c} value={c}>{t(c)}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}
