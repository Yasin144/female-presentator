import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  QUICK_NOTE_TEMPLATES,
  parseSmsOrUpiTextJs,
  migrateAndNormalizeExpenseRecord,
  reconcileAndMergeTransactions,
  suggestNotesAndCategoryForMerchant,
  computeExpenseAnalytics,
  answerNaturalLanguageFinanceQuery,
  formatTransactionsCsv,
  launchUpiPayment,
  ALLOWED_PAYMENT_PACKAGES,
  getExpenseStorageStatus,
} from '../../../frontend/expense-memory.js';

const SMART_QA_CHIPS = [
  'How much did I spend yesterday?',
  'How many transactions did I make this month?',
  'Show my food expenses.',
  "Which payments don't have notes?",
  'How much did I receive this week?',
  'Find my transactions above ₹1,000.',
];

const formatINR = (num) => {
  const n = Number(num) || 0;
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatINRShort = (num) => {
  const n = Math.round(Number(num) || 0);
  return n.toLocaleString('en-IN');
};

const formatTime12h = (hhmm) => {
  if (!hhmm || typeof hhmm !== 'string' || !hhmm.includes(':')) return '12:00 PM';
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
};

const formatFriendlyDate = (isoDate, todayIso) => {
  if (!isoDate) return '';
  if (isoDate === todayIso) return `Today · ${formatShortDate(isoDate)}`;
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const t = new Date(`${todayIso}T00:00:00`);
  const diffDays = Math.round((t.getTime() - d.getTime()) / 86400000);
  if (diffDays === 1) return `Yesterday · ${formatShortDate(isoDate)}`;
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

const formatShortDate = (isoDate) => {
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const getTodayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Branded Circular Icon matching Screens 7, 8, 9, 11
export function BrandPaymentAvatar({ tx, size = 44 }) {
  const label = `${tx?.merchant || ''} ${tx?.app || ''} ${tx?.paymentMethod || ''}`.toLowerCase();
  const radius = size / 2;

  if (label.includes('gpay') || label.includes('google pay')) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        flexShrink: 0,
      }}>
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24">
          <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/>
          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/>
          <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/>
          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/>
        </svg>
      </div>
    );
  }

  if (label.includes('phonepe') || label.includes('phone pe')) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: 'linear-gradient(135deg, #6739b7, #512da8)',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 900,
        fontSize: size * 0.44,
        boxShadow: '0 4px 12px rgba(103,57,183,0.4)',
        flexShrink: 0,
      }}>
        पे
      </div>
    );
  }

  if (label.includes('swiggy')) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: 'linear-gradient(135deg, #fc8019, #ea580c)',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 950,
        fontSize: size * 0.46,
        boxShadow: '0 4px 12px rgba(252,128,25,0.4)',
        flexShrink: 0,
      }}>
        S
      </div>
    );
  }

  if (label.includes('zomato')) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: 'linear-gradient(135deg, #e23744, #be123c)',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 950,
        fontSize: size * 0.44,
        boxShadow: '0 4px 12px rgba(226,55,68,0.4)',
        flexShrink: 0,
      }}>
        Z
      </div>
    );
  }

  if (label.includes('amazon')) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: 'linear-gradient(135deg, #232f3e, #131921)',
        border: '1px solid rgba(255,153,0,0.5)',
        color: '#ff9900',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 950,
        fontSize: size * 0.48,
        fontFamily: 'serif',
        boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
        flexShrink: 0,
      }}>
        a
      </div>
    );
  }

  if (label.includes('paytm')) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: '#ffffff',
        border: '1.5px solid #00baf2',
        color: '#002970',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 950,
        fontSize: size * 0.26,
        letterSpacing: '-0.03em',
        boxShadow: '0 4px 12px rgba(0,186,242,0.25)',
        flexShrink: 0,
      }}>
        Pay<span style={{ color: '#00baf2' }}>tm</span>
      </div>
    );
  }

  if (label.includes('hdfc') || label.includes('sbi') || label.includes('icici') || label.includes('axis') || label.includes('bank')) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: 'linear-gradient(135deg, #1d4ed8, #1e3a8a)',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.44,
        boxShadow: '0 4px 12px rgba(29,78,216,0.35)',
        flexShrink: 0,
      }}>
        🏦
      </div>
    );
  }

  const catInfo = EXPENSE_CATEGORIES.find((c) => c.id === tx?.category) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: radius,
      background: `${catInfo.color}24`,
      border: `1.5px solid ${catInfo.color}66`,
      color: catInfo.color,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: size * 0.44,
      flexShrink: 0,
    }}>
      {catInfo.icon}
    </div>
  );
}

// SVG Multi-Segment Donut Chart matching Screen 10 (Expense Insights)
function SpendingDonutChart({ segments, totalSpent, isLight }) {
  const size = 148;
  const strokeWidth = 22;
  const center = size / 2;
  const radius = center - strokeWidth / 2 - 4;
  const circumference = 2 * Math.PI * radius;

  let cumulativeFraction = 0;
  const defaultSegments = segments && segments.length > 0
    ? segments
    : [
        { label: 'Food', pct: 36, color: '#3b82f6' },
        { label: 'Shopping', pct: 17, color: '#a855f7' },
        { label: 'Transport', pct: 13, color: '#10b981' },
        { label: 'Bills', pct: 11, color: '#eab308' },
        { label: 'Others', pct: 23, color: '#ec4899' },
      ];

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="transparent"
          stroke={isLight ? '#e2e8f0' : 'rgba(148,163,184,0.14)'}
          strokeWidth={strokeWidth}
        />
        {defaultSegments.map((seg, i) => {
          const frac = Math.max(0.02, (Number(seg.pct) || 0) / 100);
          const dashLen = Math.max(2, frac * circumference - 3);
          const dashOffset = -cumulativeFraction * circumference;
          cumulativeFraction += frac;
          return (
            <circle
              key={seg.label || i}
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dashLen} ${circumference}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
            />
          );
        })}
      </svg>
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        pointerEvents: 'none',
      }}>
        <div style={{ fontSize: 16, fontWeight: 950, color: isLight ? '#0f172a' : '#f8fafc', letterSpacing: '-0.02em' }}>
          ₹{formatINRShort(totalSpent)}
        </div>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: isLight ? '#64748b' : '#94a3b8', marginTop: 1 }}>
          Total Spending
        </div>
      </div>
    </div>
  );
}

export default function ExpensesModule({
  expensesMap = {},
  onUpdateExpenses,
  selectedMonth,
  onChangeMonth,
  monthlyNetSalary = 0,
  netMonthlySalary = 0,
  salaryVisible = false,
  onToggleSalaryVisibility,
  mobileMode = false,
  themeMode = 'dark',
}) {
  const effectiveMonthlySalary = Number(monthlyNetSalary || netMonthlySalary || 0);

  // Sub-screens matching Screens 7, 8, 9, 10, 11:
  // 'overview' (Screen 7) | 'transactions' (Screen 8) | 'insights' (Screen 10) | 'missing-notes' (Screen 11) | 'settings'
  const [subTab, setSubTab] = useState('overview');
  const [insightSubView, setInsightSubView] = useState('Overview'); // 'Overview' | 'Categories' | 'Methods' | 'Trends'
  const [missingFilterWindow, setMissingFilterWindow] = useState('all'); // 'all' | 'today' | 'week'
  const [inlineNoteDrafts, setInlineNoteDrafts] = useState({});

  // Detailed Transaction Viewer (Screen 9)
  const [selectedTxId, setSelectedTxId] = useState(null);
  const [detailNoteDraft, setDetailNoteDraft] = useState('');
  const [detailMerchantDraft, setDetailMerchantDraft] = useState('');

  // Quick-Add / Edit Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTxId, setEditingTxId] = useState(null);
  const [formAmount, setFormAmount] = useState('');
  const [formType, setFormType] = useState('debit');
  const [formMerchant, setFormMerchant] = useState('');
  const [formPayeeVpa, setFormPayeeVpa] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formPaymentRemark, setFormPaymentRemark] = useState('');
  const [formCategory, setFormCategory] = useState('Food & Dining');
  const [formPaymentMethod, setFormPaymentMethod] = useState('UPI');
  const [formApp, setFormApp] = useState('GPay');
  const [formDate, setFormDate] = useState(getTodayIso);
  const [formTime, setFormTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [formTagsInput, setFormTagsInput] = useState('');

  // Search & Filter states (Screen 8)
  const [searchQuery, setSearchQuery] = useState('');
  const [methodPillFilter, setMethodPillFilter] = useState('All'); // 'All' | 'Money Out' | 'Money In' | 'UPI' | 'Bank' | 'Card' | 'Wallet'
  const [filterCategory, setFilterCategory] = useState('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterNoteStatus, setFilterNoteStatus] = useState('all'); // 'all' | 'has_note' | 'missing_note'
  const [filterReviewStatus, setFilterReviewStatus] = useState('all'); // 'all' | 'confirmed' | 'needs_review'
  const [filterMinAmount, setFilterMinAmount] = useState('');
  const [filterMaxAmount, setFilterMaxAmount] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Natural Language Assistant Query
  const [nlQuery, setNlQuery] = useState('');
  const [nlResponse, setNlResponse] = useState(null);

  // Receipt Paste Modal
  const [showSmsPasteModal, setShowSmsPasteModal] = useState(false);
  const [smsPasteText, setSmsPasteText] = useState('');

  // Real Bank Account Balance & Check Balance Modal State
  const [bankBalanceInfo, setBankBalanceInfo] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.PattanBiometric && typeof window.PattanBiometric.getBankBalanceJson === 'function') {
        const raw = window.PattanBiometric.getBankBalanceJson();
        const parsed = JSON.parse(raw || '{}');
        if (parsed && typeof parsed.balance === 'number' && Number.isFinite(parsed.balance)) {
          return parsed;
        }
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        const localRaw = window.localStorage.getItem('yasin_ot_bank_balance_v1');
        if (localRaw) {
          const parsed = JSON.parse(localRaw);
          if (parsed && typeof parsed.balance === 'number' && Number.isFinite(parsed.balance)) {
            return parsed;
          }
        }
      }
    } catch (_) {}
    return null;
  });
  const [showCheckBalanceModal, setShowCheckBalanceModal] = useState(false);
  const [balanceDraftAmount, setBalanceDraftAmount] = useState('');
  const [balanceDraftBank, setBalanceDraftBank] = useState('Linked Bank Account');
  const [balanceDraftMask, setBalanceDraftMask] = useState('');

  const persistBankBalance = useCallback((nextBalObj) => {
    if (!nextBalObj || typeof nextBalObj !== 'object' || !Number.isFinite(Number(nextBalObj.balance))) return;
    const normalized = {
      balance: Number(Number(nextBalObj.balance).toFixed(2)),
      bankName: String(nextBalObj.bankName || 'Linked Bank Account').trim(),
      accountMask: String(nextBalObj.accountMask || '').trim(),
      source: String(nextBalObj.source || 'manual-balance-sync'),
      updatedAtMs: Number(nextBalObj.updatedAtMs) || Date.now(),
    };
    setBankBalanceInfo(normalized);
    try {
      const jsonStr = JSON.stringify(normalized);
      if (typeof window !== 'undefined' && window.PattanBiometric && typeof window.PattanBiometric.saveBankBalanceJson === 'function') {
        window.PattanBiometric.saveBankBalanceJson(jsonStr);
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('yasin_ot_bank_balance_v1', jsonStr);
      }
    } catch (_) {}
  }, []);

  const syncSavedBankBalanceFromNative = useCallback(() => {
    try {
      if (typeof window !== 'undefined' && window.PattanBiometric && typeof window.PattanBiometric.getBankBalanceJson === 'function') {
        const raw = window.PattanBiometric.getBankBalanceJson();
        const parsed = JSON.parse(raw || '{}');
        if (parsed && typeof parsed.balance === 'number' && Number.isFinite(parsed.balance)) {
          setBankBalanceInfo((prev) => {
            if (!prev || Number(parsed.updatedAtMs || 0) >= Number(prev.updatedAtMs || 0) || parsed.balance !== prev.balance) {
              try {
                if (window.localStorage) {
                  window.localStorage.setItem('yasin_ot_bank_balance_v1', JSON.stringify(parsed));
                }
              } catch (_) {}
              return parsed;
            }
            return prev;
          });
        }
      }
    } catch (_) {}
  }, []);

  // Native Permission & Scan Status
  const [scanStatus, setScanStatus] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [notifGranted, setNotifGranted] = useState(false);
  const [smsGranted, setSmsGranted] = useState(false);
  const [undoBanner, setUndoBanner] = useState(null);

  const storageStatus = useMemo(() => getExpenseStorageStatus(), [notifGranted, expensesMap]);

  const isLight = themeMode === 'light';
  const palette = useMemo(() => (
    isLight
      ? {
          bg: '#f4f7fb',
          surface: '#ffffff',
          surfaceAlt: '#f8fafc',
          border: 'rgba(15, 23, 42, 0.08)',
          text: '#0f172a',
          textSub: '#475569',
          textMuted: '#64748b',
          pillBg: '#e2e8f0',
          activeBlue: '#2563eb',
          debit: '#ef4444',
          credit: '#10b981',
        }
      : {
          bg: '#080d1a',
          surface: '#111827',
          surfaceAlt: '#0c1322',
          border: 'rgba(148, 163, 184, 0.14)',
          text: '#f8fafc',
          textSub: '#cbd5e1',
          textMuted: '#94a3b8',
          pillBg: '#172033',
          activeBlue: '#2563eb',
          debit: '#fb7185',
          credit: '#34d399',
        }
  ), [isLight]);

  const checkNativePermissions = useCallback(() => {
    try {
      if (window.PattanBiometric) {
        if (typeof window.PattanBiometric.isNotificationListenerEnabled === 'function') {
          setNotifGranted(Boolean(window.PattanBiometric.isNotificationListenerEnabled()));
        }
        if (typeof window.PattanBiometric.hasSmsPermission === 'function') {
          setSmsGranted(Boolean(window.PattanBiometric.hasSmsPermission()));
        }
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    checkNativePermissions();
  }, [checkNativePermissions]);

  const mergeDetectedTransactions = useCallback(
    (incomingList, sourceLabel = 'mobile-auto') => {
      if (!Array.isArray(incomingList) || incomingList.length === 0) return 0;
      const { nextMap, addedCount, updatedCount } = reconcileAndMergeTransactions(
        expensesMap || {},
        incomingList,
        sourceLabel
      );
      const totalChanges = addedCount + updatedCount;
      if (totalChanges > 0 && typeof onUpdateExpenses === 'function') {
        onUpdateExpenses(
          nextMap,
          `📲 Synced ${addedCount} new & ${updatedCount} updated transaction${totalChanges === 1 ? '' : 's'}`
        );
      }
      return totalChanges;
    },
    [expensesMap, onUpdateExpenses]
  );

  useEffect(() => {
    const onMobileTxEvent = (ev) => {
      const detail = ev?.detail;
      setIsScanning(false);
      if (!detail) return;
      if (typeof detail.notifGranted === 'boolean') setNotifGranted(detail.notifGranted);
      if (typeof detail.smsGranted === 'boolean') setSmsGranted(detail.smsGranted);
      syncSavedBankBalanceFromNative();
      const txList = Array.isArray(detail.transactions) ? detail.transactions : [];
      if (txList.length > 0) {
        const added = mergeDetectedTransactions(txList, 'android-notif');
        if (added > 0) {
          setScanStatus(`✅ Auto-captured ${added} new UPI/Bank transaction(s) (Payments & Deposits)`);
        }
      }
    };
    window.addEventListener('pattan-mobile-transactions', onMobileTxEvent);
    return () => window.removeEventListener('pattan-mobile-transactions', onMobileTxEvent);
  }, [mergeDetectedTransactions, syncSavedBankBalanceFromNative]);

  // Continuous zero-fetch auto-sync of encrypted notification captures & bank balance (every 2.5s + focus)
  useEffect(() => {
    const syncNativeNow = () => {
      checkNativePermissions();
      syncSavedBankBalanceFromNative();
      try {
        if (window.PattanBiometric && typeof window.PattanBiometric.getSavedMobileTransactionsJson === 'function') {
          const savedRaw = window.PattanBiometric.getSavedMobileTransactionsJson();
          const savedArr = JSON.parse(savedRaw || '[]');
          if (Array.isArray(savedArr) && savedArr.length > 0) {
            mergeDetectedTransactions(savedArr, 'android-saved-notif');
          }
        }
      } catch (_) {}
    };
    syncNativeNow();
    const intervalId = setInterval(syncNativeNow, 2500);
    window.addEventListener('focus', syncNativeNow);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', syncNativeNow);
    };
  }, [checkNativePermissions, mergeDetectedTransactions, syncSavedBankBalanceFromNative]);

  // Automatically trigger full native scan the moment Notification Access is granted (zero manual fetch required)
  useEffect(() => {
    if (notifGranted) {
      try {
        if (window.PattanBiometric && typeof window.PattanBiometric.scanMobileTransactions === 'function') {
          window.PattanBiometric.scanMobileTransactions(60);
        }
      } catch (_) {}
    }
  }, [notifGranted]);

  const triggerMobileTransactionScan = () => {
    setIsScanning(true);
    checkNativePermissions();
    syncSavedBankBalanceFromNative();
    try {
      if (window.PattanBiometric && typeof window.PattanBiometric.scanMobileTransactions === 'function') {
        window.PattanBiometric.scanMobileTransactions(60);
        return;
      }
      if (window.PattanBiometric && typeof window.PattanBiometric.scanMobileSmsInbox === 'function') {
        window.PattanBiometric.scanMobileSmsInbox(60);
        return;
      }
      if (window.PattanBiometric && typeof window.PattanBiometric.getSavedMobileTransactionsJson === 'function') {
        const savedRaw = window.PattanBiometric.getSavedMobileTransactionsJson();
        const savedArr = JSON.parse(savedRaw || '[]');
        const added = mergeDetectedTransactions(savedArr, 'android-saved-notif');
        setIsScanning(false);
        setScanStatus(
          added > 0
            ? `✅ Synced ${added} new payment/deposit notification(s)`
            : notifGranted
              ? '✅ Zero-Fetch Auto Capture is active for all UPI & Bank payments and deposits.'
              : 'ℹ️ Enable Notification Listener access to capture UPI payments & deposits automatically.'
        );
        return;
      }
    } catch (_) {}
    setIsScanning(false);
    setShowSmsPasteModal(true);
  };

  const todayIso = getTodayIso();

  const effectiveExpensesSource = useMemo(() => {
    const cleanMap = {};
    if (expensesMap && typeof expensesMap === 'object') {
      for (const [k, v] of Object.entries(expensesMap)) {
        if (
          v &&
          typeof v === 'object' &&
          !v._demoPreview &&
          !v.isDemoPreview &&
          v.source !== 'demo-preview' &&
          !String(k).startsWith('demo_tx_')
        ) {
          const restored = { ...v };
          delete restored._deleted;
          cleanMap[k] = restored;
        }
      }
    }
    return cleanMap;
  }, [expensesMap]);

  const analytics = useMemo(
    () =>
      computeExpenseAnalytics(effectiveExpensesSource, {
        selectedMonth,
        todayIso,
        monthlyNetSalary: effectiveMonthlySalary,
        bankBalanceInfo,
      }),
    [effectiveExpensesSource, selectedMonth, todayIso, effectiveMonthlySalary, bankBalanceInfo]
  );

  // Recent payments list: always show current month's payments, or all saved payments if current month has none
  const recentPaymentsList = useMemo(() => {
    if (analytics.monthActiveList && analytics.monthActiveList.length > 0) {
      return analytics.monthActiveList;
    }
    return analytics.allActiveList || [];
  }, [analytics.monthActiveList, analytics.allActiveList]);

  // Sync detail drafts when a transaction is opened in Screen 9
  const selectedTx = useMemo(() => {
    if (!selectedTxId) return null;
    const raw = (effectiveExpensesSource || {})[selectedTxId];
    return raw ? migrateAndNormalizeExpenseRecord(raw) : null;
  }, [selectedTxId, effectiveExpensesSource]);

  useEffect(() => {
    if (selectedTx) {
      setDetailNoteDraft(selectedTx.personalNote || selectedTx.note || '');
      setDetailMerchantDraft(selectedTx.merchant || '');
    }
  }, [selectedTx]);

  // Top 4 Category summary cards for Screen 7 (Food, Transport, Shopping, Others)
  const screen7CategoryCards = useMemo(() => {
    const byCat = analytics.categoryBreakdown || [];
    const findTotal = (keywords) =>
      byCat
        .filter((c) => keywords.some((k) => c.category.toLowerCase().includes(k)))
        .reduce((acc, c) => acc + c.total, 0);

    const foodTotal = findTotal(['food', 'grocer']);
    const transportTotal = findTotal(['fuel', 'commute', 'transport', 'travel']);
    const shoppingTotal = findTotal(['shop']);
    const othersTotal = Math.max(0, analytics.grossExpenses - foodTotal - transportTotal - shoppingTotal);

    return [
      { id: 'Food & Dining', label: 'Food', amount: foodTotal, color: '#eab308' },
      { id: 'Fuel & Commute', label: 'Transport', amount: transportTotal, color: '#3b82f6' },
      { id: 'Shopping', label: 'Shopping', amount: shoppingTotal, color: '#10b981' },
      { id: 'all', label: 'Others', amount: othersTotal, color: '#a855f7' },
    ];
  }, [analytics]);

  // Donut chart segments for Screen 10 (Insights)
  const donutSegments = useMemo(() => {
    const byCat = analytics.categoryBreakdown || [];
    if (byCat.length === 0 || analytics.grossExpenses <= 0) {
      return [
        { label: 'Food', pct: 36, total: 0, color: '#3b82f6' },
        { label: 'Shopping', pct: 17, total: 0, color: '#a855f7' },
        { label: 'Transport', pct: 13, total: 0, color: '#10b981' },
        { label: 'Bills', pct: 11, total: 0, color: '#eab308' },
        { label: 'Others', pct: 23, total: 0, color: '#ec4899' },
      ];
    }
    const colors = ['#3b82f6', '#a855f7', '#10b981', '#eab308', '#ec4899'];
    const top4 = byCat.slice(0, 4);
    const restTotal = byCat.slice(4).reduce((s, c) => s + c.total, 0);
    const list = top4.map((c, idx) => ({
      label: c.category.split(' ')[0].replace(/[^A-Za-z]/g, '') || c.category,
      pct: Math.max(1, Math.round(c.sharePct)),
      total: c.total,
      color: colors[idx % colors.length],
    }));
    if (restTotal > 0) {
      list.push({
        label: 'Others',
        pct: Math.max(1, Math.round((restTotal / analytics.grossExpenses) * 100)),
        total: restTotal,
        color: colors[4],
      });
    }
    return list;
  }, [analytics]);

  // Filtered Transactions for Screen 8 (including all-time fallback so transactions never disappear)
  const sourceTransactionsForList = useMemo(() => {
    if (analytics.monthActiveList && analytics.monthActiveList.length > 0) {
      return analytics.monthActiveList;
    }
    return analytics.allActiveList || [];
  }, [analytics.monthActiveList, analytics.allActiveList]);

  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const minAmt = filterMinAmount !== '' ? Number(filterMinAmount) : null;
    const maxAmt = filterMaxAmount !== '' ? Number(filterMaxAmount) : null;

    return sourceTransactionsForList.filter((tx) => {
      if (filterCategory !== 'all' && tx.category !== filterCategory && !String(tx.category || '').toLowerCase().includes(String(filterCategory).toLowerCase())) return false;
      if (methodPillFilter !== 'All') {
        if (methodPillFilter === 'Money Out' && tx.type !== 'debit') return false;
        if (methodPillFilter === 'Money In' && tx.type !== 'credit' && tx.type !== 'refund') return false;
        const mStr = `${tx.paymentMethod || ''} ${tx.app || ''}`.toLowerCase();
        if (methodPillFilter === 'UPI' && !mStr.includes('upi') && !['gpay', 'google pay', 'phonepe', 'paytm', 'bhim'].some((a) => mStr.includes(a))) return false;
        if (methodPillFilter === 'Bank' && !mStr.includes('bank') && !mStr.includes('neft') && !mStr.includes('imps')) return false;
        if (methodPillFilter === 'Card' && !mStr.includes('card')) return false;
        if (methodPillFilter === 'Wallet' && !mStr.includes('wallet') && !mStr.includes('cash')) return false;
      }
      const hasNote = Boolean(String(tx.personalNote || tx.note || '').trim());
      if (filterNoteStatus === 'has_note' && !hasNote) return false;
      if (filterNoteStatus === 'missing_note' && hasNote) return false;

      if (filterReviewStatus === 'confirmed' && tx.reconciliationStatus === 'needs_review') return false;
      if (filterReviewStatus === 'needs_review' && tx.reconciliationStatus !== 'needs_review') return false;

      if (minAmt !== null && Number.isFinite(minAmt) && Number(tx.amount) < minAmt) return false;
      if (maxAmt !== null && Number.isFinite(maxAmt) && Number(tx.amount) > maxAmt) return false;
      if (filterDateFrom && tx.date < filterDateFrom) return false;
      if (filterDateTo && tx.date > filterDateTo) return false;

      if (!q) return true;
      const hay = [
        tx.merchant,
        tx.personalNote,
        tx.paymentRemark,
        tx.note,
        tx.category,
        tx.app,
        tx.paymentMethod,
        tx.refId,
        ...(tx.tags || []),
        String(tx.amount),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [
    sourceTransactionsForList,
    filterCategory,
    methodPillFilter,
    filterNoteStatus,
    filterReviewStatus,
    filterMinAmount,
    filterMaxAmount,
    filterDateFrom,
    filterDateTo,
    searchQuery,
  ]);

  const groupedByDay = useMemo(() => {
    const groups = [];
    const map = new Map();
    for (const tx of filteredTransactions) {
      const d = tx.date || todayIso;
      if (!map.has(d)) {
        const g = { date: d, label: formatFriendlyDate(d, todayIso), items: [], daySpent: 0, dayReceived: 0 };
        map.set(d, g);
        groups.push(g);
      }
      const grp = map.get(d);
      grp.items.push(tx);
      if (tx.type === 'credit' || tx.type === 'refund') {
        grp.dayReceived += Number(tx.amount) || 0;
      } else {
        grp.daySpent += Number(tx.amount) || 0;
      }
    }
    return groups;
  }, [filteredTransactions, todayIso]);

  // Missing notes filtered by All / Today / This Week (Screen 11)
  const filteredMissingNotes = useMemo(() => {
    const allMissing = analytics.missingNotesList || [];
    const todayItems = allMissing.filter((tx) => tx.date === todayIso);
    const nowMs = new Date(`${todayIso}T23:59:59`).getTime();
    const weekItems = allMissing.filter((tx) => {
      const dMs = new Date(`${tx.date}T12:00:00`).getTime();
      return nowMs - dMs <= 7 * 86400000;
    });
    return {
      all: allMissing,
      today: todayItems,
      week: weekItems,
      active:
        missingFilterWindow === 'today'
          ? todayItems
          : missingFilterWindow === 'week'
            ? weekItems
            : allMissing,
    };
  }, [analytics.missingNotesList, missingFilterWindow, todayIso]);

  const merchantSuggestions = useMemo(
    () => suggestNotesAndCategoryForMerchant(effectiveExpensesSource, formMerchant || selectedTx?.merchant || ''),
    [effectiveExpensesSource, formMerchant, selectedTx]
  );

  const getMaterializedBaseMap = useCallback(() => {
    const clean = {};
    for (const [k, v] of Object.entries(expensesMap || {})) {
      if (v && typeof v === 'object' && !v._demoPreview && !v.isDemoPreview) {
        const copy = { ...v };
        delete copy._deleted;
        clean[k] = copy;
      }
    }
    return clean;
  }, [expensesMap]);

  const openQuickAddModal = (txToEdit = null, defaultType = 'debit') => {
    if (txToEdit && typeof txToEdit === 'object' && txToEdit.id) {
      const norm = migrateAndNormalizeExpenseRecord(txToEdit);
      setEditingTxId(norm.id);
      setFormAmount(String(norm.amount));
      setFormType(norm.type || 'debit');
      setFormMerchant(norm.merchant || '');
      setFormPayeeVpa(norm.payeeVpa || norm.vpa || '');
      setFormNote(norm.personalNote || '');
      setFormPaymentRemark(norm.paymentRemark || '');
      setFormCategory(norm.category || 'Food & Dining');
      setFormPaymentMethod(norm.paymentMethod || 'UPI');
      setFormApp(norm.app || 'GPay');
      setFormDate(norm.date || todayIso);
      setFormTime(norm.time || '12:00');
      setFormTagsInput((norm.tags || []).join(', '));
    } else {
      const now = new Date();
      const initType = defaultType === 'credit' || defaultType === 'refund' ? defaultType : 'debit';
      setEditingTxId(null);
      setFormAmount('');
      setFormType(initType);
      setFormMerchant('');
      setFormPayeeVpa('');
      setFormNote('');
      setFormPaymentRemark('');
      setFormCategory(initType === 'credit' ? 'Salary / Income' : 'Food & Dining');
      setFormPaymentMethod('UPI');
      setFormApp('GPay');
      setFormDate(todayIso);
      setFormTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
      setFormTagsInput('');
    }
    setShowAddModal(true);
  };

  const openCheckBalanceModal = () => {
    setBalanceDraftAmount(
      analytics.realAccountBalance !== undefined && Number.isFinite(Number(analytics.realAccountBalance))
        ? String(Number(analytics.realAccountBalance.toFixed(2)))
        : ''
    );
    setBalanceDraftBank(bankBalanceInfo?.bankName || 'Linked Bank Account');
    setBalanceDraftMask(bankBalanceInfo?.accountMask || '');
    setShowCheckBalanceModal(true);
  };

  const handleSaveBankBalanceManual = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const num = Number(String(balanceDraftAmount).replace(/,/g, '').trim());
    if (!Number.isFinite(num) || num < 0) {
      setScanStatus('⚠️ Please enter a valid bank balance amount (₹0 or more).');
      return;
    }
    persistBankBalance({
      balance: num,
      bankName: balanceDraftBank || 'Linked Bank Account',
      accountMask: balanceDraftMask || '',
      source: 'user-verified-balance',
      updatedAtMs: Date.now(),
    });
    setShowCheckBalanceModal(false);
    setScanStatus(`🏦 Real Account Balance synced to ₹${formatINR(num)}. Future payments (-₹) and deposits (+₹) will update this balance automatically.`);
  };

  const handleLaunchUpiBalanceCheck = (appKey, appLabel) => {
    try {
      if (window.PattanBiometric && typeof window.PattanBiometric.openUpiAppForBalanceCheck === 'function') {
        const opened = window.PattanBiometric.openUpiAppForBalanceCheck(appKey);
        if (opened) {
          setScanStatus(`🏦 Opening ${appLabel} to check balance — any bank SMS/notification balance alert will sync automatically.`);
          return;
        }
      }
    } catch (_) {}
    setScanStatus(`ℹ️ Check your balance in ${appLabel} or enter your current balance below to track every ₹ spent and deposited.`);
  };

  const handleSaveTransactionForm = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const amt = Number(formAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setScanStatus('⚠️ Please enter a valid amount greater than ₹0.');
      return;
    }
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const baseMap = getMaterializedBaseMap();
    const txId = editingTxId || `tx_manual_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;
    const existing = editingTxId ? baseMap[editingTxId] : null;
    const cleanNote = formNote.trim();
    const cleanMerchant =
      formMerchant.trim() ||
      (cleanNote ? cleanNote.slice(0, 32) : formType === 'credit' ? 'Bank Deposit / Received' : 'Mobile Payment');
    const tags = formTagsInput
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);

    // Compute updated real account balance if this is a new entry
    let nextAccountBal = existing?.accountBalance ?? null;
    if (!editingTxId) {
      const currentRealBal = Number(analytics.realAccountBalance || 0);
      const isCreditEntry = formType === 'credit' || formType === 'refund';
      nextAccountBal = Number((isCreditEntry ? currentRealBal + amt : currentRealBal - amt).toFixed(2));
      if (bankBalanceInfo && Number.isFinite(Number(bankBalanceInfo.balance))) {
        persistBankBalance({
          balance: nextAccountBal,
          bankName: bankBalanceInfo.bankName || formApp || 'Linked Bank Account',
          accountMask: bankBalanceInfo.accountMask || '',
          source: isCreditEntry ? 'auto-adjusted-credit' : 'auto-adjusted-debit',
          updatedAtMs: nowMs,
        });
      }
    }

    const record = migrateAndNormalizeExpenseRecord({
      ...(existing || {}),
      id: txId,
      amount: Number(amt.toFixed(2)),
      currency: 'INR',
      type: formType,
      merchant: cleanMerchant,
      payeeVpa: formPayeeVpa.trim(),
      personalNote: cleanNote,
      paymentRemark: formPaymentRemark.trim(),
      note: cleanNote || formPaymentRemark.trim(),
      category: formCategory,
      paymentMethod: formPaymentMethod,
      app: formApp,
      accountBalance: nextAccountBal,
      date: formDate || todayIso,
      time: formTime || '12:00',
      tags,
      status: 'completed',
      detectionStatus: 'user_confirmed',
      noteReviewed: Boolean(cleanNote),
      source: existing?.source || 'manual',
      timestampMs: existing?.timestampMs || nowMs,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
      updatedAtMs: nowMs,
    });
    delete record._demoPreview;
    delete record.isDemoPreview;
    delete record._deleted;

    const nextMap = { ...baseMap, [txId]: record };
    if (typeof onUpdateExpenses === 'function') {
      const dirBadge = formType === 'credit' ? '+₹' : formType === 'refund' ? '+₹' : '-₹';
      onUpdateExpenses(
        nextMap,
        `${editingTxId ? '✏️ Updated' : '💾 Saved'} ${dirBadge}${formatINR(amt)} — ${cleanMerchant}${cleanNote ? ` (${cleanNote})` : ''}`
      );
    }
    setShowAddModal(false);
    setEditingTxId(null);
  };

  const handleLaunchUpiAndSave = () => {
    const amt = Number(formAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setScanStatus('⚠️ Enter an amount first to launch UPI payment.');
      return;
    }
    launchUpiPayment({
      payeeVpa: formPayeeVpa.trim(),
      payeeName: formMerchant.trim() || 'Merchant',
      amount: amt,
      note: formNote.trim() || formPaymentRemark.trim() || 'Payment',
    });
    handleSaveTransactionForm();
  };

  const handleUpdatePersonalNote = (txId, newPersonalNote, markReviewed = true, newMerchant = null) => {
    const baseMap = getMaterializedBaseMap();
    const existing = baseMap[txId] || (effectiveExpensesSource || {})[txId];
    if (!existing) return;
    const nowMs = Date.now();
    const clean = String(newPersonalNote || '').trim();
    const updated = migrateAndNormalizeExpenseRecord({
      ...existing,
      merchant: newMerchant !== null && String(newMerchant).trim() ? String(newMerchant).trim() : existing.merchant,
      personalNote: clean,
      note: clean || existing.paymentRemark || '',
      noteReviewed: markReviewed || Boolean(clean),
      updatedAt: new Date(nowMs).toISOString(),
      updatedAtMs: nowMs,
    });
    delete updated._demoPreview;
    delete updated.isDemoPreview;
    delete updated._deleted;
    const nextMap = { ...baseMap, [txId]: updated };
    setInlineNoteDrafts((prev) => {
      const next = { ...prev };
      delete next[txId];
      return next;
    });
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(nextMap, clean ? `📝 Saved note: "${clean}"` : '✓ Marked transaction reviewed');
    }
  };

  // Permanent ledger policy: transactions are never deleted
  const handleDeleteTransaction = () => {
    setScanStatus('🔒 Permanent Ledger Active: Transactions are protected and never deleted.');
  };

  const handlePasteSmsParse = () => {
    const raw = smsPasteText.trim();
    if (!raw) return;
    const parsed = parseSmsOrUpiTextJs(raw, Date.now());
    if (!parsed) {
      // Check if it is a standalone bank balance inquiry SMS
      const balMatch = raw.match(/(?:avl\.?\s*bal(?:ance)?|available\s+bal(?:ance)?|a\/c\s*bal(?:ance)?|closing\s+bal(?:ance)?|clear\s+bal(?:ance)?|total\s+bal(?:ance)?|updated\s+bal(?:ance)?|bal(?:ance)?\s*(?:is|:))\s*(?:is\s*)?(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
      if (balMatch && balMatch[1]) {
        const bVal = Number(balMatch[1].replace(/,/g, ''));
        if (Number.isFinite(bVal) && bVal >= 0) {
          persistBankBalance({
            balance: bVal,
            bankName: 'Bank SMS Balance',
            accountMask: '',
            source: 'sms-balance-paste',
            updatedAtMs: Date.now(),
          });
          setSmsPasteText('');
          setShowSmsPasteModal(false);
          setScanStatus(`🏦 Updated Real Account Balance to ₹${formatINR(bVal)} from Bank SMS`);
          return;
        }
      }
      setScanStatus('⚠️ No valid payment or deposit found in pasted message.');
      return;
    }
    if (parsed.accountBalance !== null && parsed.accountBalance !== undefined && Number.isFinite(Number(parsed.accountBalance))) {
      persistBankBalance({
        balance: Number(parsed.accountBalance),
        bankName: parsed.app || 'Bank Account',
        accountMask: parsed.accountMask || '',
        source: 'sms-paste-avl-bal',
        updatedAtMs: Date.now(),
      });
    } else if (bankBalanceInfo && Number.isFinite(Number(bankBalanceInfo.balance))) {
      const nextBal = parsed.type === 'credit' || parsed.type === 'refund'
        ? Number(bankBalanceInfo.balance) + Number(parsed.amount)
        : Number(bankBalanceInfo.balance) - Number(parsed.amount);
      persistBankBalance({
        balance: nextBal,
        bankName: bankBalanceInfo.bankName || parsed.app || 'Bank Account',
        accountMask: parsed.accountMask || bankBalanceInfo.accountMask || '',
        source: 'sms-paste-adjusted',
        updatedAtMs: Date.now(),
      });
    }
    mergeDetectedTransactions([parsed], 'sms-paste');
    setSmsPasteText('');
    setShowSmsPasteModal(false);
    const sign = parsed.type === 'credit' || parsed.type === 'refund' ? '+' : '-';
    setScanStatus(`✅ Added ${sign}₹${formatINR(parsed.amount)} (${parsed.merchant}) from pasted message`);
  };

  const handleExportExpensesCsv = () => {
    const csv = formatTransactionsCsv(sourceTransactionsForList);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Expense-Memory-${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setScanStatus('✅ Your CSV report is ready.');
  };

  const handleExportExpensesJson = () => {
    const payload = JSON.stringify(
      {
        selectedMonth,
        exportedAt: new Date().toISOString(),
        transactions: sourceTransactionsForList,
      },
      null,
      2
    );
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Expense-Memory-Backup-${selectedMonth}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setScanStatus('✅ Exported JSON backup of your Expense Memory.');
  };

  const handleClearAllExpenses = () => {
    setScanStatus('🔒 Permanent Ledger Active: Transactions are permanently protected and cannot be deleted.');
  };

  const handleAskQuestion = (questionText) => {
    const q = String(questionText ?? nlQuery).trim();
    if (!q) return;
    setNlQuery(q);
    setNlResponse(answerNaturalLanguageFinanceQuery(q, effectiveExpensesSource, selectedMonth, todayIso));
  };

  const remainingSalary = Math.max(0, effectiveMonthlySalary - analytics.netSpending + analytics.totalIncome);

  const handleConfirmReviewItem = (txId) => {
    const baseMap = getMaterializedBaseMap();
    const existing = baseMap[txId] || (effectiveExpensesSource || {})[txId];
    if (!existing) return;
    const nowMs = Date.now();
    const updated = migrateAndNormalizeExpenseRecord({
      ...existing,
      status: 'completed',
      reconciliationStatus: 'confirmed',
      duplicateOfId: '',
      updatedAt: new Date(nowMs).toISOString(),
      updatedAtMs: nowMs,
    });
    delete updated._demoPreview;
    delete updated.isDemoPreview;
    const nextMap = { ...baseMap, [txId]: updated };
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(nextMap, `✅ Confirmed ₹${formatINR(updated.amount)} (${updated.merchant})`);
    }
  };

  // ── SCREEN 9: DETAILED TRANSACTION VIEWER ─────────────────────────────────
  if (selectedTx) {
    const isCredit = selectedTx.type === 'credit' || selectedTx.type === 'refund';
    const upiHandle =
      selectedTx.vpa ||
      `${String(selectedTx.merchant || 'merchant').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 14) || 'merchant'}@okaxis`;
    const txRefDisplay = selectedTx.refId || `T${String(selectedTx.timestampMs || Date.now()).slice(-12)}`;

    return (
      <div style={{
        background: palette.bg,
        borderRadius: 24,
        border: `1px solid ${palette.border}`,
        padding: mobileMode ? '16px 14px 22px' : '22px 24px 28px',
        color: palette.text,
        boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
      }}>
        {/* Top Bar: < Back & Delete/Edit */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setSelectedTxId(null)}
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              border: `1px solid ${palette.border}`,
              background: palette.surface,
              color: palette.text,
              fontSize: 18,
              fontWeight: 900,
              cursor: 'pointer',
            }}
            title="Back"
          >
            ‹
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => {
                const tx = selectedTx;
                setSelectedTxId(null);
                openQuickAddModal(tx);
              }}
              style={{
                padding: '7px 12px',
                borderRadius: 10,
                border: `1px solid ${palette.border}`,
                background: palette.surface,
                color: palette.textSub,
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              ✏️ Edit Full
            </button>
            <span
              style={{
                padding: '7px 12px',
                borderRadius: 10,
                border: '1px solid rgba(16,185,129,0.4)',
                background: 'rgba(16,185,129,0.12)',
                color: '#34d399',
                fontSize: 11,
                fontWeight: 800,
                display: 'inline-flex',
                alignItems: 'center',
              }}
              title="Transactions are permanently saved and never deleted"
            >
              🔒 Permanent
            </span>
          </div>
        </div>

        {/* Centered Brand Logo & Amount Hero (Screen 9) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 20 }}>
          <BrandPaymentAvatar tx={selectedTx} size={64} />
          <div style={{ fontSize: 18, fontWeight: 900, color: palette.text, marginTop: 10 }}>
            {selectedTx.app || selectedTx.merchant || 'Google Pay'}
          </div>
          <div style={{ fontSize: 12, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
            {selectedTx.paymentMethod === 'UPI' ? 'UPI Payment' : `${selectedTx.paymentMethod || 'Online'} Payment`}
          </div>
          <div style={{
            fontSize: 34,
            fontWeight: 950,
            color: isCredit ? palette.credit : '#f43f5e',
            letterSpacing: '-0.02em',
            marginTop: 8,
          }}>
            {isCredit ? `+ ₹${formatINR(selectedTx.amount)}` : `- ₹${formatINR(selectedTx.amount)}`}
          </div>
          <div style={{ fontSize: 12, color: palette.textMuted, fontWeight: 700, marginTop: 4 }}>
            {formatShortDate(selectedTx.date)}, {formatTime12h(selectedTx.time)}
          </div>
        </div>

        {/* Structured Details Card (Screen 9) */}
        <div style={{
          background: palette.surface,
          borderRadius: 18,
          border: `1px solid ${palette.border}`,
          padding: '14px 16px',
          marginBottom: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 11,
        }}>
          {[
            { label: 'Statement Entry', value: isCredit ? '💰 CREDIT / DEPOSIT (+₹)' : '💸 DEBIT / PAYMENT (-₹)' },
            { label: 'Type', value: selectedTx.paymentMethod === 'UPI' ? 'UPI Payment' : (selectedTx.paymentMethod || 'Payment') },
            { label: 'From / Account', value: selectedTx.accountMask ? `Bank Account (${selectedTx.accountMask})` : (bankBalanceInfo?.accountMask ? `Bank Account (${bankBalanceInfo.accountMask})` : 'Linked Bank Account') },
            { label: isCredit ? 'Received From' : 'Paid To', value: (selectedTx.merchant || 'Merchant').toUpperCase() },
            { label: 'Category', value: selectedTx.category || (isCredit ? 'Salary / Income' : 'Food & Dining') },
            { label: 'UPI ID', value: upiHandle },
            { label: 'UTR / Ref ID', value: txRefDisplay },
            {
              label: 'Balance After Txn',
              value:
                Number.isFinite(Number(selectedTx.runningBalance))
                  ? `₹${formatINR(selectedTx.runningBalance)}`
                  : Number.isFinite(Number(selectedTx.accountBalance))
                    ? `₹${formatINR(selectedTx.accountBalance)}`
                    : `₹${formatINR(analytics.realAccountBalance)}`,
            },
            { label: 'Ledger Security', value: '🔒 Permanent Record (Never Deleted)' },
          ].map((row) => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 12.5, color: palette.textMuted, fontWeight: 700 }}>{row.label}</span>
              <span style={{ fontSize: 12.5, color: palette.text, fontWeight: 800, textAlign: 'right' }}>{row.value}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4, borderTop: `1px solid ${palette.border}` }}>
            <span style={{ fontSize: 12.5, color: palette.textMuted, fontWeight: 700 }}>Status</span>
            <span style={{
              padding: '3px 10px',
              borderRadius: 999,
              background: 'rgba(16, 185, 129, 0.16)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              color: '#34d399',
              fontSize: 11.5,
              fontWeight: 900,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}>
              ● {selectedTx.reconciliationStatus === 'needs_review' ? 'Needs Review' : 'Completed'}
            </span>
          </div>
        </div>

        {/* Note (Personal Memory) Card (Screen 9) */}
        <div style={{
          background: palette.surface,
          borderRadius: 18,
          border: '1.5px solid rgba(59, 130, 246, 0.4)',
          padding: '14px 16px',
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: '#60a5fa' }}>
              📌 Note (Personal Memory)
            </span>
            <span style={{ fontSize: 12, color: palette.textMuted }}>✏️</span>
          </div>
          <input
            type="text"
            value={detailNoteDraft}
            onChange={(e) => setDetailNoteDraft(e.target.value)}
            placeholder="What was this payment for? (e.g. Office lunch with team)"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              borderRadius: 12,
              border: `1px solid ${palette.border}`,
              background: palette.surfaceAlt,
              color: palette.text,
              fontSize: 14,
              fontWeight: 800,
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {QUICK_NOTE_TEMPLATES.slice(0, 5).map((tpl) => (
              <button
                key={tpl.label}
                type="button"
                onClick={() => setDetailNoteDraft(tpl.label)}
                style={{
                  padding: '4px 9px',
                  borderRadius: 999,
                  border: `1px solid ${palette.border}`,
                  background: detailNoteDraft === tpl.label ? 'rgba(37,99,235,0.22)' : palette.surfaceAlt,
                  color: detailNoteDraft === tpl.label ? '#60a5fa' : palette.textSub,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        {/* Save Note Primary Royal Blue Button (Screen 9) */}
        <button
          type="button"
          onClick={() => {
            handleUpdatePersonalNote(selectedTx.id, detailNoteDraft, true, detailMerchantDraft);
            setSelectedTxId(null);
          }}
          style={{
            width: '100%',
            padding: '15px 18px',
            borderRadius: 16,
            border: 'none',
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            color: '#ffffff',
            fontWeight: 900,
            fontSize: 15,
            cursor: 'pointer',
            boxShadow: '0 10px 25px rgba(37, 99, 235, 0.4)',
          }}
        >
          Save Note
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, color: palette.text }}>
      {/* Top Sub-Navigation Pills (Screens 7, 8, 10, 11, Settings) */}
      <div style={{
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        padding: '4px',
        borderRadius: 14,
        background: palette.surface,
        border: `1px solid ${palette.border}`,
      }}>
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'transactions', label: `Transactions (${analytics.totalCount})` },
          { id: 'insights', label: 'Insights' },
          { id: 'missing-notes', label: `Missing Notes (${analytics.missingNotesCount})` },
          { id: 'settings', label: 'Privacy & CSV' },
        ].map((tab) => {
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              style={{
                flex: '1 0 auto',
                padding: '9px 13px',
                borderRadius: 10,
                border: 'none',
                background: active ? 'linear-gradient(135deg, #3b82f6, #2563eb)' : 'transparent',
                color: active ? '#ffffff' : palette.textMuted,
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: active ? '0 4px 14px rgba(37, 99, 235, 0.35)' : 'none',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 1-Tap Auto UPI Payment Capture Prompt when Notification Access is off */}
      {!notifGranted && typeof window !== 'undefined' && window.PattanBiometric && (
        <div style={{
          padding: '12px 14px',
          borderRadius: 14,
          background: isLight ? 'rgba(16, 185, 129, 0.1)' : 'rgba(16, 185, 129, 0.14)',
          border: '1px solid rgba(16, 185, 129, 0.4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          fontSize: 12,
          fontWeight: 800,
          color: isLight ? '#065f46' : '#a7f3d0',
        }}>
          <div>
            🔔 <strong>Android 13–16 Restricted Setting Fix:</strong> If Android says <em>&ldquo;Controlled by Restricted Setting&rdquo;</em>, tap <strong>Step 1 (Open App Info)</strong> → tap <strong>⋮ (top-right)</strong> → tap <strong>Allow restricted settings</strong>, then tap <strong>Step 2 (Enable Notification Access)</strong>. Once enabled, all ₹100 payments &amp; ₹100 deposits appear automatically with zero manual fetching!
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => {
                if (window.PattanBiometric && typeof window.PattanBiometric.openAppDetailsSettings === 'function') {
                  window.PattanBiometric.openAppDetailsSettings();
                }
              }}
              style={{
                padding: '8px 12px',
                borderRadius: 9,
                border: '1px solid rgba(250, 204, 21, 0.55)',
                background: 'rgba(250, 204, 21, 0.18)',
                color: isLight ? '#854d0e' : '#fef08a',
                fontWeight: 900,
                fontSize: 11.5,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              🔓 Step 1: Unlock Restricted Setting (App Info)
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.PattanBiometric && typeof window.PattanBiometric.openNotificationListenerSettings === 'function') {
                  window.PattanBiometric.openNotificationListenerSettings();
                }
              }}
              style={{
                padding: '8px 12px',
                borderRadius: 9,
                border: 'none',
                background: '#10b981',
                color: '#052e16',
                fontWeight: 900,
                fontSize: 11.5,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              🔔 Step 2: Enable Auto UPI Capture
            </button>
          </div>
        </div>
      )}

      {/* Status / Undo Toast Banner */}
      {(scanStatus || undoBanner) && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 14,
          background: isLight ? '#eff6ff' : 'rgba(37, 99, 235, 0.15)',
          border: '1px solid rgba(59, 130, 246, 0.35)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          fontSize: 12,
          fontWeight: 700,
          color: isLight ? '#1e40af' : '#bfdbfe',
        }}>
          <span>{undoBanner ? undoBanner.message : scanStatus}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {undoBanner && (
              <button
                type="button"
                onClick={() => {
                  if (undoBanner.snapshot && typeof onUpdateExpenses === 'function') {
                    onUpdateExpenses(undoBanner.snapshot, '↩️ Restored transaction');
                  }
                  setUndoBanner(null);
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Undo
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setScanStatus('');
                setUndoBanner(null);
              }}
              style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 900 }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          🏦 REAL BANK ACCOUNT BALANCE & LIVE PASSBOOK CARD (OVERVIEW & TRANSACTIONS)
         ═══════════════════════════════════════════════════════════════════════ */}
      {(subTab === 'overview' || subTab === 'transactions') && (
        <div style={{
          padding: mobileMode ? '16px 14px' : '18px 20px',
          borderRadius: 22,
          background: isLight
            ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)'
            : 'linear-gradient(135deg, #0f172a 0%, #172554 55%, #064e3b 100%)',
          border: '1px solid rgba(52, 211, 153, 0.38)',
          boxShadow: '0 14px 34px rgba(2, 6, 23, 0.45)',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#34d399',
                  background: 'rgba(16, 185, 129, 0.16)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  padding: '3px 9px',
                  borderRadius: 999,
                }}>
                  🏦 Real Bank Account Balance
                </span>
                {(bankBalanceInfo?.accountMask || analytics.bankBalanceSource) && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#93c5fd' }}>
                    {bankBalanceInfo?.bankName || 'Bank A/c'} {bankBalanceInfo?.accountMask ? `(${bankBalanceInfo.accountMask})` : ''}
                  </span>
                )}
              </div>
              <div style={{
                fontSize: mobileMode ? 30 : 34,
                fontWeight: 950,
                color: '#ffffff',
                letterSpacing: '-0.02em',
                marginTop: 6,
                lineHeight: 1.1,
              }}>
                ₹{formatINR(analytics.realAccountBalance)}
              </div>
              <div style={{ fontSize: 11.5, color: '#cbd5e1', fontWeight: 700, marginTop: 4 }}>
                Auto-adjusts on every payment (<strong>-₹</strong>) &amp; deposit (<strong>+₹</strong>) · Permanent Bank Statement
              </div>
            </div>

            <button
              type="button"
              onClick={openCheckBalanceModal}
              style={{
                padding: '10px 14px',
                borderRadius: 13,
                border: '1px solid rgba(52, 211, 153, 0.6)',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#022c22',
                fontWeight: 950,
                fontSize: 12.5,
                cursor: 'pointer',
                boxShadow: '0 8px 20px rgba(16, 185, 129, 0.32)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              🏦 Check Balance
            </button>
          </div>

          {/* 3-Column Bank Statement Breakdown: Total Deposited (+₹) | Total Spent (-₹) | Remaining Balance (₹) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 8,
          }}>
            <div style={{
              padding: '9px 10px',
              borderRadius: 12,
              background: 'rgba(16, 185, 129, 0.14)',
              border: '1px solid rgba(16, 185, 129, 0.32)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#a7f3d0', textTransform: 'uppercase' }}>
                💰 Deposited / In
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 950, color: '#34d399', marginTop: 2 }}>
                +₹{formatINR(analytics.allTimeReceived)}
              </div>
              <div style={{ fontSize: 9.5, color: '#cbd5e1', marginTop: 1 }}>
                Today: +₹{formatINRShort(analytics.todayReceived)}
              </div>
            </div>

            <div style={{
              padding: '9px 10px',
              borderRadius: 12,
              background: 'rgba(244, 63, 94, 0.14)',
              border: '1px solid rgba(244, 63, 94, 0.32)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#fecdd3', textTransform: 'uppercase' }}>
                💸 Spent / Out
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 950, color: '#fb7185', marginTop: 2 }}>
                -₹{formatINR(analytics.allTimeSpent)}
              </div>
              <div style={{ fontSize: 9.5, color: '#cbd5e1', marginTop: 1 }}>
                Today: -₹{formatINRShort(analytics.todaySpent)}
              </div>
            </div>

            <div style={{
              padding: '9px 10px',
              borderRadius: 12,
              background: 'rgba(59, 130, 246, 0.16)',
              border: '1px solid rgba(96, 165, 250, 0.35)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#bfdbfe', textTransform: 'uppercase' }}>
                🏦 Remaining Bal
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 950, color: '#60a5fa', marginTop: 2 }}>
                ₹{formatINR(analytics.realAccountBalance)}
              </div>
              <div style={{ fontSize: 9.5, color: '#cbd5e1', marginTop: 1 }}>
                {analytics.allTimeCount || analytics.totalCount} Statement Txns
              </div>
            </div>
          </div>

          {/* 1-Tap Passbook Action Row: + Payment (-₹) | + Deposit (+₹) | Check / Sync Balance */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            <button
              type="button"
              onClick={() => openQuickAddModal(null, 'debit')}
              style={{
                padding: '9px 8px',
                borderRadius: 11,
                border: '1px solid rgba(244, 63, 94, 0.45)',
                background: 'rgba(244, 63, 94, 0.18)',
                color: '#fda4af',
                fontWeight: 900,
                fontSize: 11.5,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              💸 + Payment (-₹)
            </button>
            <button
              type="button"
              onClick={() => openQuickAddModal(null, 'credit')}
              style={{
                padding: '9px 8px',
                borderRadius: 11,
                border: '1px solid rgba(16, 185, 129, 0.45)',
                background: 'rgba(16, 185, 129, 0.18)',
                color: '#6ee7b7',
                fontWeight: 900,
                fontSize: 11.5,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              💰 + Deposit (+₹)
            </button>
            <button
              type="button"
              onClick={openCheckBalanceModal}
              style={{
                padding: '9px 8px',
                borderRadius: 11,
                border: '1px solid rgba(96, 165, 250, 0.45)',
                background: 'rgba(37, 99, 235, 0.24)',
                color: '#93c5fd',
                fontWeight: 900,
                fontSize: 11.5,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              🔄 Sync Real Bal
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SCREEN 7: EXPENSE OVERVIEW (AUTO DETECT)
         ═══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'overview' && (
        <>
          {/* Vibrant Pink-to-Purple-to-Blue Hero Total Spent Card (Screen 7) */}
          <div style={{
            padding: mobileMode ? '20px 18px' : '24px 24px',
            borderRadius: 24,
            background: 'linear-gradient(135deg, #f43f5e 0%, #d946ef 48%, #6366f1 100%)',
            boxShadow: '0 18px 40px rgba(217, 70, 239, 0.32)',
            color: '#ffffff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 14,
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{ zIndex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.9)' }}>
                Total Spent (This Month)
              </div>
              <div style={{
                fontSize: mobileMode ? 34 : 40,
                fontWeight: 950,
                letterSpacing: '-0.03em',
                marginTop: 6,
                lineHeight: 1.05,
              }}>
                ₹{formatINR(analytics.netSpending)}
              </div>
              <div style={{
                fontSize: 12.5,
                fontWeight: 800,
                color: 'rgba(255,255,255,0.9)',
                marginTop: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}>
                <span>{analytics.totalCount} Transactions</span>
                <span>·</span>
                <span>In: +₹{formatINRShort(analytics.totalIncome)}</span>
                <span>·</span>
                <span>Bal: ₹{formatINRShort(analytics.realAccountBalance)}</span>
                <span>·</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span>Salary Left: {salaryVisible ? `₹${formatINRShort(remainingSalary)}` : '₹••••••'}</span>
                  {typeof onToggleSalaryVisibility === 'function' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSalaryVisibility();
                      }}
                      title={salaryVisible ? 'Hide Salary' : 'Unlock with Biometric to Show Salary'}
                      style={{
                        padding: '2px 7px',
                        borderRadius: 999,
                        border: '1px solid rgba(255,255,255,0.45)',
                        background: 'rgba(15, 23, 42, 0.32)',
                        color: '#ffffff',
                        fontSize: 11,
                        fontWeight: 900,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                      }}
                    >
                      <span>{salaryVisible ? '🙈' : '👁️'}</span>
                    </button>
                  )}
                </span>
              </div>
            </div>

            {/* Right Rising Bar Chart & Arrow Graphic matching Screen 7 */}
            <div style={{ zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              <svg width="96" height="58" viewBox="0 0 96 58" fill="none">
                <path d="M8 42 L32 28 L54 32 L84 10" stroke="rgba(255,255,255,0.85)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M75 9 L85 9 L84 19" stroke="rgba(255,255,255,0.85)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                <rect x="8" y="44" width="10" height="12" rx="3" fill="rgba(255,255,255,0.45)" />
                <rect x="24" y="36" width="10" height="20" rx="3" fill="rgba(255,255,255,0.55)" />
                <rect x="40" y="30" width="10" height="26" rx="3" fill="rgba(255,255,255,0.65)" />
                <rect x="56" y="22" width="10" height="34" rx="3" fill="rgba(255,255,255,0.78)" />
                <rect x="72" y="14" width="10" height="42" rx="3" fill="#ffffff" />
              </svg>
            </div>
          </div>

          {/* 4 Category Mini-Cards Row (Responsive 2x2 on mobile, 4x1 on desktop — Screen 7) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: mobileMode ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
            gap: 8,
          }}>
            {screen7CategoryCards.map((cat) => (
              <button
                key={cat.label}
                type="button"
                onClick={() => {
                  setFilterCategory(cat.id);
                  setSubTab('transactions');
                }}
                style={{
                  padding: '12px 10px',
                  borderRadius: 16,
                  background: palette.surface,
                  border: `1px solid ${palette.border}`,
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>{cat.label}</div>
                <div style={{ fontSize: 14, fontWeight: 950, color: palette.text }}>
                  ₹{formatINRShort(cat.amount)}
                </div>
                <div style={{
                  height: 4,
                  width: '100%',
                  borderRadius: 999,
                  background: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.16)',
                  overflow: 'hidden',
                  marginTop: 3,
                }}>
                  <div style={{
                    height: '100%',
                    width: `${analytics.grossExpenses > 0 ? Math.min(100, Math.max(18, (cat.amount / analytics.grossExpenses) * 100)) : 35}%`,
                    background: cat.color,
                    borderRadius: 999,
                  }} />
                </div>
              </button>
            ))}
          </div>

          {/* 4 Quick Stat Cards: Spent Today | Received Today | Month Txns | Missing Notes */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: mobileMode ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
            gap: 8,
          }}>
            <div style={{
              padding: '10px 12px',
              borderRadius: 14,
              background: palette.surface,
              border: `1px solid ${palette.border}`,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: palette.textMuted }}>Spent Today</div>
              <div style={{ fontSize: 14, fontWeight: 950, color: '#f43f5e', marginTop: 3 }}>
                ₹{formatINRShort(analytics.todaySpent)}
              </div>
              <div style={{ fontSize: 10, color: palette.textMuted, marginTop: 1 }}>
                {analytics.todayCount} txn{analytics.todayCount === 1 ? '' : 's'}
              </div>
            </div>

            <div style={{
              padding: '10px 12px',
              borderRadius: 14,
              background: palette.surface,
              border: `1px solid ${palette.border}`,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: palette.textMuted }}>Deposited Today</div>
              <div style={{ fontSize: 14, fontWeight: 950, color: '#10b981', marginTop: 3 }}>
                +₹{formatINRShort(analytics.todayReceived)}
              </div>
              <div style={{ fontSize: 10, color: palette.textMuted, marginTop: 1 }}>
                Month In: +₹{formatINRShort(analytics.totalIncome)}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSubTab('transactions')}
              style={{
                padding: '10px 12px',
                borderRadius: 14,
                background: palette.surface,
                border: `1px solid ${palette.border}`,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 10.5, fontWeight: 700, color: palette.textMuted }}>Statement Ledger</div>
              <div style={{ fontSize: 14, fontWeight: 950, color: palette.text, marginTop: 3 }}>
                {recentPaymentsList.length} Txns
              </div>
              <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 700, marginTop: 1 }}>
                View statement ›
              </div>
            </button>

            <button
              type="button"
              onClick={() => setSubTab('missing-notes')}
              style={{
                padding: '10px 12px',
                borderRadius: 14,
                background: analytics.missingNotesCount > 0 ? 'rgba(245, 158, 11, 0.12)' : palette.surface,
                border: analytics.missingNotesCount > 0 ? '1px solid rgba(245, 158, 11, 0.45)' : `1px solid ${palette.border}`,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 10.5, fontWeight: 700, color: analytics.missingNotesCount > 0 ? '#fbbf24' : palette.textMuted }}>
                Missing Notes
              </div>
              <div style={{ fontSize: 14, fontWeight: 950, color: analytics.missingNotesCount > 0 ? '#f59e0b' : '#10b981', marginTop: 3 }}>
                {analytics.missingNotesCount} Pending
              </div>
              <div style={{ fontSize: 10, color: palette.textMuted, marginTop: 1 }}>
                {analytics.missingNotesCount > 0 ? 'Add memory ›' : 'All noted ✓'}
              </div>
            </button>
          </div>

          {/* Fast Action Bar: + Add Spend, + Add Deposit, Check Balance, Paste Alert */}
          <div style={{ display: 'grid', gridTemplateColumns: mobileMode ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
            <button
              type="button"
              onClick={() => openQuickAddModal(null, 'debit')}
              style={{
                padding: '11px 10px',
                borderRadius: 14,
                border: 'none',
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                color: '#ffffff',
                fontWeight: 900,
                fontSize: 12,
                cursor: 'pointer',
                boxShadow: '0 8px 20px rgba(37, 99, 235, 0.3)',
              }}
            >
              ➕ Add Payment
            </button>
            <button
              type="button"
              onClick={() => openQuickAddModal(null, 'credit')}
              style={{
                padding: '11px 10px',
                borderRadius: 14,
                border: '1px solid rgba(16, 185, 129, 0.45)',
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#ffffff',
                fontWeight: 900,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              💰 Add Deposit
            </button>
            <button
              type="button"
              onClick={openCheckBalanceModal}
              style={{
                padding: '11px 10px',
                borderRadius: 14,
                border: `1px solid ${palette.border}`,
                background: palette.surface,
                color: palette.text,
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              🏦 Check Balance
            </button>
            <button
              type="button"
              onClick={() => setShowSmsPasteModal(true)}
              style={{
                padding: '11px 10px',
                borderRadius: 14,
                border: `1px solid ${palette.border}`,
                background: palette.surface,
                color: palette.text,
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              📋 Paste SMS/UPI
            </button>
          </div>

          {/* 🧠 Ask Expense Memory (Natural-Language Q&A with Smart Question Chips) */}
          <div style={{
            padding: '14px 16px',
            borderRadius: 20,
            background: palette.surface,
            border: `1px solid ${palette.border}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#60a5fa' }}>
                🧠 Ask Expense Memory
              </div>
              {nlResponse && (
                <button
                  type="button"
                  onClick={() => {
                    setNlResponse(null);
                    setNlQuery('');
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: palette.textMuted,
                    fontSize: 11.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Clear ✕
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={nlQuery}
                onChange={(e) => setNlQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAskQuestion(nlQuery);
                }}
                placeholder="Ask e.g. How much did I spend on food?"
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 12.5,
                  fontWeight: 700,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => handleAskQuestion(nlQuery)}
                style={{
                  padding: '9px 15px',
                  borderRadius: 12,
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Ask
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingTop: 9, paddingBottom: 2 }}>
              {SMART_QA_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => handleAskQuestion(chip)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 999,
                    border: `1px solid ${palette.border}`,
                    background: nlQuery === chip ? 'rgba(37, 99, 235, 0.2)' : palette.surfaceAlt,
                    color: nlQuery === chip ? '#60a5fa' : palette.textSub,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
            {nlResponse && (
              <div style={{
                marginTop: 10,
                padding: '10px 12px',
                borderRadius: 12,
                background: isLight ? '#eff6ff' : 'rgba(37, 99, 235, 0.14)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                fontSize: 12.5,
                fontWeight: 800,
                color: palette.text,
                lineHeight: 1.5,
              }}>
                <div>💡 {nlResponse.answer}</div>
                {Array.isArray(nlResponse.matches) && nlResponse.matches.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                    {nlResponse.matches.slice(0, 4).map((m) => (
                      <div
                        key={m.id}
                        onClick={() => setSelectedTxId(m.id)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 9,
                          background: palette.surface,
                          border: `1px solid ${palette.border}`,
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}
                      >
                        <span>
                          <strong>{m.merchant || m.app}</strong>
                          {m.personalNote || m.note ? ` · 📝 ${m.personalNote || m.note}` : ''}
                        </span>
                        <span style={{ fontWeight: 900, color: m.type === 'credit' ? palette.credit : '#f43f5e' }}>
                          ₹{formatINRShort(m.amount)} ›
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Review-Needed Section for Ambiguous / Pending / Possible-Duplicate Notices */}
          {analytics.uncertainOrDuplicatesList && analytics.uncertainOrDuplicatesList.length > 0 && (
            <div style={{
              background: isLight ? '#fffbeb' : 'rgba(245, 158, 11, 0.12)',
              borderRadius: 18,
              border: '1px solid rgba(245, 158, 11, 0.4)',
              padding: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: isLight ? '#92400e' : '#fcd34d' }}>
                ⚠️ Review Needed ({analytics.uncertainOrDuplicatesList.length}) — Not counted until confirmed
              </div>
              {analytics.uncertainOrDuplicatesList.slice(0, 4).map((tx) => (
                <div
                  key={tx.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    background: palette.surface,
                    border: `1px solid ${palette.border}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: palette.text }}>
                      ₹{formatINRShort(tx.amount)} · {tx.merchant || tx.app}
                    </div>
                    <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}>
                      {tx.reconciliationStatus === 'possible_duplicate'
                        ? 'Possible overlapping UPI/bank notification'
                        : `Status: ${tx.status || 'Needs review'}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => handleConfirmReviewItem(tx.id)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: 'none',
                        background: '#10b981',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Confirm
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent Payments (Auto Detected & Permanent Ledger) List (Screen 7) */}
          <div style={{
            background: palette.surface,
            borderRadius: 22,
            border: `1px solid ${palette.border}`,
            padding: mobileMode ? '14px 12px' : '16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 900, color: palette.text }}>
                  Recent Payments (Permanent Ledger)
                </div>
                <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                  🔒 Never deleted · Shows Name, Time, Purpose/Thing &amp; Amount
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSubTab('transactions')}
                style={{
                  background: 'rgba(59, 130, 246, 0.14)',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  borderRadius: 999,
                  padding: '5px 12px',
                  color: '#60a5fa',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                See All ({recentPaymentsList.length}) ›
              </button>
            </div>

            {recentPaymentsList.length === 0 ? (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: palette.textMuted, fontSize: 13 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>💳</div>
                <div style={{ fontWeight: 800, color: palette.text }}>No payments recorded yet.</div>
                <div style={{ marginTop: 4 }}>
                  Pay with any UPI app (GPay, PhonePe, Paytm, BHIM, Super.money, CRED, Bank) or tap <strong>➕ Add Entry</strong> and your completed payment, time, purpose/thing &amp; amount will stay saved forever.
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => openQuickAddModal(null)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: 'none',
                      background: '#2563eb',
                      color: '#ffffff',
                      fontWeight: 800,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    ➕ Add Payment Now
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerMobileTransactionScan()}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: `1px solid ${palette.border}`,
                      background: palette.surfaceAlt,
                      color: '#60a5fa',
                      fontWeight: 800,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    📲 Sync UPI &amp; Bank Alerts
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recentPaymentsList.slice(0, 12).map((tx) => {
                  const isCredit = tx.type === 'credit' || tx.type === 'refund';
                  const noteText = String(tx.personalNote || tx.note || tx.paymentRemark || '').trim();
                  const hasNote = Boolean(noteText);
                  const inlineDraft = inlineNoteDrafts[tx.id] ?? noteText;
                  const isEditingInline = Object.prototype.hasOwnProperty.call(inlineNoteDrafts, tx.id);
                  const txBal = Number.isFinite(Number(tx.runningBalance))
                    ? Number(tx.runningBalance)
                    : (tx.accountBalance !== null && tx.accountBalance !== undefined && Number.isFinite(Number(tx.accountBalance))
                      ? Number(tx.accountBalance)
                      : null);
                  return (
                    <div
                      key={tx.id}
                      style={{
                        padding: mobileMode ? '12px' : '14px',
                        borderRadius: 16,
                        background: palette.surfaceAlt,
                        border: isCredit ? '1px solid rgba(16, 185, 129, 0.32)' : `1px solid ${palette.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 9,
                      }}
                    >
                      {/* Top Row: Avatar + Name + Time + Amount + Running Balance */}
                      <div
                        onClick={() => setSelectedTxId(tx.id)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: 10,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, flex: 1 }}>
                          <BrandPaymentAvatar tx={tx} size={40} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{
                                fontSize: 14,
                                fontWeight: 900,
                                color: palette.text,
                                wordBreak: 'break-word',
                                lineHeight: 1.25,
                              }}>
                                {tx.merchant || tx.app || (isCredit ? 'Bank Deposit' : 'UPI Payment')}
                              </span>
                              <span style={{
                                padding: '2px 7px',
                                borderRadius: 999,
                                fontSize: 9.5,
                                fontWeight: 900,
                                background: isCredit ? 'rgba(16, 185, 129, 0.16)' : 'rgba(244, 63, 94, 0.14)',
                                border: isCredit ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(244, 63, 94, 0.35)',
                                color: isCredit ? '#34d399' : '#fb7185',
                              }}>
                                {isCredit ? '💰 DEPOSIT / IN' : '💸 PAID / OUT'}
                              </span>
                            </div>
                            <div style={{
                              fontSize: 11.5,
                              color: palette.textMuted,
                              fontWeight: 700,
                              marginTop: 4,
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 6,
                              alignItems: 'center',
                            }}>
                              <span>🕒 {tx.date === todayIso ? `Today, ${formatTime12h(tx.time)}` : `${formatShortDate(tx.date)}, ${formatTime12h(tx.time)}`}</span>
                              <span>·</span>
                              <span style={{ color: '#60a5fa', fontWeight: 800 }}>{tx.app || tx.paymentMethod || 'UPI'}</span>
                              {tx.accountMask && (
                                <>
                                  <span>·</span>
                                  <span>A/c {tx.accountMask}</span>
                                </>
                              )}
                              {tx.refId && (
                                <>
                                  <span>·</span>
                                  <span>Ref: {String(tx.refId).slice(-8)}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 15.5, fontWeight: 950, color: isCredit ? palette.credit : '#f43f5e' }}>
                            {isCredit ? `+ ₹${formatINR(tx.amount)}` : `- ₹${formatINR(tx.amount)}`}
                          </div>
                          {txBal !== null && (
                            <div style={{
                              fontSize: 10.5,
                              fontWeight: 900,
                              color: '#34d399',
                              marginTop: 2,
                              background: 'rgba(16, 185, 129, 0.12)',
                              padding: '2px 6px',
                              borderRadius: 6,
                              display: 'inline-block',
                            }}>
                              🏦 Bal: ₹{formatINR(txBal)}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                            🔒 {tx.category || 'Payment'} ›
                          </div>
                        </div>
                      </div>

                      {/* Prominent Purpose / Which Thing Badge */}
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 11,
                          background: hasNote
                            ? (isLight ? 'rgba(37, 99, 235, 0.08)' : 'rgba(37, 99, 235, 0.16)')
                            : (isLight ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.12)'),
                          border: hasNote
                            ? '1px solid rgba(59, 130, 246, 0.35)'
                            : '1px dashed rgba(245, 158, 11, 0.45)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: hasNote ? palette.text : '#fbbf24', wordBreak: 'break-word' }}>
                            📌 <strong>For What / Which Thing:</strong>{' '}
                            {hasNote ? noteText : 'Not noted yet — write what you bought/paid for below'}
                          </div>
                          {hasNote && !isEditingInline && (
                            <button
                              type="button"
                              onClick={() => setInlineNoteDrafts((prev) => ({ ...prev, [tx.id]: noteText }))}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 7,
                                border: `1px solid ${palette.border}`,
                                background: palette.surface,
                                color: '#60a5fa',
                                fontSize: 10.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              ✏️ Edit Note
                            </button>
                          )}
                        </div>

                        {(!hasNote || isEditingInline) && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              type="text"
                              value={inlineDraft}
                              onChange={(e) => setInlineNoteDrafts((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && inlineDraft.trim()) {
                                  handleUpdatePersonalNote(tx.id, inlineDraft);
                                }
                              }}
                              placeholder="Type purpose / which thing (e.g. Tea, Petrol, Lunch, Grocery)..."
                              style={{
                                flex: '1 1 180px',
                                padding: '7px 10px',
                                borderRadius: 9,
                                border: `1px solid ${palette.border}`,
                                background: palette.surface,
                                color: palette.text,
                                fontSize: 12,
                                fontWeight: 700,
                                outline: 'none',
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleUpdatePersonalNote(tx.id, inlineDraft || 'Noted')}
                              style={{
                                padding: '7px 12px',
                                borderRadius: 9,
                                border: 'none',
                                background: '#2563eb',
                                color: '#fff',
                                fontWeight: 800,
                                fontSize: 11.5,
                                cursor: 'pointer',
                              }}
                            >
                              Save Note
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SCREEN 8: TRANSACTIONS (AUTO SAVED)
         ═══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'transactions' && (
        <div style={{
          background: palette.surface,
          borderRadius: 22,
          border: `1px solid ${palette.border}`,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={() => setSubTab('overview')}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                ←
              </button>
              <span style={{ fontSize: 17, fontWeight: 950, color: palette.text }}>
                Transactions ({filteredTransactions.length})
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                onClick={() => setShowAdvancedFilters((prev) => !prev)}
                style={{
                  padding: '7px 11px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: showAdvancedFilters ? 'rgba(37, 99, 235, 0.2)' : palette.surfaceAlt,
                  color: showAdvancedFilters ? '#60a5fa' : palette.textSub,
                  fontWeight: 800,
                  fontSize: 11.5,
                  cursor: 'pointer',
                }}
              >
                ⚙️ Filters
              </button>
              <button
                type="button"
                onClick={() => openQuickAddModal(null)}
                style={{
                  padding: '7px 12px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                + Add
              </button>
            </div>
          </div>

          {/* Search Bar (Screen 8) */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="🔍 Search transactions, notes, merchants, ref ID..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '11px 14px',
              borderRadius: 14,
              border: `1px solid ${palette.border}`,
              background: palette.surfaceAlt,
              color: palette.text,
              fontSize: 13,
              fontWeight: 700,
              outline: 'none',
            }}
          />

          {/* Filter Pills: All | Money Out | Money In | UPI | Bank | Card | Wallet (Screen 8) */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {['All', 'Money Out', 'Money In', 'UPI', 'Bank', 'Card', 'Wallet'].map((pill) => {
              const active = methodPillFilter === pill;
              return (
                <button
                  key={pill}
                  type="button"
                  onClick={() => setMethodPillFilter(pill)}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 999,
                    border: active ? 'none' : `1px solid ${palette.border}`,
                    background: active ? '#2563eb' : palette.surfaceAlt,
                    color: active ? '#ffffff' : palette.textSub,
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {pill}
                </button>
              );
            })}
          </div>

          {/* Collapsible Advanced Filters Panel */}
          {showAdvancedFilters && (
            <div style={{
              padding: '12px',
              borderRadius: 14,
              background: palette.surfaceAlt,
              border: `1px solid ${palette.border}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>Category</label>
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    style={{
                      width: '100%',
                      marginTop: 3,
                      padding: '8px',
                      borderRadius: 10,
                      border: `1px solid ${palette.border}`,
                      background: palette.surface,
                      color: palette.text,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    <option value="all">All Categories</option>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon} {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>Memory Note Status</label>
                  <select
                    value={filterNoteStatus}
                    onChange={(e) => setFilterNoteStatus(e.target.value)}
                    style={{
                      width: '100%',
                      marginTop: 3,
                      padding: '8px',
                      borderRadius: 10,
                      border: `1px solid ${palette.border}`,
                      background: palette.surface,
                      color: palette.text,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    <option value="all">All Notes</option>
                    <option value="has_note">Has Personal Note</option>
                    <option value="missing_note">Missing Note</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>Min Amount (₹)</label>
                  <input
                    type="number"
                    value={filterMinAmount}
                    onChange={(e) => setFilterMinAmount(e.target.value)}
                    placeholder="0"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: 3,
                      padding: '8px',
                      borderRadius: 10,
                      border: `1px solid ${palette.border}`,
                      background: palette.surface,
                      color: palette.text,
                      fontSize: 12,
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>Max Amount (₹)</label>
                  <input
                    type="number"
                    value={filterMaxAmount}
                    onChange={(e) => setFilterMaxAmount(e.target.value)}
                    placeholder="Any"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: 3,
                      padding: '8px',
                      borderRadius: 10,
                      border: `1px solid ${palette.border}`,
                      background: palette.surface,
                      color: palette.text,
                      fontSize: 12,
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>From Date</label>
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => setFilterDateFrom(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: 3,
                      padding: '7px 8px',
                      borderRadius: 10,
                      border: `1px solid ${palette.border}`,
                      background: palette.surface,
                      color: palette.text,
                      fontSize: 11.5,
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>To Date</label>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => setFilterDateTo(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: 3,
                      padding: '7px 8px',
                      borderRadius: 10,
                      border: `1px solid ${palette.border}`,
                      background: palette.surface,
                      color: palette.text,
                      fontSize: 11.5,
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700 }}>
                  Showing {filteredTransactions.length} of {analytics.totalCount} transactions
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFilterCategory('all');
                    setMethodPillFilter('All');
                    setFilterNoteStatus('all');
                    setFilterReviewStatus('all');
                    setFilterMinAmount('');
                    setFilterMaxAmount('');
                    setFilterDateFrom('');
                    setFilterDateTo('');
                    setSearchQuery('');
                  }}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 8,
                    border: `1px solid ${palette.border}`,
                    background: palette.surface,
                    color: '#60a5fa',
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Reset Filters
                </button>
              </div>
            </div>
          )}

          {/* Grouped Transactions List (Screen 8) */}
          {groupedByDay.length === 0 ? (
            <div style={{ padding: '26px 12px', textAlign: 'center', color: palette.textMuted, fontSize: 13 }}>
              Nothing matched your search. Try a different keyword or filter.
            </div>
          ) : (
            groupedByDay.map((group) => (
              <div key={group.date} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 12,
                  fontWeight: 800,
                  color: palette.textMuted,
                  marginTop: 4,
                }}>
                  <span>{group.label}</span>
                  <span>
                    {group.daySpent > 0 ? `-₹${formatINRShort(group.daySpent)}` : ''}
                    {group.daySpent > 0 && group.dayReceived > 0 ? ' · ' : ''}
                    {group.dayReceived > 0 ? `+₹${formatINRShort(group.dayReceived)}` : ''}
                  </span>
                </div>
                {group.items.map((tx) => {
                  const isCredit = tx.type === 'credit' || tx.type === 'refund';
                  const noteText = String(tx.personalNote || tx.note || tx.paymentRemark || '').trim();
                  const hasNote = Boolean(noteText);
                  const inlineDraft = inlineNoteDrafts[tx.id] ?? noteText;
                  const isEditingInline = Object.prototype.hasOwnProperty.call(inlineNoteDrafts, tx.id);
                  const txBal = Number.isFinite(Number(tx.runningBalance))
                    ? Number(tx.runningBalance)
                    : (tx.accountBalance !== null && tx.accountBalance !== undefined && Number.isFinite(Number(tx.accountBalance))
                      ? Number(tx.accountBalance)
                      : null);
                  return (
                    <div
                      key={tx.id}
                      style={{
                        padding: mobileMode ? '12px' : '14px',
                        borderRadius: 16,
                        background: palette.surfaceAlt,
                        border: isCredit ? '1px solid rgba(16, 185, 129, 0.32)' : `1px solid ${palette.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div
                        onClick={() => setSelectedTxId(tx.id)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: 10,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0, flex: 1 }}>
                          <BrandPaymentAvatar tx={tx} size={40} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 14, fontWeight: 900, color: palette.text, wordBreak: 'break-word' }}>
                                {tx.merchant || tx.app || (isCredit ? 'Bank Deposit' : 'Payment')}
                              </span>
                              <span style={{
                                padding: '2px 7px',
                                borderRadius: 999,
                                fontSize: 9.5,
                                fontWeight: 900,
                                background: isCredit ? 'rgba(16, 185, 129, 0.16)' : 'rgba(244, 63, 94, 0.14)',
                                border: isCredit ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(244, 63, 94, 0.35)',
                                color: isCredit ? '#34d399' : '#fb7185',
                              }}>
                                {isCredit ? '💰 DEPOSIT / IN' : '💸 PAID / OUT'}
                              </span>
                            </div>
                            <div style={{
                              fontSize: 11.5,
                              color: palette.textMuted,
                              fontWeight: 700,
                              marginTop: 3,
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 6,
                              alignItems: 'center',
                            }}>
                              <span>🕒 {formatTime12h(tx.time)}</span>
                              <span>·</span>
                              <span style={{ color: '#60a5fa', fontWeight: 800 }}>{tx.app || tx.paymentMethod || 'UPI'}</span>
                              {tx.accountMask && (
                                <>
                                  <span>·</span>
                                  <span>A/c {tx.accountMask}</span>
                                </>
                              )}
                              {tx.refId && (
                                <>
                                  <span>·</span>
                                  <span>Ref: {String(tx.refId).slice(-8)}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 950, color: isCredit ? palette.credit : '#f43f5e' }}>
                            {isCredit ? `+ ₹${formatINR(tx.amount)}` : `- ₹${formatINR(tx.amount)}`}
                          </div>
                          {txBal !== null && (
                            <div style={{
                              fontSize: 10.5,
                              fontWeight: 900,
                              color: '#34d399',
                              marginTop: 2,
                              background: 'rgba(16, 185, 129, 0.12)',
                              padding: '2px 6px',
                              borderRadius: 6,
                              display: 'inline-block',
                            }}>
                              🏦 Bal: ₹{formatINR(txBal)}
                            </div>
                          )}
                          <div style={{ fontSize: 10, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                            🔒 {tx.category || 'Payment'} ›
                          </div>
                        </div>
                      </div>

                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          padding: '7px 10px',
                          borderRadius: 10,
                          background: hasNote
                            ? (isLight ? 'rgba(37, 99, 235, 0.08)' : 'rgba(37, 99, 235, 0.16)')
                            : (isLight ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.12)'),
                          border: hasNote
                            ? '1px solid rgba(59, 130, 246, 0.35)'
                            : '1px dashed rgba(245, 158, 11, 0.45)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: hasNote ? palette.text : '#fbbf24', wordBreak: 'break-word' }}>
                            📌 <strong>For What / Which Thing:</strong>{' '}
                            {hasNote ? noteText : 'Not noted yet — write what you bought/paid for'}
                          </div>
                          {hasNote && !isEditingInline && (
                            <button
                              type="button"
                              onClick={() => setInlineNoteDrafts((prev) => ({ ...prev, [tx.id]: noteText }))}
                              style={{
                                padding: '3px 8px',
                                borderRadius: 7,
                                border: `1px solid ${palette.border}`,
                                background: palette.surface,
                                color: '#60a5fa',
                                fontSize: 10.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              ✏️ Edit Note
                            </button>
                          )}
                        </div>
                        {(!hasNote || isEditingInline) && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              type="text"
                              value={inlineDraft}
                              onChange={(e) => setInlineNoteDrafts((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && inlineDraft.trim()) {
                                  handleUpdatePersonalNote(tx.id, inlineDraft);
                                }
                              }}
                              placeholder="Type purpose / which thing (e.g. Tea, Petrol, Lunch)..."
                              style={{
                                flex: '1 1 180px',
                                padding: '6px 10px',
                                borderRadius: 8,
                                border: `1px solid ${palette.border}`,
                                background: palette.surface,
                                color: palette.text,
                                fontSize: 11.5,
                                fontWeight: 700,
                                outline: 'none',
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleUpdatePersonalNote(tx.id, inlineDraft || 'Noted')}
                              style={{
                                padding: '6px 12px',
                                borderRadius: 8,
                                border: 'none',
                                background: '#2563eb',
                                color: '#fff',
                                fontWeight: 800,
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                            >
                              Save Note
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SCREEN 10: EXPENSE INSIGHTS (OVERVIEW | CATEGORIES | METHODS | TRENDS)
         ═══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'insights' && (
        <div style={{
          background: palette.surface,
          borderRadius: 22,
          border: `1px solid ${palette.border}`,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                onClick={() => setSubTab('overview')}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                ←
              </button>
              <span style={{ fontSize: 17, fontWeight: 950, color: palette.text }}>Insights</span>
            </div>
            <span style={{
              padding: '6px 12px',
              borderRadius: 10,
              background: palette.surfaceAlt,
              border: `1px solid ${palette.border}`,
              fontSize: 12,
              fontWeight: 800,
              color: palette.textSub,
            }}>
              {selectedMonth} ▾
            </span>
          </div>

          {/* Segmented Sub-Tabs: Overview | Categories | Methods | Trends (Screen 10) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 6,
            padding: 4,
            borderRadius: 12,
            background: palette.surfaceAlt,
            border: `1px solid ${palette.border}`,
          }}>
            {['Overview', 'Categories', 'Methods', 'Trends'].map((view) => {
              const active = insightSubView === view;
              return (
                <button
                  key={view}
                  type="button"
                  onClick={() => setInsightSubView(view)}
                  style={{
                    padding: '8px 6px',
                    borderRadius: 9,
                    border: 'none',
                    background: active ? '#2563eb' : 'transparent',
                    color: active ? '#ffffff' : palette.textMuted,
                    fontWeight: 800,
                    fontSize: 11.5,
                    cursor: 'pointer',
                  }}
                >
                  {view}
                </button>
              );
            })}
          </div>

          {/* Total Spent Comparison Card (Always visible in Insights) */}
          <div style={{
            padding: '16px',
            borderRadius: 18,
            background: palette.surfaceAlt,
            border: `1px solid ${palette.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: palette.textMuted }}>Total Spent</div>
              <div style={{ fontSize: 28, fontWeight: 950, color: palette.text, marginTop: 2 }}>
                ₹{formatINR(analytics.netSpending)}
              </div>
              <div style={{ fontSize: 11.5, color: palette.textMuted, fontWeight: 700, marginTop: 4 }}>
                {analytics.prevMonthComparison
                  ? `${analytics.prevMonthComparison.diff <= 0 ? '₹' + formatINRShort(Math.abs(analytics.prevMonthComparison.diff)) + ' less' : '₹' + formatINRShort(analytics.prevMonthComparison.diff) + ' more'} than last month`
                  : `Gross ₹${formatINRShort(analytics.grossExpenses)} · Refunds ₹${formatINRShort(analytics.totalRefunds)}`}
              </div>
            </div>
            <span style={{
              padding: '6px 12px',
              borderRadius: 10,
              background: 'rgba(16, 185, 129, 0.16)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              color: '#34d399',
              fontSize: 12.5,
              fontWeight: 900,
            }}>
              {analytics.prevMonthComparison
                ? `${analytics.prevMonthComparison.pctChange <= 0 ? '↓' : '↑'} ${Math.abs(Math.round(analytics.prevMonthComparison.pctChange))}%`
                : '● Live'}
            </span>
          </div>

          {/* SUB-VIEW 1: OVERVIEW (Donut Chart + Smart Insight + Highlights + Q&A) */}
          {insightSubView === 'Overview' && (
            <>
              <div style={{
                padding: '18px 16px',
                borderRadius: 18,
                background: palette.surfaceAlt,
                border: `1px solid ${palette.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-around',
                gap: 16,
                flexWrap: 'wrap',
              }}>
                <SpendingDonutChart
                  segments={donutSegments}
                  totalSpent={analytics.netSpending}
                  isLight={isLight}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 135 }}>
                  {donutSegments.map((seg) => (
                    <div key={seg.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 999, background: seg.color, display: 'inline-block' }} />
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: palette.textSub }}>{seg.label}</span>
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 900, color: palette.text }}>{seg.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Smart Bulb Insight Card (Screen 10) */}
              <div style={{
                padding: '14px 16px',
                borderRadius: 16,
                background: isLight ? '#fefce8' : 'rgba(234, 179, 8, 0.12)',
                border: '1px solid rgba(234, 179, 8, 0.35)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
              }}>
                <span style={{ fontSize: 22 }}>💡</span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: isLight ? '#854d0e' : '#fde047' }}>Insight</div>
                  <div style={{ fontSize: 12.5, color: isLight ? '#713f12' : '#fef08a', fontWeight: 700, marginTop: 2, lineHeight: 1.45 }}>
                    {analytics.insights && analytics.insights.length > 0
                      ? analytics.insights[0]
                      : analytics.categoryBreakdown.length > 0
                        ? `Top category is ${analytics.categoryBreakdown[0].category} (₹${formatINRShort(analytics.categoryBreakdown[0].total)}, ${Math.round(analytics.categoryBreakdown[0].sharePct)}% of spending).`
                        : 'Record or scan your transactions to unlock personalized category insights.'}
                  </div>
                </div>
              </div>

              {/* Top Merchant & Highest Spend Day Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div style={{
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: palette.surfaceAlt,
                  border: `1px solid ${palette.border}`,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Top Merchant</div>
                  <div style={{ fontSize: 14, fontWeight: 950, color: palette.text, marginTop: 3 }}>
                    {analytics.topMerchant ? analytics.topMerchant.merchant : '—'}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#60a5fa', fontWeight: 800, marginTop: 2 }}>
                    {analytics.topMerchant ? `₹${formatINRShort(analytics.topMerchant.total)} (${analytics.topMerchant.count}x)` : 'No spend yet'}
                  </div>
                </div>
                <div style={{
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: palette.surfaceAlt,
                  border: `1px solid ${palette.border}`,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Highest Spend Day</div>
                  <div style={{ fontSize: 14, fontWeight: 950, color: palette.text, marginTop: 3 }}>
                    {analytics.highestSpendingDay ? formatShortDate(analytics.highestSpendingDay.date) : '—'}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#f43f5e', fontWeight: 800, marginTop: 2 }}>
                    {analytics.highestSpendingDay ? `₹${formatINRShort(analytics.highestSpendingDay.total)}` : 'No spend yet'}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* SUB-VIEW 2: CATEGORIES (Full Category Breakdown Bars — Tap to filter) */}
          {insightSubView === 'Categories' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {analytics.categoryBreakdown.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: palette.textMuted, fontSize: 13 }}>
                  No category spending recorded for {selectedMonth}.
                </div>
              ) : (
                analytics.categoryBreakdown.map((cat) => (
                  <button
                    key={cat.category}
                    type="button"
                    onClick={() => {
                      setFilterCategory(cat.category);
                      setSubTab('transactions');
                    }}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 16,
                      background: palette.surfaceAlt,
                      border: `1px solid ${palette.border}`,
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16 }}>{cat.icon}</span>
                        <span style={{ fontSize: 13.5, fontWeight: 900, color: palette.text }}>{cat.category}</span>
                        <span style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700 }}>
                          ({cat.count} txn{cat.count === 1 ? '' : 's'})
                        </span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 950, color: palette.text }}>
                        ₹{formatINRShort(cat.total)} <span style={{ fontSize: 11, color: palette.textMuted }}>({Math.round(cat.sharePct)}%)</span>
                      </div>
                    </div>
                    <div style={{
                      height: 6,
                      width: '100%',
                      borderRadius: 999,
                      background: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.16)',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(6, cat.sharePct))}%`,
                        background: cat.color || '#3b82f6',
                        borderRadius: 999,
                      }} />
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {/* SUB-VIEW 3: METHODS (Payment Method & App Breakdown) */}
          {insightSubView === 'Methods' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: palette.textSub }}>
                💳 Payment Method &amp; App Breakdown
              </div>
              {(!analytics.methodBreakdown || analytics.methodBreakdown.length === 0) ? (
                <div style={{ padding: 20, textAlign: 'center', color: palette.textMuted, fontSize: 13 }}>
                  No payment methods recorded for {selectedMonth}.
                </div>
              ) : (
                analytics.methodBreakdown.map((m) => (
                  <div
                    key={m.method}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 16,
                      background: palette.surfaceAlt,
                      border: `1px solid ${palette.border}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13.5, fontWeight: 900, color: palette.text }}>
                        {m.method} <span style={{ fontSize: 11, color: palette.textMuted }}>({m.count}x)</span>
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 950, color: '#60a5fa' }}>
                        ₹{formatINRShort(m.total)} ({Math.round(m.sharePct)}%)
                      </span>
                    </div>
                    <div style={{
                      height: 6,
                      width: '100%',
                      borderRadius: 999,
                      background: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.16)',
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(8, m.sharePct))}%`,
                        background: 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                        borderRadius: 999,
                      }} />
                    </div>
                  </div>
                ))
              )}

              {analytics.appBreakdown && analytics.appBreakdown.length > 0 && (
                <>
                  <div style={{ fontSize: 12.5, fontWeight: 900, color: palette.textSub, marginTop: 6 }}>
                    📱 By UPI / Banking App
                  </div>
                  {analytics.appBreakdown.map((a) => (
                    <div
                      key={a.app}
                      style={{
                        padding: '11px 14px',
                        borderRadius: 14,
                        background: palette.surfaceAlt,
                        border: `1px solid ${palette.border}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 800, color: palette.text }}>
                        {a.app} <span style={{ fontSize: 11, color: palette.textMuted }}>({a.count}x)</span>
                      </span>
                      <span style={{ fontSize: 13.5, fontWeight: 900, color: a.total > 0 ? '#a855f7' : '#34d399' }}>
                        {a.total > 0 ? `₹${formatINRShort(a.total)}` : `+₹${formatINRShort(a.received || 0)}`}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* SUB-VIEW 4: TRENDS (Daily Spending Trend Bars + Insights List) */}
          {insightSubView === 'Trends' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 900, color: palette.textSub }}>
                📈 Daily Spending Trend ({selectedMonth})
              </div>
              {(!analytics.dailyTrend || analytics.dailyTrend.length === 0) ? (
                <div style={{ padding: 20, textAlign: 'center', color: palette.textMuted, fontSize: 13 }}>
                  No daily spending trend data for {selectedMonth}.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {analytics.dailyTrend.map((dayItem) => {
                    const maxDay = Math.max(...analytics.dailyTrend.map((d) => d.total), 1);
                    const pct = Math.min(100, Math.max(8, (dayItem.total / maxDay) * 100));
                    return (
                      <div
                        key={dayItem.date}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 12,
                          background: palette.surfaceAlt,
                          border: `1px solid ${palette.border}`,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 800, marginBottom: 5 }}>
                          <span style={{ color: palette.text }}>{formatFriendlyDate(dayItem.date, todayIso)}</span>
                          <span style={{ color: '#f43f5e' }}>₹{formatINRShort(dayItem.total)}</span>
                        </div>
                        <div style={{
                          height: 6,
                          width: '100%',
                          borderRadius: 999,
                          background: isLight ? '#e2e8f0' : 'rgba(148,163,184,0.16)',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%',
                            width: `${pct}%`,
                            background: 'linear-gradient(90deg, #f43f5e, #d946ef)',
                            borderRadius: 999,
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Natural-Language Money Assistant Q&A */}
          <div style={{
            padding: '14px 16px',
            borderRadius: 16,
            background: palette.surfaceAlt,
            border: `1px solid ${palette.border}`,
          }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: '#60a5fa', marginBottom: 8 }}>
              🤖 Ask Your Money Assistant
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={nlQuery}
                onChange={(e) => setNlQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAskQuestion(nlQuery);
                }}
                placeholder="e.g. How much did I spend on food?"
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surface,
                  color: palette.text,
                  fontSize: 12.5,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => handleAskQuestion(nlQuery)}
                style={{
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Ask
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingTop: 8 }}>
              {SMART_QA_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => handleAskQuestion(chip)}
                  style={{
                    padding: '4px 9px',
                    borderRadius: 999,
                    border: `1px solid ${palette.border}`,
                    background: palette.surface,
                    color: palette.textSub,
                    fontSize: 10.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
            {nlResponse && (
              <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 800, color: palette.text, lineHeight: 1.5 }}>
                {nlResponse.answer}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SCREEN 11: MISSING NOTES (REVIEW)
         ═══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'missing-notes' && (
        <div style={{
          background: palette.surface,
          borderRadius: 22,
          border: `1px solid ${palette.border}`,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setSubTab('overview')}
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                border: `1px solid ${palette.border}`,
                background: palette.surfaceAlt,
                color: palette.text,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              ←
            </button>
            <span style={{ fontSize: 17, fontWeight: 950, color: palette.text }}>Missing Notes</span>
          </div>

          {/* Filter Pills: All (N) | Today (N) | This Week (N) (Screen 11) */}
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { id: 'all', label: `All (${filteredMissingNotes.all.length})` },
              { id: 'today', label: `Today (${filteredMissingNotes.today.length})` },
              { id: 'week', label: `This Week (${filteredMissingNotes.week.length})` },
            ].map((tab) => {
              const active = missingFilterWindow === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMissingFilterWindow(tab.id)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 999,
                    border: active ? 'none' : `1px solid ${palette.border}`,
                    background: active ? '#2563eb' : palette.surfaceAlt,
                    color: active ? '#ffffff' : palette.textSub,
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {filteredMissingNotes.active.length === 0 ? (
            <div style={{ padding: '28px 14px', textAlign: 'center', color: palette.textMuted, fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>🎉</div>
              <div style={{ fontWeight: 900, color: palette.text }}>You&apos;re all caught up!</div>
              <div style={{ marginTop: 4 }}>Every tracked transaction has a personal memory note.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredMissingNotes.active.map((tx) => {
                const draft = inlineNoteDrafts[tx.id] ?? '';
                return (
                  <div
                    key={tx.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 16,
                      background: palette.surfaceAlt,
                      border: `1px solid ${palette.border}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div
                      onClick={() => setSelectedTxId(tx.id)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <BrandPaymentAvatar tx={tx} size={42} />
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 900, color: palette.text }}>
                            {tx.merchant || tx.app || 'Payment'}
                          </div>
                          <div style={{ fontSize: 11.5, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                            {formatShortDate(tx.date)}, {formatTime12h(tx.time)}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 15, fontWeight: 950, color: palette.text }}>
                          - ₹{formatINRShort(tx.amount)}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#60a5fa', fontWeight: 800, marginTop: 3 }}>
                          Details ✏️
                        </div>
                      </div>
                    </div>

                    {/* Fast Inline Note Entry + Quick Templates */}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="text"
                        value={draft}
                        onChange={(e) => setInlineNoteDrafts((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && draft.trim()) {
                            handleUpdatePersonalNote(tx.id, draft);
                          }
                        }}
                        placeholder="What was this payment for? (e.g. Office lunch, Petrol...)"
                        style={{
                          flex: 1,
                          padding: '8px 10px',
                          borderRadius: 10,
                          border: `1px solid ${palette.border}`,
                          background: palette.surface,
                          color: palette.text,
                          fontSize: 12,
                          fontWeight: 700,
                          outline: 'none',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleUpdatePersonalNote(tx.id, draft || 'Reviewed')}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 10,
                          border: 'none',
                          background: '#2563eb',
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}
                      >
                        Save Note
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {QUICK_NOTE_TEMPLATES.slice(0, 5).map((tpl) => (
                        <button
                          key={tpl.label}
                          type="button"
                          onClick={() => handleUpdatePersonalNote(tx.id, tpl.label)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 999,
                            border: `1px solid ${palette.border}`,
                            background: palette.surface,
                            color: palette.textSub,
                            fontSize: 10.5,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          + {tpl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SETTINGS, PRIVACY, AUTO-DETECTION & EXPORT
         ═══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'settings' && (
        <div style={{
          background: palette.surface,
          borderRadius: 22,
          border: `1px solid ${palette.border}`,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          <div style={{ fontSize: 16, fontWeight: 950, color: palette.text }}>
            🔒 Private Expense Memory &amp; CSV Export
          </div>

          {/* Encrypted On-Device Storage Status Card */}
          <div style={{
            padding: '12px 14px',
            borderRadius: 14,
            background: storageStatus.setupRequired ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
            border: storageStatus.setupRequired ? '1px solid rgba(239,68,68,0.4)' : '1px solid rgba(16,185,129,0.35)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: storageStatus.setupRequired ? '#f87171' : '#34d399' }}>
              {storageStatus.encrypted
                ? '🛡️ Android-Keystore AES-256-GCM Encrypted Storage Active'
                : storageStatus.setupRequired
                  ? '⚠️ Native Encrypted Storage Setup Required'
                  : '🖥️ Local Desktop Preview Mode'}
            </div>
            <div style={{ fontSize: 11.5, color: palette.textSub, lineHeight: 1.45 }}>
              {storageStatus.reason} Production transactions are never written to plaintext localStorage, Android device backup is disabled (<code>allowBackup=false</code>), and no expense history is ever sent over the network.
            </div>
          </div>

          {/* Explicit Notification Listener Allow-List Card */}
          <div style={{
            padding: '12px 14px',
            borderRadius: 14,
            background: palette.surfaceAlt,
            border: `1px solid ${palette.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: palette.text }}>Allow-Listed Payment Notification Capture</div>
              <div style={{ fontSize: 11.5, color: palette.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                {notifGranted
                  ? '🟢 Active — Capturing high-confidence completed transactions only'
                  : 'Requires explicit Android Notification Listener consent (if Android 13–16 shows "Controlled by Restricted Setting", tap Step 1 below first)'}
              </div>
              <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 4, lineHeight: 1.4 }}>
                Allowed apps: {ALLOWED_PAYMENT_PACKAGES.map((p) => p.appLabel).join(', ')}. Unknown apps are ignored, raw notification bodies are never stored, and Android may not expose every payment (manual add/edit is always available).
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  if (window.PattanBiometric && typeof window.PattanBiometric.openAppDetailsSettings === 'function') {
                    window.PattanBiometric.openAppDetailsSettings();
                  } else {
                    setScanStatus('ℹ️ On Android: Open Phone Settings → Apps → OT & Salary Tracker → ⋮ (top-right) → Allow restricted settings.');
                  }
                }}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(250, 204, 21, 0.5)',
                  background: 'rgba(250, 204, 21, 0.14)',
                  color: isLight ? '#854d0e' : '#fef08a',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                🔓 Step 1: Unlock Restricted Setting (App Info)
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.PattanBiometric && typeof window.PattanBiometric.openNotificationListenerSettings === 'function') {
                    window.PattanBiometric.openNotificationListenerSettings();
                  } else {
                    setScanStatus('ℹ️ Open inside the Android APK to grant Notification Listener access.');
                  }
                }}
                style={{
                  padding: '8px 14px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surface,
                  color: palette.text,
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                🔔 Step 2: Enable Notification Access
              </button>
            </div>
          </div>

          {/* Bank SMS Inbox Scanner (Android Optional Helper) */}
          <div style={{
            padding: '12px 14px',
            borderRadius: 14,
            background: palette.surfaceAlt,
            border: `1px solid ${palette.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: palette.text }}>📲 Bank &amp; UPI SMS Inbox Scan</div>
              <div style={{ fontSize: 11.5, color: palette.textMuted, marginTop: 2 }}>
                {smsGranted
                  ? '🟢 SMS Permission Active — Scan recent bank debit/credit alerts'
                  : 'Scan recent bank SMS alerts on-device or paste any receipt manually'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => triggerMobileTransactionScan()}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: `1px solid ${palette.border}`,
                background: palette.surface,
                color: '#60a5fa',
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {isScanning ? 'Scanning...' : 'Scan Now'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={handleExportExpensesCsv}
              style={{
                padding: '12px',
                borderRadius: 14,
                border: 'none',
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                color: '#fff',
                fontWeight: 900,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              📥 Export Statement CSV
            </button>
            <button
              type="button"
              onClick={handleExportExpensesJson}
              style={{
                padding: '12px',
                borderRadius: 14,
                border: `1px solid ${palette.border}`,
                background: palette.surfaceAlt,
                color: palette.text,
                fontWeight: 800,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              📤 Export JSON Backup
            </button>
            <button
              type="button"
              onClick={() => setShowSmsPasteModal(true)}
              style={{
                padding: '12px',
                borderRadius: 14,
                border: `1px solid ${palette.border}`,
                background: palette.surfaceAlt,
                color: palette.text,
                fontWeight: 800,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              📩 Paste Payment Alert
            </button>
            <div
              style={{
                padding: '12px',
                borderRadius: 14,
                border: '1px solid rgba(16, 185, 129, 0.4)',
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#34d399',
                fontWeight: 800,
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
              }}
            >
              🔒 Permanent Ledger (Never Deleted)
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL: QUICK-ADD / EDIT TRANSACTION
         ═══════════════════════════════════════════════════════════════════════ */}
      {showAddModal && (
        <div
          onClick={() => setShowAddModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.78)',
            backdropFilter: 'blur(8px)',
            zIndex: 99990,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveTransactionForm}
            style={{
              width: 'min(480px, 100%)',
              maxHeight: '92vh',
              overflowY: 'auto',
              background: palette.surface,
              borderRadius: 24,
              border: `1px solid ${palette.border}`,
              padding: 20,
              color: palette.text,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 16, fontWeight: 950 }}>
                {editingTxId ? '✏️ Edit Transaction' : '➕ Add Transaction & Note'}
              </span>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                style={{ background: 'transparent', border: 'none', color: palette.textMuted, fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Direction Pills: Money Out | Money In | Refund */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { id: 'debit', label: '💸 Money Out' },
                { id: 'credit', label: '💰 Money In' },
                { id: 'refund', label: '↩️ Refund' },
              ].map((dir) => {
                const active = formType === dir.id;
                return (
                  <button
                    key={dir.id}
                    type="button"
                    onClick={() => setFormType(dir.id)}
                    style={{
                      padding: '8px',
                      borderRadius: 10,
                      border: active ? 'none' : `1px solid ${palette.border}`,
                      background: active ? '#2563eb' : palette.surfaceAlt,
                      color: active ? '#fff' : palette.textSub,
                      fontWeight: 800,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {dir.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted }}>Amount (₹) *</label>
                <input
                  type="number"
                  step="any"
                  min="1"
                  required
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  placeholder="350"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 4,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 15,
                    fontWeight: 900,
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted }}>Payment App</label>
                <select
                  value={formApp}
                  onChange={(e) => setFormApp(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 4,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                >
                  <option value="GPay">Google Pay</option>
                  <option value="PhonePe">PhonePe</option>
                  <option value="Paytm">Paytm</option>
                  <option value="BHIM UPI">BHIM UPI</option>
                  <option value="Amazon">Amazon Pay</option>
                  <option value="Swiggy">Swiggy</option>
                  <option value="HDFC Bank">HDFC Bank</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted }}>Paid To / Merchant</label>
                <input
                  type="text"
                  value={formMerchant}
                  onChange={(e) => setFormMerchant(e.target.value)}
                  placeholder="e.g. Zomato, Rahul, Swiggy..."
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 4,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted }}>UPI ID (Optional)</label>
                <input
                  type="text"
                  value={formPayeeVpa}
                  onChange={(e) => setFormPayeeVpa(e.target.value)}
                  placeholder="merchant@okaxis"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 4,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 12.5,
                    fontWeight: 700,
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 800, color: '#60a5fa' }}>📌 Personal Memory Note (Why did you spend this?)</label>
              <input
                type="text"
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="e.g. Office lunch with team, Petrol..."
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  marginTop: 4,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid rgba(59,130,246,0.45)',
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 13,
                  fontWeight: 800,
                }}
              />
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {QUICK_NOTE_TEMPLATES.slice(0, 6).map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => {
                      setFormNote(tpl.label);
                      setFormCategory(tpl.category);
                    }}
                    style={{
                      padding: '4px 9px',
                      borderRadius: 999,
                      border: `1px solid ${palette.border}`,
                      background: palette.surfaceAlt,
                      color: palette.textSub,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
              {merchantSuggestions.suggestedNotes.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#60a5fa' }}>
                  Suggested: {merchantSuggestions.suggestedNotes.join(', ')}
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted }}>Category</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 4,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 12.5,
                    fontWeight: 800,
                  }}
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted }}>Method &amp; Type</label>
                <select
                  value={formPaymentMethod}
                  onChange={(e) => setFormPaymentMethod(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 4,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 12.5,
                    fontWeight: 800,
                  }}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.icon} {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Date, Time & Tags Row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.2fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>Date</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 3,
                    padding: '8px',
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>Time</label>
                <input
                  type="time"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 3,
                    padding: '8px',
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>Tags</label>
                <input
                  type="text"
                  value={formTagsInput}
                  onChange={(e) => setFormTagsInput(e.target.value)}
                  placeholder="#lunch, #office"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 3,
                    padding: '8px',
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: formType === 'debit' ? '1fr 1.15fr' : '1fr', gap: 8, marginTop: 4 }}>
              <button
                type="submit"
                style={{
                  padding: '13px',
                  borderRadius: 14,
                  border: 'none',
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: 13.5,
                  cursor: 'pointer',
                }}
              >
                💾 Save Entry
              </button>
              {formType === 'debit' && (
                <button
                  type="button"
                  onClick={handleLaunchUpiAndSave}
                  style={{
                    padding: '13px',
                    borderRadius: 14,
                    border: '1px solid rgba(16, 185, 129, 0.5)',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff',
                    fontWeight: 900,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  💸 Pay via UPI &amp; Save
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL: PASTE SMS / RECEIPT
         ═══════════════════════════════════════════════════════════════════════ */}
      {showSmsPasteModal && (
        <div
          onClick={() => setShowSmsPasteModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.78)',
            backdropFilter: 'blur(8px)',
            zIndex: 99990,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(460px, 100%)',
              background: palette.surface,
              borderRadius: 24,
              border: `1px solid ${palette.border}`,
              padding: 20,
              color: palette.text,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 950 }}>📩 Paste Bank SMS or UPI Receipt</div>
            <textarea
              rows={4}
              value={smsPasteText}
              onChange={(e) => setSmsPasteText(e.target.value)}
              placeholder="e.g. Rs. 350.00 debited from A/c XX1234 to VPA sreeram@okaxis on 19-10-2026. UPI Ref 62810242356."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: 12,
                borderRadius: 12,
                border: `1px solid ${palette.border}`,
                background: palette.surfaceAlt,
                color: palette.text,
                fontSize: 13,
              }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowSmsPasteModal(false)}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.textSub,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePasteSmsParse}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                Extract &amp; Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL: 🏦 CHECK BALANCE & REAL BANK PASSBOOK SYNC
         ═══════════════════════════════════════════════════════════════════════ */}
      {showCheckBalanceModal && (
        <div
          onClick={() => setShowCheckBalanceModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 6, 23, 0.82)',
            backdropFilter: 'blur(8px)',
            zIndex: 99995,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveBankBalanceManual}
            style={{
              width: 'min(480px, 100%)',
              maxHeight: '92vh',
              overflowY: 'auto',
              background: palette.surface,
              borderRadius: 24,
              border: '1px solid rgba(52, 211, 153, 0.45)',
              padding: 20,
              color: palette.text,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 16.5, fontWeight: 950 }}>
                🏦 Check Balance &amp; Bank Passbook
              </span>
              <button
                type="button"
                onClick={() => setShowCheckBalanceModal(false)}
                style={{ background: 'transparent', border: 'none', color: palette.textMuted, fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Live Balance Summary Banner */}
            <div style={{
              padding: '16px',
              borderRadius: 18,
              background: 'linear-gradient(135deg, #0f172a 0%, #064e3b 100%)',
              border: '1px solid rgba(52, 211, 153, 0.4)',
              color: '#f8fafc',
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#6ee7b7', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Current Real Account Balance (Remaining)
              </div>
              <div style={{ fontSize: 32, fontWeight: 950, color: '#ffffff', marginTop: 4 }}>
                ₹{formatINR(analytics.realAccountBalance)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(16, 185, 129, 0.16)' }}>
                  <div style={{ fontSize: 10, color: '#a7f3d0', fontWeight: 800 }}>Total Deposited / In</div>
                  <div style={{ fontSize: 14, color: '#34d399', fontWeight: 950, marginTop: 2 }}>
                    +₹{formatINR(analytics.allTimeReceived)}
                  </div>
                </div>
                <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(244, 63, 94, 0.16)' }}>
                  <div style={{ fontSize: 10, color: '#fecdd3', fontWeight: 800 }}>Total Spent / Out</div>
                  <div style={{ fontSize: 14, color: '#fb7185', fontWeight: 950, marginTop: 2 }}>
                    -₹{formatINR(analytics.allTimeSpent)}
                  </div>
                </div>
              </div>
            </div>

            {/* 1-Tap Open UPI App to Check Bank Balance */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 900, color: palette.text, marginBottom: 6 }}>
                📲 1-Tap Check Live Bank Balance in UPI App
              </div>
              <div style={{ fontSize: 11, color: palette.textMuted, marginBottom: 8 }}>
                Open your UPI app to check your bank balance with UPI PIN. If your bank sends an SMS/notification with <em>Avl Bal</em>, it updates here automatically!
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {[
                  { key: 'gpay', label: 'Google Pay (Check Bal)', bg: '#2563eb' },
                  { key: 'phonepe', label: 'PhonePe (Check Bal)', bg: '#6739b7' },
                  { key: 'paytm', label: 'Paytm (Check Bal)', bg: '#0284c7' },
                  { key: 'bhim', label: 'BHIM UPI (Check Bal)', bg: '#059669' },
                ].map((u) => (
                  <button
                    key={u.key}
                    type="button"
                    onClick={() => handleLaunchUpiBalanceCheck(u.key, u.label)}
                    style={{
                      padding: '10px 10px',
                      borderRadius: 11,
                      border: 'none',
                      background: u.bg,
                      color: '#ffffff',
                      fontWeight: 800,
                      fontSize: 11.5,
                      cursor: 'pointer',
                    }}
                  >
                    🏦 {u.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Set / Sync Exact Current Bank Balance */}
            <div style={{
              padding: '12px',
              borderRadius: 14,
              background: palette.surfaceAlt,
              border: `1px solid ${palette.border}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: '#34d399' }}>
                ✏️ Set / Sync Your Exact Current Bank Balance (₹)
              </div>
              <div style={{ fontSize: 11, color: palette.textMuted }}>
                Enter your real bank balance once. Every ₹100 payment (-₹100) and ₹100 deposit (+₹100) will automatically deduct or add to this balance and show your remaining balance on every transaction!
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted }}>Current Available Balance (₹) *</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={balanceDraftAmount}
                  onChange={(e) => setBalanceDraftAmount(e.target.value)}
                  placeholder="e.g. 12500.00"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 4,
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(52, 211, 153, 0.5)',
                    background: palette.surface,
                    color: palette.text,
                    fontSize: 16,
                    fontWeight: 900,
                  }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>Bank Name</label>
                  <input
                    type="text"
                    value={balanceDraftBank}
                    onChange={(e) => setBalanceDraftBank(e.target.value)}
                    placeholder="e.g. SBI / HDFC / ICICI"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: 3,
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: `1px solid ${palette.border}`,
                      background: palette.surface,
                      color: palette.text,
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>A/c Last 4 Digits</label>
                  <input
                    type="text"
                    value={balanceDraftMask}
                    onChange={(e) => setBalanceDraftMask(e.target.value)}
                    placeholder="XX1234"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      marginTop: 3,
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: `1px solid ${palette.border}`,
                      background: palette.surface,
                      color: palette.text,
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Recent Passbook Balance Trail */}
            {recentPaymentsList.length > 0 && (
              <div style={{
                padding: '10px 12px',
                borderRadius: 12,
                background: palette.surfaceAlt,
                border: `1px solid ${palette.border}`,
              }}>
                <div style={{ fontSize: 11.5, fontWeight: 900, color: palette.text, marginBottom: 6 }}>
                  📜 How Your Balance Changed (Recent Statement)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recentPaymentsList.slice(0, 4).map((tx) => {
                    const isCredit = tx.type === 'credit' || tx.type === 'refund';
                    const bAfter = Number.isFinite(Number(tx.runningBalance)) ? tx.runningBalance : tx.accountBalance;
                    return (
                      <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5 }}>
                        <span style={{ color: palette.textSub, fontWeight: 700 }}>
                          {tx.merchant || tx.app} ({formatShortDate(tx.date)})
                        </span>
                        <span style={{ fontWeight: 900, color: isCredit ? '#34d399' : '#fb7185' }}>
                          {isCredit ? `+₹${formatINR(tx.amount)}` : `-₹${formatINR(tx.amount)}`}
                          {Number.isFinite(Number(bAfter)) ? ` → Bal: ₹${formatINR(bAfter)}` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setShowCheckBalanceModal(false)}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.textSub,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
              <button
                type="submit"
                style={{
                  flex: 1.3,
                  padding: 12,
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#022c22',
                  fontWeight: 950,
                  fontSize: 13.5,
                  cursor: 'pointer',
                }}
              >
                💾 Save Real Balance
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

