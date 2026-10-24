const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const { reconcileTransactionReadingOrder: reconcile, transactionReadingView: view } = await import(pathToFileURL(path.resolve(__dirname, '../src/components/OtSalary/transactionPresentation.js')));
  const empty = reconcile(null, [], 'all');
  let current = empty;
  for (let render = 0; render < 100; render++) current = reconcile(current, [], 'all');
  assert.equal(current, empty, 'An empty ledger must settle without triggering a render loop');
  const first = reconcile(empty, [{ id: 'a' }], 'all');
  assert.deepEqual(first.ids, ['a'], 'First capture appears after an initially empty ledger');
  assert.equal(reconcile(first, [{ id: 'a' }], 'all'), first, 'Unchanged records must retain a stable reading snapshot');
  const live = [{ id: 'b', amount: 5 }, { id: 'a', amount: 10 }];
  assert.equal(reconcile(first, live, 'all'), first, 'New captures must not move the row being read');
  assert.deepEqual(view(first, live), { rows: [live[1]], pendingCount: 1 });
  const deleted = reconcile(first, [{ id: 'b' }], 'all');
  assert.deepEqual(deleted.ids, [], 'Removed records disappear from the reading snapshot');
  const filtered = reconcile(first, live, 'incoming');
  assert.deepEqual(filtered.ids, ['b', 'a'], 'Changing filters uses the filtered record order');
  assert.deepEqual(reconcile(null, [{ id: 1 }, { id: '1' }], 'all').ids, ['1'], 'Duplicate identifiers produce one displayed row');
  console.log('PASS: 8 transaction reading-order and empty-ledger stability scenarios.');
})().catch(error => { console.error(error); process.exitCode = 1; });
