"use strict";
// Synthetic/offline only. No real Google calls, answers, emails or credentials.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const release = require("../scripts/release-lib");
const root = path.resolve(__dirname, "..");
let checks = 0;
function check(value, label) { checks++; assert.ok(value, label); }
function equal(actual, expected, label) { checks++; assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), label); }
function copy(value) { return JSON.parse(JSON.stringify(value)); }
const source = fs.readFileSync(path.join(__dirname, "run-forms-production-tests.js"), "utf8");
const reused = vm.createContext({ require, console, Buffer, __dirname });
vm.runInContext(source.slice(0, source.indexOf("const setup = fixture();")) + "\nthis.makeFixture = fixture;", reused);
const artifactDirectory = fs.readdirSync(path.join(root, "dist")).filter(name => name.startsWith("production-post-images-")).sort().at(-1);
if (!artifactDirectory) throw new Error("Build the private image-revision artifact before this isolated test.");
const prototype = JSON.parse(fs.readFileSync(path.join(root, "dist", artifactDirectory, "post-image-revision.private.json"), "utf8"));
const operating = JSON.parse(fs.readFileSync(path.join(root, "../production-operating-20260929.private.json"), "utf8"));
function fixture() {
  const f = reused.makeFixture(), c = f.c;
  c.BTS_GOOGLE_FORMS_DRAFT_DATA_ = copy(prototype.oldFormsData);
  f.settings.contentHash = prototype.oldContentHash;
  f.prepare();
  const request = copy(prototype); request.spreadsheetId = c.spreadsheet.getId();
  request.formIds = { ja: f.registry("ja").formId, en: f.registry("en").formId };
  const owner = { getEmail: () => "researcher@example.invalid" };
  c.DriveApp.getRootFolder = () => ({ getOwner: () => owner });
  const originalFile = c.DriveApp.getFileById;
  c.DriveApp.getFileById = id => { const file = originalFile.call(c.DriveApp, id); file.getOwner = () => owner; return file; };
  const config = { ...copy(f.settings) }; delete config.mode;
  for (const key of ["opensAt", "enrollmentOpensAt", "enrollmentClosesAt", "completionClosesAt", "closesAt", "maxAssignments", "maxDailyAssignments"]) config[key] = operating[key];
  const props = c.PropertiesService.getScriptProperties();
  props.setProperties = updates => { Object.keys(updates).forEach(key => props.setProperty(key, updates[key])); return props; };
  c.PropertiesService.getScriptProperties = () => props;
  props.setProperties({ BTS_SPREADSHEET_ID: config.spreadsheetId, BTS_HTTP_MODE: "production", BTS_PRODUCTION_ENABLED: "true", BTS_EMAIL_ENABLED: "true",
    BTS_PRODUCTION_EMAIL_APPROVED: "true", BTS_PRODUCTION_EMAIL_BATCH_LIMIT: "10", BTS_PRODUCTION_EMAIL_DAILY_LIMIT: "100",
    BTS_PRODUCTION_CONFIG: JSON.stringify(config), BTS_PRODUCTION_REVIEW: JSON.stringify(request.oldReview),
    BTS_PRODUCTION_PARTICIPANT_SECRET: "a".repeat(64), BTS_PUBLIC_APP_URL: config.publicAppUrl,
    BTS_FOLLOWUP_INSTRUMENT_VERSION: config.instrumentVersion, BTS_FOLLOWUP_INSTRUMENT_HASH: config.instrumentHash,
    BTS_FOLLOWUP_QUESTION_IDS: c.BTS_GOOGLE_FORMS_DRAFT_DATA_.forms.find(row => row.phase === "followup" && row.language === "ja").items.filter(row => row.type !== "notice").map(row => row.id).join(","),
    BTS_FOLLOWUP_OPTIONAL_QUESTION_IDS: "" }, false);
  c.BTS_GOOGLE_FORMS_DRAFT_DATA_ = copy(request.newFormsData);
  c.BTS_PRODUCTION_POST_IMAGE_REVISION_ = request;
  for (const name of ["Production.gs", "ProductionRevision.gs"]) vm.runInContext(fs.readFileSync(path.join(root, "gas", name), "utf8"), c, { filename: name });
  function runtimeSnapshot() { return JSON.stringify({ sheets: c.spreadsheet.sheets, forms: [...f.forms.values()].map(form => ({ id: form.id, title: form.getTitle(), signature: c.btsFpSignature_(form), published: form.isPublished(), accepting: form.isAcceptingResponses(), count: form.submitted.size })), triggers: f.triggers.map(t => t.uid) }); }
  return { ...f, request, props, config, runtimeSnapshot };
}
const f = fixture();
check(f.c.btsFormsProductionReadiness_(new Date()).ready, "new code deploy uses exact old Forms-data while config is still old");
const row = f.parent(1), issued = f.issue(row), event = f.event(row, issued);
const savedBefore = f.runtimeSnapshot(), beforeConfig = JSON.parse(f.props.getProperty("BTS_PRODUCTION_CONFIG")), oldCredential = f.c.btsFpFind_(f.c.spreadsheet, "FormsQualifications", "credential_hash", f.c.sha256Hex_(issued.credential)).object;
const flags = ["BTS_HTTP_MODE", "BTS_PRODUCTION_ENABLED", "BTS_EMAIL_ENABLED", "BTS_PRODUCTION_EMAIL_APPROVED", "BTS_PRODUCTION_PARTICIPANT_SECRET", "BTS_FORMS_QUALIFICATION_SECRET"].map(key => [key, f.props.getProperty(key)]);
check(f.c.applyBtsProductionPostImageRevision().status === "post_images_revised", "owner-approved image-only revision applies to used production storage");
equal(f.runtimeSnapshot(), savedBefore, "live answer/contact/assignment/followup/qualification rows, Forms bytes and triggers are untouched");
const nextConfig = JSON.parse(f.props.getProperty("BTS_PRODUCTION_CONFIG")); nextConfig.contentHash = beforeConfig.contentHash;
equal(nextConfig, beforeConfig, "only config contentHash changes; dates/caps/versions remain unchanged");
equal(flags.map(([key]) => [key, f.props.getProperty(key)]), flags, "live switches and both secrets preserved");
const audit = JSON.parse(f.props.getProperty("BTS_POST_IMAGE_REVISION_V1"));
check(Buffer.byteLength(JSON.stringify(audit)) < 9000, "compact immutable audit remains below Script Properties quota");
check(f.c.btsFormsProductionReadiness_(new Date()).ready, "new exact registry/data pair remains ready after update");
check(f.c.btsPostImageQualificationBindingMatches_(f.c.btsFpContext_(new Date()), f.registry("ja"), row, oldCredential), "previously issued credential accepts only exact old binding pair");
const accepted = f.c.onBtsProductionFormSubmit(event);
check(accepted.status === "accepted", "previously issued personal URL ingests after image-only update");
const normalizedOld = JSON.parse(f.c.btsFpFind_(f.c.spreadsheet, "FormsResponses", "receipt_key", accepted.receipt_key).object.normalized_json);
check(normalizedOld.instrument_digest === f.request.oldFormsData.digest, "old credential keeps original normalization digest and receipt hash");
check(f.c.onBtsProductionFormSubmit(event).status === "duplicate", "old qualified response retry stays idempotent after update");
const rowNew = f.parent(2), issuedNew = f.issue(rowNew, "en"), newAccepted = f.c.onBtsProductionFormSubmit(f.event(rowNew, issuedNew));
check(newAccepted.status === "accepted", "new qualified English response ingests with current image revision metadata");
const normalizedNew = JSON.parse(f.c.btsFpFind_(f.c.spreadsheet, "FormsResponses", "receipt_key", newAccepted.receipt_key).object.normalized_json);
check(normalizedNew.instrument_digest === f.request.newFormsData.digest && f.request.newFormsData.digest === f.request.oldFormsData.digest, "new credential retains the exact pinned follow-up dataset digest");
const afterAccepted = f.runtimeSnapshot();
check(f.c.applyBtsProductionPostImageRevision().status === "post_images_already_revised", "owner maintenance retry reports already applied");
equal(f.runtimeSnapshot(), afterAccepted, "retry cannot rewrite newly ingested responses");
const partialRegistry = copy(f.registry("en")); partialRegistry.contentHash = f.request.oldContentHash; partialRegistry.digest = f.request.oldFormsData.digest;
partialRegistry.itemMap.forEach(map => { map.instrumentDigest = partialRegistry.digest; }); f.c.btsFpSaveRegistry_(partialRegistry);
check(f.c.applyBtsProductionPostImageRevision().status === "post_images_revised", "interrupted metadata write rolls forward only the same exact approved snapshots");
equal(f.runtimeSnapshot(), afterAccepted, "metadata recovery leaves all existing answer and credential rows untouched");

const completed = fixture(), completedRow = completed.parent(3), completedIssued = completed.issue(completedRow), completedEvent = completed.event(completedRow, completedIssued);
check(completed.c.onBtsProductionFormSubmit(completedEvent).status === "accepted", "fixture records an old pre-revision Forms receipt");
completed.c.applyBtsProductionPostImageRevision();
check(completed.c.onBtsProductionFormSubmit(completedEvent).status === "duplicate", "pre-revision full receipt retry does not falsely report edited_response");
const partial = fixture(), partialRow = partial.parent(4), partialIssued = partial.issue(partialRow), partialEvent = partial.event(partialRow, partialIssued);
const partialFirst = partial.c.onBtsProductionFormSubmit(partialEvent);
check(partialFirst.status === "accepted", "fixture stores the original normalized partial-retry source");
const qPartial = partial.c.btsFpFind_(partial.c.spreadsheet, "FormsQualifications", "credential_hash", partial.c.sha256Hex_(partialIssued.credential));
partial.c.btsFpUpdate_(partial.c.spreadsheet, "FormsQualifications", qPartial.rowIndex, { status: "processing" });
const receiptPartial = partial.c.httpFindRow_(partial.c.spreadsheet, "SubmissionReceipts", "submission_id", partialFirst.receipt_key);
partial.c.updateMappedRow_(partial.c.spreadsheet.getSheetByName("SubmissionReceipts"), partial.c.sheetDefinition_("SubmissionReceipts"), receiptPartial.rowIndex, { status: "processing" });
const followupPartial = partial.c.httpFindRow_(partial.c.spreadsheet, "FollowUp", "followup_id", partialRow.followup_id);
partial.c.updateMappedRow_(partial.c.spreadsheet.getSheetByName("FollowUp"), partial.c.sheetDefinition_("FollowUp"), followupPartial.rowIndex, { response_completed_at: "", status: "processing_forms" });
partial.c.applyBtsProductionPostImageRevision();
check(partial.c.onBtsProductionFormSubmit(partialEvent).status === "accepted", "pre-revision partial-ingestion retry retains same hash and completes safely");

function seal(request, c) {
  for (const side of ["old", "new"]) {
    request[side + "ContentHash"] = c.btsPrHash_(request[side + "ReviewContent"]); request[side + "Review"].contentSha256 = request[side + "ContentHash"];
    const data = copy(request[side + "FormsData"]); delete data.digest; request[side + "FormsData"].digest = c.btsPrHash_(data);
  }
  c.BTS_GOOGLE_FORMS_DRAFT_DATA_ = request.newFormsData;
}
const attacks = [
  ["learning question changed", r => { r.newReviewContent.correctedBase.questions[0].title = "changed"; }],
  ["post answer changed", r => { r.newReviewContent.evaluation.answerKeys.post.late_post_transfer_stop = "A"; }],
  ["post choices changed", r => { r.newReviewContent.evaluation.extensions.post.ja.find(i => i.id === "late_post_transfer_stop").choices[0] = "changed"; }],
  ["pre question changed", r => { r.newReviewContent.sharedSurveys.pre.en[0].title = "changed"; }],
  ["followup question changed", r => { r.newFormsData.forms.find(f => f.phase === "followup" && f.language === "ja").items[1].title = "changed"; }],
  ["followup image changed", r => { r.newFormsData.images["assets/late-followup-stop.svg"].base64 = "changed"; }],
  ["image hash differs from researcher-approved PNG", r => { r.newReviewContent.assets.find(asset => asset.path === "assets/late-post-stop-pov-v1.png").sha256 = "c".repeat(64); }],
  ["legacy definitions relabeled", r => { r.newReviewContent.evaluation.postImageRevisions["2026-late-post-diagram-v1"].ja[1].image = "assets/late-post-stop-pov-v1.png"; }],
  ["unapproved image path", r => { r.newReviewContent.evaluation.extensions.post.ja.find(i => i.id === "late_post_transfer_stop").image = "assets/other.png"; }],
  ["notice removes no-feedback premise", r => { r.newReviewContent.evaluation.extensions.post.en[0].title = "Look at the answer before answering"; }],
  ["revision changes core content version", r => { r.newReviewContent.contentVersion = "new-content-version"; }]
];
for (const [label, attack] of attacks) {
  const r = copy(f.request); attack(r); seal(r, f.c);
  checks++; assert.throws(() => f.c.btsPrSnapshots_(r, new Date()), /post_image_revision_/, label);
}
f.c.BTS_GOOGLE_FORMS_DRAFT_DATA_ = f.request.newFormsData;
const context = f.c.btsFpContext_(new Date()), registry = f.registry("ja");
for (const [label, attack] of [
  ["unapproved digest with old content hash", q => { const b = JSON.parse(q.binding_json); b.instrument_digest = "b".repeat(64); q.binding_json = f.c.btsPrJson_(b); }],
  ["arbitrary old content hash", q => { const b = JSON.parse(q.binding_json); b.content_hash = "e".repeat(64); q.binding_json = f.c.btsPrJson_(b); }],
  ["other participant binding", q => { const b = JSON.parse(q.binding_json); b.participant_id_normalized = "ABCD99"; q.binding_json = f.c.btsPrJson_(b); }],
  ["credential issued after cutoff", q => { const currentAudit = JSON.parse(f.props.getProperty("BTS_POST_IMAGE_REVISION_V1")); q.issued_at = new Date(Date.parse(currentAudit.appliedAt) + 1000).toISOString(); }]
]) { const q = copy(oldCredential); attack(q); check(!f.c.btsPostImageQualificationBindingMatches_(context, registry, row, q), label + " rejected"); }
for (const marker of [undefined, null, "2026-late-post-diagram-v1", "2026-10-post-pov-v1"]) {
  const payload = { summary: { post_image_version: marker } }, before = JSON.stringify(payload);
  f.c.btsValidateProductionPostImageExposure_(payload); equal(JSON.stringify(payload), before, "valid/legacy exposure never rewritten");
}
checks++; assert.throws(() => f.c.btsValidateProductionPostImageExposure_({ summary: { post_image_version: "arbitrary-image-version" } }), /production_invalid_post_image_version/);
console.log("Production post-image revision tests: " + checks + " assertions passed (offline only).");
