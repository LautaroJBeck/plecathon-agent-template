/**
 * The brain. server.js calls respond() once per user turn and sends back
 * whatever parts it returns (docs/contract.md). PRD A, A1 + A2: a bounded
 * tool loop over the model, with every failure turned into an honest line.
 */

import { chatCompletion as defaultChatCompletion, LlmError, parseToolArguments } from './llm.js';
import { callTool as defaultCallTool, tools as plecTools } from './plec.js';
import { extraTools, callExtraTool as defaultCallExtraTool } from './extras.js';
import { toParts } from './parts.js';
import { systemPrompt } from './prompt.js';
import { noteUserText, remember } from './state.js';

/** Model rounds per turn. Every round costs quota, so keep it small. */
export const MAX_ROUNDS = 5;
/** Past this, the next round must answer in words (the server cuts turns at 40s). */
const FORCE_FINAL_AFTER_MS = 25_000;
/** Messages sent to the model; session.state carries anything older. */
const HISTORY_WINDOW = 24;
const MAX_TOOL_CHARS = 6_000;
/** kimi-k2.6 behind the proxy rejects 0 (upstream 400); 1 is its fixed thinking-mode value. */
const TEMPERATURE = 1;

const PLEC_TOOL_NAMES = new Set(plecTools.map((t) => t.function.name));

const BUSY_TEXT = "I'm getting a lot of requests right now. Please try again in about a minute.";
const ERROR_TEXT = 'Something went wrong on my side. Could you try that once more?';
const LOST_TEXT = 'Sorry, I lost the thread there. Could you say that again?';

/**
 * @param {{ sessionId: string, text: string, session: { messages: object[], state: object } }} turn
 * @param {{ chatCompletion?: Function, callTool?: Function, callExtraTool?: Function, now?: () => number }} [deps]
 *   injectable for unit tests; server.js passes nothing.
 * @returns {Promise<Array<object>>} parts, always with at least one text part. Never throws.
 */
export async function respond({ sessionId, text, session }, deps = {}) {
  session.messages.push({ role: 'user', content: text });
  const historyLength = session.messages.length;
  try {
    return await runTurn(text, session, deps);
  } catch (err) {
    console.error(`[agent ${String(sessionId).slice(0, 8)}]`, err);
    // Drop a half-finished tool group so the next turn's history stays valid.
    session.messages.length = historyLength;
    const reply = err instanceof LlmError && err.status === 429 ? BUSY_TEXT : ERROR_TEXT;
    session.messages.push({ role: 'assistant', content: reply });
    return [{ kind: 'text', text: reply }];
  }
}

async function runTurn(userText, session, deps) {
  const chatCompletion = deps.chatCompletion ?? defaultChatCompletion;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const tools = [...plecTools, ...extraTools];
  const turnResults = [];
  let text = '';
  noteUserText(session, userText);

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const forceFinal = round === MAX_ROUNDS - 1 || now() - startedAt > FORCE_FINAL_AFTER_MS;
    const messages = [{ role: 'system', content: systemPrompt(session) }, ...windowMessages(session.messages, HISTORY_WINDOW)];
    const roundStart = now();
    const reply = await chatCompletion(messages, { tools, temperature: TEMPERATURE, ...(forceFinal ? { toolChoice: 'none' } : {}) });
    console.log(`[agent] ${reply.raw?.model ?? ""} round ${round + 1}${forceFinal ? ' (forced)' : ''} ${now() - roundStart}ms ${reply.toolCalls.map((c) => `${c.name}${c.argumentsJson}`).join(' ') || 'answer'}`);

    if (forceFinal || reply.toolCalls.length === 0) {
      text = reply.text || (forceFinal ? LOST_TEXT : '');
      break;
    }

    session.messages.push(reply.message);
    const calls = reply.toolCalls.map((call) => ({ call, args: parseToolArguments(call.argumentsJson) }));
    const results = await Promise.all(calls.map(({ call, args }) => runTool(call.name, args, { session, userText }, deps)));
    calls.forEach(({ call, args }, i) => {
      turnResults.push({ name: call.name, args, result: results[i] });
      remember(session, call.name, args, results[i]);
      session.messages.push({ role: 'tool', tool_call_id: call.id, content: toolContent(call.name, results[i]) });
    });
  }

  // Raw text, tag lines included, so the model sees its own protocol next turn.
  session.messages.push({ role: 'assistant', content: text });
  return toParts(text, session, turnResults);
}

/** One tool call: plec tools to the sandbox, anything else to B's extras. Never throws. */
async function runTool(name, args, ctx, deps) {
  try {
    if (PLEC_TOOL_NAMES.has(name)) return await (deps.callTool ?? defaultCallTool)(name, args);
    return await (deps.callExtraTool ?? defaultCallExtraTool)(name, args, ctx);
  } catch (err) {
    console.error(`[tool ${name}]`, err);
    return { error: 'tool_failed', message: `The ${name} lookup failed on our side.` };
  }
}

/**
 * The last ~max messages, starting at a user message so the window never
 * opens inside an assistant tool_calls group.
 * @param {object[]} messages
 * @param {number} max
 */
export function windowMessages(messages, max) {
  if (messages.length <= max) return messages;
  let start = messages.length - max;
  while (start < messages.length && messages[start].role !== 'user') start += 1;
  return messages.slice(start);
}

/**
 * The copy of a tool result the model sees: search photoUrls dropped (they
 * live in state.seen), capped at 6,000 characters.
 * @param {string} name
 * @param {object} result
 */
export function toolContent(name, result) {
  let shown = result;
  if (name === 'search_listings' && Array.isArray(result?.results)) {
    shown = { ...result, results: result.results.map(({ photoUrls, ...rest }) => rest) };
  }
  const json = JSON.stringify(shown ?? null);
  return json.length > MAX_TOOL_CHARS ? `${json.slice(0, MAX_TOOL_CHARS)} ...[truncated]` : json;
}
