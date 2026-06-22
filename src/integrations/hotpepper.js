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
    return localStorage.getItem('spots.hotpepper.proxy') || 'https://api.allorigins.win/raw?url=';
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
    charter: shop.charter || '',
    nonSmoking: shop.non_smoking || '',
    capacity: shop.capacity || '',
    lat: shop.lat,
    lng: shop.lng,
  };
}

// ---------------------------------------------------------------------------
// Best-effort scrape of the shop's web page for the per-seat list (お席) and
// interior photos — these are NOT exposed by the official API, only on the page.
// Fetched through the same CORS proxy. May break if HotPepper changes its HTML.
// ---------------------------------------------------------------------------
const SEAT_TYPES = ['テーブル', 'カウンター', '個室', '半個室', '掘りごたつ', '座敷', 'ソファー', 'ソファ', 'テラス', '立ち飲み', '貸切'];

export async function scrapeShopPage(url) {
  if (!url) return { photos: [], seats: '' };
  const target = url.startsWith('http') ? url : `https://www.hotpepper.jp/${url}/`;
  let html = '';
  for (const px of proxyList()) {
    try {
      const res = await fetch(px + encodeURIComponent(target));
      if (!res.ok) continue;
      const t = await res.text();
      if (t && /<html/i.test(t)) {
        html = t;
        break;
      }
    } catch {
      /* try next proxy */
    }
  }
  if (!html) return { photos: [], seats: '' };

  let doc;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return { photos: [], seats: '' };
  }

  // photos: gallery images on hotpepper's image CDN (skip tiny/chrome images)
  const photos = [];
  const seen = new Set();
  for (const img of doc.querySelectorAll('img')) {
    let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
    if (!/imgfp\.hotp\.jp|imgcp\.hotp\.jp/.test(src)) continue;
    if (/_60\.|_120\.|icon|logo|noimage/i.test(src)) continue;
    if (src.startsWith('//')) src = 'https:' + src;
    if (seen.has(src)) continue;
    seen.add(src);
    photos.push(src);
    if (photos.length >= 12) break;
  }

  // seats: find the お席 section and pull "<type> 〇名様" entries
  let seatNode = null;
  for (const h of doc.querySelectorAll('h1,h2,h3,h4,th,dt,.ttl')) {
    if (/お席|席数|seats/i.test(h.textContent || '')) {
      seatNode = h.closest('section,div,table,dl') || h.parentElement;
      break;
    }
  }
  const text = ((seatNode || doc.body).textContent || '').replace(/\s+/g, ' ');
  const re = new RegExp(`(${SEAT_TYPES.join('|')})[^0-9]{0,24}?(\\d{1,4})\\s*名`, 'g');
  const found = [];
  const dedup = new Set();
  let m;
  while ((m = re.exec(text)) && found.length < 12) {
    const key = `${m[1]}:${m[2]}`;
    if (dedup.has(key)) continue;
    dedup.add(key);
    found.push(`${m[1]}${m[2]}名`);
  }

  return { photos, seats: found.join(' / ') };
}

// Public CORS proxies tried (in order) for the keyless... no — for the
// API-key path on static hosting. corsproxy.io dropped anonymous use, so we try
// a few and use whichever returns a valid Recruit response.
const PUBLIC_PROXIES = ['https://api.allorigins.win/raw?url=', 'https://corsproxy.io/?url='];

function proxyList() {
  const arr = [];
  if (settings.proxy) arr.push(settings.proxy);
  arr.push(...PUBLIC_PROXIES);
  return [...new Set(arr.filter(Boolean))];
}

async function call(params) {
  // Dev server proxy (key injected server-side)
  if (!settings.key) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${DEV_PROXY}?${qs}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HotPepper API error (${res.status}). Set an API key in Settings.`);
    }
    const data = await res.json();
    return data.results?.shop || [];
  }

  // Static hosting: call Recruit through a CORS proxy, trying several.
  const qs = new URLSearchParams({ ...params, key: settings.key, format: 'json' }).toString();
  const target = `${RECRUIT}?${qs}`;
  let lastErr = '';
  for (const px of proxyList()) {
    try {
      const res = await fetch(px + encodeURIComponent(target));
      if (!res.ok) {
        lastErr = `HTTP ${res.status} (${px})`;
        continue;
      }
      const data = await res.json().catch(() => null);
      if (data && data.results) {
        if (data.results.error) {
          const e = data.results.error;
          throw new Error('APIエラー: ' + (Array.isArray(e) ? e[0]?.message : JSON.stringify(e)) + '（APIキーをご確認ください）');
        }
        if (data.results.shop !== undefined) return data.results.shop;
      }
      lastErr = `proxy returned a non-API response (${px})`;
    } catch (e) {
      if (/APIエラー/.test(e.message)) throw e;
      lastErr = `${e.message} (${px})`;
    }
  }
  throw new Error('HotPepper取得に失敗。CORSプロキシが応答しません。SETTINGSのCORS Proxyを変更してください。[' + lastErr + ']');
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
