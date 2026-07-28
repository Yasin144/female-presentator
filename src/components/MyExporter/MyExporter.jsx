import React, { useEffect, useMemo, useRef, useState } from 'react';
import './my-exporter.css';
import { transcribeLocalMediaPath } from '../../caption/transcribe';

const fileUrl = value => encodeURI(`file:///${String(value || '').replace(/\\/g, '/')}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PROJECT_KEY = 'pattan-my-exporter-project-v1';
const DEFAULT_SETTINGS = { resolution: '1080p', fps: 30, quality: 'balanced', framing: 'contain', musicVolume: 0.18, burnCaptions: true, captionStyle: 'classic', captionPosition: 'bottom', captionFontSize: 42, captionMaxChars: 36, watermarkPosition: 'bottom-right', watermarkX: 90, watermarkY: 90, watermarkScale: 16, watermarkOpacity: .85 };
const WATERMARK_POSITIONS = { 'top-left': [10, 10], 'top-right': [90, 10], 'bottom-left': [10, 90], 'bottom-right': [90, 90], center: [50, 50] };
const loadProject = () => {
  try { return JSON.parse(localStorage.getItem(PROJECT_KEY) || 'null') || {}; }
  catch (_) { return {}; }
};
const formatTime = value => {
  const seconds = Math.max(0, Number(value) || 0);
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};
const formatEta = value => { const seconds = Math.max(0, Math.round(Number(value) || 0)); return seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m` : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`; };
const safeFileBase = value => String(value || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim();
const wrapCaptionText = (value, maxChars) => {
  const words = String(value || '').replace(/\r?\n/g, ' ').trim().split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (const word of words) {
    if (line && `${line} ${word}`.length > maxChars) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
};
const serialCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const serialSort = items => [...items].sort((a, b) => serialCollator.compare(a.name || '', b.name || ''));
const CAPTION_LANGUAGE_NAMES = { auto: 'Auto-Detect', en: 'English', te: 'Telugu', hi: 'Hindi', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam' };
const VOICE_MODELS = { en: 'en-IN-NeerjaNeural', hi: 'hi-IN-SwaraNeural', te: 'te-IN-ShrutiNeural', ta: 'ta-IN-PallaviNeural', kn: 'kn-IN-SapnaNeural', ml: 'ml-IN-SobhanaNeural' };
const DEFAULT_LOGO = { name: 'info kids logo.png', path: 'D:\\desktop\\NEVER DELETE\\info kids logo.png', preview: '' };
const textToBase64 = value => {
  const bytes = new TextEncoder().encode(value); let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};

export default function MyExporter({ active = true }) {
  const mediaInput = useRef(null);
  const musicInput = useRef(null);
  const watermarkInput = useRef(null);
  const projectInput = useRef(null);
  const preview = useRef(null);
  const viewer = useRef(null);
  const audioPreview = useRef(null);
  const audioSelectionPreview = useRef(null);
  const cropPreview = useRef(null);
  const audioSelectionRef = useRef(null);
  const audioDragRef = useRef(false);
  const autoplayNextRef = useRef(false);
  const advancingSceneRef = useRef(false);
  const playAllSessionRef = useRef(false);
  const timelineSurface = useRef(null);
  const timelineRef = useRef(null);
  const [scrollInfo, setScrollInfo] = useState({ left: 0, width: 1, clientWidth: 1 });
  const playheadScissorDragRef = useRef({ active: false, startX: 0, moved: false });
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const restoringHistoryRef = useRef(false);
  const [scenes, setScenes] = useState(() => { const saved = loadProject(); const framing = saved.settings?.framing || 'contain'; return (saved.scenes || []).map(scene => ({ ...scene, fit: framing })); });
  const [mediaLibrary, setMediaLibrary] = useState(() => loadProject().mediaLibrary || []);
  const [selectedId, setSelectedId] = useState(() => loadProject().selectedId || '');
  const [music, setMusic] = useState(() => loadProject().music || null);
  const [watermark, setWatermark] = useState(() => { const saved = loadProject().watermark; return !saved || /info kids/i.test(saved.name || '') ? DEFAULT_LOGO : saved; });
  const [watermarkEnabled, setWatermarkEnabled] = useState(() => Boolean(loadProject().watermarkEnabled));
  const [playbackMode, setPlaybackMode] = useState(() => loadProject().playbackMode || 'continuous');
  const [audioTracks, setAudioTracks] = useState(() => loadProject().audioTracks || []);
  const [trackStates, setTrackStates] = useState(() => loadProject().trackStates || { videoLocked: false, audioLocked: false, audioMuted: false, captionsLocked: false, captionsMuted: false });
  const [captions, setCaptions] = useState(() => loadProject().captions || []);
  const [textOverlays, setTextOverlays] = useState(() => loadProject().textOverlays || []);
  const [selectedTextId, setSelectedTextId] = useState('');
  const [captionEditorOpen, setCaptionEditorOpen] = useState(false);
  const [stutterCutterOpen, setStutterCutterOpen] = useState(false);
  const [detectedStutters, setDetectedStutters] = useState([]);
  const [captionLanguage, setCaptionLanguage] = useState(() => loadProject().captionLanguage || 'auto');
  const [voiceLanguage, setVoiceLanguage] = useState(() => loadProject().voiceLanguage || 'hi');
  const [voiceChanging, setVoiceChanging] = useState(false);
  const [targetMorphVoice, setTargetMorphVoice] = useState('sc3');
  const [audioMorphing, setAudioMorphing] = useState(false);
  const [detectedCaptionLanguage, setDetectedCaptionLanguage] = useState('');
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...(loadProject().settings || {}) }));
  const [progress, setProgress] = useState({ pct: 0, phase: 'Ready' });
  const [exporting, setExporting] = useState(false);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [exportStartedAt, setExportStartedAt] = useState(0);
  const [exportClock, setExportClock] = useState(Date.now());
  const [warning, setWarning] = useState('');
  const [captioning, setCaptioning] = useState(false);
  const [result, setResult] = useState(null);
  const [safeGuides, setSafeGuides] = useState(false);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [draggingId, setDraggingId] = useState('');
  const [selectedAudioId, setSelectedAudioId] = useState('');
  const [audioClipboard, setAudioClipboard] = useState(null);
  const [sceneClipboard, setSceneClipboard] = useState(null);
  const [audioSelection, setAudioSelection] = useState(null);
  const [audioCutSelectionModeId, setAudioCutSelectionModeId] = useState('');
  const [selectedCaptionId, setSelectedCaptionId] = useState('');
  const [editingCaptionId, setEditingCaptionId] = useState('');
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [rippleEnabled, setRippleEnabled] = useState(true);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [captionSampleVisible, setCaptionSampleVisible] = useState(() => !(loadProject().captions || []).length);
  const [previewLarge, setPreviewLarge] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [expandedTimelineTrack, setExpandedTimelineTrack] = useState('');
  const [openSidePanel, setOpenSidePanel] = useState('');
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [previewFrame, setPreviewFrame] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [projectName, setProjectName] = useState(() => loadProject().projectName || 'Untitled Project');
  const [projectPath, setProjectPath] = useState(() => loadProject().projectPath || 'Not saved yet');
  const [cropSource, setCropSource] = useState(null);
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const [cropSaving, setCropSaving] = useState(false);
  const [cropPartCount, setCropPartCount] = useState(1);
  const [cropParts, setCropParts] = useState([{ start: 0, end: 0 }]);
  const [cropParallelExports, setCropParallelExports] = useState(2);
  const [assetTab, setAssetTab] = useState('Media');
  const [workspaceTabs, setWorkspaceTabs] = useState(() => [{ id: uid(), name: loadProject().projectName || 'Project 1', data: null }]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => workspaceTabs?.[0]?.id || '');
  const [layoutMode, setLayoutMode] = useState(() => { try { return localStorage.getItem('mx-layout-mode') || 'default'; } catch (_) { return 'default'; } });
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false);

  const selectedAudio = audioTracks.find(track => track.id === selectedAudioId);
  const selectedText = textOverlays.find(item => item.id === selectedTextId);
  const selected = scenes.find(scene => scene.id === selectedId) || (!selectedAudio && !selectedCaptionId ? scenes[0] : null);
  const totalDuration = useMemo(() => scenes.reduce((sum, scene) => sum + Number(scene.duration || 0) / (scene.kind === 'image' ? 1 : Number(scene.speed || 1)), 0), [scenes]);
  const activeTimelineAudio = audioTracks.find(track => !track.muted && playheadTime >= Number(track.start) && playheadTime <= Number(track.start) + Number(track.duration));
  const activeCaption = captions.find(item => playheadTime >= Number(item.start) && playheadTime <= Number(item.end));
  const karaokeWords = activeCaption ? String(activeCaption.text || '').split(/\s+/).filter(Boolean) : [];
  const getKaraokeWordIndex = () => {
    if (!activeCaption) return -1;
    const timedWords = (activeCaption.words || []).filter(w => 
      Number.isFinite(Number(w.start)) && 
      Number.isFinite(Number(w.end)) && 
      Number(w.end) > Number(w.start)
    );
    if (timedWords.length) {
      const idx = timedWords.findIndex(w => playheadTime >= Number(w.start) && playheadTime <= Number(w.end));
      if (idx !== -1) return idx;
      const lastEndedIdx = [...timedWords].reverse().findIndex(w => playheadTime >= Number(w.end));
      if (lastEndedIdx !== -1) {
        return timedWords.length - 1 - lastEndedIdx;
      }
      return 0;
    }
    if (!karaokeWords.length) return -1;
    return Math.min(karaokeWords.length - 1, Math.floor(((playheadTime - activeCaption.start) / Math.max(.1, activeCaption.end - activeCaption.start)) * karaokeWords.length));
  };
  const karaokeWordIndex = getKaraokeWordIndex();
  const hasRealCaptions = captions.some(item => String(item?.text || '').trim() && Number(item?.end) > Number(item?.start));
  const previewCaption = activeCaption || (!hasRealCaptions && captionSampleVisible ? { text: 'Your sample captions will look exactly like this', start: 0, end: 4 } : null);
  const previewWords = String(previewCaption?.text || '').split(/\s+/).filter(Boolean);
  const previewWordIndex = activeCaption ? karaokeWordIndex : Math.floor(previewWords.length / 2);
  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!event.target.closest('.mx-export-dropdown-container')) {
        setExportDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedIds([]);
    } else if (!selectedIds.includes(selectedId)) {
      setSelectedIds([selectedId]);
    }
  }, [selectedId, selectedIds]);

  const selectScene = (sceneId, isCtrlPressed = false) => {
    if (isCtrlPressed) {
      setSelectedIds(prev => {
        const next = prev.includes(sceneId) ? prev.filter(id => id !== sceneId) : [...prev, sceneId];
        setSelectedId(next[next.length - 1] || '');
        return next;
      });
    } else {
      setSelectedId(sceneId);
      setSelectedIds([sceneId]);
    }
    setSelectedAudioId('');
    setSelectedCaptionId('');
  };

  useEffect(() => {
    document.querySelectorAll('.mx-asset-shelf button').forEach(button => {
      const name = button.querySelector('strong')?.textContent?.trim();
      const detail = button.querySelector('small')?.textContent?.trim();
      if (!name) return;
      button.title = detail ? `${name} — ${detail}` : name;
      button.setAttribute('aria-label', button.title);
      button.dataset.iconTitle = name;
    });
  }, [assetTab, timelineExpanded, safeGuides, scenes.length, captions.length, selected?.id, watermark]);
  const timelineIssues = useMemo(() => {
    const issues = [];
    audioTracks.forEach(track => { if (Number(track.start) < 0 || Number(track.start) + Number(track.duration) > totalDuration + .05) issues.push(`${track.name}: audio extends outside the video.`); });
    const orderedCaptions = [...captions].sort((a, b) => a.start - b.start);
    orderedCaptions.forEach((caption, index) => {
      if (caption.start < 0 || caption.end > totalDuration + .05 || caption.end <= caption.start) issues.push(`Caption ${index + 1}: timing is outside the video.`);
      if (index && caption.start < orderedCaptions[index - 1].end) issues.push(`Captions ${index} and ${index + 1} overlap.`);
    });
    return issues;
  }, [audioTracks, captions, totalDuration]);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const handleScroll = () => {
      setScrollInfo({
        left: el.scrollLeft,
        width: el.scrollWidth,
        clientWidth: el.clientWidth
      });
    };
    el.addEventListener('scroll', handleScroll);
    handleScroll();
    
    const observer = new ResizeObserver(handleScroll);
    observer.observe(el);
    if (timelineSurface.current) observer.observe(timelineSurface.current);
    
    return () => {
      el.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [scenes, audioTracks, timelineZoom]);

  const beginScrollDrag = event => {
    if (event.button !== 0 || event.target.closest('.mx-scroller-handle-left,.mx-scroller-handle-right')) return;
    event.preventDefault(); event.stopPropagation();
    const track = event.currentTarget.closest('.mx-custom-scroller-track');
    if (!track) return;
    const trackWidth = track.clientWidth;
    const originX = event.clientX;
    const originScrollLeft = timelineRef.current ? timelineRef.current.scrollLeft : 0;
    const maxScroll = scrollInfo.width - scrollInfo.clientWidth;
    
    const move = pointerEvent => {
      if (!timelineRef.current || maxScroll <= 0) return;
      const deltaX = pointerEvent.clientX - originX;
      const ratio = scrollInfo.clientWidth / scrollInfo.width;
      const thumbWidth = Math.max(30, trackWidth * ratio);
      const maxThumbTravel = trackWidth - thumbWidth;
      if (maxThumbTravel <= 0) return;
      
      const scrollDelta = (deltaX / maxThumbTravel) * maxScroll;
      timelineRef.current.scrollLeft = Math.max(0, Math.min(maxScroll, originScrollLeft + scrollDelta));
    };
    
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const handleTrackClick = event => {
    if (event.target.closest('.mx-custom-scroller-thumb')) return;
    const el = timelineRef.current;
    if (!el || !scrollInfo.width) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const trackWidth = rect.width;
    const ratio = scrollInfo.clientWidth / scrollInfo.width;
    const thumbWidth = Math.max(30, trackWidth * ratio);
    const targetThumbLeft = clickX - thumbWidth / 2;
    const maxThumbTravel = trackWidth - thumbWidth;
    if (maxThumbTravel <= 0) return;
    
    const targetScrollRatio = Math.max(0, Math.min(1, targetThumbLeft / maxThumbTravel));
    const maxScroll = scrollInfo.width - scrollInfo.clientWidth;
    el.scrollLeft = targetScrollRatio * maxScroll;
  };

  const beginZoomDrag = (event, edge) => {
    event.preventDefault(); event.stopPropagation();
    const originX = event.clientX;
    const originZoom = timelineZoom;
    const move = pointerEvent => {
      const deltaX = pointerEvent.clientX - originX;
      const zoomChange = edge === 'right' ? -deltaX / 10 : deltaX / 10;
      const nextZoom = Math.max(1, Math.min(50, originZoom + zoomChange));
      setTimelineZoom(nextZoom);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };
  useEffect(() => {
    audioSelectionRef.current = audioSelection;
    if (!audioSelection?.trackId) return;
    window.requestAnimationFrame(() => {
      const track = audioTracks.find(item => item.id === audioSelection.trackId);
      const element = document.querySelector('.mx-audio-clip.active .mx-audio-selection');
      if (!track || !element) return;
      const exactPercent = Math.max(.001, (Number(audioSelection.end) - Number(audioSelection.start)) / Math.max(.001, Number(track.duration)) * 100);
      element.style.setProperty('width', `${exactPercent}%`, 'important');
    });
  }, [audioSelection, audioTracks]);

  useEffect(() => {
    if (!selectedAudio || audioSelection?.trackId !== selectedAudio.id) return;
    const startLimit = Number(selectedAudio.start);
    const endLimit = startLimit + Number(selectedAudio.duration);
    const start = Math.max(startLimit, Math.min(endLimit - .001, Number(audioSelection.start)));
    const end = Math.max(start + .001, Math.min(endLimit, Number(audioSelection.end)));
    if (Math.abs(start - Number(audioSelection.start)) > .0005 || Math.abs(end - Number(audioSelection.end)) > .0005) setAudioSelection(current => ({ ...current, start, end, label: '' }));
  }, [selectedAudio?.id, selectedAudio?.start, selectedAudio?.duration, audioSelection?.trackId]);

  useEffect(() => {
    if (!audioSelection?.trackId) return undefined;
    const element = document.querySelector('.mx-audio-clip.active .mx-audio-selection');
    const track = audioTracks.find(item => item.id === audioSelection.trackId);
    if (!element || !track) return undefined;
    const down = event => {
      event.preventDefault(); event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const mode = localX <= 18 ? 'start' : localX >= rect.width - 18 ? 'end' : 'move';
      const originX = event.clientX;
      const origin = { ...audioSelectionRef.current };
      const clipStart = Number(track.start);
      const clipEnd = clipStart + Number(track.duration);
      const move = pointerEvent => {
        const delta = (pointerEvent.clientX - originX) / Math.max(1, element.closest('.mx-audio-clip').getBoundingClientRect().width) * Number(track.duration);
        let start = origin.start; let end = origin.end;
        if (mode === 'start') start = Math.max(clipStart, Math.min(origin.end - .001, origin.start + delta));
        else if (mode === 'end') end = Math.min(clipEnd, Math.max(origin.start + .001, origin.end + delta));
        else {
          const length = origin.end - origin.start;
          start = Math.max(clipStart, Math.min(clipEnd - length, origin.start + delta));
          end = start + length;
        }
        setAudioSelection({ ...origin, start, end, label: '' });
        setPlayheadTime(mode === 'end' ? end : start);
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
    };
    element.addEventListener('pointerdown', down);
    return () => element.removeEventListener('pointerdown', down);
  }, [audioSelection?.trackId, selectedAudioId, audioTracks]);

  useEffect(() => {
    if (!audioPreview.current || !activeTimelineAudio) return;
    const desired = Number(activeTimelineAudio.trimStart || 0) + Math.max(0, playheadTime - Number(activeTimelineAudio.start || 0)) * Number(activeTimelineAudio.speed || 1);
    
    const syncAndPlay = () => {
      if (!audioPreview.current) return;
      if (Math.abs(audioPreview.current.currentTime - desired) > .15) {
        audioPreview.current.currentTime = desired;
      }
      if (isPreviewPlaying && audioPreview.current.paused) {
        audioPreview.current.play().catch(() => {});
      }
    };

    if (audioPreview.current.readyState >= 1) {
      syncAndPlay();
    } else {
      audioPreview.current.load();
      const onMetadata = () => {
        syncAndPlay();
        audioPreview.current?.removeEventListener('loadedmetadata', onMetadata);
      };
      audioPreview.current.addEventListener('loadedmetadata', onMetadata);
    }
  }, [playheadTime, activeTimelineAudio?.id, activeTimelineAudio?.path, isPreviewPlaying]);

  const updatePreviewFrame = () => {
    const media = preview.current;
    const container = viewer.current;
    if (!media || !container) return;
    const mediaRect = media.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if ((settings.framing || 'contain') === 'fill') {
      setPreviewFrame({ left: mediaRect.left - containerRect.left, top: mediaRect.top - containerRect.top, width: mediaRect.width, height: mediaRect.height });
      return;
    }
    const sourceWidth = Number(selected?.width) || Number(media.videoWidth) || 1920;
    const sourceHeight = Number(selected?.height) || Number(media.videoHeight) || 1080;
    const sourceRatio = sourceWidth / Math.max(1, sourceHeight);
    const boxRatio = mediaRect.width / Math.max(1, mediaRect.height);
    const width = boxRatio > sourceRatio ? mediaRect.height * sourceRatio : mediaRect.width;
    const height = boxRatio > sourceRatio ? mediaRect.height : mediaRect.width / sourceRatio;
    setPreviewFrame({ left: mediaRect.left - containerRect.left + (mediaRect.width - width) / 2, top: mediaRect.top - containerRect.top + (mediaRect.height - height) / 2, width, height });
  };

  useEffect(() => {
    const refresh = () => { setIsPreviewFullscreen(document.fullscreenElement === viewer.current); updatePreviewFrame(); };
    window.addEventListener('resize', refresh);
    document.addEventListener('fullscreenchange', refresh);
    const timer = window.setTimeout(refresh, 50);
    return () => { window.removeEventListener('resize', refresh); document.removeEventListener('fullscreenchange', refresh); window.clearTimeout(timer); };
  }, [selected?.id, selected?.width, selected?.height, settings.resolution, settings.framing]);

  useEffect(() => {
    const handler = data => setProgress({ pct: Number(data?.pct) || 0, phase: data?.phase || 'Exporting' });
    window.electronAPI?.onMyExporterProgress?.(handler);
    return () => window.electronAPI?.offMyExporterProgress?.(handler);
  }, []);

  useEffect(() => {
    if (!exporting) return undefined;
    const timer = window.setInterval(() => setExportClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [exporting]);

  // Pause playback when the module tab is switched away (MyExporter stays mounted but hidden).
  useEffect(() => {
    if (active) return;
    if (preview.current && !preview.current.paused) preview.current.pause();
    if (audioPreview.current && !audioPreview.current.paused) audioPreview.current.pause();
    setIsPreviewPlaying(false);
  }, [active]);

  // Persist layout choice and apply any auto-adjustments (e.g. Timeline layout expands the timeline).
  const setLayout = (mode) => {
    setLayoutMode(mode);
    setLayoutPickerOpen(false);
    try { localStorage.setItem('mx-layout-mode', mode); } catch (_) {}
    if (mode === 'timeline') { setTimelineExpanded(true); }
    else if (mode === 'default' || mode === 'classic' || mode === 'organize') { setTimelineExpanded(false); }
    window.setTimeout(updatePreviewFrame, 80);
  };

  useEffect(() => {
    const handleLayoutEvent = (e) => {
      const mode = e.detail;
      if (mode) setLayout(mode);
    };
    window.addEventListener('pp:change-layout', handleLayoutEvent);
    return () => window.removeEventListener('pp:change-layout', handleLayoutEvent);
  }, []);

  // Close layout picker on outside click.
  useEffect(() => {
    if (!layoutPickerOpen) return;
    const close = (e) => { if (!e.target.closest('.mx-layout-picker-popup, .mx-layout-btn')) setLayoutPickerOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [layoutPickerOpen]);

  useEffect(() => {
    if (hasRealCaptions && captionSampleVisible) setCaptionSampleVisible(false);
  }, [hasRealCaptions, captionSampleVisible]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(PROJECT_KEY, JSON.stringify({ projectName, projectPath, scenes, mediaLibrary, selectedId, music, watermark, watermarkEnabled, playbackMode, audioTracks, trackStates, captions, textOverlays, captionLanguage, voiceLanguage, settings, savedAt: new Date().toISOString() })); } catch (_) {}
    }, 250);
    return () => window.clearTimeout(timer);
  }, [projectName, projectPath, scenes, mediaLibrary, selectedId, music, watermark, watermarkEnabled, playbackMode, audioTracks, trackStates, captions, textOverlays, captionLanguage, voiceLanguage, settings]);

  useEffect(() => {
    // Strip out transient waveform and filmstrip variables for history change detection.
    const cleanAudioTracks = audioTracks.map(({ waveform, waveformLoading, waveformError, ...rest }) => rest);
    const cleanScenes = scenes.map(({ filmstrip, ...rest }) => rest);
    const cleanCaptions = captions;
    const snapshotClean = JSON.stringify({ scenes: cleanScenes, audioTracks: cleanAudioTracks, captions: cleanCaptions });

    if (restoringHistoryRef.current) {
      const timer = window.setTimeout(() => { restoringHistoryRef.current = false; }, 50);
      return () => window.clearTimeout(timer);
    }

    const currentFull = historyRef.current[historyIndexRef.current];
    let currentClean = '';
    if (currentFull) {
      const parsed = JSON.parse(currentFull);
      const parsedCleanAudio = (parsed.audioTracks || []).map(({ waveform, waveformLoading, waveformError, ...rest }) => rest);
      const parsedCleanScenes = (parsed.scenes || []).map(({ filmstrip, ...rest }) => rest);
      currentClean = JSON.stringify({ scenes: parsedCleanScenes, audioTracks: parsedCleanAudio, captions: parsed.captions || [] });
    }

    if (currentClean === snapshotClean) return;

    const fullSnapshot = JSON.stringify({ scenes, audioTracks, captions });
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(fullSnapshot);
    if (historyRef.current.length > 80) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
    setHistoryVersion(value => value + 1);
  }, [scenes, audioTracks, captions]);

  useEffect(() => {
    const offsets = new Map();
    let offset = 0;
    for (const scene of scenes) {
      offsets.set(scene.id, offset);
      offset += Number(scene.duration || 0) / (scene.kind === 'image' ? 1 : Number(scene.speed || 1));
    }
    setAudioTracks(current => current.map(track => {
      if (!track.detachedFromSceneId || !offsets.has(track.detachedFromSceneId)) return track;
      const start = offsets.get(track.detachedFromSceneId) + Number(track.detachedOffset || 0);
      return Math.abs(Number(track.start || 0) - start) < 0.001 ? track : { ...track, start };
    }));
  }, [scenes]);

  useEffect(() => {
    if (captions.length) setCaptionSampleVisible(false);
  }, [captions.length]);

  useEffect(() => {
    // Auto-heal: re-probe any library video that has no dimensions yet (unprobed / fresh import)
    const unprobed = mediaLibrary.filter(item => item.kind === 'video' && !item.width);
    unprobed.forEach(async item => {
      try {
        const probe = await window.electronAPI?.myExporterProbe?.({ filePath: item.path });
        if (probe?.ok) {
          patchLibraryItem(item.id, {
            sourceDuration: probe.duration || 5,
            duration: probe.duration || 5,
            width: probe.width || 1920,
            height: probe.height || 1080,
            hasAudio: Boolean(probe.hasAudio),
            probeError: ''
          });
        }
      } catch (err) {
        console.error('Auto-probe (library) failed for', item.name, err);
      }
    });
    // Also heal orphan timeline scenes (no libraryId) whose duration looks like the default 5s cap
    const orphanScenes = scenes.filter(s => s.kind === 'video' && !s.libraryId && Number(s.sourceDuration || 0) <= 5.1 && !s._probeAttempted);
    orphanScenes.forEach(async scene => {
      patchScene(scene.id, { _probeAttempted: true });
      try {
        const probe = await window.electronAPI?.myExporterProbe?.({ filePath: scene.path });
        if (probe?.ok && probe.duration > 5.1) {
          patchScene(scene.id, {
            sourceDuration: probe.duration,
            duration: probe.duration,
            width: probe.width || 1920,
            height: probe.height || 1080,
            hasAudio: Boolean(probe.hasAudio),
            probeError: '',
            _probeAttempted: true
          });
        }
      } catch (err) {
        console.error('Auto-probe (scene) failed for', scene.name, err);
      }
    });
  }, [mediaLibrary.length, scenes.length]);

  const patchScene = (id, patch) => setScenes(current => current.map(scene => scene.id === id ? { ...scene, ...patch } : scene));
  const patchLibraryItem = (id, patch) => {
    setMediaLibrary(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
    setScenes(current => current.map(scene => scene.libraryId === id ? { ...scene, ...patch } : scene));
  };

  const projectData = () => ({ format: 'pattan-my-exporter-project', version: 3, projectName, savedAt: new Date().toISOString(), scenes, mediaLibrary, audioTracks, captions, textOverlays, music, watermark: watermark ? { ...watermark, preview: '' } : null, watermarkEnabled, playbackMode, trackStates, captionLanguage, voiceLanguage, settings });
  const currentWorkspaceData = () => ({ ...projectData(), projectPath, selectedId });
  const applyWorkspaceData = data => {
    const next = data || {};
    const nextSettings = { ...DEFAULT_SETTINGS, ...(next.settings || {}) };
    setScenes((next.scenes || []).map(scene => ({ ...scene, fit: nextSettings.framing }))); setMediaLibrary(next.mediaLibrary || []); setAudioTracks(next.audioTracks || []); setCaptions(next.captions || []); setTextOverlays(next.textOverlays || []); setMusic(next.music || null); setWatermark(next.watermark || DEFAULT_LOGO); setWatermarkEnabled(Boolean(next.watermarkEnabled)); setPlaybackMode(next.playbackMode || 'continuous'); setTrackStates(next.trackStates || { videoLocked: false, audioLocked: false, audioMuted: false, captionsLocked: false, captionsMuted: false }); setCaptionLanguage(next.captionLanguage || 'auto'); setVoiceLanguage(next.voiceLanguage || 'hi'); setSettings(nextSettings); setProjectName(next.projectName || 'Untitled Project'); setProjectPath(next.projectPath || 'Not saved yet'); setSelectedId(next.selectedId || ''); setSelectedAudioId(''); setSelectedCaptionId(''); setSelectedTextId(''); setPlayheadTime(0); setResult(null); setWarning('');
  };
  const switchWorkspace = id => {
    if (id === activeWorkspaceId || captioning || exporting) return;
    const target = workspaceTabs.find(tab => tab.id === id); if (!target) return;
    const savedCurrent = currentWorkspaceData();
    setWorkspaceTabs(current => current.map(tab => tab.id === activeWorkspaceId ? { ...tab, name: projectName, data: savedCurrent } : tab));
    setActiveWorkspaceId(id); applyWorkspaceData(target.data || {});
  };
  const addWorkspace = () => {
    if (captioning || exporting) return;
    const savedCurrent = currentWorkspaceData(); const id = uid();
    setWorkspaceTabs(current => [...current.map(tab => tab.id === activeWorkspaceId ? { ...tab, name: projectName, data: savedCurrent } : tab), { id, name: `Project ${current.length + 1}`, data: {} }]);
    setActiveWorkspaceId(id); applyWorkspaceData({ projectName: `Project ${workspaceTabs.length + 1}` });
  };

  const saveProject = async () => {
    try {
      const picked = await window.electronAPI?.showSaveDialog?.({ title: 'Save My Exporter project', defaultPath: `${projectName === 'Untitled Project' ? 'My-Exporter-Project' : projectName}.pattanproject`, filters: [{ name: 'Pattan Project', extensions: ['pattanproject'] }], buttonLabel: 'Save Project' });
      if (picked?.canceled || !picked?.filePath) return;
      const nextName = picked.filePath.split(/[\\/]/).pop().replace(/\.pattanproject$/i, '');
      const data = { ...projectData(), projectName: nextName };
      const result = await window.electronAPI.writeFile(picked.filePath, textToBase64(JSON.stringify(data, null, 2)));
      if (!result?.ok) throw new Error(result?.error || 'Project could not be saved.');
      setProjectName(nextName); setProjectPath(picked.filePath); setProgress({ pct: 100, phase: `Project saved: ${nextName} · ${picked.filePath}` });
    } catch (error) { setWarning(`Project save failed: ${error.message}`); }
  };

  const openProjectFile = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== 'pattan-my-exporter-project') throw new Error('This is not a My Exporter project file.');
      const openedPath = window.electronAPI?.getPathForFile?.(file) || file.path || file.name;
      const openedSettings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) }; setScenes((data.scenes || []).map(scene => ({ ...scene, fit: openedSettings.framing }))); setMediaLibrary((data.mediaLibrary || []).map(item => ({ ...item, fit: openedSettings.framing }))); setAudioTracks(data.audioTracks || []); setCaptions(data.captions || []); setTextOverlays(data.textOverlays || []); setMusic(data.music || null); setWatermark(!data.watermark || /info kids/i.test(data.watermark.name || '') ? DEFAULT_LOGO : data.watermark); setWatermarkEnabled(Boolean(data.watermarkEnabled)); setPlaybackMode(data.playbackMode || 'continuous'); setTrackStates(data.trackStates || trackStates); setCaptionLanguage(data.captionLanguage || 'auto'); setVoiceLanguage(data.voiceLanguage || 'hi'); setSettings(openedSettings); setProjectName(data.projectName || file.name.replace(/\.pattanproject$/i, '')); setProjectPath(openedPath); setSelectedId(''); setSelectedAudioId(''); setSelectedCaptionId(''); setSelectedTextId(''); setPlayheadTime(0); setWarning('');
      setProgress({ pct: 100, phase: `Project opened: ${data.projectName || file.name}` });
    } catch (error) { setWarning(`Project open failed: ${error.message}`); }
  };

  const newProject = () => {
    if ((scenes.length || audioTracks.length || captions.length || mediaLibrary.length) && !window.confirm('Create a new project? Save your current project first if you want to keep it.')) return;
    setScenes([]); setMediaLibrary([]); setAudioTracks([]); setCaptions([]); setTextOverlays([]); setMusic(null); setWatermark(DEFAULT_LOGO); setWatermarkEnabled(false); setPlaybackMode('continuous'); setSelectedId(''); setSelectedAudioId(''); setSelectedCaptionId(''); setSelectedTextId(''); setPlayheadTime(0); setResult(null); setProjectName('Untitled Project'); setProjectPath('Not saved yet'); setWarning(''); localStorage.removeItem(PROJECT_KEY); setProgress({ pct: 0, phase: 'New project ready' });
  };

  const resetExporter = () => {
    if (captioning || exporting) {
      setWarning('Stop the current caption or export process before resetting My Exporter.');
      return;
    }
    if (!window.confirm('Reset My Exporter? This clears all loaded media, timeline clips, audio, captions, text, logos, settings, previews and project tabs. Saved files on your computer will not be deleted.')) return;
    try { preview.current?.pause?.(); } catch (_) {}
    try { audioPreview.current?.pause?.(); } catch (_) {}
    try { audioSelectionPreview.current?.pause?.(); } catch (_) {}
    setScenes([]); setMediaLibrary([]); setAudioTracks([]); setCaptions([]); setTextOverlays([]);
    setMusic(null); setWatermark(DEFAULT_LOGO); setWatermarkEnabled(false);
    setSettings({ ...DEFAULT_SETTINGS });
    setTrackStates({ videoLocked: false, audioLocked: false, audioMuted: false, captionsLocked: false, captionsMuted: false });
    setPlaybackMode('continuous'); setCaptionLanguage('auto'); setVoiceLanguage('hi'); setDetectedCaptionLanguage('');
    setSelectedId(''); setSelectedIds([]); setSelectedAudioId(''); setSelectedCaptionId(''); setSelectedTextId('');
    setEditingCaptionId(''); setDraggingId(''); setContextMenu(null); setAudioClipboard(null); setSceneClipboard(null);
    setAudioSelection(null); setAudioCutSelectionModeId(''); setDetectedStutters([]);
    setCaptionEditorOpen(false); setStutterCutterOpen(false); setCaptionSampleVisible(true);
    setPlayheadTime(0); setIsPreviewPlaying(false); setResult(null); setSafeGuides(false); setAdvancedMode(false);
    setTimelineZoom(1); setSnapEnabled(true); setRippleEnabled(true); setPreviewLarge(false);
    setTimelineExpanded(false); setExpandedTimelineTrack(''); setOpenSidePanel(''); setAssetTab('Media');
    setCropSource(null); setCropRect({ x: 0, y: 0, width: 100, height: 100 }); setCropPartCount(1);
    setCropParts([{ start: 0, end: 0 }]); setCropParallelExports(2); setLayoutPickerOpen(false); setLayoutMode('default');
    setProjectName('Untitled Project'); setProjectPath('Not saved yet');
    const workspaceId = uid();
    setWorkspaceTabs([{ id: workspaceId, name: 'Project 1', data: null }]); setActiveWorkspaceId(workspaceId);
    historyRef.current = []; historyIndexRef.current = -1; setHistoryVersion(value => value + 1);
    try {
      localStorage.removeItem(PROJECT_KEY);
      localStorage.removeItem('mx-clipboard-scenes');
      localStorage.removeItem('mx-layout-mode');
    } catch (_) {}
    setWarning(''); setProgress({ pct: 0, phase: 'My Exporter reset complete. Everything is clear.' });
  };

  const deleteProject = async () => {
    if (!window.confirm(`Delete project “${projectName}”? This clears the editor${projectPath !== 'Not saved yet' ? ' and deletes the saved project file' : ''}.`)) return;
    if (projectPath !== 'Not saved yet' && typeof window.electronAPI?.myExporterDeleteProject === 'function') {
      const result = await window.electronAPI.myExporterDeleteProject(projectPath);
      if (!result?.ok) { setWarning(`Project file could not be deleted: ${result?.error || 'Unknown error'}`); return; }
    }
    setScenes([]); setMediaLibrary([]); setAudioTracks([]); setCaptions([]); setTextOverlays([]); setMusic(null); setWatermark(DEFAULT_LOGO); setWatermarkEnabled(false); setPlaybackMode('continuous'); setSelectedId(''); setSelectedAudioId(''); setSelectedCaptionId(''); setSelectedTextId(''); setPlayheadTime(0); setResult(null); setProjectName('Untitled Project'); setProjectPath('Not saved yet'); localStorage.removeItem(PROJECT_KEY); setWarning(''); setProgress({ pct: 0, phase: 'Project deleted. New empty project ready.' });
  };

  const restoreHistory = direction => {
    const nextIndex = historyIndexRef.current + direction;
    if (nextIndex < 0 || nextIndex >= historyRef.current.length) return;
    const snapshot = JSON.parse(historyRef.current[nextIndex]);
    restoringHistoryRef.current = true;
    historyIndexRef.current = nextIndex;
    setScenes(snapshot.scenes || []); setAudioTracks(snapshot.audioTracks || []); setCaptions(snapshot.captions || []);
    setSelectedId(''); setSelectedAudioId(''); setSelectedCaptionId(''); setWarning('');
    setHistoryVersion(value => value + 1);
  };

  const commitTimelineHistory = (nextScenes, nextAudioTracks, nextCaptions) => {
    const before = JSON.stringify({ scenes, audioTracks, captions });
    const after = JSON.stringify({ scenes: nextScenes, audioTracks: nextAudioTracks, captions: nextCaptions });
    let history = historyRef.current.slice(0, historyIndexRef.current + 1);
    if (history[history.length - 1] !== before) history.push(before);
    if (after !== before) history.push(after);
    if (history.length > 80) history = history.slice(-80);
    historyRef.current = history;
    historyIndexRef.current = history.length - 1;
    restoringHistoryRef.current = true;
    setHistoryVersion(value => value + 1);
  };

  const importMediaEntries = async entries => {
    if (!entries.length) return;
    const failures = [];
    const additions = serialSort(entries.map(entry => {
      const filePath = entry.path || '';
      const name = entry.name || filePath.split(/[\\/]/).pop() || 'Media';
      if (!filePath) { failures.push(`${name}: Windows path was unavailable`); return null; }
      const kind = entry.type?.startsWith('image/') || /\.(jpe?g|png|webp|bmp)$/i.test(filePath) ? 'image' : 'video';
      return { id: uid(), name, path: filePath, kind, sourceDuration: kind === 'image' ? 4 : 5, trimStart: 0, duration: kind === 'image' ? 4 : 5, width: 0, height: 0, hasAudio: kind === 'video', probeError: kind === 'video' ? 'Reading media details...' : '', muted: false, volume: 1, speed: 1, rotation: 0, fit: settings.framing || 'contain', brightness: 0, contrast: 1, saturation: 1, fade: 0 };
    }).filter(Boolean));

    if (additions.length) setMediaLibrary(current => serialSort([...current, ...additions]));
    setResult(null);
    setProgress({ pct: additions.length ? 25 : 0, phase: additions.length ? `Added ${additions.length} file${additions.length === 1 ? '' : 's'} to the media library. Press Serial Sync to place them on the timeline.` : `Nothing was added. ${failures[0] || 'Select a supported local video or image.'}` });

    await Promise.all(additions.filter(scene => scene.kind === 'video').map(async scene => {
      try {
        const probe = await window.electronAPI?.myExporterProbe?.({ filePath: scene.path });
        if (probe?.ok) {
          patchLibraryItem(scene.id, { sourceDuration: probe.duration || 5, duration: probe.duration || 5, width: probe.width || 0, height: probe.height || 0, hasAudio: Boolean(probe.hasAudio), probeError: '' });
        } else {
          const message = probe?.error || 'Media details unavailable';
          failures.push(`${scene.name}: ${message}`);
          patchLibraryItem(scene.id, { probeError: message });
        }
      } catch (error) {
        failures.push(`${scene.name}: ${error.message}`);
        patchLibraryItem(scene.id, { probeError: error.message });
      }
    }));

    if (additions.length) {
      setProgress({ pct: 100, phase: failures.length ? `Media imported. ${failures[0]}` : `${additions.length} media file${additions.length === 1 ? '' : 's'} ready. Press Serial Sync to add them in order.` });
    }
  };

  const addMedia = async event => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    await importMediaEntries(files.map(file => ({
      name: file.name,
      type: file.type,
      path: window.electronAPI?.getPathForFile?.(file) || file.path || '',
    })));
  };

  const pickMedia = async () => {
    try {
      if (typeof window.electronAPI?.myExporterPickMedia !== 'function') throw new Error('Native picker is unavailable until restart.');
      const result = await window.electronAPI.myExporterPickMedia();
      if (!result?.ok) throw new Error(result?.error || 'Windows media picker failed.');
      if (result.canceled) return;
      await importMediaEntries((result.filePaths || []).map(filePath => ({ path: filePath })));
    } catch (error) {
      setProgress({ pct: 0, phase: `${error.message} Opening compatibility picker...` });
      mediaInput.current?.click();
    }
  };

  const pickCropVideo = async () => {
    try {
      const result = await window.electronAPI?.myExporterPickMedia?.();
      if (!result?.ok) throw new Error(result?.error || 'Could not open the video picker.');
      if (result.canceled || !result.filePaths?.[0]) return;
      const filePath = result.filePaths[0];
      const probe = await window.electronAPI?.myExporterProbe?.({ filePath });
      if (!probe?.ok) throw new Error(probe?.error || 'Could not read this video.');
      setCropSource({ path: filePath, name: filePath.split(/[\\/]/).pop(), width: probe.width, height: probe.height, duration: probe.duration, videoBitrate: probe.videoBitrate, frameRate: probe.frameRate, videoCodec: probe.videoCodec });
      setCropRect({ x: 0, y: 0, width: 100, height: 100 });
      setCropPartCount(1); setCropParts([{ start: 0, end: probe.duration }]);
      setProgress({ pct: 100, phase: 'Large video opened for direct crop. It was not added to the project.' });
    } catch (error) { setWarning(`Crop video: ${error.message}`); }
  };

  const changeCropPartCount = countValue => {
    const count = Math.max(1, Math.min(20, Number(countValue) || 1));
    const duration = Number(cropSource?.duration || 0);
    setCropPartCount(count);
    setCropParts(current => Array.from({ length: count }, (_, index) => current[index] || { start: duration * index / count, end: duration * (index + 1) / count }));
  };

  const markCropPart = (index, edge) => {
    const time = Math.max(0, Math.min(Number(cropSource?.duration || 0), Number(cropPreview.current?.currentTime || 0)));
    setCropParts(current => current.map((part, partIndex) => partIndex !== index ? part : edge === 'start' ? { ...part, start: Math.min(time, part.end - .01) } : { ...part, end: Math.max(part.start + .01, time) }));
  };

  const saveCroppedVideo = async () => {
    if (!cropSource || cropSaving) return;
    const base = cropSource.name.replace(/\.[^.]+$/, '');
    const picked = await window.electronAPI?.showSaveDialog?.({ title: 'Save cropped video directly to this computer', defaultPath: `${base}-cropped.mp4`, filters: [{ name: 'MP4 Video', extensions: ['mp4'] }], buttonLabel: 'Save Cropped Video' });
    if (picked?.canceled || !picked?.filePath) return;
    setCropSaving(true); setWarning(''); setProgress({ pct: 1, phase: 'Starting direct local crop save' });
    try {
      const jobs = cropParts.map((part, index) => {
        if (Number(part.end) <= Number(part.start)) throw new Error(`Part ${index + 1} needs an END after its START.`);
        return { index, part, outputPath: cropParts.length === 1 ? picked.filePath : picked.filePath.replace(/\.mp4$/i, `-part-${String(index + 1).padStart(2, '0')}.mp4`) };
      });
      const saved = new Array(jobs.length);
      const failures = [];
      let nextJob = 0; let completedJobs = 0;
      const worker = async () => {
        while (nextJob < jobs.length) {
          const job = jobs[nextJob]; nextJob += 1;
          setProgress({ pct: Math.round(completedJobs / jobs.length * 100), phase: `Saving ${Math.min(cropParallelExports, jobs.length - completedJobs)} part${Math.min(cropParallelExports, jobs.length - completedJobs) === 1 ? '' : 's'} simultaneously · completed ${completedJobs} of ${jobs.length}` });
          const response = await window.electronAPI?.myExporterCropSave?.({ inputPath: cropSource.path, outputPath: job.outputPath, crop: cropRect, start: job.part.start, end: job.part.end });
          if (!response?.ok) failures.push(`Part ${job.index + 1}: ${response?.error || 'Crop save failed.'}`);
          else saved[job.index] = response;
          completedJobs += 1;
        }
      };
      await Promise.all(Array.from({ length: Math.min(cropParallelExports, jobs.length) }, () => worker()));
      if (failures.length) throw new Error(`${failures.join(' | ')}${saved.some(Boolean) ? ` · ${saved.filter(Boolean).length} other part(s) saved successfully.` : ''}`);
      const completed = saved.filter(Boolean);
      const response = completed[completed.length - 1];
      setResult({ outputPath: response.outputPath, width: response.width, height: response.height, duration: cropParts.reduce((sum, part) => sum + part.end - part.start, 0) });
      setProgress({ pct: 100, phase: `${saved.length} cropped part${saved.length === 1 ? '' : 's'} saved locally with source bitrate, audio and captions.` });
      window.electronAPI?.showNotification?.('Batch crop complete', `${saved.length} video part${saved.length === 1 ? '' : 's'} saved locally.`);
    } catch (error) { setWarning(`Crop video was not saved: ${error.message}`); }
    finally { setCropSaving(false); }
  };

  const addMusic = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMusic({ name: file.name, path: window.electronAPI?.getPathForFile?.(file) || file.path || '' });
  };

  const pickAudioTracks = async () => {
    try {
      const result = await window.electronAPI?.myExporterPickAudio?.();
      if (!result?.ok) throw new Error(result?.error || 'Could not open the audio picker.');
      if (result.canceled) return;
      const additions = [];
      for (const filePath of result.filePaths || []) {
        const probe = await window.electronAPI?.myExporterProbe?.({ filePath });
        additions.push({ id: uid(), name: filePath.split(/[\\/]/).pop(), path: filePath, start: 0, trimStart: 0, duration: probe?.duration || Math.max(5, totalDuration), sourceDuration: probe?.duration || 0, volume: 1, muted: false });
      }
      setAudioTracks(current => [...current, ...additions]);
      additions.forEach(track => loadWaveform(track.id, track.path));
      setProgress({ pct: 100, phase: `Added ${additions.length} audio track${additions.length === 1 ? '' : 's'}.` });
    } catch (error) {
      setProgress({ pct: 0, phase: error.message });
    }
  };

  const patchAudioTrack = (id, patch) => setAudioTracks(current => current.map(track => track.id === id ? { ...track, ...patch } : track));
  const loadWaveform = async (id, filePath, clip = null) => {
    if (typeof window.electronAPI?.myExporterWaveform !== 'function') return;
    patchAudioTrack(id, { waveformLoading: true });
    try {
      const response = await window.electronAPI.myExporterWaveform({ filePath, bars: 120 });
      if (response?.ok) {
        let waveform = response.peaks || [];
        if (clip && waveform.length) {
          const sourceDuration = Math.max(.001, Number(clip.sourceDuration || clip.duration));
          const from = Math.max(0, Math.min(waveform.length - 1, Math.floor(Number(clip.trimStart || 0) / sourceDuration * waveform.length)));
          const to = Math.max(from + 1, Math.min(waveform.length, Math.ceil((Number(clip.trimStart || 0) + Number(clip.duration) * Number(clip.speed || 1)) / sourceDuration * waveform.length)));
          waveform = waveform.slice(from, to);
        }
        patchAudioTrack(id, { waveform, waveformLoading: false });
      } else patchAudioTrack(id, { waveform: [], waveformLoading: false, waveformError: response?.error || 'Waveform unavailable' });
    } catch (error) { patchAudioTrack(id, { waveform: [], waveformLoading: false, waveformError: error.message }); }
  };

  const syncBySerialNumber = () => {
    if (!mediaLibrary.length) return;
    const sortedLibrary = serialSort(mediaLibrary);
    const existingByLibrary = new Map(scenes.filter(scene => scene.libraryId).map(scene => [scene.libraryId, scene]));
    const linkedIds = new Set(sortedLibrary.map(asset => asset.id));
    const syncedScenes = sortedLibrary.map(asset => ({ ...(existingByLibrary.get(asset.id) || { ...asset, id: uid(), libraryId: asset.id, probeError: '' }), fit: settings.framing || 'contain' }));
    const independentEdits = scenes.filter(scene => !scene.libraryId || !linkedIds.has(scene.libraryId)).map(scene => ({ ...scene, fit: settings.framing || 'contain' }));
    setMediaLibrary(sortedLibrary);
    setScenes([...syncedScenes, ...independentEdits]);
    if (syncedScenes[0]) setSelectedId(syncedScenes[0].id);
    setCaptions([]);
    setProgress({ pct: 100, phase: `Serial Sync complete — ${syncedScenes.length} library videos placed on the timeline in 1, 2, 3… order.` });
  };

  const detachSelectedAudio = () => {
    if (!selected || selected.kind !== 'video' || !selected.hasAudio) {
      setWarning('Select a video that contains audio before using Detach Audio.');
      return;
    }
    const existing = audioTracks.find(track => track.detachedFromSceneId === selected.id || track.originSceneId === selected.id || track.reattachedToSceneId === selected.id);
    if (existing) {
      setSelectedAudioId(existing.id);
      setSelectedId('');
      setWarning('This scene audio is already detached. The existing audio clip is selected.');
      return;
    }
    const track = {
      id: uid(),
      name: `${selected.name} — detached audio`,
      path: selected.path,
      start: sceneTimelineOffset(selected.id),
      trimStart: Number(selected.trimStart) || 0,
      duration: (Number(selected.duration) || 0.1) / Math.max(.5, Number(selected.speed) || 1),
      sourceDuration: Number(selected.sourceDuration) || Number(selected.duration) || 0,
      speed: Math.max(.5, Number(selected.speed) || 1),
      volume: Number.isFinite(Number(selected.volume)) ? Number(selected.volume) : 1,
      muted: false,
      detachedFromSceneId: selected.id,
      originSceneId: selected.id,
      detachedOffset: 0,
      timelineOffsetWithinScene: 0,
      sourceSceneDuration: (Number(selected.duration) || 0.1) / Math.max(.5, Number(selected.speed) || 1),
    };
    const nextTracks = [...audioTracks, track];
    const nextScenes = scenes.map(scene => scene.id === selected.id ? { ...scene, muted: true } : scene);
    setAudioTracks(nextTracks);
    setScenes(nextScenes);
    loadWaveform(track.id, track.path, track);
    setSelectedAudioId(track.id);
    setSelectedId('');
    setWarning('');
    setProgress({ pct: 100, phase: 'Audio detached and placed in sync below the video.' });
    commitTimelineHistory(nextScenes, nextTracks, captions);
  };

  const addWatermark = event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setWatermark({ name: file.name, path: window.electronAPI?.getPathForFile?.(file) || file.path || '', preview: URL.createObjectURL(file) });
    setWatermarkEnabled(true);
    setWarning(/\.(png|webp)$/i.test(file.name) ? '' : 'This logo format can contain a solid background. For a logo that blends cleanly over video, use a transparent PNG or WebP.');
  };

  const setWatermarkPreset = position => {
    const [watermarkX, watermarkY] = WATERMARK_POSITIONS[position] || WATERMARK_POSITIONS['top-right'];
    setSettings(value => ({ ...value, watermarkPosition: position, watermarkX, watermarkY }));
  };

  const coverFlowWatermark = () => {
    setWatermark(DEFAULT_LOGO);
    setWatermarkEnabled(true);
    setSettings(value => ({ ...value, watermarkPosition: 'custom', watermarkX: 87, watermarkY: 90, watermarkScale: 22, watermarkOpacity: 1 }));
    setProgress({ pct: 100, phase: 'Info Kids logo positioned over the Flow watermark. Drag or resize it if this video needs a small adjustment.' });
  };

  const autoInjectSfx = async () => {
    if (!captions.length) {
      setWarning('Generate captions or Auto-Mux a project first before injecting sound effects.');
      return;
    }
    setProgress({ pct: 10, phase: 'Scanning captions for sound keywords...' });
    try {
      const addedTracks = [];
      const sfxTypes = ['ding', 'click', 'whoosh', 'cheer', 'typing'];
      for (const cap of captions) {
        const text = String(cap.text || '').toLowerCase();
        for (const type of sfxTypes) {
          if (text.includes(`[${type}]`) || text.includes(type)) {
            setProgress({ pct: 50, phase: `Generating ${type} sound effect...` });
            const result = await window.electronAPI.presentatorAgentGenerateSfx({ type });
            if (result?.ok) {
              addedTracks.push({
                id: `audio-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                name: `${type.toUpperCase()} SFX`,
                path: result.filePath,
                start: cap.start,
                duration: type === 'cheer' ? 2.5 : type === 'typing' ? 1.2 : 0.8,
                volume: 0.6,
                muted: false
              });
            }
          }
        }
      }
      if (addedTracks.length > 0) {
        setAudioTracks(prev => [...prev, ...addedTracks]);
        setProgress({ pct: 100, phase: `Successfully injected ${addedTracks.length} sound effects!` });
        setTimeout(() => setProgress({ pct: 0, phase: 'Ready' }), 1500);
      } else {
        setWarning('No sound effect triggers found in captions. Try adding keywords like [whoosh], [ding], [click], [cheer], or [typing] to your captions.');
        setProgress({ pct: 0, phase: 'Ready' });
      }
    } catch (err) {
      setWarning(`SFX injection failed: ${err.message}`);
      setProgress({ pct: 0, phase: 'Ready' });
    }
  };

  const generateChapters = () => {
    if (!scenes.length) {
      setWarning('No scenes found on the timeline.');
      return;
    }
    const newOverlays = [];
    let cumulativeTime = 0;
    scenes.forEach((scene, index) => {
      const duration = Number(scene.duration || 5);
      const cleanName = String(scene.name || '').replace(/director_scene_\d+_/i, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
      const title = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
      
      newOverlays.push({
        id: `overlay-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        text: `Chapter ${index + 1}: ${title}`,
        x: 50,
        y: 15,
        fontSize: 48,
        opacity: 0.9,
        color: '#facc15',
        fontFamily: 'Segoe UI',
        shape: 'box',
        depth: 4,
        start: cumulativeTime,
        end: Math.min(cumulativeTime + duration, cumulativeTime + 3.5)
      });
      cumulativeTime += duration;
    });

    setTextOverlays(prev => [...prev, ...newOverlays]);
    setProgress({ pct: 100, phase: `Successfully generated ${newOverlays.length} chapters across the timeline!` });
    setTimeout(() => setProgress({ pct: 0, phase: 'Ready' }), 1500);
  };

  const morphSelectedAudio = async () => {
    if (!selectedAudio) {
      setWarning('Select an audio track on the timeline first.');
      return;
    }
    setAudioMorphing(true);
    setProgress({ pct: 30, phase: `Cloning & morphing timbre to ${targetMorphVoice}...` });
    try {
      const result = await window.electronAPI.presentatorAgentMorphAudio({
        sourcePath: selectedAudio.path,
        voice: targetMorphVoice
      });
      if (!result?.ok || !result?.morphedPath) {
        throw new Error(result?.error || 'Morphed file unavailable.');
      }
      
      // Add morphed track to timeline
      const morphedTrack = {
        id: `audio-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        name: `${selectedAudio.name} (Morphed)`,
        path: result.morphedPath,
        start: selectedAudio.start,
        duration: selectedAudio.duration,
        volume: selectedAudio.volume,
        muted: false
      };

      // Mute the original track
      patchAudioTrack(selectedAudio.id, { muted: true });

      setAudioTracks(prev => [...prev, morphedTrack]);
      setSelectedAudioId(morphedTrack.id);
      setProgress({ pct: 100, phase: 'Timbre morphing complete!' });
      setTimeout(() => setProgress({ pct: 0, phase: 'Ready' }), 1500);
    } catch (err) {
      setWarning(`Morphing failed: ${err.message}`);
      setProgress({ pct: 0, phase: 'Ready' });
    } finally {
      setAudioMorphing(false);
    }
  };

  const addTextOverlay = () => {
    const item = { id: uid(), text: 'My Company', x: 50, y: 25, fontSize: 64, opacity: .8, color: '#ffffff', fontFamily: 'Arial', shape: 'none', depth: 4, start: 0, end: Math.max(.1, totalDuration) };
    setTextOverlays(current => [...current, item]);
    setSelectedTextId(item.id);
  };
  const patchTextOverlay = (id, patch) => setTextOverlays(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  const beginTextDrag = (event, item) => {
    if (!viewer.current || !previewFrame.width) return;
    event.preventDefault(); event.stopPropagation(); setSelectedTextId(item.id);
    const move = pointerEvent => {
      const rect = viewer.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, (pointerEvent.clientX - rect.left - previewFrame.left) / previewFrame.width * 100));
      const y = Math.max(0, Math.min(100, (pointerEvent.clientY - rect.top - previewFrame.top) / previewFrame.height * 100));
      patchTextOverlay(item.id, { x, y });
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true });
  };

  const togglePreviewFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await viewer.current?.requestFullscreen?.();
      window.setTimeout(updatePreviewFrame, 120);
    } catch (error) { setWarning(`Fullscreen preview could not open: ${error.message}`); }
  };

  const beginWatermarkDrag = event => {
    if (!watermark || !viewer.current || !previewFrame.width || !previewFrame.height) return;
    event.preventDefault(); event.stopPropagation();
    const move = pointerEvent => {
      const rect = viewer.current.getBoundingClientRect();
      const localX = pointerEvent.clientX - rect.left - previewFrame.left;
      const localY = pointerEvent.clientY - rect.top - previewFrame.top;
      const half = Math.max(2.5, Number(settings.watermarkScale || 16) / 2);
      const watermarkX = Math.max(half, Math.min(100 - half, localX / previewFrame.width * 100));
      const watermarkY = Math.max(3, Math.min(97, localY / previewFrame.height * 100));
      setSettings(value => ({ ...value, watermarkPosition: 'custom', watermarkX, watermarkY }));
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const beginWatermarkResize = event => {
    if (!viewer.current || !previewFrame.width) return;
    event.preventDefault(); event.stopPropagation();
    const startX = event.clientX;
    const startScale = Number(settings.watermarkScale || 16);
    const move = pointerEvent => {
      const scaleDelta = (pointerEvent.clientX - startX) / previewFrame.width * 100;
      setSettings(value => ({ ...value, watermarkScale: Math.max(5, Math.min(40, startScale + scaleDelta)) }));
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const trimSelectedAudioStart = amount => {
    if (!selectedAudio || trackStates.audioLocked) return;
    const cut = Math.max(0, Math.min(Number(amount) || 0, Number(selectedAudio.duration) - .1));
    if (!cut) return;
    patchAudioTrack(selectedAudio.id, { start: Number(selectedAudio.start) + cut, trimStart: Number(selectedAudio.trimStart) + cut * Number(selectedAudio.speed || 1), duration: Number(selectedAudio.duration) - cut, detachedOffset: Number(selectedAudio.detachedOffset || 0) + cut });
  };

  const trimSelectedAudioEnd = amount => {
    if (!selectedAudio || trackStates.audioLocked) return;
    const cut = Math.max(0, Math.min(Number(amount) || 0, Number(selectedAudio.duration) - .1));
    if (cut) patchAudioTrack(selectedAudio.id, { duration: Number(selectedAudio.duration) - cut });
  };

  const trimSelectedAudioToPlayhead = edge => {
    if (!selectedAudio || trackStates.audioLocked) return;
    const local = playheadTime - Number(selectedAudio.start);
    if (local <= .05 || local >= Number(selectedAudio.duration) - .05) { setWarning('Move the gold stick inside the selected audio before trimming.'); return; }
    if (edge === 'start') trimSelectedAudioStart(local); else patchAudioTrack(selectedAudio.id, { duration: local });
    setWarning('');
  };

  const applyExportPreset = preset => {
    const values = {
      youtube4k: { resolution: '4k', fps: 30, quality: 'maximum' },
      cinematic: { resolution: '4k', fps: 24, quality: 'maximum' },
      shorts: { resolution: 'vertical', fps: 30, quality: 'balanced' },
      reels: { resolution: 'vertical', fps: 30, quality: 'maximum' },
      smooth: { resolution: '1440p', fps: 60, quality: 'balanced' },
    }[preset];
    setSettings(current => ({ ...current, ...values }));
  };

  const moveScene = (id, direction) => setScenes(current => {
    const index = current.findIndex(scene => scene.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
    const next = [...current];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    return next;
  });

  const moveSceneTo = (sourceId, targetId) => setScenes(current => {
    const from = current.findIndex(scene => scene.id === sourceId);
    const to = current.findIndex(scene => scene.id === targetId);
    if (from < 0 || to < 0 || from === to) return current;
    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  });

  const sceneTimelineOffset = id => {
    let offset = 0;
    for (const scene of scenes) {
      if (scene.id === id) return offset;
      offset += Number(scene.duration || 0) / (scene.kind === 'image' ? 1 : Number(scene.speed || 1));
    }
    return offset;
  };

  useEffect(() => {
    if (!scenes.length || !audioTracks.length) return;
    setAudioTracks(current => {
      let changed = false;
      const next = current.map(track => {
        const explicitSceneId = track.originSceneId || track.detachedFromSceneId || track.reattachedToSceneId;
        const sourceScene = scenes.find(scene => scene.id === explicitSceneId) || (!track.pastedAudio && /detached audio|reattached edited audio|before cut|after cut/i.test(track.name || '') ? scenes.find(scene => scene.path === track.path) : null);
        if (!sourceScene) return track;
        const sceneStart = sceneTimelineOffset(sourceScene.id);
        const sceneDuration = Number(sourceScene.duration || 0) / (sourceScene.kind === 'image' ? 1 : Math.max(.5, Number(sourceScene.speed || 1)));
        const sceneEnd = sceneStart + sceneDuration;
        const storedOffset = Number.isFinite(Number(track.timelineOffsetWithinScene)) ? Number(track.timelineOffsetWithinScene) : Math.max(0, Number(track.start || 0) - sceneStart);
        const start = Math.max(sceneStart, Math.min(sceneEnd - .001, sceneStart + storedOffset));
        const duration = Math.max(.001, Math.min(Number(track.duration || .001), sceneEnd - start));
        if (Math.abs(start - Number(track.start || 0)) < .001 && Math.abs(duration - Number(track.duration || 0)) < .001 && track.originSceneId === sourceScene.id) return track;
        changed = true;
        return { ...track, start, duration, originSceneId: sourceScene.id, sourceSceneDuration: sceneDuration, timelineOffsetWithinScene: start - sceneStart };
      });
      return changed ? next : current;
    });
  }, [scenes, audioTracks]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const audioElements = [...document.querySelectorAll('.mx-track-row .mx-audio-clip')];
      const videoElements = [...document.querySelectorAll('.mx-video-lane:not(.mx-image-lane) .mx-clip')];
      const videoScenes = scenes.filter(scene => scene.kind === 'video');
      audioElements.forEach((element, index) => {
        const track = audioTracks[index];
        if (!track) return;
        if (track.pastedAudio) return;
        const sceneId = track.originSceneId || track.detachedFromSceneId || track.reattachedToSceneId;
        const sceneIndex = videoScenes.findIndex(scene => scene.id === sceneId || (!sceneId && scene.path === track.path));
        const scene = videoScenes[sceneIndex];
        const videoElement = videoElements[sceneIndex];
        if (!scene || !videoElement) return;
        const sceneLeft = parseFloat(videoElement.style.left) || 0;
        const sceneWidth = parseFloat(videoElement.style.width) || 0;
        const sceneStart = sceneTimelineOffset(scene.id);
        const sceneDuration = Number(scene.duration || 0) / Math.max(.5, Number(scene.speed || 1));
        const offsetRatio = Math.max(0, Math.min(1, (Number(track.start) - sceneStart) / Math.max(.001, sceneDuration)));
        const durationRatio = Math.max(.0001, Math.min(1 - offsetRatio, Number(track.duration) / Math.max(.001, sceneDuration)));
        element.style.setProperty('left', `${sceneLeft + sceneWidth * offsetRatio}%`, 'important');
        element.style.setProperty('width', `${sceneWidth * durationRatio}%`, 'important');
        element.style.setProperty('max-width', `${sceneWidth * (1 - offsetRatio)}%`, 'important');
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scenes, audioTracks, timelineZoom]);

  useEffect(() => {
    const clips = [...document.querySelectorAll('.mx-video-lane:not(.mx-image-lane) .mx-clip')];
    const videoScenes = scenes.filter(scene => scene.kind === 'video');
    
    videoScenes.forEach((scene, index) => {
      const clip = clips[index]; if (!clip) return;
      clip.classList.toggle('scene-disabled', Boolean(scene.disabled));
      clip.classList.remove('mark-gold', 'mark-blue', 'mark-green');
      if (scene.colorMark) clip.classList.add(`mark-${scene.colorMark}`);
    });

    const activeTimers = [];
    videoScenes.forEach((scene, index) => {
      const clip = clips[index]; if (!clip) return;
      let filmstrip = clip.querySelector('.mx-clip-filmstrip');
      if (!filmstrip) {
        filmstrip = document.createElement('span'); filmstrip.className = 'mx-clip-filmstrip';
        const thumbnail = document.createElement('video'); thumbnail.muted = true; thumbnail.preload = 'none';
        filmstrip.appendChild(thumbnail); clip.prepend(filmstrip);
      }
      const thumbnail = filmstrip.querySelector('video');
      if (thumbnail) {
        const delay = index * 200; // stagger loading by 200ms per video to avoid UI thread block
        const timer = window.setTimeout(() => {
          if (thumbnail.dataset.sourcePath !== scene.path) {
            thumbnail.dataset.sourcePath = scene.path;
            thumbnail.preload = 'metadata';
            thumbnail.src = fileUrl(scene.path);
            thumbnail.addEventListener('loadedmetadata', () => { 
              try { 
                thumbnail.currentTime = Math.min(Number(scene.trimStart || 0) + .25, Math.max(0, thumbnail.duration - .1)); 
              } catch (_) {} 
            }, { once: true });
            thumbnail.load();
          }
        }, delay);
        activeTimers.push(timer);
      }
    });

    return () => activeTimers.forEach(timer => window.clearTimeout(timer));
  }, [scenes]);

  const seekTimeline = value => {
    let target = Math.max(0, Math.min(totalDuration, Number(value) || 0));
    if (snapEnabled) {
      const points = [0, totalDuration]; let offset = 0;
      scenes.forEach(scene => { points.push(offset); offset += Number(scene.duration || 0) / (scene.kind === 'image' ? 1 : Number(scene.speed || 1)); points.push(offset); });
      audioTracks.forEach(track => points.push(Number(track.start) || 0, Number(track.start) + Number(track.duration)));
      captions.forEach(caption => points.push(Number(caption.start) || 0, Number(caption.end) || 0));
      const nearest = points.reduce((best, point) => Math.abs(point - target) < Math.abs(best - target) ? point : best, points[0]);
      if (Math.abs(nearest - target) <= Math.max(.04, .22 / timelineZoom)) target = nearest;
    }
    setPlayheadTime(target);
    let offset = 0;
    const scene = scenes.find(item => {
      const outputDuration = Number(item.duration || 0) / (item.kind === 'image' ? 1 : Number(item.speed || 1));
      if (target <= offset + outputDuration || item === scenes[scenes.length - 1]) return true;
      offset += outputDuration;
      return false;
    });
    if (!scene) return;
    setSelectedId(scene.id);
    if (scene.kind === 'video') {
      const localOutputTime = Math.max(0, target - offset);
      window.setTimeout(() => {
        if (preview.current) preview.current.currentTime = scene.trimStart + localOutputTime * Number(scene.speed || 1);
        if (audioPreview.current && activeTimelineAudio) audioPreview.current.currentTime = Number(activeTimelineAudio.trimStart || 0) + Math.max(0, target - Number(activeTimelineAudio.start || 0));
      }, 0);
    }
  };

  const seekTimelineFromPointer = event => {
    const laneRect = timelineSurface.current?.querySelector('.mx-position-lane')?.getBoundingClientRect();
    if (!laneRect || !totalDuration) return;
    seekTimeline(((event.clientX - laneRect.left) / Math.max(1, laneRect.width)) * totalDuration);
  };

  const beginScissorDrag = event => {
    event.preventDefault(); event.stopPropagation();
    playheadScissorDragRef.current = { active: true, startX: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    seekTimelineFromPointer(event);
  };
  const moveScissorDrag = event => {
    if (!playheadScissorDragRef.current.active) return;
    event.preventDefault(); event.stopPropagation();
    if (Math.abs(event.clientX - playheadScissorDragRef.current.startX) > 3) playheadScissorDragRef.current.moved = true;
    seekTimelineFromPointer(event);
  };
  const endScissorDrag = event => {
    event.preventDefault(); event.stopPropagation();
    playheadScissorDragRef.current.active = false;
  };
  const cutFromScissor = event => {
    event.preventDefault(); event.stopPropagation();
    if (!playheadScissorDragRef.current.moved) razorCut();
    playheadScissorDragRef.current.moved = false;
  };

  const detectStutter = (w1, w2) => {
    const s1 = String(w1 || '').toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
    const s2 = String(w2 || '').toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
    if (!s1 || !s2) return false;
    if (s1 === s2) return true; // duplicates: "like like"
    if (s2.startsWith(s1) && s1.length >= 2 && s2.length > s1.length) {
      return true; // prefix stutter: "supe" -> "super", "li" -> "like", "th" -> "this"
    }
    return false;
  };

  const scanForStutters = () => {
    const list = [];
    const FILLER_WORDS = new Set([
      'uh', 'um', 'ah', 'eh', 'er', 'hmm', 'uh-huh', 'mhm',
      'मतलब', 'यानी', 'अह', 'उम',
      'అంటే'
    ]);

    captions.forEach(caption => {
      const timedWords = (caption.words || []).filter(w => 
        Number.isFinite(Number(w.start)) && 
        Number.isFinite(Number(w.end)) && 
        Number(w.end) > Number(w.start)
      );
      
      const n = timedWords.length;
      const flaggedIndices = new Set();

      // 1. Detect repeated phrases/sentences (multi-word repetitions of length 2 to 10)
      for (let len = Math.min(10, Math.floor(n / 2)); len >= 2; len--) {
        for (let i = 0; i <= n - 2 * len; i++) {
          let alreadyFlagged = false;
          for (let k = 0; k < len; k++) {
            if (flaggedIndices.has(i + k)) {
              alreadyFlagged = true;
              break;
            }
          }
          if (alreadyFlagged) continue;

          const slice1 = timedWords.slice(i, i + len);
          const p1Text = slice1.map(w => String(w.word || w.text || '').toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")).join(' ');

          // Check subsequent window for a match
          for (let j = i + len; j <= Math.min(n - len, i + len + 3); j++) {
            let targetFlagged = false;
            for (let k = 0; k < len; k++) {
              if (flaggedIndices.has(j + k)) {
                targetFlagged = true;
                break;
              }
            }
            if (targetFlagged) continue;

            const slice2 = timedWords.slice(j, j + len);
            const p2Text = slice2.map(w => String(w.word || w.text || '').toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "")).join(' ');

            if (p1Text === p2Text && p1Text.length > 0) {
              list.push({
                id: uid(),
                captionId: caption.id,
                wordIndex: i,
                text: slice1.map(w => w.word || w.text || '').join(' '),
                replacementText: 'REMOVE (Repeated Phrase)',
                start: Number(slice1[0].start),
                end: Number(slice1[slice1.length - 1].end),
                duration: Number(slice1[slice1.length - 1].end) - Number(slice1[0].start),
                type: 'PHRASE'
              });

              for (let k = 0; k < len; k++) {
                flaggedIndices.add(i + k);
              }
              i += len - 1;
              break;
            }
          }
        }
      }

      // 2. Scan single words for fillers and stutters (skipping already flagged phrase segments)
      for (let i = 0; i < timedWords.length; i++) {
        if (flaggedIndices.has(i)) continue;

        const currentWord = timedWords[i];
        const rawText = currentWord.word || currentWord.text || '';
        const wText = String(rawText).toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
        
        // Check for filler/waste words
        if (wText && FILLER_WORDS.has(wText)) {
          list.push({
            id: uid(),
            captionId: caption.id,
            wordIndex: i,
            text: rawText,
            replacementText: 'REMOVE (Filler Word)',
            start: Number(currentWord.start),
            end: Number(currentWord.end),
            duration: Number(currentWord.end) - Number(currentWord.start),
            type: 'FILLER'
          });
          continue;
        }

        // Check for duplicate/prefix stutters (look-ahead)
        if (i < timedWords.length - 1 && !flaggedIndices.has(i + 1)) {
          const nextWord = timedWords[i + 1];
          const w2RawText = nextWord.word || nextWord.text || '';
          const w2Text = String(w2RawText).toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
          if (detectStutter(wText, w2Text)) {
            list.push({
              id: uid(),
              captionId: caption.id,
              wordIndex: i,
              text: rawText,
              replacementText: w2RawText,
              start: Number(currentWord.start),
              end: Number(currentWord.end),
              duration: Number(currentWord.end) - Number(currentWord.start),
              type: 'STUTTER'
            });
          }
        }
      }
    });
    setDetectedStutters(list);
  };

  const applyStutterCuts = (stuttersToCut) => {
    if (!stuttersToCut || !stuttersToCut.length) return;
    
    // Sort stutters in descending order of start time (reverse chronological)
    const sorted = [...stuttersToCut].sort((a, b) => b.start - a.start);
    
    let currentScenes = [...scenes];
    let currentAudioTracks = [...audioTracks];
    let currentCaptions = [...captions];
    
    sorted.forEach(stutter => {
      const start = stutter.start;
      const end = stutter.end;
      const delDur = end - start;
      if (delDur <= 0.001) return;
      
      // 1. Process Video Scenes
      let nextScenes = [];
      let currentOffset = 0;
      for (let i = 0; i < currentScenes.length; i++) {
        const scene = currentScenes[i];
        const speed = scene.kind === 'image' ? 1 : Number(scene.speed || 1);
        const duration = Number(scene.duration || 0) / speed;
        const sceneStart = currentOffset;
        const sceneEnd = currentOffset + duration;
        
        if (sceneEnd <= start) {
          nextScenes.push(scene);
        } else if (sceneStart >= end) {
          nextScenes.push(scene);
        } else {
          if (sceneStart >= start && sceneEnd <= end) {
            // Delete entire scene
          } else if (sceneStart < start && sceneEnd > end) {
            const localStart = start - sceneStart;
            const localEnd = end - sceneStart;
            const sourceStartLocal = localStart * speed;
            const sourceEndLocal = localEnd * speed;
            
            const firstPart = { ...scene, duration: sourceStartLocal };
            const secondPart = { 
              ...scene, 
              id: uid(), 
              name: `${scene.name} (part 2)`, 
              trimStart: Number(scene.trimStart || 0) + sourceEndLocal, 
              duration: Number(scene.duration) - sourceEndLocal 
            };
            nextScenes.push(firstPart, secondPart);
          } else if (sceneEnd > start && sceneEnd <= end) {
            const localStart = start - sceneStart;
            nextScenes.push({ ...scene, duration: localStart * speed });
          } else if (sceneStart >= start && sceneStart < end) {
            const localEnd = end - sceneStart;
            nextScenes.push({
              ...scene,
              trimStart: Number(scene.trimStart || 0) + localEnd * speed,
              duration: Number(scene.duration) - localEnd * speed
            });
          }
        }
        currentOffset += duration;
      }
      currentScenes = nextScenes;

      // 2. Process Audio Tracks
      let nextAudioTracks = [];
      for (let i = 0; i < currentAudioTracks.length; i++) {
        const track = currentAudioTracks[i];
        const trackStart = Number(track.start || 0);
        const duration = Number(track.duration || 0);
        const trackEnd = trackStart + duration;
        const speed = Number(track.speed || 1);
        
        const cropWaveform = (clip, sourceStart, sourceLength) => {
          const peaks = Array.isArray(clip.waveform) ? clip.waveform : [];
          if (!peaks.length) return peaks;
          const sourceDuration = Math.max(.001, Number(clip.sourceDuration || clip.duration));
          const from = Math.max(0, Math.min(peaks.length - 1, Math.floor(sourceStart / sourceDuration * peaks.length)));
          const to = Math.max(from + 1, Math.min(peaks.length, Math.ceil((sourceStart + sourceLength) / sourceDuration * peaks.length)));
          return peaks.slice(from, to);
        };

        if (trackEnd <= start) {
          nextAudioTracks.push(track);
        } else if (trackStart >= end) {
          nextAudioTracks.push({ ...track, start: trackStart - delDur });
        } else {
          if (trackStart >= start && trackEnd <= end) {
            // Delete track
          } else if (trackStart < start && trackEnd > end) {
            const localStart = start - trackStart;
            const localEnd = end - trackStart;
            const first = { 
              ...track, 
              duration: localStart, 
              waveform: cropWaveform(track, Number(track.trimStart || 0), localStart * speed)
            };
            const second = { 
              ...track, 
              id: uid(), 
              name: `${track.name} (part 2)`, 
              start: start, 
              trimStart: Number(track.trimStart) + localEnd * speed, 
              duration: duration - localEnd, 
              waveform: cropWaveform(track, Number(track.trimStart) + localEnd * speed, (duration - localEnd) * speed),
              detachedOffset: Number(track.detachedOffset || 0) + localEnd
            };
            nextAudioTracks.push(first, second);
            loadWaveform(first.id, first.path, first);
            loadWaveform(second.id, second.path, second);
          } else if (trackEnd > start && trackEnd <= end) {
            const localStart = start - trackStart;
            const trimmed = { 
              ...track, 
              duration: localStart, 
              waveform: cropWaveform(track, Number(track.trimStart || 0), localStart * speed) 
            };
            nextAudioTracks.push(trimmed);
            loadWaveform(trimmed.id, trimmed.path, trimmed);
          } else if (trackStart >= start && trackStart < end) {
            const localEnd = end - trackStart;
            const trimmed = { 
              ...track, 
              start: start, 
              trimStart: Number(track.trimStart) + localEnd * speed, 
              duration: duration - localEnd, 
              waveform: cropWaveform(track, Number(track.trimStart) + localEnd * speed, (duration - localEnd) * speed),
              detachedOffset: Number(track.detachedOffset || 0) + localEnd
            };
            nextAudioTracks.push(trimmed);
            loadWaveform(trimmed.id, trimmed.path, trimmed);
          }
        }
      }
      currentAudioTracks = nextAudioTracks;

      // 3. Process Captions
      let nextCaptions = [];
      for (let i = 0; i < currentCaptions.length; i++) {
        const item = currentCaptions[i];
        const capStart = Number(item.start);
        const capEnd = Number(item.end);
        
        if (capEnd <= start) {
          nextCaptions.push(item);
        } else if (capStart >= end) {
          nextCaptions.push({ 
            ...item, 
            start: capStart - delDur, 
            end: capEnd - delDur,
            words: (item.words || []).map(w => ({ ...w, start: Number(w.start) - delDur, end: Number(w.end) - delDur }))
          });
        } else {
          const cleanWords = (item.words || []).filter(w => {
            const wStart = Number(w.start);
            const wEnd = Number(w.end);
            return !(wEnd > start && wStart < end);
          }).map(w => {
            const wStart = Number(w.start);
            const wEnd = Number(w.end);
            if (wStart >= end) {
              return { ...w, start: wStart - delDur, end: wEnd - delDur };
            }
            return w;
          });
          
          if (cleanWords.length > 0) {
            const newText = cleanWords.map(w => String(w.word || w.text || '').trim()).join(' ');
            nextCaptions.push({
              ...item,
              start: Math.max(0, capStart >= start ? start : capStart),
              end: Math.max(0, capEnd >= end ? capEnd - delDur : capStart),
              text: newText,
              words: cleanWords
            });
          }
        }
      }
      currentCaptions = nextCaptions;
    });

    commitTimelineHistory(currentScenes, currentAudioTracks, currentCaptions);
    setScenes(currentScenes);
    setAudioTracks(currentAudioTracks);
    setCaptions(currentCaptions);
    setSelectedId('');
    setSelectedAudioId('');
    setSelectedCaptionId('');
    setWarning('');
    setProgress({ pct: 100, phase: `Successfully cut and removed ${stuttersToCut.length} stutter word${stuttersToCut.length === 1 ? '' : 's'}!` });
  };

  const spokenWordAt = time => {
    const caption = captions.find(item => time >= Number(item.start) && time <= Number(item.end));
    if (!caption) return null;
    const timedWords = (caption.words || []).filter(word => Number.isFinite(Number(word.start)) && Number.isFinite(Number(word.end)) && Number(word.end) > Number(word.start));
    if (timedWords.length) {
      const word = timedWords.find(item => time >= Number(item.start) && time <= Number(item.end)) || timedWords.reduce((nearest, item) => Math.abs(Number(item.start) - time) < Math.abs(Number(nearest.start) - time) ? item : nearest, timedWords[0]);
      return { start: Number(word.start), end: Number(word.end), text: String(word.word || word.text || '').trim() || 'spoken word' };
    }
    const words = String(caption.text || '').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const duration = Math.max(.1, Number(caption.end) - Number(caption.start));
    const index = Math.max(0, Math.min(words.length - 1, Math.floor((time - Number(caption.start)) / duration * words.length)));
    return { start: Number(caption.start) + duration * index / words.length, end: Number(caption.start) + duration * (index + 1) / words.length, text: words[index] };
  };

  const selectAudioAtPointer = (event, track) => {
    if (event.target.closest('.mx-audio-delete, .mx-trim-handle')) return;
    const isAlreadySelected = selectedAudioId === track.id;
    setSelectedAudioId(track.id); setSelectedId(''); setSelectedCaptionId(''); setAllScenesSelected(false);
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const exactTime = Number(track.start || 0) + ratio * Number(track.duration || 0);
    if (isAlreadySelected || audioCutSelectionModeId === track.id) {
      seekTimeline(exactTime);
    }
    if (audioCutSelectionModeId !== track.id) return;
    const current = audioSelectionRef.current;
    if (current?.trackId === track.id && current.awaitingEnd) {
      const selectionStart = Math.min(Number(current.anchor), exactTime);
      const selectionEnd = Math.max(Number(current.anchor), exactTime);
      setAudioSelection({ trackId: track.id, start: selectionStart, end: Math.max(selectionStart + .001, selectionEnd), label: '', awaitingEnd: false, anchor: Number(current.anchor) });
      setAudioCutSelectionModeId('');
      setProgress({ pct: 100, phase: `END set at ${exactTime.toFixed(3)}s. Exact selected length: ${Math.abs(exactTime - Number(current.anchor)).toFixed(3)} seconds.` });
    } else {
      setAudioSelection({ trackId: track.id, start: exactTime, end: exactTime + .001, label: '', awaitingEnd: true, anchor: exactTime });
      setProgress({ pct: 100, phase: `START set at ${exactTime.toFixed(3)}s. Now click the audio again where you want END.` });
    }
  };

  const beginCutPositionSelection = trackId => {
    setSelectedAudioId(trackId); setSelectedId(''); setSelectedCaptionId('');
    setAudioSelection(null); setAudioCutSelectionModeId(trackId);
    setProgress({ pct: 100, phase: 'Cut selection enabled. Click once for START, then click once for END.' });
  };

  const setAudioSelectionEdge = edge => {
    if (!selectedAudio) return;
    const clipStart = Number(selectedAudio.start);
    const clipEnd = clipStart + Number(selectedAudio.duration);
    const point = Math.max(clipStart, Math.min(clipEnd, playheadTime));
    setAudioSelection(current => {
      const base = current?.trackId === selectedAudio.id ? current : { trackId: selectedAudio.id, start: clipStart, end: clipEnd };
      return edge === 'start' ? { ...base, start: Math.min(point, base.end - .001) } : { ...base, end: Math.max(point, base.start + .001) };
    });
  };

  const beginAudioSelectionHandle = (event, track, edge) => {
    event.preventDefault(); event.stopPropagation();
    const clipRect = event.currentTarget.closest('.mx-audio-clip')?.getBoundingClientRect();
    if (!clipRect) return;
    const move = pointerEvent => {
      const ratio = Math.max(0, Math.min(1, (pointerEvent.clientX - clipRect.left) / Math.max(1, clipRect.width)));
      const point = Number(track.start) + ratio * Number(track.duration);
      setAudioSelection(current => {
        if (!current || current.trackId !== track.id) return current;
        return edge === 'start' ? { ...current, start: Math.min(point, current.end - .05), label: '' } : { ...current, end: Math.max(point, current.start + .05), label: '' };
      });
      seekTimeline(point);
      setSelectedAudioId(track.id);
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const previewAudioSelection = () => {
    if (!selectedAudio || audioSelection?.trackId !== selectedAudio.id || !audioSelectionPreview.current) return;
    const sourceStart = Number(selectedAudio.trimStart || 0) + (audioSelection.start - Number(selectedAudio.start)) * Number(selectedAudio.speed || 1);
    audioSelectionPreview.current.currentTime = Math.max(0, sourceStart);
    audioSelectionPreview.current.play().catch(error => setWarning(`Selected audio preview could not play: ${error.message}`));
  };

  const removeHighlightedAudio = () => {
    if (!selectedAudio || audioSelection?.trackId !== selectedAudio.id) { setWarning('Click the detached audio waveform first to highlight the part you want to remove.'); return; }
    const trackStart = Number(selectedAudio.start);
    const trackEnd = trackStart + Number(selectedAudio.duration);
    const cutStart = Math.max(trackStart, Math.min(trackEnd, Number(audioSelection.start)));
    const cutEnd = Math.max(cutStart, Math.min(trackEnd, Number(audioSelection.end)));
    if (cutEnd - cutStart < .001) { setWarning('The highlighted audio is shorter than one millisecond. Select a slightly larger part.'); return; }
    const beforeDuration = cutStart - trackStart;
    const afterDuration = trackEnd - cutEnd;
    const speed = Number(selectedAudio.speed || 1);
    const sourceDuration = Math.max(.001, Number(selectedAudio.sourceDuration || selectedAudio.duration));
    const cropWaveform = (sourceStart, sourceLength) => {
      const peaks = Array.isArray(selectedAudio.waveform) ? selectedAudio.waveform : [];
      if (!peaks.length) return peaks;
      const from = Math.max(0, Math.min(peaks.length - 1, Math.floor(sourceStart / sourceDuration * peaks.length)));
      const to = Math.max(from + 1, Math.min(peaks.length, Math.ceil((sourceStart + sourceLength) / sourceDuration * peaks.length)));
      return peaks.slice(from, to);
    };
    const pieces = [];
    if (beforeDuration >= .001) pieces.push({ ...selectedAudio, duration: beforeDuration, waveform: cropWaveform(Number(selectedAudio.trimStart || 0), beforeDuration * speed), name: `${selectedAudio.name} (before cut)`, detachedFromSceneId: '', reattachedToSceneId: '' });
    if (afterDuration >= .001) pieces.push({ ...selectedAudio, id: uid(), start: cutStart, trimStart: Number(selectedAudio.trimStart || 0) + (cutEnd - trackStart) * speed, duration: afterDuration, waveform: cropWaveform(Number(selectedAudio.trimStart || 0) + (cutEnd - trackStart) * speed, afterDuration * speed), detachedOffset: Number(selectedAudio.detachedOffset || 0) + (cutEnd - trackStart), timelineOffsetWithinScene: Number(selectedAudio.timelineOffsetWithinScene || 0) + beforeDuration, detachedFromSceneId: '', reattachedToSceneId: '', name: `${selectedAudio.name} (after cut)` });
    const nextTracks = audioTracks.flatMap(track => track.id === selectedAudio.id ? pieces : [track]);
    setAudioTracks(nextTracks);
    pieces.forEach(piece => loadWaveform(piece.id, piece.path, piece));
    setSelectedAudioId(pieces[0]?.id || '');
    setAudioSelection(null);
    setAudioCutSelectionModeId('');
    audioSelectionPreview.current?.pause();
    setWarning('');
    setProgress({ pct: 100, phase: `${(cutEnd - cutStart).toFixed(3)} seconds removed. The following audio moved left automatically, so no empty space remains.` });
    commitTimelineHistory(scenes, nextTracks, captions);
  };

  const reattachSelectedAudio = () => {
    if (!selectedAudio) return;
    const sceneId = selectedAudio.originSceneId || selectedAudio.detachedFromSceneId || selectedAudio.reattachedToSceneId || scenes.find(scene => scene.path === selectedAudio.path)?.id;
    const scene = scenes.find(item => item.id === sceneId);
    if (!scene) { setWarning('The source video for this detached audio could not be found. Keep the audio on its current synchronized track.'); return; }
    const related = audioTracks.filter(track => (track.originSceneId || track.detachedFromSceneId || track.reattachedToSceneId) === sceneId || (track.path === scene.path && Number(track.start) >= sceneTimelineOffset(sceneId) - .05));
    const originalStart = sceneTimelineOffset(sceneId);
    const originalDuration = Number(scene.duration || 0) / Math.max(.5, Number(scene.speed || 1));
    const untouched = related.length === 1 && Math.abs(Number(related[0].start) - originalStart) < .05 && Math.abs(Number(related[0].duration) - originalDuration) < .05 && Math.abs(Number(related[0].trimStart) - Number(scene.trimStart || 0)) < .05;
    let nextTracks = [];
    let nextScenes = [];
    if (untouched) {
      nextTracks = audioTracks.filter(track => track.id !== related[0].id);
      nextScenes = scenes.map(item => item.id === sceneId ? { ...item, muted: false } : item);
      setAudioTracks(nextTracks);
      setScenes(nextScenes);
      setSelectedAudioId(''); setSelectedId(sceneId); setAudioSelection(null);
      setProgress({ pct: 100, phase: 'Original audio reattached inside the video successfully.' });
    } else {
      nextTracks = audioTracks.map(track => related.some(item => item.id === track.id) ? { ...track, originSceneId: sceneId, detachedFromSceneId: '', reattachedToSceneId: sceneId, name: track.name.replace(/ — detached audio| \(before cut\)| \(after cut\)| — reattached edited audio/g, '') + ' — reattached edited audio' } : track);
      nextScenes = scenes.map(item => item.id === sceneId ? { ...item, muted: true } : item);
      setAudioTracks(nextTracks);
      setScenes(nextScenes);
      setProgress({ pct: 100, phase: 'Edited audio reattached to its video for synchronized preview and export. Every cut has been preserved.' });
      setWarning('');
    }
    commitTimelineHistory(nextScenes, nextTracks, captions);
  };

  const showRealCaption = () => {
    const valid = captions.filter(item => String(item.text || '').trim() && Number(item.end) > Number(item.start)).sort((a, b) => a.start - b.start);
    if (!valid.length) { setWarning('No generated captions are available. Generate captions first.'); return; }
    const caption = valid.find(item => Number(item.end) >= playheadTime + .05) || valid[0];
    setTrackStates(value => ({ ...value, captionsMuted: false }));
    setCaptionSampleVisible(false);
    seekTimeline(Number(caption.start) + .02);
    setSelectedCaptionId(caption.id); setSelectedAudioId('');
    setProgress({ pct: 100, phase: `Showing real caption: ${caption.text}` });
  };

  const beginAudioTrim = (event, track, edge) => {
    event.preventDefault();
    event.stopPropagation();
    if (trackStates.audioLocked) return;
    const laneWidth = event.currentTarget.closest('.mx-position-lane')?.getBoundingClientRect().width || 1;
    const originX = event.clientX;
    const origin = { start: Number(track.start) || 0, trimStart: Number(track.trimStart) || 0, duration: Number(track.duration) || .1, detachedOffset: Number(track.detachedOffset) || 0 };
    const originSceneId = track.originSceneId || track.detachedFromSceneId || track.reattachedToSceneId;
    const linkedRightIds = new Set(audioTracks.filter(item => {
      const itemSceneId = item.originSceneId || item.detachedFromSceneId || item.reattachedToSceneId;
      return item.id !== track.id && itemSceneId === originSceneId && Math.abs(Number(item.start || 0) - (origin.start + origin.duration)) <= .03;
    }).map(item => item.id));
    const move = moveEvent => {
      const delta = ((moveEvent.clientX - originX) / laneWidth) * totalDuration;
      if (edge === 'left') {
        const availableEarlierAudio = Math.min(origin.trimStart / Number(track.speed || 1), origin.detachedOffset);
        if (delta < 0 && availableEarlierAudio <= .001) {
          const scene = scenes.find(item => item.id === originSceneId);
          const sceneStart = scene ? sceneTimelineOffset(scene.id) : 0;
          const start = Math.max(sceneStart, origin.start + delta);
          patchAudioTrack(track.id, { start, timelineOffsetWithinScene: Math.max(0, start - sceneStart) });
          setPlayheadTime(start);
        } else {
          const cut = Math.max(-availableEarlierAudio, Math.min(origin.duration - .1, delta));
          patchAudioTrack(track.id, { start: origin.start + cut, trimStart: origin.trimStart + cut * Number(track.speed || 1), duration: origin.duration - cut, detachedOffset: origin.detachedOffset + cut, timelineOffsetWithinScene: Math.max(0, Number(track.timelineOffsetWithinScene || 0) + cut) });
        }
      } else {
        const maxDuration = Math.max(.1, ((Number(track.sourceDuration) || 999999) - origin.trimStart) / Number(track.speed || 1));
        const duration = Math.max(.1, Math.min(maxDuration, origin.duration + delta));
        const oldEnd = origin.start + origin.duration;
        const newEnd = origin.start + duration;
        setAudioTracks(current => current.map(item => {
          if (item.id === track.id) return { ...item, duration };
          if (!linkedRightIds.has(item.id)) return item;
          return { ...item, start: newEnd, timelineOffsetWithinScene: Math.max(0, Number(item.timelineOffsetWithinScene || 0) + (newEnd - oldEnd)) };
        }));
      }
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };

  const beginAudioMove = (event, track) => {
    if (event.button !== 0 || trackStates.audioLocked || event.target.closest('.mx-trim-handle,.mx-audio-selection,button')) return;
    event.preventDefault(); event.stopPropagation();
    const lane = event.currentTarget.closest('.mx-position-lane');
    const laneWidth = lane?.getBoundingClientRect().width || 1;
    const originX = event.clientX;
    const originStart = Number(track.start || 0);
    
    let moved = false;
    let finalAudioTracks = audioTracks;
    
    setSelectedAudioId(track.id); setSelectedId(''); setSelectedCaptionId('');
    
    const move = pointerEvent => {
      const delta = (pointerEvent.clientX - originX) / laneWidth * totalDuration;
      if (Math.abs(pointerEvent.clientX - originX) > 3) moved = true;
      
      let start = Math.max(0, originStart + delta);
      
      // Snapping logic if enabled
      if (snapEnabled) {
        let bestSnap = null;
        let bestDist = 0.15; // 0.15s tolerance
        
        // 1. Snap to playhead
        if (Math.abs(start - playheadTime) < bestDist) {
          bestSnap = playheadTime;
          bestDist = Math.abs(start - playheadTime);
        }
        if (Math.abs((start + Number(track.duration)) - playheadTime) < bestDist) {
          bestSnap = playheadTime - Number(track.duration);
          bestDist = Math.abs((start + Number(track.duration)) - playheadTime);
        }

        // 2. Snap to scenes boundaries
        let offset = 0;
        for (const s of scenes) {
          const sDur = Number(s.duration || 0) / (s.kind === 'image' ? 1 : Number(s.speed || 1));
          if (Math.abs(start - offset) < bestDist) {
            bestSnap = offset;
            bestDist = Math.abs(start - offset);
          }
          if (Math.abs((start + Number(track.duration)) - offset) < bestDist) {
            bestSnap = offset - Number(track.duration);
            bestDist = Math.abs((start + Number(track.duration)) - offset);
          }
          offset += sDur;
        }
        // snap to end of timeline too
        if (Math.abs(start - offset) < bestDist) {
          bestSnap = offset;
          bestDist = Math.abs(start - offset);
        }
        if (Math.abs((start + Number(track.duration)) - offset) < bestDist) {
          bestSnap = offset - Number(track.duration);
          bestDist = Math.abs((start + Number(track.duration)) - offset);
        }

        // 3. Snap to other audio tracks
        for (const other of audioTracks) {
          if (other.id === track.id) continue;
          const otherStart = Number(other.start || 0);
          const otherEnd = otherStart + Number(other.duration || 0);
          if (Math.abs(start - otherEnd) < bestDist) {
            bestSnap = otherEnd;
            bestDist = Math.abs(start - otherEnd);
          }
          if (Math.abs((start + Number(track.duration)) - otherStart) < bestDist) {
            bestSnap = otherStart - Number(track.duration);
            bestDist = Math.abs((start + Number(track.duration)) - otherStart);
          }
        }

        if (bestSnap !== null) {
          start = Math.max(0, bestSnap);
        }
      }

      setAudioTracks(current => {
        finalAudioTracks = current.map(item => {
          if (item.id === track.id) {
            return { 
              ...item, 
              start, 
              detachedFromSceneId: '', 
              reattachedToSceneId: ''
            };
          }
          return item;
        });
        return finalAudioTracks;
      });
      
      setPlayheadTime(start);
    };
    
    const stop = () => {
      audioDragRef.current = moved;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.setTimeout(() => { audioDragRef.current = false; }, 0);
      commitTimelineHistory(scenes, finalAudioTracks, captions);
    };
    
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };

  useEffect(() => {
    const clips = [...document.querySelectorAll('.mx-track-row .mx-audio-clip')];
    const listeners = clips.map((clip, index) => {
      const track = audioTracks[index];
      if (!track) return null;
      const listener = event => beginAudioMove(event, track);
      clip.addEventListener('pointerdown', listener);
      return { clip, listener };
    }).filter(Boolean);
    return () => listeners.forEach(({ clip, listener }) => clip.removeEventListener('pointerdown', listener));
  }, [audioTracks, scenes, totalDuration, trackStates.audioLocked]);

  const togglePreviewPlayback = () => {
    if (!preview.current || selected?.kind !== 'video') return;
    if (preview.current.paused) {
      if (playbackMode === 'continuous' && !playAllSessionRef.current && scenes.length) {
        const ordered = serialSort(scenes);
        const first = ordered[0];
        playAllSessionRef.current = true;
        setScenes(ordered);
        setPlayheadTime(0);
        if (selected.id !== first.id) {
          autoplayNextRef.current = true;
          setSelectedId(first.id); setSelectedAudioId(''); setSelectedCaptionId('');
          setProgress({ pct: 100, phase: `Serial playback started · scene 1 of ${ordered.length}: ${first.name}` });
          return;
        }
        preview.current.currentTime = Number(first.trimStart || 0);
      }
      advancingSceneRef.current = false;
      preview.current.play();
      if (audioPreview.current && activeTimelineAudio) audioPreview.current.play().catch(() => {});
    } else {
      preview.current.pause();
      audioPreview.current?.pause();
    }
  };

  const finishCurrentScene = () => {
    if (advancingSceneRef.current) return;
    advancingSceneRef.current = true;
    audioPreview.current?.pause();
    const index = scenes.findIndex(scene => scene.id === selected?.id);
    const next = playbackMode === 'continuous' && index >= 0 ? scenes[index + 1] : null;
    if (next) {
      autoplayNextRef.current = true;
      if (next.fit !== (settings.framing || 'contain')) patchScene(next.id, { fit: settings.framing || 'contain' });
      setSelectedId(next.id); setSelectedAudioId(''); setSelectedCaptionId('');
      setPlayheadTime(sceneTimelineOffset(next.id));
      setProgress({ pct: 100, phase: `Playing scene ${index + 2} of ${scenes.length}: ${next.name}` });
    } else {
      autoplayNextRef.current = false;
      playAllSessionRef.current = false;
      setIsPreviewPlaying(false);
      setProgress({ pct: 100, phase: playbackMode === 'scene' ? 'Current scene finished.' : 'All serial timeline scenes finished.' });
      window.setTimeout(() => { advancingSceneRef.current = false; }, 50);
    }
  };

  useEffect(() => {
    if (!autoplayNextRef.current || !selected) return undefined;
    advancingSceneRef.current = false;
    if (selected.kind === 'video') {
      const timer = window.setTimeout(() => preview.current?.play().catch(error => setWarning(`Could not continue playback: ${error.message}`)), 80);
      return () => window.clearTimeout(timer);
    }
    setIsPreviewPlaying(true);
    const timer = window.setTimeout(finishCurrentScene, Math.max(.1, Number(selected.duration) || 3) * 1000);
    return () => window.clearTimeout(timer);
  }, [selected?.id, playbackMode]);

  const placeMediaOnTimeline = asset => {
    if (trackStates.videoLocked) { setWarning('Video track is locked. Unlock it before placing media.'); return; }
    const placed = { ...asset, id: uid(), libraryId: asset.id, probeError: '' };
    setScenes(current => serialSort([...current, placed]));
    setSelectedId(placed.id); setSelectedAudioId(''); setSelectedCaptionId(''); setCaptions([]); setWarning('');
    setProgress({ pct: 100, phase: `${asset.name} added as one complete scene. Timeline kept in serial order; no existing scene was divided.` });
  };

  const activateLibraryAsset = asset => {
    const existing = scenes.find(scene => scene.libraryId === asset.id);
    if (existing) {
      setSelectedId(existing.id); setSelectedAudioId(''); setSelectedCaptionId(''); setPlayheadTime(sceneTimelineOffset(existing.id));
      setProgress({ pct: 100, phase: `${asset.name} selected on the timeline.` });
    } else placeMediaOnTimeline(asset);
  };

  const razorCut = () => {
    let nextScenes = [...scenes];
    let scenesChanged = false;
    let newSelectedId = '';

    let nextAudioTracks = [...audioTracks];
    let audioTracksChanged = false;
    let newSelectedAudioId = '';

    let nextCaptions = [...captions];
    let captionsChanged = false;
    let newSelectedCaptionId = '';

    // Determine target category based on selection to split only the active track (Filmora style)
    const isAudioSelected = Boolean(selectedAudioId);
    const isCaptionSelected = Boolean(selectedCaptionId);
    const isVideoSelected = Boolean(selectedId) && !isAudioSelected && !isCaptionSelected;

    // 1. Split video scene
    if (isVideoSelected || (!isAudioSelected && !isCaptionSelected)) {
      let currentOffset = 0;
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        if (isVideoSelected && scene.id !== selectedId) {
          currentOffset += Number(scene.duration || 0) / (scene.kind === 'image' ? 1 : Number(scene.speed || 1));
          continue;
        }
        const speed = scene.kind === 'image' ? 1 : Number(scene.speed || 1);
        const duration = Number(scene.duration || 0) / speed;
        if (playheadTime > currentOffset + 0.25 && playheadTime < currentOffset + duration - 0.25) {
          const local = playheadTime - currentOffset;
          const sourceLocal = local * speed;
          const absolute = Number(scene.trimStart || 0) + sourceLocal;
          const first = { ...scene, duration: sourceLocal };
          const second = { ...scene, id: uid(), name: `${scene.name} (part 2)`, trimStart: absolute, duration: Number(scene.duration) - sourceLocal };
          nextScenes = scenes.flatMap(s => s.id === scene.id ? [first, second] : [s]);
          newSelectedId = second.id;
          scenesChanged = true;
          break;
        }
        currentOffset += duration;
      }
    }

    // 2. Split audio tracks
    if (isAudioSelected || (!isVideoSelected && !isCaptionSelected)) {
      const cropWaveform = (clip, sourceStart, sourceLength) => {
        const peaks = Array.isArray(clip.waveform) ? clip.waveform : [];
        if (!peaks.length) return peaks;
        const sourceDuration = Math.max(.001, Number(clip.sourceDuration || clip.duration));
        const from = Math.max(0, Math.min(peaks.length - 1, Math.floor(sourceStart / sourceDuration * peaks.length)));
        const to = Math.max(from + 1, Math.min(peaks.length, Math.ceil((sourceStart + sourceLength) / sourceDuration * peaks.length)));
        return peaks.slice(from, to);
      };

      for (let i = 0; i < nextAudioTracks.length; i++) {
        const track = nextAudioTracks[i];
        if (isAudioSelected && track.id !== selectedAudioId) continue;
        const start = Number(track.start || 0);
        const duration = Number(track.duration || 0);
        if (playheadTime > start + 0.05 && playheadTime < start + duration - 0.05) {
          const local = playheadTime - start;
          const speed = Number(track.speed || 1);
          const first = { 
            ...track, 
            duration: local, 
            waveform: cropWaveform(track, Number(track.trimStart || 0), local * speed),
            detachedFromSceneId: '', 
            reattachedToSceneId: '' 
          };
          const second = { 
            ...track, 
            id: uid(), 
            name: `${track.name} (part 2)`, 
            start: playheadTime, 
            trimStart: Number(track.trimStart) + local * speed, 
            duration: duration - local, 
            waveform: cropWaveform(track, Number(track.trimStart) + local * speed, (duration - local) * speed),
            detachedOffset: Number(track.detachedOffset || 0) + local, 
            detachedFromSceneId: '', 
            reattachedToSceneId: '' 
          };
          
          nextAudioTracks = nextAudioTracks.flatMap(t => t.id === track.id ? [first, second] : [t]);
          newSelectedAudioId = second.id;
          audioTracksChanged = true;
          
          // Load updated waveforms
          loadWaveform(first.id, first.path, first);
          loadWaveform(second.id, second.path, second);
        }
      }
    }

    // 3. Split captions
    if (isCaptionSelected || (!isVideoSelected && !isAudioSelected)) {
      for (let i = 0; i < nextCaptions.length; i++) {
        const item = nextCaptions[i];
        if (isCaptionSelected && item.id !== selectedCaptionId) continue;
        const start = Number(item.start);
        const end = Number(item.end);
        if (playheadTime > start + 0.05 && playheadTime < end - 0.05) {
          const words = String(item.text).split(/\s+/);
          const pivot = Math.max(1, Math.round(words.length * ((playheadTime - start) / (end - start))));
          const first = { ...item, end: playheadTime, text: words.slice(0, pivot).join(' ') };
          const second = { ...item, id: uid(), start: playheadTime, text: words.slice(pivot).join(' ') || words.slice(-1).join(' ') };
          
          nextCaptions = nextCaptions.flatMap(c => c.id === item.id ? [first, second] : [c]);
          newSelectedCaptionId = second.id;
          captionsChanged = true;
        }
      }
    }

    if (!scenesChanged && !audioTracksChanged && !captionsChanged) {
      setWarning(isAudioSelected ? 'Move the gold playhead inside the selected audio to cut it.' : 'Move the gold playhead inside the selected video or audio to cut.');
      return;
    }

    commitTimelineHistory(nextScenes, nextAudioTracks, nextCaptions);

    if (scenesChanged) {
      setScenes(nextScenes);
      setSelectedId(newSelectedId);
      setSelectedIds([newSelectedId]);
    }
    if (audioTracksChanged) {
      setAudioTracks(nextAudioTracks);
      setSelectedAudioId(newSelectedAudioId);
    }
    if (captionsChanged) {
      setCaptions(nextCaptions);
      setSelectedCaptionId(newSelectedCaptionId);
    }

    setWarning('');
    setProgress({ pct: 100, phase: 'Timeline cut successfully at the playhead position.' });
  };

  const translateTextLocal = async (text, target) => {
    if (!String(text || '').trim() || target === 'auto') return String(text || '').trim();
    const response = await fetch('http://127.0.0.1:8434/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, target, source: 'auto' }) });
    if (!response.ok) throw new Error(`Translation server returned ${response.status}.`);
    const data = await response.json();
    const translated = String(data?.translated || data?.translatedText || data?.translation || data?.text || '').trim();
    if (!translated) throw new Error('Translation returned empty text.');
    return translated;
  };

  const changeSelectedVideoVoice = async () => {
    if (!selected || selected.kind !== 'video') { setWarning('Select the video whose spoken voice you want to translate.'); return; }
    if (!VOICE_MODELS[voiceLanguage]) { setWarning('Choose a voice language first.'); return; }
    if (typeof window.electronAPI?.transcribeVideo !== 'function' || typeof window.electronAPI?.exportSyncedTranslatedVideo !== 'function') { setWarning('The synchronized voice service is unavailable. Restart the app and try again.'); return; }
    setVoiceChanging(true); setWarning('');
    try {
      setProgress({ pct: 8, phase: `Listening to ${selected.name} and detecting its current language` });
      const transcribed = await window.electronAPI.transcribeVideo({ videoPath: selected.path, languageHint: 'auto' });
      if (!transcribed?.ok) throw new Error(transcribed?.error || 'The video speech could not be transcribed.');
      const sourceSegments = (Array.isArray(transcribed.segments) ? transcribed.segments : []).filter(segment => String(segment?.text || '').trim() && Number(segment.end) > Number(segment.start));
      if (!sourceSegments.length) throw new Error('No timestamped speech was detected in this video.');
      const translatedSegments = [];
      for (let index = 0; index < sourceSegments.length; index += 1) {
        const segment = sourceSegments[index];
        setProgress({ pct: Math.round(20 + index / sourceSegments.length * 40), phase: `Translating speech to ${CAPTION_LANGUAGE_NAMES[voiceLanguage]} · ${index + 1}/${sourceSegments.length}` });
        translatedSegments.push({ ...segment, translatedText: await translateTextLocal(segment.text, voiceLanguage) });
      }
      setProgress({ pct: 65, phase: `Generating synchronized ${CAPTION_LANGUAGE_NAMES[voiceLanguage]} voice` });
      const response = await window.electronAPI.exportSyncedTranslatedVideo({ videoPath: selected.path, segments: translatedSegments, voice: VOICE_MODELS[voiceLanguage], targetLanguage: voiceLanguage, outputName: `${selected.name.replace(/\.[^.]+$/, '')}-${voiceLanguage}-synced.mp4` });
      if (!response?.ok || !response.outputPath) throw new Error(response?.error || 'Synchronized translated video was not created.');
      patchScene(selected.id, { path: response.outputPath, name: `${selected.name.replace(/\s*\[[^\]]+ voice\]$/i, '')} [${CAPTION_LANGUAGE_NAMES[voiceLanguage]} voice]`, hasAudio: true, muted: false, voiceLanguage });
      setAudioTracks(current => current.filter(track => track.detachedFromSceneId !== selected.id));
      setCaptions([]);
      setProgress({ pct: 100, phase: `${CAPTION_LANGUAGE_NAMES[voiceLanguage]} voice synchronized and replaced successfully. Now create captions in any language below.` });
    } catch (error) {
      setWarning(`Voice translation failed: ${error.message}\nCheck the transcription server (8428), voice server (8427), and translation server (8434).`);
      setProgress({ pct: 0, phase: 'Voice translation stopped safely; the original video was not changed.' });
    } finally { setVoiceChanging(false); }
  };

  const removeScene = (id, forceRipple = false) => {
    const target = scenes.find(scene => scene.id === id);
    if (!target || !window.confirm(`Delete “${target.name}” from the timeline?`)) return;
    const offset = sceneTimelineOffset(id);
    const removed = scenes.find(scene => scene.id === id);
    const removedDuration = removed ? Number(removed.duration || 0) / (removed.kind === 'image' ? 1 : Number(removed.speed || 1)) : 0;
    setScenes(current => current.filter(scene => scene.id !== id));
    const shouldRipple = forceRipple || rippleEnabled;
    setAudioTracks(current => current.filter(track => track.detachedFromSceneId !== id).map(track => shouldRipple && Number(track.start) >= offset + removedDuration - .01 ? { ...track, start: Math.max(0, Number(track.start) - removedDuration) } : track));
    if (shouldRipple) setCaptions(current => current.filter(item => item.end <= offset || item.start >= offset + removedDuration).map(item => item.start >= offset + removedDuration ? { ...item, start: item.start - removedDuration, end: item.end - removedDuration } : item));
    if (selectedId === id) setSelectedId('');
    if (!shouldRipple) setCaptions([]);
  };

  const removeSelectedScenes = () => {
    if (selectedIds.length === 0) return;
    if (selectedIds.length === 1) {
      removeScene(selectedIds[0]);
      return;
    }
    if (!window.confirm(`Delete all ${selectedIds.length} selected scenes from the timeline?`)) return;
    const idsToRemove = new Set(selectedIds);
    setScenes(current => current.filter(scene => !idsToRemove.has(scene.id)));
    setAudioTracks(current => current.filter(track => !track.detachedFromSceneId || !idsToRemove.has(track.detachedFromSceneId)));
    setCaptions([]);
    setSelectedIds([]);
    setSelectedId('');
  };

  const removeAudioTrack = (id, forceRipple = false) => {
    const target = audioTracks.find(track => track.id === id);
    if (!target) return;
    const offset = Number(target.start || 0);
    const duration = Number(target.duration || 0);
    const shouldRipple = forceRipple || rippleEnabled;
    
    let nextTracks = audioTracks.filter(track => track.id !== id);
    if (shouldRipple) {
      nextTracks = nextTracks.map(track => {
        if (Number(track.start) >= offset + duration - 0.05) {
          return { ...track, start: Math.max(0, Number(track.start) - duration) };
        }
        return track;
      });
    }
    
    setAudioTracks(nextTracks);
    if (selectedAudioId === id) setSelectedAudioId('');
    setProgress({ pct: 100, phase: `${target.name} deleted.${shouldRipple ? ' Subsequent audio tracks shifted left.' : ''}` });
    commitTimelineHistory(scenes, nextTracks, captions);
  };

  const mergeSelectedWithNext = () => {
    if (!selected) return;
    const index = scenes.findIndex(scene => scene.id === selected.id);
    const nextScene = scenes[index + 1];
    if (!nextScene) { setWarning('Select a scene that has another scene after it.'); return; }
    if (selected.path === nextScene.path && selected.kind === nextScene.kind && Number(selected.trimStart) + Number(selected.duration) === Number(nextScene.trimStart) && Number(selected.speed || 1) === Number(nextScene.speed || 1)) {
      patchScene(selected.id, { duration: Number(selected.duration) + Number(nextScene.duration), name: `${selected.name} — merged` });
      setScenes(current => current.filter(scene => scene.id !== nextScene.id));
    } else {
      const group = selected.mergeGroup || uid();
      setScenes(current => current.map(scene => scene.id === selected.id || scene.id === nextScene.id ? { ...scene, mergeGroup: group } : scene));
    }
    setCaptions([]); setWarning(''); setProgress({ pct: 100, phase: 'Selected scene merged with the next scene for continuous export.' });
  };

  const duplicateScene = () => {
    if (!selected) return;
    const copy = { ...selected, id: uid(), name: `${selected.name} (copy)` };
    setScenes(current => {
      const index = current.findIndex(scene => scene.id === selected.id);
      const next = [...current];
      next.splice(index + 1, 0, copy);
      return next;
    });
    setSelectedId(copy.id);
  };

  const copyScene = () => {
    if (!selected) return;
    setSceneClipboard({ ...selected });
    setProgress({ pct: 100, phase: `${selected.name} copied. Select another scene and choose Paste Scene.` });
  };

  const pasteScene = () => {
    if (!sceneClipboard) return;
    const copy = { ...sceneClipboard, id: uid(), name: `${sceneClipboard.name.replace(/ \(copy\)$/i, '')} (copy)` };
    setScenes(current => { const index = Math.max(-1, current.findIndex(scene => scene.id === selected?.id)); const next = [...current]; next.splice(index + 1, 0, copy); return next; });
    setSelectedId(copy.id); setSelectedAudioId(''); setSelectedCaptionId(''); setProgress({ pct: 100, phase: `${copy.name} pasted after the selected scene.` });
  };

  const trimSceneToPlayhead = edge => {
    if (!selected || selected.kind !== 'video') return;
    const sceneStart = sceneTimelineOffset(selected.id);
    const localOutput = Math.max(0, Math.min(Number(selected.duration) / Number(selected.speed || 1), playheadTime - sceneStart));
    const localSource = localOutput * Number(selected.speed || 1);
    if (edge === 'start') patchScene(selected.id, { trimStart: Number(selected.trimStart || 0) + localSource, duration: Math.max(.1, Number(selected.duration) - localSource) });
    else patchScene(selected.id, { duration: Math.max(.1, localSource) });
    setCaptions([]); setProgress({ pct: 100, phase: `${edge === 'start' ? 'Start' : 'End'} trimmed precisely to the gold playhead.` });
  };

  const renameSelectedScene = () => {
    if (!selected) return;
    const name = window.prompt('Rename selected clip:', selected.name);
    if (name?.trim()) patchScene(selected.id, { name: name.trim() });
  };

  const replaceSelectedScene = async () => {
    if (!selected) return;
    try {
      const result = await window.electronAPI?.myExporterPickMedia?.();
      const filePath = result?.filePaths?.[0]; if (!result?.ok || result.canceled || !filePath) return;
      const probe = await window.electronAPI?.myExporterProbe?.({ filePath });
      if (!probe?.ok) throw new Error(probe?.error || 'Replacement media could not be read.');
      patchScene(selected.id, { path: filePath, name: filePath.split(/[\\/]/).pop(), kind: 'video', sourceDuration: probe.duration, duration: probe.duration, trimStart: 0, width: probe.width, height: probe.height, hasAudio: probe.hasAudio, muted: false });
      setCaptions([]); setProgress({ pct: 100, phase: 'Clip replaced successfully while keeping its timeline position.' });
    } catch (error) { setWarning(`Replace clip failed: ${error.message}`); }
  };

  const locateSelectedSource = () => {
    if (!selected) return;
    const card = [...document.querySelectorAll('.mx-media-card')].find(item => item.textContent.includes(selected.name));
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (card) card.animate([{ outline: '2px solid #e0bd6c' }, { outline: '2px solid transparent' }], { duration: 1800 });
    else setWarning('This source is on the timeline but is no longer listed in the media library.');
  };

  const copySelectedAudio = () => {
    if (!selectedAudio) return;
    setAudioClipboard({ ...selectedAudio });
    setProgress({ pct: 100, phase: `${selectedAudio.name} copied. Move the gold playhead and press Paste Audio.` });
  };

  const pasteCopiedAudio = () => {
    if (!audioClipboard) { setWarning('Copy a detached audio clip first, then place the gold playhead where you want to paste it.'); return; }
    const targetScene = scenes.find((scene, index) => {
      const start = sceneTimelineOffset(scene.id);
      const duration = Number(scene.duration || 0) / (scene.kind === 'image' ? 1 : Math.max(.5, Number(scene.speed || 1)));
      return playheadTime >= start - .001 && (playheadTime < start + duration - .001 || index === scenes.length - 1);
    }) || scenes[scenes.length - 1];
    const sceneStart = targetScene ? sceneTimelineOffset(targetScene.id) : 0;
    const targetDuration = targetScene ? Number(targetScene.duration || 0) / (targetScene.kind === 'image' ? 1 : Math.max(.5, Number(targetScene.speed || 1))) : Number(audioClipboard.duration || .1);
    const sceneEnd = sceneStart + targetDuration;
    const targetStart = Math.max(sceneStart, Math.min(sceneEnd - .001, Number(playheadTime || 0)));
    const availableDuration = Math.max(.001, sceneEnd - targetStart);
    const copy = {
      ...audioClipboard,
      id: uid(),
      name: `${audioClipboard.name.replace(/ \(copy\)$/i, '')} (copy)`,
      start: targetStart,
      duration: Math.min(Number(audioClipboard.duration || .1), availableDuration),
      originSceneId: targetScene?.id || '',
      detachedFromSceneId: '',
      reattachedToSceneId: '',
      timelineOffsetWithinScene: targetStart - sceneStart,
      detachedOffset: 0,
      pastedAudio: false,
      pastedAtSceneBorder: true
    };
    setAudioTracks(current => [...current, copy]);
    setSelectedAudioId(copy.id); setSelectedId(''); setSelectedCaptionId('');
    setAudioSelection(null); setWarning('');
    setProgress({ pct: 100, phase: `${audioClipboard.name} pasted at the gold line (${formatTime(targetStart)}) and stopped at the ${targetScene?.name || 'timeline'} scene border.` });
  };

  const duplicateSelectedAudio = () => {
    if (!selectedAudio) return;
    setAudioClipboard({ ...selectedAudio });
    const copy = { ...selectedAudio, id: uid(), name: `${selectedAudio.name} (copy)`, start: Math.min(totalDuration, Number(selectedAudio.start || 0) + Number(selectedAudio.duration || 0)), originSceneId: '', detachedFromSceneId: '', reattachedToSceneId: '', timelineOffsetWithinScene: undefined, pastedAudio: true };
    setAudioTracks(current => [...current, copy]);
    setSelectedAudioId(copy.id); setSelectedId(''); setSelectedCaptionId('');
    setProgress({ pct: 100, phase: `${selectedAudio.name} duplicated. Its left and right edges can be trimmed independently.` });
  };

  useEffect(() => {
    if (!contextMenu) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const menu = document.querySelector('.mx-context-menu');
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
    });
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close); window.removeEventListener('resize', close); };
  }, [contextMenu]);

  const applyVisualPreset = preset => {
    if (!selected) return;
    const values = {
      natural: { brightness: 0, contrast: 1, saturation: 1 },
      vivid: { brightness: 0.02, contrast: 1.12, saturation: 1.28 },
      cinematic: { brightness: -0.03, contrast: 1.18, saturation: 0.82 },
      soft: { brightness: 0.05, contrast: 0.92, saturation: 0.9 },
      mono: { brightness: 0, contrast: 1.08, saturation: 0 },
    }[preset];
    patchScene(selected.id, values);
  };

  const splitScene = () => {
    if (!selected || selected.kind !== 'video') return;
    const sceneStart = sceneTimelineOffset(selected.id);
    const local = playheadTime - sceneStart;
    const speed = Number(selected.speed || 1);
    const sourceLocal = local * speed;
    const absolute = Number(selected.trimStart || 0) + sourceLocal;
    const timelineDuration = Number(selected.duration || 0) / speed;
    if (local < 0.25 || local > timelineDuration - 0.25) return;
    const first = { ...selected, duration: sourceLocal };
    const second = { ...selected, id: uid(), name: `${selected.name} (part 2)`, trimStart: absolute, duration: Number(selected.duration) - sourceLocal };
    const nextScenes = scenes.flatMap(scene => scene.id === selected.id ? [first, second] : [scene]);
    commitTimelineHistory(nextScenes, audioTracks, []);
    setScenes(nextScenes);
    setSelectedId(second.id);
    setCaptions([]);
  };

  const generateCaptions = async () => {
    const videos = scenes.filter(scene => scene.kind === 'video');
    if (!videos.length || typeof window.electronAPI?.transcribeVideo !== 'function') return null;
    const totalVideos = videos.length;
    let videoIndex = 0;
    setCaptioning(true);
    setCaptions([]);
    setDetectedCaptionLanguage('');
    const resumedOutput = [];
    const resumedDetected = new Set();
    try {
      const output = resumedOutput;
      const detected = resumedDetected;
      let timelineOffset = 0;
      for (let index = 0; index < scenes.length; index += 1) {
        const scene = scenes[index];
        const speed = scene.kind === 'image' ? 1 : Number(scene.speed || 1);
        if (scene.kind === 'video') {
          videoIndex += 1;
          setProgress({ 
            pct: Math.round((index / scenes.length) * 90), 
            phase: `Detecting speech in "${scene.name || safeFileBase(scene.path)}" (Scene ${index + 1}/${scenes.length})`,
            completedCount: videoIndex - 1,
            totalCount: totalVideos
          });
          const cacheKey = JSON.stringify({ version: 1, path: scene.path, trimStart: Number(scene.trimStart || 0), duration: Number(scene.duration || 0), speed, captionLanguage });
          let response = null;
          const cached = await window.electronAPI?.myExporterCaptionCacheLoad?.(cacheKey);
          if (cached?.ok && cached.found && Array.isArray(cached.data?.captions)) {
            response = cached.data;
            setProgress({ 
              pct: Math.round(((index + .8) / scenes.length) * 90), 
              phase: `Resumed saved caption cache · "${scene.name || safeFileBase(scene.path)}" (${index + 1}/${scenes.length})`,
              completedCount: videoIndex - 1,
              totalCount: totalVideos
            });
          } else {
            response = await transcribeLocalMediaPath(scene.path, 'Auto-Detect', 8, (message, pct) => setProgress({ 
              pct: Math.min(96, Math.round((index / scenes.length) * 90 + pct / scenes.length)), 
              phase: `${message} · "${scene.name || safeFileBase(scene.path)}" (${index + 1}/${scenes.length})`,
              completedCount: videoIndex - 1,
              totalCount: totalVideos
            }));
            const saved = await window.electronAPI?.myExporterCaptionCacheSave?.(cacheKey, { captions: response.captions || [], detectedLang: response.detectedLang || '', sourcePath: scene.path });
            if (saved && !saved.ok) setWarning(`Captions continue, but the resume cache for scene ${index + 1} could not be saved: ${saved.error}`);
          }
          if (response.detectedLang) detected.add(response.detectedLang);
          for (const segment of response.captions || []) {
            const start = Number(segment.start) || 0;
            const end = Number(segment.end) || start;
            if (end <= scene.trimStart || start >= scene.trimStart + scene.duration) continue;
            const timelineStart = timelineOffset + Math.max(0, start - scene.trimStart) / speed;
            const timelineEnd = timelineOffset + Math.min(scene.duration, end - scene.trimStart) / speed;
            const captionText = captionLanguage === 'auto' ? String(segment.text || '').trim() : await translateTextLocal(segment.text, captionLanguage);
            output.push({
              id: uid(),
              start: timelineStart,
              end: timelineEnd,
              text: captionText,
              words: Array.isArray(segment.words) ? segment.words.map(word => ({ ...word, start: timelineOffset + Math.max(0, Number(word.start) - scene.trimStart) / speed, end: timelineOffset + Math.max(0, Number(word.end) - scene.trimStart) / speed })) : [],
              source: 'caption-burner-local-ai',
            });
          }
          
          // Progressive Update: render captions on the timeline instantly as they are processed
          const currentProgressive = output.filter(item => item.text && item.end > item.start);
          setCaptions(currentProgressive);
          setProgress(curr => ({
            ...curr,
            completedCount: videoIndex
          }));
        }
        timelineOffset += (Number(scene.duration) || 0) / speed;
      }
      const readyCaptions = output.filter(item => item.text && item.end > item.start);
      setCaptions(readyCaptions);
      if (readyCaptions.length) {
        setCaptionSampleVisible(false);
        setTrackStates(value => ({ ...value, captionsMuted: false }));
        setSettings(value => ({ ...value, burnCaptions: true }));
        setSelectedAudioId('');
        window.setTimeout(() => {
          seekTimeline(Number(readyCaptions[0].start) + .02);
          setSelectedCaptionId(readyCaptions[0].id);
        }, 0);
      }
      const detectedLabel = [...detected].join(', ') || 'Auto-Detect';
      setDetectedCaptionLanguage(detectedLabel);
      setProgress({ 
        pct: 100, 
        phase: readyCaptions.length ? `${readyCaptions.length} real captions fixed to the synchronized timeline · ${detectedLabel}` : 'No speech detected',
        completedCount: totalVideos,
        totalCount: totalVideos
      });
      return readyCaptions;
    } catch (error) {
      const partialCaptions = resumedOutput.filter(item => item.text && item.end > item.start);
      if (partialCaptions.length) {
        setCaptions(partialCaptions); setCaptionSampleVisible(false);
        setTrackStates(value => ({ ...value, captionsMuted: false }));
      }
      setProgress({ pct: 0, phase: `Caption generation failed: ${error.message}` });
      setWarning(`Caption generation stopped: ${error.message}${partialCaptions.length ? `\n${partialCaptions.length} completed captions remain visible. Saved scene checkpoints will resume automatically next time.` : '\nCompleted scene checkpoints, if any, were saved and will resume automatically next time.'}`);
      return null;
    } finally {
      setCaptioning(false);
    }
  };

  const exportVideo = async (captionsOverride = null, forceBurnCaptions = false) => {
    if (!scenes.length || exporting) return false;
    setWarning('');
    const uploadedName = safeFileBase(mediaLibrary[0]?.name || scenes[0]?.name || 'My-Exporter');
    const hasSavedProjectName = projectPath !== 'Not saved yet' && projectName && projectName !== 'Untitled Project';
    const exportBaseName = safeFileBase(hasSavedProjectName ? projectName : uploadedName) || 'My-Exporter';
    const dialogResult = await window.electronAPI?.showSaveDialog?.({
      title: 'Export video from My Exporter',
      defaultPath: `${exportBaseName}.mp4`,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      buttonLabel: `Export ${settings.resolution === '4k' ? '4K' : settings.resolution}`,
    });
    if (dialogResult?.canceled || !dialogResult?.filePath) return false;
    setExporting(true);
    setExportStartedAt(Date.now()); setExportClock(Date.now());
    setResult(null);
    setProgress({ pct: 1, phase: 'Checking every scene and export requirement' });
    try {
      if (typeof window.electronAPI?.myExporterPreflight !== 'function' || typeof window.electronAPI?.myExporterExport !== 'function') throw new Error('My Exporter background service is unavailable. Restart Pattan Presentator and try again.');
      const payload = {
        ...settings,
        scenes: scenes.filter(scene => !scene.disabled).map(scene => ({ ...scene, fit: settings.framing || 'contain' })),
        captions: Array.isArray(captionsOverride) ? captionsOverride : captions,
        textOverlays,
        audioTracks: audioTracks.map(track => ({ ...track, muted: track.muted || trackStates.audioMuted })),
        burnCaptions: (forceBurnCaptions || settings.burnCaptions) && !trackStates.captionsMuted,
        musicPath: music?.path || '', watermarkPath: watermarkEnabled ? watermark?.path || '' : '', outputPath: dialogResult.filePath,
      };
      const check = await window.electronAPI.myExporterPreflight(payload);
      if (!check?.ok) throw new Error((check?.errors || ['Export validation failed.']).join('\n'));
      if (check?.warnings?.length) setWarning(check.warnings.join('\n'));
      setProgress({ pct: 1, phase: 'Checks passed — starting native export' });
      const response = await window.electronAPI.myExporterExport(payload);
      if (!response?.ok) throw new Error(response?.error || 'Export failed.');
      setResult(response);
      setProgress({ pct: 100, phase: `Exported ${response.width}×${response.height} MP4` });
      const completedFileName = response.fileName || dialogResult.filePath.split(/[\\/]/).pop();
      window.electronAPI?.showNotification?.('My Exporter complete', `${completedFileName} completed from My Exporter.`);
      try {
        window.speechSynthesis?.cancel();
        const announcement = new SpeechSynthesisUtterance(`${completedFileName} completed from My Exporter`);
        announcement.rate = .92; announcement.volume = 1;
        window.speechSynthesis?.speak(announcement);
      } catch (_) {}
      return true;
    } catch (error) {
      const message = error?.message || 'Export failed unexpectedly.';
      setWarning(message);
      setProgress({ pct: 0, phase: 'Export stopped — see warning' });
      window.electronAPI?.showNotification?.('My Exporter warning', message.split('\n')[0]);
      return false;
    } finally {
      setExporting(false);
    }
  };

  const generateCaptionsAndExport = async () => {
    if (captioning || exporting) return;
    const generated = await generateCaptions();
    if (!generated?.length) {
      setWarning('No captions were generated, so export did not start. Check that the video contains clear speech and try again.');
      return false;
    }
    setSettings(value => ({ ...value, burnCaptions: true }));
    setProgress({ pct: 100, phase: `${generated.length} captions generated and verified. Choose where to save the captioned video.` });
    return exportVideo(generated, true);
  };

  const generateExportAndShutdown = async () => {
    if (!window.confirm('Generate captions, export the video, and shut down this computer after export succeeds? Unsaved work in other applications could be lost.')) return;
    const completed = await generateCaptionsAndExport();
    if (!completed) { setWarning('Shutdown was cancelled because caption generation or export did not complete successfully.'); return; }
    if (typeof window.electronAPI?.shutdownComputer !== 'function') { setWarning('Video exported, but the Windows shutdown service is unavailable.'); return; }
    const response = await window.electronAPI.shutdownComputer({ delaySeconds: 30, reason: 'My Exporter finished successfully' });
    if (!response?.ok) setWarning(`Video exported, but shutdown could not be scheduled: ${response?.error || 'Unknown error'}`);
    else setProgress({ pct: 100, phase: 'Export complete. Windows will shut down in 30 seconds.' });
  };

  const exportEtaSeconds = exporting && exportStartedAt && progress.pct > 1 && progress.pct < 100 ? ((exportClock - exportStartedAt) / 1000) * (100 - progress.pct) / progress.pct : 0;

  useEffect(() => {
    const onKeyDown = event => {
      // Do not intercept keyboard shortcuts when My Exporter is hidden.
      // (MyExporter is now always mounted; active=false means another module tab is showing.)
      if (!active) return;
      const tag = event.target?.tagName?.toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) return;

      // Ctrl + A: Select All Scenes
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedIds(scenes.map(s => s.id));
        setSelectedId(scenes[scenes.length - 1]?.id || '');
        setSelectedAudioId('');
        setSelectedCaptionId('');
        return;
      }

      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); restoreHistory(-1); return; }
      if ((event.ctrlKey && event.key.toLowerCase() === 'y') || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z')) { event.preventDefault(); restoreHistory(1); return; }
      
      // Ctrl + D: Duplicate Scene
      if (event.ctrlKey && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateScene(); return; }

      // Copy / Paste scenes
      if (event.ctrlKey && event.key.toLowerCase() === 'c' && selectedIds.length > 0) {
        event.preventDefault();
        try {
          const copiedScenes = scenes.filter(s => selectedIds.includes(s.id));
          localStorage.setItem('mx-clipboard-scenes', JSON.stringify(copiedScenes));
          setSceneClipboard({ type: 'multiple', data: copiedScenes });
          setProgress({ pct: 100, phase: `${selectedIds.length} scenes copied to clipboard.` });
        } catch (_) {}
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'c' && selectedAudio) { event.preventDefault(); copySelectedAudio(); return; }
      if (event.ctrlKey && event.key.toLowerCase() === 'v' && audioClipboard) { event.preventDefault(); pasteCopiedAudio(); return; }
      if (event.ctrlKey && event.key.toLowerCase() === 'c' && selected) { event.preventDefault(); copyScene(); return; }
      if (event.ctrlKey && event.key.toLowerCase() === 'v' && sceneClipboard) {
        event.preventDefault();
        if (sceneClipboard.type === 'multiple') {
          const newScenes = sceneClipboard.data.map(s => ({ ...s, id: uid() }));
          setScenes(prev => {
            const lastSelectedIdx = prev.findLastIndex(s => selectedIds.includes(s.id));
            if (lastSelectedIdx !== -1) {
              const before = prev.slice(0, lastSelectedIdx + 1);
              const after = prev.slice(lastSelectedIdx + 1);
              return [...before, ...newScenes, ...after];
            }
            return [...prev, ...newScenes];
          });
          setSelectedIds(newScenes.map(s => s.id));
          setSelectedId(newScenes[newScenes.length - 1]?.id || '');
          setProgress({ pct: 100, phase: `Pasted ${newScenes.length} scenes from clipboard.` });
        } else {
          pasteScene();
        }
        return;
      }
      if (event.key === 'F2' && selected) { event.preventDefault(); renameSelectedScene(); return; }
      if (event.key.toLowerCase() === 'n' && !event.ctrlKey) { event.preventDefault(); setSnapEnabled(value => !value); return; }
      if (event.shiftKey && event.key === 'Delete' && selected) { event.preventDefault(); removeScene(selected.id, true); return; }
      if (event.shiftKey && event.key === 'Delete' && selectedAudio) { event.preventDefault(); removeAudioTrack(selectedAudio.id, true); return; }
      if (event.key === 'Delete' && selectedAudio) { event.preventDefault(); removeAudioTrack(selectedAudio.id); return; }
      
      // Delete Scenes
      if (event.key === 'Delete' && selectedIds.length > 0) {
        event.preventDefault();
        removeSelectedScenes();
        return;
      }
      if (event.key === 'Delete' && selected) { event.preventDefault(); removeScene(selected.id); return; }
      
      if (event.altKey && event.key === 'ArrowLeft' && selected) { event.preventDefault(); moveScene(selected.id, -1); return; }
      if (event.altKey && event.key === 'ArrowRight' && selected) { event.preventDefault(); moveScene(selected.id, 1); return; }
      if (!event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); razorCut(); return; }
      if (event.key === ' ' && preview.current) { event.preventDefault(); preview.current.paused ? preview.current.play() : preview.current.pause(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, selected, selectedAudio, selectedCaptionId, playheadTime, scenes, audioTracks, captions, rippleEnabled, snapEnabled, timelineZoom, historyVersion, audioClipboard, sceneClipboard, selectedIds]);

  const previewFontPx = Math.max(10, Number(settings.captionFontSize || 42) * (previewFrame.height || 540) / 1080);
  const captionPosition = settings.captionPosition || 'bottom';
  const captionPreviewStyle = {
    left: previewFrame.width ? previewFrame.left + previewFrame.width / 2 : '50%',
    top: previewFrame.height ? previewFrame.top + previewFrame.height * (captionPosition === 'top' ? .055 : captionPosition === 'middle' ? .5 : .945) : captionPosition === 'top' ? '7%' : captionPosition === 'middle' ? '50%' : '93%',
    bottom: 'auto',
    transform: captionPosition === 'middle' ? 'translate(-50%,-50%)' : captionPosition === 'bottom' ? 'translate(-50%,-100%)' : 'translateX(-50%)',
    fontSize: `${previewFontPx}px`,
    width: previewFrame.width ? `${Math.min(previewFrame.width * .9, previewFontPx * .62 * Number(settings.captionMaxChars || 36))}px` : '80%',
    maxWidth: previewFrame.width ? `${previewFrame.width * .9}px` : '80%',
    whiteSpace: 'pre-line',
    textShadow: 'none',
  };
  const previewCaptionText = previewCaption ? wrapCaptionText(previewCaption.text, Number(settings.captionMaxChars || 36)) : '';

  const thumbPercent = Math.max(8, (scrollInfo.clientWidth / scrollInfo.width) * 100);
  const thumbLeftPercent = scrollInfo.width > scrollInfo.clientWidth 
    ? (scrollInfo.left / (scrollInfo.width - scrollInfo.clientWidth)) * (100 - thumbPercent) 
    : 0;

  return (
    <div className={`mx-page ${timelineExpanded ? 'mx-timeline-expanded' : ''} mx-layout-${layoutMode}`}>
      <input ref={mediaInput} className="mx-hidden" type="file" multiple accept="video/*,image/*" onChange={addMedia} />
      <input ref={musicInput} className="mx-hidden" type="file" accept="audio/*" onChange={addMusic} />
      <input ref={watermarkInput} className="mx-hidden" type="file" accept="image/png,image/webp,image/jpeg" onChange={addWatermark} />
      <input ref={projectInput} className="mx-hidden" type="file" accept=".pattanproject,application/json" onChange={openProjectFile} />
      <header className="mx-header">
        <div className="mx-project-identity"><span className="mx-kicker">Pattan Studio</span><h1>My Exporter</h1><small className="mx-project-name">{projectName}</small><small className="mx-project-path" title={projectPath}>{projectPath}</small></div>
        <div className="mx-header-meta"><span>{scenes.length} scenes</span><span>{formatTime(totalDuration)}</span><span>{settings.resolution.toUpperCase()}</span></div>
        <div className="mx-header-actions"><button onClick={newProject}>New</button><button onClick={() => projectInput.current?.click()}>Open</button><button onClick={saveProject}>Save Project</button><button className="mx-delete-project" onClick={deleteProject}>Delete Project</button><button className="mx-reset-exporter" onClick={resetExporter} disabled={captioning || exporting}>Reset All</button><button onClick={() => setAdvancedMode(value => !value)}>{advancedMode ? 'Simple View' : 'Advanced Tools'}</button><button onClick={syncBySerialNumber} disabled={!mediaLibrary.length}>↕ Serial Sync</button><button onClick={pickMedia}>+ Add Media</button><div className="mx-export-dropdown-container"><button className="mx-export" onClick={() => setExportDropdownOpen(prev => !prev)} disabled={!scenes.length || exporting}>{exporting ? `${progress.pct}% Exporting` : 'Export Video ▾'}</button>{exportDropdownOpen && !exporting && (<div className="mx-export-dropdown-menu"><button onClick={() => { setExportDropdownOpen(false); exportVideo(); }}>Only Export Video (No Captions)</button><button onClick={() => { setExportDropdownOpen(false); generateCaptionsAndExport(); }}>Generate Captions & Export</button><button onClick={() => { setExportDropdownOpen(false); generateExportAndShutdown(); }}>Generate Captions, Export & Shut Down</button></div>)}</div></div>
      </header>
      <div className="mx-project-tabs"><strong>Projects</strong>{workspaceTabs.map(tab => <button key={tab.id} className={tab.id === activeWorkspaceId ? 'active' : ''} disabled={captioning || exporting} onClick={() => switchWorkspace(tab.id)}>{tab.id === activeWorkspaceId ? projectName : tab.name}</button>)}<button className="mx-add-project-tab" disabled={captioning || exporting} onClick={addWorkspace}>+ New Project Tab</button><span>{captioning || exporting ? 'Current project is processing; other projects remain protected.' : 'Each tab has separate media, captions, logos, text and settings.'}</span></div>

      <div className="mx-guide">
        <div className={scenes.length ? 'done' : 'active'}><span>1</span><strong>Add media</strong><small>Choose videos and pictures</small></div>
        <i />
        <div className={scenes.length && !result ? 'active' : scenes.length ? 'done' : ''}><span>2</span><strong>Edit</strong><small>Arrange, cut and add captions</small></div>
        <i />
        <div className={result ? 'done' : ''}><span>3</span><strong>Export</strong><small>Save your finished video</small></div>
        <p>{advancedMode ? 'Advanced tools are visible.' : 'Simple view is on. Use Advanced Tools only when you need extra control.'}</p>
      </div>

      <nav className="mx-professional-tabs" aria-label="Editor asset categories">
        {['Media','Stock Media','Audio','Titles','Transitions','Effects','Filters','Stickers','Templates'].map(tab => <button key={tab} className={assetTab === tab ? 'active' : ''} onClick={() => { setAssetTab(tab); if (tab === 'Media') setOpenSidePanel('library'); if (tab === 'Audio') window.setTimeout(() => document.querySelector('.mx-audio-box')?.scrollIntoView({ behavior: 'smooth' }), 0); if (tab === 'Titles') addTextOverlay(); if (['Effects','Filters'].includes(tab)) setAdvancedMode(true); }}>{tab === 'Media' ? '▣' : tab === 'Stock Media' ? '◫' : tab === 'Audio' ? '♫' : tab === 'Titles' ? 'T' : tab === 'Transitions' ? '◒' : tab === 'Effects' ? '✦' : tab === 'Filters' ? '◉' : tab === 'Stickers' ? '★' : '▦'}<span>{tab}</span></button>)}
        <i className="mx-professional-divider" />
        <div className="mx-quick-project-actions">
          <button title="New project" onClick={newProject}><b>＋</b><span>New</span></button>
          <button title="Open project" onClick={() => projectInput.current?.click()}><b>▱</b><span>Open</span></button>
          <button title="Save project" onClick={saveProject}><b>▣</b><span>Save</span></button>
          <button className="danger" title="Delete project" onClick={deleteProject}><b>⌫</b><span>Delete</span></button>
          <button className="danger" title="Reset and clear everything in My Exporter" onClick={resetExporter} disabled={captioning || exporting}><b>↺</b><span>Reset</span></button>
          <button title="Switch simple or advanced tools" onClick={() => setAdvancedMode(value => !value)}><b>⚙</b><span>{advancedMode ? 'Simple' : 'Tools'}</span></button>
          <button title="Add every media file to the timeline in serial-number order" onClick={syncBySerialNumber} disabled={!mediaLibrary.length}><b>↕</b><span>Serial</span></button>
          <button title="Import videos or images" onClick={pickMedia}><b>⊕</b><span>Import</span></button>
          <button title="Open the video preview in full screen" onClick={togglePreviewFullscreen} disabled={!selected}><b>⛶</b><span>Preview</span></button>
          <button title="Create another independent project tab" onClick={addWorkspace} disabled={captioning || exporting}><b>▤</b><span>Project</span></button>
          <button className={`mx-layout-btn${layoutPickerOpen ? ' active' : ''}`} title="Switch workspace layout" onClick={() => setLayoutPickerOpen(v => !v)}>
            <b>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
                <rect x="1" y="1" width="5" height="7" rx="1" fill="currentColor" opacity=".7"/>
                <rect x="7.5" y="1" width="4.5" height="3.5" rx="1" fill="currentColor"/>
                <rect x="7.5" y="5.5" width="4.5" height="3.5" rx="1" fill="currentColor" opacity=".55"/>
                <rect x="1" y="9.5" width="11" height="2.5" rx="1" fill="currentColor" opacity=".45"/>
              </svg>
            </b>
            <span>Layout</span>
          </button>
          <select title="Switch project" aria-label="Switch project" value={activeWorkspaceId} disabled={captioning || exporting} onChange={event => switchWorkspace(event.target.value)}>{workspaceTabs.map(tab => <option key={tab.id} value={tab.id}>{tab.id === activeWorkspaceId ? projectName : tab.name}</option>)}</select>
        </div>
        <div className="mx-export-dropdown-container"><button className="mx-professional-export" onClick={() => setExportDropdownOpen(prev => !prev)} disabled={!scenes.length || exporting}>{exporting ? `${progress.pct}%` : 'Export ▾'}</button>{exportDropdownOpen && !exporting && (<div className="mx-export-dropdown-menu"><button onClick={() => { setExportDropdownOpen(false); exportVideo(); }}>Only Export Video (No Captions)</button><button onClick={() => { setExportDropdownOpen(false); generateCaptionsAndExport(); }}>Generate Captions & Export</button><button onClick={() => { setExportDropdownOpen(false); generateExportAndShutdown(); }}>Generate Captions, Export & Shut Down</button></div>)}</div>
      </nav>

      {/* ── Layout Picker Popup ── */}
      {layoutPickerOpen && (
        <div className="mx-layout-picker-popup" role="dialog" aria-label="Workspace layout picker">
          <div className="mx-layout-picker-title">Workspace Layout</div>
          <div className="mx-layout-picker-grid">
            {[
              {
                id: 'default', label: 'Default',
                icon: (
                  <svg viewBox="0 0 54 38" fill="none">
                    <rect x="1" y="1" width="52" height="36" rx="3" fill="#1a1f27" stroke="#2e3540" strokeWidth="1"/>
                    <rect x="3" y="3" width="13" height="32" rx="2" fill="#262c35"/>
                    <rect x="18" y="3" width="22" height="20" rx="2" fill="#1e2530"/>
                    <rect x="18" y="25" width="22" height="10" rx="2" fill="#181d24"/>
                    <rect x="42" y="3" width="11" height="32" rx="2" fill="#262c35"/>
                    <rect x="20" y="6" width="18" height="11" rx="1" fill="#c7a86a" opacity=".18"/>
                    <polygon points="28,8 34,11.5 28,15" fill="#c7a86a" opacity=".6"/>
                  </svg>
                )
              },
              {
                id: 'organize', label: 'Organize',
                icon: (
                  <svg viewBox="0 0 54 38" fill="none">
                    <rect x="1" y="1" width="52" height="36" rx="3" fill="#1a1f27" stroke="#2e3540" strokeWidth="1"/>
                    <rect x="3" y="3" width="20" height="32" rx="2" fill="#262c35"/>
                    <rect x="25" y="3" width="27" height="20" rx="2" fill="#1e2530"/>
                    <rect x="25" y="25" width="27" height="10" rx="2" fill="#181d24"/>
                    <rect x="4" y="5" width="18" height="4" rx="1" fill="#c7a86a" opacity=".35"/>
                    <rect x="4" y="11" width="18" height="3" rx="1" fill="#444c57" opacity=".8"/>
                    <rect x="4" y="16" width="18" height="3" rx="1" fill="#444c57" opacity=".8"/>
                    <rect x="4" y="21" width="18" height="3" rx="1" fill="#444c57" opacity=".8"/>
                    <polygon points="36,7 44,11.5 36,16" fill="#c7a86a" opacity=".6"/>
                  </svg>
                )
              },
              {
                id: 'timeline', label: 'Timeline',
                icon: (
                  <svg viewBox="0 0 54 38" fill="none">
                    <rect x="1" y="1" width="52" height="36" rx="3" fill="#1a1f27" stroke="#2e3540" strokeWidth="1"/>
                    <rect x="3" y="3" width="13" height="14" rx="2" fill="#262c35"/>
                    <rect x="18" y="3" width="36" height="14" rx="2" fill="#1e2530"/>
                    <rect x="3" y="19" width="51" height="17" rx="2" fill="#181d24"/>
                    <rect x="5" y="21" width="47" height="4" rx="1" fill="#c7a86a" opacity=".28"/>
                    <rect x="5" y="27" width="47" height="3" rx="1" fill="#3a4250" opacity=".9"/>
                    <rect x="5" y="32" width="47" height="2.5" rx="1" fill="#2e3540" opacity=".9"/>
                    <polygon points="22,6 30,10 22,14" fill="#c7a86a" opacity=".55"/>
                  </svg>
                )
              },
              {
                id: 'shortvideo', label: 'Short Video',
                icon: (
                  <svg viewBox="0 0 54 38" fill="none">
                    <rect x="1" y="1" width="52" height="36" rx="3" fill="#1a1f27" stroke="#2e3540" strokeWidth="1"/>
                    <rect x="3" y="3" width="10" height="32" rx="2" fill="#262c35"/>
                    <rect x="15" y="3" width="16" height="26" rx="2" fill="#1e2530"/>
                    <rect x="15" y="31" width="16" height="4" rx="1" fill="#181d24"/>
                    <rect x="33" y="3" width="20" height="32" rx="2" fill="#262c35"/>
                    <rect x="17" y="5" width="12" height="20" rx="1" fill="#1e2a35"/>
                    <polygon points="22,10 26,14.5 22,19" fill="#c7a86a" opacity=".7"/>
                  </svg>
                )
              },
              {
                id: 'classic', label: 'Classic',
                icon: (
                  <svg viewBox="0 0 54 38" fill="none">
                    <rect x="1" y="1" width="52" height="36" rx="3" fill="#1a1f27" stroke="#2e3540" strokeWidth="1"/>
                    <rect x="3" y="3" width="28" height="22" rx="2" fill="#1e2530"/>
                    <rect x="33" y="3" width="20" height="22" rx="2" fill="#262c35"/>
                    <rect x="3" y="27" width="51" height="8" rx="2" fill="#181d24"/>
                    <rect x="5" y="29" width="47" height="4" rx="1" fill="#c7a86a" opacity=".22"/>
                    <polygon points="13,9 22,14 13,19" fill="#c7a86a" opacity=".65"/>
                  </svg>
                )
              },
              {
                id: 'dual', label: 'Dual',
                icon: (
                  <svg viewBox="0 0 54 38" fill="none">
                    <rect x="1" y="1" width="52" height="36" rx="3" fill="#1a1f27" stroke="#2e3540" strokeWidth="1"/>
                    <rect x="3" y="3" width="23" height="20" rx="2" fill="#1e2530"/>
                    <rect x="28" y="3" width="23" height="20" rx="2" fill="#1e2530"/>
                    <rect x="3" y="25" width="48" height="11" rx="2" fill="#181d24"/>
                    <rect x="5" y="27" width="44" height="3" rx="1" fill="#3a4250" opacity=".9"/>
                    <polygon points="10,8 17,12 10,16" fill="#c7a86a" opacity=".6"/>
                    <polygon points="35,8 42,12 35,16" fill="#c7a86a" opacity=".45"/>
                  </svg>
                )
              },
            ].map(({ id, label, icon }) => (
              <button
                key={id}
                className={`mx-layout-card${layoutMode === id ? ' mx-layout-card-active' : ''}`}
                onClick={() => setLayout(id)}
                title={`Switch to ${label} layout`}
              >
                <span className="mx-layout-icon">{icon}</span>
                <span className="mx-layout-label">{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <section className="mx-asset-shelf">
        <header><strong>{assetTab}</strong><span>{assetTab === 'Media' ? 'Import and organize project files' : assetTab === 'Stock Media' ? 'Use local royalty-safe files and generated assets' : assetTab === 'Audio' ? 'Voice, music and sound controls' : assetTab === 'Titles' ? 'Add editable text and caption designs' : assetTab === 'Transitions' ? 'Smooth scene changes' : assetTab === 'Effects' ? 'Creative scene treatments' : assetTab === 'Filters' ? 'Professional colour looks' : assetTab === 'Stickers' ? 'Logos, badges and picture overlays' : 'Ready-made editing setups'}</span></header>
        <div>
          {assetTab === 'Media' && <><button onClick={() => mediaLibrary[0] && activateLibraryAsset(mediaLibrary[0])} disabled={!mediaLibrary.length}><b>▶</b><strong>First Media</strong><small>Select first file</small></button><button onClick={() => setTimelineExpanded(value => !value)}><b>▤</b><strong>Timeline View</strong><small>{timelineExpanded ? 'Balanced workspace' : 'Expand timeline'}</small></button><button onClick={() => { setTimelineExpanded(true); setTimelineZoom(25); }} disabled={!scenes.length}><b>⌁</b><strong>Audio Focus</strong><small>Detailed waveform</small></button><button onClick={() => setSafeGuides(value => !value)}><b>⌗</b><strong>Safe Guides</strong><small>{safeGuides ? 'Hide preview guides' : 'Show preview guides'}</small></button></>}
          {assetTab === 'Stock Media' && <><button onClick={pickMedia}><b>▧</b><strong>Local Stock</strong><small>Import downloaded media</small></button><button onClick={() => setWarning('For privacy, Stock Media remains local. Download licensed media first, then import it here.')}><b>✓</b><strong>License Safe</strong><small>Local-only workflow</small></button><button onClick={() => setAdvancedMode(true)}><b>✦</b><strong>AI Director</strong><small>Open advanced creation tools</small></button></>}
          {assetTab === 'Audio' && <><button onClick={pickAudioTracks}><b>♫</b><strong>Add Audio</strong><small>Voice or sound</small></button><button onClick={() => musicInput.current?.click()}><b>♬</b><strong>Background Music</strong><small>Add music track</small></button><button onClick={detachSelectedAudio} disabled={!selected?.hasAudio}><b>⇲</b><strong>Detach Audio</strong><small>From selected video</small></button><button onClick={() => selected && patchScene(selected.id, { normalizeAudio: true })} disabled={!selected?.hasAudio}><b>G</b><strong>Normalize</strong><small>Broadcast loudness</small></button></>}
          {assetTab === 'Titles' && <><button onClick={addTextOverlay}><b>T</b><strong>Basic Title</strong><small>Draggable text</small></button><button onClick={() => { addTextOverlay(); setSettings(value => ({ ...value, captionStyle: 'box' })); }}><b>▰</b><strong>Lower Third</strong><small>Readable title box</small></button><button onClick={() => setCaptionSampleVisible(value => !value)}><b>CC</b><strong>Caption Sample</strong><small>Preview exact style</small></button><button onClick={() => setCaptionEditorOpen(true)} disabled={!captions.length}><b>✎</b><strong>Edit Captions</strong><small>Complete timeline</small></button></>}
          {assetTab === 'Transitions' && <><button onClick={() => selected && patchScene(selected.id, { fade: .35 })} disabled={!selected}><b>◐</b><strong>Dissolve</strong><small>0.35 second</small></button><button onClick={() => selected && patchScene(selected.id, { fade: .7 })} disabled={!selected}><b>◒</b><strong>Soft Fade</strong><small>0.70 second</small></button><button onClick={() => selected && patchScene(selected.id, { fade: 1.2 })} disabled={!selected}><b>●</b><strong>Cinematic Fade</strong><small>1.20 seconds</small></button><button onClick={() => selected && patchScene(selected.id, { fade: 0 })} disabled={!selected}><b>×</b><strong>No Transition</strong><small>Hard cut</small></button></>}
          {assetTab === 'Effects' && <><button onClick={() => applyVisualPreset('cinematic')} disabled={!selected}><b>✦</b><strong>Cinema</strong><small>Film contrast</small></button><button onClick={() => applyVisualPreset('soft')} disabled={!selected}><b>☁</b><strong>Soft Light</strong><small>Gentle classroom look</small></button><button onClick={() => selected && patchScene(selected.id, { brightness: .08, contrast: 1.15, saturation: 1.1 })} disabled={!selected}><b>☀</b><strong>Clarity</strong><small>Bright and clear</small></button><button onClick={() => selected && patchScene(selected.id, { rotation: (Number(selected.rotation || 0) + 90) % 360 })} disabled={!selected}><b>↻</b><strong>Rotate</strong><small>90 degrees</small></button></>}
          {assetTab === 'Filters' && <><button onClick={() => applyVisualPreset('natural')} disabled={!selected}><b>N</b><strong>Natural</strong><small>Original colour</small></button><button onClick={() => applyVisualPreset('vivid')} disabled={!selected}><b>V</b><strong>Vivid</strong><small>Rich colours</small></button><button onClick={() => applyVisualPreset('mono')} disabled={!selected}><b>◑</b><strong>Mono</strong><small>Black and white</small></button><button onClick={() => selected && patchScene(selected.id, { brightness: 0, contrast: 1, saturation: 1 })} disabled={!selected}><b>↺</b><strong>Reset</strong><small>Remove filter</small></button></>}
          {assetTab === 'Stickers' && <><button onClick={() => { setWatermark(DEFAULT_LOGO); setWatermarkEnabled(true); setWatermarkPreset('bottom-right'); }}><b>★</b><strong>Info Kids</strong><small>Company logo</small></button><button onClick={() => watermarkInput.current?.click()}><b>＋</b><strong>Import Sticker</strong><small>PNG or WebP</small></button><button onClick={coverFlowWatermark}><b>✥</b><strong>Cover Flow Star</strong><small>Bottom-right cover</small></button><button onClick={() => setWatermarkEnabled(value => !value)} disabled={!watermark}><b>◉</b><strong>Show / Hide</strong><small>Sticker visibility</small></button></>}
          {assetTab === 'Templates' && <><button onClick={() => applyExportPreset('youtube4k')}><b>4K</b><strong>YouTube</strong><small>UHD delivery</small></button><button onClick={() => applyExportPreset('cinematic')}><b>24</b><strong>Cinema</strong><small>24 fps film</small></button><button onClick={() => applyExportPreset('shorts')}><b>9:16</b><strong>Shorts</strong><small>Vertical video</small></button><button onClick={() => applyExportPreset('smooth')}><b>60</b><strong>Smooth</strong><small>60 fps motion</small></button></>}
        </div>
      </section>

      <div className={`mx-workspace mx-side-panel-${openSidePanel || 'closed'}`}>
        <button className="mx-side-panel-tab mx-side-panel-tab-left" title="Open media library" onClick={() => setOpenSidePanel(value => value === 'library' ? '' : 'library')}>Media ›</button>
        <button className="mx-side-panel-tab mx-side-panel-tab-right" title="Open editing controls" onClick={() => setOpenSidePanel(value => value === 'inspector' ? '' : 'inspector')}>‹ Tools</button>
        <aside className="mx-library">
          <button className="mx-side-panel-close" title="Hide media library" onClick={() => setOpenSidePanel('')}>‹ Hide</button>
          {openSidePanel === 'library' && <>
          <div className="mx-library-source-tabs" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: '8px' }}>
            <button className="active">Project Media</button>
            {mediaLibrary.length > 0 && (
              <button 
                onClick={() => setMediaLibrary([])} 
                style={{ 
                  background: 'rgba(239, 68, 68, 0.1)', 
                  border: '1px solid rgba(239, 68, 68, 0.2)', 
                  borderRadius: '4px',
                  color: '#ef4444', 
                  cursor: 'pointer', 
                  fontSize: '10px', 
                  fontWeight: 'bold',
                  padding: '3px 8px',
                  transition: 'all 0.15s ease'
                }}
                onMouseEnter={e => {
                  e.target.style.background = 'rgba(239, 68, 68, 0.2)';
                  e.target.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                }}
                onMouseLeave={e => {
                  e.target.style.background = 'rgba(239, 68, 68, 0.1)';
                  e.target.style.borderColor = 'rgba(239, 68, 68, 0.2)';
                }}
              >
                Clear All
              </button>
            )}
          </div>
          <div className="mx-panel-title">Media library</div>
          {!mediaLibrary.length && (
            <div 
              className="mx-library-empty" 
              onClick={pickMedia}
              style={{ cursor: 'pointer', transition: 'all 0.2s ease-in-out' }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(199, 168, 106, 0.04)';
                e.currentTarget.style.borderColor = 'rgba(199, 168, 106, 0.6)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = '';
                e.currentTarget.style.borderColor = '';
              }}
            >
              <span style={{ fontSize: '24px', display: 'block', marginBottom: '4px', color: '#c7a86a', fontWeight: 'bold' }}>+</span>
              <strong>No media yet</strong>
              <small>Click here to import videos, images or any files.</small>
            </div>
          )}
          <div className="mx-media-list">{mediaLibrary.map((asset, index) => { const onTimeline = scenes.some(scene => scene.libraryId === asset.id); return <div className={`mx-media-card ${onTimeline ? 'on-timeline' : ''}`} key={asset.id} onClick={() => activateLibraryAsset(asset)}><div className="mx-media-thumb">{asset.kind === 'image' ? <img src={fileUrl(asset.path)} alt="" loading="lazy" /> : <video src={fileUrl(asset.path)} muted preload="none" disablePictureInPicture />}</div><span className="mx-media-index">{index + 1}</span><span><strong>{asset.name}</strong><small>{asset.kind} · {formatTime(asset.duration)}</small></span><button onClick={event => { event.stopPropagation(); activateLibraryAsset(asset); }}>{onTimeline ? 'Select on Timeline' : 'Add to Timeline'}</button><button className="mx-bin-remove" title="Remove from library" onClick={event => {
            event.stopPropagation();
            const assetId = asset.id;
            setMediaLibrary(current => current.filter(item => item.id !== assetId));
            setScenes(current => current.filter(scene => scene.libraryId !== assetId));
            setSelectedId(currentId => {
              const isRemoved = scenes.some(scene => scene.libraryId === assetId && scene.id === currentId);
              return isRemoved ? '' : currentId;
            });
          }}>×</button></div>; })}</div>
          <div className="mx-audio-box">
            <div className="mx-panel-title">Audio tracks</div>
            <button onClick={pickAudioTracks}>+ Add Voice / Sound</button>
            {audioTracks.map(track => <div className="mx-audio-item" key={track.id}><span><strong>{track.name}</strong><small>{formatTime(track.start)} · {formatTime(track.duration)}</small></span><button onClick={() => setAudioTracks(current => current.filter(item => item.id !== track.id))}>×</button></div>)}
            <div className="mx-panel-title">Background music</div>
            {music ? <div><strong>{music.name}</strong><button onClick={() => setMusic(null)}>Remove</button></div> : <button onClick={() => musicInput.current?.click()}>+ Add Music</button>}
            <label>Music volume <input type="range" min="0" max="1" step="0.01" value={settings.musicVolume} onChange={event => setSettings(value => ({ ...value, musicVolume: Number(event.target.value) }))} /></label>
          </div>
          </>}
        </aside>

        <main className="mx-center">
          <div ref={viewer} className={`mx-viewer ${previewLarge ? 'mx-viewer-large' : ''}`}>
            {isPreviewFullscreen && <button className="mx-exit-fullscreen" onClick={togglePreviewFullscreen}>← Exit Fullscreen (Esc)</button>}
            {active && selected ? selected.kind === 'image'
              ? <img ref={preview} src={fileUrl(selected.path)} alt="Selected scene" onLoad={() => window.setTimeout(updatePreviewFrame, 0)} style={{ objectFit: settings.framing === 'fill' ? 'cover' : 'contain', filter: `brightness(${1 + Number(selected.brightness || 0)}) contrast(${Number(selected.contrast || 1)}) saturate(${Number(selected.saturation ?? 1)})`, transform: `rotate(${Number(selected.rotation || 0)}deg)`, maxWidth: [90,270].includes(Number(selected.rotation)) ? '70%' : '100%' }} />
              : <video ref={preview} key={`${selected.id}-${selected.trimStart}`} src={fileUrl(selected.path)} controls controlsList="nofullscreen" muted={Boolean(selected.muted)} playbackRate={Number(selected.speed || 1)} onDoubleClick={event => { event.preventDefault(); togglePreviewFullscreen(); }} style={{ objectFit: settings.framing === 'fill' ? 'cover' : 'contain', filter: `brightness(${1 + Number(selected.brightness || 0)}) contrast(${Number(selected.contrast || 1)}) saturate(${Number(selected.saturation ?? 1)})`, transform: `rotate(${Number(selected.rotation || 0)}deg)`, maxWidth: [90,270].includes(Number(selected.rotation)) ? '70%' : '100%' }} onLoadedMetadata={event => { const actualDuration = Number(event.currentTarget.duration); event.currentTarget.currentTime = Math.min(selected.trimStart || 0, Math.max(0, actualDuration - .1)); event.currentTarget.playbackRate = Number(selected.speed || 1); window.setTimeout(updatePreviewFrame, 0); if (Number.isFinite(actualDuration) && actualDuration > 0 && actualDuration > Number(selected.sourceDuration || 0) + 0.5) { patchScene(selected.id, { sourceDuration: actualDuration, duration: actualDuration, probeError: '', fit: settings.framing || 'contain' }); if (selected.libraryId) patchLibraryItem(selected.libraryId, { sourceDuration: actualDuration, duration: actualDuration, width: selected.width || 1920, height: selected.height || 1080, probeError: '' }); } else if (Number.isFinite(actualDuration) && actualDuration > 0 && (selected.probeError || !selected.sourceDuration)) { patchScene(selected.id, { sourceDuration: actualDuration, duration: actualDuration, probeError: '', fit: settings.framing || 'contain' }); } }} onTimeUpdate={event => { const local = Math.max(0, Number(event.currentTarget.currentTime) - Number(selected.trimStart || 0)) / Number(selected.speed || 1); setPlayheadTime(Math.min(totalDuration, sceneTimelineOffset(selected.id) + local)); if (Number(event.currentTarget.currentTime) >= Number(selected.trimStart || 0) + Number(selected.duration || 0) - .04) { event.currentTarget.pause(); finishCurrentScene(); } }} onPlay={() => { autoplayNextRef.current = false; advancingSceneRef.current = false; setIsPreviewPlaying(true); audioPreview.current?.play().catch(() => {}); }} onPause={() => { if (!autoplayNextRef.current) setIsPreviewPlaying(false); audioPreview.current?.pause(); }} onEnded={finishCurrentScene} onError={() => setProgress({ pct: 0, phase: `${selected.name} was added, but its codec cannot be previewed here. My Exporter will still try to convert it during export.` })} />
              : <div className="mx-empty-view"><strong>Your preview appears here</strong><span>Add videos or images to begin editing.</span></div>}
            {active && activeTimelineAudio && <audio ref={audioPreview} key="exporter-audio-preview" src={fileUrl(activeTimelineAudio.path)} preload="auto" />}
            {safeGuides && <div className="mx-safe-guides"><span /></div>}
            {watermarkEnabled && watermark && <div key={watermark.path || watermark.preview} className="mx-watermark-shell" title="Drag to move · drag the corner to resize" onPointerDown={beginWatermarkDrag} style={{ left: previewFrame.width ? previewFrame.left + previewFrame.width * Number(settings.watermarkX ?? 90) / 100 : `${Number(settings.watermarkX ?? 90)}%`, top: previewFrame.height ? previewFrame.top + previewFrame.height * Number(settings.watermarkY ?? 90) / 100 : `${Number(settings.watermarkY ?? 90)}%`, width: previewFrame.width ? previewFrame.width * Number(settings.watermarkScale || 16) / 100 : `${Number(settings.watermarkScale || 16)}%` }}><img className="mx-watermark-image" src={watermark.preview || fileUrl(watermark.path)} alt="Info Kids logo" draggable="false" onError={() => setWarning(`Logo could not be displayed from ${watermark.path || watermark.name}. Use Restore Info Kids Logo or import it again.`)} style={{ opacity: settings.watermarkOpacity ?? .85 }} /><button className="mx-watermark-resize" title="Drag to resize logo" onPointerDown={beginWatermarkResize}>↘</button></div>}

            {textOverlays.filter(item => playheadTime >= Number(item.start || 0) && playheadTime <= Number(item.end ?? totalDuration)).map(item => <div key={item.id} className={`mx-text-overlay shape-${item.shape || 'none'} ${selectedTextId === item.id ? 'selected' : ''}`} onPointerDown={event => beginTextDrag(event, item)} style={{ left: previewFrame.left + previewFrame.width * Number(item.x || 0) / 100, top: previewFrame.top + previewFrame.height * Number(item.y || 0) / 100, fontSize: `${Math.max(10, Number(item.fontSize || 64) * previewFrame.height / 1080)}px`, opacity: Number(item.opacity ?? .8), color: item.color || '#ffffff', fontFamily: item.fontFamily || 'Arial', textShadow: Number(item.depth || 0) ? `${Math.max(1, Number(item.depth) * previewFrame.height / 1080)}px ${Math.max(1, Number(item.depth) * previewFrame.height / 1080)}px 0 rgba(0,0,0,.8)` : 'none' }}>{item.text}</div>)}
            {previewCaption && !trackStates.captionsMuted && <div className={`mx-caption-preview ${settings.captionStyle || 'classic'}`} style={captionPreviewStyle}>{settings.captionStyle === 'karaoke' ? previewWords.map((word, index) => <span key={`${word}-${index}`} className={index <= previewWordIndex ? 'sung' : ''}>{word} </span>) : previewCaptionText}</div>}
            {captioning && (
              <div className="mx-caption-loading">
                <i />
                <strong>Generating captions</strong>
                <span>{progress.phase}</span>
                {progress.totalCount > 0 && (
                  <div className="mx-caption-loading-summary">
                    <span>Progress:</span>
                    <span>Processed {progress.completedCount || 0} of {progress.totalCount} clips</span>
                  </div>
                )}
                <div>
                  <b style={{ width: `${Math.max(4, progress.pct)}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* ── Dual Layout: Second Viewer (compare view) ── */}
          <div className="mx-dual-viewer">
            {(() => {
              const nextIdx = scenes.findIndex(s => s.id === selectedId) + 1;
              const nextScene = scenes[nextIdx];
              if (!nextScene) return <div className="mx-empty-view"><strong>No next scene</strong><span>Select a scene to compare with the next one.</span></div>;
              return nextScene.kind === 'image'
                ? <img src={fileUrl(nextScene.path)} alt="Next scene" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
                : <video src={fileUrl(nextScene.path)} muted controls controlsList="nofullscreen" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />;
            })()}
          </div>

          <div className="mx-player-tools"><div><button className="mx-play-button" onClick={togglePreviewPlayback} disabled={!selected || selected.kind !== 'video'}>{isPreviewPlaying ? '❚❚ Pause' : playbackMode === 'continuous' ? '▶ Play All Scenes' : '▶ Play This Scene'}</button><button className={playbackMode === 'scene' ? 'active' : ''} onClick={() => setPlaybackMode(value => value === 'continuous' ? 'scene' : 'continuous')}>{playbackMode === 'continuous' ? 'All Scenes: ON' : 'Scene by Scene: ON'}</button><button onClick={togglePreviewFullscreen}>⛶ Fullscreen Preview</button><button onClick={() => { setPreviewLarge(value => !value); window.setTimeout(updatePreviewFrame, 50); }}>{previewLarge ? 'Normal Preview' : 'Large Clear Preview'}</button><button onClick={razorCut} disabled={!selected && !selectedAudio && !selectedCaptionId}>✂ Razor Cut (S)</button><button onClick={detachSelectedAudio} disabled={!selected || selected.kind !== 'video' || !selected.hasAudio}>♫ Detach Audio</button><button onClick={mergeSelectedWithNext} disabled={!selected}>Merge Next</button><button onClick={duplicateScene} disabled={!selected}>Copy Scene</button>{advancedMode && <button onClick={() => setSafeGuides(value => !value)}>{safeGuides ? 'Hide Guides' : 'Show Safe Guides'}</button>}</div><span>{formatTime(playheadTime)} / {formatTime(totalDuration)}</span></div>
          <div className={`mx-master-meter ${isPreviewPlaying ? 'playing' : ''}`} title="Master audio level"><strong>MASTER</strong>{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ '--meter-index': index }} />)}<span>0 dB</span></div>
          <section className="mx-timeline" ref={timelineRef}>
            <div className="mx-filmora-toolstrip">
              <button title="Undo" onClick={() => restoreHistory(-1)}>↶</button><button title="Redo" onClick={() => restoreHistory(1)}>↷</button><i />
              <button title="Split at playhead" onClick={razorCut} disabled={!selected && !selectedAudio}>✂</button><button title="Delete selected" onClick={() => selectedAudio ? removeAudioTrack(selectedAudio.id) : selected && removeScene(selected.id)} disabled={!selected && !selectedAudio}>⌫</button><button title="Ripple delete" onClick={() => selected && removeScene(selected.id, true)} disabled={!selected}>⇤</button><i />
              <button title="Copy" onClick={() => selectedAudio ? copySelectedAudio() : copyScene()} disabled={!selected && !selectedAudio}>⧉</button><button title="Paste" onClick={() => audioClipboard ? pasteCopiedAudio() : pasteScene()} disabled={!audioClipboard && !sceneClipboard}>▣</button><button title="Crop to fill" onClick={() => { setSettings(value => ({ ...value, framing: 'fill' })); setScenes(current => current.map(scene => ({ ...scene, fit: 'fill' }))); }}>⌗</button><button title="Rotate 90 degrees" onClick={() => selected && patchScene(selected.id, { rotation: (Number(selected.rotation || 0) + 90) % 360 })} disabled={!selected}>↻</button><i />
              <button className={snapEnabled ? 'active' : ''} title="Timeline snapping" onClick={() => setSnapEnabled(value => !value)}>🧲</button><button className={rippleEnabled ? 'active' : ''} title="Ripple editing" onClick={() => setRippleEnabled(value => !value)}>≋</button><button title="Add voice or sound" onClick={pickAudioTracks}>●</button><button title="Speech to text captions" onClick={generateCaptions} disabled={!scenes.length || captioning}>CC</button><button className="mx-stutter-cutter-btn" title="🪄 AI Stutter Cutter — detect and cut word stutter/disturbances" onClick={() => { scanForStutters(); setStutterCutterOpen(true); }} disabled={!captions.length}>🪄 AI Stutter Cutter</button>
              <span /><button title="Fit timeline" onClick={() => setTimelineZoom(1)}>Fit</button><button title="Zoom out" onClick={() => setTimelineZoom(value => Math.max(1, value - 1))}>−</button><input aria-label="Timeline zoom" type="range" min="1" max="50" value={timelineZoom} onChange={event => setTimelineZoom(Number(event.target.value))} /><button title="Zoom in" onClick={() => setTimelineZoom(value => Math.min(50, value + 1))}>+</button>
            </div>
            <div className="mx-timeline-head"><div><span className="mx-panel-title">Complete Video Timeline</span><small>Every file stays as one complete scene. Copy detached audio, move the gold playhead, then paste it exactly there.</small></div><div className="mx-timeline-actions"><button className="mx-stutter-cutter-action-btn" style={{ background: 'linear-gradient(135deg, #a855f7, #6366f1)', color: '#fff', border: 'none', fontWeight: 'bold' }} onClick={() => { scanForStutters(); setStutterCutterOpen(true); }} disabled={!captions.length}>🪄 AI Stutter Cutter</button><button onClick={() => setTimelineExpanded(value => !value)}>{timelineExpanded ? 'Balanced Layout' : 'Expand Timeline'}</button><button onClick={() => restoreHistory(-1)} disabled={historyVersion >= 0 && historyIndexRef.current <= 0}>↶ Undo</button><button onClick={() => restoreHistory(1)} disabled={historyVersion >= 0 && historyIndexRef.current >= historyRef.current.length - 1}>↷ Redo</button><button onClick={copySelectedAudio} disabled={!selectedAudio}>⧉ Copy Audio</button><button className={audioClipboard ? 'active' : ''} onClick={pasteCopiedAudio} disabled={!audioClipboard}>▣ Paste at Stick</button><button className={rippleEnabled ? 'active' : ''} onClick={() => setRippleEnabled(value => !value)}>Ripple</button><button className={snapEnabled ? 'active' : ''} onClick={() => setSnapEnabled(value => !value)}>🧲 Snap</button><button onClick={() => setTimelineZoom(1)}>Fit</button><button onClick={() => { setTimelineExpanded(true); setTimelineZoom(25); }}>Audio Focus</button><button title="Zoom out" onClick={() => setTimelineZoom(value => Math.max(1, value - 1))}>−</button><label>Zoom {timelineZoom.toFixed(1)}×<input type="range" min="1" max="50" step="1" value={timelineZoom} onChange={event => setTimelineZoom(Number(event.target.value))} /></label><button title="Zoom in" onClick={() => setTimelineZoom(value => Math.min(50, value + 1))}>+</button><span>{formatTime(totalDuration)}</span></div></div>
            <div className={`mx-timeline-check ${timelineIssues.length ? 'bad' : 'good'}`}>{timelineIssues.length ? `Check timeline: ${timelineIssues[0]}` : 'Timeline check: video, audio and captions are placed correctly.'}</div>
            <div className="mx-scrubber" onPointerDown={event => { setDraggingPlayhead(true); event.currentTarget.setPointerCapture(event.pointerId); seekTimelineFromPointer(event); }} onPointerMove={event => { if (draggingPlayhead) seekTimelineFromPointer(event); }} onPointerUp={() => setDraggingPlayhead(false)}>
              <div className="mx-scrub-track"><div className="mx-scrub-line" /><div className="mx-scrub-head" style={{ left: `${totalDuration ? (playheadTime / totalDuration) * 100 : 0}%` }}><span>{formatTime(playheadTime)}</span></div></div>
              <div className="mx-ruler"><span>0:00</span><span>{formatTime(totalDuration / 2)}</span><span>{formatTime(totalDuration)}</span></div>
            </div>
            <div ref={timelineSurface} className="mx-multitrack" style={{ width: `${timelineZoom * 100}%` }} onPointerDown={event => { if (event.target.closest('button,.mx-audio-clip,.mx-caption-clip,.mx-trim-handle')) return; setDraggingPlayhead(true); setSelectedId(''); event.currentTarget.setPointerCapture(event.pointerId); seekTimelineFromPointer(event); }} onPointerMove={event => { if (draggingPlayhead) seekTimelineFromPointer(event); }} onPointerUp={() => setDraggingPlayhead(false)}>
              <div className="mx-playhead-area"><div className="mx-vertical-playhead" style={{ left: `${totalDuration ? (playheadTime / totalDuration) * 100 : 0}%` }}><span /><button className="mx-playhead-scissors" title="Drag to position · click to cut selected video or detached audio" onPointerDown={beginScissorDrag} onPointerMove={moveScissorDrag} onPointerUp={endScissorDrag} onClick={cutFromScissor}>✂</button></div></div>
              <div className={`mx-track-row ${expandedTimelineTrack === 'video' ? 'track-expanded' : ''}`}>
                <div className="mx-track-label"><strong>Video</strong><button className="mx-track-size" title="Enlarge or reduce Video track" onClick={() => setExpandedTimelineTrack(value => value === 'video' ? '' : 'video')}>{expandedTimelineTrack === 'video' ? '▾' : '▴'}</button><button onClick={() => setTrackStates(value => ({ ...value, videoLocked: !value.videoLocked }))}>{trackStates.videoLocked ? '🔒' : '🔓'}</button></div>
                <div className="mx-position-lane mx-video-lane">{scenes.map((scene, index) => { if (scene.kind === 'image') return null; const sceneDuration = Number(scene.duration || 0) / Number(scene.speed || 1); return <button key={scene.id} draggable={!trackStates.videoLocked} title="Click to select · right-click for editing options" className={`mx-clip ${selectedIds.includes(scene.id) ? 'active' : ''} ${draggingId === scene.id ? 'dragging' : ''} ${scene.mergeGroup ? 'merged' : ''}`} style={{ left: `${totalDuration ? sceneTimelineOffset(scene.id) / totalDuration * 100 : 0}%`, width: `${totalDuration ? sceneDuration / totalDuration * 100 : 100}%` }} onDragStart={() => setDraggingId(scene.id)} onDragOver={event => event.preventDefault()} onDrop={() => { if (draggingId && !trackStates.videoLocked) moveSceneTo(draggingId, scene.id); setDraggingId(''); playAllSessionRef.current = false; }} onDragEnd={() => setDraggingId('')} onDoubleClick={() => removeScene(scene.id)} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); playAllSessionRef.current = false; selectScene(scene.id, event.ctrlKey || event.metaKey); setPlayheadTime(sceneTimelineOffset(scene.id)); setContextMenu({ type: 'video', id: scene.id, name: scene.name, x: Math.min(event.clientX, window.innerWidth - 235), y: Math.min(event.clientY, window.innerHeight - 360) }); }} onClick={event => { playAllSessionRef.current = false; selectScene(scene.id, event.ctrlKey || event.metaKey); setPlayheadTime(sceneTimelineOffset(scene.id)); }}><span>{index + 1}</span><strong>{scene.name}</strong><small>{formatTime(sceneDuration)}</small></button>; })}</div>
              </div>
              <div className={`mx-track-row mx-image-row ${expandedTimelineTrack === 'images' ? 'track-expanded' : ''}`}>
                <div className="mx-track-label"><strong>Images</strong><button className="mx-track-size" title="Enlarge or reduce Images track" onClick={() => setExpandedTimelineTrack(value => value === 'images' ? '' : 'images')}>{expandedTimelineTrack === 'images' ? '▾' : '▴'}</button><span>▧</span></div>
                <div className="mx-position-lane mx-video-lane mx-image-lane">{scenes.map((scene, index) => { if (scene.kind !== 'image') return null; const sceneDuration = Number(scene.duration || 0); return <button key={scene.id} draggable={!trackStates.videoLocked} title="Image scene · click to select · right-click for options" className={`mx-clip mx-image-clip ${selectedIds.includes(scene.id) ? 'active' : ''}`} style={{ left: `${totalDuration ? sceneTimelineOffset(scene.id) / totalDuration * 100 : 0}%`, width: `${totalDuration ? sceneDuration / totalDuration * 100 : 100}%` }} onClick={event => { selectScene(scene.id, event.ctrlKey || event.metaKey); setPlayheadTime(sceneTimelineOffset(scene.id)); }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); selectScene(scene.id, event.ctrlKey || event.metaKey); setPlayheadTime(sceneTimelineOffset(scene.id)); setContextMenu({ type: 'video', id: scene.id, name: scene.name, x: Math.min(event.clientX, window.innerWidth - 235), y: Math.min(event.clientY, window.innerHeight - 360) }); }}><img src={fileUrl(scene.path)} alt="" /><span>{index + 1}</span><strong>{scene.name}</strong><small>{formatTime(sceneDuration)}</small></button>; })}</div>
              </div>
              <div className={`mx-track-row ${expandedTimelineTrack === 'audio' ? 'track-expanded' : ''}`}>
                <div className="mx-track-label"><strong>Audio</strong><button className="mx-track-size" title="Enlarge or reduce Audio track" onClick={() => setExpandedTimelineTrack(value => value === 'audio' ? '' : 'audio')}>{expandedTimelineTrack === 'audio' ? '▾' : '▴'}</button><button onClick={() => setTrackStates(value => ({ ...value, audioMuted: !value.audioMuted }))}>{trackStates.audioMuted ? '🔇' : '🔊'}</button><button onClick={() => setTrackStates(value => ({ ...value, audioLocked: !value.audioLocked }))}>{trackStates.audioLocked ? '🔒' : '🔓'}</button></div>
                <div className="mx-position-lane">{audioTracks.map(track => <div role="button" tabIndex="0" key={track.id} className={`mx-audio-clip ${selectedAudioId === track.id ? 'active' : ''} ${audioCutSelectionModeId === track.id ? 'cut-selecting' : ''}`} style={{ left: `${totalDuration ? (track.start / totalDuration) * 100 : 0}%`, width: `${totalDuration ? Math.max(1, (track.duration / totalDuration) * 100) : 20}%` }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setSelectedAudioId(track.id); setSelectedId(''); setSelectedCaptionId(''); setContextMenu({ type: 'audio', id: track.id, name: track.name, x: Math.min(event.clientX, window.innerWidth - 235), y: Math.min(event.clientY, window.innerHeight - 390) }); }} onPointerDown={event => beginAudioMove(event, track)} onClick={event => selectAudioAtPointer(event, track)}><span className="mx-trim-handle left" title="Drag to trim audio start" onPointerDown={event => beginAudioTrim(event, track, 'left')} />{audioSelection?.trackId === track.id && <span className="mx-audio-selection" style={{ left: `${Math.max(0, (audioSelection.start - Number(track.start)) / Number(track.duration) * 100)}%`, width: `${Math.max(1, (audioSelection.end - audioSelection.start) / Number(track.duration) * 100)}%` }}>{audioSelection.awaitingEnd ? <b>START — CLICK END</b> : <><b>SELECTED CUT</b><button className="mx-selection-delete-btn" title="Delete selected audio part" onClick={event => { event.preventDefault(); event.stopPropagation(); removeHighlightedAudio(); }} style={{ marginLeft: '6px', padding: '2px 6px', background: '#ff4d4d', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold', cursor: 'pointer', pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>🗑 Delete Part</button></>}</span>}<div className="mx-waveform" aria-hidden="true">{track.waveform?.map((peak, index) => <i key={index} style={{ height: `${Math.max(8, peak * 100)}%` }} />)}</div><strong>{track.name}</strong><small>{audioCutSelectionModeId === track.id ? 'CUT MODE: click START, then END' : track.waveformLoading ? 'Building waveform…' : `${formatTime(track.trimStart)} → ${formatTime(track.trimStart + track.duration)} · ${Number(track.duration).toFixed(1)}s`}</small><button className="mx-audio-delete" title="Delete this detached or cut audio piece" onClick={event => { event.stopPropagation(); removeAudioTrack(track.id); }}>Delete</button><span className="mx-trim-handle right" title="Drag to trim audio end" onPointerDown={event => beginAudioTrim(event, track, 'right')} /></div>)}</div>
              </div>
              <div className={`mx-track-row ${expandedTimelineTrack === 'captions' ? 'track-expanded' : ''}`}>
                <div className="mx-track-label"><strong>Captions</strong><button className="mx-track-size" title="Enlarge or reduce Captions track" onClick={() => setExpandedTimelineTrack(value => value === 'captions' ? '' : 'captions')}>{expandedTimelineTrack === 'captions' ? '▾' : '▴'}</button><button onClick={() => setTrackStates(value => ({ ...value, captionsMuted: !value.captionsMuted }))}>{trackStates.captionsMuted ? '🙈' : 'CC'}</button><button onClick={() => setTrackStates(value => ({ ...value, captionsLocked: !value.captionsLocked }))}>{trackStates.captionsLocked ? '🔒' : '🔓'}</button></div>
                <div className="mx-position-lane">{!trackStates.captionsMuted && captions.map(item => <div role="button" tabIndex="0" key={item.id} className={`mx-caption-clip ${selectedCaptionId === item.id ? 'active' : ''}`} onClick={() => { setSelectedCaptionId(item.id); setSelectedId(''); setSelectedAudioId(''); setPlayheadTime(item.start); }} style={{ left: `${totalDuration ? (item.start / totalDuration) * 100 : 0}%`, width: `${totalDuration ? Math.max(2, ((item.end - item.start) / totalDuration) * 100) : 5}%` }}>{item.text}</div>)}</div>
              </div>
            </div>

            {/* Custom horizontal timeline scroller / zoomer */}
            <div className="mx-custom-scroller-container" style={{ position: 'sticky', left: 0, width: '100%', zIndex: 40 }}>
              <div className="mx-custom-scroller-track" onPointerDown={handleTrackClick}>
                <div className="mx-scroller-playhead-indicator" style={{ left: `${totalDuration ? (playheadTime / totalDuration) * 100 : 0}%` }} />
                <div className="mx-custom-scroller-thumb" style={{ left: `${thumbLeftPercent}%`, width: `${thumbPercent}%` }} onPointerDown={beginScrollDrag}>
                  <span className="mx-scroller-handle-left" title="Drag left knob to zoom timeline" onPointerDown={event => beginZoomDrag(event, 'left')} />
                  <span className="mx-scroller-handle-right" title="Drag right knob to zoom timeline" onPointerDown={event => beginZoomDrag(event, 'right')} />
                </div>
              </div>
            </div>

            {selected && <div className="mx-trim"><div><strong>{selected.name}</strong><small>{selected.width ? `${selected.width}×${selected.height}` : 'Still image'} {selected.hasAudio ? '· audio' : ''}</small></div><label>Start<input type="number" min="0" max={selected.sourceDuration} step="0.1" value={selected.trimStart} onChange={event => { const start = Math.max(0, Number(event.target.value)); patchScene(selected.id, { trimStart: start, duration: Math.min(selected.duration, Math.max(.1, selected.sourceDuration - start)) }); setCaptions([]); }} /></label><label>Duration<input type="number" min="0.1" max={Math.max(.1, selected.sourceDuration - selected.trimStart)} step="0.1" value={Number(selected.duration).toFixed(1)} onChange={event => { patchScene(selected.id, { duration: Math.max(.1, Number(event.target.value)) }); setCaptions([]); }} /></label><label>Volume<input type="range" min="0" max="2" step="0.05" value={selected.volume} disabled={!selected.hasAudio || selected.muted} onChange={event => patchScene(selected.id, { volume: Number(event.target.value) })} /></label><button onClick={() => patchScene(selected.id, { muted: !selected.muted })}>{selected.muted ? 'Unmute' : 'Mute'}</button><button onClick={() => moveScene(selected.id, -1)}>←</button><button onClick={() => moveScene(selected.id, 1)}>→</button><button onClick={duplicateScene}>Duplicate</button><button className="mx-danger" onClick={() => removeScene(selected.id)}>Remove</button></div>}
            {selectedAudio && <div className="mx-audio-edit"><strong>{selectedAudio.name}</strong>{audioSelection?.trackId === selectedAudio.id && <div className="mx-selection-summary"><b>Selected cut</b><span>{formatTime(audioSelection.start)} → {formatTime(audioSelection.end)} · {(audioSelection.end - audioSelection.start).toFixed(2)}s</span></div>}<audio ref={audioSelectionPreview} className="mx-cut-preview" src={fileUrl(selectedAudio.path)} controls preload="metadata" onTimeUpdate={event => { if (audioSelection?.trackId !== selectedAudio.id) return; const sourceEnd = Number(selectedAudio.trimStart || 0) + (audioSelection.end - Number(selectedAudio.start)) * Number(selectedAudio.speed || 1); if (event.currentTarget.currentTime >= sourceEnd) event.currentTarget.pause(); }} /><label>Timeline start<input type="number" min="0" max={totalDuration} step="0.1" value={selectedAudio.start} disabled={trackStates.audioLocked || Boolean(selectedAudio.detachedFromSceneId)} onChange={event => patchAudioTrack(selectedAudio.id, { start: Math.max(0, Number(event.target.value)) })} /></label><label>Trim start<input type="number" min="0" max={selectedAudio.sourceDuration || 9999} step="0.1" value={selectedAudio.trimStart} disabled={trackStates.audioLocked} onChange={event => patchAudioTrack(selectedAudio.id, { trimStart: Math.max(0, Number(event.target.value)) })} /></label><label>Length<input type="number" min="0.1" max={selectedAudio.sourceDuration || 9999} step="0.1" value={selectedAudio.duration} disabled={trackStates.audioLocked} onChange={event => patchAudioTrack(selectedAudio.id, { duration: Math.max(.1, Number(event.target.value)) })} /></label><label>Volume<input type="range" min="0" max="2" step="0.05" value={selectedAudio.volume} disabled={trackStates.audioLocked} onChange={event => patchAudioTrack(selectedAudio.id, { volume: Number(event.target.value) })} /></label><button onClick={() => setAudioSelectionEdge('start')}>Set Selection Start</button><button onClick={() => setAudioSelectionEdge('end')}>Set Selection End</button><button className="mx-preview-cut" onClick={previewAudioSelection} disabled={audioSelection?.trackId !== selectedAudio.id}>▶ Preview Selected Cut</button><button onClick={() => patchAudioTrack(selectedAudio.id, { muted: !selectedAudio.muted })}>{selectedAudio.muted ? 'Unmute' : 'Mute'}</button><button onClick={razorCut}>✂ Cut at Stick</button><button onClick={() => trimSelectedAudioToPlayhead('start')}>Trim Start to Stick</button><button onClick={() => trimSelectedAudioToPlayhead('end')}>Trim End to Stick</button><button onClick={() => trimSelectedAudioStart(.1)}>Start −0.1s</button><button onClick={() => trimSelectedAudioEnd(.1)}>End −0.1s</button><button className="mx-danger" onClick={() => removeAudioTrack(selectedAudio.id)}>Delete Audio</button></div>}
            {selectedAudio && <div className="mx-simple-audio-cut"><div><b>Detached Audio — Controlled Cut</b><span>Right-click audio → Cut Selected Position Audio. Then click START and END. Removal closes the empty space.</span></div><button onClick={() => beginCutPositionSelection(selectedAudio.id)} className={audioCutSelectionModeId === selectedAudio.id ? 'active' : ''}>1. Cut Selected Position Audio</button><button onClick={previewAudioSelection} disabled={audioSelection?.trackId !== selectedAudio.id || audioSelection?.awaitingEnd}>▶ Preview Selected Audio</button><button className="remove" onClick={removeHighlightedAudio} disabled={audioSelection?.trackId !== selectedAudio.id || audioSelection?.awaitingEnd}>2. Remove Selected Audio</button><button className="reattach" onClick={reattachSelectedAudio}>🔗 Reattach Audio to Video</button></div>}
          </section>
        </main>

        <aside className="mx-inspector">
          <button className="mx-side-panel-close" title="Hide editing controls" onClick={() => setOpenSidePanel('')}>Hide ›</button>
          <div className="mx-panel-title">Crop video & save locally</div>
          <div className="mx-inspector-note">Handles videos larger than 2 GB from their local path. This does not add the file to the timeline and does not use the normal exporter.</div>
          <button className="mx-wide mx-crop-pick" onClick={pickCropVideo} disabled={cropSaving}>{cropSource ? 'Choose Another Large Video' : 'Choose Large Video to Crop'}</button>
          {cropSource && <div className="mx-direct-crop">
            <strong>{cropSource.name}</strong><small>{cropSource.width}×{cropSource.height} · {formatTime(cropSource.duration)} · source bitrate preserved: {cropSource.videoBitrate ? `${(cropSource.videoBitrate / 1000000).toFixed(2)} Mbps` : 'automatic high quality'} · {cropSource.frameRate ? `${cropSource.frameRate.toFixed(2)} fps` : 'original fps'}</small>
            <div className="mx-crop-preview"><video ref={cropPreview} src={fileUrl(cropSource.path)} muted controls preload="metadata" /><span style={{ left: `${cropRect.x}%`, top: `${cropRect.y}%`, width: `${cropRect.width}%`, height: `${cropRect.height}%` }} /></div>
            <label>Left — {cropRect.x}%<input type="range" min="0" max={Math.max(0, 100 - cropRect.width)} value={cropRect.x} onChange={event => setCropRect(value => ({ ...value, x: Number(event.target.value) }))} /></label>
            <label>Top — {cropRect.y}%<input type="range" min="0" max={Math.max(0, 100 - cropRect.height)} value={cropRect.y} onChange={event => setCropRect(value => ({ ...value, y: Number(event.target.value) }))} /></label>
            <label>Crop width — {cropRect.width}%<input type="range" min="10" max={100 - cropRect.x} value={cropRect.width} onChange={event => setCropRect(value => ({ ...value, width: Number(event.target.value) }))} /></label>
            <label>Crop height — {cropRect.height}%<input type="range" min="10" max={100 - cropRect.y} value={cropRect.height} onChange={event => setCropRect(value => ({ ...value, height: Number(event.target.value) }))} /></label>
            <div className="mx-crop-presets"><button onClick={() => setCropRect({ x: 0, y: 0, width: 100, height: 100 })}>Full</button><button onClick={() => setCropRect({ x: 12.5, y: 0, width: 75, height: 100 })}>4:3 Center</button><button onClick={() => setCropRect({ x: 21, y: 0, width: 58, height: 100 })}>Square Center</button></div>
            <label>How many parts?<select value={cropPartCount} onChange={event => changeCropPartCount(event.target.value)}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} part{index ? 's' : ''}</option>)}</select></label>
            <label>Simultaneous saves<select value={cropParallelExports} onChange={event => setCropParallelExports(Number(event.target.value))}><option value="1">1 at a time — safest</option><option value="2">2 at once — recommended</option><option value="3">3 at once — powerful computer</option></select></label>
            <div className="mx-crop-parts">{cropParts.map((part, index) => <div key={index}><b>Part {index + 1}</b><span>{formatTime(part.start)} → {formatTime(part.end)} · {formatTime(part.end - part.start)}</span><button onClick={() => markCropPart(index, 'start')}>Mark START at Preview</button><button onClick={() => markCropPart(index, 'end')}>Mark END at Preview</button><label>Start<input type="number" min="0" max={cropSource.duration} step=".01" value={Number(part.start).toFixed(2)} onChange={event => setCropParts(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, start: Math.max(0, Number(event.target.value)) } : item))} /></label><label>End<input type="number" min="0" max={cropSource.duration} step=".01" value={Number(part.end).toFixed(2)} onChange={event => setCropParts(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, end: Math.min(cropSource.duration, Number(event.target.value)) } : item))} /></label></div>)}</div>
            <button className="mx-wide mx-crop-save" onClick={saveCroppedVideo} disabled={cropSaving}>{cropSaving ? `${progress.pct}% Saving Locally…` : cropPartCount > 1 ? `Save All ${cropPartCount} Parts` : 'Save Cropped Video Directly'}</button>
          </div>}
          <div className="mx-divider" />
          <div className="mx-panel-title">Export settings</div>
          {advancedMode && <div className="mx-export-presets"><button onClick={() => applyExportPreset('youtube4k')}>YouTube 4K</button><button onClick={() => applyExportPreset('cinematic')}>Cinema</button><button onClick={() => applyExportPreset('shorts')}>Shorts</button><button onClick={() => applyExportPreset('reels')}>Reels</button><button onClick={() => applyExportPreset('smooth')}>60 FPS</button></div>}
          <label>Canvas<select value={settings.resolution} onChange={event => setSettings(value => ({ ...value, resolution: event.target.value }))}><option value="1080p">Full HD 1920×1080</option><option value="1440p">2K 2560×1440</option><option value="4k">4K UHD 3840×2160</option><option value="vertical">Vertical 1080×1920</option><option value="square">Square 1080×1080</option></select></label>
          {advancedMode && <label>Frame rate<select value={settings.fps} onChange={event => setSettings(value => ({ ...value, fps: Number(event.target.value) }))}><option value="24">24 fps — cinematic</option><option value="30">30 fps — standard</option><option value="60">60 fps — smooth</option></select></label>}
          {advancedMode && <label>Quality<select value={settings.quality} onChange={event => setSettings(value => ({ ...value, quality: event.target.value }))}><option value="maximum">Maximum quality</option><option value="balanced">Balanced</option><option value="small">Smaller file</option></select></label>}
          {advancedMode && <>
          <div className="mx-divider" />
          <div className="mx-panel-title">Advanced scene tools</div>
          {!selected && <div className="mx-inspector-note">Select a scene to unlock advanced controls.</div>}
          {selected && <>
            <div className="mx-presets"><button onClick={() => applyVisualPreset('natural')}>Natural</button><button onClick={() => applyVisualPreset('vivid')}>Vivid</button><button onClick={() => applyVisualPreset('cinematic')}>Cinema</button><button onClick={() => applyVisualPreset('soft')}>Soft</button><button onClick={() => applyVisualPreset('mono')}>Mono</button></div>
            <label>Speed — {Number(selected.speed || 1).toFixed(2)}×<input type="range" min="0.5" max="2" step="0.05" value={selected.speed || 1} disabled={selected.kind === 'image'} onChange={event => { patchScene(selected.id, { speed: Number(event.target.value) }); setCaptions([]); }} /></label>
            <label>Project framing<select value={settings.framing || 'contain'} onChange={event => { const framing = event.target.value; setSettings(value => ({ ...value, framing })); setScenes(current => current.map(scene => ({ ...scene, fit: framing }))); setMediaLibrary(current => current.map(item => ({ ...item, fit: framing }))); window.setTimeout(updatePreviewFrame, 50); }}><option value="contain">Full Frame — show complete video</option><option value="fill">Cinematic Crop — fill screen</option></select></label>
            <label>Rotation<select value={selected.rotation || 0} onChange={event => patchScene(selected.id, { rotation: Number(event.target.value) })}><option value="0">Original</option><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">90° counter-clockwise</option></select></label>
            <label>Brightness — {Number(selected.brightness || 0).toFixed(2)}<input type="range" min="-0.5" max="0.5" step="0.01" value={selected.brightness || 0} onChange={event => patchScene(selected.id, { brightness: Number(event.target.value) })} /></label>
            <label>Contrast — {Number(selected.contrast || 1).toFixed(2)}<input type="range" min="0.5" max="1.8" step="0.01" value={selected.contrast || 1} onChange={event => patchScene(selected.id, { contrast: Number(event.target.value) })} /></label>
            <label>Saturation — {Number(selected.saturation ?? 1).toFixed(2)}<input type="range" min="0" max="2" step="0.01" value={selected.saturation ?? 1} onChange={event => patchScene(selected.id, { saturation: Number(event.target.value) })} /></label>
            <label>Fade in/out — {Number(selected.fade || 0).toFixed(1)}s<input type="range" min="0" max="1.5" step="0.1" value={selected.fade || 0} onChange={event => patchScene(selected.id, { fade: Number(event.target.value) })} /></label>
            <label className="mx-check"><input type="checkbox" checked={Boolean(selected.noiseReduction)} disabled={!selected.hasAudio} onChange={event => patchScene(selected.id, { noiseReduction: event.target.checked })} /> Studio noise cleanup</label>
            <label className="mx-check"><input type="checkbox" checked={Boolean(selected.normalizeAudio)} disabled={!selected.hasAudio} onChange={event => patchScene(selected.id, { normalizeAudio: event.target.checked })} /> Broadcast loudness normalization</label>
          </>}
          </>}
          <div className="mx-divider" />
          <div className="mx-panel-title">Text and titles</div>
          <button className="mx-wide" onClick={addTextOverlay}>+ Add Text</button>
          {selectedText && <div className="mx-text-controls"><label>Text<textarea value={selectedText.text} onChange={event => patchTextOverlay(selectedText.id, { text: event.target.value })} /></label><label>Font<select value={selectedText.fontFamily} onChange={event => patchTextOverlay(selectedText.id, { fontFamily: event.target.value })}><option>Arial</option><option>Segoe UI</option><option>Georgia</option><option>Impact</option><option>Comic Sans MS</option></select></label><label>Color<input type="color" value={selectedText.color} onChange={event => patchTextOverlay(selectedText.id, { color: event.target.value })} /></label><label>Shape<select value={selectedText.shape} onChange={event => patchTextOverlay(selectedText.id, { shape: event.target.value })}><option value="none">No shape</option><option value="box">Box</option><option value="pill">Rounded pill</option><option value="badge">Badge</option></select></label><label>Size — {selectedText.fontSize}<input type="range" min="20" max="180" step="2" value={selectedText.fontSize} onChange={event => patchTextOverlay(selectedText.id, { fontSize: Number(event.target.value) })} /></label><label>Opacity — {Math.round(selectedText.opacity * 100)}%<input type="range" min=".2" max="1" step=".05" value={selectedText.opacity} onChange={event => patchTextOverlay(selectedText.id, { opacity: Number(event.target.value) })} /></label><label>3D depth — {selectedText.depth}<input type="range" min="0" max="16" step="1" value={selectedText.depth} onChange={event => patchTextOverlay(selectedText.id, { depth: Number(event.target.value) })} /></label><button className="mx-danger" onClick={() => { setTextOverlays(current => current.filter(item => item.id !== selectedText.id)); setSelectedTextId(''); }}>Delete Text</button></div>}
          <div className="mx-divider" />
          <div className="mx-panel-title">Logo watermark</div>
          <button className={`mx-wide mx-logo-enable ${watermarkEnabled ? 'active' : ''}`} onClick={() => { const next = !watermarkEnabled; if (next) { setWatermark(DEFAULT_LOGO); setWatermarkPreset('bottom-right'); } setWatermarkEnabled(next); }}>{watermarkEnabled ? '✓ Info Kids Logo Enabled' : 'Enable Info Kids Logo'}</button>
          <button className="mx-wide mx-cover-flow" onClick={coverFlowWatermark}>Cover Flow Watermark</button>
          {watermark ? <div className="mx-watermark-control"><span>{watermark.name}</span><button className="mx-danger" onClick={() => { setWatermark(null); setWatermarkEnabled(false); }}>Delete Logo</button></div> : <><button className="mx-wide" onClick={() => { setWatermark(DEFAULT_LOGO); setWatermarkEnabled(true); setWatermarkPreset('bottom-right'); }}>Restore Info Kids Logo</button><button className="mx-wide" onClick={() => watermarkInput.current?.click()}>+ Import another logo</button></>}
          {watermark && <><div className="mx-inspector-note">Drag the logo directly on the preview. Transparent PNG or WebP blends cleanly without changing the video background.</div><label>Quick position<select value={settings.watermarkPosition || 'top-right'} onChange={event => setWatermarkPreset(event.target.value)}><option value="custom">Custom — dragged position</option><option value="top-right">Top right</option><option value="top-left">Top left</option><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="center">Center</option></select></label><label>Logo size — {Math.round(settings.watermarkScale || 16)}%<input type="range" min="5" max="40" step="1" value={settings.watermarkScale || 16} onChange={event => setSettings(value => ({ ...value, watermarkScale: Number(event.target.value) }))} /></label><label>Opacity — {Math.round((settings.watermarkOpacity ?? .85) * 100)}%<input type="range" min="0.1" max="1" step="0.05" value={settings.watermarkOpacity ?? .85} onChange={event => setSettings(value => ({ ...value, watermarkOpacity: Number(event.target.value) }))} /></label></>}
          <div className="mx-divider" />
          <div className="mx-panel-title">Translate video voice</div>
          <div className="mx-inspector-note">Select a video on the timeline. Its spoken audio will be translated and replaced while keeping every sentence synchronized to the original picture.</div>
          <label>Voice language<select value={voiceLanguage} onChange={event => setVoiceLanguage(event.target.value)}><option value="en">English / Indian English</option><option value="hi">Hindi</option><option value="te">Telugu</option><option value="ta">Tamil</option><option value="kn">Kannada</option><option value="ml">Malayalam</option></select></label>
           <button className="mx-wide mx-voice-change" onClick={changeSelectedVideoVoice} disabled={!selected || selected.kind !== 'video' || voiceChanging}>{voiceChanging ? 'Translating and synchronizing voice…' : `Change Selected Video Voice to ${CAPTION_LANGUAGE_NAMES[voiceLanguage]}`}</button>
          <div className="mx-divider" />
          <div className="mx-panel-title">Vocal Morphing Studio</div>
          <div className="mx-inspector-note">Morph the timbre of any audio track on the timeline to match another voice profile offline.</div>
          <label>Target voice timbre<select value={targetMorphVoice} onChange={event => setTargetMorphVoice(event.target.value)}><option value="sc3">SC3 Default Voice</option><option value="female">Standard Female Voice</option><option value="male">Standard Male Voice</option></select></label>
          <button className="mx-wide" onClick={morphSelectedAudio} disabled={!selectedAudio || audioMorphing}>{audioMorphing ? 'Morphing voice timbre...' : 'Morph Selected Audio Timbre'}</button>
          <div className="mx-divider" />
          <div className="mx-panel-title">Automatic captions</div>
          <label>Caption language<select value={captionLanguage} onChange={event => setCaptionLanguage(event.target.value)}><option value="auto">Same as spoken video / detect</option><option value="en">English / Indian English</option><option value="te">Telugu</option><option value="hi">Hindi</option><option value="ta">Tamil</option><option value="kn">Kannada</option><option value="ml">Malayalam</option></select></label>
          {detectedCaptionLanguage && <div className="mx-caption-source"><strong>Caption Burner Local AI</strong><span>Detected: {detectedCaptionLanguage}</span></div>}
          <div className="mx-caption-actions"><button className="mx-wide" onClick={generateCaptions} disabled={!scenes.length || captioning || exporting}>{captioning ? 'Generating captions…' : captions.length ? `Generate Captions Again (${captions.length})` : 'Generate Captions'}</button><div className="mx-export-dropdown-container" style={{ width: '100%' }}><button className="mx-wide mx-caption-export" onClick={() => setExportDropdownOpen(prev => !prev)} disabled={!scenes.length || captioning || exporting}>{exporting ? `${progress.pct}% Exporting…` : 'Export Video ▾'}</button>{exportDropdownOpen && !exporting && (<div className="mx-export-dropdown-menu" style={{ width: '100%', top: 'calc(100% + 4px)', right: 0 }}><button onClick={() => { setExportDropdownOpen(false); exportVideo(); }}>Only Export Video (No Captions)</button><button onClick={() => { setExportDropdownOpen(false); generateCaptionsAndExport(); }}>Generate Captions & Export</button><button onClick={() => { setExportDropdownOpen(false); generateExportAndShutdown(); }}>Generate Captions, Export & Shut Down</button></div>)}</div></div>
          <div className="mx-caption-actions" style={{ marginTop: '8px', gap: '8px' }}>
            <button className="mx-wide" style={{ background: '#3b82f6', borderColor: '#2563eb' }} onClick={autoInjectSfx}>Auto-Inject SFX 🔊</button>
            <button className="mx-wide" style={{ background: '#10b981', borderColor: '#059669' }} onClick={generateChapters}>Generate Chapters 📖</button>
          </div>
          <label className="mx-check"><input type="checkbox" checked={settings.burnCaptions} onChange={event => setSettings(value => ({ ...value, burnCaptions: event.target.checked }))} /> Show captions permanently in exported video</label>
          <label>Caption style<select value={settings.captionStyle || 'classic'} onChange={event => setSettings(value => ({ ...value, captionStyle: event.target.value }))}><option value="classic">Classic white</option><option value="box">Readable black box</option><option value="yellow">Cinema yellow</option><option value="karaoke">Karaoke highlight</option></select></label>
          <label>Position<select value={settings.captionPosition || 'bottom'} onChange={event => setSettings(value => ({ ...value, captionPosition: event.target.value }))}><option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select></label>
          <label>Text size — {settings.captionFontSize || 42}<input type="range" min="24" max="84" step="2" value={settings.captionFontSize || 42} onChange={event => setSettings(value => ({ ...value, captionFontSize: Number(event.target.value) }))} /></label>
          <label>Line length — {settings.captionMaxChars || 36} characters<input type="range" min="16" max="60" step="2" value={settings.captionMaxChars || 36} onChange={event => setSettings(value => ({ ...value, captionMaxChars: Number(event.target.value) }))} /></label>
          {hasRealCaptions ? <div className="mx-preview-truth"><strong>Real captions active</strong><span>The demo caption is disabled. Preview uses the same timing, wrapping, size, position and style sent to export.</span></div> : <button className="mx-wide" onClick={() => setCaptionSampleVisible(value => !value)}>{captionSampleVisible ? 'Hide Caption Sample' : 'Show Caption Sample'}</button>}
          {captions.length > 0 && <button className="mx-wide" onClick={() => setCaptionEditorOpen(true)}>Edit All Captions on Timeline</button>}
          <div className="mx-caption-list">{captions.map((item, index) => <div key={item.id} className={editingCaptionId === item.id ? 'editing' : ''}><div className="mx-caption-edit-head"><strong>Caption {index + 1}</strong><button onClick={() => { setEditingCaptionId(editingCaptionId === item.id ? '' : item.id); setSelectedCaptionId(item.id); setSelectedId(''); setSelectedAudioId(''); setPlayheadTime(item.start); }}>{editingCaptionId === item.id ? '✓ Save' : '✎ Edit Caption'}</button><button className="mx-caption-delete" onClick={() => { setCaptions(current => current.filter(caption => caption.id !== item.id)); if (selectedCaptionId === item.id) setSelectedCaptionId(''); if (editingCaptionId === item.id) setEditingCaptionId(''); }}>Delete</button></div><div className="mx-caption-time"><label>Start<input type="number" min="0" step="0.1" value={Number(item.start).toFixed(1)} disabled={editingCaptionId !== item.id} onChange={event => setCaptions(current => current.map(caption => caption.id === item.id ? { ...caption, start: Math.max(0, Number(event.target.value)) } : caption))} /></label><label>End<input type="number" min={Number(item.start) + .1} step="0.1" value={Number(item.end).toFixed(1)} disabled={editingCaptionId !== item.id} onChange={event => setCaptions(current => current.map(caption => caption.id === item.id ? { ...caption, end: Math.max(Number(caption.start) + .1, Number(event.target.value)) } : caption))} /></label></div><textarea value={item.text} readOnly={editingCaptionId !== item.id} spellCheck={editingCaptionId === item.id} lang={captionLanguage === 'auto' ? undefined : captionLanguage} title={editingCaptionId === item.id ? 'Correct spelling or rewrite this caption, then press Save.' : 'Press Edit Caption to correct this text.'} onChange={event => setCaptions(current => current.map(caption => caption.id === item.id ? { ...caption, text: event.target.value, words: [] } : caption))} /></div>)}</div>
          <div className="mx-progress"><div><span style={{ width: `${progress.pct}%` }} /></div><p>{progress.phase}{exporting && exportEtaSeconds > 0 ? ` · Estimated time remaining: ${formatEta(exportEtaSeconds)}` : exporting ? ' · Calculating estimated time…' : ''}</p></div>
          {warning && <div className="mx-warning" role="alert"><strong>Warning</strong><span>{warning}</span><button onClick={() => setWarning('')}>Dismiss</button></div>}
          {exporting && <button className="mx-wide mx-danger" onClick={() => window.electronAPI?.myExporterCancel?.()}>Cancel export</button>}
          {result && <div className="mx-result"><strong>Video ready</strong><span>{result.width}×{result.height} · {formatTime(result.duration)}</span><button onClick={() => window.electronAPI?.openFile?.(result.outputPath)}>Play video</button><button onClick={() => window.electronAPI?.showItemInFolder?.(result.outputPath)}>Open folder</button></div>}
        </aside>
        {captionEditorOpen && <div className="mx-caption-editor-modal"><div className="mx-caption-editor-window"><header><div><strong>Complete Caption Timeline</strong><span>{captions.length} captions · edit every line before export</span></div><button onClick={() => setCaptionEditorOpen(false)}>Done</button></header><div className="mx-caption-editor-scroll">{captions.map((item, index) => <div key={item.id}><b>{index + 1}</b><label>Start<input type="number" step=".1" value={Number(item.start).toFixed(1)} onChange={event => setCaptions(current => current.map(c => c.id === item.id ? { ...c, start: Math.max(0, Number(event.target.value)) } : c))} /></label><label>End<input type="number" step=".1" value={Number(item.end).toFixed(1)} onChange={event => setCaptions(current => current.map(c => c.id === item.id ? { ...c, end: Math.max(c.start + .1, Number(event.target.value)) } : c))} /></label><textarea spellCheck value={item.text} onFocus={() => { setPlayheadTime(item.start); setSelectedCaptionId(item.id); }} onChange={event => setCaptions(current => current.map(c => c.id === item.id ? { ...c, text: event.target.value, words: [] } : c))} /><button className="mx-danger" onClick={() => setCaptions(current => current.filter(c => c.id !== item.id))}>Delete</button></div>)}</div></div></div>}
      </div>
      {contextMenu && <div className="mx-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
        <header><strong>{contextMenu.type === 'video' ? 'Video Scene' : 'Detached Audio'}</strong><span>{contextMenu.name}</span></header>
        {contextMenu.type === 'video' ? <>
          <button onClick={() => { copyScene(); setContextMenu(null); }}><span>⧉ Copy Scene</span><kbd>Ctrl+C</kbd></button>
          <button onClick={() => { pasteScene(); setContextMenu(null); }} disabled={!sceneClipboard}><span>▣ Paste Scene</span><kbd>Ctrl+V</kbd></button>
          <button onClick={() => { duplicateScene(); setContextMenu(null); }}><span>Duplicate Scene</span><kbd>Ctrl+D</kbd></button>
          <button onClick={() => { razorCut(); setContextMenu(null); }} disabled={trackStates.videoLocked}><span>✂ Cut at Playhead</span><kbd>S</kbd></button>
          <button onClick={() => { trimSceneToPlayhead('start'); setContextMenu(null); }}><span>Trim Start to Playhead</span></button>
          <button onClick={() => { trimSceneToPlayhead('end'); setContextMenu(null); }}><span>Trim End to Playhead</span></button>
          <button onClick={() => { setSettings(value => ({ ...value, framing: 'fill' })); setScenes(current => current.map(scene => ({ ...scene, fit: 'fill' }))); setContextMenu(null); }}><span>Crop and Zoom — Fill</span></button>
          <button onClick={() => { setSettings(value => ({ ...value, framing: 'contain' })); setScenes(current => current.map(scene => ({ ...scene, fit: 'contain' }))); setContextMenu(null); }}><span>Crop to Fit — Full Frame</span></button>
          <button onClick={() => { patchScene(contextMenu.id, { rotation: (Number(selected?.rotation || 0) + 90) % 360 }); setContextMenu(null); }}><span>Rotate 90° Clockwise</span></button>
          <button onClick={() => { detachSelectedAudio(); setContextMenu(null); }} disabled={!selected?.hasAudio}><span>♫ Detach Audio</span></button>
          <button onClick={() => { patchScene(contextMenu.id, { muted: !selected?.muted }); setContextMenu(null); }}><span>{selected?.muted ? '🔊 Unmute Scene' : '🔇 Mute Scene'}</span></button>
          <button onClick={() => { generateCaptions(); setContextMenu(null); }}><span>Speech to Text</span></button>
          <button onClick={() => { changeSelectedVideoVoice(); setContextMenu(null); }}><span>AI Translation</span></button>
          <button onClick={() => { patchScene(contextMenu.id, { speed: Number(selected?.speed || 1) === 1 ? .5 : Number(selected?.speed || 1) === .5 ? 2 : 1 }); setContextMenu(null); }}><span>Speed — {Number(selected?.speed || 1).toFixed(2)}×</span></button>
          <button onClick={() => { applyVisualPreset('cinematic'); setContextMenu(null); }}><span>Effects & Filters</span></button>
          <div className="mx-context-separator" />
          <button onClick={() => { moveScene(contextMenu.id, -1); setContextMenu(null); }}><span>← Move Earlier</span></button>
          <button onClick={() => { moveScene(contextMenu.id, 1); setContextMenu(null); }}><span>Move Later →</span></button>
          <button onClick={() => { mergeSelectedWithNext(); setContextMenu(null); }}><span>Merge With Next</span></button>
          <button onClick={() => { renameSelectedScene(); setContextMenu(null); }}><span>Rename Clip</span><kbd>F2</kbd></button>
          <button onClick={() => { patchScene(contextMenu.id, { disabled: !selected?.disabled }); setCaptions([]); setContextMenu(null); }}><span>{selected?.disabled ? 'Enable Clip' : 'Disable Clip'}</span></button>
          <button onClick={() => { setAdvancedMode(true); setContextMenu(null); }}><span>Edit Properties</span></button>
          <button onClick={() => { locateSelectedSource(); setContextMenu(null); }}><span>Locate in Media Library</span></button>
          <button onClick={() => { replaceSelectedScene(); setContextMenu(null); }}><span>Replace Clip</span></button>
          <button onClick={() => { if (preview.current && selected) { preview.current.currentTime = Number(selected.trimStart || 0); seekTimeline(sceneTimelineOffset(selected.id)); } setContextMenu(null); }}><span>Match First Frame</span></button>
          <button onClick={() => { patchScene(contextMenu.id, { colorMark: selected?.colorMark === 'gold' ? 'blue' : selected?.colorMark === 'blue' ? 'green' : selected?.colorMark === 'green' ? '' : 'gold' }); setContextMenu(null); }}><span>Change Clip Colour</span></button>
          <button onClick={() => { setSnapEnabled(value => !value); setContextMenu(null); }}><span>{snapEnabled ? 'Disable' : 'Enable'} Timeline Snapping</span><kbd>N</kbd></button>
          <div className="mx-context-separator" />
          <button className="danger" onClick={() => { removeScene(contextMenu.id, true); setContextMenu(null); }}><span>Ripple Delete Scene</span><kbd>Shift+Del</kbd></button>
          <button className="danger" onClick={() => { removeScene(contextMenu.id); setContextMenu(null); }}><span>🗑 Delete Scene</span><kbd>Del</kbd></button>
        </> : <>
          <button onClick={() => { copySelectedAudio(); setContextMenu(null); }}><span>⧉ Copy Audio</span><kbd>Ctrl+C</kbd></button>
          <button onClick={() => { pasteCopiedAudio(); setContextMenu(null); }} disabled={!audioClipboard}><span>▣ Paste at Gold Stick</span><kbd>Ctrl+V</kbd></button>
          <button onClick={() => { duplicateSelectedAudio(); setContextMenu(null); }}><span>Duplicate After Clip</span></button>
          <button onClick={() => { beginCutPositionSelection(contextMenu.id); setContextMenu(null); }}><span>✂ Cut Selected Position Audio</span><kbd>2 clicks</kbd></button>
          <button className="danger" onClick={() => { removeHighlightedAudio(); setContextMenu(null); }} disabled={audioSelection?.trackId !== contextMenu.id || audioSelection?.awaitingEnd}><span>Remove Selected Audio</span></button>
          <button onClick={() => { razorCut(); setContextMenu(null); }} disabled={trackStates.audioLocked}><span>✂ Cut at Playhead</span><kbd>S</kbd></button>
          <button onClick={() => { trimSelectedAudioToPlayhead('start'); setContextMenu(null); }} disabled={trackStates.audioLocked}><span>Trim Before Playhead</span></button>
          <button onClick={() => { trimSelectedAudioToPlayhead('end'); setContextMenu(null); }} disabled={trackStates.audioLocked}><span>Trim After Playhead</span></button>
          <button onClick={() => { patchAudioTrack(contextMenu.id, { muted: !selectedAudio?.muted }); setContextMenu(null); }}><span>{selectedAudio?.muted ? '🔊 Unmute Audio' : '🔇 Mute Audio'}</span></button>
          <button className="reattach-menu" onClick={() => { reattachSelectedAudio(); setContextMenu(null); }}><span>🔗 Reattach Audio to Video</span></button>
          <div className="mx-context-separator" />
          <button className="danger" onClick={() => { removeAudioTrack(contextMenu.id, true); setContextMenu(null); }}><span>Ripple Delete Audio</span><kbd>Shift+Del</kbd></button>
          <button className="danger" onClick={() => { removeAudioTrack(contextMenu.id); setContextMenu(null); }}><span>🗑 Delete Audio</span><kbd>Del</kbd></button>
        </>}
      </div>}
      {/* ── AI Stutter Cutter Modal ── */}
      {stutterCutterOpen && (
        <div className="mx-caption-editor-modal" role="dialog" aria-label="AI Stutter Cutter">
          <div className="mx-caption-editor-window" style={{ maxWidth: '650px', height: '550px' }}>
            <header style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: '#fff' }}>
              <div>
                <strong>🪄 AI Stutter Cutter</strong>
                <span>Detected {detectedStutters.length} stutter/disturbance word{detectedStutters.length === 1 ? '' : 's'} on the timeline</span>
              </div>
              <button onClick={() => setStutterCutterOpen(false)} style={{ color: '#fff' }}>Done</button>
            </header>

            <div className="mx-caption-editor-scroll" style={{ padding: '20px' }}>
              {detectedStutters.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 10px', color: '#a1a1aa' }}>
                  <span style={{ fontSize: '32px', display: 'block', marginBottom: '10px' }}>🎉</span>
                  <strong>No stutters or duplicated words detected!</strong>
                  <p style={{ fontSize: '12px', marginTop: '6px' }}>Verify you have generated captions first, as they contain the word timings needed for automatic detection.</p>
                </div>
              ) : (
                <>
                  <div style={{ background: 'rgba(124, 58, 237, 0.1)', border: '1px solid rgba(124, 58, 237, 0.2)', padding: '12px', borderRadius: '8px', marginBottom: '15px', fontSize: '12px', color: '#e0d8ff' }}>
                    <strong>How it works:</strong> The AI scans your captions to identify stutter duplicate/prefix words (e.g., <i>"supe"</i> → <i>"super"</i>) and waste/filler words (e.g., <i>"um", "uh", "ah"</i>). Clicking <b>"Auto Cut"</b> will remove that exact disturbance range from video, audio, and captions, ripple-closing the timeline without ruining the sentence!
                  </div>

                  <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                    <button 
                      onClick={() => { applyStutterCuts(detectedStutters); setStutterCutterOpen(false); }}
                      style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg, #8b5cf6, #ec4899)', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      🪄 Auto Cut All {detectedStutters.length} Disturbance Words
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {detectedStutters.map((stutter, idx) => (
                      <div key={stutter.id} style={{ background: '#1c1f26', border: '1px solid #2e3540', padding: '10px 15px', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.15s ease' }} className="mx-stutter-row-item">
                        <div 
                          style={{ cursor: 'pointer', flex: 1 }} 
                          onClick={() => {
                            seekTimeline(Math.max(0, stutter.start - 0.5));
                            setSelectedCaptionId(stutter.captionId);
                            window.setTimeout(() => {
                              if (preview.current && preview.current.paused) {
                                preview.current.play().catch(() => {});
                              }
                            }, 50);
                          }}
                          title="Click to seek playhead here and listen"
                        >
                          <span style={{ 
                            background: stutter.type === 'PHRASE' ? 'rgba(168, 85, 247, 0.18)' : stutter.type === 'FILLER' ? 'rgba(245, 158, 11, 0.18)' : 'rgba(239, 68, 68, 0.15)', 
                            color: stutter.type === 'PHRASE' ? '#c084fc' : stutter.type === 'FILLER' ? '#f59e0b' : '#f87171', 
                            padding: '2px 6px', 
                            borderRadius: '4px', 
                            fontSize: '10px', 
                            fontWeight: 'bold', 
                            marginRight: '8px' 
                          }}>
                            {stutter.type === 'PHRASE' ? 'REPEATED PHRASE' : stutter.type === 'FILLER' ? 'FILLER WORD' : 'STUTTER'}
                          </span>
                          {stutter.type === 'PHRASE' ? (
                            <span>Remove repeated phrase <strong style={{ color: '#c084fc', textDecoration: 'line-through' }}>"{stutter.text}"</strong></span>
                          ) : stutter.type === 'FILLER' ? (
                            <span>Remove filler word <strong style={{ color: '#fbbf24', textDecoration: 'line-through' }}>"{stutter.text}"</strong></span>
                          ) : (
                            <>
                              <strong style={{ textDecoration: 'line-through', color: '#a1a1aa' }}>"{stutter.text}"</strong>
                              <span style={{ margin: '0 8px', color: '#71717a' }}>→</span>
                              <strong style={{ color: '#34d399' }}>"{stutter.replacementText}"</strong>
                            </>
                          )}
                          <div style={{ fontSize: '10px', color: '#71717a', marginTop: '4px' }}>
                            Timeline: {formatTime(stutter.start)} - {formatTime(stutter.end)} · Click to Listen
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button 
                            onClick={() => {
                              seekTimeline(Math.max(0, stutter.start - 0.5));
                              setSelectedCaptionId(stutter.captionId);
                              window.setTimeout(() => {
                                if (preview.current && preview.current.paused) {
                                  preview.current.play().catch(() => {});
                                }
                              }, 50);
                            }}
                            style={{ padding: '6px 12px', background: '#475569', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: '550' }}
                          >
                            🔍 Listen
                          </button>
                          <button 
                            onClick={() => {
                              applyStutterCuts([stutter]);
                              setDetectedStutters(current => current.filter(item => item.id !== stutter.id));
                            }}
                            style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: '550' }}
                          >
                            Cut This
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
