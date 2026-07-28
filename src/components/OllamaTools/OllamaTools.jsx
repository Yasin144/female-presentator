import React, { useEffect, useState } from 'react';

const TOOLS = [
  { id: 'claude', icon: '🤖', name: 'Claude Code', description: 'Coding, debugging and project-wide changes' },
  { id: 'chatgpt', icon: '💬', name: 'ChatGPT', description: 'General assistance through an Ollama model' },
  { id: 'hermes', icon: '🧠', name: 'Hermes Agent', description: 'Autonomous multi-step agent work' },
  { id: 'openclaw', icon: '🦞', name: 'OpenClaw', description: 'Personal assistant and messaging integrations' },
  { id: 'opencode', icon: '▣', name: 'OpenCode', description: 'Open-source terminal coding agent' },
  { id: 'codex-app', icon: '⌘', name: 'Codex App', description: 'Use Codex with local or Ollama cloud models' },
];

export default function OllamaTools() {
  const [status, setStatus] = useState({ ready: false, version: '', checking: true });
  const [launching, setLaunching] = useState('');
  const [message, setMessage] = useState('');

  const refresh = async () => {
    setStatus(current => ({ ...current, checking: true }));
    const result = await window.electronAPI?.getOllamaLaunchStatus?.();
    setStatus({ ready: Boolean(result?.ok), version: result?.version || '', checking: false });
    if (!result?.ok) setMessage(result?.error || 'Ollama was not detected. Install or restart Ollama, then check again.');
  };

  useEffect(() => { refresh(); }, []);

  const launch = async id => {
    setLaunching(id);
    setMessage(`Opening ${TOOLS.find(tool => tool.id === id)?.name || id}…`);
    try {
      const result = await window.electronAPI?.launchOllamaTool?.(id);
      setMessage(result?.ok ? `${result.name} opened in its own terminal window.` : (result?.error || 'The tool could not be opened.'));
    } catch (error) {
      setMessage(error.message || 'The tool could not be opened.');
    } finally {
      setLaunching('');
    }
  };

  const openUpdate = async () => {
    setMessage('Opening the official Ollama Windows updater…');
    const result = await window.electronAPI?.openOllamaUpdate?.();
    setMessage(result?.ok
      ? 'Download and run the official updater. Your models and Pattan settings remain available.'
      : (result?.error || 'Could not open the Ollama updater.'));
  };

  const endCodexSession = async () => {
    setLaunching('codex-restore');
    setMessage('Restoring the original Codex configuration…');
    try {
      const result = await window.electronAPI?.restoreCodexApp?.();
      setMessage(result?.ok
        ? 'Codex Ollama session ended. The original profile is being restored; Codex may close and restart.'
        : (result?.error || 'Could not restore Codex.'));
    } finally {
      setLaunching('');
    }
  };

  const endToolSession = async tool => {
    setLaunching(`end-${tool.id}`);
    setMessage(`Ending ${tool.name} session…`);
    try {
      const result = await window.electronAPI?.endOllamaToolSession?.(tool.id);
      setMessage(result?.ok ? `${tool.name} session ended.` : (result?.error || `Could not end ${tool.name}.`));
    } finally {
      setLaunching('');
    }
  };

  const endAllSessions = async () => {
    setLaunching('end-all');
    setMessage('Ending all AI tool sessions…');
    try {
      const result = await window.electronAPI?.endAllOllamaToolSessions?.();
      setMessage(result?.ok ? 'All AI tool sessions ended. Pattan Presentator remains open.' : (result?.error || 'Could not end all sessions.'));
    } finally {
      setLaunching('');
    }
  };

  return (
    <main style={{ minHeight: '100%', padding: '38px clamp(18px,4vw,64px) 70px', color: '#f8fafc', background: 'radial-gradient(circle at 85% 0%,rgba(16,185,129,.15),transparent 34%),#070b14', fontFamily: 'system-ui,sans-serif' }}>
      <section style={{ maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#67e8f9', fontWeight: 900, fontSize: 12, letterSpacing: '.14em' }}>OLLAMA LAUNCH CENTER</div>
            <h1 style={{ margin: '7px 0 5px', fontSize: 'clamp(26px,4vw,44px)' }}>AI Tools</h1>
            <p style={{ color: '#94a3b8', margin: 0 }}>Choose one tool. It opens separately and uses your selected Ollama model.</p>
          </div>
          <button onClick={refresh} disabled={status.checking} style={{ border: '1px solid rgba(255,255,255,.14)', borderRadius: 12, padding: '10px 14px', background: status.ready ? 'rgba(16,185,129,.14)' : 'rgba(239,68,68,.14)', color: status.ready ? '#6ee7b7' : '#fca5a5', fontWeight: 800, cursor: 'pointer' }}>
            {status.checking ? 'Checking…' : status.ready ? `● Ollama ready ${status.version}` : '● Check Ollama'}
          </button>
        </div>

        <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(270px,1fr))', gap: 15 }}>
          {TOOLS.map(tool => (
            <article key={tool.id} style={{ padding: 20, border: '1px solid rgba(148,163,184,.16)', borderRadius: 18, background: 'linear-gradient(145deg,rgba(30,41,59,.88),rgba(15,23,42,.74))', boxShadow: '0 18px 50px rgba(0,0,0,.2)' }}>
              <div style={{ display: 'flex', gap: 13, alignItems: 'center' }}>
                <div style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 13, background: 'rgba(255,255,255,.07)', fontSize: 24 }}>{tool.icon}</div>
                <div><h2 style={{ margin: 0, fontSize: 18 }}>{tool.name}</h2><div style={{ color: '#94a3b8', fontSize: 13, marginTop: 3 }}>{tool.description}</div></div>
              </div>
              <button onClick={() => launch(tool.id)} disabled={!status.ready || Boolean(launching)} style={{ width: '100%', marginTop: 18, border: 0, borderRadius: 12, padding: '11px 14px', color: '#031713', background: status.ready ? 'linear-gradient(135deg,#6ee7b7,#22d3ee)' : '#334155', fontWeight: 900, cursor: status.ready ? 'pointer' : 'not-allowed' }}>
                {launching === tool.id ? 'Opening…' : `Launch ${tool.name}`}
              </button>
              <button onClick={() => endToolSession(tool)} disabled={Boolean(launching)} style={{ width: '100%', marginTop: 8, border: '1px solid rgba(248,113,113,.22)', borderRadius: 12, padding: '9px 14px', color: '#fca5a5', background: 'rgba(127,29,29,.12)', fontWeight: 800, cursor: 'pointer' }}>
                {launching === `end-${tool.id}` ? 'Ending…' : 'End Session'}
              </button>
            </article>
          ))}
        </div>
        <section style={{ marginTop: 18, padding: 18, borderRadius: 18, border: '1px solid rgba(34,211,238,.2)', background: 'rgba(8,47,73,.26)' }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>Use and update Ollama</h2>
          <p style={{ margin: '7px 0 14px', color: '#94a3b8', fontSize: 13 }}>Open the Ollama menu to run models or select integrations. Windows downloads Ollama updates automatically; the official updater button also lets you install the newest release manually.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => launch('ollama-menu')} disabled={!status.ready || Boolean(launching)} style={{ border: 0, borderRadius: 11, padding: '10px 14px', background: '#22d3ee', color: '#06202a', fontWeight: 900, cursor: 'pointer' }}>Open Ollama Menu</button>
            <button onClick={() => launch('openclaw')} disabled={!status.ready || Boolean(launching)} style={{ border: '1px solid rgba(255,255,255,.14)', borderRadius: 11, padding: '10px 14px', background: 'rgba(255,255,255,.07)', color: '#f8fafc', fontWeight: 800, cursor: 'pointer' }}>Open OpenClaw</button>
            <button onClick={openUpdate} style={{ border: '1px solid rgba(110,231,183,.28)', borderRadius: 11, padding: '10px 14px', background: 'rgba(16,185,129,.14)', color: '#6ee7b7', fontWeight: 800, cursor: 'pointer' }}>Check / Install Ollama Update</button>
            <button onClick={endCodexSession} disabled={Boolean(launching)} style={{ border: '1px solid rgba(251,191,36,.3)', borderRadius: 11, padding: '10px 14px', background: 'rgba(245,158,11,.12)', color: '#fcd34d', fontWeight: 800, cursor: 'pointer' }}>
              {launching === 'codex-restore' ? 'Restoring Codex…' : 'End Codex Ollama Session'}
            </button>
            <button onClick={endAllSessions} disabled={Boolean(launching)} style={{ border: '1px solid rgba(248,113,113,.3)', borderRadius: 11, padding: '10px 14px', background: 'rgba(127,29,29,.16)', color: '#fca5a5', fontWeight: 900, cursor: 'pointer' }}>
              {launching === 'end-all' ? 'Ending All…' : 'End All AI Sessions'}
            </button>
          </div>
          <ol style={{ margin: '15px 0 0', paddingLeft: 20, color: '#cbd5e1', fontSize: 13, lineHeight: 1.7 }}>
            <li>In OpenClaw, complete the first-time model and messaging setup.</li>
            <li>After setup, type your request in its terminal and press Enter.</li>
            <li>Keep that terminal open while OpenClaw is working; type <b>exit</b> to close it.</li>
          </ol>
        </section>
        {message && <div style={{ marginTop: 20, padding: '13px 15px', borderRadius: 12, background: 'rgba(15,23,42,.9)', border: '1px solid rgba(148,163,184,.16)', color: '#cbd5e1' }}>{message}</div>}
        <p style={{ marginTop: 18, color: '#64748b', fontSize: 12 }}>For best speed, launch only one heavy AI tool at a time. Your rhyme, image and video processes continue inside Pattan Presentator.</p>
      </section>
    </main>
  );
}
