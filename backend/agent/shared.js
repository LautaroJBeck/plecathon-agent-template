/**
 * Helpers both builds share (docs/prd, section 3.3). Frozen: change only with
 * both people's agreement.
 */

/** Merge listing objects into session.state.seen (detail fields win over search-hit fields).
 *  With { asResults: true } also set session.state.lastResults to their ids, in order. */
export function registerListings(session, listings, { asResults = false } = {}) {
  const s = session.state;
  s.seen ??= {};
  for (const l of listings ?? []) if (l?.id) s.seen[l.id] = { ...s.seen[l.id], ...l };
  if (asResults) s.lastResults = (listings ?? []).filter((l) => l?.id).map((l) => l.id);
}

/** 181500 -> "$1,815.00" */
export function formatCents(cents) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
