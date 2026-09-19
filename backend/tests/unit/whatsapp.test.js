import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleWebhook, incomingMessages, subscriptionChallenge, toWhatsApp, validSignature } from '../../agent/whatsapp.js';

const ENV = {
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  WHATSAPP_APP_SECRET: 'app-secret',
  WHATSAPP_ACCESS_TOKEN: 'EAAtoken',
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_API_URL: 'https://graph.test/v23.0',
};
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;
let sent;

beforeEach(() => {
  Object.assign(process.env, ENV);
  sent = [];
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.startsWith(ENV.WHATSAPP_API_URL)) {
      sent.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) });
      return Response.json({ messages: [{ id: `wamid.out${sent.length}` }] });
    }
    if (url.startsWith('https://picsum.test/')) {
      return new Response(null, { status: 302, headers: { location: `https://cdn.test/${url.split('/').pop()}.jpg` } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
});

const delivery = (...messages) => ({
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA',
    changes: [{
      field: 'messages',
      value: { messaging_product: 'whatsapp', metadata: { phone_number_id: ENV.WHATSAPP_PHONE_NUMBER_ID }, messages },
    }],
  }],
});
let n = 0;
const textFrom = (from, body) => ({ from, id: `wamid.in${(n += 1)}`, timestamp: '1', type: 'text', text: { body } });
const messagesSent = () => sent.filter((s) => s.body.type).map((s) => s.body);

test('subscription check echoes the challenge only for the right token', () => {
  const q = (token) => new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': '1158201444' });
  assert.equal(subscriptionChallenge(q('verify-me')), '1158201444');
  assert.equal(subscriptionChallenge(q('nope')), null);
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  assert.equal(subscriptionChallenge(q('')), null);
});

test('signature is HMAC-SHA256 of the raw body under the app secret', () => {
  const raw = Buffer.from(JSON.stringify(delivery(textFrom('15550001111', 'héllo 👋'))));
  const header = `sha256=${createHmac('sha256', 'app-secret').update(raw).digest('hex')}`;
  assert.equal(validSignature(raw, header), true);
  assert.equal(validSignature(Buffer.concat([raw, Buffer.from(' ')]), header), false);
  assert.equal(validSignature(raw, 'sha256=00'), false);
  assert.equal(validSignature(raw, undefined), false);
  assert.equal(validSignature(raw, header, ''), false);
});

test('incoming messages: text and button replies read, other kinds flagged, other numbers skipped', () => {
  const payload = delivery(
    textFrom('15550001111', '  Show me venues in Philadelphia '),
    { from: '15550001111', id: 'wamid.b', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Yes' } } },
    { from: '15550001111', id: 'wamid.c', type: 'image', image: { id: 'media1' } },
  );
  payload.entry[0].changes.push({ field: 'messages', value: { metadata: { phone_number_id: 'someone-else' }, messages: [textFrom('1', 'x')] } });
  payload.entry[0].changes.push({ field: 'messages', value: { statuses: [{ id: 'wamid.out', status: 'delivered' }] } });
  assert.deepEqual(incomingMessages(payload).map(({ from, text }) => [from, text]), [
    ['15550001111', 'Show me venues in Philadelphia'],
    ['15550001111', 'Yes'],
    ['15550001111', null],
  ]);
});

const card = (title, sub, photo, url) => ({ kind: 'card', title, subtitle: sub, photoUrls: photo ? [photo] : [], ...(url ? { url } : {}) });

test('parts become one text, then one captioned photo per card', () => {
  const pay = 'https://api.plec.ai/hackathon/sandbox/pay/cs_1';
  const parts = [
    { kind: 'text', text: `Booked **BK-1001**. It confirms once you pay: ${pay}` },
    { kind: 'link', label: 'Pay $1,815.00 for BK-1001', url: pay },
    { kind: 'link', label: 'Map: The Foundry', url: 'https://maps.test/foundry' },
    { kind: 'link', label: 'Open the email draft in your mail app', url: 'mailto:a@x.com?subject=Hi' },
    card('The Foundry at Fishtown', '1. loft · Fishtown · 40–150 guests', 'https://picsum.test/foundry', 'https://maps.test/foundry'),
    card('Walnut Street Parlor', '2. private dining', null),
    { kind: 'image', url: 'https://picsum.test/parlor', caption: 'Walnut Street Parlor' },
  ];
  assert.deepEqual(toWhatsApp(parts), [
    { type: 'text', text: { body: `Booked *BK-1001*. It confirms once you pay: ${pay}\n\nMap: The Foundry: https://maps.test/foundry`, preview_url: false } },
    { type: 'image', image: { link: 'https://picsum.test/foundry', caption: '*The Foundry at Fishtown*\n1. loft · Fishtown · 40–150 guests\nhttps://maps.test/foundry' } },
    { type: 'text', text: { body: '*Walnut Street Parlor*\n2. private dining', preview_url: false } },
    { type: 'image', image: { link: 'https://picsum.test/parlor', caption: 'Walnut Street Parlor' } },
  ]);
});

test('a message runs one turn in the sender session and the reply goes back through the Cloud API', async () => {
  const turns = [];
  const turn = async (sessionId, text) => {
    turns.push([sessionId, text]);
    return [{ kind: 'text', text: 'Two lofts that fit 40:' }, card('The Foundry at Fishtown', '1. loft', 'https://picsum.test/f1')];
  };
  const msg = textFrom('15550001111', 'Venues in Philadelphia for 40');
  await handleWebhook(delivery(msg), turn);
  await handleWebhook(delivery(msg), turn); // Meta redelivery: answered once

  assert.deepEqual(turns, [['whatsapp:15550001111', 'Venues in Philadelphia for 40']]);
  assert.ok(sent.every((s) => s.url === 'https://graph.test/v23.0/1234567890/messages' && s.auth === 'Bearer EAAtoken'));
  assert.deepEqual(sent[0].body, { messaging_product: 'whatsapp', status: 'read', message_id: msg.id, typing_indicator: { type: 'text' } });
  assert.deepEqual(messagesSent(), [
    { messaging_product: 'whatsapp', recipient_type: 'individual', to: '15550001111', type: 'text', text: { body: 'Two lofts that fit 40:', preview_url: false } },
    { messaging_product: 'whatsapp', recipient_type: 'individual', to: '15550001111', type: 'image', image: { link: 'https://cdn.test/f1.jpg', caption: '*The Foundry at Fishtown*\n1. loft' } },
  ]);
});

test('one sender is answered in order; unreadable kinds and failed turns still get a reply', async () => {
  const log = [];
  const turn = async (_, text) => {
    log.push(`start ${text}`);
    await new Promise((r) => setTimeout(r, text === 'first' ? 20 : 0));
    log.push(`end ${text}`);
    if (text === 'boom') throw new Error('deadline');
    return [{ kind: 'text', text: `re: ${text}` }];
  };
  await Promise.all([
    handleWebhook(delivery(textFrom('1555', 'first')), turn),
    handleWebhook(delivery(textFrom('1555', 'second')), turn),
  ]);
  assert.deepEqual(log, ['start first', 'end first', 'start second', 'end second']);

  await handleWebhook(delivery({ from: '1555', id: 'wamid.voice', type: 'audio', audio: { id: 'm' } }), turn);
  await handleWebhook(delivery(textFrom('1555', 'boom')), turn);
  assert.deepEqual(messagesSent().map((m) => m.text.body), [
    're: first',
    're: second',
    'I can only read text messages here for now. What are you planning?',
    'Sorry, something went wrong on my side. Could you send that again?',
  ]);
});

test('without the access token or number id nothing runs', async () => {
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  let ran = false;
  await handleWebhook(delivery(textFrom('1555', 'hi')), async () => { ran = true; return []; });
  assert.equal(ran, false);
  assert.equal(sent.length, 0);
});
