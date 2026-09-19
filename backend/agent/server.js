/**
 * Zero-dependency HTTP server for the agent contract (docs/contract.md):
 *
 *   POST /agent/messages   { sessionId, text, image?, location? }  ->  { parts: Part[] }
 *   POST /agent/reset      { sessionId }        ->  { ok: true }
 *   GET  /health           { ok: true }
 *   /api/*                 read-only sandbox routes for the site (see handleApi)
 *
 * The site is its own process (frontend/, Vite). CORS is
 * wide open so the page can also be served from anywhere (a file, a tunnel,
 * another port) and still talk to this server. Every error is JSON
 * with { error, message } so the runner and the chat page can print it.
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { respond } from './agent.js';
import { prepareTurn } from './extras.js';
import { plec, PlecError } from './plec.js';
import { getSession, resetSession } from './session.js';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
loadDotEnv(join(ROOT, '.env'));

const PORT = Number(process.env.AGENT_PORT) || 8787;
/** The evaluator gives up at 45s; answer with an error before that so the failure is visible. */
const TURN_DEADLINE_MS = 40_000;
/** Room for one downscaled photo; see validImage. */
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_CHARS = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  const url = new URL(req.url ?? '/', 'http://localhost');

  try {
    if (req.method === 'OPTIONS') return end(res, 204);
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
    if (req.method === 'POST' && url.pathname === '/agent/messages') return await handleMessage(req, res);
    if (req.method === 'POST' && url.pathname === '/agent/reset') return await handleReset(req, res);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return json(res, 404, { error: 'not_found', message: `No route ${req.method} ${url.pathname}` });
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: 'server_error', message: err?.message ?? String(err) });
  }
});

async function handleMessage(req, res) {
  const body = await readJson(req);
  if (!body) return json(res, 400, { error: 'bad_json', message: 'Send a JSON body: { "sessionId": "...", "text": "..." }' });
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!sessionId) return json(res, 400, { error: 'session_required', message: 'sessionId must be a non-empty string' });
  if (!text) return json(res, 400, { error: 'text_required', message: 'text must be a non-empty string' });
  // Optional extras only our chat page sends: a photo for this turn, and the browser's location.
  const image = body.image == null ? null : validImage(body.image);
  if (body.image != null && !image) {
    return json(res, 400, { error: 'bad_image', message: `image must be { mediaType: ${IMAGE_TYPES.join('|')}, data: base64 up to 5 MB }` });
  }
  const session = getSession(sessionId);
  if (image) session.state.turnImage = image;
  const location = validLocation(body.location);
  if (location) session.state.userLocation = { ...location, at: Date.now() };

  const startedAt = Date.now();
  let parts;
  try {
    const turn = async () => {
      await prepareTurn(session);
      return respond({ sessionId, text, session });
    };
    parts = await withDeadline(turn(), TURN_DEADLINE_MS);
  } catch (err) {
    const timedOut = err?.code === 'DEADLINE';
    console.error(`[turn ${sessionId.slice(0, 8)}] failed after ${Date.now() - startedAt}ms:`, timedOut ? err.message : err);
    return json(res, timedOut ? 504 : 500, { error: timedOut ? 'agent_timeout' : 'agent_error', message: err?.message ?? String(err) });
  }

  const clean = Array.isArray(parts) ? parts.filter(isPart) : [];
  if (clean.length === 0) {
    return json(res, 500, { error: 'no_parts', message: 'respond() returned no valid parts. See docs/contract.md for the shapes.' });
  }
  if (!clean.some((p) => p.kind === 'text')) {
    console.warn(`[turn ${sessionId.slice(0, 8)}] reply has no text part; the contract asks for at least one`);
  }
  console.log(`[turn ${sessionId.slice(0, 8)}] ${Date.now() - startedAt}ms  "${text.slice(0, 60)}" -> ${clean.map((p) => p.kind).join(',')}`);
  return json(res, 200, { parts: clean });
}

async function handleReset(req, res) {
  const body = await readJson(req);
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return json(res, 400, { error: 'session_required', message: 'sessionId must be a non-empty string' });
  resetSession(sessionId);
  return json(res, 200, { ok: true });
}

const SEARCH_FILTERS = ['q', 'city', 'kind', 'category', 'guests', 'date', 'limit'];
const QUOTE_FIELDS = ['listingId', 'date', 'startTime', 'endTime', 'guestCount', 'packageIds'];
// ponytail: unbounded cache. Fine while the catalogue is fixed; it keeps the site
// from spending the 240/min sandbox budget the agent needs.
const catalogueCache = new Map();

/**
 * Read-only window onto the sandbox for the site: browse, check a date, price
 * it, look up a booking. Booking, cancelling and rescheduling stay with the
 * agent, which confirms with the guest first. The key never leaves the server.
 *
 *   GET  /api/listings?q&city&kind&category&guests&date&limit
 *   GET  /api/listings/:id
 *   GET  /api/listings/:id/availability?date=
 *   POST /api/quotes            { listingId, date, startTime, endTime, guestCount, packageIds? }
 *   GET  /api/bookings/:ref
 */
async function handleApi(req, res, url) {
  const path = url.pathname.slice('/api'.length);
  const id = path.match(/^\/listings\/([a-z0-9-]+)(\/availability)?$/);
  const ref = path.match(/^\/bookings\/(BK-\d+)$/i);
  try {
    if (req.method === 'GET' && path === '/listings') {
      const filters = Object.fromEntries(SEARCH_FILTERS.filter((k) => url.searchParams.get(k)).map((k) => [k, url.searchParams.get(k)]));
      return json(res, 200, await cached(`search?${new URLSearchParams(filters)}`, () => plec.searchListings(filters)));
    }
    if (req.method === 'GET' && id && !id[2]) return json(res, 200, await cached(`listing/${id[1]}`, () => plec.getListing(id[1])));
    if (req.method === 'GET' && id && id[2]) return json(res, 200, await plec.getAvailability(id[1], url.searchParams.get('date')));
    if (req.method === 'POST' && path === '/quotes') {
      const body = await readJson(req);
      if (!body) return json(res, 400, { error: 'bad_json', message: 'Send a JSON body with the quote inputs.' });
      return json(res, 200, await plec.quote(Object.fromEntries(QUOTE_FIELDS.filter((k) => k in body).map((k) => [k, body[k]]))));
    }
    if (req.method === 'GET' && ref) return json(res, 200, await plec.getBooking(ref[1]));
  } catch (err) {
    if (err instanceof PlecError) return json(res, err.status || 502, { error: err.error, message: err.message });
    throw err;
  }
  return json(res, 404, { error: 'not_found', message: `No route ${req.method} ${url.pathname}` });
}

async function cached(key, load) {
  if (!catalogueCache.has(key)) catalogueCache.set(key, await load());
  return catalogueCache.get(key);
}

/** Same validation the evaluator applies, so what you see locally is what staff see. */
function isPart(part) {
  if (!part || typeof part !== 'object') return false;
  switch (part.kind) {
    case 'text': return typeof part.text === 'string';
    case 'card': return typeof part.title === 'string' && Array.isArray(part.photoUrls);
    case 'link': return typeof part.label === 'string' && typeof part.url === 'string';
    case 'image': return typeof part.url === 'string';
    default: return false;
  }
}

function validImage(image) {
  const { mediaType, data } = image ?? {};
  const ok = IMAGE_TYPES.includes(mediaType) && typeof data === 'string' && data.length > 0
    && data.length <= MAX_IMAGE_CHARS && /^[A-Za-z0-9+/]+={0,2}$/.test(data);
  return ok ? { mediaType, data } : null;
}

function validLocation(location) {
  const { lat, lng } = location ?? {};
  const ok = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return ok ? { lat, lng } : null;
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) req.destroy();
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : null); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`The agent took more than ${ms / 1000}s to reply`);
      err.code = 'DEADLINE';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function end(res, status) {
  res.writeHead(status);
  res.end();
}

/** Tiny .env reader: KEY=value lines, # comments, optional quotes. Never overrides a real env var. */
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

server.listen(PORT, () => {
  console.log(`PLEC agent listening on http://localhost:${PORT}`);
  console.log(`Sandbox:     ${process.env.PLEC_SANDBOX_URL || 'https://api.plec.ai/hackathon/sandbox'}  key ${process.env.PLEC_SANDBOX_KEY ? 'set' : 'MISSING (copy it from https://plec.ai/hack/dashboard into .env)'}`);
});
