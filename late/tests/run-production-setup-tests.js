"use strict";
// Preparation only, isolated service and filesystem mocks. No cloud execution,
// credentials, publication, real research approval, or email delivery occurs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const { productionPropertiesTemplate } = require("../scripts/release-lib");
let assertions = 0;
function check(value, message) { assertions++; assert.ok(value, message); }
const copy = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const closedTemplate = productionPropertiesTemplate(root);
function template() {
  const proposed = copy(closedTemplate);
  const config = JSON.parse(proposed.BTS_PRODUCTION_CONFIG);
  config.publicAppUrl = "https://example.invalid/isolated-test/";
  proposed.BTS_PUBLIC_APP_URL = config.publicAppUrl;
  proposed.BTS_PRODUCTION_CONFIG = JSON.stringify(config);
  return proposed;
}
function fixture() {
  const c = vm.createContext({ require, console }); c.global = c;
  const mocks = fs.readFileSync(path.join(__dirname, "run-gas-mock-tests.js"), "utf8").split("let assertionCount = 0;")[0];
  vm.runInContext(mocks + '\nthis.sheet = installGasMocks(); sheet.name = "BTS 後期3群比較 本番 ISOLATED MOCK"; sheet.getSheets = function() { return Object.values(this.sheets); }; MockSheet.prototype.getName = function() { return this.name; };', c);
  for (const file of ["Code.gs", "Production.gs", "ProductionSetup.gs"]) vm.runInContext(fs.readFileSync(path.join(root, "gas", file), "utf8"), c, { filename: file });
  const properties = {}, writes = [], deletions = [], logs = [], calls = { flush: 0, mail: 0, trigger: 0, form: 0 };
  const p = {
    getProperty: key => Object.hasOwn(properties, key) ? properties[key] : null,
    setProperty: (key, value) => { writes.push({ key, value }); properties[key] = String(value); },
    deleteProperty: key => { deletions.push(key); delete properties[key]; }
  };
  c.PropertiesService = { getScriptProperties: () => p };
  c.Logger = { log: value => logs.push(String(value)) };
  c.SpreadsheetApp.flush = () => { calls.flush++; };
  c.MailApp = { sendEmail: () => { calls.mail++; throw new Error("Forbidden email side effect"); } };
  c.ScriptApp = { newTrigger: () => { calls.trigger++; throw new Error("Forbidden trigger side effect"); } };
  c.FormApp = { create: () => { calls.form++; throw new Error("Forbidden form side effect"); } };
  function setBuild(build) { c.BTS_PRODUCTION_BUILD_ = JSON.parse(JSON.stringify(build)); }
  setBuild(template());
  const snapshot = () => JSON.stringify({ properties, sheets: c.sheet.sheets, calls });
  return { c, p, properties, writes, deletions, logs, calls, setBuild, snapshot };
}
function rejectedBeforeWrites(f, code, label) {
  const before = f.snapshot(); let caught;
  try { f.c.prepareBtsProductionWorkspace(); } catch (error) { caught = error; }
  check(caught && (!code || caught.message === code), label + ": " + (caught ? caught.message : "unexpected success"));
  check(f.snapshot() === before, label + " changes no properties or sheets");
  // All failure exits release the lock. This probes the lock without rerunning setup.
  const lock = f.c.LockService.getScriptLock();
  check(lock.tryLock(1), label + " releases script lock"); lock.releaseLock();
}
function mutateJson(build, key, mutate) { const value = JSON.parse(build[key]); mutate(value); build[key] = JSON.stringify(value); }

{
  const f = fixture();
  const result = f.c.prepareBtsProductionWorkspace();
  check(result.status === "prepared_closed", "fresh setup returns closed status");
  check(result.spreadsheetId === f.c.sheet.getId(), "result identifies actual bound sheet");
  check(result.httpEnabled === false && result.emailEnabled === false && result.reviewsApproved === false && result.triggersCreated === 0, "result does not imply approval, collection, or mail enabled");
  for (const [key, value] of Object.entries({ BTS_HTTP_MODE: "disabled", BTS_PRODUCTION_ENABLED: "false", BTS_EMAIL_ENABLED: "false", BTS_PRODUCTION_EMAIL_APPROVED: "false", BTS_SPREADSHEET_ID: f.c.sheet.getId() })) check(f.properties[key] === value, "closed property: " + key);
  const cfg = JSON.parse(f.properties.BTS_PRODUCTION_CONFIG), review = JSON.parse(f.properties.BTS_PRODUCTION_REVIEW);
  check(cfg.spreadsheetId === f.c.sheet.getId(), "actual spreadsheet ID only added during preparation");
  check(cfg.opensAt === "" && cfg.enrollmentClosesAt === "" && cfg.closesAt === "" && cfg.maxAssignments === null && cfg.maxDailyAssignments === null, "unknown operating dates, enrollment deadline, and capacities remain unset");
  check(review.reviewer === "" && review.reviewedAt === "" && review.contentSha256 === cfg.contentHash, "no real reviewer fabricated");
  check(Object.keys(review.approvals).length === 5 && Object.values(review.approvals).every(v => v === false), "all five study approvals remain false");
  check(/^[a-f0-9]{64}$/.test(f.properties.BTS_PRODUCTION_PARTICIPANT_SECRET), "private participant secret generated");
  check(Object.keys(f.c.sheet.sheets).length === 8, "exactly eight data sheets created");
  for (const definition of f.c.BTS_SHEETS_) {
    const sheet = f.c.sheet.getSheetByName(definition.name);
    check(sheet.getLastRow() === 1 && JSON.stringify(sheet.rows[0]) === JSON.stringify(definition.headers), "correct empty schema: " + definition.name);
  }
  check(f.calls.mail === 0 && f.calls.trigger === 0 && f.calls.form === 0, "setup creates no emails, triggers, or forms");
  check(!JSON.stringify(f.logs).includes(f.properties.BTS_PRODUCTION_PARTICIPANT_SECRET) && !JSON.stringify(result).includes(f.properties.BTS_PRODUCTION_PARTICIPANT_SECRET), "secret absent from result and logs");
  const before = JSON.stringify({ properties: f.properties, sheets: f.c.sheet.sheets });
  const secret = f.properties.BTS_PRODUCTION_PARTICIPANT_SECRET;
  const writeCount = f.writes.length;
  const second = f.c.prepareBtsProductionWorkspace();
  check(second.status === "prepared_closed" && JSON.stringify({ properties: f.properties, sheets: f.c.sheet.sheets }) === before, "same setup is idempotent");
  check(f.properties.BTS_PRODUCTION_PARTICIPANT_SECRET === secret, "retry preserves private secret");
  check(f.writes.length === writeCount && f.deletions.length === 0, "successful retry neither rewrites nor deletes existing properties");
}
for (const [key, value] of [["BTS_HTTP_MODE", "production"], ["BTS_HTTP_MODE", "test"], ["BTS_PRODUCTION_ENABLED", "true"], ["BTS_EMAIL_ENABLED", "true"], ["BTS_PRODUCTION_EMAIL_APPROVED", "true"]]) {
  const f = fixture(); f.p.setProperty(key, value);
  rejectedBeforeWrites(f, "production_disable_before_setup", "active environment rejected: " + key + "=" + value);
}
for (const name of ["", "BTS 後期3群比較 接続検証 MOCK", "Unrelated study", "prefix BTS 後期3群比較 本番 wrong", "BTS 後期3群比較 本番"]) {
  const f = fixture(); f.c.sheet.name = name;
  rejectedBeforeWrites(f, "production_wrong_spreadsheet", "non-production name rejected: " + name);
}
{
  const f = fixture(); f.c.SpreadsheetApp.getActiveSpreadsheet = () => null;
  rejectedBeforeWrites(f, "production_wrong_spreadsheet", "unbound script rejected");
}
for (const [key, value] of [["BTS_HTTP_TEST_SPREADSHEET_ID", "mock-blue-ticket-spreadsheet"], ["BTS_SPREADSHEET_ID", "some-other-study"]]) {
  const f = fixture(); f.p.setProperty(key, value);
  rejectedBeforeWrites(f, "production_wrong_spreadsheet", "wrong existing target rejected: " + key);
}
for (const build of [undefined, null, [], "bad"]) {
  const f = fixture(); f.c.BTS_PRODUCTION_BUILD_ = build;
  rejectedBeforeWrites(f, "production_build_missing", "invalid build shape rejected");
}
const tamperCases = [
  ["HTTP activation", b => { b.BTS_HTTP_MODE = "production"; }],
  ["production activation", b => { b.BTS_PRODUCTION_ENABLED = "true"; }],
  ["email activation", b => { b.BTS_EMAIL_ENABLED = "true"; }],
  ["forged email approval", b => { b.BTS_PRODUCTION_EMAIL_APPROVED = "true"; }],
  ["unexpected property", b => { b.UNEXPECTED = "value"; }],
  ["embedded participant secret", b => { b.BTS_PRODUCTION_PARTICIPANT_SECRET = "a".repeat(64); }],
  ["reviewer injected", b => mutateJson(b, "BTS_PRODUCTION_REVIEW", r => { r.reviewer = "NOT A REAL APPROVAL"; })],
  ["review date injected", b => mutateJson(b, "BTS_PRODUCTION_REVIEW", r => { r.reviewedAt = "2020-01-01"; })],
  ["wrong reviewed hash", b => mutateJson(b, "BTS_PRODUCTION_REVIEW", r => { r.contentSha256 = "0".repeat(64); })],
  ["missing review approval", b => mutateJson(b, "BTS_PRODUCTION_REVIEW", r => { delete r.approvals.noImageScenes; })],
  ["extra review approval", b => mutateJson(b, "BTS_PRODUCTION_REVIEW", r => { r.approvals.someOtherApproval = false; })],
  ["review shape", b => { b.BTS_PRODUCTION_REVIEW = "null"; }],
  ["preselected spreadsheet", b => mutateJson(b, "BTS_PRODUCTION_CONFIG", c => { c.spreadsheetId = "some-target"; })],
  ["opening date injected", b => mutateJson(b, "BTS_PRODUCTION_CONFIG", c => { c.opensAt = "2020-01-01"; })],
  ["enrollment deadline injected", b => mutateJson(b, "BTS_PRODUCTION_CONFIG", c => { c.enrollmentClosesAt = "2099-01-01"; })],
  ["enrollment deadline null", b => mutateJson(b, "BTS_PRODUCTION_CONFIG", c => { c.enrollmentClosesAt = null; })],
  ["enrollment deadline omitted", b => mutateJson(b, "BTS_PRODUCTION_CONFIG", c => { delete c.enrollmentClosesAt; })],
  ["closing date injected", b => mutateJson(b, "BTS_PRODUCTION_CONFIG", c => { c.closesAt = "2099-01-01"; })],
  ["capacity injected", b => mutateJson(b, "BTS_PRODUCTION_CONFIG", c => { c.maxAssignments = 100; })],
  ["daily capacity injected", b => mutateJson(b, "BTS_PRODUCTION_CONFIG", c => { c.maxDailyAssignments = 10; })]
];
for (const key of ["noImageScenes", "improvedContent", "conditionNeutralPostSurvey", "lateEvaluationInstruments", "followupInstrumentAndUrl"]) {
  for (const value of [true, "false", 0, null]) tamperCases.push(["invalid approval " + key + "=" + JSON.stringify(value), b => mutateJson(b, "BTS_PRODUCTION_REVIEW", r => { r.approvals[key] = value; })]);
}
for (const [label, mutate] of tamperCases) {
  const f = fixture(), build = template(); mutate(build); f.setBuild(build);
  rejectedBeforeWrites(f, "production_build_invalid", label);
}
for (const key of ["BTS_PUBLIC_APP_URL", "BTS_PRODUCTION_CONFIG", "BTS_PRODUCTION_REVIEW", "BTS_FOLLOWUP_INSTRUMENT_HASH", "BTS_FOLLOWUP_QUESTION_IDS", "BTS_PRODUCTION_EMAIL_APPROVED"]) {
  const f = fixture(); f.p.setProperty(key, "conflicting previous value");
  rejectedBeforeWrites(f, "production_setup_config_conflict", "existing property never overwritten: " + key);
}
{
  const f = fixture(), priorConfig = JSON.parse(template().BTS_PRODUCTION_CONFIG);
  priorConfig.spreadsheetId = f.c.sheet.getId();
  priorConfig.enrollmentClosesAt = "2099-01-01T00:00:00Z";
  const original = JSON.stringify(priorConfig);
  f.p.setProperty("BTS_PRODUCTION_CONFIG", original);
  f.p.setProperty("BTS_PRODUCTION_PARTICIPANT_SECRET", "c".repeat(64));
  f.writes.length = 0;
  rejectedBeforeWrites(f, "production_setup_config_conflict", "existing enrollment deadline is never reset by preparation");
  check(f.properties.BTS_PRODUCTION_CONFIG === original && f.properties.BTS_PRODUCTION_PARTICIPANT_SECRET === "c".repeat(64), "existing deadline and secret remain exactly unchanged");
  check(f.writes.length === 0 && f.deletions.length === 0, "existing deadline conflict neither rewrites nor deletes properties");
}
for (const [label, prepare] of [
  ["unknown one-row data", f => f.c.sheet.insertSheet("unrelated").appendRow(["real data"])],
  ["known header followed by data", f => { const s = f.c.ensureSheet_(f.c.sheet, f.c.BTS_SHEETS_[0]); s.appendRow(["real study row"]); }],
  ["altered known header", f => { const s = f.c.ensureSheet_(f.c.sheet, f.c.BTS_SHEETS_[0]); s.rows[0][0] = "wrong"; }],
  ["extra known header column", f => { const s = f.c.ensureSheet_(f.c.sheet, f.c.BTS_SHEETS_[0]); s.rows[0].push("extra"); }]
]) {
  const f = fixture(); prepare(f); rejectedBeforeWrites(f, "production_setup_nonempty", label);
}
{
  const f = fixture(); const empty = f.c.sheet.insertSheet("Empty default sheet");
  f.c.prepareBtsProductionWorkspace();
  check(f.c.sheet.getSheetByName("Empty default sheet") === empty && empty.getLastRow() === 0, "empty preexisting sheet preserved");
  check(Object.keys(f.c.sheet.sheets).length === 9, "eight study sheets added without deleting default sheet");
}
{
  const f = fixture(), lock = f.c.LockService.getScriptLock(); lock.tryLock(1);
  const before = f.snapshot(); let caught;
  try { f.c.prepareBtsProductionWorkspace(); } catch (error) { caught = error; }
  check(caught && caught.message === "production_setup_busy" && f.snapshot() === before, "busy lock causes no writes");
  check(!f.c.LockService.getScriptLock().tryLock(1), "busy failure does not release someone else's lock"); lock.releaseLock();
}

// A semantic validation error occurs after closed properties/secret have been
// prepared. Rollback is limited to newly added properties, never old state.
for (const [label, mutate] of [
  ["invalid URL", b => mutateJson(b, "BTS_PRODUCTION_CONFIG", cfg => { cfg.publicAppUrl = "not-an-https-url"; })],
  ["mismatched followup URL", b => { b.BTS_PUBLIC_APP_URL = "https://example.invalid/different/"; }],
  ["mismatched instrument hash", b => { b.BTS_FOLLOWUP_INSTRUMENT_HASH = "e".repeat(64); }],
  ["mismatched instrument version", b => { b.BTS_FOLLOWUP_INSTRUMENT_VERSION = "other-instrument"; }],
  ["smoke experiment ID", b => mutateJson(b, "BTS_PRODUCTION_CONFIG", cfg => { cfg.experimentId = "bts-smoke-invalid"; })]
]) {
  const f = fixture(), build = template(); mutate(build); f.setBuild(build);
  const before = f.snapshot(); let error;
  try { f.c.prepareBtsProductionWorkspace(); } catch (e) { error = e; }
  check(error && error.message === "production_not_configured", label + " denied by actual preparation validator");
  check(f.snapshot() === before, label + " rolls back all newly introduced state");
  check(f.writes.some(w => w.key === "BTS_PRODUCTION_PARTICIPANT_SECRET") && f.deletions.includes("BTS_PRODUCTION_PARTICIPANT_SECRET"), label + " removes only newly generated secret");
  check(f.logs.length === 0 && Object.keys(f.c.sheet.sheets).length === 0, label + " has no success log or created sheets");
  f.setBuild(template());
  check(f.c.prepareBtsProductionWorkspace().status === "prepared_closed", label + " corrected build succeeds without manual cleanup");
  check(f.calls.mail === 0 && f.calls.trigger === 0 && f.calls.form === 0, label + " neither failure nor retry has external effects");
}
{
  const f = fixture(), valid = template(), build = copy(valid);
  const prior = { BTS_HTTP_MODE: "disabled", BTS_PRODUCTION_ENABLED: "false", BTS_EMAIL_ENABLED: "false", BTS_PUBLIC_APP_URL: valid.BTS_PUBLIC_APP_URL,
    BTS_PRODUCTION_PARTICIPANT_SECRET: "c".repeat(64), BTS_FOLLOWUP_TOKEN_SECRET: "private existing followup secret", UNRELATED_SETTING: "preserve me" };
  for (const [key, value] of Object.entries(prior)) f.p.setProperty(key, value);
  f.writes.length = 0;
  mutateJson(build, "BTS_PRODUCTION_CONFIG", cfg => { cfg.publicAppUrl = "not-an-https-url"; }); f.setBuild(build);
  let error; try { f.c.prepareBtsProductionWorkspace(); } catch (e) { error = e; }
  check(error && error.message === "production_not_configured", "mixed existing/new properties fail semantic validation");
  check(JSON.stringify(f.properties) === JSON.stringify(prior), "rollback exactly preserves every existing property and both secrets");
  check(f.writes.every(w => !Object.hasOwn(prior, w.key)) && f.deletions.every(key => !Object.hasOwn(prior, key)), "existing values are never rewritten or deleted even with same contents");
  f.setBuild(valid); f.c.prepareBtsProductionWorkspace();
  check(Object.entries(prior).every(([key, value]) => f.properties[key] === value), "successful retry preserves original values too");
  check(f.writes.every(w => !Object.hasOwn(prior, w.key)) && f.deletions.every(key => !Object.hasOwn(prior, key)), "successful retry writes new properties only");
}
for (const existingSecret of ["", "malformed-existing-secret"]) {
  const f = fixture(); f.p.setProperty("BTS_PRODUCTION_PARTICIPANT_SECRET", existingSecret); f.writes.length = 0;
  let error; try { f.c.prepareBtsProductionWorkspace(); } catch (e) { error = e; }
  check(error && error.message === "production_not_configured", "invalid preexisting secret rejected instead of silently replaced");
  check(Object.keys(f.properties).length === 1 && f.properties.BTS_PRODUCTION_PARTICIPANT_SECRET === existingSecret, "invalid existing secret retained exactly");
  check(!f.writes.some(w => w.key === "BTS_PRODUCTION_PARTICIPANT_SECRET") && !f.deletions.includes("BTS_PRODUCTION_PARTICIPANT_SECRET"), "old secret is never rewritten or removed");
}
for (const writesThenThrows of [false, true]) {
  const f = fixture(), originalSet = f.p.setProperty;
  f.p.setProperty = (key, value) => {
    if (key === "BTS_PRODUCTION_REVIEW") {
      if (writesThenThrows) originalSet(key, value);
      throw new Error("mock_storage_write_failure");
    }
    return originalSet(key, value);
  };
  let error; try { f.c.prepareBtsProductionWorkspace(); } catch (e) { error = e; }
  check(error && error.message === "mock_storage_write_failure", "property write failure reported (persisted=" + writesThenThrows + ")");
  check(Object.keys(f.properties).length === 0 && Object.keys(f.c.sheet.sheets).length === 0, "partial property write rolled back (persisted=" + writesThenThrows + ")");
  f.p.setProperty = originalSet;
  check(f.c.prepareBtsProductionWorkspace().status === "prepared_closed", "retry after transient storage error succeeds");
}
{
  const f = fixture(), initialize = f.c.initializeBtsProductionParticipantSecret;
  f.c.initializeBtsProductionParticipantSecret = () => { initialize(); throw new Error("mock_secret_initialization_failure"); };
  let error; try { f.c.prepareBtsProductionWorkspace(); } catch (e) { error = e; }
  check(error && error.message === "mock_secret_initialization_failure" && Object.keys(f.properties).length === 0, "failure after new secret write rolls back new secret and config");
  f.c.initializeBtsProductionParticipantSecret = initialize;
  check(f.c.prepareBtsProductionWorkspace().status === "prepared_closed", "secret initialization failure releases lock and remains recoverable");
}
{
  const f = fixture(), ensure = f.c.ensureSheet_; let attempts = 0;
  f.c.ensureSheet_ = (spreadsheet, definition) => { if (++attempts === 2) throw new Error("mock_sheet_creation_failure"); return ensure(spreadsheet, definition); };
  let error; try { f.c.prepareBtsProductionWorkspace(); } catch (e) { error = e; }
  check(error && error.message === "mock_sheet_creation_failure", "sheet creation failure reported");
  const firstSheet = f.c.sheet.getSheetByName(f.c.BTS_SHEETS_[0].name), secret = f.properties.BTS_PRODUCTION_PARTICIPANT_SECRET;
  check(Object.keys(f.c.sheet.sheets).length === 1 && firstSheet.getLastRow() === 1, "already-created sheet and header retained on later sheet failure");
  check(f.properties.BTS_HTTP_MODE === "disabled" && f.properties.BTS_PRODUCTION_ENABLED === "false" && f.properties.BTS_EMAIL_ENABLED === "false" && /^[a-f0-9]{64}$/.test(secret), "closed properties retained after sheet creation begins");
  check(f.deletions.length === 0, "no property rollback after sheet creation begins");
  f.c.ensureSheet_ = ensure; f.c.prepareBtsProductionWorkspace();
  check(Object.keys(f.c.sheet.sheets).length === 8 && f.c.sheet.getSheetByName(f.c.BTS_SHEETS_[0].name) === firstSheet && f.properties.BTS_PRODUCTION_PARTICIPANT_SECRET === secret, "retry completes missing sheets while preserving earlier sheet and secret");
}
{
  const f = fixture(); f.c.SpreadsheetApp.flush = () => { throw new Error("mock_flush_failure"); };
  let error; try { f.c.prepareBtsProductionWorkspace(); } catch (e) { error = e; }
  check(error && error.message === "mock_flush_failure" && Object.keys(f.c.sheet.sheets).length === 8, "flush failure never removes created sheets");
  check(f.deletions.length === 0 && f.properties.BTS_PRODUCTION_ENABLED === "false", "flush failure preserves closed config");
  f.c.SpreadsheetApp.flush = () => {};
  check(f.c.prepareBtsProductionWorkspace().status === "prepared_closed", "retry after flush failure succeeds");
}
{
  const f = fixture(), build = template(), originalDelete = f.p.deleteProperty;
  mutateJson(build, "BTS_PRODUCTION_CONFIG", cfg => { cfg.publicAppUrl = "bad"; }); f.setBuild(build);
  f.p.deleteProperty = key => { if (key === "BTS_PRODUCTION_CONFIG") throw new Error("mock_delete_failure"); return originalDelete(key); };
  let error; try { f.c.prepareBtsProductionWorkspace(); } catch (e) { error = e; }
  check(error && error.message === "production_setup_rollback_failed", "incomplete property rollback explicitly reported");
  check(Object.keys(f.properties).length === 1 && Object.hasOwn(f.properties, "BTS_PRODUCTION_CONFIG"), "rollback continues after one deletion failure and removes all other newly added properties");
  check(f.deletions.includes("BTS_PRODUCTION_PARTICIPANT_SECRET") && Object.keys(f.c.sheet.sheets).length === 0, "rollback deletion failure does not leave new secret or create sheets");
}

// Run the installation builder with all writes captured in memory. The real
// read-only source/template generation is exercised; no dist files are created.
function runBuilder(args) {
  const files = new Map(), directories = [], output = [];
  const mockFs = { ...fs, mkdirSync: (p, opts) => { directories.push([p, opts]); }, writeFileSync: (p, value) => { files.set(p, String(value)); } };
  const source = fs.readFileSync(path.join(root, "scripts/build-production-install.js"), "utf8");
  const c = vm.createContext({ __dirname: path.join(root, "scripts"), process: { argv: ["node", "build-production-install.js", ...args] },
    require: name => name === "node:fs" ? mockFs : name === "./release-lib" ? require("../scripts/release-lib") : require(name),
    console: { log: value => output.push(String(value)) } });
  let error; try { vm.runInContext(source, c, { filename: "build-production-install.js" }); } catch (e) { error = e; }
  return { files, directories, output, error };
}
for (const args of [[], ["--planned-app-url"], ["--planned-app-url", "http://example.invalid/"], ["--planned-app-url", "https://example.invalid/" , "unexpected"], ["--wrong-flag", "https://example.invalid/"], ["--planned-app-url", "https://example.invalid/path?credential=secret"], ["--planned-app-url", "https://user:password@example.invalid/"], ["--planned-app-url", "https://example.invalid/path#fragment"]]) {
  const r = runBuilder(args);
  check(r.error && /Usage:/.test(r.error.message), "builder rejects unsafe or wrong arguments: " + JSON.stringify(args));
  check(r.files.size === 0 && r.directories.length === 0, "invalid builder arguments write nothing");
}
{
  const r = runBuilder(["--planned-app-url", "https://example.invalid/isolated-test/"]);
  check(!r.error, "builder succeeds: " + (r.error && r.error.stack));
  check(r.files.size === 4 && r.directories.length === 1, "only expected four local artifacts created");
  const get = name => [...r.files].find(([file]) => path.basename(file) === name)[1];
  const bundle = get("ProductionBundle.gs"), manifest = get("appsscript.json"), provenance = JSON.parse(get("source-manifest.json")), html = get("index.html");
  check(provenance.length === 7, "exactly seven intended GAS modules bundled");
  const c = vm.createContext({}); vm.runInContext(bundle, c, { filename: "ProductionBundle.gs" });
  check(JSON.stringify(c.BTS_PRODUCTION_BUILD_) === JSON.stringify(template()), "embedded build is exact closed template with planned URL");
  for (const module of provenance) {
    const source = fs.readFileSync(path.join(root, "gas", module.name), "utf8");
    check(hash(source) === module.sha256 && bundle.includes(source), "source and provenance exact: " + module.name);
  }
  check(manifest === fs.readFileSync(path.join(root, "gas/appsscript.production.json"), "utf8"), "production permissions manifest preserved exactly");
  const metadata = JSON.parse(r.output[0]);
  check(metadata.mode === "closed_preparation_only" && metadata.bundleCharacters === bundle.length && metadata.bundleSha256 === hash(bundle), "builder reports exact size, checksum and closed mode");
  check(html.includes('aria-label="ProductionBundle.gs"') && html.includes('aria-label="appsscript.json"'), "clipboard source textareas available");
  check(html.includes("研究レビューは空欄・全false") && html.includes("サイトの公開済み表示ではありません"), "UI makes unapproved and unpublished status explicit");
  check(!html.includes("<script"), "clipboard HTML contains no active script");
}
console.log("PASS: " + assertions + " production setup and install-builder assertions (isolated mocks; no cloud execution)");
