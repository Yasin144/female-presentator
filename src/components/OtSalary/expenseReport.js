export function validExpenseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const expenseMoney = paise => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function createExpenseReport(transactions, { from = '', to = '' } = {}) {
  if (from && !validExpenseDate(from) || to && !validExpenseDate(to)) throw new Error('Choose a valid date.');
  if (from && to && from > to) throw new Error('The end date must be on or after the start date.');
  const rows = (Array.isArray(transactions) ? transactions : Object.values(transactions || {}))
    .filter(tx => tx && !tx._deleted && !tx._demoPreview && !tx.isDemoPreview && tx.source !== 'demo-preview'
      && String(tx.type || tx.direction || '').toLowerCase() === 'debit'
      && (!tx.status || tx.status === 'completed') && tx.reconciliationStatus !== 'possible_duplicate'
      && validExpenseDate(tx.date) && (!from || tx.date >= from) && (!to || tx.date <= to)
      && Number.isFinite(Number(tx.amount)) && Number(tx.amount) > 0)
    .map(tx => ({
      date: tx.date, time: String(tx.time || ''), merchant: String(tx.merchant || 'Unknown recipient'),
      category: String(tx.category || 'Uncategorised'), method: String(tx.paymentMethod || tx.app || 'Not recorded'),
      note: String(tx.personalNote || tx.note || tx.paymentRemark || ''), reference: String(tx.refId || ''),
      paise: Math.round(Number(tx.amount) * 100),
    })).filter(row => row.paise > 0 && Number.isSafeInteger(row.paise))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.merchant.localeCompare(b.merchant));
  const dayMap = new Map();
  let totalPaise = 0;
  for (const row of rows) {
    totalPaise += row.paise;
    if (!Number.isSafeInteger(totalPaise)) throw new Error('This total is too large to export accurately. Choose a smaller date range.');
    if (!dayMap.has(row.date)) dayMap.set(row.date, { date: row.date, count: 0, paise: 0, rows: [] });
    const day = dayMap.get(row.date);
    day.count++; day.paise += row.paise; day.rows.push(row);
  }
  return { rows, days: [...dayMap.values()], totalPaise, from, to,
    period: from && from === to ? from : from || to ? `${from || 'First saved date'} to ${to || 'Latest saved date'}` : 'All saved dates' };
}

export function expenseReportText(report) {
  return ['*EXPENSES ONLY*', report.period, `${report.rows.length} expenses · Total ₹${expenseMoney(report.totalPaise)}`,
    ...report.days.flatMap(day => ['', `*${day.date} · ₹${expenseMoney(day.paise)}*`, ...day.rows.map((row, i) =>
      `${i + 1}. ${row.time ? `${row.time} · ` : ''}${row.merchant} — ₹${expenseMoney(row.paise)}\n${row.category} · ${row.method}${row.note ? `\nNote: ${row.note}` : ''}`)]),
    '', 'Completed expenses only. Income and refunds excluded.'].join('\n');
}

export function expenseWhatsAppParts(text, limit = 2800) {
  if (!Number.isInteger(limit) || limit < 64 || limit > 3000) throw new Error('Invalid WhatsApp message size.');
  // Split on code points so emoji are not cut into invalid UTF-16 halves. No rows
  // or long notes are dropped. Each part is opened only by an explicit user tap.
  const chars = Array.from(text);
  const parts = [];
  for (let offset = 0; offset < chars.length; offset += limit) parts.push(chars.slice(offset, offset + limit).join(''));
  return parts.length <= 1 ? parts : parts.map((part, i) => `Expenses · Part ${i + 1}/${parts.length}\n${part}`);
}

export function expenseReportFilename(report) {
  return `Expenses-${report.from || 'all'}${report.to && report.to !== report.from ? `-to-${report.to}` : ''}.xlsx`;
}

export function expenseTableTsv(report) {
  const text = value => {
    const clean = String(value).replace(/[\t\r\n]+/g, ' ');
    return /^[=+\-@]/.test(clean.trimStart()) ? `'${clean}` : clean;
  };
  return [
    ['Date', 'Time', 'Paid to', 'Category', 'Payment method', 'Expense (INR)', 'Note / purpose', 'Reference'],
    ...report.rows.map(row => [row.date, row.time, row.merchant, row.category, row.method, (row.paise / 100).toFixed(2), row.note, row.reference]),
    ['TOTAL', '', '', '', '', (report.totalPaise / 100).toFixed(2), '', ''],
  ].map(row => row.map(text).join('\t')).join('\n');
}

export function expenseFileSavingNeedsApk(host) {
  try { return host?.Capacitor?.getPlatform?.() === 'android' || /\bwv\b/.test(host?.navigator?.userAgent || ''); }
  catch (_) { return true; }
}
