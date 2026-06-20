// Build 町丁目 (town) segment TopoJSON for leaf areas from the open
// geolonia/japanese-boundaries dataset (2015 国勢調査 小地域 / e-Stat).
//
//   data/japan/{pref2}/{city3}/{area6}.geojson  (one Feature per 小地域)
//
// For each municipal code we list its area files, fetch them, dissolve 丁目 into
// their parent 町 (e.g. 新町１丁目 + 新町２丁目 → 新町), simplify, and write a
// compact TopoJSON to public/data/town/{code}.topojson.
//
// Usage:
//   node scripts/fetch-town.mjs 27106 27102 ...      # specific codes
//   node scripts/fetch-town.mjs --city 27101-27128   # an inclusive range
//   node scripts/fetch-town.mjs --osaka              # all 大阪市 wards
//   add --force to overwrite existing files
//
// The directory listing uses the GitHub contents API (60 req/h unauthenticated;
// set GITHUB_TOKEN for 5000/h). Raw file fetches are unmetered.

import { topology } from 'topojson-server';
import { mergeArcs } from 'topojson-client';
import { presimplify, simplify } from 'topojson-simplify';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

const REF = 'master';
const REPO = 'geolonia/japanese-boundaries';
const RAW = `https://raw.githubusercontent.com/${REPO}/${REF}`;
const OUT = 'public/data/town';
const MANIFEST = 'scripts/town-manifest.json';
const TOKEN = process.env.GITHUB_TOKEN || '';

// Optional manifest: { "27106": ["001002", ...] } lets us skip the rate-limited
// contents API entirely and fetch each 小地域 directly from raw (unmetered).
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};

const args = process.argv.slice(2);
const force = args.includes('--force');
let codes = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--force') continue;
  else if (a === '--osaka') codes.push(...range(27101, 27128));
  else if (a === '--city') {
    const [lo, hi] = args[++i].split('-').map(Number);
    codes.push(...range(lo, hi));
  } else if (/^\d{5}$/.test(a)) codes.push(a);
}
codes = [...new Set(codes.map(String))];
if (!codes.length) {
  console.error('No municipal codes given. e.g. node scripts/fetch-town.mjs --osaka');
  process.exit(1);
}

function range(lo, hi) {
  const out = [];
  for (let n = lo; n <= hi; n++) out.push(String(n));
  return out;
}

async function gh(url) {
  const headers = { 'User-Agent': 'spots-atlas' };
  if (TOKEN) headers.Authorization = 'token ' + TOKEN;
  const res = await fetch(url, { headers });
  if (res.status === 403) throw new Error('rate-limited (set GITHUB_TOKEN)');
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.json();
}

function baseMachi(props) {
  const s = props.S_NAME || props.MOJI || '';
  // strip trailing 丁目 numbering
  return s.replace(/[0-9０-９一二三四五六七八九十]+丁目?$/u, '').trim() || s;
}

async function buildCode(code) {
  const out = `${OUT}/${code}.topojson`;
  if (existsSync(out) && !force) {
    console.log(`· ${code} exists, skip`);
    return;
  }
  const pref2 = code.slice(0, 2);
  const city3 = code.slice(2);
  let files;
  if (manifest[code]) {
    files = manifest[code].map((a) => ({
      name: a + '.geojson',
      download_url: `${RAW}/data/japan/${pref2}/${city3}/${a}.geojson`,
    }));
  } else {
    const list = await gh(
      `https://api.github.com/repos/${REPO}/contents/data/japan/${pref2}/${city3}?ref=${REF}`,
    );
    files = list.filter((f) => f.name.endsWith('.geojson'));
  }
  if (!files.length) {
    console.warn(`! ${code} no area files`);
    return;
  }
  const features = [];
  await Promise.all(
    files.map(async (f) => {
      const gj = await (await fetch(f.download_url)).json();
      const fs = gj.type === 'FeatureCollection' ? gj.features : [gj];
      for (const ft of fs) {
        if (!ft.geometry) continue;
        features.push({ type: 'Feature', properties: { m: baseMachi(ft.properties) }, geometry: ft.geometry });
      }
    }),
  );

  // topology (quantised) → dissolve 丁目 into 町 → simplify
  let topo = topology({ town: { type: 'FeatureCollection', features } }, 1e4);
  const geoms = topo.objects.town.geometries;
  const groups = new Map();
  for (const g of geoms) {
    const name = g.properties.m;
    (groups.get(name) || groups.set(name, []).get(name)).push(g);
  }
  const merged = [...groups.entries()].map(([name, gs]) => {
    const geom = gs.length > 1 ? mergeArcs(topo, gs) : gs[0];
    geom.properties = { name };
    return geom;
  });
  topo.objects.town.geometries = merged;
  topo = simplify(presimplify(topo), 1e-6);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(out, JSON.stringify(topo));
  console.log(`✓ ${code}  ${merged.length} 町  (${files.length} 小地域)  ${(JSON.stringify(topo).length / 1024) | 0}KB`);
}

for (const code of codes) {
  try {
    await buildCode(code);
  } catch (e) {
    console.error(`✗ ${code}: ${e.message}`);
    if (/rate-limited/.test(e.message)) break;
  }
}
