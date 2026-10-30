export const REPORT_FILE_EVENT = 'pattan-report-file-result';
export const MAX_REPORT_BYTES = 12 * 1024 * 1024;

export const hasNativeReportSaving = host => typeof host?.PattanReportFiles?.beginSaveReportJson === 'function';

export function bytesToBase64(bytes, host) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!data.length || data.length > MAX_REPORT_BYTES) throw new Error('Choose a smaller report (maximum 12 MB).');
  let binary = '';
  for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
  return host.btoa(binary);
}

export function saveReportFile(host, bytes, mime, filename) {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  if (!data.length || data.length > MAX_REPORT_BYTES) return Promise.reject(new Error('Choose a smaller report (maximum 12 MB).'));
  if (hasNativeReportSaving(host)) {
    return new Promise((resolve, reject) => {
      const requestId = host.crypto.randomUUID();
      let timeout;
      const cleanup = () => { host.removeEventListener(REPORT_FILE_EVENT, receive); host.clearTimeout(timeout); };
      const receive = event => {
        if (event.detail?.requestId !== requestId) return;
        cleanup();
        if (event.detail.status === 'saved' || event.detail.status === 'cancelled') resolve(event.detail);
        else reject(new Error(event.detail.error || 'Could not save the report. Please retry.'));
      };
      host.addEventListener(REPORT_FILE_EVENT, receive);
      timeout = host.setTimeout(() => { cleanup(); reject(new Error('The save window expired. Please export again.')); }, 15 * 60 * 1000);
      try {
        const reply = JSON.parse(host.PattanReportFiles.beginSaveReportJson(requestId, filename, mime.split(';')[0], bytesToBase64(data, host)));
        if (reply?.status !== 'choosing') throw new Error(reply?.error || 'Could not open the save window.');
      } catch (error) { cleanup(); reject(error); }
    });
  }
  if (host.Capacitor?.getPlatform?.() === 'android' || /\bwv\b/.test(host.navigator?.userAgent || '')) {
    return Promise.reject(new Error('Install the updated signed APK to save files on Android. Your report remains available to copy or share.'));
  }
  const url = host.URL.createObjectURL(new Blob([data], { type: mime }));
  const link = host.document.createElement('a');
  link.href = url; link.download = filename;
  host.document.body.appendChild(link); link.click(); link.remove();
  host.setTimeout(() => host.URL.revokeObjectURL(url), 60000);
  return Promise.resolve({ status: 'requested', filename });
}

export const savedReportNotice = (result, label) => result.status === 'saved'
  ? result.filename ? `${label} saved as ${result.filename}.` : `${label} saved to the location you chose.`
  : result.status === 'cancelled' ? 'Save cancelled. Your saved records are unchanged.'
    : `${label} download requested. Check your Downloads.`;
