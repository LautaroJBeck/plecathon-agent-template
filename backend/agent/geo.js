/**
 * Distances for "near me" and "near <place>" (PRD B5). Coordinates come from
 * backend/data/geo.json, written once by backend/scripts/geocode.js; nothing is
 * geocoded at runtime. Without geo.json, distance search just finds no origin.
 */

import { existsSync, readFileSync } from 'node:fs';
import { catalogue } from './extras.js';

const GEO_FILE = new URL('../data/geo.json', import.meta.url);
const GEO = existsSync(GEO_FILE) ? JSON.parse(readFileSync(GEO_FILE, 'utf8')) : {};
const EARTH_RADIUS_MILES = 3958.8;

/** { lat, lng, precision } of a listing id, or undefined. */
export function pointOf(id) {
  return GEO[id];
}

/** Great-circle distance between two { lat, lng } points, in miles. */
export function haversineMiles(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/** Mean position of a neighborhood's listings (name case-insensitive), or null.
 *  Listings that only geocoded to their city centre are left out. */
export function neighborhoodCentroid(name) {
  const key = lc(name);
  const points = catalogue()
    .filter((l) => lc(l.neighborhood) === key)
    .map((l) => GEO[l.id])
    .filter((p) => p && p.precision !== 'city');
  if (!points.length) return null;
  const mean = (k) => points.reduce((sum, p) => sum + p[k], 0) / points.length;
  return { lat: mean('lat'), lng: mean('lng') };
}

/** Where distances are measured from: explicit lat/lng, then `near` (a neighborhood or a
 *  listing name), then the browser location the chat page sent. Returns { lat, lng, label } or null.
 *  A `near` that matches nothing gives null rather than silently using the browser location. */
export function resolveOrigin({ lat, lng, near } = {}, session) {
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, label: 'the given point' };
  const q = lc(near);
  if (q) {
    const hoods = [...new Set(catalogue().map((l) => l.neighborhood).filter(Boolean))];
    const byName = catalogue().find((l) => GEO[l.id] && GEO[l.id].precision !== 'city'
      && (lc(l.name) === q || (q.length >= 4 && (lc(l.name).includes(q) || q.includes(lc(l.name))))));
    const hood = hoods.find((h) => lc(h) === q);
    if (hood && neighborhoodCentroid(hood)) return { ...neighborhoodCentroid(hood), label: hood };
    if (byName) return { lat: GEO[byName.id].lat, lng: GEO[byName.id].lng, label: byName.name };
    const within = hoods.find((h) => q.includes(lc(h)) && neighborhoodCentroid(h));
    return within ? { ...neighborhoodCentroid(within), label: within } : null;
  }
  const here = session?.state?.userLocation;
  return here && Number.isFinite(here.lat) && Number.isFinite(here.lng) ? { lat: here.lat, lng: here.lng, label: 'your location' } : null;
}

function lc(s) {
  return String(s ?? '').trim().toLowerCase();
}
