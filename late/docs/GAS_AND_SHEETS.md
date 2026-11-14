# 後期3群比較用 GAS / Google Sheets 運用

更新：2026-10-02。schema `2`、アプリ `2.2.0-review.1`、教材 `2026-late-content-v2`、共通訂正版 `2026-09-common-law-v1`。

前期の稼働中GAS・Sheet・Google Formsへ後期コードを上書きしません。後期専用の非公開SheetとApps Script、新規デプロイを使用します。非公開のリソースID・編集URL・秘密値は公開資料へ載せません。

## 1. 現在の本番状態

9月28日に本人の追加OAuth承認、閉鎖状態での8シート初期化、本番追跡Forms日英2本の未公開作成を完了しました。9月29日には採用記録を内容ハッシュへ結び付け、質問・正答・画像を変えずに閉鎖Formsのメタデータを再結合しました。ローカル本番releaseチェックは合格済みです。

9月29日11時台の実施結果：

| 実施 | 確認した結果 |
| --- | --- |
| GAS version 2の公開と本番設定 | 11:25に公開、11:26に設定、11:27にHTTP有効化 |
| テストメール1通 | 11:26:55に送信成功。本人から受信済みと回答あり |
| 本番Forms日英2本 | 11:29に提出トリガー2つ、11:30に公開 |
| 定期メール | 11:33に2つの送信フラグをON、11:34に毎時トリガー1つを設置 |
| 読み取りreadiness | 11:35:36にHTTP有効・日英Forms ready・メール有効・合計3トリガー |

この9月29日の確認時点は全データ表0件でした。10月2日18:34台の読み取りreadinessでもHTTP・Forms・メール有効、トリガー3つを再確認し、Assignments 3件・他の完了/追跡各表0件でした。公開後に報告された割付エラーへ対応して、10月2日に通信修正版を公開済みです。公開通信確認ページからのGAS到達に加え、本人の通常Chromeで別IDの正常割付・教材到達と、既存IDの `production_session_conflict` 拒否を確認しました。通常完了・追跡Forms実提出・取込までのE2E成功はまだ確認していません。

[後期Pages]([調査用URLは省略] の最新公開commitは `81c61aaf24568bd333abf1f11af64955defa1827`。10月2日変更8ファイルと配布物/Git blobの一致、Pagesデプロイ成功、前期cloneの13ファイルのハッシュ不変を確認しました。ローカル試験・公開・稼働設定・実参加者経路の受入を区別します。

## 2. 採用済みの運用値

- 募集：2026年9月29日〜10月31日（日本時間）。当初10月1日開始の予定を本人の指定で変更しました。目標100人以上、人数上限なし。11月1日0時以降は新規割付を止めます。
- 既存参加者の当日調査完了：11月7日まで。追跡を含む全運用終了：12月15日まで。これらは本人承認済みです。
- 本番Forms日英双方の自動回答受付停止も12月16日0時（日本時間）へ保存・読み戻し確認済みです。サーバーの全運用終了境界と一致します。
- 研究者・確認者：内ヶ崎優斗。公開問い合わせ先：`archive@example.invalid`。
- 連絡先・原回答・分析データはそれぞれ取得日から6か月保存、閲覧・削除担当は本人のみ。期限到来時の手動削除が必要で、自動削除済みとは扱いません。
- 予備調査は本人申告で実施済み・おおむね良好。詳細の再提出は求めず、日英・事後/追跡の統計的等価性は未実証と記録します。

`enrollmentClosesAt` は新規募集の締切、`completionClosesAt` は当日調査の新規完了保存の締切、`closesAt` は追跡・メールも含む全運用終了です。人数上限なしは明示的な設定であり、Googleの実行時間・同時実行・メール割当が無制限になる意味ではありません。

## 3. 本番コードと権限

本番は `Code.gs` に加えて `Production.gs`、`Forms.gs`、`FormsResponseCore.gs`、`FormsProduction.gs`、`ProductionEmail.gs`、`ProductionSetup.gs` を使用します。新本番のmanifestは `gas/appsscript.production.json` に基づき、Sheets/Forms、Driveの共有状態の読み取り、MailApp送信、トリガー操作の権限を本人が承認しています。Gmail受信箱を読む権限ではありません。

検証専用の `gas/appsscript.json` は送信権限なしのまま保全します。`LiveSmoke.gs` は架空データの内部検証専用で、本番bundleへ混ぜません。`prepareBtsProductionWorkspace` は空の新規環境向けの閉鎖初期化です。すでにFormsや回答がある環境を作り直すために実行しません。

主なScript Properties：

| Property | 用途 |
| --- | --- |
| `BTS_SPREADSHEET_ID` | 固定した後期本番の非公開保存先 |
| `BTS_HTTP_MODE` / `BTS_PRODUCTION_ENABLED` | 本番HTTPの明示ゲート。デプロイしただけでは受付ONにならない |
| `BTS_PRODUCTION_CONFIG` | 版・内容hash・公開URL・保存先・運用期間・人数制限 |
| `BTS_PRODUCTION_REVIEW` | 実際の確認者・承認時刻・同じ内容hashに結び付く採用記録 |
| `BTS_PUBLIC_APP_URL` | 後期サイトのHTTPSディレクトリ。末尾 / 必須 |
| `BTS_FOLLOWUP_INSTRUMENT_VERSION` / `BTS_FOLLOWUP_INSTRUMENT_HASH` | 現行追跡評価の版とSHA-256 |
| `BTS_FOLLOWUP_QUESTION_IDS` / `BTS_FOLLOWUP_OPTIONAL_QUESTION_IDS` | 案内を除いた追跡質問IDの順序と任意項目 |
| `BTS_EMAIL_ENABLED` / `BTS_PRODUCTION_EMAIL_APPROVED` | 両方trueの場合だけメール送信 |
| 参加資格・追跡・Forms用の秘密値 | Propertiesだけで非公開管理。公開ソース・画面・ログへ出さない |

実際の設定値は非公開運用記録で管理します。雛形生成は初期値を出すだけで、稼働設定・承認・メール送信を実行するものではありません。発行済み資格がある環境で秘密値や版を無計画に変えません。

## 4. 割付・保存・受領確認

`GET action=assign` はJSONPで、店舗A/B/C、実験・割付版、参加者ID、client run/sessionを照合します。店舗内で割付数の少ない条件へ均衡割付し、同人数候補を決定的なhashで選びます。参加者キーは実験・割付版・店舗・正規化IDに結び付き、一度決まった群を離脱や再送で変えません。

本番はサーバー発行の `participant_token` をassignmentとsessionに結び付けます。通常完了POSTとreceiptはこの資格と親記録を照合します。検証用 `test_access_token` を通常フロントへ埋め込む設計ではありません。schema省略・旧schema 1・未知schemaは本番HTTPで受け付けません。

完了POSTは安定した `submission_id`、実際の割付、同意・言語・版とログの整合性を検証します。`no-cors` POSTが返っただけでは保存成功とせず、`SubmissionReceipts` が `complete` で全識別値が一致することを確認します。同じID・同じ内容の再送は重複保存せず、別内容はconflictです。保存途中の障害からの復旧は同じIDを使います。

Sheetsには表間トランザクションがありません。利用者の回答を削除してエラーを隠したり、再送のたびに新しいIDを付けたりしません。割付エラーの調査でも、稼働中の回答・割付を読み取り確認と区別して保護します。

## 5. Forms専用の1週間後調査

本番の方式は `followupMode: "google_forms"` です。個人用 `followup.html#token=...` で親参加・資格・開始/期限を照合し、検証済みFormsへのリンクだけを返します。追跡のWeb二重収集は行いません。

日英フォームはそれぞれ13項目（参加者ID、案内、画像2、質問8、専用資格）です。Googleフォームではメール収集、クイズ、回答編集、1回制限、シャッフル、回答概要共有、再回答リンクを無効にしています。一般共有の原回答Sheetへは接続せず、原回答と資格を非公開管理します。

提出トリガーは登録form/trigger IDと実responseを検証します。専用資格・親記録・項目・版・期限を確認してから正規化・採点・保存し、未知資格や別responseでの再回答を拒否します。Google送信完了画面と研究側の受理完了は別なので、個人用入口で受理状況を確認します。

各問時間・滞在・変更回数はFormsでは未計測です。`null` と空のWebログを維持し、Google送信時刻と取込時刻を分けます。詳細は [FOLLOWUP.md](FOLLOWUP.md) と [GOOGLE_FORMS_INGESTION.md](GOOGLE_FORMS_INGESTION.md) を参照してください。

## 6. 保存表

| Sheet | 主な内容 |
| --- | --- |
| `Assignments` | assignment、参加者キー、店舗、群、割付時カウント |
| `Participants` / `logs` | 通常完了、同意、得点・回答、版と識別情報 |
| `QuestionLogs` | Webの学習・事前・事後の問題ログと計測 |
| `Contact` / `followup_queue` | 任意の案内宛先、予定時刻、送信状態 |
| `FollowUp` | 親submission、追跡ID・token hash、開始・期限・版・受理状態 |
| `SubmissionReceipts` | 一意な保存確認、結合識別値、payload hash |
| `FormsQualifications` | Forms専用資格のhash、親記録・formとの結合と状態 |
| `FormsResponses` | 受理したFormsの正規化回答・採点・計測欠測 |
| `FormsQuarantine` | 拒否のreceipt key・時刻・固定理由。原回答・資格・メールは複製しない |

ヘッダーの正本はコードです。列名・順序を手作業で変更しません。教材版・共通訂正版・評価版を保持し、訂正前後の同じ問題IDを無条件に同一測定として集計しません。連絡先が存在する全表・原回答・バックアップを保存期限の対象として確認します。

## 7. メール・停止・保守

本番メールは `sendBtsProductionFollowupEmails` の毎時トリガー1つです。フォーム提出の2トリガーと合わせて3つを11:35:36に確認しました。テストメールは1通送信・本人受信確認済みですが、これを全参加者への自動到達保証とは扱いません。

送信前に親完了・同意・宛先一致・追跡期限・Forms readiness・割当を確認し、`sending` をflushしてからMailAppを呼びます。成否不明の `sending` / `send_unknown` は自動再送しません。停止は対応する有効化フラグをOFFにします。既存回答の削除や秘密値の変更を停止操作として使いません。

6か月の保存方針は自動削除機能ではありません。`reportContactRetention` は読み取り診断だけです。研究者が対象・取得日・保存期限・バックアップを確認して手動削除します。メール権限と詳細手順は [PRODUCTION_EMAIL.md](../gas/PRODUCTION_EMAIL.md)、実施証跡は [TEST_RESULTS.md](TEST_RESULTS.md) を参照してください。

## 8. 検証専用モードとの区別

旧検証用の `BTS_HTTP_MODE=test` は、固定した検証Sheet、架空ID allowlist、短時間の期限、非公開の試験資格、メールOFFに限定した別経路です。そこで成功した内部試験を、実参加者の本番HTTP・Forms取込・メール到達の成功へ読み替えません。旧Web追跡やschema 1の互換処理は内部の互換試験用で、本番収集の選択肢ではありません。

本番前後の受入では、公開割付、通常完了、receipt、同一ID再送、追跡資格・期限、Forms実提出と拒否/重複、分析への秘密非混入を確認します。10月2日の公開修正と、本人のChromeで確認したsession競合を区別します。本番E2E未確認は、通信確認や公開済みという理由では解消扱いにしません。
