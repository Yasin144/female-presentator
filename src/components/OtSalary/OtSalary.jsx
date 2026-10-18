import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { buildStandaloneOtMobileAppHtml } from './otMobileAppGenerator';

const LS_OT_SALARY_KEY = 'pp_ot_salary_tracker_v1';

const DEFAULT_SETTINGS = {
  monthlySalary: 25000,
  officeStartTime: '10:00',
  officeEndTime: '18:30',
  monthDaysMode: '30', // '30' | 'actual' | '26'
  otRateMode: 'auto', // 'auto' | '1.5x' | '2.0x' | 'custom'
  customOtHourlyRate: 100,
  otTimeCalcMode: 'in_out_duration', // 'in_out_duration' (Exit - Enter - 8h30m) | 'after_office_end' (Exit - 06:30 PM)
  deductShortHours: false, // If true and worked < 8h30m on a Present day, deduct short time from day pay
};

function parseTimeToMinutes(timeStr, fallbackMinutes = 600) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(timeStr || '').trim());
  if (!m) return fallbackMinutes;
  const hh = Math.max(0, Math.min(23, Number(m[1]) || 0));
  const mm = Math.max(0, Math.min(59, Number(m[2]) || 0));
  return hh * 60 + mm;
}

function minutesToTimeInput(totalMinutes) {
  const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hh = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function formatTime12h(timeStr) {
  const mins = parseTimeToMinutes(timeStr, -1);
  if (mins < 0) return timeStr || '--:--';
  const hh24 = Math.floor(mins / 60);
  const mm = mins % 60;
  const period = hh24 >= 12 ? 'PM' : 'AM';
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${String(hh12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${period}`;
}

function splitTime12hParts(timeStr, fallback = '10:00') {
  const mins = parseTimeToMinutes(timeStr, parseTimeToMinutes(fallback, 600));
  const hh24 = Math.floor(mins / 60);
  const mm = mins % 60;
  const period = hh24 >= 12 ? 'PM' : 'AM';
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return {
    hour12: hh12,
    minute: mm,
    period,
  };
}

function combineTime12hParts(hour12, minute, period) {
  const h = Math.max(1, Math.min(12, Number(hour12) || 12));
  const m = Math.max(0, Math.min(59, Number(minute) || 0));
  const p = String(period || 'AM').toUpperCase() === 'PM' ? 'PM' : 'AM';
  let hh24 = h % 12;
  if (p === 'PM') hh24 += 12;
  return `${String(hh24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getCurrentTime24h() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

const STORAGE_KEY = LS_OT_SALARY_KEY;
const parseTimeMinutes = parseTimeToMinutes;
const minutesToHHMM = minutesToTimeInput;
const getNowTimeHHMM = getCurrentTime24h;
const generateStandaloneOtMobileHtml = buildStandaloneOtMobileAppHtml;

function triggerBiometricHaptic(durationMs = 85) {
  try {
    if (typeof window !== 'undefined' && window.PattanBiometric && typeof window.PattanBiometric.vibrate === 'function') {
      window.PattanBiometric.vibrate(durationMs);
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([35, 25, durationMs]);
    }
  } catch (_) {}
}

function playBiometricBeep(direction = 'in') {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(direction === 'in' ? 880 : 740, now);
    osc1.frequency.setValueAtTime(direction === 'in' ? 1320 : 1175, now + 0.09);
    gain1.gain.setValueAtTime(0.14, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);
    setTimeout(() => {
      try { ctx.close(); } catch (_) {}
    }, 350);
  } catch (_) {}
}

async function requestAndroidHardwareBiometric(actionType, title, subtitle) {
  // 1. Native Android APK Bridge (uses real phone unlock Fingerprint / Face / Screen Lock)
  if (
    typeof window !== 'undefined' &&
    window.PattanBiometric &&
    typeof window.PattanBiometric.authenticate === 'function'
  ) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('pattan-biometric-result', onResult);
        resolve(result);
      };
      const timer = setTimeout(() => {
        finish({ ok: false, fallback: false, method: 'timeout', error: 'Biometric unlock timed out' });
      }, 30000);
      const onResult = (ev) => {
        clearTimeout(timer);
        const detail = ev?.detail || {};
        finish({
          ok: Boolean(detail.ok),
          fallback: Boolean(detail.fallback),
          method: detail.method || 'android-hardware-biometric',
          error: detail.error || '',
        });
      };
      window.addEventListener('pattan-biometric-result', onResult);
      try {
        window.PattanBiometric.authenticate(actionType, title, subtitle);
      } catch (err) {
        clearTimeout(timer);
        finish({ ok: false, fallback: false, method: 'error', error: err?.message || 'Biometric error' });
      }
    });
  }

  // 2. Mobile Browser / Desktop WebAuthn Platform Authenticator (triggers real Phone / Device Unlock)
  if (
    typeof window !== 'undefined' &&
    window.PublicKeyCredential &&
    navigator.credentials &&
    typeof navigator.credentials.create === 'function'
  ) {
    try {
      const challenge = new Uint8Array(32);
      if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(challenge);
      }
      const userId = new Uint8Array(16);
      userId[0] = 1;
      await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: 'OT & Salary Tracker' },
          user: {
            id: userId,
            name: 'employee@ot-tracker.local',
            displayName: title || 'Office Attendance Unlock',
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
          },
          timeout: 30000,
        },
      });
      return { ok: true, fallback: false, method: 'webauthn-device-unlock' };
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        return { ok: false, fallback: false, method: 'canceled', error: 'Phone biometric unlock was cancelled' };
      }
    }
  }

  return { ok: true, fallback: true, method: 'touch-sensor-pad' };
}

function formatINR(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMinutesReadable(totalMinutes, showZero = true) {
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0 && m === 0) return showZero ? '0 hr 00 min' : '0m';
  if (h === 0) return `${m} ${m === 1 ? 'min' : 'mins'}`;
  if (m === 0) return `${h} ${h === 1 ? 'hr' : 'hrs'}`;
  return `${h} ${h === 1 ? 'hr' : 'hrs'} ${m} ${m === 1 ? 'min' : 'mins'}`;
}

function formatMinutesCompact(totalMinutes) {
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0 && m === 0) return '0h 00m';
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function formatHoursLabel(hours) {
  const h = Math.max(0, Number(hours) || 0);
  const totalMins = Math.round(h * 60);
  return formatMinutesReadable(totalMins);
}

function getTodayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getDaysInYearMonth(yearMonth) {
  const [yStr, mStr] = String(yearMonth || '').split('-');
  const year = Number(yStr) || new Date().getFullYear();
  const month = Number(mStr) || (new Date().getMonth() + 1);
  return new Date(year, month, 0).getDate();
}

function buildMonthDates(yearMonth) {
  const [yStr, mStr] = String(yearMonth || '').split('-');
  const year = Number(yStr) || new Date().getFullYear();
  const month = Number(mStr) || (new Date().getMonth() + 1);
  const count = new Date(year, month, 0).getDate();
  const list = [];
  for (let d = 1; d <= count; d += 1) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dt = new Date(year, month - 1, d);
    const dayName = dt.toLocaleDateString('en-US', { weekday: 'short' });
    const fullDateLabel = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const isSunday = dt.getDay() === 0;
    list.push({ iso, dayNumber: d, dayName, fullDateLabel, isSunday });
  }
  return list;
}

function loadInitialStore() {
  try {
    const raw = localStorage.getItem(LS_OT_SALARY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        settings: { ...DEFAULT_SETTINGS, ...(parsed?.settings || {}) },
        days: parsed?.days && typeof parsed.days === 'object' ? parsed.days : {},
      };
    }
  } catch (_) {}
  return {
    settings: { ...DEFAULT_SETTINGS },
    days: {},
  };
}

// Calculate worked minutes, regular shift minutes, extra OT minutes, and short minutes from Enter Time & Exit Time
function calculateWorkTiming({
  inTime,
  outTime,
  status = 'present',
  officeStartTime = '10:00',
  officeEndTime = '18:30',
  otTimeCalcMode = 'in_out_duration',
}) {
  const officeStartMins = parseTimeToMinutes(officeStartTime, 10 * 60);
  const officeEndMins = parseTimeToMinutes(officeEndTime, 18 * 60 + 30);
  const standardShiftMins = officeEndMins >= officeStartMins
    ? (officeEndMins - officeStartMins)
    : (1440 - officeStartMins + officeEndMins);

  if (status === 'leave') {
    return {
      inMins: officeStartMins,
      outMins: officeEndMins,
      workedMins: 0,
      standardShiftMins,
      regularWorkedMins: 0,
      otMins: 0,
      shortMins: standardShiftMins,
      workedHours: 0,
      otHours: 0,
      shortHours: standardShiftMins / 60,
    };
  }

  const inMins = parseTimeToMinutes(inTime, officeStartMins);
  const outMins = parseTimeToMinutes(outTime, officeEndMins);
  const workedMins = outMins >= inMins ? (outMins - inMins) : (1440 - inMins + outMins);

  if (status === 'ot_only') {
    // Extra work only day (e.g. Sunday extra work) -> entire Enter to Exit duration is OT
    return {
      inMins,
      outMins,
      workedMins,
      standardShiftMins,
      regularWorkedMins: 0,
      otMins: workedMins,
      shortMins: 0,
      workedHours: workedMins / 60,
      otHours: workedMins / 60,
      shortHours: 0,
    };
  }

  if (status === 'holiday_paid') {
    // Paid holiday: if Enter & Exit equal standard default and not explicitly worked OT, 0 OT;
    // otherwise if outMins > officeEndMins, count extra time
    const extraAfterEnd = Math.max(0, workedMins - standardShiftMins);
    return {
      inMins,
      outMins,
      workedMins,
      standardShiftMins,
      regularWorkedMins: standardShiftMins,
      otMins: extraAfterEnd,
      shortMins: 0,
      workedHours: workedMins / 60,
      otHours: extraAfterEnd / 60,
      shortHours: 0,
    };
  }

  const targetDutyMins = status === 'half' ? Math.round(standardShiftMins / 2) : standardShiftMins;

  let otMins = 0;
  let shortMins = 0;

  if (otTimeCalcMode === 'after_office_end' && status === 'present') {
    // Count time worked after 06:30 PM + any early arrival before 10:00 AM
    const afterEnd = outMins >= officeEndMins ? (outMins - officeEndMins) : 0;
    const beforeStart = inMins < officeStartMins ? (officeStartMins - inMins) : 0;
    otMins = Math.max(0, afterEnd + beforeStart);
    shortMins = Math.max(0, targetDutyMins - workedMins);
  } else {
    // Default 'in_out_duration': Total Time (Exit - Enter) minus Duty Shift (8h 30m)
    otMins = Math.max(0, workedMins - targetDutyMins);
    shortMins = Math.max(0, targetDutyMins - workedMins);
  }

  const regularWorkedMins = Math.min(workedMins, targetDutyMins);

  return {
    inMins,
    outMins,
    workedMins,
    standardShiftMins,
    regularWorkedMins,
    otMins,
    shortMins,
    workedHours: workedMins / 60,
    otHours: otMins / 60,
    shortHours: shortMins / 60,
  };
}

function Time12hPicker({ label, badgeText, value, onChange, accentColor = '#38bdf8', quickOptions = [] }) {
  const parts = splitTime12hParts(value);
  const hoursList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const minutesList = Array.from({ length: 60 }, (_, i) => i);

  const handlePartChange = (nextHour, nextMinute, nextPeriod) => {
    const next24 = combineTime12hParts(nextHour, nextMinute, nextPeriod);
    onChange(next24);
  };

  return (
    <div style={{
      padding: '12px 14px',
      borderRadius: 12,
      background: '#090d16',
      border: `1px solid ${accentColor}55`,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 900, color: '#f8fafc', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
        </span>
        <span style={{
          padding: '2px 8px',
          borderRadius: 999,
          background: `${accentColor}22`,
          border: `1px solid ${accentColor}66`,
          color: accentColor,
          fontSize: 11,
          fontWeight: 900,
        }}>
          {formatTime12h(value)}
        </span>
      </div>

      {/* 12-Hour Dropdowns + Native Time Input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Hour 1-12 */}
        <select
          value={parts.hour12}
          onChange={(e) => handlePartChange(Number(e.target.value), parts.minute, parts.period)}
          title="Hour"
          style={{
            padding: '8px 8px',
            borderRadius: 8,
            border: '1px solid rgba(148,163,184,0.32)',
            background: '#0f172a',
            color: '#fff',
            fontWeight: 900,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          {hoursList.map((h) => (
            <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
          ))}
        </select>

        <span style={{ fontWeight: 900, fontSize: 16, color: '#94a3b8' }}>:</span>

        {/* Minute 00-59 */}
        <select
          value={parts.minute}
          onChange={(e) => handlePartChange(parts.hour12, Number(e.target.value), parts.period)}
          title="Minute"
          style={{
            padding: '8px 8px',
            borderRadius: 8,
            border: '1px solid rgba(148,163,184,0.32)',
            background: '#0f172a',
            color: '#fff',
            fontWeight: 900,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          {minutesList.map((m) => (
            <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
          ))}
        </select>

        {/* AM / PM Toggle Buttons */}
        <div style={{
          display: 'inline-flex',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid rgba(148,163,184,0.32)',
        }}>
          {['AM', 'PM'].map((p) => {
            const active = parts.period === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => handlePartChange(parts.hour12, parts.minute, p)}
                style={{
                  padding: '8px 10px',
                  border: 0,
                  background: active ? accentColor : '#0f172a',
                  color: active ? '#041019' : '#94a3b8',
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {p}
              </button>
            );
          })}
        </div>

        {/* Direct Keyboard Time Input */}
        <input
          type="time"
          value={value}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
          title="Type exact time"
          style={{
            marginLeft: 'auto',
            padding: '7px 9px',
            borderRadius: 8,
            border: '1px solid rgba(148,163,184,0.25)',
            background: '#0f172a',
            color: '#cbd5e1',
            fontWeight: 800,
            fontSize: 12,
          }}
        />
      </div>

      {/* Quick Presets */}
      {quickOptions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 2 }}>
          {quickOptions.map((opt) => {
            const isSelected = opt.time === value;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => onChange(opt.time === 'NOW' ? getCurrentTime24h() : opt.time)}
                style={{
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: isSelected ? `1px solid ${accentColor}` : '1px solid rgba(148,163,184,0.2)',
                  background: isSelected ? `${accentColor}28` : 'rgba(255,255,255,0.04)',
                  color: isSelected ? '#fff' : '#94a3b8',
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {badgeText && (
        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>
          {badgeText}
        </div>
      )}
    </div>
  );
}

export default function OtSalary({ onClose, standaloneMobile = false }) {
  const initialStore = useMemo(loadInitialStore, []);
  const [settings, setSettings] = useState(initialStore.settings);
  const [daysMap, setDaysMap] = useState(initialStore.days);
  const [selectedDate, setSelectedDate] = useState(getTodayIsoDate);
  const [selectedMonth, setSelectedMonth] = useState(() => getTodayIsoDate().slice(0, 7));
  const [viewFilter, setViewFilter] = useState('all'); // 'all' | 'saved' | 'ot_only'
  const [saveNotice, setSaveNotice] = useState('');
  const [diskPath, setDiskPath] = useState('');
  const [wifiOtUrl, setWifiOtUrl] = useState('');
  const [mobileOtUrl, setMobileOtUrl] = useState('');
  const [pcSyncIpInput, setPcSyncIpInput] = useState(() => {
    try { return localStorage.getItem('pattan.ot.syncServerUrl') || ''; } catch (_) { return ''; }
  });
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncStatusText, setSyncStatusText] = useState('');
  const mobileConnectInfo = useMemo(() => ({
    otUrl: mobileOtUrl || wifiOtUrl || (typeof window !== 'undefined' ? `${window.location.origin}/ot` : ''),
    qrDataUrl: '',
  }), [mobileOtUrl, wifiOtUrl]);
  const [mobileMode, setMobileMode] = useState(() => {
    if (standaloneMobile) return true;
    return typeof window !== 'undefined' && window.innerWidth <= 820;
  });
  const [mobileTab, setMobileTab] = useState('today'); // 'today' | 'month' | 'summary' | 'rules'
  const [mobileDaysLayout, setMobileDaysLayout] = useState(() => (
    standaloneMobile || (typeof window !== 'undefined' && window.innerWidth <= 820) ? 'cards' : 'table'
  ));
  const [showMobileAppModal, setShowMobileAppModal] = useState(false);

  // Form state for the currently selected date in the Daily Calculator card
  const [entryStatus, setEntryStatus] = useState('present'); // 'present' | 'half' | 'holiday_paid' | 'ot_only' | 'leave'
  const [entryInTime, setEntryInTime] = useState(DEFAULT_SETTINGS.officeStartTime);
  const [entryOutTime, setEntryOutTime] = useState(DEFAULT_SETTINGS.officeEndTime);
  const [entryOtHours, setEntryOtHours] = useState(0);
  const [entryBonus, setEntryBonus] = useState(0);
  const [entryNote, setEntryNote] = useState('');
  const [entryBiometricIn, setEntryBiometricIn] = useState(false);
  const [entryBiometricOut, setEntryBiometricOut] = useState(false);

  // Biometric Touch Sensor state (defaults to Phone Unlock Hardware Biometric)
  const [biometricSensorMode, setBiometricSensorMode] = useState('hardware');
  const [biometricScanState, setBiometricScanState] = useState({
    active: false,
    direction: '',
    progress: 0,
    statusText: 'Tap IN when arriving · Tap OUT when leaving (Uses Phone Unlock Biometric)',
    lastVerifiedText: '',
  });
  const [liveClockHHMM, setLiveClockHHMM] = useState(getCurrentTime24h);
  const tabHistoryRef = useRef(['today']);
  const touchStartRef = useRef(null);

  const navigateTab = useCallback((nextTab) => {
    setMobileTab((prev) => {
      if (prev === nextTab) return prev;
      tabHistoryRef.current = [...tabHistoryRef.current.slice(-8), nextTab];
      try {
        window.history.pushState({ otSalaryGuard: true, tab: nextTab }, '');
      } catch (_) {}
      return nextTab;
    });
  }, []);

  const goBackStep = useCallback(() => {
    if (showMobileAppModal) {
      setShowMobileAppModal(false);
      return 'handled';
    }
    if (biometricScanState.active) {
      setBiometricScanState((s) => ({ ...s, active: false }));
      return 'handled';
    }
    if (tabHistoryRef.current.length > 1) {
      const nextStack = tabHistoryRef.current.slice(0, -1);
      const prevTab = nextStack[nextStack.length - 1] || 'today';
      tabHistoryRef.current = nextStack;
      setMobileTab(prevTab);
      return 'handled';
    }
    if (mobileTab !== 'today') {
      tabHistoryRef.current = ['today'];
      setMobileTab('today');
      return 'handled';
    }
    const todayIso = getTodayIsoDate();
    if (selectedDate !== todayIso) {
      setSelectedDate(todayIso);
      setSaveNotice('Returned to Today');
      setTimeout(() => setSaveNotice(''), 1800);
      return 'handled';
    }
    if (onClose && !standaloneMobile) {
      onClose();
      return 'handled';
    }
    return '';
  }, [showMobileAppModal, biometricScanState.active, mobileTab, selectedDate, onClose, standaloneMobile]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__handlePattanHardwareBack = goBackStep;
    return () => {
      if (window.__handlePattanHardwareBack === goBackStep) {
        delete window.__handlePattanHardwareBack;
      }
    };
  }, [goBackStep]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    try {
      window.history.replaceState({ otSalaryBase: true, tab: 'today' }, '');
      window.history.pushState({ otSalaryGuard: true, tab: 'today' }, '');
    } catch (_) {}
    const onPopState = () => {
      const res = goBackStep();
      if (res === 'handled') {
        try {
          window.history.pushState({ otSalaryGuard: true, tab: mobileTab }, '');
        } catch (_) {}
      } else {
        try {
          window.history.pushState({ otSalaryGuard: true, tab: 'today' }, '');
        } catch (_) {}
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [goBackStep, mobileTab]);

  const handleTouchStart = useCallback((e) => {
    const tag = String(e.target?.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea', 'button'].includes(tag)) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.touches?.[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
  }, []);

  const handleTouchEnd = useCallback((e) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const touch = e.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const dt = Date.now() - start.t;
    if (dt > 700 || Math.abs(dx) < 68 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    const order = ['today', 'month', 'summary', 'rules'];
    const idx = order.indexOf(mobileTab);
    if (dx > 0) {
      // Swipe right -> Go Back
      if (start.x <= 48 || idx > 0) {
        if (idx > 0) navigateTab(order[idx - 1]);
        else goBackStep();
      }
    } else if (dx < 0 && idx >= 0 && idx < order.length - 1) {
      // Swipe left -> Next Tab
      navigateTab(order[idx + 1]);
    }
  }, [mobileTab, navigateTab, goBackStep]);

  useEffect(() => {
    const clockTimer = setInterval(() => {
      setLiveClockHHMM(getCurrentTime24h());
    }, 15000);
    return () => clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    if (standaloneMobile) {
      setMobileMode(true);
      setMobileDaysLayout('cards');
      return undefined;
    }
    const onResize = () => {
      if (window.innerWidth <= 820) {
        setMobileMode(true);
        setMobileDaysLayout('cards');
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [standaloneMobile]);

  // Load from disk / sync server on mount + subscribe to live mobile/desktop updates
  useEffect(() => {
    let mounted = true;
    const applyIncomingStore = (data) => {
      if (!mounted || !data || typeof data !== 'object') return;
      const loadedSettings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
      const loadedDays = data.days && typeof data.days === 'object' ? data.days : {};
      setSettings(loadedSettings);
      setDaysMap((prev) => {
        const merged = { ...prev, ...loadedDays };
        try {
          localStorage.setItem(LS_OT_SALARY_KEY, JSON.stringify({ settings: loadedSettings, days: merged }));
        } catch (_) {}
        return merged;
      });
    };

    if (window.electronAPI && typeof window.electronAPI.loadOtSalaryData === 'function') {
      window.electronAPI.loadOtSalaryData().then((res) => {
        if (!mounted || !res || (!res.ok && !res.success)) return;
        if (res.filePath) setDiskPath(res.filePath);
        if (res.wifiOtUrl) setWifiOtUrl(res.wifiOtUrl);
        if (res.mobileOtUrl) setMobileOtUrl(res.mobileOtUrl);
        if (res.data) applyIncomingStore(res.data);
      }).catch(() => {});
    }

    let unsubscribe = null;
    if (window.electronAPI && typeof window.electronAPI.onOtSalaryUpdated === 'function') {
      unsubscribe = window.electronAPI.onOtSalaryUpdated((updatedData) => {
        applyIncomingStore(updatedData);
      });
    }
    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const persistStore = useCallback((nextSettings, nextDays, message = 'Saved') => {
    const payload = {
      settings: nextSettings,
      days: nextDays,
      updatedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(LS_OT_SALARY_KEY, JSON.stringify(payload));
    } catch (_) {}
    if (window.electronAPI && typeof window.electronAPI.saveOtSalaryData === 'function') {
      window.electronAPI.saveOtSalaryData(payload).then((res) => {
        if (res?.filePath) setDiskPath(res.filePath);
      }).catch(() => {});
    }
    if (message) {
      setSaveNotice(`${message} (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`);
    }
  }, []);

  // Derived rate math
  const rates = useMemo(() => {
    const salary = Math.max(0, Number(settings.monthlySalary) || 25000);
    const startMins = parseTimeToMinutes(settings.officeStartTime, 10 * 60);
    const endMins = parseTimeToMinutes(settings.officeEndTime, 18 * 60 + 30);
    const rawShiftMins = endMins >= startMins ? (endMins - startMins) : (1440 - startMins + endMins);
    const shiftHours = Math.max(1, rawShiftMins / 60); // 10:00 to 18:30 = 8.5 hours (510 mins)
    const actualMonthDays = getDaysInYearMonth(selectedMonth);
    const divisorDays = settings.monthDaysMode === 'actual'
      ? actualMonthDays
      : settings.monthDaysMode === '26'
        ? 26
        : 30;
    const perDaySalary = salary / divisorDays;
    const baseHourlyRate = perDaySalary / shiftHours;
    let otHourlyRate = baseHourlyRate;
    if (settings.otRateMode === '1.5x') otHourlyRate = baseHourlyRate * 1.5;
    else if (settings.otRateMode === '2.0x') otHourlyRate = baseHourlyRate * 2.0;
    else if (settings.otRateMode === 'custom') otHourlyRate = Math.max(0, Number(settings.customOtHourlyRate) || 0);

    const otPerMinuteRate = otHourlyRate / 60;

    return {
      salary,
      startMins,
      endMins,
      shiftMins: rawShiftMins,
      shiftHours,
      divisorDays,
      actualMonthDays,
      perDaySalary,
      baseHourlyRate,
      otHourlyRate,
      otPerMinuteRate,
    };
  }, [settings, selectedMonth]);

  // Load selectedDate's existing record into the Daily Calculator form when selectedDate changes
  useEffect(() => {
    const existing = daysMap[selectedDate];
    if (existing) {
      const st = existing.status || 'present';
      const inT = existing.inTime || settings.officeStartTime || '10:00';
      const outT = existing.outTime || settings.officeEndTime || '18:30';
      setEntryStatus(st);
      setEntryInTime(inT);
      setEntryOutTime(outT);
      if (existing.otHours !== undefined) {
        setEntryOtHours(Number(existing.otHours) || 0);
      } else {
        const timing = calculateWorkTiming({
          inTime: inT,
          outTime: outT,
          status: st,
          officeStartTime: settings.officeStartTime,
          officeEndTime: settings.officeEndTime,
          otTimeCalcMode: settings.otTimeCalcMode,
        });
        setEntryOtHours(Number(timing.otHours.toFixed(4)));
      }
      setEntryBonus(Number(existing.extraAllowance) || 0);
      setEntryNote(existing.note || '');
      setEntryBiometricIn(Boolean(existing.biometricIn));
      setEntryBiometricOut(Boolean(existing.biometricOut));
    } else {
      const dt = new Date(`${selectedDate}T00:00:00`);
      const isSun = !Number.isNaN(dt.getTime()) && dt.getDay() === 0;
      setEntryStatus(isSun ? 'holiday_paid' : 'present');
      setEntryInTime(settings.officeStartTime || '10:00');
      setEntryOutTime(settings.officeEndTime || '18:30');
      setEntryOtHours(0);
      setEntryBonus(0);
      setEntryNote('');
      setEntryBiometricIn(false);
      setEntryBiometricOut(false);
    }
    if (selectedDate && selectedDate.slice(0, 7) !== selectedMonth) {
      setSelectedMonth(selectedDate.slice(0, 7));
    }
  }, [selectedDate, daysMap, settings.officeStartTime, settings.officeEndTime, settings.otTimeCalcMode]);

  // Compute full timing + earnings for any day record
  const computeDayEarnings = useCallback((record) => {
    const status = record?.status || 'present';
    const inTime = record?.inTime || settings.officeStartTime || '10:00';
    const outTime = record?.outTime || settings.officeEndTime || '18:30';

    const timing = calculateWorkTiming({
      inTime,
      outTime,
      status,
      officeStartTime: settings.officeStartTime,
      officeEndTime: settings.officeEndTime,
      otTimeCalcMode: settings.otTimeCalcMode,
    });

    const otHours = record?.otHours !== undefined
      ? Math.max(0, Number(record.otHours) || 0)
      : timing.otHours;
    const otMins = Math.round(otHours * 60);
    const extraAllowance = Math.max(0, Number(record?.extraAllowance) || 0);

    let basePay = rates.perDaySalary;
    if (status === 'half') basePay = rates.perDaySalary * 0.5;
    else if (status === 'leave' || status === 'ot_only') basePay = 0;
    else if (status === 'holiday_paid' || status === 'present') basePay = rates.perDaySalary;

    let shortDeduction = 0;
    if (settings.deductShortHours && (status === 'present' || status === 'half') && timing.shortMins > 0) {
      shortDeduction = (timing.shortMins / 60) * rates.baseHourlyRate;
      basePay = Math.max(0, basePay - shortDeduction);
    }

    const otPay = otHours * rates.otHourlyRate;
    const totalPay = basePay + otPay + extraAllowance;

    return {
      basePay,
      shortDeduction,
      otHours,
      otMins,
      otPay,
      extraAllowance,
      totalPay,
      workedMins: timing.workedMins,
      regularWorkedMins: timing.regularWorkedMins,
      shortMins: timing.shortMins,
      standardShiftMins: timing.standardShiftMins,
    };
  }, [rates, settings.officeStartTime, settings.officeEndTime, settings.otTimeCalcMode, settings.deductShortHours]);

  // Live preview for the active daily form
  const activeDayPreview = useMemo(() => {
    return computeDayEarnings({
      status: entryStatus,
      inTime: entryInTime,
      outTime: entryOutTime,
      otHours: entryOtHours,
      extraAllowance: entryBonus,
    });
  }, [computeDayEarnings, entryStatus, entryInTime, entryOutTime, entryOtHours, entryBonus]);

  // Recalculate OT automatically whenever Enter Time, Exit Time, or Status changes
  const recalculateFromTimes = useCallback((nextInTime, nextOutTime, nextStatus) => {
    const timing = calculateWorkTiming({
      inTime: nextInTime,
      outTime: nextOutTime,
      status: nextStatus,
      officeStartTime: settings.officeStartTime,
      officeEndTime: settings.officeEndTime,
      otTimeCalcMode: settings.otTimeCalcMode,
    });
    setEntryOtHours(Number((timing.otMins / 60).toFixed(4)));
  }, [settings.officeStartTime, settings.officeEndTime, settings.otTimeCalcMode]);

  const handleInTimeChange = (newInTime) => {
    setEntryInTime(newInTime);
    recalculateFromTimes(newInTime, entryOutTime, entryStatus);
  };

  const handleOutTimeChange = (newOutTime) => {
    setEntryOutTime(newOutTime);
    recalculateFromTimes(entryInTime, newOutTime, entryStatus);
  };

  const handleStatusChange = (newStatus) => {
    setEntryStatus(newStatus);
    recalculateFromTimes(entryInTime, entryOutTime, newStatus);
  };

  const handleOtHoursPresetOrInput = (hoursValue) => {
    const cleanHours = Math.max(0, Number(hoursValue) || 0);
    setEntryOtHours(cleanHours);
    const inMins = parseTimeToMinutes(entryInTime, rates.startMins);
    const dutyMins = entryStatus === 'ot_only'
      ? 0
      : entryStatus === 'half'
        ? Math.round(rates.shiftMins / 2)
        : rates.shiftMins;
    const targetOutMins = inMins + dutyMins + Math.round(cleanHours * 60);
    setEntryOutTime(minutesToTimeInput(targetOutMins));
  };

  // Save the active day calculation
  const saveActiveDayRecord = () => {
    if (!selectedDate) return;
    const existing = daysMap[selectedDate] || {};
    const calc = computeDayEarnings({
      status: entryStatus,
      inTime: entryInTime,
      outTime: entryOutTime,
      otHours: entryOtHours,
      extraAllowance: entryBonus,
    });
    const record = {
      ...existing,
      date: selectedDate,
      status: entryStatus,
      inTime: entryInTime,
      outTime: entryOutTime,
      workedMins: calc.workedMins,
      otHours: Number(entryOtHours) || 0,
      extraAllowance: Number(entryBonus) || 0,
      note: String(entryNote || '').trim(),
      biometricIn: Boolean(entryBiometricIn),
      biometricOut: Boolean(entryBiometricOut),
      biometricInAt: entryBiometricIn ? (existing.biometricInAt || new Date().toISOString()) : null,
      biometricOutAt: entryBiometricOut ? (existing.biometricOutAt || new Date().toISOString()) : null,
      basePaySnapshot: Number(calc.basePay.toFixed(2)),
      otPaySnapshot: Number(calc.otPay.toFixed(2)),
      totalPaySnapshot: Number(calc.totalPay.toFixed(2)),
      savedAt: new Date().toISOString(),
    };
    const nextDays = { ...daysMap, [selectedDate]: record };
    setDaysMap(nextDays);
    persistStore(settings, nextDays, `Saved ${selectedDate} (${formatTime12h(entryInTime)} – ${formatTime12h(entryOutTime)})`);
  };

  // Quick update a row directly from the monthly table (including Enter Time / Exit Time changes!)
  const upsertDayFromTable = (isoDate, patch) => {
    const existing = daysMap[isoDate] || {
      date: isoDate,
      status: new Date(`${isoDate}T00:00:00`).getDay() === 0 ? 'holiday_paid' : 'present',
      inTime: settings.officeStartTime || '10:00',
      outTime: settings.officeEndTime || '18:30',
      otHours: 0,
      extraAllowance: 0,
      note: '',
    };
    const merged = { ...existing, ...patch };

    // If Enter Time or Exit Time or Status was changed in the table, auto-calculate OT hours from Enter & Exit time!
    if (patch.inTime !== undefined || patch.outTime !== undefined || (patch.status !== undefined && patch.otHours === undefined)) {
      const timing = calculateWorkTiming({
        inTime: merged.inTime,
        outTime: merged.outTime,
        status: merged.status,
        officeStartTime: settings.officeStartTime,
        officeEndTime: settings.officeEndTime,
        otTimeCalcMode: settings.otTimeCalcMode,
      });
      merged.otHours = Number((timing.otMins / 60).toFixed(4));
      merged.workedMins = timing.workedMins;
    } else if (patch.otHours !== undefined && patch.outTime === undefined) {
      const inMins = parseTimeToMinutes(merged.inTime, rates.startMins);
      const dutyMins = merged.status === 'ot_only'
        ? 0
        : merged.status === 'half'
          ? Math.round(rates.shiftMins / 2)
          : rates.shiftMins;
      const targetOutMins = inMins + dutyMins + Math.round(Math.max(0, Number(patch.otHours) || 0) * 60);
      merged.outTime = minutesToTimeInput(targetOutMins);
    }

    const calc = computeDayEarnings(merged);
    merged.workedMins = calc.workedMins;
    merged.basePaySnapshot = Number(calc.basePay.toFixed(2));
    merged.otPaySnapshot = Number(calc.otPay.toFixed(2));
    merged.totalPaySnapshot = Number(calc.totalPay.toFixed(2));
    merged.savedAt = new Date().toISOString();

    const nextDays = { ...daysMap, [isoDate]: merged };
    setDaysMap(nextDays);
    persistStore(settings, nextDays, `Saved ${isoDate}`);
  };

  const deleteSavedDay = (isoDate) => {
    if (!daysMap[isoDate]) return;
    const nextDays = { ...daysMap };
    delete nextDays[isoDate];
    setDaysMap(nextDays);
    persistStore(settings, nextDays, `Removed ${isoDate}`);
  };

  const updateSetting = (key, value) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    persistStore(next, daysMap, 'Updated salary settings');
  };

  // Build rows for the selected month
  const monthRows = useMemo(() => {
    const calendarDays = buildMonthDates(selectedMonth);
    return calendarDays.map((dayInfo) => {
      const saved = daysMap[dayInfo.iso] || null;
      const effectiveRecord = saved || {
        date: dayInfo.iso,
        status: dayInfo.isSunday ? 'holiday_paid' : 'present',
        inTime: settings.officeStartTime || '10:00',
        outTime: settings.officeEndTime || '18:30',
        otHours: 0,
        extraAllowance: 0,
        note: '',
      };
      const earnings = computeDayEarnings(effectiveRecord);
      return {
        ...dayInfo,
        isSaved: Boolean(saved),
        record: effectiveRecord,
        earnings,
      };
    });
  }, [selectedMonth, daysMap, settings.officeStartTime, settings.officeEndTime, computeDayEarnings]);

  const filteredMonthRows = useMemo(() => {
    if (viewFilter === 'saved') return monthRows.filter((r) => r.isSaved);
    if (viewFilter === 'ot_only') return monthRows.filter((r) => r.earnings.otMins > 0 || r.record.extraAllowance > 0);
    return monthRows;
  }, [monthRows, viewFilter]);

  // Monthly totals summary
  const monthSummary = useMemo(() => {
    let savedDaysCount = 0;
    let savedBaseTotal = 0;
    let totalWorkedMins = 0;
    let totalOtMins = 0;
    let totalOtHours = 0;
    let totalOtPay = 0;
    let totalExtraAllowance = 0;
    let leaveDays = 0;
    let halfDays = 0;
    let otDaysCount = 0;
    let biometricBothCount = 0;
    let biometricPendingOutCount = 0;

    for (const row of monthRows) {
      if (row.isSaved) {
        savedDaysCount += 1;
        savedBaseTotal += row.earnings.basePay;
        totalWorkedMins += row.earnings.workedMins;
      }
      if (row.record.biometricIn && row.record.biometricOut) {
        biometricBothCount += 1;
      } else if (row.record.biometricIn && !row.record.biometricOut) {
        biometricPendingOutCount += 1;
      }
      if (row.record.status === 'leave') leaveDays += 1;
      if (row.record.status === 'half') halfDays += 1;
      if (row.earnings.otMins > 0) {
        otDaysCount += 1;
        totalOtMins += row.earnings.otMins;
        totalOtHours += row.earnings.otHours;
        totalOtPay += row.earnings.otPay;
      }
      if (row.record.extraAllowance > 0) {
        totalExtraAllowance += row.record.extraAllowance;
      }
    }

    const leaveDeduction = (leaveDays * rates.perDaySalary) + (halfDays * rates.perDaySalary * 0.5);
    const fullMonthBaseAfterLeave = Math.max(0, rates.salary - leaveDeduction);
    const fullMonthNetPayable = fullMonthBaseAfterLeave + totalOtPay + totalExtraAllowance;
    const savedDaysNetTotal = savedBaseTotal + totalOtPay + totalExtraAllowance;

    return {
      savedDaysCount,
      savedBaseTotal,
      savedDaysNetTotal,
      totalWorkedMins,
      totalOtMins,
      totalOtHours,
      totalOtPay,
      totalExtraAllowance,
      otDaysCount,
      leaveDays,
      halfDays,
      leaveDeduction,
      fullMonthBaseAfterLeave,
      fullMonthNetPayable,
      biometricBothCount,
      biometricPendingOutCount,
    };
  }, [monthRows, rates]);

  const saveAllMonthDays = () => {
    const nextDays = { ...daysMap };
    const nowIso = new Date().toISOString();
    for (const row of monthRows) {
      if (!nextDays[row.iso]) {
        nextDays[row.iso] = {
          date: row.iso,
          status: row.isSunday ? 'holiday_paid' : 'present',
          inTime: settings.officeStartTime || '10:00',
          outTime: settings.officeEndTime || '18:30',
          workedMins: row.earnings.workedMins,
          otHours: 0,
          extraAllowance: 0,
          note: '',
          basePaySnapshot: Number(row.earnings.basePay.toFixed(2)),
          otPaySnapshot: 0,
          totalPaySnapshot: Number(row.earnings.totalPay.toFixed(2)),
          savedAt: nowIso,
        };
      }
    }
    setDaysMap(nextDays);
    persistStore(settings, nextDays, `Saved all ${monthRows.length} days for ${selectedMonth}`);
  };

  const exportMonthCsv = () => {
    const headers = [
      'Date',
      'Day',
      'Saved',
      'Status',
      'Enter Time',
      'Exit Time',
      'Biometric IN Sensor',
      'Biometric OUT Sensor',
      'Total Worked Time',
      'Extra OT Time',
      'Extra OT Hours (Decimal)',
      'Base Day Salary (INR)',
      'Extra OT Pay (INR)',
      'Extra Bonus (INR)',
      'Total Day Salary (INR)',
      'Notes',
    ];
    const lines = [headers.join(',')];
    for (const row of monthRows) {
      const r = row.record;
      const e = row.earnings;
      const cols = [
        row.iso,
        row.dayName,
        row.isSaved ? 'YES' : 'NO',
        r.status,
        formatTime12h(r.inTime),
        formatTime12h(r.outTime),
        r.biometricIn ? 'VERIFIED' : 'NO',
        r.biometricOut ? 'VERIFIED' : 'NO',
        `"${formatMinutesReadable(e.workedMins)}"`,
        `"${formatMinutesReadable(e.otMins)}"`,
        e.otHours.toFixed(2),
        e.basePay.toFixed(2),
        e.otPay.toFixed(2),
        e.extraAllowance.toFixed(2),
        e.totalPay.toFixed(2),
        `"${String(r.note || '').replace(/"/g, '""')}"`,
      ];
      lines.push(cols.join(','));
    }
    lines.push('');
    lines.push(`"Monthly Base Salary",${rates.salary.toFixed(2)}`);
    lines.push(`"Total Extra OT Time","${formatMinutesReadable(monthSummary.totalOtMins)}"`);
    lines.push(`"Total Extra OT Money",${monthSummary.totalOtPay.toFixed(2)}`);
    lines.push(`"Biometric Verified Days",${monthSummary.biometricBothCount}`);
    lines.push(`"Leave Deductions",${monthSummary.leaveDeduction.toFixed(2)}`);
    lines.push(`"Final Total Salary Receivable",${monthSummary.fullMonthNetPayable.toFixed(2)}`);

    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OT-Salary-Report-${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 1-Tap & Biometric Touch Sensor Live Mobile Punch Actions
  const punchEnterNowAndSave = (isBiometric = false, methodUsed = 'touch-sensor') => {
    const todayIso = getTodayIsoDate();
    const nowHHMM = getNowTimeHHMM();
    setLiveClockHHMM(nowHHMM);
    const existing = daysMap[todayIso];
    const outTime = existing?.outTime || settings.officeEndTime || '18:30';
    const status = existing?.status || 'present';
    const inM = parseTimeMinutes(nowHHMM, 10 * 60);
    const outM = parseTimeMinutes(outTime, 18 * 60 + 30);
    const worked = Math.max(0, outM - inM);
    const otMins = status === 'ot_only' ? worked : Math.max(0, worked - rates.shiftMins);
    const extraAllowance = Number(existing?.extraAllowance ?? existing?.extraBonus) || 0;
    const nowIso = new Date().toISOString();
    const nextDays = {
      ...daysMap,
      [todayIso]: {
        ...existing,
        date: todayIso,
        status,
        inTime: nowHHMM,
        outTime,
        workedMins: worked,
        otHours: Number((otMins / 60).toFixed(4)),
        note: existing?.note || '',
        extraAllowance,
        biometricIn: isBiometric ? true : Boolean(existing?.biometricIn),
        biometricOut: Boolean(existing?.biometricOut),
        biometricInAt: isBiometric ? nowIso : (existing?.biometricInAt || null),
        biometricInMethod: isBiometric ? methodUsed : (existing?.biometricInMethod || ''),
        savedAt: nowIso,
        updatedAt: nowIso,
      },
    };
    setSelectedDate(todayIso);
    setSelectedMonth(todayIso.slice(0, 7));
    setEntryInTime(nowHHMM);
    if (isBiometric) setEntryBiometricIn(true);
    setDaysMap(nextDays);
    persistStore(
      settings,
      nextDays,
      isBiometric
        ? `🫆 Biometric Touch IN Verified at ${formatTime12h(nowHHMM)} (${todayIso})`
        : `🟢 Punched Enter at ${formatTime12h(nowHHMM)} (${todayIso})`
    );
    return { todayIso, nowHHMM, otMins, worked };
  };

  const punchExitNowAndSave = (isBiometric = false, methodUsed = 'touch-sensor') => {
    const todayIso = getTodayIsoDate();
    const nowHHMM = getNowTimeHHMM();
    setLiveClockHHMM(nowHHMM);
    const existing = daysMap[todayIso];
    const inTime = existing?.inTime || entryInTime || settings.officeStartTime || '10:00';
    const status = existing?.status || 'present';
    const inM = parseTimeMinutes(inTime, 10 * 60);
    const outM = parseTimeMinutes(nowHHMM, 18 * 60 + 30);
    const worked = outM >= inM ? outM - inM : (24 * 60 - inM) + outM;
    const otMins = status === 'ot_only' ? worked : Math.max(0, worked - rates.shiftMins);
    const extraAllowance = Number(existing?.extraAllowance ?? existing?.extraBonus) || 0;
    const nowIso = new Date().toISOString();
    const nextDays = {
      ...daysMap,
      [todayIso]: {
        ...existing,
        date: todayIso,
        status,
        inTime,
        outTime: nowHHMM,
        workedMins: worked,
        otHours: Number((otMins / 60).toFixed(4)),
        note: existing?.note || '',
        extraAllowance,
        biometricIn: Boolean(existing?.biometricIn || isBiometric),
        biometricOut: isBiometric ? true : Boolean(existing?.biometricOut),
        biometricInAt: existing?.biometricInAt || (isBiometric ? nowIso : null),
        biometricOutAt: isBiometric ? nowIso : (existing?.biometricOutAt || null),
        biometricOutMethod: isBiometric ? methodUsed : (existing?.biometricOutMethod || ''),
        savedAt: nowIso,
        updatedAt: nowIso,
      },
    };
    setSelectedDate(todayIso);
    setSelectedMonth(todayIso.slice(0, 7));
    setEntryInTime(inTime);
    setEntryOutTime(nowHHMM);
    setEntryOtHours(Number((otMins / 60).toFixed(4)));
    if (isBiometric) {
      setEntryBiometricIn(true);
      setEntryBiometricOut(true);
    }
    setDaysMap(nextDays);
    persistStore(
      settings,
      nextDays,
      isBiometric
        ? `🫆 Biometric Touch OUT Verified at ${formatTime12h(nowHHMM)} (+${formatMinutesCompact(otMins)} OT saved)`
        : `🔴 Punched Exit at ${formatTime12h(nowHHMM)} (+${formatMinutesCompact(otMins)} OT saved)`
    );
    return { todayIso, inTime, nowHHMM, otMins, worked };
  };

  // Biometric Touch Sensor Handler (Always triggers real Mobile Unlock Biometric for IN or OUT)
  const performBiometricPunch = async (requestedDirection = 'auto') => {
    if (biometricScanState.active) return;
    const todayIso = getTodayIsoDate();
    const todayRecord = daysMap[todayIso];
    const resolvedDir =
      requestedDirection === 'in' || requestedDirection === 'out'
        ? requestedDirection
        : todayRecord?.biometricIn && !todayRecord?.biometricOut
          ? 'out'
          : 'in';

    const actionTitle =
      resolvedDir === 'in'
        ? `Unlock to Punch IN (${formatTime12h(getNowTimeHHMM())})`
        : `Unlock to Punch OUT (${formatTime12h(getNowTimeHHMM())})`;

    triggerBiometricHaptic(45);
    setBiometricScanState({
      active: true,
      direction: resolvedDir,
      progress: 50,
      statusText: `🔐 Unlock your phone with Fingerprint / Face / PIN to Punch ${resolvedDir.toUpperCase()}...`,
      lastVerifiedText: '',
    });

    const hwRes = await requestAndroidHardwareBiometric(
      resolvedDir,
      actionTitle,
      resolvedDir === 'in'
        ? 'Use your phone unlock fingerprint to record Office Enter (IN)'
        : 'Use your phone unlock fingerprint to record Office Exit (OUT)'
    );
    if (!hwRes.ok) {
      setBiometricScanState({
        active: false,
        direction: '',
        progress: 0,
        statusText: `⚠️ ${hwRes.error || 'Phone unlock cancelled — Attendance not punched.'}`,
        lastVerifiedText: '',
      });
      return;
    }
    const methodUsed = hwRes.method || 'android-hardware-biometric';

    playBiometricBeep(resolvedDir);
    triggerBiometricHaptic(110);

    if (resolvedDir === 'in') {
      const res = punchEnterNowAndSave(true, methodUsed);
      const verifiedMsg = `✅ Biometric IN Verified at ${formatTime12h(res.nowHHMM)}`;
      setBiometricScanState({
        active: false,
        direction: 'in',
        progress: 100,
        statusText: verifiedMsg,
        lastVerifiedText: verifiedMsg,
      });
    } else {
      const res = punchExitNowAndSave(true, methodUsed);
      const otEarned = (res.otMins / 60) * rates.otHourlyRate;
      const verifiedMsg = `✅ Biometric OUT Verified at ${formatTime12h(res.nowHHMM)} · +${formatMinutesCompact(res.otMins)} OT (+₹${formatINR(otEarned)})`;
      setBiometricScanState({
        active: false,
        direction: 'out',
        progress: 100,
        statusText: verifiedMsg,
        lastVerifiedText: verifiedMsg,
      });
    }
  };

  const quickSetTodayOtAndSave = (otHoursValue) => {
    const todayIso = getTodayIsoDate();
    const existing = daysMap[todayIso];
    const inTime = existing?.inTime || settings.officeStartTime || '10:00';
    const status = existing?.status || 'present';
    const otMins = Math.round((Number(otHoursValue) || 0) * 60);
    const inM = parseTimeMinutes(inTime, 10 * 60);
    const outM = status === 'ot_only' ? inM + otMins : inM + rates.shiftMins + otMins;
    const outTime = minutesToHHMM(outM);
    const worked = outM >= inM ? outM - inM : (24 * 60 - inM) + outM;
    const extraAllowance = Number(existing?.extraAllowance ?? existing?.extraBonus) || 0;
    const nextDays = {
      ...daysMap,
      [todayIso]: {
        ...existing,
        date: todayIso,
        status,
        inTime,
        outTime,
        workedMins: worked,
        otHours: Number(otHoursValue) || 0,
        note: existing?.note || '',
        extraAllowance,
        savedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
    setSelectedDate(todayIso);
    setSelectedMonth(todayIso.slice(0, 7));
    setEntryInTime(inTime);
    setEntryOutTime(outTime);
    setEntryOtHours(Number(otHoursValue) || 0);
    setDaysMap(nextDays);
    persistStore(
      settings,
      nextDays,
      `⚡ Saved Today (${todayIso}): ${formatTime12h(inTime)} → ${formatTime12h(outTime)} (+${otHoursValue}h OT)`
    );
  };

  const buildSalarySummaryText = () => {
    const lines = [
      `📊 *OT & Salary Report (${selectedMonth})*`,
      `• Base Salary: ₹${formatINR(rates.salary)} (₹${formatINR(rates.perDaySalary)}/day)`,
      `• Office Shift: ${formatTime12h(settings.officeStartTime)} – ${formatTime12h(settings.officeEndTime)} (${formatMinutesReadable(rates.shiftMins)})`,
      `• Extra OT Worked: ${formatMinutesReadable(monthSummary.totalOtMins)} (${monthSummary.otDaysCount} days)`,
      `• Extra OT Earned: +₹${formatINR(monthSummary.totalOtPay + monthSummary.totalExtraAllowance)}`,
      `• Biometric Sensor Verified: ${monthSummary.biometricBothCount} days (In & Out)`,
      monthSummary.leaveDeduction > 0 ? `• Leave Deduction: -₹${formatINR(monthSummary.leaveDeduction)}` : null,
      `💰 *Net Salary Receivable: ₹${formatINR(monthSummary.fullMonthNetPayable)}*`,
      '',
      `📅 *Today / Selected (${selectedDate}):*`,
      `• Enter: ${formatTime12h(entryInTime)} ${entryBiometricIn ? '(🫆 Bio IN ✓)' : ''} → Exit: ${formatTime12h(entryOutTime)} ${entryBiometricOut ? '(🫆 Bio OUT ✓)' : ''}`,
      `• Worked: ${formatMinutesReadable(activeDayPreview.workedMins)} (OT: +${formatMinutesCompact(activeDayPreview.otMins)})`,
      `• Day Total: ₹${formatINR(activeDayPreview.totalPay)}`,
    ].filter(Boolean);
    return lines.join('\n');
  };

  const shareSalarySummaryOnWhatsApp = async () => {
    const text = buildSalarySummaryText();
    try {
      if (navigator.share) {
        await navigator.share({ title: `OT & Salary Report (${selectedMonth})`, text });
        return;
      }
    } catch {
      // Fall back to WhatsApp URL
    }
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
  };

  const downloadStandaloneMobileApp = () => {
    const htmlContent = generateStandaloneOtMobileHtml({ settings, days: daysMap });
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OT-Salary-Mobile-App.html`;
    a.click();
    URL.revokeObjectURL(url);
    setSaveNotice('📱 Downloaded OT-Salary-Mobile-App.html (Send to phone via WhatsApp/Telegram)');
    setTimeout(() => setSaveNotice(''), 4000);
  };

  const syncWithPcNow = async () => {
    setSyncBusy(true);
    setSyncStatusText('Syncing with PC...');
    try {
      const rawIp = pcSyncIpInput.trim();
      const candidateBases = [];
      if (rawIp) {
        if (/^https?:\/\//i.test(rawIp)) {
          candidateBases.push(rawIp.replace(/\/+$/, ''));
        } else if (rawIp.includes(':')) {
          candidateBases.push(`http://${rawIp.replace(/\/+$/, '')}`);
        } else {
          candidateBases.push(`http://${rawIp}:5173`, `http://${rawIp}:8433`);
        }
      } else {
        candidateBases.push('');
      }
      let syncedPayload = null;
      for (const base of candidateBases) {
        try {
          const endpoint = `${base}/api/ot-salary-sync`;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings, days: daysMap }),
          });
          if (res.ok) {
            const json = await res.json();
            if (json && (json.success || json.ok) && json.data) {
              syncedPayload = json.data;
              if (base) {
                try { localStorage.setItem('pattan.ot.syncServerUrl', base); } catch (_) {}
              }
              break;
            }
          }
        } catch (_) {}
      }
      if (syncedPayload) {
        if (syncedPayload.settings) setSettings((prev) => ({ ...prev, ...syncedPayload.settings }));
        if (syncedPayload.days) setDaysMap(syncedPayload.days);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(syncedPayload));
        } catch {}
        setSyncStatusText(`✓ Synced ${Object.keys(syncedPayload.days || {}).length} saved days with PC`);
      } else {
        setSyncStatusText('⚠️ Could not sync with PC. Check Wi-Fi / IP.');
      }
    } catch (err) {
      setSyncStatusText(`⚠️ Sync failed: ${err?.message || 'Check PC connection'}`);
    } finally {
      setSyncBusy(false);
    }
  };

  const exportBackupJson = () => {
    const payload = JSON.stringify({ settings, days: daysMap, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OT-Salary-Backup-${selectedMonth}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackupJson = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        const nextSettings = parsed.settings ? { ...DEFAULT_SETTINGS, ...parsed.settings } : settings;
        const nextDays = parsed.days && typeof parsed.days === 'object' ? { ...daysMap, ...parsed.days } : daysMap;
        setSettings(nextSettings);
        setDaysMap(nextDays);
        persistStore(nextSettings, nextDays, `Restored ${Object.keys(nextDays).length} days from backup`);
      } catch {
        setSaveNotice('⚠️ Invalid JSON backup file');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const showTodaySection = mobileTab === 'today';
  const showRulesSection = mobileTab === 'rules';
  const showMonthSection = mobileTab === 'month';
  const showSummarySection = mobileTab === 'summary';

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        minHeight: '100%',
        background: '#070b14',
        color: '#f8fafc',
        padding: mobileMode ? '12px 12px 92px' : '20px 24px 80px',
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* SIMPLE TOP HEADER */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '14px 16px',
          borderRadius: 16,
          background: '#0f172a',
          border: '1px solid rgba(148, 163, 184, 0.22)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {(mobileTab !== 'today' || selectedDate !== getTodayIsoDate() || onClose) && (
              <button
                type="button"
                onClick={() => {
                  const res = goBackStep();
                  if (res !== 'handled' && onClose) onClose();
                }}
                style={{
                  padding: '7px 11px',
                  borderRadius: 9,
                  border: '1px solid rgba(56, 189, 248, 0.45)',
                  background: 'rgba(14, 165, 233, 0.16)',
                  color: '#e0f2fe',
                  fontWeight: 900,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
                title="Go Back"
              >
                ← Back
              </button>
            )}
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>
                ⏱️ OT &amp; Salary Tracker
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700, marginTop: 2 }}>
                ₹{formatINR(rates.salary)}/mo · ₹{formatINR(rates.perDaySalary)}/day · OT ₹{formatINR(rates.otHourlyRate)}/hr
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {saveNotice && (
              <span style={{
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(16, 185, 129, 0.22)',
                border: '1px solid #34d399',
                color: '#a7f3d0',
                fontSize: 11.5,
                fontWeight: 800,
              }}>
                ✓ {saveNotice}
              </span>
            )}
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => {
                if (e.target.value) setSelectedMonth(e.target.value);
              }}
              style={{
                background: '#090d16',
                border: '1px solid rgba(148,163,184,0.3)',
                borderRadius: 8,
                padding: '6px 10px',
                color: '#fff',
                fontWeight: 800,
                fontSize: 12.5,
              }}
            />
            <button
              type="button"
              onClick={() => setShowMobileAppModal(true)}
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                border: '1px solid rgba(52, 211, 153, 0.5)',
                background: 'rgba(16, 185, 129, 0.2)',
                color: '#ecfdf5',
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              📱 Mobile App / Sync
            </button>
            <button
              type="button"
              onClick={shareSalarySummaryOnWhatsApp}
              style={{
                padding: '7px 12px',
                borderRadius: 8,
                border: '1px solid rgba(34, 197, 94, 0.45)',
                background: 'rgba(34, 197, 94, 0.16)',
                color: '#bbf7d0',
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              📲 WhatsApp
            </button>
          </div>
        </div>

        {/* SIMPLE 2-BOX TOP MONEY SUMMARY */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{
            padding: '14px 16px',
            borderRadius: 14,
            background: '#0f172a',
            border: '1px solid rgba(250, 204, 21, 0.45)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#fde047', textTransform: 'uppercase' }}>
              💰 Total Net Salary ({selectedMonth})
            </div>
            <div style={{ marginTop: 4, fontSize: mobileMode ? 22 : 26, fontWeight: 900, color: '#facc15' }}>
              ₹{formatINR(monthSummary.fullMonthNetPayable)}
            </div>
            <div style={{ marginTop: 2, fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>
              {monthSummary.savedDaysCount}/{monthRows.length} days saved
            </div>
          </div>

          <div style={{
            padding: '14px 16px',
            borderRadius: 14,
            background: '#0f172a',
            border: '1px solid rgba(52, 211, 153, 0.45)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#6ee7b7', textTransform: 'uppercase' }}>
              ⚡ Extra OT Earned
            </div>
            <div style={{ marginTop: 4, fontSize: mobileMode ? 22 : 26, fontWeight: 900, color: '#34d399' }}>
              + ₹{formatINR(monthSummary.totalOtPay + monthSummary.totalExtraAllowance)}
            </div>
            <div style={{ marginTop: 2, fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>
              {formatMinutesReadable(monthSummary.totalOtMins)} OT
            </div>
          </div>
        </div>

        {/* CLEAN 4-TAB BAR */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 6,
          padding: 5,
          borderRadius: 12,
          background: '#0f172a',
          border: '1px solid rgba(148, 163, 184, 0.22)',
        }}>
          {[
            { id: 'today', label: '🫆 Today Punch' },
            { id: 'month', label: '📅 Month Days' },
            { id: 'summary', label: '📊 Salary Slip' },
            { id: 'rules', label: '⚙️ Rules & App' },
          ].map((t) => {
            const active = mobileTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => navigateTab(t.id)}
                style={{
                  padding: '9px 6px',
                  borderRadius: 9,
                  border: 0,
                  background: active ? '#10b981' : 'transparent',
                  color: active ? '#052e16' : '#cbd5e1',
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* 🫆 SIMPLE BIOMETRIC IN & OUT CARD (Uses Real Mobile Unlock Biometric) */}
        {showTodaySection && (() => {
          const todayIso = getTodayIsoDate();
          const todayRec = daysMap[todayIso];
          const hasBioInToday = Boolean(todayRec?.biometricIn);
          const hasBioOutToday = Boolean(todayRec?.biometricOut);
          return (
            <div style={{
              padding: 16,
              borderRadius: 16,
              background: '#0f172a',
              border: '1.5px solid rgba(52, 211, 153, 0.45)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>
                    🫆 Biometric Touch Sensor (IN &amp; OUT)
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginTop: 2 }}>
                    {biometricScanState.statusText}
                  </div>
                </div>
                <span style={{
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: 'rgba(16, 185, 129, 0.16)',
                  color: '#6ee7b7',
                  fontSize: 11.5,
                  fontWeight: 800,
                }}>
                  🕒 {formatTime12h(liveClockHHMM)}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => performBiometricPunch('in')}
                  disabled={biometricScanState.active}
                  style={{
                    padding: '16px 12px',
                    borderRadius: 14,
                    border: hasBioInToday ? '2px solid #38bdf8' : '1.5px solid rgba(56, 189, 248, 0.45)',
                    background: 'linear-gradient(135deg, #0284c7, #1e3a8a)',
                    color: '#fff',
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 4 }}>🫆</div>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>
                    Touch Sensor — IN (Enter)
                  </div>
                  <div style={{ fontSize: 11.5, color: '#bae6fd', fontWeight: 700, marginTop: 4 }}>
                    {hasBioInToday
                      ? `✓ IN: ${formatTime12h(todayRec.inTime)}`
                      : 'Tap & Unlock Phone for IN'}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => performBiometricPunch('out')}
                  disabled={biometricScanState.active}
                  style={{
                    padding: '16px 12px',
                    borderRadius: 14,
                    border: hasBioOutToday ? '2px solid #34d399' : '1.5px solid rgba(52, 211, 153, 0.45)',
                    background: 'linear-gradient(135deg, #059669, #064e3b)',
                    color: '#fff',
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 4 }}>🫆</div>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>
                    Touch Sensor — OUT (Exit + OT)
                  </div>
                  <div style={{ fontSize: 11.5, color: '#a7f3d0', fontWeight: 700, marginTop: 4 }}>
                    {hasBioOutToday
                      ? `✓ OUT: ${formatTime12h(todayRec.outTime)}`
                      : 'Tap & Unlock Phone for OUT'}
                  </div>
                </button>
              </div>
            </div>
          );
        })()}

        {/* Main 2-Column Grid: Left = Enter Time & Exit Time Calculator, Right = Office Salary & OT Rate Settings */}
        {(showTodaySection || showRulesSection) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))',
          gap: 18,
          alignItems: 'start',
        }}>

          {/* LEFT: Daily Enter Time & Exit Time Calculator Card */}
          {showTodaySection && (
          <div style={{
            background: '#0f172a',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            borderRadius: 16,
            padding: mobileMode ? 14 : 20,
            boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: '#fff' }}>
                  ⏱️ Enter Time &amp; Exit Time Calculator (Save Each Day)
                </h2>
                <p style={{ margin: '3px 0 0', fontSize: 12, color: '#94a3b8' }}>
                  Enter your <strong>Enter Time</strong> and <strong>Exit Time</strong> — total worked hours, extra OT time, and day salary are calculated automatically.
                </p>
              </div>
              {daysMap[selectedDate] ? (
                <span style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(52,211,153,0.45)', color: '#6ee7b7', fontSize: 11, fontWeight: 800 }}>
                  ✓ Saved for {selectedDate}
                </span>
              ) : (
                <span style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(251,191,36,0.4)', color: '#fde68a', fontSize: 11, fontWeight: 800 }}>
                  Unsaved Date
                </span>
              )}
            </div>

            {/* Date + Status Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#cbd5e1', marginBottom: 5 }}>
                  Work Date
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      if (e.target.value) setSelectedDate(e.target.value);
                    }}
                    style={{
                      flex: 1,
                      padding: '9px 11px',
                      borderRadius: 9,
                      border: '1px solid rgba(148,163,184,0.3)',
                      background: '#090d16',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: 13,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setSelectedDate(getTodayIsoDate())}
                    style={{
                      padding: '8px 11px',
                      borderRadius: 9,
                      border: '1px solid rgba(56,189,248,0.4)',
                      background: 'rgba(14,165,233,0.16)',
                      color: '#7dd3fc',
                      fontWeight: 800,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Today
                  </button>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#cbd5e1', marginBottom: 5 }}>
                  Attendance Status
                </label>
                <select
                  value={entryStatus}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 11px',
                    borderRadius: 9,
                    border: '1px solid rgba(148,163,184,0.3)',
                    background: '#090d16',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                >
                  <option value="present">Present (Full Day 10:00 AM – 06:30 PM)</option>
                  <option value="half">Half Day (50% Base + OT)</option>
                  <option value="holiday_paid">Sunday / Paid Holiday</option>
                  <option value="ot_only">Extra Work Only (0 Base + Full Time as OT)</option>
                  <option value="leave">Leave / Absent (Unpaid)</option>
                </select>
              </div>
            </div>

            {/* ENTER TIME & EXIT TIME PICKERS */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, marginBottom: 14 }}>
              <Time12hPicker
                label="🟢 Office Enter Time (In)"
                value={entryInTime}
                onChange={handleInTimeChange}
                accentColor="#38bdf8"
                badgeText={`Standard Enter Time: ${formatTime12h(settings.officeStartTime)}`}
                quickOptions={[
                  { label: '09:30 AM', time: '09:30' },
                  { label: '10:00 AM', time: '10:00' },
                  { label: '10:15 AM', time: '10:15' },
                  { label: '10:30 AM', time: '10:30' },
                  { label: '11:00 AM', time: '11:00' },
                  { label: '🕒 Now', time: 'NOW' },
                ]}
              />

              <Time12hPicker
                label="🔴 Office Exit Time (Out)"
                value={entryOutTime}
                onChange={handleOutTimeChange}
                accentColor="#34d399"
                badgeText={`Standard Exit Time: ${formatTime12h(settings.officeEndTime)}`}
                quickOptions={[
                  { label: '06:30 PM (0h)', time: '18:30' },
                  { label: '07:00 PM (+30m)', time: '19:00' },
                  { label: '07:30 PM (+1h)', time: '19:30' },
                  { label: '08:00 PM (+1.5h)', time: '20:00' },
                  { label: '08:30 PM (+2h)', time: '20:30' },
                  { label: '09:00 PM (+2.5h)', time: '21:00' },
                  { label: '09:30 PM (+3h)', time: '21:30' },
                  { label: '🕒 Now', time: 'NOW' },
                ]}
              />
            </div>

            {/* Quick 1-Click Extra OT Buttons (Also sets Exit Time automatically) */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8' }}>
                  ⚡ Quick Extra OT Hours (Auto-sets Exit Time):
                </span>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>OT Hours:</span>
                  <input
                    type="number"
                    min="0"
                    max="16"
                    step="0.25"
                    value={Number(entryOtHours.toFixed(2))}
                    onChange={(e) => handleOtHoursPresetOrInput(e.target.value)}
                    style={{
                      width: 72,
                      padding: '4px 7px',
                      borderRadius: 6,
                      border: '1px solid rgba(52,211,153,0.55)',
                      background: 'rgba(16,185,129,0.12)',
                      color: '#6ee7b7',
                      fontWeight: 900,
                      fontSize: 12,
                      textAlign: 'center',
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {[
                  { hrs: 0, label: '0 hr (6:30 PM)' },
                  { hrs: 0.5, label: '+30m (7:00 PM)' },
                  { hrs: 1, label: '+1h (7:30 PM)' },
                  { hrs: 1.5, label: '+1.5h (8:00 PM)' },
                  { hrs: 2, label: '+2h (8:30 PM)' },
                  { hrs: 3, label: '+3h (9:30 PM)' },
                ].map((preset) => {
                  const active = Math.abs((Number(entryOtHours) || 0) - preset.hrs) < 0.01;
                  return (
                    <button
                      key={preset.hrs}
                      type="button"
                      onClick={() => handleOtHoursPresetOrInput(preset.hrs)}
                      style={{
                        padding: '7px 11px',
                        borderRadius: 8,
                        border: active ? '1px solid #34d399' : '1px solid rgba(148,163,184,0.25)',
                        background: active ? 'rgba(16,185,129,0.28)' : 'rgba(255,255,255,0.04)',
                        color: active ? '#ecfdf5' : '#cbd5e1',
                        fontWeight: 800,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Optional Note & Extra Bonus */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#cbd5e1', marginBottom: 5 }}>
                  Work Note (Optional)
                </label>
                <input
                  type="text"
                  placeholder="Optional note..."
                  value={entryNote}
                  onChange={(e) => setEntryNote(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 11px',
                    borderRadius: 9,
                    border: '1px solid rgba(148,163,184,0.3)',
                    background: '#090d16',
                    color: '#fff',
                    fontSize: 13,
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#cbd5e1', marginBottom: 5 }}>
                  Extra Bonus (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={entryBonus}
                  onChange={(e) => setEntryBonus(Math.max(0, Number(e.target.value) || 0))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 11px',
                    borderRadius: 9,
                    border: '1px solid rgba(148,163,184,0.3)',
                    background: '#090d16',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                />
              </div>
            </div>

            {/* Live Day Breakdown Box */}
            <div style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(16,185,129,0.14), rgba(56,189,248,0.1))',
              border: '1px solid rgba(52,211,153,0.35)',
              marginBottom: 14,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}>
              <div style={{ fontSize: 13, color: '#e2e8f0', lineHeight: 1.65 }}>
                <div>
                  Enter: <strong>{formatTime12h(entryInTime)}</strong> {entryBiometricIn && <span style={{ color: '#38bdf8', fontWeight: 900 }}>🫆✓</span>} → Exit: <strong>{formatTime12h(entryOutTime)}</strong> {entryBiometricOut && <span style={{ color: '#34d399', fontWeight: 900 }}>🫆✓</span>}{' '}
                  (<span style={{ color: '#7dd3fc', fontWeight: 800 }}>Worked {formatMinutesReadable(activeDayPreview.workedMins)}</span>)
                </div>
                <div>Base Day Pay ({entryStatus.replace('_', ' ')}): <strong>₹{formatINR(activeDayPreview.basePay)}</strong></div>
                <div>
                  Extra OT Pay ({formatMinutesReadable(activeDayPreview.otMins)} × ₹{formatINR(rates.otHourlyRate)}/hr):{' '}
                  <strong style={{ color: '#6ee7b7' }}>+ ₹{formatINR(activeDayPreview.otPay)}</strong>
                </div>
                {activeDayPreview.extraAllowance > 0 && (
                  <div>Extra Allowance: <strong style={{ color: '#fde047' }}>+ ₹{formatINR(activeDayPreview.extraAllowance)}</strong></div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>
                  Total Earned on {selectedDate}
                </div>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#facc15' }}>
                  ₹{formatINR(activeDayPreview.totalPay)}
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={saveActiveDayRecord}
                style={{
                  flex: 1,
                  padding: '12px 18px',
                  borderRadius: 11,
                  border: '1px solid rgba(52,211,153,0.5)',
                  background: 'linear-gradient(135deg, #10b981, #0284c7)',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: 14,
                  cursor: 'pointer',
                  boxShadow: '0 8px 24px rgba(16, 185, 129, 0.3)',
                }}
              >
                💾 Save Calculation for {selectedDate} ({formatTime12h(entryInTime)} – {formatTime12h(entryOutTime)})
              </button>
              {daysMap[selectedDate] && (
                <button
                  type="button"
                  onClick={() => deleteSavedDay(selectedDate)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 11,
                    border: '1px solid rgba(248,113,113,0.4)',
                    background: 'rgba(239,68,68,0.14)',
                    color: '#fca5a5',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Clear Day
                </button>
              )}
            </div>
          </div>
          )}

          {/* RIGHT: Salary & Office Timing Configuration Card */}
          {showRulesSection && (
          <div style={{
            background: '#0f172a',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            borderRadius: 16,
            padding: mobileMode ? 14 : 20,
          }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 900, color: '#fff' }}>
              ⚙️ Your Office Salary &amp; Timing Rules
            </h2>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: '#94a3b8' }}>
              Pre-configured for ₹25,000/month and 10:00 AM – 06:30 PM (8 hrs 30 mins). Changes save automatically.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#cbd5e1', marginBottom: 5 }}>
                  Monthly Salary (₹)
                </label>
                <input
                  type="number"
                  min="1000"
                  step="500"
                  value={settings.monthlySalary}
                  onChange={(e) => updateSetting('monthlySalary', Math.max(0, Number(e.target.value) || 0))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 11px',
                    borderRadius: 9,
                    border: '1px solid rgba(250,204,21,0.45)',
                    background: '#090d16',
                    color: '#fde047',
                    fontWeight: 900,
                    fontSize: 14,
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#cbd5e1', marginBottom: 5 }}>
                  Month Days Calculation Basis
                </label>
                <select
                  value={settings.monthDaysMode}
                  onChange={(e) => updateSetting('monthDaysMode', e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 11px',
                    borderRadius: 9,
                    border: '1px solid rgba(148,163,184,0.3)',
                    background: '#090d16',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                >
                  <option value="30">30 Days Fixed (₹{formatINR((Number(settings.monthlySalary) || 25000) / 30)}/day)</option>
                  <option value="actual">Actual Days in Month ({rates.actualMonthDays} days = ₹{formatINR((Number(settings.monthlySalary) || 25000) / rates.actualMonthDays)}/day)</option>
                  <option value="26">26 Working Days (₹{formatINR((Number(settings.monthlySalary) || 25000) / 26)}/day)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#cbd5e1', marginBottom: 5 }}>
                  Standard Office Enter Time (Morning)
                </label>
                <input
                  type="time"
                  value={settings.officeStartTime}
                  onChange={(e) => updateSetting('officeStartTime', e.target.value || '10:00')}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 11px',
                    borderRadius: 9,
                    border: '1px solid rgba(148,163,184,0.3)',
                    background: '#090d16',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#cbd5e1', marginBottom: 5 }}>
                  Standard Office Exit Time (Evening)
                </label>
                <input
                  type="time"
                  value={settings.officeEndTime}
                  onChange={(e) => updateSetting('officeEndTime', e.target.value || '18:30')}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 11px',
                    borderRadius: 9,
                    border: '1px solid rgba(148,163,184,0.3)',
                    background: '#090d16',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                />
              </div>
            </div>

            {/* How Enter & Exit Time Calculates OT */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#7dd3fc', marginBottom: 5 }}>
                  How Enter Time &amp; Exit Time Calculates Extra OT
                </label>
                <select
                  value={settings.otTimeCalcMode || 'in_out_duration'}
                  onChange={(e) => updateSetting('otTimeCalcMode', e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 11px',
                    borderRadius: 9,
                    border: '1px solid rgba(56,189,248,0.4)',
                    background: '#090d16',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 12.5,
                  }}
                >
                  <option value="in_out_duration">
                    Total Worked Time minus {formatMinutesReadable(rates.shiftMins)} Shift (Exit Time − Enter Time − 8h 30m)
                  </option>
                  <option value="after_office_end">
                    Extra Time Worked After {formatTime12h(settings.officeEndTime)} (Exit Time − {formatTime12h(settings.officeEndTime)})
                  </option>
                </select>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: settings.otRateMode === 'custom' ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#cbd5e1', marginBottom: 5 }}>
                  Extra Work (OT) Hourly Rate Formula
                </label>
                <select
                  value={settings.otRateMode}
                  onChange={(e) => updateSetting('otRateMode', e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 11px',
                    borderRadius: 9,
                    border: '1px solid rgba(148,163,184,0.3)',
                    background: '#090d16',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                >
                  <option value="auto">Standard 1.0× Hourly Rate (₹{formatINR(rates.baseHourlyRate)} / hr)</option>
                  <option value="1.5x">1.5× Overtime Rate (₹{formatINR(rates.baseHourlyRate * 1.5)} / hr)</option>
                  <option value="2.0x">2.0× Double Overtime Rate (₹{formatINR(rates.baseHourlyRate * 2)} / hr)</option>
                  <option value="custom">Custom Fixed ₹ / Hour</option>
                </select>
              </div>

              {settings.otRateMode === 'custom' && (
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#6ee7b7', marginBottom: 5 }}>
                    Custom OT Rate per Hour (₹)
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="5"
                    value={settings.customOtHourlyRate}
                    onChange={(e) => updateSetting('customOtHourlyRate', Math.max(0, Number(e.target.value) || 0))}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '9px 11px',
                      borderRadius: 9,
                      border: '1px solid rgba(52,211,153,0.5)',
                      background: '#090d16',
                      color: '#6ee7b7',
                      fontWeight: 900,
                      fontSize: 14,
                    }}
                  />
                </div>
              )}
            </div>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: '#cbd5e1',
              fontWeight: 700,
              marginBottom: 14,
              cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={Boolean(settings.deductShortHours)}
                onChange={(e) => updateSetting('deductShortHours', e.target.checked)}
              />
              Deduct short/late hours if total worked time is less than {formatMinutesReadable(rates.shiftMins)}
            </label>

            {/* Quick Reference Formula Box */}
            <div style={{
              padding: '13px 15px',
              borderRadius: 12,
              background: '#090d16',
              border: '1px solid rgba(148,163,184,0.18)',
              fontSize: 12,
              color: '#cbd5e1',
              lineHeight: 1.65,
            }}>
              <div style={{ fontWeight: 900, color: '#7dd3fc', marginBottom: 4 }}>
                📐 Your Exact Salary &amp; Time Breakdown:
              </div>
              <div>• <strong>Standard Shift:</strong> {formatTime12h(settings.officeStartTime)} to {formatTime12h(settings.officeEndTime)} = <strong>{formatMinutesReadable(rates.shiftMins)}/day</strong></div>
              <div>• <strong>1 Full Day Salary:</strong> ₹{formatINR(rates.salary)} ÷ {rates.divisorDays} days = <strong>₹{formatINR(rates.perDaySalary)} / day</strong></div>
              <div>• <strong>Per Hour / Per Minute OT Rate:</strong> <strong>₹{formatINR(rates.otHourlyRate)}/hr</strong> (<strong>₹{formatINR(rates.otPerMinuteRate)}/min</strong>)</div>
              <div>• <strong>10:00 AM → 07:30 PM (9h 30m):</strong> +1 hr OT = <strong>+₹{formatINR(rates.otHourlyRate)}</strong> (Day Total = ₹{formatINR(rates.perDaySalary + rates.otHourlyRate)})</div>
              <div>• <strong>10:00 AM → 08:30 PM (10h 30m):</strong> +2 hrs OT = <strong>+₹{formatINR(rates.otHourlyRate * 2)}</strong> (Day Total = ₹{formatINR(rates.perDaySalary + rates.otHourlyRate * 2)})</div>
              {diskPath && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#6ee7b7' }}>
                  💾 Auto-saved permanently on disk: <code>{diskPath}</code>
                </div>
              )}
            </div>
          </div>
          )}
        </div>
        )}

        {/* Full Month Day-by-Day Sheet (Mobile Cards View + Desktop Table View) */}
        {showMonthSection && (
        <div style={{
          background: '#0f172a',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          borderRadius: 16,
          padding: mobileMode ? 14 : 20,
          boxShadow: '0 12px 32px rgba(0,0,0,0.3)',
        }}>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 14,
          }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: '#fff' }}>
                📋 Day-by-Day Enter Time, Exit Time &amp; Salary Sheet ({selectedMonth})
              </h2>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: '#94a3b8' }}>
                Change <strong>Enter Time</strong> or <strong>Exit Time</strong> on any day — worked hours, extra OT time, and salary auto-calculate &amp; save immediately.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {[
                { id: 'all', label: `All Days (${monthRows.length})` },
                { id: 'saved', label: `Saved (${monthSummary.savedDaysCount})` },
                { id: 'ot_only', label: `OT Days (${monthSummary.otDaysCount})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setViewFilter(tab.id)}
                  style={{
                    padding: '7px 11px',
                    borderRadius: 8,
                    border: viewFilter === tab.id ? '1px solid #38bdf8' : '1px solid rgba(148,163,184,0.25)',
                    background: viewFilter === tab.id ? 'rgba(14,165,233,0.22)' : 'rgba(255,255,255,0.04)',
                    color: viewFilter === tab.id ? '#e0f2fe' : '#94a3b8',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              ))}

              <button
                type="button"
                onClick={() => setMobileDaysLayout((prev) => (prev === 'cards' ? 'table' : 'cards'))}
                style={{
                  padding: '7px 11px',
                  borderRadius: 8,
                  border: '1px solid rgba(56,189,248,0.4)',
                  background: 'rgba(14,165,233,0.14)',
                  color: '#7dd3fc',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {mobileDaysLayout === 'cards' ? '📋 Table View' : '📱 Mobile Cards'}
              </button>

              <button
                type="button"
                onClick={saveAllMonthDays}
                style={{
                  padding: '7px 11px',
                  borderRadius: 8,
                  border: '1px solid rgba(52,211,153,0.4)',
                  background: 'rgba(16,185,129,0.16)',
                  color: '#6ee7b7',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                ✓ Save All {monthRows.length} Days
              </button>
            </div>
          </div>

          {mobileDaysLayout === 'cards' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredMonthRows.map((row) => {
                const r = row.record;
                const e = row.earnings;
                const isSelected = row.iso === selectedDate;
                return (
                  <div
                    key={row.iso}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: isSelected
                        ? 'rgba(56, 189, 248, 0.12)'
                        : e.otMins > 0
                          ? 'rgba(16, 185, 129, 0.08)'
                          : '#090d16',
                      border: isSelected
                        ? '1px solid rgba(56, 189, 248, 0.55)'
                        : e.otMins > 0
                          ? '1px solid rgba(52, 211, 153, 0.4)'
                          : '1px solid rgba(148, 163, 184, 0.2)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div onClick={() => setSelectedDate(row.iso)} style={{ cursor: 'pointer' }}>
                        <span style={{ fontWeight: 900, fontSize: 14, color: row.isSunday ? '#fca5a5' : '#fff' }}>
                          {row.fullDateLabel} ({row.dayName})
                        </span>
                        <span style={{
                          marginLeft: 8,
                          fontSize: 11,
                          padding: '2px 7px',
                          borderRadius: 999,
                          background: row.isSaved ? 'rgba(16,185,129,0.2)' : 'rgba(148,163,184,0.15)',
                          color: row.isSaved ? '#6ee7b7' : '#94a3b8',
                          fontWeight: 800,
                        }}>
                          {row.isSaved ? '✓ Saved' : 'Default'}
                        </span>
                        {r.biometricIn && (
                          <span style={{
                            marginLeft: 5,
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 999,
                            background: 'rgba(14,165,233,0.2)',
                            border: '1px solid rgba(56,189,248,0.45)',
                            color: '#7dd3fc',
                            fontWeight: 800,
                          }}>
                            🫆 IN ✓
                          </span>
                        )}
                        {r.biometricOut && (
                          <span style={{
                            marginLeft: 5,
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 999,
                            background: 'rgba(16,185,129,0.22)',
                            border: '1px solid rgba(52,211,153,0.45)',
                            color: '#6ee7b7',
                            fontWeight: 800,
                          }}>
                            🫆 OUT ✓
                          </span>
                        )}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: '#facc15' }}>₹{formatINR(e.totalPay)}</div>
                        <div style={{ fontSize: 10.5, color: e.otMins > 0 ? '#6ee7b7' : '#94a3b8', fontWeight: 700 }}>
                          {e.otMins > 0 ? `+${formatMinutesCompact(e.otMins)} OT (+₹${formatINR(e.otPay)})` : `${formatMinutesCompact(e.workedMins)} worked`}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 800, marginBottom: 3 }}>Status</div>
                        <select
                          value={r.status}
                          onChange={(ev) => upsertDayFromTable(row.iso, { status: ev.target.value })}
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            borderRadius: 7,
                            border: '1px solid rgba(148,163,184,0.28)',
                            background: '#0f172a',
                            color: '#fff',
                            fontWeight: 800,
                            fontSize: 12,
                          }}
                        >
                          <option value="present">Present</option>
                          <option value="half">Half Day</option>
                          <option value="holiday_paid">Paid Off / Sun</option>
                          <option value="ot_only">OT Only</option>
                          <option value="leave">Leave (Unpaid)</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: '#7dd3fc', fontWeight: 800, marginBottom: 3 }}>Enter Time</div>
                        <input
                          type="time"
                          value={r.inTime || '10:00'}
                          disabled={r.status === 'leave'}
                          onChange={(ev) => {
                            if (ev.target.value) upsertDayFromTable(row.iso, { inTime: ev.target.value });
                          }}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '6px 8px',
                            borderRadius: 7,
                            border: '1px solid rgba(56,189,248,0.35)',
                            background: '#0f172a',
                            color: '#e0f2fe',
                            fontWeight: 800,
                            fontSize: 12,
                          }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: '#6ee7b7', fontWeight: 800, marginBottom: 3 }}>Exit Time</div>
                        <input
                          type="time"
                          value={r.outTime || '18:30'}
                          disabled={r.status === 'leave'}
                          onChange={(ev) => {
                            if (ev.target.value) upsertDayFromTable(row.iso, { outTime: ev.target.value });
                          }}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            padding: '6px 8px',
                            borderRadius: 7,
                            border: e.otMins > 0 ? '1px solid rgba(52,211,153,0.6)' : '1px solid rgba(148,163,184,0.28)',
                            background: '#0f172a',
                            color: e.otMins > 0 ? '#6ee7b7' : '#e2e8f0',
                            fontWeight: 800,
                            fontSize: 12,
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {[
                          { hrs: 0, label: '6:30 PM (0h)' },
                          { hrs: 1, label: '7:30 PM (+1h)' },
                          { hrs: 2, label: '8:30 PM (+2h)' },
                        ].map((preset) => (
                          <button
                            key={preset.hrs}
                            type="button"
                            onClick={() => upsertDayFromTable(row.iso, { otHours: preset.hrs })}
                            style={{
                              padding: '5px 9px',
                              borderRadius: 6,
                              border: Math.abs(e.otHours - preset.hrs) < 0.02
                                ? '1px solid #34d399'
                                : '1px solid rgba(148,163,184,0.25)',
                              background: Math.abs(e.otHours - preset.hrs) < 0.02
                                ? 'rgba(16,185,129,0.26)'
                                : 'rgba(255,255,255,0.04)',
                              color: '#e2e8f0',
                              fontWeight: 800,
                              fontSize: 11,
                              cursor: 'pointer',
                            }}
                          >
                            {preset.label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => upsertDayFromTable(row.iso, { biometricIn: !r.biometricIn })}
                          style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            border: r.biometricIn ? '1px solid #38bdf8' : '1px solid rgba(148,163,184,0.25)',
                            background: r.biometricIn ? 'rgba(14,165,233,0.24)' : 'rgba(255,255,255,0.04)',
                            color: r.biometricIn ? '#e0f2fe' : '#94a3b8',
                            fontWeight: 800,
                            fontSize: 10.5,
                            cursor: 'pointer',
                          }}
                        >
                          🫆 IN {r.biometricIn ? '✓' : '—'}
                        </button>
                        <button
                          type="button"
                          onClick={() => upsertDayFromTable(row.iso, { biometricOut: !r.biometricOut })}
                          style={{
                            padding: '5px 8px',
                            borderRadius: 6,
                            border: r.biometricOut ? '1px solid #34d399' : '1px solid rgba(148,163,184,0.25)',
                            background: r.biometricOut ? 'rgba(16,185,129,0.24)' : 'rgba(255,255,255,0.04)',
                            color: r.biometricOut ? '#ecfdf5' : '#94a3b8',
                            fontWeight: 800,
                            fontSize: 10.5,
                            cursor: 'pointer',
                          }}
                        >
                          🫆 OUT {r.biometricOut ? '✓' : '—'}
                        </button>
                      </div>
                      {!row.isSaved && (
                        <button
                          type="button"
                          onClick={() => upsertDayFromTable(row.iso, {})}
                          style={{
                            padding: '5px 11px',
                            borderRadius: 6,
                            border: '1px solid rgba(56,189,248,0.4)',
                            background: 'rgba(14,165,233,0.18)',
                            color: '#7dd3fc',
                            fontWeight: 800,
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          Save Day
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: '#090d16', color: '#94a3b8', textAlign: 'left', borderBottom: '1px solid rgba(148,163,184,0.2)' }}>
                  <th style={{ padding: '10px 10px' }}>Date</th>
                  <th style={{ padding: '10px 8px' }}>Status</th>
                  <th style={{ padding: '10px 8px', color: '#7dd3fc' }}>Enter Time (In)</th>
                  <th style={{ padding: '10px 8px', color: '#6ee7b7' }}>Exit Time (Out)</th>
                  <th style={{ padding: '10px 8px' }}>Total Worked</th>
                  <th style={{ padding: '10px 8px' }}>Extra OT Time</th>
                  <th style={{ padding: '10px 8px' }}>Quick Exit / OT</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Base Day Pay</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Extra OT Pay</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Total Day Salary</th>
                  <th style={{ padding: '10px 8px' }}>Work Note</th>
                  <th style={{ padding: '10px 8px', textAlign: 'center' }}>State</th>
                </tr>
              </thead>
              <tbody>
                {filteredMonthRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} style={{ padding: 28, textAlign: 'center', color: '#64748b', fontWeight: 700 }}>
                      No days match this filter yet. Click &quot;All Days&quot; or save today&apos;s calculation above.
                    </td>
                  </tr>
                ) : (
                  filteredMonthRows.map((row) => {
                    const r = row.record;
                    const e = row.earnings;
                    const isSelected = row.iso === selectedDate;
                    return (
                      <tr
                        key={row.iso}
                        onClick={() => setSelectedDate(row.iso)}
                        style={{
                          borderBottom: '1px solid rgba(148,163,184,0.1)',
                          background: isSelected
                            ? 'rgba(56, 189, 248, 0.12)'
                            : e.otMins > 0
                              ? 'rgba(16, 185, 129, 0.06)'
                              : row.isSunday
                                ? 'rgba(255, 255, 255, 0.02)'
                                : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <td style={{ padding: '9px 10px', whiteSpace: 'nowrap', fontWeight: 800 }}>
                          <span style={{ color: row.isSunday ? '#fca5a5' : '#f8fafc' }}>{row.fullDateLabel}</span>
                          <span style={{
                            marginLeft: 6,
                            fontSize: 11,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: row.isSunday ? 'rgba(239,68,68,0.18)' : 'rgba(148,163,184,0.14)',
                            color: row.isSunday ? '#fca5a5' : '#cbd5e1',
                          }}>
                            {row.dayName}
                          </span>
                        </td>

                        <td style={{ padding: '8px' }} onClick={(ev) => ev.stopPropagation()}>
                          <select
                            value={r.status}
                            onChange={(ev) => upsertDayFromTable(row.iso, { status: ev.target.value })}
                            style={{
                              padding: '5px 8px',
                              borderRadius: 6,
                              border: '1px solid rgba(148,163,184,0.25)',
                              background: '#090d16',
                              color: r.status === 'leave' ? '#fca5a5' : r.status === 'half' ? '#fde68a' : '#fff',
                              fontWeight: 700,
                              fontSize: 12,
                            }}
                          >
                            <option value="present">Present</option>
                            <option value="half">Half Day</option>
                            <option value="holiday_paid">Paid Off / Sun</option>
                            <option value="ot_only">OT Only</option>
                            <option value="leave">Leave (Unpaid)</option>
                          </select>
                        </td>

                        {/* Inline Editable Enter Time */}
                        <td style={{ padding: '8px', whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>
                          <input
                            type="time"
                            value={r.inTime || '10:00'}
                            disabled={r.status === 'leave'}
                            onChange={(ev) => {
                              if (ev.target.value) upsertDayFromTable(row.iso, { inTime: ev.target.value });
                            }}
                            style={{
                              padding: '5px 7px',
                              borderRadius: 6,
                              border: '1px solid rgba(56,189,248,0.35)',
                              background: '#090d16',
                              color: '#e0f2fe',
                              fontWeight: 800,
                              fontSize: 12,
                            }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#64748b', marginTop: 2 }}>
                            <span>{formatTime12h(r.inTime || '10:00')}</span>
                            <button
                              type="button"
                              title="Toggle Biometric Touch Sensor IN Verification"
                              onClick={() => upsertDayFromTable(row.iso, { biometricIn: !r.biometricIn })}
                              style={{
                                padding: '1px 5px',
                                borderRadius: 4,
                                border: r.biometricIn ? '1px solid rgba(56,189,248,0.6)' : '1px solid rgba(148,163,184,0.22)',
                                background: r.biometricIn ? 'rgba(14,165,233,0.2)' : 'transparent',
                                color: r.biometricIn ? '#7dd3fc' : '#64748b',
                                fontSize: 9.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              🫆 {r.biometricIn ? 'IN ✓' : 'Bio'}
                            </button>
                          </div>
                        </td>

                        {/* Inline Editable Exit Time */}
                        <td style={{ padding: '8px', whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>
                          <input
                            type="time"
                            value={r.outTime || '18:30'}
                            disabled={r.status === 'leave'}
                            onChange={(ev) => {
                              if (ev.target.value) upsertDayFromTable(row.iso, { outTime: ev.target.value });
                            }}
                            style={{
                              padding: '5px 7px',
                              borderRadius: 6,
                              border: e.otMins > 0 ? '1px solid rgba(52,211,153,0.6)' : '1px solid rgba(148,163,184,0.28)',
                              background: e.otMins > 0 ? 'rgba(16,185,129,0.14)' : '#090d16',
                              color: e.otMins > 0 ? '#6ee7b7' : '#e2e8f0',
                              fontWeight: 800,
                              fontSize: 12,
                            }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: e.otMins > 0 ? '#6ee7b7' : '#64748b', marginTop: 2 }}>
                            <span>{formatTime12h(r.outTime || '18:30')}</span>
                            <button
                              type="button"
                              title="Toggle Biometric Touch Sensor OUT Verification"
                              onClick={() => upsertDayFromTable(row.iso, { biometricOut: !r.biometricOut })}
                              style={{
                                padding: '1px 5px',
                                borderRadius: 4,
                                border: r.biometricOut ? '1px solid rgba(52,211,153,0.6)' : '1px solid rgba(148,163,184,0.22)',
                                background: r.biometricOut ? 'rgba(16,185,129,0.2)' : 'transparent',
                                color: r.biometricOut ? '#6ee7b7' : '#64748b',
                                fontSize: 9.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              🫆 {r.biometricOut ? 'OUT ✓' : 'Bio'}
                            </button>
                          </div>
                        </td>

                        {/* Total Worked Time */}
                        <td style={{ padding: '8px', whiteSpace: 'nowrap', fontWeight: 800, color: '#f8fafc' }}>
                          <div>{formatMinutesCompact(e.workedMins)}</div>
                          <div style={{ fontSize: 10, color: '#64748b' }}>
                            {(e.workedMins / 60).toFixed(2)} hrs
                          </div>
                        </td>

                        {/* Extra OT Time */}
                        <td style={{ padding: '8px', whiteSpace: 'nowrap' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '4px 8px',
                            borderRadius: 6,
                            background: e.otMins > 0 ? 'rgba(16,185,129,0.18)' : 'rgba(148,163,184,0.08)',
                            border: e.otMins > 0 ? '1px solid rgba(52,211,153,0.45)' : '1px solid rgba(148,163,184,0.15)',
                            color: e.otMins > 0 ? '#6ee7b7' : '#64748b',
                            fontWeight: 900,
                            fontSize: 12,
                          }}>
                            {e.otMins > 0 ? `+${formatMinutesCompact(e.otMins)}` : '0h 00m'}
                          </span>
                        </td>

                        {/* Quick Exit / OT Buttons */}
                        <td style={{ padding: '8px', whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>
                          <div style={{ display: 'inline-flex', gap: 4 }}>
                            {[
                              { hrs: 0, label: '6:30P' },
                              { hrs: 1, label: '7:30P (+1h)' },
                              { hrs: 2, label: '8:30P (+2h)' },
                            ].map((preset) => (
                              <button
                                key={preset.hrs}
                                type="button"
                                onClick={() => upsertDayFromTable(row.iso, { otHours: preset.hrs })}
                                style={{
                                  padding: '4px 7px',
                                  borderRadius: 5,
                                  border: Math.abs(e.otHours - preset.hrs) < 0.02
                                    ? '1px solid #34d399'
                                    : '1px solid rgba(148,163,184,0.2)',
                                  background: Math.abs(e.otHours - preset.hrs) < 0.02
                                    ? 'rgba(16,185,129,0.28)'
                                    : 'rgba(255,255,255,0.04)',
                                  color: Math.abs(e.otHours - preset.hrs) < 0.02 ? '#ecfdf5' : '#cbd5e1',
                                  fontWeight: 800,
                                  fontSize: 10.5,
                                  cursor: 'pointer',
                                }}
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>
                        </td>

                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 700, color: '#e2e8f0' }}>
                          ₹{formatINR(e.basePay)}
                        </td>

                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 800, color: e.otPay > 0 ? '#34d399' : '#64748b' }}>
                          {e.otPay > 0 ? `+ ₹${formatINR(e.otPay)}` : '₹0.00'}
                        </td>

                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 900, color: '#fde047', fontSize: 13 }}>
                          ₹{formatINR(e.totalPay)}
                        </td>

                        <td style={{ padding: '8px' }} onClick={(ev) => ev.stopPropagation()}>
                          <input
                            type="text"
                            placeholder="Add note..."
                            value={r.note || ''}
                            onChange={(ev) => upsertDayFromTable(row.iso, { note: ev.target.value })}
                            style={{
                              width: '100%',
                              minWidth: 115,
                              padding: '5px 8px',
                              borderRadius: 6,
                              border: '1px solid rgba(148,163,184,0.2)',
                              background: '#090d16',
                              color: '#e2e8f0',
                              fontSize: 12,
                            }}
                          />
                        </td>

                        <td style={{ padding: '8px', textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(ev) => ev.stopPropagation()}>
                          {row.isSaved ? (
                            <span style={{ color: '#34d399', fontWeight: 900, fontSize: 11 }}>✓ Saved</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => upsertDayFromTable(row.iso, {})}
                              style={{
                                padding: '4px 9px',
                                borderRadius: 6,
                                border: '1px solid rgba(56,189,248,0.35)',
                                background: 'rgba(14,165,233,0.15)',
                                color: '#7dd3fc',
                                fontWeight: 800,
                                fontSize: 11,
                                cursor: 'pointer',
                              }}
                            >
                              Save
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr style={{ background: '#090d16', borderTop: '2px solid rgba(148,163,184,0.25)', fontWeight: 900 }}>
                  <td colSpan={4} style={{ padding: '12px 10px', color: '#fff', fontSize: 13 }}>
                    MONTHLY TOTAL ({selectedMonth})
                  </td>
                  <td style={{ padding: '12px 8px', color: '#cbd5e1', fontSize: 12 }}>
                    {formatMinutesCompact(monthSummary.totalWorkedMins)} saved
                  </td>
                  <td colSpan={2} style={{ padding: '12px 8px', color: '#38bdf8', fontSize: 13 }}>
                    +{formatMinutesReadable(monthSummary.totalOtMins)} Extra OT
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right', color: '#e2e8f0', fontSize: 13 }}>
                    ₹{formatINR(monthSummary.fullMonthBaseAfterLeave)}
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right', color: '#34d399', fontSize: 13 }}>
                    + ₹{formatINR(monthSummary.totalOtPay + monthSummary.totalExtraAllowance)}
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'right', color: '#facc15', fontSize: 15 }}>
                    ₹{formatINR(monthSummary.fullMonthNetPayable)}
                  </td>
                  <td colSpan={2} style={{ padding: '12px 8px', textAlign: 'center', color: '#6ee7b7', fontSize: 11 }}>
                    {monthSummary.savedDaysCount}/{monthRows.length} days saved
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          )}
        </div>
        )}

      </div>

      {/* Sticky Mobile Bottom Navigation Bar */}
      {mobileMode && (
        <div style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 900,
          background: 'rgba(9, 13, 22, 0.96)',
          backdropFilter: 'blur(12px)',
          borderTop: '1px solid rgba(56, 189, 248, 0.3)',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          padding: '6px 8px calc(6px + env(safe-area-inset-bottom, 0px))',
          gap: 6,
        }}>
          {[
            { id: 'today', icon: '⏱️', label: 'Today Punch' },
            { id: 'month', icon: '📅', label: 'Month Days' },
            { id: 'summary', icon: '📊', label: 'Summary' },
            { id: 'rules', icon: '⚙️', label: 'Rules & App' },
          ].map((nav) => {
            const active = mobileTab === nav.id;
            return (
              <button
                key={nav.id}
                type="button"
                onClick={() => navigateTab(nav.id)}
                style={{
                  padding: '8px 4px',
                  borderRadius: 10,
                  border: active ? '1px solid rgba(52, 211, 153, 0.5)' : '1px solid transparent',
                  background: active ? 'rgba(16, 185, 129, 0.2)' : 'transparent',
                  color: active ? '#6ee7b7' : '#94a3b8',
                  fontWeight: 900,
                  fontSize: 11.5,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <span style={{ fontSize: 15 }}>{nav.icon}</span>
                <span>{nav.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Mobile App, QR Code, Offline Download & PC Sync Modal */}
      {showMobileAppModal && (
        <div
          onClick={() => setShowMobileAppModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            background: 'rgba(2, 6, 23, 0.82)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 680,
              maxHeight: '90vh',
              overflowY: 'auto',
              background: '#0f172a',
              border: '1px solid rgba(52, 211, 153, 0.45)',
              borderRadius: 18,
              padding: 22,
              color: '#f8fafc',
              boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#fff' }}>
                  📱 OT &amp; Salary Tracker — Mobile App &amp; Live Sync
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#94a3b8' }}>
                  Use the OT &amp; Salary Tracker on your Android / iPhone — either with live Wi-Fi sync or 100% offline anywhere.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMobileAppModal(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(148,163,184,0.3)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ✕ Close
              </button>
            </div>

            {/* Option 1: Native Android APK & Standalone 100% Offline Mobile App */}
            <div style={{
              padding: 16,
              borderRadius: 14,
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.16), rgba(14, 165, 233, 0.12))',
              border: '1px solid rgba(52, 211, 153, 0.45)',
              marginBottom: 14,
            }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#6ee7b7', marginBottom: 4 }}>
                ⭐ Option 1: Install Native Android APK or 100% Offline Mobile App (Works Everywhere Without Wi-Fi)
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>
                Download <strong>OT-Salary-Mobile.apk</strong> to install the native Android app on your phone, or download <strong>OT-Salary-Mobile-App.html</strong> pre-loaded with all your current saved days &amp; ₹{formatINR(rates.salary)} settings. Both work 100% offline at your office!
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <a
                  href="/OT-Salary-Mobile.apk"
                  download="OT-Salary-Mobile.apk"
                  style={{
                    padding: '10px 16px',
                    borderRadius: 10,
                    border: '1px solid rgba(52, 211, 153, 0.7)',
                    background: 'linear-gradient(135deg, #059669, #10b981)',
                    color: '#fff',
                    fontWeight: 900,
                    fontSize: 13,
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                >
                  🤖 Download Android APK (OT-Salary-Mobile.apk)
                </a>
                <button
                  type="button"
                  onClick={downloadStandaloneMobileApp}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 10,
                    border: '1px solid rgba(56, 189, 248, 0.6)',
                    background: 'linear-gradient(135deg, #0284c7, #2563eb)',
                    color: '#fff',
                    fontWeight: 900,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  📲 Download Offline Mobile App (.html)
                </button>
                <button
                  type="button"
                  onClick={shareSalarySummaryOnWhatsApp}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(34, 197, 94, 0.45)',
                    background: 'rgba(34, 197, 94, 0.16)',
                    color: '#bbf7d0',
                    fontWeight: 800,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  💬 Share Salary Report on WhatsApp
                </button>
              </div>
            </div>

            {/* Option 2: Live Wi-Fi Web App + QR Code */}
            <div style={{
              padding: 16,
              borderRadius: 14,
              background: '#090d16',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              marginBottom: 14,
              display: 'grid',
              gridTemplateColumns: mobileConnectInfo.qrDataUrl ? '150px 1fr' : '1fr',
              gap: 16,
              alignItems: 'center',
            }}>
              {mobileConnectInfo.qrDataUrl && (
                <div style={{ background: '#fff', padding: 8, borderRadius: 12, textAlign: 'center' }}>
                  <img
                    src={mobileConnectInfo.qrDataUrl}
                    alt="Scan QR to open OT Mobile App"
                    style={{ width: 134, height: 134, display: 'block', margin: '0 auto' }}
                  />
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>Scan with Phone</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#7dd3fc', marginBottom: 4 }}>
                  📡 Option 2: Open Live Mobile Web App (Installable PWA + Auto-Sync)
                </div>
                <p style={{ margin: '0 0 8px', fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>
                  Open this link on your phone while on the same Wi-Fi, then tap <strong>&quot;Add to Home Screen&quot;</strong> to install the OT &amp; Salary app icon on your phone:
                </p>
                <div style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: '#0f172a',
                  border: '1px solid rgba(56,189,248,0.4)',
                  color: '#38bdf8',
                  fontWeight: 900,
                  fontSize: 13,
                  wordBreak: 'break-all',
                  marginBottom: 8,
                }}>
                  {mobileConnectInfo.otUrl || `${window.location.origin}/ot`}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => {
                      const url = mobileConnectInfo.otUrl || `${window.location.origin}/ot`;
                      navigator.clipboard?.writeText(url);
                      setSaveNotice('Copied Mobile App URL!');
                      setTimeout(() => setSaveNotice(''), 2500);
                    }}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 8,
                      border: '1px solid rgba(56,189,248,0.4)',
                      background: 'rgba(14,165,233,0.18)',
                      color: '#e0f2fe',
                      fontWeight: 800,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    📋 Copy Mobile App Link
                  </button>
                </div>
              </div>
            </div>

            {/* Option 3: Two-Way PC Sync & Backup/Restore JSON */}
            <div style={{
              padding: 16,
              borderRadius: 14,
              background: '#090d16',
              border: '1px solid rgba(148, 163, 184, 0.25)',
            }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#fde047', marginBottom: 6 }}>
                🔄 Two-Way Phone ↔ PC Sync &amp; Backup
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <input
                  type="text"
                  placeholder="Optional PC IP (e.g. 192.168.1.5)"
                  value={pcSyncIpInput}
                  onChange={(e) => setPcSyncIpInput(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 180,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid rgba(148,163,184,0.3)',
                    background: '#0f172a',
                    color: '#fff',
                    fontSize: 12.5,
                  }}
                />
                <button
                  type="button"
                  onClick={syncWithPcNow}
                  disabled={syncBusy}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid rgba(52,211,153,0.5)',
                    background: 'rgba(16,185,129,0.2)',
                    color: '#6ee7b7',
                    fontWeight: 900,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  {syncBusy ? 'Syncing...' : '🔄 Sync Now with PC'}
                </button>
                <button
                  type="button"
                  onClick={exportBackupJson}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(148,163,184,0.3)',
                    background: 'rgba(255,255,255,0.06)',
                    color: '#e2e8f0',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  📤 Export JSON
                </button>
                <label style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(148,163,184,0.3)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#e2e8f0',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}>
                  📥 Import JSON
                  <input type="file" accept=".json,application/json" onChange={importBackupJson} style={{ display: 'none' }} />
                </label>
              </div>
              {syncStatusText && (
                <div style={{ fontSize: 12, fontWeight: 800, color: '#6ee7b7' }}>{syncStatusText}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

