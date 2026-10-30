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

export function expenseDateLabel(iso) {
  return validExpenseDate(iso) ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : iso;
}

export function expenseTimeLabel(time) {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return time;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function expenseReportText(report) {
  const period = report.from && report.from === report.to ? expenseDateLabel(report.from)
    : report.from || report.to ? `${report.from ? expenseDateLabel(report.from) : 'First saved date'}\n          to ${report.to ? expenseDateLabel(report.to) : 'Latest saved date'}` : 'All saved dates';
  return ['*TIME IS MONEY*', '*EXPENSE STATEMENT*', '', `*${report.from && report.from === report.to ? 'Date' : 'Period'}:* ${period}`,
    `*Total spent: ₹${expenseMoney(report.totalPaise)}*`, `${report.rows.length} ${report.rows.length === 1 ? 'payment' : 'payments'} · ${report.days.length} ${report.days.length === 1 ? 'day' : 'days'}`,
    ...report.days.flatMap(day => ['', '────────────────────', `*${expenseDateLabel(day.date)}*`, '', ...day.rows.flatMap((row, i) => [
      `${i + 1}. ${row.merchant}`, `   *₹${expenseMoney(row.paise)}*${row.time ? ` · ${expenseTimeLabel(row.time)}` : ''}`,
      `   ${row.category} · ${row.method}`,
      ...(row.note ? [`   Purpose: ${row.note.replace(/\r?\n/g, '\n   ')}`] : []),
      ...(row.reference ? [`   Ref: ${row.reference}`] : []), '',
    ]), `*Day total: ₹${expenseMoney(day.paise)}*`]),
    '', '────────────────────', `*TOTAL EXPENSES: ₹${expenseMoney(report.totalPaise)}*`, '_Completed expenses only. Income and refunds excluded._'].join('\n');
}

export function expenseWhatsAppParts(text, limit = 2800) {
  if (!Number.isInteger(limit) || limit < 64 || limit > 3000) throw new Error('Invalid WhatsApp message size.');
  // Split on code points so emoji are not cut into invalid UTF-16 halves. No rows
  // or long notes are dropped. Each part is opened only by an explicit user tap.
  const parts = [];
  let current = [], size = 0;
  const flush = () => { if (size) parts.push(current.join('')); current = []; size = 0; };
  const append = value => {
    const chars = Array.from(value);
    if (chars.length <= limit && size + chars.length > limit) flush();
    for (let offset = 0; offset < chars.length;) {
      const count = Math.min(limit - size, chars.length - offset);
      current.push(chars.slice(offset, offset + count).join('')); size += count; offset += count;
      if (size === limit) flush();
    }
  };
  // Keep complete payment paragraphs together. Only unusually long notes need
  // further splitting, first at line boundaries, then at Unicode code points.
  for (const block of text.match(/[\s\S]+?(?:\n\n|$)/g) || []) {
    if (Array.from(block).length <= limit) append(block);
    else for (const line of block.match(/[^\n]*\n|[^\n]+$/g) || []) append(line);
  }
  flush();
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
  try { return typeof host?.PattanReportFiles?.beginSaveReportJson !== 'function' && (host?.Capacitor?.getPlatform?.() === 'android' || /\bwv\b/.test(host?.navigator?.userAgent || '')); }
  catch (_) { return true; }
}
