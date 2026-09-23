// Destinations in the existing mounted InputPanel, not new module instances.
export const PREPARATION_TOOLS = [
  { id: 'singSongSection', label: 'Sing Song', icon: 'music', description: 'Prepare songs and work with your local singing voice', primary: true },
  { id: 'aiCaptionSection', label: 'AI Captioning (Local)', icon: 'captions', description: 'Open AI Video Captioning (Local) for video transcription and captions', primary: true },
  { id: 'audioToTextSection', label: 'Audio to Text', icon: 'audio', description: 'Transcribe an uploaded audio file' },
  { id: 'speechToolsSection', label: 'Text & Speech Tools', icon: 'audio', description: 'Dictation, voice previews and text helpers' },
  { id: 'narrationSection', label: 'Narration & Audio', icon: 'audio', description: 'Upload, record or prepare a narration track' },
  { id: 'mediaSection', label: 'Images & Video', icon: 'resizer', description: 'Add pictures, video, an intro or a poster' },
  { id: 'templateWorkflowSection', label: 'Presentation Templates', icon: 'presentator', description: 'Choose your presentation stage design' },
  { id: 'serverControlsSection', label: 'Local Service Status', icon: 'settings', description: 'Check your local voice, transcription and export helpers' },
  { id: 'lessonContentSection', label: 'Write a Lesson', icon: 'quotes', description: 'Write or paste your lesson text' },
  { id: 'pdfSection', label: 'PDF Presenter', icon: 'presentator', description: 'Upload a PDF, choose pages and preview your presentation' },
];

export function isPresentationBusy(state, exporting = false) {
  return Boolean(exporting || state?.speaking || state?.exportingVideo || state?.generatingNarration ||
    state?.pdfLoading || state?.inputPreviewing || state?.pdf?.preparingNarration || state?.pdf?.preparingArtwork ||
    state?.activeAudio || state?.introPlayback?.active || state?.recording?.recorder?.state === 'recording' ||
    Object.values(state?.actionLocks || {}).some(Boolean) ||
    (state?.stageVideo?.element && !state.stageVideo.element.paused && !state.stageVideo.element.ended));
}

export function focusPreparationTool(id, document) {
  const input = document.getElementById('inputPanel');
  const sections = id === 'lessonContentSection'
    ? ['lessonContentSection', 'narrationSection', 'introPosterSection', 'mediaSection', 'templateWorkflowSection', 'speechToolsSection']
    : id === 'pdfSection'
      ? ['pdfSection', 'introPosterSection']
      : id === 'mediaSection'
        ? ['introPosterSection', 'mediaSection']
        : [id];
  for (const child of Array.from(input?.children || [])) {
    const presenterHeader = ['pdfSection', 'lessonContentSection'].includes(id) && child.classList.contains('panel-head');
    const captionActions = id === 'aiCaptionSection' && Boolean(child.querySelector('#aiCapSttBtn'));
    child.dataset.studioToolVisible = String(sections.includes(child.id) || presenterHeader || captionActions);
  }
}

export function checkPreparationToolAccess(id, { document, state, exporting = false }) {
  if (!PREPARATION_TOOLS.some(tool => tool.id === id)) return { ok: false, message: 'That lesson tool is not available.' };
  const target = document.getElementById(id);
  const input = document.getElementById('inputPanel');
  const stage = document.getElementById('stagePanel');
  if (!target || !input || !stage) return { ok: false, message: 'The workspace is still loading. Please try again in a moment.' };
  const fromPreview = input.hidden || input.classList.contains('hidden');
  if (fromPreview) {
    // Only the live legacy state knows about in-flight PDF and narration work.
    const busy = !state || isPresentationBusy(state, exporting);
    if (busy) return { ok: false, message: 'The presentation is busy. Finish or stop it before opening another lesson tool. Your current work has been left running.' };
  }
  return { ok: true, fromPreview };
}

export function revealPreparationTool(id, context) {
  const access = checkPreparationToolAccess(id, context);
  if (!access.ok) return access;
  const { document } = context;
  focusPreparationTool(id, document);
  // View-only: never click Edit/Stop, reset the PDF timeline, recreate inputs,
  // or dispatch an upload, generation or export action.
  if (access.fromPreview) {
    document.getElementById('stagePanel').classList.add('hidden');
    const input = document.getElementById('inputPanel');
    input.hidden = false;
    input.classList.remove('hidden');
  }
  const target = document.getElementById(id);
  target.open = true;
  const workspace = document.querySelector?.('.simple-studio [data-workspace="presentator"]');
  if (workspace) {
    // The focused view can have a preview row or caption action strip before
    // the section. Keep those controls visible below the fixed app header.
    workspace.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.getElementById('inputPanel').scrollTop = 0;
  } else target.scrollIntoView({ behavior: 'instant', block: 'start' });
  target.querySelector('summary')?.focus({ preventScroll: true });
  return { ok: true };
}
