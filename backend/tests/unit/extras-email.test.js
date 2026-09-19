import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callExtraTool, gatedExtraTools } from '../../agent/extras.js';
import { toParts } from '../../agent/parts.js';

const ENV = ['RESEND_API_KEY', 'EMAIL_FROM'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;
beforeEach(() => ENV.forEach((k) => delete process.env[k]));
afterEach(() => {
  globalThis.fetch = realFetch;
  ENV.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
});

const draftArgs = { to: ['a@x.com', 'b@y.com'], subject: 'Venues & dates?', body: 'Option 1: The Foundry\nOption 2: Walnut Street Parlor', purpose: 'share_options' };
const run = (name, args, session) => callExtraTool(name, args, { session });

test('send_email is gated', () => assert.deepEqual(gatedExtraTools, ['send_email']));

test('draft_email validates recipients, subject and body', async () => {
  const s = { state: {} };
  assert.equal((await run('draft_email', { ...draftArgs, to: [] }, s)).error, 'bad_recipients');
  assert.equal((await run('draft_email', { ...draftArgs, to: ['not-an-email'] }, s)).error, 'bad_recipients');
  assert.equal((await run('draft_email', { ...draftArgs, to: Array.from({ length: 11 }, (_, i) => `p${i}@x.com`) }, s)).error, 'bad_recipients');
  assert.equal((await run('draft_email', { ...draftArgs, subject: ' ' }, s)).error, 'bad_subject');
  assert.equal((await run('draft_email', { ...draftArgs, subject: 'x'.repeat(151) }, s)).error, 'bad_subject');
  assert.equal((await run('draft_email', { ...draftArgs, body: 'x'.repeat(2001) }, s)).error, 'bad_body');
  assert.ok(!('emailDraft' in s.state));
});

test('draft_email stores the draft and encodes the mailto link', async () => {
  const s = { messages: [], state: {} };
  const r = await run('draft_email', draftArgs, s);
  assert.deepEqual(s.state.emailDraft, { to: draftArgs.to, subject: draftArgs.subject, body: draftArgs.body });
  assert.equal(r.mailtoUrl, 'mailto:a@x.com,b@y.com?subject=Venues%20%26%20dates%3F&body=Option%201%3A%20The%20Foundry%0AOption%202%3A%20Walnut%20Street%20Parlor');
  assert.equal(r.sendingEnabled, false);
  const link = toParts('Here is the draft.', s, [{ name: 'draft_email', args: draftArgs, result: r }])[1];
  assert.deepEqual(link, { kind: 'link', label: 'Open the email draft in your mail app', url: r.mailtoUrl });
});

test('send_email refuses a mismatched or missing draft, and says when sending is off', async () => {
  const s = { state: {} };
  assert.equal((await run('send_email', { to: draftArgs.to, subject: draftArgs.subject }, s)).error, 'draft_mismatch');
  await run('draft_email', draftArgs, s);
  assert.equal((await run('send_email', { to: ['a@x.com'], subject: draftArgs.subject }, s)).error, 'draft_mismatch');
  assert.equal((await run('send_email', { to: draftArgs.to, subject: 'Other' }, s)).error, 'draft_mismatch');
  assert.equal((await run('send_email', { to: ['B@y.com', 'a@x.com'], subject: draftArgs.subject }, s)).error, 'sending_disabled');
});

test('send_email posts the draft to Resend once', async () => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.EMAIL_FROM = 'PLEC <hello@plec.test>';
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url, init };
    return new Response(JSON.stringify({ id: 'em_123' }), { status: 200 });
  };
  const s = { state: {} };
  await run('draft_email', draftArgs, s);
  const r = await run('send_email', { to: draftArgs.to, subject: draftArgs.subject }, s);
  assert.deepEqual(r, { sent: true, id: 'em_123', to: draftArgs.to });
  assert.equal(call.url, 'https://api.resend.com/emails');
  assert.equal(call.init.headers.Authorization, 'Bearer re_test');
  assert.deepEqual(JSON.parse(call.init.body), { from: 'PLEC <hello@plec.test>', to: draftArgs.to, subject: draftArgs.subject, text: draftArgs.body });
  assert.equal((await run('send_email', { to: draftArgs.to, subject: draftArgs.subject }, s)).error, 'draft_mismatch', 'no double send');
});

test('send_email reports a Resend failure', async () => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.EMAIL_FROM = 'hello@plec.test';
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Domain not verified' }), { status: 403 });
  const s = { state: {} };
  await run('draft_email', draftArgs, s);
  assert.deepEqual(await run('send_email', { to: draftArgs.to, subject: draftArgs.subject }, s), { error: 'send_failed', message: 'Domain not verified' });
});
