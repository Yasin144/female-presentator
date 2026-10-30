import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Share2, X } from 'lucide-react';
import { createExpenseReport, expenseMoney, expenseReportFilename, expenseReportText, expenseWhatsAppParts, expenseTableTsv, expenseFileSavingNeedsApk } from './expenseReport.js';
import { openWhatsAppReport } from './whatsAppHandoff.js';
import './ExpenseExportPanel.css';

export default function ExpenseExportPanel({ transactions, defaultDate, onClose }) {
  const dialog = useRef(null), textArea = useRef(null), excelTextArea = useRef(null);
  const [period, setPeriod] = useState('date');
  const [from, setFrom] = useState(defaultDate), [to, setTo] = useState(defaultDate);
  const [phone, setPhone] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [preview, setPreview] = useState(false), [part, setPart] = useState(0);
  const [excelTable, setExcelTable] = useState('');
  const nativeSaveUnavailable = expenseFileSavingNeedsApk(window);
  useEffect(() => {
    const focused = document.activeElement, previousOverflow = document.body.style.overflow;
    if (!dialog.current.open) dialog.current.showModal();
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; focused?.focus?.(); };
  }, []);
  const result = useMemo(() => {
    try {
      if (period !== 'all' && (!from || period === 'range' && !to)) throw new Error('Select the export date or date range.');
      const report = createExpenseReport(transactions, period === 'all' ? {} : { from, to: period === 'date' ? from : to });
      return { report, parts: expenseWhatsAppParts(expenseReportText(report)) };
    } catch (error) { return { error: error.message }; }
  }, [transactions, period, from, to]);
  useEffect(() => { setPart(0); setPreview(false); setNotice(''); setExcelTable(''); }, [transactions, period, from, to]);
  const ready = !!result.report?.rows.length && !busy;
  const download = async () => {
    if (!ready || nativeSaveUnavailable) return;
    const report = result.report;
    setBusy(true); setNotice('Preparing your Excel workbook…');
    try {
      const { expenseExcelBuffer } = await import('./expenseExcel.js');
      const bytes = await expenseExcelBuffer(report);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = expenseReportFilename(report);
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice('Excel file prepared and download requested. Check your Downloads.');
    } catch (_) { setNotice('Could not prepare the Excel file. Try a smaller date range or retry.'); }
    finally { setBusy(false); }
  };
  const share = () => {
    if (!ready) return;
    const digits = phone.replace(/\D/g, '');
    const target = digits.length === 10 ? `91${digits}` : digits;
    if (phone.trim() && (!/^[+\d()\s-]+$/.test(phone) || !/^[1-9]\d{6,14}$/.test(target))) { setNotice('Enter a valid country code and WhatsApp number, or leave it blank to choose a contact.'); return; }
    setPreview(true);
    const opened = openWhatsAppReport(window, target || 'PICK_CONTACT', result.parts[part]);
    setNotice(opened.status === 'failed' ? 'Could not open WhatsApp. Copy the message below and paste it into your chosen chat.' : 'Review the recipient and message in WhatsApp, then tap Send.');
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(result.parts[part]); setNotice('Message copied. Paste it into WhatsApp and review before sending.'); }
    catch (_) { textArea.current?.focus(); textArea.current?.select(); setNotice('Select Copy from the text menu, then paste the message into WhatsApp.'); }
  };
  const copyExcel = async () => {
    const table = expenseTableTsv(result.report);
    setExcelTable(table);
    try { await navigator.clipboard.writeText(table); setNotice('Expense table copied. Paste into cell A1 in Excel or Sheets.'); }
    catch (_) { setNotice('Select and copy the Excel table below, then paste into cell A1 in Excel or Sheets.'); }
  };
  return <dialog ref={dialog} className="expense-export-dialog" aria-labelledby="expense-export-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><div><h2 id="expense-export-title">Export expenses</h2><p>Excel and date-wise WhatsApp reports</p></div><button type="button" onClick={onClose} aria-label="Close expense export"><X size={20} /></button></header>
    <div className="expense-export-body">
      <p>Completed paid expenses only. Income and refunds are excluded.</p>
      <label>Period<select aria-label="Expense export period" value={period} disabled={busy} onChange={e => setPeriod(e.target.value)}><option value="date">One date</option><option value="range">Date range</option><option value="all">All expenses</option></select></label>
      {period !== 'all' && <div className="expense-export-dates"><label>{period === 'date' ? 'Date' : 'From'}<input aria-label="Export from date" type="date" value={from} disabled={busy} onChange={e => setFrom(e.target.value)} /></label>{period === 'range' && <label>Through<input aria-label="Export through date" type="date" value={to} disabled={busy} onChange={e => setTo(e.target.value)} /></label>}</div>}
      {result.error ? <p role="alert">{result.error}</p> : <div className="expense-export-total" aria-label="Selected expense totals"><span>{result.report.rows.length} expenses · {result.report.days.length} dates</span><strong>₹{expenseMoney(result.report.totalPaise)}</strong></div>}
      {!result.error && !result.report.rows.length && <p>No completed expenses for these dates. Choose another date or range.</p>}
      <button className="expense-export-primary" type="button" disabled={!ready || nativeSaveUnavailable} onClick={download}><Download size={18} />{busy ? 'Preparing Excel…' : 'Download Excel (.xlsx)'}</button>
      {nativeSaveUnavailable && <p>Saving .xlsx directly on this Android app needs the signed APK update. Use Copy for Excel to paste your expense table into Excel now.</p>}
      <button type="button" disabled={!ready} onClick={copyExcel}>Copy for Excel</button>
      {excelTable && <label>Excel table<textarea ref={excelTextArea} aria-label="Excel expense table" readOnly value={excelTable} onFocus={event => event.target.select()} /></label>}
      <label>WhatsApp number (optional)<input aria-label="Expense WhatsApp number" type="tel" value={phone} placeholder="Leave blank to choose a contact" onChange={e => setPhone(e.target.value)} /></label>
      <button type="button" disabled={!ready} onClick={share}><Share2 size={18} />Share to WhatsApp{result.parts?.length > 1 ? ` · part ${part + 1}/${result.parts.length}` : ''}</button>
      {!!result.report?.rows.length && <button type="button" onClick={() => setPreview(value => !value)}>{preview ? 'Hide message preview' : 'Preview WhatsApp message'}</button>}
      {preview && result.parts && <div className="expense-export-preview"><textarea ref={textArea} aria-label="Expense WhatsApp message preview" readOnly value={result.parts[part] || ''} /><div>{result.parts.length > 1 && <><button type="button" disabled={!part} onClick={() => { setPart(i => i - 1); setNotice(''); }}>Previous part</button><span>Part {part + 1} of {result.parts.length}</span><button type="button" disabled={part >= result.parts.length - 1} onClick={() => { setPart(i => i + 1); setNotice(''); }}>Next part</button></>}<button type="button" onClick={copy}>Copy message</button></div><p>Long reports use multiple parts. Open and send each part yourself; Excel includes every selected expense.</p></div>}
      {notice && <p role="status">{notice}</p>}
    </div>
  </dialog>;
}
