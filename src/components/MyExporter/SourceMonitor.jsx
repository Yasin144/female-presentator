import React, { useEffect, useRef, useState } from 'react';
import { HelpHint } from './HelpGuide';

// Paths originate in the local file picker. Remote URLs are deliberately not
// accepted by either source preview or media thumbnails.
export function sourceMediaUrl(value) {
  const path = String(value || '').trim();
  if (!path) return '';
  if (/^(blob:|data:(?:image|audio|video)\/|file:\/\/)/i.test(path)) return path;
  if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return '';
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('//')) return encodeURI(`file:${normalized}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return encodeURI(`file://${normalized.startsWith('/') ? '' : '/'}${normalized}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

export function sourceFrameRate(asset) {
  const value = asset?.frameRate ?? asset?.fps;
  const rate = typeof value === 'string' && value.includes('/')
    ? value.split('/').reduce((numerator, denominator) => Number(numerator) / Number(denominator)) : Number(value);
  return Number.isFinite(rate) && rate > 0 && rate <= 240 ? rate : 30;
}

export function sourceTimecode(seconds, frameRate = 30) {
  const time = Math.max(0, Number(seconds) || 0);
  const whole = Math.floor(time);
  return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60,
    Math.min(Math.ceil(frameRate) - 1, Math.floor((time - whole) * frameRate + 0.00001))]
    .map(value => String(value).padStart(2, '0')).join(':');
}

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const positiveDuration = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;

export default function SourceMonitor({ asset, onInsert, onClose, disabled = false, onHelp }) {
  const media = useRef(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [inPoint, setInPoint] = useState(0);
  const [outPoint, setOutPoint] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const isImage = asset?.kind === 'image';
  const isAudio = asset?.kind === 'audio';
  const url = sourceMediaUrl(asset?.path || asset?.url);
  const fps = sourceFrameRate(asset);
  const step = 1 / fps;

  useEffect(() => {
    const sourceDuration = isImage ? positiveDuration(asset?.duration) || 4
      : positiveDuration(asset?.sourceDuration) || positiveDuration(asset?.duration);
    const start = isImage ? 0 : clamp(Number(asset?.trimStart) || 0, 0, Math.max(0, sourceDuration - step));
    setDuration(sourceDuration);
    setCurrentTime(start);
    setInPoint(start);
    setOutPoint(sourceDuration);
    setPlaying(false);
    setError(url ? '' : 'This source needs a local media file.');
    return () => { media.current?.pause(); };
  }, [asset?.id, asset?.path, asset?.url]);

  useEffect(() => {
    if (disabled) media.current?.pause();
  }, [disabled]);

  if (!asset) return null;
  const seek = time => {
    const next = clamp(Number(time) || 0, 0, duration);
    setCurrentTime(next);
    try { if (media.current) media.current.currentTime = next; } catch (_) {}
  };
  const loaded = event => {
    const length = positiveDuration(event.currentTarget.duration);
    if (!length) { setError('The source duration could not be read. Try importing the file again.'); return; }
    setDuration(length);
    const start = clamp(Number(asset.trimStart) || 0, 0, Math.max(0, length - step));
    setInPoint(start);
    setOutPoint(length);
    setCurrentTime(start);
    try { event.currentTarget.currentTime = start; } catch (_) {}
  };
  const togglePlayback = async () => {
    if (disabled || !media.current || error) return;
    if (!media.current.paused) { media.current.pause(); return; }
    if (currentTime < inPoint || currentTime >= outPoint) seek(inPoint);
    try { await media.current.play(); } catch (_) { setError('The media could not be played. Check that the local file is still available.'); }
  };
  const frameStep = direction => {
    media.current?.pause();
    seek(currentTime + direction * step);
  };
  const setIn = value => setInPoint(clamp(Number(value) || 0, 0, Math.max(0, outPoint - Math.min(step, outPoint))));
  const setOut = value => setOutPoint(clamp(Number(value) || 0, Math.min(duration, inPoint + step), duration));
  const length = Math.max(0, outPoint - inPoint);
  const insertionReady = !disabled && !error && Boolean(url) && (isImage || duration > 0) && length > 0 && typeof onInsert === 'function';
  const mediaProps = {
    ref: media, src: url || undefined, preload: 'metadata', onLoadedMetadata: loaded,
    onTimeUpdate: event => {
      const time = event.currentTarget.currentTime;
      if (!event.currentTarget.paused && time >= outPoint) {
        event.currentTarget.pause();
        try { event.currentTarget.currentTime = outPoint; } catch (_) {}
        setCurrentTime(outPoint);
      } else setCurrentTime(time);
    },
    onPlay: () => setPlaying(true), onPause: () => setPlaying(false), onEnded: () => setPlaying(false),
    onError: () => { setPlaying(false); setError('This file cannot be previewed. Check the file path and media format.'); },
  };

  return <section className="mx-source-monitor" aria-label="Source monitor">
    <header className="mx-source-heading">
      <span><strong>Source</strong><small title={asset.name}>{asset.name || 'Local media'}</small></span>
      <HelpHint label="Source preview" topic="source" onHelp={onHelp} />
      <button type="button" className="mx-source-close" onClick={onClose} aria-label="Close source preview" title="Close source preview">×</button>
    </header>
    <div className={`mx-source-picture${isAudio ? ' is-audio' : ''}`}>
      {url && (isImage ? <img src={url} alt={asset.name || 'Source image'} onError={() => setError('The image could not be opened. Check that the local file is still available.')} />
        : isAudio ? <><span className="mx-source-audio-symbol" aria-hidden="true">♫</span><audio {...mediaProps} /><span>Audio source</span></>
          : <video {...mediaProps} playsInline disablePictureInPicture />)}
      {error && <div className="mx-source-error" role="alert">{error}</div>}
    </div>
    {!isImage && <>
      <div className="mx-source-transport">
        <div><button type="button" onClick={() => frameStep(-1)} disabled={disabled || !duration || Boolean(error)} title="Previous frame" aria-label="Previous source frame">◀|</button>
          <button type="button" className="mx-source-play" onClick={togglePlayback} disabled={disabled || !duration || Boolean(error)} aria-label={playing ? 'Pause source' : 'Play source'}>{playing ? 'Pause' : 'Play'}</button>
          <button type="button" onClick={() => frameStep(1)} disabled={disabled || !duration || Boolean(error)} title="Next frame" aria-label="Next source frame">|▶</button></div>
        <output aria-label="Source timecode">{sourceTimecode(currentTime, fps)}</output>
      </div>
      <div className="mx-source-scrub">
        <span className="mx-source-selection" aria-hidden="true" style={{ left: `${duration ? inPoint / duration * 100 : 0}%`, width: `${duration ? length / duration * 100 : 0}%` }} />
        <input aria-label="Source position" type="range" min="0" max={duration || 1} step={step} value={Math.min(currentTime, duration)} onChange={event => seek(Number(event.target.value))} disabled={disabled || !duration || Boolean(error)} />
      </div>
      <div className="mx-source-marks">
        <label><span>In <button type="button" onClick={() => setIn(currentTime)} disabled={disabled || !duration || Boolean(error)} title="Mark In at current frame">Mark In</button></span>
          <input type="number" aria-label="Source In seconds" min="0" max={Math.max(0, outPoint - step)} step={step} value={Number(inPoint.toFixed(3))} onChange={event => setIn(event.target.value)} disabled={disabled || !duration || Boolean(error)} /></label>
        <label><span>Out <button type="button" onClick={() => setOut(currentTime)} disabled={disabled || !duration || Boolean(error)} title="Mark Out at current frame">Mark Out</button></span>
          <input type="number" aria-label="Source Out seconds" min={Math.min(duration, inPoint + step)} max={duration} step={step} value={Number(outPoint.toFixed(3))} onChange={event => setOut(event.target.value)} disabled={disabled || !duration || Boolean(error)} /></label>
      </div>
    </>}
    {isImage && <label className="mx-source-image-duration">Image duration <span><input type="number" aria-label="Image duration seconds" min="0.1" max="3600" step="0.1" value={outPoint || 4} onChange={event => { const next = clamp(Number(event.target.value) || 0.1, 0.1, 3600); setDuration(next); setOutPoint(next); }} disabled={disabled} /> seconds</span></label>}
    <footer className="mx-source-insert-row"><span>{length.toFixed(2)}s selected{!isImage && ` · ${fps.toFixed(fps % 1 ? 2 : 0)} fps`}</span>
      <button type="button" className="mx-source-insert" disabled={!insertionReady} onClick={() => { media.current?.pause(); onInsert({ ...asset, trimStart: isImage ? 0 : inPoint, duration: length }); }}>Insert to timeline</button></footer>
  </section>;
}
