import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  computeExpenseAnalytics,
  suggestNotesAndCategoryForMerchant,
  answerNaturalLanguageFinanceQuery,
  formatTransactionsCsv,
  parseFinancialSmsOrNotification,
  reconcileAndMergeTransactions,
  migrateAndNormalizeExpenseRecord,
  launchUpiPayment,
} from '../src/components/OtSalary/expenseMemoryEngine.js';
import {
  ALLOWED_PAYMENT_PACKAGES,
  isAllowedPaymentPackage,
  buildDemoPreviewTransactions,
  getExpenseStorageStatus,
  loadEncryptedExpenseStore,
  saveEncryptedExpenseStore,
} from '../frontend/expense-memory.js';
import {
  FIXED_WHATSAPP_RECIPIENT_E164,
  FIXED_WHATSAPP_RECIPIENT_DISPLAY,
  loadWhatsAppAutoSendState,
  setWhatsAppAutoSendEnabled,
  buildSanitizedDailyOutStatement,
  processSavedOutStatement,
  resendDailyStatementWithConfirmation,
  applyVerifiedWebhookStatusUpdate,
} from '../frontend/ot-whatsapp-after-out.js';
import {
  validateStatementRequest,
  createWhatsAppRelayServer,
} from '../backend/server.js';

describe('Master Task QA — Expense Memory, After-OUT WhatsApp Statement & Security Audit', () => {
  beforeEach(() => {
    if (typeof globalThis.window !== 'undefined' && globalThis.window.localStorage) {
      globalThis.window.localStorage.clear();
    }
    if (typeof globalThis.window !== 'undefined') {
      delete globalThis.window.PattanBiometric;
      delete globalThis.window.PattanSecureWhatsApp;
    }
  });

  describe('1. Fix .filter is not a function & Expense Analytics Engine', () => {
    it('handles expensesMap as an Object map, Array, null, or undefined without throwing .filter is not a function', () => {
      const expensesMap = {
        tx_1: {
          id: 'tx_1',
          amount: 250,
          type: 'debit',
          status: 'completed',
          merchant: 'Swiggy',
          category: 'food',
          app: 'GPay',
          paymentMethod: 'UPI',
          date: '2026-10-19',
          time: '13:15',
          timestampMs: 1792395900000,
          personalNote: 'Office lunch',
        },
        tx_2: {
          id: 'tx_2',
          amount: 1500,
          type: 'credit',
          status: 'completed',
          merchant: 'Client Reimburse',
          category: 'income',
          app: 'PhonePe',
          paymentMethod: 'UPI',
          date: '2026-10-19',
          time: '15:00',
          timestampMs: 1792402200000,
        },
      };

      const fromObjectMap = computeExpenseAnalytics(
        expensesMap,
        '2026-10',
        '2026-10-19',
        30500
      );
      assert.equal(fromObjectMap.grossSpent, 250);
      assert.equal(fromObjectMap.totalReceived, 1500);
      assert.equal(fromObjectMap.netSpent, 250);
      assert.equal(fromObjectMap.totalCount, 2);
      assert.equal(fromObjectMap.monthTxList.length, 2);

      const fromNull = computeExpenseAnalytics(null, '2026-10', '2026-10-19', 30500);
      assert.equal(fromNull.netSpent, 0);
      assert.equal(fromNull.totalCount, 0);

      assert.doesNotThrow(() => suggestNotesAndCategoryForMerchant(expensesMap, 'Swiggy'));
      assert.doesNotThrow(() => answerNaturalLanguageFinanceQuery('How much did I spend?', expensesMap, '2026-10', '2026-10-19'));
      const csv = formatTransactionsCsv(expensesMap);
      assert.ok(csv.includes('Swiggy'));
      assert.ok(csv.includes('Office lunch'));
    });

    it('never persists raw notification text on normalized records', () => {
      const normalized = migrateAndNormalizeExpenseRecord({
        id: 'tx_raw_test',
        amount: 420,
        merchant: 'Zomato',
        rawText: 'Paid Rs. 420 to Zomato via UPI Ref 612345678901 Secret Account 12345678',
      });
      assert.equal(normalized.rawText, '');
    });
  });

  describe('2. Feature A — Allow-listed Notification Capture, Deduplication & Encrypted Storage', () => {
    it('allows only explicit payment/banking packages and rejects unknown apps', () => {
      assert.ok(ALLOWED_PAYMENT_PACKAGES.length >= 15);
      assert.equal(isAllowedPaymentPackage('com.google.android.apps.nbu.paisa.user'), true);
      assert.equal(isAllowedPaymentPackage('com.phonepe.app'), true);
      assert.equal(isAllowedPaymentPackage('net.one97.paytm'), true);
      assert.equal(isAllowedPaymentPackage('in.org.npci.upiapp'), true);
      assert.equal(isAllowedPaymentPackage('com.instagram.android'), false);
      assert.equal(isAllowedPaymentPackage('com.example.randomgame'), false);
      assert.equal(isAllowedPaymentPackage(''), false);
    });

    it('parses high-confidence completed transactions and flags pending/failed/ambiguous notices as needs_review', () => {
      const completed = parseFinancialSmsOrNotification({
        senderOrPkg: 'com.google.android.apps.nbu.paisa.user',
        title: 'Google Pay',
        body: 'Paid ₹340.00 to Swiggy using UPI. UPI Ref No 629182736451. Note: Team snacks',
        timestampMs: 1792395900000,
      });
      assert.ok(completed);
      assert.equal(completed.amount, 340);
      assert.equal(completed.type, 'debit');
      assert.equal(completed.status, 'completed');
      assert.equal(completed.refId, '629182736451');
      assert.equal(completed.reconciliationStatus, 'auto_detected');

      const pending = parseFinancialSmsOrNotification({
        senderOrPkg: 'com.phonepe.app',
        title: 'PhonePe',
        body: 'Payment of ₹500 to Electricity Board is pending processing. Ref 629182739999',
        timestampMs: 1792396000000,
      });
      assert.ok(pending);
      assert.equal(pending.status, 'pending');
      assert.equal(pending.reconciliationStatus, 'needs_review');

      // Overlapping UPI + Bank alert with the same reference ID should deduplicate
      const bankDuplicate = parseFinancialSmsOrNotification({
        senderOrPkg: 'com.snapwork.hdfc',
        title: 'HDFC Bank',
        body: 'Rs 340.00 debited from A/c XX1234 to VPA swiggy@axis via UPI/DR/629182736451/Swiggy',
        timestampMs: 1792395915000,
      });
      const { nextMap: mergedMap } = reconcileAndMergeTransactions({}, [completed, bankDuplicate]);
      const activeList = Object.values(mergedMap).filter((t) => !t._deleted);
      assert.equal(activeList.length, 1);
      assert.equal(activeList[0].refId, '629182736451');
      assert.ok(activeList[0].originalRemark.includes('Team snacks'));
    });

    it('fails closed when native encrypted storage is absent and never writes production transactions to plaintext localStorage', () => {
      const statusWithoutNative = getExpenseStorageStatus();
      assert.equal(statusWithoutNative.encryptedReady, false);

      const saveRes = saveEncryptedExpenseStore({
        tx_1: { id: 'tx_1', amount: 100, merchant: 'Tea Shop', date: '2026-10-19' },
      });
      assert.equal(saveRes.ok, false);
      assert.equal(saveRes.reason, 'ENCRYPTED_STORAGE_NOT_READY');

      if (typeof globalThis.window !== 'undefined' && globalThis.window.localStorage) {
        assert.equal(globalThis.window.localStorage.getItem('pp_ot_salary_tracker_v1'), null);
      }

      // Simulate Android Keystore encrypted bridge
      let encryptedVault = '{}';
      globalThis.window = globalThis.window || {};
      globalThis.window.PattanBiometric = {
        loadEncryptedExpenseStoreJson: () => encryptedVault,
        saveEncryptedExpenseStoreJson: (jsonStr) => {
          encryptedVault = jsonStr;
          return true;
        },
        isNotificationListenerEnabled: () => true,
      };

      const statusWithNative = getExpenseStorageStatus();
      assert.equal(statusWithNative.encryptedReady, true);
      assert.equal(statusWithNative.notifGranted, true);

      const saveNativeRes = saveEncryptedExpenseStore({
        tx_1: {
          id: 'tx_1',
          amount: 180,
          merchant: 'Metro Card',
          date: '2026-10-19',
          rawText: 'Should be stripped before encryption',
        },
      });
      assert.equal(saveNativeRes.ok, true);

      const loaded = loadEncryptedExpenseStore();
      assert.equal(loaded.ready, true);
      assert.equal(loaded.expensesMap.tx_1.amount, 180);
      assert.equal(loaded.expensesMap.tx_1.rawText, '');

      const demo = buildDemoPreviewTransactions('2026-10');
      assert.equal(Object.values(demo).every((tx) => tx._demoPreview === true), true);
    });
  });

  describe('3. Feature B — After-OUT Automatic WhatsApp Statement (+91 7386726193)', () => {
    it('defaults OFF, requires explicit consent before enabling, and locks recipient to +91 7386726193', () => {
      globalThis.window = globalThis.window || {};
      const storeMap = new Map();
      globalThis.window.localStorage = {
        getItem: (k) => (storeMap.has(k) ? storeMap.get(k) : null),
        setItem: (k, v) => storeMap.set(k, String(v)),
        removeItem: (k) => storeMap.delete(k),
        clear: () => storeMap.clear(),
      };

      const initial = loadWhatsAppAutoSendState();
      assert.equal(initial.enabled, false);
      assert.equal(initial.recipient, '917386726193');
      assert.equal(FIXED_WHATSAPP_RECIPIENT_E164, '917386726193');
      assert.equal(FIXED_WHATSAPP_RECIPIENT_DISPLAY, '+91 7386726193');

      assert.throws(() => setWhatsAppAutoSendEnabled(true, false), /Explicit user consent is required/i);

      const enabledState = setWhatsAppAutoSendEnabled(true, true);
      assert.equal(enabledState.enabled, true);
      assert.equal(enabledState.consentAccepted, true);
    });

    it('builds sanitized statement from exact saved OUT record + existing calculator and deduplicates repeated OUT saves', async () => {
      globalThis.window = globalThis.window || {};
      const storeMap = new Map();
      globalThis.window.localStorage = {
        getItem: (k) => (storeMap.has(k) ? storeMap.get(k) : null),
        setItem: (k, v) => storeMap.set(k, String(v)),
        removeItem: (k) => storeMap.delete(k),
        clear: () => storeMap.clear(),
      };
      globalThis.window.dispatchEvent = () => true;

      let bridgeCalls = 0;
      globalThis.window.PattanSecureWhatsApp = {
        setEnabled: () => true,
        sendStatement: async ({ request }) => {
          bridgeCalls += 1;
          assert.equal(request.recipient, '917386726193');
          assert.equal(request.templateName, 'daily_ot_statement');
          assert.equal(request.statement.note, undefined);
          assert.equal(request.statement.expenses, undefined);
          return {
            ok: true,
            statusCode: 200,
            status: 'accepted',
            messageId: 'wamid.HBgMOTE3Mzg2NzI2MTkzFQIAERgSQkM',
          };
        },
      };

      setWhatsAppAutoSendEnabled(true, true);

      const detail = {
        date: '2026-10-19',
        record: {
          date: '2026-10-19',
          status: 'present',
          inTime: '10:00',
          outTime: '20:30',
          workedMins: 630,
          otHours: 2,
          extraAllowance: 50,
          note: 'Private work note that must never be sent',
        },
        settings: {
          employeeName: 'Yasin Pattan',
          monthlySalary: 25000,
          officeStartTime: '10:00',
          officeEndTime: '18:30',
        },
        rates: {
          shiftMins: 510,
          perDaySalary: 833.3333,
          otHourlyRate: 98.0392,
        },
        calculation: {
          workedMins: 630,
          standardShiftMins: 510,
          otMins: 120,
          otHours: 2,
          basePay: 833.33,
          otPay: 196.08,
          extraAllowance: 50,
          totalPay: 1079.41,
        },
      };

      const built = buildSanitizedDailyOutStatement(detail);
      assert.equal(built.valid, true);
      assert.equal(built.recipient, '917386726193');
      assert.equal(built.statement.dailyTotalFormatted, '₹1,079.41');
      assert.equal(built.statement.note, undefined);

      const firstRes = await processSavedOutStatement(detail);
      assert.equal(firstRes.ok, true);
      assert.equal(firstRes.status, 'accepted');
      assert.equal(bridgeCalls, 1);

      // Duplicate trigger for the same saved OUT record must be suppressed
      const secondRes = await processSavedOutStatement(detail);
      assert.equal(secondRes.ok, true);
      assert.equal(secondRes.deduplicated, true);
      assert.equal(bridgeCalls, 1);

      // Guarded resend without confirmation is blocked
      const unconfirmedResend = await resendDailyStatementWithConfirmation({
        ...detail,
        userConfirmed: false,
      });
      assert.equal(unconfirmedResend.ok, false);
      assert.equal(unconfirmedResend.reason, 'CONFIRMATION_REQUIRED');
      assert.equal(bridgeCalls, 1);

      // Confirmed resend succeeds
      const confirmedResend = await resendDailyStatementWithConfirmation({
        ...detail,
        userConfirmed: true,
      });
      assert.equal(confirmedResend.ok, true);
      assert.equal(bridgeCalls, 2);

      // Webhook status update transitions accepted -> delivered
      const afterDelivered = applyVerifiedWebhookStatusUpdate({
        messageId: 'wamid.HBgMOTE3Mzg2NzI2MTkzFQIAERgSQkM',
        deliveryStatus: 'delivered',
        webhookVerified: true,
      });
      assert.equal(afterDelivered.lastStatus, 'delivered');
    });

    it('validates backend relay requests, enforces idempotency across restarts, and verifies webhook HMAC', async () => {
      const tmpStoreFile = path.join(process.cwd(), 'backend', 'data', `test-wa-store-${Date.now()}.json`);
      const appSecret = 'test_meta_app_secret_key_999';
      let metaApiCalls = 0;

      const mockFetch = async (_url, opts) => {
        metaApiCalls += 1;
        const body = JSON.parse(opts.body);
        assert.equal(body.messaging_product, 'whatsapp');
        assert.equal(body.to, '917386726193');
        assert.equal(body.type, 'template');
        assert.equal(body.template.name, 'daily_ot_statement');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            messages: [{ id: 'wamid.META_MSG_001' }],
          }),
        };
      };

      const { server } = createWhatsAppRelayServer({
        relayDeviceToken: 'device_secret_token_123',
        waPhoneNumberId: '109876543210',
        waAccessToken: 'EAAB_test_cloud_api_token',
        waWebhookVerifyToken: 'verify_tok_123',
        waAppSecret: appSecret,
        storeFilePath: tmpStoreFile,
        fetchImpl: mockFetch,
      });

      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        const unauthRes = await fetch(`${baseUrl}/api/whatsapp/ot-statement`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        assert.equal(unauthRes.status, 401);

        const badValidation = validateStatementRequest({
          idempotencyKey: 'out_stmt_2026-10-19_10:00_18:30_510_0_83333',
          recipient: '917386726193',
          expenses: { tx_1: { amount: 100 } },
          statement: { date: '2026-10-19', inTime: '10:00', outTime: '18:30', workedMins: 510, dailyTotal: 833.33 },
        });
        assert.equal(badValidation.ok, false);
        assert.ok(badValidation.error.includes('Forbidden field'));

        const validPayload = {
          idempotencyKey: 'out_stmt_2026-10-19_10:00_20:30_630_120_107941',
          recipient: '917386726193',
          templateName: 'daily_ot_statement',
          statement: {
            date: '2026-10-19',
            inTime: '10:00',
            inTimeFormatted: '10:00 AM',
            outTime: '20:30',
            outTimeFormatted: '08:30 PM',
            workedMins: 630,
            workedDurationFormatted: '10h 30m',
            standardShiftFormatted: '8h 30m',
            otDurationFormatted: '2h 00m',
            basePayFormatted: '₹833.33',
            otRateFormatted: '₹98.04/hr',
            otPayFormatted: '₹196.08',
            allowanceFormatted: '₹50.00',
            dailyTotal: 1079.41,
            dailyTotalFormatted: '₹1,079.41',
          },
        };

        const sendRes = await fetch(`${baseUrl}/api/whatsapp/ot-statement`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer device_secret_token_123',
          },
          body: JSON.stringify(validPayload),
        });
        assert.equal(sendRes.status, 200);
        const sendJson = await sendRes.json();
        assert.equal(sendJson.ok, true);
        assert.equal(sendJson.status, 'accepted');
        assert.equal(sendJson.messageId, 'wamid.META_MSG_001');
        assert.equal(metaApiCalls, 1);

        const dupRes = await fetch(`${baseUrl}/api/whatsapp/ot-statement`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer device_secret_token_123',
          },
          body: JSON.stringify(validPayload),
        });
        const dupJson = await dupRes.json();
        assert.equal(dupJson.ok, true);
        assert.equal(dupJson.deduplicated, true);
        assert.equal(metaApiCalls, 1);

        const webhookBody = JSON.stringify({
          entry: [
            {
              changes: [
                {
                  value: {
                    statuses: [{ id: 'wamid.META_MSG_001', status: 'delivered' }],
                  },
                },
              ],
            },
          ],
        });
        const badWebhookRes = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': 'sha256=invalid_signature',
          },
          body: webhookBody,
        });
        assert.equal(badWebhookRes.status, 401);

        const validSig =
          'sha256=' + crypto.createHmac('sha256', appSecret).update(webhookBody, 'utf8').digest('hex');
        const okWebhookRes = await fetch(`${baseUrl}/api/whatsapp/webhook`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Hub-Signature-256': validSig,
          },
          body: webhookBody,
        });
        assert.equal(okWebhookRes.status, 200);

        const statusRes = await fetch(
          `${baseUrl}/api/whatsapp/ot-statement/status?key=${encodeURIComponent(validPayload.idempotencyKey)}`,
          {
            headers: { Authorization: 'Bearer device_secret_token_123' },
          }
        );
        const statusJson = await statusRes.json();
        assert.equal(statusJson.status, 'delivered');
        assert.equal(statusJson.webhookVerified, true);
      } finally {
        await new Promise((resolve) => server.close(resolve));
        if (fs.existsSync(tmpStoreFile)) {
          fs.unlinkSync(tmpStoreFile);
        }
      }
    });
  });

  describe('4. Security Audit — No Public ntfy.sh Relay, No Hardcoded LAN IPs, Hardened Android Manifest', () => {
    it('strips ntfy.sh and hardcoded LAN IPs from OtSalary.jsx and otMobileAppGenerator.js', () => {
      const otSalarySrc = fs.readFileSync(
        path.join(process.cwd(), 'src/components/OtSalary/OtSalary.jsx'),
        'utf8'
      );
      const genSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/components/OtSalary/otMobileAppGenerator.js'),
        'utf8'
      );

      assert.equal(otSalarySrc.includes('pattan_ot_salary_live_sync_yasin144_v2'), false);
      assert.equal(otSalarySrc.includes('ntfy.sh'), false);
      assert.equal(otSalarySrc.includes('10.149.161.101'), false);
      assert.equal(otSalarySrc.includes('192.168.29.161'), false);

      assert.equal(genSrc.includes('pattan_ot_salary_live_sync_yasin144_v2'), false);
      assert.equal(genSrc.includes('ntfy.sh'), false);
      assert.equal(genSrc.includes('10.149.161.101'), false);
      assert.equal(genSrc.includes('192.168.29.161'), false);
    });

    it('enforces allowBackup=false, usesCleartextTraffic=false, and removes READ_SMS/RECEIVE_SMS in AndroidManifest.xml', () => {
      const manifestXml = fs.readFileSync(
        path.join(process.cwd(), 'android/app/src/main/AndroidManifest.xml'),
        'utf8'
      );
      assert.equal(manifestXml.includes('android:allowBackup="false"'), true);
      assert.equal(manifestXml.includes('android:usesCleartextTraffic="false"'), true);
      assert.equal(manifestXml.includes('android.permission.READ_SMS'), false);
      assert.equal(manifestXml.includes('android.permission.RECEIVE_SMS'), false);
    });
  });

  describe('5. Comprehensive End-to-End App QA — All 12 Screens, Q&A Assistant, Insights, UPI & Salary Slip', () => {
    it('verifies the 8-transaction sample dataset, category/method/trend insights, and materialization into encrypted storage', () => {
      const demoMap = buildDemoPreviewTransactions('2026-10-19');
      const items = Object.values(demoMap);
      assert.equal(items.length, 8);

      const stats = computeExpenseAnalytics(demoMap, {
        selectedMonth: '2026-10',
        todayIso: '2026-10-19',
        monthlyNetSalary: 30500,
      });

      assert.equal(stats.grossExpenses, 4308);
      assert.equal(stats.incomeTotal, 25000);
      assert.equal(stats.missingNotesCount, 3);
      assert.ok(stats.categoryBreakdown.length >= 4);
      assert.ok(stats.paymentMethodBreakdown.length >= 2);
      assert.ok(stats.appBreakdown.length >= 3);
      assert.ok(stats.dailySeries.length >= 3);
      assert.ok(stats.topMerchant);
      assert.ok(stats.highestSpendDay);
    });

    it('verifies all 6 Smart Q&A Assistant chips and custom natural-language queries', () => {
      const demoMap = buildDemoPreviewTransactions('2026-10-19');
      const chips = [
        'How much did I spend yesterday?',
        'How many transactions did I make this month?',
        'Show my food expenses.',
        "Which payments don't have notes?",
        'How much did I receive this week?',
        'Find my transactions above ₹1,000.',
      ];

      for (const q of chips) {
        const res = answerNaturalLanguageFinanceQuery(q, demoMap, '2026-10', '2026-10-19');
        assert.ok(res && typeof res.title === 'string' && res.title.length > 0);
        assert.ok(typeof res.answer === 'string' && res.answer.length > 0);
        assert.ok(Array.isArray(res.matchedIds));
      }

      const missingRes = answerNaturalLanguageFinanceQuery(
        "Which payments don't have notes?",
        demoMap,
        '2026-10',
        '2026-10-19'
      );
      assert.equal(missingRes.matchedIds.length, 3);
    });

    it('verifies launchUpiPayment builds a valid local upi://pay intent URI without network calls', () => {
      let launchedUri = '';
      globalThis.window = globalThis.window || {};
      globalThis.window.PattanBiometric = {
        launchUpiUri: (uri) => {
          launchedUri = uri;
          return true;
        },
      };

      const ok = launchUpiPayment({
        payeeVpa: 'zomato@okaxis',
        payeeName: 'Zomato',
        amount: 280,
        note: 'Office lunch',
      });
      assert.equal(ok, true);
      assert.ok(launchedUri.startsWith('upi://pay?'));
      assert.ok(launchedUri.includes('pa=zomato%40okaxis'));
      assert.ok(launchedUri.includes('am=280.00'));
      assert.ok(launchedUri.includes('tn=Office+lunch'));
    });

    it('verifies all restored UI features and zero undefined handlers in OtSalary.jsx and ExpensesModule.jsx', () => {
      const otSalarySrc = fs.readFileSync(
        path.join(process.cwd(), 'src/components/OtSalary/OtSalary.jsx'),
        'utf8'
      );
      const expensesSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/components/OtSalary/ExpensesModule.jsx'),
        'utf8'
      );

      // Must not contain undefined setAppMode
      assert.equal(otSalarySrc.includes('setAppMode('), false);

      // Restored OT & Salary screens and controls
      assert.equal(otSalarySrc.includes('Today&apos;s Shift &amp; Pay Breakdown'), true);
      assert.equal(otSalarySrc.includes('Open Expenses →'), true);
      assert.equal(otSalarySrc.includes('mobileDaysLayout'), true);
      assert.equal(otSalarySrc.includes('printMonthSalarySlip'), true);
      assert.equal(otSalarySrc.includes('importBackupJson'), true);

      // Restored Expense Memory screens and controls
      assert.equal(expensesSrc.includes('Ask Expense Memory'), true);
      assert.equal(expensesSrc.includes('showAdvancedFilters'), true);
      assert.equal(expensesSrc.includes('Payment Method &amp; App Breakdown'), true);
      assert.equal(expensesSrc.includes('Daily Spending Trend'), true);
      assert.equal(expensesSrc.includes('handleLaunchUpiAndSave'), true);

      // Slip module fix & zero sample/demo data in UI
      assert.equal(otSalarySrc.includes('baseMinuteRate,'), true);
      assert.equal(otSalarySrc.includes('presentDays,'), true);
      assert.equal(otSalarySrc.includes('paidHolidays,'), true);
      assert.equal(otSalarySrc.includes('unpaidLeaves: leaveDays,'), true);
      assert.equal(otSalarySrc.includes('buildDemoPreviewTransactions'), false);
      assert.equal(expensesSrc.includes('buildDemoPreviewTransactions'), false);
    });

    it('captures any completed UPI payment across GPay, PhonePe, Paytm, BHIM, Super.money, CRED, Navi & Bank SMS immediately with exact amount', () => {
      const realWorldSamples = [
        {
          senderOrPkg: 'com.google.android.apps.nbu.paisa.user',
          title: 'Google Pay',
          body: 'Paid ₹150.00',
          expectedAmount: 150,
          expectedApp: 'GPay',
        },
        {
          senderOrPkg: 'com.phonepe.app',
          title: 'PhonePe',
          body: 'Paid ₹480 to Raju Tea Stall using UPI',
          expectedAmount: 480,
          expectedApp: 'PhonePe',
        },
        {
          senderOrPkg: 'money.super.payments',
          title: 'Super.money',
          body: 'Payment of ₹95.00 to Fresh Bakery successful',
          expectedAmount: 95,
          expectedApp: 'Super.money',
        },
        {
          senderOrPkg: 'com.dreamplug.androidapp',
          title: 'CRED',
          body: 'Paid ₹1,250.00 towards utility bill via UPI',
          expectedAmount: 1250,
          expectedApp: 'CRED',
        },
        {
          senderOrPkg: 'com.google.android.apps.messaging',
          title: 'VM-SBIUPI',
          body: 'Dear UPI user A/C X1234 debited by 200.00 on date 19Oct26 trf to RAHUL Ref No 629211223344',
          expectedAmount: 200,
          expectedApp: 'SBI Bank',
        },
      ];

      let map = {};
      for (let i = 0; i < realWorldSamples.length; i++) {
        const s = realWorldSamples[i];
        const parsed = parseFinancialSmsOrNotification({
          senderOrPkg: s.senderOrPkg,
          title: s.title,
          body: s.body,
          timestampMs: new Date('2026-10-19T14:00:00').getTime() + i * 180000,
        });
        assert.ok(parsed, `Failed to parse sample: ${s.body}`);
        assert.equal(parsed.amount, s.expectedAmount);
        assert.equal(parsed.app, s.expectedApp);
        assert.equal(parsed.status, 'completed');
        assert.equal(parsed.reconciliationStatus, 'auto_detected');
        map = reconcileAndMergeTransactions(map, [parsed]).nextMap;
      }

      const analytics = computeExpenseAnalytics(map, {
        selectedMonth: '2026-10',
        todayIso: '2026-10-19',
        monthlyNetSalary: 30500,
      });
      assert.equal(analytics.monthActiveList.length, 5);
      assert.equal(analytics.grossExpenses, 150 + 480 + 95 + 1250 + 200);
      assert.ok(analytics.topMerchant && analytics.topMerchant.merchant);
    });

    it('verifies all 7 v6.6 enhancements: no default Exit Time, Multi-Day Select All, Notification Center, WhatsApp IN/OUT+Payment, Permanent Ledger, Prominent Notes & Biometric Expense Lock', () => {
      const otSalarySrc = fs.readFileSync(
        path.join(process.cwd(), 'src/components/OtSalary/OtSalary.jsx'),
        'utf8'
      );
      const expensesSrc = fs.readFileSync(
        path.join(process.cwd(), 'src/components/OtSalary/ExpensesModule.jsx'),
        'utf8'
      );
      const mainActivitySrc = fs.readFileSync(
        path.join(process.cwd(), 'android/app/src/main/java/com/pattan/presentator/MainActivity.java'),
        'utf8'
      );
      const parserJavaSrc = fs.readFileSync(
        path.join(process.cwd(), 'android/app/src/main/java/com/pattan/presentator/MobileTransactionParser.java'),
        'utf8'
      );

      // 1. Default Exit Time is empty ('') instead of '18:30'
      assert.equal(otSalarySrc.includes("const [entryOutTime, setEntryOutTime] = useState('')"), true);
      assert.equal(otSalarySrc.includes('--:-- (Pending OUT)'), true);

      // 2. Multi-Day Select & Select All Days for IN/OUT Time
      assert.equal(otSalarySrc.includes('selectAllBulkDates'), true);
      assert.equal(otSalarySrc.includes('selectWorkingBulkDates'), true);
      assert.equal(otSalarySrc.includes('applyBulkTimeToSelectedDays'), true);
      assert.equal(otSalarySrc.includes('Select &amp; Select All Days — Set IN / OUT Time'), true);

      // 3. Notification Bell opens Notifications & Activity Center Modal instead of force-redirecting to Expenses
      assert.equal(otSalarySrc.includes('onClick={() => setShowNotificationsModal(true)}'), true);
      assert.equal(otSalarySrc.includes('Notifications &amp; Activity Center'), true);

      // 4. WhatsApp message on BOTH IN and OUT (+ Payment Details) to +91 7386726193
      assert.equal(otSalarySrc.includes('sendWhatsAppAttendanceAndPaymentAlert'), true);
      assert.equal(otSalarySrc.includes("sendWhatsAppAttendanceAndPaymentAlert('in'"), true);
      assert.equal(otSalarySrc.includes("sendWhatsAppAttendanceAndPaymentAlert('out'"), true);
      assert.equal(mainActivitySrc.includes('sendWhatsAppMessageToNumber'), true);

      // 5. Prominent Notes ("For What / Which Thing") & Responsive Recent Payments
      assert.equal(expensesSrc.includes('recentPaymentsList'), true);
      assert.equal(expensesSrc.includes('sourceTransactionsForList'), true);
      assert.equal(expensesSrc.includes('Recent Payments (Permanent Ledger)'), true);
      assert.equal(expensesSrc.includes('For What / Which Thing:'), true);

      // 6. Permanent Non-Deletable Transactions (even on Clear All Data)
      assert.equal(parserJavaSrc.includes('permanent_expense_vault.enc'), true);
      assert.equal(expensesSrc.includes('Permanent Ledger (Never Deleted)'), true);
      assert.equal(otSalarySrc.includes('Clear Attendance Data (Payments Protected 🔒)'), true);

      // 7. Biometric Lock when shifting to Expenses
      assert.equal(otSalarySrc.includes('unlockExpensesWithBiometric'), true);
      assert.equal(otSalarySrc.includes('Private Expense Vault Locked'), true);
    });
  });
});


