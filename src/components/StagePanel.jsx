import React, { useRef, useEffect, useState } from "react";
import { useStore } from "../store/useStore";

function StagePanel() {
  const canvasRef = useRef(null);
  const stageFrameRef = useRef(null);
  const logoGestureRef = useRef(null);
  const actionLocks = useStore((state) => state.actionLocks);
  const [isExporting, setIsExporting] = useState(false);
  const [logoBox, setLogoBox] = useState(() => {
    const bottomRightDefault = { x: 82, y: 89, w: 16 };
    try {
      const layoutVersion = localStorage.getItem("stage-info-kids-logo-layout-version");
      if (layoutVersion !== "single-bottom-right-v2") {
        localStorage.setItem("stage-info-kids-logo-layout-version", "single-bottom-right-v2");
        return bottomRightDefault;
      }
      const saved = JSON.parse(localStorage.getItem("stage-info-kids-logo-box") || "null");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.w)) {
        return {
          x: Math.min(94, Math.max(0, saved.x)),
          y: Math.min(92, Math.max(0, saved.y)),
          w: Math.min(38, Math.max(10, saved.w))
        };
      }
    } catch {
      // Ignore invalid saved placement.
    }
    return bottomRightDefault;
  });

  // Poll export status every 500 ms
  useEffect(() => {
    const id = setInterval(() => {
      setIsExporting(typeof window.ppIsExporting === 'function' ? window.ppIsExporting() : false);
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#173e58';
      ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("stage-info-kids-logo-box", JSON.stringify(logoBox));
    } catch {
      // Placement persistence is helpful but not required.
    }
  }, [logoBox]);

  const clampLogoBox = (box) => {
    const w = Math.min(38, Math.max(10, Number(box.w) || 15));
    // The logo is approximately 3:1. Convert its CSS width percentage into
    // stage-height percentage so resizing can never push it below the frame.
    const heightPercent = w * (16 / 9) / 3;
    return {
      w,
      x: Math.min(100 - w, Math.max(0, Number(box.x) || 0)),
      y: Math.min(100 - heightPercent, Math.max(0, Number(box.y) || 0))
    };
  };

  const beginLogoGesture = (event, mode) => {
    const frame = stageFrameRef.current;
    if (!frame) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const rect = frame.getBoundingClientRect();
    logoGestureRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      frameWidth: Math.max(1, rect.width),
      frameHeight: Math.max(1, rect.height),
      startBox: logoBox
    };
  };

  const updateLogoGesture = (event) => {
    const gesture = logoGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    const dxPct = ((event.clientX - gesture.startX) / gesture.frameWidth) * 100;
    const dyPct = ((event.clientY - gesture.startY) / gesture.frameHeight) * 100;

    if (gesture.mode === "resize") {
      const nextW = gesture.startBox.w + dxPct;
      setLogoBox(clampLogoBox({ ...gesture.startBox, w: nextW }));
      return;
    }

    setLogoBox(clampLogoBox({
      ...gesture.startBox,
      x: gesture.startBox.x + dxPct,
      y: gesture.startBox.y + dyPct
    }));
  };

  const endLogoGesture = (event) => {
    if (logoGestureRef.current?.pointerId === event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      logoGestureRef.current = null;
    }
  };

  return (
    <section className="panel panel-stage hidden" id="stagePanel">
      <div className="stage-actions">
        <details className="stage-toolbar-group stage-toolbar-primary stage-toolbar-card">
          <summary className="stage-toolbar-head stage-toolbar-summary">
            <div>
              <p className="stage-toolbar-label">Playback</p>
              <p className="stage-toolbar-meta">Open, play, stop, and add slide images</p>
            </div>
            <span className="stage-toolbar-badge">PLAY</span>
          </summary>
          <div className="stage-toolbar-body">
            <div className="stage-toolbar-buttons stage-toolbar-buttons-compact">
              <button id="editBtn" className="ghost-btn stage-icon-btn" type="button" aria-label="Back to input"
                title="Back to input"><span aria-hidden="true">&larr;</span></button>
              <button id="playBtn" className="primary-btn stage-icon-btn stage-icon-btn-primary" type="button"
                aria-label="Play slide" title="Play slide"><span aria-hidden="true">&#9654;</span></button>
              <span id="playbackPercentIndicator" className="control-indicator playback-percent-indicator"
                title="Playback progress" aria-live="polite">0%</span>
              <button id="pauseStageBtn" className="ghost-btn stage-icon-btn hidden" type="button" disabled
                aria-label="Pause" title="Pause"><span aria-hidden="true">&#10074;&#10074;</span></button>
              <button id="stopStageBtn" className="ghost-btn stage-icon-btn" type="button" aria-label="Stop"
                title="Stop"><span aria-hidden="true">&#9632;</span></button>
              <button id="stageImageUploadBtn" className="ghost-btn stage-icon-btn" type="button" aria-label="Upload images"
                title="Upload images"><span aria-hidden="true">IMG</span></button>
              <button id="stageVideoUploadBtn" className="ghost-btn stage-icon-btn" type="button" aria-label="Upload video"
                title="Upload video"><span aria-hidden="true">VID</span></button>
            </div>
            <div className="stage-playback-controls">
              <label className="stage-speed-field stage-speed-field-inline" htmlFor="stagePlaybackSpeedSelect">
                <span className="style-label">Screen Speed</span>
                <select id="stagePlaybackSpeedSelect" className="theme-select text-style-select stage-speed-select"
                  aria-label="Choose screen playback speed" defaultValue="1">
                  <option value="0.5">0.5x</option>
                  <option value="0.75">0.75x</option>
                  <option value="0.85">0.85x</option>
                  <option value="0.9">0.9x</option>
                  <option value="1">1x</option>
                  <option value="1.5">1.5x</option>
                  <option value="2">2x</option>
                  <option value="2.5">2.5x</option>
                </select>
              </label>
              <p className="stage-speed-copy">Slows narration only. Anjali pitch stays natural.</p>
            </div>
            <div className="stage-media-tools" aria-label="Stage media tools">
              <button id="stageImageCutoutBtn" className="ghost-btn stage-icon-btn" type="button" disabled
                aria-label="Remove image background" title="Remove image background"><span
                  aria-hidden="true">IMG-</span></button>
              <button id="stageImageRestoreBtn" className="ghost-btn stage-icon-btn" type="button" disabled
                aria-label="Restore image" title="Restore image"><span aria-hidden="true">IMG+</span></button>
              <button id="stageVideoCutoutBtn" className="ghost-btn stage-icon-btn" type="button" disabled
                aria-label="Remove video background" title="Remove video background"><span
                  aria-hidden="true">VID-</span></button>
              <button id="stageVideoRestoreBtn" className="ghost-btn stage-icon-btn" type="button" disabled
                aria-label="Restore video" title="Restore video"><span aria-hidden="true">VID+</span></button>
            </div>
          </div>
        </details>

        <details className="stage-toolbar-group stage-toolbar-card">
          <summary className="stage-toolbar-head stage-toolbar-summary">
            <div>
              <p className="stage-toolbar-label">Pages</p>
              <p className="stage-toolbar-meta">Move through the full presentation</p>
            </div>
            <span className="stage-toolbar-badge">NAV</span>
          </summary>
          <div className="stage-toolbar-body">
            <div className="stage-page-actions" aria-label="Stage page navigation">
              <button id="prevPageBtn" className="ghost-btn stage-icon-btn" type="button" aria-label="Previous page"
                title="Previous page"><span aria-hidden="true">&#8249;</span></button>
              <span id="pageIndicator" className="page-indicator">Page 1 / 1</span>
              <button id="nextPageBtn" className="ghost-btn stage-icon-btn" type="button" aria-label="Next page"
                title="Next page"><span aria-hidden="true">&#8250;</span></button>
            </div>
          </div>
        </details>

        <details className="stage-toolbar-group stage-toolbar-card">
          <summary className="stage-toolbar-head stage-toolbar-summary">
            <div>
              <p className="stage-toolbar-label">Intro &amp; Poster</p>
              <p className="stage-toolbar-meta">Optional: intro clip and/or poster image before the lesson</p>
            </div>
            <span className="stage-toolbar-badge">INT</span>
          </summary>
          <div className="stage-toolbar-body">
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "4px 8px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }} htmlFor="introClipEnabled">
                <input id="introClipEnabled" type="checkbox" style={{ width: "16px", height: "16px" }} />
                <span style={{ fontSize: "0.75rem", color: "#fff", fontWeight: "600" }}>Play Intro Clip (optional)</span>
              </label>
              <p id="introClipStatus" className="stage-toolbar-meta" style={{ margin: 0 }}>
                Unchecked — intro will be skipped. The lesson starts directly.
              </p>
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: "8px", marginTop: "2px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <button id="introPosterUploadBtn" className="ghost-btn stage-icon-btn" type="button" aria-label="Upload poster image" title="Upload poster image (shown before lesson, no intro needed)">
                    <span aria-hidden="true">POST</span>
                  </button>
                  <input id="introPosterInput" type="file" accept="image/*" hidden />
                  <span style={{ fontSize: "0.75rem", color: "#ccc", fontWeight: "500" }}>Add Poster (optional, independent of intro)</span>
                </div>
                <p id="introPosterStatus" className="stage-toolbar-meta" style={{ margin: "6px 0 0 0" }}>
                  No poster selected. Upload an image to show it full-screen before the lesson.
                </p>
              </div>
            </div>
          </div>
        </details>

        
        <details className="stage-toolbar-group stage-toolbar-card">
          <summary className="stage-toolbar-head stage-toolbar-summary">
            <div>
              <p className="stage-toolbar-label">Visuals</p>
              <p className="stage-toolbar-meta">Toggle Anjali avatar and InfoKids logo</p>
            </div>
            <span className="stage-toolbar-badge">VIS</span>
          </summary>
          <div className="stage-toolbar-body">
            <div style={{"display": "flex", "flexDirection": "column", "gap": "8px", "padding": "4px 8px"}}>
              <label style={{"display": "flex", "alignItems": "center", "gap": "8px", "cursor": "pointer"}}>
                <input type="checkbox" id="avatarEnableCheck" defaultChecked style={{"width": "16px", "height": "16px"}} />
                <span style={{"fontSize": "0.75rem", "color": "#fff", "fontWeight": "600"}}>Show Anjali Avatar</span>
              </label>
              <label style={{"display": "flex", "alignItems": "center", "gap": "8px", "cursor": "pointer"}}>
                <input type="checkbox" id="logoEnableCheck" defaultChecked style={{"width": "16px", "height": "16px"}} />
                <span style={{"fontSize": "0.75rem", "color": "#fff", "fontWeight": "600"}}>Show InfoKids Logo</span>
              </label>
              <label style={{"display": "flex", "flexDirection": "column", "gap": "4px", "marginTop": "10px"}}>
                <span style={{"fontSize": "0.75rem", "color": "#fff", "fontWeight": "600"}}>Anjali Video Speed</span>
                <input type="range" id="avatarSpeedRange" min="0.5" max="4.0" step="0.1" defaultValue="2.5" style={{"width": "100%"}} />
                <span id="avatarSpeedLabel" style={{"fontSize": "0.75rem", "color": "#fff", "fontWeight": "600", "alignSelf": "flex-end"}}>2.5x</span>
              </label>
            </div>
              <div style={{"marginTop": "12px", "borderTop": "1px solid rgba(255,255,255,0.1)", "paddingTop": "8px"}}>
                <p style={{"fontSize": "0.75rem", "color": "#fff", "marginBottom": "8px"}}>Lip-Sync Calibration</p>
                <label style={{"display": "flex", "alignItems": "center", "gap": "8px", "cursor": "pointer", "marginBottom": "6px"}}>
                  <input type="checkbox" id="showJawDebugCheck" />
                  <span style={{"fontSize": "0.75rem", "fontWeight": "600", "color": "#5cb85c"}}>Show Target Guide</span>
                </label>
                <label style={{"display": "flex", "flexDirection": "column", "gap": "4px", "marginBottom": "6px"}}>
                  <span style={{"fontSize": "0.75rem", "color": "#fff"}}>Mouth X (%)</span>
                  <input type="range" id="avatarJawXRange" min="0" max="100" step="0.5" defaultValue="28.5" />
                </label>
                <label style={{"display": "flex", "flexDirection": "column", "gap": "4px", "marginBottom": "6px"}}>
                  <span style={{"fontSize": "0.75rem", "color": "#fff"}}>Mouth Y (%)</span>
                  <input type="range" id="avatarJawYRange" min="0" max="100" step="0.2" defaultValue="16.5" />
                </label>
                <label style={{"display": "flex", "flexDirection": "column", "gap": "4px", "marginBottom": "6px"}}>
                  <span style={{"fontSize": "0.75rem", "color": "#fff"}}>Mouth Width (%)</span>
                  <input type="range" id="avatarJawWidthRange" min="0" max="15" step="0.2" defaultValue="4.5" />
                </label>
                <label style={{"display": "flex", "flexDirection": "column", "gap": "4px"}}>
                  <span style={{"fontSize": "0.75rem", "color": "#fff"}}>Mouth Height (%)</span>
                  <input type="range" id="avatarJawHeightRange" min="0" max="30" step="0.2" defaultValue="3.0" />
                </label>
              </div>
          </div>
        </details>

        {/* ── BACKGROUND MODULE ─────────────────────────────────────── */}
        <details className="stage-toolbar-group stage-toolbar-card" id="stageBackgroundCard">
          <summary className="stage-toolbar-head stage-toolbar-summary">
            <div>
              <p className="stage-toolbar-label">Background</p>
              <p className="stage-toolbar-meta">Change the presentation background instantly</p>
            </div>
            <span className="stage-toolbar-badge stage-bg-badge" id="stageBgBadge">BG</span>
          </summary>
          <div className="stage-toolbar-body">
            <label className="stage-speed-field stage-speed-field-inline" htmlFor="stageTemplateSelect">
              <span className="style-label">Screen Theme</span>
              <select id="stageTemplateSelect" className="theme-select text-style-select stage-template-select"
                aria-label="Choose presentation background theme">
                <option value="classic">🎓 Classic Stage</option>
                <option value="learning-outcomes">📋 Learning Outcomes</option>
                <option value="sunrise-classroom">🌅 Sunrise Classroom</option>
                <option value="galaxy-night">🌌 Galaxy Night</option>
                <option value="tropical-green">🌴 Tropical Garden</option>
                <option value="royal-purple">👑 Royal Stage</option>
                <option value="candy-pink">🍭 Candy Pop</option>
                <option value="neon-cyber">⚡ Neon City</option>
                <option value="golden-hour">✨ Golden Hour</option>
                <option value="ocean-waves">🌊 Ocean Waves</option>
                <option value="winter-snow">❄️ Winter Snow</option>
                <option value="cherry-blossom">🌸 Cherry Blossom</option>
                <option value="desert-dunes">🏜️ Desert Dunes</option>
                <option value="aurora-borealis">🌀 Aurora Borealis</option>
                <option value="lightning-storm">⚡ Lightning Storm</option>
                <option value="mountain-mist">🏔️ Mountain Mist</option>
                <option value="rainbow-garden">🌈 Rainbow Garden</option>
                <option value="playground-joy">🛝 Playground Joy</option>
              </select>
            </label>
            <label className="toggle-check" htmlFor="infoKidsTitleEnabled" style={{ marginTop: "10px" }}>
              <input id="infoKidsTitleEnabled" type="checkbox" defaultChecked />
              <span>Show centered INFO KIDS title on every theme</span>
            </label>
            <p className="stage-speed-copy" style={{ marginTop: "6px" }}>
              This is one global setting for preview and exported video. Enabled by default.
            </p>
            <p id="stageTemplateStatus" className="stage-speed-copy">Classic Stage active. Select a theme to change the background live.</p>
          </div>
        </details>

        <details className="stage-toolbar-group stage-toolbar-card">
          <summary className="stage-toolbar-head stage-toolbar-summary">
            <div>
              <p className="stage-toolbar-label">Media</p>
              <p className="stage-toolbar-meta">Manage uploaded images and videos from the presentation screen</p>
            </div>
            <span className="stage-toolbar-badge">MEDIA</span>
          </summary>
          <div className="stage-toolbar-body">
            <div className="stage-media-manager">
              <div className="stage-media-actions">
                <button id="stageAutoTeachBtn" className="flat-btn" type="button" title="Analyze image with local Vision AI"
                  style={{"marginRight": "8px"}}>✨ Auto-Teach</button>
                <button id="stageAutoBRollBtn" className="flat-btn" type="button"
                  title="Automatically fetch cinematic B-Roll based on the lesson script" style={{"marginRight": "8px"}}>🎬
                  Auto B-Roll</button>
                <button id="stageRemoveImageBtn" className="ghost-btn stage-icon-btn" type="button"
                  aria-label="Remove selected image" title="Remove selected image"><span
                    aria-hidden="true">IMGX</span></button>
                <button id="stageClearImagesBtn" className="ghost-btn stage-icon-btn" type="button"
                  aria-label="Remove all images" title="Remove all images"><span aria-hidden="true">ALL</span></button>
                <button id="stageRemoveVideoBtn" className="ghost-btn stage-icon-btn" type="button"
                  aria-label="Remove active video" title="Remove active video"><span
                    aria-hidden="true">VIDX</span></button>
              </div>
              <p id="stageMediaStatus" className="stage-toolbar-meta">Select an image or video on the screen, then manage it
                here.</p>
            </div>
          </div>
        </details>

        <details id="stageViewCard" className="stage-toolbar-group stage-toolbar-card">
          <summary className="stage-toolbar-head stage-toolbar-summary">
            <div>
              <p className="stage-toolbar-label">Zoom And Font</p>
              <p className="stage-toolbar-meta">Use Zoom +, Zoom -, Font +, and Font - on the presentation screen</p>
            </div>
            <span className="stage-toolbar-badge">VIEW</span>
          </summary>
          <div className="stage-toolbar-body">
            <div className="stage-view-actions" aria-label="Stage zoom and font controls">
              <button id="zoomOutBtn" className="ghost-btn stage-icon-btn" type="button" aria-label="Zoom out"
                title="Zoom out"><span aria-hidden="true">Z-</span></button>
              <span id="zoomValue" className="control-indicator">100%</span>
              <button id="zoomInBtn" className="ghost-btn stage-icon-btn" type="button" aria-label="Zoom in"
                title="Zoom in"><span aria-hidden="true">Z+</span></button>
              <button id="fontDecreaseBtn" className="ghost-btn stage-icon-btn" type="button" aria-label="Decrease font"
                title="Decrease font"><span aria-hidden="true">F-</span></button>
              <span id="fontValue" className="control-indicator">100%</span>
              <button id="fontIncreaseBtn" className="ghost-btn stage-icon-btn" type="button" aria-label="Increase font"
                title="Increase font"><span aria-hidden="true">F+</span></button>
            </div>
            <details style={{marginTop:"10px"}}>
              <summary style={{cursor:"pointer",fontSize:"0.78rem",fontWeight:700,color:"#fff"}}>Advanced Font &amp; Position</summary>
              <div style={{display:"grid",gap:"9px",padding:"10px 2px 2px"}}>
                <label className="stage-toolbar-meta">Font size — <span id="advancedFontSizeValue">100%</span><input id="advancedFontSize" type="range" min="60" max="220" step="5" defaultValue="100" style={{width:"100%"}} /></label>
                <label className="stage-toolbar-meta">Line spacing — <span id="advancedLineSpacingValue">100%</span><input id="advancedLineSpacing" type="range" min="65" max="200" step="5" defaultValue="100" style={{width:"100%"}} /></label>
                <label className="stage-toolbar-meta">Letter spacing — <span id="advancedLetterSpacingValue">0</span><input id="advancedLetterSpacing" type="range" min="-2" max="12" step="1" defaultValue="0" style={{width:"100%"}} /></label>
                <label className="stage-toolbar-meta">Horizontal position — <span id="advancedTextXValue">0</span><input id="advancedTextX" type="range" min="-200" max="200" step="10" defaultValue="0" style={{width:"100%"}} /></label>
                <label className="stage-toolbar-meta">Vertical position — <span id="advancedTextYValue">0</span><input id="advancedTextY" type="range" min="-160" max="240" step="10" defaultValue="0" style={{width:"100%"}} /></label>
                <button id="advancedTextReset" className="ghost-btn" type="button">Reset Font &amp; Position</button>
              </div>
            </details>
          </div>
        </details>



        {/* ── STYLES MODULE ─────────────────────────────────────────── */}
        <details className="stage-toolbar-group stage-toolbar-card stage-styles-card" id="stageStylesGroup">
          <summary className="stage-toolbar-head stage-toolbar-summary">
            <div>
              <p className="stage-toolbar-label">Styles</p>
              <p className="stage-toolbar-meta">Alignment, color and context style — change live on screen</p>
            </div>
            <span className="stage-toolbar-badge stage-styles-badge">STY</span>
          </summary>
          <div className="stage-toolbar-body stage-styles-body">

            {/* Alignment */}
            <p className="stage-styles-section-label">Alignment</p>
            <div className="stage-align-row" role="group" aria-label="Text alignment">
              <button id="stageAlignLeftBtn" className="stage-align-btn stage-align-active" type="button" aria-pressed="true" title="Left align">
                <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
                  <rect x="0" y="0" width="16" height="2" rx="1" fill="currentColor"/>
                  <rect x="0" y="5" width="11" height="2" rx="1" fill="currentColor" opacity="0.7"/>
                  <rect x="0" y="10" width="13" height="2" rx="1" fill="currentColor" opacity="0.5"/>
                </svg>
                Left
              </button>
              <button id="stageAlignCenterBtn" className="stage-align-btn" type="button" aria-pressed="false" title="Center align">
                <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
                  <rect x="0" y="0" width="16" height="2" rx="1" fill="currentColor"/>
                  <rect x="2.5" y="5" width="11" height="2" rx="1" fill="currentColor" opacity="0.7"/>
                  <rect x="1.5" y="10" width="13" height="2" rx="1" fill="currentColor" opacity="0.5"/>
                </svg>
                Center
              </button>
              <button id="stageAlignRightBtn" className="stage-align-btn" type="button" aria-pressed="false" title="Right align">
                <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
                  <rect x="0" y="0" width="16" height="2" rx="1" fill="currentColor"/>
                  <rect x="5" y="5" width="11" height="2" rx="1" fill="currentColor" opacity="0.7"/>
                  <rect x="3" y="10" width="13" height="2" rx="1" fill="currentColor" opacity="0.5"/>
                </svg>
                Right
              </button>
            </div>

            {/* Context Models */}
            <p className="stage-styles-section-label" style={{marginTop:"10px"}}>Context Model</p>
            <div className="stage-model-grid" role="group" aria-label="Context style models">

              <button id="stageModelClassicBtn" className="stage-model-btn stage-model-active" type="button" data-model="classic" title="Classic: left, white">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#083843,#0d5561)",color:"#fff",fontWeight:600}}>Aa</span>
                <span className="stage-model-name">Classic</span>
              </button>

              <button id="stageModelBoldCenterBtn" className="stage-model-btn" type="button" data-model="bold-center" title="Bold Center: centered, yellow, bold">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#1a0030,#2d0060)",color:"#facc15",fontWeight:900}}>Aa</span>
                <span className="stage-model-name">Bold C.</span>
              </button>

              <button id="stageModelHeadlineBtn" className="stage-model-btn" type="button" data-model="headline" title="Headline: centered, sky blue, caps">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#0c2a3e,#0d5c8a)",color:"#0d7ea9",fontWeight:800,fontSize:"0.7rem",letterSpacing:"0.04em"}}>AA</span>
                <span className="stage-model-name">Headline</span>
              </button>

              <button id="stageModelGlossaryBtn" className="stage-model-btn" type="button" data-model="glossary" title="Glossary: left, green, italic">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#0a1f12,#0d3822)",color:"#16a34a",fontStyle:"italic",fontWeight:600}}>Aa</span>
                <span className="stage-model-name">Glossary</span>
              </button>

              <button id="stageModelCompactBtn" className="stage-model-btn" type="button" data-model="compact" title="Compact: left, lowercase">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"rgba(20,30,48,0.9)",color:"rgba(255,255,255,0.75)",fontWeight:500,fontSize:"0.75rem"}}>aa</span>
                <span className="stage-model-name">Compact</span>
              </button>

              <button id="stageModelPosterBtn" className="stage-model-btn" type="button" data-model="poster" title="Poster: right, red, bold">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#1f0a0a,#3d1515)",color:"#dc2626",fontWeight:900,fontSize:"1.1rem"}}>A</span>
                <span className="stage-model-name">Poster</span>
              </button>

              <button id="stageModelNeonBtn" className="stage-model-btn" type="button" data-model="neon" title="Neon: center, fuchsia, bold">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#2d0040,#4a0070)",color:"#d946ef",fontWeight:800}}>Aa</span>
                <span className="stage-model-name">Neon</span>
              </button>

              <button id="stageModelChalkBtn" className="stage-model-btn" type="button" data-model="chalk" title="Chalk: left, cream">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#1a2a1a,#1e3a1e)",color:"#fef9c3",fontWeight:500}}>Aa</span>
                <span className="stage-model-name">Chalk</span>
              </button>

              <button id="stageModelSunriseBtn" className="stage-model-btn" type="button" data-model="sunrise" title="Sunrise: center, orange, title">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#3a1500,#5c2200)",color:"#f97316",fontWeight:700}}>Tt</span>
                <span className="stage-model-name">Sunrise</span>
              </button>

              <button id="stageModelOceanBtn" className="stage-model-btn" type="button" data-model="ocean" title="Ocean: left, cyan, italic">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#002233,#003d5c)",color:"#06b6d4",fontStyle:"italic",fontWeight:600}}>Aa</span>
                <span className="stage-model-name">Ocean</span>
              </button>

              <button id="stageModelRoyalBtn" className="stage-model-btn" type="button" data-model="royal" title="Royal: center, gold, title">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#1a1200,#2e2000)",color:"#fbbf24",fontWeight:800}}>Tt</span>
                <span className="stage-model-name">Royal</span>
              </button>

              <button id="stageModelFireBtn" className="stage-model-btn" type="button" data-model="fire" title="Fire: center, coral, uppercase">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#2a0808,#4a1010)",color:"#fb7185",fontWeight:900,fontSize:"0.75rem"}}>AA</span>
                <span className="stage-model-name">Fire</span>
              </button>

              <button id="stageModelForestBtn" className="stage-model-btn" type="button" data-model="forest" title="Forest: left, lime, title">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#0d1f00,#1a3600)",color:"#84cc16",fontWeight:700}}>Tt</span>
                <span className="stage-model-name">Forest</span>
              </button>

              <button id="stageModelNightBtn" className="stage-model-btn" type="button" data-model="night" title="Night: right, violet, italic">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#0d0020,#1a003a)",color:"#a78bfa",fontStyle:"italic",fontWeight:600}}>Aa</span>
                <span className="stage-model-name">Night</span>
              </button>

              <button id="stageModelCandyBtn" className="stage-model-btn" type="button" data-model="candy" title="Candy: center, pink, bold">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#2a0020,#400030)",color:"#ec4899",fontWeight:800}}>Aa</span>
                <span className="stage-model-name">Candy</span>
              </button>

              <button id="stageModelMatrixBtn" className="stage-model-btn" type="button" data-model="matrix" title="Matrix: left, lime, lower">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"#001000",color:"#84cc16",fontFamily:"monospace",fontWeight:600,fontSize:"0.72rem"}}>aa</span>
                <span className="stage-model-name">Matrix</span>
              </button>

              <button id="stageModelIceBtn" className="stage-model-btn" type="button" data-model="ice" title="Ice: center, mint, italic">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#002a28,#004a44)",color:"#6ee7b7",fontStyle:"italic",fontWeight:600}}>Aa</span>
                <span className="stage-model-name">Ice</span>
              </button>

              <button id="stageModelTealBtn" className="stage-model-btn" type="button" data-model="teal" title="Teal: left, teal, bold underline">
                <span className="stage-model-check">✓</span>
                <span className="stage-model-dot" style={{background:"linear-gradient(135deg,#00201e,#003a36)",color:"#14b8a6",fontWeight:800,textDecoration:"underline"}}>Aa</span>
                <span className="stage-model-name">Teal</span>
              </button>

            </div>

            {/* Font Weight */}
            <p className="stage-styles-section-label" style={{marginTop:"10px"}}>Weight</p>
            <div className="stage-align-row" role="group" aria-label="Font weight">
              <button id="stageWeightNormalBtn" className="stage-align-btn" type="button" aria-pressed="false" title="Normal weight" style={{fontWeight:400}}>Normal</button>
              <button id="stageWeightBoldBtn" className="stage-align-btn" type="button" aria-pressed="false" title="Bold" style={{fontWeight:700}}>Bold</button>
              <button id="stageWeightXBoldBtn" className="stage-align-btn" type="button" aria-pressed="false" title="Extra Bold" style={{fontWeight:900}}>X-Bold</button>
            </div>

            {/* Color Swatches */}
            <p className="stage-styles-section-label" style={{marginTop:"10px"}}>Color</p>
            <div className="stage-swatch-row" role="group" aria-label="Color presets" id="stageSwatchRow">
              <button className="stage-swatch stage-swatch-active" data-color="#ffffff" id="stageSwatchWhite" type="button" title="White"><span className="stage-swatch-dot" style={{background:"#ffffff"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#facc15" id="stageSwatchYellow" type="button" title="Yellow"><span className="stage-swatch-dot" style={{background:"#facc15"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#0d7ea9" id="stageSwatchSkyBlue" type="button" title="Sky Blue"><span className="stage-swatch-dot" style={{background:"#0d7ea9"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#16a34a" id="stageSwatchGreen" type="button" title="Green"><span className="stage-swatch-dot" style={{background:"#16a34a"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#dc2626" id="stageSwatchRed" type="button" title="Red"><span className="stage-swatch-dot" style={{background:"#dc2626"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#f97316" id="stageSwatchOrange" type="button" title="Orange"><span className="stage-swatch-dot" style={{background:"#f97316"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#a78bfa" id="stageSwatchViolet" type="button" title="Violet"><span className="stage-swatch-dot" style={{background:"#a78bfa"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#000000" id="stageSwatchBlack" type="button" title="Black"><span className="stage-swatch-dot" style={{background:"#000000",border:"1px solid rgba(255,255,255,0.2)"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#06b6d4" id="stageSwatchCyan" type="button" title="Cyan"><span className="stage-swatch-dot" style={{background:"#06b6d4"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#ec4899" id="stageSwatchPink" type="button" title="Pink"><span className="stage-swatch-dot" style={{background:"#ec4899"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#84cc16" id="stageSwatchLime" type="button" title="Lime"><span className="stage-swatch-dot" style={{background:"#84cc16"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#fbbf24" id="stageSwatchGold" type="button" title="Gold"><span className="stage-swatch-dot" style={{background:"#fbbf24"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#14b8a6" id="stageSwatchTeal" type="button" title="Teal"><span className="stage-swatch-dot" style={{background:"#14b8a6"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#fb7185" id="stageSwatchCoral" type="button" title="Coral"><span className="stage-swatch-dot" style={{background:"#fb7185"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#fef9c3" id="stageSwatchCream" type="button" title="Cream"><span className="stage-swatch-dot" style={{background:"#fef9c3",border:"1px solid rgba(255,255,255,0.15)"}}></span><span className="stage-swatch-check">✓</span></button>
              <button className="stage-swatch" data-color="#6ee7b7" id="stageSwatchMint" type="button" title="Mint"><span className="stage-swatch-dot" style={{background:"#6ee7b7"}}></span><span className="stage-swatch-check">✓</span></button>
            </div>

            <p id="stageStylesStatus" className="stage-toolbar-meta" style={{marginTop:"8px"}}>Classic style active. Tap a model or swatch to change instantly.</p>
          </div>
        </details>

        {/* ── VOICES MODULE ─────────────────────────────────────────── */}
        <details className="stage-toolbar-group stage-toolbar-card" id="stageVoicesCard">
          <summary className="stage-toolbar-head stage-toolbar-summary">
            <div>
              <p className="stage-toolbar-label">Voices</p>
              <p className="stage-toolbar-meta">Pick the narration voice for this session</p>
            </div>
            <span className="stage-toolbar-badge stage-voices-badge" id="stageVoiceBadge">Loading…</span>
          </summary>
          <div className="stage-toolbar-body stage-voices-body">

            {/* Pinned default voice row */}
            <div className="voice-default-row" id="voiceDefaultRow">
              <span className="voice-default-star">⭐</span>
              <span className="voice-default-name" id="voiceDefaultName">Neerja Expressive</span>
              <span className="voice-default-label">DEFAULT</span>
            </div>

            {/* Dropdown + preview row */}
            <div className="voice-select-row">
              <select id="stageVoiceSelect" className="stage-voice-select">
                <option disabled>Loading voices…</option>
              </select>
              <button id="stageVoicePreviewBtn" className="voice-preview-btn" type="button"
                title="Preview selected voice" aria-label="Preview voice">▶</button>
            </div>

            {/* Actions */}
            <div className="voice-action-row">
              <button id="stageVoiceUseBtn" className="voice-use-btn" type="button">✔ Use This Voice</button>
              <button id="stageVoiceDefaultBtn" className="voice-default-btn" type="button">⭐ Set as Default</button>
            </div>

            <p className="stage-voice-status" id="stageVoiceStatus">Choose a voice, preview it, then click Use.</p>
          </div>
        </details>

        <details className="stage-toolbar-group stage-toolbar-export stage-toolbar-card">
          <summary className="stage-toolbar-head stage-toolbar-summary">
            <div>
              <p className="stage-toolbar-label">Export And Format</p>
              <p className="stage-toolbar-meta">Export the video and keep the slide styled correctly</p>
            </div>
            <span className="stage-toolbar-badge">SAVE</span>
          </summary>
          <div className="stage-toolbar-body">
            <div className="stage-toolbar-buttons stage-toolbar-buttons-stack">
              <button id="downloadBtn" className="accent-btn stage-download-btn" type="button">&#8681; Export Video</button>
              <button id="downloadNarrationMp3Btn" className="ghost-btn stage-download-btn" type="button">Download MP3</button>
              <button id="stageCaptionExportBtn" className="primary-btn stage-download-btn" type="button"
                style={{"background": "#facc15", "color": "#000", "border": "none", "marginTop": "4px"}}>✨ Captions &amp; Export Video</button>

              <button id="downloadPdfContextBtn" className="primary-btn stage-download-btn hidden" type="button">&#8681;
                Export PDF Context</button>

              {/* Stop Export — visible only while exporting */}
              {isExporting && (
                <button
                  type="button"
                  onClick={() => typeof window.ppStopExport === 'function' && window.ppStopExport()}
                  style={{
                    marginTop: '8px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg,#ef4444,#b91c1c)',
                    color: '#fff',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    width: '100%',
                    letterSpacing: '0.03em',
                    boxShadow: '0 0 14px rgba(239,68,68,0.55)',
                  }}
                  aria-label="Stop export">
                  ⬛ Stop Export
                </button>
              )}
              <div className="stage-style-actions" aria-label="Quick stage text style">
                <button id="stageBoldBtn" className="ghost-btn toggle-btn stage-icon-btn" type="button" aria-pressed="false"
                  aria-label="Bold" title="Bold"><span aria-hidden="true">B</span></button>
                <button id="stageItalicBtn" className="ghost-btn toggle-btn stage-icon-btn" type="button"
                  aria-pressed="false" aria-label="Italic" title="Italic"><span aria-hidden="true">I</span></button>
                <button id="stageUnderlineBtn" className="ghost-btn toggle-btn stage-icon-btn" type="button"
                  aria-pressed="false" aria-label="Underline" title="Underline"><span
                    aria-hidden="true">U</span></button>
              </div>
            </div>
          </div>
        </details>
      </div>

      <div id="stageTimelineCard" className="stage-timeline-card hidden">
        <div className="stage-toolbar-head">
          <div>
            <p className="stage-toolbar-label">Timeline</p>
            <p id="stageTimelineMeta" className="stage-toolbar-meta">Timeline controls appear when a PDF presentation is on
              screen.</p>
          </div>
          <span id="stageModeBadge" className="stage-toolbar-badge">LESSON</span>
        </div>
        <div className="stage-timeline-row">
          <button id="seekBackwardBtn" className="ghost-btn" type="button" disabled>Back 5s</button>
          <span id="stageCurrentTime" className="control-indicator">00:00</span>
          <input id="stageTimelineInput" className="stage-timeline-input" type="range" min="0" max="0" defaultValue="0" step="100"
            disabled aria-label="PDF presentation timeline" />
          <span id="stageDuration" className="control-indicator">00:00</span>
          <button id="seekForwardBtn" className="ghost-btn" type="button" disabled>Forward 5s</button>
          <label className="stage-speed-field" htmlFor="playbackSpeedSelect">
            <span className="style-label">Speed</span>
            <select id="playbackSpeedSelect" className="theme-select text-style-select stage-speed-select"
              aria-label="Choose playback speed" defaultValue="1">
              <option value="0.5">0.5x</option>
              <option value="0.75">0.75x</option>
              <option value="0.85">0.85x</option>
              <option value="0.9">0.9x</option>
              <option value="1">1x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2x</option>
              <option value="2.5">2.5x</option>
            </select>
          </label>
        </div>
      </div>

      <div className="stage-frame" ref={stageFrameRef}>
            <canvas ref={canvasRef} id="previewCanvas" width="1280" height="720" aria-label="Anjali Teacher preview" />
            <div
              className="stage-info-kids-logo-overlay"
              style={{
                left: `${logoBox.x}%`,
                top: `${logoBox.y}%`,
                width: `${logoBox.w}%`,
                display: isExporting ? "none" : undefined
              }}
              onPointerDown={(event) => beginLogoGesture(event, "drag")}
              onPointerMove={updateLogoGesture}
              onPointerUp={endLogoGesture}
              onPointerCancel={endLogoGesture}
              title="Drag to move. Pull the corner to resize."
            >
              <img src="/info-kids-logo.png" alt="Info kids logo" draggable="false" />
              <span
                className="stage-info-kids-logo-resize"
                onPointerDown={(event) => beginLogoGesture(event, "resize")}
                aria-hidden="true"
              />
            </div>
      </div>

      <p className="note" id="statusText">
        Enter English content and play the narration. Export Video saves the animated teaching scene as an `.mp4` file.
      </p>
      <p className="note note-soft">
        Long lessons are split into clean pages automatically. Longer input still takes longer to download because the
        export follows the full narration and typing time for every page.
      </p>
    </section>
  );
}

export default StagePanel;
