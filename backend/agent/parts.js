/**
 * Turns the model's final text into contract parts (PRD B, B1): strips the tag
 * lines (CARDS / PHOTOS / MAP, see extras.js), then builds cards, images and
 * links only from listings in session.state.seen and from this turn's tool
 * results, so nothing shown to the user is invented by the model.
 */

import { formatCents } from './shared.js';
import { calendarLinks } from './calendar.js';

const TAG_LINE = /^[\s*_`]*(CARDS|PHOTOS|MAP)[\s*_`]*:(.*)$/gim;
const MD_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const ID = /[a-z0-9]+(?:-[a-z0-9]+)*/gi;
const PAY_TOOLS = new Set(['book', 'resend_payment_link', 'reschedule_booking', 'get_booking']);
const CALENDAR_TOOLS = new Set(['book', 'reschedule_booking', 'get_booking']);
const FALLBACK_TOOLS = new Set(['search_listings', 'search_by_vibe', 'find_similar_listings', 'nearby_listings', 'recommend_from_history', 'market_insights']);
const WANTS_PHOTOS = /photo|picture|pic|image|show me what .* looks|foto|imagen/i;
const MAX_CARDS = 6;
const MAX_PHOTO_LISTINGS = 2;
const PHOTOS_PER_LISTING = 3;

/** turnResults = [{ name, args, result }] for every tool call this turn, in order.
 *  Returns Part[] with at least one text part: text, then links, then cards, then images, then a confirm part. */
export function toParts(text, session, turnResults) {
  const state = session?.state ?? {};
  const seen = state.seen ?? {};
  const results = (turnResults ?? []).filter((r) => r?.result && !r.result.error);

  const tags = { CARDS: [], PHOTOS: [], MAP: [] };
  let tagged = false;
  let clean = String(text ?? '')
    .replace(TAG_LINE, (_, tag, ids) => {
      tagged = true;
      tags[tag.toUpperCase()].push(...(ids.match(ID) ?? []).map((id) => id.toLowerCase()));
      return '';
    })
    .replace(MD_IMAGE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  let cardIds = [...new Set(tags.CARDS)].filter((id) => seen[id]);
  if (!tagged) cardIds = fallbackCardIds(results, state).filter((id) => seen[id]);
  cardIds = cardIds.slice(0, MAX_CARDS);

  // Payment links, deterministically: the check reads the URL from the text, so it must be there.
  const links = [];
  const payments = new Map();
  for (const { name, result } of results) {
    const pay = result.payment;
    if (PAY_TOOLS.has(name) && result.ref && pay?.url && pay.status !== 'paid' && result.status !== 'cancelled') {
      payments.set(result.ref, { url: pay.url, cents: pay.amountCents ?? result.totalCents });
    }
  }
  for (const [ref, { url, cents }] of payments) {
    if (!clean.includes(url)) clean += `\n\nPayment link for ${ref}: ${url}`;
    links.push({ kind: 'link', label: `Pay ${formatCents(cents)} for ${ref}`, url });
  }

  // Calendar links (B10) from the last booking result per ref; calendarLinks skips cancelled ones.
  const bookings = new Map();
  for (const { name, result } of results) if (CALENDAR_TOOLS.has(name) && result.ref) bookings.set(result.ref, result);
  for (const booking of bookings.values()) links.push(...calendarLinks(booking, seen[booking.listingId]));

  for (const id of new Set(tags.MAP)) {
    const l = seen[id];
    if (l?.mapUrl) links.push({ kind: 'link', label: `Map: ${l.name}`, url: l.mapUrl });
  }

  const draft = results.findLast((r) => r.name === 'draft_email' && r.result.mailtoUrl);
  if (draft) links.push({ kind: 'link', label: 'Open the email draft in your mail app', url: draft.result.mailtoUrl });

  let photoListings = [...new Set(tags.PHOTOS)].map((id) => seen[id]).filter(Boolean);
  if (!tags.PHOTOS.length && WANTS_PHOTOS.test(lastUserText(session))) {
    const fetched = new Set(results.filter((r) => r.name === 'get_listing' && r.result.id).map((r) => r.result.id));
    if (fetched.size === 1) photoListings = [seen[[...fetched][0]] ?? results.find((r) => r.name === 'get_listing').result];
  }
  const images = photoListings.slice(0, MAX_PHOTO_LISTINGS).flatMap((l) =>
    (l.photoUrls ?? []).slice(0, PHOTOS_PER_LISTING).map((url) => ({ kind: 'image', url, caption: l.name })));

  const cards = cardIds.map((id, i) => cardFor(seen[id], i + 1));
  const fallbackText = cards.length ? "Here's what I found." : 'Sorry, could you say that again?';
  const confirm = confirmFor(clean, session, turnResults);
  return [{ kind: 'text', text: clean || fallbackText }, ...links, ...cards, ...images, ...(confirm ? [confirm] : [])];
}

const ASKS_TO_BOOK = /(book|reserv|confirm)/i;

/** A booking summary with Confirm / Not now buttons (our chat UI only; the contract has no such part).
 *  Shown when a quote is on the table, the guest is on file, nothing was booked this turn, and either the
 *  gate held back a book or the text asks whether to book. Every figure comes from the quote. */
function confirmFor(text, session, turnResults) {
  const s = session?.state ?? {};
  const all = turnResults ?? [];
  if (!s.guest?.name || !s.guest?.email) return null;
  if (all.some((r) => r?.name === 'book' && r.result && !r.result.error)) return null;
  const held = all.some((r) => r?.name === 'book' && r.result?.error === 'needs_confirmation');
  const q = all.findLast((r) => r?.name === 'quote' && r.result && !r.result.error)?.result ?? (held ? s.lastQuote : null);
  if (!q?.totalCents || !(held || (text.includes('?') && ASKS_TO_BOOK.test(text)))) return null;
  const l = s.seen?.[q.listingId];
  if (!l?.name) return null;
  const when = `on ${q.date} from ${q.startTime} to ${q.endTime} for ${q.guestCount} guests`;
  return {
    kind: 'confirm',
    action: 'book',
    listingId: l.id,
    title: l.name,
    photoUrl: l.photoUrls?.[0] ?? null,
    subtitle: [l.category, l.neighborhood, l.city].filter(Boolean).join(' · '),
    date: q.date,
    startTime: q.startTime,
    endTime: q.endTime,
    guestCount: q.guestCount,
    lineItems: q.lineItems ?? [],
    serviceFeeCents: q.serviceFeeCents,
    totalCents: q.totalCents,
    guest: { name: s.guest.name, email: s.guest.email },
    requestToBook: l.instantBook === false,
    // What the buttons send: worded so the gate reads a yes for this listing, or a clear no.
    yesText: `Yes, book ${l.name} ${when}.`,
    noText: `No, don't book ${l.name}.`,
  };
}

/** One card per listing. The title is exactly the listing name: the checks match cards by title. */
export function cardFor(listing, n) {
  const cap = listing.capacity;
  const facts = [
    listing.category,
    listing.neighborhood,
    cap?.max && (cap.min ? `${cap.min}–${cap.max} guests` : `up to ${cap.max} guests`),
    priceLabel(listing.pricing),
    listing.distanceMiles != null && `${listing.distanceMiles} mi away`,
    listing.instantBook === false && 'request to book',
  ].filter(Boolean);
  const card = { kind: 'card', title: listing.name, subtitle: `${n}. ${facts.join(' · ')}`, photoUrls: listing.photoUrls ?? [] };
  if (listing.id) card.listingId = listing.id; // extra field: our chat UI opens the full listing with it
  if (listing.mapUrl) card.url = listing.mapUrl;
  return card;
}

function priceLabel(pricing) {
  if (!pricing?.rateCents) return null;
  const rate = formatCents(pricing.rateCents);
  if (pricing.model === 'hourly') return `${rate}/hour`;
  if (pricing.model === 'perGuest') return `${rate} per guest`;
  return `${rate} flat`;
}

/** Ids of the last listing-returning tool this turn, when the model sent no tag lines.
 *  A search without `guests` only counts while the headcount is unknown, so cards always fit the group. */
function fallbackCardIds(results, state) {
  const last = results.findLast(({ name, args, result }) =>
    FALLBACK_TOOLS.has(name)
    && (name !== 'search_listings' || args?.guests != null || state.guestCount == null)
    && listOf(result).length > 0);
  return last ? listOf(last.result).map((l) => l?.id).filter(Boolean) : [];
}

const listOf = (result) => result?.results ?? result?.competitors ?? [];

function lastUserText(session) {
  const content = session?.messages?.findLast((m) => m.role === 'user')?.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map((c) => c?.text ?? '').join(' ') : '';
}
