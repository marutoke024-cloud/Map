// Rail-station data from OpenStreetMap via the Overpass API.
//
// For the bounding box of the deepest (leaf) area we fetch:
//   - railway=station nodes (name + position)
//   - rail route relations (route=train/subway/…) WITH geometry  → line names
//   - named rail ways (railway=rail/…) WITH geometry             → line names
// and resolve "何線" per station by which line geometry passes closest to it
// (OSM membership linking is unreliable for Japan; proximity is robust). Both
// relations and ways are used because Japanese data carries the line name on
// one or the other depending on the operator. Cached 30 days.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];
const CACHE_PREFIX = 'spots.stations.v4.';
const TTL = 1000 * 60 * 60 * 24 * 30;
const NEAR_M = 200; // a line within this distance counts as serving the station

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
way["railway"~"^(rail|light_rail|subway|monorail|tram|narrow_gauge)$"](${bbox});
out tags geom;
relation["route"~"train|subway|light_rail|monorail|tram|railway"](${bbox});
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
  return (
    tags['name:ja'] ||
    tags['name'] ||
    [tags['operator'], tags['ref']].filter(Boolean).join(' ') ||
    tags['ref'] ||
    ''
  );
}

// metres between two [lon,lat] (equirectangular approximation)
function distM(aLon, aLat, bLon, bLat) {
  const R = 6371000;
  const x = (((bLon - aLon) * Math.PI) / 180) * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180);
  const y = ((bLat - aLat) * Math.PI) / 180;
  return R * Math.hypot(x, y);
}

export async function loadStations(id, bbox) {
  const cached = cacheGet(id);
  if (cached) return cached;

  const json = await runOverpass(buildQuery(bbox));
  const stations = [];
  const lines = []; // { name, pts:[[lon,lat],…] }

  for (const el of json.elements || []) {
    if (el.type === 'node' && el.tags?.railway === 'station' && el.tags?.name) {
      stations.push({ id: 'st_' + el.id, name: el.tags['name'], lon: el.lon, lat: el.lat, lines: [] });
    } else if (el.type === 'way' && el.geometry) {
      const name = lineName(el.tags);
      if (name) lines.push({ name, pts: el.geometry.map((g) => [g.lon, g.lat]) });
    } else if (el.type === 'relation' && el.members) {
      const name = lineName(el.tags);
      if (!name) continue;
      const pts = [];
      for (const m of el.members) if (m.geometry) for (const g of m.geometry) pts.push([g.lon, g.lat]);
      if (pts.length) lines.push({ name, pts });
    }
  }

  for (const s of stations) {
    for (const ln of lines) {
      if (s.lines.includes(ln.name)) continue;
      let near = false;
      for (let i = 0; i < ln.pts.length; i++) {
        if (distM(s.lon, s.lat, ln.pts[i][0], ln.pts[i][1]) < NEAR_M) {
          near = true;
          break;
        }
      }
      if (near) s.lines.push(ln.name);
    }
    s.lines.sort((a, b) => a.length - b.length);
  }

  cacheSet(id, stations);
  return stations;
}
