"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { loadExperiment, followupInstrumentSha256, reviewContent, productionPropertiesTemplate, sha256, canonicalJson } = require("../scripts/release-lib");
const root = path.resolve(__dirname, "..");
const app = loadExperiment(root);
let checks = 0;
function check(value, label) { checks++; assert.ok(value, label); }
function equal(a, b, label) { checks++; assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), label); }
function fixture() {
  const c = vm.createContext({ require, console, Buffer }); c.global = c;
  const gasMocks = fs.readFileSync(path.join(__dirname, "run-gas-mock-tests.js"), "utf8").split("let assertionCount = 0;")[0];
  vm.runInContext(gasMocks + "\nthis.spreadsheet = installGasMocks(); spreadsheet.name = 'BTS 後期3群比較 本番 local mock';", c);
  const formMocks = fs.readFileSync(path.join(__dirname, "run-google-forms-tests.js"), "utf8");
  const formContext = vm.createContext({ require, console, Buffer, __dirname });
  // Only reuse declarations and mock implementation; never run the other test suite.
  vm.runInContext(formMocks.slice(0, formMocks.indexOf("(async () =>")) + "\nthis.environment = mock('');", formContext);
  const env = formContext.environment;
  c.FormApp = env.context.FormApp;
  Object.assign(c.Utilities, {
    computeDigest: (_algorithm, value) => Array.from(crypto.createHash("sha256").update(typeof value === "string" ? value : Buffer.from(value)).digest()),
    base64Encode: value => Buffer.from(value).toString("base64"), base64Decode: value => Buffer.from(value, "base64"), newBlob: (bytes, type, name) => ({ bytes, type, name })
  });
  let locked = false;
  c.LockService = { getScriptLock: () => ({ waitLock() { if (locked) throw new Error("nested_lock"); locked = true; }, tryLock() { if (locked) return false; locked = true; return true; }, releaseLock() { locked = false; } }) };
  const logs = []; c.Logger = { log: value => logs.push(value) };
  const privateFiles = new Map();
  c.DriveApp = { Access: { PRIVATE: "PRIVATE" }, getFileById(id) { if (!privateFiles.has(id)) privateFiles.set(id, { access: "PRIVATE", editors: [], viewers: [], getSharingAccess() { return this.access; }, getEditors() { return this.editors; }, getViewers() { return this.viewers; } }); return privateFiles.get(id); } };
  const triggers = [];
  c.ScriptApp = { AuthMode: { FULL: "FULL" }, EventType: { ON_FORM_SUBMIT: "ON_FORM_SUBMIT" }, getProjectTriggers: () => triggers,
    newTrigger(handler) { const record = { handler }; return { forForm(form) { record.formId = form.getId(); return this; }, onFormSubmit() { return this; }, create() { const t = { uid: "trigger-" + (triggers.length + 1), getUniqueId() { return this.uid; }, getHandlerFunction: () => handler, getTriggerSourceId: () => record.formId, getEventType: () => "ON_FORM_SUBMIT" }; triggers.push(t); return t; } }; } };
  const originalCreate = c.FormApp.create;
  c.FormApp.create = (title, published) => {
    const form = originalCreate(title, published); form.initialBodyTitle = form.getTitle(); form.titleWrites = []; form.submitted = new Map(); form.prefills = [];
    const setTitle = form.setTitle;
    form.setTitle = value => {
      const registered = ["ja", "en"].map(language => JSON.parse(c.PropertiesService.getScriptProperties().getProperty("BTS_FORMS_PRODUCTION_V1:" + language) || "null"))
        .find(record => record && record.formId === form.getId());
      form.titleWrites.push({ value, registryStatus: registered ? registered.status : null });
      return setTitle.call(form, value);
    };
    form.getItemById = id => form.items.find(item => item.getId() === id);
    form.getResponse = id => { if (!form.submitted.has(id)) throw new Error("missing_response"); return form.submitted.get(id); };
    form.createResponse = () => {
      const answers = [];
      return { withItemResponse(value) { answers.push(value); return this; }, toPrefilledUrl() { form.prefills.push(answers); return "https://docs.google.com/forms/d/e/" + form.id + "/viewform?" + answers.map(a => "entry." + a.getItem().getId() + "=" + encodeURIComponent(a.getResponse())).join("&"); } };
    };
    for (const method of ["addTextItem", "addParagraphTextItem", "addMultipleChoiceItem", "addCheckboxItem", "addScaleItem", "addSectionHeaderItem", "addImageItem"]) {
      const original = form[method]; form[method] = () => { const item = original.call(form); item.createResponse = response => ({ getItem: () => item, getResponse: () => response }); return item; };
    }
    return form;
  };
  for (const file of ["Code.gs", "Forms.gs", "FormsResponseCore.gs", "FormsProduction.gs"]) vm.runInContext(fs.readFileSync(path.join(root, "gas", file), "utf8"), c, { filename: file });
  c.setupSheets();
  logs.length = 0;
  const settings = { mode: "production", spreadsheetId: c.spreadsheet.getId(), experimentId: app.EXPERIMENT_CONFIG.experimentId,
    allocationVersion: app.EXPERIMENT_CONFIG.allocationVersion, appVersion: app.EXPERIMENT_CONFIG.appVersion, contentVersion: app.EXPERIMENT_CONFIG.contentVersion,
    commonCorrectionVersion: app.EXPERIMENT_CONFIG.commonCorrectionVersion, instrumentVersion: app.EVALUATION_DATA.instrumentVersion,
    instrumentHash: followupInstrumentSha256(app), contentHash: "d".repeat(64), publicAppUrl: "https://example.invalid/", followupMode: "google_forms" };
  let enabled = false;
  // This isolated module test does not manufacture approval or test Production.gs.
  c.btsProductionSettings_ = () => { if (!enabled) throw new Error("production_disabled"); return settings; };
  c.btsProductionPreparationSettings_ = () => { if (enabled) throw new Error("production_preparation_disabled"); return settings; };
  function snapshot() { return JSON.stringify(c.spreadsheet.sheets); }
  function registry(language) { return c.btsFpRegistry_(language); }
  function parent(number = 1) {
    const now = new Date(); const id = "TEST" + String(number).padStart(2, "0");
    const row = { followup_id: "followup-parent-" + number, submission_id: "completion-parent-" + number,
      experiment_id: settings.experimentId, allocation_version: settings.allocationVersion, assignment_id: "assignment-parent-" + number,
      session_id: "session-parent-" + number, participant_id: id, participant_id_normalized: id, store_id: "A", condition: "original", requested: true,
      send_at: new Date(now.getTime() - 60000).toISOString(), token_expires_at: new Date(now.getTime() + 86400000).toISOString(), window_ends_at: new Date(now.getTime() + 3600000).toISOString(),
      instrument_version: settings.instrumentVersion, instrument_hash: settings.instrumentHash, content_version: settings.contentVersion,
      common_correction_version: settings.commonCorrectionVersion, token_hash: crypto.createHash("sha256").update("WEB-ORIGINAL-TOKEN-" + number).digest("hex"),
      question_ids_json: JSON.stringify(app.EVALUATION_DATA.extensions.followup.ja.filter(item => item.type !== "notice").map(item => item.id)), optional_question_ids_json: "[]", status: "scheduled" };
    for (const name of ["Assignments", "Participants", "FollowUp"]) {
      const values = { ...row };
      if (name === "Assignments") { values.status = "confirmed"; values.is_test = false; }
      if (name === "Participants") values.completion_status = "completed";
      c.appendMappedRow_(c.spreadsheet.getSheetByName(name), c.sheetDefinition_(name), values);
    }
    return row;
  }
  function prepare() { c.createBtsProductionFollowupForms(); enabled=true; c.installBtsProductionFormsTriggers(); c.publishBtsProductionFollowupForms(); }
  function issue(row, language = "ja") {
    const link = c.btsFormsFollowupLink_(c.spreadsheet, row, language, new Date(Date.now() - 1000));
    const r = registry(language); const form = env.forms.get(r.formId); const prefill = form.prefills.at(-1);
    return { link, r, form, credential: prefill.find(a => String(a.getItem().getId()) === r.qualificationItemId).getResponse() };
  }
  let responseSequence = 0;
  function event(row, issued, options = {}) {
    const r = issued.r, form = issued.form;
    const answers = r.itemMap.filter(map => map.sourceType !== "notice").map(map => {
      const item = form.getItemById(Number(map.itemId));
      const source = app.EVALUATION_DATA.extensions.followup[r.language].find(item => item.id === map.sourceId);
      let answer;
      if (map.sourceId === "participant_id") answer = row.participant_id_normalized;
      else if (source.type === "scale") answer = "2";
      else answer = source.choices.find(choice => choice[0] === (c.BTS_FORMS_SERVER_KEYS_[map.sourceId] || "A"));
      return item.createResponse(answer);
    });
    answers.push(form.getItemById(Number(r.qualificationItemId)).createResponse(issued.credential));
    const id = options.id || "google-response-" + ++responseSequence;
    const timestamp = options.timestamp || new Date(Date.now() - 100);
    const response = { answers, getId: () => id, getTimestamp: () => timestamp, getItemResponses: () => answers };
    form.submitted.set(id, response);
    return { source: form, response, triggerUid: r.triggerUid, authMode: "FULL" };
  }
  return { c, forms: env.forms, privateFiles, triggers, settings, logs, snapshot, registry, parent, prepare, issue, event, setEnabled(value) { enabled = value; }, locked: () => locked };
}
const setup = fixture();
const draftState = setup.c.PropertiesService.getScriptProperties().getProperty("BTS_FORMS_DRAFT_V1");
const pre = setup.c.createBtsProductionFollowupForms();
check(pre.forms.length === 2 && setup.forms.size === 2, "exactly two new followup forms");
check(pre.forms.every(row => {
  const form = setup.forms.get(row.formId), title = "BTS 1週間後 / Follow-up " + row.language + " " + setup.settings.instrumentVersion;
  return form.initialBodyTitle === "" && form.getTitle() === title && form.titleWrites.length === 1 && form.titleWrites[0].registryStatus === "building";
}), "empty Google body titles explicitly set only after new IDs are registered building");
equal(JSON.parse(setup.logs[0]), { status: "prepared", forms: pre.forms }, "successful preparation logs only safe status and form summary");
check(Object.keys(JSON.parse(setup.logs[0])).sort().join(",") === "forms,status" && JSON.parse(setup.logs[0]).forms.every(row => Object.keys(row).sort().join(",") === "formId,language,published,reused"), "summary uses an exact non-secret field allowlist");
check(!JSON.stringify(setup.logs).includes(setup.c.PropertiesService.getScriptProperties().getProperty("BTS_FORMS_QUALIFICATION_SECRET")), "setup log omits private qualification secret");
check([...setup.forms.values()].every(form => !form.published && !form.accepting && form.createdPublished === false), "created closed/unpublished from the start");
equal(setup.c.PropertiesService.getScriptProperties().getProperty("BTS_FORMS_DRAFT_V1"), draftState, "original draft registry unchanged");
check(setup.c.createBtsProductionFollowupForms().forms.every(row => row.reused) && setup.forms.size === 2, "setup is idempotent and does not create duplicate forms");
check(JSON.parse(setup.logs.at(-1)).forms.every(row => row.reused), "reused preparation reports safe reused summary");
check([...setup.forms.values()].every(form => !form.email && !form.quiz && !form.summary && !form.edits && !form.destination), "raw responses stay private in Forms without a response Sheet destination");
check([...setup.forms.values()].every(form => !JSON.stringify(form.items).includes("late_followup_transfer_stop\":\"C")), "no grading keys installed in forms");
assert.throws(() => setup.c.publishBtsProductionFollowupForms(), /publish_failed/); checks++;
check([...setup.forms.values()].every(form => !form.published), "publish refuses without registered triggers");
assert.throws(()=>setup.c.installBtsProductionFormsTriggers(),/production_disabled/);checks++;
assert.throws(()=>setup.c.btsFormsProductionReadiness_(new Date()),/production_disabled/);checks++;
check(setup.c.onBtsProductionFormSubmit({}).status==="rejected","preparation does not enable submission runtime");
setup.setEnabled(true);
assert.throws(()=>setup.c.createBtsProductionFollowupForms(),/production_preparation_disabled/);checks++;
setup.c.installBtsProductionFormsTriggers(); setup.c.installBtsProductionFormsTriggers();
check(setup.triggers.length === 2, "one installable FORM trigger per language, repeat install idempotent");
setup.c.publishBtsProductionFollowupForms();
check([...setup.forms.values()].every(form => form.published && form.accepting), "explicit publish opens verified two forms");
const beforeReadiness = setup.snapshot();
equal(setup.c.btsFormsProductionReadiness_(new Date()), { ready:true,languages:["ja","en"],measurement_mode:"forms" }, "mail sender has read-only readiness contract");
equal(setup.snapshot(),beforeReadiness,"readiness does not issue qualifications or write cells");
const savedTrigger=setup.triggers.pop();
assert.throws(()=>setup.c.btsFormsProductionReadiness_(new Date()),/trigger/); checks++;
setup.triggers.push(savedTrigger);
setup.setEnabled(false);
for (const operation of [() => setup.c.createBtsProductionFollowupForms(), () => setup.c.installBtsProductionFormsTriggers(), () => setup.c.publishBtsProductionFollowupForms()]) { assert.throws(operation); checks++; }
check(setup.c.onBtsProductionFormSubmit({}).status === "rejected", "disabled production rejects trigger");
setup.setEnabled(true); setup.c.publishBtsProductionFollowupForms();

for (const invalidTitle of ["", "Different form title"]) {
  const f = fixture(); f.c.createBtsProductionFollowupForms();
  const registry = f.registry("ja"), form = f.forms.get(registry.formId);
  form.setTitle(invalidTitle);
  // Even a stored signature computed from the wrong title cannot override the
  // canonical language/version title requirement.
  registry.signature = f.c.btsFpSignature_(form); f.c.btsFpSaveRegistry_(registry);
  const before = f.snapshot(), count = f.forms.size, logCount = f.logs.length;
  assert.throws(() => f.c.createBtsProductionFollowupForms(), /forms_production_title/); checks++;
  check(f.snapshot() === before && f.forms.size === count && f.logs.length === logCount, "wrong canonical title fails without writes, duplicate Forms, or success logs");
  f.setEnabled(true);
  assert.throws(() => f.c.installBtsProductionFormsTriggers(), /forms_production_title/); checks++;
  check(f.triggers.length === 0 && [...f.forms.values()].every(value => !value.published && !value.accepting), "invalid title cannot install triggers or publish");
}
{
  const f = fixture(), create = f.c.FormApp.create;
  f.c.FormApp.create = (title, published) => { const form = create(title, published); form.setTitle = () => form; return form; };
  assert.throws(() => f.c.createBtsProductionFollowupForms(), /forms_production_title/); checks++;
  const registry = JSON.parse(f.c.PropertiesService.getScriptProperties().getProperty("BTS_FORMS_PRODUCTION_V1:ja"));
  check(registry.status === "building" && f.forms.has(registry.formId) && f.forms.size === 1, "failed title readback preserves new form ID as building and does not start English form");
  check([...f.forms.values()].every(form => !form.published && !form.accepting && form.items.length === 0) && f.triggers.length === 0 && f.logs.length === 0, "failed title readback leaves an empty unpublished form without triggers or success log");
  assert.throws(() => f.c.createBtsProductionFollowupForms(), /forms_production_registry/); checks++;
  check(f.forms.size === 1, "building state never auto-recreates or silently resumes a failed title write");
  check(!f.locked(), "failed title write and building retry release lock");
}

for (const language of ["ja", "en"]) {
  const f = fixture(); f.prepare(); const row = f.parent(); const issued = f.issue(row, language);
  check(issued.link.measurement_mode === "forms" && issued.link.language === language, "authenticated link carries Forms mode and language");
  check(issued.link.form_url.includes(issued.credential) && !issued.link.form_url.includes("WEB-ORIGINAL-TOKEN"), "prefill uses independent qualification, never original Web token");
  check(!f.snapshot().includes(issued.credential), "credential is stored only as a hash, not raw");
  equal(f.issue(row, language).link, issued.link, "repeat lookup reuses stable credential without extra qualifications");
  const e = f.event(row, issued); const result = f.c.onBtsProductionFormSubmit(e);
  check(result.status === "accepted", "valid " + language + " submission accepted: " + JSON.stringify(result));
  const accepted = f.snapshot();
  check(f.c.onBtsProductionFormSubmit(e).status === "duplicate", "same Google response is idempotent");
  equal(f.snapshot(), accepted, "duplicate event does not change any cells");
  const target = f.c.btsFpFind_(f.c.spreadsheet, "FormsResponses", "receipt_key", result.receipt_key).object;
  const normalized = JSON.parse(target.normalized_json);
  check(normalized.measurement_mode === "forms" && normalized.started_at === null && normalized.response_time_ms === null && normalized.question_logs.length === 0, "separate Forms contract preserves missing measurements");
  check(normalized.answer_records.every(answer => answer.answered_at === null && answer.answer_change_count === null && answer.screen_dwell_time_ms === null), "no fake item times/counts");
  check(normalized.answer_records.filter(answer => answer.is_correct !== null).every(answer => answer.is_correct), "private server keys grade correct actual answers");
  check(!JSON.stringify(normalized).includes(issued.credential) && !JSON.stringify(result).includes(issued.credential), "accepted output and analytics omit qualification");
  const followup = f.c.httpFindRow_(f.c.spreadsheet, "FollowUp", "followup_id", row.followup_id).object;
  check(followup.status === "completed" && followup.response_submission_id === result.receipt_key && followup.response_started_at === "", "shared completion slot marks Forms done without start time");
  check(f.c.httpFindRow_(f.c.spreadsheet, "SubmissionReceipts", "submission_id", result.receipt_key).object.status === "complete", "shared receipt completed");
  check(f.c.spreadsheet.getSheetByName("QuestionLogs").getLastRow() === 1, "Forms does not create browser logs");
  check(f.c.spreadsheet.getSheetByName("Participants").getLastRow() === 2, "Forms does not create another participant");
  check(f.c.onBtsProductionFormSubmit(f.event(row, issued)).reason === "forms_production_conflict", "same qualification cannot create a second response");
  assert.throws(() => f.issue(row, language), /not_available/); checks++;
  check(!f.snapshot().includes(issued.credential) && !JSON.stringify(f.logs).includes(issued.credential), "qualification never appears in storage/logs even after rejection");
  check(!f.locked(), "lock always released");
}

function rejected(label, change, expectedReason) {
  const f = fixture(); f.prepare(); const row = f.parent(); const issued = f.issue(row); const e = f.event(row, issued);
  change(f, row, issued, e);
  const before = f.c.spreadsheet.getSheetByName("FormsResponses").getLastRow();
  const result = f.c.onBtsProductionFormSubmit(e);
  check(result.status === "rejected" && (!expectedReason || result.reason === expectedReason), label + ": " + JSON.stringify(result));
  check(f.c.spreadsheet.getSheetByName("FormsResponses").getLastRow() === before, label + " saves no analytic response");
  check(!f.snapshot().includes(issued.credential) && !JSON.stringify(result).includes(issued.credential), label + " leaks no credential");
  check(f.c.btsFpFind_(f.c.spreadsheet, "FormsQualifications", "credential_hash", f.c.sha256Hex_(issued.credential)).object.status === "issued", label + " does not consume qualification");
}
rejected("missing trigger UID", (_f,_r,_i,e) => { delete e.triggerUid; }, "forms_production_event");
rejected("wrong trigger UID", (_f,_r,_i,e) => { e.triggerUid = "foreign-trigger"; }, "forms_production_event");
rejected("wrong source form", (_f,_r,_i,e) => { e.source = { getId: () => "foreign-form" }; }, "forms_production_event");
rejected("limited auth mode", (_f,_r,_i,e) => { e.authMode = "LIMITED"; }, "forms_production_event");
rejected("forged Google response timestamp", (_f,_r,_i,e) => { e.response = { getId: e.response.getId, getTimestamp: () => new Date(0) }; }, "forms_production_event");
rejected("unknown credential", (_f,_r,i,e) => { e.response.answers[e.response.answers.length-1] = i.form.getItemById(Number(i.r.qualificationItemId)).createResponse("e".repeat(64)); }, "forms_production_credential");
rejected("duplicate credential item", (_f,_r,_i,e) => { e.response.answers.push(e.response.answers.at(-1)); }, "forms_production_credential");
rejected("missing credential item", (_f,_r,_i,e) => { e.response.answers.pop(); }, "forms_production_credential");
rejected("wrong participant", (_f,_r,_i,e) => { const first = e.response.answers[0]; e.response.answers[0] = first.getItem().createResponse("OTHR99"); });
rejected("forged choice prefix", (_f,_r,_i,e) => { const item = e.response.answers.find(a => a.getItem().getType() === "MULTIPLE_CHOICE"); const index = e.response.answers.indexOf(item); e.response.answers[index] = item.getItem().createResponse("C. forged choice"); });
rejected("missing required answer", (_f,_r,_i,e) => { e.response.answers.splice(1,1); });
rejected("unknown item ID", (_f,_r,_i,e) => { e.response.answers.push({ getItem: () => ({ getId: () => 9999999, getType: () => "TEXT" }), getResponse: () => "extra" }); });
rejected("mutated form choices", (_f,_r,i) => { i.form.items.find(item => item.type === "single").choices[0] = "changed"; });
rejected("empty form title", (_f,_r,i) => { i.form.setTitle(""); }, "forms_production_rejected");
rejected("modified form title", (_f,_r,i) => { i.form.setTitle("Not the study follow-up"); }, "forms_production_rejected");
rejected("raw response editors added", (f,_r,i) => { f.c.DriveApp.getFileById(i.r.formId).editors.push("reader"); }, "forms_production_privacy");
rejected("raw destination added", (_f,_r,i) => { i.form.destination = ["SPREADSHEET","external-sheet"]; }, "forms_production_privacy");
rejected("raw summary enabled", (_f,_r,i) => { i.form.summary = true; }, "forms_production_privacy");
rejected("stale instrument", (f) => { f.settings.instrumentVersion = "stale"; });
rejected("wrong stored parent condition", (f,row) => { const parent = f.c.httpFindRow_(f.c.spreadsheet,"Participants","submission_id",row.submission_id); f.c.updateMappedRow_(f.c.spreadsheet.getSheetByName("Participants"),f.c.sheetDefinition_("Participants"),parent.rowIndex,{condition:"improved"}); }, "forms_production_parent");
rejected("Web won shared completion slot", (f,row) => { const parent = f.c.httpFindRow_(f.c.spreadsheet,"FollowUp","followup_id",row.followup_id); f.c.updateMappedRow_(f.c.spreadsheet.getSheetByName("FollowUp"),f.c.sheetDefinition_("FollowUp"),parent.rowIndex,{response_submission_id:"web-response-001",response_completed_at:new Date().toISOString()}); }, "forms_production_conflict");
rejected("qualification binding changed", (f,_row,i) => { const q = f.c.btsFpFind_(f.c.spreadsheet,"FormsQualifications","credential_hash",f.c.sha256Hex_(i.credential)); f.c.btsFpUpdate_(f.c.spreadsheet,"FormsQualifications",q.rowIndex,{binding_json:"{}"}); }, "forms_production_credential");
rejected("qualification expiry changed independently", (f,_row,i) => { const q = f.c.btsFpFind_(f.c.spreadsheet,"FormsQualifications","credential_hash",f.c.sha256Hex_(i.credential)); f.c.btsFpUpdate_(f.c.spreadsheet,"FormsQualifications",q.rowIndex,{expires_at:new Date(Date.now()+864000000).toISOString()}); }, "forms_production_binding");
rejected("submission before credential issuance", (_f,_row,_i,e) => { const original=e.response;e.source.submitted.set(original.getId(),{...original,getTimestamp:()=>new Date(Date.now()-60000)});e.response=e.source.submitted.get(original.getId()); }, "forms_production_expired");
rejected("assignment session mismatch", (f,row) => { const parent=f.c.httpFindRow_(f.c.spreadsheet,"Assignments","assignment_id",row.assignment_id);f.c.updateMappedRow_(f.c.spreadsheet.getSheetByName("Assignments"),f.c.sheetDefinition_("Assignments"),parent.rowIndex,{session_id:"different-session"}); }, "forms_production_parent");
rejected("new deployment content hash", f => {f.settings.contentHash="e".repeat(64);}, "forms_production_registry");
rejected("map tampering", (f,_row,i) => {i.r.itemMap[1].itemId="9999999";f.c.btsFpSaveRegistry_(i.r);}, "forms_production_registry");

{
  const f=fixture();f.prepare();const row=f.parent(),ja=f.issue(row,"ja"),en=f.issue(row,"en"),e=f.event(row,en);
  e.response.answers[e.response.answers.length-1]=en.form.getItemById(Number(en.r.qualificationItemId)).createResponse(ja.credential);
  check(f.c.onBtsProductionFormSubmit(e).reason==="forms_production_binding","qualification bound to exact language/form");
  const accepted=f.c.onBtsProductionFormSubmit(f.event(row,ja));
  check(accepted.status==="accepted","proper language still accepted after invalid cross-language attempt");
  check(f.c.onBtsProductionFormSubmit(f.event(row,en)).reason==="forms_production_conflict","two legitimate language links cannot cause two completions");
}
{
  const f=fixture();f.prepare();const row=f.parent(),issued=f.issue(row),e=f.event(row,issued);
  const accepted=f.c.onBtsProductionFormSubmit(e);check(accepted.status==="accepted","edit test initial acceptance");
  const item=e.response.answers.find(a=>a.getItem().getType()==="MULTIPLE_CHOICE");e.response.answers[e.response.answers.indexOf(item)]=item.getItem().createResponse(item.getItem().choices[0]);
  check(f.c.onBtsProductionFormSubmit(e).reason==="forms_production_edited_response","same Google response ID with changed answers rejected");
  check(f.c.spreadsheet.getSheetByName("FormsResponses").getLastRow()===2,"edited response never replaces analytics");
}

for (const field of ["send_at", "token_expires_at"]) {
  const f=fixture(); f.prepare(); const row=f.parent(); const stored=f.c.httpFindRow_(f.c.spreadsheet,"FollowUp","followup_id",row.followup_id);
  f.c.updateMappedRow_(f.c.spreadsheet.getSheetByName("FollowUp"),f.c.sheetDefinition_("FollowUp"),stored.rowIndex,{[field]:new Date(Date.now()+(field==="send_at"?60000:-60000)).toISOString()});
  assert.throws(()=>f.issue(row),/not_available/); checks++;
  check(f.c.spreadsheet.getSheetByName("FormsQualifications").getLastRow()===1,"not-due/expired lookup issues no qualification");
}
// Failure after reservation is recoverable; Web sees the occupied shared slot.
{
  const f=fixture();f.prepare();const row=f.parent(),issued=f.issue(row),e=f.event(row,issued);
  const original=f.c.btsFpAppend_;let fail=true;
  f.c.btsFpAppend_=function(sheet,name,values){if(name==="FormsResponses"&&fail){fail=false;throw new Error("synthetic storage failure");}return original(sheet,name,values);};
  check(f.c.onBtsProductionFormSubmit(e).status==="rejected","injected storage error reported without raw details");
  check(f.c.httpFindRow_(f.c.spreadsheet,"FollowUp","followup_id",row.followup_id).object.response_submission_id.startsWith("forms_"),"valid response reserves shared slot before writes");
  check(f.c.onBtsProductionFormSubmit(e).status==="accepted","same event resumes after storage interruption");
  check(f.c.spreadsheet.getSheetByName("FormsResponses").getLastRow()===2,"recovery creates exactly one response");
}
function rebindFixture() {
  const f = fixture(), c = f.c, clone = value => JSON.parse(JSON.stringify(value));
  const oldContent = reviewContent(app, JSON.parse(fs.readFileSync(path.join(root, "baseline-manifest.json"), "utf8")), root);
  const oldHash = sha256(canonicalJson(oldContent)); f.settings.contentHash = oldHash;
  c.createBtsProductionFollowupForms();
  const oldData = clone(c.BTS_GOOGLE_FORMS_DRAFT_DATA_), newContent = clone(oldContent), newData = clone(oldData);
  newContent.evaluation.contentStatus = "researcher_adopted";
  newContent.evaluation.contentReviewIssues.forEach(issue => { issue.status = "resolved"; issue.note += " Mock-only adoption receipt, not a real approval."; });
  newData.contentStatus = newContent.evaluation.contentStatus;
  newData.contentReviewIssues = clone(newContent.evaluation.contentReviewIssues);
  delete newData.digest; newData.digest = sha256(canonicalJson(newData));
  const originalProperties = c.PropertiesService.getScriptProperties();
  const writes = [];
  const properties = { ...originalProperties, setProperties(values, deleteAll) {
    check(deleteAll === false, "rebind bulk write cannot erase unrelated properties"); writes.push(clone(values));
    Object.entries(values).forEach(([key, value]) => originalProperties.setProperty(key, value)); return this;
  } };
  c.PropertiesService.getScriptProperties = () => properties;
  const template = productionPropertiesTemplate(root), config = JSON.parse(template.BTS_PRODUCTION_CONFIG);
  config.spreadsheetId = c.spreadsheet.getId(); config.publicAppUrl = "https://example.invalid/";
  template.BTS_PRODUCTION_CONFIG = JSON.stringify(config); template.BTS_SPREADSHEET_ID = config.spreadsheetId;
  template.BTS_PUBLIC_APP_URL = config.publicAppUrl; template.BTS_PRODUCTION_EMAIL_APPROVED = "false";
  template.BTS_PRODUCTION_PARTICIPANT_SECRET = "a".repeat(64);
  Object.entries(template).forEach(([key, value]) => originalProperties.setProperty(key, value));
  // Unlike the rest of this isolated Forms suite, rebind exercises the actual
  // Production.gs preparation guard, with an explicitly closed fake workspace.
  vm.runInContext(fs.readFileSync(path.join(root, "gas/Production.gs"), "utf8"), c);
  c.spreadsheet.getSheets = () => Object.values(c.spreadsheet.sheets);
  c.spreadsheet.getSheets().forEach(sheet => { sheet.getName = () => sheet.name; });
  const identity = { effective: "owner@example.invalid" };
  c.DriveApp.getRootFolder = () => ({ getOwner: () => ({ getEmail: () => identity.effective }) });
  [c.spreadsheet.getId(), ...[...f.forms.values()].map(form => form.getId())].forEach(id => {
    const file = c.DriveApp.getFileById(id); file.owner = "owner@example.invalid"; file.getOwner = () => ({ getEmail: () => file.owner });
  });
  const request = { schemaVersion: 1, reason: "researcher_adoption_metadata_only", adoptionReceivedAt: new Date(Date.now() - 10000).toISOString(),
    spreadsheetId: c.spreadsheet.getId(), formIds: { ja: f.registry("ja").formId, en: f.registry("en").formId },
    oldContentHash: oldHash, newContentHash: sha256(canonicalJson(newContent)), oldReviewContent: oldContent, newReviewContent: newContent,
    oldFormsData: oldData, newFormsData: newData };
  c.BTS_GOOGLE_FORMS_DRAFT_DATA_ = newData; c.BTS_FORMS_METADATA_REBIND_ = request;
  function recalculate() {
    request.oldContentHash = sha256(canonicalJson(request.oldReviewContent)); request.newContentHash = sha256(canonicalJson(request.newReviewContent));
    for (const data of [request.oldFormsData, request.newFormsData]) { delete data.digest; data.digest = sha256(canonicalJson(data)); }
  }
  return { ...f, request, properties, writes, identity, recalculate };
}
{
  const f = rebindFixture(), before = f.snapshot(), ids = [...f.forms.keys()], signatures = [...f.forms.values()].map(form => f.c.btsFpSignature_(form));
  const originalConfig = JSON.parse(f.properties.getProperty("BTS_PRODUCTION_CONFIG"));
  const result = f.c.rebindClosedBtsProductionFormsMetadata();
  check(result.status === "metadata_rebound_closed" && result.reviewsApproved === false, "metadata-only rebind succeeds without approvals");
  check(f.writes.length === 1 && Object.keys(f.writes[0]).sort().join(",") === "BTS_FORMS_METADATA_REBIND_V1,BTS_FORMS_PRODUCTION_V1:en,BTS_FORMS_PRODUCTION_V1:ja,BTS_PRODUCTION_CONFIG,BTS_PRODUCTION_REVIEW", "one allowlisted bulk property write only");
  equal([...f.forms.keys()], ids, "rebind preserves both existing form IDs"); equal(f.snapshot(), before, "rebind writes no Sheet cells");
  equal([...f.forms.values()].map(form => f.c.btsFpSignature_(form)), signatures, "rebind changes no form/item/image/title/signature");
  const updated = JSON.parse(f.properties.getProperty("BTS_PRODUCTION_CONFIG")); updated.contentHash = originalConfig.contentHash;
  equal(updated, originalConfig, "only config contentHash changes; dates/caps/mode preserved");
  const review = JSON.parse(f.properties.getProperty("BTS_PRODUCTION_REVIEW"));
  check(review.reviewer === "" && review.reviewedAt === "" && Object.values(review.approvals).every(value => value === false) && review.contentSha256 === f.request.newContentHash, "empty review template rebound without invented identity/date/approval");
  for (const language of ["ja", "en"]) {
    const registry = f.registry(language);
    check(registry.contentHash === f.request.newContentHash && registry.digest === f.request.newFormsData.digest && registry.itemMap.every(row => row.instrumentDigest === f.request.newFormsData.digest), "registry and every map digest rebound consistently");
  }
  check(f.properties.getProperty("BTS_HTTP_MODE") === "disabled" && f.properties.getProperty("BTS_PRODUCTION_ENABLED") === "false" && f.properties.getProperty("BTS_EMAIL_ENABLED") === "false", "rebind never enables production, HTTP or email");
  const audit = JSON.parse(f.properties.getProperty("BTS_FORMS_METADATA_REBIND_V1"));
  check(audit.oldContentHash === f.request.oldContentHash && audit.newContentHash === f.request.newContentHash && audit.adoptionReceivedAt === f.request.adoptionReceivedAt && audit.reason === f.request.reason, "private audit stores old/new hashes and actual receipt separately from review date");
  check(!JSON.stringify(audit).includes("owner@example") && !JSON.stringify(audit).includes("a".repeat(64)), "audit excludes owner email and secrets");
  check(f.c.rebindClosedBtsProductionFormsMetadata().status === "already_rebound_closed" && f.writes.length === 1, "exact successful retry is verified and read-only");
  check(!f.locked(), "rebind releases script lock");
}
function rebindRejected(label, alter, pattern) {
  const f = rebindFixture(); alter(f);
  const before = f.snapshot(), signatures = [...f.forms.values()].map(form => f.c.btsFpSignature_(form));
  assert.throws(() => f.c.rebindClosedBtsProductionFormsMetadata(), pattern); checks++;
  check(f.writes.length === 0 && f.snapshot() === before, label + ": fails before properties/cells mutation");
  equal([...f.forms.values()].map(form => f.c.btsFpSignature_(form)), signatures, label + ": no form mutations");
  check(!f.locked(), label + ": releases lock");
}
rebindRejected("missing explicit old snapshot", f => { delete f.request.oldReviewContent; }, /rebind_snapshot/);
rebindRejected("wrong old content hash", f => { f.request.oldContentHash = "e".repeat(64); }, /rebind_snapshot/);
rebindRejected("forged old snapshot", f => { f.request.oldReviewContent.correctedBase.questions[0].title = "changed"; f.recalculate(); }, /rebind_metadata_only/);
rebindRejected("nonmetadata material change", f => { f.request.newReviewContent.correctedBase.questions[0].title = "changed"; f.recalculate(); }, /rebind_metadata_only/);
rebindRejected("issue severity bypass", f => { f.request.newReviewContent.evaluation.contentReviewIssues[0].severity = "info"; f.request.newFormsData.contentReviewIssues[0].severity = "info"; f.recalculate(); }, /rebind_metadata_only/);
rebindRejected("removed issue", f => { f.request.newReviewContent.evaluation.contentReviewIssues.pop(); f.request.newFormsData.contentReviewIssues.pop(); f.recalculate(); }, /rebind_metadata_only/);
rebindRejected("question definition change", f => { f.request.newFormsData.forms[0].items[0].title = "changed"; f.recalculate(); }, /rebind_metadata_only/);
rebindRejected("image change", f => { Object.values(f.request.newFormsData.images)[0].base64 = "changed"; f.recalculate(); }, /rebind_metadata_only/);
rebindRejected("wrong compiled new snapshot", f => { f.c.BTS_GOOGLE_FORMS_DRAFT_DATA_ = f.request.oldFormsData; }, /rebind_metadata_only/);
rebindRejected("future adoption receipt", f => { f.request.adoptionReceivedAt = new Date(Date.now() + 3600000).toISOString(); }, /rebind_snapshot/);
rebindRejected("missing owner identity", f => { f.identity.effective = ""; }, /rebind_owner/);
rebindRejected("different effective user", f => { f.identity.effective = "other@example.invalid"; }, /rebind_owner/);
rebindRejected("nonowner", f => { f.c.DriveApp.getFileById(f.request.spreadsheetId).owner = "other@example.invalid"; }, /rebind_owner/);
rebindRejected("shared private Sheet", f => { f.c.DriveApp.getFileById(f.request.spreadsheetId).editors.push("editor"); }, /rebind_owner/);
rebindRejected("wrong target Sheet", f => { f.request.spreadsheetId = "other-sheet"; }, /rebind_spreadsheet/);
for (const key of ["BTS_HTTP_MODE", "BTS_PRODUCTION_ENABLED", "BTS_EMAIL_ENABLED", "BTS_PRODUCTION_EMAIL_APPROVED"]) {
  rebindRejected("enabled " + key, f => { f.properties.setProperty(key, key === "BTS_HTTP_MODE" ? "production" : "true"); }, /rebind_disable_required/);
}
rebindRejected("any project trigger", f => { f.triggers.push({ unrelated: true }); }, /rebind_triggers/);
for (const name of ["logs", "followup_queue", "Assignments", "Participants", "QuestionLogs", "Contact", "FollowUp", "SubmissionReceipts", "FormsQualifications", "FormsResponses", "FormsQuarantine"]) {
  rebindRejected("used " + name, f => { f.c.spreadsheet.getSheetByName(name).appendRow(["existing"]); }, /rebind_used_storage/);
}
rebindRejected("wrong header", f => { f.c.spreadsheet.getSheetByName("Contact").rows[0][0] = "different"; }, /rebind_used_storage/);
rebindRejected("missing required sheet", f => { delete f.c.spreadsheet.sheets.Contact; }, /rebind_used_storage/);
rebindRejected("unrecognized nonempty sheet", f => { const sheet = f.c.spreadsheet.insertSheet("unrecognized"); sheet.getName = () => sheet.name; sheet.appendRow(["data"]); }, /rebind_used_storage/);
for (const language of ["ja", "en"]) {
  for (const field of ["published", "accepting", "responses"]) rebindRejected(language + " used form " + field, f => { f.forms.get(f.request.formIds[language])[field] = field === "responses" ? [{}] : true; }, /rebind_used_form/);
}
rebindRejected("registry wrong content hash", f => { const r = f.registry("en"); r.contentHash = "e".repeat(64); f.c.btsFpSaveRegistry_(r); }, /forms_production_registry/);
rebindRejected("registry map digest mismatch", f => { const r = f.registry("en"); r.itemMap[0].instrumentDigest = "e".repeat(64); f.c.btsFpSaveRegistry_(r); }, /forms_production_registry/);
rebindRejected("registry still has trigger ID", f => { const r = f.registry("ja"); r.triggerUid = "old-trigger"; f.c.btsFpSaveRegistry_(r); }, /rebind_registry/);
rebindRejected("wrong form ID", f => { f.request.formIds.en = "unregistered"; }, /rebind_registry/);
rebindRejected("wrong canonical title", f => { const r = f.registry("ja"), form = f.forms.get(r.formId); form.setTitle("changed"); r.signature = f.c.btsFpSignature_(form); f.c.btsFpSaveRegistry_(r); }, /forms_production_title/);
rebindRejected("wrong description even with resigned registry", f => { const r = f.registry("ja"), form = f.forms.get(r.formId); form.setDescription("changed"); r.signature = f.c.btsFpSignature_(form); f.c.btsFpSaveRegistry_(r); }, /rebind_form_metadata/);
rebindRejected("response destination", f => { f.forms.get(f.request.formIds.en).destination = ["SPREADSHEET", "other"]; }, /forms_production_privacy/);
rebindRejected("raw form editors", f => { f.c.DriveApp.getFileById(f.request.formIds.en).editors.push("editor"); }, /forms_production_privacy/);
rebindRejected("actual review must not be overwritten", f => { const r = JSON.parse(f.properties.getProperty("BTS_PRODUCTION_REVIEW")); r.reviewer = "Actual Reviewer"; f.properties.setProperty("BTS_PRODUCTION_REVIEW", JSON.stringify(r)); }, /rebind_review_template_required/);
rebindRejected("prior mismatched audit", f => { f.properties.setProperty("BTS_FORMS_METADATA_REBIND_V1", "{}"); }, /rebind_recovery_required/);
{
  const f = rebindFixture(), original = f.properties.setProperties;
  f.properties.setProperties = values => { f.writes.push(values); f.properties.setProperty("BTS_PRODUCTION_CONFIG", values.BTS_PRODUCTION_CONFIG); throw new Error("synthetic partial write"); };
  assert.throws(() => f.c.rebindClosedBtsProductionFormsMetadata(), /rebind_recovery_required/); checks++;
  f.properties.setProperties = original;
  assert.throws(() => f.c.rebindClosedBtsProductionFormsMetadata(), /rebind_recovery_required/); checks++;
  check(f.writes.length === 1, "partial write cannot be retried blindly or rolled back");
  check(f.properties.getProperty("BTS_PRODUCTION_ENABLED") === "false" && f.properties.getProperty("BTS_EMAIL_ENABLED") === "false", "partial write leaves production and email disabled");
}
{
  const f = rebindFixture(), original = f.properties.setProperties;
  f.properties.setProperties = (values, deleteAll) => { original(values, deleteAll); throw new Error("lost acknowledgement"); };
  assert.throws(() => f.c.rebindClosedBtsProductionFormsMetadata(), /rebind_recovery_required/); checks++;
  f.properties.setProperties = original;
  check(f.c.rebindClosedBtsProductionFormsMetadata().status === "already_rebound_closed" && f.writes.length === 1, "full write with lost acknowledgement is safely recognized on retry");
}
function launchFixture() {
  const f = rebindFixture(), c = f.c; c.rebindClosedBtsProductionFormsMetadata();
  vm.runInContext(fs.readFileSync(path.join(root, "gas/ProductionLaunch.gs"), "utf8"), c);
  vm.runInContext(fs.readFileSync(path.join(root, "gas/ProductionEmail.gs"), "utf8"), c);
  const config = JSON.parse(f.properties.getProperty("BTS_PRODUCTION_CONFIG")), review = JSON.parse(f.properties.getProperty("BTS_PRODUCTION_REVIEW"));
  Object.assign(config, {opensAt: "2020-01-01T00:00:00Z", enrollmentOpensAt: "2030-10-01T00:00:00Z", enrollmentClosesAt: "2030-11-01T00:00:00Z", completionClosesAt: "2030-11-08T00:00:00Z", closesAt: "2030-12-16T00:00:00Z", maxAssignments: "unlimited", maxDailyAssignments: "unlimited"});
  Object.assign(review, {reviewer: "ISOLATED MOCK, NOT ACTUAL APPROVAL", reviewedAt: "2020-01-01T00:00:00Z"});
  Object.keys(review.approvals).forEach(key => { review.approvals[key] = true; });
  c.BTS_PRODUCTION_OPERATING_ = {config, review, contactEmail: "operator@example.invalid", testEmail: {approved: true, approvedAt: "2020-01-01T00:00:00Z", recipient: "operator@example.invalid"}, automatedEmail: {approved: true, approvedAt: "2020-01-01T00:00:00Z", batchLimit: 10, dailyLimit: 100}};
  const sent = []; c.MailApp = {getRemainingDailyQuota: () => 100, sendEmail: value => {sent.push(value);}};
  return {...f, config, review, sent};
}
{
  const f = launchFixture(), before = f.snapshot();
  check(f.c.configureBtsProductionOperatingPeriod().status === "configured_closed", "recorded operating settings installed while closed");
  check(f.snapshot() === before && f.sent.length === 0 && f.triggers.length === 0, "configuration touches no sheets, sends or triggers");
  check(f.c.configureBtsProductionOperatingPeriod().reused, "identical recorded operating settings can be verified again");
  check(f.c.enableBtsProductionDatedCollection().status === "dated_collection_enabled", "explicit activation enables dated HTTP only");
  check(f.properties.getProperty("BTS_EMAIL_ENABLED") === "false" && f.forms.size === 2 && [...f.forms.values()].every(form => !form.published), "activation never enables mail or publishes Forms");
  check(f.c.enableBtsProductionDatedCollection().reused, "identical activation is idempotent");
  check(f.c.sendBtsProductionConnectionTestEmail().status === "test_mail_sent" && f.sent.length === 1, "separately approved test sends one email");
  check(f.sent[0].to === "operator@example.invalid" && f.sent[0].subject.includes("動作確認") && !f.sent[0].body.includes("#token="), "test email has only approved recipient and no participant credential");
  assert.throws(() => f.c.sendBtsProductionConnectionTestEmail(), /already_attempted/); checks++;
  check(f.sent.length === 1 && !f.locked(), "test message cannot be automatically repeated");
}
for (const [label, mutate, pattern] of [
  ["other content", f => {f.config.contentHash = "e".repeat(64);}, /launch_config_changed/],
  ["wrong reviewer hash", f => {f.review.contentSha256 = "e".repeat(64);}, /production_review_required/],
  ["missing approval", f => {f.review.approvals.noImageScenes = false;}, /production_review_required/],
  ["invalid dates", f => {f.config.enrollmentOpensAt = "2031-01-01T00:00:00Z";}, /production_not_configured/],
  ["used sheet", f => {f.c.spreadsheet.getSheetByName("Participants").appendRow(["used"]);}, /rebind_used_storage/],
  ["published form", f => {f.forms.values().next().value.published = true;}, /launch_form_used/],
  ["existing trigger", f => {f.triggers.push({});}, /launch_disable_required/],
  ["wrong owner", f => {f.identity.effective = "other@example.invalid";}, /rebind_owner/]
]) {
  const f = launchFixture(); mutate(f); const before = JSON.stringify(f.properties); const writes = f.writes.length;
  assert.throws(() => f.c.configureBtsProductionOperatingPeriod(), pattern, label); checks++;
  check(f.writes.length === writes && f.sent.length === 0 && !f.locked(), label + " fails before writes or mail");
}
{
  const f = launchFixture(); f.c.BTS_PRODUCTION_OPERATING_.testEmail.approved = false;
  assert.throws(() => f.c.sendBtsProductionConnectionTestEmail(), /not_approved/); checks++;
  check(f.sent.length === 0, "missing test approval sends nothing");
  f.c.BTS_PRODUCTION_OPERATING_.testEmail.approved = true;
  f.c.MailApp.sendEmail = () => {throw new Error("ambiguous mail transport");};
  assert.throws(() => f.c.sendBtsProductionConnectionTestEmail(), /delivery_unknown_do_not_retry/); checks++;
  assert.throws(() => f.c.sendBtsProductionConnectionTestEmail(), /already_attempted/); checks++;
  check(JSON.parse(f.properties.getProperty("BTS_PRODUCTION_CONNECTION_TEST_MAIL_V1")).status === "sending", "uncertain delivery is terminal and never retried");
}
{
  const f = launchFixture();
  f.c.configureBtsProductionOperatingPeriod(); f.c.enableBtsProductionDatedCollection();
  assert.throws(() => f.c.enableBtsProductionFollowupEmail(), /forms_production_/); checks++;
  f.c.installBtsProductionFormsTriggers(); f.c.publishBtsProductionFollowupForms();
  assert.throws(() => f.c.enableBtsProductionFollowupEmail(), /test_mail_required/); checks++;
  f.c.sendBtsProductionConnectionTestEmail();
  const snapshot = f.snapshot(), triggers = f.triggers.length;
  const result = f.c.enableBtsProductionFollowupEmail();
  check(result.status === "followup_email_enabled" && result.sendsByThisCall === 0 && f.sent.length === 1, "email activation sends no participant messages");
  check(f.snapshot() === snapshot && f.triggers.length === triggers && f.c.btsEmailApproved_(), "email activation changes only explicit email properties");
  check(f.c.enableBtsProductionFollowupEmail().reused, "identical email activation does not duplicate work");
  check(f.properties.getProperty("BTS_PRODUCTION_EMAIL_BATCH_LIMIT") === "10" && f.properties.getProperty("BTS_PRODUCTION_EMAIL_DAILY_LIMIT") === "100", "email limits separate from unlimited enrollment");
  const report = f.c.reportBtsProductionLaunchReadiness();
  check(report.forms.ready && report.testMailStatus === "sent" && report.mailboxDeliveryConfirmed === false && report.emailEnabled, "read-only readiness separates sent from arrived");
  check(Object.values(report.tableRows).every(n => n === 0) && !JSON.stringify(report).includes("operator@example.invalid") && !JSON.stringify(report).includes("a".repeat(64)), "readiness evidence has zero responses and no contacts or secrets");
}
for (const key of ["approved", "approvedAt", "batchLimit", "dailyLimit"]) {
  const f = launchFixture(); delete f.c.BTS_PRODUCTION_OPERATING_.automatedEmail[key];
  assert.throws(() => f.c.enableBtsProductionFollowupEmail(), /approval_required/); checks++;
  check(f.sent.length === 0 && f.properties.getProperty("BTS_EMAIL_ENABLED") === "false", "incomplete " + key + " never enables mail");
}
console.log(JSON.stringify({status:"passed",checks,scope:"local mocks only; metadata rebind and launch use actual Production.gs guards; no Google resources, scopes, publication or real email",productionApprovalGranted:false},null,2));
