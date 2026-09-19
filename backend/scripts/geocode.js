/**
 * One-off (PRD B5): geocode every catalogue address with OpenStreetMap
 * Nominatim and write backend/data/geo.json as { [id]: { lat, lng, precision } }.
 * Run it by hand and commit the output; the agent never geocodes at runtime.
 *
 *   node backend/scripts/geocode.js
 *
 * Nominatim's usage policy: at most one request per second and a real User-Agent.
 * A miss on the address retries "<neighborhood>, <city>", then falls back to the city centre.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const listings = JSON.parse(readFileSync(new URL('../data/listings.json', import.meta.url), 'utf8'));
const OUT = new URL('../data/geo.json', import.meta.url);
const CITY_CENTRES = {
  Philadelphia: { lat: 39.9526, lng: -75.1652 },
  'New York': { lat: 40.7128, lng: -74.006 },
  Washington: { lat: 38.9072, lng: -77.0369 },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function lookup(q) {
  await sleep(1100);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'plecathon-agent-template/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    const [hit] = res.ok ? await res.json() : [];
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch (err) {
    console.warn(`  lookup failed for "${q}": ${err.message}`);
    return null;
  }
}

const geo = {};
const counts = { address: 0, neighborhood: 0, city: 0 };
for (const l of listings) {
  let precision = 'address';
  let point = await lookup(l.address);
  if (!point) [precision, point] = ['neighborhood', await lookup(`${l.neighborhood}, ${l.city}`)];
  if (!point) [precision, point] = ['city', CITY_CENTRES[l.city]];
  geo[l.id] = { ...point, precision };
  counts[precision]++;
  console.log(`${precision.padEnd(12)} ${l.id}`);
}
writeFileSync(OUT, `${JSON.stringify(geo, null, 2)}\n`);
console.log(`Wrote ${Object.keys(geo).length} listings:`, counts);
