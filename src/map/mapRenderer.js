import { select } from 'd3-selection';
import { gsap } from 'gsap';
import { W, H, path, project, unproject, IDENTITY } from './geo.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let svg, zoomG, extrudeG, areaG, overlay, labelsG, stationsG, pinsG;
let handlers = {};
let transform = { ...IDENTITY };
let limits = { min: 0.8, max: 2200 };
let pinningEnabled = false;
let renderedStations = [];
let renderedPins = [];
let renderedAreas = [];

const DEPTH_PX = 22;
const DEPTH_STEPS = 16;
const LONGPRESS_MS = 420;
const MOVE_THRESH = 7;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
export function initMap(svgEl, h) {
  handlers = h;
  svg = select(svgEl)
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet'); // show the whole map, no crop

  buildDefs();

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
  areaG = zoomG.append('g').attr('class', 'areas');

  overlay = svg.append('g').attr('class', 'overlay');
  labelsG = overlay.append('g').attr('class', 'labels');
  stationsG = overlay.append('g').attr('class', 'stations');
  pinsG = overlay.append('g').attr('class', 'pins');

  bindPointer(svgEl);
}

function buildDefs() {
  const defs = svg.append('defs');
  const glow = defs
    .append('filter')
    .attr('id', 'st-glow')
    .attr('x', '-150%')
    .attr('y', '-150%')
    .attr('width', '400%')
    .attr('height', '400%');
  glow.append('feGaussianBlur').attr('stdDeviation', 3.2).attr('result', 'b');
  const m = glow.append('feMerge');
  m.append('feMergeNode').attr('in', 'b');
  m.append('feMergeNode').attr('in', 'SourceGraphic');

  const grad = defs
    .append('linearGradient')
    .attr('id', 'tileGrad')
    .attr('x1', 0)
    .attr('y1', 0)
    .attr('x2', 0)
    .attr('y2', 1);
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#E4D7CC');
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#CBB9AC');
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------
function geoToScreen(lon, lat) {
  const p = project([lon, lat]);
  return [p[0] * transform.k + transform.x, p[1] * transform.k + transform.y];
}
function canvasToScreen(cx, cy) {
  return [cx * transform.k + transform.x, cy * transform.k + transform.y];
}
function clientToCanvas(clientX, clientY) {
  const r = svg.node().getBoundingClientRect();
  const scale = Math.min(r.width / W, r.height / H); // meet
  const offX = (r.width - W * scale) / 2;
  const offY = (r.height - H * scale) / 2;
  const vx = (clientX - r.left - offX) / scale;
  const vy = (clientY - r.top - offY) / scale;
  return [vx, vy];
}
export function screenToGeo(clientX, clientY) {
  const [vx, vy] = clientToCanvas(clientX, clientY);
  return unproject([(vx - transform.x) / transform.k, (vy - transform.y) / transform.k]);
}

// ---------------------------------------------------------------------------
// Transform application + transitions
// ---------------------------------------------------------------------------
function applyTransform() {
  zoomG.attr('transform', `translate(${transform.x} ${transform.y}) scale(${transform.k})`);
  // keep stroke crisp regardless of zoom
  areaG.attr('stroke-width', 1.1 / transform.k);
  reposition();
}

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

export const getTransform = () => ({ ...transform });
export function setZoomLimits(min, max) {
  limits = { min, max };
}
export function setPinning(on) {
  pinningEnabled = on;
}

// ---------------------------------------------------------------------------
// Areas (clickable tiles) + extruded base platform
// ---------------------------------------------------------------------------
/**
 * @param {Array} areas  [{ id, feature, label, kind }]
 * @param {object} opts  { baseFeature, showLabels }
 */
export function renderAreas(areas, { baseFeature = null, showLabels = false } = {}) {
  const p = path();
  renderedAreas = areas.map((a) => ({ ...a, centroid: p.centroid(a.feature) }));

  // extruded plinth under everything
  drawExtrude(baseFeature);

  areaG
    .selectAll('path.area')
    .data(renderedAreas, (d) => d.id)
    .join(
      (enter) =>
        enter
          .append('path')
          .attr('class', (d) => 'area' + (d.kind ? ' area--' + d.kind : ''))
          .attr('d', (d) => p(d.feature))
          .each(function () {
            gsap.fromTo(this, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' });
          }),
      (update) => update.attr('class', (d) => 'area' + (d.kind ? ' area--' + d.kind : '')).attr('d', (d) => p(d.feature)),
      (exit) => exit.remove(),
    );

  // labels
  const labelData = showLabels ? renderedAreas : [];
  labelsG
    .selectAll('text.area-label')
    .data(labelData, (d) => d.id)
    .join(
      (enter) =>
        enter
          .append('text')
          .attr('class', 'area-label')
          .text((d) => d.label)
          .each(function () {
            gsap.fromTo(this, { opacity: 0 }, { opacity: 1, duration: 0.8, delay: 0.3 });
          }),
      (update) => update.text((d) => d.label),
      (exit) => exit.remove(),
    );

  applyTransform();
}

function drawExtrude(feat) {
  extrudeG.selectAll('*').remove();
  if (!feat) return;
  const d = path()(feat);
  if (!d) return;
  const stepDy = DEPTH_PX / transform.k / DEPTH_STEPS;
  const stepDx = stepDy * 0.4;
  const g = extrudeG.append('g');
  for (let i = DEPTH_STEPS; i >= 1; i--) {
    g.append('path')
      .attr('d', d)
      .attr('class', 'extrude-wall')
      .attr('transform', `translate(${stepDx * i} ${stepDy * i})`);
  }
  gsap.fromTo(extrudeG.node(), { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power2.out' });
}

// ---------------------------------------------------------------------------
// Stations (glowing white dots) + pins
// ---------------------------------------------------------------------------
export function renderStations(list) {
  renderedStations = list || [];
  stationsG
    .selectAll('g.station')
    .data(renderedStations, (d) => d.id)
    .join(
      (enter) => {
        const g = enter
          .append('g')
          .attr('class', 'station')
          .each(function () {
            gsap.fromTo(this, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out' });
          });
        g.append('circle').attr('class', 'station-glow').attr('r', 9);
        g.append('circle').attr('class', 'station-core').attr('r', 3.6);
        g.on('click', function (event, d) {
          event.stopPropagation();
          handlers.onStationClick?.(d, event);
        });
        g.on('pointerdown', (event) => event.stopPropagation());
        return g;
      },
      (update) => update,
      (exit) => exit.remove(),
    );
  reposition();
}

export function renderPins(list, { privateMode, activeId } = {}) {
  renderedPins = (list || []).filter((p) => privateMode || !p.locked);
  pinsG
    .selectAll('g.pin')
    .data(renderedPins, (d) => d.id)
    .join(
      (enter) => {
        const g = enter.append('g').attr('class', 'pin');
        g.append('circle').attr('class', 'pin-halo').attr('r', 15);
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
        g.on('pointerdown', (event) => event.stopPropagation());
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
  reposition();
}

export function flashPlacement(clientX, clientY) {
  const [vx, vy] = clientToCanvas(clientX, clientY);
  const g = pinsG.append('g').attr('class', 'pin pin--ghost').attr('transform', `translate(${vx} ${vy})`);
  g.append('circle').attr('class', 'pin-halo').attr('r', 15);
  g.append('path').attr('class', 'pin-body').attr('d', 'M0,0 C-9,-12 -9,-22 0,-22 C9,-22 9,-12 0,0 Z').attr('transform', 'translate(0,-2)');
  gsap.fromTo(g.node(), { scale: 0, transformOrigin: '50% 100%' }, { scale: 1, duration: 0.4, ease: 'back.out(2)' });
  return () => g.remove();
}

// ---------------------------------------------------------------------------
// Per-frame overlay positioning
// ---------------------------------------------------------------------------
function reposition() {
  labelsG.selectAll('text.area-label').attr('transform', (d) => {
    const [x, y] = canvasToScreen(d.centroid[0], d.centroid[1]);
    return `translate(${x} ${y})`;
  });
  stationsG.selectAll('g.station').attr('transform', (d) => {
    const [x, y] = geoToScreen(d.lon, d.lat);
    return `translate(${x} ${y})`;
  });
  pinsG.selectAll('g.pin:not(.pin--ghost)').attr('transform', (d) => {
    const [x, y] = geoToScreen(d.lon, d.lat);
    return `translate(${x} ${y})`;
  });
}

// ---------------------------------------------------------------------------
// Pointer interaction: drag-pan, wheel-zoom, tap-navigate, long-press-pin
// ---------------------------------------------------------------------------
function clampPan() {
  // Keep at least a quarter of the viewport covered by content so the map
  // can never be dragged completely off-screen. Generous bounds so it never
  // fights the computed frames.
  const k = transform.k;
  transform.x = Math.max(Math.min(transform.x, 0.75 * W), 0.25 * W - W * k);
  transform.y = Math.max(Math.min(transform.y, 0.75 * H), 0.25 * H - H * k);
}

function bindPointer(el) {
  let down = null; // {x,y,t,moved}
  let lpTimer = null;

  const clearLP = () => {
    if (lpTimer) {
      clearTimeout(lpTimer);
      lpTimer = null;
    }
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    gsap.killTweensOf(transform);
    down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, fired: false };
    el.setPointerCapture?.(e.pointerId);
    if (pinningEnabled) {
      lpTimer = setTimeout(() => {
        if (down && !down.moved) {
          down.fired = true;
          handlers.onLongPress?.(screenToGeo(down.x, down.y), { clientX: down.x, clientY: down.y });
        }
      }, LONGPRESS_MS);
    }
  });

  el.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) > MOVE_THRESH) {
      down.moved = true;
      clearLP();
      svg.node().classList.add('grabbing');
    }
    if (down.moved && !down.fired) {
      const scale = (() => {
        const r = svg.node().getBoundingClientRect();
        return Math.min(r.width / W, r.height / H);
      })();
      transform.x += dx / scale;
      transform.y += dy / scale;
      clampPan();
      applyTransform();
      down.x = e.clientX;
      down.y = e.clientY;
    }
  });

  const end = (e) => {
    clearLP();
    svg.node().classList.remove('grabbing');
    if (!down) return;
    const isTap = !down.moved && !down.fired && performance.now() - down.t < 400;
    if (isTap) {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const areaEl = target?.closest?.('.area');
      if (areaEl) {
        const d = select(areaEl).datum();
        if (d) handlers.onAreaTap?.(d.id);
      }
    }
    down = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => {
    clearLP();
    down = null;
    svg.node().classList.remove('grabbing');
  });

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      gsap.killTweensOf(transform);
      const [vx, vy] = clientToCanvas(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0015);
      let k = transform.k * factor;
      k = Math.max(limits.min, Math.min(limits.max, k));
      const ratio = k / transform.k;
      transform.x = vx - (vx - transform.x) * ratio;
      transform.y = vy - (vy - transform.y) * ratio;
      transform.k = k;
      clampPan();
      applyTransform();
    },
    { passive: false },
  );
}
