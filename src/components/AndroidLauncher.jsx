import React, { useEffect, useMemo, useState } from 'react';

const LINK_KEY = 'pattan.android.serverUrl';

function normalizeServerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

export function isPackagedAndroidLauncher() {
  const nativeAndroid = Boolean(window.Capacitor?.isNativePlatform?.()) && window.Capacitor?.getPlatform?.() === 'android';
  return nativeAndroid && ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

export default function AndroidLauncher() {
  const staleLink = useMemo(() => new URLSearchParams(window.location.search).get('staleMobileLink') === '1', []);
  const [serverUrl, setServerUrl] = useState(() => staleLink ? '' : (localStorage.getItem(LINK_KEY) || ''));
  const [status, setStatus] = useState(() => staleLink
    ? 'The previous Mobile Link expired. Generate a new link on your computer and paste it here.'
    : 'Paste the secure Mobile Link shown by Pattan Presentator on your computer.');
  const [connecting, setConnecting] = useState(false);
  const validUrl = useMemo(() => normalizeServerUrl(serverUrl), [serverUrl]);

  const connect = async (urlValue = validUrl) => {
    const destination = normalizeServerUrl(urlValue);
    if (!destination) {
      setStatus('Enter a valid HTTPS Mobile Link or a local Wi-Fi address.');
      return;
    }
    setConnecting(true);
    setStatus('Connecting securely to your Pattan computer…');
    localStorage.setItem(LINK_KEY, destination);
    window.location.assign(destination);
  };

  useEffect(() => {
    if (staleLink) {
      localStorage.removeItem(LINK_KEY);
      window.history.replaceState({}, '', '/');
      return undefined;
    }
    if (!validUrl) return undefined;
    const timer = setTimeout(() => connect(validUrl), 900);
    return () => clearTimeout(timer);
  }, []); // Reconnect only while the remembered tunnel remains reachable.

  return (
    <main className="android-launcher">
      <style>{`
        html,body,#root{margin:0;min-height:100%;background:#070a12}.android-launcher{min-height:100vh;box-sizing:border-box;padding:28px;display:grid;place-items:center;background:radial-gradient(circle at 20% 0,#20366d 0,#101629 38%,#070a12 78%);font-family:Inter,system-ui,sans-serif;color:#fff}.android-card{width:min(100%,560px);padding:28px;box-sizing:border-box;border-radius:26px;background:#111827e8;border:1px solid #ffffff1c;box-shadow:0 30px 90px #0009}.android-logo{width:66px;height:66px;border-radius:20px;display:grid;place-items:center;background:linear-gradient(135deg,#fde68a,#d5aa58);color:#2b1b02;font-size:34px;box-shadow:0 16px 45px #d5aa5840}.android-card h1{font-size:28px;margin:20px 0 6px}.android-card p{margin:0 0 22px;color:#aebada;line-height:1.55}.android-card label{display:block;color:#dbeafe;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.android-card input{width:100%;box-sizing:border-box;margin:9px 0 14px;padding:15px;border-radius:14px;border:1px solid #ffffff24;background:#070b16;color:white;font:inherit;outline:none}.android-card input:focus{border-color:#67e8f9}.android-card button{width:100%;padding:15px;border:0;border-radius:14px;background:linear-gradient(135deg,#67e8f9,#60a5fa);color:#07111f;font-weight:950;font-size:16px}.android-card button:disabled{opacity:.45}.android-status{margin-top:16px;padding:12px;border-radius:12px;background:#0b1222;color:#aab6d8;font-size:13px;line-height:1.45}.android-points{display:grid;gap:9px;margin-top:20px;color:#bbf7d0;font-size:13px}.android-points span:before{content:'✓';margin-right:9px;color:#34d399;font-weight:900}
      `}</style>
      <section className="android-card">
        <div className="android-logo">P</div>
        <h1>Pattan Presentator</h1>
        <p>Native Android companion for your full-quality Windows AI studio.</p>
        <label htmlFor="pattan-server">Secure computer link</label>
        <input id="pattan-server" value={serverUrl} onChange={event => setServerUrl(event.target.value)} placeholder="https://…trycloudflare.com/?mobileToken=…" autoCapitalize="none" autoCorrect="off" inputMode="url" />
        <button type="button" disabled={!validUrl || connecting} onClick={() => connect()}>{connecting ? 'Connecting…' : 'Connect to Pattan Studio'}</button>
        <div className="android-status" role="status">{status}</div>
        <div className="android-points"><span>Maximum-quality processing stays on your computer</span><span>Uploads, live progress, stop/resume and downloads on mobile</span><span>The latest link is remembered for the next launch</span></div>
      </section>
    </main>
  );
}
