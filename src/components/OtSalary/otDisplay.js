// Calendar durations use minutes, never rounded decimal hours.
export function formatOtClock(minutes) {
  const raw = Number(minutes);
  const total = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
