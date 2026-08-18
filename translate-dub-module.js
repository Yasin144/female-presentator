(function () {
  "use strict";

  if (window.__translateDubModuleLoaded) return;
  window.__translateDubModuleLoaded = true;

  const LANGUAGES = [
    { code: "te", label: "Telugu", voice: "te-IN-ShrutiNeural", voices: [{ id: "te-IN-ShrutiNeural", name: "Shruti — Female" }, { id: "te-IN-MohanNeural", name: "Mohan — Male" }] },
    { code: "hi", label: "Hindi", voice: "hi-IN-SwaraNeural", voices: [{ id: "hi-IN-SwaraNeural", name: "Swara — Female" }, { id: "hi-IN-MadhurNeural", name: "Madhur — Male" }] },
    { code: "en", label: "English", voice: "en-IN-NeerjaNeural", voices: [{ id: "en-IN-NeerjaNeural", name: "Neerja — Female" }, { id: "en-IN-PrabhatNeural", name: "Prabhat — Male" }] },
    { code: "ta", label: "Tamil", voice: "ta-IN-PallaviNeural", voices: [{ id: "ta-IN-PallaviNeural", name: "Pallavi — Female" }, { id: "ta-IN-ValluvarNeural", name: "Valluvar — Male" }] },
    { code: "kn", label: "Kannada", voice: "kn-IN-SapnaNeural", voices: [{ id: "kn-IN-SapnaNeural", name: "Sapna — Female" }, { id: "kn-IN-GaganNeural", name: "Gagan — Male" }] },
    { code: "ml", label: "Malayalam", voice: "ml-IN-SobhanaNeural", voices: [{ id: "ml-IN-SobhanaNeural", name: "Sobhana — Female" }, { id: "ml-IN-MidhunNeural", name: "Midhun — Male" }] },
    { code: "bn", label: "Bengali", voice: "bn-IN-TanishaaNeural", voices: [{ id: "bn-IN-TanishaaNeural", name: "Tanishaa — Female" }, { id: "bn-IN-BashkarNeural", name: "Bashkar — Male" }] },
    { code: "gu", label: "Gujarati", voice: "gu-IN-DhwaniNeural", voices: [{ id: "gu-IN-DhwaniNeural", name: "Dhwani — Female" }, { id: "gu-IN-NiranjanNeural", name: "Niranjan — Male" }] },
    { code: "mr", label: "Marathi", voice: "mr-IN-AarohiNeural", voices: [{ id: "mr-IN-AarohiNeural", name: "Aarohi — Female" }, { id: "mr-IN-ManoharNeural", name: "Manohar — Male" }] },
    { code: "ur", label: "Urdu", voice: "ur-IN-GulNeural", voices: [{ id: "ur-IN-GulNeural", name: "Gul — Female" }, { id: "ur-IN-SalmanNeural", name: "Salman — Male" }] },
  ];

  const state = {
    target: LANGUAGES[0],
    captionLanguage: "Auto Detect",
    voiceEngine: "original",
    file: null,
    filePath: "",
    detectedLanguage: "",
    transcript: "",
    segments: [],
    translatedSegments: [],
    captionSegments: [],
    translated: "",
    audioBase64: "",
    audioUrl: "",
    previewVideoUrl: "",
    exportedVideoPath: "",
    captionedVideoPath: "",
    busy: false,
  };

  const CAPTION_LANGUAGES = [
    { code: "English", label: "English" },
    { code: "Telugu", label: "Telugu" },
    { code: "Hindi", label: "Hindi" },
    { code: "Tamil", label: "Tamil" }, { code: "Kannada", label: "Kannada" },
    { code: "Malayalam", label: "Malayalam" }, { code: "Bengali", label: "Bengali" },
    { code: "Gujarati", label: "Gujarati" }, { code: "Marathi", label: "Marathi" },
    { code: "Urdu", label: "Urdu" },
  ];

  let root;
  let navButton;
  let els = {};

  function ensureStyles() {
    if (document.querySelector('link[data-tdub-style="true"]')) return;
    const script = document.currentScript;
    const href = script && script.src
      ? script.src.replace(/translate-dub-module\.js(?:\?.*)?$/, "translate-dub-module.css")
      : "../translate-dub-module.css";
    if (!href || href === script?.src) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.tdubStyle = "true";
    document.head.appendChild(link);
  }

  function api() {
    return window.electronAPI || {};
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function stripIgnoredIntroCaption(value, startSeconds) {
    const text = cleanText(value);
    if (!text || Number(startSeconds) > 12) return text;
    const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (/^(?:info|in fo|infor|in fore|and) (?:for |four )?kids$/.test(normalized)) return "";
    if (/^(?:info|in fo|infor|in fore) kids$/.test(normalized)) return "";
    return text;
  }

  function getPreviewCaptionSegments() {
    const source = state.captionSegments.length ? state.captionSegments : (state.translatedSegments.length ? state.translatedSegments : state.segments);
    return (source || []).filter((segment) => {
      const start = Number(segment.start) || 0;
      return stripIgnoredIntroCaption(segment.text || segment.translatedText || "", start)
        && stripIgnoredIntroCaption(segment.translatedText || segment.text || "", start);
    });
  }

  function languageLabel(code) {
    const value = String(code || "").toLowerCase();
    if (value.startsWith("te") || value === "telugu") return "Telugu";
    if (value.startsWith("hi") || value === "hindi") return "Hindi";
    if (value.startsWith("en") || value === "english") return "English";
    if (value.startsWith("ta") || value === "tamil") return "Tamil";
    if (value.startsWith("kn") || value === "kannada") return "Kannada";
    if (value.startsWith("ml") || value === "malayalam") return "Malayalam";
    if (value.startsWith("bn") || value === "bengali") return "Bengali";
    if (value.startsWith("gu") || value === "gujarati") return "Gujarati";
    if (value.startsWith("mr") || value === "marathi") return "Marathi";
    if (value.startsWith("ur") || value === "urdu") return "Urdu";
    return "Auto Detect";
  }

  function resolvedCaptionLanguage(forGeneratedVideo) {
    if (state.captionLanguage !== "Auto Detect") return state.captionLanguage;
    return forGeneratedVideo ? state.target.label : languageLabel(state.detectedLanguage);
  }

  function applyEditedTextToCaptionSegments(value) {
    const text = cleanText(value);
    const current = state.translatedSegments.length ? state.translatedSegments : state.segments;
    if (!text || !current.length) return;
    const words = text.split(/\s+/).filter(Boolean);
    const weights = current.map((segment) => Math.max(1, cleanText(segment.translatedText || segment.text).split(/\s+/).filter(Boolean).length));
    const totalWeight = weights.reduce((sum, count) => sum + count, 0);
    let cursor = 0;
    state.translatedSegments = current.map((segment, index) => {
      const remainingSegments = current.length - index - 1;
      const remainingWords = words.length - cursor;
      const count = index === current.length - 1
        ? remainingWords
        : Math.max(1, Math.min(remainingWords - remainingSegments, Math.round((words.length * weights[index]) / totalWeight)));
      const translatedText = words.slice(cursor, cursor + Math.max(0, count)).join(" ");
      cursor += Math.max(0, count);
      return { ...segment, translatedText };
    }).filter((segment) => cleanText(segment.translatedText));
  }

  function getPreservedIntroSeconds() {
    // Presentator video exports always use the bundled 7.6-second intro. Whisper
    // can occasionally miss its short branding line, so audio preservation must
    // not depend on transcription detecting those words.
    return isVideoFile(state.file) ? 7.6 : 0;
  }

  function safeBaseName(name) {
    return String(name || "translated-audio")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "translated-audio";
  }

  function isVideoFile(file) {
    if (!file) return false;
    if (String(file.type || "").startsWith("video/")) return true;
    return /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(String(file.name || ""));
  }

  function filePathToUrl(filePath) {
    const normalized = String(filePath || "").trim();
    if (!normalized) return "";
    return "file:///" + normalized.replace(/\\/g, "/").replace(/^\/+/, "");
  }

  function clearVideoPreview() {
    if (!els.videoPreviewWrap || !els.videoPreview) return;
    els.videoPreview.pause();
    els.videoPreview.removeAttribute("src");
    els.videoPreview.load();
    els.videoPreviewWrap.hidden = true;
    if (els.videoPreviewLabel) els.videoPreviewLabel.textContent = "";
    if (els.videoOpen) els.videoOpen.disabled = true;
    if (els.videoFolder) els.videoFolder.disabled = true;
    if (els.videoCaption) els.videoCaption.textContent = "";
    if (state.previewVideoUrl) URL.revokeObjectURL(state.previewVideoUrl);
    state.previewVideoUrl = "";
  }

  function updateVideoCaptionPreview() {
    if (!els.videoPreview || !els.videoCaption) return;
    const time = Number(els.videoPreview.currentTime) || 0;
    const previewSegments = getPreviewCaptionSegments();
    let segment = previewSegments.find((item) => {
      const start = Number(item.start) || 0;
      const end = Number(item.end) || 0;
      return time >= start && time <= end;
    });
    if (!segment && els.videoPreview.paused && previewSegments.length) segment = previewSegments[0];
    const start = Number(segment?.start) || 0;
    els.videoCaption.textContent = segment
      ? stripIgnoredIntroCaption(segment.translatedText || segment.text || "", start)
      : "";
    els.videoCaption.hidden = !els.videoCaption.textContent;
  }

  function showPreExportCaptionPreview() {
    if (!isVideoFile(state.file) || !els.videoPreviewWrap || !els.videoPreview) return;
    if (state.previewVideoUrl) URL.revokeObjectURL(state.previewVideoUrl);
    state.previewVideoUrl = URL.createObjectURL(state.file);
    els.videoPreview.src = state.previewVideoUrl;
    els.videoPreview.controls = true;
    els.videoPreviewWrap.hidden = false;
    if (els.videoPreviewLabel) els.videoPreviewLabel.textContent = "Preview before export — translated captions are shown on the video";
    if (els.videoOpen) els.videoOpen.disabled = true;
    if (els.videoFolder) els.videoFolder.disabled = true;
    els.videoPreview.load();
    updateVideoCaptionPreview();
  }

  function showVideoPreview(result, label) {
    if (!els.videoPreviewWrap || !els.videoPreview || !result?.outputPath) return;
    const fileName = result.fileName || result.outputFileName || result.outputPath.split(/[\\/]/).pop() || "exported video";
    els.videoPreview.src = filePathToUrl(result.outputPath);
    els.videoPreview.controls = true;
    els.videoPreviewWrap.hidden = false;
    if (els.videoPreviewLabel) {
      els.videoPreviewLabel.textContent = (label || "Preview ready") + ": " + fileName;
    }
    if (els.videoOpen) els.videoOpen.disabled = false;
    if (els.videoFolder) els.videoFolder.disabled = false;
    try {
      els.videoPreview.load();
    } catch (_) {}
  }

  function setStatus(message, isError) {
    if (!els.status) return;
    els.status.textContent = message || "";
    els.status.classList.toggle("is-error", !!isError);
  }

  function speakAlert(message) {
    try {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = 0.92;
      utterance.pitch = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    } catch (_) {}
  }

  function syncVoiceButtons() {
    if (!root) return;
    root.querySelectorAll(".tdub-voice").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.engine === state.voiceEngine);
    });
  }

  function setProgress(percent, label, detail) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    if (els.progressFill) els.progressFill.style.width = pct + "%";
    if (els.progressPct) els.progressPct.textContent = pct + "%";
    if (els.progressLabel) els.progressLabel.textContent = label || "Waiting";
    if (els.progressDetail) els.progressDetail.textContent = detail || "";
  }

  function setBusy(busy) {
    state.busy = !!busy;
    [els.process, els.generate, els.exportVideo, els.caption, els.save, els.file].forEach((el) => {
      if (el) el.disabled = state.busy;
    });
    if (els.langs) {
      els.langs.querySelectorAll("button").forEach((button) => {
        button.disabled = state.busy;
      });
    }
  }

  function base64ToBlobUrl(base64, contentType) {
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    state.audioUrl = URL.createObjectURL(new Blob([bytes], { type: contentType || "audio/mpeg" }));
    return state.audioUrl;
  }

  function getTranscript(result) {
    if (!result) return "";
    if (result.text) return cleanText(result.text);
    if (Array.isArray(result.segments)) {
      return cleanText(result.segments.map((segment) => segment.text || "").join(" "));
    }
    return "";
  }

  async function translateText(text, targetCode) {
    const response = await fetch("http://127.0.0.1:8434/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, target: targetCode, source: "auto" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Translate server returned HTTP " + response.status);
    }
    return cleanText(payload.translated || payload.text || "");
  }

  function captionItemsFromSegments(segments) {
    return (segments || [])
      .map((segment) => {
        const start = Number(segment.start) || 0;
        const end = Number(segment.end) || 0;
        const sourceText = stripIgnoredIntroCaption(segment.text || "", start);
        const text = sourceText ? stripIgnoredIntroCaption(segment.translatedText || segment.text || "", start) : "";
        const words = text.split(/\s+/).filter(Boolean);
        const duration = Math.max(0.12, end - start);
        return {
          text,
          timestamp: [start, end],
          words: words.map((word, index) => ({
            text: word,
            timestamp: [
              start + (index / Math.max(1, words.length)) * duration,
              start + ((index + 1) / Math.max(1, words.length)) * duration,
            ],
          })),
        };
      })
      .filter((caption) => caption.text && caption.timestamp[1] > caption.timestamp[0]);
  }

  function assTimestamp(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const secs = Math.floor(value % 60);
    const centis = Math.min(99, Math.floor((value - Math.floor(value)) * 100));
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
  }

  function escapeAssText(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");
  }

  async function buildTranslatedKaraokeAss(videoPath) {
    let width = 1920;
    let height = 1080;
    if (api().probeVideoMeta) {
      try {
        const meta = await api().probeVideoMeta({ videoPath });
        width = Math.max(2, Number(meta?.width) || width);
        height = Math.max(2, Number(meta?.height) || height);
      } catch (_) {}
    }
    const captions = captionItemsFromSegments(state.captionSegments.length ? state.captionSegments : (state.translatedSegments.length ? state.translatedSegments : state.segments));
    const captionCode = captionLanguageCode(resolvedCaptionLanguage(false));
    const fontName = ["te", "hi", "ta", "kn", "ml", "bn", "gu", "mr", "ur"].includes(captionCode) ? "Nirmala UI" : "Arial";
    const fontSize = Math.max(30, Math.round(height * 0.052));
    const marginV = Math.max(42, Math.round(height * 0.09));
    const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Karaoke,${fontName},${fontSize},&H0000FFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,1,2,50,50,${marginV},1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text`;
    const events = [];
    for (const caption of captions) {
      const start = Number(caption.timestamp?.[0]) || 0;
      const end = Math.max(start + 0.12, Number(caption.timestamp?.[1]) || start + 2);
      const words = String(caption.text || "").split(/\s+/).filter(Boolean);
      if (!words.length) continue;
      const durationCs = Math.max(words.length, Math.round((end - start) * 100));
      const baseCs = Math.floor(durationCs / words.length);
      let remainder = durationCs - (baseCs * words.length);
      const karaoke = words.map((word) => {
        const wordCs = Math.max(1, baseCs + (remainder-- > 0 ? 1 : 0));
        return `{\\kf${wordCs}}${escapeAssText(word)}`;
      }).join(" ");
      events.push(`Dialogue: 0,${assTimestamp(start)},${assTimestamp(end)},Karaoke,,0,0,0,,{\\an2}${karaoke}`);
    }
    return `${header}\n${events.join("\n")}\n`;
  }

  async function burnTranslatedKaraokeCaptions(exported) {
    if (!exported?.outputPath || !api().burnCaptions) return exported;
    const assContent = await buildTranslatedKaraokeAss(exported.outputPath);
    setProgress(96, "Burning karaoke captions", "Adding word-by-word caption fill to the MP4");
    const captioned = await api().burnCaptions({ videoPath: exported.outputPath, assContent });
    if (!captioned || captioned.ok === false) throw new Error(captioned?.error || "Karaoke caption export failed.");
    state.captionedVideoPath = captioned.outputPath || "";
    state.exportedVideoPath = captioned.outputPath || exported.outputPath;
    showVideoPreview(captioned, "Karaoke captioned video preview");
    return captioned;
  }

  function openLocalAiVideoCaptioning(autoStart) {
    if (!isVideoFile(state.file)) {
      setStatus("AI Video Captioning is available only for video uploads.", true);
      return;
    }
    const generatedVideoPath = String(state.exportedVideoPath || "").trim();
    const useGeneratedVideo = Boolean(generatedVideoPath);
    const detail = {
      files: useGeneratedVideo ? [] : [state.file],
      filePaths: useGeneratedVideo ? [generatedVideoPath] : [],
      language: resolvedCaptionLanguage(useGeneratedVideo),
      autoStart: autoStart !== false,
      // A generated translated MP4 must be transcribed from its real audio in
      // Local AI Captioning. Do not reuse source-language/prebuilt captions.
      captions: useGeneratedVideo
        ? []
        : captionItemsFromSegments(state.captionSegments.length ? state.captionSegments : (state.translatedSegments.length ? state.translatedSegments : state.segments)),
    };
    const voicePresentatorTab = Array.from(document.querySelectorAll("button")).find((button) =>
      (button.textContent || "").trim() === "Voice Presentator"
    );
    if (voicePresentatorTab && typeof voicePresentatorTab.click === "function") {
      voicePresentatorTab.click();
    }
    window.__presentatorPendingAiVideoCaptioning = detail;
    window.dispatchEvent(new CustomEvent("presentator-open-ai-video-captioning-local", { detail }));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("presentator-ai-video-captioning-import", { detail }));
    }, 250);
    closeModule();

    let attempts = 0;
    const injectIntoLocalCaptioning = () => {
      if (window.__presentatorAiVideoCaptioningHandled) return;
      attempts += 1;
      const input = document.getElementById("captionVideoInput");
      if (!input) {
        if (attempts < 30) setTimeout(injectIntoLocalCaptioning, 300);
        return;
      }
      try {
        const transfer = new DataTransfer();
        transfer.items.add(state.file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (_) {}
      if (autoStart !== false) {
        setTimeout(() => {
          if (window.__presentatorAiVideoCaptioningHandled) return;
          window.dispatchEvent(new CustomEvent("presentator-ai-video-captioning-import", { detail }));
          const start = document.getElementById("captionQueueRunBtn") || document.getElementById("captionActionBtn");
          if (start && !start.disabled && typeof start.click === "function") start.click();
        }, 900);
      }
    };
    setTimeout(injectIntoLocalCaptioning, 500);
  }

  async function translateSegmentTexts(segments, targetCode) {
    const usable = (segments || [])
      .map((segment, index) => ({
        index,
        start: Number(segment.start) || 0,
        end: Number(segment.end) || 0,
        text: stripIgnoredIntroCaption(segment.text || "", Number(segment.start) || 0),
      }))
      .filter((segment) => segment.text && segment.end > segment.start);

    if (!usable.length) return [];

    const texts = usable.map((segment) => segment.text);
    try {
      const response = await fetch("http://127.0.0.1:8434/api/translate/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts, target: targetCode, source: "auto" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Batch translate returned HTTP " + response.status);
      const results = Array.isArray(payload.results) ? payload.results : [];
      return usable.map((segment, index) => ({
        ...segment,
        translatedText: cleanText(results[index]?.translated || results[index]?.text || results[index] || segment.text),
      }));
    } catch (_) {
      const translated = [];
      for (const segment of usable) {
        translated.push({
          ...segment,
          translatedText: await translateText(segment.text, targetCode),
        });
      }
      return translated;
    }
  }

  function captionLanguageCode(label) {
    return { English: "en", Telugu: "te", Hindi: "hi", Tamil: "ta", Kannada: "kn", Malayalam: "ml", Bengali: "bn", Gujarati: "gu", Marathi: "mr", Urdu: "ur" }[label] || "";
  }

  async function refreshCaptionSegments() {
    if (!state.segments.length) { state.captionSegments = []; return; }
    if (state.captionLanguage === "Auto Detect") state.captionSegments = state.segments.map((segment) => ({ ...segment, translatedText: segment.text }));
    else if (state.captionLanguage === state.target.label && state.translatedSegments.length) state.captionSegments = state.translatedSegments.map((segment) => ({ ...segment }));
    else state.captionSegments = await translateSegmentTexts(state.segments, captionLanguageCode(state.captionLanguage));
    updateVideoCaptionPreview();
  }

  async function pickFile(event) {
    const file = event.target.files && event.target.files[0];
    state.file = file || null;
    state.filePath = "";
    state.detectedLanguage = "";
    state.transcript = "";
    state.segments = [];
    state.translatedSegments = [];
    state.captionSegments = [];
    state.translated = "";
    state.audioBase64 = "";
    state.exportedVideoPath = "";
    state.captionedVideoPath = "";
    clearVideoPreview();
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = "";
    els.transcript.value = "";
    els.translation.value = "";
    els.audio.removeAttribute("src");
    els.save.disabled = true;
    els.generate.disabled = true;
    els.exportVideo.disabled = true;
    els.caption.disabled = !isVideoFile(file);
    els.exportVideo.hidden = !isVideoFile(file);
    els.caption.hidden = !isVideoFile(file);
    els.fileName.textContent = file ? file.name : "No file selected";
    if (!file) return;
    try {
      if (api().getPathForFile) {
        state.filePath = api().getPathForFile(file);
      }
      state.voiceEngine = "edge";
      syncVoiceButtons();
      setProgress(0, "Ready", "");
      setStatus(isVideoFile(file)
        ? "Ready. Video uploads clone the original video voice by default for Telugu, Hindi, or English output. Use TTS or SC3 if you want a different generated voice."
        : "Ready. Select Telugu, Hindi, or English, then start.");
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  }

  async function processUpload() {
    if (state.busy) return;
    if (!state.file) {
      setStatus("Choose an audio or video file first.", true);
      return;
    }
    if (!state.filePath) {
      setStatus("The app could not read the file path from Electron.", true);
      return;
    }
    if (!api().transcribeVideo || !api().narrateEdgeTts) {
      setStatus("Electron voice APIs are not available in this window.", true);
      return;
    }

    setBusy(true);
    els.save.disabled = true;
    state.exportedVideoPath = "";
    state.captionedVideoPath = "";
    try {
      setProgress(1, "Preparing", "Starting media analysis");
      setStatus("Step 1 of 4: preparing the uploaded media.");
      await new Promise((resolve) => setTimeout(resolve, 80));
      setProgress(8, "Extracting audio", "Preparing audio for Whisper");
      await new Promise((resolve) => setTimeout(resolve, 80));
      setProgress(15, "Transcribing", "Auto-detecting speech language");
      setStatus("Step 2 of 4: transcribing audio with Whisper.");
      const transcribed = await api().transcribeVideo({
        videoPath: state.filePath,
        languageHint: "auto",
      });
      if (!transcribed || transcribed.ok === false) {
        throw new Error((transcribed && transcribed.error) || "Transcription failed.");
      }
      state.transcript = getTranscript(transcribed);
      state.segments = Array.isArray(transcribed.segments) ? transcribed.segments : [];
      state.detectedLanguage = transcribed.language || transcribed.detectedLanguage || "auto";
      if (state.captionLanguage === "Auto Detect") {
        setStatus("Detected spoken language: " + languageLabel(state.detectedLanguage) + ".");
      }
      if (!state.transcript) {
        els.transcript.value = "";
        els.translation.value = "";
        els.generate.disabled = false;
        els.exportVideo.hidden = !isVideoFile(state.file);
        els.caption.hidden = !isVideoFile(state.file);
        els.caption.disabled = !isVideoFile(state.file);
        setProgress(100, "No speech detected", "Manual text can still be generated");
        setStatus("No speech was detected. Type or paste the text you want as the new audio, then use Regenerate MP3 and Export MP4.", true);
        return;
      }
      els.transcript.value = state.transcript;

      setProgress(45, "Translating", "Detected " + state.detectedLanguage + " to " + state.target.label);
      setStatus("Step 3 of 4: detected " + state.detectedLanguage + ", translating to " + state.target.label + ".");
      if (isVideoFile(state.file) && state.segments.length) {
        state.translatedSegments = await translateSegmentTexts(state.segments, state.target.code);
        state.translated = cleanText(state.translatedSegments.map((segment) => segment.translatedText).join(" "));
      } else {
        state.translatedSegments = [];
        state.translated = await translateText(state.transcript, state.target.code);
      }
      if (!state.translated) throw new Error("Translation returned empty text.");
      els.translation.value = state.translated;
      await refreshCaptionSegments();

      if (isVideoFile(state.file)) {
        showPreExportCaptionPreview();
        setProgress(70, "Generating preview", state.voiceEngine === "original" ? "Uploaded video voice" : (state.voiceEngine === "sc3" ? "SC3 preview voice" : "TTS preview voice"));
        await synthesizeTranslatedAudio("Step 4 of 4: generating preview audio. Export will wait for your click.");
        if (state.translatedSegments.length) {
          setProgress(82, "Synchronizing preview", "Building the selected voice over the original video background");
          await exportSyncedTranslatedVideoNow("Building synchronized voice preview.");
        }
        setProgress(100, "Preview ready", "Export MP3, Export MP4, or open AI Video Captioning when ready");
        setStatus("Preview ready. Voice: " + state.target.label + ". Captions: " + resolvedCaptionLanguage(false) + ". Play the video to verify synchronization.");
        speakAlert("Translation preview is ready. Please listen, then export.");
      } else {
        setProgress(70, "Generating audio", state.voiceEngine === "sc3" ? "SC3 voice" : "TTS voice");
        await synthesizeTranslatedAudio("Step 3: generating translated audio.");
        setProgress(100, "Complete", "Translated audio ready");
        setStatus("Done. The translated audio is ready.");
        speakAlert("Translated audio is ready.");
      }
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
      els.save.disabled = !state.audioBase64;
      els.generate.disabled = !cleanText(els.translation.value);
      els.exportVideo.disabled = isVideoFile(state.file) ? !state.translated : !state.audioBase64;
      els.caption.disabled = !isVideoFile(state.file);
    }
  }

  async function synthesizeTranslatedAudio(message) {
    const text = cleanText(els.translation.value || state.translated);
    if (!text) throw new Error("Translated text is empty.");
    setStatus(message || "Generating translated audio.");
    const useUploadedVoice = state.voiceEngine === "original" && Boolean(state.filePath);
    const useSc3 = state.voiceEngine === "sc3";
    const narrate = useUploadedVoice ? api().narrateUploadedVideoVoice : (useSc3 ? api().narrateSc3Text : api().narrateEdgeTts);
    if (!narrate) throw new Error((useUploadedVoice ? "Uploaded audio/video voice" : (useSc3 ? "SC3" : "TTS")) + " narration API is not available.");
    const audio = await narrate({
      text,
      videoPath: useUploadedVoice ? state.filePath : undefined,
      voice: useUploadedVoice ? "uploaded" : (useSc3 ? "sc3" : state.target.voice),
      targetVoice: useUploadedVoice ? state.target.voice : undefined,
      targetLanguage: useUploadedVoice ? state.target.code : undefined,
      rate: "+0%",
      pitch: "+0Hz",
      volume: "+0%",
    });
    if (!audio || !audio.audioBase64) throw new Error((audio && audio.error) || "Audio generation failed.");
    state.translated = text;
    state.audioBase64 = audio.audioBase64;
    els.audio.pause();
    els.audio.src = base64ToBlobUrl(audio.audioBase64, audio.contentType || "audio/mpeg");
    els.audio.load();
    try { els.audio.currentTime = 0; } catch (_) {}
    els.save.disabled = false;
    els.exportVideo.disabled = !isVideoFile(state.file);
  }

  async function regenerateAudio() {
    if (state.busy) return;
    setBusy(true);
    try {
      await synthesizeTranslatedAudio("Generating audio from the edited translation.");
      setStatus("Done. The updated translated audio is ready.");
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
      els.save.disabled = !state.audioBase64;
      els.generate.disabled = !cleanText(els.translation.value);
      els.exportVideo.disabled = !state.audioBase64 || !isVideoFile(state.file);
    }
  }

  function getStorySpeechWindow() {
    const timingSegments = (state.translatedSegments && state.translatedSegments.length)
      ? state.translatedSegments
      : state.segments;
    if (!Array.isArray(timingSegments) || !timingSegments.length) {
      return { speechStartSeconds: 0, speechEndSeconds: 0, hasSpeechTiming: false };
    }

    const starts = timingSegments
      .map((seg) => Number(seg && seg.start))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const ends = timingSegments
      .map((seg) => Number(seg && seg.end))
      .filter((value) => Number.isFinite(value) && value >= 0);

    if (!starts.length || !ends.length) {
      return { speechStartSeconds: 0, speechEndSeconds: 0, hasSpeechTiming: false };
    }

    const speechStartSeconds = Math.max(0, Math.min(...starts));
    const speechEndSeconds = Math.max(...ends);
    return {
      speechStartSeconds,
      speechEndSeconds: speechEndSeconds > speechStartSeconds ? speechEndSeconds : 0,
      hasSpeechTiming: true,
    };
  }

  async function exportTranslatedVideoNow(message) {
    if (!isVideoFile(state.file)) {
      throw new Error("Export MP4 is available only for video uploads.");
    }
    if (!state.audioBase64) {
      throw new Error("Generate the translated audio first.");
    }
    if (!api().exportTranslatedVideo) {
      throw new Error("The video export API is not available. Restart the app and try again.");
    }

    setStatus(message || "Exporting MP4 with translated audio.");
    const outputName = safeBaseName(state.file && state.file.name) + "-" + state.target.code + "-translated.mp4";
    const storyWindow = getStorySpeechWindow();
    const exported = await api().exportTranslatedVideo({
      videoPath: state.filePath,
      audioBase64: state.audioBase64,
      outputName,
      mode: "replace",
      syncToStory: storyWindow.hasSpeechTiming,
      speechStartSeconds: storyWindow.speechStartSeconds,
      speechEndSeconds: storyWindow.speechEndSeconds,
      preserveIntroSeconds: getPreservedIntroSeconds(),
    });
    if (!exported || exported.ok === false) throw new Error((exported && exported.error) || "Video export failed.");
    state.exportedVideoPath = exported.outputPath || "";
    showVideoPreview(exported, "Translated video preview");
    return exported;
  }

  async function exportSyncedTranslatedVideoNow(message) {
    if (!isVideoFile(state.file)) {
      throw new Error("Synced MP4 export is available only for video uploads.");
    }
    if (!api().exportSyncedTranslatedVideo) {
      throw new Error("The synced video export API is not available. Restart the app and try again.");
    }

    let segments = state.translatedSegments;
    if (!segments.length && state.segments.length) {
      segments = await translateSegmentTexts(state.segments, state.target.code);
      state.translatedSegments = segments;
    }
    if (!segments.length) {
      throw new Error("No timestamped speech segments are available for sync.");
    }

    setStatus(message || "Exporting synced MP4 with translated audio.");
    setProgress(55, "Sync export", "Starting timestamp-locked export");
    const outputName = safeBaseName(state.file && state.file.name) + "-" + state.target.code + "-synced-translated.mp4";
    const exported = await api().exportSyncedTranslatedVideo({
      videoPath: state.filePath,
      segments,
      voice: state.target.voice,
      targetLanguage: state.target.code,
      preserveIntroSeconds: getPreservedIntroSeconds(),
      outputName,
    });
    if (!exported || exported.ok === false) throw new Error((exported && exported.error) || "Synced video export failed.");
    state.exportedVideoPath = exported.outputPath || "";
    showVideoPreview(exported, "Synced video preview");
    return exported;
  }

  async function generateCaptions() {
    if (state.busy) return;
    setBusy(true);
    try {
      if (!state.exportedVideoPath) {
        const shouldUseSyncedExport = Boolean(state.translatedSegments.length || state.segments.length);
        setStatus("Preparing the " + state.target.label + " video for Local AI Captioning.");
        setProgress(45, "Preparing caption video", "Generating the translated MP4 first");
        if (shouldUseSyncedExport) {
          await exportSyncedTranslatedVideoNow("Generating the " + state.target.label + " video for Local AI Captioning.");
        } else {
          await exportTranslatedVideoNow("Generating the " + state.target.label + " video for Local AI Captioning.");
        }
      }
      if (!state.exportedVideoPath) throw new Error("The translated video was not created.");
      setProgress(100, "Opening Local AI Captioning", "Transcribing the generated " + state.target.label + " video");
      openLocalAiVideoCaptioning(true);
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
    }
  }

  async function exportVideo() {
    if (state.busy) return;
    setBusy(true);
    try {
      const shouldUseSyncedExport = Boolean(state.translatedSegments.length || state.segments.length);
      const exported = shouldUseSyncedExport
        ? await exportSyncedTranslatedVideoNow("Exporting synced MP4 with timestamp-locked translated audio.")
        : await exportTranslatedVideoNow("Exporting MP4 with translated audio.");
      const finalExport = await burnTranslatedKaraokeCaptions(exported);
      setStatus("Export complete with synchronized karaoke captions. Preview the video below before opening the folder.");
      speakAlert("Export complete. Preview is ready.");
    } catch (error) {
      setStatus(error.message || String(error), true);
    } finally {
      setBusy(false);
      els.save.disabled = !state.audioBase64;
      els.generate.disabled = !cleanText(els.translation.value);
      els.exportVideo.disabled = isVideoFile(state.file) ? !cleanText(els.translation.value) : !state.audioBase64;
    }
  }

  async function saveAudio() {
    if (!state.audioBase64) return;
    try {
      const defaultPath = safeBaseName(state.file && state.file.name) + "-" + state.target.code + ".mp3";
      const picked = await api().showSaveDialog({
        title: "Save translated audio",
        defaultPath,
        filters: [{ name: "MP3 Audio", extensions: ["mp3"] }],
        buttonLabel: "Save Audio",
      });
      if (!picked || picked.canceled || !picked.filePath) return;
      const written = await api().writeFile(picked.filePath, state.audioBase64);
      if (!written || written.ok === false) throw new Error((written && written.error) || "Could not save audio.");
      setStatus("Saved translated audio: " + picked.filePath);
      if (api().showItemInFolder) api().showItemInFolder(picked.filePath);
    } catch (error) {
      setStatus(error.message || String(error), true);
    }
  }

  function setTarget(code) {
    const selected = LANGUAGES.find((lang) => lang.code === code) || LANGUAGES[0];
    state.target = { ...selected, voice: selected.voice || selected.voices?.[0]?.id };
    if (els.langs) {
      els.langs.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.lang === selected.code);
      });
    }
    if (els.voiceModel) {
      els.voiceModel.innerHTML = "";
      (selected.voices || []).forEach((model) => {
        const option = document.createElement("option"); option.value = model.id; option.textContent = model.name; els.voiceModel.appendChild(option);
      });
      els.voiceModel.value = state.target.voice;
    }
    setStatus("Voice language: " + selected.label + ". Caption language: " + resolvedCaptionLanguage(false) + ".");
  }

  function openModule() {
    ensureRoot();
    root.hidden = false;
    document.body.classList.add("tdub-open");
    if (navButton) navButton.classList.add("is-active");
  }

  function closeModule() {
    if (root) root.hidden = true;
    document.body.classList.remove("tdub-open");
    if (navButton) navButton.classList.remove("is-active");
  }

  function createRoot() {
    root = document.createElement("section");
    root.id = "translateDubModule";
    root.className = "tdub-shell";
    root.hidden = true;
    root.innerHTML = [
      '<div class="tdub-wrap">',
      '  <div class="tdub-head">',
      '    <div>',
      '      <h2 class="tdub-title">Video and Audio Translator</h2>',
      '      <p class="tdub-subtitle">Choose one language and voice model. Translation, synchronized narration and captions will use that same language.</p>',
      '    </div>',
      '    <button class="tdub-close" type="button" title="Close">X</button>',
      '  </div>',
      '  <div class="tdub-grid">',
      '    <div class="tdub-panel">',
      '      <h3>Input</h3>',
      '      <label class="tdub-file">',
      '        <input class="tdub-file-input" type="file" accept="audio/*,video/*" />',
      '        <div class="tdub-file-name">No file selected</div>',
      '      </label>',
      '      <div class="tdub-lang-row"></div>',
      '      <div class="tdub-model-row"><label>Voice Model</label><select class="tdub-voice-model"></select><small>Voice, translated text and captions stay linked.</small></div>',
      '      <div class="tdub-voice-row">',
      '        <button class="tdub-voice is-active" type="button" data-engine="original">Clone Original Voice</button>',
      '        <button class="tdub-voice" type="button" data-engine="edge">TTS Sync Voice</button>',
      '        <button class="tdub-voice" type="button" data-engine="sc3">SC3 Voice</button>',
      '      </div>',
      '      <div class="tdub-caption-lang">',
      '        <label>Caption Language — choose separately</label>',
      '        <select class="tdub-caption-select">',
      '          <option value="Auto Detect" selected>Auto Detect</option>',
      '          <option value="English">English</option>',
      '          <option value="Telugu">Telugu</option>',
      '          <option value="Hindi">Hindi</option>',
      '          <option value="Tamil">Tamil</option>',
      '          <option value="Kannada">Kannada</option>',
      '          <option value="Malayalam">Malayalam</option>',
      '          <option value="Bengali">Bengali</option>',
      '          <option value="Gujarati">Gujarati</option>',
      '          <option value="Marathi">Marathi</option>',
      '          <option value="Urdu">Urdu</option>',
      '        </select>',
      '      </div>',
      '      <div class="tdub-actions">',
      '        <button class="tdub-primary tdub-process" type="button">Transcribe and Translate</button>',
      '        <button class="tdub-secondary tdub-generate" type="button" disabled>Regenerate MP3</button>',
      '        <button class="tdub-secondary tdub-caption" type="button" hidden disabled>AI Video Captioning</button>',
      '      </div>',
      '      <div class="tdub-progress">',
      '        <div class="tdub-progress-top"><span class="tdub-progress-label">Ready</span><span class="tdub-progress-pct">0%</span></div>',
      '        <div class="tdub-progress-track"><div class="tdub-progress-fill"></div></div>',
      '        <div class="tdub-progress-detail"></div>',
      '      </div>',
      '      <div class="tdub-status">Choose a target language, then upload your audio or video.</div>',
      '    </div>',
      '    <div class="tdub-panel">',
      '      <h3>Output</h3>',
      '      <div class="tdub-text-grid">',
      '        <div class="tdub-field">',
      '          <label>Transcription</label>',
      '          <textarea class="tdub-transcript" spellcheck="false" readonly></textarea>',
      '        </div>',
      '        <div class="tdub-field">',
      '          <label>Translated Text</label>',
      '          <textarea class="tdub-translation" spellcheck="false"></textarea>',
      '        </div>',
      '      </div>',
      '      <div class="tdub-audio">',
      '        <audio class="tdub-audio-player" controls></audio>',
      '        <div class="tdub-audio-actions">',
      '          <button class="tdub-secondary tdub-export-video" type="button" hidden disabled>Export MP4</button>',
      '          <button class="tdub-secondary tdub-save" type="button" disabled>Export MP3</button>',
      '        </div>',
      '      </div>',
      '      <div class="tdub-video-preview" hidden>',
      '        <div class="tdub-video-preview-label"></div>',
      '        <div class="tdub-video-stage">',
      '          <video class="tdub-video-player" controls playsinline preload="metadata"></video>',
      '          <div class="tdub-video-caption" hidden></div>',
      '        </div>',
      '        <div class="tdub-video-preview-actions">',
      '          <button class="tdub-secondary tdub-video-open" type="button" disabled>Play Saved File</button>',
      '          <button class="tdub-secondary tdub-video-folder" type="button" disabled>Open Folder</button>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join("");
    document.body.appendChild(root);

    els = {
      close: root.querySelector(".tdub-close"),
      file: root.querySelector(".tdub-file-input"),
      fileName: root.querySelector(".tdub-file-name"),
      langs: root.querySelector(".tdub-lang-row"),
      process: root.querySelector(".tdub-process"),
      generate: root.querySelector(".tdub-generate"),
      caption: root.querySelector(".tdub-caption"),
      captionSelect: root.querySelector(".tdub-caption-select"),
      voiceModel: root.querySelector(".tdub-voice-model"),
      status: root.querySelector(".tdub-status"),
      progressFill: root.querySelector(".tdub-progress-fill"),
      progressPct: root.querySelector(".tdub-progress-pct"),
      progressLabel: root.querySelector(".tdub-progress-label"),
      progressDetail: root.querySelector(".tdub-progress-detail"),
      transcript: root.querySelector(".tdub-transcript"),
      translation: root.querySelector(".tdub-translation"),
      audio: root.querySelector(".tdub-audio-player"),
      exportVideo: root.querySelector(".tdub-export-video"),
      save: root.querySelector(".tdub-save"),
      videoPreviewWrap: root.querySelector(".tdub-video-preview"),
      videoPreview: root.querySelector(".tdub-video-player"),
      videoCaption: root.querySelector(".tdub-video-caption"),
      videoPreviewLabel: root.querySelector(".tdub-video-preview-label"),
      videoOpen: root.querySelector(".tdub-video-open"),
      videoFolder: root.querySelector(".tdub-video-folder"),
    };

    LANGUAGES.forEach((lang) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tdub-lang";
      button.dataset.lang = lang.code;
      button.textContent = lang.label;
      button.addEventListener("click", async () => {
        if (state.busy) return;
        setTarget(lang.code);
        if (state.file) await processUpload();
      });
      els.langs.appendChild(button);
    });

    els.close.addEventListener("click", closeModule);
    els.file.addEventListener("change", pickFile);
    els.process.addEventListener("click", processUpload);
    els.generate.addEventListener("click", regenerateAudio);
    els.caption.addEventListener("click", generateCaptions);
    els.captionSelect.addEventListener("change", async () => {
      state.captionLanguage = els.captionSelect.value || "Auto Detect";
      state.exportedVideoPath = "";
      state.captionedVideoPath = "";
      if (state.segments.length) await refreshCaptionSegments();
      if (isVideoFile(state.file)) showPreExportCaptionPreview();
      setStatus("Voice: " + state.target.label + ". Captions: " + resolvedCaptionLanguage(false) + ". Export will keep both synchronized.");
    });
    if (els.voiceModel) els.voiceModel.disabled = state.busy;
    els.voiceModel.addEventListener("change", async () => {
      state.target = { ...state.target, voice: els.voiceModel.value || state.target.voice };
      const model = state.target.voices?.find((item) => item.id === state.target.voice);
      setStatus(`${state.target.label} voice model: ${model?.name || state.target.voice}. Captions remain ${state.target.label}.`);
      if (cleanText(state.translated)) await regenerateAudio();
    });
    els.exportVideo.addEventListener("click", exportVideo);
    els.save.addEventListener("click", saveAudio);
    els.videoOpen.addEventListener("click", () => {
      if (state.exportedVideoPath && api().openFile) api().openFile(state.exportedVideoPath);
    });
    els.videoFolder.addEventListener("click", () => {
      if (state.exportedVideoPath && api().showItemInFolder) api().showItemInFolder(state.exportedVideoPath);
    });
    els.audio.addEventListener("ended", () => { try { els.audio.currentTime = 0; } catch (_) {} });
    els.audio.addEventListener("loadedmetadata", () => {
      if (cleanText(state.translated).length > 30 && Number(els.audio.duration) > 0 && Number(els.audio.duration) < 2) {
        setStatus("Generated audio is unexpectedly short. Regenerate it or choose another voice model.", true);
      }
    });
    ["loadedmetadata", "timeupdate", "seeking", "play", "pause"].forEach((eventName) => {
      els.videoPreview.addEventListener(eventName, updateVideoCaptionPreview);
    });
    els.translation.addEventListener("input", () => {
      state.translated = els.translation.value;
      applyEditedTextToCaptionSegments(state.translated);
      state.audioBase64 = "";
      state.exportedVideoPath = "";
      state.captionedVideoPath = "";
      if (isVideoFile(state.file)) {
        showPreExportCaptionPreview();
        updateVideoCaptionPreview();
      }
      if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
      state.audioUrl = "";
      els.audio.removeAttribute("src");
      els.save.disabled = true;
      els.exportVideo.disabled = !isVideoFile(state.file) || !cleanText(els.translation.value);
      els.generate.disabled = !cleanText(els.translation.value);
      setStatus("Caption text edited. The preview remains available, and Export MP4 will burn these edited captions. Regenerate MP3 only if you also want the narration audio updated.");
    });
    root.querySelectorAll(".tdub-voice").forEach((button) => {
      button.addEventListener("click", () => {
        state.voiceEngine = button.dataset.engine || "edge";
        syncVoiceButtons();
        if (state.voiceEngine === "original") {
          setStatus("Voice engine: uploaded video's original voice. The app will clone that voice for Telugu, Hindi, or English output.");
        } else {
          setStatus(state.voiceEngine === "sc3" ? "Voice engine: SC3 voice." : "Voice engine: timed TTS sync voice.");
        }
      });
    });

    if (api().onTranslateDubProgress) {
      api().onTranslateDubProgress((data) => {
        const detail = data && data.total ? (data.done || 0) + "/" + data.total + " segments" : "";
        setProgress(data && data.pct, data && data.phase, detail);
      });
    }
    if (api().onBurnProgress) {
      api().onBurnProgress((data) => {
        if (!data || typeof data.pct !== "number") return;
        setProgress(data.pct, data.phase === "finalizing" ? "Finalizing captions" : "Burning captions", "");
      });
    }
    setTarget(state.target.code);
  }

  function ensureRoot() {
    if (!root) createRoot();
  }

  function ensureNavButton() {
    const header = document.querySelector("header");
    if (!header) return;
    const nav = Array.from(header.children).find((child) => 
      child.querySelector && Array.from(child.querySelectorAll("button")).some(b => (b.textContent || "").trim() === "My Exporter")
    );
    if (!nav) return;
    if (navButton && nav.contains(navButton)) return;

    navButton = document.createElement("button");
    navButton.type = "button";
    navButton.className = "tdub-nav-button";
    navButton.textContent = "Translate Audio";
    navButton.addEventListener("click", openModule);
    const exporterButton = Array.from(nav.querySelectorAll("button")).find((button) =>
      (button.textContent || "").trim() === "My Exporter"
    );
    nav.insertBefore(navButton, exporterButton || null);

    // Switching to any normal app page must close the full-screen translator;
    // otherwise the selected page opens underneath it and appears unresponsive.
    nav.addEventListener("click", (event) => {
      const button = event.target && event.target.closest ? event.target.closest("button") : null;
      if (button && button !== navButton) closeModule();
    });
  }

  function boot() {
    ensureStyles();
    ensureRoot();
    ensureNavButton();
    window.addEventListener("pp:close-translate-audio", closeModule);
    const observer = new MutationObserver(ensureNavButton);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
