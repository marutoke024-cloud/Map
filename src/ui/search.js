// Top-bar search. Two ways to narrow down recorded spots:
//   1. Structured/quick filters — focus shows suggestion chips (最寄り駅 / 店名 /
//      カテゴリ / 個室 / 席数 / 予算) that insert query tokens; live filtering.
//   2. Conversational AI (Gemini) — press Enter to ask in plain language
//      ("個室があって予算3000円くらいの和食") and it picks from your pins.
import { PREFECTURES } from '../config.js';
import { hasGemini, aiSelectPins } from '../integrations/ai.js';

let inputEl, clearEl, resultsEl, getPins, onPick, privateRef;

const CHIPS = [
  { label: '最寄り駅', token: '駅:' },
  { label: '店名', token: '店名:' },
  { label: 'カテゴリ', token: 'カテゴリ:' },
  { label: '個室', token: '個室 ' },
  { label: '席数', token: '席数>' },
  { label: '予算', token: '予算<' },
];

export function initSearch(refs) {
  ({ inputEl, clearEl, resultsEl, getPins, onPick, privateRef } = refs);
  inputEl.addEventListener('input', run);
  inputEl.addEventListener('focus', run);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (hasGemini() && inputEl.value.trim()) runAI();
    }
  });
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
  return [p.name, p.category, p.memo, p.address, p.budget, p.station, p.privateRoom, p.capacity, PREFECTURES[p.prefKey]?.ja]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

// Structured token filter. Supports field tokens plus free text.
function filter(pins, q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  return pins.filter((p) => {
    return tokens.every((t) => {
      let m;
      if ((m = t.match(/^予算[<≤]?(\d{2,6})/)) || (m = t.match(/^[<≤](\d{2,6})$/))) {
        const n = budgetNum(p.budget);
        return n != null && n <= parseInt(m[1], 10);
      }
      if ((m = t.match(/^席数[>≥]?(\d{1,4})/))) {
        const n = budgetNum(p.capacity);
        return n != null && n >= parseInt(m[1], 10);
      }
      if (t === '個室' || t === '個室あり') return p.privateRoom === 'あり';
      if ((m = t.match(/^駅[:：](.+)/))) return (p.station || '').toLowerCase().includes(m[1]) || (p.address || '').toLowerCase().includes(m[1]);
      if ((m = t.match(/^カテゴリ[:：](.+)/))) return (p.category || '').toLowerCase().includes(m[1]);
      if ((m = t.match(/^店名[:：](.+)/))) return (p.name || '').toLowerCase().includes(m[1]);
      return searchableText(p).includes(t);
    });
  });
}

function rowHtml(p) {
  return `<button class="sr-row" data-id="${p.id}">
    <span class="sr-cat">${esc(p.category || '')}</span>
    <span class="sr-name">${p.locked ? '🔒 ' : ''}${esc(p.name)}</span>
    <span class="sr-meta">${esc(p.budget || '')}${p.station ? ' · ' + esc(p.station) : ''}${p.privateRoom === 'あり' ? ' · 個室' : ''}</span>
  </button>`;
}

function bindRows() {
  resultsEl.querySelectorAll('.sr-row').forEach((r) =>
    r.addEventListener('click', () => {
      const pin = getPins().find((p) => p.id === r.dataset.id);
      hide();
      inputEl.blur();
      if (pin) onPick(pin);
    }),
  );
}

function run() {
  positionResults();
  const q = inputEl.value.trim();
  clearEl.hidden = !q;
  const pins = getPins().filter((p) => privateRef() || !p.locked);

  if (!q) {
    // suggestion / hint panel on focus
    resultsEl.innerHTML = `
      <div class="sr-hint">${hasGemini() ? 'AIに話しかけて検索 — Enterで送信（例: 個室があって予算3000円くらいの和食）' : '絞り込みワードを選択（AI検索はSETTINGSでGemini APIキーを設定）'}</div>
      <div class="sr-chips">${CHIPS.map((c) => `<button class="sr-chip" data-t="${esc(c.token)}">${c.label}</button>`).join('')}</div>`;
    resultsEl.hidden = false;
    resultsEl.querySelectorAll('.sr-chip').forEach((c) =>
      c.addEventListener('click', () => {
        const cur = inputEl.value.replace(/\s*$/, '');
        inputEl.value = (cur ? cur + ' ' : '') + c.dataset.t;
        inputEl.focus();
        run();
      }),
    );
    return;
  }

  const hits = filter(pins, q).slice(0, 30);
  resultsEl.innerHTML =
    (hasGemini() ? `<div class="sr-hint">Enterで AI検索 ✦</div>` : '') +
    (hits.length ? hits.map(rowHtml).join('') : '<div class="sr-empty">No spots match. Enterで AI に聞く ✦</div>');
  resultsEl.hidden = false;
  bindRows();
}

async function runAI() {
  positionResults();
  const q = inputEl.value.trim();
  const pins = getPins().filter((p) => privateRef() || !p.locked);
  resultsEl.innerHTML = '<div class="sr-hint sr-loading">✦ Gemini が選定中…</div>';
  resultsEl.hidden = false;
  try {
    const { ids, reply } = await aiSelectPins(q, pins);
    const byId = new Map(pins.map((p) => [p.id, p]));
    const hits = ids.map((id) => byId.get(id)).filter(Boolean);
    resultsEl.innerHTML =
      `<div class="sr-reply">✦ ${esc(reply || '')}</div>` +
      (hits.length ? hits.map(rowHtml).join('') : '<div class="sr-empty">該当する登録スポットがありませんでした。</div>');
    bindRows();
  } catch (e) {
    resultsEl.innerHTML = `<div class="sr-empty">⚠ ${esc(e.message)}</div>`;
  }
}

function hide() {
  resultsEl.hidden = true;
}

// Anchor the dropdown directly under the search box (it wraps to its own row on
// mobile, so a fixed top would overlap the input and hide typed text).
function positionResults() {
  const bar = inputEl.closest('.searchbar');
  if (!bar) return;
  const r = bar.getBoundingClientRect();
  resultsEl.style.top = `${Math.round(r.bottom + 6)}px`;
  resultsEl.style.left = `${Math.round(r.left)}px`;
  resultsEl.style.width = `${Math.round(r.width)}px`;
  resultsEl.style.transform = 'none';
  resultsEl.style.right = 'auto';
}
