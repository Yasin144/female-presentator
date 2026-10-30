const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const parser = require('@babel/parser');
const postcss = require('postcss');

const root = path.resolve(__dirname, '..');
// Keep preservation checks independent of later source/release commits.
const FINANCIAL_BASELINE = '6df2d4ac23372d016b4825c83402def3887176a7';
const file = 'src/components/OtSalary/OtSalary.jsx';
const current = fs.readFileSync(path.join(root, file), 'utf8');
const parse = source => parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });

function readFinancialBaseline(relative) {
  try {
    return execFileSync('git', ['show', `${FINANCIAL_BASELINE}:${relative}`], {
      cwd: root, encoding: 'utf8', maxBuffer: 2e6, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`Financial baseline ${FINANCIAL_BASELINE} is unavailable for ${relative}. Fetch that original commit or use a full repository checkout before running preservation checks.`, { cause: error });
  }
}

// Navigation and update-alert handlers intentionally change in this redesign.
// Compare complete named financial/storage nodes, so moving them or adding UI
// handlers cannot hide a change to their bodies, dependencies or defaults.
const preservedNodes = {
  'OtSalary.jsx': [
    'LS_OT_SALARY_KEY', 'LS_ACTIVE_EMAIL_KEY', 'LS_OWNER_VAULT_KEY', 'STORAGE_KEY',
    'DEFAULT_SETTINGS', 'computeMonthlyCreditCycles', 'parseTimeToMinutes',
    'minutesToTimeInput', 'sanitizeNoCredTx', 'mergeExpensesNonDestructive',
    'loadStoreForAccountEmail', 'loadInitialStore', 'calculateWorkTiming',
    'persistStore', 'rates', 'liveOtTicker', 'computeDayEarnings',
    'activeDayPreview', 'monthSummary',
  ],
  'ExpensesModule.jsx': [
    'normalizeMaskLast4', 'cleanNoCredBankName', 'buildBankAccountKey',
    'persistUdhaarMap', 'handleToggleTxUdhaar', 'handleMarkUdhaarStatus',
    'handleAddManualUdhaar', 'udhaarSummary', 'persistBankBalance',
    'handleDeleteBankAccount', 'mergeDetectedTransactions', 'effectiveExpensesSource',
    'analytics', 'periodFilteredList', 'periodSummary', 'getMaterializedBaseMap',
    'handleQuickSaveForSelectedDate', 'handleSaveBankBalanceManual',
    'handleSaveTransactionForm', 'handleUpdatePersonalNote',
    'handleToggleTransactionDirection', 'handleDeleteTransaction',
    'handlePasteSmsParse', 'handleImportPaymentAppFile',
  ],
  'UdhaarStandaloneApp.jsx': [
    'UDHAAR_STORAGE_KEY', 'UDHAAR_BIOMETRIC_LOCK_KEY', 'UDHAAR_OTA_VERSION_KEY',
    'UDHAAR_OTA_BUILD_ID_KEY', 'getPaymentStats', 'parseAmountNumber',
    'parseRowsFromSheetGrid', 'parseFreeTextIntoPeople', 'extractUniversalFilePeople',
    'saveItems', 'requestBiometricAuth', 'handleAdd', 'handleSavePayment',
    'handleRemovePaymentRecord', 'handleFileUpload', 'handleUndoLastImport',
    'toggleStatus', 'deleteEntry', 'saveEdit', 'summary',
  ],
};

function inspectSource(source) {
  const nodes = new Map();
  const storageKeys = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if ((node.type === 'FunctionDeclaration' || node.type === 'VariableDeclarator') && node.id?.type === 'Identifier') {
      const matches = nodes.get(node.id.name) || [];
      matches.push(source.slice(node.start, node.end).replace(/\r\n/g, '\n'));
      nodes.set(node.id.name, matches);
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
      const { object, property } = node.callee;
      const isStorage = object.type === 'Identifier' && object.name === 'localStorage'
        || object.type === 'MemberExpression' && object.object.type === 'Identifier'
          && object.object.name === 'window' && object.property.name === 'localStorage';
      if (isStorage && ['getItem', 'setItem', 'removeItem'].includes(property.name) && node.arguments[0]?.type === 'StringLiteral') {
        storageKeys.add(node.arguments[0].value);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (['start', 'end', 'loc', 'extra'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(parse(source));
  return { nodes, storageKeys: [...storageKeys].sort() };
}

let preservedCount = 0;
for (const [name, identifiers] of Object.entries(preservedNodes)) {
  const relative = `src/components/OtSalary/${name}`;
  const before = inspectSource(readFinancialBaseline(relative));
  const after = inspectSource(fs.readFileSync(path.join(root, relative), 'utf8'));
  for (const identifier of identifiers) {
    assert.equal(before.nodes.get(identifier)?.length, 1, `Baseline must contain exactly one ${name}:${identifier}`);
    assert.equal(after.nodes.get(identifier)?.length, 1, `Current source must contain exactly one ${name}:${identifier}`);
    assert.equal(after.nodes.get(identifier)[0], before.nodes.get(identifier)[0], `${name}:${identifier} must preserve financial/storage behavior`);
    preservedCount += 1;
  }
  assert.deepEqual(after.storageKeys, before.storageKeys, `${name}: existing localStorage key identities must remain unchanged`);
}

for (const relative of [
  ...Object.keys(preservedNodes).map(name => `src/components/OtSalary/${name}`),
  'src/components/OtSalary/UpdateAlertsPanel.jsx',
  'src/components/OtSalary/TimeIsMoneyIdentity.jsx',
  'src/components/OtSalary/OtVoiceStatusPanel.jsx',
  'src/components/OtSalary/LiveOtWorkspace.jsx',
  'src/components/OtSalary/ExpenseTransactions.jsx',
  'src/components/OtSalary/ExpenseTransactionDetails.jsx',
  'src/components/OtSalary/ExpenseExportPanel.jsx',
  'src/components/OtSalary/PayslipSummary.jsx',
  'src/salary-preview.jsx', 'src/udhaar-preview.jsx', 'mobile-shell/main.jsx',
]) {
  parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}
for (const name of ['SalaryPro.css', 'SalaryExpenses.css', 'ExpenseTransactions.css', 'ExpenseExportPanel.css', 'PayslipSummary.css', 'UdhaarPro.css', 'UpdateAlerts.css', 'OtVoice.css', 'LiveOtView.css', 'OtSalary.css']) {
  postcss.parse(fs.readFileSync(path.join(root, 'src/components/OtSalary', name), 'utf8'));
}
for (const label of ['Today attendance', 'Expenses', 'Attendance calendar', 'Monthly salary slip', 'Shift rules and settings']) {
  assert.ok(current.includes(label), `Navigation label missing: ${label}`);
}
assert.match(current, /aria-current=\{active \? 'page' : undefined\}/);
assert.match(current, /className="salary-pro|className="ot-pro-shell salary-pro"/);
assert.ok(current.includes('Unhide Salary with Biometric'));
assert.ok(current.includes('8.2.33'));
assert.match(fs.readFileSync(path.join(root, 'src/components/OtSalary/ExpensesModule.jsx'), 'utf8'), /activeGrad: 'var\(--salary-action, #087f5b\)'/);
console.log(`PASS: ${preservedCount} unchanged salary, expense and ledger financial/storage nodes against baseline ${FINANCIAL_BASELINE.slice(0, 7)}; all three localStorage key sets; JSX/CSS syntax; five navigation destinations; privacy control and version.`);
