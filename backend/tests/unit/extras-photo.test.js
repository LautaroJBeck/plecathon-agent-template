import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraPromptSection, prepareTurn } from '../../agent/extras.js';
import { describeVibe, visionKey } from '../../agent/vision.js';

const photo = { mediaType: 'image/jpeg', data: 'AAAA' };

test('prepareTurn reads the photo into state.vibe and drops the image', async () => {
  const session = { state: { turnImage: photo, vibe: { liked: ['foundry-fishtown'], disliked: [] } } };
  let seen;
  await prepareTurn(session, { describe: async (img) => { seen = img; return { summary: 'A rooftop at sunset.', keywords: ['rooftop', 'sunset'] }; } });
  assert.equal(seen, photo);
  assert.ok(!('turnImage' in session.state));
  assert.deepEqual(session.state.vibe, { liked: ['foundry-fishtown'], disliked: [], description: 'A rooftop at sunset.', keywords: ['rooftop', 'sunset'], fromImage: true });
  assert.match(extraPromptSection(session), /Call search_by_vibe now with these keywords: rooftop, sunset\./);

  await prepareTurn(session); // next turn, no photo: the per-turn flag goes away
  assert.doesNotMatch(extraPromptSection(session), /sent a photo/);
});

test('prepareTurn on a failed read asks the user to describe the vibe, never throws', async () => {
  for (const describe of [async () => ({ error: 'vision_unavailable' }), async () => { throw new Error('boom'); }]) {
    const session = { state: { turnImage: photo } };
    await prepareTurn(session, { describe });
    assert.ok(!('turnImage' in session.state));
    assert.match(extraPromptSection(session), /couldn't read the photo and ask them to describe the vibe/);
  }
});

test('describeVibe without an Anthropic key is unavailable, not an error', async () => {
  const saved = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, LLM_API_KEY: process.env.LLM_API_KEY };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.LLM_API_KEY;
  try {
    assert.deepEqual(await describeVibe(photo), { error: 'vision_unavailable' });
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});

test('visionKey prefers ANTHROPIC_API_KEY, else reuses LLM_API_KEY only when the main model is Anthropic', () => {
  assert.equal(visionKey({ ANTHROPIC_API_KEY: 'a', LLM_API_KEY: 'b', LLM_BASE_URL: 'https://api.anthropic.com/v1' }), 'a');
  assert.equal(visionKey({ LLM_API_KEY: 'b', LLM_BASE_URL: 'https://api.anthropic.com/v1/' }), 'b');
  assert.equal(visionKey({ LLM_API_KEY: 'b', LLM_BASE_URL: 'https://proxy.plec.ai/v1' }), '');
  assert.equal(visionKey({ LLM_API_KEY: 'b' }), '');
  assert.equal(visionKey({}), '');
});
