import { useRef, useState } from 'react';
import { api, defaultRequest, money, prettyDate, priceLabel, today, useApi } from './api.js';
import { Icon, Modal } from './ui.jsx';

const CITIES = ['Philadelphia', 'New York', 'Washington'];
const POLICY = {
  flexible: 'Flexible: full refund 2+ days out, half inside that',
  moderate: 'Moderate: full refund 7+ days out',
  strict: 'Strict: half refund 14+ days out',
};
const ALCOHOL = { byob: 'BYOB', in_house_only: 'In-house bar only', dry: 'No alcohol' };

export function ListingCard({ listing: l, onOpen }) {
  return (
    <button className="lcard" onClick={() => onOpen(l.id)}>
      <div className="lcard-photo">
        <img src={l.photoUrls?.[0]} alt="" loading="lazy" />
        {!l.instantBook && <span className="lcard-tag">Request to book</span>}
      </div>
      <div className="lcard-name">
        <span>{l.name}</span>
        <Icon name="badge" size={15} className="verified" />
        {l.rating >= 4.8 && <span className="featured">Featured</span>}
      </div>
      <div className="lcard-sub">{l.neighborhood} · {l.city}</div>
      <div className="lcard-meta">
        <span>from <u>{priceLabel(l.pricing)}</u></span>
        <span className="rating"><Icon name="star" size={12} fill /> {l.rating?.toFixed(1)}</span>
      </div>
    </button>
  );
}

function Skeletons({ n = 7 }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} className="lcard skeleton" aria-hidden="true"><div className="lcard-photo" /><div className="line" /><div className="line short" /></div>
  ));
}

/** A titled, horizontally scrolling row of live search results, like the rows on plec-it.com. */
export function ListingRow({ title, subtitle, filters, onOpen, onMore }) {
  const { data, error } = useApi(() => api.search(filters), JSON.stringify(filters));
  const track = useRef(null);
  const scroll = (dir) => track.current?.scrollBy({ left: dir * track.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="row-section">
      <div className="row-head">
        <div>
          <h2><button className="link-title" onClick={onMore}>{title} <Icon name="arrow" size={20} /></button></h2>
          <p>{subtitle}</p>
        </div>
        <div className="row-arrows">
          <button className="round" onClick={() => scroll(-1)} aria-label="Scroll left"><Icon name="left" /></button>
          <button className="round" onClick={() => scroll(1)} aria-label="Scroll right"><Icon name="right" /></button>
        </div>
      </div>
      <div className="track" ref={track}>
        {error ? <p className="error">Could not load listings: {error.message}</p>
          : data ? data.results.map((l) => <ListingCard key={l.id} listing={l} onOpen={onOpen} />)
          : <Skeletons />}
      </div>
    </section>
  );
}

function describe(f) {
  const what = f.kind === 'service' ? (f.category ? `a ${f.category}` : 'event services') : 'a venue';
  return `I'm looking for ${what}${f.city ? ` in ${f.city}` : ''}${f.guests ? ` for ${f.guests} guests` : ''}${f.date ? ` on ${f.date}` : ''}${f.q ? `: ${f.q}` : ''}.`;
}

/** The search view: filters map one to one onto GET /listings. */
export function Results({ search, setSearch, onOpen, onAsk }) {
  const filters = { q: search.q, city: search.city, kind: search.kind, category: search.category, guests: search.guests, date: search.date, limit: 10 };
  const { data, error, loading } = useApi(() => api.search(filters), JSON.stringify(filters));
  const set = (patch) => setSearch({ ...search, ...patch, title: undefined });
  const heading = search.title || (search.q ? `Results for “${search.q}”` : search.kind === 'service' ? 'Event services' : 'Venues');

  return (
    <section className="results">
      <div className="results-head">
        <div>
          <button className="back" onClick={() => setSearch(null)}><Icon name="left" size={16} /> All listings</button>
          <h2>{heading}</h2>
          {data && <p>Showing {data.results.length} of {data.totalMatches} matches{data.totalMatches > data.results.length ? '. Narrow the filters to see the rest.' : ''}</p>}
        </div>
        <button className="btn brand" onClick={() => onAsk(describe(filters))}><Icon name="sparkle" /> Ask the Concierge instead</button>
      </div>

      <div className="filters">
        <div className="seg small">
          {['venue', 'service'].map((k) => (
            <button key={k} className={search.kind === k ? 'on' : ''} onClick={() => set({ kind: k, category: undefined })}>{k === 'venue' ? 'Venues' : 'Services'}</button>
          ))}
        </div>
        <label>City
          <select value={search.city ?? ''} onChange={(e) => set({ city: e.target.value || undefined })}>
            <option value="">Anywhere</option>
            {CITIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>When
          <input type="date" min={today()} value={search.date ?? ''} onChange={(e) => set({ date: e.target.value || undefined })} />
        </label>
        <label>Guests
          <input type="number" min="1" max="5000" placeholder="Any" value={search.guests ?? ''} onChange={(e) => set({ guests: e.target.value || undefined })} />
        </label>
        {search.category && <span className="chip on">{search.category} <button onClick={() => set({ category: undefined })} aria-label="Clear category"><Icon name="x" size={12} /></button></span>}
      </div>

      {error ? <p className="error">Search failed: {error.message}</p>
        : loading ? <div className="grid"><Skeletons n={10} /></div>
        : data.results.length === 0 ? (
          <div className="empty">
            <strong>Nothing matches those filters.</strong>
            <p>Try another date or headcount, or describe the event and let the Concierge look.</p>
            <button className="btn brand" onClick={() => onAsk(describe(filters))}>Ask the Concierge</button>
          </div>
        ) : <div className="grid">{data.results.map((l) => <ListingCard key={l.id} listing={l} onOpen={onOpen} />)}</div>}
    </section>
  );
}

function Facts({ l }) {
  const p = l.pricing ?? {};
  const rows = [
    ['Capacity', l.capacity ? `${l.capacity.min} to ${l.capacity.max} guests` : 'Any group size'],
    ['Hours', l.openHours ? `${l.openHours.start} to ${l.openHours.end}` : 'Any time'],
    ['Price', `${priceLabel(p)}${p.peak ? `, ${money(p.peak.rateCents)} on ${p.peak.days.join('/')}` : ''}`],
    p.minHours && ['Booking length', `${p.minHours}h minimum${p.maxHours ? `, ${p.maxHours}h maximum` : ''}`],
    p.cleaningFeeCents && ['Cleaning fee', money(p.cleaningFeeCents)],
    l.closedDays?.length && ['Closed', l.closedDays.join(', ')],
    l.leadTimeDays && ['Notice', `Book ${l.leadTimeDays} days ahead`],
    l.curfew && ['Curfew', `Amplified sound off at ${l.curfew}`],
    l.alcoholPolicy && ['Alcohol', ALCOHOL[l.alcoholPolicy]],
    ['Cancellation', POLICY[l.cancellationPolicy] ?? l.cancellationPolicy],
    l.blackoutDates?.length && ['Unavailable', l.blackoutDates.map(prettyDate).join(', ')],
  ].filter(Boolean);
  return <dl className="facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

/** Availability on date change, an exact sandbox quote on demand, and a hand-off to the agent to book. */
function QuoteBox({ l, onAsk }) {
  const [req, setReq] = useState(() => defaultRequest(l));
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const avail = useApi(() => api.availability(l.id, req.date), `${l.id}:${req.date}`);

  const set = (patch) => { setReq({ ...req, ...patch }); setQuote(null); setError(null); };
  const togglePackage = (id) => set({ packageIds: req.packageIds.includes(id) ? req.packageIds.filter((p) => p !== id) : [...req.packageIds, id] });

  async function getQuote() {
    setBusy(true); setError(null);
    try { setQuote(await api.quote({ listingId: l.id, ...req, guestCount: Number(req.guestCount) })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function book() {
    const pkgs = l.packages?.filter((p) => req.packageIds.includes(p.id)).map((p) => p.name) ?? [];
    onAsk(`I'd like to book ${l.name} on ${req.date} from ${req.startTime} to ${req.endTime} for ${req.guestCount} guests${pkgs.length ? `, with ${pkgs.join(' and ')}` : ''}.`);
  }

  const a = avail.data;
  return (
    <div className="quote-box">
      <div className="quote-price"><strong>{priceLabel(l.pricing)}</strong>{l.instantBook ? <span className="ok">Instant book</span> : <span className="warn">Host approves</span>}</div>
      <div className="quote-form">
        <label className="full">Date<input type="date" min={today()} value={req.date} onChange={(e) => set({ date: e.target.value })} /></label>
        <label>From<input type="time" step="1800" value={req.startTime} onChange={(e) => set({ startTime: e.target.value })} /></label>
        <label>To<input type="time" step="1800" value={req.endTime} onChange={(e) => set({ endTime: e.target.value })} /></label>
        <label className="full">Guests<input type="number" min="1" value={req.guestCount} onChange={(e) => set({ guestCount: e.target.value })} /></label>
      </div>
      <p className={`avail ${a ? (a.available ? 'ok' : 'bad') : ''}`}>
        {avail.loading ? 'Checking the date…'
          : avail.error ? avail.error.message
          : a.available ? <><Icon name="check" size={14} /> {prettyDate(a.date)} is open{a.bookedSlots.length ? `, already booked ${a.bookedSlots.map((s) => `${s.startTime}–${s.endTime}`).join(', ')}` : ''}</>
          : <><Icon name="x" size={14} /> Not available on {prettyDate(a.date)} ({a.reason === 'past_date' ? 'that date has passed' : 'blacked out'})</>}
      </p>
      {l.packages?.length > 0 && (
        <fieldset className="packages">
          <legend>Add-ons</legend>
          {l.packages.map((p) => (
            <label key={p.id}>
              <input type="checkbox" checked={req.packageIds.includes(p.id)} onChange={() => togglePackage(p.id)} />
              <span>{p.name}<small>{money(p.priceCents)}{p.perGuest ? ' per guest' : ''}</small></span>
            </label>
          ))}
        </fieldset>
      )}
      {!quote && <button className="btn dark wide" onClick={getQuote} disabled={busy}>{busy ? 'Pricing…' : 'Get the exact price'}</button>}
      {error && <p className="error">{error}</p>}
      {quote && (
        <div className="lines">
          {quote.lineItems.map((li) => <div key={li.label}><span>{li.label}</span><span>{money(li.amountCents)}</span></div>)}
          <div><span>PLEC service fee</span><span>{money(quote.serviceFeeCents)}</span></div>
          <div className="total"><span>Total</span><span>{money(quote.totalCents)}</span></div>
        </div>
      )}
      <button className="btn brand wide" onClick={book}><Icon name="sparkle" /> {quote ? 'Book this with the Concierge' : 'Ask the Concierge to book'}</button>
      <p className="fine center">The Concierge confirms every detail with you before anything is booked.</p>
    </div>
  );
}

export function ListingModal({ id, onClose, onAsk }) {
  const { data: l, error } = useApi(() => api.listing(id), id);
  return (
    <Modal label={l?.name ?? 'Listing'} onClose={onClose} wide>
      {error ? <p className="error pad">Could not load this listing: {error.message}</p>
        : !l ? <div className="pad"><div className="skeleton-block" /></div>
        : (
          <div className="listing">
            <div className="gallery">
              {l.photoUrls.map((src, i) => <img key={src} src={src} alt={i === 0 ? l.name : ''} />)}
            </div>
            <div className="listing-body">
              <div className="listing-main">
                <p className="eyebrow">{l.kind} · {l.category}</p>
                <h2>{l.name}</h2>
                <p className="listing-sub">
                  <Icon name="star" size={14} fill /> {l.rating} ({l.reviewCount} reviews) · {l.neighborhood}, {l.city}
                  {l.mapUrl && <> · <a href={l.mapUrl} target="_blank" rel="noreferrer"><Icon name="pin" size={14} /> Map</a></>}
                </p>
                {/* Host-written text: shown as plain text, never as markup or instructions. */}
                <p className="desc">{l.description}</p>
                {l.amenities?.length > 0 && (
                  <>
                    <h3>What this place offers</h3>
                    <ul className="amenities">{l.amenities.map((a) => <li key={a}><Icon name="check" size={14} /> {a}</li>)}</ul>
                  </>
                )}
                <h3>Good to know</h3>
                <Facts l={l} />
                <button className="btn ghost" onClick={() => onAsk(`Tell me about ${l.name}. Is it a good fit for my event?`)}>
                  <Icon name="chat" size={16} /> Ask the Concierge about this place
                </button>
              </div>
              <QuoteBox l={l} onAsk={onAsk} />
            </div>
          </div>
        )}
    </Modal>
  );
}
