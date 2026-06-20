// Minimal reactive app state with a pub/sub bus.

const listeners = new Set();

export const state = {
  view: 'japan', // 'japan' | region key | prefecture key
  regionKey: null, // when in a region or prefecture
  prefKey: null, // when in a prefecture
  privateMode: false, // show locked pins
  showStations: true,
  activePinId: null,
  pins: [], // loaded pins (all prefectures)
  stations: {}, // prefKey -> [{id,name,lon,lat}]
  placingHint: false,
};

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// View helpers ------------------------------------------------------------
export function viewKind() {
  if (state.view === 'japan') return 'japan';
  if (state.view === state.regionKey && !state.prefKey) return 'region';
  return 'prefecture';
}
