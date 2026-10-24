export function transactionIsIncoming(tx) {
  return tx?.type === 'credit' || tx?.type === 'refund';
}

export function transactionMemory(tx) {
  return String(tx?.personalNote || tx?.note || '').trim();
}

export function transactionPerson(tx) {
  return String(tx?.merchant || '').trim() || (transactionIsIncoming(tx) ? 'Unknown sender' : 'Unknown recipient');
}

export function transactionInitials(tx) {
  return transactionPerson(tx).split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase();
}

// A snapshot is only a reading order; the authoritative records always come from the ledger.
// New IDs wait for an explicit reveal, so incoming captures cannot move the row being read.
export function reconcileTransactionReadingOrder(snapshot, transactions, filterKey) {
  const ids = [...new Set(transactions.map(tx => String(tx.id)))];
  if (!snapshot || snapshot.filterKey !== filterKey) return { filterKey, ids };
  // An empty ledger is already reconciled. Preserve its reference so the
  // layout effect does not schedule another render on every empty pass.
  if (snapshot.ids.length === 0) return ids.length === 0 ? snapshot : { filterKey, ids };
  const available = new Set(ids);
  const retained = snapshot.ids.filter(id => available.has(id));
  return retained.length === snapshot.ids.length ? snapshot : { filterKey, ids: retained };
}

export function transactionReadingView(snapshot, transactions) {
  const map = new Map(transactions.map(tx => [String(tx.id), tx]));
  const shown = new Set(snapshot.ids);
  return {
    rows: snapshot.ids.map(id => map.get(id)).filter(Boolean),
    pendingCount: [...map.keys()].filter(id => !shown.has(id)).length,
  };
}

export function recordedBalance(tx) {
  for (const value of [tx?.runningBalance, tx?.accountBalance]) {
    if ((typeof value === 'number' || typeof value === 'string' && value.trim()) && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

export function saveTransactionMemoryRecord(tx, merchant, note, nowMs = Date.now()) {
  const clean = String(note || '').trim();
  return {
    ...tx,
    merchant: String(merchant || '').trim() || tx.merchant,
    personalNote: clean,
    note: clean,
    noteReviewed: Boolean(clean),
    updatedAt: new Date(nowMs).toISOString(),
    updatedAtMs: nowMs,
  };
}
