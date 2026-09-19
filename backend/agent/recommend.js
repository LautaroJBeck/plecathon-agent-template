/**
 * Recommendations from a guest's past bookings (PRD B6): profile the listings
 * they booked with the "more like these" scorer (cancelled bookings count half)
 * and suggest the closest listings they have not booked yet.
 */

import { plec, PlecError } from './plec.js';
import { registerListings } from './shared.js';
import { compactHit, filterCatalogue, listingByRef, profileOf, rank, similarity } from './extras.js';

/** Tool body for recommend_from_history. Returns { basedOn, results } or { error, message }. */
export async function recommendFromHistory(args, session) {
  const state = session.state;
  const guestEmail = String(args.guestEmail || state.guest?.email || '').trim();
  if (!guestEmail) return { error: 'email_required', message: 'Ask which email they booked with.' };

  let bookings;
  try {
    ({ bookings = [] } = await plec.listBookings({ guestEmail }));
  } catch (err) {
    if (err instanceof PlecError) return { error: err.error, message: err.message };
    throw err;
  }
  const booked = bookings
    .map((b) => ({ listing: listingByRef(b.listingId), weight: b.status === 'cancelled' ? 0.5 : 1 }))
    .filter((b) => b.listing);
  if (!booked.length) return { results: [], message: 'No past bookings for this email.' };

  const bookedIds = new Set(booked.map((b) => b.listing.id));
  const cities = new Set(booked.map((b) => b.listing.city));
  const kinds = new Set(booked.map((b) => b.listing.kind));
  const profile = profileOf(booked);
  const pool = filterCatalogue({
    city: args.city ?? state.city ?? (cities.size === 1 ? [...cities][0] : undefined),
    guests: args.guests ?? state.guestCount,
  }, bookedIds).filter((l) => kinds.has(l.kind));
  const scored = pool.map((l) => ({ l, ...similarity(l, profile) })).filter((s) => s.score > 0);
  const hits = rank(scored, args.limit).map(({ l }) => compactHit(l, { because: because(l, booked) }));

  registerListings(session, hits, { asResults: true });
  const basedOn = [...new Set(booked.map((b) => b.listing.name))];
  return hits.length ? { basedOn, results: hits } : { basedOn, results: [], message: 'Nothing similar fits these filters.' };
}

/** "Similar to <the booked listing it is closest to>: <what they share>". */
function because(listing, booked) {
  const [best] = booked
    .map(({ listing: b }) => ({ b, ...similarity(listing, profileOf([{ listing: b }])) }))
    .sort((x, y) => y.score - x.score);
  return `Similar to ${best.b.name}: ${best.shared.slice(0, 3).join(', ')}`;
}
