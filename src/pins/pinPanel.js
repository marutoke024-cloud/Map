// The slide-in detail panel used to create and edit a pin.

import { addPin, updatePin, deletePin } from './pinStore.js';
import { resolveByUrl, searchByKeyword, scrapeShopPage } from '../integrations/hotpepper.js';
import { PREFECTURES } from '../config.js';

const CATEGORIES = ['Restaurant', 'Cafe', 'Bar', 'Ramen', 'Sushi', 'Sweets', 'Other'];

let el;
let onSavedCb, onDeletedCb, onCloseCb, locateCb;

export function initPanel(panelEl, { onSaved, onDeleted, onClose, locate }) {
  el = panelEl;
  onSavedCb = onSaved;
  onDeletedCb = onDeleted;
  onCloseCb = onClose;
  locateCb = locate;
}

function esc(s = '') {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Open the panel.
 * @param {object} pin  existing pin OR a draft {prefKey, lon, lat} for new pins.
 * @param {boolean} isNew
 */
export function openPanel(pin, isNew) {
  const draft = { category: 'Restaurant', locked: false, ...pin };
  const prefName = PREFECTURES[draft.prefKey]?.ja || '';

  el.hidden = false;
  el.classList.remove('closing');
  el.innerHTML = `
    <div class="panel-grip"></div>
    <button class="panel-close" aria-label="Close">×</button>
    <div class="panel-eyebrow">${isNew ? 'NEW SPOT' : 'EDIT SPOT'} · <span>${esc(prefName)}</span></div>

    <div class="hp-block">
      <label class="field-label">HotPepper Gourmet</label>
      <div class="hp-row">
        <input class="input" id="hp-url" placeholder="Paste shop URL or keyword…" />
        <button class="btn btn-ghost" id="hp-go">Fetch</button>
      </div>
      <div class="hp-status" id="hp-status"></div>
      <div class="hp-results" id="hp-results"></div>
      <div class="hp-gallery" id="hp-gallery"></div>
    </div>

    <label class="field-label">Name 店名</label>
    <input class="input" id="f-name" value="${esc(draft.name || '')}" placeholder="お店の名前" />

    <label class="field-label">Category</label>
    <div class="chips" id="f-cat">
      ${CATEGORIES.map((c) => `<button class="chip ${draft.category === c ? 'on' : ''}" data-c="${c}">${c}</button>`).join('')}
    </div>

    <div class="grid-2">
      <div>
        <label class="field-label">Budget 予算</label>
        <input class="input" id="f-budget" value="${esc(draft.budget || '')}" placeholder="¥2,000" />
      </div>
      <div>
        <label class="field-label">Nearest station 最寄り駅</label>
        <input class="input" id="f-station" value="${esc(draft.station || '')}" placeholder="◯◯駅" />
      </div>
    </div>

    <div class="grid-2">
      <div>
        <label class="field-label">Private room 個室</label>
        <select class="input" id="f-private">
          <option value=""${!draft.privateRoom ? ' selected' : ''}>—</option>
          <option value="あり"${draft.privateRoom === 'あり' ? ' selected' : ''}>あり</option>
          <option value="なし"${draft.privateRoom === 'なし' ? ' selected' : ''}>なし</option>
        </select>
      </div>
      <div>
        <label class="field-label">Seats 席数</label>
        <input class="input" id="f-capacity" value="${esc(draft.capacity || '')}" placeholder="40" inputmode="numeric" />
      </div>
    </div>

    <label class="field-label">Address 住所</label>
    <input class="input" id="f-address" value="${esc(draft.address || '')}" placeholder="住所" />

    <label class="field-label">Memo</label>
    <textarea class="input textarea" id="f-memo" placeholder="メモ・感想">${esc(draft.memo || '')}</textarea>

    <label class="field-label">Photo</label>
    <div class="photo-row">
      <label class="btn btn-ghost">Upload<input type="file" id="f-photo" accept="image/*" hidden /></label>
      <div class="photo-preview" id="photo-preview">${draft.photo ? `<img src="${esc(draft.photo)}" />` : ''}</div>
    </div>

    <button class="lock-toggle ${draft.locked ? 'on' : ''}" id="f-lock">
      <span class="lock-ico"></span>
      <span class="lock-text">${draft.locked ? 'Locked · private only' : 'Public spot'}</span>
    </button>

    <div class="panel-actions">
      ${isNew ? '' : '<button class="btn btn-danger" id="f-delete">Delete</button>'}
      <button class="btn btn-primary" id="f-save">${isNew ? 'Add spot' : 'Save'}</button>
    </div>
    <div class="credit">Powered by ホットペッパー Webサービス</div>
  `;

  // ----- wiring -----
  const $ = (s) => el.querySelector(s);
  let state = { ...draft };

  const close = () => closePanel();
  $('.panel-close').onclick = close;

  $('#f-cat').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.category = b.dataset.c;
    $('#f-cat').querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
  };

  $('#f-lock').onclick = () => {
    state.locked = !state.locked;
    $('#f-lock').classList.toggle('on', state.locked);
    $('#f-lock .lock-text').textContent = state.locked ? 'Locked · private only' : 'Public spot';
  };

  $('#f-photo').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      state.photo = r.result;
      $('#photo-preview').innerHTML = `<img src="${state.photo}" />`;
    };
    r.readAsDataURL(file);
  };

  // HotPepper fetch
  $('#hp-go').onclick = async () => {
    const q = $('#hp-url').value.trim();
    if (!q) return;
    const status = $('#hp-status');
    const results = $('#hp-results');
    results.innerHTML = '';
    status.textContent = 'Searching…';
    status.className = 'hp-status loading';
    try {
      if (/hotpepper\.jp/i.test(q) || /strJ/i.test(q)) {
        const shop = await resolveByUrl(q);
        applyShop(shop);
        status.textContent = `Loaded: ${shop.name}`;
        status.className = 'hp-status ok';
        enrichFromPage(shop.url || q, status);
      } else {
        const shops = await searchByKeyword(q);
        status.textContent = shops.length ? `${shops.length} results — pick one` : 'No results';
        status.className = 'hp-status ' + (shops.length ? 'ok' : '');
        results.innerHTML = shops
          .map(
            (s, i) => `<button class="hp-card" data-i="${i}">
              ${s.photo ? `<img src="${esc(s.photo)}" />` : '<div class="hp-noimg"></div>'}
              <div><strong>${esc(s.name)}</strong><span>${esc(s.category)} · ${esc(s.budget)}</span><span>${esc(s.address)}</span></div>
            </button>`,
          )
          .join('');
        results.querySelectorAll('.hp-card').forEach((c) =>
          c.addEventListener('click', () => {
            const shop = shops[+c.dataset.i];
            applyShop(shop);
            status.textContent = `Loaded: ${shop.name}`;
            results.innerHTML = '';
            enrichFromPage(shop.url, status);
          }),
        );
      }
    } catch (err) {
      status.textContent = '⚠ ' + err.message;
      status.className = 'hp-status err';
    }
  };

  function appendMemo(line) {
    state.memo = state.memo ? `${state.memo}\n${line}` : line;
    if ($('#f-memo')) $('#f-memo').value = state.memo;
  }

  // Pull the per-seat list (お席) + interior photos from the shop web page
  // (not available via the official API) and let the user pick a photo.
  async function enrichFromPage(url, status) {
    if (!url) return;
    const gal = $('#hp-gallery');
    if (gal) gal.innerHTML = '<span class="hp-galmsg">店内写真・席情報を取得中…</span>';
    const { photos, seats } = await scrapeShopPage(url);
    if (seats) appendMemo(`【お席】 ${seats}`);
    if (gal) {
      if (photos.length) {
        gal.innerHTML =
          '<span class="hp-galmsg">店内写真を選択（雰囲気重視）</span>' +
          photos.map((src) => `<button class="hp-thumb" data-src="${esc(src)}"><img src="${esc(src)}" loading="lazy" /></button>`).join('');
        gal.querySelectorAll('.hp-thumb').forEach((b) =>
          b.addEventListener('click', () => {
            state.photo = b.dataset.src;
            $('#photo-preview').innerHTML = `<img src="${esc(state.photo)}" />`;
            gal.querySelectorAll('.hp-thumb').forEach((x) => x.classList.toggle('on', x === b));
          }),
        );
      } else {
        gal.innerHTML = '<span class="hp-galmsg">店内写真は取得できませんでした（ページ非対応の可能性）</span>';
      }
    }
  }

  function applyShop(shop) {
    state.name = shop.name;
    state.address = shop.address;
    state.budget = shop.budget;
    state.station = shop.station || state.station;
    state.privateRoom = shop.privateRoom || state.privateRoom;
    state.capacity = shop.capacity || state.capacity;
    state.hotpepperId = shop.id;
    state.hotpepperUrl = shop.url;
    if (shop.category && !CATEGORIES.includes(state.category)) state.category = 'Restaurant';
    if (shop.photo) {
      state.photo = shop.photo;
      $('#photo-preview').innerHTML = `<img src="${esc(shop.photo)}" />`;
    }

    // Place the pin at the shop's real coordinates and resolve which area it sits in
    if (shop.lat && shop.lng) {
      state.lat = +shop.lat;
      state.lon = +shop.lng;
      const loc = locateCb?.(state.lon, state.lat);
      if (loc && loc.prefKey) {
        state.prefKey = loc.prefKey;
        state.cityKey = loc.cityKey;
        state.wardKey = loc.wardKey;
      }
    }

    // Critical reservation info (個室 / 半個室・貸切 / 喫煙) into the memo
    const info = [];
    if (shop.privateRoom) info.push(`個室:${shop.privateRoom}`);
    if (shop.charter) info.push(`貸切:${shop.charter}`);
    if (shop.nonSmoking) info.push(`喫煙:${shop.nonSmoking}`);
    if (info.length) appendMemo('【ホットペッパー】 ' + info.join(' / '));

    $('#f-name').value = shop.name || '';
    $('#f-address').value = shop.address || '';
    $('#f-budget').value = shop.budget || '';
    if ($('#f-station')) $('#f-station').value = state.station || '';
    if ($('#f-private')) $('#f-private').value = state.privateRoom || '';
    if ($('#f-capacity')) $('#f-capacity').value = state.capacity || '';
  }

  $('#f-save').onclick = async () => {
    state.name = $('#f-name').value.trim() || 'Untitled';
    state.budget = $('#f-budget').value.trim();
    state.address = $('#f-address').value.trim();
    state.station = $('#f-station').value.trim();
    state.privateRoom = $('#f-private').value;
    state.capacity = $('#f-capacity').value.trim();
    state.memo = $('#f-memo').value.trim();
    $('#f-save').disabled = true;
    $('#f-save').textContent = 'Saving…';
    let saved;
    if (isNew) {
      saved = await addPin({
        prefKey: state.prefKey,
        cityKey: state.cityKey || null,
        wardKey: state.wardKey || null,
        lon: state.lon,
        lat: state.lat,
        name: state.name,
        category: state.category,
        memo: state.memo,
        budget: state.budget,
        station: state.station || '',
        privateRoom: state.privateRoom || '',
        capacity: state.capacity || '',
        address: state.address,
        photo: state.photo || null,
        hotpepperId: state.hotpepperId || null,
        hotpepperUrl: state.hotpepperUrl || null,
        locked: state.locked,
      });
    } else {
      const patch = {
        name: state.name,
        category: state.category,
        memo: state.memo,
        budget: state.budget,
        station: state.station || '',
        privateRoom: state.privateRoom || '',
        capacity: state.capacity || '',
        address: state.address,
        photo: state.photo || null,
        hotpepperId: state.hotpepperId || null,
        hotpepperUrl: state.hotpepperUrl || null,
        locked: state.locked,
      };
      await updatePin(state.id, patch);
      saved = { ...state, ...patch };
    }
    onSavedCb?.(saved, isNew);
    closePanel();
  };

  const del = $('#f-delete');
  if (del)
    del.onclick = async () => {
      await deletePin(state.id);
      onDeletedCb?.(state.id);
      closePanel();
    };

  requestAnimationFrame(() => el.classList.add('open'));
}

export function closePanel() {
  if (!el || el.hidden) return;
  el.classList.remove('open');
  el.classList.add('closing');
  onCloseCb?.();
  setTimeout(() => {
    el.hidden = true;
    el.classList.remove('closing');
    el.innerHTML = '';
  }, 360);
}
