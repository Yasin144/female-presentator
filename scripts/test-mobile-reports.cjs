const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
let checks = 0;
const same = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };

(async () => {
  const load = name => import(pathToFileURL(path.join(root, 'src/components/OtSalary', name + '.js')));
  const { buildSalaryReport, salaryReportCsv, salaryReportText, buildDailyStatement } = await load('salaryReport');
  const files = await load('reportFiles');
  const alerts = await load('updateAlertBridge');
  const args = { month: '2026-10', employee: 'Yasin — payroll review', rates: { salary: 30000 },
    summary: { totalOtPay: 1800, totalExtraAllowance: 200, leaveDeduction: 1500, fullMonthNetPayable: 30500, savedDaysNetTotal: 17500, savedDaysCount: 16 },
    rows: [{ iso: '2026-10-30', dayName: 'Fri', isSaved: true, record: { status: 'present', inTime: '09:00', outTime: '19:00', note: 'Extra shift, "approved"\nSecond line' }, earnings: { workedMins: 600, otMins: 90, basePay: 1000, otPay: 100, totalPay: 1100 } }], expenses: 9000 };
  const before = JSON.stringify(args), report = buildSalaryReport(args);
  same(JSON.stringify(args), before); same(report.monthLabel, 'October 2026');
  same(report.totals[3][1], 32000); same(report.totals[4][1], 1500); same(report.totals[5][1], 30500); same(report.totals[6][1], 17500);
  same(report.expenseTotal, 9000); same(report.attendance[0].note, args.rows[0].record.note);
  same(salaryReportText(report).includes('INR 30,500.00'), true);
  same(salaryReportText(report).includes('October 2026'), true);
  same(salaryReportText(report).includes('INR 32,000.00'), true);
  same(salaryReportText(report).includes('do not reduce salary'), true);
  const csv = salaryReportCsv(report);
  same(csv.startsWith('\uFEFF'), true); same(csv.includes('"NET RECEIVABLE - FULL MONTH",30500.00'), true);
  same(csv.includes('"Extra shift, ""approved""\nSecond line"'), true);
  same(csv.indexOf('PAY SUMMARY') < csv.indexOf('DAILY ATTENDANCE'), true);
  same(salaryReportCsv(buildSalaryReport({ ...args, employee: '=HYPERLINK("bad")' })).includes('"\'=HYPERLINK(""bad"")"'), true);
  assert.throws(() => buildSalaryReport({ ...args, month: '2026-13' })); checks++;
  for (const note of ['', 'తెలుగు हिन्दी العربية 😀', '=FORMULA', 'Multi\nline note']) {
    const text = buildDailyStatement({ date: '2026-10-30', employee: 'Employee', record: { date: '2026-10-30', inTime: '09:00', note }, transactions: [] });
    same(text.includes('OUT: Pending'), true); same(text.includes('final after OUT'), true);
    if (note) same(text.includes(note), true);
  }
  const expense = { date: '2026-10-30', type: 'debit', status: 'completed', amount: 10, merchant: 'Shop' };
  const transactions = [...Array.from({ length: 40 }, (_, i) => ({ ...expense, merchant: `Shop ${i}` })), { ...expense, date: '2026-10-29', merchant: 'WRONG DAY' }, { ...expense, type: 'refund', merchant: 'REFUND' }];
  const completed = buildDailyStatement({ date: '2026-10-30', record: { inTime: '09:00', outTime: '19:00' }, calculation: { basePay: 1000, otPay: 100, totalPay: 1100 }, transactions });
  same(completed.includes('INR 1,100.00'), true); same(completed.includes('Shop 39'), true);
  same(completed.includes('WRONG DAY'), false); same(completed.includes('REFUND'), false); same(completed.includes('₹400.00'), true);
  for (const record of [undefined, {}, { date: '2026-10-29', inTime: '09:00' }]) { assert.throws(() => buildDailyStatement({ date: '2026-10-30', record, transactions: [] })); checks++; }

  // Execute the real Resend handler with automatic-send services absent/disabled.
  const source = fs.readFileSync(path.join(root, 'src/components/OtSalary/OtSalary.jsx'), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let handler;
  (function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.name === 'resendTodayStatement') handler = source.slice(node.init.start, node.init.end);
    for (const child of Object.values(node)) { if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child); }
  })(ast);
  assert.ok(handler); checks++;
  for (const record of [undefined, { inTime: '09:00' }, { inTime: '09:00', outTime: '19:00' }]) {
    let handoffs = [], prepared, notice;
    const run = vm.runInNewContext('(' + handler + ')', { getTodayIsoDate: () => '2026-10-30', daysMap: record ? { '2026-10-30': record } : {}, settings: { employeeName: 'Employee' }, normalizeEmployeeName: x => x,
      computeDayEarnings: () => ({ basePay: 1000, totalPay: 1100 }), buildDailyStatement, expensesMapRef: { current: transactions }, window: {},
      openWhatsAppReport: (...values) => { handoffs.push(values); return { status: 'opening' }; }, setPreparedWhatsAppReport: value => { prepared = value; }, setSaveNotice: value => { notice = value; } });
    run(); same(handoffs.length, record ? 1 : 0);
    if (record) { same(prepared.text.includes('Shop 39'), true); same(prepared.phone, '917386726193'); same(notice.includes('tap Send'), true); }
    else same(notice.includes('No saved'), true);
  }

  same(alerts.readUpdateAlertStatus({}), { supported: false });
  const bridge = { getUpdateAlertStatusJson: () => JSON.stringify({ supported: true, enabled: true }) };
  same(alerts.readUpdateAlertStatus({ PattanBiometric: {}, PattanBiometricBridge: bridge }).enabled, true);
  same(alerts.updateAlertBridge({ PattanBiometric: {}, PattanBiometricBridge: bridge }, 'getUpdateAlertStatusJson'), bridge);
  for (const invalid of ['null', '[]', 'bad']) { assert.throws(() => alerts.readUpdateAlertStatus({ PattanBiometric: { getUpdateAlertStatusJson: () => invalid } })); checks++; }

  const makeHost = response => {
    const listeners = new Map(), calls = [];
    const host = { crypto: { randomUUID: () => 'request-123' }, btoa: value => Buffer.from(value, 'binary').toString('base64'), setTimeout: () => 7, clearTimeout() {},
      addEventListener: (name, receive) => listeners.set(name, receive), removeEventListener: name => listeners.delete(name),
      PattanReportFiles: { beginSaveReportJson: (...values) => { calls.push(values); return response; } } };
    return { host, calls, listeners, emit: detail => listeners.get(files.REPORT_FILE_EVENT)?.({ detail }) };
  };
  for (const status of ['saved', 'cancelled']) {
    const mock = makeHost('{"status":"choosing"}');
    const result = files.saveReportFile(mock.host, 'Unicode తెలుగు 😀', 'text/csv;charset=utf-8', 'Report.csv');
    mock.emit({ requestId: 'other-request', status: 'saved' }); same(mock.listeners.size, 1);
    mock.emit({ requestId: 'request-123', status, filename: 'Report.csv' });
    same((await result).status, status); same(mock.listeners.size, 0);
    same(mock.calls[0].slice(0, 3), ['request-123', 'Report.csv', 'text/csv']);
    same(Buffer.from(mock.calls[0][3], 'base64').toString(), 'Unicode తెలుగు 😀');
  }
  for (const response of ['{"status":"failed","error":"Another save window is open"}', 'bad json']) {
    const mock = makeHost(response); await assert.rejects(files.saveReportFile(mock.host, 'data', 'text/csv', 'Report.csv')); checks++;
    same(mock.listeners.size, 0);
  }
  const failed = makeHost('{"status":"choosing"}'), failure = files.saveReportFile(failed.host, 'data', 'text/csv', 'Report.csv');
  failed.emit({ requestId: 'request-123', status: 'failed', error: 'No storage space' });
  await assert.rejects(failure, /No storage space/); checks++;
  await assert.rejects(files.saveReportFile({ Capacitor: { getPlatform: () => 'android' } }, 'data', 'text/csv', 'Report.csv'), /signed APK/); checks++;
  await assert.rejects(files.saveReportFile({}, new Uint8Array(0), 'text/csv', 'Report.csv')); checks++;
  await assert.rejects(files.saveReportFile({}, new Uint8Array(files.MAX_REPORT_BYTES + 1), 'text/csv', 'Report.csv')); checks++;
  same(files.savedReportNotice({ status: 'cancelled' }, 'CSV').includes('saved as'), false);
  same(files.savedReportNotice({ status: 'saved' }, 'PDF'), 'PDF saved to the location you chose.');
  same(files.savedReportNotice({ status: 'saved', filename: 'My renamed report.pdf' }, 'PDF'), 'PDF saved as My renamed report.pdf.');
  const { salaryReportPdf } = await load('salaryReportPdf');
  const pdf = await salaryReportPdf(buildSalaryReport({ ...args, rows: Array.from({ length: 31 }, (_, i) => ({ ...args.rows[0], iso: `2026-10-${String(i + 1).padStart(2, '0')}` })) }), fs.readFileSync(path.join(root, 'public/caption-fonts/Nunito-Regular.ttf')));
  same(Buffer.from(pdf).subarray(0, 5).toString(), '%PDF-');
  fs.mkdirSync(path.join(root, 'tmp/pdfs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tmp/pdfs/report-repairs.pdf'), Buffer.from(pdf));
  fs.mkdirSync(path.join(root, 'review/report-repairs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'review/report-repairs/checks.json'), JSON.stringify({ checks, passed: true, pdfGenerated: true, realPhoneTested: false }, null, 2));
  console.log(`Salary, daily statement, file-saving and alert bridges: ${checks} checks passed; real PDF generated.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
