import { useEffect, useState } from 'react';

// Every call goes through the backend (/api/*, proxied by Vite); the sandbox key never reaches the browser.
async function call(path, init) {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Request failed (${res.status})`);
  return body;
}

const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  search: (filters) => call(`/api/listings?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''))}`),
  listing: (id) => call(`/api/listings/${encodeURIComponent(id)}`),
  availability: (id, date) => call(`/api/listings/${encodeURIComponent(id)}/availability?date=${date}`),
  quote: (inputs) => call('/api/quotes', post(inputs)),
  booking: (ref) => call(`/api/bookings/${encodeURIComponent(ref.trim())}`),
};

/** { loading } -> { data } | { error }. Re-runs when `key` changes. */
export function useApi(load, key) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    load().then((data) => live && setState({ data }), (error) => live && setState({ error }));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export const money = (cents) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export function priceLabel(pricing) {
  if (!pricing) return 'Price on request';
  const unit = { hourly: '/hour', flat: '/event', perGuest: '/person' }[pricing.model] ?? '';
  return `${money(pricing.rateCents)} ${unit}`;
}

// ---------- dates (the sandbox's "today" is the UTC date) ----------
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const today = () => new Date().toISOString().slice(0, 10);
export const weekday = (date) => DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const prettyDate = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

const hour = (hhmm) => Number(hhmm.slice(0, 2));
const hhmm = (h) => `${String(h).padStart(2, '0')}:00`;

/** A sensible first guess for the quote form: an open Saturday a few weeks out, an evening slot, a group that fits. */
export function defaultRequest(listing) {
  const start = addDays(today(), Math.max(14, listing.leadTimeDays ?? 0));
  const open = (d) => !(listing.closedDays ?? []).includes(weekday(d)) && !(listing.blackoutDates ?? []).includes(d);
  const days = Array.from({ length: 60 }, (_, i) => addDays(start, i)).filter(open);
  const date = days.find((d) => weekday(d) === 'sat') ?? days[0] ?? start;

  const { minHours = 1, maxHours = 24 } = listing.pricing ?? {};
  const hours = Math.min(Math.max(4, minHours), maxHours);
  const close = listing.openHours ? Math.min(hour(listing.openHours.end), 23) : 23;
  const opens = listing.openHours ? hour(listing.openHours.start) : 0;
  const from = Math.max(opens, Math.min(18, close - hours));

  const cap = listing.capacity;
  const guestCount = cap ? Math.min(Math.max(40, cap.min), cap.max) : 40;
  return { date, startTime: hhmm(from), endTime: hhmm(Math.min(from + hours, close)), guestCount, packageIds: [] };
}
