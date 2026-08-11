import React from "react";
import { useStore } from "../store/useStore";

function InputPanel() {
  const actionLocks = useStore((state) => state.actionLocks);

  return (
    <>
    <section className="panel panel-input" id="inputPanel">
      <div className="panel-head">
        <div className="panel-copy">
          <h1>Presentator Workspace</h1>
          <p className="subcopy">
            A premium, dynamic environment. Type your lesson once. The narration and presentation update
            automatically with a beautiful, organized workflow.
          </p>
        </div>

        <div className="theme-card hero-stage-card">
          <div className="hero-stage-topbar">
            <p className="hero-stage-note">Classroom board style</p>
            <div className="hero-stage-actions">
              <button id="resetInputsBtn" className="primary-btn reset-btn ghost-btn" type="button">Reset</button>
              <select id="subjectSelect" className="theme-select text-style-select" aria-label="Choose subject" style={{ marginRight: "8px" }} defaultValue="maths">
                <option value="maths">Maths</option>
                <option value="english">English</option>
              </select>
              <button id="showScreenBtn" className="primary-btn input-show-screen-btn hero-show-screen-btn"
                type="button">Show Screen</button>
              <label className="theme-toggle theme-toggle-standalone" htmlFor="themeToggle" title="Toggle day and dark theme">
                <input id="themeToggle" className="theme-toggle-input" type="checkbox" aria-label="Toggle dark mode" />
                <span className="theme-toggle-track">
                  <span className="theme-toggle-thumb"></span>
                </span>
              </label>
            </div>
          </div>

          <strong id="themeModeLabel" className="theme-value theme-value-hidden">Day Theme</strong>
          <select id="themeSelect" className="theme-select hidden" aria-label="Choose theme">
            <option value="light">Light Mode</option>
            <option value="dark">Dark Mode</option>
          </select>
        </div>
      </div>

      <section className="workflow-surface" aria-label="Lesson workflow">
        <div className="workflow-story">
          <p className="workflow-eyebrow">Workflow</p>
          <h2 className="workflow-title">Build the lesson once, then open the screen when everything feels ready.</h2>
          <p className="workflow-copy">
            Keep your current working logic safe. This layout simply organizes the flow into a clearer order:
            write the lesson, optionally pick a screen template, add support tools only when needed, then show
            the presentation.
          </p>
        </div>
        <div className="workflow-lane" role="list" aria-label="Workflow steps">
          <button className="workflow-step" type="button" data-workflow-target="lessonContentSection">
            <span className="workflow-step-index">01</span>
            <span className="workflow-step-copy">
              <strong>Lesson Input</strong>
              <span>Write, translate, and style the maths content.</span>
            </span>
          </button>
          <button className="workflow-step" type="button" data-workflow-target="templateWorkflowSection">
            <span className="workflow-step-index">02</span>
            <span className="workflow-step-copy">
              <strong>Template</strong>
              <span>Optional. Keep Classic or switch the stage look.</span>
            </span>
          </button>
          <button className="workflow-step" type="button" data-workflow-target="mediaSection">
            <span className="workflow-step-index">03</span>
            <span className="workflow-step-copy">
              <strong>Media And Voice</strong>
              <span>Add images, stage video, and Anjali narration only if needed.</span>
            </span>
          </button>
          <button className="workflow-step workflow-step-show" type="button" data-workflow-target="showScreenBtn">
            <span className="workflow-step-index">04</span>
            <span className="workflow-step-copy">
              <strong>Show Screen</strong>
              <span>Open the presentation when the lesson is ready to present.</span>
            </span>
          </button>
        </div>
      </section>

      <details className="section-card template-section-card" id="templateWorkflowSection" open>
        <summary className="section-summary">
          <span className="summary-head">
            <span className="section-icon">TPL</span>
            <span className="summary-copy">
              <span className="section-title">Presentation Template</span>
              <span className="section-meta">Optional. The Classic stage stays as the default until you choose another
                template.</span>
            </span>
          </span>
        </summary>
        <div className="section-content">
          <div className="template-section-shell">
            <div className="template-section-copy">
              <p className="upload-copy" id="presentationTemplateStatus">🎨 Click any template card below to instantly switch the presentation screen.</p>
            </div>
            <div className="template-gallery-scroll" role="group" aria-label="Presentation template previews">
              <div className="tpl3d-card" id="templateCardClassic" data-template="classic">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-classic">
                    <span className="template-preview-classic-rings"></span>
                    <span className="template-preview-classic-card"></span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">Classic Stage</span>
                    <button className="tpl3d-select-btn" data-tpl="classic" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCardOutcomes" data-template="learning-outcomes">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-outcomes">
                    <span className="template-preview-outcomes-header">OUTCOMES</span>
                    <span className="template-preview-outcomes-logo">Info kids</span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">Learning Outcomes</span>
                    <button className="tpl3d-select-btn" data-tpl="learning-outcomes" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_sunrise-classroom" data-template="sunrise-classroom">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-sunrise">
                    <span className="tpl-sun"></span>
                    <span className="tpl-hills"></span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">🌅 Sunrise</span>
                    <button className="tpl3d-select-btn" data-tpl="sunrise-classroom" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_galaxy-night" data-template="galaxy-night">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-galaxy">
                    <span className="tpl-planet"></span>
                    <span className="tpl-stars">✦ · ✦ · ✧</span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">🌌 Galaxy</span>
                    <button className="tpl3d-select-btn" data-tpl="galaxy-night" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_tropical-green" data-template="tropical-green">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-tropical">
                    <span className="tpl-tropical-sky"></span>
                    <span className="tpl-palm">🌴</span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">🌴 Tropical</span>
                    <button className="tpl3d-select-btn" data-tpl="tropical-green" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_royal-purple" data-template="royal-purple">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-royal">
                    <span className="tpl-crown">👑</span>
                    <span className="tpl-royal-glow"></span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">👑 Royal</span>
                    <button className="tpl3d-select-btn" data-tpl="royal-purple" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_candy-pink" data-template="candy-pink">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-candy">
                    <span className="tpl-rainbow"></span>
                    <span className="tpl-candy">🍭</span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">🍭 Candy Pop</span>
                    <button className="tpl3d-select-btn" data-tpl="candy-pink" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_neon-cyber" data-template="neon-cyber">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-neon">
                    <span className="tpl-neon-grid"></span>
                    <span className="tpl-neon-sign">⚡</span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">⚡ Neon City</span>
                    <button className="tpl3d-select-btn" data-tpl="neon-cyber" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_golden-hour" data-template="golden-hour">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-golden">
                    <span className="tpl-golden-sun"></span>
                    <span className="tpl-golden-hills"></span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">✨ Golden Hour</span>
                    <button className="tpl3d-select-btn" data-tpl="golden-hour" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_ocean-waves" data-template="ocean-waves">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-ocean">
                    <span className="tpl-wave"></span>
                    <span className="tpl-wave2"></span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">🌊 Ocean</span>
                    <button className="tpl3d-select-btn" data-tpl="ocean-waves" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_winter-snow" data-template="winter-snow">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-winter">
                    <span className="tpl-snowflake">❄</span>
                    <span className="tpl-snowfall"></span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">❄ Winter</span>
                    <button className="tpl3d-select-btn" data-tpl="winter-snow" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_cherry-blossom" data-template="cherry-blossom">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-cherry">
                    <span className="tpl-petal">🌸</span>
                    <span className="tpl-branch"></span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">🌸 Cherry</span>
                    <button className="tpl3d-select-btn" data-tpl="cherry-blossom" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_desert-dunes" data-template="desert-dunes">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-desert">
                    <span className="tpl-desert-sun"></span>
                    <span className="tpl-dune"></span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">🏜 Desert</span>
                    <button className="tpl3d-select-btn" data-tpl="desert-dunes" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_aurora-borealis" data-template="aurora-borealis">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-aurora">
                    <span className="tpl-aurora-band"></span>
                    <span className="tpl-aurora-band2"></span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">🌀 Aurora</span>
                    <button className="tpl3d-select-btn" data-tpl="aurora-borealis" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_lightning-storm" data-template="lightning-storm">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-lightning">
                    <span className="tpl-lightning">⚡</span>
                    <span className="tpl-stormcloud"></span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">⚡ Storm</span>
                    <button className="tpl3d-select-btn" data-tpl="lightning-storm" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_mountain-mist" data-template="mountain-mist">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-mountain">
                    <span className="tpl-peak"></span>
                    <span className="tpl-mist"></span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">🏔 Mountain</span>
                    <button className="tpl3d-select-btn" data-tpl="mountain-mist" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

              <div className="tpl3d-card" id="templateCard_rainbow-garden" data-template="rainbow-garden">
                <div className="tpl3d-inner">
                  <div className="tpl3d-preview tpl3d-preview-rainbow">
                    <span className="tpl-rainbow2"></span>
                    <span className="tpl-flower">🌻</span>
                  </div>
                  <div className="tpl3d-body">
                    <span className="tpl3d-name">🌈 Rainbow</span>
                    <button className="tpl3d-select-btn" data-tpl="rainbow-garden" type="button">✓ Select</button>
                  </div>
                </div>
              </div>

            </div>
            <div className="outcomes-title-row">
              <label className="field-label" htmlFor="outcomesTitleInput">Learning Outcomes Template Title</label>
              <p className="upload-copy">Type a custom title to show at the top of the Learning Outcomes screen. Leave blank
                to use the default <strong>LEARNING OUTCOMES</strong> heading.</p>
              <div className="toolbar toolbar-compact">
                <input id="outcomesTitleInput" className="text-field-input outcomes-title-input" type="text" maxLength="72"
                  placeholder="e.g. LEARNING OUTCOMES" />
                <button id="saveOutcomesTitleBtn" className="primary-btn" type="button">Save Title</button>
              </div>
              <p className="upload-copy" id="outcomesTitleStatus">Switch to Learning Outcomes if you want to save a custom
                title for that template.</p>
            </div>

          </div>
        </div>
      </details>

      <details className="section-card" id="lessonContentSection">
        <summary className="section-summary">
          <span className="summary-head">
            <span className="section-icon">TXT</span>
            <span className="summary-copy">
              <span className="section-title">Maths Lesson Content</span>
              <span className="section-meta">Write the maths text that will appear on the teaching slide.</span>
            </span>
          </span>
        </summary>
        <div className="section-content">
          <div className="tool-card maths-translator-card">
            <div className="tool-card-head">
              <span className="module-icon">TRN</span>
              <p className="tool-card-title">Maths Translator</p>
            </div>
            <p className="upload-copy">Paste normal text here. The app converts it into pure maths notation and sends the
              translated result to the lesson box automatically.</p>
            <label className="field-label" htmlFor="mathsSourceInput">Source Input</label>
            <textarea id="mathsSourceInput" className="lesson-input maths-source-input" placeholder="Example:
what is two plus three
find the product of six and four
ten divided by two
three is less than nine"></textarea>
            <div className="toolbar toolbar-compact">
              <button id="translateMathsBtn" className="primary-btn" type="button">Translate To Pure Maths</button>
              <button id="clearMathsSourceBtn" className="ghost-btn" type="button">Clear Source</button>
            </div>
            <label className="toggle-check" htmlFor="mathsAutoTranslateToggle">
              <input id="mathsAutoTranslateToggle" type="checkbox" defaultChecked />
              <span>Auto translate source into the lesson box</span>
            </label>
            <div id="mathsTranslateProgress" className="progress-indicator maths-translate-progress hidden" role="status"
              aria-live="polite">
              <div className="progress-track">
                <span id="mathsTranslateProgressBar" className="progress-fill maths-translate-progress-fill"></span>
              </div>
              <p id="mathsTranslateProgressLabel" className="upload-copy">Translating into pure maths...</p>
            </div>
            <label className="field-label" htmlFor="mathsTranslationPreview">Pure Maths Translation</label>
            <pre id="mathsTranslationPreview"
              className="maths-translation-preview">Pure maths translation will appear here.</pre>
            <p className="upload-copy" id="mathsTranslatorStatus">Maths translator is ready. Paste plain text and the lesson
              box will receive the translated maths version.</p>
          </div>
          <div className="tool-card english-translator-card">
            <div className="tool-card-head">
              <span className="module-icon" style={{"background": "#5c2d91"}}>LNG</span>
              <p className="tool-card-title">Language & Teacher Translator</p>
            </div>
            <p className="upload-copy">Translate lessons between English, Hindi, and Telugu. Or paste normal English to polish grammar automatically.</p>
            <label className="field-label" htmlFor="englishSourceInput">Source Input (English, Hindi, Telugu)</label>
            <textarea id="englishSourceInput" className="lesson-input english-source-input" placeholder="Example:
hello students today v r gonna learn about nouns.
nouns r naming words like apple or delhi.
plz open ur books!"></textarea>
            <div className="toolbar toolbar-compact" style={{"display": "flex", "flexWrap": "wrap", "gap": "6px"}}>
              <button id="pureEnglishTranslateBtn" className="primary-btn" type="button" style={{"background": "#5c2d91"}}>Polish English</button>
              <button id="translateToEnglishBtn" className="primary-btn" type="button" style={{"background": "#1e3a8a"}}>To English</button>
              <button id="translateToHindiBtn" className="primary-btn" type="button" style={{"background": "#16a34a"}}>To Hindi</button>
              <button id="translateToTeluguBtn" className="primary-btn" type="button" style={{"background": "#ea580c"}}>To Telugu</button>
              <button id="clearEnglishSourceBtn" className="ghost-btn" type="button">Clear</button>
            </div>
            <p className="upload-copy" id="englishTranslatorStatus">Translator is ready. Translate text or polish grammar easily.</p>
          </div>
          <div className="tool-card place-value-card">
            <div className="tool-card-head">
              <span className="module-icon">TAB</span>
              <p className="tool-card-title">Place Value Table Builder</p>
            </div>
            <p className="upload-copy">Enter a number, choose the table layout, and the lesson box will be filled with a
              ready place value chart. Supports up to 10 digits.</p>
            <div className="display-style-grid">
              <label className="style-field" htmlFor="placeValueNumberInput">
                <span className="style-label">Number</span>
                <input id="placeValueNumberInput" className="text-field-input" type="text" inputMode="numeric"
                  maxLength="14" placeholder="Enter a number" />
              </label>
              <label className="style-field" htmlFor="placeValueSystemSelect">
                <span className="style-label">Table Layout</span>
                <select id="placeValueSystemSelect" className="theme-select text-style-select"
                  aria-label="Choose place value table layout">
                  <option value="indian">Indian (lakhs, crores)</option>
                  <option value="international">International (thousands, millions)</option>
                </select>
              </label>
            </div>
            <div className="toolbar toolbar-compact">
              <button id="applyPlaceValueTableBtn" className="primary-btn" type="button">Create Table Layout</button>
              <button id="showPlaceValueTableBtn" className="accent-btn" type="button">Create And Show Screen</button>
            </div>
            <p className="upload-copy" id="placeValueToolStatus">Use this builder when you want to present place value
              charts quickly without typing the full layout by hand.</p>
          </div>
          <div className="tool-card number-table-card">
            <div className="tool-card-head">
              <span className="module-icon">NUM</span>
              <p className="tool-card-title">Number Table Builder</p>
            </div>
            <p className="upload-copy">Enter from and to numbers. Presentator will create the same grid style, display it,
              and read the numbers in order.</p>
            <div className="display-style-grid">
              <label className="style-field" htmlFor="numberTableFromInput">
                <span className="style-label">From</span>
                <input id="numberTableFromInput" className="text-field-input" type="text" inputMode="numeric"
                  maxLength="7" placeholder="101" />
              </label>
              <label className="style-field" htmlFor="numberTableToInput">
                <span className="style-label">To</span>
                <input id="numberTableToInput" className="text-field-input" type="text" inputMode="numeric"
                  maxLength="7" placeholder="200" />
              </label>
            </div>

            {/* ── Number Table Theme Selector ── */}
            <div className="display-style-grid" style={{marginTop:'8px'}}>
              <label className="style-field" htmlFor="numberTableThemeSelect">
                <span className="style-label">Number Theme</span>
                <select id="numberTableThemeSelect" className="theme-select text-style-select"
                  aria-label="Choose number table visual theme" defaultValue="normal">
                  <option value="normal">📋 Normal</option>
                  <option value="classic">🟥 Classic (Red Grid)</option>
                  <option value="ocean">🌊 Ocean Blue</option>
                  <option value="forest">🌿 Forest Green</option>
                  <option value="candy">🍭 Candy Pink</option>
                  <option value="gold">✨ Golden Hour</option>
                  <option value="night">🌌 Night Purple</option>
                  <option value="neon">⚡ Neon Cyan</option>
                  <option value="chalk">🖊 Chalk Board</option>
                  <option value="fire">🔥 Fire Orange</option>
                  <option value="royal">👑 Royal Violet</option>
                </select>
              </label>
            </div>

            {/* ── Intro Enable/Disable for Number Table ── */}
            <label className="toggle-check" htmlFor="numberTableIntroEnabled" style={{marginTop:'8px'}}>
              <input id="numberTableIntroEnabled" type="checkbox" defaultChecked />
              <span>🎬 Play Intro Clip Before Number Table</span>
            </label>
            <p className="upload-copy" style={{fontSize:'0.75rem', marginTop:'2px'}} id="numberTableIntroStatus">
              Intro will play before the number grid presentation when enabled.
            </p>

            <div className="toolbar toolbar-compact" style={{marginTop:'8px'}}>
              <button id="applyNumberTableBtn" className="primary-btn" type="button">Create Table</button>
              <button id="showNumberTableBtn" className="accent-btn" type="button">Display</button>
              <button id="readNumberTableBtn" className="primary-btn" type="button">Display &amp; Read</button>
            </div>
            <p className="upload-copy" id="numberTableToolStatus">Use this for number grids like 101 to 200.</p>
          </div>
          <div className="input-module-head" style={{"display": "flex", "justifyContent": "space-between", "alignItems": "center"}}>
            <label className="field-label maths-label" htmlFor="lessonInput">Translated Maths Lesson</label>
            <label className="field-label english-label" htmlFor="lessonInput">English Lesson Content</label>
          </div>
          <textarea id="lessonInput" className="lesson-input" placeholder="Type or paste your lesson here"></textarea>
          <div id="lineBreakCard" className="display-style-card">
            <p className="field-label">Screen Line Breaks</p>
            <p className="upload-copy">Choose how the Voice Presentator screen should split the lesson text into lines.</p>
            <div className="display-style-grid">
              <label className="style-field" htmlFor="lineBreakModeSelect">
                <span className="style-label">Mode</span>
                <select id="lineBreakModeSelect" className="theme-select text-style-select" aria-label="Choose line break mode" defaultValue="sentences">
                  <option value="sentences">Sentences</option>
                  <option value="words">Para</option>
                </select>
              </label>
              <label className="style-field" htmlFor="lineBreakWordCountInput">
                <span className="style-label">Words Per Line</span>
                <input id="lineBreakWordCountInput" className="text-field-input" type="number" min="2" max="40" step="1" defaultValue="10" />
              </label>
            </div>
            <p className="upload-copy" id="lineBreakStatus">Sentences mode starts a new line after each sentence. Para mode starts a new line after the selected word count.</p>
          </div>
          {/* ── FEATURE ROW: Duration + Highlight + Draft + Shortcuts ── */}
          <div className="lesson-meta-bar" id="lessonMetaBar">
            <span className="lesson-duration-badge" id="lessonDurationBadge" title="Estimated video length based on Anjali speaking rate">
              <span style={{fontSize:"0.75rem", opacity:0.6}}>&#9203;</span>
              <span id="lessonDurationText">&#8212; min</span>
            </span>
            <span className="lesson-word-count" id="lessonWordCountBadge" title="Word count">
              <span id="lessonWordCountText">0 words</span>
            </span>
            <button id="autoHighlightMathBtn" className="ghost-btn lesson-meta-btn" type="button"
              title="Auto-highlight numbers and maths keywords in accent colour">
              &#10024; Auto-Highlight
            </button>
            <span className="lesson-draft-indicator" id="lessonDraftIndicator">
            </span>
            <button id="shortcutsHintBtn" className="ghost-btn lesson-meta-btn" type="button"
              title="View keyboard shortcuts">
              &#9000; Shortcuts
            </button>
          </div>
          {/* ── KEYBOARD SHORTCUTS OVERLAY ─────────────────────────── */}
          <div id="shortcutsOverlay" className="shortcuts-overlay" style={{display:"none"}}>
            <div className="shortcuts-card">
              <div className="shortcuts-header">
                <strong>&#9000; Keyboard Shortcuts</strong>
                <button id="shortcutsCloseBtn" className="ghost-btn" type="button" style={{padding:"2px 8px",minHeight:"28px"}}>&#10005;</button>
              </div>
              <div className="shortcuts-grid">
                <kbd>Ctrl + Enter</kbd><span>Show Screen</span>
                <kbd>Ctrl + E</kbd><span>Export Video</span>
                <kbd>Ctrl + P</kbd><span>Play Narration</span>
                <kbd>Ctrl + S</kbd><span>Save Draft Now</span>
                <kbd>Ctrl + Z</kbd><span>Restore Last Draft</span>
                <kbd>Escape</kbd><span>Back to Input</span>
                <kbd>Ctrl + &#8593;</kbd><span>Previous Slide</span>
                <kbd>Ctrl + &#8595;</kbd><span>Next Slide</span>
              </div>
            </div>
          </div>
          <div id="pureInputCard" className="display-style-card pure-input-card">
            <div className="pure-input-head">
              <div>
                <p className="field-label">Pure Input</p>
                <p className="pure-input-copy">Use this when you want the screen to show the exact text you type or paste, without auto-formatting.</p>
              </div>
              <label className="toggle-check pure-input-toggle" htmlFor="pureInputToggle">
                <input id="pureInputToggle" type="checkbox" />
                <span>Use Pure Input</span>
              </label>
            </div>
            <textarea
              id="pureInputSource"
              className="lesson-input pure-input-source"
              placeholder="Type or paste raw text here. The screen will show the same text without style changes or auto-formatting."
              disabled
            ></textarea>
            <p className="pure-input-note" id="pureInputStatus">Turn on Pure Input to mirror this text on the screen exactly as entered.</p>
          </div>
          <div id="displayStyleCard" className="display-style-card">
            <p className="field-label">Display Text Style</p>
            <p className="upload-copy">Choose how the lesson text should look on the blue screen before you open it.</p>
            <div className="display-style-grid">
              <label className="style-field" htmlFor="textColorSelect">
                <span className="style-label">Text Color</span>
                <select id="textColorSelect" className="theme-select text-style-select" aria-label="Choose text color" defaultValue="#ffffff">
                  <option value="#ffffff">White</option>
                  <option value="#000000">Black</option>
                  <option value="#173e58">Deep Blue</option>
                  <option value="#10243a">Dark Navy</option>
                  <option value="#0d7ea9">Sky Blue</option>
                  <option value="#2563eb">Blue</option>
                  <option value="#1f5a24">Green</option>
                  <option value="#16a34a">Bright Green</option>
                  <option value="#dc2626">Red</option>
                  <option value="#facc15">Yellow</option>
                  <option value="#7a1f1f">Maroon</option>
                </select>
              </label>
              <div className="style-actions" aria-label="Text style options">
                <button id="boldToggleBtn" className="ghost-btn toggle-btn" type="button" aria-pressed="false">Bold</button>
                <button id="italicToggleBtn" className="ghost-btn toggle-btn" type="button"
                  aria-pressed="false">Italic</button>
                <button id="underlineToggleBtn" className="ghost-btn toggle-btn" type="button"
                  aria-pressed="false">Underline</button>
              </div>
            </div>
            <div className="style-actions case-actions" aria-label="Text case options">
              <button id="caseOriginalBtn" className="ghost-btn toggle-btn" type="button" aria-pressed="true">AA</button>
              <button id="caseLowerBtn" className="ghost-btn toggle-btn" type="button" aria-pressed="false">tt</button>
              <button id="caseTitleBtn" className="ghost-btn toggle-btn" type="button" aria-pressed="false">Tt</button>
              <button id="caseUpperBtn" className="ghost-btn toggle-btn" type="button" aria-pressed="false">TT</button>
            </div>
            <p className="upload-copy">Tip: if selecting text is difficult, start a line with `#` to show that line as a
              bold underlined heading.</p>
          </div>
          <div id="selectionStyleCard" className="display-style-card">
            <p className="field-label">Selected Text Style</p>
            <p className="upload-copy">Selected words: <strong id="selectedKeywordLabel">None</strong></p>
            <div className="display-style-grid">
              <label className="style-field" htmlFor="selectedTextColorSelect">
                <span className="style-label">Selected Text Color</span>
                <select id="selectedTextColorSelect" className="theme-select text-style-select"
                  aria-label="Choose selected text color" defaultValue="#ffffff">
                  <option value="#ffffff">White</option>
                  <option value="#000000">Black</option>
                  <option value="#173e58">Deep Blue</option>
                  <option value="#10243a">Dark Navy</option>
                  <option value="#0d7ea9">Sky Blue</option>
                  <option value="#2563eb">Blue</option>
                  <option value="#1f5a24">Green</option>
                  <option value="#16a34a">Bright Green</option>
                  <option value="#dc2626">Red</option>
                  <option value="#facc15">Yellow</option>
                  <option value="#7a1f1f">Maroon</option>
                </select>
              </label>
              <div className="style-actions" aria-label="Selected text style options">
                <button id="selectedBoldToggleBtn" className="ghost-btn toggle-btn" type="button"
                  aria-pressed="false">Bold</button>
                <button id="selectedItalicToggleBtn" className="ghost-btn toggle-btn" type="button"
                  aria-pressed="false">Italic</button>
                <button id="selectedUnderlineToggleBtn" className="ghost-btn toggle-btn" type="button"
                  aria-pressed="false">Underline</button>
              </div>
            </div>
            <div className="toolbar toolbar-compact">
              <button id="applySelectedStyleBtn" className="primary-btn" type="button">Apply To Selected Text</button>
              <button id="clearSelectedStyleBtn" className="ghost-btn" type="button">Clear Selected Style</button>
            </div>
            <p className="upload-copy" id="selectionStyleStatus">Select a word or phrase in the lesson text to give it its
              own look on the slide.</p>
          </div>

          {/* ── ALIGNMENT & CONTEXT STYLE MODEL CARD ──────────────────── */}
          <div id="alignmentModelCard" className="display-style-card alignment-model-card">
            <div className="alignment-model-header">
              <span className="module-icon" style={{background:"#6d28d9"}}>ALN</span>
              <div>
                <p className="field-label" style={{margin:0}}>Alignment &amp; Context Style</p>
                <p className="upload-copy" style={{margin:0}}>Pick a model below — it applies alignment, spacing, and color to the whole slide instantly.</p>
              </div>
            </div>

            {/* ── Text Alignment Row ─────────────────────────────────── */}
            <p className="field-label" style={{marginTop:"12px",marginBottom:"6px"}}>Text Alignment</p>
            <div className="alignment-btn-row" role="group" aria-label="Text alignment">
              <button id="alignLeftBtn" className="align-btn align-btn-active" type="button" aria-pressed="true" title="Left align">
                <span className="align-icon">&#9776;</span>
                <span>Left</span>
              </button>
              <button id="alignCenterBtn" className="align-btn" type="button" aria-pressed="false" title="Center align">
                <span className="align-icon">&#9776;</span>
                <span>Center</span>
              </button>
              <button id="alignRightBtn" className="align-btn" type="button" aria-pressed="false" title="Right align">
                <span className="align-icon">&#9776;</span>
                <span>Right</span>
              </button>
            </div>

            {/* ── Context Style Models ───────────────────────────────── */}
            <p className="field-label" style={{marginTop:"14px",marginBottom:"8px"}}>Context Style Models</p>
            <p className="upload-copy" style={{marginBottom:"10px"}}>Tap a model card to select it — a ✓ appears and your text is converted to that style instantly.</p>
            <div className="context-model-grid" role="group" aria-label="Context style models">

              <button id="modelClassicBtn" className="context-model-card context-model-active" type="button" data-model="classic">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-classic">Aa</span>
                <span className="context-model-name">Classic</span>
                <span className="context-model-desc">Left, white, balanced</span>
              </button>

              <button id="modelBoldCenterBtn" className="context-model-card" type="button" data-model="bold-center">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-bold-center">Aa</span>
                <span className="context-model-name">Bold Center</span>
                <span className="context-model-desc">Centered, bold, yellow</span>
              </button>

              <button id="modelHeadlineBtn" className="context-model-card" type="button" data-model="headline">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-headline">AA</span>
                <span className="context-model-name">Headline</span>
                <span className="context-model-desc">Uppercase, center, sky blue</span>
              </button>

              <button id="modelGlossaryBtn" className="context-model-card" type="button" data-model="glossary">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-glossary">Aa</span>
                <span className="context-model-name">Glossary</span>
                <span className="context-model-desc">Left, italic, green</span>
              </button>

              <button id="modelCompactBtn" className="context-model-card" type="button" data-model="compact">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-compact">aa</span>
                <span className="context-model-name">Compact</span>
                <span className="context-model-desc">Left, lowercase flow</span>
              </button>

              <button id="modelPosterBtn" className="context-model-card" type="button" data-model="poster">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-poster">A</span>
                <span className="context-model-name">Poster</span>
                <span className="context-model-desc">Right, bold, red</span>
              </button>

              <button id="modelNeonBtn" className="context-model-card" type="button" data-model="neon">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-neon">Aa</span>
                <span className="context-model-name">Neon</span>
                <span className="context-model-desc">Center, fuchsia, bold glow</span>
              </button>

              <button id="modelChalkBtn" className="context-model-card" type="button" data-model="chalk">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-chalk">Aa</span>
                <span className="context-model-name">Chalk</span>
                <span className="context-model-desc">Left, cream, chalkboard feel</span>
              </button>

              <button id="modelSunriseBtn" className="context-model-card" type="button" data-model="sunrise">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-sunrise">Tt</span>
                <span className="context-model-name">Sunrise</span>
                <span className="context-model-desc">Center, orange, title case</span>
              </button>

              <button id="modelOceanBtn" className="context-model-card" type="button" data-model="ocean">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-ocean">Aa</span>
                <span className="context-model-name">Ocean</span>
                <span className="context-model-desc">Left, cyan, italic</span>
              </button>

              <button id="modelRoyalBtn" className="context-model-card" type="button" data-model="royal">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-royal">Tt</span>
                <span className="context-model-name">Royal</span>
                <span className="context-model-desc">Center, gold, title case</span>
              </button>

              <button id="modelFireBtn" className="context-model-card" type="button" data-model="fire">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-fire">AA</span>
                <span className="context-model-name">Fire</span>
                <span className="context-model-desc">Center, coral, uppercase bold</span>
              </button>

              <button id="modelForestBtn" className="context-model-card" type="button" data-model="forest">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-forest">Tt</span>
                <span className="context-model-name">Forest</span>
                <span className="context-model-desc">Left, lime, title case</span>
              </button>

              <button id="modelNightBtn" className="context-model-card" type="button" data-model="night">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-night">Aa</span>
                <span className="context-model-name">Night</span>
                <span className="context-model-desc">Right, violet, italic</span>
              </button>

              <button id="modelCandyBtn" className="context-model-card" type="button" data-model="candy">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-candy">Aa</span>
                <span className="context-model-name">Candy</span>
                <span className="context-model-desc">Center, pink, bold fun</span>
              </button>

              <button id="modelMatrixBtn" className="context-model-card" type="button" data-model="matrix">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-matrix">aa</span>
                <span className="context-model-name">Matrix</span>
                <span className="context-model-desc">Left, lime green, lowercase</span>
              </button>

              <button id="modelIceBtn" className="context-model-card" type="button" data-model="ice">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-ice">Aa</span>
                <span className="context-model-name">Ice</span>
                <span className="context-model-desc">Center, mint, italic cool</span>
              </button>

              <button id="modelTealBtn" className="context-model-card" type="button" data-model="teal">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-teal">Aa</span>
                <span className="context-model-name">Teal</span>
                <span className="context-model-desc">Left, teal, underlined bold</span>
              </button>

            </div>

            {/* ── Key-Value Models ─────────────────────────────────────── */}
            <p className="field-label" style={{marginTop:"16px",marginBottom:"4px"}}>Key : Value Layout</p>
            <p className="upload-copy" style={{marginBottom:"8px"}}>Write lines like <strong>Term: definition</strong>. The part before <code>:</code> is the key color, the rest is the value color.</p>
            <div className="context-model-grid" role="group" aria-label="Key-Value style models">

              <button id="modelKvClassicBtn" className="context-model-card" type="button" data-model="kv-classic">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-kv-classic"><span style={{color:"#facc15",fontWeight:800}}>K</span><span style={{color:"rgba(255,255,255,0.5)"}}>:</span><span style={{color:"#ffffff",fontWeight:400,fontSize:"0.9rem"}}>V</span></span>
                <span className="context-model-name">KV Classic</span>
                <span className="context-model-desc">Yellow key, white value</span>
              </button>

              <button id="modelKvOceanBtn" className="context-model-card" type="button" data-model="kv-ocean">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-kv-ocean"><span style={{color:"#06b6d4",fontWeight:700}}>K</span><span style={{color:"rgba(255,255,255,0.4)"}}>:</span><span style={{color:"#6ee7b7",fontStyle:"italic",fontSize:"0.9rem"}}>V</span></span>
                <span className="context-model-name">KV Ocean</span>
                <span className="context-model-desc">Cyan key, mint value</span>
              </button>

              <button id="modelKvFireBtn" className="context-model-card" type="button" data-model="kv-fire">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-kv-fire"><span style={{color:"#fb7185",fontWeight:900}}>K</span><span style={{color:"rgba(255,255,255,0.4)"}}>:</span><span style={{color:"#fef9c3",fontSize:"0.9rem"}}>V</span></span>
                <span className="context-model-name">KV Fire</span>
                <span className="context-model-desc">Coral key, cream value</span>
              </button>

              <button id="modelKvRoyalBtn" className="context-model-card" type="button" data-model="kv-royal">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-kv-royal"><span style={{color:"#fbbf24",fontWeight:800}}>K</span><span style={{color:"rgba(255,255,255,0.4)"}}>:</span><span style={{color:"#ffffff",fontSize:"0.9rem"}}>V</span></span>
                <span className="context-model-name">KV Royal</span>
                <span className="context-model-desc">Gold key, white value</span>
              </button>

            </div>

            {/* KV manual toggle + color pickers */}
            <div className="kv-toggle-row">
              <label className="kv-toggle-label" htmlFor="kvModeCheck">
                <input type="checkbox" id="kvModeCheck" />
                <span>Enable Key:Value Mode (manual)</span>
              </label>
              <div className="kv-color-pickers">
                <label className="kv-color-field" htmlFor="kvKeyColorPicker">
                  <span>Key</span>
                  <input type="color" id="kvKeyColorPicker" defaultValue="#facc15" />
                </label>
                <label className="kv-color-field" htmlFor="kvValueColorPicker">
                  <span>Value</span>
                  <input type="color" id="kvValueColorPicker" defaultValue="#ffffff" />
                </label>
              </div>
            </div>

            {/* ── Narration Type Models ─────────────────────────────────── */}
            <p className="field-label" style={{marginTop:"16px",marginBottom:"4px"}}>Narration Type</p>
            <p className="upload-copy" style={{marginBottom:"8px"}}>Pick a narration feel — each applies a matching visual tone to your slide.</p>
            <div className="context-model-grid" role="group" aria-label="Narration type models">

              <button id="modelStorytellerBtn" className="context-model-card" type="button" data-model="storyteller">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-storyteller">Once</span>
                <span className="context-model-name">Storyteller</span>
                <span className="context-model-desc">Warm, italic, flowing</span>
              </button>

              <button id="modelQuizBtn" className="context-model-card" type="button" data-model="quiz">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-quiz">Q?</span>
                <span className="context-model-name">Quiz</span>
                <span className="context-model-desc">Center, cyan, bold title</span>
              </button>

              <button id="modelDialogueBtn" className="context-model-card" type="button" data-model="dialogue">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-dialogue">"Aa"</span>
                <span className="context-model-name">Dialogue</span>
                <span className="context-model-desc">Left, pink, italic voice</span>
              </button>

              <button id="modelBroadcastBtn" className="context-model-card" type="button" data-model="broadcast">
                <span className="context-model-check">✓</span>
                <span className="context-model-preview context-model-preview-broadcast">NEWS</span>
                <span className="context-model-name">Broadcast</span>
                <span className="context-model-desc">Center, bold, uppercase</span>
              </button>

            </div>

            {/* ── Font Weight Quick Row ───────────────────────────────── */}
            <p className="field-label" style={{marginTop:"14px",marginBottom:"6px"}}>Font Weight</p>
            <div className="alignment-btn-row" role="group" aria-label="Font weight">
              <button id="weightNormalBtn" className="align-btn" type="button" aria-pressed="false" title="Normal weight" style={{fontWeight:400}}>Normal</button>
              <button id="weightBoldBtn" className="align-btn" type="button" aria-pressed="false" title="Bold weight" style={{fontWeight:700}}>Bold</button>
              <button id="weightXBoldBtn" className="align-btn" type="button" aria-pressed="false" title="Extra Bold" style={{fontWeight:900}}>X Bold</button>
            </div>

            {/* ── Color Presets ──────────────────────────────────────── */}
            <p className="field-label" style={{marginTop:"14px",marginBottom:"8px"}}>Quick Color Presets</p>
            <p className="upload-copy" style={{marginBottom:"10px"}}>Click a swatch to apply it as the slide text color. A ✓ marks the active choice.</p>
            <div className="color-preset-row" role="group" aria-label="Color presets" id="colorPresetRow">
              <button className="color-swatch color-swatch-active" data-color="#ffffff" id="swatchWhite" type="button" title="White" aria-label="White text">
                <span className="swatch-dot" style={{background:"#ffffff"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">White</span>
              </button>
              <button className="color-swatch" data-color="#facc15" id="swatchYellow" type="button" title="Yellow" aria-label="Yellow text">
                <span className="swatch-dot" style={{background:"#facc15"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Yellow</span>
              </button>
              <button className="color-swatch" data-color="#0d7ea9" id="swatchSkyBlue" type="button" title="Sky Blue" aria-label="Sky blue text">
                <span className="swatch-dot" style={{background:"#0d7ea9"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Sky Blue</span>
              </button>
              <button className="color-swatch" data-color="#16a34a" id="swatchGreen" type="button" title="Bright Green" aria-label="Bright green text">
                <span className="swatch-dot" style={{background:"#16a34a"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Green</span>
              </button>
              <button className="color-swatch" data-color="#dc2626" id="swatchRed" type="button" title="Red" aria-label="Red text">
                <span className="swatch-dot" style={{background:"#dc2626"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Red</span>
              </button>
              <button className="color-swatch" data-color="#f97316" id="swatchOrange" type="button" title="Orange" aria-label="Orange text">
                <span className="swatch-dot" style={{background:"#f97316"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Orange</span>
              </button>
              <button className="color-swatch" data-color="#a78bfa" id="swatchViolet" type="button" title="Violet" aria-label="Violet text">
                <span className="swatch-dot" style={{background:"#a78bfa"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Violet</span>
              </button>
              <button className="color-swatch" data-color="#000000" id="swatchBlack" type="button" title="Black" aria-label="Black text">
                <span className="swatch-dot" style={{background:"#000000",border:"1px solid rgba(255,255,255,0.25)"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Black</span>
              </button>
              <button className="color-swatch" data-color="#06b6d4" id="swatchCyan" type="button" title="Cyan" aria-label="Cyan text">
                <span className="swatch-dot" style={{background:"#06b6d4"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Cyan</span>
              </button>
              <button className="color-swatch" data-color="#ec4899" id="swatchPink" type="button" title="Pink" aria-label="Pink text">
                <span className="swatch-dot" style={{background:"#ec4899"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Pink</span>
              </button>
              <button className="color-swatch" data-color="#84cc16" id="swatchLime" type="button" title="Lime" aria-label="Lime text">
                <span className="swatch-dot" style={{background:"#84cc16"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Lime</span>
              </button>
              <button className="color-swatch" data-color="#fbbf24" id="swatchGold" type="button" title="Gold" aria-label="Gold text">
                <span className="swatch-dot" style={{background:"#fbbf24"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Gold</span>
              </button>
              <button className="color-swatch" data-color="#14b8a6" id="swatchTeal" type="button" title="Teal" aria-label="Teal text">
                <span className="swatch-dot" style={{background:"#14b8a6"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Teal</span>
              </button>
              <button className="color-swatch" data-color="#fb7185" id="swatchCoral" type="button" title="Coral" aria-label="Coral text">
                <span className="swatch-dot" style={{background:"#fb7185"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Coral</span>
              </button>
              <button className="color-swatch" data-color="#fef9c3" id="swatchCream" type="button" title="Cream" aria-label="Cream text">
                <span className="swatch-dot" style={{background:"#fef9c3",border:"1px solid rgba(255,255,255,0.15)"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Cream</span>
              </button>
              <button className="color-swatch" data-color="#6ee7b7" id="swatchMint" type="button" title="Mint" aria-label="Mint text">
                <span className="swatch-dot" style={{background:"#6ee7b7"}}></span>
                <span className="swatch-check">✓</span>
                <span className="swatch-label">Mint</span>
              </button>
            </div>

            <p className="upload-copy" id="alignmentModelStatus" style={{marginTop:"10px"}}>Classic model active. Left-aligned, white text.</p>
          </div>

        </div>
      </details>

      <details className="section-card" id="pdfSection">
        <summary className="section-summary">
          <span className="summary-head">
            <span className="section-icon">PDF</span>
            <span className="summary-copy">
              <span className="section-title">Upload PDF</span>
              <span className="section-meta">Extract text from a PDF, fit it to the slide automatically, and present
                it.</span>
            </span>
          </span>
        </summary>
        <div className="section-content">
          <div className="pdf-upload-grid">
            <div className="upload-block pdf-upload-block">
              <label className="field-label" htmlFor="pdfInput">PDF File</label>
              <p className="upload-copy">Upload a PDF and the app will read the text from each page, place it in the lesson
                box, and keep the presentation layout responsive for longer documents.</p>
              <input id="pdfInput" className="image-input" type="file" accept="application/pdf,.pdf" />
              <div className="toolbar toolbar-compact">
                <button id="pdfShowBtn" className="primary-btn" type="button" disabled>Show Screen</button>
                <button id="pdfPresentBtn" className="accent-btn" type="button" disabled>Read And Present Context</button>
                <button id="clearPdfBtn" className="ghost-btn" type="button" disabled>Clear PDF</button>
              </div>
              <div id="pdfProgress" className="progress-indicator hidden" role="progressbar" aria-live="polite"
                aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <div className="progress-track">
                  <span id="pdfProgressBar" className="progress-fill"></span>
                </div>
                <p id="pdfProgressLabel" className="upload-copy">0% complete</p>
              </div>
              <p className="upload-copy" id="pdfStatus">No PDF selected.</p>
              <p className="upload-copy" id="pdfPageSelectionSummary">Select a PDF to choose which pages should appear on
                the screen.</p>
            </div>

            <div className="tool-card pdf-preview-card">
              <div className="tool-card-head">
                <span className="module-icon">TXT</span>
                <p className="tool-card-title">Extracted PDF Content</p>
              </div>
              <p className="upload-copy" id="pdfMeta">Upload a PDF to preview the extracted text before showing it on the
                slide.</p>
              <div id="pdfPreviewList" className="pdf-preview-list hidden" aria-live="polite"></div>
            </div>
          </div>

          <div className="tool-card pdf-pages-card">
            <div className="tool-card-head pdf-pages-head">
              <div className="pdf-pages-head-copy">
                <span className="module-icon">PGS</span>
                <p className="tool-card-title">PDF Page Picker</p>
              </div>
              <div className="pdf-page-bulk-actions" aria-label="PDF page bulk selection controls">
                <button id="pdfSelectAllBtn" className="ghost-btn pdf-page-bulk-btn" type="button" disabled
                  title="Select all PDF pages" aria-label="Select all PDF pages">&#10003; All</button>
                <button id="pdfClearSelectionBtn" className="ghost-btn pdf-page-bulk-btn" type="button" disabled
                  title="Deselect all PDF pages" aria-label="Deselect all PDF pages">&#10005; All</button>
              </div>
            </div>
            <p className="upload-copy">Rendered page thumbnails keep the PDF layout exactly as it appears in the file. Tick
              only the pages you want to present.</p>
            <div id="pdfPageList" className="pdf-page-list hidden" aria-live="polite"></div>
          </div>
        </div>
      </details>

      <details className="section-card" hidden>
        <summary className="section-summary">
          <span className="summary-head">
            <span className="section-icon">GEN</span>
            <span className="summary-copy">
              <span className="section-title">Scene Generator</span>
              <span className="section-meta">Describe the scene, optionally add images or music, and let the app prepare the
                best matching look.</span>
            </span>
          </span>
        </summary>
        <div className="section-content">
          <div className="scene-generator-grid">
            <div className="tool-card scene-generator-card">
              <div className="tool-card-head">
                <span className="module-icon">AI</span>
                <p className="tool-card-title">Prompt To Scene Setup</p>
              </div>
              <p className="upload-copy">Write the scene idea here. The app will choose a fitting background VFX style,
                music mood, and export setup for the learning slide.</p>
              <label className="style-field" htmlFor="scenePromptInput">
                <span className="style-label">Scene Prompt</span>
                <textarea id="scenePromptInput" className="lesson-input scene-prompt-input" placeholder="Example:
Ocean lesson with calm bubbles, bright school style, soft background music.
Space topic with stars, dreamy motion, and a magical learning feel."></textarea>
              </label>
              <div className="scene-options-grid">
                <label className="style-field" htmlFor="sceneVfxSelect">
                  <span className="style-label">Background VFX</span>
                  <select id="sceneVfxSelect" className="theme-select text-style-select"
                    aria-label="Choose scene background effect">
                    <option value="auto">Auto</option>
                    <option value="sparkles">Sparkles</option>
                    <option value="bubbles">Bubbles</option>
                    <option value="waves">Waves</option>
                    <option value="rays">Rays</option>
                    <option value="confetti">Confetti</option>
                    <option value="grid">Grid</option>
                  </select>
                </label>
                <label className="style-field" htmlFor="sceneMusicModeSelect">
                  <span className="style-label">Background Music</span>
                  <select id="sceneMusicModeSelect" className="theme-select text-style-select"
                    aria-label="Choose scene music mode">
                    <option value="auto">Auto Generate</option>
                    <option value="upload">Use Uploaded Music</option>
                    <option value="off">No Music</option>
                  </select>
                </label>
              </div>
              <div className="scene-upload-grid">
                <div className="upload-block">
                  <label className="field-label" htmlFor="sceneImageInput">Optional Scene Images</label>
                  <p className="upload-copy">Upload images here if you want them added to the slide gallery automatically
                    when you generate the scene.</p>
                  <input id="sceneImageInput" className="image-input" type="file" accept="image/*" multiple />
                  <div id="sceneImagePreviewList" className="image-preview-list hidden" aria-live="polite"></div>
                </div>
                <div className="upload-block">
                  <label className="field-label" htmlFor="sceneMusicInput">Optional Background Music</label>
                  <p className="upload-copy">Upload your own music, or leave this empty and the app can generate a matching
                    background loop from the prompt.</p>
                  <input id="sceneMusicInput" className="image-input" type="file" accept="audio/*" />
                  <audio id="sceneMusicPreview" className="audio-preview hidden" controls preload="metadata"></audio>
                  <p className="upload-copy" id="sceneMusicStatus">No background music selected.</p>
                </div>
              </div>
              <div className="toolbar toolbar-compact">
                <button id="generateSceneBtn" className="primary-btn" type="button">Generate Scene</button>
                <button id="generateSceneShowBtn" className="accent-btn" type="button">Generate And Show</button>
                <button id="clearSceneBtn" className="ghost-btn" type="button">Clear Scene Setup</button>
              </div>
              <div id="sceneGenerationProgress" className="progress-indicator hidden" role="progressbar" aria-live="polite"
                aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <div className="progress-track">
                  <span id="sceneGenerationProgressBar" className="progress-fill"></span>
                </div>
                <p id="sceneGenerationProgressLabel" className="upload-copy">0% complete</p>
              </div>
              <p className="upload-copy" id="sceneGeneratorStatus">Describe the scene and click Generate Scene. The preview
                on the right will update first.</p>
            </div>

            <div className="tool-card scene-preview-card">
              <div className="tool-card-head">
                <span className="module-icon">VFX</span>
                <p className="tool-card-title">Scene Preview</p>
              </div>
              <div id="scenePreviewStage" className="scene-preview-stage" data-vfx="sparkles">
                <div className="scene-preview-glow"></div>
                <p id="scenePreviewLabel" className="scene-preview-label">Bright classroom style with gentle sparkles.</p>
              </div>
              <div className="scene-preview-chip-row">
                <span id="sceneThemeChip" className="scene-preview-chip">Theme: Classroom</span>
                <span id="sceneVfxChip" className="scene-preview-chip">VFX: Sparkles</span>
                <span id="sceneMusicChip" className="scene-preview-chip">Music: Bright</span>
                <span id="sceneExportChip" className="scene-preview-chip">Export: HD</span>
              </div>
              <img id="scenePreviewImage" className="scene-preview-image hidden" alt="Scene preview image" />
              <p id="scenePreviewHint" className="upload-copy">This preview shows the style that will be applied to the blue
                screen before you open the slide.</p>
            </div>
          </div>
        </div>
      </details>

      <details className="section-card" id="serverControlsSection">
        <summary className="section-summary">
          <span className="summary-head">
            <span className="section-icon">SVC</span>
            <span className="summary-copy">
              <span className="section-title">Server Controls</span>
              <span className="section-meta">Start and check the local narration, Anjali clone, transcription, and export
                helpers.</span>
            </span>
          </span>
        </summary>
        <div className="section-content">
          <div className="upload-block server-block">
            <div className="toolbar toolbar-compact">
              <button id="startServersBtn" className="primary-btn" type="button">Start Servers</button>
              <button id="copyStartAllBtn" className="primary-btn" type="button">Copy Start Command</button>
              <button id="checkServersBtn" className="ghost-btn" type="button">Check Servers</button>
            </div>
            <div className="server-status-grid">
              <p className="upload-copy" id="serverControlsStatus">Use Start Servers to launch the local helpers for
                narration, transcription, and video export.</p>
              <p className="upload-copy" id="narrationHealthStatus">Narration server: checking...</p>
              <p className="upload-copy" id="anjaliCloneHealthStatus">Anjali clone server: checking...</p>
              <p className="upload-copy" id="transcribeHealthStatus">Transcription server: checking...</p>
              <p className="upload-copy" id="videoExportHealthStatus">Video export server: checking...</p>
            </div>
          </div>
        </div>
      </details>

      <details className="section-card" id="speechToolsSection">
        <summary className="section-summary">
          <span className="summary-head">
            <span className="section-icon">MIC</span>
            <span className="summary-copy">
              <span className="section-title">Text And Speech Tools</span>
              <span className="section-meta">These tools help you fill the lesson text and check the voice before showing
                the screen.</span>
            </span>
          </span>
        </summary>
        <div className="section-content">
          <div className="tool-grid">
            <div className="tool-card">
              <div className="tool-card-head">
                <span className="module-icon">MIC</span>
                <p className="tool-card-title">1. Fill the lesson text by speaking</p>
              </div>
              <p className="upload-copy">Use this when you want to speak instead of typing.</p>
              <div className="toolbar toolbar-compact">
                <button id="dictateBtn" className="primary-btn" type="button">Start Dictation</button>
                <button id="stopDictateBtn" className="ghost-btn" type="button" disabled>Stop Dictation</button>
              </div>
            </div>

            <div className="tool-card">
              <div className="tool-card-head">
                <span className="module-icon">VOX</span>
                <p className="tool-card-title">2. Hear the lesson before showing the slide</p>
              </div>
              <p className="upload-copy">Click Read Text to hear the latest output in the selected voice.</p>
              <div className="toolbar toolbar-compact">
                <button id="previewTextBtn" className="ghost-btn" type="button">Read Text</button>
                <button id="stopPreviewBtn" className="ghost-btn" type="button" disabled>Stop Reading</button>
              </div>
              <div id="previewVoiceChooser" className="voice-choice hidden" aria-live="polite">
                <p className="upload-copy">Selected voice is used for reading.</p>
                <div className="toolbar toolbar-compact">
                  <button id="previewAnjaliBtn" className="ghost-btn" type="button">Teacher Voice</button>
                </div>
              </div>
              <label className="style-field" htmlFor="slideVoiceSelect">
                <span className="style-label">Saved Slide Voice</span>
                <select id="slideVoiceSelect" className="theme-select text-style-select"
                  aria-label="Choose saved slide voice" defaultValue="google-kore">
                  <option value="anjali">Anjali Narration</option>
                  <option value="pattan">Pattan Narration</option>
                  <option value="google-kore">Google AI — Indian Teacher (Kore)</option>
                  <option value="google-aoede">Google AI — Indian Warm Female (Aoede)</option>
                  <option value="google-charon">Google AI — Indian Male Teacher (Charon)</option>
                  <option value="google-puck">Google AI — Indian Energetic Male (Puck)</option>
                </select>
              </label>
              <p className="upload-copy">Play Slide and Export Video use the saved slide voice. Google AI Studio voices require a key in <code>D:\voice\.gemini_api_key</code>.</p>
            </div>
          </div>

          <div className="tool-card maths-helper-card">
            <div className="tool-card-head">
              <span className="module-icon">MTH</span>
              <p className="tool-card-title">Maths Teacher Starter</p>
            </div>
            <p className="upload-copy">Load ready-made maths lessons, practise clear pronunciation, and keep Anjali's warm
              sample voice inside the project.</p>
            <div className="maths-chip-row" aria-label="Maths topics">
              <span className="maths-chip">Numbers</span>
              <span className="maths-chip">Operations</span>
              <span className="maths-chip">Tables</span>
              <span className="maths-chip">Sums</span>
              <span className="maths-chip">Shapes</span>
              <span className="maths-chip">Pronunciation</span>
            </div>
            <div className="toolbar toolbar-compact maths-helper-actions">
              <button id="loadMathsNumbersBtn" className="primary-btn" type="button">Load Numbers Lesson</button>
              <button id="loadMathsOperationsBtn" className="ghost-btn" type="button">Load Operations Lesson</button>
              <button id="loadMathsTablesBtn" className="ghost-btn" type="button">Load Tables 2 To 10</button>
              <button id="loadMathsSumsBtn" className="ghost-btn" type="button">Load Mixed Sums</button>
              <button id="loadMathsPronunciationBtn" className="ghost-btn" type="button">Load Pronunciation
                Practice</button>
            </div>
            <p className="field-label">Quick Table Boxes</p>
            <p className="upload-copy">Tap a box to load a clean multiplication table directly into the maths lesson area.
            </p>
            <div className="maths-box-layout" aria-label="Quick multiplication tables">
              <button id="loadTable2Btn" className="maths-box-btn" type="button">
                <span className="maths-box-title">Table Of 2</span>
                <span className="maths-box-copy">2 x 1 to 2 x 10</span>
              </button>
              <button id="loadTable3Btn" className="maths-box-btn" type="button">
                <span className="maths-box-title">Table Of 3</span>
                <span className="maths-box-copy">3 x 1 to 3 x 10</span>
              </button>
              <button id="loadTable4Btn" className="maths-box-btn" type="button">
                <span className="maths-box-title">Table Of 4</span>
                <span className="maths-box-copy">4 x 1 to 4 x 10</span>
              </button>
              <button id="loadTable5Btn" className="maths-box-btn" type="button">
                <span className="maths-box-title">Table Of 5</span>
                <span className="maths-box-copy">5 x 1 to 5 x 10</span>
              </button>
              <button id="loadTable10Btn" className="maths-box-btn" type="button">
                <span className="maths-box-title">Table Of 10</span>
                <span className="maths-box-copy">10 x 1 to 10 x 10</span>
              </button>
              <button id="loadTableComboBtn" className="maths-box-btn maths-box-btn-accent" type="button">
                <span className="maths-box-title">Tables 2 To 10</span>
                <span className="maths-box-copy">Full classroom table practice</span>
              </button>
            </div>
            <label className="field-label" htmlFor="anjaliSampleAudio">Anjali voice sample</label>
            <p className="upload-copy">This bundled MP3 is available as a reference sample. Generated narration uses the
              Anjali voice flow.</p>
            <audio id="anjaliSampleAudio" className="audio-preview" controls preload="metadata"></audio>
            <div className="toolbar toolbar-compact">
              <button id="useAnjaliSampleBtn" className="ghost-btn" type="button">Try Sample As Narration</button>
            </div>
            <p className="upload-copy" id="mathsHelperStatus">Maths practice is ready. Load starter lessons, boxed tables,
              mixed sums, listen to the sample, or use the sample as short narration.</p>
          </div>

          <div className="tool-status-card">
            <div className="tool-card-head">
              <span className="module-icon">STAT</span>
              <p className="tool-card-title">Current Tool Status</p>
            </div>
            <p className="upload-copy" id="speechToolsStatus">Type normally, or use speech to text to fill the content box.
            </p>
          </div>
        </div>
      </details>

      <details className="section-card" id="audioToTextSection">
        <summary className="section-summary">
          <span className="summary-head">
            <span className="section-icon">AUD</span>
            <span className="summary-copy">
              <span className="section-title">Upload Audio To Text</span>
              <span className="section-meta">Choose an audio file, submit it, and watch the transcription progress.</span>
            </span>
          </span>
        </summary>
        <div className="section-content">
          <div className="upload-block">
            <label className="field-label" htmlFor="transcribeAudioInput">Audio File</label>
            <p className="upload-copy">Upload an `mp3`, `wav`, or another audio file and the app will turn that speech into
              text in the content box.</p>
            <input id="transcribeAudioInput" className="image-input" type="file" accept="audio/*" />
            <div className="toolbar toolbar-compact">
              <button id="submitTranscribeBtn" className="primary-btn" type="button" disabled>Submit Audio</button>
            </div>
            <div id="transcribeProgress" className="progress-indicator hidden" role="progressbar" aria-live="polite"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div className="progress-track">
                <span id="transcribeProgressBar" className="progress-fill"></span>
              </div>
              <p id="transcribeProgressLabel" className="upload-copy">0% complete</p>
            </div>
            <p className="upload-copy" id="transcribeStatus">No audio uploaded for transcription.</p>
          </div>
        </div>
      </details>

      <details className="section-card" id="singSongSection">
        <summary className="section-summary">
          <span className="summary-head">
            <span className="section-icon">SNG</span>
            <span className="summary-copy">
              <span className="section-title">Sing Song</span>
              <span className="section-meta">Upload audio or video — converts American English accent to Indian English voice using SC3 clone.</span>
            </span>
          </span>
        </summary>
        <div className="section-content">
          <div className="upload-block">
            <label className="field-label" htmlFor="singSongInput">Song MP3</label>
            <p className="upload-copy">Upload the song or audio file, then click <strong>Convert Voice to Indian English</strong> to replace the vocal with SC3 Indian voice directly.</p>
            <input id="singSongInput" className="image-input" type="file" accept="audio/mpeg,audio/mp3,audio/*" />
            <audio id="singSongSourcePreview" className="audio-preview hidden" controls preload="metadata"></audio>
            <label className="field-label" htmlFor="sc3VideoInput">Videos — Queue (American English → Indian English)</label>
            <p className="upload-copy">Upload <strong>one or more videos</strong> — they will be queued and processed one by one. Each video gets its full audio replaced with the SC3 Indian English voice.</p>
            <input id="sc3VideoInput" className="image-input" type="file" accept="video/mp4,video/webm,video/*" multiple />
            <button id="sc3VideoFolderBtn" className="ghost-btn" type="button">📁 Load Every Video From a Folder</button>
            <video id="sc3VideoSourcePreview" className="audio-preview hidden" controls preload="metadata"></video>
            <div className="toolbar toolbar-compact">
              <button id="singSongProcessBtn" className="primary-btn" type="button" disabled>🎵 Prepare Song Mix</button>
              <button id="singSongSc3ReplaceBtn" className="primary-btn" type="button" disabled>🎤 Convert Voice → Indian English (SC3)</button>
              <button id="sc3VideoReplaceBtn" className="primary-btn" type="button" disabled>🎬 Process Video Queue → Indian (SC3)</button>
              <button id="singSongModelBtn" className="primary-btn hidden" type="button" disabled>🤖 Use SC3 Singing Model</button>
              <button id="singSongDownloadBtn" className="ghost-btn" type="button" disabled>📥 Download Result</button>
              <button id="singSongDownloadReplacedBtn" className="ghost-btn" type="button" disabled>📥 Download Converted Song</button>
              <button id="sc3VideoDownloadBtn" className="ghost-btn" type="button" disabled>📥 Download Last Video</button>
            </div>

            {/* ── Voice Mode Selector ─────────────────────────────────── */}
            <div id="sc3VoiceModePanel" style={{marginTop:'14px', background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.25)', borderRadius:'10px', padding:'12px 16px'}}>
              <div style={{fontWeight:'700', color:'#a5b4fc', fontSize:'0.88rem', marginBottom:'10px', letterSpacing:'0.03em'}}>🎙️ Voice Processing Mode</div>
              <div style={{display:'flex', gap:'10px', flexWrap:'wrap'}}>
                <label id="sc3ModeChatterboxLabel" style={{display:'flex', alignItems:'center', gap:'8px', cursor:'pointer', background:'rgba(124,58,237,0.18)', border:'2px solid #7c3aed', borderRadius:'8px', padding:'8px 14px', flex:'1', minWidth:'160px', transition:'all 0.2s'}}>
                  <input type="radio" name="sc3VoiceMode" id="sc3ModeChatterbox" value="chatterbox" defaultChecked style={{accentColor:'#7c3aed', width:'16px', height:'16px'}} />
                  <div>
                    <div style={{fontWeight:'700', color:'#c4b5fd', fontSize:'0.88rem'}}>🎯 High Quality</div>
                    <div style={{color:'#9ca3af', fontSize:'0.75rem'}}>Chatterbox TTS • Better voice clone • Slower</div>
                  </div>
                </label>
                <label id="sc3ModeSc3Label" style={{display:'flex', alignItems:'center', gap:'8px', cursor:'pointer', background:'rgba(30,30,50,0.4)', border:'2px solid rgba(99,102,241,0.3)', borderRadius:'8px', padding:'8px 14px', flex:'1', minWidth:'160px', transition:'all 0.2s'}}>
                  <input type="radio" name="sc3VoiceMode" id="sc3ModeSc3" value="sc3singing" style={{accentColor:'#f59e0b', width:'16px', height:'16px'}} />
                  <div>
                    <div style={{fontWeight:'700', color:'#fcd34d', fontSize:'0.88rem'}}>⚡ Fast</div>
                    <div style={{color:'#9ca3af', fontSize:'0.75rem'}}>SC3 Singing • Natural rhythm • Much faster</div>
                  </div>
                </label>
                <label id="sc3ModeLyriaLabel" style={{display:'flex', alignItems:'center', gap:'8px', cursor:'pointer', background:'rgba(30,30,50,0.4)', border:'2px solid rgba(34,211,238,0.35)', borderRadius:'8px', padding:'8px 14px', flex:'1', minWidth:'180px', transition:'all 0.2s'}}>
                  <input type="radio" name="sc3VoiceMode" id="sc3ModeLyria" value="lyria" style={{accentColor:'#22d3ee', width:'16px', height:'16px'}} />
                  <div>
                    <div style={{fontWeight:'700', color:'#67e8f9', fontSize:'0.88rem'}}>☁ Google Lyria 3 Pro</div>
                    <div style={{color:'#9ca3af', fontSize:'0.75rem'}}>Cloud song • Custom duration • 44.1 kHz stereo</div>
                  </div>
                </label>
              </div>
            </div>

            {/* ── Queue Monitor Panel ─────────────────────────────────── */}
            <div id="sc3QueuePanel" style={{display:'none', marginTop:'14px', background:'rgba(124,58,237,0.08)', border:'1px solid rgba(124,58,237,0.25)', borderRadius:'10px', padding:'14px'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px'}}>
                <span style={{fontWeight:'700', color:'#a78bfa', fontSize:'0.95rem', letterSpacing:'0.02em'}}>📋 Video Queue</span>
                <span id="sc3QueueCounter" style={{color:'#9ca3af', fontSize:'0.82rem', fontFamily:'monospace', background:'rgba(0,0,0,0.25)', padding:'2px 8px', borderRadius:'999px'}}>0 / 0 complete</span>
              </div>
              <div id="sc3QueueList" style={{maxHeight:'240px', overflowY:'auto', display:'flex', flexDirection:'column', gap:'5px', paddingRight:'2px'}}></div>
              <div className="toolbar toolbar-compact" style={{marginTop:'12px', gap:'8px'}}>
                <button id="sc3PauseBtn" className="primary-btn" type="button" disabled
                  style={{background:'linear-gradient(135deg,#f59e0b,#d97706)', border:'none', minWidth:'110px'}}>⏸ Pause</button>
                <button id="sc3StopBtn" className="ghost-btn" type="button" disabled
                  style={{borderColor:'#f87171', color:'#f87171', minWidth:'110px'}}>⛔ Stop Queue</button>
                <span id="sc3QueueEta" style={{color:'#6b7280', fontSize:'0.8rem', marginLeft:'auto', alignSelf:'center'}}></span>
              </div>
            </div>


            <p className="upload-copy" id="singSongModelStatus">SC3 Indian voice clone is ready. Upload one or more videos above and click Process Video Queue.</p>
            <div id="singSongProgress" className="progress-indicator hidden" role="progressbar" aria-live="polite"
              aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
              style={{marginTop:'14px',padding:'14px 16px',borderRadius:'12px',border:'1px solid rgba(96,165,250,.4)',background:'linear-gradient(135deg,rgba(30,58,138,.22),rgba(15,23,42,.8))'}}>
              <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'9px'}}>
                <span id="singSongProgressSpinner" aria-hidden="true" style={{display:'none',width:'16px',height:'16px',border:'3px solid rgba(96,165,250,.3)',borderTopColor:'#60a5fa',borderRadius:'50%',animation:'spin 1s linear infinite'}} />
                <strong id="singSongProgressLabel" style={{color:'#dbeafe',fontSize:'.92rem'}}>Ready</strong>
                <strong style={{marginLeft:'auto',color:'#93c5fd',fontSize:'1.1rem'}}><span id="singSongProgressPct">0</span>%</strong>
              </div>
              <div className="progress-track" style={{height:'9px',overflow:'hidden',borderRadius:'999px'}}>
                <span id="singSongProgressBar" className="progress-fill" style={{width:'0%',transition:'width .45s ease'}}></span>
                <span id="singSongProgressShimmer" aria-hidden="true" style={{display:'none'}} />
              </div>
              <div style={{display:'flex',gap:'12px',flexWrap:'wrap',marginTop:'10px',fontSize:'.76rem',color:'#bfdbfe'}}>
                <span>Queue: <b id="singSongQueueCounter">0 / 0 videos</b></span>
                <span>Elapsed: <b id="singSongElapsed">0:00</b></span>
                <span>ETA: <b id="singSongProgressEta">calculating…</b></span>
                <span>Done: <b id="singSongDoneCount">0</b></span>
                <span>Failed: <b id="singSongFailCount">0</b></span>
                <span id="singSongEtaDetail" style={{display:'none'}}>calculating…</span>
              </div>
              <p style={{margin:'9px 0 0',fontSize:'.75rem',color:'#94a3b8'}}>Live status updates automatically while extracting audio, transcribing, generating voice, syncing, muxing, and saving.</p>
            </div>
            <audio id="singSongResultPreview" className="audio-preview hidden" controls preload="metadata"></audio>
            <video id="sc3VideoResultPreview" className="audio-preview hidden" controls preload="metadata"></video>
            <p className="upload-copy" id="singSongStatus">No song uploaded.</p>
          </div>
        </div>
      </details>

      {/* ═══ AI Caption Action Buttons — always visible ═══ */}
      <div style={{display:'flex',gap:'10px',flexWrap:'wrap',alignItems:'center',
        padding:'14px 16px',background:'linear-gradient(135deg,rgba(20,20,40,0.98),rgba(10,10,30,0.98))',
        borderRadius:'14px',marginBottom:'8px',border:'2px solid rgba(255,255,255,0.18)',
        boxShadow:'0 4px 24px rgba(0,0,0,0.5)'}}>
        <span style={{fontSize:'11px',fontWeight:'800',color:'rgba(255,255,255,0.45)',
          textTransform:'uppercase',letterSpacing:'0.1em',marginRight:'4px'}}>AI Caption:</span>
        <button id="aiCapSttBtn" type="button"
          style={{display:'inline-flex',alignItems:'center',gap:'9px',padding:'12px 22px',
            borderRadius:'10px',border:'none',cursor:'pointer',
            background:'linear-gradient(135deg,#e53935,#b71c1c)',color:'#fff',
            fontSize:'14px',fontWeight:'800',boxShadow:'0 3px 14px rgba(229,57,53,0.55)'}}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/>
          </svg>
          🎥 Transcribe Video Audio → Captions
        </button>
        <button id="aiCapTtsBtn" type="button"
          style={{display:'inline-flex',alignItems:'center',gap:'9px',padding:'12px 22px',
            borderRadius:'10px',border:'none',cursor:'pointer',
            background:'linear-gradient(135deg,#1565c0,#0d47a1)',color:'#fff',
            fontSize:'14px',fontWeight:'800',boxShadow:'0 3px 14px rgba(21,101,192,0.55)'}}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
          🔊 Read Lesson (Pattan TTS)
        </button>
        <span id="aiCapVoiceStatus" style={{fontSize:'12px',color:'rgba(255,200,100,0.95)',
          fontWeight:'700',alignSelf:'center'}}></span>
      </div>

      <details className="section-card caption-burner-card" id="aiCaptionSection" open>
        <summary className="section-summary">
          <span className="summary-head">
            <span className="section-icon">CAP</span>
            <span className="summary-copy">
              <span className="section-title">AI Video Captioning (Local)</span>
              <span className="section-meta">Automatically generate and burn animated captions onto a video directly in your
                browser.</span>
            </span>
          </span>
        </summary>
        <div className="section-content caption-burner-body">
          <div className="upload-block">
            <label className="field-label" htmlFor="captionVideoInput">Source Video</label>
            <p className="upload-copy">Upload an `mp4` or `webm`. The AI will extract the audio and generate TikTok-style
              dynamic captions completely offline.</p>
            <input id="captionVideoInput" className="image-input" type="file" accept="video/*" multiple />

            <div id="captionQueuePanel" className="hidden" style={{"marginTop": "10px", "padding": "10px", "borderRadius": "8px", "background": "rgba(255,255,255,0.05)", "border": "1px solid rgba(255,255,255,0.1)"}}>
              <div style={{"display": "flex", "alignItems": "center", "justifyContent": "space-between", "gap": "10px"}}>
                <span id="captionQueueStatus" className="upload-copy" style={{"margin": "0", "fontWeight": "700"}}>Queue ready.</span>
                <div style={{"display": "flex", "gap": "8px"}}>
                  <button id="captionQueueRunBtn" className="ghost-btn" type="button">Start Queue</button>
                  <button id="captionQueueExportAllBtn" className="ghost-btn" type="button">Export All</button>
                  <button id="captionQueuePrevBtn" className="ghost-btn" type="button">Previous</button>
                  <button id="captionQueueNextBtn" className="ghost-btn" type="button">Next Video</button>
                </div>
              </div>
              <div id="captionQueueList" style={{"display": "grid", "gap": "6px", "marginTop": "8px"}}></div>
            </div>

            <div className="toolbar toolbar-compact">
              <button id="captionActionBtn" className="primary-btn" type="button" disabled>Generate Captions (Upload Source First)</button>
              <button id="captionCancelBtn" className="caption-cancel-btn hidden" type="button">Stop Transcription</button>
              <button id="captionEraseBtn" className="accent-btn hidden" type="button" style={{"background": "linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(185, 28, 28, 0.15))", "border": "1px solid rgba(239, 68, 68, 0.4)", "color": "#fca5a5"}}>🧹 Erase Captions</button>
              <button id="captionPreviewBtn" className="ghost-btn hidden" type="button">Preview 5s</button>
              <button id="captionExportBtn" className="accent-btn hidden" type="button">Export Result</button>
              <button id="captionViralShortBtn" className="primary-btn hidden" type="button" style={{"background": "#f90"}}>✂️
                Export 15s Viral Short</button>
              <button id="captionResetBtn" className="ghost-btn hidden" type="button">Clear Video</button>
            </div>


            <div className="display-style-card caption-options-scroll"
              style={{"marginTop": "1rem", "padding": "12px", "borderRadius": "8px", "background": "rgba(0,0,0,0.1)"}}>
              <div style={{"display": "flex", "justifyContent": "space-between", "alignItems": "center", "marginBottom": "8px"}}>
                <label className="field-label" style={{"margin": "0"}}>Advanced Caption Engine Theme</label>
              </div>

              <div
                style={{"marginBottom": "12px", "background": "rgba(255,255,255,0.05)", "padding": "8px", "borderRadius": "4px", "display": "flex", "flexDirection": "column", "gap": "8px"}}>
                <div style={{"display": "flex", "alignItems": "center", "gap": "8px"}}>
                  <input type="checkbox" id="captionTranslateCheck" style={{"width": "18px", "height": "18px"}} />
                  <label htmlFor="captionTranslateCheck"
                    style={{"fontWeight": "bold", "color": "#fff", "cursor": "pointer", "flexGrow": "1"}}>🌍 Auto-Translate Audio To
                    English</label>
                  <p className="upload-copy" style={{"margin": "0"}}>(Checks Before Generation)</p>
                </div>
                <div style={{"display": "flex", "alignItems": "center", "gap": "8px"}}>
                  <input type="checkbox" id="captionEmojiCheck" style={{"width": "18px", "height": "18px"}} defaultChecked />
                  <label htmlFor="captionEmojiCheck"
                    style={{"fontWeight": "bold", "color": "#fff", "cursor": "pointer", "flexGrow": "1"}}>🪄 Inject Smart
                    Pop-Emojis</label>
                  <p className="upload-copy" style={{"margin": "0"}}>(Dynamic Reaction SVGs)</p>
                </div>
                <div style={{"display": "flex", "alignItems": "center", "gap": "8px"}}>
                  <input type="checkbox" id="captionKaraokeCheck" style={{"width": "18px", "height": "18px"}} defaultChecked />
                  <label htmlFor="captionKaraokeCheck"
                    style={{"fontWeight": "bold", "color": "#fff", "cursor": "pointer", "flexGrow": "1"}}>🎤 TikTok Karaoke
                    Highlight</label>
                  <p className="upload-copy" style={{"margin": "0"}}>(Auto-Sync Word Colors)</p>
                </div>
                <div style={{"display": "flex", "alignItems": "center", "gap": "8px"}}>
                  <input type="checkbox" id="captionBrollCheck" style={{"width": "18px", "height": "18px"}} />
                  <label htmlFor="captionBrollCheck"
                    style={{"fontWeight": "bold", "color": "#fff", "cursor": "pointer", "flexGrow": "1"}}>🎬 Auto B-Roll
                    Interstitials</label>
                  <p className="upload-copy" style={{"margin": "0"}}>(Flash Stock Photos on matched words)</p>
                </div>
                <div style={{"display": "flex", "alignItems": "center", "gap": "8px"}}>
                  <input type="checkbox" id="captionSfxCheck" style={{"width": "18px", "height": "18px"}} />
                  <label htmlFor="captionSfxCheck" style={{"fontWeight": "bold", "color": "#fff", "cursor": "pointer", "flexGrow": "1"}}>🔊
                    Reactive Sound Effects</label>
                  <p className="upload-copy" style={{"margin": "0"}}>(Triggers Whoosh/Pop SFX randomly on focus)</p>
                </div>
                <div style={{"display": "flex", "alignItems": "center", "gap": "8px"}}>
                  <input type="checkbox" id="captionProgressBarCheck" style={{"width": "18px", "height": "18px"}} />
                  <label htmlFor="captionProgressBarCheck"
                    style={{"fontWeight": "bold", "color": "#fff", "cursor": "pointer", "flexGrow": "1"}}>⏱️ Viewer Retention Progress
                    Bar</label>
                  <p className="upload-copy" style={{"margin": "0"}}>(Draws playhead filling screen bottom)</p>
                </div>
                <div style={{"display": "flex", "alignItems": "center", "gap": "8px", "marginTop": "4px"}}>
                  <input type="checkbox" id="captionBgMusicCheck" style={{"width": "18px", "height": "18px"}} defaultChecked />
                  <label htmlFor="bgMusicInput" style={{"fontWeight": "bold", "color": "#fff", "cursor": "pointer"}}>🎵 Smart Audio
                    Ducking Track:</label>
                  <input type="file" id="bgMusicInput" accept="audio/*" style={{"fontSize": "0.8rem", "color": "#ccc"}} />
                  <audio id="bgMusicAudio" loop crossOrigin="anonymous"></audio>
                </div>
                <div style={{"display": "flex", "alignItems": "center", "gap": "8px", "marginTop": "4px"}}>
                  <input type="checkbox" id="captionWatermarkCheck" style={{"width": "18px", "height": "18px"}} defaultChecked />
                  <label htmlFor="captionWatermarkInput" style={{"fontWeight": "bold", "color": "#fff", "cursor": "pointer"}}>🛡️ Brand
                    Watermark Overlay (PNG):</label>
                  <input type="file" id="captionWatermarkInput" accept="image/png, image/jpeg"
                    style={{"fontSize": "0.8rem", "color": "#ccc"}} />
                </div>
              </div>

              <div style={{"display": "flex", "gap": "10px", "marginBottom": "12px"}}>
                <div style={{"flex": "1"}}>
                  <span className="style-label" style={{"color": "#aaa"}}>Visual Master Theme</span>
                  <select id="captionStyleSelect" className="theme-select text-style-select" style={{"marginTop": "4px"}} defaultValue="white-yellow">
                    <option value="white-yellow">White + Yellow (Bold & Outline)</option>
                    <option value="tiktok">Viral Pop (Bold & Shadow)</option>
                    <option value="classic">Classic TV (White & Black Box)</option>
                    <option value="cinematic">Cinematic Fade (Clean White)</option>
                    <option value="neon">Cyberpunk Neon (Intense Glow)</option>
                    <option value="glitch">Digital Glitch (RGB Tremor)</option>
                    <option value="typewriter">Typewriter (Sequential Reveal)</option>
                    <option value="vaporwave">Vaporwave (Trailing Pink/Blue)</option>
                    <option value="retro">Arcade Retro (Blocky & Snappy)</option>
                  </select>
                </div>
                <div style={{"flex": "1"}}>
                  <span className="style-label" style={{"color": "#aaa"}}>Background Video Filter</span>
                  <select id="captionFilterSelect" className="theme-select text-style-select" style={{"marginTop": "4px"}} defaultValue="none">
                    <option value="none">None (Raw Input)</option>
                    <option value="darken">Darken 50% (Makes Text Pop)</option>
                    <option value="blur">Heavy Depth Blur</option>
                    <option value="grayscale">Black & White Grayscale</option>
                    <option value="sepia">Vintage Sepia Tone</option>
                    <option value="invert">Inverted Nightmare Mode</option>
                  </select>
                </div>
                <div style={{"flex": "1"}}>
                  <span className="style-label" style={{"color": "#aaa"}}>Font Typography</span>
                  <select id="captionFontSelect" className="theme-select text-style-select" style={{"marginTop": "4px"}} defaultValue="Nunito, sans-serif">
                    <option value="Nunito, sans-serif">Modern (Nunito)</option>
                    <option value="Impact, sans-serif">Bold Heavy (Impact)</option>
                    <option value="'Courier New', monospace">Mechanical (Courier)</option>
                    <option value="'Comic Sans MS', cursive">Playful (Comic)</option>
                    <option value="Georgia, serif">Elegant (Georgia)</option>
                  </select>
                </div>
              </div>

              <div className="display-style-grid"
                style={{"gap": "8px", "marginBottom": "12px", "display": "grid", "gridTemplateColumns": "1fr 1fr"}}>
                <label className="style-field">
                  <div style={{"display": "flex", "justifyContent": "space-between", "alignItems": "center", "gap": "8px"}}>
                    <span className="style-label">Caption Font Size</span>
                    <span id="captionSizeValue" className="style-label" style={{"color": "#facc15", "fontWeight": "900"}}>43% · 50px</span>
                  </div>
                  <input type="range" id="captionSizeSlider" min="20" max="90" defaultValue="50" />
                </label>
                <label className="style-field">
                  <div style={{"display": "flex", "justifyContent": "space-between", "alignItems": "center", "gap": "8px"}}>
                    <span className="style-label">Line Spacing Gap</span>
                    <span id="captionGapValue" className="style-label" style={{"color": "#facc15", "fontWeight": "900"}}>33% · 120</span>
                  </div>
                  <input type="range" id="captionGapSlider" min="80" max="200" defaultValue="120" />
                </label>
                <label className="style-field">
                  <div style={{"display": "flex", "justifyContent": "space-between", "alignItems": "center", "gap": "8px"}}>
                    <span className="style-label">Max Width Bound</span>
                    <span id="captionWidthValue" className="style-label" style={{"color": "#facc15", "fontWeight": "900"}}>85%</span>
                  </div>
                  <input type="range" id="captionWidthSlider" min="30" max="95" defaultValue="85" />
                </label>
                <label className="style-field">
                  <div style={{"display": "flex", "justifyContent": "space-between", "alignItems": "center"}}>
                    <span className="style-label" style={{"color": "#ffcc00", "fontWeight": "bold"}}>Sync Offset</span>
                    <span id="captionSyncNum"
                      style={{"color": "#ffcc00", "fontSize": "0.8rem", "fontFamily": "monospace"}}>50% · 0.0s</span>
                  </div>
                  <input type="range" id="captionSyncSlider" min="-15000" max="15000" step="100" defaultValue="0"
                     />
                </label>
                <label className="style-field">
                  <div style={{"display": "flex", "justifyContent": "space-between", "alignItems": "center", "gap": "8px"}}>
                    <span className="style-label">Stroke Thickness</span>
                    <span id="captionStrokeValue" className="style-label" style={{"color": "#facc15", "fontWeight": "900"}}>0%</span>
                  </div>
                  <input type="range" id="captionStrokeSlider" min="0" max="100" defaultValue="0" />
                </label>
              </div>

              <div style={{"display": "flex", "gap": "10px", "alignItems": "center"}}>
                <span className="style-label" style={{"color": "#aaa"}}>Extracted Text Color:</span>
                <input type="color" id="captionColorPicker" defaultValue="#fde047"
                  style={{"border": "none", "cursor": "pointer", "background": "none", "height": "30px", "width": "40px"}} />
                <p className="upload-copy" style={{"margin": "0", "marginLeft": "auto"}}><strong>Position:</strong> Click & drag
                  video to move captions!</p>
              </div>
            </div>

            <div id="captionProgress" className="progress-indicator hidden" role="status" style={{"marginTop": "1rem", "width": "100%"}}>
              <p id="captionStatusText" className="upload-copy" style={{"marginBottom": "8px"}}>Ready.</p>
              <div style={{"height": "8px", "width": "100%", "background": "var(--surface-soft)", "borderRadius": "4px", "overflow": "hidden"}}>
                  <div id="captionProgressBarValue" style={{"height": "100%", "width": "0%", "background": "var(--accent-a)", "transition": "width 0.3s ease"}}></div>
              </div>
            </div>
            <div id="captionExportActions" className="hidden" style={{"marginTop": "10px", "display": "flex", "gap": "8px", "flexWrap": "wrap"}}></div>

            <div id="captionVideoContainer" className="hidden"
              style={{"marginTop": "1.5rem", "borderRadius": "8px", "overflow": "hidden", "background": "#000", "position": "relative"}}>
              <canvas id="captionRenderCanvas" style={{"width": "100%", "height": "auto", "display": "block"}}></canvas>

              <div className="toolbar toolbar-compact" id="captionVideoControls"
                style={{"background": "rgba(0,0,0,0.6)", "padding": "8px", "display": "flex", "alignItems": "center", "justifyContent": "space-between"}}>
                <button id="captionPlayPauseBtn" className="ghost-btn" type="button"
                  style={{"color": "white", "borderColor": "rgba(255,255,255,0.2)"}}>⏸️ Pause</button>
                <input type="range" id="captionSeekSlider" style={{"flexGrow": "1", "margin": "0 1rem"}} min="0" max="100"
                  defaultValue="0" />
                <span id="captionTimeDisplay" style={{"color": "#ddd", "fontFamily": "monospace", "fontSize": "0.9rem"}}>00:00 /
                  00:00</span>
              </div>
              <video id="captionSourceVideo" hidden playsInline crossOrigin="anonymous"></video>
            </div>

            <div id="captionEditorPanel" className="tool-card hidden" style={{"marginTop": "1rem"}}>
              <div className="tool-card-head">
                <span className="module-icon">EDT</span>
                <p className="tool-card-title">Edit Auto-Captions</p>
              </div>
              <p className="upload-copy">If the AI missed a word, correct it below and it will instantly update on the video.
              </p>
              <div id="captionList" style={{"maxHeight": "250px", "overflowY": "auto", "paddingRight": "8px"}}></div>
            </div>
          </div>
        </div>
      </details>

      <details className="section-card" id="mediaSection">
        <summary className="section-summary">
          <span className="summary-head">
            <span className="section-icon">IMG</span>
            <span className="summary-copy">
              <span className="section-title">Optional Media</span>
              <span className="section-meta">Upload images and manage multiple stage videos
                for the blue screen.</span>
            </span>
          </span>
        </summary>
        <div className="section-content">
          <div className="upload-block">
            <label className="field-label">Pro Capabilities (Automated Cinematic Overlays)</label>
            <p className="upload-copy">Enable or disable the advanced dynamic rendering features applied to your exported
              videos.</p>
            <label className="toggle-check" htmlFor="proCaptionsEnabled">
              <input id="proCaptionsEnabled" type="checkbox" defaultChecked />
              <span>Enable TikTok-Style Animated Captions</span>
            </label>
            <label className="toggle-check" htmlFor="proAnimationsEnabled">
              <input id="proAnimationsEnabled" type="checkbox" defaultChecked />
              <span>Enable Auto-Math &amp; Interactive Screen Scanning Animations</span>
            </label>
            <label className="toggle-check" htmlFor="proQuizEnabled">
              <input id="proQuizEnabled" type="checkbox" defaultChecked />
              <span>Enable Auto-Quiz Popups</span>
            </label>
            <label className="toggle-check" htmlFor="proDuckingEnabled">
              <input id="proDuckingEnabled" type="checkbox" defaultChecked />
              <span>Enable Audio Ducking (Lower music volume when Anjali speaks)</span>
            </label>

            {/* ── Intro Clip Enable / Disable ── */}
            <label className="toggle-check" htmlFor="introClipEnabled" style={{marginTop:'10px'}}>
              <input id="introClipEnabled" type="checkbox" defaultChecked />
              <span>🎬 Play Intro Clip Before Every Lesson</span>
            </label>
            <p className="upload-copy" id="introClipStatus" style={{fontSize:'0.78rem', marginTop:'2px'}}>
              Intro clip will play before the lesson when available.
            </p>

            {/* ── Intro Poster Upload ── */}
            <div style={{marginTop:'10px'}}>
              <label className="field-label" style={{marginBottom:'4px'}}>Intro Poster Image (Optional)</label>
              <p className="upload-copy" style={{marginBottom:'6px'}}>Upload a full-screen image to show before the lesson starts. Works independently of the intro clip.</p>
              <div className="toolbar toolbar-compact">
                <button id="introPosterUploadBtn" className="ghost-btn" type="button">Upload Poster Image</button>
              </div>
              <input id="introPosterInput" type="file" accept="image/*" style={{display:'none'}} />
              <p className="upload-copy" id="introPosterStatus" style={{marginTop:'4px'}}>No poster uploaded.</p>
            </div>
          </div>


          <div className="media-upload-grid">
            <div className="upload-block">
              <label className="field-label" htmlFor="imageInput">Upload Multiple Images</label>
              <p className="upload-copy">Upload up to 12 images. Each image card on this input screen includes `Remove BG`,
                `Restore`, and `Show Here` actions so you can prepare it before presenting.</p>
              <input id="imageInput" className="image-input" type="file" accept="image/*" multiple />
              <p id="imageCutoutStatus" className="upload-copy">Smart cutout is ready for new image uploads.</p>
              <div id="imagePreviewList" className="image-preview-list hidden" aria-live="polite"></div>
            </div>
            <div className="upload-block">
              <label className="field-label" htmlFor="videoInput">Upload Stage Videos</label>
              <p className="upload-copy">Upload multiple videos for the blue screen. Each video card on this input screen
                includes `Remove BG`, `Restore`, and `Show On Screen` actions. Exports use the normal stage video view.</p>
              <input id="videoInput" className="image-input" type="file" accept="video/*" multiple />
              <div className="toolbar toolbar-compact">
                <button id="clearVideoBtn" className="ghost-btn" type="button">Clear Videos</button>
              </div>
              <video id="videoPreview" className="audio-preview hidden" controls preload="metadata" muted
                playsInline></video>
              <div id="videoPreviewList" className="image-preview-list hidden" aria-live="polite"></div>
              <p id="videoStatus" className="upload-copy">No stage video selected.</p>
            </div>
          </div>

          <div className="upload-block cutout-controls-card">
            <label className="field-label" htmlFor="cutoutToleranceInput">Smart Cutout Match</label>
            <p className="upload-copy">Tune background removal for both images and videos so the edges sit better on the
              blue screen. Lower values protect subjects more. Higher values remove more background.</p>
            <div className="cutout-control-grid">
              <label className="cutout-control" htmlFor="cutoutToleranceInput">
                <span className="cutout-control-head">
                  <span>Tolerance</span>
                  <strong id="cutoutToleranceValue">66</strong>
                </span>
                <input id="cutoutToleranceInput" type="range" min="20" max="110" step="1" defaultValue="66" />
                <small>How aggressively the remover follows the background color.</small>
              </label>
              <label className="cutout-control" htmlFor="cutoutFeatherInput">
                <span className="cutout-control-head">
                  <span>Feather</span>
                  <strong id="cutoutFeatherValue">22</strong>
                </span>
                <input id="cutoutFeatherInput" type="range" min="4" max="48" step="1" defaultValue="22" />
                <small>Softens the edge after removing the background.</small>
              </label>
              <label className="cutout-control" htmlFor="cutoutSpillInput">
                <span className="cutout-control-head">
                  <span>Spill Cleanup</span>
                  <strong id="cutoutSpillValue">35</strong>
                </span>
                <input id="cutoutSpillInput" type="range" min="0" max="100" step="1" defaultValue="35" />
                <small>Pulls green spill away from the subject edge.</small>
              </label>
              <label className="cutout-control" htmlFor="cutoutScreenBlendInput">
                <span className="cutout-control-head">
                  <span>Screen Match</span>
                  <strong id="cutoutScreenBlendValue">28</strong>
                </span>
                <input id="cutoutScreenBlendInput" type="range" min="0" max="100" step="1" defaultValue="28" />
                <small>Adds a soft blue-screen blend so the media matches the stage better.</small>
              </label>
            </div>
            <p id="cutoutControlsStatus" className="upload-copy">These controls apply to both image and video background
              removal.</p>
          </div>
        </div>
      </details>

      <details className="section-card" id="narrationSection">
        <summary className="section-summary">
          <span className="summary-head">
            <span className="section-icon">REC</span>
            <span className="summary-copy">
              <span className="section-title">Narration Audio</span>
              <span className="section-meta">Upload, record, or generate Anjali narration.</span>
            </span>
          </span>
        </summary>
        <div className="section-content">
          <div className="upload-block">
            <label className="field-label" htmlFor="audioInput">Optional narration audio</label>
            <p className="upload-copy">You can skip this. Upload audio or record narration here if you want the downloaded
              video to include sound.</p>
            <input id="audioInput" className="image-input" type="file" accept="audio/*" />
            <div className="toolbar toolbar-compact">
              <button id="recordBtn" className="primary-btn" type="button">Record Narration</button>
              <button id="stopRecordBtn" className="ghost-btn" type="button" disabled>Stop Recording</button>
              <button id="clearAudioBtn" className="ghost-btn" type="button">Clear Audio</button>
            </div>
            <audio id="audioPreview" className="audio-preview hidden" controls preload="metadata"></audio>
            <p className="upload-copy" id="audioStatus">No narration audio selected.</p>
            <div className="toolbar toolbar-compact">
              <button id="loadAnjaliNarrationBtn" className="primary-btn" type="button">Generate Narration</button>
              <button id="downloadAnjaliBtn" className="ghost-btn" type="button">Download Narration</button>
            </div>
            <div id="narrationLiveIndicator" className="progress-indicator narration-live-indicator hidden" role="status"
              aria-live="polite">
              <div className="progress-track">
                <span id="narrationLiveProgressFill" className="progress-fill narration-live-progress-fill"></span>
              </div>
              <p className="upload-copy narration-live-progress-label" id="narrationLiveProgressLabel">Narration is
                preparing...</p>
            </div>
            <p className="upload-copy" id="narrationGenStatus">Enter text, then generate narration directly into the
              app or download the narration file.</p>
          </div>
        </div>
      </details>

    </section>

    </>
  );
}

export default InputPanel;
