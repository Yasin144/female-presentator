import React from 'react';
import StudioIcon from './StudioIcon';

// This catalogue is also used by the shell so a Home card always opens the
// same workspace as its matching title and Back to Home controls.
export const HOME_MODULES = [
  { id: 'pdf', label: 'PDF Presenter', description: 'Turn PDF pages into narrated lessons and videos.', icon: 'presentator', kind: 'section', target: 'pdfSection' },
  { id: 'lesson', label: 'Lesson Presenter', description: 'Write a lesson, preview it, and present it aloud.', icon: 'presentator', kind: 'section', target: 'lessonContentSection' },
  { id: 'singing', label: 'Sing Song', description: 'Prepare song audio and convert voices.', icon: 'music', kind: 'section', target: 'singSongSection' },
  { id: 'local-captions', label: 'AI Captioning (Local)', description: 'Create video captions using local transcription.', icon: 'captions', kind: 'section', target: 'aiCaptionSection' },
  { id: 'captions', label: 'Caption Burner', description: 'Style captions and burn them into your video.', icon: 'captions', kind: 'caption', target: 'captions' },
  { id: 'quotes', label: 'Quote Studio', description: 'Make quote videos with your words and visuals.', icon: 'quotes', kind: 'workspace', target: 'quotes' },
  { id: 'exporter', label: 'My Exporter', description: 'Edit your media and export a finished video.', icon: 'exporter', kind: 'workspace', target: 'exporter' },
  { id: 'resizer', label: 'Video Resizer', description: 'Fit a video to vertical, square, or wide formats.', icon: 'resizer', kind: 'workspace', target: 'resizer' },
  { id: 'translator', label: 'Translate Audio', description: 'Translate spoken audio into another language.', icon: 'audio', kind: 'translator', target: 'translator' },
  { id: 'transcription', label: 'Audio to Text', description: 'Turn a recording into editable text.', icon: 'audio', kind: 'section', target: 'audioToTextSection' },
  { id: 'meta', label: 'Meta AI', description: 'Muse writing, images, transcription and local connection.', icon: 'quotes', kind: 'workspace', target: 'meta' },
];

export const HOME_HELPERS = [
  { id: 'narration', label: 'Narration & Audio', description: 'Prepare narration and manage audio.', icon: 'audio', kind: 'section', target: 'narrationSection' },
  { id: 'speech', label: 'Text & Speech', description: 'Use the text and speech helpers.', icon: 'audio', kind: 'section', target: 'speechToolsSection' },
  { id: 'media', label: 'Images & Video', description: 'Add pictures and video clips.', icon: 'exporter', kind: 'section', target: 'mediaSection' },
  { id: 'templates', label: 'Templates', description: 'Choose a presentation template.', icon: 'presentator', kind: 'section', target: 'templateWorkflowSection' },
  { id: 'services', label: 'Local Service Status', description: 'Check the local services used by your tools.', icon: 'settings', kind: 'section', target: 'serverControlsSection' },
];

export default function StudioHome({ onOpen, preferences }) {
  return (
    <section className="studio-home" aria-labelledby="studio-home-title">
      <div className="studio-home-heading">
        <h1 id="studio-home-title">What would you like to make?</h1>
        <p>Choose a tool to get started.</p>
      </div>

      {preferences}

      <nav className="studio-home-grid" aria-label="All tools">
        {HOME_MODULES.map((tool) => (
          <button
            className="studio-home-card"
            type="button"
            key={tool.id}
            data-home-tool={tool.id}
            aria-label={`Open ${tool.label}`}
            aria-describedby={`studio-home-description-${tool.id}`}
            onClick={() => onOpen(tool.id)}
          >
            <span className="studio-home-card-icon"><StudioIcon name={tool.icon} size={23} /></span>
            <span className="studio-home-card-title">{tool.label}</span>
            <span className="studio-home-card-description" id={`studio-home-description-${tool.id}`}>{tool.description}</span>
            <span className="studio-home-card-open" aria-hidden="true">Open tool <span>→</span></span>
          </button>
        ))}
      </nav>

      <section className="studio-home-helpers" aria-labelledby="studio-home-helpers-title">
        <h2 id="studio-home-helpers-title">Settings &amp; helpers</h2>
        <div className="studio-home-helper-links">
          {HOME_HELPERS.map((tool) => (
            <button
              className="studio-home-helper"
              type="button"
              key={tool.id}
              data-home-tool={tool.id}
              title={tool.description}
              onClick={() => onOpen(tool.id)}
            >
              {tool.label}<span aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>
    </section>
  );
}
