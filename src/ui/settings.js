// Settings panel: configure the HotPepper Gourmet API (client-side).
import { gsap } from 'gsap';
import { settings } from '../integrations/hotpepper.js';
import { ai } from '../integrations/ai.js';

let el;

export function initSettings(panelEl) {
  el = panelEl;
}

function esc(s = '') {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function openSettings() {
  el.hidden = false;
  el.classList.remove('closing');
  el.innerHTML = `
    <button class="panel-close" aria-label="Close">×</button>
    <div class="panel-eyebrow">SETTINGS</div>
    <h2 class="settings-title">ホットペッパーグルメ API</h2>
    <p class="settings-note">
      リクルートWEBサービスで取得した API キーを入力すると、店舗URL・キーワードから
      自動入力できます。キーはこの端末（localStorage）にのみ保存されます。
      <a href="https://webservice.recruit.co.jp/" target="_blank" rel="noopener">無料登録はこちら →</a>
    </p>

    <label class="field-label">API Key</label>
    <input class="input" id="set-key" value="${esc(settings.key)}" placeholder="xxxxxxxxxxxxxxxx" />

    <label class="field-label">CORS Proxy <span class="muted">(静的サイト用)</span></label>
    <input class="input" id="set-proxy" value="${esc(settings.proxy)}" placeholder="https://corsproxy.io/?url=" />
    <p class="settings-note small">
      公式APIはブラウザから直接呼べない（CORS非対応）ため、プロキシ経由で取得します。
      末尾に対象URLを付加する形式（例: <code>https://corsproxy.io/?url=</code>）。
      自前のサーバーレス関数を用意した場合はそのURLに置き換えてください。
    </p>

    <h2 class="settings-title" style="margin-top:26px">AI スマート検索 (Gemini)</h2>
    <p class="settings-note">
      Gemini の API キーを入れると、検索バーに話しかけるだけで登録済みスポットから
      条件に合う店を選んでくれます（例：「個室があって予算3000円くらいの和食」）。
      キーはこの端末にのみ保存されます。
      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">APIキー取得 →</a>
    </p>
    <label class="field-label">Gemini API Key</label>
    <input class="input" id="set-gkey" value="${esc(ai.key)}" placeholder="AIza…" />
    <label class="field-label">Model</label>
    <input class="input" id="set-gmodel" value="${esc(ai.model)}" placeholder="gemini-2.0-flash" />

    <div class="panel-actions">
      <button class="btn btn-ghost" id="set-clear">Clear</button>
      <button class="btn btn-primary" id="set-save">Save</button>
    </div>
    <div class="credit">Powered by ホットペッパー Webサービス・Google Gemini</div>
  `;

  const $ = (s) => el.querySelector(s);
  $('.panel-close').onclick = closeSettings;
  $('#set-save').onclick = () => {
    settings.key = $('#set-key').value.trim();
    settings.proxy = $('#set-proxy').value.trim();
    ai.key = $('#set-gkey').value.trim();
    ai.model = $('#set-gmodel').value.trim();
    const btn = $('#set-save');
    btn.textContent = 'Saved ✓';
    setTimeout(closeSettings, 600);
  };
  $('#set-clear').onclick = () => {
    settings.key = '';
    ai.key = '';
    $('#set-key').value = '';
    $('#set-gkey').value = '';
  };

  requestAnimationFrame(() => el.classList.add('open'));
}

export function closeSettings() {
  if (!el || el.hidden) return;
  el.classList.remove('open');
  el.classList.add('closing');
  setTimeout(() => {
    el.hidden = true;
    el.classList.remove('closing');
    el.innerHTML = '';
  }, 360);
}
