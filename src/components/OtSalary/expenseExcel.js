import ExcelJS from 'exceljs';

export async function expenseExcelBuffer(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Time Is Money';
  const expenses = workbook.addWorksheet('Expenses', { views: [{ state: 'frozen', ySplit: 1 }] });
  expenses.columns = [
    { header: 'Date', key: 'date', width: 14 }, { header: 'Time', key: 'time', width: 12 },
    { header: 'Paid to', key: 'merchant', width: 28 }, { header: 'Category', key: 'category', width: 22 },
    { header: 'Payment method', key: 'method', width: 22 }, { header: 'Expense (INR)', key: 'amount', width: 18 },
    { header: 'Note / purpose', key: 'note', width: 42 }, { header: 'Reference', key: 'reference', width: 28 },
  ];
  for (const row of report.rows) expenses.addRow({ ...row, amount: row.paise / 100 });
  expenses.autoFilter = { from: 'A1', to: `H${report.rows.length + 1}` };
  expenses.getColumn('amount').numFmt = '"₹"#,##0.00';
  expenses.getColumn('note').alignment = { wrapText: true, vertical: 'top' };
  const daily = workbook.addWorksheet('Daily totals');
  daily.columns = [{ header: 'Date', key: 'date', width: 16 }, { header: 'Expense count', key: 'count', width: 18 }, { header: 'Total (INR)', key: 'total', width: 20 }];
  for (const day of report.days) daily.addRow({ date: day.date, count: day.count, total: day.paise / 100 });
  daily.addRow({ date: 'TOTAL', count: report.rows.length, total: report.totalPaise / 100 });
  daily.getColumn('total').numFmt = '"₹"#,##0.00';
  const info = workbook.addWorksheet('Report details');
  info.addRows([['Time Is Money — expenses only'], ['Period', report.period], ['Expenses', report.rows.length], ['Total (INR)', report.totalPaise / 100], ['Includes', 'Completed paid expenses only'], ['Excludes', 'Income, refunds, deleted, pending, failed, reversed and possible duplicate records']]);
  info.getColumn(1).width = 24; info.getColumn(2).width = 80;
  for (const sheet of [expenses, daily]) {
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF087F5B' } };
  }
  // Plain string cell values are deliberately used for merchant names, notes
  // and references. User-entered '=' text is never a spreadsheet formula.
  return workbook.xlsx.writeBuffer();
}
