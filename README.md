# SPOTS — Favorite Places Atlas / お気に入りスポット記録アプリ

地図ベースで「お気に入りの店」を記録するアプリ。日本地図から **地方 → 都道府県** へと
階層的にズームし、選んだエリアの上に自由にピンを立てて店舗情報を記録します。

緯度経度ベースの地図APIではなく、**都道府県ポリゴン（TopoJSON）を投影して描画**し、
GSAP による迫力あるフライ・ズーム演出と擬似3Dの押し出し表現で見せます。

> ビジュアルのプレビュー静止画は `npm run render:still` で `preview/japan.png` /
> `preview/osaka.png` を生成できます（実際の投影・パレットを使用）。

---

## 主な機能（要件対応）

| 要件 | 実装 |
|---|---|
| 階層ナビ（日本 → 近畿/関東 → 府県 → 市/区 → 区） | レベル状態機械 + GSAP フライズーム (`src/main.js`, `src/map/mapRenderer.js`) |
| 図形のみ・ラベル無しの日本地図 | 都道府県 TopoJSON を `d3-geo` で投影、近畿/関東のみ発光・タップ可 |
| 市区町村で区切り・名称表示（大阪市など） | 国土数値情報の市区町村 TopoJSON。政令市は行政区を統合（大阪市＝24区） |
| 政令市 → 行政区（西区など）でさらにズーム | 区タイルにラベル、最深部で駅＋ピン |
| 地図操作 | **ドラッグでパン / ホイールでズーム**、**長押しでピン設置** |
| 駅アイコン（区レベルで初表示） | 発光する白丸。クリックで「何線・何駅」をポップアップ |
| 1段ずつ戻る | BACK ボタン / パンくず / Esc キー |
| ピン設置・詳細パネル | 最深部（区/leaf）で長押し → パネル (`src/pins/pinPanel.js`) |
| 手動入力（店名・カテゴリ・メモ・写真・予算・住所） | パネルのフォーム |
| ホットペッパー連携 | URL から店舗コード抽出 / キーワード検索の両対応 (`src/integrations/hotpepper.js`) |
| 施錠ピン + プライベートモード | ロックトグル + ヘッダーの PRIVATE 切替 |
| 駅情報（OSM / Overpass） | 府県ごとに遅延取得・キャッシュ (`src/stations/stations.js`) |
| カラーパレット | `#1B3C53 / #234C6A / #456882 / #D2C1B6` を CSS 変数で適用 |
| 言語方針 | 地名・駅名は日本語、UI は英語ベース |
| 保存先 Firestore | 設定時は Firestore、未設定時は localStorage フォールバック |

---

## セットアップ

```bash
npm install
cp .env.example .env      # 必要に応じてキーを設定
npm run dev               # http://localhost:5173
```

**キーが無くても動きます** — Firebase 未設定なら localStorage に保存、
ホットペッパー未設定なら連携部分のみ無効化され、それ以外は全て動作します。

### 本番ビルド

```bash
npm run build && npm run preview
```

---

## API キー

### ホットペッパーグルメ（リクルートWEBサービス）
公式 API は CORS 非対応のため、**APIキーはサーバ側で注入**します。
開発時は Vite のミドルウェア (`vite.config.js` の `hotpepperProxy`) が
`/api/hotpepper` を `webservice.recruit.co.jp` へ転送します。

```
HOTPEPPER_API_KEY=xxxxxxxxxxxx   # .env （ブラウザには出ません）
```

- 無料登録: https://webservice.recruit.co.jp/
- クレジット表記「Powered by ホットペッパー Webサービス」をパネルに表示済み（規約準拠）
- 本番では同じ契約の `/api/hotpepper` を **サーバーレス関数**（Vercel/Cloud Functions 等）で
  提供してください（`vite.config.js` のプロキシと同じパラメータ仕様）。

### Firebase（任意）
`.env` に `VITE_FIREBASE_*` を設定すると Firestore の `pins` コレクションに保存します。
Firebase SDK は動的 import なので、未設定時はバンドルにも含まれません。

### OpenStreetMap / Overpass
キー不要。府県を初めて開いた時に鉄道駅を取得し、localStorage に 30 日キャッシュします。
対象は要件どおり大阪・京都・奈良・兵庫・東京・千葉・埼玉・神奈川のみ。

---

## アーキテクチャ

```
src/
  main.js              … コントローラ（ナビ状態機械・各種配線）
  state.js             … 反応的ステート + pub/sub
  config.js            … パレット / 地方・府県定義 / ID マップ
  firebase.js          … Firestore 初期化（動的 import・LS フォールバック）
  map/
    geo.js             … TopoJSON 読込・投影・フレーミング計算
    mapRenderer.js     … SVG レイヤ描画・GSAP フライズーム・擬似3D押し出し
  pins/
    pinStore.js        … ピン永続化（Firestore / localStorage）
    pinPanel.js        … 詳細パネル UI + ホットペッパー連携
  stations/stations.js … Overpass 取得・キャッシュ
  integrations/hotpepper.js … HotPepper クライアント
  ui/hud.js            … パンくず・タイトル・ヒント・一覧ドロワー
public/data/japan.topojson … 都道府県ポリゴン（dataofjapan/land）
scripts/render-still.mjs    … プレビュー静止画(SVG/PNG)生成
```

### 演出のポイント（迫力）
- **フライ・ズーム**: 対象ジオメトリの境界から `{k,x,y}` を算出し GSAP `power3.inOut` で補間。
  ピン・駅マーカーは画面空間オーバーレイで毎フレーム再投影し、サイズを一定に保持。
- **擬似3D押し出し**: アクティブ府県のパスを画面ピクセル一定の深さでオフセット複製し、
  立体ブロックとして描画（下に発光のグラウンドグロー）。
- **雰囲気**: ビネット / フィルムグレイン / スキャンライン / 海面グリッド、府県名の流入タイポ。

---

## データ出典 / クレジット
- 都道府県ポリゴン: [dataofjapan/land](https://github.com/dataofjapan/land)（TopoJSON）
- 駅データ: © OpenStreetMap contributors（Overpass API）
- 店舗情報: Powered by ホットペッパー Webサービス
