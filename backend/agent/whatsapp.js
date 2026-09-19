/**
 * WhatsApp channel over Meta's WhatsApp Cloud API. server.js routes
 *
 *   GET  /api/webhooks/whatsapp   Meta's subscription check (echoes hub.challenge)
 *   POST /api/webhooks/whatsapp   message deliveries, signed with the app secret
 *
 * here. Every text message becomes one agent turn in the session
 * "whatsapp:<sender>", so each phone number keeps its own conversation, and the
 * reply parts go back as WhatsApp messages: the text first, then one captioned
 * photo per listing card.
 *
 * Environment (see .env.example):
 *   WHATSAPP_VERIFY_TOKEN     any string you choose; the same one goes in Meta's webhook settings
 *   WHATSAPP_APP_SECRET       the Meta app secret, to check X-Hub-Signature-256
 *   WHATSAPP_ACCESS_TOKEN     a token with the whatsapp_business_messaging permission
 *   WHATSAPP_PHONE_NUMBER_ID  the connected number's id (WhatsApp > API Setup)
 *   WHATSAPP_API_URL          optional, default https://graph.facebook.com/v23.0
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_API_URL = 'https://graph.facebook.com/v23.0';
const MAX_TEXT = 4096; // Cloud API limits
const MAX_CAPTION = 1024;
const MAX_TURN_TEXT = 2000; // the agent contract's limit
const SEND_TIMEOUT_MS = 15_000;
const SORRY_TEXT = 'Sorry, something went wrong on my side. Could you send that again?';
const TEXT_ONLY = 'I can only read text messages here for now. What are you planning?';

/** GET check: the challenge to echo back, or null when the verify token is wrong or unset. */
export function subscriptionChallenge(params) {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  const ok = token && params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === token;
  return ok ? params.get('hub.challenge') ?? '' : null;
}

/** True when the X-Hub-Signature-256 header is the HMAC-SHA256 of the raw body under the app secret. */
export function validSignature(rawBody, header, secret = process.env.WHATSAPP_APP_SECRET) {
  if (!secret || typeof header !== 'string') return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The user messages in a webhook payload, as [{ id, from, text }]. text is null for kinds we cannot read
 *  (photos, voice notes, stickers ...). Messages to another number on the same app are skipped. */
export function incomingMessages(payload) {
  const ownNumber = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const messages = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (change?.field !== 'messages' || !value) continue;
      if (ownNumber && value.metadata?.phone_number_id && value.metadata.phone_number_id !== ownNumber) continue;
      for (const m of value.messages ?? []) {
        if (m?.id && m?.from) messages.push({ id: m.id, from: String(m.from), text: textOf(m) });
      }
    }
  }
  return messages;
}

function textOf(m) {
  const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title;
  return typeof text === 'string' && text.trim() ? text.trim().slice(0, MAX_TURN_TEXT) : null;
}

const isHttp = (url) => /^https?:\/\//i.test(url ?? '');
const textMessage = (body) => ({ type: 'text', text: { body: body.slice(0, MAX_TEXT), preview_url: false } });
const imageMessage = (link, caption) => ({ type: 'image', image: { link, ...(caption ? { caption: caption.slice(0, MAX_CAPTION) } : {}) } });

/**
 * Contract parts -> Cloud API message bodies: one text message (the text parts,
 * plus any http(s) link whose URL the text does not already carry), then one
 * captioned photo per card and per image. Other link schemes (mailto:) are dropped.
 */
export function toWhatsApp(parts) {
  let text = parts.filter((p) => p.kind === 'text').map((p) => p.text.trim()).filter(Boolean).join('\n\n');
  for (const link of parts.filter((p) => p.kind === 'link' && isHttp(p.url))) {
    if (!text.includes(link.url)) text += `\n\n${link.label}: ${link.url}`;
  }
  text = text.trim().replace(/\*\*(.+?)\*\*/g, '*$1*'); // WhatsApp bold is *one* star
  const messages = text ? [textMessage(text)] : [];
  for (const part of parts) {
    if (part.kind === 'card') {
      const caption = [`*${part.title}*`, part.subtitle, isHttp(part.url) ? part.url : null].filter(Boolean).join('\n');
      const photo = (part.photoUrls ?? []).find(isHttp);
      messages.push(photo ? imageMessage(photo, caption) : textMessage(caption));
    } else if (part.kind === 'image' && isHttp(part.url)) {
      messages.push(imageMessage(part.url, part.caption));
    }
  }
  return messages;
}

// ponytail: in-memory dedupe and per-sender queues, fine for one local process.
const recentIds = new Set();
const queues = new Map();
const MAX_RECENT = 1000;

/** Meta redelivers a message it thinks we missed; answer each message id once. */
function firstSighting(id) {
  if (recentIds.has(id)) return false;
  recentIds.add(id);
  if (recentIds.size > MAX_RECENT) recentIds.delete(recentIds.values().next().value);
  return true;
}

/** Runs tasks for one sender one after another, so two quick messages never share a turn's history. */
function inOrder(key, task) {
  const run = (queues.get(key) ?? Promise.resolve()).then(task).catch((err) => console.error('[whatsapp]', err));
  queues.set(key, run);
  run.finally(() => { if (queues.get(key) === run) queues.delete(key); });
  return run;
}

/**
 * Answers every new message in a verified webhook payload, one turn at a time
 * per sender. turn(sessionId, text) resolves to contract parts. Never rejects;
 * resolves once every reply is sent (tests await it, server.js does not).
 */
export function handleWebhook(payload, turn) {
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const s of change?.value?.statuses ?? []) {
        if (s?.status === 'failed') console.warn(`[whatsapp] a message to ...${String(s.recipient_id).slice(-4)} failed:`, JSON.stringify(s.errors ?? []));
      }
    }
  }
  const fresh = incomingMessages(payload).filter((m) => firstSighting(m.id));
  return Promise.all(fresh.map((m) => inOrder(m.from, () => reply(m, turn))));
}

async function reply({ id, from, text }, turn) {
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.error('[whatsapp] set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to answer messages');
    return;
  }
  if (!text) return send(from, [textMessage(TEXT_ONLY)]);
  showTyping(id);
  const startedAt = Date.now();
  let parts;
  try {
    parts = await turn(`whatsapp:${from}`, text);
  } catch (err) {
    console.error(`[whatsapp ...${from.slice(-4)}] turn failed:`, err?.message ?? err);
    parts = [];
  }
  const messages = toWhatsApp(parts);
  await send(from, messages.length ? messages : [textMessage(SORRY_TEXT)]);
  console.log(`[whatsapp ...${from.slice(-4)}] ${Date.now() - startedAt}ms "${text.slice(0, 60)}" -> ${messages.map((m) => m.type).join(',') || 'sorry'}`);
}

/** Sends messages in order. A photo that fails goes out as its caption, so the listing still shows. */
async function send(to, messages) {
  const links = await Promise.all(messages.map((m) => (m.type === 'image' ? finalUrl(m.image.link) : null)));
  for (const [i, m] of messages.entries()) {
    const body = m.type === 'image' ? { ...m, image: { ...m.image, link: links[i] } } : m;
    try {
      await graph({ recipient_type: 'individual', to, ...body });
    } catch (err) {
      console.error('[whatsapp] send failed:', err.message);
      if (m.type === 'image' && m.image.caption) await graph({ to, ...textMessage(m.image.caption) }).catch(() => {});
    }
  }
}

/** Marks the message read and shows "typing..." while the agent works. Best effort. */
function showTyping(messageId) {
  graph({ status: 'read', message_id: messageId, typing_indicator: { type: 'text' } })
    .catch((err) => console.warn('[whatsapp] typing indicator:', err.message));
}

async function graph(body) {
  const base = (process.env.WHATSAPP_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
  const res = await fetch(`${base}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`WhatsApp API answered HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// ponytail: unbounded, but the catalogue has 92 listings x 3 photos.
const resolved = new Map();

/** WhatsApp downloads image links itself; hand it the final URL, since catalogue photos 302 to a CDN. */
function finalUrl(url) {
  if (!resolved.has(url)) {
    resolved.set(url, fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
      .then((res) => {
        res.body?.cancel();
        const to = res.headers.get('location');
        return res.status >= 300 && res.status < 400 && to ? new URL(to, url).href : url;
      })
      .catch(() => url));
  }
  return resolved.get(url);
}
