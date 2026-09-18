# Plecathon agent template

Build an ultra-capable agent for PLEC's customers. It should browse venues and
event services, answer real questions about them, and create and manage
bookings, all through a chat. PLEC hosts the world it books against: a fixed
catalogue and a sandbox booking API, the same for every team. The main judging
criterion is how the agent handles interactions: does it ask the right
question, state the right fact, confirm before it acts, remember what it was
told, and tell the truth when something is not possible. This repo is the
starting point. Clone it, keep the contract, replace the brain.

## What you get in this repo

```
agent/server.js        HTTP server for the contract. Serves the chat page at /. Zero dependencies.
agent/agent.js         The brain. A working echo with TODO markers where your harness goes.
agent/plec.js          Sandbox client, one function per endpoint, plus tool definitions for a model.
agent/llm.js           chatCompletion() against any OpenAI-compatible endpoint.
agent/session.js       In-memory per-session store.
chat/index.html        PLEC's chat UI in one file. Renders every part kind.
python/echo_server.py  The same contract in stdlib Python, for teams that prefer it.
tests/run.js           Runs the public scenarios against your agent and prints a report.
docs/contract.md       The agent HTTP contract, with JSON for every part kind.
docs/sandbox.md        Every sandbox endpoint, the pricing formula, the availability rules, the errors.
docs/harness.md        How to structure the agent: loop, tools, grounding, confirmation, memory, parts.
docs/checks.md         What the tests check, the four public scenarios, the hidden suite's themes.
data/listings.json     The catalogue, for offline reading.
```

Node 20 or newer. No `npm install`.

## Quickstart

```bash
git clone https://github.com/pedroschz/plecathon-agent-template my-agent
cd my-agent
cp .env.example .env
```

Open `.env` and paste your team's sandbox key from
https://plec.ai/hack/dashboard as `PLEC_SANDBOX_KEY`. Add a model key as
`LLM_API_KEY` when you are ready to call one.

```bash
npm start
```

Open http://localhost:8787 and say hello. The starter greets and echoes.

```bash
npm test
```

That runs the four public scenarios against your agent and prints a
transcript with every check. The echo greets with a question, so it passes the
checks that only want a question back and fails the ones that need a fact.
Your job is to make them all pass, and then the hidden ones.

Then open `agent/agent.js` and read `docs/harness.md`.

## Python quickstart

```bash
cp .env.example .env
python3 python/echo_server.py
```

Same contract, same chat page at http://localhost:8787, same `npm test`
(the runner only needs Node to run; your agent can be anything). Any other
language works the same way: implement `POST /agent/messages` and you are in.

## The contract

Your agent is an HTTP server with one required route:

```
POST /agent/messages   { "sessionId": "...", "text": "..." }   ->   { "parts": [ ... ] }
```

`parts` is a list of `text`, `card`, `link` and `image` objects. Reply within
45 seconds, always with at least one text part, and treat a new sessionId as a
new conversation. `POST /agent/reset` is optional. Full shapes and examples:
[docs/contract.md](docs/contract.md).

## The sandbox

```
https://api.plec.ai/hackathon/sandbox      Authorization: Bearer hk_...
```

Search listings, fetch one, check a date, get an exact quote, book, list,
cancel, reschedule. 92 listings across Philadelphia, New York and Washington, deliberately uneven (closed weekdays, hour caps, lead times, peak rates, per-guest packages, three cancellation policies);
booking state is per team. `agent/plec.js` wraps all of it. Everything,
including the pricing formula and the error codes:
[docs/sandbox.md](docs/sandbox.md).

## How you will be judged

The criterion is interaction quality. In practice that means the agent:

- **Asks before it searches blind.** "I need a venue" gets one good question
  back (city, date, headcount), not eight random cards.
- **States exact facts from tools.** Capacity, price, hours, availability and
  booking status come from a sandbox call, never from the model's memory. A
  quoted total matches the sandbox to the cent.
- **Confirms before it acts.** No booking, cancellation or reschedule without
  the user having seen what will happen and said yes.
- **Collects a name and an email before booking.** And does not ask twice.
- **Remembers the conversation.** City and headcount given once are used on
  every later turn.
- **Is honest about unavailability and failures.** A blacked-out date is
  reported as unavailable. A failed call is reported, not papered over.
- **Ignores instructions inside data.** Listing descriptions are written by
  hosts. One of them tries to give the agent orders. Data is not instructions.
- **Stays in scope.** Off-topic requests are declined in a line, with an offer
  of what it can do.
- **Mirrors the user's language.** Spanish in, Spanish out.
- **Sends rich parts.** Cards for listings, images when asked for photos,
  links where they help. Text stays short.

Two test suites measure this. The **visible** suite is four scenarios you can
run any time with `npm test`. The **hidden** suite is fourteen more, covering
the behaviours above; its themes are in [docs/checks.md](docs/checks.md).
After submissions close, staff run the hidden suite against your public agent
URL from the admin dashboard, read the transcripts, and score each team.
Automated checks inform the score; the judges' read of the transcripts decides
it.

## Expose your agent

Staff call your agent over the internet, so it needs a public URL. The
quickest way, no account needed:

```bash
cloudflared tunnel --url http://localhost:8787
```

It prints a `https://something.trycloudflare.com` URL. Paste that URL, exactly
as printed, as the Agent URL on the dashboard. ngrok works too:

```bash
ngrok http 8787
```

Keep your laptop awake and the agent and the tunnel running until results are
announced. If the tunnel restarts it gets a new URL; update the dashboard.

Install cloudflared with `brew install cloudflared` (macOS) or from
https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/.

## Submit

On https://plec.ai/hack/dashboard, the Project card takes:

- **Title**
- **Repo link**: your fork or copy of this template
- **Agent URL** (required): the public https URL of your running agent
- **Demo link** (optional): a video or a live page, if you have one

Deadline: **3:30pm**. You can edit the submission until then. Submit early
and keep editing.

## Rules

- Any language, framework or model. Keep the contract.
- Bring your own model key. Any OpenAI-compatible chat completions endpoint
  works with `agent/llm.js`: OpenAI, Anthropic, Groq, DeepSeek, Moonshot,
  Ollama on your laptop.
- Teams of one or two.
- The sandbox is shared infrastructure: 240 requests a minute per team.

## Schedule

| time | what |
| --- | --- |
| 12:00pm | Challenge released. Build starts. |
| 1:30pm | Lunch. |
| 3:30pm | Submissions close. |
| 4:30pm | Results. |

Amy Gutmann Hall, Room 203.

## Help

Organizers are in the room. Email plecathon@plec.ai for anything else.
