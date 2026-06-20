import { geoMercator, geoPath } from 'd3-geo';
import { feature, merge } from 'topojson-client';

// Logical drawing size. The SVG fits the projection to this fixed canvas so
// geo<->screen coordinates stay stable across every zoom level.
export const W = 1600;
export const H = 1000;

let _prefById = null; // prefecture id -> Feature (from japan.topojson)
let _projection = null;
let _path = null;
const _muni = {}; // prefKey -> { cities:[...], byCity:Map }

// ---------------------------------------------------------------------------
// Base prefecture geometry + projection
// ---------------------------------------------------------------------------
export async function loadGeo() {
  if (_prefById) return;
  const res = await fetch(`${import.meta.env.BASE_URL}data/japan.topojson`);
  const topo = await res.json();
  const fc = feature(topo, topo.objects.japan);

  _prefById = {};
  for (const f of fc.features) _prefById[f.properties.id] = f;

  // Fit mainland (drop far-flung Okinawa id 47) into the canvas with padding so
  // Hokkaido in the north is fully visible.
  const mainland = {
    type: 'FeatureCollection',
    features: fc.features.filter((f) => f.properties.id !== 47),
  };
  _projection = geoMercator().fitExtent(
    [
      [W * 0.06, H * 0.05],
      [W * 0.94, H * 0.95],
    ],
    mainland,
  );
  _path = geoPath(_projection);
}

export const path = () => _path;
export const featureById = (id) => _prefById[id];
export const allFeatures = () => Object.values(_prefById);
export const project = (lonlat) => _projection(lonlat);
export const unproject = (xy) => _projection.invert(xy);

// ---------------------------------------------------------------------------
// Municipal geometry (lazy per prefecture)
// ---------------------------------------------------------------------------
// A "city unit" is a clickable municipality at the prefecture level:
//   - designated city (政令市): its wards merged into one shape, has wardUnits
//   - everything else (市/町/村/特別区): a single municipality, leaf
export async function loadMunicipality(prefKey) {
  if (_muni[prefKey]) return _muni[prefKey];
  const res = await fetch(`${import.meta.env.BASE_URL}data/municipality/${prefKey}.topojson`);
  const topo = await res.json();
  const objName = Object.keys(topo.objects)[0];
  const geoms = topo.objects[objName].geometries;

  const groups = new Map(); // cityKey -> { key, ja, designated, geoms:[] }
  for (const g of geoms) {
    const p = g.properties;
    const isWard =
      p.N03_003 && p.N03_003.endsWith('市') && p.N03_004 && p.N03_004.endsWith('区');
    const key = isWard ? p.N03_003 : `${p.N03_004}|${p.N03_003 || ''}`;
    const ja = isWard ? p.N03_003 : p.N03_004;
    if (!groups.has(key)) groups.set(key, { key, ja, designated: isWard, geoms: [] });
    groups.get(key).geoms.push(g);
  }

  const cities = [...groups.values()].map((c) => {
    const merged = c.geoms.length > 1 ? merge(topo, c.geoms) : c.geoms[0];
    const cityFeature =
      c.geoms.length > 1
        ? { type: 'Feature', properties: { ja: c.ja }, geometry: merged }
        : feature(topo, c.geoms[0]);
    const wardUnits = c.designated
      ? c.geoms.map((g) => ({
          key: g.properties.N03_004,
          ja: g.properties.N03_004,
          feature: feature(topo, g),
        }))
      : null;
    return { key: c.key, ja: c.ja, designated: c.designated, feature: cityFeature, wardUnits };
  });

  cities.sort((a, b) => a.ja.localeCompare(b.ja, 'ja'));
  _muni[prefKey] = { cities, byCity: new Map(cities.map((c) => [c.key, c])) };
  return _muni[prefKey];
}

export const getMunicipality = (prefKey) => _muni[prefKey];

// ---------------------------------------------------------------------------
// Framing — ignores tiny distant islands so a prefecture/city frames tightly
// on its mainland body (e.g. excludes Kanagawa's southern islands).
// ---------------------------------------------------------------------------
function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

// Bounds of the single largest-area ring group of a feature, in screen px.
function mainBounds(feat) {
  const polys = polygonsOf(feat.geometry);
  if (polys.length <= 1) return _path.bounds(feat);
  let best = null;
  let bestArea = -1;
  for (const poly of polys) {
    const single = { type: 'Feature', geometry: { type: 'Polygon', coordinates: poly } };
    const b = _path.bounds(single);
    const area = (b[1][0] - b[0][0]) * (b[1][1] - b[0][1]);
    if (area > bestArea) {
      bestArea = area;
      best = b;
    }
  }
  return best;
}

export function frameFeatures(features, pad = 0.18) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const f of features) {
    const b = mainBounds(f);
    x0 = Math.min(x0, b[0][0]);
    y0 = Math.min(y0, b[0][1]);
    x1 = Math.max(x1, b[1][0]);
    y1 = Math.max(y1, b[1][1]);
  }
  const bw = x1 - x0;
  const bh = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const k = Math.min(W / (bw * (1 + pad)), H / (bh * (1 + pad)));
  return { k, x: W / 2 - cx * k, y: H / 2 - cy * k };
}

// Geographic bbox [[minLon,minLat],[maxLon,maxLat]] of a feature's main body,
// used to scope the Overpass station query.
export function geoBBox(feat) {
  const b = mainBounds(feat);
  const a = unproject([b[0][0], b[1][1]]); // bottom-left screen -> lon,lat
  const c = unproject([b[1][0], b[0][1]]); // top-right
  return [
    [Math.min(a[0], c[0]), Math.min(a[1], c[1])],
    [Math.max(a[0], c[0]), Math.max(a[1], c[1])],
  ];
}

export const IDENTITY = { k: 1, x: 0, y: 0 };
