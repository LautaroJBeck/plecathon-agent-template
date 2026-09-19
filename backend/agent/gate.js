/**
 * The confirmation gate (PRD A, A4). State-changing tools run only after the
 * user said yes to that exact action; everything else is handed back to the
 * model as needs_confirmation. Enforced in code, not only in the prompt.
 */

import { gatedExtraTools } from './extras.js';

export const GATED = new Set(['book', 'cancel_booking', 'reschedule_booking', ...gatedExtraTools]);

// Letters, not \b: \b treats "í" as a boundary.
const W = (alts) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'iu');
const YES = W([
  'yes', 'yep', 'yeah', 'yup', 'sure', 'confirm', 'confirmed', 'go ahead', 'go for it', 'do it', 'please do',
  'sounds good', 'book it(?: now)?', 'ok', 'okay', 'correct', "that'?s right", 'that’s right', 'absolutely', 'perfect',
  'sí', 'si', 'dale', 'adelante', 'confirmo', 'de acuerdo', 'hazlo', 'claro',
].join('|'));
const NO = W([
  'no', 'nope', 'nah', 'not yet', 'not now', 'wait', 'cancel that', 'hold on', "don'?t", 'don’t', 'do not', 'stop',
  'todavía no', 'espera', 'mejor no',
].join('|'));
const CHANGE = W(['actually', 'instead', 'change', 'different', 'rather', 'make it', 'switch'].join('|'));

/**
 * Clear consent. A bare request ("Book The Foundry for Oct 10", "cancel
 * BK-1001") is not consent, and any refusal or hesitation wins over a yes.
 * @param {string} text
 */
export function isAffirmative(text) {
  const t = String(text ?? '').trim();
  if (!t || NO.test(t) || !YES.test(t)) return false;
  // "is it ok to bring a dog?" is a question, not a yes, unless it opens with one.
  if (t.includes('?') && !new RegExp(`^${YES.source}`, 'iu').test(t)) return false;
  return true;
}

/** A clear no, or a change of plan: the pending action is off. */
export function isNegativeOrChange(text) {
  const t = String(text ?? '');
  return NO.test(t) || CHANGE.test(t);
}

/**
 * What the action is about, in words the user and assistant would say.
 * @param {string} name
 * @param {object} args
 * @param {{ state: object }} session
 */
export function subjectOf(name, args, session) {
  if (name === 'book') return session.state.seen?.[args.listingId]?.name ?? args.listingId ?? '';
  if (args?.ref) return String(args.ref);
  return args?.subject ?? name;
}

const KEY_ARGS = {
  book: ['listingId', 'date', 'startTime', 'endTime', 'guestCount'],
  cancel_booking: ['ref'],
  reschedule_booking: ['ref', 'date', 'startTime', 'endTime'],
};

/** Same tool and same key args (the whole args, keys sorted, for extras). */
export function matches(pending, name, args) {
  if (!pending || pending.kind !== name) return false;
  const keys = KEY_ARGS[name];
  if (!keys) return stableJson(pending.args) === stableJson(args);
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  return keys.every((k) => norm(pending.args?.[k]) === norm(args?.[k]));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** Does this text mention the subject? A listing also counts by its short name ("The Foundry" for "The Foundry at Fishtown"). */
function mentions(text, subject) {
  const t = String(text ?? '').toLowerCase();
  const s = String(subject ?? '').trim().toLowerCase();
  if (!t || !s) return false;
  if (t.includes(s)) return true;
  const short = s.split(/\s+(?:at|in|on|-|–|—)\s+|\s*[(,:]/)[0].trim();
  return short.length >= 6 && short !== s && t.includes(short);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Decide whether a tool call may run. Never touches the sandbox.
 * @param {string} name
 * @param {object} args
 * @param {{ session: { state: object }, userText: string, prevAssistantText: string }} ctx
 * @returns {{ allow: true, args: object } | { allow: false, result: { error: string, message: string } }}
 */
export function checkGate(name, args, { session, userText, prevAssistantText }) {
  if (!GATED.has(name)) return { allow: true, args };
  const s = session.state;
  let callArgs = args;

  if (name === 'book' && !(String(args.guestName ?? '').trim() && EMAIL.test(String(args.guestEmail ?? '').trim()))) {
    if (!s.guest) {
      s.pending = { kind: name, args, subject: subjectOf(name, args, session), at: Date.now() };
      return { allow: false, result: { error: 'guest_details_required', message: 'Ask for the name and email for the reservation.' } };
    }
    callArgs = { ...args, guestName: s.guest.name, guestEmail: s.guest.email };
  }

  const subject = subjectOf(name, callArgs, session);
  const consented = isAffirmative(userText)
    && (matches(s.pending, name, callArgs) || mentions(userText, subject) || mentions(prevAssistantText, subject));
  if (consented) return { allow: true, args: callArgs };

  s.pending = { kind: name, args: callArgs, subject, at: Date.now() };
  return {
    allow: false,
    result: {
      error: 'needs_confirmation',
      message: 'Not done yet. Show the user exactly what will happen (listing, date, times, guests, the exact total from quote, refund if cancelling) and ask them to confirm. Call this tool again only after they say yes.',
    },
  };
}

/** After an allowed call ran: success clears pending; an error leaves the action not done. */
export function settleGate(session, name, result) {
  if (!GATED.has(name)) return;
  if (result && !result.error) session.state.pending = null;
}

/** Called once per user message, before the model runs. */
export function noteUserTurn(session, text) {
  if (session.state.pending && !isAffirmative(text) && isNegativeOrChange(text)) session.state.pending = null;
}
