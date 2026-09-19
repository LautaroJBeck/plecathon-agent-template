import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { plec } from '../../agent/plec.js';
import { callExtraTool, catalogue } from '../../agent/extras.js';

const realListBookings = plec.listBookings;
afterEach(() => { plec.listBookings = realListBookings; });
const byId = new Map(catalogue().map((l) => [l.id, l]));

test('recommend_from_history profiles past bookings and explains each pick', async () => {
  let asked;
  plec.listBookings = async (filters) => {
    asked = filters;
    return { bookings: [{ listingId: 'foundry-fishtown', status: 'confirmed' }, { listingId: 'the-greenhouse-uc', status: 'cancelled' }] };
  };
  const session = { state: { guest: { name: 'Sam', email: 'sam@example.com' }, guestCount: 40 } };
  const r = await callExtraTool('recommend_from_history', {}, { session });
  assert.deepEqual(asked, { guestEmail: 'sam@example.com' });
  assert.deepEqual(r.basedOn, ['The Foundry at Fishtown', 'The Greenhouse']);
  assert.ok(r.results.length > 0);
  for (const h of r.results) {
    assert.ok(!['foundry-fishtown', 'the-greenhouse-uc'].includes(h.id), 'already booked');
    const l = byId.get(h.id);
    assert.ok(l.city === 'Philadelphia' && l.capacity.min <= 40 && l.capacity.max >= 40, h.id);
    assert.match(h.because, /^Similar to (The Foundry at Fishtown|The Greenhouse): \S/);
  }
  assert.deepEqual(session.state.lastResults, r.results.map((h) => h.id));
});

test('recommend_from_history needs an email, and says when there is no history', async () => {
  assert.equal((await callExtraTool('recommend_from_history', {}, { session: { state: {} } })).error, 'email_required');
  plec.listBookings = async () => ({ bookings: [] });
  const r = await callExtraTool('recommend_from_history', { guestEmail: 'new@example.com' }, { session: { state: {} } });
  assert.deepEqual(r, { results: [], message: 'No past bookings for this email.' });
});
