import { select } from 'd3-selection';
import { gsap } from 'gsap';
import { W, H, path, project, unproject, largestPart, IDENTITY } from './geo.js';

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
// The viewBox aspect matches the viewport (see geo.setViewport) so "meet" fills
// the screen exactly — no cropping, no letterbox.
export function applyViewport() {
  svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');
  svg.select('#vp-rect').attr('width', W + 80).attr('height', H + 80);
  reposition();
}

export function initMap(svgEl, h) {
  handlers = h;
  svg = select(svgEl).attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');

  buildDefs();

  ambientG = svg.append('g').attr('class', 'ambient');

  // Clip the zoomable content to the canvas so far-off geometry (e.g. Tokyo's
  // distant islands) isn't rasterised at huge transformed coordinates, which
  // flickers on mobile GPUs.
  zoomG = svg.append('g').attr('class', 'zoom').attr('clip-path', 'url(#vp-clip)');
  extrudeG = zoomG.append('g').attr('class', 'extrude');
  areaG = zoomG.append('g').attr('class', 'areas');

  overlay = svg.append('g').attr('class', 'overlay');
  labelsG = overlay.append('g').attr('class', 'labels');
  stationsG = overlay.append('g').attr('class', 'stations');
  stLabelsG = overlay.append('g').attr('class', 'station-labels');
  locG = overlay.append('g').attr('class', 'geoloc');
  pinsG = overlay.append('g').attr('class', 'pins');

  bindPointer(svgEl);
  applyViewport();
}

function buildDefs() {
  const defs = svg.append('defs');
  // viewport clip rect (sized in applyViewport)
  defs.append('clipPath').attr('id', 'vp-clip').append('rect').attr('id', 'vp-rect').attr('x', -40).attr('y', -40).attr('width', W + 80).attr('height', H + 80);

  const glow = defs.append('filter').attr('id', 'st-glow').attr('x', '-150%').attr('y', '-150%').attr('width', '400%').attr('height', '400%');
  glow.append('feGaussianBlur').attr('stdDeviation', 3.4).attr('result', 'b');
  const m = glow.append('feMerge');
  m.append('feMergeNode').attr('in', 'b');
  m.append('feMergeNode').attr('in', 'SourceGraphic');

  const grad = defs.append('linearGradient').attr('id', 'tileGrad').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 1);
  grad.append('stop').attr('offset', '0%').attr('stop-color', '#dccdc1');
  grad.append('stop').attr('offset', '100%').attr('stop-color', '#cdbcb0');
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
  return Math.min(r.width / W, r.height / H);
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
  renderedAreas = areas.map((a) => ({ ...a, centroid: p.centroid(a.feature), bounds: p.bounds(a.feature) }));
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
  // Use only the largest landmass so far islands don't add huge off-screen
  // coordinates; draw a few solid, opaque offset copies (no 16-layer stack, no
  // opacity fade) so there is no banding/flicker on high-DPR mobile screens.
  const d = path()(largestPart(feat));
  if (!d) return;
  const depth = DEPTH_PX / transform.k;
  const dx = depth * 0.4;
  const N = 3;
  const g = extrudeG.append('g');
  for (let i = N; i >= 1; i--) {
    const t = (i / N) * depth;
    g.append('path').attr('d', d).attr('class', 'extrude-wall').attr('transform', `translate(${(dx * i) / N} ${t})`);
  }
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
  placeAreaLabels();

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

// Area labels: bigger segments win; hide a label if its segment is too small
// on-screen to fit text, or if it would overlap an already-placed label. This
// keeps dense wards (e.g. 京都市左京区) from being covered in text — more labels
// reveal themselves as you zoom in.
function placeAreaLabels() {
  const sel = labelsG.selectAll('text.area-label');
  if (sel.empty()) return;
  const items = [];
  sel.each(function (d) {
    const sw = (d.bounds[1][0] - d.bounds[0][0]) * transform.k;
    const sh = (d.bounds[1][1] - d.bounds[0][1]) * transform.k;
    const [x, y] = canvasToScreen(d.centroid[0], d.centroid[1]);
    items.push({ node: this, d, x, y, area: sw * sh, segMin: Math.min(sw, sh) });
  });
  items.sort((a, b) => b.area - a.area); // label large segments first
  const placed = [];
  const overlaps = (r) => placed.some((q) => !(r.x1 < q.x0 || r.x0 > q.x1 || r.y1 < q.y0 || r.y0 > q.y1));
  for (const it of items) {
    const label = it.d.label || '';
    const w = label.length * 13 + 6;
    const h = 16;
    const show = it.segMin > 30 && it.x > -50 && it.x < W + 50 && it.y > -20 && it.y < H + 20;
    const rect = { x0: it.x - w / 2, y0: it.y - h / 2, x1: it.x + w / 2, y1: it.y + h / 2 };
    if (show && !overlaps(rect)) {
      placed.push(rect);
      select(it.node).style('display', null).attr('transform', `translate(${it.x} ${it.y})`);
    } else {
      select(it.node).style('display', 'none');
    }
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

function zoomAround(clientX, clientY, k) {
  k = Math.max(limits.min, Math.min(limits.max, k));
  const [vx, vy] = clientToCanvas(clientX, clientY);
  const ratio = k / transform.k;
  transform.x = vx - (vx - transform.x) * ratio;
  transform.y = vy - (vy - transform.y) * ratio;
  transform.k = k;
}

function bindPointer(el) {
  const pointers = new Map(); // pointerId -> {x,y}
  let down = null; // single-pointer gesture bookkeeping (tap / long-press / pan)
  let pinch = null; // { dist, mx, my }
  let lpTimer = null;
  const clearLP = () => {
    if (lpTimer) {
      clearTimeout(lpTimer);
      lpTimer = null;
    }
  };
  const two = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    el.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gsap.killTweensOf(transform);

    if (pointers.size === 1) {
      down = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false, fired: false };
      if (pinningEnabled) {
        lpTimer = setTimeout(() => {
          if (down && !down.moved && pointers.size === 1) {
            down.fired = true;
            handlers.onLongPress?.(screenToGeo(down.x, down.y), { clientX: down.x, clientY: down.y });
          }
        }, LONGPRESS_MS);
      }
    } else if (pointers.size === 2) {
      clearLP();
      if (down) down.fired = true; // cancel tap/long-press once a second finger lands
      pinch = two();
      svg.node().classList.add('grabbing');
    }
  });

  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2 && pinch) {
      const cur = two();
      const scale = viewScale();
      transform.x += (cur.mx - pinch.mx) / scale; // two-finger drag
      transform.y += (cur.my - pinch.my) / scale;
      if (pinch.dist > 0) zoomAround(cur.mx, cur.my, transform.k * (cur.dist / pinch.dist));
      clampPan();
      applyTransform();
      pinch = cur;
      return;
    }

    if (!down) return;
    const dx = e.clientX - down.x; // per-move delta for panning
    const dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(e.clientX - down.sx, e.clientY - down.sy) > MOVE_THRESH) {
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
    }
    down.x = e.clientX;
    down.y = e.clientY;
  });

  const removePointer = (e) => {
    const had = pointers.delete(e.pointerId);
    if (!had) return;
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) {
      // dropped from pinch to a single finger — continue panning from it
      const [p] = [...pointers.values()];
      down = { x: p.x, y: p.y, t: performance.now(), moved: true, fired: true };
      svg.node().classList.add('grabbing');
    } else if (pointers.size === 0) {
      svg.node().classList.remove('grabbing');
    }
  };

  el.addEventListener('pointerup', (e) => {
    const wasDown = down;
    const wasSize = pointers.size;
    removePointer(e);
    clearLP();
    if (wasSize === 1 && wasDown && !wasDown.moved && !wasDown.fired && performance.now() - wasDown.t < 400) {
      const tgt = document.elementFromPoint(e.clientX, e.clientY);
      const areaEl = tgt?.closest?.('.area');
      if (areaEl) {
        const d = select(areaEl).datum();
        if (d) handlers.onAreaTap?.(d.id);
      }
    }
    if (pointers.size === 0) down = null;
  });
  el.addEventListener('pointercancel', (e) => {
    removePointer(e);
    clearLP();
    if (pointers.size === 0) {
      down = null;
      svg.node().classList.remove('grabbing');
    }
  });

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      gsap.killTweensOf(transform);
      zoomAround(e.clientX, e.clientY, transform.k * Math.exp(-e.deltaY * 0.0015));
      clampPan();
      applyTransform();
    },
    { passive: false },
  );
}
