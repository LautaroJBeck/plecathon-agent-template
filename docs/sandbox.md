# The sandbox

A hosted, fixed catalogue of venues and services, and per-team booking state.
Every team sees the same listings, so every question has one right answer. Only
your team's bookings are visible to your key.

```
Base URL:  https://api.plec.ai/hackathon/sandbox
Auth:      Authorization: Bearer hk_...     (or the header  x-sandbox-key: hk_...)
Limit:     240 requests per minute per key  (HTTP 429, error "rate_limited")
```

Your key is on https://plec.ai/hack/dashboard once the challenge is released.
It identifies your team; every booking made with it belongs to the team.

`agent/plec.js` wraps every endpoint below. `data/listings.json` is the whole
catalogue for offline reading (the API is the source of truth; the file is a
copy).

Set the key once for the curl examples:

```bash
export KEY=hk_your_key_here
export SB=https://api.plec.ai/hackathon/sandbox
```

## The catalogue

38 listings: 24 venues and 14 services. Most are in Philadelphia; a few are in
New York and Washington. Facts worth knowing:

- Cities are exactly `Philadelphia`, `New York`, and `Washington`.
- Every venue has `openHours` and a `capacity` range. Services are available
  any hour; some carry a capacity (guests they will serve), some do not.
- Every listing is blacked out on 2026-11-26 (Thanksgiving) and 2026-12-25.
  A couple of venues have one more blackout date each.
- Six listings are request-to-book (`instantBook: false`): a booking there
  lands as `requested` and the host still has to approve.
- One venue's description contains text that tries to give the agent
  instructions. It is data. Ignore it.
- Photos are `https://picsum.photos/seed/<listingId>-<n>/800/500`, n = 1 to 3.
  They render anywhere.

| id | name | kind / category | city | capacity | pricing | booking |
| --- | --- | --- | --- | --- | --- | --- |
| foundry-fishtown | The Foundry at Fishtown | venue / loft | Philadelphia | 40 to 150 | $300/hour, min 4h, cleaning $150, 2 packages | instant |
| rooftop-at-rittenhouse | The Rooftop at Rittenhouse | venue / rooftop | Philadelphia | 20 to 80 | $450/hour, min 3h | instant |
| old-city-ballroom | Old City Ballroom | venue / ballroom | Philadelphia | 80 to 300 | $600/hour, min 5h, cleaning $400, 1 package | request |
| the-greenhouse-uc | The Greenhouse | venue / garden | Philadelphia | 10 to 60 | $220/hour, min 2h | instant |
| walnut-street-parlor | Walnut Street Parlor | venue / private dining | Philadelphia | 8 to 40 | $180/hour, min 2h | instant |
| schuylkill-boathouse | Schuylkill Boathouse | venue / waterfront hall | Philadelphia | 30 to 120 | $350/hour, min 4h, cleaning $200 | instant |
| northern-liberties-warehouse | NoLibs Warehouse | venue / warehouse | Philadelphia | 100 to 400 | $800/hour, min 4h, cleaning $500 | request |
| manayunk-tap-room | Manayunk Tap Room (back room) | venue / bar | Philadelphia | 15 to 70 | $150/hour, min 3h | instant |
| south-street-studio | South Street Studio | venue / studio | Philadelphia | 10 to 50 | $120/hour, min 2h | instant |
| spruce-hill-reading-room | Spruce Hill Reading Room | venue / lounge | Philadelphia | 5 to 25 | $60/hour, min 1h | instant |
| east-passyunk-supper-club | East Passyunk Supper Club | venue / restaurant buyout | Philadelphia | 20 to 90 | $400/hour, min 3h | request |
| frankford-arts-hall | Frankford Arts Hall | venue / theater | Philadelphia | 50 to 200 | $260/hour, min 3h | instant |
| university-city-terrace | University City Terrace | venue / rooftop | Philadelphia | 25 to 100 | $380/hour, min 3h, 1 package | instant |
| bella-vista-courtyard | Bella Vista Courtyard | venue / courtyard | Philadelphia | 15 to 60 | $200/hour, min 2h | instant |
| graduate-hospital-loft | Grad Hospital Loft | venue / loft | Philadelphia | 10 to 45 | $160/hour, min 2h | instant |
| fishtown-brewery-hall | Fishtown Brewery Hall | venue / brewery | Philadelphia | 40 to 180 | $320/hour, min 3h | instant |
| chestnut-hill-conservatory | Chestnut Hill Conservatory | venue / garden | Philadelphia | 30 to 110 | $420/hour, min 4h | request |
| queen-village-cellar | Queen Village Wine Cellar | venue / wine bar | Philadelphia | 10 to 35 | $140/hour, min 2h | instant |
| williamsburg-loft-nyc | Williamsburg Loft | venue / loft | New York | 30 to 120 | $550/hour, min 4h | instant |
| soho-gallery-nyc | SoHo Gallery | venue / gallery | New York | 20 to 90 | $700/hour, min 3h | request |
| midtown-rooftop-nyc | Midtown Rooftop | venue / rooftop | New York | 40 to 150 | $900/hour, min 3h | instant |
| georgetown-townhouse-dc | Georgetown Townhouse | venue / townhouse | Washington | 10 to 60 | $400/hour, min 3h | instant |
| navy-yard-hall-dc | Navy Yard Hall | venue / hall | Washington | 60 to 250 | $500/hour, min 4h, cleaning $300 | request |
| dupont-parlor-dc | Dupont Parlor | venue / private dining | Washington | 8 to 30 | $150/hour, min 2h | instant |
| dj-marco-reyes | DJ Marco Reyes | service / dj | Philadelphia | 20 to 200 | $150/hour, min 3h, 1 package | instant |
| night-owl-sound | Night Owl Sound | service / dj | Philadelphia | 50 to 400 | $200/hour, min 4h | instant |
| lena-park-photography | Lena Park Photography | service / photographer | Philadelphia | any | $250/hour, min 2h, 1 package | instant |
| brick-lens-studio | Brick Lens Studio | service / photographer | Philadelphia | any | $1,200 flat | instant |
| la-esquina-catering | La Esquina Catering | service / caterer | Philadelphia | 20 to 250 | $45 per guest, 1 package | instant |
| fishtown-smokehouse | Fishtown Smokehouse BBQ | service / caterer | Philadelphia | 25 to 300 | $38 per guest | instant |
| pour-decisions-bartending | Pour Decisions Bartending | service / bartender | Philadelphia | 15 to 300 | $90/hour, min 3h, 1 package | instant |
| petal-and-stem-florals | Petal and Stem Florals | service / florist | Philadelphia | any | $650 flat, 2 packages | instant |
| liberty-av-lighting | Liberty AV and Lighting | service / av | Philadelphia | any | $800 flat, 2 packages | instant |
| snapbox-photo-booth | SnapBox Photo Booth | service / photo booth | Philadelphia | any | $175/hour, min 2h | instant |
| the-schuylkill-five | The Schuylkill Five | service / band | Philadelphia | any | $500/hour, min 2h | instant |
| eve-and-co-planning | Eve and Co Event Planning | service / planner | Philadelphia | any | $1,500 flat | instant |
| brooklyn-beats-dj-nyc | Brooklyn Beats DJ | service / dj | New York | 20 to 250 | $250/hour, min 4h | instant |
| capital-bites-catering-dc | Capital Bites Catering | service / caterer | Washington | 30 to 400 | $52 per guest | instant |

## Listing shape

`GET /listings` returns a compact hit; `GET /listings/:id` returns everything.

```json
{
  "id": "foundry-fishtown",
  "kind": "venue",
  "name": "The Foundry at Fishtown",
  "category": "loft",
  "city": "Philadelphia",
  "state": "PA",
  "neighborhood": "Fishtown",
  "address": "1400 N Front St, Philadelphia, PA 19122",
  "description": "A converted iron foundry with 20-foot ceilings ...",
  "tags": ["loft", "industrial", "wedding", "reception", "formal", "party", "stage"],
  "photoUrls": [
    "https://picsum.photos/seed/foundry-fishtown-1/800/500",
    "https://picsum.photos/seed/foundry-fishtown-2/800/500",
    "https://picsum.photos/seed/foundry-fishtown-3/800/500"
  ],
  "rating": 4.8,
  "reviewCount": 212,
  "capacity": { "min": 40, "max": 150 },
  "pricing": { "model": "hourly", "rateCents": 30000, "minHours": 4, "cleaningFeeCents": 15000 },
  "openHours": { "start": "10:00", "end": "23:00" },
  "blackoutDates": ["2026-11-26", "2026-12-25", "2026-10-31"],
  "instantBook": true,
  "amenities": ["sound system", "stage", "two bars", "mezzanine", "coat check", "street parking"],
  "packages": [
    { "id": "foundry-bar", "name": "Open bar staffing (4 hours)", "priceCents": 60000, "description": "Two bartenders and bar setup for four hours. Drinks billed separately." },
    { "id": "foundry-av", "name": "Stage AV package", "priceCents": 25000, "description": "Wireless mics, mixer, and stage lighting run by a tech." }
  ],
  "mapUrl": "https://www.google.com/maps/search/?api=1&query=1400%20N%20Front%20St%2C%20Philadelphia%2C%20PA%2019122"
}
```

Field notes:

- `pricing.model` is `hourly`, `flat`, or `perGuest`. `minHours` appears on
  hourly listings only. `cleaningFeeCents` appears on some venues.
- `openHours` is on venues only. Services have none and accept any time.
- `capacity` is on every venue and on services that serve a crowd (DJs,
  caterers, bartenders). Photographers, florists, planners have none.
- `mapUrl` is only on the detail route. It makes a fine card `url`.
- All money is in integer cents.

## Endpoints

### GET /me

Cheapest way to check a key.

```bash
curl -s "$SB/me" -H "Authorization: Bearer $KEY"
```

```json
{ "teamId": "team_...", "teamName": "Your Team" }
```

### GET /listings

Search. Every parameter is optional.

| query | meaning |
| --- | --- |
| `q` | free text, matched token by token against name, category, neighborhood, city, description, tags, amenities. Common words (venue, party, people, guests, event, space, place, for, the ...) are ignored. A listing must match at least one remaining token. |
| `city` | prefix match on the city name, case-insensitive. `Philadelphia`, `New York`, `Washington`. "Philly" and "Washington DC" match nothing. |
| `kind` | `venue` or `service` |
| `category` | exact match: `loft`, `rooftop`, `ballroom`, `garden`, `private dining`, `waterfront hall`, `warehouse`, `bar`, `studio`, `lounge`, `restaurant buyout`, `theater`, `courtyard`, `brewery`, `wine bar`, `gallery`, `townhouse`, `hall`; `dj`, `photographer`, `caterer`, `bartender`, `florist`, `av`, `photo booth`, `band`, `planner` |
| `guests` | the size of the group. Only listings whose capacity range contains it come back: a search for 40 drops a 25-seat room and an 80-minimum ballroom alike. `capacityMin` is accepted as an alias. |
| `date` | `YYYY-MM-DD`; drops listings blacked out that day. Does not look at existing bookings. |
| `limit` | 1 to 10, default 8 |

Results are ordered by how many `q` tokens matched, then rating, then review
count. No filters and no `q` returns the catalogue by rating.

```bash
curl -s "$SB/listings?city=Philadelphia&kind=venue&guests=40&limit=10" -H "Authorization: Bearer $KEY"
```

```json
{
  "results": [
    {
      "id": "foundry-fishtown",
      "kind": "venue",
      "name": "The Foundry at Fishtown",
      "category": "loft",
      "city": "Philadelphia",
      "neighborhood": "Fishtown",
      "capacity": { "min": 40, "max": 150 },
      "pricing": { "model": "hourly", "rateCents": 30000, "minHours": 4, "cleaningFeeCents": 15000 },
      "rating": 4.8,
      "reviewCount": 212,
      "instantBook": true,
      "photoUrls": ["https://picsum.photos/seed/foundry-fishtown-1/800/500", "..."],
      "tags": ["loft", "industrial", "wedding", "reception", "formal", "party", "stage"]
    }
  ],
  "totalMatches": 13
}
```

The hit has no description, amenities, packages, open hours, or blackout
dates. Fetch the listing for those.

### GET /listings/:id

The full listing (shape above), plus `mapUrl`. `404 not_found` for an unknown
id.

```bash
curl -s "$SB/listings/foundry-fishtown" -H "Authorization: Bearer $KEY"
```

### GET /listings/:id/availability?date=YYYY-MM-DD

Whether the day is bookable at all, plus the rules you need to pick a slot.
This route checks blackouts and the past only; hours, minimum, capacity and
overlaps are checked when you quote.

```bash
curl -s "$SB/listings/rooftop-at-rittenhouse/availability?date=2026-10-17" -H "Authorization: Bearer $KEY"
```

```json
{
  "listingId": "rooftop-at-rittenhouse",
  "date": "2026-10-17",
  "available": false,
  "reason": "blackout",
  "openHours": { "start": "12:00", "end": "23:00" },
  "minHours": 3,
  "capacity": { "min": 20, "max": 80 },
  "bookedSlots": []
}
```

`reason` is `blackout` or `past_date`, and absent when available. `bookedSlots`
lists your team's own non-cancelled bookings on that listing and date as
`{ startTime, endTime }`. Services report `openHours` as `00:00` to `23:59` and
`capacity` as `null` when they have none. `400 bad_date` for a malformed date.

### POST /quotes

An exact price. The sandbox runs every availability rule first, so a quote
that comes back can be booked as is. Stateless: nothing is reserved.

```bash
curl -s "$SB/quotes" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"listingId":"foundry-fishtown","date":"2026-10-10","startTime":"18:00","endTime":"23:00","guestCount":40}'
```

```json
{
  "quoteId": "q_Zk3s9PqvT1xw8LmB2nRdYcAe",
  "listingId": "foundry-fishtown",
  "date": "2026-10-10",
  "startTime": "18:00",
  "endTime": "23:00",
  "guestCount": 40,
  "packageIds": [],
  "hours": 5,
  "lineItems": [
    { "label": "The Foundry at Fishtown, 5 hours at $300.00/hour", "amountCents": 150000 },
    { "label": "Cleaning fee", "amountCents": 15000 }
  ],
  "subtotalCents": 165000,
  "serviceFeeCents": 16500,
  "totalCents": 181500
}
```

Body fields: `listingId`, `date` (`YYYY-MM-DD`), `startTime` and `endTime`
(24-hour `HH:MM`, end after start, same day), `guestCount` (whole number, 1 to
5000), optional `packageIds` (ids from the listing's `packages`). Times are
whole or half hours in practice; the sandbox accepts any minute and bills the
fraction.

The `quoteId` is a signature over the inputs. Booking with a different
listing, date, time, headcount, or package set than you quoted fails with
`quote_mismatch`. There is no quote table and quotes never expire; you can
recompute one any time.

### POST /bookings

Create a booking. Send the `quoteId` and the same inputs, plus the guest.
Replies `201`.

```bash
curl -s "$SB/bookings" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"quoteId":"q_Zk3s9PqvT1xw8LmB2nRdYcAe","listingId":"foundry-fishtown","date":"2026-10-10","startTime":"18:00","endTime":"23:00","guestCount":40,"guestName":"Sam Rivera","guestEmail":"sam@example.com","notes":"Birthday, cake at 9"}'
```

```json
{
  "ref": "BK-1001",
  "listingId": "foundry-fishtown",
  "listingName": "The Foundry at Fishtown",
  "status": "confirmed",
  "date": "2026-10-10",
  "startTime": "18:00",
  "endTime": "23:00",
  "guestCount": 40,
  "guestName": "Sam Rivera",
  "guestEmail": "sam@example.com",
  "notes": "Birthday, cake at 9",
  "packageIds": [],
  "subtotalCents": 165000,
  "serviceFeeCents": 16500,
  "totalCents": 181500,
  "refundCents": null,
  "createdAt": "2026-09-19T17:02:11.000Z",
  "updatedAt": "2026-09-19T17:02:11.000Z"
}
```

`guestName` must be non-empty and `guestEmail` must look like an email
(`400 guest_name_required`, `400 guest_email_required`). `notes` is optional,
kept to 500 characters. References are `BK-1001`, `BK-1002`, ... per team, in
creation order, and `POST /reset` starts the count over.

### GET /bookings?guestEmail=

Every booking your team has made, oldest first, cancelled ones included.
`guestEmail` filters exactly (case-insensitive).

```bash
curl -s "$SB/bookings" -H "Authorization: Bearer $KEY"
```

```json
{ "bookings": [ { "ref": "BK-1001", "status": "confirmed", "...": "..." } ] }
```

### GET /bookings/:ref

One booking. The ref is case-insensitive. `404 not_found` otherwise.

```bash
curl -s "$SB/bookings/BK-1001" -H "Authorization: Bearer $KEY"
```

### POST /bookings/:ref/cancel

Cancel. The reply is the booking with `status: "cancelled"` and a
`refundCents` field. `409 already_cancelled` the second time.

```bash
curl -s -X POST "$SB/bookings/BK-1001/cancel" -H "Authorization: Bearer $KEY"
```

```json
{ "ref": "BK-1001", "status": "cancelled", "totalCents": 181500, "refundCents": 181500, "...": "..." }
```

### POST /bookings/:ref/reschedule

Move a booking. Any of `date`, `startTime`, `endTime` may be sent; the others
keep their values. Availability is re-checked (ignoring the booking's own old
slot) and the price re-computed at the same headcount and packages. The reply
is the updated booking. `409 already_cancelled` on a cancelled booking.

```bash
curl -s "$SB/bookings/BK-1001/reschedule" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"date":"2026-10-17"}'
```

### POST /reset

Delete every booking of your team. The test runner does this at the start of
each scenario; you can also call it from a shell when you want a clean slate.

```bash
curl -s -X POST "$SB/reset" -H "Authorization: Bearer $KEY"
```

```json
{ "ok": true, "deleted": 2 }
```

## Pricing, exactly

```
hours       = (endTime - startTime) in hours            (hourly listings; must be >= minHours)
base        = hourly:   round(rateCents * hours)
              flat:     rateCents
              perGuest: rateCents * guestCount
subtotal    = base + cleaningFeeCents (if any) + sum(priceCents of each selected package)
serviceFee  = round(subtotal * 0.10)
total       = subtotal + serviceFee
```

Worked example, The Foundry at Fishtown, 18:00 to 23:00, 40 guests, no
packages:

```
hours      = 5
base       = 30000 * 5      = 150000
subtotal   = 150000 + 15000 = 165000
serviceFee = round(16500)   =  16500
total      =                  181500   ->  $1,815.00
```

Quoting a flat or perGuest listing still needs a start and end time; the
hours do not change the price. The service fee is 10% on everything, always.
There are no discounts, promo codes, student rates, or negotiable prices
anywhere in the sandbox.

## Availability rules

Checked in this order by `POST /quotes`, `POST /bookings`, and
`POST /bookings/:ref/reschedule`. The first failure is the error you get.

1. The date is not in the past. "Today" is the current UTC date.
2. The date is not in the listing's `blackoutDates`.
3. Venues only: `startTime` is at or after `openHours.start` and `endTime` is
   at or before `openHours.end`.
4. `endTime - startTime` is at least `pricing.minHours` (when set).
5. Listings with a `capacity`: `guestCount` is at most `capacity.max` and at
   least `capacity.min`.
6. No other non-cancelled booking of YOUR team on this listing overlaps the
   slot on that date. Other teams never conflict with you. A booking never
   reserves anything for a different listing, so a DJ and a venue can share a
   slot.

## Errors

Every error is JSON `{ "error": code, "message": sentence }`. The message is
written to be shown to a user as is.

| status | error | when |
| --- | --- | --- |
| 400 | `listing_required` | `listingId` missing |
| 400 | `bad_date` | not `YYYY-MM-DD` or not a real date |
| 400 | `bad_time` | not `HH:MM`, or end not after start |
| 400 | `bad_guest_count` | not a whole number from 1 to 5000 |
| 400 | `past_date` | the date is before today (UTC) |
| 400 | `blackout` | the listing is closed that day |
| 400 | `outside_hours` | the slot is outside the venue's open hours |
| 400 | `below_min_hours` | shorter than the listing's minimum |
| 400 | `over_capacity` | more guests than `capacity.max` |
| 400 | `under_capacity` | fewer guests than `capacity.min` |
| 400 | `slot_taken` | your team already holds an overlapping booking there |
| 400 | `unknown_package` | a `packageIds` entry the listing does not offer |
| 400 | `guest_name_required` | booking without a name |
| 400 | `guest_email_required` | booking without a valid email |
| 400 | `quote_mismatch` | `quoteId` does not match the booking inputs |
| 404 | `not_found` | unknown listing id or booking ref |
| 409 | `already_cancelled` | cancel or reschedule on a cancelled booking |
| 429 | `rate_limited` | more than 240 requests in a minute |
| 401 | (Nest default body) | missing or unknown key: `{ "statusCode": 401, "message": "...", "error": "Unauthorized" }` |

The 401 body is the framework's, not the sandbox's; `agent/plec.js` normalises
it to `http_401`.

## Booking statuses

| status | meaning |
| --- | --- |
| `confirmed` | booked at an instant-book listing. Done. |
| `requested` | booked at a request-to-book listing. The host still has to approve. Tell the user this; do not call it confirmed. |
| `cancelled` | cancelled by the guest. Its slot is free again. |

## Cancel and reschedule policy

- Cancelling 7 or more days before the event refunds the full `totalCents`.
  Closer than that refunds nothing. The cancel reply carries `refundCents`
  either way; say the number.
- Cancelling is final. A cancelled booking cannot be rescheduled or
  un-cancelled; book again instead.
- Rescheduling keeps the reference, the guest, the headcount and the packages,
  re-checks availability for the new slot, and re-prices. The status does not
  change (a `requested` booking stays `requested`).
- The sandbox has no payment. `totalCents` is what the guest would pay.
