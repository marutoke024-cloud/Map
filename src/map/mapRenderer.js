import { select } from 'd3-selection';
import { gsap } from 'gsap';
import { W, H, path, project, unproject, IDENTITY } from './geo.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let svg, zoomG, extrudeG, areaG, overlay, labelsG, stationsG, stLabelsG, pinsG, locG, ambientG;
let handlers = {};
let transform = { ...IDENTITY };
let limits = { min: 0.8, max: 2200 };
let pinningEnabled = false;
let renderedStations = [];
let renderedPins = [];
let renderedAreas = [];
let baseFeat = null;
let currentLoc = null; // {lon,lat}
let ambientRAF = null;
let ambientParticles = [];

const DEPTH_PX = 22;
const DEPTH_STEPS = 16;
const LONGPRESS_MS = 420;
const MOVE_THRESH = 7;
const ST_CORE_R = 5.5; // bigger station dot
const ST_GLOW_R = 13;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
let aspectMode = 'meet'; // 'meet' (letterbox) on wide screens, 'slice' (fill) on tall/mobile

function updateAspect() {
  const r = svg.node().getBoundingClientRect();
  // Fill the screen on portrait / narrow viewports so the map isn't tiny;
  // letterbox on wide screens so all of Japan stays visible.
  aspectMode = r.width / r.height < 1.35 ? 'slice' : 'meet';
  svg.attr('preserveAspectRatio', `xMidYMid ${aspectMode}`);
  reposition();
}

export function initMap(svgEl, h) {
  handlers = h;
  svg = select(svgEl).attr('viewBox', `0 0 ${W} ${H}`);

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

  ambientG = svg.append('g').attr('class', 'ambient');

  zoomG = svg.append('g').attr('class', 'zoom');
  extrudeG = zoomG.append('g').attr('class', 'extrude');
  areaG = zoomG.append('g').attr('class', 'areas');

  overlay = svg.append('g').attr('class', 'overlay');
  labelsG = overlay.append('g').attr('class', 'labels');
  stationsG = overlay.append('g').attr('class', 'stations');
  stLabelsG = overlay.append('g').attr('class', 'station-labels');
  locG = overlay.append('g').attr('class', 'geoloc');
  pinsG = overlay.append('g').attr('class', 'pins');

  bindPointer(svgEl);
  updateAspect();
  window.addEventListener('resize', updateAspect);
}

function buildDefs() {
  const defs = svg.append('defs');
  const glow = defs.append('filter').attr('id', 'st-glow').attr('x', '-150%').attr('y', '-150%').attr('width', '400%').attr('height', '400%');
  glow.append('feGaussianBlur').attr('stdDeviation', 3.4).attr('result', 'b');
  const m = glow.append('feMerge');
  m.append('feMergeNode').attr('in', 'b');
  m.append('feMergeNode').attr('in', 'SourceGraphic');

  const grad = defs.append('linearGradient').attr('id', 'tileGrad').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
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
function viewScale() {
  const r = svg.node().getBoundingClientRect();
  return aspectMode === 'slice' ? Math.max(r.width / W, r.height / H) : Math.min(r.width / W, r.height / H);
}
function clientToCanvas(clientX, clientY) {
  const r = svg.node().getBoundingClientRect();
  const scale = viewScale();
  const offX = (r.width - W * scale) / 2;
  const offY = (r.height - H * scale) / 2;
  return [(clientX - r.left - offX) / scale, (clientY - r.top - offY) / scale];
}
export function screenToGeo(clientX, clientY) {
  const [vx, vy] = clientToCanvas(clientX, clientY);
  return unproject([(vx - transform.x) / transform.k, (vy - transform.y) / transform.k]);
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------
function applyTransform() {
  zoomG.attr('transform', `translate(${transform.x} ${transform.y}) scale(${transform.k})`);
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
      settlePlinth(); // draw the plinth only once the camera has settled
      onComplete?.();
    },
  });
}
export const getTransform = () => ({ ...transform });
export const setZoomLimits = (min, max) => (limits = { min, max });
export const setPinning = (on) => (pinningEnabled = on);

// ---------------------------------------------------------------------------
// Areas + extrusion
// ---------------------------------------------------------------------------
export function renderAreas(areas, { baseFeature = null, showLabels = false } = {}) {
  const p = path();
  renderedAreas = areas.map((a) => ({ ...a, centroid: p.centroid(a.feature) }));
  baseFeat = baseFeature;
  extrudeG.selectAll('*').remove(); // plinth is drawn after the camera settles

  areaG
    .selectAll('path.area')
    .data(renderedAreas, (d) => d.id)
    .join(
      (enter) =>
        enter
          .append('path')
          .attr('class', (d) => 'area' + (d.kind ? ' area--' + d.kind : ''))
          .attr('d', (d) => p(d.feature)),
      (update) => update.attr('class', (d) => 'area' + (d.kind ? ' area--' + d.kind : '')).attr('d', (d) => p(d.feature)),
      (exit) => exit.remove(),
    );

  labelsG
    .selectAll('text.area-label')
    .data(showLabels ? renderedAreas : [], (d) => d.id)
    .join(
      (enter) => enter.append('text').attr('class', 'area-label').text((d) => d.label),
      (update) => update.text((d) => d.label),
      (exit) => exit.remove(),
    );
  applyTransform();
}

// Draw the extruded plinth for the current base feature. Called once the
// fly-to settles (drawing it during the zoom caused shimmering on zoom-out).
export function settlePlinth() {
  drawExtrude(baseFeat);
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
    g.append('path').attr('d', d).attr('class', 'extrude-wall').attr('transform', `translate(${stepDx * i} ${stepDy * i})`);
  }
  gsap.fromTo(extrudeG.node(), { opacity: 0 }, { opacity: 1, duration: 0.45, ease: 'power2.out' });
}

// ---------------------------------------------------------------------------
// Stations (bigger glowing dots + name/line labels with collision avoidance)
// ---------------------------------------------------------------------------
export function renderStations(list) {
  renderedStations = list || [];
  stationsG
    .selectAll('g.station')
    .data(renderedStations, (d) => d.id)
    .join(
      (enter) => {
        const g = enter.append('g').attr('class', 'station').each(function () {
          gsap.fromTo(this, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out' });
        });
        g.append('circle').attr('class', 'station-glow').attr('r', ST_GLOW_R);
        g.append('circle').attr('class', 'station-core').attr('r', ST_CORE_R);
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

  // label per station: name + primary line
  stLabelsG
    .selectAll('g.st-label')
    .data(renderedStations, (d) => d.id)
    .join(
      (enter) => {
        const g = enter.append('g').attr('class', 'st-label');
        g.append('text').attr('class', 'st-name').text((d) => d.name + '駅');
        g.append('text').attr('class', 'st-line').attr('y', 13).text((d) => (d.lines && d.lines.length ? d.lines[0] : ''));
        return g;
      },
      (update) => {
        update.select('.st-name').text((d) => d.name + '駅');
        update.select('.st-line').text((d) => (d.lines && d.lines.length ? d.lines[0] : ''));
        return update;
      },
      (exit) => exit.remove(),
    );
  reposition();
}

// ---------------------------------------------------------------------------
// Pins (1.5x, orange-red)
// ---------------------------------------------------------------------------
export function renderPins(list, { privateMode, activeId } = {}) {
  renderedPins = (list || []).filter((p) => privateMode || !p.locked);
  pinsG
    .selectAll('g.pin')
    .data(renderedPins, (d) => d.id)
    .join(
      (enter) => {
        const g = enter.append('g').attr('class', 'pin');
        g.append('circle').attr('class', 'pin-halo').attr('r', 22);
        const s = g.append('g').attr('class', 'pin-scale'); // 1.5x marker
        s.append('path')
          .attr('class', 'pin-body')
          .attr('d', 'M0,0 C-9,-12 -9,-22 0,-22 C9,-22 9,-12 0,0 Z')
          .attr('transform', 'translate(0,-2)');
        s.append('circle').attr('class', 'pin-dot').attr('cy', -15).attr('r', 4);
        s.append('path').attr('class', 'pin-lock').attr('d', 'M-3,-17 v-2 a3,3 0 0 1 6,0 v2').attr('fill', 'none');
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
  g.append('circle').attr('class', 'pin-halo').attr('r', 22);
  const s = g.append('g').attr('class', 'pin-scale');
  s.append('path').attr('class', 'pin-body').attr('d', 'M0,0 C-9,-12 -9,-22 0,-22 C9,-22 9,-12 0,0 Z').attr('transform', 'translate(0,-2)');
  gsap.fromTo(g.node(), { scale: 0, transformOrigin: '50% 100%' }, { scale: 1, duration: 0.4, ease: 'back.out(2)' });
  return () => g.remove();
}

// ---------------------------------------------------------------------------
// Current location
// ---------------------------------------------------------------------------
export function setCurrentLocation(lonlat) {
  currentLoc = lonlat ? { lon: lonlat[0], lat: lonlat[1] } : null;
  locG.selectAll('*').remove();
  if (currentLoc) {
    locG.append('circle').attr('class', 'loc-pulse').attr('r', 10);
    locG.append('circle').attr('class', 'loc-dot').attr('r', 6);
  }
  reposition();
}

// ---------------------------------------------------------------------------
// Per-frame overlay positioning + label collision
// ---------------------------------------------------------------------------
function reposition() {
  labelsG.selectAll('text.area-label').attr('transform', (d) => {
    const [x, y] = canvasToScreen(d.centroid[0], d.centroid[1]);
    return `translate(${x} ${y})`;
  });

  const stPos = new Map();
  stationsG.selectAll('g.station').attr('transform', (d) => {
    const [x, y] = geoToScreen(d.lon, d.lat);
    stPos.set(d.id, [x, y]);
    return `translate(${x} ${y})`;
  });
  placeStationLabels(stPos);

  pinsG.selectAll('g.pin:not(.pin--ghost)').attr('transform', (d) => {
    const [x, y] = geoToScreen(d.lon, d.lat);
    return `translate(${x} ${y})`;
  });

  if (currentLoc) {
    const [x, y] = geoToScreen(currentLoc.lon, currentLoc.lat);
    locG.attr('transform', `translate(${x} ${y})`);
  }
}

// Greedy label placement: place name+line to the right of each dot; if it
// would overlap an already-placed label, try other sides, else hide the label.
function placeStationLabels(stPos) {
  const placed = [];
  const overlaps = (r) =>
    placed.some((q) => !(r.x1 < q.x0 || r.x0 > q.x1 || r.y1 < q.y0 || r.y0 > q.y1));
  const offsets = [
    [ST_CORE_R + 6, 0, 'start'],
    [-(ST_CORE_R + 6), 0, 'end'],
    [0, -22, 'middle'],
    [0, 26, 'middle'],
  ];
  stLabelsG.selectAll('g.st-label').each(function (d) {
    const g = select(this);
    const pos = stPos.get(d.id);
    if (!pos) {
      g.style('display', 'none');
      return;
    }
    const nameLen = (d.name.length + 1) * 12.5;
    const lineLen = (d.lines && d.lines[0] ? d.lines[0].length : 0) * 9.5;
    const wpx = Math.max(nameLen, lineLen) + 6;
    const hpx = d.lines && d.lines.length ? 30 : 18;
    let chosen = null;
    for (const [dx, dy, anchor] of offsets) {
      const ax = pos[0] + dx;
      const ay = pos[1] + dy;
      const x0 = anchor === 'end' ? ax - wpx : anchor === 'middle' ? ax - wpx / 2 : ax;
      const rect = { x0, y0: ay - 10, x1: x0 + wpx, y1: ay - 10 + hpx };
      if (!overlaps(rect)) {
        chosen = { ax, ay, anchor, rect };
        break;
      }
    }
    if (!chosen) {
      g.style('display', 'none');
      return;
    }
    placed.push(chosen.rect);
    g.style('display', null)
      .attr('transform', `translate(${chosen.ax} ${chosen.ay})`)
      .attr('text-anchor', chosen.anchor);
  });
}

// ---------------------------------------------------------------------------
// Ambient background animation (Japan view)
// ---------------------------------------------------------------------------
export function startAmbient() {
  if (ambientRAF) return;
  ambientParticles = Array.from({ length: 46 }, () => spawnParticle(true));
  const nodes = ambientG
    .selectAll('circle.particle')
    .data(ambientParticles)
    .join('circle')
    .attr('class', 'particle')
    .attr('r', (d) => d.r);
  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(48, now - last);
    last = now;
    for (const p of ambientParticles) {
      p.y -= p.v * dt * 0.02;
      p.tw += dt * 0.003;
      if (p.y < -20) Object.assign(p, spawnParticle(false));
    }
    nodes
      .attr('cx', (d) => d.x)
      .attr('cy', (d) => d.y)
      .attr('opacity', (d) => d.o * (0.55 + 0.45 * Math.sin(d.tw)));
    ambientRAF = requestAnimationFrame(tick);
  };
  ambientRAF = requestAnimationFrame(tick);
  gsap.to(ambientG.node(), { opacity: 1, duration: 1.2 });
}
export function stopAmbient() {
  if (ambientRAF) {
    cancelAnimationFrame(ambientRAF);
    ambientRAF = null;
  }
  gsap.to(ambientG.node(), {
    opacity: 0,
    duration: 0.6,
    onComplete: () => ambientG.selectAll('*').remove(),
  });
}
function spawnParticle(anywhere) {
  return {
    x: Math.random() * W,
    y: anywhere ? Math.random() * H : H + Math.random() * 40,
    r: 0.6 + Math.random() * 1.8,
    v: 0.4 + Math.random() * 1.1,
    o: 0.15 + Math.random() * 0.45,
    tw: Math.random() * 6.28,
  };
}

// ---------------------------------------------------------------------------
// Pointer interaction
// ---------------------------------------------------------------------------
function clampPan() {
  const k = transform.k;
  transform.x = Math.max(Math.min(transform.x, 0.75 * W), 0.25 * W - W * k);
  transform.y = Math.max(Math.min(transform.y, 0.75 * H), 0.25 * H - H * k);
}

function bindPointer(el) {
  let down = null;
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
      const scale = viewScale();
      transform.x += dx / scale;
      transform.y += dy / scale;
      clampPan();
      applyTransform();
      down.x = e.clientX;
      down.y = e.clientY;
    }
  });

  const endEv = (e) => {
    clearLP();
    svg.node().classList.remove('grabbing');
    if (!down) return;
    const isTap = !down.moved && !down.fired && performance.now() - down.t < 400;
    if (isTap) {
      const tgt = document.elementFromPoint(e.clientX, e.clientY);
      const areaEl = tgt?.closest?.('.area');
      if (areaEl) {
        const d = select(areaEl).datum();
        if (d) handlers.onAreaTap?.(d.id);
      }
    }
    down = null;
  };
  el.addEventListener('pointerup', endEv);
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
      let k = transform.k * Math.exp(-e.deltaY * 0.0015);
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
