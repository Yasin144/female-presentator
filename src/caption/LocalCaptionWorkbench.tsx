import React, { useEffect, useRef, useState } from 'react';
import CaptionWorkbench from './CaptionWorkbench';
import type { CaptionItem } from './types';
import './local-caption-workbench.css';

interface LocalCaptionState {
  itemId: string;
  videoName: string;
  captions: CaptionItem[];
  duration?: number;
  disabled: boolean;
  timingSource?: 'word' | 'estimated';
  warnings?: string[];
  hasVideo: boolean;
  previewSpeed: number;
  looping: boolean;
}

type CaptionMetadata = { timingSource?: 'word' | 'estimated'; warnings?: string[] };
interface LocalCaptionAPI {
  getState: () => LocalCaptionState;
  applyCaptions: (itemId: string, captions: CaptionItem[], metadata?: CaptionMetadata) => unknown;
  seek: (itemId: string, time: number) => unknown;
  setPreviewSpeed: (speed: number) => unknown;
  toggleCaptionLoop: (itemId: string) => unknown;
  notice: (message: string) => unknown;
}

const EMPTY_STATE: LocalCaptionState = {
  itemId: '', videoName: '', captions: [], disabled: true, hasVideo: false, previewSpeed: 1, looping: false,
};
const getAPI = (): LocalCaptionAPI | undefined =>
  typeof window === 'undefined' ? undefined : (window as any).captionLocalWorkbenchAPI;

function stateCopy(value: LocalCaptionState): LocalCaptionState {
  return {
    ...value,
    itemId: String(value.itemId || ''),
    videoName: String(value.videoName || 'Video'),
    captions: (value.captions || []).map(caption => ({
      ...caption,
      words: caption.words?.map(word => ({ ...word })),
    })),
    warnings: [...(value.warnings || [])],
    disabled: !!value.disabled,
    hasVideo: !!value.hasVideo,
    looping: !!value.looping,
    previewSpeed: Number.isFinite(value.previewSpeed) ? value.previewSpeed : 1,
  };
}

/** Share the advanced editor with the existing AI Video Captioning (Local) controls. */
export default function LocalCaptionWorkbench() {
  const [state, setState] = useState<LocalCaptionState>(EMPTY_STATE);
  const [error, setError] = useState('');
  const currentItem = useRef('');

  useEffect(() => {
    let mounted = true;
    const receiveState = (value: LocalCaptionState | undefined) => {
      if (!mounted || !value) return;
      const next = stateCopy(value);
      if (next.itemId !== currentItem.current) setError('');
      currentItem.current = next.itemId;
      setState(next);
    };
    const listener = (event: Event) => receiveState((event as CustomEvent<LocalCaptionState>).detail);
    // Subscribe first so the legacy controller can announce a late initialization.
    window.addEventListener('caption-local-state', listener);
    try { receiveState(getAPI()?.getState()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not read the caption editor.'); }
    return () => {
      mounted = false;
      window.removeEventListener('caption-local-state', listener);
    };
  }, []);

  const invoke = (operation: (api: LocalCaptionAPI) => unknown, propagate = false) => {
    try {
      const api = getAPI();
      if (!api) throw new Error('The caption editor is still loading. Try again.');
      setError('');
      const result = operation(api);
      if (result === false) {
        throw new Error('The caption editor could not apply this action. It may be busy or the selected video changed.');
      } else if (result && typeof (result as Promise<unknown>).then === 'function') {
        void Promise.resolve(result).catch(caught => setError(caught instanceof Error ? caught.message : 'Could not update the caption editor.'));
      } else if (result && typeof result === 'object' && (result as any).ok === false) {
        throw new Error((result as any).error || 'Could not update the caption editor.');
      }
      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not update the caption editor.';
      setError(message);
      if (propagate) throw new Error(message);
    }
  };

  return (
    <section className="local-caption-workbench" aria-label="Advanced tools for AI Video Captioning Local">
      {error && <p className="lcw-error" role="alert">{error}</p>}
      {!state.hasVideo ? <p className="lcw-prompt">Select a video to use advanced caption tools.</p> : <>
        <div className="lcw-review-controls">
          <label>Review speed
            <select aria-label="Local caption review speed" value={state.previewSpeed} disabled={state.disabled}
              onChange={event => { invoke(api => api.setPreviewSpeed(Number(event.target.value))); }}>
              {[0.5, 0.75, 1, 1.25, 1.5].map(speed => <option key={speed} value={speed}>{speed}×</option>)}
            </select>
          </label>
          <button type="button" disabled={state.disabled || (!state.captions.length && !state.looping)} aria-pressed={state.looping}
            onClick={() => { invoke(api => api.toggleCaptionLoop(state.itemId)); }}>
            {state.looping ? 'Stop caption loop' : 'Loop current caption'}
          </button>
          <span>Review speed and looping do not change the export.</span>
        </div>
        <CaptionWorkbench
          key={state.itemId}
          itemId={state.itemId}
          videoName={state.videoName}
          captions={state.captions}
          duration={state.duration}
          disabled={state.disabled}
          timingSource={state.timingSource}
          warnings={state.warnings}
          onChange={(captions, metadata) => { invoke(api => api.applyCaptions(state.itemId, captions, metadata), true); }}
          onSeek={time => { invoke(api => api.seek(state.itemId, time)); }}
          onNotice={message => { invoke(api => api.notice(message)); }}
        />
      </>}
    </section>
  );
}
