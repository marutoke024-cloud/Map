// Conversational spot search powered by the Gemini API.
//
// The user talks to it naturally ("個室があって予算3000円くらいの和食") and it
// picks matching spots from the pins already registered in the app. The API key
// is stored client-side (Settings) and the call goes straight to the Gemini
// REST endpoint (API-key requests are CORS-enabled).

export const ai = {
  get key() {
    return localStorage.getItem('spots.gemini.key') || '';
  },
  set key(v) {
    localStorage.setItem('spots.gemini.key', v || '');
  },
  get model() {
    return localStorage.getItem('spots.gemini.model') || 'gemini-2.0-flash';
  },
  set model(v) {
    localStorage.setItem('spots.gemini.model', v || '');
  },
};

export const hasGemini = () => Boolean(ai.key);

function slim(pins) {
  return pins.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    budget: p.budget,
    station: p.station,
    privateRoom: p.privateRoom,
    capacity: p.capacity,
    memo: p.memo,
    address: p.address,
  }));
}

const SYSTEM = `あなたは飲食店レコメンドのアシスタントです。
ユーザーの希望条件に合う店を、提供された「登録ピン一覧」の中だけから選びます。
一覧に無い店は決して作らないこと。
出力は厳密なJSONのみ: {"ids": ["選んだピンのid", ...], "reply": "日本語で一言コメント"}。
合致が無ければ ids は空配列にし、reply でその旨を伝えること。`;

function parseReply(data) {
  const txt = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  let parsed;
  try {
    parsed = JSON.parse(txt);
  } catch {
    const m = txt.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : { ids: [], reply: txt };
  }
  return { ids: Array.isArray(parsed.ids) ? parsed.ids : [], reply: parsed.reply || '' };
}

export async function aiSelectPins(query, pins) {
  const key = ai.key.trim();
  if (!key) throw new Error('Gemini APIキーを設定してください（SETTINGS）');
  if (!pins.length) return { ids: [], reply: 'まだ登録されたスポットがありません。' };

  const body = {
    contents: [
      { role: 'user', parts: [{ text: `${SYSTEM}\n\n# 登録ピン一覧\n${JSON.stringify(slim(pins))}\n\n# ユーザーの希望\n${query}` }] },
    ],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  };

  // Try the configured model first, then known-good fallbacks (model names drift
  // between API versions, which is the usual cause of a "model not found" error).
  const models = [...new Set([ai.model.trim(), 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-1.5-flash'].filter(Boolean))];
  let lastErr = '';
  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) {
      lastErr = 'ネットワークエラー: ' + e.message;
      continue;
    }
    if (res.ok) {
      if (model !== ai.model) ai.model = model; // remember the one that worked
      return parseReply(await res.json());
    }
    const t = await res.text().catch(() => '');
    lastErr = `${res.status} ${t.slice(0, 160)}`;
    // 400/404 → likely bad model name, try next. 403/401 → key problem, stop.
    if (res.status === 401 || res.status === 403) {
      throw new Error(`APIキーが拒否されました (${res.status})。キーや利用制限を確認してください。`);
    }
  }
  throw new Error(`Gemini 呼び出しに失敗しました。${lastErr}`);
}
