// HotPepper Gourmet (Recruit Web Service) client.
//
// Two runtime modes:
//   1. Dev server  — calls the same-origin `/api/hotpepper` proxy (vite.config.js)
//      which injects the key server-side.
//   2. Static host (GitHub Pages) — no server, so the user stores their own API
//      key via Settings (localStorage) and we call the Recruit API through a
//      CORS proxy. Personal-use only, per the API terms.

const DEV_PROXY = '/api/hotpepper';
const RECRUIT = 'https://webservice.recruit.co.jp/hotpepper/gourmet/v1/';

export const settings = {
  get key() {
    return localStorage.getItem('spots.hotpepper.key') || '';
  },
  set key(v) {
    localStorage.setItem('spots.hotpepper.key', v || '');
  },
  get proxy() {
    return localStorage.getItem('spots.hotpepper.proxy') || 'https://corsproxy.io/?url=';
  },
  set proxy(v) {
    localStorage.setItem('spots.hotpepper.proxy', v || '');
  },
};

export const hasClientKey = () => Boolean(settings.key);

export function extractShopId(url) {
  if (!url) return null;
  const m = String(url).match(/str(J\d{9,})/i);
  return m ? m[1] : null;
}

function normalize(shop) {
  return {
    id: shop.id,
    name: shop.name,
    address: shop.address,
    budget: shop.budget?.average || shop.budget?.name || '',
    category: shop.genre?.name || '',
    url: shop.urls?.pc || '',
    photo: shop.photo?.pc?.l || shop.photo?.mobile?.l || '',
    station: shop.station_name || '',
    privateRoom: shop.private_room || '',
    capacity: shop.capacity || '',
    lat: shop.lat,
    lng: shop.lng,
  };
}

async function call(params) {
  let res;
  if (settings.key) {
    const qs = new URLSearchParams({ ...params, key: settings.key, format: 'json' }).toString();
    const target = `${RECRUIT}?${qs}`;
    const url = settings.proxy + encodeURIComponent(target);
    res = await fetch(url);
  } else {
    const qs = new URLSearchParams(params).toString();
    res = await fetch(`${DEV_PROXY}?${qs}`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HotPepper API error (${res.status}). Set an API key in Settings.`);
  }
  const data = await res.json();
  return data.results?.shop || [];
}

export async function resolveByUrl(url) {
  const id = extractShopId(url);
  if (!id) throw new Error('Could not find a shop id in that URL');
  const shops = await call({ id });
  if (!shops.length) throw new Error('Shop not found');
  return normalize(shops[0]);
}

export async function searchByKeyword(keyword, count = 12) {
  const shops = await call({ keyword, count: String(count) });
  return shops.map(normalize);
}
