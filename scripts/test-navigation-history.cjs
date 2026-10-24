const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const { expenseViewFromKey, expenseViewKey, visitView, previousView, resolveBackAction, shouldRearmBrowserGuard } = await import(pathToFileURL(path.resolve(__dirname, '../src/components/OtSalary/navigationHistory.js')));
  let checks = 0;
  const equal = (a, b) => { assert.deepEqual(a, b); checks += 1; };
  let history = ['today'];
  history = visitView(history, 'expenses');
  history = visitView(history, 'summary');
  equal(history, ['today', 'expenses', 'summary']);
  let step = previousView(history);
  equal(step.view, 'expenses');
  equal(previousView(step.history).view, 'today');
  equal(previousView(['rules']).type, 'root');
  equal(previousView(['rules']).view, 'rules');
  equal(visitView(['today', 'month'], 'month'), ['today', 'month']);
  equal(visitView(['today', 'month'], 'today'), ['today', 'month', 'today']);
  equal(visitView(['today', 'month', 'summary'], 'rules', 3), ['month', 'summary', 'rules']);
  equal(visitView(['today'], null), ['today']);
  equal(visitView(null, 'expenses'), ['expenses']);
  equal(visitView(['today'], 'month', 1), ['today', 'month']);
  equal(previousView(null), { type: 'root', history: [], view: '' });
  for (const modal of ['manual-editor', 'feature-suggestion', 'stealth-calculator', 'credit-cycle', 'notifications', 'profile', 'update-prompt', 'transaction-detail', 'balance-editor']) {
    const action = resolveBackAction(history, [null, modal, 'underlying-sheet']);
    equal(action.type, 'overlay');
    equal(action.overlay, modal);
    equal(action.history, history);
  }
  equal(resolveBackAction(history, []).view, 'expenses');
  equal(resolveBackAction(['summary'], []).type, 'root');
  let expenseHistory = visitView(['overview'], 'transactions');
  expenseHistory = visitView(expenseHistory, 'insights');
  equal(resolveBackAction(expenseHistory, ['transaction-detail']).type, 'overlay');
  equal(previousView(expenseHistory).view, 'transactions');
  equal(previousView(previousView(expenseHistory).history).view, 'overview');
  equal(shouldRearmBrowserGuard('handled'), true);
  equal(shouldRearmBrowserGuard('root'), false);
  equal(shouldRearmBrowserGuard(''), false);
  // UI, native and browser back all resolve the same history; browser guard
  // consumption and re-arm are a net-zero change in browser entry count.
  equal(previousView(history), resolveBackAction(history));
  let browserEntryCount = 2;
  for (let i = 0; i < 20; i += 1) {
    browserEntryCount -= 1;
    if (shouldRearmBrowserGuard('handled')) browserEntryCount += 1;
  }
  equal(browserEntryCount, 2);
  const afterBack = previousView(['today', 'expenses', 'summary']).history;
  equal(visitView(afterBack, 'month'), ['today', 'expenses', 'month']);
  let nested = ['overview'];
  nested = visitView(nested, expenseViewKey('insights'));
  nested = visitView(nested, expenseViewKey('insights', 'Categories'));
  nested = visitView(nested, expenseViewKey('transactions'));
  nested = visitView(nested, expenseViewKey('insights', 'Categories'));
  equal(previousView(nested).view, 'transactions');
  equal(expenseViewFromKey(previousView(previousView(nested).history).view), { tab: 'insights', insight: 'Categories' });
  equal(expenseViewFromKey('insights:'), { tab: 'insights', insight: 'Overview' });
  equal(expenseViewFromKey('transactions'), { tab: 'transactions', insight: 'Overview' });
  equal(expenseViewFromKey(null), { tab: 'overview', insight: 'Overview' });
  const salarySource = fs.readFileSync(path.resolve(__dirname, '../src/components/OtSalary/OtSalary.jsx'), 'utf8');
  const expenseSource = fs.readFileSync(path.resolve(__dirname, '../src/components/OtSalary/ExpensesModule.jsx'), 'utf8');
  const backHandler = salarySource.slice(salarySource.indexOf('  const goBackStep ='), salarySource.indexOf('  const handleTouchStart ='));
  assert.ok(backHandler.includes('latestBackStepRef.current()'));
  assert.ok(backHandler.includes('window.__handleExpenseHardwareBack'));
  assert.ok(backHandler.includes("return 'root'"));
  assert.ok(!backHandler.includes("setMobileTab('today')"));
  assert.equal((salarySource.match(/addEventListener\('popstate'/g) || []).length, 1);
  assert.ok(expenseSource.includes('if (selectedTxId) { setSelectedTxId(null);'));
  assert.ok(expenseSource.includes('window.__handleExpenseHardwareBack === handleExpenseBack'));
  checks += 7;
  console.log(`PASS: ${checks} navigation-history scenarios.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
