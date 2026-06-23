// Google Places API (New) — a reliable keyword search source (official, has a
// free tier, and supports browser CORS with an API key). Used as a third
// "search box" next to HotPepper and 食べログ.
//
// Key is stored client-side (Settings). Restrict it by HTTP referrer in the
// Google Cloud console for safety.

export const places = {
  get key() {
    return localStorage.getItem('spots.places.key') || '';
  },
  set key(v) {
    localStorage.setItem('spots.places.key', v || '');
  },
};

export const hasPlaces = () => Boolean(places.key);

const PRICE = {
  PRICE_LEVEL_FREE: '無料',
  PRICE_LEVEL_INEXPENSIVE: '¥',
  PRICE_LEVEL_MODERATE: '¥¥',
  PRICE_LEVEL_EXPENSIVE: '¥¥¥',
  PRICE_LEVEL_VERY_EXPENSIVE: '¥¥¥¥',
};

function mediaUrl(photoName, key) {
  return `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=640&maxWidthPx=900&key=${encodeURIComponent(key)}`;
}

function normalize(p, key) {
  const photos = (p.photos || []).slice(0, 8).map((ph) => mediaUrl(ph.name, key));
  const types = (p.types || []).filter((t) => !/point_of_interest|establishment|food/.test(t)).slice(0, 2).join('・');
  return {
    id: p.id,
    name: p.displayName?.text || 'Place',
    address: (p.formattedAddress || '').replace(/^日本、?/, ''),
    budget: PRICE[p.priceLevel] || '',
    category: types,
    url: p.googleMapsUri || '',
    photo: photos[0] || '',
    photos,
    station: '',
    privateRoom: '',
    charter: '',
    nonSmoking: '',
    capacity: '',
    rating: p.rating,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
  };
}

export async function searchByKeyword(keyword) {
  const key = places.key.trim();
  if (!key) throw new Error('Google Places APIキーを設定してください（SETTINGS）');
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.priceLevel,places.types,places.photos,places.googleMapsUri',
    },
    body: JSON.stringify({ textQuery: keyword, languageCode: 'ja', regionCode: 'JP', maxResultCount: 15 }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 403) throw new Error('APIキーが拒否されました（Places API有効化／リファラ制限を確認）');
    throw new Error(`Places API error (${res.status}) ${t.slice(0, 120)}`);
  }
  const data = await res.json();
  return (data.places || []).map((p) => normalize(p, key));
}
