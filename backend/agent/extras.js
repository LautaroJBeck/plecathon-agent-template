/**
 * Extra tools and prompt text (PRD B). A imports extraTools, gatedExtraTools,
 * callExtraTool and extraPromptSection (docs/prd, section 3.3).
 *
 * Also home to the catalogue helpers the extras share: filters, the vibe and
 * similarity scorers, and compact hits. Everything here reads the offline
 * catalogue (backend/data/listings.json), so it costs no sandbox calls.
 */

// geo.js, recommend.js and market.js import the catalogue helpers below back from this
// module. Only function declarations cross that cycle, so load order does not matter.
import { readFileSync } from 'node:fs';
import { registerListings } from './shared.js';
import { describeVibe } from './vision.js';
import { haversineMiles, pointOf, resolveOrigin } from './geo.js';
import { recommendFromHistory } from './recommend.js';
import { marketInsights } from './market.js';
import { draftEmail, sendEmail } from './email.js';

const CATALOGUE = JSON.parse(readFileSync(new URL('../data/listings.json', import.meta.url), 'utf8'));
const BY_ID = new Map(CATALOGUE.map((l) => [l.id, l]));

const CITY = { type: 'string', enum: ['Philadelphia', 'New York', 'Washington'] };
const GUESTS = { type: 'integer', description: 'Headcount; only listings whose capacity range contains it. Defaults to the headcount in memory.' };
const LIMIT = { type: 'integer', minimum: 1, maximum: 8 };
const fn = (name, description, properties, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const extraTools = [
  fn('search_by_vibe',
    "Find listings matching a described vibe, look or mood, or the vibe read from the user's photo. Pass keywords in catalogue words: setting (rooftop, garden, loft, warehouse, waterfront, courtyard), style (industrial, historic, candlelit, skyline, sunset, intimate, casual, formal) and features (dance floor, fireplace, stage, live music). Returns hits with matchedOn. Never a price total: use quote for that.",
    {
      vibe: { type: 'string', description: "The vibe in one sentence, in the user's words" },
      keywords: { type: 'array', items: { type: 'string' } },
      city: CITY,
      guests: GUESTS,
      kind: { type: 'string', enum: ['venue', 'service'], description: 'Default venue' },
      category: { type: 'string', description: 'Exact category, e.g. loft, rooftop, garden' },
      limit: LIMIT,
    }, ['vibe', 'keywords']),
  fn('find_similar_listings',
    'More listings like the ones the user picked ("I like 1 and 3"). Pass the picked ids (from your last CARDS line) as likedIds, and any rejected ones as dislikedIds. City and headcount default to memory. Never a price total: use quote for that.',
    {
      likedIds: { type: 'array', items: { type: 'string' } },
      dislikedIds: { type: 'array', items: { type: 'string' } },
      city: CITY,
      guests: GUESTS,
      limit: LIMIT,
    }, ['likedIds']),
  fn('nearby_listings',
    'Listings sorted by distance, each with distanceMiles. Use for "near me" (the browser location, when the user shared it) or "near <neighborhood or venue name>" (pass it as near). Headcount defaults to memory.',
    {
      near: { type: 'string', description: 'A neighborhood (Fishtown, Rittenhouse, Georgetown ...) or a listing name. Omit for "near me".' },
      kind: { type: 'string', enum: ['venue', 'service'], description: 'Default venue' },
      category: { type: 'string' },
      city: CITY,
      guests: GUESTS,
      limit: LIMIT,
    }),
  fn('recommend_from_history',
    'Suggest listings like the ones this guest booked before ("something like last time", "what would I like?"). Uses the guest email on file unless you pass one. Each hit has a because line to relay.',
    {
      guestEmail: { type: 'string', description: 'The email they booked with, if not on file' },
      city: CITY,
      guests: GUESTS,
      limit: LIMIT,
    }),
  fn('market_insights',
    'For someone opening or running a venue: what comparable listings in PLEC\'s catalogue charge (min, median, max per pricing model), cleaning fees, capacity, instant-book share, cancellation and alcohol policies, common amenities, and the top-rated competitors. Catalogue data only.',
    {
      city: CITY,
      category: { type: 'string', description: 'Exact category, e.g. rooftop, bar, loft' },
      kind: { type: 'string', enum: ['venue', 'service'], description: 'Default venue' },
      guests: { type: 'integer', description: 'Only comparables whose capacity range contains this' },
      neighborhood: { type: 'string' },
    }, ['city']),
  fn('draft_email',
    'Draft a plain-text email (share options, announce a booking) and get a link that opens it in the user\'s mail app. Nothing is sent.',
    {
      to: { type: 'array', items: { type: 'string' }, description: '1 to 10 email addresses' },
      subject: { type: 'string', description: 'At most 150 characters' },
      body: { type: 'string', description: 'Plain text, at most 2,000 characters, facts from tool results only' },
      purpose: { type: 'string', enum: ['share_options', 'booking_announcement', 'other'] },
    }, ['to', 'subject', 'body', 'purpose']),
  fn('send_email',
    'Send the drafted email. Call ONLY after the user saw the recipients and subject and said yes. Pass the same recipients and subject as the draft.',
    {
      to: { type: 'array', items: { type: 'string' } },
      subject: { type: 'string' },
    }, ['to', 'subject']),
];

export const gatedExtraTools = ['send_email']; // extra tools that need a user "yes" (A's gate enforces it)

/** ctx = { session, userText }. Never throws; on failure returns { error, message }. */
export async function callExtraTool(name, args, ctx) {
  const session = ctx?.session ?? { state: {} };
  session.state ??= {};
  try {
    switch (name) {
      case 'search_by_vibe': return searchByVibe(args ?? {}, session);
      case 'find_similar_listings': return findSimilarListings(args ?? {}, session);
      case 'nearby_listings': return nearbyListings(args ?? {}, session);
      case 'recommend_from_history': return await recommendFromHistory(args ?? {}, session);
      case 'market_insights': return marketInsights(args ?? {}, session);
      case 'draft_email': return draftEmail(args ?? {}, session);
      case 'send_email': return await sendEmail(args ?? {}, session);
      default: return { error: 'unknown_tool', message: `No tool named ${name}.` };
    }
  } catch (err) {
    console.error(`[extra ${name}]`, err);
    return { error: 'tool_failed', message: `${name} failed: ${err?.message ?? err}` };
  }
}

const TAG_PROTOCOL = `To show listings, end your reply with a line "CARDS: id1, id2" (ids from tool results only, at most 6, best first). Cards are numbered in that order and show name, category, capacity and price, so keep your text short. A number the user mentions ("I like 1 and 3") is a position in your last CARDS line. For photos add "PHOTOS: id"; for a map, get_listing it and add "MAP: id". Never write image URLs or markdown images.`;

const MARKET_SCOPE = `You also help people opening or running a venue understand the market: use market_insights, say the figures come from PLEC's catalogue (not the whole market), and quote them as given.`;

const EMAIL_RULES = `Email: draft_email with facts from tool results only (listing name, date, times, headcount, total, booking ref), never listing descriptions, and no payment link in emails to others unless asked. Show the recipients and subject and ask before send_email; never say it was sent unless it returned sent: true. If sending is off, offer the draft link.`;

const EXTRA_TOOLS_GUIDE = `Extra tools: search_by_vibe for a described look or mood; find_similar_listings when the user picks listings (city and headcount are in memory, don't ask again); nearby_listings for "near me" or "near <place>" (on location_unknown, ask for a neighborhood); recommend_from_history for recommendations or "something like last time". None of them gives totals: prices come from quote.`;

/** Extra system-prompt text (tag protocol, extra scope, photo/location context). May be ''. */
export function extraPromptSection(session) {
  const state = session?.state ?? {};
  const vibe = state.vibe;
  const lines = [TAG_PROTOCOL, EXTRA_TOOLS_GUIDE, MARKET_SCOPE, EMAIL_RULES];
  if (vibe?.description || vibe?.liked?.length || vibe?.disliked?.length) {
    lines.push(`The user's vibe: ${vibe.description || 'not described'}. Liked: ${names(vibe.liked)}. Disliked: ${names(vibe.disliked)}.`);
  }
  if (state.userLocation) lines.push("The user shared their location. Use nearby_listings for 'near me' questions.");
  if (state.photoTurn === 'read') {
    lines.push(`The user sent a photo this turn. It reads as: "${vibe.description}" Call search_by_vibe now with these keywords: ${vibe.keywords.join(', ')}.`);
  } else if (state.photoTurn === 'unreadable') {
    lines.push("The user sent a photo this turn, but it couldn't be read. Tell them you couldn't read the photo and ask them to describe the vibe in words.");
  }
  return lines.join('\n');
}

const PHOTO_TIMEOUT_MS = 15_000;

/** Runs before the model each turn (server.js): reads this turn's photo, if any, into state.vibe.
 *  Sets state.photoTurn for this turn's prompt, always drops the image, never throws. */
export async function prepareTurn(session, { describe = describeVibe } = {}) {
  const state = session?.state;
  if (!state) return;
  delete state.photoTurn;
  const image = state.turnImage;
  delete state.turnImage;
  if (!image) return;
  let timer;
  try {
    const read = await Promise.race([
      describe(image),
      new Promise((resolve) => { timer = setTimeout(resolve, PHOTO_TIMEOUT_MS, { error: 'vision_timeout' }); }),
    ]);
    if (!read?.summary) throw new Error(read?.error ?? 'no summary');
    state.vibe = { ...vibeOf(state), description: read.summary, keywords: read.keywords ?? [], fromImage: true };
    state.photoTurn = 'read';
  } catch (err) {
    console.warn('[photo] not read:', err?.message ?? err);
    state.photoTurn = 'unreadable';
  } finally {
    clearTimeout(timer);
  }
}

const names = (ids) => (ids?.length ? ids.map((id) => BY_ID.get(id)?.name ?? id).join(', ') : 'none');

// ---------------------------------------------------------------------------
// Catalogue helpers, shared by the other extras (geo, recommend, market).

/** The whole offline catalogue. */
export function catalogue() {
  return CATALOGUE;
}

/** One catalogue listing by id, or by exact name (case-insensitive). */
export function listingByRef(ref) {
  const key = String(ref ?? '').trim();
  return BY_ID.get(key) ?? BY_ID.get(key.toLowerCase()) ?? CATALOGUE.find((l) => l.name.toLowerCase() === key.toLowerCase());
}

/** Catalogue listings passing the city (prefix), kind, category, neighborhood and headcount filters, minus `exclude` ids.
 *  A listing without a capacity passes only when no headcount is given. */
export function filterCatalogue({ city, kind, category, neighborhood, guests } = {}, exclude = []) {
  const skip = new Set(exclude);
  const lc = (s) => String(s ?? '').trim().toLowerCase();
  const g = Number(guests);
  return CATALOGUE.filter((l) =>
    !skip.has(l.id)
    && (!city || lc(l.city).startsWith(lc(city)))
    && (!kind || l.kind === kind)
    && (!category || lc(l.category) === lc(category))
    && (!neighborhood || lc(l.neighborhood) === lc(neighborhood))
    && (!guests || !Number.isFinite(g) || (l.capacity != null && g >= (l.capacity.min ?? 0) && g <= l.capacity.max)));
}

const HIT_FIELDS = ['id', 'name', 'kind', 'category', 'city', 'neighborhood', 'capacity', 'pricing', 'rating', 'instantBook', 'photoUrls', 'tags'];

/** A search-hit-shaped copy of a listing. Never carries the description (host text, possibly hostile). */
export function compactHit(listing, extra = {}) {
  return { ...Object.fromEntries(HIT_FIELDS.map((k) => [k, listing[k]])), ...extra };
}

/** Sort scored entries ({ l, score }) best first, rating then review count breaking ties. */
export function rank(scored, limit) {
  return scored
    .sort((a, b) => b.score - a.score || (b.l.rating ?? 0) - (a.l.rating ?? 0) || (b.l.reviewCount ?? 0) - (a.l.reviewCount ?? 0))
    .slice(0, clampLimit(limit));
}

export const clampLimit = (n, fallback = 6) => Math.min(8, Math.max(1, Math.round(Number(n)) || fallback));

const STOP = new Set(('a an and are as at be but by for from in into is it of on or our so that the their this to with '
  + 'we you your my i me very really some something like want looking need feel feeling vibe vibes style kind sort '
  + 'space place venue event party people guest').split(' '));
const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const tokens = (text) => String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).map(stem).filter((w) => w && !STOP.has(w));

const VIBE_WEIGHTS = [['tags', 3], ['category', 3], ['amenities', 2], ['neighborhood', 1]];

/** Keyword overlap: tags x3, category x3, amenities x2, neighborhood x1, description words x1.
 *  matchedOn names the matched tags, category, amenities and neighborhood, never description words. */
export function vibeScore(listing, words) {
  let score = 0;
  const matchedOn = new Set();
  for (const [field, weight] of VIBE_WEIGHTS) {
    for (const phrase of [listing[field] ?? []].flat()) {
      if (tokens(phrase).some((t) => words.has(t))) {
        score += weight;
        matchedOn.add(phrase);
      }
    }
  }
  score += new Set(tokens(listing.description).filter((t) => words.has(t))).size;
  return { score, matchedOn: [...matchedOn] };
}

// "More like these": a shared category (the same kind of space) outweighs shared tags,
// which are mostly event types (wedding, birthday) that any big room carries.
const SIMILAR_WEIGHTS = { category: 8, tags: 3, amenities: 2, neighborhood: 1 };

function features(listing) {
  return Object.entries(SIMILAR_WEIGHTS).flatMap(([field, weight]) =>
    [listing[field] ?? []].flat().map((value) => ({ key: `${field}:${String(value).toLowerCase()}`, value, weight })));
}

/** Weighted feature profile of listings: [{ listing, weight }] -> Map(feature -> weight). */
export function profileOf(weighted) {
  const profile = new Map();
  for (const { listing, weight = 1 } of weighted) {
    for (const f of features(listing)) profile.set(f.key, (profile.get(f.key) ?? 0) + f.weight * weight);
  }
  return profile;
}

/** How well a listing matches a profile, and which of its category/tags/amenities it shares. */
export function similarity(listing, profile) {
  let score = 0;
  const shared = new Set();
  for (const f of features(listing)) {
    if (!profile.has(f.key)) continue;
    score += profile.get(f.key);
    shared.add(f.value);
  }
  return { score, shared: [...shared] };
}

function vibeOf(state) {
  state.vibe ??= { description: '', keywords: [], liked: [], disliked: [], fromImage: false };
  state.vibe.liked ??= [];
  state.vibe.disliked ??= [];
  return state.vibe;
}

// ---------------------------------------------------------------------------
// B3: vibe search and "more like these".

function searchByVibe(args, session) {
  const state = session.state;
  const vibe = vibeOf(state);
  const keywords = [args.keywords ?? []].flat().map(String);
  const words = new Set(tokens([args.vibe, ...keywords].join(' ')));
  const pool = filterCatalogue({
    city: args.city ?? state.city,
    kind: args.kind ?? 'venue',
    category: args.category,
    guests: args.guests ?? state.guestCount,
  }, vibe.disliked);
  const scored = pool.map((l) => ({ l, ...vibeScore(l, words) }));
  const matched = scored.filter((s) => s.score > 0);
  const hits = rank(matched.length ? matched : scored, args.limit).map(({ l, matchedOn }) => compactHit(l, { matchedOn }));

  if (args.vibe) vibe.description = String(args.vibe);
  if (keywords.length) vibe.keywords = keywords;
  registerListings(session, hits, { asResults: true });
  if (!hits.length) return { results: [], message: 'No listings fit these filters.' };
  return matched.length ? { results: hits } : { results: hits, note: 'Nothing matched those words; these are the top-rated listings that fit.' };
}

function findSimilarListings(args, session) {
  const state = session.state;
  const vibe = vibeOf(state);
  const liked = [args.likedIds ?? []].flat().map(listingByRef).filter(Boolean);
  const disliked = [args.dislikedIds ?? []].flat().map(listingByRef).filter(Boolean);
  const likedIds = liked.map((l) => l.id);
  const dislikedIds = disliked.map((l) => l.id);
  vibe.liked = [...new Set([...vibe.liked.filter((id) => !dislikedIds.includes(id)), ...likedIds])];
  vibe.disliked = [...new Set([...vibe.disliked.filter((id) => !likedIds.includes(id)), ...dislikedIds])];
  if (!liked.length) return { error: 'unknown_ids', message: 'Pass listing ids from the last results (your CARDS line) as likedIds.' };

  const cities = new Set(liked.map((l) => l.city));
  const kinds = new Set(liked.map((l) => l.kind));
  const profile = profileOf(liked.map((listing) => ({ listing })));
  const pool = filterCatalogue({
    city: args.city ?? state.city ?? (cities.size === 1 ? [...cities][0] : undefined),
    guests: args.guests ?? state.guestCount,
  }, [...vibe.liked, ...vibe.disliked]).filter((l) => kinds.has(l.kind));
  const scored = pool.map((l) => {
    const { score, shared } = similarity(l, profile);
    return { l, score, shared };
  }).filter((s) => s.score > 0);
  const hits = rank(scored, args.limit).map(({ l, shared }) => compactHit(l, { matchedOn: shared }));

  registerListings(session, hits, { asResults: true });
  const similarTo = liked.map((l) => l.name);
  return hits.length ? { similarTo, results: hits } : { similarTo, results: [], message: 'Nothing else close fits these filters.' };
}

// ---------------------------------------------------------------------------
// B5: distance search.

function nearbyListings(args, session) {
  const state = session.state;
  const origin = resolveOrigin(args, session);
  if (!origin) return { error: 'location_unknown', message: 'Ask for a neighborhood, or ask them to allow location in the browser.' };
  const pool = filterCatalogue({
    city: args.city,
    kind: args.kind ?? 'venue',
    category: args.category,
    guests: args.guests ?? state.guestCount,
  }, vibeOf(state).disliked);
  const hits = pool
    .filter((l) => pointOf(l.id))
    .map((l) => ({ l, miles: haversineMiles(origin, pointOf(l.id)) }))
    .sort((a, b) => a.miles - b.miles)
    .slice(0, clampLimit(args.limit))
    .map(({ l, miles }) => compactHit(l, { distanceMiles: Math.round(miles * 10) / 10 }));
  registerListings(session, hits, { asResults: true });
  return hits.length ? { origin: origin.label, results: hits } : { origin: origin.label, results: [], message: 'No listings fit these filters.' };
}
