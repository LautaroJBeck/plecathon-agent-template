import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAffirmative, matches, subjectOf, checkGate, settleGate, noteUserTurn } from '../../agent/gate.js';

test('isAffirmative: clear consent in English and Spanish', () => {
  for (const text of [
    'yes', 'Yes.', 'yep', 'yeah go for it', 'sure', 'Confirm', 'confirmed', 'go ahead', 'Do it', 'please do',
    'sounds good', 'book it', 'book it now', 'ok', 'Okay!', 'correct', "that's right", 'Sam Rivera, sam@example.com. Yes.',
    'sí', 'Si, adelante', 'dale', 'confirmo', 'de acuerdo', 'hazlo', 'Yes, cancel it', 'yes please, go ahead',
  ]) assert.equal(isAffirmative(text), true, text);
});

test('isAffirmative: requests, refusals and hesitations are not consent', () => {
  for (const text of [
    'Book The Foundry for Oct 10', 'cancel BK-1001', 'Move BK-1001 to Oct 24', 'no', 'No thanks', 'not yet', 'wait',
    'yes but wait', 'hold on', 'ok, cancel that', "don't", 'nope', 'what time does it close?', 'is it ok to bring a dog?',
    'I say yesterday was nice', 'sign me up for nothing', 'no, sí no', 'asdkjh qwe', '',
  ]) assert.equal(isAffirmative(text), false, text);
});

const bookArgs = { quoteId: 'q1', listingId: 'foundry', date: '2026-10-10', startTime: '18:00', endTime: '23:00', guestCount: 40, guestName: 'Sam Rivera', guestEmail: 'sam@example.com' };
const sessionWithFoundry = () => ({ messages: [], state: { seen: { foundry: { id: 'foundry', name: 'The Foundry at Fishtown' } } } });

test('matches compares the key args of each gated tool', () => {
  const pending = { kind: 'book', args: bookArgs };
  assert.ok(matches(pending, 'book', { ...bookArgs, quoteId: 'q2', guestCount: '40' }));
  assert.ok(!matches(pending, 'book', { ...bookArgs, date: '2026-10-11' }));
  assert.ok(!matches(pending, 'cancel_booking', { ref: 'BK-1001' }));
  assert.ok(matches({ kind: 'cancel_booking', args: { ref: 'BK-1001' } }, 'cancel_booking', { ref: 'bk-1001' }));
  assert.ok(!matches({ kind: 'reschedule_booking', args: { ref: 'BK-1', date: '2026-10-24' } }, 'reschedule_booking', { ref: 'BK-1', date: '2026-10-25' }));
  assert.ok(matches({ kind: 'send_email', args: { b: 1, a: 2 } }, 'send_email', { a: 2, b: 1 }));
  assert.ok(!matches(null, 'book', bookArgs));
});

test('subjectOf names the listing, the ref, or the email subject', () => {
  const s = sessionWithFoundry();
  assert.equal(subjectOf('book', bookArgs, s), 'The Foundry at Fishtown');
  assert.equal(subjectOf('cancel_booking', { ref: 'BK-1001' }, s), 'BK-1001');
  assert.equal(subjectOf('send_email', { subject: 'Your plan' }, s), 'Your plan');
});

test('a bare "book it" with nothing shown is blocked and sets pending', () => {
  const s = sessionWithFoundry();
  const gate = checkGate('book', bookArgs, { session: s, userText: 'book it', prevAssistantText: '' });
  assert.equal(gate.allow, false);
  assert.equal(gate.result.error, 'needs_confirmation');
  assert.equal(s.state.pending.kind, 'book');
  assert.equal(s.state.pending.subject, 'The Foundry at Fishtown');
});

test('a request with details but no yes is blocked', () => {
  const s = sessionWithFoundry();
  const gate = checkGate('book', bookArgs, { session: s, userText: 'Book The Foundry at Fishtown for October 10 from 6pm to 11pm for 40 people.', prevAssistantText: '' });
  assert.equal(gate.allow, false);
});

test('"yes" after a pending book is allowed, and success clears pending', () => {
  const s = sessionWithFoundry();
  checkGate('book', bookArgs, { session: s, userText: 'Book it for Sam Rivera, sam@example.com', prevAssistantText: '' });
  const gate = checkGate('book', { ...bookArgs, quoteId: 'q9' }, { session: s, userText: 'yes', prevAssistantText: 'It is $1,815.00 all in. Shall I book it?' });
  assert.equal(gate.allow, true);
  settleGate(s, 'book', { ref: 'BK-1001', status: 'pending_payment' });
  assert.equal(s.state.pending, null);
});

test('a failed gated call does not mark pending as done', () => {
  const s = sessionWithFoundry();
  s.state.pending = { kind: 'book', args: bookArgs, subject: 'The Foundry at Fishtown', at: 1 };
  const gate = checkGate('book', bookArgs, { session: s, userText: 'yes', prevAssistantText: '' });
  assert.equal(gate.allow, true);
  settleGate(s, 'book', { error: 'blackout', message: 'Not available' });
  assert.equal(s.state.pending.kind, 'book');
});

test('details, identity and "yes, go ahead" in one message are allowed on the first call', () => {
  const s = sessionWithFoundry();
  const userText = 'Book The Foundry at Fishtown on October 10, 6pm to 11pm for 40. My name is Sam Rivera, sam@example.com. Yes, go ahead.';
  const gate = checkGate('book', bookArgs, { session: s, userText, prevAssistantText: '' });
  assert.equal(gate.allow, true);
});

test('"yes" to an unrelated question about a different listing is blocked', () => {
  const s = sessionWithFoundry();
  const gate = checkGate('book', bookArgs, { session: s, userText: 'yes', prevAssistantText: 'Would you like details on Brick Lens Studio?' });
  assert.equal(gate.allow, false);
});

test('"yes" after the assistant named the booking ref allows a cancel', () => {
  const s = sessionWithFoundry();
  const gate = checkGate('cancel_booking', { ref: 'BK-1001' }, { session: s, userText: 'yes', prevAssistantText: 'BK-1001 is The Foundry on October 10. Cancel it? The refund is $1,815.00.' });
  assert.equal(gate.allow, true);
});

test('the assistant naming the short listing name counts as the subject', () => {
  const s = sessionWithFoundry();
  const gate = checkGate('book', bookArgs, { session: s, userText: 'sounds good', prevAssistantText: 'The Foundry comes to $1,815.00 all in. Shall I book it?' });
  assert.equal(gate.allow, true);
});

test('"no" or a change clears pending', () => {
  for (const text of ['no', 'No thanks, not now', 'actually make it 50 people', 'hold on']) {
    const s = sessionWithFoundry();
    s.state.pending = { kind: 'book', args: bookArgs, subject: 'The Foundry at Fishtown', at: 1 };
    noteUserTurn(s, text);
    assert.equal(s.state.pending, null, text);
  }
  const s = sessionWithFoundry();
  s.state.pending = { kind: 'book', args: bookArgs, subject: 'x', at: 1 };
  noteUserTurn(s, 'yes');
  assert.ok(s.state.pending);
});

test('book without guest details asks for them, or fills them from state', () => {
  const s = sessionWithFoundry();
  const noGuest = { ...bookArgs, guestName: '', guestEmail: 'not-an-email' };
  const gate = checkGate('book', noGuest, { session: s, userText: 'yes go ahead with The Foundry at Fishtown', prevAssistantText: '' });
  assert.equal(gate.allow, false);
  assert.equal(gate.result.error, 'guest_details_required');
  assert.equal(s.state.pending.kind, 'book');

  s.state.guest = { name: 'Sam Rivera', email: 'sam@example.com' };
  const again = checkGate('book', noGuest, { session: s, userText: 'yes', prevAssistantText: '' });
  assert.equal(again.allow, true);
  assert.equal(again.args.guestName, 'Sam Rivera');
  assert.equal(again.args.guestEmail, 'sam@example.com');
});

test('ungated tools pass straight through', () => {
  const s = sessionWithFoundry();
  const gate = checkGate('quote', { listingId: 'foundry' }, { session: s, userText: 'price?', prevAssistantText: '' });
  assert.deepEqual(gate, { allow: true, args: { listingId: 'foundry' } });
});

test('"yes" after the assistant named the booked listing (not the ref) allows a cancel', () => {
  const s = sessionWithFoundry();
  s.state.bookingInfo = { 'BK-1001': { listingName: 'The Foundry at Fishtown', date: '2026-10-10' } };
  const gate = checkGate('cancel_booking', { ref: 'BK-1001' }, { session: s, userText: 'yes', prevAssistantText: 'This booking is for The Foundry at Fishtown on October 10. Shall I cancel it?' });
  assert.equal(gate.allow, true);
});
