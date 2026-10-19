import React, { useEffect, useMemo, useState } from 'react';
import OtSalary from './OtSalary/OtSalary.jsx';

const LINK_KEY = 'pattan.android.serverUrl';
const ANDROID_LAUNCH_MODE_KEY = 'pattan.android.launchMode';

class MobileOtErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[MobileOtErrorBoundary] Caught error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          background: '#070b16',
          color: '#f8fafc',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textAlign: 'center',
        }}>
          <div style={{
            maxWidth: 460,
            padding: 24,
            borderRadius: 18,
            background: '#0f172a',
            border: '1px solid rgba(248, 113, 113, 0.45)',
          }}>
            <h2 style={{ margin: '0 0 8px', color: '#fca5a5', fontSize: 18 }}>
              ⚠️ OT &amp; Salary Mobile App Recovery
            </h2>
            <p style={{ margin: '0 0 14px', fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 }}>
              {String(this.state.error?.message || this.state.error || 'Unexpected error')}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: '1px solid #34d399',
                  background: '#059669',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                🔄 Retry OT App
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem('pattan.android.launchMode');
                  } catch (_) {}
                  window.location.reload();
                }}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: '1px solid rgba(56, 189, 248, 0.5)',
                  background: '#0284c7',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                🔁 Reload App
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  if (typeof window === 'undefined') return false;
  const cap = window.Capacitor;
  const isCapAndroid =
    (typeof cap?.isNativePlatform === 'function' ? Boolean(cap.isNativePlatform()) : Boolean(cap?.isNativePlatform)) ||
    (typeof cap?.getPlatform === 'function' && cap.getPlatform() === 'android') ||
    cap?.platform === 'android';
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const isAndroidWebViewLocal =
    isLocalHost &&
    !window.location.port &&
    /Android/i.test(navigator.userAgent || '');
  return (isCapAndroid && isLocalHost) || isAndroidWebViewLocal;
}

export { MobileOtErrorBoundary };

export default function AndroidLauncher() {
  const staleLink = useMemo(() => new URLSearchParams(window.location.search).get('staleMobileLink') === '1', []);
  const [activeApp, setActiveApp] = useState(() => {
    if (staleLink) return 'ot-salary';
    try {
      return localStorage.getItem(ANDROID_LAUNCH_MODE_KEY) === 'launcher' ? 'launcher' : 'ot-salary';
    } catch (_) {
      return 'ot-salary';
    }
  });
  const [serverUrl, setServerUrl] = useState(() => {
    if (staleLink) return '';
    try {
      return localStorage.getItem(LINK_KEY) || '';
    } catch (_) {
      return '';
    }
  });
  const [status, setStatus] = useState(() => staleLink
    ? 'The previous Mobile Link expired. Returned to your offline OT & Salary Mobile App.'
    : 'Paste the secure Mobile Link shown by Pattan Workspace on your computer, or open the standalone OT & Salary Mobile App below.');
  const [connecting, setConnecting] = useState(false);
  const validUrl = useMemo(() => normalizeServerUrl(serverUrl), [serverUrl]);

  const openOtMobileApp = () => {
    try {
      localStorage.setItem(ANDROID_LAUNCH_MODE_KEY, 'ot-salary');
      if (validUrl) {
        const parsed = new URL(validUrl);
        localStorage.setItem('pattan.ot.syncServerUrl', `${parsed.protocol}//${parsed.host}`);
      }
    } catch (_) {}
    setActiveApp('ot-salary');
  };

  const backToAndroidLauncher = () => {
    try {
      localStorage.setItem(ANDROID_LAUNCH_MODE_KEY, 'launcher');
    } catch (_) {}
    setActiveApp('launcher');
  };

  const connect = async (urlValue = validUrl) => {
    const destination = normalizeServerUrl(urlValue);
    if (!destination) {
      setStatus('Enter a valid HTTPS Mobile Link or a local Wi-Fi address.');
      return;
    }
    setConnecting(true);
    setStatus('Connecting securely to your Pattan computer…');
    try {
      localStorage.setItem(LINK_KEY, destination);
    } catch (_) {}
    window.location.assign(destination);
  };

  useEffect(() => {
    if (staleLink) {
      try {
        localStorage.removeItem(LINK_KEY);
        localStorage.setItem(ANDROID_LAUNCH_MODE_KEY, 'ot-salary');
      } catch (_) {}
      window.history.replaceState({}, '', '/');
    }
  }, [staleLink]);

  if (activeApp === 'ot-salary') {
    return (
      <MobileOtErrorBoundary>
        <OtSalary standaloneMobile={true} onClose={backToAndroidLauncher} />
      </MobileOtErrorBoundary>
    );
  }

  return (
    <main className="android-launcher">
      <style>{`
        html,body,#root{margin:0;min-height:100%;background:#070a12}.android-launcher{min-height:100vh;box-sizing:border-box;padding:28px;display:grid;place-items:center;background:radial-gradient(circle at 20% 0,#20366d 0,#101629 38%,#070a12 78%);font-family:Inter,system-ui,sans-serif;color:#fff}.android-card{width:min(100%,560px);padding:28px;box-sizing:border-box;border-radius:26px;background:#111827e8;border:1px solid #ffffff1c;box-shadow:0 30px 90px #0009}.android-logo{width:66px;height:66px;border-radius:20px;display:grid;place-items:center;background:linear-gradient(135deg,#fde68a,#d5aa58);color:#2b1b02;font-size:34px;box-shadow:0 16px 45px #d5aa5840}.android-card h1{font-size:28px;margin:20px 0 6px}.android-card p{margin:0 0 22px;color:#aebada;line-height:1.55}.android-card label{display:block;color:#dbeafe;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.android-card input{width:100%;box-sizing:border-box;margin:9px 0 14px;padding:15px;border-radius:14px;border:1px solid #ffffff24;background:#070b16;color:white;font:inherit;outline:none}.android-card input:focus{border-color:#67e8f9}.android-card button{width:100%;padding:15px;border:0;border-radius:14px;background:linear-gradient(135deg,#67e8f9,#60a5fa);color:#07111f;font-weight:950;font-size:16px}.android-card button:disabled{opacity:.45}.android-status{margin-top:16px;padding:12px;border-radius:12px;background:#0b1222;color:#aab6d8;font-size:13px;line-height:1.45}.android-points{display:grid;gap:9px;margin-top:20px;color:#bbf7d0;font-size:13px}.android-points span:before{content:'✓';margin-right:9px;color:#34d399;font-weight:900}
      `}</style>
      <section className="android-card">
        <div className="android-logo">P</div>
        <h1>Pattan Workspace</h1>
        <p>Native Android companion for your full-quality Windows AI studio, offline OT Salary Tracker &amp; Auto Mobile Expenses Ledger.</p>

        <button
          type="button"
          onClick={openOtMobileApp}
          style={{
            marginBottom: 18,
            background: 'linear-gradient(135deg, #10b981, #0284c7)',
            color: '#fff',
            boxShadow: '0 12px 28px rgba(16, 185, 129, 0.32)',
            cursor: 'pointer',
          }}
        >
          ⏱️💸 Open OT, Salary &amp; Mobile Expenses App (100% Offline + Sync)
        </button>

        <label htmlFor="pattan-server">Secure computer link</label>
        <input id="pattan-server" value={serverUrl} onChange={event => setServerUrl(event.target.value)} placeholder="https://…trycloudflare.com/?mobileToken=…" autoCapitalize="none" autoCorrect="off" inputMode="url" />
        <button type="button" disabled={!validUrl || connecting} onClick={() => connect()}>{connecting ? 'Connecting…' : 'Connect to Pattan Workspace'}</button>
        <div className="android-status" role="status">{status}</div>
        <div className="android-points"><span>OT &amp; Salary + Auto Mobile Expenses (SMS/UPI/Notes) run 100% offline + sync with PC</span><span>Maximum-quality processing stays on your computer</span><span>Uploads, live progress, stop/resume and downloads on mobile</span></div>
      </section>
    </main>
  );
}
