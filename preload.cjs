'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const burnProgressHandlers = new Map();
const translateDubProgressHandlers = new Map();
const myExporterProgressHandlers = new Map();
const agentProgressHandlers = new Map();
const transcribeProgressHandlers = new Map();

// ─── Expose a secure, limited API to the renderer via window.electronAPI ─────
contextBridge.exposeInMainWorld('electronAPI', {

  // Native save-file dialog
  showSaveDialog: (options) =>
    ipcRenderer.invoke('show-save-dialog', options),

  // Write a file natively (bypasses browser download API limitations)
  writeFile: (filePath, base64Data) =>
    ipcRenderer.invoke('write-file', { filePath, base64Data }),

  // Open the containing folder in Windows Explorer
  showItemInFolder: (filePath) =>
    ipcRenderer.invoke('show-item-in-folder', filePath),

  // Get system info (RAM, CPUs, platform)
  getSystemInfo: () =>
    ipcRenderer.invoke('get-system-info'),
  getAppRoot: () =>
    ipcRenderer.invoke('get-app-root'),

  getOllamaLaunchStatus: () =>
    ipcRenderer.invoke('get-ollama-launch-status'),

  launchOllamaTool: (tool) =>
    ipcRenderer.invoke('launch-ollama-tool', tool),
  openOllamaUpdate: () =>
    ipcRenderer.invoke('open-ollama-update'),
  restoreCodexApp: () =>
    ipcRenderer.invoke('restore-codex-app'),
  endOllamaToolSession: (tool) =>
    ipcRenderer.invoke('end-ollama-tool-session', tool),
  endAllOllamaToolSessions: () =>
    ipcRenderer.invoke('end-all-ollama-tool-sessions'),

  // Get live mobile link
  getMobileLink: () =>
    ipcRenderer.invoke('get-mobile-link'),

  // Generate / refresh mobile link
  generateMobileLink: () =>
    ipcRenderer.invoke('generate-mobile-link'),

  getWhatsAppAutoSend: () =>
    ipcRenderer.invoke('get-whatsapp-auto-send'),

  setWhatsAppAutoSend: (enabled) =>
    ipcRenderer.invoke('set-whatsapp-auto-send', enabled),

  // Live mobile link real-time event
  onMobileLinkUpdated: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('mobile-link-updated', handler);
    return () => ipcRenderer.removeListener('mobile-link-updated', handler);
  },

  // ── Autonomous Super Agent ──────────────────────────────────────────────────
  // Model credentials stay in the main process.

  presentatorAgentThink: (payload) =>
    ipcRenderer.invoke('presentator-agent-think', payload),

  presentatorAgentCancel: () =>
    ipcRenderer.invoke('presentator-agent-cancel'),
  presentatorAgentStopProcess: () =>
    ipcRenderer.invoke('presentator-agent-stop-process'),
  presentatorAgentHermesStatus: () =>
    ipcRenderer.invoke('presentator-agent-hermes-status'),
  presentatorAgentHermesImprove: (payload) =>
    ipcRenderer.invoke('presentator-agent-hermes-improve', payload),

  onPresentatorAgentProgress: (callback) => {
    const handler = (_, data) => callback(data);
    agentProgressHandlers.set(callback, handler);
    ipcRenderer.on('presentator-agent-progress', handler);
  },

  offPresentatorAgentProgress: (callback) => {
    const handler = agentProgressHandlers.get(callback);
    if (handler) {
      ipcRenderer.removeListener('presentator-agent-progress', handler);
      agentProgressHandlers.delete(callback);
    }
  },

  presentatorAgentRestartServer: (serverName) =>
    ipcRenderer.invoke('presentator-agent-restart-server', serverName),

  presentatorAgentReadDiagnostics: () =>
    ipcRenderer.invoke('presentator-agent-read-diagnostics'),

  presentatorAgentLoadData: () =>
    ipcRenderer.invoke('presentator-agent-load-data'),

  presentatorAgentSaveData: (data) =>
    ipcRenderer.invoke('presentator-agent-save-data', data),

  presentatorAgentListCheckpoints: () =>
    ipcRenderer.invoke('presentator-agent-list-checkpoints'),

  presentatorAgentRestoreCheckpoint: (request) =>
    ipcRenderer.invoke('presentator-agent-restore-checkpoint', request),

  presentatorAgentValidateWebApp: (request) =>
    ipcRenderer.invoke('presentator-agent-validate-web-app', request),

  presentatorAgentInspectCode: (request) =>
    ipcRenderer.invoke('presentator-agent-inspect-code', request),

  presentatorAgentApplyPatch: (request) =>
    ipcRenderer.invoke('presentator-agent-apply-patch', request),

  presentatorAgentRestartApp: () =>
    ipcRenderer.invoke('presentator-agent-restart-app'),

  presentatorAgentGenerateImage: (request) =>
    ipcRenderer.invoke('presentator-agent-generate-image', request),

  presentatorAgentCreateVideo: (request) =>
    ipcRenderer.invoke('presentator-agent-create-video', request),

  presentatorAgentGenerateTrueVideo: (request) =>
    ipcRenderer.invoke('presentator-agent-generate-true-video', request),

  presentatorAgentImportReference: (request) =>
    ipcRenderer.invoke('presentator-agent-import-reference', request),

  // ── New Super Agent Power Tools ─────────────────────────────────────────────

  presentatorAgentListFiles: (request) =>
    ipcRenderer.invoke('presentator-agent-list-files', request),

  presentatorAgentReadFile: (request) =>
    ipcRenderer.invoke('presentator-agent-read-file', request),

  presentatorAgentWriteFile: (request) =>
    ipcRenderer.invoke('presentator-agent-write-file', request),

  presentatorAgentRunCommand: (request) =>
    ipcRenderer.invoke('presentator-agent-run-command', request),

  presentatorAgentSearchFiles: (request) =>
    ipcRenderer.invoke('presentator-agent-search-files', request),

  presentatorAgentAnalyzeCode: (request) =>
    ipcRenderer.invoke('presentator-agent-analyze-code', request),

  presentatorAgentRunBuild: () =>
    ipcRenderer.invoke('presentator-agent-run-build'),

  presentatorAgentDiffFiles: (request) =>
    ipcRenderer.invoke('presentator-agent-diff-files', request),

  presentatorAgentGenerateSfx: (request) =>
    ipcRenderer.invoke('presentator-agent-generate-sfx', request),

  presentatorAgentMorphAudio: (request) =>
    ipcRenderer.invoke('presentator-agent-morph-audio', request),

  // ── Server management ──────────────────────────────────────────────────────

  // Ask the main process to restart the Anjali AI server
  restartAnjali: () =>
    ipcRenderer.invoke('restart-anjali'),

  // Generate Edge TTS audio through Electron main. This avoids Chromium fetch
  // rejecting a valid local WAV response when Windows resets the socket close.
  narrateEdgeTts: (payload) =>
    ipcRenderer.invoke('narrate-edge-tts', payload),

  narrateEdgeTtsTimed: async (payload) => {
    try {
      return await ipcRenderer.invoke('narrate-edge-tts-timed', payload);
    } catch (error) {
      if (!/no handler registered/i.test(String(error?.message || error))) throw error;
      const result = await ipcRenderer.invoke('narrate-edge-tts', payload);
      return { ...result, wordTimings: Array.isArray(result?.wordTimings) ? result.wordTimings : [] };
    }
  },

  narrateSc3Text: (payload) =>
    ipcRenderer.invoke('narrate-sc3-text', payload),

  narrateSc3Tts: (payload) =>
    ipcRenderer.invoke('narrate-sc3-tts', payload),

  // Genuine ACE-Step text-to-song generation. Supplied lyrics are preserved.
  generateRhymeSong: (payload) =>
    ipcRenderer.invoke('generate-rhyme-song', payload),

  cancelRhymeSong: () =>
    ipcRenderer.invoke('cancel-rhyme-song'),

  previewRhymeMix: (payload) =>
    ipcRenderer.invoke('preview-rhyme-mix', payload),

  checkRhymeModule: () =>
    ipcRenderer.invoke('check-rhyme-module'),
  getRhymeResumeJob: () =>
    ipcRenderer.invoke('get-rhyme-resume-job'),

  onRhymeSongProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on('rhyme-song-progress', handler);
    return () => ipcRenderer.removeListener('rhyme-song-progress', handler);
  },

  narrateUploadedVideoVoice: (payload) =>
    ipcRenderer.invoke('narrate-uploaded-video-voice', payload),

  // Ask the main process to restart the video export / FFmpeg server
  restartVideoExport: () =>
    ipcRenderer.invoke('restart-video-export'),

  // Get live health status of all servers
  getServerHealth: () =>
    ipcRenderer.invoke('get-server-health'),

  // Listen for server-status push events from main process
  onServerStatus: (callback) => {
    ipcRenderer.on('server-status', (_, data) => callback(data));
  },

  // Remove server-status listener (cleanup)
  offServerStatus: (callback) => {
    ipcRenderer.removeListener('server-status', callback);
  },

  // ── SC3 crash-free video audio replacement ─────────────────────────────────
  // Gets the real on-disk path for a browser File object (Electron only).
  // Needed so the main process can read the file without loading it in renderer.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Replace video audio with SC3 voice — all heavy work runs in main process:
  // FFmpeg extracts audio → SC3 server converts → FFmpeg muxes back into video.
  // Zero large files loaded into renderer memory. Crash-free.
  sc3ReplaceVideoAudio: (opts) =>
    ipcRenderer.invoke('sc3-replace-video-audio', opts),

  // Fast mode — SC3 Singing timbre transfer for video (no transcription, much faster)
  sc3SingingReplaceVideo: (opts) =>
    ipcRenderer.invoke('sc3-singing-replace-video', opts),

  // Transcribe video audio via main process (crash-free).
  // Main process extracts 16kHz mono WAV with FFmpeg and sends to transcription server.
  // Renderer never loads video bytes → no OOM crash on large videos.
  transcribeVideo: (opts) =>
    ipcRenderer.invoke('transcribe-video', opts),

  onTranscribeProgress: (callback) => {
    const handler = (_, progress) => callback(progress);
    transcribeProgressHandlers.set(callback, handler);
    ipcRenderer.on('caption-transcribe-progress', handler);
    return () => {
      ipcRenderer.removeListener('caption-transcribe-progress', handler);
      transcribeProgressHandlers.delete(callback);
    };
  },
  offTranscribeProgress: (callback) => {
    const handler = transcribeProgressHandlers.get(callback);
    if (handler) {
      ipcRenderer.removeListener('caption-transcribe-progress', handler);
      transcribeProgressHandlers.delete(callback);
    }
  },

  transcribeVideoGroq: (opts) =>
    ipcRenderer.invoke('transcribe-video-groq', opts),

  // Replace audio file vocal with Chatterbox sc3 voice (Transcribe → Indian English → TTS)
  sc3NarrateAudio: (opts) =>
    ipcRenderer.invoke('sc3-narrate-audio', opts),

  // Check if running inside Electron
  isElectron: true,
  platform: process.platform,

  // Synchronous Groq API key retrieval
  getGroqApiKey: () =>
    ipcRenderer.sendSync('get-groq-api-key'),

  // Fast caption export — burns subtitles into video using FFmpeg (no video playback)
  burnCaptions: (opts) =>
    ipcRenderer.invoke('burn-captions', opts),

  // Probe video dimensions/duration natively so caption export can match the
  // exact preview position and font scale without loading large videos in JS.
  probeVideoMeta: (opts) =>
    ipcRenderer.invoke('probe-video-meta', opts),

  myExporterProbe: (opts) =>
    ipcRenderer.invoke('my-exporter-probe', opts),

  myExporterWaveform: (opts) =>
    ipcRenderer.invoke('my-exporter-waveform', opts),

  myExporterPreflight: (opts) =>
    ipcRenderer.invoke('my-exporter-preflight', opts),

  myExporterPickMedia: () =>
    ipcRenderer.invoke('my-exporter-pick-media'),

  myExporterPickAudio: () =>
    ipcRenderer.invoke('my-exporter-pick-audio'),

  myExporterCropSave: (opts) =>
    ipcRenderer.invoke('my-exporter-crop-save', opts),

  myExporterCaptionCacheLoad: (key) =>
    ipcRenderer.invoke('my-exporter-caption-cache-load', { key }),

  myExporterCaptionCacheSave: (key, data) =>
    ipcRenderer.invoke('my-exporter-caption-cache-save', { key, data }),

  myExporterExport: (opts) =>
    ipcRenderer.invoke('my-exporter-export', opts),

  myExporterCancel: () =>
    ipcRenderer.invoke('my-exporter-cancel'),

  myExporterDeleteProject: (filePath) =>
    ipcRenderer.invoke('my-exporter-delete-project', { filePath }),

  onMyExporterProgress: (callback) => {
    const handler = (_, data) => callback(data);
    myExporterProgressHandlers.set(callback, handler);
    ipcRenderer.on('my-exporter-progress', handler);
  },

  offMyExporterProgress: (callback) => {
    const handler = myExporterProgressHandlers.get(callback);
    if (handler) {
      ipcRenderer.removeListener('my-exporter-progress', handler);
      myExporterProgressHandlers.delete(callback);
    }
  },

  // Extract 16kHz mono WAV audio natively using FFmpeg (returns on-disk path, NOT bytes)
  extractAudio: (opts) =>
    ipcRenderer.invoke('extract-audio', opts),

  // Read a byte-range slice from an on-disk WAV file (used to stream chunks without loading full file)
  readAudioChunk: (opts) =>
    ipcRenderer.invoke('read-audio-chunk', opts),

  // Merge narration audio into video (for animation/no-speech videos)
  mergeAudioIntoVideo: (opts) =>
    ipcRenderer.invoke('merge-audio-into-video', opts),

  exportTranslatedVideo: (opts) =>
    ipcRenderer.invoke('export-translated-video', opts),

  exportSyncedTranslatedVideo: (opts) =>
    ipcRenderer.invoke('export-synced-translated-video', opts),

  onTranslateDubProgress: (callback) => {
    const handler = (_, data) => callback(data);
    translateDubProgressHandlers.set(callback, handler);
    ipcRenderer.on('translate-dub-progress', handler);
  },

  offTranslateDubProgress: (callback) => {
    const handler = translateDubProgressHandlers.get(callback);
    if (handler) {
      ipcRenderer.removeListener('translate-dub-progress', handler);
      translateDubProgressHandlers.delete(callback);
    }
  },

  // Desktop notification — alerts user when a task completes
  showNotification: (title, body, opts) =>
    ipcRenderer.invoke('show-notification', { title, body, ...opts }),

  shutdownComputer: (opts) =>
    ipcRenderer.invoke('shutdown-computer-after-export', opts),
  cancelComputerShutdown: () =>
    ipcRenderer.invoke('cancel-computer-shutdown'),

  // Open a file with the OS default handler (e.g. play a burned video in media player)
  openFile: (filePath) =>
    ipcRenderer.invoke('open-file', filePath),

  // Erase hardcoded captions from the bottom of the video using delogo filter
  eraseCaptions: (opts) =>
    ipcRenderer.invoke('erase-captions', opts),

  // Real-time FFmpeg burn progress (0-94) sent from main while burning captions
  onBurnProgress: (callback) => {
    const handler = (_, data) => callback(data);
    burnProgressHandlers.set(callback, handler);
    ipcRenderer.on('burn-captions-progress', handler);
  },

  offBurnProgress: (callback) => {
    const handler = burnProgressHandlers.get(callback);
    if (handler) {
      ipcRenderer.removeListener('burn-captions-progress', handler);
      burnProgressHandlers.delete(callback);
    }
  },

});
