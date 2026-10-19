const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function runTests() {
  const engine = await import('../src/components/OtSalary/expenseMemoryEngine.js');
  const {
    parseSmsOrUpiTextJs,
    reconcileAndMergeTransactions,
    migrateAndNormalizeExpenseRecord,
    suggestNotesAndCategoryForMerchant,
    computeExpenseAnalytics,
    answerNaturalLanguageFinanceQuery,
    formatTransactionsCsv,
  } = engine;

  console.log('1. Testing SMS & Notification Parsing + Privacy Masking...');

  // 1a. Standard UPI Debit with Slash Remark
  const ts1 = new Date('2026-10-19T09:15:00').getTime();
  const sms1 = parseSmsOrUpiTextJs(
    'Rs. 240.00 debited from A/c 123456789012 on 19-10-26 to VPA swiggy@okaxis. UPI/429311223344/Swiggy/Team Lunch',
    ts1,
    'mobile-sms'
  );
  assert.ok(sms1, 'Should parse valid UPI debit SMS');
  assert.equal(sms1.amount, 240);
  assert.equal(sms1.type, 'debit');
  assert.equal(sms1.status, 'completed');
  assert.equal(sms1.refId, '429311223344');
  assert.equal(sms1.originalRemark, 'Team Lunch');
  assert.equal(sms1.note, 'Team Lunch');
  assert.equal(sms1.category, 'food');
  assert.equal(sms1.app, 'GPay');
  assert.ok(!sms1.rawText.includes('123456789012'), 'Full 12-digit account number must be masked');
  assert.ok(sms1.rawText.includes('XX9012'), 'Last 4 digits should remain recognizable');

  // 1b. OTP & Promotional Spam rejection
  const otpMsg = parseSmsOrUpiTextJs('Your OTP for transaction of Rs. 5000 is 839201. Never share your PIN or OTP.', ts1);
  assert.equal(otpMsg, null, 'Pure OTP message must be ignored');

  const promoMsg = parseSmsOrUpiTextJs('Get flat Rs. 50000 pre-approved loan up to Rs. 5 Lakh! Click http://spam.example', ts1);
  assert.equal(promoMsg, null, 'Promotional loan spam must be ignored');

  // 1c. Missing payment remark is never fabricated
  const noNoteSms = parseSmsOrUpiTextJs(
    'INR 450.00 debited from A/c XX4411 to Indian Oil Petrol Pump on 19-10-26. UTR 429399887766',
    ts1,
    'mobile-sms'
  );
  assert.ok(noNoteSms);
  assert.equal(noNoteSms.amount, 450);
  assert.equal(noNoteSms.originalRemark, '');
  assert.equal(noNoteSms.note, '');
  assert.equal(noNoteSms.noteReviewed, false);
  assert.equal(noNoteSms.category, 'fuel');

  // 1d. Refund, Self-Transfer, Income, and Failed transaction detection
  const refundSms = parseSmsOrUpiTextJs(
    'Refund of Rs. 120.00 from Swiggy credited to your A/c XX9012. Ref 429300001111',
    ts1,
    'mobile-sms'
  );
  assert.ok(refundSms);
  assert.equal(refundSms.type, 'refund');
  assert.equal(refundSms.amount, 120);

  const selfTransferSms = parseSmsOrUpiTextJs(
    'Rs. 5,000.00 transferred via UPI Self Transfer between your accounts. Ref 429355556666',
    ts1,
    'mobile-sms'
  );
  assert.ok(selfTransferSms);
  assert.equal(selfTransferSms.type, 'transfer');
  assert.equal(selfTransferSms.amount, 5000);

  const failedSms = parseSmsOrUpiTextJs(
    'Payment of Rs. 899.00 to Amazon failed and could not be processed. Ref 429377778888',
    ts1,
    'mobile-sms'
  );
  assert.ok(failedSms);
  assert.equal(failedSms.status, 'failed');
  assert.equal(failedSms.reconciliationStatus, 'needs_review');

  console.log('2. Testing Duplicate Prevention & Reconciliation Engine...');

  // 2a. Same payment in Bank SMS (without remark) + App Notification (with remark) sharing Ref ID
  let storeMap = {};
  const smsNoRemark = parseSmsOrUpiTextJs(
    'Rs. 240.00 debited from A/c XX9012 to Swiggy. UPI Ref 429311223344',
    ts1,
    'mobile-sms'
  );
  const notifWithRemark = parseSmsOrUpiTextJs(
    'Paid ₹240.00 to Swiggy on Google Pay. UPI/429311223344/Swiggy/Team Lunch',
    ts1 + 5000,
    'mobile-notification'
  );
  let res1 = reconcileAndMergeTransactions(storeMap, [smsNoRemark]);
  storeMap = res1.nextMap;
  assert.equal(Object.keys(storeMap).length, 1);

  let res2 = reconcileAndMergeTransactions(storeMap, [notifWithRemark]);
  storeMap = res2.nextMap;
  assert.equal(Object.keys(storeMap).length, 1, 'Must merge SMS and Notification with same Ref ID into 1 record');
  const mergedRec = Object.values(storeMap)[0];
  assert.equal(mergedRec.originalRemark, 'Team Lunch', 'Merged record must preserve remark from notification');
  assert.equal(mergedRec.note, 'Team Lunch');

  // 2b. Cross-source payment within 2 minutes WITHOUT Ref ID -> flagged as possible_duplicate
  const smsNoRef = migrateAndNormalizeExpenseRecord({
    id: 'sms_noref_1',
    amount: 85,
    type: 'debit',
    merchant: 'Chai Point',
    date: '2026-10-19',
    time: '10:30',
    timestampMs: ts1 + 600000,
    source: 'mobile-sms',
    refId: '',
  });
  const notifNoRef = migrateAndNormalizeExpenseRecord({
    id: 'notif_noref_1',
    amount: 85,
    type: 'debit',
    merchant: 'Chai Point',
    date: '2026-10-19',
    time: '10:31',
    timestampMs: ts1 + 660000,
    source: 'mobile-notification',
    refId: '',
  });
  let res3 = reconcileAndMergeTransactions(storeMap, [smsNoRef, notifNoRef]);
  storeMap = res3.nextMap;
  assert.equal(res3.duplicateFlaggedCount, 1, 'Second cross-source record without refId within 4 mins must be flagged as possible_duplicate');
  assert.equal(storeMap['notif_noref_1'].reconciliationStatus, 'possible_duplicate');
  assert.equal(storeMap['notif_noref_1'].duplicateOfId, 'sms_noref_1');

  // 2c. Two separate ₹85 payments 3 hours apart -> must NOT be merged or flagged as duplicate
  const laterTea = migrateAndNormalizeExpenseRecord({
    id: 'sms_noref_later',
    amount: 85,
    type: 'debit',
    merchant: 'Chai Point',
    date: '2026-10-19',
    time: '16:30',
    timestampMs: ts1 + 6 * 3600 * 1000,
    source: 'mobile-sms',
    refId: '',
  });
  let res4 = reconcileAndMergeTransactions(storeMap, [laterTea]);
  storeMap = res4.nextMap;
  assert.equal(storeMap['sms_noref_later'].reconciliationStatus, 'auto_detected', 'Separate payment hours later must not be flagged as duplicate');

  console.log('3. Testing Gross vs Net Spending, Refunds, Self-Transfers & Natural-Language Q&A...');

  // Add yesterday's expense, an income record, a high-value shopping expense, refund, self-transfer, and failed tx
  const yesterdayTx = migrateAndNormalizeExpenseRecord({
    id: 'tx_yest_1',
    amount: 320,
    type: 'debit',
    category: 'groceries',
    merchant: 'Fresh Mart',
    note: 'Milk & Vegetables',
    date: '2026-10-18',
    time: '18:15',
    timestampMs: new Date('2026-10-18T18:15:00').getTime(),
    source: 'manual-mobile',
  });
  const highValueTx = migrateAndNormalizeExpenseRecord({
    id: 'tx_high_1',
    amount: 1500,
    type: 'debit',
    category: 'shopping',
    merchant: 'Amazon India',
    note: '',
    noteReviewed: false,
    date: '2026-10-17',
    time: '14:00',
    timestampMs: new Date('2026-10-17T14:00:00').getTime(),
    source: 'mobile-sms',
  });
  const incomeTx = migrateAndNormalizeExpenseRecord({
    id: 'tx_inc_1',
    amount: 2500,
    type: 'credit',
    category: 'income',
    merchant: 'Client Bonus',
    note: 'Project Bonus',
    date: '2026-10-16',
    time: '11:00',
    timestampMs: new Date('2026-10-16T11:00:00').getTime(),
    source: 'mobile-sms',
  });

  const allRecords = [
    ...Object.values(storeMap),
    refundSms,
    selfTransferSms,
    failedSms,
    yesterdayTx,
    highValueTx,
    incomeTx,
  ];

  const stats = computeExpenseAnalytics(allRecords, {
    selectedMonth: '2026-10',
    todayIso: '2026-10-19',
    monthlyNetSalary: 25000,
  });

  // Confirmed expenses: 240 (Swiggy) + 85 (Chai Point morning) + 85 (Chai Point evening) + 320 (Fresh Mart) + 1500 (Amazon) = 2230
  // Note: notif_noref_1 (85) is possible_duplicate -> excluded!
  // Note: failedSms (899) is failed -> excluded!
  // Note: selfTransferSms (5000) is transfer -> excluded from spending!
  assert.equal(stats.grossExpenses, 2230, 'Gross expenses should exclude duplicates, failed txns, and self-transfers');
  assert.equal(stats.refundsTotal, 120, 'Refunds should be tracked');
  assert.equal(stats.netSpending, 2110, 'Net spending = Gross (2230) - Refunds (120) = 2110');
  assert.equal(stats.selfTransfersTotal, 5000, 'Self transfers tracked separately');
  assert.equal(stats.failedOrReversedTotal, 899, 'Failed payments tracked separately');
  assert.equal(stats.duplicatePendingCount, 1, '1 possible duplicate awaiting user review');
  assert.equal(stats.yesterdaySpent, 320, 'Yesterday spent should be 320');
  assert.equal(stats.weekReceived, 2500, 'Weekly received should be 2500');

  // Test Natural-Language Q&A queries (Phase 8)
  const q1 = answerNaturalLanguageFinanceQuery('How much did I spend yesterday?', allRecords, '2026-10-19');
  assert.match(q1.answer, /320\.00/);

  const q2 = answerNaturalLanguageFinanceQuery('How many transactions did I make this month?', allRecords, '2026-10-19');
  assert.match(q2.answer, /8 confirmed transactions/);

  const q3 = answerNaturalLanguageFinanceQuery('Show my food expenses.', allRecords, '2026-10-19');
  assert.match(q3.answer, /410\.00/);

  const q4 = answerNaturalLanguageFinanceQuery("Which payments don't have notes?", allRecords, '2026-10-19');
  assert.ok(q4.matchedIds.includes('tx_high_1'));

  const q5 = answerNaturalLanguageFinanceQuery('How much did I receive this week?', allRecords, '2026-10-19');
  assert.match(q5.answer, /2,500\.00/);

  const q6 = answerNaturalLanguageFinanceQuery('Find my transactions above ₹1,000.', allRecords, '2026-10-19');
  assert.ok(q6.matchedIds.includes('tx_high_1'));

  console.log('4. Testing Smart Merchant Suggestions, CSV Encoding & 500-Item Performance...');

  const sugg = suggestNotesAndCategoryForMerchant('Swiggy', allRecords);
  assert.ok(sugg.suggestedNotes.includes('Team Lunch'));
  assert.equal(sugg.suggestedCategory, 'food');

  const csv = formatTransactionsCsv(allRecords, stats);
  assert.match(csv, /Net Spending \(INR\),2110\.00/);
  assert.match(csv, /Team Lunch/);

  // 500-item stress test
  const largeList = [];
  for (let i = 0; i < 500; i++) {
    largeList.push({
      id: `bulk_${i}`,
      amount: 50 + (i % 200),
      type: i % 10 === 0 ? 'credit' : 'debit',
      merchant: `Merchant ${i % 25}`,
      note: i % 3 === 0 ? `Note ${i}` : '',
      category: 'food',
      date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
      time: '12:00',
      timestampMs: ts1 - i * 3600000,
    });
  }
  const t0 = Date.now();
  const largeStats = computeExpenseAnalytics(largeList, { selectedMonth: '2026-10', todayIso: '2026-10-19' });
  const elapsedMs = Date.now() - t0;
  assert.equal(largeStats.monthTxCount, 500);
  assert.ok(elapsedMs < 500, `500-transaction analytics should compute in <500ms (took ${elapsedMs}ms)`);

  console.log('All Expense Memory Unit & Integration Tests (Phases 1-12) Passed!');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
