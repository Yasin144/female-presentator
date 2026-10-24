const DEFAULT_LIMIT = 24;

export function visitView(history, view, limit = DEFAULT_LIMIT) {
  const entries = Array.isArray(history) ? history.filter((item) => typeof item === 'string' && item) : [];
  if (typeof view !== 'string' || !view || entries[entries.length - 1] === view) return entries;
  const boundedLimit = Math.max(2, Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_LIMIT);
  return [...entries, view].slice(-boundedLimit);
}

export function previousView(history) {
  const entries = Array.isArray(history) ? history : [];
  if (entries.length < 2) return { type: 'root', history: entries, view: entries[0] || '' };
  const remaining = entries.slice(0, -1);
  return { type: 'view', history: remaining, view: remaining[remaining.length - 1] };
}

export function resolveBackAction(history, openOverlays = []) {
  const overlay = openOverlays.find(Boolean);
  if (overlay) return { type: 'overlay', overlay, history };
  return previousView(history);
}

// One consumed browser guard is re-armed only for an in-app step. It never grows
// the browser stack on ordinary renders or forces a route at the app root.
export function shouldRearmBrowserGuard(result) {
  return result === 'handled';
}

export function expenseViewKey(tab, insight = 'Overview') {
  return tab === 'insights' ? `insights:${insight}` : tab;
}

export function expenseViewFromKey(key) {
  if (String(key || '').startsWith('insights:')) {
    return { tab: 'insights', insight: String(key).slice('insights:'.length) || 'Overview' };
  }
  return { tab: key || 'overview', insight: 'Overview' };
}
