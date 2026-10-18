import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sourceMediaUrl } from './SourceMonitor';
import { getSceneNumber, sortMediaBySceneNumber } from './editor-media.mjs';
import { HelpHint } from './HelpGuide';

const FILTERS = [
  { id: 'natural', name: 'Natural', detail: 'Clean, balanced studio colour', badge: 'LUT 01' },
  { id: 'vivid', name: 'Vivid', detail: 'Rich colour and punchy contrast', badge: 'LUT 02' },
  { id: 'cinematic', name: 'Cinematic', detail: 'Soft, muted anamorphic film tones', badge: 'LUT 03' },
  { id: 'soft', name: 'Soft', detail: 'Gentle highlight roll-off', badge: 'LUT 04' },
  { id: 'mono', name: 'Mono', detail: 'Classic black and white silver', badge: 'B&W' },
  { id: 'cyberpunk', name: 'Cyberpunk', detail: 'High-saturation neon cyan & magenta', badge: 'NEON' },
  { id: 'warm', name: 'Golden Hour', detail: 'Warm sunset amber film grade', badge: 'WARM' },
  { id: 'cool', name: 'Arctic Cool', detail: 'Crisp blue-teal cinema atmosphere', badge: 'COOL' },
  { id: 'vintage', name: 'Vintage 70s', detail: 'Faded retro Kodak stock look', badge: 'RETRO' },
  { id: 'noir', name: 'Noir Contrast', detail: 'Deep shadow dramatic monochrome', badge: 'NOIR' },
];
const TRANSITIONS = [
  { id: 'none', name: 'Cut', detail: 'Direct instant cut between clips', duration: '0.0s' },
  { id: 'fade-black', name: 'Fade to black', detail: 'Smooth dip out and fade in', duration: '0.4s' },
  { id: 'fast-dip', name: 'Fast Dip', detail: 'Quick 0.2s studio dip transition', duration: '0.2s' },
  { id: 'dissolve', name: 'Smooth Dissolve', detail: 'Gentle 0.6s theatrical transition', duration: '0.6s' },
  { id: 'cinema-fade', name: 'Cinema Fade', detail: 'Dramatic 1.0s feature film fade', duration: '1.0s' },
  { id: 'slow-fade', name: 'Slow Fade', detail: 'Long 1.4s chapter closing fade', duration: '1.4s' },
];
const TITLES = [
  { id: 'title', name: 'Title', detail: 'A clear opening title', example: 'Your title' },
  { id: 'lower-third', name: 'Lower third', detail: 'A name or short description', example: 'Name / description' },
  { id: 'chapter', name: 'Chapter', detail: 'Introduce the next section', example: '01  New chapter' },
  { id: 'quote', name: 'Quote', detail: 'Highlight a key sentence', example: '“A thought to remember”' },
  { id: 'opener', name: 'Cinematic Opener', detail: 'Bold widescreen hero headline', example: 'HERO OPENER' },
  { id: 'neon', name: 'Neon Cyber', detail: 'Glowing Filmora 15 cyan title', example: 'NEON STUDIO' },
  { id: 'callout', name: 'Callout Pill', detail: 'Rounded highlight badge overlay', example: 'KEY POINT' },
  { id: 'news', name: 'Breaking Banner', detail: 'Broadcast ticker headline bar', example: 'BREAKING NEWS' },
];
const STICKERS = [
  { id: 'star', name: 'Star', detail: 'Highlight a moment', symbol: '★' },
  { id: 'check', name: 'Check', detail: 'Mark an answer', symbol: '✓' },
  { id: 'arrow', name: 'Arrow', detail: 'Point to a detail', symbol: '➜' },
  { id: 'heart', name: 'Heart', detail: 'Add a little warmth', symbol: '♥' },
  { id: 'fire', name: 'Fire', detail: 'Trending viral highlight', symbol: '🔥' },
  { id: 'sparkle', name: 'Sparkle', detail: 'Magic AI accent badge', symbol: '✨' },
  { id: 'bolt', name: 'Lightning', detail: 'High-energy impact marker', symbol: '⚡' },
  { id: 'crown', name: 'Crown', detail: 'Top featured moment', symbol: '👑' },
];
const TEMPLATES = [
  { id: 'lesson', name: 'Lesson', detail: 'Landscape lesson settings', ratio: '16:9' },
  { id: 'vertical', name: 'Vertical', detail: 'Portrait video settings', ratio: '9:16' },
  { id: 'slideshow', name: 'Slideshow', detail: 'Settings for an image sequence', ratio: '16:9' },
  { id: 'youtube4k', name: 'YouTube 4K', detail: 'Ultra HD 3840×2160 widescreen', ratio: '4K 16:9' },
  { id: 'square', name: 'Social Square', detail: '1080×1080 square feed post', ratio: '1:1' },
  { id: 'cinema24', name: 'Cinema 24fps', detail: '24fps theatrical film cadence', ratio: '24fps' },
];

const durationLabel = value => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};

function AssetThumbnail({ asset }) {
  const container = useRef(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);
  const url = sourceMediaUrl(asset.path || asset.url);
  const kind = asset.kind || 'video';
  useEffect(() => setFailed(false), [asset.path, asset.url]);
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '100px' });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={container} className={`mx-asset-thumbnail is-${kind}`}>
    <span className="mx-asset-kind-symbol" aria-hidden="true">{kind === 'image' ? '▧' : kind === 'audio' ? '♫' : '▶'}</span>
    {visible && !failed && url && (kind === 'image' ? <img src={url} loading="eager" decoding="sync" alt="" onError={() => setFailed(true)} />
      : kind === 'video' ? <video src={url} muted playsInline preload="metadata" disablePictureInPicture onLoadedData={event => {
        // Metadata preload can leave a paused video without a painted frame.
        // Seek once after decoding while keeping every thumbnail paused.
        const video = event.currentTarget;
        if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(.1, video.duration / 2);
      }} onError={() => setFailed(true)} /> : null)}
    {durationLabel(asset.duration) && <small className="mx-asset-duration">{durationLabel(asset.duration)}</small>}
    <span className="mx-asset-kind-tag">{kind}</span>
  </span>;
}

export default function EditorAssetBrowser({ tab = 'Media', assets = [], onImport, onImportAudio, onPreview, onAdd, onAddAll, onRemove,
  onApplyFilter, onApplyTransition, onAddTitle, onAddSticker, onApplyTemplate, disabled = false, autoAddDisabled = false, onHelp }) {
  const [query, setQuery] = useState('');
  const [mediaType, setMediaType] = useState('all');
  const [viewMode, setViewMode] = useState('grid');
  useEffect(() => { setQuery(''); setMediaType('all'); }, [tab]);
  const search = query.trim().toLocaleLowerCase();
  const isMedia = tab === 'Media' || tab === 'Audio';
  const filteredAssets = useMemo(() => sortMediaBySceneNumber(assets).filter(asset => {
    const kind = asset.kind || 'video';
    return (tab !== 'Audio' || kind === 'audio') && (tab !== 'Media' || kind !== 'audio')
      && (mediaType === 'all' || mediaType === kind)
      && (!search || `${asset.name || ''} ${kind}`.toLocaleLowerCase().includes(search));
  }), [assets, tab, mediaType, search]);
  const preset = ({ Filters: [FILTERS, onApplyFilter], Transitions: [TRANSITIONS, onApplyTransition],
    Titles: [TITLES, onAddTitle], Stickers: [STICKERS, onAddSticker], Templates: [TEMPLATES, onApplyTemplate] })[tab];
  const presets = (preset?.[0] || []).filter(item => !search || `${item.name} ${item.detail}`.toLocaleLowerCase().includes(search));
  const importAction = tab === 'Audio' ? onImportAudio : onImport;
  const actionLabel = tab === 'Filters' || tab === 'Transitions' || tab === 'Templates' ? 'Apply' : 'Add';

  return <section className={`mx-asset-browser mx-view-${viewMode}`} aria-label={`${tab} library`}>
    <header className="mx-asset-browser-heading"><h2>{tab === 'Media' ? 'Project media' : tab}</h2>
      <HelpHint label={`${tab} library`} topic={({ Audio: 'audio', Titles: 'text', Filters: 'clip-filters', Transitions: 'clip-transition', Stickers: 'text-stickers', Templates: 'media-templates' })[tab] || 'media'} onHelp={onHelp} />
      {isMedia && typeof importAction === 'function' && <button type="button" className="mx-asset-import" disabled={disabled} onClick={importAction}>+ Import</button>}</header>
    <div className="mx-asset-search"><span aria-hidden="true">⌕</span><input type="search" aria-label={`Search ${tab.toLowerCase()}`} placeholder={`Search ${tab.toLowerCase()}`} value={query} onChange={event => setQuery(event.target.value)} />
      {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear library search">×</button>}</div>
    {tab === 'Media' && <div className="mx-asset-type-filter" aria-label="Filter media type">{[['all', 'All'], ['video', 'Videos'], ['image', 'Images']].map(([id, label]) =>
      <button type="button" key={id} className={mediaType === id ? 'active' : ''} aria-pressed={mediaType === id} onClick={() => setMediaType(id)}>{label}</button>)}</div>}
    {tab === 'Media' && typeof onAddAll === 'function' && <div className="mx-auto-all-scenes"><button type="button" className="mx-auto-all-add" onClick={onAddAll} disabled={disabled || autoAddDisabled || !assets.some(asset => asset.kind === 'video' || asset.kind === 'image')} title="Add all imported videos and images to the timeline in scene-number order">Add Auto All</button><small>All media · Scene 1 → 2 → 3…</small></div>}
    <div className="mx-asset-count" aria-live="polite">
      <span>{isMedia ? `${filteredAssets.length} ${filteredAssets.length === 1 ? 'item' : 'items'}` : `${presets.length} presets`}</span>
      {isMedia && <span className="mx-f15-view-toggle" role="group" aria-label="Library view mode">
        <i className={viewMode === 'grid' ? 'active' : ''} title="Grid view" onClick={() => setViewMode('grid')}>⊞</i>
        <i className={viewMode === 'list' ? 'active' : ''} title="Compact list view" onClick={() => setViewMode('list')}>☰</i>
      </span>}
    </div>
    {isMedia ? filteredAssets.length ? <div className="mx-asset-grid">{filteredAssets.map((asset, index) => <article className="mx-asset-card" key={asset.id || `${asset.path}-${index}`}>
      <button type="button" className="mx-asset-preview-target" onClick={() => onPreview?.(asset)} disabled={disabled || typeof onPreview !== 'function'} aria-label={`Preview ${asset.name || 'media'}`} title={`Preview ${asset.name || 'media'}`}><AssetThumbnail asset={asset} /></button>
      <div className="mx-asset-card-heading"><strong title={asset.name}>{asset.name || 'Untitled media'}</strong>
        {tab === 'Media' && getSceneNumber(asset) !== null && <span className="mx-asset-scene-number" title={`Scene ${getSceneNumber(asset)}`}>#{getSceneNumber(asset)}</span>}
        {typeof onRemove === 'function' && <button type="button" className="mx-asset-remove" onClick={() => onRemove(asset)} disabled={disabled} aria-label={`Remove ${asset.name || 'media'} from library`} title="Remove from library; placed clips stay on the timeline">×</button>}</div>
      <div className="mx-asset-card-actions"><button type="button" onClick={() => onPreview?.(asset)} disabled={disabled || typeof onPreview !== 'function'}>Preview</button>
        <button type="button" className="mx-asset-add" onClick={() => onAdd?.(asset)} disabled={disabled || typeof onAdd !== 'function'} aria-label={`Add ${asset.name || 'media'} to timeline`}>+ Add</button></div>
    </article>)}</div> : <div className="mx-asset-empty"><span aria-hidden="true">{search ? '⌕' : tab === 'Audio' ? '♫' : '▧'}</span><strong>{search || mediaType !== 'all' ? 'No matching media' : tab === 'Audio' ? 'Bring in your sound' : 'Start with your media'}</strong>
      <p>{search || mediaType !== 'all' ? 'Try another search or media type.' : tab === 'Audio' ? 'Import voice, music or sound effects from this computer.' : 'Import videos or images from this computer, then preview or add them.'}</p>
      {!search && mediaType === 'all' && typeof importAction === 'function' && <button type="button" className="mx-asset-import" disabled={disabled} onClick={importAction}>Import {tab === 'Audio' ? 'audio' : 'media'}</button>}</div>
      : <><p className="mx-asset-preset-note">{tab === 'Templates' ? 'Change project settings while keeping your clips and edits.' : tab === 'Transitions' ? 'Choose how the selected clip changes into the next.' : tab === 'Filters' ? 'Apply a Filmora 15 LUT or look to the selected video or image.' : 'Add an overlay at the timeline playhead.'}</p>
        <div className={`mx-preset-grid is-${tab.toLowerCase()}`}>{typeof preset?.[1] === 'function' && presets.map(item => <button type="button" key={item.id} className={`mx-preset-card preset-${item.id}`} disabled={disabled} onClick={() => preset[1](item.id)} aria-label={`${actionLabel} ${item.name}`}>
          <span className="mx-preset-art" aria-hidden="true">{tab === 'Filters' ? <><i /><b />{item.badge && <em className="mx-preset-badge">{item.badge}</em>}</> : tab === 'Transitions' ? <><i /><b />{item.duration && <em className="mx-preset-badge">{item.duration}</em>}</> : tab === 'Titles' ? <span>{item.example}</span> : tab === 'Stickers' ? item.symbol : <span>{item.ratio}</span>}</span>
          <strong>{item.name}</strong><small>{item.detail}</small><span className="mx-preset-action">{actionLabel} <span aria-hidden="true">+</span></span>
        </button>)}</div>
        {!presets.length && <p className="mx-asset-no-results">No matching presets. Try another search.</p>}</>}
  </section>;
}
