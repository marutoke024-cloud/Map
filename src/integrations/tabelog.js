// Tabelog (食べログ) support.
//
// Tabelog has NO public API, so keyword search isn't possible. Instead the user
// pastes a shop URL and we read the page's schema.org JSON-LD (Restaurant) +
// OpenGraph meta — name, address, geo, photos, genre, budget — through the same
// CORS proxy used for HotPepper.

import { fetchHtmlViaProxy } from './hotpepper.js';

export const isTabelogUrl = (u) => /tabelog\.com/i.test(u || '');

function typeMatches(t) {
  const arr = [].concat(t || []);
  return arr.some((x) => /Restaurant|FoodEstablishment|LocalBusiness/i.test(x));
}

export async function resolveByUrl(url) {
  if (!isTabelogUrl(url)) throw new Error('食べログの店舗URLを貼り付けてください');
  const html = await fetchHtmlViaProxy(url);
  if (!html) throw new Error('ページを取得できませんでした（CORSプロキシ）');
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // JSON-LD Restaurant node
  let ld = null;
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.textContent);
      const arr = Array.isArray(j) ? j : j['@graph'] || [j];
      for (const o of arr) {
        if (o && typeMatches(o['@type'])) {
          ld = o;
          break;
        }
      }
      if (ld) break;
    } catch {
      /* ignore malformed ld+json */
    }
  }

  const og = (p) => doc.querySelector(`meta[property="${p}"]`)?.getAttribute('content') || '';
  const name = (ld?.name || og('og:title') || doc.title || '').replace(/\s*-\s*食べログ.*/, '').trim();
  const addr = ld?.address
    ? [ld.address.addressRegion, ld.address.addressLocality, ld.address.streetAddress].filter(Boolean).join('')
    : '';
  const cuisine = [].concat(ld?.servesCuisine || []).filter(Boolean).join('・');
  const rating = ld?.aggregateRating?.ratingValue;
  const lat = ld?.geo?.latitude;
  const lng = ld?.geo?.longitude;

  const photos = [];
  const seen = new Set();
  const push = (s) => {
    if (typeof s === 'string' && /tblg\.k-img\.com|tabelog/i.test(s) && !seen.has(s)) {
      seen.add(s);
      photos.push(s);
    }
  };
  if (Array.isArray(ld?.image)) ld.image.forEach(push);
  else push(ld?.image);
  push(og('og:image'));
  for (const img of doc.querySelectorAll('img')) {
    const s = img.getAttribute('src') || img.getAttribute('data-original') || img.getAttribute('data-src') || '';
    if (/tblg\.k-img\.com/i.test(s)) push(s);
    if (photos.length >= 12) break;
  }

  const memoBits = [];
  if (cuisine) memoBits.push(`ジャンル:${cuisine}`);
  if (rating) memoBits.push(`食べlog評価:${rating}`);

  return {
    id: null,
    name: name || 'Tabelog shop',
    address: addr,
    budget: ld?.priceRange || '',
    category: cuisine,
    url,
    photo: photos[0] || '',
    photos,
    station: '',
    privateRoom: '',
    charter: '',
    nonSmoking: '',
    capacity: '',
    tabelogMemo: memoBits.join(' / '),
    lat: lat != null ? +lat : undefined,
    lng: lng != null ? +lng : undefined,
  };
}
