/**
 * Local runner for the hidden-suite themes (PRD A, A7). Dependency-free.
 *
 *   node backend/tests/local/run.js            every local scenario
 *   node backend/tests/local/run.js cancel     one scenario by id
 *
 * Per scenario: reset the sandbox, seed bookings (quote + book) and price the
 * named setup quotes, post each turn to AGENT_URL with a fresh sessionId, then
 * evaluate the checks the way docs/checks.md defines them. Burns model quota:
 * run single scenarios while iterating.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(dirname(HERE)));
loadDotEnv(join(ROOT, '.env'));
const { plec } = await import('../../agent/plec.js');

const AGENT_URL = (process.env.AGENT_URL || `http://localhost:${process.env.AGENT_PORT || 8787}`).replace(/\/+$/, '');
const TURN_TIMEOUT_MS = 45_000;
const ONLY = process.argv[2];

const { scenarios: all } = JSON.parse(readFileSync(join(HERE, 'scenarios.json'), 'utf8'));
const scenarios = ONLY ? all.filter((s) => s.id === ONLY) : all;
if (!scenarios.length) {
  console.error(`No local scenario "${ONLY}". Available: ${all.map((s) => s.id).join(', ')}`);
  process.exit(2);
}

let passedScenarios = 0, passedChecks = 0, totalChecks = 0;
for (const scenario of scenarios) {
  console.log(`\n== ${scenario.id}: ${scenario.title}`);
  let quotes;
  try {
    quotes = await setUp(scenario.setup ?? {});
  } catch (err) {
    console.log(`   SETUP FAILED: ${err.message}`);
    totalChecks += 1;
    continue;
  }
  const sessionId = `local-${scenario.id}-${Date.now()}`;
  let ok = true;
  for (const turn of scenario.turns) {
    const started = Date.now();
    const { parts, error } = await post(sessionId, turn.user);
    const ms = Date.now() - started;
    const bookings = (await plec.listBookings()).bookings ?? [];
    console.log(`   > ${turn.user}`);
    console.log(`   < ${error ? `ERROR ${error}` : flatten(parts).replace(/\n/g, ' | ')}  (${(ms / 1000).toFixed(1)}s)`);
    for (const check of turn.expect) {
      const { pass, detail } = error ? { pass: false, detail: 'no reply' } : evaluate(check, parts, bookings, quotes);
      totalChecks += 1;
      if (pass) passedChecks += 1; else ok = false;
      console.log(`     ${pass ? 'PASS' : 'FAIL'}  ${label(check)}${detail ? `  (${detail})` : ''}`);
    }
  }
  if (ok) passedScenarios += 1;
}
console.log(`\n${passedScenarios} of ${scenarios.length} scenarios passed, ${passedChecks} of ${totalChecks} checks`);
process.exit(passedChecks === totalChecks ? 0 : 1);

/** Reset, seed bookings in order (BK-1001 first), price the named quotes. */
async function setUp(setup) {
  await plec.reset();
  for (const seed of setup.seedBookings ?? []) {
    const { guestName, guestEmail, notes, ...inputs } = seed;
    const quote = await plec.quote(inputs);
    await plec.book({ ...inputs, quoteId: quote.quoteId, guestName, guestEmail, notes });
  }
  const quotes = {};
  for (const [name, inputs] of Object.entries(setup.quotes ?? {})) quotes[name] = await plec.quote(inputs);
  return quotes;
}

async function post(sessionId, text) {
  try {
    const res = await fetch(`${AGENT_URL}/agent/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, text }),
      signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body?.parts)) return { error: `HTTP ${res.status} ${body?.message ?? ''}` };
    return { parts: body.parts };
  } catch (err) {
    return { error: err?.message ?? String(err) };
  }
}

/** docs/checks.md: text, card title and subtitle, link label, image caption. */
function flatten(parts) {
  return parts.flatMap((p) => {
    if (p.kind === 'text') return [p.text];
    if (p.kind === 'card') return [p.title, p.subtitle];
    if (p.kind === 'link') return [p.label];
    if (p.kind === 'image') return [p.caption];
    return [];
  }).filter(Boolean).join('\n');
}

function evaluate(check, parts, bookings, quotes) {
  const reply = flatten(parts);
  const lower = reply.toLowerCase();
  switch (check.type) {
    case 'replyIncludesAny': {
      const hit = check.values.find((v) => lower.includes(v.toLowerCase()));
      return { pass: Boolean(hit), detail: hit ? `found "${hit}"` : 'none found' };
    }
    case 'replyExcludesAll': {
      const hit = check.values.find((v) => lower.includes(v.toLowerCase()));
      return { pass: !hit, detail: hit ? `found "${hit}"` : '' };
    }
    case 'replyMatches':
      return { pass: new RegExp(check.pattern, check.flags ?? 'i').test(reply) };
    case 'hasPart': {
      const n = parts.filter((p) => p.kind === check.kind).length;
      return { pass: n >= (check.min ?? 1), detail: `${n} ${check.kind} parts` };
    }
    case 'hasPartAny':
      return { pass: parts.some((p) => check.kinds.includes(p.kind)) };
    case 'asksQuestion':
      return { pass: parts.some((p) => p.kind === 'text' && p.text.includes('?')) };
    case 'mentionsAmountCents': {
      const cents = check.cents ?? quotes[check.quote]?.totalCents;
      if (cents == null) return { pass: false, detail: `no quote "${check.quote}"` };
      return { pass: mentionsAmount(reply, cents), detail: `expected ${cents} cents` };
    }
    case 'sandboxBookings': {
      const n = bookings.filter((b) => (!check.status || b.status === check.status)
        && (!check.listingId || b.listingId === check.listingId)
        && (!check.date || b.date === check.date)).length;
      const pass = check.count === undefined ? n >= 1 : n === check.count;
      return { pass, detail: `${n} matching of ${bookings.length}: ${bookings.map((b) => `${b.ref} ${b.status} ${b.date}`).join(', ')}` };
    }
    default:
      return { pass: false, detail: `unknown check ${check.type}` };
  }
}

/** "$1,815", "$1,815.00", "1815", "1,815.00" all pass for 181500; "18150" does not. */
function mentionsAmount(reply, cents) {
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  const forms = [String(whole), whole.toLocaleString('en-US')];
  const tail = frac === '00' ? '(?:\\.00)?' : `\\.${frac}`;
  return forms.some((w) => new RegExp(`(?<![\\d.,])${w.replace(/,/g, ',')}${tail}(?![\\d]|[.,]\\d)`).test(reply));
}

function label(check) {
  const { type, ...rest } = check;
  return `${type} ${JSON.stringify(rest)}`;
}

/** Same tiny .env reader as backend/tests/run.js. Never overrides a real env var. */
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
