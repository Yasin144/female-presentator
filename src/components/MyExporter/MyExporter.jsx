import React, { useEffect, useMemo, useRef, useState } from 'react';
import './my-exporter.css';
import EditorAssetBrowser from './EditorAssetBrowser';
import SourceMonitor from './SourceMonitor';
import PreviewAudioMixer from './PreviewAudioMixer';
import AudioRangeEditor from './AudioRangeEditor';
import HelpGuide, { HelpHint } from './HelpGuide';
import { HELP_DEFAULT_TOPICS } from './editor-help.mjs';
import SceneInspector from './SceneInspector';
import { transcriptCues, cuesForScene, translateCueTexts } from './editor-captions.mjs';
import { addAllMediaToTimeline, sortMediaBySceneNumber } from './editor-media.mjs';
import { editAudioSelection, validateAudioSelection, audioFadeGain, MIN_AUDIO_RANGE_SECONDS } from './editor-audio.mjs';
import { normalizeProject, timelineEntries, sceneOutputDuration, sampleSceneTransform, splitScene as splitSceneModel, trimScene as trimSceneModel, deleteScenes as deleteScenesModel, createProjectSnapshot, snapshotProjectKey, reorderScenes, deleteTimeRange, insertScene, duplicateScene as duplicateSceneModel } from './editor-model.mjs';

const fileUrl = value => encodeURI(`file:///${String(value || '').replace(/\\/g, '/')}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PROJECT_KEY = 'pattan-my-exporter-project-v1';
const WORKSPACES_KEY = 'pattan-my-exporter-workspaces-v1';
const loadWorkspaces = () => { try { const saved = JSON.parse(localStorage.getItem(WORKSPACES_KEY) || 'null'); return saved?.tabs?.length && saved.tabs.every(tab => typeof tab.id === 'string' && tab.data) ? saved : null; } catch (_) { return null; } };
const DEFAULT_SETTINGS = { resolution: '1080p', aspectRatio: '16:9', fps: 30, quality: 'balanced', framing: 'contain', musicVolume: 0.18, burnCaptions: true, captionStyle: 'classic', captionPosition: 'bottom', captionFontSize: 42, captionMaxChars: 36, captionFontFamily: 'Arial', captionBold: true, captionColor: '#ffffff', captionWidth: 100, captionHeight: 100, watermarkPosition: 'bottom-right', watermarkX: 90, watermarkY: 90, watermarkScale: 16, watermarkOpacity: .85 };
const WATERMARK_POSITIONS = { 'top-left': [10, 10], 'top-right': [90, 10], 'bottom-left': [10, 90], 'bottom-right': [90, 90], center: [50, 50] };
const loadProject = () => {
  let raw;
  try { raw = localStorage.getItem(PROJECT_KEY); return normalizeProject(JSON.parse(raw || 'null') || {}, { defaultSettings: DEFAULT_SETTINGS, defaultCaptionLanguage: 'en' }); }
  catch (error) { return { recoveryData: raw, loadError: `Saved project needs repair: ${error.message} Its saved data has been preserved. Open a project file or save a recovery copy before starting a new project.` }; }
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
const VOICE_GENDER_MODELS = {
  en: { female: 'en-IN-NeerjaNeural', male: 'en-IN-PrabhatNeural' }, hi: { female: 'hi-IN-SwaraNeural', male: 'hi-IN-MadhurNeural' },
  te: { female: 'te-IN-ShrutiNeural', male: 'te-IN-MohanNeural' }, ta: { female: 'ta-IN-PallaviNeural', male: 'ta-IN-ValluvarNeural' },
  kn: { female: 'kn-IN-SapnaNeural', male: 'kn-IN-GaganNeural' }, ml: { female: 'ml-IN-SobhanaNeural', male: 'ml-IN-MidhunNeural' },
};
const DEFAULT_LOGO = { name: 'info kids logo.png', path: 'D:\\desktop\\NEVER DELETE\\info kids logo.png', preview: '' };
const textToBase64 = value => {
  const bytes = new TextEncoder().encode(value); let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};

export default function MyExporter({ active = true }) {
  const initialProject = useMemo(loadProject, []);
  const recoveryNeeded = useRef(Boolean(initialProject.loadError));
  const mediaInput = useRef(null);
  const musicInput = useRef(null);
  const watermarkInput = useRef(null);
  const projectInput = useRef(null);
  const preview = useRef(null);
  const viewer = useRef(null);
  const previewViewport = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 640, height: 360 });
  const captionController = useRef(null);
  const captionNativePath = useRef('');
  const [captionEngine, setCaptionEngine] = useState(() => initialProject.captionEngine || 'local');
  const audioPreview = useRef(null);
  const audioSelectionPreview = useRef(null);
  const audioRangePlaybackRef = useRef({ token: 0, frame: 0, timer: 0, cleanup: null });
  const audioRangeGestureRef = useRef(null);
  const audioEditGestureRef = useRef(false);
  const waveformRequestsRef = useRef(new Map());
  const [audioRangePreviewing, setAudioRangePreviewing] = useState(false);
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
  const [scenes, setScenes] = useState(() => initialProject.scenes || []);
  const [mediaLibrary, setMediaLibrary] = useState(() => initialProject.mediaLibrary || []);
  const [selectedId, setSelectedId] = useState(() => initialProject.selectedId || '');
  const [music, setMusic] = useState(() => initialProject.music || null);
  const [watermark, setWatermark] = useState(() => { const saved = initialProject.watermark; return !saved || /info kids/i.test(saved.name || '') ? DEFAULT_LOGO : saved; });
  const [watermarkEnabled, setWatermarkEnabled] = useState(() => Boolean(initialProject.watermarkEnabled));
  const [playbackMode, setPlaybackMode] = useState(() => initialProject.playbackMode || 'continuous');
  const [audioTracks, setAudioTracks] = useState(() => initialProject.audioTracks || []);
  const [trackStates, setTrackStates] = useState(() => initialProject.trackStates || { videoLocked: false, audioLocked: false, audioMuted: false, captionsLocked: false, captionsMuted: false });
  const [captions, setCaptions] = useState(() => initialProject.captions || []);
  const [textOverlays, setTextOverlays] = useState(() => initialProject.textOverlays || []);
  const [selectedTextId, setSelectedTextId] = useState('');
  const [captionEditorOpen, setCaptionEditorOpen] = useState(false);
  const [stutterCutterOpen, setStutterCutterOpen] = useState(false);
  const [detectedStutters, setDetectedStutters] = useState([]);
  const [captionLanguage, setCaptionLanguage] = useState(() => initialProject.captionLanguage || 'en');
  const [voiceLanguage, setVoiceLanguage] = useState(() => initialProject.voiceLanguage || 'hi');
  const [voiceGender, setVoiceGender] = useState('female');
  const [voiceChanging, setVoiceChanging] = useState(false);
  const [targetMorphVoice, setTargetMorphVoice] = useState('sc3');
  const [audioMorphing, setAudioMorphing] = useState(false);
  const [detectedCaptionLanguage, setDetectedCaptionLanguage] = useState('');
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...(initialProject.settings || {}) }));
  const [progress, setProgress] = useState({ pct: 0, phase: 'Ready' });
  const [exporting, setExporting] = useState(false);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [exportStartedAt, setExportStartedAt] = useState(0);
  const [exportClock, setExportClock] = useState(Date.now());
  const [warning, setWarning] = useState(() => initialProject.loadError || '');
  const [captioning, setCaptioning] = useState(false);
  const projectBusyRef = useRef(false);
  projectBusyRef.current = captioning || exporting;
  const blockBusyProjectChange = () => {
    if (!projectBusyRef.current) return false;
    setWarning('Wait for the current caption or export process to finish before changing projects.');
    return true;
  };
  const [result, setResult] = useState(null);
  const [safeGuides, setSafeGuides] = useState(false);
  const [advancedMode, setAdvancedMode] = useState(true);
  const [sourceAsset, setSourceAsset] = useState(null);
  const [autosaveState, setAutosaveState] = useState('Saved locally');
  const [markers, setMarkers] = useState(() => initialProject.markers || []);
  const exportJobRef = useRef('');
  const playheadRef = useRef(0);
  const playingRef = useRef(false);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [programWaiting, setProgramWaiting] = useState(false);
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
  const [captionSampleVisible, setCaptionSampleVisible] = useState(() => !(initialProject.captions || []).length);
  const [previewLarge, setPreviewLarge] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [expandedTimelineTrack, setExpandedTimelineTrack] = useState('');
  const [openSidePanel, setOpenSidePanel] = useState('library');
  const [inspectorTab, setInspectorTab] = useState('clip');
  const [helpTopic, setHelpTopic] = useState(null);
  const openHelp = topic => {
    setContextMenu(null); setExportDropdownOpen(false); setIsPreviewPlaying(false); stopAudioSelectionPreview();
    setHelpTopic(HELP_DEFAULT_TOPICS[topic] || topic || HELP_DEFAULT_TOPICS.media);
  };
  useEffect(() => { if (!active) setHelpTopic(null); }, [active]);
  const locateHelpControls = topic => {
    const target = topic.target;
    setHelpTopic(null);
    if (!target) return;
    if (['project', 'timeline', 'source'].includes(target.panel)) {
      if (target.panel === 'source' && !sourceAsset) { setAssetTab('Media'); setOpenSidePanel('library'); }
      requestAnimationFrame(() => {
        const element = document.querySelector(target.panel === 'project' ? '.mx-editor-topbar' : target.panel === 'timeline' ? '.mx-filmora-toolstrip' : sourceAsset ? '.mx-source-monitor' : '.mx-asset-browser');
        element?.scrollIntoView({ block: 'nearest' }); element?.querySelector('button:not(:disabled)')?.focus();
      });
      return;
    }
    if (target.panel === 'library') { setAssetTab(target.assetTab || 'Media'); setOpenSidePanel('library'); }
    else openInspector(target.panel || 'clip');
    if (target.section) requestAnimationFrame(() => {
      const scopes = document.querySelectorAll(target.panel === 'library' ? '.mx-library' : `.mx-inspector-page[data-inspector-page="${target.panel}"]`);
      const summary = [...scopes].flatMap(scope => [...scope.querySelectorAll('summary')]).find(item => item.textContent.toLocaleLowerCase().includes(target.section.toLocaleLowerCase()));
      if (summary) { for (let parent = summary.closest('details'); parent; parent = parent.parentElement?.closest('details')) parent.open = true; summary.scrollIntoView({ block: 'nearest' }); summary.focus(); }
    });
  };
  const openInspector = (tab = 'clip') => { setInspectorTab(tab); setSourceAsset(null); setOpenSidePanel('inspector'); };
  const closeEditorMenu = event => { if (event.target.closest('button')) event.currentTarget.closest('details').open = false; };
  useEffect(() => {
    if (selectedTextId) setInspectorTab('text');
    else if (selectedCaptionId) setInspectorTab('captions');
    else if (selectedAudioId || selectedId) setInspectorTab('clip');
  }, [selectedId, selectedAudioId, selectedCaptionId, selectedTextId]);
  useEffect(() => {
    const close = event => document.querySelectorAll('.mx-editor-menu[open]').forEach(menu => { if (event.key === 'Escape' || !menu.contains(event.target)) menu.open = false; });
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, []);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [previewFrame, setPreviewFrame] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [projectName, setProjectName] = useState(() => initialProject.projectName || 'Untitled Project');
  const [projectPath, setProjectPath] = useState(() => initialProject.projectPath || 'Not saved yet');
  const [cropSource, setCropSource] = useState(null);
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const [cropSaving, setCropSaving] = useState(false);
  const [cropPartCount, setCropPartCount] = useState(1);
  const [cropParts, setCropParts] = useState([{ start: 0, end: 0 }]);
  const [cropParallelExports, setCropParallelExports] = useState(2);
  const [assetTab, setAssetTab] = useState('Media');
  const [workspaceTabs, setWorkspaceTabs] = useState(() => loadWorkspaces()?.tabs || [{ id: uid(), name: initialProject.projectName || 'Project 1', data: null }]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => loadWorkspaces()?.activeId || workspaceTabs?.[0]?.id || '');
  const [layoutMode, setLayoutMode] = useState(() => { try { return localStorage.getItem('mx-layout-mode') || 'default'; } catch (_) { return 'default'; } });
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false);

  const selectedAudio = audioTracks.find(track => track.id === selectedAudioId);
  const selectedText = textOverlays.find(item => item.id === selectedTextId);
  const selected = scenes.find(scene => scene.id === selectedId) || (!selectedAudio && !selectedCaptionId && !selectedTextId ? scenes[0] : null);
  const entries = useMemo(() => timelineEntries(scenes), [scenes]);
  const totalDuration = useMemo(() => entries.at(-1)?.end || 0, [entries]);
  const programEntry = entries.find(entry => playheadTime >= entry.start && playheadTime < entry.end) || (playheadTime >= totalDuration ? entries[entries.length - 1] : entries[0]);
  const programScene = programEntry?.scene;
  const programTransform = programScene ? sampleSceneTransform(programScene, Math.max(0, playheadTime - programEntry.start)) : {};
  playheadRef.current = playheadTime;
  playingRef.current = isPreviewPlaying;
  projectBusyRef.current = captioning || exporting || voiceChanging || audioMorphing || cropSaving;
  const activeTimelineAudio = audioTracks.find(track => !track.muted && playheadTime >= Number(track.start) && playheadTime <= Number(track.start) + Number(track.duration));
  const activeCaption = captions.find(item => playheadTime >= Number(item.start) && playheadTime < Number(item.end));
  const karaokeWords = activeCaption ? String(activeCaption.text || '').split(/\s+/).filter(Boolean) : [];
  const getKaraokeWordIndex = () => {
    if (!activeCaption) return -1;
    const timedWords = (activeCaption.words || []).filter(w => 
      Number.isFinite(Number(w.start)) && 
      Number.isFinite(Number(w.end)) && 
      Number(w.end) > Number(w.start)
    );
    if (timedWords.length) {
      const idx = timedWords.findIndex(w => playheadTime >= Number(w.start) && playheadTime < Number(w.end));
      if (idx !== -1) return idx;
      const lastEndedIdx = [...timedWords].reverse().findIndex(w => playheadTime >= Number(w.end));
      if (lastEndedIdx !== -1) {
        return timedWords.length - 1 - lastEndedIdx;
      }
      return -1;
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
      if (selectedIds.length) setSelectedIds([]);
    } else if (!selectedIds.includes(selectedId)) {
      setSelectedIds([selectedId]);
    }
  }, [selectedId, selectedIds]);

  const selectScene = (sceneId, isCtrlPressed = false) => {
    if (isCtrlPressed) {
      setSelectedIds(previous => {
        const next = previous.includes(sceneId) ? previous.filter(id => id !== sceneId) : [...previous, sceneId];
        setSelectedId(next.at(-1) || ''); return next;
      });
    } else {
      setSelectedId(sceneId); setSelectedIds([sceneId]);
      const entry = entries.find(item => item.scene.id === sceneId);
      if (entry) seekTimeline(entry.start, true);
    }
    setSelectedAudioId(''); setSelectedCaptionId(''); setSelectedTextId(''); setInspectorTab('clip');
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
  useEffect(() => { audioSelectionRef.current = audioSelection; }, [audioSelection]);
  useEffect(() => {
    stopAudioSelectionPreview();
    return stopAudioSelectionPreview;
  }, [active, audioSelection, selectedAudioId, selectedAudio?.path, selectedAudio?.start, selectedAudio?.duration, selectedAudio?.trimStart, selectedAudio?.speed, selectedAudio?.volume, selectedAudio?.muted, selectedAudio?.fadeIn, selectedAudio?.fadeOut, selectedAudio?.fadeEnvelope, trackStates.audioMuted]);
  useEffect(() => {
    if (!audioSelection || audioSelection.trackId !== selectedAudio?.id || audioSelection.start < Number(selectedAudio.start) || audioSelection.end > Number(selectedAudio.start) + Number(selectedAudio.duration)) {
      audioSelectionRef.current = null; setAudioSelection(null);
    }
  }, [selectedAudio?.id, selectedAudio?.start, selectedAudio?.duration]);
  useEffect(() => () => audioRangeGestureRef.current?.(), []);
  useEffect(() => {
    if (!active || captioning || exporting || voiceChanging || audioMorphing || cropSaving || trackStates.audioLocked) { audioRangeGestureRef.current?.(); stopAudioSelectionPreview(); }
  }, [active, captioning, exporting, voiceChanging, audioMorphing, cropSaving, trackStates.audioLocked]);

  useEffect(() => {
    const viewport = previewViewport.current;
    if (!viewport) return;
    const update = () => {
      const [rw, rh] = String(settings.aspectRatio || '16:9').split(':').map(Number);
      const ratio = rw / rh || 16 / 9;
      const availableWidth = Math.max(1, viewport.clientWidth);
      const availableHeight = Math.max(1, viewport.clientHeight);
      const width = Math.min(availableWidth, availableHeight * ratio);
      const height = width / ratio;
      setCanvasSize(current => Math.abs(current.width - width) < .5 && Math.abs(current.height - height) < .5 ? current : { width, height });
    };
    const observer = new ResizeObserver(update); observer.observe(viewport); update();
    return () => observer.disconnect();
  }, [active, settings.aspectRatio, previewLarge, sourceAsset, layoutMode]);

  const updatePreviewFrame = () => {
    const canvas = viewer.current;
    if (!canvas) return;
    setPreviewFrame({ left: 0, top: 0, width: canvas.clientWidth, height: canvas.clientHeight });
  };

  useEffect(() => {
    const refresh = () => { setIsPreviewFullscreen(document.fullscreenElement === previewViewport.current); updatePreviewFrame(); };
    window.addEventListener('resize', refresh);
    document.addEventListener('fullscreenchange', refresh);
    const timer = window.setTimeout(refresh, 50);
    return () => { window.removeEventListener('resize', refresh); document.removeEventListener('fullscreenchange', refresh); window.clearTimeout(timer); };
  }, [selected?.id, selected?.width, selected?.height, settings.resolution, settings.framing]);

  useEffect(() => {
    const handler = data => { if (!exportJobRef.current || data?.jobId !== exportJobRef.current) return; setProgress({ pct: Number(data?.pct) || 0, phase: data?.phase || 'Exporting' }); };
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
    if (recoveryNeeded.current) return;
    const timer = window.setTimeout(() => {
      try {
        const data = currentWorkspaceData();
        localStorage.setItem(PROJECT_KEY, JSON.stringify(data));
        const tabs = workspaceTabs.map(tab => tab.id === activeWorkspaceId ? { ...tab, name: projectName, data } : tab);
        localStorage.setItem(WORKSPACES_KEY, JSON.stringify({ activeId: activeWorkspaceId, tabs }));
        setAutosaveState('Saved locally');
      } catch (_) {
        const message = 'Autosave storage is full — save a project file';
        setAutosaveState(message); setWarning(current => current || message);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [projectName, projectPath, scenes, mediaLibrary, selectedId, music, watermark, watermarkEnabled, playbackMode, audioTracks, trackStates, captions, textOverlays, captionLanguage, captionEngine, voiceLanguage, settings, markers, workspaceTabs, activeWorkspaceId]);

  useEffect(() => {
    if (audioEditGestureRef.current) return;
    const snapshot = createProjectSnapshot(projectData());
    const current = historyRef.current[historyIndexRef.current];
    if (restoringHistoryRef.current) { restoringHistoryRef.current = false; return; }
    if (current && snapshotProjectKey(JSON.parse(current)) === snapshotProjectKey(snapshot)) return;
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(JSON.stringify(snapshot));
    if (historyRef.current.length > 80) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
    setHistoryVersion(value => value + 1);
  }, [scenes, audioTracks, captions, textOverlays, mediaLibrary, settings, music, watermark, watermarkEnabled, trackStates, projectName, markers, captionLanguage, captionEngine, voiceLanguage]);

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

  const applyTimelineState = next => {
    commitTimelineHistory(next.scenes, next.audioTracks, next.captions, { textOverlays: next.textOverlays, markers: next.markers || markers });
    setScenes(next.scenes); setAudioTracks(next.audioTracks); setCaptions(next.captions); setTextOverlays(next.textOverlays);
    setMarkers(next.markers || markers); setResult(null); setWarning('');
  };
  const patchScene = (id, patch) => {
    if (projectBusyRef.current) return;
    if (trackStates.videoLocked && ['trimStart','duration','speed'].some(key => key in patch)) { setWarning('Unlock the video track before changing clip timing.'); return; }
    try {
      if (['trimStart', 'duration', 'speed'].some(key => key in patch)) {
        const next = trimSceneModel(projectData(), id, patch);
        next.scenes = next.scenes.map(scene => scene.id === id ? { ...scene, ...Object.fromEntries(Object.entries(patch).filter(([key]) => !['trimStart','duration','speed'].includes(key))) } : scene);
        applyTimelineState(next);
      } else { setScenes(current => current.map(scene => scene.id === id ? { ...scene, ...patch } : scene)); setResult(null); }
    } catch (error) { setWarning(error.message); }
  };
  const patchLibraryItem = (id, patch) => {
    setMediaLibrary(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
    setScenes(current => current.map(scene => {
      if (scene.libraryId !== id) return scene;
      const { duration, trimStart, speed, ...metadata } = patch;
      const wasPlaceholder = Boolean(scene.probeError) && Number(scene.trimStart || 0) === 0 && Number(scene.duration) === Number(scene.sourceDuration);
      return { ...scene, ...metadata, ...(wasPlaceholder && duration ? { duration } : {}) };
    }));
  };

  const projectData = () => ({ markers, captionEngine, format: 'pattan-my-exporter-project', version: 3, projectName, savedAt: new Date().toISOString(), scenes, mediaLibrary, audioTracks, captions, textOverlays, music, watermark: watermark ? { ...watermark, preview: '' } : null, watermarkEnabled, playbackMode, trackStates, captionLanguage, voiceLanguage, settings });
  const currentWorkspaceData = () => ({ ...projectData(), projectPath, selectedId });
  const applyWorkspaceData = (data, { preserveHistory = false } = {}) => {
    const next = normalizeProject(data || {}, { defaultSettings: DEFAULT_SETTINGS, defaultCaptionLanguage: 'en' });
    waveformRequestsRef.current.clear();
    audioRangeGestureRef.current?.(); stopAudioSelectionPreview(); updateAudioSelection(null); setAudioCutSelectionModeId('');
    recoveryNeeded.current = false;
    if (!preserveHistory) {
      historyRef.current = []; historyIndexRef.current = -1; restoringHistoryRef.current = false;
      setHistoryVersion(value => value + 1);
    }
    setIsPreviewPlaying(false); setSourceAsset(null);
    setScenes(next.scenes); setMediaLibrary(next.mediaLibrary); setAudioTracks(next.audioTracks); setCaptions(next.captions); setTextOverlays(next.textOverlays);
    setMusic(next.music || null); setWatermark(next.watermark || DEFAULT_LOGO); setWatermarkEnabled(Boolean(next.watermarkEnabled));
    setPlaybackMode(next.playbackMode || 'continuous'); setTrackStates(next.trackStates); setMarkers(next.markers || []);
    setCaptionLanguage(next.captionLanguage || 'en'); setCaptionEngine(next.captionEngine || 'local'); setVoiceLanguage(next.voiceLanguage || 'hi'); setSettings(next.settings);
    setProjectName(next.projectName || 'Untitled Project'); setProjectPath(next.projectPath || 'Not saved yet');
    setSelectedId(next.selectedId || next.scenes[0]?.id || ''); setSelectedAudioId(''); setSelectedCaptionId(''); setSelectedTextId(''); setPlayheadTime(0); setResult(null); setWarning('');
  };

  const switchWorkspace = id => {
    if (id === activeWorkspaceId || projectBusyRef.current) return;
    if (recoveryNeeded.current) { setWarning('Save a recovery copy or open a valid project before switching projects.'); return; }
    const target = workspaceTabs.find(tab => tab.id === id); if (!target) return;
    const savedCurrent = currentWorkspaceData();
    setWorkspaceTabs(current => current.map(tab => tab.id === activeWorkspaceId ? { ...tab, name: projectName, data: savedCurrent } : tab));
    setActiveWorkspaceId(id); applyWorkspaceData(target.data || {});
  };
  const addWorkspace = () => {
    if (projectBusyRef.current) return;
    if (recoveryNeeded.current) { setWarning('Save a recovery copy or open a valid project before starting a new project.'); return; }
    const savedCurrent = currentWorkspaceData(); const id = uid();
    setWorkspaceTabs(current => [...current.map(tab => tab.id === activeWorkspaceId ? { ...tab, name: projectName, data: savedCurrent } : tab), { id, name: `Project ${current.length + 1}`, data: {} }]);
    setActiveWorkspaceId(id); applyWorkspaceData({ projectName: `Project ${workspaceTabs.length + 1}` });
  };

  const saveProject = async () => {
    if (blockBusyProjectChange()) return;
    try {
      if (recoveryNeeded.current) {
        const recovery = await window.electronAPI?.showSaveDialog?.({ title: 'Save the preserved project for recovery', defaultPath: 'My-Exporter-Recovery.pattanproject', filters: [{ name: 'Pattan Project', extensions: ['pattanproject'] }] });
        if (blockBusyProjectChange()) return;
        if (recovery?.canceled || !recovery?.filePath) return;
        const saved = await window.electronAPI.writeFile(recovery.filePath, textToBase64(initialProject.recoveryData || ''));
        if (!saved?.ok) throw new Error(saved?.error || 'Recovery copy could not be saved.');
        recoveryNeeded.current = false; setWarning(''); setProgress({ pct: 100, phase: `Recovery copy saved: ${recovery.filePath}. You can now open or start a project.` }); return;
      }
      const picked = await window.electronAPI?.showSaveDialog?.({ title: 'Save My Exporter project', defaultPath: `${projectName === 'Untitled Project' ? 'My-Exporter-Project' : projectName}.pattanproject`, filters: [{ name: 'Pattan Project', extensions: ['pattanproject'] }], buttonLabel: 'Save Project' });
      if (blockBusyProjectChange()) return;
      if (picked?.canceled || !picked?.filePath) return;
      const nextName = picked.filePath.split(/[\\/]/).pop().replace(/\.pattanproject$/i, '');
      const data = { ...projectData(), projectName: nextName };
      const result = await window.electronAPI.writeFile(picked.filePath, textToBase64(JSON.stringify(data, null, 2)));
      if (!result?.ok) throw new Error(result?.error || 'Project could not be saved.');
      if (blockBusyProjectChange()) return;
      setProjectName(nextName); setProjectPath(picked.filePath); setProgress({ pct: 100, phase: `Project saved: ${nextName} · ${picked.filePath}` });
    } catch (error) { setWarning(`Project save failed: ${error.message}`); }
  };

  const openProjectFile = async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || blockBusyProjectChange()) return;
    try {
      const content = await file.text();
      if (blockBusyProjectChange()) return;
      const data = JSON.parse(content);
      if (data?.format !== 'pattan-my-exporter-project') throw new Error('This is not a My Exporter project file.');
      const openedPath = window.electronAPI?.getPathForFile?.(file) || file.path || file.name;
      applyWorkspaceData({ ...data, projectPath: openedPath, projectName: data.projectName || file.name.replace(/\.pattanproject$/i, '') });
      setProgress({ pct: 100, phase: `Project opened: ${data.projectName || file.name}` });
    } catch (error) { setWarning(`Project open failed: ${error.message}`); }
  };

  const newProject = () => {
    if (blockBusyProjectChange()) return;
    if ((scenes.length || audioTracks.length || captions.length || mediaLibrary.length) && !window.confirm('Create a new project? Save your current project first if you want to keep it.')) return;
    if (recoveryNeeded.current) { setWarning('Save a recovery copy or open a valid project before clearing the saved project.'); return; }
    setScenes([]); setMediaLibrary([]); setAudioTracks([]); setCaptions([]); setTextOverlays([]); setMusic(null); setWatermark(DEFAULT_LOGO); setWatermarkEnabled(false); setPlaybackMode('continuous'); setSelectedId(''); setSelectedAudioId(''); setSelectedCaptionId(''); setSelectedTextId(''); setPlayheadTime(0); setResult(null); setProjectName('Untitled Project'); setProjectPath('Not saved yet'); setWarning(''); localStorage.removeItem(PROJECT_KEY); setProgress({ pct: 0, phase: 'New project ready' });
  };

  const resetExporter = () => {
    if (captioning || exporting) {
      setWarning('Stop the current caption or export process before resetting My Exporter.');
      return;
    }
    if (!window.confirm('Reset My Exporter? This clears all loaded media, timeline clips, audio, captions, text, logos, settings, previews and project tabs. Saved files on your computer will not be deleted.')) return;
    recoveryNeeded.current = false;
    try { preview.current?.pause?.(); } catch (_) {}
    try { audioPreview.current?.pause?.(); } catch (_) {}
    try { audioSelectionPreview.current?.pause?.(); } catch (_) {}
    setScenes([]); setMediaLibrary([]); setAudioTracks([]); setCaptions([]); setTextOverlays([]);
    setMusic(null); setWatermark(DEFAULT_LOGO); setWatermarkEnabled(false);
    setSettings({ ...DEFAULT_SETTINGS });
    setTrackStates({ videoLocked: false, audioLocked: false, audioMuted: false, captionsLocked: false, captionsMuted: false });
    setPlaybackMode('continuous'); setCaptionLanguage('en'); setVoiceLanguage('hi'); setDetectedCaptionLanguage('');
    setSelectedId(''); setSelectedIds([]); setSelectedAudioId(''); setSelectedCaptionId(''); setSelectedTextId('');
    setEditingCaptionId(''); setDraggingId(''); setContextMenu(null); setAudioClipboard(null); setSceneClipboard(null);
    setAudioSelection(null); setAudioCutSelectionModeId(''); setDetectedStutters([]);
    setCaptionEditorOpen(false); setStutterCutterOpen(false); setCaptionSampleVisible(true);
    setPlayheadTime(0); setIsPreviewPlaying(false); setResult(null); setSafeGuides(false); setAdvancedMode(true); setMarkers([]); setCaptionEngine('local'); setSourceAsset(null);
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
      localStorage.removeItem(WORKSPACES_KEY);
      localStorage.removeItem('mx-clipboard-scenes');
      localStorage.removeItem('mx-layout-mode');
    } catch (_) {}
    setWarning(''); setProgress({ pct: 0, phase: 'My Exporter reset complete. Everything is clear.' });
  };

  const deleteProject = async () => {
    if (blockBusyProjectChange()) return;
    if (!window.confirm(`Delete project “${projectName}”? This clears the editor${projectPath !== 'Not saved yet' ? ' and deletes the saved project file' : ''}.`)) return;
    if (projectPath !== 'Not saved yet' && typeof window.electronAPI?.myExporterDeleteProject === 'function') {
      const result = await window.electronAPI.myExporterDeleteProject(projectPath);
      if (!result?.ok) { setWarning(`Project file could not be deleted: ${result?.error || 'Unknown error'}`); return; }
      if (projectBusyRef.current) { setWarning('The saved project file was deleted, but the active processing project was kept open.'); return; }
    }
    recoveryNeeded.current = false;
    setScenes([]); setMediaLibrary([]); setAudioTracks([]); setCaptions([]); setTextOverlays([]); setMusic(null); setWatermark(DEFAULT_LOGO); setWatermarkEnabled(false); setPlaybackMode('continuous'); setSelectedId(''); setSelectedAudioId(''); setSelectedCaptionId(''); setSelectedTextId(''); setPlayheadTime(0); setResult(null); setProjectName('Untitled Project'); setProjectPath('Not saved yet'); localStorage.removeItem(PROJECT_KEY); setWarning(''); setProgress({ pct: 0, phase: 'Project deleted. New empty project ready.' });
  };

  const restoreHistory = direction => {
    if (projectBusyRef.current) return;
    const nextIndex = historyIndexRef.current + direction;
    if (nextIndex < 0 || nextIndex >= historyRef.current.length) return;
    const snapshot = JSON.parse(historyRef.current[nextIndex]);
    restoringHistoryRef.current = true; historyIndexRef.current = nextIndex;
    applyWorkspaceData({ ...snapshot, projectPath }, { preserveHistory: true });
    setHistoryVersion(value => value + 1);
  };
  const commitTimelineHistory = (nextScenes, nextAudioTracks, nextCaptions, extra = {}) => {
    const before = createProjectSnapshot(projectData());
    const after = { ...before, scenes: nextScenes, audioTracks: nextAudioTracks, captions: nextCaptions, ...extra };
    let history = historyRef.current.slice(0, historyIndexRef.current + 1);
    if (!history.length || snapshotProjectKey(JSON.parse(history.at(-1))) !== snapshotProjectKey(before)) history.push(JSON.stringify(before));
    if (snapshotProjectKey(after) !== snapshotProjectKey(before)) history.push(JSON.stringify(after));
    if (history.length > 80) history = history.slice(-80);
    historyRef.current = history; historyIndexRef.current = history.length - 1; restoringHistoryRef.current = true;
    setHistoryVersion(value => value + 1);
  };

  const importMediaEntries = async entries => {
    if (!entries.length || projectBusyRef.current) return;
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
    setProgress({ pct: additions.length ? 25 : 0, phase: additions.length ? `Added ${additions.length} file${additions.length === 1 ? '' : 's'}. Reading media details…` : `Nothing was added. ${failures[0] || 'Select a supported local video or image.'}` });

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
      setProgress({ pct: 100, phase: failures.length ? `Media imported. ${failures[0]}` : `${additions.length} media file${additions.length === 1 ? '' : 's'} ready. Press Add Auto All to place every scene in order, or + Add for one clip.` });
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
    const picked = await window.electronAPI?.showSaveDialog?.({ title: 'Save cropped video directly to this computer', defaultPath: `${base}.mp4`, filters: [{ name: 'MP4 Video', extensions: ['mp4'] }], buttonLabel: 'Save Cropped Video' });
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
    if (projectBusyRef.current || trackStates.audioLocked) return;
    try {
      const result = await window.electronAPI?.myExporterPickAudio?.();
      if (!result?.ok) throw new Error(result?.error || 'Could not open the audio picker.');
      if (result.canceled) return;
      const additions = [];
      for (const filePath of result.filePaths || []) {
        const probe = await window.electronAPI?.myExporterProbe?.({ filePath });
        if (!probe?.ok || !(probe.duration > 0) || !probe.hasAudio) throw new Error(probe?.error || 'This source has no readable audio.');
        additions.push({ id: uid(), kind: 'audio', name: filePath.split(/[\\/]/).pop(), path: filePath, start: playheadTime, trimStart: 0, duration: probe.duration, sourceDuration: probe.duration, speed: 1, volume: 1, muted: false });
      }
      if (projectBusyRef.current) return;
      setMediaLibrary(current => [...current, ...additions.map(track => ({ ...track, id: `source-${track.id}` }))]);
      setAudioTracks(current => [...current, ...additions]);
      additions.forEach(track => loadWaveform(track.id, track.path, track));
      setProgress({ pct: 100, phase: `Added ${additions.length} audio track${additions.length === 1 ? '' : 's'}.` });
    } catch (error) {
      setProgress({ pct: 0, phase: error.message });
    }
  };

  const patchAudioTrack = (id, patch) => {
    const cacheOnly = Object.keys(patch).every(key => ['waveform','waveformLoading','waveformError'].includes(key));
    if (cacheOnly) { setAudioTracks(current => current.map(track => track.id === id ? { ...track, ...patch } : track)); return; }
    if (!cacheOnly && (projectBusyRef.current || trackStates.audioLocked)) return;
    try {
      const next = audioTracks.map(track => {
        if (track.id !== id) return track;
        const edited = { ...track, ...patch };
        if (['fadeIn', 'fadeOut', 'speed', 'duration', 'trimStart'].some(key => key in patch)) delete edited.fadeEnvelope;
        if ('start' in patch) Object.assign(edited, { originSceneId: '', detachedFromSceneId: '', reattachedToSceneId: '', pastedAudio: true });
        if ('speed' in patch && !('duration' in patch)) edited.duration = track.duration * Number(track.speed || 1) / edited.speed;
        if (['trimStart','speed','duration'].some(key => key in patch)) {
          waveformRequestsRef.current.delete(id);
          if (edited.sourceDuration > 0) edited.duration = Math.min(edited.duration, (edited.sourceDuration - Number(edited.trimStart || 0)) / Number(edited.speed || 1));
          edited.waveform = []; edited.waveformLoading = false;
        }
        return edited;
      });
      if (!cacheOnly) normalizeProject({ ...projectData(), audioTracks: next });
      setAudioTracks(next); if (!cacheOnly) setResult(null);
      if (['trimStart','speed','duration'].some(key => key in patch)) { const edited = next.find(track => track.id === id); if (edited) loadWaveform(edited.id, edited.path, edited); }
    } catch (error) { setWarning(error.message); }
  };
  const loadWaveform = async (id, filePath, clip = null) => {
    if (typeof window.electronAPI?.myExporterWaveform !== 'function') return;
    const request = uid(); waveformRequestsRef.current.set(id, request);
    const update = patch => {
      if (waveformRequestsRef.current.get(id) !== request) return;
      setAudioTracks(current => current.map(track => track.id === id && track.path === filePath && waveformRequestsRef.current.get(id) === request && (!clip || Number(track.trimStart || 0) === Number(clip.trimStart || 0) && Number(track.duration) * Number(track.speed || 1) === Number(clip.duration) * Number(clip.speed || 1)) ? { ...track, ...patch } : track));
    };
    update({ waveformLoading: true, waveformError: '' });
    try {
      const response = await window.electronAPI.myExporterWaveform({ filePath, bars: 120, ...(clip ? { trimStart: Number(clip.trimStart || 0), duration: Number(clip.duration) * Number(clip.speed || 1) } : {}) });
      if (response?.ok) {
        let waveform = response.peaks || [];
        if (clip && waveform.length && response.trimStart === undefined) {
          const sourceDuration = Math.max(.001, Number(clip.sourceDuration || clip.duration));
          const from = Math.max(0, Math.min(waveform.length - 1, Math.floor(Number(clip.trimStart || 0) / sourceDuration * waveform.length)));
          const to = Math.max(from + 1, Math.min(waveform.length, Math.ceil((Number(clip.trimStart || 0) + Number(clip.duration) * Number(clip.speed || 1)) / sourceDuration * waveform.length)));
          waveform = waveform.slice(from, to);
        }
        update({ waveform, waveformLoading: false });
      } else update({ waveform: [], waveformLoading: false, waveformError: response?.error || 'Waveform unavailable' });
    } catch (error) { update({ waveform: [], waveformLoading: false, waveformError: error.message }); }
  };

  const syncBySerialNumber = () => {
    if (projectBusyRef.current || trackStates.videoLocked) return;
    try { applyTimelineState(reorderScenes(projectData(), sortMediaBySceneNumber(scenes).map(scene => scene.id))); setMediaLibrary(sortMediaBySceneNumber(mediaLibrary)); setProgress({ pct: 100, phase: 'Clips sorted by scene number with synchronized captions and titles.' }); }
    catch (error) { setWarning(error.message); }
  };

  const buildDetachedAudioTrack = targetScene => ({
    id: uid(),
    name: `${targetScene.name} — detached audio`,
    path: targetScene.path,
    start: sceneTimelineOffset(targetScene.id),
    trimStart: Number(targetScene.trimStart) || 0,
    duration: (Number(targetScene.duration) || 0.1) / Math.max(.25, Number(targetScene.speed) || 1),
    sourceDuration: Number(targetScene.sourceDuration) || Number(targetScene.duration) || 0,
    speed: Math.max(.25, Number(targetScene.speed) || 1),
    volume: Number.isFinite(Number(targetScene.volume)) ? Number(targetScene.volume) : 1,
    muted: false,
    detachedFromSceneId: targetScene.id,
    originSceneId: targetScene.id,
    detachedOffset: 0,
    timelineOffsetWithinScene: 0,
    sourceSceneDuration: (Number(targetScene.duration) || 0.1) / Math.max(.25, Number(targetScene.speed) || 1),
  });

  const detachSelectedAudio = (targetSceneId = '') => {
    if (projectBusyRef.current || trackStates.videoLocked || trackStates.audioLocked) {
      if (trackStates.videoLocked || trackStates.audioLocked) setWarning('Unlock the video and audio tracks before using Detach Audio.');
      return;
    }
    const explicitScene = typeof targetSceneId === 'string' && targetSceneId ? scenes.find(scene => scene.id === targetSceneId) : null;
    const batchTargets = !explicitScene && selectedIds.length > 1
      ? scenes.filter(scene => selectedIds.includes(scene.id) && scene.kind === 'video' && scene.hasAudio !== false)
      : [];
    if (batchTargets.length > 1) {
      const newlyCreated = [];
      const detachedSceneIdSet = new Set();
      for (const scene of batchTargets) {
        const existing = audioTracks.find(track => [track.detachedFromSceneId, track.originSceneId, track.reattachedToSceneId].includes(scene.id));
        if (!existing) {
          newlyCreated.push(buildDetachedAudioTrack(scene));
          detachedSceneIdSet.add(scene.id);
        }
      }
      if (!newlyCreated.length) {
        const firstExisting = audioTracks.find(track => batchTargets.some(scene => [track.detachedFromSceneId, track.originSceneId, track.reattachedToSceneId].includes(scene.id)));
        if (firstExisting) {
          setSelectedAudioId(firstExisting.id);
          setSelectedId('');
          openInspector('clip');
          setWarning('Selected video clips already have detached audio tracks.');
        }
        return;
      }
      const nextTracks = [...audioTracks, ...newlyCreated];
      const nextScenes = scenes.map(scene => detachedSceneIdSet.has(scene.id) ? { ...scene, muted: true } : scene);
      setAudioTracks(nextTracks);
      setScenes(nextScenes);
      newlyCreated.forEach(track => loadWaveform(track.id, track.path, track));
      setSelectedAudioId(newlyCreated[newlyCreated.length - 1].id);
      setSelectedId('');
      setWarning('');
      setProgress({ pct: 100, phase: `Detached audio from ${newlyCreated.length} video clips onto synchronized Audio tracks.` });
      commitTimelineHistory(nextScenes, nextTracks, captions);
      return;
    }

    const target = explicitScene || selected || programScene;
    if (!target || target.kind !== 'video' || target.hasAudio === false) {
      setWarning('Select a video that contains audio before using Detach Audio.');
      return;
    }
    const existing = audioTracks.find(track => track.detachedFromSceneId === target.id || track.originSceneId === target.id || track.reattachedToSceneId === target.id);
    if (existing) {
      setSelectedAudioId(existing.id);
      setSelectedId('');
      openInspector('clip');
      setWarning('This scene audio is already detached. The existing audio clip is selected.');
      return;
    }
    const track = buildDetachedAudioTrack(target);
    const nextTracks = [...audioTracks, track];
    const nextScenes = scenes.map(scene => scene.id === target.id ? { ...scene, muted: true } : scene);
    setAudioTracks(nextTracks);
    setScenes(nextScenes);
    loadWaveform(track.id, track.path, track);
    setSelectedAudioId(track.id);
    setSelectedId('');
    setWarning('');
    setProgress({ pct: 100, phase: 'Audio detached and placed in sync below the video.' });
    commitTimelineHistory(nextScenes, nextTracks, captions);
  };

  const detachAllVideoAudio = () => {
    if (projectBusyRef.current || trackStates.videoLocked || trackStates.audioLocked) {
      if (trackStates.videoLocked || trackStates.audioLocked) setWarning('Unlock the video and audio tracks before using Detach Audio.');
      return;
    }
    const candidates = scenes.filter(scene => scene.kind === 'video' && scene.hasAudio !== false && !scene.disabled);
    if (!candidates.length) {
      setWarning('Add at least one video with audio to the timeline before detaching audio.');
      return;
    }
    const newlyCreated = [];
    const detachedSceneIds = new Set();
    for (const scene of candidates) {
      const existing = audioTracks.find(track => [track.detachedFromSceneId, track.originSceneId, track.reattachedToSceneId].includes(scene.id));
      if (!existing) {
        newlyCreated.push(buildDetachedAudioTrack(scene));
        detachedSceneIds.add(scene.id);
      }
    }
    if (!newlyCreated.length) {
      setProgress({ pct: 100, phase: 'All video clips already have their audio detached to Audio tracks.' });
      return;
    }
    const nextTracks = [...audioTracks, ...newlyCreated];
    const nextScenes = scenes.map(scene => detachedSceneIds.has(scene.id) ? { ...scene, muted: true } : scene);
    setAudioTracks(nextTracks);
    setScenes(nextScenes);
    newlyCreated.forEach(track => loadWaveform(track.id, track.path, track));
    setSelectedAudioId(newlyCreated[0].id);
    setSelectedId('');
    setWarning('');
    setProgress({ pct: 100, phase: `Detached audio for ${newlyCreated.length} video clip${newlyCreated.length === 1 ? '' : 's'} onto synchronized Audio tracks.` });
    commitTimelineHistory(nextScenes, nextTracks, captions);
  };

  const unlinkAudioTrack = (trackId = '') => {
    if (projectBusyRef.current || trackStates.audioLocked) return;
    const targetId = (typeof trackId === 'string' && trackId) || selectedAudio?.id;
    const target = audioTracks.find(track => track.id === targetId);
    if (!target) return;
    const nextTracks = audioTracks.map(track => track.id === target.id ? {
      ...track,
      detachedFromSceneId: '',
      originSceneId: '',
      reattachedToSceneId: '',
      timelineOffsetWithinScene: undefined,
      pastedAudio: true,
    } : track);
    setAudioTracks(nextTracks);
    setProgress({ pct: 100, phase: `${target.name} unlinked from its source video clip for free independent timeline placement.` });
    commitTimelineHistory(scenes, nextTracks, captions);
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
    if (projectBusyRef.current) return;
    if (!scenes.length) {
      setWarning('No scenes found on the timeline.');
      return;
    }
    const newOverlays = [];
    let cumulativeTime = 0;
    scenes.forEach((scene, index) => {
      const duration = sceneOutputDuration(scene);
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

  const cancelVoiceGeneration = async () => {
    try { await window.electronAPI?.cancelVoiceGeneration?.(); } catch (_) {}
    setAudioMorphing(false);
    setProgress({ pct: 0, phase: 'Voice generation cancelled. Choose another voice and try again.' });
  };

  const addTextOverlay = () => {
    if (projectBusyRef.current || !totalDuration) return;
    const item = { id: uid(), text: 'My Company', x: 50, y: 25, fontSize: 64, opacity: .8, color: '#ffffff', fontFamily: 'Arial', shape: 'none', depth: 4, start: 0, end: Math.max(.1, totalDuration) };
    setTextOverlays(current => [...current, item]);
    setSelectedTextId(item.id); setSelectedId(''); setSelectedAudioId(''); setSelectedCaptionId(''); openInspector('text');
  };
  const patchTextOverlay = (id, patch) => { if (!projectBusyRef.current) { setTextOverlays(current => current.map(item => item.id === id ? { ...item, ...patch } : item)); setResult(null); } };
  const beginTextDrag = (event, item) => {
    if (projectBusyRef.current || !viewer.current || !previewFrame.width) return;
    event.preventDefault(); event.stopPropagation(); setSelectedTextId(item.id); setSelectedId(''); setSelectedAudioId(''); setSelectedCaptionId('');
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
      else await previewViewport.current?.requestFullscreen?.();
      window.setTimeout(updatePreviewFrame, 120);
    } catch (error) { setWarning(`Fullscreen preview could not open: ${error.message}`); }
  };

  const beginWatermarkDrag = event => {
    if (projectBusyRef.current || !watermark || !viewer.current || !previewFrame.width || !previewFrame.height) return;
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
    if (projectBusyRef.current || !viewer.current || !previewFrame.width) return;
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

  const trimSelectedAudioToPlayhead = edge => {
    if (!selectedAudio || projectBusyRef.current || trackStates.audioLocked) return;
    try {
      const start = Number(selectedAudio.start), end = start + Number(selectedAudio.duration);
      const edit = editAudioSelection(projectData(), selectedAudio.id, edge === 'start' ? playheadTime : start, edge === 'end' ? playheadTime : end, { action: 'keep' });
      applyTimelineState(edit.project); updateAudioSelection(null);
      const trimmed = edit.project.audioTracks.find(track => track.id === selectedAudio.id);
      loadWaveform(trimmed.id, trimmed.path, trimmed);
      setProgress({ pct: 100, phase: 'Audio trimmed at the playhead. Other tracks stay in place.' });
    } catch (error) { setWarning(error.message); }
  };

  const applyExportPreset = preset => {
    const values = {
      youtube4k: { resolution: '4k', fps: 30, quality: 'maximum' },
      cinematic: { resolution: '4k', fps: 24, quality: 'maximum' },
      shorts: { resolution: 'vertical', aspectRatio: '9:16', fps: 30, quality: 'balanced' },
      reels: { resolution: 'vertical', aspectRatio: '9:16', fps: 30, quality: 'maximum' },
      smooth: { resolution: '1440p', fps: 60, quality: 'balanced' },
    }[preset];
    setSettings(current => ({ ...current, ...values }));
  };

  const moveScene = (id, direction) => {
    if (projectBusyRef.current || trackStates.videoLocked) return;
    const order = scenes.map(scene => scene.id); const index = order.indexOf(id); const next = index + direction;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    try { applyTimelineState(reorderScenes(projectData(), order)); } catch (error) { setWarning(error.message); }
  };
  const moveSceneTo = (sourceId, targetId) => {
    if (projectBusyRef.current || trackStates.videoLocked || sourceId === targetId) return;
    const order = scenes.map(scene => scene.id); const from = order.indexOf(sourceId); const to = order.indexOf(targetId);
    if (from < 0 || to < 0) return;
    order.splice(from, 1); order.splice(to, 0, sourceId);
    try { applyTimelineState(reorderScenes(projectData(), order)); } catch (error) { setWarning(error.message); }
  };
  const sceneTimelineOffset = id => entries.find(entry => entry.scene.id === id)?.start || 0;

  useEffect(() => {
    if (!scenes.length || !audioTracks.length) return;
    setAudioTracks(current => {
      let changed = false;
      const next = current.map(track => {
        const explicitSceneId = track.originSceneId || track.detachedFromSceneId || track.reattachedToSceneId;
        const sourceScene = scenes.find(scene => scene.id === explicitSceneId) || (!track.pastedAudio && /detached audio|reattached edited audio|before cut|after cut/i.test(track.name || '') ? scenes.find(scene => scene.path === track.path) : null);
        if (!sourceScene) return track;
        const sceneStart = sceneTimelineOffset(sourceScene.id);
        const sceneDuration = Number(sourceScene.duration || 0) / (sourceScene.kind === 'image' ? 1 : Math.max(.25, Number(sourceScene.speed || 1)));
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

  const seekTimeline = (value, precise = false) => {
    let target = Math.max(0, Math.min(totalDuration, Number(value) || 0));
    if (snapEnabled && !precise) {
      const points = [0, totalDuration, ...entries.flatMap(entry => [entry.start, entry.end]), ...audioTracks.flatMap(track => [Number(track.start), Number(track.start) + Number(track.duration)]), ...captions.flatMap(cue => [cue.start, cue.end]), ...markers.map(marker => marker.time)];
      const closest = points.reduce((best, point) => Math.abs(point - target) < Math.abs(best - target) ? point : best, points[0]);
      if (Math.abs(closest - target) <= Math.max(.04, .22 / timelineZoom)) target = closest;
    }
    playheadRef.current = target; setPlayheadTime(target);
    const entry = entries.find(item => target >= item.start && target < item.end) || entries.at(-1);
    if (entry?.scene.id === programScene?.id && entry.scene.kind === 'video' && preview.current?.tagName === 'VIDEO') {
      try { preview.current.currentTime = Number(entry.scene.trimStart || 0) + Math.max(0, target - entry.start) * Number(entry.scene.speed || 1); } catch (_) {}
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

  const applyStutterCuts = cuts => {
    if (projectBusyRef.current || !cuts?.length || trackStates.videoLocked || trackStates.audioLocked || trackStates.captionsLocked) { setWarning('Unlock the affected tracks before removing speech ranges.'); return; }
    try {
      const ranges = [...cuts].sort((a, b) => a.start - b.start).reduce((all, cut) => {
        const last = all.at(-1); if (last && cut.start <= last.end) last.end = Math.max(last.end, cut.end); else all.push({ start: cut.start, end: cut.end }); return all;
      }, []);
      let next = projectData(); for (const range of ranges.reverse()) next = deleteTimeRange(next, range.start, range.end);
      applyTimelineState(next); setDetectedStutters([]); setProgress({ pct: 100, phase: 'Selected speech ranges removed with captions, titles and linked audio synchronized.' });
    } catch (error) { setWarning(error.message); }
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
    if (audioDragRef.current || event.target.closest('.mx-audio-delete, .mx-trim-handle, .mx-audio-selection')) return;
    setSelectedTextId('');
    setSelectedAudioId(track.id); setSelectedId(''); setSelectedCaptionId(''); setSelectedIds([]); openInspector('clip');
    const exactTime = audioTimeAtPointer(event, track);
    seekTimeline(exactTime);
    if (projectBusyRef.current || trackStates.audioLocked || audioCutSelectionModeId !== track.id) return;
    const current = audioSelectionRef.current;
    if (current?.trackId === track.id && current.awaitingEnd) {
      const selectionStart = Math.min(Number(current.anchor), exactTime);
      const selectionEnd = Math.max(Number(current.anchor), exactTime);
      if (selectionEnd - selectionStart < MIN_AUDIO_RANGE_SECONDS) return;
      updateAudioSelection({ trackId: track.id, start: selectionStart, end: selectionEnd, awaitingEnd: false, anchor: Number(current.anchor) });
      setAudioCutSelectionModeId('');
      setProgress({ pct: 100, phase: `END set at ${exactTime.toFixed(3)}s. Exact selected length: ${Math.abs(exactTime - Number(current.anchor)).toFixed(3)} seconds.` });
    } else {
      const start = Math.min(exactTime, Number(track.start) + Number(track.duration) - MIN_AUDIO_RANGE_SECONDS);
      updateAudioSelection({ trackId: track.id, start, end: start + MIN_AUDIO_RANGE_SECONDS, awaitingEnd: true, anchor: exactTime });
      setProgress({ pct: 100, phase: `START set at ${exactTime.toFixed(3)}s. Now click the audio again where you want END.` });
    }
  };

  const beginCutPositionSelection = trackId => {
    if (projectBusyRef.current || trackStates.audioLocked) return;
    setSelectedAudioId(trackId); setSelectedId(''); setSelectedCaptionId(''); setSelectedTextId(''); setSelectedIds([]); openInspector('clip');
    updateAudioSelection(null); setAudioCutSelectionModeId(trackId);
    setProgress({ pct: 100, phase: 'Drag to select audio, or click In then Out. Removal leaves the selected gap.' });
  };

  function updateAudioSelection(next) {
    stopAudioSelectionPreview();
    audioSelectionRef.current = next; setAudioSelection(next);
  }
  const audioTimeAtPointer = (event, track) => {
    const lane = event.currentTarget.closest('.mx-position-lane');
    const rect = lane?.getBoundingClientRect();
    if (!rect) return Number(track.start);
    return Math.max(Number(track.start), Math.min(Number(track.start) + Number(track.duration), (event.clientX - rect.left) / Math.max(1, rect.width) * totalDuration));
  };
  const changeAudioRange = (start, end) => {
    if (!selectedAudio || projectBusyRef.current || trackStates.audioLocked) return;
    try {
      validateAudioSelection(projectData(), selectedAudio.id, start, end);
      updateAudioSelection({ trackId: selectedAudio.id, start, end, awaitingEnd: false });
      setAudioCutSelectionModeId(''); setWarning('');
    } catch (error) { setWarning(error.message); }
  };
  const watchAudioRangePointer = (event, move, finish) => {
    audioRangeGestureRef.current?.();
    const pointerId = event.pointerId;
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel); window.removeEventListener('blur', onBlur);
      audioRangeGestureRef.current = null;
    };
    const onMove = next => { if (next.pointerId === pointerId && !projectBusyRef.current && !trackStates.audioLocked) move(next); };
    const onUp = next => { if (next.pointerId !== pointerId) return; cleanup(); finish?.(next, false); };
    const onCancel = next => { if (next.pointerId !== pointerId) return; cleanup(); finish?.(next, true); };
    const onBlur = () => { cleanup(); finish?.(null, true); };
    audioRangeGestureRef.current = () => { cleanup(); finish?.(null, true); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onCancel); window.addEventListener('blur', onBlur);
  };
  const beginAudioRange = (event, track) => {
    if (event.button !== 0 || projectBusyRef.current || trackStates.audioLocked) return;
    event.preventDefault(); event.stopPropagation();
    const lane = event.currentTarget.closest('.mx-position-lane');
    const pointAt = next => audioTimeAtPointer({ currentTarget: lane, clientX: next.clientX }, track);
    const anchor = pointAt(event), originX = event.clientX;
    const previous = audioSelectionRef.current;
    let moved = false;
    watchAudioRangePointer(event, next => {
      if (Math.abs(next.clientX - originX) < 3 && !moved) return;
      const point = pointAt(next), start = Math.min(anchor, point), end = Math.max(anchor, point);
      if (end - start < MIN_AUDIO_RANGE_SECONDS) return;
      moved = true; updateAudioSelection({ trackId: track.id, start, end, awaitingEnd: false }); seekTimeline(point);
    }, (_, cancelled) => {
      if (cancelled) { updateAudioSelection(previous); return; }
      if (moved) {
        audioDragRef.current = true; setAudioCutSelectionModeId('');
        setProgress({ pct: 100, phase: 'Audio range selected. Preview it, adjust In/Out, or remove it and leave a gap.' });
        window.setTimeout(() => { audioDragRef.current = false; }, 0);
      }
    });
  };

  const setAudioSelectionEdge = edge => {
    if (!selectedAudio || projectBusyRef.current || trackStates.audioLocked) return;
    const clipStart = Number(selectedAudio.start);
    const clipEnd = clipStart + Number(selectedAudio.duration);
    const point = Math.max(clipStart, Math.min(clipEnd, playheadTime));
    const current = audioSelectionRef.current;
    const base = current?.trackId === selectedAudio.id ? current : { trackId: selectedAudio.id, start: clipStart, end: clipEnd };
    changeAudioRange(edge === 'start' ? Math.min(point, base.end - MIN_AUDIO_RANGE_SECONDS) : base.start, edge === 'end' ? Math.max(point, base.start + MIN_AUDIO_RANGE_SECONDS) : base.end);
  };

  const beginAudioSelectionHandle = (event, track, edge) => {
    if (event.button !== 0 || projectBusyRef.current || trackStates.audioLocked || audioCutSelectionModeId === track.id) return;
    event.preventDefault(); event.stopPropagation();
    const lane = event.currentTarget.closest('.mx-position-lane'), rect = lane?.getBoundingClientRect();
    const origin = audioSelectionRef.current;
    if (!rect || !origin || origin.awaitingEnd) return;
    const originX = event.clientX, clipStart = Number(track.start), clipEnd = clipStart + Number(track.duration);
    watchAudioRangePointer(event, next => {
      const point = audioTimeAtPointer({ currentTarget: lane, clientX: next.clientX }, track);
      let start = origin.start, end = origin.end;
      if (edge === 'start') start = Math.min(point, end - MIN_AUDIO_RANGE_SECONDS);
      else if (edge === 'end') end = Math.max(point, start + MIN_AUDIO_RANGE_SECONDS);
      else { start = Math.max(clipStart, Math.min(clipEnd - (end - start), origin.start + (next.clientX - originX) / rect.width * totalDuration)); end = start + origin.end - origin.start; }
      updateAudioSelection({ ...origin, start, end, awaitingEnd: false }); seekTimeline(edge === 'end' ? end : start);
    }, (_, cancelled) => { if (cancelled) updateAudioSelection(origin); });
  };

  function stopAudioSelectionPreview() {
    const session = audioRangePlaybackRef.current;
    session.token++; cancelAnimationFrame(session.frame); clearTimeout(session.timer); session.cleanup?.(); session.cleanup = null;
    audioSelectionPreview.current?.pause(); setAudioRangePreviewing(false);
  }
  const previewAudioSelection = async () => {
    if (projectBusyRef.current || trackStates.audioLocked || !selectedAudio || audioSelection?.trackId !== selectedAudio.id || audioSelection.awaitingEnd || !audioSelectionPreview.current) return;
    stopAudioSelectionPreview();
    const session = audioRangePlaybackRef.current, token = session.token, audio = audioSelectionPreview.current;
    try {
      const range = validateAudioSelection(projectData(), selectedAudio.id, audioSelection.start, audioSelection.end);
      preview.current?.pause(); setIsPreviewPlaying(false);
      setAudioRangePreviewing(true);
      const waitFor = (name, ready) => ready() ? Promise.resolve() : new Promise((resolve, reject) => {
        let timeout;
        const cleanup = () => { clearTimeout(timeout); audio.removeEventListener(name, done); audio.removeEventListener('error', failed); session.cleanup = null; };
        const done = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('The audio source could not be loaded.')); };
        session.cleanup = () => { cleanup(); resolve(); };
        audio.addEventListener(name, done, { once: true }); audio.addEventListener('error', failed, { once: true });
        timeout = window.setTimeout(failed, 15000);
      });
      await waitFor('loadedmetadata', () => audio.readyState >= 1);
      if (session.token !== token) return;
      audio.playbackRate = range.speed; audio.currentTime = range.sourceStart;
      await waitFor('seeked', () => !audio.seeking);
      if (session.token !== token) return;
      const gainAt = sourceTime => Math.max(0, Math.min(1, selectedAudio.muted || trackStates.audioMuted ? 0 : Number(selectedAudio.volume ?? 1) * audioFadeGain(selectedAudio, Math.max(0, (sourceTime - Number(selectedAudio.trimStart || 0)) / range.speed))));
      audio.volume = gainAt(range.sourceStart);
      await audio.play();
      if (session.token !== token) return;
      setAudioRangePreviewing(true); setWarning('');
      const tick = () => {
        if (session.token !== token) return;
        if (audio.currentTime >= range.sourceEnd || audio.ended) { stopAudioSelectionPreview(); return; }
        audio.volume = gainAt(Math.min(range.sourceEnd, audio.currentTime));
        clearTimeout(session.timer);
        // Re-arm from the media clock after buffering/seeking; timeupdate alone is too coarse.
        if (!audio.seeking && audio.readyState >= 2 && !audio.paused) session.timer = window.setTimeout(() => {
          if (session.token === token && audio.currentTime >= range.sourceEnd - .002 * range.speed) stopAudioSelectionPreview();
        }, Math.max(1, (range.sourceEnd - audio.currentTime) / range.speed * 1000));
        session.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) {
      if (session.token === token) { stopAudioSelectionPreview(); setWarning(`Selected audio preview could not play: ${error.message}`); }
    }
  };

  const removeHighlightedAudio = (forceRipple = false) => {
    if (projectBusyRef.current || trackStates.audioLocked) return;
    if (!selectedAudio || audioSelection?.trackId !== selectedAudio.id || audioSelection.awaitingEnd) { setWarning('Select the audio range to remove first.'); return; }
    try {
      const useRipple = forceRipple === true;
      const edit = editAudioSelection(projectData(), selectedAudio.id, audioSelection.start, audioSelection.end, { action: 'delete', ripple: useRipple, idFactory: uid });
      stopAudioSelectionPreview(); applyTimelineState(edit.project); setSelectedAudioId(edit.selectedId);
      updateAudioSelection(null); setAudioCutSelectionModeId('');
      edit.project.audioTracks.filter(track => edit.pieceIds.includes(track.id)).forEach(piece => loadWaveform(piece.id, piece.path, piece));
      setProgress({ pct: 100, phase: useRipple ? `${edit.removedDuration.toFixed(3)} seconds of waste voice removed and gap closed on the same Audio track.` : `${edit.removedDuration.toFixed(3)} seconds removed. The silent gap and all other timeline positions are preserved.` });
    } catch (error) { setWarning(error.message); }
  };

  const reattachSelectedAudio = (targetAudioId = '') => {
    if (projectBusyRef.current || trackStates.audioLocked) return;
    const targetAudio = (typeof targetAudioId === 'string' && targetAudioId ? audioTracks.find(track => track.id === targetAudioId) : null)
      || selectedAudio
      || (selected ? audioTracks.find(track => [track.detachedFromSceneId, track.originSceneId, track.reattachedToSceneId].includes(selected.id)) : null);
    if (!targetAudio) return;
    const legacyScenes = scenes.filter(scene => scene.path === targetAudio.path && Number(targetAudio.start) >= sceneTimelineOffset(scene.id) && Number(targetAudio.start) + Number(targetAudio.duration) <= sceneTimelineOffset(scene.id) + sceneOutputDuration(scene));
    const sceneId = targetAudio.originSceneId || targetAudio.detachedFromSceneId || targetAudio.reattachedToSceneId || (!targetAudio.pastedAudio && legacyScenes.length === 1 ? legacyScenes[0].id : '');
    const scene = scenes.find(item => item.id === sceneId);
    if (!scene) { setWarning('The source video for this detached audio could not be found. Keep the audio on its current synchronized track.'); return; }
    const related = audioTracks.filter(track => (track.originSceneId || track.detachedFromSceneId || track.reattachedToSceneId) === sceneId || (track.id === targetAudio.id && !track.pastedAudio && !(track.originSceneId || track.detachedFromSceneId || track.reattachedToSceneId)));
    const originalStart = sceneTimelineOffset(sceneId);
    const originalDuration = Number(scene.duration || 0) / Math.max(.25, Number(scene.speed || 1));
    const untouched = related.length === 1 && Math.abs(Number(related[0].start) - originalStart) < 1e-9 && Math.abs(Number(related[0].duration) - originalDuration) < 1e-9 && Math.abs(Number(related[0].trimStart) - Number(scene.trimStart || 0)) < 1e-9 && Number(related[0].speed || 1) === Number(scene.speed || 1) && Number(related[0].volume ?? 1) === Number(scene.volume ?? 1) && !related[0].muted && !related[0].fadeIn && !related[0].fadeOut && !related[0].fadeEnvelope;
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
    event.preventDefault(); event.stopPropagation();
    if (event.button !== 0 || projectBusyRef.current || trackStates.audioLocked || audioCutSelectionModeId === track.id) return;
    waveformRequestsRef.current.delete(track.id);
    const laneWidth = event.currentTarget.closest('.mx-position-lane')?.getBoundingClientRect().width || 1;
    const originX = event.clientX, speed = Number(track.speed || 1), clipStart = Number(track.start), clipEnd = clipStart + Number(track.duration);
    const sceneId = track.originSceneId || track.detachedFromSceneId || track.reattachedToSceneId;
    const entry = entries.find(item => item.scene.id === sceneId);
    const minStart = Math.max(entry?.start || 0, clipStart - Number(track.trimStart || 0) / speed);
    const maxEnd = Math.min(entry?.end ?? Infinity, clipStart + ((Number(track.sourceDuration) || Number(track.trimStart || 0) + Number(track.duration) * speed) - Number(track.trimStart || 0)) / speed);
    const originalTracks = audioTracks;
    let finalTracks = originalTracks, changed = false;
    setSelectedAudioId(track.id); setSelectedId(''); setSelectedCaptionId('');
    watchAudioRangePointer(event, next => {
      const delta = (next.clientX - originX) / laneWidth * totalDuration;
      const start = edge === 'left' ? Math.max(minStart, Math.min(clipEnd - MIN_AUDIO_RANGE_SECONDS, clipStart + delta)) : clipStart;
      const end = edge === 'right' ? Math.min(maxEnd, Math.max(clipStart + MIN_AUDIO_RANGE_SECONDS, clipEnd + delta)) : clipEnd;
      const offset = start - clipStart;
      const edited = { ...track, start, duration: end - start, trimStart: Number(track.trimStart || 0) + offset * speed, waveform: [], waveformLoading: false };
      if (entry) Object.assign(edited, { detachedOffset: start - entry.start, timelineOffsetWithinScene: start - entry.start });
      if (track.fadeEnvelope) {
        const envelopeOffset = track.fadeEnvelope.offset + offset;
        if (envelopeOffset >= 0 && envelopeOffset + edited.duration <= track.fadeEnvelope.duration + 1e-9) edited.fadeEnvelope = { ...track.fadeEnvelope, offset: envelopeOffset };
        else delete edited.fadeEnvelope;
      } else if (track.fadeIn || track.fadeOut) {
        if (start >= clipStart && end <= clipEnd) edited.fadeEnvelope = { offset, duration: track.duration, fadeIn: track.fadeIn || 0, fadeOut: track.fadeOut || 0 };
      }
      try {
        finalTracks = originalTracks.map(item => item.id === track.id ? edited : item);
        normalizeProject({ ...projectData(), audioTracks: finalTracks });
        changed = start !== clipStart || end !== clipEnd;
        audioEditGestureRef.current = true; setAudioTracks(finalTracks); setResult(null); setPlayheadTime(edge === 'left' ? start : end);
      } catch (error) { setWarning(error.message); }
    }, (_, cancelled) => {
      audioEditGestureRef.current = false;
      if (cancelled) { setAudioTracks(originalTracks); return; }
      if (changed) { commitTimelineHistory(scenes, finalTracks, captions); loadWaveform(track.id, track.path, finalTracks.find(item => item.id === track.id)); }
    });
  };

  const beginAudioMove = (event, track) => {
    if (projectBusyRef.current) return;
    if (audioCutSelectionModeId === track.id || event.shiftKey) {
      setSelectedAudioId(track.id); setSelectedId(''); setSelectedCaptionId('');
      beginAudioRange(event, track);
      return;
    }
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
      if (!moved || projectBusyRef.current) return;
      
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

      audioEditGestureRef.current = true;
      setAudioTracks(current => {
        finalAudioTracks = current.map(item => {
          if (item.id === track.id) {
            return { 
              ...item, 
              start, 
              detachedFromSceneId: '', originSceneId: '', pastedAudio: true,
              reattachedToSceneId: ''
            };
          }
          return item;
        });
        return finalAudioTracks;
      });
      
      setPlayheadTime(start);
    };
    
    const stop = (_, cancelled) => {
      audioEditGestureRef.current = false;
      if (cancelled) { setAudioTracks(audioTracks); audioDragRef.current = false; return; }
      audioDragRef.current = moved;
      window.setTimeout(() => { audioDragRef.current = false; }, 0);
      if (moved) commitTimelineHistory(scenes, finalAudioTracks, captions);
    };
    
    watchAudioRangePointer(event, move, stop);
  };

  const togglePreviewPlayback = () => {
    if (!programScene || !active) return;
    stopAudioSelectionPreview();
    if (!isPreviewPlaying && playheadTime >= totalDuration - 1 / Number(settings.fps || 30)) seekTimeline(0, true);
    setIsPreviewPlaying(value => !value);
  };
  const finishCurrentScene = () => {
    if (!programEntry) return;
    if (playbackMode === 'continuous' && programEntry.index < entries.length - 1) {
      playheadRef.current = programEntry.end; setPlayheadTime(programEntry.end);
    } else { setIsPreviewPlaying(false); setPlayheadTime(programEntry.end); }
  };
  useEffect(() => {
    if (!active || !isPreviewPlaying || !programScene) { preview.current?.pause?.(); setProgramWaiting(false); return; }
    const media = preview.current;
    const isVideo = !programScene.disabled && programScene.kind === 'video' && media?.tagName === 'VIDEO';
    let frame; let lastUpdate = 0; let previousTick = performance.now(); let disposed = false; let prepared = !isVideo; let waiting = isVideo;
    setProgramWaiting(waiting);
    const setWaiting = value => { if (waiting !== value) { waiting = value; setProgramWaiting(value); } };
    const prepareVideo = () => {
      if (media.readyState < 1 || media.seeking) return;
      const desired = Math.min(Number(media.duration) || Infinity, Number(programScene.trimStart || 0) + Math.max(0, playheadRef.current - programEntry.start) * Number(programScene.speed || 1));
      if (Math.abs(media.currentTime - desired) > .0005) {
        try { media.currentTime = desired; } catch (_) {}
        return;
      }
      if (media.readyState < 2) return;
      media.playbackRate = Number(programScene.speed || 1);
      prepared = true;
      media.play().catch(error => {
        if (disposed || !playingRef.current) return;
        setWarning(`Preview could not play: ${error.message}`); setIsPreviewPlaying(false);
      });
    };
    const tick = now => {
      if (disposed || !playingRef.current) return;
      if (isVideo && !prepared) prepareVideo();
      // A newly mounted source must finish metadata loading and its trim seek
      // before media time can drive the timeline or start the next scene.
      if (isVideo && (!prepared || media.seeking || media.readyState < 2)) {
        setWaiting(true);
        previousTick = now; frame = requestAnimationFrame(tick); return;
      }
      setWaiting(false);
      const time = isVideo
        ? programEntry.start + Math.max(0, media.currentTime - Number(programScene.trimStart || 0)) / Number(programScene.speed || 1)
        : playheadRef.current + (now - previousTick) / 1000;
      previousTick = now;
      playheadRef.current = time;
      if (time >= programEntry.end - .5 / Number(settings.fps || 30)) { finishCurrentScene(); return; }
      if (now - lastUpdate >= 1000 / Math.min(60, Number(settings.fps || 30))) { playheadRef.current = time; setPlayheadTime(time); lastUpdate = now; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { disposed = true; cancelAnimationFrame(frame); media?.pause?.(); };
  }, [active, isPreviewPlaying, programScene?.id, programScene?.speed, playbackMode, totalDuration]);
  useEffect(() => { updatePreviewFrame(); }, [canvasSize, programScene?.id]);
  const placeMediaOnTimeline = asset => {
    if (projectBusyRef.current || trackStates.videoLocked) { setWarning('Unlock the video track and finish active processing before adding a clip.'); return; }
    const placed = { ...asset, id: uid(), libraryId: asset.libraryId || asset.id, probeError: '' };
    try { applyTimelineState(insertScene(projectData(), placed, scenes.length)); setSelectedId(placed.id); setSelectedAudioId(''); setSelectedCaptionId(''); seekTimeline(totalDuration, true); }
    catch (error) { setWarning(error.message); }
  };

  const addAutoAllScenes = () => {
    if (projectBusyRef.current) return;
    if (trackStates.videoLocked || trackStates.audioLocked || trackStates.captionsLocked) { setWarning('Unlock video, audio and caption tracks before adding all scenes in order.'); return; }
    try {
      const ordered = addAllMediaToTimeline(projectData(), mediaLibrary, { idFactory: uid });
      if (!ordered.project.scenes.length) { setWarning('Import videos or images before using Add Auto All.'); return; }
      if (ordered.addedCount || ordered.reordered) applyTimelineState(ordered.project);
      setSelectedId(ordered.project.scenes[0].id); setSelectedIds([]); setSelectedAudioId(''); setSelectedCaptionId(''); setSelectedTextId('');
      setIsPreviewPlaying(false); setSourceAsset(null); seekTimeline(0, true); setWarning('');
      setProgress({ pct: 100, phase: ordered.addedCount ? `Added ${ordered.addedCount} scene${ordered.addedCount === 1 ? '' : 's'} in scene-number order. Undo restores your previous timeline.` : ordered.reordered ? 'Scenes reordered by scene number. Undo restores your previous order.' : 'All imported scenes are already on the timeline in scene-number order.' });
    } catch (error) { setWarning(error.message); }
  };

  const activateLibraryAsset = asset => {
    const existing = scenes.find(scene => scene.libraryId === asset.id);
    if (existing) {
      setSelectedId(existing.id); setSelectedAudioId(''); setSelectedCaptionId(''); setPlayheadTime(sceneTimelineOffset(existing.id));
      setProgress({ pct: 100, phase: `${asset.name} selected on the timeline.` });
    } else placeMediaOnTimeline(asset);
  };

  const razorCut = () => {
    if (projectBusyRef.current) return;
    try {
      const audioUnderPlayhead = audioTracks.find(track => playheadTime > Number(track.start) + 1e-4 && playheadTime < Number(track.start) + Number(track.duration) - 1e-4);
      const targetAudio = selectedAudio
        ? (playheadTime > Number(selectedAudio.start) + 1e-4 && playheadTime < Number(selectedAudio.start) + Number(selectedAudio.duration) - 1e-4 ? selectedAudio : (audioUnderPlayhead || selectedAudio))
        : (!selected && !selectedCaptionId ? audioUnderPlayhead : null);
      if (targetAudio) {
        if (trackStates.audioLocked) throw new Error('Unlock the audio track before splitting.');
        const local = playheadTime - Number(targetAudio.start);
        if (local <= 0 || local >= targetAudio.duration) throw new Error('Move the playhead inside the selected audio clip.');
        const base = projectData(), start = Number(targetAudio.start), end = start + Number(targetAudio.duration);
        const left = editAudioSelection(base, targetAudio.id, start, playheadTime, { action: 'keep' }).project.audioTracks.find(track => track.id === targetAudio.id);
        const right = editAudioSelection(base, targetAudio.id, playheadTime, end, { action: 'keep' }).project.audioTracks.find(track => track.id === targetAudio.id);
        right.id = uid();
        const hasPrecedingSplit = audioTracks.some(other => other.id !== targetAudio.id && Math.abs((Number(other.start) + Number(other.duration)) - start) < 0.05);
        const nextSelectedAudioId = hasPrecedingSplit ? left.id : right.id;
        applyTimelineState({ ...base, audioTracks: audioTracks.flatMap(track => track.id === targetAudio.id ? [left, right] : [track]) });
        setSelectedAudioId(nextSelectedAudioId); updateAudioSelection(null);
        [left, right].forEach(track => loadWaveform(track.id, track.path, track));
        setProgress({
          pct: 100,
          phase: hasPrecedingSplit
            ? `Waste voice segment (${(playheadTime - start).toFixed(2)}s) isolated on the same Audio track — press Delete to remove it!`
            : 'Audio split on the same Audio track. Move playhead to the end of the waste voice and press S (or ✂) again.',
        });
        setWarning('');
        return;
      } else if (selectedCaptionId) {
        if (trackStates.captionsLocked) throw new Error('Unlock captions before splitting.');
        const cue = captions.find(item => item.id === selectedCaptionId);
        if (!cue || playheadTime <= cue.start || playheadTime >= cue.end) throw new Error('Move the playhead inside the selected caption.');
        const leftWords = (cue.words || []).filter(word => word.start < playheadTime).map(word => ({ ...word, end: Math.min(word.end, playheadTime) }));
        const rightWords = (cue.words || []).filter(word => word.end > playheadTime).map(word => ({ ...word, start: Math.max(word.start, playheadTime) }));
        const rightId = uid();
        const nextCaptions = captions.flatMap(item => item.id !== cue.id ? [item] : [{ ...item, end: playheadTime, words: leftWords, text: leftWords.length ? leftWords.map(word => word.text || word.word).join(' ') : item.text }, { ...item, id: rightId, start: playheadTime, words: rightWords, text: rightWords.length ? rightWords.map(word => word.text || word.word).join(' ') : item.text }]);
        commitTimelineHistory(scenes, audioTracks, nextCaptions); setCaptions(nextCaptions); setSelectedCaptionId(rightId);
      } else {
        if (trackStates.videoLocked) throw new Error('Unlock the video track before splitting.');
        const target = selected || programScene; if (!target) return;
        const rightId = uid(); const next = splitSceneModel(projectData(), target.id, playheadTime, { rightId });
        applyTimelineState(next); setSelectedId(rightId); setSelectedIds([rightId]);
      }
      setProgress({ pct: 100, phase: 'Split at the playhead. Captions and other tracks remain synchronized.' }); setWarning('');
    } catch (error) { setWarning(error.message); }
  };

  const changeSelectedVideoVoice = async () => {
    if (projectBusyRef.current) return;
    if (!selected || selected.kind !== 'video') { setWarning('Select the video whose spoken voice you want to translate.'); return; }
    const sourceProbeError = selected.probeError || mediaLibrary.find(asset => asset.id === selected.libraryId)?.probeError;
    if (sourceProbeError) { setWarning('Wait for this video\'s media details to finish loading. If reading fails, import it again before translating narration.'); return; }
    if (trackStates.videoLocked || trackStates.audioLocked || trackStates.captionsLocked) { setWarning('Unlock video, audio and caption tracks before replacing narration.'); return; }
    if (!VOICE_MODELS[voiceLanguage]) { setWarning('Choose a voice language first.'); return; }
    if (typeof window.electronAPI?.transcribeVideo !== 'function' || typeof window.electronAPI?.exportSyncedTranslatedVideo !== 'function') { setWarning('The synchronized voice service is unavailable. Save your work and reopen the app after active jobs finish.'); return; }
    projectBusyRef.current = true;
    setVoiceChanging(true); setIsPreviewPlaying(false); setWarning('');
    try {
      const snapshot = createProjectSnapshot(projectData());
      const sourceScene = snapshot.scenes.find(scene => scene.id === selected.id);
      const nextCaptions = deleteScenesModel(snapshot, [sourceScene.id], { ripple: false }).captions;
      setProgress({ pct: 8, phase: `Listening to ${sourceScene.name} with ${captionEngine === 'groq' ? 'Groq' : 'Local Whisper'} and checking speech timing` });
      const transcribed = await window.electronAPI.transcribeVideo({ videoPath: sourceScene.path, languageHint: 'auto', engine: captionEngine, contentMode: 'speech' });
      if (!transcribed?.ok) throw new Error(transcribed?.error || 'The video speech could not be transcribed.');
      if (!Array.isArray(transcribed.words) || !transcribed.words.length) throw new Error('Word timestamps are required to synchronize narration. Generate the speech again with Local Whisper or Groq.');
      // The native service replaces the entire source, so retain source times; the scene's trim and speed still apply afterwards.
      const sourceCues = transcriptCues(transcribed, 40);
      setProgress({ pct: 35, phase: `Translating ${sourceCues.length} timed speech phrases to ${CAPTION_LANGUAGE_NAMES[voiceLanguage]}` });
      const translatedCues = await translateCueTexts(sourceCues, voiceLanguage, transcribed.language || 'auto');
      const translatedSegments = sourceCues.map((cue, index) => ({ start: cue.start, end: cue.end, text: cue.text, translatedText: translatedCues[index].text, timingSource: cue.timingSource }));
      setProgress({ pct: 65, phase: `Generating synchronized ${CAPTION_LANGUAGE_NAMES[voiceLanguage]} voice` });
      const response = await window.electronAPI.exportSyncedTranslatedVideo({ videoPath: sourceScene.path, segments: translatedSegments, voice: VOICE_GENDER_MODELS[voiceLanguage]?.[voiceGender] || VOICE_MODELS[voiceLanguage], singleVoice: true, voiceMode: voiceGender, targetLanguage: voiceLanguage, outputName: `${sourceScene.name.replace(/\.[^.]+$/, '')}-${voiceLanguage}-synced.mp4` });
      if (!response?.ok || !response.outputPath) throw new Error(response?.error || 'Synchronized translated video was not created.');
      const nextScenes = snapshot.scenes.map(scene => scene.id === sourceScene.id ? { ...scene, path: response.outputPath, name: `${sourceScene.name.replace(/\s*\[[^\]]+ voice\]$/i, '')} [${CAPTION_LANGUAGE_NAMES[voiceLanguage]} voice]`, hasAudio: true, muted: false, voiceLanguage } : scene);
      const nextAudio = snapshot.audioTracks.filter(track => ![track.detachedFromSceneId, track.originSceneId, track.reattachedToSceneId].includes(sourceScene.id));
      commitTimelineHistory(nextScenes, nextAudio, nextCaptions); setScenes(nextScenes); setAudioTracks(nextAudio); setCaptions(nextCaptions); setResult(null);
      if (!nextCaptions.some(cue => cue.id === selectedCaptionId)) setSelectedCaptionId('');
      setDetectedCaptionLanguage(''); setCaptionSampleVisible(false); openInspector('captions');
      setProgress({ pct: 100, phase: `${CAPTION_LANGUAGE_NAMES[voiceLanguage]} voice replaced using verified speech timing. Regenerate captions to match this narration; the clip's old captions can be restored with Undo.` });
    } catch (error) {
      setWarning(`Voice translation failed: ${error.message} Original video, audio and captions were preserved.`);
      setProgress({ pct: 0, phase: 'Voice translation stopped safely; the original video, audio and captions were not changed.' });
    } finally { projectBusyRef.current = false; setVoiceChanging(false); }
  };

  const removeScene = (id, forceRipple = false) => {
    if (projectBusyRef.current || trackStates.videoLocked) { setWarning('Unlock the video track before deleting.'); return; }
    try { applyTimelineState(deleteScenesModel(projectData(), [id], { ripple: forceRipple || rippleEnabled })); setSelectedId(''); setSelectedIds([]); }
    catch (error) { setWarning(error.message); }
  };
  const removeSelectedScenes = () => {
    if (!selectedIds.length || projectBusyRef.current || trackStates.videoLocked) return;
    try { applyTimelineState(deleteScenesModel(projectData(), selectedIds, { ripple: rippleEnabled })); setSelectedIds([]); setSelectedId(''); }
    catch (error) { setWarning(error.message); }
  };

  const removeAudioTrack = (id, forceRipple = false) => {
    const target = audioTracks.find(track => track.id === id);
    if (!target || projectBusyRef.current || trackStates.audioLocked) return;
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
    if (!selected || projectBusyRef.current || trackStates.videoLocked) return;
    const next = scenes[scenes.findIndex(scene => scene.id === selected.id) + 1];
    if (!next) { setWarning('Select a clip with another clip after it.'); return; }
    const group = selected.mergeGroup || uid();
    setScenes(current => current.map(scene => [selected.id, next.id].includes(scene.id) ? { ...scene, mergeGroup: group } : scene));
    setProgress({ pct: 100, phase: 'Adjacent clips grouped. Individual trims, effects and caption timing are preserved.' });
  };

  const duplicateScene = () => {
    if (!selected || projectBusyRef.current || trackStates.videoLocked) return;
    const id = uid();
    try { applyTimelineState(duplicateSceneModel(projectData(), selected.id, id)); setSelectedId(id); setSelectedIds([id]); }
    catch (error) { setWarning(error.message); }
  };

  const copyScene = () => {
    if (!selected) return;
    setSceneClipboard({ ...selected });
    setProgress({ pct: 100, phase: `${selected.name} copied. Select another scene and choose Paste Scene.` });
  };

  const pasteScene = () => {
    if (!sceneClipboard || projectBusyRef.current || trackStates.videoLocked) return;
    const copy = { ...sceneClipboard, id: uid(), name: `${sceneClipboard.name || 'Clip'} (copy)` };
    const index = scenes.findIndex(scene => scene.id === selected?.id) + 1;
    try { applyTimelineState(insertScene(projectData(), copy, index)); setSelectedId(copy.id); setSelectedAudioId(''); setSelectedCaptionId(''); }
    catch (error) { setWarning(error.message); }
  };
  const trimSceneToPlayhead = edge => {
    if (!selected || projectBusyRef.current || trackStates.videoLocked) return;
    const local = playheadTime - sceneTimelineOffset(selected.id);
    const sourceLocal = local * Number(selected.speed || 1);
    const patch = edge === 'start' ? { trimStart: Number(selected.trimStart || 0) + sourceLocal, duration: Number(selected.duration) - sourceLocal } : { duration: sourceLocal };
    try { applyTimelineState(trimSceneModel(projectData(), selected.id, patch)); setProgress({ pct: 100, phase: 'Trimmed to the playhead with synchronized captions and linked audio.' }); }
    catch (error) { setWarning(error.message); }
  };

  const renameSelectedScene = () => {
    if (!selected) return;
    const name = window.prompt('Rename selected clip:', selected.name);
    if (name?.trim()) patchScene(selected.id, { name: name.trim() });
  };

  const replaceSelectedScene = async () => {
    if (!selected || projectBusyRef.current || trackStates.videoLocked) return;
    try {
      const result = await window.electronAPI?.myExporterPickMedia?.();
      const filePath = result?.filePaths?.[0]; if (!result?.ok || result.canceled || !filePath) return;
      const probe = await window.electronAPI?.myExporterProbe?.({ filePath });
      if (!probe?.ok) throw new Error(probe?.error || 'Replacement media could not be read.');
      if (projectBusyRef.current) return;
      const withoutOldSpeech = deleteScenesModel(projectData(), [selected.id], { ripple: false }).captions;
      const next = trimSceneModel({ ...projectData(), captions: withoutOldSpeech }, selected.id, { trimStart: 0, duration: Math.min(Number(selected.duration), Number(probe.duration)) });
      const libraryId = uid();
      const asset = { id: libraryId, path: filePath, name: filePath.split(/[\\/]/).pop(), kind: 'video', sourceDuration: probe.duration, duration: probe.duration, trimStart: 0, speed: 1, width: probe.width, height: probe.height, hasAudio: probe.hasAudio, muted: false, volume: 1, fit: selected.fit || settings.framing };
      next.scenes = next.scenes.map(scene => scene.id === selected.id ? { ...scene, ...asset, id: scene.id, libraryId, duration: scene.duration, speed: scene.speed, probeError: '' } : scene);
      next.audioTracks = next.audioTracks.filter(track => ![track.originSceneId, track.detachedFromSceneId, track.reattachedToSceneId].includes(selected.id));
      applyTimelineState(next); setMediaLibrary(current => [...current, asset]); setProgress({ pct: 100, phase: 'Clip replaced. Other captions were preserved; regenerate speech for the replacement clip.' });
    } catch (error) { setWarning(`Replace clip failed: ${error.message}`); }
  };

  const locateSelectedSource = () => {
    if (!selected) return;
    setAssetTab('Media'); setOpenSidePanel('library');
    const source = mediaLibrary.find(asset => asset.id === selected.libraryId || asset.path === selected.path);
    if (source) { setSourceAsset(source); return; }
    const card = [...document.querySelectorAll('.mx-asset-card')].find(item => item.textContent.includes(selected.name));
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
    if (projectBusyRef.current || trackStates.audioLocked) return;
    if (!audioClipboard) { setWarning('Copy a detached audio clip first, then place the gold playhead where you want to paste it.'); return; }
    const targetScene = scenes.find((scene, index) => {
      const start = sceneTimelineOffset(scene.id);
      const duration = Number(scene.duration || 0) / (scene.kind === 'image' ? 1 : Math.max(.25, Number(scene.speed || 1)));
      return playheadTime >= start - .001 && (playheadTime < start + duration - .001 || index === scenes.length - 1);
    }) || scenes[scenes.length - 1];
    const sceneStart = targetScene ? sceneTimelineOffset(targetScene.id) : 0;
    const targetDuration = targetScene ? Number(targetScene.duration || 0) / (targetScene.kind === 'image' ? 1 : Math.max(.25, Number(targetScene.speed || 1))) : Number(audioClipboard.duration || .1);
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
    if (!selected) { setWarning('Select a clip before applying a filter.'); return; }
    const values = {
      natural: { brightness: 0, contrast: 1, saturation: 1 },
      vivid: { brightness: 0.02, contrast: 1.12, saturation: 1.28 },
      cinematic: { brightness: -0.03, contrast: 1.18, saturation: 0.82 },
      soft: { brightness: 0.05, contrast: 0.92, saturation: 0.9 },
      mono: { brightness: 0, contrast: 1.08, saturation: 0 },
      cyberpunk: { brightness: 0.03, contrast: 1.25, saturation: 1.45 },
      warm: { brightness: 0.04, contrast: 1.06, saturation: 1.2 },
      cool: { brightness: -0.01, contrast: 1.1, saturation: 0.88 },
      vintage: { brightness: 0.02, contrast: 0.94, saturation: 0.72 },
      noir: { brightness: -0.06, contrast: 1.38, saturation: 0 },
    }[preset];
    if (values) {
      patchScene(selected.id, values);
      setProgress({ pct: 100, phase: `Filmora 15 ${preset} LUT applied to ${selected.name}.` });
    }
  };

  const applyTransitionPreset = preset => {
    if (!selected) { setWarning('Select a clip before applying a transition.'); return; }
    if (preset === 'none') {
      patchScene(selected.id, { transition: 'none', transitionDuration: 0 });
      setProgress({ pct: 100, phase: `Hard cut set on ${selected.name}.` });
      return;
    }
    const durations = { 'fast-dip': 0.2, 'fade-black': 0.4, dissolve: 0.6, 'cinema-fade': 1.0, 'slow-fade': 1.4 };
    const duration = durations[preset] ?? 0.4;
    patchScene(selected.id, { transition: 'fade-black', transitionDuration: duration });
    setProgress({ pct: 100, phase: `Transition (${duration}s) applied to ${selected.name}.` });
  };

  const splitScene = () => razorCut();
  const cancelCaptionGeneration = async () => {
    captionController.current?.abort(new Error('Caption generation cancelled.'));
    if (captionNativePath.current) await window.electronAPI?.cancelTranscribeVideo?.({ videoPath: captionNativePath.current });
  };
  const generateCaptions = async () => {
    if (projectBusyRef.current || !scenes.some(scene => scene.kind === 'video' && !scene.disabled)) return null;
    const controller = new AbortController(); captionController.current = controller; projectBusyRef.current = true;
    const snapshot = createProjectSnapshot(projectData());
    const before = snapshot.captions;
    setCaptioning(true); setWarning(''); setDetectedCaptionLanguage('');
    const output = []; const detected = new Set();
    try {
      for (const entry of timelineEntries(snapshot.scenes)) {
        const scene = entry.scene;
        if (scene.kind !== 'video' || scene.disabled || scene.hasAudio === false) continue;
        if (controller.signal.aborted) throw controller.signal.reason;
        setProgress({ pct: Math.round(entry.start / Math.max(.1, totalDuration) * 90), phase: `Transcribing ${scene.name} with ${captionEngine === 'groq' ? 'Groq' : 'Local Whisper'}` });
        const metadata = await window.electronAPI?.myExporterProbe?.({ filePath: scene.path });
        const cacheKey = JSON.stringify({ version: 3, path: scene.path, fileSize: metadata?.fileSize, modifiedAt: metadata?.modifiedAt, engine: captionEngine, mode: 'speech' });
        const canCache = metadata?.ok && metadata?.fileSize > 0 && metadata?.modifiedAt > 0;
        const cached = canCache ? await window.electronAPI?.myExporterCaptionCacheLoad?.(cacheKey) : null;
        let native = cached?.ok && cached.found ? cached.data?.transcript : null;
        if (!native) {
          if (controller.signal.aborted) throw controller.signal.reason;
          captionNativePath.current = scene.path;
          native = await window.electronAPI.transcribeVideo({ videoPath: scene.path, languageHint: 'auto', engine: captionEngine, contentMode: 'speech' });
          captionNativePath.current = '';
          if (native?.cancelled || controller.signal.aborted) throw new Error('Caption generation cancelled.');
        }
        const sourceCues = transcriptCues(native);
        if (controller.signal.aborted) throw controller.signal.reason;
        if (canCache && !cached?.found) await window.electronAPI?.myExporterCaptionCacheSave?.(cacheKey, { transcript: native });
        const language = String(native.language || 'auto'); detected.add(language);
        const positioned = cuesForScene(sourceCues, scene, entry.start);
        const translated = await translateCueTexts(positioned, snapshot.captionLanguage, language, { signal: controller.signal });
        output.push(...translated.map(cue => ({ ...cue, id: uid() })));
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!output.length) throw new Error('No timed speech was detected. Previous captions are preserved.');
      commitTimelineHistory(scenes, audioTracks, output); setCaptions(output); setCaptionSampleVisible(false);
      setTrackStates(value => ({ ...value, captionsMuted: false })); setSettings(value => ({ ...value, burnCaptions: true }));
      setDetectedCaptionLanguage([...detected].join(', ')); setProgress({ pct: 100, phase: `${output.length} synchronized captions ready. Review before export.` });
      return output;
    } catch (error) {
      setCaptions(before); setWarning(`${error.message} Existing captions and edits were preserved.`);
      setProgress({ pct: 0, phase: controller.signal.aborted ? 'Caption generation cancelled' : 'Caption generation stopped' }); return null;
    } finally { captionNativePath.current = ''; captionController.current = null; projectBusyRef.current = false; setCaptioning(false); }
  };

  const exportVideo = async (captionsOverride = null, forceBurnCaptions = false, omitCaptions = false) => {
    if (!scenes.length || exportJobRef.current || voiceChanging || audioMorphing || cropSaving || (captionController.current && !Array.isArray(captionsOverride))) return false;
    const jobId = uid(); exportJobRef.current = jobId; projectBusyRef.current = true;
    setWarning(''); setExporting(true); setIsPreviewPlaying(false);
    try {
      const dialog = await window.electronAPI?.showSaveDialog?.({ title: 'Export video from My Exporter', defaultPath: `${safeFileBase(projectName !== 'Untitled Project' ? projectName : scenes[0]?.name) || 'My-Exporter'}.mp4`, filters: [{ name: 'MP4 Video', extensions: ['mp4'] }], buttonLabel: 'Export MP4' });
      if (dialog?.canceled || !dialog?.filePath || exportJobRef.current !== jobId) return false;
      setExportStartedAt(Date.now()); setExportClock(Date.now()); setResult(null);
      setProgress({ pct: 1, phase: 'Checking media, timings and output' });
      if (!window.electronAPI?.myExporterPreflight || !window.electronAPI?.myExporterExport) throw new Error('My Exporter background service is unavailable. Save your work and reopen the app when jobs are idle.');
      const payload = { ...settings, jobId, scenes: scenes.map(scene => ({ ...scene, fit: scene.fit || settings.framing || 'contain' })),
        captions: Array.isArray(captionsOverride) ? captionsOverride : captions, textOverlays,
        audioTracks: audioTracks.map(track => ({ ...track, muted: track.muted || trackStates.audioMuted })),
        burnCaptions: !omitCaptions && (forceBurnCaptions || settings.burnCaptions) && !trackStates.captionsMuted,
        musicPath: trackStates.audioMuted ? '' : music?.path || '', watermarkPath: watermarkEnabled ? watermark?.path || '' : '', outputPath: dialog.filePath };
      const check = await window.electronAPI.myExporterPreflight(payload);
      if (check?.cancelled || exportJobRef.current !== jobId) return false;
      if (check?.exportCapabilitiesVersion !== 2) throw new Error('The new editor needs the updated export service. Save your projects and reopen Pattan Presentator when all jobs are idle.');
      if (payload.audioTracks.some(track => track.fadeEnvelope) && check?.audioRangeFadeEnvelope !== true) throw new Error('Edited audio fades need the updated export service. Save your projects and reopen Pattan Presentator when all jobs are idle.');
      if (!check?.ok) throw new Error((check?.errors || ['Export validation failed.']).join('\n'));
      if (check.warnings?.length) setWarning(check.warnings.join('\n'));
      const response = await window.electronAPI.myExporterExport(payload);
      if (response?.cancelled || exportJobRef.current !== jobId) { setProgress({ pct: 0, phase: 'Export cancelled. Existing output files were preserved.' }); return false; }
      if (!response?.ok) throw new Error(response?.error || 'Export failed.');
      setResult(response); setProgress({ pct: 100, phase: `Exported ${response.width}×${response.height} MP4` });
      return true;
    } catch (error) { setWarning(error.message || 'Export failed.'); setProgress({ pct: 0, phase: 'Export stopped. Existing output files were preserved.' }); return false; }
    finally { if (exportJobRef.current === jobId) exportJobRef.current = ''; projectBusyRef.current = false; setExporting(false); }
  };
  const cancelExport = async () => {
    const jobId = exportJobRef.current; if (!jobId) return;
    setProgress(current => ({ ...current, phase: 'Cancelling this export…' }));
    try { await window.electronAPI?.myExporterCancel?.({ jobId }); exportJobRef.current = ''; }
    catch (error) { setWarning(`Cancellation failed: ${error.message}`); }
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
      if (!active || helpTopic) return;
      if (event.key === 'F1') { event.preventDefault(); openHelp('media'); return; }
      const tag = event.target?.tagName?.toLowerCase();
      if (['input', 'textarea', 'select', 'summary'].includes(tag) || event.target?.isContentEditable || event.target?.closest('[contenteditable=true], .mx-editor-menu[open]')) return;
      if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); return; }
      if (projectBusyRef.current) return;
      if (event.key === ' ' || event.code === 'Space') { event.preventDefault(); togglePreviewPlayback(); return; }
      if (!event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); seekTimeline(playheadTime - 1 / Number(settings.fps || 30), true); return; }
      if (!event.altKey && event.key === 'ArrowRight') { event.preventDefault(); seekTimeline(playheadTime + 1 / Number(settings.fps || 30), true); return; }
      if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); seekTimeline(event.key === 'Home' ? 0 : totalDuration, true); return; }
      if (!event.ctrlKey && event.key.toLowerCase() === 'm') { event.preventDefault(); addMarker(); return; }

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
      
      // Ctrl + Alt + D: Filmora 15 Detach Audio
      if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 'd') { event.preventDefault(); detachSelectedAudio(); return; }

      // Ctrl + D: Duplicate Scene
      if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateScene(); return; }

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
          try { let next = projectData(); let index = scenes.findLastIndex(scene => selectedIds.includes(scene.id)) + 1; for (const clip of newScenes) next = insertScene(next, clip, index++); applyTimelineState(next); } catch (error) { setWarning(error.message); return; }
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
      const isDeleteKey = event.key === 'Delete' || event.key === 'Backspace';
      if (event.shiftKey && isDeleteKey && selected) { event.preventDefault(); removeScene(selected.id, true); return; }
      if (isDeleteKey && selectedAudio && audioSelection?.trackId === selectedAudio.id && !audioSelection.awaitingEnd) { event.preventDefault(); removeHighlightedAudio(event.shiftKey); return; }
      if (!event.ctrlKey && !event.altKey && selectedAudio && ['i','o'].includes(event.key.toLowerCase())) { event.preventDefault(); setAudioSelectionEdge(event.key.toLowerCase() === 'i' ? 'start' : 'end'); return; }
      if (event.shiftKey && isDeleteKey && selectedAudio) { event.preventDefault(); removeAudioTrack(selectedAudio.id, true); return; }
      if (isDeleteKey && selectedAudio) { event.preventDefault(); removeAudioTrack(selectedAudio.id); return; }
      
      // Delete Scenes
      if (isDeleteKey && selectedTextId) { event.preventDefault(); setTextOverlays(current => current.filter(item => item.id !== selectedTextId)); setSelectedTextId(''); return; }
      if (isDeleteKey && selectedCaptionId && !trackStates.captionsLocked) { event.preventDefault(); setCaptions(current => current.filter(item => item.id !== selectedCaptionId)); setSelectedCaptionId(''); return; }
      if (isDeleteKey && selectedIds.length > 0) {
        event.preventDefault();
        removeSelectedScenes();
        return;
      }
      if (isDeleteKey && selected) { event.preventDefault(); removeScene(selected.id); return; }
      
      if (event.altKey && event.key === 'ArrowLeft' && selected) { event.preventDefault(); moveScene(selected.id, -1); return; }
      if (event.altKey && event.key === 'ArrowRight' && selected) { event.preventDefault(); moveScene(selected.id, 1); return; }
      // S or Ctrl+B (Filmora 15 native split shortcut)
      if ((!event.ctrlKey && event.key.toLowerCase() === 's') || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b')) { event.preventDefault(); razorCut(); return; }

    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, selected, selectedAudio, selectedCaptionId, selectedTextId, playheadTime, scenes, audioTracks, captions, rippleEnabled, snapEnabled, timelineZoom, historyVersion, audioClipboard, sceneClipboard, selectedIds, isPreviewPlaying, settings, markers, trackStates, audioSelection, helpTopic]);

  const previewFontPx = Math.max(10, Number(settings.captionFontSize || 42) * (previewFrame.height || 540) / 1080);
  const captionPosition = settings.captionPosition || 'bottom';
  const captionPreviewStyle = {
    left: previewFrame.width ? previewFrame.left + previewFrame.width / 2 : '50%',
    top: previewFrame.height ? previewFrame.top + previewFrame.height * (captionPosition === 'top' ? .055 : captionPosition === 'middle' ? .5 : .945) : captionPosition === 'top' ? '7%' : captionPosition === 'middle' ? '50%' : '93%',
    bottom: 'auto',
    transform: `${captionPosition === 'middle' ? 'translate(-50%,-50%)' : captionPosition === 'bottom' ? 'translate(-50%,-100%)' : 'translateX(-50%)'} scale(${Math.max(30, Math.min(100, Number(settings.captionWidth) || 100)) / 100},${Math.max(70, Math.min(140, Number(settings.captionHeight) || 100)) / 100})`,
    transformOrigin: captionPosition === 'bottom' ? 'center bottom' : captionPosition === 'top' ? 'center top' : 'center center',
    fontSize: `${previewFontPx}px`,
    fontFamily: /[\u0900-\u0dff]/.test(previewCaption?.text || '') ? 'Nirmala UI' : settings.captionFontFamily || 'Arial',
    fontWeight: settings.captionBold === false ? 400 : 800,
    color: settings.captionColor || '#ffffff',
    lineHeight: 1.1,
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
  const exporterBusy = captioning || exporting || voiceChanging || audioMorphing || cropSaving;
  const hasNarrationSource = scenes.some(scene => scene.kind === 'video' && scene.hasAudio !== false && !scene.disabled);
  const guidedStep = !scenes.length ? 1 : result ? 4 : captions.length ? 3 : 2;
  const guidedStatus = exporting
    ? `Exporting your video · ${progress.pct || 0}%`
    : captioning
      ? `Creating captions · ${progress.pct || 0}%`
      : result
        ? `Finished · ${result.fileName || 'your video is ready'}`
        : !scenes.length
          ? 'Start by importing a video or image'
          : captions.length
            ? `${captions.length} captions ready · preview, then export`
            : 'Media ready · add captions if needed, then preview';
  const guidedExport = () => {
    setExportDropdownOpen(false);
    if (settings.burnCaptions && !captions.length && hasNarrationSource) return generateCaptionsAndExport();
    return exportVideo();
  };
  const visibleAssetTabs = ['Media', 'Audio', 'Titles'];
  const effectAssetTabs = ['Transitions', 'Filters', 'Stickers', 'Templates'];
  const deleteSelectedItem = () => {
    if (projectBusyRef.current) return;
    if (selectedTextId) { setTextOverlays(current => current.filter(item => item.id !== selectedTextId)); setSelectedTextId(''); }
    else if (selectedCaptionId && !trackStates.captionsLocked) { setCaptions(current => current.filter(item => item.id !== selectedCaptionId)); setSelectedCaptionId(''); }
    else if (selectedAudio && !trackStates.audioLocked) { if (audioSelection?.trackId === selectedAudio.id && !audioSelection.awaitingEnd) removeHighlightedAudio(); else removeAudioTrack(selectedAudio.id); }
    else if (selected && !trackStates.videoLocked) removeScene(selected.id);
  };
  // Filmora 15 Same-Row Audio Track Packing:
  // Non-overlapping audio segments (from splitting with Scissor/S, cutting waste voice, or sequential scenes)
  // ALWAYS stay on the same horizontal Audio row (Audio 1). Only overlapping tracks (like background music) use Audio 2+.
  const audioTrackLanes = useMemo(() => {
    const lanes = [];
    for (const track of audioTracks) {
      const start = Number(track.start || 0);
      const end = start + Number(track.duration || 0);
      const overlapsLane = lane => lane.some(existing => {
        const exStart = Number(existing.start || 0);
        const exEnd = exStart + Number(existing.duration || 0);
        return start < exEnd - 1e-4 && end > exStart + 1e-4;
      });
      const groupKey = track.originSceneId || track.detachedFromSceneId || track.reattachedToSceneId || track.path || '';
      let targetLane = groupKey
        ? lanes.find(lane => lane.some(item => (item.originSceneId || item.detachedFromSceneId || item.reattachedToSceneId || item.path || '') === groupKey) && !overlapsLane(lane))
        : null;
      if (!targetLane) targetLane = lanes.find(lane => !overlapsLane(lane));
      if (targetLane) targetLane.push(track);
      else lanes.push([track]);
    }
    return lanes.map(lane => [...lane].sort((a, b) => Number(a.start || 0) - Number(b.start || 0)));
  }, [audioTracks]);

  const closeAudioLaneGap = (laneTracks, fromTrack, gapDuration) => {
    if (projectBusyRef.current || trackStates.audioLocked || !(gapDuration > 0)) return;
    const threshold = Number(fromTrack.start) - 1e-4;
    const laneIds = new Set(laneTracks.map(item => item.id));
    const nextTracks = audioTracks.map(item => {
      if (laneIds.has(item.id) && Number(item.start) >= threshold) {
        return { ...item, start: Math.max(0, Number(item.start) - gapDuration), detachedFromSceneId: '', originSceneId: '', reattachedToSceneId: '', pastedAudio: true };
      }
      return item;
    });
    setAudioTracks(nextTracks);
    commitTimelineHistory(scenes, nextTracks, captions);
    setProgress({ pct: 100, phase: `Closed ${gapDuration.toFixed(2)}s silent gap on the same Audio track.` });
  };

  const selectedEntry = entries.find(entry => entry.scene.id === selected?.id);
  const selectedSceneDetachedTrack = selected ? audioTracks.find(track => [track.detachedFromSceneId, track.originSceneId, track.reattachedToSceneId].includes(selected.id)) : null;
  const contextMenuScene = contextMenu?.type === 'video' ? (scenes.find(scene => scene.id === contextMenu.id) || selected) : null;
  const contextMenuDetachedTrack = contextMenu?.type === 'video' ? audioTracks.find(track => [track.detachedFromSceneId, track.originSceneId, track.reattachedToSceneId].includes(contextMenu.id)) : null;
  const contextMenuAudio = contextMenu?.type === 'audio' ? (audioTracks.find(track => track.id === contextMenu.id) || selectedAudio) : null;
  const selectedLocalTime = Math.max(0, Math.min(selectedEntry?.outputDuration || 0, playheadTime - (selectedEntry?.start || 0)));
  const selectedTransform = selected ? sampleSceneTransform(selected, selectedLocalTime) : {};
  const addKeyframe = (patch = {}) => {
    if (!selected || projectBusyRef.current || trackStates.videoLocked) return;
    const time = Number(selectedLocalTime.toFixed(5));
    const frame = { time, scale: selectedTransform.scale ?? 1, positionX: selectedTransform.positionX ?? 0, positionY: selectedTransform.positionY ?? 0, opacity: selectedTransform.opacity ?? 1, ...patch };
    const frames = (selected.keyframes || []).filter(item => Math.abs(item.time - time) > .0001);
    patchScene(selected.id, { keyframes: [...frames, frame].sort((a,b) => a.time - b.time) });
  };
  const changeSceneProperty = (field, value) => {
    if (field === 'transition' && selected) { patchScene(selected.id, { transition: value, transitionDuration: value === 'fade-black' ? Number(selected.transitionDuration) || .4 : 0 }); return; }
    if (selected?.keyframes?.length && ['scale','positionX','positionY','opacity'].includes(field)) addKeyframe({ [field]: value });
    else if (selected) patchScene(selected.id, { [field]: value });
  };
  const addMarker = () => {
    if (projectBusyRef.current || !scenes.length) return;
    setMarkers(current => [...current, { id: uid(), time: playheadTime, name: `Marker ${current.length + 1}` }].sort((a,b) => a.time - b.time));
  };
  const addTitlePreset = preset => {
    if (projectBusyRef.current || !totalDuration) { setWarning('Add media before placing a title.'); return; }
    const base = { id: uid(), x: 50, y: 50, fontSize: 78, color: '#ffffff', fontFamily: 'Arial', shape: 'none', opacity: 1, depth: 0, start: Math.min(playheadTime, totalDuration - .1), end: Math.min(totalDuration, playheadTime + 4) };
    const styles = {
      title: { text: 'Your title' },
      'lower-third': { text: 'Name / description', y: 82, fontSize: 48, shape: 'box' },
      chapter: { text: '01  New chapter', y: 30, fontSize: 70 },
      quote: { text: 'A thought to remember', fontFamily: 'Georgia', fontSize: 56 },
      opener: { text: 'CINEMA OPENER', y: 46, fontSize: 92, depth: 6, shape: 'pill' },
      neon: { text: 'NEON CYBER', y: 50, fontSize: 84, color: '#2fe6de', depth: 8, shape: 'box' },
      callout: { text: '➜ Key Feature', x: 72, y: 28, fontSize: 52, color: '#fbbf24', shape: 'badge' },
      news: { text: 'BREAKING UPDATE · LIVE', y: 88, fontSize: 44, color: '#ffffff', shape: 'pill' }
    };
    const title = { ...base, ...(styles[preset] || styles.title) }; setTextOverlays(current => [...current, title]); setSelectedTextId(title.id); setSelectedId(''); openInspector('text');
  };
  const addStickerPreset = preset => {
    if (projectBusyRef.current || !totalDuration) { setWarning('Add media before placing a sticker.'); return; }
    const icons = { star: '★', check: '✓', arrow: '➜', heart: '♥', fire: '🔥', sparkle: '✨', bolt: '⚡', crown: '👑' };
    const sticker = { id: uid(), text: icons[preset] || '★', x: 80, y: 20, fontSize: 120, opacity: 1, color: '#ffdc82', fontFamily: 'Segoe UI', shape: 'none', depth: 0, start: Math.min(playheadTime, totalDuration - .1), end: Math.min(totalDuration, playheadTime + 3) };
    setTextOverlays(current => [...current, sticker]); setSelectedTextId(sticker.id); setSelectedId(''); setSelectedAudioId(''); setSelectedCaptionId(''); openInspector('text');
  };
  const applyTemplate = preset => {
    if (projectBusyRef.current) return;
    const presetMap = {
      lesson: { resolution: '1080p', aspectRatio: '16:9', fps: 30, quality: 'balanced' },
      vertical: { resolution: 'vertical', aspectRatio: '9:16', fps: 30, quality: 'balanced' },
      slideshow: { resolution: '1080p', aspectRatio: '16:9', fps: 30, quality: 'balanced' },
      youtube4k: { resolution: '4k', aspectRatio: '16:9', fps: 60, quality: 'high' },
      square: { resolution: 'square', aspectRatio: '1:1', fps: 30, quality: 'balanced' },
      cinema24: { resolution: '1440p', aspectRatio: '16:9', fps: 24, quality: 'high' },
    };
    setSettings(current => ({ ...current, ...(presetMap[preset] || presetMap.lesson) }));
    if (preset === 'slideshow') setScenes(current => current.map(scene => scene.kind === 'image' ? { ...scene, transition: 'fade-black', transitionDuration: .4 } : scene));
    if (preset === 'cinema24') setScenes(current => current.map(scene => ({ ...scene, contrast: 1.16, saturation: 0.86 })));
    setProgress({ pct: 100, phase: `${preset} template applied. Your clips, captions and fonts were preserved.` });
  };
  const formatSmpte = (seconds = 0, fps = 30) => {
    const safe = Math.max(0, Number(seconds) || 0);
    const rate = Math.max(1, Number(fps) || 30);
    const hrs = Math.floor(safe / 3600);
    const mins = Math.floor((safe % 3600) / 60);
    const secs = Math.floor(safe % 60);
    const frames = Math.floor((safe % 1) * rate);
    return [hrs, mins, secs, frames].map(v => String(v).padStart(2, '0')).join(':');
  };
  const captureProgramSnapshot = () => {
    if (!programScene) { setWarning('Load a clip into the Program Monitor before taking a snapshot.'); return; }
    addMarker();
    setProgress({ pct: 100, phase: `📷 Snapshot marker captured at ${formatSmpte(playheadTime, settings.fps)} (${programScene.name}).` });
  };
  const selectLayoutMode = mode => {
    setLayoutMode(mode);
    setLayoutPickerOpen(false);
    try { localStorage.setItem('mx-layout-mode', mode); } catch (_) {}
    setProgress({ pct: 100, phase: `Filmora 15 ${mode.toUpperCase()} studio workspace activated.` });
  };
  const addAsset = asset => {
    if (asset.kind === 'audio') { if (projectBusyRef.current || trackStates.audioLocked) return; const track = { ...asset, id: uid(), libraryId: asset.id, start: playheadTime, duration: Number(asset.duration) / Number(asset.speed || 1), originSceneId: '', detachedFromSceneId: '', reattachedToSceneId: '', pastedAudio: true, volume: asset.volume ?? 1 }; setAudioTracks(current => [...current, track]); setSelectedAudioId(track.id); setSelectedId(''); loadWaveform(track.id, track.path, track); }
    else placeMediaOnTimeline(asset);
  };
  const fadeLength = programScene?.transition === 'fade-black' ? Math.min(Number(programScene.transitionDuration ?? .4), (programEntry?.outputDuration || 0) / 2) : 0;
  const programLocalTime = Math.max(0, playheadTime - (programEntry?.start || 0));
  const fadeGain = fadeLength ? Math.max(0, Math.min(1, programLocalTime / fadeLength, ((programEntry?.outputDuration || 0) - programLocalTime) / fadeLength)) : 1;
  const rotated = [90,270].includes(Number(programScene?.rotation));
  const programStyle = { position: 'absolute', left: '50%', top: '50%', width: rotated ? canvasSize.height : canvasSize.width, height: rotated ? canvasSize.width : canvasSize.height,
    objectFit: (programScene?.fit || settings.framing) === 'fill' ? 'cover' : 'contain',
    filter: `brightness(${1 + Number(programScene?.brightness ?? 0)}) contrast(${Number(programScene?.contrast ?? 1)}) saturate(${Number(programScene?.saturation ?? 1)})`,
    opacity: Number(programTransform.opacity ?? 1) * fadeGain,
    transform: `translate(calc(-50% + ${Number(programTransform.positionX || 0) * canvasSize.width / 100}px),calc(-50% + ${Number(programTransform.positionY || 0) * canvasSize.height / 100}px)) scale(${Number(programTransform.scale ?? 1) * (programScene?.flipX ? -1 : 1)},${Number(programTransform.scale ?? 1) * (programScene?.flipY ? -1 : 1)}) rotate(${Number(programScene?.rotation || 0)}deg)` };
  useEffect(() => { const video = preview.current; if (video?.tagName === 'VIDEO') { video.volume = Math.max(0, Math.min(1, Number(programScene?.volume ?? 1) * fadeGain)); video.muted = Boolean(programScene?.muted); } }, [programScene?.id, programScene?.volume, programScene?.muted, fadeGain]);
  const configureProgramMedia = event => {
    const video = event.currentTarget;
    video.currentTime = Math.min(Number(video.duration) || Infinity, Number(programScene.trimStart || 0) + Math.max(0, playheadRef.current - programEntry.start) * Number(programScene.speed || 1));
    video.playbackRate = Number(programScene.speed || 1); video.volume = Math.max(0, Math.min(1, Number(programScene.volume ?? 1) * fadeGain));
    updatePreviewFrame();
  };
  useEffect(() => {
    const video = preview.current;
    if (!active || !programScene || programScene.disabled || programScene.kind !== 'video' || video?.tagName !== 'VIDEO' || video.readyState < 1) return;
    const desired = Number(programScene.trimStart || 0) + Math.max(0, playheadTime - programEntry.start) * Number(programScene.speed || 1);
    const tolerance = isPreviewPlaying ? 1.5 * Number(programScene.speed || 1) / Number(settings.fps || 30) : .0005;
    if (Math.abs(video.currentTime - desired) > tolerance) { try { video.currentTime = Math.min(Number(video.duration) || Infinity, desired); } catch (_) {} }
  }, [active, playheadTime, programScene?.id, programScene?.trimStart, programScene?.speed, isPreviewPlaying, settings.fps]);


  return (
    <div className={`mx-page mx-editor-studio mx-editor-simple ${timelineExpanded ? 'mx-timeline-expanded' : ''} mx-layout-${layoutMode} ${advancedMode ? 'mx-mode-advanced' : 'mx-mode-simple'}`}>
      <input ref={mediaInput} className="mx-hidden" type="file" multiple accept="video/*,image/*" onChange={addMedia} />
      <input ref={musicInput} className="mx-hidden" type="file" accept="audio/*" onChange={addMusic} />
      <input ref={watermarkInput} className="mx-hidden" type="file" accept="image/png,image/webp,image/jpeg" onChange={addWatermark} />
      <input ref={projectInput} disabled={exporterBusy} className="mx-hidden" type="file" accept=".pattanproject,application/json" onChange={openProjectFile} />
      <header className="mx-editor-topbar" data-format={`${settings.aspectRatio} · ${settings.resolution || '1080p'} · ${settings.fps}fps`}>
        <div className="mx-editor-brand"><b>F15</b><strong>My Exporter</strong><span>FILMORA 15 STUDIO</span></div>
        <input className="mx-editor-project-name" aria-label="Project name" value={projectName} disabled={exporterBusy} onChange={event => setProjectName(event.target.value)} />
        <div className="mx-editor-project-actions">
          <button onClick={newProject} disabled={exporterBusy}>New</button>
          <button onClick={() => projectInput.current?.click()} disabled={exporterBusy}>Open</button>
          <button onClick={saveProject} disabled={exporterBusy}>Save</button>
          <button title="Undo (Ctrl+Z)" disabled={exporterBusy || historyIndexRef.current < 1} onClick={() => restoreHistory(-1)}>↶</button>
          <button title="Redo (Ctrl+Y)" disabled={exporterBusy || historyIndexRef.current >= historyRef.current.length - 1} onClick={() => restoreHistory(1)}>↷</button>
          <div className="mx-layout-dropdown-container">
            <span role="button" tabIndex={0} className={`mx-f15-layout-trigger ${layoutPickerOpen ? 'active' : ''}`} title="Switch Filmora 15 Workspace Layout" onClick={() => setLayoutPickerOpen(value => !value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLayoutPickerOpen(v => !v); } }}>⊞ Layout: {layoutMode} ▾</span>
            {layoutPickerOpen && <div className="mx-layout-picker-popup">
              {[['default', 'Default Studio (4-Pane)'], ['classic', 'Classic NLE'], ['short', 'Short Video (9:16)'], ['timeline', 'Wide Timeline']].map(([modeId, modeLabel]) => (
                <span key={modeId} role="button" tabIndex={0} className={layoutMode === modeId ? 'active' : ''} onClick={() => selectLayoutMode(modeId)}>{modeLabel}</span>
              ))}
            </div>}
          </div>
        </div>
        <div className="mx-export-dropdown-container"><button className="mx-editor-export" onClick={() => setExportDropdownOpen(value => !value)} disabled={!scenes.length || exporterBusy}>Export ▾</button>{exportDropdownOpen && <div className="mx-export-dropdown-menu"><button onClick={() => { setExportDropdownOpen(false); exportVideo(); }}>Export with current captions</button><button onClick={() => { setExportDropdownOpen(false); exportVideo(null, false, true); }}>Export without captions</button><button onClick={() => { setExportDropdownOpen(false); generateCaptionsAndExport(); }}>Generate captions & export</button><button onClick={() => { setExportDropdownOpen(false); openInspector('export'); }}>Export settings</button></div>}</div>
      </header>
      <nav className="mx-editor-navigation" aria-label="Editor tools">
        {visibleAssetTabs.map(tab => <button key={tab} data-nav-tab={tab.toLowerCase()} className={openSidePanel === 'library' && assetTab === tab ? 'active' : ''} onClick={() => { setAssetTab(tab); setOpenSidePanel('library'); }}>{tab}</button>)}
        <button data-nav-tab="captions" className={openSidePanel === 'inspector' && inspectorTab === 'captions' ? 'active' : ''} onClick={() => openInspector('captions')}>Captions</button>
        <details className="mx-editor-menu" data-nav-tab="effects"><summary>Effects ▾</summary><div className="mx-editor-menu-items" onClick={closeEditorMenu}>{effectAssetTabs.map(tab => <button key={tab} onClick={() => { setAssetTab(tab); setOpenSidePanel('library'); }}>{tab}</button>)}</div></details>
        <div className="mx-f15-ribbon-pills" aria-label="Filmora 15 Quick Categories">
          {effectAssetTabs.map(tab => (
            <span key={tab} role="button" tabIndex={0} className={`mx-f15-ribbon-pill ${openSidePanel === 'library' && assetTab === tab ? 'active' : ''}`} onClick={() => { setAssetTab(tab); setOpenSidePanel('library'); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAssetTab(tab); setOpenSidePanel('library'); } }}>{tab}</span>
          ))}
        </div>
        <span /><button aria-label="Help & Demos" data-nav-tab="help" className="mx-editor-help-button" onClick={() => openHelp('media')}>? Help & Demos</button><button data-nav-tab="inspector" className={openSidePanel === 'inspector' && inspectorTab === 'clip' ? 'active' : ''} onClick={() => openSidePanel === 'inspector' && inspectorTab === 'clip' ? setOpenSidePanel('library') : openInspector('clip')}>Clip settings</button>
      </nav>
      {workspaceTabs.length > 1 && <div className="mx-project-tabs"><strong>Projects</strong>{workspaceTabs.map(tab => <button key={tab.id} className={tab.id === activeWorkspaceId ? 'active' : ''} disabled={exporterBusy} onClick={() => switchWorkspace(tab.id)}>{tab.id === activeWorkspaceId ? projectName : tab.name}</button>)}<button disabled={exporterBusy} onClick={addWorkspace}>+ Project</button><span>{autosaveState} · {settings.aspectRatio} · {settings.fps} fps</span></div>}

      <div className={`mx-workspace mx-side-panel-${openSidePanel || 'closed'}`}>
        <button className="mx-side-panel-tab mx-side-panel-tab-left" title="Open media library" onClick={() => setOpenSidePanel(value => value === 'library' ? '' : 'library')}>Media ›</button>
        <button className="mx-side-panel-tab mx-side-panel-tab-right" title="Open clip settings" onClick={() => openInspector('clip')}>‹ Settings</button>
        <aside className="mx-library">
          <button className="mx-side-panel-close" title="Hide media library" onClick={() => setOpenSidePanel('')}>‹ Hide</button>
          <EditorAssetBrowser tab={assetTab} assets={mediaLibrary}
            disabled={exporterBusy} onImport={pickMedia} onImportAudio={pickAudioTracks} onPreview={asset => { setIsPreviewPlaying(false); setSourceAsset(asset); }} onAdd={addAsset}
            onAddAll={addAutoAllScenes} autoAddDisabled={trackStates.videoLocked || trackStates.audioLocked || trackStates.captionsLocked}
            onRemove={asset => { setMediaLibrary(current => current.filter(item => item.id !== asset.id)); if (sourceAsset?.id === asset.id) setSourceAsset(null); }}
            onApplyFilter={applyVisualPreset} onApplyTransition={applyTransitionPreset}
            onAddTitle={addTitlePreset} onAddSticker={addStickerPreset} onApplyTemplate={applyTemplate} onHelp={openHelp} />
          <details className="mx-audio-box"><summary>Background music</summary><button onClick={() => musicInput.current?.click()} disabled={exporterBusy}>{music ? 'Replace music' : '+ Add music'}</button>{music && <div><strong>{music.name}</strong><button onClick={() => setMusic(null)} disabled={exporterBusy}>Remove</button></div>}<label>Music volume<input aria-label="Music volume" type="range" min="0" max="1" step=".01" value={settings.musicVolume} onChange={event => setSettings(value => ({ ...value, musicVolume: Number(event.target.value) }))} /></label></details>
        </aside>

        <main className={`mx-center${sourceAsset ? ' mx-has-source-monitor' : ''}`}>
          {sourceAsset && <SourceMonitor asset={sourceAsset} onInsert={addAsset} onClose={() => setSourceAsset(null)} disabled={exporterBusy || Boolean(helpTopic)} onHelp={openHelp} />}
          <div ref={previewViewport} className={`mx-viewer ${previewLarge ? 'mx-viewer-large' : ''}`} data-program-clip={programScene ? `${programScene.name} · ${settings.aspectRatio} · ${settings.fps}fps` : 'No clip loaded'}>
            {isPreviewFullscreen && <button className="mx-exit-fullscreen" onClick={togglePreviewFullscreen}>← Exit fullscreen (Esc)</button>}
            <div ref={viewer} className="mx-program-stage" style={{ width: canvasSize.width, height: canvasSize.height }}>
              {active && programScene && !programScene.disabled && programScene.kind !== 'gap' ? programScene.kind === 'image'
                ? <img ref={preview} key={programScene.id} src={fileUrl(programScene.path)} alt="Program scene" style={programStyle} onLoad={updatePreviewFrame} />
                : <video ref={preview} key={programScene.id} src={fileUrl(programScene.path)} playsInline preload="auto" style={programStyle} muted={Boolean(programScene.muted)} onLoadedMetadata={configureProgramMedia} onEnded={finishCurrentScene} onDoubleClick={togglePreviewFullscreen} onError={() => { setWarning(`${programScene.name} cannot be previewed with its current codec. Native export can convert supported media.`); setIsPreviewPlaying(false); }} />
                : !programScene && <div className="mx-empty-view"><strong>Your story starts here</strong><span>Import media, preview your source and add it to the timeline.</span><button onClick={pickMedia}>Import media</button></div>}
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
          </div>

          <PreviewAudioMixer tracks={audioTracks} music={music} musicVolume={settings.musicVolume} time={playheadTime} playing={isPreviewPlaying && !programWaiting} muted={trackStates.audioMuted} active={active} duration={totalDuration} />

          <div className="mx-player-tools"><div>
            <button title="Previous frame" onClick={() => seekTimeline(playheadTime - 1 / Number(settings.fps || 30), true)}>◀|</button>
            <button className="mx-play-button" onClick={togglePreviewPlayback} disabled={!programScene || exporterBusy}>{isPreviewPlaying ? '❚❚ Pause' : '▶ Play'}</button>
            <button title="Next frame" onClick={() => seekTimeline(playheadTime + 1 / Number(settings.fps || 30), true)}>|▶</button>
            <button title="Filmora 15 Snapshot — Capture frame marker" onClick={captureProgramSnapshot} disabled={!programScene || exporterBusy}>📷 Snapshot</button>
            <button onClick={togglePreviewFullscreen}>Fullscreen</button>
            <details className="mx-editor-menu"><summary>Preview options ▾</summary><div className="mx-editor-menu-items" onClick={closeEditorMenu}>
              <HelpHint label="Preview controls" topic="timeline-playback" onHelp={openHelp} />
              <button onClick={() => setPlaybackMode(value => value === 'continuous' ? 'scene' : 'continuous')}>{playbackMode === 'continuous' ? 'Play selected scene only' : 'Play all scenes'}</button>
              <button onClick={() => { setPreviewLarge(value => !value); window.setTimeout(updatePreviewFrame, 50); }}>{previewLarge ? 'Normal preview' : 'Larger preview'}</button>
              <button onClick={() => setSafeGuides(value => !value)}>{safeGuides ? 'Hide guides' : 'Show guides'}</button>
            </div></details>
          </div><span data-smpte={formatSmpte(playheadTime, settings.fps)}>{formatTime(playheadTime)} / {formatTime(totalDuration)}</span></div>
          <div className="mx-master-meter mx-master-mix-status"><strong>MASTER MIX</strong><span>{trackStates.audioMuted ? 'Added audio muted' : `${audioTracks.filter(track => !track.muted && playheadTime >= track.start && playheadTime < track.start + track.duration).length} active audio tracks${music ? ' + music' : ''}`} · {isPreviewPlaying ? programWaiting ? 'Loading source' : 'Playing' : 'Paused'}</span><span>{formatTime(playheadTime)} / {formatTime(totalDuration)}</span></div>
          <section className="mx-timeline" ref={timelineRef}>
            <div className="mx-filmora-toolstrip">
              <button title="Split at playhead (S)" onClick={razorCut} disabled={exporterBusy || (!selected && !selectedAudio && !selectedCaptionId)}>✂ Split</button>
              <button title="Delete selected" onClick={deleteSelectedItem} disabled={exporterBusy || (!selected && !selectedAudio && !selectedCaptionId && !selectedTextId) || (selectedCaptionId && trackStates.captionsLocked) || (selectedAudio && trackStates.audioLocked) || (selected && trackStates.videoLocked)}>Delete</button>
              <button onClick={pickAudioTracks} disabled={exporterBusy}>+ Audio</button>
              <button
                className={`mx-detach-toolbar-btn ${selectedSceneDetachedTrack ? 'is-detached' : ''}`}
                title="Filmora 15 Detach Audio (Ctrl+Alt+D) — Extract audio from selected video clip to Audio track"
                onClick={() => detachSelectedAudio()}
                disabled={exporterBusy || trackStates.videoLocked || trackStates.audioLocked || !(selected || programScene) || (selected || programScene)?.kind !== 'video' || (selected || programScene)?.hasAudio === false}
              >
                ♫ Detach Audio
              </button>
              {(selectedAudio && (selectedAudio.originSceneId || selectedAudio.detachedFromSceneId || selectedAudio.reattachedToSceneId) || selectedSceneDetachedTrack) && (
                <button
                  className="mx-reattach-toolbar-btn"
                  title="Reattach detached audio back to its video clip"
                  onClick={() => reattachSelectedAudio(selectedAudio?.id || selectedSceneDetachedTrack?.id)}
                  disabled={exporterBusy || trackStates.videoLocked || trackStates.audioLocked}
                >
                  🔗 Reattach
                </button>
              )}
              <span role="button" tabIndex={0} className="mx-f15-tool-chip" title="Add timeline marker at playhead (M)" onClick={addMarker}>◆ Marker</span>
              <span role="button" tabIndex={0} className="mx-f15-tool-chip" title="Open Color Grading & LUTs" onClick={() => { setAssetTab('Filters'); setOpenSidePanel('library'); }}>🎨 Color</span>
              <details className="mx-editor-menu"><summary>More tools ▾</summary><div className="mx-editor-menu-items" onClick={closeEditorMenu}>
                <HelpHint label="Timeline editing" topic="timeline" onHelp={openHelp} />
                <button onClick={() => selectedAudio ? copySelectedAudio() : copyScene()} disabled={exporterBusy || (!selected && !selectedAudio)}>Copy</button>
                <button onClick={() => audioClipboard ? pasteCopiedAudio() : pasteScene()} disabled={exporterBusy || (!audioClipboard && !sceneClipboard)}>Paste at playhead</button>
                <button onClick={duplicateScene} disabled={exporterBusy || !selected}>Duplicate clip</button>
                <button onClick={mergeSelectedWithNext} disabled={exporterBusy || !selected}>Group with next clip</button>
                <button onClick={() => detachSelectedAudio()} disabled={exporterBusy || !(selected || programScene) || (selected || programScene)?.kind !== 'video' || (selected || programScene)?.hasAudio === false}>Detach audio</button>
                <button onClick={() => selected && removeScene(selected.id, true)} disabled={exporterBusy || !selected}>Ripple delete</button>
                <button onClick={() => selected && patchScene(selected.id, { rotation: (Number(selected.rotation || 0) + 90) % 360 })} disabled={exporterBusy || !selected}>Rotate 90°</button>
                <button onClick={() => { setSettings(value => ({ ...value, framing: 'fill' })); setScenes(current => current.map(scene => ({ ...scene, fit: 'fill' }))); }} disabled={exporterBusy}>Fill canvas</button>
                <button onClick={addMarker} disabled={!scenes.length || exporterBusy}>Add marker (M)</button>
                <button onClick={() => { scanForStutters(); setStutterCutterOpen(true); }} disabled={!captions.length || exporterBusy}>AI Stutter Cutter</button>
                <button onClick={() => openInspector('tools')}>Voice, logo & crop tools</button>
                <button onClick={addWorkspace} disabled={exporterBusy}>New project tab</button>
              </div></details>
              <button className={snapEnabled ? 'active' : ''} title="Timeline snapping" aria-pressed={snapEnabled} onClick={() => setSnapEnabled(value => !value)}>Snap</button>
              <button className={rippleEnabled ? 'active' : ''} title="Ripple editing" aria-pressed={rippleEnabled} onClick={() => setRippleEnabled(value => !value)}>Ripple</button>
              <span /><button title="Fit timeline" onClick={() => setTimelineZoom(1)}>Fit</button><label className="mx-timeline-zoom">Zoom<input aria-label="Timeline zoom" type="range" min="1" max="50" value={timelineZoom} onChange={event => setTimelineZoom(Number(event.target.value))} /></label>
            </div>
            <div className="mx-timeline-head"><div><span className="mx-panel-title">Timeline</span><small>Drag clips to reorder · S to split · Ctrl+Alt+D to detach audio</small></div><button onClick={() => setTimelineExpanded(value => !value)}>{timelineExpanded ? 'Restore preview' : 'Expand timeline'}</button></div>
            <div className={`mx-timeline-check ${timelineIssues.length ? 'bad' : 'good'}`}>{timelineIssues.length ? `Check timeline: ${timelineIssues[0]}` : 'Timeline check: video, audio and captions are placed correctly.'}</div>
            <div className="mx-scrubber" onPointerDown={event => { setDraggingPlayhead(true); event.currentTarget.setPointerCapture(event.pointerId); seekTimelineFromPointer(event); }} onPointerMove={event => { if (draggingPlayhead) seekTimelineFromPointer(event); }} onPointerUp={() => setDraggingPlayhead(false)}>
              <div className="mx-scrub-track"><div className="mx-scrub-line" /><div className="mx-scrub-head" style={{ left: `${totalDuration ? (playheadTime / totalDuration) * 100 : 0}%` }}><span>{formatTime(playheadTime)}</span></div></div>
              <div className="mx-ruler"><span>0:00</span><span>{formatTime(totalDuration / 2)}</span><span>{formatTime(totalDuration)}</span></div>
            </div>
            <div className="mx-marker-list">{markers.map(marker => <span key={marker.id}><button onClick={() => seekTimeline(marker.time, true)} title={`Seek ${marker.name}`}>◆ {marker.name} · {Number(marker.time).toFixed(2)}s</button><button title={`Delete ${marker.name}`} onClick={() => setMarkers(current => current.filter(item => item.id !== marker.id))}>×</button></span>)}</div>
            <div ref={timelineSurface} className="mx-multitrack" style={{ width: `${timelineZoom * 100}%` }} onPointerDown={event => { if (event.target.closest('button,.mx-audio-clip,.mx-caption-clip,.mx-trim-handle')) return; setDraggingPlayhead(true); setSelectedId(''); event.currentTarget.setPointerCapture(event.pointerId); seekTimelineFromPointer(event); }} onPointerMove={event => { if (draggingPlayhead) seekTimelineFromPointer(event); }} onPointerUp={() => setDraggingPlayhead(false)}>
              <div className="mx-playhead-area"><div className="mx-vertical-playhead" style={{ left: `${totalDuration ? (playheadTime / totalDuration) * 100 : 0}%` }}><span /><button className="mx-playhead-scissors" title="Drag to position · click to cut selected video or detached audio" onPointerDown={beginScissorDrag} onPointerMove={moveScissorDrag} onPointerUp={endScissorDrag} onClick={cutFromScissor}>✂</button></div></div>
              <div className={`mx-track-row ${expandedTimelineTrack === 'video' ? 'track-expanded' : ''}`}>
                <div className="mx-track-label"><strong>Video</strong><button className="mx-track-size" title="Enlarge or reduce Video track" onClick={() => setExpandedTimelineTrack(value => value === 'video' ? '' : 'video')}>{expandedTimelineTrack === 'video' ? '▾' : '▴'}</button><button onClick={() => setTrackStates(value => ({ ...value, videoLocked: !value.videoLocked }))}>{trackStates.videoLocked ? '🔒' : '🔓'}</button></div>
                <div className="mx-position-lane mx-video-lane">{scenes.map((scene, index) => { if (scene.kind === 'image') return null; const sceneDuration = Number(scene.duration || 0) / Number(scene.speed || 1); const isAudioDetached = audioTracks.some(track => [track.detachedFromSceneId, track.originSceneId, track.reattachedToSceneId].includes(scene.id)); const badgeText = [Number(scene.speed || 1) !== 1 ? `${Number(scene.speed).toFixed(2)}×` : '', scene.transition === 'fade-black' ? 'Fade' : '', isAudioDetached ? '♫ Detached' : '', scene.muted ? 'Muted' : ''].filter(Boolean).join(' · '); return <button key={scene.id} draggable={!trackStates.videoLocked} data-clip-badge={badgeText || undefined} data-color-mark={scene.colorMark || undefined} title="Click to select · right-click for Filmora 15 editing options (Detach Audio, Split, Speed, Crop)" className={`mx-clip ${selectedIds.includes(scene.id) ? 'active' : ''} ${draggingId === scene.id ? 'dragging' : ''} ${scene.mergeGroup ? 'merged' : ''}`} style={{ left: `${totalDuration ? sceneTimelineOffset(scene.id) / totalDuration * 100 : 0}%`, width: `${totalDuration ? sceneDuration / totalDuration * 100 : 100}%` }} onDragStart={() => setDraggingId(scene.id)} onDragOver={event => event.preventDefault()} onDrop={() => { if (draggingId && !trackStates.videoLocked) moveSceneTo(draggingId, scene.id); setDraggingId(''); playAllSessionRef.current = false; }} onDragEnd={() => setDraggingId('')} onDoubleClick={() => openInspector('clip')} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); playAllSessionRef.current = false; selectScene(scene.id, event.ctrlKey || event.metaKey); setPlayheadTime(sceneTimelineOffset(scene.id)); setContextMenu({ type: 'video', id: scene.id, name: scene.name, x: Math.min(event.clientX, window.innerWidth - 255), y: Math.min(event.clientY, window.innerHeight - 380) }); }} onClick={event => { playAllSessionRef.current = false; selectScene(scene.id, event.ctrlKey || event.metaKey); setPlayheadTime(sceneTimelineOffset(scene.id)); }}><span>{index + 1}</span><strong>{scene.name}</strong><small>{formatTime(sceneDuration)}</small></button>; })}</div>
              </div>
              <div className={`mx-track-row mx-image-row ${expandedTimelineTrack === 'images' ? 'track-expanded' : ''}`}>
                <div className="mx-track-label"><strong>Images</strong><button className="mx-track-size" title="Enlarge or reduce Images track" onClick={() => setExpandedTimelineTrack(value => value === 'images' ? '' : 'images')}>{expandedTimelineTrack === 'images' ? '▾' : '▴'}</button><span>▧</span></div>
                <div className="mx-position-lane mx-video-lane mx-image-lane">{scenes.map((scene, index) => { if (scene.kind !== 'image') return null; const sceneDuration = Number(scene.duration || 0); return <button key={scene.id} draggable={!trackStates.videoLocked} title="Image scene · click to select · right-click for options" className={`mx-clip mx-image-clip ${selectedIds.includes(scene.id) ? 'active' : ''}`} style={{ left: `${totalDuration ? sceneTimelineOffset(scene.id) / totalDuration * 100 : 0}%`, width: `${totalDuration ? sceneDuration / totalDuration * 100 : 100}%` }} onClick={event => { selectScene(scene.id, event.ctrlKey || event.metaKey); setPlayheadTime(sceneTimelineOffset(scene.id)); }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); selectScene(scene.id, event.ctrlKey || event.metaKey); setPlayheadTime(sceneTimelineOffset(scene.id)); setContextMenu({ type: 'video', id: scene.id, name: scene.name, x: Math.min(event.clientX, window.innerWidth - 255), y: Math.min(event.clientY, window.innerHeight - 380) }); }}><img src={fileUrl(scene.path)} alt="" /><span>{index + 1}</span><strong>{scene.name}</strong><small>{formatTime(sceneDuration)}</small></button>; })}</div>
              </div>
              <div className="mx-track-row mx-audio-group-row">
                <div className="mx-track-label"><strong>Audio mix</strong><button onClick={() => setTrackStates(value => ({ ...value, audioMuted: !value.audioMuted }))}>{trackStates.audioMuted ? '🔇' : '🔊'}</button><button onClick={() => setTrackStates(value => ({ ...value, audioLocked: !value.audioLocked }))}>{trackStates.audioLocked ? '🔒' : '🔓'}</button></div>
                <div className="mx-position-lane">
                  {selectedAudio && !trackStates.audioLocked ? (
                    <div className="mx-f15-waste-cutter-bar" onPointerDown={e => e.stopPropagation()}>
                      <span className="mx-f15-waste-bar-title">♫ Filmora 15 Waste Voice Cutter (Same Row):</span>
                      <span role="button" tabIndex={0} className="mx-f15-waste-pill" title="Split audio clip at playhead on the same Audio row (S or Ctrl+B)" onClick={razorCut}>✂ Split Audio (S)</span>
                      <span role="button" tabIndex={0} className={`mx-f15-waste-pill ${audioCutSelectionModeId === selectedAudio.id ? 'active' : ''}`} title="Drag across waste voice on waveform, or click Start then End" onClick={() => beginCutPositionSelection(selectedAudio.id)}>🎯 Highlight Waste</span>
                      <span role="button" tabIndex={0} className="mx-f15-waste-pill" title="Mark waste voice START (In) at current playhead (I)" onClick={() => setAudioSelectionEdge('start')}>[I] Set Start</span>
                      <span role="button" tabIndex={0} className="mx-f15-waste-pill" title="Mark waste voice END (Out) at current playhead (O)" onClick={() => setAudioSelectionEdge('end')}>[O] Set End</span>
                      {audioSelection?.trackId === selectedAudio.id && !audioSelection.awaitingEnd && <>
                        <span role="button" tabIndex={0} className="mx-f15-waste-pill preview" title="Listen to the highlighted waste voice range" onClick={audioRangePreviewing ? stopAudioSelectionPreview : previewAudioSelection}>{audioRangePreviewing ? '⏹ Stop' : '▶ Hear Waste'}</span>
                        <span role="button" tabIndex={0} className="mx-f15-waste-pill danger" title="Cut highlighted waste voice and leave a silent gap on Audio 1 (keeps video lip-sync)" onClick={() => removeHighlightedAudio(false)}>🗑 Cut Waste (Keep Sync)</span>
                        <span role="button" tabIndex={0} className="mx-f15-waste-pill ripple" title="Cut highlighted waste voice and pull remaining audio left to close gap" onClick={() => removeHighlightedAudio(true)}>⏮ Cut & Close Gap</span>
                      </>}
                    </div>
                  ) : (
                    <small>{audioTracks.length ? 'Splits & waste-voice cuts stay on the same Audio row (Filmora 15). Overlapping tracks play together.' : 'Import audio or detach a video’s sound (Ctrl+Alt+D) to start editing.'}</small>
                  )}
                </div>
              </div>
              {audioTrackLanes.map((laneTracks, laneIndex) => <div className={`mx-track-row mx-audio-row ${expandedTimelineTrack === `audio-${laneIndex}` ? 'track-expanded' : ''}`} key={laneTracks[0]?.id || `audio-lane-${laneIndex}`}>
                <div className="mx-track-label">
                  <strong title={laneTracks.map(t => t.name).join(' · ')}>Audio {laneIndex + 1}</strong>
                  <button className="mx-track-size" title={`Enlarge or reduce Audio ${laneIndex + 1} waveform track`} onClick={() => setExpandedTimelineTrack(value => value === `audio-${laneIndex}` ? '' : `audio-${laneIndex}`)}>{expandedTimelineTrack === `audio-${laneIndex}` ? '▾' : '▴'}</button>
                </div>
                <div className="mx-position-lane">
                  {laneTracks.map((track, segIndex) => {
                    const prevTrack = segIndex > 0 ? laneTracks[segIndex - 1] : null;
                    const prevEnd = prevTrack ? Number(prevTrack.start) + Number(prevTrack.duration) : 0;
                    const gapDuration = prevTrack ? Number(track.start) - prevEnd : 0;
                    return <React.Fragment key={track.id}>
                      {gapDuration > 0.02 && totalDuration > 0 && (
                        <div
                          className="mx-audio-silent-gap"
                          style={{ left: `${prevEnd / totalDuration * 100}%`, width: `${gapDuration / totalDuration * 100}%` }}
                          title={`Silent gap (${gapDuration.toFixed(2)}s) where waste voice was cut · Click to close gap`}
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); closeAudioLaneGap(laneTracks, track, gapDuration); }}
                        >
                          <span>🔇 {gapDuration.toFixed(2)}s gap</span>
                        </div>
                      )}
                      <div role="button" tabIndex="0" data-audio-id={track.id}
                        className={`mx-audio-clip ${selectedAudioId === track.id ? 'active' : ''} ${audioCutSelectionModeId === track.id ? 'cut-selecting' : ''} ${laneTracks.length > 1 ? 'is-segment' : ''}`}
                        style={{ left: `${totalDuration ? track.start / totalDuration * 100 : 0}%`, width: `${totalDuration ? track.duration / totalDuration * 100 : 0}%` }}
                        onPointerDown={event => beginAudioMove(event, track)} onClick={event => selectAudioAtPointer(event, track)} onDoubleClick={() => openInspector('clip')}
                        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setSelectedAudioId(track.id); setSelectedId(''); setSelectedCaptionId(''); setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 255), y: Math.min(event.clientY, window.innerHeight - 390), id: track.id, name: track.name, type: 'audio' }); }}>
                        <span className="mx-trim-handle left" title="Drag to trim audio start" onPointerDown={event => beginAudioTrim(event, track, 'left')} />
                        {audioSelection?.trackId === track.id && <span className={`mx-audio-selection ${audioSelection.awaitingEnd ? 'awaiting-end' : ''}`}
                          style={{ left: `${(audioSelection.start - Number(track.start)) / Number(track.duration) * 100}%`, width: `${(audioSelection.end - audioSelection.start) / Number(track.duration) * 100}%` }}
                          onPointerDown={event => audioCutSelectionModeId === track.id ? beginAudioRange(event, track) : beginAudioSelectionHandle(event, track, 'move')}>
                          {!audioSelection.awaitingEnd && <><button className="mx-range-handle start" aria-label="Audio range start" title="Adjust selection In" onPointerDown={event => beginAudioSelectionHandle(event, track, 'start')} /><button className="mx-range-handle end" aria-label="Audio range end" title="Adjust selection Out" onPointerDown={event => beginAudioSelectionHandle(event, track, 'end')} /></>}
                          <b>{audioSelection.awaitingEnd ? 'IN — CLICK OUT' : `${(audioSelection.end - audioSelection.start).toFixed(3)}s`}</b>
                        </span>}
                        <div className="mx-waveform" aria-hidden="true">{track.waveform?.map((peak, peakIndex) => <i key={peakIndex} style={{ height: `${Math.max(8, peak * 100)}%` }} />)}</div>
                        <strong>{laneTracks.length > 1 ? `Part ${segIndex + 1} · ${track.name}` : track.name}</strong><small>{audioCutSelectionModeId === track.id ? 'SELECT RANGE: drag or click In, then Out' : track.waveformLoading ? 'Building waveform…' : `${Number(track.trimStart || 0).toFixed(3)} → ${(Number(track.trimStart || 0) + Number(track.duration) * Number(track.speed || 1)).toFixed(3)}s source`}</small>
                        <button className="mx-audio-delete" title="Delete this audio segment (leaves silent gap so video stays in sync)" onClick={event => { event.stopPropagation(); removeAudioTrack(track.id); }}>Delete</button>
                        <span className="mx-trim-handle right" title="Drag to trim audio end" onPointerDown={event => beginAudioTrim(event, track, 'right')} />
                      </div>
                    </React.Fragment>;
                  })}
                </div>
              </div>)}
              <div className="mx-track-row mx-titles-row"><div className="mx-track-label"><strong>Titles</strong></div><div className="mx-position-lane">{textOverlays.map(item => <button key={item.id} className={`mx-caption-clip mx-title-clip ${selectedTextId === item.id ? 'active' : ''}`} title={item.text} style={{ left: `${totalDuration ? item.start / totalDuration * 100 : 0}%`, width: `${totalDuration ? (item.end - item.start) / totalDuration * 100 : 0}%` }} onClick={event => { event.stopPropagation(); setSelectedTextId(item.id); setSelectedAudioId(''); setSelectedCaptionId(''); setSelectedId(''); seekTimeline(item.start, true); openInspector('text'); }}>{item.text}</button>)}</div></div>
              <div className={`mx-track-row ${expandedTimelineTrack === 'captions' ? 'track-expanded' : ''}`}>
                <div className="mx-track-label"><strong>Captions</strong><button className="mx-track-size" title="Enlarge or reduce Captions track" onClick={() => setExpandedTimelineTrack(value => value === 'captions' ? '' : 'captions')}>{expandedTimelineTrack === 'captions' ? '▾' : '▴'}</button><button onClick={() => setTrackStates(value => ({ ...value, captionsMuted: !value.captionsMuted }))}>{trackStates.captionsMuted ? '🙈' : 'CC'}</button><button onClick={() => setTrackStates(value => ({ ...value, captionsLocked: !value.captionsLocked }))}>{trackStates.captionsLocked ? '🔒' : '🔓'}</button></div>
                <div className="mx-position-lane">{!trackStates.captionsMuted && captions.map(item => <div role="button" tabIndex="0" key={item.id} className={`mx-caption-clip ${selectedCaptionId === item.id ? 'active' : ''}`} onClick={() => { setSelectedCaptionId(item.id); setSelectedId(''); setSelectedAudioId(''); setSelectedTextId(''); seekTimeline(item.start, true); openInspector('captions'); }} style={{ left: `${totalDuration ? (item.start / totalDuration) * 100 : 0}%`, width: `${totalDuration ? Math.max(2, ((item.end - item.start) / totalDuration) * 100) : 5}%` }}>{item.text}</div>)}</div>
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

          </section>
        </main>

        <aside className="mx-inspector">
          <div className="mx-inspector-heading"><strong>Settings</strong><HelpHint label={`${inspectorTab === 'text' ? 'Titles' : inspectorTab[0].toUpperCase() + inspectorTab.slice(1)} settings`} topic={selectedAudio && inspectorTab === 'clip' ? 'audio' : inspectorTab} onHelp={openHelp} /><button className="mx-side-panel-close" title="Hide editing controls" onClick={() => setOpenSidePanel('')}>Close</button></div>
          <nav className="mx-inspector-tabs" aria-label="Settings categories">{[['clip','Clip'],['text','Text'],['captions','Captions'],['export','Export'],['tools','Tools']].map(([id, label]) => <button key={id} className={inspectorTab === id ? 'active' : ''} aria-pressed={inspectorTab === id} onClick={() => setInspectorTab(id)}>{label}</button>)}</nav>
          <fieldset className="mx-inspector-controls" disabled={exporterBusy}>
          <section className="mx-inspector-page" data-inspector-page="clip" hidden={inspectorTab !== 'clip'}>
          {selectedAudio && <section className="mx-scene-inspector"><div className="mx-panel-title">Audio · {selectedAudio.name}</div><label>Volume<input aria-label="Audio volume" type="range" min="0" max="1" step=".01" value={selectedAudio.volume ?? 1} onChange={event => patchAudioTrack(selectedAudio.id, { volume: Number(event.target.value) })} /></label><label>Speed<input aria-label="Audio speed" type="number" min=".25" max="4" step=".05" value={selectedAudio.speed || 1} onChange={event => patchAudioTrack(selectedAudio.id, { speed: Math.max(.25, Math.min(4, Number(event.target.value))) })} /></label><label>Fade in (seconds)<input aria-label="Audio fade in" type="number" min="0" max={selectedAudio.duration} step=".1" value={selectedAudio.fadeIn || 0} onChange={event => patchAudioTrack(selectedAudio.id, { fadeIn: Math.max(0, Math.min(selectedAudio.duration, Number(event.target.value))) })} /></label><label>Fade out (seconds)<input aria-label="Audio fade out" type="number" min="0" max={selectedAudio.duration} step=".1" value={selectedAudio.fadeOut || 0} onChange={event => patchAudioTrack(selectedAudio.id, { fadeOut: Math.max(0, Math.min(selectedAudio.duration, Number(event.target.value))) })} /></label><label className="mx-check"><input type="checkbox" checked={Boolean(selectedAudio.muted)} onChange={event => patchAudioTrack(selectedAudio.id, { muted: event.target.checked })} /> Mute this track</label></section>}
          {!selectedAudio && <SceneInspector scene={selected} transform={selectedTransform} localTime={selectedLocalTime} duration={selectedEntry?.outputDuration || 0} disabled={exporterBusy || trackStates.videoLocked} audioLocked={trackStates.audioLocked} detachedAudioTrack={selectedSceneDetachedTrack} onDetachAudio={detachSelectedAudio} onSelectDetachedAudio={trackId => { setSelectedAudioId(trackId); setSelectedId(''); setSelectedCaptionId(''); openInspector('clip'); }} onReattachAudio={reattachSelectedAudio} onApplyFilter={applyVisualPreset} onHelp={openHelp}
            onChange={changeSceneProperty} onAddKeyframe={() => addKeyframe()} onDeleteKeyframe={index => patchScene(selected.id, { keyframes: selected.keyframes.filter((_, i) => i !== index) })} onSeekKeyframe={time => seekTimeline(selectedEntry.start + time, true)} onTrimChange={patch => patchScene(selected.id, patch)} />}
          {selectedAudio && <>
            <AudioRangeEditor track={selectedAudio} selection={audioSelection} selecting={audioCutSelectionModeId === selectedAudio.id}
              disabled={exporterBusy || trackStates.audioLocked} previewing={audioRangePreviewing} onChange={changeAudioRange}
              onSelect={() => beginCutPositionSelection(selectedAudio.id)} onEdge={setAudioSelectionEdge}
              onPreview={previewAudioSelection} onStop={stopAudioSelectionPreview} onRemove={() => removeHighlightedAudio(false)} onRippleRemove={() => removeHighlightedAudio(true)} onSplitAtPlayhead={razorCut} onReattach={() => reattachSelectedAudio(selectedAudio.id)} onHelp={openHelp} />
            <audio ref={audioSelectionPreview} className="mx-cut-preview" src={fileUrl(selectedAudio.path)} preload="metadata" hidden />
            <details className="mx-audio-advanced"><summary>More audio edits</summary>
              <div className="mx-audio-extra-actions">
                <button onClick={razorCut}>Split at playhead</button>
                <button onClick={() => trimSelectedAudioToPlayhead('start')}>Trim start to playhead</button>
                <button onClick={() => trimSelectedAudioToPlayhead('end')}>Trim end to playhead</button>
                {(selectedAudio.originSceneId || selectedAudio.detachedFromSceneId || selectedAudio.reattachedToSceneId) && <button onClick={() => unlinkAudioTrack(selectedAudio.id)}>Unlink from video clip (free move)</button>}
                <button className="mx-danger" onClick={() => removeAudioTrack(selectedAudio.id)}>Delete entire audio clip</button>
              </div>
            </details>
          </>}
          </section>
          <section className="mx-inspector-page" data-inspector-page="export" hidden={inspectorTab !== 'export'}>
          <details className="mx-inspector-section" open><summary>Export settings</summary>
          <div className="mx-help-section-heading"><div className="mx-panel-title">Export settings</div><HelpHint label="Export" topic="export" onHelp={openHelp} /></div>
          {advancedMode && <div className="mx-export-presets"><button onClick={() => applyExportPreset('youtube4k')}>YouTube 4K</button><button onClick={() => applyExportPreset('cinematic')}>Cinema</button><button onClick={() => applyExportPreset('shorts')}>Shorts</button><button onClick={() => applyExportPreset('reels')}>Reels</button><button onClick={() => applyExportPreset('smooth')}>60 FPS</button></div>}
          <label>Canvas<select aria-label="Export resolution" value={settings.resolution} onChange={event => setSettings(value => ({ ...value, resolution: event.target.value, aspectRatio: event.target.value === 'vertical' ? '9:16' : event.target.value === 'square' ? '1:1' : value.aspectRatio }))}><option value="1080p">Full HD 1920×1080</option><option value="1440p">2K 2560×1440</option><option value="4k">4K UHD 3840×2160</option><option value="vertical">Vertical 1080×1920</option><option value="square">Square 1080×1080</option></select></label>
          <label>Aspect ratio<select aria-label="Aspect ratio" value={settings.aspectRatio} disabled={exporterBusy} onChange={event => setSettings(value => ({ ...value, aspectRatio: event.target.value, resolution: ['vertical','square'].includes(value.resolution) ? '1080p' : value.resolution }))}>{['16:9','9:16','1:1','4:3'].map(ratio => <option key={ratio}>{ratio}</option>)}</select></label>
          {advancedMode && <label>Frame rate<select value={settings.fps} onChange={event => setSettings(value => ({ ...value, fps: Number(event.target.value) }))}><option value="24">24 fps — cinematic</option><option value="30">30 fps — standard</option><option value="60">60 fps — smooth</option></select></label>}
          {advancedMode && <label>Quality<select value={settings.quality} onChange={event => setSettings(value => ({ ...value, quality: event.target.value }))}><option value="maximum">Maximum quality</option><option value="balanced">Balanced</option><option value="small">Smaller file</option></select></label>}
          <div className="mx-divider" />
          </details>
          <div className="mx-inspector-export-actions"><button onClick={() => exportVideo()} disabled={!scenes.length}>Export video</button><button onClick={() => exportVideo(null, false, true)} disabled={!scenes.length}>Export without captions</button></div>
          </section>
          <section className="mx-inspector-page" data-inspector-page="text" hidden={inspectorTab !== 'text'}>
          <details className="mx-inspector-section" open><summary>Titles & stickers</summary>
          <div className="mx-help-section-heading"><div className="mx-panel-title">Text and titles</div><HelpHint label="Titles and stickers" topic="text" onHelp={openHelp} /></div>
          <button className="mx-wide" onClick={addTextOverlay}>+ Add Text</button>
          {selectedText && <div className="mx-text-controls"><label>Text<textarea value={selectedText.text} onChange={event => patchTextOverlay(selectedText.id, { text: event.target.value })} /></label><label>Font<select value={selectedText.fontFamily} onChange={event => patchTextOverlay(selectedText.id, { fontFamily: event.target.value })}><option>Arial</option><option>Segoe UI</option><option>Georgia</option><option>Impact</option><option>Comic Sans MS</option></select></label><label>Color<input type="color" value={selectedText.color} onChange={event => patchTextOverlay(selectedText.id, { color: event.target.value })} /></label><label>Shape<select value={selectedText.shape} onChange={event => patchTextOverlay(selectedText.id, { shape: event.target.value })}><option value="none">No shape</option><option value="box">Box</option><option value="pill">Rounded pill</option><option value="badge">Badge</option></select></label><label>Size — {selectedText.fontSize}<input type="range" min="20" max="180" step="2" value={selectedText.fontSize} onChange={event => patchTextOverlay(selectedText.id, { fontSize: Number(event.target.value) })} /></label><label>Opacity — {Math.round(selectedText.opacity * 100)}%<input type="range" min=".2" max="1" step=".05" value={selectedText.opacity} onChange={event => patchTextOverlay(selectedText.id, { opacity: Number(event.target.value) })} /></label><label>3D depth — {selectedText.depth}<input type="range" min="0" max="16" step="1" value={selectedText.depth} onChange={event => patchTextOverlay(selectedText.id, { depth: Number(event.target.value) })} /></label><button className="mx-danger" onClick={() => { setTextOverlays(current => current.filter(item => item.id !== selectedText.id)); setSelectedTextId(''); }}>Delete Text</button></div>}
          <div className="mx-divider" />
          </details>
          </section>
          <section className="mx-inspector-page" data-inspector-page="tools" hidden={inspectorTab !== 'tools'}>
          <div className="mx-inspector-note">Extra tools for narration, logos and individual video crops.</div>
          <details className="mx-inspector-section"><summary>Audio & caption helpers</summary><button className="mx-wide" onClick={() => { scanForStutters(); setStutterCutterOpen(true); }} disabled={!captions.length}>AI Stutter Cutter</button><button className="mx-wide" onClick={autoInjectSfx} disabled={!captions.length}>Auto-Inject SFX</button><button className="mx-wide" onClick={generateChapters} disabled={!captions.length}>Generate Chapters</button><button className="mx-wide" onClick={generateExportAndShutdown} disabled={!scenes.length}>Generate captions, export & shut down</button></details>
          <details className="mx-inspector-section"><summary>Logo & watermark</summary>
          <div className="mx-help-section-heading"><div className="mx-panel-title">Logo watermark</div><HelpHint label="Logo watermark" topic="tools-logo" onHelp={openHelp} /></div>
          <button className={`mx-wide mx-logo-enable ${watermarkEnabled ? 'active' : ''}`} onClick={() => { const next = !watermarkEnabled; if (next) { setWatermark(DEFAULT_LOGO); setWatermarkPreset('bottom-right'); } setWatermarkEnabled(next); }}>{watermarkEnabled ? '✓ Info Kids Logo Enabled' : 'Enable Info Kids Logo'}</button>
          <button className="mx-wide mx-cover-flow" onClick={coverFlowWatermark}>Cover Flow Watermark</button>
          {watermark ? <div className="mx-watermark-control"><span>{watermark.name}</span><button className="mx-danger" onClick={() => { setWatermark(null); setWatermarkEnabled(false); }}>Delete Logo</button></div> : <><button className="mx-wide" onClick={() => { setWatermark(DEFAULT_LOGO); setWatermarkEnabled(true); setWatermarkPreset('bottom-right'); }}>Restore Info Kids Logo</button><button className="mx-wide" onClick={() => watermarkInput.current?.click()}>+ Import another logo</button></>}
          {watermark && <><div className="mx-inspector-note">Drag the logo directly on the preview. Transparent PNG or WebP blends cleanly without changing the video background.</div><label>Quick position<select value={settings.watermarkPosition || 'top-right'} onChange={event => setWatermarkPreset(event.target.value)}><option value="custom">Custom — dragged position</option><option value="top-right">Top right</option><option value="top-left">Top left</option><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="center">Center</option></select></label><label>Logo size — {Math.round(settings.watermarkScale || 16)}%<input type="range" min="5" max="40" step="1" value={settings.watermarkScale || 16} onChange={event => setSettings(value => ({ ...value, watermarkScale: Number(event.target.value) }))} /></label><label>Opacity — {Math.round((settings.watermarkOpacity ?? .85) * 100)}%<input type="range" min="0.1" max="1" step="0.05" value={settings.watermarkOpacity ?? .85} onChange={event => setSettings(value => ({ ...value, watermarkOpacity: Number(event.target.value) }))} /></label></>}
          <div className="mx-divider" />
          </details>
          <details className="mx-inspector-section"><summary>Translate narration</summary>
          <div className="mx-help-section-heading"><div className="mx-panel-title">Translate video voice</div><HelpHint label="Translate narration" topic="voice-translate" onHelp={openHelp} /></div>
          <div className="mx-inspector-note">Select a video on the timeline. Translation uses the engine selected in Captions ({captionEngine === 'groq' ? 'Groq' : 'Local Whisper'}) and spoken word times. After replacing the voice, regenerate that clip's captions.</div>
          <label>Voice language<select value={voiceLanguage} disabled={exporterBusy} onChange={event => setVoiceLanguage(event.target.value)}><option value="en">English / Indian English</option><option value="hi">Hindi</option><option value="te">Telugu</option><option value="ta">Tamil</option><option value="kn">Kannada</option><option value="ml">Malayalam</option></select></label>
          <label>Narration voice<select value={voiceGender} onChange={event => setVoiceGender(event.target.value)} disabled={exporterBusy}><option value="female">Consistent female voice</option><option value="male">Consistent male voice</option></select></label>
           <button className="mx-wide mx-voice-change" onClick={changeSelectedVideoVoice} disabled={!selected || selected.kind !== 'video' || exporterBusy}>{voiceChanging ? 'Translating and synchronizing voice…' : `Change Selected Video Voice to ${CAPTION_LANGUAGE_NAMES[voiceLanguage]}`}</button>
          <div className="mx-divider" />
          </details>
          <details className="mx-inspector-section"><summary>Voice tools</summary>
          <div className="mx-help-section-heading"><div className="mx-panel-title">Vocal Morphing Studio</div><HelpHint label="Voice tools" topic="voice-morph" onHelp={openHelp} /></div>
          <div className="mx-inspector-note">Morph the timbre of any audio track on the timeline to match another voice profile offline.</div>
          <label>Target voice timbre<select value={targetMorphVoice} onChange={event => setTargetMorphVoice(event.target.value)}><option value="sc3">SC3 Default Voice</option><option value="female">Standard Female Voice</option><option value="male">Standard Male Voice</option></select></label>
          <button className="mx-wide" onClick={morphSelectedAudio} disabled={!selectedAudio || audioMorphing}>{audioMorphing ? 'Morphing voice timbre...' : 'Morph Selected Audio Timbre'}</button>
          <div className="mx-divider" />
          </details>
          </section>
          <section className="mx-inspector-page" data-inspector-page="captions" hidden={inspectorTab !== 'captions'}>
          <details className="mx-inspector-section" open><summary>Automatic captions</summary>
          <div className="mx-panel-title">Automatic captions</div>
          <div className="mx-help-section-heading"><div className="mx-panel-title">Caption engine</div><HelpHint label="Caption engine" topic="captions-engine" onHelp={openHelp} /></div><label>Caption engine<select aria-label="Caption engine" value={captionEngine} disabled={exporterBusy} onChange={event => setCaptionEngine(event.target.value)}><option value="local">Local Whisper · offline</option><option value="groq">Groq · cloud transcription</option></select></label>
          <label>Caption language<select value={captionLanguage} onChange={event => setCaptionLanguage(event.target.value)}><option value="auto">Same as spoken video / detect</option><option value="en">English / Indian English</option><option value="te">Telugu</option><option value="hi">Hindi</option><option value="ta">Tamil</option><option value="kn">Kannada</option><option value="ml">Malayalam</option></select></label>
          {detectedCaptionLanguage && <div className="mx-caption-source"><strong>{captionEngine === 'groq' ? 'Groq captions' : 'Local captions'}</strong><span>Detected: {detectedCaptionLanguage}</span></div>}
          <div className="mx-caption-actions"><button className="mx-wide" onClick={generateCaptions} disabled={!scenes.length || captioning || exporting}>{captioning ? 'Generating captions…' : captions.length ? 'Regenerate captions' : 'Generate captions'}</button><button className="mx-wide" onClick={() => setCaptionEditorOpen(true)} disabled={!captions.length}>Edit captions</button></div>
          <label className="mx-check"><input type="checkbox" checked={settings.burnCaptions} onChange={event => setSettings(value => ({ ...value, burnCaptions: event.target.checked }))} /> Show captions permanently in exported video</label>
          <label>Caption style<select value={settings.captionStyle || 'classic'} onChange={event => setSettings(value => ({ ...value, captionStyle: event.target.value }))}><option value="classic">Classic white</option><option value="box">Readable black box</option><option value="yellow">Cinema yellow</option><option value="karaoke">Karaoke highlight</option></select></label>
          <label>Position<select value={settings.captionPosition || 'bottom'} onChange={event => setSettings(value => ({ ...value, captionPosition: event.target.value }))}><option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select></label>
          <label>Text size — {settings.captionFontSize || 42}<input type="range" min="24" max="84" step="2" value={settings.captionFontSize || 42} onChange={event => setSettings(value => ({ ...value, captionFontSize: Number(event.target.value) }))} /></label>
          <details className="mx-caption-advanced"><summary>Advanced caption options</summary><div>
            <label>Font style<select value={settings.captionFontFamily || 'Arial'} onChange={event => setSettings(value => ({ ...value, captionFontFamily: event.target.value }))}><option>Arial</option><option>Segoe UI</option><option>Georgia</option><option>Impact</option><option>Comic Sans MS</option></select></label>
            <label className="mx-check"><input type="checkbox" checked={settings.captionBold !== false} onChange={event => setSettings(value => ({ ...value, captionBold: event.target.checked }))} /> Bold</label>
            <label>Color<input type="color" value={settings.captionColor || '#ffffff'} onChange={event => setSettings(value => ({ ...value, captionColor: event.target.value }))} /></label>
            <label>Width — {settings.captionWidth || 100}%<input type="range" min="30" max="100" value={settings.captionWidth || 100} onChange={event => setSettings(value => ({ ...value, captionWidth: Number(event.target.value) }))} /></label>
            <label>Height — {settings.captionHeight || 100}%<input type="range" min="70" max="140" value={settings.captionHeight || 100} onChange={event => setSettings(value => ({ ...value, captionHeight: Number(event.target.value) }))} /></label>
            <div className="mx-inspector-note">Caption outline is disabled in preview and export.</div>
          </div></details>
          <label>Line length — {settings.captionMaxChars || 36} characters<input type="range" min="16" max="60" step="2" value={settings.captionMaxChars || 36} onChange={event => setSettings(value => ({ ...value, captionMaxChars: Number(event.target.value) }))} /></label>
          {hasRealCaptions ? <div className="mx-preview-truth"><strong>Real captions active</strong><span>The demo caption is disabled. Preview uses the same timing, wrapping, size, position and style sent to export.</span></div> : <button className="mx-wide" onClick={() => setCaptionSampleVisible(value => !value)}>{captionSampleVisible ? 'Hide Caption Sample' : 'Show Caption Sample'}</button>}
          {captions.length > 0 && <details className="mx-caption-review" open={Boolean(selectedCaptionId)}><summary>Review captions ({captions.length})</summary><div className="mx-caption-list">{captions.map((item, index) => <div key={item.id} className={editingCaptionId === item.id ? 'editing' : ''}><div className="mx-caption-edit-head"><strong>Caption {index + 1}</strong><button onClick={() => { setEditingCaptionId(editingCaptionId === item.id ? '' : item.id); setSelectedCaptionId(item.id); setSelectedId(''); setSelectedAudioId(''); setPlayheadTime(item.start); }}>{editingCaptionId === item.id ? '✓ Save' : '✎ Edit Caption'}</button><button className="mx-caption-delete" onClick={() => { setCaptions(current => current.filter(caption => caption.id !== item.id)); if (selectedCaptionId === item.id) setSelectedCaptionId(''); if (editingCaptionId === item.id) setEditingCaptionId(''); }}>Delete</button></div><div className="mx-caption-time"><label>Start<input type="number" min="0" step="0.1" value={Number(item.start).toFixed(1)} disabled={editingCaptionId !== item.id} onChange={event => setCaptions(current => current.map(caption => caption.id === item.id ? { ...caption, start: Math.max(0, Number(event.target.value)), words: [], timingSource: 'estimated' } : caption))} /></label><label>End<input type="number" min={Number(item.start) + .1} step="0.1" value={Number(item.end).toFixed(1)} disabled={editingCaptionId !== item.id} onChange={event => setCaptions(current => current.map(caption => caption.id === item.id ? { ...caption, end: Math.max(Number(caption.start) + .1, Number(event.target.value)), words: [], timingSource: 'estimated' } : caption))} /></label></div><textarea value={item.text} readOnly={editingCaptionId !== item.id} spellCheck={editingCaptionId === item.id} lang={captionLanguage === 'auto' ? undefined : captionLanguage} title={editingCaptionId === item.id ? 'Correct spelling or rewrite this caption, then press Save.' : 'Press Edit Caption to correct this text.'} onChange={event => setCaptions(current => current.map(caption => caption.id === item.id ? { ...caption, text: event.target.value, words: [] } : caption))} /></div>)}</div></details>}
          </details>
          </section>
          <section className="mx-inspector-page" data-inspector-page="tools" hidden={inspectorTab !== 'tools'}>
          <details className="mx-inspector-section"><summary>Direct crop & part export</summary>
          <div className="mx-help-section-heading"><div className="mx-panel-title">Crop video & save locally</div><HelpHint label="Crop and part export" topic="tools-crop" onHelp={openHelp} /></div>
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
          </details>
          <details className="mx-inspector-section"><summary>Project tools</summary><button className="mx-wide" onClick={resetExporter}>Reset editor</button><button className="mx-wide mx-danger" onClick={deleteProject}>Delete project</button></details>
          </section>
          </fieldset>
          {captioning && <button className="mx-wide mx-danger" onClick={cancelCaptionGeneration}>Cancel caption generation</button>}
          {audioMorphing && <button className="mx-wide mx-danger" onClick={cancelVoiceGeneration}>Cancel current voice generation</button>}
          <div className="mx-progress"><div><span style={{ width: `${progress.pct}%` }} /></div><p>{progress.phase}{exporting && exportEtaSeconds > 0 ? ` · Estimated time remaining: ${formatEta(exportEtaSeconds)}` : exporting ? ' · Calculating estimated time…' : ''}</p></div>
          {warning && <div className="mx-warning" role="alert"><strong>Warning</strong><span>{warning}</span><button onClick={() => setWarning('')}>Dismiss</button></div>}
          {exporting && <button className="mx-wide mx-danger" onClick={cancelExport}>Cancel export</button>}
          {result && <div className="mx-result"><strong>Video ready</strong><span>{result.width}×{result.height} · {formatTime(result.duration)}</span><button onClick={() => window.electronAPI?.openFile?.(result.outputPath)}>Play video</button><button onClick={() => window.electronAPI?.showItemInFolder?.(result.outputPath)}>Open folder</button></div>}
        </aside>
        {captionEditorOpen && <div className="mx-caption-editor-modal"><div className="mx-caption-editor-window"><header><div><strong>Complete Caption Timeline</strong><span>{captions.length} captions · edit every line before export</span></div><button onClick={() => setCaptionEditorOpen(false)}>Done</button></header><div className="mx-caption-editor-scroll">{captions.map((item, index) => <div key={item.id}><b>{index + 1}</b><label>Start<input type="number" step=".1" value={Number(item.start).toFixed(1)} onChange={event => setCaptions(current => current.map(c => c.id === item.id ? { ...c, start: Math.max(0, Number(event.target.value)), words: [], timingSource: 'estimated' } : c))} /></label><label>End<input type="number" step=".1" value={Number(item.end).toFixed(1)} onChange={event => setCaptions(current => current.map(c => c.id === item.id ? { ...c, end: Math.max(c.start + .1, Number(event.target.value)), words: [], timingSource: 'estimated' } : c))} /></label><textarea spellCheck value={item.text} onFocus={() => { setPlayheadTime(item.start); setSelectedCaptionId(item.id); }} onChange={event => setCaptions(current => current.map(c => c.id === item.id ? { ...c, text: event.target.value, words: [] } : c))} /><button className="mx-danger" onClick={() => setCaptions(current => current.filter(c => c.id !== item.id))}>Delete</button></div>)}</div></div></div>}
      </div>
      <footer className={`mx-operation-status ${warning ? 'has-warning' : ''}`}>
        <span role={warning ? 'alert' : 'status'} title={warning || progress.phase}>{warning || progress.phase}{exporting ? ` · ${progress.pct}%` : ''}</span>
        {warning && <button onClick={() => openInspector(inspectorTab)}>Details</button>}
        {recoveryNeeded.current && <button onClick={saveProject}>Save recovery copy</button>}
        {captioning && <button onClick={cancelCaptionGeneration}>Cancel captions</button>}
        {exporting && <button onClick={cancelExport}>Cancel export</button>}
        {result && <button onClick={() => window.electronAPI?.showItemInFolder?.(result.outputPath)}>Open exported file</button>}
      </footer>
      {helpTopic && <HelpGuide topicId={helpTopic} onClose={() => setHelpTopic(null)} onLocate={locateHelpControls} />}
      {contextMenu && <div className="mx-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={event => event.stopPropagation()} onContextMenu={event => event.preventDefault()}>
        <header><strong>{contextMenu.type === 'video' ? (contextMenuScene?.kind === 'image' ? 'Image Clip' : 'Video Clip · Filmora 15') : 'Audio Clip · Filmora 15'}</strong><span>{contextMenu.name || contextMenuAudio?.name}</span></header>
        {contextMenu.type === 'video' ? <>
          <button className="mx-context-highlight" onClick={() => { detachSelectedAudio(contextMenu.id); setContextMenu(null); }} disabled={contextMenuScene?.kind !== 'video' || contextMenuScene?.hasAudio === false}><span>{contextMenuDetachedTrack ? '♫ Select Detached Audio' : '♫ Detach Audio'}</span><kbd>Ctrl+Alt+D</kbd></button>
          {contextMenuDetachedTrack && <button className="reattach-menu" onClick={() => { reattachSelectedAudio(contextMenuDetachedTrack.id); setContextMenu(null); }}><span>🔗 Reattach Audio to Video</span></button>}
          {scenes.filter(s => s.kind === 'video' && s.hasAudio !== false).length > 1 && <button onClick={() => { detachAllVideoAudio(); setContextMenu(null); }}><span>♫ Detach Audio from All Videos</span></button>}
          <button onClick={() => { patchScene(contextMenu.id, { muted: !contextMenuScene?.muted }); setContextMenu(null); }} disabled={contextMenuScene?.kind !== 'video' || contextMenuScene?.hasAudio === false}><span>{contextMenuScene?.muted ? '🔊 Unmute Clip Audio' : '🔇 Mute Clip Audio'}</span><kbd>Ctrl+Shift+M</kbd></button>
          <div className="mx-context-separator" />
          <button onClick={() => { razorCut(); setContextMenu(null); }} disabled={trackStates.videoLocked}><span>✂ Split at Playhead</span><kbd>S</kbd></button>
          <button onClick={() => { trimSceneToPlayhead('start'); setContextMenu(null); }}><span>⇤ Trim Start to Playhead</span></button>
          <button onClick={() => { trimSceneToPlayhead('end'); setContextMenu(null); }}><span>⇥ Trim End to Playhead</span></button>
          <div className="mx-context-separator" />
          <button onClick={() => { copyScene(); setContextMenu(null); }}><span>⧉ Copy Clip</span><kbd>Ctrl+C</kbd></button>
          <button onClick={() => { pasteScene(); setContextMenu(null); }} disabled={!sceneClipboard}><span>▣ Paste Clip</span><kbd>Ctrl+V</kbd></button>
          <button onClick={() => { duplicateScene(); setContextMenu(null); }}><span>Duplicate Clip</span><kbd>Ctrl+D</kbd></button>
          <button onClick={() => { setSettings(value => ({ ...value, framing: 'fill' })); setScenes(current => current.map(scene => ({ ...scene, fit: 'fill' }))); setContextMenu(null); }}><span>Crop and Zoom — Fill</span></button>
          <button onClick={() => { setSettings(value => ({ ...value, framing: 'contain' })); setScenes(current => current.map(scene => ({ ...scene, fit: 'contain' }))); setContextMenu(null); }}><span>Crop to Fit — Full Frame</span></button>
          <button onClick={() => { patchScene(contextMenu.id, { rotation: (Number(contextMenuScene?.rotation || 0) + 90) % 360 }); setContextMenu(null); }}><span>Rotate 90° Clockwise</span></button>
          <button onClick={() => { generateCaptions(); setContextMenu(null); }}><span>Speech to Text (Captions)</span></button>
          <button onClick={() => { changeSelectedVideoVoice(); setContextMenu(null); }}><span>AI Voice Translation</span></button>
          <button onClick={() => { patchScene(contextMenu.id, { speed: Number(contextMenuScene?.speed || 1) === 1 ? .5 : Number(contextMenuScene?.speed || 1) === .5 ? 2 : 1 }); setContextMenu(null); }}><span>⚡ Speed — {Number(contextMenuScene?.speed || 1).toFixed(2)}×</span></button>
          <button onClick={() => { applyVisualPreset('cinematic'); setContextMenu(null); }}><span>Effects & Filters</span></button>
          <div className="mx-context-separator" />
          <button onClick={() => { moveScene(contextMenu.id, -1); setContextMenu(null); }}><span>← Move Earlier</span></button>
          <button onClick={() => { moveScene(contextMenu.id, 1); setContextMenu(null); }}><span>Move Later →</span></button>
          <button onClick={() => { mergeSelectedWithNext(); setContextMenu(null); }}><span>Group With Next Clip</span></button>
          <button onClick={() => { renameSelectedScene(); setContextMenu(null); }}><span>Rename Clip</span><kbd>F2</kbd></button>
          <button onClick={() => { patchScene(contextMenu.id, { disabled: !contextMenuScene?.disabled }); setContextMenu(null); }}><span>{contextMenuScene?.disabled ? 'Enable Clip' : 'Disable Clip'}</span></button>
          <button onClick={() => { openInspector('clip'); setAdvancedMode(true); setContextMenu(null); }}><span>Edit Properties</span></button>
          <button onClick={() => { locateSelectedSource(); setContextMenu(null); }}><span>Locate in Media Library</span></button>
          <button onClick={() => { replaceSelectedScene(); setContextMenu(null); }}><span>Replace Clip</span></button>
          <button onClick={() => { if (preview.current && contextMenuScene) { preview.current.currentTime = Number(contextMenuScene.trimStart || 0); seekTimeline(sceneTimelineOffset(contextMenuScene.id)); } setContextMenu(null); }}><span>Match First Frame</span></button>
          <button onClick={() => { patchScene(contextMenu.id, { colorMark: contextMenuScene?.colorMark === 'gold' ? 'blue' : contextMenuScene?.colorMark === 'blue' ? 'green' : contextMenuScene?.colorMark === 'green' ? '' : 'gold' }); setContextMenu(null); }}><span>Change Clip Colour</span></button>
          <button onClick={() => { setSnapEnabled(value => !value); setContextMenu(null); }}><span>{snapEnabled ? 'Disable' : 'Enable'} Timeline Snapping</span><kbd>N</kbd></button>
          <div className="mx-context-separator" />
          <button className="danger" onClick={() => { removeScene(contextMenu.id, true); setContextMenu(null); }}><span>Ripple Delete Scene</span><kbd>Shift+Del</kbd></button>
          <button className="danger" onClick={() => { removeScene(contextMenu.id); setContextMenu(null); }}><span>🗑 Delete Scene</span><kbd>Del</kbd></button>
        </> : <>
          <button className="reattach-menu" onClick={() => { reattachSelectedAudio(contextMenu.id); setContextMenu(null); }}><span>🔗 Reattach Audio to Video</span></button>
          {(contextMenuAudio?.originSceneId || contextMenuAudio?.detachedFromSceneId || contextMenuAudio?.reattachedToSceneId) && <button onClick={() => { unlinkAudioTrack(contextMenu.id); setContextMenu(null); }}><span>🔓 Unlink from Video (Free Move)</span></button>}
          <button onClick={() => { openInspector('clip'); setContextMenu(null); }}><span>🎛 Adjust Audio (Volume / Fade / Speed)</span></button>
          <div className="mx-context-separator" />
          <button onClick={() => { razorCut(); setContextMenu(null); }} disabled={trackStates.audioLocked}><span>✂ Split at Playhead</span><kbd>S</kbd></button>
          <button onClick={() => { beginCutPositionSelection(contextMenu.id); setContextMenu(null); }}><span>✂ Cut Selected Position Audio</span><kbd>2 clicks</kbd></button>
          <button className="danger" onClick={() => { removeHighlightedAudio(); setContextMenu(null); }} disabled={audioSelection?.trackId !== contextMenu.id || audioSelection?.awaitingEnd}><span>Remove Selected Audio Range</span></button>
          <button onClick={() => { trimSelectedAudioToPlayhead('start'); setContextMenu(null); }} disabled={trackStates.audioLocked}><span>⇤ Trim Start to Playhead</span></button>
          <button onClick={() => { trimSelectedAudioToPlayhead('end'); setContextMenu(null); }} disabled={trackStates.audioLocked}><span>⇥ Trim End to Playhead</span></button>
          <div className="mx-context-separator" />
          <button onClick={() => { copySelectedAudio(); setContextMenu(null); }}><span>⧉ Copy Audio</span><kbd>Ctrl+C</kbd></button>
          <button onClick={() => { pasteCopiedAudio(); setContextMenu(null); }} disabled={!audioClipboard}><span>▣ Paste at Playhead</span><kbd>Ctrl+V</kbd></button>
          <button onClick={() => { duplicateSelectedAudio(); setContextMenu(null); }}><span>Duplicate After Clip</span></button>
          <button onClick={() => { patchAudioTrack(contextMenu.id, { muted: !contextMenuAudio?.muted }); setContextMenu(null); }}><span>{contextMenuAudio?.muted ? '🔊 Unmute Audio' : '🔇 Mute Audio'}</span></button>
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
