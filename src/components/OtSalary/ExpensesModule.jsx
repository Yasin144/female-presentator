import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  EXPENSE_CATEGORIES,
  PAYMENT_APPS,
  DEFAULT_TAGS,
  QUICK_NOTE_CHIPS,
  formatINR,
  getLocalIsoDate,
  getLocalTimeHHMM,
  formatTime12h,
  migrateAndNormalizeExpenseRecord,
  parseSmsOrUpiTextJs,
  reconcileAndMergeTransactions,
  suggestNotesAndCategoryForMerchant,
  computeExpenseAnalytics,
  answerNaturalLanguageFinanceQuery,
  formatTransactionsCsv,
} from './expenseMemoryEngine.js';

export {
  EXPENSE_CATEGORIES,
  PAYMENT_APPS,
  DEFAULT_TAGS,
  QUICK_NOTE_CHIPS,
  parseSmsOrUpiTextJs,
  reconcileAndMergeTransactions,
  computeExpenseAnalytics,
  answerNaturalLanguageFinanceQuery,
  formatTransactionsCsv,
};

const LS_EXPENSE_PREFS_KEY = 'pattan.expenseMemory.prefs.v1';

const SMART_QUESTIONS = [
  'How much did I spend yesterday?',
  'How many transactions did I make this month?',
  'Show my food expenses.',
  "Which payments don't have notes?",
  'How much did I receive this week?',
  'Find my transactions above ₹1,000.',
];

function loadExpensePrefs() {
  try {
    const raw = localStorage.getItem(LS_EXPENSE_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        theme: p.theme || 'dark',
        onboardingDismissed: Boolean(p.onboardingDismissed),
        autoSmsScanEnabled: p.autoSmsScanEnabled !== false,
        cloudSyncConsent: p.cloudSyncConsent !== false,
        noteRemindersEnabled: p.noteRemindersEnabled !== false,
        preferredCategory: p.preferredCategory || 'food',
        preferredApp: p.preferredApp || 'GPay',
        recentSearches: Array.isArray(p.recentSearches) ? p.recentSearches.slice(0, 6) : [],
      };
    }
  } catch (_) {}
  return {
    theme: 'dark',
    onboardingDismissed: false,
    autoSmsScanEnabled: true,
    cloudSyncConsent: true,
    noteRemindersEnabled: true,
    preferredCategory: 'food',
    preferredApp: 'GPay',
    recentSearches: [],
  };
}

export default function ExpensesModule({
  expensesMap = {},
  onUpdateExpenses,
  selectedMonth,
  onChangeMonth,
  monthlyNetSalary = 25000,
  mobileMode = false,
}) {
  // User Preferences (Theme, Onboarding, Privacy & Sync Consent, Remembered Defaults)
  const [prefs, setPrefs] = useState(loadExpensePrefs);
  const updatePrefs = useCallback((patch) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(LS_EXPENSE_PREFS_KEY, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  }, []);

  const isLight = prefs.theme === 'light';

  // Sub-navigation inside Expense Memory:
  // 'overview' | 'transactions' | 'insights' | 'missing_notes' | 'settings'
  const [subTab, setSubTab] = useState('overview');

  // Undo History Stack (Phase 9)
  const [undoState, setUndoState] = useState(null); // { label, previousMap, timestamp }
  const [feedbackBanner, setFeedbackBanner] = useState('');

  const showFeedback = useCallback((msg, undoSnapshot = null) => {
    setFeedbackBanner(msg);
    if (undoSnapshot) {
      setUndoState({ label: msg, previousMap: undoSnapshot, timestamp: Date.now() });
    }
  }, []);

  const handleUndoLastAction = () => {
    if (!undoState || !undoState.previousMap) return;
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(undoState.previousMap, '↩️ Action undone — restored previous records');
    }
    setUndoState(null);
    setFeedbackBanner('↩️ Restored your previous state.');
  };

  // Quick-Add / Edit Transaction Modal & Form State
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [editingTxId, setEditingTxId] = useState(null);
  const [amountInput, setAmountInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [merchantInput, setMerchantInput] = useState('');
  const [selectedApp, setSelectedApp] = useState(() => prefs.preferredApp || 'GPay');
  const [selectedCategory, setSelectedCategory] = useState(() => prefs.preferredCategory || 'food');
  const [selectedSubcategory, setSelectedSubcategory] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [txType, setTxType] = useState('debit'); // 'debit' | 'credit' | 'refund' | 'transfer'
  const [txDate, setTxDate] = useState(getLocalIsoDate);
  const [txTime, setTxTime] = useState(getLocalTimeHHMM);

  // Detailed Transaction Viewer Modal State (Screen 3)
  const [detailViewTxId, setDetailViewTxId] = useState(null);

  // Inline Note Editing Drafts
  const [inlineNoteDrafts, setInlineNoteDrafts] = useState({});

  // Search & Advanced Filters (Screen 5 & Phase 7)
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterType, setFilterType] = useState('ALL'); // 'ALL' | 'debit' | 'credit' | 'refund' | 'transfer'
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterMethod, setFilterMethod] = useState('ALL');
  const [filterSource, setFilterSource] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterNoteState, setFilterNoteState] = useState('ALL'); // 'ALL' | 'has_note' | 'missing_note'
  const [filterReviewState, setFilterReviewState] = useState('ALL'); // 'ALL' | 'confirmed' | 'needs_review' | 'possible_duplicate'
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');

  // Smart Q&A Assistant State (Phase 8)
  const [qaQuery, setQaQuery] = useState('');
  const [qaResult, setQaResult] = useState(null);

  // Native Android Detection & Receipt Import State
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
  const [pasteSmsText, setPasteSmsText] = useState('');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  // Normalize all stored transactions
  const normalizedMap = useMemo(() => {
    const out = {};
    for (const [id, raw] of Object.entries(expensesMap || {})) {
      if (!raw || typeof raw !== 'object') continue;
      if (raw._deleted || raw.deleted) {
        out[id] = raw;
      } else {
        const norm = migrateAndNormalizeExpenseRecord(raw);
        if (norm) out[id] = norm;
      }
    }
    return out;
  }, [expensesMap]);

  const allActiveTransactions = useMemo(() => {
    return Object.values(normalizedMap)
      .filter((tx) => tx && !tx._deleted && !tx.deleted && Number(tx.amount) > 0)
      .sort((a, b) => (Number(b.timestampMs) || 0) - (Number(a.timestampMs) || 0));
  }, [normalizedMap]);

  const todayIso = getLocalIsoDate();
  const activeMonth = selectedMonth || todayIso.slice(0, 7);

  const monthTransactions = useMemo(() => {
    return allActiveTransactions.filter((tx) => String(tx.date || '').startsWith(activeMonth));
  }, [allActiveTransactions, activeMonth]);

  // Compute Analytics (Phase 8)
  const stats = useMemo(() => {
    return computeExpenseAnalytics(allActiveTransactions, {
      selectedMonth: activeMonth,
      todayIso,
      monthlyNetSalary,
    });
  }, [allActiveTransactions, activeMonth, todayIso, monthlyNetSalary]);

  // Missing-Note & Duplicate/Uncertain Queues (Phase 6 & 11)
  const missingNoteTransactions = useMemo(() => {
    return monthTransactions.filter(
      (tx) =>
        tx.status !== 'failed' &&
        tx.status !== 'reversed' &&
        tx.reconciliationStatus !== 'possible_duplicate' &&
        !(tx.note && tx.note.trim()) &&
        !tx.noteReviewed
    );
  }, [monthTransactions]);

  const reviewQueueTransactions = useMemo(() => {
    return monthTransactions.filter(
      (tx) =>
        tx.reconciliationStatus === 'possible_duplicate' ||
        tx.reconciliationStatus === 'needs_review' ||
        tx.status === 'failed' ||
        tx.status === 'reversed'
    );
  }, [monthTransactions]);

  // Reconcile incoming transactions from SMS / Notification / Receipt Import (Phase 11)
  const mergeMobileScannedTransactions = useCallback(
    (incomingList = []) => {
      if (!Array.isArray(incomingList) || incomingList.length === 0) return 0;
      const { nextMap, addedCount, mergedCount, duplicateFlaggedCount } =
        reconcileAndMergeTransactions(expensesMap, incomingList);

      const totalTouched = addedCount + mergedCount;
      if (totalTouched > 0 && typeof onUpdateExpenses === 'function') {
        const dupInfo = duplicateFlaggedCount > 0 ? ` (${duplicateFlaggedCount} flagged for duplicate review)` : '';
        onUpdateExpenses(
          nextMap,
          `📱 Synced ${addedCount} new & ${mergedCount} updated transaction${totalTouched === 1 ? '' : 's'}${dupInfo}`
        );
      }
      return totalTouched;
    },
    [expensesMap, onUpdateExpenses]
  );

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
        setScanStatusMsg(
          count > 0
            ? `✓ Added or updated ${count} transaction${count === 1 ? '' : 's'} from your phone.`
            : `✓ Checked ${list.length} mobile messages — your Expense Memory is up to date.`
        );
      } else if (detail.smsGranted === false && !detail.notifGranted) {
        setScanStatusMsg('Automatic tracking is turned off. You can still add expenses manually or import receipt text.');
      } else {
        setScanStatusMsg("We haven't found any new transactions yet.");
      }
    };
    window.addEventListener('pattan-mobile-transactions', onMobileTxEvent);
    return () => window.removeEventListener('pattan-mobile-transactions', onMobileTxEvent);
  }, [mergeMobileScannedTransactions]);

  // Silent background check ONLY if the user has already granted permission & enabled auto-scan
  useEffect(() => {
    try {
      if (window.PattanBiometric) {
        const hasPerm = Boolean(window.PattanBiometric.isSmsPermissionGranted?.());
        const hasNotif = Boolean(window.PattanBiometric.isNotificationListenerEnabled?.());
        setSmsGranted(hasPerm);
        setNotifGranted(hasNotif);
        if (prefs.autoSmsScanEnabled && (hasPerm || hasNotif)) {
          if (typeof window.PattanBiometric.scanMobileTransactionsSilent === 'function') {
            window.PattanBiometric.scanMobileTransactionsSilent(60);
          }
        }
      }
    } catch (_) {}
  }, [prefs.autoSmsScanEnabled]);

  // Explicit user-initiated SMS scan (requests permission only when user clicks this button)
  const triggerMobileTransactionScan = () => {
    setScanningMobile(true);
    try {
      if (window.PattanBiometric && typeof window.PattanBiometric.scanMobileTransactions === 'function') {
        setScanStatusMsg('📲 Checking your phone SMS & payment notifications locally...');
        window.PattanBiometric.scanMobileTransactions(90);
        setTimeout(() => setScanningMobile(false), 3500);
        return;
      }
    } catch (_) {}
    setScanningMobile(false);
    setShowPasteBox(true);
    setScanStatusMsg('Paste any bank SMS or payment receipt message below to extract its details.');
  };

  const handleOpenNotificationSettings = () => {
    try {
      if (window.PattanBiometric && typeof window.PattanBiometric.openNotificationListenerSettings === 'function') {
        window.PattanBiometric.openNotificationListenerSettings();
        setScanStatusMsg('Toggle notification access for this app in Android Settings to capture live payment alerts, or turn it off anytime.');
      } else {
        setScanStatusMsg('Notification access settings are available when running inside the Android APK.');
      }
    } catch (_) {}
  };

  // Smart Suggestions for current merchant input in Quick-Add
  const currentMerchantSuggestions = useMemo(() => {
    return suggestNotesAndCategoryForMerchant(merchantInput, allActiveTransactions);
  }, [merchantInput, allActiveTransactions]);

  const openQuickAddForNew = () => {
    setEditingTxId(null);
    setAmountInput('');
    setNoteInput('');
    setMerchantInput('');
    setSelectedApp(prefs.preferredApp || 'GPay');
    setSelectedCategory(prefs.preferredCategory || 'food');
    setSelectedSubcategory('');
    setSelectedTags([]);
    setTxType('debit');
    setTxDate(getLocalIsoDate());
    setTxTime(getLocalTimeHHMM());
    setShowQuickAddModal(true);
  };

  const openEditModalForTx = (tx) => {
    if (!tx) return;
    setEditingTxId(tx.id);
    setAmountInput(String(tx.amount || ''));
    setNoteInput(String(tx.note || ''));
    setMerchantInput(String(tx.merchant || ''));
    setSelectedApp(tx.app || 'GPay');
    setSelectedCategory(tx.category || 'food');
    setSelectedSubcategory(tx.subcategory || '');
    setSelectedTags(Array.isArray(tx.tags) ? tx.tags : []);
    setTxType(tx.type || 'debit');
    setTxDate(tx.date || getLocalIsoDate());
    setTxTime(tx.time || getLocalTimeHHMM());
    setShowQuickAddModal(true);
  };

  // Save new or edited transaction (Phase 5 & 9)
  const handleSaveTransactionForm = () => {
    const cleanAmount = parseFloat(String(amountInput || '').replace(/,/g, ''));
    if (!cleanAmount || cleanAmount <= 0) {
      setScanStatusMsg('⚠️ Please enter a valid amount greater than ₹0.');
      return;
    }
    const prevSnapshot = { ...expensesMap };
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const cleanNote = String(noteInput || '').trim();
    const cleanMerchant =
      String(merchantInput || '').trim() ||
      (cleanNote ? cleanNote : txType === 'credit' ? 'Payment Received' : `${selectedApp} Expense`);

    const id = editingTxId || `tx_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;
    const existing = editingTxId ? normalizedMap[editingTxId] : null;

    const record = migrateAndNormalizeExpenseRecord({
      ...(existing || {}),
      id,
      amount: Number(cleanAmount.toFixed(2)),
      type: txType,
      status: existing?.status || 'completed',
      reconciliationStatus: existing ? 'confirmed' : 'user_entered',
      merchant: cleanMerchant,
      originalMerchant: existing?.originalMerchant || cleanMerchant,
      originalRemark: existing?.originalRemark || '',
      note: cleanNote,
      noteReviewed: true,
      category: txType === 'credit' ? 'income' : txType === 'refund' ? 'refund' : txType === 'transfer' ? 'transfer' : selectedCategory,
      subcategory: selectedSubcategory,
      tags: selectedTags,
      app: selectedApp,
      date: txDate || getLocalIsoDate(),
      time: txTime || getLocalTimeHHMM(),
      timestampMs: existing?.timestampMs || nowMs,
      source: existing?.source || 'manual-mobile',
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      updatedAtMs: nowMs,
    });

    updatePrefs({
      preferredCategory: selectedCategory,
      preferredApp: selectedApp,
    });

    const nextMap = { ...expensesMap, [id]: record };
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(
        nextMap,
        editingTxId
          ? `✓ Updated ₹${formatINR(cleanAmount)} (${cleanMerchant})`
          : `✓ Saved ₹${formatINR(cleanAmount)}${cleanNote ? ` — "${cleanNote}"` : ''}`
      );
    }
    showFeedback(
      editingTxId
        ? `Updated transaction for ${cleanMerchant}`
        : `Added ₹${formatINR(cleanAmount)}${cleanNote ? ` ("${cleanNote}")` : ''}`,
      prevSnapshot
    );
    setShowQuickAddModal(false);
    setEditingTxId(null);
  };

  const handleUpdateTransactionPatch = (txId, patch, feedbackLabel = 'Saved changes') => {
    const existing = normalizedMap[txId];
    if (!existing) return;
    const prevSnapshot = { ...expensesMap };
    const nowMs = Date.now();
    const updated = migrateAndNormalizeExpenseRecord({
      ...existing,
      ...patch,
      noteReviewed: patch.note !== undefined ? Boolean(patch.note || patch.noteReviewed) : existing.noteReviewed,
      updatedAt: new Date(nowMs).toISOString(),
      updatedAtMs: nowMs,
    });
    const nextMap = { ...expensesMap, [txId]: updated };
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(nextMap, `✓ ${feedbackLabel}`);
    }
    showFeedback(feedbackLabel, prevSnapshot);
  };

  const handleDeleteTransaction = (txId) => {
    const existing = normalizedMap[txId];
    if (!existing) return;
    const prevSnapshot = { ...expensesMap };
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
      onUpdateExpenses(nextMap, `🗑️ Deleted ₹${formatINR(existing.amount)} (${existing.merchant})`);
    }
    showFeedback(`Deleted ₹${formatINR(existing.amount)} (${existing.merchant})`, prevSnapshot);
    if (detailViewTxId === txId) setDetailViewTxId(null);
  };

  const handlePermanentDeleteAll = () => {
    const prevSnapshot = { ...expensesMap };
    const nowMs = Date.now();
    const clearedMap = {};
    for (const [k, v] of Object.entries(expensesMap || {})) {
      if (v && typeof v === 'object') {
        clearedMap[k] = { ...v, _deleted: true, updatedAtMs: nowMs };
      }
    }
    try {
      window.PattanBiometric?.clearSavedMobileTransactions?.();
    } catch (_) {}
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(clearedMap, '🗑️ All expense records deleted');
    }
    setConfirmDeleteAll(false);
    showFeedback('All Expense Memory records were deleted.', prevSnapshot);
  };

  const handleParsePastedSms = () => {
    const blocks = String(pasteSmsText || '')
      .split(/\n{2,}|\r\n\r\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedList = [];
    for (const block of blocks.length ? blocks : [pasteSmsText]) {
      const p = parseSmsOrUpiTextJs(block, Date.now(), 'receipt-import');
      if (p) parsedList.push(p);
    }
    if (parsedList.length === 0) {
      setScanStatusMsg('Could not find a valid ₹ / Rs. transaction amount in that text. Please check and try again.');
      return;
    }
    mergeMobileScannedTransactions(parsedList);
    setPasteSmsText('');
    setShowPasteBox(false);
    showFeedback(`Imported ${parsedList.length} transaction${parsedList.length === 1 ? '' : 's'} from text.`);
  };

  // Filtered Transactions for Complete Transaction History (Phase 7)
  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const minAmt = filterMinAmount !== '' ? parseFloat(filterMinAmount) : null;
    const maxAmt = filterMaxAmount !== '' ? parseFloat(filterMaxAmount) : null;

    const baseList = filterDateFrom || filterDateTo ? allActiveTransactions : monthTransactions;

    return baseList.filter((tx) => {
      if (filterDateFrom && tx.date < filterDateFrom) return false;
      if (filterDateTo && tx.date > filterDateTo) return false;
      if (minAmt !== null && !Number.isNaN(minAmt) && tx.amount < minAmt) return false;
      if (maxAmt !== null && !Number.isNaN(maxAmt) && tx.amount > maxAmt) return false;
      if (filterType !== 'ALL' && tx.type !== filterType) return false;
      if (filterCategory !== 'ALL' && tx.category !== filterCategory) return false;
      if (filterMethod !== 'ALL' && tx.paymentMethod !== filterMethod && tx.app !== filterMethod) return false;
      if (filterSource !== 'ALL' && !String(tx.source || '').includes(filterSource)) return false;
      if (filterStatus !== 'ALL' && tx.status !== filterStatus) return false;
      if (filterNoteState === 'has_note' && !(tx.note && tx.note.trim())) return false;
      if (filterNoteState === 'missing_note' && (Boolean(tx.note && tx.note.trim()) || tx.noteReviewed)) return false;
      if (filterReviewState === 'confirmed' && (tx.reconciliationStatus === 'possible_duplicate' || tx.reconciliationStatus === 'needs_review')) return false;
      if (filterReviewState === 'needs_review' && tx.reconciliationStatus !== 'needs_review') return false;
      if (filterReviewState === 'possible_duplicate' && tx.reconciliationStatus !== 'possible_duplicate') return false;
      if (q) {
        const hay = `${tx.merchant} ${tx.originalMerchant} ${tx.note} ${tx.originalRemark} ${tx.category} ${tx.subcategory} ${(tx.tags || []).join(' ')} ${tx.app} ${tx.paymentMethod} ${tx.refId} ${tx.amount} ${tx.date}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    allActiveTransactions,
    monthTransactions,
    searchQuery,
    filterDateFrom,
    filterDateTo,
    filterMinAmount,
    filterMaxAmount,
    filterType,
    filterCategory,
    filterMethod,
    filterSource,
    filterStatus,
    filterNoteState,
    filterReviewState,
  ]);

  // Group filtered transactions by Day with daily totals (Phase 7)
  const groupedByDay = useMemo(() => {
    const groups = [];
    const map = new Map();
    for (const tx of filteredTransactions) {
      const d = tx.date || todayIso;
      if (!map.has(d)) {
        const g = { date: d, items: [], daySpent: 0, dayReceived: 0 };
        map.set(d, g);
        groups.push(g);
      }
      const g = map.get(d);
      g.items.push(tx);
      if (tx.status !== 'failed' && tx.status !== 'reversed' && tx.reconciliationStatus !== 'possible_duplicate') {
        if (tx.type === 'debit') g.daySpent += tx.amount;
        else if (tx.type === 'refund') g.daySpent = Math.max(0, g.daySpent - tx.amount);
        else if (tx.type === 'credit') g.dayReceived += tx.amount;
      }
    }
    return groups;
  }, [filteredTransactions, todayIso]);

  // Export CSV (Phase 8 & 10)
  const handleExportCsv = () => {
    const csvContent = formatTransactionsCsv(filteredTransactions, stats);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Expense-Memory-${activeMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showFeedback('Your report is ready (CSV downloaded).');
  };

  // Export JSON Backup (Phase 10)
  const handleExportJsonBackup = () => {
    const payload = {
      module: 'ExpenseMemory',
      version: 2,
      exportedAt: new Date().toISOString(),
      containsSensitiveFields: ['merchant', 'note', 'originalRemark', 'refId', 'amount'],
      expenses: normalizedMap,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Expense-Memory-Backup-${activeMonth}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showFeedback('Your JSON backup is ready.');
  };

  // Ask Smart Question handler
  const handleRunSmartQuestion = (qText) => {
    const queryStr = qText !== undefined ? qText : qaQuery;
    setQaQuery(queryStr);
    const res = answerNaturalLanguageFinanceQuery(queryStr, allActiveTransactions, todayIso);
    setQaResult(res);
    if (queryStr && queryStr.trim()) {
      const nextRecent = [queryStr.trim(), ...(prefs.recentSearches || []).filter((s) => s !== queryStr.trim())].slice(0, 5);
      updatePrefs({ recentSearches: nextRecent });
    }
  };

  // Theme Design Tokens (Phase 2)
  const palette = isLight
    ? {
        surfaceBg: '#f8fafc',
        cardBg: '#ffffff',
        cardAltBg: '#f1f5f9',
        border: '#e2e8f0',
        textPrimary: '#0f172a',
        textSecondary: '#475569',
        textMuted: '#64748b',
        primary: '#0284c7',
        incomeGreen: '#15803d',
        expenseWarm: '#be123c',
        inputBg: '#ffffff',
      }
    : {
        surfaceBg: '#0b1120',
        cardBg: '#111827',
        cardAltBg: '#0f172a',
        border: 'rgba(148, 163, 184, 0.2)',
        textPrimary: '#f8fafc',
        textSecondary: '#cbd5e1',
        textMuted: '#94a3b8',
        primary: '#38bdf8',
        incomeGreen: '#34d399',
        expenseWarm: '#fda4af',
        inputBg: '#090d16',
      };

  const getCategoryMeta = (catId) =>
    EXPENSE_CATEGORIES.find((c) => c.id === catId) || EXPENSE_CATEGORIES[0];

  const detailTx = detailViewTxId ? normalizedMap[detailViewTxId] : null;
  const detailSuggestions = useMemo(() => {
    if (!detailTx) return { suggestedNotes: [], suggestedCategory: null };
    return suggestNotesAndCategoryForMerchant(detailTx.merchant, allActiveTransactions);
  }, [detailTx, allActiveTransactions]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        background: palette.surfaceBg,
        color: palette.textPrimary,
        padding: mobileMode ? 10 : 16,
        borderRadius: 20,
        border: `1px solid ${palette.border}`,
        transition: 'background 0.2s ease, color 0.2s ease',
      }}
    >
      {/* WELCOME HEADER (Phase 2) */}
      <div
        style={{
          padding: mobileMode ? '14px' : '16px 20px',
          borderRadius: 18,
          background: palette.cardBg,
          border: `1px solid ${palette.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
          boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
        }}
      >
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: palette.primary, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            ✨ EXPENSE MEMORY • PERSONAL FINANCE ASSISTANT
          </div>
          <h2 style={{ margin: '3px 0 2px', fontSize: mobileMode ? 20 : 22, fontWeight: 900, color: palette.textPrimary }}>
            Let&apos;s check your money.
          </h2>
          <div style={{ fontSize: 12.5, color: palette.textSecondary }}>
            Every spend, payment note, and transaction organized automatically on your phone.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="month"
            aria-label="Select month period"
            value={activeMonth}
            onChange={(e) => onChangeMonth && onChangeMonth(e.target.value)}
            style={{
              padding: '8px 11px',
              borderRadius: 10,
              border: `1px solid ${palette.border}`,
              background: palette.inputBg,
              color: palette.textPrimary,
              fontWeight: 800,
              fontSize: 13,
            }}
          />
          <button
            type="button"
            onClick={() => updatePrefs({ theme: isLight ? 'dark' : 'light' })}
            title="Switch Light / Dark theme"
            style={{
              padding: '8px 11px',
              borderRadius: 10,
              border: `1px solid ${palette.border}`,
              background: palette.cardAltBg,
              color: palette.textPrimary,
              fontWeight: 800,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {isLight ? '🌙 Dark' : '☀️ Light'}
          </button>
          <button
            type="button"
            onClick={openQuickAddForNew}
            style={{
              padding: '9px 14px',
              borderRadius: 10,
              border: 'none',
              background: 'linear-gradient(135deg, #0284c7, #2563eb)',
              color: '#fff',
              fontWeight: 900,
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(2, 132, 199, 0.3)',
            }}
          >
            ➕ Add Expense
          </button>
        </div>
      </div>

      {/* UNDO & FEEDBACK BANNER (Phase 9) */}
      {(feedbackBanner || scanStatusMsg) && (
        <div
          role="status"
          style={{
            padding: '10px 14px',
            borderRadius: 12,
            background: isLight ? '#ecfeff' : 'rgba(14, 165, 233, 0.14)',
            border: `1px solid ${palette.primary}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            fontSize: 12.5,
            fontWeight: 700,
          }}
        >
          <span>{feedbackBanner || scanStatusMsg}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {undoState && (
              <button
                type="button"
                onClick={handleUndoLastAction}
                style={{
                  padding: '5px 11px',
                  borderRadius: 8,
                  border: `1px solid ${palette.primary}`,
                  background: palette.cardBg,
                  color: palette.textPrimary,
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                ↩️ Undo
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setFeedbackBanner('');
                setScanStatusMsg('');
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: palette.textMuted,
                cursor: 'pointer',
                fontWeight: 900,
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* SUB-NAVIGATION BAR (Phase 2: Overview | Transactions | Insights | Missing Notes | Settings) */}
      <nav
        aria-label="Expense Memory navigation"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 6,
          padding: 5,
          borderRadius: 14,
          background: palette.cardBg,
          border: `1px solid ${palette.border}`,
        }}
      >
        {[
          { id: 'overview', icon: '🏠', label: 'Overview' },
          { id: 'transactions', icon: '📋', label: 'Transactions', badge: stats.monthTxCount },
          { id: 'insights', icon: '📊', label: 'Insights' },
          {
            id: 'missing_notes',
            icon: '📝',
            label: 'Missing Notes',
            badge: missingNoteTransactions.length + reviewQueueTransactions.length,
            alert: missingNoteTransactions.length + reviewQueueTransactions.length > 0,
          },
          { id: 'settings', icon: '⚙️', label: 'Settings' },
        ].map((tab) => {
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              style={{
                padding: mobileMode ? '8px 4px' : '9px 10px',
                borderRadius: 10,
                border: active ? `1.5px solid ${palette.primary}` : '1px solid transparent',
                background: active
                  ? isLight
                    ? '#e0f2fe'
                    : 'rgba(56, 189, 248, 0.16)'
                  : 'transparent',
                color: active ? palette.textPrimary : palette.textMuted,
                fontWeight: 800,
                fontSize: mobileMode ? 11 : 12.5,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: mobileMode ? 'column' : 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
              }}
            >
              <span>{tab.icon}</span>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                {tab.label}
              </span>
              {tab.badge > 0 && (
                <span
                  style={{
                    padding: '1px 6px',
                    borderRadius: 999,
                    fontSize: 10,
                    fontWeight: 900,
                    background: tab.alert ? 'rgba(244, 63, 94, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                    color: tab.alert ? palette.expenseWarm : palette.primary,
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* FIRST-RUN ONBOARDING & PERMISSION EXPLANATION CARD (Screen 11 — Non-intrusive & Dismissible) */}
      {!prefs.onboardingDismissed && subTab === 'overview' && (
        <div
          style={{
            padding: 16,
            borderRadius: 16,
            background: isLight ? '#f0f9ff' : 'rgba(15, 23, 42, 0.95)',
            border: `1px solid ${palette.primary}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: palette.textPrimary }}>
                👋 Welcome to Expense Memory — How Your Privacy &amp; Tracking Work
              </div>
              <div style={{ fontSize: 12, color: palette.textSecondary, marginTop: 4, lineHeight: 1.55 }}>
                • <strong>100% Manual or Automatic:</strong> You can add expenses manually at any time without granting permissions.
                <br />• <strong>Optional Smart Detection:</strong> If you choose to scan Bank SMS or enable Payment App notifications, messages are parsed <strong>locally on your phone</strong> to extract the amount, merchant, and any payment remark.
                <br />• <strong>Strict Security:</strong> We never read OTPs, PINs, or passwords, and never initiate or authorize payments.
              </div>
            </div>
            <button
              type="button"
              onClick={() => updatePrefs({ onboardingDismissed: true })}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: `1px solid ${palette.border}`,
                background: palette.cardBg,
                color: palette.textSecondary,
                fontWeight: 800,
                fontSize: 11.5,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Got it ✓
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={triggerMobileTransactionScan}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: `1px solid ${palette.primary}`,
                background: 'rgba(2, 132, 199, 0.18)',
                color: palette.textPrimary,
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              📲 Scan Phone SMS (Optional)
            </button>
            <button
              type="button"
              onClick={() => setShowPasteBox((v) => !v)}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: `1px solid ${palette.border}`,
                background: palette.cardBg,
                color: palette.textPrimary,
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              📋 Paste SMS / Receipt Text
            </button>
            <button
              type="button"
              onClick={openQuickAddForNew}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: `1px solid ${palette.border}`,
                background: palette.cardBg,
                color: palette.textPrimary,
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              ✍️ Add Expense Manually
            </button>
          </div>
        </div>
      )}

      {/* RECEIPT / SMS TEXT PASTE IMPORTER DRAWER */}
      {showPasteBox && (
        <div
          style={{
            padding: 14,
            borderRadius: 16,
            background: palette.cardBg,
            border: `1px solid ${palette.primary}`,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 6 }}>
            📋 Import Bank SMS or Payment Receipt Text
          </div>
          <div style={{ fontSize: 11.5, color: palette.textMuted, marginBottom: 8 }}>
            Paste one or more SMS/UPI messages (separated by a blank line). Works without granting SMS permissions.
          </div>
          <textarea
            rows={3}
            value={pasteSmsText}
            onChange={(e) => setPasteSmsText(e.target.value)}
            placeholder="Example: Rs. 240.00 debited from A/c XX1234 on 19-10-26 to VPA swiggy@axisbank. UPI/429311223344/Swiggy/Lunch with team"
            style={{
              width: '100%',
              padding: 10,
              borderRadius: 10,
              border: `1px solid ${palette.border}`,
              background: palette.inputBg,
              color: palette.textPrimary,
              fontSize: 12.5,
              fontFamily: 'inherit',
              marginBottom: 8,
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleParsePastedSms}
              style={{
                padding: '8px 14px',
                borderRadius: 9,
                border: 'none',
                background: '#0284c7',
                color: '#fff',
                fontWeight: 800,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              ✓ Extract &amp; Save to Expense Memory
            </button>
            <button
              type="button"
              onClick={() => setShowPasteBox(false)}
              style={{
                padding: '8px 12px',
                borderRadius: 9,
                border: `1px solid ${palette.border}`,
                background: 'transparent',
                color: palette.textMuted,
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          SCREEN 1: OVERVIEW — THE USER'S FRIENDLY MONEY HOME (Phase 2 & 3)
         ===================================================================== */}
      {subTab === 'overview' && (
        <>
          {/* MAIN SPENDING CARD */}
          <div
            style={{
              padding: mobileMode ? 16 : 20,
              borderRadius: 18,
              background: palette.cardBg,
              border: `1px solid ${palette.border}`,
              boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: palette.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Net Spending ({activeMonth})
                </div>
                <div style={{ fontSize: mobileMode ? 30 : 34, fontWeight: 900, color: palette.textPrimary, marginTop: 4 }}>
                  ₹{formatINR(stats.netSpending)}
                </div>
                <div style={{ fontSize: 12, color: palette.textSecondary, marginTop: 4 }}>
                  Gross Expenses: <strong>₹{formatINR(stats.grossExpenses)}</strong>
                  {stats.refundsTotal > 0 && (
                    <span style={{ color: palette.incomeGreen }}> · Refunds: -₹{formatINR(stats.refundsTotal)}</span>
                  )}
                  {stats.selfTransfersTotal > 0 && (
                    <span> · Self-Transfers (Excluded): ₹{formatINR(stats.selfTransfersTotal)}</span>
                  )}
                </div>
                {stats.periodComparisonPct !== null && (
                  <div style={{ fontSize: 11.5, color: palette.textMuted, marginTop: 4 }}>
                    {stats.periodComparisonPct > 0
                      ? `▲ ${stats.periodComparisonPct}% vs previous month (₹${formatINR(stats.prevMonthNetSpend)})`
                      : stats.periodComparisonPct < 0
                        ? `▼ ${Math.abs(stats.periodComparisonPct)}% less than previous month (₹${formatINR(stats.prevMonthNetSpend)})`
                        : `Same as previous month (₹${formatINR(stats.prevMonthNetSpend)})`}
                  </div>
                )}
              </div>

              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 14,
                  background: palette.cardAltBg,
                  border: `1px solid ${palette.border}`,
                  minWidth: 170,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted }}>Money Received ({activeMonth})</div>
                <div style={{ fontSize: 19, fontWeight: 900, color: palette.incomeGreen, marginTop: 2 }}>
                  + ₹{formatINR(stats.incomeTotal)}
                </div>
                <div style={{ fontSize: 11.5, color: palette.textSecondary, marginTop: 4 }}>
                  Salary Left: <strong>₹{formatINR(stats.remainingSalary)}</strong>
                </div>
              </div>
            </div>

            {/* QUICK STATISTICS (4 CARDS: Spent today, Received today, Transactions this month, Missing notes) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: mobileMode ? '1fr 1fr' : 'repeat(4, 1fr)',
                gap: 10,
                marginTop: 16,
              }}
            >
              <div style={{ padding: 12, borderRadius: 13, background: palette.cardAltBg, border: `1px solid ${palette.border}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Spent Today</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: palette.expenseWarm, marginTop: 3 }}>
                  ₹{formatINR(stats.todaySpent)}
                </div>
                <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}>{stats.todayCount} today</div>
              </div>

              <div style={{ padding: 12, borderRadius: 13, background: palette.cardAltBg, border: `1px solid ${palette.border}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Received Today</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: palette.incomeGreen, marginTop: 3 }}>
                  + ₹{formatINR(stats.todayReceived)}
                </div>
                <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}>Incoming today</div>
              </div>

              <div
                onClick={() => setSubTab('transactions')}
                style={{ padding: 12, borderRadius: 13, background: palette.cardAltBg, border: `1px solid ${palette.border}`, cursor: 'pointer' }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Transactions This Month</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: palette.primary, marginTop: 3 }}>
                  {stats.monthTxCount} Done
                </div>
                <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}>
                  {stats.monthExpenseCount} spent · {stats.monthIncomeCount} received
                </div>
              </div>

              <div
                onClick={() => setSubTab('missing_notes')}
                style={{ padding: 12, borderRadius: 13, background: palette.cardAltBg, border: `1px solid ${palette.border}`, cursor: 'pointer' }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Transactions Missing Notes</div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 900,
                    color: missingNoteTransactions.length > 0 ? '#f59e0b' : palette.incomeGreen,
                    marginTop: 3,
                  }}
                >
                  {missingNoteTransactions.length === 0 ? 'All Caught Up ✓' : `${missingNoteTransactions.length} Need Note`}
                </div>
                <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}>
                  {stats.noteCompletionPct}% have notes
                </div>
              </div>
            </div>
          </div>

          {/* FRIENDLY ACTION AREA (Phase 2: Add transaction, Review missing notes, View all transactions, Export report) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: mobileMode ? '1fr 1fr' : 'repeat(4, 1fr)',
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={openQuickAddForNew}
              style={{
                padding: '11px 12px',
                borderRadius: 12,
                border: `1px solid ${palette.primary}`,
                background: palette.cardBg,
                color: palette.textPrimary,
                fontWeight: 800,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              ➕ Add Transaction
            </button>
            <button
              type="button"
              onClick={() => setSubTab('missing_notes')}
              style={{
                padding: '11px 12px',
                borderRadius: 12,
                border: `1px solid ${palette.border}`,
                background: palette.cardBg,
                color: palette.textPrimary,
                fontWeight: 800,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              📝 Review Missing Notes ({missingNoteTransactions.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('transactions')}
              style={{
                padding: '11px 12px',
                borderRadius: 12,
                border: `1px solid ${palette.border}`,
                background: palette.cardBg,
                color: palette.textPrimary,
                fontWeight: 800,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              📋 View All Transactions ({stats.monthTxCount})
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              style={{
                padding: '11px 12px',
                borderRadius: 12,
                border: `1px solid ${palette.border}`,
                background: palette.cardBg,
                color: palette.textPrimary,
                fontWeight: 800,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              📥 Export Report (CSV)
            </button>
          </div>

          {/* ATTENTION BANNER IF DUPLICATES OR UNCERTAIN TRANSACTIONS EXIST */}
          {reviewQueueTransactions.length > 0 && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 14,
                background: isLight ? '#fffbeb' : 'rgba(245, 158, 11, 0.14)',
                border: '1px solid rgba(245, 158, 11, 0.5)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>
                🔍 <strong>Please check these details:</strong> {reviewQueueTransactions.length} transaction
                {reviewQueueTransactions.length === 1 ? ' needs' : 's need'} your quick review (possible duplicate or uncertain details).
              </div>
              <button
                type="button"
                onClick={() => setSubTab('missing_notes')}
                style={{
                  padding: '6px 12px',
                  borderRadius: 9,
                  border: '1px solid #f59e0b',
                  background: palette.cardBg,
                  color: palette.textPrimary,
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Review Now →
              </button>
            </div>
          )}

          {/* RECENT ACTIVITY (Phase 2) */}
          <div
            style={{
              padding: 16,
              borderRadius: 18,
              background: palette.cardBg,
              border: `1px solid ${palette.border}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 900 }}>🕒 Recent Activity</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={triggerMobileTransactionScan}
                  disabled={scanningMobile}
                  style={{
                    padding: '6px 11px',
                    borderRadius: 9,
                    border: `1px solid ${palette.primary}`,
                    background: 'transparent',
                    color: palette.primary,
                    fontWeight: 800,
                    fontSize: 11.5,
                    cursor: 'pointer',
                  }}
                >
                  {scanningMobile ? 'Scanning...' : '📲 Scan Phone SMS'}
                </button>
                {monthTransactions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSubTab('transactions')}
                    style={{
                      padding: '6px 11px',
                      borderRadius: 9,
                      border: `1px solid ${palette.border}`,
                      background: 'transparent',
                      color: palette.textSecondary,
                      fontWeight: 800,
                      fontSize: 11.5,
                      cursor: 'pointer',
                    }}
                  >
                    See All →
                  </button>
                )}
              </div>
            </div>

            {monthTransactions.length === 0 ? (
              /* Friendly Empty State (Phase 2) */
              <div
                style={{
                  padding: 24,
                  borderRadius: 14,
                  background: palette.cardAltBg,
                  border: `1px dashed ${palette.border}`,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 6 }}>🌱</div>
                <div style={{ fontSize: 15, fontWeight: 900, color: palette.textPrimary }}>
                  Your money story starts here.
                </div>
                <div style={{ fontSize: 12.5, color: palette.textMuted, marginTop: 4, maxWidth: 420, marginInline: 'auto' }}>
                  We haven&apos;t found any transactions for {activeMonth} yet. Add your first expense manually or scan your phone&apos;s bank &amp; UPI messages.
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={openQuickAddForNew}
                    style={{
                      padding: '9px 14px',
                      borderRadius: 10,
                      border: 'none',
                      background: '#0284c7',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: 12.5,
                      cursor: 'pointer',
                    }}
                  >
                    ➕ Add an Expense
                  </button>
                  <button
                    type="button"
                    onClick={triggerMobileTransactionScan}
                    style={{
                      padding: '9px 14px',
                      borderRadius: 10,
                      border: `1px solid ${palette.border}`,
                      background: palette.cardBg,
                      color: palette.textPrimary,
                      fontWeight: 800,
                      fontSize: 12.5,
                      cursor: 'pointer',
                    }}
                  >
                    📲 Scan SMS Inbox
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {monthTransactions.slice(0, 6).map((tx) => {
                  const cat = getCategoryMeta(tx.category);
                  const isCredit = tx.type === 'credit';
                  const isRefund = tx.type === 'refund';
                  const isTransfer = tx.type === 'transfer';
                  const draftNote = inlineNoteDrafts[tx.id] !== undefined ? inlineNoteDrafts[tx.id] : tx.note || '';

                  return (
                    <div
                      key={tx.id}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 14,
                        background: palette.cardAltBg,
                        border: `1px solid ${palette.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div
                        onClick={() => setDetailViewTxId(tx.id)}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <div
                            style={{
                              width: 38,
                              height: 38,
                              borderRadius: 11,
                              background: cat.bg,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 18,
                              flexShrink: 0,
                            }}
                          >
                            {cat.icon}
                          </div>
                          <div>
                            <div style={{ fontSize: 13.5, fontWeight: 800, color: palette.textPrimary }}>
                              {tx.merchant}
                              {tx.reconciliationStatus === 'possible_duplicate' && (
                                <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 6, background: 'rgba(245,158,11,0.2)', color: '#fbbf24' }}>
                                  Possible Duplicate
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11.5, color: palette.textMuted, marginTop: 2 }}>
                              {cat.label} · {tx.app} ({tx.paymentMethod}) · {tx.date} at {formatTime12h(tx.time)}
                            </div>
                          </div>
                        </div>

                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div
                            style={{
                              fontSize: 15,
                              fontWeight: 900,
                              color: isCredit || isRefund ? palette.incomeGreen : isTransfer ? palette.primary : palette.expenseWarm,
                            }}
                          >
                            {isCredit ? '+ ₹' : isRefund ? '↩️ + ₹' : isTransfer ? '🔄 ₹' : '- ₹'}
                            {formatINR(tx.amount)}
                          </div>
                          <div style={{ fontSize: 10.5, color: palette.textMuted }}>Tap for details</div>
                        </div>
                      </div>

                      {/* Fast inline note entry (Phase 6 & 9) */}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="text"
                          aria-label={`Payment note for ${tx.merchant}`}
                          value={draftNote}
                          onChange={(e) => setInlineNoteDrafts((p) => ({ ...p, [tx.id]: e.target.value }))}
                          onBlur={() => {
                            if (inlineNoteDrafts[tx.id] !== undefined && inlineNoteDrafts[tx.id].trim() !== (tx.note || '')) {
                              handleUpdateTransactionPatch(tx.id, { note: inlineNoteDrafts[tx.id].trim() }, 'Saved payment note');
                            }
                          }}
                          placeholder={tx.originalRemark ? `Remark: ${tx.originalRemark} (Tap to edit note)` : '➕ Add a note: why did you spend this?'}
                          style={{
                            flex: 1,
                            padding: '6px 10px',
                            borderRadius: 9,
                            border: `1px solid ${tx.note ? palette.border : 'rgba(245, 158, 11, 0.45)'}`,
                            background: palette.inputBg,
                            color: palette.textPrimary,
                            fontSize: 12,
                          }}
                        />
                        {inlineNoteDrafts[tx.id] !== undefined && inlineNoteDrafts[tx.id].trim() !== (tx.note || '') && (
                          <button
                            type="button"
                            onClick={() => handleUpdateTransactionPatch(tx.id, { note: inlineNoteDrafts[tx.id].trim() }, 'Saved payment note')}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 8,
                              border: 'none',
                              background: '#059669',
                              color: '#fff',
                              fontWeight: 800,
                              fontSize: 11.5,
                              cursor: 'pointer',
                            }}
                          >
                            Save
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SPENDING BREAKDOWN — TAP A CATEGORY TO OPEN ITS TRANSACTIONS (Phase 2) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: mobileMode ? '1fr' : '1.2fr 1fr',
              gap: 12,
            }}
          >
            <div style={{ padding: 16, borderRadius: 18, background: palette.cardBg, border: `1px solid ${palette.border}` }}>
              <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 4 }}>📊 Spending by Category</div>
              <div style={{ fontSize: 11.5, color: palette.textMuted, marginBottom: 12 }}>
                Tap any category to open its transactions.
              </div>
              {Object.keys(stats.byCategory).length === 0 ? (
                <div style={{ fontSize: 12.5, color: palette.textMuted, padding: '12px 0' }}>
                  No category spending recorded for {activeMonth} yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {Object.entries(stats.byCategory)
                    .sort((a, b) => b[1].amount - a[1].amount)
                    .map(([catId, info]) => {
                      const cat = getCategoryMeta(catId);
                      const pct = stats.grossExpenses > 0 ? Math.round((info.amount / stats.grossExpenses) * 100) : 0;
                      return (
                        <div
                          key={catId}
                          onClick={() => {
                            setFilterCategory(catId);
                            setSubTab('transactions');
                          }}
                          style={{
                            padding: '9px 11px',
                            borderRadius: 11,
                            background: palette.cardAltBg,
                            border: `1px solid ${palette.border}`,
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, fontWeight: 800 }}>
                            <span>
                              {cat.icon} {cat.label} ({info.count})
                            </span>
                            <span>
                              ₹{formatINR(info.amount)} ({pct}%)
                            </span>
                          </div>
                          <div style={{ height: 6, borderRadius: 999, background: 'rgba(148,163,184,0.18)', marginTop: 6, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.max(4, pct)}%`, height: '100%', background: cat.color, borderRadius: 999 }} />
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            <div style={{ padding: 16, borderRadius: 18, background: palette.cardBg, border: `1px solid ${palette.border}` }}>
              <div style={{ fontSize: 14, fontWeight: 900, marginBottom: 4 }}>💳 Payment Method Breakdown</div>
              <div style={{ fontSize: 11.5, color: palette.textMuted, marginBottom: 12 }}>
                How you paid or received money in {activeMonth}.
              </div>
              {Object.keys(stats.byApp).length === 0 ? (
                <div style={{ fontSize: 12.5, color: palette.textMuted, padding: '12px 0' }}>
                  No payment methods recorded yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(stats.byApp)
                    .sort((a, b) => b[1].count - a[1].count)
                    .map(([appName, info]) => (
                      <div
                        key={appName}
                        onClick={() => {
                          setFilterMethod(appName);
                          setSubTab('transactions');
                        }}
                        style={{
                          padding: '9px 11px',
                          borderRadius: 11,
                          background: palette.cardAltBg,
                          border: `1px solid ${palette.border}`,
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 12.5,
                          cursor: 'pointer',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 800 }}>{appName}</div>
                          <div style={{ fontSize: 11, color: palette.textMuted }}>{info.count} transactions</div>
                        </div>
                        <div style={{ textAlign: 'right', fontWeight: 800 }}>
                          {info.spent > 0 && <div style={{ color: palette.expenseWarm }}>- ₹{formatINR(info.spent)}</div>}
                          {info.received > 0 && <div style={{ color: palette.incomeGreen }}>+ ₹{formatINR(info.received)}</div>}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* =====================================================================
          SCREEN 2 & 5: COMPLETE TRANSACTION HISTORY + SEARCH & FILTERS (Phase 7)
         ===================================================================== */}
      {subTab === 'transactions' && (
        <div style={{ padding: 16, borderRadius: 18, background: palette.cardBg, border: `1px solid ${palette.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900 }}>📋 Complete Transaction History</div>
              <div style={{ fontSize: 12, color: palette.textMuted }}>
                Grouped by day · Showing {filteredTransactions.length} transaction{filteredTransactions.length === 1 ? '' : 's'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setShowAdvancedFilters((v) => !v)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.cardAltBg,
                  color: palette.textPrimary,
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {showAdvancedFilters ? '▲ Hide Filters' : '🌪️ Advanced Filters'}
              </button>
              <button
                type="button"
                onClick={handleExportCsv}
                style={{
                  padding: '7px 12px',
                  borderRadius: 10,
                  border: `1px solid ${palette.primary}`,
                  background: 'transparent',
                  color: palette.primary,
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                📥 Export CSV
              </button>
            </div>
          </div>

          {/* SEARCH BAR */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              type="search"
              aria-label="Search transactions by merchant, note, tag, or reference ID"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 Search merchant, personal note, original remark, tag, or UPI reference..."
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 11,
                border: `1px solid ${palette.border}`,
                background: palette.inputBg,
                color: palette.textPrimary,
                fontSize: 13,
              }}
            />
            {(searchQuery || filterCategory !== 'ALL' || filterType !== 'ALL' || filterMethod !== 'ALL' || filterNoteState !== 'ALL' || filterReviewState !== 'ALL' || filterDateFrom || filterDateTo || filterMinAmount || filterMaxAmount) && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setFilterCategory('ALL');
                  setFilterType('ALL');
                  setFilterMethod('ALL');
                  setFilterSource('ALL');
                  setFilterStatus('ALL');
                  setFilterNoteState('ALL');
                  setFilterReviewState('ALL');
                  setFilterDateFrom('');
                  setFilterDateTo('');
                  setFilterMinAmount('');
                  setFilterMaxAmount('');
                }}
                style={{
                  padding: '10px 12px',
                  borderRadius: 11,
                  border: `1px solid ${palette.border}`,
                  background: palette.cardAltBg,
                  color: palette.textPrimary,
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Reset
              </button>
            )}
          </div>

          {/* ADVANCED FILTERS PANEL (Phase 7) */}
          {showAdvancedFilters && (
            <div
              style={{
                padding: 12,
                borderRadius: 14,
                background: palette.cardAltBg,
                border: `1px solid ${palette.border}`,
                marginBottom: 12,
                display: 'grid',
                gridTemplateColumns: mobileMode ? '1fr 1fr' : 'repeat(4, 1fr)',
                gap: 8,
              }}
            >
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>From Date</label>
                <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} style={{ width: '100%', padding: 7, borderRadius: 8, background: palette.inputBg, color: palette.textPrimary, border: `1px solid ${palette.border}` }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>To Date</label>
                <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} style={{ width: '100%', padding: 7, borderRadius: 8, background: palette.inputBg, color: palette.textPrimary, border: `1px solid ${palette.border}` }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Min Amount (₹)</label>
                <input type="number" value={filterMinAmount} onChange={(e) => setFilterMinAmount(e.target.value)} placeholder="0" style={{ width: '100%', padding: 7, borderRadius: 8, background: palette.inputBg, color: palette.textPrimary, border: `1px solid ${palette.border}` }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Max Amount (₹)</label>
                <input type="number" value={filterMaxAmount} onChange={(e) => setFilterMaxAmount(e.target.value)} placeholder="Any" style={{ width: '100%', padding: 7, borderRadius: 8, background: palette.inputBg, color: palette.textPrimary, border: `1px solid ${palette.border}` }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Type</label>
                <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ width: '100%', padding: 7, borderRadius: 8, background: palette.inputBg, color: palette.textPrimary, border: `1px solid ${palette.border}` }}>
                  <option value="ALL">All Types</option>
                  <option value="debit">Expenses</option>
                  <option value="credit">Income / Received</option>
                  <option value="refund">Refunds</option>
                  <option value="transfer">Self-Transfers</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Category</label>
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={{ width: '100%', padding: 7, borderRadius: 8, background: palette.inputBg, color: palette.textPrimary, border: `1px solid ${palette.border}` }}>
                  <option value="ALL">All Categories</option>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Note Status</label>
                <select value={filterNoteState} onChange={(e) => setFilterNoteState(e.target.value)} style={{ width: '100%', padding: 7, borderRadius: 8, background: palette.inputBg, color: palette.textPrimary, border: `1px solid ${palette.border}` }}>
                  <option value="ALL">All Notes</option>
                  <option value="has_note">With Note</option>
                  <option value="missing_note">Missing Note</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Review Status</label>
                <select value={filterReviewState} onChange={(e) => setFilterReviewState(e.target.value)} style={{ width: '100%', padding: 7, borderRadius: 8, background: palette.inputBg, color: palette.textPrimary, border: `1px solid ${palette.border}` }}>
                  <option value="ALL">All Records</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="needs_review">Needs Review</option>
                  <option value="possible_duplicate">Possible Duplicates</option>
                </select>
              </div>
            </div>
          )}

          {/* GROUPED BY DAY LIST */}
          {groupedByDay.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: palette.textMuted }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>🔎</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: palette.textPrimary }}>
                Nothing matched your search. Try a different keyword or date.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {groupedByDay.map((group) => (
                <div key={group.date}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 10px',
                      borderRadius: 9,
                      background: palette.cardAltBg,
                      marginBottom: 8,
                      fontSize: 12,
                      fontWeight: 800,
                      color: palette.textSecondary,
                    }}
                  >
                    <span>📅 {group.date === todayIso ? `Today (${group.date})` : group.date} · {group.items.length} txn{group.items.length === 1 ? '' : 's'}</span>
                    <span>
                      {group.daySpent > 0 && <span style={{ color: palette.expenseWarm }}>Spent: ₹{formatINR(group.daySpent)} </span>}
                      {group.dayReceived > 0 && <span style={{ color: palette.incomeGreen }}>· Received: +₹{formatINR(group.dayReceived)}</span>}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {group.items.map((tx) => {
                      const cat = getCategoryMeta(tx.category);
                      const isCredit = tx.type === 'credit';
                      const isRefund = tx.type === 'refund';
                      const isTransfer = tx.type === 'transfer';
                      return (
                        <div
                          key={tx.id}
                          onClick={() => setDetailViewTxId(tx.id)}
                          style={{
                            padding: '12px 14px',
                            borderRadius: 13,
                            background: palette.cardAltBg,
                            border: `1px solid ${palette.border}`,
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <div style={{ width: 36, height: 36, borderRadius: 10, background: cat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17 }}>
                              {cat.icon}
                            </div>
                            <div>
                              <div style={{ fontSize: 13.5, fontWeight: 800, color: palette.textPrimary }}>
                                {tx.merchant}
                              </div>
                              <div style={{ fontSize: 11.5, color: palette.textSecondary, marginTop: 2 }}>
                                {tx.note ? (
                                  <span>📝 {tx.note}</span>
                                ) : (
                                  <span style={{ color: '#f59e0b' }}>➕ Note unavailable — tap to add note</span>
                                )}
                              </div>
                              <div style={{ fontSize: 10.5, color: palette.textMuted, marginTop: 2 }}>
                                {formatTime12h(tx.time)} · {tx.app} ({tx.paymentMethod}) · Source: {tx.source}
                                {tx.refId ? ` · Ref: ${tx.refId}` : ''}
                              </div>
                            </div>
                          </div>

                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div
                              style={{
                                fontSize: 15,
                                fontWeight: 900,
                                color: isCredit || isRefund ? palette.incomeGreen : isTransfer ? palette.primary : palette.expenseWarm,
                              }}
                            >
                              {isCredit ? '+ ₹' : isRefund ? '↩️ + ₹' : isTransfer ? '🔄 ₹' : '- ₹'}
                              {formatINR(tx.amount)}
                            </div>
                            <div style={{ fontSize: 10, color: palette.textMuted, marginTop: 2 }}>
                              {tx.status !== 'completed' ? tx.status.toUpperCase() : 'View details →'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SCREEN 6: INSIGHTS & SMART ANALYTICS (Phase 8)
         ===================================================================== */}
      {subTab === 'insights' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* NATURAL-LANGUAGE PERSONAL FINANCE Q&A */}
          <div style={{ padding: 16, borderRadius: 18, background: palette.cardBg, border: `1px solid ${palette.border}` }}>
            <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>
              🧠 Ask Expense Memory (Personal Finance Intelligence)
            </div>
            <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 10 }}>
              Answered directly from your locally stored transaction records.
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                type="text"
                value={qaQuery}
                onChange={(e) => setQaQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRunSmartQuestion()}
                placeholder="Ask e.g. 'How much did I spend yesterday?' or 'Transactions above ₹1,000'"
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.inputBg,
                  color: palette.textPrimary,
                  fontSize: 13,
                }}
              />
              <button
                type="button"
                onClick={() => handleRunSmartQuestion()}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#0284c7',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                Ask
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: qaResult ? 12 : 0 }}>
              {SMART_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => handleRunSmartQuestion(q)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 999,
                    border: `1px solid ${palette.border}`,
                    background: palette.cardAltBg,
                    color: palette.textSecondary,
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {q}
                </button>
              ))}
            </div>

            {qaResult && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background: palette.cardAltBg,
                  border: `1px solid ${palette.primary}`,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 900, color: palette.primary }}>{qaResult.title}</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginTop: 4 }}>{qaResult.answer}</div>
                <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 6 }}>
                  ℹ️ Calculated from locally tracked records. Unscanned cash or external bank accounts are not included unless added.
                </div>
              </div>
            )}
          </div>

          {/* GROSS VS NET SPENDING & PERIOD SUMMARY */}
          <div style={{ padding: 16, borderRadius: 18, background: palette.cardBg, border: `1px solid ${palette.border}` }}>
            <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 10 }}>
              📈 Monthly &amp; Weekly Spending Summary ({activeMonth})
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: mobileMode ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 10 }}>
              <div style={{ padding: 12, borderRadius: 12, background: palette.cardAltBg, border: `1px solid ${palette.border}` }}>
                <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700 }}>Yesterday&apos;s Spend</div>
                <div style={{ fontSize: 17, fontWeight: 900, marginTop: 3 }}>₹{formatINR(stats.yesterdaySpent)}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 12, background: palette.cardAltBg, border: `1px solid ${palette.border}` }}>
                <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700 }}>Last 7 Days Spent</div>
                <div style={{ fontSize: 17, fontWeight: 900, marginTop: 3 }}>₹{formatINR(stats.weekSpent)}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 12, background: palette.cardAltBg, border: `1px solid ${palette.border}` }}>
                <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700 }}>Last 7 Days Received</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: palette.incomeGreen, marginTop: 3 }}>+₹{formatINR(stats.weekReceived)}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 12, background: palette.cardAltBg, border: `1px solid ${palette.border}` }}>
                <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700 }}>Note Completion</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: palette.primary, marginTop: 3 }}>
                  {stats.withNoteCount}/{stats.monthTxCount} ({stats.noteCompletionPct}%)
                </div>
              </div>
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: palette.textSecondary, lineHeight: 1.6 }}>
              • <strong>Gross Spending:</strong> ₹{formatINR(stats.grossExpenses)} across {stats.monthExpenseCount} expenses
              <br />• <strong>Refunds &amp; Reversals:</strong> -₹{formatINR(stats.refundsTotal)} ({stats.monthRefundCount} refunds)
              <br />• <strong>Net Spending:</strong> <strong>₹{formatINR(stats.netSpending)}</strong> (Gross minus Refunds)
              <br />• <strong>Self-Transfers Excluded:</strong> ₹{formatINR(stats.selfTransfersTotal)} ({stats.monthTransferCount} transfers between your own accounts excluded from spending)
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SCREEN 9 & 10: MISSING-NOTE REVIEW & DUPLICATE/UNCERTAIN REVIEW
         ===================================================================== */}
      {subTab === 'missing_notes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* MISSING-NOTE REVIEW SCREEN (Phase 6) */}
          <div style={{ padding: 16, borderRadius: 18, background: palette.cardBg, border: `1px solid ${palette.border}` }}>
            <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>
              📝 Missing-Note Review ({missingNoteTransactions.length})
            </div>
            <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 12 }}>
              Quickly add a purpose note or tag so you always remember why you spent the money.
            </div>

            {missingNoteTransactions.length === 0 ? (
              <div style={{ padding: 20, borderRadius: 14, background: palette.cardAltBg, textAlign: 'center' }}>
                <div style={{ fontSize: 24, marginBottom: 4 }}>🎉</div>
                <div style={{ fontSize: 14, fontWeight: 900 }}>
                  You&apos;re all caught up! Every tracked transaction has a note or has been reviewed.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {missingNoteTransactions.map((tx) => {
                  const suggestions = suggestNotesAndCategoryForMerchant(tx.merchant, allActiveTransactions);
                  const draft = inlineNoteDrafts[tx.id] ?? '';
                  return (
                    <div
                      key={tx.id}
                      style={{
                        padding: 12,
                        borderRadius: 13,
                        background: palette.cardAltBg,
                        border: `1px solid ${palette.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 800 }}>{tx.merchant}</div>
                          <div style={{ fontSize: 11, color: palette.textMuted }}>
                            {tx.date} at {formatTime12h(tx.time)} · {tx.app} · {tx.originalRemark ? `Original remark: "${tx.originalRemark}"` : 'Note unavailable from payment source'}
                          </div>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 900, color: palette.expenseWarm }}>
                          ₹{formatINR(tx.amount)}
                        </div>
                      </div>

                      {/* Smart Suggestions from past merchant history */}
                      {suggestions.suggestedNotes.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: palette.textMuted }}>Suggested from past history:</span>
                          {suggestions.suggestedNotes.map((sNote) => (
                            <button
                              key={sNote}
                              type="button"
                              onClick={() => handleUpdateTransactionPatch(tx.id, { note: sNote, noteReviewed: true }, `Saved note "${sNote}"`)}
                              style={{
                                padding: '4px 9px',
                                borderRadius: 999,
                                border: `1px solid ${palette.primary}`,
                                background: 'transparent',
                                color: palette.primary,
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              ✨ {sNote}
                            </button>
                          ))}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="text"
                          value={draft}
                          onChange={(e) => setInlineNoteDrafts((p) => ({ ...p, [tx.id]: e.target.value }))}
                          placeholder="What was this payment for?"
                          style={{
                            flex: 1,
                            padding: '7px 10px',
                            borderRadius: 9,
                            border: `1px solid ${palette.border}`,
                            background: palette.inputBg,
                            color: palette.textPrimary,
                            fontSize: 12.5,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => handleUpdateTransactionPatch(tx.id, { note: draft.trim(), noteReviewed: true }, 'Saved note')}
                          style={{
                            padding: '7px 12px',
                            borderRadius: 9,
                            border: 'none',
                            background: '#059669',
                            color: '#fff',
                            fontWeight: 800,
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          Save Note
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateTransactionPatch(tx.id, { noteReviewed: true }, 'Marked as reviewed')}
                          style={{
                            padding: '7px 10px',
                            borderRadius: 9,
                            border: `1px solid ${palette.border}`,
                            background: 'transparent',
                            color: palette.textMuted,
                            fontWeight: 700,
                            fontSize: 11.5,
                            cursor: 'pointer',
                          }}
                        >
                          Skip ✓
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* DUPLICATE & UNCERTAIN TRANSACTION REVIEW SCREEN (Screen 10 & Phase 11) */}
          <div style={{ padding: 16, borderRadius: 18, background: palette.cardBg, border: `1px solid ${palette.border}` }}>
            <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>
              🔍 Duplicate &amp; Uncertain Transaction Review ({reviewQueueTransactions.length})
            </div>
            <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 12 }}>
              Possible duplicates are held here so your spending is never double-counted.
            </div>

            {reviewQueueTransactions.length === 0 ? (
              <div style={{ padding: 16, borderRadius: 12, background: palette.cardAltBg, fontSize: 13, color: palette.textSecondary }}>
                ✓ No duplicate or uncertain transactions need review right now.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {reviewQueueTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    style={{
                      padding: 12,
                      borderRadius: 13,
                      background: palette.cardAltBg,
                      border: '1px solid rgba(245, 158, 11, 0.45)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b' }}>
                        Please check these details ({tx.reconciliationStatus === 'possible_duplicate' ? 'Possible Duplicate' : tx.status !== 'completed' ? tx.status.toUpperCase() : 'Needs Review'})
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 800, marginTop: 2 }}>
                        {tx.merchant} — ₹{formatINR(tx.amount)}
                      </div>
                      <div style={{ fontSize: 11.5, color: palette.textMuted }}>
                        {tx.date} at {formatTime12h(tx.time)} · Source: {tx.source}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateTransactionPatch(
                            tx.id,
                            { reconciliationStatus: 'confirmed', duplicateOfId: '' },
                            'Confirmed as separate transaction'
                          )
                        }
                        style={{
                          padding: '7px 11px',
                          borderRadius: 9,
                          border: 'none',
                          background: '#059669',
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        ✓ Keep Transaction
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTransaction(tx.id)}
                        style={{
                          padding: '7px 11px',
                          borderRadius: 9,
                          border: '1px solid rgba(244,63,94,0.5)',
                          background: 'transparent',
                          color: palette.expenseWarm,
                          fontWeight: 800,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        🗑️ Dismiss Duplicate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          SCREEN 7 & 8: DETECTION SETTINGS + PRIVACY, EXPORT & DELETION (Phase 4 & 10)
         ===================================================================== */}
      {subTab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ padding: 16, borderRadius: 18, background: palette.cardBg, border: `1px solid ${palette.border}` }}>
            <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>📲 Transaction Detection Settings</div>
            <div style={{ fontSize: 12, color: palette.textMuted, marginBottom: 12 }}>
              Control how Expense Memory detects transactions. Manual entry always works even with all permissions off.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ padding: 12, borderRadius: 12, background: palette.cardAltBg, border: `1px solid ${palette.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>
                    1. Bank &amp; UPI SMS Parsing ({smsGranted ? 'Granted ✓' : 'Off / Not Granted'})
                  </div>
                  <div style={{ fontSize: 11.5, color: palette.textMuted, marginTop: 2 }}>
                    Reads transaction SMS messages locally to extract ₹ amount, merchant, ref ID, and available remark. Never reads OTPs or PINs.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={triggerMobileTransactionScan}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 9,
                    border: `1px solid ${palette.primary}`,
                    background: 'transparent',
                    color: palette.primary,
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  📲 Scan SMS Inbox
                </button>
              </div>

              <div style={{ padding: 12, borderRadius: 12, background: palette.cardAltBg, border: `1px solid ${palette.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>
                    2. Payment App Notification Access ({notifGranted ? 'Enabled ✓' : 'Off'})
                  </div>
                  <div style={{ fontSize: 11.5, color: palette.textMuted, marginTop: 2 }}>
                    Captures payment alerts from GPay, PhonePe, Paytm, and BHIM when enabled in Android Settings. Can be turned off anytime.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenNotificationSettings}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 9,
                    border: `1px solid ${palette.border}`,
                    background: palette.cardBg,
                    color: palette.textPrimary,
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  🔔 Open Notification Settings
                </button>
              </div>
            </div>
          </div>

          {/* PRIVACY, SECURITY, EXPORT & DELETION (Phase 10) */}
          <div style={{ padding: 16, borderRadius: 18, background: palette.cardBg, border: `1px solid ${palette.border}` }}>
            <div style={{ fontSize: 15, fontWeight: 900, marginBottom: 4 }}>🔒 Privacy, Security, Export &amp; Deletion</div>
            <div style={{ fontSize: 12, color: palette.textSecondary, lineHeight: 1.6, marginBottom: 12 }}>
              • <strong>Local Storage &amp; Encryption at Rest:</strong> Native mobile records are encrypted with Android Keystore AES-256-GCM.
              <br />• <strong>Sensitive Data Redaction:</strong> Account numbers are masked (`XX1234`) and OTPs/PINs are never stored or logged.
              <br />• <strong>Export Disclosure:</strong> Exported CSV and JSON files contain your merchant names, personal notes, original remarks, amounts, and reference IDs.
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <button
                type="button"
                onClick={handleExportCsv}
                style={{
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: `1px solid ${palette.primary}`,
                  background: 'transparent',
                  color: palette.primary,
                  fontWeight: 800,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                📥 Export CSV Report
              </button>
              <button
                type="button"
                onClick={handleExportJsonBackup}
                style={{
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.cardAltBg,
                  color: palette.textPrimary,
                  fontWeight: 800,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                📤 Export JSON Backup
              </button>
              <button
                type="button"
                onClick={() => updatePrefs({ onboardingDismissed: false })}
                style={{
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: 'transparent',
                  color: palette.textSecondary,
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                👋 Show Onboarding Guide
              </button>
            </div>

            {!confirmDeleteAll ? (
              <button
                type="button"
                onClick={() => setConfirmDeleteAll(true)}
                style={{
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(244, 63, 94, 0.5)',
                  background: 'rgba(244, 63, 94, 0.1)',
                  color: palette.expenseWarm,
                  fontWeight: 800,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                🗑️ Permanently Delete All Expense Records
              </button>
            ) : (
              <div style={{ padding: 12, borderRadius: 12, background: 'rgba(244, 63, 94, 0.12)', border: '1px solid #f43f5e', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800 }}>
                  Are you sure you want to delete all {allActiveTransactions.length} expense records?
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={handlePermanentDeleteAll}
                    style={{ padding: '7px 12px', borderRadius: 8, border: 'none', background: '#e11d48', color: '#fff', fontWeight: 900, fontSize: 12, cursor: 'pointer' }}
                  >
                    Yes, Delete All
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteAll(false)}
                    style={{ padding: '7px 12px', borderRadius: 8, border: `1px solid ${palette.border}`, background: palette.cardBg, color: palette.textPrimary, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          SCREEN 3: DETAILED TRANSACTION VIEWER MODAL (Phase 3 & 7)
         ===================================================================== */}
      {detailTx && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Transaction Details"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 120,
            background: 'rgba(2, 6, 23, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 14,
          }}
        >
          <div
            style={{
              width: 'min(100%, 520px)',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 18,
              borderRadius: 20,
              background: palette.cardBg,
              border: `1px solid ${palette.border}`,
              color: palette.textPrimary,
              boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: palette.primary, textTransform: 'uppercase' }}>
                  Transaction Memory Detail
                </div>
                <div style={{ fontSize: 22, fontWeight: 900, marginTop: 2 }}>
                  ₹{formatINR(detailTx.amount)} · {detailTx.merchant}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailViewTxId(null)}
                style={{ background: 'transparent', border: 'none', color: palette.textMuted, fontSize: 18, cursor: 'pointer', fontWeight: 900 }}
              >
                ✕
              </button>
            </div>

            {/* 1. VERIFIED SOURCE INFORMATION */}
            <div style={{ padding: 12, borderRadius: 12, background: palette.cardAltBg, border: `1px solid ${palette.border}`, marginBottom: 12, fontSize: 12.5, lineHeight: 1.65 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: palette.primary, textTransform: 'uppercase', marginBottom: 4 }}>
                ✓ Verified Source Information
              </div>
              <div><strong>Source:</strong> {detailTx.source} ({detailTx.reconciliationStatus})</div>
              <div><strong>Date &amp; Time:</strong> {detailTx.date} at {formatTime12h(detailTx.time)}</div>
              <div><strong>Payment Method:</strong> {detailTx.app} ({detailTx.paymentMethod})</div>
              <div><strong>Original Merchant:</strong> {detailTx.originalMerchant || detailTx.merchant}</div>
              <div><strong>Original Payment Remark:</strong> {detailTx.originalRemark || 'Note unavailable from payment source'}</div>
              {detailTx.refId && <div><strong>Bank / UPI Reference:</strong> {detailTx.refId}</div>}
              {detailTx.rawText && <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 4 }}><strong>Sanitized Snippet:</strong> {detailTx.rawText}</div>}
            </div>

            {/* 2. USER-ENTERED PERSONAL MEMORY */}
            <div style={{ padding: 12, borderRadius: 12, background: palette.cardAltBg, border: `1px solid ${palette.border}`, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#10b981', textTransform: 'uppercase', marginBottom: 6 }}>
                ✍️ Your Personal Note &amp; Tags
              </div>
              <input
                type="text"
                value={detailTx.note || ''}
                onChange={(e) => handleUpdateTransactionPatch(detailTx.id, { note: e.target.value, noteReviewed: true }, 'Updated personal note')}
                placeholder="Add personal note (kept separate from original remark)..."
                style={{
                  width: '100%',
                  padding: '9px 11px',
                  borderRadius: 9,
                  border: `1px solid ${palette.border}`,
                  background: palette.inputBg,
                  color: palette.textPrimary,
                  fontSize: 13,
                  marginBottom: 8,
                }}
              />

              {/* Tag Selector (Food, Travel, Family, Shopping, Bills, Work, Personal) */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {DEFAULT_TAGS.map((tag) => {
                  const hasTag = (detailTx.tags || []).includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        const cur = detailTx.tags || [];
                        const next = hasTag ? cur.filter((t) => t !== tag) : [...cur, tag];
                        handleUpdateTransactionPatch(detailTx.id, { tags: next }, `Updated #${tag} tag`);
                      }}
                      style={{
                        padding: '4px 9px',
                        borderRadius: 999,
                        border: `1px solid ${hasTag ? palette.primary : palette.border}`,
                        background: hasTag ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                        color: hasTag ? palette.primary : palette.textMuted,
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      #{tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. INFERRED SUGGESTIONS */}
            {detailSuggestions.suggestedNotes.length > 0 && (
              <div style={{ padding: 10, borderRadius: 12, background: palette.cardAltBg, border: `1px dashed ${palette.border}`, marginBottom: 12, fontSize: 12 }}>
                <div style={{ fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                  💡 Suggested Notes (Inferred from past payments to {detailTx.merchant}):
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {detailSuggestions.suggestedNotes.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleUpdateTransactionPatch(detailTx.id, { note: s, noteReviewed: true }, `Applied suggested note "${s}"`)}
                      style={{ padding: '4px 9px', borderRadius: 8, border: `1px solid ${palette.border}`, background: palette.cardBg, color: palette.textPrimary, fontSize: 11.5, cursor: 'pointer' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  const txToEdit = detailTx;
                  setDetailViewTxId(null);
                  openEditModalForTx(txToEdit);
                }}
                style={{ flex: 1, padding: '10px', borderRadius: 10, border: `1px solid ${palette.primary}`, background: 'transparent', color: palette.primary, fontWeight: 800, cursor: 'pointer' }}
              >
                ✏️ Edit All Details
              </button>
              <button
                type="button"
                onClick={() => handleDeleteTransaction(detailTx.id)}
                style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(244,63,94,0.5)', background: 'transparent', color: palette.expenseWarm, fontWeight: 800, cursor: 'pointer' }}
              >
                🗑️ Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SCREEN 4: QUICK-ADD & EDIT TRANSACTION MODAL (Phase 3 & 9)
         ===================================================================== */}
      {showQuickAddModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editingTxId ? 'Edit Transaction' : 'Add Transaction'}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 130,
            background: 'rgba(2, 6, 23, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 14,
          }}
        >
          <div
            style={{
              width: 'min(100%, 480px)',
              maxHeight: '92vh',
              overflowY: 'auto',
              padding: 18,
              borderRadius: 20,
              background: palette.cardBg,
              border: `1px solid ${palette.border}`,
              color: palette.textPrimary,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 17, fontWeight: 900 }}>
                {editingTxId ? '✏️ Edit Transaction' : '➕ Quick-Add Transaction'}
              </div>
              <button
                type="button"
                onClick={() => setShowQuickAddModal(false)}
                style={{ background: 'transparent', border: 'none', color: palette.textMuted, fontSize: 18, cursor: 'pointer', fontWeight: 900 }}
              >
                ✕
              </button>
            </div>

            {/* Transaction Type Selector */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
              {[
                { id: 'debit', label: '💸 Expense' },
                { id: 'credit', label: '💰 Income' },
                { id: 'refund', label: '↩️ Refund' },
                { id: 'transfer', label: '🔄 Transfer' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTxType(t.id)}
                  style={{
                    padding: '8px 6px',
                    borderRadius: 9,
                    border: txType === t.id ? `1.5px solid ${palette.primary}` : `1px solid ${palette.border}`,
                    background: txType === t.id ? 'rgba(56, 189, 248, 0.16)' : palette.cardAltBg,
                    color: palette.textPrimary,
                    fontWeight: 800,
                    fontSize: 11.5,
                    cursor: 'pointer',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 800, color: palette.textSecondary }}>Amount (₹) *</label>
                <input
                  type="number"
                  min="1"
                  step="any"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="e.g. 150"
                  style={{ width: '100%', padding: '10px', borderRadius: 10, border: `1px solid ${palette.border}`, background: palette.inputBg, color: palette.textPrimary, fontSize: 15, fontWeight: 900, marginTop: 4 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 800, color: palette.textSecondary }}>Personal Note (Purpose)</label>
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Why did you spend this?"
                  style={{ width: '100%', padding: '10px', borderRadius: 10, border: `1px solid ${palette.border}`, background: palette.inputBg, color: palette.textPrimary, fontSize: 13.5, marginTop: 4 }}
                />
              </div>
            </div>

            {/* 1-Tap Quick Note Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {QUICK_NOTE_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => {
                    setNoteInput(chip.note);
                    setSelectedCategory(chip.category);
                    if (chip.tag && !selectedTags.includes(chip.tag)) {
                      setSelectedTags((prev) => [...prev, chip.tag]);
                    }
                  }}
                  style={{
                    padding: '5px 9px',
                    borderRadius: 8,
                    border: `1px solid ${palette.border}`,
                    background: palette.cardAltBg,
                    color: palette.textSecondary,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 800, color: palette.textSecondary }}>Merchant / Recipient</label>
                <input
                  type="text"
                  value={merchantInput}
                  onChange={(e) => setMerchantInput(e.target.value)}
                  placeholder="Optional merchant..."
                  style={{ width: '100%', padding: '9px', borderRadius: 10, border: `1px solid ${palette.border}`, background: palette.inputBg, color: palette.textPrimary, fontSize: 13, marginTop: 4 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 800, color: palette.textSecondary }}>Payment Method / App</label>
                <select
                  value={selectedApp}
                  onChange={(e) => setSelectedApp(e.target.value)}
                  style={{ width: '100%', padding: '9px', borderRadius: 10, border: `1px solid ${palette.border}`, background: palette.inputBg, color: palette.textPrimary, fontSize: 13, marginTop: 4 }}
                >
                  {PAYMENT_APPS.map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {currentMerchantSuggestions.suggestedNotes.length > 0 && (
              <div style={{ fontSize: 11.5, color: palette.primary, marginBottom: 10 }}>
                💡 Suggested note for {merchantInput}:{' '}
                {currentMerchantSuggestions.suggestedNotes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setNoteInput(s)}
                    style={{ marginLeft: 4, padding: '2px 7px', borderRadius: 6, border: `1px solid ${palette.primary}`, background: 'transparent', color: palette.primary, fontSize: 11, cursor: 'pointer' }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Category</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: 9, border: `1px solid ${palette.border}`, background: palette.inputBg, color: palette.textPrimary, fontSize: 12.5, marginTop: 3 }}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Date</label>
                <input
                  type="date"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: 9, border: `1px solid ${palette.border}`, background: palette.inputBg, color: palette.textPrimary, fontSize: 12.5, marginTop: 3 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Time</label>
                <input
                  type="time"
                  value={txTime}
                  onChange={(e) => setTxTime(e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: 9, border: `1px solid ${palette.border}`, background: palette.inputBg, color: palette.textPrimary, fontSize: 12.5, marginTop: 3 }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveTransactionForm}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, #10b981, #0284c7)',
                color: '#fff',
                fontWeight: 900,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              💾 {editingTxId ? 'Save Changes' : 'Save to Expense Memory'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
