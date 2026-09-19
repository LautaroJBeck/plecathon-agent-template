import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callExtraTool, catalogue, extraPromptSection } from '../../agent/extras.js';
import { haversineMiles, neighborhoodCentroid, resolveOrigin } from '../../agent/geo.js';
import { toParts } from '../../agent/parts.js';

const CITY_HALL = { lat: 39.9526, lng: -75.1652 };
const byId = new Map(catalogue().map((l) => [l.id, l]));

test('haversineMiles', () => {
  assert.equal(haversineMiles(CITY_HALL, CITY_HALL), 0);
  const toNyc = haversineMiles(CITY_HALL, { lat: 40.7128, lng: -74.006 });
  assert.ok(toNyc > 78 && toNyc < 83, `${toNyc}`);
});

test('resolveOrigin: explicit point, then near, then the browser location, else null', () => {
  const session = { state: { userLocation: { lat: 40.7, lng: -74, at: 0 } } };
  assert.deepEqual(resolveOrigin({ lat: 1, lng: 2, near: 'Fishtown' }, session), { lat: 1, lng: 2, label: 'the given point' });
  const fishtown = resolveOrigin({ near: 'fishtown' }, session);
  assert.equal(fishtown.label, 'Fishtown');
  assert.deepEqual({ lat: fishtown.lat, lng: fishtown.lng }, neighborhoodCentroid('Fishtown'));
  assert.equal(resolveOrigin({ near: 'The Foundry at Fishtown' }, session).label, 'The Foundry at Fishtown');
  assert.equal(resolveOrigin({ near: 'Temple University' }, session), null);
  assert.equal(resolveOrigin({}, session).label, 'your location');
  assert.equal(resolveOrigin({}, { state: {} }), null);
});

test('nearby_listings filters, sorts by distance and shows it on the cards', async () => {
  const session = { messages: [], state: { userLocation: { ...CITY_HALL, at: 0 }, guestCount: 30 } };
  assert.match(extraPromptSection(session), /shared their location/);
  const r = await callExtraTool('nearby_listings', { limit: 8 }, { session });
  assert.equal(r.origin, 'your location');
  assert.equal(r.results.length, 8);
  const miles = r.results.map((h) => h.distanceMiles);
  assert.deepEqual(miles, [...miles].sort((a, b) => a - b));
  for (const h of r.results) {
    const cap = byId.get(h.id).capacity;
    assert.ok(h.kind === 'venue' && cap.min <= 30 && cap.max >= 30, h.id);
  }
  assert.deepEqual(session.state.lastResults, r.results.map((h) => h.id));
  const card = toParts('Closest first.', session, [{ name: 'nearby_listings', args: {}, result: r }])[1];
  assert.match(card.subtitle, / mi away/);
});

test('nearby_listings without any origin asks for a neighborhood', async () => {
  const r = await callExtraTool('nearby_listings', {}, { session: { state: {} } });
  assert.equal(r.error, 'location_unknown');
});
