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
      const txList = Array.isArray(detail.transactions) ? detail.transactions : [];
      if (txList.length > 0) {
        const added = mergeDetectedTransactions(txList, 'android-notif');
        setScanStatus(
          added > 0
            ? `✅ Auto-captured ${added} new UPI/Bank payment(s)`
            : `✅ Checked ${txList.length} payment notification(s) — statement up to date`
        );
      } else if (!detail.notifGranted) {
        setScanStatus('ℹ️ Enable Notification Access to auto-capture UPI & Bank payments.');
      } else {
        setScanStatus('ℹ️ Checked payment notifications — no new transactions found.');
      }
    };
    window.addEventListener('pattan-mobile-transactions', onMobileTxEvent);
    return () => window.removeEventListener('pattan-mobile-transactions', onMobileTxEvent);
  }, [mergeDetectedTransactions]);

  // Silent sync of encrypted notification captures on mount
  useEffect(() => {
    try {
      if (window.PattanBiometric && typeof window.PattanBiometric.getSavedMobileTransactionsJson === 'function') {
        const savedRaw = window.PattanBiometric.getSavedMobileTransactionsJson();
        const savedArr = JSON.parse(savedRaw || '[]');
        if (Array.isArray(savedArr) && savedArr.length > 0) {
          mergeDetectedTransactions(savedArr, 'android-saved-notif');
        }
      }
    } catch (_) {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerMobileTransactionScan = () => {
    setIsScanning(true);
    checkNativePermissions();
    try {
      if (window.PattanBiometric && typeof window.PattanBiometric.scanMobileTransactions === 'function') {
        window.PattanBiometric.scanMobileTransactions(45);
        return;
      }
      if (window.PattanBiometric && typeof window.PattanBiometric.scanMobileSmsInbox === 'function') {
        window.PattanBiometric.scanMobileSmsInbox(45);
        return;
      }
      if (window.PattanBiometric && typeof window.PattanBiometric.getSavedMobileTransactionsJson === 'function') {
        const savedRaw = window.PattanBiometric.getSavedMobileTransactionsJson();
        const savedArr = JSON.parse(savedRaw || '[]');
        const added = mergeDetectedTransactions(savedArr, 'android-saved-notif');
        setIsScanning(false);
        setScanStatus(
          added > 0
            ? `✅ Synced ${added} new payment notification(s)`
            : notifGranted
              ? '✅ Notification capture is active for all UPI & banking apps.'
              : 'ℹ️ Enable Notification Listener access to capture UPI payments automatically.'
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
          !v._deleted &&
          !v._demoPreview &&
          !v.isDemoPreview &&
          v.source !== 'demo-preview' &&
          !String(k).startsWith('demo_tx_')
        ) {
          cleanMap[k] = v;
        }
      }
    }
    return cleanMap;
  }, [expensesMap]);

  const analytics = useMemo(
    () => computeExpenseAnalytics(effectiveExpensesSource, { selectedMonth, todayIso, monthlyNetSalary: effectiveMonthlySalary }),
    [effectiveExpensesSource, selectedMonth, todayIso, effectiveMonthlySalary]
  );

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

  // Filtered Transactions for Screen 8 (including Advanced Filters)
  const filteredTransactions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const minAmt = filterMinAmount !== '' ? Number(filterMinAmount) : null;
    const maxAmt = filterMaxAmount !== '' ? Number(filterMaxAmount) : null;

    return analytics.monthActiveList.filter((tx) => {
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
    analytics.monthActiveList,
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
        clean[k] = { ...v };
      }
    }
    return clean;
  }, [expensesMap]);

  const openQuickAddModal = (txToEdit = null) => {
    if (txToEdit) {
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
      setEditingTxId(null);
      setFormAmount('');
      setFormType('debit');
      setFormMerchant('');
      setFormPayeeVpa('');
      setFormNote('');
      setFormPaymentRemark('');
      setFormCategory('Food & Dining');
      setFormPaymentMethod('UPI');
      setFormApp('GPay');
      setFormDate(todayIso);
      setFormTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
      setFormTagsInput('');
    }
    setShowAddModal(true);
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
    const cleanMerchant = formMerchant.trim() || (cleanNote ? cleanNote.slice(0, 32) : 'Mobile Payment');
    const tags = formTagsInput
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);

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

    const nextMap = { ...baseMap, [txId]: record };
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(
        nextMap,
        `${editingTxId ? '✏️ Updated' : '💾 Saved'} ₹${formatINR(amt)} — ${cleanMerchant}`
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

  const handleDeleteTransaction = (txId) => {
    const baseMap = getMaterializedBaseMap();
    const existing = baseMap[txId] || (effectiveExpensesSource || {})[txId];
    if (!existing) return;
    const prevSnapshot = { ...baseMap };
    const nowMs = Date.now();
    const nextMap = {
      ...baseMap,
      [txId]: {
        ...existing,
        _demoPreview: false,
        isDemoPreview: false,
        _deleted: true,
        updatedAt: new Date(nowMs).toISOString(),
        updatedAtMs: nowMs,
      },
    };
    setUndoBanner({
      message: `Removed ₹${formatINR(existing.amount)} (${existing.merchant || 'Transaction'})`,
      snapshot: prevSnapshot,
    });
    if (selectedTxId === txId) setSelectedTxId(null);
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(nextMap, '🗑️ Removed transaction');
    }
  };

  const handlePasteSmsParse = () => {
    const raw = smsPasteText.trim();
    if (!raw) return;
    const parsed = parseSmsOrUpiTextJs(raw, Date.now());
    if (!parsed) {
      setScanStatus('⚠️ No valid payment found (OTPs, promos, and balance alerts are safely ignored).');
      return;
    }
    mergeDetectedTransactions([parsed], 'sms-paste');
    setSmsPasteText('');
    setShowSmsPasteModal(false);
    setScanStatus(`✅ Added ₹${formatINR(parsed.amount)} (${parsed.merchant}) from pasted message`);
  };

  const handleExportExpensesCsv = () => {
    const csv = formatTransactionsCsv(analytics.monthActiveList);
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
        transactions: analytics.monthActiveList,
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
    if (!window.confirm('Clear all transactions from your statement? You can undo immediately after.')) return;
    const prevSnapshot = { ...(expensesMap || {}) };
    setUndoBanner({
      message: 'Cleared all transactions from Expense Memory',
      snapshot: prevSnapshot,
    });
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses({}, '🗑️ Cleared Expense Memory');
    }
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
            <button
              type="button"
              onClick={() => handleDeleteTransaction(selectedTx.id)}
              style={{
                padding: '7px 12px',
                borderRadius: 10,
                border: '1px solid rgba(239,68,68,0.35)',
                background: 'rgba(239,68,68,0.12)',
                color: '#f87171',
                fontSize: 11.5,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              🗑️
            </button>
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
            { label: 'Type', value: selectedTx.paymentMethod === 'UPI' ? 'UPI Payment' : (selectedTx.paymentMethod || 'Payment') },
            { label: 'From', value: selectedTx.accountMask ? `Bank Account (${selectedTx.accountMask})` : 'HDFC / Linked Bank' },
            { label: 'To', value: (selectedTx.merchant || 'Merchant').toUpperCase() },
            { label: 'Category', value: selectedTx.category || 'Food & Dining' },
            { label: 'UPI ID', value: upiHandle },
            { label: 'Transaction ID', value: txRefDisplay },
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
              ● {selectedTx.reconciliationStatus === 'needs_review' ? 'Needs Review' : 'Success'}
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
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          fontSize: 12,
          fontWeight: 800,
          color: isLight ? '#065f46' : '#a7f3d0',
        }}>
          <span>
            🔔 Enable Notification Access once so every GPay, PhonePe, Paytm, BHIM, Super.money, CRED &amp; Bank UPI payment is recorded automatically with its exact amount.
          </span>
          <button
            type="button"
            onClick={() => {
              if (window.PattanBiometric && typeof window.PattanBiometric.openNotificationListenerSettings === 'function') {
                window.PattanBiometric.openNotificationListenerSettings();
              }
            }}
            style={{
              padding: '7px 12px',
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
            🔔 Enable Auto UPI Capture
          </button>
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
                <span>In: ₹{formatINRShort(analytics.totalIncome)}</span>
                <span>·</span>
                <span>Salary Left: ₹{formatINRShort(remainingSalary)}</span>
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

          {/* 4 Category Mini-Cards Row (Food, Transport, Shopping, Others — Screen 7) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
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
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
          }}>
            <div style={{
              padding: '10px 9px',
              borderRadius: 14,
              background: palette.surface,
              border: `1px solid ${palette.border}`,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: palette.textMuted }}>Spent Today</div>
              <div style={{ fontSize: 13.5, fontWeight: 950, color: '#f43f5e', marginTop: 3 }}>
                ₹{formatINRShort(analytics.todaySpent)}
              </div>
              <div style={{ fontSize: 10, color: palette.textMuted, marginTop: 1 }}>
                {analytics.todayCount} txn{analytics.todayCount === 1 ? '' : 's'}
              </div>
            </div>

            <div style={{
              padding: '10px 9px',
              borderRadius: 14,
              background: palette.surface,
              border: `1px solid ${palette.border}`,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: palette.textMuted }}>Received Today</div>
              <div style={{ fontSize: 13.5, fontWeight: 950, color: '#10b981', marginTop: 3 }}>
                +₹{formatINRShort(analytics.todayReceived)}
              </div>
              <div style={{ fontSize: 10, color: palette.textMuted, marginTop: 1 }}>
                In: ₹{formatINRShort(analytics.totalIncome)}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSubTab('transactions')}
              style={{
                padding: '10px 9px',
                borderRadius: 14,
                background: palette.surface,
                border: `1px solid ${palette.border}`,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 10.5, fontWeight: 700, color: palette.textMuted }}>This Month</div>
              <div style={{ fontSize: 13.5, fontWeight: 950, color: palette.text, marginTop: 3 }}>
                {analytics.totalCount} Txns
              </div>
              <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 700, marginTop: 1 }}>
                View all ›
              </div>
            </button>

            <button
              type="button"
              onClick={() => setSubTab('missing-notes')}
              style={{
                padding: '10px 9px',
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
              <div style={{ fontSize: 13.5, fontWeight: 950, color: analytics.missingNotesCount > 0 ? '#f59e0b' : '#10b981', marginTop: 3 }}>
                {analytics.missingNotesCount} Pending
              </div>
              <div style={{ fontSize: 10, color: palette.textMuted, marginTop: 1 }}>
                {analytics.missingNotesCount > 0 ? 'Add memory ›' : 'All noted ✓'}
              </div>
            </button>
          </div>

          {/* Fast Action Bar: + Add Spend, Sync Alerts, Paste Receipt */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <button
              type="button"
              onClick={() => openQuickAddModal(null)}
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
              ➕ Add Entry
            </button>
            <button
              type="button"
              onClick={() => triggerMobileTransactionScan()}
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
              {isScanning ? '⏳ Syncing...' : '📲 Sync Alerts'}
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
              📋 Paste Alert
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
                    <button
                      type="button"
                      onClick={() => handleDeleteTransaction(tx.id)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid rgba(239,68,68,0.4)',
                        background: 'transparent',
                        color: '#f87171',
                        fontWeight: 800,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent Payments (Auto Detected) List (Screen 7) */}
          <div style={{
            background: palette.surface,
            borderRadius: 22,
            border: `1px solid ${palette.border}`,
            padding: '16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14.5, fontWeight: 900, color: palette.text }}>
                Recent Payments (Auto Detected)
              </div>
              <button
                type="button"
                onClick={() => setSubTab('transactions')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#3b82f6',
                  fontSize: 12.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                See All ›
              </button>
            </div>

            {analytics.monthActiveList.length === 0 ? (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: palette.textMuted, fontSize: 13 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>💳</div>
                <div style={{ fontWeight: 800, color: palette.text }}>No payments recorded yet for {selectedMonth}.</div>
                <div style={{ marginTop: 4 }}>
                  Pay with any UPI app (GPay, PhonePe, Paytm, BHIM, Super.money, CRED, Bank) and your completed payment &amp; amount will appear here automatically.
                </div>
                <button
                  type="button"
                  onClick={() => triggerMobileTransactionScan()}
                  style={{
                    marginTop: 12,
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
                  📲 Sync UPI &amp; Bank Alerts Now
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {analytics.monthActiveList.slice(0, 6).map((tx) => {
                  const isCredit = tx.type === 'credit' || tx.type === 'refund';
                  const hasNote = Boolean(String(tx.personalNote || tx.note || '').trim());
                  const inlineDraft = inlineNoteDrafts[tx.id] ?? '';
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
                        gap: 8,
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                          <BrandPaymentAvatar tx={tx} size={42} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 900, color: palette.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {tx.merchant || tx.app || 'Google Pay'}
                            </div>
                            <div style={{ fontSize: 11.5, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                              {tx.date === todayIso ? `Today, ${formatTime12h(tx.time)}` : `${formatShortDate(tx.date)}, ${formatTime12h(tx.time)}`}
                              {hasNote ? ` · 📝 ${tx.personalNote || tx.note}` : ''}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 950, color: isCredit ? palette.credit : '#f43f5e' }}>
                            {isCredit ? `+ ₹${formatINRShort(tx.amount)}` : `- ₹${formatINRShort(tx.amount)}`}
                          </div>
                          <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                            {tx.paymentMethod === 'UPI' ? 'UPI Payment ›' : `${tx.category || 'Payment'} ›`}
                          </div>
                        </div>
                      </div>

                      {/* Fast Inline Note Entry for Un-Noted Debit Transactions */}
                      {!hasNote && !isCredit && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: 'flex',
                            gap: 6,
                            alignItems: 'center',
                            paddingTop: 6,
                            borderTop: `1px dashed ${palette.border}`,
                          }}
                        >
                          <input
                            type="text"
                            value={inlineDraft}
                            onChange={(e) => setInlineNoteDrafts((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && inlineDraft.trim()) {
                                handleUpdatePersonalNote(tx.id, inlineDraft);
                              }
                            }}
                            placeholder="📌 What was this payment for? (Add quick note...)"
                            style={{
                              flex: 1,
                              padding: '6px 10px',
                              borderRadius: 9,
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
                            onClick={() => handleUpdatePersonalNote(tx.id, inlineDraft || 'Reviewed')}
                            style={{
                              padding: '6px 11px',
                              borderRadius: 9,
                              border: 'none',
                              background: '#2563eb',
                              color: '#fff',
                              fontWeight: 800,
                              fontSize: 11,
                              cursor: 'pointer',
                            }}
                          >
                            Save
                          </button>
                        </div>
                      )}
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
                  const hasNote = Boolean(String(tx.personalNote || tx.note || '').trim());
                  return (
                    <div
                      key={tx.id}
                      onClick={() => setSelectedTxId(tx.id)}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 16,
                        background: palette.surfaceAlt,
                        border: `1px solid ${palette.border}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        <BrandPaymentAvatar tx={tx} size={42} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 900, color: palette.text }}>
                            {tx.merchant || tx.app || 'Payment'}
                          </div>
                          <div style={{ fontSize: 11.5, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                            {formatTime12h(tx.time)}
                            {hasNote ? ` · 📝 ${tx.personalNote || tx.note}` : ' · Tap to add note'}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 950, color: isCredit ? palette.credit : '#f43f5e' }}>
                          {isCredit ? `+ ₹${formatINRShort(tx.amount)}` : `- ₹${formatINRShort(tx.amount)}`}
                        </div>
                        <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                          {tx.paymentMethod === 'UPI' ? 'UPI Payment ›' : `${tx.category || 'Online Payment'} ›`}
                        </div>
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
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: palette.text }}>Allow-Listed Payment Notification Capture</div>
              <div style={{ fontSize: 11.5, color: palette.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                {notifGranted
                  ? '🟢 Active — Capturing high-confidence completed transactions only'
                  : 'Requires explicit Android Notification Listener consent'}
              </div>
              <div style={{ fontSize: 11, color: palette.textMuted, marginTop: 4, lineHeight: 1.4 }}>
                Allowed apps: {ALLOWED_PAYMENT_PACKAGES.map((p) => p.appLabel).join(', ')}. Unknown apps are ignored, raw notification bodies are never stored, and Android may not expose every payment (manual add/edit is always available).
              </div>
            </div>
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
                flexShrink: 0,
              }}
            >
              Configure
            </button>
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
            <button
              type="button"
              onClick={handleClearAllExpenses}
              style={{
                padding: '12px',
                borderRadius: 14,
                border: '1px solid rgba(239, 68, 68, 0.35)',
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#f87171',
                fontWeight: 800,
                fontSize: 12.5,
                cursor: 'pointer',
              }}
            >
              🗑️ Clear All Expenses
            </button>
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
    </div>
  );
}
