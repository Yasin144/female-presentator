import React, { useEffect, useState } from 'react';
import { HelpHint } from './HelpGuide';

export default function AudioRangeEditor({ track, selection, selecting, disabled, previewing, onChange, onSelect, onEdge, onPreview, onStop, onRemove, onRippleRemove, onSplitAtPlayhead, onReattach, onHelp }) {
  const start = Number(track.start), end = start + Number(track.duration);
  const range = selection?.trackId === track.id ? selection : { start, end };
  const [draft, setDraft] = useState({ start: range.start.toFixed(3), end: range.end.toFixed(3) });
  const [dirty, setDirty] = useState({});
  useEffect(() => { setDraft({ start: range.start.toFixed(3), end: range.end.toFixed(3) }); setDirty({}); }, [track.id, range.start, range.end]);
  const valid = selection?.trackId === track.id && !selection.awaitingEnd && selection.end - selection.start >= .001 - 1e-10;
  const commit = edge => {
    if (!dirty[edge]) return;
    // The untouched edge may have sub-millisecond precision from source speed.
    if (draft[edge].trim()) onChange(edge === 'start' ? Number(draft.start) : range.start, edge === 'end' ? Number(draft.end) : range.end);
    setDraft({ start: range.start.toFixed(3), end: range.end.toFixed(3) });
    setDirty({});
  };
  return <section className="mx-audio-range-editor" aria-label="Audio range editor">
    <div className="mx-help-section-heading"><div className="mx-panel-title">Filmora 15 · Cut Waste Voice / Audio Range</div><HelpHint label="Audio range" topic="audioRange" onHelp={onHelp} /></div>
    <div className="mx-f15-waste-guide">
      <strong>2 Ways to Cut Waste Voice (Same Row · Audio 1):</strong>
      <span><b>1. Scissor Split (S):</b> Click waveform at waste START → press <kbd>S</kbd> (or <kbd>✂</kbd>) → click waste END → press <kbd>S</kbd> → press <kbd>Delete</kbd>.</span>
      <span><b>2. Range Highlight:</b> Click <b>Select Audio Range</b> (or <kbd>Shift</kbd>+drag waveform) → click <b>Remove Selected Audio</b>.</span>
    </div>
    <div className="mx-audio-range-mode-btns">
      <button type="button" className={selecting ? 'active' : ''} disabled={disabled} onClick={onSelect}>Select Audio Range</button>
      {onSplitAtPlayhead && <button type="button" className="mx-f15-split-audio-btn" disabled={disabled} onClick={onSplitAtPlayhead} title="Split audio clip at playhead on the same row (S or Ctrl+B)">✂ Split at Playhead (S)</button>}
    </div>
    <div className="mx-audio-range-fields">
      {['start', 'end'].map(edge => <label key={edge}>{edge === 'start' ? 'In' : 'Out'} (timeline seconds)
        <input aria-label={`Audio range ${edge === 'start' ? 'in' : 'out'}`} type="number" min={start} max={end} step=".001" disabled={disabled} value={draft[edge]} onChange={event => { setDraft(current => ({ ...current, [edge]: event.target.value })); setDirty(current => ({ ...current, [edge]: true })); }} onBlur={() => commit(edge)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
        <button type="button" disabled={disabled} onClick={() => onEdge(edge)}>Set {edge === 'start' ? 'In' : 'Out'} at playhead</button>
      </label>)}
    </div>
    <output>{selection?.awaitingEnd ? 'In marked · click Out on the waveform' : valid ? `${(selection.end - selection.start).toFixed(3)} seconds of waste voice selected` : 'Choose the waste voice range to remove'}</output>
    <div className="mx-audio-range-actions">
      <button type="button" disabled={disabled || !valid} onClick={previewing ? onStop : onPreview}>{previewing ? 'Stop Selected Audio' : 'Preview Selected Audio'}</button>
      <button type="button" className="mx-danger" disabled={disabled || !valid} onClick={() => onRemove()}>Remove Selected Audio</button>
      {onRippleRemove && <button type="button" className="mx-f15-ripple-cut-btn" disabled={disabled || !valid} onClick={onRippleRemove} title="Cut selected waste voice and shift remaining audio left to close gap">⏮ Cut & Close Gap</button>}
    </div>
    {(track.originSceneId || track.detachedFromSceneId || track.reattachedToSceneId) && <button type="button" disabled={disabled} onClick={onReattach}>Reattach Audio to Video</button>}
  </section>;
}
