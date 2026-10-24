import React, { useEffect, useState } from 'react';
import { AlarmClockCheck, Bell, Settings2, Volume2 } from 'lucide-react';
import './OtVoice.css';

function bridge() {
  return typeof window === 'undefined' ? null : window.PattanBiometric || window.PattanBiometricBridge;
}

export default function OtVoiceStatusPanel() {
  const [status, setStatus] = useState(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const refresh = () => {
      try { setStatus(JSON.parse(bridge()?.getOtMilestoneStatusJson?.() || 'null')); } catch { setStatus(null); }
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return (
    <section className="tim-ot-voice-panel" aria-label="Hourly OT voice reminders">
      <h3><AlarmClockCheck size={20} aria-hidden="true" /> Hourly OT voice</h3>
      <p>After a saved punch-in, hear shift completion and each completed OT hour, up to 8 hours. Punching out cancels the reminders.</p>
      {status ? <>
        <p><strong>{status.active ? 'Reminders armed' : status.enabled ? 'No upcoming reminders for this shift' : 'Waiting for a saved punch-in'}</strong> · {status.exactAllowed ? 'Precise alarms allowed' : 'Precise alarms need permission'}</p>
        {!status.notificationsEnabled && <p role="status">Android notifications are blocked. Enable notifications to hear OT reminders.</p>}
        {status.blockedHours?.length > 0 && <p role="status">Blocked reminder channels: {status.blockedHours.join(', ')}. Enable them in notification settings. Channel 0 is shift completion.</p>}
        {status.silentHours?.length > 0 && <p role="status">Reminder channels without sound: {status.silentHours.join(', ')}. Choose a sound and allow audible notifications.</p>}
        {status.changedSoundHours?.length > 0 && <p role="status">Reminder channels using a different sound: {status.changedSoundHours.join(', ')}. They may play a tone instead of the spoken reminder.</p>}
        {status.alarmVolume === 0 && <p role="status">Alarm volume is zero. Raise it in your phone's sound settings to hear reminders.</p>}
        {status.dndActive && <p role="status">Do Not Disturb is active; Android may silence the spoken reminder.</p>}
        {status.voiceAssetsAvailable === false && <p role="status">Voice files are missing from this APK. Install the complete updated build.</p>}
        <p>Uses your alarm volume while the screen is off. Delayed delivery announces only the latest completed hour, up to {status.deliveryWindowMinutes || 30} minutes late. Older reminders are skipped. Opening the app can recover a recent reminder. Do Not Disturb, muted channels, force-stop and phone battery restrictions can block alerts.</p>
        <div className="tim-ot-voice-actions">
          <button type="button" onClick={() => bridge()?.openOtAlarmSettings?.()}><Settings2 size={16} aria-hidden="true" /> Alarm permission</button>
          <button type="button" onClick={() => bridge()?.openOtNotificationSettings?.()}><Bell size={16} aria-hidden="true" /> Notification settings</button>
          <button type="button" onClick={() => {
            const ok = bridge()?.testOtMilestoneInSeconds?.(6);
            setNotice(ok ? 'Test scheduled. Turn the screen off to check delivery. Permissions, sound settings and battery restrictions still apply; precise timing requires alarm permission.' : 'Test could not be scheduled. Check Android alarm permissions.');
          }}><Volume2 size={16} aria-hidden="true" /> Test in 6 seconds</button>
        </div>
        {status.error && <p role="status">{status.error}</p>}
      </> : <p>Screen-off OT reminders require the updated Android APK.</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
