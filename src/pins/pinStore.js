// Pin persistence: Firestore when configured, localStorage otherwise.
//
// Pin shape:
// { id, prefKey, lon, lat, name, category, memo, photo (dataURL|null),
//   hotpepperId, hotpepperUrl, budget, address, locked, createdAt }

import { hasFirebase, db } from '../firebase.js';

const LS_KEY = 'spots.pins.v1';

let _firestore = null;
async function fs() {
  if (!hasFirebase) return null;
  if (!_firestore) {
    _firestore = await import('firebase/firestore');
  }
  return _firestore;
}

function uid() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}
function writeLocal(pins) {
  localStorage.setItem(LS_KEY, JSON.stringify(pins));
}

export async function loadPins() {
  const mod = await fs();
  if (mod) {
    const snap = await mod.getDocs(mod.collection(await db(), 'pins'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return readLocal();
}

export async function addPin(pin) {
  const record = { ...pin, createdAt: Date.now() };
  const mod = await fs();
  if (mod) {
    const ref = await mod.addDoc(mod.collection(await db(), 'pins'), record);
    return { id: ref.id, ...record };
  }
  record.id = uid();
  const pins = readLocal();
  pins.push(record);
  writeLocal(pins);
  return record;
}

export async function updatePin(id, patch) {
  const mod = await fs();
  if (mod) {
    await mod.updateDoc(mod.doc(await db(), 'pins', id), patch);
    return;
  }
  const pins = readLocal();
  const i = pins.findIndex((p) => p.id === id);
  if (i >= 0) {
    pins[i] = { ...pins[i], ...patch };
    writeLocal(pins);
  }
}

export async function deletePin(id) {
  const mod = await fs();
  if (mod) {
    await mod.deleteDoc(mod.doc(await db(), 'pins', id));
    return;
  }
  writeLocal(readLocal().filter((p) => p.id !== id));
}

export { uid };
