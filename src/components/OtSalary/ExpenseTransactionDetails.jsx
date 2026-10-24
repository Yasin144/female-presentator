import React from 'react';
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, FileText, NotebookPen, Pencil, ShieldCheck } from 'lucide-react';
import { recordedBalance, transactionInitials, transactionIsIncoming, transactionPerson } from './transactionPresentation.js';
import './ExpenseTransactions.css';

const money = value => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ExpenseTransactionDetails({ tx, merchantDraft, noteDraft, onMerchant, onNote, onBack, onSave, onEdit, onUdhaar, udhaar, onChangeDirection, onRemove, themeMode = 'light' }) {
  const incoming = transactionIsIncoming(tx);
  const balance = recordedBalance(tx);
  const capturedDetails = [
    ['Date', tx.date || 'Not recorded'], ['Time', tx.time || 'Not recorded'],
    ['Method', tx.paymentMethod || 'Not recorded'], ['App', tx.app || 'Not recorded'],
    ['Category', tx.category || 'Not recorded'], ['Bank account', tx.accountMask || 'Not recorded'],
    ['UPI ID', tx.payeeVpa || tx.vpa || 'Not recorded'], ['Reference', tx.refId || 'Not recorded'],
    ['Recorded balance after payment', balance === null ? 'Not recorded' : `₹${money(balance)}`],
  ];
  return <section className="salary-expenses-root expense-transaction-detail" data-color-mode={themeMode} aria-label="Transaction details">
    <header className="expense-detail-toolbar"><button type="button" className="expense-quiet-action" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />Back to transactions</button><button type="button" className="expense-quiet-action" onClick={onEdit}><Pencil size={16} aria-hidden="true" />Edit details</button></header>
    <div className="expense-detail-hero">
      <span className={`expense-person-avatar ${incoming ? 'is-incoming' : ''}`} aria-hidden="true">{transactionInitials(tx)}</span>
      <div><p className="expense-kicker">{incoming ? 'RECEIVED FROM' : 'PAID TO'}</p><h2>{transactionPerson(tx)}</h2></div>
      <strong className={`expense-detail-amount ${incoming ? 'is-incoming' : ''}`}>{incoming ? '+' : '−'}₹{money(tx.amount)}</strong>
      <p className="expense-detail-date">{tx.date || 'Date not recorded'} · {tx.time || 'Time not recorded'}{tx.type === 'refund' ? ' · Refund' : ''}</p>
    </div>
    <form className="expense-memory-form" onSubmit={event => { event.preventDefault(); onSave(); }}>
      <h3><NotebookPen size={19} aria-hidden="true" />Remember this payment</h3>
      <p>A few words now will help you recognise this later.</p>
      <label>{incoming ? 'Who sent it?' : 'Who did you pay?'}<input aria-label={incoming ? 'Who sent it?' : 'Who did you pay?'} value={merchantDraft} onChange={event => onMerchant(event.target.value)} placeholder="Person or shop name" autoComplete="off" /></label>
      <label>What was it for?<textarea aria-label="What was it for?" rows={3} value={noteDraft} onChange={event => onNote(event.target.value)} placeholder="For example: Lunch at work, October rent, money borrowed by Ravi…" /></label>
      <button type="submit" className="expense-main-action"><ShieldCheck size={17} aria-hidden="true" />Save memory note</button>
    </form>
    {(tx.originalRemark || tx.paymentRemark) && <div className="expense-captured-remark"><FileText size={18} aria-hidden="true" /><div><strong>Captured payment remark</strong><p>{tx.originalRemark || tx.paymentRemark}</p></div></div>}
    {tx.reconciliationStatus === 'needs_review' && <p className="expense-review-notice">This captured record needs review. Compare it with your payment app or bank statement before correcting it.</p>}
    <details className="expense-record-details"><summary>Payment details &amp; reference</summary><dl>{capturedDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{tx.rawText && <details><summary>Original captured text</summary><p>{tx.rawText}</p></details>}</details>
    <details className="expense-record-details"><summary>Manage this record</summary><div className="expense-record-actions">
      <button type="button" className="expense-quiet-action" onClick={onUdhaar}>{udhaar ? udhaar.status === 'returned' ? 'Udhaar returned' : 'Mark Udhaar returned' : 'Mark as Udhaar / returnable'}</button>
      <button type="button" className="expense-quiet-action" onClick={onChangeDirection}>{incoming ? <ArrowUpRight size={16} aria-hidden="true" /> : <ArrowDownLeft size={16} aria-hidden="true" />}Change paid / received</button>
      <button type="button" className="expense-quiet-action expense-remove-action" onClick={onRemove}>Remove mistaken entry</button>
    </div></details>
  </section>;
}
