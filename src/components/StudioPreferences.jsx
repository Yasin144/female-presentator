import React, { useCallback, useEffect, useRef, useState } from 'react';
import StudioIcon from './StudioIcon';
import WhatsAppSession from './WhatsAppSession';
import {
  readWhatsAppStatus, changeWhatsAppEnabled, openWhatsAppDraft, dismissWhatsAppDraft,
  safeWhatsAppError, describeWhatsAppAttempt, formatWhatsAppDraft, formatWhatsAppDraftTime,
} from '../studioPreferences.mjs';

export default function StudioPreferences({ appTheme, onToggleTheme }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const pending = useRef(false);
  const preferencesRef = useRef(null);
  const reviewButtonRef = useRef(null);
  const reviewHeadingRef = useRef(null);
  const mounted = useRef(true);
  const desktopOpening = !window.electronAPI?.isMobileRemote;

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(quiet ? 'refresh' : 'loading');
    try {
      const next = await readWhatsAppStatus(window.electronAPI);
      if (mounted.current) {
        setStatus(next);
        setError(current => current?.kind === 'read' ? null : current);
      }
    } catch (failure) {
      if (mounted.current) {
        setStatus(null);
        setError({ kind: 'read', message: safeWhatsAppError(failure) });
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy('');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const refreshVisible = () => {
      if (document.visibilityState === 'visible' && preferencesRef.current?.getClientRects().length) refresh({ quiet: true });
    };
    const timer = window.setInterval(refreshVisible, 10000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [refresh]);

  useEffect(() => { if (reviewOpen) reviewHeadingRef.current?.focus(); }, [reviewOpen]);

  const act = async (operation, action, success) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(operation);
    setError(null);
    setFeedback('');
    try {
      const next = await action();
      if (!mounted.current) return;
      setStatus(next);
      success?.(next);
    } catch (failure) {
      let actualStatus = failure?.whatsAppStatus;
      if (!actualStatus) {
        try { actualStatus = await readWhatsAppStatus(window.electronAPI); }
        catch (_) { /* Never retain a stale On after a failed state change. */ }
      }
      if (mounted.current) {
        setStatus(actualStatus || null);
        setError({ kind: 'action', message: safeWhatsAppError(failure) });
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy('');
    }
  };

  const toggleDrafts = () => {
    if (!status || status.mode !== 'drafts') return;
    act('toggle', () => changeWhatsAppEnabled(window.electronAPI, !status.enabled), next => {
      setFeedback(next.enabled
        ? 'WhatsApp drafts are on. New completion and failure updates will be ready for your review. Nothing is sent automatically.'
        : 'WhatsApp drafts are off. New updates will not create drafts; existing drafts remain available to review.');
    });
  };
  const toggleReview = () => {
    if (reviewOpen) reviewButtonRef.current?.focus();
    else refresh({ quiet: true });
    setReviewOpen(value => !value);
  };
  const openDraft = (draft, target) => {
    if (!desktopOpening) return;
    act(`open:${draft.id}`, () => openWhatsAppDraft(window.electronAPI, draft.id, target), () => {
      setFeedback('WhatsApp opened. Review the message there and click Send yourself. This app cannot confirm whether you send it.');
    });
  };
  const dismissDraft = draft => act(`dismiss:${draft.id}`, () => dismissWhatsAppDraft(window.electronAPI, draft.id), () => {
    setFeedback('Draft dismissed from this app. Nothing was sent.');
    reviewHeadingRef.current?.focus();
  });

  return (
    <section className="studio-preferences" aria-label="App preferences" ref={preferencesRef}>
      <WhatsAppSession />
      <div className="studio-whatsapp-preference">
        <button type="button" className="studio-preference-button" id="studio-whatsapp-status"
          role="switch" aria-label="WhatsApp drafts" aria-checked={status?.enabled === true}
          aria-describedby="studio-whatsapp-description" aria-busy={Boolean(busy)}
          disabled={Boolean(busy) || !status || status.mode !== 'drafts'} onClick={toggleDrafts}>
          <StudioIcon name="bell" size={21} />
          <span className="studio-preference-copy"><strong>WhatsApp drafts</strong><small id="studio-whatsapp-description">Completion &amp; failure updates · you click Send</small></span>
          <span className="studio-preference-state" role="status">{busy === 'loading' ? 'Checking…' : !status ? 'Unavailable' : status.enabled ? 'On' : 'Off'}</span>
        </button>
        <div className="studio-whatsapp-summary">
          <span>To <strong>+91 73867 26193</strong></span>
          <button type="button" id="studio-whatsapp-drafts-toggle" ref={reviewButtonRef}
            className="studio-whatsapp-review-toggle" disabled={Boolean(busy) || !status} aria-expanded={reviewOpen}
            aria-controls="studio-whatsapp-drafts" onClick={toggleReview}>
            {reviewOpen ? 'Hide drafts' : `Review drafts (${status?.pending || 0})`}
          </button>
        </div>
      </div>
      <button type="button" className="studio-preference-button" id="studio-theme-toggle"
        role="switch" aria-label="Dark mode" aria-checked={appTheme === 'dark'}
        aria-describedby="studio-theme-description" onClick={onToggleTheme}>
        <StudioIcon name="moon" size={21} />
        <span className="studio-preference-copy"><strong>Dark mode</strong><small id="studio-theme-description">App only · videos stay unchanged</small></span>
        <span className="studio-preference-state" aria-hidden="true">{appTheme === 'dark' ? 'On' : 'Off'}</span>
      </button>
      {reviewOpen && <div className="studio-whatsapp-drafts" id="studio-whatsapp-drafts" role="region" aria-labelledby="studio-whatsapp-drafts-heading">
        <div className="studio-whatsapp-heading">
          <div><h2 id="studio-whatsapp-drafts-heading" ref={reviewHeadingRef} tabIndex={-1}>Review WhatsApp drafts</h2><p>Prepared for <strong>+91 73867 26193</strong>. Nothing is sent automatically.</p></div>
          <button type="button" className="studio-whatsapp-review-toggle" id="studio-whatsapp-drafts-refresh" disabled={Boolean(busy)} onClick={() => refresh()}>Refresh drafts</button>
        </div>
        <p className="studio-whatsapp-notice">Check the recipient and message in WhatsApp, then click Send yourself. Send or clear the current WhatsApp draft before opening another, so you do not replace unsent text. Latest 100 drafts; cleared when this app closes.</p>
        {!desktopOpening && <p className="studio-whatsapp-remote-note">Open drafts from the desktop app. You can review, dismiss, or turn draft preparation on and off here.</p>}
        {!status?.drafts.length ? <p className="studio-whatsapp-empty">No drafts to review. {status?.enabled ? 'A new draft will appear when a job completes or fails.' : 'Turn on WhatsApp drafts to prepare updates for new jobs.'}</p> : <div className="studio-whatsapp-draft-list">
          {status.drafts.map(draft => <article className="studio-whatsapp-draft" key={draft.id} data-whatsapp-draft={draft.id}>
            <div className="studio-whatsapp-draft-heading"><h3>{draft.processName}</h3><span className={`studio-whatsapp-job-state is-${draft.status}`}>{draft.status === 'completed' ? 'Completed' : 'Failed'}</span></div>
            <time dateTime={draft.at || undefined}>{formatWhatsAppDraftTime(draft.at)}</time>
            <pre className="studio-whatsapp-message" aria-label="Draft message">{formatWhatsAppDraft(draft)}</pre>
            {draft.openedAt && <p className="studio-whatsapp-opened">Opened in WhatsApp. Sending is up to you; this app cannot confirm it.</p>}
            <div className="studio-whatsapp-draft-actions">
              {desktopOpening && <>
                <button type="button" data-draft-open="app" disabled={Boolean(busy)} onClick={() => openDraft(draft, 'app')}>Open in WhatsApp</button>
                <button type="button" data-draft-open="web" disabled={Boolean(busy)} onClick={() => openDraft(draft, 'web')}>Open in browser</button>
              </>}
              <button type="button" data-draft-dismiss={draft.id} disabled={Boolean(busy)} onClick={() => dismissDraft(draft)}>Dismiss draft</button>
            </div>
          </article>)}
        </div>}
      </div>}
      {feedback && <p className="studio-preference-feedback" role="status">{feedback}</p>}
      {status?.configurationError && <div className="studio-preference-error" role="alert"><span>{status.configurationError}</span><button type="button" disabled={Boolean(busy)} onClick={() => refresh()}>Retry status</button></div>}
      {error && <div className="studio-preference-error" role="alert"><span>{error.message}</span><button type="button" disabled={Boolean(busy)} onClick={() => refresh()}>Retry status</button></div>}
      {status?.lastAttempt && <p className="studio-whatsapp-activity" aria-label="WhatsApp draft activity">{describeWhatsAppAttempt(status.lastAttempt)}</p>}
    </section>
  );
}
