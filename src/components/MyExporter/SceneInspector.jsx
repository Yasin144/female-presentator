import React, { useState } from 'react';
import { HelpHint } from './HelpGuide';

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4];
const COLOR_PRESETS = [
  ['natural', 'Natural'],
  ['vivid', 'Vivid'],
  ['cinematic', 'Cinematic'],
  ['cyberpunk', 'Cyberpunk'],
  ['warm', 'Warm'],
  ['cool', 'Cool'],
  ['mono', 'B&W']
];

export default function SceneInspector({ scene, transform = {}, localTime = 0, duration = 0, disabled, audioLocked = false, detachedAudioTrack = null, onChange, onTrimChange, onDetachAudio, onSelectDetachedAudio, onReattachAudio, onApplyFilter, onAddKeyframe, onDeleteKeyframe, onSeekKeyframe, onHelp }) {
  const [subTab, setSubTab] = useState('all');
  if (!scene) return <div className="mx-inspector-note">Select a clip on the timeline to edit its picture and sound.</div>;
  const keyframes = scene.keyframes || [];
  const isVideo = scene.kind === 'video';
  const hasAudio = scene.hasAudio !== false;
  const sourceDuration = Math.max(.1, number(scene.sourceDuration, number(scene.duration, .1)));
  const trimStart = Math.max(0, number(scene.trimStart));
  const clipDuration = Math.max(.1, number(scene.duration, .1));
  const trimDisabled = disabled || typeof onTrimChange !== 'function';
  const currentSpeed = number(scene.speed, 1);
  const control = (label, field, min, max, step, suffix = '') => <label className="mx-transform-control" key={field}>
    <span>{label}</span><input aria-label={label} type="number" min={min} max={max} step={step} disabled={disabled}
      value={Number(number(transform[field], number(scene[field], field === 'scale' || field === 'opacity' ? 1 : 0)).toFixed(3))}
      onChange={event => { if (event.target.value !== '') onChange(field, Math.max(min, Math.min(max, Number(event.target.value)))); }} /><small>{suffix}</small>
  </label>;
  const showVideo = subTab === 'all' || subTab === 'video';
  const showAudio = subTab === 'all' || subTab === 'audio';
  const showSpeed = subTab === 'all' || subTab === 'speed';
  const showColor = subTab === 'all' || subTab === 'color';
  return <section className="mx-scene-inspector" aria-label="Clip inspector" data-f15-subtab={subTab}>
    <div className="mx-panel-title" title={scene.name}>
      <span>Clip · {scene.name}</span>
      <small className="mx-f15-clip-kind-badge">{isVideo ? 'VIDEO' : 'IMAGE'}</small>
    </div>
    <div className="mx-f15-inspector-subtabs" role="tablist" aria-label="Filmora 15 Clip Property Tabs">
      {[['all', 'All'], ['video', 'Video'], ['audio', 'Audio'], ['color', 'Color'], ['speed', 'Speed']].map(([id, label]) => (
        <span key={id} role="tab" tabIndex={0} aria-selected={subTab === id} className={`mx-f15-subtab ${subTab === id ? 'active' : ''}`} onClick={() => setSubTab(id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSubTab(id); } }}>{label}</span>
      ))}
    </div>
    <div className="mx-clip-basic-fields" hidden={!showVideo && !showAudio}>
      {showVideo && <>
        <div className="mx-help-section-heading"><h3>Picture</h3><HelpHint label="Clip picture" topic="clip-picture" onHelp={onHelp} /></div>
        <label>Fit<select aria-label="Clip framing" value={scene.fit || 'contain'} disabled={disabled} onChange={event => onChange('fit', event.target.value)}><option value="contain">Show full picture</option><option value="fill">Fill canvas</option></select></label>
        <label>Rotation<select aria-label="Clip rotation" value={scene.rotation || 0} disabled={disabled} onChange={event => onChange('rotation', Number(event.target.value))}>{[0, 90, 180, 270].map(value => <option key={value} value={value}>{value}°</option>)}</select></label>
        <div className="mx-inspector-buttons"><button disabled={disabled} className={scene.flipX ? 'active' : ''} onClick={() => onChange('flipX', !scene.flipX)}>Flip horizontal</button><button disabled={disabled} className={scene.flipY ? 'active' : ''} onClick={() => onChange('flipY', !scene.flipY)}>Flip vertical</button></div>
      </>}
      {isVideo && showAudio && <div className="mx-clip-volume">
        <label>Volume · {Math.round(number(scene.volume, 1) * 100)}%<input aria-label="Clip volume" type="range" min="0" max="2" step=".01" value={number(scene.volume, 1)} disabled={disabled || !hasAudio} onChange={event => onChange('volume', Number(event.target.value))} /></label>
        <label className="mx-check"><input type="checkbox" checked={Boolean(scene.muted)} disabled={disabled || !hasAudio} onChange={event => onChange('muted', event.target.checked)} /> Mute source audio</label>
        <div className="mx-filmora-audio-actions">
          {detachedAudioTrack ? <>
            <button type="button" className="mx-detach-audio-btn is-detached" disabled={disabled || audioLocked} onClick={() => onSelectDetachedAudio?.(detachedAudioTrack.id)} title="Select the detached audio track on the timeline to trim, split, or adjust fades">♫ Edit Detached Audio</button>
            {onReattachAudio && <button type="button" className="mx-reattach-audio-btn" disabled={disabled || audioLocked} onClick={() => onReattachAudio(detachedAudioTrack.id)} title="Reattach detached audio back into this video clip">🔗 Reattach</button>}
          </> : (
            <button type="button" className="mx-detach-audio-btn" disabled={disabled || audioLocked || !hasAudio} onClick={() => onDetachAudio?.(scene.id)} title="Filmora 15 Detach Audio (Ctrl+Alt+D) — Extract video sound onto a dedicated Audio track and mute source video">♫ Detach Audio (Ctrl+Alt+D)</button>
          )}
        </div>
      </div>}
    </div>
    <div className="mx-clip-timing-fields" hidden={!showSpeed}>
      <div className="mx-help-section-heading"><h3>Timing & Speed</h3><HelpHint label="Clip timing" topic="clip-timing" onHelp={onHelp} /></div>
      <div className="mx-clip-timing-grid">
        {isVideo && <label>Start (seconds)<input aria-label="Clip trim start" type="number" min="0" max={Math.max(0, sourceDuration - .1)} step=".1" value={Number(trimStart.toFixed(3))} disabled={trimDisabled} onChange={event => {
          if (event.target.value === '' || !Number.isFinite(Number(event.target.value))) return;
          const start = Math.max(0, Math.min(sourceDuration - .1, Number(event.target.value)));
          onTrimChange({ trimStart: start, duration: Math.min(clipDuration, Math.max(.1, sourceDuration - start)) });
        }} /></label>}
        <label>Duration (seconds)<input aria-label="Clip duration" type="number" min=".1" max={isVideo ? Math.max(.1, sourceDuration - trimStart) : undefined} step=".1" value={Number(clipDuration.toFixed(3))} disabled={trimDisabled} onChange={event => {
          if (event.target.value === '' || !Number.isFinite(Number(event.target.value))) return;
          const length = Math.max(.1, Number(event.target.value));
          onTrimChange({ duration: isVideo ? Math.min(length, Math.max(.1, sourceDuration - trimStart)) : length });
        }} /></label>
      </div>
      <label>Playback speed<input aria-label="Playback speed" type="number" min=".25" max="4" step=".05" value={scene.speed || 1} disabled={disabled || !isVideo} onChange={event => { if (event.target.value) onChange('speed', Math.max(.25, Math.min(4, Number(event.target.value)))); }} /></label>
      {isVideo && <div className="mx-f15-speed-chips" aria-label="Uniform speed presets">
        {SPEED_PRESETS.map(preset => (
          <button key={preset} type="button" disabled={disabled} className={`mx-f15-chip ${Math.abs(currentSpeed - preset) < 0.02 ? 'active' : ''}`} onClick={() => onChange('speed', preset)}>{preset}×</button>
        ))}
      </div>}
      <small className="mx-inspector-note">Timeline length {number(duration, clipDuration).toFixed(2)}s</small>
    </div>
    <details className="mx-clip-animation"><summary>Animation{keyframes.length > 0 && <span>{keyframes.length} keyframe{keyframes.length === 1 ? '' : 's'}</span>}</summary>
      <div className="mx-transform-grid">{control('Scale', 'scale', .1, 4, .05, '×')}{control('Horizontal position', 'positionX', -100, 100, 1, '%')}{control('Vertical position', 'positionY', -100, 100, 1, '%')}{control('Opacity', 'opacity', 0, 1, .05)}</div>
      <div className="mx-f15-speed-chips">
        <button type="button" className="mx-f15-chip" disabled={disabled} onClick={() => onChange('scale', 1.25)}>Zoom 1.25×</button>
        <button type="button" className="mx-f15-chip" disabled={disabled} onClick={() => onChange('scale', 1.5)}>Zoom 1.5×</button>
        <button type="button" className="mx-f15-chip" disabled={disabled} onClick={() => { onChange('scale', 1); onChange('positionX', 0); onChange('positionY', 0); onChange('opacity', 1); }}>Reset Transform</button>
      </div>
      <div className="mx-keyframe-heading"><span>{keyframes.length ? 'Transform changes add a keyframe at the playhead.' : 'Add keyframes to animate scale, position and opacity.'}</span><button disabled={disabled} onClick={onAddKeyframe} title="Add transform keyframe at playhead">◇ Add keyframe</button></div>
      <div className="mx-keyframe-list">{keyframes.map((frame, index) => <div key={`${frame.time}-${index}`} className={Math.abs(number(frame.time) - localTime) < .04 ? 'active' : ''}><button disabled={disabled} onClick={() => onSeekKeyframe(number(frame.time))}>◆ {number(frame.time).toFixed(2)}s</button><button disabled={disabled} aria-label={`Delete keyframe ${index + 1}`} onClick={() => onDeleteKeyframe(index)}>×</button></div>)}</div>
      <small className="mx-inspector-note">Playhead {localTime.toFixed(2)}s · clip {duration.toFixed(2)}s</small>
    </details>
    <details open={subTab === 'video'}><summary>Transition</summary>
      <label>Transition<select aria-label="Clip transition" value={scene.transition || 'none'} disabled={disabled} onChange={event => onChange('transition', event.target.value)}><option value="none">Hard cut</option><option value="fade-black">Fade through black</option></select></label>
      {scene.transition === 'fade-black' && <label>Transition length<input aria-label="Transition length" type="number" min=".1" max="1.5" step=".1" value={scene.transitionDuration ?? .4} disabled={disabled} onChange={event => onChange('transitionDuration', Math.max(.1, Math.min(1.5, Number(event.target.value))))} /></label>}
      <div className="mx-f15-speed-chips">
        <button type="button" className={`mx-f15-chip ${(scene.transition || 'none') === 'none' ? 'active' : ''}`} disabled={disabled} onClick={() => onChange('transition', 'none')}>Hard Cut</button>
        {[0.2, 0.4, 0.8, 1.2].map(len => (
          <button key={len} type="button" className={`mx-f15-chip ${scene.transition === 'fade-black' && Math.abs(number(scene.transitionDuration, 0.4) - len) < 0.05 ? 'active' : ''}`} disabled={disabled} onClick={() => { onChange('transition', 'fade-black'); onChange('transitionDuration', len); }}>{len}s Fade</button>
        ))}
      </div>
    </details>
    <details open={subTab === 'color'}><summary>Color correction</summary>
      {onApplyFilter && <div className="mx-f15-speed-chips" aria-label="Filmora LUT presets">
        {COLOR_PRESETS.map(([id, label]) => (
          <button key={id} type="button" className="mx-f15-chip" disabled={disabled} onClick={() => onApplyFilter(id)}>{label}</button>
        ))}
      </div>}
      {[['Brightness', 'brightness', -.5, .5, 0], ['Contrast', 'contrast', 0, 2, 1], ['Saturation', 'saturation', 0, 3, 1]].map(([label, field, min, max, fallback]) => <label key={field}>{label} · {number(scene[field], fallback).toFixed(2)}<input aria-label={label} type="range" min={min} max={max} step=".01" value={number(scene[field], fallback)} disabled={disabled} onChange={event => onChange(field, Number(event.target.value))} /></label>)}
    </details>
    {isVideo && <details open={subTab === 'audio'}><summary>Audio cleanup</summary>
      <label className="mx-check"><input type="checkbox" checked={Boolean(scene.noiseReduction)} disabled={disabled || !hasAudio} onChange={event => onChange('noiseReduction', event.target.checked)} /> Noise cleanup on export</label>
      <label className="mx-check"><input type="checkbox" checked={Boolean(scene.normalizeAudio)} disabled={disabled || !hasAudio} onChange={event => onChange('normalizeAudio', event.target.checked)} /> Loudness normalization on export</label>
    </details>}
  </section>;
}

