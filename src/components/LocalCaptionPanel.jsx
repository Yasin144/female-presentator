import React from 'react';
import LocalCaptionWorkbench from '../caption/LocalCaptionWorkbench';
import '../caption/local-caption-panel.css';

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
export default function LocalCaptionPanel() {
  return <details className="section-card caption-burner-card" id="aiCaptionSection" open>
    <summary className="section-summary">
      <span className="summary-head">
        <span className="section-icon">CAP</span>
        <span className="summary-copy">
          <span className="section-title">AI Video Captioning (Local)</span>
          <span className="section-meta">Generate captions, review the video, then export.</span>
        </span>
      </span>
    </summary>
    <div className="section-content caption-burner-body">
      <div className="lcp-layout">
        <section className="lcp-card lcp-source-card" aria-labelledby="lcp-source-heading">
          <div className="lcp-card-heading"><span className="lcp-step">1</span><h2 id="lcp-source-heading">Source &amp; recognition</h2></div>
          <div className="lcp-source-fields">
            <div className="lcp-field lcp-upload">
              <label htmlFor="captionVideoInput">Source video</label>
              <input id="captionVideoInput" className="image-input" type="file" accept="video/*" multiple />
              <p className="lcp-help">Choose one video, or hold Ctrl to select several videos for the queue.</p>
            </div>
            <div className="lcp-recognition-fields">
              <label className="lcp-field" htmlFor="captionContentMode">Audio content
                <select id="captionContentMode" className="theme-select" defaultValue="speech"><option value="speech">Speech</option><option value="song">Song / lyrics</option></select>
              </label>
              <label className="lcp-field" htmlFor="captionEngine">Caption engine
                <select id="captionEngine" className="theme-select" defaultValue="local"><option value="local">Local (on this computer)</option><option value="groq">Groq API (Fast · online)</option><option value="gemini">Gemini song accuracy (Google)</option></select>
              </label>
              <label className="lcp-field lcp-caption-language" htmlFor="captionLanguage">Caption language
                <select id="captionLanguage" className="theme-select" defaultValue="en"><option value="en">English (default)</option><option value="te">తెలుగు (Telugu)</option><option value="hi">हिन्दी (Hindi)</option></select>
                <button id="captionTranslateSelectedBtn" className="ghost-btn" type="button" disabled>Apply language to current captions</button>
              </label>
              <p id="captionLanguageDisclosure" className="lcp-help">Speech language is detected automatically. Translation uses the configured local or online providers and keeps cue timing; translated word highlighting is estimated. Telugu and Hindi use a readable script font.</p>
              <p id="captionLocalModeDisclosure" className="lcp-help">Local processes audio on this computer. Review the words and timing before export.</p>
              <div id="captionIntelligenceStatus" className="lcp-help" role="status" aria-live="polite">Automatic review checks language, word timing and possible missing speech after generation.</div>
              <CaptionToggle id="captionAutoRecover" defaultChecked>Automatically recover missed speech</CaptionToggle>
              <p className="lcp-help">Checks uncaptioned audio gaps. Groq makes additional short audio requests; Local checks on this computer. Recovery cannot detect every omission.</p>
              <div id="captionGroqRecoveryField" className="hidden" style={{ gridColumn: '1 / -1' }}>
                <CaptionToggle id="captionGroqLocalRecovery">Use Local if Groq cannot verify captions or reaches its quota</CaptionToggle>
              </div>
              <div id="captionGroqKeyField" className="lcp-field hidden">
                <label htmlFor="captionGroqApiKey">Groq API key (optional)</label>
                <input id="captionGroqApiKey" type="password" maxLength={256} autoComplete="off" placeholder="Leave blank to use the configured key" className="theme-input" />
                <p className="lcp-help">Blank uses the configured key. An entered key is used only in this session.</p>
              </div>
            </div>
          </div>
          <div className="lcp-action-row lcp-generate-actions">
            <button id="captionActionBtn" className="primary-btn" type="button" disabled>Generate Captions</button>
            <button id="captionEraseBtn" className="ghost-btn" type="button" aria-describedby="lcp-eraser-help" disabled>Caption Eraser</button>
            <button id="captionCancelBtn" className="caption-cancel-btn hidden" type="button">Stop Transcription</button>
            <button id="captionRegenerateBtn" className="ghost-btn hidden" type="button" disabled>Regenerate captions</button>
            <button id="captionResetBtn" className="ghost-btn hidden" type="button">Clear Video</button>
          </div>
          <label className="lcp-field lcp-eraser-quality" htmlFor="captionEraserQuality">Caption eraser quality
            <select id="captionEraserQuality" className="theme-select" defaultValue="ai"><option value="ai">AI repair (best quality)</option><option value="quick">Quick repair</option></select>
          </label>
          <p id="lcp-eraser-help" className="lcp-help">Caption Eraser removes captions already burned into the selected video and loads the cleaned video for new captions.</p>
          <p className="lcp-help">AI repair reconstructs the hidden background on this computer. Its first run may download the model; CPU processing can take time. Preview complex scenes before adding new captions.</p>
          <section className="lcp-queue" aria-labelledby="lcp-queue-heading">
            <h3 id="lcp-queue-heading">Video queue</h3>
            <p className="lcp-help">Select videos using Choose Files above. Start Queue generates captions and exports the queued videos.</p>
            <div id="captionQueuePanel" className="hidden">
              <div className="lcp-queue-heading">
                <span id="captionQueueStatus" className="lcp-help">Queue ready.</span>
                <div className="lcp-action-row">
                  <button id="captionQueueRunBtn" className="ghost-btn" type="button">Start Queue</button>
                  <button id="captionQueueExportAllBtn" className="ghost-btn" type="button">Export All</button>
                  <button id="captionQueuePrevBtn" className="ghost-btn" type="button">Previous</button>
                  <button id="captionQueueNextBtn" className="ghost-btn" type="button">Next Video</button>
                </div>
              </div>
              <div id="captionQueueList" />
            </div>
          </section>
          <details className="lcp-disclosure">
            <summary>Recognition options</summary>
            <div className="lcp-disclosure-content">
              <CaptionToggle id="captionVocalFocus">Reduce background music for songs</CaptionToggle>
              <span hidden><input id="captionTranslateCheck" type="checkbox" /></span>
              <label className="lcp-field" htmlFor="captionVocabularyHints">Names or vocabulary
                <textarea id="captionVocabularyHints" maxLength={1000} rows={2} placeholder="Names, spellings or short phrases heard in the recording" className="theme-input" />
              </label>
              <label className="lcp-field" htmlFor="captionSpellingCorrections">Saved spelling corrections
                <textarea id="captionSpellingCorrections" maxLength={2000} rows={3} defaultValue={'Rhea = Ria\nInfo Kids = InfoKids\nInfokids = InfoKids'} className="theme-input" />
              </label>
              <p className="lcp-help">One correction per line: recognized spelling = correct spelling. Applied to new Local and Groq captions. Edit or remove rules for other recordings.</p>
            </div>
          </details>
          <details className="lcp-disclosure">
            <summary>Voice &amp; shortcuts</summary>
            <div className="lcp-disclosure-content">
              <div className="lcp-action-row"><button id="aiCapSttBtn" className="ghost-btn" type="button">Caption video audio</button><button id="aiCapTtsBtn" className="ghost-btn" type="button">Read lesson aloud</button></div>
              <span id="aiCapVoiceStatus" className="lcp-help" role="status" aria-live="polite" />
            </div>
          </details>
          <div id="captionProgress" className="progress-indicator hidden" role="status" aria-live="polite">
            <p id="captionStatusText" className="lcp-help">Ready.</p>
            <div className="lcp-progress-track"><div id="captionProgressBarValue" /></div>
          </div>
        </section>

        <section className="lcp-card lcp-review-card" aria-labelledby="lcp-review-heading">
          <div className="lcp-card-heading"><span className="lcp-step">2</span><h2 id="lcp-review-heading">Preview &amp; review</h2></div>
          <div className="lcp-empty-preview"><span>Video preview</span><p>Select a video to begin.</p></div>
          <div id="captionVideoContainer" className="hidden">
            <canvas id="captionRenderCanvas" style={{ width: '100%', height: 'auto', display: 'block' }} />
            <div className="toolbar toolbar-compact" id="captionVideoControls">
              <button id="captionPlayPauseBtn" className="ghost-btn" type="button">Pause</button>
              <input type="range" id="captionSeekSlider" min="0" max="100" defaultValue="0" aria-label="Video position" />
              <span id="captionTimeDisplay">00:00 / 00:00</span>
            </div>
            <video id="captionSourceVideo" hidden playsInline crossOrigin="anonymous" />
          </div>
          <LocalCaptionWorkbench />
          <div id="captionEditorPanel" style={{ display: 'none' }}>
            <div className="lcp-editor-heading"><h3>Edit captions</h3><p className="lcp-help">Correct a word to update the preview.</p></div>
            <div id="captionList" />
          </div>
        </section>

        <section className="lcp-card lcp-appearance-card" aria-labelledby="lcp-appearance-heading">
          <div className="lcp-card-heading"><span className="lcp-step">3</span><h2 id="lcp-appearance-heading">Appearance</h2></div>
          <div className="lcp-form-grid">
            <label className="lcp-field" htmlFor="captionStyleSelect">Caption style
              <select id="captionStyleSelect" className="theme-select text-style-select" defaultValue="white-yellow">
                <option value="white-yellow">White &amp; yellow</option><option value="tiktok">Pop</option><option value="classic">Classic</option><option value="cinematic">Cinematic</option><option value="neon">Neon</option><option value="glitch">Glitch</option><option value="typewriter">Typewriter</option><option value="vaporwave">Vaporwave</option><option value="retro">Retro</option>
              </select>
            </label>
            <label className="lcp-field" htmlFor="captionFontSelect">Font
              <select id="captionFontSelect" className="theme-select text-style-select" defaultValue="Nunito, sans-serif">
                <option value="Nunito, sans-serif">Nunito</option><option value="Impact, sans-serif">Impact</option><option value="'Courier New', monospace">Courier New</option><option value="'Comic Sans MS', cursive">Comic Sans</option><option value="Georgia, serif">Georgia</option>
              </select>
            </label>
          </div>
          <CaptionSlider id="captionSizeSlider" valueId="captionSizeValue" label="Caption size" value="25% · 50px" min="20" max="140" defaultValue="50" />
          <div className="lcp-color-row"><label htmlFor="captionColorPicker">Highlight color</label><input type="color" id="captionColorPicker" defaultValue="#fde047" /></div>
          <div className="lcp-toggle-row"><CaptionToggle id="captionBoldCheck" defaultChecked>Bold</CaptionToggle><CaptionToggle id="captionKaraokeCheck" defaultChecked>Highlight spoken words</CaptionToggle></div>
          <button id="captionSizePreviewBtn" className="ghost-btn" type="button" disabled>Preview caption on video</button>
          <details className="lcp-disclosure lcp-size-sample">
            <summary>Size sample</summary>
            <div className="lcp-disclosure-content">
              <p className="lcp-help">Sample shown at 50% scale. Video preview and export keep the same caption proportions.</p>
              <div className="lcp-size-sample-frame" style={{ zoom: 0.5 }}><span id="captionSizePreviewText" style={{ fontSize: 50, fontWeight: 900, lineHeight: 1.2, color: '#fff', overflowWrap: 'anywhere' }}>Caption size sample</span></div>
            </div>
          </details>
          <details className="lcp-disclosure">
            <summary>Placement &amp; timing</summary>
            <div className="lcp-disclosure-content">
              <label className="lcp-field" htmlFor="captionPositionPreset">Position
                <select id="captionPositionPreset" className="theme-select" defaultValue="bottom"><option value="middle">Middle</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="custom">Custom</option></select>
              </label>
              <CaptionSlider id="captionPositionX" valueId="captionPositionXValue" label="Horizontal position" value="50%" min="5" max="95" defaultValue="50" />
              <CaptionSlider id="captionPositionY" valueId="captionPositionYValue" label="Vertical position" value="90%" min="5" max="95" defaultValue="90" />
              <CaptionSlider id="captionSyncSlider" valueId="captionSyncNum" label="Sync offset" value="50% · 0.0s" min="-15000" max="15000" step="100" defaultValue="0" />
              <div className="lcp-form-grid">
                <CaptionSlider id="captionWidthSlider" valueId="captionWidthValue" label="Text width" value="85%" min="30" max="95" defaultValue="85" />
                <CaptionSlider id="captionGapSlider" valueId="captionGapValue" label="Line spacing" value="33% · 120" min="80" max="200" defaultValue="120" />
                <CaptionSlider id="captionStrokeSlider" valueId="captionStrokeValue" label="Outline thickness" value="0%" min="0" max="100" defaultValue="0" />
                <CaptionSlider id="captionHeightSlider" valueId="captionHeightValue" label="Text height" value="100%" min="70" max="140" defaultValue="100" />
              </div>
              <p className="lcp-help">You can also drag captions in the video preview to position them.</p>
            </div>
          </details>
          <details className="lcp-disclosure">
            <summary>Video &amp; audio effects</summary>
            <div className="lcp-disclosure-content">
              <label className="lcp-field" htmlFor="captionFilterSelect">Video filter
                <select id="captionFilterSelect" className="theme-select text-style-select" defaultValue="none"><option value="none">None</option><option value="darken">Darken</option><option value="blur">Blur</option><option value="grayscale">Black &amp; white</option><option value="sepia">Sepia</option><option value="invert">Invert colors</option></select>
              </label>
              <CaptionToggle id="captionEmojiCheck" defaultChecked>Caption emojis</CaptionToggle>
              <CaptionToggle id="captionBrollCheck">Images matched to words</CaptionToggle>
              <CaptionToggle id="captionSfxCheck">Sound effects</CaptionToggle>
              <CaptionToggle id="captionProgressBarCheck">Video progress bar</CaptionToggle>
              <div className="lcp-field">
                <CaptionToggle id="captionBgMusicCheck" defaultChecked>Background music with audio ducking</CaptionToggle>
                <label htmlFor="bgMusicInput" className="lcp-help">Music track</label><input type="file" id="bgMusicInput" accept="audio/*" />
                <audio id="bgMusicAudio" loop crossOrigin="anonymous" />
              </div>
              <div className="lcp-field">
                <CaptionToggle id="captionWatermarkCheck" defaultChecked>Watermark overlay</CaptionToggle>
                <label htmlFor="captionWatermarkInput" className="lcp-help">Watermark image</label><input type="file" id="captionWatermarkInput" accept="image/png, image/jpeg" />
              </div>
              <div className="lcp-action-row lcp-extra-actions">
                <button id="captionViralShortBtn" className="ghost-btn hidden" type="button">Export 15s clip</button>
              </div>
            </div>
          </details>
        </section>

        <section className="lcp-card lcp-export-card" aria-labelledby="lcp-export-heading">
          <div className="lcp-export-heading"><div className="lcp-card-heading"><span className="lcp-step">4</span><h2 id="lcp-export-heading">Export</h2></div><p className="lcp-help">Review the captions and timing before saving.</p></div>
          <div className="lcp-action-row"><button id="captionExportBtn" className="primary-btn hidden" type="button">Export Video</button><button id="captionPreviewBtn" className="ghost-btn hidden" type="button">Preview 5s</button></div>
          <div id="captionExportActions" className="hidden" />
        </section>
      </div>
    </div>
  </details>;
}
