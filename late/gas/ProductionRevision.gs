/** Owner-run, prospective replacement of the TWO post-survey scene images.
 * Loading this module changes nothing. There is no HTTP route or trigger.
 * Existing assignments, answers, mail queues, credentials and Forms are never
 * rewritten. The exact prior content/Forms-data pair remains usable ONLY by
 * qualifications issued before this recorded transition.
 */
var BTS_POST_IMAGE_REVISION_KEY_ = "BTS_POST_IMAGE_REVISION_V1";
var BTS_POST_IMAGE_REVISION_ID_ = "2026-10-post-pov-v1";
var BTS_POST_IMAGE_REVISION_ITEMS_ = ["late_post_transfer_stop", "late_post_transfer_pedestrian"];
var BTS_POST_IMAGE_REVISION_PATHS_ = {
  late_post_transfer_stop: { old: "assets/late-post-stop.svg", next: "assets/late-post-stop-pov-v1.png" },
  late_post_transfer_pedestrian: { old: "assets/late-post-pedestrian.svg", next: "assets/late-post-pedestrian-pov-v1.png" }
};
var BTS_POST_IMAGE_REVISION_SHA256_ = {
  "assets/late-post-stop-pov-v1.png": "2d68bbf8e3412e6a9f09fad6ea11a7fe156bae8664f07330fbd7d086fde8ad77",
  "assets/late-post-pedestrian-pov-v1.png": "c395d36e235d8cb50dbb6b568ddfa92cf2acb122b49de1dca808d2f7f35e2bff"
};
function btsPrFail_(reason) { throw new Error("post_image_revision_" + reason); }
function btsPrCopy_(value) { return JSON.parse(JSON.stringify(value)); }
function btsPrJson_(value) { return JSON.stringify(canonicalFollowupValue_(value)); }
function btsPrHash_(value) { return sha256Hex_(btsPrJson_(value)); }
function btsPrDigest_(data) {
  var unsigned = btsPrCopy_(data); delete unsigned.digest;
  if (!/^[a-f0-9]{64}$/.test(data.digest || "") || btsPrHash_(unsigned) !== data.digest) btsPrFail_("snapshot");
}
/** Allows deploying the new code BEFORE the owner changes metadata. The live
 * old config continues to use its exact approved Forms-data bytes throughout
 * the deployment/update interval; no temporary closure or weakened gate. */
function btsPostImageFormsData_(settings) {
  if (typeof BTS_PRODUCTION_POST_IMAGE_REVISION_ === "undefined") return BTS_GOOGLE_FORMS_DRAFT_DATA_;
  var request = BTS_PRODUCTION_POST_IMAGE_REVISION_;
  if (settings.contentHash === request.oldContentHash) return request.oldFormsData;
  if (settings.contentHash === request.newContentHash) return request.newFormsData;
  btsPrFail_("state");
}
function btsValidateProductionPostImageExposure_(payload) {
  var marker = payload.summary && payload.summary.post_image_version;
  // Missing/null belongs to old unmarked payloads. Never populate or relabel
  // it server-side, because that would alter receipts and misstate exposure.
  if (marker === undefined || marker === null) return;
  if (marker !== "2026-late-post-diagram-v1" && marker !== BTS_POST_IMAGE_REVISION_ID_) throw new Error("production_invalid_post_image_version");
}
function btsPrItems_(before, after, language) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) btsPrFail_("scope");
  var old = btsPrCopy_(before), next = btsPrCopy_(after), seen = {};
  old.forEach(function(item, index) {
    var revised = next[index];
    if (!isPlainObject_(item) || !isPlainObject_(revised) || item.id !== revised.id) btsPrFail_("scope");
    if (BTS_POST_IMAGE_REVISION_ITEMS_.indexOf(item.id) >= 0) {
      if (seen[item.id] || item.image !== BTS_POST_IMAGE_REVISION_PATHS_[item.id].old ||
          revised.image !== BTS_POST_IMAGE_REVISION_PATHS_[item.id].next || item.modality !== "diagram" ||
          revised.modality !== "first_person_generated_image" || revised.imageVersion !== BTS_POST_IMAGE_REVISION_ID_ ||
          typeof revised.imageAlt !== "string" || !revised.imageAlt.trim() || revised.imageAlt.length > 1200) btsPrFail_("scope");
      // Only the reference to the representation may change. Scenario premises,
      // options, scoring domains and correct answers must remain byte-identical.
      var expectedTitle = language === "ja" ? item.title.replace("図の交差点", "画像の交差点").replace("図のように", "画像のように") : item.title;
      if (revised.title !== expectedTitle) btsPrFail_("scope");
      [item, revised].forEach(function(row) { ["image", "imageAlt", "imageVersion", "modality", "title"].forEach(function(key) { delete row[key]; }); });
      seen[item.id] = true;
    } else if (item.id === "late_post_transfer_notice") {
      var oldNotice = language === "ja" ? "追加確認：ここからは、学習時とは異なる場面で判断してください。図は位置関係を示す模式図です。正誤の解説は表示されません。" : "Additional check: Judge situations that differ from the learning scenes. The diagrams show relative positions. Correctness feedback will not be shown.";
      var nextNotice = language === "ja" ? "追加確認：ここからは、学習時とは異なる場面で判断してください。画像は実際の場面を模した一人称視点の生成画像です。正誤の解説は表示されません。" : "Additional check: Judge situations that differ from the learning scenes. The images are generated first-person scenes representing real situations. Correctness feedback will not be shown.";
      if (item.title !== oldNotice || revised.title !== nextNotice) btsPrFail_("scope");
      delete item.title; delete revised.title;
    }
  });
  if (Object.keys(seen).sort().join(",") !== BTS_POST_IMAGE_REVISION_ITEMS_.slice().sort().join(",") || btsPrJson_(old) !== btsPrJson_(next)) btsPrFail_("scope");
  return { old: old, next: next };
}
function btsPrAssets_(oldContent, newContent, oldData, newData) {
  var oldPaths = BTS_POST_IMAGE_REVISION_ITEMS_.map(function(id) { return BTS_POST_IMAGE_REVISION_PATHS_[id].old; });
  var newPaths = BTS_POST_IMAGE_REVISION_ITEMS_.map(function(id) { return BTS_POST_IMAGE_REVISION_PATHS_[id].next; });
  function assets(content, paths) {
    if (!Array.isArray(content.assets)) btsPrFail_("scope");
    paths.forEach(function(path) { if (content.assets.filter(function(row) { return row.path === path && /^[a-f0-9]{64}$/.test(row.sha256 || ""); }).length !== 1) btsPrFail_("scope"); });
    return content.assets.filter(function(row) { return paths.indexOf(row.path) < 0; });
  }
  // Legacy SVG assets remain available for sessions which had already opened
  // the old post questionnaire. Only the two approved PNG paths are added.
  assets(oldContent, oldPaths); assets(newContent, oldPaths);
  var stableOld = oldContent.assets, stableNext = assets(newContent, newPaths);
  if (btsPrJson_(stableOld) !== btsPrJson_(stableNext)) btsPrFail_("scope");
  newPaths.forEach(function(path) {
    if (newContent.assets.filter(function(row) { return row.path === path; })[0].sha256 !== BTS_POST_IMAGE_REVISION_SHA256_[path]) btsPrFail_("scope");
  });
  [oldData, newData].forEach(function(data) { if (!isPlainObject_(data.images)) btsPrFail_("scope"); });
  // Production consumes follow-up definitions ONLY. Preserve its complete
  // previously installed dataset byte-for-byte instead of migrating unrelated
  // draft post Forms or embedding unused 6 MB Web-only PNGs in Apps Script.
  if (btsPrJson_(oldData.images) !== btsPrJson_(newData.images)) btsPrFail_("followup_changed");
}
function btsPrSnapshots_(request, now) {
  var keys = ["schemaVersion", "reason", "revisionId", "formsDatasetPolicy", "adoptionReceivedAt", "spreadsheetId", "formIds", "oldContentHash", "newContentHash", "oldReviewContent", "newReviewContent", "oldFormsData", "newFormsData", "oldReview", "newReview"];
  if (!isPlainObject_(request) || Object.keys(request).sort().join(",") !== keys.sort().join(",") || request.schemaVersion !== 1 ||
      request.reason !== "researcher_adopted_post_images" || request.revisionId !== BTS_POST_IMAGE_REVISION_ID_ ||
      request.formsDatasetPolicy !== "preserve_existing_followup_dataset" ||
      !btsFpRebindDate_(request.adoptionReceivedAt, now) || !isPlainObject_(request.formIds) ||
      Object.keys(request.formIds).sort().join(",") !== "en,ja" || !request.formIds.ja || !request.formIds.en || request.formIds.ja === request.formIds.en) btsPrFail_("snapshot");
  ["old", "new"].forEach(function(side) {
    var content = request[side + "ReviewContent"], data = request[side + "FormsData"], review = request[side + "Review"];
    if (!isPlainObject_(content) || !isPlainObject_(content.evaluation) || !isPlainObject_(data) || !isPlainObject_(review) ||
        !/^[a-f0-9]{64}$/.test(request[side + "ContentHash"] || "") || btsPrHash_(content) !== request[side + "ContentHash"] ||
        review.contentSha256 !== request[side + "ContentHash"] || typeof review.reviewer !== "string" || !review.reviewer.trim() ||
        !btsFpRebindDate_(review.reviewedAt, now) || !isPlainObject_(review.approvals) ||
        ["noImageScenes", "improvedContent", "conditionNeutralPostSurvey", "lateEvaluationInstruments", "followupInstrumentAndUrl"].some(function(key) { return review.approvals[key] !== true; })) btsPrFail_("snapshot");
    btsPrDigest_(data);
  });
  if (request.oldContentHash === request.newContentHash || btsPrJson_(request.oldFormsData) !== btsPrJson_(request.newFormsData) ||
      request.oldReview.reviewer !== request.newReview.reviewer || request.newReview.reviewedAt !== request.adoptionReceivedAt ||
      asDate_(request.newReview.reviewedAt) < asDate_(request.oldReview.reviewedAt) || btsPrJson_(request.newFormsData) !== btsPrJson_(BTS_GOOGLE_FORMS_DRAFT_DATA_)) btsPrFail_("snapshot");
  var before = btsPrCopy_(request.oldReviewContent), after = btsPrCopy_(request.newReviewContent);
  if (before.evaluation.postImageVersion !== undefined || before.evaluation.legacyPostImageVersion !== undefined || before.evaluation.postImageRevisions !== undefined ||
      after.evaluation.postImageVersion !== BTS_POST_IMAGE_REVISION_ID_ || after.evaluation.legacyPostImageVersion !== "2026-late-post-diagram-v1" ||
      !isPlainObject_(after.evaluation.postImageRevisions) || Object.keys(after.evaluation.postImageRevisions).sort().join(",") !== [BTS_POST_IMAGE_REVISION_ID_, "2026-late-post-diagram-v1"].sort().join(",")) btsPrFail_("scope");
  var sceneIds = ["late_post_transfer_notice"].concat(BTS_POST_IMAGE_REVISION_ITEMS_);
  ["ja", "en"].forEach(function(language) {
    var oldItems = before.evaluation.extensions.post[language].filter(function(item) { return sceneIds.indexOf(item.id) >= 0; });
    var nextItems = after.evaluation.extensions.post[language].filter(function(item) { return sceneIds.indexOf(item.id) >= 0; });
    if (oldItems.length !== 3 || nextItems.length !== 3 ||
        btsPrJson_(after.evaluation.postImageRevisions["2026-late-post-diagram-v1"][language]) !== btsPrJson_(oldItems) ||
        btsPrJson_(after.evaluation.postImageRevisions[BTS_POST_IMAGE_REVISION_ID_][language]) !== btsPrJson_(nextItems)) btsPrFail_("scope");
  });
  ["postImageVersion", "legacyPostImageVersion", "postImageRevisions"].forEach(function(key) { delete after.evaluation[key]; });
  ["ja", "en"].forEach(function(language) {
    var shared = btsPrItems_(before.sharedSurveys.post[language], after.sharedSurveys.post[language], language);
    before.sharedSurveys.post[language] = shared.old; after.sharedSurveys.post[language] = shared.next;
    var added = btsPrItems_(before.evaluation.extensions.post[language], after.evaluation.extensions.post[language], language);
    before.evaluation.extensions.post[language] = added.old; after.evaluation.extensions.post[language] = added.next;
  });
  btsPrAssets_(request.oldReviewContent, request.newReviewContent, request.oldFormsData, request.newFormsData);
  delete before.assets; delete after.assets;
  if (btsPrJson_(before) !== btsPrJson_(after)) btsPrFail_("scope");
  return { requestHash: btsPrHash_(request) };
}
function btsPrRegistryPair_(registry, context, contentHash, data) {
  var next = btsPrCopy_(registry); next.contentHash = contentHash; next.digest = data.digest;
  next.itemMap.forEach(function(row) { row.instrumentDigest = data.digest; });
  if (next.definitionHash !== btsPrHash_(context.definitions[next.language])) btsPrFail_("followup_changed");
  return next;
}
/** Runs under the same lock as assignments, submissions, ingestion and mail. */
function applyBtsProductionPostImageRevision() {
  var lock = LockService.getScriptLock(); lock.waitLock(BTS_LOCK_TIMEOUT_MS_);
  try {
    if (typeof BTS_PRODUCTION_POST_IMAGE_REVISION_ === "undefined") btsPrFail_("snapshot_missing");
    return btsPrApply_(BTS_PRODUCTION_POST_IMAGE_REVISION_, new Date());
  } finally { lock.releaseLock(); }
}
function btsPrApply_(request, now) {
  var validated = btsPrSnapshots_(request, now), p = PropertiesService.getScriptProperties();
  if (p.getProperty("BTS_HTTP_MODE") !== "production" || p.getProperty("BTS_PRODUCTION_ENABLED") !== "true") btsPrFail_("live_required");
  var spreadsheet = requireActiveSpreadsheet_(), owner = btsFpRebindOwner_(spreadsheet);
  if (request.spreadsheetId !== spreadsheet.getId() || request.spreadsheetId !== p.getProperty("BTS_SPREADSHEET_ID") || spreadsheet.getName().indexOf("BTS 後期3群比較 本番 ") !== 0) btsPrFail_("spreadsheet");
  var config, review, audit;
  try { config = JSON.parse(p.getProperty("BTS_PRODUCTION_CONFIG")); review = JSON.parse(p.getProperty("BTS_PRODUCTION_REVIEW")); audit = JSON.parse(p.getProperty(BTS_POST_IMAGE_REVISION_KEY_) || "null"); }
  catch (_) { btsPrFail_("state"); }
  if (!isPlainObject_(config) || [request.oldContentHash, request.newContentHash].indexOf(config.contentHash) < 0 ||
      [btsPrJson_(request.oldReview), btsPrJson_(request.newReview)].indexOf(btsPrJson_(review)) < 0 ||
      audit && (audit.requestHash !== validated.requestHash || audit.revisionId !== request.revisionId || audit.status !== "applied")) btsPrFail_("state");
  var oldSettings = btsPrCopy_(config), newSettings = btsPrCopy_(config);
  oldSettings.contentHash = request.oldContentHash; newSettings.contentHash = request.newContentHash;
  btsProductionValidateScheduleReview_(oldSettings, request.oldReview, now); btsProductionValidateScheduleReview_(newSettings, request.newReview, now);
  var oldContext = btsFpContextForData_(oldSettings, spreadsheet, request.oldFormsData), newContext = btsFpContextForData_(newSettings, spreadsheet, request.newFormsData);
  var oldRegistries = {}, newRegistries = {};
  ["ja", "en"].forEach(function(language) {
    var current = btsFpRegistry_(language), oldRegistry = btsPrRegistryPair_(current, oldContext, request.oldContentHash, request.oldFormsData);
    var newRegistry = btsPrRegistryPair_(current, newContext, request.newContentHash, request.newFormsData);
    if (current.formId !== request.formIds[language] || [btsPrJson_(oldRegistry), btsPrJson_(newRegistry)].indexOf(btsPrJson_(current)) < 0) btsPrFail_("registry");
    // Verify actual published Forms twice against exact old/new follow-up plans.
    // No setter, response deletion, trigger installation or mail call is used.
    var form = btsFpVerify_(oldContext, oldRegistry, true); btsFpVerify_(newContext, newRegistry, true);
    var fileOwner = DriveApp.getFileById(form.getId()).getOwner();
    if (!fileOwner || fileOwner.getEmail() !== owner) btsPrFail_("owner");
    oldRegistries[language] = oldRegistry; newRegistries[language] = newRegistry;
  });
  if (audit) {
    var unsignedAudit = btsPrCopy_(audit); delete unsignedAudit.auditHash;
    if (audit.auditHash !== btsPrHash_(unsignedAudit)) btsPrFail_("state");
    if (config.contentHash === request.newContentHash && btsPrJson_(review) === btsPrJson_(request.newReview) &&
        ["ja", "en"].every(function(language) { return btsPrJson_(btsFpRegistry_(language)) === btsPrJson_(newRegistries[language]); })) {
      return { status: "post_images_already_revised", revisionId: request.revisionId, answerRowsChanged: 0, formsChanged: 0 };
    }
    // An interrupted multi-property write may be retried with ONLY the same
    // exact owner-approved snapshots. Previously validated old/new values are
    // rolled forward; no third hash, approval or registry is accepted.
  }
  var nextAudit = { schemaVersion: 1, status: "applied", revisionId: request.revisionId, requestHash: validated.requestHash,
    formsDatasetPolicy: request.formsDatasetPolicy,
    oldContentHash: request.oldContentHash, newContentHash: request.newContentHash, oldFormsDigest: request.oldFormsData.digest,
    newFormsDigest: request.newFormsData.digest, instrumentHash: config.instrumentHash,
    definitions: { ja: oldRegistries.ja.definitionHash, en: oldRegistries.en.definitionHash },
    adoptionReceivedAt: request.adoptionReceivedAt, appliedAt: now.toISOString(), reviewer: request.newReview.reviewer };
  nextAudit.auditHash = btsPrHash_(nextAudit);
  var updates = { BTS_PRODUCTION_CONFIG: JSON.stringify(newSettings), BTS_PRODUCTION_REVIEW: JSON.stringify(request.newReview) };
  ["ja", "en"].forEach(function(language) { updates[BTS_FORMS_PRODUCTION_KEY_ + ":" + language] = JSON.stringify(newRegistries[language]); });
  updates[BTS_POST_IMAGE_REVISION_KEY_] = JSON.stringify(nextAudit);
  p.setProperties(updates, false);
  if (Object.keys(updates).some(function(key) { return p.getProperty(key) !== updates[key]; })) btsPrFail_("verify_failed");
  btsProductionSettings_(now); btsFormsProductionReadiness_(now);
  var result = { status: "post_images_revised", revisionId: request.revisionId, oldContentHash: request.oldContentHash,
    newContentHash: request.newContentHash, appliedAt: nextAudit.appliedAt, answerRowsChanged: 0, formsChanged: 0, emailsSent: 0 };
  Logger.log(JSON.stringify(result)); return result;
}
/** Read-only operator proof without the old launch-template hash assumption. */
function reportBtsProductionPostImageRevisionReadiness() {
  var now = new Date(), config = btsProductionSettings_(now), spreadsheet = requireActiveSpreadsheet_();
  btsAssertProductionSpreadsheet_(spreadsheet, config);
  var rows = {}; spreadsheet.getSheets().forEach(function(sheet) { rows[sheet.getName()] = Math.max(0, sheet.getLastRow() - 1); });
  var audit = JSON.parse(PropertiesService.getScriptProperties().getProperty(BTS_POST_IMAGE_REVISION_KEY_) || "null");
  var result = { status: "read_only_image_revision_readiness", contentHash: config.contentHash, instrumentHash: config.instrumentHash,
    revisionId: audit ? audit.revisionId : null, appliedAt: audit ? audit.appliedAt : null,
    forms: btsFormsProductionReadiness_(now), emailEnabled: btsEmailApproved_(), tableRows: rows,
    triggers: ScriptApp.getProjectTriggers().map(function(trigger) { return { handler: trigger.getHandlerFunction(), event: String(trigger.getEventType()) }; }) };
  Logger.log(JSON.stringify(result)); return result;
}
/** Qualification compatibility is an exact previously approved binding pair,
 * never a wildcard hash or an exemption from identity/expiry/content checks. */
function btsPostImageQualificationBindingMatches_(context, registry, row, qualification) {
  var expected = btsFpBinding_(context, registry, row), current = btsPrJson_(expected);
  if (qualification.binding_json === current) return true;
  var audit;
  try { audit = JSON.parse(PropertiesService.getScriptProperties().getProperty(BTS_POST_IMAGE_REVISION_KEY_) || "null"); } catch (_) { return false; }
  if (!isPlainObject_(audit) || audit.schemaVersion !== 1 || audit.status !== "applied" || audit.revisionId !== BTS_POST_IMAGE_REVISION_ID_ ||
      audit.newContentHash !== context.settings.contentHash || audit.newFormsDigest !== registry.digest || audit.instrumentHash !== registry.instrumentHash ||
      !isPlainObject_(audit.definitions) || audit.definitions[registry.language] !== registry.definitionHash ||
      !/^[a-f0-9]{64}$/.test(audit.oldContentHash || "") || !/^[a-f0-9]{64}$/.test(audit.oldFormsDigest || "") ||
      !asDate_(qualification.issued_at) || !asDate_(audit.appliedAt) || asDate_(qualification.issued_at) > asDate_(audit.appliedAt)) return false;
  var unsigned = btsPrCopy_(audit); delete unsigned.auditHash;
  if (btsPrHash_(unsigned) !== audit.auditHash) return false;
  expected.content_hash = audit.oldContentHash; expected.instrument_digest = audit.oldFormsDigest;
  return qualification.binding_json === btsPrJson_(expected);
}
