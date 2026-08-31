import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import JSZip from 'jszip';
import { motion, AnimatePresence } from 'framer-motion';
import {
  QueueItem, CaptionItem, CaptionSettings, WordItem, Language, CAPTION_LANGUAGES,
} from './types';
import { transcribeWithHuggingFace, testHFToken } from './transcribe';
import { burnCaptions } from './burn';

// ── helpers ───────────────────────────────────────────────────────────────
const uid    = () => Math.random().toString(36).slice(2, 10);
const sanify = (n: string) => n.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 28) || 'video';
const QUEUE_EXPORT_FONT_SIZE = 50;
const CAPTION_WORD_LIMIT = 8;
const CAPTION_BOTTOM_OFFSET_PX = 25;
const SHORT_CAPTION_GAP_SECONDS = 0.75;

function dlBlob(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: u, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function saveBlobInChunks(api: any, blob: Blob, fileName: string) {
  const begin = await api.beginDownloadFile(fileName);
  if (!begin?.ok) throw new Error(begin?.error || 'Could not create output file');
  const chunkSize = 2 * 1024 * 1024;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const chunk = blob.slice(offset, Math.min(blob.size, offset + chunkSize));
    const base64 = await blobToBase64(chunk);
    const appended = await api.appendDownloadChunk(begin.id, base64);
    if (!appended?.ok) throw new Error(appended?.error || 'Could not write output chunk');
  }
  const finished = await api.finishDownloadFile(begin.id);
  if (!finished?.ok) throw new Error(finished?.error || 'Could not finish output file');
  if (api?.isMobileRemote && finished.downloadUrl) {
    const anchor = document.createElement('a');
    anchor.href = finished.downloadUrl;
    anchor.download = finished.fileName || fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
  return { filePath: finished.filePath as string, fileName: finished.fileName as string };
}

function electronApi(): any {
  return typeof window !== 'undefined' ? (window as any).electronAPI : null;
}

const SC: Record<string, string> = {
  White: '#ffffff',
  Yellow: '#facc15',
  Cyan: '#22d3ee',
  Black: '#000000',
  'Black (70%)': 'rgba(0,0,0,0.7)',
  'White (20%)': 'rgba(255,255,255,0.2)',
  Transparent: 'transparent',
};
const sc = (t: string) => SC[t] ?? '#ffffff';
const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
};

// ── Inline SVG Icons ────────────────────────────────────────────────────────
const IconPlus = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);
const IconTrash = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
  </svg>
);
const IconDownload = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);
const IconZip = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
  </svg>
);
const IconEdit = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
  </svg>
);
const IconKey = () => (
  <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
  </svg>
);
const IconPlay = () => (
  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const IconPause = () => (
  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);
const IconRewind = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 8l-5 4 5 4V8zm11 0l-6 4 6 4V8z" />
  </svg>
);
const IconForward = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 8l5 4-5 4V8zM4 8l6 4-6 4V8z" />
  </svg>
);
const IconSettings = () => (
  <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.43l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.645-.869l.214-1.28z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
const IconChevron = ({ open }: { open: boolean }) => (
  <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
);
const IconMic = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
  </svg>
);
const IconFire = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
  </svg>
);

// ── Status colors ───────────────────────────────────────────────────────────
const statusConfig = {
  idle:        { dot: 'bg-slate-600',   label: 'Ready',       text: 'text-slate-400' },
  transcribing:{ dot: 'bg-blue-500 animate-pulse', label: 'ASR…', text: 'text-blue-400' },
  transcribed: { dot: 'bg-amber-500',   label: 'Transcribed', text: 'text-amber-400' },
  exporting:   { dot: 'bg-violet-500 animate-pulse', label: 'Burning…', text: 'text-violet-400' },
  completed:   { dot: 'bg-emerald-500', label: 'Done ✓',      text: 'text-emerald-400' },
  failed:      { dot: 'bg-rose-500',    label: 'Error',       text: 'text-rose-400' },
  cancelled:   { dot: 'bg-slate-500',   label: 'Cancelled',   text: 'text-slate-400' },
};

// ── Props ─────────────────────────────────────────────────────────────────
interface Props { onClose: () => void }

export default function CaptionBurner({ onClose }: Props) {
  const [apiKey, setApiKey] = useState(() => electronApi()?.getGroqApiKey?.() || '');

  const [queue, setQueue]         = useState<QueueItem[]>([]);
  const [activeId, setActiveId]   = useState<string | null>(null);
  const [videoUrl, setVideoUrl]   = useState<string | null>(null);
  const [curTime, setCurTime]     = useState(0);
  const [processing, setProc]     = useState(false);
  const [batchOn, setBatch]       = useState(false);
  const [autoBurn, setAutoBurn]   = useState(() => {
    try { return localStorage.getItem('caption-burner-auto-burn') !== 'false'; }
    catch { return true; }
  });
  const [isZipping, setZipping]   = useState(false);
  const [errorMsg, setError]      = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting]     = useState(false);
  const [erasing, setErasing]     = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration]   = useState(0);
  // URL of the burned output video to show on canvas after export completes
  const [burnedVideoUrl, setBurnedVideoUrl] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<string>('16/9');

  const [openSection, setOpenSection] = useState<string | null>('presets');

  const [editingCapIndex, setEditingCapIndex] = useState<number | null>(null);
  const [editingCapText, setEditingCapText]   = useState<string>('');

  const [S, setS] = useState<CaptionSettings>({
    fontSize: QUEUE_EXPORT_FONT_SIZE,
    fontColor: 'White',
    bgColor: 'Transparent',
    style: 'white-yellow',
    position: 'bottom',
    xPos: 50,
    yPos: 90,
    highlightColor: '#facc15',
    language: 'English',
    offset: 0,
    maxWordsPerCaption: CAPTION_WORD_LIMIT,
    engine: 'groq',
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const vidRef  = useRef<HTMLVideoElement>(null);
  const rafRef  = useRef(0);
  const abortControllersRef = useRef<Record<string, AbortController>>({});
  const pendingAutoStartIdRef = useRef<string | null>(null);
  const activeItem = useMemo(() => queue.find(i => i.id === activeId), [queue, activeId]);
  const activeVideoHeight = activeItem?.video.height || 1080;
  const previewFontSize = `calc(${S.fontSize} * 100cqh / ${activeVideoHeight})`;
  const previewBottomOffset = `calc(${CAPTION_BOTTOM_OFFSET_PX}px * 100cqh / ${activeVideoHeight})`;

  // RAF preview sync
  useEffect(() => {
    const loop = () => {
      if (vidRef.current && !vidRef.current.paused) {
        setCurTime(vidRef.current.currentTime);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Listen for local transcribe progress via IPC
  useEffect(() => {
    const api = electronApi();
    if (!api?.onTranscribeProgress) return;
    const handler = (pct: number) => {
      setQueue(q => {
        const idx = q.findIndex(i => i.status === 'transcribing');
        if (idx === -1) return q;
        const nq = [...q];
        nq[idx] = { ...nq[idx], progress: Math.min(99, 8 + (pct * 0.85)) };
        return nq;
      });
    };
    api.onTranscribeProgress(handler);
    return () => api.offTranscribeProgress && api.offTranscribeProgress(handler);
  }, []);

  // Position presets
  useEffect(() => {
    if (S.position === 'top')    setS(s => ({ ...s, yPos: 14 }));
    if (S.position === 'bottom') setS(s => ({ ...s, yPos: 90 }));
  }, [S.position]);

  // Video URL loader
  // In Electron: use file:// path directly (blob URLs fail for large videos).
  // In browser: fall back to blob URL.
  useEffect(() => {
    // Clear burned output preview when switching to a different video
    setBurnedVideoUrl(null);
    setAspectRatio('16/9');

    const item = activeItem;
    if (!item) {
      setVideoUrl(null);
      setDuration(0);
      setIsPlaying(false);
      return;
    }
    if (!item.video.file) {
      setVideoUrl(null);
      return;
    }
    // Use native file path in Electron to avoid blob URL failures on large files
    const api = (window as any).electronAPI;
    if (api?.getPathForFile && !api?.isMobileRemote) {
      const filePath = api.getPathForFile(item.video.file);
      if (filePath) {
        // Convert Windows backslashes to forward slashes for file:// URL
        const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
        setVideoUrl(fileUrl);
        return;
      }
    }
    // Browser fallback: blob URL
    const u = URL.createObjectURL(item.video.file);
    setVideoUrl(u);
    return () => { URL.revokeObjectURL(u); };
  }, [activeId, activeItem?.video.file]);

  const upd = useCallback((id: string, p: Partial<QueueItem>) =>
    setQueue(q => q.map(i => i.id === id ? { ...i, ...p } : i)), []);

  const settingsForItem = useCallback((item: QueueItem): CaptionSettings => ({
    ...S,
    language: ((item.language || S.language) === 'Auto-Detect' && item.detectedLang && CAPTION_LANGUAGES.includes(item.detectedLang as Language))
      ? item.detectedLang as Language
      : item.language || S.language,
  }), [S]);

  const setItemLanguage = useCallback((id: string, language: Language) => {
    upd(id, {
      language,
      status: 'idle',
      progress: 0,
      message: `Language set · ${language}`,
      captions: undefined,
      detectedLang: undefined,
      outputUrl: undefined,
      outputPath: undefined,
      outputFileName: undefined,
    });
  }, [upd]);

  // Remove a video from the queue
  const remove = useCallback((id: string) => {
    setQueue(q => {
      const next = q.filter(i => i.id !== id);
      if (activeId === id) {
        setActiveId(next[0]?.id || null);
        if (!next.length) {
          setVideoUrl(null);
          setBurnedVideoUrl(null);
        }
      }
      return next;
    });
  }, [activeId]);

  const clearAll = useCallback(() => {
    for (const controller of Object.values(abortControllersRef.current)) controller.abort();
    abortControllersRef.current = {};
    if (typeof window.electronAPI?.cancelTranscribeVideo === 'function') {
      window.electronAPI.cancelTranscribeVideo({ all: true }).catch(() => {});
    }
    pendingAutoStartIdRef.current = null;
    setQueue([]);
    setActiveId(null);
    setVideoUrl(null);
    setBurnedVideoUrl(null);
    setDuration(0);
    setCurTime(0);
    setIsPlaying(false);
    setProc(false);
    setBatch(false);
    setError(null);
    if (fileRef.current) {
      fileRef.current.value = '';
      delete fileRef.current.dataset.pattanUploaded;
      delete fileRef.current.dataset.pattanUploading;
    }
  }, []);

  const notify = useCallback((title: string, body: string) => {
    const api = electronApi();
    if (api?.showNotification) {
      api.showNotification(title, body).catch(() => {});
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  }, []);

  const isCancelError = (e: any) =>
    e?.name === 'AbortError' || /cancel/i.test(String(e?.message || e || ''));

  const cancelVideoItem = useCallback((id: string) => {
    if (!id) return;
    const controller = abortControllersRef.current[id];
    if (controller) {
      controller.abort();
      delete abortControllersRef.current[id];
    }
    if (typeof window.electronAPI?.cancelTranscribeVideo === 'function') {
      window.electronAPI.cancelTranscribeVideo({ id }).catch(() => {});
    }
    upd(id, { status: 'cancelled', progress: 0, message: 'Cancelled' });
    const item = queue.find(i => i.id === id);
    if (item) {
      notify('Cancelled', item.video.name);
    }
    setProc(Object.keys(abortControllersRef.current).length > 0);
  }, [queue, upd, notify]);

  const cancelCurrentVideo = useCallback(() => {
    const id = queue.find(i => i.status === 'transcribing' || i.status === 'exporting')?.id || activeId;
    if (id) {
      cancelVideoItem(id);
    }
  }, [activeId, queue, cancelVideoItem]);

  const speak = useCallback((text: string) => {
    try {
      if (!('speechSynthesis' in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    } catch {}
  }, []);

  const saveBlobToDownloads = useCallback(async (blob: Blob, fileName: string) => {
    if (!blob || blob.size <= 0) throw new Error('Generated video is empty. Please re-run export.');
    const api = electronApi();
    if (api?.beginDownloadFile && api?.appendDownloadChunk && api?.finishDownloadFile) {
      return saveBlobInChunks(api, blob, fileName);
    }
    if (api?.saveToDownloads) {
      const base64 = await blobToBase64(blob);
      const result = await api.saveToDownloads(fileName, base64);
      if (!result?.ok) throw new Error(result?.error || 'Could not save to Downloads');
      return { filePath: result.filePath as string, fileName: result.fileName as string };
    }
    dlBlob(blob, fileName);
    return { filePath: '', fileName };
  }, []);

  const addFiles = async (files: File[], opts: { language?: Language; autoStart?: boolean } = {}) => {
    setError(null);
    const language = opts.language || S.language;
    const selectedVideos = files.filter(f => f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(f.name));
    const api = electronApi();
    if (api?.isMobileRemote && api?.uploadMobileFile) {
      try {
        for (const file of selectedVideos) {
          await api.uploadMobileFile(file);
        }
      } catch (error: any) {
        setError(`Mobile upload failed: ${String(error?.message || error)}. Select the video again and keep this page open until upload completes.`);
        return;
      }
    }
    const validFiles = selectedVideos.map(f => ({
      id: uid(),
      video: { name: f.name, mimeType: f.type, file: f },
      status: 'idle' as const,
      progress: 0,
      message: 'Ready',
      retryCount: 0,
      language,
    }));
    if (validFiles.length > 0) {
      setQueue(q => [...q, ...validFiles]);
      if (!activeId) setActiveId(validFiles[0].id);
      if (opts.autoStart) pendingAutoStartIdRef.current = validFiles[0].id;
    }
  };

  // Transcribe
  const transcribeItem = useCallback(async (item: QueueItem, signal?: AbortSignal) => {
    setError(null);
    notify('Transcribe start', item.video.name);
    try {
      const { captions, detectedLang } = await transcribeWithHuggingFace(
        item.video.file!, item.language || S.language, apiKey, S.maxWordsPerCaption,
        (msg, pct) => upd(item.id, { status: 'transcribing', message: msg, progress: pct }),
        S.engine,
        signal,
      );
      const resolvedLanguage = item.language === 'Auto-Detect' && CAPTION_LANGUAGES.includes(detectedLang as Language)
        ? detectedLang as Language
        : item.language;
      const nextItem: QueueItem = {
        ...item,
        status: 'transcribed',
        captions,
        message: `Ready · ${detectedLang}`,
        detectedLang,
        language: resolvedLanguage,
        progress: 0,
      };
      upd(item.id, {
        status: 'transcribed',
        captions,
        message: `Ready · ${detectedLang}`,
        detectedLang,
        language: resolvedLanguage,
        progress: 0,
      });
      notify('Transcribe complete', item.video.name);
      return nextItem;
    } catch (e: any) {
      if (isCancelError(e)) {
        upd(item.id, { status: 'cancelled', message: 'Cancelled', progress: 0 });
        return null;
      }
      const msg = String(e.message || 'Unknown error');
      upd(item.id, { status: 'failed', message: msg.slice(0, 80) });
      setError(msg);
      notify('Transcribe failed', `${item.video.name}: ${msg.slice(0, 80)}`);
      return null;
    }
  }, [S.language, S.maxWordsPerCaption, S.engine, apiKey, upd, notify]);

  // Burn captions
  const burnItem = useCallback(async (item: QueueItem, opts: { autoDownload?: boolean; phaseName?: string; signal?: AbortSignal; fontSize?: number } = {}) => {
    if (!item.captions) return null;
    setError(null);
    notify(opts.phaseName || 'Burn start', item.video.name);
    upd(item.id, { status: 'exporting', message: 'Burning captions…', progress: 0 });
    try {
      const itemSettings = settingsForItem(item);
      const burnSettings = {
        ...itemSettings,
        fontSize: opts.fontSize ?? itemSettings.fontSize,
      };
      const result = await burnCaptions(
        item.video.file!,
        item.captions,
        burnSettings,
        p => upd(item.id, { progress: p }),
        opts.signal,
        {
          width: item.video.width,
          height: item.video.height,
          duration: item.video.duration,
        },
      );
      const outputName = item.video.name || 'video.mp4';
      
      let saved = { filePath: '', fileName: '' };
      let outputUrl = '';
      
      if (result.blob) {
        saved = opts.autoDownload !== false
          ? await saveBlobToDownloads(result.blob, outputName)
          : { filePath: '', fileName: outputName };
        outputUrl = URL.createObjectURL(result.blob);
      } else {
        saved = { filePath: result.outputPath || '', fileName: result.outputFileName || outputName };
        outputUrl = `file:///${result.outputPath.replace(/\\/g, '/')}`;
      }

      const nextItem: QueueItem = {
        ...item,
        status: 'completed',
        message: saved.filePath ? `Saved · ${saved.fileName}` : 'Done ✓',
        progress: 100,
        outputUrl,
        outputPath: saved.filePath,
        outputFileName: saved.fileName,
      };
      upd(item.id, {
        status: 'completed',
        message: saved.filePath ? `Saved · ${saved.fileName}` : 'Done ✓',
        progress: 100,
        outputUrl,
        outputPath: saved.filePath,
        outputFileName: saved.fileName,
      });
      // Auto-switch canvas to the burned output so user can watch it immediately
      setBurnedVideoUrl(outputUrl);
      notify('Burn complete', saved.filePath ? `${item.video.name} saved to Downloads` : item.video.name);
      speak(`${item.video.name} completed`);
      return nextItem;
    } catch (e: any) {
      if (isCancelError(e)) {
        upd(item.id, { status: 'cancelled', message: 'Cancelled', progress: 0 });
        return null;
      }
      const msg = String(e.message || 'Burn failed');
      upd(item.id, { status: 'failed', message: msg.slice(0, 80) });
      setError(msg);
      notify('Burn failed', `${item.video.name}: ${msg.slice(0, 80)}`);
      return null;
    }
  }, [settingsForItem, upd, notify, saveBlobToDownloads, speak]);

  const processSingleItem = useCallback(async (item: QueueItem, signal: AbortSignal) => {
    if (!item.video.file) return;
    try {
      let itemToBurn = item;
      if (!item.captions?.length || item.status !== 'transcribed') {
        const transcribed = await transcribeItem(item, signal);
        if (!transcribed || !transcribed.captions?.length) return;
        itemToBurn = transcribed;
      }
      const reviewLanguages = new Set(['Hindi', 'Telugu', 'Tamil', 'Kannada', 'Malayalam', 'Urdu', 'Arabic']);
      const resolvedDetectedLanguage = String(itemToBurn.detectedLang || itemToBurn.language || '');
      if (reviewLanguages.has(resolvedDetectedLanguage)) {
        upd(item.id, {
          status: 'transcribed',
          message: `${resolvedDetectedLanguage} captions ready · Quality review required before Export Video.`,
          progress: 100,
        });
        setAutoBurn(false);
        notify('Caption review required', `${item.video.name}: verify the ${resolvedDetectedLanguage} words before export`);
        return;
      }
      if (!autoBurn) {
        upd(item.id, {
          status: 'transcribed',
          message: 'Captions ready · Auto Burn is off. Review them, then click Export Video.',
          progress: 100,
        });
        notify('Captions ready', `${item.video.name}: review captions, then click Export Video`);
        return;
      }
      upd(item.id, { status: 'exporting', message: `Captions ready. Exporting at ${QUEUE_EXPORT_FONT_SIZE}px...`, progress: 2 });
      await burnItem(itemToBurn, { autoDownload: true, phaseName: 'Start queue', signal, fontSize: QUEUE_EXPORT_FONT_SIZE });
    } catch (e) {
      console.error(`[CaptionBurner] Failed to process ${item.video.name}:`, e);
    }
  }, [transcribeItem, burnItem, autoBurn, upd, notify]);

  const runFullProcess = useCallback(async (item: QueueItem) => {
    if (!item.video.file) return;
    if (abortControllersRef.current[item.id]) return; // already running

    const controller = new AbortController();
    abortControllersRef.current[item.id] = controller;
    setProc(true);
    try {
      await processSingleItem(item, controller.signal);
    } finally {
      delete abortControllersRef.current[item.id];
      setProc(Object.keys(abortControllersRef.current).length > 0);
    }
  }, [processSingleItem]);

  useEffect(() => {
    const receiveCaptionImport = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const files = Array.isArray(detail.files) ? detail.files : [];
      const language = CAPTION_LANGUAGES.includes(detail.language) ? detail.language as Language : 'English';
      if (!files.length) return;
      setS(s => ({ ...s, language }));
      addFiles(files, { language, autoStart: detail.autoStart !== false });
    };

    window.addEventListener('presentator-caption-import', receiveCaptionImport as EventListener);
    const pending = (window as any).__presentatorPendingCaptionImport;
    if (pending) {
      delete (window as any).__presentatorPendingCaptionImport;
      receiveCaptionImport(new CustomEvent('presentator-caption-import', { detail: pending }));
    }
    return () => window.removeEventListener('presentator-caption-import', receiveCaptionImport as EventListener);
  }, []);

  useEffect(() => {
    const id = pendingAutoStartIdRef.current;
    if (!id || processing) return;
    const item = queue.find(q => q.id === id);
    if (!item || item.status !== 'idle') return;
    pendingAutoStartIdRef.current = null;
    runFullProcess(item);
  }, [queue, processing, runFullProcess]);

  const orderQueueFrom = useCallback((items: QueueItem[], startId?: string) => {
    if (!items.length || !startId) return items;
    const startIndex = items.findIndex(item => item.id === startId);
    if (startIndex <= 0) return items;
    return [...items.slice(startIndex), ...items.slice(0, startIndex)];
  }, []);

  const runAllProcesses = useCallback(async (startId?: string) => {
    if (!queue.length) return;
    setProc(true);
    setBatch(true);

    const eligibleItems = orderQueueFrom(queue, startId).filter(item =>
      item.video.file &&
      item.status !== 'completed' &&
      item.status !== 'cancelled' &&
      item.status !== 'exporting' &&
      item.status !== 'transcribing' &&
      !abortControllersRef.current[item.id]
    );

    try {
      for (const item of eligibleItems) {
        setActiveId(item.id);
        const controller = new AbortController();
        abortControllersRef.current[item.id] = controller;
        try {
          await processSingleItem(item, controller.signal);
        } finally {
          delete abortControllersRef.current[item.id];
        }
      }
    } finally {
      setBatch(false);
      setProc(Object.keys(abortControllersRef.current).length > 0);
    }
  }, [queue, processSingleItem, orderQueueFrom]);

  const exportAllCaptions = useCallback(async (startId?: string) => {
    if (!queue.length) return;
    setProc(true);
    setBatch(true);

    const eligibleItems = orderQueueFrom(queue, startId).filter(item =>
      item.video.file &&
      item.captions?.length &&
      item.status !== 'cancelled' &&
      item.status !== 'exporting' &&
      item.status !== 'transcribing' &&
      !abortControllersRef.current[item.id]
    );

    try {
      for (const item of eligibleItems) {
        setActiveId(item.id);
        const controller = new AbortController();
        abortControllersRef.current[item.id] = controller;
        try {
          await burnItem(item, { autoDownload: true, phaseName: 'Export queue', signal: controller.signal, fontSize: QUEUE_EXPORT_FONT_SIZE });
        } finally {
          delete abortControllersRef.current[item.id];
        }
      }
    } finally {
      setBatch(false);
      setProc(Object.keys(abortControllersRef.current).length > 0);
    }
  }, [queue, burnItem, orderQueueFrom]);

  const reburnItem = useCallback(async (item: QueueItem) => {
    if (!item.video.file || !item.captions?.length) return;
    if (abortControllersRef.current[item.id]) return; // already running

    const controller = new AbortController();
    abortControllersRef.current[item.id] = controller;
    setProc(true);
    try {
      await burnItem(item, { autoDownload: true, phaseName: 'Re-burn start', signal: controller.signal, fontSize: QUEUE_EXPORT_FONT_SIZE });
    } finally {
      delete abortControllersRef.current[item.id];
      setProc(Object.keys(abortControllersRef.current).length > 0);
    }
  }, [burnItem]);

  const handleEraseCaptions = useCallback(async () => {
    if (!activeItem || !activeItem.video.file || erasing) return;
    const api = electronApi();
    const filePath = api?.getPathForFile ? api.getPathForFile(activeItem.video.file) : null;
    if (!filePath) {
      setError('Could not get video file path. Make sure you are running inside the desktop app.');
      return;
    }
    
    setErasing(true);
    setError(null);
    upd(activeItem.id, { status: 'exporting', message: 'Erasing bottom captions...', progress: 40 });
    
    try {
      const res = await api.eraseCaptions({ filePath });
      if (!res || !res.ok) {
        throw new Error(res ? res.error : 'Caption erasing failed.');
      }
      
      upd(activeItem.id, {
        status: 'completed',
        outputPath: res.outputPath,
        outputFileName: res.fileName,
        outputUrl: URL.createObjectURL(new Blob([])), // placeholder to satisfy completed state check
        message: 'Captions erased successfully!',
        progress: 100
      });
      
      setBurnedVideoUrl('file:///' + res.outputPath.replace(/\\/g, '/'));
      
      if (api?.showNotification) {
        api.showNotification('Captions Erased!', 'Your clean video is ready in Downloads.');
      }
      
    } catch (err: any) {
      setError(err.message);
      upd(activeItem.id, { status: 'failed', message: 'Erasing failed: ' + err.message, progress: 0 });
    } finally {
      setErasing(false);
    }
  }, [activeItem, erasing, upd]);

  // Batch runner: process the whole queue with limited concurrency so large
  // videos do not launch too many Whisper/FFmpeg jobs at once.

  const activeCap = useMemo(() => {
    if (!activeItem?.captions) return null;
    const t = Math.max(0, curTime - S.offset);
    // Show caption for the full caption duration — don't hide during inter-word gaps
    return activeItem.captions.find(c => t >= c.start && t <= c.end) ?? null;
  }, [activeItem, curTime, S.offset]);

  // Demo caption shown when video is loaded but not yet transcribed — lets user
  // adjust font/color/position/style before running transcription.
  const DEMO_CAP: CaptionItem = useMemo(() => ({
    start: 0, end: 999999,
    text: 'Sample Caption Text',
    words: [
      { start: 0, end: 999999/3,   text: 'Sample'  },
      { start: 999999/3, end: 999999*2/3, text: 'Caption' },
      { start: 999999*2/3, end: 999999,  text: 'Text'    },
    ],
  }), []);

  const previewCap = useMemo<CaptionItem | null>(() => {
    if (!videoUrl) return null;
    // Show real caption if available, otherwise show demo for style preview
    return activeCap ?? (activeItem && !activeItem.captions?.length ? DEMO_CAP : null);
  }, [activeCap, videoUrl, activeItem, DEMO_CAP]);

  const getWords = (cap: CaptionItem): WordItem[] => {
    if (cap.words?.length) return cap.words;
    const ws = cap.text.trim().split(/\s+/);
    return ws.map((text, i) => ({
      text,
      start: cap.start + (i / ws.length) * (cap.end - cap.start),
      end: cap.start + ((i + 1) / ws.length) * (cap.end - cap.start),
    }));
  };

  const saveCaptionText = (capIndex: number) => {
    if (!activeId || !activeItem?.captions) return;
    const cleanText = editingCapText.replace(/\s+/g, ' ').trim();
    if (!cleanText) {
      setError('Caption text cannot be empty. Use Delete if you want to remove this caption.');
      return;
    }
    const updatedCaps = [...activeItem.captions];
    const current = updatedCaps[capIndex];
    const tokens = cleanText.split(/\s+/).filter(Boolean);
    const existingWords = current.words?.filter(word => Number.isFinite(word.start) && Number.isFinite(word.end)) || [];
    const captionStart = existingWords.length ? existingWords[0].start : current.start;
    const captionEnd = existingWords.length ? existingWords[existingWords.length - 1].end : current.end;
    const safeDuration = Math.max(0.05, captionEnd - captionStart);
    const editedWords = tokens.map((text, index) => {
      if (existingWords.length === tokens.length) {
        return { ...existingWords[index], text };
      }
      return {
        text,
        start: captionStart + (index / tokens.length) * safeDuration,
        end: captionStart + ((index + 1) / tokens.length) * safeDuration,
      };
    });
    updatedCaps[capIndex] = {
      ...current,
      text: cleanText,
      words: editedWords,
    };
    upd(activeId, {
      captions: updatedCaps,
      status: 'transcribed',
      message: 'Edit saved with original timing · ready to burn',
      progress: 0,
      outputUrl: undefined,
      outputPath: undefined,
      outputFileName: undefined,
    });
    setBurnedVideoUrl(null);
    setError(null);
    setEditingCapIndex(null);
  };

  const downloadZip = async () => {
    const done = queue.filter(i => i.status === 'completed' && i.outputUrl);
    if (!done.length) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      await Promise.all(done.map(async i => {
        const fileData = await fetch(i.outputUrl!).then(r => r.arrayBuffer());
        zip.file(i.video.name || 'video.mp4', fileData);
      }));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const saved = await saveBlobToDownloads(zipBlob, `captioned_videos_${Date.now()}.zip`);
      notify('Zip complete', saved.filePath ? `Saved ${saved.fileName} to Downloads` : 'Zip download started');
    } finally {
      setZipping(false);
    }
  };

  const completedCount = queue.filter(i => i.status === 'completed').length;
  const workingCount   = queue.filter(i => i.status === 'transcribing' || i.status === 'exporting').length;
  const failedCount    = queue.filter(i => i.status === 'failed').length;
  const cancelledCount = queue.filter(i => i.status === 'cancelled').length;
  const remainingCount = Math.max(0, queue.length - completedCount - cancelledCount);
  const currentWorkingItem = (activeItem && (activeItem.status === 'exporting' || activeItem.status === 'transcribing'))
    ? activeItem
    : queue.find(i => i.status === 'exporting' || i.status === 'transcribing');
  const isAllDone      = queue.length > 0 && queue.every(i => i.status === 'completed');
  const currentWorkingIndex = currentWorkingItem ? queue.findIndex(i => i.id === currentWorkingItem.id) : -1;
  const currentItemPct = Math.max(0, Math.min(100, Math.round(currentWorkingItem?.progress || 0)));
  const queueProgressPct = queue.length
    ? Math.min(100, Math.round(((completedCount + (currentWorkingItem ? currentItemPct / 100 : 0)) / queue.length) * 100))
    : 0;
  const queuePhaseLabel = currentWorkingItem
    ? currentWorkingItem.status === 'exporting' ? 'Exporting captions' : 'Generating captions'
    : isAllDone ? 'Queue complete'
    : queue.length ? 'Queue ready'
    : 'No videos loaded';
  const queuePhaseDetail = currentWorkingItem
    ? currentWorkingItem.message || (currentWorkingItem.status === 'exporting' ? `Burning at ${QUEUE_EXPORT_FONT_SIZE}px` : 'Transcribing speech')
    : isAllDone ? 'All captioned videos are saved.'
    : queue.length ? 'Click Start Queue to begin.'
    : 'Add videos to begin.';

  const currentWizardStep = useMemo(() => {
    if (queue.length === 0) return 1;
    const hasActiveTranscribing = queue.some(i => i.status === 'transcribing' || i.status === 'exporting');
    const hasTranscribed = queue.some(i => i.status === 'transcribed');
    const hasCompleted = queue.some(i => i.status === 'completed');
    if (hasActiveTranscribing) return 2;
    if (hasCompleted) return 4;
    if (hasTranscribed || activeItem?.captions) return 3;
    return 2;
  }, [queue, activeItem]);

  const togglePlay = () => {
    if (vidRef.current) {
      if (vidRef.current.paused) {
        vidRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else {
        vidRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const handleScrub = (val: number) => {
    if (vidRef.current) {
      vidRef.current.currentTime = val;
      setCurTime(val);
    }
  };

  const skipPreview = (seconds: number) => {
    if (!vidRef.current) return;
    const next = Math.max(0, Math.min(duration || vidRef.current.duration || 0, vidRef.current.currentTime + seconds));
    vidRef.current.currentTime = next;
    setCurTime(next);
  };

  const toggleSection = (key: string) => setOpenSection(s => s === key ? null : key);

  const openSavedOutput = async () => {
    if (!activeItem) return;
    const api = electronApi();
    if (activeItem.outputPath && api?.showItemInFolder) {
      api.showItemInFolder(activeItem.outputPath);
      return;
    }
    if (activeItem.outputUrl) {
      const blob = await fetch(activeItem.outputUrl).then(r => r.blob());
      const saved = await saveBlobToDownloads(blob, activeItem.outputFileName || activeItem.video.name || 'video.mp4');
      notify('Download complete', saved.filePath ? `Saved ${saved.fileName} to Downloads` : 'Download started');
    }
  };

  // Active item derived action state
  const isWorking     = activeItem && (activeItem.status === 'transcribing' || activeItem.status === 'exporting');
  const canStart      = !!activeItem && !!activeItem.video.file && !isWorking;
  const canBurn       = activeItem && activeItem.captions?.length;
  const canDownload   = activeItem && activeItem.status === 'completed' && activeItem.outputUrl;
  const captionReadyCount = queue.filter(i => i.video.file && i.captions?.length && i.status !== 'cancelled').length;
  const queueRunnableCount = queue.filter(i =>
    i.video.file &&
    i.status !== 'completed' &&
    i.status !== 'cancelled' &&
    i.status !== 'exporting' &&
    i.status !== 'transcribing'
  ).length;
  const needsTranscribeCount = queue.filter(i =>
    i.video.file &&
    i.status !== 'completed' &&
    i.status !== 'cancelled' &&
    i.status !== 'exporting' &&
    i.status !== 'transcribing' &&
    (!i.captions?.length || i.status !== 'transcribed')
  ).length;

  const panel = {
    background: 'linear-gradient(135deg, rgba(12,18,34,0.92), rgba(8,12,24,0.96))',
    border: '1px solid rgba(125,145,255,0.14)',
    boxShadow: '0 18px 48px rgba(0,0,0,0.38)',
  };

  return (
    <div
      className="cb-page flex flex-col h-screen w-screen overflow-hidden font-sans select-none antialiased"
      style={{ background: 'radial-gradient(circle at 50% -10%, rgba(99,102,241,0.28), transparent 36%), linear-gradient(135deg, #020617 0%, #08111f 45%, #040713 100%)' }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={e => {
          addFiles(Array.from(e.target.files ?? []));
          e.currentTarget.value = '';
        }}
      />

      {currentWorkingItem && (
        <button
          type="button"
          className="cb-global-cancel"
          onClick={cancelCurrentVideo}
          title="Stop the active caption process"
        >
          <span aria-hidden="true">■</span>
          Stop {currentWorkingItem.status === 'exporting' ? 'Burning' : 'Transcription'}
        </button>
      )}

      <header
        className="flex items-center justify-between shrink-0"
        style={{ height: 64, padding: '0 24px', borderBottom: '1px solid rgba(125,145,255,0.12)', background: 'rgba(2,6,23,0.68)', backdropFilter: 'blur(18px)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[13px] font-black text-white shrink-0"
            style={{ background: 'linear-gradient(135deg,#10b981,#38bdf8,#7c3aed)', boxShadow: '0 8px 30px rgba(56,189,248,0.22)' }}
          >
            CC
          </div>
          <div>
            <p className="text-[13px] font-black text-white leading-none">Caption Burner</p>
            <p className="text-[9px] text-indigo-400/70 font-bold uppercase mt-1">Local Whisper + Google Translate</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(['Import', 'Transcribe', 'Style', 'Export'] as const).map((label, idx) => {
            const step = idx + 1;
            const active = currentWizardStep === step;
            const done = currentWizardStep > step;
            return (
              <div
                key={label}
                className="flex items-center gap-1.5 rounded-full"
                style={{
                  padding: '7px 11px',
                  background: active ? 'rgba(99,102,241,0.16)' : done ? 'rgba(16,185,129,0.09)' : 'rgba(15,23,42,0.55)',
                  border: `1px solid ${active ? 'rgba(129,140,248,0.35)' : 'rgba(255,255,255,0.06)'}`,
                  color: active ? '#ffffff' : done ? '#86efac' : '#64748b',
                  fontWeight: 800,
                  fontSize: 11,
                }}
              >
                <span>{done ? '✓' : step}</span>
                <span>{label}</span>
              </div>
            );
          })}
        </div>

        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-white transition-all text-sm font-bold"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          ✕
        </button>
      </header>

      <section
        className="shrink-0"
        style={{
          padding: '10px 24px',
          background: currentWorkingItem
            ? currentWorkingItem.status === 'exporting'
              ? 'linear-gradient(90deg, rgba(245,158,11,0.18), rgba(99,102,241,0.12))'
              : 'linear-gradient(90deg, rgba(14,165,233,0.18), rgba(99,102,241,0.12))'
            : 'rgba(2,6,23,0.62)',
          borderBottom: '1px solid rgba(125,145,255,0.12)',
          boxShadow: currentWorkingItem ? '0 12px 30px rgba(2,6,23,0.28)' : 'none',
        }}
      >
        <div className="flex items-center gap-4">
          <div className="min-w-0" style={{ width: 260 }}>
            <p className="text-[9px] font-black uppercase tracking-wider leading-none" style={{ color: currentWorkingItem?.status === 'exporting' ? '#fcd34d' : '#7dd3fc' }}>
              Status
            </p>
            <p className="text-[12px] font-black text-white leading-none mt-1 truncate">{queuePhaseLabel}</p>
            <p className="text-[9px] font-bold text-slate-300 mt-1 truncate">{queuePhaseDetail}</p>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[9px] font-bold text-slate-300 truncate">
                {currentWorkingItem ? currentWorkingItem.video.name : queue.length ? `${remainingCount} remaining` : 'Add videos to begin'}
              </span>
              <span className="text-[11px] font-black text-white shrink-0">
                {currentWorkingItem ? `${currentItemPct}% current` : `${queueProgressPct}% queue`}
              </span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden mt-2" style={{ background: 'rgba(255,255,255,0.10)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${currentWorkingItem ? currentItemPct : queueProgressPct}%`,
                  background: currentWorkingItem?.status === 'exporting'
                    ? 'linear-gradient(90deg,#f59e0b,#facc15,#a78bfa)'
                    : 'linear-gradient(90deg,#38bdf8,#818cf8,#22d3ee)',
                }}
              />
            </div>
          </div>
          <div style={{ width: 180 }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-black text-slate-300">Queue</span>
              <span className="text-[9px] font-black text-white">{queueProgressPct}%</span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden mt-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${queueProgressPct}%`, background: 'linear-gradient(90deg,#10b981,#38bdf8,#6366f1)' }}
              />
            </div>
          </div>
        </div>
      </section>

      <main
        className="flex flex-col flex-1 min-h-0"
        style={{
          padding: 18,
          paddingBottom: videoUrl ? 120 : 18,
          gap: 16,
          height: 'calc(100vh - 126px)',
          overflowY: videoUrl ? 'auto' : 'hidden',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
        }}
      >
        <section
          className="flex flex-col items-center justify-center"
          style={{
            ...panel,
            borderRadius: 22,
            padding: 18,
            minHeight: videoUrl ? 'clamp(520px, 66vh, 720px)' : 'clamp(330px, 50vh, 580px)',
            overflow: 'hidden',
          }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); }}
        >
          {videoUrl ? (
            <div className="flex flex-col gap-3 w-full min-h-0" style={{ maxWidth: 980 }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-black text-white leading-none">
                    {burnedVideoUrl ? '🎬 Burned Output' : 'Upload preview'}
                  </p>
                  <p className="text-[9px] text-slate-500 mt-1">
                    {burnedVideoUrl
                      ? 'Your captioned video — play, download, or open in folder.'
                      : 'Caption options update live on this video.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {burnedVideoUrl && (
                    <button
                      onClick={() => setBurnedVideoUrl(null)}
                      className="text-[9px] font-bold rounded-full transition-all"
                      style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.07)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)' }}
                      title="Switch back to original upload preview"
                    >
                      ← Original
                    </button>
                  )}
                  <span
                    className="text-[9px] font-bold uppercase rounded-full"
                    style={{ padding: '7px 12px', color: burnedVideoUrl ? '#86efac' : '#bae6fd', background: burnedVideoUrl ? 'rgba(16,185,129,0.13)' : 'rgba(14,165,233,0.13)', border: `1px solid ${burnedVideoUrl ? 'rgba(16,185,129,0.28)' : 'rgba(14,165,233,0.28)'}` }}
                  >
                    {burnedVideoUrl ? '✓ Export Done' : 'Live Review'}
                  </span>
                </div>
              </div>
              <div className="relative w-full mx-auto min-h-0" style={{ aspectRatio, width: 'min(1120px, 100%)', maxHeight: 'min(560px, calc(100vh - 240px))' }}>
                <div className="absolute inset-0 rounded-2xl" style={{ boxShadow: '0 0 70px rgba(56,189,248,0.12)', filter: 'blur(16px)', background: 'rgba(56,189,248,0.06)' }} />
                <div className="relative rounded-2xl overflow-hidden bg-black w-full h-full" style={{ border: '1px solid rgba(148,163,184,0.16)', boxShadow: '0 22px 70px rgba(0,0,0,0.72)', containerType: 'size' }}>
                  <video
                    ref={vidRef}
                    src={burnedVideoUrl || videoUrl || ''}
                    className="w-full h-full object-contain"
                    onTimeUpdate={() => setCurTime(vidRef.current?.currentTime ?? 0)}
                    onLoadedMetadata={e => {
                      setDuration(e.currentTarget.duration);
                      const w = e.currentTarget.videoWidth;
                      const h = e.currentTarget.videoHeight;
                      if (w && h) {
                        setAspectRatio(`${w}/${h}`);
                        if (activeItem) {
                          upd(activeItem.id, {
                            video: {
                              ...activeItem.video,
                              width: w,
                              height: h,
                              duration: e.currentTarget.duration,
                            },
                          });
                        }
                      }
                    }}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onClick={togglePlay}
                  />
                  {previewCap && (
                    <div
                      className="absolute pointer-events-none z-50 text-center"
                      style={{
                        left: `${S.xPos}%`,
                        bottom: S.position === 'bottom' ? previewBottomOffset : undefined,
                        top: S.position === 'bottom' ? undefined : `${S.yPos}%`,
                        transform: S.position === 'bottom' ? 'translateX(-50%)' : 'translate(-50%, -50%)',
                        width: '85%',
                      }}
                    >
                      {/* DEMO badge — only shown before transcription */}
                      {!activeItem?.captions?.length && (
                        <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'center' }}>
                          <span style={{
                            fontSize: 9, fontWeight: 900, letterSpacing: '0.12em',
                            padding: '3px 10px', borderRadius: 999,
                            background: 'rgba(251,191,36,0.18)', color: '#fbbf24',
                            border: '1px solid rgba(251,191,36,0.4)',
                          }}>✦ STYLE PREVIEW</span>
                        </div>
                      )}
                      <div
                        className={`px-0 py-0 font-black flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 mx-auto w-fit leading-tight max-w-full ${S.style === 'pill' ? 'backdrop-blur-sm px-5 py-2.5' : ''}`}
                        style={{
                          fontSize: previewFontSize,
                          color: S.style === 'white-yellow' ? '#ffffff' : sc(S.fontColor),
                          borderRadius: S.style === 'pill' ? '9999px' : '10px',
                          background: S.style === 'pill' ? sc(S.bgColor) : 'transparent',
                          textShadow: S.style === 'white-yellow'
                            ? 'none'
                            : S.style === 'outline'
                            ? '0 0 1px #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,2px 2px 0 #000'
                            : S.style === 'minimal'
                            ? '0 2px 6px rgba(0,0,0,0.8)'
                            : 'none',
                        }}
                      >
                        {(() => {
                          const allWords = getWords(previewCap);
                          const t = Math.max(0, curTime - S.offset);
                          let activeIndex = allWords.findIndex(w => t >= w.start && t <= w.end);
                          if (activeIndex < 0) {
                            activeIndex = allWords.findIndex((w, index) => {
                              const next = allWords[index + 1];
                              return t >= w.end
                                && t < w.end + SHORT_CAPTION_GAP_SECONDS
                                && (!next || t < next.start);
                            });
                          }
                          // Reveal only the current phrase as it is narrated.
                          // Completed words remain highlighted so short words do
                          // not lose their karaoke state between video frames.
                          const safeIndex = activeIndex >= 0 ? activeIndex : 0;
                          const groupStart = Math.floor(safeIndex / CAPTION_WORD_LIMIT) * CAPTION_WORD_LIMIT;
                          // Match exported captions: reveal the current phrase
                          // progressively and never preview words from the future.
                          const wordsToShow = allWords.slice(groupStart, Math.max(groupStart + 1, safeIndex + 1));
                          return wordsToShow.map((w, i) => {
                            const lit = i <= safeIndex - groupStart;
                            return (
                              <span
                                key={i}
                                className="inline-block transition-all duration-100"
                                style={{
                                  color: lit ? (S.style === 'white-yellow' ? '#facc15' : S.highlightColor) : 'inherit',
                                  fontWeight: S.style === 'white-yellow' ? 900 : (lit ? 900 : 700),
                                  transform: lit ? 'scale(1.06)' : 'scale(1)',
                                  textShadow: lit && S.style !== 'white-yellow' ? `0 0 20px ${S.highlightColor}60` : 'inherit',
                                }}
                              >
                                {w.text}
                              </span>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                  {!isPlaying && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer" onClick={togglePlay}>
                      <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(14,165,233,0.65)', backdropFilter: 'blur(10px)' }}>
                        <IconPlay />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div
                className="flex items-center gap-2 w-full"
                style={{ padding: '9px 10px', borderRadius: 12, background: 'rgba(2,6,23,0.82)', border: '1px solid rgba(148,163,184,0.14)' }}
              >
                <button
                  type="button"
                  onClick={() => skipPreview(-5)}
                  className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-slate-200 hover:text-white transition-colors"
                  style={{ background: 'rgba(255,255,255,0.07)' }}
                  title="Back 5 seconds"
                >
                  <IconRewind />
                </button>
                <button
                  type="button"
                  onClick={togglePlay}
                  className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-white"
                  style={{ background: 'linear-gradient(135deg,#0ea5e9,#6366f1)' }}
                  title={isPlaying ? 'Pause preview' : 'Play preview'}
                >
                  {isPlaying ? <IconPause /> : <IconPlay />}
                </button>
                <span className="text-[9px] font-mono text-slate-400 w-12 text-right shrink-0">{fmt(curTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration, 0.01)}
                  step={0.05}
                  value={Math.min(curTime, Math.max(duration, 0.01))}
                  onChange={e => handleScrub(Number(e.target.value))}
                  className="flex-1 min-w-0 cursor-pointer"
                  aria-label="Caption preview position"
                />
                <span className="text-[9px] font-mono text-slate-400 w-12 shrink-0">{fmt(duration)}</span>
                <button
                  type="button"
                  onClick={() => skipPreview(5)}
                  className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-slate-200 hover:text-white transition-colors"
                  style={{ background: 'rgba(255,255,255,0.07)' }}
                  title="Forward 5 seconds"
                >
                  <IconForward />
                </button>
              </div>

              {/* ── Burned-output action bar: shown when a completed video is on canvas ── */}
              {burnedVideoUrl && activeItem?.status === 'completed' && (
                <div
                  className="flex items-center gap-2 w-full"
                  style={{ padding: '10px 14px', borderRadius: 14, background: 'linear-gradient(135deg,rgba(16,185,129,0.12),rgba(5,150,105,0.08))', border: '1px solid rgba(16,185,129,0.28)' }}
                >
                  <span className="text-[9px] font-black text-emerald-300 shrink-0">✓ Ready</span>
                  <span className="text-[9px] text-slate-400 truncate flex-1">{activeItem.outputFileName || activeItem.video.name || 'video.mp4'}</span>
                  {/* Play in OS media player */}
                  <button
                    onClick={() => {
                      const api = electronApi();
                      if (activeItem.outputPath && api?.openFile) {
                        api.openFile(activeItem.outputPath);
                      } else if (burnedVideoUrl) {
                        window.open(burnedVideoUrl, '_blank');
                      }
                    }}
                    className="flex items-center gap-1.5 rounded-xl text-[9px] font-bold text-white transition-all shrink-0"
                    style={{ padding: '7px 14px', background: 'linear-gradient(135deg,#0ea5e9,#6366f1)', boxShadow: '0 4px 14px rgba(14,165,233,0.25)' }}
                  >
                    ▶ Play in Player
                  </button>
                  {/* Open folder in Explorer */}
                  <button
                    onClick={() => {
                      const api = electronApi();
                      if (activeItem.outputPath && api?.showItemInFolder) {
                        api.showItemInFolder(activeItem.outputPath);
                      }
                    }}
                    className="flex items-center gap-1.5 rounded-xl text-[9px] font-bold text-emerald-300 transition-all shrink-0"
                    style={{ padding: '7px 14px', background: 'rgba(16,185,129,0.14)', border: '1px solid rgba(16,185,129,0.32)' }}
                  >
                    📁 Open Folder
                  </button>
                  {/* Direct download link */}
                  {activeItem.outputUrl && (
                    <a
                      href={activeItem.outputUrl}
                      download={activeItem.outputFileName || activeItem.video.name || 'video.mp4'}
                      className="flex items-center gap-1.5 rounded-xl text-[9px] font-bold text-indigo-300 transition-all shrink-0 no-underline"
                      style={{ padding: '7px 14px', background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.30)' }}
                    >
                      ⬇ Download
                    </a>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center gap-4 rounded-3xl cursor-pointer transition-all text-center"
              style={{ width: 'min(760px, 92%)', minHeight: 290, padding: 28, border: '2px dashed rgba(56,189,248,0.38)', background: 'linear-gradient(135deg, rgba(14,165,233,0.12), rgba(124,58,237,0.10))', boxShadow: 'inset 0 0 80px rgba(56,189,248,0.05)' }}
            >
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl" style={{ background: 'linear-gradient(135deg,#0ea5e9,#8b5cf6)', boxShadow: '0 18px 44px rgba(14,165,233,0.25)' }}>
                🎬
              </div>
              <div>
                <p className="text-[13px] font-black text-white">Upload video file</p>
                <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">Drop MP4/WebM here or click to browse. This is the main review screen.</p>
              </div>
              <span className="px-5 py-2 rounded-xl text-[10px] font-bold uppercase text-white" style={{ background: 'linear-gradient(135deg,#0ea5e9,#6366f1)' }}>
                Select Video
              </span>
            </button>
          )}
        </section>

        <section className="flex flex-1 min-h-0 gap-4" style={videoUrl ? { minHeight: 620, overflow: 'visible' } : undefined}>
          <aside className="flex flex-col" style={{ ...panel, width: '34%', minWidth: 340, borderRadius: 18, overflow: 'hidden' }}>
            <div className="flex items-center justify-between" style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div>
                <p className="text-[11px] font-black text-white leading-none">Videos and captions</p>
                <p className="text-[9px] text-slate-500 mt-1">{queue.length} video{queue.length === 1 ? '' : 's'} loaded</p>
              </div>
              <div className="flex items-center gap-1.5">
                {completedCount > 0 && (
                  <button onClick={downloadZip} disabled={isZipping} className="px-2 py-1 rounded-lg text-[8px] font-bold text-emerald-400 hover:text-emerald-300 transition-all" style={{ background: 'rgba(16,185,129,0.10)' }}>
                    <IconZip /> {isZipping ? 'Zipping' : 'Zip'}
                  </button>
                )}
                <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 rounded-lg text-[9px] font-bold text-white transition-all" style={{ background: 'linear-gradient(135deg,#0ea5e9,#6366f1)' }}>
                  <IconPlus /> Add
                </button>
                {queue.length > 0 && (
                  <button onClick={clearAll} disabled={!!currentWorkingItem} className="px-3 py-1.5 rounded-lg text-[9px] font-bold text-rose-200 transition-all disabled:opacity-40" style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.24)' }}>
                    Clear All
                  </button>
                )}
              </div>
            </div>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(2,6,23,0.28)' }}>
              {(batchOn || currentWorkingItem) && (
                <div
                  className="rounded-xl mb-3"
                  style={{
                    padding: 12,
                    background: currentWorkingItem?.status === 'exporting'
                      ? 'linear-gradient(135deg,rgba(245,158,11,0.18),rgba(124,58,237,0.12))'
                      : 'linear-gradient(135deg,rgba(14,165,233,0.18),rgba(99,102,241,0.12))',
                    border: currentWorkingItem?.status === 'exporting'
                      ? '1px solid rgba(245,158,11,0.30)'
                      : '1px solid rgba(14,165,233,0.30)',
                    boxShadow: '0 12px 28px rgba(2,6,23,0.32)',
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin shrink-0"
                        style={{ borderColor: currentWorkingItem?.status === 'exporting' ? '#fcd34d' : '#7dd3fc', borderTopColor: 'transparent' }}
                      />
                      <div className="min-w-0">
                        <p className="text-[8px] font-black uppercase tracking-wider leading-none" style={{ color: currentWorkingItem?.status === 'exporting' ? '#fcd34d' : '#7dd3fc' }}>
                          Active now
                        </p>
                        <p className="text-[10px] font-black text-white leading-none">{queuePhaseLabel}</p>
                        <p className="text-[8px] font-bold text-slate-300 truncate mt-1">
                          {currentWorkingItem
                            ? `${currentWorkingIndex + 1}/${queue.length} · ${currentWorkingItem.video.name}`
                            : 'Preparing next video...'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-black text-white leading-none">{currentItemPct}%</p>
                      <p className="text-[8px] font-bold text-slate-400 mt-1">current video</p>
                    </div>
                  </div>
                  <p className="text-[8px] font-bold text-slate-300 truncate mt-2">{queuePhaseDetail}</p>
                  <div className="w-full h-2 rounded-full overflow-hidden mt-2" style={{ background: 'rgba(255,255,255,0.10)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${currentItemPct}%`,
                        background: currentWorkingItem?.status === 'exporting'
                          ? 'linear-gradient(90deg,#f59e0b,#facc15,#a78bfa)'
                          : 'linear-gradient(90deg,#38bdf8,#818cf8,#22d3ee)',
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-black text-white">{queueProgressPct}% queue progress</span>
                <span className="text-[8px] font-bold text-slate-400">
                  Done {completedCount}/{queue.length} · Remaining {remainingCount}/{queue.length} · Working {workingCount}{failedCount ? ` · Failed ${failedCount}` : ''}{cancelledCount ? ` · Cancelled ${cancelledCount}` : ''}
                </span>
              </div>
              <div className="w-full h-2 rounded-full overflow-hidden mt-2" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${queueProgressPct}%`, background: 'linear-gradient(90deg,#10b981,#38bdf8,#6366f1)' }}
                />
              </div>
              {currentWorkingItem && (
                <div className="mt-2 rounded-xl" style={{ padding: 9, background: 'rgba(15,23,42,0.58)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[8px] font-bold text-slate-300 truncate">
                      {currentWorkingItem.status === 'exporting' ? 'Burning' : 'Transcribing'} · {currentWorkingItem.video.name}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[9px] font-black text-white">
                        {Math.round(currentWorkingItem.progress || 0)}% · Rem {Math.max(0, 100 - Math.round(currentWorkingItem.progress || 0))}%
                      </span>
                      <button
                        onClick={cancelCurrentVideo}
                        className="w-6 h-6 rounded-lg text-[10px] font-black text-rose-300 hover:text-white transition-all"
                        style={{ background: 'rgba(244,63,94,0.14)', border: '1px solid rgba(244,63,94,0.24)' }}
                        title="Cancel current video"
                      >
                        X
                      </button>
                    </div>
                  </div>
                  <div className="w-full h-1.5 rounded-full overflow-hidden mt-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(0, Math.min(100, currentWorkingItem.progress || 0))}%`,
                        background: currentWorkingItem.status === 'exporting'
                          ? 'linear-gradient(90deg,#f59e0b,#a78bfa)'
                          : 'linear-gradient(90deg,#38bdf8,#6366f1)',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="flex min-h-0 flex-1" style={{ height: 'clamp(320px, 52vh, 560px)', maxHeight: '560px', overflow: 'hidden' }}>
              <div className="flex flex-col gap-2 overflow-y-auto min-h-0" style={{ width: '45%', padding: 12, borderRight: '1px solid rgba(255,255,255,0.06)', overscrollBehavior: 'contain', scrollbarGutter: 'stable' }}>
                {queue.length ? queue.map(item => {
                  const isActive = item.id === activeId;
                  const cfg = statusConfig[item.status as keyof typeof statusConfig] || statusConfig.idle;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setActiveId(item.id)}
                      className="text-left rounded-xl transition-all"
                      style={{ padding: 10, background: isActive ? 'rgba(14,165,233,0.14)' : 'rgba(15,23,42,0.48)', border: `1px solid ${isActive ? 'rgba(14,165,233,0.34)' : 'rgba(255,255,255,0.05)'}` }}
                    >
                      <p className="text-[9px] font-bold text-slate-200 truncate">{item.video.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                        <span className={`text-[8px] font-bold ${cfg.text}`}>{cfg.label}</span>
                        {(item.status === 'transcribing' || item.status === 'exporting') && (
                          <span className="text-[8px] font-black text-white">
                            {Math.round(item.progress || 0)}% · Rem {Math.max(0, 100 - Math.round(item.progress || 0))}%
                          </span>
                        )}
                        {(item.status === 'transcribing' || item.status === 'exporting') ? (
                          <button
                            onClick={e => { e.stopPropagation(); cancelVideoItem(item.id); }}
                            className="w-5 h-5 rounded text-[8px] font-black text-rose-300 hover:text-white transition-all"
                            style={{ marginLeft: 'auto', background: 'rgba(244,63,94,0.14)', border: '1px solid rgba(244,63,94,0.24)' }}
                            title="Cancel this video"
                          >X</button>
                        ) : (
                          <>
                            {item.captions?.length && (
                              <button
                                onClick={e => { e.stopPropagation(); setActiveId(item.id); reburnItem(item); }}
                                disabled={processing}
                                className="h-5 rounded px-2 text-[8px] font-black text-amber-200 hover:text-white transition-all disabled:opacity-40"
                                style={{ marginLeft: 'auto', background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.24)' }}
                                title="Export this video"
                              >Export</button>
                            )}
                            <button
                              onClick={e => { e.stopPropagation(); remove(item.id); }}
                              className="w-5 h-5 rounded text-[8px] font-black text-slate-400 hover:text-rose-400 transition-all"
                              style={{ marginLeft: item.captions?.length ? 0 : 'auto', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                              title="Remove video from list"
                            >X</button>
                          </>
                        )}
                      </div>
                      <select
                        value={item.language || S.language}
                        disabled={item.status === 'transcribing' || item.status === 'exporting' || processing}
                        onClick={e => e.stopPropagation()}
                        onChange={e => {
                          e.stopPropagation();
                          setItemLanguage(item.id, e.target.value as Language);
                        }}
                        className="w-full rounded-lg px-2 py-1 mt-2 text-[8px] text-white outline-none cursor-pointer"
                        style={{ background: 'rgba(2,6,23,0.72)', border: '1px solid rgba(255,255,255,0.08)' }}
                      >
                        {CAPTION_LANGUAGES.map(lang => (
                          <option key={lang} value={lang} className="bg-[#0f172a]">{lang}</option>
                        ))}
                      </select>
                      {(item.status === 'transcribing' || item.status === 'exporting') && (
                        <div className="w-full h-1.5 rounded-full overflow-hidden mt-2" style={{ background: 'rgba(255,255,255,0.07)' }}>
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.max(0, Math.min(100, item.progress || 0))}%`,
                              background: item.status === 'exporting'
                                ? 'linear-gradient(90deg,#f59e0b,#a78bfa)'
                                : 'linear-gradient(90deg,#38bdf8,#6366f1)',
                            }}
                          />
                        </div>
                      )}
                      <p className="text-[8px] text-slate-500 truncate mt-1">{item.message || `Language: ${item.language || S.language}`}</p>
                    </div>
                  );
                }) : (
                  <p className="text-[9px] text-slate-500 leading-relaxed">Uploaded videos will appear here.</p>
                )}
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0" style={{ padding: 12, overscrollBehavior: 'contain', scrollbarGutter: 'stable' }}>
                {activeItem?.captions?.length ? activeItem.captions.map((cap, i) => {
                  const t = Math.max(0, curTime - S.offset);
                  const active = t >= cap.start && t <= cap.end;
                  const isEditing = editingCapIndex === i;
                  return (
                    <div key={i} className="rounded-xl" style={{ padding: 10, background: active ? 'rgba(99,102,241,0.16)' : 'rgba(15,23,42,0.48)', border: `1px solid ${active ? 'rgba(129,140,248,0.35)' : 'rgba(255,255,255,0.05)'}` }}>
                      <div className="flex items-center justify-between gap-2">
                        <button className="text-[8px] font-mono text-indigo-300" onClick={() => { if (vidRef.current) { vidRef.current.currentTime = cap.start; vidRef.current.play().catch(() => {}); setIsPlaying(true); } }}>
                          {fmt(cap.start)}
                        </button>
                        <div className="flex items-center gap-2">
                          <button 
                            className="text-[8px] text-rose-400 hover:text-rose-300 transition-colors" 
                            onClick={() => {
                              const updatedCaps = [...activeItem.captions!];
                              updatedCaps.splice(i, 1);
                              upd(activeItem.id, { captions: updatedCaps });
                            }}
                          >
                            Delete
                          </button>
                          <button className="text-[8px] text-slate-500 hover:text-white transition-colors" onClick={() => { setEditingCapIndex(i); setEditingCapText(cap.text); }}>
                            Edit
                          </button>
                        </div>
                      </div>
                      {isEditing ? (
                        <div className="flex flex-col gap-1.5 mt-2">
                          <textarea value={editingCapText} onChange={e => setEditingCapText(e.target.value)} rows={2} className="w-full rounded-lg text-[10px] p-2 text-white outline-none resize-none" style={{ background: '#020617', border: '1px solid rgba(99,102,241,0.35)' }} />
                          <div className="flex justify-end gap-1.5">
                            <button onClick={() => setEditingCapIndex(null)} className="px-2 py-1 rounded-lg text-[8px] text-slate-300" style={{ background: 'rgba(255,255,255,0.06)' }}>Cancel</button>
                            <button onClick={() => saveCaptionText(i)} className="px-2 py-1 rounded-lg text-[8px] text-white" style={{ background: '#6366f1' }}>Save</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-200 leading-relaxed mt-1">{cap.text}</p>
                      )}
                    </div>
                  );
                }) : (
                  <div className="flex items-center justify-center h-full text-center">
                    <p className="text-[9px] text-slate-500 leading-relaxed">Editable caption lines will show here.</p>
                  </div>
                )}
                
                <button 
                  onClick={() => {
                    if (!activeItem) return;
                    const caps = activeItem.captions || [];
                    const start = caps.length ? caps[caps.length - 1].end + 0.1 : 0;
                    const newCap = { start, end: start + 3, text: 'New caption' };
                    upd(activeItem.id, { captions: [...caps, newCap] });
                    setEditingCapIndex(caps.length);
                    setEditingCapText('New caption');
                  }}
                  className="mt-2 w-full py-2 rounded-xl text-[9px] font-bold transition-colors"
                  style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px dashed rgba(99,102,241,0.3)' }}
                >
                  + Add Caption
                </button>
              </div>
            </div>
          </aside>

          <div className="flex flex-col flex-1 min-w-0" style={{ ...panel, borderRadius: 18, overflow: 'hidden', minHeight: 0 }}>
            <div className="flex items-center justify-between" style={{ padding: 14, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <div>
                <p className="text-[11px] font-black text-white leading-none">Caption options</p>
                <p className="text-[9px] text-slate-500 mt-1">Row-wise controls. Changes show on the upload preview above.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoBurn}
                  title={autoBurn ? 'Captions will burn automatically after transcription' : 'Caption burning waits for your manual Export Video click'}
                  onClick={() => setAutoBurn(current => {
                    const next = !current;
                    try { localStorage.setItem('caption-burner-auto-burn', String(next)); } catch {}
                    return next;
                  })}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-bold transition-all flex items-center gap-2"
                  style={{
                    color: autoBurn ? '#86efac' : '#cbd5e1',
                    background: autoBurn ? 'rgba(16,185,129,0.14)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${autoBurn ? 'rgba(16,185,129,0.32)' : 'rgba(255,255,255,0.10)'}`,
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="relative inline-flex items-center rounded-full"
                    style={{ width: 26, height: 14, padding: 2, background: autoBurn ? '#10b981' : '#475569' }}
                  >
                    <i
                      className="block rounded-full bg-white transition-transform"
                      style={{ width: 10, height: 10, transform: autoBurn ? 'translateX(12px)' : 'translateX(0)' }}
                    />
                  </span>
                  Auto Burn {autoBurn ? 'ON' : 'OFF'}
                </button>
                <button
                  disabled={queue.length === 0 || queueRunnableCount === 0 || processing}
                  onClick={() => runAllProcesses(activeId || undefined)}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-bold transition-all flex items-center gap-1.5"
                  style={{ color: batchOn ? '#fcd34d' : '#cbd5e1', background: batchOn ? 'rgba(245,158,11,0.14)' : 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {batchOn && (
                    <span className="inline-block w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#fcd34d', borderTopColor: 'transparent' }} />
                  )}
                  {batchOn
                    ? `Generating ${workingCount}/${queue.length}`
                    : queue.length === 1
                      ? 'Generate Captions'
                      : `Generate Captions (${queueRunnableCount})`}
                </button>
                <button
                  disabled={captionReadyCount === 0 || processing}
                  onClick={() => exportAllCaptions(activeId || undefined)}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-bold transition-all"
                  style={{ color: '#fcd34d', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.24)' }}
                >
                  Export All ({captionReadyCount})
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0" style={{ padding: 14, overscrollBehavior: 'contain', scrollbarGutter: 'stable' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(280px, 1fr))', gap: 12 }}>
                <OptionCard title="Style">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                    {(['pill', 'outline', 'minimal', 'white-yellow'] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => setS(s => p === 'white-yellow'
                          ? { ...s, style: p, fontColor: 'White', highlightColor: '#facc15', bgColor: 'Transparent' }
                          : { ...s, style: p })}
                        className="flex-1 rounded-xl text-left transition-all"
                        style={{ padding: 10, background: S.style === p ? 'rgba(14,165,233,0.15)' : 'rgba(15,23,42,0.45)', border: `1px solid ${S.style === p ? 'rgba(14,165,233,0.36)' : 'rgba(255,255,255,0.06)'}` }}
                      >
                        <p className="text-[9px] font-bold text-slate-200">{p === 'white-yellow' ? 'White + Yellow' : p}</p>
                        <div className="mt-2"><CaptionLookPreview settings={{ ...S, style: p }} compact /></div>
                      </button>
                    ))}
                  </div>
                </OptionCard>

                <OptionCard title="Text">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <SliderRow label="Font Scale" value={`${S.fontSize}px`} min={20} max={140} inputValue={S.fontSize} onChange={v => setS(s => ({ ...s, fontSize: v }))} />
                    <SelectRow label="Font Color" value={S.fontColor} options={['White', 'Yellow', 'Cyan', 'Black']} onChange={v => setS(s => ({ ...s, fontColor: v as any }))} />
                  </div>
                </OptionCard>

                <OptionCard title="Layout">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <SelectRow label="Backdrop" value={S.bgColor} options={['Black (70%)', 'White (20%)', 'Black', 'Transparent']} onChange={v => setS(s => ({ ...s, bgColor: v as any }))} />
                    <SliderRow label="Vertical Position" value={`${S.yPos}%`} min={5} max={95} inputValue={S.yPos} onChange={v => setS(s => ({ ...s, yPos: v, position: 'custom' }))} />
                  </div>
                </OptionCard>

                <OptionCard title="Karaoke timing">
                  <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr', gap: 12, alignItems: 'end' }}>
                    <div>
                      <span className="text-[8px] font-bold text-slate-500 uppercase">Highlight</span>
                      <input type="color" value={S.highlightColor} onChange={e => setS(s => ({ ...s, highlightColor: e.target.value }))} className="w-full h-9 rounded-lg cursor-pointer border-0 bg-transparent p-0 mt-1" />
                    </div>
                    <SliderRow label="Sync Offset" value={`${S.offset > 0 ? '+' : ''}${S.offset.toFixed(2)}s`} min={-2} max={2} step={0.05} inputValue={S.offset} onChange={v => setS(s => ({ ...s, offset: v }))} isFloat />
                    <SliderRow label="Words / Segment" value={`${S.maxWordsPerCaption}`} min={1} max={CAPTION_WORD_LIMIT} inputValue={S.maxWordsPerCaption} onChange={v => setS(s => ({ ...s, maxWordsPerCaption: v }))} />
                  </div>
                </OptionCard>

                <OptionCard title="AI">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
                    <SelectRow
                      label="Engine"
                      value={S.engine === 'auto' ? 'Auto (Local → Groq)' : S.engine === 'local' ? 'Local CPU (Slow)' : 'Groq API (Fast)'}
                      options={['Auto (Local → Groq)', 'Local CPU (Slow)', 'Groq API (Fast)']}
                      onChange={v => {
                        const engine = v.includes('Auto') ? 'auto' : v.includes('Local') ? 'local' : 'groq';
                        setS(s => ({ ...s, engine }));
                      }}
                    />
                    <SelectRow
                      label="Language"
                      value={activeItem?.language || S.language}
                      options={[...CAPTION_LANGUAGES]}
                      onChange={v => {
                        const language = v as Language;
                        setS(s => ({ ...s, language }));
                        if (activeItem && activeItem.status !== 'transcribing' && activeItem.status !== 'exporting' && !processing) {
                          setItemLanguage(activeItem.id, language);
                        }
                      }}
                    />
                    <div className="flex flex-col gap-1.5" style={{ gridColumn: '1 / -1' }}>
                      <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider">Groq API Key (Optional)</span>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          placeholder="gsk_..."
                          value={apiKey}
                          onChange={e => setApiKey(e.target.value)}
                          className="flex-1 rounded-lg px-3 py-2 text-[10px] text-white outline-none"
                          style={{ background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.07)' }}
                        />
                        <button
                          onClick={async () => { setTesting(true); setTestResult(null); const r = await testHFToken(apiKey); setTestResult(r); setTesting(false); }}
                          disabled={testing || !apiKey}
                          className="px-3 py-2 rounded-lg text-[9px] font-bold text-slate-300 hover:text-white transition-all disabled:opacity-50"
                          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
                        >
                          {testing ? '...' : 'Verify'}
                        </button>
                      </div>
                    </div>
                    {testResult && <p className="text-[9px] text-slate-400" style={{ gridColumn: '1 / -1' }}>{testResult}</p>}
                  </div>
                </OptionCard>
              </div>

              <div className="flex flex-col gap-2 mt-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => activeItem && (canBurn ? reburnItem(activeItem) : runAllProcesses(activeItem.id))}
                    disabled={(!canStart && !canBurn) || !!isWorking}
                    className="flex-1 py-2.5 rounded-xl font-bold text-[11px] flex items-center justify-center gap-2 transition-all disabled:opacity-30"
                    style={{
                      background: canBurn 
                        ? 'linear-gradient(135deg, rgba(245,158,11,0.20), rgba(217,119,6,0.12))'
                        : 'linear-gradient(135deg, rgba(14,165,233,0.20), rgba(99,102,241,0.16))',
                      border: canBurn ? '1px solid rgba(245,158,11,0.32)' : '1px solid rgba(14,165,233,0.32)',
                      color: canBurn ? '#fcd34d' : '#bae6fd'
                    }}
                  >
                    {batchOn || isWorking ? (
                      <span className="inline-block w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: canBurn ? '#fcd34d' : '#bae6fd', borderTopColor: 'transparent' }} />
                    ) : canBurn ? <IconFire /> : <IconMic />}
                    {activeItem?.status === 'transcribing' ? 'Transcribing...' 
                      : activeItem?.status === 'exporting' ? 'Burning...' 
                      : canBurn ? 'Export Video' 
                      : queue.length === 1 ? 'Generate Captions' : `Generate Captions (${queueRunnableCount})`}
                  </button>
                  {canBurn && (
                    <button
                      onClick={() => activeItem && runFullProcess(activeItem)}
                      disabled={!!isWorking || processing}
                      title="Retranscribe & Translate with current settings"
                      className="py-2.5 px-4 rounded-xl font-bold text-[11px] flex items-center gap-2 transition-all hover:bg-slate-800 disabled:opacity-30"
                      style={{ border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}
                    >
                      <IconMic /> Retranscribe
                    </button>
                  )}
                </div>
                {canBurn && (
                  <button
                    onClick={async () => {
                      if (!activeItem?.captions || !apiKey) return;
                      const { fixSpellingsWithGroq } = await import('./transcribe');
                      try {
                        const fixed = await fixSpellingsWithGroq(
                          activeItem.captions, 
                          activeItem.language === 'Auto-Detect'
                            ? (activeItem.detectedLang || 'the detected language')
                            : (activeItem.language || S.language), 
                          apiKey, 
                          (msg, pct) => upd(activeItem.id, { message: msg, progress: pct })
                        );
                        upd(activeItem.id, { captions: fixed, message: 'Spelling fixed!', progress: 0 });
                      } catch (err: any) {
                        setError(err.message);
                      }
                    }}
                    disabled={!!isWorking || processing || !apiKey}
                    className="flex-1 py-2.5 rounded-xl font-bold text-[11px] flex items-center justify-center gap-2 transition-all disabled:opacity-30"
                    style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.20), rgba(109,40,217,0.12))', border: '1px solid rgba(139,92,246,0.32)', color: '#c4b5fd' }}
                  >
                    ✨ AI Fix Spelling
                  </button>
                )}
                <button
                  onClick={openSavedOutput}
                  disabled={!canDownload}
                  className="flex-1 py-2.5 rounded-xl font-bold text-[11px] flex items-center justify-center gap-2 transition-all disabled:opacity-30"
                  style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.20), rgba(5,150,105,0.12))', border: '1px solid rgba(16,185,129,0.32)', color: '#6ee7b7' }}
                >
                  <IconDownload /> {activeItem?.outputPath ? 'Open Saved File' : 'Save Output'}
                </button>
                {activeItem && (
                  <button
                    onClick={handleEraseCaptions}
                    disabled={!!isWorking || processing || erasing}
                    className="flex-1 py-2.5 rounded-xl font-bold text-[11px] flex items-center justify-center gap-2 transition-all disabled:opacity-30"
                    style={{
                      background: 'linear-gradient(135deg, rgba(239,68,68,0.18), rgba(185,28,28,0.10))',
                      border: '1px solid rgba(239,68,68,0.28)',
                      color: '#fca5a5'
                    }}
                  >
                    🧹 {erasing ? 'Erasing...' : 'Caption Eraser (delogo)'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <AnimatePresence>
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              className="p-3 rounded-xl flex items-start gap-2 shrink-0"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.22)' }}
            >
              <span className="text-rose-400 text-sm shrink-0 mt-0.5">Warning</span>
              <p className="flex-1 text-[9px] text-rose-400/80 leading-relaxed break-words">{errorMsg}</p>
              <button onClick={() => setError(null)} className="text-rose-400/40 hover:text-rose-300 transition-colors shrink-0">x</button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ── Reusable Sub-components ─────────────────────────────────────────────────

function OptionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl"
      style={{
        padding: 14,
        background: 'linear-gradient(135deg, rgba(15,23,42,0.60), rgba(8,13,26,0.72))',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
        minHeight: 120,
      }}
    >
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[9px] font-black text-white uppercase">{title}</span>
      </div>
      {children}
    </div>
  );
}

function AccordionSection({
  label, id, open, onToggle, children,
}: {
  label: string;
  id: string;
  open: string | null;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  const isOpen = open === id;
  return (
    <div style={{ borderBottom: '1px solid rgba(99,102,241,0.06)' }}>
      <button
        onClick={() => onToggle(id)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors text-left"
      >
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <IconChevron open={isOpen} />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SliderRow({
  label, value, min, max, step = 1, inputValue, onChange, isFloat = false,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  step?: number;
  inputValue: number;
  onChange: (v: number) => void;
  isFloat?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
        <span className="text-[9px] font-bold text-indigo-400">{value}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={inputValue}
        onChange={e => onChange(isFloat ? parseFloat(e.target.value) : parseInt(e.target.value))}
        className="w-full h-1 rounded-full cursor-pointer"
        style={{ accentColor: '#6366f1', background: `linear-gradient(to right, #6366f1 ${((inputValue - min) / (max - min)) * 100}%, rgba(255,255,255,0.06) 0%)` }}
      />
    </div>
  );
}

function SelectRow({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[8px] font-bold text-slate-500 uppercase tracking-wider">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full rounded-xl px-3 py-2 text-[10px] text-white outline-none appearance-none cursor-pointer"
          style={{
            background: 'rgba(15,23,42,0.6)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          {options.map(o => (
            <option key={o} value={o} className="bg-[#0f172a]">{o}</option>
          ))}
        </select>
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-600 text-[8px]">▼</div>
      </div>
    </div>
  );
}

function CaptionLookPreview({
  settings,
  compact = false,
}: {
  settings: CaptionSettings;
  compact?: boolean;
}) {
  const previewText = ['this', 'section', 'looks', 'synced'];
  const activeIndex = compact ? 1 : 2;
  const fontSize = compact ? 10 : Math.max(13, Math.min(22, Math.round(settings.fontSize * 0.5)));
  const background = settings.style === 'pill' ? sc(settings.bgColor) : 'transparent';
  const color = settings.style === 'white-yellow' ? '#ffffff' : sc(settings.fontColor);
  const textShadow = settings.style === 'white-yellow'
    ? 'none'
    : settings.style === 'outline'
    ? '0 0 1px #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000'
    : settings.style === 'minimal'
    ? '0 2px 8px rgba(0,0,0,0.85)'
    : 'none';

  return (
    <div
      className="relative overflow-hidden rounded-xl"
      style={{
        height: compact ? 48 : 92,
        background:
          'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(2,6,23,0.95)), repeating-linear-gradient(45deg, rgba(99,102,241,0.16) 0 8px, transparent 8px 16px)',
        border: '1px solid rgba(99,102,241,0.16)',
      }}
    >
      <div
        className="absolute"
        style={{
          left: '50%',
          top: `${compact ? 54 : settings.yPos}%`,
          transform: 'translate(-50%, -50%)',
          width: '92%',
          textAlign: 'center',
        }}
      >
        <div
          className="inline-flex items-center justify-center"
          style={{
            maxWidth: '100%',
            flexWrap: 'wrap',
            gap: compact ? 3 : 6,
            padding: settings.style === 'pill' ? (compact ? '5px 9px' : '8px 14px') : 0,
            borderRadius: settings.style === 'pill' ? 999 : 8,
            background,
            color,
            fontSize,
            fontWeight: 900,
            lineHeight: 1.12,
            textShadow,
          }}
        >
          {previewText.map((word, index) => (
            <span
              key={word}
              style={{
                color: index === activeIndex ? (settings.style === 'white-yellow' ? '#facc15' : settings.highlightColor) : 'inherit',
                transform: index === activeIndex ? 'scale(1.08)' : 'scale(1)',
                transition: 'all 120ms ease',
                textShadow: index === activeIndex && settings.style !== 'white-yellow'
                  ? `0 0 14px ${settings.highlightColor}88`
                  : textShadow,
              }}
            >
              {word}
            </span>
          ))}
        </div>
      </div>
      {!compact && (
        <div
          className="absolute"
          style={{
            left: 10,
            right: 10,
            bottom: 8,
            height: 3,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.08)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: '62%',
              height: '100%',
              background: 'linear-gradient(90deg,#6366f1,#facc15)',
              borderRadius: 999,
            }}
          />
        </div>
      )}
    </div>
  );
}
