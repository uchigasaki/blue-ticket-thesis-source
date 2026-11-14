# 1週間後のみのGoogle Forms接続

`FormsProduction.gs` は1週間後だけをGoogle Formsへ接続するモジュールです。事前・事後のWeb収集と、確認用の既存6下書きは変更しません。新しい日英2フォームを別に作り、最初は未公開・回答不可にします。

今回の利用方針は「1週間後だけGoogle Forms」。予備調査については、利用者本人から実施済み・概ね良好との申告があります。ここで架空の実施日・対象人数・詳細結果は作成しません。本モジュールのテスト成功は研究レビューの承認を意味せず、版に結び付いた承認設定は `Production.gs` の `btsProductionSettings_` が毎回検証します。

10月2日時点：本人採用記録を対象版・内容hashへ結び付け、9月29日に本番日英2フォームを公開し、提出トリガー2つを設置済みです。10月2日18:34台の読み取り確認でも日英Forms ready・HTTP/メール有効・合計3トリガーを確認しました。以下は初回設置と呼び出し契約の説明で、稼働中のフォームを準備関数で作り直す手順ではありません。Forms実提出から研究サーバー取込までの完全な本番E2Eは未確認です。

## 同一Apps Scriptプロジェクトへ置くファイル

`Code.gs`、`Production.gs`、`Forms.gs`、`FormsResponseCore.gs`、`FormsProduction.gs` を同一の本番用プロジェクトへ設置します。メールは別の `ProductionEmail.gs` が担当します。Apps Scriptの同じ `ScriptLock` を使い、既存Web追跡調査とFormsが同時に完了しないようにします。

このファイルを読み込むだけでは、フォーム作成・公開・トリガー作成・メール送信は実行しません。フォームの作成・公開・提出のAPIはGoogleの [Formリファレンス](https://developers.google.com/apps-script/reference/forms/form)、回答の取得・事前入力は [FormResponseリファレンス](https://developers.google.com/apps-script/reference/forms/form-response)、トリガーの認証情報は [イベントオブジェクト仕様](https://developers.google.com/apps-script/guides/triggers/events) に沿っています。

## 明示的な設置操作

固定の版・Sheet・hash・URL・secret設定と本番Sheetのヘッダー設置を済ませてから、次の関数を研究用Googleアカウントで明示的に実行します。追加スコープの認可はそのGoogleアカウントの操作です。

1. `createBtsProductionFollowupForms()` — 新しい日英2フォーム、非公開の資格・回答・隔離用Sheetを作成します。この準備操作だけは `btsProductionPreparationSettings_()` を使い、HTTP無効・本番有効化false・メールfalseが必須です。研究レビュー・募集期間・定員の未入力は準備に限り許容します。フォームは未公開・回答不可の状態です。既存の本番対象フォームが公開/受付中なら準備を拒否します。途中まで作成された登録情報を検知した場合、自動で別フォームを増やさず停止します。担当者が既存の作成途中フォームを確認する必要があります。
2. `installBtsProductionFormsTriggers()` — 研究レビューと募集設定を含む本番guardを通過した後、各新フォームに `onBtsProductionFormSubmit` のインストール型「フォーム送信時」トリガーを1つずつ設置します。メール用・時刻用トリガーは作りません。
3. `publishBtsProductionFollowupForms()` — 設定、版、日英双方、フォームの内容・非公開回答設定、登録済みトリガーを再検証して公開・受付を開始します。検証または公開が失敗すると、この呼出しで確認済みのフォームを閉じる処理を試み、エラーを返します。

上記3操作の初回実行・公開は9月29日に完了済みです。関数が実装されていること、Google上で実行したこと、実回答を取り込んだことは区別し、実際の結果は [TEST_RESULTS.md](TEST_RESULTS.md) に記録します。これら3操作自体はメールを送りません。

`btsFormsProductionReadiness_(now)` はメール送信前の読み取り専用確認です。公開中の日英フォームと実トリガーを検証し、`{ready:true,languages:['ja','en'],measurement_mode:'forms'}` のみを返します。資格発行・URL生成・シート書込みはしません。

## 専用リンクと資格

元Web tokenの認証と期限状態の確認後、1週間後の予定時刻に達した場合だけ、Webアダプターが次の関数を呼び出します。

```js
btsFormsFollowupLink_(spreadsheet, followupRecord, language, now)
// {measurement_mode:'forms', form_url, form_id, language, expires_at}
```

この関数自身が `ScriptLock` を取得します。呼出し側はlockを保持したまま呼ばないでください。保存済みのFollowUp・Participants・Assignmentsを再読込し、参加者、割付、店舗、条件、session、親submission、教材版、instrument版/hashが一致することを確認します。期限前・期限切れ・完了済み・別回答が処理中なら資格を発行しません。

Forms用の資格は、元Web tokenから独立したHMAC値です。資格ID・発行時刻・親行のidentity・followup時点・言語・form ID・instrument版/hash/digest・設問定義hash・内容hash・開始期限・失効期限に結び付きます。スクリプトプロパティ `BTS_FORMS_QUALIFICATION_SECRET` は作成時に生成され、フォームにもシートにもログにも返しません。資格の生値を保存する代わりにhashと結合情報を保存します。同じ有効なリンクを再表示すると同じ資格を再生成します。

事前入力URLにはForms用資格と研究参加者IDが含まれます。元Web tokenは含めません。リンクは個人用であり、共有用URLや分析エクスポートへ転記しません。Google Formsに隠しフィールドはないため、資格欄は見えますが、変更・他フォームへの転用・再使用をサーバーで拒否します。参加者IDの手入力だけでは資格を得られません。

## 提出の検証・保存

`onBtsProductionFormSubmit(e)` はインストール型フォームトリガー専用です。Sheetの `namedValues` イベントやHTTPで送った回答JSONは受け取りません。GoogleのFULL認証モード、登録trigger UID、実source form ID、response ID、timestampを確認し、登録フォームからresponseを再取得します。

フォームの署名はitem ID・型・題名・説明・必須・選択肢・scale・画像byte hash・幅等を固定します。元の不変定義のdigestとWeb用instrument hashも再計算し、登録情報との一致を確認します。Formsに採点キーは設定しません。サーバー専用の4正答キーは実instrumentと一致するhash検査およびテストで管理します。

資格の生値を取り除いた回答だけを `normalizeFormsResponse_` へ渡します。正規化後に同じproject lock内でFollowUpの `response_submission_id` を予約し、別回答の割込みを拒否します。保存キーは `forms_` に `SHA-256(formId + '|' + responseId)` を付けた値で、同じGoogle回答の再実行は冪等です。保存途中に失敗した場合、同じイベントを再処理すれば予約と部分保存を継続します。別回答で処理中の予約を解除しません。資格の消費は検証済み回答の保存が完了したときだけです。

回答者の送信が資格発行後・回答開始時刻以降・失効時刻以前であることをGoogle timestampで検証します。取込時刻は別に保存するため、正規の送信後にGoogleトリガーが遅れて実行された場合は、送信時刻に基づいて判定できます。ただし現在の本番設定、版、親行、フォーム署名も一致する必要があります。

| 保存先 | 保存する内容 |
| --- | --- |
| `FormsQualifications` | 資格ID、hash、結合情報、発行・失効時刻、issued/processing/consumed、receipt key。生資格なし。 |
| `FormsResponses` | Google回答IDと送信時刻、取込時刻、親・割付・言語・版、payload hash、秘密を除いた正規化JSON。 |
| `FormsQuarantine` | hashから作ったreceipt key、取込時刻、固定の拒否理由だけ。回答本文・メール・資格・URL・stackなし。 |
| 既存 `FollowUp` | shared completion/status、分析用answers、受付時刻、言語、payload hash。 |
| 既存 `SubmissionReceipts` | `event_type:'followup'` の処理中/完了receipt。既存Webとの重複防止に使う。 |

`measurement_mode:'forms'` を保持し、開始時刻・各項目時刻・dwell・変更回数はnull、質問ログは空配列です。既存 `QuestionLogs` には架空の計測を作りません。既存FollowUpの開始時刻列は空欄にします。参加者行も追加しません。

## 生回答のアクセスと運用

生資格はGoogle Forms自身の提出記録には残ります。このモジュールは、そのフォームファイルのDrive共有がPRIVATEで、所有者以外のeditor/viewerがなく、回答先Spreadsheetが未設定であることを毎回検証します。メール収集、回答編集、再回答リンク、回答集計の公開、クイズ、1人1回のGoogleログイン制限、設問シャッフルを禁止します。回答者の公開範囲と編集者の共有設定は別なので、Google上で公開後の回答者アクセスも確認してください。

生Forms回答をCSV・共有Sheetへ出力しないでください。分析には `FormsResponses.normalized_json` の固定出力契約を使います。資格欄を含む生回答の保持期限・削除は研究側の運用決定であり、ここでは自動削除しません。

途中で版や登録フォームを変更すると、旧資格・旧フォーム提出は拒否されます。フォームやSheetの手修正、スクリプトsecretの変更、トリガー削除も接続を壊すため、変更前に回収を停止して対象データと保留回答を確認してください。失敗イベントを復旧する際も、資格の値をログへ表示せず、固定receipt keyで追跡します。

## ローカル検証

```powershell
& '（ローカルの作業フォルダー）
```

テストは実instrumentと既存GAS/Forms mockを読みます。本番と準備の設定guardだけは明示的な別stubなので、このテストは承認記録の作成や検証済み扱いをしません。日英正常回答、下書き隔離、初期非公開、準備と稼働の分離、明示公開、トリガー、独立資格、親・版・言語・フォームの不一致、期限、未計測null、二重回答・編集回答・中断復旧・秘密非流出を検証します。実Googleでの提出・認可・メール送信は行いません。
