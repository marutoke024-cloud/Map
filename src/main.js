import './style.css';
import { gsap } from 'gsap';
import { geoContains } from 'd3-geo';
import {
  loadGeo,
  loadMunicipality,
  getMunicipality,
  loadTown,
  featureById,
  allFeatures,
  frameFeatures,
  geoBBox,
} from './map/geo.js';
import {
  initMap,
  flyTo,
  setZoomLimits,
  setPinning,
  renderAreas,
  renderStations,
  renderPins,
  flashPlacement,
  setCurrentLocation,
  startAmbient,
  stopAmbient,
} from './map/mapRenderer.js';
import { state, setState } from './state.js';
import { REGIONS, PREFECTURES, PREF_KEY_BY_ID, PREF_ID_TO_REGION } from './config.js';
import { loadPins } from './pins/pinStore.js';
import { loadStations } from './stations/stations.js';
import { initPanel, openPanel, closePanel } from './pins/pinPanel.js';
import { initSettings, openSettings } from './ui/settings.js';
import { initSearch } from './ui/search.js';
import { createLoader, preload } from './ui/loader.js';
import {
  setBreadcrumb,
  showStageTitle,
  setHint,
  setScaleLabel,
  setBackVisible,
  renderDrawer,
  closeDrawer,
} from './ui/hud.js';
import { hasFirebase } from './firebase.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  const loader = createLoader();

  // Real 0→100% progress: map outline, every prefecture's municipalities, fonts.
  const tasks = [
    { label: 'loading map', run: loadGeo },
    ...Object.keys(PREFECTURES).map((k) => ({
      label: `loading ${PREFECTURES[k].en}`,
      run: () => loadMunicipality(k),
    })),
    { label: 'fonts', run: () => (document.fonts ? document.fonts.ready : Promise.resolve()) },
  ];
  await preload(loader, tasks);

  initMap($('stage'), {
    onAreaTap: handleAreaTap,
    onLongPress: handleLongPress,
    onPinClick: handlePinClick,
  });
  initPanel($('panel'), {
    onSaved: handlePinSaved,
    onDeleted: handlePinDeleted,
    onClose: () => setState({ activePinId: null }),
  });
  initSettings($('settings'));

  state.pins = await loadPins();
  wireControls();

  goJapan(false); // build the Japan view beneath the loader
  const introP = introSequence(); // begin the cinematic fly-in
  await loader.finish(); // curtain reveal
  await introP;
})();

function introSequence() {
  flyTo({ k: 2.4, x: -1500, y: -1100 }, { duration: 0 });
  return new Promise((r) => flyTo(frameFeatures(mainland(), 0.04), { duration: 2.0, onComplete: r }));
}

function mainland() {
  return allFeatures().filter((f) => f.properties.id !== 47);
}

// ---------------------------------------------------------------------------
// Level navigation
// ---------------------------------------------------------------------------
function applyLimits(frame, { minMul = 0.75, maxMul = 6 } = {}) {
  setZoomLimits(frame.k * minMul, frame.k * maxMul);
}

function goJapan(animate = true) {
  setState({ level: 'japan', regionKey: null, prefKey: null, cityKey: null, wardKey: null });
  setPinning(false);
  renderStations([]);
  startAmbient();
  const areas = mainland().map((f) => ({
    id: f.properties.id,
    feature: f,
    kind: PREF_ID_TO_REGION[f.properties.id] ? 'playable' : 'dim',
  }));
  renderAreas(areas, { baseFeature: null, showLabels: false });
  const frame = frameFeatures(mainland(), 0.04);
  applyLimits(frame, { minMul: 0.9, maxMul: 3 });
  flyTo(frame, { duration: animate ? 1.4 : 0.01 });
  setBackVisible(false);
  setScaleLabel('JAPAN');
  setHint('Tap a glowing region — 近畿 / 関東');
  crumbs();
  refreshPins();
}

function goRegion(regionKey, animate = true) {
  stopAmbient();
  const r = REGIONS[regionKey];
  setState({ level: 'region', regionKey, prefKey: null, cityKey: null, wardKey: null });
  setPinning(false);
  renderStations([]);
  const memberIds = new Set(r.members.map((k) => PREFECTURES[k].id));
  const areas = mainland().map((f) => ({
    id: f.properties.id,
    feature: f,
    kind: memberIds.has(f.properties.id) ? 'member' : 'dim',
  }));
  renderAreas(areas, { baseFeature: null, showLabels: false });
  const frame = frameFeatures(r.members.map((k) => featureById(PREFECTURES[k].id)), 0.3);
  applyLimits(frame);
  flyTo(frame, { duration: animate ? 1.5 : 0.01 });
  setBackVisible(true);
  setScaleLabel(r.en);
  showStageTitle(r.ja, r.en);
  setHint('Choose a prefecture');
  crumbs();
  refreshPins();
}

async function goPrefecture(prefKey, animate = true) {
  stopAmbient();
  const p = PREFECTURES[prefKey];
  const regionKey = PREF_ID_TO_REGION[p.id];
  setState({ level: 'prefecture', regionKey, prefKey, cityKey: null, wardKey: null });
  setPinning(false);
  renderStations([]);
  setHint('Loading municipalities…');

  const muni = await loadMunicipality(prefKey);
  if (state.prefKey !== prefKey) return;
  const areas = muni.cities.map((c) => ({
    id: 'city:' + c.key,
    feature: c.feature,
    label: c.ja,
    kind: 'tile',
  }));
  renderAreas(areas, { baseFeature: featureById(p.id), showLabels: true });
  const frame = frameFeatures([featureById(p.id)], 0.16);
  applyLimits(frame);
  flyTo(frame, { duration: animate ? 1.5 : 0.01 });
  setBackVisible(true);
  setScaleLabel(p.en);
  showStageTitle(p.ja, p.en);
  setHint('Tap a city / ward to zoom in');
  crumbs();
  refreshPins();
}

async function goCity(cityKey, animate = true) {
  const muni = getMunicipality(state.prefKey);
  const city = muni?.byCity.get(cityKey);
  if (!city) return;
  setState({ level: 'city', cityKey, wardKey: null });

  if (city.designated) {
    // show wards; stations appear one level deeper
    setPinning(false);
    renderStations([]);
    const areas = city.wardUnits.map((w) => ({
      id: 'ward:' + w.key,
      feature: w.feature,
      label: w.ja,
      kind: 'tile',
    }));
    renderAreas(areas, { baseFeature: city.feature, showLabels: true });
    const frame = frameFeatures([city.feature], 0.18);
    applyLimits(frame);
    flyTo(frame, { duration: animate ? 1.5 : 0.01 });
    setHint('Tap a ward (区) to enter');
  } else {
    // leaf municipality: stations + pins here
    enterLeaf(city.feature, city.ja, `${state.prefKey}:${cityKey}`, animate, city.code);
  }
  setBackVisible(true);
  setScaleLabel(PREFECTURES[state.prefKey].en);
  showStageTitle(city.ja, PREFECTURES[state.prefKey].en);
  crumbs();
  refreshPins();
}

function goWard(wardKey, animate = true) {
  const muni = getMunicipality(state.prefKey);
  const city = muni?.byCity.get(state.cityKey);
  const ward = city?.wardUnits?.find((w) => w.key === wardKey);
  if (!ward) return;
  setState({ level: 'ward', wardKey });
  enterLeaf(ward.feature, ward.ja, `${state.prefKey}:${state.cityKey}:${wardKey}`, animate, ward.code);
  setBackVisible(true);
  setScaleLabel(city.ja);
  showStageTitle(ward.ja, city.ja);
  crumbs();
  refreshPins();
}

// Shared leaf entry: extruded block subdivided into 町丁目 segments (when town
// data is bundled), stations, pin placement enabled.
async function enterLeaf(feat, label, stationId, animate, code) {
  state.leafFeature = feat;
  renderAreas([{ id: 'leaf', feature: feat, label, kind: 'leaf' }], {
    baseFeature: feat,
    showLabels: false,
  });
  const frame = frameFeatures([feat], 0.22);
  applyLimits(frame, { minMul: 0.6, maxMul: 8 });
  flyTo(frame, { duration: animate ? 1.6 : 0.01 });
  setPinning(true);
  setHint('Long-press the map to drop a spot · drag to pan');
  loadStationsFor(stationId, feat);

  // Lazy-load 町丁目 segments and overlay them once available.
  const segs = await loadTown(code);
  if (segs && segs.length && state.leafFeature === feat) {
    renderAreas(
      segs.map((s, i) => ({ id: 'town:' + i, feature: s.feature, label: s.name, kind: 'town' })),
      { baseFeature: feat, showLabels: true },
    );
  }
}

// Keep only stations whose point falls inside the selected area polygon, so
// neighbouring stations just outside the ward are not shown.
function clipStations(list, feat) {
  return list.filter((s) => geoContains(feat, [s.lon, s.lat]));
}

async function loadStationsFor(id, feat) {
  if (!state.showStations) {
    renderStations([]);
    return;
  }
  const cached = state.stations[id];
  if (cached) {
    renderStations(clipStations(cached, feat));
    return;
  }
  setHint('Loading stations from OpenStreetMap…');
  try {
    const list = await loadStations(id, geoBBox(feat));
    state.stations = { ...state.stations, [id]: list };
    if (state.showStations && state.leafFeature === feat) renderStations(clipStations(list, feat));
    setHint('Long-press the map to drop a spot · drag to pan');
  } catch (e) {
    console.warn('Overpass failed', e);
    setHint('Long-press the map to drop a spot (stations unavailable)');
  }
}

// ---------------------------------------------------------------------------
// Tap / long-press / clicks
// ---------------------------------------------------------------------------
function handleAreaTap(id) {
  switch (state.level) {
    case 'japan': {
      const region = PREF_ID_TO_REGION[id];
      if (region) goRegion(region);
      break;
    }
    case 'region': {
      if (PREF_ID_TO_REGION[id] === state.regionKey) goPrefecture(PREF_KEY_BY_ID[id]);
      break;
    }
    case 'prefecture':
      if (typeof id === 'string' && id.startsWith('city:')) goCity(id.slice(5));
      break;
    case 'city':
      if (typeof id === 'string' && id.startsWith('ward:')) goWard(id.slice(5));
      break;
    default:
      break;
  }
}

function handleLongPress(geo) {
  if (state.level !== 'ward' && state.level !== 'city') return;
  // only meaningful at leaf (city without wards, or ward)
  const muni = getMunicipality(state.prefKey);
  const city = muni?.byCity.get(state.cityKey);
  if (state.level === 'city' && city?.designated) return; // not a leaf
  const remove = flashPlacement(...lastClient);
  openPanel(
    {
      prefKey: state.prefKey,
      cityKey: state.cityKey,
      wardKey: state.wardKey,
      lon: geo[0],
      lat: geo[1],
    },
    true,
  );
  setTimeout(remove, 800);
}

// remember last pointer for ghost placement
let lastClient = [window.innerWidth / 2, window.innerHeight / 2];
window.addEventListener('pointerdown', (e) => (lastClient = [e.clientX, e.clientY]), true);

function handlePinClick(pin) {
  setState({ activePinId: pin.id });
  refreshPins();
  openPanel(pin, false);
}

// ---------------------------------------------------------------------------
// Data refresh
// ---------------------------------------------------------------------------
function refreshPins() {
  // Pins only appear once zoomed to a prefecture or deeper.
  const visible = state.level === 'japan' || state.level === 'region' ? [] : state.pins;
  renderPins(visible, { privateMode: state.privateMode, activeId: state.activePinId });
}

function handlePinSaved(pin, isNew) {
  if (isNew) state.pins = [...state.pins, pin];
  else state.pins = state.pins.map((p) => (p.id === pin.id ? pin : p));
  setState({ activePinId: null });
  refreshPins();
}

function handlePinDeleted(id) {
  state.pins = state.pins.filter((p) => p.id !== id);
  setState({ activePinId: null });
  refreshPins();
}

// ---------------------------------------------------------------------------
// Breadcrumb + back
// ---------------------------------------------------------------------------
function crumbs() {
  const c = [{ key: 'japan', label: 'JAPAN' }];
  if (state.regionKey) c.push({ key: 'region:' + state.regionKey, label: REGIONS[state.regionKey].en });
  if (state.prefKey) c.push({ key: 'pref:' + state.prefKey, label: PREFECTURES[state.prefKey].en });
  if (state.cityKey) {
    const city = getMunicipality(state.prefKey)?.byCity.get(state.cityKey);
    c.push({ key: 'city:' + state.cityKey, label: city?.ja || '' });
  }
  if (state.wardKey) c.push({ key: 'ward:' + state.wardKey, label: state.wardKey });
  setBreadcrumb(c, onCrumb);
}

function onCrumb(key) {
  if (key === 'japan') goJapan();
  else if (key.startsWith('region:')) goRegion(key.slice(7));
  else if (key.startsWith('pref:')) goPrefecture(key.slice(5));
  else if (key.startsWith('city:')) goCity(key.slice(5));
}

function goBack() {
  if (state.level === 'ward') goCity(state.cityKey);
  else if (state.level === 'city') goPrefecture(state.prefKey);
  else if (state.level === 'prefecture') goRegion(state.regionKey);
  else if (state.level === 'region') goJapan();
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
function wireControls() {
  $('btn-back').onclick = goBack;

  $('btn-private').onclick = () => {
    const v = !state.privateMode;
    setState({ privateMode: v });
    $('btn-private').setAttribute('aria-pressed', String(v));
    $('btn-private').classList.toggle('on', v);
    refreshPins();
    setHint(v ? 'Private mode ON — locked spots visible' : 'Private mode off');
  };

  $('btn-stations').onclick = () => {
    const v = !state.showStations;
    setState({ showStations: v });
    $('btn-stations').setAttribute('aria-pressed', String(v));
    $('btn-stations').classList.toggle('off', !v);
    if (!v) renderStations([]);
    else if (state.level === 'ward' || state.level === 'city') {
      const muni = getMunicipality(state.prefKey);
      const city = muni?.byCity.get(state.cityKey);
      if (state.level === 'ward') {
        const ward = city?.wardUnits?.find((w) => w.key === state.wardKey);
        if (ward) loadStationsFor(`${state.prefKey}:${state.cityKey}:${state.wardKey}`, ward.feature);
      } else if (city && !city.designated) {
        loadStationsFor(`${state.prefKey}:${state.cityKey}`, city.feature);
      }
    }
  };

  $('btn-list').onclick = () => {
    renderDrawer(state.pins, {
      privateMode: state.privateMode,
      onSelect: (id) => {
        const pin = state.pins.find((p) => p.id === id);
        if (!pin) return;
        closeDrawer();
        flyToPin(pin);
      },
      onClose: closeDrawer,
    });
  };

  $('btn-settings').onclick = openSettings;
  $('btn-locate').onclick = toggleLocate;

  initSearch({
    inputEl: $('search-input'),
    clearEl: $('search-clear'),
    resultsEl: $('search-results'),
    getPins: () => state.pins,
    privateRef: () => state.privateMode,
    onPick: (pin) => flyToPin(pin),
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('panel').hidden) closePanel();
      else if (!$('settings').hidden) $('settings').querySelector('.panel-close')?.click();
      else goBack();
    }
  });

  if (!hasFirebase) console.info('[SPOTS] Firebase not configured — pins stored in localStorage.');
}

// Navigate down to a pin's prefecture and open it.
function flyToPin(pin) {
  goPrefecture(pin.prefKey);
  setTimeout(() => handlePinClick(pin), 1700);
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------
let geoWatchId = null;
function toggleLocate() {
  const btn = $('btn-locate');
  if (geoWatchId != null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
    btn.classList.remove('on');
    setCurrentLocation(null);
    return;
  }
  if (!navigator.geolocation) {
    setHint('Geolocation is not available on this device');
    return;
  }
  setHint('Locating…');
  btn.classList.add('on');
  geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const ll = [pos.coords.longitude, pos.coords.latitude];
      setCurrentLocation(ll);
      setHint('Current location shown on the map');
    },
    (err) => {
      btn.classList.remove('on');
      geoWatchId = null;
      setCurrentLocation(null);
      setHint('Location permission denied');
      console.warn(err);
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
  );
}
