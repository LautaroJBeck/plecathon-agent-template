# Plan: PLEC party concierge agent

**Brief:** "Build an ultra-capable agent for PLEC's customers: one that browses venues and services, answers real questions about them, and creates and manages bookings."

**Our angle:** one sentence in, a whole event out. The agent finds a venue plus services, shows 2–3 priced bundles, books all of them after one confirmation, and handles changes like "move it to the 19th" or "we're 60 now".

---

## 0. What we know about the hackathon (from plec-it.com/hack)

| | |
|---|---|
| Build window | **12:00pm – 3:30pm ET** (hard cutoff, the form locks itself). Results at 4:30pm |
| Starting point | A **template repo** on the dashboard. *"The README is the brief."* |
| Sandbox | Put your key in `.env` as `PLEC_SANDBOX_KEY`. Every booking made with it counts as your team's |
| Model | A shared model key with a rate limit that resets every 5 min, or point `LLM_BASE_URL` at our own provider |
| Run | `npm start` serves the chat page on port **8787**. `npm test` runs the **4 visible scenarios** |
| Grading | **Hidden scenarios** are run against our **public agent URL** after submissions close |
| Submit | Project title, repo link, public agent URL (a demo link is optional) |

**This matters more than anything else:** hidden tests grade the agent, so it has to get the real booking actions right (correct IDs, dates, party size, cancellations, changes). The multi-booking bundles come second. They are what makes us stand out, but they can't break the basics.

> The empty `backend/` and `frontend/` folders are probably not needed. The template already has a chat page and a server, so we build inside it.

---

## 1. Timeline (3.5h)

| Time | Goal | Done when |
|---|---|---|
| 12:00–12:20 | **Setup.** Fork the template, add `.env` and the model key, run `npm start` and `npm test`. Read the whole README and the sandbox API docs | We know the baseline test result and the full list of API endpoints |
| 12:20–1:15 | **Core tools.** One tool per sandbox endpoint (search, details, availability, book, list, modify, cancel) plus the agent loop | The 4 visible tests pass |
| 1:15–1:30 | **Deploy early.** Get a public URL now (see §6) | The URL works from a phone |
| 1:30–2:30 | **Concierge layer.** Parse the request into a structured event, search venues and services, build bundles, book everything after one confirmation, apply changes to everything booked | The demo script (§7) works end to end |
| 2:30–3:00 | **Hardening.** Error paths, clarifying questions, hidden-test guesses (§5) | Tests still green; each edge case tried by hand |
| 3:00–3:20 | Redeploy, fill in the README, submit the form | Form submitted, with ~10 min to spare |
| 3:20–3:30 | Buffer | — |

**Rule:** submit a working version by 3:00 and keep updating it. The form can be edited until 3:30.

---

## 2. Architecture

Keep the template's stack. Assuming it is Node:

```
chat page (template) ──► POST /chat ──► agent loop ──► LLM (tool calling)
                                            │
                                            └──► tools ──► PLEC sandbox API
```

- **Agent loop:** send messages and tools to the LLM, run each tool call it makes, send the results back, and repeat until it replies with plain text. Cap it at about 10 steps.
- **State:** the conversation history, stored in memory per session ID. No database. The sandbox is the source of truth for bookings, so we read it back with list and get calls instead of keeping our own copy.
- **Files:** add at most `tools.js` (tool schemas and handlers) and `prompt.js` (system prompt) to the template. Nothing more.

---

## 3. Tools

The exact names and fields depend on the sandbox API. Match them to its endpoints once we've read the README.

| Tool | What it does |
|---|---|
| `search_venues(city, date, guests, budget, tags)` | Find venues that fit |
| `search_services(city, date, category)` | Decor, face painting, catering, DJ, and so on |
| `get_details(id)` | Capacity, price, policies, amenities. **Answers "real questions" from this data, never from guesses** |
| `check_availability(id, date, time)` | Always call this before booking |
| `create_booking(id, date, time, guests, …)` | Book one item |
| `list_bookings()` / `get_booking(id)` | Show the user's bookings |
| `update_booking(id, …)` | Change the date, time, or party size |
| `cancel_booking(id)` | Cancel |

**Bundles** don't need a tool of their own. The LLM puts them together from search results. If bundles come out unreliable, add `build_bundles()` in plain code: filter by capacity ≥ guests and by availability, sort by total price, and keep the top 3 under budget.

**Booking several items at once:** book the items one by one. If one fails, tell the user exactly which ones succeeded and which didn't, and offer to cancel the ones that went through. Don't roll anything back silently.

---

## 4. System prompt (outline)

1. You are PLEC's booking concierge. Only book, change, or cancel things in the sandbox after the user confirms clearly.
2. From the user's message, pull out: city, date, time, guest count, budget, event type, needs (kid-friendly, and so on), and the services they want. **Ask one short question per missing detail that is essential** (date, city, guest count). Don't ask about details that aren't essential.
3. For a full event: search venues and services, check capacity, budget, and availability, then show **2–3 bundles** with a line-item price and a total, and say why each one fits.
4. On "book it" or "option 2": book every item, then show a summary with each booking ID.
5. On a change ("move to the 19th", "we're 60 now"): look up every booking for the event, re-check the fit (capacity, availability, policies), change each booking or swap it for another option, and report what changed.
6. Only state facts that came from a tool result. If the data doesn't cover something, say so.
7. Keep replies short, with prices and IDs in a clear list.

---

## 5. Guessing the hidden tests

The visible tests show what the graders check. Harden the agent against the likely variations of each:

- A simple question ("does venue X allow alcohol?") is answered from `get_details`, with no booking made
- Booking an unavailable slot: the agent offers alternatives and doesn't crash
- Party size over capacity: the agent refuses or suggests a bigger venue
- Cancel or modify the "last booking" or "my booking at X" is resolved through `list_bookings`
- Unclear request: the agent asks instead of guessing
- Never book without confirmation, **unless** the test explicitly says "book it". Check how the visible tests phrase this
- Dates like "next Saturday" or "Oct 12" are resolved to absolute dates, with today's date in the prompt
- Nothing is double-booked when a user repeats themselves

---

## 6. Deploy

Get a public URL as soon as the core works (target 1:15):

1. **Fastest:** a `cloudflared tunnel --url http://localhost:8787` from a laptop that stays open. It takes zero config, but the laptop has to stay awake until staff finish grading. Risky.
2. **Safer:** Render or Railway from the repo, with `PLEC_SANDBOX_KEY`, the model key, and `LLM_BASE_URL` as env vars. Check whether the shared model key expires after the build window ("the build window is over, so this key no longer works"). **If hidden tests run after 3:30, we need our own LLM key in the deployed env.** Ask an organizer at 12:00.

---

## 7. Demo script

1. "Birthday for 40 in Austin, Oct 12, around $3k, kid-friendly, need decor + face painting" → 3 bundles with totals
2. "Book option 2" → 3 booking IDs
3. "Actually we're 60 now" → the venue is too small, so the agent swaps it for a bigger one and keeps the services
4. "Move it to the 19th" → every booking moved, with availability re-checked
5. "Does the venue have parking?" → answered from the venue's details

---

## 8. Questions for an organizer at 12:00

- Does the model key work after 3:30, when the hidden tests run?
- Do the hidden tests expect a confirmation step before booking, or a booking on the first clear request?
- What endpoint do the tests call on our agent URL (the path and request/response format)? Keep the template's contract exactly.

---

## Skipped

- Auth, a database, and a custom UI. The template's chat page is enough, and we only restyle it if there's time after 3:00.
- Payments, and multiple users beyond a session ID.
