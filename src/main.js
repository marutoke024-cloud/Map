import './style.css';
import { gsap } from 'gsap';
import { loadGeo } from './map/geo.js';
import {
  initMap,
  flyTo,
  frameForJapan,
  frameForRegion,
  frameForPrefecture,
  setHighlight,
  renderStations,
  renderPins,
  flashPlacement,
} from './map/mapRenderer.js';
import { state, setState } from './state.js';
import { REGIONS, PREFECTURES, PREF_KEY_BY_ID, PREF_ID_TO_REGION } from './config.js';
import { loadPins } from './pins/pinStore.js';
import { loadStations } from './stations/stations.js';
import { initPanel, openPanel, closePanel } from './pins/pinPanel.js';
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
  await loadGeo();

  initMap($('stage'), {
    onMapClick: handleMapClick,
    onPinClick: handlePinClick,
  });

  initPanel($('panel'), {
    onSaved: handlePinSaved,
    onDeleted: handlePinDeleted,
    onClose: () => setState({ activePinId: null }),
  });

  state.pins = await loadPins();
  refreshPins();

  wireControls();

  // Intro: start dramatically over-zoomed, then settle into Japan.
  await introSequence();

  goJapan(false);
  hideLoader();
})();

function hideLoader() {
  const l = $('loader');
  gsap.to(l, { autoAlpha: 0, duration: 0.8, onComplete: () => (l.style.display = 'none') });
}

function introSequence() {
  // Over-scaled flourish that eases back to the full map.
  flyTo({ k: 2.6, x: -1600, y: -1200 }, { duration: 0 });
  return new Promise((r) => {
    flyTo(frameForJapan(), { duration: 2.0, onComplete: r });
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function goJapan(animate = true) {
  setState({ view: 'japan', regionKey: null, prefKey: null });
  flyTo(frameForJapan(), { duration: animate ? 1.4 : 0.01 });
  setHighlight({ view: 'japan' });
  setBackVisible(false);
  setScaleLabel('JAPAN');
  setHint('Tap a glowing region — 近畿 or 関東');
  setBreadcrumb([{ key: 'japan', label: 'JAPAN' }], onCrumb);
  refreshStations();
  refreshPins();
}

function goRegion(regionKey, animate = true) {
  const r = REGIONS[regionKey];
  setState({ view: regionKey, regionKey, prefKey: null });
  flyTo(frameForRegion(regionKey), { duration: animate ? 1.5 : 0.01 });
  setHighlight({ view: regionKey, regionKey, prefKey: null });
  setBackVisible(true);
  setScaleLabel(r.en);
  showStageTitle(r.ja, r.en);
  setHint('Choose a prefecture');
  setBreadcrumb([{ key: 'japan', label: 'JAPAN' }, { key: regionKey, label: r.en }], onCrumb);
  refreshStations();
  refreshPins();
}

async function goPrefecture(prefKey, animate = true) {
  const p = PREFECTURES[prefKey];
  const regionKey = PREF_ID_TO_REGION[p.id];
  setState({ view: prefKey, regionKey, prefKey });
  flyTo(frameForPrefecture(prefKey), { duration: animate ? 1.6 : 0.01 });
  setHighlight({ view: prefKey, regionKey, prefKey });
  setBackVisible(true);
  setScaleLabel(p.en);
  showStageTitle(p.ja, p.en);
  setHint('Tap anywhere on the map to drop a spot');
  setBreadcrumb(
    [
      { key: 'japan', label: 'JAPAN' },
      { key: regionKey, label: REGIONS[regionKey].en },
      { key: prefKey, label: p.en },
    ],
    onCrumb,
  );
  refreshPins();
  await loadStationsFor(prefKey);
}

function goBack() {
  if (state.prefKey) goRegion(state.regionKey);
  else if (state.regionKey) goJapan();
}

function onCrumb(key) {
  if (key === 'japan') goJapan();
  else if (REGIONS[key]) goRegion(key);
  else if (PREFECTURES[key]) goPrefecture(key);
}

// ---------------------------------------------------------------------------
// Map interactions
// ---------------------------------------------------------------------------
function handleMapClick({ prefId, geo, screen }) {
  const region = prefId != null ? PREF_ID_TO_REGION[prefId] : null;

  // Japan view: tapping a playable region zooms in.
  if (state.view === 'japan') {
    if (region) goRegion(region);
    return;
  }

  // Region view: tapping a member prefecture zooms in.
  if (!state.prefKey) {
    const prefKey = region === state.regionKey ? PREF_KEY_BY_ID[prefId] : null;
    if (prefKey) goPrefecture(prefKey);
    return;
  }

  // Prefecture view: tap anywhere to drop a spot.
  const remove = flashPlacement(screen.sx, screen.sy);
  openPanel({ prefKey: state.prefKey, lon: geo[0], lat: geo[1] }, true);
  setTimeout(remove, 700);
}

function handlePinClick(pin) {
  setState({ activePinId: pin.id });
  refreshPins();
  openPanel(pin, false);
}

// ---------------------------------------------------------------------------
// Data refresh
// ---------------------------------------------------------------------------
function refreshPins() {
  renderPins(state.pins, { privateMode: state.privateMode, activeId: state.activePinId });
}

function refreshStations() {
  // Only show stations in prefecture view.
  if (!state.prefKey) {
    renderStations([], false);
    return;
  }
  const list = state.stations[state.prefKey] || [];
  renderStations(list, state.showStations);
}

async function loadStationsFor(prefKey) {
  if (!state.stations[prefKey]) {
    setHint('Loading stations from OpenStreetMap…');
    try {
      const list = await loadStations(prefKey);
      state.stations = { ...state.stations, [prefKey]: list };
    } catch (e) {
      state.stations = { ...state.stations, [prefKey]: [] };
      console.warn('Overpass failed', e);
    }
    setHint('Tap anywhere on the map to drop a spot');
  }
  if (state.prefKey === prefKey) refreshStations();
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
    refreshStations();
  };

  $('btn-list').onclick = () => {
    renderDrawer(state.pins, {
      privateMode: state.privateMode,
      onSelect: (id) => {
        const pin = state.pins.find((p) => p.id === id);
        if (!pin) return;
        closeDrawer();
        goPrefecture(pin.prefKey);
        setTimeout(() => handlePinClick(pin), 1700);
      },
      onClose: closeDrawer,
    });
  };

  // Keyboard: Esc backs out / closes overlays.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const panel = $('panel');
      if (!panel.hidden) closePanel();
      else goBack();
    }
  });

  if (!hasFirebase) {
    console.info('[SPOTS] Firebase not configured — pins are stored in localStorage.');
  }
}
