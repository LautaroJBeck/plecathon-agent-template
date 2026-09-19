import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callExtraTool } from '../../agent/extras.js';
import { median } from '../../agent/market.js';

test('market_insights for Philadelphia rooftops matches a hand count', async () => {
  // rooftop-at-rittenhouse $450/h min 3h, university-city-terrace $380/h min 3h,
  // northern-liberties-rooftop-garden $190/h min 2h (flexible, in-house bar only)
  const session = { state: {} };
  const r = await callExtraTool('market_insights', { city: 'Philadelphia', category: 'rooftop' }, { session });
  assert.equal(r.basis, 'PLEC catalogue, 3 comparable listings');
  assert.deepEqual(r.pricing, {
    hourly: {
      n: 3, minCents: 19000, medianCents: 38000, maxCents: 45000,
      min: '$190.00/hour', median: '$380.00/hour', max: '$450.00/hour',
      typicalMinHours: 3, peakShare: '0%',
    },
  });
  assert.deepEqual(r.capacity, { minOfMins: 10, maxOfMaxes: 100 });
  assert.equal(r.instantBookShare, '100%');
  assert.deepEqual(r.policyMix, { moderate: 2, flexible: 1 });
  assert.equal(r.alcoholMix.in_house_only, 1);
  assert.equal(r.topAmenities.length, 6);
  assert.equal(r.competitors[0].name, 'The Rooftop at Rittenhouse');
  assert.ok(!('note' in r));
  assert.deepEqual(session.state.lastResults, r.competitors.map((c) => c.id));
  assert.ok(session.state.seen['rooftop-at-rittenhouse'].photoUrls.length > 0, 'competitor cards get photos');
  assert.ok(!JSON.stringify(r).includes('description'));
});

test('market_insights flags thin data', async () => {
  const r = await callExtraTool('market_insights', { city: 'Washington', category: 'rooftop' }, { session: { state: {} } });
  assert.equal(r.count, 0);
  assert.equal(r.note, 'Few comparables; widen the category or city.');
});

test('median of an even count is the rounded mean of the middle two', () => {
  assert.equal(median([19000, 45000, 38000]), 38000);
  assert.equal(median([100, 201]), 151);
  assert.equal(median([]), null);
});
