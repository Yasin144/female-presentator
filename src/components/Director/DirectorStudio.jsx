import React, { useEffect, useMemo, useState } from 'react';
import './director-studio.css';

const STORAGE_KEY = 'pattan-director-projects-v1';

const LANGUAGES = ['English', 'Indian English', 'Telugu', 'Hindi'];
const FORMATS = ['Children’s rhyme video', 'Explainer', 'Lesson', 'Product story', 'News update', 'Social short'];
const TONES = ['Clear and confident', 'Warm teacher', 'Cinematic', 'Energetic', 'Professional'];

function loadProjects() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.slice(0, 12) : [];
  } catch (_) {
    return [];
  }
}

function makeDirectorDraft(form) {
  const topic = form.topic.trim();
  const duration = Math.max(30, Number(form.duration) || 90);
  if (form.format === 'Children’s rhyme video') {
    const lyricLines = topic.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const exactLyrics = lyricLines.join('\n');
    const secondsPerScene = Math.max(3, Math.min(6, duration / Math.max(1, lyricLines.length)));
    const scenes = lyricLines.map((line, index) => (
      `SCENE ${index + 1} — LYRIC LINE ${index + 1}\n` +
      `Presenter: ${line}\n` +
      `Visual: Recreate “${line}” as a meaningful premium 3D animated action using only relevant characters, objects and settings from the supplied sources. Add one playful secondary action and expressive facial reaction.\n` +
      `Performance: Synchronize lip movement, body action, object animation and musical accents to every sung word.\n` +
      `Camera: Use a clear child-friendly ${index % 3 === 0 ? 'wide establishing shot' : index % 3 === 1 ? 'expressive medium tracking shot' : 'close-up followed by a gentle pull-back'}; transition smoothly after about ${secondsPerScene.toFixed(1)} seconds.\n` +
      `Caption emphasis: Display exactly “${line}” only while it is sung; one readable line, high contrast, never covering a face.`
    )).join('\n\n');

    return `TITLE: ${lyricLines[0] || 'Children’s Rhyme'}\n` +
      `FORMAT: Premium children’s rhyme video\nTARGET AGE: ${form.audience || '3–6 years'}\n` +
      `LANGUAGE: ${form.language}\nTARGET LENGTH: ${duration} seconds\nASPECT RATIO: 16:9 widescreen\n\n` +
      `EXACT RHYME LYRICS — LOCKED:\n${exactLyrics}\n\n` +
      `SOURCE PRIORITY: exact lyrics → character references → object references → setting references → animation-style references. Analyse every supplied image, audio, video, costume, face, colour, object and background before generation. Recreate references as one living 3D world; never show a flat slideshow. Never omit, rewrite, reorder or add lyrics.\n\n` +
      `VISUAL STANDARD: Premium cinematic 3D realistic-cartoon animation, bright child-friendly colours, polished textures, expressive stable faces, correct hands, smooth shadows, beautiful warm lighting, clear depth and professional international children’s television quality. Maintain identical character face, age, proportions, hairstyle, skin tone, costume and colours across every shot. Maintain exact object counts and stable environments.\n\n` +
      `MUSIC: Original joyful, energetic and memorable child-friendly melody with a clear rhythm. Use xylophone, ukulele, soft drums, handclaps, bells, flute, cheerful strings, light bass and playful percussion. Add tasteful pauses, instrumental responses and synchronized sound effects without covering lyrics. Keep the approved SC3 vocal clear and in front.\n\n` +
      `PERFORMANCE: Warm, lively, natural singing; exact pronunciation; no robotic delivery. Use expressive eyes, blinking, eyebrows, head turns, gestures, dancing, clapping, jumping, spinning, pointing and safe friendly interaction. Every lyric line must become a visible action, not characters standing and singing. Backgrounds should move gently without overcrowding the frame.\n\n` +
      `${scenes}\n\n` +
      `ENDING: Finish with a joyful rhyme-connected celebration, smile, wave or bow and hold the final composition long enough to feel complete.\n\n` +
      `NEGATIVE PROMPT: No inconsistent characters, altered costumes, missing or extra lyrics, incorrect counts, duplicates, deformed hands, extra fingers, distorted or crossed eyes, stiff or repeated animation, robotic lip movement, lip-sync errors, dark faces, frightening expressions, unsafe actions, random objects, irrelevant background characters, overcrowding, flat source images, frozen singing poses, broken anatomy, disappearing or floating objects, flicker, warping, style changes, shaky camera, cropped faces or hands, unreadable or misspelled subtitles, logos, brands, watermark-like text, low-resolution frames, abrupt cuts or unfinished ending.\n\n` +
      `FINAL QUALITY GATES: Verify exact lyrics, pronunciation, word-level lip sync, beat synchronization, subtitle timing, character continuity, object counts, safe actions, 16:9 framing, audio balance, visual clarity and complete ending before export.`;
  }
  const sceneCount = Math.max(3, Math.min(8, Math.round(duration / 25)));
  const beats = [
    ['Opening hook', `Begin with a strong question or surprising truth about ${topic}.`],
    ['Why it matters', `Explain why ${topic} is useful for ${form.audience || 'the audience'}.`],
    ['Core idea', `Introduce the central idea in simple ${form.language} language.`],
    ['Walkthrough', `Demonstrate the idea with one clear, practical example.`],
    ['Key takeaway', `Summarize the most important point to remember.`],
    ['Action step', `Give the viewer one useful action they can take today.`],
    ['Quick recap', `Repeat the essential points without adding new information.`],
    ['Closing', `End with a confident, memorable closing line.`],
  ].slice(0, sceneCount);

  const sceneText = beats.map(([title, instruction], index) => (
    `SCENE ${index + 1} — ${title.toUpperCase()}\n` +
    `Presenter: ${instruction}\n` +
    `Visual: Use a clean supporting visual with minimal on-screen text.\n` +
    `Caption emphasis: Highlight the key phrase only.`
  )).join('\n\n');

  return `TITLE: ${topic}\n` +
    `FORMAT: ${form.format}\n` +
    `AUDIENCE: ${form.audience || 'General audience'}\n` +
    `LANGUAGE: ${form.language}\n` +
    `VOICE: ${form.voice}\n` +
    `TONE: ${form.tone}\n` +
    `TARGET LENGTH: ${duration} seconds\n` +
    `CAPTIONS: ${form.captions ? 'Auto-detect and burn into export' : 'Optional'}\n\n` +
    `${sceneText}\n\n` +
    `FINAL QUALITY CHECK\n` +
    `Confirm pronunciation, narration pace, caption timing, visual continuity and exact audio/video duration before export.`;
}

const LANG_VOICES = {
  'English': 'en-IN-NeerjaExpressiveNeural',
  'Indian English': 'en-IN-NeerjaExpressiveNeural',
  'Telugu': 'te-IN-ShrutiNeural',
  'Hindi': 'hi-IN-SwaraNeural'
};

function createSlideBase64(title, subtitle, width = 1920, height = 1080) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Draw modern dark gradient
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#1e1b4b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle grid pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const gridSize = 80;
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }

  // Soft center glow
  const radial = ctx.createRadialGradient(width/2, height/2, 50, width/2, height/2, 600);
  radial.addColorStop(0, 'rgba(99, 102, 241, 0.15)');
  radial.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, width, height);

  // Draw kicker header text
  ctx.fillStyle = '#818cf8';
  ctx.font = 'bold 26px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PATTAN STUDIO AI DIRECTOR', width / 2, 280);

  // Draw Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(title, width / 2, 450);

  // Draw Subtitle / Visual Text
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = 'italic 34px "Segoe UI", system-ui, sans-serif';
  
  // Basic text wrap
  const words = subtitle.split(' ');
  let line = '';
  let y = 600;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > 1200 && n > 0) {
      ctx.fillText(line, width / 2, y);
      line = words[n] + ' ';
      y += 50;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, width / 2, y);

  return canvas.toDataURL('image/png').split(',')[1];
}

export default function DirectorStudio({ onSendToPresentator, onOpenCaptions, onOpenExporter }) {
  const [form, setForm] = useState({
    topic: '', audience: '3–6 years', duration: 90,
    language: 'Indian English', format: 'Children’s rhyme video', tone: 'Energetic',
    voice: 'Anjali female presenter', captions: true,
  });
  const [draft, setDraft] = useState('');
  const [projects, setProjects] = useState(loadProjects);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Describe the video and Director will prepare the complete production plan.');
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: '' });

  const autoMuxToExporter = async () => {
    const safeDraft = draft || (form.topic.trim() ? makeDirectorDraft(form) : '');
    if (!safeDraft.trim()) {
      setStatus('Build a production plan first.');
      return;
    }
    setBusy(true);
    setProgress({ current: 0, total: 0, phase: 'Checking production services' });
    setStatus('Parsing script and preparing canvas elements...');

    try {
      if (typeof window.electronAPI?.writeFile !== 'function' || typeof window.electronAPI?.narrateEdgeTts !== 'function') {
        throw new Error('AI Director production services are unavailable. Restart Pattan Presentator.');
      }
      const appRoot = await window.electronAPI.getAppRoot?.() || 'D:\\voice';
      const titleMatch = safeDraft.match(/TITLE:\s*(.*)/i);
      const title = titleMatch ? titleMatch[1].trim() : (form.topic.trim() || 'AI Director Project');

      const sceneBlocks = safeDraft.split(/SCENE\s+\d+/i);
      const parsedScenes = [];
      for (let i = 1; i < sceneBlocks.length; i++) {
        const block = sceneBlocks[i];
        const presenterMatch = block.match(/Presenter:\s*([^\n]*)/i);
        const visualMatch = block.match(/Visual:\s*([^\n]*)/i);
        const presenter = presenterMatch ? presenterMatch[1].trim() : '';
        const visual = visualMatch ? visualMatch[1].trim() : '';
        if (presenter || visual) {
          parsedScenes.push({
            index: i,
            presenter,
            visual: visual || `Scene ${i} details`
          });
        }
      }

      if (!parsedScenes.length) {
        throw new Error('Could not parse any scenes from the script. Please ensure the script has "SCENE 1", "Presenter: ...", "Visual: ..." blocks.');
      }

      setStatus(`Generating ${parsedScenes.length} narration voiceovers and slide images...`);
      setProgress({ current: 0, total: parsedScenes.length, phase: 'Preparing scenes' });
      const scenesState = [];
      const audioTracksState = [];
      const captionsState = [];
      let cumulativeTime = 0;

      const selectedVoice = LANG_VOICES[form.language] || 'en-IN-NeerjaExpressiveNeural';

      for (let idx = 0; idx < parsedScenes.length; idx++) {
        const s = parsedScenes[idx];
        setStatus(`[Scene ${idx + 1}/${parsedScenes.length}] Synthesizing narration and drawing slide...`);
        setProgress({ current: idx, total: parsedScenes.length, phase: `Creating scene ${idx + 1}` });

        const base64Png = createSlideBase64(`Scene ${idx + 1}`, s.visual);
        const imgName = `director_scene_${Date.now()}_${idx + 1}.png`;
        const imgPath = `${appRoot}\\generated-media\\images\\${imgName}`;
        
        const imageWrite = await window.electronAPI.writeFile(imgPath, base64Png);
        if (!imageWrite?.ok) throw new Error(`Scene ${idx + 1} image could not be saved: ${imageWrite?.error || 'unknown write error'}`);

        let audioDuration = 5.0;
        let audioPath = '';

        if (s.presenter.trim()) {
          const ttsResult = await window.electronAPI.narrateEdgeTts({
            text: s.presenter,
            voice: selectedVoice,
            rate: '+0%'
          });
          if (!ttsResult?.ok || !ttsResult?.audioBase64) {
            throw new Error(`Scene ${idx + 1} narration failed: ${ttsResult?.error || 'voice server returned no audio'}`);
          }
          const contentType = String(ttsResult.contentType || 'audio/mpeg');
          const audioExtension = contentType.includes('wav') ? 'wav' : 'mp3';
          const audioName = `director_narr_${Date.now()}_${idx + 1}.${audioExtension}`;
          audioPath = `${appRoot}\\generated-media\\narration\\${audioName}`;
          const audioWrite = await window.electronAPI.writeFile(audioPath, ttsResult.audioBase64);
          if (!audioWrite?.ok) throw new Error(`Scene ${idx + 1} narration could not be saved: ${audioWrite?.error || 'unknown write error'}`);

          audioDuration = await new Promise((resolve) => {
            const audioObj = new Audio(`data:${contentType};base64,${ttsResult.audioBase64}`);
            audioObj.addEventListener('loadedmetadata', () => resolve(Number.isFinite(audioObj.duration) ? audioObj.duration : 5.0), { once: true });
            audioObj.addEventListener('error', () => resolve(5.0), { once: true });
          });
        }

        const sceneId = `scene-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        
        scenesState.push({
          id: sceneId,
          kind: 'image',
          name: imgName,
          path: imgPath,
          duration: audioDuration,
          fit: 'contain'
        });

        if (audioPath) {
          audioTracksState.push({
            id: `audio-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            name: `Narration ${idx + 1}`,
            path: audioPath,
            start: cumulativeTime,
            duration: audioDuration,
            volume: 1.0,
            muted: false
          });
        }

        captionsState.push({
          id: `cap-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          text: s.presenter || '(Instrumental)',
          start: cumulativeTime,
          end: cumulativeTime + audioDuration
        });

        cumulativeTime += audioDuration;
        setProgress({ current: idx + 1, total: parsedScenes.length, phase: `Scene ${idx + 1} complete` });
      }

      const newProject = {
        projectName: title,
        projectPath: 'Not saved yet',
        scenes: scenesState,
        audioTracks: audioTracksState,
        captions: captionsState,
        mediaLibrary: scenesState.map(s => ({
          id: s.id,
          name: s.name,
          path: s.path,
          kind: 'image',
          duration: s.duration
        })),
        trackStates: { videoLocked: false, audioLocked: false, audioMuted: false, captionsLocked: false, captionsMuted: false },
        settings: {
          resolution: '1080p',
          fps: 30,
          quality: 'balanced',
          framing: 'contain',
          musicVolume: 0.18,
          burnCaptions: true,
          captionStyle: 'classic',
          captionPosition: 'bottom',
          captionFontSize: 42,
          captionMaxChars: 36,
          watermarkPosition: 'bottom-right',
          watermarkX: 90,
          watermarkY: 90,
          watermarkScale: 16,
          watermarkOpacity: 0.85
        }
      };

      localStorage.setItem('pattan-my-exporter-project-v1', JSON.stringify(newProject));
      setStatus('Production plan auto-muxed successfully!');
      setProgress({ current: parsedScenes.length, total: parsedScenes.length, phase: 'Production ready' });
      
      if (typeof onOpenExporter === 'function') {
        onOpenExporter();
      }
    } catch (err) {
      console.error(err);
      setStatus(`Auto-Mux failed: ${err.message}`);
      setProgress(current => ({ ...current, phase: 'Stopped with an error' }));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects.slice(0, 12))); } catch (_) {}
  }, [projects]);

  const readiness = useMemo(() => {
    const checks = [
      ['Brief', Boolean(form.topic.trim())],
      ['Scenes', Boolean(draft.trim())],
      ['Voice', Boolean(form.voice)],
      ['Captions', form.captions],
      ['Export check', Boolean(draft.trim())],
    ];
    return { checks, count: checks.filter(([, ready]) => ready).length };
  }, [form, draft]);

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }));

  const buildPlan = () => {
    if (!form.topic.trim()) {
      setStatus('Enter a topic or goal first.');
      return;
    }
    const nextDraft = makeDirectorDraft(form);
    setDraft(nextDraft);
    setStatus('Production plan ready. Review it or enhance it with the local brain.');
  };

  const enhanceWithBrain = async () => {
    if (!form.topic.trim()) {
      setStatus('Enter a topic or goal first.');
      return;
    }
    const baseDraft = draft || makeDirectorDraft(form);
    if (typeof window.electronAPI?.presentatorAgentThink !== 'function') {
      setDraft(baseDraft);
      setStatus('Local brain is unavailable in preview mode. The Director plan is ready.');
      return;
    }
    setBusy(true);
    setStatus('Local brain is refining the script and scene direction...');
    try {
      const response = await window.electronAPI.presentatorAgentThink({
        userRequest: `Rewrite this production plan as a polished, ready-to-narrate ${form.format}. Keep clear SCENE headings, presenter narration, visual direction, and caption emphasis. Use ${form.language}, a ${form.tone.toLowerCase()} tone, and fit approximately ${form.duration} seconds. Return only the completed production script.\n\n${baseDraft}`,
        currentState: { module: 'AI Director', ...form },
        conversation: [{ role: 'user', text: `Create a video about ${form.topic}` }],
        toolResults: [],
      });
      const message = response?.result?.message?.trim();
      if (!response?.ok || !message) throw new Error(response?.error || 'The local brain returned no script.');
      setDraft(message);
      setStatus(`Director script enhanced with ${response.model || 'the local brain'}.`);
    } catch (error) {
      setDraft(baseDraft);
      setStatus(`The standard Director plan is ready. Brain enhancement was skipped: ${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const saveProject = () => {
    if (!form.topic.trim() || !draft.trim()) {
      setStatus('Build the production plan before saving it.');
      return;
    }
    const project = { id: Date.now(), title: form.topic.trim(), updatedAt: new Date().toISOString(), form, draft };
    setProjects(current => [project, ...current.filter(item => item.title !== project.title)].slice(0, 12));
    setStatus('Director project saved on this computer.');
  };

  const loadProject = project => {
    setForm(project.form);
    setDraft(project.draft);
    setStatus(`Loaded “${project.title}”.`);
  };

  const handoff = (action = 'edit') => {
    const safeDraft = draft || (form.topic.trim() ? makeDirectorDraft(form) : '');
    if (!safeDraft) {
      setStatus('Build a production plan before sending it to Presentator.');
      return;
    }
    setDraft(safeDraft);
    onSendToPresentator({ text: safeDraft, action, settings: form });
  };

  return (
    <div className="director-page">
      <aside className="director-rail">
        <div>
          <p className="director-kicker">Pattan Studio</p>
          <h1>AI Director</h1>
          <p className="director-muted">One production brief for script, voice, captions and export.</p>
        </div>
        <div className="director-score">
          <span>{readiness.count}/5</span>
          <div><strong>Production readiness</strong><small>Complete the brief and review the plan.</small></div>
        </div>
        <div className="director-checks">
          {readiness.checks.map(([label, ready]) => (
            <div key={label} className={ready ? 'is-ready' : ''}><span>{ready ? '✓' : '·'}</span>{label}</div>
          ))}
        </div>
        <div className="director-saved">
          <div className="director-section-title">Recent projects</div>
          {projects.length === 0 && <p className="director-empty">Saved Director projects appear here.</p>}
          {projects.slice(0, 5).map(project => (
            <button key={project.id} onClick={() => loadProject(project)}><strong>{project.title}</strong><small>{new Date(project.updatedAt).toLocaleDateString()}</small></button>
          ))}
        </div>
      </aside>

      <main className="director-main">
        <header className="director-header">
          <div><p className="director-kicker">Production workspace</p><h2>Turn one idea into a complete video plan.</h2></div>
          <button className="director-save" onClick={saveProject}>Save project</button>
        </header>

        <section className="director-grid">
          <div className="director-card director-brief">
            <div className="director-section-title">01 — Creative brief</div>
            <label className="director-wide">{form.format === 'Children’s rhyme video' ? 'Exact rhyme lyrics' : 'Topic or goal'}<textarea value={form.topic} onChange={event => update('topic', event.target.value)} placeholder={form.format === 'Children’s rhyme video' ? 'Paste the complete exact rhyme here. One lyric line per line.' : 'Example: Explain compound interest with a simple Indian household example'} /></label>
            <label>Audience<input value={form.audience} onChange={event => update('audience', event.target.value)} /></label>
            <label>Length<select value={form.duration} onChange={event => update('duration', Number(event.target.value))}><option value={30}>30 seconds</option><option value={45}>45 seconds</option><option value={60}>60 seconds</option><option value={90}>90 seconds</option><option value={120}>2 minutes</option><option value={180}>3 minutes</option><option value={300}>5 minutes</option></select></label>
            <label>Format<select value={form.format} onChange={event => update('format', event.target.value)}>{FORMATS.map(item => <option key={item}>{item}</option>)}</select></label>
            <label>Language<select value={form.language} onChange={event => update('language', event.target.value)}>{LANGUAGES.map(item => <option key={item}>{item}</option>)}</select></label>
            <label>Tone<select value={form.tone} onChange={event => update('tone', event.target.value)}>{TONES.map(item => <option key={item}>{item}</option>)}</select></label>
            <label>Presenter<select value={form.voice} onChange={event => update('voice', event.target.value)}><option>Anjali female presenter</option><option>Indian English female presenter</option><option>Male presenter</option></select></label>
            <label className="director-toggle"><input type="checkbox" checked={form.captions} onChange={event => update('captions', event.target.checked)} /><span>Auto-detect language and burn captions</span></label>
            <div className="director-actions director-wide"><button className="director-primary" onClick={buildPlan}>Build production plan</button><button onClick={enhanceWithBrain} disabled={busy}>{busy ? 'Directing…' : 'Enhance with local brain'}</button></div>
          </div>

          <div className="director-card director-script">
            <div className="director-script-head"><div className="director-section-title">02 — Director script</div><span>{draft.trim() ? `${draft.trim().split(/\s+/).length} words` : 'Not generated'}</span></div>
            <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Your scene-by-scene production script will appear here. It remains fully editable." />
            {progress.total > 0 && <div className="director-live-progress" role="status" aria-live="polite"><div><strong>{progress.phase}</strong><span>{progress.current}/{progress.total}</span></div><i><b style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }} /></i></div>}
            <div className="director-status">{status}</div>
          </div>
        </section>

        <section className="director-delivery">
          <div><p className="director-kicker">03 — Send to production</p><h3>Continue with the tools already proven in your app.</h3></div>
          <div className="director-delivery-actions">
            <button className="director-primary" onClick={autoMuxToExporter} disabled={busy}>{busy ? 'Processing Auto-Mux…' : 'Send Plan to Exporter Timeline (AI Mux)'}</button>
            <button onClick={() => handoff('edit')}>Open in Presentator</button>
            <button onClick={() => handoff('narrate')}>Prepare voice narration</button>
            <button onClick={onOpenCaptions}>Open Caption Burner</button>
          </div>
        </section>
      </main>
    </div>
  );
}
