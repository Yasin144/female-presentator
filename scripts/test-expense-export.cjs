const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ExcelJS = require('exceljs');

(async () => {
  const reportTools = await import(pathToFileURL(path.resolve(__dirname, '../src/components/OtSalary/expenseReport.js')));
  const { expenseExcelBuffer } = await import(pathToFileURL(path.resolve(__dirname, '../src/components/OtSalary/expenseExcel.js')));
  const { openWhatsAppReport } = await import(pathToFileURL(path.resolve(__dirname, '../src/components/OtSalary/whatsAppHandoff.js')));
  const { createExpenseReport, validExpenseDate, expenseReportText, expenseWhatsAppParts, expenseReportFilename } = reportTools;
  let checks = 0;
  const equal = (a, b) => { assert.deepEqual(a, b); checks++; };
  const base = { type: 'debit', status: 'completed', amount: 125.50, date: '2026-10-30', time: '09:10', merchant: 'Lunch', category: 'Food', paymentMethod: 'Cash', refId: '000123', note: 'Meal' };
  const other = { ...base, date: '2026-10-29', merchant: 'Bus', amount: 30.25 };
  const input = [base, other, { ...base, type: 'credit', merchant: 'Salary', amount: 25000 }, { ...base, type: 'refund', amount: 50 }];
  const before = JSON.stringify(input);
  const single = createExpenseReport(input, { from: '2026-10-30', to: '2026-10-30' });
  equal(single.rows.length, 1); equal(single.totalPaise, 12550); equal(single.period, '2026-10-30');
  equal(JSON.stringify(input), before);
  const range = createExpenseReport(input, { from: '2026-10-29', to: '2026-10-30' });
  equal(range.rows.map(row => row.merchant), ['Bus', 'Lunch']); equal(range.totalPaise, 15575);
  equal(range.days.map(day => [day.date, day.count, day.paise]), [['2026-10-29', 1, 3025], ['2026-10-30', 1, 12550]]);
  for (const variant of [
    { _deleted: true }, { _demoPreview: true }, { isDemoPreview: true }, { source: 'demo-preview' },
    { status: 'pending' }, { status: 'failed' }, { status: 'reversed' }, { reconciliationStatus: 'possible_duplicate' },
    { amount: 0 }, { amount: -50 }, { amount: Infinity }, { amount: 'invalid' },
    { type: 'credit' }, { type: 'refund' }, { type: 'unknown' }, { date: '' }, { date: '2026-02-30' },
  ]) equal(createExpenseReport([{ ...base, ...variant }]).rows.length, 0);
  for (const date of ['2024-02-29', '2026-10-30', '2026-12-31']) equal(validExpenseDate(date), true);
  for (const date of ['2026-02-29', '2026-13-01', '2026-04-31', '2026-1-1', undefined]) equal(validExpenseDate(date), false);
  assert.throws(() => createExpenseReport(input, { from: '2026-11-01', to: '2026-10-30' }), /end date/); checks++;
  assert.throws(() => createExpenseReport(input, { from: '2026-02-30' }), /valid date/); checks++;
  equal(createExpenseReport(input, { from: '2026-12-01', to: '2026-12-02' }).totalPaise, 0);
  equal(createExpenseReport({ a: base, b: other }).rows.length, 2);
  equal(createExpenseReport([{ ...base, amount: 0.1 }, { ...base, amount: 0.2 }]).totalPaise, 30);
  equal(expenseReportFilename(single), 'Expenses-2026-10-30.xlsx');
  equal(expenseReportFilename(range), 'Expenses-2026-10-29-to-2026-10-30.xlsx');
  const tsv = reportTools.expenseTableTsv(range);
  equal(tsv.split('\n').length, 4); equal(tsv.includes('TOTAL\t\t\t\t\t155.75'), true);
  equal(reportTools.expenseTableTsv(createExpenseReport([{ ...base, merchant: '=SUM(1,2)', note: '+Formula\nNewline' }])).includes("'=SUM(1,2)"), true);
  equal(reportTools.expenseFileSavingNeedsApk({ navigator: { userAgent: 'Chrome Windows' } }), false);
  equal(reportTools.expenseFileSavingNeedsApk({ navigator: { userAgent: 'Android; wv)' } }), true);
  equal(reportTools.expenseFileSavingNeedsApk({ Capacitor: { getPlatform: () => 'android' } }), true);
  const share = expenseReportText(range);
  equal(share.includes('*2026-10-29'), true); equal(share.includes('*2026-10-30'), true);
  equal(share.includes('Salary'), false); equal(share.includes('25,000'), false); equal(share.includes('155.75'), true);
  const unicode = 'తెలుగు हिन्दी العربية 😀👨‍👩‍👧‍👦 & + % #?\n'.repeat(250);
  const parts = expenseWhatsAppParts(unicode);
  equal(parts.map(part => part.replace(/^Expenses · Part \d+\/\d+\n/, '')).join(''), unicode);
  equal(parts.every(part => Array.from(part).length < 2900), true);
  equal(expenseWhatsAppParts('short message'), ['short message']);
  assert.throws(() => expenseWhatsAppParts(unicode, 0)); checks++;
  const calls = [];
  equal(openWhatsAppReport({ PattanBiometric: { sendWhatsAppMessageToNumber: (...args) => { calls.push(args); return true; } } }, 'PICK_CONTACT', share).status, 'opening');
  equal(calls, [['PICK_CONTACT', share]]);
  const mobile = { navigator: { userAgent: 'Android' }, location: {} };
  openWhatsAppReport(mobile, 'PICK_CONTACT', share);
  equal(new URL(mobile.location.href).searchParams.has('phone'), false);
  equal(new URL(mobile.location.href).searchParams.get('text'), share);

  // Open the generated real XLSX, rather than testing an extension or CSV string.
  const buffer = await expenseExcelBuffer(range);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
  equal(workbook.worksheets.map(sheet => sheet.name), ['Expenses', 'Daily totals', 'Report details']);
  const sheet = workbook.getWorksheet('Expenses');
  equal(sheet.rowCount, 3); equal(sheet.getCell('A2').value, '2026-10-29');
  equal(sheet.getCell('C2').value, 'Bus'); equal(sheet.getCell('F2').value, 30.25);
  equal(sheet.getCell('F3').value, 125.5); equal(sheet.getCell('H3').value, '000123');
  equal(workbook.getWorksheet('Daily totals').getCell('C4').value, 155.75);
  equal(sheet.views[0].ySplit, 1); equal(sheet.autoFilter, 'A1:H3');
  const malicious = createExpenseReport([{ ...base, merchant: '=SUM(1,2)', note: '+CMD|example', refId: '@not-a-formula' }]);
  const safetyBook = new ExcelJS.Workbook(); await safetyBook.xlsx.load(await expenseExcelBuffer(malicious));
  equal(safetyBook.getWorksheet('Expenses').getCell('C2').type, ExcelJS.ValueType.String);
  equal(safetyBook.getWorksheet('Expenses').getCell('G2').value, '+CMD|example');
  const many = createExpenseReport(Array.from({ length: 2000 }, (_, i) => ({ ...base, merchant: `Expense ${i}`, amount: 0.1 })));
  const manyBook = new ExcelJS.Workbook(); await manyBook.xlsx.load(await expenseExcelBuffer(many));
  equal(manyBook.getWorksheet('Expenses').rowCount, 2001); equal(manyBook.getWorksheet('Daily totals').getCell('C3').value, 200);
  fs.mkdirSync(path.resolve(__dirname, '../review/expense-export'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../review/expense-export/sample-expenses.xlsx'), Buffer.from(buffer));
  fs.writeFileSync(path.resolve(__dirname, '../review/expense-export/test-result.json'), JSON.stringify({ checks, passed: true, realXlsxReadBack: true, noLiveWhatsAppSend: true }, null, 2));
  console.log(`Expense-only export: ${checks} checks passed; real XLSX opened and verified.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
