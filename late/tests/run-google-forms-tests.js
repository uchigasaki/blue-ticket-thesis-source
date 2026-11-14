"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { instrument, sourceFor } = require("../scripts/build-google-forms");
const { loadExperiment } = require("../scripts/release-lib");
const root = path.resolve(__dirname, "..");
let checks = 0;
function check(value, message) { checks++; assert.ok(value, message); }
function mock(source) {
  const forms = new Map(); const sheets = new Map(); const properties = new Map(); const logs = []; let id = 1; let locked = false;
  class Item {
    constructor(type) { this.type = type; this.id = id++; this.title = ""; this.help = ""; }
    getId() { return this.id; } getTitle() { return this.title; } getHelpText() { return this.help; }
    getType() { return ({ image: "IMAGE", single: "MULTIPLE_CHOICE", multi: "CHECKBOX", scale: "SCALE", number: "TEXT", text: "PARAGRAPH_TEXT", notice: "SECTION_HEADER" })[this.type]; }
    asMultipleChoiceItem() { return this; } asCheckboxItem() { return this; } asScaleItem() { return this; } asTextItem() { return this; } asParagraphTextItem() { return this; } asImageItem() { return this; }
    getChoices() { return this.choices.map(value => ({ getValue: () => value, getPageNavigationType: () => this.navigation || null, getGotoPage: () => null })); } hasOtherOption() { return !!this.other; } isRequired() { return !!this.required; }
    getWidth() { return this.width; } getImage() { return {getBytes: () => this.image.bytes}; }
    getLowerBound() { return this.bounds[0]; } getUpperBound() { return this.bounds[1]; } getLeftLabel() { return this.labels[0]; } getRightLabel() { return this.labels[1]; }
    setTitle(v) { this.title = v; return this; } setHelpText(v) { this.help = v; return this; }
    setChoiceValues(v) { this.choices = Array.from(v); return this; } setBounds(a,b) { this.bounds = [a,b]; return this; }
    setLabels(a,b) { this.labels = [a,b]; return this; } setRequired(v) { this.required = v; return this; }
    setValidation(v) { this.validation = v; return this; } setImage(v) { this.image = v; return this; } setWidth(v) { this.width = v; return this; }
  }
  class Form {
    constructor(title, published) { this.id = "form-" + id++; this.documentTitle = title; this.title = ""; this.published = published; this.accepting = published; this.items = []; this.createdPublished = published; }
    getId() { return this.id; } getItems() { return this.items; } getEditUrl() { return "https://docs.google.com/forms/d/" + this.id + "/edit"; }
    getTitle() { return this.title; } setTitle(value) { this.title = value; return this; } getResponses() { return this.responses || []; }
    supportsAdvancedResponderPermissions() { return true; } isPublished() { return this.published; } isAcceptingResponses() { return this.accepting; }
    setPublished(v) { this.published = v; this.accepting = v; return this; } setAcceptingResponses(v) { this.accepting = v; return this; }
    collectsEmail() { return this.email; } isQuiz() { return this.quiz; } isPublishingSummary() { return this.summary; }
    canEditResponse() { return this.edits; } hasRespondAgainLink() { return this.again; } hasLimitOneResponsePerUser() { return this.one; } getShuffleQuestions() { return this.shuffle; } hasProgressBar() { return this.progress; }
    getDescription() { return this.description; } getConfirmationMessage() { return this.confirmation; }
    setCollectEmail(v) { this.email = v; return this; } setIsQuiz(v) { this.quiz = v; return this; } setPublishingSummary(v) { this.summary = v; return this; }
    setAllowResponseEdits(v) { this.edits = v; return this; } setShowLinkToRespondAgain(v) { this.again = v; return this; }
    setLimitOneResponsePerUser(v) { this.one = v; return this; } setShuffleQuestions(v) { this.shuffle = v; return this; } setProgressBar(v) { this.progress = v; return this; }
    setCustomClosedFormMessage() { throw new Error("Google rejects custom closed messages for these unpublished drafts"); } setDescription(v) { this.description = v; return this; } setConfirmationMessage(v) { this.confirmation = v; return this; }
    setDestination(type, target) { this.destination = [type, target]; return this; }
    getDestinationId() { if (this.destinationError) throw new Error(this.destinationError); if (!this.destination) throw new Error("The form currently has no response destination."); return this.destination[1]; }
  }
  const methodTypes = { addImageItem: "image", addMultipleChoiceItem: "single", addCheckboxItem: "multi", addScaleItem: "scale", addTextItem: "number", addParagraphTextItem: "text", addSectionHeaderItem: "notice" };
  for (const [method,type] of Object.entries(methodTypes)) Form.prototype[method] = function () { const item = new Item(type); this.items.push(item); return item; };
  class Sheet {
    constructor(name) { this.name = name; this.values = []; }
    getLastRow() { return this.values.length; } getLastColumn() { return this.values.length ? this.values[0].length : 0; }
    setName(v) { this.name = v; return this; } getRange(r,c,rows,columns) { return { getValues: () => this.values, setValues: values => { check(values.length === rows && values.every(row => row.length === columns), "sheet range dimensions"); this.values = values; return this; } }; }
  }
  class Spreadsheet {
    constructor(title) { this.id = "sheet-" + id++; this.title = title; this.sheets = [new Sheet("Sheet1")]; }
    getId() { return this.id; } getUrl() { return "https://docs.google.com/spreadsheets/d/" + this.id + "/edit"; }
    getSheets() { return this.sheets; } getSheetByName(name) { return this.sheets.find(s => s.name === name); } insertSheet(name) { const sheet = new Sheet(name); this.sheets.push(sheet); return sheet; }
  }
  const validation = () => ({ requireNumberBetween(a,b) { this.range = [a,b]; return this; }, requireTextMatchesPattern(p) { this.pattern = p; return this; }, setHelpText(v) { this.help = v; return this; }, build() { return this; } });
  const context = vm.createContext({
    FormApp: { create(title, published) { const form = new Form(title, published); forms.set(form.id,form); return form; }, openById(id) { if (!forms.has(id)) throw Error("missing form"); return forms.get(id); }, createTextValidation: validation, DestinationType: { SPREADSHEET: "SPREADSHEET" } },
    SpreadsheetApp: { create(title) { const s = new Spreadsheet(title); sheets.set(s.id,s); return s; }, openById(id) { return sheets.get(id); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => properties.get(k) || null, setProperty(k,v) { check(Buffer.byteLength(v) < 9000, "property quota"); properties.set(k,v); } }) },
    LockService: { getScriptLock: () => ({ waitLock() { check(!locked, "single lock"); locked = true; }, releaseLock() { locked = false; } }) },
    Utilities: { DigestAlgorithm: { SHA_256: "SHA-256" }, Charset: { UTF_8: "UTF-8" }, computeDigest: (_,v) => Array.from(crypto.createHash("sha256").update(typeof v === "string" ? v : Buffer.from(v)).digest()), base64Encode: v => Buffer.from(v).toString("base64"), base64Decode: v => Buffer.from(v,"base64"), newBlob: (bytes,type,name) => ({ bytes,type,name }) },
    Logger: { log: value => logs.push(value) }
  });
  vm.runInContext(source,context);
  return { context, forms, sheets, properties, logs, get locked() { return locked; } };
}
function completeGeneration(environment) {
  for (let i=0;i<7;i++) { const result=environment.context.createLateSurveyDraftForms(); if(result.status==="drafts_closed_unpublished") return result; }
  throw new Error("Draft generator did not finish in six single-form runs");
}
(async () => {
  const context = loadExperiment(root);
  const source = fs.readFileSync(path.join(root,"gas/Forms.gs"),"utf8");
  const environment = mock(source);
  const data = environment.context.BTS_GOOGLE_FORMS_DRAFT_DATA_;
  const exportQa = environment.context.BTS_GOOGLE_FORMS_IMAGE_EXPORT_QA_;
  check(exportQa.exports.length===2 && exportQa.visualComparedAt==="2026-09-24" && exportQa.observedAt==="2026-09-25" && exportQa.scope.includes("not research adoption approval"),"image export exceptions retain dated rendering-only QA scope");
  for(const entry of exportQa.exports){
    const spec={sourceId:entry.sourceId,asset:{sha256:entry.sourcePngSha256}};
    check(environment.context.btsFormsIsKnownImageExport_(spec,entry.googleByteSha256,640),"exact visual-QA image export pair accepted "+entry.sourceId);
    check(environment.context.btsFormsIsKnownImageExport_(spec,entry.sourcePngSha256,640),"original image bytes still accepted "+entry.sourceId);
    check(!environment.context.btsFormsIsKnownImageExport_(spec,"f".repeat(64),640),"unknown Google export rejected "+entry.sourceId);
    check(!environment.context.btsFormsIsKnownImageExport_({sourceId:entry.sourceId,asset:{sha256:"a".repeat(64)}},entry.googleByteSha256,640),"changed source PNG rejected "+entry.sourceId);
    check(!environment.context.btsFormsIsKnownImageExport_({sourceId:"late_post_unreviewed:image",asset:{sha256:entry.sourcePngSha256}},entry.googleByteSha256,640),"different source ID rejected "+entry.sourceId);
    check(!environment.context.btsFormsIsKnownImageExport_(spec,entry.googleByteSha256,639),"different export width rejected "+entry.sourceId);
  }
  check(data.forms.length === 6, "six phase/language forms");
  check(Object.keys(data.images).length === 4, "four unique PNG illustrations");
  check(!Object.hasOwn(data,"answerKeys"), "no answer keys exposed");
  for (const [name,asset] of Object.entries(data.images)) {
    check(asset.mimeType === "image/png" && Buffer.from(asset.base64,"base64").subarray(0,8).toString("hex") === "89504e470d0a1a0a", name + " rasterized");
    check(crypto.createHash("sha256").update(fs.readFileSync(path.join(root,name))).digest("hex") === asset.sourceSha256, name + " source digest");
  }
  for (const definition of data.forms) {
    const base = definition.phase === "pre" ? context.APP_DATA.survey[definition.language] : definition.phase === "post" ? context.APP_DATA.postSurvey[definition.language] : [];
    const expected = context.EXPERIMENT_CONTEXT.mergeSurveyItems(base,definition.phase,{ language: definition.language });
    check(JSON.stringify(expected) === JSON.stringify(definition.items), "actual merged source " + definition.phase + ":" + definition.language);
  }
  const firstResult = environment.context.createLateSurveyDraftForms();
  check(firstResult.completedForms===1 && firstResult.status==="drafts_partially_complete_closed_unpublished" && environment.forms.size===1,"normal generation finishes only one form per run");
  const result = completeGeneration(environment);
  check(result.forms.length === 6 && environment.forms.size === 6 && environment.sheets.size === 1,"six new forms and one separate sheet");
  const beforeImageReport = JSON.stringify({forms:[...environment.forms],sheets:[...environment.sheets],props:[...environment.properties]});
  const imageReport = environment.context.reportLateSurveyDraftImageExports();
  const exportedImages = imageReport.forms.flatMap(form => form.images);
  check(imageReport.mode==="read_only_image_exports" && exportedImages.length===8 && exportedImages.every(row=>row.width===640 && row.sourceId && row.sourcePngSha256===row.googleByteSha256),"image diagnostic reports only registered image IDs and byte digests");
  check(!JSON.stringify(imageReport).includes("base64") && !JSON.stringify(imageReport).includes("participant_id"),"image diagnostic contains no image bytes or answer/participant fields");
  check(beforeImageReport===JSON.stringify({forms:[...environment.forms],sheets:[...environment.sheets],props:[...environment.properties]}),"image diagnostic makes no changes");
  for (let n = 0; n < data.forms.length; n++) {
    const definition = data.forms[n]; const form = [...environment.forms.values()][n];
    check(!form.createdPublished && !form.isPublished() && !form.isAcceptingResponses(), "never published, closed " + n);
    check(!form.email && !form.quiz && !form.summary && !form.edits && !form.shuffle,"safe settings " + n);
    check(form.title.startsWith("[下書き・回答不可 / DRAFT CLOSED]") && form.description.includes("Not approved for recruitment"),"review and legal approval warnings " + n);
    check(form.items[0].help.includes("participant_id") && form.items[0].required,"participant draft ID " + n);
    check(form.items[0].validation.pattern === "^[A-Za-z]{4}[0-9]{2}$", "Web-compatible ID pattern " + n);
    check(!form.items.some(item => /^\[(store|condition)/.test(item.help)),"no respondent condition/store field " + n);
    for (const original of definition.items) {
      const item = form.items.find(item => item.help.startsWith("[" + original.id + "]"));
      check(item && item.title === original.title,"title " + original.id);
      if (original.type !== "notice") check(item.required === (original.optional !== true),"required " + original.id);
      if (original.choices) check(JSON.stringify(item.choices) === JSON.stringify(original.choices),"choices " + original.id);
      if (original.type === "multi") {
        const other = form.items.find(i => i.help === "[" + original.id + "_other]");
        check(other && !other.required && other.type === "number", "independent optional other details " + original.id);
      }
      if (original.type === "scale") check(JSON.stringify(item.bounds) === JSON.stringify([original.points[0],original.points.at(-1)]) && item.labels[0] === original.min && item.labels[1] === original.max,"scale " + original.id);
      if (original.image) check(form.items.some(i => i.type === "image" && i.help === "[" + original.id + ":image]" && i.image.type === "image/png"),"image " + original.id);
    }
  }
  environment.context.createLateSurveyDraftForms();
  check(environment.forms.size === 6 && environment.sheets.size === 1,"idempotent rerun");
  const registryKey = "BTS_FORMS_DRAFT_V1:pre_ja";
  const savedRegistry = environment.properties.get(registryKey);
  const changedRegistry = JSON.parse(savedRegistry);
  changedRegistry.formId = "unrelated-form";
  environment.properties.set(registryKey,JSON.stringify(changedRegistry));
  assert.throws(() => environment.context.createLateSurveyDraftForms(),/registry identity mismatch/); checks++;
  environment.properties.set(registryKey,savedRegistry);
  data.digest = "changed";
  assert.throws(() => environment.context.createLateSurveyDraftForms(),/digest differs/); checks++;
  check(!environment.locked && environment.forms.size === 6,"digest failure releases lock and creates nothing");
  data.digest = result.digest;
  const firstForm = [...environment.forms.values()][0];
  const firstChoice = firstForm.items.find(item => item.choices);
  const originalChoices = [...firstChoice.choices];
  firstChoice.choices = ["manual choice", ...originalChoices.slice(1)];
  assert.throws(() => environment.context.createLateSurveyDraftForms(),/item changed/); checks++;
  firstChoice.choices = originalChoices;
  firstChoice.required = false;
  assert.throws(() => environment.context.createLateSurveyDraftForms(),/item changed/); checks++;
  firstChoice.required = true;
  firstChoice.other = true;
  assert.throws(() => environment.context.createLateSurveyDraftForms(),/item changed/); checks++;
  firstChoice.other = false;
  const firstScale = firstForm.items.find(item => item.type === "scale");
  const originalBounds = [...firstScale.bounds];
  firstScale.bounds = [1, 5];
  assert.throws(() => environment.context.createLateSurveyDraftForms(),/item changed/); checks++;
  firstScale.bounds = originalBounds;
  const originalDestination = firstForm.destination[1];
  firstForm.destination[1] = "different-sheet";
  assert.throws(() => environment.context.createLateSurveyDraftForms(),/destination changed/); checks++;
  firstForm.destination[1] = originalDestination;
  environment.context.createLateSurveyDraftForms();
  check(environment.forms.size === 6 && environment.sheets.size === 1,"failed checks did not create or delete drafts");
  [...environment.forms.values()][0].items[1].title = "manual edit";
  assert.throws(() => environment.context.createLateSurveyDraftForms(),/item changed/); checks++;
  check(environment.forms.size === 6,"manual edits not overwritten");
  const partial = mock(source);
  partial.properties.set("BTS_FORMS_DRAFT_V1",JSON.stringify({digest:result.digest,forms:{pre_ja:"incomplete"}}));
  assert.throws(() => partial.context.createLateSurveyDraftForms(),/Interrupted draft/); checks++;
  check(partial.forms.size === 0,"interrupted runs never duplicate or delete drafts");
  function emptyInterruptedDraft() {
    const env = mock(source);
    const draftData = env.context.BTS_GOOGLE_FORMS_DRAFT_DATA_;
    const sheet = env.context.SpreadsheetApp.create("Existing private draft sheet");
    const expectedTitle = env.context.btsFormsTitle_(draftData.forms[0],draftData);
    const form = env.context.FormApp.create(expectedTitle,false).setTitle(expectedTitle);
    sheet.getSheets()[0].setName("Draft manifest").getRange(1,1,5,2).setValues(env.context.btsFormsManifestValues_(draftData));
    env.properties.set("BTS_FORMS_DRAFT_V1",JSON.stringify({ digest: draftData.digest, instrumentVersion: draftData.instrumentVersion, status: "creating", spreadsheetId: sheet.getId(), forms: { pre_ja: form.getId() } }));
    env.properties.set("BTS_FORMS_DRAFT_V1:pre_ja",JSON.stringify({ status: "building", formId: form.getId(), digest: draftData.digest }));
    return { env, form, sheet };
  }
  const empty = emptyInterruptedDraft();
  empty.env.properties.set("UNRELATED_SECRET", "must-not-appear");
  const beforeReport = JSON.stringify({ form: empty.form, sheets: [...empty.env.sheets], props: [...empty.env.properties] });
  const diagnostic = empty.env.context.reportLateSurveyDraftStatus();
  check(diagnostic.mode === "read_only" && diagnostic.forms[0].countItems === 0 && diagnostic.forms[0].countResponses === 0 && diagnostic.forms[0].actualTitle === diagnostic.forms[0].expectedTitle,"diagnostic reports exact empty draft predicates");
  check(!JSON.stringify(diagnostic).includes("must-not-appear") && !JSON.stringify(diagnostic).includes("UNRELATED_SECRET"),"diagnostic excludes unrelated Script Properties");
  check(beforeReport === JSON.stringify({ form: empty.form, sheets: [...empty.env.sheets], props: [...empty.env.properties] }),"diagnostic makes no form/sheet/registry changes");
  check(diagnostic.forms[0].destinationId === null && !diagnostic.forms[0].destinationIdError,"exact no-destination Google exception becomes empty destination");
  assert.throws(() => empty.env.context.createLateSurveyDraftForms(),/Interrupted draft/); checks++;
  check(empty.env.forms.size === 1 && empty.form.items.length === 0,"normal retry still refuses empty interrupted draft");
  const firstResumed = empty.env.context.resumeEmptyLateSurveyDraftForms();
  check(firstResumed.completedForms===1 && empty.env.forms.size===1,"empty resume also finishes only one form per run");
  const resumed = completeGeneration(empty.env);
  check(resumed.forms.find(row => row.key === "pre_ja").formId === empty.form.getId(),"explicit resume reuses exact existing form ID");
  check(empty.env.forms.size === 6 && empty.env.sheets.size === 1 && empty.form.items.length > 0,"resume creates only remaining forms, reuses sheet");
  check([...empty.env.forms.values()].every(form => !form.published && !form.accepting && !form.createdPublished),"resume never publishes or accepts responses");
  empty.env.context.createLateSurveyDraftForms();
  check(empty.env.forms.size === 6 && empty.env.sheets.size === 1,"resumed completed forms are idempotent");
  const unsafeChanges = [
    ["nonempty item", ({form}) => form.addTextItem()],
    ["existing response", ({form}) => { form.responses = [{}]; }],
    ["published", ({form}) => { form.published = true; }],
    ["accepting", ({form}) => { form.accepting = true; }],
    ["changed title", ({form}) => { form.title += " edited"; }],
    ["empty body title", ({form}) => { form.title = ""; }],
    ["destination", ({form}) => { form.destination = ["SPREADSHEET","other-sheet"]; }],
    ["record digest", ({env}) => { const key = "BTS_FORMS_DRAFT_V1:pre_ja"; const rec = JSON.parse(env.properties.get(key)); rec.digest = "different"; env.properties.set(key,JSON.stringify(rec)); }],
    ["record id", ({env}) => { const key = "BTS_FORMS_DRAFT_V1:pre_ja"; const rec = JSON.parse(env.properties.get(key)); rec.formId = "different"; env.properties.set(key,JSON.stringify(rec)); }]
  ];
  for (const [name,change] of unsafeChanges) {
    const unsafe = emptyInterruptedDraft(); change(unsafe);
    const before = JSON.stringify({ items: unsafe.form.items, published: unsafe.form.published, accepting: unsafe.form.accepting, title: unsafe.form.title, destination: unsafe.form.destination, props: [...unsafe.env.properties] });
    assert.throws(() => unsafe.env.context.resumeEmptyLateSurveyDraftForms(),/Empty draft resume refused/); checks++;
    check(before === JSON.stringify({ items: unsafe.form.items, published: unsafe.form.published, accepting: unsafe.form.accepting, title: unsafe.form.title, destination: unsafe.form.destination, props: [...unsafe.env.properties] }) && unsafe.env.forms.size === 1 && unsafe.env.sheets.size === 1 && !unsafe.env.locked,"resume refuses " + name + " without changes");
  }
  const freshResume = mock(source);
  assert.throws(() => freshResume.context.resumeEmptyLateSurveyDraftForms(),/no registered building draft/); checks++;
  check(freshResume.forms.size === 0 && freshResume.sheets.size === 0,"resume cannot create a fresh registry");
  const unexpectedDestinationError = emptyInterruptedDraft();
  unexpectedDestinationError.form.destinationError = "Permission denied while retrieving destination";
  const beforeDestinationError = JSON.stringify({ form: unexpectedDestinationError.form, props: [...unexpectedDestinationError.env.properties] });
  assert.throws(() => unexpectedDestinationError.env.context.resumeEmptyLateSurveyDraftForms(), /Permission denied/); checks++;
  check(beforeDestinationError === JSON.stringify({ form: unexpectedDestinationError.form, props: [...unexpectedDestinationError.env.properties] }) && unexpectedDestinationError.env.forms.size === 1,"unrecognized destination error is fatal without changes");
  unexpectedDestinationError.form.destinationError = "The form currently has no response destination. Unexpected suffix";
  assert.throws(() => unexpectedDestinationError.env.context.btsFormsDestinationId_(unexpectedDestinationError.form),/Unexpected suffix/); checks++;
  function olderEmptyDraft() {
    const fixture = emptyInterruptedDraft();
    const newData = fixture.env.context.BTS_GOOGLE_FORMS_DRAFT_DATA_;
    const oldDigest = "old-instrument-digest";
    const oldVersion = "old-instrument-version";
    const state = JSON.parse(fixture.env.properties.get("BTS_FORMS_DRAFT_V1"));
    state.digest = oldDigest; state.instrumentVersion = oldVersion;
    fixture.env.properties.set("BTS_FORMS_DRAFT_V1",JSON.stringify(state));
    fixture.env.properties.set("BTS_FORMS_DRAFT_V1:pre_ja",JSON.stringify({status:"building",formId:fixture.form.getId(),digest:oldDigest}));
    fixture.form.title = fixture.env.context.btsFormsTitle_(newData.forms[0],{instrumentVersion:oldVersion});
    fixture.sheet.getSheets()[0].values[1][1] = oldVersion;
    fixture.sheet.getSheets()[0].values[2][1] = oldDigest;
    return fixture;
  }
  const migration = olderEmptyDraft();
  assert.throws(() => migration.env.context.createLateSurveyDraftForms(),/digest differs/); checks++;
  assert.throws(() => migration.env.context.resumeEmptyLateSurveyDraftForms(),/digest differs/); checks++;
  const firstMigrated = migration.env.context.migrateEmptyLateSurveyDraftFormsToCurrentInstrument();
  check(firstMigrated.completedForms===1 && migration.env.forms.size===1,"migration also finishes only one form per run");
  const migrated = completeGeneration(migration.env);
  check(migrated.forms.find(row => row.key === "pre_ja").formId === migration.form.getId(),"migration preserves exact existing form ID");
  check(migration.env.forms.size === 6 && migration.env.sheets.size === 1,"migration preserves sheet, only creates remaining forms");
  check(migration.form.title.includes(data.instrumentVersion) && migrated.digest === data.digest,"migration applies current version and digest");
  const migratedState = JSON.parse(migration.env.properties.get("BTS_FORMS_DRAFT_V1"));
  check(migratedState.emptyDraftMigration.digest === "old-instrument-digest" && migratedState.digest === data.digest,"migration records previous digest");
  check(migration.sheet.getSheetByName("Draft manifest").values[2][1] === data.digest,"migration updates private manifest");
  check([...migration.env.forms.values()].every(form => !form.published && !form.accepting),"migrated forms remain unpublished and closed");
  for (const [name,change] of unsafeChanges.concat([
    ["completed record", ({env}) => { const key="BTS_FORMS_DRAFT_V1:pre_ja"; const row=JSON.parse(env.properties.get(key)); row.status="complete"; env.properties.set(key,JSON.stringify(row)); }],
    ["wrong manifest digest", ({sheet}) => { sheet.getSheets()[0].values[2][1] = "changed-manifest"; }],
    ["additional sheet", ({sheet}) => { sheet.insertSheet("Not an empty draft manifest"); }]
  ])) {
    const unsafe = olderEmptyDraft(); change(unsafe);
    const before=JSON.stringify({form:unsafe.form,props:[...unsafe.env.properties],sheets:unsafe.sheet.sheets});
    assert.throws(() => unsafe.env.context.migrateEmptyLateSurveyDraftFormsToCurrentInstrument(),/Empty draft (migration|resume) refused/); checks++;
    check(before===JSON.stringify({form:unsafe.form,props:[...unsafe.env.properties],sheets:unsafe.sheet.sheets}) && unsafe.env.forms.size===1 && unsafe.env.sheets.size===1 && !unsafe.env.locked,"migration refuses " + name + " without changes");
  }
  const freshMigration = mock(source);
  assert.throws(() => freshMigration.context.migrateEmptyLateSurveyDraftFormsToCurrentInstrument(),/Empty draft migration refused/); checks++;
  check(freshMigration.forms.size===0 && freshMigration.sheets.size===0,"migration cannot create a fresh registry");
  const titleRepair = olderEmptyDraft();
  titleRepair.form.title = "";
  const repairProperties = JSON.stringify([...titleRepair.env.properties]);
  const repairSheets = JSON.stringify([...titleRepair.env.sheets]);
  const titleResult = titleRepair.env.context.repairEmptyLateSurveyDraftTitles();
  check(titleResult.status === "empty_draft_titles_repaired" && titleResult.forms[0].formId === titleRepair.form.getId() && titleRepair.form.title === titleResult.forms[0].title && titleRepair.form.title.includes("old-instrument-version"),"title repair sets and reads back exact old-version title on same ID");
  check(titleRepair.env.forms.size===1 && titleRepair.form.items.length===0 && !titleRepair.form.published && !titleRepair.form.accepting && repairProperties===JSON.stringify([...titleRepair.env.properties]) && repairSheets===JSON.stringify([...titleRepair.env.sheets]),"title repair only changes title, not registry/sheets/questions/closure");
  titleRepair.env.context.repairEmptyLateSurveyDraftTitles();
  check(titleRepair.env.forms.size===1 && titleRepair.env.sheets.size===1,"title repair permits matching title without duplication");
  for (const [name,change] of unsafeChanges.filter(([name]) => name !== "empty body title")) {
    const unsafe = olderEmptyDraft(); change(unsafe);
    const before=JSON.stringify({form:unsafe.form,props:[...unsafe.env.properties],sheets:unsafe.sheet.sheets});
    assert.throws(() => unsafe.env.context.repairEmptyLateSurveyDraftTitles(),/Empty draft title repair refused/); checks++;
    check(before===JSON.stringify({form:unsafe.form,props:[...unsafe.env.properties],sheets:unsafe.sheet.sheets}) && unsafe.env.forms.size===1 && unsafe.env.sheets.size===1 && !unsafe.env.locked,"title repair refuses " + name + " before mutation");
  }
  const unreadableTitleRepair = olderEmptyDraft();
  unreadableTitleRepair.form.title = "";
  unreadableTitleRepair.form.setTitle = function () { return this; };
  assert.throws(() => unreadableTitleRepair.env.context.repairEmptyLateSurveyDraftTitles(),/title repair verification failed/); checks++;
  check(!unreadableTitleRepair.env.locked && unreadableTitleRepair.env.forms.size===1,"title repair requires successful readback and releases lock");
  const freshTitleRepair = mock(source);
  assert.throws(() => freshTitleRepair.context.repairEmptyLateSurveyDraftTitles(),/title repair refused/); checks++;
  check(freshTitleRepair.forms.size===0 && freshTitleRepair.sheets.size===0,"title repair cannot create missing forms or sheets");
  function partialFollowup(prefixLength=4) {
    const env=mock(source); completeGeneration(env);
    const definition=env.context.BTS_GOOGLE_FORMS_DRAFT_DATA_.forms[5];
    const form=[...env.forms.values()][5]; const sheet=[...env.sheets.values()][0];
    const plan=env.context.btsFormsExpectedItems_(definition,env.context.BTS_GOOGLE_FORMS_DRAFT_DATA_);
    form.items=form.items.slice(0,prefixLength); form.destination=null;
    sheet.sheets=sheet.sheets.filter(row => row.name!=="Map followup_en");
    const state=JSON.parse(env.properties.get("BTS_FORMS_DRAFT_V1")); state.status="creating";
    env.properties.set("BTS_FORMS_DRAFT_V1",JSON.stringify(state));
    env.properties.set("BTS_FORMS_DRAFT_V1:followup_en",JSON.stringify({status:"building",formId:form.getId(),digest:state.digest}));
    return {env,form,sheet,plan};
  }
  const partialFollowupFixture=partialFollowup();
  const prefixIds=partialFollowupFixture.form.items.map(item=>item.getId());
  partialFollowupFixture.form.items[0].validation.pattern="old-unreadable-validator";
  const untouchedForms=JSON.stringify([...partialFollowupFixture.env.forms.values()].slice(0,5));
  assert.throws(()=>partialFollowupFixture.env.context.createLateSurveyDraftForms(),/Interrupted draft/); checks++;
  const partialResult=partialFollowupFixture.env.context.resumePartialLateSurveyDraftForms();
  check(partialResult.status==="drafts_closed_unpublished" && partialResult.completedForms===6 && partialResult.formId===partialFollowupFixture.form.getId(),"explicit partial resume finishes same last form");
  check(JSON.stringify(prefixIds)===JSON.stringify(partialFollowupFixture.form.items.slice(0,4).map(item=>item.getId())) && partialFollowupFixture.env.forms.size===6 && partialFollowupFixture.env.sheets.size===1,"partial resume preserves existing IDs and creates no duplicate form/sheet");
  check(partialFollowupFixture.form.items[0].validation.pattern==="^[A-Za-z]{4}[0-9]{2}$","partial resume reapplies same source text validator");
  check(untouchedForms===JSON.stringify([...partialFollowupFixture.env.forms.values()].slice(0,5)),"partial resume does not modify completed forms");
  check(partialFollowupFixture.sheet.getSheetByName("Map followup_en").values.length>1 && !partialFollowupFixture.form.published && !partialFollowupFixture.form.accepting,"partial resume rebuilds mapping and stays unpublished/closed");
  partialFollowupFixture.env.context.createLateSurveyDraftForms();
  check(partialFollowupFixture.env.forms.size===6,"completed partial resume remains idempotent");
  const exportedPartial=partialFollowup();
  const originalByteHash=exportedPartial.env.context.btsFormsImageByteSha_;
  exportedPartial.env.context.btsFormsImageByteSha_=function(image){
    const sourceHash=originalByteHash(image);
    const reviewed=exportedPartial.env.context.BTS_GOOGLE_FORMS_IMAGE_EXPORT_QA_.exports.find(entry=>entry.sourcePngSha256===sourceHash);
    return reviewed ? reviewed.googleByteSha256 : sourceHash;
  };
  const exportedPrefixIds=exportedPartial.form.items.map(item=>item.getId());
  const exportResume=exportedPartial.env.context.resumePartialLateSurveyDraftForms();
  check(exportResume.status==="drafts_closed_unpublished" && JSON.stringify(exportedPrefixIds)===JSON.stringify(exportedPartial.form.items.slice(0,exportedPrefixIds.length).map(item=>item.getId())),"known Google export pairs allow both existing and newly added followup images while preserving prefix IDs");
  const partialFailures=[
    ["unfinished tail", ({form})=>{const last=form.items.at(-1);last.title="";last.help="";last.required=false;}],
    ["changed choices", ({form})=>{form.items.at(-1).choices[0]="changed";}],
    ["changed required", ({form})=>{form.items.at(-1).required=false;}],
    ["changed image", ({form})=>{form.items[2].image.bytes=Buffer.from("changed image");}],
    ["changed image width", ({form})=>{form.items[2].width=400;}],
    ["changed title", ({form})=>{form.title+=" changed";}],
    ["changed settings", ({form})=>{form.email=true;}],
    ["navigation", ({form})=>{form.items.at(-1).navigation="SUBMIT";}],
    ["response exists", ({form})=>{form.responses=[{}];}],
    ["published", ({form})=>{form.published=true;}],
    ["wrong destination", ({form})=>{form.destination=["SPREADSHEET","other"];}],
    ["changed manifest", ({sheet})=>{sheet.getSheetByName("Draft manifest").values[2][1]="changed";}],
    ["unexpected map", ({sheet})=>{sheet.insertSheet("Map followup_en").values=[["manual map"]];}]
  ];
  for(const [name,change] of partialFailures){
    const unsafe=partialFollowup();change(unsafe);
    const before=JSON.stringify({forms:[...unsafe.env.forms],sheets:[...unsafe.env.sheets],props:[...unsafe.env.properties]});
    assert.throws(()=>unsafe.env.context.resumePartialLateSurveyDraftForms(),/Partial draft refused/,name);checks++;
    check(before===JSON.stringify({forms:[...unsafe.env.forms],sheets:[...unsafe.env.sheets],props:[...unsafe.env.properties]})&&!unsafe.env.locked,"partial resume refuses "+name+" before changes");
  }
  const fullButBuilding=partialFollowup(999);
  const allExistingIds=fullButBuilding.form.items.map(item=>item.getId());
  fullButBuilding.env.context.resumePartialLateSurveyDraftForms();
  check(JSON.stringify(allExistingIds)===JSON.stringify(fullButBuilding.form.items.map(item=>item.getId())),"full building form finalizes without appending any item");
  const extraItem=partialFollowup(999);extraItem.form.addTextItem();
  assert.throws(()=>extraItem.env.context.resumePartialLateSurveyDraftForms(),/unexpected extra items/);checks++;
  const changedScale=partialFollowup(999);changedScale.form.items.find(item=>item.type==="scale").bounds=[1,9];
  assert.throws(()=>changedScale.env.context.resumePartialLateSurveyDraftForms(),/Partial draft refused/);checks++;
  // Deterministic generation uses the same PNG bytes; no external service or answer-key copying.
  const bytesBySource = new Map(Object.entries(data.images).map(([p,a]) => [fs.readFileSync(path.join(root,p)).toString("base64"),Buffer.from(a.base64,"base64")]));
  const regenerated = await instrument(root,async svg => bytesBySource.get(svg.toString("base64")));
  check(sourceFor(regenerated) === source,"generated Forms.gs current and deterministic");
  console.log("Google Forms draft tests: " + checks + " assertions passed.");
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
