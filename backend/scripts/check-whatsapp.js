/**
 * Health check for the WhatsApp channel, link by link, without printing secrets:
 * backend, quick tunnel, Meta's webhook settings, verify token, app secret,
 * WhatsApp token and number, model key, sandbox key. Sends no WhatsApp message.
 *
 *   node backend/scripts/check-whatsapp.js
 */

import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const env = { ...readEnv(new URL('../../.env', import.meta.url)), ...process.env };
const PORT = Number(env.AGENT_PORT) || 8787;
const GRAPH = (env.WHATSAPP_API_URL || 'https://graph.facebook.com/v23.0').replace(/\/+$/, '');
const HOOK = '/api/webhooks/whatsapp';
let failures = 0;

const get = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }).catch((err) => ({ ok: false, status: `no answer (${err.cause?.code ?? err.name})`, text: async () => '', json: async () => ({}) }));
function report(ok, label, detail, fix) {
  if (!ok) failures += 1;
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? `: ${detail}` : ''}${!ok && fix ? `\n   → ${fix}` : ''}`);
  return ok;
}

// 1. The backend on this machine.
const local = await get(`http://localhost:${PORT}/health`);
const backendUp = report(local.ok, `Backend on port ${PORT}`, local.ok ? 'running' : `${local.status}`, 'Start it: npm run backend');

// 2. The quick tunnel: cloudflared serves its hostname on its metrics port (20241 to 20245).
let tunnel = null;
for (let port = 20241; port <= 20245 && !tunnel; port += 1) {
  const res = await get(`http://127.0.0.1:${port}/quicktunnel`);
  if (res.ok) tunnel = (await res.json()).hostname || null;
}
const tunnelUp = report(Boolean(tunnel), 'cloudflared quick tunnel', tunnel ? `https://${tunnel}` : 'not running', 'Start it: cloudflared tunnel --url http://localhost:8787');
const base = tunnel ? `https://${tunnel}` : null;
if (base && backendUp) {
  const health = await get(`${base}/health`);
  report(health.ok, 'Tunnel reaches the backend', `HTTP ${health.status}`, 'Wait a few seconds after starting cloudflared, then run this again');
}

// 3. Meta's webhook settings point at this tunnel.
if (env.META_APP_ID && env.META_APP_SECRET) {
  const res = await get(`${GRAPH}/${env.META_APP_ID}/subscriptions?access_token=${encodeURIComponent(`${env.META_APP_ID}|${env.META_APP_SECRET}`)}`);
  const sub = ((await res.json()).data ?? []).find((s) => s.object === 'whatsapp_business_account');
  const want = base ? `${base}${HOOK}` : null;
  report(Boolean(sub && want && sub.callback_url === want), "Meta's callback URL", sub?.callback_url ?? `none (HTTP ${res.status})`,
    want ? `In Meta > WhatsApp > Configuration, set the callback URL to ${want} and click Verify and save` : 'Start the tunnel first');
  report(Boolean(sub?.active && sub.fields?.some((f) => f.name === 'messages')), 'Subscribed to the "messages" field', sub ? (sub.active ? 'yes' : 'inactive') : 'no', 'In Meta > WhatsApp > Configuration > Webhook fields, subscribe to messages');
} else {
  report(false, "Meta's callback URL", 'cannot check', 'Set META_APP_ID and META_APP_SECRET in .env');
}

// 4. What the running backend loaded: the verify token and the app secret.
if (base && backendUp) {
  const challenge = await get(`${base}${HOOK}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '')}&hub.challenge=ok-123`);
  report(challenge.ok && (await challenge.text()) === 'ok-123', 'Verify token (WHATSAPP_WEBHOOK_VERIFY_TOKEN)', `HTTP ${challenge.status}`,
    'Set it in .env to the same token typed in Meta, then restart the backend');
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] }); // no messages: nothing gets sent
  const sig = `sha256=${createHmac('sha256', env.META_APP_SECRET ?? '').update(payload).digest('hex')}`;
  const signed = await get(`${base}${HOOK}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body: payload });
  report(signed.ok, 'App secret (META_APP_SECRET) accepted by the backend', `HTTP ${signed.status}`,
    signed.status === 503 ? 'META_APP_SECRET is not loaded: add it to .env and restart the backend' : '.env changed since the backend started: restart it');
}

// 5. The WhatsApp token can use the number.
const phone = await get(`${GRAPH}/${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } });
const number = await phone.json();
report(phone.ok, 'WhatsApp token and number', phone.ok ? `${number.display_phone_number} (${number.verified_name})` : number.error?.message ?? `HTTP ${phone.status}`,
  'Check WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env');

// 6. The model key, with the smallest possible request.
const llm = await get(`${(env.LLM_BASE_URL || '').replace(/\/+$/, '')}/chat/completions`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: env.LLM_MODEL, messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 }),
});
report(llm.ok, 'Model key (LLM_API_KEY)', llm.ok ? 'works' : `HTTP ${llm.status} ${(await llm.text()).match(/"message":"([^"]+)"/)?.[1] ?? ''}`,
  'Get the current plk_ key from your teammate or mint one at https://plec.ai/hack/dashboard, save .env, restart the backend');

// 7. The sandbox key.
const me = await get(`${(env.PLEC_SANDBOX_URL || 'https://api.plec.ai/hackathon/sandbox').replace(/\/+$/, '')}/me`, { headers: { Authorization: `Bearer ${env.PLEC_SANDBOX_KEY}` } });
report(me.ok, 'Sandbox key (PLEC_SANDBOX_KEY)', me.ok ? (await me.json()).teamName : `HTTP ${me.status}`, 'Copy the hk_ key from https://plec.ai/hack/dashboard');

console.log(failures ? `\n${failures} problem(s) above.` : `\nAll healthy. Text ${number.display_phone_number ?? 'the number'} "Show me venues in Philadelphia" and watch the backend window.`);
if (!tunnelUp || !backendUp) process.exitCode = 1;

/** Same rules as server.js: KEY=value lines, # comments, optional quotes, first one wins. */
function readEnv(url) {
  const out = {};
  if (!existsSync(url)) return out;
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#') && !(m[1] in out)) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
