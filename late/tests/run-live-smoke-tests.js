"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({ require, console });
context.global = context;
// Reuse the mock service definitions, not the other runner's test execution.
const mocks = fs.readFileSync(path.join(__dirname, "run-gas-mock-tests.js"), "utf8").split("let assertionCount = 0;")[0];
vm.runInContext(mocks + `
this.smokeSpreadsheet = installGasMocks();
smokeSpreadsheet.name = "BTS 後期3群比較 接続検証 2026-09-21";
MockSpreadsheet.prototype.getSheets = function() { return Object.values(this.sheets); };
MockSheet.prototype.getName = function() { return this.name; };
const smokeProperties = {};
this.httpObservedTokens = [];
PropertiesService.getScriptProperties = () => ({
  getProperty: key => Object.hasOwn(smokeProperties, key) ? smokeProperties[key] : null,
  setProperty: (key, value) => { smokeProperties[key] = String(value); if (key === "BTS_HTTP_TEST_ACCESS_TOKEN") httpObservedTokens.push(String(value)); },
  deleteProperty: key => { delete smokeProperties[key]; }
});
this.smokeProperties = smokeProperties;
this.smokeLogs = [];
Logger.log = value => smokeLogs.push(value);
`, context);
for (const file of ["Code.gs", "LiveSmoke.gs"]) {
  vm.runInContext(fs.readFileSync(path.join(root, "gas", file), "utf8"), context, { filename: file });
}
let assertions = 0;
function check(value, message) { assertions++; assert.ok(value, message); }
const invoke = source => vm.runInContext(source, context);
const snapshot = () => invoke("JSON.stringify(smokeSpreadsheet.getSheets().map(s => s.rows))");

// Guards precede setup, writes, and property changes.
invoke('smokeSpreadsheet.name = "Production data"');
assert.throws(() => invoke("runBtsLiveSmoke()"), /bts_smoke_wrong_spreadsheet/); assertions++;
check(invoke("Object.keys(smokeSpreadsheet.sheets).length") === 0, "wrong-sheet guard writes nothing");
invoke('smokeSpreadsheet.name = "BTS 後期3群比較 接続検証 2026-09-21"; smokeProperties.BTS_EMAIL_ENABLED = "true"');
assert.throws(() => invoke("runBtsLiveSmoke()"), /bts_smoke_email_enabled/); assertions++;
invoke('smokeProperties.BTS_EMAIL_ENABLED = "false"; smokeProperties.BTS_FOLLOWUP_TOKEN_SECRET = "preserved-private-secret"; smokeProperties.BTS_PUBLIC_APP_URL = "https://original.invalid/"');
const first = invoke("runBtsLiveSmoke()");
check(first.status === "PASS" && first.checks_passed === 43, "original 43 in-process smoke checks remain unchanged");
check(invoke('smokeProperties.BTS_PUBLIC_APP_URL === "https://original.invalid/" && smokeProperties.BTS_FOLLOWUP_TOKEN_SECRET === "preserved-private-secret"'), "overridden properties restored");
check(invoke('!Object.hasOwn(smokeProperties, "BTS_FOLLOWUP_INSTRUMENT_HASH")'), "originally missing property removed after test");
check(invoke('Object.keys(smokeProperties).every(key => !key.startsWith("BTS_HTTP_"))'), "all originally absent HTTP gate properties are removed on success");
check(invoke('doGet({parameter:{callback:"checkDisabled", action:"assign", schema_version:2}}).getContent().includes("http_test_disabled")'), "internal smoke success does not enable HTTP");
check(JSON.stringify(first.data_rows) === JSON.stringify({ logs: 2, followup_queue: 0, Assignments: 9, Participants: 2, QuestionLogs: 3, Contact: 0, FollowUp: 2, SubmissionReceipts: 3 }), "expected isolated rows");
const after = snapshot();
const second = invoke("runBtsLiveSmoke()");
check(second.status === "PASS" && snapshot() === after, "rerun neither duplicates nor changes existing data");
check(invoke("MailApp.sent.length") === 0, "no email sent");
check(!invoke('smokeLogs.join("\\n")').includes("#token="), "no capability URLs logged");
check(!invoke('smokeLogs.join("\\n")').includes("preserved-private-secret"), "no secret logged");
check(invoke('httpObservedTokens.length === 2 && httpObservedTokens.every(token => /^[a-f0-9]{64}$/.test(token)) && httpObservedTokens[0] !== httpObservedTokens[1]'), "each run uses a fresh private HTTP credential");
check(invoke('httpObservedTokens.every(token => !JSON.stringify(smokeSpreadsheet.getSheets().map(s => s.rows)).includes(token) && !smokeLogs.join("\\n").includes(token))'), "transient HTTP credentials never enter cells or logs");
invoke(`Object.assign(smokeProperties, {
  BTS_HTTP_MODE: "disabled", BTS_HTTP_TEST_SPREADSHEET_ID: "preserved-sheet",
  BTS_HTTP_TEST_EXPERIMENT_ID: "preserved-experiment", BTS_HTTP_TEST_ALLOCATION_VERSION: "preserved-allocation",
  BTS_HTTP_TEST_PARTICIPANTS: '{"QAAX09":"A"}', BTS_HTTP_TEST_EXPIRES_AT: "preserved-expiry",
  BTS_HTTP_TEST_ACCESS_TOKEN: "d".repeat(64)
}); this.savedHttpProperties = JSON.stringify(Object.fromEntries(Object.entries(smokeProperties).filter(([key]) => key.startsWith("BTS_HTTP_"))));`);
check(invoke('runBtsLiveSmoke().checks_passed') === 43 && snapshot() === after, "preexisting disabled HTTP settings do not change synthetic records or hashes");
check(invoke('JSON.stringify(Object.fromEntries(Object.entries(smokeProperties).filter(([key]) => key.startsWith("BTS_HTTP_")))) === savedHttpProperties'), "every preexisting HTTP setting is restored exactly on success");

invoke('smokeSpreadsheet.getSheetByName("Participants").rows[1][3] = "actual-research"');
const polluted = snapshot();
assert.throws(() => invoke("runBtsLiveSmoke()"), /bts_smoke_non_smoke_data/); assertions++;
check(snapshot() === polluted, "non-smoke row guard leaves data untouched");
invoke('smokeSpreadsheet.getSheetByName("Participants").rows[1][3] = "bts-smoke-live-v1"');
invoke('smokeSpreadsheet.insertSheet("Unrelated").appendRow(["private user data"])');
assert.throws(() => invoke("runBtsLiveSmoke()"), /bts_smoke_non_smoke_data/); assertions++;
invoke('delete smokeSpreadsheet.sheets.Unrelated; this.savedPost = doPost; doPost = function() { return ContentService.createTextOutput(JSON.stringify({ok:false})); }');
assert.throws(() => invoke("runBtsLiveSmoke()"), /bts_smoke_failed:completion/); assertions++;
check(invoke('smokeProperties.BTS_PUBLIC_APP_URL === "https://original.invalid/" && smokeProperties.BTS_FOLLOWUP_TOKEN_SECRET === "preserved-private-secret"'), "failure also restores original settings");
check(invoke('JSON.stringify(Object.fromEntries(Object.entries(smokeProperties).filter(([key]) => key.startsWith("BTS_HTTP_")))) === savedHttpProperties'), "every preexisting HTTP setting is restored exactly on failure");
invoke('Object.keys(smokeProperties).filter(key => key.startsWith("BTS_HTTP_")).forEach(key => delete smokeProperties[key])');
assert.throws(() => invoke("runBtsLiveSmoke()"), /bts_smoke_failed:completion/); assertions++;
check(invoke('Object.keys(smokeProperties).every(key => !key.startsWith("BTS_HTTP_"))'), "all originally absent HTTP settings are removed on failure");
invoke('doPost = savedPost');
check(invoke('doPost({postData:{contents:JSON.stringify({schema_version:2})}}).getContent().includes("http_test_disabled")'), "failure cleanup leaves HTTP fail-closed");
check(snapshot() === after && invoke('MailApp.sent.length') === 0, "failure cleanup preserves records and sends no email");
console.log("PASS: " + assertions + " live-smoke helper assertions; " + first.checks_passed + " helper checks per run (mock services, NOT actual Google)");
