import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CaptionItem } from './types';
import {
  parseSubtitleFile, serializeSubtitles, inspectCaptionQuality,
  shiftCaptionTiming, scaleCaptionTiming, replaceCaptionText,
  fitLyricsToCaptions, splitCaption, mergeCaptionWithNext,
} from './caption-tools';
import './caption-workbench.css';

type TimingSource = 'word' | 'estimated';
type SubtitleFormat = 'srt' | 'vtt' | 'json';
type Metadata = { timingSource?: TimingSource; warnings?: string[] };
export interface CaptionWorkbenchProps {
  itemId: string;
  videoName: string;
  captions: CaptionItem[];
  duration?: number;
  disabled: boolean;
  timingSource?: TimingSource;
  warnings?: string[];
  onChange: (captions: CaptionItem[], metadata?: Metadata) => void;
  onSeek: (time: number) => void;
  onNotice?: (message: string) => void;
}

export interface CaptionSnapshot extends Metadata { captions: CaptionItem[] }
export interface CaptionHistory {
  past: CaptionSnapshot[];
  present: CaptionSnapshot;
  future: CaptionSnapshot[];
}

function copySnapshot(snapshot: CaptionSnapshot): CaptionSnapshot {
  return {
    captions: snapshot.captions.map(caption => ({
      ...caption,
      words: caption.words?.map(word => ({ ...word })),
    })),
    timingSource: snapshot.timingSource,
    warnings: [...(snapshot.warnings || [])],
  };
}

function fingerprint(snapshot: CaptionSnapshot): string {
  return JSON.stringify([snapshot.captions, snapshot.timingSource, snapshot.warnings || []]);
}

/** Keep undoable copies, including edits made in the main caption list. */
export function recordCaptionHistory(history: CaptionHistory, snapshot: CaptionSnapshot): CaptionHistory {
  if (fingerprint(history.present) === fingerprint(snapshot)) return history;
  return {
    past: [...history.past, copySnapshot(history.present)].slice(-30),
    present: copySnapshot(snapshot),
    future: [],
  };
}

export function travelCaptionHistory(history: CaptionHistory, direction: 'undo' | 'redo'): CaptionHistory {
  if (direction === 'undo') {
    const previous = history.past[history.past.length - 1];
    if (!previous) return history;
    return {
      past: history.past.slice(0, -1),
      present: copySnapshot(previous),
      future: [copySnapshot(history.present), ...history.future].slice(0, 30),
    };
  }
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, copySnapshot(history.present)].slice(-30),
    present: copySnapshot(next),
    future: history.future.slice(1),
  };
}

/** Reject incomplete numbers, invalid bounds and stale/out-of-order karaoke times. */
export function validateCaptionTimingEdit(caption: CaptionItem, duration?: number): CaptionItem {
  if (!Number.isFinite(caption.start) || !Number.isFinite(caption.end)) {
    throw new Error('Enter a valid start and end time.');
  }
  if (caption.start < 0 || caption.end <= caption.start) {
    throw new Error('The caption end must be after its start, and its start cannot be negative.');
  }
  if (Number.isFinite(duration) && Number(duration) > 0 && caption.end > Number(duration)) {
    throw new Error('The caption cannot end after the video.');
  }
  let previousEnd = caption.start;
  caption.words?.forEach((word, index) => {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start) {
      throw new Error(`Word ${index + 1} needs a valid start and an end after its start.`);
    }
    if (word.start < caption.start || word.end > caption.end) {
      throw new Error(`Word ${index + 1} must stay inside this caption's start and end.`);
    }
    if (word.start < previousEnd) {
      throw new Error(`Word ${index + 1} overlaps the previous word. Adjust their times.`);
    }
    previousEnd = word.end;
  });
  return { ...caption, words: caption.words?.map(word => ({ ...word })) };
}

const timeLabel = (value: number) => {
  if (!Number.isFinite(value)) return '—';
  const minutes = Math.floor(Math.max(0, value) / 60);
  return `${minutes}:${(Math.max(0, value) % 60).toFixed(2).padStart(5, '0')}`;
};
const numericInput = (value: string, name: string) => {
  if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(`Enter a valid ${name}.`);
  return Number(value);
};
const dedupe = (values: string[]) => [...new Set(values.filter(Boolean))];

export function CaptionWorkbench({
  itemId, videoName, captions, duration, disabled, timingSource, warnings = [], onChange, onSeek, onNotice,
}: CaptionWorkbenchProps) {
  const snapshot = useMemo(() => copySnapshot({ captions, timingSource, warnings }), [captions, timingSource, warnings]);
  const snapshotKey = fingerprint(snapshot);
  const [history, setHistory] = useState<CaptionHistory>(() => ({ past: [], present: snapshot, future: [] }));
  const historyRef = useRef(history);
  const itemRef = useRef(itemId);
  const expectedKey = useRef<string | null>(null);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState(0);
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [draftWords, setDraftWords] = useState<{ text: string; start: string; end: string }[]>([]);
  const [splitTime, setSplitTime] = useState('');
  const [shift, setShift] = useState('0');
  const [stretch, setStretch] = useState('1');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [lyrics, setLyrics] = useState('');
  const [lyricPreview, setLyricPreview] = useState<(ReturnType<typeof fitLyricsToCaptions> & { baseKey: string }) | null>(null);
  const [pendingImport, setPendingImport] = useState<{ captions: CaptionItem[]; format: SubtitleFormat; name: string } | null>(null);
  const importRequest = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const quality = useMemo(() => inspectCaptionQuality(captions, duration), [captions, duration]);
  const errors = quality.filter(issue => issue.severity === 'error').length;
  const selectedCaption = captions[Math.min(selected, Math.max(0, captions.length - 1))];

  useEffect(() => {
    if (itemRef.current !== itemId) {
      itemRef.current = itemId;
      importRequest.current += 1;
      expectedKey.current = null;
      const reset = { past: [], present: snapshot, future: [] };
      historyRef.current = reset;
      setHistory(reset);
      setSelected(0);
      setLyrics('');
      setLyricPreview(null);
      setPendingImport(null);
      setNotice('');
      setShift('0');
      setStretch('1');
      setFindText('');
      setReplaceText('');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    if (expectedKey.current === snapshotKey) {
      expectedKey.current = null;
      return;
    }
    if (fingerprint(historyRef.current.present) !== snapshotKey) {
      const updated = recordCaptionHistory(historyRef.current, snapshot);
      historyRef.current = updated;
      setHistory(updated);
      expectedKey.current = null;
    }
    // snapshotKey includes captions and timing provenance; object identity alone is not an edit.
  }, [itemId, snapshotKey]);

  useEffect(() => {
    if (selected >= captions.length) setSelected(Math.max(0, captions.length - 1));
    setDraftStart(selectedCaption ? selectedCaption.start.toFixed(3) : '');
    setDraftEnd(selectedCaption ? selectedCaption.end.toFixed(3) : '');
    setDraftWords((selectedCaption?.words || []).map(word => ({
      text: word.text, start: word.start.toFixed(3), end: word.end.toFixed(3),
    })));
    setSplitTime(selectedCaption ? ((selectedCaption.start + selectedCaption.end) / 2).toFixed(3) : '');
  }, [itemId, snapshotKey, selected]);

  const inform = (message: string) => {
    setNotice(message);
    onNotice?.(message);
  };

  const commit = (next: CaptionItem[], metadata: Metadata = { timingSource, warnings }) => {
    const nextSnapshot = copySnapshot({ captions: next, ...metadata });
    // Capture any parent edit made before the synchronization effect has run.
    let latest = historyRef.current;
    if (itemRef.current !== itemId) latest = { past: [], present: snapshot, future: [] };
    else if (expectedKey.current !== snapshotKey) latest = recordCaptionHistory(latest, snapshot);
    const updated = recordCaptionHistory(latest, nextSnapshot);
    const previousExpected = expectedKey.current;
    expectedKey.current = fingerprint(nextSnapshot);
    try {
      onChange(nextSnapshot.captions, { timingSource: nextSnapshot.timingSource, warnings: nextSnapshot.warnings });
    } catch (error) {
      expectedKey.current = previousExpected;
      throw error;
    }
    historyRef.current = updated;
    setHistory(updated);
  };

  const run = (operation: () => void) => {
    if (disabled) return;
    try { operation(); }
    catch (error) { inform(error instanceof Error ? error.message : 'Could not apply this change.'); }
  };

  const travel = (direction: 'undo' | 'redo') => run(() => {
    const updated = travelCaptionHistory(historyRef.current, direction);
    if (updated === historyRef.current) return;
    const previousExpected = expectedKey.current;
    expectedKey.current = fingerprint(updated.present);
    const restored = copySnapshot(updated.present);
    try {
      onChange(restored.captions, { timingSource: restored.timingSource, warnings: restored.warnings });
    } catch (error) {
      expectedKey.current = previousExpected;
      throw error;
    }
    historyRef.current = updated;
    setHistory(updated);
    inform(direction === 'undo' ? 'Caption change undone.' : 'Caption change restored.');
  });

  const importFile = async (file: File | undefined) => {
    if (!file || disabled) return;
    const request = ++importRequest.current;
    const originalItemId = itemId;
    setPendingImport(null);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a subtitle file smaller than 5 MB.');
      const format = file.name.split('.').pop()?.toLowerCase();
      if (format !== 'srt' && format !== 'vtt' && format !== 'json') throw new Error('Choose an SRT, VTT or JSON subtitle file.');
      const parsed = parseSubtitleFile(await file.text(), format);
      if (request !== importRequest.current || itemRef.current !== originalItemId) return;
      const blocking = inspectCaptionQuality(parsed, duration).filter(issue => issue.severity === 'error');
      if (blocking.length) throw new Error(blocking[0].message);
      setPendingImport({ captions: parsed, format, name: file.name });
      inform(`${parsed.length} captions ready to import. Review and click Apply import.`);
    } catch (error) {
      if (request === importRequest.current && itemRef.current === originalItemId) {
        inform(error instanceof Error ? error.message : 'Could not read this subtitle file.');
      }
    }
  };

  const exportFile = (format: SubtitleFormat) => run(() => {
    const text = serializeSubtitles(captions, format);
    const url = URL.createObjectURL(new Blob([text], { type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${videoName.replace(/\.[^/.]+$/, '').replace(/[<>:"/\\|?*]/g, '_') || 'video'} - captions.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    inform(`${format.toUpperCase()} captions exported${format === 'json' ? ' with available word timing.' : '.'}`);
  });

  const saveTiming = () => run(() => {
    if (!selectedCaption) return;
    const edited = validateCaptionTimingEdit({
      ...selectedCaption,
      start: numericInput(draftStart, 'caption start'),
      end: numericInput(draftEnd, 'caption end'),
      words: selectedCaption.words ? draftWords.map((word, index) => ({
        text: word.text,
        start: numericInput(word.start, `start for word ${index + 1}`),
        end: numericInput(word.end, `end for word ${index + 1}`),
      })) : undefined,
    }, duration);
    commit(captions.map((caption, index) => index === selected ? edited : caption));
    inform('Caption and word timing saved.');
  });

  const matchingCaptions = useMemo(() => {
    if (!findText) return 0;
    const needle = caseSensitive ? findText : findText.toLocaleLowerCase();
    return captions.filter(caption => (caseSensitive ? caption.text : caption.text.toLocaleLowerCase()).includes(needle)).length;
  }, [captions, findText, caseSensitive]);

  return (
    <details className="cw-panel">
      <summary className="cw-summary">
        <span>Advanced caption tools</span>
        <span className={`cw-badge ${errors ? 'cw-badge-error' : ''}`}>
          {!captions.length ? 'No captions yet' : quality.length ? `${quality.length} to review` : 'Timing checked'}
        </span>
      </summary>
      <div className="cw-content">
        <div className="cw-row cw-history">
          <button type="button" disabled={disabled || !history.past.length} onClick={() => travel('undo')}>Undo</button>
          <button type="button" disabled={disabled || !history.future.length} onClick={() => travel('redo')}>Redo</button>
          <span className="cw-help">Up to 30 changes</span>
        </div>
        {notice && <p className="cw-notice" role="status" aria-live="polite">{notice}</p>}
        {timingSource === 'estimated' && <p className="cw-caution">Some word times are estimated. Play the video and review the highlights.</p>}
        <details className="cw-section">
          <summary>Import and export subtitles</summary>
          <div className="cw-section-body">
            <label className="cw-label">Import SRT, VTT or JSON
              <input ref={fileInput} aria-label="Import subtitle file" type="file" accept=".srt,.vtt,.json" disabled={disabled}
                onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} />
            </label>
            {pendingImport && <div className="cw-preview">
              <strong>{pendingImport.name}</strong>
              <p>{pendingImport.captions.length} captions · {timeLabel(pendingImport.captions[0]?.start)}–{timeLabel(pendingImport.captions.at(-1)?.end || 0)}</p>
              <p>{pendingImport.captions[0]?.text}</p>
              <div className="cw-row">
                <button type="button" className="cw-primary" disabled={disabled} onClick={() => run(() => {
                  commit(pendingImport.captions, {
                    timingSource: 'estimated',
                    warnings: pendingImport.format === 'json' && pendingImport.captions.some(caption => !!caption.words?.length)
                      ? ['Supplied word times; verify synchronization against the video.']
                      : ['Imported subtitle files supply caption times. Word highlight times need review.'],
                  });
                  setPendingImport(null);
                  inform('Subtitle import applied.');
                })}>Apply import</button>
                <button type="button" onClick={() => setPendingImport(null)}>Cancel</button>
              </div>
            </div>}
            <div className="cw-row">
              {(['srt', 'vtt', 'json'] as const).map(format => <button type="button" key={format} disabled={disabled || !captions.length} onClick={() => exportFile(format)}>{format === 'json' ? 'Save editable draft (JSON)' : `Export ${format.toUpperCase()}`}</button>)}
            </div>
            <p className="cw-help">SRT and VTT keep caption times. JSON also keeps word times.</p>
          </div>
        </details>
        <details className="cw-section">
          <summary>Use exact lyrics</summary>
          <div className="cw-section-body">
            <p className="cw-help">Paste every sung line in order, including each repeated chorus. Review the fit before applying.</p>
            <textarea aria-label="Exact song lyrics" placeholder="Paste the full lyrics here…" value={lyrics} rows={6} disabled={disabled}
              onChange={event => { setLyrics(event.target.value); setLyricPreview(null); }} />
            <button type="button" disabled={disabled || !lyrics.trim() || !captions.length} onClick={() => run(() => {
              const fitted = fitLyricsToCaptions(captions, lyrics, duration);
              setLyricPreview({ ...fitted, baseKey: snapshotKey });
              inform('Lyric fit ready to review.');
            })}>Preview lyric fit</button>
            {!captions.length && <p className="cw-help">Generate or import captions first to supply the timing.</p>}
            {lyricPreview && <div className="cw-preview">
              <p><strong>{lyricPreview.totalWords} lyric words</strong> · {lyricPreview.matchedWords} matched to existing words · {lyricPreview.estimatedWords} estimated times</p>
              <p className="cw-caution">The fit uses the existing timeline. Missing word times are estimated; check them against the song.</p>
              {!!lyricPreview.warnings.length && <ul className="cw-preview-warnings" aria-label="Lyric timing review warnings">
                {lyricPreview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>}
              <div className="cw-preview-lines">{lyricPreview.captions.slice(0, 6).map((caption, index) => <p key={index}><span>{timeLabel(caption.start)}</span> {caption.text}</p>)}</div>
              {lyricPreview.baseKey !== snapshotKey && <p className="cw-caution">Captions changed. Preview the lyric fit again.</p>}
              <button type="button" className="cw-primary" disabled={disabled || lyricPreview.baseKey !== snapshotKey} onClick={() => run(() => {
                commit(lyricPreview.captions, {
                  timingSource: lyricPreview.estimatedWords > 0 ? 'estimated' : timingSource,
                  warnings: dedupe([...warnings, ...lyricPreview.warnings]),
                });
                setLyricPreview(null);
                inform('Exact lyrics applied. Review their timing with the video.');
              })}>Apply exact lyrics</button>
            </div>}
          </div>
        </details>
        <details className="cw-section">
          <summary>Edit caption and word times</summary>
          <div className="cw-section-body">
            <label className="cw-label">Caption
              <select aria-label="Caption to edit timing" value={selected} disabled={disabled || !captions.length} onChange={event => setSelected(Number(event.target.value))}>
                {!captions.length && <option value={0}>No captions yet</option>}
                {captions.map((caption, index) => <option value={index} key={index}>{index + 1}. {timeLabel(caption.start)} — {caption.text.slice(0, 55)}</option>)}
              </select>
            </label>
            {selectedCaption && <>
              <p className="cw-caption-text">{selectedCaption.text}</p>
              <div className="cw-time-grid">
                <label className="cw-label">Start (seconds)<input aria-label="Caption start seconds" type="number" min="0" step="0.01" value={draftStart} disabled={disabled} onChange={event => setDraftStart(event.target.value)} /></label>
                <label className="cw-label">End (seconds)<input aria-label="Caption end seconds" type="number" min="0" step="0.01" value={draftEnd} disabled={disabled} onChange={event => setDraftEnd(event.target.value)} /></label>
              </div>
              {!!draftWords.length && <div className="cw-word-times">
                <div className="cw-word-heading"><span>Word</span><span>Start (s)</span><span>End (s)</span></div>
                {draftWords.map((word, index) => <div className="cw-word-row" key={index}>
                  <button type="button" className="cw-word-text" title="Go to this word" disabled={disabled} onClick={() => onSeek(Number(word.start) || 0)}>{word.text}</button>
                  <input aria-label={`Word ${index + 1} ${word.text} start seconds`} type="number" step="0.01" min="0" value={word.start} disabled={disabled} onChange={event => setDraftWords(current => current.map((entry, i) => i === index ? { ...entry, start: event.target.value } : entry))} />
                  <input aria-label={`Word ${index + 1} ${word.text} end seconds`} type="number" step="0.01" min="0" value={word.end} disabled={disabled} onChange={event => setDraftWords(current => current.map((entry, i) => i === index ? { ...entry, end: event.target.value } : entry))} />
                </div>)}
              </div>}
              <p className="cw-help">Keep words in order and inside the caption times.{!draftWords.length ? ' This caption has no individual word times.' : ''}</p>
              <div className="cw-row">
                <button type="button" className="cw-primary" disabled={disabled} onClick={saveTiming}>Save timing</button>
                <button type="button" disabled={disabled} onClick={() => onSeek(selectedCaption.start)}>Go to caption</button>
              </div>
              <div className="cw-time-grid cw-split-grid">
                <label className="cw-label">Split near (seconds)<input aria-label="Caption split seconds" type="number" step="0.01" min="0" value={splitTime} disabled={disabled} onChange={event => setSplitTime(event.target.value)} /></label>
                <button type="button" disabled={disabled} onClick={() => run(() => {
                  commit(splitCaption(captions, selected, numericInput(splitTime, 'split time')));
                  inform('Caption split at the nearest word boundary.');
                })}>Split caption</button>
              </div>
              <button type="button" disabled={disabled || selected >= captions.length - 1} onClick={() => run(() => {
                commit(mergeCaptionWithNext(captions, selected));
                inform('Caption merged with the next caption.');
              })}>Merge with next</button>
            </>}
          </div>
        </details>
        <details className="cw-section">
          <summary>Fix timing across the video</summary>
          <div className="cw-section-body">
            <label className="cw-label">Shift all captions (seconds)<input aria-label="Shift all captions seconds" type="number" step="0.1" value={shift} disabled={disabled} onChange={event => setShift(event.target.value)} /></label>
            <p className="cw-help">Positive moves captions later. Negative moves them earlier.</p>
            <button type="button" disabled={disabled || !captions.length} onClick={() => run(() => {
              commit(shiftCaptionTiming(captions, numericInput(shift, 'shift amount'), duration));
              inform('Caption and word times shifted.');
            })}>Apply shift</button>
            <label className="cw-label cw-spacing">Stretch timing (×)<input aria-label="Caption timing stretch factor" type="number" min="0.01" step="0.01" value={stretch} disabled={disabled} onChange={event => setStretch(event.target.value)} /></label>
            <p className="cw-help">1 keeps the timing. 1.02 makes it 2% slower; 0.98 makes it 2% faster. Times scale from the video start.</p>
            <button type="button" disabled={disabled || !captions.length} onClick={() => run(() => {
              commit(scaleCaptionTiming(captions, numericInput(stretch, 'stretch factor'), 0, duration));
              inform('Caption and word times stretched.');
            })}>Apply stretch</button>
          </div>
        </details>
        <details className="cw-section">
          <summary>Find and replace text</summary>
          <div className="cw-section-body">
            <label className="cw-label">Find<input aria-label="Find caption text" type="text" value={findText} disabled={disabled} onChange={event => setFindText(event.target.value)} /></label>
            <label className="cw-label">Replace with<input aria-label="Replacement caption text" type="text" value={replaceText} disabled={disabled} onChange={event => setReplaceText(event.target.value)} /></label>
            <label className="cw-check"><input type="checkbox" checked={caseSensitive} disabled={disabled} onChange={event => setCaseSensitive(event.target.checked)} />Match case</label>
            <p className="cw-help">{matchingCaptions} matching captions. If the number of words changes, review word highlights.</p>
            <button type="button" className="cw-primary" disabled={disabled || !findText || !matchingCaptions} onClick={() => run(() => {
              const next = replaceCaptionText(captions, findText, replaceText, caseSensitive);
              const removedWordTimes = next.some((caption, index) => captions[index]?.words?.length && !caption.words?.length);
              commit(next, {
                timingSource: removedWordTimes ? 'estimated' : timingSource,
                warnings: removedWordTimes ? dedupe([...warnings, 'Text replacement changed word counts. Review affected word highlight times.']) : warnings,
              });
              inform(`Text replaced in ${matchingCaptions} captions.`);
            })}>Replace all matches</button>
          </div>
        </details>
        <details className="cw-section">
          <summary>Quality review <span className="cw-small-count">{quality.length + warnings.length}</span></summary>
          <div className="cw-section-body">
            {warnings.map((warning, index) => <p className="cw-caution" key={`warning-${index}`}>{warning}</p>)}
            {!quality.length && <p className="cw-help">No timing or readability issues found. Listen to check the words themselves.</p>}
            {!!quality.length && <div className="cw-issues">{quality.map((issue, index) => <button type="button" key={`${issue.index}-${issue.kind}-${index}`} className={`cw-issue ${issue.severity === 'error' ? 'cw-issue-error' : ''}`} disabled={disabled} onClick={() => {
              setSelected(Math.max(0, issue.index));
              onSeek(Math.max(0, Number.isFinite(issue.start) ? issue.start : 0));
            }}><strong>Caption {issue.index + 1} · {timeLabel(issue.start)}</strong><span>{issue.message}</span></button>)}</div>}
          </div>
        </details>
      </div>
    </details>
  );
}

export default CaptionWorkbench;
