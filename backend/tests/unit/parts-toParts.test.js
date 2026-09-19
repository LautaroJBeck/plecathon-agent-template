import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toParts, cardFor } from '../../agent/parts.js';
import { registerListings } from '../../agent/shared.js';

const catalogue = JSON.parse(readFileSync(new URL('../../data/listings.json', import.meta.url), 'utf8'));
const byId = (id) => catalogue.find((l) => l.id === id);
const FOUNDRY = byId('foundry-fishtown');
const GREENHOUSE = byId('the-greenhouse-uc');
const BALLROOM = byId('old-city-ballroom');

function sessionWith(listings, { user = 'hi', state = {} } = {}) {
  const session = { messages: [{ role: 'user', content: user }], state: { ...state } };
  registerListings(session, listings);
  return session;
}
const kinds = (parts) => parts.map((p) => p.kind);

test('strips tag lines and markdown images, cards the tagged ids', () => {
  const session = sessionWith([FOUNDRY, GREENHOUSE]);
  const text = 'Two good fits:\n![x](https://evil.example/a.png)\nCARDS: foundry-fishtown, the-greenhouse-uc\nphotos: foundry-fishtown';
  const parts = toParts(text, session, []);
  assert.equal(parts[0].text, 'Two good fits:');
  assert.deepEqual(kinds(parts), ['text', 'card', 'card', 'image', 'image', 'image']);
  assert.equal(parts[3].caption, FOUNDRY.name);
});

test('tolerates markdown around the tag', () => {
  const parts = toParts('Here.\n**CARDS:** `foundry-fishtown`', sessionWith([FOUNDRY]), []);
  assert.equal(parts[0].text, 'Here.');
  assert.equal(parts[1].title, FOUNDRY.name);
});

test('unknown ids are dropped, duplicates collapse, at most 6 cards', () => {
  const six = catalogue.filter((l) => l.city === 'Philadelphia').slice(0, 8);
  const session = sessionWith(six);
  const ids = ['made-up-venue', six[0].id, six[0].id, ...six.slice(1).map((l) => l.id)];
  const parts = toParts(`Options:\nCARDS: ${ids.join(', ')}`, session, []);
  const cards = parts.filter((p) => p.kind === 'card');
  assert.equal(cards.length, 6);
  assert.equal(cards[0].title, six[0].name);
  assert.ok(!cards.some((c) => /made-up/i.test(c.title)));
});

test('card title is exactly the listing name; subtitle is numbered facts', () => {
  const card = cardFor({ ...FOUNDRY, mapUrl: 'https://maps.example/f', distanceMiles: 1.2 }, 2);
  assert.equal(card.title, 'The Foundry at Fishtown');
  assert.equal(card.subtitle, '2. loft · Fishtown · 40–150 guests · $300.00/hour · 1.2 mi away');
  assert.equal(card.url, 'https://maps.example/f');
  assert.deepEqual(card.photoUrls, FOUNDRY.photoUrls);
  assert.match(cardFor(BALLROOM, 1).subtitle, /request to book$/);
  assert.equal(cardFor({ name: 'X', pricing: { model: 'perGuest', rateCents: 4500 }, capacity: { max: 30 } }, 1).subtitle, '1. up to 30 guests · $45.00 per guest');
  assert.ok(!('url' in cardFor(FOUNDRY, 1)));
});

test('card carries the listing id so the chat UI can open the full listing', () => {
  assert.equal(cardFor(FOUNDRY, 1).listingId, 'foundry-fishtown');
  assert.ok(!('listingId' in cardFor({ name: 'X' }, 1)));
});

test('empty text falls back to a sentence', () => {
  assert.equal(toParts('CARDS: foundry-fishtown', sessionWith([FOUNDRY]), [])[0].text, "Here's what I found.");
  assert.equal(toParts('', sessionWith([]), [])[0].text, 'Sorry, could you say that again?');
  assert.deepEqual(kinds(toParts(undefined, {}, undefined)), ['text']);
});

const booking = (url, status = 'unpaid') => ({
  ref: 'BK-1001', status: 'pending_payment', totalCents: 181500,
  payment: { url, status, amountCents: 181500 },
});

test('payment URL is added to the text when missing, plus a Pay link', () => {
  const url = 'https://api.plec.ai/hackathon/sandbox/pay/cs_test_1';
  const parts = toParts('Booked! It confirms once you pay.', sessionWith([]), [{ name: 'book', args: {}, result: booking(url) }]);
  assert.equal(parts[0].text, `Booked! It confirms once you pay.\n\nPayment link for BK-1001: ${url}`);
  assert.deepEqual(parts[1], { kind: 'link', label: 'Pay $1,815.00 for BK-1001', url });
});

test('payment URL is not duplicated, and only the last link per ref is used', () => {
  const old = 'https://api.plec.ai/hackathon/sandbox/pay/cs_old';
  const url = 'https://api.plec.ai/hackathon/sandbox/pay/cs_new';
  const turn = [
    { name: 'get_booking', args: {}, result: booking(old) },
    { name: 'resend_payment_link', args: {}, result: booking(url) },
  ];
  const parts = toParts(`Here is a fresh link: ${url}`, sessionWith([]), turn);
  assert.equal(parts[0].text, `Here is a fresh link: ${url}`);
  const links = parts.filter((p) => p.kind === 'link');
  assert.equal(links.length, 1);
  assert.equal(links[0].url, url);
});

test('no payment link when paid, cancelled, or the tool failed', () => {
  const url = 'https://api.plec.ai/hackathon/sandbox/pay/cs_x';
  const turn = [
    { name: 'get_booking', args: {}, result: booking(url, 'paid') },
    { name: 'get_booking', args: {}, result: { ...booking(url), ref: 'BK-1002', status: 'cancelled' } },
    { name: 'book', args: {}, result: { error: 'blackout', message: 'Closed.' } },
  ];
  const parts = toParts('Status is confirmed.', sessionWith([]), turn);
  assert.deepEqual(kinds(parts), ['text']);
  assert.equal(parts[0].text, 'Status is confirmed.');
});

const search = (args, hits) => ({ name: 'search_listings', args, result: { results: hits, totalMatches: hits.length } });

test('search fallback cards results when guests was passed', () => {
  const session = sessionWith([FOUNDRY, GREENHOUSE], { state: { guestCount: 40 } });
  const parts = toParts('Here are some venues.', session, [search({ city: 'Philadelphia', guests: 40 }, [FOUNDRY, GREENHOUSE])]);
  assert.deepEqual(parts.filter((p) => p.kind === 'card').map((c) => c.title), [FOUNDRY.name, GREENHOUSE.name]);
});

test('search fallback skipped when guests was omitted but the headcount is known', () => {
  const session = sessionWith([FOUNDRY, BALLROOM], { state: { guestCount: 40 } });
  const parts = toParts('Here are some venues.', session, [search({ city: 'Philadelphia' }, [FOUNDRY, BALLROOM])]);
  assert.deepEqual(kinds(parts), ['text']);
});

test('search fallback applies without guests while the headcount is unknown', () => {
  const session = sessionWith([FOUNDRY]);
  const parts = toParts('A loft.', session, [search({ city: 'Philadelphia', q: 'loft' }, [FOUNDRY])]);
  assert.deepEqual(kinds(parts), ['text', 'card']);
});

test('search fallback is off when the model sent any tag line', () => {
  const session = sessionWith([FOUNDRY, GREENHOUSE]);
  const parts = toParts('Just this one.\nCARDS: the-greenhouse-uc', session, [search({ guests: 40 }, [FOUNDRY, GREENHOUSE])]);
  assert.deepEqual(parts.filter((p) => p.kind === 'card').map((c) => c.title), [GREENHOUSE.name]);
});

test('photo fallback: user asked for photos and exactly one listing was fetched', () => {
  const session = sessionWith([FOUNDRY], { user: 'Can I see some pictures of the Foundry?' });
  const parts = toParts('Here it is.', session, [{ name: 'get_listing', args: { id: FOUNDRY.id }, result: FOUNDRY }]);
  assert.deepEqual(kinds(parts), ['text', 'image', 'image', 'image']);
  assert.equal(parts[1].url, FOUNDRY.photoUrls[0]);
});

test('no photo fallback when the user did not ask, or two listings were fetched', () => {
  const fetched = [{ name: 'get_listing', args: {}, result: FOUNDRY }];
  assert.deepEqual(kinds(toParts('It holds 150.', sessionWith([FOUNDRY], { user: 'How many fit?' }), fetched)), ['text']);
  const two = [...fetched, { name: 'get_listing', args: {}, result: GREENHOUSE }];
  assert.deepEqual(kinds(toParts('Both.', sessionWith([FOUNDRY, GREENHOUSE], { user: 'photos please' }), two)), ['text']);
});

test('MAP tag adds a map link only when mapUrl is known; email draft adds a mailto link', () => {
  const session = sessionWith([{ ...FOUNDRY, mapUrl: 'https://maps.example/f' }, GREENHOUSE]);
  const mailtoUrl = 'mailto:a@x.com?subject=Hi&body=Yo';
  const parts = toParts('Here.\nMAP: foundry-fishtown, the-greenhouse-uc', session, [
    { name: 'draft_email', args: {}, result: { draft: {}, mailtoUrl, sendingEnabled: false } },
  ]);
  assert.deepEqual(parts.slice(1), [
    { kind: 'link', label: 'Map: The Foundry at Fishtown', url: 'https://maps.example/f' },
    { kind: 'link', label: 'Open the email draft in your mail app', url: mailtoUrl },
  ]);
});
