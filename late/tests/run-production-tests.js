"use strict";
// Isolated service mocks. The synthetic review below is NEVER written to GAS,
// a release approval file, or any real research configuration.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const { loadExperiment, followupInstrumentSha256, productionPropertiesTemplate } = require("../scripts/release-lib");
const app = loadExperiment(root);
let assertions = 0;
function check(value, message) { assertions++; assert.ok(value, message); }
function fixture() {
  const c = vm.createContext({ require, console }); c.global = c;
  const mocks = fs.readFileSync(path.join(__dirname, "run-gas-mock-tests.js"), "utf8").split("let assertionCount = 0;")[0];
  vm.runInContext(mocks + '\nthis.sheet = installGasMocks(); sheet.name = "BTS 後期3群比較 本番 MOCK ONLY";', c);
  for (const file of ["Code.gs", "Production.gs"]) vm.runInContext(fs.readFileSync(path.join(root, "gas", file), "utf8"), c, { filename: file });
  const p = c.PropertiesService.getScriptProperties();
  const cfg = { spreadsheetId: c.sheet.getId(), experimentId: app.EXPERIMENT_CONFIG.experimentId,
    allocationVersion: app.EXPERIMENT_CONFIG.allocationVersion, appVersion: app.EXPERIMENT_CONFIG.appVersion,
    contentVersion: app.EXPERIMENT_CONFIG.contentVersion, commonCorrectionVersion: app.EXPERIMENT_CONFIG.commonCorrectionVersion,
    instrumentVersion: app.EVALUATION_DATA.instrumentVersion, instrumentHash: followupInstrumentSha256(app), contentHash: "a".repeat(64),
    publicAppUrl: "https://example.invalid/mock-only/", followupMode: "google_forms", opensAt: "2020-01-01T00:00:00Z", enrollmentClosesAt: "2098-01-01T00:00:00Z", closesAt: "2099-01-01T00:00:00Z", maxAssignments: 100, maxDailyAssignments: 20 };
  const review = { reviewer: "ISOLATED MOCK NOT A REAL APPROVAL", reviewedAt: "2020-01-01T00:00:00Z", contentSha256: cfg.contentHash,
    approvals: { noImageScenes: true, improvedContent: true, conditionNeutralPostSurvey: true, lateEvaluationInstruments: true, followupInstrumentAndUrl: true } };
  c.setupSheets();
  for (const [key, value] of Object.entries({ BTS_HTTP_MODE: "production", BTS_PRODUCTION_ENABLED: "true", BTS_PRODUCTION_CONFIG: JSON.stringify(cfg),
    BTS_PRODUCTION_REVIEW: JSON.stringify(review), BTS_PRODUCTION_PARTICIPANT_SECRET: "b".repeat(64), BTS_FOLLOWUP_TOKEN_SECRET: "mock-private-followup-secret",
    BTS_PUBLIC_APP_URL: cfg.publicAppUrl, BTS_FOLLOWUP_INSTRUMENT_VERSION: cfg.instrumentVersion, BTS_FOLLOWUP_INSTRUMENT_HASH: cfg.instrumentHash,
    BTS_FOLLOWUP_QUESTION_IDS: "late_followup_transfer_stop,late_followup_transfer_pedestrian,late_followup_transfer_phone,late_followup_transfer_age", BTS_EMAIL_ENABLED: "false" })) p.setProperty(key, value);
  const req = { callback: "prodTest", schema_version: "2", action: "assign", participant_id: "TEST01", store_id: "A", experiment_id: cfg.experimentId,
    allocation_version: cfg.allocationVersion, app_version: cfg.appVersion, client_run_id: "run_" + "c".repeat(32), session_id: "session_" + "d".repeat(32) };
  const get = params => {
    const out = c.doGet({ parameter: { callback: "prodTest", ...params } }).getContent();
    return JSON.parse(out.startsWith("prodTest(") ? out.slice(9, -2) : out);
  };
  const post = body => JSON.parse(c.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  const snapshot = () => JSON.stringify(c.sheet.sheets);
  function payload(assignment, wantsEmail = false) {
    const end = new Date(Date.now() - 10000).toISOString(), start = new Date(Date.now() - 600000).toISOString();
    const identity = { experiment_id: cfg.experimentId, assignment_id: assignment.assignment_id, session_id: req.session_id,
      participant_id: "TEST01", participant_id_normalized: "TEST01", store_id: "A", condition: assignment.condition,
      content_version: cfg.contentVersion, common_correction_version: cfg.commonCorrectionVersion, instrument_version: cfg.instrumentVersion };
    const logs = ["pre", "learning", "post"].map(phase => ({ ...identity, phase, event_id: "event_" + phase + "_mock_01", question_id: phase + "_mock", question_order: 1,
      selected_answer: "A", correct_answer: "A", is_correct: true, answered_at: end, response_time_ms: 1000 }));
    return { ...identity, schema_version: 2, submission_id: "completion_mock_00000001", app_version: cfg.appVersion,
      participant_token: assignment.participant_token, language: "ja", email: wantsEmail ? "mock@example.invalid" : "", experiment_date: end.slice(0, 10),
      start_time: start, end_time: end, consent: { given: true, given_at: start, version: "mock-consent" },
      allocation: { assignment_id: assignment.assignment_id, allocation_version: cfg.allocationVersion, client_run_id: req.client_run_id, status: "confirmed" },
      followup: { requested: wantsEmail, delivery_mode: "google_forms", instrument_version: cfg.instrumentVersion },
      pre_survey: { pre_mock: "A" }, post_survey: { post_mock: "A" }, answers: [logs[1]], question_logs: logs, summary: { overall_accuracy: 1 } };
  }
  return { c, p, cfg, review, req, get, post, snapshot, payload };
}
function denied(f, operation, error, label) {
  const before = f.snapshot(), result = operation();
  check(result.ok === false && result.error === error, label + ": " + JSON.stringify(result));
  check(f.snapshot() === before, label + " writes nothing");
}
{
  const f = fixture();
  for (const field of ["maxAssignments", "maxDailyAssignments"]) {
    for (const value of [undefined, null, 0, -1, 1.5, false, "", "100", "Unlimited", "none", {}, []]) {
      f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, [field]: value }));
      denied(f, () => f.get(f.req), "production_not_configured", "invalid capacity never means unlimited: " + field);
    }
  }
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, maxAssignments: "unlimited", maxDailyAssignments: "unlimited" }));
  const a = f.get(f.req);
  check(a.ok, "explicit owner choice permits uncapped enrollment");
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, maxAssignments: "unlimited", maxDailyAssignments: 1 }));
  denied(f, () => f.get({ ...f.req, participant_id: "TEST02" }), "production_capacity_reached", "unlimited total does not disable numeric daily cap");
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, maxAssignments: 1, maxDailyAssignments: "unlimited" }));
  denied(f, () => f.get({ ...f.req, participant_id: "TEST02" }), "production_capacity_reached", "unlimited daily does not disable numeric total cap");
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, maxAssignments: "unlimited", maxDailyAssignments: "unlimited" }));
  check(f.get({ ...f.req, participant_id: "TEST02" }).ok, "both explicitly unlimited allow another participant");
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, maxAssignments: "unlimited", maxDailyAssignments: "unlimited", enrollmentClosesAt: new Date(Date.now() - 60000).toISOString() }));
  denied(f, () => f.get({ ...f.req, participant_id: "TEST03" }), "production_enrollment_closed", "uncapped enrollment still closes on the exact intake deadline");
  check(f.get(f.req).reused, "uncapped existing session can resume after intake closes");
  check(f.c.MailApp.sent.length === 0, "capacity tests send no email");
}
{
  const template = JSON.parse(productionPropertiesTemplate(root).BTS_PRODUCTION_CONFIG);
  check(Object.hasOwn(template, "enrollmentClosesAt") && template.enrollmentClosesAt === "", "preparation template requires owner intake deadline without inventing it");
  const f = fixture();
  for (const deadline of [undefined, "", null, false, 0, "not-a-date", "2019-12-31T23:59:59Z", f.cfg.opensAt, f.cfg.closesAt, "2100-01-01T00:00:00Z"]) {
    f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, enrollmentClosesAt: deadline }));
    denied(f, () => f.get(f.req), "production_not_configured", "missing, invalid or non-separated intake deadline fails closed");
  }
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify(f.cfg));
  const deadline = new Date("2030-01-01T00:00:00.000Z");
  const cfg = { ...f.cfg, enrollmentClosesAt: deadline.toISOString() };
  const normalized = f.c.normalizeAssignmentRequest_(f.req);
  const before = f.snapshot();
  check(f.c.btsProductionCheckEnrollment_(normalized, cfg, null, new Date(deadline.getTime() - 1)) === undefined, "new enrollment allowed strictly before its deadline even on empty storage");
  for (const now of [deadline, new Date(deadline.getTime() + 1)]) {
    let error;
    try { f.c.btsProductionCheckEnrollment_(normalized, cfg, null, now); } catch (caught) { error = caught.message; }
    check(error === "production_enrollment_closed", "deadline and later reject even when Assignments sheet is absent");
    check(f.snapshot() === before, "deadline check does not create or mutate sheets");
  }
  f.p.setProperty("BTS_HTTP_MODE", "disabled"); f.p.setProperty("BTS_PRODUCTION_ENABLED", "false");
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, opensAt: "", enrollmentClosesAt: "", closesAt: "", maxAssignments: null, maxDailyAssignments: null }));
  check(f.c.btsProductionPreparationSettings_().enrollmentClosesAt === "", "closed resource preparation still permits deliberately unset dates");
  check(f.snapshot() === before && f.c.MailApp.sent.length === 0, "preparation date validation enables and sends nothing");
}
{
  const f = fixture();
  for (const key of ["BTS_PRODUCTION_ENABLED", "BTS_PRODUCTION_CONFIG", "BTS_PRODUCTION_REVIEW", "BTS_PRODUCTION_PARTICIPANT_SECRET"]) {
    const original = f.p.getProperty(key); f.p.deleteProperty(key);
    const before = f.snapshot(); check(f.get(f.req).ok === false, "missing " + key + " blocks"); check(f.snapshot() === before, "missing setting writes nothing");
    f.p.setProperty(key, original);
  }
  for (const approval of Object.keys(f.review.approvals)) {
    f.p.setProperty("BTS_PRODUCTION_REVIEW", JSON.stringify({ ...f.review, approvals: { ...f.review.approvals, [approval]: false } }));
    denied(f, () => f.get(f.req), "production_review_required", "actual review required " + approval);
  }
  f.p.setProperty("BTS_PRODUCTION_REVIEW", JSON.stringify(f.review));
  f.c.sheet.name = "BTS 後期3群比較 接続検証 MOCK";
  denied(f, () => f.get(f.req), "production_wrong_spreadsheet", "test sheet cannot become production");
  f.c.sheet.name = "BTS 後期3群比較 本番 MOCK ONLY";
  f.p.setProperty("BTS_HTTP_TEST_SPREADSHEET_ID", f.cfg.spreadsheetId);
  denied(f, () => f.get(f.req), "production_not_configured", "test id cannot become production");
  f.p.deleteProperty("BTS_HTTP_TEST_SPREADSHEET_ID");
  for (const mutation of [{ app_version: "wrong" }, { experiment_id: "wrong" }, { allocation_version: "wrong" }, { session_id: "short" }, { client_run_id: "short" }]) {
    denied(f, () => f.get({ ...f.req, ...mutation }), "production_version_mismatch", "assignment fixed config");
  }
  const a = f.get(f.req); check(a.ok && /^[a-f0-9]{64}$/.test(a.participant_token) && a.session_id === f.req.session_id, "new assignment authenticated");
  const retry = f.get(f.req); check(retry.reused && retry.participant_token === a.participant_token, "same exact session retry recovers same credential");
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, enrollmentClosesAt: new Date(Date.now() - 60000).toISOString() }));
  denied(f, () => f.get({ ...f.req, participant_id: "TEST02" }), "production_enrollment_closed", "new participant rejected after intake deadline");
  const resumedAfterIntake = f.get(f.req);
  check(resumedAfterIntake.ok && resumedAfterIntake.reused && resumedAfterIntake.participant_token === a.participant_token, "same exact session can recover after intake deadline");
  for (const mutation of [{ session_id: "session_" + "e".repeat(32) }, { client_run_id: "run_" + "f".repeat(32) }]) {
    denied(f, () => f.get({ ...f.req, ...mutation }), "production_session_conflict", "knowing participant id is insufficient");
  }
  check(!f.snapshot().includes(a.participant_token) && !f.snapshot().includes("b".repeat(64)), "capability and secret never stored in sheet");
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, maxAssignments: 1 }));
  denied(f, () => f.get({ ...f.req, participant_id: "TEST02" }), "production_capacity_reached", "global enrollment cap");
  check(f.get(f.req).ok, "existing retry works when cap full");
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, maxDailyAssignments: 1 }));
  denied(f, () => f.get({ ...f.req, participant_id: "TEST02" }), "production_capacity_reached", "daily enrollment cap");
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, enrollmentClosesAt: new Date(Date.now() - 60000).toISOString() }));
  const body = f.payload(a);
  for (const mutation of [{ participant_token: "e".repeat(64) }, { participant_token: "" }, { session_id: "wrong-session-0123456789" }]) {
    denied(f, () => f.post({ ...body, ...mutation }), "production_unauthorized", "completion credential check");
  }
  for (const mutation of [{ app_version: "wrong" }, { content_version: "wrong" }, { language: "fr" }, { consent: { given: false } }, { followup: { requested: false, delivery_mode: "web_token" } }]) {
    denied(f, () => f.post({ ...body, ...mutation }), "production_payload_mismatch", "completion scope check");
  }
  denied(f, () => f.post({ ...body, event_type: "followup" }), "production_forms_only", "Web followup submission disabled");
  denied(f, () => f.post({ ...body, end_time: "2099-01-01T00:00:00Z" }), "production_invalid_time", "future completion blocked");
  denied(f, () => f.post({ ...body, question_logs: body.question_logs.map((l, i) => i ? l : { ...l, store_id: "B" }) }), "production_log_mismatch", "nested identity blocked");
  denied(f, () => f.post({ ...body, summary: { participant_token: a.participant_token } }), "production_invalid_input", "nested credential blocked");
  const polluted = JSON.parse(JSON.stringify(body)); Object.defineProperty(polluted, "__proto__", { value: { bad: "yes" }, enumerable: true });
  denied(f, () => f.post(polluted), "production_invalid_input", "prototype property blocked");
  const accepted = f.post(body); check(accepted.ok && !accepted.duplicate, "existing participant completion saved after intake deadline");
  const before = f.snapshot(); check(f.post(body).duplicate && f.snapshot() === before, "identical retry idempotent");
  denied(f, () => f.post({ ...body, summary: { overall_accuracy: 0 } }), "submission_id_conflict", "same id altered content blocked");
  denied(f, () => f.post({ ...body, submission_id: "another_submission_0001" }), "production_already_completed", "one completion per assignment");
  const receipt = { action: "receipt", schema_version: "2", ...body, allocation_version: f.cfg.allocationVersion, assignment_id: a.assignment_id };
  delete receipt.question_logs; delete receipt.answers; delete receipt.allocation; delete receipt.summary;
  check(f.get(receipt).status === "complete", "authenticated receipt proven after intake deadline");
  denied(f, () => f.get({ ...receipt, participant_token: "f".repeat(64) }), "production_unauthorized", "receipt credential required");
  check(!f.snapshot().includes(a.participant_token), "no submitted credential persisted");
  check(f.c.MailApp.sent.length === 0, "no emails in collection tests");
}
{
  const f = fixture();
  let linkCalls = 0;
  f.c.btsFormsFollowupLink_ = (_sheet, record, lang, now) => { linkCalls++; return { measurement_mode: "forms", form_url: "https://docs.google.com/forms/d/e/mock/viewform?entry.1=separate-qualification", form_id: "mock", language: lang, expires_at: record.token_expires_at }; };
  const a = f.get(f.req), body = f.payload(a, true);
  check(f.post(body).ok, "completion with optional contact saved");
  const record = f.c.httpFindRow_(f.c.sheet, "FollowUp", "submission_id", body.submission_id);
  check(record.object.delivery_mode === "google_forms", "followup records forms only");
  check(f.c.httpFindRow_(f.c.sheet, "logs", "submission_id", body.submission_id).object.email === "", "v2 answer log excludes email");
  check(f.c.httpFindRow_(f.c.sheet, "Contact", "submission_id", body.submission_id).object.email === body.email, "contact privately stored");
  const link = f.c.completionFollowupLink_(f.c.sheet, body.submission_id), token = link.url.split("#token=")[1];
  const query = { action: "followup", schema_version: "2", token, language: "ja" };
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg, enrollmentClosesAt: new Date(Date.now() - 60000).toISOString() }));
  check(f.get(query).status === "not_due" && f.get(query).measurement_mode === "forms" && linkCalls === 0, "not due never issues Forms credential");
  denied(f, () => f.get({ ...query, language: "bad" }), "production_invalid_input", "bad language blocked");
  f.c.updateMappedRow_(f.c.sheet.getSheetByName("FollowUp"), f.c.sheetDefinition_("FollowUp"), record.rowIndex, { send_at: new Date(Date.now() - 60000).toISOString() });
  const ready = f.get(query); check(ready.status === "ready" && ready.forms.language === "ja" && linkCalls === 1, "ready delegates to Forms after intake deadline");
  check(!JSON.stringify(ready).includes(token), "original token never returned to Google Forms");
  f.c.updateMappedRow_(f.c.sheet.getSheetByName("FollowUp"), f.c.sheetDefinition_("FollowUp"), record.rowIndex, { token_expires_at: new Date(Date.now() - 1000).toISOString() });
  check(f.get(query).status === "expired" && linkCalls === 1, "expired never issues qualification");
  f.c.updateMappedRow_(f.c.sheet.getSheetByName("FollowUp"), f.c.sheetDefinition_("FollowUp"), record.rowIndex, { response_completed_at: new Date().toISOString() });
  check(f.get(query).status === "completed" && f.get(query).measurement_mode === "forms" && linkCalls === 1, "completed explicitly forms and does not reissue");
  check(f.c.MailApp.sent.length === 0, "contact save does not send email");
}
{
  const f = fixture(), a = f.get(f.req), body = f.payload(a);
  check(f.post(body).ok, "operating expiry fixture has existing completion");
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({ ...f.cfg,
    enrollmentClosesAt: "2020-02-01T00:00:00Z", closesAt: "2020-03-01T00:00:00Z" }));
  denied(f, () => f.get(f.req), "production_closed", "operating deadline still blocks session recovery");
  denied(f, () => f.post(body), "production_closed", "operating deadline still blocks completion retry");
}
{
  const f = fixture(), now = Date.now();
  const scheduled = {...f.cfg, enrollmentOpensAt: new Date(now + 86400000).toISOString()};
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify(scheduled));
  denied(f, () => f.get(f.req), "production_enrollment_not_open", "service can be active before recruitment without enrolling");
  const request = f.c.normalizeAssignmentRequest_(f.req), at = new Date(scheduled.enrollmentOpensAt);
  check(f.c.btsProductionCheckEnrollment_(request, scheduled, null, at) === undefined, "enrollment opens exactly on the configured time");
  for (const value of ["", null, false, "not-date", "2019-01-01T00:00:00Z", scheduled.enrollmentClosesAt]) {
    f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({...scheduled, enrollmentOpensAt: value}));
    denied(f, () => f.get(f.req), "production_not_configured", "invalid separate enrollment opening fails closed");
  }
}
{
  const f = fixture(), a = f.get(f.req), body = f.payload(a), now = Date.now();
  const cfg = {...f.cfg, enrollmentClosesAt: new Date(now - 2 * 86400000).toISOString(), completionClosesAt: new Date(now - 86400000).toISOString()};
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify(cfg));
  denied(f, () => f.post(body), "production_completion_closed", "first completion after its deadline is rejected");
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({...cfg, completionClosesAt: new Date(now + 86400000).toISOString()}));
  check(f.post(body).ok, "completion during grace period is accepted");
  f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify(cfg));
  const before = f.snapshot(); check(f.post(body).duplicate && f.snapshot() === before, "exact already-saved completion retry survives grace cutoff");
  for (const value of ["", null, false, cfg.enrollmentClosesAt.replace(/T.*/, "T00:00:00Z"), cfg.closesAt]) {
    f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify({...cfg, completionClosesAt: value}));
    denied(f, () => f.post(body), "production_not_configured", "invalid completion date or insufficient followup margin rejected");
  }
}
console.log("PASS: " + assertions + " production HTTP assertions (isolated mocks, NOT actual Google)");
