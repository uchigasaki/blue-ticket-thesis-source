# 後期3群比較の教材と記録処理

2026年9月29日公開時のWebコードは [versions/2026-09-29](versions/2026-09-29)（原版コミット `e91008a671d7a129d1d8f560dd4dc437b59f4455`）に，10月2日の接続改訂は [versions/2026-10-02](versions/2026-10-02)（`81c61aaf24568bd333abf1f11af64955defa1827`）に収録しています。この階層のWebコードは10月10日の事後画像改訂（`40d592f4edd26d5e816a49c1abccb7db28107bf5`）を含む開発用ソースに基づきます。調査用の送信先・公開先設定・連絡用メールを空欄またはダミーに置き換えています。設問・正答・学習画像・事後画像の内容は同じです。版の説明は教材・配布物の履歴を示します。

- `data.js`，`common-corrections.js`，`condition-overlays.js`，`evaluation-data.js` は問題，共通の内容訂正，群別の提示，評価項目を定義します。
- `app.js`，`experiment-context.js`，`followup-app.js` は画面，割付の取得，追跡画面を実装します。
- [gas](gas) はGoogle Apps Scriptの割付，回答記録，追跡フォームの照合，通知，運用補助のコードです。Googleへの配備をしなくてもコードを読めます。
- [scripts](scripts) は確認用サイト，フォーム，設置資料などの生成処理です。[tests](tests) の多くはNode.jsと合成テストデータで動作します。画像改訂専用の `run-production-post-image-revision-tests.js` は旧配備時の運用ファイルを参照するため，公開資料のみでは実行できません。
- `baseline-original` は前期内容を照合するためのコピーです。原版ハッシュは `baseline-manifest.original.json`，公開用設定に置き換えた後のハッシュは `baseline-manifest.json` にあります。

## 手元での確認

このフォルダーで `python -m http.server 8000 --bind 127.0.0.1` を実行し，次のURLを開きます。調査参加や提出には使わず，架空の参加者IDを入力してください。追跡フォームへの実送信やメール配信は行いません。

- A群の文章による提示 — `http://localhost:8000/?store=A&condition=no_image`
- B群の画像あり基準教材 — `http://localhost:8000/?store=A&condition=original`
- C群の画像と追加解説 — `http://localhost:8000/?store=A&condition=improved`

実装の確認には Node.js 22 で `node tests/run-tests.js` や `node tests/run-gas-mock-tests.js` を実行できます。
