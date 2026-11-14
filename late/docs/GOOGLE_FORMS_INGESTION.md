# Google Forms回答取込（本番2フォーム公開済み・実取込E2Eは未確認）

更新：2026-10-02。採用方針は当日の事前・学習・事後をWebで維持し、1週間後だけGoogle Formsで収集する形に決定済みです。本人の予備調査は実施済み・おおむね良好との報告があり、現版を確認済みとして採用する回答も得ています。詳細資料の提出を求めず、予備調査の日時・人数・結果は推定しません。確認者・研究者名「内ヶ崎優斗」は本人指定済みです。本人のチャット承認を対象内容に結び付けて記録し、第三者監修や等価性の実証とは区別します。

`gas/FormsResponseCore.gs` は設問 `sourceId` への対応付け・型・回答・採点を検証する純関数です。このファイル自体はGoogleサービス、シート、PropertiesService、Loggerを使わず、資格検証・公開・保存・メール送信を行いません。

別層の `Production.gs` / `FormsProduction.gs` は、このcoreとWebの親参加記録を結ぶ資格・期限・実フォーム検証・冪等保存を実装しています。9月28日の本人OAuth承認・8シート初期化・本番追跡日英2本の非公開作成に続き、9月29日に採用記録と閉鎖Formsのメタデータを再結合しました。11時台には本番HTTP有効化、Forms2本公開・提出トリガー2つ、毎時メールトリガー1つを設置済みです。公開前のローカル11系列は6,528件成功しました。実リソースIDは非公開運用文書だけで管理し、設定readinessと実回答取込のE2E成功を区別します。

本人承認のテストメール1通は送信成功し、本人から受信済みと回答を得ました。[後期Pages]([調査用URLは省略] は10月2日に通信修正版を公開し、公開通信確認、本人のChromeで別IDの正常割付・教材到達、既存IDの `production_session_conflict` 拒否を確認しました。通常完了から追跡Forms実提出・取込までの本番E2Eは未確認です。募集は本人指定で9月29日〜10月31日・目標100人以上・上限なし、既存参加者の当日完了は11月7日まで、全運用は12月15日まで。本番日英Formsの自動受付停止も12月16日0時（日本時間）へ保存・読み戻し確認済みです。保存は各取得日から6か月、閲覧・手動削除は本人のみです。既存の確認用Forms6本は非公開のまま保全し、本番へ転用しません。

## 追跡専用のサーバー層

1. 個人用 `followup.html#token=...` を開き、GASが既存の親assignment・参加記録・receipt・追跡版・開始/期限を確認します。正常応答は `measurement_mode: "forms"` とし、回答可能な場合だけ検証済み事前入力URLを返します。元のWeb追跡トークンをGoogleフォームへ転送しません。
2. `FormsProduction.gs` は参加者・店舗・条件・assignment・session・追跡ID・言語・form ID・版に結び付く専用資格を発行します。資格のハッシュと状態を非公開 `FormsQualifications` で管理し、手入力IDや書き換え可能なURLだけを本人資格として信用しません。
3. インストール型フォーム提出イベントの登録form ID・trigger ID・権限を照合し、登録フォームから実際のresponseを再取得します。実item ID/型・フォーム構造・版/digest・資格・回答期間を検証してからcoreへ渡します。Spreadsheetの `namedValues` や回答者の任意JSONを直接信用しません。
4. `(form_id, google_response_id)` 由来のreceipt keyとpayload hashを使い、共通ロック下で親 `FollowUp` の回答枠を予約します。同じ内容の再試行は同じ記録を使い、変更済み回答、資格の転用、別responseによる再回答やWebとの競合を拒否します。保存途中の障害は同じIDによる回復対象です。
5. 受理した正規化回答は `FormsResponses`、受理状態は `SubmissionReceipts` と親 `FollowUp` に記録します。拒否時の `FormsQuarantine` はreceipt key・時刻・固定理由コードのみで、原回答・資格・メール・URLを複製しません。

Googleフォームの送信完了画面は研究データへの受理完了を保証しません。取込が受理を確定した後、個人用入口の「受理状況を再確認」でサーバーの `completed` を確認します。フロントは旧Web追跡回答の保存データを送信せず、Formsの各問時刻を作りません。

### 原回答と分析データの区別

Googleフォームの原回答には、照合のために専用資格が含まれます。原回答自体が匿名化済みだとは扱いません。本番フォームには一般共有の原回答Sheetを接続せず、フォームとScript/Sheetの権限を非公開で管理します。資格欄はcoreへ渡す前に分離し、正規化回答・分析出力・ログに含めません。メールアドレスは任意の案内用として別の非公開連絡先記録で管理し、Googleフォームでは収集しません。本人指定の保存方針は連絡先・原回答・分析データそれぞれ取得日から6か月です。原回答内の資格、別表・バックアップも含めた削除手順への反映は別途必要です。

`createBtsProductionFollowupForms` は本番候補の追跡日英2本を新規・非公開・受付停止で準備する明示操作です。9月28日19:07:48〜19:08:27の実行に成功し、19:08:26のログで `status: prepared`、日英とも `published: false`・`reused: false` を確認しました。確認用6本は変更していません。回答トリガーの設置と公開はそれぞれ別関数で、実レビュー・本番設定の検証を通す設計です。9月29日にこれらの明示操作も完了しましたが、フォーム作成・公開の成功だけを実際の回答提出・取込の成功として扱いません。

## 呼び出し契約

```js
var normalized = normalizeFormsResponse_(trusted, event, ingestedAt, answerKeys);
```

すべてプレーンなJavaScript値を渡します。日時は `Date.toISOString()` のUTC形式（例 `2026-09-25T01:00:00.000Z`）に変換済みの文字列にします。関数は入力を変更しません。

| 引数 | 必須内容・取得元 |
| --- | --- |
| `trusted.identity` | サーバーが別層で資格・割付・実施時点を検証して確定した `experiment_id`, `allocation_version`, `assignment_id`, `session_id`, `participant_id_normalized`, `store_id`, `condition`。すべて空でない文字列。`participant_id_normalized` は英大文字4文字＋数字2桁に正規化済みであること。 |
| `trusted.instrument` | サーバーが保持する確定済みの `experimentId`, `instrumentVersion`, `instrumentHash`, `digest`, `phase`, `language`, `items`。`items` は `mergeSurveyItems` による当該時点・言語の統合設問そのもの。 |
| `trusted.registry` | 信頼できるサーバー登録情報。上記6メタデータ、`formId`, `itemMap`。クライアントや回答者から受け取らない。 |
| `event` | 検証済みGoogleフォーム送信イベントから抽出した `formId`, `responseId`, `submittedAt`, `itemResponses`。各回答は `{itemId, type, response}`。 |
| `ingestedAt` | 取込サーバーで独立に取得した時刻。Googleの送信時刻を流用しない。 |
| `answerKeys` | 任意。サーバー側の既存 `EVALUATION_DATA.answerKeys[phase]` を明示的に渡す。省略時は全項目の `is_correct` が `null`。 |

`phase` は `pre`, `post`, `followup`、`language` は `ja`, `en` です。`instrumentHash` と `digest` は小文字64桁のSHA-256参照値です。coreは参照値の形式と登録情報との完全一致を検査しますが、暗号学的な再計算・真正性確認は行いません。定義内容とhash/digestが一致することは、後述のサーバー層で独立に検証する必要があります。Forms生成物の `digest` とWebの追跡調査用 `instrumentHash` は同じ値とは限りません。

`trusted` という引数名や呼び出し成功自体は認証の証拠ではありません。特に、資格を検証せずに `participant_id` を検索し、その結果を `trusted.identity` に入れるだけでは安全な参加者照合になりません。

## Mapと回答の照合

`scripts/build-google-forms.js` の `btsFormsMapRows_` が出力する各行を、サーバー側で次の形へ変換します。列名や設問タイトルから参加者回答を推測することは禁止です。

| 既存Map列 | coreへのフィールド |
| --- | --- |
| `source_id` | `sourceId` |
| `source_type` | `sourceType` |
| `form_item_id` | `itemId`（文字列） |
| `image_item_id` | `imageItemId`（画像なしは空文字・null・省略可） |
| `instrument_digest` | `instrumentDigest` |

`title` は照合キーに使いません。Mapは参加者ID、全設問、notice、各multiの独立した `_other` 項目をちょうど1回ずつ含む必要があります。画像のGoogle item IDも元設問のMap行に必要で、回答項目と画像のIDは全体で重複できません。全行のdigestを検査します。未知source ID、未知item ID、重複回答、余分・欠落したMap、型不一致を拒否します。設問・Map・回答の順番から照合することはありません。

| source型 | Google型 | 検証と出力 |
| --- | --- | --- |
| `single` | `MULTIPLE_CHOICE` | 当該言語の選択肢全文と完全一致する文字列。全文を保持。 |
| `multi` | `CHECKBOX` | 選択肢全文の配列。未知・重複を拒否し、定義の選択肢順へ正規化。 |
| `scale` | `SCALE` | 宣言された連続整数の目盛りのみ。数値へ正規化。`01` や `1e0` は拒否。 |
| `number` | `TEXT` | 10進数文字列を検証し、元定義のmin/max内で数値へ正規化。現行ageは6～100。元定義と同じ範囲検証で、小数を追加で禁止する規則は設けない。 |
| `text` | `PARAGRAPH_TEXT` | 文字列。必須項目の空白のみの回答を拒否。 |
| `other_text` | `TEXT` | multiごとに生成される独立した任意文字列。特定の「その他」の選択とは連動させない。 |
| `notice` / 画像 | `SECTION_HEADER` / `IMAGE` | Map照合に含め、回答の到着は拒否。分析回答として出力しない。 |

必須項目の欠落・空文字・空白のみ・空配列を拒否します。任意文字列の未回答は `null`、任意multiの未回答は空配列になります。通常のTEXT/PARAGRAPH_TEXTへ配列、オブジェクト、数値、nullを回答値として渡すと拒否します。省略された任意回答は受理します。

既存下書きの `participant_id` はGoogle型 `TEXT` の必須項目です。生成器と同じ英字4文字＋数字2桁の形式を検査し、英字を大文字化して、認証済みidentityの `participant_id_normalized` と一致することを確認します。例: `abcd12` と `AbCd12` は `ABCD12` に一致します。前後空白は除去せず拒否します。分析用 `answers` には含めません。正規表現や大文字化は本人認証ではなく、形式に合うIDでも、検証済みidentityと異なる値は拒否します。フォームに入力されたstore・condition・assignmentを信用しません。

正答判定は、選択肢全文の完全一致を確認した後、信頼済み設問定義の選択肢からコードを取得して既存キーと集合比較します。`A. 偽の選択肢` のような文字列を先頭の英字だけで受理しません。キーの未知設問・型・選択肢コード・重複も拒否します。キー自体は出力せず、Formsのクイズ設定や回答者向けページにも設置しません。

## 出力と計測限界

別スキーマ `bts.forms.normalized.v1` を返します。既存Webの完了・追跡調査ペイロードとの互換性を意味しません。

出力は `identity`、時点・言語・版・hash/digest、`form_id`、`google_response_id`、`google_submitted_at`、`ingested_at`、`answers`、`answer_records` と計測状態の固定allowlistです。全体と回答行に `measurement_mode: "forms"` を付けます。回答行は `question_id`, `source_type`, `selected_answer`, `is_correct` を持ちます。

Googleの送信時刻は `google_submitted_at`、取込時刻は `ingested_at` に分けて保持します。未計測の `started_at`, `completed_at`, `response_time_ms`, `screen_dwell_time_ms`, `answer_change_count` は `null`、`question_logs` は空配列です。各回答行の `question_started_at`, `answered_at`, `response_time_ms`, `screen_dwell_time_ms`, `answer_change_count` も `null` です。未計測をゼロで埋めず、Google送信時刻から開始・項目時刻を作りません。

`normalizeFollowupResponse_` へ偽の時刻や質問ログを渡す処理はありません。別アダプター `FormsProduction.gs` は上記のForms専用保存スキーマを使用します。分析時にも計測モードと欠測を保持し、Forms追跡をWebと同じ時間計測として扱わないことが必要です。

未知の入力プロパティ（token, secret, rawCredential, respondentEmail, editResponseUrl等）をコピーしません。例外は `forms_invalid_choice` 等の固定コードのみで、失敗した値・ID・回答・秘密をメッセージへ埋め込みません。なお、研究用の自由記述回答そのものに回答者が秘密を書いた場合、その文字列を自動判定・匿名化する機能ではありません。資格は自由記述に流し込まない設計が必要です。

## 公開後に残る受入

本人の現版採用回答は確認者・承認時刻・対象内容ハッシュに結び付けて記録済みです。公開URL、募集/当日完了/追跡の期間、上限なし、保存方針を設定し、HTTP・Forms・メールと3トリガーのreadinessを9月29日11:35:36に確認しました。これは本番データの全工程成功とは別です。

1. 公開後の `store=B` 割付エラーを修正し、通常完了・receiptまでの接続を再確認する。利用者の既存回答・割付は削除や変更をしない。
2. 新しい追跡専用2フォームは日英8質問・2画像の表示を確認済み。実際の資格発行・提出トリガー・取込・拒否・同一ID復旧を受入確認する。
3. 親記録との結合、二重回答拒否、Google原回答と資格の非公開管理、分析データへの資格/メール非混入と計測欠測を実保存先で確認する。
4. テストメール1通は本人受信確認済みだが、参加者への自動送信・到達結果を別途管理する。成否不明のメールを自動で再送しない。
5. 各取得日から6か月の保存期限と手動削除を管理する。採用承認や予備調査の結果から、未実証の日英・時点間の統計的等価性を保証しない。

通常完了から追跡Forms実提出・取込・分析保存までの完全な本番E2Eは未確認です。フォーム作成・公開、readiness、ローカル試験、1通のテストメール受信だけで全工程が完了したとは判断しません。最新証跡は [TEST_RESULTS.md](TEST_RESULTS.md) を参照してください。

## ローカル検証

```powershell
& '（ローカルの作業フォルダー）
node tests/run-forms-production-tests.js
node tests/run-production-tests.js
node tests/run-followup-ui-tests.js
```

Nodeの隔離vmでGoogleサービスを与えず実行します。現行 `Forms.gs` の `btsFormsExpectedItems_` / `btsFormsMapRows_` と実 `mergeSurveyItems` を読み込み、事前・事後・1週間後 × 日英の6定義が一致することを検証します。合成item ID・参加者・回答を用いて、全6設問型、全選択肢、必須・任意・scale・年齢範囲、Map/回答の重複・未知ID・型・メタデータ不一致、入力不変性、明示キー採点、秘密フィールド非流出、未計測のnull/空を検証します。

2026-09-25時点: **1,388 checks成功、6定義**。実キーに対するsingleの誤答・multiの部分集合/余分な選択が `false` となること、および参加者IDの大文字小文字互換・空白/改行/不正形の拒否を含みます。これはローカル単体検証の結果であり、Googleでの提出・認証・取込・保存・研究承認・予備調査を確認した結果ではありません。

この9月25日の件数は当時のcore検証記録として保持します。9月27日以降の本番アダプター・メール・フロントを含む最新件数とクラウド実施範囲は [TEST_RESULTS.md](TEST_RESULTS.md) を参照してください。ローカル試験はGoogleへ提出せず、実メールも送りません。
