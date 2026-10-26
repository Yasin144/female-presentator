const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const { pathToFileURL } = require('node:url');

(async () => {
  const { openWhatsAppReport } = await import(pathToFileURL(path.resolve(__dirname, '../src/components/OtSalary/whatsAppHandoff.js')));
  const source = fs.readFileSync(path.resolve(__dirname, '../src/components/OtSalary/OtSalary.jsx'), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  let callback;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.name === 'sendWhatsAppAttendanceAndPaymentAlert') callback = node.init.arguments[0];
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  assert.ok(callback);
  let checks = 0;
  const same = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const phone = '917386726193';
  const text = '🟢 *ATTENDANCE IN REPORT*\nName: తెలుగు हिन्दी العربية\n09:01 AM\n₹1,234 & +100% #?\nLAST LINE';
  // Every transport gets precisely the same whole text, even across cold starts.
  for (const report of [text, `${text}\n${'Long note 🟢 & + #? '.repeat(1000)}\nEND`, 'plain\nmessage']) {
    for (const bridgeName of ['PattanBiometric', 'PattanBiometricBridge', 'PattanSecureWhatsApp']) {
      const calls = [];
      const host = { [bridgeName]: { shareWhatsAppMessageToNumber: (...args) => { calls.push(args); return true; } } };
      same(openWhatsAppReport(host, phone, report).method, 'shareWhatsAppMessageToNumber');
      same(calls, [[phone, report]]);
    }
  }
  const calls = [];
  const old = { sendWhatsAppMessageToNumber: (...args) => { calls.push(args); return true; } };
  // A bridge object without a sender must not hide a usable later bridge.
  same(openWhatsAppReport({ PattanBiometric: {}, PattanSecureWhatsApp: old }, phone, text).method, 'sendWhatsAppMessageToNumber');
  same(calls, [[phone, text]]);
  const fail = () => { throw new Error('mock Android launch failure'); };
  same(openWhatsAppReport({ PattanBiometric: { shareWhatsAppMessageToNumber: fail }, PattanSecureWhatsApp: old }, phone, text).status, 'opening');
  const decline = { shareWhatsAppMessageToNumber: () => false };
  same(openWhatsAppReport({ PattanBiometric: decline, PattanSecureWhatsApp: old }, phone, text).status, 'opening');
  const mobile = { navigator: { userAgent: 'Android 16' }, location: {} };
  same(openWhatsAppReport(mobile, phone, text).status, 'opening');
  same(new URL(mobile.location.href).searchParams.get('text'), text);
  same(new URL(mobile.location.href).searchParams.get('phone'), phone);
  same(openWhatsAppReport({ open: () => null }, phone, text).status, 'failed');
  same(openWhatsAppReport(null, phone, text).status, 'failed');
  for (const invalid of ['', '  \n', null, undefined]) same(openWhatsAppReport({}, phone, invalid).status, 'failed');
  const popup = { opener: {} };
  same(openWhatsAppReport({ open: () => popup }, phone, text).status, 'opening');
  same(popup.opener, null);

  // Execute the actual React report builder with controlled saved attendance.
  let recovered;
  const received = [];
  const context = vm.createContext({
    settings: { employeeName: 'Test Employee', officeStartTime: '10:00' },
    normalizeEmployeeName: value => value,
    getTodayIsoDate: () => '2026-10-26',
    formatTime12h: value => value,
    formatINR: value => String(value),
    formatMinutesReadable: value => String(value),
    expensesMapRef: { current: {} },
    window: { PattanBiometric: { shareWhatsAppMessageToNumber: (p, message) => { received.push(message); return true; } } },
    openWhatsAppReport,
    setPreparedWhatsAppReport: value => { recovered = value; },
  });
  const send = vm.runInContext(`(${source.slice(callback.start, callback.end)})`, context);
  for (const note of ['', 'Line one\nLine two + & 100% 🟢', 'Full long note '.repeat(2000)]) {
    same(send('in', { date: '2026-10-26', inTime: '09:01', isBiometric: true, note }), true);
    same(recovered.text, received.at(-1));
    same(recovered.text.includes('*IN Time:* 09:01'), true);
    same(recovered.text.includes('Biometric Verified'), true);
    if (note) same(recovered.text.endsWith(note), true);
  }
  // Failed or blocked launch retains a complete, copyable report.
  context.window = { open: () => null };
  same(send('in', { inTime: '08:23', note: 'Do not lose this last line' }), false);
  same(recovered.status, 'failed');
  same(recovered.text.endsWith('Do not lose this last line'), true);
  same(recovered.text.includes('*IN Time:* 08:23'), true);
  const recoverySource = fs.readFileSync(path.resolve(__dirname, '../src/components/OtSalary/WhatsAppReportRecovery.jsx'), 'utf8');
  const recoveryAst = parser.parse(recoverySource, { sourceType: 'module', plugins: ['jsx'] });
  let copyNode;
  function findCopy(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.name === 'copy') copyNode = node.init;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(findCopy);
      else if (value && typeof value === 'object') findCopy(value);
    }
  }
  findCopy(recoveryAst);
  let copiedText, copyNotice, focused = false, selected = false;
  const copyContext = vm.createContext({
    navigator: { clipboard: { writeText: async value => { copiedText = value; } } },
    report: { text },
    textRef: { current: { focus: () => { focused = true; }, select: () => { selected = true; } } },
    setCopyStatus: value => { copyNotice = value; },
  });
  const copy = vm.runInContext(`(${recoverySource.slice(copyNode.start, copyNode.end)})`, copyContext);
  await copy();
  same(copiedText, text);
  same(copyNotice.startsWith('Full report copied.'), true);
  copyContext.navigator.clipboard.writeText = async () => { throw new Error('mock clipboard denied'); };
  await copy();
  same(focused, true);
  same(selected, true);
  same(copyNotice.startsWith('Select Copy from the text menu'), true);
  console.log(`WhatsApp attendance handoff: ${checks} scenarios passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
