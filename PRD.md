# PRD — PLEC Concierge (Plecathon, 19 Sep 2026)

**Build window:** 12:00pm–3:30pm ET. Hard cutoff, form locks itself.
**Team:** 2 developers, referred to throughout as **Dev A** (agent + tools) and **Dev B** (frontend + deploy). Assign seats at 12:00.
**Deliverable:** project title, repo link, public URL of a running agent. Demo link optional.

---

## 1. Thesis

An agent that a real PLEC customer could use to find a celebration venue, get honest answers about it, and book it — where the *visible* quality is in rich venue cards, confirm-before-write safety, and refusing to invent facts.

The brief ("browses venues and services, answers real questions, creates and manages bookings") is what every team will ship. The differentiator is the three things below. Everything else is cut.

**D1 — Generative UI.** Tool results render as venue cards with photos, a date picker, and a booking confirmation card. This is a venue product; photographs sell it. A wall of text loses to a grid of images.

**D2 — Confirm before write.** No booking is created without an explicit user click on a confirmation card showing venue, date, guests, services, and total. Ambiguous "yeah book it" produces the card, not a booking.

**D3 — Grounded answers.** The agent answers only from venue data and says plainly when a field is unspecified. "Parking isn't listed for this venue — want me to flag it to the host?" beats a confident invention.

## 2. Scale and constraints

- Demo-scale: one user, one session, judged in ~2–5 minutes. Optimize for clarity and demo reliability, **not** for scale, concurrency, or cost.
- 3.5 hours, 2 people, no prior codebase.
- Stack follows the organizers' frontend template. If it leaves the choice open, default to Next.js + TypeScript + Tailwind on Vercel — one repo, one deploy, API routes for the agent loop.
- Model: Sonnet-class for the main loop (latency is demo-visible). Model name behind a single env var so it can be swapped at 3:00pm.

## 3. Architecture

Single agent, one tool-calling loop. **No multi-agent orchestration, no vector DB, no RAG.** The venue catalog is small enough to keyword-filter server-side or hold in context.

```
Browser (chat UI)
   │  POST /api/chat  { messages }
   ▼
Agent loop  ──► PLEC API client ──► PLEC API
   │                                  (or local fixtures)
   └─ streams: text deltas, tool-status events, card payloads
```

### 3.1 The lane contract (write this first, at 12:20)

This is the single most important artifact of the build, because it lets both lanes work in parallel without blocking. Dev A produces card payloads; Dev B renders them. Agree it, commit it as `types.ts`, and do not change it unilaterally after 1:15.

Every tool result the UI should draw returns:

```ts
type Card =
  | { kind: 'venue_list';   venues: Venue[] }
  | { kind: 'venue_detail'; venue: Venue }
  | { kind: 'availability'; venueId: string; slots: Slot[] }
  | { kind: 'booking_draft'; draft: BookingDraft; confirmToken: string }
  | { kind: 'booking';      booking: Booking }

type Venue = {
  id: string; name: string; imageUrl: string | null;
  neighborhood: string; capacity: number;
  pricePerHour: number | null; currency: string;
  amenities: string[]; blurb: string;
}

type BookingDraft = {
  venueId: string; venueName: string;
  startsAt: string; endsAt: string;   // ISO 8601
  guests: number;
  services: { id: string; name: string; price: number }[];
  total: number; currency: string;
}
```

Field names come from PLEC's API where they exist — map their names into this shape in the client layer, don't leak their schema into the UI.

Until Dev A's tools are live, Dev B builds against `fixtures.ts` exporting one example of each `Card`. Dev B is never blocked on the API.

### 3.2 Streaming events

The response stream carries three event types: `text` (token deltas), `status` (e.g. `"Searching 12 venues in Fishtown…"`, shown and then replaced), and `card` (a `Card` payload rendered inline in the transcript). Status events are what make the agent *feel* capable while a tool runs.

## 4. Tools (Dev A)

Eight tools. Resist adding a ninth.

| Tool | Args | Returns |
|---|---|---|
| `search_venues` | `neighborhood?, date?, guests?, maxPrice?, amenities[]?` | `venue_list` (cap at 6) |
| `get_venue` | `venueId` | `venue_detail` — full record, all fields, including nulls |
| `check_availability` | `venueId, date` or `dateRange` | `availability` |
| `list_services` | `venueId` | services for that venue (catering, AV, decor, whatever PLEC calls them) |
| `draft_booking` | `venueId, startsAt, endsAt, guests, serviceIds[]` | `booking_draft` + `confirmToken`. **Writes nothing.** |
| `confirm_booking` | `confirmToken` | `booking`. Only callable after the user clicks Confirm. |
| `get_bookings` | — | list of the user's bookings |
| `modify_booking` / `cancel_booking` | `bookingId, changes` | `booking`; cancel also requires a confirm click |

**Write-path rules (non-negotiable):**

- `confirm_booking` is never called by the model directly off a user message. The Confirm button in the UI posts the `confirmToken`; the server executes the write.
- `confirmToken` is an idempotency key. Replaying it returns the existing booking, never a duplicate.
- Every tool returns a typed error the agent can recover from and explain, never a raw stack trace.

## 5. System prompt requirements (Dev A)

The prompt must establish, at minimum:

- Identity: a PLEC booking concierge. Warm, brief, never gushing.
- **Grounding:** answer only from tool results. If a field is absent or null, say it isn't listed. Never estimate a price, capacity, or policy that wasn't returned.
- **Slot filling:** a booking needs venue, date, time window, and guest count. Ask for what's missing — one question at a time, not a form dump.
- **Constraint memory:** once the user says "30 people," every later search carries it until they change it.
- Call `draft_booking` and let the user confirm. Never claim a booking exists before `confirm_booking` returns.
- Today's date is injected at runtime so relative dates ("next Saturday") resolve.

## 6. Frontend requirements (Dev B)

- Chat transcript with streaming text and a visible status line during tool calls.
- **VenueCard** — image, name, neighborhood, capacity, price, 2–3 amenity chips. Clicking one sends "Tell me more about {name}" as a user turn.
- **VenueGrid** — 2–3 cards across on desktop, stacked on mobile.
- **AvailabilityPicker** — clickable slots; a click sends the chosen slot as a user turn.
- **BookingDraftCard** — line-item breakdown, total, and a primary **Confirm booking** button plus a secondary Cancel. Confirm posts the token and disables itself immediately.
- **BookingCard** — confirmed state, reference number, and Modify / Cancel actions.
- Three suggested prompts on the empty state, wired to the demo script in §9.
- Graceful states: loading skeleton for cards, and an error bubble that doesn't kill the session.

Do not build: auth screens, a settings page, dark mode, a landing page, responsive polish beyond "doesn't break on a laptop."

## 7. Data

If PLEC supplies the API, wrap it and **cache the venue list in memory at server start** — 40 teams hitting their API at once is a real rate-limit risk, and a cached list keeps the demo alive if their service wobbles.

If you must supply the data: 15–20 venues, every field populated, real photo URLs, and deliberately leave 2–3 fields null on a couple of venues so D3 (honest "not listed") is demonstrable.

Bookings persist in a server-side in-memory store keyed by session. A database is out of scope — process memory is fine for a 3-hour demo, and the agent survives a redeploy only if you seed on boot (see §9).

## 8. Explicitly out of scope

Do not build these. If a coding agent proposes one, reject it.

- Authentication, accounts, sessions, multi-user
- Payments or any real money movement
- A database, migrations, or an ORM
- Vector search, embeddings, RAG
- Multi-agent orchestration, planner/executor splits, agent handoffs
- Tests, evals, CI
- Email or SMS notifications
- Admin or host-side views
- Mobile-first design, dark mode, animation polish
- Internationalization, currency conversion
- Rate limiting, caching layers, observability

## 9. Demo readiness

- **Seed on boot:** one confirmed booking exists when the server starts, so "show me my bookings" and "move it to 7pm" demo without creating one first.
- **Script (rehearse it, out loud, twice):**
  1. "I need somewhere for a 30-person birthday in Fishtown in October" → venue grid
  2. "What's the deal with the second one — is there parking?" → grounded answer, including an honest "not listed" on some field
  3. "Book it for the 17th, 7 to 11" → draft card → click Confirm → booking card
  4. "Actually make it 40 people" → modify path
- **Hostile question to survive:** ask it something the data doesn't cover and make sure it declines rather than invents. Judges will try this.
- README: one paragraph on the thesis, a screenshot, run instructions, and the three differentiators named explicitly.

## 10. Build order and lane schedule

Times are wall clock. The gates are the point — hit them or cut.

| Time | Dev A (agent) | Dev B (frontend) | Gate |
|---|---|---|---|
| 12:00–12:20 | **Together:** read the PLEC API docs, write `types.ts` (§3.1), create the repo, both push once | | Contract committed |
| 12:20–12:35 | API client + `fixtures.ts` | Template running locally → **deploy to a public URL** | **Live URL exists** |
| 12:35–1:15 | `search_venues`, `get_venue`, `list_services`, agent loop streaming text + status | Transcript, streaming, VenueCard, VenueGrid against fixtures | |
| 1:15–1:30 | **Integration #1** — real search results render in the real UI. Eat during this. | | **End-to-end search works** |
| 1:30–2:15 | `check_availability`, `draft_booking`, `confirm_booking`, idempotency | AvailabilityPicker, BookingDraftCard, Confirm wiring | |
| 2:15–2:30 | **Integration #2** — full book path end to end | | **A booking can be made** |
| 2:30–2:45 | `get_bookings`, `modify_booking`, `cancel_booking`, seed-on-boot | BookingCard, empty-state prompts, error states | |
| **2:45** | **FEATURE FREEZE** — no new features, bugs only | | |
| 2:45–3:10 | System-prompt tuning against the demo script; hostile-question pass | Visual cleanup, README, screenshot | |
| 3:10–3:15 | Final deploy, smoke-test the live URL on a phone | | **Prod works, not just localhost** |
| **3:15** | **SUBMIT.** Editable until 3:30 — submit early, refine after. | | |

Rule: if a gate slips by more than 15 minutes, cut the next feature rather than pushing the gate. A working search-and-book demo beats a half-wired modify path.

## 11. Open questions (resolve at 12:00 with their docs)

- Does PLEC's API expose real availability, or must it be derived/faked?
- Are "services" per-venue add-ons or a separate global catalog?
- Are API keys rate-limited per team? (If yes, cache aggressively.)
- Does their template dictate the model/provider, or is the key ours?
- Is there a sandbox for writes, or do bookings hit something real? (If real, keep the demo data obviously test-flavored.)
