import React, { useState, useEffect, useMemo, useCallback } from 'react';

const UDHAAR_STORAGE_KEY = 'yasin_udhaar_returnable_ledger_v1';
const UDHAAR_OTA_VERSION_KEY = 'udhaar_standalone_ota_version_v1';
const UDHAAR_OTA_BUILD_ID_KEY = 'udhaar_standalone_ota_build_id_v1';
const BUILTIN_UDHAAR_OTA_VERSION = '1.0.1';
const BUILTIN_UDHAAR_OTA_BUILD_ID = 'udhaar_ota_1_0_1_clean_simple_ui';

// Separate Dedicated Udhaar OTA Server Endpoints (Strictly isolated from Salary & OT OTA server)
const UDHAAR_OTA_BASES = [
  'https://raw.githubusercontent.com/Yasin144/female-presentator/main/ota-udhaar',
  'https://cdn.jsdelivr.net/gh/Yasin144/female-presentator@main/ota-udhaar',
];

function getTodayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getCurrentTimeHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getRelativeDateIso(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatINR(num) {
  const n = Number(num) || 0;
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function formatShortDate(iso) {
  if (!iso) return '';
  const parts = String(iso).split('-');
  if (parts.length !== 3) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  return `${d} ${months[m] || parts[1]}`;
}

function formatTime12h(hhmm) {
  if (!hhmm) return '';
  const [hStr, mStr] = String(hhmm).split(':');
  const h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mStr || '00'} ${ampm}`;
}

export default function UdhaarStandaloneApp({
  embedded = false,
  isLight: propIsLight = false,
  palette: propPalette = null,
  externalDraft = null,
  onClearExternalDraft = null,
  onShowToast = null,
}) {
  const [themeLight, setThemeLight] = useState(propIsLight);
  const isLight = embedded ? propIsLight : themeLight;

  const palette = useMemo(() => {
    if (embedded && propPalette) return propPalette;
    return isLight
      ? {
          bg: '#f1f5f9',
          surface: '#ffffff',
          surfaceAlt: '#f8fafc',
          border: '#e2e8f0',
          text: '#0f172a',
          textSub: '#334155',
          textMuted: '#64748b',
        }
      : {
          bg: '#090d16',
          surface: '#111827',
          surfaceAlt: '#1e293b',
          border: 'rgba(148, 163, 184, 0.2)',
          text: '#f8fafc',
          textSub: '#cbd5e1',
          textMuted: '#94a3b8',
        };
  }, [embedded, propPalette, isLight]);

  const [toastMsg, setToastMsg] = useState('');
  const notify = useCallback(
    (msg) => {
      if (embedded && typeof onShowToast === 'function') {
        onShowToast(msg);
      } else {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(''), 2800);
      }
    },
    [embedded, onShowToast]
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SEPARATE INDIVIDUAL UDHAAR OTA ENGINE (ota-udhaar/udhaar-ota-manifest.json)
  // Strictly isolated from Salary & OT OTA server
  // ═══════════════════════════════════════════════════════════════════════════
  const [udhaarOtaVersion, setUdhaarOtaVersion] = useState(() => {
    try {
      return localStorage.getItem(UDHAAR_OTA_VERSION_KEY) || BUILTIN_UDHAAR_OTA_VERSION;
    } catch (_) {
      return BUILTIN_UDHAAR_OTA_VERSION;
    }
  });
  const [udhaarOtaBusy, setUdhaarOtaBusy] = useState(false);
  const [availableUdhaarOta, setAvailableUdhaarOta] = useState(null);

  const checkUdhaarOtaAvailability = useCallback(async () => {
    if (embedded || udhaarOtaBusy) return null;
    try {
      const ts = Date.now();
      let manifest = null;
      let activeBase = UDHAAR_OTA_BASES[0];
      for (const base of UDHAAR_OTA_BASES) {
        try {
          const res = await fetch(`${base}/udhaar-ota-manifest.json?t=${ts}`, { cache: 'no-store' });
          if (res.ok) {
            manifest = await res.json();
            activeBase = base;
            break;
          }
        } catch (_) {}
      }
      if (!manifest || !manifest.buildId || manifest.appType !== 'udhaar-only') return null;

      let currentBuildId = BUILTIN_UDHAAR_OTA_BUILD_ID;
      try {
        currentBuildId = localStorage.getItem(UDHAAR_OTA_BUILD_ID_KEY) || BUILTIN_UDHAAR_OTA_BUILD_ID;
      } catch (_) {}

      if (manifest.buildId !== currentBuildId) {
        const info = {
          version: String(manifest.version || BUILTIN_UDHAAR_OTA_VERSION),
          buildId: String(manifest.buildId),
          notes: String(manifest.notes || 'New Udhaar Tracker update ready'),
          jsFile: String(manifest.jsFile || 'udhaar-bundle.js'),
          cssFile: String(manifest.cssFile || 'udhaar-bundle.css'),
          baseUrl: activeBase,
        };
        setAvailableUdhaarOta(info);
        return info;
      }
      setAvailableUdhaarOta(null);
    } catch (_) {}
    return null;
  }, [embedded, udhaarOtaBusy]);

  const applyUdhaarOtaUpdate = useCallback(async () => {
    if (embedded || udhaarOtaBusy) return;
    setUdhaarOtaBusy(true);
    notify('Checking Udhaar OTA Server...');
    try {
      const ts = Date.now();
      let manifest = null;
      let activeBase = UDHAAR_OTA_BASES[0];
      for (const base of UDHAAR_OTA_BASES) {
        try {
          const res = await fetch(`${base}/udhaar-ota-manifest.json?t=${ts}`, { cache: 'no-store' });
          if (res.ok) {
            manifest = await res.json();
            activeBase = base;
            break;
          }
        } catch (_) {}
      }
      if (!manifest || !manifest.buildId || manifest.appType !== 'udhaar-only') {
        notify('Could not reach Udhaar OTA Server');
        setUdhaarOtaBusy(false);
        return;
      }

      const jsRes = await fetch(`${activeBase}/${manifest.jsFile || 'udhaar-bundle.js'}?t=${ts}`, { cache: 'no-store' });
      const cssRes = await fetch(`${activeBase}/${manifest.cssFile || 'udhaar-bundle.css'}?t=${ts}`, { cache: 'no-store' });
      if (!jsRes.ok) {
        notify('Failed to download Udhaar bundle');
        setUdhaarOtaBusy(false);
        return;
      }
      const rawJs = await jsRes.text();
      const rawCss = cssRes.ok ? await cssRes.text() : '';
      // Always enforce __UDHAAR_ONLY_APK__ flag inside the Udhaar OTA bundle so it never mixes with Salary/OT
      const safeUdhaarJs = `window.__UDHAAR_ONLY_APK__ = true;\n${rawJs}`;

      try {
        localStorage.setItem(UDHAAR_OTA_VERSION_KEY, String(manifest.version || BUILTIN_UDHAAR_OTA_VERSION));
        localStorage.setItem(UDHAAR_OTA_BUILD_ID_KEY, String(manifest.buildId));
      } catch (_) {}
      setUdhaarOtaVersion(String(manifest.version || BUILTIN_UDHAAR_OTA_VERSION));
      setAvailableUdhaarOta(null);

      if (
        typeof window !== 'undefined' &&
        window.PattanBiometric &&
        typeof window.PattanBiometric.saveLiveOtaBundle === 'function'
      ) {
        const saved = window.PattanBiometric.saveLiveOtaBundle(
          String(manifest.version || BUILTIN_UDHAAR_OTA_VERSION),
          String(manifest.buildId),
          safeUdhaarJs,
          rawCss
        );
        if (saved) {
          notify(`Updated Udhaar App to v${manifest.version}! Reloading...`);
          setTimeout(() => window.location.reload(), 600);
          return;
        }
      }
      notify(`Udhaar App is up to date (v${manifest.version})`);
    } catch (_) {
      notify('Update check failed');
    } finally {
      setUdhaarOtaBusy(false);
    }
  }, [embedded, udhaarOtaBusy, notify]);

  useEffect(() => {
    if (embedded) return undefined;
    checkUdhaarOtaAvailability();
    const timer = setInterval(checkUdhaarOtaAvailability, 25000);
    return () => clearInterval(timer);
  }, [embedded, checkUdhaarOtaAvailability]);

  // Collapsible Header State (Tap header to Minimize / Maximize)
  const [minimized, setMinimized] = useState(() => {
    try {
      return localStorage.getItem('yasin_udhaar_simple_minimized_v1') === '1';
    } catch (_) {
      return false;
    }
  });

  const toggleMinimized = () => {
    setMinimized((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('yasin_udhaar_simple_minimized_v1', next ? '1' : '0');
      } catch (_) {}
      return next;
    });
  };

  // Saved Udhaar List
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem(UDHAAR_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  });

  const saveItems = (updater) => {
    setItems((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem(UDHAAR_STORAGE_KEY, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  // Simple Form State
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => getTodayIso());
  const [time, setTime] = useState(() => getCurrentTimeHHMM());
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState('');

  // Filter: 'pending' | 'returned'
  const [tab, setTab] = useState('pending');

  // Simple Edit Modal State
  const [editItem, setEditItem] = useState(null);

  // Pre-fill when user taps 🤝 on a transaction in Expenses
  useEffect(() => {
    if (externalDraft && typeof externalDraft === 'object') {
      setMinimized(false);
      setPerson(externalDraft.person || '');
      setAmount(externalDraft.amount ? String(externalDraft.amount) : '');
      setDate(externalDraft.date || getTodayIso());
      setTime(externalDraft.time || getCurrentTimeHHMM());
      setNote(externalDraft.note || '');
      if (typeof onClearExternalDraft === 'function') {
        onClearExternalDraft();
      }
    }
  }, [externalDraft, onClearExternalDraft]);

  const handleAdd = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const cleanName = String(person || '').trim();
    const numAmt = Number(amount);
    if (!cleanName || !(numAmt > 0)) {
      notify('Enter Friend Name and Amount');
      return;
    }
    const newItem = {
      id: `udh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      person: cleanName,
      amount: numAmt,
      paidAmount: 0,
      date: date || getTodayIso(),
      time: time || getCurrentTimeHHMM(),
      note: String(note || '').trim(),
      phone: String(phone || '').replace(/[^0-9+]/g, ''),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    saveItems((prev) => [newItem, ...prev]);
    setPerson('');
    setAmount('');
    setNote('');
    setPhone('');
    setDate(getTodayIso());
    setTime(getCurrentTimeHHMM());
    setTab('pending');
    notify(`Saved ₹${formatINR(numAmt)} for ${cleanName}`);
  };

  const toggleStatus = (id) => {
    saveItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const nextStatus = item.status === 'returned' ? 'pending' : 'returned';
        return {
          ...item,
          status: nextStatus,
          returnedAt: nextStatus === 'returned' ? getTodayIso() : null,
        };
      })
    );
  };

  const deleteEntry = (id) => {
    saveItems((prev) => prev.filter((item) => item.id !== id));
    setEditItem(null);
    notify('Entry deleted');
  };

  const saveEdit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!editItem) return;
    const cleanName = String(editItem.person || '').trim();
    const totalAmt = Number(editItem.amount) || 0;
    const partPaid = Math.max(0, Number(editItem.paidAmount) || 0);
    if (!cleanName || !(totalAmt > 0)) return;
    const isNowReturned = partPaid >= totalAmt ? 'returned' : editItem.status;

    saveItems((prev) =>
      prev.map((item) =>
        item.id === editItem.id
          ? {
              ...item,
              person: cleanName,
              amount: totalAmt,
              paidAmount: Math.min(totalAmt, partPaid),
              date: editItem.date || getTodayIso(),
              time: editItem.time || '12:00',
              note: String(editItem.note || '').trim(),
              phone: String(editItem.phone || '').replace(/[^0-9+]/g, ''),
              status: isNowReturned,
            }
          : item
      )
    );
    setEditItem(null);
    notify(`Updated ${cleanName}`);
  };

  const sendWhatsAppReminder = (item) => {
    const remaining = Math.max(0, (Number(item.amount) || 0) - (Number(item.paidAmount) || 0));
    const dateLabel = `${formatShortDate(item.date)}${item.time ? ` at ${formatTime12h(item.time)}` : ''}`;
    const msg = `Hi ${item.person}, friendly reminder for ₹${formatINR(remaining)} taken on ${dateLabel}${item.note ? ` (${item.note})` : ''}. Please send when free.`;
    const digits = String(item.phone || '').replace(/[^0-9]/g, '');
    const phoneParam = digits.length === 10 ? `91${digits}` : digits;
    const url = phoneParam
      ? `https://wa.me/${phoneParam}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const summary = useMemo(() => {
    let pendingTotal = 0;
    let returnedTotal = 0;
    let pendingCount = 0;
    let returnedCount = 0;
    for (const item of items) {
      if (!item) continue;
      const amt = Number(item.amount) || 0;
      const paid = Number(item.paidAmount) || 0;
      if (item.status === 'returned') {
        returnedTotal += amt;
        returnedCount += 1;
      } else {
        pendingTotal += Math.max(0, amt - paid);
        returnedTotal += paid;
        pendingCount += 1;
      }
    }
    return { pendingTotal, returnedTotal, pendingCount, returnedCount };
  }, [items]);

  const visibleItems = useMemo(
    () => items.filter((i) => (tab === 'pending' ? i.status !== 'returned' : i.status === 'returned')),
    [items, tab]
  );

  const cardContent = (
    <div
      style={{
        borderRadius: 20,
        background: palette.surface,
        border: `1px solid ${palette.border}`,
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* 1. CLEAN HEADER — TAP ANYWHERE TO MINIMIZE / MAXIMIZE */}
      <div
        onClick={toggleMinimized}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🤝</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: palette.text }}>
              Udhaar Tracker {minimized ? '▸' : '▾'}
            </div>
            <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 600 }}>
              Money given to friends
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {embedded && (
            <a
              href="https://raw.githubusercontent.com/Yasin144/female-presentator/main/ota-udhaar/Udhaar-Tracker-Pro-Friend.apk"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                padding: '5px 9px',
                borderRadius: 999,
                background: palette.surfaceAlt,
                border: `1px solid ${palette.border}`,
                color: palette.textSub,
                fontSize: 10.5,
                fontWeight: 800,
                textDecoration: 'none',
              }}
            >
              ⬇️ Friend APK
            </a>
          )}
          <div
            style={{
              padding: '5px 10px',
              borderRadius: 999,
              background: isLight ? '#fef3c7' : 'rgba(245, 158, 11, 0.16)',
              color: isLight ? '#b45309' : '#fbbf24',
              fontSize: 12,
              fontWeight: 900,
            }}
          >
            ₹{formatINR(summary.pendingTotal)} {minimized ? '▸' : '▾'}
          </div>
        </div>
      </div>

      {/* 2. BODY (HIDDEN WHEN MINIMIZED) */}
      {!minimized && (
        <>
          {/* Simple 2-Box Total Bar */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 14,
                background: isLight ? '#fffbeb' : 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: isLight ? '#b45309' : '#fbbf24' }}>
                ⏳ Pending to Get
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: palette.text, marginTop: 2 }}>
                ₹{formatINR(summary.pendingTotal)}
              </div>
            </div>

            <div
              style={{
                padding: '10px 12px',
                borderRadius: 14,
                background: isLight ? '#ecfdf5' : 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: isLight ? '#047857' : '#34d399' }}>
                ✅ Returned
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: palette.text, marginTop: 2 }}>
                ₹{formatINR(summary.returnedTotal)}
              </div>
            </div>
          </div>

          {/* Simple Add Form */}
          <form
            onSubmit={handleAdd}
            style={{
              padding: '12px',
              borderRadius: 16,
              background: palette.surfaceAlt,
              border: `1px solid ${palette.border}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {/* Row 1: Name + Amount */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 8 }}>
              <input
                type="text"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                placeholder="👤 Friend Name"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.surface,
                  color: palette.text,
                  fontSize: 13.5,
                  fontWeight: 800,
                  outline: 'none',
                }}
              />
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="₹ Amount"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.surface,
                  color: palette.text,
                  fontSize: 13.5,
                  fontWeight: 900,
                  outline: 'none',
                }}
              />
            </div>

            {/* Row 2: When did he take? (Simple Today / Yesterday + Date & Time) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: palette.textSub }}>
                  📅 When did he take?
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { label: 'Today', iso: getTodayIso() },
                    { label: 'Yesterday', iso: getRelativeDateIso(1) },
                  ].map((chip) => {
                    const active = date === chip.iso;
                    return (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => setDate(chip.iso)}
                        style={{
                          padding: '3px 9px',
                          borderRadius: 999,
                          border: active ? '1px solid #f59e0b' : `1px solid ${palette.border}`,
                          background: active ? 'rgba(245, 158, 11, 0.18)' : palette.surface,
                          color: active ? (isLight ? '#b45309' : '#fbbf24') : palette.textMuted,
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 10px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surface,
                    color: palette.text,
                    fontSize: 12.5,
                    fontWeight: 800,
                    outline: 'none',
                  }}
                />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 10px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surface,
                    color: palette.text,
                    fontSize: 12.5,
                    fontWeight: 800,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Row 3: Note + Save Button */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 8 }}>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="📝 For what? (optional)"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.surface,
                  color: palette.text,
                  fontSize: 12.5,
                  fontWeight: 700,
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                style={{
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                + Add Udhaar
              </button>
            </div>
          </form>

          {/* Simple Pending / Returned Switch */}
          {items.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button
                type="button"
                onClick={() => setTab('pending')}
                style={{
                  padding: '8px',
                  borderRadius: 10,
                  border: tab === 'pending' ? '1px solid #f59e0b' : `1px solid ${palette.border}`,
                  background: tab === 'pending' ? 'rgba(245, 158, 11, 0.16)' : palette.surfaceAlt,
                  color: tab === 'pending' ? (isLight ? '#b45309' : '#fbbf24') : palette.textMuted,
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                ⏳ Pending ({summary.pendingCount})
              </button>
              <button
                type="button"
                onClick={() => setTab('returned')}
                style={{
                  padding: '8px',
                  borderRadius: 10,
                  border: tab === 'returned' ? '1px solid #10b981' : `1px solid ${palette.border}`,
                  background: tab === 'returned' ? 'rgba(16, 185, 129, 0.16)' : palette.surfaceAlt,
                  color: tab === 'returned' ? (isLight ? '#047857' : '#34d399') : palette.textMuted,
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                ✅ Returned ({summary.returnedCount})
              </button>
            </div>
          )}

          {/* Clean List of People */}
          {visibleItems.length === 0 ? (
            <div
              style={{
                padding: '14px',
                textAlign: 'center',
                color: palette.textMuted,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {items.length === 0
                ? 'No Udhaar entries yet. Add name & amount above.'
                : tab === 'pending'
                ? '🎉 All Udhaar has been returned!'
                : 'No returned entries yet.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visibleItems.map((item) => {
                const isReturned = item.status === 'returned';
                const paid = Number(item.paidAmount) || 0;
                const remaining = Math.max(0, (Number(item.amount) || 0) - paid);
                return (
                  <div
                    key={item.id}
                    style={{
                      padding: '12px',
                      borderRadius: 14,
                      background: palette.surfaceAlt,
                      border: `1px solid ${palette.border}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    {/* Top Info Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 900, color: palette.text }}>
                          {item.person}
                        </div>
                        <div style={{ fontSize: 11.5, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                          📅 Took on {formatShortDate(item.date)}
                          {item.time ? ` · ${formatTime12h(item.time)}` : ''}
                        </div>
                        {item.note && (
                          <div style={{ fontSize: 11.5, color: palette.textSub, fontWeight: 700, marginTop: 3 }}>
                            📝 {item.note}
                          </div>
                        )}
                        {paid > 0 && !isReturned && (
                          <div style={{ fontSize: 11, color: '#10b981', fontWeight: 800, marginTop: 3 }}>
                            Paid ₹{formatINR(paid)} · Left ₹{formatINR(remaining)}
                          </div>
                        )}
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <div
                          style={{
                            fontSize: 17,
                            fontWeight: 900,
                            color: isReturned ? '#10b981' : isLight ? '#d97706' : '#fbbf24',
                          }}
                        >
                          ₹{formatINR(isReturned ? item.amount : remaining)}
                        </div>
                        <div style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>
                          {isReturned ? '✅ Returned' : '⏳ Pending'}
                        </div>
                      </div>
                    </div>

                    {/* Simple 3-Button Action Row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => toggleStatus(item.id)}
                        style={{
                          padding: '8px',
                          borderRadius: 10,
                          border: 'none',
                          background: isReturned ? palette.surface : '#10b981',
                          color: isReturned ? palette.textSub : '#ffffff',
                          fontWeight: 900,
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}
                      >
                        {isReturned ? '↩️ Mark Pending' : '✅ Returned'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setEditItem({ ...item })}
                        style={{
                          padding: '8px',
                          borderRadius: 10,
                          border: `1px solid ${palette.border}`,
                          background: palette.surface,
                          color: palette.text,
                          fontWeight: 800,
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}
                      >
                        ✏️ Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => sendWhatsAppReminder(item)}
                        style={{
                          padding: '8px',
                          borderRadius: 10,
                          border: `1px solid ${palette.border}`,
                          background: palette.surface,
                          color: '#10b981',
                          fontWeight: 800,
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}
                      >
                        💬 Remind
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* SIMPLE CLEAN EDIT POPUP */}
      {editItem && (
        <div
          onClick={() => setEditItem(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(2, 6, 23, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={saveEdit}
            style={{
              width: '100%',
              maxWidth: 380,
              borderRadius: 20,
              background: palette.surface,
              border: `1px solid ${palette.border}`,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              color: palette.text,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>✏️ Edit Udhaar</div>
              <button
                type="button"
                onClick={() => setEditItem(null)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: palette.textMuted,
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                Friend Name
              </div>
              <input
                type="text"
                value={editItem.person || ''}
                onChange={(e) => setEditItem((p) => ({ ...p, person: e.target.value }))}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 14,
                  fontWeight: 800,
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                  Total Amount (₹)
                </div>
                <input
                  type="number"
                  value={editItem.amount ?? ''}
                  onChange={(e) => setEditItem((p) => ({ ...p, amount: e.target.value }))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px',
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 14,
                    fontWeight: 900,
                  }}
                />
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                  Part Paid So Far (₹)
                </div>
                <input
                  type="number"
                  value={editItem.paidAmount ?? 0}
                  onChange={(e) => setEditItem((p) => ({ ...p, paidAmount: e.target.value }))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px',
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 14,
                    fontWeight: 900,
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                  Date Taken
                </div>
                <input
                  type="date"
                  value={editItem.date || ''}
                  onChange={(e) => setEditItem((p) => ({ ...p, date: e.target.value }))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px',
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                  Time Taken
                </div>
                <input
                  type="time"
                  value={editItem.time || ''}
                  onChange={(e) => setEditItem((p) => ({ ...p, time: e.target.value }))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px',
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                Note / Reason
              </div>
              <input
                type="text"
                value={editItem.note || ''}
                onChange={(e) => setEditItem((p) => ({ ...p, note: e.target.value }))}
                placeholder="For what?"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              />
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                WhatsApp Phone (optional)
              </div>
              <input
                type="tel"
                value={editItem.phone || ''}
                onChange={(e) => setEditItem((p) => ({ ...p, phone: e.target.value }))}
                placeholder="10-digit mobile number"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => deleteEntry(editItem.id)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#ef4444',
                  fontWeight: 900,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                🗑️ Delete
              </button>
              <button
                type="submit"
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                ✓ Save Changes
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );

  if (embedded) {
    return cardContent;
  }

  // Standalone APK wrapper for friend (Uses separate ota-udhaar server)
  return (
    <div
      style={{
        minHeight: '100vh',
        background: palette.bg,
        color: palette.text,
        padding: '14px 12px 48px',
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 460, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Clean Standalone Top Bar with Dedicated Udhaar OTA Update Button */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 14px',
            borderRadius: 16,
            background: palette.surface,
            border: `1px solid ${palette.border}`,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 900 }}>🤝 Udhaar Tracker</div>
            <div style={{ fontSize: 10.5, color: palette.textMuted, fontWeight: 700 }}>
              v{udhaarOtaVersion} · Udhaar OTA
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              onClick={applyUdhaarOtaUpdate}
              disabled={udhaarOtaBusy}
              style={{
                padding: '6px 10px',
                borderRadius: 10,
                border: availableUdhaarOta ? 'none' : `1px solid ${palette.border}`,
                background: availableUdhaarOta ? '#10b981' : palette.surfaceAlt,
                color: availableUdhaarOta ? '#ffffff' : palette.text,
                fontSize: 11.5,
                fontWeight: 800,
                cursor: udhaarOtaBusy ? 'wait' : 'pointer',
              }}
            >
              {udhaarOtaBusy ? '⏳...' : availableUdhaarOta ? `🚀 Update v${availableUdhaarOta.version}` : '🔄 Update'}
            </button>

            <button
              type="button"
              onClick={() => setThemeLight((v) => !v)}
              style={{
                padding: '6px 10px',
                borderRadius: 10,
                border: `1px solid ${palette.border}`,
                background: palette.surfaceAlt,
                color: palette.text,
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {isLight ? '🌙' : '☀️'}
            </button>
          </div>
        </div>

        {/* Dedicated Udhaar OTA Update Banner */}
        {availableUdhaarOta && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 14,
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10b981',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800 }}>
              🚀 New Udhaar Update v{availableUdhaarOta.version}: {availableUdhaarOta.notes}
            </div>
            <button
              type="button"
              onClick={applyUdhaarOtaUpdate}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                background: '#10b981',
                color: '#ffffff',
                fontWeight: 900,
                fontSize: 11.5,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Update Now
            </button>
          </div>
        )}

        {toastMsg && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              background: '#10b981',
              color: '#ffffff',
              fontSize: 12.5,
              fontWeight: 800,
              textAlign: 'center',
            }}
          >
            {toastMsg}
          </div>
        )}

        {cardContent}
      </div>
    </div>
  );
}
