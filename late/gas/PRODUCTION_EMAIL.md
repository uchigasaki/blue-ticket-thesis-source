# 本番メール送信の所有者向け手順

このファイル群はローカル実装であり、設置・OAuth承認・公開・メール送信・トリガー登録は自動では行いません。前期のApps ScriptやSheetへ上書きしないでください。

## 設置と承認の境界

1. 独立した後期本番Apps Scriptへ `Code.gs`、`Production.gs`、`FormsProduction.gs` とその依存ファイル、`ProductionEmail.gs` を設置します。既存の8シートは本番側であらかじめ用意し、このsenderから列追加・シート作成は行いません。
2. `appsscript.production.json` は**別テンプレート**です。所有者が用途・権限を確認してから、本番プロジェクトの `appsscript.json` に採用します。既存 `gas/appsscript.json` は変更していません。Sheets/Formsの利用に加え、Driveの共有状態を読む `drive.readonly`、MailApp送信の `script.send_mail`、トリガー操作の `script.scriptapp` を要求します。Gmail受信箱を読む権限は要求しません。
3. 本番固定Sheet・実際の教材ハッシュに対応する研究者レビュー・版・実公開URL・募集期間等を `btsProductionSettings_` の契約どおり設定します。本人の動作確認は研究内容の承認を自動で代替しません。期間は必要な追跡回答期間を含めて研究者が決めます。
4. 日英の本番followupフォームとその回答トリガーを別途準備・明示公開します。送信前の `btsFormsProductionReadiness_` は公開状態・原稿/項目・実際の回答トリガーを読取検証し、資格を発行しません。
5. 研究参加画面の任意連絡先への案内に沿って送信を承認した後で、所有者が Script Properties の `BTS_EMAIL_ENABLED=true` **かつ** `BTS_PRODUCTION_EMAIL_APPROVED=true` を設定します。どちらかが異なるとsenderは送信しません。この手順書やテストは承認記録を作りません。
6. 所有者が `installBtsProductionEmailTrigger()` を明示実行すると、専用wrapper `sendBtsProductionFollowupEmails` の1時間おきトリガーを1つ作成します。この設置呼び出し自体はメールを送りませんが、以降のトリガー実行は条件を満たす実メールを送ります。手動でwrapperを実行しても実送信されます。従来名 `sendDueFollowups` のトリガーが存在する場合は拒否し、勝手に削除しません。

トリガーは実行したGoogleアカウントの権限で動き、そのアカウントからMailAppで送信します。別所有者が作ったトリガーは一覧に見えないため、**1つの承認済み所有者アカウントだけで設置**してください。再実行は保存済みtrigger ID・handler・CLOCK種別が一致する場合だけ再利用します。不整合時は自動修復や複製をしません。

## 制限・データの検証

- 1回の上限は既定5宛先、`BTS_PRODUCTION_EMAIL_BATCH_LIMIT` で1〜10。日次の本実験上限は既定20回、`BTS_PRODUCTION_EMAIL_DAILY_LIMIT` で1〜100。Googleの `MailApp.getRemainingDailyQuota()` の残り宛先数も上限とし、より小さい制限を使います。Googleの制限値を固定で仮定しません。
- 追加日次カウンターはUTC日で区切り、`BTS_PRODUCTION_EMAIL_DAILY_V1` に日付・試行数だけを保存します。送信直前に加算し、成否不明も消費します。メール・トークンは保存しません。日次制限の帳尻合わせのためにカウンターを削除・減算しないでください。
- queue/Contact/FollowUp/Participants/SubmissionReceipts/Assignments の一意性・親ID・群・版・同意・本回答完了を照合します。メールは厳密な単一宛先で、Contactとqueueの完全一致が必要です。任意のqueue本文や件名は使用しません。
- これは参加者が入力したメールの所有確認ではありません。二重オプトインやメール認証は本senderには含まれず、公開募集では第三者のアドレス入力への対策と、任意の追跡案内への同意説明を運用側で確認してください。
- 本回答終了から7日後のsend_at、30日後のtoken expiry、7日後の評価window、各表の時刻一致を確認します。期限ちょうど以降は送りません。未到来・期限切れは送信せず、異常な記録は書込前に拒否します。
- リンクは承認済み本番サイトの `followup.html#token=...` だけです。生のGoogleフォームURLや入力用資格をメールへ埋め込みません。本文は日英の固定文＋その個人リンクです。
- 送信中は共通ScriptLockを保持します。各回最大4分を目安に次の送信を開始しないための時間ガードがあり、GAS強制終了時にも後述の状態で再送を防ぎます。

## 成否不明時に再送しない

送信前にqueue→Contact→FollowUpの状態を `sending` にして `SpreadsheetApp.flush()` を完了してから、日次カウンターを加算しMailAppを呼びます。成功が保存できれば `sent`、MailApp例外や送信後の保存例外は `send_unknown` として止めます。`send_unknown` の保存にも失敗した場合は既に保存された `sending` が再送防止になります。

`queued` 以外（`sent`、`sending`、`send_unknown`、旧`error`等）は自動で再送しません。曖昧な行を単に `queued` に戻さないでください。MailAppにはexactly-onceの保証がないため、到達状況の個別確認と本人の意向確認を伴う所有者判断が必要です。状態の修復・再送用の自動関数は意図的に用意していません。

停止するときは `BTS_EMAIL_ENABLED=false` または `BTS_PRODUCTION_EMAIL_APPROVED=false` にします。本機能は行や既存回答を削除しません。メール保存期間・削除方針・窓口・撤回手順は別途実際の研究運用として明示する必要があり、既存のretention dry-runは自動削除ではありません。

## ローカル検証と公式資料

`node tests/run-production-email-tests.js` はMailApp/トリガー/Sheetをメモリー内モックに置き換え、実メール・クラウド書込を行いません。

- [MailAppの送信権限・残り宛先quota](https://developers.google.com/apps-script/reference/mail/mail-app)
- [Apps Scriptのサービス制限](https://developers.google.com/apps-script/guides/services/quotas)
- [インストール型トリガーの所有者・権限](https://developers.google.com/apps-script/guides/triggers/installable)
