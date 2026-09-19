import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remember, extractGuest, noteUserText, stateSummary } from '../../agent/state.js';

const newSession = () => ({ messages: [], state: {} });

test('a search stores city, headcount and date, and the summary restates them', () => {
  const s = newSession();
  remember(s, 'search_listings', { city: 'Philadelphia', guests: 60, date: '2026-03-14' }, {
    results: [{ id: 'foundry', name: 'The Foundry' }, { id: 'rooftop', name: 'The Rooftop' }],
    totalMatches: 2,
  });
  assert.equal(s.state.city, 'Philadelphia');
  assert.equal(s.state.guestCount, 60);
  assert.equal(s.state.date, '2026-03-14');
  assert.deepEqual(s.state.lastResults, ['foundry', 'rooftop']);
  assert.equal(s.state.seen.foundry.name, 'The Foundry');
  const summary = stateSummary(s);
  assert.match(summary, /Philadelphia/);
  assert.match(summary, /60/);
});

test('get_listing merges details into seen without touching lastResults', () => {
  const s = newSession();
  remember(s, 'search_listings', { city: 'New York' }, { results: [{ id: 'a', name: 'A' }] });
  remember(s, 'get_listing', { id: 'a' }, { id: 'a', name: 'A', description: 'long' });
  assert.equal(s.state.seen.a.description, 'long');
  assert.deepEqual(s.state.lastResults, ['a']);
});

test('quote stores the quote, date and headcount; the summary shows the total', () => {
  const s = newSession();
  remember(s, 'quote', {}, { quoteId: 'q1', listingId: 'a', date: '2026-10-10', guestCount: 40, totalCents: 181500 });
  assert.equal(s.state.lastQuote.quoteId, 'q1');
  assert.equal(s.state.date, '2026-10-10');
  assert.equal(s.state.guestCount, 40);
  assert.match(stateSummary(s), /\$1,815\.00/);
});

test('book stores the guest and the ref; booking lookups add refs once', () => {
  const s = newSession();
  remember(s, 'book', { guestName: 'Sam Rivera', guestEmail: 'sam@example.com' }, { ref: 'BK-1001', status: 'pending_payment' });
  assert.deepEqual(s.state.guest, { name: 'Sam Rivera', email: 'sam@example.com' });
  remember(s, 'get_booking', { ref: 'BK-1001' }, { ref: 'BK-1001' });
  remember(s, 'list_bookings', {}, { bookings: [{ ref: 'BK-1001' }, { ref: 'BK-1002' }] });
  remember(s, 'cancel_booking', { ref: 'BK-1003' }, { ref: 'BK-1003' });
  assert.deepEqual(s.state.bookingRefs, ['BK-1001', 'BK-1002', 'BK-1003']);
  assert.match(stateSummary(s), /BK-1002/);
});

test('results with an error are skipped', () => {
  const s = newSession();
  remember(s, 'book', { guestName: 'X', guestEmail: 'x@y.com' }, { error: 'blackout', message: 'no' });
  remember(s, 'search_listings', { city: 'Washington' }, { error: 'network', message: 'down' });
  assert.deepEqual(s.state, {});
});

test('extractGuest finds emails and names in common phrasings', () => {
  assert.deepEqual(extractGuest('My name is Sam Rivera, email sam@example.com'), { name: 'Sam Rivera', email: 'sam@example.com' });
  assert.deepEqual(extractGuest("I'm Ana Lopez and my email is ana.l+ev@mail.co"), { name: 'Ana Lopez', email: 'ana.l+ev@mail.co' });
  assert.deepEqual(extractGuest('Sam Rivera, sam@example.com. Yes.'), { name: 'Sam Rivera', email: 'sam@example.com' });
  assert.deepEqual(extractGuest('Me llamo Lucía Pérez, lucia@correo.es'), { name: 'Lucía Pérez', email: 'lucia@correo.es' });
  assert.deepEqual(extractGuest('name: Jo Park'), { name: 'Jo Park' });
  assert.deepEqual(extractGuest("I'm planning a party for 40"), {});
  assert.deepEqual(extractGuest('Book The Foundry for Oct 10'), {});
  assert.deepEqual(extractGuest('reach me at kim@x.org'), { email: 'kim@x.org' });
});

test('noteUserText keeps a partial guest until both halves arrive', () => {
  const s = newSession();
  noteUserText(s, 'My name is Sam Rivera');
  assert.equal(s.state.guest, undefined);
  noteUserText(s, 'sam@example.com');
  assert.deepEqual(s.state.guest, { name: 'Sam Rivera', email: 'sam@example.com' });
});

test('noteUserText picks up city and headcount from the user', () => {
  const s = newSession();
  noteUserText(s, 'Launch party in Philly for 60 in March');
  assert.equal(s.state.city, 'Philadelphia');
  assert.equal(s.state.guestCount, 60);
  assert.equal(s.state.eventType, 'launch party');
  noteUserText(s, 'Hola, necesito un lugar para 50 personas en NYC');
  assert.equal(s.state.city, 'New York');
  assert.equal(s.state.guestCount, 50);
});

test('the summary shows the pending action and the guest on file', () => {
  const s = newSession();
  s.state.guest = { name: 'Sam', email: 'sam@x.com' };
  s.state.pending = { kind: 'book', args: {}, subject: 'The Foundry', at: 1 };
  const summary = stateSummary(s);
  assert.match(summary, /Sam <sam@x\.com>/);
  assert.match(summary, /book.*The Foundry/);
});

test('booking lookups remember each ref\'s listing name', () => {
  const s = newSession();
  remember(s, 'get_booking', { ref: 'BK-1001' }, { ref: 'BK-1001', listingName: 'The Foundry at Fishtown', date: '2026-10-10' });
  assert.equal(s.state.bookingInfo['BK-1001'].listingName, 'The Foundry at Fishtown');
});
