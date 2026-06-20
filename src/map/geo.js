import { geoMercator, geoPath, geoBounds } from 'd3-geo';
import { feature } from 'topojson-client';

// Logical drawing size. The SVG scales responsively but the projection is fit
// to this fixed canvas so geo<->screen coordinates stay stable across views.
export const W = 1600;
export const H = 1000;

let _features = null; // id -> GeoJSON feature
let _projection = null;
let _path = null;

export async function loadGeo() {
  if (_features) return;
  const res = await fetch(`${import.meta.env.BASE_URL}data/japan.topojson`);
  const topo = await res.json();
  const fc = feature(topo, topo.objects.japan);

  _features = {};
  for (const f of fc.features) _features[f.properties.id] = f;

  // Fit the mainland (drop the far-flung Okinawa, id 47) so Honshu fills frame.
  const mainland = {
    type: 'FeatureCollection',
    features: fc.features.filter((f) => f.properties.id !== 47),
  };

  _projection = geoMercator().fitExtent(
    [
      [W * 0.06, H * 0.06],
      [W * 0.94, H * 0.94],
    ],
    mainland,
  );
  _path = geoPath(_projection);
}

export const projection = () => _projection;
export const path = () => _path;
export const featureById = (id) => _features[id];
export const allFeatures = () => Object.values(_features);

// Project [lon,lat] -> [x,y] in canvas space.
export function project(lonlat) {
  return _projection(lonlat);
}
// Inverse: screen canvas [x,y] -> [lon,lat].
export function unproject(xy) {
  return _projection.invert(xy);
}

/**
 * Compute a zoom transform {k, x, y} that frames the given features within the
 * canvas with padding. Used to drive the dramatic fly-to transitions.
 */
export function frameFeatures(features, pad = 0.16) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const f of features) {
    const [[bx0, by0], [bx1, by1]] = _path.bounds(f);
    x0 = Math.min(x0, bx0);
    y0 = Math.min(y0, by0);
    x1 = Math.max(x1, bx1);
    y1 = Math.max(y1, by1);
  }
  const bw = x1 - x0;
  const bh = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const k = Math.min(W / (bw * (1 + pad)), H / (bh * (1 + pad)));
  const tx = W / 2 - cx * k;
  const ty = H / 2 - cy * k;
  return { k, x: tx, y: ty };
}

export const IDENTITY = { k: 1, x: 0, y: 0 };
