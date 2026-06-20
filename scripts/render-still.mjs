// Still-render previews that mirror the live renderer (projection, palette,
// area tiles, labels, extrusion) so the look can be reviewed without a browser.
import { feature, merge } from 'topojson-client';
import { geoMercator, geoPath } from 'd3-geo';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const W = 1600, H = 1000;
const P = { deep: '#1B3C53', shape: '#D2C1B6', bright: '#ECE0D6' };
const jp = JSON.parse(readFileSync('public/data/japan.topojson'));
const jfc = feature(jp, jp.objects.japan);
const proj = geoMercator().fitExtent([[W*0.06,H*0.05],[W*0.94,H*0.95]],
  { type:'FeatureCollection', features: jfc.features.filter(f=>f.properties.id!==47) });
const path = geoPath(proj);

function polys(g){ if(!g)return[]; if(g.type==='Polygon')return[g.coordinates]; if(g.type==='MultiPolygon')return g.coordinates; return []; }
function mainBounds(f){ const ps=polys(f.geometry); if(ps.length<=1)return path.bounds(f);
  let best,ba=-1; for(const poly of ps){ const b=path.bounds({type:'Feature',geometry:{type:'Polygon',coordinates:poly}});
    const a=(b[1][0]-b[0][0])*(b[1][1]-b[0][1]); if(a>ba){ba=a;best=b;} } return best; }
function frame(feats,pad){ let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const f of feats){const b=mainBounds(f);x0=Math.min(x0,b[0][0]);y0=Math.min(y0,b[0][1]);x1=Math.max(x1,b[1][0]);y1=Math.max(y1,b[1][1]);}
  const bw=x1-x0,bh=y1-y0,cx=(x0+x1)/2,cy=(y0+y1)/2,k=Math.min(W/(bw*(1+pad)),H/(bh*(1+pad)));
  return {k,x:W/2-cx*k,y:H/2-cy*k}; }

const defs=`<defs>
 <filter id="g" x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
 <radialGradient id="bg" cx="50%" cy="18%" r="90%"><stop offset="0%" stop-color="#27506b"/><stop offset="45%" stop-color="${P.deep}"/><stop offset="100%" stop-color="#122b3d"/></radialGradient>
 <linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#E4D7CC"/><stop offset="100%" stop-color="#CBB9AC"/></linearGradient>
 <radialGradient id="v" cx="50%" cy="50%" r="75%"><stop offset="55%" stop-color="transparent"/><stop offset="100%" stop-color="rgba(8,22,33,0.7)"/></radialGradient></defs>`;

function extrude(d,k){ let s='<g>'; const steps=16, dy=22/k/steps, dx=dy*0.4;
  for(let i=steps;i>=1;i--) s+=`<path d="${d}" fill="${i%2?'#324957':'#38505f'}" transform="translate(${dx*i} ${dy*i})"/>`;
  return s+'</g>'; }

function loadMuni(k){ const t=JSON.parse(readFileSync('public/data/municipality/'+k+'.topojson'));
  const on=Object.keys(t.objects)[0]; const geoms=t.objects[on].geometries;
  const groups=new Map();
  for(const g of geoms){ const p=g.properties;
    const isWard=p.N03_003&&p.N03_003.endsWith('市')&&p.N03_004&&p.N03_004.endsWith('区');
    const key=isWard?p.N03_003:(p.N03_004+'|'+(p.N03_003||'')); const ja=isWard?p.N03_003:p.N03_004;
    if(!groups.has(key))groups.set(key,{key,ja,designated:isWard,geoms:[]}); groups.get(key).geoms.push(g);}
  return {t,cities:[...groups.values()].map(c=>({...c,
    feature: c.geoms.length>1?{type:'Feature',properties:{},geometry:merge(t,c.geoms)}:feature(t,c.geoms[0]),
    wardUnits: c.designated?c.geoms.map(g=>({ja:g.properties.N03_004,feature:feature(t,g)})):null }))}; }

function tiles(areas, fr, withLabels){
  let s=`<g transform="translate(${fr.x} ${fr.y}) scale(${fr.k})" stroke="#1b3c53" stroke-width="${1.1/fr.k}" stroke-linejoin="round">`;
  for(const a of areas) s+=`<path d="${path(a.feature)}" fill="url(#t)"/>`;
  s+='</g>';
  if(withLabels){ for(const a of areas){ const c=path.centroid(a.feature); const x=c[0]*fr.k+fr.x,y=c[1]*fr.k+fr.y;
    if(x<0||x>W||y<0||y>H)continue;
    s+=`<text x="${x}" y="${y}" fill="#2a2018" font-family="sans-serif" font-weight="700" font-size="14" text-anchor="middle" dominant-baseline="middle" paint-order="stroke" stroke="rgba(236,224,214,0.55)" stroke-width="3">${a.ja||a.label||''}</text>`; } }
  return s;
}

mkdirSync('preview',{recursive:true});
const wrap = (inner,title)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${defs}<rect width="${W}" height="${H}" fill="url(#bg)"/>${inner}<rect width="${W}" height="${H}" fill="url(#v)"/>${title}</svg>`;

// 1. Osaka prefecture -> city tiles + labels
{ const m=loadMuni('osaka'); const osakaPref=jfc.features.find(f=>f.properties.id===27);
  const fr=frame([osakaPref],0.16);
  const base=`<g transform="translate(${fr.x} ${fr.y}) scale(${fr.k})">${extrude(path(osakaPref),fr.k)}</g>`;
  writeFileSync('preview/osaka-cities.svg', wrap(base+tiles(m.cities,fr,true),
    `<text x="60" y="64" fill="#eaf1f6" font-family="sans-serif" font-size="13" letter-spacing="3">JAPAN › KINKI › OSAKA</text>`)); }

// 2. Osaka City -> ward tiles + labels
{ const m=loadMuni('osaka'); const city=m.cities.find(c=>c.ja==='大阪市');
  const fr=frame([city.feature],0.18);
  const base=`<g transform="translate(${fr.x} ${fr.y}) scale(${fr.k})">${extrude(path(city.feature),fr.k)}</g>`;
  const wards=city.wardUnits.map(w=>({feature:w.feature,ja:w.ja}));
  writeFileSync('preview/osaka-wards.svg', wrap(base+tiles(wards,fr,true),
    `<text x="60" y="64" fill="#eaf1f6" font-family="sans-serif" font-size="13" letter-spacing="3">… › OSAKA › 大阪市</text>`)); }

// 3. Nishi-ku leaf + sample stations
{ const m=loadMuni('osaka'); const city=m.cities.find(c=>c.ja==='大阪市');
  const ward=city.wardUnits.find(w=>w.ja==='西区'); const fr=frame([ward.feature],0.22);
  const base=`<g transform="translate(${fr.x} ${fr.y}) scale(${fr.k})">${extrude(path(ward.feature),fr.k)}<path d="${path(ward.feature)}" fill="url(#t)" stroke="#1b3c53" stroke-width="${1.1/fr.k}"/></g>`;
  // sample stations from ward centroid area
  const cen=path.centroid(ward.feature); const inv=proj.invert([cen[0],cen[1]]);
  let st=''; for(let i=0;i<5;i++){ const lon=inv[0]+(i-2)*0.006, lat=inv[1]+((i%2)-0.5)*0.01;
    const px=proj([lon,lat]); const x=px[0]*fr.k+fr.x,y=px[1]*fr.k+fr.y;
    st+=`<g transform="translate(${x} ${y})"><circle r="9" fill="#fff" opacity="0.22" filter="url(#g)"/><circle r="3.6" fill="#fff" stroke="rgba(27,60,83,0.6)" stroke-width="0.6"/></g>`; }
  writeFileSync('preview/nishiku.svg', wrap(base+st,
    `<text x="60" y="64" fill="#eaf1f6" font-family="sans-serif" font-size="13" letter-spacing="3">… › 大阪市 › 西区</text>
     <text x="${W/2}" y="${H-54}" fill="#9fb6c6" font-family="sans-serif" font-size="13" letter-spacing="3" text-anchor="middle">LONG-PRESS TO DROP A SPOT · TAP A STATION FOR LINES</text>`)); }

console.log('wrote osaka-cities / osaka-wards / nishiku');
