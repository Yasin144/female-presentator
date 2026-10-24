import React, { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowUpRight, Bell, Check, ChevronDown, Clock3, Fingerprint, LogOut, Settings2, ShieldCheck, Volume2 } from 'lucide-react';
import TimeIsMoneyIdentity from './TimeIsMoneyIdentity.jsx';
import './LiveOtView.css';

function MoneyValue({ value, visible, formatMoney, precise = false }) {
  return visible && precise ? `₹${Number(value).toFixed(2)}` : formatMoney(value);
}

export function LiveOtSummary({ ticker, visible, formatMoney, onOpen, onSpeakShift, onSpeakHour, onLockTest }) {
  return (
    <section className="tim-live-summary" aria-label="Live overtime">
      <button className="tim-live-summary-main" type="button" onClick={onOpen} aria-label="Open live overtime timer">
        <span className="tim-state-dot" aria-hidden="true" />
        <span><span className="tim-label">Overtime is running</span><strong className="tim-live-mini-clock">{ticker.stopwatchStr}</strong></span>
        <ArrowUpRight size={18} aria-hidden="true" />
      </button>
      <div className="tim-live-summary-money"><span className="tim-label">OT earned</span><strong><MoneyValue value={ticker.liveOtMoney} visible={visible} formatMoney={formatMoney} precise /></strong></div>
      <details className="tim-live-tools">
        <summary title="Overtime reminder controls" aria-label="Overtime reminder controls"><Settings2 size={18} aria-hidden="true" /></summary>
        <div>
          <button type="button" onClick={onSpeakShift}><Volume2 size={16} aria-hidden="true" />Speak shift alert</button>
          <button type="button" onClick={onSpeakHour}><Bell size={16} aria-hidden="true" />{Math.min(8, Math.max(1, ticker.otHoursPart || 1))} hour voice</button>
          <button type="button" onClick={onLockTest}><ShieldCheck size={16} aria-hidden="true" />Lock-screen test (6s)</button>
        </div>
      </details>
    </section>
  );
}

export default function LiveOtWorkspace({ ticker, now, hasSavedPunchIn, visible, formatMoney, renderPrivacyControl, onClose, onSignInChange, defaultSignIn, formatTime, onSpeakShift, onSpeakHour, onLockTest, onPunchOut }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    const focusable = () => [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])')].filter(element => element.getClientRects().length > 0);
    const handleKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const targets = focusable();
      const first = targets[0] || dialog;
      const last = targets[targets.length - 1] || dialog;
      if (!dialog.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.body.style.overflow = 'hidden';
    (focusable()[0] || dialog).focus();
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      if (document.body.style.overflow === 'hidden') document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
    };
  }, []);
  return (
    <div className="tim-live-backdrop" onClick={onClose}>
      <section className="tim-live-workspace" role="dialog" aria-modal="true" aria-labelledby="tim-live-title" tabIndex={-1} ref={dialogRef} onClick={event => event.stopPropagation()}>
        <header className="tim-live-header">
          <div className="tim-live-brand"><TimeIsMoneyIdentity size={34} /><div><span>Time Is Money</span><h2 id="tim-live-title">Overtime tracker</h2></div></div>
          <button className="tim-icon-button" type="button" onClick={onClose} title="Back to workday" aria-label="Back to workday"><ArrowLeft size={19} aria-hidden="true" /></button>
        </header>

        <div className="tim-live-body">
          <div className="tim-live-stage">
            <div className="tim-live-section-label"><span className={`tim-state-badge ${hasSavedPunchIn && ticker.isActive ? 'is-running' : ''}`}>{hasSavedPunchIn && ticker.hasPunchedOut ? <Check size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}{!hasSavedPunchIn ? 'Not checked in' : ticker.hasPunchedOut ? 'Shift saved' : ticker.isActive ? 'Overtime running' : 'On duty'}</span><time>{now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</time></div>
            <div className="tim-stopwatch">
              <p>{hasSavedPunchIn && ticker.hasPunchedOut ? 'Recorded overtime' : 'Elapsed overtime'}</p>
              <output className="tim-stopwatch-digits" aria-label="Overtime hours minutes seconds" aria-live="off">{hasSavedPunchIn ? ticker.stopwatchStr : '00:00:00'}</output>
              <div className="tim-stopwatch-units" aria-hidden="true"><span>HOURS</span><span>MINUTES</span><span>SECONDS</span></div>
              <span className="tim-stopwatch-caption">{!hasSavedPunchIn ? 'Punch in to start tracking' : ticker.hasPunchedOut ? `Punched out at ${ticker.outTimeFormatted}` : ticker.isActive ? `${ticker.minSecLabel} beyond your normal shift` : `${ticker.remainingDutyStr} until duty ends`}</span>
            </div>

            <ol className="tim-shift-timeline" aria-label="Workday timing">
              <li className={hasSavedPunchIn ? 'is-complete' : ''}><span className="tim-timeline-marker">{hasSavedPunchIn ? <Check size={12} aria-hidden="true" /> : <Clock3 size={12} aria-hidden="true" />}</span><span>Signed in<strong>{hasSavedPunchIn ? ticker.inTimeFormatted : 'Not yet'}</strong></span></li>
              <li className={hasSavedPunchIn && ticker.isCompletedShift ? 'is-complete' : ''}><span className="tim-timeline-marker">{hasSavedPunchIn && ticker.isCompletedShift ? <Check size={12} aria-hidden="true" /> : <Clock3 size={12} aria-hidden="true" />}</span><span>{hasSavedPunchIn && ticker.isCompletedShift ? 'Duty ended' : 'Duty ends'}<strong>{hasSavedPunchIn ? ticker.officeEndFormatted : 'Not yet'}</strong></span></li>
              <li className={hasSavedPunchIn && ticker.hasPunchedOut ? 'is-complete' : ''}><span className="tim-timeline-marker">{hasSavedPunchIn && ticker.hasPunchedOut ? <Check size={12} aria-hidden="true" /> : <LogOut size={12} aria-hidden="true" />}</span><span>Punch out<strong>{hasSavedPunchIn && ticker.hasPunchedOut ? ticker.outTimeFormatted : 'Not yet'}</strong></span></li>
            </ol>
            <div className="tim-shift-duration"><Clock3 size={14} aria-hidden="true" /><span>Normal shift</span><strong>{ticker.shiftDurationFormatted}</strong></div>

            {hasSavedPunchIn && ticker.isActive && ticker.nextMilestoneFormatted && ticker.secondsToNextMilestone > 0 && (
              <div className="tim-milestone">
                <div><span><Bell size={15} aria-hidden="true" />Next hourly reminder</span><strong>{ticker.nextMilestoneFormatted}</strong></div>
                <progress max="3600" value={(ticker.otMinsPart * 60) + ticker.otSecsPart} aria-label="Progress to the next overtime hour" />
                <p>{ticker.nextMilestonePhrase}</p>
              </div>
            )}
          </div>

          <div className="tim-live-details">
            <section className="tim-live-earnings" aria-label="Overtime earnings">
              <div className="tim-live-section-label"><h3>OT earnings</h3>{renderPrivacyControl(true)}</div>
              <strong className="tim-live-amount"><MoneyValue value={hasSavedPunchIn ? ticker.liveOtMoney : 0} visible={visible} formatMoney={formatMoney} precise /></strong>
              <p>{formatMoney(ticker.otPerMinute, '₹', ' / min')}<span aria-hidden="true"> · </span>{formatMoney(ticker.otPerHour, '₹', ' / hour')}</p>
              <dl>
                <div><dt>Completed OT minutes</dt><dd>{hasSavedPunchIn ? ticker.totalOtMinutes : 0} min</dd></div>
                <div><dt>Completed-minute earnings</dt><dd>{formatMoney(hasSavedPunchIn ? ticker.completedMinsOtMoney : 0)}</dd></div>
                <div><dt>Today, including base pay</dt><dd><MoneyValue value={hasSavedPunchIn ? ticker.totalTodayPay : 0} visible={visible} formatMoney={formatMoney} precise /></dd></div>
              </dl>
              {!visible && <div className="tim-privacy-note"><ShieldCheck size={14} aria-hidden="true" />Earnings are locked</div>}
            </section>

            <details className="tim-signin-editor">
              <summary><Clock3 size={17} aria-hidden="true" /><span>Sign-in time</span><strong>{hasSavedPunchIn ? ticker.inTimeFormatted : 'Not yet'}</strong><ChevronDown size={15} aria-hidden="true" /></summary>
              <div><label htmlFor="tim-live-signin">Today&apos;s sign-in</label><input id="tim-live-signin" type="time" value={hasSavedPunchIn ? ticker.inTime24h || '08:23' : ''} onChange={event => onSignInChange(event.target.value)} /><div className="tim-signin-presets"><button type="button" aria-pressed={Boolean(hasSavedPunchIn && ticker.inTime24h === '08:23')} onClick={() => onSignInChange('08:23')}>08:23 AM</button><button type="button" aria-pressed={Boolean(hasSavedPunchIn && ticker.inTime24h === (defaultSignIn || '10:00'))} onClick={() => onSignInChange(defaultSignIn || '10:00')}>{formatTime(defaultSignIn || '10:00')}</button></div></div>
            </details>

            <details className="tim-reminder-controls" open>
              <summary><Bell size={17} aria-hidden="true" /><span>Reminder controls</span><ChevronDown size={15} aria-hidden="true" /></summary>
              <div className="tim-reminder-actions"><button type="button" onClick={onSpeakShift}><Volume2 size={17} aria-hidden="true" /><span>Speak shift alert</span></button><button type="button" onClick={onSpeakHour}><Bell size={17} aria-hidden="true" /><span>{Math.min(8, Math.max(1, ticker.otHoursPart || 1))} hour voice</span></button><button type="button" onClick={onLockTest} title="Speaks after 6 seconds, including while your phone is locked"><ShieldCheck size={17} aria-hidden="true" /><span>Lock-screen test (6s)</span></button></div>
            </details>
          </div>
        </div>
        <footer className="tim-live-footer"><span><Fingerprint size={17} aria-hidden="true" />Biometric attendance</span><button type="button" onClick={onPunchOut}><LogOut size={18} aria-hidden="true" />Punch OUT &amp; save OT</button></footer>
      </section>
    </div>
  );
}
