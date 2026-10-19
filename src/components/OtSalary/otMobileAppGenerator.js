// Generates a 100% self-contained, offline-capable single-file Mobile App HTML
// for the OT & Salary Tracker module. Can be saved directly to any Android/iOS
// phone, shared over WhatsApp, or installed to the Home Screen, and supports
// both 100% offline localStorage and 1-tap Wi-Fi sync with the Pattan PC.

export function buildStandaloneOtMobileAppHtml(initialState = {}, defaultSyncUrl = '') {
  const safeInitialJson = JSON.stringify({
    settings: initialState.settings || {},
    days: initialState.days || {},
    expenses: initialState.expenses || {},
    syncUrl: defaultSyncUrl || '',
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <meta name="theme-color" content="#070b16" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="OT, Salary & Expenses" />
  <title>OT, Salary &amp; Expenses Pro Mobile App</title>
  <style>
    :root {
      --bg: #070b16;
      --card: #0f172a;
      --card-dark: #090d16;
      --border: rgba(148, 163, 184, 0.22);
      --emerald: #10b981;
      --emerald-light: #34d399;
      --sky: #38bdf8;
      --gold: #facc15;
      --text: #f8fafc;
      --muted: #94a3b8;
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body {
      margin: 0;
      padding: 0;
      min-height: 100%;
      background: linear-gradient(180deg, #070b16 0%, #0b1120 100%);
      color: var(--text);
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    }
    body { padding-bottom: 86px; }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(9, 13, 22, 0.94);
      backdrop-filter: blur(14px);
      border-bottom: 1px solid rgba(52, 211, 153, 0.3);
      padding: 12px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .topbar-title { font-size: 15px; font-weight: 900; color: #fff; }
    .topbar-sub { font-size: 11px; color: #6ee7b7; font-weight: 700; }
    .container { max-width: 640px; margin: 0 auto; padding: 12px 12px 24px; display: flex; flex-direction: column; gap: 12px; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 14px;
      box-shadow: 0 10px 26px rgba(0,0,0,0.32);
    }
    .kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
    .kpi {
      padding: 11px 12px;
      border-radius: 13px;
      background: var(--card);
      border: 1px solid var(--border);
    }
    .kpi-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    .kpi-val { font-size: 19px; font-weight: 900; margin-top: 4px; }
    .kpi-sub { font-size: 10.5px; color: var(--muted); margin-top: 2px; font-weight: 600; }
    .punch-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
    @keyframes bioPulse {
      0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.45); }
      70% { box-shadow: 0 0 0 10px rgba(52, 211, 153, 0); }
      100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); }
    }
    .bio-hub {
      background: linear-gradient(145deg, rgba(6, 22, 42, 0.98), rgba(4, 47, 46, 0.82));
      border: 1.5px solid rgba(52, 211, 153, 0.6);
      border-radius: 18px;
      padding: 14px;
      margin-bottom: 14px;
      box-shadow: 0 14px 32px rgba(0, 0, 0, 0.42);
    }
    .bio-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
    .bio-pad {
      border-radius: 15px;
      padding: 14px 10px;
      text-align: center;
      cursor: pointer;
      user-select: none;
      transition: transform 0.14s ease, box-shadow 0.2s ease;
    }
    .bio-pad:active { transform: scale(0.96); }
    .bio-pad-in {
      border: 1.5px solid rgba(56, 189, 248, 0.72);
      background: linear-gradient(145deg, rgba(2, 132, 199, 0.3), rgba(9, 13, 22, 0.95));
      box-shadow: 0 8px 20px rgba(2, 132, 199, 0.2);
    }
    .bio-pad-out {
      border: 1.5px solid rgba(52, 211, 153, 0.72);
      background: linear-gradient(145deg, rgba(16, 185, 129, 0.3), rgba(9, 13, 22, 0.95));
      box-shadow: 0 8px 20px rgba(16, 185, 129, 0.2);
    }
    .bio-pad-auto {
      margin-top: 10px;
      border: 2px solid rgba(250, 204, 21, 0.75);
      background: radial-gradient(circle at 50% 30%, rgba(16, 185, 129, 0.3), rgba(9, 13, 22, 0.96));
      animation: bioPulse 2.6s infinite;
    }
    .bio-ring {
      width: 48px;
      height: 48px;
      margin: 0 auto 6px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }
    .btn {
      border: none;
      border-radius: 11px;
      padding: 11px 12px;
      font-weight: 900;
      font-size: 13px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      color: #fff;
    }
    .btn-in { background: linear-gradient(135deg, #0284c7, #2563eb); box-shadow: 0 6px 18px rgba(2,132,199,0.32); }
    .btn-out { background: linear-gradient(135deg, #10b981, #059669); box-shadow: 0 6px 18px rgba(16,185,129,0.32); }
    .btn-save { width: 100%; padding: 13px; font-size: 14px; background: linear-gradient(135deg, #10b981, #0284c7); }
    .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-bottom: 10px; }
    label.lbl { display: block; font-size: 11px; font-weight: 800; color: #cbd5e1; margin-bottom: 4px; }
    input, select {
      width: 100%;
      padding: 9px 10px;
      border-radius: 9px;
      border: 1px solid rgba(148,163,184,0.32);
      background: var(--card-dark);
      color: #fff;
      font-weight: 800;
      font-size: 13px;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .chip {
      padding: 6px 10px;
      border-radius: 8px;
      border: 1px solid rgba(148,163,184,0.25);
      background: rgba(255,255,255,0.04);
      color: #cbd5e1;
      font-size: 11.5px;
      font-weight: 800;
      cursor: pointer;
    }
    .chip.active {
      border-color: #34d399;
      background: rgba(16,185,129,0.26);
      color: #ecfdf5;
    }
    .day-card {
      padding: 11px 12px;
      border-radius: 12px;
      background: var(--card-dark);
      border: 1px solid rgba(148,163,184,0.18);
      margin-bottom: 8px;
    }
    .day-card.ot { border-color: rgba(52,211,153,0.45); background: rgba(16,185,129,0.07); }
    .bottom-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 60;
      background: rgba(9, 13, 22, 0.96);
      backdrop-filter: blur(16px);
      border-top: 1px solid rgba(148,163,184,0.22);
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      padding: 6px 6px calc(6px + env(safe-area-inset-bottom, 0px));
    }
    .nav-btn {
      background: transparent;
      border: none;
      color: var(--muted);
      padding: 6px 2px;
      border-radius: 10px;
      font-size: 10.5px;
      font-weight: 800;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      cursor: pointer;
    }
    .nav-btn.active { color: #34d399; background: rgba(16,185,129,0.12); }
    .toast {
      position: fixed;
      top: 64px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 80;
      background: #065f46;
      border: 1px solid #34d399;
      color: #ecfdf5;
      padding: 8px 14px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 800;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      display: none;
    }
  </style>
</head>
<body>
  <div id="toast" class="toast"></div>
  <header class="topbar" style="padding:14px 16px;background:linear-gradient(135deg,#0b132b 0%,#060a17 55%,#0f172a 100%);border-bottom:1.5px solid rgba(250,204,21,0.42);box-shadow:0 12px 32px rgba(0,0,0,0.5);">
    <div style="display:flex;align-items:center;gap:11px;">
      <button type="button" class="chip" id="topBackBtn" style="display:none;border-color:#38bdf8;color:#e0f2fe;">← Back</button>
      <div style="width:42px;height:42px;border-radius:14px;background:radial-gradient(circle,rgba(250,204,21,0.22),rgba(15,23,42,0.92));border:1px solid rgba(250,204,21,0.5);box-shadow:0 0 18px rgba(250,204,21,0.2);display:flex;align-items:center;justify-content:center;">
        <svg width="28" height="28" viewBox="0 0 64 64" fill="none">
          <path d="M18 28 C18 19.5 24.3 13 32 13 C39.7 13 46 19.5 46 28 C46 35 44 41 40.5 46.5" stroke="#facc15" stroke-width="2.6" stroke-linecap="round"/>
          <path d="M22.5 29 C22.5 22.8 26.8 18 32 18 C37.2 18 41.5 22.8 41.5 29 C41.5 36.2 38.8 42.5 34.5 48.5" stroke="#fde047" stroke-width="2.6" stroke-linecap="round"/>
          <path d="M27 30 C27 26.2 29.2 23.5 32 23.5 C34.8 23.5 37 26.2 37 30 C37 36.8 34.2 43 29.5 49" stroke="#34d399" stroke-width="2.6" stroke-linecap="round"/>
          <path d="M32 29 C32 35.5 29.5 41.5 24.5 46.5" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round"/>
        </svg>
      </div>
      <div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:9px;font-weight:900;letter-spacing:0.15em;text-transform:uppercase;color:#fde047;">EXECUTIVE ATTENDANCE &amp; EXPENSES</span>
          <span style="padding:1.5px 6px;border-radius:999px;background:rgba(16,185,129,0.22);border:1px solid rgba(52,211,153,0.5);color:#6ee7b7;font-size:9px;font-weight:900;">● LIVE SYNC</span>
        </div>
        <div class="topbar-title" style="font-size:18px;font-weight:950;letter-spacing:-0.02em;color:#fff;margin-top:1px;">OT, SALARY &amp; EXPENSES PRO</div>
        <div class="topbar-sub" id="hdrRateSub">₹25,000/mo · 10:00 AM – 06:30 PM</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;">
      <input type="month" id="monthPicker" style="width:auto;padding:6px 8px;font-size:12px;" />
      <button type="button" class="chip active" id="waShareBtn" title="Share on WhatsApp">📲 Share</button>
    </div>
  </header>

  <main class="container">
    <!-- TOP FLAGSHIP MODULE SWITCHER: OT & SALARY vs EXPENSES -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:6px;border-radius:16px;background:rgba(9,13,22,0.95);border:1px solid rgba(148,163,184,0.22);">
      <button type="button" id="topModOtBtn" style="padding:10px 12px;border-radius:12px;border:1.5px solid #34d399;background:linear-gradient(135deg,rgba(16,185,129,0.25),rgba(14,165,233,0.2));color:#ecfdf5;font-weight:900;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
        <span>⏱️</span><span>OT &amp; SALARY</span>
      </button>
      <button type="button" id="topModExpBtn" style="padding:10px 12px;border-radius:12px;border:1px solid transparent;background:transparent;color:#94a3b8;font-weight:900;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
        <span>💸</span><span>EXPENSES</span>
        <span id="topModExpBadge" style="padding:1px 7px;border-radius:999px;background:rgba(244,63,94,0.25);border:1px solid rgba(251,113,133,0.5);color:#fda4af;font-size:10px;font-weight:900;">0</span>
      </button>
    </div>
    <!-- LUXURY HERO SALARY VAULT WITH INLINE EDITABLE SALARY -->
    <div class="card" style="padding:16px;border-radius:20px;border:1px solid rgba(250,204,21,0.42);background:linear-gradient(135deg,rgba(15,23,42,0.96),rgba(9,13,22,0.98));box-shadow:0 16px 36px rgba(0,0,0,0.5);">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="font-size:10.5px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;color:#fde047;">💎 Total Net Salary Receivable</div>
          <div style="font-size:28px;font-weight:900;color:#fff;margin-top:4px;letter-spacing:-0.02em;" id="kpiNetPay">₹25,000.00</div>
          <div class="kpi-sub" id="kpiSavedSub" style="color:#94a3b8;">0 days saved</div>
        </div>
        <!-- Inline Editable Monthly Salary Box -->
        <div style="padding:8px 11px;border-radius:14px;background:rgba(250,204,21,0.1);border:1.5px solid rgba(250,204,21,0.45);min-width:155px;">
          <div style="font-size:9.5px;font-weight:900;color:#fde047;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px;">✏️ Monthly Salary</div>
          <div style="display:flex;align-items:center;gap:4px;">
            <span style="font-size:16px;font-weight:900;color:#facc15;">₹</span>
            <input type="number" id="heroSalaryInput" min="1000" step="500" value="25000" style="padding:4px 6px;font-size:16px;font-weight:900;color:#fff;background:rgba(2,6,23,0.75);border:1px solid rgba(250,204,21,0.4);border-radius:8px;width:105px;" />
          </div>
        </div>
      </div>

      <div class="kpi-grid" style="margin-top:12px;">
        <div class="kpi" style="border-color:rgba(52,211,153,0.45);background:rgba(16,185,129,0.1);">
          <div class="kpi-label" style="color:#6ee7b7;">⚡ Extra OT Earned</div>
          <div class="kpi-val" style="color:#34d399;font-size:17px;" id="kpiOtPay">+ ₹0.00</div>
          <div class="kpi-sub" id="kpiOtTime">0 hr 00 min OT</div>
        </div>
        <div class="kpi" style="border-color:rgba(56,189,248,0.4);background:rgba(14,165,233,0.1);">
          <div class="kpi-label" style="color:#7dd3fc;">📈 Per-Day &amp; OT Rate</div>
          <div class="kpi-val" style="color:#e0f2fe;font-size:16px;" id="kpiPerDayVal">₹833.33/d</div>
          <div class="kpi-sub" id="kpiOtRateSub" style="color:#bae6fd;">OT: ₹98.04/hr</div>
        </div>
      </div>
    </div>

    <!-- TAB 1: TOUCH ID BIOMETRIC SCANNER STUDIO & TODAY PUNCH -->
    <section id="tab-today" class="card" style="border-radius:20px;">
      <!-- LIVE TICKING CHRONOMETER CLOCK DISPLAY -->
      <div id="liveClockWidget" style="padding:12px 14px;border-radius:16px;background:linear-gradient(135deg,rgba(2,6,23,0.94),rgba(15,23,42,0.96));border:1.5px solid rgba(56,189,248,0.45);box-shadow:0 10px 24px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:44px;height:44px;border-radius:50%;background:radial-gradient(circle,rgba(14,165,233,0.22),rgba(2,6,23,0.95));border:1.5px solid rgba(56,189,248,0.6);display:flex;align-items:center;justify-content:center;">
            <svg width="38" height="38" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="19" fill="none" stroke="rgba(148,163,184,0.25)" stroke-width="1.2" stroke-dasharray="2 3" />
              <line id="analogHrHand" x1="22" y1="22" x2="22" y2="11" stroke="#f8fafc" stroke-width="2.4" stroke-linecap="round" />
              <line id="analogMinHand" x1="22" y1="22" x2="22" y2="7.5" stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round" />
              <line id="analogSecHand" x1="22" y1="24" x2="22" y2="6" stroke="#34d399" stroke-width="1.3" stroke-linecap="round" />
              <circle cx="22" cy="22" r="2.4" fill="#facc15" />
            </svg>
          </div>
          <div>
            <div style="font-size:9.5px;font-weight:900;letter-spacing:0.1em;text-transform:uppercase;color:#7dd3fc;" id="liveClockDate">LIVE EXACT OFFICE CLOCK</div>
            <div style="display:flex;align-items:baseline;gap:5px;font-family:monospace;margin-top:2px;">
              <span id="liveClockHM" style="font-size:25px;font-weight:900;color:#fff;letter-spacing:0.03em;">10:00</span>
              <span id="liveClockSS" style="font-size:17px;font-weight:900;color:#34d399;">:00</span>
              <span id="liveClockPeriod" style="padding:2px 6px;border-radius:5px;background:rgba(250,204,21,0.18);border:1px solid rgba(250,204,21,0.45);color:#fde047;font-size:11px;font-weight:900;">AM</span>
            </div>
          </div>
        </div>
        <span id="daySavedBadge" style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;"></span>
      </div>

      <!-- BIOMETRIC TOUCH SENSOR (IN & OUT) SCANNER HUB -->
      <div class="bio-hub" style="border-radius:18px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
          <div style="font-size:13px;font-weight:900;color:#ecfdf5;">Biometric Touch Sensor (IN &amp; OUT)</div>
          <span id="bioStatusBadge" style="font-size:10.5px;font-weight:800;color:#6ee7b7;background:rgba(16,185,129,0.24);border:1px solid rgba(52,211,153,0.5);padding:3px 9px;border-radius:999px;">🟢 IN &amp; OUT Ready</span>
        </div>
        <div class="bio-grid">
          <div class="bio-pad bio-pad-in" id="bioTouchInBtn" style="padding:18px 10px;border-radius:20px;">
            <div style="font-size:9.5px;font-weight:900;letter-spacing:0.12em;color:#7dd3fc;text-transform:uppercase;margin-bottom:8px;">OFFICE ENTRY</div>
            <div style="width:64px;height:64px;margin:0 auto 8px;border-radius:50%;background:radial-gradient(circle,rgba(56,189,248,0.28),rgba(2,6,23,0.92));border:2px solid #38bdf8;box-shadow:0 0 22px rgba(56,189,248,0.35);display:flex;align-items:center;justify-content:center;">
              <svg width="40" height="40" viewBox="0 0 64 64" fill="none">
                <path d="M18 28 C18 19.5 24.3 13 32 13 C39.7 13 46 19.5 46 28 C46 35 44 41 40.5 46.5" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round"/>
                <path d="M15 34 C15.8 39.5 18 44.5 21.5 48.5" stroke="#7dd3fc" stroke-width="2.6" stroke-linecap="round"/>
                <path d="M22.5 29 C22.5 22.8 26.8 18 32 18 C37.2 18 41.5 22.8 41.5 29 C41.5 36.2 38.8 42.5 34.5 48.5" stroke="#bae6fd" stroke-width="2.6" stroke-linecap="round"/>
                <path d="M27 30 C27 26.2 29.2 23.5 32 23.5 C34.8 23.5 37 26.2 37 30 C37 36.8 34.2 43 29.5 49" stroke="#38bdf8" stroke-width="2.6" stroke-linecap="round"/>
                <path d="M32 29 C32 35.5 29.5 41.5 24.5 46.5" stroke="#7dd3fc" stroke-width="2.6" stroke-linecap="round"/>
              </svg>
            </div>
            <div style="font-size:22px;font-weight:950;color:#fff;letter-spacing:0.06em;">IN</div>
            <div id="bioInStatusSub" style="font-size:11.5px;color:#e0f2fe;font-weight:800;margin-top:4px;">IN · 10:00 AM</div>
          </div>
          <div class="bio-pad bio-pad-out" id="bioTouchOutBtn" style="padding:18px 10px;border-radius:20px;">
            <div style="font-size:9.5px;font-weight:900;letter-spacing:0.12em;color:#6ee7b7;text-transform:uppercase;margin-bottom:8px;">OFFICE EXIT + OT</div>
            <div style="width:64px;height:64px;margin:0 auto 8px;border-radius:50%;background:radial-gradient(circle,rgba(16,185,129,0.3),rgba(2,6,23,0.92));border:2px solid #34d399;box-shadow:0 0 22px rgba(16,185,129,0.35);display:flex;align-items:center;justify-content:center;">
              <svg width="40" height="40" viewBox="0 0 64 64" fill="none">
                <path d="M18 28 C18 19.5 24.3 13 32 13 C39.7 13 46 19.5 46 28 C46 35 44 41 40.5 46.5" stroke="#10b981" stroke-width="2.6" stroke-linecap="round"/>
                <path d="M15 34 C15.8 39.5 18 44.5 21.5 48.5" stroke="#34d399" stroke-width="2.6" stroke-linecap="round"/>
                <path d="M22.5 29 C22.5 22.8 26.8 18 32 18 C37.2 18 41.5 22.8 41.5 29 C41.5 36.2 38.8 42.5 34.5 48.5" stroke="#6ee7b7" stroke-width="2.6" stroke-linecap="round"/>
                <path d="M27 30 C27 26.2 29.2 23.5 32 23.5 C34.8 23.5 37 26.2 37 30 C37 36.8 34.2 43 29.5 49" stroke="#10b981" stroke-width="2.6" stroke-linecap="round"/>
                <path d="M32 29 C32 35.5 29.5 41.5 24.5 46.5" stroke="#34d399" stroke-width="2.6" stroke-linecap="round"/>
              </svg>
            </div>
            <div style="font-size:22px;font-weight:950;color:#fff;letter-spacing:0.06em;">OUT</div>
            <div id="bioOutStatusSub" style="font-size:11.5px;color:#d1fae5;font-weight:800;margin-top:4px;">OUT · 06:30 PM</div>
          </div>
        </div>
      </div>

      <div id="liveBreakdownBox" style="padding:12px;border-radius:14px;background:var(--card-dark);border:1px solid rgba(52,211,153,0.35);margin-bottom:12px;font-size:12.5px;line-height:1.6;"></div>

      <div style="margin-bottom:12px;">
        <label class="lbl">⚡ 1-Tap Extra OT Presets (Auto-sets Exit Time &amp; Saves):</label>
        <div class="chips" id="otPresetChips">
          <button type="button" class="chip" data-ot="0">0h (6:30 PM)</button>
          <button type="button" class="chip" data-ot="0.5">+30m (7:00 PM)</button>
          <button type="button" class="chip" data-ot="1">+1h (7:30 PM)</button>
          <button type="button" class="chip" data-ot="1.5">+1.5h (8:00 PM)</button>
          <button type="button" class="chip" data-ot="2">+2h (8:30 PM)</button>
          <button type="button" class="chip" data-ot="3">+3h (9:30 PM)</button>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <button type="button" class="chip" id="toggleManualEditorBtn" style="width:100%;padding:9px;text-align:center;">✏️ Manual Time &amp; Date Override ▼</button>
      </div>

      <div id="manualEditorDrawer" style="display:none;padding:12px;border-radius:14px;background:rgba(2,6,23,0.65);border:1px solid rgba(148,163,184,0.22);margin-bottom:10px;">
        <div class="row-2">
          <div>
            <label class="lbl">Work Date</label>
            <input type="date" id="entryDate" />
          </div>
          <div>
            <label class="lbl">Attendance Status</label>
            <select id="entryStatus">
              <option value="present">Present (Full Day)</option>
              <option value="half">Half Day (50%)</option>
              <option value="holiday_paid">Sunday / Paid Off</option>
              <option value="ot_only">Extra Work Only (OT)</option>
              <option value="leave">Leave (Unpaid)</option>
            </select>
          </div>
        </div>

        <div class="row-2">
          <div>
            <label class="lbl" style="color:#7dd3fc;">🟢 Enter Time (In)</label>
            <input type="time" id="entryInTime" value="10:00" />
            <div id="inTime12Label" style="font-size:11px;color:#7dd3fc;margin-top:3px;font-weight:800;">10:00 AM</div>
          </div>
          <div>
            <label class="lbl" style="color:#6ee7b7;">🔴 Exit Time (Out)</label>
            <input type="time" id="entryOutTime" value="18:30" />
            <div id="outTime12Label" style="font-size:11px;color:#6ee7b7;margin-top:3px;font-weight:800;">06:30 PM</div>
          </div>
        </div>

        <div class="row-2">
          <div>
            <label class="lbl">Extra Bonus / Allowance (₹)</label>
            <input type="number" id="entryBonus" min="0" step="10" value="0" />
          </div>
          <div>
            <label class="lbl">Work Note</label>
            <input type="text" id="entryNote" placeholder="Optional note..." />
          </div>
        </div>

        <button type="button" class="btn btn-save" id="saveDayBtn">💾 Save Day Calculation</button>
      </div>
    </section>

    <!-- TAB EXPENSES: EXPENSE MEMORY — FRIENDLY MONEY HOME & TRANSACTION LEDGER -->
    <section id="tab-expenses" class="card" style="display:none;border-color:rgba(244,63,94,0.45);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <div>
          <div style="font-size:10px;font-weight:900;letter-spacing:0.12em;text-transform:uppercase;color:#fda4af;">💸 EXPENSE MEMORY • PERSONAL FINANCE ASSISTANT</div>
          <div style="font-size:16px;font-weight:900;color:#fff;margin-top:2px;">Let's check your money.</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="chip active" id="expScanMobileBtn" style="border-color:#fbbf24;background:rgba(245,158,11,0.22);color:#fef3c7;">📲 Auto-Scan Mobile SMS</button>
          <button type="button" class="chip" id="expExportCsvBtn" style="border-color:rgba(56,189,248,0.45);color:#7dd3fc;">📥 Export CSV</button>
        </div>
      </div>

      <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:12px;">
        <div class="kpi" style="border-color:rgba(244,63,94,0.45);background:rgba(244,63,94,0.1);">
          <div class="kpi-label" style="color:#fda4af;">💸 Net Spending</div>
          <div class="kpi-val" style="color:#fff;font-size:15px;" id="expKpiTotalSpent">₹0.00</div>
          <div class="kpi-sub" id="expKpiTodaySpent" style="color:#fecdd3;">Today: ₹0.00</div>
        </div>
        <div class="kpi" style="border-color:rgba(52,211,153,0.45);background:rgba(16,185,129,0.1);">
          <div class="kpi-label" style="color:#6ee7b7;">💰 Received</div>
          <div class="kpi-val" style="color:#34d399;font-size:15px;" id="expKpiTotalRecv">₹0.00</div>
          <div class="kpi-sub" id="expKpiRefundSub" style="color:#a7f3d0;">Refunds: ₹0.00</div>
        </div>
        <div class="kpi" style="border-color:rgba(56,189,248,0.45);background:rgba(14,165,233,0.1);">
          <div class="kpi-label" style="color:#7dd3fc;">🔢 Transactions</div>
          <div class="kpi-val" style="color:#fff;font-size:15px;" id="expKpiTotalCount">0 Done</div>
          <div class="kpi-sub" id="expKpiTodayCount" style="color:#bae6fd;">Today: 0 txns</div>
        </div>
        <div class="kpi" style="border-color:rgba(250,204,21,0.45);background:rgba(250,204,21,0.1);">
          <div class="kpi-label" style="color:#fde047;">📝 Missing Notes</div>
          <div class="kpi-val" style="color:#facc15;font-size:15px;" id="expKpiMissingCount">0</div>
          <div class="kpi-sub" id="expKpiBalanceLeft" style="color:#fef08a;">Bal: ₹25,000.00</div>
        </div>
      </div>

      <div style="padding:12px;border-radius:14px;background:rgba(2,6,23,0.75);border:1px solid rgba(52,211,153,0.4);margin-bottom:12px;">
        <div style="font-size:12.5px;font-weight:900;color:#ecfdf5;margin-bottom:8px;">✍️ Quick-Add Transaction &amp; Personal Memory Note</div>
        <div class="row-2">
          <div>
            <label class="lbl" style="color:#fda4af;">Amount (₹) *</label>
            <input type="number" id="expQuickAmt" placeholder="e.g. 120" min="1" step="any" />
          </div>
          <div>
            <label class="lbl" style="color:#fde047;">What was this for? (Personal Note) *</label>
            <input type="text" id="expQuickNote" placeholder="e.g. Tea &amp; Snacks, Petrol..." />
          </div>
        </div>
        <div class="chips" id="expQuickNoteChips" style="margin-bottom:10px;">
          <button type="button" class="chip" data-note="Tea & Snacks" data-cat="Food & Dining">☕ Tea &amp; Snacks</button>
          <button type="button" class="chip" data-note="Lunch / Dinner" data-cat="Food & Dining">🍱 Lunch / Dinner</button>
          <button type="button" class="chip" data-note="Petrol / Fuel" data-cat="Fuel & Commute">⛽ Petrol / Fuel</button>
          <button type="button" class="chip" data-note="Groceries & Milk" data-cat="Groceries">🛒 Groceries</button>
          <button type="button" class="chip" data-note="Mobile Recharge" data-cat="Utilities & Recharge">📱 Recharge</button>
          <button type="button" class="chip" data-note="Sent to Family" data-cat="Family & Friends">👨‍👩‍👧 Family</button>
        </div>
        <div class="row-2">
          <div>
            <label class="lbl">Paid To / From (Merchant / Person)</label>
            <input type="text" id="expQuickMerchant" placeholder="e.g. Bakery, Friend..." />
          </div>
          <div>
            <label class="lbl">Type &amp; Payment Method</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
              <select id="expQuickType">
                <option value="debit">💸 Expense</option>
                <option value="credit">💰 Income</option>
                <option value="refund">↩️ Refund</option>
                <option value="transfer">🔄 Self-Transfer</option>
              </select>
              <select id="expQuickApp">
                <option value="GPay">GPay (UPI)</option>
                <option value="PhonePe">PhonePe (UPI)</option>
                <option value="Paytm">Paytm (UPI)</option>
                <option value="UPI">BHIM / UPI</option>
                <option value="Cash">Cash</option>
                <option value="Bank / Card">Card / Bank</option>
              </select>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
          <button type="button" class="btn btn-out" id="expAddNowBtn" style="flex:1;">💾 Save Transaction &amp; Memory Note</button>
        </div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(148,163,184,0.18);display:flex;gap:6px;align-items:center;">
          <input type="text" id="expPasteSmsInput" placeholder="📩 Paste bank SMS or UPI receipt text here to auto-extract..." style="flex:1;font-size:11.5px;padding:7px 10px;" />
          <button type="button" class="chip active" id="expParseSmsBtn" style="white-space:nowrap;">⚡ Extract SMS</button>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
        <div style="font-size:13.5px;font-weight:900;color:#fff;" id="expListHeaderTitle">📋 Mobile Transactions &amp; Notes (0)</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          <button type="button" class="chip" id="expFilterMissingBtn" style="font-size:10.5px;">📝 Missing Notes Only</button>
          <button type="button" class="chip" id="expEnableNotifBtn" style="font-size:10.5px;">🔔 Enable Live App Alerts</button>
        </div>
      </div>
      <div style="margin-bottom:8px;">
        <input type="text" id="expSearchInput" placeholder="🔍 Search merchant, personal note, category, amount, or UPI ref..." style="font-size:12px;padding:7px 10px;" />
      </div>
      <div id="expTransactionsList"></div>
    </section>

    <!-- TAB 2: MONTH DAYS LIST -->
    <section id="tab-days" class="card" style="display:none;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px;">
        <div style="font-size:15px;font-weight:900;">📅 Month Day-by-Day Sheet</div>
        <button type="button" class="chip active" id="saveAllMonthBtn">✓ Save All Month Days</button>
      </div>
      <div id="daysCardList"></div>
    </section>

    <!-- TAB 3: MONTHLY SUMMARY -->
    <section id="tab-summary" class="card" style="display:none;">
      <div style="font-size:15px;font-weight:900;margin-bottom:10px;">📊 Full Month Salary &amp; OT Summary</div>
      <div id="summaryDetailsBox" style="font-size:13px;line-height:1.75;"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">
        <button type="button" class="btn btn-in" id="exportCsvBtn">📥 Download CSV</button>
        <button type="button" class="btn btn-out" id="shareSummaryBtn">📲 WhatsApp Slip</button>
      </div>
    </section>

    <!-- TAB 4: SETTINGS & PC SYNC -->
    <section id="tab-settings" class="card" style="display:none;">
      <div style="font-size:15px;font-weight:900;margin-bottom:10px;">⚙️ Office Rules &amp; PC Sync</div>
      <div class="row-2">
        <div>
          <label class="lbl">Monthly Salary (₹)</label>
          <input type="number" id="setSalary" step="500" value="25000" />
        </div>
        <div>
          <label class="lbl">Month Days Basis</label>
          <select id="setDaysMode">
            <option value="30">30 Days Fixed</option>
            <option value="actual">Actual Month Days</option>
            <option value="26">26 Working Days</option>
          </select>
        </div>
      </div>
      <div class="row-2">
        <div>
          <label class="lbl">Standard Enter Time</label>
          <input type="time" id="setStart" value="10:00" />
        </div>
        <div>
          <label class="lbl">Standard Exit Time</label>
          <input type="time" id="setEnd" value="18:30" />
        </div>
      </div>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
        <label class="lbl" style="color:#7dd3fc;">🔄 PC Wi-Fi / Tunnel Sync URL (Optional)</label>
        <input type="url" id="syncServerUrl" placeholder="http://192.168.1.x:8433" style="margin-bottom:8px;" />
        <div class="row-2">
          <button type="button" class="btn btn-in" id="syncNowBtn">🔄 Sync with PC</button>
          <button type="button" class="btn btn-out" id="exportJsonBtn">📤 Backup JSON</button>
        </div>
      </div>
    </section>
  </main>

  <nav class="bottom-nav">
    <button type="button" class="nav-btn active" data-tab="today"><span>⏱️</span><span>Touch ID</span></button>
    <button type="button" class="nav-btn" data-tab="expenses"><span>💸</span><span>Expenses</span></button>
    <button type="button" class="nav-btn" data-tab="days"><span>📅</span><span>Month Days</span></button>
    <button type="button" class="nav-btn" data-tab="summary"><span>📊</span><span>Salary Slip</span></button>
    <button type="button" class="nav-btn" data-tab="settings"><span>⚙️</span><span>Rules &amp; Sync</span></button>
  </nav>

  <script>
    const INITIAL_SEED = ${safeInitialJson};
    const LS_KEY = 'pp_ot_salary_tracker_v1';
    const DEFAULT_SETTINGS = {
      monthlySalary: 25000,
      officeStartTime: '10:00',
      officeEndTime: '18:30',
      monthDaysMode: '30',
      otRateMode: 'auto',
      customOtHourlyRate: 100,
      otTimeCalcMode: 'in_out_duration',
      deductShortHours: false,
    };

    function loadStore() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          return {
            settings: Object.assign({}, DEFAULT_SETTINGS, INITIAL_SEED.settings || {}, parsed.settings || {}),
            days: Object.assign({}, INITIAL_SEED.days || {}, parsed.days || {}),
            expenses: Object.assign({}, INITIAL_SEED.expenses || {}, parsed.expenses || {}),
          };
        }
      } catch (_) {}
      return {
        settings: Object.assign({}, DEFAULT_SETTINGS, INITIAL_SEED.settings || {}),
        days: Object.assign({}, INITIAL_SEED.days || {}),
        expenses: Object.assign({}, INITIAL_SEED.expenses || {}),
      };
    }

    let store = loadStore();
    if (!store.expenses || typeof store.expenses !== 'object') store.expenses = {};
    const todayIso = () => {
      const n = new Date();
      return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
    };
    let selectedDate = todayIso();
    let selectedMonth = selectedDate.slice(0, 7);

    function parseMins(t, fb = 600) {
      const m = /^(\\d{1,2}):(\\d{2})$/.exec(String(t || '').trim());
      if (!m) return fb;
      return Number(m[1]) * 60 + Number(m[2]);
    }
    function minsToTime(total) {
      const w = ((Math.round(total) % 1440) + 1440) % 1440;
      return String(Math.floor(w / 60)).padStart(2, '0') + ':' + String(w % 60).padStart(2, '0');
    }
    function fmt12(t) {
      const mins = parseMins(t, -1);
      if (mins < 0) return t || '--:--';
      const h24 = Math.floor(mins / 60), m = mins % 60;
      const p = h24 >= 12 ? 'PM' : 'AM';
      const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
      return String(h12).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ' ' + p;
    }
    function fmtINR(n) {
      return (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function fmtMins(mins) {
      const mTotal = Math.max(0, Math.round(Number(mins) || 0));
      const h = Math.floor(mTotal / 60), m = mTotal % 60;
      if (h === 0 && m === 0) return '0 hr 00 min';
      if (h === 0) return m + ' min';
      if (m === 0) return h + (h === 1 ? ' hr' : ' hrs');
      return h + 'h ' + String(m).padStart(2, '0') + 'm';
    }
    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = '✓ ' + msg;
      el.style.display = 'block';
      clearTimeout(el._t);
      el._t = setTimeout(() => { el.style.display = 'none'; }, 2400);
    }

    function getRates() {
      const s = store.settings;
      const salary = Math.max(0, Number(s.monthlySalary) || 25000);
      const startMins = parseMins(s.officeStartTime, 600);
      const endMins = parseMins(s.officeEndTime, 1110);
      const shiftMins = endMins >= startMins ? (endMins - startMins) : (1440 - startMins + endMins);
      const shiftHours = Math.max(1, shiftMins / 60);
      const [y, m] = selectedMonth.split('-').map(Number);
      const actualDays = new Date(y || 2026, m || 1, 0).getDate();
      const divisorDays = s.monthDaysMode === 'actual' ? actualDays : s.monthDaysMode === '26' ? 26 : 30;
      const perDaySalary = salary / divisorDays;
      const otHourlyRate = perDaySalary / shiftHours;
      return { salary, startMins, endMins, shiftMins, shiftHours, divisorDays, perDaySalary, otHourlyRate };
    }

    function calcDay(rec) {
      const r = getRates();
      const status = rec.status || 'present';
      const inMins = parseMins(rec.inTime || store.settings.officeStartTime, r.startMins);
      const outMins = parseMins(rec.outTime || store.settings.officeEndTime, r.endMins);
      const workedMins = status === 'leave' ? 0 : (outMins >= inMins ? outMins - inMins : 1440 - inMins + outMins);
      const dutyMins = status === 'ot_only' ? 0 : status === 'half' ? Math.round(r.shiftMins / 2) : r.shiftMins;
      const otMins = status === 'leave' ? 0 : Math.max(0, workedMins - dutyMins);
      const otHours = otMins / 60;
      let basePay = r.perDaySalary;
      if (status === 'half') basePay = r.perDaySalary * 0.5;
      else if (status === 'leave' || status === 'ot_only') basePay = 0;
      const otPay = otHours * r.otHourlyRate;
      const extraAllowance = Math.max(0, Number(rec.extraAllowance) || 0);
      const totalPay = basePay + otPay + extraAllowance;
      return { workedMins, otMins, otHours, basePay, otPay, extraAllowance, totalPay };
    }

    const CLIENT_ID = 'mob_' + Math.random().toString(36).slice(2, 10);

    function mergeIncomingData(incoming) {
      if (!incoming || typeof incoming !== 'object') return false;
      if (incoming.clientId && incoming.clientId === CLIENT_ID) return false;
      let changed = false;
      const inSettingsTs = Number(incoming.settingsUpdatedAt || incoming.updatedAtMs || 0);
      const curSettingsTs = Number(store.settingsUpdatedAt || 0);
      if (incoming.settings && inSettingsTs >= curSettingsTs) {
        store.settings = Object.assign({}, DEFAULT_SETTINGS, store.settings, incoming.settings);
        store.settingsUpdatedAt = inSettingsTs;
        const heroEl = document.getElementById('heroSalaryInput');
        if (heroEl && document.activeElement !== heroEl) heroEl.value = store.settings.monthlySalary;
        const setSalEl = document.getElementById('setSalary');
        if (setSalEl && document.activeElement !== setSalEl) setSalEl.value = store.settings.monthlySalary;
        changed = true;
      }
      if (incoming.days && typeof incoming.days === 'object') {
        for (const [iso, inRec] of Object.entries(incoming.days)) {
          if (!inRec || typeof inRec !== 'object') continue;
          const exRec = store.days[iso];
          const inTs = Number(inRec.updatedAtMs || Date.parse(inRec.updatedAt || inRec.savedAt || '') || 1);
          const exTs = exRec ? Number(exRec.updatedAtMs || Date.parse(exRec.updatedAt || exRec.savedAt || '') || 0) : -1;
          if (!exRec || inTs >= exTs) {
            store.days[iso] = Object.assign({}, exRec || {}, inRec);
            changed = true;
          }
        }
      }
      if (changed) {
        localStorage.setItem(LS_KEY, JSON.stringify({
          settings: store.settings,
          days: store.days,
        }));
        renderAll();
      }
      return changed;
    }

    function getSyncBases() {
      const set = new Set();
      const custom = (document.getElementById('syncServerUrl').value || '').trim().replace(/\\/+$/, '');
      if (custom) {
        if (/^https?:\\/\\//i.test(custom)) set.add(custom);
        else if (custom.includes(':')) set.add('http://' + custom);
        else { set.add('http://' + custom + ':5173'); set.add('http://' + custom + ':8433'); }
      }
      if (window.location.origin && window.location.origin.startsWith('http') && !window.Capacitor) {
        set.add(window.location.origin);
      }
      return Array.from(set);
    }

    function saveStore(msg, allowExplicitSync = false) {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      store.clientId = CLIENT_ID;
      store.updatedAt = nowIso;
      store.updatedAtMs = nowMs;
      store.settingsUpdatedAt = store.settingsUpdatedAt || nowMs;
      localStorage.setItem(LS_KEY, JSON.stringify({
        settings: store.settings,
        days: store.days,
      }));
      if (msg) showToast(msg);

      if (allowExplicitSync) {
        const jsonBody = JSON.stringify({
          clientId: CLIENT_ID,
          settings: store.settings,
          days: store.days,
          updatedAt: nowIso,
          updatedAtMs: nowMs,
        });
        for (const base of getSyncBases()) {
          const url = base + '/api/ot-salary-sync';
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: jsonBody,
          }).then(r => r.ok ? r.json() : null).then(j => {
            if (j && j.data) mergeIncomingData(j.data);
          }).catch(() => {});
        }
      }
      renderAll();
    }

    function loadDateIntoForm(iso) {
      selectedDate = iso;
      document.getElementById('entryDate').value = iso;
      const ex = store.days[iso];
      const dt = new Date(iso + 'T00:00:00');
      const isSun = dt.getDay() === 0;
      document.getElementById('entryStatus').value = ex ? ex.status : (isSun ? 'holiday_paid' : 'present');
      document.getElementById('entryInTime').value = ex ? ex.inTime : (store.settings.officeStartTime || '10:00');
      document.getElementById('entryOutTime').value = ex ? ex.outTime : (store.settings.officeEndTime || '18:30');
      document.getElementById('entryBonus').value = ex ? (ex.extraAllowance || 0) : 0;
      document.getElementById('entryNote').value = ex ? (ex.note || '') : '';
      renderAll();
    }

    function renderAll() {
      const r = getRates();
      document.getElementById('hdrRateSub').textContent =
        '₹' + fmtINR(r.salary) + '/mo · ' + fmt12(store.settings.officeStartTime) + '–' + fmt12(store.settings.officeEndTime) + ' · OT ₹' + fmtINR(r.otHourlyRate) + '/hr';
      document.getElementById('monthPicker').value = selectedMonth;
      const heroSalEl = document.getElementById('heroSalaryInput');
      if (heroSalEl && document.activeElement !== heroSalEl) {
        heroSalEl.value = r.salary;
      }
      const perDayEl = document.getElementById('kpiPerDayVal');
      if (perDayEl) perDayEl.textContent = '₹' + fmtINR(r.perDaySalary) + '/d';
      const otRateEl = document.getElementById('kpiOtRateSub');
      if (otRateEl) otRateEl.textContent = 'OT: ₹' + fmtINR(r.otHourlyRate) + '/hr';

      const inVal = document.getElementById('entryInTime').value || '10:00';
      const outVal = document.getElementById('entryOutTime').value || '18:30';
      const stVal = document.getElementById('entryStatus').value || 'present';
      const bonusVal = Number(document.getElementById('entryBonus').value) || 0;
      document.getElementById('inTime12Label').textContent = fmt12(inVal);
      document.getElementById('outTime12Label').textContent = fmt12(outVal);

      const preview = calcDay({ status: stVal, inTime: inVal, outTime: outVal, extraAllowance: bonusVal });
      const badge = document.getElementById('daySavedBadge');
      if (store.days[selectedDate]) {
        badge.textContent = '✓ Saved';
        badge.style.background = 'rgba(16,185,129,0.2)';
        badge.style.color = '#6ee7b7';
      } else {
        badge.textContent = 'Unsaved';
        badge.style.background = 'rgba(245,158,11,0.2)';
        badge.style.color = '#fde68a';
      }

      const curRec = store.days[selectedDate] || {};
      const bioInEl = document.getElementById('bioInStatusSub');
      const bioOutEl = document.getElementById('bioOutStatusSub');
      if (bioInEl) {
        bioInEl.textContent = curRec.biometricIn ? ('✓ IN · ' + fmt12(inVal)) : ('IN · ' + fmt12(inVal));
        bioInEl.style.color = curRec.biometricIn ? '#7dd3fc' : '#e0f2fe';
      }
      if (bioOutEl) {
        bioOutEl.textContent = curRec.biometricOut ? ('✓ OUT · ' + fmt12(outVal)) : ('OUT · ' + fmt12(outVal));
        bioOutEl.style.color = curRec.biometricOut ? '#6ee7b7' : '#d1fae5';
      }

      document.getElementById('liveBreakdownBox').innerHTML =
        '<div><strong>Shift (' + selectedDate + '):</strong> ' + fmt12(inVal) + ' → ' + fmt12(outVal) + ' (' + fmtMins(preview.workedMins) + ')</div>' +
        '<div><strong>Extra OT:</strong> <span style="color:#34d399;font-weight:900;">+' + fmtMins(preview.otMins) + ' (+₹' + fmtINR(preview.otPay) + ')</span> · <strong>Base:</strong> ₹' + fmtINR(preview.basePay) + '</div>' +
        '<div><strong>Touch ID Sensor:</strong> ' + (curRec.biometricIn ? 'Touch IN ✓ ' : 'IN — ') + ' · ' + (curRec.biometricOut ? 'Touch OUT ✓' : 'OUT —') + '</div>' +
        '<div style="margin-top:4px;font-size:16px;font-weight:900;color:#facc15;">Day Total: ₹' + fmtINR(preview.totalPay) + '</div>';

      // Build month summary
      const [y, m] = selectedMonth.split('-').map(Number);
      const count = new Date(y, m, 0).getDate();
      let savedCount = 0, totalOtMins = 0, totalOtPay = 0, totalBonus = 0, leaveDays = 0, halfDays = 0;
      let cardsHtml = '';

      for (let d = 1; d <= count; d++) {
        const iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const dt = new Date(y, m - 1, d);
        const dayName = dt.toLocaleDateString('en-US', { weekday: 'short' });
        const isSun = dt.getDay() === 0;
        const saved = store.days[iso];
        const rec = saved || {
          status: isSun ? 'holiday_paid' : 'present',
          inTime: store.settings.officeStartTime || '10:00',
          outTime: store.settings.officeEndTime || '18:30',
          extraAllowance: 0,
        };
        const c = calcDay(rec);
        if (saved) savedCount++;
        if (rec.status === 'leave') leaveDays++;
        if (rec.status === 'half') halfDays++;
        if (c.otMins > 0) { totalOtMins += c.otMins; totalOtPay += c.otPay; }
        if (c.extraAllowance > 0) totalBonus += c.extraAllowance;

        cardsHtml += '<div class="day-card ' + (c.otMins > 0 ? 'ot' : '') + '" onclick="window._pickDate(\\'' + iso + '\\')">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<div><strong>' + iso + ' (' + dayName + ')</strong> ' +
              (saved ? '<span style="color:#34d399;font-size:11px;">✓ Saved</span>' : '<span style="color:#64748b;font-size:11px;">Default</span>') +
              (rec.biometricIn ? ' <span style="color:#7dd3fc;font-size:10.5px;">Touch IN✓</span>' : '') +
              (rec.biometricOut ? ' <span style="color:#6ee7b7;font-size:10.5px;">Touch OUT✓</span>' : '') +
            '</div>' +
            '<div style="font-weight:900;color:#facc15;">₹' + fmtINR(c.totalPay) + '</div>' +
          '</div>' +
          '<div style="font-size:11.5px;color:#cbd5e1;margin-top:4px;display:flex;justify-content:space-between;">' +
            '<span>' + fmt12(rec.inTime) + ' → ' + fmt12(rec.outTime) + ' (' + fmtMins(c.workedMins) + ')</span>' +
            '<span style="color:' + (c.otMins > 0 ? '#34d399' : '#64748b') + ';font-weight:800;">OT: +' + fmtMins(c.otMins) + '</span>' +
          '</div>' +
        '</div>';
      }

      const leaveDed = (leaveDays * r.perDaySalary) + (halfDays * r.perDaySalary * 0.5);
      const netPayable = Math.max(0, r.salary - leaveDed) + totalOtPay + totalBonus;

      document.getElementById('kpiNetPay').textContent = '₹' + fmtINR(netPayable);
      document.getElementById('kpiSavedSub').textContent = savedCount + '/' + count + ' days saved';
      document.getElementById('kpiOtPay').textContent = '+ ₹' + fmtINR(totalOtPay + totalBonus);
      document.getElementById('kpiOtTime').textContent = fmtMins(totalOtMins) + ' Extra OT';
      document.getElementById('daysCardList').innerHTML = cardsHtml;

      document.getElementById('summaryDetailsBox').innerHTML =
        '<div>• <strong>Month:</strong> ' + selectedMonth + '</div>' +
        '<div>• <strong>Monthly Base Salary:</strong> ₹' + fmtINR(r.salary) + ' (₹' + fmtINR(r.perDaySalary) + '/day)</div>' +
        '<div>• <strong>Total Extra OT Worked:</strong> <span style="color:#38bdf8;font-weight:900;">' + fmtMins(totalOtMins) + '</span></div>' +
        '<div>• <strong>Total Extra OT Pay:</strong> <span style="color:#34d399;font-weight:900;">+ ₹' + fmtINR(totalOtPay) + '</span></div>' +
        '<div>• <strong>Extra Bonus / Allowances:</strong> + ₹' + fmtINR(totalBonus) + '</div>' +
        '<div>• <strong>Leave Deductions:</strong> - ₹' + fmtINR(leaveDed) + ' (' + leaveDays + ' leave, ' + halfDays + ' half)</div>' +
        '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:18px;font-weight:900;color:#facc15;">Final Net Salary: ₹' + fmtINR(netPayable) + '</div>';

      // Render Expense Memory KPIs & Ledger
      const allExp = Object.values(store.expenses || {}).filter(e => e && !e.deleted && Number(e.amount) > 0);
      const monthExp = allExp.filter(e => String(e.date || '').slice(0, 7) === selectedMonth);
      monthExp.sort((a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0));
      const tIso = todayIso();
      let expGrossSpent = 0, expRefunds = 0, expTotalRecv = 0, expTodaySpent = 0, expTodayCount = 0, expMissingCount = 0;
      for (const tx of monthExp) {
        if (tx.status === 'failed') continue;
        const amt = Number(tx.amount) || 0;
        const txType = tx.type || 'debit';
        if (txType === 'credit') expTotalRecv += amt;
        else if (txType === 'refund') expRefunds += amt;
        else if (txType !== 'transfer') expGrossSpent += amt;
        if (tx.date === tIso) {
          expTodayCount++;
          if (txType === 'debit') expTodaySpent += amt;
        }
        const hasPersonalNote = String(tx.personalNote || tx.note || '').trim().length > 0;
        if (!hasPersonalNote && !tx.noteReviewed) expMissingCount++;
      }
      const expNetSpent = Math.max(0, expGrossSpent - expRefunds);
      const badgeEl = document.getElementById('topModExpBadge');
      if (badgeEl) badgeEl.textContent = String(monthExp.length);
      const totSpentEl = document.getElementById('expKpiTotalSpent');
      if (totSpentEl) totSpentEl.textContent = '₹' + fmtINR(expNetSpent);
      const todSpentEl = document.getElementById('expKpiTodaySpent');
      if (todSpentEl) todSpentEl.textContent = 'Today: ₹' + fmtINR(expTodaySpent);
      const totRecvEl = document.getElementById('expKpiTotalRecv');
      if (totRecvEl) totRecvEl.textContent = '₹' + fmtINR(expTotalRecv);
      const refSubEl = document.getElementById('expKpiRefundSub');
      if (refSubEl) refSubEl.textContent = 'Refunds: ₹' + fmtINR(expRefunds);
      const totCntEl = document.getElementById('expKpiTotalCount');
      if (totCntEl) totCntEl.textContent = monthExp.length + ' Done';
      const todCntEl = document.getElementById('expKpiTodayCount');
      if (todCntEl) todCntEl.textContent = 'Today: ' + expTodayCount + ' txns';
      const missCntEl = document.getElementById('expKpiMissingCount');
      if (missCntEl) missCntEl.textContent = String(expMissingCount);
      const balLeftEl = document.getElementById('expKpiBalanceLeft');
      if (balLeftEl) balLeftEl.textContent = 'Bal: ₹' + fmtINR(netPayable - expNetSpent + expTotalRecv);

      const searchQ = String((document.getElementById('expSearchInput') && document.getElementById('expSearchInput').value) || '').trim().toLowerCase();
      const filteredExp = monthExp.filter(tx => {
        if (window._expOnlyMissingNotes) {
          const hasNote = String(tx.personalNote || tx.note || '').trim().length > 0;
          if (hasNote || tx.noteReviewed) return false;
        }
        if (!searchQ) return true;
        const hay = [tx.merchant, tx.personalNote, tx.note, tx.paymentRemark, tx.category, tx.app, tx.refId, String(tx.amount)].join(' ').toLowerCase();
        return hay.includes(searchQ);
      });
      const hdrTitleEl = document.getElementById('expListHeaderTitle');
      if (hdrTitleEl) hdrTitleEl.textContent = '📋 Mobile Transactions & Notes (' + filteredExp.length + ')';

      const expListEl = document.getElementById('expTransactionsList');
      if (expListEl) {
        if (filteredExp.length === 0) {
          expListEl.innerHTML = '<div style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;">' +
            (monthExp.length === 0
              ? 'Your money story starts here. Tap <strong>📲 Auto-Scan Mobile SMS</strong> or record a transaction above!'
              : (window._expOnlyMissingNotes ? "You're all caught up! Every tracked transaction has a note." : 'Nothing matched your search. Try a different keyword or date.')) +
            '</div>';
        } else {
          expListEl.innerHTML = filteredExp.map(tx => {
            const txType = tx.type || 'debit';
            const isCredit = txType === 'credit' || txType === 'refund';
            const safeNote = String(tx.personalNote || tx.note || '').replace(/"/g, '&quot;');
            const remarkBadge = tx.paymentRemark ? '<span style="font-size:10px;color:#cbd5e1;background:rgba(148,163,184,0.16);padding:1px 6px;border-radius:6px;margin-left:4px;">UPI: ' + String(tx.paymentRemark).replace(/</g, '&lt;') + '</span>' : '';
            return '<div class="day-card" style="border-color:' + (isCredit ? 'rgba(52,211,153,0.4)' : 'rgba(244,63,94,0.35)') + ';">' +
              '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
                '<div>' +
                  '<div style="font-size:13px;font-weight:900;color:#fff;">' + (tx.merchant || 'Mobile Payment') + ' <span style="font-size:10.5px;color:#38bdf8;">[' + (tx.app || 'UPI') + ' · ' + (tx.category || 'General') + ']</span>' + remarkBadge + '</div>' +
                  '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + (tx.date || '') + ' · ' + fmt12(tx.time || '12:00') + (tx.refId ? ' · Ref ' + tx.refId : '') + (tx.accountMask ? ' · ' + tx.accountMask : '') + '</div>' +
                '</div>' +
                '<div style="font-size:15px;font-weight:900;color:' + (isCredit ? '#34d399' : (txType === 'transfer' ? '#93c5fd' : '#fda4af')) + ';">' + (isCredit ? '+ ₹' : (txType === 'transfer' ? '⇄ ₹' : '- ₹')) + fmtINR(tx.amount) + '</div>' +
              '</div>' +
              '<div style="margin-top:7px;display:flex;gap:6px;align-items:center;">' +
                '<input type="text" value="' + safeNote + '" placeholder="Add personal memory note: what was this for?..." onchange="window._updateExpNote(\\'' + tx.id + '\\', this.value)" style="padding:6px 9px;font-size:12px;border-color:rgba(250,204,21,0.4);" />' +
              '</div>' +
            '</div>';
          }).join('');
        }
      }
    }

    let activeTab = 'today';
    let tabHistory = ['today'];

    function syncBackBtnVisibility() {
      const btn = document.getElementById('topBackBtn');
      if (!btn) return;
      btn.style.display = (activeTab !== 'today' || selectedDate !== todayIso()) ? 'inline-block' : 'none';
    }

    function updateTopModButtons(tab) {
      const otBtn = document.getElementById('topModOtBtn');
      const expBtn = document.getElementById('topModExpBtn');
      if (!otBtn || !expBtn) return;
      if (tab === 'expenses') {
        expBtn.style.border = '1.5px solid #fb7185';
        expBtn.style.background = 'linear-gradient(135deg,rgba(244,63,94,0.28),rgba(245,158,11,0.22))';
        expBtn.style.color = '#fff1f2';
        otBtn.style.border = '1px solid transparent';
        otBtn.style.background = 'transparent';
        otBtn.style.color = '#94a3b8';
      } else {
        otBtn.style.border = '1.5px solid #34d399';
        otBtn.style.background = 'linear-gradient(135deg,rgba(16,185,129,0.25),rgba(14,165,233,0.2))';
        otBtn.style.color = '#ecfdf5';
        expBtn.style.border = '1px solid transparent';
        expBtn.style.background = 'transparent';
        expBtn.style.color = '#94a3b8';
      }
    }

    function switchTab(tab, pushHistory = true) {
      if (pushHistory && tab !== activeTab) {
        tabHistory.push(tab);
        if (tabHistory.length > 8) tabHistory.shift();
        try { window.history.pushState({ otGuard: true, tab }, ''); } catch (_) {}
      }
      activeTab = tab;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      ['today','expenses','days','summary','settings'].forEach(t => {
        const el = document.getElementById('tab-' + t);
        if (el) el.style.display = t === tab ? 'block' : 'none';
      });
      updateTopModButtons(tab);
      syncBackBtnVisibility();
    }

    const topModOtBtn = document.getElementById('topModOtBtn');
    const topModExpBtn = document.getElementById('topModExpBtn');
    if (topModOtBtn) topModOtBtn.addEventListener('click', () => switchTab('today'));
    if (topModExpBtn) topModExpBtn.addEventListener('click', () => switchTab('expenses'));

    window._updateExpNote = function(txId, newNote) {
      if (!store.expenses || !store.expenses[txId]) return;
      const nowMs = Date.now();
      const trimmed = String(newNote || '').trim();
      store.expenses[txId].note = trimmed;
      store.expenses[txId].personalNote = trimmed;
      store.expenses[txId].noteReviewed = true;
      store.expenses[txId].updatedAtMs = nowMs;
      store.expenses[txId].updatedAt = new Date(nowMs).toISOString();
      saveStore('Saved personal memory note');
    };

    let selectedQuickCat = 'General';
    function addExpenseEntry() {
      const amtEl = document.getElementById('expQuickAmt');
      const noteEl = document.getElementById('expQuickNote');
      const merchEl = document.getElementById('expQuickMerchant');
      const appEl = document.getElementById('expQuickApp');
      const typeEl = document.getElementById('expQuickType');
      const amt = Number(amtEl && amtEl.value);
      if (!Number.isFinite(amt) || amt <= 0) {
        showToast('Enter a valid amount in ₹');
        return;
      }
      const now = new Date();
      const nowMs = now.getTime();
      const dateStr = todayIso();
      const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      const noteStr = String((noteEl && noteEl.value) || '').trim();
      const merchStr = String((merchEl && merchEl.value) || '').trim() || (noteStr || 'Expense Spend');
      const appStr = (appEl && appEl.value) || 'GPay';
      const typeStr = (typeEl && typeEl.value) || 'debit';
      const id = 'tx_manual_' + nowMs + '_' + Math.random().toString(36).slice(2, 6);
      if (!store.expenses) store.expenses = {};
      store.expenses[id] = {
        id,
        amount: Number(amt.toFixed(2)),
        currency: 'INR',
        type: typeStr,
        merchant: merchStr,
        note: noteStr,
        personalNote: noteStr,
        category: selectedQuickCat || 'General',
        app: appStr,
        paymentMethod: appStr === 'Cash' ? 'Cash' : (appStr === 'Bank / Card' ? 'Card' : 'UPI'),
        date: dateStr,
        time: timeStr,
        timestampMs: nowMs,
        updatedAtMs: nowMs,
        source: 'manual',
        status: 'completed',
        detectionStatus: 'user_confirmed',
        noteReviewed: Boolean(noteStr),
      };
      if (amtEl) amtEl.value = '';
      if (noteEl) noteEl.value = '';
      if (merchEl) merchEl.value = '';
      selectedQuickCat = 'General';
      saveStore('Recorded ₹' + fmtINR(amt) + (noteStr ? ' (' + noteStr + ')' : ''));
    }

    const expAddNowBtn = document.getElementById('expAddNowBtn');
    if (expAddNowBtn) expAddNowBtn.addEventListener('click', () => addExpenseEntry());

    document.querySelectorAll('#expQuickNoteChips .chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const nEl = document.getElementById('expQuickNote');
        if (nEl) nEl.value = btn.dataset.note || '';
        if (btn.dataset.cat) selectedQuickCat = btn.dataset.cat;
      });
    });

    const expSearchEl = document.getElementById('expSearchInput');
    if (expSearchEl) expSearchEl.addEventListener('input', () => renderAll());

    const expFilterMissingBtn = document.getElementById('expFilterMissingBtn');
    if (expFilterMissingBtn) {
      expFilterMissingBtn.addEventListener('click', () => {
        window._expOnlyMissingNotes = !window._expOnlyMissingNotes;
        expFilterMissingBtn.classList.toggle('active', Boolean(window._expOnlyMissingNotes));
        renderAll();
      });
    }

    const expParseSmsBtn = document.getElementById('expParseSmsBtn');
    if (expParseSmsBtn) {
      expParseSmsBtn.addEventListener('click', () => {
        const inp = document.getElementById('expPasteSmsInput');
        const raw = String((inp && inp.value) || '').trim();
        if (!raw) { showToast('Paste a bank SMS or UPI receipt message first'); return; }
        if (/\\b(otp|one time password|verification code|cvv|mpin)\\b/i.test(raw) && !/(?:debited|credited|paid|sent|spent)/i.test(raw)) {
          showToast('Ignored non-transaction OTP / verification message');
          return;
        }
        const amtM = raw.match(/(?:rs\\.?|inr|₹|amt|amount|paid|debited|credited|sent|received)\\s*(?:of\\s*)?(?:rs\\.?|inr|₹)?\\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)/i);
        const amt = amtM ? parseFloat(amtM[1].replace(/,/g, '')) : 0;
        if (!amt || amt <= 0) { showToast('Could not detect a valid ₹ amount in that message'); return; }
        const lower = raw.toLowerCase();
        const isRefund = /\\b(refund|refunded|cashback|reversal)\\b/i.test(lower);
        const isCredit = !isRefund && /\\b(credited|received|deposited)\\b/i.test(lower);
        const merchM = raw.match(/(?:paid to|sent to|to vpa|at|towards|from)\\s+([A-Za-z0-9][A-Za-z0-9 .&@_\\-/]{1,34})/i);
        const refM = raw.match(/(?:upi\\s*ref(?:\\s*no\\.?|\\s*id)?|utr|rrn|txn\\s*id)\\s*[:\\-#]?\\s*([A-Za-z0-9]{6,22})/i);
        const now = new Date();
        const nowMs = now.getTime();
        const id = 'tx_sms_' + (refM ? refM[1] : nowMs);
        if (!store.expenses) store.expenses = {};
        store.expenses[id] = {
          id,
          amount: Number(amt.toFixed(2)),
          currency: 'INR',
          type: isRefund ? 'refund' : (isCredit ? 'credit' : 'debit'),
          merchant: merchM ? merchM[1].trim() : 'Bank / UPI Alert',
          note: '',
          personalNote: '',
          paymentRemark: '',
          category: 'General',
          app: 'UPI',
          paymentMethod: 'UPI',
          refId: refM ? refM[1] : '',
          date: todayIso(),
          time: String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'),
          timestampMs: nowMs,
          updatedAtMs: nowMs,
          source: 'sms_paste',
          status: 'completed',
        };
        if (inp) inp.value = '';
        saveStore('Extracted ₹' + fmtINR(amt) + ' from SMS/receipt');
      });
    }

    const expExportCsvBtn = document.getElementById('expExportCsvBtn');
    if (expExportCsvBtn) {
      expExportCsvBtn.addEventListener('click', () => {
        const list = Object.values(store.expenses || {}).filter(e => e && !e.deleted && Number(e.amount) > 0);
        if (list.length === 0) { showToast('No transactions to export yet'); return; }
        const rows = [['Date','Time','Type','Amount (INR)','Merchant','Category','Payment Method','App','Personal Note','Payment Remark','UPI Ref'].join(',')];
        list.forEach(tx => {
          const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
          rows.push([tx.date, tx.time, tx.type, tx.amount, tx.merchant, tx.category, tx.paymentMethod || tx.app, tx.app, tx.personalNote || tx.note, tx.paymentRemark, tx.refId].map(esc).join(','));
        });
        const blob = new Blob([rows.join('\\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'Expense-Memory-' + selectedMonth + '.csv';
        a.click();
        showToast('Your report is ready.');
      });
    }

    function runMobileSmsScan() {
      if (window.PattanBiometric && typeof window.PattanBiometric.scanMobileTransactions === 'function') {
        try {
          const rawJson = window.PattanBiometric.scanMobileTransactions(90);
          const res = JSON.parse(rawJson || '{}');
          if (Array.isArray(res.transactions) && res.transactions.length > 0) {
            let added = 0;
            if (!store.expenses) store.expenses = {};
            for (const tx of res.transactions) {
              if (!tx || !tx.id) continue;
              const ex = store.expenses[tx.id];
              if (!ex) {
                store.expenses[tx.id] = Object.assign({}, tx, { updatedAtMs: Date.now() });
                added++;
              } else if (!ex.note && tx.note) {
                store.expenses[tx.id].note = tx.note;
                added++;
              }
            }
            if (added > 0) saveStore('Auto-detected ' + added + ' mobile transactions');
            else showToast('All ' + res.transactions.length + ' mobile transactions are up to date');
          } else if (res.permissionGranted === false) {
            showToast('Allow SMS permission on your phone to auto-detect bank/UPI transactions');
          } else {
            showToast('Scanned phone SMS inbox');
          }
        } catch (_) {}
      } else {
        showToast('Open inside the Android APK to auto-scan phone SMS & UPI alerts');
      }
    }

    const expScanBtn = document.getElementById('expScanMobileBtn');
    if (expScanBtn) expScanBtn.addEventListener('click', runMobileSmsScan);
    const expNotifBtn = document.getElementById('expEnableNotifBtn');
    if (expNotifBtn) expNotifBtn.addEventListener('click', () => {
      if (window.PattanBiometric && typeof window.PattanBiometric.openNotificationListenerSettings === 'function') {
        window.PattanBiometric.openNotificationListenerSettings();
      } else {
        showToast('Available in the Android APK');
      }
    });

    window.addEventListener('pattan-mobile-transactions', (ev) => {
      const payload = ev && ev.detail;
      if (payload && Array.isArray(payload.transactions)) {
        let changed = false;
        if (!store.expenses) store.expenses = {};
        for (const tx of payload.transactions) {
          if (!tx || !tx.id) continue;
          if (!store.expenses[tx.id]) {
            store.expenses[tx.id] = Object.assign({}, tx, { updatedAtMs: Date.now() });
            changed = true;
          }
        }
        if (changed) saveStore('Live mobile transaction captured');
      }
    });

    function goBackStep() {
      const drawer = document.getElementById('manualEditorDrawer');
      if (drawer && drawer.style.display !== 'none') {
        drawer.style.display = 'none';
        return 'handled';
      }
      if (tabHistory.length > 1) {
        tabHistory.pop();
        const prev = tabHistory[tabHistory.length - 1] || 'today';
        switchTab(prev, false);
        return 'handled';
      }
      if (activeTab !== 'today') {
        tabHistory = ['today'];
        switchTab('today', false);
        return 'handled';
      }
      if (selectedDate !== todayIso()) {
        loadDateIntoForm(todayIso());
        syncBackBtnVisibility();
        showToast('Returned to Today');
        return 'handled';
      }
      return '';
    }

    window.__handlePattanHardwareBack = goBackStep;
    document.getElementById('topBackBtn').addEventListener('click', () => goBackStep());

    const toggleDrawerBtn = document.getElementById('toggleManualEditorBtn');
    if (toggleDrawerBtn) {
      toggleDrawerBtn.addEventListener('click', () => {
        const d = document.getElementById('manualEditorDrawer');
        if (!d) return;
        const open = d.style.display !== 'none';
        d.style.display = open ? 'none' : 'block';
        toggleDrawerBtn.textContent = open ? '✏️ Manual Time & Date Override ▼' : '▲ Hide Manual Time & Date Override';
      });
    }

    try {
      window.history.replaceState({ otBase: true, tab: 'today' }, '');
      window.history.pushState({ otGuard: true, tab: 'today' }, '');
    } catch (_) {}
    window.addEventListener('popstate', () => {
      goBackStep();
      try { window.history.pushState({ otGuard: true, tab: activeTab }, ''); } catch (_) {}
    });

    let touchStart = null;
    document.addEventListener('touchstart', (e) => {
      const tag = String((e.target && e.target.tagName) || '').toLowerCase();
      if (['input','select','textarea','button'].includes(tag)) { touchStart = null; return; }
      const t = e.touches && e.touches[0];
      if (t) touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!touchStart) return;
      const start = touchStart;
      touchStart = null;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x, dy = t.clientY - start.y, dt = Date.now() - start.time;
      if (dt > 700 || Math.abs(dx) < 68 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const order = ['today','expenses','days','summary','settings'];
      const idx = order.indexOf(activeTab);
      if (dx > 0) {
        if (idx > 0) switchTab(order[idx - 1]);
        else goBackStep();
      } else if (dx < 0 && idx >= 0 && idx < order.length - 1) {
        switchTab(order[idx + 1]);
      }
    }, { passive: true });

    window._pickDate = function(iso) {
      loadDateIntoForm(iso);
      switchTab('today');
    };

    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    ['entryInTime','entryOutTime','entryStatus','entryBonus','entryNote'].forEach(id => {
      document.getElementById(id).addEventListener('input', renderAll);
      document.getElementById(id).addEventListener('change', renderAll);
    });

    document.getElementById('entryDate').addEventListener('change', (e) => {
      if (e.target.value) {
        selectedMonth = e.target.value.slice(0, 7);
        loadDateIntoForm(e.target.value);
      }
    });

    document.getElementById('monthPicker').addEventListener('change', (e) => {
      if (e.target.value) {
        selectedMonth = e.target.value;
        renderAll();
      }
    });

    document.querySelectorAll('#otPresetChips .chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const otHrs = Number(btn.dataset.ot) || 0;
        const r = getRates();
        const inMins = parseMins(document.getElementById('entryInTime').value, r.startMins);
        const st = document.getElementById('entryStatus').value;
        const dutyMins = st === 'ot_only' ? 0 : st === 'half' ? Math.round(r.shiftMins / 2) : r.shiftMins;
        document.getElementById('entryOutTime').value = minsToTime(inMins + dutyMins + Math.round(otHrs * 60));
        saveCurrentForm('Saved +' + otHrs + 'h OT for ' + selectedDate);
      });
    });

    function saveCurrentForm(customMsg, bioPatch) {
      const inVal = document.getElementById('entryInTime').value || '10:00';
      const outVal = document.getElementById('entryOutTime').value || '18:30';
      const stVal = document.getElementById('entryStatus').value || 'present';
      const bonusVal = Number(document.getElementById('entryBonus').value) || 0;
      const noteVal = document.getElementById('entryNote').value || '';
      const prev = store.days[selectedDate] || {};
      const c = calcDay({ status: stVal, inTime: inVal, outTime: outVal, extraAllowance: bonusVal });
      const nowMs = Date.now();
      store.days[selectedDate] = Object.assign({}, prev, {
        date: selectedDate,
        status: stVal,
        inTime: inVal,
        outTime: outVal,
        workedMins: c.workedMins,
        otHours: Number(c.otHours.toFixed(4)),
        extraAllowance: bonusVal,
        note: noteVal,
        savedAt: new Date(nowMs).toISOString(),
        updatedAt: new Date(nowMs).toISOString(),
        updatedAtMs: nowMs,
      }, bioPatch || {});
      saveStore(customMsg || ('Saved ' + selectedDate));
    }

    function playBioBeep(kind) {
      try {
        if (window.PattanBiometric && typeof window.PattanBiometric.vibrate === 'function') {
          window.PattanBiometric.vibrate(kind === 'out' ? 95 : 65);
        } else if (navigator.vibrate) {
          navigator.vibrate(kind === 'out' ? [45, 35, 75] : [60]);
        }
      } catch (_) {}
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(kind === 'out' ? 987.77 : 880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(kind === 'out' ? 1318.51 : 1174.66, ctx.currentTime + 0.14);
        g.gain.setValueAtTime(0.08, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.19);
      } catch (_) {}
    }

    function requestMobileUnlockBiometric(target) {
      return new Promise(async (resolve) => {
        const title = target === 'in'
          ? 'Unlock to Punch IN (Enter)'
          : 'Unlock to Punch OUT (Exit + OT)';
        const subtitle = 'Use your phone unlock fingerprint, face, or screen lock';
        if (window.PattanBiometric && typeof window.PattanBiometric.authenticate === 'function') {
          let done = false;
          const finish = (res) => {
            if (done) return;
            done = true;
            resolve(res || { ok: false });
          };
          window.__pattanBiometricCallback = (res) => finish(res);
          setTimeout(() => finish({ ok: false, reason: 'Timeout' }), 60000);
          try {
            window.PattanBiometric.authenticate(title, subtitle, '__pattanBiometricCallback');
            return;
          } catch (_) {}
        }
        if (window.PublicKeyCredential && navigator.credentials && typeof navigator.credentials.create === 'function') {
          try {
            const challenge = new Uint8Array(32);
            const userId = new Uint8Array(16);
            if (window.crypto && window.crypto.getRandomValues) {
              window.crypto.getRandomValues(challenge);
              window.crypto.getRandomValues(userId);
            }
            const cred = await navigator.credentials.create({
              publicKey: {
                challenge,
                rp: { name: 'OT & Salary Tracker' },
                user: { id: userId, name: 'employee@otsalary.local', displayName: 'Employee' },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
                timeout: 45000,
              },
            });
            if (cred) {
              resolve({ ok: true });
              return;
            }
          } catch (err) {
            const name = String((err && err.name) || '');
            if (name === 'NotAllowedError' || name === 'AbortError') {
              resolve({ ok: false, cancelled: true });
              return;
            }
          }
        }
        resolve({ ok: true });
      });
    }

    async function performBioTouchPunch(mode) {
      const iso = todayIso();
      const ex = store.days[iso] || {};
      let target = mode;
      if (mode === 'auto') {
        target = (!ex.biometricIn || ex.biometricOut) ? 'in' : 'out';
      }
      const statusEl = document.getElementById('bioStatusBadge');
      if (statusEl) statusEl.textContent = '🔒 Unlock Phone to Verify...';
      playBioBeep('scan');
      const authRes = await requestMobileUnlockBiometric(target);
      if (!authRes || !authRes.ok) {
        if (statusEl) statusEl.textContent = '⚠️ Biometric Cancelled';
        showToast('Biometric unlock cancelled');
        return;
      }
      const now = new Date();
      const t = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      loadDateIntoForm(iso);
      if (target === 'in') {
        document.getElementById('entryInTime').value = t;
        playBioBeep('in');
        if (statusEl) statusEl.textContent = '✓ Touch IN Verified ' + fmt12(t);
        saveCurrentForm('✓ Touch ID IN Verified at ' + fmt12(t), {
          biometricIn: true,
          biometricInAt: new Date().toISOString(),
        });
      } else {
        document.getElementById('entryOutTime').value = t;
        playBioBeep('out');
        if (statusEl) statusEl.textContent = '✓ Touch OUT Verified ' + fmt12(t);
        saveCurrentForm('✓ Touch ID OUT Verified at ' + fmt12(t), {
          biometricIn: true,
          biometricOut: true,
          biometricOutAt: new Date().toISOString(),
        });
        const savedDayRecord = store.days[iso];
        if (savedDayRecord && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          try {
            window.dispatchEvent(new CustomEvent('pattan:ot-punch-out-saved', {
              detail: {
                date: iso,
                record: savedDayRecord,
                settings: store.settings,
                rates: getRates(),
                calculation: calcDay(savedDayRecord),
              },
            }));
          } catch (_) {}
        }
      }
    }

    document.getElementById('bioTouchInBtn').addEventListener('click', () => performBioTouchPunch('in'));
    document.getElementById('bioTouchOutBtn').addEventListener('click', () => performBioTouchPunch('out'));

    document.getElementById('saveDayBtn').addEventListener('click', () => saveCurrentForm());

    document.getElementById('saveAllMonthBtn').addEventListener('click', () => {
      const [y, m] = selectedMonth.split('-').map(Number);
      const count = new Date(y, m, 0).getDate();
      const nowMs = Date.now();
      for (let d = 1; d <= count; d++) {
        const iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        if (!store.days[iso]) {
          const isSun = new Date(y, m - 1, d).getDay() === 0;
          store.days[iso] = {
            date: iso,
            status: isSun ? 'holiday_paid' : 'present',
            inTime: store.settings.officeStartTime || '10:00',
            outTime: store.settings.officeEndTime || '18:30',
            otHours: 0,
            extraAllowance: 0,
            note: '',
            savedAt: new Date(nowMs).toISOString(),
            updatedAt: new Date(nowMs).toISOString(),
            updatedAtMs: nowMs,
          };
        }
      }
      saveStore('Saved all ' + count + ' days');
    });

    function shareReport() {
      const text = '📊 *OT & Salary Report (' + selectedMonth + ')*\\n' +
        '💰 Net Salary Receivable: *' + document.getElementById('kpiNetPay').textContent + '*\\n' +
        '⏱️ Extra OT Worked: *' + document.getElementById('kpiOtTime').textContent + '*\\n' +
        '💵 Extra OT Pay: *' + document.getElementById('kpiOtPay').textContent + '*\\n' +
        '📅 Today (' + selectedDate + '): ' + fmt12(document.getElementById('entryInTime').value) + ' to ' + fmt12(document.getElementById('entryOutTime').value);
      if (navigator.share) {
        navigator.share({ title: 'OT & Salary Report', text }).catch(() => {});
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
      }
    }
    document.getElementById('waShareBtn').addEventListener('click', shareReport);
    document.getElementById('shareSummaryBtn').addEventListener('click', shareReport);

    const heroSalaryEl = document.getElementById('heroSalaryInput');
    if (heroSalaryEl) {
      let heroSalTimer = null;
      const syncHeroSal = (pushNow) => {
        const val = Math.max(0, Number(heroSalaryEl.value) || 0);
        store.settings.monthlySalary = val;
        store.settings.settingsUpdatedAt = Date.now();
        const setSalEl = document.getElementById('setSalary');
        if (setSalEl) setSalEl.value = val;
        if (pushNow) {
          saveStore('Monthly Salary set to ₹' + fmtINR(store.settings.monthlySalary));
        } else {
          localStorage.setItem(LS_KEY, JSON.stringify(store));
          renderAll();
          if (heroSalTimer) clearTimeout(heroSalTimer);
          heroSalTimer = setTimeout(() => {
            saveStore();
          }, 250);
        }
      };
      heroSalaryEl.addEventListener('input', () => syncHeroSal(false));
      heroSalaryEl.addEventListener('change', () => syncHeroSal(true));
    }

    ['setSalary','setDaysMode','setStart','setEnd'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        store.settings.monthlySalary = Math.max(1000, Number(document.getElementById('setSalary').value) || 25000);
        store.settings.monthDaysMode = document.getElementById('setDaysMode').value || '30';
        store.settings.officeStartTime = document.getElementById('setStart').value || '10:00';
        store.settings.officeEndTime = document.getElementById('setEnd').value || '18:30';
        store.settings.settingsUpdatedAt = Date.now();
        if (heroSalaryEl) heroSalaryEl.value = store.settings.monthlySalary;
        saveStore('Updated office rules');
      });
    });

    document.getElementById('exportCsvBtn').addEventListener('click', () => {
      const [y, m] = selectedMonth.split('-').map(Number);
      const count = new Date(y, m, 0).getDate();
      const rows = ['Date,Status,Enter Time,Exit Time,Worked,Extra OT,Day Salary (INR),Note'];
      for (let d = 1; d <= count; d++) {
        const iso = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const isSun = new Date(y, m - 1, d).getDay() === 0;
        const rec = store.days[iso] || {
          status: isSun ? 'holiday_paid' : 'present',
          inTime: store.settings.officeStartTime || '10:00',
          outTime: store.settings.officeEndTime || '18:30',
          extraAllowance: 0,
          note: '',
        };
        const c = calcDay(rec);
        rows.push([iso, rec.status, fmt12(rec.inTime), fmt12(rec.outTime), '"' + fmtMins(c.workedMins) + '"', '"' + fmtMins(c.otMins) + '"', c.totalPay.toFixed(2), '"' + String(rec.note || '').replace(/"/g, '""') + '"'].join(','));
      }
      const blob = new Blob([rows.join('\\r\\n')], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'OT-Salary-' + selectedMonth + '.csv';
      a.click();
    });

    document.getElementById('exportJsonBtn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'OT-Salary-Backup-' + selectedMonth + '.json';
      a.click();
    });

    document.getElementById('setSalary').value = store.settings.monthlySalary || 25000;
    if (heroSalaryEl) heroSalaryEl.value = store.settings.monthlySalary || 25000;
    document.getElementById('setDaysMode').value = store.settings.monthDaysMode || '30';
    document.getElementById('setStart').value = store.settings.officeStartTime || '10:00';
    document.getElementById('setEnd').value = store.settings.officeEndTime || '18:30';
    document.getElementById('syncServerUrl').value = INITIAL_SEED.syncUrl || localStorage.getItem('pattan.ot.syncServerUrl') || '';
    document.getElementById('syncNowBtn').addEventListener('click', () => {
      const base = (document.getElementById('syncServerUrl').value || '').trim().replace(/\\/+$/, '');
      if (base) localStorage.setItem('pattan.ot.syncServerUrl', base);
      saveStore('Syncing attendance with PC...', true);
    });

    function tickLiveClock() {
      const now = new Date();
      const h24 = now.getHours(), m60 = now.getMinutes(), s60 = now.getSeconds();
      const p = h24 >= 12 ? 'PM' : 'AM';
      const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
      const hmEl = document.getElementById('liveClockHM');
      const ssEl = document.getElementById('liveClockSS');
      const pEl = document.getElementById('liveClockPeriod');
      const dEl = document.getElementById('liveClockDate');
      if (hmEl) hmEl.textContent = String(h12).padStart(2, '0') + ':' + String(m60).padStart(2, '0');
      if (ssEl) ssEl.textContent = ':' + String(s60).padStart(2, '0');
      if (pEl) pEl.textContent = p;
      if (dEl) dEl.textContent = 'LIVE EXACT CLOCK · ' + now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
      const hrHand = document.getElementById('analogHrHand');
      const minHand = document.getElementById('analogMinHand');
      const secHand = document.getElementById('analogSecHand');
      if (hrHand) hrHand.setAttribute('transform', 'rotate(' + ((h24 % 12) * 30 + m60 * 0.5) + ' 22 22)');
      if (minHand) minHand.setAttribute('transform', 'rotate(' + (m60 * 6 + s60 * 0.1) + ' 22 22)');
      if (secHand) secHand.setAttribute('transform', 'rotate(' + (s60 * 6) + ' 22 22)');
    }
    tickLiveClock();
    setInterval(tickLiveClock, 1000);

    loadDateIntoForm(selectedDate);
  </script>
</body>
</html>`;
}

export const generateStandaloneOtMobileHtml = buildStandaloneOtMobileAppHtml;
export default buildStandaloneOtMobileAppHtml;

