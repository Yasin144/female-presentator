import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, CalendarDays, CheckCheck, ChevronRight, Download, Filter, NotebookPen, Plus, RefreshCw, Search, X } from 'lucide-react';
import { reconcileTransactionReadingOrder, transactionInitials, transactionIsIncoming, transactionMemory, transactionPerson, transactionReadingView } from './transactionPresentation.js';
import './ExpenseTransactions.css';

const money = value => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const time = value => {
  if (!/^\d{2}:\d{2}/.test(String(value || ''))) return 'Time not recorded';
  const [h, m] = value.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return 'Time not recorded';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const dateLabel = (date, today) => {
  if (!date) return 'Date not recorded';
  if (date === today) return 'Today';
  const value = new Date(`${date}T12:00:00`);
  return Number.isNaN(value.getTime()) ? date : value.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

export default function ExpenseTransactions({
  transactions, today, filters, onFilter, onReset, onAdd, onSync, scanning,
  onOpen, onExport, readingStateRef, compact = false,
  expandedFilters = false, onToggleFilters = () => {},
}) {
  const ownReadingRef = useRef(null);
  const readingRef = readingStateRef || ownReadingRef;
  const [snapshot, setSnapshot] = useState(() => reconcileTransactionReadingOrder(readingRef.current, transactions, JSON.stringify(filters)));
  const key = JSON.stringify(filters);
  const stable = reconcileTransactionReadingOrder(snapshot, transactions, key);
  const view = transactionReadingView(stable, transactions);
  useLayoutEffect(() => {
    readingRef.current = stable;
    if (stable !== snapshot) setSnapshot(stable);
  }, [readingRef, stable, snapshot]);
  const summary = useMemo(() => transactions.reduce((total, tx) => {
    total[transactionIsIncoming(tx) ? 'in' : 'out'] += Number(tx.amount) || 0;
    if (!transactionMemory(tx)) total.missing++;
    return total;
  }, { in: 0, out: 0, missing: 0 }), [transactions]);
  const groups = useMemo(() => {
    const result = new Map();
    for (const tx of view.rows) {
      const date = tx.date || '';
      if (!result.has(date)) result.set(date, []);
      result.get(date).push(tx);
    }
    return [...result.entries()];
  }, [view.rows]);
  const moreFilters = expandedFilters;
  const filter = (name, value) => onFilter(name, value);
  const showNew = () => {
    const next = { filterKey: key, ids: [...new Set(transactions.map(tx => String(tx.id)))] };
    readingRef.current = next;
    setSnapshot(next);
  };
  return (
    <section className="expense-passbook" aria-label="Transaction memory">
      <header className="expense-passbook-heading">
        <div><h2>Transactions</h2><p>Tap a payment to remember what it was for.</p></div>
        <button type="button" className="expense-main-action" onClick={onAdd}><Plus size={18} aria-hidden="true" /> Add</button>
      </header>
      <div className="expense-money-summary" aria-label="Totals for matching transactions">
        <div><span><ArrowUpRight size={15} aria-hidden="true" /> Paid</span><strong>₹{money(summary.out)}</strong></div>
        <div><span><ArrowDownLeft size={15} aria-hidden="true" /> Received</span><strong>₹{money(summary.in)}</strong></div>
      </div>
      <div className="expense-memory-summary"><NotebookPen size={16} aria-hidden="true" /><span>{summary.missing ? `${summary.missing} payment${summary.missing === 1 ? '' : 's'} still need a memory note` : transactions.length ? 'Every payment has a memory note' : 'Add a short note to remember each payment'}</span></div>
      <div className="expense-search"><Search size={18} aria-hidden="true" /><input aria-label="Search transactions" placeholder="Search a name, reason, amount or reference" value={filters.search} onChange={e => filter('search', e.target.value)} />{filters.search && <button type="button" aria-label="Clear search" onClick={() => filter('search', '')}><X size={16} aria-hidden="true" /></button>}</div>
      <div className="expense-passbook-controls">
        <div className="expense-direction-filters" role="group" aria-label="Payment direction">
          {[['All', 'All'], ['Money Out', 'Paid'], ['Money In', 'Received']].map(([value, label]) => <button key={value} type="button" aria-pressed={filters.direction === value} onClick={() => filter('direction', value)}>{label}</button>)}
        </div>
        <button type="button" className="expense-quiet-action" aria-expanded={moreFilters} onClick={onToggleFilters}><Filter size={16} aria-hidden="true" />Filters</button>
      </div>
      <div className="expense-period-summary"><span>{filters.period === 'all' ? 'All dates' : filters.period === 'today' ? 'Today' : filters.period === 'yesterday' ? 'Yesterday' : filters.period === 'date' ? filters.date : filters.period === 'month' ? `${filters.year}-${filters.month}` : filters.year}</span><span>{transactions.length} matching</span></div>
      {moreFilters && <div className="expense-filter-sheet">
      <div className="expense-period-controls expense-period-filter">
        <label><CalendarDays size={16} aria-hidden="true" /><span className="expense-sr-only">Time period</span><select aria-label="Time period" value={filters.period} onChange={e => filter('period', e.target.value)}><option value="all">All dates</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="date">Choose date</option><option value="month">Choose month</option><option value="year">Choose year</option></select></label>
        {filters.period === 'date' && <input aria-label="Transaction date" type="date" value={filters.date} onChange={e => filter('date', e.target.value)} />}
        {filters.period === 'month' && <input aria-label="Transaction month" type="month" value={`${filters.year}-${filters.month}`} onChange={e => filter('month', e.target.value)} />}
        {filters.period === 'year' && <input aria-label="Transaction year" type="number" min="2000" max="2100" value={filters.year} onChange={e => filter('year', e.target.value)} />}
      </div>
        <label>Memory notes<select aria-label="Memory note filter" value={filters.note} onChange={e => filter('note', e.target.value)}><option value="all">All payments</option><option value="missing_note">Needs a note</option><option value="has_note">Has a note</option></select></label>
        <label>Review<select aria-label="Review filter" value={filters.review} onChange={e => filter('review', e.target.value)}><option value="all">All records</option><option value="needs_review">Needs review</option><option value="confirmed">No review flag</option></select></label>
        <label>Category<input aria-label="Category filter" value={filters.category === 'all' ? '' : filters.category} placeholder="Any category" onChange={e => filter('category', e.target.value || 'all')} /></label>
        <label>Payment method<select aria-label="Payment method" value={['UPI', 'Bank', 'Card', 'Wallet'].includes(filters.direction) ? filters.direction : 'All'} onChange={e => filter('direction', e.target.value)}><option value="All">Any method</option><option>UPI</option><option>Bank</option><option>Card</option><option>Wallet</option></select></label>
        <label>Minimum amount<input aria-label="Minimum amount" type="number" min="0" value={filters.min} onChange={e => filter('min', e.target.value)} /></label>
        <label>Maximum amount<input aria-label="Maximum amount" type="number" min="0" value={filters.max} onChange={e => filter('max', e.target.value)} /></label>
        <label>From date<input aria-label="From date" type="date" value={filters.from} onChange={e => filter('from', e.target.value)} /></label>
        <label>Until date<input aria-label="Until date" type="date" value={filters.to} onChange={e => filter('to', e.target.value)} /></label>
        <button type="button" className="expense-quiet-action" onClick={onReset}>Clear filters</button>
      </div>}
      <div className="expense-live-slot" aria-live="polite" aria-atomic="true">
        {view.pendingCount ? <button type="button" onClick={showNew}><RefreshCw size={16} aria-hidden="true" />View {view.pendingCount} new transaction{view.pendingCount === 1 ? '' : 's'}</button> : <span><CheckCheck size={16} aria-hidden="true" /> {scanning ? 'Checking for new payments…' : 'Auto capture keeps your place'}</span>}
      </div>
      <div className="expense-passbook-list" aria-label="Saved transaction list">
        {!groups.length && <div className="expense-passbook-empty"><NotebookPen size={30} aria-hidden="true" /><h3>{transactions.length ? 'No payments shown yet' : 'No transactions match'}</h3><p>Try all dates or clear your search. You can also add a payment yourself.</p><button className="expense-quiet-action" type="button" onClick={onReset}>Clear filters</button></div>}
        {groups.map(([date, items]) => <section className="expense-day-group" key={date} aria-label={dateLabel(date, today)}>
          <h3>{dateLabel(date, today)}<span>{items.length} record{items.length === 1 ? '' : 's'}</span></h3>
          {items.map(tx => {
            const incoming = transactionIsIncoming(tx), note = transactionMemory(tx);
            return <button type="button" className="expense-memory-row" key={tx.id} data-transaction-id={tx.id} onClick={() => onOpen(tx.id)} aria-label={`${incoming ? 'Received from' : 'Paid to'} ${transactionPerson(tx)}, ₹${money(tx.amount)}. ${note || 'Add a memory note'}`}>
              <span className={`expense-person-avatar ${incoming ? 'is-incoming' : ''}`} aria-hidden="true">{transactionInitials(tx)}</span>
              <span className="expense-row-person"><span className="expense-row-direction">{incoming ? 'Received from' : 'Paid to'}</span><strong>{transactionPerson(tx)}</strong></span>
              <span className={`expense-row-amount ${incoming ? 'is-incoming' : ''}`}>{incoming ? '+' : '−'}₹{money(tx.amount)}</span>
              <span className={`expense-row-memory ${note ? '' : 'needs-memory'}`}><NotebookPen size={14} aria-hidden="true" /><span>{note || 'What was this for? Add a note'}</span><ChevronRight size={15} aria-hidden="true" /></span>
              <span className="expense-row-meta">{time(tx.time)} · {tx.paymentMethod || 'Method not recorded'}{tx.reconciliationStatus === 'needs_review' ? ' · Needs review' : tx.type === 'refund' ? ' · Refund' : ''}</span>
            </button>;
          })}
        </section>)}
      </div>
      {!compact && <footer className="expense-passbook-footer"><button type="button" className="expense-quiet-action" disabled={scanning} onClick={onSync}><RefreshCw size={16} aria-hidden="true" />{scanning ? 'Checking…' : 'Fetch payments'}</button><button type="button" className="expense-quiet-action" onClick={onExport}><Download size={16} aria-hidden="true" />Export CSV</button></footer>}
    </section>
  );
}
