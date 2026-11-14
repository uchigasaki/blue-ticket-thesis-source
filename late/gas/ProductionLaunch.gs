/** Explicit owner-run operations. No HTTP route; loading this file does nothing.
 * BTS_PRODUCTION_OPERATING_ is supplied in a PRIVATE install artifact only.
 * Enrollment dates and real approval must come from the researcher.
 */
function btsLaunchState_(now) {
  if (typeof BTS_PRODUCTION_OPERATING_ === "undefined" || !isPlainObject_(BTS_PRODUCTION_OPERATING_)) throw new Error("launch_snapshot_missing");
  var input = BTS_PRODUCTION_OPERATING_, p = PropertiesService.getScriptProperties();
  var spreadsheet = requireActiveSpreadsheet_();
  btsFpRebindOwner_(spreadsheet);
  if (!isPlainObject_(input.config) || !isPlainObject_(input.review) || input.config.spreadsheetId !== spreadsheet.getId() ||
      spreadsheet.getName().indexOf("BTS 後期3群比較 本番 ") !== 0 || input.config.spreadsheetId !== p.getProperty("BTS_SPREADSHEET_ID")) throw new Error("launch_snapshot_invalid");
  var stored = JSON.parse(p.getProperty("BTS_PRODUCTION_CONFIG") || "null");
  if (!isPlainObject_(stored)) throw new Error("launch_config_missing");
  var mutable = ["opensAt", "enrollmentOpensAt", "enrollmentClosesAt", "completionClosesAt", "closesAt", "maxAssignments", "maxDailyAssignments"];
  var before = btsFpRebindCopy_(stored), after = btsFpRebindCopy_(input.config);
  mutable.forEach(function(key) { delete before[key]; delete after[key]; });
  if (btsFpJson_(before) !== btsFpJson_(after) ||
      !btsProductionCapacityValid_(input.config.maxAssignments, 10000) || !btsProductionCapacityValid_(input.config.maxDailyAssignments, 1000)) throw new Error("launch_config_changed");
  btsProductionValidateScheduleReview_(input.config, input.review, now);
  if (typeof input.config.enrollmentOpensAt !== "string" || typeof input.config.completionClosesAt !== "string") throw new Error("launch_schedule_required");
  return { input: input, properties: p, spreadsheet: spreadsheet, stored: stored };
}
/** Installs real, recorded settings only while HTTP and mail are disabled. */
function configureBtsProductionOperatingPeriod() {
  var lock = LockService.getScriptLock(); lock.waitLock(BTS_LOCK_TIMEOUT_MS_);
  try {
    var state = btsLaunchState_(new Date()), p = state.properties;
    btsProductionPreparationSettings_();
    if (p.getProperty("BTS_PRODUCTION_EMAIL_APPROVED") !== "false" || ScriptApp.getProjectTriggers().length) throw new Error("launch_disable_required");
    btsFpRebindEmptyStorage_(state.spreadsheet);
    var oldReview = JSON.parse(p.getProperty("BTS_PRODUCTION_REVIEW") || "null");
    var identical = btsFpJson_(state.stored) === btsFpJson_(state.input.config) && btsFpJson_(oldReview) === btsFpJson_(state.input.review);
    if (!identical && (!oldReview || oldReview.reviewer !== "" || oldReview.reviewedAt !== "" || oldReview.contentSha256 !== state.input.config.contentHash ||
        !isPlainObject_(oldReview.approvals) || Object.keys(oldReview.approvals).length !== 5 || Object.keys(oldReview.approvals).some(function(key) { return oldReview.approvals[key] !== false; }))) throw new Error("launch_existing_review_conflict");
    var context = btsFpContext_(new Date(), true);
    ["ja", "en"].forEach(function(language) {
      var form = btsFpVerify_(context, btsFpRegistry_(language), false);
      if (form.isPublished() || form.isAcceptingResponses() || form.getResponses().length) throw new Error("launch_form_used");
    });
    if (!identical) {
      var updates = { BTS_PRODUCTION_CONFIG: JSON.stringify(state.input.config), BTS_PRODUCTION_REVIEW: JSON.stringify(state.input.review) };
      p.setProperties(updates, false);
      if (Object.keys(updates).some(function(key) { return p.getProperty(key) !== updates[key]; })) throw new Error("launch_verify_failed");
    }
    var result = { status: "configured_closed", reused: identical, enrollmentOpensAt: state.input.config.enrollmentOpensAt,
      enrollmentClosesAt: state.input.config.enrollmentClosesAt, completionClosesAt: state.input.config.completionClosesAt,
      closesAt: state.input.config.closesAt, maxAssignments: state.input.config.maxAssignments, emailEnabled: false };
    Logger.log(JSON.stringify(result)); return result;
  } finally { lock.releaseLock(); }
}
/** Enable dated HTTP collection only. This does NOT publish Forms or enable mail. */
function enableBtsProductionDatedCollection() {
  var lock = LockService.getScriptLock(); lock.waitLock(BTS_LOCK_TIMEOUT_MS_);
  try {
    var now = new Date(), state = btsLaunchState_(now), p = state.properties;
    if (btsFpJson_(state.stored) !== btsFpJson_(state.input.config) ||
        btsFpJson_(JSON.parse(p.getProperty("BTS_PRODUCTION_REVIEW") || "null")) !== btsFpJson_(state.input.review) ||
        p.getProperty("BTS_EMAIL_ENABLED") !== "false" || p.getProperty("BTS_PRODUCTION_EMAIL_APPROVED") !== "false") throw new Error("launch_config_not_installed");
    if (p.getProperty("BTS_HTTP_MODE") !== "disabled" || p.getProperty("BTS_PRODUCTION_ENABLED") !== "false") {
      if (p.getProperty("BTS_HTTP_MODE") === "production" && p.getProperty("BTS_PRODUCTION_ENABLED") === "true") {
        btsProductionSettings_(now); return {status: "dated_collection_enabled", reused: true, emailEnabled: false};
      }
      throw new Error("launch_flags_conflict");
    }
    btsProductionPreparationSettings_();
    btsFpRebindEmptyStorage_(state.spreadsheet);
    p.setProperties({BTS_HTTP_MODE: "production", BTS_PRODUCTION_ENABLED: "true"}, false);
    btsProductionSettings_(now);
    var result = {status: "dated_collection_enabled", enrollmentOpensAt: state.input.config.enrollmentOpensAt,
      enrollmentClosesAt: state.input.config.enrollmentClosesAt, emailEnabled: false};
    Logger.log(JSON.stringify(result)); return result;
  } finally { lock.releaseLock(); }
}
/** One explicitly authorized test message; terminal marker prevents double sends.
 * Never submits a participant response or uses the follow-up queue.
 */
function sendBtsProductionConnectionTestEmail() {
  var lock = LockService.getScriptLock(); lock.waitLock(BTS_LOCK_TIMEOUT_MS_);
  try {
    var state = btsLaunchState_(new Date()), p = state.properties, approval = state.input.testEmail;
    if (!isPlainObject_(approval) || approval.approved !== true || !btsFpRebindDate_(approval.approvedAt, new Date()) ||
        approval.recipient !== state.input.contactEmail || !/^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/.test(approval.recipient)) throw new Error("launch_test_mail_not_approved");
    var key = "BTS_PRODUCTION_CONNECTION_TEST_MAIL_V1";
    if (p.getProperty(key) !== null) throw new Error("launch_test_mail_already_attempted");
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error("launch_test_mail_quota");
    p.setProperty(key, JSON.stringify({status: "sending", attemptedAt: new Date().toISOString()}));
    try {
      MailApp.sendEmail({to: approval.recipient, subject: "【動作確認】Blue Ticket Simulator 後期研究のメール接続",
        body: "内ヶ崎優斗 様\n\nご本人の許可に基づくテストメール1通です。\nBlue Ticket Simulator 後期研究のGoogle Apps Scriptから送信しています。\n参加者への案内ではなく、研究回答・個人用トークンは含みません。\n受信を確認できたら、Codexのチャットへ『テストメール受信済み』とお知らせください。\n\nこのテストは自動再送しません。",
        name: "Blue Ticket Simulator 研究用動作確認"});
      p.setProperty(key, JSON.stringify({status: "sent", sentAt: new Date().toISOString()}));
    } catch (_) { throw new Error("launch_test_mail_delivery_unknown_do_not_retry"); }
    var result = {status: "test_mail_sent", count: 1, deliveryConfirmed: false}; Logger.log(JSON.stringify(result)); return result;
  } finally { lock.releaseLock(); }
}

/** Enables only consented, due follow-up invitations; this function sends none. */
function enableBtsProductionFollowupEmail() {
  var lock = LockService.getScriptLock(); lock.waitLock(BTS_LOCK_TIMEOUT_MS_);
  try {
    var now = new Date(), state = btsLaunchState_(now), p = state.properties;
    var approval = state.input.automatedEmail;
    if (!isPlainObject_(approval) || approval.approved !== true || !btsFpRebindDate_(approval.approvedAt, now) ||
        approval.batchLimit !== 10 || approval.dailyLimit !== 100) throw new Error("launch_email_approval_required");
    var config = btsProductionSettings_(now);
    if (btsFpJson_(state.stored) !== btsFpJson_(state.input.config) ||
        btsFpJson_(JSON.parse(p.getProperty("BTS_PRODUCTION_REVIEW") || "null")) !== btsFpJson_(state.input.review)) throw new Error("launch_config_not_installed");
    if (btsFormsProductionReadiness_(now).ready !== true) throw new Error("launch_forms_not_ready");
    var marker = JSON.parse(p.getProperty("BTS_PRODUCTION_CONNECTION_TEST_MAIL_V1") || "null");
    if (!marker || marker.status !== "sent") throw new Error("launch_test_mail_required");
    // A mismatched or partially enabled state is not silently overwritten.
    var updates = {BTS_EMAIL_ENABLED: "true", BTS_PRODUCTION_EMAIL_APPROVED: "true",
      BTS_PRODUCTION_EMAIL_BATCH_LIMIT: "10", BTS_PRODUCTION_EMAIL_DAILY_LIMIT: "100"};
    var identical = Object.keys(updates).every(function(key) { return p.getProperty(key) === updates[key]; });
    if (!identical) {
      if (p.getProperty("BTS_EMAIL_ENABLED") !== "false" || p.getProperty("BTS_PRODUCTION_EMAIL_APPROVED") !== "false") throw new Error("launch_email_flags_conflict");
      btsFpRebindEmptyStorage_(state.spreadsheet);
      p.setProperties(updates, false);
      if (Object.keys(updates).some(function(key) { return p.getProperty(key) !== updates[key]; })) throw new Error("launch_email_verify_failed");
    }
    var result = {status: "followup_email_enabled", sendsByThisCall: 0, batchLimit: 10, dailyLimit: 100, reused: identical};
    Logger.log(JSON.stringify(result)); return result;
  } finally { lock.releaseLock(); }
}

/** Read-only operator evidence. Never includes contact data, secrets or tokens. */
function reportBtsProductionLaunchReadiness() {
  var now = new Date(), state = btsLaunchState_(now), p = state.properties;
  var settings = btsProductionSettings_(now), forms = btsFormsProductionReadiness_(now);
  var tableRows = {};
  state.spreadsheet.getSheets().forEach(function(sheet) { tableRows[sheet.getName()] = Math.max(0, sheet.getLastRow() - 1); });
  var triggers = ScriptApp.getProjectTriggers().map(function(t) { return {handler: t.getHandlerFunction(), event: String(t.getEventType())}; });
  var marker = JSON.parse(p.getProperty("BTS_PRODUCTION_CONNECTION_TEST_MAIL_V1") || "null");
  var result = {status: "read_only_readiness", httpEnabled: p.getProperty("BTS_HTTP_MODE") === "production" && p.getProperty("BTS_PRODUCTION_ENABLED") === "true",
    enrollmentOpensAt: settings.enrollmentOpensAt, enrollmentClosesAt: settings.enrollmentClosesAt,
    completionClosesAt: settings.completionClosesAt, closesAt: settings.closesAt, maxAssignments: settings.maxAssignments,
    forms: forms, emailEnabled: btsEmailApproved_(), testMailStatus: marker ? marker.status : "not_attempted",
    mailboxDeliveryConfirmed: false, tableRows: tableRows, triggers: triggers};
  Logger.log(JSON.stringify(result)); return result;
}
