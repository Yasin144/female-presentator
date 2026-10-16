import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime, parseSrt } from './srtUtils.mjs';
import './srt-voice-studio.css';

const VOICES = {
  en: { label: 'English (India)', female: 'en-IN-NeerjaNeural', male: 'en-IN-PrabhatNeural' },
  hi: { label: 'Hindi', female: 'hi-IN-SwaraNeural', male: 'hi-IN-MadhurNeural' },
  te: { label: 'Telugu', female: 'te-IN-ShrutiNeural', male: 'te-IN-MohanNeural' },
  ta: { label: 'Tamil', female: 'ta-IN-PallaviNeural', male: 'ta-IN-ValluvarNeural' },
  kn: { label: 'Kannada', female: 'kn-IN-SapnaNeural', male: 'kn-IN-GaganNeural' },
  ml: { label: 'Malayalam', female: 'ml-IN-SobhanaNeural', male: 'ml-IN-MidhunNeural' },
};
const VOICE_PREVIEW_TEXT = {
  te: 'నమస్కారం! మైక్ ఆన్‌లో ఉంది… కానీ నా జోక్‌కి మాత్రం ఇంకా సిగ్నల్ రావాలి!',
  hi: 'नमस्ते! माइक चालू है… बस मेरे मज़ाक को अभी नेटवर्क मिलना बाकी है!',
  ta: 'வணக்கம்! மைக் வேலை செய்கிறது… என் ஜோக்குக்கு மட்டும் இன்னும் சிக்னல் வரல!',
  kn: 'ನಮಸ್ಕಾರ! ಮೈಕ್ ಕೆಲಸ ಮಾಡುತ್ತಿದೆ… ನನ್ನ ಜೋಕ್‌ಗೆ ಮಾತ್ರ ಇನ್ನೂ ಸಿಗ್ನಲ್ ಸಿಕ್ಕಿಲ್ಲ!',
  ml: 'നമസ്കാരം! മൈക്ക് ഓണാണ്… എന്റെ തമാശയ്ക്ക് മാത്രം ഇനിയും സിഗ്നൽ കിട്ടിയിട്ടില്ല!',
  en: 'Hello! The mic is working perfectly. My joke is still waiting for a signal.',
};
const COLORS = ['#67e8f9', '#f9a8d4', '#fbbf24', '#a78bfa'];
const emptyTrack = gender => ({ name: '', cues: [], language: 'te', gender });
const fileUrl = value => encodeURI(`file:///${String(value || '').replace(/\\/g, '/')}`).replace(/#/g, '%23').replace(/\?/g, '%3F');

export default function SrtVoiceStudio({ active = true }) {
  const [video, setVideo] = useState(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState('');
  const [tracks, setTracks] = useState([emptyTrack('female'), emptyTrack('male'), emptyTrack('female')]);
  const [comedyCues, setComedyCues] = useState([]);
  const [comedyLanguage, setComedyLanguage] = useState('te');
  const [comedyStyle, setComedyStyle] = useState('playful');
  const [comedyDraftConfig, setComedyDraftConfig] = useState(null);
  const [comedyGender, setComedyGender] = useState('female');
  const [comedyApproved, setComedyApproved] = useState(false);
  const [comedyWorking, setComedyWorking] = useState(false);
  const [voicePreviewing, setVoicePreviewing] = useState(false);
  const [comedyProgress, setComedyProgress] = useState(null);
  const [comedyNotice, setComedyNotice] = useState('');
  const [removeOriginalAudio, setRemoveOriginalAudio] = useState(true);
  const [originalAudioLevel, setOriginalAudioLevel] = useState(0.5);
  const [position, setPosition] = useState(0);
  const [outputPath, setOutputPath] = useState('');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [selectedCue, setSelectedCue] = useState(null);
  const [undoSnapshot, setUndoSnapshot] = useState(null);
  const [sourceAudioDetached, setSourceAudioDetached] = useState(false);
  const [syncToSceneAction, setSyncToSceneAction] = useState(false);
  const player = useRef(null);
  const timelineRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onSrtVoiceProgress?.(setProgress);
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onSrtComedyProgress?.(setComedyProgress);
    return () => { if (typeof unsubscribe === 'function') unsubscribe(); };
  }, []);
  useEffect(() => { if (!active) player.current?.pause(); }, [active]);
  useEffect(() => () => { if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl); }, [sourcePreviewUrl]);

  const duration = Number(video?.duration) || 0;
  const timelineVideoDuration = Math.max(duration, Number(video?.renderDuration) || 0);
  const loadedTracks = tracks.filter(track => track.cues.length);
  // If the user provides a single dialogue SRT, keep its text/timestamps intact
  // and alternate the two Indian voices cue-by-cue across that conversation.
  const assignedTracks = loadedTracks.length === 1
    ? [
      { ...loadedTracks[0], sourceTrackIndex: tracks.indexOf(loadedTracks[0]), cues: loadedTracks[0].cues.map((cue, index) => ({ ...cue, cueIndex: index, speakerGender: cue.speakerGender || (index % 2 === 0 ? 'female' : 'male') })).filter(cue => cue.speakerGender === 'female'), gender: 'female' },
      { ...loadedTracks[0], sourceTrackIndex: tracks.indexOf(loadedTracks[0]), cues: loadedTracks[0].cues.map((cue, index) => ({ ...cue, cueIndex: index, speakerGender: cue.speakerGender || (index % 2 === 0 ? 'female' : 'male') })).filter(cue => cue.speakerGender === 'male'), gender: 'male' },
    ].filter(track => track.cues.length)
    : loadedTracks;
  const effectiveGenders = new Set(assignedTracks.map(track => track.gender));
  const hasFemaleTrack = effectiveGenders.has('female');
  const hasMaleTrack = effectiveGenders.has('male');
  const hasBothVoices = hasFemaleTrack && hasMaleTrack;
  const comedyReadyCues = comedyCues.filter(cue => String(cue.text || '').trim() && Number(cue.end) > Number(cue.start));
  const comedyNeedsRedraft = comedyCues.length > 0 && (comedyDraftConfig?.style !== comedyStyle || comedyDraftConfig?.language !== comedyLanguage);
  const comedyOnly = loadedTracks.length === 0 && comedyReadyCues.length > 0 && comedyApproved && !comedyNeedsRedraft;
  const cueCount = loadedTracks.reduce((total, track) => total + track.cues.length, comedyCues.length);
  const outside = [...loadedTracks.flatMap(track => track.cues), ...comedyCues].filter(cue => timelineVideoDuration && cue.end > timelineVideoDuration + 0.15).length;
  const timelineDuration = Math.max(timelineVideoDuration, ...loadedTracks.flatMap(track => track.cues.map(cue => cue.end)), ...comedyCues.map(cue => cue.end), 1);
  const ready = Boolean(video?.path && (comedyOnly || (loadedTracks.length > 0 && hasBothVoices)) && !outside && !working && !comedyWorking
    && (!comedyReadyCues.length || (comedyApproved && !comedyNeedsRedraft)));
  const displayedUrl = outputPath ? fileUrl(outputPath) : sourcePreviewUrl;
  const activeCues = useMemo(() => [...tracks, { cues: comedyCues }].flatMap((track, trackIndex) => track.cues
    .filter(cue => cue.start <= position && cue.end > position)
    .map(cue => ({ ...cue, trackIndex }))), [tracks, comedyCues, position]);

  const updateTrack = (index, change) => {
    setTracks(current => current.map((track, trackIndex) => trackIndex === index ? { ...track, ...change } : track));
    setOutputPath('');
    setError('');
  };
  const saveUndo = () => setUndoSnapshot({ tracks, comedyCues });
  const updateTimelineCue = (type, trackIndex, cueIndex, change) => {
    const applyChange = cue => ({ ...cue, ...change, timelineBaseStart: change.start ?? cue.start, timelineBaseEnd: change.end ?? cue.end, actionSyncOffset: 0, delayedForDialogue: 0 });
    if (type === 'comedy') setComedyCues(current => current.map((cue, index) => index === cueIndex ? applyChange(cue) : cue));
    else setTracks(current => current.map((track, index) => index === trackIndex
      ? { ...track, cues: track.cues.map((cue, cueIdx) => cueIdx === cueIndex ? applyChange(cue) : cue) }
      : track));
    setOutputPath('');
  };
  const removeTimelineCue = () => {
    if (!selectedCue) return;
    saveUndo();
    if (selectedCue.type === 'comedy') {
      setComedyCues(current => current.filter((_, index) => index !== selectedCue.cueIndex));
      setComedyApproved(false);
    } else {
      setTracks(current => current.map((track, index) => index === selectedCue.trackIndex
        ? { ...track, cues: track.cues.filter((_, cueIndex) => cueIndex !== selectedCue.cueIndex) }
        : track));
    }
    setSelectedCue(null);
    setOutputPath('');
  };
  const splitSelectedCue = () => {
    if (!selectedCue) return;
    const cues = selectedCue.type === 'comedy' ? comedyCues : tracks[selectedCue.trackIndex]?.cues;
    const cue = cues?.[selectedCue.cueIndex];
    if (!cue || position <= cue.start + 0.08 || position >= cue.end - 0.08) return;
    const words = String(cue.text || '').trim().split(/\s+/);
    if (words.length < 2) { setError('A cue needs at least two words to split its dialogue.'); return; }
    saveUndo();
    const splitAt = Math.max(1, Math.min(words.length - 1, Math.round(words.length * (position - cue.start) / (cue.end - cue.start))));
    const first = { ...cue, start: cue.start, end: position, text: words.slice(0, splitAt).join(' '), timelineBaseStart: undefined, timelineBaseEnd: undefined, delayedForDialogue: 0, actionSyncOffset: 0 };
    const second = { ...cue, start: position, end: cue.end, text: words.slice(splitAt).join(' '), timelineBaseStart: undefined, timelineBaseEnd: undefined, delayedForDialogue: 0, actionSyncOffset: 0 };
    if (selectedCue.type === 'comedy') {
      setComedyCues(current => current.flatMap((item, index) => index === selectedCue.cueIndex ? [first, second] : [item]));
      setComedyApproved(false);
    } else {
      setTracks(current => current.map((track, index) => index === selectedCue.trackIndex
        ? { ...track, cues: track.cues.flatMap((item, cueIndex) => cueIndex === selectedCue.cueIndex ? [first, second] : [item]) }
        : track));
    }
    setSelectedCue({ ...selectedCue, cueIndex: selectedCue.cueIndex + 1 });
    setOutputPath('');
  };
  const undoTimelineEdit = () => {
    if (!undoSnapshot) return;
    setTracks(undoSnapshot.tracks);
    setComedyCues(undoSnapshot.comedyCues);
    setUndoSnapshot(null);
    setOutputPath('');
  };
  const beginCueDrag = (event, type, trackIndex, cueIndex, mode, cue) => {
    event.stopPropagation();
    event.preventDefault();
    saveUndo();
    setSelectedCue({ type, trackIndex, cueIndex });
    dragRef.current = { type, trackIndex, cueIndex, mode, x: event.clientX, start: cue.start, end: cue.end };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveCueDrag = event => {
    const drag = dragRef.current;
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!drag || !rect?.width) return;
    const delta = (event.clientX - drag.x) / rect.width * timelineDuration;
    const length = drag.end - drag.start;
    if (drag.mode === 'move') {
      const start = Math.max(0, Math.min(timelineDuration - length, drag.start + delta));
      updateTimelineCue(drag.type, drag.trackIndex, drag.cueIndex, { start, end: start + length, delayedForDialogue: 0 });
    } else if (drag.mode === 'left') {
      updateTimelineCue(drag.type, drag.trackIndex, drag.cueIndex, { start: Math.max(0, Math.min(drag.end - 0.08, drag.start + delta)), delayedForDialogue: 0 });
    } else {
      updateTimelineCue(drag.type, drag.trackIndex, drag.cueIndex, { end: Math.max(drag.start + 0.08, Math.min(timelineDuration, drag.end + delta)), delayedForDialogue: 0 });
    }
  };
  const finishCueDrag = event => {
    const drag = dragRef.current;
    if (drag?.type === 'srt' && drag.mode === 'move') {
      const targetLane = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-srt-lane]');
      const targetTrackIndex = Number(targetLane?.dataset.srtLane);
      if (Number.isInteger(targetTrackIndex) && targetTrackIndex !== drag.trackIndex && tracks[targetTrackIndex]) {
        const cue = tracks[drag.trackIndex]?.cues[drag.cueIndex];
        if (cue) {
          const movedCue = { ...cue, speakerGender: tracks[targetTrackIndex].gender };
          const targetCueIndex = [...tracks[targetTrackIndex].cues, movedCue].sort((a, b) => a.start - b.start || a.end - b.end).indexOf(movedCue);
          setTracks(current => current.map((track, index) => index === drag.trackIndex
            ? { ...track, cues: track.cues.filter((_, cueIndex) => cueIndex !== drag.cueIndex) }
            : index === targetTrackIndex
              ? { ...track, cues: [...track.cues, movedCue].sort((a, b) => a.start - b.start || a.end - b.end) }
              : track));
          setSelectedCue({ type: 'srt', trackIndex: targetTrackIndex, cueIndex: targetCueIndex });
          setOutputPath('');
        }
      }
    }
    dragRef.current = null;
  };
  useEffect(() => {
    const onKeyDown = event => {
      if (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedCue) { event.preventDefault(); removeTimelineCue(); }
      if (event.key.toLowerCase() === 's' && selectedCue) { event.preventDefault(); splitSelectedCue(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  const chooseVideo = async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const path = window.electronAPI?.getPathForFile?.(file);
      if (!path) throw new Error('This module needs the desktop app to export a video.');
      const probe = await window.electronAPI.myExporterProbe({ filePath: path });
      if (!probe?.ok || !probe?.hasVideo || !probe?.duration) throw new Error(probe?.error || 'This video could not be read.');
      setSourcePreviewUrl(URL.createObjectURL(file));
      setVideo({ path, name: file.name, duration: Number(probe.duration), hasAudio: Boolean(probe.hasAudio) });
      setSourceAudioDetached(Boolean(probe.hasAudio));
      setRemoveOriginalAudio(true);
      setOriginalAudioLevel(0.5);
      setPosition(0);
      setOutputPath('');
      setComedyCues([]);
      setComedyApproved(false);
      setComedyDraftConfig(null);
      setError('');
    } catch (caught) { setError(caught.message || String(caught)); }
  };
  const chooseSrt = async (index, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { updateTrack(index, { name: file.name, cues: parseSrt(await file.text()) }); setComedyCues([]); setComedyApproved(false); setComedyDraftConfig(null); }
    catch (caught) { updateTrack(index, { name: '', cues: [] }); setError(`${file.name}: ${caught.message || caught}`); }
  };
  const seek = seconds => {
    const next = Math.max(0, Math.min(timelineDuration, seconds));
    if (player.current) player.current.currentTime = next;
    setPosition(next);
  };
  const render = async () => {
    if (!ready) return;
    setError('');
    const baseName = video.name.replace(/\.[^.]+$/, '');
    const chosen = await window.electronAPI.showSaveDialog({
      title: 'Export video with SRT voice tracks',
      defaultPath: `${baseName}-srt-voices.mp4`,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      buttonLabel: 'Generate and export',
    });
    if (chosen?.canceled || !chosen?.filePath) return;
    setWorking(true);
    setProgress({ pct: 1, phase: 'Preparing SRT voice tracks' });
    try {
      const result = await window.electronAPI.renderSrtVoiceVideo({
        videoPath: video.path,
        outputPath: chosen.filePath,
        originalAudioLevel,
        removeOriginalAudio,
        syncToSceneAction,
        comedyApproved: comedyApproved && !comedyNeedsRedraft,
        tracks: [...assignedTracks.map(track => ({
          voice: VOICES[track.language][track.gender],
          gender: track.gender,
          sourceTrackIndex: track.sourceTrackIndex ?? tracks.indexOf(track),
          cues: track.cues.map((cue, cueIndex) => ({ ...cue, start: cue.timelineBaseStart ?? cue.start, end: cue.timelineBaseEnd ?? cue.end, cueIndex: cue.cueIndex ?? cueIndex })),
        })), ...(comedyReadyCues.length ? [{ kind: 'comedy', voice: VOICES[comedyLanguage][comedyGender], gender: comedyGender, sourceTrackIndex: 3, cues: comedyReadyCues.map((cue, cueIndex) => {
          const gender = cueIndex % 2 === 0 ? comedyGender : (comedyGender === 'female' ? 'male' : 'female');
          return { ...cue, gender, voice: VOICES[comedyLanguage][gender], start: cue.timelineBaseStart ?? cue.start, end: cue.timelineBaseEnd ?? cue.end, cueIndex };
        }) }] : [])],
      });
      if (!result?.ok) throw new Error(result?.error || 'Video export failed.');
      if (Array.isArray(result.scheduledCues) && result.scheduledCues.length) {
        setTracks(current => current.map((track, trackIndex) => ({
          ...track,
          cues: track.cues.map((cue, cueIndex) => {
            const scheduled = result.scheduledCues.find(item => item.sourceTrackIndex === trackIndex && item.cueIndex === cueIndex);
            return scheduled ? { ...cue, start: scheduled.start, end: scheduled.end, timelineBaseStart: scheduled.sourceStart, timelineBaseEnd: scheduled.sourceEnd, delayedForDialogue: scheduled.delayedForDialogue, actionSyncOffset: scheduled.actionSyncOffset } : cue;
          }),
        })));
        setComedyCues(current => current.map((cue, cueIndex) => {
          const scheduled = result.scheduledCues.find(item => item.sourceTrackIndex === 3 && item.cueIndex === cueIndex);
          return scheduled ? { ...cue, start: scheduled.start, end: scheduled.end, timelineBaseStart: scheduled.sourceStart, timelineBaseEnd: scheduled.sourceEnd, delayedForDialogue: scheduled.delayedForDialogue, actionSyncOffset: scheduled.actionSyncOffset } : cue;
        }));
      }
      setOutputPath(result.outputPath);
      setVideo(current => current ? { ...current, renderDuration: Number(result.duration) || current.duration } : current);
      setProgress({ pct: 100, phase: `Exported ${result.cueCount} spoken cues.${result.extendedSeconds > 0.05 ? ` Added ${result.extendedSeconds.toFixed(1)}s of final-frame hold for dialogue.` : ''}` });
      setPosition(0);
    } catch (caught) { setError(caught.message || String(caught)); }
    finally { setWorking(false); }
  };
  const updateComedyCue = (index, change) => {
    setComedyCues(current => current.map((cue, cueIndex) => cueIndex === index ? { ...cue, ...change } : cue));
    setComedyApproved(false);
    setOutputPath('');
  };
  const analyzeComedy = async () => {
    if (!video?.path || working || comedyWorking) return;
    setError('');
    setComedyNotice('');
    setComedyApproved(false);
    setComedyWorking(true);
    setComedyProgress({ pct: 0, phase: 'Preparing local video analysis' });
    try {
      const result = await window.electronAPI.analyzeSrtComedyVideo({
        videoPath: video.path,
        language: VOICES[comedyLanguage].label,
        style: comedyStyle,
        blockedCues: tracks.flatMap(track => track.cues),
      });
      if (!result?.ok) throw new Error(result?.error || 'Local scene analysis failed.');
      setComedyCues(result.cues || []);
      setComedyApproved(false);
      setComedyDraftConfig({ style: comedyStyle, language: comedyLanguage });
      setOutputPath('');
      if (!result.cues?.length) setComedyNotice('No visual comedy draft this time. That’s okay—this feature is optional. Your uploaded SRT dialogue can still be voiced and synced using the Generate & export button.');
    } catch (caught) { setError(caught.message || String(caught)); }
    finally { setComedyWorking(false); }
  };
  const previewComedyVoice = async () => {
    if (voicePreviewing) return;
    setError('');
    setVoicePreviewing(true);
    try {
      if (typeof window.electronAPI?.narrateEdgeTts !== 'function') throw new Error('Voice preview is available in the desktop app.');
      const result = await window.electronAPI.narrateEdgeTts({
        text: VOICE_PREVIEW_TEXT[comedyLanguage] || VOICE_PREVIEW_TEXT.te,
        voice: VOICES[comedyLanguage][comedyGender],
        language: comedyLanguage,
      });
      if (!result?.ok || !result.audioBase64) throw new Error(result?.error || 'Edge voice preview returned no audio. Check your internet connection and retry.');
      const audio = new Audio(`data:${result.contentType || 'audio/mpeg'};base64,${result.audioBase64}`);
      await audio.play();
    } catch (caught) { setError(caught.message || String(caught)); }
    finally { setVoicePreviewing(false); }
  };

  return <main className="srt-studio">
    <div className="srt-heading"><div><p className="srt-eyebrow">VIDEO + SUBTITLE VOICES</p><h1>SRT Voice Studio</h1><p>Turn SRT files into voices, or create action-matched comedy for a silent video. Review every line before export.</p></div><span>Up to 3 SRT tracks + comedy</span></div>
    {!window.electronAPI?.renderSrtVoiceVideo && <p className="srt-error">Open this tool in the desktop app to generate and export voice tracks.</p>}
    <section className="srt-grid">
      <div className="srt-card"><h2>1. Source video</h2><input type="file" accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v" onChange={chooseVideo} aria-label="Choose source video" />{video && <p>{video.name} · {formatTime(duration)} {video.hasAudio ? '· original audio available' : '· silent source'}</p>}
        {video?.hasAudio && <small>The source sound has its own editable lane below. Detach it there to keep, mix, mute, or remove it from export.</small>}
        {video && <label className="srt-remove-audio"><input type="checkbox" checked={syncToSceneAction} onChange={event => { setSyncToSceneAction(event.target.checked); setOutputPath(''); }} /><span><strong>Sync voices to visible scenes and actions</strong><small>Local vision may shift a line by up to 0.75 seconds. It never rewrites your SRT text; it can add time to voice generation. Requires the local vision model.</small></span></label>}
      </div>
      <div className="srt-card srt-tracks"><h2>2. Upload SRT dialogue tracks (optional for comedy)</h2><p>Upload SRT dialogue to voice its timed lines, or leave these empty and approve a comedy script below to generate only those comedy lines. Telugu is selected by default.</p>{tracks.map((track, index) => <div className="srt-track-input" key={index} style={{ '--track-color': COLORS[index] }}><div><strong>Voice track {index + 1}</strong><small>{track.cues.length ? `${track.cues.length} cues · ${track.gender === 'female' ? 'Indian female' : 'Indian male'}` : `Upload ${track.gender === 'female' ? 'female' : 'male'} speaker SRT`} </small></div><input type="file" accept=".srt,text/plain" aria-label={`Upload SRT for voice track ${index + 1}`} onChange={event => chooseSrt(index, event)} /><select aria-label={`Language for track ${index + 1}`} value={track.language} onChange={event => updateTrack(index, { language: event.target.value })}>{Object.entries(VOICES).map(([code, option]) => <option key={code} value={code}>{option.label}</option>)}</select><select aria-label={`Voice gender for track ${index + 1}`} value={track.gender} onChange={event => updateTrack(index, { gender: event.target.value })}><option value="female">Indian female voice · {VOICES[track.language].female.replace(/Neural$/, '')}</option><option value="male">Indian male voice · {VOICES[track.language].male.replace(/Neural$/, '')}</option></select>{track.name && <div className="srt-file-name"><small>{track.name}</small><button type="button" onClick={() => { updateTrack(index, { name: '', cues: [] }); setComedyCues([]); setComedyApproved(false); }}>Remove</button></div>}</div>)}</div>
    </section>
    <section className="srt-card srt-comedy">
      <div className="srt-section-title"><h2>3. Comedy from video action</h2><span>Private, local scene analysis</span></div>
      <p>Choose a Telugu comedy style and preview either Indian voice. The laugh-first default is playful and goofy. For your SRTs, text stays unchanged and subtitle times are the earliest start points; when lines overlap, dialogue is queued in order so voices take turns instead of talking over each other. Any moved lines are reflected on the timeline after export.</p>
      {comedyNotice && <p role="status" style={{ margin: '10px 0', padding: '11px 14px', border: '1px solid #477487', borderRadius: 9, background: '#102d3b', color: '#c7ebf7' }}>{comedyNotice}</p>}
      <div className="srt-comedy-controls"><select aria-label="Comedy dialogue language" value={comedyLanguage} onChange={event => { setComedyLanguage(event.target.value); setComedyApproved(false); }}>{Object.entries(VOICES).map(([code, option]) => <option key={code} value={code}>{option.label}</option>)}</select><select aria-label="Comedy dialogue style" value={comedyStyle} onChange={event => { setComedyStyle(event.target.value); setComedyApproved(false); }}><option value="playful">Laugh-first · playful &amp; goofy (default)</option><option value="joyful">Joyful &amp; funny</option><option value="sarcastic">Gentle sarcasm</option><option value="witty">Punchy &amp; witty</option></select><select aria-label="Comedy dialogue voice" value={comedyGender} onChange={event => setComedyGender(event.target.value)}><option value="female">Indian female · Shruti</option><option value="male">Indian male · Mohan</option></select><button type="button" className="srt-secondary" onClick={previewComedyVoice} disabled={voicePreviewing}>{voicePreviewing ? 'Loading voice…' : '▶ Preview selected voice'}</button><button type="button" onClick={analyzeComedy} disabled={!video?.path || working || comedyWorking || !window.electronAPI?.analyzeSrtComedyVideo}>{comedyWorking ? 'Drafting comedy…' : comedyNeedsRedraft ? 'Redraft with these settings' : 'Draft comedy script'}</button>{comedyWorking && <button type="button" className="srt-secondary" onClick={() => window.electronAPI?.cancelSrtComedyAnalysis?.()}>Cancel</button>}</div>
      {comedyProgress && <div className="srt-progress" role="status"><div style={{ width: `${Math.max(0, Math.min(100, Number(comedyProgress.pct) || 0))}%` }} /><span>{comedyProgress.phase}</span></div>}
      {comedyCues.length > 0 && <h3 className="srt-script-heading">Comedy script preview · edit any line before voicing</h3>}
      <div className="srt-comedy-list">{comedyCues.map((cue, index) => <div className="srt-comedy-row" key={index}><button type="button" onClick={() => seek(Number(cue.start) || 0)} title="Seek to this action">▶</button><label>Start<input type="number" min="0" step="0.1" value={cue.start} onChange={event => updateComedyCue(index, { start: Number(event.target.value) })} /></label><label>End<input type="number" min="0" step="0.1" value={cue.end} onChange={event => updateComedyCue(index, { end: Number(event.target.value) })} /></label><input type="text" aria-label={`Comedy dialogue ${index + 1}`} value={cue.text} onChange={event => updateComedyCue(index, { text: event.target.value })} placeholder="Edit the spoken line here" /><button type="button" onClick={() => { setComedyCues(current => current.filter((_, cueIndex) => cueIndex !== index)); setComedyApproved(false); setOutputPath(''); }} aria-label={`Remove comedy line ${index + 1}`}>×</button>{cue.action && <small>Observed: {cue.action} · confidence {Math.round((cue.confidence || 0) * 100)}%</small>}</div>)}</div>
      <button type="button" className="srt-add-comedy" disabled={!video} onClick={() => { setComedyCues(current => [...current, { start: Math.max(0, position), end: Math.min(duration, position + 3), text: '', action: 'Manual line', confidence: 1 }]); setComedyDraftConfig({ style: comedyStyle, language: comedyLanguage }); setComedyApproved(false); setOutputPath(''); }}>Add comedy line at playhead</button>
      {comedyCues.length > 0 && comedyNeedsRedraft && <p className="srt-script-hint">You changed the language or style. Redraft the script to apply those settings before approving it.</p>}
      {comedyReadyCues.length > 0 && <div className={`srt-script-approval ${comedyApproved && !comedyNeedsRedraft ? 'approved' : ''}`}><div><strong>{comedyApproved && !comedyNeedsRedraft ? 'Script approved for voice generation' : 'Review the script before processing'}</strong><small>{comedyApproved && !comedyNeedsRedraft ? 'You can still edit a line; edits will require approval again.' : 'No comedy voice will be generated until you approve these lines.'}</small></div><button type="button" disabled={comedyNeedsRedraft} onClick={() => setComedyApproved(value => !value)}>{comedyApproved && !comedyNeedsRedraft ? 'Reopen script review' : 'Approve script & continue'}</button></div>}
    </section>
    <section className="srt-card srt-preview">
      <div className="srt-section-title"><h2>4. Preview timeline</h2><span>{cueCount} cues · {formatTime(position)} / {formatTime(timelineDuration)}</span></div>
      <div className="srt-timeline-tools"><button type="button" disabled={!selectedCue || !undoSnapshot} onClick={undoTimelineEdit}>↶ Undo</button><button type="button" disabled={!selectedCue} onClick={splitSelectedCue}>✂ Split at playhead <kbd>S</kbd></button><button type="button" className="srt-timeline-delete" disabled={!selectedCue} onClick={removeTimelineCue}>Delete selected <kbd>Del</kbd></button><span>Drag a cue to move it; drag an edge to trim; drag across a voice lane to change speaker.</span></div>
      <div className="srt-player"><video ref={player} src={displayedUrl || undefined} muted={!outputPath && removeOriginalAudio} controls preload="metadata" onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} /><div className="srt-live-cues">{activeCues.map((cue, index) => <p key={`${cue.trackIndex}-${cue.start}-${index}`} style={{ borderColor: COLORS[cue.trackIndex] }}><b>{cue.trackIndex === 3 ? 'Comedy' : `SRT ${cue.trackIndex + 1}`}:</b> {cue.text}{cue.actionSyncOffset !== 0 && Number.isFinite(cue.actionSyncOffset) && <small> scene {cue.actionSyncOffset > 0 ? '+' : ''}{cue.actionSyncOffset.toFixed(2)}s</small>}{cue.delayedForDialogue > 0.05 && <small> queued +{cue.delayedForDialogue.toFixed(1)}s</small>}</p>)}</div></div>
      <p className="srt-preview-note">{outputPath ? 'Playing the finished video with generated voices.' : syncToSceneAction ? 'Scene/action sync is enabled: local vision will make small timing adjustments, then overlapping dialogue is queued. Your SRT wording stays unchanged.' : 'Before export, this player has the original sound. The colored lanes show exactly when generated speech will start and stop.'}</p>
      <div ref={timelineRef} className="srt-timeline" onPointerMove={moveCueDrag} onPointerUp={finishCueDrag} onPointerCancel={() => { dragRef.current = null; }} onClick={event => { if (event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); seek((event.clientX - rect.left) / rect.width * timelineDuration); }}>
        <div className="srt-ruler"><span>0:00</span><span>{formatTime(timelineDuration)}</span></div>
        {tracks.map((track, index) => <div className="srt-lane" data-srt-lane={index} key={index}><span className="srt-lane-label">{index + 1} · {track.gender === 'female' ? '♀' : '♂'}</span>{track.cues.map((cue, cueIndex) => <div key={cueIndex} role="button" tabIndex={0} className={`srt-cue ${selectedCue?.type === 'srt' && selectedCue.trackIndex === index && selectedCue.cueIndex === cueIndex ? 'selected' : ''}`} style={{ left: `${cue.start / timelineDuration * 100}%`, width: `${Math.max(0.55, (cue.end - cue.start) / timelineDuration * 100)}%`, background: COLORS[index] }} title={`${formatTime(cue.start)}–${formatTime(cue.end)} · ${cue.text}`} onPointerDown={event => beginCueDrag(event, 'srt', index, cueIndex, 'move', cue)} onClick={event => { event.stopPropagation(); setSelectedCue({ type: 'srt', trackIndex: index, cueIndex }); seek(cue.start); }} aria-label={`Edit SRT track ${index + 1} cue ${cueIndex + 1}: ${cue.text}`}><span className="srt-trim srt-trim-left" onPointerDown={event => beginCueDrag(event, 'srt', index, cueIndex, 'left', cue)} /><span className="srt-cue-label">{cue.text}</span><span className="srt-trim srt-trim-right" onPointerDown={event => beginCueDrag(event, 'srt', index, cueIndex, 'right', cue)} /></div>)}</div>)}
        <div className="srt-lane"><span className="srt-lane-label" title="Comedy dialogue">C</span>{comedyCues.map((cue, index) => <div key={index} role="button" tabIndex={0} className={`srt-cue ${selectedCue?.type === 'comedy' && selectedCue.cueIndex === index ? 'selected' : ''}`} style={{ left: `${cue.start / timelineDuration * 100}%`, width: `${Math.max(0.55, (cue.end - cue.start) / timelineDuration * 100)}%`, background: COLORS[3] }} title={`${formatTime(cue.start)}–${formatTime(cue.end)} · ${cue.text}`} onPointerDown={event => beginCueDrag(event, 'comedy', 0, index, 'move', cue)} onClick={event => { event.stopPropagation(); setSelectedCue({ type: 'comedy', trackIndex: 0, cueIndex: index }); seek(Number(cue.start) || 0); }} aria-label={`Edit comedy cue ${index + 1}: ${cue.text}`}><span className="srt-trim srt-trim-left" onPointerDown={event => beginCueDrag(event, 'comedy', 0, index, 'left', cue)} /><span className="srt-cue-label">{cue.text}</span><span className="srt-trim srt-trim-right" onPointerDown={event => beginCueDrag(event, 'comedy', 0, index, 'right', cue)} /></div>)}</div>
        {video?.hasAudio && <div className={`srt-lane srt-audio-lane ${removeOriginalAudio ? 'audio-removed' : ''}`}><span className="srt-lane-label">A</span><div className="srt-audio-clip"><strong>Original audio · {sourceAudioDetached ? 'detached' : 'embedded'}</strong><button type="button" onClick={() => { setSourceAudioDetached(true); setRemoveOriginalAudio(value => !value); setOutputPath(''); }}>{removeOriginalAudio ? 'Restore / keep' : 'Remove audio'}</button><label>Volume <input type="range" min="0" max="100" value={Math.round(originalAudioLevel * 100)} disabled={removeOriginalAudio} onChange={event => { setOriginalAudioLevel(Number(event.target.value) / 100); setOutputPath(''); }} /> {Math.round(originalAudioLevel * 100)}%</label></div></div>}
        <div className="srt-playhead" style={{ left: `${position / timelineDuration * 100}%` }} />
      </div>
      {outside > 0 && <p className="srt-error">{outside} cue(s) extend beyond the end of the video. Correct the timing before export.</p>}
    </section>
    <div className="srt-actions"><button type="button" onClick={render} disabled={!ready || !window.electronAPI?.renderSrtVoiceVideo}>{working ? 'Generating voices and video…' : comedyOnly ? 'Generate comedy voices & export MP4' : 'Generate & export MP4'}</button>{outputPath && <button type="button" className="srt-secondary" onClick={() => window.electronAPI?.showItemInFolder?.(outputPath)}>Show exported file</button>}<span>{comedyOnly ? `${comedyReadyCues.length} approved comedy lines · alternating Indian female and male voices · no SRT needed` : `${loadedTracks.length} SRT tracks · ${hasFemaleTrack ? 'Female ✓' : 'Female missing'} · ${hasMaleTrack ? 'Male ✓' : 'Male missing'} · SRT timing preserved`}</span></div>
    {progress && <div className="srt-progress" role="status"><div style={{ width: `${Math.max(0, Math.min(100, Number(progress.pct) || 0))}%` }} /><span>{progress.phase}</span></div>}{error && <p className="srt-error" role="alert">{error}</p>}
  </main>;
}
