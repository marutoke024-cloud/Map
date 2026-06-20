// Pure DOM helpers for the heads-up display.
import { gsap } from 'gsap';
import { PREFECTURES } from '../config.js';

const $ = (id) => document.getElementById(id);

export function setBreadcrumb(crumbs, onClick) {
  const nav = $('breadcrumb');
  nav.innerHTML = crumbs
    .map(
      (c, i) =>
        `<button class="crumb ${i === crumbs.length - 1 ? 'current' : ''}" data-key="${c.key}">${c.label}</button>` +
        (i < crumbs.length - 1 ? '<span class="crumb-sep">›</span>' : ''),
    )
    .join('');
  nav.querySelectorAll('.crumb').forEach((b) =>
    b.addEventListener('click', () => onClick(b.dataset.key)),
  );
}

export function showStageTitle(ja, en) {
  const t = $('stage-title');
  t.querySelector('.stage-title-ja').textContent = ja;
  t.querySelector('.stage-title-en').textContent = en;
  gsap.killTweensOf(t);
  gsap.fromTo(
    t,
    { autoAlpha: 0, y: 18, letterSpacing: '0.5em' },
    { autoAlpha: 1, y: 0, letterSpacing: '0.18em', duration: 1.1, ease: 'power3.out' },
  );
  gsap.to(t, { autoAlpha: 0, duration: 0.8, delay: 1.8, ease: 'power2.in' });
}

export function setHint(text) {
  const h = $('hint');
  if (h.textContent === text) return;
  gsap.fromTo(h, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.5 });
  h.textContent = text;
}

export function setScaleLabel(text) {
  $('scale-label').textContent = text;
}

export function setBackVisible(v) {
  $('btn-back').hidden = !v;
}

export function renderDrawer(pins, { privateMode, onSelect, onClose }) {
  const d = $('drawer');
  const visible = pins.filter((p) => privateMode || !p.locked);
  d.innerHTML = `
    <div class="drawer-head">
      <h2>All places <span>${visible.length}</span></h2>
      <button class="panel-close" id="drawer-close">×</button>
    </div>
    <div class="drawer-list">
      ${
        visible.length
          ? visible
              .map(
                (p) => `<button class="place-row" data-id="${p.id}">
                  <span class="place-cat">${p.category || ''}</span>
                  <span class="place-name">${p.locked ? '🔒 ' : ''}${escapeHtml(p.name)}</span>
                  <span class="place-pref">${PREFECTURES[p.prefKey]?.ja || ''}</span>
                </button>`,
              )
              .join('')
          : '<div class="drawer-empty">No spots yet. Zoom into a prefecture and tap the map to add one.</div>'
      }
    </div>`;
  d.hidden = false;
  requestAnimationFrame(() => d.classList.add('open'));
  d.querySelector('#drawer-close').onclick = onClose;
  d.querySelectorAll('.place-row').forEach((r) =>
    r.addEventListener('click', () => onSelect(r.dataset.id)),
  );
}

export function closeDrawer() {
  const d = $('drawer');
  d.classList.remove('open');
  setTimeout(() => (d.hidden = true), 320);
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// --- Station popup -------------------------------------------------------
let stationPopupEl = null;
export function showStationPopup(station, x, y) {
  hideStationPopup();
  const el = document.createElement('div');
  el.className = 'station-popup';
  const lines = (station.lines || []).filter(Boolean);
  el.innerHTML = `
    <div class="sp-name">${escapeHtml(station.name)}<span>駅</span></div>
    ${
      lines.length
        ? `<div class="sp-lines">${lines.map((l) => `<span class="sp-line">${escapeHtml(l)}</span>`).join('')}</div>`
        : '<div class="sp-empty">路線情報なし</div>'
    }`;
  document.getElementById('app').appendChild(el);
  // position, keeping inside viewport
  const px = Math.min(x + 14, window.innerWidth - 240);
  const py = Math.min(y + 14, window.innerHeight - 120);
  el.style.left = px + 'px';
  el.style.top = py + 'px';
  gsap.fromTo(el, { autoAlpha: 0, y: 6, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.3, ease: 'power2.out' });
  stationPopupEl = el;
  setTimeout(() => document.addEventListener('pointerdown', hideStationPopup, { once: true }), 0);
}

export function hideStationPopup() {
  if (stationPopupEl) {
    stationPopupEl.remove();
    stationPopupEl = null;
  }
}
