/** Guard: returns true only if img is a fully-loaded, non-broken HTMLImageElement */
function isImageReady(img) {
    if (!img) return false;
    // HTMLVideoElement / HTMLCanvasElement / ImageBitmap are always drawable
    if (img instanceof HTMLVideoElement || img instanceof HTMLCanvasElement) return true;
    if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) return true;
    // OffscreenCanvas
    if (typeof OffscreenCanvas !== "undefined" && img instanceof OffscreenCanvas) return true;
    // HTMLImageElement — must be complete AND have natural size
    if (img instanceof HTMLImageElement) {
        return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
    }
    // Assume anything else (e.g. ImageData) is drawable
    return true;
}

let captionWorker = null;
let transcriber = null; // Keeping as a placeholder for any lingering references
const CAPTION_WORD_LIMIT = 8;
const CAPTION_BOTTOM_OFFSET_PX = 80;
const SHORT_CAPTION_GAP_SECONDS = 0.75;

function bootCaptionStudio() {
  if (window.__presentatorCaptionStudioBooted) return;
  const videoInput = document.getElementById('captionVideoInput');
  if (!videoInput) {
    return;
  }
  window.__presentatorCaptionStudioBooted = true;
  try {
    const videoContainer = document.getElementById('captionVideoContainer');
    const sourceVideo = document.getElementById('captionSourceVideo');
    const renderCanvas = document.getElementById('captionRenderCanvas');
    const statusText = document.getElementById('captionStatusText');
    const actionBtn = document.getElementById('captionActionBtn');
    const exportBtn = document.getElementById('captionExportBtn');
    const previewBtn = document.getElementById('captionPreviewBtn');
    const exportActions = document.getElementById('captionExportActions');
    const eraseBtn = document.getElementById('captionEraseBtn');
    const progressBlock = document.getElementById('captionProgress');
    const queuePanel = document.getElementById('captionQueuePanel');
    const queueList = document.getElementById('captionQueueList');
    const queueStatus = document.getElementById('captionQueueStatus');
    const queueRunBtn = document.getElementById('captionQueueRunBtn');
    const queueExportAllBtn = document.getElementById('captionQueueExportAllBtn');
    const queuePrevBtn = document.getElementById('captionQueuePrevBtn');
    const queueNextBtn = document.getElementById('captionQueueNextBtn');
    const QUEUE_EXPORT_FONT_SIZE = 50;
    
    // Controls
    const playPauseBtn = document.getElementById('captionPlayPauseBtn');
    const seekSlider = document.getElementById('captionSeekSlider');
    const timeDisplay = document.getElementById('captionTimeDisplay');
    const videoControls = document.getElementById('captionVideoControls');
    
    // Editor UI
    const editorPanel = document.getElementById('captionEditorPanel');
    const captionList = document.getElementById('captionList');
    const resetBtn = document.getElementById('captionResetBtn');
    
    // Style Selector & Layout & Advanced Control
    const styleSelect = document.getElementById('captionStyleSelect');
    const sizeSlider = document.getElementById('captionSizeSlider');
    const gapSlider = document.getElementById('captionGapSlider');
    const widthSlider = document.getElementById('captionWidthSlider');
    const sizeValue = document.getElementById('captionSizeValue');
    const gapValue = document.getElementById('captionGapValue');
    const widthValue = document.getElementById('captionWidthValue');
    const translateCheck = document.getElementById('captionTranslateCheck');
    const fontSelect = document.getElementById('captionFontSelect');
    const strokeSlider = document.getElementById('captionStrokeSlider');
    const strokeValue = document.getElementById('captionStrokeValue');
    const colorPicker = document.getElementById('captionColorPicker');
    const syncSlider = document.getElementById('captionSyncSlider');
    const syncValue = document.getElementById('captionSyncNum');
    
    // Elite Powers DOM
    const emojiCheck = document.getElementById('captionEmojiCheck');
    const karaokeCheck = document.getElementById('captionKaraokeCheck');
    const filterSelect = document.getElementById('captionFilterSelect');

    const brollCheck = document.getElementById('captionBrollCheck');
    const sfxCheck = document.getElementById('captionSfxCheck');
    const bgMusicInput = document.getElementById('bgMusicInput');
    const bgMusicAudio = document.getElementById('bgMusicAudio');
    const viralShortBtn = document.getElementById('captionViralShortBtn');

    const progressCheck = document.getElementById('captionProgressBarCheck');
    const watermarkInput = document.getElementById('captionWatermarkInput');
    const watermarkCheck = document.getElementById('captionWatermarkCheck');
    const bgMusicCheck = document.getElementById('captionBgMusicCheck');
    let sharedWatermarkImage = null;

    if (styleSelect) styleSelect.value = 'white-yellow';
    if (progressCheck) progressCheck.checked = false;
    if (sizeSlider) sizeSlider.value = '50';
    if (strokeSlider) strokeSlider.value = '0';

    function sliderPercent(slider) {
        if (!slider) return 0;
        const min = Number(slider.min || 0);
        const max = Number(slider.max || 100);
        const val = Number(slider.value || min);
        if (max <= min) return 0;
        return Math.max(0, Math.min(100, Math.round(((val - min) / (max - min)) * 100)));
    }

    function updateCaptionStyleValueLabels() {
        if (sizeSlider && sizeValue) sizeValue.textContent = `${sliderPercent(sizeSlider)}% · ${Math.round(Number(sizeSlider.value))}px`;
        if (gapSlider && gapValue) gapValue.textContent = `${sliderPercent(gapSlider)}% · ${Math.round(Number(gapSlider.value))}`;
        if (widthSlider && widthValue) widthValue.textContent = `${Math.round(Number(widthSlider.value))}%`;
        if (strokeSlider && strokeValue) strokeValue.textContent = `${Math.round(Number(strokeSlider.value))}%`;
        if (syncSlider && syncValue) {
            const seconds = (Number(syncSlider.value || 0) / 1000).toFixed(1);
            syncValue.textContent = `${sliderPercent(syncSlider)}% · ${seconds}s`;
        }
    }

    if (watermarkInput) {
        watermarkInput.addEventListener('change', (e) => {
            if(e.target.files[0]) {
                sharedWatermarkImage = new Image();
                sharedWatermarkImage.src = URL.createObjectURL(e.target.files[0]);
            }
        });
    }

    if (bgMusicInput) {
        bgMusicInput.addEventListener('change', (e) => {
            if(e.target.files[0]) {
                bgMusicAudio.src = URL.createObjectURL(e.target.files[0]);
                bgMusicAudio.volume = 0.5;
                bgMusicAudio.play().catch(e => console.log("Audio play deferred", e));
            }
        });
    }

    const sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
    const sfxDest = sfxCtx.createMediaStreamDestination();
    let lastSfxWordIndex = -1;

    function playSfx(type) {
        if (!sfxCheck || !sfxCheck.checked) return;
        const osc = sfxCtx.createOscillator();
        const gain = sfxCtx.createGain();
        osc.connect(gain);
        gain.connect(sfxCtx.destination);
        gain.connect(sfxDest);
        if (type === 'pop') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(800, sfxCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(300, sfxCtx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.5, sfxCtx.currentTime); 
            gain.gain.exponentialRampToValueAtTime(0.01, sfxCtx.currentTime + 0.1);
            osc.start(); osc.stop(sfxCtx.currentTime + 0.1);
        } else if (type === 'whoosh') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(100, sfxCtx.currentTime);
            gain.gain.setValueAtTime(0.3, sfxCtx.currentTime); 
            gain.gain.linearRampToValueAtTime(0.01, sfxCtx.currentTime + 0.4);
            osc.start(); osc.stop(sfxCtx.currentTime + 0.4);
        }
    }

    const brollUrls = {
        'space': 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1280&q=80',
        'money': 'https://images.unsplash.com/photo-1580519542036-ed474161b51a?w=1280&q=80',
        'nature': 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1280&q=80',
        'tech': 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1280&q=80',
        'car': 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=1280&q=80',
        'animal': 'https://images.unsplash.com/photo-1474511320723-9a56873867b5?w=1280&q=80',
        'city': 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1280&q=80',
        'water': 'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1280&q=80',
        'school': 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=1280&q=80'
    };
    const loadedBroll = {};
    for (const [k, url] of Object.entries(brollUrls)) {
        const img = new Image(); img.crossOrigin = "anonymous"; img.src = url; loadedBroll[k] = img;
    }
    const brollKeywords = {
        'space': 'space', 'moon': 'space', 'stars': 'space', 'galaxy': 'space', 'earth': 'space',
        'money': 'money', 'cash': 'money', 'dollar': 'money', 'buy': 'money', 'rich': 'money', 'wealth': 'money',
        'nature': 'nature', 'tree': 'nature', 'forest': 'nature', 'sun': 'nature', 'world': 'nature', 'flower': 'nature', 'mountain': 'nature', 'rain': 'water', 'ocean': 'water', 'sea': 'water', 'river': 'water',
        'tech': 'tech', 'computer': 'tech', 'code': 'tech', 'app': 'tech', 'robot': 'tech', 'ai': 'tech', 'phone': 'tech',
        'car': 'car', 'drive': 'car', 'fast': 'car', 'ride': 'car', 'speed': 'car', 'vehicle': 'car',
        'animal': 'animal', 'dog': 'animal', 'cat': 'animal', 'cow': 'animal', 'bird': 'animal', 'fish': 'animal', 'lion': 'animal', 'tiger': 'animal',
        'city': 'city', 'town': 'city', 'building': 'city', 'street': 'city', 'urban': 'city',
        'school': 'school', 'learn': 'school', 'study': 'school', 'student': 'school', 'book': 'school', 'read': 'school', 'write': 'school'
    };
    let lastBrollText = ""; let lastBrollResult = null;
    function getBrollForText(text) {
        if (!brollCheck || !brollCheck.checked || !text) return null;
        if (lastBrollText === text) return lastBrollResult;
        lastBrollText = text; lastBrollResult = null;
        const cleanWords = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ');
        for (let w of cleanWords) { if (brollKeywords[w]) { lastBrollResult = loadedBroll[brollKeywords[w]]; break; } }
        return lastBrollResult;
    }

    const emojiDict = {
        // Finance / Tech / Science
        'money': '💰', 'dollar': '💵', 'cash': '💲', 'buy': '🛍️', 'rich': '🤑', 'sell': '📈', 'business': '🏢',
        'rocket': '🚀', 'space': '🌌', 'sky': '☁️', 'moon': '🌕', 'star': '⭐', 'magic': '✨', 'sparkle': '✨', 'planet': '🪐',
        'computer': '💻', 'tech': '🤖', 'robot': '🤖', 'app': '📱', 'phone': '📱', 'internet': '🌐', 'code': '💻', 'ai': '🧠',

        // Emotions / Reactions
        'happy': '😊', 'smile': '😃', 'love': '❤️', 'heart': '💖', 'good': '👍', 'like': '👍', 'awesome': '😎', 'cool': '😎',
        'sad': '😢', 'cry': '😭', 'tear': '💧', 'bad': '👎', 'angry': '😠', 'mad': '😡', 'scared': '😱', 'shock': '😲',
        'laugh': '😂', 'funny': '🤣', 'lol': '😆', 'joke': '🤡', 'silly': '🤪', 'fun': '🥳',
        'fire': '🔥', 'hot': '🥵', 'burn': '🔥', 'lit': '🔥', 'boom': '💥', 'explosion': '💣', 'crash': '💥',

        // Time / Thinking
        'time': '⏳', 'clock': '🕰️', 'wait': '⌛', 'fast': '⚡', 'slow': '🐢', 'today': '📅', 'tomorrow': '📆', 'now': '⏱️',
        'idea': '💡', 'brain': '🧠', 'mind': '🧠', 'think': '🤔', 'question': '❓', 'why': '🤷', 'how': '🤷', 'know': '🧠', 'smart': '🤓',
        'yes': '✅', 'no': '❌', 'stop': '🛑', 'go': '🚦', 'danger': '⚠️', 'warning': '⚠️',

        // Nursery Rhymes / Stories / Animals
        'dog': '🐶', 'cat': '🐱', 'cow': '🐮', 'sheep': '🐑', 'pig': '🐷', 'horse': '🐴', 'bird': '🐦', 'fish': '🐟', 'animal': '🐾', 'mouse': '🐭', 'lion': '🦁', 'tiger': '🐯', 'bear': '🐻', 'monkey': '🐵', 'duck': '🦆', 'frog': '🐸', 'bug': '🐛', 'spider': '🕷️',
        'baby': '👶', 'boy': '👦', 'girl': '👧', 'man': '👨', 'woman': '👩', 'king': '👑', 'queen': '👑', 'princess': '👸', 'knight': '🤺', 'dragon': '🐉', 'monster': '👹', 'ghost': '👻',
        'house': '🏠', 'home': '🏡', 'castle': '🏰', 'village': '🏘️', 'bed': '🛌', 'sleep': '😴', 'dream': '💭',
        
        // Nature / Elements
        'sun': '☀️', 'day': '🌞', 'light': '☀️', 'morning': '🌅', 'night': '🌙', 'evening': '🌇',
        'tree': '🌳', 'forest': '🌲', 'flower': '🌸', 'rose': '🌹', 'leaf': '🍃', 'plant': '🌿', 'nature': '🏞️',
        'water': '💧', 'rain': '🌧️', 'snow': '❄️', 'cold': '🥶', 'ocean': '🌊', 'sea': '🌊', 'wind': '💨', 'storm': '⛈️',

        // General Speaking / Vlog / Education
        'video': '📹', 'channel': '📺', 'subscribe': '🔔', 'welcome': '👋', 'hello': '👋', 'hi': '👋', 'bye': '👋', 'friends': '👥', 'people': '👥',
        'learn': '📚', 'study': '📖', 'book': '📕', 'school': '🏫', 'teacher': '👩‍🏫', 'student': '🎒', 'math': '➕', 'science': '🔬', 'history': '📜', 'art': '🎨',
        'music': '🎵', 'song': '🎵', 'dance': '💃', 'play': '▶️', 'game': '🎮', 'sport': '⚽', 'ball': '🏀', 'run': '🏃', 'walk': '🚶',

        // Objects / Food
        'world': '🌍', 'earth': '🌍', 'global': '🌐', 'map': '🗺️', 'car': '🚗', 'bus': '🚌', 'train': '🚂', 'boat': '⛵', 'plane': '✈️',
        'food': '🍔', 'eat': '🍽️', 'hungry': '🤤', 'apple': '🍎', 'banana': '🍌', 'pizza': '🍕', 'cake': '🎂', 'cookie': '🍪', 'water': '💧', 'drink': '🥤', 'coffee': '☕',
        'gift': '🎁', 'box': '📦', 'tool': '🧰', 'hammer': '🔨', 'sword': '⚔️', 'shield': '🛡️'
    };

    let lastEmojiText = ""; let lastEmojiResult = null;
    function getEmojiForText(text) {
        if (!text) return null;
        if (lastEmojiText === text) return lastEmojiResult;
        lastEmojiText = text; lastEmojiResult = null;
        const cleanWords = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ');
        for (let w of cleanWords) {
            if (emojiDict[w]) { lastEmojiResult = emojiDict[w]; break; }
        }
        return lastEmojiResult;
    }

    let captionPosX = 0.5;
    let captionPosY = 0.85;
    let isDraggingCaption = false;

    renderCanvas.addEventListener('pointerdown', () => { isDraggingCaption = true; });
    renderCanvas.addEventListener('pointermove', (e) => {
        if (!isDraggingCaption) return;
        const rect = renderCanvas.getBoundingClientRect();
        captionPosX = (e.clientX - rect.left) / rect.width;
        captionPosY = (e.clientY - rect.top) / rect.height;
        // Force a redraw just in case paused
        if (sourceVideo.paused && hasDrawnFirstFrame) {
            const ctx = renderCanvas.getContext('2d');
            ctx.drawImage(sourceVideo, 0, 0, renderCanvas.width, renderCanvas.height);
            const time = sourceVideo.currentTime;
            const currentChunk = generatedCaptions.find(c => time >= c.timestamp[0] && time <= c.timestamp[1]);
            if (currentChunk && currentChunk.text) {
                const fontSize = Math.max(12, Math.floor(sizeSlider ? parseInt(sizeSlider.value) : 35));
                const gapMult = (gapSlider ? parseInt(gapSlider.value) : 120) / 100;
                const lineHeight = fontSize * gapMult;
                const maxWBase = renderCanvas.width;
                const widthMult = (widthSlider ? parseInt(widthSlider.value) : 85) / 100;
                const maxWidth = maxWBase * widthMult;
                ctx.font = `900 ${fontSize}px Nunito, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const visibleCaptionText = getVisibleCaptionText(currentChunk.text.trim(), -1, CAPTION_WORD_LIMIT);
                const wrappedLines = getWrappedCaptionLines(ctx, visibleCaptionText, maxWidth);
                const anchoredY = getBottomAnchoredCaptionCenterY(renderCanvas.height, fontSize, lineHeight, Math.max(1, wrappedLines.length));
                drawWrappedText(ctx, currentChunk.text.trim(), renderCanvas.width * captionPosX, anchoredY, maxWidth, lineHeight, time - currentChunk.timestamp[0], styleSelect.value);
            }
        }
    });
    renderCanvas.addEventListener('pointerup', () => isDraggingCaption = false);
    renderCanvas.addEventListener('pointerleave', () => isDraggingCaption = false);

    let videoUrl = null;
    let activeFile = null;
    let audioDataArray = null;
    let generatedCaptions = [];
    let isExtractingText = false;
    let activeCaptionTranscription = null;
    let captionTranscriptionCancelRequested = false;
    let isRecording = false;
    let transcriber = null;
    let hasDrawnFirstFrame = false;

    function stripIgnoredIntroCaption(value, startSeconds) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text || Number(startSeconds) > 12) return text;
        const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (/^(?:info|in fo|infor|in fore|and) (?:for |four )?kids$/.test(normalized)) return '';
        if (/^(?:info|in fo|infor|in fore) kids$/.test(normalized)) return '';
        return text;
    }

    function removeIgnoredIntroCaptions(captions) {
        return (captions || []).map(caption => {
            const timestamp = Array.isArray(caption.timestamp) ? caption.timestamp : [caption.start, caption.end];
            const start = Math.max(0, Number(timestamp[0]) || 0);
            const text = stripIgnoredIntroCaption(caption.text, start);
            return text ? { ...caption, text } : null;
        }).filter(Boolean);
    }
    let previewFrameHandle = null;
    let previewFrameMode = null;
    let autoBurnRequested = false;
    let captionVideoQueue = [];
    let captionQueueIndex = 0;
    let captionQueueRunning = false;
    let captionQueueExporting = false;
    let captionQueueMode = '';
    if (window.electronAPI && typeof window.electronAPI.onTranscribeProgress === 'function') {
        window.electronAPI.onTranscribeProgress((rawPct) => {
            const pct = Math.max(0, Math.min(100, Number(rawPct) || 0));
            const activeIndex = captionVideoQueue.findIndex(item => item.status === 'transcribing');
            if (activeIndex < 0) return;
            const mappedPct = Math.max(5, Math.round(5 + pct * 0.9));
            setQueueItemState(activeIndex, {
                progress: mappedPct,
                message: pct >= 100
                    ? 'Transcription complete. Building captions...'
                    : `Whisper transcription ${pct}%`,
            });
            setCaptionProgressBar(mappedPct);
        });
    }

    if (!document.getElementById('captionQueueSpinStyle')) {
        const spinStyle = document.createElement('style');
        spinStyle.id = 'captionQueueSpinStyle';
        spinStyle.textContent = '@keyframes captionQueueSpin{to{transform:rotate(360deg)}}';
        document.head.appendChild(spinStyle);
    }

    function formatTime(seconds) {
        if(isNaN(seconds)) return "00:00";
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    function speakCaptionStudio(message) {
        try {
            if (!('speechSynthesis' in window)) return;
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(String(message || ''));
            utterance.rate = 0.95;
            utterance.pitch = 1;
            utterance.volume = 1;
            window.speechSynthesis.speak(utterance);
        } catch (error) {
            console.warn('[Caption Studio] Spoken alert failed:', error);
        }
    }

    function notifyCaptionStudio(title, body) {
        const existing = document.getElementById('captionStudioAlertToast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'captionStudioAlertToast';
        toast.setAttribute('role', 'alert');
        toast.style.cssText = 'position:fixed;right:28px;bottom:28px;z-index:2147483647;max-width:420px;padding:16px 18px;border-radius:14px;border:1px solid rgba(125,211,252,.55);background:#101827;color:#fff;box-shadow:0 18px 60px rgba(0,0,0,.55);font:700 14px/1.45 system-ui,sans-serif;white-space:pre-wrap';
        toast.textContent = `${title}\n${body}`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 12000);
        try {
            if (window.electronAPI && typeof window.electronAPI.showNotification === 'function') {
                Promise.resolve(window.electronAPI.showNotification(title, body)).catch((error) => {
                    console.warn('[Caption Studio] System notification failed:', error);
                });
            }
        } catch (error) {
            console.warn('[Caption Studio] Notification failed:', error);
        }
    }

    function setCaptionExportActionsVisible(visible) {
        if (!exportActions) return;
        exportActions.classList.toggle('hidden', !visible);
        exportActions.style.display = visible ? 'flex' : 'none';
    }

    function captionFilePathToUrl(filePath) {
        const normalized = String(filePath || '').trim();
        if (!normalized) return '';
        return 'file:///' + normalized.replace(/\\/g, '/').replace(/^\/+/, '');
    }

    function renderCaptionExportActions(result, options = {}) {
        if (!exportActions || !result || !result.outputPath) return;
        const fileName = result.fileName || result.outputFileName || 'captioned video';
        const index = Number.isInteger(options.queueIndex) ? options.queueIndex : captionQueueIndex;
        exportActions.innerHTML = '';
        setCaptionExportActionsVisible(true);
        exportActions.style.flexWrap = 'wrap';

        const makeButton = (label, handler, tone = 'default') => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            const palette = tone === 'primary'
                ? 'background:linear-gradient(135deg,#22c55e,#06b6d4);border-color:rgba(34,197,94,.55);color:#fff'
                : tone === 'warning'
                    ? 'background:rgba(250,204,21,.13);border-color:rgba(250,204,21,.45);color:#fde68a'
                    : 'background:rgba(15,23,42,.72);border-color:rgba(148,163,184,.35);color:#dbeafe';
            button.style.cssText = `padding:8px 12px;border-radius:7px;border:1px solid;font-weight:900;cursor:pointer;${palette}`;
            button.addEventListener('click', handler);
            return button;
        };

        exportActions.appendChild(makeButton('Play video', () => {
            if (window.electronAPI && typeof window.electronAPI.openFile === 'function') {
                window.electronAPI.openFile(result.outputPath);
            }
        }, 'primary'));
        exportActions.appendChild(makeButton('Open folder', () => {
            if (window.electronAPI && typeof window.electronAPI.showItemInFolder === 'function') {
                window.electronAPI.showItemInFolder(result.outputPath);
            }
        }));
        exportActions.appendChild(makeButton('Re-export', () => {
            if (captionVideoQueue.length && captionVideoQueue[index] && captionVideoQueue[index].captions && captionVideoQueue[index].captions.length) {
                exportQueuedCaptionVideo(index);
                return;
            }
            if (exportBtn) exportBtn.click();
        }, 'warning'));

        const label = document.createElement('span');
        label.textContent = `Saved: ${fileName}`;
        label.style.cssText = 'align-self:center;color:#a7f3d0;font-weight:800;font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        exportActions.appendChild(label);

        const previewWrap = document.createElement('div');
        previewWrap.style.cssText = 'flex:1 0 100%;margin-top:10px;border:1px solid rgba(148,163,184,.24);border-radius:8px;background:#020617;padding:10px;min-width:0';

        const previewLabel = document.createElement('div');
        previewLabel.textContent = `Preview: ${fileName}`;
        previewLabel.style.cssText = 'margin-bottom:8px;color:#dbeafe;font-weight:900;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        previewWrap.appendChild(previewLabel);

        const previewVideo = document.createElement('video');
        previewVideo.controls = true;
        previewVideo.playsInline = true;
        previewVideo.preload = 'metadata';
        previewVideo.src = captionFilePathToUrl(result.outputPath);
        previewVideo.style.cssText = 'display:block;width:100%;max-height:360px;background:#000;border-radius:7px';
        previewWrap.appendChild(previewVideo);
        exportActions.appendChild(previewWrap);
    }

    function updatePlayPauseLabel() {
        playPauseBtn.textContent = sourceVideo.paused ? '▶️ Play' : '⏸️ Pause';
    }

    function clearPreviewFrameHandle() {
        if (previewFrameHandle === null) return;
        if (previewFrameMode === 'raf') {
            cancelAnimationFrame(previewFrameHandle);
        } else if (previewFrameMode === 'rvfc' && typeof sourceVideo.cancelVideoFrameCallback === 'function') {
            sourceVideo.cancelVideoFrameCallback(previewFrameHandle);
        }
        previewFrameHandle = null;
        previewFrameMode = null;
    }

    function renderPreviewNow(timeOverride = sourceVideo.currentTime) {
        const ctx = renderCanvas.getContext('2d');
        renderCaptionFrame(ctx, renderCanvas.width, renderCanvas.height, timeOverride, { isPreviewSurface: true });
    }

    function schedulePreviewFrame() {
        if (previewFrameHandle !== null || sourceVideo.paused || sourceVideo.ended) return;
        if (typeof sourceVideo.requestVideoFrameCallback === 'function') {
            previewFrameMode = 'rvfc';
            previewFrameHandle = sourceVideo.requestVideoFrameCallback(() => {
                previewFrameHandle = null;
                previewFrameMode = null;
                renderPreviewNow(sourceVideo.currentTime);
                schedulePreviewFrame();
            });
        } else {
            previewFrameMode = 'raf';
            previewFrameHandle = requestAnimationFrame(() => {
                previewFrameHandle = null;
                previewFrameMode = null;
                renderPreviewNow(sourceVideo.currentTime);
                schedulePreviewFrame();
            });
        }
    }

    sourceVideo.addEventListener('timeupdate', () => {
        if (!seekSlider.isDragging) seekSlider.value = sourceVideo.currentTime;
        seekSlider.max = sourceVideo.duration || 100;
        timeDisplay.textContent = `${formatTime(sourceVideo.currentTime)} / ${formatTime(sourceVideo.duration)}`;
        
        if (isRecording && sourceVideo.duration) {
            let pct = Math.floor((sourceVideo.currentTime / sourceVideo.duration) * 100);
            const remainingPct = Math.max(0, 100 - pct);
            const remainingSec = Math.max(0, sourceVideo.duration - sourceVideo.currentTime);
            statusText.innerHTML = `Rendering high-quality video... ${pct}% complete - ${remainingPct}% remaining - ${remainingSec.toFixed(1)}s left`;
        }
    });

    seekSlider.addEventListener('mousedown', () => seekSlider.isDragging = true);
    seekSlider.addEventListener('mouseup', () => seekSlider.isDragging = false);
    seekSlider.addEventListener('input', () => {
        sourceVideo.currentTime = seekSlider.value;
        if (sourceVideo.paused) renderPreviewNow(sourceVideo.currentTime);
    });

    playPauseBtn.addEventListener('click', () => {
        if (sourceVideo.paused) {
            sourceVideo.play();
        } else {
            sourceVideo.pause();
        }
    });

    [
        styleSelect, sizeSlider, gapSlider, widthSlider, fontSelect,
        strokeSlider, colorPicker, syncSlider, emojiCheck, karaokeCheck,
        filterSelect, progressCheck, watermarkCheck
    ].filter(Boolean).forEach(control => {
        const refreshPreview = () => {
            updateCaptionStyleValueLabels();
            if (sourceVideo.src && sourceVideo.paused) renderPreviewNow(sourceVideo.currentTime || 0);
        };
        control.addEventListener('input', refreshPreview);
        control.addEventListener('change', refreshPreview);
    });
    updateCaptionStyleValueLabels();
    
    resetBtn.addEventListener('click', () => {
        sourceVideo.pause();
        sourceVideo.removeAttribute('src');
        sourceVideo.load();
        if (videoUrl) {
            URL.revokeObjectURL(videoUrl);
            videoUrl = null;
        }
        activeFile = null;
        generatedCaptions = [];
        audioDataArray = null;
        hasDrawnFirstFrame = false;
        autoBurnRequested = false;
        captionVideoQueue = [];
        captionQueueIndex = 0;
        captionQueueRunning = false;
        captionQueueExporting = false;
        renderCaptionQueue();
        videoContainer.classList.add('hidden');
        actionBtn.disabled = true; actionBtn.classList.remove('hidden');
        exportBtn.classList.add('hidden'); editorPanel.classList.add('hidden');
        if (eraseBtn) eraseBtn.classList.add('hidden');
        if (previewBtn) previewBtn.classList.add('hidden');
        setCaptionExportActionsVisible(false);
        hideSingleCaptionProgress();
        resetBtn.classList.add('hidden'); progressBlock.classList.add('hidden');
        videoInput.value = '';
    });

    if (eraseBtn) {
        eraseBtn.addEventListener('click', async () => {
            const videoPath = getCaptionSourcePath();
            if (!videoPath) {
                alert('No video file path available. Please re-upload or select a local video.');
                return;
            }
            
            const pBar = document.getElementById('captionProgressBarValue');
            let progress = 15;
            if (pBar) pBar.style.width = '15%';
            if (progressBlock) progressBlock.classList.remove('hidden');
            if (typeof window.updateTaskProgressUi === 'function') {
                window.updateTaskProgressUi(0.15, true, { label: "Erasing hardcoded captions..." });
            }
            
            const interval = setInterval(() => {
                if (progress < 90) {
                    progress += Math.floor(Math.random() * 8) + 2;
                    if (progress > 90) progress = 90;
                    if (pBar) pBar.style.width = `${progress}%`;
                    if (typeof window.updateTaskProgressUi === 'function') {
                        window.updateTaskProgressUi(progress / 100, true, { label: "Erasing hardcoded captions..." });
                    }
                }
            }, 300);
            
            try {
                eraseBtn.disabled = true;
                eraseBtn.textContent = '🧹 Erasing...';
                if (statusText) statusText.innerHTML = '🧹 Erasing hardcoded captions/logo from video in progress... please wait, do not close the app.';
                
                const res = await window.electronAPI.eraseCaptions({ filePath: videoPath });
                
                clearInterval(interval);
                
                if (res && res.ok) {
                    if (pBar) pBar.style.width = '100%';
                    if (typeof window.updateTaskProgressUi === 'function') {
                        window.updateTaskProgressUi(1.0, true, { label: "Caption erasing complete!" });
                        setTimeout(() => {
                            window.updateTaskProgressUi(0, false);
                        }, 2000);
                    }
                    
                    if (statusText) {
                        statusText.innerHTML = `✅ Caption erasing complete! Saved to Downloads: <strong>${res.outputFileName || 'output.mp4'}</strong>.`;
                    }
                    speakCaptionStudio('Caption erasing complete');
                    notifyCaptionStudio('Caption Eraser', `Saved as ${res.outputFileName || 'output.mp4'}`);
                    
                    if (window.electronAPI && typeof window.electronAPI.showItemInFolder === 'function') {
                        window.electronAPI.showItemInFolder(res.outputPath);
                    }
                } else {
                    throw new Error(res ? res.error : 'Unknown error during caption erasing');
                }
            } catch (err) {
                clearInterval(interval);
                if (pBar) pBar.style.width = '0%';
                if (typeof window.updateTaskProgressUi === 'function') {
                    window.updateTaskProgressUi(0, false);
                }
                console.error('[Caption Eraser] Error:', err);
                if (statusText) statusText.innerHTML = `❌ Erasing failed: ${err.message}`;
                alert(`Erasing failed: ${err.message}`);
            } finally {
                eraseBtn.disabled = false;
                eraseBtn.textContent = '🧹 Erase Captions';
            }
        });
    }

    videoInput.addEventListener('click', (e) => { e.target.value = null; });

    function renderCaptionQueue() {
        if (!queuePanel || !queueList) return;
        if (!captionVideoQueue.length) {
            queuePanel.classList.add('hidden');
            queueList.innerHTML = '';
            if (queueStatus) queueStatus.textContent = 'Queue ready.';
            const live = document.getElementById('captionQueueLiveStatus');
            if (live) live.remove();
            return;
        }
        queuePanel.classList.remove('hidden');
        const completedCount = captionVideoQueue.filter(item => item.captions && item.captions.length).length;
        const exportedCount = captionVideoQueue.filter(item => item.status === 'exported').length;
        const activeItem = captionVideoQueue.find(item => item.status === 'transcribing' || item.status === 'exporting');
        const activeIndex = activeItem ? captionVideoQueue.indexOf(activeItem) : -1;
        const activePct = activeItem ? Math.max(0, Math.min(100, Math.round(activeItem.progress || 0))) : 0;
        const queuePct = Math.min(100, Math.round(((exportedCount + (activeItem ? activePct / 100 : 0)) / captionVideoQueue.length) * 100));
        if (queueStatus) {
            queueStatus.textContent = `${queuePct}% queue progress - Video ${captionQueueIndex + 1} of ${captionVideoQueue.length} - Captions ${completedCount}/${captionVideoQueue.length} - Exported ${exportedCount}/${captionVideoQueue.length}`;
        }
        let liveStatus = document.getElementById('captionQueueLiveStatus');
        if (!liveStatus) {
            liveStatus = document.createElement('div');
            liveStatus.id = 'captionQueueLiveStatus';
            liveStatus.style.cssText = 'display:none;margin:8px 0 10px;padding:12px;border-radius:10px;border:1px solid rgba(14,165,233,0.30);background:linear-gradient(135deg,rgba(14,165,233,0.18),rgba(99,102,241,0.12));box-shadow:0 10px 28px rgba(2,6,23,0.26);color:#fff';
            queuePanel.insertBefore(liveStatus, queueList);
        }
        if (activeItem || captionQueueRunning || captionQueueExporting) {
            const phase = activeItem && activeItem.status === 'exporting' ? 'Exporting captions' : 'Generating captions';
            const detail = activeItem
                ? (activeItem.message || `${activeIndex + 1}/${captionVideoQueue.length} - ${activeItem.file.name}`)
                : 'Preparing next video...';
            liveStatus.style.display = 'block';
            liveStatus.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                    <div style="display:flex;align-items:center;gap:9px;min-width:0">
                        <span style="width:15px;height:15px;border-radius:999px;border:2px solid ${activeItem && activeItem.status === 'exporting' ? '#fcd34d' : '#7dd3fc'};border-top-color:transparent;display:inline-block;animation:captionQueueSpin 0.9s linear infinite;flex:0 0 auto"></span>
                        <div style="min-width:0">
                            <div style="font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:${activeItem && activeItem.status === 'exporting' ? '#fcd34d' : '#7dd3fc'}">Active now</div>
                            <div style="font-size:11px;font-weight:900;color:#fff;line-height:1.2">${phase}</div>
                            <div style="font-size:9px;font-weight:700;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${activeItem ? `${activeIndex + 1}/${captionVideoQueue.length} - ${activeItem.file.name}` : 'Queue running'}</div>
                        </div>
                    </div>
                    <div style="text-align:right;flex:0 0 auto">
                        <div style="font-size:16px;font-weight:900;color:#fff;line-height:1">${activePct}%</div>
                        <div style="font-size:8px;font-weight:800;color:#94a3b8;margin-top:3px">current video</div>
                    </div>
                </div>
                <div style="font-size:9px;font-weight:700;color:#dbeafe;margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${detail}</div>
                <div style="height:7px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.10);margin-top:8px">
                    <div style="height:100%;width:${activePct}%;border-radius:999px;background:${activeItem && activeItem.status === 'exporting' ? 'linear-gradient(90deg,#f59e0b,#facc15,#a78bfa)' : 'linear-gradient(90deg,#38bdf8,#818cf8,#22d3ee)'};transition:width .25s ease"></div>
                </div>
            `;
        } else {
            liveStatus.style.display = 'none';
        }
        queueList.innerHTML = '';
        captionVideoQueue.forEach((item, index) => {
            const row = document.createElement('div');
            row.style.cssText = [
                'display:grid',
                'grid-template-columns:minmax(0,1fr) auto',
                'gap:8px',
                'align-items:center',
                'text-align:left',
                'padding:8px 10px',
                'border-radius:6px',
                'border:1px solid rgba(255,255,255,0.10)',
                'cursor:pointer',
                'color:#fff',
                index === captionQueueIndex ? 'background:rgba(250,204,21,0.20)' : 'background:rgba(255,255,255,0.05)'
            ].join(';');
            const label = document.createElement('button');
            label.type = 'button';
            const pctLabel = (item.status === 'transcribing' || item.status === 'exporting') ? ` - ${Math.round(item.progress || 0)}%` : '';
            label.textContent = `${index + 1}. ${item.file.name} - ${item.status || 'ready'}${pctLabel}`;
            if (item.status === 'failed' && item.message) {
                label.textContent += ` — ${item.message}`;
                label.title = item.message;
            }
            label.style.cssText = 'min-width:0;text-align:left;background:transparent;border:0;color:#fff;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:normal;cursor:pointer';
            label.addEventListener('click', () => loadQueuedCaptionVideo(index));
            row.addEventListener('click', () => loadQueuedCaptionVideo(index));
            row.appendChild(label);
            if (item.captions && item.captions.length) {
                const exportOne = document.createElement('button');
                exportOne.type = 'button';
                exportOne.textContent = item.status === 'exported' ? 'Re-export' : 'Export';
                exportOne.style.cssText = 'padding:6px 10px;border-radius:6px;border:1px solid rgba(250,204,21,0.35);background:rgba(250,204,21,0.14);color:#fde68a;font-weight:900;cursor:pointer';
                exportOne.addEventListener('click', (event) => {
                    event.stopPropagation();
                    exportQueuedCaptionVideo(index);
                });
                row.appendChild(exportOne);
            }
            if (item.status === 'transcribing' || item.status === 'exporting') {
                const bar = document.createElement('div');
                bar.style.cssText = 'grid-column:1 / -1;height:5px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,0.08)';
                const fill = document.createElement('div');
                fill.style.cssText = `height:100%;width:${Math.max(0, Math.min(100, item.progress || 0))}%;border-radius:999px;background:${item.status === 'exporting' ? 'linear-gradient(90deg,#f59e0b,#a78bfa)' : 'linear-gradient(90deg,#38bdf8,#6366f1)'};transition:width .25s ease`;
                bar.appendChild(fill);
                row.appendChild(bar);
            }
            queueList.appendChild(row);
        });
        if (queuePrevBtn) queuePrevBtn.disabled = captionQueueIndex <= 0;
        if (queueNextBtn) queueNextBtn.disabled = captionQueueIndex >= captionVideoQueue.length - 1;
        if (queueRunBtn) {
            const remaining = captionVideoQueue.filter(item => item.status !== 'exported').length;
            queueRunBtn.disabled = captionQueueRunning || captionQueueExporting || remaining === 0;
            queueRunBtn.textContent = captionQueueRunning || captionQueueExporting
                ? `Queue Running ${exportedCount}/${captionVideoQueue.length}`
                : remaining === 0 ? 'Queue Complete' : `Start Queue (${remaining})`;
        }
        if (queueExportAllBtn) {
            const ready = captionVideoQueue.filter(item => item.status !== 'exported' && item.captions && item.captions.length).length;
            queueExportAllBtn.disabled = captionQueueRunning || captionQueueExporting || ready === 0;
            queueExportAllBtn.textContent = captionQueueExporting ? 'Exporting...' : `Export All (${ready})`;
        }
    }

    function loadQueuedCaptionVideo(index) {
        if (!captionVideoQueue.length) return;
        captionQueueIndex = Math.max(0, Math.min(index, captionVideoQueue.length - 1));
        const item = captionVideoQueue[captionQueueIndex];
        const file = item && item.file;
        if (!file) return;

        activeFile = file;
        autoBurnRequested = false;
        generatedCaptions = item.captions ? JSON.parse(JSON.stringify(item.captions)) : [];
        audioDataArray = null;
        hasDrawnFirstFrame = false;
        clearPreviewFrameHandle();
        sourceVideo.pause();
        sourceVideo.removeAttribute('src');
        sourceVideo.load();
        if (videoUrl && videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl);
        videoUrl = file.path ? captionFilePathToUrl(file.path) : URL.createObjectURL(file);

        videoContainer.classList.remove('hidden');
        actionBtn.disabled = false;
        actionBtn.classList.toggle('hidden', generatedCaptions.length > 0);
        exportBtn.classList.toggle('hidden', generatedCaptions.length === 0);
        if (previewBtn) previewBtn.classList.toggle('hidden', generatedCaptions.length === 0);
        if (generatedCaptions.length && item.outputPath) {
            renderCaptionExportActions({
                outputPath: item.outputPath,
                fileName: item.outputFileName
            }, { queueIndex: captionQueueIndex });
        } else {
            setCaptionExportActionsVisible(false);
        }
        editorPanel.classList.toggle('hidden', generatedCaptions.length === 0);
        resetBtn.classList.remove('hidden');
        if (eraseBtn) eraseBtn.classList.remove('hidden');
        actionBtn.textContent = captionVideoQueue.length > 1 ? 'Generate Queue' : 'Generate Captions';
        if (karaokeCheck) karaokeCheck.checked = true;
        if (generatedCaptions.length) populateEditor();

        sourceVideo.addEventListener('loadedmetadata', () => {
            let vw = sourceVideo.videoWidth;
            let vh = sourceVideo.videoHeight;
            if (!vw || !vh || vw === 0 || vh === 0) {
                vw = 1920;
                vh = 1080;
            }
            const MAX_DIM = 1920;
            const maxDim = Math.max(vw, vh);
            if (maxDim > MAX_DIM && vh > 0) {
                const scale = MAX_DIM / maxDim;
                vw *= scale;
                vh *= scale;
            }
            renderCanvas.width = Math.floor(vw);
            renderCanvas.height = Math.floor(vh);
        }, { once: true });

        sourceVideo.addEventListener('loadeddata', () => {
            if (!hasDrawnFirstFrame) {
                const ctx = renderCanvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                const filter = filterSelect ? filterSelect.value : 'none';
                if (filter === 'darken') ctx.filter = 'brightness(50%)';
                else if (filter === 'blur') ctx.filter = 'blur(10px)';
                else if (filter === 'grayscale') ctx.filter = 'grayscale(100%)';
                else if (filter === 'sepia') ctx.filter = 'sepia(100%)';
                else if (filter === 'invert') ctx.filter = 'invert(100%) hue-rotate(180deg)';
                else ctx.filter = 'none';
                renderPreviewNow(0);
                hasDrawnFirstFrame = true;
            }
        }, { once: true });

        sourceVideo.src = videoUrl;
        progressBlock.classList.remove('hidden');
        statusText.innerHTML = generatedCaptions.length
            ? `Loaded ${captionQueueIndex + 1} of ${captionVideoQueue.length}. Captions ready. Edit, export this video, or Export All.`
            : `Loaded ${captionQueueIndex + 1} of ${captionVideoQueue.length}. Click Generate Queue when you are ready.`;
        renderCaptionQueue();
    }

    if (queuePrevBtn) {
        queuePrevBtn.addEventListener('click', () => loadQueuedCaptionVideo(captionQueueIndex - 1));
    }
    if (queueNextBtn) {
        queueNextBtn.addEventListener('click', () => loadQueuedCaptionVideo(captionQueueIndex + 1));
    }
    
    videoInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []).filter(file => file && file.type && file.type.startsWith('video/'));
        if (!files.length) return;
        captionVideoQueue = files.map(file => ({ file, status: 'ready', captions: [] }));
        captionQueueIndex = 0;
        loadQueuedCaptionVideo(0);
        scrollCaptionStudioToWorkSection();
    });

    function setQueueItemState(index, patch) {
        if (!captionVideoQueue[index]) return;
        const current = captionVideoQueue[index];
        const forceStatus = patch && patch.forceStatus;
        if (current.status === 'exported' && patch && !forceStatus && (patch.status === 'exporting' || patch.status === 'transcribing')) {
            return;
        }
        const cleanPatch = { ...patch };
        delete cleanPatch.forceStatus;
        captionVideoQueue[index] = { ...captionVideoQueue[index], ...cleanPatch };
        renderCaptionQueue();
    }

    function setCaptionProgressBar(pct) {
        const captionProgress = document.getElementById('captionProgress');
        const pBar = document.getElementById('captionProgressBarValue');
        if (captionProgress) captionProgress.classList.remove('hidden');
        if (pBar) pBar.style.width = Math.max(0, Math.min(100, Math.round(pct))) + '%';
    }

    function renderSingleCaptionProgress(pct, phase = 'Working', detail = '') {
        const captionProgress = document.getElementById('captionProgress');
        if (!captionProgress) return;
        let liveStatus = document.getElementById('captionSingleLiveStatus');
        if (!liveStatus) {
            liveStatus = document.createElement('div');
            liveStatus.id = 'captionSingleLiveStatus';
            liveStatus.style.cssText = 'display:none;margin:8px 0 10px;padding:12px;border-radius:10px;border:1px solid rgba(14,165,233,0.30);background:linear-gradient(135deg,rgba(14,165,233,0.18),rgba(99,102,241,0.12));box-shadow:0 10px 28px rgba(2,6,23,0.26);color:#fff';
            captionProgress.insertBefore(liveStatus, captionProgress.firstChild);
        }
        const shownPct = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
        const isExport = /export|final/i.test(phase);
        liveStatus.style.display = 'block';
        liveStatus.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="display:flex;align-items:center;gap:9px;min-width:0">
                    <span style="width:15px;height:15px;border-radius:999px;border:2px solid ${isExport ? '#fcd34d' : '#7dd3fc'};border-top-color:transparent;display:inline-block;animation:captionQueueSpin 0.9s linear infinite;flex:0 0 auto"></span>
                    <div style="min-width:0">
                        <div style="font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:${isExport ? '#fcd34d' : '#7dd3fc'}">Active now</div>
                        <div style="font-size:11px;font-weight:900;color:#fff;line-height:1.2">${phase}</div>
                        <div style="font-size:9px;font-weight:700;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${detail || (activeFile && activeFile.name) || 'Current video'}</div>
                    </div>
                </div>
                <div style="text-align:right;flex:0 0 auto">
                    <div style="font-size:16px;font-weight:900;color:#fff;line-height:1">${shownPct}%</div>
                    <div style="font-size:8px;font-weight:800;color:#94a3b8;margin-top:3px">current video</div>
                </div>
            </div>
            <div style="height:7px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.10);margin-top:8px">
                <div style="height:100%;width:${shownPct}%;border-radius:999px;background:${isExport ? 'linear-gradient(90deg,#f59e0b,#facc15,#a78bfa)' : 'linear-gradient(90deg,#38bdf8,#818cf8,#22d3ee)'};transition:width .25s ease"></div>
            </div>
        `;
    }

    function hideSingleCaptionProgress() {
        const liveStatus = document.getElementById('captionSingleLiveStatus');
        if (liveStatus) liveStatus.style.display = 'none';
    }

    function lockCaptionQueueControls(locked) {
        const allDone = captionVideoQueue.length > 0 && captionVideoQueue.every(item => item.status === 'exported');
        if (actionBtn) {
            actionBtn.disabled = locked || allDone;
            actionBtn.textContent = locked
                ? 'Queue Running...'
                : allDone
                    ? 'Queue Complete'
                    : (captionVideoQueue.length > 1 ? 'Generate Queue' : 'Generate Captions');
        }
        if (queueRunBtn) queueRunBtn.disabled = locked || allDone;
        if (queueExportAllBtn) queueExportAllBtn.disabled = locked || allDone;
        if (exportBtn) exportBtn.disabled = locked;
        if (queuePrevBtn) queuePrevBtn.disabled = locked || captionQueueIndex <= 0;
        if (queueNextBtn) queueNextBtn.disabled = locked || captionQueueIndex >= captionVideoQueue.length - 1;
    }

    function startQueueProgressHeartbeat(index, phaseLabel, startPct, maxPct) {
        let shownPct = startPct;
        setCaptionProgressBar(shownPct);
        setQueueItemState(index, {
            status: 'transcribing',
            progress: shownPct,
            message: `${phaseLabel}... ${shownPct}%`
        });
        return setInterval(() => {
            if (!captionQueueRunning || !captionVideoQueue[index] || captionVideoQueue[index].status !== 'transcribing') return;
            const remaining = maxPct - shownPct;
            if (remaining <= 0.4) return;
            shownPct = Math.min(maxPct, shownPct + Math.max(1, remaining * 0.035));
            const pct = Math.round(shownPct);
            setCaptionProgressBar(pct);
            statusText.innerHTML = `Active now: ${phaseLabel.toLowerCase()} ${index + 1}/${captionVideoQueue.length} - ${pct}% complete - ${100 - pct}% remaining`;
            setQueueItemState(index, {
                status: 'transcribing',
                progress: pct,
                message: `${phaseLabel}... ${pct}%`
            });
        }, 700);
    }

    function forceQueueExportFontSize() {
        if (!sizeSlider) return;
        sizeSlider.value = String(QUEUE_EXPORT_FONT_SIZE);
        sizeSlider.dispatchEvent(new Event('input', { bubbles: true }));
        sizeSlider.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function waitForQueueVideoReady() {
        return new Promise(resolve => {
            if (sourceVideo.readyState >= 1) {
                resolve();
                return;
            }
            const done = () => resolve();
            sourceVideo.addEventListener('loadedmetadata', done, { once: true });
            setTimeout(done, 2500);
        });
    }

    function scrollCaptionStudioToWorkSection() {
        const target = queuePanel || document.getElementById('captionProgress') || editorPanel || statusText;
        if (!target) return;
        setTimeout(() => {
            const scrollBody = document.querySelector('#aiCaptionSection .caption-burner-body');
            if (scrollBody) {
                const baseTop = scrollBody.getBoundingClientRect().top;
                const targetTop = target.getBoundingClientRect().top;
                scrollBody.scrollTo({
                    top: Math.max(0, scrollBody.scrollTop + targetTop - baseTop - 12),
                    behavior: 'smooth'
                });
                return;
            }
            try {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (_) {
                target.scrollIntoView();
            }
        }, 120);
    }

    async function exportActiveCaptionVideoForQueue(index) {
        const item = captionVideoQueue[index];
        if (!item || !activeFile || !generatedCaptions.length) {
            throw new Error('No captions are ready for export.');
        }
        forceQueueExportFontSize();
        lockCaptionQueueControls(true);
        setCaptionExportActionsVisible(false);
        setQueueItemState(index, {
            status: 'exporting',
            progress: 2,
            message: `Captions ready. Exporting at ${QUEUE_EXPORT_FONT_SIZE}px...`
        });
        statusText.innerHTML = `Active now: exporting captions ${index + 1}/${captionVideoQueue.length} at ${QUEUE_EXPORT_FONT_SIZE}px...`;
        const pBar = document.getElementById('captionProgressBarValue');
        setCaptionProgressBar(2);

        const filePath = getCaptionSourcePath();
        if (!filePath) {
            throw new Error('Original source file path is unavailable. Re-upload the source video and try again.');
        }
        if (!window.electronAPI || typeof window.electronAPI.burnCaptions !== 'function') {
            throw new Error('Native caption exporter is not available.');
        }

        const captionsForBurn = getValidatedCaptionBurnList();
        if (!captionsForBurn.length) {
            throw new Error('No valid caption timings are available for export.');
        }

        let burnProgressHandler = null;
        let shownExportPct = 2;
        let finalizingTimer = null;
        const showQueueExportProgress = (pct, messagePrefix = 'Exporting captions') => {
            shownExportPct = Math.max(shownExportPct, Math.max(2, Math.min(99, Math.round(pct))));
            setQueueItemState(index, {
                status: 'exporting',
                progress: shownExportPct,
                message: `${messagePrefix} at ${QUEUE_EXPORT_FONT_SIZE}px... ${shownExportPct}%`
            });
            statusText.innerHTML = `Active now: ${messagePrefix.toLowerCase()} ${index + 1}/${captionVideoQueue.length} - ${shownExportPct}% complete - ${100 - shownExportPct}% remaining`;
            setCaptionProgressBar(shownExportPct);
        };
        finalizingTimer = setInterval(() => {
            if (!captionQueueExporting || shownExportPct < 94 || shownExportPct >= 99) return;
            showQueueExportProgress(shownExportPct + 1, 'Finalizing export');
        }, 1200);
        if (typeof window.electronAPI.onBurnProgress === 'function') {
            burnProgressHandler = data => {
                let pct = 0;
                if (typeof data === 'number') pct = data;
                else if (data && typeof data.pct === 'number') pct = data.pct;
                const isFinalizing = data && typeof data === 'object' && data.phase === 'finalizing';
                showQueueExportProgress(pct, isFinalizing || pct >= 94 ? 'Finalizing export' : 'Exporting captions');
            };
            window.electronAPI.onBurnProgress(burnProgressHandler);
        }

        try {
            const result = await window.electronAPI.burnCaptions({
                videoPath: filePath,
                captions: captionsForBurn,
                style: styleSelect ? styleSelect.value : 'white-yellow',
                fontSize: QUEUE_EXPORT_FONT_SIZE,
                position: 'bottom',
                assContent: buildPreviewMatchedAss()
            });
            if (!result || !result.ok) {
                throw new Error((result && result.error) || 'FFmpeg caption export failed.');
            }
            setQueueItemState(index, {
                status: 'exported',
                progress: 100,
                outputPath: result.outputPath,
                outputFileName: result.fileName,
                message: `Saved - ${result.fileName || 'captioned video'}`
            });
            if (index === captionQueueIndex) {
                renderCaptionExportActions(result, { queueIndex: index });
            }
            if (pBar) pBar.style.width = '100%';
            return result;
        } finally {
            if (finalizingTimer) clearInterval(finalizingTimer);
            if (burnProgressHandler && typeof window.electronAPI.offBurnProgress === 'function') {
                window.electronAPI.offBurnProgress(burnProgressHandler);
            }
        }
    }

    async function transcribeCaptionQueueFrom(startIndex = 0) {
        if (!captionVideoQueue.length || captionQueueRunning || captionQueueExporting) return;
        captionQueueRunning = true;
        captionQueueExporting = true;
        captionQueueMode = 'start';
        lockCaptionQueueControls(true);
        renderCaptionQueue();
        try {
            const ordered = [];
            for (let offset = 0; offset < captionVideoQueue.length; offset += 1) {
                ordered.push((startIndex + offset) % captionVideoQueue.length);
            }
            for (const index of ordered) {
                const item = captionVideoQueue[index];
                if (!item || item.status === 'exported') continue;
                try {
                    captionQueueIndex = index;
                    loadQueuedCaptionVideo(index);
                    await waitForQueueVideoReady();
                    lockCaptionQueueControls(true);
                    setQueueItemState(index, {
                        status: item.captions && item.captions.length ? 'transcribed' : 'transcribing',
                        progress: item.captions && item.captions.length ? 100 : 5,
                        message: item.captions && item.captions.length ? 'Captions already ready.' : 'Generating captions...'
                    });
                    if (!(captionVideoQueue[index].captions && captionVideoQueue[index].captions.length)) {
                        statusText.innerHTML = `Active now: generating captions ${index + 1}/${captionVideoQueue.length}...`;
                        const heartbeat = startQueueProgressHeartbeat(index, 'Generating captions', 5, 95);
                        try {
                            const videoPath = item.file.path || ((window.electronAPI && typeof window.electronAPI.getPathForFile === 'function')
                                ? window.electronAPI.getPathForFile(item.file)
                                : '');
                            if (!videoPath || !window.electronAPI || typeof window.electronAPI.transcribeVideo !== 'function') {
                                throw new Error('Electron could not access the local video path for captioning.');
                            }
                            const selectedLanguage = String(item.captionLanguage || '').toLowerCase();
                            const languageHint = selectedLanguage.includes('telugu') ? 'te'
                                : selectedLanguage.includes('hindi') ? 'hi'
                                    : selectedLanguage.includes('english') ? 'en' : 'auto';
                            const transcription = await window.electronAPI.transcribeVideo({ videoPath, languageHint });
                            if (!transcription || !transcription.ok) {
                                throw new Error((transcription && transcription.error) || 'Electron transcription failed.');
                            }
                            const directCaptions = buildCaptionChunksFromTranscription(transcription, sourceVideo.duration || 60);
                            if (!directCaptions.length) {
                                throw new Error('Whisper processed the audio but did not recognize speech. Try selecting English explicitly.');
                            }
                            generatedCaptions = JSON.parse(JSON.stringify(directCaptions));
                            captionVideoQueue[index].captions = JSON.parse(JSON.stringify(directCaptions));
                            captionVideoQueue[index].status = 'transcribed';
                            renderCaptionQueue();
                        } finally {
                            clearInterval(heartbeat);
                        }
                    }
                    if (!(captionVideoQueue[index].captions && captionVideoQueue[index].captions.length)) {
                        throw new Error(`No captions generated for ${item.file.name}`);
                    }
                    setCaptionProgressBar(100);
                    setQueueItemState(index, {
                        status: 'transcribed',
                        progress: 100,
                        message: 'Captions generated. Starting export...'
                    });
                    generatedCaptions = JSON.parse(JSON.stringify(captionVideoQueue[index].captions));
                    await exportActiveCaptionVideoForQueue(index);
                } catch (itemError) {
                    setQueueItemState(index, {
                        status: 'failed',
                        progress: 0,
                        message: String(itemError.message || itemError).slice(0, 100)
                    });
                    console.error(`[Caption Queue] Video ${index + 1} failed:`, itemError);
                }
            }
            const exportedCount = captionVideoQueue.filter(item => item.status === 'exported').length;
            const failedCount = captionVideoQueue.filter(item => item.status === 'failed').length;
            statusText.innerHTML = `Queue complete. Exported ${exportedCount}/${captionVideoQueue.length} videos${failedCount ? ` · Failed ${failedCount}` : ''}.`;
            speakCaptionStudio('Caption queue complete');
            notifyCaptionStudio(
                'Caption queue complete',
                failedCount ? `Exported ${exportedCount}. Failed ${failedCount}.` : 'All captioned videos finished exporting.'
            );
        } catch (error) {
            const current = captionVideoQueue[captionQueueIndex];
            if (current) {
                setQueueItemState(captionQueueIndex, {
                    status: 'failed',
                    progress: 0,
                    message: String(error.message || error).slice(0, 100)
                });
            }
            statusText.innerHTML = `Queue stopped: ${error.message || error}`;
            console.error('[Caption Queue]', error);
        } finally {
            captionQueueRunning = false;
            captionQueueExporting = false;
            captionQueueMode = '';
            lockCaptionQueueControls(false);
            renderCaptionQueue();
        }
    }

    async function exportQueuedCaptionVideo(index) {
        if (!captionVideoQueue[index] || captionQueueRunning || captionQueueExporting) return;
        captionQueueExporting = true;
        captionQueueMode = 'single-export';
        lockCaptionQueueControls(true);
        try {
            if (captionVideoQueue[index].status === 'exported') {
                setQueueItemState(index, {
                    status: 'transcribed',
                    progress: 100,
                    message: 'Re-export queued.',
                    forceStatus: true
                });
            }
            loadQueuedCaptionVideo(index);
            await waitForQueueVideoReady();
            generatedCaptions = JSON.parse(JSON.stringify(captionVideoQueue[index].captions || []));
            await exportActiveCaptionVideoForQueue(index);
            statusText.innerHTML = `Exported ${index + 1}/${captionVideoQueue.length}: ${captionVideoQueue[index].file.name}`;
        } catch (error) {
            setQueueItemState(index, { status: 'failed', progress: 0, message: String(error.message || error).slice(0, 100) });
            statusText.innerHTML = `Export failed: ${error.message || error}`;
        } finally {
            captionQueueExporting = false;
            captionQueueMode = '';
            lockCaptionQueueControls(false);
            renderCaptionQueue();
        }
    }

    async function exportReadyCaptionQueueFrom(startIndex = 0) {
        if (!captionVideoQueue.length || captionQueueRunning || captionQueueExporting) return;
        captionQueueExporting = true;
        captionQueueMode = 'export-ready';
        lockCaptionQueueControls(true);
        renderCaptionQueue();
        try {
            const ordered = [];
            for (let offset = 0; offset < captionVideoQueue.length; offset += 1) {
                ordered.push((startIndex + offset) % captionVideoQueue.length);
            }
            for (const index of ordered) {
                if (
                    captionVideoQueue[index].status === 'exported' ||
                    !(captionVideoQueue[index].captions && captionVideoQueue[index].captions.length)
                ) continue;
                loadQueuedCaptionVideo(index);
                await waitForQueueVideoReady();
                generatedCaptions = JSON.parse(JSON.stringify(captionVideoQueue[index].captions));
                await exportActiveCaptionVideoForQueue(index);
            }
            statusText.innerHTML = `Export ready queue complete. Exported ${captionVideoQueue.filter(item => item.status === 'exported').length}/${captionVideoQueue.length} videos.`;
        } catch (error) {
            setQueueItemState(captionQueueIndex, { status: 'failed', progress: 0, message: String(error.message || error).slice(0, 100) });
            statusText.innerHTML = `Export queue stopped: ${error.message || error}`;
        } finally {
            captionQueueExporting = false;
            captionQueueMode = '';
            lockCaptionQueueControls(false);
            renderCaptionQueue();
        }
    }

    if (queueRunBtn) {
        queueRunBtn.addEventListener('click', () => transcribeCaptionQueueFrom(captionQueueIndex));
    }
    if (queueExportAllBtn) {
        queueExportAllBtn.addEventListener('click', () => exportReadyCaptionQueueFrom(captionQueueIndex));
    }

    async function extractAudio(fileToProcess) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const isElectron = window && window.process && window.process.type;
        
        statusText.innerHTML = "Fetching audio data...";
        const arrayBuffer = await fileToProcess.arrayBuffer();
        try {
            statusText.innerHTML = "Extracting audio with local FFmpeg server...";
            const mediaBase64 = arrayBufferToBase64(arrayBuffer);
            const response = await fetch('http://127.0.0.1:8430/api/extract-audio-wav', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mediaBase64,
                    inputFileName: fileToProcess.name || 'caption-video.mp4'
                })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error((payload && payload.error) || 'FFmpeg audio extraction failed.');
            }
            const wavArrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(wavArrayBuffer.slice(0));
            return {
                buffer: audioBuffer.getChannelData(0),
                duration: audioBuffer.duration,
                wavBase64: arrayBufferToBase64(wavArrayBuffer)
            };
        } catch (serverError) {
            console.warn("Local FFmpeg audio extraction failed, trying browser decode:", serverError);
        }

        statusText.innerHTML = "Decoding audio data locally...";
        
        let audioBuffer;
        try {
            if (isElectron) {
                const fs = require('fs');
                const path = require('path');
                const { execSync } = require('child_process');
                const projectRoot = (typeof process !== 'undefined' && process.cwd) ? process.cwd() : 'D:\\voice';
                const captionWorkDir = path.join(projectRoot, 'caption-work', 'browser-fallback');
                fs.mkdirSync(captionWorkDir, { recursive: true });

                const tempVid = path.join(captionWorkDir, "presentator_temp_" + Date.now() + ".mp4");
                const tempWav = path.join(captionWorkDir, "presentator_wav_" + Date.now() + ".wav");
                
                fs.writeFileSync(tempVid, Buffer.from(arrayBuffer));
                execSync(`ffmpeg -y -i "${tempVid}" -ac 1 -ar 16000 "${tempWav}"`, { stdio: 'ignore' });
                
                const wavData = fs.readFileSync(tempWav);
                const toArrayBuffer = new Uint8Array(wavData).buffer;
                audioBuffer = await audioContext.decodeAudioData(toArrayBuffer);
                
                try { fs.unlinkSync(tempVid); fs.unlinkSync(tempWav); } catch(e){}
            } else {
                audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            }
        } catch(e) {
            console.error("Advanced offline decode bypassed, falling back:", e);
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        }
        
        return {
            buffer: audioBuffer.getChannelData(0),
            duration: audioBuffer.duration
        };
    }

    function arrayBufferToBase64(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    function audioSamplesToWavBase64(samples, sampleRate = 16000) {
        const bytesPerSample = 2;
        const wavBuffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
        const view = new DataView(wavBuffer);
        let offset = 0;
        const writeString = (value) => {
            for (let i = 0; i < value.length; i += 1) {
                view.setUint8(offset, value.charCodeAt(i));
                offset += 1;
            }
        };
        writeString('RIFF');
        view.setUint32(offset, 36 + samples.length * bytesPerSample, true); offset += 4;
        writeString('WAVE');
        writeString('fmt ');
        view.setUint32(offset, 16, true); offset += 4;
        view.setUint16(offset, 1, true); offset += 2;
        view.setUint16(offset, 1, true); offset += 2;
        view.setUint32(offset, sampleRate, true); offset += 4;
        view.setUint32(offset, sampleRate * bytesPerSample, true); offset += 4;
        view.setUint16(offset, bytesPerSample, true); offset += 2;
        view.setUint16(offset, 16, true); offset += 2;
        writeString('data');
        view.setUint32(offset, samples.length * bytesPerSample, true); offset += 4;
        for (let i = 0; i < samples.length; i += 1) {
            const value = Math.max(-1, Math.min(1, samples[i] || 0));
            view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
            offset += 2;
        }
        const bytes = new Uint8Array(wavBuffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    function buildLinearCaptionChunks(text, duration, options) {
        const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        if (!words.length) return [];

        // ── Use ACTUAL narration duration so highlights match the voice ──────────
        // Priority order:
        //  1. state.narration.durationMs  (measured from the real audio blob)
        //  2. Caller-supplied override   (opts.narrationDurationSec)
        //  3. WPM-based estimate         (140 wpm for SC3/pattan)
        //  4. Caller-supplied videoDuration  (last resort – usually wrong)
        const opts = options || {};
        const WPM  = 140;  // SC3 / pattan TTS natural speaking rate
        const wpmEstimateSec = (words.length / WPM) * 60;

        let speechDurationSec = 0;
        if (window.state && window.state.narration && Number(window.state.narration.durationMs) > 500) {
            speechDurationSec = window.state.narration.durationMs / 1000;
        } else if (Number(opts.narrationDurationSec) > 0.5) {
            speechDurationSec = Number(opts.narrationDurationSec);
        } else {
            // Estimate from speech rate — far more accurate than video duration
            speechDurationSec = wpmEstimateSec;
        }

        // Never exceed the video duration, but also don't use video duration
        // as the primary timing reference (video may have long intro/outro)
        const videoDuration = Math.max(1, Number(duration) || 60);
        const safeDuration  = Math.min(speechDurationSec, videoDuration);

        const chunks = [];
        const chunkSize = CAPTION_WORD_LIMIT;
        for (let i = 0; i < words.length; i += chunkSize) {
            const chunkWords = words.slice(i, i + chunkSize);
            const start = (i / words.length) * safeDuration;
            const end   = (Math.min(words.length, i + chunkWords.length) / words.length) * safeDuration;
            chunks.push({
                text:      chunkWords.join(' '),
                timestamp: [start, Math.max(start + 0.35, end)]
            });
        }
        return chunks;
    }

    function inferCaptionLanguageCode(text) {
        const counts = {};
        for (const ch of String(text || '')) {
            const p = ch.codePointAt(0) || 0;
            if (p >= 0x0C00 && p <= 0x0C7F) counts.te = (counts.te || 0) + 1;
            else if (p >= 0x0900 && p <= 0x097F) counts.hi = (counts.hi || 0) + 1;
            else if (p >= 0x0B80 && p <= 0x0BFF) counts.ta = (counts.ta || 0) + 1;
            else if (p >= 0x0600 && p <= 0x06FF) counts.ar = (counts.ar || 0) + 1;
        }
        const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        return best && best[1] > 3 ? best[0] : '';
    }

    function normalizeCaptionLanguageCode(value) {
        const lang = String(value || '').trim().toLowerCase();
        if (!lang) return '';
        if (lang === 'telugu' || lang === 'te') return 'te';
        if (lang === 'hindi' || lang === 'hi') return 'hi';
        if (lang === 'tamil' || lang === 'ta') return 'ta';
        if (lang === 'urdu' || lang === 'ur') return 'ur';
        if (lang === 'arabic' || lang === 'ar') return 'ar';
        if (lang === 'english' || lang === 'en') return 'en';
        return lang.slice(0, 2);
    }

    function isIndicCaptionLanguage(code) {
        return ['te', 'hi', 'ta', 'ur', 'ar'].includes(normalizeCaptionLanguageCode(code));
    }

    function likelyIndicCaptionFileName(file) {
        const name = String((file && file.name) || '').toLowerCase();
        if (/\btelugu\b|తెలుగు/.test(name)) return 'te';
        if (/\bhindi\b|हिंदी/.test(name)) return 'hi';
        if (/\btamil\b|தமிழ்/.test(name)) return 'ta';
        if (/\burdu\b|اردو/.test(name)) return 'ur';
        return '';
    }

    function isCaptionRepetitionLoop(text) {
        const compact = String(text || '').replace(/[\s\W_]+/gu, '');
        if (compact.length >= 30) {
            const counts = {};
            for (const ch of Array.from(compact)) counts[ch] = (counts[ch] || 0) + 1;
            const values = Object.values(counts);
            if (Math.max(...values) / compact.length > 0.45) return true;
            if (values.length <= 4) return true;
        }
        const words = String(text || '').trim().split(/\s+/).filter(Boolean);
        if (words.length < 6) return false;
        const wordCounts = {};
        for (const word of words) wordCounts[word] = (wordCounts[word] || 0) + 1;
        return Math.max(...Object.values(wordCounts)) / words.length > 0.6;
    }

    function buildCaptionChunksFromTranscription(result, duration) {
        const words = Array.isArray(result && result.words) ? result.words : [];
        const segments = Array.isArray(result && result.segments) ? result.segments : [];
        const chunks = [];
        if (words.length > 0) {
            for (let i = 0; i < words.length; i += CAPTION_WORD_LIMIT) {
                const sl = words.slice(i, i + CAPTION_WORD_LIMIT);
                const txt = sl.map(w => String(w.word || w.text || '').trim()).filter(Boolean).join(' ').trim();
                if (txt) {
                    chunks.push({
                        text: txt,
                        timestamp: [Number(sl[0].start || 0), Number(sl[sl.length - 1].end || (Number(sl[0].start || 0) + 0.5))],
                        words: sl.map(w => ({
                            text: String(w.word || w.text || '').trim(),
                            timestamp: [Number(w.start || 0), Number(w.end || (Number(w.start || 0) + 0.25))]
                        })).filter(w => w.text)
                    });
                }
            }
        } else if (segments.length > 0) {
            return segments.filter(s => s.text && String(s.text).trim()).map(s => ({
                text: String(s.text).trim(),
                timestamp: [Number(s.start || 0), Number(s.end || (Number(s.start || 0) + 0.5))],
                words: String(s.text).trim().split(/\s+/).map((w, i, a) => ({
                    text: w,
                    timestamp: [
                        Number(s.start || 0) + (i / a.length) * (Number(s.end || 0) - Number(s.start || 0)),
                        Number(s.start || 0) + ((i + 1) / a.length) * (Number(s.end || 0) - Number(s.start || 0))
                    ]
                }))
            }));
        } else if (result && result.text) {
            return buildLinearCaptionChunks(String(result.text), duration || 60, { narrationDurationSec: duration || 60 });
        }
        return chunks;
    }

    async function transcribeVideoWithGroqForIndic(videoPath, languageHint, detail, progressFn) {
        if (!window.electronAPI || typeof window.electronAPI.transcribeVideoGroq !== 'function') {
            throw new Error('High-accuracy Telugu/Hindi caption engine is not available.');
        }
        statusText.innerHTML = `Using high-accuracy Whisper for ${detail || 'Telugu/Hindi'} captions...`;
        const pBar = document.getElementById('captionProgressBarValue');
        if (pBar) pBar.style.width = '18%';
        if (typeof progressFn === 'function') {
            progressFn(18, 'Generating captions', `High-accuracy Whisper is transcribing ${detail || 'Indic'} audio...`);
        }
        const groq = await window.electronAPI.transcribeVideoGroq({ videoPath, languageHint: languageHint || 'auto' });
        if (!groq || !groq.ok) {
            throw new Error((groq && groq.error) || 'High-accuracy Whisper failed.');
        }
        const text = String(groq.text || '');
        if (isCaptionRepetitionLoop(text)) {
            throw new Error('High-accuracy Whisper returned a repeated caption loop.');
        }
        return groq;
    }

    async function transcribeWithLocalServer(extractedAudio) {
        const serverUrl = (window.state && window.state.transcribeServerUrl) || 'http://127.0.0.1:8428';
        const audioBase64 = extractedAudio.wavBase64 || audioSamplesToWavBase64(extractedAudio.buffer, 16000);
        const response = await fetch(`${serverUrl}/api/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: 'caption-audio.wav', audioBase64 })
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error((payload && payload.error) || 'Local transcription server failed.');
        }
        const payload = await response.json();
        const text = String((payload && payload.text) || '').trim();
        if (!text) {
            throw new Error('No speech was recognized from the video audio.');
        }

        // ── Use REAL word-level timestamps from Whisper ──────────────────────
        const words    = Array.isArray(payload.words)    ? payload.words    : [];
        const segments = Array.isArray(payload.segments) ? payload.segments : [];
        let chunks = [];

        if (words.length > 0) {
            // Build caption chunks from actual per-word timestamps.
            const CHUNK_SIZE = CAPTION_WORD_LIMIT;
            for (let i = 0; i < words.length; i += CHUNK_SIZE) {
                const slice = words.slice(i, i + CHUNK_SIZE);
                const chunkText = slice.map(w => w.word).join(' ').trim();
                if (!chunkText) continue;
                chunks.push({
                    text: chunkText,
                    timestamp: [slice[0].start, slice[slice.length - 1].end],
                    words: slice.map(w => ({ text: w.word, timestamp: [w.start, w.end] }))
                });
            }
        } else if (segments.length > 0) {
            // Fall back to segment-level timestamps
            chunks = segments
                .filter(s => s.text && s.text.trim())
                .map(s => ({
                    text: s.text.trim(),
                    timestamp: [s.start, s.end],
                    words: s.text.trim().split(/\s+/).map((w, i, arr) => ({
                        text: w,
                        timestamp: [
                            s.start + (i / arr.length) * (s.end - s.start),
                            s.start + ((i + 1) / arr.length) * (s.end - s.start)
                        ]
                    }))
                }));
        } else {
            // Last resort: linear spread using video duration (NOT narration duration)
            const vidDur = (sourceVideo && sourceVideo.duration) || extractedAudio.duration || 60;
            chunks = buildLinearCaptionChunks(text, vidDur, { narrationDurationSec: vidDur });
        }

        return { text, chunks };
    }
    
    function populateEditor() {
        generatedCaptions = removeIgnoredIntroCaptions(generatedCaptions);
        captionList.innerHTML = '';
        generatedCaptions.forEach((chunk, i) => {
            const div = document.createElement('div');
            div.style.cssText = "display: flex; gap: 8px; margin-bottom: 8px; align-items: stretch;";
            div.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:4px; font-family: monospace; background: rgba(0,0,0,0.1); border: 1px solid rgba(255,255,255,0.05); padding: 6px; border-radius: 4px; font-size: 0.75rem; align-items: center; justify-content:center;">
                    <div style="font-size: 0.85rem; font-weight: bold; white-space: nowrap; margin-bottom: 2px;">${formatTime(chunk.timestamp[0])}</div>
                    <div style="display:flex; gap:2px; align-items:center;">
                        <input type="number" step="0.1" title="Start Time (sec)" class="chunk-time-input" data-type="start" data-index="${i}" value="${Number(chunk.timestamp[0]).toFixed(1)}" style="width:50px; text-align:center; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:white; padding:2px; border-radius:2px;">
                        <span style="color:rgba(255,255,255,0.4);">-</span>
                        <input type="number" step="0.1" title="End Time (sec)" class="chunk-time-input" data-type="end" data-index="${i}" value="${Number(chunk.timestamp[1]).toFixed(1)}" style="width:50px; text-align:center; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:white; padding:2px; border-radius:2px;">
                    </div>
                </div>
                <input type="text" class="chunk-editor" style="flex-grow: 1; background: rgba(0,0,0,0.05); border: 1px solid rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; font-family: inherit; font-size: 0.95rem; color: inherit;" value="${chunk.text.replace(/"/g, '&quot;')}" data-index="${i}">
                <input type="color" class="chunk-color-picker" data-index="${i}" title="Speaker Color Override" style="height:auto; min-height:40px; cursor:pointer; background:none; border:none; padding:0;" value="${chunk.colorOverride || '#fde047'}">
                <button class="chunk-remove-btn" title="Remove row" style="background:rgba(255,0,0,0.2); border:1px solid rgba(255,0,0,0.4); color:white; padding:0 8px; border-radius:4px; cursor:pointer;" data-index="${i}">✖</button>
            `;
            captionList.appendChild(div);
        });

        const addBtn = document.createElement('button');
        addBtn.className = 'primary-btn';
        addBtn.style.cssText = 'width: 100%; margin-top: 10px; padding: 10px; border-radius: 4px; border: 1px dashed rgba(255,255,255,0.3); background: rgba(255,255,255,0.05); color: white; cursor: pointer; display: flex; justify-content: center; align-items: center; gap: 6px;';
        addBtn.innerHTML = '<span>+</span><span>Add Caption Row</span>';
        addBtn.onclick = () => {
            const lastChunk = generatedCaptions[generatedCaptions.length - 1];
            let start = lastChunk ? parseFloat(lastChunk.timestamp[1]) : 0;
            let end = start + 2.0;
            generatedCaptions.push({ text: "New Caption", timestamp: [start, end], colorOverride: '#fde047' });
            populateEditor();
        };
        captionList.appendChild(addBtn);

        document.querySelectorAll('#captionList .chunk-editor').forEach(input => {
            input.addEventListener('input', (e) => generatedCaptions[parseInt(e.target.dataset.index)].text = e.target.value);
        });
        document.querySelectorAll('#captionList .chunk-color-picker').forEach(input => {
            input.addEventListener('input', (e) => generatedCaptions[parseInt(e.target.dataset.index)].colorOverride = e.target.value);
        });
        document.querySelectorAll('#captionList .chunk-time-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const index = parseInt(e.target.dataset.index);
                const type = e.target.dataset.type;
                const val = parseFloat(e.target.value) || 0;
                if (type === 'start') generatedCaptions[index].timestamp[0] = val;
                else generatedCaptions[index].timestamp[1] = val;
            });
        });
        document.querySelectorAll('#captionList .chunk-remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                generatedCaptions.splice(index, 1);
                populateEditor();
            });
        });
    }

    // ── Multi-language Caption Translator ───────────────────────────────────
    const TRANSLATE_SERVER = 'http://127.0.0.1:8434';

    async function translateCaptionsTo(targetLang) {
        if (!generatedCaptions || !generatedCaptions.length) {
            statusText.innerHTML = '⚠️ Generate or load captions first, then translate.';
            return;
        }
        const langLabel = { en: 'English', hi: 'हिंदी (Hindi)', te: 'తెలుగు (Telugu)' }[targetLang] || targetLang;
        statusText.innerHTML = `🌐 Translating ${generatedCaptions.length} captions to ${langLabel}...`;

        // Highlight active button
        ['En','Hi','Te'].forEach(l => {
            const b = document.getElementById('captionTranslate' + l + 'Btn');
            if (b) b.style.opacity = (l.toLowerCase() === targetLang) ? '1' : '0.5';
        });

        const pBar = document.getElementById('captionProgressBarValue');
        if (pBar) pBar.style.width = '10%';

        // Check server health first
        try {
            const health = await fetch(`${TRANSLATE_SERVER}/health`, { signal: AbortSignal.timeout(3000) });
            if (!health.ok) throw new Error('Server not ready');
        } catch (e) {
            statusText.innerHTML = `❌ Translation server not running. Please start <b>Translate-Server.cmd</b> in D:\\voice\\ then try again.`;
            return;
        }

        // Batch translate all caption texts
        const texts = generatedCaptions.map(c => c.text);
        try {
            const resp = await fetch(`${TRANSLATE_SERVER}/api/translate/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ texts, target: targetLang, source: 'auto' })
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const results = data.results || [];

            // Apply translations back into captions
            results.forEach((translated, i) => {
                if (generatedCaptions[i] && translated) {
                    generatedCaptions[i].text = translated;
                    // Rebuild word list for translated text (re-split by words)
                    if (generatedCaptions[i].words) {
                        const ts = generatedCaptions[i].timestamp;
                        const dur = ts[1] - ts[0];
                        const words = translated.split(/\s+/).filter(Boolean);
                        generatedCaptions[i].words = words.map((w, wi) => ({
                            text: w,
                            timestamp: [ts[0] + (wi / words.length) * dur,
                                        ts[0] + ((wi + 1) / words.length) * dur]
                        }));
                    }
                }
            });

            if (pBar) pBar.style.width = '100%';
            editorPanel.style.display = 'block';
            populateEditor();
            statusText.innerHTML = `✅ Translated ${results.length} captions to ${langLabel}. Edit if needed, then Export.`;
        } catch(e) {
            statusText.innerHTML = `❌ Translation failed: ${e.message}`;
            if (pBar) pBar.style.width = '0%';
        }
    }

    // Wire translation buttons
    const translateEnBtn = document.getElementById('captionTranslateEnBtn');
    const translateHiBtn = document.getElementById('captionTranslateHiBtn');
    const translateTeBtn = document.getElementById('captionTranslateTeBtn');
    if (translateEnBtn) translateEnBtn.addEventListener('click', () => translateCaptionsTo('en'));
    if (translateHiBtn) translateHiBtn.addEventListener('click', () => translateCaptionsTo('hi'));
    if (translateTeBtn) translateTeBtn.addEventListener('click', () => translateCaptionsTo('te'));

    const CAPTION_LANGUAGE_TO_CODE = {
        English: 'en',
        Hindi: 'hi',
        Telugu: 'te'
    };

    async function translateCaptionsForSelectedLanguage(language) {
        const target = CAPTION_LANGUAGE_TO_CODE[language || 'English'] || 'en';
        if (target !== 'en') {
            await translateCaptionsTo(target);
            return;
        }
        ['En','Hi','Te'].forEach(l => {
            const b = document.getElementById('captionTranslate' + l + 'Btn');
            if (b) b.style.opacity = l === 'En' ? '1' : '0.5';
        });
    }

    function openLocalAiVideoCaptioningSection() {
        setTimeout(() => {
            const section = document.getElementById('aiCaptionSection');
            if (section) {
                section.setAttribute('open', '');
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (videoInput) {
                videoInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 350);
    }

    async function importIntoLocalAiVideoCaptioning(detail) {
        if (isExtractingText) {
            if (statusText) statusText.innerHTML = 'A caption transcription is already running. Please let it finish; a duplicate job was not started.';
            return;
        }
        const pathFiles = Array.from((detail && detail.filePaths) || [])
            .map(filePath => {
                const normalizedPath = String(filePath || '').trim();
                if (!normalizedPath) return null;
                return {
                    name: normalizedPath.split(/[\\/]/).pop() || 'translated-video.mp4',
                    type: 'video/mp4',
                    path: normalizedPath
                };
            })
            .filter(Boolean);
        const files = [
            ...pathFiles,
            ...Array.from((detail && detail.files) || [])
        ].filter(file => file && file.type && file.type.startsWith('video/'));
        if (!files.length) return;
        const readyCaptions = Array.isArray(detail.captions)
            ? detail.captions
                .map(caption => {
                    const timestamp = Array.isArray(caption.timestamp) ? caption.timestamp : [caption.start, caption.end];
                    const start = Math.max(0, Number(timestamp[0]) || 0);
                    const end = Math.max(start + 0.12, Number(timestamp[1]) || 0);
                    const text = String(caption.text || '').replace(/\s+/g, ' ').trim();
                    if (!text) return null;
                    const words = Array.isArray(caption.words) && caption.words.length
                        ? caption.words
                        : text.split(/\s+/).filter(Boolean).map((word, index, all) => ({
                            text: word,
                            timestamp: [
                                start + (index / Math.max(1, all.length)) * (end - start),
                                start + ((index + 1) / Math.max(1, all.length)) * (end - start)
                            ]
                        }));
                    return { text, timestamp: [start, end], words };
                })
                .filter(Boolean)
            : [];
        window.__presentatorAiVideoCaptioningHandled = true;
        openLocalAiVideoCaptioningSection();
        captionVideoQueue = files.map(file => ({
            file,
            status: readyCaptions.length ? 'transcribed' : 'ready',
            captions: readyCaptions.length ? JSON.parse(JSON.stringify(readyCaptions)) : [],
            captionLanguage: detail.language || 'English'
        }));
        captionQueueIndex = 0;
        loadQueuedCaptionVideo(0);
        if (readyCaptions.length) {
            generatedCaptions = JSON.parse(JSON.stringify(readyCaptions));
            if (captionVideoQueue[0]) {
                captionVideoQueue[0].captions = JSON.parse(JSON.stringify(readyCaptions));
                captionVideoQueue[0].status = 'transcribed';
            }
            editorPanel.classList.remove('hidden');
            editorPanel.style.display = 'block';
            actionBtn.classList.add('hidden');
            exportBtn.classList.remove('hidden');
            if (previewBtn) previewBtn.classList.remove('hidden');
            if (eraseBtn) eraseBtn.classList.remove('hidden');
            setCaptionExportActionsVisible(false);
            const pBar = document.getElementById('captionProgressBarValue');
            if (pBar) pBar.style.width = '100%';
            populateEditor();
            renderCaptionQueue();
        }
        if (statusText) {
            statusText.innerHTML = readyCaptions.length
                ? `Loaded ${readyCaptions.length} transcribed captions from Translate Audio. Caption language: ${detail.language || 'English'}.`
                : `Loaded ${files.length} video${files.length === 1 ? '' : 's'} from Translate Audio. Caption language: ${detail.language || 'English'}.`;
        }
        if (detail.autoStart !== false) {
            if (readyCaptions.length) {
                await translateCaptionsForSelectedLanguage(detail.language || 'English');
                return;
            }
            if (captionVideoQueue.length > 1) {
                await transcribeCaptionQueueFrom(0);
                return;
            }
            await transcribeActiveCaptionVideo();
            await translateCaptionsForSelectedLanguage(detail.language || 'English');
        }
    }

    window.addEventListener('presentator-open-ai-video-captioning-local', openLocalAiVideoCaptioningSection);
    window.addEventListener('presentator-ai-video-captioning-import', (event) => {
        importIntoLocalAiVideoCaptioning(event.detail || {}).catch(error => {
            console.error('[Caption] Translate Audio handoff failed:', error);
            if (statusText) statusText.innerHTML = `Caption handoff failed: ${error.message || error}`;
        });
    });
    if (window.__presentatorPendingAiVideoCaptioning) {
        importIntoLocalAiVideoCaptioning(window.__presentatorPendingAiVideoCaptioning).catch(error => {
            console.error('[Caption] Pending Translate Audio handoff failed:', error);
        });
        window.__presentatorPendingAiVideoCaptioning = null;
    }
    // ── "Use Voice Text as Captions" button ─────────────────────────────────
    const voiceTextBtn = document.getElementById('captionUseVoiceTextBtn');
    if (voiceTextBtn) {
        voiceTextBtn.addEventListener('click', () => {
            // Read narration text from state (accumulated across all slides)
            const narText = (
                (window.state && Array.isArray(window.state.allNarrationTexts) && window.state.allNarrationTexts.length
                    ? window.state.allNarrationTexts.join(' ')
                    : window.state && window.state.lastNarrationText) ||
                localStorage.getItem('pp_last_narration_text') ||
                ''
            ).trim();
            const narVoice = (
                (window.state && window.state.lastNarrationVoice) ||
                localStorage.getItem('pp_last_narration_voice') ||
                'anjali'
            );

            if (!narText) {
                statusText.innerHTML = '⚠️ No voice narration found. Generate narration first, then open caption studio.';
                return;
            }

            const duration = sourceVideo ? (sourceVideo.duration || 60) : 60;
            // Use actual narration duration (state.narration.durationMs) if available
            // so chunk timestamps reflect real speech speed rather than video length.
            const chunks   = buildLinearCaptionChunks(narText, duration);


            if (!chunks.length) {
                statusText.innerHTML = '⚠️ Could not build captions from voice text.';
                return;
            }

            // Convert to caption format with word-level data
            generatedCaptions = chunks.map(c => {
                const words = c.text.split(/\s+/).filter(Boolean);
                const chunkDur = c.timestamp[1] - c.timestamp[0];
                return {
                    text: c.text,
                    timestamp: c.timestamp,
                    words: words.map((w, i) => ({
                        text: w,
                        timestamp: [
                            c.timestamp[0] + (i / words.length) * chunkDur,
                            c.timestamp[0] + ((i + 1) / words.length) * chunkDur
                        ]
                    }))
                };
            });

            const langLabel = {
                'anjali': 'English SC3', 'pattan': 'English Pattan',
                'hindi': 'Hindi', 'telugu': 'Telugu', 'edge': 'Edge TTS'
            }[narVoice] || narVoice;

            statusText.innerHTML = `✅ ${generatedCaptions.length} caption chunks built from ${langLabel} voice text (${narText.length} chars). Edit below if needed.`;

            editorPanel.style.display = 'block';
            editorPanel.classList.remove('hidden');
            actionBtn.classList.add('hidden');
            exportBtn.classList.remove('hidden');
            if (previewBtn) previewBtn.classList.remove('hidden');
            setCaptionExportActionsVisible(false);
            const pBar = document.getElementById('captionProgressBarValue');
            if (pBar) pBar.style.width = '100%';
            populateEditor();
        });
    }

    async function transcribeActiveCaptionVideo() {
        if (isExtractingText) return;
        isExtractingText = true;
        captionTranscriptionCancelRequested = false;
        actionBtn.disabled = false;
        actionBtn.textContent = 'Cancel Transcription';
        actionBtn.classList.remove('hidden');
        const showSingleProgress = !captionQueueRunning && !captionQueueExporting;
        const updateSingleProgress = (pct, phase, detail) => {
            if (showSingleProgress) renderSingleCaptionProgress(pct, phase, detail);
        };

        // Clear old captions so wrong content never shows
        generatedCaptions = [];

        const pBar = document.getElementById('captionProgressBarValue');
        const captionProgress = document.getElementById('captionProgress');
        if (captionProgress) captionProgress.classList.remove('hidden');
        if (pBar) pBar.style.width = '1%';
        updateSingleProgress(1, 'Preparing captions', (activeFile && activeFile.name) || 'Current video');

        function finaliseCaptions() {
            if (!generatedCaptions.length) {
                autoBurnRequested = false;
                statusText.innerHTML = 'No speech was detected in this video, so there are no captions to burn.';
                actionBtn.textContent = 'Generate Captions';
                actionBtn.classList.remove('hidden');
                exportBtn.classList.add('hidden');
                if (previewBtn) previewBtn.classList.add('hidden');
                setCaptionExportActionsVisible(false);
                hideSingleCaptionProgress();
                return;
            }
            editorPanel.classList.remove('hidden');
            populateEditor();
            actionBtn.classList.add('hidden');
            exportBtn.classList.remove('hidden');
            if (previewBtn) previewBtn.classList.remove('hidden');
            setCaptionExportActionsVisible(false);
            if (captionVideoQueue[captionQueueIndex]) {
                captionVideoQueue[captionQueueIndex].captions = JSON.parse(JSON.stringify(generatedCaptions));
                captionVideoQueue[captionQueueIndex].status = 'transcribed';
                renderCaptionQueue();
            }
            sourceVideo.pause(); sourceVideo.currentTime = 0;
            clearPreviewFrameHandle(); renderPreviewNow(0); updatePlayPauseLabel();
            const sourceName = activeFile && activeFile.name ? activeFile.name : 'video';
            updateSingleProgress(100, 'Captions ready', `${generatedCaptions.length} captions generated`);
            speakCaptionStudio(`Captioning complete. ${sourceName}`);
            notifyCaptionStudio('Captioning complete', sourceName);
            if (autoBurnRequested) {
                autoBurnRequested = false;
                exportBtn.textContent = 'Burning Karaoke Captions...';
                setTimeout(() => exportBtn.click(), 150);
            }
        }

        function showManualCaptionInput() {
            const existing = document.getElementById('manualCaptionBox');
            if (existing) existing.remove();
            const dur = sourceVideo ? (sourceVideo.duration || 60) : 60;
            const box = document.createElement('div');
            box.id = 'manualCaptionBox';
            box.style.margin = '16px 0';
            box.style.padding = '18px';
            box.style.background = 'rgba(20,20,50,0.97)';
            box.style.border = '2px solid rgba(255,200,0,0.6)';
            box.style.borderRadius = '14px';
            const lbl = document.createElement('div');
            lbl.style.cssText = 'font-size:13px;font-weight:800;color:#fde047;margin-bottom:10px';
            lbl.innerHTML = 'No speech found — type captions below (each line = one card):';
            const ta = document.createElement('textarea');
            ta.id = 'manualCaptionText';
            ta.placeholder = 'Welcome!\nLesson starts here.\nThank you.';
            ta.style.cssText = 'width:100%;min-height:120px;box-sizing:border-box;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:14px;padding:12px;font-family:inherit;resize:vertical;display:block;margin-top:8px';
            const burnBtn = document.createElement('button');
            burnBtn.textContent = 'Burn Captions on Video';
            burnBtn.style.cssText = 'margin-top:10px;padding:11px 24px;border:none;border-radius:10px;background:linear-gradient(135deg,#e53935,#b71c1c);color:#fff;font-size:14px;font-weight:800;cursor:pointer';
                        burnBtn.style.cssText = 'margin-top:10px;padding:11px 24px;border:none;border-radius:10px;background:linear-gradient(135deg,#e53935,#b71c1c);color:#fff;font-size:14px;font-weight:800;cursor:pointer';
                        // Audio file picker button
                        const audioPickBtn = document.createElement('button');
                        audioPickBtn.textContent = 'Pick Narration Audio File & Auto-Caption';
                        audioPickBtn.title = 'Pick a WAV/MP3 narration file — it will be merged into the video and Whisper will transcribe the real voice';
                        audioPickBtn.style.cssText = 'margin-top:10px;padding:11px 22px;border:1px solid rgba(99,179,237,0.7);border-radius:10px;background:rgba(49,130,206,0.25);color:#90cdf4;font-size:13px;font-weight:700;cursor:pointer;display:block';
                        const audioFileInput = document.createElement('input');
                        audioFileInput.type = 'file';
                        audioFileInput.accept = '.wav,.mp3,.ogg,.aac,.m4a';
                        audioFileInput.style.display = 'none';
                        audioPickBtn.onclick = () => audioFileInput.click();
                        audioFileInput.onchange = async () => {
                            const f = audioFileInput.files[0];
                            if (!f) return;
                            const audioPath = window.electronAPI && typeof window.electronAPI.getPathForFile === 'function' ? window.electronAPI.getPathForFile(f) : (f.path || '');
                            if (!audioPath) { alert('Cannot get file path — please use a local file'); return; }
                            if (!videoPath) { alert('Load a video first'); return; }
                            box.remove();
                            statusText.innerHTML = 'Merging narration audio into video...';
                            if (pBar) pBar.style.width = '30%';
                            try {
                                const mergeResult = await window.electronAPI.mergeAudioIntoVideo({ videoPath, audioPath });
                                if (!mergeResult || !mergeResult.ok) throw new Error(mergeResult && mergeResult.error || 'Merge failed');
                                if (pBar) pBar.style.width = '50%';
                                statusText.innerHTML = 'Merged! Transcribing with Whisper...';
                                const ipc2 = await window.electronAPI.transcribeVideo({ videoPath: mergeResult.outputPath });
                                if (pBar) pBar.style.width = '100%';
                                if (ipc2 && ipc2.ok && ipc2.text && ipc2.text.trim().length > 3) {
                                    const words2 = Array.isArray(ipc2.words) ? ipc2.words : [];
                                    const segs2 = Array.isArray(ipc2.segments) ? ipc2.segments : [];
                                    if (words2.length > 0) {
                                        generatedCaptions = [];
                                        for (let i = 0; i < words2.length; i += CAPTION_WORD_LIMIT) {
                                            const sl = words2.slice(i, i + CAPTION_WORD_LIMIT);
                                            const txt = sl.map(w => w.word).join(' ').trim();
                                            if (txt) generatedCaptions.push({ text: txt, timestamp: [sl[0].start, sl[sl.length-1].end], words: sl.map(w => ({ text: w.word, timestamp: [w.start, w.end] })) });
                                        }
                                    } else if (segs2.length > 0) {
                                        generatedCaptions = segs2.map(s => ({ text: s.text.trim(), timestamp: [s.start, s.end], words: [] }));
                                    } else {
                                        generatedCaptions = buildLinearCaptionChunks(ipc2.text, sourceVideo.duration || 60, { narrationDurationSec: sourceVideo.duration || 60 });
                                    }
                                    statusText.innerHTML = generatedCaptions.length + ' captions from narration audio (Whisper)';
                                    finaliseCaptions();
                                } else {
                                    statusText.innerHTML = 'Transcription returned no speech — type captions manually';
                                    showManualCaptionInput();
                                }
                            } catch(mergeErr) {
                                statusText.innerHTML = 'Error: ' + mergeErr.message;
                                console.error(mergeErr);
                            }
                        };
                        box.appendChild(audioFileInput);
                        box.appendChild(audioPickBtn);
            box.appendChild(lbl); box.appendChild(ta); box.appendChild(burnBtn);
            statusText.parentElement.insertBefore(box, statusText.nextSibling);
            burnBtn.onclick = () => {
                const rawText = (ta.value || '').trim();
                if (!rawText) { alert('Please type some caption text first.'); return; }
                const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
                const vidDur = sourceVideo ? (sourceVideo.duration || 60) : 60;
                generatedCaptions = lines.map((line, i) => {
                    const start = (i / lines.length) * vidDur;
                    const end = ((i + 1) / lines.length) * vidDur;
                    const wds = line.split(/\s+/);
                    return { text: line, timestamp: [start, end], words: wds.map((w, wi) => ({ text: w, timestamp: [start + (wi/wds.length)*(end-start), start + ((wi+1)/wds.length)*(end-start)] })) };
                });
                box.remove();
                statusText.innerHTML = generatedCaptions.length + ' captions ready';
                finaliseCaptions();
            };
        }

        try {
            // PATH 1: Electron IPC — FFmpeg extracts audio, Whisper returns real word timestamps
            const hasIpc = window.electronAPI && typeof window.electronAPI.transcribeVideo === 'function';
            const videoPath = activeFile
                ? (activeFile.path || ((window.electronAPI && typeof window.electronAPI.getPathForFile === 'function')
                    ? window.electronAPI.getPathForFile(activeFile)
                    : ''))
                : '';
            if (/\.part\.mp4$/i.test(videoPath)) {
                throw new Error('This is an unfinished .part.mp4 export. Use the original video or a completed MP4, then generate captions again.');
            }

            if (hasIpc && videoPath) {
                const fileLangHint = likelyIndicCaptionFileName(activeFile);
                if (fileLangHint && window.electronAPI && typeof window.electronAPI.transcribeVideoGroq === 'function') {
                    try {
                        const langName = fileLangHint === 'te' ? 'Telugu' : fileLangHint === 'hi' ? 'Hindi' : 'Auto-Detect';
                        const groq = await transcribeVideoWithGroqForIndic(videoPath, fileLangHint || 'auto', langName, updateSingleProgress);
                        generatedCaptions = buildCaptionChunksFromTranscription(groq, sourceVideo.duration || 60);
                        if (generatedCaptions.length) {
                            if (pBar) pBar.style.width = '100%';
                            updateSingleProgress(100, 'Captions ready', `${generatedCaptions.length} fast Groq captions generated`);
                            statusText.innerHTML = '\u2705 ' + generatedCaptions.length + ` captions generated with Groq API (Fast)`;
                            finaliseCaptions(); return;
                        }
                        throw new Error('Groq API returned no usable speech captions.');
                    } catch (groqFirstErr) {
                        const groqMessage = groqFirstErr && groqFirstErr.message
                            ? groqFirstErr.message
                            : String(groqFirstErr || 'Groq API is unavailable.');
                        console.warn('[Caption] Groq transcription stopped:', groqFirstErr);
                        statusText.innerHTML = `&#9888; Caution: Groq API (Fast) could not generate captions. ${groqMessage}`;
                        updateSingleProgress(0, 'Caption generation stopped', groqMessage);
                        throw new Error(`Caution: Groq API (Fast) is required. ${groqMessage}`);
                    }
                } else if (fileLangHint) {
                    statusText.innerHTML = '&#9888; Caution: Groq API (Fast) is unavailable. Caption generation was stopped.';
                    updateSingleProgress(0, 'Caption generation stopped', 'Groq API is unavailable.');
                    throw new Error('Caution: Groq API (Fast) is unavailable.');
                }

                statusText.innerHTML = '\u23f3 Analysing video audio with Whisper AI (30\u201390s)...';
                if (pBar) pBar.style.width = '8%';
                updateSingleProgress(8, 'Preparing audio', 'Checking video and audio stream...');
                let ipcShownPct = 8;
                const ipcStartedAt = Date.now();
                const ipcHeartbeat = setInterval(() => {
                    if (!isExtractingText) return;
                    ipcShownPct = Math.min(95, ipcShownPct + (ipcShownPct < 20 ? 2 : ipcShownPct < 45 ? 4 : ipcShownPct < 75 ? 2 : 0.15));
                    const elapsedMinutes = Math.max(0, (Date.now() - ipcStartedAt) / 60000);
                    if (pBar) pBar.style.width = ipcShownPct + '%';
                    statusText.innerHTML = `Whisper is actively transcribing (${elapsedMinutes.toFixed(1)} minutes elapsed). The percentage is estimated; click Cancel Transcription to stop safely.`;
                    updateSingleProgress(ipcShownPct, ipcShownPct < 20 ? 'Extracting audio' : 'Transcribing captions', `Processing locally — ${elapsedMinutes.toFixed(1)} min elapsed (estimated progress)`);
                }, 900);
                let ipc = null;
                try {
                    const queueLanguage = String(captionVideoQueue[captionQueueIndex]?.captionLanguage || '').toLowerCase();
                    const languageHint = queueLanguage.includes('telugu') ? 'te' : (queueLanguage.includes('hindi') ? 'hi' : (queueLanguage.includes('english') ? 'en' : 'auto'));
                    activeCaptionTranscription = { videoPath, languageHint };
                    ipc = await window.electronAPI.transcribeVideo({ videoPath, languageHint });
                } finally {
                    clearInterval(ipcHeartbeat);
                    activeCaptionTranscription = null;
                }

                if ((ipc && ipc.cancelled) || captionTranscriptionCancelRequested) {
                    statusText.innerHTML = 'Transcription cancelled. The video is still loaded and ready to restart.';
                    updateSingleProgress(0, 'Cancelled', 'No caption export was started');
                    if (captionVideoQueue[captionQueueIndex]) {
                        captionVideoQueue[captionQueueIndex].status = 'ready';
                        captionVideoQueue[captionQueueIndex].progress = 0;
                        renderCaptionQueue();
                    }
                    return;
                }

                if (ipc && ipc.ok) {
                    if (pBar) pBar.style.width = '100%';
                    updateSingleProgress(100, 'Captions ready', 'Transcription finished');

                    // No speech/audio detected in this video
                    if (!ipc.text || ipc.text.trim().length < 3) {
                        statusText.innerHTML = 'No speech detected in this video audio. Upload a video with speech to auto-burn synced karaoke captions.';
                        autoBurnRequested = false;
                        actionBtn.textContent = 'Generate Captions';
                        hideSingleCaptionProgress();
                        return;
                    }

                    const localLangCode = normalizeCaptionLanguageCode(ipc.language) || inferCaptionLanguageCode(ipc.text);
                    if (isIndicCaptionLanguage(localLangCode) && window.electronAPI && typeof window.electronAPI.transcribeVideoGroq === 'function') {
                        try {
                            const langName = localLangCode === 'te' ? 'Telugu' : localLangCode === 'hi' ? 'Hindi' : 'Indic';
                            statusText.innerHTML = `Local Whisper detected ${langName}; switching to high-accuracy captions...`;
                            const groq = await transcribeVideoWithGroqForIndic(videoPath, localLangCode, langName, updateSingleProgress);
                            generatedCaptions = buildCaptionChunksFromTranscription(groq, sourceVideo.duration || 60);
                            if (generatedCaptions.length) {
                                statusText.innerHTML = '\u2705 ' + generatedCaptions.length + ` ${langName} captions from high-accuracy Whisper`;
                                finaliseCaptions(); return;
                            }
                        } catch (groqErr) {
                            console.warn('[Caption] High-accuracy Indic retry failed, using local result:', groqErr);
                        }
                    }

                    // Real speech found
                    const words    = Array.isArray(ipc.words)    ? ipc.words    : [];
                    const segments = Array.isArray(ipc.segments) ? ipc.segments : [];
                    if (words.length > 0) {
                        for (let i = 0; i < words.length; i += CAPTION_WORD_LIMIT) {
                            const sl = words.slice(i, i + CAPTION_WORD_LIMIT);
                            const txt = sl.map(w => w.word).join(' ').trim();
                            if (txt) generatedCaptions.push({ text: txt, timestamp: [sl[0].start, sl[sl.length-1].end], words: sl.map(w => ({ text: w.word, timestamp: [w.start, w.end] })) });
                        }
                    } else if (segments.length > 0) {
                        generatedCaptions = segments.filter(s => s.text && s.text.trim()).map(s => ({
                            text: s.text.trim(), timestamp: [s.start, s.end],
                            words: s.text.trim().split(/\s+/).map((w,i,a) => ({ text: w, timestamp: [s.start+(i/a.length)*(s.end-s.start), s.start+((i+1)/a.length)*(s.end-s.start)] }))
                        }));
                    } else {
                        const dur = sourceVideo.duration || 60;
                        generatedCaptions = buildLinearCaptionChunks(ipc.text, dur, { narrationDurationSec: dur });
                    }
                    statusText.innerHTML = '\u2705 ' + generatedCaptions.length + ' captions from video audio (Whisper)';
                    finaliseCaptions(); return;
                }
                console.warn('[Caption] IPC failed:', ipc && ipc.error);
                statusText.innerHTML = '\u26a0\ufe0f IPC failed \u2014 trying HTTP server...';
            }

            // PATH 2: HTTP transcription server (port 8428)
            statusText.innerHTML = 'Extracting audio from video...';
            if (pBar) pBar.style.width = '8%';
            updateSingleProgress(8, 'Extracting audio', 'Preparing audio from video...');
            audioDataArray = await extractAudio(activeFile);
            if (pBar) pBar.style.width = '20%';
            updateSingleProgress(20, 'Transcribing captions', 'Sending audio to caption engine...');
            try {
                statusText.innerHTML = 'Sending to Whisper server (port 8428)...';
                const svr = await transcribeWithLocalServer(audioDataArray);
                if (pBar) pBar.style.width = '100%';
                updateSingleProgress(100, 'Captions ready', 'Caption engine finished');
                if (svr && svr.chunks && svr.chunks.length > 0) {
                    generatedCaptions = svr.chunks;
                    statusText.innerHTML = generatedCaptions.length + ' captions from video audio';
                    finaliseCaptions(); return;
                }
            } catch (svrErr) {
                console.warn('[Caption] HTTP server failed:', svrErr.message);
                statusText.innerHTML = 'Server unavailable - using browser AI...';
            }

            // PATH 3: Browser Whisper worker (offline fallback)
            if (!captionWorker) {
                statusText.innerHTML = 'Initializing browser AI engine...';
                const ws = `let p,e,t=null;function s(d){if(!d)return null;try{return JSON.parse(JSON.stringify(d));}catch(x){return{status:d.status,text:d.text||'',timestamp:d.timestamp||null};}}self.onmessage=async(ev)=>{if(ev.data.type==='init'){try{if(!p){const m=await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.16.1');p=m.pipeline;e=m.env;e.allowLocalModels=true;e.allowRemoteModels=false;e.localModelPath=ev.data.modelPath||'http://127.0.0.1:5173/AI_Models/';e.useBrowserCache=true;}if(!t){t=await p('automatic-speech-recognition','Xenova/whisper-tiny.en',{quantized:true,progress_callback:d=>self.postMessage({type:'progress',data:s(d)})});}self.postMessage({type:'init_done'});}catch(er){self.postMessage({type:'error',error:er.message});}}else if(ev.data.type==='transcribe'){try{const r=await t(ev.data.audioDataArray,{...ev.data.options,chunk_callback:c=>self.postMessage({type:'chunk_progress',chunk:s(c),duration:ev.data.duration})});self.postMessage({type:'result',result:s(r)});}catch(er){self.postMessage({type:'error',error:er.message});}}};`;
                const blob = new Blob([ws], { type: 'application/javascript' });
                captionWorker = new Worker(URL.createObjectURL(blob));
                await new Promise((res, rej) => {
                    captionWorker.onerror = ev => rej(new Error('Worker: ' + (ev.message || 'fail')));
                    captionWorker.onmessage = ev => {
                        if (ev.data.type === 'init_done') res();
                        else if (ev.data.type === 'progress' && ev.data.data && ev.data.data.status === 'downloading') {
                            const pct = Math.round(ev.data.data.progress || 0);
                            statusText.innerHTML = 'Downloading AI model: ' + pct + '%';
                            if (pBar) pBar.style.width = (15 + pct * 0.15) + '%';
                            updateSingleProgress(15 + pct * 0.15, 'Generating captions', 'Downloading browser AI model...');
                        } else if (ev.data.type === 'error') rej(new Error(ev.data.error || 'init failed'));
                    };
                    captionWorker.postMessage({ type: 'init', modelPath: window.location.origin + '/AI_Models/' });
                });
            }
            if (pBar) pBar.style.width = '30%';
            updateSingleProgress(30, 'Generating captions', 'Browser AI is transcribing audio...');
            const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: 'word' };
            const translateCheck = document.getElementById('captionTranslateCheck');
            if (translateCheck && translateCheck.checked) opts.task = 'translate';
            const workerResult = await new Promise((res, rej) => {
                captionWorker.onerror = ev => rej(new Error('Worker crash: ' + (ev.message || 'unknown')));
                captionWorker.onmessage = ev => {
                    if (ev.data.type === 'chunk_progress' && ev.data.chunk && ev.data.chunk.timestamp && ev.data.chunk.timestamp[1] !== null) {
                        const pct = Math.min(Math.round((ev.data.chunk.timestamp[1] / (ev.data.duration || 60)) * 100), 100);
                        statusText.innerHTML = 'Transcribing... ' + pct + '% complete - ' + Math.max(0, 100 - pct) + '% remaining';
                        if (pBar) pBar.style.width = pct + '%';
                        updateSingleProgress(pct, 'Generating captions', 'Transcribing video audio...');
                    } else if (ev.data.type === 'result') { if (pBar) pBar.style.width = '100%'; res(ev.data.result); }
                    else if (ev.data.type === 'error') rej(new Error(ev.data.error || 'failed'));
                };
                captionWorker.postMessage({ type: 'transcribe', audioDataArray: audioDataArray.buffer, options: opts, duration: sourceVideo.duration || 60 });
            });
            let cur = null;
            (workerResult.chunks || []).forEach(c => {
                const txt = c.text.replace(/\[.*?\]|\(.*?\)|♪|♫/g,'').trim();
                if (!txt) return;
                let ts = Array.isArray(c.timestamp) ? c.timestamp : [0,0];
                if (ts[0]===null) ts[0]=cur?cur.timestamp[1]:0;
                if (ts[1]===null) ts[1]=ts[0]+0.5;
                if (!cur) { cur={text:txt,timestamp:[...ts],words:[{text:txt,timestamp:[...ts]}]}; }
                else { cur.text+=' '+txt; cur.timestamp[1]=ts[1]; cur.words.push({text:txt,timestamp:[...ts]}); }
                if (/[.!?]$/.test(txt)||cur.words.length>=CAPTION_WORD_LIMIT){generatedCaptions.push(cur);cur=null;}
            });
            if (cur) generatedCaptions.push(cur);
            if (generatedCaptions.length === 0 && workerResult.text) {
                const dur = sourceVideo.duration || 60;
                generatedCaptions = buildLinearCaptionChunks(workerResult.text.replace(/\[.*?\]|\(.*?\)|♪|♫/g,'').trim(), dur, { narrationDurationSec: dur });
            }
            if (!generatedCaptions.length) {
                statusText.innerHTML = 'No speech detected in this video audio. Upload a video with speech to auto-burn synced karaoke captions.';
                autoBurnRequested = false;
                actionBtn.textContent = 'Generate Captions';
                hideSingleCaptionProgress();
                return;
            }
            statusText.innerHTML = generatedCaptions.length + ' captions from video audio';
            finaliseCaptions();

        } catch (error) {
            statusText.innerHTML = 'Error: ' + (error.message || 'Unknown error');
            console.error('[Caption]', error);
            if (captionVideoQueue[captionQueueIndex]) {
                captionVideoQueue[captionQueueIndex].status = 'failed';
                renderCaptionQueue();
            }
        } finally {
            isExtractingText = false;
            activeCaptionTranscription = null;
            captionTranscriptionCancelRequested = false;
            if (!captionQueueRunning && !captionQueueExporting) {
                actionBtn.disabled = false;
                if (!generatedCaptions.length) {
                    actionBtn.textContent = captionVideoQueue.length > 1 ? 'Generate Queue' : 'Generate Captions';
                    actionBtn.classList.remove('hidden');
                }
            }
        }
    }

    actionBtn.addEventListener('click', async () => {
        if (isExtractingText) {
            if (captionTranscriptionCancelRequested) return;
            captionTranscriptionCancelRequested = true;
            actionBtn.disabled = true;
            actionBtn.textContent = 'Cancelling...';
            statusText.innerHTML = 'Cancelling the active local Whisper job...';
            if (activeCaptionTranscription && window.electronAPI && typeof window.electronAPI.cancelTranscribeVideo === 'function') {
                try {
                    await window.electronAPI.cancelTranscribeVideo(activeCaptionTranscription);
                } catch (error) {
                    console.error('[Caption] Cancel failed:', error);
                }
            }
            return;
        }
        if (captionQueueRunning || captionQueueExporting) return;
        if (captionVideoQueue.length > 1) await transcribeCaptionQueueFrom(captionQueueIndex);
        else await transcribeActiveCaptionVideo();
    });


        function getVisibleCaptionText(fullText, activeWordIndex, maxWords = CAPTION_WORD_LIMIT) {
            const words = String(fullText || '').trim().split(/\s+/).filter(Boolean);
            if (words.length <= maxWords) return words.join(' ');
            const safeIndex = activeWordIndex >= 0 ? activeWordIndex : 0;
            const groupStart = Math.floor(safeIndex / maxWords) * maxWords;
            return words.slice(groupStart, groupStart + maxWords).join(' ');
        }

        function getWrappedCaptionLines(ctx, text, maxWidth) {
            const safeText = String(text || '').trim();
            if (!safeText) return [];
            if (!window._textWrapCache) window._textWrapCache = {};
            const fontStr = ctx.font;
            const cacheKey = `${safeText}_${maxWidth}_${fontStr}`;
            if (window._textWrapCache[cacheKey]) return window._textWrapCache[cacheKey];
            const words = safeText.split(/\s+/);
            const lines = [];
            let line = '';
            for (let n = 0; n < words.length; n += 1) {
                const testLine = line + words[n] + ' ';
                if (ctx.measureText(testLine).width > maxWidth && n > 0) {
                    lines.push(line);
                    line = words[n] + ' ';
                } else {
                    line = testLine;
                }
            }
            if (line.trim()) lines.push(line);
            window._textWrapCache[cacheKey] = lines;
            return lines;
        }

        function getCaptionBottomSafety(fontSize, lineHeight, lineCount = 1) {
            return CAPTION_BOTTOM_OFFSET_PX;
        }

        function getBottomAnchoredCaptionCenterY(targetHeight, fontSize, lineHeight, lineCount) {
            const blockHeight = Math.max(lineHeight, lineCount * lineHeight);
            return Math.max(blockHeight / 2, targetHeight - getCaptionBottomSafety(fontSize, lineHeight, lineCount) - blockHeight / 2);
        }

        function drawWrappedText(ctx, fullText, x, y, maxWidth, lineHeight, elapsedTime, styleType, activeWordIndex = -1, targetEmoji = null, fontSize = 50, colorOverride = null) {
        let text = fullText;

        if (styleType === 'white-yellow' && activeWordIndex === -1) return;
        text = getVisibleCaptionText(fullText, activeWordIndex, CAPTION_WORD_LIMIT);

        let lines = getWrappedCaptionLines(ctx, text, maxWidth);

        ctx.save();
        ctx.translate(x, y);

        const globalColor = colorOverride || (colorPicker ? colorPicker.value : '#fde047');
        const strokeScale = strokeSlider ? parseInt(strokeSlider.value) / 100 : 0.8;
        const baseStrokeWidth = styleType === 'white-yellow' ? 0 : Math.max(0, Math.floor(lineHeight * 0.15 * strokeScale));
        const shouldStroke = baseStrokeWidth > 0 && styleType !== 'glitch' && styleType !== 'retro' && styleType !== 'white-yellow';

        let currentY = -(lines.length * lineHeight) / 2 + lineHeight / 2;
        
        // Draw floating Emoji Reaction on top of caption block if requested
        if (targetEmoji) {
            ctx.save();
            // Pop bounce animation based on time
            const emojiScale = elapsedTime < 0.2 ? 0.5 + (Math.sin(elapsedTime / 0.2 * Math.PI / 2) * 0.7) : 1.2;
            ctx.scale(emojiScale, emojiScale);
            ctx.font = `900 ${fontSize * 1.5}px sans-serif`;
            ctx.fillText(targetEmoji, 0, - (lines.length * lineHeight)/2 - Math.max(30, fontSize));
            ctx.restore();
        }

        const renderLine = (txt, yPos, wordCursorStart, drawShadowFx) => {
            if (activeWordIndex === -1 || styleType === 'typewriter' || styleType === 'glitch') {
                if (drawShadowFx) drawShadowFx();
                if (shouldStroke) ctx.strokeText(txt, 0, yPos);
                ctx.fillText(txt, 0, yPos);
                return txt.trim().split(/\s+/).length;
            } else {
                if (!window._wordWidthCache) window._wordWidthCache = {};
                const fontKey = ctx.font;
                const getW = (textFrag) => {
                     const key = textFrag + "_" + fontKey;
                     if (!window._wordWidthCache[key]) window._wordWidthCache[key] = ctx.measureText(textFrag).width;
                     return window._wordWidthCache[key];
                };

                if (drawShadowFx) drawShadowFx(); // Compute massive canvas shader setup ONCE outside word loops!
                const wds = txt.trim().split(/\s+/);
                const measuredLine = wds.join(' ');
                let cx = -getW(measuredLine) / 2;
                const spaceW = getW(' ');

                for(let w = 0; w < wds.length; w++) {
                    const bw = getW(wds[w]);
                    const isFocus = (wordCursorStart + w === activeWordIndex);
                    const ogAlpha = ctx.globalAlpha;
                    const ogFill = ctx.fillStyle;
                    
                    if (!isFocus) {
                        if (styleType === 'white-yellow') {
                            ctx.globalAlpha = ogAlpha;
                            ctx.fillStyle = '#ffffff';
                        } else {
                            ctx.globalAlpha = ogAlpha * 0.3;
                            ctx.fillStyle = '#ffffff';
                        }
                    } else {
                        if (styleType === 'white-yellow') {
                            ctx.fillStyle = '#fde047';
                        }
                    }
                    
                    if (shouldStroke) ctx.strokeText(wds[w], cx + bw/2, yPos);
                    ctx.fillText(wds[w], cx + bw/2, yPos);
                    
                    if (!isFocus || styleType === 'white-yellow') { ctx.globalAlpha = ogAlpha; ctx.fillStyle = ogFill; }
                    cx += bw + spaceW;
                }
                return wds.length;
            }
        };

        let wordCursor = 0;

        if (styleType === 'tiktok' || styleType === 'white-yellow') {
            let scale = 1.0;
            if (styleType !== 'white-yellow') {
                if (elapsedTime < 0.15) scale = 0.5 + (Math.sin((elapsedTime / 0.15) * Math.PI / 2) * 0.6); 
                else if (elapsedTime < 0.25) scale = 1.1 - ((elapsedTime - 0.15) / 0.1) * 0.1;
            }
            ctx.scale(scale, scale);
            
            ctx.lineWidth = styleType === 'white-yellow' ? 0 : baseStrokeWidth * 1.5; ctx.lineJoin = 'round';
            ctx.strokeStyle = '#000000'; ctx.fillStyle = (styleType === 'white-yellow') ? '#fde047' : globalColor; 
            
            for(let i = 0; i < lines.length; i++) {
                wordCursor += renderLine(lines[i].trim(), currentY, wordCursor, () => {
                    if (styleType === 'white-yellow') {
                        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
                    } else {
                        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 10; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 4;
                    }
                });
                currentY += lineHeight;
            }
        } 
        else if (styleType === 'classic') {
            ctx.fillStyle = 'rgba(0,0,0,0.8)';
            let maxLineWidth = 0;
            lines.forEach(l => { const w = ctx.measureText(l).width; if(w > maxLineWidth) maxLineWidth = w; });
            ctx.fillRect( -maxLineWidth/2 - 20, -(lines.length * lineHeight)/2 - 10, maxLineWidth + 40, lines.length * lineHeight + 20);
            
            ctx.fillStyle = globalColor;
            for(let i = 0; i < lines.length; i++) {
                wordCursor += renderLine(lines[i].trim(), currentY, wordCursor, () => { ctx.shadowColor='transparent'; });
                currentY += lineHeight;
            }
        }
        else if (styleType === 'cinematic') {
            if (elapsedTime < 0.4) ctx.globalAlpha = elapsedTime / 0.4;
            else ctx.globalAlpha = 1.0;
            
            ctx.fillStyle = globalColor;
            for(let i = 0; i < lines.length; i++) {
                wordCursor += renderLine(lines[i].trim(), currentY, wordCursor, () => {
                     ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 15; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
                });
                currentY += lineHeight;
            }
        }
        else if (styleType === 'neon') {
            if (elapsedTime < 0.1) ctx.globalAlpha = elapsedTime / 0.1;
            ctx.fillStyle = '#ffffff';
            for(let i = 0; i < lines.length; i++) {
                if (activeWordIndex === -1) {
                    ctx.shadowColor = globalColor; ctx.shadowBlur = 25;
                    ctx.fillText(lines[i].trim(), 0, currentY); ctx.fillText(lines[i].trim(), 0, currentY);
                } else {
                    wordCursor += renderLine(lines[i].trim(), currentY, wordCursor, () => {
                        ctx.shadowColor = globalColor; ctx.shadowBlur = 25;
                    });
                }
                currentY += lineHeight;
            }
        }
        else if (styleType === 'glitch') {
            ctx.lineWidth = baseStrokeWidth; ctx.lineJoin = 'round'; ctx.strokeStyle = '#000000';
            
            let xr = 0, yr = 0, xb = 0, yb = 0;
            if (elapsedTime < 0.3 || Math.random() > 0.95) {
                xr = (Math.random() - 0.5) * 15; yr = (Math.random() - 0.5) * 15;
                xb = (Math.random() - 0.5) * 15; yb = (Math.random() - 0.5) * 15;
            }
            
            for(let i = 0; i < lines.length; i++) {
                const txt = lines[i].trim();
                ctx.fillStyle = '#ff003c'; ctx.fillText(txt, xr, currentY + yr);
                ctx.fillStyle = '#00f0ff'; ctx.fillText(txt, xb, currentY + yb);
                
                ctx.fillStyle = globalColor;
                if(baseStrokeWidth > 0) ctx.strokeText(txt, 0, currentY);
                ctx.fillText(txt, 0, currentY);
                currentY += lineHeight;
            }
        }
        else if (styleType === 'vaporwave') {
            ctx.lineWidth = baseStrokeWidth; ctx.lineJoin = 'round'; ctx.strokeStyle = '#2b00ff';
            ctx.fillStyle = globalColor;
            
            const tilt = Math.sin(elapsedTime * 2) * 0.05;
            ctx.rotate(tilt);
            
            for(let i = 0; i < lines.length; i++) {
                wordCursor += renderLine(lines[i].trim(), currentY, wordCursor, () => {
                   ctx.shadowColor = '#ff00c8'; ctx.shadowBlur = 15; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 4; 
                });
                currentY += lineHeight;
            }
        }
        else if (styleType === 'retro') {
            const floatY = Math.floor(Math.sin(elapsedTime * 6)) * 8;
            ctx.translate(0, floatY);
            ctx.lineWidth = baseStrokeWidth; ctx.lineJoin = 'miter'; ctx.miterLimit = 2;
            ctx.strokeStyle = '#000'; ctx.fillStyle = globalColor;
            
            for(let i = 0; i < lines.length; i++) {
                if(baseStrokeWidth > 0) {
                    ctx.shadowColor = 'rgba(0,0,0,1)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 6; ctx.shadowOffsetY = 6;
                    ctx.strokeText(lines[i].trim(), 0, currentY);
                    ctx.shadowColor = 'transparent';
                }
                wordCursor += renderLine(lines[i].trim(), currentY, wordCursor, () => {
                    ctx.shadowColor = 'rgba(0,0,0,1)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 5;
                });
                currentY += lineHeight;
            }
        }
        else if (styleType === 'typewriter') {
            ctx.fillStyle = 'rgba(0,0,0,0.85)';
            // Box width must comfortably fit the largest cached line statically!
            let maxLineWidth = 0;
            lines.forEach(l => { const w = ctx.measureText(l.trim()).width; if(w > maxLineWidth) maxLineWidth = w; });
            maxLineWidth = Math.min(maxLineWidth, maxWidth);
            ctx.fillRect( -maxLineWidth/2 - 20, -(lines.length * lineHeight)/2 - 10, maxLineWidth + 40, lines.length * lineHeight + 20);
            
            ctx.fillStyle = globalColor;
            let charsAllowed = Math.floor(elapsedTime * 25);
            
            for(let i = 0; i < lines.length; i++) {
                let txt = lines[i].trim();
                let txtToDraw = txt;
                if (charsAllowed <= 0) break;
                if (charsAllowed < txt.length) txtToDraw = txt.slice(0, charsAllowed);
                
                ctx.fillText(txtToDraw, 0, currentY);
                charsAllowed -= txt.length + 1; // Accommodate the implicitly consumed line-wrap space
                currentY += lineHeight;
            }
        }

        ctx.restore();
    }

    function renderCaptionFrame(ctx, targetWidth, targetHeight, time, options = {}) {
      const isPreviewSurface = options.isPreviewSurface !== false;
      if (!ctx) return;
      if (!ctx.imageSmoothingEnabled) ctx.imageSmoothingEnabled = true;

      try {
        const filter = filterSelect ? filterSelect.value : 'none';
        let targetFilter = 'none';
        if (filter === 'darken') targetFilter = 'brightness(50%)';
        else if (filter === 'blur') targetFilter = 'blur(10px)';
        else if (filter === 'grayscale') targetFilter = 'grayscale(100%)';
        else if (filter === 'sepia') targetFilter = 'sepia(100%)';
        else if (filter === 'invert') targetFilter = 'invert(100%) hue-rotate(180deg)';

        if (ctx.filter !== targetFilter) ctx.filter = targetFilter;

        if (sourceVideo.readyState >= 2) { // HAVE_CURRENT_DATA
            try {
                ctx.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);
            } catch(ev) {}
        }
        
        if (ctx.filter !== 'none') ctx.filter = 'none';
        
        const offset = syncSlider ? parseInt(syncSlider.value) / 1000 : 0;
        const adjustedTime = time - offset;
        
        // Use backward array search to guarantee that if two chunks overlap due to trailing silence or gap optimizations,
        // the newly started sequential chunk immediately claims the screen render, preventing display masks!
        let currentChunk = null;
        for (let i = generatedCaptions.length - 1; i >= 0; i--) {
            if (adjustedTime >= generatedCaptions[i].timestamp[0] && adjustedTime <= generatedCaptions[i].timestamp[1]) {
                currentChunk = generatedCaptions[i];
                break;
            }
        }
        
        if (currentChunk && currentChunk.text) {
             let useMusic = bgMusicAudio && !bgMusicAudio.paused;
             if (bgMusicCheck && !bgMusicCheck.checked) useMusic = false;
             if (useMusic) bgMusicAudio.volume = 0.1; // Ducking active
             
             const brollImage = getBrollForText(currentChunk.text);
             if (brollImage && brollImage.complete && brollImage.width > 0 && brollImage.height > 0) {
                 ctx.save();
                 ctx.globalAlpha = 0.8;
                 const wr = targetWidth / brollImage.width; const hr = targetHeight / brollImage.height;
                 const scale = Math.max(wr, hr);
                 const ix = (targetWidth / 2) - (brollImage.width / 2) * scale;
                 const iy = (targetHeight / 2) - (brollImage.height / 2) * scale;
                 if (isImageReady(brollImage)) { ctx.drawImage(brollImage, ix, iy, brollImage.width * scale, brollImage.height * scale); }
                 ctx.restore();
             }

            const fontSize = Math.max(12, Math.floor(sizeSlider ? parseInt(sizeSlider.value) : 35));
            
            const gapMult = (gapSlider ? parseInt(gapSlider.value) : 120) / 100;
            const lineHeight = fontSize * gapMult;

            const maxWBase = targetWidth;
            const widthMult = (widthSlider ? parseInt(widthSlider.value) : 85) / 100;
            const maxWidth = maxWBase * widthMult;
            
             let activeWordIndex = -1;
             const isKaraoke = karaokeCheck && karaokeCheck.checked;
             if (isKaraoke) {
                  const rawWords = currentChunk.text.trim().split(/\s+/);
                  const totalWords = rawWords.length;
                  
                  if (currentChunk.words && currentChunk.words.length === totalWords) {
                       let foundIdx = currentChunk.words.findIndex(w => {
                           const start = Array.isArray(w.timestamp) ? Number(w.timestamp[0]) : NaN;
                           const rawEnd = Array.isArray(w.timestamp) ? Number(w.timestamp[1]) : NaN;
                           const end = Number.isFinite(rawEnd) ? rawEnd : (Number.isFinite(start) ? start + 0.2 : NaN);
                           return Number.isFinite(start) && Number.isFinite(end) && adjustedTime >= start && adjustedTime < end;
                       });
                       if (foundIdx < 0) {
                           foundIdx = currentChunk.words.findIndex((w, index) => {
                               const next = currentChunk.words[index + 1];
                               const rawEnd = Array.isArray(w.timestamp) ? Number(w.timestamp[1]) : NaN;
                               const nextStart = next && Array.isArray(next.timestamp) ? Number(next.timestamp[0]) : NaN;
                               return Number.isFinite(rawEnd)
                                   && adjustedTime >= rawEnd
                                   && adjustedTime < rawEnd + SHORT_CAPTION_GAP_SECONDS
                                   && (!Number.isFinite(nextStart) || adjustedTime < nextStart);
                           });
                       }
                       activeWordIndex = foundIdx;
                  } else {
                       const chunkDuration = currentChunk.timestamp[1] - currentChunk.timestamp[0];
                       const elapsedTime = adjustedTime - currentChunk.timestamp[0];
                       const timePerWord = chunkDuration / Math.max(1, totalWords);
                       if (timePerWord <= 0 || isNaN(timePerWord)) activeWordIndex = 0;
                       else activeWordIndex = Math.floor(elapsedTime / timePerWord);
                  }
                  
                  if (activeWordIndex >= totalWords) activeWordIndex = totalWords - 1;
                  if (activeWordIndex < 0 || isNaN(activeWordIndex)) activeWordIndex = -1;
                  
                  if (activeWordIndex !== -1 && activeWordIndex !== lastSfxWordIndex) {
                       const wordObj = currentChunk.text.trim().split(' ')[activeWordIndex];
                       if (wordObj) {
                           const word = wordObj.toLowerCase().replace(/[^a-z0-9]/g, '');
                           if (['boom','bang','pow','crash','smash'].includes(word)) playSfx('pop');
                           else if (['fast','whoosh','zoom','fly','run','speed'].includes(word)) playSfx('whoosh');
                           else if (['money','cash','buy','dollar','rich','wealth'].includes(word)) playSfx('pop');
                           else if (Math.random() > 0.85) playSfx('pop');
                       }
                       lastSfxWordIndex = activeWordIndex;
                  }
             } else {
                  lastSfxWordIndex = -1;
             }

            let targetEmoji = null;
            const useEmoji = emojiCheck && emojiCheck.checked;
            if (useEmoji) targetEmoji = getEmojiForText(currentChunk.text);

            const fontFamily = fontSelect ? fontSelect.value : 'Nunito, sans-serif';
            ctx.font = `900 ${fontSize}px ${fontFamily}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const visibleCaptionText = getVisibleCaptionText(currentChunk.text.trim(), activeWordIndex, CAPTION_WORD_LIMIT);
            const wrappedLines = getWrappedCaptionLines(ctx, visibleCaptionText, maxWidth);
            const anchoredY = getBottomAnchoredCaptionCenterY(targetHeight, fontSize, lineHeight, Math.max(1, wrappedLines.length));
            
            drawWrappedText(ctx, currentChunk.text.trim(), targetWidth * captionPosX, anchoredY, maxWidth, lineHeight, adjustedTime - currentChunk.timestamp[0], styleSelect.value, activeWordIndex, targetEmoji, fontSize, currentChunk.colorOverride);
          } else {
            let useMusic = bgMusicAudio && !bgMusicAudio.paused;
            if (bgMusicCheck && !bgMusicCheck.checked) useMusic = false;
            if (useMusic) bgMusicAudio.volume = 0.5; // Ducking inactive
            lastSfxWordIndex = -1;
        }

        if (sharedWatermarkImage && sharedWatermarkImage.complete && (!watermarkCheck || watermarkCheck.checked)) {
            ctx.save();
            ctx.globalAlpha = 0.5;
            const wmWidth = targetWidth * 0.15;
            const wmHeight = (wmWidth / sharedWatermarkImage.width) * sharedWatermarkImage.height;
            if (isImageReady(sharedWatermarkImage)) { ctx.drawImage(sharedWatermarkImage, targetWidth - wmWidth - 40, 40, wmWidth, wmHeight); }
            ctx.restore();
        }

        if (progressCheck && progressCheck.checked) {
            const duration = sourceVideo.duration || 1;
            const progress = time / duration;
            const globalColor = colorPicker ? colorPicker.value : '#fde047';
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8;
            ctx.fillStyle = globalColor;
            const barHeight = 15;
            ctx.fillRect(0, targetHeight - barHeight, targetWidth * progress, barHeight);
            ctx.restore();
        }
      } catch (err) {
         // Silently catch exceptions so the loop survives rendering failures
      }
    }

    function getCaptionSourcePath() {
        try {
            if (!activeFile) return "";
            const sourcePath = activeFile.path || ((window.electronAPI && typeof window.electronAPI.getPathForFile === 'function')
                ? (window.electronAPI.getPathForFile(activeFile) || "")
                : "");
            if (/\.part\.mp4$/i.test(sourcePath)) {
                throw new Error('This is an unfinished .part.mp4 export. Use the original video or a completed MP4, then generate captions again.');
            }
            return sourcePath;
        } catch (error) {
            console.warn('[Caption Export] Could not read source file path:', error);
            if (statusText) statusText.innerHTML = String(error && error.message ? error.message : error);
            return "";
        }
    }

    function getCaptionSyncOffsetSeconds() {
        const rawValue = syncSlider ? Number(syncSlider.value) : 0;
        return Number.isFinite(rawValue) ? rawValue / 1000 : 0;
    }

    function getValidatedCaptionBurnList() {
        const duration = Number(sourceVideo.duration) || 0;
        const syncOffset = getCaptionSyncOffsetSeconds();
        const sorted = (generatedCaptions || [])
            .map((caption) => {
                const timestamp = Array.isArray(caption.timestamp) ? caption.timestamp : [0, 0];
                const start = Math.max(0, Number(timestamp[0]) + syncOffset);
                const rawEnd = Number(timestamp[1]);
                const end = Math.max(start + 0.12, (Number.isFinite(rawEnd) ? rawEnd : timestamp[0] + 2) + syncOffset);
                return {
                    text: stripIgnoredIntroCaption(caption.text, start),
                    start,
                    end: duration > 0 ? Math.min(end, duration) : end
                };
            })
            .filter((caption) => caption.text && caption.end > caption.start)
            .sort((a, b) => a.start - b.start);

        for (let index = 0; index < sorted.length - 1; index += 1) {
            if (sorted[index].end > sorted[index + 1].start) {
                sorted[index].end = Math.max(sorted[index].start + 0.12, sorted[index + 1].start - 0.02);
            } else if (sorted[index + 1].start - sorted[index].end <= SHORT_CAPTION_GAP_SECONDS) {
                sorted[index].end = sorted[index + 1].start;
            }
        }
        return sorted;
    }

    function toAssTimestamp(seconds) {
        const value = Math.max(0, Number(seconds) || 0);
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        const secs = Math.floor(value % 60);
        const centis = Math.min(99, Math.floor((value - Math.floor(value)) * 100));
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
    }

    function escapeAssCaptionText(value) {
        return String(value || '')
            .replace(/\\/g, '\\\\')
            .replace(/\{/g, '\\{')
            .replace(/\}/g, '\\}')
            .replace(/\r?\n/g, '\\N');
    }

    function hexToAss(value, fallback) {
        const hex = /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
        return `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3).toUpperCase()}&`;
    }

    function getAssStyleConfig(styleType, fontSize, userColor, strokeValue) {
        const highlight = styleType === 'white-yellow' ? '#facc15' : userColor;
        const activeColor = hexToAss(highlight, '#facc15');
        const inactiveColor = styleType === 'white-yellow'
            ? '&H00FFFFFF&'
            : '&H00FFFFFF&';
        const baseTextColor = styleType === 'white-yellow' ? '&H00FFFFFF&' : activeColor;
        const outlineBase = Math.max(0, Math.round(fontSize * 0.12 * strokeValue));

        let borderStyle = 1;
        let outline = outlineBase;
        let shadow = 4;
        let backColor = '&H64000000&';
        let outlineColor = '&H00000000&';

        if (styleType === 'classic' || styleType === 'typewriter') {
            borderStyle = 3;
            outline = 0;
            shadow = 0;
            backColor = '&H33000000&';
        } else if (styleType === 'cinematic') {
            outline = Math.max(1, Math.round(outlineBase * 0.75));
            shadow = 3;
            backColor = '&HFF000000&';
        } else if (styleType === 'neon') {
            outline = Math.max(1, Math.round(outlineBase * 0.65));
            shadow = 8;
            backColor = '&HFF000000&';
        } else if (styleType === 'glitch') {
            outline = Math.max(1, outlineBase);
            shadow = 1;
            backColor = '&HFF000000&';
        } else if (styleType === 'retro') {
            outline = Math.max(2, Math.round(outlineBase * 1.2));
            shadow = 6;
            backColor = '&HFF000000&';
        } else if (styleType === 'white-yellow') {
            outline = 0;
            shadow = 0;
            backColor = '&HFF000000&';
        } else {
            outline = Math.max(2, outlineBase);
            shadow = 4;
            backColor = '&HFF000000&';
        }

        return { activeColor, inactiveColor, baseTextColor, outlineColor, backColor, borderStyle, outline, shadow };
    }

    function buildPreviewMatchedAss() {
        const width = sourceVideo.videoWidth || renderCanvas.width || 1920;
        const height = sourceVideo.videoHeight || renderCanvas.height || 1080;
        const fontSize = Math.max(12, Math.round(sizeSlider ? Number(sizeSlider.value) : 35));
        const selectedStyle = styleSelect ? styleSelect.value : 'white-yellow';
        const userColor = colorPicker ? colorPicker.value : '#fde047';
        const strokeValue = (strokeSlider ? Number(strokeSlider.value) : 80) / 100;
        const assStyle = getAssStyleConfig(selectedStyle, fontSize, userColor, strokeValue);
        const { activeColor, inactiveColor, baseTextColor, outlineColor, backColor, borderStyle, outline, shadow } = assStyle;
        const x = Math.round(width * captionPosX);
        const captionAnchor = 2;
        const widthMult = (widthSlider ? Number(widthSlider.value) : 85) / 100;
        const sideMargin = Math.max(20, Math.round(width * (1 - widthMult) / 2));
        const marginV = CAPTION_BOTTOM_OFFSET_PX;
        const syncOffset = getCaptionSyncOffsetSeconds();
        const selectedFont = String(fontSelect ? fontSelect.value : 'Nunito').split(',')[0].replace(/["']/g, '').trim() || 'Nunito';
        // Local AI captions always export as word-by-word karaoke fill.
        const isKaraoke = true;
        if (karaokeCheck) karaokeCheck.checked = true;
        const useEmoji = emojiCheck && emojiCheck.checked;
        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d');
        if (measureCtx) measureCtx.font = `900 ${fontSize}px ${selectedFont}`;
        const wrapTokensForAss = (tokens) => {
            if (!measureCtx) return [tokens];
            const maxWidth = width * widthMult;
            const lines = [];
            let line = [];
            for (const token of tokens) {
                const testLine = [...line, token].join(' ');
                if (line.length && measureCtx.measureText(testLine).width > maxWidth) {
                    lines.push(line);
                    line = [token];
                } else {
                    line.push(token);
                }
            }
            if (line.length) lines.push(line);
            return lines.length ? lines : [tokens];
        };
        const assBottomY = (tokens) => {
            const lineCount = wrapTokensForAss(tokens).length;
            const lineHeight = fontSize * 1.2;
            return height - getCaptionBottomSafety(fontSize, lineHeight, lineCount);
        };

        const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Preview,${selectedFont},${fontSize},${activeColor},${inactiveColor},${outlineColor},${backColor},-1,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${captionAnchor},${sideMargin},${sideMargin},${marginV},1\nStyle: Progress,Arial,10,${activeColor},${activeColor},${activeColor},${activeColor},0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`;
        const events = [];
        const exportWordLimit = CAPTION_WORD_LIMIT;

        for (const caption of removeIgnoredIntroCaptions(generatedCaptions)) {
            const textTokens = String(caption.text || '').trim().split(/\s+/).filter(Boolean);
            if (!textTokens.length || !Array.isArray(caption.timestamp)) continue;
            const capStart = Math.max(0, Number(caption.timestamp[0]) + syncOffset);
            const capEnd = Math.max(capStart + 0.1, Number(caption.timestamp[1]) + syncOffset);
            const sourceWords = Array.isArray(caption.words) && caption.words.length === textTokens.length
                ? caption.words.map((word, index) => {
                    const stamp = Array.isArray(word.timestamp) ? word.timestamp : [];
                    return {
                        text: textTokens[index],
                        start: Math.max(capStart, Number(stamp[0]) + syncOffset),
                        end: Math.min(capEnd, Number(stamp[1]) + syncOffset),
                    };
                })
                : textTokens.map((text, index) => ({
                    text,
                    start: capStart + (index / textTokens.length) * (capEnd - capStart),
                    end: capStart + ((index + 1) / textTokens.length) * (capEnd - capStart),
                }));
            const captionGroups = [];
            for (let groupStart = 0; groupStart < textTokens.length; groupStart += exportWordLimit) {
                const groupTokens = textTokens.slice(groupStart, groupStart + exportWordLimit);
                const groupWords = sourceWords.slice(groupStart, groupStart + exportWordLimit);
                const groupStartTime = groupWords[0] ? groupWords[0].start : capStart;
                const groupEndTime = groupWords[groupWords.length - 1] ? groupWords[groupWords.length - 1].end : capEnd;
                captionGroups.push({
                    tokens: groupTokens,
                    words: groupWords,
                    start: Math.max(capStart, groupStartTime),
                    end: Math.max(groupStartTime + 0.1, Math.min(capEnd, groupEndTime)),
                });
            }
            const emoji = useEmoji ? getEmojiForText(caption.text) : null;
            const emojiPrefix = emoji
                ? `{\\fnSegoe UI Emoji\\fs${Math.round(fontSize * 1.5)}\\1c&H00FFFFFF&}${escapeAssCaptionText(emoji)}\\N{\\fn${escapeAssCaptionText(selectedFont)}\\fs${fontSize}}`
                : '';

            captionGroups.forEach(group => {
                if (!group.tokens.length) return;
                const y = assBottomY(group.tokens);
                const wrappedTokenLines = wrapTokensForAss(group.tokens);
                if (!isKaraoke) {
                    const wholeText = wrappedTokenLines
                        .map(line => line.map(escapeAssCaptionText).join(' '))
                        .join('\\N');
                    events.push(`Dialogue: 0,${toAssTimestamp(group.start)},${toAssTimestamp(group.end)},Preview,,0,0,0,,{\\an${captionAnchor}\\pos(${x},${y})\\1c${baseTextColor}}${emojiPrefix}${wholeText}`);
                    return;
                }

                // Display the complete current phrase while karaoke timing
                // progressively highlights each narrated word.
                let tokenCursor = 0;
                const karaokeText = wrappedTokenLines.map(lineTokens => {
                    const lineText = lineTokens.map((token) => {
                        const wordIndex = tokenCursor;
                        tokenCursor += 1;
                        const word = group.words[wordIndex];
                        const nextWord = group.words[wordIndex + 1];
                        const wordStart = Number.isFinite(word?.start) ? word.start : group.start;
                        const wordEnd = Number.isFinite(nextWord?.start)
                            ? Math.min(group.end, nextWord.start)
                            : (Number.isFinite(word?.end) ? Math.min(group.end, word.end) : group.end);
                        const centiseconds = Math.max(1, Math.round((wordEnd - wordStart) * 100));
                        return `{\\kf${centiseconds}}${escapeAssCaptionText(token)}`;
                    }).join(' ');
                    return lineText;
                }).join('\\N');
                events.push(`Dialogue: 0,${toAssTimestamp(group.start)},${toAssTimestamp(group.end)},Preview,,0,0,0,,{\\an${captionAnchor}\\pos(${x},${y})}${emojiPrefix}${karaokeText}`);
            });
        }

        if (progressCheck && progressCheck.checked) {
            const duration = Number(sourceVideo.duration) || 0;
            const slices = Math.max(1, Math.min(120, Math.ceil(duration * 2)));
            for (let index = 0; index < slices; index += 1) {
                const start = duration * index / slices;
                const end = duration * (index + 1) / slices;
                const barWidth = Math.round(width * (index + 1) / slices);
                events.push(`Dialogue: 1,${toAssTimestamp(start)},${toAssTimestamp(end)},Progress,,0,0,0,,{\\an7\\pos(0,${height - 14})\\p1}m 0 0 l ${barWidth} 0 ${barWidth} 14 0 14{\\p0}`);
            }
        }
        return [header, ...events].join('\n');
    }

    sourceVideo.addEventListener('loadedmetadata', () => {
        const ctx = renderCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
    });

    sourceVideo.addEventListener('play', () => {
        updatePlayPauseLabel();
        schedulePreviewFrame();
    });
    sourceVideo.addEventListener('pause', () => {
        clearPreviewFrameHandle();
        updatePlayPauseLabel();
        renderPreviewNow(sourceVideo.currentTime);
    });
    sourceVideo.addEventListener('ended', () => {
        clearPreviewFrameHandle();
        updatePlayPauseLabel();
        if (!isRecording) renderPreviewNow(sourceVideo.currentTime);
    });

    function seekCaptionPreviewTo(time) {
        return new Promise(resolve => {
            const safeTime = Math.max(0, Number(time) || 0);
            const done = () => resolve();
            sourceVideo.addEventListener('seeked', done, { once: true });
            sourceVideo.currentTime = safeTime;
            setTimeout(done, 900);
        });
    }

    if (previewBtn) {
        previewBtn.addEventListener('click', async () => {
            if (isRecording || captionQueueExporting || captionQueueRunning) {
                statusText.innerHTML = 'Preview is paused while export or queue work is running.';
                return;
            }
            if (!sourceVideo.src || !generatedCaptions.length) {
                statusText.innerHTML = 'Generate captions first, then preview.';
                return;
            }

            const duration = Number(sourceVideo.duration) || 0;
            const firstCaption = generatedCaptions.find(c => Array.isArray(c.timestamp) && Number.isFinite(Number(c.timestamp[0])));
            const current = Number(sourceVideo.currentTime) || 0;
            const fallbackStart = firstCaption ? Number(firstCaption.timestamp[0]) : 0;
            const maxStart = duration > 0 ? Math.max(0, duration - 0.25) : fallbackStart;
            const start = Math.max(0, Math.min(current || fallbackStart, maxStart));
            const end = duration > 0 ? Math.min(duration, start + 5) : start + 5;
            const oldText = previewBtn.textContent;

            try {
                previewBtn.disabled = true;
                previewBtn.textContent = 'Previewing 5s...';
                statusText.innerHTML = `Previewing captions for 5 seconds. Check font, placement, color, and ${CAPTION_WORD_LIMIT}-word grouping before export.`;
                sourceVideo.pause();
                await seekCaptionPreviewTo(start);
                renderPreviewNow(start);
                await sourceVideo.play().catch(() => {});
                await new Promise(resolve => {
                    let finished = false;
                    const finish = () => {
                        if (finished) return;
                        finished = true;
                        clearInterval(timer);
                        sourceVideo.removeEventListener('ended', finish);
                        resolve();
                    };
                    const timer = setInterval(() => {
                        if (sourceVideo.currentTime >= end || sourceVideo.ended || sourceVideo.paused) finish();
                    }, 120);
                    sourceVideo.addEventListener('ended', finish, { once: true });
                    setTimeout(finish, 5600);
                });
                sourceVideo.pause();
                renderPreviewNow(sourceVideo.currentTime || start);
                statusText.innerHTML = '5-second preview complete. If it looks correct, export the video.';
            } catch (error) {
                console.error('[Caption Preview]', error);
                statusText.innerHTML = 'Preview failed: ' + (error.message || error);
            } finally {
                previewBtn.disabled = false;
                previewBtn.textContent = oldText || 'Preview 5s';
                updatePlayPauseLabel();
            }
        });
    }

    exportBtn.addEventListener('click', async () => {
        if (isRecording) return;
        isRecording = true;
        setCaptionExportActionsVisible(false);
        exportBtn.textContent = '\u26a1 Express Export...';
        exportBtn.disabled = true;

        // -- FAST PATH: FFmpeg burn-in via IPC (instant - no video playback needed) --
        const _filePath = getCaptionSourcePath();
        const _hasIpc   = window.electronAPI && (
            typeof window.electronAPI.fastBurnAss === 'function' ||
            typeof window.electronAPI.burnCaptions === 'function'
        );
        const _styleName = styleSelect ? styleSelect.value : 'default';

        if (_hasIpc && !_filePath) {
            statusText.innerHTML = '\u274c Export stopped: the original source file path is unavailable. Re-upload the source video and try again.';
            exportBtn.textContent = 'Export Result';
            exportBtn.disabled = false;
            isRecording = false;
            return;
        }

        // Full local-caption exports must use the source file directly. Canvas
        // MediaRecorder can emit a silent audio track and repeat the opening
        // frame when Chromium throttles a hidden video. Native FFmpeg preserves
        // the original frame timestamps and copies the original audio unchanged.
        if (_filePath && _hasIpc && generatedCaptions && generatedCaptions.length > 0) {
            try {
                const captionsForBurn = getValidatedCaptionBurnList();
                if (!captionsForBurn.length) {
                    throw new Error('No valid caption timings are available for export.');
                }
                statusText.innerHTML = '\u26a1 Sync export: 0% complete - 100% remaining';
                renderSingleCaptionProgress(0, 'Exporting captions', (activeFile && activeFile.name) || 'Current video');
                let burnProgressHandler = null;
                let syncShownPct = 0;
                let syncFinalizingTimer = null;
                const showSyncExportProgress = (pct, phaseLabel = 'Sync export') => {
                    syncShownPct = Math.max(syncShownPct, Math.max(0, Math.min(99, Math.round(pct))));
                    statusText.innerHTML = '\u26a1 ' + phaseLabel + ': ' + syncShownPct + '% complete - ' + (100 - syncShownPct) + '% remaining';
                    setCaptionProgressBar(syncShownPct);
                    renderSingleCaptionProgress(syncShownPct, phaseLabel, (activeFile && activeFile.name) || 'Current video');
                };
                syncFinalizingTimer = setInterval(() => {
                    if (!isRecording || syncShownPct < 94 || syncShownPct >= 99) return;
                    showSyncExportProgress(syncShownPct + 1, 'Finalizing export');
                }, 1200);
                if (window.electronAPI && typeof window.electronAPI.onBurnProgress === 'function') {
                    burnProgressHandler = data => {
                        let pct = 0;
                        if (typeof data === 'number') pct = data;
                        else if (data && typeof data.pct === 'number') pct = data.pct;
                        const isFinalizing = data && typeof data === 'object' && data.phase === 'finalizing';
                        showSyncExportProgress(pct, isFinalizing || pct >= 94 ? 'Finalizing export' : 'Sync export');
                    };
                    window.electronAPI.onBurnProgress(burnProgressHandler);
                }
                const _fontSize = Math.max(12, Math.round(Number(sizeSlider && sizeSlider.value) || 35));
                let _result = null;
                try {
                    _result = await window.electronAPI.burnCaptions({
                        videoPath: _filePath,
                        captions: captionsForBurn,
                        style: _styleName,
                        fontSize: _fontSize,
                        position: 'bottom',
                        assContent: buildPreviewMatchedAss()
                    });
                } finally {
                    if (syncFinalizingTimer) clearInterval(syncFinalizingTimer);
                    if (burnProgressHandler && typeof window.electronAPI.offBurnProgress === 'function') {
                        window.electronAPI.offBurnProgress(burnProgressHandler);
                    }
                }
                if (_result && _result.ok) {
                    const completedFileName = _result.fileName || 'captioned video';
                    statusText.innerHTML = '\u2705 Synced caption export done! Saved to Downloads: <strong>' + completedFileName + '</strong>.';
                    setCaptionProgressBar(100);
                    renderSingleCaptionProgress(100, 'Export complete', completedFileName);
                    renderCaptionExportActions(_result, { queueIndex: captionQueueIndex });
                    exportBtn.textContent = 'Export Result';
                    exportBtn.disabled = false;
                    isRecording = false;
                    console.log('[Caption Export] FFmpeg express export done:', _result.outputPath);
                    speakCaptionStudio(`Exporting done. ${completedFileName}`);
                    notifyCaptionStudio('Exporting done', completedFileName);
                    return;
                }
                throw new Error((_result && _result.error) || 'FFmpeg caption export failed.');
            } catch (_ffErr) {
                console.error('[Caption Export] Native FFmpeg export failed:', _ffErr.message);
                statusText.innerHTML = '\u274c Export stopped: native FFmpeg could not preserve the source video and audio. ' + (_ffErr.message || '');
                exportBtn.textContent = 'Export Result';
                exportBtn.disabled = false;
                isRecording = false;
                return;
            }
        }

        // Browser-only fallback. Voice Presentator desktop always uses native
        // FFmpeg above because it preserves source audio and frame timing.

        // FIX 1: Silence to speakers (muted + volume=0)
        const _origMuted  = sourceVideo.muted;
        const _origVolume = sourceVideo.volume;
        sourceVideo.muted  = true;
        sourceVideo.volume = 0;
        sourceVideo.pause();
        sourceVideo.playbackRate = 1.0;

        // FIX 2: Wait for seeked BEFORE starting recorder (prevents 2-sec truncation bug)
        await new Promise(resolve => {
            if (Math.abs(sourceVideo.currentTime) < 0.05) { resolve(); return; }
            sourceVideo.addEventListener('seeked', resolve, { once: true });
            sourceVideo.currentTime = 0;
        });
        sourceVideo.currentTime = 0;
        await new Promise(r => setTimeout(r, 80));

        const _duration = sourceVideo.duration || 0;
        if (!_duration || !isFinite(_duration)) {
            statusText.innerHTML = '\u274c Cannot export: video duration unknown. Try reloading the video.';
            isRecording = false; exportBtn.textContent = 'Export Result'; exportBtn.disabled = false;
            sourceVideo.muted = _origMuted; sourceVideo.volume = _origVolume;
            return;
        }

        const _expW = sourceVideo.videoWidth  || renderCanvas.width;
        const _expH = sourceVideo.videoHeight || renderCanvas.height;
        const _expCanvas = document.createElement('canvas');
        _expCanvas.width = _expW; _expCanvas.height = _expH;
        const _expCtx = _expCanvas.getContext('2d', { alpha: false });
        const _expFps = 30;
        const _expMs  = Math.round(1000 / _expFps);

        renderCaptionFrame(_expCtx, _expW, _expH, 0, { isPreviewSurface: false });

        const _stream = _expCanvas.captureStream(_expFps);

        // FIX 3: AudioContext routes audio to recording ONLY (NOT to speakers)
        let _expAudioCtx = null;
        try {
            _expAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const _dest = _expAudioCtx.createMediaStreamDestination();
            const _src  = _expAudioCtx.createMediaElementSource(sourceVideo);
            _src.connect(_dest); // recording stream ONLY - no connect to _expAudioCtx.destination
            const _aTracks = _dest.stream.getAudioTracks();
            if (_aTracks.length > 0) _stream.addTrack(_aTracks[0]);
        } catch (_aErr) {
            console.warn('[Caption Export] AudioContext failed, exporting video-only:', _aErr.message);
        }

        let _opts = { mimeType: 'video/webm; codecs=vp9' };
        let _ext  = 'webm';
        if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.4d4028, mp4a.40.2"')) {
            _opts = { mimeType: 'video/mp4; codecs="avc1.4d4028, mp4a.40.2"' }; _ext = 'mp4';
        } else if (MediaRecorder.isTypeSupported('video/mp4')) {
            _opts = { mimeType: 'video/mp4' }; _ext = 'mp4';
        } else if (!MediaRecorder.isTypeSupported(_opts.mimeType)) {
            _opts = { mimeType: 'video/webm; codecs=vp8' };
        }
        _opts.videoBitsPerSecond = 12000000;

        const _rec    = new MediaRecorder(_stream, _opts);
        const _chunks = [];
        let   _expDone   = false;
        let   _loopTimer = null;
        let   _progTimer = null;
        let   _watchdog  = null;

        _rec.ondataavailable = e => { if (e.data.size > 0) _chunks.push(e.data); };

        const _finishExport = () => {
            if (_expDone) return;
            _expDone = true;
            if (_loopTimer) { clearInterval(_loopTimer); _loopTimer = null; }
            if (_progTimer) { clearInterval(_progTimer); _progTimer = null; }
            if (_watchdog)  { clearTimeout(_watchdog);  _watchdog  = null; }
            try { renderCaptionFrame(_expCtx, _expW, _expH, _duration, { isPreviewSurface: false }); } catch(e) {}
            _rec.requestData();
            setTimeout(() => { try { _rec.stop(); } catch(e) {} }, 200);
        };

        _rec.onstop = () => {
            if (_loopTimer) clearInterval(_loopTimer);
            if (_progTimer) clearInterval(_progTimer);
            if (_watchdog)  clearTimeout(_watchdog);

            const _blob = new Blob(_chunks, { type: _opts.mimeType.split(';')[0] });
            const _url  = URL.createObjectURL(_blob);
            const _a    = document.createElement('a');
            _a.href = _url; _a.download = 'captioned_video.' + _ext; _a.click();
            URL.revokeObjectURL(_url);

            isRecording = false;
            exportBtn.textContent = 'Export Result';
            exportBtn.disabled    = false;
            statusText.innerHTML  = '\u2705 Export complete! <strong>captioned_video.' + _ext + '</strong> saved to Downloads.';
            speakCaptionStudio(`Exporting done. captioned_video.${_ext}`);
            notifyCaptionStudio('Exporting done', `captioned_video.${_ext}`);

            sourceVideo.pause(); sourceVideo.currentTime = 0;
            sourceVideo.muted = _origMuted; sourceVideo.volume = _origVolume;
            renderPreviewNow(0); updatePlayPauseLabel();
            _stream.getTracks().forEach(t => t.stop());
            if (_expAudioCtx) { try { _expAudioCtx.close(); } catch(e) {} }
            console.log('[Caption Export] Done. Duration:', _duration.toFixed(2) + 's, chunks:', _chunks.length);
            if (window.electronAPI && window.electronAPI.showNotification) {
                window.electronAPI.showNotification('Caption Export', 'Captioned video exported successfully!');
            }
        };

        const _runLoop = () => {
            if (_expDone) return;
            renderCaptionFrame(_expCtx, _expW, _expH, sourceVideo.currentTime, { isPreviewSurface: false });
        };

        // FIX 4: recorder.start(250) with timeslice - ensures data collected throughout (not just on stop)
        _rec.start(250);
        _loopTimer = setInterval(_runLoop, _expMs);
        _runLoop();

        // Real-time 0-100% progress indicator
        _progTimer = setInterval(() => {
            if (_expDone || !isRecording) return;
            const _ct  = sourceVideo.currentTime;
            const _pct = _duration > 0 ? Math.min(100, Math.round((_ct / _duration) * 100)) : 0;
            const _remainingPct = Math.max(0, 100 - _pct);
            const _remainingSec = Math.max(0, _duration - _ct);
            statusText.innerHTML = 'Exporting captioned video: <strong>' + _pct + '%</strong> complete - <strong>' + _remainingPct + '%</strong> remaining&nbsp;&nbsp;(' + _remainingSec.toFixed(1) + 's left / ' + _duration.toFixed(1) + 's total) - please wait...';
            exportBtn.textContent = '\u23f3 Exporting ' + _pct + '%';
            renderSingleCaptionProgress(_pct, 'Exporting captions', (activeFile && activeFile.name) || 'Current video');
        }, 500);

        // FIX 5: Safety watchdog - force stop if ended event never fires
        _watchdog = setTimeout(() => {
            console.warn('[Caption Export] Watchdog triggered at', _duration + 5, 's');
            _finishExport();
        }, (_duration + 5) * 1000);

        statusText.innerHTML = 'Exporting captioned video: <strong>0%</strong> complete - <strong>100%</strong> remaining&nbsp;&nbsp;(' + _duration.toFixed(1) + 's left / ' + _duration.toFixed(1) + 's total) - please wait...';

        try { await sourceVideo.play(); } catch(_pErr) {
            console.warn('[Caption Export] play() rejected:', _pErr);
        }

        // FIX 6: ended event stops recording at true video end
        sourceVideo.addEventListener('ended', () => {
            if (!isRecording) return;
            _finishExport();
        }, { once: true });
    });


    // stageCaptionExportBtn is handled by script.js — do not add a second listener here.


    if (viralShortBtn) {
        viralShortBtn.addEventListener('click', () => {
            if(isRecording || generatedCaptions.length === 0) return;
            // Find most dense 15s window
            let bestStart = 0; let bestEnd = 15; let maxWords = 0;
            for(let i=0; i<Math.max(1, sourceVideo.duration - 15); i+=5) {
                const w = i, e = i+15;
                const score = generatedCaptions.filter(c => c.timestamp[0] >= w && c.timestamp[1] <= e).reduce((acc, c) => acc + c.text.split(' ').length, 0);
                if (score > maxWords) { maxWords = score; bestStart = w; bestEnd = e; }
            }
            
            isRecording = true; viralShortBtn.textContent = 'Recording 15s...'; viralShortBtn.disabled = true;
            statusText.innerHTML = "Slicing Viral 15s Short Region...";
            sourceVideo.pause(); sourceVideo.currentTime = bestStart;
            sourceVideo.playbackRate = 1.0;
            
            const stream = renderCanvas.captureStream(30); // Using 30 to stay perfectly synced
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const destination = audioCtx.createMediaStreamDestination();
            if (!window.__aiAudioSourceMerged) window.__aiAudioSourceMerged = audioCtx.createMediaElementSource(sourceVideo);
            window.__aiAudioSourceMerged.connect(destination); window.__aiAudioSourceMerged.connect(audioCtx.destination);
            if (destination.stream.getAudioTracks().length > 0) stream.addTrack(destination.stream.getAudioTracks()[0]);
            if (sfxDest.stream.getAudioTracks().length > 0) stream.addTrack(sfxDest.stream.getAudioTracks()[0]);
            if (bgMusicAudio && !bgMusicAudio.paused) {
                 if (!window.__aiBgMusicMerged) window.__aiBgMusicMerged = audioCtx.createMediaElementSource(bgMusicAudio);
                 window.__aiBgMusicMerged.connect(destination);
            }

            let options = {};
            let ext = 'webm';
            if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.4d4028, mp4a.40.2"')) {
                options = { mimeType: 'video/mp4; codecs="avc1.4d4028, mp4a.40.2"' };
                ext = 'mp4';
            } else if (MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.4d4028"')) {
                options = { mimeType: 'video/mp4; codecs="avc1.4d4028"' };
                ext = 'mp4';
            } else if (MediaRecorder.isTypeSupported('video/mp4')) {
                options = { mimeType: 'video/mp4' };
                ext = 'mp4';
            } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
                options = { mimeType: 'video/webm; codecs=vp9' };
            } else {
                options = { mimeType: 'video/webm; codecs=vp8' };
            }
            
            // Target 12 Mbps for a balance of small file size and good visual quality
            options.videoBitsPerSecond = 12000000;
            
            const recorder = new MediaRecorder(stream, options);
            const recordedChunks = [];
            recorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
            recorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: options.mimeType.split(';')[0] });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `viral_short_clip.${ext}`; a.click(); URL.revokeObjectURL(url);
                isRecording = false; viralShortBtn.textContent = '✂️ Export 15s Viral Short'; viralShortBtn.disabled = false;
                statusText.innerHTML = "✅ Viral Short Export completed!";
                speakCaptionStudio(`Exporting done. viral_short_clip.${ext}`);
                notifyCaptionStudio('Exporting done', `viral_short_clip.${ext}`);
                sourceVideo.pause(); playPauseBtn.textContent = '▶️ Play';
                stream.getTracks().forEach(track => track.stop());
            };
            recorder.start(); sourceVideo.play(); playPauseBtn.textContent = '⏸️ Pause';
            
            const checkEnd = setInterval(() => {
                if (sourceVideo.currentTime >= bestEnd) {
                    clearInterval(checkEnd);
                    if (isRecording) recorder.stop();
                }
            }, 100);
        });
        
        // Show viral button if video is long enough
        sourceVideo.addEventListener('loadedmetadata', () => {
            if (sourceVideo.duration > 15 && viralShortBtn) viralShortBtn.classList.remove('hidden');
            else if (viralShortBtn) viralShortBtn.classList.add('hidden');
        });
    }

  } catch (err) {
      window.__presentatorCaptionStudioBooted = false;
      setTimeout(() => {
          const st = document.getElementById('captionStatusText');
          if (st) {
              st.innerHTML = `<span style='color:red'>FATAL UI CRASH: ${err.message}</span>`;
              if (st.parentElement) st.parentElement.classList.remove('hidden');
          }
          alert("Caption Studio failed to load: " + err.message);
      }, 500);
      console.error(err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootCaptionStudio, { once: true });
} else {
  bootCaptionStudio();
}
