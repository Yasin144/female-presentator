import React, { useEffect, useMemo, useState } from 'react';
import OtSalary from './OtSalary/OtSalary.jsx';

const LINK_KEY = 'pattan.android.serverUrl';
const ANDROID_LAUNCH_MODE_KEY = 'pattan.android.launchMode';

if (typeof window !== 'undefined' && typeof window.workspaceSection === 'undefined') {
  window.workspaceSection = 'today';
}

function getActiveBuildMetadata() {
  let version = '8.2.15';
  let buildId = 'ota_8_2_15_fix_duplicate_100_credit_190_debit';
  try {
    if (
      typeof window !== 'undefined' &&
      window.PattanBiometric &&
      typeof window.PattanBiometric.getLiveOtaStatusJson === 'function'
    ) {
      const st = JSON.parse(window.PattanBiometric.getLiveOtaStatusJson() || '{}');
      if (st.version) version = String(st.version);
      if (st.buildId) buildId = String(st.buildId);
    }
    const lsVer = localStorage.getItem('pattan.ota.version');
    const lsBid = localStorage.getItem('pattan.ota.buildId');
    if (lsVer) version = lsVer;
    if (lsBid) buildId = lsBid;
  } catch (_) {}
  return { version, buildId };
}

class MobileOtErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      healStatus: '',
      aiHelpMessage: '',
      aiHelpScreenshotDataUrl: '',
      aiHelpScreenshotName: '',
      aiHelpSending: false,
      aiHelpSubmitted: false,
      aiHelpStatusText: '',
    };
    this.hotfixPollTimer = null;
  }
  static getDerivedStateFromError(error) {
    if (typeof window !== 'undefined' && typeof window.workspaceSection === 'undefined') {
      window.workspaceSection = 'today';
    }
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[MobileOtErrorBoundary] Caught error:', error, info);
    if (typeof window !== 'undefined') {
      window.workspaceSection = 'today';
    }
    this.tryAutoHealFromRemoteOta(false);
    this.startLiveHotfixPolling();
  }
  componentWillUnmount() {
    if (this.hotfixPollTimer) {
      clearInterval(this.hotfixPollTimer);
      this.hotfixPollTimer = null;
    }
  }
  startLiveHotfixPolling() {
    if (this.hotfixPollTimer) return;
    this.hotfixPollTimer = setInterval(() => {
      if (this.state.hasError) {
        this.tryAutoHealFromRemoteOta(false, true);
      }
    }, 5000);
  }
  async tryAutoHealFromRemoteOta(forceInstall = false, isSilentPoll = false) {
    try {
      if (!isSilentPoll) {
        this.setState({ healStatus: 'Checking GitHub for live OTA hotfix...' });
      }
      const { version: currentVer, buildId: currentBuildId } = getActiveBuildMetadata();
      const ts = Date.now();
      const bases = [
        'https://raw.githubusercontent.com/Yasin144/female-presentator/main/ota',
        'https://cdn.jsdelivr.net/gh/Yasin144/female-presentator@main/ota',
      ];
      let manifest = null;
      let activeBase = bases[0];
      for (const b of bases) {
        try {
          const mRes = await fetch(`${b}/ota-manifest.json?t=${ts}`, { cache: 'no-store' });
          if (mRes.ok) {
            manifest = await mRes.json();
            activeBase = b;
            break;
          }
        } catch (_) {}
      }
      if (manifest) {
        const remoteVer = String(manifest.version || '8.2.5');
        const remoteBuildId = String(manifest.buildId || '');
        const isNewerOrDifferent =
          forceInstall ||
          (remoteBuildId && remoteBuildId !== currentBuildId) ||
          (remoteVer && remoteVer !== currentVer);

        if (!isNewerOrDifferent) {
          if (!isSilentPoll) {
            this.setState({
              healStatus: `Current build v${currentVer} had a launch error. Submit to AI Help below or tap Force Reinstall OTA.`,
            });
          }
          return;
        }

        this.setState({ healStatus: `Downloading hotfix v${remoteVer} from GitHub...` });
        const [jsRes, cssRes] = await Promise.all([
          fetch(`${activeBase}/${manifest.jsFile || 'app-bundle.js'}?t=${ts}`, { cache: 'no-store' }),
          fetch(`${activeBase}/${manifest.cssFile || 'app-bundle.css'}?t=${ts}`, { cache: 'no-store' }),
        ]);
        if (jsRes.ok) {
          const jsText = await jsRes.text();
          const cssText = cssRes.ok ? await cssRes.text() : '';
          if (jsText && jsText.length > 1000) {
            if (window.PattanBiometric && typeof window.PattanBiometric.saveLiveOtaBundle === 'function') {
              window.PattanBiometric.saveLiveOtaBundle(remoteVer, remoteBuildId, jsText, cssText);
            }
            try {
              localStorage.setItem('pattan.ota.version', remoteVer);
              localStorage.setItem('pattan.ota.buildId', remoteBuildId);
            } catch (_) {}
            this.setState({ healStatus: `✅ Installed hotfix v${remoteVer}! Reloading app...` });
            setTimeout(() => window.location.reload(), 250);
            return;
          }
        }
      }
    } catch (_) {}
    if (!isSilentPoll) {
      this.setState({ healStatus: '' });
    }
  }
  handleSelectCrashScreenshot = (ev) => {
    const file = ev?.target?.files?.[0];
    if (!file) return;
    const fileName = String(file.name || 'crash-screenshot.jpg');
    const reader = new FileReader();
    reader.onload = () => {
      const rawDataUrl = String(reader.result || '');
      if (rawDataUrl) {
        this.setState({
          aiHelpScreenshotDataUrl: rawDataUrl,
          aiHelpScreenshotName: fileName,
        });
      }
    };
    reader.readAsDataURL(file);
  };
  submitCrashToAiHelp = async (ev) => {
    if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
    if (this.state.aiHelpSending) return;
    const { version, buildId } = getActiveBuildMetadata();
    const errText = String(this.state.error?.message || this.state.error || 'App Launch Failed');
    const stackText = String(this.state.error?.stack || '').slice(0, 500);
    const userNote = String(this.state.aiHelpMessage || '').trim();
    const combinedText = userNote
      ? `[CRASH REPORT v${version} (${buildId})] User Note: ${userNote} | Error: ${errText} | Stack: ${stackText}`
      : `[CRASH REPORT v${version} (${buildId})] Build/App Launch Failed: ${errText} | Stack: ${stackText}`;

    this.setState({
      aiHelpSending: true,
      aiHelpStatusText: '📡 Sending crash report & build details to AI Help...',
    });

    const nowMs = Date.now();
    const sugId = `crash_${nowMs}_${Math.random().toString(36).slice(2, 6)}`;
    const payload = {
      id: sugId,
      text: combinedText,
      accountEmail: 'patanyasin144@gmail.com',
      version,
      buildId,
      isCrashReport: true,
      errorMessage: errText,
      createdAt: new Date(nowMs).toISOString(),
      timestampMs: nowMs,
      hasScreenshot: Boolean(this.state.aiHelpScreenshotDataUrl),
      screenshotName: this.state.aiHelpScreenshotName || '',
      screenshotUrl: '',
      deliveredOnline: false,
      processedByAi: false,
      status: 'sending',
    };

    const relayHosts = [
      ['https://', 'nt', 'fy', '.envs.net'].join(''),
      ['https://', 'nt', 'fy', '.adminforge.de'].join(''),
      ['https://', 'nt', 'fy', '.mzte.de'].join(''),
      ['https://', 'nt', 'fy', '.', 'sh'].join(''),
    ];
    const relayTopic = 'yasin_salary_pro_suggestions_live_144';
    const mediaTopic = 'yasin_salary_pro_suggestions_live_144_media';
    let deliveredOnline = false;
    let uploadedScreenshotUrl = '';

    if (this.state.aiHelpScreenshotDataUrl) {
      try {
        const blobRes = await fetch(this.state.aiHelpScreenshotDataUrl);
        const blob = await blobRes.blob();
        const uploadResults = await Promise.allSettled(
          relayHosts.map(async (host) => {
            const upRes = await fetch(`${host}/${mediaTopic}`, {
              method: 'PUT',
              headers: {
                Filename: `${sugId}.jpg`,
                Title: `Crash Screenshot for ${sugId}`,
              },
              body: blob,
            });
            if (upRes && upRes.ok) {
              const upJson = await upRes.json();
              return String(upJson?.attachment?.url || '');
            }
            return '';
          })
        );
        for (const r of uploadResults) {
          if (r.status === 'fulfilled' && r.value) {
            uploadedScreenshotUrl = r.value;
            break;
          }
        }
      } catch (_) {}
    }

    try {
      const relayPayload = {
        ...payload,
        screenshotUrl: uploadedScreenshotUrl,
        syncedMultiRelayV2: true,
      };
      const bodyStr = JSON.stringify(relayPayload);
      const postResults = await Promise.allSettled(
        relayHosts.map(async (host) => {
          const res = await fetch(`${host}/${relayTopic}`, {
            method: 'POST',
            headers: {
              Title: `URGENT CRASH REPORT v${version} (patanyasin144@gmail.com)`,
              Priority: 'urgent',
              Tags: 'rotating_light,sos',
            },
            body: bodyStr,
          });
          return Boolean(res && res.ok);
        })
      );
      if (postResults.some((r) => r.status === 'fulfilled' && r.value === true)) {
        deliveredOnline = true;
      }
    } catch (_) {}

    try {
      const existingRaw = localStorage.getItem('yasin_ot_feature_suggestions_v1');
      const existingArr = existingRaw ? JSON.parse(existingRaw) : [];
      const nextArr = [
        { ...payload, screenshotUrl: uploadedScreenshotUrl, deliveredOnline, syncedMultiRelayV2: deliveredOnline, status: deliveredOnline ? 'ai_working' : 'queued_offline' },
        ...(Array.isArray(existingArr) ? existingArr : []),
      ].slice(0, 20);
      localStorage.setItem('yasin_ot_feature_suggestions_v1', JSON.stringify(nextArr));
    } catch (_) {}

    this.setState({
      aiHelpSending: false,
      aiHelpSubmitted: true,
      aiHelpMessage: '',
      aiHelpStatusText: deliveredOnline
        ? '✅ Sent to AI Help! AI is fixing this build now — your phone will auto-install the fix as soon as it is ready.'
        : '📡 Saved Crash Report! Will auto-send & install OTA fix as soon as internet connects.',
    });
    this.startLiveHotfixPolling();
  };
  render() {
    if (this.state.hasError) {
      const { version, buildId } = getActiveBuildMetadata();
      const errMsg = String(this.state.error?.message || this.state.error || 'Unexpected launch error');
      return (
        <div style={{
          minHeight: '100vh',
          background: '#070b16',
          color: '#f8fafc',
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          boxSizing: 'border-box',
        }}>
          <div style={{
            width: '100%',
            maxWidth: 460,
            padding: 20,
            borderRadius: 20,
            background: '#0f172a',
            border: '1.5px solid rgba(248, 113, 113, 0.5)',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.7)',
            textAlign: 'left',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, color: '#fca5a5', fontSize: 17, fontWeight: 900 }}>
                ⚠️ App Launch Failed — Recovery &amp; AI Help
              </h2>
              <span style={{
                padding: '3px 9px',
                borderRadius: 999,
                background: 'rgba(56, 189, 248, 0.16)',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                color: '#38bdf8',
                fontSize: 11,
                fontWeight: 900,
              }}>
                Build v{version}
              </span>
            </div>

            <div style={{
              padding: '10px 12px',
              borderRadius: 12,
              background: 'rgba(244, 63, 94, 0.12)',
              border: '1px solid rgba(244, 63, 94, 0.35)',
              color: '#fecdd3',
              fontSize: 12,
              lineHeight: 1.45,
              marginBottom: 12,
              wordBreak: 'break-word',
            }}>
              <strong>Error Details:</strong> {errMsg}
            </div>

            {this.state.healStatus && (
              <p style={{ margin: '0 0 12px', fontSize: 12, color: '#34d399', fontWeight: 800 }}>
                {this.state.healStatus}
              </p>
            )}

            {/* Quick Recovery Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => this.tryAutoHealFromRemoteOta(true, false)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 11,
                  border: '1px solid #34d399',
                  background: 'linear-gradient(135deg, #059669, #10b981)',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                ⚡ Install Latest OTA Fix
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    if (window.PattanBiometric && typeof window.PattanBiometric.clearLiveOtaBundle === 'function') {
                      window.PattanBiometric.clearLiveOtaBundle();
                    }
                    localStorage.removeItem('pattan.android.launchMode');
                  } catch (_) {}
                  window.location.reload();
                }}
                style={{
                  padding: '10px 12px',
                  borderRadius: 11,
                  border: '1px solid rgba(56, 189, 248, 0.5)',
                  background: '#0284c7',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                🔁 Reset to Safe Build
              </button>
            </div>

            {/* 🆘 AI SUBMIT TO REACH OUT HELP SECTION ON LAUNCH FAILED SCREEN */}
            <form
              onSubmit={this.submitCrashToAiHelp}
              style={{
                padding: 14,
                borderRadius: 15,
                background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.16), rgba(14, 165, 233, 0.14))',
                border: '1.5px solid rgba(99, 102, 241, 0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: 9,
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 900, color: '#e0e7ff' }}>
                🆘 AI Submit — Reach Out for Instant Fix
              </div>
              <div style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.4 }}>
                Send this launch error (Build v{version}) directly to your AI assistant so it can fix the bug and push an automatic OTA update to your phone:
              </div>
              <textarea
                rows={2}
                value={this.state.aiHelpMessage}
                onChange={(e) => this.setState({ aiHelpMessage: e.target.value })}
                placeholder="Optional note (e.g. 'App crashed on launch after update — please fix')"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '9px 11px',
                  borderRadius: 10,
                  border: '1px solid rgba(148, 163, 184, 0.35)',
                  background: '#070b16',
                  color: '#fff',
                  fontSize: 12.5,
                  fontFamily: 'inherit',
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{
                  padding: '8px 11px',
                  borderRadius: 10,
                  border: '1px solid rgba(148, 163, 184, 0.35)',
                  background: 'rgba(15, 23, 42, 0.85)',
                  color: '#e2e8f0',
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}>
                  📷 {this.state.aiHelpScreenshotName ? 'Screenshot Added ✓' : 'Attach Screenshot'}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={this.handleSelectCrashScreenshot}
                    style={{ display: 'none' }}
                  />
                </label>
                <button
                  type="submit"
                  disabled={this.state.aiHelpSending}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'linear-gradient(135deg, #4f46e5, #0284c7)',
                    color: '#fff',
                    fontWeight: 900,
                    fontSize: 12.5,
                    cursor: this.state.aiHelpSending ? 'wait' : 'pointer',
                    boxShadow: '0 8px 20px rgba(79, 70, 229, 0.4)',
                  }}
                >
                  {this.state.aiHelpSending ? '⏳ Sending to AI...' : '🚀 Submit to AI Help Now'}
                </button>
              </div>
              {this.state.aiHelpStatusText && (
                <div style={{
                  marginTop: 4,
                  padding: '8px 10px',
                  borderRadius: 9,
                  background: 'rgba(16, 185, 129, 0.16)',
                  border: '1px solid rgba(16, 185, 129, 0.45)',
                  color: '#6ee7b7',
                  fontSize: 11.5,
                  fontWeight: 800,
                  lineHeight: 1.4,
                }}>
                  {this.state.aiHelpStatusText}
                </div>
              )}
            </form>

            {/* End of Recovery Screen Build Version Footer */}
            <div style={{
              marginTop: 14,
              paddingTop: 10,
              borderTop: '1px solid rgba(148, 163, 184, 0.2)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 11,
              color: '#94a3b8',
              fontWeight: 700,
              flexWrap: 'wrap',
              gap: 6,
            }}>
              <span>Build Version: v{version}</span>
              <span>ID: {buildId}</span>
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
