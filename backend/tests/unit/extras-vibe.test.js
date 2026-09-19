import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callExtraTool, catalogue, extraPromptSection } from '../../agent/extras.js';

const byId = new Map(catalogue().map((l) => [l.id, l]));
const fits = (id, guests) => { const c = byId.get(id).capacity; return c && guests >= c.min && guests <= c.max; };
const newSession = (state = {}) => ({ messages: [], state });

test('search_by_vibe applies city and guest filters and registers the hits', async () => {
  const session = newSession();
  const r = await callExtraTool('search_by_vibe', { vibe: 'rooftop at sunset', keywords: ['rooftop', 'skyline', 'sunset'], city: 'Philadelphia', guests: 60 }, { session });
  assert.ok(r.results.length > 0);
  for (const h of r.results) {
    assert.equal(h.city, 'Philadelphia');
    assert.equal(h.kind, 'venue');
    assert.ok(fits(h.id, 60), `${h.id} does not fit 60`);
  }
  assert.equal(r.results[0].category, 'rooftop');
  assert.deepEqual(session.state.lastResults, r.results.map((h) => h.id));
  assert.equal(session.state.seen[r.results[0].id].name, r.results[0].name);
  assert.equal(session.state.vibe.description, 'rooftop at sunset');
});

test('search_by_vibe defaults city and headcount from memory', async () => {
  const r = await callExtraTool('search_by_vibe', { vibe: 'garden', keywords: ['garden'] }, { session: newSession({ city: 'Washington', guestCount: 30 }) });
  assert.ok(r.results.length > 0);
  for (const h of r.results) assert.ok(h.city === 'Washington' && fits(h.id, 30));
});

test('search_by_vibe never returns the description, and drops disliked listings', async () => {
  const session = newSession({ vibe: { liked: [], disliked: ['foundry-fishtown'] } });
  const r = await callExtraTool('search_by_vibe', { vibe: 'industrial loft', keywords: ['industrial', 'loft'], city: 'Philadelphia' }, { session });
  assert.ok(r.results.length > 0);
  assert.ok(!r.results.some((h) => h.id === 'foundry-fishtown'));
  assert.ok(!JSON.stringify(r).includes('description'));
});

test('find_similar_listings from a loft returns another loft first and excludes liked and disliked', async () => {
  const session = newSession({ city: 'Philadelphia', guestCount: 40 });
  const r = await callExtraTool('find_similar_listings', { likedIds: ['foundry-fishtown'], dislikedIds: ['old-city-ballroom'] }, { session });
  assert.ok(['loft', 'warehouse'].includes(r.results[0].category), r.results[0].id);
  assert.deepEqual(r.similarTo, ['The Foundry at Fishtown']);
  assert.ok(!r.results.some((h) => ['foundry-fishtown', 'old-city-ballroom'].includes(h.id)));
  for (const h of r.results) assert.ok(fits(h.id, 40));
  assert.deepEqual(session.state.vibe.liked, ['foundry-fishtown']);
  assert.deepEqual(session.state.vibe.disliked, ['old-city-ballroom']);
  assert.match(extraPromptSection(session), /Liked: The Foundry at Fishtown\. Disliked: Old City Ballroom\./);
});

test('find_similar_listings accepts names and rejects unknown ids', async () => {
  const ok = await callExtraTool('find_similar_listings', { likedIds: ['Grad Hospital Loft'] }, { session: newSession() });
  assert.ok(ok.results.length > 0);
  const bad = await callExtraTool('find_similar_listings', { likedIds: ['1', '3'] }, { session: newSession() });
  assert.equal(bad.error, 'unknown_ids');
});

test('callExtraTool never throws', async () => {
  assert.equal((await callExtraTool('nope', {}, {})).error, 'unknown_tool');
  assert.ok(Array.isArray((await callExtraTool('search_by_vibe', null, undefined)).results));
});
