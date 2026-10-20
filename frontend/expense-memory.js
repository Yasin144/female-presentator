// frontend/expense-memory.js
// First-Party Private Expense Memory Module & Android Keystore Encrypted Storage Bridge
// Strict Privacy Guarantees:
// 1. Zero network requests — Expense Memory is 100% local-only on the device.
// 2. Production transaction records use Android-Keystore-backed AES-256-GCM encrypted storage on Android.
//    Plaintext localStorage is NEVER used as the production transaction database.
// 3. Automatic notification capture requires explicit Android Notification Listener consent,
//    is restricted to an explicit allow-list of payment/banking package names, never persists full
//    raw notification bodies, and flags ambiguous/pending/failed notices as 'needs_review'.

import {
  EXPENSE_CATEGORIES,
  PAYMENT_APPS,
  PAYMENT_METHODS,
  QUICK_NOTE_TEMPLATES,
  parseSmsOrUpiTextJs,
  parseFinancialSmsOrNotification,
  migrateAndNormalizeExpenseRecord,
  reconcileAndMergeTransactions,
  suggestNotesAndCategoryForMerchant,
  computeExpenseAnalytics,
  answerNaturalLanguageFinanceQuery,
  formatTransactionsCsv,
  launchUpiPayment,
} from '../src/components/OtSalary/expenseMemoryEngine.js';

export const ALLOWED_PAYMENT_PACKAGES = Object.freeze([
  { pkg: 'com.google.android.apps.nbu.paisa.user', label: 'Google Pay (GPay)', appLabel: 'Google Pay (GPay)' },
  { pkg: 'com.phonepe.app', label: 'PhonePe', appLabel: 'PhonePe' },
  { pkg: 'net.one97.paytm', label: 'Paytm', appLabel: 'Paytm' },
  { pkg: 'in.org.npci.upiapp', label: 'BHIM UPI', appLabel: 'BHIM UPI' },
  { pkg: 'money.super.payments', label: 'Super.money', appLabel: 'Super.money' },
  { pkg: 'com.dreamplug.androidapp', label: 'CRED', appLabel: 'CRED' },
  { pkg: 'com.naviapp', label: 'Navi UPI', appLabel: 'Navi UPI' },
  { pkg: 'in.amazon.mShop.android.shopping', label: 'Amazon Pay', appLabel: 'Amazon Pay' },
  { pkg: 'com.whatsapp', label: 'WhatsApp Pay', appLabel: 'WhatsApp Pay' },
  { pkg: 'com.whatsapp.w4b', label: 'WhatsApp Business Pay', appLabel: 'WhatsApp Pay' },
  { pkg: 'com.mobikwik_new', label: 'MobiKwik', appLabel: 'MobiKwik' },
  { pkg: 'com.freecharge.android', label: 'Freecharge', appLabel: 'Freecharge' },
  { pkg: 'indwin.c3.shareapp', label: 'slice UPI', appLabel: 'slice UPI' },
  { pkg: 'com.fampay.in', label: 'FamPay', appLabel: 'FamPay' },
  { pkg: 'money.jupiter', label: 'Jupiter', appLabel: 'Jupiter' },
  { pkg: 'com.epifi.paisa', label: 'Fi Money', appLabel: 'Fi Money' },
  { pkg: 'com.tatadigital.tcp', label: 'Tata Neu UPI', appLabel: 'Tata Neu' },
  { pkg: 'org.altruist.BajajExperia', label: 'Bajaj Pay UPI', appLabel: 'Bajaj Pay' },
  { pkg: 'com.samsung.android.spay', label: 'Samsung Pay', appLabel: 'Samsung Pay' },
  { pkg: 'com.samsung.android.spaymini', label: 'Samsung Pay Mini', appLabel: 'Samsung Pay' },
  { pkg: 'com.myairtelapp', label: 'Airtel Thanks UPI', appLabel: 'Airtel Thanks' },
  { pkg: 'com.airtel.PaymentsBank', label: 'Airtel Payments Bank', appLabel: 'Airtel Payments Bank' },
  { pkg: 'com.jio.myjio', label: 'JioPay', appLabel: 'JioPay' },
  { pkg: 'com.snapwork.hdfc', label: 'HDFC Bank', appLabel: 'HDFC Bank' },
  { pkg: 'com.Snapwork.hdfc', label: 'HDFC Bank', appLabel: 'HDFC Bank' },
  { pkg: 'com.sbi.lotusintouch', label: 'SBI YONO', appLabel: 'SBI YONO' },
  { pkg: 'com.sbi.SBIFreedomPlus', label: 'SBI YONO Lite', appLabel: 'SBI YONO Lite' },
  { pkg: 'com.csam.icici.bank.imobile', label: 'ICICI iMobile Pay', appLabel: 'ICICI iMobile Pay' },
  { pkg: 'com.axis.mobile', label: 'Axis Mobile', appLabel: 'Axis Mobile' },
  { pkg: 'com.msf.kbank.mobile', label: 'Kotak Bank', appLabel: 'Kotak Bank' },
  { pkg: 'com.bankofbaroda.mconnect', label: 'Bank of Baroda', appLabel: 'Bank of Baroda' },
  { pkg: 'com.infrasofttech.CentralBank', label: 'Central Bank', appLabel: 'Central Bank' },
  { pkg: 'com.canarabank.mobility', label: 'Canara ai1', appLabel: 'Canara ai1' },
  { pkg: 'com.idfcfirstbank.optimus', label: 'IDFC FIRST Bank', appLabel: 'IDFC FIRST Bank' },
  { pkg: 'com.indusind.indie', label: 'IndusInd Bank', appLabel: 'IndusInd Bank' },
  { pkg: 'com.finopaymentbank.mobile', label: 'Fino Bank', appLabel: 'Fino Bank' },
  { pkg: 'com.Version1', label: 'PNB One', appLabel: 'PNB One' },
  { pkg: 'com.infrasoft.uboi', label: 'Union Bank', appLabel: 'Union Bank' },
  { pkg: 'com.fedmobile', label: 'Federal Bank', appLabel: 'Federal Bank' },
  { pkg: 'com.iris.yesbank', label: 'YES Bank', appLabel: 'YES Bank' },
  { pkg: 'com.ippb.mobilebanking', label: 'IPPB Mobile', appLabel: 'IPPB' },
  { pkg: 'com.google.android.apps.messaging', label: 'Bank/UPI SMS (Messages)', appLabel: 'Bank SMS' },
  { pkg: 'com.samsung.android.messaging', label: 'Bank/UPI SMS (Samsung)', appLabel: 'Bank SMS' },
  { pkg: 'com.android.mms', label: 'Bank/UPI SMS', appLabel: 'Bank SMS' },
]);

const ALLOWED_PACKAGE_SET = new Set(
  ALLOWED_PAYMENT_PACKAGES.map((p) => p.pkg.toLowerCase())
);

export function isAllowedPaymentPackage(packageName) {
  if (!packageName || typeof packageName !== 'string') return false;
  return ALLOWED_PACKAGE_SET.has(packageName.trim().toLowerCase());
}

/**
 * Clearly-labelled Demo Preview records.
 * Never written to the real encrypted statement or mixed with real transactions.
 */
export function buildDemoPreviewTransactions(todayOrMonthIso = '2026-10-19') {
  const str = String(todayOrMonthIso || '2026-10-19').trim();
  const ym = str.length >= 7 ? str.slice(0, 7) : '2026-10';
  const todayIso = str.length >= 10 ? str.slice(0, 10) : `${ym}-19`;
  const mkDemo = (raw) => ({
    ...migrateAndNormalizeExpenseRecord(raw),
    isDemoPreview: true,
    _demoPreview: true,
  });
  return {
    demo_tx_1: mkDemo({
      id: 'demo_tx_1',
      amount: 280,
      currency: 'INR',
      type: 'debit',
      status: 'completed',
      reconciliationStatus: 'auto_detected',
      merchant: 'Zomato',
      personalNote: '',
      paymentRemark: 'Order #49281',
      note: '',
      noteReviewed: false,
      category: 'food',
      paymentMethod: 'UPI',
      app: 'GPay',
      refId: '629218450112',
      date: todayIso,
      time: '14:20',
      timestampMs: new Date(`${todayIso}T14:20:00`).getTime() || Date.now() - 3600000,
      source: 'demo-preview',
      rawText: '',
    }),
    demo_tx_2: mkDemo({
      id: 'demo_tx_2',
      amount: 1200,
      currency: 'INR',
      type: 'debit',
      status: 'completed',
      reconciliationStatus: 'auto_detected',
      merchant: 'PhonePe - Rahul',
      personalNote: '',
      paymentRemark: '',
      note: '',
      noteReviewed: false,
      category: 'transfer',
      paymentMethod: 'UPI',
      app: 'PhonePe',
      refId: '629215331098',
      date: todayIso,
      time: '11:05',
      timestampMs: new Date(`${todayIso}T11:05:00`).getTime() || Date.now() - 7200000,
      source: 'demo-preview',
      rawText: '',
    }),
    demo_tx_3: mkDemo({
      id: 'demo_tx_3',
      amount: 699,
      currency: 'INR',
      type: 'debit',
      status: 'completed',
      reconciliationStatus: 'confirmed',
      merchant: 'Amazon',
      personalNote: 'Wireless headset & charging cable',
      paymentRemark: 'Amazon Pay Order',
      note: 'Wireless headset & charging cable',
      noteReviewed: true,
      category: 'shopping',
      paymentMethod: 'Card',
      app: 'Amazon Pay',
      refId: '629198220411',
      date: `${ym}-18`,
      time: '19:45',
      timestampMs: new Date(`${ym}-18T19:45:00`).getTime() || Date.now() - 86400000,
      source: 'demo-preview',
      rawText: '',
    }),
    demo_tx_4: mkDemo({
      id: 'demo_tx_4',
      amount: 25000,
      currency: 'INR',
      type: 'credit',
      status: 'completed',
      reconciliationStatus: 'confirmed',
      merchant: 'Salary Credited',
      personalNote: 'Monthly Office Salary Credited',
      paymentRemark: 'NEFT Salary Credit',
      note: 'Monthly Office Salary Credited',
      noteReviewed: true,
      category: 'income',
      paymentMethod: 'Bank Account',
      app: 'HDFC Bank',
      refId: '629001122334',
      date: `${ym}-17`,
      time: '10:15',
      timestampMs: new Date(`${ym}-17T10:15:00`).getTime() || Date.now() - 172800000,
      source: 'demo-preview',
      rawText: '',
    }),
    demo_tx_5: mkDemo({
      id: 'demo_tx_5',
      amount: 450,
      currency: 'INR',
      type: 'debit',
      status: 'completed',
      reconciliationStatus: 'confirmed',
      merchant: 'Swiggy Instamart',
      personalNote: 'Evening snacks, milk & fruits',
      paymentRemark: 'Groceries',
      note: 'Evening snacks, milk & fruits',
      noteReviewed: true,
      category: 'groceries',
      paymentMethod: 'UPI',
      app: 'Paytm',
      refId: '629176543210',
      date: `${ym}-17`,
      time: '18:30',
      timestampMs: new Date(`${ym}-17T18:30:00`).getTime() || Date.now() - 160000000,
      source: 'demo-preview',
      rawText: '',
    }),
    demo_tx_6: mkDemo({
      id: 'demo_tx_6',
      amount: 500,
      currency: 'INR',
      type: 'debit',
      status: 'completed',
      reconciliationStatus: 'confirmed',
      merchant: 'Indian Oil Fuel',
      personalNote: 'Bike petrol refill',
      paymentRemark: 'Fuel',
      note: 'Bike petrol refill',
      noteReviewed: true,
      category: 'fuel',
      paymentMethod: 'UPI',
      app: 'PhonePe',
      refId: '629165432199',
      date: `${ym}-16`,
      time: '09:30',
      timestampMs: new Date(`${ym}-16T09:30:00`).getTime() || Date.now() - 240000000,
      source: 'demo-preview',
      rawText: '',
    }),
    demo_tx_7: mkDemo({
      id: 'demo_tx_7',
      amount: 999,
      currency: 'INR',
      type: 'debit',
      status: 'completed',
      reconciliationStatus: 'auto_detected',
      merchant: 'Airtel Broadband',
      personalNote: '',
      paymentRemark: 'Monthly Wi-Fi Bill',
      note: '',
      noteReviewed: false,
      category: 'bills',
      paymentMethod: 'UPI',
      app: 'GPay',
      refId: '629154321088',
      date: `${ym}-15`,
      time: '12:10',
      timestampMs: new Date(`${ym}-15T12:10:00`).getTime() || Date.now() - 320000000,
      source: 'demo-preview',
      rawText: '',
    }),
    demo_tx_8: mkDemo({
      id: 'demo_tx_8',
      amount: 180,
      currency: 'INR',
      type: 'debit',
      status: 'completed',
      reconciliationStatus: 'confirmed',
      merchant: 'Uber Auto',
      personalNote: 'Office commute',
      paymentRemark: 'Uber Ride',
      note: 'Office commute',
      noteReviewed: true,
      category: 'fuel',
      paymentMethod: 'UPI',
      app: 'GPay',
      refId: '629143210977',
      date: `${ym}-14`,
      time: '09:50',
      timestampMs: new Date(`${ym}-14T09:50:00`).getTime() || Date.now() - 400000000,
      source: 'demo-preview',
      rawText: '',
    }),
  };
}

function hasNativeEncryptedBridge() {
  try {
    return Boolean(
      typeof window !== 'undefined' &&
        window.PattanBiometric &&
        typeof window.PattanBiometric.loadEncryptedExpenseStoreJson === 'function' &&
        typeof window.PattanBiometric.saveEncryptedExpenseStoreJson === 'function'
    );
  } catch (_) {
    return false;
  }
}

export function getExpenseStorageStatus() {
  try {
    if (hasNativeEncryptedBridge()) {
      const notifGranted =
        typeof window.PattanBiometric.isNotificationListenerEnabled === 'function'
          ? Boolean(window.PattanBiometric.isNotificationListenerEnabled())
          : false;
      return {
        ready: true,
        encrypted: true,
        encryptedReady: true,
        isNativeKeystore: true,
        setupRequired: false,
        notifGranted,
        mode: 'android-keystore-aes256-gcm',
        badgeText: '🔒 Android Keystore AES-256 Encrypted',
        reason: 'Transactions are stored in on-device Android Keystore AES-256-GCM encrypted storage.',
        detailText:
          'Transactions are stored exclusively in on-device Android Keystore AES-256-GCM encrypted storage with Android backup disabled.',
      };
    }
  } catch (_) {}

  return {
    ready: false,
    encrypted: false,
    encryptedReady: false,
    isNativeKeystore: false,
    setupRequired: true,
    notifGranted: false,
    mode: 'setup_required',
    badgeText: '⚠️ Encrypted Storage Setup Required',
    reason: 'Native Android Keystore encrypted storage is required for production transactions.',
    detailText:
      'Plaintext localStorage is disabled for production transaction storage. Install/open inside the Android app for hardware Android-Keystore AES-256-GCM encryption.',
  };
}

const FAKE_SEED_REF_IDS = new Set([
  'OTP1821202619',
  'SAL1013202612',
  '629400112211',
]);

function getDeletedExpenseIdsSet() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem('pattan.expenses.deletedIds');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr.map(String));
      }
    }
  } catch (_) {}
  return new Set();
}

/**
 * Loads the user's real transaction statement from Android Keystore AES-GCM encrypted storage.
 * Never reads from or writes to plaintext localStorage for production transactions.
 */
export function loadEncryptedExpenseStore() {
  try {
    if (hasNativeEncryptedBridge()) {
      const deletedSet = getDeletedExpenseIdsSet();
      const rawJson = window.PattanBiometric.loadEncryptedExpenseStoreJson();
      const cleanMap = {};
      if (rawJson && typeof rawJson === 'string') {
        const parsed = JSON.parse(rawJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [id, tx] of Object.entries(parsed)) {
            const keyStr = String(id || tx?.id || '');
            const refStr = String(tx?.refId || '').trim();
            if (
              !tx ||
              typeof tx !== 'object' ||
              tx._deleted ||
              deletedSet.has(keyStr) ||
              tx.isDemoPreview ||
              tx._demoPreview ||
              tx.source === 'demo-preview' ||
              keyStr.startsWith('demo_tx_') ||
              keyStr.endsWith('_salary') ||
              keyStr.endsWith('_ot_payout') ||
              (keyStr.startsWith('tx_yasin_master_') && FAKE_SEED_REF_IDS.has(refStr)) ||
              FAKE_SEED_REF_IDS.has(refStr)
            ) {
              continue;
            }
            const normalized = migrateAndNormalizeExpenseRecord({ ...tx, _deleted: false, rawText: '' });
            if (normalized) {
              delete normalized._deleted;
              cleanMap[id] = normalized;
            }
          }
        }
      }
      return {
        ok: true,
        ready: true,
        encrypted: true,
        expenses: cleanMap,
        expensesMap: cleanMap,
      };
    }
  } catch (_) {}
  return {
    ok: false,
    ready: false,
    encrypted: false,
    setupRequired: true,
    expenses: {},
    expensesMap: {},
  };
}

/**
 * Saves the user's real transaction statement to Android Keystore AES-GCM encrypted storage.
 * Fails closed when native encrypted storage is unavailable and NEVER writes to plaintext localStorage.
 */
export function saveEncryptedExpenseStore(expensesMap = {}) {
  if (!hasNativeEncryptedBridge()) {
    return {
      ok: false,
      encrypted: false,
      reason: 'ENCRYPTED_STORAGE_NOT_READY',
    };
  }

  const deletedSet = getDeletedExpenseIdsSet();
  const sanitizedMap = {};
  for (const [id, tx] of Object.entries(expensesMap || {})) {
    const keyStr = String(id || tx?.id || '');
    const refStr = String(tx?.refId || '').trim();
    if (
      !tx ||
      typeof tx !== 'object' ||
      tx._deleted ||
      deletedSet.has(keyStr) ||
      tx.isDemoPreview ||
      tx._demoPreview ||
      tx.source === 'demo-preview' ||
      keyStr.startsWith('demo_tx_') ||
      keyStr.endsWith('_salary') ||
      keyStr.endsWith('_ot_payout') ||
      (keyStr.startsWith('tx_yasin_master_') && FAKE_SEED_REF_IDS.has(refStr)) ||
      FAKE_SEED_REF_IDS.has(refStr)
    ) {
      continue;
    }
    // Never persist full raw notification text or _deleted flag in production storage
    const cleanTx = { ...tx, _deleted: false, rawText: '' };
    delete cleanTx._deleted;
    sanitizedMap[id] = cleanTx;
  }

  try {
    const saved = Boolean(
      window.PattanBiometric.saveEncryptedExpenseStoreJson(JSON.stringify(sanitizedMap))
    );
    return {
      ok: saved,
      encrypted: saved,
      reason: saved ? '' : 'NATIVE_SAVE_FAILED',
    };
  } catch (_) {
    return {
      ok: false,
      encrypted: false,
      reason: 'NATIVE_SAVE_ERROR',
    };
  }
}

export {
  EXPENSE_CATEGORIES,
  PAYMENT_APPS,
  PAYMENT_METHODS,
  QUICK_NOTE_TEMPLATES,
  parseSmsOrUpiTextJs,
  parseFinancialSmsOrNotification,
  migrateAndNormalizeExpenseRecord,
  reconcileAndMergeTransactions,
  suggestNotesAndCategoryForMerchant,
  computeExpenseAnalytics,
  answerNaturalLanguageFinanceQuery,
  formatTransactionsCsv,
  launchUpiPayment,
};
