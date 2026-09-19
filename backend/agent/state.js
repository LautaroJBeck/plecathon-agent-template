/**
 * Structured memory (PRD A, A3). Fills session.state from tool traffic and
 * user text, and renders the short summary the system prompt restates every
 * turn, so nothing the user said has to be asked twice.
 */

import { formatCents, registerListings } from './shared.js';

const BOOKING_TOOLS = new Set(['get_booking', 'list_bookings', 'cancel_booking', 'reschedule_booking', 'resend_payment_link']);

/**
 * Record what a tool call tells us about the user's plan. Skips errors.
 * @param {{ state: object }} session
 * @param {string} name
 * @param {object} args
 * @param {object} result
 */
export function remember(session, name, args, result) {
  if (!result || typeof result !== 'object' || result.error) return;
  const s = session.state;
  if (name === 'search_listings') {
    if (args.city) s.city = args.city;
    if (args.guests) s.guestCount = Number(args.guests);
    if (args.date) s.date = args.date;
    registerListings(session, result.results, { asResults: true });
  } else if (name === 'get_listing') {
    registerListings(session, [result]);
  } else if (name === 'quote') {
    s.lastQuote = result;
    if (result.date) s.date = result.date;
    if (result.guestCount) s.guestCount = result.guestCount;
  } else if (name === 'book') {
    if (args.guestName && args.guestEmail) s.guest = { name: args.guestName, email: args.guestEmail };
    addBookings(s, [result]);
  } else if (BOOKING_TOOLS.has(name)) {
    addBookings(s, Array.isArray(result.bookings) ? result.bookings : [result]);
  }
}

/** Refs go to bookingRefs; bookingInfo (A-only) keeps each ref's listing name for the gate. */
function addBookings(s, bookings) {
  s.bookingRefs ??= [];
  s.bookingInfo ??= {};
  for (const b of bookings) {
    if (!b?.ref) continue;
    if (!s.bookingRefs.includes(b.ref)) s.bookingRefs.push(b.ref);
    if (b.listingName) s.bookingInfo[b.ref] = { listingName: b.listingName, date: b.date };
  }
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const NAME_WORD = "[A-ZÁÉÍÓÚÑÜ][A-Za-zÀ-ÿ'’-]+";
const FULL_NAME = `(${NAME_WORD}(?:\\s+${NAME_WORD}){0,3})`;
/** Lead-ins are matched case-insensitively; the name after them must be capitalised as written. */
const NAME_LEAD = /\b(?:my name is|name is|name:|this is|i am|i'm|i’m|me llamo|mi nombre es|soy)\s+/i;
const NAME_AT_START = new RegExp(`^${FULL_NAME}`);
const NAME_BEFORE_EMAIL = new RegExp(`^\\s*${FULL_NAME}\\s*[,(<]\\s*${EMAIL.source}`);
/** Capitalised words that start phrases, not names ("I'm Planning"). */
const NOT_NAMES = /^(planning|looking|hoping|trying|interested|here|good|fine|ok|okay|not|sure|the|a|an|booking|organizing|organising)$/i;

/**
 * Pull a guest name and/or email out of a user message.
 * @param {string} text
 * @returns {{ name?: string, email?: string }}
 */
export function extractGuest(text) {
  const out = {};
  const str = String(text ?? '');
  const email = str.match(EMAIL);
  if (email) out.email = email[0];
  const lead = str.match(NAME_LEAD);
  const m = (lead && str.slice(lead.index + lead[0].length).match(NAME_AT_START)) || str.match(NAME_BEFORE_EMAIL);
  if (m && !NOT_NAMES.test(m[1].split(/\s+/)[0])) out.name = m[1].trim();
  return out;
}

const CITY_ALIASES = [
  [/\b(philadelphia|philly|filadelfia)\b/i, 'Philadelphia'],
  [/\b(new york|nyc|manhattan|brooklyn|nueva york)\b/i, 'New York'],
  [/\b(washington|d\.?c\.?)\b/i, 'Washington'],
];
const HEADCOUNT = /\b(\d{1,4})\s*(?:people|persons|personas|guests|invitados|attendees|pax|ppl)\b|\bfor\s+(?:about\s+|around\s+|roughly\s+)?(\d{1,4})\b(?!\s*(?:am|pm|:|h|hours?))/i;
const EVENT_TYPES = /\b(launch party|birthday party|birthday|wedding|reception|corporate event|offsite|conference|meetup|happy hour|holiday party|baby shower|bridal shower|fundraiser|gala|dinner|party|boda|cumpleaños|fiesta)\b/i;

/**
 * Called on every user message: guest details (kept as a draft until both
 * halves are known), plus city, headcount and event type when stated.
 * @param {{ state: object }} session
 * @param {string} text
 */
export function noteUserText(session, text) {
  const s = session.state;
  const found = extractGuest(text);
  if (found.name || found.email) {
    s.guestDraft = { ...s.guestDraft, ...found };
    if (s.guestDraft.name && s.guestDraft.email) s.guest = { name: s.guestDraft.name, email: s.guestDraft.email };
  }
  for (const [pattern, city] of CITY_ALIASES) if (pattern.test(text)) { s.city = city; break; }
  const count = String(text).match(HEADCOUNT);
  if (count) s.guestCount = Number(count[1] ?? count[2]);
  const event = String(text).match(EVENT_TYPES);
  if (event) s.eventType = event[1].toLowerCase();
}

/**
 * The lines the system prompt restates each turn.
 * @param {{ state: object }} session
 */
export function stateSummary(session) {
  const s = session.state;
  const lines = [
    s.city && `City: ${s.city}`,
    s.guestCount && `Headcount: ${s.guestCount}`,
    s.date && `Date: ${s.date}`,
    s.eventType && `Event: ${s.eventType}`,
    s.guest ? `Guest on file: ${s.guest.name} <${s.guest.email}> (do not ask again)` : s.guestDraft && `Guest so far: ${[s.guestDraft.name, s.guestDraft.email].filter(Boolean).join(', ')}`,
    s.pending && `Awaiting the user's yes for: ${s.pending.kind} ${s.pending.subject ?? ''}`.trim(),
    s.lastQuote?.totalCents != null && `Last quote: ${s.lastQuote.quoteId} for ${s.lastQuote.listingId} on ${s.lastQuote.date} ${s.lastQuote.startTime ?? ''}-${s.lastQuote.endTime ?? ''}, ${s.lastQuote.guestCount} guests, ${formatCents(s.lastQuote.totalCents)} all in`,
    s.bookingRefs?.length && `Booking refs this conversation: ${s.bookingRefs.join(', ')}`,
  ].filter(Boolean);
  return `Known so far:\n${lines.length ? lines.map((l) => `- ${l}`).join('\n') : '- nothing yet'}`;
}
