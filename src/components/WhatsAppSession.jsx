import React, { useEffect, useRef, useState } from 'react';
import { safeWhatsAppError } from '../studioPreferences.mjs';
import StudioIcon from './StudioIcon';

const connections = { off: 'Off', disconnected: 'Disconnected', connecting: 'Opening Chrome…',
  'scan-qr': 'Scan the QR code in Chrome', loading: 'Loading WhatsApp…', ready: 'Connected' };
const deliveries = { queued: 'Waiting to send', sending: 'Sending…', submitted: 'Submitted · not yet acknowledged',
  accepted: 'Accepted by WhatsApp', delivered: 'Delivered', uncertain: 'Check WhatsApp · send unconfirmed',
  failed: 'Notification failed', cancelled: 'Not sent · switched off' };

export default function WhatsAppSession({ compact = false }) {
  const [status, setStatus] = useState(null);
  const [risk, setRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const pending = useRef(false);
  const alive = useRef(true);
  const options = useRef(null);
  const api = window.electronAPI;
  const available = !api?.isMobileRemote && typeof api?.whatsAppSessionStatus === 'function';
  useEffect(() => {
    alive.current = true;
    if (!available) return () => { alive.current = false; };
    const refresh = async () => {
      if (pending.current) return;
      pending.current = true;
      try {
        const next = await api.whatsAppSessionStatus();
        if (alive.current) { setStatus(next); }
      } catch { if (alive.current) setError('Restart the desktop app when idle to load WhatsApp automatic notifications.'); }
      finally { pending.current = false; }
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [available, api]);
  const act = async action => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const next = await action();
      if (alive.current) { setStatus(next); if (!next.ok) setError(next.error || 'WhatsApp action failed.'); }
    } catch (failure) { if (alive.current) setError(safeWhatsAppError(failure)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  return <div className="studio-whatsapp-auto" aria-label="Automatic WhatsApp notifications">
    <div className="studio-whatsapp-heading">
      <button type="button" className="studio-icon-toggle is-whatsapp" role="switch"
        title={`WhatsApp alerts: ${status?.enabled ? 'On — click to turn off' : 'Off — click to turn on'}. Only +91 7386726193`}
        aria-label="Automatic WhatsApp notifications" aria-checked={status?.enabled === true}
        disabled={!available || !status || busy}
        onClick={() => {
          if (!status.enabled && !status.consent && !risk) { options.current.open = true; setError('Before turning on WhatsApp, review and accept the setup warning below.'); return; }
          act(() => api.whatsAppSessionEnable({ enabled: !status.enabled, acceptedRisk: risk }));
        }}>
        <StudioIcon name="whatsapp" size={compact ? 22 : 25} />{!compact && <><span>WhatsApp</span><small>{busy ? 'Saving…' : status?.enabled ? 'On' : 'Off'}</small></>}
      </button>
      {!compact && <small className="studio-connection-status" role="status">{connections[status?.connection] || 'Checking…'}</small>}
    </div>
    <details className="studio-whatsapp-options" ref={options}>
    <summary>Setup &amp; history</summary>
    {compact && <button type="button" className="studio-whatsapp-review-toggle" onClick={() => { options.current.open = false; setError(''); }}>Close</button>}
    <p>Completed and failed jobs go only to +91 7386726193. Chrome minimizes after connecting; your personal Chrome windows stay unchanged.</p>
    <p className="studio-whatsapp-notice">Unofficial integration: WhatsApp changes can interrupt sending or lead to account restrictions. Only job status, process names, output filenames and sanitized failure reasons are sent—not videos or full logs.</p>
    {!status?.consent && <label className="studio-whatsapp-risk"><input type="checkbox" checked={risk} onChange={event => setRisk(event.target.checked)} disabled={busy || !available} /> I understand the unofficial-integration risk and allow automatic notifications to this number.</label>}
    {!available && <p>Open the updated Windows desktop app to link WhatsApp.</p>}
    {status && <>
      <div className="studio-whatsapp-draft-actions">
        <strong role="status">{connections[status.connection] || 'Unavailable'} · {status.pending} waiting</strong>
        <button type="button" disabled={!status.enabled || busy} onClick={() => act(() => api.whatsAppSessionConnect())}>Connect / show WhatsApp</button>
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide' : 'Show'} notification history</button>
      </div>
      {status.enabled && status.connection !== 'ready' && <p>In the Chrome window, scan the QR code using your phone: WhatsApp → Linked devices → Link a device. New updates wait until connected.</p>}
      <p className="studio-whatsapp-notice">Off stops new automatic notifications and cancels waiting ones. An already-started send cannot be recalled. Unconfirmed sends are never automatically repeated. Manual drafts below are a separate fallback.</p>
      {expanded && <div className="studio-whatsapp-draft-list">
        {!status.history?.length && <p>No automatic notifications yet. The next completed or failed job will appear here when On.</p>}
        {status.history?.map(item => <article className="studio-whatsapp-draft" key={item.id}>
          <div className="studio-whatsapp-draft-heading"><h3>{item.processName}</h3><span>{item.status === 'completed' ? 'Completed' : 'Failed'}</span></div>
          <p>{item.details}</p><strong>{deliveries[item.delivery] || 'Unknown'}</strong>
          {item.note && <p>{item.note}</p>}
          {['uncertain', 'failed'].includes(item.delivery) && <button type="button" className="studio-whatsapp-review-toggle"
            disabled={busy || status.connection !== 'ready' || !status.enabled}
            onClick={() => {
              if (window.confirm('Check WhatsApp first. Retry this notification only to +91 7386726193? An unconfirmed earlier attempt may have arrived, so retrying can create a duplicate.'))
                act(() => api.whatsAppSessionRetry({ id: item.id, confirmedNotReceived: true }));
            }}>Retry notification</button>}
          <p><time>{new Date(item.at).toLocaleString()}</time></p>
        </article>)}
      </div>}
    </>}
    </details>
    {(error || status?.error) && <div className="studio-preference-error" role="alert"><span><strong>WhatsApp warning</strong><br />{error || status.error}<br />Open Setup &amp; history to check the connection. Waiting jobs are not proof of delivery.</span><button type="button" onClick={() => { options.current.open = true; }}>View setup</button></div>}
  </div>;
}
