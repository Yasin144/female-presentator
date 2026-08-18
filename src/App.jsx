import React, { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import InputPanel from './components/InputPanel';
import StagePanel from './components/StagePanel';
import AgentStudio from './components/AgentStudio/AgentStudio';
import DirectorStudio from './components/Director/DirectorStudio';
import MyExporter from './components/MyExporter/MyExporter';
import RhymeGenerator from './components/RhymeGenerator/RhymeGenerator';
import OllamaTools from './components/OllamaTools/OllamaTools';
import QuoteStudio from './components/QuoteStudio/QuoteStudio';
import VideoResizer from './components/VideoResizer/VideoResizer';
const CaptionBurner = lazy(() => import('./caption/CaptionBurner'));

const LS_KEY   = 'pp-input-style-v1';
const DEFAULTS = { lineHeight: 2.1, fontSize: 0.98, letterSpacing: 0.01 };
const ACTIVE_MODULES = new Set(['presentator', 'agent', 'rhyme', 'quotes', 'director', 'exporter', 'resizer', 'ai-tools']);
const normalizeModule = value => ACTIVE_MODULES.has(value) ? value : 'presentator';

class CaptionErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[CaptionBurner] React view crashed:', error, info);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = String(this.state.error?.message || this.state.error || 'Unknown caption error');
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050814', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <div style={{ width: 'min(560px, 92vw)', border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(127,29,29,0.18)', borderRadius: 18, padding: 22, boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Caption Burner stopped</div>
          <div style={{ marginTop: 10, fontSize: 18, fontWeight: 800 }}>The video screen hit an error, but the app is still alive.</div>
          <pre style={{ marginTop: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#fecaca', background: 'rgba(0,0,0,0.28)', borderRadius: 10, padding: 12, fontSize: 12 }}>{message}</pre>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={() => this.setState({ error: null })} style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Try Again</button>
            <button onClick={this.props.onClose} style={{ padding: '9px 14px', borderRadius: 10, border: 0, background: '#6366f1', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>Back to Main App</button>
          </div>
        </div>
      </div>
    );
  }
}

// Generic error boundary that catches crashes in any module without taking down the whole app.
// When a module crashes, it shows a recovery card instead of a blank/frozen screen.
class ModuleErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[ModuleErrorBoundary:${this.props.moduleName}] crash:`, error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = String(this.state.error?.message || this.state.error || 'Unknown error');
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050814', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <div style={{ width: 'min(560px, 92vw)', border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(127,29,29,0.18)', borderRadius: 18, padding: 22, boxShadow: '0 24px 80px rgba(0,0,0,0.45)' }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{this.props.moduleName} module crashed</div>
          <div style={{ marginTop: 10, fontSize: 18, fontWeight: 800 }}>This module hit an error. The rest of the app is still running.</div>
          <pre style={{ marginTop: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#fecaca', background: 'rgba(0,0,0,0.28)', borderRadius: 10, padding: 12, fontSize: 12 }}>{message}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '9px 18px', borderRadius: 10, border: 0, background: '#6366f1', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
          >Try Again</button>
        </div>
      </div>
    );
  }
}

function loadStyle() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') || DEFAULTS; }
  catch (_) { return DEFAULTS; }
}
function saveStyle(vals) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(vals)); } catch (_) {}
}
function applyToTextarea(vals) {
  const el = document.getElementById('lessonInput');
  if (!el) return;
  el.style.lineHeight    = String(vals.lineHeight);
  el.style.fontSize      = vals.fontSize + 'rem';
  el.style.letterSpacing = vals.letterSpacing + 'em';
}

function App() {
  const [panelOpen, setPanelOpen]       = useState(false);
  const [captionOpen, setCaptionOpen]   = useState(() => {
    if (!window.electronAPI?.isMobileRemote) return false;
    try { return JSON.parse(localStorage.getItem('presentator.mobileView') || '{}').caption === true; }
    catch (_) { return false; }
  });
  const [captionResetKey, setCaptionResetKey] = useState(0);
  const [style, setStyle]               = useState(loadStyle);
  const [currentModule, setCurrentModule] = useState(() => {
    if (!window.electronAPI?.isMobileRemote) return 'presentator';
    try { return normalizeModule(JSON.parse(localStorage.getItem('presentator.mobileView') || '{}').module); }
    catch (_) { return 'presentator'; }
  }); // presentator | agent | rhyme | director | exporter
  const [hideHeader, setHideHeader]     = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mobileModalOpen, setMobileModalOpen] = useState(false);
  const [mobileLinkData, setMobileLinkData] = useState({
    wifiUrl: 'http://192.168.29.161:5173',
    mobileUrl: '',
    updatedAt: ''
  });
  useEffect(() => {
    const openRhymeStudio = (event) => {
      const detail = event?.detail || {};
      try {
        if (detail.engine) localStorage.setItem('pattan.rhyme.requestedEngine', String(detail.engine));
        if (detail.command) localStorage.setItem('pattan.rhyme.requestedCommand', String(detail.command));
      } catch (_) {}
      setCaptionOpen(false);
      setCurrentModule('rhyme');
    };
    window.addEventListener('pp:open-rhyme-studio', openRhymeStudio);
    return () => window.removeEventListener('pp:open-rhyme-studio', openRhymeStudio);
  }, []);
  const [copiedNotice, setCopiedNotice] = useState('');
  const [tunnelSecs, setTunnelSecs] = useState(0);
  const [whatsAppAutoSend, setWhatsAppAutoSend] = useState(true);
  const [whatsAppSwitchBusy, setWhatsAppSwitchBusy] = useState(false);
  const mobileHistoryApplying = useRef(false);
  const mobileHistoryReady = useRef(false);

  // Make Android/iOS browser Back navigate inside the mobile app. At the
  // Presentator home screen a guard entry prevents Back from closing the app.
  useEffect(() => {
    if (!window.electronAPI?.isMobileRemote) return undefined;
    const homeState = { ppMobileView: true, module: 'presentator', caption: false };
    window.history.replaceState(homeState, '', window.location.href);
    const restoredState = { ppMobileView: true, module: currentModule, caption: captionOpen };
    const restoredIsHome = currentModule === 'presentator' && !captionOpen;
    window.history.pushState(restoredIsHome ? { ...homeState, ppMobileGuard: true } : restoredState, '', window.location.href);
    mobileHistoryReady.current = true;

    const onMobileBack = (event) => {
      const state = event.state;
      if (!state?.ppMobileView) {
        window.history.pushState({ ...homeState, ppMobileGuard: true }, '', window.location.href);
        return;
      }
      mobileHistoryApplying.current = true;
      setCaptionOpen(Boolean(state.caption));
      const restoredModule = normalizeModule(state.module);
      setCurrentModule(restoredModule);
      if (restoredModule === 'presentator' && !state.caption && !state.ppMobileGuard) {
        window.history.pushState({ ...homeState, ppMobileGuard: true }, '', window.location.href);
      }
    };
    window.addEventListener('popstate', onMobileBack);
    return () => window.removeEventListener('popstate', onMobileBack);
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.isMobileRemote || !mobileHistoryReady.current) return;
    try {
      localStorage.setItem('presentator.mobileView', JSON.stringify({ module: currentModule, caption: captionOpen }));
    } catch (_) {}
    // Consume exactly one state update caused by popstate. Clearing this flag in
    // a microtask was too early: React's effect ran afterwards and pushed the
    // state we had just navigated away from, making Back highlight one module
    // while another workspace remained visible.
    if (mobileHistoryApplying.current) {
      mobileHistoryApplying.current = false;
      return;
    }
    const next = { ppMobileView: true, module: currentModule, caption: captionOpen };
    const current = window.history.state || {};
    if (current.module === next.module && Boolean(current.caption) === next.caption) return;
    window.history.pushState(next, '', window.location.href);
  }, [currentModule, captionOpen]);

  useEffect(() => {
    window.electronAPI?.getWhatsAppAutoSend?.()
      .then(result => {
        if (result?.ok) setWhatsAppAutoSend(Boolean(result.enabled));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let timer;
    if (!mobileLinkData.mobileUrl) {
      timer = setInterval(() => {
        setTunnelSecs(prev => (prev < 10 ? prev + 1 : prev));
      }, 1000);
    } else {
      setTunnelSecs(0);
    }
    return () => clearInterval(timer);
  }, [mobileLinkData.mobileUrl]);

  useEffect(() => {
    const updateLinkState = (newData) => {
      if (!newData) return;
      setMobileLinkData(prev => {
        if (prev.mobileUrl === (newData.mobileUrl || '') && prev.wifiUrl === (newData.wifiUrl || '')) {
          return prev;
        }
        return {
          wifiUrl: newData.wifiUrl || prev.wifiUrl,
          mobileUrl: newData.mobileUrl || '',
          updatedAt: newData.updatedAt || new Date().toISOString()
        };
      });
    };

    const fetchMobileLink = async () => {
      try {
        if (window.electronAPI?.getMobileLink) {
          const ipcData = await window.electronAPI.getMobileLink();
          if (ipcData?.mobileUrl || ipcData?.wifiUrl) {
            updateLinkState(ipcData);
            return;
          }
        }
        let res = await fetch('/api/mobile-link').catch(() => null);
        if (!res || !res.ok) {
          res = await fetch('http://127.0.0.1:8433/api/mobile-link').catch(() => null);
        }
        if (!res || !res.ok) {
          res = await fetch('/mobile-link.json').catch(() => null);
        }
        if (res && res.ok) {
          const json = await res.json();
          if (json?.mobileUrl || json?.wifiUrl) {
            updateLinkState(json);
          }
        }
      } catch (_) {}
    };

    fetchMobileLink();

    let unhook;
    if (window.electronAPI?.onMobileLinkUpdated) {
      unhook = window.electronAPI.onMobileLinkUpdated((data) => {
        if (data?.mobileUrl || data?.wifiUrl) {
          updateLinkState(data);
        }
      });
    }

    const interval = setInterval(fetchMobileLink, 3000);
    return () => {
      if (unhook) unhook();
      clearInterval(interval);
    };
  }, []);

  const commands = useMemo(() => [
    // NAVIGATION
    { id: 'nav-presentator', category: '🧭 Navigation', title: 'Go to Presentator', desc: 'Switch to main lesson presentation engine', action: () => { setCaptionOpen(false); setCurrentModule('presentator'); } },
    { id: 'nav-agent', category: '🧭 Navigation', title: 'Go to Super Agent Studio', desc: 'Interact with AI agent tools & diagnostics', action: () => { setCaptionOpen(false); setCurrentModule('agent'); } },
    { id: 'nav-rhyme', category: '🧭 Navigation', title: 'Go to Rhyme Generator', desc: 'Create 30-second preschool lyrics and music', action: () => { setCaptionOpen(false); setCurrentModule('rhyme'); } },
    { id: 'nav-director', category: '🧭 Navigation', title: 'Go to AI Director', desc: 'Assemble projects & timeline templates', action: () => { setCaptionOpen(false); setCurrentModule('director'); } },
    { id: 'nav-exporter', category: '🧭 Navigation', title: 'Go to My Exporter', desc: 'Compile final video with voice, logo & captions', action: () => { window.dispatchEvent(new Event('pp:close-translate-audio')); setCaptionOpen(false); setCurrentModule('exporter'); } },
    { id: 'nav-resizer', category: '🧭 Navigation', title: 'Go to Video Resizer', desc: 'Resize and reframe complete videos for social media', action: () => { setCaptionOpen(false); setCurrentModule('resizer'); } },
    
    // QUICK ACTIONS
    { id: 'act-burner', category: '⚡ Quick Actions', title: 'Open Caption Burner', desc: 'Hardburn subtitles with Whisper model', action: () => { setCaptionOpen(true); } },
    { id: 'act-toggle-style', category: '⚡ Quick Actions', title: 'Toggle Input Styles Panel', desc: 'Show/hide line & letter spacing controls', action: () => { setPanelOpen(prev => !prev); } },
    { id: 'act-reset-style', category: '⚡ Quick Actions', title: 'Reset Input Styles', desc: 'Reset font scaling, letter spacing & line height to defaults', action: () => { reset(); if (typeof window.ppSetFontScale === 'function') window.ppSetFontScale(1); if (typeof window.ppSetCanvasLineSpacing === 'function') window.ppSetCanvasLineSpacing(2.1); if (typeof window.ppSetCanvasLetterSpacing === 'function') window.ppSetCanvasLetterSpacing(0.01); } },

    // WORKSPACE LAYOUTS
    { id: 'lay-default', category: '🎨 Workspace Layouts', title: 'Layout: Default', desc: 'Set Exporter layout: Media library + Preview + Inspector', action: () => { window.dispatchEvent(new CustomEvent('pp:change-layout', { detail: 'default' })); } },
    { id: 'lay-organize', category: '🎨 Workspace Layouts', title: 'Layout: Organize', desc: 'Set Exporter layout: Large media list view for sorting', action: () => { window.dispatchEvent(new CustomEvent('pp:change-layout', { detail: 'organize' })); } },
    { id: 'lay-timeline', category: '🎨 Workspace Layouts', title: 'Layout: Timeline', desc: 'Set Exporter layout: Maximized timeline height for audio focus', action: () => { window.dispatchEvent(new CustomEvent('pp:change-layout', { detail: 'timeline' })); } },
    { id: 'lay-shortvideo', category: '🎨 Workspace Layouts', title: 'Layout: Short Video', desc: 'Set Exporter layout: Portrait 9:16 layout formatting', action: () => { window.dispatchEvent(new CustomEvent('pp:change-layout', { detail: 'shortvideo' })); } },
    { id: 'lay-classic', category: '🎨 Workspace Layouts', title: 'Layout: Classic Editor', desc: 'Set Exporter layout: Classic timeline-focused look', action: () => { window.dispatchEvent(new CustomEvent('pp:change-layout', { detail: 'classic' })); } },
    { id: 'lay-dual', category: '🎨 Workspace Layouts', title: 'Layout: Dual View', desc: 'Set Exporter layout: Compare dual video players side-by-side', action: () => { window.dispatchEvent(new CustomEvent('pp:change-layout', { detail: 'dual' })); } },

    // FONT ADJUSTMENTS
    { id: 'size-inc', category: '⚙️ Font Controls', title: 'Increase Font Size (+0.1rem)', desc: 'Enlarge current editor text size', action: () => { setStyle(prev => { const n = Math.min(1.6, prev.fontSize + 0.1); if (typeof window.ppSetFontScale === 'function') window.ppSetFontScale(n); return { ...prev, fontSize: n }; }); } },
    { id: 'size-dec', category: '⚙️ Font Controls', title: 'Decrease Font Size (-0.1rem)', desc: 'Shrink current editor text size', action: () => { setStyle(prev => { const n = Math.max(0.8, prev.fontSize - 0.1); if (typeof window.ppSetFontScale === 'function') window.ppSetFontScale(n); return { ...prev, fontSize: n }; }); } },
    { id: 'line-inc', category: '⚙️ Font Controls', title: 'Increase Line Spacing (+0.2)', desc: 'Add height padding between text rows', action: () => { setStyle(prev => { const n = Math.min(3.2, prev.lineHeight + 0.2); if (typeof window.ppSetCanvasLineSpacing === 'function') window.ppSetCanvasLineSpacing(n); return { ...prev, lineHeight: n }; }); } },
    { id: 'line-dec', category: '⚙️ Font Controls', title: 'Decrease Line Spacing (-0.2)', desc: 'Reduce height padding between text rows', action: () => { setStyle(prev => { const n = Math.max(1.2, prev.lineHeight - 0.2); if (typeof window.ppSetCanvasLineSpacing === 'function') window.ppSetCanvasLineSpacing(n); return { ...prev, lineHeight: n }; }); } },
  ], []);

  const filteredCommands = useMemo(() => {
    if (!searchQuery) return commands;
    const query = searchQuery.toLowerCase();
    return commands.filter(cmd => 
      cmd.title.toLowerCase().includes(query) || 
      cmd.desc.toLowerCase().includes(query) || 
      cmd.category.toLowerCase().includes(query)
    );
  }, [searchQuery, commands]);

  // Keep selectedIndex in bounds when query shifts
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Toggle Command Palette with Ctrl+K or Cmd+K
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
        setSearchQuery('');
        return;
      }
      
      if (!commandPaletteOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        setCommandPaletteOpen(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredCommands.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
          setCommandPaletteOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, filteredCommands, selectedIndex]);


  useEffect(() => {
    const handleStateChange = (e) => {
      setHideHeader(!!e.detail.isPresenting);
    };
    window.addEventListener('presentation-state-change', handleStateChange);
    return () => window.removeEventListener('presentation-state-change', handleStateChange);
  }, []);

  useEffect(() => {
    const openLocalCaptioning = () => {
      setCaptionOpen(false);
      setHideHeader(false);
      setCurrentModule('presentator');
    };
    window.addEventListener('presentator-open-ai-video-captioning-local', openLocalCaptioning);
    return () => window.removeEventListener('presentator-open-ai-video-captioning-local', openLocalCaptioning);
  }, []);

  // Apply on every style change
  useEffect(() => { applyToTextarea(style); saveStyle(style); }, [style]);

  // Also apply after scripts finish loading (lessonInput may not exist yet)
  useEffect(() => {
    const t = setTimeout(() => applyToTextarea(style), 2000);
    return () => clearTimeout(t);
  }, []);

  const update = useCallback((key, val) => {
    setStyle(prev => ({ ...prev, [key]: val }));
  }, []);

  const reset = useCallback(() => { setStyle(DEFAULTS); }, []);

  const sendDirectorProjectToPresentator = useCallback(({ text, action, settings }) => {
    try {
      localStorage.setItem('pattan-director-active-project-v1', JSON.stringify({ text, settings, updatedAt: new Date().toISOString() }));
    } catch (_) {}
    setCaptionOpen(false);
    setCurrentModule('presentator');
    window.setTimeout(() => {
      const lesson = document.getElementById('lessonInput');
      if (!lesson) return;
      lesson.value = text;
      lesson.dispatchEvent(new Event('input', { bubbles: true }));
      lesson.focus();
      if (action === 'narrate') {
        window.setTimeout(() => document.getElementById('loadAnjaliNarrationBtn')?.click(), 350);
      }
    }, 120);
  }, []);

  useEffect(() => {
    // Cache-buster: change this version string any time a legacy JS file changes
    const _CB = '?v=20260803-sing-song-upload-queue-fix';
    const scriptSources = [
      "../logo-data.js" + _CB,
      "../script.js" + _CB,
      "../caption-script.js" + _CB,
      "app://voice/vendor/three.min.js",
      "app://voice/vendor/GLTFLoader.js",
      "../3d-engine.js" + _CB,
      "../dubbing-studio.js" + _CB,
      "../translate-dub-module.js" + _CB,
    ];

    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-presentator-src="${src}"]`);
        if (existing) {
          if (existing.dataset.loaded === "true") {
            resolve();
            return;
          }

          existing.addEventListener("load", resolve, { once: true });
          existing.addEventListener("error", reject, { once: true });
          return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.dataset.presentatorSrc = src;
        script.addEventListener("load", () => {
          script.dataset.loaded = "true";
          resolve();
        }, { once: true });
        script.addEventListener("error", reject, { once: true });
        document.body.appendChild(script);
      });

    if (!window.__presentatorLegacyBootPromise) {
      window.__presentatorLegacyBootPromise = (async () => {
        for (const src of scriptSources) {
          await loadScript(src);
        }
        // Apply styles once scripts have mounted the textarea
        applyToTextarea(style);
      })().catch((error) => {
        window.__presentatorLegacyBootPromise = null;
        throw error;
      });
    }

    window.__presentatorLegacyBootPromise.catch((error) => {
      console.error("Failed to load legacy engine scripts:", error);
    });
  }, []);


  return (
    <>
      {window.electronAPI?.isMobileRemote && (captionOpen || currentModule !== 'presentator') && (
        <button
          type="button"
          onClick={() => window.history.back()}
          aria-label="Go back"
          title="Back"
          style={{
            position: 'fixed', left: 14, bottom: 18, zIndex: 20000,
            minWidth: 52, height: 46, padding: '0 15px', borderRadius: 23,
            border: '1px solid rgba(255,255,255,0.22)',
            background: 'rgba(9,13,22,0.94)', color: '#fff',
            fontSize: 22, fontWeight: 900, cursor: 'pointer',
            boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
            backdropFilter: 'blur(12px)'
          }}
        >←</button>
      )}
      {/* ── Top Navigation Bar (Hidden when Caption Burner is full-screen or presenting) ── */}
      {!captionOpen && !hideHeader && (
        <header className="app-topbar" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          background: '#090d16',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          minHeight: '50px',
          boxSizing: 'border-box',
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          maxWidth: '100vw'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#f97316', letterSpacing: '0.3px', fontFamily: "system-ui" }}>🎤 PATTAN</span>
            <button
              type="button"
              onClick={() => setMobileModalOpen(true)}
              style={{
                width: 30, height: 30, padding: 0,
                background: mobileLinkData.mobileUrl ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.10)',
                border: mobileLinkData.mobileUrl ? '1px solid rgba(52,211,153,.38)' : '1px solid rgba(248,113,113,.35)',
                borderRadius: '50%',
                color: mobileLinkData.mobileUrl ? '#6ee7b7' : '#fca5a5',
                fontSize: 13,
                cursor: 'pointer',
                display: 'grid', placeItems: 'center',
                boxShadow: mobileLinkData.mobileUrl ? '0 0 8px rgba(16,185,129,.18)' : '0 0 8px rgba(239,68,68,.18)'
              }}
              title="Link status"
              aria-label={mobileLinkData.mobileUrl ? 'Link active' : `Link inactive after ${tunnelSecs} seconds`}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: mobileLinkData.mobileUrl ? '#10b981' : '#ef4444', boxShadow: `0 0 7px ${mobileLinkData.mobileUrl ? '#10b981' : '#ef4444'}` }} />
            </button>
            <button
              type="button"
              disabled={whatsAppSwitchBusy}
              onClick={async () => {
                const next = !whatsAppAutoSend;
                setWhatsAppSwitchBusy(true);
                try {
                  const result = await window.electronAPI?.setWhatsAppAutoSend?.(next);
                  if (result?.ok) setWhatsAppAutoSend(Boolean(result.enabled));
                } finally {
                  setWhatsAppSwitchBusy(false);
                }
              }}
              title="Alerts"
              aria-label={whatsAppAutoSend ? 'Process alerts enabled' : 'Process alerts disabled'}
              style={{
                width: 30, height: 30, padding: 0, borderRadius: '50%',
                border: `1px solid ${whatsAppAutoSend ? 'rgba(37,211,102,.5)' : 'rgba(255,255,255,.15)'}`,
                background: whatsAppAutoSend ? 'rgba(37,211,102,.14)' : 'rgba(255,255,255,.05)',
                color: whatsAppAutoSend ? '#86efac' : 'rgba(255,255,255,.48)',
                fontSize: 12, fontWeight: 900, cursor: whatsAppSwitchBusy ? 'wait' : 'pointer'
              }}
            >
              {whatsAppAutoSend ? '◉' : '○'}
            </button>
            <button 
              onClick={() => setCommandPaletteOpen(true)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '6px',
                padding: '3px 8px',
                color: 'rgba(255, 255, 255, 0.45)',
                fontSize: '10px',
                fontFamily: 'monospace, system-ui, sans-serif',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.15s ease'
              }}
              title="Open Command Palette (Ctrl+K)"
            >
              <span>⌘K</span>
            </button>
          </div>
          <div style={{ display: 'flex', gap: '2px' }}>
            <button
              className="app-nav-button"
              data-active={currentModule === 'presentator'}
              onClick={() => setCurrentModule('presentator')}
              style={{
                padding: '6px 14px',
                borderRadius: '20px',
                border: 'none',
                background: currentModule === 'presentator' ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'transparent',
                color: currentModule === 'presentator' ? '#fff' : 'rgba(255,255,255,0.5)',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: currentModule === 'presentator' ? '0 4px 12px rgba(99,102,241,0.25)' : 'none',
                fontFamily: "system-ui"
              }}
            >Presentator</button>
            <button
              className="app-nav-button"
              data-active={currentModule === 'agent'}
              onClick={() => { setCaptionOpen(false); setCurrentModule('agent'); }}
              style={{
                padding: '6px 14px',
                borderRadius: '20px',
                border: 'none',
                background: currentModule === 'agent' ? 'linear-gradient(135deg,#10b981,#06b6d4)' : 'transparent',
                color: currentModule === 'agent' ? '#fff' : 'rgba(255,255,255,0.5)',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: currentModule === 'agent' ? '0 4px 12px rgba(16,185,129,0.25)' : 'none',
                fontFamily: "system-ui"
              }}
            >Super Agent</button>
            <button
              className="app-nav-button"
              data-active={currentModule === 'rhyme'}
              onClick={() => { setCaptionOpen(false); setCurrentModule('rhyme'); }}
              style={{
                padding: '6px 14px', borderRadius: '20px', border: 'none',
                background: currentModule === 'rhyme' ? 'linear-gradient(135deg,#f472b6,#fbbf24)' : 'transparent',
                color: currentModule === 'rhyme' ? '#241006' : 'rgba(255,255,255,0.5)',
                fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: currentModule === 'rhyme' ? '0 4px 12px rgba(244,114,182,0.28)' : 'none',
                fontFamily: 'system-ui'
              }}
            >Rhyme Maker</button>
            <button
              className="app-nav-button"
              data-active={currentModule === 'quotes'}
              onClick={() => { setCaptionOpen(false); setCurrentModule('quotes'); }}
              style={{
                padding: '6px 14px', borderRadius: '20px', border: 'none',
                background: currentModule === 'quotes' ? 'linear-gradient(135deg,#f7d477,#e79d2d)' : 'transparent',
                color: currentModule === 'quotes' ? '#241704' : 'rgba(255,255,255,0.5)',
                fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: currentModule === 'quotes' ? '0 4px 12px rgba(231,157,45,0.3)' : 'none',
                fontFamily: 'system-ui'
              }}
            >Quote Studio</button>
            <button
              className="app-nav-button"
              data-active={currentModule === 'director'}
              onClick={() => { setCaptionOpen(false); setCurrentModule('director'); }}
              style={{
                padding: '6px 14px', borderRadius: '20px', border: 'none',
                background: currentModule === 'director' ? 'linear-gradient(135deg,#d4af6a,#8f6b35)' : 'transparent',
                color: currentModule === 'director' ? '#17130d' : 'rgba(255,255,255,0.5)',
                fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: currentModule === 'director' ? '0 4px 12px rgba(199,168,106,0.25)' : 'none',
                fontFamily: 'system-ui'
              }}
            >AI Director</button>
            <button
              className="app-nav-button"
              data-active={currentModule === 'exporter'}
              onPointerDown={(event) => { if (event.button === 0) { window.dispatchEvent(new Event('pp:close-translate-audio')); setCaptionOpen(false); setCurrentModule('exporter'); } }}
              onClick={() => { window.dispatchEvent(new Event('pp:close-translate-audio')); setCaptionOpen(false); setCurrentModule('exporter'); }}
              style={{
                padding: '6px 14px', borderRadius: '20px', border: 'none',
                background: currentModule === 'exporter' ? 'linear-gradient(135deg,#d4af6a,#8f6b35)' : 'transparent',
                color: currentModule === 'exporter' ? '#17130d' : 'rgba(255,255,255,0.5)',
                fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: currentModule === 'exporter' ? '0 4px 12px rgba(199,168,106,0.25)' : 'none',
                fontFamily: 'system-ui'
              }}
            >My Exporter</button>
            <button
              className="app-nav-button"
              data-active={currentModule === 'resizer'}
              onClick={() => { setCaptionOpen(false); setCurrentModule('resizer'); }}
              style={{
                padding: '6px 14px', borderRadius: '20px', border: 'none',
                background: currentModule === 'resizer' ? 'linear-gradient(135deg,#38bdf8,#6366f1)' : 'transparent',
                color: currentModule === 'resizer' ? '#fff' : 'rgba(255,255,255,0.5)',
                fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: currentModule === 'resizer' ? '0 4px 12px rgba(56,189,248,0.3)' : 'none',
                fontFamily: 'system-ui'
              }}
            >Video Resizer</button>
            <button
              className="app-nav-button"
              data-active={currentModule === 'ai-tools'}
              onClick={() => { setCaptionOpen(false); setCurrentModule('ai-tools'); }}
              style={{
                padding: '6px 14px', borderRadius: '20px', border: 'none',
                background: currentModule === 'ai-tools' ? 'linear-gradient(135deg,#6ee7b7,#22d3ee)' : 'transparent',
                color: currentModule === 'ai-tools' ? '#031713' : 'rgba(255,255,255,0.5)',
                fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: currentModule === 'ai-tools' ? '0 4px 12px rgba(34,211,238,0.25)' : 'none',
                fontFamily: 'system-ui'
              }}
            >AI Tools</button>
          </div>
          <div style={{ width: '12px' }}></div>
        </header>
      )}

      {/* Container with top margin to account for header height */}
      <div style={{ height: '100%' }}>
        {/* ── Full-screen Caption Burner ── */}
        <div style={{ display: captionOpen ? 'block' : 'none', height: '100%' }}>
          <CaptionErrorBoundary
            resetKey={captionResetKey}
            onClose={() => {
              setCaptionOpen(false);
              setCaptionResetKey(k => k + 1);
            }}
          >
            <Suspense fallback={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:'#0e0e0e',color:'rgba(255,255,255,0.3)',fontSize:'12px'}}>Loading…</div>}>
              <CaptionBurner onClose={() => setCaptionOpen(false)} />
            </Suspense>
          </CaptionErrorBoundary>
        </div>

        {/* ── Normal Presentator UI ── */}
        <div style={{ display: (captionOpen || currentModule !== 'presentator') ? 'none' : 'block', height: '100%', paddingTop: !captionOpen ? '50px' : 0, paddingBottom: '140px', boxSizing: 'border-box', overflowY: 'auto', overflowX: 'hidden' }}>
          <main className="app-shell">
            <InputPanel />
            <StagePanel />
          </main>

          {/* Floating Global Elements from legacy index.html */}
          <div id="taskPercentIndicator" className="control-indicator playback-percent-indicator app-task-percent-indicator hidden" aria-live="polite">0%</div>
          <img id="stageLogoImage" className="hidden" alt="Info kids logo" />
          
          <div id="floatingColorPalette" style={{ display: "none", position: "fixed", zIndex: 10000, background: "#161b22", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px", boxShadow: "0 8px 24px rgba(0,0,0,0.5)", width: "154px", flexWrap: "wrap", gap: "6px", pointerEvents: "auto" }}>
              {["#ffffff","#000000","#173e58","#0d7ea9","#16a34a","#dc2626","#facc15","#7a1f1f"].map(c => (
                <div key={c} className="color-swatch" data-color={c} style={{ width: "20px", height: "20px", borderRadius: "50%", background: c, cursor: "pointer", border: "1px solid #444" }} title={c}></div>
              ))}
          </div>

          {/* ══ Floating Input Style Module ══════════════════════════════════════ */}
          {/* ⚙ FAB button — always visible bottom-right */}
          <button
            onClick={() => setPanelOpen(o => !o)}
            title="Input Style Settings"
            style={{
              position:'fixed', bottom:'24px', right:'24px', zIndex:9000,
              width:'52px', height:'52px', borderRadius:'50%',
              background:'linear-gradient(135deg,#6366f1,#8b5cf6)',
              border:'none', color:'#fff', fontSize:'1.4rem', cursor:'pointer',
              boxShadow: panelOpen ? '0 6px 32px rgba(99,102,241,0.8)' : '0 6px 24px rgba(99,102,241,0.5)',
              display:'flex', alignItems:'center', justifyContent:'center',
              transform: panelOpen ? 'rotate(45deg)' : 'none',
              transition:'transform 0.2s, box-shadow 0.2s',
            }}
          >⚙</button>

          {/* Floating settings panel */}
          {panelOpen && (
            <div style={{
              position:'fixed', bottom:'86px', right:'24px', zIndex:9001,
              width:'300px', padding:'20px 22px 16px',
              background:'#1a1f2e', borderRadius:'16px',
              border:'1px solid rgba(255,255,255,0.1)',
              boxShadow:'0 20px 60px rgba(0,0,0,0.7)',
              fontFamily:"'Segoe UI',system-ui,sans-serif",
              display:'flex', flexDirection:'column', gap:'16px',
            }}>
              {/* Header */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ color:'#fff', fontWeight:700, fontSize:'0.95rem' }}>⚙ Input Style</span>
                <button onClick={() => setPanelOpen(false)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.45)', fontSize:'1.1rem', cursor:'pointer', padding:'0 4px' }}>✕</button>
              </div>

              {/* Line Spacing — textarea CSS only */}
              <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ color:'rgba(255,255,255,0.7)', fontSize:'0.83rem' }}>↕ Line Spacing</span>
                  <span style={{ color:'#a5b4fc', fontWeight:700, fontSize:'0.85rem' }}>{style.lineHeight}</span>
                </div>
                <input type="range" min={1.2} max={3.2} step={0.1} value={style.lineHeight}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    const el = document.getElementById('lessonInput');
                    if (el) el.style.lineHeight = String(v);
                    if (typeof window.ppSetCanvasLineSpacing === 'function') window.ppSetCanvasLineSpacing(v);
                    update('lineHeight', v);
                  }}
                  style={{ width:'100%', accentColor:'#6366f1', cursor:'pointer', height:'5px' }} />
              </div>

              {/* Font Size — textarea CSS + canvas fontScale */}
              <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ color:'rgba(255,255,255,0.7)', fontSize:'0.83rem' }}>Aa Font Size</span>
                  <span style={{ color:'#a5b4fc', fontWeight:700, fontSize:'0.85rem' }}>{style.fontSize}rem</span>
                </div>
                <input type="range" min={0.8} max={1.6} step={0.05} value={style.fontSize}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    // Update textarea CSS
                    const el = document.getElementById('lessonInput');
                    if (el) el.style.fontSize = v + 'rem';
                    // Update canvas font scale instantly
                    if (typeof window.ppSetFontScale === 'function') window.ppSetFontScale(v);
                    update('fontSize', v);
                  }}
                  style={{ width:'100%', accentColor:'#6366f1', cursor:'pointer', height:'5px' }} />
              </div>

              {/* Letter Spacing — textarea CSS only */}
              <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ color:'rgba(255,255,255,0.7)', fontSize:'0.83rem' }}>A→Z Letter Spacing</span>
                  <span style={{ color:'#a5b4fc', fontWeight:700, fontSize:'0.85rem' }}>{Number(style.letterSpacing).toFixed(3)}em</span>
                </div>
                <input type="range" min={0} max={0.15} step={0.005} value={style.letterSpacing}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    const el = document.getElementById('lessonInput');
                    if (el) el.style.letterSpacing = v + 'em';
                    if (typeof window.ppSetCanvasLetterSpacing === 'function') window.ppSetCanvasLetterSpacing(v);
                    update('letterSpacing', v);
                  }}
                  style={{ width:'100%', accentColor:'#6366f1', cursor:'pointer', height:'5px' }} />
              </div>

              <button onClick={() => {
                reset();
                if (typeof window.ppSetFontScale === 'function') window.ppSetFontScale(1);
                if (typeof window.ppSetCanvasLineSpacing === 'function') window.ppSetCanvasLineSpacing(2.1);
                if (typeof window.ppSetCanvasLetterSpacing === 'function') window.ppSetCanvasLetterSpacing(0.01);
              }} style={{
                padding:'8px', borderRadius:'8px',
                border:'1px solid rgba(255,255,255,0.12)',
                background:'rgba(255,255,255,0.04)',
                color:'rgba(255,255,255,0.5)', fontSize:'0.82rem',
                cursor:'pointer', width:'100%', letterSpacing:'0.03em',
              }}>↺ Reset to Default</button>
            </div>
          )}

          {/* ── Caption Burner FAB ── */}
          <button
            onClick={() => setCaptionOpen(true)}
            title="Caption Burner (Hugging Face Whisper)"
            style={{
              position:'fixed', bottom:'88px', right:'24px', zIndex:9000,
              width:'52px', height:'52px', borderRadius:'50%',
              background:'linear-gradient(135deg,#3b82f6,#8b5cf6)',
              border:'none', color:'#fff', fontSize:'1.4rem', cursor:'pointer',
              boxShadow:'0 6px 24px rgba(59,130,246,0.5)',
              display: captionOpen ? 'none' : 'flex',
              alignItems:'center', justifyContent:'center',
            }}
          >🎬</button>
        </div>

        {/* ── Standalone Super Agent Studio ── */}
        <div style={{
          display: (!captionOpen && currentModule === 'agent') ? 'block' : 'none',
          position: 'fixed',
          top: '50px',
          right: 0,
          bottom: 0,
          left: 0,
          height: 'auto',
          overflow: 'hidden',
          boxSizing: 'border-box',
          zIndex: 20
        }}>
          <ModuleErrorBoundary moduleName="Super Agent">
            <AgentStudio />
          </ModuleErrorBoundary>
        </div>

        {/* ── 30-second Kids Rhyme Generator ── */}
        <div style={{ display: (!captionOpen && currentModule === 'rhyme') ? 'block' : 'none', height: '100vh', paddingTop: '50px', boxSizing: 'border-box' }}>
          <ModuleErrorBoundary moduleName="Rhyme Generator">
            <RhymeGenerator />
          </ModuleErrorBoundary>
        </div>

        {/* ── Viral Quote Studio ── */}
        <div style={{ display: (!captionOpen && currentModule === 'quotes') ? 'block' : 'none', height: '100vh', overflow: 'auto', boxSizing: 'border-box' }}>
          <ModuleErrorBoundary moduleName="Viral Quote Studio">
            <QuoteStudio />
          </ModuleErrorBoundary>
        </div>

        {/* ── AI Director production workspace ── */}
        <div style={{ display: (!captionOpen && currentModule === 'director') ? 'block' : 'none', height: '100vh', paddingTop: '50px', boxSizing: 'border-box' }}>
          <ModuleErrorBoundary moduleName="AI Director">
            <DirectorStudio
              onSendToPresentator={sendDirectorProjectToPresentator}
              onOpenCaptions={() => setCaptionOpen(true)}
              onOpenExporter={() => { setCaptionOpen(false); setCurrentModule('exporter'); }}
            />
          </ModuleErrorBoundary>
        </div>

        {/* ── My Exporter timeline editor ── */}
        {/* IMPORTANT: Always kept mounted (hidden via display:none) to prevent crash-on-remount.
            The old code used conditional rendering ({condition && <MyExporter/>}) which unmounted
            and remounted MyExporter on every tab switch. This caused:
              1. IPC listener leaks (onMyExporterProgress registered multiple times)
              2. All useState initializers re-running (heavy localStorage + probe calls)
              3. React reconciliation errors from rapidly-cycling heavy component trees
            Solution: keep it always in the DOM, just toggle display. The active prop lets
            MyExporter know when it is visible so it can pause/resume playback etc. */}
        <div style={{ display: (!captionOpen && currentModule === 'exporter') ? 'block' : 'none', height: '100vh', paddingTop: '50px', boxSizing: 'border-box' }}>
          <ModuleErrorBoundary moduleName="My Exporter">
            <MyExporter active={!captionOpen && currentModule === 'exporter'} />
          </ModuleErrorBoundary>
        </div>
        <div style={{ display: (!captionOpen && currentModule === 'ai-tools') ? 'block' : 'none', height: '100vh', paddingTop: '50px', boxSizing: 'border-box', overflow: 'auto' }}>
          <ModuleErrorBoundary moduleName="AI Tools">
            <OllamaTools />
          </ModuleErrorBoundary>
        </div>
        <div style={{ display: (!captionOpen && currentModule === 'resizer') ? 'block' : 'none', height: '100vh', paddingTop: '50px', boxSizing: 'border-box', overflow: 'auto' }}>
          <ModuleErrorBoundary moduleName="Video Ratio Master">
            <VideoResizer />
          </ModuleErrorBoundary>
        </div>
      </div>

      {/* ── Universal Command Palette Overlay ── */}
      {commandPaletteOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(5, 8, 20, 0.75)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          zIndex: 100000,
          display: 'flex',
          justifyContent: 'center',
          paddingTop: '80px',
          animation: 'fadeIn 0.2s ease-out'
        }} onClick={() => setCommandPaletteOpen(false)}>
          <style>{`
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes slideDown { from { transform: translateY(-20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            .cmd-item {
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 10px 14px;
              margin: 4px 0;
              border-radius: 10px;
              cursor: pointer;
              background: transparent;
              transition: all 0.15s ease;
              border: 1px solid transparent;
            }
            .cmd-item:hover {
              background: rgba(255, 255, 255, 0.04);
            }
            .cmd-item-active {
              background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.2)) !important;
              border-color: rgba(99, 102, 241, 0.4) !important;
              box-shadow: 0 4px 12px rgba(99, 102, 241, 0.1);
            }
            .cmd-scrollbar::-webkit-scrollbar {
              width: 6px;
            }
            .cmd-scrollbar::-webkit-scrollbar-track {
              background: transparent;
            }
            .cmd-scrollbar::-webkit-scrollbar-thumb {
              background: rgba(255, 255, 255, 0.15);
              border-radius: 3px;
            }
            .cmd-scrollbar::-webkit-scrollbar-thumb:hover {
              background: rgba(255, 255, 255, 0.3);
            }
          `}</style>
          
          <div style={{
            width: '100%',
            maxWidth: '560px',
            background: 'linear-gradient(160deg, #101423, #0b0d18)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.8), 0 0 40px rgba(99, 102, 241, 0.05)',
            borderRadius: '16px',
            height: 'fit-content',
            maxHeight: '480px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            animation: 'slideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            fontFamily: "system-ui, -apple-system, sans-serif"
          }} onClick={(e) => e.stopPropagation()}>
            
            {/* Search Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '16px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              position: 'relative'
            }}>
              <span style={{ fontSize: '18px', marginRight: '12px', opacity: 0.7 }}>🔍</span>
              <input
                autoFocus
                type="text"
                placeholder="Type a command or search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#fff',
                  fontSize: '15px',
                  lineHeight: '1.5'
                }}
              />
              <div style={{
                fontSize: '10px',
                padding: '4px 8px',
                background: 'rgba(255, 255, 255, 0.06)',
                borderRadius: '6px',
                color: 'rgba(255, 255, 255, 0.5)',
                fontWeight: 'bold',
                letterSpacing: '0.05em'
              }}>ESC TO CLOSE</div>
            </div>

            {/* Scrollable list */}
            <div className="cmd-scrollbar" style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px'
            }}>
              {filteredCommands.length === 0 ? (
                <div style={{
                  padding: '24px',
                  textAlign: 'center',
                  color: 'rgba(255, 255, 255, 0.4)',
                  fontSize: '13px'
                }}>No commands found matching "{searchQuery}"</div>
              ) : (
                filteredCommands.map((cmd, idx) => {
                  const isActive = idx === selectedIndex;
                  return (
                    <div
                      key={cmd.id}
                      className={`cmd-item ${isActive ? 'cmd-item-active' : ''}`}
                      onClick={() => {
                        cmd.action();
                        setCommandPaletteOpen(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                        <span style={{
                          color: isActive ? '#fff' : '#e0e4f0',
                          fontSize: '13.5px',
                          fontWeight: 600
                        }}>{cmd.title}</span>
                        <span style={{
                          color: isActive ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.4)',
                          fontSize: '11px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>{cmd.desc}</span>
                      </div>
                      <span style={{
                        fontSize: '9.5px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        padding: '3px 7px',
                        borderRadius: '4px',
                        background: isActive ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)',
                        color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
                        marginLeft: '12px',
                        flexShrink: 0
                      }}>{cmd.category}</span>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer / Helper bar */}
            <div style={{
              padding: '10px 16px',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              background: 'rgba(0,0,0,0.15)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '11px',
              color: 'rgba(255, 255, 255, 0.4)'
            }}>
              <div>
                <span>Use </span>
                <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 5px', borderRadius: '3px', margin: '0 2px' }}>↑</kbd>
                <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 5px', borderRadius: '3px', margin: '0 2px' }}>↓</kbd>
                <span> to navigate, </span>
                <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 5px', borderRadius: '3px', margin: '0 2px' }}>Enter</kbd>
                <span> to run</span>
              </div>
              <div>Press <kbd style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 5px', borderRadius: '3px' }}>Ctrl + K</kbd> anywhere</div>
            </div>

          </div>
        </div>
      )}
      {/* ── Mobile Link Popup Modal ────────────────────────────────────── */}
      {mobileModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px'
        }} onClick={() => setMobileModalOpen(false)}>
          <div style={{
            background: '#0d111d',
            border: '1px solid rgba(103, 232, 249, 0.3)',
            borderRadius: '24px',
            padding: '24px',
            maxWidth: '480px',
            width: '100%',
            boxShadow: '0 25px 80px rgba(0,0,0,0.8)',
            color: '#fff',
            fontFamily: 'system-ui, sans-serif'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '24px' }}>📱</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#67e8f9' }}>Mobile Connect Center</h3>
                  <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#94a3b8' }}>Live 24/7 Mobile Data & Wi-Fi Links</p>
                </div>
              </div>
              <button type="button" onClick={() => setMobileModalOpen(false)} style={{ background: 'rgba(255,255,255,0.08)', border: 0, color: '#fff', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
            </div>

            {copiedNotice && (
              <div style={{ background: '#10b98122', border: '1px solid #10b98155', color: '#6ee7b7', padding: '8px 12px', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold', marginBottom: '14px', textAlign: 'center' }}>
                {copiedNotice}
              </div>
            )}

            {/* LIVE SERVER STATUS CARD */}
            <div style={{
              background: mobileLinkData.mobileUrl ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              border: mobileLinkData.mobileUrl ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: '14px',
              padding: '12px 14px',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: mobileLinkData.mobileUrl ? '#10b981' : '#ef4444',
                  boxShadow: mobileLinkData.mobileUrl ? '0 0 12px #10b981' : '0 0 12px #ef4444'
                }}></span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 900, color: mobileLinkData.mobileUrl ? '#34d399' : '#f87171' }}>
                    SERVER STATUS: {mobileLinkData.mobileUrl ? '🟢 ACTIVE (4G/5G ONLINE)' : `🔴 INACTIVE (${tunnelSecs}s)`}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                    {mobileLinkData.mobileUrl 
                      ? '🌐 Live Encrypted 4G/5G Tunnel Active'
                      : '🌐 Starting Cloudflare encrypted tunnel... Please wait'}
                  </div>
                </div>
              </div>
              <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.08)', color: '#cbd5e1', padding: '3px 8px', borderRadius: '6px', fontWeight: 700 }}>
                {mobileLinkData.updatedAt ? new Date(mobileLinkData.updatedAt).toLocaleTimeString() : 'LIVE'}
              </span>
            </div>

            {/* Action Bar: Generate / Refresh Button */}
            <div style={{ marginBottom: '14px' }}>
              <button
                type="button"
                onClick={async () => {
                  setCopiedNotice('⚡ Generating fresh live 4G/5G mobile link & WhatsApp notification...');
                  if (window.electronAPI?.generateMobileLink) {
                    const generated = await window.electronAPI.generateMobileLink();
                    if (generated?.mobileUrl) updateLinkState(generated);
                  }
                  try {
                    const res = await fetch('/api/mobile-link');
                    if (res.ok) {
                      const json = await res.json();
                      if (json?.mobileUrl || json?.wifiUrl) updateLinkState(json);
                    }
                  } catch (_) {}
                  setTimeout(() => setCopiedNotice(''), 3500);
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '14px',
                  border: '1px solid rgba(103, 232, 249, 0.4)',
                  background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                  color: '#fff',
                  fontWeight: 900,
                  fontSize: '13px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 20px rgba(14, 165, 233, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                <span>⚡</span> Generate / Refresh Link & QR Code
              </button>
            </div>

            {/* 4G / 5G Mobile Data Link & QR Code (Simultaneous) */}
            <div style={{ background: '#141a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '14px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 900, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🌐 4G / 5G Mobile Data Link (Anywhere)</span>
                <span style={{ fontSize: '10px', background: '#38bdf822', color: '#38bdf8', padding: '2px 6px', borderRadius: '4px', fontWeight: 800 }}>LIVE ENCRYPTED</span>
              </div>
              {mobileLinkData.mobileUrl ? (
                <div>
                  <div style={{ fontSize: '13px', fontFamily: 'monospace', background: '#0a0d18', padding: '10px 12px', borderRadius: '10px', color: '#e2e8f0', wordBreak: 'break-all', marginBottom: '8px' }}>
                    {mobileLinkData.mobileUrl}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(mobileLinkData.mobileUrl);
                      setCopiedNotice('✅ 4G/5G Mobile Link Copied! Paste on your phone.');
                      setTimeout(() => setCopiedNotice(''), 3000);
                    }}
                    style={{ width: '100%', padding: '10px', borderRadius: '10px', border: 0, background: 'linear-gradient(135deg, #0284c7, #2563eb)', color: '#fff', fontWeight: 900, cursor: 'pointer', fontSize: '13px', marginBottom: '8px' }}
                  >
                    📋 Copy 4G/5G Mobile Link
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const waText = encodeURIComponent(`📱 Presentator 4G/5G Mobile Link:\n${mobileLinkData.mobileUrl}\n\n🏠 Home Wi-Fi Link:\n${mobileLinkData.wifiUrl}`);
                      window.open(`https://api.whatsapp.com/send?phone=917386726193&text=${waText}`, '_blank');
                      setCopiedNotice('💬 Opening WhatsApp to send link to 7386726193!');
                      setTimeout(() => setCopiedNotice(''), 3000);
                    }}
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: '10px',
                      border: 0,
                      background: 'linear-gradient(135deg, #25D366, #128C7E)',
                      color: '#fff',
                      fontWeight: 900,
                      cursor: 'pointer',
                      fontSize: '13px',
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      boxShadow: '0 4px 15px rgba(37, 211, 102, 0.35)'
                    }}
                  >
                    <span>💬</span> Send Link to My WhatsApp (+91 7386726193)
                  </button>

                  {/* QR Code Displayed Simultaneously */}
                  <div style={{ textAlign: 'center', background: '#0a0d18', padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8', marginBottom: '6px' }}>📷 Scan with Phone Camera to Open Instantly:</div>
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(mobileLinkData.mobileUrl)}`}
                      alt="Mobile Access QR Code"
                      style={{ width: '140px', height: '140px', borderRadius: '12px', background: '#fff', padding: '6px', margin: 'auto', display: 'block' }}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ background: '#0a0d18', padding: '12px', borderRadius: '12px', marginBottom: '8px', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 800, color: '#38bdf8', marginBottom: '6px' }}>
                    <span>⏳ Starting Secure Cloudflare Tunnel...</span>
                    <span>{tunnelSecs}s / Est. 3-5s</span>
                  </div>
                  <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(95, Math.max(15, (tunnelSecs / 5) * 100))}%`, background: 'linear-gradient(90deg, #38bdf8, #818cf8)', transition: 'width 0.4s ease' }} />
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: '10px', color: '#94a3b8', textAlign: 'center' }}>Connecting encrypted 4G/5G mobile tunnel in background...</p>
                </div>
              )}
            </div>

            {/* Home Wi-Fi Link */}
            <div style={{ background: '#141a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px', padding: '14px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 900, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🏠 Home Wi-Fi Link</span>
                <span style={{ fontSize: '10px', background: '#a78bfa22', color: '#a78bfa', padding: '2px 6px', borderRadius: '4px', fontWeight: 800 }}>LOCAL IP</span>
              </div>
              <div style={{ fontSize: '13px', fontFamily: 'monospace', background: '#0a0d18', padding: '10px 12px', borderRadius: '10px', color: '#e2e8f0', wordBreak: 'break-all', marginBottom: '8px' }}>
                {mobileLinkData.wifiUrl}
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(mobileLinkData.wifiUrl);
                  setCopiedNotice('✅ Home Wi-Fi Link Copied!');
                  setTimeout(() => setCopiedNotice(''), 3000);
                }}
                style={{ width: '100%', padding: '9px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontWeight: 800, cursor: 'pointer', fontSize: '12px' }}
              >
                📋 Copy Home Wi-Fi Link
              </button>
            </div>

            <div style={{ marginTop: '14px', textAlign: 'center', fontSize: '10px', color: '#64748b' }}>
              Auto-syncs live Cloudflare session links every 3 seconds.
            </div>
          </div>
        </div>
      )}
    </>
  );

}

export default App;
