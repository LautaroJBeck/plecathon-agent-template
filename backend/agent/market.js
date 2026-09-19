/**
 * Market insights for people opening or running a venue (PRD B7): prices,
 * capacity, policies and top-rated competitors among comparable listings in
 * PLEC's catalogue. Catalogue data only, never the wider market.
 */

import { formatCents, registerListings } from './shared.js';
import { compactHit, filterCatalogue } from './extras.js';

const UNITS = { hourly: '/hour', perGuest: ' per guest', flat: ' flat' };
const TOP_AMENITIES = 6;
const COMPETITORS = 8;

/** Tool body for market_insights. Every figure comes pre-formatted for the model to quote. */
export function marketInsights(args, session) {
  const comps = filterCatalogue({
    city: args.city,
    kind: args.kind ?? 'venue',
    category: args.category,
    neighborhood: args.neighborhood,
    guests: args.guests,
  });
  const out = { basis: `PLEC catalogue, ${comps.length} comparable listings`, count: comps.length };
  if (comps.length < 3) out.note = 'Few comparables; widen the category or city.';
  if (!comps.length) return out;

  out.pricing = {};
  for (const [model, unit] of Object.entries(UNITS)) {
    const group = comps.filter((l) => l.pricing?.model === model);
    if (!group.length) continue;
    const stats = { n: group.length, ...spread(group.map((l) => l.pricing.rateCents), unit) };
    if (model === 'hourly') {
      stats.typicalMinHours = median(group.map((l) => l.pricing.minHours).filter(Number.isFinite));
      stats.peakShare = pct(group.filter((l) => l.pricing.peak).length, group.length);
    }
    out.pricing[model] = stats;
  }
  const fees = comps.map((l) => l.pricing?.cleaningFeeCents).filter(Number.isFinite);
  out.cleaningFee = fees.length ? { n: fees.length, medianCents: median(fees), median: formatCents(median(fees)) } : { n: 0 };
  const caps = comps.map((l) => l.capacity).filter(Boolean);
  if (caps.length) out.capacity = { minOfMins: Math.min(...caps.map((c) => c.min ?? 0)), maxOfMaxes: Math.max(...caps.map((c) => c.max)) };
  out.instantBookShare = pct(comps.filter((l) => l.instantBook).length, comps.length);
  out.policyMix = countBy(comps, (l) => l.cancellationPolicy ?? 'moderate'); // the sandbox's default
  out.alcoholMix = countBy(comps, (l) => l.alcoholPolicy ?? 'no restriction listed');
  out.topAmenities = Object.entries(countBy(comps.flatMap((l) => l.amenities ?? []), (a) => a.toLowerCase()))
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, TOP_AMENITIES)
    .map(([amenity]) => amenity);

  const top = [...comps].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0)).slice(0, COMPETITORS);
  out.competitors = top.map(({ id, name, neighborhood, capacity, pricing, rating, reviewCount }) => ({ id, name, neighborhood, capacity, pricing, rating, reviewCount }));
  registerListings(session, top.map((l) => compactHit(l)), { asResults: true }); // full hits, so cards get photos
  return out;
}

/** Integer-cent median (the mean of the middle two, rounded, for an even count). */
export function median(values) {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function spread(cents, unit) {
  const [min, mid, max] = [Math.min(...cents), median(cents), Math.max(...cents)];
  return {
    minCents: min, medianCents: mid, maxCents: max,
    min: formatCents(min) + unit, median: formatCents(mid) + unit, max: formatCents(max) + unit,
  };
}

const pct = (part, whole) => `${Math.round((100 * part) / whole)}%`;

function countBy(items, key) {
  const counts = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}
