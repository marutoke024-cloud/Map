// Minimal reactive app state with a pub/sub bus.

const listeners = new Set();

export const state = {
  level: 'japan', // japan | region | prefecture | city | ward
  regionKey: null,
  prefKey: null,
  cityKey: null,
  wardKey: null,
  privateMode: false, // show locked pins
  showStations: true,
  activePinId: null,
  pins: [], // loaded pins
  stations: {}, // areaId -> [{id,name,lon,lat,lines}]
};

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
