import React from 'react';
import LocalCaptionWorkbench2 from '../../caption/LocalCaptionWorkbench2';
import '../../caption/captioner2-panel.css';

function CaptionSlider({ id, valueId, label, value, min, max, step, defaultValue }) {
  return <label className="lcp-slider" htmlFor={id}>
    <span className="lcp-control-head"><span>{label}</span><output id={valueId}>{value}</output></span>
    <input id={id} type="range" min={min} max={max} step={step} defaultValue={defaultValue} />
  </label>;
}

function CaptionToggle({ id, children, defaultChecked }) {
  return <label className="lcp-toggle" htmlFor={id}>
    <input id={id} type="checkbox" defaultChecked={defaultChecked} /><span>{children}</span>
  </label>;
}

/** IDs stay mounted so the existing caption controller can retain its listeners. */
function LocalCaptionPanel2() {
  return <details className="section-card caption-burner-card" id="cap2_aiCaptionSection" open>
    <summary className="section-summary">
      <span className="summary-head">
        <span className="section-icon">CAP</span>
        <span className="summary-copy">
          <span className="section-title">Captioner 2 — AI Video Captioning (Local + Pro Workbench)</span>
          <span className="section-meta">Generate captions, review the video, then export.</span>
        </span>
      </span>
    </summary>
    <div className="section-content caption-burner-body">
      <div className="lcp-layout">
        <section className="lcp-card lcp-source-card" aria-labelledby="cap2_lcp-source-heading">
          <div className="lcp-card-heading"><span className="lcp-step">1</span><h2 id="cap2_lcp-source-heading">Source &amp; recognition</h2></div>
          <div className="lcp-source-fields">
            <div className="lcp-field lcp-upload">
              <label htmlFor="cap2_captionVideoInput">Source video</label>
              <div
                id="cap2_captionDropZone"
                role="button"
                tabIndex={0}
                aria-label="Drag and drop video files here to add to the caption queue"
                style={{
                  border: '2px dashed rgba(56, 189, 248, 0.45)',
                  borderRadius: '12px',
                  padding: '16px 14px',
                  textAlign: 'center',
                  background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.10), rgba(99, 102, 241, 0.08))',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  marginBottom: '8px',
                }}
              >
                <div style={{ fontSize: '14px', fontWeight: 800, color: '#e0f2fe', marginBottom: '4px' }}>
                  📥 Drag &amp; Drop Video(s) Here — Auto-Queues &amp; Processes
                </div>
                <div style={{ fontSize: '11.5px', color: '#94a3b8', fontWeight: 600 }}>
                  Drop files anytime (even while processing) to append them to the live queue
                </div>
              </div>
              <input id="cap2_captionVideoInput" className="image-input" type="file" accept="video/*" multiple />
              <p className="lcp-help">Drag &amp; drop videos anywhere in Captioner 2, or choose files above to queue and process automatically.</p>
            </div>
            <div className="lcp-recognition-fields">
              <label className="lcp-field" htmlFor="cap2_captionContentMode">Audio content
                <select id="cap2_captionContentMode" className="theme-select" defaultValue="speech"><option value="speech">Speech</option><option value="song">Song / lyrics</option></select>
              </label>
              <label className="lcp-field" htmlFor="cap2_captionEngine">Caption engine
                <select id="cap2_captionEngine" className="theme-select" defaultValue="local"><option value="local">Local (on this computer)</option><option value="groq">Groq API (Fast · online)</option><option value="gemini">Gemini song accuracy (Google)</option></select>
              </label>
              <label className="lcp-field lcp-caption-language" htmlFor="cap2_captionLanguage">Caption language
                <select id="cap2_captionLanguage" className="theme-select" defaultValue="en"><option value="en">English (default)</option><option value="te">తెలుగు (Telugu)</option><option value="hi">हिन्दी (Hindi)</option></select>
                <button id="cap2_captionTranslateSelectedBtn" className="ghost-btn" type="button" disabled>Apply language to current captions</button>
              </label>
              <p id="cap2_captionLanguageDisclosure" className="lcp-help">Speech language is detected automatically. Translation uses the configured local or online providers and keeps cue timing; translated word highlighting is estimated. Telugu and Hindi use a readable script font.</p>
              <p id="cap2_captionLocalModeDisclosure" className="lcp-help">Local processes audio on this computer. Review the words and timing before export.</p>
              <div id="cap2_captionIntelligenceStatus" className="lcp-help" role="status" aria-live="polite">Automatic review checks language, word timing and possible missing speech after generation.</div>
              <CaptionToggle id="cap2_captionAutoRecover" defaultChecked>Automatically recover missed speech</CaptionToggle>
              <p className="lcp-help">Checks uncaptioned audio gaps. Groq makes additional short audio requests; Local checks on this computer. Recovery cannot detect every omission.</p>
              <div id="cap2_captionGroqRecoveryField" className="hidden" style={{ gridColumn: '1 / -1' }}>
                <CaptionToggle id="cap2_captionGroqLocalRecovery" defaultChecked>Use Local if Groq cannot verify captions or reaches its quota</CaptionToggle>
              </div>
              <div id="cap2_captionGroqKeyField" className="lcp-field hidden">
                <label htmlFor="cap2_captionGroqApiKey">Groq API key (optional)</label>
                <input id="cap2_captionGroqApiKey" type="password" maxLength={256} autoComplete="off" placeholder="Leave blank to use the configured key" className="theme-input" />
                <p className="lcp-help">Blank uses the configured key. An entered key is used only in this session.</p>
              </div>
            </div>
          </div>
          <div className="lcp-action-row lcp-generate-actions">
            <button id="cap2_captionActionBtn" className="primary-btn" type="button" disabled>Generate Captions</button>
            <button id="cap2_captionEraseBtn" className="ghost-btn" type="button" aria-describedby="cap2_lcp-eraser-help" disabled>Caption Eraser</button>
            <button id="cap2_captionCancelBtn" className="caption-cancel-btn hidden" type="button">Stop Transcription</button>
            <button id="cap2_captionRegenerateBtn" className="ghost-btn hidden" type="button" disabled>Regenerate captions</button>
            <button id="cap2_captionResetBtn" className="ghost-btn hidden" type="button">Clear Video</button>
          </div>
          <label className="lcp-field lcp-eraser-quality" htmlFor="cap2_captionEraserQuality">Caption eraser quality
            <select id="cap2_captionEraserQuality" className="theme-select" defaultValue="ai"><option value="ai">AI repair (best quality)</option><option value="quick">Quick repair</option></select>
          </label>
          <p id="cap2_lcp-eraser-help" className="lcp-help">Caption Eraser removes captions already burned into the selected video and loads the cleaned video for new captions.</p>
          <p className="lcp-help">AI repair reconstructs the hidden background on this computer. Its first run may download the model; CPU processing can take time. Preview complex scenes before adding new captions.</p>
          <section className="lcp-queue" aria-labelledby="cap2_lcp-queue-heading">
            <h3 id="cap2_lcp-queue-heading">Video queue</h3>
            <p className="lcp-help">Select videos using Choose Files above. Start Queue generates captions and exports the queued videos.</p>
            <div id="cap2_captionQueuePanel" className="hidden">
              <div className="lcp-queue-heading">
                <span id="cap2_captionQueueStatus" className="lcp-help">Queue ready.</span>
                <div className="lcp-action-row">
                  <button id="cap2_captionQueueRunBtn" className="ghost-btn" type="button">Start Queue</button>
                  <button id="cap2_captionQueueExportAllBtn" className="ghost-btn" type="button">Export All</button>
                  <button id="cap2_captionQueuePrevBtn" className="ghost-btn" type="button">Previous</button>
                  <button id="cap2_captionQueueNextBtn" className="ghost-btn" type="button">Next Video</button>
                </div>
              </div>
              <div id="cap2_captionQueueList" />
            </div>
          </section>
          <details className="lcp-disclosure">
            <summary>Recognition options</summary>
            <div className="lcp-disclosure-content">
              <CaptionToggle id="cap2_captionVocalFocus">Reduce background music for songs</CaptionToggle>
              <span hidden><input id="cap2_captionTranslateCheck" type="checkbox" /></span>
              <label className="lcp-field" htmlFor="cap2_captionVocabularyHints">Names or vocabulary
                <textarea id="cap2_captionVocabularyHints" maxLength={1000} rows={2} placeholder="Names, spellings or short phrases heard in the recording" className="theme-input" />
              </label>
              <label className="lcp-field" htmlFor="cap2_captionSpellingCorrections">Saved spelling corrections
                <textarea id="cap2_captionSpellingCorrections" maxLength={2000} rows={3} defaultValue={'Rhea = Ria\nInfo Kids = InfoKids\nInfokids = InfoKids'} className="theme-input" />
              </label>
              <p className="lcp-help">One correction per line: recognized spelling = correct spelling. Applied to new Local and Groq captions. Edit or remove rules for other recordings.</p>
            </div>
          </details>
          <details className="lcp-disclosure">
            <summary>Voice &amp; shortcuts</summary>
            <div className="lcp-disclosure-content">
              <div className="lcp-action-row"><button id="cap2_aiCapSttBtn" className="ghost-btn" type="button">Caption video audio</button><button id="cap2_aiCapTtsBtn" className="ghost-btn" type="button">Read lesson aloud</button></div>
              <span id="cap2_aiCapVoiceStatus" className="lcp-help" role="status" aria-live="polite" />
            </div>
          </details>
          <div id="cap2_captionProgress" className="progress-indicator hidden" role="status" aria-live="polite">
            <p id="cap2_captionStatusText" className="lcp-help">Ready.</p>
            <div className="lcp-progress-track"><div id="cap2_captionProgressBarValue" /></div>
          </div>
        </section>

        <section className="lcp-card lcp-review-card" aria-labelledby="cap2_lcp-review-heading">
          <div className="lcp-card-heading"><span className="lcp-step">2</span><h2 id="cap2_lcp-review-heading">Preview &amp; review</h2></div>
          <div className="lcp-empty-preview"><span>Video preview</span><p>Select a video to begin.</p></div>
          <div id="cap2_captionVideoContainer" className="hidden">
            <canvas id="cap2_captionRenderCanvas" style={{ width: '100%', height: 'auto', display: 'block' }} />
            <div className="toolbar toolbar-compact" id="cap2_captionVideoControls">
              <button id="cap2_captionPlayPauseBtn" className="ghost-btn" type="button">Pause</button>
              <input type="range" id="cap2_captionSeekSlider" min="0" max="100" defaultValue="0" aria-label="Video position" />
              <span id="cap2_captionTimeDisplay">00:00 / 00:00</span>
            </div>
            <video id="cap2_captionSourceVideo" hidden playsInline crossOrigin="anonymous" />
          </div>
          <LocalCaptionWorkbench2 />
          <div id="cap2_captionEditorPanel" style={{ display: 'none' }}>
            <div className="lcp-editor-heading"><h3>Edit captions</h3><p className="lcp-help">Correct a word to update the preview.</p></div>
            <div id="cap2_captionList" />
          </div>
        </section>

        <section className="lcp-card lcp-appearance-card" aria-labelledby="cap2_lcp-appearance-heading">
          <div className="lcp-card-heading"><span className="lcp-step">3</span><h2 id="cap2_lcp-appearance-heading">Appearance</h2></div>
          <div className="lcp-form-grid">
            <label className="lcp-field" htmlFor="cap2_captionStyleSelect">Caption style
              <select id="cap2_captionStyleSelect" className="theme-select text-style-select" defaultValue="white-yellow">
                <option value="white-yellow">White &amp; yellow</option><option value="tiktok">Pop</option><option value="classic">Classic</option><option value="cinematic">Cinematic</option><option value="neon">Neon</option><option value="glitch">Glitch</option><option value="typewriter">Typewriter</option><option value="vaporwave">Vaporwave</option><option value="retro">Retro</option>
              </select>
            </label>
            <label className="lcp-field" htmlFor="cap2_captionFontSelect">Font
              <select id="cap2_captionFontSelect" className="theme-select text-style-select" defaultValue="Nunito, sans-serif">
                <option value="Nunito, sans-serif">Nunito</option><option value="Impact, sans-serif">Impact</option><option value="'Courier New', monospace">Courier New</option><option value="'Comic Sans MS', cursive">Comic Sans</option><option value="Georgia, serif">Georgia</option>
              </select>
            </label>
          </div>
          <CaptionSlider id="cap2_captionSizeSlider" valueId="cap2_captionSizeValue" label="Caption size" value="25% · 50px" min="20" max="140" defaultValue="50" />
          <div className="lcp-color-row"><label htmlFor="cap2_captionColorPicker">Highlight color</label><input type="color" id="cap2_captionColorPicker" defaultValue="#fde047" /></div>
          <div className="lcp-toggle-row"><CaptionToggle id="cap2_captionBoldCheck" defaultChecked>Bold</CaptionToggle><CaptionToggle id="cap2_captionKaraokeCheck" defaultChecked>Highlight spoken words</CaptionToggle></div>
          <button id="cap2_captionSizePreviewBtn" className="ghost-btn" type="button" disabled>Preview caption on video</button>
          <details className="lcp-disclosure lcp-size-sample">
            <summary>Size sample</summary>
            <div className="lcp-disclosure-content">
              <p className="lcp-help">Sample shown at 50% scale. Video preview and export keep the same caption proportions.</p>
              <div className="lcp-size-sample-frame" style={{ zoom: 0.5 }}><span id="cap2_captionSizePreviewText" style={{ fontSize: 50, fontWeight: 900, lineHeight: 1.2, color: '#fff', overflowWrap: 'anywhere' }}>Caption size sample</span></div>
            </div>
          </details>
          <details className="lcp-disclosure">
            <summary>Placement &amp; timing</summary>
            <div className="lcp-disclosure-content">
              <label className="lcp-field" htmlFor="cap2_captionPositionPreset">Position
                <select id="cap2_captionPositionPreset" className="theme-select" defaultValue="bottom"><option value="middle">Middle</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="custom">Custom</option></select>
              </label>
              <CaptionSlider id="cap2_captionPositionX" valueId="cap2_captionPositionXValue" label="Horizontal position" value="50%" min="5" max="95" defaultValue="50" />
              <CaptionSlider id="cap2_captionPositionY" valueId="cap2_captionPositionYValue" label="Vertical position" value="90%" min="5" max="95" defaultValue="90" />
              <CaptionSlider id="cap2_captionSyncSlider" valueId="cap2_captionSyncNum" label="Sync offset" value="50% · 0.0s" min="-15000" max="15000" step="100" defaultValue="0" />
              <div className="lcp-form-grid">
                <CaptionSlider id="cap2_captionWidthSlider" valueId="cap2_captionWidthValue" label="Text width" value="85%" min="30" max="95" defaultValue="85" />
                <CaptionSlider id="cap2_captionGapSlider" valueId="cap2_captionGapValue" label="Line spacing" value="33% · 120" min="80" max="200" defaultValue="120" />
                <CaptionSlider id="cap2_captionStrokeSlider" valueId="cap2_captionStrokeValue" label="Outline thickness" value="0%" min="0" max="100" defaultValue="0" />
                <CaptionSlider id="cap2_captionHeightSlider" valueId="cap2_captionHeightValue" label="Text height" value="100%" min="70" max="140" defaultValue="100" />
              </div>
              <p className="lcp-help">You can also drag captions in the video preview to position them.</p>
            </div>
          </details>
          <details className="lcp-disclosure">
            <summary>Video &amp; audio effects</summary>
            <div className="lcp-disclosure-content">
              <label className="lcp-field" htmlFor="cap2_captionFilterSelect">Video filter
                <select id="cap2_captionFilterSelect" className="theme-select text-style-select" defaultValue="none"><option value="none">None</option><option value="darken">Darken</option><option value="blur">Blur</option><option value="grayscale">Black &amp; white</option><option value="sepia">Sepia</option><option value="invert">Invert colors</option></select>
              </label>
              <CaptionToggle id="cap2_captionEmojiCheck" defaultChecked>Caption emojis</CaptionToggle>
              <CaptionToggle id="cap2_captionBrollCheck">Images matched to words</CaptionToggle>
              <CaptionToggle id="cap2_captionSfxCheck">Sound effects</CaptionToggle>
              <CaptionToggle id="cap2_captionProgressBarCheck">Video progress bar</CaptionToggle>
              <div className="lcp-field">
                <CaptionToggle id="cap2_captionBgMusicCheck" defaultChecked>Background music with audio ducking</CaptionToggle>
                <label htmlFor="cap2_bgMusicInput" className="lcp-help">Music track</label><input type="file" id="cap2_bgMusicInput" accept="audio/*" />
                <audio id="cap2_bgMusicAudio" loop crossOrigin="anonymous" />
              </div>
              <div className="lcp-field">
                <CaptionToggle id="cap2_captionWatermarkCheck" defaultChecked>Watermark overlay</CaptionToggle>
                <label htmlFor="cap2_captionWatermarkInput" className="lcp-help">Watermark image</label><input type="file" id="cap2_captionWatermarkInput" accept="image/png, image/jpeg" />
              </div>
              <div className="lcp-action-row lcp-extra-actions">
                <button id="cap2_captionViralShortBtn" className="ghost-btn hidden" type="button">Export 15s clip</button>
              </div>
            </div>
          </details>
        </section>

        <section className="lcp-card lcp-export-card" aria-labelledby="cap2_lcp-export-heading">
          <div className="lcp-export-heading"><div className="lcp-card-heading"><span className="lcp-step">4</span><h2 id="cap2_lcp-export-heading">Export</h2></div><p className="lcp-help">Review the captions and timing before saving.</p></div>
          <div className="lcp-action-row"><button id="cap2_captionExportBtn" className="primary-btn hidden" type="button">Export Video</button><button id="cap2_captionPreviewBtn" className="ghost-btn hidden" type="button">Preview 5s</button></div>
          <div id="cap2_captionExportActions" className="hidden" />
        </section>
      </div>
    </div>
  </details>;
}

export default function Captioner2({ onClose }) {
  React.useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.bootCaptionStudioV2 === 'function') {
      window.bootCaptionStudioV2();
    }
  }, []);
  return (
    <div className="captioner2-workspace" style={{ maxWidth: '1440px', margin: '0 auto', padding: '16px 20px 80px' }}>
      <LocalCaptionPanel2 />
    </div>
  );
}
