// Central configuration: palette, hierarchy, and per-area metadata.

export const PALETTE = {
  bgDeep: '#1B3C53', // 背景（最も濃い）
  bgPanel: '#234C6A', // 背景・パネル
  accent: '#456882', // アクセント・線
  shape: '#D2C1B6', // 図形・ハイライト
};

// Prefecture ids as they appear in japan.topojson (`properties.id`).
export const PREF_ID = {
  osaka: 27,
  kyoto: 26,
  nara: 29,
  hyogo: 28,
  tokyo: 13,
  chiba: 12,
  saitama: 11,
  kanagawa: 14,
};

// Per-prefecture metadata. `osmArea` is the Overpass area name used to scope
// the rail-station query (ja name kept for display).
export const PREFECTURES = {
  osaka: { id: 27, ja: '大阪', en: 'Osaka', osm: 'Osaka Prefecture' },
  kyoto: { id: 26, ja: '京都', en: 'Kyoto', osm: 'Kyoto Prefecture' },
  nara: { id: 29, ja: '奈良', en: 'Nara', osm: 'Nara Prefecture' },
  hyogo: { id: 28, ja: '兵庫', en: 'Hyogo', osm: 'Hyōgo Prefecture' },
  tokyo: { id: 13, ja: '東京', en: 'Tokyo', osm: 'Tokyo' },
  chiba: { id: 12, ja: '千葉', en: 'Chiba', osm: 'Chiba Prefecture' },
  saitama: { id: 11, ja: '埼玉', en: 'Saitama', osm: 'Saitama Prefecture' },
  kanagawa: { id: 14, ja: '神奈川', en: 'Kanagawa', osm: 'Kanagawa Prefecture' },
};

// Two playable regions. `members` are the selectable prefecture keys.
export const REGIONS = {
  kinki: {
    ja: '近畿地方',
    en: 'KINKI',
    members: ['osaka', 'kyoto', 'nara', 'hyogo'],
  },
  kanto: {
    ja: '関東地方',
    en: 'KANTO',
    members: ['tokyo', 'chiba', 'saitama', 'kanagawa'],
  },
};

// Reverse lookup: prefecture id -> region key (only the playable ones).
export const PREF_ID_TO_REGION = (() => {
  const map = {};
  for (const [rk, r] of Object.entries(REGIONS)) {
    for (const m of r.members) map[PREFECTURES[m].id] = rk;
  }
  return map;
})();

export const PREF_KEY_BY_ID = (() => {
  const map = {};
  for (const [k, p] of Object.entries(PREFECTURES)) map[p.id] = k;
  return map;
})();
