import React, { useEffect, useState } from 'react';
import { safeWhatsAppError } from '../studioPreferences.mjs';

export default function AppWarnings() {
  const [warnings, setWarnings] = useState([]);
  useEffect(() => {
    const add = (reason, area) => {
      const message = safeWhatsAppError(reason, 'An unexpected internal error occurred.');
      setWarnings(items => [{ message, area, at: new Date().toLocaleTimeString() }, ...items.filter(item => item.message !== message)].slice(0, 5));
    };
    const error = event => { if (event.message || event.error) add(event.error || event.message, 'App error'); };
    const rejection = event => add(event.reason, 'Background operation');
    const job = event => add(event.detail?.message, 'Operation failed');
    const resolved = event => {
      if (event.detail?.category === 'voice-server') {
        setWarnings(items => items.filter(item => !/^Anjali clone server stopped\./i.test(item.message)));
      }
    };
    window.addEventListener('error', error);
    window.addEventListener('unhandledrejection', rejection);
    window.addEventListener('pattan-warning', job);
    window.addEventListener('pattan-warning-resolved', resolved);
    const unsubscribe = window.electronAPI?.onAppWarning?.(payload => add(payload?.message, 'Operation failed'));
    return () => {
      window.removeEventListener('error', error);
      window.removeEventListener('unhandledrejection', rejection);
      window.removeEventListener('pattan-warning', job);
      window.removeEventListener('pattan-warning-resolved', resolved);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);
  if (!warnings.length) return null;
  return <aside className="app-warning-panel" aria-label="App warnings">
    <div role="alert"><strong>⚠ Something needs attention</strong><p>{warnings[0].message}</p></div>
    <small>{warnings[0].area} · {warnings[0].at}</small>
    <p>Check the affected module’s log before retrying. If this repeats, save your work and restart only when all jobs are idle.</p>
    <details><summary>Recent warnings ({warnings.length})</summary>{warnings.map((item, index) => <p key={index}>{item.at} · {item.area}: {item.message}</p>)}</details>
    <button type="button" onClick={() => setWarnings([])}>Dismiss warnings</button>
  </aside>;
}
