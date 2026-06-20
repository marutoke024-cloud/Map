import { select } from 'd3-selection';
import { gsap } from 'gsap';
import {
  W,
  H,
  path,
  project,
  unproject,
  featureById,
  allFeatures,
  frameFeatures,
  IDENTITY,
} from './geo.js';
import { PREF_ID_TO_REGION, PREFECTURES, REGIONS } from '../config.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let svg, zoomG, prefG, extrudeG, glowG, overlay, stationsG, pinsG;
let handlers = {};
let transform = { ...IDENTITY };
let activePrefId = null;
let renderedStations = [];
let renderedPins = [];

const DEPTH_PX = 26; // on-screen extrusion height
const DEPTH_STEPS = 20;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
export function initMap(svgEl, h) {
  handlers = h;
  svg = select(svgEl).attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid slice');

  buildDefs();

  // Decorative ocean graticule (parallax-ready, very faint).
  const grid = svg.append('g').attr('class', 'ocean-grid');
  for (let i = -4; i <= 28; i++) {
    grid
      .append('line')
      .attr('x1', (i * W) / 24)
      .attr('y1', -H)
      .attr('x2', (i * W) / 24 - W * 0.3)
      .attr('y2', H * 2)
      .attr('class', 'grid-line');
  }

  zoomG = svg.append('g').attr('class', 'zoom');
  extrudeG = zoomG.append('g').attr('class', 'extrude');
  prefG = zoomG.append('g').attr('class', 'prefs');
  glowG = zoomG.append('g').attr('class', 'region-glow');

  // Screen-space overlay for crisp, constant-size markers.
  overlay = svg.append('g').attr('class', 'overlay');
  stationsG = overlay.append('g').attr('class', 'stations');
  pinsG = overlay.append('g').attr('class', 'pins');

  // Single click dispatcher. The controller decides whether the click navigates
  // (region/prefecture) or drops a pin, based on the current view — so clicking
  // the prefecture landmass in pref view still places a pin.
  svg.on('click', function (event) {
    if (event.target.closest('.pin') || event.target.closest('.station')) return;
    const [sx, sy] = pointer(event);
    const prefEl = event.target.closest('.pref');
    const prefId = prefEl ? select(prefEl).datum()?.properties.id : null;
    handlers.onMapClick?.({ prefId, geo: screenToGeo(sx, sy), screen: { sx, sy } });
  });

  renderBase();
}

function buildDefs() {
  const defs = svg.append('defs');

  const glow = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
  glow.append('feGaussianBlur').attr('stdDeviation', 6).attr('result', 'b');
  const m = glow.append('feMerge');
  m.append('feMergeNode').attr('in', 'b');
  m.append('feMergeNode').attr('in', 'SourceGraphic');

  const soft = defs.append('filter').attr('id', 'soft').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
  soft.append('feGaussianBlur').attr('stdDeviation', 2.2);

  const grad = defs.append('linearGradient').attr('id', 'shapeGrad').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#E4D7CC');
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#C5B2A4');
}

// Mouse/touch position in viewBox coordinates.
function pointer(event) {
  const r = svg.node().getBoundingClientRect();
  const cx = (event.touches?.[0]?.clientX ?? event.clientX) - r.left;
  const cy = (event.touches?.[0]?.clientY ?? event.clientY) - r.top;
  // slice scaling: viewBox is fit with xMidYMid slice
  const scale = Math.max(W / r.width, H / r.height);
  const offX = (r.width * scale - W) / 2;
  const offY = (r.height * scale - H) / 2;
  return [cx * scale - offX, cy * scale - offY];
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------
function geoToScreen(lon, lat) {
  const p = project([lon, lat]);
  return [p[0] * transform.k + transform.x, p[1] * transform.k + transform.y];
}
function screenToGeo(sx, sy) {
  const cx = (sx - transform.x) / transform.k;
  const cy = (sy - transform.y) / transform.k;
  return unproject([cx, cy]);
}

// ---------------------------------------------------------------------------
// Base map
// ---------------------------------------------------------------------------
export function renderBase() {
  const p = path();
  prefG
    .selectAll('path.pref')
    .data(allFeatures(), (f) => f.properties.id)
    .join('path')
    .attr('class', (f) => {
      const region = PREF_ID_TO_REGION[f.properties.id];
      return 'pref' + (region ? ' pref--playable pref--' + region : '');
    })
    .attr('d', p);
}

// ---------------------------------------------------------------------------
// Fly-to transition
// ---------------------------------------------------------------------------
export function flyTo(target, { duration = 1.5, onComplete } = {}) {
  gsap.killTweensOf(transform);
  gsap.to(transform, {
    k: target.k,
    x: target.x,
    y: target.y,
    duration,
    ease: 'power3.inOut',
    onUpdate: applyTransform,
    onComplete: () => {
      applyTransform();
      onComplete?.();
    },
  });
}

function applyTransform() {
  zoomG.attr('transform', `translate(${transform.x} ${transform.y}) scale(${transform.k})`);
  repositionOverlay();
}

export function getTransform() {
  return { ...transform };
}

// ---------------------------------------------------------------------------
// View framing
// ---------------------------------------------------------------------------
export function frameForJapan() {
  return { ...IDENTITY };
}
export function frameForRegion(regionKey) {
  const feats = REGIONS[regionKey].members.map((k) => featureById(PREFECTURES[k].id));
  return frameFeatures(feats, 0.28);
}
export function frameForPrefecture(prefKey) {
  const f = featureById(PREFECTURES[prefKey].id);
  return frameFeatures([f], 0.22);
}

// ---------------------------------------------------------------------------
// Highlighting + 3D extrusion
// ---------------------------------------------------------------------------
export function setHighlight({ view, regionKey, prefKey }) {
  const p = path();

  // playable styling
  prefG.selectAll('path.pref').classed('is-active', false).classed('is-dim', false).classed('is-member', false);

  if (view === 'japan') {
    extrudeG.selectAll('*').remove();
    glowG.selectAll('*').remove();
    activePrefId = null;
    return;
  }

  if (!prefKey) {
    // region view: dim non-members, raise members
    const memberIds = new Set(REGIONS[regionKey].members.map((k) => PREFECTURES[k].id));
    prefG.selectAll('path.pref').each(function (f) {
      const s = select(this);
      if (memberIds.has(f.properties.id)) s.classed('is-member', true);
      else s.classed('is-dim', true);
    });
    drawExtrusion([...memberIds].map((id) => featureById(id)), 12, frameForRegion(regionKey).k);
    glowG.selectAll('*').remove();
    activePrefId = null;
    return;
  }

  // prefecture view: single block extruded, others hidden
  const id = PREFECTURES[prefKey].id;
  activePrefId = id;
  prefG.selectAll('path.pref').each(function (f) {
    const s = select(this);
    if (f.properties.id === id) s.classed('is-active', true);
    else s.classed('is-dim', true);
  });
  drawExtrusion([featureById(id)], DEPTH_STEPS, frameForPrefecture(prefKey).k);

  // soft ground glow under the block
  glowG.selectAll('*').remove();
  glowG
    .append('path')
    .attr('class', 'ground-glow')
    .attr('d', p(featureById(id)))
    .attr('filter', 'url(#glow)');
}

function drawExtrusion(features, steps, k) {
  extrudeG.selectAll('*').remove();
  const p = path();
  // Keep extrusion depth constant in screen pixels regardless of zoom level.
  const stepDy = DEPTH_PX / k / steps;
  const stepDx = stepDy * 0.35;

  for (const f of features) {
    const d = p(f);
    if (!d) continue;
    const g = extrudeG.append('g').attr('class', 'extrude-block');
    for (let i = steps; i >= 1; i--) {
      g.append('path')
        .attr('d', d)
        .attr('class', 'extrude-wall')
        .attr('transform', `translate(${stepDx * i} ${stepDy * i})`);
    }
  }
  // animate the block rising
  gsap.fromTo(
    extrudeG.node(),
    { opacity: 0 },
    { opacity: 1, duration: 0.9, ease: 'power2.out' },
  );
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------
export function renderStations(list, visible) {
  renderedStations = visible ? list : [];
  const sel = stationsG
    .selectAll('g.station')
    .data(renderedStations, (d) => d.id)
    .join(
      (enter) => {
        const g = enter.append('g').attr('class', 'station');
        g.append('path')
          .attr('class', 'station-mark')
          .attr('d', 'M0,-7 L4,-1 L1.6,-1 L1.6,5 L-1.6,5 L-1.6,-1 L-4,-1 Z'); // little rail/diamond glyph
        g.append('circle').attr('class', 'station-core').attr('r', 2.1);
        g.append('text').attr('class', 'station-label').attr('x', 8).attr('y', 3).text((d) => d.name);
        return g;
      },
      (update) => update,
      (exit) => exit.remove(),
    );
  void sel;
  repositionOverlay();
}

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------
export function renderPins(list, { privateMode, activeId } = {}) {
  renderedPins = list.filter((p) => privateMode || !p.locked);
  pinsG
    .selectAll('g.pin')
    .data(renderedPins, (d) => d.id)
    .join(
      (enter) => {
        const g = enter.append('g').attr('class', 'pin');
        g.append('circle').attr('class', 'pin-halo').attr('r', 16);
        g.append('path')
          .attr('class', 'pin-body')
          .attr('d', 'M0,0 C-9,-12 -9,-22 0,-22 C9,-22 9,-12 0,0 Z')
          .attr('transform', 'translate(0,-2)');
        g.append('circle').attr('class', 'pin-dot').attr('cy', -15).attr('r', 4);
        g.append('path').attr('class', 'pin-lock').attr('d', 'M-3,-17 v-2 a3,3 0 0 1 6,0 v2').attr('fill', 'none');
        g.on('click', function (event, d) {
          event.stopPropagation();
          handlers.onPinClick?.(d);
        });
        return g;
      },
      (update) => update,
      (exit) => exit.remove(),
    )
    .classed('is-locked', (d) => d.locked)
    .classed('is-active', (d) => d.id === activeId)
    .each(function (d) {
      select(this).select('.pin-lock').style('display', d.locked ? null : 'none');
    });
  repositionOverlay();
}

// Drop a transient placement preview pin and animate it in.
export function flashPlacement(sx, sy) {
  const g = pinsG.append('g').attr('class', 'pin pin--ghost').attr('transform', `translate(${sx} ${sy})`);
  g.append('circle').attr('class', 'pin-halo').attr('r', 16);
  g.append('path').attr('class', 'pin-body').attr('d', 'M0,0 C-9,-12 -9,-22 0,-22 C9,-22 9,-12 0,0 Z').attr('transform', 'translate(0,-2)');
  gsap.fromTo(g.node(), { scale: 0, transformOrigin: '50% 100%' }, { scale: 1, duration: 0.4, ease: 'back.out(2)' });
  return () => g.remove();
}

// ---------------------------------------------------------------------------
// Overlay positioning (runs each animation frame during transitions)
// ---------------------------------------------------------------------------
function repositionOverlay() {
  stationsG.selectAll('g.station').attr('transform', (d) => {
    const [x, y] = geoToScreen(d.lon, d.lat);
    return `translate(${x} ${y})`;
  });
  pinsG.selectAll('g.pin:not(.pin--ghost)').attr('transform', (d) => {
    const [x, y] = geoToScreen(d.lon, d.lat);
    return `translate(${x} ${y})`;
  });
}

export { geoToScreen };
