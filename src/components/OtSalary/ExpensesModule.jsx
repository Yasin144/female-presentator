import React, { useState, useEffect, useMemo, useCallback } from 'react';

export const EXPENSE_CATEGORIES = [
  { id: 'food', label: 'Food & Snacks', icon: '🍔', color: '#f97316' },
  { id: 'groceries', label: 'Groceries & Milk', icon: '🛒', color: '#10b981' },
  { id: 'fuel', label: 'Petrol & Travel', icon: '⛽', color: '#38bdf8' },
  { id: 'shopping', label: 'Shopping', icon: '🛍️', color: '#ec4899' },
  { id: 'bills', label: 'Bills & Recharge', icon: '⚡', color: '#eab308' },
  { id: 'medical', label: 'Medical & Health', icon: '🏥', color: '#ef4444' },
  { id: 'entertainment', label: 'Movies & Fun', icon: '🎬', color: '#a855f7' },
  { id: 'transfer', label: 'UPI / Transfer', icon: '🤝', color: '#6366f1' },
  { id: 'cash', label: 'ATM / Cash', icon: '💵', color: '#14b8a6' },
  { id: 'income', label: 'Received / Credit', icon: '💎', color: '#22c55e' },
];

export const PAYMENT_APPS = [
  { id: 'GPay', label: 'GPay', color: '#38bdf8' },
  { id: 'PhonePe', label: 'PhonePe', color: '#a855f7' },
  { id: 'Paytm', label: 'Paytm', color: '#0ea5e9' },
  { id: 'BHIM UPI', label: 'BHIM UPI', color: '#f97316' },
  { id: 'Bank SMS', label: 'Bank SMS', color: '#eab308' },
  { id: 'Cash', label: 'Cash', color: '#10b981' },
  { id: 'Card', label: 'Card', color: '#ec4899' },
];

export const QUICK_NOTE_CHIPS = [
  '☕ Tea & Snacks',
  '🍱 Lunch / Dinner',
  '🛒 Groceries & Milk',
  '⛽ Petrol / Fuel',
  '🛺 Auto / Cab Travel',
  '🛍️ Shopping',
  '💊 Medicine',
  '📱 Mobile Recharge',
  '🏠 Rent / Bill',
  '🤝 Sent to Friend',
];

function formatINR(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getTodayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getNowTimeHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function formatTime12h(timeStr) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || '').trim());
  if (!m) return timeStr || '--:--';
  const hh24 = Math.max(0, Math.min(23, Number(m[1]) || 0));
  const mm = Math.max(0, Math.min(59, Number(m[2]) || 0));
  const period = hh24 >= 12 ? 'PM' : 'AM';
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${String(hh12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${period}`;
}

export function parseSmsOrUpiTextJs(rawText, fallbackTimestampMs = Date.now()) {
  const text = String(rawText || '').trim();
  if (text.length < 5) return null;
  const lower = text.toLowerCase();

  // Amount extraction
  let amount = 0;
  const mPrefix = /(?:₹|rs\.?|inr|amt)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i.exec(text);
  const mSuffix = /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)/i.exec(text);
  if (mPrefix) {
    amount = parseFloat(mPrefix[1].replace(/,/g, '')) || 0;
  } else if (mSuffix) {
    amount = parseFloat(mSuffix[1].replace(/,/g, '')) || 0;
  }
  if (amount <= 0) return null;

  const isCredit = /(credited|received|deposited|refund|added to|upi\/cr\/)/i.test(lower);
  const isDebit = /(debited|spent|paid|sent|withdrawn|deducted|trf to|upi\/dr\/)/i.test(lower);
  const type = isCredit && !isDebit ? 'credit' : 'debit';

  // UPI slash pattern: UPI/<Ref>/<Merchant>/<Note>
  let refId = '';
  let slashMerchant = '';
  let slashNote = '';
  const mSlash = /UPI\/(?:CR\/|DR\/)?([0-9]{9,14})(?:\/([^/\n\r]{2,40}))?(?:\/([^/\n\r]{2,60}))?/i.exec(text);
  if (mSlash) {
    refId = (mSlash[1] || '').trim();
    slashMerchant = (mSlash[2] || '').trim();
    slashNote = (mSlash[3] || '').trim();
  }
  if (!refId) {
    const mRef = /(?:upi\s*(?:ref)?(?:\s*no\.?|\s*id)?|utr|ref(?:erence)?(?:\s*no\.?)?|txn\s*(?:id|no\.?)?)\s*[:\-/]?\s*([0-9]{9,14})/i.exec(text);
    if (mRef) refId = mRef[1].trim();
  }

  let merchant = '';
  const mMerch = /(?:paid\s+to|sent\s+to|trf\s+to|transferred\s+to|to\s+vpa|received\s+from|from\s+vpa|at|towards|to)\s+([A-Za-z0-9@._\-\s&]{2,36}?)(?=\s+(?:on|ref|upi|utr|txn|via|for|note|remarks|a\/c|ac|acct|avl|bal|using|from|\.|,|\n|$))/i.exec(text);
  if (mMerch) {
    merchant = mMerch[1].trim();
  } else if (slashMerchant) {
    merchant = slashMerchant;
  }
  if (!merchant) {
    merchant = type === 'credit' ? 'UPI / Bank Credit' : 'Mobile UPI Spend';
  }

  let note = '';
  const mNote = /(?:note|remarks?|purpose|for|comment|message|description)\s*[:\-]\s*([^\n\r.;]{2,80})/i.exec(text);
  if (mNote) {
    note = mNote[1].trim();
  } else if (slashNote && !/^(upi|na|nil|[0-9]+)$/i.test(slashNote)) {
    note = slashNote;
  }

  let app = 'Bank SMS';
  if (/(google pay|gpay|okaxis|okhdfcbank|okicici|oksbi)/i.test(lower)) app = 'GPay';
  else if (/(phonepe|@ybl|@ibl|@axl)/i.test(lower)) app = 'PhonePe';
  else if (/paytm/i.test(lower)) app = 'Paytm';
  else if (/bhim/i.test(lower)) app = 'BHIM UPI';
  else if (/hdfc/i.test(lower)) app = 'HDFC Bank';
  else if (/sbi/i.test(lower)) app = 'SBI Bank';
  else if (/icici/i.test(lower)) app = 'ICICI Bank';
  else if (/axis/i.test(lower)) app = 'Axis Bank';
  else if (/kotak/i.test(lower)) app = 'Kotak Bank';
  else if (/upi/i.test(lower)) app = 'UPI';

  let category = type === 'credit' ? 'income' : 'transfer';
  const cText = `${merchant} ${note} ${text}`.toLowerCase();
  if (type === 'debit') {
    if (/(swiggy|zomato|restaurant|cafe|tea|coffee|snack|bakery|hotel|food|lunch|dinner|breakfast|biryani|pizza|kfc|dominos|burger|tiffin|canteen)/i.test(cText)) category = 'food';
    else if (/(blinkit|zepto|instamart|bigbasket|dmart|reliance|supermarket|kirana|milk|vegetable|fruit|grocery|mart|dairy)/i.test(cText)) category = 'groceries';
    else if (/(petrol|diesel|fuel|hpcl|bpcl|iocl|shell|uber|ola|rapido|metro|irctc|bus|train|toll|fastag|auto|cab)/i.test(cText)) category = 'fuel';
    else if (/(amazon|flipkart|myntra|meesho|ajio|nykaa|zudio|shopping|mall|store|cloth|shoe)/i.test(cText)) category = 'shopping';
    else if (/(jio|airtel|vi |bsnl|electricity|water|gas|cylinder|broadband|wifi|recharge|bill|dth|rent|emi)/i.test(cText)) category = 'bills';
    else if (/(apollo|medplus|pharmacy|medical|hospital|clinic|doctor|medicine|1mg|health)/i.test(cText)) category = 'medical';
    else if (/(netflix|spotify|youtube|bookmyshow|movie|cinema|hotstar|prime|game)/i.test(cText)) category = 'entertainment';
    else if (/(atm|cash withdrawal)/i.test(cText)) category = 'cash';
  }

  const dt = new Date(fallbackTimestampMs);
  const dateIso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const timeHHMM = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  const id = refId
    ? `mob_ref_${refId}_${Math.round(amount)}`
    : `mob_paste_${Math.floor(fallbackTimestampMs / 1000)}_${Math.round(amount * 100)}`;

  return {
    id,
    amount,
    type,
    merchant,
    note,
    category,
    app,
    refId,
    date: dateIso,
    time: timeHHMM,
    timestampMs: fallbackTimestampMs,
    source: 'mobile-sms-parsed',
    rawText: text.slice(0, 280),
    updatedAt: new Date().toISOString(),
    updatedAtMs: Date.now(),
  };
}

export default function ExpensesModule({
  expensesMap = {},
  onUpdateExpenses,
  selectedMonth,
  onChangeMonth,
  monthlyNetSalary = 25000,
  mobileMode = false,
  liveNow = new Date(),
}) {
  // Quick Add / UPI Payment Form State
  const [amountInput, setAmountInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [merchantInput, setMerchantInput] = useState('');
  const [upiIdInput, setUpiIdInput] = useState('');
  const [selectedApp, setSelectedApp] = useState('GPay');
  const [selectedCategory, setSelectedCategory] = useState('food');
  const [txType, setTxType] = useState('debit'); // 'debit' | 'credit'
  const [txDate, setTxDate] = useState(getTodayIso);
  const [txTime, setTxTime] = useState(getNowTimeHHMM);

  // Filters & Search
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'today' | 'debit' | 'credit' | 'has_note' | 'needs_note'
  const [appFilter, setAppFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Mobile Native Scanner & Paste Modal State
  const [scanningMobile, setScanningMobile] = useState(false);
  const [scanStatusMsg, setScanStatusMsg] = useState('');
  const [smsGranted, setSmsGranted] = useState(() => {
    try {
      return Boolean(window.PattanBiometric?.isSmsPermissionGranted?.());
    } catch (_) {
      return false;
    }
  });
  const [notifGranted, setNotifGranted] = useState(() => {
    try {
      return Boolean(window.PattanBiometric?.isNotificationListenerEnabled?.());
    } catch (_) {
      return false;
    }
  });
  const [showPasteDrawer, setShowPasteDrawer] = useState(false);
  const [pasteSmsText, setPasteSmsText] = useState('');
  const [expandedRawId, setExpandedRawId] = useState(null);

  const isNativeAndroid = typeof window !== 'undefined' && Boolean(window.PattanBiometric);

  // Merge incoming transactions from Android Native SMS / Notification Bridge
  const mergeMobileScannedTransactions = useCallback((incomingList = []) => {
    if (!Array.isArray(incomingList) || incomingList.length === 0) return 0;
    let addedOrUpdatedCount = 0;
    const nextMap = { ...expensesMap };
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    for (const rawTx of incomingList) {
      if (!rawTx || !rawTx.id || !(Number(rawTx.amount) > 0)) continue;
      const existing = nextMap[rawTx.id];
      if (existing && existing._deleted) continue;

      if (!existing) {
        nextMap[rawTx.id] = {
          ...rawTx,
          amount: Number(rawTx.amount) || 0,
          note: String(rawTx.note || '').trim(),
          updatedAt: nowIso,
          updatedAtMs: Number(rawTx.updatedAtMs || rawTx.timestampMs || nowMs),
        };
        addedOrUpdatedCount += 1;
      } else {
        // Preserve any note or category edited by the user!
        const preservedNote = existing.note && existing.note.trim() ? existing.note : String(rawTx.note || '').trim();
        if (preservedNote !== existing.note) {
          nextMap[rawTx.id] = {
            ...existing,
            note: preservedNote,
            updatedAt: nowIso,
            updatedAtMs: nowMs,
          };
          addedOrUpdatedCount += 1;
        }
      }
    }

    if (addedOrUpdatedCount > 0 && typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(nextMap, `📱 Synced ${addedOrUpdatedCount} mobile transaction${addedOrUpdatedCount === 1 ? '' : 's'}`);
    }
    return addedOrUpdatedCount;
  }, [expensesMap, onUpdateExpenses]);

  // Listen to native Android 'pattan-mobile-transactions' events
  useEffect(() => {
    const onMobileTxEvent = (ev) => {
      setScanningMobile(false);
      const detail = ev?.detail || {};
      if (typeof detail.smsGranted === 'boolean') setSmsGranted(detail.smsGranted);
      if (typeof detail.notifGranted === 'boolean') setNotifGranted(detail.notifGranted);
      const list = Array.isArray(detail.transactions) ? detail.transactions : [];
      const count = mergeMobileScannedTransactions(list);
      if (list.length > 0) {
        setScanStatusMsg(`✓ Found ${list.length} mobile transactions (${count} new) from SMS & UPI alerts`);
      } else if (detail.smsGranted) {
        setScanStatusMsg('✓ Mobile SMS & UPI Inbox scanned — up to date');
      } else {
        setScanStatusMsg('ℹ️ Allow SMS / Notification permission on phone to auto-read bank & UPI transactions');
      }
    };
    window.addEventListener('pattan-mobile-transactions', onMobileTxEvent);
    return () => window.removeEventListener('pattan-mobile-transactions', onMobileTxEvent);
  }, [mergeMobileScannedTransactions]);

  // Auto-scan when opening Expenses on Android if SMS permission is already granted
  useEffect(() => {
    try {
      if (window.PattanBiometric && typeof window.PattanBiometric.scanMobileTransactions === 'function') {
        const hasPerm = Boolean(window.PattanBiometric.isSmsPermissionGranted?.());
        const hasNotif = Boolean(window.PattanBiometric.isNotificationListenerEnabled?.());
        setSmsGranted(hasPerm);
        setNotifGranted(hasNotif);
        if (hasPerm || hasNotif) {
          window.PattanBiometric.scanMobileTransactions(60);
        }
      }
    } catch (_) {}
  }, []);

  const triggerMobileTransactionScan = () => {
    setScanningMobile(true);
    try {
      if (window.PattanBiometric && typeof window.PattanBiometric.scanMobileTransactions === 'function') {
        setScanStatusMsg('📲 Scanning mobile SMS inbox & UPI payment notifications...');
        window.PattanBiometric.scanMobileTransactions(60);
        setTimeout(() => setScanningMobile(false), 3500);
        return;
      }
    } catch (_) {}
    setScanningMobile(false);
    setShowPasteDrawer(true);
    setScanStatusMsg('📋 On Web/Browser: Paste any Bank SMS or UPI message below, or scan from the Android APK!');
  };

  const handleOpenNotificationSettings = () => {
    try {
      if (window.PattanBiometric && typeof window.PattanBiometric.openNotificationListenerSettings === 'function') {
        window.PattanBiometric.openNotificationListenerSettings();
        setScanStatusMsg('🔔 Enable "Pattan Workspace / OT & Salary" in Android Notification Access for live GPay/PhonePe capture');
      }
    } catch (_) {}
  };

  // Add a transaction (manual or with UPI Pay launch)
  const handleAddTransaction = (launchUpiApp = false) => {
    const cleanAmount = parseFloat(String(amountInput || '').replace(/,/g, ''));
    if (!cleanAmount || cleanAmount <= 0) {
      setScanStatusMsg('⚠️ Please enter a valid ₹ amount');
      return;
    }
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const dateVal = txDate || getTodayIso();
    const timeVal = txTime || getNowTimeHHMM();
    const cleanNote = String(noteInput || '').trim();
    const cleanMerchant = String(merchantInput || '').trim() || (cleanNote ? cleanNote.replace(/^[^\w]+/, '').trim() : (txType === 'credit' ? 'Received Payment' : `${selectedApp} Spend`));

    const id = `tx_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;
    const newTx = {
      id,
      amount: Number(cleanAmount.toFixed(2)),
      type: txType,
      merchant: cleanMerchant,
      upiId: String(upiIdInput || '').trim(),
      note: cleanNote,
      category: txType === 'credit' ? 'income' : selectedCategory,
      app: selectedApp,
      refId: '',
      date: dateVal,
      time: timeVal,
      timestampMs: nowMs,
      source: launchUpiApp ? 'upi-pay-with-note' : 'manual-mobile',
      updatedAt: nowIso,
      updatedAtMs: nowMs,
    };

    const nextMap = { ...expensesMap, [id]: newTx };
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(
        nextMap,
        `💸 Saved ₹${formatINR(cleanAmount)} ${cleanNote ? `("${cleanNote}")` : `(${cleanMerchant})`}`
      );
    }

    if (launchUpiApp) {
      if (window.PattanBiometric && typeof window.PattanBiometric.launchUpiPayment === 'function') {
        window.PattanBiometric.launchUpiPayment(
          upiIdInput.trim(),
          cleanMerchant,
          String(cleanAmount),
          cleanNote || cleanMerchant
        );
      } else {
        const params = new URLSearchParams();
        if (upiIdInput.trim()) params.set('pa', upiIdInput.trim());
        params.set('pn', cleanMerchant);
        params.set('am', String(cleanAmount));
        params.set('cu', 'INR');
        if (cleanNote) params.set('tn', cleanNote);
        window.location.href = `upi://pay?${params.toString()}`;
      }
    }

    setAmountInput('');
    setNoteInput('');
    setMerchantInput('');
    setTxDate(getTodayIso());
    setTxTime(getNowTimeHHMM());
  };

  const handleUpdateTransactionPatch = (txId, patch) => {
    const existing = expensesMap[txId];
    if (!existing) return;
    const nowMs = Date.now();
    const updated = {
      ...existing,
      ...patch,
      updatedAt: new Date(nowMs).toISOString(),
      updatedAtMs: nowMs,
    };
    const nextMap = { ...expensesMap, [txId]: updated };
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(nextMap, patch.note !== undefined ? `📝 Updated transaction note` : `Updated transaction`);
    }
  };

  const handleDeleteTransaction = (txId) => {
    const existing = expensesMap[txId];
    if (!existing) return;
    const nowMs = Date.now();
    const nextMap = {
      ...expensesMap,
      [txId]: {
        ...existing,
        _deleted: true,
        updatedAt: new Date(nowMs).toISOString(),
        updatedAtMs: nowMs,
      },
    };
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(nextMap, `🗑️ Removed transaction ₹${formatINR(existing.amount)}`);
    }
  };

  const handleParsePastedSms = () => {
    const lines = String(pasteSmsText || '')
      .split(/\n{2,}|\r\n\r\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedList = [];
    for (const block of (lines.length ? lines : [pasteSmsText])) {
      const p = parseSmsOrUpiTextJs(block, Date.now());
      if (p) parsedList.push(p);
    }
    if (parsedList.length === 0) {
      setScanStatusMsg('⚠️ Could not find a ₹ / Rs. transaction amount in the pasted text.');
      return;
    }
    mergeMobileScannedTransactions(parsedList);
    setPasteSmsText('');
    setShowPasteDrawer(false);
    setScanStatusMsg(`✓ Extracted & saved ${parsedList.length} transaction${parsedList.length === 1 ? '' : 's'} from pasted SMS!`);
  };

  // All active (non-deleted) transactions for the selected month (or all if month not matched)
  const allTransactions = useMemo(() => {
    return Object.values(expensesMap || {})
      .filter((tx) => tx && typeof tx === 'object' && !tx._deleted && Number(tx.amount) > 0)
      .sort((a, b) => (Number(b.timestampMs) || 0) - (Number(a.timestampMs) || 0));
  }, [expensesMap]);

  const monthTransactions = useMemo(() => {
    if (!selectedMonth) return allTransactions;
    return allTransactions.filter((tx) => String(tx.date || '').startsWith(selectedMonth));
  }, [allTransactions, selectedMonth]);

  const todayIso = getTodayIso();

  // Comprehensive Metrics (Spend, Received, Transaction Counts, Note Coverage, App & Category Breakdown)
  const stats = useMemo(() => {
    let monthSpent = 0;
    let monthReceived = 0;
    let monthDebitCount = 0;
    let monthCreditCount = 0;
    let todaySpent = 0;
    let todayReceived = 0;
    let todayCount = 0;
    let withNoteCount = 0;
    let needsNoteCount = 0;

    const byCategory = {};
    const byApp = {};

    for (const tx of monthTransactions) {
      const amt = Number(tx.amount) || 0;
      const isCredit = tx.type === 'credit';
      const hasNote = Boolean(tx.note && String(tx.note).trim());

      if (hasNote) withNoteCount += 1;
      else needsNoteCount += 1;

      if (isCredit) {
        monthReceived += amt;
        monthCreditCount += 1;
      } else {
        monthSpent += amt;
        monthDebitCount += 1;
        const cat = tx.category || 'transfer';
        if (!byCategory[cat]) byCategory[cat] = { count: 0, amount: 0 };
        byCategory[cat].count += 1;
        byCategory[cat].amount += amt;
      }

      const appName = tx.app || 'UPI';
      if (!byApp[appName]) byApp[appName] = { count: 0, spent: 0, received: 0 };
      byApp[appName].count += 1;
      if (isCredit) byApp[appName].received += amt;
      else byApp[appName].spent += amt;

      if (tx.date === todayIso) {
        todayCount += 1;
        if (isCredit) todayReceived += amt;
        else todaySpent += amt;
      }
    }

    const totalMonthTxCount = monthTransactions.length;
    const remainingSalary = Math.max(0, (Number(monthlyNetSalary) || 0) - monthSpent);
    const spentSalaryPct = monthlyNetSalary > 0 ? Math.min(100, Math.round((monthSpent / monthlyNetSalary) * 100)) : 0;

    return {
      monthSpent,
      monthReceived,
      monthDebitCount,
      monthCreditCount,
      totalMonthTxCount,
      todaySpent,
      todayReceived,
      todayCount,
      withNoteCount,
      needsNoteCount,
      remainingSalary,
      spentSalaryPct,
      byCategory,
      byApp,
    };
  }, [monthTransactions, todayIso, monthlyNetSalary]);

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return monthTransactions.filter((tx) => {
      if (filterMode === 'today' && tx.date !== todayIso) return false;
      if (filterMode === 'debit' && tx.type === 'credit') return false;
      if (filterMode === 'credit' && tx.type !== 'credit') return false;
      if (filterMode === 'has_note' && !(tx.note && String(tx.note).trim())) return false;
      if (filterMode === 'needs_note' && Boolean(tx.note && String(tx.note).trim())) return false;
      if (appFilter !== 'ALL' && tx.app !== appFilter) return false;
      if (categoryFilter !== 'ALL' && tx.category !== categoryFilter) return false;
      if (q) {
        const hay = `${tx.note || ''} ${tx.merchant || ''} ${tx.amount || ''} ${tx.app || ''} ${tx.refId || ''} ${tx.date || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [monthTransactions, filterMode, appFilter, categoryFilter, searchQuery, todayIso]);

  const exportExpensesCsv = () => {
    const headers = [
      'Tx #',
      'Date',
      'Time',
      'Type',
      'Amount (INR)',
      'Transaction Note (What For)',
      'Merchant / Payee',
      'Payment App',
      'Category',
      'UPI Ref / UTR',
      'Source',
    ];
    const rows = [headers.join(',')];
    monthTransactions.forEach((tx, idx) => {
      rows.push([
        monthTransactions.length - idx,
        tx.date || '',
        formatTime12h(tx.time || ''),
        tx.type === 'credit' ? 'RECEIVED' : 'SPENT',
        Number(tx.amount || 0).toFixed(2),
        `"${String(tx.note || '').replace(/"/g, '""')}"`,
        `"${String(tx.merchant || '').replace(/"/g, '""')}"`,
        `"${String(tx.app || '')}"`,
        `"${String(tx.category || '')}"`,
        `"${String(tx.refId || '')}"`,
        `"${String(tx.source || '')}"`,
      ].join(','));
    });
    rows.push('');
    rows.push(`"Total Transactions Done",${stats.totalMonthTxCount}`);
    rows.push(`"Total Spent (INR)",${stats.monthSpent.toFixed(2)}`);
    rows.push(`"Total Received (INR)",${stats.monthReceived.toFixed(2)}`);
    rows.push(`"Remaining Salary Balance (INR)",${stats.remainingSalary.toFixed(2)}`);

    const blob = new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Mobile-Expenses-Notes-${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shareExpensesOnWhatsApp = async () => {
    const topLines = [
      `💸 *MOBILE EXPENSES & NOTES REPORT (${selectedMonth})*`,
      `• Total Transactions Done: *${stats.totalMonthTxCount} Transactions* (${stats.monthDebitCount} Spent · ${stats.monthCreditCount} Received)`,
      `• Today's Spend (${todayIso}): *₹${formatINR(stats.todaySpent)}* (${stats.todayCount} txns)`,
      `• Total Monthly Spent: *₹${formatINR(stats.monthSpent)}*`,
      `• Total Received: *+₹${formatINR(stats.monthReceived)}*`,
      `• Net Salary Remaining: *₹${formatINR(stats.remainingSalary)}*`,
      '',
      `📝 *Recent Transactions & Notes:*`,
      ...monthTransactions.slice(0, 12).map((tx, i) => {
        const sign = tx.type === 'credit' ? '+' : '-';
        const noteStr = tx.note ? ` — 📝 *"${tx.note}"*` : '';
        return `${i + 1}. ${sign}₹${formatINR(tx.amount)} · ${tx.merchant} (${tx.app}, ${formatTime12h(tx.time)})${noteStr}`;
      }),
    ];
    const text = topLines.join('\n');
    try {
      if (navigator.share) {
        await navigator.share({ title: `Expenses & Notes (${selectedMonth})`, text });
        return;
      }
    } catch (_) {}
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 1. EXECUTIVE EXPENSES & MOBILE TRANSACTION VAULT HERO */}
      <div style={{
        padding: mobileMode ? '16px 15px' : '20px 22px',
        borderRadius: 22,
        background: 'linear-gradient(135deg, #1a103c 0%, #090d1a 52%, #062c28 100%)',
        border: '1.5px solid rgba(244, 114, 182, 0.45)',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                padding: '3px 9px',
                borderRadius: 999,
                background: 'rgba(244, 114, 182, 0.18)',
                border: '1px solid rgba(244, 114, 182, 0.5)',
                color: '#f9a8d4',
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}>
                💸 MOBILE EXPENSES &amp; NOTE TRACKER
              </span>
              <span style={{
                padding: '3px 9px',
                borderRadius: 999,
                background: 'rgba(250, 204, 21, 0.18)',
                border: '1px solid rgba(250, 204, 21, 0.5)',
                color: '#fde047',
                fontSize: 10.5,
                fontWeight: 900,
              }}>
                🔢 {stats.totalMonthTxCount} Transactions in {selectedMonth}
              </span>
            </div>

            <div style={{
              marginTop: 8,
              fontSize: mobileMode ? 28 : 34,
              fontWeight: 950,
              color: '#fb7185',
              letterSpacing: '-0.02em',
              textShadow: '0 4px 20px rgba(251, 113, 133, 0.28)',
            }}>
              ₹{formatINR(stats.monthSpent)}
              <span style={{ fontSize: 13, color: '#fda4af', fontWeight: 800, marginLeft: 8 }}>
                Total Spent ({stats.monthDebitCount} Txns)
              </span>
            </div>
          </div>

          {/* Live Ticking Clock + Today Counter Pill */}
          <div style={{
            padding: '10px 14px',
            borderRadius: 16,
            background: 'rgba(7, 11, 20, 0.78)',
            border: '1px solid rgba(56, 189, 248, 0.42)',
            textAlign: 'right',
          }}>
            <div style={{ fontSize: 10, fontWeight: 900, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ⏱️ LIVE MOBILE TIME
            </div>
            <div style={{ fontSize: 18, fontWeight: 950, color: '#f8fafc', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
              {liveNow.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
            </div>
            <div style={{ fontSize: 11, color: '#fde047', fontWeight: 800, marginTop: 2 }}>
              Today: {stats.todayCount} Txns · ₹{formatINR(stats.todaySpent)}
            </div>
          </div>
        </div>

        {/* 4-Card KPI Strip: Today Spend, Total Txns Done, Notes Written, Salary Remaining */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
          gap: 10,
          marginTop: 14,
        }}>
          <div style={{
            padding: '11px 13px',
            borderRadius: 14,
            background: 'rgba(15, 23, 42, 0.78)',
            border: '1px solid rgba(251, 113, 133, 0.35)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 900, color: '#fda4af', textTransform: 'uppercase' }}>
              🔥 Spent Today
            </div>
            <div style={{ fontSize: 19, fontWeight: 950, color: '#fff', marginTop: 3 }}>
              ₹{formatINR(stats.todaySpent)}
            </div>
            <div style={{ fontSize: 11, color: '#fb7185', fontWeight: 800, marginTop: 2 }}>
              {stats.todayCount} Transaction{stats.todayCount === 1 ? '' : 's'} Today
            </div>
          </div>

          <div style={{
            padding: '11px 13px',
            borderRadius: 14,
            background: 'rgba(15, 23, 42, 0.78)',
            border: '1px solid rgba(250, 204, 21, 0.4)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 900, color: '#fde047', textTransform: 'uppercase' }}>
              🔢 How Many Txns Done
            </div>
            <div style={{ fontSize: 19, fontWeight: 950, color: '#facc15', marginTop: 3 }}>
              {stats.totalMonthTxCount} Txns
            </div>
            <div style={{ fontSize: 11, color: '#fef08a', fontWeight: 700, marginTop: 2 }}>
              {stats.monthDebitCount} Spent · {stats.monthCreditCount} Received
            </div>
          </div>

          <div style={{
            padding: '11px 13px',
            borderRadius: 14,
            background: 'rgba(15, 23, 42, 0.78)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 900, color: '#7dd3fc', textTransform: 'uppercase' }}>
              📝 Transaction Notes
            </div>
            <div style={{ fontSize: 19, fontWeight: 950, color: '#38bdf8', marginTop: 3 }}>
              {stats.withNoteCount}/{stats.totalMonthTxCount} Noted
            </div>
            <div style={{ fontSize: 11, color: stats.needsNoteCount > 0 ? '#fde047' : '#6ee7b7', fontWeight: 800, marginTop: 2 }}>
              {stats.needsNoteCount > 0 ? `${stats.needsNoteCount} need a note` : 'All notes recorded ✓'}
            </div>
          </div>

          <div style={{
            padding: '11px 13px',
            borderRadius: 14,
            background: 'rgba(15, 23, 42, 0.78)',
            border: '1px solid rgba(52, 211, 153, 0.45)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 900, color: '#6ee7b7', textTransform: 'uppercase' }}>
              💰 Salary Left in Hand
            </div>
            <div style={{ fontSize: 19, fontWeight: 950, color: '#34d399', marginTop: 3 }}>
              ₹{formatINR(stats.remainingSalary)}
            </div>
            <div style={{ fontSize: 11, color: '#a7f3d0', fontWeight: 700, marginTop: 2 }}>
              {100 - stats.spentSalaryPct}% of ₹{formatINR(monthlyNetSalary)} left
            </div>
          </div>
        </div>

        {/* Salary vs Expense Progress Bar */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, color: '#cbd5e1', marginBottom: 4 }}>
            <span>Monthly Salary Used: {stats.spentSalaryPct}% (₹{formatINR(stats.monthSpent)})</span>
            <span style={{ color: '#6ee7b7' }}>Remaining: ₹{formatINR(stats.remainingSalary)}</span>
          </div>
          <div style={{
            height: 8,
            borderRadius: 999,
            background: 'rgba(15, 23, 42, 0.9)',
            border: '1px solid rgba(148, 163, 184, 0.2)',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${stats.spentSalaryPct}%`,
              height: '100%',
              borderRadius: 999,
              background: stats.spentSalaryPct > 80
                ? 'linear-gradient(90deg, #f97316, #ef4444)'
                : 'linear-gradient(90deg, #10b981, #38bdf8, #f472b6)',
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      </div>

      {/* 2. MOBILE AUTO-SCANNER BAR (SMS INBOX + GPAY / PHONEPE / PAYTM LIVE LISTENER) */}
      <div style={{
        padding: mobileMode ? '13px 14px' : '14px 18px',
        borderRadius: 18,
        background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.16), rgba(16, 185, 129, 0.12))',
        border: '1px solid rgba(56, 189, 248, 0.45)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 950, color: '#e0f2fe', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>📲 Automatic Mobile Transaction &amp; Note Extractor</span>
              {isNativeAndroid && (
                <span style={{
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: 'rgba(16, 185, 129, 0.22)',
                  border: '1px solid #34d399',
                  color: '#6ee7b7',
                  fontSize: 9.5,
                  fontWeight: 900,
                }}>
                  ANDROID BRIDGE ACTIVE
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600, marginTop: 2 }}>
              Automatically reads your mobile Bank/UPI SMS &amp; live GPay / PhonePe / Paytm alerts — Amount, Merchant, Ref ID, Time &amp; Note!
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={triggerMobileTransactionScan}
              disabled={scanningMobile}
              style={{
                padding: '9px 14px',
                borderRadius: 12,
                border: '1px solid rgba(52, 211, 153, 0.7)',
                background: 'linear-gradient(135deg, #059669, #0284c7)',
                color: '#fff',
                fontWeight: 900,
                fontSize: 12.5,
                cursor: 'pointer',
                boxShadow: '0 8px 20px rgba(16, 185, 129, 0.28)',
              }}
            >
              {scanningMobile ? '⏳ Scanning Mobile...' : '📲 Scan Mobile SMS & UPI Now'}
            </button>

            {isNativeAndroid && (
              <button
                type="button"
                onClick={handleOpenNotificationSettings}
                style={{
                  padding: '9px 12px',
                  borderRadius: 12,
                  border: notifGranted ? '1px solid rgba(52, 211, 153, 0.55)' : '1px solid rgba(250, 204, 21, 0.6)',
                  background: notifGranted ? 'rgba(16, 185, 129, 0.18)' : 'rgba(250, 204, 21, 0.16)',
                  color: notifGranted ? '#6ee7b7' : '#fde047',
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {notifGranted ? '🔔 Live UPI Alerts: ON ✓' : '🔔 Enable Live GPay/PhonePe Capture'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowPasteDrawer((v) => !v)}
              style={{
                padding: '9px 12px',
                borderRadius: 12,
                border: '1px solid rgba(148, 163, 184, 0.35)',
                background: 'rgba(15, 23, 42, 0.85)',
                color: '#e2e8f0',
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              📋 Paste SMS / UPI Text
            </button>
          </div>
        </div>

        {scanStatusMsg && (
          <div style={{
            padding: '7px 11px',
            borderRadius: 10,
            background: 'rgba(7, 11, 20, 0.72)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            color: '#7dd3fc',
            fontSize: 11.5,
            fontWeight: 800,
          }}>
            {scanStatusMsg}
          </div>
        )}

        {showPasteDrawer && (
          <div style={{
            padding: 12,
            borderRadius: 14,
            background: '#070b14',
            border: '1px solid rgba(56, 189, 248, 0.4)',
          }}>
            <div style={{ fontSize: 11.5, fontWeight: 900, color: '#7dd3fc', marginBottom: 6 }}>
              📋 Paste any Bank SMS or GPay / PhonePe / Paytm Notification Text (Auto-Extracts Amount, Payee, Ref &amp; Note):
            </div>
            <textarea
              rows={3}
              value={pasteSmsText}
              onChange={(e) => setPasteSmsText(e.target.value)}
              placeholder="Example: Rs. 240.00 debited from A/c XX1234 on 19-10-26 to VPA swiggy@axis (UPI/629183746192/Swiggy/Dinner with team)."
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 10,
                border: '1px solid rgba(148,163,184,0.3)',
                background: '#0f172a',
                color: '#fff',
                fontSize: 12.5,
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={handleParsePastedSms}
                style={{
                  padding: '8px 14px',
                  borderRadius: 9,
                  border: '1px solid #34d399',
                  background: '#059669',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                ⚡ Extract &amp; Save Transaction
              </button>
              <button
                type="button"
                onClick={() => setShowPasteDrawer(false)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 9,
                  border: '1px solid rgba(148,163,184,0.3)',
                  background: 'transparent',
                  color: '#94a3b8',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3. INSTANT EXPENSE & TRANSACTION NOTE RECORDER (+ DIRECT UPI PAY LAUNCHER) */}
      <div style={{
        padding: mobileMode ? '15px 14px' : '18px 20px',
        borderRadius: 20,
        background: '#0b1120',
        border: '1.5px solid rgba(250, 204, 21, 0.42)',
        boxShadow: '0 14px 36px rgba(0, 0, 0, 0.45)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 950, color: '#fde047' }}>
              ⚡ Record Transaction &amp; Note (Never Forget What You Spent!)
            </div>
            <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600 }}>
              Write your note &amp; amount below — save directly or tap &quot;Pay via UPI App&quot; so your note is saved before paying!
            </div>
          </div>

          {/* Spent vs Received Toggle */}
          <div style={{
            display: 'inline-flex',
            padding: 3,
            borderRadius: 11,
            background: '#060a14',
            border: '1px solid rgba(148, 163, 184, 0.25)',
          }}>
            <button
              type="button"
              onClick={() => setTxType('debit')}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                background: txType === 'debit' ? 'rgba(244, 63, 94, 0.28)' : 'transparent',
                color: txType === 'debit' ? '#fda4af' : '#94a3b8',
                fontWeight: 900,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              🔴 Spent (Out)
            </button>
            <button
              type="button"
              onClick={() => setTxType('credit')}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                background: txType === 'credit' ? 'rgba(16, 185, 129, 0.28)' : 'transparent',
                color: txType === 'credit' ? '#6ee7b7' : '#94a3b8',
                fontWeight: 900,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              🟢 Received (In)
            </button>
          </div>
        </div>

        {/* Amount + Transaction Note Primary Row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: mobileMode ? '1fr' : '180px 1fr',
          gap: 10,
          marginBottom: 10,
        }}>
          {/* Amount Input */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 900, color: '#fde047', marginBottom: 4 }}>
              💰 AMOUNT SPENT (₹)
            </label>
            <input
              type="number"
              inputMode="decimal"
              placeholder="₹ 0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              style={{
                width: '100%',
                padding: '11px 12px',
                borderRadius: 12,
                border: '1.5px solid rgba(250, 204, 21, 0.55)',
                background: '#060a14',
                color: '#fde047',
                fontWeight: 950,
                fontSize: 18,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
              {[20, 50, 100, 200, 500, 1000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmountInput(String(preset))}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 7,
                    border: '1px solid rgba(250, 204, 21, 0.3)',
                    background: 'rgba(250, 204, 21, 0.1)',
                    color: '#fef08a',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  +₹{preset}
                </button>
              ))}
            </div>
          </div>

          {/* Transaction Note ("What was this for?") */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 900, color: '#6ee7b7', marginBottom: 4 }}>
              📝 TRANSACTION NOTE (WHAT DID YOU SPEND ON? / NOTE WRITTEN)
            </label>
            <input
              type="text"
              placeholder="Write exact note: e.g. Tea & Samosa, Petrol full tank, Kirana milk, Paid to Ramesh..."
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 13px',
                borderRadius: 12,
                border: '1.5px solid rgba(52, 211, 153, 0.6)',
                background: '#060a14',
                color: '#ecfdf5',
                fontWeight: 800,
                fontSize: 14,
                boxSizing: 'border-box',
              }}
            />
            {/* 1-Tap Quick Note Chips */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
              {QUICK_NOTE_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setNoteInput(chip);
                    if (/Tea|Lunch/i.test(chip)) setSelectedCategory('food');
                    else if (/Groceries/i.test(chip)) setSelectedCategory('groceries');
                    else if (/Petrol|Auto/i.test(chip)) setSelectedCategory('fuel');
                    else if (/Shopping/i.test(chip)) setSelectedCategory('shopping');
                    else if (/Medicine/i.test(chip)) setSelectedCategory('medical');
                    else if (/Recharge|Rent/i.test(chip)) setSelectedCategory('bills');
                    else if (/Friend/i.test(chip)) setSelectedCategory('transfer');
                  }}
                  style={{
                    padding: '4px 9px',
                    borderRadius: 999,
                    border: noteInput === chip ? '1px solid #34d399' : '1px solid rgba(148, 163, 184, 0.25)',
                    background: noteInput === chip ? 'rgba(16, 185, 129, 0.28)' : 'rgba(255, 255, 255, 0.04)',
                    color: noteInput === chip ? '#ecfdf5' : '#cbd5e1',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Merchant, Payment App, Category, Date/Time Row */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 9,
          marginBottom: 12,
        }}>
          <div>
            <label style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: '#94a3b8', marginBottom: 3 }}>
              🏪 Merchant / Payee Name
            </label>
            <input
              type="text"
              placeholder="e.g. Zomato / Shop / Ramesh"
              value={merchantInput}
              onChange={(e) => setMerchantInput(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 9,
                border: '1px solid rgba(148,163,184,0.3)',
                background: '#060a14',
                color: '#fff',
                fontWeight: 700,
                fontSize: 12.5,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: '#94a3b8', marginBottom: 3 }}>
              📱 Payment App / Mode
            </label>
            <select
              value={selectedApp}
              onChange={(e) => setSelectedApp(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 9,
                border: '1px solid rgba(56,189,248,0.35)',
                background: '#060a14',
                color: '#e0f2fe',
                fontWeight: 800,
                fontSize: 12.5,
              }}
            >
              {PAYMENT_APPS.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: '#94a3b8', marginBottom: 3 }}>
              🏷️ Spend Category
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 9,
                border: '1px solid rgba(148,163,184,0.3)',
                background: '#060a14',
                color: '#fff',
                fontWeight: 800,
                fontSize: 12.5,
              }}
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 10.5, fontWeight: 800, color: '#94a3b8', marginBottom: 3 }}>
              🕒 Date &amp; Time
            </label>
            <div style={{ display: 'flex', gap: 5 }}>
              <input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px 6px',
                  borderRadius: 9,
                  border: '1px solid rgba(148,163,184,0.3)',
                  background: '#060a14',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 11.5,
                }}
              />
              <input
                type="time"
                value={txTime}
                onChange={(e) => setTxTime(e.target.value)}
                style={{
                  width: 86,
                  padding: '8px 6px',
                  borderRadius: 9,
                  border: '1px solid rgba(148,163,184,0.3)',
                  background: '#060a14',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: 11.5,
                }}
              />
            </div>
          </div>
        </div>

        {/* Save Button + Pay via UPI App with Note Button */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => handleAddTransaction(false)}
            style={{
              flex: 2,
              minWidth: 200,
              padding: '12px 16px',
              borderRadius: 13,
              border: '1px solid rgba(52, 211, 153, 0.7)',
              background: 'linear-gradient(135deg, #10b981, #0284c7)',
              color: '#fff',
              fontWeight: 950,
              fontSize: 13.5,
              cursor: 'pointer',
              boxShadow: '0 10px 24px rgba(16, 185, 129, 0.3)',
            }}
          >
            💾 Save Transaction &amp; Note (Live Sync)
          </button>

          <button
            type="button"
            onClick={() => handleAddTransaction(true)}
            style={{
              flex: 1,
              minWidth: 190,
              padding: '12px 14px',
              borderRadius: 13,
              border: '1px solid rgba(250, 204, 21, 0.65)',
              background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.25), rgba(14, 165, 233, 0.25))',
              color: '#fde047',
              fontWeight: 950,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            🚀 Save Note &amp; Pay in GPay / PhonePe
          </button>
        </div>
      </div>

      {/* 4. HOW MANY TRANSACTIONS BY APP & CATEGORY SUMMARY */}
      {stats.totalMonthTxCount > 0 && (
        <div style={{
          padding: mobileMode ? '13px 14px' : '15px 18px',
          borderRadius: 18,
          background: '#0b1120',
          border: '1px solid rgba(148, 163, 184, 0.2)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            📊 Transactions Breakdown by App &amp; Category ({stats.totalMonthTxCount} Total Txns)
          </div>

          {/* App Count Pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setAppFilter('ALL')}
              style={{
                padding: '5px 10px',
                borderRadius: 999,
                border: appFilter === 'ALL' ? '1px solid #38bdf8' : '1px solid rgba(148,163,184,0.25)',
                background: appFilter === 'ALL' ? 'rgba(14,165,233,0.22)' : 'rgba(255,255,255,0.04)',
                color: appFilter === 'ALL' ? '#e0f2fe' : '#94a3b8',
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              All Apps ({stats.totalMonthTxCount})
            </button>
            {Object.entries(stats.byApp).map(([appName, info]) => (
              <button
                key={appName}
                type="button"
                onClick={() => setAppFilter(appFilter === appName ? 'ALL' : appName)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 999,
                  border: appFilter === appName ? '1px solid #fde047' : '1px solid rgba(148,163,184,0.25)',
                  background: appFilter === appName ? 'rgba(250,204,21,0.2)' : 'rgba(255,255,255,0.04)',
                  color: appFilter === appName ? '#fef08a' : '#cbd5e1',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                📱 {appName}: {info.count} txns · ₹{formatINR(info.spent || info.received)}
              </button>
            ))}
          </div>

          {/* Category Spend Pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {EXPENSE_CATEGORIES.map((cat) => {
              const cStats = stats.byCategory[cat.id];
              if (!cStats) return null;
              const active = categoryFilter === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(active ? 'ALL' : cat.id)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 10,
                    border: active ? `1px solid ${cat.color}` : '1px solid rgba(148,163,184,0.2)',
                    background: active ? 'rgba(255,255,255,0.12)' : 'rgba(6, 10, 20, 0.75)',
                    color: '#f8fafc',
                    fontSize: 11.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {cat.icon} {cat.label}: <span style={{ color: '#fde047' }}>{cStats.count} txns</span> · ₹{formatINR(cStats.amount)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. COMPLETE MOBILE TRANSACTION LEDGER & INLINE NOTE INSPECTOR */}
      <div style={{
        padding: mobileMode ? '14px 12px' : '18px 20px',
        borderRadius: 20,
        background: '#0b1120',
        border: '1px solid rgba(148, 163, 184, 0.22)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 950, color: '#fff' }}>
              📜 Mobile Transactions &amp; Written Notes ({filteredTransactions.length} Shown / {stats.totalMonthTxCount} Total)
            </h3>
            <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
              Tap any transaction note below to add or edit what you spent on — syncs immediately across Mobile &amp; Web.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={exportExpensesCsv}
              style={{
                padding: '7px 11px',
                borderRadius: 9,
                border: '1px solid rgba(56, 189, 248, 0.45)',
                background: 'rgba(14, 165, 233, 0.16)',
                color: '#e0f2fe',
                fontWeight: 800,
                fontSize: 11.5,
                cursor: 'pointer',
              }}
            >
              📥 Export CSV
            </button>
            <button
              type="button"
              onClick={shareExpensesOnWhatsApp}
              style={{
                padding: '7px 11px',
                borderRadius: 9,
                border: '1px solid rgba(34, 197, 94, 0.45)',
                background: 'rgba(34, 197, 94, 0.16)',
                color: '#bbf7d0',
                fontWeight: 800,
                fontSize: 11.5,
                cursor: 'pointer',
              }}
            >
              💬 Share on WhatsApp
            </button>
          </div>
        </div>

        {/* Filter Mode Pills + Search Box */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: `All (${stats.totalMonthTxCount})` },
              { id: 'today', label: `Today (${stats.todayCount})` },
              { id: 'debit', label: `🔴 Spent (${stats.monthDebitCount})` },
              { id: 'credit', label: `🟢 Received (${stats.monthCreditCount})` },
              { id: 'has_note', label: `📝 Has Note (${stats.withNoteCount})` },
              { id: 'needs_note', label: `⚠️ Needs Note (${stats.needsNoteCount})` },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterMode(f.id)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 8,
                  border: filterMode === f.id ? '1px solid #34d399' : '1px solid rgba(148,163,184,0.22)',
                  background: filterMode === f.id ? 'rgba(16,185,129,0.24)' : 'rgba(255,255,255,0.04)',
                  color: filterMode === f.id ? '#ecfdf5' : '#cbd5e1',
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="🔍 Search by note, merchant, ₹ amount, ref..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              minWidth: mobileMode ? '100%' : 240,
              padding: '7px 11px',
              borderRadius: 9,
              border: '1px solid rgba(148,163,184,0.3)',
              background: '#060a14',
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
            }}
          />
        </div>

        {/* Transaction Cards List */}
        {filteredTransactions.length === 0 ? (
          <div style={{
            padding: 28,
            borderRadius: 16,
            background: '#060a14',
            border: '1px dashed rgba(148, 163, 184, 0.25)',
            textAlign: 'center',
            color: '#94a3b8',
          }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>💸</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: '#e2e8f0' }}>
              No transactions recorded for this filter yet
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              Tap <strong>&quot;📲 Scan Mobile SMS &amp; UPI Now&quot;</strong> above to pull transactions from your phone, or record a transaction &amp; note above!
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredTransactions.map((tx, idx) => {
              const seqNum = filteredTransactions.length - idx;
              const isCredit = tx.type === 'credit';
              const catInfo = EXPENSE_CATEGORIES.find((c) => c.id === tx.category) || EXPENSE_CATEGORIES[7];
              const hasNote = Boolean(tx.note && String(tx.note).trim());

              return (
                <div
                  key={tx.id}
                  style={{
                    padding: mobileMode ? '12px 12px' : '14px 16px',
                    borderRadius: 16,
                    background: '#060a14',
                    border: isCredit
                      ? '1px solid rgba(52, 211, 153, 0.4)'
                      : hasNote
                        ? '1px solid rgba(56, 189, 248, 0.35)'
                        : '1px solid rgba(250, 204, 21, 0.45)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {/* Top Row: # Badge, Merchant, App, Category, Date/Time, Amount */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: 7,
                        background: 'rgba(250, 204, 21, 0.16)',
                        border: '1px solid rgba(250, 204, 21, 0.45)',
                        color: '#fde047',
                        fontSize: 11,
                        fontWeight: 950,
                      }}>
                        #{seqNum}
                      </span>

                      <span style={{ fontSize: 18 }}>{catInfo.icon}</span>

                      <div>
                        <div style={{ fontSize: 14.5, fontWeight: 900, color: '#f8fafc' }}>
                          {tx.merchant || 'Mobile Transaction'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                          <span style={{
                            padding: '1px 7px',
                            borderRadius: 999,
                            background: 'rgba(56, 189, 248, 0.16)',
                            border: '1px solid rgba(56, 189, 248, 0.4)',
                            color: '#7dd3fc',
                            fontSize: 10,
                            fontWeight: 900,
                          }}>
                            📱 {tx.app || 'UPI'}
                          </span>
                          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>
                            {tx.date} · {formatTime12h(tx.time)}
                          </span>
                          {tx.refId && (
                            <span style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>
                              Ref: {tx.refId}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Amount + Delete */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: mobileMode ? 18 : 20,
                          fontWeight: 950,
                          color: isCredit ? '#34d399' : '#fb7185',
                        }}>
                          {isCredit ? '+' : '-'} ₹{formatINR(tx.amount)}
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: isCredit ? '#6ee7b7' : '#fda4af' }}>
                          {isCredit ? 'RECEIVED' : 'SPENT'}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteTransaction(tx.id)}
                        title="Delete transaction"
                        style={{
                          padding: '5px 8px',
                          borderRadius: 7,
                          border: '1px solid rgba(248, 113, 113, 0.3)',
                          background: 'rgba(248, 113, 113, 0.1)',
                          color: '#fca5a5',
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Highlighted Transaction Note Box (Always Visible & Editable Inline!) */}
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: 11,
                    background: hasNote ? 'rgba(16, 185, 129, 0.1)' : 'rgba(250, 204, 21, 0.08)',
                    border: hasNote ? '1px solid rgba(52, 211, 153, 0.38)' : '1px dashed rgba(250, 204, 21, 0.45)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 10.5,
                        fontWeight: 950,
                        color: hasNote ? '#6ee7b7' : '#fde047',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        whiteSpace: 'nowrap',
                      }}>
                        {hasNote ? '📝 Note Written:' : '⚠️ What was this spend for?'}
                      </span>
                      <input
                        type="text"
                        placeholder="Tap here to write what you spent on (e.g. Tea, Petrol, Lunch, Groceries)..."
                        value={tx.note || ''}
                        onChange={(e) => handleUpdateTransactionPatch(tx.id, { note: e.target.value })}
                        style={{
                          flex: 1,
                          minWidth: 180,
                          padding: '6px 9px',
                          borderRadius: 8,
                          border: '1px solid rgba(148, 163, 184, 0.25)',
                          background: '#0b1120',
                          color: '#fef08a',
                          fontWeight: 800,
                          fontSize: 12.5,
                        }}
                      />
                    </div>

                    {/* Quick 1-Tap Note Tags if this mobile transaction doesn't have a note yet */}
                    {!hasNote && (
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {['☕ Tea & Snacks', '🍱 Food / Meal', '⛽ Petrol / Auto', '🛒 Groceries', '🛍️ Shopping', '💊 Medical', '📱 Bill'].map((quickTag) => (
                          <button
                            key={quickTag}
                            type="button"
                            onClick={() => handleUpdateTransactionPatch(tx.id, { note: quickTag })}
                            style={{
                              padding: '3px 8px',
                              borderRadius: 999,
                              border: '1px solid rgba(250, 204, 21, 0.35)',
                              background: 'rgba(250, 204, 21, 0.12)',
                              color: '#fef08a',
                              fontSize: 10.5,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            + {quickTag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Optional Original SMS / Notification Text Viewer */}
                  {tx.rawText && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setExpandedRawId(expandedRawId === tx.id ? null : tx.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: '#64748b',
                          fontSize: 10.5,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {expandedRawId === tx.id ? '▼ Hide Mobile SMS / Alert Detail' : '▶ View Original Mobile SMS / Alert Detail'}
                      </button>
                      {expandedRawId === tx.id && (
                        <div style={{
                          marginTop: 4,
                          padding: '7px 10px',
                          borderRadius: 8,
                          background: '#0b1120',
                          border: '1px solid rgba(148,163,184,0.18)',
                          color: '#94a3b8',
                          fontSize: 11,
                          lineHeight: 1.4,
                          wordBreak: 'break-word',
                        }}>
                          {tx.rawText}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
