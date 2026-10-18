import React, { useEffect, useMemo, useRef, useState } from 'react';
import { HELP_CATEGORIES, HELP_TOPICS } from './editor-help.mjs';
import HelpDemo from './HelpDemo';
import './exporter-help.css';

export function HelpHint({ label, topic, onHelp }) {
  if (!onHelp) return null;
  return <button type="button" className="mx-help-hint" title={`How to use ${label}`} aria-label={`How to use ${label}`} onClick={event => { event.preventDefault(); event.stopPropagation(); onHelp(topic); }}>? <span>How to use</span></button>;
}

export default function HelpGuide({ topicId, onClose, onLocate }) {
  const initial = HELP_TOPICS.find(topic => topic.id === topicId) || HELP_TOPICS[0];
  const dialog = useRef(null), search = useRef(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(initial?.category || 'all');
  const [selectedId, setSelectedId] = useState(initial?.id);
  const detail = useRef(null);
  const filtered = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return HELP_TOPICS.filter(topic => {
      if (category !== 'all' && topic.category !== category) return false;
      const text = [topic.title, topic.summary, topic.location, topic.example, ...(topic.steps || [])].join(' ').toLocaleLowerCase();
      return words.every(word => text.includes(word));
    });
  }, [query, category]);
  const selected = filtered.find(topic => topic.id === selectedId) || filtered[0];
  useEffect(() => {
    const trigger = document.activeElement;
    const modal = dialog.current;
    modal?.showModal(); search.current?.focus();
    return () => {
      modal?.close();
      if (trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus();
      else document.querySelector('[aria-label="Help & Demos"]')?.focus();
    };
  }, []);
  useEffect(() => { detail.current?.scrollTo({ top: 0 }); }, [selected?.id]);
  const chooseCategory = id => { setCategory(id); setQuery(''); setSelectedId(HELP_TOPICS.find(topic => id === 'all' || topic.category === id)?.id); };
  const containFocus = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...event.currentTarget.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
    if (!focusable.length) return;
    const index = focusable.indexOf(document.activeElement);
    const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length;
    event.preventDefault(); event.stopPropagation(); focusable[next].focus();
  };
  return <dialog ref={dialog} className="mx-help-guide" data-exporter-help role="dialog" aria-modal="true" aria-label="My Exporter help and demos"
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDownCapture={containFocus} onKeyDown={event => event.stopPropagation()}
    onPointerDown={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <header className="mx-help-guide-header">
      <div><span className="mx-help-eyebrow">MY EXPORTER</span><h2>Help & Demos</h2><p>Find a feature, read the steps, and try its example.</p></div>
      <button type="button" aria-label="Close My Exporter help" onClick={onClose}>Close ×</button>
    </header>
    <div className="mx-help-guide-search"><label htmlFor="mx-help-search">Find a feature</label><input ref={search} id="mx-help-search" aria-label="Search My Exporter help" type="search" placeholder="Try: audio gap, Telugu captions, keyframes…" value={query} onChange={event => { setQuery(event.target.value); setCategory('all'); }} /><span>{filtered.length} topics</span></div>
    <nav className="mx-help-categories" aria-label="Help categories">
      {[{ id: 'all', title: 'All features' }, ...HELP_CATEGORIES].map(item => <button type="button" key={item.id} data-help-category={item.id} aria-pressed={category === item.id} className={category === item.id ? 'active' : ''} onClick={() => chooseCategory(item.id)}>{item.title}</button>)}
    </nav>
    <div className="mx-help-guide-body">
      <nav className="mx-help-topic-list" aria-label="Help topics">
        {filtered.map(topic => <button type="button" key={topic.id} data-help-topic={topic.id} aria-current={selected?.id === topic.id ? 'true' : undefined} className={selected?.id === topic.id ? 'active' : ''} onClick={() => setSelectedId(topic.id)}><strong>{topic.title}</strong><span>{topic.summary}</span></button>)}
        {!filtered.length && <div className="mx-help-empty"><strong>No matching feature</strong><p>Try a shorter phrase, such as “voice” or “crop”.</p><button type="button" onClick={() => chooseCategory('all')}>Show all features</button></div>}
      </nav>
      <article ref={detail} className="mx-help-detail" data-help-active-topic={selected?.id}>
        {selected ? <>
          <div className="mx-help-topic-heading"><span className="mx-help-eyebrow">{HELP_CATEGORIES.find(item => item.id === selected.category)?.title}</span><h3>{selected.title}</h3><p>{selected.summary}</p><div className="mx-help-location"><span>Where: {selected.location}</span>{selected.target && <button type="button" onClick={() => onLocate?.(selected)}>Show controls</button>}</div></div>
          <ol className="mx-help-steps">{selected.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
          <HelpDemo key={selected.id} topic={selected} />
        </> : <div className="mx-help-empty">Select a feature to see its instructions and demo.</div>}
      </article>
    </div>
    <footer className="mx-help-guide-footer">Practice examples use sample scenes. Your project and files stay as they are.</footer>
  </dialog>;
}
