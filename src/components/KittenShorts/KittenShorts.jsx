import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSrt } from './srtParser.mjs';
import { makeComedicNarration, serializeSrt } from './comedyScript.mjs';

const LANGUAGES = {
  te: { label: 'Telugu', voices: { female: ['Shruti', 'Telugu female voice'], male: ['Mohan', 'Telugu male voice'] }, mood: ['Telugu filmi-style sarcasm', 'Deadpan Telugu sarcasm', 'Full-masala Telugu cartoon'] },
  hi: { label: 'Hindi', voices: { female: ['Swara', 'Hindi female voice'], male: ['Madhur', 'Hindi male voice'] }, mood: ['Bollywood-style sarcasm', 'Deadpan Hindi sarcasm', 'Full-masala Hindi cartoon'] },
  en: { label: 'English (Indian)', voices: { female: ['Neerja', 'Indian English female voice'], male: ['Prabhat', 'Indian English male voice'] }, mood: ['Filmi-style sarcasm', 'Deadpan Indian sarcasm', 'Full-masala cartoon'] },
};
const MOOD_KEYS = ['playful', 'dramatic', 'silly'];

export default function KittenShorts({ active }) {
  const [video, setVideo] = useState(null);
  const [srtFile, setSrtFile] = useState(null);
  const [srtText, setSrtText] = useState('');
  const [voiceMode, setVoiceMode] = useState('both');
  const [language, setLanguage] = useState('te');
  const [mood, setMood] = useState('playful');
  const [showCaptions, setShowCaptions] = useState(false);
  const [soundEffects, setSoundEffects] = useState(true);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const videoRef = useRef(null);
  const srtInputRef = useRef(null);
  const previewUrl = useMemo(() => video ? URL.createObjectURL(video) : '', [video]);
  const busy = Boolean(progress?.running);
  let segments = [];
  let parseError = '';
  if (srtText) {
    try { segments = parseSrt(srtText); }
    catch (issue) { parseError = issue.message || 'Subtitle timings could not be read.'; }
  }
  const comedyLines = segments.map((line, index) => ({ ...line, narrationText: makeComedicNarration(line.text, index, language) }));

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    if (!active || !window.electronAPI?.onKittenShortsProgress) return undefined;
    return window.electronAPI.onKittenShortsProgress(update => setProgress(update));
  }, [active]);

  const loadSrt = async file => {
    setSrtFile(file || null);
    setSrtText(file ? await file.text() : '');
    setError('');
    setResult(null);
  };

  const chooseSrt = async () => {
    const picker = window.electronAPI?.pickKittenShortsSrt;
    if (!picker) {
      srtInputRef.current?.click();
      return;
    }
    setError('');
    try {
      const picked = await picker();
      if (picked?.cancelled) return;
      if (!picked?.ok) throw new Error(picked?.error || 'Could not open that SRT file.');
      setSrtFile({ name: picked.name, path: picked.filePath });
      setSrtText(picked.text || '');
      setResult(null);
    } catch (issue) {
      setError(issue?.message || 'Could not open that SRT file.');
    }
  };

  const exportShort = async () => {
    setError('');
    setResult(null);
    if (!video) return setError('Choose a kitten video first.');
    const videoPath = window.electronAPI?.getPathForFile?.(video) || video.path;
    if (!videoPath) return setError('Please use the desktop Pattan Workspace app to access the source video for export.');
    if (!srtFile || !srtText) return setError('Choose the timed .srt captions file.');
    if (parseError) return setError(parseError);
    if (!segments.length) return setError('The SRT contains no usable subtitle lines.');
    setProgress({ running: true, percent: 0, phase: 'Preparing your Short…', line: 0, total: segments.length });
    try {
      const exported = await window.electronAPI?.exportKittenShort?.({
        videoPath,
        srtText: serializeSrt(comedyLines),
        segments: comedyLines.map(line => ({ ...line, text: line.narrationText })),
        voiceMode,
        language,
        mood,
        showCaptions,
        soundEffects,
      });
      if (!exported?.ok) throw new Error(exported?.error || 'The Short could not be exported.');
      setResult(exported);
      setProgress({ running: false, percent: 100, phase: 'Short ready', line: segments.length, total: segments.length });
      window.electronAPI?.showItemInFolder?.(exported.outputPath);
    } catch (issue) {
      setProgress(previous => ({ ...previous, running: false }));
      setError(issue?.message || 'Export failed.');
    }
  };

  const tail = segments.at(-1)?.end || 0;
  const assignments = comedyLines.slice(0, 6).map((line, index) => ({
    ...line,
    voice: LANGUAGES[language].voices[voiceMode === 'both' ? (index % 2 === 0 ? 'female' : 'male') : voiceMode][0],
  }));
  const selectedLanguage = LANGUAGES[language];

  return (
    <main className="kitten-shorts-page">
      <header className="ks-heading">
        <div><span className="ks-eyebrow">CREATOR STUDIO · YOUTUBE SHORTS</span><h1>Kitten Shorts Voiceover</h1><p>Give your silent kitten clips a funny, perfectly timed voiceover.</p></div>
        <span className="ks-badge">Video stays on your computer · source sound removed</span>
      </header>
      <div className="ks-layout">
        <section className="ks-card ks-input-card">
          <h2>1 · Add your video and SRT</h2>
          <label className="ks-file-drop"><span className="ks-file-icon">▶</span><strong>{video?.name || 'Choose a kitten video'}</strong><small>MP4, MOV, MKV or WebM · original sound will be removed</small><input type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mkv,.m4v" onChange={event => { setVideo(event.target.files?.[0] || null); setVideoDuration(0); setResult(null); setError(''); }} /></label>
          {previewUrl && <video ref={videoRef} className="ks-preview" src={previewUrl} controls muted playsInline onLoadedMetadata={event => setVideoDuration(Number(event.currentTarget.duration || 0))} />}
          <button type="button" className="ks-file-drop ks-srt-drop" title={srtFile?.path || 'Choose an SRT file'} onClick={() => { void chooseSrt(); }}><span className="ks-file-icon">SRT</span><strong>{srtFile?.name || 'Choose timed subtitles (.srt)'}</strong><small>{srtFile?.path ? 'Folder remembered for next time.' : 'Choose an SRT file; its folder will be remembered next time.'}</small></button>
          <input ref={srtInputRef} className="ks-srt-fallback-input" type="file" accept=".srt,application/x-subrip,text/plain" onChange={event => { void loadSrt(event.target.files?.[0] || null); }} />
          {parseError && <p className="ks-inline-error">{parseError}</p>}
          {segments.length > 0 && <p className="ks-valid">✓ {segments.length} timed lines found{tail > videoDuration && videoDuration ? ` · warning: last line ends after the ${videoDuration.toFixed(1)}s video` : ''}</p>}
        </section>

        <section className="ks-card ks-settings-card">
          <h2>2 · Choose the comedy voices</h2>
          <label className="ks-field">Narration language<select value={language} onChange={event => setLanguage(event.target.value)}>{Object.entries(LANGUAGES).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select></label>
          <label className="ks-field">Voice setup<select value={voiceMode} onChange={event => setVoiceMode(event.target.value)}><option value="both">Both · alternate every line</option><option value="female">Female narrator</option><option value="male">Male narrator</option></select></label>
          <div className="ks-voice-pair"><div><span>♀</span><strong>{selectedLanguage.voices.female[0]}</strong><small>{selectedLanguage.voices.female[1]}</small></div><div><span>♂</span><strong>{selectedLanguage.voices.male[0]}</strong><small>{selectedLanguage.voices.male[1]}</small></div></div>
          <label className="ks-field">Funny delivery<select value={mood} onChange={event => setMood(event.target.value)}>{MOOD_KEYS.map((key, index) => <option value={key} key={key}>{selectedLanguage.mood[index]}</option>)}</select></label>
          <label className="ks-caption-toggle"><input type="checkbox" checked={showCaptions} onChange={event => setShowCaptions(event.target.checked)} /><span><strong>Show funny voiceover captions in the finished video</strong><small>Off by default. Captions match the sarcastic narration and sit in a Shorts-safe position.</small></span></label>
          <label className="ks-caption-toggle"><input type="checkbox" checked={soundEffects} onChange={event => setSoundEffects(event.target.checked)} /><span><strong>Add playful cartoon sound effects</strong><small>On by default · quiet locally generated boings and pops, mixed underneath the voices.</small></span></label>
          <div className="ks-note"><strong>{selectedLanguage.label} comedy rewrite is on</strong><span>Each SRT cue provides timing and topic clues, then becomes a short sarcastic {selectedLanguage.label} joke. Captions, when enabled, match the spoken line.</span></div>
        </section>

        <section className="ks-card ks-script-card">
          <div className="ks-section-title"><div><h2>3 · Review the funny {selectedLanguage.label} voiceover</h2><p>SRT supplies the timing and topic cues; {selectedLanguage.voices.female[0]} and {selectedLanguage.voices.male[0]} alternate line by line.</p></div><span>{segments.length} lines</span></div>
          {!segments.length ? <div className="ks-empty">Your timed SRT lines will appear here.</div> : <div className="ks-script-list">{assignments.map((line, index) => <div className="ks-script-line" key={`${line.start}-${index}`}><time>{new Date(line.start * 1000).toISOString().slice(14, 19)}</time><p><small className="ks-original-line">SRT: {line.caption}</small><strong className="ks-comedy-line">{line.narrationText}</strong></p><span>{line.voice}</span></div>)}{segments.length > assignments.length && <small className="ks-more">…and {segments.length - assignments.length} more timed lines</small>}</div>}
        </section>
      </div>

      {(busy || error || result) && <section className={`ks-status ${error ? 'is-error' : ''}`} aria-live="polite">
        {busy && <><div className="ks-status-top"><strong>{progress?.phase || 'Preparing…'}</strong><span>{Math.min(99, progress?.percent || 0)}%</span></div><div className="ks-progress"><i style={{ width: `${Math.max(2, Math.min(99, progress?.percent || 0))}%` }} /></div><small>{progress?.line && progress?.total ? `Voice line ${progress.line} of ${progress.total}` : 'Please keep this module open while the video is being prepared.'}</small></>}
        {error && <><strong>Could not make the Short</strong><p>{error}</p></>}
        {result && <><strong>✓ Your Short is ready</strong><p>{result.outputPath}</p><small>Vertical 1080 × 1920 · original clip audio removed · {result.voiceLines} voice lines</small></>}
      </section>}

      <footer className="ks-footer"><p>Telugu, Hindi, and Indian English voices use Microsoft Edge Neural TTS and need internet. Playful effects and video rendering are local; the result is saved in Downloads.</p><button type="button" onClick={exportShort} disabled={busy || !video || !srtFile || Boolean(parseError)}>{busy ? 'Creating your Short…' : 'Create funny Short'}</button></footer>
    </main>
  );
}
