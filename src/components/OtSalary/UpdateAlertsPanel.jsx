import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, Volume2, Moon, Settings2, RefreshCw, ShieldCheck } from 'lucide-react';
import './UpdateAlerts.css';
import { readUpdateAlertStatus, updateAlertBridge } from './updateAlertBridge.js';

export default function UpdateAlertsPanel({ appName = 'Time Is Money' }) {
  const [status, setStatus] = useState({ supported: false });
  const [notice, setNotice] = useState('');
  const [bridgeError, setBridgeError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingCheck, setPendingCheck] = useState(null);
  const [permissionWatchUntil, setPermissionWatchUntil] = useState(0);
  const refresh = useCallback(() => {
    try {
      const value = readUpdateAlertStatus(window);
      setStatus(value);
      setBridgeError('');
      return value;
    } catch (error) {
      setBridgeError(error.message);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!pendingCheck) return undefined;
    const poll = () => {
      if (document.visibilityState !== 'visible') return;
      const value = refresh();
      if (value && Number(value.lastCheckedAt) > pendingCheck.lastCheckedAt) {
        setPendingCheck(null);
        setNotice(value.lastCheckError ? '' : 'Background update check completed.');
      } else if (Date.now() >= pendingCheck.expiresAt) {
        setPendingCheck(null);
        setNotice('The check is queued. Android will run it when a network and background access are available.');
      }
    };
    const timer = window.setInterval(poll, 2000);
    return () => window.clearInterval(timer);
  }, [pendingCheck, refresh]);

  useEffect(() => {
    if (!permissionWatchUntil) return undefined;
    const timer = window.setInterval(() => {
      const value = document.visibilityState === 'visible' ? refresh() : null;
      if (value?.notificationsGranted || Date.now() >= permissionWatchUntil) {
        setPermissionWatchUntil(0);
        if (value?.notificationsGranted) setNotice('Android notification permission is allowed.');
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [permissionWatchUntil, refresh]);

  const watchCheck = (lastCheckedAt) => setPendingCheck({
    lastCheckedAt: Number(lastCheckedAt) || 0,
    expiresAt: Date.now() + 60000,
  });

  const configure = (next) => {
    setBusy(true);
    setNotice('');
    try {
      const value = updateAlertBridge(window, 'configureUpdateAlerts').configureUpdateAlerts(
        Boolean(next.enabled), Boolean(next.spokenEnabled), Boolean(next.speakInSilent)
      );
      const saved = JSON.parse(value);
      if (!saved || typeof saved !== 'object' || saved.error) throw new Error(saved?.error || 'Settings were not saved.');
      setStatus(saved);
      setBridgeError('');
      setNotice(saved.lastCheckError ? '' : 'Alert preferences saved on this device.');
      if (saved.enabled) watchCheck(saved.lastCheckedAt);
      else setPendingCheck(null);
    } catch (error) { setNotice(error.message || 'Could not save alert preferences.'); }
    finally { setBusy(false); }
  };

  const invoke = (method, message) => {
    try {
      const previousCheck = Number(status.lastCheckedAt) || 0;
      const bridge = updateAlertBridge(window, method);
      if (!bridge || !bridge[method]()) throw new Error('Android could not complete this action. Check notification permission and channel settings.');
      setNotice(message);
      refresh();
      if (method === 'checkUpdateAlertsNow') watchCheck(previousCheck);
      if (method === 'requestUpdateNotificationPermission') setPermissionWatchUntil(Date.now() + 30000);
    } catch (error) { setNotice(error.message); }
  };

  const allowed = status.notificationsGranted && status.notificationsEnabled && status.channelEnabled;
  const supported = Boolean(status.supported);
  const androidApp = Boolean(window.PattanBiometric || window.PattanBiometricBridge);
  return (
    <section className="time-money-alerts" aria-labelledby="time-money-alerts-title">
      <div className="time-money-section-title">
        <div><BellRing size={19} aria-hidden="true" /><h2 id="time-money-alerts-title">Updates &amp; voice alerts</h2></div>
        <span className="time-money-status">{!supported ? androidApp ? 'APK update required' : 'Android app required' : allowed ? 'Notifications allowed' : 'Needs attention'}</span>
      </div>
      {!supported && <p className="time-money-muted">This installed APK does not contain the Android alert service. Install the signed APK update to enable these controls. A web update alone cannot add screen-off speech.</p>}
      <label className="time-money-setting-row">
        <span><BellRing size={18} aria-hidden="true" /><span>Background update alerts</span></span>
        <input type="checkbox" role="switch" checked={Boolean(status.enabled)} disabled={!supported || busy} onChange={e => configure({ ...status, enabled: e.target.checked })} />
      </label>
      <label className="time-money-setting-row">
        <span><Volume2 size={18} aria-hidden="true" /><span>Speak update alerts</span></span>
        <input type="checkbox" role="switch" checked={Boolean(status.spokenEnabled)} disabled={!supported || !status.enabled || busy} onChange={e => configure({ ...status, spokenEnabled: e.target.checked })} />
      </label>
      <label className="time-money-setting-row">
        <span><Moon size={18} aria-hidden="true" /><span>Use alarm audio in silent mode</span></span>
        <input type="checkbox" role="switch" checked={Boolean(status.speakInSilent)} disabled={!supported || !status.enabled || !status.spokenEnabled || busy} onChange={e => configure({ ...status, speakInSilent: e.target.checked })} />
      </label>
      <p className="time-money-muted">Do Not Disturb and system volume remain under your control. Android and battery restrictions can delay background checks.</p>
      {supported && (!status.enabled || !status.spokenEnabled || !status.speakInSilent) && <button type="button" disabled={busy} onClick={() => configure({ enabled: true, spokenEnabled: true, speakInSilent: true })}>Enable background, voice &amp; silent-mode alerts</button>}
      {supported && status.spokenEnabled && status.speakInSilent && Number(status.alarmVolume) === 0 && <p role="alert">Alarm volume is zero. Raise the phone’s alarm volume to hear spoken updates in silent mode.</p>}
      {supported && status.spokenEnabled && (!status.channelSoundEnabled || !status.channelVoiceSoundSelected) && <p role="alert">The selected update channel has no announcement sound. Open Android settings below to review this channel.</p>}
      {supported && (
        <dl className="time-money-alert-status">
          <div><dt>Background check</dt><dd>{status.enabled ? `About every ${status.checkIntervalMinutes || 15} minutes` : 'Off'}</dd></div>
          <div><dt>Spoken sound</dt><dd>{status.voiceReady ? 'Ready' : status.spokenEnabled ? 'Check sound settings' : 'Off'}</dd></div>
          <div><dt>Do Not Disturb</dt><dd>{status.dndActive ? 'On' : 'Off'}</dd></div>
          <div><dt>Last checked</dt><dd>{Number(status.lastCheckedAt) > 0 ? new Date(Number(status.lastCheckedAt)).toLocaleString() : 'Not yet'}</dd></div>
        </dl>
      )}
      {supported && !status.notificationsGranted && <button className="time-money-primary" type="button" disabled={Boolean(permissionWatchUntil)} onClick={() => invoke('requestUpdateNotificationPermission', 'Complete the Android notification permission request.')}>{permissionWatchUntil ? 'Waiting for Android' : 'Allow notifications'}</button>}
      <div className="time-money-alert-actions">
        <button type="button" disabled={!supported || busy} onClick={() => invoke('openUpdateNotificationSettings', 'Review the update notification channel sound in Android settings.')}><Settings2 size={16} aria-hidden="true" />Android settings</button>
        <button type="button" disabled={!supported || !status.enabled || busy || Boolean(pendingCheck)} onClick={() => invoke('checkUpdateAlertsNow', `Checking for ${appName} updates in the background.`)}><RefreshCw size={16} aria-hidden="true" />{pendingCheck ? 'Check queued' : 'Check now'}</button>
        <button type="button" disabled={!supported || !status.enabled || !allowed || busy || !updateAlertBridge(window, 'testUpdateAlert')} onClick={() => invoke('testUpdateAlert', 'Test notification posted using your chosen update sound. Check the notification shade and listen for the announcement.')}><Volume2 size={16} aria-hidden="true" />Test update alert</button>
      </div>
      {notice && <p className="time-money-alert-notice" role="status">{notice}</p>}
      {(bridgeError || status.lastCheckError) && <p className="time-money-alert-notice" role="alert">{bridgeError || status.lastCheckError}</p>}
      <div className="time-money-data-note"><ShieldCheck size={16} aria-hidden="true" />Alert settings do not change your salary or transaction records.</div>
    </section>
  );
}
