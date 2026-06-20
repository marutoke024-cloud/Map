// HotPepper Gourmet (Recruit Web Service) client.
//
// Calls go through the same-origin `/api/hotpepper` proxy (see vite.config.js /
// README) which injects the API key. Two entry points per the spec:
//   1. resolveByUrl  — pull the shop id out of a HotPepper URL, then fetch it.
//   2. searchByKeyword — keyword/area search returning candidates to pick from.

const PROXY = '/api/hotpepper';

// HotPepper shop pages look like https://www.hotpepper.jp/strJ001234567/ or
// .../strJ001234567/ — the id is the `J` code after `str`.
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
    lat: shop.lat,
    lng: shop.lng,
  };
}

async function call(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${PROXY}?${qs}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HotPepper API error (${res.status})`);
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
