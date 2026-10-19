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
} from '../src/components/OtSalary/expenseMemoryEngine.js';

export const ALLOWED_PAYMENT_PACKAGES = Object.freeze([
  { pkg: 'com.google.android.apps.nbu.paisa.user', label: 'Google Pay (GPay)', appLabel: 'Google Pay (GPay)' },
  { pkg: 'com.phonepe.app', label: 'PhonePe', appLabel: 'PhonePe' },
  { pkg: 'net.one97.paytm', label: 'Paytm', appLabel: 'Paytm' },
  { pkg: 'in.org.npci.upiapp', label: 'BHIM UPI', appLabel: 'BHIM UPI' },
  { pkg: 'in.amazon.mShop.android.shopping', label: 'Amazon Pay', appLabel: 'Amazon Pay' },
  { pkg: 'com.dreamplug.androidapp', label: 'CRED', appLabel: 'CRED' },
  { pkg: 'com.whatsapp', label: 'WhatsApp Pay', appLabel: 'WhatsApp Pay' },
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
  { pkg: 'com.airtel.PaymentsBank', label: 'Airtel Payments Bank', appLabel: 'Airtel Payments Bank' },
  { pkg: 'com.jio.myjio', label: 'JioPay', appLabel: 'JioPay' },
  { pkg: 'com.mobikwik_new', label: 'MobiKwik', appLabel: 'MobiKwik' },
  { pkg: 'com.freecharge.android', label: 'Freecharge', appLabel: 'Freecharge' },
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
      amount: 350,
      currency: 'INR',
      type: 'debit',
      status: 'completed',
      reconciliationStatus: 'confirmed',
      merchant: 'Sreeram Traders (DEMO)',
      personalNote: 'Office lunch with team (Demo Preview)',
      paymentRemark: 'Team Lunch',
      note: 'Office lunch with team (Demo Preview)',
      category: 'food',
      paymentMethod: 'UPI',
      app: 'GPay',
      refId: 'DEMO62810242356',
      date: todayIso,
      time: '13:30',
      timestampMs: new Date(`${todayIso}T13:30:00`).getTime() || Date.now() - 3600000,
      source: 'demo-preview',
      rawText: '',
    }),
    demo_tx_2: mkDemo({
      id: 'demo_tx_2',
      amount: 500,
      currency: 'INR',
      type: 'debit',
      status: 'completed',
      reconciliationStatus: 'confirmed',
      merchant: 'Indian Oil Fuel (DEMO)',
      personalNote: 'Bike petrol refill (Demo Preview)',
      paymentRemark: 'Fuel',
      note: 'Bike petrol refill (Demo Preview)',
      category: 'fuel',
      paymentMethod: 'UPI',
      app: 'PhonePe',
      refId: 'DEMO62810241102',
      date: todayIso,
      time: '09:45',
      timestampMs: new Date(`${todayIso}T09:45:00`).getTime() || Date.now() - 7200000,
      source: 'demo-preview',
      rawText: '',
    }),
    demo_tx_3: mkDemo({
      id: 'demo_tx_3',
      amount: 1200,
      currency: 'INR',
      type: 'credit',
      status: 'completed',
      reconciliationStatus: 'confirmed',
      merchant: 'Ramesh Kumar (DEMO)',
      personalNote: 'Shared dinner split received (Demo Preview)',
      paymentRemark: 'Dinner split',
      note: 'Shared dinner split received (Demo Preview)',
      category: 'income',
      paymentMethod: 'UPI',
      app: 'GPay',
      refId: 'DEMO62810198821',
      date: `${ym}-18`,
      time: '20:15',
      timestampMs: new Date(`${ym}-18T20:15:00`).getTime() || Date.now() - 86400000,
      source: 'demo-preview',
      rawText: '',
    }),
    demo_tx_4: mkDemo({
      id: 'demo_tx_4',
      amount: 280,
      currency: 'INR',
      type: 'debit',
      status: 'completed',
      reconciliationStatus: 'auto_detected',
      merchant: 'Swiggy (DEMO)',
      personalNote: '',
      paymentRemark: '',
      note: '',
      noteReviewed: false,
      category: 'food',
      paymentMethod: 'UPI',
      app: 'Paytm',
      refId: 'DEMO62810110044',
      date: `${ym}-18`,
      time: '19:10',
      timestampMs: new Date(`${ym}-18T19:10:00`).getTime() || Date.now() - 90000000,
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

/**
 * Loads the user's real transaction statement from Android Keystore AES-GCM encrypted storage.
 * Never reads from or writes to plaintext localStorage for production transactions.
 */
export function loadEncryptedExpenseStore() {
  try {
    if (hasNativeEncryptedBridge()) {
      const rawJson = window.PattanBiometric.loadEncryptedExpenseStoreJson();
      const cleanMap = {};
      if (rawJson && typeof rawJson === 'string') {
        const parsed = JSON.parse(rawJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [id, tx] of Object.entries(parsed)) {
            if (!tx || typeof tx !== 'object' || tx.isDemoPreview || tx._demoPreview) continue;
            cleanMap[id] = tx._deleted ? tx : migrateAndNormalizeExpenseRecord({ ...tx, rawText: '' });
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

  const sanitizedMap = {};
  for (const [id, tx] of Object.entries(expensesMap || {})) {
    if (!tx || typeof tx !== 'object' || tx.isDemoPreview || tx._demoPreview) continue;
    // Never persist full raw notification text in production storage
    const cleanTx = { ...tx, rawText: '' };
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
};
