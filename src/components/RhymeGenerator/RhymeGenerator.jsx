import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Flow } from '../../services/flow-sdk';

const DURATION = 30;
const SAMPLE_RATE = 44100;

function fallbackLyrics(topic) {
  const subject = topic.trim() || 'a happy little star';
  return `Come along and sing today,\n${subject} leads the way!\nClap your hands and tap your feet,\nLearning makes our day so sweet!\n\nRound and round, one, two, three,\nHappy friends for you and me!\nSmile and sing, hip-hip-hooray,\nWe learned something new today!`;
}

function seededNumber(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return Math.abs(value >>> 0);
}

function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const bytes = 44 + buffer.length * channels * 2;
  const array = new ArrayBuffer(bytes);
  const view = new DataView(array);
  const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, bytes - 8, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, 'data');
  view.setUint32(40, bytes - 44, true);
  let offset = 44;
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame]));
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
      offset += 2;
    }
  }
  return new Blob([array], { type: 'audio/wav' });
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64ToBlob(base64, mimeType = 'audio/wav') {
  return new Blob([base64ToArrayBuffer(base64)], { type: mimeType });
}

async function composeKidsMusic(topic, vocalBuffer = null) {
  const context = new OfflineAudioContext(2, SAMPLE_RATE * DURATION, SAMPLE_RATE);
  const master = context.createGain();
  // Accompaniment stays deliberately soft so every supplied lyric is clear.
  master.gain.value = 0.24;
  master.connect(context.destination);
  const bpm = 112;
  const beat = 60 / bpm;
  const scale = [261.63, 293.66, 329.63, 392, 440, 523.25];
  const seed = seededNumber(topic);

  const tone = (frequency, start, length, volume, type = 'sine') => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, Math.min(DURATION, start + length));
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(Math.min(DURATION, start + length + 0.02));
  };

  for (let step = 0, time = 0; time < DURATION - 0.1; step += 1, time += beat / 2) {
    const note = scale[(step * 2 + (seed % 5) + Math.floor(step / 8)) % scale.length];
    tone(note, time, beat * 0.43, 0.07, step % 4 === 0 ? 'triangle' : 'sine');
    if (step % 2 === 0) tone(note / 2, time, beat * 0.85, 0.03, 'triangle');
    if (step % 8 === 0) {
      tone(130.81, time, beat * 1.8, 0.025, 'sine');
      tone(164.81, time, beat * 1.8, 0.02, 'sine');
      tone(196, time, beat * 1.8, 0.018, 'sine');
    }
    if (step % 4 === 3) tone(900 + ((seed + step) % 300), time, 0.035, 0.005, 'sine');
  }
  if (vocalBuffer) {
    const vocal = context.createBufferSource();
    const vocalGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    vocal.buffer = vocalBuffer;
    // Keep a short musical intro and fit long generated readings inside 30 sec.
    vocal.playbackRate.value = Math.max(1, vocalBuffer.duration / 27.8);
    vocalGain.gain.value = 0.96;
    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 3;
    vocal.connect(vocalGain).connect(compressor).connect(context.destination);
    vocal.start(1.1);
  }
  const rendered = await context.startRendering();
  return encodeWav(rendered);
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export default function RhymeGenerator() {
  const [topic, setTopic] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [lastLyricsSource, setLastLyricsSource] = useState('lyrics');
  const [musicUrl, setMusicUrl] = useState('');
  const [musicBlob, setMusicBlob] = useState(null);
  const [status, setStatus] = useState('Ready to create a 30-second rhyme');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ pct: 0, phase: 'Ready', detail: '', elapsedSeconds: 0 });
  const [bgmLevel, setBgmLevel] = useState(20);
  const [vocalPresence, setVocalPresence] = useState(7);
  const [tempo, setTempo] = useState(112);
  const [clarityAttempts, setClarityAttempts] = useState(3);
  const singerStyle = 'SC3 Hickory voice with traditional rising-and-falling 6/8 arrangement';
  const [durationInput, setDurationInput] = useState('');
  const [musicEngine, setMusicEngine] = useState(() => localStorage.getItem('pattan.rhyme.requestedEngine') === 'lyria' ? 'lyria' : 'ace');
  const [command, setCommand] = useState(() => localStorage.getItem('pattan.rhyme.requestedCommand') || '');
  const [taskMode, setTaskMode] = useState('auto');
  const [narrationAudio, setNarrationAudio] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [shutdownAfterComplete, setShutdownAfterComplete] = useState(true);
  const [shutdownPending, setShutdownPending] = useState(false);
  const [moduleHealth, setModuleHealth] = useState({ loading: true, ok: false, checks: [] });
  const [resumeJob, setResumeJob] = useState(null);
  const resumeCheckedRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const audioRef = useRef(null);
  const safeName = useMemo(() => (topic || 'kids-rhyme').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 45), [topic]);

  useEffect(() => () => { if (musicUrl) URL.revokeObjectURL(musicUrl); }, [musicUrl]);
  useEffect(() => {
    try {
      localStorage.removeItem('pattan.rhyme.requestedEngine');
      localStorage.removeItem('pattan.rhyme.requestedCommand');
    } catch (_) {}
  }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    if (!window.electronAPI?.onRhymeSongProgress) return undefined;
    return window.electronAPI.onRhymeSongProgress(update => {
      setProgress(previous => ({ ...previous, ...update }));
      if (update?.phase) setStatus(update.detail ? `${update.phase} · ${update.detail}` : update.phase);
    });
  }, []);
  const runModuleCheck = async () => {
    setModuleHealth(previous => ({ ...previous, loading: true }));
    try {
      const result = await window.electronAPI?.checkRhymeModule?.();
      if (!result) throw new Error('Electron bridge unavailable');
      setModuleHealth({ loading: false, ok: Boolean(result.ok), checks: result.checks || [] });
    } catch (error) {
      setModuleHealth({ loading: false, ok: false, checks: [{ name: 'Electron bridge', ok: false, detail: error.message }] });
    }
  };
  useEffect(() => { runModuleCheck(); }, []);

  const generateLyrics = async () => {
    setBusy(true); setStatus('Writing simple lyrics for small children…');
    try {
      const prompt = `Write lyrics for an EXACTLY 30-second nursery rhyme about "${topic}". Use 8 very short lines, simple words for ages 3 to 7, positive and educational meaning, repetition, and easy AABB rhymes. Avoid scary ideas, brands, and complex vocabulary. Output lyrics only.`;
      const result = await Flow.generate.text(prompt, {
        systemInstruction: 'You are an expert preschool music teacher and nursery-rhyme songwriter. Keep every result safe, singable, cheerful, and age appropriate.',
        thinkingLevel: 'medium',
      });
      const generated = result.text.trim() || fallbackLyrics(topic);
      setLyrics(generated);
      setStatus('Lyrics ready · edit them if needed');
      return generated;
    } catch (error) {
      const generated = fallbackLyrics(topic);
      setLyrics(generated);
      setStatus('Local fallback lyrics ready');
      return generated;
    } finally { setBusy(false); }
  };

  const previewAdvancedMix = async () => {
    setPreviewBusy(true);
    setStatus(`Preparing the required reference-voice preview · BGM ${bgmLevel}% · vocal presence ${vocalPresence}/10…`);
    try {
      const result = await window.electronAPI?.previewRhymeMix?.({ bgmLevel, vocalPresence, singerStyle, bpm: tempo });
      if (!result?.ok || !result.audioBase64) throw new Error(result?.error || 'Preview service unavailable.');
      const blob = base64ToBlob(result.audioBase64, result.mimeType || 'audio/wav');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setStatus(`Reference-voice preview ready · the full rhyme will use this voice reference and the same mastering controls.`);
      setTimeout(() => {
        const player = document.getElementById('rhyme-mix-preview');
        if (player) {
          player.currentTime = 0;
          player.play().catch(() => {});
        }
      }, 50);
    } catch (error) {
      setStatus(`Preview failed: ${error.message}`);
    } finally { setPreviewBusy(false); }
  };

  const generateMusic = async (songLyrics = lyrics, overrides = {}) => {
    cancelRequestedRef.current = false;
    setBusy(true);
    const targetDuration = Number(overrides.duration);
    if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
      setStatus('State the duration in your command, for example: Generate a 45 second song.');
      return;
    }
    const useLyria = musicEngine === 'lyria';
    setProgress({ pct: 1, phase: useLyria ? 'Starting Google Lyria 3' : 'Starting ACE-Step', detail: useLyria ? 'Preparing secure cloud generation' : 'Preparing local generation', elapsedSeconds: 0 });
    setStatus(useLyria ? 'Google Lyria 3: generating a high-fidelity 44.1 kHz stereo song…' : 'Strict quality mode: Q8 singing, exact supplied lyrics, and mandatory transcription check. CPU generation can take several minutes…');
    try {
      const generator = useLyria ? window.electronAPI?.generateLyriaSong : window.electronAPI?.generateRhymeSong;
      if (generator) {
        const generated = await generator({
          lyrics: songLyrics,
          command,
          title: overrides.title || (lyrics.trim() ? (topic.trim() || songLyrics.split(/\r?\n/)[0]) : songLyrics.split(/\r?\n/)[0]),
          duration: targetDuration,
          clarityAttempts: Math.max(5, overrides.clarityAttempts ?? clarityAttempts),
          bgmLevel: overrides.bgmLevel ?? bgmLevel,
          vocalPresence: overrides.vocalPresence ?? vocalPresence,
          bpm: overrides.bpm ?? tempo,
          qualityMode: 'coordinated-song', model: useLyria ? 'lyria-3-pro-preview' : undefined,
          seed: overrides.seed,
          resumeWorkDir: overrides.resumeWorkDir,
          stylePrompt: overrides.stylePrompt || `premium studio-quality preschool nursery rhyme, match the approved realistic SC3 singer timbre, use rhyme-aware meter and melody instead of a generic loop, cheerful action-song energy, bright child-friendly acoustic instruments, extremely clear English diction, every lyric pronounced distinctly, natural melodic phrasing, lead vocals loud and centered above the accompaniment, no choir, no backing vocals, no robotic effects`,
        });
        if (cancelRequestedRef.current) return;
        if (generated?.ok && generated.audioBase64) {
          const blob = base64ToBlob(generated.audioBase64, generated.mimeType || 'audio/mp3');
          if (musicUrl) URL.revokeObjectURL(musicUrl);
          setMusicBlob(blob);
          const newUrl = URL.createObjectURL(blob);
          setMusicUrl(newUrl);
          const firstLine = (songLyrics.trim().split(/\r?\n/)[0] || 'kids-rhyme').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40);
          const activeFileName = generated.fileName || generated.filename || `${firstLine}-${targetDuration}sec.mp3`;
          const clarityLabel = generated.clarityPassed == null
            ? 'cloud studio master'
            : generated.clarityPassed === true
            ? `clarity passed ${generated.clarityScore}%`
            : `usable performance saved with clarity warning ${generated.clarityScore ?? 0}%`;
          const durationLabel = generated.durationAdjusted
            ? `duration automatically expanded from ${generated.requestedDuration}s to ${generated.duration}s for clear lyrics`
            : `${generated.duration || targetDuration}s`;
          setStatus(`Complete · ${generated.engine || 'ACE-Step'} · ${clarityLabel} · ${durationLabel} · saved as ${activeFileName}`);
          setDurationInput(String(generated.duration || targetDuration));
          setResumeJob(null);

          // On mobile web browser, trigger automatic download of the generated MP3
          if (!window.electronAPI?.showSaveDialog) {
            try {
              const a = document.createElement('a');
              a.href = newUrl;
              a.download = activeFileName;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
            } catch (_) {}
          }

          try {
            window.electronAPI?.showNotification?.('Rhyme Song Complete', `${activeFileName} · ${clarityLabel}`);
            window.speechSynthesis?.cancel();
            window.speechSynthesis?.speak(new SpeechSynthesisUtterance('Complete'));
          } catch (_) {}
          if (shutdownAfterComplete && window.electronAPI?.showSaveDialog && window.electronAPI?.shutdownComputer) {
            const shutdown = await window.electronAPI.shutdownComputer({
              delaySeconds: 60,
              reason: `Rhyme Maker completed and saved ${activeFileName}`,
            });
            if (shutdown?.ok) {
              setShutdownPending(true);
              setStatus(`Complete and safely saved · Windows will shut down in ${shutdown.delaySeconds}s. Use Cancel Shutdown to keep working.`);
            } else {
              setStatus(`Complete and safely saved · automatic shutdown failed: ${shutdown?.error || 'unknown error'}`);
            }
          }
          return;
        }
        throw new Error(generated?.error || (useLyria ? 'Google Lyria 3 returned no song.' : 'ACE-Step Q8 returned no coordinated song.'));
      }
      throw new Error(useLyria ? 'Google Lyria 3 Electron service is unavailable until the next safe app launch.' : 'ACE-Step Q8 Electron service is unavailable.');
    } catch (error) {
      if (cancelRequestedRef.current) return;
      setStatus(`Music generation failed: ${error.message}`);
      setProgress(previous => ({ ...previous, pct: 0, phase: 'Generation failed', detail: error.message }));
      window.electronAPI?.showNotification?.('Rhyme Song Failed', String(error.message || error));
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (resumeCheckedRef.current || !window.electronAPI?.getRhymeResumeJob) return;
    resumeCheckedRef.current = true;
    window.electronAPI.getRhymeResumeJob().then(result => {
      const job = result?.job;
      if (!job?.payload?.lyrics || !job.workDir) return;
      setResumeJob(job);
      setStatus('An interrupted rhyme was found. Choose Resume Previous Generation to continue from its saved checkpoint.');
    }).catch(() => {});
  }, []);

  const stopAll = async () => {
    cancelRequestedRef.current = true;
    try { await window.electronAPI?.cancelRhymeSong?.(); } catch (_) {}
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    const mixPreview = document.getElementById('rhyme-mix-preview');
    if (mixPreview) {
      mixPreview.pause();
      mixPreview.currentTime = 0;
    }
    setBusy(false);
    setPreviewBusy(false);
    setProgress({ pct: 0, phase: 'Stopped', detail: 'Generation cancelled by user', elapsedSeconds: 0 });
    setStatus('Stopped generation and audio playback.');
  };

  const resumePrevious = async () => {
    const job = resumeJob;
    if (!job?.payload?.lyrics || !job.workDir || busy) return;
    const payload = job.payload;
    setLyrics(payload.lyrics);
    setTopic(payload.title || payload.lyrics.split(/\r?\n/)[0] || 'Recovered rhyme');
    setLastLyricsSource('lyrics');
    setDurationInput(String(Number(payload.duration) || ''));
    setStatus(`Resuming from ${job.stage || 'the last completed stage'}…`);
    await generateMusic(payload.lyrics, {
      ...payload,
      title: payload.title,
      duration: Number(payload.duration) || 30,
      resumeWorkDir: job.workDir,
    });
  };

  const cancelShutdown = async () => {
    const result = await window.electronAPI?.cancelComputerShutdown?.();
    if (result?.ok) {
      setShutdownPending(false);
      setStatus('Windows shutdown cancelled. Your completed rhyme remains saved.');
    } else {
      setStatus(`Could not cancel Windows shutdown: ${result?.error || 'shutdown is no longer pending'}`);
    }
  };

  const readRequestedDuration = () => {
    const searchable = `${command} ${durationInput}`;
    const match = searchable.match(/(\d+(?:\.\d+)?)\s*(minutes?|mins?|m|seconds?|secs?|s)\b/i);
    if (match) return Math.round(Number(match[1]) * (/^m/i.test(match[2]) ? 60 : 1));
    const numeric = Number(durationInput);
    return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
  };

  const runNarration = async () => {
    setBusy(true);
    setProgress({ pct: 5, phase: 'Narration', detail: narrationAudio ? 'Reading uploaded audio' : 'Preparing supplied text', elapsedSeconds: 0 });
    try {
      if (narrationAudio) {
        const filePath = window.electronAPI?.getPathForFile?.(narrationAudio);
        if (!filePath) throw new Error('The uploaded audio path is unavailable. Use the Windows desktop app.');
        const result = await window.electronAPI?.sc3NarrateAudio?.({ filePath, outputBaseName: narrationAudio.name.replace(/\.[^.]+$/, '') + '-narration', voice: 'sc3' });
        if (!result?.ok) throw new Error(result?.error || 'Narration conversion failed.');
        setProgress({ pct: 100, phase: 'Narration complete', detail: `Saved ${result.fileName} to Downloads`, elapsedSeconds: 0 });
        setStatus(`Narration only complete · saved ${result.fileName} to Downloads. No song or BGM was generated.`);
        return;
      }
      const narrationText = lyrics.trim() || topic.trim() || command.trim();
      if (!narrationText) throw new Error('Enter narration text or upload an audio file.');
      const result = await window.electronAPI?.narrateSc3Text?.({ text: narrationText, voice: 'sc3' });
      if (!result?.ok || !result.audioBase64) throw new Error(result?.error || 'Narration service returned no audio.');
      const blob = base64ToBlob(result.audioBase64, result.contentType || 'audio/wav');
      if (musicUrl) URL.revokeObjectURL(musicUrl);
      setMusicBlob(blob); setMusicUrl(URL.createObjectURL(blob));
      setProgress({ pct: 100, phase: 'Narration complete', detail: 'Narration preview ready', elapsedSeconds: 0 });
      setStatus('Narration only complete · no song or BGM was generated.');
    } catch (error) {
      setStatus(`Narration failed: ${error.message}`);
    } finally { setBusy(false); }
  };

  const createAll = async () => {
    const exactInput = (lastLyricsSource === 'topic' ? topic.trim() : lyrics.trim()) || lyrics.trim() || topic.trim();
    const requestedMode = taskMode === 'auto'
      ? (/\b(narrat|voice|speak|read)\b/i.test(command) || narrationAudio ? 'narration' : /\b(song|music|rhyme|sing)\b/i.test(command) ? 'song' : '')
      : taskMode;
    if (!requestedMode) { setStatus('Say whether you want narration or a song in the command bar.'); return; }
    if (requestedMode === 'narration') { await runNarration(); return; }
    if (!exactInput) { setStatus('Enter the exact lyrics to perform.'); return; }
    const durationToUse = readRequestedDuration();
    if (!durationToUse) { setStatus('Include the duration in your command, for example: Generate this song for 45 seconds.'); return; }
    if (musicEngine === 'lyria' && durationToUse > 184) { setStatus('Google Lyria 3 Pro currently supports up to 184 seconds per generation. Enter 184 seconds or less.'); return; }
    if (!lyrics.trim()) setLyrics(exactInput);
    await generateMusic(exactInput, { duration: durationToUse });
  };

  const loadLyriaExample = () => {
    setMusicEngine('lyria');
    setTaskMode('song');
    setDurationInput('30');
    setCommand('Generate a warm 30 second children’s song with a short spoken introduction, crystal-clear lead narration and singing, and soft matching background music.');
    setTopic('Little Shining Star');
    setLyrics('[Spoken Intro]\nHello children, let us sing about the little shining star.\n\n[Verse]\nLittle star, shine so bright,\nDancing softly in the night.\nClap your hands, count one, two,\nStars are smiling down at you.');
    setLastLyricsSource('lyrics');
    setBgmLevel(20);
    setVocalPresence(9);
    setTempo(112);
    setStatus('Lyria example loaded. Google paid API access is required before generation.');
  };

  const downloadMusic = async () => {
    if (!musicBlob) return;
    const base64 = await blobToBase64(musicBlob);
    await Flow.download({ base64, mimeType: musicBlob.type || 'audio/mp3', filename: `${safeName || 'kids-rhyme'}-${durationInput || 'custom'}sec-complete.${musicBlob.type?.includes('wav') ? 'wav' : 'mp3'}` });
    setStatus('Complete rhyme song saved to Downloads as 320kbps MP3');
  };

  const downloadLyrics = () => {
    const blob = new Blob([lyrics], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = `${safeName || 'kids-rhyme'}-lyrics.txt`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  return <div className="rg-shell">
    <style>{`
      .rg-shell{height:100%;overflow:auto;background:radial-gradient(circle at 20% 0,#263269 0,#11142a 35%,#080a13 75%);color:#fff;font-family:Inter,system-ui,sans-serif;padding:34px}.rg-wrap{max-width:1180px;margin:auto}.rg-head{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:26px}.rg-title h1{margin:0;font-size:32px}.rg-title p{color:#bac3e8;margin:7px 0 0}.rg-badge{background:#fde68a;color:#3f2c05;padding:10px 16px;border-radius:999px;font-weight:900}.rg-grid{display:grid;grid-template-columns:390px 1fr;gap:22px}.rg-card{background:#12182dde;border:1px solid #ffffff1c;border-radius:22px;padding:22px;box-shadow:0 24px 70px #0006}.rg-label{display:block;color:#aab5df;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.09em;margin:0 0 8px}.rg-input,.rg-lyrics,.rg-select{width:100%;box-sizing:border-box;border:1px solid #ffffff24;border-radius:14px;background:#080b17;color:#fff;padding:14px;font:inherit;outline:none}.rg-input:focus,.rg-lyrics:focus,.rg-select:focus{border-color:#67e8f9}.rg-lyrics{min-height:390px;resize:vertical;line-height:1.8;font-size:17px}.rg-health{margin-bottom:14px;padding:12px;border-radius:13px;background:#08111b;border:1px solid #ffffff18}.rg-health-head{display:flex;justify-content:space-between;align-items:center;font-weight:900;font-size:12px}.rg-health-good{color:#86efac}.rg-health-bad{color:#fca5a5}.rg-health-list{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:9px;font-size:10px;color:#aab5df}.rg-mini{border:1px solid #ffffff24;background:#ffffff0d;color:#fff;border-radius:8px;padding:5px 8px;cursor:pointer}.rg-duration{display:flex;align-items:center;justify-content:space-between;margin:16px 0;background:#1d2544;padding:14px;border-radius:14px}.rg-duration strong{font-size:25px;color:#fde68a}.rg-advanced{margin:0 0 16px;padding:15px;border-radius:16px;background:#0a1023;border:1px solid #67e8f944}.rg-advanced h3{margin:0 0 13px;color:#67e8f9;font-size:15px}.rg-control{margin:12px 0}.rg-control-head{display:flex;justify-content:space-between;color:#cbd5f5;font-size:12px;font-weight:800;margin-bottom:6px}.rg-range{width:100%;accent-color:#22d3ee}.rg-control-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.rg-actions{display:grid;gap:10px}.rg-btn{border:0;border-radius:13px;padding:13px 15px;font-weight:900;cursor:pointer;background:linear-gradient(135deg,#67e8f9,#60a5fa);color:#07111f}.rg-btn.secondary{background:#ffffff12;color:#fff;border:1px solid #ffffff20}.rg-btn.stop-btn{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff}.rg-btn:disabled{opacity:.45;cursor:not-allowed}.rg-status{margin-top:16px;color:#aab5df;font-size:13px;min-height:20px}.rg-progress{margin-top:16px;padding:14px;border-radius:14px;background:#090d1c;border:1px solid #67e8f933}.rg-progress-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;font-weight:900}.rg-spinner{width:16px;height:16px;border:3px solid #ffffff24;border-top-color:#67e8f9;border-radius:50%;display:inline-block;margin-right:8px;vertical-align:-3px;animation:rgspin .8s linear infinite}.rg-track{height:10px;background:#ffffff12;border-radius:999px;overflow:hidden;margin-top:11px}.rg-fill{height:100%;min-width:2px;border-radius:999px;background:linear-gradient(90deg,#22d3ee,#60a5fa,#a78bfa);transition:width .45s ease}.rg-detail{color:#8995bf;font-size:11px;margin-top:8px;line-height:1.4}@keyframes rgspin{to{transform:rotate(360deg)}}.rg-player{margin-top:18px;width:100%}.rg-downloads{display:flex;gap:10px;margin-top:14px}.rg-note{margin-top:18px;padding:13px;border-radius:12px;background:#102e2a;color:#a7f3d0;font-size:12px;line-height:1.5}@media(max-width:850px){.rg-grid{grid-template-columns:1fr;gap:16px}.rg-shell{padding:12px;padding-top:62px}.rg-head{align-items:flex-start;flex-direction:column;gap:10px;margin-bottom:16px}.rg-title h1{font-size:22px}.rg-card{padding:15px;border-radius:16px}.rg-control-grid{grid-template-columns:1fr}.rg-duration{flex-direction:column;align-items:flex-start;gap:10px}.rg-duration select{width:100%!important}.rg-downloads{flex-direction:column}.rg-lyrics{min-height:220px;font-size:15px}.rg-btn{width:100%}}
    `}</style>
    <div className="rg-wrap">
      <div className="rg-head"><div className="rg-title"><h1>🎵 Music & Narration Studio</h1><p>Describe the complete job in one command. Narration stays narration; songs use your exact lyrics.</p></div><div className="rg-badge">COMMAND CONTROLLED</div></div>
      <div className="rg-grid">
        <section className="rg-card">
          <label className="rg-label" htmlFor="rhyme-command">Search / command bar</label>
          <input id="rhyme-command" className="rg-input" value={command} disabled={busy} onChange={event => setCommand(event.target.value)} placeholder="Example: Generate a cheerful 75 second song using my exact lyrics" />
          <div className="rg-control-grid" style={{marginTop:10}}><select className="rg-select" value={taskMode} disabled={busy} onChange={event => setTaskMode(event.target.value)}><option value="auto">Auto detect: narration or song</option><option value="narration">Narration only</option><option value="song">Generate song</option></select><input className="rg-input" type="number" min="1" max={musicEngine === 'lyria' ? 184 : 1800} value={durationInput} disabled={busy || taskMode === 'narration'} onChange={event => setDurationInput(event.target.value)} placeholder="Duration in seconds (required for song)" /></div>
          <label className="rg-label" style={{marginTop:12}} htmlFor="rhyme-narration-audio">Optional narration audio upload</label>
          <input id="rhyme-narration-audio" className="rg-input" type="file" accept="audio/*,video/*" disabled={busy} onChange={event => { const file = event.target.files?.[0] || null; setNarrationAudio(file); if (file) { setTaskMode('narration'); setStatus(`${file.name} selected · narration only mode enabled.`); } }} />
          <div className="rg-note" style={{marginTop:0, marginBottom:14}}><b>🔒 Traditional rhyme-aware reference</b><br/>SC3 voice with the observed Hickory 6/8 melody, rising and falling contour, clock accents, dotted-beat bass, bells, and percussion.</div>
          <div className="rg-health"><div className="rg-health-head"><span className={moduleHealth.ok ? 'rg-health-good' : 'rg-health-bad'}>{moduleHealth.loading ? '● Checking module…' : moduleHealth.ok ? '● Module ready' : '● Module needs attention'}</span><button className="rg-mini" onClick={runModuleCheck} disabled={moduleHealth.loading}>Recheck</button></div>{!moduleHealth.loading && <div className="rg-health-list">{moduleHealth.checks.map(check => <span key={check.name}>{check.ok ? '✓' : '✕'} {check.name}: {check.detail}</span>)}</div>}</div>
          <label className="rg-label" htmlFor="rhyme-topic">Song title, topic, or quick exact-lyrics input</label>
          <textarea id="rhyme-topic" className="rg-input" rows="3" value={topic} disabled={busy} onChange={event => { setTopic(event.target.value); setLyrics(event.target.value); setLastLyricsSource('topic'); }} placeholder="Type here or use the large Exact Lyrics box" />
          <div className="rg-advanced">
            <h3>⚙ Advanced Voice & Music</h3>
            <div className="rg-control"><label className="rg-label">Music generation engine</label><select className="rg-select" value={musicEngine} disabled={busy} onChange={event => setMusicEngine(event.target.value)}><option value="ace">ACE-Step Q8 · Local / Offline</option><option value="lyria">Google Lyria 3 Pro · Cloud 44.1 kHz Stereo</option></select><div className="rg-detail">Lyria Pro follows the duration in your command, up to Google's current 184-second limit, and may use paid Gemini API quota. Your key stays protected in the Windows main process.</div></div>
            <div className="rg-control"><div className="rg-control-head"><span>BGM prominence</span><span>{bgmLevel}%</span></div><input className="rg-range" type="range" min="0" max="100" value={bgmLevel} disabled={busy} onChange={event => setBgmLevel(Number(event.target.value))}/></div>
            <div className="rg-control"><div className="rg-control-head"><span>Vocal presence</span><span>{vocalPresence}/10</span></div><input className="rg-range" type="range" min="0" max="10" value={vocalPresence} disabled={busy} onChange={event => setVocalPresence(Number(event.target.value))}/></div>
            <div className="rg-control"><label className="rg-label">Singer and music profile · locked</label><div className="rg-select">SC3 Voice + Traditional 6/8 Hickory Arrangement</div></div>
            <label className="rg-note" style={{display:'flex', alignItems:'center', gap:10, cursor:'pointer'}}><input type="checkbox" checked={shutdownAfterComplete} disabled={busy || shutdownPending} onChange={event => setShutdownAfterComplete(event.target.checked)}/><span><b>Shut down computer after successful completion</b><br/>Only after the verified MP3 is safely saved · 60-second cancellation period</span></label>
            <div className="rg-control-grid"><div className="rg-control"><div className="rg-control-head"><span>Tempo · full generation</span><span>{tempo} BPM</span></div><input className="rg-range" type="range" min="80" max="125" value={tempo} disabled={busy} onChange={event => setTempo(Number(event.target.value))}/></div><div className="rg-control"><label className="rg-label">Clarity recovery</label><select className="rg-select" value={clarityAttempts} disabled={busy} onChange={event => setClarityAttempts(Number(event.target.value))}><option value="3">Automatic · up to 3 performances</option><option value="4">Extended · up to 4 performances</option><option value="5">Maximum · up to 5 performances</option></select></div></div>
            <button className="rg-btn secondary" disabled={busy || previewBusy} onClick={previewAdvancedMix}>{previewBusy ? 'Preparing Voice Preview…' : '▶ Preview Required Voice + Mix · 8 sec'}</button>
            {previewUrl && <audio id="rhyme-mix-preview" className="rg-player" src={previewUrl} controls preload="auto"/>}
          </div>
          <div className="rg-actions">
            <button className="rg-btn secondary" disabled={busy} onClick={loadLyriaExample}>Load Lyria Narration + BGM Example</button>
            {resumeJob && <button className="rg-btn secondary" disabled={busy} onClick={resumePrevious}>↻ Resume Previous Generation</button>}
            <button className="rg-btn" disabled={busy || (!command.trim() && !lyrics.trim() && !topic.trim() && !narrationAudio)} onClick={createAll}>{busy ? 'Creating…' : '▶ Perform My Command'}</button>
            {(busy || previewBusy || previewUrl || musicUrl) && <button className="rg-btn stop-btn" onClick={stopAll}>🛑 STOP Generation / Audio</button>}
            {shutdownPending && <button className="rg-btn stop-btn" onClick={cancelShutdown}>Cancel Windows Shutdown</button>}
            <button className="rg-btn secondary" disabled={busy || !topic.trim()} onClick={generateLyrics}>AI Write New Lyrics (Optional)</button>
          </div>
          {busy && <div className="rg-progress" role="status" aria-live="polite">
            <div className="rg-progress-head"><span><i className="rg-spinner"/>{progress.phase}</span><button className="rg-mini" style={{ background: '#ef4444', color: '#fff', border: 0, fontWeight: 900, padding: '4px 10px', borderRadius: 8, cursor: 'pointer' }} onClick={stopAll}>🛑 STOP</button></div>
            <div className="rg-track"><div className="rg-fill" style={{ width: `${Math.max(1, progress.pct)}%` }}/></div>
            <div className="rg-detail">{progress.detail || 'Working locally…'} Click STOP to cancel at any time.</div>
          </div>}
          <div className="rg-status">{status}</div>
          {musicUrl && <><audio ref={audioRef} className="rg-player" src={musicUrl} controls preload="metadata"/><div className="rg-downloads"><button className="rg-btn secondary" onClick={downloadMusic}>Download Complete Song MP3</button><button className="rg-btn stop-btn" onClick={stopAll}>🛑 STOP Audio</button></div></>}
          <div className="rg-note">Q8 singer only: robotic Edge-TTS song fallback is permanently disabled. Keep BGM around 10–25% and Vocal Presence around 7–9.</div>
        </section>
        <section className="rg-card">
          <label className="rg-label" htmlFor="rhyme-lyrics">Exact lyrics to perform · required</label>
          <textarea id="rhyme-lyrics" className="rg-lyrics" value={lyrics} onChange={event => { setLyrics(event.target.value); setLastLyricsSource('lyrics'); }} placeholder="Paste only the lyrics you want performed. Every supplied word will be used; no new words will be added." />
          <div className="rg-downloads"><button className="rg-btn secondary" disabled={!lyrics.trim()} onClick={downloadLyrics}>Download Lyrics</button></div>
        </section>
      </div>
    </div>
  </div>;
}
