import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { googleCalendarUrl, toIcs, calendarLinks } from '../../agent/calendar.js';
import { toParts } from '../../agent/parts.js';
import { registerListings } from '../../agent/shared.js';

const catalogue = JSON.parse(readFileSync(new URL('../../data/listings.json', import.meta.url), 'utf8'));
const FOUNDRY = catalogue.find((l) => l.id === 'foundry-fishtown');

const PAY_URL = 'https://api.plec.ai/hackathon/sandbox/pay/cs_test_1';
const booking = (over = {}) => ({
  ref: 'BK-1001', listingId: 'foundry-fishtown', listingName: 'The Foundry at Fishtown',
  status: 'pending_payment', date: '2026-10-10', startTime: '18:00', endTime: '23:00', guestCount: 40,
  totalCents: 181500, payment: { url: PAY_URL, status: 'unpaid', amountCents: 181500 }, ...over,
});
function session() {
  const s = { messages: [{ role: 'user', content: 'yes, book it' }], state: {} };
  registerListings(s, [FOUNDRY]);
  return s;
}
const links = (parts) => parts.filter((p) => p.kind === 'link');

test('google calendar url carries the local times, time zone, title and address', () => {
  const url = new URL(googleCalendarUrl(booking(), FOUNDRY));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('dates'), '20261010T180000/20261010T230000');
  assert.equal(url.searchParams.get('ctz'), 'America/New_York');
  assert.match(url.searchParams.get('text'), /^The Foundry at Fishtown \(BK-1001\) \(tentative until paid\)$/);
  assert.equal(url.searchParams.get('location'), FOUNDRY.address);
  assert.match(url.searchParams.get('details'), /40 guests/);
});

test('confirmed bookings have no tentative note; requested ones wait on the host', () => {
  assert.equal(new URL(googleCalendarUrl(booking({ status: 'confirmed' }), FOUNDRY)).searchParams.get('text'), 'The Foundry at Fishtown (BK-1001)');
  assert.match(new URL(googleCalendarUrl(booking({ status: 'requested' }), FOUNDRY)).searchParams.get('text'), /tentative until the host approves/);
});

test('ics is RFC 5545 shaped: CRLF, tz-anchored times, stable uid, status', () => {
  const ics = toIcs(booking(), FOUNDRY);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every newline is CRLF');
  assert.match(ics, /\r\nBEGIN:VTIMEZONE\r\nTZID:America\/New_York\r\n/);
  assert.match(ics, /\r\nUID:BK-1001@plec\r\n/);
  assert.match(ics, /\r\nDTSTART;TZID=America\/New_York:20261010T180000\r\n/);
  assert.match(ics, /\r\nDTEND;TZID=America\/New_York:20261010T230000\r\n/);
  assert.match(ics, /\r\nSTATUS:TENTATIVE\r\n/);
  assert.match(toIcs(booking({ status: 'confirmed' }), FOUNDRY), /\r\nSTATUS:CONFIRMED\r\n/);
});

test('ics escapes text and folds long lines', () => {
  const ics = toIcs(booking({ listingName: 'Bar; Grill, and\nMore' }), { address: 'x'.repeat(200) });
  assert.match(ics, /SUMMARY:Bar\\; Grill\\, and\\nMore/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line.length}`);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, new RegExp(`LOCATION:${'x'.repeat(200)}\\r\\n`));
});

test('calendarLinks only for live statuses, with neutral labels', () => {
  for (const status of ['pending_payment', 'requested', 'confirmed']) {
    const out = calendarLinks(booking({ status }), FOUNDRY);
    assert.deepEqual(out.map((l) => l.label), ['Add to Google Calendar', 'Download calendar file (.ics)']);
    assert.equal(out[1].url, '/api/bookings/BK-1001/calendar.ics');
    for (const l of out) assert.doesNotMatch(l.label, /confirm|paid|booked|\$/i);
  }
  assert.deepEqual(calendarLinks(booking({ status: 'cancelled' }), FOUNDRY), []);
  assert.deepEqual(calendarLinks({ ref: 'BK-1' }, FOUNDRY), [], 'no date or times, no links');
});

test('toParts adds calendar links after the payment link, and keeps the pay URL in the text', () => {
  const parts = toParts('Held for you.', session(), [{ name: 'book', args: {}, result: booking() }]);
  assert.ok(parts[0].text.includes(PAY_URL));
  assert.deepEqual(links(parts).map((l) => l.label), ['Pay $1,815.00 for BK-1001', 'Add to Google Calendar', 'Download calendar file (.ics)']);
});

test('toParts: request-to-book gets calendar links without a payment link', () => {
  const parts = toParts('Sent to the host.', session(), [{ name: 'book', args: {}, result: booking({ status: 'requested', payment: null }) }]);
  assert.deepEqual(links(parts).map((l) => l.label), ['Add to Google Calendar', 'Download calendar file (.ics)']);
});

test('toParts: the latest result per ref wins after a reschedule; cancelled gets none', () => {
  const moved = booking({ date: '2026-10-11' });
  const parts = toParts('Moved.', session(), [
    { name: 'get_booking', args: {}, result: booking() },
    { name: 'reschedule_booking', args: {}, result: moved },
  ]);
  const google = links(parts).filter((l) => l.label === 'Add to Google Calendar');
  assert.equal(google.length, 1);
  assert.match(google[0].url, /dates=20261011T180000/);

  const cancelled = toParts('Cancelled.', session(), [{ name: 'get_booking', args: {}, result: booking({ status: 'cancelled' }) }]);
  assert.deepEqual(links(cancelled), []);
});

test('toParts: search and cancel tools never produce calendar links', () => {
  const parts = toParts('Done.', session(), [{ name: 'cancel_booking', args: {}, result: booking({ status: 'cancelled' }) }]);
  assert.deepEqual(links(parts), []);
});
