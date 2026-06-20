// Rail-station data from OpenStreetMap via the Overpass API.
//
// Per the spec we only need stations for the 8 target prefectures. Results are
// fetched lazily on first visit to a prefecture and cached in localStorage for
// 30 days so we are gentle on the public Overpass endpoints.

import { PREFECTURES } from '../config.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const CACHE_PREFIX = 'spots.stations.';
const TTL = 1000 * 60 * 60 * 24 * 30;

function cacheGet(prefKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_PREFIX + prefKey) || 'null');
    if (raw && Date.now() - raw.t < TTL) return raw.d;
  } catch {}
  return null;
}
function cacheSet(prefKey, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + prefKey, JSON.stringify({ t: Date.now(), d: data }));
  } catch {}
}

function buildQuery(osmArea) {
  // station=* nodes and railway=station nodes within the named admin area.
  return `[out:json][timeout:25];
area["name:en"="${osmArea}"]["admin_level"~"4|5"]->.a;
(
  node["railway"="station"]["station"!="subway"](area.a);
  node["railway"="station"](area.a);
);
out body 1200;`;
}

async function runOverpass(query) {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export async function loadStations(prefKey) {
  const cached = cacheGet(prefKey);
  if (cached) return cached;

  const pref = PREFECTURES[prefKey];
  if (!pref) return [];

  const json = await runOverpass(buildQuery(pref.osm));
  const seen = new Set();
  const stations = [];
  for (const el of json.elements || []) {
    const name = el.tags?.['name'];
    if (!name || el.lon == null) continue;
    const key = name + '@' + el.lat.toFixed(3) + ',' + el.lon.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    stations.push({ id: 'st_' + el.id, name, lon: el.lon, lat: el.lat });
  }
  cacheSet(prefKey, stations);
  return stations;
}
