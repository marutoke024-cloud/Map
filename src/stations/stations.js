// Rail-station data from OpenStreetMap via the Overpass API.
//
// Stations are fetched for the bounding box of the deepest (leaf) area the user
// has zoomed into — a single ward or municipality — so the query stays small.
// For each station we also resolve the rail lines passing through it (route
// relations) so a click can show "何線・何駅". Results are cached in
// localStorage for 30 days.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const CACHE_PREFIX = 'spots.stations.v2.';
const TTL = 1000 * 60 * 60 * 24 * 30;

function cacheGet(id) {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_PREFIX + id) || 'null');
    if (raw && Date.now() - raw.t < TTL) return raw.d;
  } catch {}
  return null;
}
function cacheSet(id, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + id, JSON.stringify({ t: Date.now(), d: data }));
  } catch {}
}

function buildQuery([[minLon, minLat], [maxLon, maxLat]]) {
  const bbox = `${minLat},${minLon},${maxLat},${maxLon}`;
  return `[out:json][timeout:40];
node["railway"="station"](${bbox})->.st;
.st out body;
rel(bn.st)["route"~"train|subway|light_rail|monorail|tram|railway"];
out body;`;
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

function lineName(tags = {}) {
  return (
    tags['name:ja'] ||
    tags['name'] ||
    [tags['operator'], tags['ref']].filter(Boolean).join(' ') ||
    tags['ref'] ||
    ''
  );
}

/**
 * @param {string} id    cache id (e.g. "osaka:大阪市:西区")
 * @param {Array}  bbox  [[minLon,minLat],[maxLon,maxLat]]
 */
export async function loadStations(id, bbox) {
  const cached = cacheGet(id);
  if (cached) return cached;

  const json = await runOverpass(buildQuery(bbox));
  const stationById = new Map();
  for (const el of json.elements || []) {
    if (el.type === 'node' && el.tags?.railway === 'station' && el.tags?.name) {
      stationById.set(el.id, {
        id: 'st_' + el.id,
        osmId: el.id,
        name: el.tags['name'],
        lon: el.lon,
        lat: el.lat,
        lines: [],
      });
    }
  }
  // route relations -> attach line names to member stations
  for (const el of json.elements || []) {
    if (el.type !== 'relation' || !el.members) continue;
    const ln = lineName(el.tags);
    if (!ln) continue;
    for (const m of el.members) {
      if (m.type === 'node' && stationById.has(m.ref)) {
        const s = stationById.get(m.ref);
        if (!s.lines.includes(ln)) s.lines.push(ln);
      }
    }
  }
  const stations = [...stationById.values()];
  cacheSet(id, stations);
  return stations;
}
