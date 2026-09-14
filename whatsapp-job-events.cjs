'use strict';

const { randomUUID } = require('node:crypto');
const path = require('node:path');

// Only whole native operations, never save dialogs, network chunks, previews,
// probes or individual TTS sentences. Names describe operations, not a claim
// that an entire multi-step workflow has finished.
const JOB_CHANNELS = Object.freeze({
  'sc3-replace-video-audio': 'Sing Song · video voice conversion',
  'sc3-narrate-audio': 'Sing Song · audio narration',
  'quote-export-finish': 'Quote Studio · video export',
  'video-resizer-export': 'Video Resizer · video export',
  'my-exporter-export': 'My Exporter · video export',
  'my-exporter-crop-save': 'My Exporter · cropped video',
  'burn-captions': 'Captioned video export',
  'erase-captions': 'Caption removal',
  'export-translated-video': 'Translated video export',
  'export-synced-translated-video': 'Synced translated video export',
  'transcribe-video': 'Local transcription',
  'transcribe-video-groq': 'Online transcription',
});
const CANCEL_CHANNELS = Object.freeze({
  'video-resizer-cancel': ['video-resizer-export'],
  'my-exporter-cancel': ['my-exporter-export'],
  'cancel-transcribe-video': ['transcribe-video', 'transcribe-video-groq'],
});

function isCancelled(value) {
  return Boolean(value?.canceled || value?.cancelled || value?.name === 'AbortError' ||
    /\b(?:cancelled|canceled|aborted by user)\b/i.test(String(value?.error || value?.message || '')));
}

function describeResult(result) {
  const output = result?.fileName || result?.outputPath || result?.videoPath || result?.filePath;
  // Never include a full path, transcript, remote link or arbitrary result JSON.
  const name = typeof output === 'string' && !/^[a-z][a-z0-9+.-]*:\/\//i.test(output)
    ? path.win32.basename(path.posix.basename(output)).slice(0, 180) : '';
  return name ? `Output: ${name}` : 'Operation completed successfully.';
}

function createWhatsAppJobObserver(report, { makeId = randomUUID } = {}) {
  const active = new Set();
  const emit = event => {
    try { Promise.resolve(report(event)).catch(() => {}); } catch (_) {}
  };
  return function observe(channel, handler) {
    if (Object.hasOwn(CANCEL_CHANNELS, channel)) {
      return function (...args) {
        const externalId = String(args[1]?.jobId || '');
        for (const job of active) {
          if (CANCEL_CHANNELS[channel].includes(job.channel) && (!externalId || job.externalId === externalId)) job.cancelled = true;
        }
        return handler.apply(this, args);
      };
    }
    if (!Object.hasOwn(JOB_CHANNELS, channel)) return handler;
    return async function (...args) {
      const job = { id: `native-${makeId()}`, channel, externalId: String(args[1]?.jobId || ''), cancelled: false };
      active.add(job);
      try {
        const result = await handler.apply(this, args);
        if (!job.cancelled && !isCancelled(result)) {
          if (result?.ok === true) emit({ id: job.id, status: 'completed', processName: JOB_CHANNELS[channel], details: describeResult(result) });
          else if (result?.ok === false) emit({ id: job.id, status: 'failed', processName: JOB_CHANNELS[channel], details: String(result.error || 'The operation did not complete.') });
        }
        return result;
      } catch (error) {
        if (!job.cancelled && !isCancelled(error)) emit({ id: job.id, status: 'failed', processName: JOB_CHANNELS[channel], details: String(error?.message || 'The operation failed unexpectedly.') });
        throw error;
      } finally { active.delete(job); }
    };
  };
}

module.exports = { JOB_CHANNELS, createWhatsAppJobObserver, isCancelled, describeResult };
