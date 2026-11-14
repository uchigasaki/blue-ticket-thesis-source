/** Follow-up ONLY. Explicit setup functions; nothing runs when this file loads.
 * Requires Production.gs, Code.gs, Forms.gs and FormsResponseCore.gs in ONE project.
 * Research approval is checked by btsProductionSettings_; this code grants none.
 */
var BTS_FORMS_PRODUCTION_KEY_ = "BTS_FORMS_PRODUCTION_V1";
var BTS_FORMS_SERVER_KEYS_ = {
  late_followup_transfer_stop: "C", late_followup_transfer_pedestrian: "B",
  late_followup_transfer_phone: "A", late_followup_transfer_age: "C"
};
var BTS_FORMS_PRIVATE_SHEETS_ = [
  { name: "FormsQualifications", headers: ["qualification_id", "credential_hash", "followup_id", "language", "form_id", "binding_json", "issued_at", "expires_at", "status", "receipt_key"] },
  { name: "FormsResponses", headers: ["receipt_key", "form_id", "google_response_id", "followup_id", "parent_submission_id", "assignment_id", "participant_id_normalized", "store_id", "condition", "language", "instrument_version", "instrument_hash", "measurement_mode", "google_submitted_at", "ingested_at", "payload_hash", "normalized_json"] },
  { name: "FormsQuarantine", headers: ["receipt_key", "received_at", "reason"] }
];

function btsFpFail_(reason) { throw new Error("forms_production_" + reason); }
function btsFpJson_(value) { return JSON.stringify(canonicalFollowupValue_(value)); }
function btsFpSheet_(spreadsheet, name, create) {
  var definition = BTS_FORMS_PRIVATE_SHEETS_.filter(function(row) { return row.name === name; })[0];
  if (!definition) btsFpFail_("storage");
  var sheet = create ? ensureSheet_(spreadsheet, definition) : spreadsheet.getSheetByName(name);
  if (!sheet) btsFpFail_("storage");
  return { sheet: sheet, definition: definition };
}
function btsFpFind_(spreadsheet, name, key, value) {
  var target = btsFpSheet_(spreadsheet, name, false);
  return findRowByValue_(target.sheet, target.definition, key, value);
}
function btsFpUpdate_(spreadsheet, name, index, values) {
  var target = btsFpSheet_(spreadsheet, name, false);
  updateMappedRow_(target.sheet, target.definition, index, values);
}
function btsFpAppend_(spreadsheet, name, values) {
  var target = btsFpSheet_(spreadsheet, name, false);
  appendMappedRow_(target.sheet, target.definition, values);
}
function btsFpContext_(now, preparation) {
  var settings = preparation === true ? btsProductionPreparationSettings_() : btsProductionSettings_(now);
  if (settings.mode !== "production" || settings.followupMode !== "google_forms") btsFpFail_("disabled");
  var spreadsheet = requireActiveSpreadsheet_();
  if (spreadsheet.getId() !== settings.spreadsheetId || spreadsheet.getName().indexOf("BTS 後期3群比較 本番 ") !== 0) btsFpFail_("spreadsheet");
  var data = typeof btsPostImageFormsData_ === "function" ? btsPostImageFormsData_(settings) : BTS_GOOGLE_FORMS_DRAFT_DATA_;
  return btsFpContextForData_(settings, spreadsheet, data);
}
function btsFpContextForData_(settings, spreadsheet, data) {
  var unsigned = Object.create(null);
  Object.keys(data).forEach(function(key) { if (key !== "digest") unsigned[key] = data[key]; });
  if (sha256Hex_(btsFpJson_(unsigned)) !== data.digest || data.instrumentVersion !== settings.instrumentVersion || data.experimentId !== settings.experimentId) btsFpFail_("instrument");
  var definitions = {};
  ["ja", "en"].forEach(function(language) {
    var matches = data.forms.filter(function(row) { return row.phase === "followup" && row.language === language; });
    if (matches.length !== 1) btsFpFail_("instrument");
    definitions[language] = matches[0];
  });
  var instrument = { instrumentVersion: data.instrumentVersion, items: { ja: definitions.ja.items, en: definitions.en.items }, answerKeys: BTS_FORMS_SERVER_KEYS_ };
  if (sha256Hex_(btsFpJson_(instrument)) !== settings.instrumentHash) btsFpFail_("instrument");
  return { settings: settings, spreadsheet: spreadsheet, data: data, definitions: definitions };
}
function btsFpRegistry_(language) {
  var text = PropertiesService.getScriptProperties().getProperty(BTS_FORMS_PRODUCTION_KEY_ + ":" + language);
  var registry;
  try { registry = JSON.parse(text || "null"); } catch (_) { btsFpFail_("registry"); }
  if (!registry || registry.status !== "ready" || registry.phase !== "followup" || registry.language !== language) btsFpFail_("registry");
  return registry;
}
function btsFpSaveRegistry_(registry) {
  PropertiesService.getScriptProperties().setProperty(BTS_FORMS_PRODUCTION_KEY_ + ":" + registry.language, JSON.stringify(registry));
}
function btsFpTitle_(context, language) {
  return "BTS 1週間後 / Follow-up " + language + " " + context.settings.instrumentVersion;
}
function btsFpPrivate_(form) {
  var file = DriveApp.getFileById(form.getId());
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE || file.getEditors().length || file.getViewers().length ||
      form.collectsEmail() || form.isQuiz() || form.isPublishingSummary() || form.canEditResponse() ||
      form.hasRespondAgainLink() || form.hasLimitOneResponsePerUser() || form.getShuffleQuestions() || btsFormsDestinationId_(form)) btsFpFail_("privacy");
}
function btsFpPlan_(context, language) {
  var plan = btsFormsExpectedItems_(context.definitions[language], context.data);
  plan[0].title = language === "ja" ? "研究用参加者ID" : "Study participant ID";
  plan[0].help = language === "ja" ? "[participant_id] 専用リンクで設定されたIDを確認してください。氏名やメールアドレスは入力しないでください。" : "[participant_id] Check the ID supplied by your personal link. Do not enter your name or email address.";
  // This dedicated capability is NOT the original Web token. Never score/export it.
  plan.push({ sourceId: "forms_qualification", sourceType: "credential", type: "TEXT", required: true,
    title: language === "ja" ? "専用回答資格（変更しないでください）" : "Personal response credential (do not change)",
    help: language === "ja" ? "研究用の専用リンクから設定されます。共有しないでください。" : "Provided by your personal study link. Do not share it.",
    pattern: "^[a-f0-9]{64}$", validationHelp: language === "ja" ? "案内された専用リンクを開き直してください。" : "Please reopen your personal study link." });
  return plan;
}
function btsFpSignature_(form) {
  return sha256Hex_(btsFpJson_({ items: btsFormsSignature_(form), title: form.getTitle(), description: form.getDescription(),
    confirmation: form.getConfirmationMessage(), images: form.getItems().filter(function(item) { return String(item.getType()) === "IMAGE"; }).map(function(item) {
      return { id: String(item.getId()), width: item.asImageItem().getWidth(), sha256: btsFormsImageByteSha_(item.asImageItem()) };
    }) }));
}
function btsFpTriggerExists_(registry) {
  return !!registry.triggerUid && ScriptApp.getProjectTriggers().some(function(trigger) {
    return String(trigger.getUniqueId()) === registry.triggerUid && trigger.getHandlerFunction() === "onBtsProductionFormSubmit" &&
      trigger.getTriggerSourceId() === registry.formId && String(trigger.getEventType()) === String(ScriptApp.EventType.ON_FORM_SUBMIT);
  });
}
function btsFpVerify_(context, registry, requirePublished) {
  var s = context.settings;
  if (registry.experimentId !== s.experimentId || registry.instrumentVersion !== s.instrumentVersion || registry.instrumentHash !== s.instrumentHash ||
      registry.digest !== context.data.digest || registry.contentHash !== s.contentHash || registry.spreadsheetId !== s.spreadsheetId ||
      registry.definitionHash !== sha256Hex_(btsFpJson_(context.definitions[registry.language]))) btsFpFail_("registry");
  var form = FormApp.openById(registry.formId);
  if (form.getTitle() !== btsFpTitle_(context, registry.language)) btsFpFail_("title");
  btsFpPrivate_(form);
  if (!form.supportsAdvancedResponderPermissions() || (requirePublished && (!form.isPublished() || !form.isAcceptingResponses()))) btsFpFail_("closed");
  if (requirePublished && !btsFpTriggerExists_(registry)) btsFpFail_("trigger");
  var plan = btsFpPlan_(context, registry.language);
  var items = btsFormsCheckPrefix_(form, plan);
  if (items.length !== plan.length || btsFpSignature_(form) !== registry.signature) btsFpFail_("form_changed");
  var rows = btsFormsMapRows_(items, plan, context.data.digest);
  var expectedMap = rows.slice(1).filter(function(row) { return row[1] !== "credential"; }).map(function(row) {
    return { sourceId: row[0], sourceType: row[1], itemId: row[2], imageItemId: row[3], instrumentDigest: row[5] };
  });
  if (btsFpJson_(registry.itemMap) !== btsFpJson_(expectedMap) || registry.qualificationItemId !== String(items[items.length - 1].getId())) btsFpFail_("registry");
  return form;
}
/** Read-only gate for the email sender. Never issues a qualification or a URL. */
function btsFormsProductionReadiness_(now) {
  var context = btsFpContext_(now || new Date());
  ["ja", "en"].forEach(function(language) { btsFpVerify_(context, btsFpRegistry_(language), true); });
  return { ready: true, languages: ["ja", "en"], measurement_mode: "forms" };
}

/** Owner-run, metadata-only maintenance. There is deliberately no HTTP route.
 * The separately supplied BTS_FORMS_METADATA_REBIND_ must retain BOTH complete
 * canonical review-content and Forms-data snapshots. Installing this function
 * supplies no snapshot, researcher approval, identity, receipt date or new hash.
 * Never use this to change questions, images, answers, versions or consent text.
 */
function rebindClosedBtsProductionFormsMetadata() {
  var lock = LockService.getScriptLock(); lock.waitLock(BTS_LOCK_TIMEOUT_MS_);
  try {
    if (typeof BTS_FORMS_METADATA_REBIND_ === "undefined") btsFpFail_("rebind_snapshot_missing");
    return btsFpRebindMetadata_(BTS_FORMS_METADATA_REBIND_, new Date());
  } finally { lock.releaseLock(); }
}
function btsFpRebindCopy_(value) { return JSON.parse(JSON.stringify(value)); }
function btsFpRebindDate_(value, now) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !!asDate_(value) && asDate_(value) <= now;
}
function btsFpRebindSnapshots_(request, now) {
  var keys = ["schemaVersion", "reason", "adoptionReceivedAt", "spreadsheetId", "formIds", "oldContentHash", "newContentHash", "oldReviewContent", "newReviewContent", "oldFormsData", "newFormsData"];
  if (!isPlainObject_(request) || Object.keys(request).sort().join(",") !== keys.sort().join(",") || request.schemaVersion !== 1 ||
      request.reason !== "researcher_adoption_metadata_only" || !btsFpRebindDate_(request.adoptionReceivedAt, now) ||
      !isPlainObject_(request.formIds) || Object.keys(request.formIds).sort().join(",") !== "en,ja" ||
      !request.formIds.ja || !request.formIds.en || request.formIds.ja === request.formIds.en) btsFpFail_("rebind_snapshot");
  ["old", "new"].forEach(function(side) {
    var content = request[side + "ReviewContent"], data = request[side + "FormsData"];
    if (!isPlainObject_(content) || !isPlainObject_(content.evaluation) || !isPlainObject_(data) ||
        !/^[a-f0-9]{64}$/.test(request[side + "ContentHash"] || "") ||
        sha256Hex_(btsFpJson_(content)) !== request[side + "ContentHash"] ||
        btsFpJson_(content.evaluation.contentReviewIssues) !== btsFpJson_(data.contentReviewIssues) ||
        content.evaluation.contentStatus !== data.contentStatus) btsFpFail_("rebind_snapshot");
    var unsigned = btsFpRebindCopy_(data); delete unsigned.digest;
    if (sha256Hex_(btsFpJson_(unsigned)) !== data.digest) btsFpFail_("rebind_snapshot");
  });
  var oldContent = btsFpRebindCopy_(request.oldReviewContent), newContent = btsFpRebindCopy_(request.newReviewContent);
  var oldIssues = oldContent.evaluation.contentReviewIssues, newIssues = newContent.evaluation.contentReviewIssues;
  if (!Array.isArray(oldIssues) || !Array.isArray(newIssues) || !oldIssues.length || oldIssues.length !== newIssues.length ||
      typeof newContent.evaluation.contentStatus !== "string" || !newContent.evaluation.contentStatus.trim() || newContent.evaluation.contentStatus.length > 100) btsFpFail_("rebind_metadata_only");
  oldIssues.forEach(function(issue, index) {
    var before = btsFpRebindCopy_(issue), after = btsFpRebindCopy_(newIssues[index]);
    if (!isPlainObject_(before) || !isPlainObject_(after) || !before.id ||
        typeof after.note !== "string" || !after.note.trim() || after.note.length > 5000 ||
        (after.status !== before.status && after.status !== "resolved")) btsFpFail_("rebind_metadata_only");
    delete before.note; delete after.note; delete before.status; delete after.status;
    if (btsFpJson_(before) !== btsFpJson_(after)) btsFpFail_("rebind_metadata_only");
  });
  [oldContent, newContent].forEach(function(content) { delete content.evaluation.contentStatus; delete content.evaluation.contentReviewIssues; });
  var oldData = btsFpRebindCopy_(request.oldFormsData), newData = btsFpRebindCopy_(request.newFormsData);
  [oldData, newData].forEach(function(data) { delete data.contentStatus; delete data.contentReviewIssues; delete data.digest; });
  if (request.oldContentHash === request.newContentHash || request.oldFormsData.digest === request.newFormsData.digest ||
      btsFpJson_(oldContent) !== btsFpJson_(newContent) || btsFpJson_(oldData) !== btsFpJson_(newData) ||
      btsFpJson_(request.newFormsData) !== btsFpJson_(BTS_GOOGLE_FORMS_DRAFT_DATA_)) btsFpFail_("rebind_metadata_only");
}
function btsFpRebindEmptyStorage_(spreadsheet) {
  var definitions = BTS_SHEETS_.concat(BTS_FORMS_PRIVATE_SHEETS_);
  definitions.forEach(function(definition) {
    var sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet || sheet.getLastRow() !== 1 || sheet.getLastColumn() !== definition.headers.length ||
        btsFpJson_(sheet.getRange(1, 1, 1, definition.headers.length).getValues()[0]) !== btsFpJson_(definition.headers)) btsFpFail_("rebind_used_storage");
  });
  spreadsheet.getSheets().forEach(function(sheet) {
    if (!definitions.some(function(definition) { return definition.name === sheet.getName(); }) &&
        (sheet.getLastRow() !== 0 || sheet.getLastColumn() !== 0)) btsFpFail_("rebind_used_storage");
  });
}
function btsFpRebindOwner_(spreadsheet) {
  // This manual-only function has no HTTP route or trigger. Use the executing
  // account's My Drive owner, available under the already approved read-only
  // Drive scope; Session email would require an additional OAuth scope.
  var rootOwner = DriveApp.getRootFolder().getOwner();
  var effective = rootOwner && rootOwner.getEmail();
  var file = DriveApp.getFileById(spreadsheet.getId()), owner = file.getOwner();
  if (!effective || !owner || effective !== owner.getEmail() || file.getSharingAccess() !== DriveApp.Access.PRIVATE ||
      file.getEditors().length || file.getViewers().length) btsFpFail_("rebind_owner");
  return effective;
}
function btsFpRebindClosedForm_(context, registry, expectedId, owner) {
  if (registry.formId !== expectedId || registry.triggerUid) btsFpFail_("rebind_registry");
  var form = btsFpVerify_(context, registry, false), fileOwner = DriveApp.getFileById(form.getId()).getOwner();
  var ja = registry.language === "ja";
  if (!fileOwner || fileOwner.getEmail() !== owner || form.isPublished() || form.isAcceptingResponses() || form.getResponses().length !== 0) btsFpFail_("rebind_used_form");
  if (form.getDescription() !== (ja ? "Blue Ticket Simulator研究の1週間後アンケートです。案内された専用リンクから回答してください。氏名やメールアドレスは入力しないでください。" : "One-week follow-up for the Blue Ticket Simulator study. Use your personal study link. Do not enter your name or email address.") ||
      form.getConfirmationMessage() !== (ja ? "回答を受け付けました。研究側で回答資格と重複を確認します。この画面だけでは研究データへの登録完了を保証しません。" : "Your form was submitted. The study will check eligibility and duplicates. This screen alone does not confirm acceptance into the study data.")) btsFpFail_("rebind_form_metadata");
}
function btsFpRebindMetadata_(request, now) {
  btsFpRebindSnapshots_(request, now);
  var p = PropertiesService.getScriptProperties(), auditKey = "BTS_FORMS_METADATA_REBIND_V1";
  if (p.getProperty("BTS_HTTP_MODE") !== "disabled" || p.getProperty("BTS_PRODUCTION_ENABLED") !== "false" ||
      p.getProperty("BTS_EMAIL_ENABLED") !== "false" || p.getProperty("BTS_PRODUCTION_EMAIL_APPROVED") !== "false") btsFpFail_("rebind_disable_required");
  if (ScriptApp.getProjectTriggers().length !== 0) btsFpFail_("rebind_triggers");
  var settings = btsProductionPreparationSettings_(), spreadsheet = requireActiveSpreadsheet_();
  if (settings.spreadsheetId !== request.spreadsheetId || spreadsheet.getId() !== request.spreadsheetId ||
      spreadsheet.getName().indexOf("BTS 後期3群比較 本番 ") !== 0) btsFpFail_("rebind_spreadsheet");
  var owner = btsFpRebindOwner_(spreadsheet);
  btsFpRebindEmptyStorage_(spreadsheet);
  var config, review, audit;
  try { config = JSON.parse(p.getProperty("BTS_PRODUCTION_CONFIG")); review = JSON.parse(p.getProperty("BTS_PRODUCTION_REVIEW")); audit = JSON.parse(p.getProperty(auditKey) || "null"); }
  catch (_) { btsFpFail_("rebind_state"); }
  // Only an empty review template may have its hash relabelled. A real review
  // must be supplied and validated separately; no name/date/approval is invented.
  var approvalKeys = ["conditionNeutralPostSurvey", "followupInstrumentAndUrl", "improvedContent", "lateEvaluationInstruments", "noImageScenes"];
  if (!isPlainObject_(config) || !isPlainObject_(review) || review.reviewer !== "" || review.reviewedAt !== "" ||
      Object.keys(review).sort().join(",") !== "approvals,contentSha256,reviewedAt,reviewer" || !isPlainObject_(review.approvals) ||
      Object.keys(review.approvals).sort().join(",") !== approvalKeys.join(",") ||
      approvalKeys.some(function(key) { return review.approvals[key] !== false; })) btsFpFail_("rebind_review_template_required");
  var expectedAudit = { schemaVersion: 1, reason: request.reason, adoptionReceivedAt: request.adoptionReceivedAt,
    spreadsheetId: request.spreadsheetId, formIds: request.formIds, oldContentHash: request.oldContentHash, newContentHash: request.newContentHash,
    oldFormsDigest: request.oldFormsData.digest, newFormsDigest: request.newFormsData.digest, snapshotSha256: sha256Hex_(btsFpJson_(request)) };
  var isRetry = audit !== null;
  if (isRetry) {
    if (!isPlainObject_(audit) || !btsFpRebindDate_(audit.reboundAt, now)) btsFpFail_("rebind_recovery_required");
    var withoutDate = btsFpRebindCopy_(audit); delete withoutDate.reboundAt;
    if (btsFpJson_(withoutDate) !== btsFpJson_(expectedAudit)) btsFpFail_("rebind_recovery_required");
  }
  var expectedHash = isRetry ? request.newContentHash : request.oldContentHash;
  if (config.contentHash !== expectedHash || settings.contentHash !== expectedHash || review.contentSha256 !== expectedHash) btsFpFail_("rebind_recovery_required");
  var oldSettings = btsFpRebindCopy_(settings); oldSettings.contentHash = request.oldContentHash;
  var newSettings = btsFpRebindCopy_(settings); newSettings.contentHash = request.newContentHash;
  var oldContext = btsFpContextForData_(oldSettings, spreadsheet, request.oldFormsData);
  var newContext = btsFpContextForData_(newSettings, spreadsheet, request.newFormsData);
  var proposed = {};
  ["ja", "en"].forEach(function(language) {
    var registry = btsFpRegistry_(language), previous = btsFpRebindCopy_(registry);
    if (isRetry) {
      btsFpRebindClosedForm_(newContext, registry, request.formIds[language], owner);
      previous.contentHash = request.oldContentHash; previous.digest = request.oldFormsData.digest;
      previous.itemMap.forEach(function(row) { row.instrumentDigest = request.oldFormsData.digest; });
    }
    btsFpRebindClosedForm_(oldContext, previous, request.formIds[language], owner);
    var next = btsFpRebindCopy_(previous); next.contentHash = request.newContentHash; next.digest = request.newFormsData.digest;
    next.itemMap.forEach(function(row) { row.instrumentDigest = request.newFormsData.digest; });
    btsFpRebindClosedForm_(newContext, next, request.formIds[language], owner);
    proposed[BTS_FORMS_PRODUCTION_KEY_ + ":" + language] = JSON.stringify(next);
  });
  if (isRetry) return { status: "already_rebound_closed", forms: 2, contentHash: request.newContentHash, reviewsApproved: false };
  config.contentHash = request.newContentHash; review.contentSha256 = request.newContentHash;
  expectedAudit.reboundAt = now.toISOString();
  proposed.BTS_PRODUCTION_CONFIG = JSON.stringify(config); proposed.BTS_PRODUCTION_REVIEW = JSON.stringify(review);
  proposed[auditKey] = JSON.stringify(expectedAudit);
  Object.keys(proposed).forEach(function(key) {
    if (encodeURIComponent(proposed[key]).replace(/%[A-F\d]{2}/g, "x").length > 8500) btsFpFail_("rebind_property_size");
  });
  // All validation precedes this ONE bulk write. GAS provides no transaction
  // guarantee: never roll back or blindly retry a partial write. Mismatched
  // config/registries/audit fail closed and require owner inspection. A fully
  // completed write is recognized by the exact audit on a subsequent retry.
  try {
    p.setProperties(proposed, false);
    if (Object.keys(proposed).some(function(key) { return p.getProperty(key) !== proposed[key]; })) btsFpFail_("rebind_recovery_required");
  } catch (_) { btsFpFail_("rebind_recovery_required"); }
  var result = { status: "metadata_rebound_closed", forms: 2, contentHash: request.newContentHash, reviewsApproved: false };
  Logger.log(JSON.stringify(result));
  return result;
}

/** Explicit operation: creates TWO new closed forms, never touches review drafts.
 * A interrupted building record fails closed and requires inspection; no duplicate creation.
 */
function createBtsProductionFollowupForms() {
  var lock = LockService.getScriptLock(); lock.waitLock(BTS_LOCK_TIMEOUT_MS_);
  try {
    var context = btsFpContext_(new Date(), true);
    BTS_FORMS_PRIVATE_SHEETS_.forEach(function(definition) { btsFpSheet_(context.spreadsheet, definition.name, true); });
    var p = PropertiesService.getScriptProperties();
    if (!p.getProperty("BTS_FORMS_QUALIFICATION_SECRET")) p.setProperty("BTS_FORMS_QUALIFICATION_SECRET", sha256Hex_(Utilities.getUuid() + "|" + Utilities.getUuid()));
    var report = [];
    ["ja", "en"].forEach(function(language) {
      if (p.getProperty(BTS_FORMS_PRODUCTION_KEY_ + ":" + language)) {
        var existing = btsFpRegistry_(language); var existingForm = btsFpVerify_(context, existing, false);
        if (existingForm.isPublished() || existingForm.isAcceptingResponses()) btsFpFail_("preparation_closed_required");
        report.push({ language: language, formId: existing.formId, published: existingForm.isPublished(), reused: true }); return;
      }
      var title = btsFpTitle_(context, language);
      var form = FormApp.create(title, false);
      var registry = { status: "building", phase: "followup", language: language, formId: form.getId(), spreadsheetId: context.settings.spreadsheetId };
      btsFpSaveRegistry_(registry);
      // Google can set the Drive document name while leaving the Form body
      // title empty. Preserve the new ID before explicitly setting/checking it.
      form.setTitle(title);
      if (form.getTitle() !== title) btsFpFail_("title");
      btsFormsClose_(form);
      form.setCollectEmail(false).setIsQuiz(false).setPublishingSummary(false).setAllowResponseEdits(false).setShowLinkToRespondAgain(false)
        .setLimitOneResponsePerUser(false).setShuffleQuestions(false).setProgressBar(true);
      form.setDescription(language === "ja" ? "Blue Ticket Simulator研究の1週間後アンケートです。案内された専用リンクから回答してください。氏名やメールアドレスは入力しないでください。" : "One-week follow-up for the Blue Ticket Simulator study. Use your personal study link. Do not enter your name or email address.");
      form.setConfirmationMessage(language === "ja" ? "回答を受け付けました。研究側で回答資格と重複を確認します。この画面だけでは研究データへの登録完了を保証しません。" : "Your form was submitted. The study will check eligibility and duplicates. This screen alone does not confirm acceptance into the study data.");
      var plan = btsFpPlan_(context, language);
      plan.forEach(function(spec) { btsFormsAppendExpected_(form, spec); });
      btsFpPrivate_(form);
      var items = btsFormsCheckPrefix_(form, plan);
      var rows = btsFormsMapRows_(items, plan, context.data.digest);
      registry.itemMap = rows.slice(1).filter(function(row) { return row[1] !== "credential"; }).map(function(row) {
        return { sourceId: row[0], sourceType: row[1], itemId: row[2], imageItemId: row[3], instrumentDigest: row[5] };
      });
      registry.qualificationItemId = String(items[items.length - 1].getId());
      registry.experimentId = context.settings.experimentId; registry.instrumentVersion = context.settings.instrumentVersion;
      registry.instrumentHash = context.settings.instrumentHash; registry.digest = context.data.digest; registry.contentHash = context.settings.contentHash;
      registry.definitionHash = sha256Hex_(btsFpJson_(context.definitions[language])); registry.signature = btsFpSignature_(form); registry.status = "ready";
      btsFpSaveRegistry_(registry);
      report.push({ language: language, formId: registry.formId, published: false, reused: false });
    });
    Logger.log(JSON.stringify({ status: "prepared", forms: report }));
    return { status: "prepared", forms: report, publishedByThisCall: false };
  } finally { lock.releaseLock(); }
}

/** Explicit install only. No mail/time triggers and no deletion of other triggers. */
function installBtsProductionFormsTriggers() {
  var lock = LockService.getScriptLock(); lock.waitLock(BTS_LOCK_TIMEOUT_MS_);
  try {
    var context = btsFpContext_(new Date()); var count = 0;
    ["ja", "en"].forEach(function(language) {
      var registry = btsFpRegistry_(language); var form = btsFpVerify_(context, registry, false);
      var matches = ScriptApp.getProjectTriggers().filter(function(trigger) { return trigger.getHandlerFunction() === "onBtsProductionFormSubmit" && trigger.getTriggerSourceId() === registry.formId; });
      if (matches.length > 1 || (matches.length && String(matches[0].getEventType()) !== String(ScriptApp.EventType.ON_FORM_SUBMIT))) btsFpFail_("trigger");
      var trigger = matches[0] || ScriptApp.newTrigger("onBtsProductionFormSubmit").forForm(form).onFormSubmit().create();
      registry.triggerUid = String(trigger.getUniqueId()); btsFpSaveRegistry_(registry); count++;
    });
    return { status: "installed", forms: count };
  } finally { lock.releaseLock(); }
}

/** Explicit publish operation. Requires production approvals and installed triggers. */
function publishBtsProductionFollowupForms() {
  var lock = LockService.getScriptLock(); lock.waitLock(BTS_LOCK_TIMEOUT_MS_);
  var forms = [];
  try {
    var context = btsFpContext_(new Date());
    ["ja", "en"].forEach(function(language) {
      var registry = btsFpRegistry_(language); var form = btsFpVerify_(context, registry, false);
      if (!btsFpTriggerExists_(registry)) btsFpFail_("trigger");
      forms.push(form);
    });
    forms.forEach(function(form) { form.setPublished(true); form.setAcceptingResponses(true); if (!form.isPublished() || !form.isAcceptingResponses()) btsFpFail_("closed"); });
    return { status: "published", forms: forms.length };
  } catch (error) {
    forms.forEach(function(form) { try { btsFormsClose_(form); } catch (_) {} });
    throw new Error("forms_production_publish_failed");
  } finally { lock.releaseLock(); }
}

function btsFpParent_(context, followupId) {
  var spreadsheet = context.spreadsheet; var s = context.settings;
  var stored = httpFindRow_(spreadsheet, "FollowUp", "followup_id", followupId);
  if (!stored || stored.object.requested !== true) btsFpFail_("parent");
  var row = stored.object;
  var parent = httpFindRow_(spreadsheet, "Participants", "submission_id", row.submission_id);
  var assignment = httpFindRow_(spreadsheet, "Assignments", "assignment_id", row.assignment_id);
  if (!parent || !assignment || row.experiment_id !== s.experimentId || row.allocation_version !== s.allocationVersion ||
      row.instrument_version !== s.instrumentVersion || row.instrument_hash !== s.instrumentHash ||
      row.content_version !== s.contentVersion || row.common_correction_version !== s.commonCorrectionVersion ||
      String(row.participant_id_normalized).length !== 6 || !/^[A-Z]{4}[0-9]{2}$/.test(String(row.participant_id_normalized)) || BTS_STORES_.indexOf(row.store_id) < 0 || BTS_CONDITIONS_.indexOf(row.condition) < 0) btsFpFail_("parent");
  [parent.object, assignment.object].forEach(function(other) {
    ["experiment_id", "allocation_version", "assignment_id", "participant_id_normalized", "store_id", "condition"].forEach(function(key) { if (other[key] !== row[key]) btsFpFail_("parent"); });
  });
  if (parent.object.session_id !== row.session_id || assignment.object.session_id !== row.session_id || parent.object.content_version !== s.contentVersion ||
      parent.object.common_correction_version !== s.commonCorrectionVersion || parent.object.instrument_version !== s.instrumentVersion ||
      parent.object.completion_status !== "completed" || assignment.object.status !== "confirmed" || String(assignment.object.is_test).toLowerCase() === "true") btsFpFail_("parent");
  return stored;
}
function btsFpBinding_(context, registry, row) {
  return { followup_id: row.followup_id, parent_submission_id: row.submission_id, experiment_id: row.experiment_id,
    allocation_version: row.allocation_version, assignment_id: row.assignment_id, session_id: row.session_id,
    participant_id_normalized: row.participant_id_normalized, store_id: row.store_id, condition: row.condition,
    phase: "followup", language: registry.language, form_id: registry.formId, instrument_version: registry.instrumentVersion,
    instrument_hash: registry.instrumentHash, instrument_digest: registry.digest, definition_hash: registry.definitionHash,
    content_hash: context.settings.contentHash, due_at: isoString_(row.send_at), expires_at: isoString_(row.token_expires_at) };
}
function btsFpCredential_(qualification) {
  var secret = PropertiesService.getScriptProperties().getProperty("BTS_FORMS_QUALIFICATION_SECRET");
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) btsFpFail_("credential");
  return Utilities.computeHmacSha256Signature("bts-forms-v1|" + qualification.qualification_id + "|" + qualification.issued_at + "|" + qualification.binding_json, secret)
    .map(function(byte) { return ("0" + ((byte + 256) % 256).toString(16)).slice(-2); }).join("");
}

/** Call ONLY after Web-token verification; owns the project ScriptLock. */
function btsFormsFollowupLink_(spreadsheet, record, language, now) {
  var lock = LockService.getScriptLock(); lock.waitLock(BTS_LOCK_TIMEOUT_MS_);
  try {
    var context = btsFpContext_(now);
    if (spreadsheet.getId() !== context.spreadsheet.getId() || ["ja", "en"].indexOf(language) < 0) btsFpFail_("parent");
    var stored = btsFpParent_(context, record.followup_id); var row = stored.object;
    if (record.token_hash !== row.token_hash || record.assignment_id !== row.assignment_id || record.submission_id !== row.submission_id || record.session_id !== row.session_id) btsFpFail_("parent");
    var due = asDate_(row.send_at), expires = asDate_(row.token_expires_at);
    if (!due || !expires || now < due || now > expires || row.response_submission_id || row.response_completed_at) btsFpFail_("not_available");
    var registry = btsFpRegistry_(language); var form = btsFpVerify_(context, registry, true);
    var binding = btsFpJson_(btsFpBinding_(context, registry, row));
    var target = btsFpSheet_(spreadsheet, "FormsQualifications", false);
    var found = readSheetObjects_(target.sheet, target.definition).filter(function(q) { return q.followup_id === row.followup_id && q.language === language && q.status === "issued" && q.binding_json === binding; });
    if (found.length > 1) btsFpFail_("credential");
    var q = found[0];
    if (!q) {
      q = { qualification_id: Utilities.getUuid(), followup_id: row.followup_id, language: language, form_id: registry.formId,
        binding_json: binding, issued_at: now.toISOString(), expires_at: expires.toISOString(), status: "issued", receipt_key: "" };
      q.credential_hash = sha256Hex_(btsFpCredential_(q)); btsFpAppend_(spreadsheet, "FormsQualifications", q);
    }
    var credential = btsFpCredential_(q);
    if (sha256Hex_(credential) !== q.credential_hash) btsFpFail_("credential");
    var participantMap = registry.itemMap.filter(function(item) { return item.sourceId === "participant_id"; })[0];
    var prefilled = form.createResponse().withItemResponse(form.getItemById(Number(registry.qualificationItemId)).asTextItem().createResponse(credential))
      .withItemResponse(form.getItemById(Number(participantMap.itemId)).asTextItem().createResponse(row.participant_id_normalized)).toPrefilledUrl();
    return { measurement_mode: "forms", form_url: prefilled, form_id: registry.formId, language: language, expires_at: expires.toISOString() };
  } finally { lock.releaseLock(); }
}

/** Installable FORM trigger only; sheet submit/namedValues events are not accepted. */
function onBtsProductionFormSubmit(e) {
  var now = new Date(); var receiptKey = ""; var context;
  var lock = LockService.getScriptLock(); lock.waitLock(BTS_LOCK_TIMEOUT_MS_);
  try {
    context = btsFpContext_(now);
    if (!e || !e.source || !e.response || !e.triggerUid || e.authMode !== ScriptApp.AuthMode.FULL) btsFpFail_("event");
    var formId = String(e.source.getId()); var responseId = String(e.response.getId());
    if (!responseId || responseId === "null" || responseId.length > 200) btsFpFail_("event");
    receiptKey = "forms_" + sha256Hex_(formId + "|" + responseId);
    var registries = [btsFpRegistry_("ja"), btsFpRegistry_("en")];
    var matches = registries.filter(function(row) { return row.formId === formId && row.triggerUid === String(e.triggerUid); });
    if (matches.length !== 1) btsFpFail_("event");
    var registry = matches[0]; var form = btsFpVerify_(context, registry, false);
    // Re-fetch canonical response from the registered Google Form, never namedValues.
    var response = form.getResponse(responseId);
    if (!response || String(response.getId()) !== responseId || response.getTimestamp().getTime() !== e.response.getTimestamp().getTime()) btsFpFail_("event");
    var extracted = []; var credentials = [];
    response.getItemResponses().forEach(function(answer) {
      var item = answer.getItem(); var id = String(item.getId());
      if (id === registry.qualificationItemId) {
        if (String(item.getType()) !== "TEXT") btsFpFail_("credential");
        credentials.push(answer.getResponse());
      } else extracted.push({ itemId: id, type: String(item.getType()), response: answer.getResponse() });
    });
    if (credentials.length !== 1 || typeof credentials[0] !== "string" || credentials[0].length !== 64 || !/^[a-f0-9]{64}$/.test(credentials[0])) btsFpFail_("credential");
    var qRecord = btsFpFind_(context.spreadsheet, "FormsQualifications", "credential_hash", sha256Hex_(credentials[0]));
    if (!qRecord || btsFpCredential_(qRecord.object) !== credentials[0]) btsFpFail_("credential");
    var q = qRecord.object; var stored = btsFpParent_(context, q.followup_id); var row = stored.object;
    var exactBinding = q.binding_json === btsFpJson_(btsFpBinding_(context, registry, row));
    var revisedBinding = !exactBinding && typeof btsPostImageQualificationBindingMatches_ === "function" && btsPostImageQualificationBindingMatches_(context, registry, row, q);
    if ((!exactBinding && !revisedBinding) || q.form_id !== formId || q.language !== registry.language || q.expires_at !== isoString_(row.token_expires_at)) btsFpFail_("binding");
    var submitted = response.getTimestamp();
    if (!asDate_(q.issued_at) || submitted < asDate_(q.issued_at) || submitted < asDate_(row.send_at) || submitted > asDate_(q.expires_at) || submitted > now) btsFpFail_("expired");
    if ((q.status !== "issued" && q.status !== "processing" && q.status !== "consumed") ||
        (q.receipt_key && q.receipt_key !== receiptKey) || (row.response_submission_id && row.response_submission_id !== receiptKey)) btsFpFail_("conflict");
    if (row.response_completed_at && row.response_submission_id !== receiptKey) btsFpFail_("conflict");
    var identity = { experiment_id: row.experiment_id, allocation_version: row.allocation_version, assignment_id: row.assignment_id,
      session_id: row.session_id, participant_id_normalized: row.participant_id_normalized, store_id: row.store_id, condition: row.condition };
    // A credential issued before the approved image-only transition retains
    // its ORIGINAL digest in normalized answers and receipt hashing. Otherwise
    // an already saved/partially saved response would look edited on retry even
    // though all follow-up questions and submitted answers are unchanged.
    var responseRegistry = registry;
    if (revisedBinding) {
      responseRegistry = btsFpRebindCopy_(registry);
      responseRegistry.digest = JSON.parse(q.binding_json).instrument_digest;
      responseRegistry.itemMap.forEach(function(map) { map.instrumentDigest = responseRegistry.digest; });
    }
    var normalized = normalizeFormsResponse_({ identity: identity, instrument: { experimentId: registry.experimentId,
      instrumentVersion: registry.instrumentVersion, instrumentHash: registry.instrumentHash, digest: responseRegistry.digest,
      phase: "followup", language: registry.language, items: context.definitions[registry.language].items }, registry: responseRegistry },
      { formId: formId, responseId: responseId, submittedAt: submitted.toISOString(), itemResponses: extracted }, now.toISOString(), BTS_FORMS_SERVER_KEYS_);
    // Ingestion time can differ on retry. The first value is preserved, not hashed.
    var hashSource = JSON.parse(JSON.stringify(normalized)); delete hashSource.ingested_at;
    var payloadHash = sha256Hex_(btsFpJson_(hashSource));
    var prior = btsFpFind_(context.spreadsheet, "FormsResponses", "receipt_key", receiptKey);
    if (prior && (prior.object.payload_hash !== payloadHash || prior.object.form_id !== formId || prior.object.google_response_id !== responseId ||
        prior.object.followup_id !== row.followup_id || prior.object.parent_submission_id !== row.submission_id || prior.object.assignment_id !== row.assignment_id ||
        prior.object.participant_id_normalized !== row.participant_id_normalized || prior.object.store_id !== row.store_id || prior.object.condition !== row.condition)) btsFpFail_("edited_response");
    var receipt = httpFindRow_(context.spreadsheet, "SubmissionReceipts", "submission_id", receiptKey);
    if (receipt && (receipt.object.payload_hash !== payloadHash || receipt.object.followup_id !== row.followup_id || receipt.object.event_type !== "followup")) btsFpFail_("conflict");
    if (receipt) ["experiment_id", "allocation_version", "assignment_id", "session_id", "participant_id_normalized", "store_id", "condition"].forEach(function(key) { if (receipt.object[key] !== row[key]) btsFpFail_("conflict"); });
    if (receipt && receipt.object.status === "complete" && row.response_completed_at && q.status === "consumed") return { status: "duplicate", receipt_key: receiptKey };
    // Reserve the same shared completion slot the Web route checks, under its lock.
    updateMappedRow_(context.spreadsheet.getSheetByName("FollowUp"), sheetDefinition_("FollowUp"), stored.rowIndex,
      { response_submission_id: receiptKey, status: "processing_forms" });
    btsFpUpdate_(context.spreadsheet, "FormsQualifications", qRecord.rowIndex, { status: "processing", receipt_key: receiptKey });
    if (!prior) btsFpAppend_(context.spreadsheet, "FormsResponses", { receipt_key: receiptKey, form_id: formId, google_response_id: responseId,
      followup_id: row.followup_id, parent_submission_id: row.submission_id, assignment_id: row.assignment_id,
      participant_id_normalized: row.participant_id_normalized, store_id: row.store_id, condition: row.condition,
      language: registry.language, instrument_version: registry.instrumentVersion, instrument_hash: registry.instrumentHash,
      measurement_mode: "forms", google_submitted_at: normalized.google_submitted_at, ingested_at: normalized.ingested_at,
      payload_hash: payloadHash, normalized_json: JSON.stringify(normalized) });
    if (!receipt) {
      appendMappedRow_(context.spreadsheet.getSheetByName("SubmissionReceipts"), sheetDefinition_("SubmissionReceipts"), {
        received_at: now, submission_id: receiptKey, schema_version: 2, experiment_id: row.experiment_id, session_id: row.session_id,
        participant_id: row.participant_id_normalized, participant_id_normalized: row.participant_id_normalized, store_id: row.store_id,
        condition: row.condition, status: "processing", assignment_id: row.assignment_id, allocation_version: row.allocation_version,
        event_type: "followup", followup_id: row.followup_id, payload_hash: payloadHash });
      receipt = httpFindRow_(context.spreadsheet, "SubmissionReceipts", "submission_id", receiptKey);
    }
    updateMappedRow_(context.spreadsheet.getSheetByName("FollowUp"), sheetDefinition_("FollowUp"), stored.rowIndex, {
      status: "completed", response_submission_id: receiptKey, response_completed_at: normalized.google_submitted_at,
      response_received_at: prior ? prior.object.ingested_at : normalized.ingested_at, response_started_at: "",
      response_language: registry.language, response_timing: submitted > asDate_(row.window_ends_at) ? "late" : "in_window",
      response_payload_hash: payloadHash, answers_json: JSON.stringify(normalized.answers), delivery_mode: "google_forms" });
    updateMappedRow_(context.spreadsheet.getSheetByName("SubmissionReceipts"), sheetDefinition_("SubmissionReceipts"), receipt.rowIndex,
      { status: "complete", completed_at: submitted, last_error: "" });
    btsFpUpdate_(context.spreadsheet, "FormsQualifications", qRecord.rowIndex, { status: "consumed", receipt_key: receiptKey });
    SpreadsheetApp.flush();
    return { status: "accepted", receipt_key: receiptKey };
  } catch (error) {
    // No raw event, values, token, email, URL, stack or unexpected error message.
    var reason = /^forms_production_(?:event|credential|parent|binding|expired|conflict|edited_response|registry|instrument|privacy|closed|form_changed)$/.test(String(error && error.message)) ? error.message : "forms_production_rejected";
    if (context && receiptKey) {
      try { if (!btsFpFind_(context.spreadsheet, "FormsQuarantine", "receipt_key", receiptKey)) btsFpAppend_(context.spreadsheet, "FormsQuarantine", { receipt_key: receiptKey, received_at: now.toISOString(), reason: reason }); } catch (_) {}
    }
    return { status: "rejected", reason: reason };
  } finally { lock.releaseLock(); }
}
