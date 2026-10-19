import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { buildStandaloneOtMobileAppHtml } from './otMobileAppGenerator';
import ExpensesModule from './ExpensesModule.jsx';
import './OtSalary.css';
import {
  loadEncryptedExpenseStore,
  saveEncryptedExpenseStore,
  reconcileAndMergeTransactions,
} from '../../../frontend/expense-memory.js';
import {
  WHATSAPP_FIXED_RECIPIENT_DISPLAY,
  initAfterOutWhatsAppListener,
  loadWhatsAppAutoSendState,
  setWhatsAppAutoSendEnabled,
  configureNativeWhatsAppRelay,
  retryFailedDailyStatement,
  resendDailyStatementWithConfirmation,
} from '../../../frontend/ot-whatsapp-after-out.js';

class ExpensesSectionBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 18,
          borderRadius: 18,
          background: '#111827',
          border: '1px solid rgba(239,68,68,0.4)',
          color: '#f8fafc',
        }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#f87171' }}>
            Expense Memory encountered a display issue
          </div>
          <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6 }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 10,
              padding: '8px 14px',
              borderRadius: 10,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontWeight: 800,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Retry Expense Memory
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const LS_OT_SALARY_KEY = 'pp_ot_salary_tracker_v1';

const DEFAULT_SETTINGS = {
  employeeName: 'Yasin Pattan',
  monthlySalary: 25000,
  officeStartTime: '10:00',
  officeEndTime: '18:30',
  monthDaysMode: '30', // '30' | 'actual' | '26'
  otRateMode: 'auto', // 'auto' | '1.5x' | '2.0x' | 'custom'
  customOtHourlyRate: 100,
  otTimeCalcMode: 'in_out_duration', // 'in_out_duration' (Exit - Enter - 8h30m) | 'after_office_end' (Exit - 06:30 PM)
  deductShortHours: false, // If true and worked < 8h30m on a Present day, deduct short time from day pay
};

function normalizeEmployeeName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'abdul haseeb') return 'Yasin Pattan';
  return trimmed;
}

function getEmployeeInitials(name) {
  const resolved = normalizeEmployeeName(name);
  const parts = resolved.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return resolved.slice(0, 2).toUpperCase() || 'YP';
}

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
    list.push({ iso, dayNumber: d, dayNum: d, dayName, fullDateLabel, isSunday });
  }
  return list;
}

function loadInitialStore() {
  const encryptedRes = loadEncryptedExpenseStore();
  let resolvedExpenses = encryptedRes.expenses && typeof encryptedRes.expenses === 'object' ? encryptedRes.expenses : {};
  try {
    const raw = localStorage.getItem(LS_OT_SALARY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        Object.keys(resolvedExpenses).length === 0 &&
        parsed?.expenses &&
        typeof parsed.expenses === 'object' &&
        Object.keys(parsed.expenses).length > 0
      ) {
        resolvedExpenses = parsed.expenses;
        try {
          saveEncryptedExpenseStore(resolvedExpenses);
        } catch (_) {}
      }
      const mergedSettings = { ...DEFAULT_SETTINGS, ...(parsed?.settings || {}) };
      mergedSettings.employeeName = normalizeEmployeeName(mergedSettings.employeeName);
      return {
        settings: mergedSettings,
        days: parsed?.days && typeof parsed.days === 'object' ? parsed.days : {},
        expenses: resolvedExpenses,
      };
    }
  } catch (_) {}
  return {
    settings: { ...DEFAULT_SETTINGS },
    days: {},
    expenses: resolvedExpenses,
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
  if (!outTime || !String(outTime).trim()) {
    return {
      inMins,
      outMins: null,
      workedMins: 0,
      standardShiftMins,
      regularWorkedMins: 0,
      otMins: 0,
      shortMins: 0,
      workedHours: 0,
      otHours: 0,
      shortHours: 0,
    };
  }
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

  if ((otTimeCalcMode === 'after_office_end' || otTimeCalcMode === 'after_end_time') && status === 'present') {
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

function TouchIdSvg({ variant = 'in', size = 62, verified = false, scanning = false }) {
  const uid = `tid_${variant}_${size}`;
  const c1 = variant === 'out' ? '#34d399' : variant === 'gold' ? '#facc15' : '#38bdf8';
  const c2 = variant === 'out' ? '#10b981' : variant === 'gold' ? '#f59e0b' : '#818cf8';
  const glow = variant === 'out'
    ? 'rgba(16, 185, 129, 0.55)'
    : variant === 'gold'
      ? 'rgba(250, 204, 21, 0.55)'
      : 'rgba(56, 189, 248, 0.55)';
  return (
    <div style={{
      position: 'relative',
      width: size,
      height: size,
      margin: '0 auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {/* Outer Glowing Aura Ring */}
      <div style={{
        position: 'absolute',
        inset: -4,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${glow} 0%, transparent 72%)`,
        filter: 'blur(6px)',
        opacity: scanning ? 1 : 0.78,
        pointerEvents: 'none',
      }} />
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: 'relative',
          zIndex: 2,
          filter: `drop-shadow(0 0 10px ${glow})`,
        }}
      >
        <defs>
          <linearGradient id={uid} x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="38%" stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </linearGradient>
        </defs>
        {/* Outer Tech Bezel */}
        <circle
          cx="32"
          cy="32"
          r="29"
          stroke={`url(#${uid})`}
          strokeWidth="1.6"
          strokeDasharray="6 4"
          opacity="0.65"
        />
        <circle
          cx="32"
          cy="32"
          r="25.5"
          fill="rgba(7, 11, 22, 0.78)"
          stroke={`url(#${uid})`}
          strokeWidth="1.8"
        />
        {/* Concentric Biometric Touch ID Ridges */}
        <path
          d="M21 24.5C23.5 19.2 27.4 16.5 32 16.5C36.6 16.5 40.5 19.2 43 24.5"
          stroke={`url(#${uid})`}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M18.5 31.5C18.5 23.8 24.3 20.2 32 20.2C39.7 20.2 45.5 23.8 45.5 31.5C45.5 36.2 44.2 40.4 41.8 43.8"
          stroke={`url(#${uid})`}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M22.2 39.8C21.1 36.8 20.8 33.8 21.4 30.2C22.3 25.4 26.6 23.8 32 23.8C37.4 23.8 41.5 26.2 41.8 31.8C42.1 36.2 40.4 41.2 37.5 45.5"
          stroke={`url(#${uid})`}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M25.5 44.5C24.4 40.8 24.5 36.2 25.2 32.2C25.9 28.5 28.6 27.4 32 27.4C35.4 27.4 38 29.2 38 33C38 37.5 36.4 42.2 33.2 46.8"
          stroke={`url(#${uid})`}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M29.2 47.2C28.8 42.5 28.8 37.8 29.5 33.8C30 31.4 31 30.8 32.3 30.8C33.8 30.8 34.5 32.1 34.3 34.5C34 38.6 32.6 43.1 30.4 47.4"
          stroke={`url(#${uid})`}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M32 34.5V41.5"
          stroke="#ffffff"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        {/* Glowing Scan Line */}
        <line
          x1="14"
          y1="32"
          x2="50"
          y2="32"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity={scanning ? '0.95' : '0.35'}
        />
      </svg>
      {verified && (
        <span style={{
          position: 'absolute',
          right: -2,
          bottom: -2,
          zIndex: 3,
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #10b981, #059669)',
          border: '2px solid #070b14',
          color: '#fff',
          fontSize: 12,
          fontWeight: 900,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 10px rgba(16,185,129,0.6)',
        }}>
          ✓
        </span>
      )}
    </div>
  );
}

function RealAnalogClock({ now = new Date(), size = 136 }) {
  const dt = now instanceof Date ? now : new Date();
  const seconds = dt.getSeconds();
  const minutes = dt.getMinutes() + seconds / 60;
  const hours = (dt.getHours() % 12) + minutes / 60;

  const hourAngle = hours * 30;
  const minuteAngle = minutes * 6;
  const secondAngle = seconds * 6;

  return (
    <svg width={size} height={size} viewBox="0 0 120 120" style={{ display: 'block' }}>
      <defs>
        <radialGradient id="analogDialGrad" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="#172544" />
          <stop offset="100%" stopColor="#091022" />
        </radialGradient>
      </defs>
      {/* Outer Bezel & Dial */}
      <circle cx="60" cy="60" r="56" fill="url(#analogDialGrad)" stroke="rgba(56, 189, 248, 0.45)" strokeWidth="2.2" />
      <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(148, 163, 184, 0.16)" strokeWidth="1" strokeDasharray="2 4" />

      {/* 12 Hour Tick Marks */}
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i * 30 * Math.PI) / 180;
        const isCardinal = i % 3 === 0;
        const r1 = isCardinal ? 43 : 46;
        const r2 = 50;
        const x1 = 60 + r1 * Math.sin(angle);
        const y1 = 60 - r1 * Math.cos(angle);
        const x2 = 60 + r2 * Math.sin(angle);
        const y2 = 60 - r2 * Math.cos(angle);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={isCardinal ? '#38bdf8' : 'rgba(148, 163, 184, 0.45)'}
            strokeWidth={isCardinal ? '2.2' : '1.3'}
            strokeLinecap="round"
          />
        );
      })}

      {/* 12 / 3 / 6 / 9 Labels */}
      <text x="60" y="24" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="900">12</text>
      <text x="97" y="63.5" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="900">3</text>
      <text x="60" y="102" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="900">6</text>
      <text x="23" y="63.5" textAnchor="middle" fill="#e2e8f0" fontSize="10" fontWeight="900">9</text>

      {/* Hour Hand */}
      <line
        x1="60"
        y1="60"
        x2="60"
        y2="34"
        stroke="#ffffff"
        strokeWidth="3.8"
        strokeLinecap="round"
        transform={`rotate(${hourAngle} 60 60)`}
      />

      {/* Minute Hand */}
      <line
        x1="60"
        y1="60"
        x2="60"
        y2="23"
        stroke="#38bdf8"
        strokeWidth="2.8"
        strokeLinecap="round"
        transform={`rotate(${minuteAngle} 60 60)`}
      />

      {/* Second Hand */}
      <line
        x1="60"
        y1="67"
        x2="60"
        y2="19"
        stroke="#10b981"
        strokeWidth="1.6"
        strokeLinecap="round"
        transform={`rotate(${secondAngle} 60 60)`}
      />

      {/* Center Cap */}
      <circle cx="60" cy="60" r="4.2" fill="#10b981" stroke="#ffffff" strokeWidth="1.5" />
    </svg>
  );
}

export default function OtSalary({ onClose, standaloneMobile = false, initialTab = 'today' }) {
  const initialStore = useMemo(loadInitialStore, []);
  const [settings, setSettings] = useState(initialStore.settings);
  const [daysMap, setDaysMap] = useState(initialStore.days);
  const [expensesMap, setExpensesMap] = useState(initialStore.expenses || {});
  const expensesMapRef = useRef(initialStore.expenses || {});
  useEffect(() => {
    expensesMapRef.current = expensesMap;
  }, [expensesMap]);
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
  const [pcSyncOptIn, setPcSyncOptIn] = useState(() => {
    try { return localStorage.getItem('pattan.ot.pcSyncOptIn') === 'true'; } catch (_) { return false; }
  });
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncStatusText, setSyncStatusText] = useState('');

  // Feature B — After-OUT Automatic WhatsApp Statement state
  const [waState, setWaState] = useState(() => loadWhatsAppAutoSendState());
  const [showWaConsentModal, setShowWaConsentModal] = useState(false);
  const [waRelayUrlInput, setWaRelayUrlInput] = useState(() => {
    const s = loadWhatsAppAutoSendState();
    return s.relayEndpointUrl || '';
  });
  const [waRelayTokenInput, setWaRelayTokenInput] = useState('');
  const [waBusy, setWaBusy] = useState(false);

  useEffect(() => {
    const cleanupListener = initAfterOutWhatsAppListener();
    const onWaStatusChange = (ev) => {
      if (ev?.detail) {
        setWaState(ev.detail);
      } else {
        setWaState(loadWhatsAppAutoSendState());
      }
    };
    window.addEventListener('pattan:ot-whatsapp-status-changed', onWaStatusChange);
    return () => {
      cleanupListener();
      window.removeEventListener('pattan:ot-whatsapp-status-changed', onWaStatusChange);
    };
  }, []);

  const mobileConnectInfo = useMemo(() => ({
    otUrl: mobileOtUrl || wifiOtUrl || (typeof window !== 'undefined' ? `${window.location.origin}/ot` : ''),
    qrDataUrl: '',
  }), [mobileOtUrl, wifiOtUrl]);
  const [mobileMode, setMobileMode] = useState(() => {
    if (standaloneMobile) return true;
    return typeof window !== 'undefined' && window.innerWidth <= 820;
  });
  const [mobileTab, setMobileTab] = useState(() => {
    if (initialTab && ['today', 'expenses', 'month', 'summary', 'rules'].includes(initialTab)) return initialTab;
    try {
      const params = new URLSearchParams(window.location.search || '');
      const t = (params.get('tab') || params.get('module') || '').toLowerCase();
      if (t === 'expenses' || t === 'expense') return 'expenses';
    } catch (_) {}
    return 'today';
  }); // 'today' | 'expenses' | 'month' | 'summary' | 'rules'
  const [mobileDaysLayout, setMobileDaysLayout] = useState(() => (
    standaloneMobile || (typeof window !== 'undefined' && window.innerWidth <= 820) ? 'cards' : 'table'
  ));
  const [showMobileAppModal, setShowMobileAppModal] = useState(false);
  const [showManualEditor, setShowManualEditor] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showSplash, setShowSplash] = useState(false);

  // Biometric Lock Gate for Expense Memory (requires permission every time user shifts to Expenses)
  const [expensesBiometricUnlocked, setExpensesBiometricUnlocked] = useState(false);
  const [expensesUnlockBusy, setExpensesUnlockBusy] = useState(false);
  const [expensesUnlockError, setExpensesUnlockError] = useState('');

  // Salary Numbers Biometric Privacy Mask (Hidden by default everywhere; requires Biometric when Eye is clicked to unhide)
  const [salaryBiometricVisible, setSalaryBiometricVisible] = useState(false);
  const [salaryUnlockBusy, setSalaryUnlockBusy] = useState(false);

  // Office Time Ends & OT Time Starts Live Notification Banner state
  const [otTimeStartedBanner, setOtTimeStartedBanner] = useState(null);

  // Multi-Day Select & Bulk Set IN/OUT Time state
  const [selectedBulkDates, setSelectedBulkDates] = useState([]);
  const [bulkInTime, setBulkInTime] = useState(DEFAULT_SETTINGS.officeStartTime);
  const [bulkOutTime, setBulkOutTime] = useState('');
  const [bulkStatus, setBulkStatus] = useState('present');

  const [themeMode, setThemeMode] = useState(() => {
    try {
      return localStorage.getItem('pattan.ot.themeMode') === 'light' ? 'light' : 'dark';
    } catch (_) {
      return 'dark';
    }
  });
  const toggleThemeMode = useCallback(() => {
    setThemeMode((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('pattan.ot.themeMode', next); } catch (_) {}
      return next;
    });
  }, []);

  // Form state for the currently selected date in the Daily Calculator card (Exit Time is empty by default!)
  const [entryStatus, setEntryStatus] = useState('present'); // 'present' | 'half' | 'holiday_paid' | 'ot_only' | 'leave'
  const [entryInTime, setEntryInTime] = useState(DEFAULT_SETTINGS.officeStartTime);
  const [entryOutTime, setEntryOutTime] = useState('');
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
    statusText: 'Biometric Attendance Terminal · IN & OUT Ready',
    lastVerifiedText: '',
  });
  const [liveClockHHMM, setLiveClockHHMM] = useState(getCurrentTime24h);
  const [liveNow, setLiveNow] = useState(() => new Date());
  const tabHistoryRef = useRef(['today']);
  const touchStartRef = useRef(null);

  const toggleSalaryVisibilityWithBiometric = useCallback(async () => {
    if (salaryBiometricVisible) {
      triggerBiometricHaptic(30);
      setSalaryBiometricVisible(false);
      setSaveNotice('🙈 Salary numbers hidden');
      setTimeout(() => setSaveNotice(''), 2000);
      return false;
    }
    if (salaryUnlockBusy) return false;
    setSalaryUnlockBusy(true);
    triggerBiometricHaptic(45);
    const hwRes = await requestAndroidHardwareBiometric(
      'unhide_salary',
      'Unlock to Show Salary',
      'Scan fingerprint or face to unhide Yasin Pattan salary numbers'
    );
    setSalaryUnlockBusy(false);
    if (hwRes && hwRes.ok) {
      playBiometricBeep('in');
      triggerBiometricHaptic(95);
      setSalaryBiometricVisible(true);
      setSaveNotice('👁️ Biometric Verified — Salary numbers visible');
      setTimeout(() => setSaveNotice(''), 2500);
      return true;
    }
    setSalaryBiometricVisible(false);
    setSaveNotice(`⚠️ ${hwRes?.error || 'Biometric permission required to show salary numbers'}`);
    setTimeout(() => setSaveNotice(''), 2800);
    return false;
  }, [salaryBiometricVisible, salaryUnlockBusy]);

  const formatSalaryMask = useCallback((amount, prefix = '₹', suffix = '') => {
    if (!salaryBiometricVisible) {
      return `${prefix}••••••${suffix}`;
    }
    return `${prefix}${formatINR(amount)}${suffix}`;
  }, [salaryBiometricVisible]);

  const renderSalaryEyeButton = useCallback((compact = false, customLabel = '') => (
    <button
      type="button"
      onClick={(e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        toggleSalaryVisibilityWithBiometric();
      }}
      disabled={salaryUnlockBusy}
      title={salaryBiometricVisible ? 'Hide Salary Numbers' : 'Click Eye & Verify Biometric to Show Salary'}
      aria-label={salaryBiometricVisible ? 'Hide Salary' : 'Unhide Salary with Biometric'}
      style={{
        padding: compact ? '2px 7px' : '5px 10px',
        borderRadius: 999,
        border: salaryBiometricVisible
          ? '1px solid rgba(244, 63, 94, 0.5)'
          : '1px solid rgba(16, 185, 129, 0.5)',
        background: salaryBiometricVisible
          ? 'rgba(244, 63, 94, 0.16)'
          : 'rgba(16, 185, 129, 0.16)',
        color: salaryBiometricVisible ? '#f43f5e' : '#10b981',
        fontWeight: 900,
        fontSize: compact ? 10.5 : 11.5,
        cursor: salaryUnlockBusy ? 'wait' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        lineHeight: 1.2,
        flexShrink: 0,
      }}
    >
      <span>{salaryUnlockBusy ? '⏳' : salaryBiometricVisible ? '🙈' : '👁️'}</span>
      {!compact && (
        <span>
          {customLabel || (salaryBiometricVisible ? 'Hide Salary' : 'Show Salary')}
        </span>
      )}
    </button>
  ), [salaryBiometricVisible, salaryUnlockBusy, toggleSalaryVisibilityWithBiometric]);

  const unlockExpensesWithBiometric = useCallback(async () => {
    setExpensesUnlockBusy(true);
    setExpensesUnlockError('');
    triggerBiometricHaptic(45);
    const hwRes = await requestAndroidHardwareBiometric(
      'expenses',
      'Unlock Private Expense Memory',
      'Biometric permission required to view Yasin Pattan Expenses'
    );
    setExpensesUnlockBusy(false);
    if (hwRes && hwRes.ok) {
      playBiometricBeep('in');
      triggerBiometricHaptic(95);
      setExpensesBiometricUnlocked(true);
      setExpensesUnlockError('');
      setSaveNotice('🔓 Biometric Verified — Expense Memory Unlocked');
      setTimeout(() => setSaveNotice(''), 2500);
      return true;
    }
    setExpensesBiometricUnlocked(false);
    setExpensesUnlockError(hwRes?.error || 'Biometric permission is required to view Expense Memory.');
    return false;
  }, []);

  useEffect(() => {
    if (initialTab && ['today', 'expenses', 'month', 'summary', 'rules'].includes(initialTab)) {
      setMobileTab(initialTab);
      if (initialTab === 'expenses') {
        setExpensesBiometricUnlocked(false);
        unlockExpensesWithBiometric();
      }
    }
  }, [initialTab, unlockExpensesWithBiometric]);

  const navigateTab = useCallback((nextTab) => {
    if (nextTab === 'expenses') {
      setExpensesBiometricUnlocked(false);
      unlockExpensesWithBiometric();
    } else {
      setExpensesBiometricUnlocked(false);
      setExpensesUnlockError('');
    }
    setMobileTab((prev) => {
      if (prev === nextTab) return prev;
      tabHistoryRef.current = [...tabHistoryRef.current.slice(-8), nextTab];
      try {
        window.history.pushState({ otSalaryGuard: true, tab: nextTab }, '');
      } catch (_) {}
      return nextTab;
    });
  }, [unlockExpensesWithBiometric]);

  const goBackStep = useCallback(() => {
    if (showNotificationsModal) {
      setShowNotificationsModal(false);
      return 'handled';
    }
    if (showWaConsentModal) {
      setShowWaConsentModal(false);
      return 'handled';
    }
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
      if (prevTab !== 'expenses') setExpensesBiometricUnlocked(false);
      setMobileTab(prevTab);
      return 'handled';
    }
    if (mobileTab !== 'today') {
      tabHistoryRef.current = ['today'];
      setExpensesBiometricUnlocked(false);
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
  }, [showNotificationsModal, showWaConsentModal, showMobileAppModal, biometricScanState.active, mobileTab, selectedDate, onClose, standaloneMobile]);

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
    const order = ['today', 'expenses', 'month', 'summary', 'rules'];
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
      const now = new Date();
      setLiveNow(now);
      setLiveClockHHMM(
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      );
    }, 1000);
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

  const clientIdRef = useRef(`ot_${Math.random().toString(36).slice(2, 10)}`);
  const settingsUpdatedAtRef = useRef(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_OT_SALARY_KEY) || '{}');
      return Number(raw.settingsUpdatedAt || 0);
    } catch (_) {
      return 0;
    }
  });
  if (typeof settingsUpdatedAtRef.current === 'function') {
    settingsUpdatedAtRef.current = settingsUpdatedAtRef.current();
  }
  const lastAppliedSyncMsRef = useRef(0);

  // Only return explicit user-configured sync URLs when pcSyncOptIn is enabled (no hardcoded LAN IPs or public topics)
  const getCandidateLanBases = useCallback(() => {
    if (!pcSyncOptIn) return [];
    const bases = new Set();
    try {
      const savedBase = (pcSyncIpInput || localStorage.getItem('pattan.ot.syncServerUrl') || '').trim().replace(/\/+$/, '');
      if (savedBase) {
        if (/^https?:\/\//i.test(savedBase)) {
          bases.add(savedBase);
        } else if (savedBase.includes(':')) {
          bases.add(`https://${savedBase}`);
        }
      }
    } catch (_) {}
    return Array.from(bases);
  }, [pcSyncIpInput, pcSyncOptIn]);

  const applyIncomingStore = useCallback((data) => {
    if (!data || typeof data !== 'object') return;
    if (data.clientId && data.clientId === clientIdRef.current) return;

    const incomingTs = Number(data.updatedAtMs || Date.parse(data.updatedAt || '') || 0);
    if (incomingTs > lastAppliedSyncMsRef.current) {
      lastAppliedSyncMsRef.current = incomingTs;
    }

    const inSettingsTs = Number(data.settingsUpdatedAt || incomingTs || 0);
    let nextSettingsSnapshot = null;
    if (data.settings && typeof data.settings === 'object') {
      if (inSettingsTs >= (settingsUpdatedAtRef.current || 0)) {
        settingsUpdatedAtRef.current = inSettingsTs;
        setSettings((prev) => {
          const mergedSettings = { ...DEFAULT_SETTINGS, ...prev, ...data.settings };
          nextSettingsSnapshot = mergedSettings;
          return mergedSettings;
        });
      }
    }

    const inDays = data.days && typeof data.days === 'object' ? data.days : {};
    setDaysMap((prev) => {
      let changed = Boolean(nextSettingsSnapshot);
      const mergedDays = { ...prev };
      for (const [iso, inRec] of Object.entries(inDays)) {
        if (!inRec || typeof inRec !== 'object') continue;
        const exRec = mergedDays[iso];
        const inDayTs = Number(inRec.updatedAtMs || Date.parse(inRec.updatedAt || inRec.savedAt || '') || incomingTs || 1);
        const exDayTs = exRec ? Number(exRec.updatedAtMs || Date.parse(exRec.updatedAt || exRec.savedAt || '') || 0) : -1;
        if (!exRec || inDayTs >= exDayTs) {
          if (inRec._deleted) {
            if (mergedDays[iso]) {
              delete mergedDays[iso];
              changed = true;
            }
          } else {
            const combined = { ...exRec, ...inRec };
            if (JSON.stringify(exRec) !== JSON.stringify(combined)) {
              mergedDays[iso] = combined;
              changed = true;
            }
          }
        }
      }
      if (changed) {
        try {
          const currentRaw = JSON.parse(localStorage.getItem(LS_OT_SALARY_KEY) || '{}');
          const toSave = {
            settings: nextSettingsSnapshot || currentRaw.settings || DEFAULT_SETTINGS,
            settingsUpdatedAt: settingsUpdatedAtRef.current || Date.now(),
            days: mergedDays,
            updatedAt: new Date().toISOString(),
            updatedAtMs: Date.now(),
          };
          localStorage.setItem(LS_OT_SALARY_KEY, JSON.stringify(toSave));
        } catch (_) {}
      }
      return changed ? mergedDays : prev;
    });
  }, []);

  // Local IPC + Same-Origin BroadcastChannel (Remote sync is strictly disabled by default unless pcSyncOptIn is true)
  useEffect(() => {
    let mounted = true;

    // 1. Electron desktop IPC
    if (window.electronAPI && typeof window.electronAPI.loadOtSalaryData === 'function') {
      window.electronAPI.loadOtSalaryData().then((res) => {
        if (!mounted || !res || (!res.ok && !res.success)) return;
        if (res.filePath) setDiskPath(res.filePath);
        if (res.wifiOtUrl) setWifiOtUrl(res.wifiOtUrl);
        if (res.mobileOtUrl) setMobileOtUrl(res.mobileOtUrl);
        if (res.data) applyIncomingStore(res.data);
      }).catch(() => {});
    }

    let unsubscribeElectron = null;
    if (window.electronAPI && typeof window.electronAPI.onOtSalaryUpdated === 'function') {
      unsubscribeElectron = window.electronAPI.onOtSalaryUpdated((updatedData) => {
        if (mounted) applyIncomingStore(updatedData);
      });
    }

    // 2. Same-Browser Cross-Tab BroadcastChannel + Storage Event
    let bc = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('pattan_ot_salary_live_channel');
        bc.onmessage = (ev) => {
          if (mounted && ev?.data) applyIncomingStore(ev.data);
        };
      }
    } catch (_) {}

    const onStorage = (ev) => {
      if (ev.key === LS_OT_SALARY_KEY && ev.newValue && mounted) {
        try {
          applyIncomingStore(JSON.parse(ev.newValue));
        } catch (_) {}
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      mounted = false;
      window.removeEventListener('storage', onStorage);
      if (typeof unsubscribeElectron === 'function') unsubscribeElectron();
      try { if (bc) bc.close(); } catch (_) {}
    };
  }, [applyIncomingStore]);

  const persistStore = useCallback((nextSettings, nextDays, message = 'Saved', customExpenses = null) => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const stampedDays = {};
    for (const [iso, rec] of Object.entries(nextDays || {})) {
      if (!rec) continue;
      stampedDays[iso] = {
        ...rec,
        updatedAt: rec.updatedAt || nowIso,
        updatedAtMs: Number(rec.updatedAtMs || Date.parse(rec.updatedAt || rec.savedAt || '') || nowMs),
      };
    }
    const activeExpenses = customExpenses !== null ? customExpenses : (expensesMapRef.current || {});
    const stampedExpenses = {};
    for (const [txId, tx] of Object.entries(activeExpenses)) {
      if (!tx) continue;
      stampedExpenses[txId] = {
        ...tx,
        updatedAt: tx.updatedAt || nowIso,
        updatedAtMs: Number(tx.updatedAtMs || Date.parse(tx.updatedAt || '') || tx.timestampMs || nowMs),
      };
    }

    // Save private Expense Memory transactions to Android-Keystore AES-256-GCM encrypted store (never plaintext localStorage)
    const expSaveRes = saveEncryptedExpenseStore(stampedExpenses);

    // Salary & Attendance payload (excludes private Expense Memory transactions from plaintext localStorage & network sync)
    const attendancePayload = {
      type: 'OT_SALARY_LIVE_SYNC',
      clientId: clientIdRef.current,
      settings: nextSettings,
      settingsUpdatedAt: settingsUpdatedAtRef.current || nowMs,
      days: stampedDays,
      updatedAt: nowIso,
      updatedAtMs: nowMs,
    };
    lastAppliedSyncMsRef.current = nowMs;

    try {
      localStorage.setItem(LS_OT_SALARY_KEY, JSON.stringify(attendancePayload));
    } catch (_) {}

    // Broadcast attendance across same-origin tabs
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const bc = new BroadcastChannel('pattan_ot_salary_live_channel');
        bc.postMessage(attendancePayload);
        bc.close();
      }
    } catch (_) {}

    // Save via Electron IPC if in desktop shell
    if (window.electronAPI && typeof window.electronAPI.saveOtSalaryData === 'function') {
      window.electronAPI.saveOtSalaryData(attendancePayload).then((res) => {
        if (res?.filePath) setDiskPath(res.filePath);
      }).catch(() => {});
    }

    // Only push attendance to user-configured PC sync endpoint when pcSyncOptIn is explicitly enabled
    if (pcSyncOptIn) {
      const jsonBody = JSON.stringify(attendancePayload);
      const lanBases = getCandidateLanBases();
      for (const base of lanBases) {
        const url = `${base}/api/ot-salary-sync`;
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: jsonBody,
        }).then((res) => res.ok ? res.json() : null).then((json) => {
          if (json && (json.ok || json.success) && json.data) {
            applyIncomingStore(json.data);
          }
        }).catch(() => {});
      }
    }

    if (message) {
      const storageWarn = customExpenses !== null && !expSaveRes.ok ? ` · ⚠️ ${expSaveRes.reason}` : '';
      setSaveNotice(`${message}${storageWarn} (${new Date(nowMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`);
    }
  }, [pcSyncOptIn, getCandidateLanBases, applyIncomingStore]);

  const handleUpdateExpenses = useCallback((nextExpensesMap, noticeMessage = 'Updated Expenses') => {
    expensesMapRef.current = nextExpensesMap;
    setExpensesMap(nextExpensesMap);
    persistStore(settings, daysMap, noticeMessage, nextExpensesMap);
  }, [settings, daysMap, persistStore]);

  // Global listener & auto-sync for real UPI / Bank payment notifications across all tabs
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const ingestNativeTxList = (txList) => {
      if (!Array.isArray(txList) || txList.length === 0) return;
      const currentMap = expensesMapRef.current || {};
      const { nextMap, addedCount, updatedCount } = reconcileAndMergeTransactions(
        currentMap,
        txList,
        'android-notif'
      );
      if (addedCount > 0 || updatedCount > 0) {
        expensesMapRef.current = nextMap;
        setExpensesMap(nextMap);
        saveEncryptedExpenseStore(nextMap);
        const latest = txList[0];
        if (addedCount > 0 && latest && Number(latest.amount) > 0) {
          const dirLabel = latest.type === 'credit' ? 'Received' : 'Paid';
          const appName = latest.app || latest.paymentMethod || 'UPI';
          const merchName = latest.merchant ? ` · ${latest.merchant}` : '';
          setSaveNotice(`📲 ${appName}: ${dirLabel} ₹${formatINR(latest.amount)}${merchName}`);
        }
      }
    };

    const syncSavedNativeTransactions = () => {
      try {
        const encLoaded = loadEncryptedExpenseStore();
        if (encLoaded && encLoaded.ready && encLoaded.expenses && Object.keys(encLoaded.expenses).length > 0) {
          const currentKeys = Object.keys(expensesMapRef.current || {});
          const loadedKeys = Object.keys(encLoaded.expenses);
          if (loadedKeys.some((k) => !currentKeys.includes(k))) {
            const merged = { ...(expensesMapRef.current || {}), ...encLoaded.expenses };
            expensesMapRef.current = merged;
            setExpensesMap(merged);
          }
        }
        if (window.PattanBiometric) {
          if (typeof window.PattanBiometric.getSavedMobileTransactionsJson === 'function') {
            const rawJson = window.PattanBiometric.getSavedMobileTransactionsJson();
            const parsed = JSON.parse(rawJson || '[]');
            if (Array.isArray(parsed) && parsed.length > 0) {
              ingestNativeTxList(parsed);
            }
          }
          if (typeof window.PattanBiometric.scanMobileTransactionsSilent === 'function') {
            window.PattanBiometric.scanMobileTransactionsSilent(45);
          }
        }
      } catch (_) {}
    };

    const onMobileTxEvent = (ev) => {
      const txList = ev?.detail?.transactions;
      if (Array.isArray(txList) && txList.length > 0) {
        ingestNativeTxList(txList);
      }
    };

    const onVisibilityOrFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        syncSavedNativeTransactions();
      }
    };

    syncSavedNativeTransactions();
    window.addEventListener('pattan-mobile-transactions', onMobileTxEvent);
    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);

    return () => {
      window.removeEventListener('pattan-mobile-transactions', onMobileTxEvent);
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
    };
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
    const baseMinuteRate = baseHourlyRate / 60;
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
      baseMinuteRate,
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
      const outT = existing.outTime || '';
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
      setEntryOutTime('');
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
    const outTime = record?.outTime || '';

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
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
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
      biometricInAt: entryBiometricIn ? (existing.biometricInAt || nowIso) : null,
      biometricOutAt: entryBiometricOut ? (existing.biometricOutAt || nowIso) : null,
      basePaySnapshot: Number(calc.basePay.toFixed(2)),
      otPaySnapshot: Number(calc.otPay.toFixed(2)),
      totalPaySnapshot: Number(calc.totalPay.toFixed(2)),
      savedAt: nowIso,
      updatedAt: nowIso,
      updatedAtMs: nowMs,
    };
    const nextDays = { ...daysMap, [selectedDate]: record };
    setDaysMap(nextDays);
    persistStore(
      settings,
      nextDays,
      `Saved ${selectedDate} (${formatTime12h(entryInTime)} – ${entryOutTime ? formatTime12h(entryOutTime) : 'Pending OUT'}) · WhatsApp Sent`
    );
    if (String(entryOutTime || '').trim()) {
      sendWhatsAppAttendanceAndPaymentAlert('out', {
        date: selectedDate,
        inTime: entryInTime,
        outTime: entryOutTime,
        workedMins: calc.workedMins,
        otMins: calc.otMins,
        status: entryStatus,
        isBiometric: Boolean(entryBiometricOut),
        note: String(entryNote || '').trim(),
        calculation: calc,
      });
    } else if (String(entryInTime || '').trim()) {
      sendWhatsAppAttendanceAndPaymentAlert('in', {
        date: selectedDate,
        inTime: entryInTime,
        outTime: '',
        status: entryStatus,
        isBiometric: Boolean(entryBiometricIn),
        note: String(entryNote || '').trim(),
      });
    }
  };

  // Quick update a row directly from the monthly table (including Enter Time / Exit Time changes!)
  const upsertDayFromTable = (isoDate, patch) => {
    const existing = daysMap[isoDate] || {
      date: isoDate,
      status: new Date(`${isoDate}T00:00:00`).getDay() === 0 ? 'holiday_paid' : 'present',
      inTime: settings.officeStartTime || '10:00',
      outTime: '',
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

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const calc = computeDayEarnings(merged);
    merged.workedMins = calc.workedMins;
    merged.basePaySnapshot = Number(calc.basePay.toFixed(2));
    merged.otPaySnapshot = Number(calc.otPay.toFixed(2));
    merged.totalPaySnapshot = Number(calc.totalPay.toFixed(2));
    merged.savedAt = nowIso;
    merged.updatedAt = nowIso;
    merged.updatedAtMs = nowMs;

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
    settingsUpdatedAtRef.current = Date.now();
    const next = { ...settings, [key]: value };
    setSettings(next);
    persistStore(next, daysMap, 'Updated salary settings');
  };

  // Build rows for the selected month (outTime is empty until user sets or punches Exit)
  const monthRows = useMemo(() => {
    const calendarDays = buildMonthDates(selectedMonth);
    return calendarDays.map((dayInfo) => {
      const saved = daysMap[dayInfo.iso] || null;
      const effectiveRecord = saved || {
        date: dayInfo.iso,
        status: dayInfo.isSunday ? 'holiday_paid' : 'present',
        inTime: settings.officeStartTime || '10:00',
        outTime: '',
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
    if (viewFilter === 'ot_only') return monthRows.filter((r) => r.earnings.otMins > 0 || r.record.extraAllowance > 0 || r.record.status === 'ot_only');
    if (viewFilter === 'present') return monthRows.filter((r) => r.record.status === 'present');
    if (viewFilter === 'half') return monthRows.filter((r) => r.record.status === 'half');
    if (viewFilter === 'off') return monthRows.filter((r) => r.record.status === 'holiday_paid' || r.isSunday);
    if (viewFilter === 'leave') return monthRows.filter((r) => r.record.status === 'leave');
    return monthRows;
  }, [monthRows, viewFilter]);

  // Multi-day bulk selection helpers
  const toggleBulkSelectDate = (isoDate) => {
    setSelectedBulkDates((prev) =>
      prev.includes(isoDate) ? prev.filter((d) => d !== isoDate) : [...prev, isoDate]
    );
  };

  const selectAllBulkDates = () => {
    const allIsos = filteredMonthRows.map((r) => r.iso);
    const allSelected = allIsos.length > 0 && allIsos.every((iso) => selectedBulkDates.includes(iso));
    if (allSelected) {
      setSelectedBulkDates([]);
    } else {
      setSelectedBulkDates(allIsos);
    }
  };

  const selectWorkingBulkDates = () => {
    const workingIsos = filteredMonthRows.filter((r) => !r.isSunday).map((r) => r.iso);
    setSelectedBulkDates(workingIsos);
  };

  const clearBulkDates = () => {
    setSelectedBulkDates([]);
  };

  const applyBulkTimeToSelectedDays = (mode = 'both') => {
    const targetDates = selectedBulkDates.length > 0
      ? selectedBulkDates
      : filteredMonthRows.map((r) => r.iso);
    if (targetDates.length === 0) return;
    const nextDays = { ...daysMap };
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    for (const iso of targetDates) {
      const dt = new Date(`${iso}T00:00:00`);
      const isSun = !Number.isNaN(dt.getTime()) && dt.getDay() === 0;
      const existing = nextDays[iso] || {
        date: iso,
        status: isSun ? 'holiday_paid' : 'present',
        inTime: settings.officeStartTime || '10:00',
        outTime: '',
        otHours: 0,
        extraAllowance: 0,
        note: '',
      };

      const nextStatus = bulkStatus !== 'keep'
        ? bulkStatus
        : (existing.status || (isSun ? 'holiday_paid' : 'present'));
      const nextInTime = (mode === 'in' || mode === 'both')
        ? (bulkInTime || settings.officeStartTime || '10:00')
        : (existing.inTime || settings.officeStartTime || '10:00');
      const nextOutTime = mode === 'clear_out'
        ? ''
        : (mode === 'out' || mode === 'both')
          ? (bulkOutTime || '')
          : (existing.outTime || '');

      const timing = calculateWorkTiming({
        inTime: nextInTime,
        outTime: nextOutTime,
        status: nextStatus,
        officeStartTime: settings.officeStartTime,
        officeEndTime: settings.officeEndTime,
        otTimeCalcMode: settings.otTimeCalcMode,
      });

      const merged = {
        ...existing,
        date: iso,
        status: nextStatus,
        inTime: nextInTime,
        outTime: nextOutTime,
        workedMins: timing.workedMins,
        otHours: Number((timing.otMins / 60).toFixed(4)),
        savedAt: nowIso,
        updatedAt: nowIso,
        updatedAtMs: nowMs,
      };
      const calc = computeDayEarnings(merged);
      merged.basePaySnapshot = Number(calc.basePay.toFixed(2));
      merged.otPaySnapshot = Number(calc.otPay.toFixed(2));
      merged.totalPaySnapshot = Number(calc.totalPay.toFixed(2));
      nextDays[iso] = merged;
    }

    setDaysMap(nextDays);
    if (targetDates.includes(selectedDate) && nextDays[selectedDate]) {
      setEntryStatus(nextDays[selectedDate].status);
      setEntryInTime(nextDays[selectedDate].inTime);
      setEntryOutTime(nextDays[selectedDate].outTime || '');
      setEntryOtHours(nextDays[selectedDate].otHours || 0);
    }
    const modeLabel = mode === 'in'
      ? `IN (${formatTime12h(bulkInTime)})`
      : mode === 'out'
        ? `OUT (${formatTime12h(bulkOutTime)})`
        : mode === 'clear_out'
          ? 'Cleared OUT time'
          : `IN ${formatTime12h(bulkInTime)} & OUT ${formatTime12h(bulkOutTime)}`;
    persistStore(settings, nextDays, `✓ Applied ${modeLabel} to ${targetDates.length} day(s)`);
  };

  // Monthly totals summary
  const monthSummary = useMemo(() => {
    let savedDaysCount = 0;
    let savedBaseTotal = 0;
    let totalWorkedMins = 0;
    let totalOtMins = 0;
    let totalOtHours = 0;
    let totalOtPay = 0;
    let totalExtraAllowance = 0;
    let presentDays = 0;
    let paidHolidays = 0;
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
      if (row.record.status === 'present') presentDays += 1;
      if (row.record.status === 'holiday_paid') paidHolidays += 1;
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
      presentDays,
      paidHolidays,
      leaveDays,
      unpaidLeaves: leaveDays,
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
          outTime: '',
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
    lines.push(`"Employee Name","${normalizeEmployeeName(settings.employeeName).replace(/"/g, '""')}"`);
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

  // Send WhatsApp Attendance (IN / OUT) & Payment Details to +91 7386726193
  const sendWhatsAppAttendanceAndPaymentAlert = useCallback((direction, payload = {}) => {
    const targetPhoneE164 = '917386726193';
    const empName = normalizeEmployeeName(settings.employeeName);
    const dateStr = payload.date || getTodayIsoDate();
    const inTimeFormatted = formatTime12h(payload.inTime || settings.officeStartTime || '10:00');
    const outTimeFormatted = payload.outTime ? formatTime12h(payload.outTime) : '--:-- (Pending OUT)';

    // Collect today's & recent payment/expense records for OUT message
    const allTxs = Object.values(expensesMapRef.current || {}).filter(
      (tx) => tx && typeof tx === 'object' && !tx._deleted && Number(tx.amount) > 0
    );
    const getTxSortMs = (tx) => Number(tx?.timestampMs || tx?.timestamp || tx?.updatedAtMs || 0);
    const todayTxs = allTxs
      .filter((tx) => String(tx.date || '').slice(0, 10) === dateStr)
      .sort((a, b) => getTxSortMs(b) - getTxSortMs(a));
    const recentTxs = (todayTxs.length > 0 ? todayTxs : allTxs)
      .slice()
      .sort((a, b) => getTxSortMs(b) - getTxSortMs(a))
      .slice(0, 5);

    let messageText = '';
    if (direction === 'in') {
      messageText = [
        `🟢 *ATTENDANCE IN REPORT*`,
        `👤 *Name:* ${empName}`,
        `📅 *Date:* ${dateStr}`,
        `⏰ *IN Time:* ${inTimeFormatted}`,
        `🚪 *OUT Time:* Pending (On Duty)`,
        `🔐 *Verification:* ${payload.isBiometric ? 'Biometric Verified' : 'Live Punch'}`,
        payload.note ? `📝 *Note:* ${payload.note}` : '',
      ].filter(Boolean).join('\n');
    } else {
      const calc = payload.calculation || {};
      const todaySpendTotal = todayTxs
        .filter((tx) => String(tx.type || tx.direction || 'debit').toLowerCase() !== 'credit')
        .reduce((acc, tx) => acc + (Number(tx.amount) || 0), 0);
      const paymentLines = recentTxs.length > 0
        ? recentTxs.map((tx, idx) => {
            const txNote = String(tx.personalNote || tx.note || tx.paymentRemark || '').trim();
            const txApp = tx.app || tx.paymentApp || tx.sourceApp || tx.paymentMethod || 'UPI';
            const txSign = String(tx.type || tx.direction || 'debit').toLowerCase() === 'credit' ? '+' : '-';
            return `  ${idx + 1}. ${txSign}₹${formatINR(tx.amount)} → *${tx.merchant || 'Merchant'}* (${tx.time || '--:--'} · ${txApp})${txNote ? ` | 📌 For: ${txNote}` : ''}`;
          })
        : ['  • No UPI payments recorded today'];

      messageText = [
        `🔴 *ATTENDANCE OUT & PAYMENT REPORT*`,
        `👤 *Name:* ${empName}`,
        `📅 *Date:* ${dateStr}`,
        `🟢 *IN Time:* ${inTimeFormatted}`,
        `🔴 *OUT Time:* ${outTimeFormatted}`,
        `⏱️ *Worked Time:* ${formatMinutesReadable(payload.workedMins || 0)} (Extra OT: ${formatMinutesReadable(payload.otMins || 0)})`,
        payload.note ? `📝 *Shift Note:* ${payload.note}` : '',
        ``,
        `💰 *TODAY SALARY & OT PAYMENT DETAILS:*`,
        `  • Base Day Pay: ₹${formatINR(calc.basePay || 0)}`,
        `  • Extra OT Pay: +₹${formatINR(calc.otPay || 0)}`,
        (Number(calc.extraAllowance) || 0) > 0 ? `  • Extra Bonus: +₹${formatINR(calc.extraAllowance)}` : '',
        `  • *Total Day Earnings:* *₹${formatINR(calc.totalPay || 0)}*`,
        ``,
        `💳 *PAYMENT & EXPENSE DETAILS (${todayTxs.length > 0 ? `Today ₹${formatINR(todaySpendTotal)}` : 'Recent Payments'}):*`,
        ...paymentLines,
      ].filter(Boolean).join('\n');
    }

    if (typeof window !== 'undefined') {
      try {
        const waBridge = window.PattanBiometric || window.PattanBiometricBridge || window.PattanSecureWhatsApp;
        if (waBridge && typeof waBridge.sendWhatsAppMessageToNumber === 'function') {
          const ok = waBridge.sendWhatsAppMessageToNumber(targetPhoneE164, messageText);
          if (ok !== false) return true;
        }
      } catch (_) {}
      try {
        const encoded = encodeURIComponent(messageText);
        const isMobileUa = /Android|iPhone|iPad|iPod/i.test(String(navigator?.userAgent || ''));
        if (isMobileUa) {
          window.location.href = `whatsapp://send?phone=${targetPhoneE164}&text=${encoded}`;
          return true;
        }
        const waUrl = `https://api.whatsapp.com/send?phone=${targetPhoneE164}&text=${encoded}`;
        window.open(waUrl, '_blank', 'noopener,noreferrer');
        return true;
      } catch (_) {}
    }
    return false;
  }, [settings.employeeName, settings.officeStartTime]);

  // Trigger Notification: "Normal Office Time Ends & OT Time Starts"
  const triggerOfficeEndAndOtStartNotification = useCallback((endHHMMOverride = '') => {
    const todayIso = getTodayIsoDate();
    const empName = normalizeEmployeeName(settings.employeeName);
    const todayRec = daysMap[todayIso] || {};
    const inTimeUsed = todayRec.inTime || entryInTime || settings.officeStartTime || '10:00';
    const endHHMM = endHHMMOverride || settings.officeEndTime || '18:30';
    const endFormatted = formatTime12h(endHHMM);
    const title = '⏰ Office Time Ends & OT Time Starts!';
    const body = `Hi ${empName}, normal office time (${endFormatted}) has ended! Your Extra Overtime (OT) time and OT pay (+₹${formatINR(rates.otHourlyRate)}/hr) have now started! ⚡`;

    playBiometricBeep('in');
    triggerBiometricHaptic(140);

    setOtTimeStartedBanner({
      date: todayIso,
      officeEndTimeFormatted: endFormatted,
      inTimeFormatted: formatTime12h(inTimeUsed),
      startedAtHHMM: getCurrentTime24h(),
      title,
      body,
    });
    setSaveNotice(`⏰ Normal Office Time (${endFormatted}) Ended — Extra OT Time Started! ⚡`);

    if (typeof window !== 'undefined') {
      try {
        const nativeBridge = window.PattanBiometric || window.PattanBiometricBridge;
        if (nativeBridge && typeof nativeBridge.triggerOfficeEndOtStartNotification === 'function') {
          nativeBridge.triggerOfficeEndOtStartNotification(title, body);
        } else if (typeof Notification !== 'undefined') {
          if (Notification.permission === 'granted') {
            new Notification(title, { body });
          } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then((perm) => {
              if (perm === 'granted') new Notification(title, { body });
            }).catch(() => {});
          }
        }
      } catch (_) {}
    }
  }, [settings.employeeName, settings.officeStartTime, settings.officeEndTime, daysMap, entryInTime, rates.otHourlyRate]);

  // Sync Native Android Daily Alarm for Normal Office End Time & Live Auto-Trigger when Office Time Ends
  useEffect(() => {
    const todayIso = getTodayIsoDate();
    const todayRec = daysMap[todayIso];
    const officeEndDefaultMins = parseTimeToMinutes(settings.officeEndTime || '18:30', 18 * 60 + 30);
    let targetEndMins = officeEndDefaultMins;
    if (todayRec?.inTime && settings.otTimeCalcMode === 'in_out_duration') {
      const inM = parseTimeToMinutes(todayRec.inTime, 10 * 60);
      targetEndMins = (inM + rates.shiftMins) % 1440;
    }
    const endHour24 = Math.floor(targetEndMins / 60);
    const endMin = targetEndMins % 60;

    if (typeof window !== 'undefined') {
      try {
        const nativeBridge = window.PattanBiometric || window.PattanBiometricBridge;
        if (nativeBridge && typeof nativeBridge.scheduleOfficeEndOtAlarm === 'function') {
          nativeBridge.scheduleOfficeEndOtAlarm(
            endHour24,
            endMin,
            normalizeEmployeeName(settings.employeeName)
          );
        }
      } catch (_) {}
    }
  }, [settings.officeEndTime, settings.officeStartTime, settings.otTimeCalcMode, settings.employeeName, daysMap, rates.shiftMins]);

  useEffect(() => {
    const todayIso = getTodayIsoDate();
    const todayRec = daysMap[todayIso];
    if (todayRec?.status === 'leave') return;
    if (todayRec?.outTime && String(todayRec.outTime).trim()) return; // Already punched OUT

    const officeEndDefaultMins = parseTimeToMinutes(settings.officeEndTime || '18:30', 18 * 60 + 30);
    let targetEndMins = officeEndDefaultMins;
    if (todayRec?.inTime && settings.otTimeCalcMode === 'in_out_duration') {
      const inM = parseTimeToMinutes(todayRec.inTime, 10 * 60);
      targetEndMins = (inM + rates.shiftMins) % 1440;
    }

    const nowMins = parseTimeToMinutes(liveClockHHMM, -1);
    if (nowMins < 0) return;

    if (nowMins >= targetEndMins) {
      let alreadyNotifiedDate = '';
      try {
        alreadyNotifiedDate = localStorage.getItem('pattan.ot.officeEndNotifiedDate') || '';
      } catch (_) {}
      if (alreadyNotifiedDate !== todayIso) {
        try {
          localStorage.setItem('pattan.ot.officeEndNotifiedDate', todayIso);
        } catch (_) {}
        const endHHMM = minutesToTimeInput(targetEndMins);
        triggerOfficeEndAndOtStartNotification(endHHMM);
      }
    }
  }, [liveClockHHMM, daysMap, settings.officeEndTime, settings.otTimeCalcMode, rates.shiftMins, triggerOfficeEndAndOtStartNotification]);

  // 1-Tap & Biometric Touch Sensor Live Mobile Punch Actions
  const punchEnterNowAndSave = (isBiometric = false, methodUsed = 'touch-sensor') => {
    const todayIso = getTodayIsoDate();
    const nowHHMM = getNowTimeHHMM();
    setLiveClockHHMM(nowHHMM);
    const existing = daysMap[todayIso];
    const outTime = existing?.outTime || '';
    const status = existing?.status || 'present';
    const timing = calculateWorkTiming({
      inTime: nowHHMM,
      outTime,
      status,
      officeStartTime: settings.officeStartTime,
      officeEndTime: settings.officeEndTime,
      otTimeCalcMode: settings.otTimeCalcMode,
    });
    const worked = timing.workedMins;
    const otMins = timing.otMins;
    const extraAllowance = Number(existing?.extraAllowance ?? existing?.extraBonus) || 0;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
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
        updatedAtMs: nowMs,
      },
    };
    setSelectedDate(todayIso);
    setSelectedMonth(todayIso.slice(0, 7));
    setEntryInTime(nowHHMM);
    setEntryOutTime(outTime);
    if (isBiometric) setEntryBiometricIn(true);
    setDaysMap(nextDays);
    persistStore(
      settings,
      nextDays,
      isBiometric
        ? `✓ Touch ID IN Verified at ${formatTime12h(nowHHMM)} (${todayIso}) · WhatsApp Sent`
        : `🟢 Punched Enter at ${formatTime12h(nowHHMM)} (${todayIso}) · WhatsApp Sent`
    );
    sendWhatsAppAttendanceAndPaymentAlert('in', {
      date: todayIso,
      inTime: nowHHMM,
      outTime,
      status,
      isBiometric,
      note: existing?.note || entryNote || '',
    });
    return { todayIso, nowHHMM, otMins, worked };
  };

  const punchExitNowAndSave = (isBiometric = false, methodUsed = 'touch-sensor') => {
    const todayIso = getTodayIsoDate();
    const nowHHMM = getNowTimeHHMM();
    setLiveClockHHMM(nowHHMM);
    const existing = daysMap[todayIso];
    const inTime = existing?.inTime || entryInTime || settings.officeStartTime || '10:00';
    const status = existing?.status || 'present';
    const timing = calculateWorkTiming({
      inTime,
      outTime: nowHHMM,
      status,
      officeStartTime: settings.officeStartTime,
      officeEndTime: settings.officeEndTime,
      otTimeCalcMode: settings.otTimeCalcMode,
    });
    const worked = timing.workedMins;
    const otMins = timing.otMins;
    const extraAllowance = Number(existing?.extraAllowance ?? existing?.extraBonus) || 0;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const savedDayRecord = {
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
      updatedAtMs: nowMs,
    };
    const nextDays = {
      ...daysMap,
      [todayIso]: savedDayRecord,
    };
    const existingCalcDayResult = computeDayEarnings(savedDayRecord);
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
        ? `✓ Touch ID OUT Verified at ${formatTime12h(nowHHMM)} (+${formatMinutesCompact(otMins)} OT saved) · WhatsApp Sent`
        : `🔴 Punched Exit at ${formatTime12h(nowHHMM)} (+${formatMinutesCompact(otMins)} OT saved) · WhatsApp Sent`
    );

    sendWhatsAppAttendanceAndPaymentAlert('out', {
      date: todayIso,
      inTime,
      outTime: nowHHMM,
      workedMins: worked,
      otMins,
      status,
      isBiometric,
      note: savedDayRecord.note || entryNote || '',
      calculation: existingCalcDayResult,
    });

    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('pattan:ot-punch-out-saved', {
          detail: {
            date: todayIso,
            record: savedDayRecord,
            settings,
            rates,
            calculation: existingCalcDayResult,
          },
        }));
      } catch (_) {}
    }

    return { todayIso, inTime, nowHHMM, otMins, worked, calculation: existingCalcDayResult };
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
      const verifiedMsg = `✅ Biometric OUT Verified at ${formatTime12h(res.nowHHMM)} · +${formatMinutesCompact(res.otMins)} OT (${formatSalaryMask(otEarned, '+₹')})`;
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
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const savedRec = {
      ...existing,
      date: todayIso,
      status,
      inTime,
      outTime,
      workedMins: worked,
      otHours: Number(otHoursValue) || 0,
      note: existing?.note || '',
      extraAllowance,
      savedAt: nowIso,
      updatedAt: nowIso,
      updatedAtMs: nowMs,
    };
    const nextDays = {
      ...daysMap,
      [todayIso]: savedRec,
    };
    const calc = computeDayEarnings(savedRec);
    setSelectedDate(todayIso);
    setSelectedMonth(todayIso.slice(0, 7));
    setEntryInTime(inTime);
    setEntryOutTime(outTime);
    setEntryOtHours(Number(otHoursValue) || 0);
    setDaysMap(nextDays);
    persistStore(
      settings,
      nextDays,
      `⚡ Saved Today (${todayIso}): ${formatTime12h(inTime)} → ${formatTime12h(outTime)} (+${otHoursValue}h OT) · WhatsApp Sent`
    );
    sendWhatsAppAttendanceAndPaymentAlert('out', {
      date: todayIso,
      inTime,
      outTime,
      workedMins: worked,
      otMins,
      status,
      isBiometric: false,
      note: savedRec.note || '',
      calculation: calc,
    });
  };

  const buildSalarySummaryText = () => {
    const lines = [
      `📊 *OT & Salary Report (${selectedMonth})*`,
      `👤 *Employee: ${normalizeEmployeeName(settings.employeeName)}*`,
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
    const htmlContent = generateStandaloneOtMobileHtml({ settings, days: daysMap, expenses: {} });
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OT-Salary-Mobile-App.html`;
    a.click();
    URL.revokeObjectURL(url);
    setSaveNotice('📱 Downloaded OT-Salary-Mobile-App.html');
    setTimeout(() => setSaveNotice(''), 4000);
  };

  const syncWithPcNow = async () => {
    if (!pcSyncOptIn) {
      setSyncStatusText('⚠️ Enable PC Sync consent first to sync attendance with your PC.');
      return;
    }
    setSyncBusy(true);
    setSyncStatusText('Syncing attendance with PC...');
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
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            settings: syncedPayload.settings || settings,
            days: syncedPayload.days || daysMap,
          }));
        } catch {}
        setSyncStatusText(`✓ Synced ${Object.keys(syncedPayload.days || {}).length} attendance days with PC (Expense Memory stays private on-device)`);
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
    const payload = JSON.stringify({ settings, days: daysMap, expenses: expensesMap, exportedAt: new Date().toISOString() }, null, 2);
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
        const nextExpenses = parsed.expenses && typeof parsed.expenses === 'object' ? { ...expensesMap, ...parsed.expenses } : expensesMap;
        setSettings(nextSettings);
        setDaysMap(nextDays);
        setExpensesMap(nextExpenses);
        expensesMapRef.current = nextExpenses;
        persistStore(nextSettings, nextDays, `Restored ${Object.keys(nextDays).length} days & ${Object.keys(nextExpenses).length} expenses`, nextExpenses);
      } catch {
        setSaveNotice('⚠️ Invalid JSON backup file');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const printMonthSalarySlip = () => {
    try {
      if (typeof window !== 'undefined' && typeof window.print === 'function') {
        window.print();
        setSaveNotice(`🖨️ Opened Salary Slip Print / PDF (${selectedMonth})`);
      }
    } catch (_) {}
  };

  const expenseQuickStats = useMemo(() => {
    const todayIso = getTodayIsoDate();
    const activeSource = expensesMap || {};

    let count = 0;
    let spent = 0;
    let income = 0;
    let todaySpent = 0;
    let missingNotesCount = 0;
    for (const tx of Object.values(activeSource)) {
      if (!tx || typeof tx !== 'object' || tx._deleted || tx.isDemoPreview || tx._demoPreview || !(Number(tx.amount) > 0)) continue;
      if (tx.status === 'failed' || tx.status === 'reversed') continue;
      if (selectedMonth && !String(tx.date || '').startsWith(selectedMonth)) continue;
      count += 1;
      const amt = Number(tx.amount) || 0;
      if (tx.type === 'credit') {
        income += amt;
      } else if (tx.type === 'refund') {
        spent = Math.max(0, spent - amt);
      } else {
        spent += amt;
        if (tx.date === todayIso) todaySpent += amt;
        if (!String(tx.personalNote || tx.note || '').trim() && !tx.noteReviewed) {
          missingNotesCount += 1;
        }
      }
    }
    return { count, spent, income, todaySpent, missingNotesCount };
  }, [expensesMap, selectedMonth]);

  const showTodaySection = mobileTab === 'today';
  const showExpensesSection = mobileTab === 'expenses';
  const showRulesSection = mobileTab === 'rules';
  const showMonthSection = mobileTab === 'month';
  const showSummarySection = mobileTab === 'summary';

  const isLight = themeMode === 'light';
  const ui = {
    pageBg: isLight
      ? 'linear-gradient(180deg, #f8fafc 0%, #eef2f6 50%, #e2e8f0 100%)'
      : 'radial-gradient(ellipse at 50% -10%, #132347 0%, #091124 48%, #040812 100%)',
    cardBg: isLight
      ? 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)'
      : 'linear-gradient(165deg, rgba(19, 30, 54, 0.95) 0%, rgba(10, 16, 31, 0.98) 100%)',
    cardSubBg: isLight ? '#f1f5f9' : 'rgba(9, 15, 29, 0.88)',
    border: isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(148, 163, 184, 0.16)',
    textPrimary: isLight ? '#0f172a' : '#f8fafc',
    textSecondary: isLight ? '#475569' : '#94a3b8',
    textMuted: isLight ? '#64748b' : '#64748b',
    shadow: isLight
      ? '0 10px 28px -6px rgba(15, 23, 42, 0.07), inset 0 1px 0 #ffffff'
      : '0 18px 42px -10px rgba(0, 0, 0, 0.62), inset 0 1px 0 rgba(255, 255, 255, 0.07)',
  };

  const formattedMonthLabel = (() => {
    const [yr, mo] = String(selectedMonth || '2026-10').split('-').map(Number);
    if (!yr || !mo) return selectedMonth;
    const dt = new Date(yr, mo - 1, 1);
    return dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  })();

  const shiftSelectedMonth = (delta) => {
    const [yr, mo] = String(selectedMonth || '2026-10').split('-').map(Number);
    if (!yr || !mo) return;
    const next = new Date(yr, mo - 1 + delta, 1);
    const nextYm = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    setSelectedMonth(nextYm);
    setSelectedDate(`${nextYm}-01`);
  };

  // Build 7-column calendar cells for Screen 4 Month Sheet
  const calendarGridCells = useMemo(() => {
    const [yr, mo] = String(selectedMonth || '2026-10').split('-').map(Number);
    if (!yr || !mo) return [];
    const firstWeekday = new Date(yr, mo - 1, 1).getDay(); // 0=Sun..6=Sat
    const cells = [];
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push(null);
    }
    for (const row of monthRows) {
      cells.push(row);
    }
    return cells;
  }, [selectedMonth, monthRows]);

  const progressRatio = Math.min(1, Math.max(0, monthSummary.savedDaysCount / Math.max(1, monthRows.length)));
  const ringRadius = 32;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = ringCircumference * (1 - progressRatio);

  return (
    <div
      className="ot-pro-shell"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        minHeight: '100%',
        background: ui.pageBg,
        color: ui.textPrimary,
        padding: mobileMode ? '12px 12px 98px' : '22px 24px 98px',
        fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        boxSizing: 'border-box',
        transition: 'background 0.25s ease, color 0.25s ease',
      }}
    >
      {/* SCREEN 1: SPLASH SCREEN OVERLAY (Toggleable via Logo / Splash button) */}
      {showSplash && (
        <div
          onClick={() => setShowSplash(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'radial-gradient(circle at 50% 35%, #112a4a 0%, #071022 58%, #040812 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 28,
            textAlign: 'center',
            color: '#f8fafc',
          }}
        >
          <div style={{
            width: 126,
            height: 126,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(16,185,129,0.22) 0%, rgba(37,99,235,0.18) 60%, rgba(15,23,42,0.95) 100%)',
            border: '2.5px solid rgba(56, 189, 248, 0.65)',
            boxShadow: '0 0 48px rgba(16, 185, 129, 0.45), inset 0 0 24px rgba(56, 189, 248, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 26,
            position: 'relative',
          }}>
            <svg width="68" height="68" viewBox="0 0 64 64" fill="none">
              <rect x="10" y="34" width="8" height="18" rx="3" fill="#38bdf8" />
              <rect x="22" y="24" width="8" height="28" rx="3" fill="#34d399" />
              <rect x="34" y="14" width="8" height="38" rx="3" fill="#10b981" />
              <circle cx="46" cy="20" r="11" fill="#059669" stroke="#a7f3d0" strokeWidth="2" />
              <text x="46" y="25" textAnchor="middle" fill="#ffffff" fontSize="14" fontWeight="900">₹</text>
            </svg>
          </div>
          <div style={{
            fontSize: 26,
            fontWeight: 950,
            letterSpacing: '0.02em',
            color: '#ffffff',
            lineHeight: 1.2,
          }}>
            OT &amp; SALARY PRO
          </div>
          <div style={{
            fontSize: 19,
            fontWeight: 900,
            color: '#34d399',
            marginTop: 4,
            letterSpacing: '0.04em',
          }}>
            + EXPENSE MEMORY
          </div>
          <div style={{
            fontSize: 13,
            color: '#94a3b8',
            marginTop: 12,
            maxWidth: 300,
            lineHeight: 1.5,
            fontWeight: 600,
          }}>
            Work Smart · Track Salary · Remember Every Payment
          </div>
          <button
            type="button"
            onClick={() => setShowSplash(false)}
            style={{
              marginTop: 32,
              padding: '13px 32px',
              borderRadius: 999,
              border: '1px solid rgba(52, 211, 153, 0.6)',
              background: 'linear-gradient(135deg, #2563eb, #10b981)',
              color: '#fff',
              fontWeight: 900,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: '0 12px 28px rgba(16, 185, 129, 0.35)',
            }}
          >
            Continue to Dashboard →
          </button>
        </div>
      )}

      <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* TOP PROFILE & CONTROLS HEADER (Executive Fintech Header) */}
        <div
          className="ot-no-print"
          style={{
            padding: '13px 15px',
            borderRadius: 22,
            background: ui.cardBg,
            border: `1px solid ${ui.border}`,
            boxShadow: ui.shadow,
            backdropFilter: 'blur(16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            {(mobileTab !== 'today' || selectedDate !== getTodayIsoDate() || onClose) && (
              <button
                type="button"
                onClick={() => {
                  const res = goBackStep();
                  if (res !== 'handled' && onClose) onClose();
                }}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 11,
                  border: `1px solid ${ui.border}`,
                  background: ui.cardSubBg,
                  color: ui.textPrimary,
                  fontWeight: 900,
                  fontSize: 15,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Go Back"
              >
                ←
              </button>
            )}

            {/* Avatar Circle (Tap to view Splash Screen 1) */}
            <div
              onClick={() => setShowSplash(true)}
              title="Tap to view OT & SALARY PRO Splash Screen"
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                background: 'linear-gradient(135deg, #2563eb 0%, #0ea5e9 52%, #10b981 100%)',
                border: '1.5px solid rgba(110, 231, 183, 0.7)',
                boxShadow: '0 6px 16px rgba(37, 99, 235, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontWeight: 950,
                fontSize: 15,
                letterSpacing: '0.02em',
                cursor: 'pointer',
                position: 'relative',
                flexShrink: 0,
              }}
            >
              {getEmployeeInitials(settings.employeeName)}
              <span style={{
                position: 'absolute',
                right: -2,
                bottom: -2,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: '#10b981',
                border: isLight ? '2px solid #ffffff' : '2px solid #0b1222',
              }} />
            </div>

            <div>
              <div style={{
                fontSize: 15,
                fontWeight: 900,
                color: ui.textPrimary,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
              }}>
                <span>Hi, {normalizeEmployeeName(settings.employeeName)}</span>
                <span style={{
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: isLight ? 'rgba(16, 185, 129, 0.14)' : 'rgba(16, 185, 129, 0.18)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  color: isLight ? '#047857' : '#6ee7b7',
                  fontSize: 9.5,
                  fontWeight: 900,
                  letterSpacing: '0.04em',
                }}>
                  PRO · BIOMETRIC
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => {
                    if (e.target.value) setSelectedMonth(e.target.value);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    color: ui.textSecondary,
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {/* Light / Dark Mode Toggle (Screen 12 Light Mode Preview) */}
            <button
              type="button"
              onClick={toggleThemeMode}
              title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode (Screen 12)'}
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                border: `1px solid ${ui.border}`,
                background: ui.cardSubBg,
                color: ui.textPrimary,
                fontSize: 16,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isLight ? '🌙' : '☀️'}
            </button>

            {/* Notification Bell with Red Dot (Opens Activity & Notification Center Modal, does NOT force-redirect to Expenses) */}
            <button
              type="button"
              onClick={() => setShowNotificationsModal(true)}
              title="Open Attendance & Payment Notifications Center"
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                border: `1px solid ${ui.border}`,
                background: ui.cardSubBg,
                color: ui.textPrimary,
                fontSize: 15,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              🔔
              <span style={{
                position: 'absolute',
                top: 6,
                right: 7,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#ef4444',
              }} />
            </button>

            {/* App / Sync Button */}
            <button
              type="button"
              onClick={() => setShowMobileAppModal(true)}
              style={{
                padding: '8px 11px',
                borderRadius: 11,
                border: '1px solid rgba(37, 99, 235, 0.45)',
                background: isLight ? 'rgba(37, 99, 235, 0.1)' : 'rgba(37, 99, 235, 0.2)',
                color: isLight ? '#1d4ed8' : '#93c5fd',
                fontWeight: 800,
                fontSize: 11.5,
                cursor: 'pointer',
              }}
            >
              App / Sync
            </button>
          </div>
        </div>

        {saveNotice && (
          <div style={{
            padding: '8px 12px',
            borderRadius: 12,
            background: 'rgba(16, 185, 129, 0.16)',
            border: '1px solid rgba(52, 211, 153, 0.5)',
            color: isLight ? '#065f46' : '#a7f3d0',
            fontSize: 12,
            fontWeight: 800,
            textAlign: 'center',
          }}>
            ✓ {saveNotice}
          </div>
        )}

        {/* ⏰ LIVE NOTIFICATION BANNER: NORMAL OFFICE TIME ENDS & OT TIME STARTS */}
        {otTimeStartedBanner && (
          <div style={{
            padding: '12px 14px',
            borderRadius: 16,
            background: isLight
              ? 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)'
              : 'linear-gradient(135deg, rgba(245, 158, 11, 0.22) 0%, rgba(16, 185, 129, 0.18) 100%)',
            border: '1.5px solid rgba(245, 158, 11, 0.65)',
            boxShadow: ui.shadow,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
          }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 950, color: isLight ? '#92400e' : '#fde68a' }}>
                {otTimeStartedBanner.title}
              </div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: ui.textPrimary, marginTop: 2, lineHeight: 1.35 }}>
                {otTimeStartedBanner.body}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOtTimeStartedBanner(null)}
              style={{
                padding: '6px 10px',
                borderRadius: 9,
                border: `1px solid ${ui.border}`,
                background: ui.cardSubBg,
                color: ui.textPrimary,
                fontWeight: 800,
                fontSize: 11,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              Got It ✓
            </button>
          </div>
        )}

        {/* 🔔 NOTIFICATIONS & ACTIVITY CENTER MODAL (Attendance + WhatsApp + Payments) */}
        {showNotificationsModal && (
          <div
            onClick={() => setShowNotificationsModal(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              background: 'rgba(2, 6, 23, 0.78)',
              backdropFilter: 'blur(6px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 14,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: 480,
                maxHeight: '86vh',
                overflowY: 'auto',
                borderRadius: 20,
                background: isLight ? '#ffffff' : '#0f172a',
                border: `1px solid ${ui.border}`,
                boxShadow: '0 22px 50px rgba(0, 0, 0, 0.55)',
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: ui.textPrimary }}>
                    🔔 Notifications &amp; Activity Center
                  </div>
                  <div style={{ fontSize: 11, color: ui.textSecondary }}>
                    Office End &amp; OT Start alerts, WhatsApp (+91 7386726193) &amp; UPI Payment notifications
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNotificationsModal(false)}
                  style={{
                    padding: '6px 11px',
                    borderRadius: 9,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardSubBg,
                    color: ui.textPrimary,
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  ✕ Close
                </button>
              </div>

              {/* ⏰ Normal Office Time Ends & OT Time Starts Alert Card */}
              <div style={{
                padding: 12,
                borderRadius: 14,
                background: isLight ? 'rgba(245, 158, 11, 0.1)' : 'rgba(245, 158, 11, 0.14)',
                border: '1px solid rgba(245, 158, 11, 0.45)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: isLight ? '#92400e' : '#fcd34d' }}>
                    ⏰ Office Time Ends &amp; OT Time Starts Notification
                  </div>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'rgba(16, 185, 129, 0.2)',
                    color: '#10b981',
                    fontSize: 10,
                    fontWeight: 900,
                  }}>
                    ACTIVE ({formatTime12h(settings.officeEndTime || '18:30')})
                  </span>
                </div>
                <div style={{ fontSize: 11, color: ui.textSecondary, lineHeight: 1.4 }}>
                  Automatically sends an Android system notification + sound/vibration whenever your normal office shift (<strong>{formatTime12h(settings.officeStartTime || '10:00')} – {formatTime12h(settings.officeEndTime || '18:30')}</strong>) ends and Extra Overtime (OT) starts.
                </div>
                <button
                  type="button"
                  onClick={() => triggerOfficeEndAndOtStartNotification()}
                  style={{
                    padding: '9px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(245, 158, 11, 0.55)',
                    background: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: 11.5,
                    cursor: 'pointer',
                  }}
                >
                  🔔 Test &ldquo;Office Time Ends &amp; OT Time Starts&rdquo; Notification Now
                </button>
              </div>

              {/* Quick WhatsApp Share for Today IN / OUT */}
              <div style={{
                padding: 12,
                borderRadius: 14,
                background: isLight ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: isLight ? '#065f46' : '#6ee7b7' }}>
                  📲 WhatsApp Live Attendance &amp; Payment Alert (+91 7386726193)
                </div>
                <div style={{ fontSize: 11, color: ui.textSecondary, lineHeight: 1.4 }}>
                  Whenever you punch IN or OUT, a WhatsApp message is prepared for <strong>+91 7386726193</strong>. You can also send or re-send now:
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const todayIso = getTodayIsoDate();
                      const rec = daysMap[todayIso] || {};
                      sendWhatsAppAttendanceAndPaymentAlert('in', {
                        date: todayIso,
                        inTime: rec.inTime || entryInTime || settings.officeStartTime || '10:00',
                        outTime: rec.outTime || '',
                        status: rec.status || 'present',
                        isBiometric: Boolean(rec.biometricIn),
                        note: rec.note || entryNote || '',
                      });
                    }}
                    style={{
                      padding: '9px 10px',
                      borderRadius: 10,
                      border: '1px solid rgba(16, 185, 129, 0.5)',
                      background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                      color: '#ffffff',
                      fontWeight: 900,
                      fontSize: 11.5,
                      cursor: 'pointer',
                    }}
                  >
                    🟢 Send IN Time on WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const todayIso = getTodayIsoDate();
                      const rec = daysMap[todayIso] || {
                        date: todayIso,
                        status: entryStatus || 'present',
                        inTime: entryInTime || settings.officeStartTime || '10:00',
                        outTime: entryOutTime || getNowTimeHHMM(),
                      };
                      const calc = computeDayEarnings(rec);
                      sendWhatsAppAttendanceAndPaymentAlert('out', {
                        date: todayIso,
                        inTime: rec.inTime || settings.officeStartTime || '10:00',
                        outTime: rec.outTime || getNowTimeHHMM(),
                        workedMins: calc.workedMins,
                        otMins: calc.otMins,
                        status: rec.status || 'present',
                        isBiometric: Boolean(rec.biometricOut),
                        note: rec.note || entryNote || '',
                        calculation: calc,
                      });
                    }}
                    style={{
                      padding: '9px 10px',
                      borderRadius: 10,
                      border: '1px solid rgba(37, 99, 235, 0.5)',
                      background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
                      color: '#ffffff',
                      fontWeight: 900,
                      fontSize: 11.5,
                      cursor: 'pointer',
                    }}
                  >
                    🔴 Send OUT + Payment on WhatsApp
                  </button>
                </div>
              </div>

              {/* Recent Attendance Activity Log */}
              <div style={{
                padding: 12,
                borderRadius: 14,
                background: ui.cardSubBg,
                border: `1px solid ${ui.border}`,
              }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: ui.textPrimary, marginBottom: 8 }}>
                  🕒 Recent Attendance Activity ({normalizeEmployeeName(settings.employeeName)})
                </div>
                {Object.values(daysMap || {})
                  .filter((d) => d && d.date)
                  .sort((a, b) => String(b.date).localeCompare(String(a.date)))
                  .slice(0, 5)
                  .map((d) => (
                    <div
                      key={d.date}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '7px 0',
                        borderBottom: `1px solid ${ui.border}`,
                        fontSize: 11.5,
                      }}
                    >
                      <div>
                        <strong style={{ color: ui.textPrimary }}>{d.date}</strong>{' '}
                        <span style={{ color: ui.textSecondary }}>({d.status || 'present'})</span>
                      </div>
                      <div style={{ fontWeight: 800, color: '#34d399' }}>
                        IN: {formatTime12h(d.inTime)} · OUT: {d.outTime ? formatTime12h(d.outTime) : '--:-- (Pending)'}
                      </div>
                    </div>
                  ))}
                {Object.keys(daysMap || {}).length === 0 && (
                  <div style={{ fontSize: 11.5, color: ui.textMuted }}>
                    No attendance punches saved yet. Tap IN or OUT on the Today screen.
                  </div>
                )}
              </div>

              {/* Recent Auto-Detected Payment Notifications Summary */}
              <div style={{
                padding: 12,
                borderRadius: 14,
                background: ui.cardSubBg,
                border: `1px solid ${ui.border}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: ui.textPrimary }}>
                    💳 Auto-Detected Payment Notifications ({Object.keys(expensesMap || {}).length} Permanent)
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNotificationsModal(false);
                      navigateTab('expenses');
                    }}
                    style={{
                      padding: '5px 9px',
                      borderRadius: 8,
                      border: '1px solid rgba(219, 39, 119, 0.45)',
                      background: 'rgba(219, 39, 119, 0.14)',
                      color: '#f472b6',
                      fontWeight: 800,
                      fontSize: 10.5,
                      cursor: 'pointer',
                    }}
                  >
                    🔐 Unlock Expense Memory →
                  </button>
                </div>
                <div style={{ fontSize: 11, color: ui.textSecondary }}>
                  Expense Memory is protected by your Fingerprint / Biometric lock. Tap above to authenticate and view full payment details.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SEGMENTED PILL SWITCHER: OT & Salary | Expense Memory (Screen 2 & Screen 7) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          padding: 5,
          borderRadius: 16,
          background: isLight ? '#e2e8f0' : '#090f1d',
          border: `1px solid ${ui.border}`,
        }}>
          <button
            type="button"
            onClick={() => navigateTab('today')}
            style={{
              padding: '11px 12px',
              borderRadius: 12,
              border: mobileTab !== 'expenses' ? '1px solid rgba(59, 130, 246, 0.6)' : '1px solid transparent',
              background: mobileTab !== 'expenses'
                ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)'
                : 'transparent',
              color: mobileTab !== 'expenses' ? '#ffffff' : ui.textSecondary,
              fontWeight: 800,
              fontSize: 13.5,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              boxShadow: mobileTab !== 'expenses' ? '0 6px 16px rgba(37, 99, 235, 0.35)' : 'none',
            }}
          >
            <span>💼</span>
            <span>OT &amp; Salary</span>
          </button>

          <button
            type="button"
            onClick={() => navigateTab('expenses')}
            style={{
              padding: '11px 12px',
              borderRadius: 12,
              border: mobileTab === 'expenses' ? '1px solid rgba(236, 72, 153, 0.6)' : '1px solid transparent',
              background: mobileTab === 'expenses'
                ? 'linear-gradient(135deg, #db2777 0%, #7c3aed 55%, #2563eb 100%)'
                : 'transparent',
              color: mobileTab === 'expenses' ? '#ffffff' : ui.textSecondary,
              fontWeight: 800,
              fontSize: 13.5,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              boxShadow: mobileTab === 'expenses' ? '0 6px 16px rgba(219, 39, 119, 0.35)' : 'none',
            }}
          >
            <span>{expensesBiometricUnlocked ? '💳' : '🔐'}</span>
            <span>Expense Memory</span>
            <span style={{ display: 'none' }}>EXPENSES</span>
          </button>
        </div>

        {/* ===================================================================
            SCREENS 7, 8, 9, 10, 11: EXPENSE MEMORY MODULE (BIOMETRIC GATED)
           =================================================================== */}
        {showExpensesSection && (
          <ExpensesSectionBoundary>
            {!expensesBiometricUnlocked ? (
              <div style={{
                padding: '28px 20px',
                borderRadius: 22,
                background: isLight
                  ? 'linear-gradient(145deg, #ffffff 0%, #fdf2f8 100%)'
                  : 'linear-gradient(145deg, #0f172a 0%, #1e1b4b 60%, #170d2b 100%)',
                border: '1px solid rgba(236, 72, 153, 0.45)',
                boxShadow: ui.shadow,
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 14,
              }}>
                <div style={{
                  width: 68,
                  height: 68,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #db2777 0%, #7c3aed 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 32,
                  boxShadow: '0 10px 25px rgba(219, 39, 119, 0.4)',
                }}>
                  🔐
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 950, color: ui.textPrimary }}>
                    Private Expense Vault Locked
                  </div>
                  <div style={{ fontSize: 12.5, color: ui.textSecondary, marginTop: 4, maxWidth: 340, lineHeight: 1.5 }}>
                    Biometric permission is required to view <strong>{normalizeEmployeeName(settings.employeeName)}&apos;s</strong> payments, notes, and permanent transaction ledger. No one can open this tab without your fingerprint or device unlock.
                  </div>
                </div>

                {expensesUnlockError && (
                  <div style={{
                    padding: '9px 14px',
                    borderRadius: 12,
                    background: 'rgba(239, 68, 68, 0.16)',
                    border: '1px solid rgba(248, 113, 113, 0.45)',
                    color: '#fca5a5',
                    fontSize: 12,
                    fontWeight: 800,
                  }}>
                    ⚠️ {expensesUnlockError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>
                  <button
                    type="button"
                    disabled={expensesUnlockBusy}
                    onClick={() => unlockExpensesWithBiometric()}
                    style={{
                      padding: '13px 20px',
                      borderRadius: 14,
                      border: '1px solid rgba(236, 72, 153, 0.65)',
                      background: 'linear-gradient(135deg, #db2777 0%, #7c3aed 55%, #2563eb 100%)',
                      color: '#ffffff',
                      fontWeight: 900,
                      fontSize: 13.5,
                      cursor: expensesUnlockBusy ? 'wait' : 'pointer',
                      boxShadow: '0 8px 22px rgba(219, 39, 119, 0.38)',
                    }}
                  >
                    {expensesUnlockBusy ? '🔄 Verifying Fingerprint...' : '🔓 Unlock Expenses with Biometric'}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigateTab('today')}
                    style={{
                      padding: '13px 16px',
                      borderRadius: 14,
                      border: `1px solid ${ui.border}`,
                      background: ui.cardSubBg,
                      color: ui.textPrimary,
                      fontWeight: 800,
                      fontSize: 12.5,
                      cursor: 'pointer',
                    }}
                  >
                    ← Back to OT &amp; Salary
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                }}>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: isLight ? '#065f46' : '#6ee7b7' }}>
                    🔓 Biometric Verified · Permanent Non-Deletable Ledger Active
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpensesBiometricUnlocked(false)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 8,
                      border: '1px solid rgba(239, 68, 68, 0.45)',
                      background: 'rgba(239, 68, 68, 0.15)',
                      color: isLight ? '#b91c1c' : '#fca5a5',
                      fontWeight: 800,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    🔒 Lock Now
                  </button>
                </div>
                <ExpensesModule
                  expensesMap={expensesMap}
                  onUpdateExpenses={handleUpdateExpenses}
                  selectedMonth={selectedMonth}
                  onChangeMonth={(m) => setSelectedMonth(m)}
                  netMonthlySalary={monthSummary.fullMonthNetPayable}
                  baseMonthlySalary={rates.salary}
                  salaryVisible={salaryBiometricVisible}
                  onToggleSalaryVisibility={toggleSalaryVisibilityWithBiometric}
                  mobileMode={mobileMode}
                  themeMode={themeMode}
                />
              </div>
            )}
          </ExpensesSectionBoundary>
        )}

        {/* ===================================================================
            SCREEN 2 & SCREEN 12: HOME DASHBOARD (TODAY TAB)
           =================================================================== */}
        {showTodaySection && (
          <>
            {/* HERO NET SALARY CARD WITH CIRCULAR PROGRESS RING (Executive Vault Card) */}
            <div
              className="ot-hero-vault-card"
              style={{
                padding: '19px 18px 16px',
                borderRadius: 24,
                background: isLight
                  ? 'linear-gradient(135deg, #ffffff 0%, #f0fdf4 65%, #e0f2fe 100%)'
                  : 'linear-gradient(140deg, #0b2e2d 0%, #0a192f 55%, #081121 100%)',
                border: isLight ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(52, 211, 153, 0.36)',
                boxShadow: ui.shadow,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginBottom: 5,
                  }}>
                    <span style={{
                      fontSize: 12.5,
                      fontWeight: 800,
                      letterSpacing: '0.01em',
                      color: isLight ? '#047857' : '#a7f3d0',
                    }}>
                      Net Salary (This Month)
                    </span>
                    {renderSalaryEyeButton(false)}
                  </div>
                  <div
                    className="ot-tabular-nums"
                    style={{
                      fontSize: 32,
                      fontWeight: 950,
                      color: isLight ? '#0f172a' : '#ffffff',
                      letterSpacing: '-0.02em',
                      lineHeight: 1.1,
                    }}
                  >
                    {formatSalaryMask(monthSummary.fullMonthNetPayable)}
                  </div>
                  <div
                    className="ot-tabular-nums"
                    style={{
                      marginTop: 7,
                      fontSize: 12,
                      fontWeight: 700,
                      color: isLight ? '#059669' : '#6ee7b7',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>
                      Base {formatSalaryMask(rates.salary)} + OT {formatSalaryMask(monthSummary.totalOtPay + monthSummary.totalExtraAllowance)}
                    </span>
                    {renderSalaryEyeButton(true)}
                  </div>
                </div>

                {/* Right Circular Progress Ring (e.g. 19/31 Days) */}
                <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
                  <svg width="80" height="80" viewBox="0 0 78 78">
                    <circle
                      cx="39"
                      cy="39"
                      r={ringRadius}
                      fill="none"
                      stroke={isLight ? 'rgba(16, 185, 129, 0.18)' : 'rgba(255, 255, 255, 0.1)'}
                      strokeWidth="6"
                    />
                    <circle
                      cx="39"
                      cy="39"
                      r={ringRadius}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringDashOffset}
                      transform="rotate(-90 39 39)"
                    />
                  </svg>
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                  }}>
                    <span className="ot-tabular-nums" style={{ fontSize: 13, fontWeight: 950, color: isLight ? '#0f172a' : '#ffffff', lineHeight: 1.1 }}>
                      {monthSummary.savedDaysCount}/{monthRows.length}
                    </span>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: ui.textSecondary }}>
                      Days
                    </span>
                  </div>
                </div>
              </div>

              {/* Bottom 3-Column Metrics Strip inside Hero Card */}
              <div style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: isLight ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(255, 255, 255, 0.09)',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
                position: 'relative',
                zIndex: 1,
              }}>
                <div>
                  <div style={{ fontSize: 11, color: ui.textSecondary, fontWeight: 600 }}>Worked:</div>
                  <div className="ot-tabular-nums" style={{ fontSize: 13.5, fontWeight: 900, color: isLight ? '#0f172a' : '#ffffff', marginTop: 1 }}>
                    {monthSummary.savedDaysCount} Days
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: ui.textSecondary, fontWeight: 600 }}>Total OT:</div>
                  <div className="ot-tabular-nums" style={{ fontSize: 13.5, fontWeight: 900, color: '#38bdf8', marginTop: 1 }}>
                    {formatMinutesCompact(monthSummary.totalOtMins)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: ui.textSecondary, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>OT Earned:</span>
                    {renderSalaryEyeButton(true)}
                  </div>
                  <div className="ot-tabular-nums" style={{ fontSize: 13.5, fontWeight: 900, color: '#10b981', marginTop: 1 }}>
                    {formatSalaryMask(monthSummary.totalOtPay)}
                  </div>
                </div>
              </div>
            </div>

            {/* TODAY LIVE CLOCK & DUAL BIOMETRIC CARDS (Screen 2 & Screen 12) */}
            <div style={{
              padding: '18px 16px',
              borderRadius: 24,
              background: ui.cardBg,
              border: `1px solid ${ui.border}`,
              boxShadow: ui.shadow,
            }}>
              {/* Today Card Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 14,
              }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: ui.textPrimary }}>
                    Today
                  </div>
                  <div style={{ fontSize: 12, color: ui.textSecondary, fontWeight: 600 }}>
                    {liveNow.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    padding: '5px 11px',
                    borderRadius: 999,
                    background: 'rgba(16, 185, 129, 0.16)',
                    border: '1px solid rgba(52, 211, 153, 0.45)',
                    color: '#10b981',
                    fontSize: 11.5,
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <span className="ot-live-dot" />
                    <span>⚡ Shift Active</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowManualEditor(true)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 10,
                      border: `1px solid ${ui.border}`,
                      background: ui.cardSubBg,
                      color: ui.textPrimary,
                      fontSize: 11.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    ✏️ Edit
                  </button>
                </div>
              </div>

              {/* Centered Circular Analog Clock + Digital Readout */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '6px 0 16px',
              }}>
                <div style={{
                  padding: 10,
                  borderRadius: '50%',
                  background: isLight
                    ? 'radial-gradient(circle, #f8fafc 0%, #e2e8f0 100%)'
                    : 'radial-gradient(circle, rgba(30, 41, 59, 0.65) 0%, rgba(9, 15, 29, 0.95) 100%)',
                  border: isLight ? '2px solid #cbd5e1' : '2px solid rgba(56, 189, 248, 0.25)',
                  boxShadow: isLight ? '0 8px 20px rgba(15,23,42,0.08)' : '0 0 32px rgba(14, 165, 233, 0.14)',
                }}>
                  <RealAnalogClock now={liveNow} size={136} />
                </div>

                <div
                  className="ot-tabular-nums"
                  style={{
                    marginTop: 10,
                    fontSize: 22,
                    fontWeight: 950,
                    color: ui.textPrimary,
                    letterSpacing: '0.03em',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {liveNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                </div>
                <div style={{ fontSize: 11.5, color: ui.textSecondary, fontWeight: 600, marginTop: 2 }}>
                  Shift: {formatTime12h(settings.officeStartTime)} – {formatTime12h(settings.officeEndTime)} · Biometric Touch Sensor (IN &amp; OUT)
                </div>
              </div>

              {/* DUAL SIDE-BY-SIDE BIOMETRIC CARDS: Touch ID IN (Emerald) & Touch ID OUT (Coral Red) */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
              }}>
                {/* Left Card: Touch ID IN · Office Enter */}
                <button
                  type="button"
                  className="ot-biometric-pad-in"
                  onClick={() => performBiometricPunch('in')}
                  title="Touch Sensor — IN (Enter)"
                  style={{
                    padding: '18px 12px',
                    borderRadius: 22,
                    border: '1.5px solid rgba(110, 231, 183, 0.58)',
                    background: 'linear-gradient(145deg, #10b981 0%, #059669 55%, #047857 100%)',
                    color: '#ffffff',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: '0 14px 28px -6px rgba(16, 185, 129, 0.38)',
                  }}
                >
                  <div style={{
                    width: 58,
                    height: 58,
                    borderRadius: '50%',
                    background: 'rgba(255, 255, 255, 0.16)',
                    border: '1.5px solid rgba(255, 255, 255, 0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <TouchIdSvg
                      variant="emerald"
                      size={38}
                      verified={Boolean(daysMap[getTodayIsoDate()]?.biometricIn)}
                      scanning={biometricScanState.active && biometricScanState.direction === 'in'}
                    />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 950, letterSpacing: '-0.01em' }}>
                    Touch ID · IN
                  </div>
                  <div className="ot-tabular-nums" style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255, 255, 255, 0.92)' }}>
                    {daysMap[getTodayIsoDate()]?.inTime
                      ? `✓ ${formatTime12h(daysMap[getTodayIsoDate()]?.inTime)}`
                      : 'Office Enter'}
                  </div>
                  <span style={{ display: 'none' }}>Touch Sensor — IN (Enter)</span>
                </button>

                {/* Right Card: Touch ID OUT · Office Exit */}
                <button
                  type="button"
                  className="ot-biometric-pad-out"
                  onClick={() => performBiometricPunch('out')}
                  title="Touch Sensor — OUT (Exit + OT)"
                  style={{
                    padding: '18px 12px',
                    borderRadius: 22,
                    border: '1.5px solid rgba(253, 164, 175, 0.58)',
                    background: 'linear-gradient(145deg, #f43f5e 0%, #e11d48 55%, #be123c 100%)',
                    color: '#ffffff',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    boxShadow: '0 14px 28px -6px rgba(225, 29, 72, 0.38)',
                  }}
                >
                  <div style={{
                    width: 58,
                    height: 58,
                    borderRadius: '50%',
                    background: 'rgba(255, 255, 255, 0.16)',
                    border: '1.5px solid rgba(255, 255, 255, 0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <TouchIdSvg
                      variant="gold"
                      size={38}
                      verified={Boolean(daysMap[getTodayIsoDate()]?.biometricOut)}
                      scanning={biometricScanState.active && biometricScanState.direction === 'out'}
                    />
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 950, letterSpacing: '-0.01em' }}>
                    Touch ID · OUT
                  </div>
                  <div className="ot-tabular-nums" style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255, 255, 255, 0.92)' }}>
                    {daysMap[getTodayIsoDate()]?.outTime
                      ? `✓ ${formatTime12h(daysMap[getTodayIsoDate()]?.outTime)}`
                      : 'Office Exit'}
                  </div>
                  <span style={{ display: 'none' }}>Touch Sensor — OUT (Exit + OT)</span>
                </button>
              </div>

              {/* 1-Tap Direct WhatsApp Send Bar (+91 7386726193) */}
              <div style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 14,
                background: isLight
                  ? 'linear-gradient(135deg, #ecfdf5 0%, #eff6ff 100%)'
                  : 'linear-gradient(135deg, rgba(16, 185, 129, 0.14) 0%, rgba(37, 99, 235, 0.14) 100%)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 11.5,
                  fontWeight: 800,
                  color: ui.textPrimary,
                }}>
                  <span>📲 Direct WhatsApp (+91 7386726193)</span>
                  <span style={{ fontSize: 10.5, color: '#10b981', fontWeight: 900 }}>● Auto-Send on IN &amp; OUT</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const todayIso = getTodayIsoDate();
                      const todayRec = daysMap[todayIso] || {};
                      const inT = todayRec.inTime || entryInTime || getNowTimeHHMM();
                      sendWhatsAppAttendanceAndPaymentAlert('in', {
                        date: todayIso,
                        inTime: inT,
                        outTime: todayRec.outTime || '',
                        status: todayRec.status || entryStatus || 'present',
                        isBiometric: Boolean(todayRec.biometricIn || entryBiometricIn),
                        note: todayRec.note || entryNote || '',
                      });
                      setSaveNotice(`📲 Opening WhatsApp (+91 7386726193) with IN Time (${formatTime12h(inT)})`);
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid rgba(16, 185, 129, 0.5)',
                      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                      color: '#ffffff',
                      fontWeight: 900,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    🟢 Send IN Time Now
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const todayIso = getTodayIsoDate();
                      const todayRec = daysMap[todayIso] || {};
                      const inT = todayRec.inTime || entryInTime || settings.officeStartTime || '10:00';
                      const outT = todayRec.outTime || entryOutTime || getNowTimeHHMM();
                      const st = todayRec.status || entryStatus || 'present';
                      const timing = calculateWorkTiming({
                        inTime: inT,
                        outTime: outT,
                        status: st,
                        officeStartTime: settings.officeStartTime,
                        officeEndTime: settings.officeEndTime,
                        otTimeCalcMode: settings.otTimeCalcMode,
                      });
                      const calc = computeDayEarnings({
                        status: st,
                        inTime: inT,
                        outTime: outT,
                        otHours: timing.otMins / 60,
                        extraAllowance: Number(todayRec.extraAllowance ?? entryBonus) || 0,
                      });
                      sendWhatsAppAttendanceAndPaymentAlert('out', {
                        date: todayIso,
                        inTime: inT,
                        outTime: outT,
                        workedMins: timing.workedMins,
                        otMins: timing.otMins,
                        status: st,
                        isBiometric: Boolean(todayRec.biometricOut || entryBiometricOut),
                        note: todayRec.note || entryNote || '',
                        calculation: calc,
                      });
                      setSaveNotice(`📲 Opening WhatsApp (+91 7386726193) with OUT (${formatTime12h(outT)}) + Payment Details`);
                    }}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid rgba(244, 63, 94, 0.5)',
                      background: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
                      color: '#ffffff',
                      fontWeight: 900,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    🔴 Send OUT + Payments
                  </button>
                </div>
              </div>

              {/* After-OUT WhatsApp Statement Status Strip */}
              {(waState.enabled || waState.lastStatus !== 'idle') && (
                <div style={{
                  marginTop: 12,
                  padding: '9px 12px',
                  borderRadius: 12,
                  background: waState.lastStatus === 'failed'
                    ? 'rgba(244, 63, 94, 0.12)'
                    : 'rgba(16, 185, 129, 0.12)',
                  border: waState.lastStatus === 'failed'
                    ? '1px solid rgba(244, 63, 94, 0.4)'
                    : '1px solid rgba(52, 211, 153, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: ui.textPrimary }}>
                    💬 WhatsApp Statement ({waState.recipientDisplay}):{' '}
                    <span style={{
                      color: waState.lastStatus === 'failed' ? '#f43f5e' : '#10b981',
                    }}>
                      {waState.lastStatusLabel || (waState.enabled ? 'Auto-Send Active' : 'OFF')}
                    </span>
                  </div>
                  {(waState.lastStatus === 'failed' || waState.pendingQueueCount > 0) && (
                    <button
                      type="button"
                      onClick={() => retryFailedDailyStatement()}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 8,
                        border: '1px solid rgba(244, 63, 94, 0.5)',
                        background: '#f43f5e',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Retry Send
                    </button>
                  )}
                </div>
              )}

              {/* Quick OT Presets + Open Manual Day Editor (Screen 3) */}
              <div style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: `1px solid ${ui.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
                flexWrap: 'wrap',
              }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {[
                    { hrs: 0, label: '6:30 PM (0h)' },
                    { hrs: 1, label: '7:30 PM (+1h)' },
                    { hrs: 2, label: '8:30 PM (+2h)' },
                  ].map((preset) => (
                    <button
                      key={preset.hrs}
                      type="button"
                      onClick={() => quickSetTodayOtAndSave(preset.hrs)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 9,
                        border: `1px solid ${ui.border}`,
                        background: ui.cardSubBg,
                        color: ui.textPrimary,
                        fontWeight: 800,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setShowManualEditor(true)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 9,
                    border: '1px solid rgba(37, 99, 235, 0.45)',
                    background: 'rgba(37, 99, 235, 0.14)',
                    color: isLight ? '#1d4ed8' : '#93c5fd',
                    fontWeight: 800,
                    fontSize: 11.5,
                    cursor: 'pointer',
                  }}
                >
                  ✏️ Manual Day Editor
                </button>
              </div>
            </div>

            {/* Restored: Today's Live Shift & Pay Breakdown Card */}
            <div style={{
              padding: '14px 16px',
              borderRadius: 20,
              background: ui.cardBg,
              border: `1px solid ${ui.border}`,
              boxShadow: ui.shadow,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13.5, fontWeight: 900, color: ui.textPrimary }}>
                  📊 Today&apos;s Shift &amp; Pay Breakdown ({selectedDate})
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {renderSalaryEyeButton(false)}
                  <span style={{
                    padding: '3px 9px',
                    borderRadius: 999,
                    background: activeDayPreview.otMins > 0 ? 'rgba(16, 185, 129, 0.16)' : ui.cardSubBg,
                    color: activeDayPreview.otMins > 0 ? '#10b981' : ui.textSecondary,
                    fontSize: 10.5,
                    fontWeight: 800,
                  }}>
                    {entryStatus === 'present' ? 'Present' : entryStatus === 'half' ? 'Half Day' : entryStatus === 'holiday_paid' ? 'Paid Off' : entryStatus === 'ot_only' ? 'OT Only' : 'Leave'}
                  </span>
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 6,
              }}>
                <div style={{ padding: '8px', borderRadius: 12, background: ui.cardSubBg, border: `1px solid ${ui.border}` }}>
                  <div style={{ fontSize: 10, color: ui.textSecondary, fontWeight: 700 }}>Worked</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: ui.textPrimary, marginTop: 2 }}>
                    {formatMinutesCompact(activeDayPreview.workedMins)}
                  </div>
                </div>
                <div style={{ padding: '8px', borderRadius: 12, background: ui.cardSubBg, border: `1px solid ${ui.border}` }}>
                  <div style={{ fontSize: 10, color: ui.textSecondary, fontWeight: 700 }}>Base Pay</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: ui.textPrimary, marginTop: 2 }}>
                    {formatSalaryMask(activeDayPreview.basePay)}
                  </div>
                </div>
                <div style={{ padding: '8px', borderRadius: 12, background: ui.cardSubBg, border: `1px solid ${ui.border}` }}>
                  <div style={{ fontSize: 10, color: ui.textSecondary, fontWeight: 700 }}>Extra OT</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: '#10b981', marginTop: 2 }}>
                    {formatSalaryMask(activeDayPreview.otPay, '+₹')}
                  </div>
                </div>
                <div style={{ padding: '8px', borderRadius: 12, background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(52, 211, 153, 0.35)' }}>
                  <div style={{ fontSize: 10, color: '#10b981', fontWeight: 800 }}>Day Total</div>
                  <div style={{ fontSize: 13, fontWeight: 950, color: '#10b981', marginTop: 2 }}>
                    {formatSalaryMask(activeDayPreview.totalPay)}
                  </div>
                </div>
              </div>
            </div>

            {/* Restored: Expense Memory Quick Home Summary Card */}
            <div style={{
              padding: '14px 16px',
              borderRadius: 20,
              background: isLight
                ? 'linear-gradient(135deg, #f5f3ff 0%, #eff6ff 100%)'
                : 'linear-gradient(135deg, rgba(124, 58, 237, 0.16) 0%, rgba(37, 99, 235, 0.14) 100%)',
              border: '1px solid rgba(139, 92, 246, 0.35)',
              boxShadow: ui.shadow,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 900, color: ui.textPrimary, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>💳 Expense Memory</span>
                  {expenseQuickStats.missingNotesCount > 0 && (
                    <span style={{
                      padding: '2px 7px',
                      borderRadius: 999,
                      background: 'rgba(245, 158, 11, 0.2)',
                      color: '#f59e0b',
                      fontSize: 10,
                      fontWeight: 900,
                    }}>
                      ⚠️ {expenseQuickStats.missingNotesCount} un-noted
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: ui.textSecondary, fontWeight: 700, marginTop: 3 }}>
                  Spent Today: <strong style={{ color: '#f43f5e' }}>₹{formatINR(expenseQuickStats.todaySpent)}</strong> · Month: <strong style={{ color: ui.textPrimary }}>₹{formatINR(expenseQuickStats.spent)}</strong> ({expenseQuickStats.count} txns)
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigateTab('expenses')}
                style={{
                  padding: '8px 13px',
                  borderRadius: 12,
                  border: '1px solid rgba(139, 92, 246, 0.5)',
                  background: 'linear-gradient(135deg, #7c3aed, #2563eb)',
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: 11.5,
                  cursor: 'pointer',
                }}
              >
                Open Expenses →
              </button>
            </div>
          </>
        )}

        {/* ===================================================================
            SCREEN 3: MANUAL DAY EDITOR MODAL / SHEET (Edit Today's Attendance)
           =================================================================== */}
        {showManualEditor && (
          <div
            onClick={() => setShowManualEditor(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1300,
              background: 'rgba(2, 6, 23, 0.78)',
              backdropFilter: 'blur(6px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 14,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                maxWidth: 440,
                maxHeight: '92vh',
                overflowY: 'auto',
                borderRadius: 24,
                background: ui.cardBg,
                border: `1px solid ${ui.border}`,
                boxShadow: '0 24px 60px rgba(0, 0, 0, 0.65)',
                padding: 20,
                color: ui.textPrimary,
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setShowManualEditor(false)}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 10,
                      border: `1px solid ${ui.border}`,
                      background: ui.cardSubBg,
                      color: ui.textPrimary,
                      fontWeight: 900,
                      cursor: 'pointer',
                    }}
                  >
                    ←
                  </button>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 900 }}>Edit Today&apos;s Attendance</div>
                    <div style={{ fontSize: 11.5, color: ui.textSecondary, fontWeight: 600 }}>
                      Date: {selectedDate}
                    </div>
                  </div>
                </div>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) setSelectedDate(e.target.value);
                  }}
                  style={{
                    padding: '5px 8px',
                    borderRadius: 8,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardSubBg,
                    color: ui.textPrimary,
                    fontSize: 11.5,
                    fontWeight: 700,
                  }}
                />
              </div>

              {/* 4 Status Cards: Present | Half Day | Off | OT Only */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 8,
                marginBottom: 14,
              }}>
                {[
                  { id: 'present', icon: '✓', label: 'Present', activeColor: '#10b981' },
                  { id: 'half', icon: '◐', label: 'Half Day', activeColor: '#f59e0b' },
                  { id: 'holiday_paid', icon: '🏠', label: 'Off', activeColor: '#38bdf8' },
                  { id: 'ot_only', icon: '⚡', label: 'OT Only', activeColor: '#8b5cf6' },
                ].map((st) => {
                  const active = entryStatus === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => handleStatusChange(st.id)}
                      style={{
                        padding: '10px 6px',
                        borderRadius: 12,
                        border: active ? `1.5px solid ${st.activeColor}` : `1px solid ${ui.border}`,
                        background: active ? `${st.activeColor}22` : ui.cardSubBg,
                        color: active ? st.activeColor : ui.textSecondary,
                        fontWeight: 800,
                        fontSize: 11.5,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 14 }}>{st.icon}</span>
                      <span>{st.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* 2-Column Enter Time & Exit Time */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 14,
                  background: ui.cardSubBg,
                  border: `1px solid ${ui.border}`,
                }}>
                  <div style={{ fontSize: 11, color: ui.textSecondary, fontWeight: 700, marginBottom: 4 }}>
                    Enter Time
                  </div>
                  <input
                    type="time"
                    value={entryInTime}
                    onChange={(e) => handleInTimeChange(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      color: ui.textPrimary,
                      fontWeight: 900,
                      fontSize: 15,
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{
                  padding: '10px 12px',
                  borderRadius: 14,
                  background: ui.cardSubBg,
                  border: `1px solid ${ui.border}`,
                }}>
                  <div style={{ fontSize: 11, color: ui.textSecondary, fontWeight: 700, marginBottom: 4 }}>
                    Exit Time
                  </div>
                  <input
                    type="time"
                    value={entryOutTime}
                    onChange={(e) => handleOutTimeChange(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      color: ui.textPrimary,
                      fontWeight: 900,
                      fontSize: 15,
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              {/* Green Worked Duration & Extra OT Summary Card */}
              <div style={{
                padding: '12px 14px',
                borderRadius: 14,
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(52, 211, 153, 0.4)',
                marginBottom: 14,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800 }}>
                  <span style={{ color: ui.textSecondary }}>Worked Duration</span>
                  <span style={{ color: ui.textPrimary }}>{formatMinutesCompact(activeDayPreview.workedMins)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 900 }}>
                  <span style={{ color: '#10b981' }}>Extra OT</span>
                  <span style={{ color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span>+{formatMinutesCompact(activeDayPreview.otMins)} ({formatSalaryMask(activeDayPreview.otPay)})</span>
                    {renderSalaryEyeButton(true)}
                  </span>
                </div>
              </div>

              {/* Extra Allowance (₹) */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: ui.textSecondary, fontWeight: 700, marginBottom: 5 }}>
                  Extra Allowance (₹)
                </div>
                <input
                  type="number"
                  min="0"
                  step="10"
                  value={entryBonus}
                  onChange={(e) => setEntryBonus(Math.max(0, Number(e.target.value) || 0))}
                  placeholder="₹ 0"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '11px 12px',
                    borderRadius: 12,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardSubBg,
                    color: ui.textPrimary,
                    fontWeight: 800,
                    fontSize: 14,
                  }}
                />
              </div>

              {/* Work Note (Optional) */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 12, color: ui.textSecondary, fontWeight: 700, marginBottom: 5 }}>
                  Work Note (Optional)
                </div>
                <input
                  type="text"
                  value={entryNote}
                  onChange={(e) => setEntryNote(e.target.value)}
                  placeholder="e.g. Late evening client deployment"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '11px 12px',
                    borderRadius: 12,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardSubBg,
                    color: ui.textPrimary,
                    fontWeight: 600,
                    fontSize: 13.5,
                  }}
                />
              </div>

              {/* Cancel + Save Day Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowManualEditor(false)}
                  style={{
                    padding: '12px',
                    borderRadius: 12,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardSubBg,
                    color: ui.textSecondary,
                    fontWeight: 800,
                    fontSize: 14,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    saveActiveDayRecord();
                    setShowManualEditor(false);
                  }}
                  style={{
                    padding: '12px',
                    borderRadius: 12,
                    border: '1px solid rgba(59, 130, 246, 0.6)',
                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: 14,
                    cursor: 'pointer',
                    boxShadow: '0 8px 20px rgba(37, 99, 235, 0.35)',
                  }}
                >
                  Save Day
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            SCREEN 4: MONTH SHEET (Calendar Grid + Filter Pills + Day Cards)
           =================================================================== */}
        {showMonthSection && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Month Navigation Header (< October 2026 >) */}
            <div style={{
              padding: '14px 16px',
              borderRadius: 20,
              background: ui.cardBg,
              border: `1px solid ${ui.border}`,
              boxShadow: ui.shadow,
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}>
                <button
                  type="button"
                  onClick={() => shiftSelectedMonth(-1)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardSubBg,
                    color: ui.textPrimary,
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  ‹
                </button>
                <div style={{ fontSize: 16, fontWeight: 950, color: ui.textPrimary }}>
                  {formattedMonthLabel}
                </div>
                <button
                  type="button"
                  onClick={() => shiftSelectedMonth(1)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardSubBg,
                    color: ui.textPrimary,
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  ›
                </button>
              </div>

              {/* 7-Column Mini Calendar Grid (S M T W T F S) */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                gap: 4,
                textAlign: 'center',
                marginBottom: 6,
              }}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, idx) => (
                  <div
                    key={idx}
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: idx === 0 ? '#f87171' : ui.textSecondary,
                      padding: '4px 0',
                    }}
                  >
                    {d}
                  </div>
                ))}
                {calendarGridCells.map((cell, idx) => {
                  if (!cell) {
                    return <div key={`empty_${idx}`} style={{ height: 32 }} />;
                  }
                  const isSel = cell.iso === selectedDate;
                  const hasOt = cell.earnings.otMins > 0;
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={() => {
                        setSelectedDate(cell.iso);
                        setShowManualEditor(true);
                      }}
                      style={{
                        height: 34,
                        borderRadius: 9,
                        border: isSel
                          ? '1.5px solid #60a5fa'
                          : hasOt
                            ? '1px solid rgba(52, 211, 153, 0.45)'
                            : '1px solid transparent',
                        background: isSel
                          ? '#2563eb'
                          : hasOt
                            ? 'rgba(16, 185, 129, 0.14)'
                            : cell.isSaved
                              ? isLight ? '#f1f5f9' : 'rgba(255,255,255,0.04)'
                              : 'transparent',
                        color: isSel
                          ? '#ffffff'
                          : cell.isSunday
                            ? '#f87171'
                            : ui.textPrimary,
                        fontWeight: isSel || hasOt ? 900 : 700,
                        fontSize: 12,
                        cursor: 'pointer',
                        position: 'relative',
                      }}
                    >
                      {cell.dayNum}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Filter Pills Row: All | Present | Half | Off | Leave | OT + Cards/Table View Toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                {[
                  { id: 'all', label: 'All' },
                  { id: 'present', label: 'Present' },
                  { id: 'half', label: 'Half' },
                  { id: 'off', label: 'Off' },
                  { id: 'leave', label: 'Leave' },
                  { id: 'ot_only', label: 'Extra OT' },
                ].map((pill) => {
                  const active = viewFilter === pill.id;
                  return (
                    <button
                      key={pill.id}
                      type="button"
                      onClick={() => setViewFilter(pill.id)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 999,
                        border: active ? '1px solid #3b82f6' : `1px solid ${ui.border}`,
                        background: active ? '#2563eb' : ui.cardBg,
                        color: active ? '#ffffff' : ui.textSecondary,
                        fontWeight: 800,
                        fontSize: 12,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {pill.label}
                    </button>
                  );
                })}
              </div>

              {/* Restored: Cards vs Full Table View Toggle */}
              <div style={{ display: 'flex', gap: 4 }}>
                {[
                  { id: 'cards', label: '📱 Cards' },
                  { id: 'table', label: '📋 Table' },
                ].map((mode) => {
                  const active = mobileDaysLayout === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setMobileDaysLayout(mode.id)}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 999,
                        border: active ? '1px solid #3b82f6' : `1px solid ${ui.border}`,
                        background: active ? 'rgba(37, 99, 235, 0.16)' : ui.cardBg,
                        color: active ? (isLight ? '#1d4ed8' : '#93c5fd') : ui.textSecondary,
                        fontWeight: 800,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ☑️ MULTI-DAY SELECT & SELECT ALL DAYS (Bulk Set IN / OUT Time) */}
            <div style={{
              padding: '12px 14px',
              borderRadius: 18,
              background: isLight
                ? 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)'
                : 'linear-gradient(135deg, rgba(37, 99, 235, 0.14) 0%, rgba(16, 185, 129, 0.12) 100%)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              boxShadow: ui.shadow,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 950, color: ui.textPrimary }}>
                    ☑️ Select &amp; Select All Days — Set IN / OUT Time
                  </div>
                  <div style={{ fontSize: 11, color: ui.textSecondary, fontWeight: 600 }}>
                    {selectedBulkDates.length > 0
                      ? `${selectedBulkDates.length} day(s) selected`
                      : `Tap checkboxes below or "Select All Days" (${filteredMonthRows.length} days)`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={selectAllBulkDates}
                    style={{
                      padding: '6px 11px',
                      borderRadius: 9,
                      border: '1px solid rgba(37, 99, 235, 0.5)',
                      background: '#2563eb',
                      color: '#ffffff',
                      fontWeight: 900,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {filteredMonthRows.length > 0 && filteredMonthRows.every((r) => selectedBulkDates.includes(r.iso))
                      ? '✕ Deselect All'
                      : `☑️ Select All Days (${filteredMonthRows.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={selectWorkingBulkDates}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 9,
                      border: `1px solid ${ui.border}`,
                      background: ui.cardBg,
                      color: ui.textPrimary,
                      fontWeight: 800,
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    🗓️ Mon–Sat
                  </button>
                  {selectedBulkDates.length > 0 && (
                    <button
                      type="button"
                      onClick={clearBulkDates}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 9,
                        border: '1px solid rgba(239, 68, 68, 0.45)',
                        background: 'rgba(239, 68, 68, 0.14)',
                        color: '#f87171',
                        fontWeight: 800,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Clear ({selectedBulkDates.length})
                    </button>
                  )}
                </div>
              </div>

              {/* Bulk IN Time, OUT Time, Status Inputs */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 8,
              }}>
                <div style={{
                  padding: '7px 9px',
                  borderRadius: 11,
                  background: ui.cardBg,
                  border: `1px solid ${ui.border}`,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#10b981', marginBottom: 3 }}>
                    🟢 Bulk IN Time
                  </div>
                  <input
                    type="time"
                    value={bulkInTime}
                    onChange={(e) => setBulkInTime(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      color: ui.textPrimary,
                      fontWeight: 900,
                      fontSize: 12.5,
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{
                  padding: '7px 9px',
                  borderRadius: 11,
                  background: ui.cardBg,
                  border: `1px solid ${ui.border}`,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#f43f5e', marginBottom: 3 }}>
                    🔴 Bulk OUT Time
                  </div>
                  <input
                    type="time"
                    value={bulkOutTime}
                    onChange={(e) => setBulkOutTime(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      color: ui.textPrimary,
                      fontWeight: 900,
                      fontSize: 12.5,
                      outline: 'none',
                    }}
                  />
                </div>

                <div style={{
                  padding: '7px 9px',
                  borderRadius: 11,
                  background: ui.cardBg,
                  border: `1px solid ${ui.border}`,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: ui.textSecondary, marginBottom: 3 }}>
                    📋 Day Status
                  </div>
                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      color: ui.textPrimary,
                      fontWeight: 800,
                      fontSize: 11.5,
                      outline: 'none',
                    }}
                  >
                    <option value="keep" style={{ color: '#0f172a' }}>Keep Status</option>
                    <option value="present" style={{ color: '#0f172a' }}>Present</option>
                    <option value="half" style={{ color: '#0f172a' }}>Half Day</option>
                    <option value="holiday_paid" style={{ color: '#0f172a' }}>Paid Off</option>
                    <option value="leave" style={{ color: '#0f172a' }}>Leave</option>
                    <option value="ot_only" style={{ color: '#0f172a' }}>OT Only</option>
                  </select>
                </div>
              </div>

              {/* Bulk Apply Action Buttons */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 7,
              }}>
                <button
                  type="button"
                  onClick={() => applyBulkTimeToSelectedDays('in')}
                  style={{
                    padding: '9px 10px',
                    borderRadius: 10,
                    border: '1px solid rgba(16, 185, 129, 0.5)',
                    background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: 11.5,
                    cursor: 'pointer',
                  }}
                >
                  🟢 Set IN Time ({selectedBulkDates.length || filteredMonthRows.length} Days)
                </button>
                <button
                  type="button"
                  onClick={() => applyBulkTimeToSelectedDays('out')}
                  style={{
                    padding: '9px 10px',
                    borderRadius: 10,
                    border: '1px solid rgba(244, 63, 94, 0.5)',
                    background: 'linear-gradient(135deg, #e11d48 0%, #f43f5e 100%)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: 11.5,
                    cursor: 'pointer',
                  }}
                >
                  🔴 Set OUT Time ({selectedBulkDates.length || filteredMonthRows.length} Days)
                </button>
                <button
                  type="button"
                  onClick={() => applyBulkTimeToSelectedDays('both')}
                  style={{
                    padding: '9px 10px',
                    borderRadius: 10,
                    border: '1px solid rgba(37, 99, 235, 0.5)',
                    background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: 11.5,
                    cursor: 'pointer',
                  }}
                >
                  ⚡ Set Both IN &amp; OUT ({selectedBulkDates.length || filteredMonthRows.length} Days)
                </button>
                <button
                  type="button"
                  onClick={() => applyBulkTimeToSelectedDays('clear_out')}
                  style={{
                    padding: '9px 10px',
                    borderRadius: 10,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardBg,
                    color: ui.textSecondary,
                    fontWeight: 800,
                    fontSize: 11.5,
                    cursor: 'pointer',
                  }}
                >
                  🚫 Clear OUT Time ({selectedBulkDates.length || filteredMonthRows.length} Days)
                </button>
              </div>
            </div>

            {/* Day Cards List OR Full Table View */}
            {mobileDaysLayout === 'table' ? (
              <div style={{
                borderRadius: 18,
                background: ui.cardBg,
                border: `1px solid ${ui.border}`,
                boxShadow: ui.shadow,
                overflowX: 'auto',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead>
                    <tr style={{ background: ui.cardSubBg, color: ui.textSecondary, textAlign: 'left' }}>
                      <th style={{ padding: '10px 6px', fontWeight: 900, width: 28 }}>
                        <input
                          type="checkbox"
                          checked={filteredMonthRows.length > 0 && filteredMonthRows.every((r) => selectedBulkDates.includes(r.iso))}
                          onChange={selectAllBulkDates}
                        />
                      </th>
                      <th style={{ padding: '10px 8px', fontWeight: 900 }}>Date</th>
                      <th style={{ padding: '10px 8px', fontWeight: 900 }}>IN → OUT</th>
                      <th style={{ padding: '10px 8px', fontWeight: 900 }}>Worked</th>
                      <th style={{ padding: '10px 8px', fontWeight: 900 }}>OT</th>
                      <th style={{ padding: '10px 8px', fontWeight: 900, textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span>Total</span>
                          {renderSalaryEyeButton(true)}
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMonthRows.map((row) => {
                      const r = row.record;
                      const e = row.earnings;
                      const isBulkChecked = selectedBulkDates.includes(row.iso);
                      return (
                        <tr
                          key={row.iso}
                          onClick={() => {
                            setSelectedDate(row.iso);
                            setShowManualEditor(true);
                          }}
                          style={{
                            borderTop: `1px solid ${ui.border}`,
                            cursor: 'pointer',
                            background: isBulkChecked
                              ? 'rgba(16, 185, 129, 0.12)'
                              : row.iso === selectedDate
                                ? 'rgba(37, 99, 235, 0.1)'
                                : 'transparent',
                          }}
                        >
                          <td
                            onClick={(ev) => {
                              ev.stopPropagation();
                              toggleBulkSelectDate(row.iso);
                            }}
                            style={{ padding: '9px 6px' }}
                          >
                            <input
                              type="checkbox"
                              checked={isBulkChecked}
                              onChange={() => {}}
                            />
                          </td>
                          <td style={{ padding: '9px 8px', fontWeight: 900, color: row.isSunday ? '#f87171' : ui.textPrimary }}>
                            {String(row.dayNum).padStart(2, '0')} {row.dayName}
                          </td>
                          <td style={{ padding: '9px 8px', fontWeight: 700, color: ui.textPrimary }}>
                            {formatTime12h(r.inTime || '10:00')} → {r.outTime ? formatTime12h(r.outTime) : '--:-- (Pending)'}
                          </td>
                          <td style={{ padding: '9px 8px', fontWeight: 700, color: ui.textSecondary }}>
                            {formatMinutesCompact(e.workedMins)}
                          </td>
                          <td style={{ padding: '9px 8px', fontWeight: 800, color: e.otMins > 0 ? '#10b981' : ui.textSecondary }}>
                            {e.otMins > 0 ? `+${formatMinutesCompact(e.otMins)}` : '-'}
                          </td>
                          <td style={{ padding: '9px 8px', fontWeight: 900, color: ui.textPrimary, textAlign: 'right' }}>
                            {formatSalaryMask(e.totalPay)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredMonthRows.map((row) => {
                  const r = row.record;
                  const e = row.earnings;
                  const isSelected = row.iso === selectedDate;
                  const isBulkChecked = selectedBulkDates.includes(row.iso);
                  return (
                    <div
                      key={row.iso}
                      onClick={() => {
                        setSelectedDate(row.iso);
                        setShowManualEditor(true);
                      }}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 16,
                        background: isBulkChecked
                          ? (isLight ? '#ecfdf5' : 'rgba(16, 185, 129, 0.1)')
                          : ui.cardBg,
                        border: isBulkChecked
                          ? '1.5px solid #10b981'
                          : isSelected
                            ? '1.5px solid #3b82f6'
                            : `1px solid ${ui.border}`,
                        boxShadow: ui.shadow,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        cursor: 'pointer',
                      }}
                    >
                      {/* Multi-Day Select Checkbox */}
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          toggleBulkSelectDate(row.iso);
                        }}
                        title="Select day for bulk IN/OUT time update"
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 8,
                          border: isBulkChecked ? '1.5px solid #10b981' : `1.5px solid ${ui.border}`,
                          background: isBulkChecked ? '#10b981' : ui.cardSubBg,
                          color: isBulkChecked ? '#ffffff' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 900,
                          fontSize: 13,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        ✓
                      </button>

                      {/* Left Date Badge (19 Mon) */}
                      <div style={{
                        width: 48,
                        height: 48,
                        borderRadius: 13,
                        background: isSelected
                          ? 'rgba(37, 99, 235, 0.2)'
                          : ui.cardSubBg,
                        border: `1px solid ${ui.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        <span style={{
                          fontSize: 15,
                          fontWeight: 950,
                          color: row.isSunday ? '#f87171' : ui.textPrimary,
                          lineHeight: 1.1,
                        }}>
                          {String(row.dayNum).padStart(2, '0')}
                        </span>
                        <span style={{
                          fontSize: 10,
                          fontWeight: 800,
                          color: row.isSunday ? '#f87171' : ui.textSecondary,
                        }}>
                          {row.dayName}
                        </span>
                      </div>

                      {/* Center Timing & Earnings */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13.5,
                          fontWeight: 900,
                          color: ui.textPrimary,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          flexWrap: 'wrap',
                        }}>
                          <span>
                            {formatTime12h(r.inTime || '10:00')} →{' '}
                            <span style={{ color: r.outTime ? ui.textPrimary : '#f59e0b' }}>
                              {r.outTime ? formatTime12h(r.outTime) : '--:-- (Pending OUT)'}
                            </span>
                          </span>
                          {r.biometricIn && <span style={{ fontSize: 10, color: '#38bdf8' }}>🫆IN</span>}
                          {r.biometricOut && <span style={{ fontSize: 10, color: '#10b981' }}>🫆OUT</span>}
                        </div>
                        <div style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: e.otMins > 0 ? '#10b981' : ui.textSecondary,
                          marginTop: 3,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          flexWrap: 'wrap',
                        }}>
                          <span>
                            {formatMinutesCompact(e.workedMins)}
                            {e.otMins > 0 ? ` · +${formatMinutesCompact(e.otMins)} · ${formatSalaryMask(e.otPay, '+₹')}` : ''}
                            {` · ${formatSalaryMask(e.totalPay)}`}
                          </span>
                          {renderSalaryEyeButton(true)}
                        </div>
                      </div>

                      {/* Right Saved Badge */}
                      <div style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: row.isSaved ? 'rgba(16, 185, 129, 0.2)' : ui.cardSubBg,
                        border: row.isSaved ? '1px solid #10b981' : `1px solid ${ui.border}`,
                        color: row.isSaved ? '#10b981' : ui.textSecondary,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 900,
                        fontSize: 13,
                        flexShrink: 0,
                      }}>
                        ✓
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bottom Full-Width Royal Blue Save All Month Days Button */}
            <button
              type="button"
              onClick={saveAllMonthDays}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: 16,
                border: '1px solid rgba(59, 130, 246, 0.6)',
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                fontWeight: 900,
                fontSize: 14.5,
                cursor: 'pointer',
                boxShadow: '0 10px 24px rgba(37, 99, 235, 0.35)',
              }}
            >
              Save All Month Days
            </button>
          </div>
        )}

        {/* ===================================================================
            SCREEN 5: MONTHLY SALARY SLIP (Slip Tab)
           =================================================================== */}
        {showSummarySection && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              padding: '18px',
              borderRadius: 22,
              background: ui.cardBg,
              border: `1px solid ${ui.border}`,
              boxShadow: ui.shadow,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 950, color: ui.textPrimary }}>
                    Monthly Salary Slip
                  </div>
                  <div style={{ fontSize: 12, color: ui.textSecondary, fontWeight: 600 }}>
                    {formattedMonthLabel} · {normalizeEmployeeName(settings.employeeName)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {renderSalaryEyeButton(false)}
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: 'rgba(16, 185, 129, 0.16)',
                    color: '#10b981',
                    fontSize: 11,
                    fontWeight: 800,
                  }}>
                    Verified
                  </span>
                </div>
              </div>

              {/* Structured Key-Value Rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'Employee Name', value: normalizeEmployeeName(settings.employeeName), color: ui.textPrimary, isSalary: false },
                  { label: 'Base Monthly Salary', value: formatSalaryMask(rates.salary), color: ui.textPrimary, isSalary: true },
                  { label: 'Per Day Salary', value: formatSalaryMask(rates.perDaySalary), color: ui.textPrimary, isSalary: true },
                  {
                    label: 'Per Hour / Per Min Rate',
                    value: salaryBiometricVisible
                      ? `₹${formatINR(rates.baseHourlyRate)}/hr · ₹${(Number(rates.baseMinuteRate ?? rates.otPerMinuteRate) || 0).toFixed(2)}/m`
                      : '₹••••/hr · ₹••/m',
                    color: ui.textSecondary,
                    isSalary: true,
                  },
                  { label: 'Standard Shift Hours', value: formatMinutesCompact(rates.shiftMins), color: ui.textPrimary, isSalary: false },
                  { label: 'Total Working Days', value: `${monthSummary.savedDaysCount || 0} / ${monthRows.length} Days`, color: ui.textPrimary, isSalary: false },
                  { label: 'Attendance Breakdown', value: `${monthSummary.presentDays || 0}P · ${monthSummary.halfDays || 0}H · ${monthSummary.paidHolidays || 0} Off · ${monthSummary.unpaidLeaves ?? monthSummary.leaveDays ?? 0} Leave`, color: ui.textPrimary, isSalary: false },
                  { label: 'Total Worked Hours', value: formatMinutesCompact(monthSummary.totalWorkedMins), color: ui.textPrimary, isSalary: false },
                  { label: 'Total Extra OT', value: formatMinutesCompact(monthSummary.totalOtMins), color: '#38bdf8', isSalary: false },
                  { label: 'OT Rate (per hour)', value: formatSalaryMask(rates.otHourlyRate, '₹', '/hr'), color: ui.textSecondary, isSalary: true },
                  { label: 'Total OT Pay', value: formatSalaryMask(monthSummary.totalOtPay, '+ ₹'), color: '#10b981', isSalary: true },
                  { label: 'Extra Allowances', value: formatSalaryMask(monthSummary.totalExtraAllowance, '+ ₹'), color: '#10b981', isSalary: true },
                  { label: 'Leave Deductions', value: formatSalaryMask(monthSummary.leaveDeduction, '- ₹'), color: '#f43f5e', isSalary: true },
                ].map((item) => (
                  <div
                    key={item.label}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingBottom: 8,
                      borderBottom: `1px solid ${ui.border}`,
                      fontSize: 13,
                      gap: 8,
                    }}
                  >
                    <span style={{ color: ui.textSecondary, fontWeight: 600 }}>{item.label}</span>
                    <span style={{ color: item.color, fontWeight: 900, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>{item.value}</span>
                      {item.isSalary && renderSalaryEyeButton(true)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Green Highlight Card: Net Salary Receivable */}
              <div style={{
                marginTop: 14,
                padding: '14px 16px',
                borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.12))',
                border: '1px solid rgba(52, 211, 153, 0.5)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
              }}>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: '#10b981', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>Net Salary Receivable</span>
                    {renderSalaryEyeButton(true)}
                  </div>
                  <div style={{ fontSize: 10.5, color: ui.textSecondary }}>Base + Extra OT - Leaves</div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 950, color: '#10b981' }}>
                  {formatSalaryMask(monthSummary.fullMonthNetPayable)}
                </div>
              </div>

              {/* Blue Highlight Card: After Expenses (This Month) */}
              <div style={{
                marginTop: 10,
                padding: '14px 16px',
                borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.2), rgba(124, 58, 237, 0.14))',
                border: '1px solid rgba(96, 165, 250, 0.45)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
              }}>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>After Expenses (This Month)</span>
                    {renderSalaryEyeButton(true)}
                  </div>
                  <div style={{ fontSize: 10.5, color: ui.textSecondary }}>
                    Spent: ₹{formatINR(expenseQuickStats.spent)} ({expenseQuickStats.count} txns)
                  </div>
                </div>
                <div style={{ fontSize: 20, fontWeight: 950, color: isLight ? '#1d4ed8' : '#93c5fd' }}>
                  {formatSalaryMask(Math.max(0, monthSummary.fullMonthNetPayable - expenseQuickStats.spent))}
                </div>
              </div>

              {/* Bottom Action Buttons: Download CSV, Print PDF Slip & Share Slip */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 16 }}>
                <button
                  type="button"
                  onClick={exportMonthCsv}
                  style={{
                    padding: '12px 8px',
                    borderRadius: 14,
                    border: '1px solid rgba(59, 130, 246, 0.55)',
                    background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  📥 CSV
                </button>
                <button
                  type="button"
                  onClick={printMonthSalarySlip}
                  style={{
                    padding: '12px 8px',
                    borderRadius: 14,
                    border: '1px solid rgba(139, 92, 246, 0.55)',
                    background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  🖨️ Print / PDF
                </button>
                <button
                  type="button"
                  onClick={shareSalarySummaryOnWhatsApp}
                  style={{
                    padding: '12px 8px',
                    borderRadius: 14,
                    border: '1px solid rgba(52, 211, 153, 0.55)',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  💬 Share
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            SCREEN 6: SHIFT & SALARY RULES + APP & DATA (Rules Tab)
           =================================================================== */}
        {showRulesSection && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              padding: '18px',
              borderRadius: 22,
              background: ui.cardBg,
              border: `1px solid ${ui.border}`,
              boxShadow: ui.shadow,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 17, fontWeight: 950, color: ui.textPrimary }}>
                  Shift &amp; Salary Rules
                </div>
                <button
                  type="button"
                  onClick={() => persistStore(settings, daysMap, 'Saved Shift & Salary Rules')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(59, 130, 246, 0.6)',
                    background: '#2563eb',
                    color: '#ffffff',
                    fontWeight: 800,
                    fontSize: 12.5,
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Employee Name */}
                <div>
                  <div style={{ fontSize: 12, color: ui.textSecondary, fontWeight: 700, marginBottom: 5 }}>
                    Employee Name
                  </div>
                  <input
                    type="text"
                    value={settings.employeeName ?? 'Yasin Pattan'}
                    placeholder="Yasin Pattan"
                    onChange={(e) => updateSetting('employeeName', e.target.value)}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '11px 12px',
                      borderRadius: 12,
                      border: `1px solid ${ui.border}`,
                      background: ui.cardSubBg,
                      color: ui.textPrimary,
                      fontWeight: 900,
                      fontSize: 15,
                    }}
                  />
                </div>

                {/* Base Monthly Salary (Protected by Eye + Biometric) */}
                <div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 12,
                    color: ui.textSecondary,
                    fontWeight: 700,
                    marginBottom: 5,
                  }}>
                    <span>Base Monthly Salary (₹)</span>
                    {renderSalaryEyeButton(false)}
                  </div>
                  {salaryBiometricVisible ? (
                    <input
                      type="number"
                      min="1000"
                      step="500"
                      value={settings.monthlySalary}
                      onChange={(e) => updateSetting('monthlySalary', Math.max(0, Number(e.target.value) || 0))}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '11px 12px',
                        borderRadius: 12,
                        border: `1px solid ${ui.border}`,
                        background: ui.cardSubBg,
                        color: ui.textPrimary,
                        fontWeight: 900,
                        fontSize: 15,
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleSalaryVisibilityWithBiometric()}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '11px 12px',
                        borderRadius: 12,
                        border: `1px solid ${ui.border}`,
                        background: ui.cardSubBg,
                        color: ui.textPrimary,
                        fontWeight: 900,
                        fontSize: 15,
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>₹••••••</span>
                      <span style={{ fontSize: 11.5, color: '#10b981', fontWeight: 800 }}>
                        👁️ Tap to Unlock Salary with Biometric
                      </span>
                    </button>
                  )}
                </div>

                {/* Standard Shift Hours (Start & End) */}
                <div>
                  <div style={{ fontSize: 12, color: ui.textSecondary, fontWeight: 700, marginBottom: 5 }}>
                    Standard Shift Hours ({formatMinutesCompact(rates.shiftMins)})
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <input
                      type="time"
                      value={settings.officeStartTime}
                      onChange={(e) => updateSetting('officeStartTime', e.target.value)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: `1px solid ${ui.border}`,
                        background: ui.cardSubBg,
                        color: ui.textPrimary,
                        fontWeight: 800,
                        fontSize: 14,
                      }}
                    />
                    <input
                      type="time"
                      value={settings.officeEndTime}
                      onChange={(e) => updateSetting('officeEndTime', e.target.value)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: `1px solid ${ui.border}`,
                        background: ui.cardSubBg,
                        color: ui.textPrimary,
                        fontWeight: 800,
                        fontSize: 14,
                      }}
                    />
                  </div>
                </div>

                {/* OT Calculation */}
                <div>
                  <div style={{ fontSize: 12, color: ui.textSecondary, fontWeight: 700, marginBottom: 5 }}>
                    OT Calculation
                  </div>
                  <select
                    value={settings.otTimeCalcMode === 'after_end_time' ? 'after_office_end' : (settings.otTimeCalcMode === 'after_duration' ? 'in_out_duration' : settings.otTimeCalcMode)}
                    onChange={(e) => updateSetting('otTimeCalcMode', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '11px 12px',
                      borderRadius: 12,
                      border: `1px solid ${ui.border}`,
                      background: ui.cardSubBg,
                      color: ui.textPrimary,
                      fontWeight: 800,
                      fontSize: 13.5,
                    }}
                  >
                    <option value="in_out_duration">After Shift Hours ({formatMinutesCompact(rates.shiftMins)})</option>
                    <option value="after_office_end">After Office End Time ({formatTime12h(settings.officeEndTime)})</option>
                  </select>
                </div>

                {/* OT Rate Type */}
                <div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 12,
                    color: ui.textSecondary,
                    fontWeight: 700,
                    marginBottom: 5,
                  }}>
                    <span>OT Rate Type ({formatSalaryMask(rates.otHourlyRate, '₹', '/hr')})</span>
                    {renderSalaryEyeButton(true)}
                  </div>
                  <select
                    value={settings.otRateMode === '1.0x' ? 'auto' : settings.otRateMode}
                    onChange={(e) => updateSetting('otRateMode', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '11px 12px',
                      borderRadius: 12,
                      border: `1px solid ${ui.border}`,
                      background: ui.cardSubBg,
                      color: ui.textPrimary,
                      fontWeight: 800,
                      fontSize: 13.5,
                    }}
                  >
                    <option value="auto">1.0x Normal ({formatSalaryMask(rates.baseHourlyRate, '₹', '/hr')})</option>
                    <option value="1.5x">1.5x Overtime ({formatSalaryMask(rates.baseHourlyRate * 1.5, '₹', '/hr')})</option>
                    <option value="2.0x">2.0x Double OT ({formatSalaryMask(rates.baseHourlyRate * 2, '₹', '/hr')})</option>
                    <option value="custom">Custom Hourly Rate</option>
                  </select>
                  {settings.otRateMode === 'custom' && (
                    <input
                      type="number"
                      min="1"
                      step="5"
                      value={settings.customOtHourlyRate}
                      onChange={(e) => updateSetting('customOtHourlyRate', Math.max(0, Number(e.target.value) || 0))}
                      placeholder="Custom OT Hourly Rate (₹)"
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        marginTop: 8,
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: `1px solid ${ui.border}`,
                        background: ui.cardSubBg,
                        color: ui.textPrimary,
                        fontWeight: 800,
                        fontSize: 14,
                      }}
                    />
                  )}
                </div>

                {/* Working Days in Month */}
                <div>
                  <div style={{ fontSize: 12, color: ui.textSecondary, fontWeight: 700, marginBottom: 5 }}>
                    Working Days in Month
                  </div>
                  <select
                    value={settings.monthDaysMode}
                    onChange={(e) => updateSetting('monthDaysMode', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '11px 12px',
                      borderRadius: 12,
                      border: `1px solid ${ui.border}`,
                      background: ui.cardSubBg,
                      color: ui.textPrimary,
                      fontWeight: 800,
                      fontSize: 13.5,
                    }}
                  >
                    <option value="30">30 Days (Standard)</option>
                    <option value="actual">Actual Calendar Days ({rates.actualMonthDays} Days)</option>
                    <option value="26">26 Working Days</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Feature B: After-OUT Automatic WhatsApp Statement Card */}
            <div style={{
              padding: '16px 18px',
              borderRadius: 22,
              background: ui.cardBg,
              border: `1px solid ${ui.border}`,
              boxShadow: ui.shadow,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 14.5, fontWeight: 900, color: ui.textPrimary }}>
                    Automatically send WhatsApp statement after OUT
                  </div>
                  <div style={{ fontSize: 11.5, color: ui.textSecondary, fontWeight: 600, marginTop: 2 }}>
                    Official WhatsApp Cloud API · Fixed Recipient: <strong>{waState.recipientDisplay || '+91 7386726193'}</strong>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(waState.enabled)}
                  onClick={() => {
                    if (waState.enabled) {
                      const next = setWhatsAppAutoSendEnabled(false, false);
                      setWaState(next);
                      setSaveNotice('WhatsApp auto-send after OUT turned OFF');
                    } else {
                      setShowWaConsentModal(true);
                    }
                  }}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 999,
                    border: waState.enabled ? '1px solid #10b981' : `1px solid ${ui.border}`,
                    background: waState.enabled ? '#10b981' : ui.cardSubBg,
                    color: waState.enabled ? '#ffffff' : ui.textSecondary,
                    fontWeight: 900,
                    fontSize: 12,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {waState.enabled ? 'ON ✓' : 'OFF'}
                </button>
              </div>

              <div style={{
                padding: '10px 12px',
                borderRadius: 12,
                background: ui.cardSubBg,
                border: `1px solid ${ui.border}`,
                fontSize: 11.5,
                color: ui.textSecondary,
                lineHeight: 1.45,
              }}>
                <div>
                  <strong>Last Send Status:</strong>{' '}
                  <span style={{
                    fontWeight: 800,
                    color: waState.lastStatus === 'failed'
                      ? '#f43f5e'
                      : waState.lastStatus === 'idle'
                        ? ui.textSecondary
                        : '#10b981',
                  }}>
                    {waState.lastStatusLabel || 'Not sent yet'}
                  </span>
                </div>
                {waState.lastDateSent && (
                  <div style={{ marginTop: 3 }}>
                    <strong>Last Sent Date:</strong> {waState.lastDateSent}{' '}
                    {waState.lastMessageId ? `(ID: ${waState.lastMessageId})` : ''}
                  </div>
                )}
                {waState.lastError && (
                  <div style={{ marginTop: 3, color: '#f43f5e', fontWeight: 700 }}>
                    ⚠️ {waState.lastError}
                  </div>
                )}
              </div>

              {/* Retry & Guarded Resend Actions */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await retryFailedDailyStatement();
                    if (res.ok) {
                      setSaveNotice(`✓ WhatsApp statement ${res.status}`);
                    } else {
                      setSaveNotice(`⚠️ Retry: ${res.error || res.reason || 'Failed'}`);
                    }
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardSubBg,
                    color: ui.textPrimary,
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  🔄 Retry Failed / Queued ({waState.pendingQueueCount || 0})
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    const todayIso = getTodayIsoDate();
                    const rec = daysMap[todayIso] || {
                      date: todayIso,
                      status: entryStatus,
                      inTime: entryInTime,
                      outTime: entryOutTime,
                      extraAllowance: entryBonus,
                    };
                    const calc = computeDayEarnings(rec);
                    const confirmed = window.confirm(
                      `Resend daily attendance & pay statement for ${todayIso} to +91 7386726193?`
                    );
                    if (!confirmed) return;
                    const res = await resendDailyStatementWithConfirmation({
                      date: todayIso,
                      record: rec,
                      settings,
                      rates,
                      calculation: calc,
                      userConfirmed: true,
                    });
                    if (res.ok) {
                      setSaveNotice(`✓ Resent daily statement (${res.status})`);
                    } else {
                      setSaveNotice(`⚠️ ${res.error || 'Could not resend statement'}`);
                    }
                  }}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(59, 130, 246, 0.45)',
                    background: 'rgba(37, 99, 235, 0.12)',
                    color: isLight ? '#1d4ed8' : '#93c5fd',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  📤 Resend Today&apos;s Statement
                </button>
              </div>

              {/* Server Relay Endpoint Configuration (No embedded Meta tokens in APK) */}
              <div style={{
                marginTop: 4,
                paddingTop: 10,
                borderTop: `1px solid ${ui.border}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: ui.textSecondary }}>
                  🔐 Cloud API Relay Server (Holds WABA token server-side; never embedded in APK)
                </div>
                <input
                  type="url"
                  value={waRelayUrlInput}
                  onChange={(e) => setWaRelayUrlInput(e.target.value)}
                  placeholder="https://your-relay.example.com/api/whatsapp/daily-ot-statement"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 11px',
                    borderRadius: 10,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardSubBg,
                    color: ui.textPrimary,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    value={waRelayTokenInput}
                    onChange={(e) => setWaRelayTokenInput(e.target.value)}
                    placeholder="Per-device relay auth token (stored in Android Keystore)"
                    style={{
                      flex: 1,
                      boxSizing: 'border-box',
                      padding: '9px 11px',
                      borderRadius: 10,
                      border: `1px solid ${ui.border}`,
                      background: ui.cardSubBg,
                      color: ui.textPrimary,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = configureNativeWhatsAppRelay({
                        endpointUrl: waRelayUrlInput,
                        clientToken: waRelayTokenInput,
                      });
                      setWaState(next);
                      setWaRelayTokenInput('');
                      setSaveNotice('Saved WhatsApp Relay Server configuration');
                    }}
                    style={{
                      padding: '9px 14px',
                      borderRadius: 10,
                      border: '1px solid rgba(16, 185, 129, 0.5)',
                      background: '#10b981',
                      color: '#fff',
                      fontWeight: 800,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Save Relay
                  </button>
                </div>
              </div>
            </div>

            {/* App & Data Section (Screen 6 Bottom Card) */}
            <div style={{
              padding: '16px 18px',
              borderRadius: 22,
              background: ui.cardBg,
              border: `1px solid ${ui.border}`,
              boxShadow: ui.shadow,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: ui.textPrimary, marginBottom: 4 }}>
                App &amp; Data
              </div>

              <button
                type="button"
                onClick={() => setShowMobileAppModal(true)}
                style={{
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: `1px solid ${ui.border}`,
                  background: ui.cardSubBg,
                  color: ui.textPrimary,
                  fontWeight: 800,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>🔄 PC Sync &amp; Backup</span>
                <span style={{ color: ui.textSecondary }}>›</span>
              </button>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                  type="button"
                  onClick={exportBackupJson}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 14,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardSubBg,
                    color: ui.textPrimary,
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>📤 Export JSON</span>
                  <span style={{ color: ui.textSecondary }}>›</span>
                </button>

                <label
                  style={{
                    padding: '12px 14px',
                    borderRadius: 14,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardSubBg,
                    color: ui.textPrimary,
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>📥 Import JSON</span>
                  <span style={{ color: ui.textSecondary }}>›</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={importBackupJson}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Clear saved attendance records for ${selectedMonth}?\n\n🔒 Note: Your Payment & Expense Transactions are permanently protected and will NEVER be deleted.`)) {
                    const next = { ...daysMap };
                    for (const k of Object.keys(next)) {
                      if (k.startsWith(selectedMonth)) delete next[k];
                    }
                    setDaysMap(next);
                    persistStore(
                      settings,
                      next,
                      `Cleared ${selectedMonth} attendance (Permanent Payment Transactions preserved)`,
                      expensesMapRef.current
                    );
                  }
                }}
                style={{
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: '1px solid rgba(244, 63, 94, 0.3)',
                  background: 'rgba(244, 63, 94, 0.08)',
                  color: '#f43f5e',
                  fontWeight: 800,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>🗑️ Clear Attendance Data (Payments Protected 🔒)</span>
                <span>›</span>
              </button>
            </div>
          </div>
        )}

        {/* Explicit Consent Modal for After-OUT Automatic WhatsApp Statement */}
        {showWaConsentModal && (
          <div
            onClick={() => setShowWaConsentModal(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1500,
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
                maxWidth: 420,
                borderRadius: 22,
                background: ui.cardBg,
                border: `1px solid ${ui.border}`,
                padding: 20,
                color: ui.textPrimary,
                boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 950, marginBottom: 8 }}>
                Confirm Automatic WhatsApp Statement
              </div>
              <p style={{ fontSize: 12.5, color: ui.textSecondary, lineHeight: 1.55, margin: '0 0 12px' }}>
                When enabled, each time you complete a <strong>Biometric OUT</strong> punch, your daily attendance &amp; pay summary will leave this device and be sent automatically via the official WhatsApp Business Platform Cloud API to the fixed recipient:
              </p>
              <div style={{
                padding: '10px 12px',
                borderRadius: 12,
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(52, 211, 153, 0.45)',
                color: '#10b981',
                fontWeight: 900,
                fontSize: 14,
                textAlign: 'center',
                marginBottom: 12,
              }}>
                📞 +91 7386726193 (Template: daily_ot_statement)
              </div>
              <div style={{
                padding: '10px 12px',
                borderRadius: 12,
                background: ui.cardSubBg,
                border: `1px solid ${ui.border}`,
                fontSize: 11.5,
                color: ui.textSecondary,
                lineHeight: 1.5,
                marginBottom: 16,
              }}>
                <div><strong>Fields sent:</strong> Date, Status, IN Time, OUT Time, Worked Duration, OT Duration, Base Pay, OT Pay, Allowance, and Total Day Pay.</div>
                <div style={{ marginTop: 4 }}><strong>Privacy guarantee:</strong> Personal work notes, Expense Memory transactions, and bank/UPI notifications are <strong>never</strong> included.</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowWaConsentModal(false)}
                  style={{
                    padding: '11px',
                    borderRadius: 12,
                    border: `1px solid ${ui.border}`,
                    background: ui.cardSubBg,
                    color: ui.textSecondary,
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = setWhatsAppAutoSendEnabled(true, true);
                    setWaState(next);
                    setShowWaConsentModal(false);
                    setSaveNotice('✓ Enabled automatic WhatsApp statement after OUT (+91 7386726193)');
                  }}
                  style={{
                    padding: '11px',
                    borderRadius: 12,
                    border: '1px solid rgba(16, 185, 129, 0.6)',
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  I Consent &amp; Enable
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* STICKY 5-TAB BOTTOM NAVIGATION BAR (Today | Expenses | Month | Slip | Rules) */}
      <div
        className="ot-no-print"
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 900,
          background: isLight ? 'rgba(255, 255, 255, 0.94)' : 'rgba(6, 11, 23, 0.94)',
          backdropFilter: 'blur(22px)',
          borderTop: `1px solid ${ui.border}`,
          display: 'flex',
          justifyContent: 'center',
          padding: '6px 10px calc(7px + env(safe-area-inset-bottom, 0px))',
          boxShadow: isLight ? '0 -8px 24px rgba(15,23,42,0.06)' : '0 -14px 36px rgba(0,0,0,0.65)',
        }}
      >
        <div style={{
          width: '100%',
          maxWidth: 520,
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 5,
        }}>
          {[
            { id: 'today', icon: '🕒', label: 'Today', title: 'Today Punch' },
            { id: 'expenses', icon: '💳', label: 'Expenses', title: 'Expenses' },
            { id: 'month', icon: '📅', label: 'Month', title: 'Month Days' },
            { id: 'summary', icon: '🧾', label: 'Slip', title: 'Salary Slip' },
            { id: 'rules', icon: '⚙️', label: 'Rules', title: 'Rules & App' },
          ].map((nav) => {
            const active = mobileTab === nav.id;
            return (
              <button
                key={nav.id}
                type="button"
                title={nav.title}
                onClick={() => navigateTab(nav.id)}
                style={{
                  position: 'relative',
                  padding: '8px 4px 7px',
                  borderRadius: 14,
                  border: active
                    ? isLight ? '1px solid rgba(37, 99, 235, 0.25)' : '1px solid rgba(56, 189, 248, 0.28)'
                    : '1px solid transparent',
                  background: active
                    ? isLight
                      ? 'linear-gradient(180deg, rgba(37, 99, 235, 0.12) 0%, rgba(16, 185, 129, 0.08) 100%)'
                      : 'linear-gradient(180deg, rgba(37, 99, 235, 0.24) 0%, rgba(16, 185, 129, 0.12) 100%)'
                    : 'transparent',
                  color: active ? (isLight ? '#1d4ed8' : '#38bdf8') : ui.textSecondary,
                  fontWeight: active ? 900 : 700,
                  fontSize: 11,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                }}
              >
                {active && (
                  <span style={{
                    position: 'absolute',
                    top: 0,
                    width: 22,
                    height: 3,
                    borderRadius: 999,
                    background: 'linear-gradient(90deg, #38bdf8 0%, #10b981 100%)',
                  }} />
                )}
                <span style={{ fontSize: 16 }}>{nav.icon}</span>
                <span>{nav.label}</span>
                <span style={{ display: 'none' }}>{nav.title}</span>
              </button>
            );
          })}
        </div>
      </div>

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
                  Use the OT &amp; Salary Tracker on your Android / iPhone — either with opt-in local Wi-Fi sync or 100% offline anywhere.
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
                Download <strong>OT-Salary-Mobile.apk</strong> to install the native Android app on your phone, or download <strong>OT-Salary-Mobile-App.html</strong> pre-loaded with your current saved attendance days &amp; ₹{formatINR(rates.salary)} settings. Both work 100% offline at your office!
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
                  📡 Option 2: Open Live Mobile Web App (Installable PWA)
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

            {/* Option 3: Opt-In Two-Way PC Sync & Backup/Restore JSON */}
            <div style={{
              padding: 16,
              borderRadius: 14,
              background: '#090d16',
              border: '1px solid rgba(148, 163, 184, 0.25)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: '#fde047' }}>
                  🔄 Opt-In Two-Way Phone ↔ PC Attendance Sync &amp; Local Backup
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 800, color: '#e2e8f0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={pcSyncOptIn}
                    onChange={(e) => {
                      const next = Boolean(e.target.checked);
                      setPcSyncOptIn(next);
                      try { localStorage.setItem('pattan.ot.pcSyncOptIn', next ? 'true' : 'false'); } catch (_) {}
                    }}
                  />
                  <span>Enable PC Sync</span>
                </label>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 11.5, color: '#94a3b8', lineHeight: 1.45 }}>
                <strong>Privacy disclosure:</strong> PC Sync is disabled by default. When enabled, only your attendance dates, shift IN/OUT times, and salary rule settings are synced with your PC over local Wi-Fi. Private Expense Memory transactions never leave this device.
              </p>
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
                  disabled={syncBusy || !pcSyncOptIn}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: '1px solid rgba(52,211,153,0.5)',
                    background: pcSyncOptIn ? 'rgba(16,185,129,0.2)' : 'rgba(148,163,184,0.1)',
                    color: pcSyncOptIn ? '#6ee7b7' : '#64748b',
                    fontWeight: 900,
                    fontSize: 12.5,
                    cursor: pcSyncOptIn ? 'pointer' : 'not-allowed',
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
