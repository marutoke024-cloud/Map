// Rail-station data from OpenStreetMap via the Overpass API.
//
// We fetch, for the bounding box of the deepest (leaf) area:
//   - every railway=station node (name + position)
//   - every rail route relation WITH geometry (route=train/subway/…)
// then resolve "何線" per station by checking which route polylines pass close
// to the station (membership linking in OSM is unreliable for Japanese data,
// proximity is far more robust). Results cached in localStorage for 30 days.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const CACHE_PREFIX = 'spots.stations.v3.';
const TTL = 1000 * 60 * 60 * 24 * 30;
const NEAR_M = 170; // a track within this distance counts as serving the station

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
  return `[out:json][timeout:60];
node["railway"="station"](${bbox});
out body;
relation["route"~"train|subway|light_rail|monorail|tram"](${bbox});
out tags geom;`;
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
  // Prefer Japanese line name; fall back to operator + ref.
  return tags['name:ja'] || tags['name'] || [tags['operator'], tags['ref']].filter(Boolean).join(' ') || tags['ref'] || '';
}

// metres between two [lon,lat] using an equirectangular approximation
function distM(aLon, aLat, bLon, bLat) {
  const R = 6371000;
  const x = ((bLon - aLon) * Math.PI) / 180 * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  const y = ((bLat - aLat) * Math.PI) / 180;
  return R * Math.hypot(x, y);
}

export async function loadStations(id, bbox) {
  const cached = cacheGet(id);
  if (cached) return cached;

  const json = await runOverpass(buildQuery(bbox));
  const stations = [];
  const routes = [];
  for (const el of json.elements || []) {
    if (el.type === 'node' && el.tags?.railway === 'station' && el.tags?.name) {
      stations.push({ id: 'st_' + el.id, name: el.tags['name'], lon: el.lon, lat: el.lat, lines: [] });
    } else if (el.type === 'relation' && el.members) {
      const name = lineName(el.tags);
      if (!name) continue;
      const pts = [];
      for (const m of el.members) {
        if (m.geometry) for (const g of m.geometry) pts.push([g.lon, g.lat]);
      }
      if (pts.length) routes.push({ name, pts });
    }
  }

  // assign lines by proximity (sampling track vertices keeps it fast)
  for (const s of stations) {
    for (const r of routes) {
      let near = false;
      for (let i = 0; i < r.pts.length; i += 1) {
        if (distM(s.lon, s.lat, r.pts[i][0], r.pts[i][1]) < NEAR_M) {
          near = true;
          break;
        }
      }
      if (near && !s.lines.includes(r.name)) s.lines.push(r.name);
    }
  }

  cacheSet(id, stations);
  return stations;
}
