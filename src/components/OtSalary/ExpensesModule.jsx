import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  loadEncryptedExpenseStore,
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

export function sanitizeBrandFreeAppLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'UPI Transfer';
  const lower = s.toLowerCase();
  if (lower.includes('bank') || lower.includes('neft') || lower.includes('imps') || lower.includes('rtgs')) {
    return 'Bank Transfer';
  }
  if (lower.includes('cash')) return 'Cash';
  if (lower.includes('card')) return 'Card';
  return 'UPI Transfer';
}

// Flutter Material 3 Squircle Icon Avatar (Zero third-party brand logos)
export function BrandPaymentAvatar({ tx, size = 42 }) {
  const isCredit = tx?.type === 'credit' || tx?.type === 'refund';
  const label = `${tx?.merchant || ''} ${tx?.app || ''} ${tx?.paymentMethod || ''}`.toLowerCase();
  const radius = Math.round(size * 0.32);

  if (label.includes('bank') || label.includes('neft') || label.includes('imps')) {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: 'rgba(59, 130, 246, 0.16)',
        border: '1px solid rgba(59, 130, 246, 0.35)',
        color: '#60a5fa',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.44,
        flexShrink: 0,
      }}>
        🏦
      </div>
    );
  }

  const catInfo = EXPENSE_CATEGORIES.find((c) => c.id === tx?.category);
  if (catInfo && catInfo.id !== 'Other') {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `${catInfo.color}20`,
        border: `1px solid ${catInfo.color}50`,
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

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: radius,
      background: isCredit ? 'rgba(16, 185, 129, 0.16)' : 'rgba(99, 102, 241, 0.16)',
      border: isCredit ? '1px solid rgba(16, 185, 129, 0.38)' : '1px solid rgba(99, 102, 241, 0.35)',
      color: isCredit ? '#34d399' : '#818cf8',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 900,
      fontSize: size * 0.42,
      flexShrink: 0,
    }}>
      {isCredit ? '↙️' : '↗️'}
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
  activeAccountEmail = '',
  isOwnerAccount = false,
  isEmailLinked = false,
  onSyncEmail,
  onOpenChangeMobileModal,
}) {
  const effectiveMonthlySalary = Number(monthlyNetSalary || netMonthlySalary || 0);
  const hasLinkedEmail = Boolean(isEmailLinked || String(activeAccountEmail || '').trim());
  const isOwnerMasterLinked = Boolean(isOwnerAccount || String(activeAccountEmail || '').trim().toLowerCase() === 'patanyasin144@gmail.com');
  const onQuickLinkEmail = onSyncEmail;
  const onOpenChangeMobile = onOpenChangeMobileModal;
  const [emailDraftInput, setEmailDraftInput] = useState(activeAccountEmail || '');
  useEffect(() => {
    setEmailDraftInput(activeAccountEmail || '');
  }, [activeAccountEmail]);

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
            const prevTs = Number(prev?.updatedAtMs || 0);
            const nextTs = Number(parsed.updatedAtMs || 0);
            const prevBal = prev && Number.isFinite(Number(prev.balance)) ? Number(prev.balance) : null;
            const nextBal = Number(parsed.balance);
            const prevMask = String(prev?.accountMask || '');
            const nextMask = String(parsed.accountMask || '');
            if (!prev || nextTs > prevTs || nextBal !== prevBal || nextMask !== prevMask) {
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
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false);
  const [smsGranted, setSmsGranted] = useState(false);
  const [undoBanner, setUndoBanner] = useState(null);

  // Auto-dismiss scanStatus notification pill after 2.8s so it never stays stuck
  useEffect(() => {
    if (!scanStatus) return undefined;
    const t = setTimeout(() => setScanStatus(''), 2800);
    return () => clearTimeout(t);
  }, [scanStatus]);

  // Refs for bulletproof state freshness & intelligent inner scrollers
  const expensesMapRef = useRef(expensesMap);
  useEffect(() => {
    expensesMapRef.current = expensesMap;
  }, [expensesMap]);
  const lastSavedNativeRawRef = useRef('');
  const recentScrollerRef = useRef(null);
  const transactionsScrollerRef = useRef(null);
  const missingNotesScrollerRef = useRef(null);

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
          activeBlue: '#0284c7',
          debit: '#ef4444',
          credit: '#10b981',
        }
      : {
          bg: '#060c18',
          surface: '#0d1628',
          surfaceAlt: '#09101f',
          border: 'rgba(56, 189, 248, 0.16)',
          text: '#f8fafc',
          textSub: '#cbd5e1',
          textMuted: '#94a3b8',
          pillBg: '#132038',
          activeBlue: '#0ea5e9',
          debit: '#fb7185',
          credit: '#34d399',
        }
  ), [isLight]);

  const checkNativePermissions = useCallback(() => {
    try {
      if (window.PattanBiometric) {
        if (typeof window.PattanBiometric.isNotificationListenerEnabled === 'function') {
          const nextNotif = Boolean(window.PattanBiometric.isNotificationListenerEnabled());
          setNotifGranted((prev) => (prev === nextNotif ? prev : nextNotif));
        }
        if (typeof window.PattanBiometric.hasSmsPermission === 'function') {
          const nextSms = Boolean(window.PattanBiometric.hasSmsPermission());
          setSmsGranted((prev) => (prev === nextSms ? prev : nextSms));
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
      const latestMap = expensesMapRef.current || expensesMap || {};
      const { nextMap, addedCount, updatedCount } = reconcileAndMergeTransactions(
        latestMap,
        incomingList,
        sourceLabel
      );
      const totalChanges = addedCount + updatedCount;
      if (totalChanges > 0 && typeof onUpdateExpenses === 'function') {
        expensesMapRef.current = nextMap;
        // Only show a toast notice when brand-new transactions are captured (prevents periodic layout/toast jitter)
        const noticeText =
          addedCount > 0
            ? `📲 Captured ${addedCount} new payment/deposit transaction${addedCount === 1 ? '' : 's'}`
            : '';
        onUpdateExpenses(nextMap, noticeText);
      }
      return addedCount;
    },
    [expensesMap, onUpdateExpenses]
  );

  useEffect(() => {
    const onMobileTxEvent = (ev) => {
      const detail = ev?.detail;
      setIsScanning((prev) => (prev ? false : prev));
      if (!detail) return;
      if (typeof detail.notifGranted === 'boolean') {
        setNotifGranted((prev) => (prev === detail.notifGranted ? prev : detail.notifGranted));
      }
      if (typeof detail.smsGranted === 'boolean') {
        setSmsGranted((prev) => (prev === detail.smsGranted ? prev : detail.smsGranted));
      }
      if (hasLinkedEmail) {
        syncSavedBankBalanceFromNative();
        const txList = Array.isArray(detail.transactions) ? detail.transactions : [];
        if (txList.length > 0) {
          const added = mergeDetectedTransactions(txList, 'android-notif');
          if (added > 0) {
            setScanStatus(`✅ Synced ${added} new transaction${added === 1 ? '' : 's'} into your ledger.`);
          } else {
            setScanStatus(`✅ Synced ${txList.length} saved transaction${txList.length === 1 ? '' : 's'}.`);
          }
        }
      }
    };
    window.addEventListener('pattan-mobile-transactions', onMobileTxEvent);
    return () => window.removeEventListener('pattan-mobile-transactions', onMobileTxEvent);
  }, [mergeDetectedTransactions, syncSavedBankBalanceFromNative, hasLinkedEmail]);

  // Continuous zero-fetch auto-sync of encrypted notification captures & bank balance (every 2.5s + focus)
  useEffect(() => {
    const syncNativeNow = () => {
      checkNativePermissions();
      if (!hasLinkedEmail) return;
      syncSavedBankBalanceFromNative();
      try {
        if (window.PattanBiometric && typeof window.PattanBiometric.getSavedMobileTransactionsJson === 'function') {
          const savedRaw = window.PattanBiometric.getSavedMobileTransactionsJson() || '[]';
          if (savedRaw !== lastSavedNativeRawRef.current) {
            lastSavedNativeRawRef.current = savedRaw;
            const savedArr = JSON.parse(savedRaw);
            if (Array.isArray(savedArr) && savedArr.length > 0) {
              mergeDetectedTransactions(savedArr, 'android-saved-notif');
            }
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
  }, [checkNativePermissions, mergeDetectedTransactions, syncSavedBankBalanceFromNative, hasLinkedEmail]);

  // Automatically trigger full native scan the moment Notification Access is granted (zero manual fetch required)
  useEffect(() => {
    if (notifGranted) {
      try {
        if (window.PattanBiometric && typeof window.PattanBiometric.scanMobileTransactions === 'function') {
          window.PattanBiometric.scanMobileTransactions(3650);
        }
      } catch (_) {}
    }
  }, [notifGranted]);

  const todayIso = getTodayIso();

  // Filter by Date / Month / Year state (defaults to 'all' = All Recent so yesterday/last-day transactions are always visible!)
  const [periodFilterMode, setPeriodFilterMode] = useState('all'); // 'all' | 'today' | 'yesterday' | 'date' | 'month' | 'year'
  const [filterSpecificDate, setFilterSpecificDate] = useState(() => {
    const tObj = new Date(`${todayIso}T12:00:00`);
    const yObj = new Date(tObj.getTime() - 86400000);
    return `${yObj.getFullYear()}-${String(yObj.getMonth() + 1).padStart(2, '0')}-${String(yObj.getDate()).padStart(2, '0')}`;
  });
  const [filterMonthPart, setFilterMonthPart] = useState(() => String(selectedMonth || todayIso).slice(5, 7) || '10');
  const [filterYearPart, setFilterYearPart] = useState(() => String(selectedMonth || todayIso).slice(0, 4) || '2026');
  const [quickDateAmount, setQuickDateAmount] = useState('');
  const [quickDateMerchant, setQuickDateMerchant] = useState('');
  const [quickDateType, setQuickDateType] = useState('debit');

  const yesterdayIsoCalculated = useMemo(() => {
    const tObj = new Date(`${todayIso}T12:00:00`);
    const yObj = new Date(tObj.getTime() - 86400000);
    return `${yObj.getFullYear()}-${String(yObj.getMonth() + 1).padStart(2, '0')}-${String(yObj.getDate()).padStart(2, '0')}`;
  }, [todayIso]);

  const activeTargetDateIso = useMemo(() => {
    if (periodFilterMode === 'yesterday') return yesterdayIsoCalculated;
    if (periodFilterMode === 'date' && filterSpecificDate) return filterSpecificDate;
    return todayIso;
  }, [periodFilterMode, yesterdayIsoCalculated, filterSpecificDate, todayIso]);

  const triggerMobileTransactionScan = async (daysToScanInput = 3650) => {
    const daysToScan = typeof daysToScanInput === 'number' && daysToScanInput > 0 ? daysToScanInput : 3650;
    let effectiveEmail = String(activeAccountEmail || '').trim().toLowerCase();
    if (!effectiveEmail && emailDraftInput.trim()) {
      let draft = emailDraftInput.trim().toLowerCase();
      if (!draft.includes('@')) draft = `${draft}@gmail.com`;
      effectiveEmail = draft;
      if (typeof onQuickLinkEmail === 'function') {
        onQuickLinkEmail(draft);
      }
    }
    if (!hasLinkedEmail && !effectiveEmail) {
      setScanStatus('📧 Enter your Gmail above & tap Sync Account first.');
      return;
    }

    setIsScanning(true);
    checkNativePermissions();
    syncSavedBankBalanceFromNative();

    let totalSyncedCount = 0;

    // 1. Pull from Android Keystore Encrypted Permanent Vault
    try {
      const encStore = loadEncryptedExpenseStore();
      const encMap = encStore?.expensesMap || encStore?.expenses;
      if (encMap && typeof encMap === 'object') {
        const encList = Object.values(encMap).filter((x) => x && typeof x === 'object' && !x._deleted);
        if (encList.length > 0) {
          totalSyncedCount += encList.length;
          mergeDetectedTransactions(encList, 'encrypted-vault-sync');
        }
      }
    } catch (_) {}

    // 2. Pull from Native Profile Vault for linked email
    try {
      if (effectiveEmail && window.PattanBiometric && typeof window.PattanBiometric.getProfileVaultJson === 'function') {
        const profRaw = window.PattanBiometric.getProfileVaultJson(effectiveEmail);
        if (profRaw && profRaw !== '{}') {
          const profObj = JSON.parse(profRaw);
          if (profObj?.expenses && typeof profObj.expenses === 'object') {
            const profList = Object.values(profObj.expenses).filter((x) => x && typeof x === 'object' && !x._deleted);
            if (profList.length > 0) {
              totalSyncedCount += profList.length;
              mergeDetectedTransactions(profList, 'profile-vault-sync');
            }
          }
        }
      }
    } catch (_) {}

    // 3. Pull from Native Captured Notifications Store
    try {
      if (window.PattanBiometric && typeof window.PattanBiometric.getSavedMobileTransactionsJson === 'function') {
        const savedRaw = window.PattanBiometric.getSavedMobileTransactionsJson();
        const savedArr = JSON.parse(savedRaw || '[]');
        if (Array.isArray(savedArr) && savedArr.length > 0) {
          totalSyncedCount += savedArr.length;
          mergeDetectedTransactions(savedArr, 'android-saved-notif');
        }
      }
    } catch (_) {}

    // 4. Auto-detect any copied Bank / UPI SMS in Clipboard for the selected Date / Last Day
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        const clipText = await navigator.clipboard.readText();
        if (clipText && clipText.trim().length >= 8) {
          const targetTs = new Date(`${activeTargetDateIso}T12:00:00`).getTime() || Date.now();
          const lines = clipText.split(/\r?\n\s*\r?\n|\r?\n(?=(?:Rs\.?|INR|₹|Dear|Your\s+A\/c|Paid|Received|Sent|Debited|Credited))/i);
          const parsedClipItems = [];
          for (const chunk of lines) {
            const p = parseSmsOrUpiTextJs(chunk.trim(), targetTs, 'clipboard-sync');
            if (p && p.amount > 0) {
              parsedClipItems.push(p);
            }
          }
          if (parsedClipItems.length > 0) {
            totalSyncedCount += parsedClipItems.length;
            mergeDetectedTransactions(parsedClipItems, 'clipboard-sync');
          }
        }
      }
    } catch (_) {}

    // 5. Trigger Native Async Status-Bar + Vault Sweep
    try {
      if (window.PattanBiometric && typeof window.PattanBiometric.scanMobileTransactions === 'function') {
        window.PattanBiometric.scanMobileTransactions(daysToScan);
        setTimeout(() => setIsScanning(false), 900);
        setScanStatus(
          totalSyncedCount > 0
            ? `✅ Synced ${totalSyncedCount} transaction record(s) for ${effectiveEmail || 'your account'}.`
            : `🔄 Scanned notifications & vault for ${activeTargetDateIso}. Use Quick Sync below to add past-day payments.`
        );
        return;
      }
      if (window.PattanBiometric && typeof window.PattanBiometric.scanMobileSmsInbox === 'function') {
        window.PattanBiometric.scanMobileSmsInbox(daysToScan);
        setTimeout(() => setIsScanning(false), 900);
        return;
      }
    } catch (_) {}

    setIsScanning(false);
    setScanStatus('✅ Synced all real transactions in your permanent ledger.');
  };

  const effectiveExpensesSource = useMemo(() => {
    if (!hasLinkedEmail) return {};
    const cleanMap = {};
    if (expensesMap && typeof expensesMap === 'object') {
      for (const [k, v] of Object.entries(expensesMap)) {
        const keyStr = String(k || v?.id || '');
        const srcStr = String(v?.source || '').toLowerCase();
        const refStr = String(v?.refId || '');
        if (
          v &&
          typeof v === 'object' &&
          !v._demoPreview &&
          !v.isDemoPreview &&
          srcStr !== 'demo-preview' &&
          srcStr !== 'owner-master-vault' &&
          !keyStr.startsWith('demo_tx_') &&
          !keyStr.startsWith('tx_yasin_master_') &&
          refStr !== 'OTP1821202619' &&
          refStr !== 'SAL1013202612'
        ) {
          const restored = { ...v };
          delete restored._deleted;
          cleanMap[k] = restored;
        }
      }
    }
    return cleanMap;
  }, [expensesMap, hasLinkedEmail]);

  const effectiveBankBalanceInfo = useMemo(() => {
    if (!hasLinkedEmail || !isOwnerAccount) return null;
    return bankBalanceInfo;
  }, [hasLinkedEmail, isOwnerAccount, bankBalanceInfo]);

  const analytics = useMemo(
    () =>
      computeExpenseAnalytics(effectiveExpensesSource, {
        selectedMonth: `${filterYearPart}-${filterMonthPart}`,
        todayIso,
        monthlyNetSalary: effectiveMonthlySalary,
        bankBalanceInfo: effectiveBankBalanceInfo,
      }),
    [effectiveExpensesSource, filterYearPart, filterMonthPart, todayIso, effectiveMonthlySalary, effectiveBankBalanceInfo]
  );

  // Period-filtered real transactions (All Recent, Today, Last Day / Yesterday, By Date, By Month, By Year)
  const periodFilteredList = useMemo(() => {
    const allReal = analytics.allActiveList || [];
    if (periodFilterMode === 'today') {
      return allReal.filter((tx) => tx.date === todayIso);
    }
    if (periodFilterMode === 'yesterday') {
      return allReal.filter((tx) => tx.date === analytics.yesterdayIso);
    }
    if (periodFilterMode === 'date') {
      return allReal.filter((tx) => tx.date === filterSpecificDate);
    }
    if (periodFilterMode === 'month') {
      const ymPrefix = `${filterYearPart}-${filterMonthPart}`;
      return allReal.filter((tx) => String(tx.date || '').startsWith(ymPrefix));
    }
    if (periodFilterMode === 'year') {
      return allReal.filter((tx) => String(tx.date || '').startsWith(String(filterYearPart)));
    }
    return allReal;
  }, [analytics.allActiveList, analytics.yesterdayIso, periodFilterMode, todayIso, filterSpecificDate, filterYearPart, filterMonthPart]);

  const periodSummary = useMemo(() => {
    let spent = 0;
    let received = 0;
    for (const tx of periodFilteredList) {
      const amt = Number(tx.amount) || 0;
      if (tx.type === 'credit' || tx.type === 'refund') received += amt;
      else spent += amt;
    }
    const label =
      periodFilterMode === 'today'
        ? `Today (${todayIso})`
        : periodFilterMode === 'yesterday'
          ? `Last Day / Yesterday (${analytics.yesterdayIso})`
          : periodFilterMode === 'date'
            ? `Date: ${filterSpecificDate}`
            : periodFilterMode === 'month'
              ? `Month: ${filterYearPart}-${filterMonthPart}`
              : periodFilterMode === 'year'
                ? `Year: ${filterYearPart}`
                : 'All Recent Transactions';
    return {
      spent: Number(spent.toFixed(2)),
      received: Number(received.toFixed(2)),
      count: periodFilteredList.length,
      label,
    };
  }, [periodFilteredList, periodFilterMode, todayIso, analytics.yesterdayIso, filterSpecificDate, filterYearPart, filterMonthPart]);

  // Recent payments list: reflects the selected Date/Month/Year filter (defaults to All Recent so yesterday's transactions always show!)
  const recentPaymentsList = useMemo(() => periodFilteredList, [periodFilteredList]);

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

  // Filtered Transactions for Screen 8 (uses periodFilteredList so Date/Month/Year filter applies everywhere)
  const sourceTransactionsForList = useMemo(() => periodFilteredList, [periodFilteredList]);

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
    const combined = { ...(expensesMap || {}), ...(expensesMapRef.current || {}) };
    for (const [k, v] of Object.entries(combined)) {
      const keyStr = String(k || v?.id || '');
      const srcStr = String(v?.source || '').toLowerCase();
      if (
        v &&
        typeof v === 'object' &&
        !v._demoPreview &&
        !v.isDemoPreview &&
        srcStr !== 'demo-preview' &&
        srcStr !== 'owner-master-vault' &&
        !keyStr.startsWith('demo_tx_') &&
        !keyStr.startsWith('tx_yasin_master_')
      ) {
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
      setFormApp('UPI');
      setFormDate(activeTargetDateIso || todayIso);
      setFormTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
      setFormTagsInput('');
    }
    setShowAddModal(true);
  };

  const handleQuickSaveForSelectedDate = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const amt = Number(String(quickDateAmount || '').replace(/,/g, '').trim());
    if (!Number.isFinite(amt) || amt <= 0) {
      setScanStatus('⚠️ Enter an amount (₹) to save for the selected date.');
      return;
    }
    const targetDate = activeTargetDateIso || todayIso;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const baseMap = getMaterializedBaseMap();
    const txId = `tx_date_${nowMs}_${Math.random().toString(36).slice(2, 7)}`;
    const cleanText = String(quickDateMerchant || '').trim();
    const isCredit = quickDateType === 'credit';
    const merchantName = cleanText || (isCredit ? 'Deposit / Received' : 'UPI Payment');

    const record = migrateAndNormalizeExpenseRecord({
      id: txId,
      amount: Number(amt.toFixed(2)),
      currency: 'INR',
      type: isCredit ? 'credit' : 'debit',
      merchant: merchantName,
      personalNote: cleanText,
      paymentRemark: cleanText,
      note: cleanText,
      category: isCredit ? 'income' : 'food',
      paymentMethod: 'UPI',
      app: 'UPI',
      date: targetDate,
      time: '12:00',
      tags: [],
      status: 'completed',
      detectionStatus: 'user_confirmed',
      noteReviewed: Boolean(cleanText),
      source: 'date-quick-sync',
      timestampMs: new Date(`${targetDate}T12:00:00`).getTime() || nowMs,
      createdAt: nowIso,
      updatedAt: nowIso,
      updatedAtMs: nowMs,
    });
    delete record._demoPreview;
    delete record.isDemoPreview;
    delete record._deleted;

    const nextMap = { ...baseMap, [txId]: record };
    if (typeof onUpdateExpenses === 'function') {
      onUpdateExpenses(
        nextMap,
        `✅ Synced ${isCredit ? '+' : '-'}₹${formatINR(amt)} (${merchantName}) to ${targetDate}`
      );
    }
    setQuickDateAmount('');
    setQuickDateMerchant('');
    setScanStatus(`✅ Synced ${isCredit ? '+' : '-'}₹${formatINR(amt)} (${merchantName}) for ${targetDate}`);
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
    const targetTs = new Date(`${activeTargetDateIso || todayIso}T12:00:00`).getTime() || Date.now();
    const chunks = raw
      .split(/\r?\n\s*\r?\n|\r?\n(?=(?:Rs\.?|INR|₹|Dear|Your\s+A\/c|Paid|Received|Sent|Debited|Credited))/i)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedItems = [];
    for (const chunk of (chunks.length > 0 ? chunks : [raw])) {
      const p = parseSmsOrUpiTextJs(chunk, targetTs);
      if (p && p.amount > 0) {
        parsedItems.push(p);
      }
    }
    const parsed = parsedItems[0] || parseSmsOrUpiTextJs(raw, targetTs);
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
    const itemsToMerge = parsedItems.length > 0 ? parsedItems : [parsed];
    mergeDetectedTransactions(itemsToMerge, 'sms-paste');
    setSmsPasteText('');
    setShowSmsPasteModal(false);
    const sign = parsed.type === 'credit' || parsed.type === 'refund' ? '+' : '-';
    setScanStatus(
      itemsToMerge.length > 1
        ? `✅ Synced ${itemsToMerge.length} transactions for ${parsed.date}`
        : `✅ Added ${sign}₹${formatINR(parsed.amount)} (${parsed.merchant}) for ${parsed.date}`
    );
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

        {/* Centered Avatar & Amount Hero (Screen 9) */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 20 }}>
          <BrandPaymentAvatar tx={selectedTx} size={64} />
          <div style={{ fontSize: 18, fontWeight: 900, color: palette.text, marginTop: 10 }}>
            {selectedTx.merchant || sanitizeBrandFreeAppLabel(selectedTx.app)}
          </div>
          <div style={{ fontSize: 12, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
            {sanitizeBrandFreeAppLabel(selectedTx.app || selectedTx.paymentMethod)}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, color: palette.text, overflowAnchor: 'none' }}>
      {/* Flutter Material 3 Segmented Sub-Navigation Bar */}
      <div style={{
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        padding: '4px',
        borderRadius: 14,
        background: isLight ? '#f1f5f9' : '#111827',
        border: `1px solid ${palette.border}`,
      }}>
        {[
          { id: 'overview', label: '🏠 Overview' },
          { id: 'transactions', label: `📜 Passbook (${analytics.allTimeCount || analytics.totalCount || 0})` },
          { id: 'insights', label: '📊 Insights' },
          { id: 'missing-notes', label: `📝 Notes (${analytics.missingNotesCount})` },
          { id: 'settings', label: '⚙️ Sync & CSV' },
        ].map((tab) => {
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              style={{
                flex: '1 0 auto',
                padding: '8px 13px',
                borderRadius: 10,
                border: active ? '1px solid rgba(99, 102, 241, 0.45)' : '1px solid transparent',
                background: active
                  ? 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)'
                  : 'transparent',
                color: active ? '#ffffff' : palette.textMuted,
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: active ? '0 4px 12px rgba(99, 102, 241, 0.28)' : 'none',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Empty-First Onboarding Prompt (Hidden once email is linked so there is zero duplicate clutter) */}
      {!hasLinkedEmail && (
        <div
          className="flutter-m3-card"
          style={{
            padding: '12px 14px',
            borderRadius: 16,
            background: isLight ? '#ffffff' : '#131b2e',
            border: '1px solid rgba(99, 102, 241, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: isLight ? '#0f172a' : '#e2e8f0' }}>
              🔒 Enter your email to sync your real transactions &amp; bank balance
            </div>
            {typeof onOpenChangeMobile === 'function' && (
              <button
                type="button"
                onClick={onOpenChangeMobile}
                style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: '1px solid rgba(99, 102, 241, 0.4)',
                  background: 'rgba(99, 102, 241, 0.14)',
                  color: '#818cf8',
                  fontSize: 10.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                📱 Account Sync
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input
              type="email"
              value={emailDraftInput}
              onChange={(e) => setEmailDraftInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && emailDraftInput.trim() && typeof onQuickLinkEmail === 'function') {
                  onQuickLinkEmail(emailDraftInput.trim());
                }
              }}
              placeholder="Enter patanyasin144@gmail.com to sync..."
              style={{
                flex: '1 1 200px',
                padding: '9px 12px',
                borderRadius: 11,
                border: `1px solid ${palette.border}`,
                background: palette.surfaceAlt,
                color: palette.text,
                fontSize: 12,
                fontWeight: 700,
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (emailDraftInput.trim() && typeof onQuickLinkEmail === 'function') {
                  onQuickLinkEmail(emailDraftInput.trim());
                } else if (typeof onOpenChangeMobile === 'function') {
                  onOpenChangeMobile();
                }
              }}
              style={{
                padding: '9px 15px',
                borderRadius: 11,
                border: 'none',
                background: 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Sync Account
            </button>
          </div>
        </div>
      )}

      {/* 1-Tap Auto UPI Payment Capture Prompt when Notification Access is off */}
      {!notifGranted && !notifBannerDismissed && typeof window !== 'undefined' && window.PattanBiometric && (
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div>
              🔔 <strong>Android 13–16 Restricted Setting Fix:</strong> If Android says <em>&ldquo;Controlled by Restricted Setting&rdquo;</em>, tap <strong>Step 1 (Open App Info)</strong> → tap <strong>⋮ (top-right)</strong> → tap <strong>Allow restricted settings</strong>, then tap <strong>Step 2 (Enable Notification Access)</strong>.
            </div>
            <button
              type="button"
              onClick={() => setNotifBannerDismissed(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                fontWeight: 900,
                fontSize: 14,
                cursor: 'pointer',
                padding: '0 4px',
              }}
              title="Dismiss"
            >
              ✕
            </button>
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
          background: isLight ? '#eef2ff' : 'rgba(30, 41, 59, 0.95)',
          border: '1px solid rgba(99, 102, 241, 0.4)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          fontSize: 12,
          fontWeight: 700,
          color: isLight ? '#312e81' : '#e0e7ff',
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
                  background: '#6366f1',
                  color: '#ffffff',
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
          FLUTTER MATERIAL 3 HERO: REAL BANK BALANCE & QUICK ACTIONS
         ═══════════════════════════════════════════════════════════════════════ */}
      {(subTab === 'overview' || subTab === 'transactions') && (
        <div
          className="flutter-m3-card"
          style={{
            padding: mobileMode ? '16px 14px' : '18px 20px',
            borderRadius: 22,
            background: isLight
              ? 'linear-gradient(135deg, #1e1b4b 0%, #1e3a8a 60%, #0f172a 100%)'
              : 'linear-gradient(135deg, #161f38 0%, #111827 60%, #0b0f19 100%)',
            border: '1px solid rgba(99, 102, 241, 0.28)',
            color: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#a5b4fc',
                  background: 'rgba(99, 102, 241, 0.18)',
                  border: '1px solid rgba(99, 102, 241, 0.35)',
                  padding: '3px 9px',
                  borderRadius: 999,
                }}>
                  🏦 Real Bank Account Balance
                </span>
                {(bankBalanceInfo?.accountMask || analytics.bankBalanceSource) && (
                  <span style={{
                    fontSize: 11,
                    fontWeight: 800,
                    color: '#34d399',
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'rgba(16, 185, 129, 0.14)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                  }}>
                    {bankBalanceInfo?.bankName || 'Bank A/c'} {bankBalanceInfo?.accountMask ? `(${bankBalanceInfo.accountMask})` : ''}
                  </span>
                )}
              </div>
              <div style={{
                fontSize: mobileMode ? 30 : 34,
                fontWeight: 900,
                color: '#ffffff',
                letterSpacing: '-0.02em',
                marginTop: 6,
                lineHeight: 1.1,
              }}>
                ₹{formatINR(analytics.realAccountBalance)}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginTop: 4 }}>
                {hasLinkedEmail
                  ? <>Auto-adjusts on every payment (<strong style={{ color: '#fb7185' }}>-₹</strong>) &amp; deposit (<strong style={{ color: '#34d399' }}>+₹</strong>)</>
                  : '🔒 Link your email to sync your real bank balance'}
              </div>
            </div>

            <button
              type="button"
              onClick={openCheckBalanceModal}
              style={{
                padding: '9px 14px',
                borderRadius: 12,
                border: '1px solid rgba(99, 102, 241, 0.45)',
                background: 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
                boxShadow: '0 6px 16px rgba(99, 102, 241, 0.3)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              🏦 Check Balance
            </button>
          </div>

          {/* Flutter M3 4-Button Quick Action Row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 8,
          }}>
            <button
              type="button"
              className="flutter-m3-action-chip"
              onClick={() => openQuickAddModal(null, 'debit')}
              style={{
                color: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
                cursor: 'pointer',
                padding: '9px 4px',
              }}
            >
              <span style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                background: 'rgba(244, 63, 94, 0.18)',
                color: '#fb7185',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 17,
              }}>
                ↗️
              </span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#e2e8f0', textAlign: 'center', lineHeight: 1.15 }}>
                Add Payment
              </span>
            </button>

            <button
              type="button"
              className="flutter-m3-action-chip"
              onClick={() => openQuickAddModal(null, 'credit')}
              style={{
                color: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
                cursor: 'pointer',
                padding: '9px 4px',
              }}
            >
              <span style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                background: 'rgba(16, 185, 129, 0.18)',
                color: '#34d399',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 17,
              }}>
                ↙️
              </span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#e2e8f0', textAlign: 'center', lineHeight: 1.15 }}>
                Add Deposit
              </span>
            </button>

            <button
              type="button"
              className="flutter-m3-action-chip"
              onClick={() => triggerMobileTransactionScan(3650)}
              style={{
                color: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
                cursor: 'pointer',
                padding: '9px 4px',
              }}
            >
              <span style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                background: 'rgba(56, 189, 248, 0.18)',
                color: '#38bdf8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 17,
              }}>
                🔄
              </span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#e2e8f0', textAlign: 'center', lineHeight: 1.15 }}>
                Sync Alerts
              </span>
            </button>

            <button
              type="button"
              className="flutter-m3-action-chip"
              onClick={() => setShowSmsPasteModal(true)}
              style={{
                color: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
                cursor: 'pointer',
                padding: '9px 4px',
              }}
            >
              <span style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                background: 'rgba(99, 102, 241, 0.2)',
                color: '#a5b4fc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 17,
              }}>
                📋
              </span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: '#e2e8f0', textAlign: 'center', lineHeight: 1.15 }}>
                Paste SMS
              </span>
            </button>
          </div>

          {/* 4-Column Period Summary Strip: Today | Last Day | Month | All Recent */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: mobileMode ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
            gap: 8,
          }}>
            <div
              onClick={() => setPeriodFilterMode('today')}
              style={{
                padding: '8px 10px',
                borderRadius: 12,
                background: periodFilterMode === 'today' ? 'rgba(99, 102, 241, 0.22)' : 'rgba(15, 23, 42, 0.65)',
                border: periodFilterMode === 'today' ? '1px solid #818cf8' : '1px solid rgba(148, 163, 184, 0.14)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#cbd5e1', textTransform: 'uppercase' }}>
                📍 Today ({analytics.todayCount || 0})
              </div>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#fb7185', marginTop: 2 }}>
                -₹{formatINR(analytics.todaySpent)}
              </div>
              <div style={{ fontSize: 9.5, color: '#34d399', fontWeight: 700 }}>
                In: +₹{formatINRShort(analytics.todayReceived)}
              </div>
            </div>

            <div
              onClick={() => setPeriodFilterMode('yesterday')}
              style={{
                padding: '8px 10px',
                borderRadius: 12,
                background: periodFilterMode === 'yesterday' ? 'rgba(99, 102, 241, 0.22)' : 'rgba(15, 23, 42, 0.65)',
                border: periodFilterMode === 'yesterday' ? '1px solid #818cf8' : '1px solid rgba(148, 163, 184, 0.14)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#a5b4fc', textTransform: 'uppercase' }}>
                ⏮️ Last Day ({analytics.yesterdayCount || 0})
              </div>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#ffffff', marginTop: 2 }}>
                -₹{formatINR(analytics.yesterdaySpent || 0)}
              </div>
              <div style={{ fontSize: 9.5, color: '#34d399', fontWeight: 700 }}>
                In: +₹{formatINRShort(analytics.yesterdayReceived || 0)}
              </div>
            </div>

            <div
              onClick={() => setPeriodFilterMode('month')}
              style={{
                padding: '8px 10px',
                borderRadius: 12,
                background: periodFilterMode === 'month' ? 'rgba(99, 102, 241, 0.22)' : 'rgba(15, 23, 42, 0.65)',
                border: periodFilterMode === 'month' ? '1px solid #818cf8' : '1px solid rgba(148, 163, 184, 0.14)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#cbd5e1', textTransform: 'uppercase' }}>
                🗓️ Month ({analytics.totalCount || 0})
              </div>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#fb7185', marginTop: 2 }}>
                -₹{formatINR(analytics.netSpending)}
              </div>
              <div style={{ fontSize: 9.5, color: '#34d399', fontWeight: 700 }}>
                In: +₹{formatINRShort(analytics.totalIncome)}
              </div>
            </div>

            <div
              onClick={() => setPeriodFilterMode('all')}
              style={{
                padding: '8px 10px',
                borderRadius: 12,
                background: periodFilterMode === 'all' ? 'rgba(99, 102, 241, 0.22)' : 'rgba(15, 23, 42, 0.65)',
                border: periodFilterMode === 'all' ? '1px solid #818cf8' : '1px solid rgba(148, 163, 184, 0.14)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 9.5, fontWeight: 800, color: '#34d399', textTransform: 'uppercase' }}>
                ⚡ All Recent ({analytics.allTimeCount || 0})
              </div>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#34d399', marginTop: 2 }}>
                +₹{formatINR(analytics.allTimeReceived)}
              </div>
              <div style={{ fontSize: 9.5, color: '#fb7185', fontWeight: 700 }}>
                Out: -₹{formatINRShort(analytics.allTimeSpent)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          📅 FILTER & SYNC TRANSACTIONS BY DATE · MONTH · YEAR (FLUTTER M3)
         ═══════════════════════════════════════════════════════════════════════ */}
      {(subTab === 'overview' || subTab === 'transactions') && (
        <div
          className="flutter-m3-card"
          style={{
            padding: '12px 14px',
            borderRadius: 18,
            background: palette.surface,
            border: `1px solid ${palette.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: palette.text, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>📅 Filter &amp; Sync by Date · Month · Year</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => triggerMobileTransactionScan(3650)}
                disabled={isScanning}
                style={{
                  padding: '5px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(99, 102, 241, 0.4)',
                  background: 'rgba(99, 102, 241, 0.15)',
                  color: isLight ? '#4f46e5' : '#a5b4fc',
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {isScanning ? '⏳ Syncing...' : '🔄 Sync Transactions'}
              </button>
              <button
                type="button"
                onClick={() => openQuickAddModal(null, 'debit')}
                style={{
                  padding: '5px 11px',
                  borderRadius: 999,
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  background: 'rgba(16, 185, 129, 0.14)',
                  color: '#34d399',
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                + Record for {activeTargetDateIso}
              </button>
            </div>
          </div>

          {/* Filter Mode Pills */}
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
            {[
              { id: 'all', label: `⚡ All Recent (${analytics.allTimeCount || 0})` },
              { id: 'today', label: `📍 Today (${analytics.todayCount || 0})` },
              { id: 'yesterday', label: `⏮️ Last Day (${analytics.yesterdayCount || 0})` },
              { id: 'date', label: '📅 By Date' },
              { id: 'month', label: '🗓️ By Month' },
              { id: 'year', label: '📆 By Year' },
            ].map((m) => {
              const active = periodFilterMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setPeriodFilterMode(m.id)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 999,
                    border: active ? '1px solid rgba(99, 102, 241, 0.5)' : `1px solid ${palette.border}`,
                    background: active ? 'linear-gradient(135deg, #6366f1, #3b82f6)' : palette.surfaceAlt,
                    color: active ? '#ffffff' : palette.textSub,
                    fontWeight: 800,
                    fontSize: 11.5,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {/* Date / Month / Year Pickers (Always accessible when filtering by Last Day, Date, Month, or Year) */}
          {(periodFilterMode === 'yesterday' || periodFilterMode === 'date' || periodFilterMode === 'month' || periodFilterMode === 'year') && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: '1 1 140px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Date:</span>
                <input
                  type="date"
                  value={periodFilterMode === 'yesterday' ? yesterdayIso : filterSpecificDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val) {
                      setFilterSpecificDate(val);
                      setPeriodFilterMode('date');
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: '6px 9px',
                    borderRadius: 9,
                    border: (periodFilterMode === 'date' || periodFilterMode === 'yesterday') ? '1px solid #6366f1' : `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: '1 1 130px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Month:</span>
                <select
                  value={filterMonthPart}
                  onChange={(e) => {
                    setFilterMonthPart(e.target.value);
                    setPeriodFilterMode('month');
                  }}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    borderRadius: 9,
                    border: periodFilterMode === 'month' ? '1px solid #6366f1' : `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                >
                  {[
                    { v: '01', l: 'Jan (01)' },
                    { v: '02', l: 'Feb (02)' },
                    { v: '03', l: 'Mar (03)' },
                    { v: '04', l: 'Apr (04)' },
                    { v: '05', l: 'May (05)' },
                    { v: '06', l: 'Jun (06)' },
                    { v: '07', l: 'Jul (07)' },
                    { v: '08', l: 'Aug (08)' },
                    { v: '09', l: 'Sep (09)' },
                    { v: '10', l: 'Oct (10)' },
                    { v: '11', l: 'Nov (11)' },
                    { v: '12', l: 'Dec (12)' },
                  ].map((m) => (
                    <option key={m.v} value={m.v}>{m.l}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: '1 1 110px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>Year:</span>
                <select
                  value={filterYearPart}
                  onChange={(e) => {
                    setFilterYearPart(e.target.value);
                    if (periodFilterMode !== 'month') {
                      setPeriodFilterMode('year');
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    borderRadius: 9,
                    border: (periodFilterMode === 'year' || periodFilterMode === 'month') ? '1px solid #6366f1' : `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                >
                  {['2027', '2026', '2025', '2024', '2023'].map((yr) => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Inline Quick Sync / Add Transaction for Selected Date (Last Day / Specific Date / Today) */}
          <div style={{
            padding: '8px 10px',
            borderRadius: 12,
            background: palette.surfaceAlt,
            border: `1px solid ${palette.border}`,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: palette.textSub, whiteSpace: 'nowrap' }}>
              ⚡ Quick Add ({activeTargetDateIso}):
            </span>
            <input
              type="number"
              inputMode="decimal"
              value={quickDateAmount}
              onChange={(e) => setQuickDateAmount(e.target.value)}
              placeholder="₹ Amount"
              style={{
                width: 92,
                padding: '6px 8px',
                borderRadius: 8,
                border: `1px solid ${palette.borderStrong}`,
                background: palette.surface,
                color: palette.text,
                fontSize: 11.5,
                fontWeight: 800,
              }}
            />
            <input
              type="text"
              value={quickDateMerchant}
              onChange={(e) => setQuickDateMerchant(e.target.value)}
              placeholder="Merchant / Note (optional)"
              style={{
                flex: '1 1 120px',
                minWidth: 110,
                padding: '6px 8px',
                borderRadius: 8,
                border: `1px solid ${palette.borderStrong}`,
                background: palette.surface,
                color: palette.text,
                fontSize: 11.5,
                fontWeight: 700,
              }}
            />
            <button
              type="button"
              onClick={() => handleQuickSaveForSelectedDate('debit')}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid rgba(244, 63, 94, 0.45)',
                background: 'rgba(244, 63, 94, 0.16)',
                color: '#fb7185',
                fontWeight: 800,
                fontSize: 11,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              -₹ Spent
            </button>
            <button
              type="button"
              onClick={() => handleQuickSaveForSelectedDate('credit')}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid rgba(16, 185, 129, 0.45)',
                background: 'rgba(16, 185, 129, 0.16)',
                color: '#34d399',
                fontWeight: 800,
                fontSize: 11,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              +₹ In
            </button>
            <button
              type="button"
              onClick={() => setShowSmsPasteModal(true)}
              style={{
                padding: '6px 9px',
                borderRadius: 8,
                border: `1px solid ${palette.borderStrong}`,
                background: palette.surface,
                color: palette.textSub,
                fontWeight: 800,
                fontSize: 11,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              📋 Paste SMS
            </button>
          </div>

          {/* Active Period Summary Strip */}
          <div style={{
            padding: '7px 11px',
            borderRadius: 10,
            background: isLight ? '#eef2ff' : 'rgba(99, 102, 241, 0.1)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            fontSize: 11.5,
            fontWeight: 700,
          }}>
            <span style={{ color: palette.text }}>
              📌 <strong>{periodSummary.label}:</strong> {periodSummary.count} real txn{periodSummary.count === 1 ? '' : 's'}
            </span>
            <div style={{ display: 'flex', gap: 10, fontWeight: 800, alignItems: 'center' }}>
              <span style={{ color: '#fb7185' }}>Out: -₹{formatINR(periodSummary.spent)}</span>
              <span style={{ color: '#34d399' }}>In: +₹{formatINR(periodSummary.received)}</span>
              {periodSummary.count === 0 && (analytics.allTimeCount || 0) > 0 && (
                <button
                  type="button"
                  onClick={() => setPeriodFilterMode('all')}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 999,
                    border: '1px solid rgba(99, 102, 241, 0.45)',
                    background: '#6366f1',
                    color: '#ffffff',
                    fontSize: 10.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  Show All ({analytics.allTimeCount})
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SCREEN 7: EXPENSE OVERVIEW (FLUTTER MATERIAL 3 PASSBOOK)
         ═══════════════════════════════════════════════════════════════════════ */}
      {subTab === 'overview' && (
        <>
          {/* Compact Flutter M3 Month & Salary Summary Card */}
          <div
            className="flutter-m3-card"
            style={{
              padding: mobileMode ? '14px' : '16px 18px',
              borderRadius: 18,
              background: palette.surface,
              border: `1px solid ${palette.border}`,
              color: palette.text,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Total Spent (This Month)
              </div>
              <div style={{ fontSize: mobileMode ? 22 : 26, fontWeight: 900, marginTop: 2, color: palette.text }}>
                ₹{formatINR(analytics.netSpending)}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: palette.textSub, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span>{analytics.totalCount} Month Txns</span>
                <span>·</span>
                <span>Last Day: ₹{formatINRShort(analytics.yesterdaySpent || 0)}</span>
                <span>·</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ color: '#10b981' }}>Salary Left: {salaryVisible ? `₹${formatINRShort(remainingSalary)}` : '₹••••••'}</span>
                  {typeof onToggleSalaryVisibility === 'function' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSalaryVisibility();
                      }}
                      style={{
                        padding: '2px 7px',
                        borderRadius: 999,
                        border: `1px solid ${palette.border}`,
                        background: palette.surfaceAlt,
                        color: palette.text,
                        fontSize: 10.5,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {salaryVisible ? '🙈' : '👁️'}
                    </button>
                  )}
                </span>
              </div>
            </div>

            {/* 4 Category Pills */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {screen7CategoryCards.map((cat) => (
                <button
                  key={cat.label}
                  type="button"
                  onClick={() => {
                    setFilterCategory(cat.id);
                    setSubTab('transactions');
                  }}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 10,
                    background: palette.surfaceAlt,
                    border: `1px solid ${palette.border}`,
                    color: palette.textSub,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {cat.label}: ₹{formatINRShort(cat.amount)}
                </button>
              ))}
            </div>
          </div>

          {/* 🧠 Ask Expense Memory (Natural-Language Q&A with Smart Question Chips) */}
          <div style={{
            padding: '14px 16px',
            borderRadius: 18,
            background: palette.surface,
            border: `1px solid ${palette.border}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: isLight ? '#4f46e5' : '#818cf8' }}>
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
                  background: '#6366f1',
                  color: '#ffffff',
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
                    background: nlQuery === chip ? 'rgba(99, 102, 241, 0.18)' : palette.surfaceAlt,
                    color: nlQuery === chip ? '#818cf8' : palette.textSub,
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
                background: isLight ? '#eff6ff' : 'rgba(99, 102, 241, 0.12)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                fontSize: 12.5,
                fontWeight: 700,
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
                          <strong>{m.merchant || sanitizeBrandFreeAppLabel(m.app)}</strong>
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
                      ₹{formatINRShort(tx.amount)} · {tx.merchant || sanitizeBrandFreeAppLabel(tx.app)}
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
            borderRadius: 20,
            border: `1px solid ${palette.border}`,
            padding: mobileMode ? '14px 12px' : '16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: palette.text, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span>Recent Payments (Permanent Ledger)</span>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'rgba(16, 185, 129, 0.14)',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    color: '#34d399',
                    fontSize: 10,
                    fontWeight: 800,
                  }}>
                    📜 {recentPaymentsList.length} Saved
                  </span>
                </div>
                <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 600, marginTop: 2 }}>
                  🔒 Permanent passbook · All notes &amp; edits saved
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {recentPaymentsList.length > 3 && (
                  <>
                    <button
                      type="button"
                      onClick={() => recentScrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                      style={{
                        padding: '5px 9px',
                        borderRadius: 999,
                        border: `1px solid ${palette.border}`,
                        background: palette.surfaceAlt,
                        color: palette.textSub,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                      title="Scroll to Latest (Top)"
                    >
                      ↑ Top
                    </button>
                    <button
                      type="button"
                      onClick={() => recentScrollerRef.current?.scrollTo({ top: 999999, behavior: 'smooth' })}
                      style={{
                        padding: '5px 9px',
                        borderRadius: 999,
                        border: `1px solid ${palette.border}`,
                        background: palette.surfaceAlt,
                        color: palette.textSub,
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                      title="Scroll to Oldest (Bottom)"
                    >
                      ↓ Bottom
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setSubTab('transactions')}
                  style={{
                    background: 'rgba(99, 102, 241, 0.14)',
                    border: '1px solid rgba(99, 102, 241, 0.32)',
                    borderRadius: 999,
                    padding: '5px 12px',
                    color: isLight ? '#4f46e5' : '#818cf8',
                    fontSize: 11.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  See All ({recentPaymentsList.length}) ›
                </button>
              </div>
            </div>

            {recentPaymentsList.length === 0 ? (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: palette.textMuted, fontSize: 13 }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>💳</div>
                <div style={{ fontWeight: 800, color: palette.text }}>No payments recorded yet.</div>
                <div style={{ marginTop: 4 }}>
                  Make or receive any UPI or Bank transfer, or tap <strong>➕ Add Entry</strong> and your completed payment, time, purpose &amp; amount will stay saved forever.
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => openQuickAddModal(null)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: 'none',
                      background: '#6366f1',
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
                      color: isLight ? '#4f46e5' : '#818cf8',
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
              <div
                ref={recentScrollerRef}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  maxHeight: mobileMode ? 440 : 520,
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  WebkitOverflowScrolling: 'touch',
                  paddingRight: 4,
                  scrollBehavior: 'smooth',
                }}
              >
                {recentPaymentsList.map((tx) => {
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
                      className="flutter-m3-list-tile"
                      style={{
                        padding: mobileMode ? '12px' : '14px',
                        borderRadius: 16,
                        background: palette.surfaceAlt,
                        border: isCredit ? '1px solid rgba(16, 185, 129, 0.3)' : `1px solid ${palette.border}`,
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
                                fontWeight: 800,
                                color: palette.text,
                                wordBreak: 'break-word',
                                lineHeight: 1.25,
                              }}>
                                {tx.merchant || (isCredit ? 'Bank Deposit' : 'UPI Payment')}
                              </span>
                              <span style={{
                                padding: '2px 7px',
                                borderRadius: 999,
                                fontSize: 9.5,
                                fontWeight: 800,
                                background: isCredit ? 'rgba(16, 185, 129, 0.14)' : 'rgba(244, 63, 94, 0.12)',
                                color: isCredit ? '#34d399' : '#fb7185',
                              }}>
                                {isCredit ? 'IN' : 'OUT'}
                              </span>
                            </div>
                            <div style={{
                              fontSize: 11.5,
                              color: palette.textMuted,
                              fontWeight: 600,
                              marginTop: 4,
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 6,
                              alignItems: 'center',
                            }}>
                              <span>🕒 {tx.date === todayIso ? `Today, ${formatTime12h(tx.time)}` : `${formatShortDate(tx.date)}, ${formatTime12h(tx.time)}`}</span>
                              <span>·</span>
                              <span style={{ color: '#818cf8', fontWeight: 700 }}>{sanitizeBrandFreeAppLabel(tx.app || tx.paymentMethod)}</span>
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

          {/* Inner Scroller Control Bar & Grouped Transactions List (Screen 8) */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 12,
            background: palette.surfaceAlt,
            border: `1px solid ${palette.border}`,
          }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: '#34d399' }}>
              📜 Passbook Inner Scroller · {filteredTransactions.length} Unlimited Transactions
            </span>
            {filteredTransactions.length > 3 && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => transactionsScrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                  style={{
                    padding: '4px 9px',
                    borderRadius: 999,
                    border: `1px solid ${palette.border}`,
                    background: palette.surface,
                    color: palette.textSub,
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  ↑ Top
                </button>
                <button
                  type="button"
                  onClick={() => transactionsScrollerRef.current?.scrollTo({ top: 999999, behavior: 'smooth' })}
                  style={{
                    padding: '4px 9px',
                    borderRadius: 999,
                    border: `1px solid ${palette.border}`,
                    background: palette.surface,
                    color: palette.textSub,
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  ↓ Bottom
                </button>
              </div>
            )}
          </div>

          {groupedByDay.length === 0 ? (
            <div style={{ padding: '26px 12px', textAlign: 'center', color: palette.textMuted, fontSize: 13 }}>
              Nothing matched your search. Try a different keyword or filter.
            </div>
          ) : (
            <div
              ref={transactionsScrollerRef}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                maxHeight: mobileMode ? 520 : 640,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                WebkitOverflowScrolling: 'touch',
                paddingRight: 4,
                scrollBehavior: 'smooth',
              }}
            >
              {groupedByDay.map((group) => (
                <div key={group.date} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 2,
                    background: palette.surface,
                    padding: '6px 8px',
                    borderRadius: 8,
                    borderBottom: `1px solid ${palette.border}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 12,
                    fontWeight: 800,
                    color: palette.textMuted,
                    marginTop: 2,
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
                                  {tx.merchant || (isCredit ? 'Bank Deposit' : 'UPI Payment')}
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
                                  {isCredit ? 'IN' : 'OUT'}
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
                                <span style={{ color: '#818cf8', fontWeight: 800 }}>{sanitizeBrandFreeAppLabel(tx.app || tx.paymentMethod)}</span>
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
              ))}
            </div>
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
            <>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                borderRadius: 12,
                background: palette.surfaceAlt,
                border: `1px solid ${palette.border}`,
              }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: '#fbbf24' }}>
                  📜 Inner Scroller · {filteredMissingNotes.active.length} Pending Note(s)
                </span>
                {filteredMissingNotes.active.length > 3 && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => missingNotesScrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                      style={{
                        padding: '4px 9px',
                        borderRadius: 999,
                        border: `1px solid ${palette.border}`,
                        background: palette.surface,
                        color: palette.textSub,
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      ↑ Top
                    </button>
                    <button
                      type="button"
                      onClick={() => missingNotesScrollerRef.current?.scrollTo({ top: 999999, behavior: 'smooth' })}
                      style={{
                        padding: '4px 9px',
                        borderRadius: 999,
                        border: `1px solid ${palette.border}`,
                        background: palette.surface,
                        color: palette.textSub,
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      ↓ Bottom
                    </button>
                  </div>
                )}
              </div>
              <div
                ref={missingNotesScrollerRef}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  maxHeight: mobileMode ? 480 : 580,
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  WebkitOverflowScrolling: 'touch',
                  paddingRight: 4,
                  scrollBehavior: 'smooth',
                }}
              >
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
            </>
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
                  <option value="UPI">UPI App</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Card">Debit / Credit Card</option>
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
                  placeholder="e.g. Cafe, Store, Person..."
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
                  { key: 'upi', label: 'Open UPI App (Check Bal)', bg: '#4f46e5' },
                  { key: 'bank', label: 'Sync Bank SMS Balance', bg: '#059669' },
                ].map((u) => (
                  <button
                    key={u.key}
                    type="button"
                    onClick={() => u.key === 'bank' ? triggerMobileTransactionScan(false) : handleLaunchUpiBalanceCheck(u.key, u.label)}
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

