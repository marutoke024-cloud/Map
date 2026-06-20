// Top-bar search: filter recorded spots by free text, category, budget and
// station/area (matched against the spot's address & fields).
import { PREFECTURES } from '../config.js';

let inputEl, clearEl, resultsEl, getPins, onPick, privateRef;

export function initSearch(refs) {
  ({ inputEl, clearEl, resultsEl, getPins, onPick, privateRef } = refs);
  inputEl.addEventListener('input', run);
  inputEl.addEventListener('focus', run);
  clearEl.addEventListener('click', () => {
    inputEl.value = '';
    run();
    inputEl.focus();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.searchbar') && !e.target.closest('.search-results')) hide();
  });
}

function esc(s = '') {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function budgetNum(b = '') {
  const m = String(b).replace(/[,，]/g, '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function searchableText(p) {
  return [p.name, p.category, p.memo, p.address, p.budget, PREFECTURES[p.prefKey]?.ja, p.cityKey, p.wardKey]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function filter(pins, q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  return pins.filter((p) => {
    const hay = searchableText(p);
    return tokens.every((t) => {
      // budget tokens like "<3000" / "3000円以下"
      const lt = t.match(/^[<≤]?(\d{3,6})(円?以下)?$/);
      if (lt) {
        const n = budgetNum(p.budget);
        return n != null && n <= parseInt(lt[1], 10);
      }
      return hay.includes(t);
    });
  });
}

function run() {
  const q = inputEl.value.trim();
  clearEl.hidden = !q;
  if (!q) return hide();
  const pins = getPins().filter((p) => privateRef() || !p.locked);
  const hits = filter(pins, q).slice(0, 30);
  resultsEl.innerHTML = hits.length
    ? hits
        .map(
          (p) => `<button class="sr-row" data-id="${p.id}">
            <span class="sr-cat">${esc(p.category || '')}</span>
            <span class="sr-name">${p.locked ? '🔒 ' : ''}${esc(p.name)}</span>
            <span class="sr-meta">${esc(p.budget || '')} · ${esc(PREFECTURES[p.prefKey]?.ja || '')}${p.cityKey ? ' ' + esc(p.cityKey.split('|')[0]) : ''}</span>
          </button>`,
        )
        .join('')
    : '<div class="sr-empty">No spots match.</div>';
  resultsEl.hidden = false;
  resultsEl.querySelectorAll('.sr-row').forEach((r) =>
    r.addEventListener('click', () => {
      const pin = getPins().find((p) => p.id === r.dataset.id);
      hide();
      inputEl.blur();
      if (pin) onPick(pin);
    }),
  );
}

function hide() {
  resultsEl.hidden = true;
}
