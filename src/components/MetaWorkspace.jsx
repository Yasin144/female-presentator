import React, { useEffect, useRef, useState } from 'react';
import '../meta-workspace.css';

const TOOLS = [
  { id: 'spark', title: 'Muse Spark 1.3', badge: 'Cloud', description: 'Write stories, scripts, explanations and code. Text answers only; no commands run.' },
  { id: 'voice', title: 'Muse Voice Transcribe', badge: 'Cloud', description: 'Turn a recording into text with speaker labels. Not a narration voice.' },
  { id: 'image', title: 'Muse Image', badge: 'Cloud', description: 'Generate a picture from your description. Preview it and save a PNG.' },
  { id: 'glimmer', title: 'Muse Glimmer', badge: 'Local · separate setup', description: 'Connect an existing local Glimmer server. No automatic model download.' },
];
const MODEL = { spark: 'muse-spark-1.3', image: 'muse-image-1.0', voice: 'muse-voice-transcribe-1.0' };
const DOCS = 'https://dev.meta.ai/docs/';
function download(data, name, type) {
  const isImage = typeof data === 'string' && data.startsWith('data:image/png;base64,');
  const url = isImage ? data : URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  if (!isImage) setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export default function MetaWorkspace({ active }) {
  const [tool, setTool] = useState('spark');
  const [status, setStatus] = useState(null);
  const [key, setKey] = useState('');
  const [localKey, setLocalKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('muse-spark-1.3');
  const [size, setSize] = useState('1024x1024');
  const [audio, setAudio] = useState(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const lock = useRef(false);
  const fileRef = useRef(null);
  const api = window.electronAPI;
  const desktop = Boolean(api?.metaStatus && !api.isMobileRemote);
  const local = tool === 'glimmer';
  const ready = desktop && (local ? status?.localReady && status?.hasLocalKey : status?.cloudModels?.includes(tool === 'spark' ? model : MODEL[tool]));

  useEffect(() => {
    if (!active || !desktop) return;
    let disposed = false;
    api.metaStatus().then(value => { if (!disposed) { if (value?.ok) setStatus(value); else setNotice(value?.error || 'Meta backend is not loaded. Restart the app when your work is idle.'); } }).catch(() => { if (!disposed) setNotice('Meta backend is not loaded. Restart the app when your work is idle.'); });
    return () => { disposed = true; };
  }, [active, desktop]);
  useEffect(() => { if (!active) { setKey(''); setLocalKey(''); } }, [active]);

  async function action(label, fn) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setNotice('');
    try {
      const value = await fn();
      if (!value?.ok) setNotice(value?.error || 'The request could not finish.');
      else if ('hasCloudKey' in value) { setStatus(value); setNotice(label === 'Checking connection' ? 'Connection checked. Available models are shown below; a listed model can still require account permissions or credits.' : 'Settings updated.'); }
      return value;
    } catch (_) { setNotice('The operation could not finish. Check the connection. If this is a new update, restart only when your work is idle.'); }
    finally { lock.current = false; setBusy(''); }
  }
  function changeTool(id) { if (lock.current) return; setTool(id); setResult(null); setNotice(''); setConsent(false); }
  async function saveKey(kind) {
    const value = kind === 'cloud' ? key : localKey;
    if (kind === 'cloud') setKey(''); else setLocalKey('');
    await action('Saving encrypted key', () => api.metaSaveKey({ kind, key: value }));
  }
  async function run() {
    await action('Preparing request', async () => {
      setResult(null);
      const input = { tool, model, prompt, size, consent };
      if (tool === 'voice') {
        if (!audio || audio.size > 29_000_000) return { ok: false, error: 'Choose a WAV recording up to 29 MB and 10 minutes.' };
        input.audio = new Uint8Array(await audio.arrayBuffer());
      }
      setBusy(local ? 'Waiting for local Glimmer' : 'Waiting for Meta');
      const value = await api.metaRun(input);
      if (value?.ok) setResult({ ...value, tool });
      return value;
    });
  }
  function clear() { setPrompt(''); setAudio(null); if (fileRef.current) fileRef.current.value = ''; setConsent(false); setResult(null); setNotice(''); }

  return <section className="meta-workspace" aria-labelledby="meta-title">
    <header className="meta-heading"><span className="meta-eyebrow">Pattan Workspace · Optional connection</span><h1 id="meta-title">Meta AI</h1><p>Choose a Muse tool. Your existing local tools work independently.</p></header>
    {!desktop && <p className="meta-notice" role="status">Open Meta AI in the Windows desktop app. Keys and cloud uploads are not available from the phone or web view.</p>}
    <nav className="meta-tool-grid" aria-label="Muse tools">{TOOLS.map(item => <button key={item.id} type="button" className="meta-tool" aria-pressed={tool === item.id} disabled={Boolean(busy)} onClick={() => changeTool(item.id)}><span className="meta-badge">{item.badge}</span><strong>{item.title}</strong><span>{item.description}</span></button>)}</nav>

    <div className="meta-columns"><aside className="meta-card">
      <h2>{local ? 'Local server connection' : 'Meta Model API connection'}</h2>
      {local ? <><p>Requires a separately installed llama.cpp server at <code>127.0.0.1:8080</code>, serving the <code>muse-glimmer</code> alias.</p><p className="meta-notice">This PC: {status?.memoryGB || 'about 16'} GB RAM. The documented model file alone is about 17 GB; Meta describes a 24–32 GB memory setup. Installation is not recommended on this PC alongside your local tools.</p><p>No Ollama, model, or always-on agent is installed by this module.</p></> : <p>Spark, Image and Voice Transcribe send only the prompt or recording you select here to Meta. Internet, model access and available credits may be required.</p>}
      <label htmlFor="meta-key">{local ? 'Local server API key' : 'Meta Model API key'}</label>
      <input id="meta-key" type="password" autoComplete="off" spellCheck="false" maxLength={4096} value={local ? localKey : key} disabled={!desktop || Boolean(busy)} onChange={e => local ? setLocalKey(e.target.value) : setKey(e.target.value)} placeholder="Paste the full key here, not in chat" />
      <p className="meta-small">Encrypted with Windows secure storage. Never returned to the screen, written to logs, or saved in browser storage.</p>
      <div className="meta-actions"><button type="button" disabled={!desktop || Boolean(busy) || !(local ? localKey : key)} onClick={() => saveKey(local ? 'local' : 'cloud')}>Save key securely</button><button type="button" disabled={!desktop || Boolean(busy) || !(local ? status?.hasLocalKey : status?.hasCloudKey)} onClick={() => action('Removing saved key', () => api.metaForgetKey(local ? 'local' : 'cloud'))}>Remove key</button></div>
      <button type="button" disabled={!desktop || Boolean(busy) || (!local && !status?.hasCloudKey)} onClick={() => action('Checking connection', () => api.metaCheck(local ? 'local' : 'cloud'))}>Check connection{local ? '' : ' & models'}</button>
      <p className="meta-small">{local ? (status?.localReady ? 'Local Glimmer alias found. Generation still requires a valid server key.' : 'Local server not checked or unavailable.') : (status?.hasCloudKey ? `Key saved. ${status.cloudModels?.length || 0} supported models found in the last check.` : 'No Meta key saved.')}</p>
      {status?.storageError && <p role="alert">{status.storageError}</p>}
      <a href={DOCS + (local ? 'muse-glimmer/llama-cpp' : 'authentication')} target="_blank" rel="noreferrer">Official setup guide ↗</a>
      {!local && <p className="meta-small">The supplied Bash installer installs Muse Code for macOS/Linux, not these app integrations. It has not been run.</p>}
    </aside>

    <div className="meta-card meta-editor"><h2>{TOOLS.find(t => t.id === tool).title}</h2>
      {tool === 'spark' && <><label htmlFor="meta-model">API tier</label><select id="meta-model" value={model} disabled={Boolean(busy)} onChange={e => { setModel(e.target.value); setConsent(false); }}><option value="muse-spark-1.3">Muse Spark 1.3 · Standard</option><option value="muse-spark-1.3-contributor">Muse Spark 1.3 · Contributor</option></select><p className="meta-small">Contributor is optional and may have different data-use terms. Review your account’s <a href={DOCS + 'pricing-rate-limits'} target="_blank" rel="noreferrer">tier terms and pricing</a> first. Each request is independent; previous answers are not sent.</p></>}
      {tool === 'voice' ? <><label htmlFor="meta-audio">Choose a recording</label><input ref={fileRef} id="meta-audio" type="file" accept=".wav,audio/wav" disabled={Boolean(busy) || !desktop} onChange={e => { setAudio(e.target.files?.[0] || null); setConsent(false); setResult(null); }} /><p>Mono, 16-bit PCM WAV at 16 or 24 kHz. Maximum 10 minutes / 29 MB. Convert other formats before selecting them.</p><p className="meta-small">Provides speaker labels and speech-turn timestamps—not word timing. Your existing local captioning and narration are unchanged.</p></> : <><label htmlFor="meta-prompt">{tool === 'image' ? 'Describe your picture' : 'What would you like help with?'}</label><textarea id="meta-prompt" rows={7} maxLength={16000} value={prompt} disabled={Boolean(busy) || !desktop} onChange={e => { setPrompt(e.target.value); setConsent(false); }} placeholder={tool === 'image' ? 'A realistic dog with clean edges on a plain background…' : 'Write a moving 60-second story about kindness…'} /><p className="meta-small">{prompt.length.toLocaleString()} / 16,000 characters. Suggestions only: no app control, file edits, or command execution.</p></>}
      {tool === 'image' && <><label htmlFor="meta-size">Picture shape</label><select id="meta-size" value={size} disabled={Boolean(busy)} onChange={e => setSize(e.target.value)}><option value="1024x1024">Square</option><option value="1536x1024">Landscape</option><option value="1024x1536">Portrait</option></select><p className="meta-small">One PNG per request. Final pixel dimensions are chosen by Meta. This first integration generates new images; editing and refinement are not included.</p></>}
      {!local && <label className="meta-consent"><input type="checkbox" checked={consent} disabled={Boolean(busy) || !desktop} onChange={e => setConsent(e.target.checked)} /><span>Send this {tool === 'voice' ? 'recording' : 'prompt'} to Meta. I understand usage charges and my selected tier’s data terms may apply.</span></label>}
      <div className="meta-actions"><button type="button" className="meta-primary" disabled={!ready || Boolean(busy) || (!local && !consent) || (tool === 'voice' ? !audio : !prompt.trim())} onClick={run}>{local ? 'Ask local Glimmer' : tool === 'voice' ? 'Send recording & transcribe' : tool === 'image' ? 'Send prompt & generate picture' : 'Send prompt to Spark'}</button><button type="button" disabled={Boolean(busy)} onClick={clear}>Clear this work</button></div>
      {!ready && <p className="meta-small">{local ? 'Set up and check your local server to unlock this tool.' : 'Save your key and check model access to unlock this tool.'}</p>}
      {busy && <div className="meta-notice" role="status"><span>{busy}… You can return Home; the request stays active. No automatic retries.</span>{/Waiting/.test(busy) && <button type="button" onClick={async () => { await api.metaCancel().catch(() => {}); }}>Cancel request</button>}</div>}
      {notice && <p className="meta-notice" role="status">{notice}</p>}
      {result && <section className="meta-result" aria-labelledby="meta-result-title"><h3 id="meta-result-title">Result</h3>{result.warning && <p role="status">{result.warning}</p>}{result.image ? <><img src={result.image} alt="Image generated from your prompt" /><button type="button" onClick={() => download(result.image, 'muse-image.png')}>Save PNG</button></> : <><pre>{result.text || 'No speech detected.'}</pre><button type="button" onClick={() => download(result.text || '', result.tool === 'voice' ? 'muse-transcript.txt' : 'muse-answer.txt', 'text/plain;charset=utf-8')}>Save text</button>{result.turns?.length > 0 && <><details><summary>Speaker labels &amp; turn timestamps</summary>{result.turns.map((turn, i) => <p key={i}><strong>{turn.speaker || 'Speaker'} · {turn.startMs === null ? '?' : (turn.startMs / 1000).toFixed(1)}–{turn.endMs === null ? '?' : (turn.endMs / 1000).toFixed(1)}s</strong><br />{turn.transcript}</p>)}</details><button type="button" onClick={() => download(JSON.stringify({ transcript: result.text, turns: result.turns }, null, 2), 'muse-transcript.json', 'application/json')}>Save speaker data</button></>}</>}</section>}
    </div></div>
  </section>;
}
