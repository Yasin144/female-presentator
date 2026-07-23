import { useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'pattan-agent-studio-v1';
const MAX_ROUNDS = 20;
const AVAILABLE_AGENT_TOOLS = new Set(['inspect_state', 'list_files', 'read_file', 'write_file', 'search_in_files', 'diff_files', 'list_checkpoints', 'restore_checkpoint', 'validate_web_app', 'inspect_code', 'apply_code_patch', 'run_terminal_command', 'restart_application', 'analyze_code', 'run_build_check', 'check_servers', 'read_diagnostics', 'restart_server', 'open_code_canvas', 'generate_image', 'create_animated_video', 'finish']);
const AGENT_TOOL_ALIASES = {
  create_image: 'generate_image',
  image_generation: 'generate_image',
  generate_picture: 'generate_image',
  make_image: 'generate_image',
  animate_image: 'create_animated_video',
  create_video: 'create_animated_video',
  code_canvas: 'open_code_canvas',
  open_canvas: 'open_code_canvas',
  terminal: 'run_terminal_command',
  shell: 'run_terminal_command',
  build: 'run_build_check',
};

const DAILY_ACTIONS = [
  { icon: 'wrench', label: 'Health Check', prompt: 'Check every Presentator server and important workflow. Report only failures, risks, and the exact next action.' },
  { icon: 'spark', label: 'Daily Brief', prompt: 'Give me a concise daily workspace brief: active work, recent outputs, likely unfinished tasks, and the three best next actions.' },
  { icon: 'file', label: 'Summarize Files', prompt: 'Analyze all attached references and give me an executive summary, key facts, action items, and anything inconsistent or missing.' },
  { icon: 'image', label: 'Lesson Visual', prompt: 'Create a polished classroom-ready educational visual from my attached reference or current topic.' },
  { icon: 'video', label: 'Video Scene', prompt: 'Create a high-quality eight-second educational video scene using my attached image or topic.' },
  { icon: 'wrench', label: 'Fix My Module', prompt: 'Inspect the current Presentator module, diagnose the real failure, apply the smallest safe repair, and verify it.' },
];

const IMAGE_FILTERS = [
  { name: 'Photorealistic', icon: '📸', suffix: 'photorealistic 8k resolution, hyper-detailed photography, professional studio lighting, uncompressed master' },
  { name: 'Celebrity Portrait', icon: '🌟', suffix: 'celebrity portrait masterpiece, ultra-detailed 8k face, studio lighting, photorealistic, uncompressed' },
  { name: 'Anime / Manga', icon: '🎨', suffix: 'anime style, vibrant colors, detailed line art, makoto shinkai aesthetic, high quality illustration' },
  { name: 'Cyberpunk', icon: '🚀', suffix: 'cyberpunk sci-fi style, glowing neon lights, futuristic city background, volumetric lighting, 8k render' },
  { name: 'Cinematic 3D', icon: '🏛️', suffix: 'cinematic 3d octanorender, pixar quality lighting, ultra-detailed 3d character render' },
  { name: 'Oil Painting', icon: '🖼️', suffix: 'fine oil painting texture, rich canvas brush strokes, classic masterpiece artwork' },
  { name: 'Fantasy Concept', icon: '🧙', suffix: 'epic fantasy concept art, magical atmosphere, intricate details, artstation trending' },
  { name: 'Vintage Retro', icon: '🎞️', suffix: 'vintage 35mm film grain photo, 1980s retro aesthetics, warm cinematic color grading' },
  { name: 'Pencil Sketch', icon: '✏️', suffix: 'detailed charcoal pencil sketch, hand drawn crosshatching, artistic monochrome drawing' },
];

const makeChat = () => ({
  id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  title: 'New chat',
  createdAt: Date.now(),
  messages: [],
  references: [],
  assets: [],
});

const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const createInstantWebsite = request => {
  const objective = escapeHtml(String(request || 'New website').replace(/\s+/g, ' ').trim());
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${objective}</title><style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:linear-gradient(135deg,#fff7ed,#fdf2f8);color:#292524}nav{display:flex;justify-content:space-between;align-items:center;padding:22px 7%;background:#ffffffcc;backdrop-filter:blur(14px);position:sticky;top:0}.brand{font-size:1.25rem;font-weight:900;color:#db2777}.links{display:flex;gap:22px}a{color:inherit;text-decoration:none;font-weight:700}.hero{min-height:72vh;display:grid;place-items:center;text-align:center;padding:70px 7%}.hero div{max-width:850px}.tag{display:inline-block;padding:8px 14px;border-radius:999px;background:#fce7f3;color:#be185d;font-weight:800}h1{font-size:clamp(2.6rem,7vw,5.8rem);line-height:.95;margin:24px 0;background:linear-gradient(90deg,#db2777,#f97316);color:transparent;background-clip:text}p{font-size:1.12rem;line-height:1.7;color:#57534e}.cta{display:inline-block;margin-top:20px;padding:15px 24px;border-radius:14px;background:#db2777;color:white;box-shadow:0 14px 35px #db277744}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;padding:30px 7% 80px}.card{background:white;border-radius:22px;padding:26px;box-shadow:0 18px 50px #9f123922;transition:.25s}.card:hover{transform:translateY(-7px)}.icon{font-size:3rem}footer{text-align:center;padding:30px;background:#292524;color:white}@media(max-width:600px){.links{display:none}}
</style></head><body><nav><div class="brand">✨ Dream Studio</div><div class="links"><a href="#features">Explore</a><a href="#contact">Contact</a></div></nav>
<main><section class="hero"><div><span class="tag">LIVE STARTER • AI IS REFINING</span><h1>${objective}</h1><p>Your working preview is ready immediately. Super Agent is now improving the copy, visuals, interactions, and final details in the background.</p><a class="cta" href="#features">Explore now →</a></div></section>
<section id="features" class="cards"><article class="card"><div class="icon">💖</div><h2>Made with care</h2><p>A warm, trustworthy experience designed around your goal.</p></article><article class="card"><div class="icon">✨</div><h2>Premium quality</h2><p>Polished responsive design for desktop and mobile visitors.</p></article><article class="card"><div class="icon">🛡️</div><h2>Safe and clear</h2><p>Accessible structure, friendly navigation, and clear actions.</p></article></section></main><footer id="contact">Created by Pattan Super Agent • Refinement in progress</footer>
</body></html>`;
};

const loadChats = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) && saved.length ? saved : [makeChat()];
  } catch {
    return [makeChat()];
  }
};

const kindIcon = {
  document: 'file',
  image: 'image',
  video: 'video',
};

const Icon = ({ name, size = 18, className = '' }) => {
  const paths = {
    plus: <><path d="M12 5v14M5 12h14" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    retry: <><path d="M20 6v5h-5" /><path d="M19 11a8 8 0 1 0 1 5" /></>,
    spark: <><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></>,
    upload: <><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M5 15v4h14v-4" /></>,
    file: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5M10 13h5M10 17h5" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 15-5-4L5 20" /></>,
    video: <><rect x="3" y="5" width="14" height="14" rx="2" /><path d="m17 10 4-2v8l-4-2z" /></>,
    wrench: <><path d="M14.7 6.3a4 4 0 0 0-5-5L12 4 9 7 6.3 4.7a4 4 0 0 0 5 5L4 17l3 3 7.7-7.7a4 4 0 0 0 0-6Z" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    send: <><path d="M12 19V5m0 0L6 11m6-6 6 6" /></>,
    stop: <><rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none" /></>,
    close: <><path d="m7 7 10 10M17 7 7 17" /></>,
    folder: <><path d="M3 6h7l2 2h9v11H3z" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {paths[name] || paths.spark}
    </svg>
  );
};

function AssistantMessageBlock({ message }) {
  const [showThoughts, setShowThoughts] = useState(false);
  const planItems = Array.isArray(message.plan) ? message.plan : [];
  const actionItems = Array.isArray(message.actions) ? message.actions : [];
  const durationSec = message.performance?.totalDurationMs
    ? (message.performance.totalDurationMs / 1000).toFixed(1)
    : null;

  return (
    <div className="group max-w-[82%] pt-1">
      {/* Collapsible Thoughts Block */}
      {message.thinking && (
        <div className="mb-3">
          <button
            onClick={() => setShowThoughts(prev => !prev)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white text-[11px] font-medium transition-colors border border-white/5"
          >
            <span>💭</span>
            <span>{showThoughts ? 'Hide Super Agent Decision Summary' : 'Show Super Agent Decision Summary'}</span>
            {durationSec && <span className="opacity-60">({durationSec}s)</span>}
          </button>
          
          {showThoughts && (
            <div className="mt-2 p-3.5 rounded-xl bg-black/40 border border-white/5 text-[12.5px] text-white/60 leading-6 font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto dark-scrollbar">
              {message.thinking}
            </div>
          )}
        </div>
      )}

      {/* Checklist Plan Block */}
      {planItems.length > 0 && (
        <div className="mb-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/5">
          <div className="text-[11.5px] font-semibold text-white/40 mb-2 uppercase tracking-wider flex items-center gap-1.5">
            <span>📋</span> Execution Plan
          </div>
          <div className="space-y-1.5">
            {planItems.map((step, idx) => (
              <div key={idx} className="flex items-start gap-2.5 text-[12.5px] text-white/80 leading-5">
                <span className="text-emerald-400 mt-0.5">✔</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dispatched Actions/Tools List */}
      {actionItems.length > 0 && (
        <div className="mb-3.5 flex flex-wrap gap-2">
          {actionItems.map((act, idx) => (
            <div key={idx} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10.5px] font-medium font-mono" title={act.reason}>
              <span>🛠</span>
              <span>{act.tool}</span>
            </div>
          ))}
        </div>
      )}

      {/* Main Text Content */}
      <div className="text-[14px] leading-7 whitespace-pre-wrap bg-[#1a1a1a] border border-white/5 rounded-2xl px-4 py-3 shadow-lg">{message.text}</div>
      
      {/* Footer Copy & Model indicator */}
      <div className="mt-2 opacity-0 group-hover:opacity-100 flex items-center gap-2">
        <button onClick={() => navigator.clipboard.writeText(message.text)} className="text-white/35 hover:text-white" title="Copy">
          <Icon name="copy" size={15} />
        </button>
        {message.model && <span className="text-[9px] text-white/25">{message.model}</span>}
      </div>
    </div>
  );
}

function CodeCanvas({ canvas, onChange, onClose }) {
  const [previewIssue, setPreviewIssue] = useState('');
  const [previewLoaded, setPreviewLoaded] = useState(false);
  useEffect(() => {
    const receivePreviewStatus = event => {
      if (event.data?.source !== 'pattan-code-canvas') return;
      if (event.data.type === 'error') setPreviewIssue(String(event.data.message || 'Unknown preview error'));
    };
    window.addEventListener('message', receivePreviewStatus);
    return () => window.removeEventListener('message', receivePreviewStatus);
  }, []);
  useEffect(() => {
    if (!canvas) return undefined;
    const closeOnEscape = event => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [canvas, onClose]);
  if (!canvas) return null;
  const canPreview = canvas.preview && canvas.language === 'html';
  const errorReporter = `<script>window.addEventListener('error',function(e){parent.postMessage({source:'pattan-code-canvas',type:'error',message:e.message+' at '+(e.filename||'inline')+':'+(e.lineno||0)},'*')});window.addEventListener('unhandledrejection',function(e){parent.postMessage({source:'pattan-code-canvas',type:'error',message:'Unhandled promise: '+String(e.reason)},'*')});</script>`;
  const previewDocument = canPreview
    ? (/<head[^>]*>/i.test(canvas.code) ? canvas.code.replace(/<head[^>]*>/i, match => `${match}${errorReporter}`) : `${errorReporter}${canvas.code}`)
    : '';
  const previewUrl = canPreview ? `data:text/html;charset=utf-8,${encodeURIComponent(previewDocument)}` : '';
  return (
    <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-md flex items-center justify-center px-5 pb-5 pt-[100px]">
      <div className="w-full h-full max-w-[1500px] max-h-[calc(100vh-120px)] rounded-2xl border border-white/10 bg-[#0b0d14] shadow-2xl overflow-hidden flex flex-col">
        <header className="h-14 shrink-0 px-4 flex items-center justify-between border-b border-white/10 bg-[#11141e]">
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">{canvas.title || 'Code Canvas'}</div>
            <div className="text-[10px] uppercase tracking-widest text-emerald-400">{canvas.language} • Live Code Canvas</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="h-8 px-3 rounded-lg bg-emerald-500 text-black text-xs font-bold hover:bg-emerald-400">← Back to Prompt</button>
            <button onClick={() => navigator.clipboard.writeText(canvas.code)} className="h-8 px-3 rounded-lg border border-white/10 text-xs hover:bg-white/5">Copy code</button>
            <button onClick={onClose} className="w-8 h-8 rounded-lg border border-white/10 hover:bg-white/5 flex items-center justify-center"><Icon name="close" size={15} /></button>
          </div>
        </header>
        <div className={`flex-1 min-h-0 grid ${canPreview ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div className="min-w-0 min-h-0 flex flex-col border-r border-white/10">
            <div className="h-9 shrink-0 px-4 flex items-center text-[10px] font-bold uppercase tracking-widest text-white/40 bg-[#0e1018]">Editable source</div>
            <textarea
              value={canvas.code}
              onChange={event => { setPreviewIssue(''); setPreviewLoaded(false); onChange(event.target.value); }}
              spellCheck={false}
              className="flex-1 min-h-0 w-full resize-none bg-[#080a10] p-5 font-mono text-[12px] leading-6 text-emerald-100 outline-none dark-scrollbar"
            />
          </div>
          {canPreview && (
            <div className="min-w-0 min-h-0 flex flex-col bg-white">
              <div className="h-9 shrink-0 px-4 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-black/50 bg-slate-100 border-b border-slate-200">
                <span>Live preview</span>
                <span className={previewIssue ? 'text-red-600' : previewLoaded ? 'text-emerald-700' : ''}>{previewIssue ? `Runtime error: ${previewIssue}` : previewLoaded ? 'Rendered • no runtime errors' : 'Rendering…'}</span>
              </div>
              <iframe title={canvas.title || 'Code preview'} src={previewUrl} onLoad={() => setPreviewLoaded(true)} sandbox="allow-scripts allow-forms allow-modals" className="flex-1 min-h-0 w-full border-0 bg-white" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MissionDashboard({ mission, onClose, onStop, liveStatus, liveElapsed, liveProgress }) {
  if (!mission) return null;
  const elapsed = mission.finishedAt && mission.startedAt
    ? Math.max(0, Math.round((mission.finishedAt - mission.startedAt) / 1000))
    : liveElapsed;
  const successfulTools = mission.tools.filter(item => item.ok).length;
  const failedTools = mission.tools.length - successfulTools;
  return (
    <div className="fixed inset-0 z-[290] bg-black/75 backdrop-blur-md flex items-center justify-center p-6">
      <div className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl border border-white/10 bg-[#0d1018] shadow-2xl flex flex-col">
        <header className="h-16 shrink-0 px-5 flex items-center justify-between border-b border-white/10 bg-[#121622]">
          <div><div className="text-sm font-black">Mission Control</div><div className="text-[10px] text-emerald-400 uppercase tracking-widest">Super Agent execution telemetry</div></div>
          <div className="flex items-center gap-2">
            {!mission.finishedAt && <button onClick={onStop} className="h-9 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-black flex items-center gap-2 shadow-lg shadow-red-900/30"><Icon name="stop" size={14}/> STOP PROCESS</button>}
            <button onClick={onClose} className="w-9 h-9 rounded-lg border border-white/10 hover:bg-white/5 flex items-center justify-center"><Icon name="close" size={15} /></button>
          </div>
        </header>
        <div className="p-5 overflow-y-auto dark-scrollbar space-y-5">
          <div className="rounded-xl border border-white/5 bg-white/[0.025] p-4">
            <div className="text-[10px] uppercase tracking-widest text-white/35">Objective</div>
            <div className="mt-2 text-sm leading-6 text-white/90">{mission.objective || 'No active mission'}</div>
          </div>
          {!mission.finishedAt && (
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 flex items-start justify-between gap-4">
              <div className="flex-1"><div className="text-[10px] uppercase tracking-widest text-blue-300/60">Working now</div><div className="mt-1.5 text-sm text-blue-100">{liveStatus || mission.status}</div><div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-all duration-500" style={{ width: `${Math.max(2, Number(liveProgress || 0))}%` }} /></div></div>
              <span className="shrink-0 font-mono text-sm text-blue-300">{Math.round(liveProgress || 0)}% • {liveElapsed}s</span>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ['Status', mission.status],
              ['Reasoning', mission.reasoningProfile || 'Selecting'],
              ['Round', `${mission.round}/${MAX_ROUNDS}`],
              ['Tools', String(mission.tools.length)],
              ['Elapsed', `${elapsed}s`],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/5 bg-[#141824] p-3"><div className="text-[9px] uppercase tracking-widest text-white/30">{label}</div><div className="mt-1.5 text-xs font-bold text-emerald-300 truncate">{value}</div></div>)}
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/5 bg-[#111520] p-4">
              <div className="flex justify-between text-[11px] font-bold"><span>Execution log</span><span className="text-white/40">{successfulTools} passed • {failedTools} failed</span></div>
              <div className="mt-3 space-y-2 max-h-72 overflow-y-auto dark-scrollbar">
                {mission.tools.length ? mission.tools.map((item, index) => <div key={`${item.tool}-${index}`} className="flex items-start gap-2 rounded-lg bg-black/20 px-3 py-2 text-[11px]"><span className={item.ok ? 'text-emerald-400' : 'text-red-400'}>{item.ok ? '✓' : '!'}</span><div className="min-w-0"><div className="font-mono text-white/80 truncate">{item.tool}</div>{item.error && <div className="text-red-300/80 mt-1 break-words">{item.error}</div>}</div></div>) : mission.activeTool ? <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-[11px] text-blue-200"><span className="animate-spin">◌</span><span className="font-mono">{mission.activeTool}</span><span className="text-white/40">running now</span></div> : <div className="text-[11px] text-white/30">Waiting for tool execution…</div>}
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-[#111520] p-4 space-y-3">
              <div className="text-[11px] font-bold">Quality gates</div>
              {[
                ['Code Canvas delivered', mission.canvasOpened],
                ['Browser validation completed', mission.browserValidated],
                ['Build/test completed', mission.buildValidated],
                ['No unresolved tool failures', failedTools === 0],
              ].map(([label, passed]) => <div key={label} className="flex items-center justify-between text-[11px]"><span className="text-white/60">{label}</span><span className={passed ? 'text-emerald-400' : 'text-white/25'}>{passed ? 'Passed' : 'Pending'}</span></div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AgentStudio() {
  const [chats, setChats] = useState(loadChats);
  const [activeId, setActiveId] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [progress, setProgress] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [health, setHealth] = useState(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [codeCanvas, setCodeCanvas] = useState(null);
  const [agentMemory, setAgentMemory] = useState({ preferences: {}, projectMemory: {}, recoveryHistory: [], workHistory: [] });
  const [mission, setMission] = useState(null);
  const [missionOpen, setMissionOpen] = useState(false);
  const [operationStartedAt, setOperationStartedAt] = useState(0);
  const [operationElapsed, setOperationElapsed] = useState(0);
  const [videoApiKey, setVideoApiKey] = useState(() => window.localStorage.getItem('presentator.magicHourApiKey') || '');
  const [selectedFilter, setSelectedFilter] = useState('');
  const cancelledRef = useRef(false);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const progressTimerRef = useRef(null);
  const inputRef = useRef(null);

  const activeChat = useMemo(
    () => chats.find(chat => chat.id === activeId) || chats[0],
    [chats, activeId]
  );

  const stopCurrentMission = async () => {
    cancelledRef.current = true;
    setStatus('Stopping all active Super Agent work…');
    setMission(current => current ? { ...current, status: 'Stopping now' } : current);
    try { await window.electronAPI?.presentatorAgentStopProcess?.(); }
    catch (_) { await window.electronAPI?.presentatorAgentCancel?.(); }
    setBusy(false);
    setOperationStartedAt(0);
    setMission(current => current ? { ...current, status: 'Stopped safely', finishedAt: Date.now() } : current);
    setStatus('Stopped safely');
  };

  useEffect(() => {
    if (!activeId && chats[0]) setActiveId(chats[0].id);
  }, [activeId, chats]);

  useEffect(() => {
    const persistable = chats.map(chat => ({
      ...chat,
      references: chat.references.map(reference => {
        const copy = { ...reference };
        delete copy.imageBase64;
        delete copy.frames;
        return copy;
      }),
      assets: chat.assets.map(asset => {
        const copy = { ...asset };
        delete copy.preview;
        return copy;
      }),
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  }, [chats]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [activeChat?.messages, activeChat?.assets, busy]);

  useEffect(() => () => window.clearInterval(progressTimerRef.current), []);

  useEffect(() => {
    if (!busy || !operationStartedAt) return undefined;
    const updateElapsed = () => setOperationElapsed(Math.max(0, Math.floor((Date.now() - operationStartedAt) / 1000)));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [busy, operationStartedAt]);

  const refreshHealth = async () => {
    if (!window.electronAPI?.getServerHealth) return;
    setCheckingHealth(true);
    try {
      setHealth(await window.electronAPI.getServerHealth());
    } catch {
      setHealth(null);
    } finally {
      setCheckingHealth(false);
    }
  };

  useEffect(() => {
    refreshHealth();
    const handleShortcut = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onPresentatorAgentProgress) return undefined;
    const handleBrainProgress = progressEvent => {
      if (progressEvent?.stage === 'media') {
        const nextStatus = String(progressEvent?.label || 'Generating media locally');
        const exactProgress = Math.max(1, Math.min(99, Number(progressEvent?.percent || 1)));
        setStatus(nextStatus);
        setProgress(exactProgress);
        setMission(current => current ? { ...current, status: nextStatus, reasoningProfile: String(progressEvent?.profile || current.reasoningProfile) } : current);
        return;
      }
      const characters = Number(progressEvent?.generatedCharacters || 0);
      const profile = String(progressEvent?.profile || 'fast');
      const nextStatus = progressEvent?.stage === 'parsing'
        ? `Brain finished generating ${characters.toLocaleString()} characters • preparing actions`
        : progressEvent?.stage === 'ready'
          ? `Brain ready • ${profile} mode • starting generation`
          : `Brain generating live • ${characters.toLocaleString()} characters received`;
      setStatus(nextStatus);
      setMission(current => current ? {
        ...current,
        status: nextStatus,
        reasoningProfile: profile,
      } : current);
    };
    api.onPresentatorAgentProgress(handleBrainProgress);
    return () => api.offPresentatorAgentProgress?.(handleBrainProgress);
  }, []);

  useEffect(() => {
    let active = true;
    window.electronAPI?.presentatorAgentLoadData?.().then(result => {
      if (active && result?.ok && result.data) setAgentMemory(current => ({ ...current, ...result.data }));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const updateActiveChat = (updater) => {
    setChats(previous => previous.map(chat => (
      chat.id === activeId ? updater(chat) : chat
    )));
  };

  const addMessage = (role, text, extra = {}) => {
    if (!text) return;
    updateActiveChat(chat => ({
      ...chat,
      messages: [...chat.messages, {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role,
        text: String(text),
        createdAt: Date.now(),
        ...extra,
      }],
    }));
  };

  const addAsset = (asset) => {
    const assetId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    updateActiveChat(chat => ({
      ...chat,
      assets: [...chat.assets, {
        id: assetId,
        ...asset,
      }],
    }));
    setTimeout(() => {
      document.getElementById(`asset-card-${assetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  };

  const beginProgress = (label, estimateMs = 20000) => {
    window.clearInterval(progressTimerRef.current);
    setStatus(label);
    setOperationStartedAt(Date.now());
    setOperationElapsed(0);
    setProgress(3);
    const started = Date.now();
    progressTimerRef.current = window.setInterval(() => {
      const elapsedRatio = (Date.now() - started) / Math.max(estimateMs, 1000);
      const next = Math.min(94, Math.round(3 + (1 - Math.exp(-elapsedRatio * 2.5)) * 91));
      setProgress(current => Math.max(current, next));
    }, 350);
  };

  const finishProgress = (label = 'Completed') => {
    window.clearInterval(progressTimerRef.current);
    setProgress(100);
    setStatus(label);
    setOperationStartedAt(0);
    window.setTimeout(() => setProgress(0), 900);
  };

  const withProgress = async (label, estimateMs, operation) => {
    beginProgress(label, estimateMs);
    try {
      const result = await operation();
      finishProgress(`${label} • done`);
      return result;
    } catch (error) {
      window.clearInterval(progressTimerRef.current);
      setStatus(`Stopped: ${error.message}`);
      setOperationStartedAt(0);
      setProgress(0);
      throw error;
    }
  };

  const importFiles = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    beginProgress(`Reading ${files.length} reference${files.length > 1 ? 's' : ''}`, 12000);
    try {
      const imported = [];
      for (const file of Array.from(files)) {
        const filePath = window.electronAPI?.getPathForFile?.(file);
        if (!filePath) throw new Error(`Could not access ${file.name}.`);
        const result = await window.electronAPI.presentatorAgentImportReference({ filePath });
        if (!result?.ok) throw new Error(result?.error || `Could not read ${file.name}.`);
        imported.push(result.reference);
      }
      updateActiveChat(chat => ({
        ...chat,
        references: [...chat.references, ...imported],
      }));
      finishProgress(`${imported.length} reference${imported.length > 1 ? 's' : ''} ready`);
    } catch (error) {
      setStatus(`Upload failed: ${error.message}`);
      setProgress(0);
      addMessage('assistant', `I could not import that reference: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  const removeReference = (id) => {
    updateActiveChat(chat => ({
      ...chat,
      references: chat.references.filter(reference => reference.id !== id),
    }));
  };

  const executeAction = async (action) => {
    const tool = String(action?.tool || '');
    const args = action?.args || {};

    if (tool === 'inspect_state') {
      return { tool, ok: true, module: 'Agent Studio', referenceCount: activeChat.references.length };
    }
    if (tool === 'check_servers') {
      return { tool, ok: true, health: await window.electronAPI.getServerHealth() };
    }
    if (tool === 'read_diagnostics') {
      return { tool, ...(await window.electronAPI.presentatorAgentReadDiagnostics()) };
    }
    if (tool === 'restart_server') {
      return { tool, ...(await window.electronAPI.presentatorAgentRestartServer(args.server)) };
    }
    if (tool === 'inspect_code') {
      return { tool, ...(await window.electronAPI.presentatorAgentInspectCode(args)) };
    }
    if (tool === 'apply_code_patch') {
      return {
        tool,
        ...(await withProgress('Validating internal repair', 45000, () =>
          window.electronAPI.presentatorAgentApplyPatch(args)
        )),
      };
    }
    if (tool === 'restart_application') {
      return { tool, ...(await window.electronAPI.presentatorAgentRestartApp()) };
    }
    if (tool === 'list_files') {
      return { tool, ...(await window.electronAPI.presentatorAgentListFiles(args)) };
    }
    if (tool === 'read_file') {
      return { tool, ...(await window.electronAPI.presentatorAgentReadFile(args)) };
    }
    if (tool === 'write_file') {
      return { tool, ...(await window.electronAPI.presentatorAgentWriteFile(args)) };
    }
    if (tool === 'run_terminal_command') {
      return {
        tool,
        ...(await withProgress('Running command', 60000, () =>
          window.electronAPI.presentatorAgentRunCommand(args)
        )),
      };
    }
    if (tool === 'search_in_files') {
      return { tool, ...(await window.electronAPI.presentatorAgentSearchFiles(args)) };
    }
    if (tool === 'analyze_code') {
      return {
        tool,
        ...(await withProgress('Analyzing code quality', 20000, () =>
          window.electronAPI.presentatorAgentAnalyzeCode(args)
        )),
      };
    }
    if (tool === 'run_build_check') {
      return {
        tool,
        ...(await withProgress('Checking build validity', 60000, () =>
          window.electronAPI.presentatorAgentRunBuild()
        )),
      };
    }
    if (tool === 'open_code_canvas') {
      const language = String(args.language || 'html').toLowerCase();
      let code = String(args.code || args.content || args.html || '').trim();
      if (!code) {
        const titleText = String(args.title || 'Interactive Canvas');
        code = `<!DOCTYPE html>\n<html>\n<head>\n<style>\n  body { margin: 0; padding: 24px; background: #0b0f19; color: #f8fafc; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 80vh; }\n  .card { background: #1e293b; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 32px; text-align: center; max-width: 480px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }\n  h2 { color: #38bdf8; margin: 0 0 12px; }\n  p { color: #94a3b8; line-height: 1.6; margin: 0; }\n</style>\n</head>\n<body>\n  <div class="card">\n    <h2>✨ ${titleText}</h2>\n    <p>Live interactive canvas view ready for editing and preview.</p>\n  </div>\n</body>\n</html>`;
      }
      setCodeCanvas({
        title: String(args.title || 'Generated Code'),
        language,
        code,
        preview: args.preview !== false,
      });
      return { tool, ok: true, language, previewVisible: language === 'html' && args.preview !== false, characters: code.length };
    }
    if (tool === 'diff_files') {
      return { tool, ...(await window.electronAPI.presentatorAgentDiffFiles(args)) };
    }
    if (tool === 'list_checkpoints') {
      return { tool, ...(await window.electronAPI.presentatorAgentListCheckpoints()) };
    }
    if (tool === 'restore_checkpoint') {
      return { tool, ...(await window.electronAPI.presentatorAgentRestoreCheckpoint(args)) };
    }
    if (tool === 'validate_web_app') {
      return {
        tool,
        ...(await withProgress('Testing app in isolated browser', 20000, () =>
          window.electronAPI.presentatorAgentValidateWebApp(args)
        )),
      };
    }
    if (tool === 'generate_image') {
      try {
        const fn = window.electronAPI?.presentatorAgentGenerateImage;
        const generated = fn
          ? await withProgress('Generating high-quality image', 150000, () => fn(args))
          : await withProgress('Generating AI image', 15000, async () => {
              const prompt = String(args?.prompt || args?.caption || 'cute kittens').trim();
              const seed = Math.floor(Math.random() * 100000000);
              const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`;
              let res = await fetch(imageUrl).catch(() => null);
              if (!res || !res.ok) {
                res = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`);
              }
              const blob = await res.blob();
              const reader = new FileReader();
              const base64 = await new Promise((res, rej) => {
                reader.onloadend = () => res(reader.result.split(',')[1]);
                reader.onerror = rej;
                reader.readAsDataURL(blob);
              });
              return { ok: true, fileName: `${prompt.replace(/[^a-z0-9]+/gi, '-').slice(0, 30)}-${seed}.png`, imagePath: imageUrl, imageBase64: base64, mimeType: blob.type || 'image/png' };
            });
        if (generated?.ok) {
          addAsset({
            kind: 'image',
            name: generated.fileName,
            path: generated.imagePath,
            preview: `data:${generated.mimeType || 'image/png'};base64,${generated.imageBase64}`,
          });
          return {
            tool,
            ok: true,
            imagePath: generated.imagePath,
            fileName: generated.fileName,
            seed: generated.seed,
            elapsedSeconds: generated.elapsedSeconds,
          };
        }
        const errText = typeof generated?.error === 'object' ? JSON.stringify(generated.error) : String(generated?.error || 'Image generation failed.');
        return { tool, ok: false, error: errText };
      } catch (err) {
        const errMsg = typeof err === 'object' ? (err.message || JSON.stringify(err)) : String(err);
        return { tool, ok: false, error: errMsg };
      }
    }
    if (tool === 'create_animated_video') {
      const video = await withProgress('Creating eight-second video', 8000, () =>
        window.electronAPI.presentatorAgentCreateVideo({ ...args, duration: 8 })
      );
      if (video?.ok) addAsset({ kind: 'video', name: video.fileName, path: video.videoPath });
      return { tool, ...video, duration: 8 };
    }
    if (tool === 'finish') return { tool, ok: true };
    return { tool, ok: false, error: `Tool ${tool} is not available in Agent Studio.` };
  };


  const buildReferencePayload = () => {
    const references = activeChat.references.map(reference => ({
      name: reference.name,
      kind: reference.kind,
      filePath: reference.filePath,
      text: reference.kind === 'document' ? String(reference.text || '').slice(0, 50000) : undefined,
      summary: reference.summary,
      durationSeconds: reference.durationSeconds,
      metadata: reference.metadata,
    }));
    const images = [];
    for (const reference of activeChat.references) {
      if (reference.kind === 'image' && reference.imageBase64) images.push(reference.imageBase64);
      if (reference.kind === 'video' && Array.isArray(reference.frames)) images.push(...reference.frames);
      if (images.length >= 6) break;
    }
    return { references, referenceImages: images.slice(0, 6) };
  };

  const runAgent = async (request, conversationOverride) => {
    cancelledRef.current = false;
    setBusy(true);
    let toolResults = [];
    let latestGeneratedImagePath = '';
    let videoCreated = false;
    let codeCanvasOpened = false;
    const validationImages = [];
    const wantsVideo = /\b(video|animate|animation|mp4|8[- ]?second)\b/i.test(request);
    const explicitImageRequest = /\b(create|generate|make|draw|design|produce)\b[\s\S]{0,100}\b(image|picture|photo|illustration|artwork|poster|wallpaper|scene|render)\b/i.test(request);
    // Explicit image generation always wins over incidental words such as
    // "app", "website", or "canvas" that may merely describe image usage.
    const isCodeRequest = !explicitImageRequest && !wantsVideo && /\b(code|coding|app|application|website|webpage|component|game|dashboard|calculator|script|program|html|css|javascript|typescript|python|react|software|developer|develop)\b/i.test(request);
    const isVisualCodeRequest = !explicitImageRequest && !wantsVideo && /\b(app|application|website|webpage|component|game|dashboard|calculator|html|css|javascript|react)\b/i.test(request);
    const visualSubjectRequest = /\b(moon|stars?|sun|sky|space|planet|galaxy|landscape|mountain|ocean|forest|animal|kitten|cat|dog|flower|portrait|character|castle|house|car|background|wallpaper|poster|logo|illustration|artwork|picture|photo|image)\b/i.test(request)
      && !/\b(explain|describe|define|what is|why|how|question|code|website|webpage|app|application)\b/i.test(request);
    const isDirectImageRequest = (explicitImageRequest || visualSubjectRequest) && !wantsVideo;
    const uploadedImagePath = activeChat.references.find(reference => reference.kind === 'image')?.filePath || '';
    const conversation = conversationOverride || [
      ...activeChat.messages,
      { role: 'user', text: request },
    ].slice(-14);
    const referencePayload = buildReferencePayload();
    const instantCanvas = isVisualCodeRequest ? createInstantWebsite(request) : '';
    if (instantCanvas) {
      codeCanvasOpened = true;
      setCodeCanvas({ title: request.slice(0, 80) || 'Generated Website', language: 'html', code: instantCanvas, preview: true });
    }
    setMission({ objective: request, status: instantCanvas ? 'Starter canvas ready; AI is refining' : 'Running', reasoningProfile: isVisualCodeRequest ? 'fast' : '', round: 0, tools: instantCanvas ? [{ tool: 'instant_code_canvas', ok: true, error: '' }] : [], canvasOpened: Boolean(instantCanvas), browserValidated: false, buildValidated: false, startedAt: Date.now(), finishedAt: 0 });

    try {
      if (wantsVideo) {
        setCodeCanvas(null);
        codeCanvasOpened = false;
        if (!videoApiKey.trim()) {
          const unavailableMessage = 'Paste your free Magic Hour API key in the Video API field below, then submit this prompt again.';
          setMission(current => current ? {
            ...current, round: 1, status: 'Free video API key required', reasoningProfile: 'true text-to-video', activeTool: '',
            tools: [{ tool: 'generate_video', ok: false, error: unavailableMessage }], finishedAt: Date.now(),
          } : current);
          addMessage('assistant', unavailableMessage);
          setStatus('Free video API key required');
          return;
        }
        setMission(current => current ? { ...current, round: 1, status: 'Submitting original video generation', reasoningProfile: 'Magic Hour LTX 2.3', activeTool: 'generate_video' } : current);
        const videoOutcome = await withProgress('Generating original 8-second AI video', 600000, () =>
          window.electronAPI.presentatorAgentGenerateTrueVideo({ prompt: request, apiKey: videoApiKey.trim(), duration: 8 })
        );
        setMission(current => current ? {
          ...current,
          status: videoOutcome?.ok ? 'Original 8-second video created' : 'Video generation failed',
          reasoningProfile: 'Magic Hour LTX 2.3',
          activeTool: '',
          tools: [{ tool: 'generate_video', ok: Boolean(videoOutcome?.ok), error: videoOutcome?.ok ? '' : String(videoOutcome?.error || 'Video generation failed') }],
          finishedAt: Date.now(),
        } : current);
        if (!videoOutcome?.ok) throw new Error(videoOutcome?.error || 'True video generation failed.');
        addAsset({ kind: 'video', name: videoOutcome.fileName, path: videoOutcome.videoPath });
        addMessage('assistant', `Original 8-second AI video created: ${videoOutcome.fileName}.`, {
          model: 'Magic Hour LTX 2.3',
          thinking: 'Generated new moving frames directly from the exact prompt.',
          plan: ['Submit exact prompt', 'Generate moving frames', 'Download MP4 and show preview'],
          actions: [{ tool: 'generate_video', args: { prompt: request, duration: 8 } }],
        });
        setStatus('Ready');
        return;
        /* Disabled legacy still-image animation pipeline. Retained temporarily for migration.
        const imageAction = {
          tool: 'generate_image',
          args: {
            prompt: `${request}. Cinematic motion-ready keyframe, clear subject, dynamic composition, premium 3D presentation quality`,
            negativePrompt: 'blurry, pixelated, distorted, malformed, low quality, watermark, text, logo, static composition',
            seed: 0,
          },
          reason: 'Create the exact visual scene requested as the source for the eight-second video.',
        };
        const imageOutcome = await executeAction(imageAction);
        setMission(current => current ? {
          ...current,
          status: imageOutcome?.ok ? 'Animating scene into 8-second video' : 'Video scene generation failed', activeTool: imageOutcome?.ok ? 'create_animated_video' : '',
          tools: [...current.tools, { tool: imageAction.tool, ok: Boolean(imageOutcome?.ok), error: imageOutcome?.ok ? '' : String(imageOutcome?.error || 'Tool failed') }],
        } : current);
        if (!imageOutcome?.ok) throw new Error(imageOutcome?.error || 'Video scene generation failed.');

        const videoAction = {
          tool: 'create_animated_video',
          args: {
            imagePath: imageOutcome.imagePath,
            fileName: `prompt-video-${Date.now()}.mp4`,
            prompt: request,
          },
          reason: 'Render the generated scene as an eight-second cinematic MP4.',
        };
        const videoOutcome = await executeAction(videoAction);
        setMission(current => current ? {
          ...current,
          status: videoOutcome?.ok ? '8-second video created' : 'Video rendering failed',
          tools: [...current.tools, { tool: videoAction.tool, ok: Boolean(videoOutcome?.ok), error: videoOutcome?.ok ? '' : String(videoOutcome?.error || 'Tool failed') }],
          finishedAt: Date.now(), activeTool: '',
        } : current);
        if (!videoOutcome?.ok) throw new Error(videoOutcome?.error || 'Video rendering failed.');
        addMessage('assistant', `8-second video created successfully: ${videoOutcome.fileName}.`, {
          model: 'Local cinematic video generator',
          thinking: 'The video request was routed directly from the exact prompt without opening Code Canvas.',
          plan: ['Generate the requested scene', 'Animate it into an 8-second MP4', 'Save and display the result'],
          actions: [imageAction, videoAction],
        });
        setStatus('Ready');
        return;
        */
      }
      if (isDirectImageRequest) {
        setCodeCanvas(null);
        codeCanvasOpened = false;
        setMission(current => current ? { ...current, round: 1, status: 'Starting image generator', reasoningProfile: 'direct' } : current);
        const imageAction = {
          tool: 'generate_image',
          args: {
            prompt: `${request}. Full 3D cinematic scene, physically based materials, realistic depth, premium 4K presentation quality`,
            negativePrompt: 'flat 2D, blurry, pixelated, distorted, malformed, low quality, watermark, text, logo',
            seed: 0,
          },
          reason: 'Direct image request; start generation without an unnecessary planning round.',
        };
        const outcome = await executeAction(imageAction);
        setMission(current => current ? {
          ...current,
          status: outcome?.ok ? 'Image created' : 'Image generation failed',
          tools: [...current.tools, { tool: imageAction.tool, ok: Boolean(outcome?.ok), error: outcome?.ok ? '' : String(outcome?.error || 'Tool failed') }],
          finishedAt: Date.now(),
        } : current);
        if (!outcome?.ok) throw new Error(outcome?.error || 'Image generation failed.');
        addMessage('assistant', `Image created successfully: ${outcome.fileName || 'generated image'}.`, {
          model: 'Local image generator',
          thinking: 'The image request was routed directly to generation.',
          plan: ['Generate the requested image', 'Save and display the result'],
          actions: [imageAction],
        });
        setStatus('Ready');
        return;
      }
      for (let round = 0; round < MAX_ROUNDS && !cancelledRef.current; round += 1) {
        setMission(current => current ? { ...current, round: round + 1, status: round ? 'Verifying and repairing' : 'Analyzing objective' } : current);
        const response = await withProgress(
          round === 0 ? 'Local brain is analyzing' : `Verifying step ${round + 1}`,
          22000,
          () => window.electronAPI.presentatorAgentThink({
            userRequest: request,
            currentState: {
              module: 'Agent Studio',
              referenceCount: activeChat.references.length,
              memory: agentMemory,
              generatedAssets: activeChat.assets.map(asset => ({
                kind: asset.kind,
                name: asset.name,
                path: asset.path,
              })),
            },
            conversation,
            toolResults,
            ...referencePayload,
            referenceImages: [...referencePayload.referenceImages, ...validationImages].slice(-6),
          })
        );
        if (!response?.ok) throw new Error(response?.error || 'The local brain failed.');
        setMission(current => current ? { ...current, reasoningProfile: response.reasoningProfile || current.reasoningProfile } : current);
        const result = response.result || {};
        if (result.message) {
          addMessage('assistant', result.message, {
            model: response.model,
            thinking: result.thinking || '',
            plan: result.plan || [],
            actions: result.actions || [],
            performance: response.performance
          });
        }
        const actions = Array.isArray(result.actions) ? result.actions : [];
        if (!actions.length) {
          if (isCodeRequest && !codeCanvasOpened) {
            toolResults = [{
              action: { tool: 'open_code_canvas', args: {}, reason: 'Required delivery step for a coding request.' },
              outcome: { ok: false, error: 'The coding request is not complete: create the full code and call open_code_canvas with a runnable preview before finishing.' },
            }];
            continue;
          }
          break;
        }

        toolResults = [];
        let invalidToolReturned = false;
        for (const action of actions.slice(0, 5)) {
          if (cancelledRef.current) break;
          const rawTool = String(action?.tool || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
          const resolvedTool = AGENT_TOOL_ALIASES[rawTool] || rawTool;
          if (!AVAILABLE_AGENT_TOOLS.has(resolvedTool)) {
            invalidToolReturned = true;
            const invalidAction = { tool: rawTool || 'missing_tool', args: action?.args || {}, reason: action?.reason || 'Planner returned an invalid tool name.' };
            toolResults.push({ action: invalidAction, outcome: { ok: false, error: `Invalid tool "${rawTool || 'blank'}". Return a corrected action using an exact available tool name.` } });
            setMission(current => current ? { ...current, status: 'Repairing invalid action plan' } : current);
            continue;
          }
          const resolvedAction = { ...action, tool: resolvedTool, args: action?.args || {}, reason: action?.reason || '' };
          const normalizedAction = resolvedAction.tool === 'create_animated_video'
            ? {
                ...resolvedAction,
                args: {
                  ...(resolvedAction.args || {}),
                  imagePath: resolvedAction.args?.imagePath || latestGeneratedImagePath,
                },
              }
            : resolvedAction;
          if (normalizedAction?.tool === 'create_animated_video' && videoCreated) {
            toolResults.push({
              action: normalizedAction,
              outcome: { tool: 'create_animated_video', ok: true, skipped: true, reason: 'The requested video is already complete.' },
            });
            continue;
          }
          const outcome = await executeAction(normalizedAction);
          setMission(current => current ? {
            ...current,
            status: outcome?.ok ? 'Executing and verifying' : 'Recovering from failure',
            tools: [...current.tools, { tool: normalizedAction?.tool || 'unknown', ok: Boolean(outcome?.ok), error: outcome?.ok ? '' : String(outcome?.error || 'Tool failed') }].slice(-100),
            canvasOpened: current.canvasOpened || (normalizedAction?.tool === 'open_code_canvas' && Boolean(outcome?.ok)),
            browserValidated: current.browserValidated || (normalizedAction?.tool === 'validate_web_app' && Boolean(outcome?.ok)),
            buildValidated: current.buildValidated || (['run_build_check', 'run_terminal_command', 'apply_code_patch'].includes(normalizedAction?.tool) && Boolean(outcome?.ok) && (normalizedAction?.tool !== 'run_terminal_command' || /\b(build|test|check|lint|tsc)\b/i.test(String(normalizedAction?.args?.command || '')))),
          } : current);
          if (normalizedAction?.tool === 'validate_web_app' && outcome?.screenshotBase64) {
            validationImages.push(outcome.screenshotBase64);
            delete outcome.screenshotBase64;
          }
          if (normalizedAction?.tool === 'generate_image' && outcome?.ok) {
            latestGeneratedImagePath = outcome.imagePath;
          }
          if (normalizedAction?.tool === 'create_animated_video' && outcome?.ok) {
            videoCreated = true;
          }
          if (normalizedAction?.tool === 'open_code_canvas' && outcome?.ok) {
            codeCanvasOpened = true;
          }
          toolResults.push({ action: normalizedAction, outcome });
        }
        if (invalidToolReturned && !cancelledRef.current) continue;
        const videoSourcePath = latestGeneratedImagePath || uploadedImagePath;
        if (wantsVideo && videoSourcePath && !videoCreated && !cancelledRef.current) {
          const videoAction = {
            tool: 'create_animated_video',
            args: { imagePath: videoSourcePath, fileName: `scene-${Date.now()}.mp4` },
            reason: 'Complete the requested eight-second video from the generated frame.',
          };
          const videoOutcome = await executeAction(videoAction);
          videoCreated = Boolean(videoOutcome?.ok);
          toolResults.push({ action: videoAction, outcome: videoOutcome });
        }
        if (result.done && (!isCodeRequest || codeCanvasOpened)) break;
      }
      const memoryEntry = { request, completedAt: Date.now(), status: cancelledRef.current ? 'cancelled' : 'completed' };
      const nextMemory = {
        ...agentMemory,
        workHistory: [...(agentMemory.workHistory || []), memoryEntry].slice(-100),
      };
      setAgentMemory(nextMemory);
      window.electronAPI?.presentatorAgentSaveData?.(nextMemory).catch(() => {});
      setStatus(cancelledRef.current ? 'Stopped safely' : 'Ready');
      setMission(current => current ? { ...current, status: cancelledRef.current ? 'Cancelled safely' : 'Completed', finishedAt: Date.now() } : current);
    } catch (error) {
      addMessage('assistant', `I could not complete that run: ${error.message}`);
      setStatus('Needs attention');
      setProgress(0);
      setMission(current => current ? { ...current, status: 'Needs attention', finishedAt: Date.now(), tools: [...current.tools, { tool: 'mission', ok: false, error: error.message }] } : current);
    } finally {
      setBusy(false);
    }
  };

  const launchRequest = (rawRequest) => {
    const request = String(rawRequest || '').trim();
    if (!request || busy) return;
    setInput('');
    setMissionOpen(true);
    if (activeChat.title === 'New chat') {
      updateActiveChat(chat => ({ ...chat, title: request.slice(0, 42) }));
    }
    addMessage('user', request);
    runAgent(request);
  };

  const submit = () => launchRequest(input);

  const healthValues = health
    ? ['anjali', 'edgeTts', 'transcribe', 'videoExport', 'sc3Singing', 'translation'].map(key => [key, Boolean(health[key])])
    : [];
  const healthyCount = healthValues.filter(([, value]) => value).length;

  const retryLast = () => {
    const lastUser = [...activeChat.messages].reverse().find(message => message.role === 'user');
    if (lastUser && !busy) runAgent(lastUser.text);
  };

  const newChat = () => {
    const chat = makeChat();
    setChats(previous => [chat, ...previous]);
    setActiveId(chat.id);
    setInput('');
  };

  const deleteChat = (id) => {
    setChats(previous => {
      const remaining = previous.filter(chat => chat.id !== id);
      const next = remaining.length ? remaining : [makeChat()];
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  };

  return (
    <div
      className="h-full w-full flex bg-gradient-to-br from-[#0f111a] to-[#0a0b10] text-white overflow-hidden font-sans"
      onDragOver={event => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => {
        event.preventDefault();
        setDragging(false);
        importFiles(event.dataTransfer.files);
      }}
    >
      <MissionDashboard mission={missionOpen ? mission : null} liveStatus={status} liveElapsed={operationElapsed} liveProgress={progress} onStop={stopCurrentMission} onClose={() => setMissionOpen(false)} />
      <CodeCanvas
        canvas={codeCanvas}
        onChange={code => setCodeCanvas(current => current ? { ...current, code } : current)}
        onClose={() => setCodeCanvas(null)}
      />
      {dragging && (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex items-center justify-center pointer-events-none transition-all duration-300">
          <div className="rounded-3xl border-2 border-dashed border-emerald-400 bg-[#141722]/90 p-12 text-center max-w-sm shadow-[0_0_50px_rgba(16,185,129,0.2)]">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4 border border-emerald-500/20">
              <Icon name="upload" size={32} className="text-emerald-400 animate-bounce" />
            </div>
            <div className="text-lg font-bold mt-3 text-emerald-300">Drop References Here</div>
            <div className="text-sm text-white/50 mt-1.5">Documents, images, and videos will be attached directly</div>
          </div>
        </div>
      )}

      {/* Glassmorphic Sidebar */}
      <aside className={`${sidebarOpen ? 'w-[260px]' : 'w-0'} shrink-0 bg-[#11131c]/80 backdrop-blur-xl border-r border-white/5 transition-all duration-300 overflow-hidden`}>
        <div className="w-[260px] h-full flex flex-col p-4">
          <button onClick={newChat} className="h-11 rounded-xl border border-white/10 hover:border-emerald-500/35 hover:bg-emerald-500/5 hover:text-emerald-300 flex items-center justify-center gap-2.5 px-4 text-xs font-semibold uppercase tracking-wider transition-all duration-200 shadow-sm">
            <Icon name="plus" size={14} />
            New Session
          </button>
          
          <div className="mt-6 px-2 text-[10px] font-bold text-white/30 uppercase tracking-widest">Recent Chats</div>
          <div className="flex-1 overflow-y-auto mt-3 space-y-1.5 dark-scrollbar pr-1">
            {chats.map(chat => (
              <div key={chat.id} className={`group flex items-center rounded-xl transition-all duration-150 ${chat.id === activeId ? 'bg-[#1a1d29] border border-white/5 shadow-md shadow-black/20' : 'hover:bg-white/[0.03]'}`}>
                <button onClick={() => setActiveId(chat.id)} className={`flex-1 min-w-0 px-3.5 py-3 text-left text-[13px] truncate ${chat.id === activeId ? 'text-emerald-300 font-medium' : 'text-white/60'}`}>
                  {chat.title}
                </button>
                <button onClick={() => deleteChat(chat.id)} className="opacity-0 group-hover:opacity-100 px-3 text-white/30 hover:text-red-400 transition-all">
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-white/5 pt-4 px-1 mt-auto">
            <div className="text-xs font-bold text-white/80">Pattan Local Brain</div>
            <div className="text-[10px] text-emerald-400/80 mt-1 flex items-center gap-1.5 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Offline • No Quota • D Drive
            </div>
            
            <button onClick={refreshHealth} disabled={checkingHealth} className="mt-4 w-full rounded-xl border border-white/5 bg-[#161822] p-3 text-left hover:border-white/10 hover:bg-[#1b1e2c] transition-all duration-200 disabled:opacity-50">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-white/70">System Health Pulse</span>
                <span className={`font-bold ${healthValues.length && healthyCount === healthValues.length ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {checkingHealth ? 'Checking…' : healthValues.length ? `${healthyCount}/${healthValues.length} Online` : 'Verify now'}
                </span>
              </div>
              {healthValues.length > 0 && (
                <div className="mt-2.5 flex gap-1.5">
                  {healthValues.map(([name, online]) => (
                    <span key={name} title={`${name}: ${online ? 'online' : 'offline'}`} className={`h-1.5 flex-1 rounded-full transition-colors ${online ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]' : 'bg-red-500'}`} />
                  ))}
                </div>
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Studio Body */}
      <main className="flex-1 min-w-0 h-full flex flex-col relative bg-transparent">
        <header className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-white/5 bg-[#0f111a]/85 backdrop-blur-md z-10">
          <div className="flex items-center gap-3.5">
            <button onClick={() => setSidebarOpen(value => !value)} className="w-10 h-10 rounded-xl hover:bg-white/5 flex items-center justify-center transition-colors border border-transparent hover:border-white/10">
              <Icon name="menu" size={18} />
            </button>
            <div>
              <div className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
                Super Agent 
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono">v4.6 PRO</span>
              </div>
              <div className="text-[10px] text-white/40 font-medium mt-0.5">{status}</div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={() => setMissionOpen(true)} disabled={!mission} className="h-9 px-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-300 disabled:opacity-20 text-xs font-semibold transition-all">Mission Control</button>
            <button onClick={retryLast} disabled={busy || !activeChat.messages.length} className="h-9 px-4 rounded-xl border border-white/10 hover:bg-white/5 text-white/70 hover:text-white disabled:opacity-20 text-xs font-semibold flex items-center gap-2 transition-all">
              <Icon name="retry" size={15} />
              Retry Last
            </button>
            <button onClick={newChat} className="h-9 px-4 rounded-xl bg-white text-black hover:bg-white/90 text-xs font-bold shadow-lg shadow-white/5 transition-all">New Chat</button>
          </div>
        </header>

        {/* Chat History Panel */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto dark-scrollbar bg-transparent">
          {!activeChat.messages.length && !activeChat.assets.length ? (
            <div className="min-h-full flex flex-col items-center justify-center px-6 pb-20">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#10b981] to-[#3b82f6] text-white flex items-center justify-center shadow-xl shadow-emerald-500/10 border border-white/10 animate-pulse">
                <Icon name="spark" size={30} />
              </div>
              <h1 className="text-2xl font-black mt-6 tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white via-white to-white/60">What are we building today?</h1>
              <p className="text-xs text-white/40 mt-2 text-center max-w-sm font-medium leading-5">
                Drop documents, image frames, or scripts. I can inspect modules, generate local SD images, animate scenes, or run build checks.
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mt-9 max-w-2xl w-full">
                {[
                  ['image', 'Generate educational visual asset', 'Generate a high-res Stable Diffusion frame'],
                  ['video', 'Animate frame into 8s scene', 'Convert visual path to video track'],
                  ['file', 'Inspect file parameters & details', 'Run static analyzer and metrics check'],
                  ['wrench', 'Audit app codebase & build status', 'Find problems and apply repairs'],
                ].map(([icon, label, desc]) => (
                  <button key={label} onClick={() => setInput(label)} className="min-h-[76px] rounded-2xl border border-white/5 bg-[#131520]/60 hover:bg-[#1a1d2d] hover:border-emerald-500/25 p-4 text-left flex items-start gap-4 transition-all duration-200 group shadow-md">
                    <div className="w-10 h-10 rounded-xl bg-white/5 group-hover:bg-emerald-500/10 flex items-center justify-center shrink-0 border border-white/5 group-hover:border-emerald-500/20 transition-all">
                      <Icon name={icon} className="text-white/60 group-hover:text-emerald-400 shrink-0" size={18} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white/90 group-hover:text-white transition-colors">{label}</div>
                      <div className="text-[10px] text-white/45 mt-1 leading-4">{desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-9 space-y-8">
              {activeChat.messages.map(message => (
                <div key={message.id} className={`flex gap-4 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {message.role === 'assistant' && (
                    <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-[#10b981] to-[#059669] text-white flex items-center justify-center shadow-md border border-white/10">
                      <Icon name="spark" size={16} />
                    </div>
                  )}
                  {message.role === 'user' ? (
                    <div className="group max-w-[82%] bg-gradient-to-br from-[#2f3954] to-[#1e2538] text-white border border-white/5 rounded-3xl rounded-tr-none px-5 py-3.5 shadow-lg shadow-black/20">
                      <div className="text-[13.5px] leading-7 whitespace-pre-wrap font-medium">{message.text}</div>
                    </div>
                  ) : (
                    <AssistantMessageBlock message={message} />
                  )}
                </div>
              ))}

              {activeChat.assets.map(asset => (
                <div
                  key={asset.id}
                  id={`asset-card-${asset.id}`}
                  className="ml-12 rounded-2xl border border-emerald-500/20 bg-[#141622] overflow-hidden max-w-xl shadow-2xl shadow-emerald-500/5 transition-all"
                >
                  {asset.kind === 'image' ? (
                    <div className="relative group bg-black flex justify-center items-center">
                      <img src={asset.preview} alt={asset.name} className="w-full max-h-[420px] object-contain rounded-t-2xl" />
                      <a
                        href={asset.preview}
                        download={asset.name}
                        className="absolute top-3 right-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-lg flex items-center gap-1.5 transition-all cursor-pointer"
                        title="Download HD Image"
                      >
                        <span>⬇️</span> Download HD
                      </a>
                    </div>
                  ) : (
                    <video src={`file:///${asset.path.replace(/\\/g, '/')}`} controls className="w-full bg-black" />
                  )}
                  <div className="p-3.5 flex items-center justify-between border-t border-white/5 bg-[#10121b]">
                    <div className="text-xs truncate text-white/90 font-semibold max-w-[200px]">{asset.name}</div>
                    <div className="flex items-center gap-2">
                      {asset.kind === 'image' && (
                        <button
                          type="button"
                          onClick={() => {
                            setInput(`[Reply to image "${asset.name}"]: `);
                            inputRef.current?.focus();
                          }}
                          className="text-[11px] bg-violet-600/30 hover:bg-violet-600/50 border border-violet-500/30 text-violet-200 font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                        >
                          <span>💬</span> Reply / Edit
                        </button>
                      )}
                      <a
                        href={asset.preview}
                        download={asset.name}
                        className="text-[11px] bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/30 text-emerald-300 font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                      >
                        <span>⬇️</span> Download
                      </a>
                      <button type="button" onClick={() => window.electronAPI?.showItemInFolder?.(asset.path)} className="text-[10px] text-white/40 hover:text-white font-medium">Folder</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom Input Area */}
        <div className="shrink-0 px-6 pb-6 pt-2 bg-gradient-to-t from-[#0a0b10] via-[#0a0b10]/95 to-transparent">
          <div className="max-w-3xl mx-auto">
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-violet-500/15 bg-violet-500/5 px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-violet-300">Video API</span>
              <input type="password" value={videoApiKey} onChange={event => { const value = event.target.value; setVideoApiKey(value); window.localStorage.setItem('presentator.magicHourApiKey', value); }} placeholder="Paste free Magic Hour API key" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/25" />
              <a href="https://magichour.ai/developer" target="_blank" rel="noreferrer" className="text-[10px] font-bold text-cyan-300 hover:underline">Get free key</a>
            </div>
            {progress > 0 && (
              <div className="mb-4 rounded-2xl border border-white/5 bg-[#121420]/90 backdrop-blur px-4.5 py-3.5 shadow-2xl shadow-emerald-500/5">
                <div className="flex items-center gap-3.5">
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <Icon name="spark" size={17} className="text-emerald-400" />
                    {busy && <span className="absolute inset-0 rounded-xl border border-transparent border-t-emerald-400 animate-spin" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3 text-[11px] font-semibold">
                      <span className="truncate text-white/85">{status}</span>
                      <span className="font-mono text-emerald-400">{operationElapsed}s elapsed</span>
                    </div>
                    <div className="mt-1 text-[10px] text-white/35">
                      {/Local brain|analyzing|Verifying step/i.test(status)
                        ? 'The offline AI is reading context and generating its next verified action. Complex code tasks can take several minutes on the local 4B model.'
                        : /image/i.test(status)
                          ? 'The local image model is generating pixels; this is compute-intensive and progress arrives only when generation finishes.'
                          : /build|validat|command|test/i.test(status)
                            ? 'A real build, command, or validation is running. The result will appear when the process returns output.'
                            : 'The current tool is still running locally. Mission Control shows the active round and completed actions.'}
                    </div>
                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {activeChat.references.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-2.5 dark-scrollbar pr-1">
                {activeChat.references.map(reference => (
                  <div key={reference.id} className="shrink-0 max-w-[210px] h-10 rounded-xl border border-white/5 bg-[#161924] px-3 flex items-center gap-2 shadow-sm">
                    <Icon name={kindIcon[reference.kind]} size={14} className="text-white/60" />
                    <span className="text-[11px] truncate flex-1 text-white/80">{reference.name}</span>
                    <button onClick={() => removeReference(reference.id)} className="text-white/30 hover:text-white transition-colors">
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Image Style Filters Bar */}
            <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-1.5 dark-scrollbar">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider px-1 shrink-0">Filters:</span>
              {IMAGE_FILTERS.map(filter => (
                <button
                  key={filter.name}
                  type="button"
                  onClick={() => {
                    setSelectedFilter(filter.name);
                    setInput(prev => {
                      const clean = prev.replace(/\s*,?\s*(photorealistic|celebrity portrait|anime style|cyberpunk|cinematic 3d|oil painting|fantasy art|vintage retro|pencil sketch).*/gi, '').trim();
                      return clean ? `${clean}, ${filter.suffix}` : `Generate ${filter.name.toLowerCase()} image: `;
                    });
                    inputRef.current?.focus();
                  }}
                  className={`shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-bold transition-all border cursor-pointer ${
                    selectedFilter === filter.name
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                      : 'bg-[#121422] border-white/10 text-white/60 hover:text-white hover:border-white/20'
                  }`}
                >
                  {filter.icon} {filter.name}
                </button>
              ))}
            </div>

            {/* Quick Actions */}
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1.5 dark-scrollbar pr-1" aria-label="Daily quick actions">
              {DAILY_ACTIONS.map(action => (
                <button
                  key={action.label}
                  onClick={() => launchRequest(action.prompt)}
                  disabled={busy}
                  className="shrink-0 rounded-xl border border-white/5 bg-[#12141f] px-3.5 py-2 text-[11px] text-white/65 hover:border-emerald-500/25 hover:bg-[#1a1d2e] hover:text-emerald-300 disabled:opacity-30 flex items-center gap-2 transition-all shadow-sm"
                  title={action.prompt}
                >
                  <Icon name={action.icon} size={13} className="text-emerald-400/80" />
                  {action.label}
                </button>
              ))}
            </div>

            {/* Glassmorphic Rounded Input Box */}
            <div className="rounded-3xl bg-[#131622]/85 border border-white/5 shadow-2xl shadow-black/50 focus-within:border-emerald-500/40 focus-within:ring-2 focus-within:ring-emerald-500/5 transition-all overflow-hidden">
              <textarea
                ref={inputRef}
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder="Message Super Agent — Shift+Enter for new line..."
                className="w-full min-h-[64px] max-h-40 resize-none bg-transparent px-6 pt-4.5 text-[13.5px] outline-none placeholder:text-white/25 leading-6 text-white"
                disabled={busy}
              />
              <div className="h-12 flex items-center justify-between px-4 pb-2">
                <div className="flex items-center gap-1.5">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.txt,.md,.csv,.json,.log,.srt,.png,.jpg,.jpeg,.webp,.bmp,.mp4,.mov,.mkv,.webm,.avi"
                    className="hidden"
                    onChange={event => {
                      importFiles(event.target.files);
                      event.target.value = '';
                    }}
                  />
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading || busy} className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 hover:text-white border border-white/5 flex items-center justify-center disabled:opacity-20 transition-all" title="Add references">
                    <Icon name="plus" size={17} />
                  </button>
                  <span className="text-[10px] text-white/30 font-medium">Add references (PDF, text, images, MP4)</span>
                </div>
                {busy ? (
                  <button onClick={stopCurrentMission} className="w-9 h-9 rounded-full bg-red-600 text-white hover:bg-red-500 flex items-center justify-center shadow-lg shadow-red-900/30 transition-all" title="Stop process now">
                    <Icon name="stop" size={15} />
                  </button>
                ) : (
                  <button onClick={submit} disabled={!input.trim()} className="w-9 h-9 rounded-full bg-white text-black hover:bg-white/90 disabled:bg-white/10 disabled:text-white/20 flex items-center justify-center transition-all shadow-md shadow-white/5" title="Send">
                    <Icon name="send" size={16} />
                  </button>
                )}
              </div>
            </div>
            <div className="text-center text-[9.5px] text-white/20 mt-3 font-medium">
              Super Agent operates locally on your machine. Review final code builds and generated media.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
