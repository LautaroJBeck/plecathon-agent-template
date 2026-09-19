import { test } from 'node:test';
import assert from 'node:assert/strict';
import { respond, windowMessages, toolContent, MAX_ROUNDS } from '../../agent/agent.js';
import { LlmError } from '../../agent/llm.js';

const newSession = () => ({ messages: [], state: {} });
const final = (text) => ({ text, toolCalls: [], message: { role: 'assistant', content: text } });
const withCalls = (...calls) => ({
  text: '',
  toolCalls: calls.map(([id, name, args]) => ({ id, name, argumentsJson: JSON.stringify(args) })),
  message: { role: 'assistant', content: '', tool_calls: calls.map(([id, name, args]) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })) },
});

/** chatCompletion stub that plays back replies in order and records each call. */
function scripted(...replies) {
  const calls = [];
  const fn = async (messages, options) => {
    calls.push({ messages: structuredClone(messages), options });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

test('a plain answer comes back as one text part and lands in history', async () => {
  const session = newSession();
  const chatCompletion = scripted(final('Hello there.'));
  const parts = await respond({ sessionId: 's', text: 'hi', session }, { chatCompletion });
  assert.deepEqual(parts, [{ kind: 'text', text: 'Hello there.' }]);
  assert.equal(chatCompletion.calls[0].messages[0].role, 'system');
  assert.deepEqual(session.messages.map((m) => m.role), ['user', 'assistant']);
});

test('tool calls run, their results go back in call order, then the answer', async () => {
  const session = newSession();
  const chatCompletion = scripted(
    withCalls(['c1', 'get_listing', { id: 'a' }], ['c2', 'get_listing', { id: 'b' }]),
    final('Both hold 150.'),
  );
  const order = [];
  const callTool = async (name, args) => {
    // b resolves first, but the tool messages must still follow call order.
    await new Promise((r) => setTimeout(r, args.id === 'a' ? 20 : 1));
    order.push(args.id);
    return { id: args.id, name: args.id.toUpperCase() };
  };
  const parts = await respond({ sessionId: 's', text: 'how big?', session }, { chatCompletion, callTool });
  assert.equal(parts[0].text, 'Both hold 150.');
  assert.deepEqual(order, ['b', 'a'], 'calls ran in parallel');
  const toolMsgs = session.messages.filter((m) => m.role === 'tool');
  assert.deepEqual(toolMsgs.map((m) => m.tool_call_id), ['c1', 'c2']);
  assert.equal(session.messages[1].tool_calls.length, 2, 'assistant tool_calls message pushed before results');
});

test('non-plec tools go to callExtraTool with the session and user text', async () => {
  const session = newSession();
  const chatCompletion = scripted(withCalls(['c1', 'draft_email', { to: 'x' }]), final('Drafted.'));
  let seen;
  const callExtraTool = async (name, args, ctx) => { seen = { name, args, ctx }; return { ok: true }; };
  const callTool = async () => assert.fail('plec callTool should not run');
  await respond({ sessionId: 's', text: 'email it', session }, { chatCompletion, callTool, callExtraTool });
  assert.equal(seen.name, 'draft_email');
  assert.equal(seen.ctx.userText, 'email it');
  assert.equal(seen.ctx.session, session);
});

test('the last allowed round forces a worded answer with toolChoice none', async () => {
  const session = newSession();
  const replies = [];
  for (let i = 0; i < MAX_ROUNDS - 1; i += 1) replies.push(withCalls([`c${i}`, 'get_listing', { id: 'a' }]));
  replies.push(final('Here is what I found.'));
  const chatCompletion = scripted(...replies);
  const parts = await respond({ sessionId: 's', text: 'x', session }, { chatCompletion, callTool: async () => ({}) });
  assert.equal(chatCompletion.calls.length, MAX_ROUNDS);
  assert.equal(chatCompletion.calls.at(-1).options.toolChoice, 'none');
  assert.ok(chatCompletion.calls.slice(0, -1).every((c) => c.options.toolChoice !== 'none'));
  assert.equal(parts[0].text, 'Here is what I found.');
});

test('after 25s the next round forces a final answer', async () => {
  const session = newSession();
  let t = 0;
  const now = () => t;
  const chatCompletion = scripted(withCalls(['c1', 'get_listing', { id: 'a' }]), final('Done.'));
  const callTool = async () => { t += 26_000; return {}; };
  await respond({ sessionId: 's', text: 'x', session }, { chatCompletion, callTool, now });
  assert.equal(chatCompletion.calls[1].options.toolChoice, 'none');
});

test('a 429 from the model gets the busy message as a single text part', async () => {
  const session = newSession();
  const chatCompletion = scripted(new LlmError('rate limited', { status: 429 }));
  const origError = console.error;
  console.error = () => {};
  const parts = await respond({ sessionId: 's', text: 'hi', session }, { chatCompletion }).finally(() => { console.error = origError; });
  assert.deepEqual(parts, [{ kind: 'text', text: "I'm getting a lot of requests right now. Please try again in about a minute." }]);
});

test('any other failure gets the generic apology, never a throw', async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    for (const err of [new LlmError('boom', { status: 500 }), new TypeError('bad')]) {
      const parts = await respond({ sessionId: 's', text: 'hi', session: newSession() }, { chatCompletion: scripted(err) });
      assert.deepEqual(parts, [{ kind: 'text', text: 'Something went wrong on my side. Could you try that once more?' }]);
    }
    const parts = await respond({ sessionId: 's', text: 'hi', session: newSession() }, {
      chatCompletion: scripted(withCalls(['c1', 'get_listing', { id: 'a' }])),
      callTool: async () => { throw new Error('socket'); },
    });
    assert.equal(parts.length, 1);
    assert.equal(parts[0].kind, 'text');
  } finally {
    console.error = origError;
  }
});

test('the history window never starts inside a tool-call group', () => {
  const msgs = [];
  for (let i = 0; i < 10; i += 1) {
    msgs.push({ role: 'user', content: `u${i}` });
    msgs.push({ role: 'assistant', content: '', tool_calls: [{ id: `t${i}` }] });
    msgs.push({ role: 'tool', tool_call_id: `t${i}`, content: '{}' });
    msgs.push({ role: 'assistant', content: `a${i}` });
  }
  const win = windowMessages(msgs, 24);
  assert.ok(win.length <= 24);
  assert.equal(win[0].role, 'user');
  assert.equal(win.at(-1), msgs.at(-1));
  assert.deepEqual(windowMessages(msgs.slice(0, 4), 24), msgs.slice(0, 4));
});

test('tool results drop search photoUrls and are capped at 6,000 characters', () => {
  const search = { results: [{ id: 'a', name: 'A', photoUrls: ['http://x/1.jpg'] }], totalMatches: 1 };
  const content = toolContent('search_listings', search);
  assert.ok(!content.includes('photoUrls'));
  assert.ok(search.results[0].photoUrls, 'original result is untouched');
  const big = toolContent('get_listing', { description: 'x'.repeat(10_000) });
  assert.ok(big.length <= 6_100, `got ${big.length}`);
  assert.match(big, /truncated/);
});
