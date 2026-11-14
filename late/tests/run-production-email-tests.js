"use strict";
// Offline only: MailApp, ScriptApp and Sheets below are memory mocks. No Google
// connection, network, real approval record, email or trigger is created.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
let checks = 0;
function check(value, label) { checks++; assert.ok(value, label); }
function equal(a, b, label) { checks++; assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), label); }
function throws(action, pattern, label) { checks++; assert.throws(action, pattern, label); }

function fixture() {
  let clock = Date.parse("2026-09-27T03:00:00.000Z");
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const c = vm.createContext({ require, console, Buffer, Date: ClockDate }); c.global = c;
  const source = fs.readFileSync(path.join(__dirname, "run-gas-mock-tests.js"), "utf8").split("let assertionCount = 0;")[0];
  vm.runInContext(source + "\nthis.spreadsheet = installGasMocks(); spreadsheet.name = 'BTS 後期3群比較 本番 offline email mock';", c);
  for (const name of ["Code.gs", "Production.gs", "ProductionEmail.gs"]) vm.runInContext(fs.readFileSync(path.join(root, "gas", name), "utf8"), c, { filename: name });
  c.setupSheets();
  const p = c.PropertiesService.getScriptProperties();
  const config = { experimentId: "blue-ticket-simulator-late-3group", allocationVersion: "allocation-mock-v2", appVersion: "email-mock-v2",
    contentVersion: "content-mock-v2", commonCorrectionVersion: "correction-mock-v2", instrumentVersion: "instrument-mock-v2",
    spreadsheetId: c.spreadsheet.getId(), contentHash: "c".repeat(64), instrumentHash: "d".repeat(64),
    publicAppUrl: "https://example.invalid/study/", followupMode: "google_forms", maxAssignments: 100, maxDailyAssignments: 25,
    opensAt: "2026-01-01T00:00:00.000Z", enrollmentClosesAt: "2026-10-01T00:00:00.000Z", closesAt: "2027-01-01T00:00:00.000Z" };
  const review = { reviewer: "OFFLINE MOCK ONLY", reviewedAt: "2026-01-01T00:00:00.000Z", contentSha256: config.contentHash,
    approvals: Object.fromEntries(["noImageScenes", "improvedContent", "conditionNeutralPostSurvey", "lateEvaluationInstruments", "followupInstrumentAndUrl"].map(k => [k, true])) };
  for (const [key, value] of Object.entries({ BTS_HTTP_MODE: "production", BTS_PRODUCTION_ENABLED: "true", BTS_EMAIL_ENABLED: "true",
    BTS_PRODUCTION_EMAIL_APPROVED: "true", BTS_PRODUCTION_CONFIG: JSON.stringify(config), BTS_PRODUCTION_REVIEW: JSON.stringify(review),
    BTS_PRODUCTION_PARTICIPANT_SECRET: "a".repeat(64), BTS_FOLLOWUP_TOKEN_SECRET: "offline-only-secret", BTS_PUBLIC_APP_URL: config.publicAppUrl,
    BTS_FOLLOWUP_INSTRUMENT_VERSION: config.instrumentVersion, BTS_FOLLOWUP_INSTRUMENT_HASH: config.instrumentHash,
    BTS_FOLLOWUP_QUESTION_IDS: "mock_stop,mock_phone", BTS_FOLLOWUP_OPTIONAL_QUESTION_IDS: "mock_phone" })) p.setProperty(key, value);
  let locked = false, busy = false, quota = 100, flushes = 0, readinessCalls = 0;
  const events = [], sent = [], triggers = [];
  const options = { failMail: false, failFlush: false, beforeSend: null, beforeReadiness: null, invalidReadiness: false };
  c.LockService = { getScriptLock: () => ({ tryLock() { if (busy || locked) return false; locked = true; events.push("lock"); return true; }, releaseLock() { check(locked, "release holds same lock"); locked = false; events.push("unlock"); } }) };
  c.SpreadsheetApp.flush = () => { flushes++; events.push("flush"); if (options.failFlush) throw new Error("mock flush failure"); };
  c.MailApp = { getRemainingDailyQuota() { return quota; }, sendEmail(email, subject, body) {
    check(locked, "MailApp under ScriptLock");
    check(flushes > 0, "state flushed before MailApp");
    const q = rows("followup_queue").find(row => c.unsheetText_(row.email) === email && row.status === "sending");
    check(Boolean(q), "queue already sending at send boundary");
    check(rows("Contact").some(row => row.followup_id === q.followup_id && row.status === "sending"), "Contact already sending");
    check(rows("FollowUp").some(row => row.followup_id === q.followup_id && row.status === "sending"), "FollowUp already sending");
    check(JSON.parse(p.getProperty(c.BTS_PRODUCTION_EMAIL_LEDGER_)).attempts > 0, "daily charged before MailApp");
    events.push("mail"); sent.push({ email, subject, body }); quota--;
    if (options.beforeSend) options.beforeSend();
    if (options.failMail) throw new Error("private error recipient/token must not be logged");
  } };
  c.btsFormsProductionReadiness_ = () => { readinessCalls++; check(locked, "Forms readiness under ScriptLock"); if (options.beforeReadiness) options.beforeReadiness(); if (options.invalidReadiness) return { ready: false }; return { ready: true, languages: ["ja", "en"], measurement_mode: "forms" }; };
  c.ScriptApp = { EventType: { CLOCK: "CLOCK" }, TriggerSource: { CLOCK: "CLOCK" }, getProjectTriggers: () => triggers,
    newTrigger(handler) { const state = { handler }; return { timeBased() { state.timeBased = true; return this; }, everyHours(hours) { state.hours = hours; return this; }, create() {
      check(locked, "trigger install under lock"); check(state.timeBased && state.hours === 1, "one-hour time trigger");
      const trigger = { id: "mock-trigger-" + (triggers.length + 1), handler, type: "CLOCK", source: "CLOCK",
        getUniqueId() { return this.id; }, getHandlerFunction() { return this.handler; }, getEventType() { return this.type; }, getTriggerSource() { return this.source; } };
      triggers.push(trigger); return trigger;
    } }; } };
  const logs = []; c.Logger = { log: value => logs.push(value) };
  function rows(name) { return c.readSheetObjects_(c.spreadsheet.getSheetByName(name), c.sheetDefinition_(name)); }
  function update(name, values, index = 2) { c.updateMappedRow_(c.spreadsheet.getSheetByName(name), c.sheetDefinition_(name), index, values); }
  function append(name, row) { c.appendMappedRow_(c.spreadsheet.getSheetByName(name), c.sheetDefinition_(name), row); }
  function parent(number = 1, settings = {}) {
    const end = new ClockDate(clock - 8 * 86400000), received = new ClockDate(end.getTime() + 1000), due = new ClockDate(end.getTime() + 7 * 86400000);
    const participant = "TEST" + String(number).padStart(2, "0"), submission = "submission-offline-" + number;
    const fId = "followup_" + c.sha256Hex_(config.experimentId + "|" + submission).slice(0, 40);
    const identity = { experiment_id: config.experimentId, allocation_version: config.allocationVersion, assignment_id: "assignment-offline-" + number,
      session_id: "session-offline-" + number, participant_id: participant, participant_id_normalized: participant, store_id: "A", condition: "no_image" };
    const full = { ...identity, submission_id: submission, schema_version: 2 };
    const language = settings.language || "ja", email = settings.email || "test" + number + "@example.invalid";
    append("Assignments", { ...identity, assigned_at: new ClockDate(end.getTime() - 60000), status: "confirmed", is_test: false, assignment_method: "gas_min_count_v1", client_run_id: "client-offline-" + number });
    append("Participants", { ...full, received_at: received, app_version: config.appVersion, language, allocation_status: "confirmed", allocation_method: "gas_min_count_v1",
      start_time: new ClockDate(end.getTime() - 60000), end_time: end, consent_given: true, consent_given_at: new ClockDate(end.getTime() - 60000),
      consent_version: config.experimentId + ":" + config.appVersion, completion_status: "completed", client_run_id: "client-offline-" + number,
      content_version: config.contentVersion, common_correction_version: config.commonCorrectionVersion, instrument_version: config.instrumentVersion });
    append("SubmissionReceipts", { ...full, received_at: received, completed_at: new ClockDate(received.getTime() + 500), status: "complete", event_type: "completion", payload_hash: "b".repeat(64) });
    append("FollowUp", { ...full, followup_id: fId, requested: true, send_at: due, token_expires_at: new ClockDate(due.getTime() + 30 * 86400000), window_ends_at: new ClockDate(due.getTime() + 7 * 86400000),
      delivery_mode: "google_forms", forms_json: "[]", status: "scheduled", token_hash: c.sha256Hex_(c.followupToken_(fId, false)),
      instrument_version: config.instrumentVersion, instrument_hash: config.instrumentHash, content_version: config.contentVersion, common_correction_version: config.commonCorrectionVersion });
    append("Contact", { ...full, followup_id: fId, contact_id: "contact_" + c.sha256Hex_(fId).slice(0, 40), email, language, send_at: due, status: "queued" });
    append("followup_queue", { ...full, followup_id: fId, email, language, send_at: due, delivery_mode: "google_forms", forms_json: "[]", status: "queued", subject: "untrusted subject", body: "https://docs.google.com/forms/untrusted" });
    return { id: fId, email, due, end, token: c.followupToken_(fId, false) };
  }
  function snapshot() { return JSON.stringify(c.spreadsheet.sheets); }
  return { c, p, config, review, sent, events, options, triggers, logs, rows, update, append, parent, snapshot,
    run: () => c.btsSendDueProductionFollowups_(new ClockDate()), locked: () => locked,
    setBusy(value) { busy = value; }, setQuota(value) { quota = value; }, advance(ms) { clock += ms; }, now: () => new ClockDate(),
    readinessCalls: () => readinessCalls, flushes: () => flushes };
}

for (const language of ["ja", "en"]) {
  const f = fixture(), row = f.parent(1, { language }); const beforeCount = Object.keys(f.c.spreadsheet.sheets).length;
  const report = f.run(); equal(report.sent, 1, "one invitation " + language); equal(report.send_unknown, 0, "confirmed outcome");
  equal(f.sent[0].email, row.email, "single expected address");
  check(f.sent[0].body.endsWith(f.config.publicAppUrl + "followup.html#token=" + row.token), "only canonical personal landing URL");
  check(!f.sent[0].body.includes("docs.google.com") && !f.sent[0].subject.includes("untrusted"), "queue body/subject ignored");
  for (const name of ["followup_queue", "Contact", "FollowUp"]) equal(f.rows(name)[0].status, "sent", name + " sent");
  check(Boolean(f.rows("followup_queue")[0].sent_at) && Boolean(f.rows("Contact")[0].sent_at), "timestamps recorded");
  equal(f.readinessCalls(), 1, "Forms readiness checked once per batch");
  equal(Object.keys(f.c.spreadsheet.sheets).length, beforeCount, "no added sheet");
  const after = f.snapshot(); f.run(); equal(f.sent.length, 1, "no resend"); equal(f.snapshot(), after, "retry does not edit sent data");
  check(!f.snapshot().includes(row.token) && !JSON.stringify(report).includes(row.email) && f.logs.length === 0, "token and email not leaked to reports/logs/new cells");
  equal(f.locked(), false, "lock released");
}

for (const key of ["BTS_EMAIL_ENABLED", "BTS_PRODUCTION_EMAIL_APPROVED"]) for (const value of ["false", "TRUE", "", "1"]) {
  const f = fixture(); f.parent(); f.p.setProperty(key, value); const before = f.snapshot();
  check(f.run().disabled, key + " requires exact true"); equal(f.sent.length, 0, "disabled no send"); equal(f.snapshot(), before, "disabled no sheet writes"); equal(f.readinessCalls(), 0, "disabled no Forms access");
}
for (const [key, value] of [["BTS_PRODUCTION_ENABLED", "false"], ["BTS_HTTP_MODE", "test"], ["BTS_PRODUCTION_REVIEW", "{}"], ["BTS_PRODUCTION_CONFIG", "null"], ["BTS_FOLLOWUP_TOKEN_SECRET", "wrong-secret"], ["BTS_PRODUCTION_PARTICIPANT_SECRET", ""], ["BTS_PUBLIC_APP_URL", "https://wrong.invalid/"]]) {
  const f = fixture(); f.parent(); f.p.setProperty(key, value); const before = f.snapshot(); throws(f.run, /production_|followup_/, "invalid production setting " + key); equal(f.sent.length, 0, "no send"); equal(f.snapshot(), before, "no writes"); equal(f.locked(), false, "release on error");
}
for (const mutate of [f => { f.c.spreadsheet.name = "first-term"; }, f => { f.p.setProperty("BTS_HTTP_TEST_SPREADSHEET_ID", f.config.spreadsheetId); }, f => { f.config.closesAt = "2026-09-26T00:00:00.000Z"; f.p.setProperty("BTS_PRODUCTION_CONFIG", JSON.stringify(f.config)); }]) {
  const f = fixture(); f.parent(); mutate(f); const before = f.snapshot(); throws(f.run, /production_/, "fixed approved sheet/window"); equal(f.sent.length, 0, "no mail"); equal(f.snapshot(), before, "read only rejection");
}
for (const name of ["followup_queue", "Contact", "FollowUp", "Participants", "SubmissionReceipts", "Assignments"]) {
  for (const corruption of ["missing", "header", "duplicate"]) {
    const f = fixture(); f.parent();
    if (corruption === "missing") delete f.c.spreadsheet.sheets[name];
    else if (corruption === "header") f.c.spreadsheet.sheets[name].rows[0][0] = "unexpected_header";
    else f.append(name, f.rows(name)[0]);
    const before = f.snapshot(); throws(f.run, /production_email_/, name + " " + corruption); equal(f.sent.length, 0, "no send"); equal(f.snapshot(), before, "no repair/write");
  }
}
for (const name of ["Contact", "FollowUp", "Participants", "SubmissionReceipts", "Assignments"]) {
  for (const field of ["experiment_id", "assignment_id", "session_id", "participant_id_normalized", "store_id", "condition"]) {
    const f = fixture(); f.parent(); f.update(name, { [field]: "wrong" }); const before = f.snapshot();
    throws(f.run, /production_/, name + " identity " + field); equal(f.sent.length, 0, "identity reject no mail"); equal(f.snapshot(), before, "identity reject no writes");
  }
}
const invalidRows = [
  ["Contact", "submission_id", "different-parent"], ["Contact", "contact_id", "wrong"], ["Contact", "status", "sent"], ["Contact", "sent_at", "already"], ["Contact", "language", "en"],
  ["followup_queue", "delivery_mode", "web_token"], ["followup_queue", "language", "fr"],
  ["FollowUp", "delivery_mode", "web_token"], ["FollowUp", "requested", false], ["FollowUp", "status", "error"], ["FollowUp", "instrument_hash", "e".repeat(64)],
  ["FollowUp", "instrument_version", "old"], ["FollowUp", "content_version", "old"], ["FollowUp", "common_correction_version", "old"], ["FollowUp", "token_hash", "e".repeat(64)],
  ["Assignments", "status", "pending"], ["Assignments", "is_test", true], ["Assignments", "is_test", ""], ["Assignments", "assignment_method", "local"], ["Assignments", "client_run_id", "wrong"],
  ["Participants", "schema_version", 1], ["Participants", "completion_status", "started"], ["Participants", "consent_given", false], ["Participants", "consent_given", "true"],
  ["Participants", "consent_version", "old"], ["Participants", "app_version", "old"], ["Participants", "content_version", "old"], ["Participants", "common_correction_version", "old"],
  ["Participants", "instrument_version", "old"], ["Participants", "allocation_status", "pending"], ["Participants", "allocation_method", "local"], ["Participants", "language", "en"],
  ["SubmissionReceipts", "schema_version", 1], ["SubmissionReceipts", "status", "processing"], ["SubmissionReceipts", "event_type", "followup"], ["SubmissionReceipts", "payload_hash", ""],
  ...["FollowUp", "Participants", "SubmissionReceipts", "Assignments"].map(name => [name, "allocation_version", "old"])
];
for (const [name, field, value] of invalidRows) {
  const f = fixture(); f.parent(); f.update(name, { [field]: value }); const before = f.snapshot(); throws(f.run, /production_|invalid_followup_token/, name + "." + field); equal(f.sent.length, 0, "rejected mail"); equal(f.snapshot(), before, "rejected no mutation");
}
for (const email of ["a@example.invalid,b@example.invalid", "a@example.invalid;", "A <a@example.invalid>", "a@example.invalid\n", "a@example.invalid\r\nBcc:b@bad.invalid", " a@example.invalid", "a@example.invalid ", "bad", "a@localhost", "a@-bad.invalid", "a@[127.0.0.1]", "\"quoted\"@example.invalid", "a@x,evil.invalid"]) {
  const f = fixture(); f.parent(1, { email }); const before = f.snapshot(); throws(f.run, /production_email_recipient/, "single safe recipient " + JSON.stringify(email)); equal(f.sent.length, 0, "reject malformed recipient"); equal(f.snapshot(), before, "recipient no write");
}
{ const f = fixture(); f.parent(); f.update("Contact", { email: "different@example.invalid" }); throws(f.run, /recipient/); equal(f.sent.length, 0, "different Contact address refused"); }
{ const f = fixture(); f.parent(1, { email: "user+tag@example.invalid" }); equal(f.run().sent, 1, "valid tagged email supported"); }
for (const [name, field] of [["FollowUp", "send_at"], ["Contact", "send_at"], ["followup_queue", "send_at"], ["FollowUp", "token_expires_at"], ["FollowUp", "window_ends_at"], ["Participants", "end_time"], ["Participants", "received_at"], ["Participants", "consent_given_at"], ["SubmissionReceipts", "completed_at"]]) {
  for (const value of ["", "2026-02-30T00:00:00.000Z", "9/26/2026", 123, true, "2026-09-27T03:00:01.000Z"]) {
    const f = fixture(); f.parent(); f.update(name, { [field]: value }); const before = f.snapshot(); throws(f.run, /production_email_time/, name + "." + field + " strict time"); equal(f.sent.length, 0, "time no email"); equal(f.snapshot(), before, "time no write");
  }
}
for (const delta of [-2 * 86400000, 29 * 86400000]) {
  const f = fixture(); f.parent(); f.advance(delta); const before = f.snapshot(); equal(f.run().sent, 0, "not due or exactly expired"); equal(f.snapshot(), before, "no state changes for date skip"); equal(f.readinessCalls(), 0, "skip before Forms call");
}
{ const f = fixture(); f.parent(); f.advance(-86400000); equal(f.run().sent, 1, "exact due is eligible"); }
for (const status of ["sent", "sending", "send_unknown", "error", "cancelled", ""]) {
  const f = fixture(); f.parent(); f.update("followup_queue", { status }); const before = f.snapshot(); equal(f.run().sent, 0, "only queued is eligible: " + status); equal(f.snapshot(), before, "never automatically repair/retry");
}
{ const f = fixture(); f.parent(); f.update("FollowUp", { status: "completed", response_completed_at: f.now().toISOString() }); f.parent(2); equal(f.run().sent, 1, "already answered skipped without blocking another participant"); equal(f.sent[0].email, "test2@example.invalid", "no invitation to completed followup"); }
{ const f = fixture(); f.parent(); f.parent(2); f.update("Participants", { consent_given: false }, 3); const before = f.snapshot(); throws(f.run, /parent/); equal(f.sent.length, 0, "entire selected batch preflight before first send"); equal(f.snapshot(), before, "preflight no mutation"); }

for (const quota of [0, 1, 3]) {
  const f = fixture(); for (let i = 1; i <= 6; i++) f.parent(i); f.setQuota(quota); equal(f.run().sent, quota, "remaining recipient quota respected " + quota); equal(f.sent.length, quota, "quota actual attempts");
}
{ const f = fixture(); for (let i = 1; i <= 7; i++) f.parent(i); equal(f.run().sent, 5, "default batch five"); equal(f.run().sent, 2, "next batch only unsent"); equal(f.sent.length, 7, "no duplicate batch send"); }
{ const f = fixture(); for (let i = 1; i <= 5; i++) f.parent(i); f.p.setProperty("BTS_PRODUCTION_EMAIL_BATCH_LIMIT", "2"); f.p.setProperty("BTS_PRODUCTION_EMAIL_DAILY_LIMIT", "3"); equal(f.run().sent, 2, "configured batch"); equal(f.run().sent, 1, "configured daily remainder"); const before = f.snapshot(); equal(f.run().sent, 0, "daily exhausted"); equal(f.snapshot(), before, "daily cap no row mutations"); f.advance(86400000); equal(f.run().sent, 2, "UTC new day resets attempts"); }
for (const [key, value] of [["BTS_PRODUCTION_EMAIL_BATCH_LIMIT", "11"], ["BTS_PRODUCTION_EMAIL_DAILY_LIMIT", "101"], ["BTS_PRODUCTION_EMAIL_BATCH_LIMIT", "0"], ["BTS_PRODUCTION_EMAIL_DAILY_LIMIT", "2.5"], ["BTS_PRODUCTION_EMAIL_BATCH_LIMIT", " 5"], ["BTS_PRODUCTION_EMAIL_BATCH_LIMIT", "5\n"]]) {
  const f = fixture(); f.parent(); f.p.setProperty(key, value); throws(f.run, /limits/); equal(f.sent.length, 0, "invalid limit no send");
}
for (const raw of ["broken", "null", "{}", '{"day":"2026-09-28","attempts":0}', '{"day":"2026-09-27","attempts":-1}', '{"day":"2026-09-27","attempts":101}', '{"day":"2026-09-27","attempts":0,"extra":1}', '{"day":"2026-02-30","attempts":0}']) {
  const f = fixture(); f.parent(); f.p.setProperty(f.c.BTS_PRODUCTION_EMAIL_LEDGER_, raw); throws(f.run, /ledger|time/); equal(f.sent.length, 0, "bad ledger no reset/send");
}
for (const value of [-1, 1.5, NaN, "3"]) { const f = fixture(); f.parent(); f.setQuota(value); throws(f.run, /quota/); equal(f.sent.length, 0, "unknown quota fail closed"); }
{ const f = fixture(); f.parent(); f.setBusy(true); throws(f.run, /busy/); equal(f.sent.length, 0, "busy no send"); }
for (const mode of ["missing", "false", "throw"]) {
  const f = fixture(); f.parent(); const before = f.snapshot();
  if (mode === "missing") delete f.c.btsFormsProductionReadiness_;
  else if (mode === "false") f.options.invalidReadiness = true;
  else f.options.beforeReadiness = () => { throw new Error("forms closed"); };
  throws(f.run, /forms/); equal(f.sent.length, 0, "Forms not ready no mail"); equal(f.snapshot(), before, "Forms rejection read-only"); equal(f.locked(), false, "Forms failure releases lock");
}
{ const f = fixture(); f.parent(); f.options.beforeReadiness = () => f.advance(240001); const before = f.snapshot(); check(f.run().limited, "runtime budget"); equal(f.sent.length, 0, "no new send near runtime limit"); equal(f.snapshot(), before, "runtime limit no writes"); }
{ const f = fixture(); f.parent(); f.options.beforeReadiness = () => f.p.setProperty("BTS_EMAIL_ENABLED", "false"); check(f.run().disabled, "approval rechecked after readiness"); equal(f.sent.length, 0, "disabled during preflight no send"); }
{ const f = fixture(); f.parent(); f.advance(29 * 86400000 - 30000); f.options.beforeReadiness = () => f.advance(60000); const before = f.snapshot(); equal(f.run().sent, 0, "expiry rechecked at send boundary"); equal(f.snapshot(), before, "expired during readiness no mutations"); }
{ const f = fixture(); f.parent(); f.options.beforeReadiness = () => f.setQuota(0); const before = f.snapshot(); equal(f.run().sent, 0, "quota rechecked at send boundary"); equal(f.snapshot(), before, "quota exhausted during readiness no mutations"); }
{ const f = fixture(); f.parent(); f.options.beforeSend = () => f.advance(2000); f.run(); equal(new Date(f.rows("followup_queue")[0].sent_at).getTime(), f.now().getTime(), "sent_at is post-MailApp time, not pre-call time"); }
{ const f = fixture(); f.parent(); f.options.beforeReadiness = () => f.update("Contact", { status: "cancelled" }); throws(f.run, /parent/); equal(f.sent.length, 0, "rows re-read immediately before sending"); }
{ const f = fixture(); f.parent(); f.options.failFlush = true; throws(f.run, /flush failure/); equal(f.sent.length, 0, "flush failure prevents MailApp"); equal(f.rows("followup_queue")[0].status, "sending", "failed flush does not reset queued"); equal(f.locked(), false, "flush failure releases lock"); }
{
  const f = fixture(); f.parent(); f.parent(2); f.options.failMail = true;
  const result = f.run(); equal(result.send_unknown, 1, "exception is uncertain delivery"); equal(result.sent, 0, "exception not marked sent"); equal(f.sent.length, 1, "stops batch on first uncertain send");
  for (const name of ["followup_queue", "Contact", "FollowUp"]) equal(f.rows(name)[0].status, "send_unknown", name + " terminal unknown");
  check(!f.snapshot().includes("private error"), "raw exception not persisted"); equal(JSON.parse(f.p.getProperty(f.c.BTS_PRODUCTION_EMAIL_LEDGER_)).attempts, 1, "uncertain counts toward daily cap");
  f.options.failMail = false; equal(f.run().sent, 1, "next run sends only different queued participant"); equal(f.sent.length, 2, "never retries unknown recipient");
}
for (const failUnknown of [false, true]) {
  const f = fixture(); f.parent(); const sheet = f.c.spreadsheet.getSheetByName("followup_queue"), original = sheet.setCell.bind(sheet);
  sheet.setCell = (row, column, value) => { if (value === "sent" || (failUnknown && value === "send_unknown")) throw new Error("post-send persistence failed"); original(row, column, value); };
  equal(f.run().send_unknown, 1, "successful mail plus storage failure ambiguous"); equal(f.sent.length, 1, "mail was attempted once");
  equal(f.rows("followup_queue")[0].status, failUnknown ? "sending" : "send_unknown", "durable pre-send guard retained");
  f.run(); equal(f.sent.length, 1, "cannot duplicate after storage failure");
}
{ const f = fixture(); f.parent(); const p = f.c.PropertiesService.getScriptProperties; f.c.PropertiesService.getScriptProperties = () => { const original = p(); return { ...original, setProperty(key, value) { if (key === f.c.BTS_PRODUCTION_EMAIL_LEDGER_) throw new Error("counter failed"); original.setProperty(key, value); } }; }; throws(f.run, /counter failed/); equal(f.sent.length, 0, "ledger persistence before email"); equal(f.rows("followup_queue")[0].status, "sending", "ledger error no automatic resend"); }
{ const f = fixture(); f.parent(); const original = f.c.completionFollowupLink_; for (const url of ["https://docs.google.com/forms/d/e/anything/viewform", f.config.publicAppUrl + "followup.html?token=" + "a".repeat(64), f.config.publicAppUrl + "followup.html#token=" + "a".repeat(64)]) { f.c.completionFollowupLink_ = (...args) => ({ ...original(...args), url }); throws(f.run, /link/); equal(f.sent.length, 0, "wrong landing/token rejected"); } }

{
  const f = fixture(); f.parent(); const before = f.snapshot(); equal(f.c.installBtsProductionEmailTrigger(), { installed: true, reused: false, sendsByThisCall: 0 }, "explicit install");
  equal(f.c.installBtsProductionEmailTrigger(), { installed: true, reused: true, sendsByThisCall: 0 }, "idempotent trigger reuse");
  equal(f.triggers.length, 1, "one trigger only"); equal(f.sent.length, 0, "install does not send"); equal(f.snapshot(), before, "install no Sheet writes");
  f.triggers[0].type = "ON_FORM_SUBMIT"; throws(() => f.c.installBtsProductionEmailTrigger(), /trigger/); equal(f.triggers.length, 1, "wrong trigger never replaced");
}
for (const mode of ["disabled", "legacy", "foreign", "missing", "duplicate", "closed"]) {
  const f = fixture();
  if (mode === "disabled") f.p.setProperty("BTS_PRODUCTION_EMAIL_APPROVED", "false");
  if (mode === "legacy") f.triggers.push({ getHandlerFunction: () => "sendDueFollowups" });
  if (mode === "foreign") f.triggers.push({ getHandlerFunction: () => "sendBtsProductionFollowupEmails", getUniqueId: () => "other" });
  if (mode === "missing") f.p.setProperty(f.c.BTS_PRODUCTION_EMAIL_TRIGGER_, "lost-trigger");
  if (mode === "duplicate") { f.c.installBtsProductionEmailTrigger(); f.triggers.push(f.triggers[0]); }
  if (mode === "closed") f.options.invalidReadiness = true;
  const count = f.triggers.length; throws(() => f.c.installBtsProductionEmailTrigger(), /production_email_/); equal(f.triggers.length, count, "no delete/create on invalid install " + mode); equal(f.sent.length, 0, "no install email"); equal(f.locked(), false, "install failure releases lock");
}
{ const f = fixture(); f.parent(); equal(f.c.sendBtsProductionFollowupEmails().sent, 1, "owner wrapper works"); }
{ const f = fixture(); f.parent(); equal(f.c.sendDueFollowups().sent, 1, "Code production delegation works"); }

const manifest = JSON.parse(fs.readFileSync(path.join(root, "gas/appsscript.production.json"), "utf8"));
const existingManifest = JSON.parse(fs.readFileSync(path.join(root, "gas/appsscript.json"), "utf8"));
for (const scope of ["spreadsheets", "forms", "drive.readonly", "script.send_mail", "script.scriptapp"]) check(manifest.oauthScopes.includes("https://www.googleapis.com/auth/" + scope), "production scope " + scope);
check(!manifest.oauthScopes.some(s => /gmail|mail\.google|auth\/drive$/.test(s)), "no inbox/full Drive permissions");
check(!existingManifest.oauthScopes.includes("https://www.googleapis.com/auth/script.send_mail"), "current manifest no mail scope added");
console.log("Production email tests: " + checks + " checks passed (offline; no real email or triggers).");
