import React, { useEffect, useId, useState } from 'react';
import './help-demo.css';

const SAMPLE_SCENES = [1, 2, 3];
const SAMPLE_FRAMES = [
  { label: 'Before', note: 'See the sample before this action.' },
  { label: 'Choose', note: 'Choose the setting or range shown in this example.' },
  { label: 'Result', note: 'See how the sample changes.' },
];

function LessonPicture({ topic, step }) {
  const clipId = useId();
  const kind = topic.demoKind;
  const changed = step === 2;
  const title = kind === 'title';
  const watermark = /watermark|logo/i.test(topic.id);
  const transform = kind === 'transform' || kind === 'keyframes';
  const crop = kind === 'crop';
  const rotate = /rotate/i.test(topic.id);
  const flip = /flip|mirror/i.test(topic.id);
  const opacity = topic.id === 'clip-transform';
  const zoom = ['clip-picture', 'clip-all-framing', 'clip-transform', 'clip-keyframes'].includes(topic.id);
  const pictureTransform = transform && changed && !watermark ? rotate ? 'translate(210 118) rotate(90) scale(.55) translate(-210 -118)' : flip ? 'translate(420 0) scale(-1 1)' : zoom ? topic.id === 'clip-keyframes' ? 'translate(-63 -35) scale(1.3)' : 'translate(-42 -24) scale(1.2)' : undefined : undefined;
  const captionPresent = kind === 'captions' && !['captions-generate', 'captions-delete-split'].includes(topic.id) || topic.id === 'captions-generate' && changed || topic.id === 'captions-delete-split' && !changed || topic.id === 'export-no-captions' && !changed || topic.id === 'export-generate' && changed;
  const captionText = topic.id === 'captions-edit' && !changed ? 'This is an animal.' : changed && (topic.id === 'captions-language' || topic.id === 'export-generate') ? 'ఇది ఒక పులి.' : 'This is a tiger.';
  return <svg className="mx-help-demo-picture" viewBox="0 0 420 236" role="img" aria-label={`Sample lesson preview, ${topic.demoFrames?.[step]?.label || SAMPLE_FRAMES[step].label}`}>
    <defs><clipPath id={clipId}><rect x={crop && step === 2 ? 58 : 0} y={crop && step === 2 ? 22 : 0} width={crop && step === 2 ? 304 : 420} height={crop && step === 2 ? 188 : 236} rx="9" /></clipPath></defs>
    <rect width="420" height="236" rx="9" fill="#15272d" />
    <g clipPath={`url(#${clipId})`}>
      <g transform={pictureTransform} opacity={opacity && changed ? '.5' : undefined} style={topic.id === 'clip-filters' && changed ? { filter: 'grayscale(1)' } : undefined}>
        <rect width="420" height="236" fill="#b8d9e3" />
        <circle cx="332" cy="42" r="23" fill="#f8d687" />
        <path d="M0 163 92 62l92 101L264 77l112 90 44-14v83H0Z" fill="#89aca0" />
        <path d="M0 164Q84 137 168 162T420 154v82H0Z" fill="#5d956d" />
        <path d="M0 199q78-30 155-7t265-6v50H0Z" fill="#427c55" />
        <rect x="61" y="99" width="12" height="90" rx="4" fill="#765b40" />
        <circle cx="67" cy="80" r="37" fill="#397058" /><circle cx="43" cy="104" r="28" fill="#397058" /><circle cx="88" cy="108" r="29" fill="#397058" />
        <g transform="translate(234 137)">
          <path d="M42 28q48 0 50-20" fill="none" stroke="#d99b4f" strokeWidth="10" strokeLinecap="round" />
          <ellipse cx="0" cy="20" rx="51" ry="25" fill="#e8a44f" />
          <rect x="-38" y="25" width="12" height="32" rx="5" fill="#e8a44f" /><rect x="28" y="25" width="12" height="32" rx="5" fill="#e8a44f" />
          <path d="m-23 2 8 22M-2-4l8 25M17 1l8 24" stroke="#513d35" strokeWidth="6" />
          <circle cx="-48" cy="-2" r="23" fill="#efb263" /><circle cx="-62" cy="-19" r="8" fill="#513d35" /><circle cx="-33" cy="-21" r="8" fill="#513d35" />
          <ellipse cx="-48" cy="8" rx="14" ry="10" fill="#fff0cf" /><circle cx="-54" cy="-5" r="2.8" fill="#282c31" /><circle cx="-41" cy="-5" r="2.8" fill="#282c31" /><path d="m-52 4 8 0-4 5Z" fill="#513d35" />
        </g>
      </g>
    </g>
    {crop && step !== 2 && <><rect width="420" height="236" rx="9" fill="#080e18" opacity=".26" /><rect x="58" y="22" width="304" height="188" fill="none" stroke="#f7d58d" strokeWidth="2" strokeDasharray={changed ? undefined : '7 4'} />{changed && <path d="M58 42V22h20m264 0h20v20M58 190v20h20m264 0h20v-20" fill="none" stroke="#fff0cc" strokeWidth="4" />}</>}
    {transform && step === 1 && <rect x="28" y="15" width="356" height="205" rx="3" fill="none" stroke="#f7d58d" strokeWidth="1.5" strokeDasharray="5 4" />}
    {topic.id === 'clip-transition' && changed && <rect width="420" height="236" rx="9" fill="#000" opacity=".7" />}
    {captionPresent && <g>
      <rect x="100" y="188" width="220" height="33" rx="5" fill="#101319" fillOpacity=".85" />
      <text x="210" y="211" textAnchor="middle" fontSize="19" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">{captionText}</text>
    </g>}
    {title && !watermark && topic.id !== 'text-stickers' && step > 0 && <g transform={topic.id === 'text-position' && changed ? 'translate(75 -130)' : undefined}><rect x={topic.id === 'tools-chapters' ? 55 : 113} y="175" width={topic.id === 'tools-chapters' ? 310 : 194} height="39" rx="7" fill="#15222f" fillOpacity=".88" /><text x="210" y="202" textAnchor="middle" fontSize="24" fontWeight="700" fill="#fff" fontFamily="Arial, sans-serif">{topic.id === 'tools-chapters' ? 'Chapter 2: Tiger' : 'Tiger'}</text>{step === 1 && <rect x="113" y="175" width="194" height="39" rx="7" fill="none" stroke="#f7d58d" strokeDasharray="5 3" />}</g>}
    {topic.id === 'text-stickers' && step > 0 && <path d="M325 102h-55V90l-31 23 31 23v-12h55Z" fill="#ffe4a0" stroke="#765b32" strokeWidth="2" />}
    {watermark && step > 0 && <g transform={topic.id === 'tools-logo-position' && changed ? 'translate(0 171)' : undefined} opacity={changed ? '.85' : '1'}><rect x="337" y="16" width="67" height="28" rx="5" fill="#142b41" /><text x="370" y="35" fontSize="13" textAnchor="middle" fontWeight="700" fill="#fff0cc">LOGO</text>{step === 1 && <rect x="335" y="14" width="71" height="32" rx="5" fill="none" stroke="#f7d58d" strokeDasharray="4 3" />}</g>}
    {transform && !watermark && step > 0 && <g><rect x="97" y="88" width="226" height="34" rx="6" fill="#14202e" fillOpacity=".85" /><text x="210" y="110" textAnchor="middle" fontSize="13" fill="#fff0cc">{rotate ? 'Rotation: 90°' : flip ? 'Flip horizontally' : opacity ? 'Scale: 1.2× · Opacity: 0.5' : kind === 'keyframes' ? changed ? 'Scale: 1.3× at 2s' : 'Scale: 1× at 0s' : topic.id === 'clip-filters' ? 'Mono · Saturation: 0' : topic.id === 'clip-transition' ? 'Fade through black: 0.4s' : 'Fit: Fill canvas'}</text></g>}
    {kind === 'keyframes' && <><circle cx={36 + step * 173} cy="218" r="5" fill="#f7d58d" /><path d="M36 218H382" stroke="#f7d58d" strokeWidth="1" /><text x="210" y="233" textAnchor="middle" fontSize="10" fill="#fff0cc">{step === 0 ? 'Start position' : step === 1 ? 'Add a keyframe' : 'Later position'}</text></>}
    <rect x="10" y="10" width="83" height="22" rx="5" fill="#0e1820" fillOpacity=".75" /><text x="51" y="25" textAnchor="middle" fontSize="10" fontWeight="600" fill="#e5eff4">SAMPLE VIDEO</text>
  </svg>;
}

function SceneStrip({ topic, step }) {
  const splitting = /split/i.test(topic.id);
  const duplicating = /duplicat|copy/i.test(topic.id);
  const removing = /delete|remove/i.test(topic.id);
  const reordering = topic.id === 'timeline-reorder';
  let scenes = [...SAMPLE_SCENES];
  if (topic.id === 'timeline-split') scenes = step === 2 ? ['1a', '1b', 2] : [1, 2];
  else if (step === 2 && duplicating) scenes = [1, 2, '2 copy', 3];
  else if (step === 2 && removing) scenes = /ripple/i.test(topic.id) ? [1, 3] : [1, null, 3];
  else if (step === 2 && reordering) scenes = [1, 3, 2];
  const lengthOf = scene => topic.id === 'timeline-split' && scene === '1a' ? '3 s' : topic.id === 'timeline-split' && scene === '1b' ? '5 s' : topic.id === 'timeline-split' && scene === 1 ? '8 s' : topic.id === 'clip-speed' && scene === 2 ? step === 2 ? '5 s · 2×' : '10 s · 1×' : '4 s';
  return <div className="mx-help-demo-lane"><span className="mx-help-demo-lane-name">Video</span><div className={`mx-help-demo-strip ${topic.id === 'timeline-group' && step === 2 ? 'grouped' : ''}`}>{scenes.map((scene, index) => <div key={`${scene}-${index}`} className={`mx-help-demo-scene ${scene === null ? 'empty-gap' : topic.id === 'timeline-select' && step > 0 ? index > 0 ? 'selected' : '' : index === 1 ? 'selected' : ''}`} style={{ flex: topic.id === 'timeline-split' && scene === '1a' ? 3 : topic.id === 'timeline-split' && scene === '1b' ? 5 : 4 }}><small>{scene === null ? 'Empty' : 'Scene'}</small><strong>{scene === null ? 'Gap' : scene}</strong><span>{lengthOf(scene)}</span></div>)}</div></div>;
}

function Waveform({ start = 0, end = 100, tone = 'normal' }) {
  return <div className={`mx-help-demo-waveform ${tone}`} style={{ left: `${start}%`, width: `${end - start}%` }}>{Array.from({ length: Math.max(8, Math.round((end - start) / 2)) }, (_, index) => <i key={index} style={{ height: `${15 + Math.abs(Math.sin(index * 1.73) * Math.cos(index * .61)) * 66}%` }} />)}</div>;
}

function SampleFields({ fields }) {
  return <div className="mx-help-demo-fields">{fields.map(([name, value]) => <div key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>;
}

function ProjectSample({ topic, step }) {
  const clearing = ['project-new', 'project-reset', 'project-delete'].includes(topic.id);
  const tabs = topic.id === 'project-tabs';
  const saved = !clearing && !tabs && step === 2;
  return <div className="mx-help-demo-project-sample">
    <div className="mx-help-demo-project-tabs"><span className={!tabs || step < 2 ? 'active' : ''}>{topic.id === 'project-delete' ? 'Practice' : 'Wild Animals'}</span>{tabs && step > 0 && <span className={step === 2 ? 'active' : ''}>Jingle Bells</span>}</div>
    {clearing && step === 2 ? <div className="mx-help-demo-empty">＋<span>Empty sample workspace</span></div> : clearing && step === 1 ? <SampleFields fields={[['Confirm action', topic.title], ['Before continuing', 'Save work you want to keep'], ['This demonstration', 'Does not clear or delete anything']]} /> : <><SceneStrip topic={{ id: 'project-scenes' }} step={0} /><SampleFields fields={tabs ? [['Current tab', step === 2 ? 'Jingle Bells' : 'Wild Animals'], ['Editable projects', step > 0 ? '2 tabs' : '1 tab']] : [['Project file', 'Wild Animals.pattanproject'], ['Status', saved ? topic.id === 'project-autosave' ? 'Sample recovery copy saved' : 'Sample project saved' : 'Editable timeline and settings']]} /></>}
  </div>;
}

function OrganizationSample({ topic, step }) {
  const changed = step === 2;
  if (topic.id === 'project-history') return <><AudioSample topic={topic} step={step} /><SampleFields fields={[['Action', changed ? 'Undo · Ctrl+Z' : 'Remove selected audio'], ['Result', changed ? 'Original sound restored' : 'A recorded edit can be undone']]} /></>;
  if (topic.id === 'timeline-shortcuts') return <><AudioSample topic={topic} step={step} /><div className="mx-help-demo-keyboard"><kbd>I</kbd><span>Set In</span><kbd>O</kbd><span>Set Out</span><kbd>Space</kbd><span>Play / pause</span></div></>;
  if (topic.id === 'timeline-zoom') return <><div className="mx-help-demo-zoom-ruler">{(changed ? ['2.000', '2.250', '2.500', '2.750'] : ['0', '4', '8', '12']).map(value => <span key={value}>{value}s</span>)}</div><SampleFields fields={[['Zoom', changed ? 'Detailed timing view' : 'Fit entire timeline'], ['Small selection', '0.250 seconds']]} /></>;
  if (topic.id === 'timeline-locks') return <SampleFields fields={[['Video track', changed ? '🔒 Locked' : 'Unlocked'], ['Audio mix', 'Unmuted · editable'], ['Captions', 'Visible']]} />;
  if (topic.id === 'clip-organize') return <><div className={`mx-help-demo-label-card ${changed ? 'blue' : ''}`}><strong>{changed ? 'Tiger' : 'Scene 4'}</strong><span>{changed ? 'Blue color mark' : 'Scene label'}</span></div><SceneStrip topic={{ id: 'project-scenes' }} step={0} /></>;
  if (topic.id === 'media-templates') return <SampleFields fields={[['Template', changed ? 'Vertical' : 'Lesson'], ['Aspect ratio', changed ? '9:16' : '16:9'], ['Frame rate', '30 fps']]} />;
  return <><div className={`mx-help-demo-workspace ${topic.id === 'project-panels' && step === 1 ? 'library-hidden' : ''} ${topic.id === 'timeline-preview-view' && changed ? 'preview-large' : ''}`}><span>Media</span><strong>Sample preview</strong><span>Settings</span></div><SampleFields fields={topic.id === 'project-panels' ? [['Library', step === 1 ? 'Hidden' : 'Media open'], ['Reopen', 'Media edge tab']] : [['View', changed ? 'Larger / fullscreen preview' : 'Normal preview'], ['Guides', 'Optional safe placement guides']]} /></>;
}

function AudioSample({ topic, step }) {
  const gap = topic.id === 'audio-remove-range' || topic.id === 'audio-reattach';
  const range = ['audio-range-select', 'audio-remove-range', 'audio-range-preview', 'timeline-shortcuts'].includes(topic.id);
  const voice = topic.demoKind === 'voice';
  const changed = step === 2;
  const volume = ['audio-settings', 'audio-background', 'clip-sound'].includes(topic.id);
  const translate = topic.id === 'voice-translate';
  const copy = topic.id === 'audio-copy';
  const trimmed = topic.id === 'audio-split-trim' && changed;
  const silent = gap && (changed || topic.id === 'audio-reattach') || topic.id === 'project-history' && !changed;
  const moving = topic.id === 'audio-move-trim';
  const narrationLabel = voice ? translate ? changed ? 'Telugu female voice · sample' : 'English narration · sample' : topic.id === 'voice-morph' && changed ? 'Standard Male Voice · sample' : 'Original narration · sample' : topic.id === 'audio-detach' && changed ? 'Detached narration' : topic.id === 'clip-sound' ? changed ? 'Source volume: 50%' : 'Source volume: 100%' : topic.id === 'audio-background' ? 'Background music · low volume' : 'Sample audio';
  return <div className="mx-help-demo-audio-sample">
    <div className="mx-help-demo-ticks"><span>0.000 s</span><span>{copy ? '3.000 s' : '2.000 s'}</span><span>{copy || moving ? '5.000 s' : '4.000 s'}</span><span>{copy ? '8.000 s' : '6.000 s'}</span></div>
    <div className="mx-help-demo-audio-track">
      {silent ? <><Waveform end={33.333} /><div className="mx-help-demo-silent-gap" style={{ left: '33.333%', width: '33.333%' }}>Silent gap</div><Waveform start={66.667} /></> : moving ? <Waveform start={changed ? 83.333 : 50} end={changed ? 100 : 66.667} /> : trimmed ? <Waveform start={50} /> : topic.id === 'audio-import' && step === 0 ? null : <Waveform end={copy ? 37.5 : 100} tone={translate && changed ? 'translated' : 'normal'} />}
      {copy && changed && <Waveform start={62.5} tone="translated" />}
      {range && step > 0 && !(gap && changed) && <div className="mx-help-demo-audio-range" style={{ left: '33.333%', width: '33.333%' }}><span>{topic.id === 'audio-range-preview' && changed ? 'PREVIEW' : 'SELECTED'}</span></div>}
      {volume && changed && <svg viewBox="0 0 300 50" preserveAspectRatio="none" className="mx-help-demo-gain" aria-label="Sample volume envelope"><path d={topic.id === 'audio-settings' ? 'M0 45 25 14H250L300 45' : topic.id === 'audio-background' ? 'M0 42H300' : 'M0 30H300'} fill="none" stroke="#fff0cc" strokeWidth="2" /></svg>}
    </div>
    {['audio-delete', 'tools-sfx', 'audio-import'].includes(topic.id) && <div className="mx-help-demo-audio-track secondary">{topic.id === 'audio-delete' && changed ? <span className="mx-help-demo-track-note">Sound effect removed · other audio stays</span> : topic.id === 'tools-sfx' && !changed ? <span className="mx-help-demo-track-note">Caption trigger: [ding]</span> : <Waveform start={topic.id === 'tools-sfx' ? 33.333 : 83.333} end={topic.id === 'tools-sfx' ? 45 : 100} tone="translated" />}</div>}
    <div className="mx-help-demo-range-readout"><span>{range ? 'In: 2.000 s · Out: 4.000 s' : narrationLabel}</span><strong>{topic.id === 'audio-reattach' && changed ? 'Linked back to video' : gap && changed ? 'Video stays in place' : topic.id === 'voice-cancel' && changed ? 'Cancelled · original preserved' : voice && changed ? translate ? 'Same scene timing' : 'Timbre processed' : topic.id === 'audio-settings' && changed ? 'Fade in 0.5s · Fade out 1s' : moving ? changed ? 'Start: 5.000s' : 'Start: 3.000s' : trimmed ? 'Trim start: 3.000s' : copy && changed ? 'Copy: 5.000 → 8.000s' : topic.id === 'clip-cleanup' && changed ? 'Normalize enabled for export' : 'Sample track'}</strong></div>
  </div>;
}

function MediaSample({ topic, step }) {
  const project = topic.demoKind === 'project';
  const autoAll = /auto-all/i.test(topic.id);
  const removed = /remove|clear/i.test(topic.id) && step === 2;
  const sorted = autoAll && step === 2;
  const searching = topic.id === 'media-search';
  const scenes = autoAll ? sorted ? [1, 2, 3, 10] : [10, 3, 1, 2] : [1, 2, 3];
  return <div className="mx-help-demo-media-sample">
    <div className="mx-help-demo-mini-heading"><span>Sample media bin</span><strong>{searching && step > 0 ? 'Search: Scene 2' : sorted ? 'Scene order' : `${scenes.length} items`}</strong></div>
    {/import/i.test(topic.id) && step === 0 ? <div className="mx-help-demo-empty">＋<span>Choose lesson files</span></div> : <div className={`mx-help-demo-media-grid ${autoAll ? 'four' : ''}`}>{scenes.filter(scene => !(removed && scene === 2) && !(searching && step > 0 && scene !== 2)).map(scene => <div key={scene} className="mx-help-demo-media-card"><span className="mx-help-demo-media-thumb">▰<b>{scene}</b></span><strong>{topic.id === 'clip-replace' && scene === 2 && step === 2 ? 'Tiger video' : `Scene ${scene}`}</strong><small>{scene === 2 ? 'Lesson video' : 'Lesson image'}</small></div>)}</div>}
    <div className="mx-help-demo-media-result">{step === 2 ? <><span className="mx-help-demo-status-dot" />{autoAll ? 'Timeline: 1 → 2 → 3 → 10' : removed ? 'Source card removed · placed clips stay' : searching ? 'Matching source found' : topic.id === 'clip-replace' ? 'Selected scene replaced' : topic.id === 'media-add' ? 'Sample audio added at 5.000s' : 'Sample files ready in the bin'}</> : <>{autoAll ? 'Choose Auto All for scene order' : searching ? 'Search by filename' : 'Choose a source card'}</>}</div>
    {removed && <SceneStrip topic={{ id: 'placed-clips' }} step={0} />}
  </div>;
}

function SourceSample({ topic, step }) {
  if (topic.id === 'source-image-duration') return <SampleFields fields={[['Source', 'Cover image'], ['Image duration', '4.000 seconds'], ['Timeline', step === 2 ? 'Image scene · 4.000s' : 'Ready to insert']]} />;
  if (topic.id === 'source-playback') return <SampleFields fields={[['Source frame', step === 2 ? '00:00:02:01' : '00:00:02:00'], ['Frame step', '30 fps · one frame = 0.033s'], ['Preview', 'Independent source monitor']]} />;
  if (topic.id === 'clip-locate') return <SampleFields fields={[['Selected scene', 'Tiger'], ['First used source frame', '2.000s'], ['Source monitor', step === 2 ? 'At 2.000s' : 'Open original source']]} />;
  const clipTrim = topic.id === 'clip-timing';
  return <div className="mx-help-demo-source-sample">
    <div className="mx-help-demo-ticks"><span>0 s</span><span>2 s</span><span>{clipTrim ? '7 s' : '6 s'}</span><span>8 s</span></div>
    <div className="mx-help-demo-source-bar"><span className={step > 0 ? 'dimmed' : ''} style={{ width: '25%' }} /><span className="kept" style={{ width: clipTrim ? '62.5%' : '50%' }}>Use this range</span><span className={step > 0 ? 'dimmed' : ''} style={{ width: clipTrim ? '12.5%' : '25%' }} /></div>
    <div className="mx-help-demo-range-readout"><span>{clipTrim ? 'Start: 2.000s · Duration: 5.000s' : 'In: 2.000s · Out: 6.000s'}</span><strong>{step === 2 ? clipTrim ? 'Source portion: 2 → 7s' : 'Timeline clip: 4.000s' : clipTrim ? 'Adjust scene Timing' : 'Mark source In / Out'}</strong></div>
  </div>;
}

function CaptionSample({ topic, step }) {
  const changed = step === 2;
  const translated = topic.id === 'captions-language';
  if (topic.id === 'captions-engine') return <SampleFields fields={[['Caption engine', step === 0 ? 'Local Whisper · offline' : 'Groq · cloud transcription'], ['Service', step === 0 ? 'Installed local model' : 'Configured Groq service'], ['Next action', 'Generate, then review captions']]} />;
  if (topic.id === 'captions-burn') return <SampleFields fields={[['Permanent captions', step === 0 ? 'Choose export version' : 'Enabled for captioned version'], ['Version 1', 'Wild Animals.mp4 · with captions'], ['Version 2', 'Wild Animals clean.mp4 · without captions']]} />;
  if (topic.id === 'captions-cancel') return <SampleFields fields={[['Job', changed ? 'Cancelled in this sample' : 'Generating captions'], ['Previous captions', 'Preserved'], ['Next', 'Review, adjust and retry when ready']]} />;
  if (topic.id === 'captions-delete-split' && changed) return <div className="mx-help-demo-caption-track"><span>Caption</span><small>Unwanted sample caption removed</small></div>;
  if (topic.id === 'captions-generate' && !changed) return <SampleFields fields={[['Engine', 'Selected caption engine'], ['Language', 'Same as spoken video'], ['Job', step === 0 ? 'Ready to generate' : 'Transcribing sample narration']]} />;
  const detail = topic.id === 'captions-style' ? 'Black box · Bottom · Arial 42' : topic.id === 'captions-advanced' ? 'Arial · Bold white · Width 100% · Height 100%' : topic.id === 'captions-wrap' ? 'Line length adjusted for the canvas' : topic.id === 'captions-sample' ? 'Sample styling · no transcription needed' : changed ? 'Caption and speech share timing' : 'Sample timed caption';
  return <div className="mx-help-demo-caption-sample">
    <>
      <div className="mx-help-demo-caption-cue"><span>{topic.id === 'captions-edit' && !changed ? '01.000' : '02.000'} → 04.000</span><strong>{translated && changed ? 'ఇది ఒక పులి.' : topic.id === 'captions-edit' && !changed ? 'This is an animal.' : topic.id === 'captions-wrap' && changed ? <>This is a tiger.<br />It is a wild animal.</> : 'This is a tiger.'}</strong></div>
      <div className="mx-help-demo-caption-track"><span>Caption</span><div>{translated && changed ? 'Telugu' : '2.000 s'}</div><small>{detail}</small></div>
    </>
  </div>;
}

function ExportSample({ topic, step }) {
  if (['export-settings', 'export-quality', 'export-presets'].includes(topic.id)) {
    const changed = step === 2;
    const vertical = ['export-settings', 'export-presets'].includes(topic.id) && changed;
    return <><div className={`mx-help-demo-canvas-shape ${vertical ? 'vertical' : ''}`}>Sample canvas<br /><span>{vertical ? '9:16' : '16:9'}</span></div><SampleFields fields={[['Canvas', vertical ? 'Vertical · 1080 × 1920' : 'Full HD · 1920 × 1080'], ['Frame rate', '30 fps'], ['Quality', 'Balanced'], ...(topic.id === 'export-presets' ? [['Preset', changed ? 'Shorts' : 'Choose a preset']] : [])]} /><small className="mx-help-demo-export-note">Settings example. No export is started.</small></>;
  }
  const progress = step === 0 ? 0 : step === 1 ? 58 : 100;
  const filename = topic.id === 'export-no-captions' ? 'Wild Animals clean.mp4' : 'Wild Animals.mp4';
  const warning = topic.id === 'export-progress' && step === 2;
  const result = topic.id === 'export-result';
  return <div className="mx-help-demo-export-sample">
    <div className="mx-help-demo-export-file"><span>▰</span><div><strong>{filename}</strong><small>1920 × 1080 · 30 fps · H.264</small></div><b>{warning ? '!' : step === 2 || result ? '✓' : 'MP4'}</b></div>
    <div className="mx-help-demo-export-progress" role="progressbar" aria-label="Simulated export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={warning ? 58 : result ? 100 : progress}><span style={{ width: `${warning ? 58 : result ? 100 : progress}%` }} /></div>
    <div className="mx-help-demo-range-readout"><span>{warning ? 'Sample warning: source file needs attention' : result ? step === 0 ? 'Video ready' : step === 1 ? 'Play video and inspect the result' : 'Open its saved folder' : step === 0 ? 'Choose settings and a destination' : step === 1 ? 'Simulated export' : topic.id === 'export-shutdown' ? 'Sample shutdown countdown: 30 seconds' : 'Sample export complete'}</span><strong>{warning ? 'Read Details' : result ? 'Result review' : `${progress}%`}</strong></div>
    <small className="mx-help-demo-export-note">Illustration only. No file is generated.</small>
  </div>;
}

function DemoStage({ topic, step }) {
  const kind = topic.demoKind || 'timeline';
  if (kind === 'export') return <>{['export-no-captions', 'export-generate'].includes(topic.id) && <LessonPicture topic={topic} step={step} />}<ExportSample topic={topic} step={step} /></>;
  if (kind === 'project') return <ProjectSample topic={topic} step={step} />;
  if (kind === 'organization') return <OrganizationSample topic={topic} step={step} />;
  if (kind === 'media') return <MediaSample topic={topic} step={step} />;
  return <>
    <LessonPicture topic={topic} step={step} />
    {kind === 'source' ? <SourceSample topic={topic} step={step} /> : ['audio', 'audio-gap', 'voice'].includes(kind) ? <AudioSample topic={topic} step={step} /> : kind === 'captions' ? <CaptionSample topic={topic} step={step} /> : <SceneStrip topic={topic} step={step} />}
    {kind === 'voice' && <div className="mx-help-demo-voice-line"><span>{topic.id === 'voice-translate' && step === 2 ? 'ఇది ఒక పులి.' : 'This is a tiger.'}</span><small>{topic.id === 'voice-translate' && step === 2 ? 'Translated sample narration' : topic.id === 'voice-morph' && step === 2 ? 'Same words · changed timbre' : topic.id === 'voice-cancel' && step === 2 ? 'Original sample preserved' : 'Original sample narration'}</small></div>}
    {kind === 'crop' && <div className="mx-help-demo-range-readout"><span>{step === 0 ? 'Full sample frame' : step === 1 ? 'Adjust crop bounds' : 'Cropped sample preview'}</span><strong>{step === 2 ? 'Apply crop' : '16:9'}</strong></div>}
    {kind === 'title' && step > 0 && !/logo/.test(topic.id) && <div className="mx-help-demo-title-track"><span>{topic.id === 'text-stickers' ? 'Sticker' : 'Title'}</span><strong>{topic.id === 'tools-chapters' ? 'Chapter 2: Tiger' : topic.id === 'text-stickers' ? 'Arrow' : 'Tiger'}</strong><small>0.000 → 4.000 s</small></div>}
    {topic.id === 'tools-logo-position' && <SampleFields fields={[['Quick position', step === 2 ? 'Bottom right' : 'Top right'], ['Logo size', '16%'], ['Opacity', '85%']]} />}
    {topic.id === 'tools-crop-parts' && <SampleFields fields={[['Part 1', '0.000 → 30.000 seconds'], ['Part 2', '30.000 → 60.000 seconds'], ['Save', 'Both parts use the chosen crop']]} />}
    {['timeline-playhead', 'timeline-snap', 'timeline-markers'].includes(topic.id) && <div className="mx-help-demo-timeline-ruler"><span>0s</span><span>{topic.id === 'timeline-playhead' ? '3s' : '4s'}</span><span>8s</span><i style={{ left: step === 2 ? topic.id === 'timeline-playhead' ? '25%' : '33.333%' : '4%' }}>{topic.id === 'timeline-markers' && step === 2 ? '◆ Marker' : 'Playhead'}</i></div>}
    {topic.id === 'timeline-delete' && <SampleFields fields={[['Ripple', 'Off'], ['After Delete', 'Later scenes remain in place']]} />}
    {topic.id === 'timeline-group' && <SampleFields fields={[['Grouped scenes', step === 2 ? 'Scenes 2 and 3' : 'Choose adjacent scenes'], ['Media files', 'Separate editable clips']]} />}
    {topic.id === 'tools-stutters' && <SampleFields fields={[['Suggestion', step === 2 ? 'Unwanted “um” cut after review' : 'Listen to suspected “um”'], ['Time after cut', 'Later material moves earlier']]} />}
  </>;
}

/** An isolated sample: local frame state only; never reads or edits the project. */
export default function HelpDemo({ topic }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const frames = topic?.demoFrames?.length ? topic.demoFrames : SAMPLE_FRAMES;
  const lastStep = frames.length - 1;
  const currentStep = Math.min(step, lastStep);
  const frame = frames[currentStep];

  useEffect(() => { setStep(0); setPlaying(false); }, [topic?.id]);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const update = () => { setReducedMotion(query.matches); if (query.matches) setPlaying(false); };
    update(); query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  useEffect(() => {
    if (!playing || reducedMotion) return undefined;
    if (step >= lastStep) { setPlaying(false); return undefined; }
    const timer = window.setTimeout(() => setStep(value => Math.min(lastStep, value + 1)), 2200);
    return () => window.clearTimeout(timer);
  }, [playing, reducedMotion, step, lastStep]);

  if (!topic) return null;
  const move = next => { setPlaying(false); setStep(Math.max(0, Math.min(lastStep, next))); };
  const togglePlay = () => { if (!playing && currentStep === lastStep) setStep(0); setPlaying(value => !value); };
  const containEditorKeys = event => { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation(); };
  return <section className="mx-help-demo" data-testid="exporter-help-demo" data-demo-kind={topic.demoKind} data-demo-step={currentStep} aria-label={`${topic.title} sample demonstration`} onKeyDown={containEditorKeys} onKeyUp={containEditorKeys}>
    <div className="mx-help-demo-heading"><strong>Try the demo</strong><span>Demo only</span></div>
    <div className="mx-help-demo-stage"><DemoStage topic={topic} step={currentStep} /></div>
    <div className="mx-help-demo-frame" aria-live="polite" aria-atomic="true"><span>{currentStep + 1} / {frames.length}</span><div><strong>{frame.label}</strong><p>{frame.note}</p></div></div>
    <div className="mx-help-demo-controls" role="group" aria-label="Sample demo controls">
      <button type="button" onClick={() => move(0)} aria-label="Replay demo" title="Replay demo">↺ Replay</button>
      <div><button type="button" onClick={() => move(currentStep - 1)} disabled={currentStep === 0} aria-label="Previous demo step" title="Previous demo step">← Previous</button><button type="button" onClick={() => move(currentStep + 1)} disabled={currentStep === lastStep} aria-label="Next demo step" title="Next demo step">Next →</button></div>
      {!reducedMotion && <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause demo' : 'Play demo'} title={playing ? 'Pause demo' : 'Play demo'} aria-pressed={playing}>{playing ? 'Ⅱ Pause' : '▶ Play'}</button>}
    </div>
  </section>;
}
