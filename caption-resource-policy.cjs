'use strict';

const DEFAULT_MIN_FREE_MEMORY_BYTES = 3 * 1024 ** 3;

function resourceError(reason, message, cancelled = false) {
  const error = new Error(message);
  error.code = cancelled ? 'CAPTION_RESOURCE_CANCELLED' : 'CAPTION_RESOURCE_BUSY';
  error.reason = reason;
  return error;
}

function onceAsync(operation = () => {}) {
  let result;
  return () => {
    if (!result) result = Promise.resolve().then(operation);
    return result;
  };
}

/** Decide whether captioning may temporarily release an idle SC3 voice model.
 * All service and memory access is injected; this module never starts services.
 */
async function prepareCaptionVoiceMemory(options = {}, minFreeMemoryBytes = DEFAULT_MIN_FREE_MEMORY_BYTES) {
  if (typeof minFreeMemoryBytes !== 'number' || !Number.isFinite(minFreeMemoryBytes) || minFreeMemoryBytes <= 0) {
    throw new TypeError('The caption memory threshold must be a positive number of bytes.');
  }
  const { freeMemoryBytes, getNarrationProgress, pauseVoice, isCancelled = () => false, onDecision } = options;
  let resume;
  let available;
  const report = facts => {
    // Only policy-owned facts are logged, never service responses or exceptions.
    try { onDecision?.({ ...facts, minimumMemoryBytes: minFreeMemoryBytes }); } catch (_) {}
  };
  const checkCancelled = () => {
    if (isCancelled()) throw resourceError('cancelled', 'Caption generation was cancelled.', true);
  };
  const readMemory = async () => {
    checkCancelled();
    let bytes;
    try {
      if (typeof freeMemoryBytes !== 'function') throw new Error();
      bytes = await freeMemoryBytes();
    } catch (_) {
      checkCancelled();
      throw resourceError('memory-check-failed', 'Captioning could not check free memory. Try again when more memory is available.');
    }
    checkCancelled();
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
      throw resourceError('memory-check-failed', 'Captioning could not check free memory. Try again when more memory is available.');
    }
    return bytes;
  };

  try {
    checkCancelled();
    available = await readMemory();
    checkCancelled();
    if (available >= minFreeMemoryBytes) {
      report({ decision: 'keep-loaded', reason: 'enough-memory', freeMemoryBytes: available });
      return onceAsync();
    }

    let progress;
    checkCancelled();
    try {
      if (typeof getNarrationProgress !== 'function') throw new Error();
      progress = await getNarrationProgress();
    } catch (_) {
      checkCancelled();
      throw resourceError('voice-check-failed', 'Captioning could not check whether SC3 is busy. Wait until SC3 is ready, then generate captions again.');
    }
    checkCancelled();
    if (!progress || typeof progress !== 'object' || typeof progress.active !== 'boolean') {
      throw resourceError('voice-check-failed', 'Captioning could not check whether SC3 is busy. Wait until SC3 is ready, then generate captions again.');
    }
    if (progress.active) {
      throw resourceError('voice-active', 'SC3 is generating narration and there is not enough free memory for captions. Wait for narration to finish, then generate captions again.');
    }

    checkCancelled();
    report({ decision: 'pause', reason: 'idle-low-memory', freeMemoryBytes: available, voiceActive: false });
    // A decision callback may itself cancel the caption request.
    checkCancelled();
    let restore;
    try {
      if (typeof pauseVoice !== 'function') throw new Error();
      restore = await pauseVoice();
    } catch (_) {
      checkCancelled();
      throw resourceError('voice-pause-failed', 'Captioning could not release the idle SC3 model safely. Try again when more memory is available.');
    }
    if (typeof restore === 'function') resume = onceAsync(restore);
    checkCancelled();
    if (!resume) {
      throw resourceError('voice-pause-failed', 'Captioning could not release the idle SC3 model safely. Try again when more memory is available.');
    }

    available = await readMemory();
    checkCancelled();
    if (available < minFreeMemoryBytes) {
      throw resourceError('memory-still-low', 'There is still not enough free memory for captions after releasing the idle SC3 model. Close other applications or wait for memory to become available, then try again.');
    }
    report({ decision: 'pause', reason: 'memory-ready', freeMemoryBytes: available, voiceActive: false });
    checkCancelled();
    return resume;
  } catch (error) {
    if (resume) {
      try { await resume(); } catch (_) {
        report({ decision: 'error', reason: 'voice-resume-failed', freeMemoryBytes: available });
      }
    }
    // Cancellation also takes precedence when it happens while restoring SC3.
    try { checkCancelled(); } catch (cancelled) { error = cancelled; }
    if (!['CAPTION_RESOURCE_BUSY', 'CAPTION_RESOURCE_CANCELLED'].includes(error?.code)) {
      error = resourceError('policy-check-failed', 'Captioning could not check SC3 resources safely. Wait until SC3 is ready, then try again.');
    }
    report({ decision: 'error', reason: error.reason, freeMemoryBytes: available });
    throw error;
  }
}

module.exports = { prepareCaptionVoiceMemory };
