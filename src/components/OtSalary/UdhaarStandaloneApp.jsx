import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';

const LS_UDHAAR_KEY = 'pattan.expenses.udhaarTracker_v1';
const LS_UDHAAR_COLLAPSED_KEY = 'pattan.udhaar.collapsedSections_v1';

function getTodayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getYesterdayIso(todayIso) {
  const d = new Date(`${todayIso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatINR(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatTime12h(timeStr) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  if (!m) return timeStr || '';
  const hh24 = Number(m[1]);
  const mm = m[2];
  const period = hh24 >= 12 ? 'PM' : 'AM';
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${String(hh12).padStart(2, '0')}:${mm} ${period}`;
}

export default function UdhaarStandaloneApp({
  embedded = false,
  isLight = false,
  externalUdhaarMap = null,
  onExternalPersist = null,
  onToast = null,
  externalDraftRequest = null,
  onClearExternalDraft = null,
}) {
  const todayIso = getTodayIso();
  const yesterdayIso = useMemo(() => getYesterdayIso(todayIso), [todayIso]);
  const backupFileInputRef = useRef(null);

  const [internalMap, setInternalMap] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(LS_UDHAAR_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        }
      }
    } catch (_) {}
    return {};
  });

  const udhaarMap = externalUdhaarMap !== null ? externalUdhaarMap : internalMap;

  const persistMap = useCallback(
    (nextMap) => {
      if (typeof onExternalPersist === 'function') {
        onExternalPersist(nextMap);
      } else {
        setInternalMap(nextMap);
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(LS_UDHAAR_KEY, JSON.stringify(nextMap));
          }
        } catch (_) {}
      }
    },
    [onExternalPersist]
  );

  const [toastMsg, setToastMsg] = useState('');
  const notify = useCallback(
    (msg) => {
      setToastMsg(msg);
      if (typeof onToast === 'function') onToast(msg);
      setTimeout(() => setToastMsg((prev) => (prev === msg ? '' : prev)), 3200);
    },
    [onToast]
  );

  // Collapsible sections (Tap header to minimize / maximize)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(LS_UDHAAR_COLLAPSED_KEY);
        if (raw) return JSON.parse(raw) || {};
      }
    } catch (_) {}
    return {};
  });

  const toggleSection = useCallback((secKey) => {
    setCollapsed((prev) => {
      const next = { ...prev, [secKey]: !prev[secKey] };
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(LS_UDHAAR_COLLAPSED_KEY, JSON.stringify(next));
        }
      } catch (_) {}
      return next;
    });
  }, []);

  // Form states for Add / Edit Udhaar
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [draftDirection, setDraftDirection] = useState('given'); // 'given' (They owe me) | 'taken' (I owe them)
  const [draftPerson, setDraftPerson] = useState('');
  const [draftAmount, setDraftAmount] = useState('');
  const [draftPaidSoFar, setDraftPaidSoFar] = useState('');
  const [draftTookDate, setDraftTookDate] = useState(todayIso);
  const [draftTookTime, setDraftTookTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [draftDueDate, setDraftDueDate] = useState('');
  const [draftPaymentMode, setDraftPaymentMode] = useState('UPI');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftNote, setDraftNote] = useState('');

  // Partial payment inline modal state
  const [partPayTargetId, setPartPayTargetId] = useState('');
  const [partPayAmount, setPartPayAmount] = useState('');
  const [partPayDate, setPartPayDate] = useState(todayIso);
  const [partPayNote, setPartPayNote] = useState('');

  // Filters & Views
  const [filterTab, setFilterTab] = useState('pending'); // 'pending' | 'returned' | 'people' | 'all'
  const [directionFilter, setDirectionFilter] = useState('all'); // 'all' | 'given' | 'taken'
  const [searchQuery, setSearchQuery] = useState('');

  const openAddOrEditForm = useCallback(
    (entry = null) => {
      if (entry && entry.id) {
        setEditingId(String(entry.id));
        setDraftDirection(entry.direction === 'taken' ? 'taken' : 'given');
        setDraftPerson(String(entry.person || ''));
        setDraftAmount(String(entry.amount || ''));
        setDraftPaidSoFar(entry.paidAmount ? String(entry.paidAmount) : '');
        setDraftTookDate(String(entry.tookDate || entry.date || todayIso));
        setDraftTookTime(String(entry.tookTime || entry.time || '12:00'));
        setDraftDueDate(String(entry.dueDate || ''));
        setDraftPaymentMode(String(entry.paymentMode || 'UPI'));
        setDraftPhone(String(entry.phone || ''));
        setDraftNote(String(entry.note || ''));
      } else {
        setEditingId('');
        setDraftDirection('given');
        setDraftPerson('');
        setDraftAmount('');
        setDraftPaidSoFar('');
        setDraftTookDate(todayIso);
        setDraftTookTime(new Date().toTimeString().slice(0, 5));
        setDraftDueDate('');
        setDraftPaymentMode('UPI');
        setDraftPhone('');
        setDraftNote('');
      }
      setShowForm(true);
      setCollapsed((prev) => ({ ...prev, main_card: false }));
    },
    [todayIso]
  );

  useEffect(() => {
    if (externalDraftRequest && typeof externalDraftRequest === 'object') {
      openAddOrEditForm(externalDraftRequest);
      if (typeof onClearExternalDraft === 'function') {
        onClearExternalDraft();
      }
    }
  }, [externalDraftRequest, openAddOrEditForm, onClearExternalDraft]);

  const handleExportJsonBackup = () => {
    try {
      const payload = JSON.stringify(
        {
          app: 'Udhaar Tracker Pro',
          exportedAt: new Date().toISOString(),
          udhaarMap,
        },
        null,
        2
      );
      const blob = new Blob([payload], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Udhaar-Backup-${todayIso}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify('✅ Exported Udhaar Backup JSON!');
    } catch (_) {
      notify('⚠️ Could not export backup file.');
    }
  };

  const handleImportJsonBackup = async (ev) => {
    const file = ev?.target?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (ev?.target) ev.target.value = '';
      const parsed = JSON.parse(text);
      const incoming = parsed?.udhaarMap && typeof parsed.udhaarMap === 'object' ? parsed.udhaarMap : parsed;
      if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
        const merged = { ...udhaarMap, ...incoming };
        persistMap(merged);
        notify(`✅ Restored ${Object.keys(incoming).length} Udhaar entries from backup!`);
      } else {
        notify('⚠️ Invalid Udhaar backup file.');
      }
    } catch (_) {
      notify('⚠️ Failed to read backup file.');
    }
  };

  const handleSaveEntry = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const person = String(draftPerson || '').trim();
    const amount = Number(String(draftAmount || '').replace(/,/g, ''));
    const paidAmount = Math.max(0, Number(String(draftPaidSoFar || '0').replace(/,/g, '')) || 0);
    const tookDate = String(draftTookDate || todayIso).trim() || todayIso;
    const tookTime = String(draftTookTime || '12:00').trim() || '12:00';
    if (!person || !(amount > 0)) {
      notify('⚠️ Please enter both Person Name and a valid ₹ Amount.');
      return;
    }
    const id = editingId || `udhaar_${Date.now()}`;
    const existing = udhaarMap[id] || {};
    const isFullyReturned = paidAmount >= amount;
    const nextEntry = {
      ...existing,
      id,
      txId: existing.txId || '',
      direction: draftDirection === 'taken' ? 'taken' : 'given',
      person,
      amount,
      paidAmount: isFullyReturned ? amount : paidAmount,
      date: tookDate,
      tookDate,
      time: tookTime,
      tookTime,
      dueDate: String(draftDueDate || '').trim(),
      paymentMode: String(draftPaymentMode || 'UPI').trim(),
      phone: String(draftPhone || '').trim(),
      note: String(draftNote || '').trim(),
      status: isFullyReturned ? 'returned' : 'pending',
      returnedAt: isFullyReturned ? existing.returnedAt || todayIso : '',
      installments: Array.isArray(existing.installments) ? existing.installments : [],
      updatedAtMs: Date.now(),
    };
    persistMap({ ...udhaarMap, [id]: nextEntry });
    setShowForm(false);
    setEditingId('');
    notify(
      editingId
        ? `✏️ Updated Udhaar for ${person} (₹${formatINR(amount)} · Took on ${tookDate})`
        : `🤝 Saved Udhaar: ${person} · ₹${formatINR(amount)} (Took on ${tookDate})`
    );
  };

  const handleRecordPartPayment = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const target = udhaarMap[partPayTargetId];
    if (!target) return;
    const addAmt = Number(String(partPayAmount || '').replace(/,/g, ''));
    if (!(addAmt > 0)) {
      notify('⚠️ Enter a valid partial payment amount.');
      return;
    }
    const prevPaid = Number(target.paidAmount) || 0;
    const totalAmt = Number(target.amount) || 0;
    const newPaid = Math.min(totalAmt, Number((prevPaid + addAmt).toFixed(2)));
    const isNowSettled = newPaid >= totalAmt;
    const nextInstallments = [
      ...(Array.isArray(target.installments) ? target.installments : []),
      {
        id: `inst_${Date.now()}`,
        amount: addAmt,
        date: partPayDate || todayIso,
        note: String(partPayNote || '').trim(),
      },
    ];
    const updated = {
      ...target,
      paidAmount: newPaid,
      status: isNowSettled ? 'returned' : 'pending',
      returnedAt: isNowSettled ? partPayDate || todayIso : '',
      installments: nextInstallments,
      updatedAtMs: Date.now(),
    };
    persistMap({ ...udhaarMap, [target.id]: updated });
    setPartPayTargetId('');
    setPartPayAmount('');
    setPartPayNote('');
    notify(
      isNowSettled
        ? `✅ Full ₹${formatINR(totalAmt)} settled with ${target.person}!`
        : `💵 Recorded ₹${formatINR(addAmt)} part payment from ${target.person} (Remaining: ₹${formatINR(totalAmt - newPaid)})`
    );
  };

  const handleStatusChange = (id, nextStatus) => {
    const existing = udhaarMap[id];
    if (!existing) return;
    const next = { ...udhaarMap };
    if (nextStatus === 'delete') {
      delete next[id];
      persistMap(next);
      notify(`🗑️ Deleted ${existing.person} Udhaar entry.`);
      return;
    }
    const isRet = nextStatus === 'returned';
    next[id] = {
      ...existing,
      status: isRet ? 'returned' : 'pending',
      paidAmount: isRet ? Number(existing.amount) || 0 : 0,
      returnedAt: isRet ? todayIso : '',
      updatedAtMs: Date.now(),
    };
    persistMap(next);
    notify(
      isRet
        ? `✅ Marked ₹${formatINR(existing.amount)} (${existing.person}) as Settled / Returned!`
        : `⏳ Reopened ₹${formatINR(existing.amount)} (${existing.person}) as Pending.`
    );
  };

  const handleWhatsAppRemind = (item) => {
    if (!item) return;
    const cleanDigits = String(item.phone || '').replace(/\D+/g, '');
    const waPhone = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;
    const tookDate = item.tookDate || item.date || todayIso;
    const totalAmt = Number(item.amount) || 0;
    const paidAmt = Number(item.paidAmount) || 0;
    const remAmt = Math.max(0, totalAmt - paidAmt);
    const notePart = item.note ? ` (${item.note})` : '';
    const duePart = item.dueDate ? ` · Due Date: ${item.dueDate}` : '';
    const msg =
      item.direction === 'taken'
        ? `Hi ${item.person}, regarding ₹${formatINR(totalAmt)} I took on ${tookDate}${notePart}: Remaining balance is ₹${formatINR(remAmt)}.`
        : paidAmt > 0 && remAmt > 0
          ? `Hi ${item.person}, gentle reminder regarding ₹${formatINR(totalAmt)} you took on ${tookDate}${notePart}. Received ₹${formatINR(paidAmt)} so far, remaining balance is ₹${formatINR(remAmt)}${duePart}. Please send via UPI when convenient 🙏`
          : `Hi ${item.person}, gentle reminder regarding ₹${formatINR(totalAmt)} you took on ${tookDate}${notePart}${duePart}. Please send via UPI whenever convenient 🙏`;
    const url = waPhone
      ? `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
      notify(`💬 Opened WhatsApp reminder for ${item.person}`);
    } catch (_) {}
  };

  const handleDownloadUdhaarCardPng = (item = null) => {
    try {
      const canvas = document.createElement('canvas');
      const W = 960;
      const H = item ? 680 : 1080;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, '#091326');
      grad.addColorStop(1, '#071f1a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
      ctx.lineWidth = 3;
      ctx.strokeRect(28, 28, W - 56, H - 56);

      ctx.fillStyle = '#fbbf24';
      ctx.font = '900 28px system-ui, sans-serif';
      ctx.fillText('🤝 UDHAAR / MONEY LEDGER STATEMENT', 64, 90);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText(`Generated on ${todayIso}`, 64, 125);

      if (item) {
        const total = Number(item.amount) || 0;
        const paid = Number(item.paidAmount) || 0;
        const rem = Math.max(0, total - paid);
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 42px system-ui, sans-serif';
        ctx.fillText(`👤 ${item.person}`, 64, 200);

        ctx.fillStyle = item.direction === 'taken' ? '#60a5fa' : '#fbbf24';
        ctx.font = '900 48px system-ui, sans-serif';
        ctx.fillText(`Remaining: ₹${formatINR(rem)}`, 64, 270);

        ctx.fillStyle = '#cbd5e1';
        ctx.font = '700 24px system-ui, sans-serif';
        ctx.fillText(`Total Amount: ₹${formatINR(total)}   |   Paid So Far: ₹${formatINR(paid)}`, 64, 330);
        ctx.fillText(`📅 Date Taken: ${item.tookDate || item.date || todayIso} ${formatTime12h(item.tookTime || item.time)}`, 64, 380);
        if (item.dueDate) ctx.fillText(`🗓️ Promised Return Date: ${item.dueDate}`, 64, 430);
        if (item.note) ctx.fillText(`📝 Note: ${item.note}`, 64, 480);
        ctx.fillStyle = '#34d399';
        ctx.font = '800 22px system-ui, sans-serif';
        ctx.fillText(`Status: ${item.status === 'returned' ? '✅ SETTLED' : '⏳ PENDING'}`, 64, 540);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 34px system-ui, sans-serif';
        ctx.fillText(
          `To Collect: ₹${formatINR(summary.pendingGivenTotal)}   |   To Pay: ₹${formatINR(summary.pendingTakenTotal)}`,
          64,
          190
        );
        summary.pendingList.slice(0, 12).forEach((en, idx) => {
          const y = 260 + idx * 60;
          const rem = Math.max(0, (Number(en.amount) || 0) - (Number(en.paidAmount) || 0));
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '800 22px system-ui, sans-serif';
          ctx.fillText(
            `${idx + 1}. ${en.person} · Took on ${en.tookDate || en.date} ${en.note ? `(${en.note})` : ''}`,
            64,
            y
          );
          ctx.textAlign = 'right';
          ctx.fillStyle = en.direction === 'taken' ? '#60a5fa' : '#fbbf24';
          ctx.fillText(`₹${formatINR(rem)}`, W - 64, y);
          ctx.textAlign = 'left';
        });
      }

      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = item ? `Udhaar-${item.person}-${todayIso}.png` : `Udhaar-Summary-${todayIso}.png`;
      a.click();
      notify('🖼️ Downloaded Udhaar Statement Card (PNG)!');
    } catch (_) {
      notify('⚠️ Could not generate PNG card.');
    }
  };

  const summary = useMemo(() => {
    const all = Object.values(udhaarMap || {}).filter((x) => x && typeof x === 'object' && Number(x.amount) > 0);
    all.sort((a, b) => (Number(b.updatedAtMs) || 0) - (Number(a.updatedAtMs) || 0));

    const pendingList = [];
    const returnedList = [];
    let pendingGivenTotal = 0;
    let pendingTakenTotal = 0;
    let returnedTotal = 0;
    const peopleMap = {};

    for (const item of all) {
      const total = Number(item.amount) || 0;
      const paid = Number(item.paidAmount) || 0;
      const rem = item.status === 'returned' ? 0 : Math.max(0, total - paid);
      const dir = item.direction === 'taken' ? 'taken' : 'given';

      if (item.status === 'returned' || rem <= 0) {
        returnedList.push(item);
        returnedTotal += total;
      } else {
        pendingList.push(item);
        if (dir === 'taken') pendingTakenTotal += rem;
        else pendingGivenTotal += rem;
      }

      const pKey = String(item.person || 'Unknown').trim().toLowerCase();
      if (!peopleMap[pKey]) {
        peopleMap[pKey] = {
          person: item.person || 'Unknown',
          phone: item.phone || '',
          givenPending: 0,
          takenPending: 0,
          settledTotal: 0,
          count: 0,
          lastTookDate: item.tookDate || item.date || todayIso,
          items: [],
        };
      }
      const pEntry = peopleMap[pKey];
      pEntry.count += 1;
      if (!pEntry.phone && item.phone) pEntry.phone = item.phone;
      if (item.status === 'returned' || rem <= 0) {
        pEntry.settledTotal += total;
      } else if (dir === 'taken') {
        pEntry.takenPending += rem;
      } else {
        pEntry.givenPending += rem;
      }
      pEntry.items.push(item);
    }

    const q = String(searchQuery || '').trim().toLowerCase();
    const filterFn = (list) =>
      list.filter((item) => {
        if (directionFilter !== 'all') {
          const d = item.direction === 'taken' ? 'taken' : 'given';
          if (d !== directionFilter) return false;
        }
        if (!q) return true;
        return (
          String(item.person || '').toLowerCase().includes(q) ||
          String(item.note || '').toLowerCase().includes(q) ||
          String(item.tookDate || item.date || '').includes(q) ||
          String(item.phone || '').includes(q)
        );
      });

    return {
      all,
      pendingList: filterFn(pendingList),
      returnedList: filterFn(returnedList),
      allFiltered: filterFn(all),
      peopleList: Object.values(peopleMap).filter(
        (p) => !q || String(p.person || '').toLowerCase().includes(q)
      ),
      pendingGivenTotal,
      pendingTakenTotal,
      returnedTotal,
      rawPendingCount: pendingList.length,
      rawReturnedCount: returnedList.length,
    };
  }, [udhaarMap, searchQuery, directionFilter, todayIso]);

  const colors = {
    bg: isLight ? '#f8fafc' : '#060b16',
    surface: isLight ? '#ffffff' : '#0f172a',
    surfaceAlt: isLight ? '#f1f5f9' : '#162033',
    border: isLight ? '#cbd5e1' : 'rgba(148, 163, 184, 0.22)',
    text: isLight ? '#0f172a' : '#f8fafc',
    textSub: isLight ? '#334155' : '#cbd5e1',
    textMuted: isLight ? '#64748b' : '#94a3b8',
  };

  const activeItems =
    filterTab === 'pending'
      ? summary.pendingList
      : filterTab === 'returned'
        ? summary.returnedList
        : summary.allFiltered;

  return (
    <div
      style={{
        minHeight: embedded ? 'auto' : '100vh',
        background: embedded ? 'transparent' : colors.bg,
        color: colors.text,
        padding: embedded ? 0 : '14px 12px 90px',
        fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif",
        boxSizing: 'border-box',
        width: '100%',
      }}
    >
      {!embedded && (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: 20,
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 60%, #064e3b 100%)',
            border: '1px solid rgba(245, 158, 11, 0.45)',
            marginBottom: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            onClick={() => toggleSection('hero_summary')}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 950, color: '#ffffff', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{collapsed.hero_summary ? '▸' : '▾'}</span>
                <span>🤝 Udhaar &amp; Money Ledger Pro</span>
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#94a3b8', marginTop: 2 }}>
                {collapsed.hero_summary
                  ? 'Minimized — Tap header to maximize summary & backup options'
                  : 'Tap any section header to minimize/maximize · Track Who Took, When He Took, Edit & Part-Pay'}
              </div>
            </div>
            <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => handleDownloadUdhaarCardPng(null)}
                style={{
                  padding: '7px 11px',
                  borderRadius: 10,
                  border: '1px solid rgba(52, 211, 153, 0.5)',
                  background: 'rgba(16, 185, 129, 0.18)',
                  color: '#6ee7b7',
                  fontSize: 11,
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                🖼️ PNG Card
              </button>
              <button
                type="button"
                onClick={handleExportJsonBackup}
                style={{
                  padding: '7px 11px',
                  borderRadius: 10,
                  border: '1px solid rgba(96, 165, 250, 0.45)',
                  background: 'rgba(59, 130, 246, 0.18)',
                  color: '#93c5fd',
                  fontSize: 11,
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                📤 Backup
              </button>
              <button
                type="button"
                onClick={() => backupFileInputRef.current?.click()}
                style={{
                  padding: '7px 11px',
                  borderRadius: 10,
                  border: '1px solid rgba(251, 191, 36, 0.45)',
                  background: 'rgba(245, 158, 11, 0.18)',
                  color: '#fde68a',
                  fontSize: 11,
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                📥 Restore
              </button>
              <input
                ref={backupFileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportJsonBackup}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          {!collapsed.hero_summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, paddingTop: 4 }}>
              <div style={{ padding: '10px', borderRadius: 12, background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(245, 158, 11, 0.35)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#fbbf24' }}>💸 TO COLLECT (GIVEN)</div>
                <div className="ot-tabular-nums" style={{ fontSize: 16, fontWeight: 950, color: '#ffffff', marginTop: 2 }}>
                  ₹{formatINR(summary.pendingGivenTotal)}
                </div>
              </div>
              <div style={{ padding: '10px', borderRadius: 12, background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(59, 130, 246, 0.35)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#60a5fa' }}>📥 TO PAY (TAKEN)</div>
                <div className="ot-tabular-nums" style={{ fontSize: 16, fontWeight: 950, color: '#ffffff', marginTop: 2 }}>
                  ₹{formatINR(summary.pendingTakenTotal)}
                </div>
              </div>
              <div style={{ padding: '10px', borderRadius: 12, background: 'rgba(15, 23, 42, 0.65)', border: '1px solid rgba(16, 185, 129, 0.35)' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#34d399' }}>✅ TOTAL SETTLED</div>
                <div className="ot-tabular-nums" style={{ fontSize: 16, fontWeight: 950, color: '#ffffff', marginTop: 2 }}>
                  ₹{formatINR(summary.returnedTotal)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {toastMsg && !embedded && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 12,
            background: 'rgba(16, 185, 129, 0.18)',
            border: '1px solid rgba(16, 185, 129, 0.45)',
            color: '#6ee7b7',
            fontSize: 12,
            fontWeight: 800,
            marginBottom: 10,
          }}
        >
          {toastMsg}
        </div>
      )}

      {/* MAIN UDHAAR CONTAINER CARD (Tap Header to Minimize / Maximize) */}
      <div
        className="stitch-bento-card"
        style={{
          padding: '14px',
          borderRadius: 20,
          background: colors.surface,
          border: `1.5px solid ${summary.pendingGivenTotal > 0 ? 'rgba(245, 158, 11, 0.5)' : colors.border}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxSizing: 'border-box',
          width: '100%',
        }}
      >
        {/* CLICKABLE ACCORDION HEADER — Tap to Minimize / Maximize */}
        <div
          onClick={() => toggleSection('main_card')}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 950, color: colors.text, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span>{collapsed.main_card ? '▸' : '▾'}</span>
              <span>🤝 Udhaar / Money to Collect</span>
              <span
                className="ot-tabular-nums"
                style={{
                  fontSize: 11,
                  fontWeight: 900,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'rgba(245, 158, 11, 0.18)',
                  color: '#fbbf24',
                }}
              >
                ₹{formatINR(summary.pendingGivenTotal)} ({summary.rawPendingCount})
              </span>
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: colors.textMuted, marginTop: 2 }}>
              {collapsed.main_card
                ? 'Minimized — Tap header to maximize Udhaar tracker'
                : 'Tap header to minimize · Track when he took, edit, part-pay & remind'}
            </div>
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            <button
              type="button"
              onClick={() => {
                if (showForm) {
                  setShowForm(false);
                  setEditingId('');
                } else {
                  openAddOrEditForm(null);
                }
              }}
              style={{
                padding: '7px 12px',
                borderRadius: 12,
                border: '1px solid rgba(245, 158, 11, 0.55)',
                background: showForm
                  ? colors.surfaceAlt
                  : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: showForm ? colors.textSub : '#ffffff',
                fontSize: 11.5,
                fontWeight: 900,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {showForm ? '✕ Close' : '+ Add Udhaar'}
            </button>
          </div>
        </div>

        {!collapsed.main_card && (
          <>
            {/* 3-Column Summary & View Tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
              <button
                type="button"
                onClick={() => setFilterTab('pending')}
                style={{
                  padding: '9px 8px',
                  borderRadius: 13,
                  border: filterTab === 'pending' ? '1.5px solid #f59e0b' : `1px solid ${colors.border}`,
                  background: filterTab === 'pending' ? 'rgba(245, 158, 11, 0.14)' : colors.surfaceAlt,
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 800, color: '#fbbf24' }}>
                  ⏳ PENDING ({summary.rawPendingCount})
                </span>
                <span className="ot-tabular-nums" style={{ fontSize: 14.5, fontWeight: 950, color: colors.text }}>
                  ₹{formatINR(summary.pendingGivenTotal)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('returned')}
                style={{
                  padding: '9px 8px',
                  borderRadius: 13,
                  border: filterTab === 'returned' ? '1.5px solid #10b981' : `1px solid ${colors.border}`,
                  background: filterTab === 'returned' ? 'rgba(16, 185, 129, 0.14)' : colors.surfaceAlt,
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 800, color: '#34d399' }}>
                  ✅ SETTLED ({summary.rawReturnedCount})
                </span>
                <span className="ot-tabular-nums" style={{ fontSize: 14.5, fontWeight: 950, color: colors.text }}>
                  ₹{formatINR(summary.returnedTotal)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setFilterTab('people')}
                style={{
                  padding: '9px 8px',
                  borderRadius: 13,
                  border: filterTab === 'people' ? '1.5px solid #60a5fa' : `1px solid ${colors.border}`,
                  background: filterTab === 'people' ? 'rgba(59, 130, 246, 0.14)' : colors.surfaceAlt,
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 800, color: '#60a5fa' }}>
                  👥 BY PERSON ({summary.peopleList.length})
                </span>
                <span className="ot-tabular-nums" style={{ fontSize: 12.5, fontWeight: 900, color: colors.textSub }}>
                  Net Ledger
                </span>
              </button>
            </div>

            {/* Search & Direction Filter Row */}
            {summary.all.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="🔍 Search person, date, or note..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    flex: '1 1 150px',
                    padding: '7px 10px',
                    borderRadius: 10,
                    border: `1px solid ${colors.border}`,
                    background: colors.surfaceAlt,
                    color: colors.text,
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                />
                {[
                  { id: 'all', label: 'All' },
                  { id: 'given', label: '💸 Given' },
                  { id: 'taken', label: '📥 Taken' },
                ].map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDirectionFilter(d.id)}
                    style={{
                      padding: '6px 9px',
                      borderRadius: 999,
                      border: directionFilter === d.id ? '1.5px solid #f59e0b' : `1px solid ${colors.border}`,
                      background: directionFilter === d.id ? 'rgba(245, 158, 11, 0.16)' : colors.surfaceAlt,
                      color: directionFilter === d.id ? '#fbbf24' : colors.textSub,
                      fontSize: 10.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            )}

            {/* ADD / EDIT UDHAAR FORM (100% Mobile Responsive + Asks "When Did He Take?") */}
            {showForm && (
              <form
                onSubmit={handleSaveEntry}
                style={{
                  padding: '12px',
                  borderRadius: 16,
                  background: colors.surfaceAlt,
                  border: '1.5px solid rgba(245, 158, 11, 0.5)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  boxSizing: 'border-box',
                  width: '100%',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 950, color: '#fbbf24' }}>
                    {editingId ? '✏️ Edit Udhaar Details' : '🤝 Add New Udhaar Entry'}
                  </span>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {[
                      { id: 'given', label: '💸 He Took (Owes Me)' },
                      { id: 'taken', label: '📥 I Took (I Owe)' },
                    ].map((dir) => (
                      <button
                        key={dir.id}
                        type="button"
                        onClick={() => setDraftDirection(dir.id)}
                        style={{
                          padding: '4px 9px',
                          borderRadius: 999,
                          border: draftDirection === dir.id ? '1.5px solid #10b981' : `1px solid ${colors.border}`,
                          background: draftDirection === dir.id ? 'rgba(16, 185, 129, 0.18)' : colors.surface,
                          color: draftDirection === dir.id ? '#34d399' : colors.textSub,
                          fontSize: 10.5,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        {dir.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Person Name & Amount */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 800, color: colors.textSub }}>
                      👤 Person Name *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Ravi / Suresh"
                      value={draftPerson}
                      onChange={(e) => setDraftPerson(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '9px 10px',
                        borderRadius: 10,
                        border: `1px solid ${colors.border}`,
                        background: colors.surface,
                        color: colors.text,
                        fontSize: 12.5,
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 10.5, fontWeight: 800, color: colors.textSub }}>
                      💰 Total Amount (₹) *
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 500"
                      value={draftAmount}
                      onChange={(e) => setDraftAmount(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '9px 10px',
                        borderRadius: 10,
                        border: `1px solid ${colors.border}`,
                        background: colors.surface,
                        color: colors.text,
                        fontSize: 12.5,
                        fontWeight: 800,
                      }}
                    />
                  </div>
                </div>

                {/* WHEN DID HE TAKE? (Date + Quick Chips + Time) */}
                <div
                  style={{
                    padding: '10px',
                    borderRadius: 12,
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 900, color: '#34d399' }}>
                      📅 When Did He Take? (Date &amp; Time)
                    </label>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Today', date: todayIso },
                        { label: 'Yesterday', date: yesterdayIso },
                        {
                          label: '2 Days Ago',
                          date: (() => {
                            const d = new Date(`${todayIso}T12:00:00`);
                            d.setDate(d.getDate() - 2);
                            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          })(),
                        },
                      ].map((chip) => {
                        const active = draftTookDate === chip.date;
                        return (
                          <button
                            key={chip.label}
                            type="button"
                            onClick={() => setDraftTookDate(chip.date)}
                            style={{
                              padding: '3px 8px',
                              borderRadius: 999,
                              border: active ? '1.5px solid #10b981' : `1px solid ${colors.border}`,
                              background: active ? 'rgba(16, 185, 129, 0.18)' : colors.surfaceAlt,
                              color: active ? '#34d399' : colors.textSub,
                              fontSize: 10,
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

                  <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 8 }}>
                    <input
                      type="date"
                      value={draftTookDate}
                      onChange={(e) => setDraftTookDate(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '8px 9px',
                        borderRadius: 10,
                        border: `1px solid ${colors.border}`,
                        background: colors.surfaceAlt,
                        color: colors.text,
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    />
                    <input
                      type="time"
                      value={draftTookTime}
                      onChange={(e) => setDraftTookTime(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '8px 9px',
                        borderRadius: 10,
                        border: `1px solid ${colors.border}`,
                        background: colors.surfaceAlt,
                        color: colors.text,
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    />
                  </div>
                </div>

                {/* Extra Edit Fields: Already Paid Part-Amount, Promised Return Date, Payment Mode */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 10, fontWeight: 800, color: colors.textMuted }}>
                      💵 Already Returned (₹)
                    </label>
                    <input
                      type="number"
                      placeholder="0 (if part paid)"
                      value={draftPaidSoFar}
                      onChange={(e) => setDraftPaidSoFar(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '8px 9px',
                        borderRadius: 10,
                        border: `1px solid ${colors.border}`,
                        background: colors.surface,
                        color: colors.text,
                        fontSize: 11.5,
                        fontWeight: 700,
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <label style={{ fontSize: 10, fontWeight: 800, color: colors.textMuted }}>
                      🗓️ Promised Return Date
                    </label>
                    <input
                      type="date"
                      value={draftDueDate}
                      onChange={(e) => setDraftDueDate(e.target.value)}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '8px 9px',
                        borderRadius: 10,
                        border: `1px solid ${colors.border}`,
                        background: colors.surface,
                        color: colors.text,
                        fontSize: 11.5,
                        fontWeight: 700,
                      }}
                    />
                  </div>
                </div>

                {/* Phone, Mode & Note */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input
                    type="tel"
                    placeholder="📱 WhatsApp / Mobile No"
                    value={draftPhone}
                    onChange={(e) => setDraftPhone(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: `1px solid ${colors.border}`,
                      background: colors.surface,
                      color: colors.text,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  />
                  <select
                    value={draftPaymentMode}
                    onChange={(e) => setDraftPaymentMode(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: `1px solid ${colors.border}`,
                      background: colors.surface,
                      color: colors.text,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    <option value="UPI">💳 Mode: UPI</option>
                    <option value="Cash">💵 Mode: Cash</option>
                    <option value="PhonePe">🟣 PhonePe</option>
                    <option value="GPay">🔵 GPay</option>
                    <option value="Bank Transfer">🏦 Bank Transfer</option>
                  </select>
                </div>

                <input
                  type="text"
                  placeholder="📝 Purpose / Item / Note (e.g. Petrol, Lunch, Medical, Emergency)"
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '8px 10px',
                    borderRadius: 10,
                    border: `1px solid ${colors.border}`,
                    background: colors.surface,
                    color: colors.text,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                />

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      setEditingId('');
                    }}
                    style={{
                      flex: 1,
                      padding: '10px',
                      borderRadius: 11,
                      border: `1px solid ${colors.border}`,
                      background: colors.surface,
                      color: colors.textSub,
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    style={{
                      flex: 2,
                      padding: '10px 14px',
                      borderRadius: 11,
                      border: 'none',
                      background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                      color: '#ffffff',
                      fontSize: 12.5,
                      fontWeight: 900,
                      cursor: 'pointer',
                    }}
                  >
                    {editingId ? '💾 Update Udhaar' : '🤝 Save Udhaar'}
                  </button>
                </div>
              </form>
            )}

            {/* PARTIAL PAYMENT INLINE DRAWER */}
            {partPayTargetId && udhaarMap[partPayTargetId] && (
              <form
                onSubmit={handleRecordPartPayment}
                style={{
                  padding: '11px 12px',
                  borderRadius: 14,
                  background: colors.surfaceAlt,
                  border: '1.5px solid #34d399',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 900, color: '#34d399', display: 'flex', justifyContent: 'space-between' }}>
                  <span>💵 Record Partial Return — {udhaarMap[partPayTargetId].person}</span>
                  <button
                    type="button"
                    onClick={() => setPartPayTargetId('')}
                    style={{ background: 'transparent', border: 'none', color: colors.textMuted, cursor: 'pointer', fontWeight: 900 }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input
                    type="number"
                    placeholder="Amount Returned ₹"
                    value={partPayAmount}
                    onChange={(e) => setPartPayAmount(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 9px',
                      borderRadius: 9,
                      border: `1px solid ${colors.border}`,
                      background: colors.surface,
                      color: colors.text,
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  />
                  <input
                    type="date"
                    value={partPayDate}
                    onChange={(e) => setPartPayDate(e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '8px 9px',
                      borderRadius: 9,
                      border: `1px solid ${colors.border}`,
                      background: colors.surface,
                      color: colors.text,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Note (e.g. Sent via PhonePe)"
                    value={partPayNote}
                    onChange={(e) => setPartPayNote(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 9px',
                      borderRadius: 9,
                      border: `1px solid ${colors.border}`,
                      background: colors.surface,
                      color: colors.text,
                      fontSize: 11.5,
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      padding: '8px 14px',
                      borderRadius: 9,
                      border: 'none',
                      background: '#10b981',
                      color: '#ffffff',
                      fontWeight: 900,
                      fontSize: 11.5,
                      cursor: 'pointer',
                    }}
                  >
                    ✓ Save Part Pay
                  </button>
                </div>
              </form>
            )}

            {/* PERSON-WISE GROUPED VIEW */}
            {filterTab === 'people' ? (
              summary.peopleList.length === 0 ? (
                <div style={{ padding: 14, textAlign: 'center', fontSize: 11.5, color: colors.textMuted }}>
                  No people in Udhaar ledger yet. Tap <strong>+ Add Udhaar</strong> to start.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
                  {summary.peopleList.map((p) => (
                    <div
                      key={p.person}
                      style={{
                        padding: '11px 12px',
                        borderRadius: 14,
                        background: colors.surfaceAlt,
                        border: `1px solid ${colors.border}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 900, color: colors.text }}>
                          👤 {p.person} ({p.count} {p.count === 1 ? 'entry' : 'entries'})
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, marginTop: 2 }}>
                          Last took: {p.lastTookDate}
                          {p.settledTotal > 0 ? ` · ✅ Settled ₹${formatINR(p.settledTotal)}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="ot-tabular-nums" style={{ fontSize: 15, fontWeight: 950, color: p.givenPending > 0 ? '#fbbf24' : '#34d399' }}>
                          {p.givenPending > 0
                            ? `Owes ₹${formatINR(p.givenPending)}`
                            : p.takenPending > 0
                              ? `You Owe ₹${formatINR(p.takenPending)}`
                              : '✅ Settled'}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            openAddOrEditForm({
                              person: p.person,
                              phone: p.phone,
                              tookDate: todayIso,
                            })
                          }
                          style={{
                            padding: '5px 9px',
                            borderRadius: 8,
                            border: '1px solid rgba(245, 158, 11, 0.45)',
                            background: 'rgba(245, 158, 11, 0.14)',
                            color: '#fbbf24',
                            fontSize: 10.5,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          + Add More
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : activeItems.length === 0 ? (
              <div
                style={{
                  padding: '12px',
                  borderRadius: 12,
                  background: colors.surfaceAlt,
                  border: `1px dashed ${colors.border}`,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: colors.textMuted,
                  textAlign: 'center',
                }}
              >
                {filterTab === 'pending'
                  ? '💡 Tap "🤝" on any payment row below (or tap "+ Add Udhaar") to record who took money & when they took it.'
                  : 'No settled Udhaar entries yet.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: embedded ? 320 : 'none', overflowY: embedded ? 'auto' : 'visible' }}>
                {activeItems.map((item) => {
                  const isReturned = item.status === 'returned';
                  const totalAmt = Number(item.amount) || 0;
                  const paidAmt = Number(item.paidAmount) || 0;
                  const remAmt = isReturned ? 0 : Math.max(0, totalAmt - paidAmt);
                  const tookIso = item.tookDate || item.date || todayIso;
                  const daysAgo = Math.max(
                    0,
                    Math.round(
                      (new Date(`${todayIso}T12:00:00`).getTime() - new Date(`${tookIso}T12:00:00`).getTime()) / 86400000
                    )
                  );
                  const daysAgoBadge =
                    daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;

                  return (
                    <div
                      key={item.id}
                      style={{
                        padding: '11px 12px',
                        borderRadius: 14,
                        background: colors.surfaceAlt,
                        border: `1px solid ${
                          isReturned
                            ? 'rgba(16, 185, 129, 0.35)'
                            : item.direction === 'taken'
                              ? 'rgba(59, 130, 246, 0.45)'
                              : 'rgba(245, 158, 11, 0.4)'
                        }`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        boxSizing: 'border-box',
                      }}
                    >
                      {/* Row 1: Person Name + Direction Badge + Remaining Amount */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 14, fontWeight: 900, color: colors.text }}>
                            👤 {item.person}
                          </span>
                          <span
                            style={{
                              fontSize: 9.5,
                              fontWeight: 800,
                              padding: '2px 6px',
                              borderRadius: 6,
                              background: item.direction === 'taken' ? 'rgba(59, 130, 246, 0.16)' : 'rgba(245, 158, 11, 0.16)',
                              color: item.direction === 'taken' ? '#60a5fa' : '#fbbf24',
                            }}
                          >
                            {item.direction === 'taken' ? '📥 I Took' : '💸 He Took'}
                          </span>
                          {item.paymentMode && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted }}>
                              · {item.paymentMode}
                            </span>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div
                            className="ot-tabular-nums"
                            style={{
                              fontSize: 16,
                              fontWeight: 950,
                              color: isReturned ? '#34d399' : item.direction === 'taken' ? '#60a5fa' : '#fbbf24',
                            }}
                          >
                            ₹{formatINR(isReturned ? totalAmt : remAmt)}
                          </div>
                          {paidAmt > 0 && !isReturned && (
                            <div style={{ fontSize: 10, fontWeight: 800, color: '#34d399' }}>
                              Paid ₹{formatINR(paidAmt)} of ₹{formatINR(totalAmt)}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Row 2: Prominent "When He Took" Date Badge + Due Date + Note */}
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: 8,
                            background: 'rgba(59, 130, 246, 0.14)',
                            border: '1px solid rgba(59, 130, 246, 0.3)',
                            color: '#60a5fa',
                            fontSize: 11,
                            fontWeight: 800,
                          }}
                        >
                          📅 Took on: {tookIso} ({daysAgoBadge})
                          {item.tookTime || item.time ? ` · ${formatTime12h(item.tookTime || item.time)}` : ''}
                        </span>
                        {item.dueDate && !isReturned && (
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: 8,
                              background: 'rgba(244, 63, 94, 0.14)',
                              color: '#fb7185',
                              fontSize: 10.5,
                              fontWeight: 800,
                            }}
                          >
                            🗓️ Due: {item.dueDate}
                          </span>
                        )}
                        {item.note && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: colors.textSub }}>
                            📝 {item.note}
                          </span>
                        )}
                        {isReturned && item.returnedAt && (
                          <span style={{ fontSize: 11, fontWeight: 800, color: '#34d399' }}>
                            ✅ Settled {item.returnedAt}
                          </span>
                        )}
                      </div>

                      {Array.isArray(item.installments) && item.installments.length > 0 && (
                        <div
                          style={{
                            padding: '6px 9px',
                            borderRadius: 8,
                            background: colors.surface,
                            border: `1px dashed ${colors.border}`,
                            fontSize: 10.5,
                            fontWeight: 700,
                            color: colors.textSub,
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 6,
                          }}
                        >
                          <span style={{ color: '#34d399', fontWeight: 800 }}>💵 Part Payments:</span>
                          {item.installments.map((inst) => (
                            <span key={inst.id} style={{ padding: '1px 6px', borderRadius: 6, background: colors.surfaceAlt }}>
                              ₹{formatINR(inst.amount)} on {inst.date}
                              {inst.note ? ` (${inst.note})` : ''}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Row 3: Rich Responsive Action Buttons (Remind, Part Pay, Edit, Settled, Call, Share Card, Delete) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', width: '100%' }}>
                        {!isReturned && (
                          <button
                            type="button"
                            onClick={() => handleWhatsAppRemind(item)}
                            style={{
                              flex: '1 1 85px',
                              padding: '7px 8px',
                              borderRadius: 9,
                              border: '1px solid rgba(16, 185, 129, 0.45)',
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: '#34d399',
                              fontSize: 11,
                              fontWeight: 900,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            💬 Remind
                          </button>
                        )}
                        {!isReturned && (
                          <button
                            type="button"
                            onClick={() => {
                              setPartPayTargetId(item.id);
                              setPartPayAmount('');
                              setPartPayDate(todayIso);
                            }}
                            style={{
                              flex: '1 1 80px',
                              padding: '7px 8px',
                              borderRadius: 9,
                              border: '1px solid rgba(245, 158, 11, 0.45)',
                              background: 'rgba(245, 158, 11, 0.14)',
                              color: '#fbbf24',
                              fontSize: 11,
                              fontWeight: 900,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            💵 Part Pay
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleStatusChange(item.id, isReturned ? 'pending' : 'returned')}
                          style={{
                            flex: '1 1 85px',
                            padding: '7px 8px',
                            borderRadius: 9,
                            border: `1px solid ${isReturned ? colors.border : 'rgba(59, 130, 246, 0.45)'}`,
                            background: isReturned ? colors.surface : 'rgba(59, 130, 246, 0.15)',
                            color: isReturned ? colors.textSub : '#60a5fa',
                            fontSize: 11,
                            fontWeight: 900,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isReturned ? '↩️ Reopen' : '✅ Returned'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openAddOrEditForm(item)}
                          style={{
                            padding: '7px 10px',
                            borderRadius: 9,
                            border: `1px solid ${colors.border}`,
                            background: colors.surface,
                            color: colors.text,
                            fontSize: 11,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                          title="Edit person, amount, or when he took date"
                        >
                          ✏️ Edit
                        </button>
                        {item.phone && (
                          <a
                            href={`tel:${item.phone}`}
                            style={{
                              padding: '7px 9px',
                              borderRadius: 9,
                              border: `1px solid ${colors.border}`,
                              background: colors.surface,
                              color: '#34d399',
                              fontSize: 11,
                              fontWeight: 800,
                              textDecoration: 'none',
                            }}
                            title="Call Person"
                          >
                            📞
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDownloadUdhaarCardPng(item)}
                          style={{
                            padding: '7px 9px',
                            borderRadius: 9,
                            border: `1px solid ${colors.border}`,
                            background: colors.surface,
                            color: '#60a5fa',
                            fontSize: 11,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                          title="Download Udhaar Card PNG"
                        >
                          🖼️
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusChange(item.id, 'delete')}
                          style={{
                            padding: '7px 9px',
                            borderRadius: 9,
                            border: '1px solid rgba(244, 63, 94, 0.3)',
                            background: 'rgba(244, 63, 94, 0.08)',
                            color: '#fb7185',
                            fontSize: 11,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                          title="Delete entry"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Friend's Standalone Udhaar APK Download / Share Bar */}
            {embedded && (
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 12,
                  background: colors.surfaceAlt,
                  border: `1px dashed ${colors.border}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, color: colors.textSub }}>
                  📱 Want Udhaar-Only APK for your friend? (No OT/Salary)
                </span>
                <a
                  href="https://raw.githubusercontent.com/Yasin144/female-presentator/main/ota/Udhaar-Tracker-Pro-Friend.apk"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '5px 11px',
                    borderRadius: 999,
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: '#ffffff',
                    fontSize: 11,
                    fontWeight: 900,
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  ⬇️ Download Friend Udhaar APK
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
