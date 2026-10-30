import { expenseDateLabel, expenseTimeLabel, expenseMoney, expenseReportText, createExpenseReport } from './expenseReport.js';

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const salaryMoney = value => `INR ${expenseMoney(Math.round(finite(value) * 100))}`;

export function buildSalaryReport({ month, employee, rates, summary, rows, cycles = {}, expenses = 0 }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !summary || !rates) throw new Error('Select a valid salary month.');
  const base = finite(rates.salary), overtime = finite(summary.totalOtPay), allowances = finite(summary.totalExtraAllowance);
  return {
    month, monthLabel: new Date(`${month}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    employee: String(employee || 'Employee'),
    totals: [
      ['Base monthly salary', base], ['Overtime pay', overtime], ['Extra allowances', allowances],
      ['Full earnings before deductions', base + overtime + allowances],
      ['Leave / half-day deductions', finite(summary.leaveDeduction)],
      ['NET RECEIVABLE - FULL MONTH', finite(summary.fullMonthNetPayable)],
      ['Earned for saved attendance days', finite(summary.savedDaysNetTotal)],
    ],
    salaryCycle: `${cycles.salaryStartDay || 10}–${cycles.salaryEndDay || 13} each month`,
    overtimeCycle: `${cycles.otStartDay || 18}–${cycles.otEndDay || 21} each month`,
    savedDays: finite(summary.savedDaysCount), expenseTotal: finite(expenses),
    attendance: (rows || []).map(row => ({
      date: row.iso, day: row.dayName || '', saved: !!row.isSaved, status: row.record?.status || 'Not recorded',
      inTime: row.record?.inTime || '', outTime: row.record?.outTime || '',
      workedMins: finite(row.earnings?.workedMins), otMins: finite(row.earnings?.otMins),
      base: finite(row.earnings?.basePay), overtime: finite(row.earnings?.otPay), allowances: finite(row.earnings?.extraAllowance),
      total: finite(row.earnings?.totalPay), note: String(row.record?.note || ''),
    })),
    note: 'Full-month figures use the monthly base and recorded overtime/allowances. Personal expenses do not reduce salary. Payment credits have not been deducted. Unsaved attendance rows are estimates.',
  };
}

export function salaryReportText(report) {
  return ['*TIME IS MONEY*', '*MONTHLY PAYSLIP*', '', `*${report.monthLabel}*`, `Employee: ${report.employee}`, '',
    '*EARNINGS*', ...report.totals.slice(0, 3).map(([label, amount]) => `${label}: ${salaryMoney(amount)}`),
    `*Full earnings: ${salaryMoney(report.totals[3][1])}*`, '', '*DEDUCTIONS*',
    `Leave / half days: ${salaryMoney(report.totals[4][1])}`,
    `*NET RECEIVABLE: ${salaryMoney(report.totals[5][1])}*`, '',
    `Earned for saved attendance days: ${salaryMoney(report.totals[6][1])}`, '',
    `Saved attendance: ${report.savedDays} days`, `Salary payment cycle: ${report.salaryCycle}`, `OT payment cycle: ${report.overtimeCycle}`,
    '', '*Expenses — tracked separately*', `Spent this month: ${salaryMoney(report.expenseTotal)}`, '', report.note].join('\n');
}

export function salaryReportCsv(report) {
  const cell = value => {
    if (typeof value === 'number') return value.toFixed(2);
    const text = String(value ?? '');
    return `"${(/^[=+\-@]/.test(text.trimStart()) ? "'" : '') + text.replace(/"/g, '""')}"`;
  };
  const rows = [['TIME IS MONEY — MONTHLY PAYSLIP'], ['Month', report.monthLabel], ['Employee', report.employee], [],
    ['PAY SUMMARY', 'Amount (INR)'], ...report.totals, [],
    ['Salary payment cycle', report.salaryCycle], ['OT payment cycle', report.overtimeCycle],
    ['Saved attendance days', report.savedDays], ['Expenses (not deducted)', report.expenseTotal], ['About this report', report.note], [],
    ['DAILY ATTENDANCE'], ['Date', 'Day', 'Saved', 'Status', 'IN', 'OUT', 'Worked minutes', 'OT minutes', 'Base (INR)', 'OT (INR)', 'Allowances (INR)', 'Day total (INR)', 'Note'],
    ...report.attendance.map(row => [row.date, row.day, row.saved ? 'YES' : 'NO', row.status, row.inTime, row.outTime, row.workedMins, row.otMins, row.base, row.overtime, row.allowances, row.total, row.note])];
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}

export function buildDailyStatement({ date, record, calculation = {}, employee, transactions }) {
  if (!record || record.date && record.date !== date || !record.inTime && !record.outTime) throw new Error('No saved IN or OUT attendance for today. Save today’s attendance first.');
  const lines = ['*TIME IS MONEY*', '*DAILY ATTENDANCE & PAY STATEMENT*', '', `*${expenseDateLabel(date)}*`, `Employee: ${employee || 'Employee'}`,
    `IN: ${record.inTime ? expenseTimeLabel(record.inTime) : 'Not recorded'}`, `OUT: ${record.outTime ? expenseTimeLabel(record.outTime) : 'Pending — on duty'}`, `Status: ${record.status || 'present'}`, ''];
  if (record.outTime) lines.push('*Day earnings*', `Base pay: ${salaryMoney(calculation.basePay)}`, `Overtime: ${salaryMoney(calculation.otPay)}`,
    `Allowances: ${salaryMoney(calculation.extraAllowance)}`, `*Total: ${salaryMoney(calculation.totalPay)}*`);
  else lines.push('_Day earnings will be final after OUT is saved._');
  if (record.note) lines.push('', `Attendance note: ${record.note}`);
  lines.push('', expenseReportText(createExpenseReport(transactions, { from: date, to: date })).replace(/^\*TIME IS MONEY\*\n/, ''));
  return lines.join('\n');
}
