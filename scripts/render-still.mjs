// Generates representative still SVGs using the real projection + palette,
// so the visual style can be reviewed without a browser.
import { feature } from 'topojson-client';
import { geoMercator, geoPath } from 'd3-geo';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const W = 1600, H = 1000;
const P = { deep: '#1B3C53', panel: '#234C6A', accent: '#456882', shape: '#D2C1B6', bright: '#ECE0D6', ink: '#EAF1F6', dim: '#9FB6C6' };
const topo = JSON.parse(readFileSync('public/data/japan.topojson'));
const fc = feature(topo, topo.objects.japan);
const byId = {}; for (const f of fc.features) byId[f.properties.id] = f;
const proj = geoMercator().fitExtent([[W*0.06,H*0.06],[W*0.94,H*0.94]], { type:'FeatureCollection', features: fc.features.filter(f=>f.properties.id!==47) });
const path = geoPath(proj);
const KINKI=[27,26,29,28], KANTO=[13,12,11,14];

function frame(ids, pad){
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const id of ids){const[[a,b],[c,d]]=path.bounds(byId[id]);x0=Math.min(x0,a);y0=Math.min(y0,b);x1=Math.max(x1,c);y1=Math.max(y1,d);}
  const bw=x1-x0,bh=y1-y0,cx=(x0+x1)/2,cy=(y0+y1)/2;
  const k=Math.min(W/(bw*(1+pad)),H/(bh*(1+pad)));
  return {k,x:W/2-cx*k,y:H/2-cy*k};
}

const defs = `<defs>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <radialGradient id="bg" cx="50%" cy="18%" r="90%"><stop offset="0%" stop-color="#27506b"/><stop offset="45%" stop-color="${P.deep}"/><stop offset="100%" stop-color="#122b3d"/></radialGradient>
  <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${P.bright}"/><stop offset="100%" stop-color="#C5B2A4"/></linearGradient>
  <radialGradient id="vig" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="transparent"/><stop offset="100%" stop-color="rgba(8,22,33,0.75)"/></radialGradient>
</defs>`;

function grid(){let s='';for(let i=-4;i<=28;i++){const x=i*W/24;s+=`<line x1="${x}" y1="${-H}" x2="${x-W*0.3}" y2="${H*2}" stroke="${P.accent}" stroke-width="0.6" opacity="0.07"/>`;}return s;}

function prefsLayer(activeIds, dimAll){
  return fc.features.filter(f=>f.properties.id!==47).map(f=>{
    const id=f.properties.id;
    let fill='#2c5169', op=1, filter='', stroke='#16344a';
    if(KINKI.includes(id)||KANTO.includes(id)){fill='#76909f';}
    if(activeIds && activeIds.includes(id)){fill='url(#sg)';filter='filter="url(#glow)"';stroke='#b9a596';}
    else if(activeIds && dimAll){fill='#24465d';op=0.5;}
    return `<path d="${path(f)}" fill="${fill}" stroke="${stroke}" stroke-width="0.5" opacity="${op}" ${filter}/>`;
  }).join('');
}

function extrude(id,k){
  const d=path(byId[id]); let s='<g>';
  const steps=20, dy=26/k/steps, dx=dy*0.35;
  for(let i=steps;i>=1;i--) s+=`<path d="${d}" fill="${i%2?'#36495a':'#3a4f5e'}" transform="translate(${dx*i} ${dy*i})"/>`;
  s+='</g>'; return s;
}

mkdirSync('preview',{recursive:true});

// --- Still 1: Japan overview ---
writeFileSync('preview/japan.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
${defs}<rect width="${W}" height="${H}" fill="url(#bg)"/>${grid()}
${prefsLayer([...KINKI,...KANTO].map(x=>x), false)}
<rect width="${W}" height="${H}" fill="url(#vig)"/>
<text x="60" y="70" fill="${P.ink}" font-family="Manrope,sans-serif" font-size="26" font-weight="700" letter-spacing="8">SPOTS</text>
<text x="60" y="92" fill="${P.dim}" font-family="Manrope" font-size="11" letter-spacing="6">ATLAS · JAPAN</text>
<text x="${W/2}" y="${H-50}" fill="${P.dim}" font-family="Manrope" font-size="13" letter-spacing="3" text-anchor="middle">TAP A GLOWING REGION — 近畿 / 関東</text>
</svg>`);

// --- Still 2: Osaka prefecture with extrusion, pins, stations ---
const fr = frame([27], 0.22);
const stations=[[135.50,34.70],[135.49,34.65],[135.52,34.73],[135.43,34.65],[135.60,34.75],[135.46,34.69],[135.55,34.68]];
const pins=[[135.50,34.69,false],[135.52,34.72,false],[135.47,34.66,true]];
function S(lon,lat){const[x,y]=proj([lon,lat]);return [x*fr.k+fr.x, y*fr.k+fr.y];}
writeFileSync('preview/osaka.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
${defs}<rect width="${W}" height="${H}" fill="url(#bg)"/>${grid()}
<g transform="translate(${fr.x} ${fr.y}) scale(${fr.k})">
  <path d="${path(byId[27])}" fill="${P.shape}" opacity="0.18" filter="url(#glow)"/>
  ${extrude(27,fr.k)}
  ${prefsLayer([27], true).replace(/<path[^>]*opacity="0.5"[^>]*\/>/g, m=>m)}
</g>
${stations.map(([lo,la])=>{const[x,y]=S(lo,la);return `<g transform="translate(${x} ${y})"><path d="M0,-7 L4,-1 L1.6,-1 L1.6,5 L-1.6,5 L-1.6,-1 L-4,-1 Z" fill="none" stroke="${P.accent}" stroke-width="1.4"/><circle r="2.1" fill="${P.ink}"/></g>`;}).join('')}
${pins.map(([lo,la,lock])=>{const[x,y]=S(lo,la);return `<g transform="translate(${x} ${y})"><circle r="16" fill="${P.shape}" opacity="0.12"/><path d="M0,0 C-9,-12 -9,-22 0,-22 C9,-22 9,-12 0,0 Z" transform="translate(0,-2)" fill="${lock?'#b9a08f':P.shape}" stroke="${P.deep}" stroke-width="1.2"/><circle cy="-15" r="4" fill="${P.deep}"/></g>`;}).join('')}
<rect width="${W}" height="${H}" fill="url(#vig)"/>
<text x="${W/2}" y="${H/2}" fill="${P.shape}" font-family="'Zen Kaku Gothic New',sans-serif" font-size="120" font-weight="700" text-anchor="middle" opacity="0.9">大阪</text>
<text x="${W/2}" y="${H/2+40}" fill="${P.dim}" font-family="Manrope" font-size="14" letter-spacing="10" text-anchor="middle">OSAKA</text>
<text x="60" y="70" fill="${P.ink}" font-family="Manrope" font-size="13" letter-spacing="4">JAPAN › KINKI › OSAKA</text>
</svg>`);

console.log('wrote preview/japan.svg and preview/osaka.svg');
