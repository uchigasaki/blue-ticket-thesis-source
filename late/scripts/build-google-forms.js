"use strict";

// Build-only generator. No Google requests are made here.
const fs = require("node:fs");
const path = require("node:path");
const { loadExperiment, canonicalJson, sha256, safeFile } = require("./release-lib");
const PHASES = ["pre", "post", "followup"];
const LANGUAGES = ["ja", "en"];
const ALLOWED_TYPES = ["single", "multi", "scale", "number", "text", "notice"];

function resolveSharp() {
  try { return require("sharp"); }
  catch (_) { return require(path.resolve(path.dirname(process.execPath), "../node_modules/sharp")); }
}

async function instrument(root, rasterize) {
  const context = loadExperiment(root);
  const structural = context.EXPERIMENT_CONTEXT.getReadinessReport({ production: false });
  if (structural.errors.length) throw new Error(structural.errors.join("\n"));
  const images = {};
  const forms = [];
  for (const phase of PHASES) for (const language of LANGUAGES) {
    const baseline = phase === "pre" ? context.APP_DATA.survey[language] : phase === "post" ? context.APP_DATA.postSurvey[language] : [];
    const items = JSON.parse(JSON.stringify(context.EXPERIMENT_CONTEXT.mergeSurveyItems(baseline, phase, { language })));
    for (const item of items) {
      if (!ALLOWED_TYPES.includes(item.type)) throw new Error("Unsupported Forms type: " + item.type);
      if (item.type === "scale") {
        const points = item.points || [1, 2, 3, 4];
        if (![0, 1].includes(points[0]) || points.at(-1) < 3 || points.at(-1) > 10 || points.some((n, i) => n !== points[0] + i)) throw new Error("Google Forms requires a contiguous 0/1 to 3–10 scale: " + item.id);
      }
      if (item.image) {
        const relative = item.image.replace(/^\.\//, "");
        if (!/^assets\/late-[a-z0-9-]+\.(?:svg|png)$/.test(relative)) throw new Error("Unexpected Forms image: " + relative);
        if (!images[relative]) {
          const source = fs.readFileSync(safeFile(root, relative));
          const png = relative.endsWith(".png") ? source : await rasterize(source);
          if (!Buffer.isBuffer(png) || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Rasterizer did not return PNG");
          images[relative] = { mimeType: "image/png", sourceSha256: sha256(source), sha256: sha256(png), base64: png.toString("base64") };
        }
      }
    }
    forms.push({ phase, language, items });
  }
  // Intentionally omit answerKeys: no grading rules are installed in Forms.
  const data = { schemaVersion: 1, draftFormatVersion: 2, instrumentVersion: context.EVALUATION_DATA.instrumentVersion, experimentId: context.EXPERIMENT_CONFIG.experimentId, contentStatus: context.EVALUATION_DATA.contentStatus, contentReviewIssues: context.EVALUATION_DATA.contentReviewIssues || [], forms, images };
  data.digest = sha256(canonicalJson(data));
  return data;
}

// This function's source is embedded in Forms.gs, keeping generated output reproducible.
function googleFormsRuntime() {
  // Runtime-only rendering QA evidence. This is not content/research adoption approval and does not change the instrument digest.
  var BTS_GOOGLE_FORMS_IMAGE_EXPORT_QA_ = {
    scope: "Rendering QA only; not research adoption approval / 描画QAのみ・研究採用承認ではない",
    visualComparedAt: "2026-09-24", observedAt: "2026-09-25",
    exports: [
      { sourceId: "late_followup_transfer_stop:image", sourcePngSha256: "4ed61bef24e7bb7b2dbee7c9243f1491c6fdb2f821d0312ca07c349d3ee86865", googleByteSha256: "01128047f9bd1b60f59f9fdc54edfb685a3628249766e1ab4f526a4e6efc8803", width: 640 },
      { sourceId: "late_followup_transfer_pedestrian:image", sourcePngSha256: "4831708adb0c644c6b40be9a9bf92e07af50ae9567bf6da585aa2377ef30b04f", googleByteSha256: "07cae90060223999cbd2cef3c7b64179cfcfa83a6a1a01aed104aaa343bdd3a5", width: 640 }
    ]
  };
  function btsFormsIsKnownImageExport_(spec, googleByteSha256, width) {
    if (width !== 640 || !spec || !spec.asset) return false;
    if (googleByteSha256 === spec.asset.sha256) return true;
    return BTS_GOOGLE_FORMS_IMAGE_EXPORT_QA_.exports.some(function (entry) {
      return entry.sourceId === spec.sourceId && entry.sourcePngSha256 === spec.asset.sha256 &&
        entry.googleByteSha256 === googleByteSha256 && entry.width === width;
    });
  }
  function btsFormsSignature_(form) {
    var snapshot = form.getItems().map(function (item) {
      var type = String(item.getType());
      var row = { id: String(item.getId()), type: type, title: item.getTitle(), help: item.getHelpText() };
      var typed;
      if (type === "MULTIPLE_CHOICE" || type === "CHECKBOX") {
        typed = type === "MULTIPLE_CHOICE" ? item.asMultipleChoiceItem() : item.asCheckboxItem();
        row.choices = typed.getChoices().map(function (choice) { return choice.getValue(); });
        row.other = typed.hasOtherOption();
      } else if (type === "SCALE") {
        typed = item.asScaleItem();
        row.bounds = [typed.getLowerBound(), typed.getUpperBound()];
        row.labels = [typed.getLeftLabel(), typed.getRightLabel()];
      } else if (type === "TEXT") typed = item.asTextItem();
      else if (type === "PARAGRAPH_TEXT") typed = item.asParagraphTextItem();
      if (typed) row.required = typed.isRequired();
      return row;
    });
    return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(snapshot), Utilities.Charset.UTF_8));
  }
  function btsFormsClose_(form) {
    if (!form.supportsAdvancedResponderPermissions()) throw new Error("Cannot verify unpublished Forms state; keep this draft closed and inspect manually.");
    if (form.isPublished()) form.setPublished(false);
    form.setAcceptingResponses(false);
    if (form.isPublished() || form.isAcceptingResponses()) throw new Error("Draft closure verification failed.");
  }
  function btsFormsAdd_(form, source, data) {
    var imageId = null;
    if (source.image) {
      var asset = data.images[source.image.replace(/^\.\//, "")];
      var image = form.addImageItem().setTitle(source.imageAlt || source.title).setHelpText("[" + source.id + ":image]")
        .setImage(Utilities.newBlob(Utilities.base64Decode(asset.base64), asset.mimeType, source.id + ".png")).setWidth(640);
      imageId = String(image.getId());
    }
    var item;
    if (source.type === "single") item = form.addMultipleChoiceItem().setChoiceValues(source.choices);
    else if (source.type === "multi") item = form.addCheckboxItem().setChoiceValues(source.choices);
    else if (source.type === "scale") {
      var points = source.points || [1, 2, 3, 4];
      item = form.addScaleItem().setBounds(points[0], points[points.length - 1]).setLabels(String(source.min || ""), String(source.max || ""));
    } else if (source.type === "number") {
      item = form.addTextItem();
      var validation = FormApp.createTextValidation().requireNumberBetween(source.min, source.max).setHelpText(String(source.min) + "–" + String(source.max)).build();
      item.setValidation(validation);
    } else if (source.type === "text") item = form.addParagraphTextItem();
    else if (source.type === "notice") item = form.addSectionHeaderItem();
    else throw new Error("Unsupported question type: " + source.type);
    item.setTitle(source.title).setHelpText("[" + source.id + "]" + (source.placeholder ? " " + source.placeholder : ""));
    if (source.type !== "notice") item.setRequired(source.optional !== true);
    return { sourceId: source.id, type: source.type, itemId: String(item.getId()), imageItemId: imageId, title: source.title };
  }
  function btsFormsVerify_(form, record, spreadsheetId) {
    btsFormsClose_(form);
    if (form.collectsEmail() || form.isQuiz() || form.isPublishingSummary()) throw new Error("Unsafe manual settings detected in draft " + record.formId);
    if (btsFormsDestinationId_(form) !== spreadsheetId) throw new Error("Draft response destination changed; no edits made: " + record.formId);
    if (btsFormsSignature_(form) !== record.itemsSignature) throw new Error("Draft item changed; no edits made: " + record.formId);
  }
  function btsFormsTitle_(definition, data) {
    var phaseNames = { pre: "事前 / Pre", post: "事後 / Post", followup: "1週間後 / Follow-up" };
    return "[下書き・回答不可 / DRAFT CLOSED] BTS " + phaseNames[definition.phase] + " " + definition.language + " " + data.instrumentVersion;
  }
  function btsFormsDescription_(data) {
    return "研究確認専用・回答しないでください。法令前提を含む教材内容と日英・時点間の等価性を研究者が確認してください。採用・公開の承認は未取得です。\nREVIEW ONLY. Do not answer. Researcher review of legal assumptions, content and instrument equivalence is required. Not approved for recruitment.\n" + data.instrumentVersion + " / " + data.digest;
  }
  function btsFormsConfirmation_() {
    return "下書きです。本研究の完了を示すものではありません。 / Draft only; not a study completion receipt.";
  }
  function btsFormsDestinationId_(form) {
    try { return form.getDestinationId(); }
    catch (error) {
      // Observed Google FormApp behavior for a genuinely unset destination. All other failures remain fatal.
      if (error && error.message === "The form currently has no response destination.") return null;
      throw error;
    }
  }
  function btsFormsManifestValues_(data) {
    return [
      ["Status", "REVIEW ONLY — unpublished / 研究確認専用・未公開"], ["Instrument", data.instrumentVersion], ["Digest", data.digest],
      ["Purpose", "Separate draft response destination; no production integration"], ["Blocking issues", data.contentReviewIssues.filter(function (x) { return x.status !== "resolved" && (x.severity === "blocking" || x.blocking === true); }).map(function (x) { return x.id; }).join(", ")]
    ];
  }
  function btsFormsEmptyResume_(key, record, state, data) {
    var definition = data.forms.filter(function (entry) { return entry.phase + "_" + entry.language === key; })[0];
    if (!definition || !record || record.status !== "building" || record.digest !== data.digest || record.formId !== state.forms[key] || !state.spreadsheetId) {
      throw new Error("Empty draft resume refused: invalid registry " + key);
    }
    var form = FormApp.openById(record.formId);
    // Check without mutation. A partial questionnaire, response, destination or changed title requires manual inspection.
    if (!form.supportsAdvancedResponderPermissions() || form.isPublished() || form.isAcceptingResponses() ||
        form.getItems().length !== 0 || form.getResponses().length !== 0 ||
        form.getTitle() !== btsFormsTitle_(definition, data) || btsFormsDestinationId_(form)) {
      throw new Error("Empty draft resume refused: form is not the unchanged, closed, unpublished, empty draft " + key + " (" + record.formId + ")");
    }
    return form;
  }
  function createLateSurveyDraftForms() {
    return btsFormsBuild_(false);
  }
  function resumeEmptyLateSurveyDraftForms() {
    return btsFormsBuild_(true);
  }
  function migrateEmptyLateSurveyDraftFormsToCurrentInstrument() {
    return btsFormsBuild_(true, true);
  }
  function btsFormsExpectedItems_(definition, data) {
    var ja = definition.language === "ja";
    var plan = [{ sourceId: "participant_id", sourceType: "text", type: "TEXT", title: ja ? "研究用参加者ID（下書き確認用）" : "Study participant ID (draft review only)",
      help: "[participant_id] " + (ja ? "氏名・メールアドレスを書かないでください。所属店舗・条件はここでは選択しません。" : "Do not enter your name or email. Store and condition are not selected here."), required: true,
      pattern: "^[A-Za-z]{4}[0-9]{2}$", validationHelp: "4 letters + 2 digits, e.g. ABCD12 / 英字4文字＋数字2桁" }];
    var types = { single: "MULTIPLE_CHOICE", multi: "CHECKBOX", scale: "SCALE", number: "TEXT", text: "PARAGRAPH_TEXT", notice: "SECTION_HEADER" };
    definition.items.forEach(function (source) {
      if (source.image) plan.push({ sourceId: source.id + ":image", imageFor: source.id, type: "IMAGE", title: source.imageAlt || source.title, help: "[" + source.id + ":image]", asset: data.images[source.image.replace(/^\.\//, "")] });
      var spec = { sourceId: source.id, sourceType: source.type, type: types[source.type], title: source.title,
        help: "[" + source.id + "]" + (source.placeholder ? " " + source.placeholder : ""), required: source.optional !== true };
      if (source.choices) spec.choices = source.choices;
      if (source.type === "scale") { var points = source.points || [1, 2, 3, 4]; spec.bounds = [points[0], points[points.length - 1]]; spec.labels = [String(source.min || ""), String(source.max || "")]; }
      if (source.type === "number") { spec.range = [source.min, source.max]; spec.validationHelp = String(source.min) + "–" + String(source.max); }
      plan.push(spec);
      if (source.type === "multi") plan.push({ sourceId: source.id + "_other", sourceType: "other_text", type: "TEXT", title: source.title + (ja ? " — その他の内容（任意）" : " — Other details (optional)"), help: "[" + source.id + "_other]", required: false });
    });
    return plan;
  }
  function btsFormsRestoreValidation_(item, spec, typed) {
    if (!spec.pattern && !spec.range) return;
    var builder = FormApp.createTextValidation();
    if (spec.pattern) builder.requireTextMatchesPattern(spec.pattern);
    else builder.requireNumberBetween(spec.range[0], spec.range[1]);
    (typed ? item : item.asTextItem()).setValidation(builder.setHelpText(spec.validationHelp).build());
  }
  function btsFormsCheckPrefix_(form, plan) {
    var items = form.getItems();
    if (items.length > plan.length) throw new Error("Partial draft refused: unexpected extra items.");
    items.forEach(function (item, index) {
      var spec = plan[index]; var typed; var ok = String(item.getType()) === spec.type && item.getTitle() === spec.title && item.getHelpText() === spec.help;
      if (!ok) throw new Error("Partial draft refused: item mismatch or unfinished item at " + index + " (" + spec.sourceId + ")");
      if (spec.type === "MULTIPLE_CHOICE" || spec.type === "CHECKBOX") {
        typed = spec.type === "MULTIPLE_CHOICE" ? item.asMultipleChoiceItem() : item.asCheckboxItem();
        var choices = typed.getChoices();
        ok = !typed.hasOtherOption() && JSON.stringify(choices.map(function (choice) { return choice.getValue(); })) === JSON.stringify(spec.choices) &&
          choices.every(function (choice) { return choice.getPageNavigationType() === null && choice.getGotoPage() === null; });
      } else if (spec.type === "SCALE") {
        typed = item.asScaleItem();
        ok = typed.getLowerBound() === spec.bounds[0] && typed.getUpperBound() === spec.bounds[1] && typed.getLeftLabel() === spec.labels[0] && typed.getRightLabel() === spec.labels[1];
      } else if (spec.type === "TEXT") typed = item.asTextItem();
      else if (spec.type === "PARAGRAPH_TEXT") typed = item.asParagraphTextItem();
      else if (spec.type === "IMAGE") {
        var image = item.asImageItem();
        var hash = btsFormsImageByteSha_(image);
        ok = btsFormsIsKnownImageExport_(spec, hash, image.getWidth());
        if (!ok) throw new Error("Partial draft refused: image mismatch " + spec.sourceId + " expected=" + spec.asset.sha256 + " actual=" + hash + " width=" + image.getWidth());
      }
      if (typed && typed.isRequired() !== spec.required) ok = false;
      if (!ok) throw new Error("Partial draft refused: item settings/image mismatch or unfinished item at " + index + " (" + spec.sourceId + ")");
    });
    return items;
  }
  function btsFormsImageByteSha_(image) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, image.getImage().getBytes()).map(function (b) { return ("0" + ((b + 256) % 256).toString(16)).slice(-2); }).join("");
  }
  function reportLateSurveyDraftImageExports() {
    var data = BTS_GOOGLE_FORMS_DRAFT_DATA_; var rootKey = "BTS_FORMS_DRAFT_V1";
    var props = PropertiesService.getScriptProperties(); var state = JSON.parse(props.getProperty(rootKey) || "null");
    if (!state || state.digest !== data.digest || state.instrumentVersion !== data.instrumentVersion) throw new Error("Image export report refused: registry/version mismatch.");
    var report = { mode: "read_only_image_exports", instrumentVersion: data.instrumentVersion, digest: data.digest, forms: [] };
    Object.keys(state.forms).forEach(function (key) {
      var record = JSON.parse(props.getProperty(rootKey + ":" + key) || "null");
      var definition = data.forms.filter(function (entry) { return entry.phase + "_" + entry.language === key; })[0];
      if (!definition || !record || record.formId !== state.forms[key] || record.digest !== state.digest || ["complete", "building"].indexOf(record.status) < 0) throw new Error("Image export report refused: invalid record " + key);
      var plan = btsFormsExpectedItems_(definition, data); var images = [];
      FormApp.openById(record.formId).getItems().forEach(function (item, index) {
        if (String(item.getType()) !== "IMAGE") return;
        var spec = plan.filter(function (entry) { return entry.type === "IMAGE" && entry.help === item.getHelpText(); })[0];
        var row = { itemIndex: index, itemId: String(item.getId()), sourceId: spec ? spec.sourceId : null, sourcePngSha256: spec ? spec.asset.sha256 : null };
        try { var image = item.asImageItem(); row.width = image.getWidth(); row.googleByteSha256 = btsFormsImageByteSha_(image); }
        catch (error) { row.readError = String(error.message || error); }
        images.push(row);
      });
      report.forms.push({ key: key, formId: record.formId, images: images });
    });
    Logger.log(JSON.stringify(report, null, 2)); return report;
  }
  function btsFormsAppendExpected_(form, spec) {
    var methods = { TEXT: "addTextItem", PARAGRAPH_TEXT: "addParagraphTextItem", MULTIPLE_CHOICE: "addMultipleChoiceItem", CHECKBOX: "addCheckboxItem", SCALE: "addScaleItem", SECTION_HEADER: "addSectionHeaderItem", IMAGE: "addImageItem" };
    var item = form[methods[spec.type]]();
    if (spec.choices) item.setChoiceValues(spec.choices);
    if (spec.bounds) item.setBounds(spec.bounds[0], spec.bounds[1]).setLabels(spec.labels[0], spec.labels[1]);
    item.setTitle(spec.title).setHelpText(spec.help);
    if (spec.type === "IMAGE") item.setImage(Utilities.newBlob(Utilities.base64Decode(spec.asset.base64), spec.asset.mimeType, spec.sourceId + ".png")).setWidth(640);
    else if (spec.type !== "SECTION_HEADER") item.setRequired(spec.required);
    btsFormsRestoreValidation_(item, spec, true);
    return item;
  }
  function btsFormsMapRows_(items, plan, digest) {
    var images = {};
    plan.forEach(function (spec, index) { if (spec.imageFor) images[spec.imageFor] = String(items[index].getId()); });
    var rows = [["source_id", "source_type", "form_item_id", "image_item_id", "title", "instrument_digest"]];
    plan.forEach(function (spec, index) { if (spec.type !== "IMAGE") rows.push([spec.sourceId, spec.sourceType, String(items[index].getId()), images[spec.sourceId] || "", spec.title, digest]); });
    return rows;
  }
  function resumePartialLateSurveyDraftForms() {
    var data = BTS_GOOGLE_FORMS_DRAFT_DATA_; var rootKey = "BTS_FORMS_DRAFT_V1";
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      var props = PropertiesService.getScriptProperties(); var state = JSON.parse(props.getProperty(rootKey) || "null");
      if (!state || state.status !== "creating" || state.digest !== data.digest || state.instrumentVersion !== data.instrumentVersion || !state.spreadsheetId) throw new Error("Partial draft refused: registry/version mismatch.");
      var destination = SpreadsheetApp.openById(state.spreadsheetId); var manifest = destination.getSheetByName("Draft manifest");
      if (!manifest || JSON.stringify(manifest.getRange(1, 1, 5, 2).getValues()) !== JSON.stringify(btsFormsManifestValues_(data))) throw new Error("Partial draft refused: manifest mismatch.");
      var candidates = []; var records = {};
      Object.keys(state.forms).forEach(function (key) {
        var record = JSON.parse(props.getProperty(rootKey + ":" + key) || "null");
        var definition = data.forms.filter(function (row) { return row.phase + "_" + row.language === key; })[0];
        if (!definition || !record || record.formId !== state.forms[key] || record.digest !== data.digest || ["complete", "building"].indexOf(record.status) < 0) throw new Error("Partial draft refused: invalid record " + key);
        var form = FormApp.openById(record.formId); var target = btsFormsDestinationId_(form);
        if (!form.supportsAdvancedResponderPermissions() || form.isPublished() || form.isAcceptingResponses() || form.getResponses().length !== 0 || form.getTitle() !== btsFormsTitle_(definition, data) ||
            form.collectsEmail() || form.isQuiz() || form.isPublishingSummary() || form.canEditResponse() || form.hasRespondAgainLink() || form.hasLimitOneResponsePerUser() || form.getShuffleQuestions() || !form.hasProgressBar() ||
            form.getDescription() !== btsFormsDescription_(data) || form.getConfirmationMessage() !== btsFormsConfirmation_() ||
            (target && target !== state.spreadsheetId)) throw new Error("Partial draft refused: changed safety/settings/destination " + key);
        if (record.status === "complete") {
          if (target !== state.spreadsheetId || btsFormsSignature_(form) !== record.itemsSignature) throw new Error("Partial draft refused: changed completed draft " + key);
          records[key] = record; return;
        }
        var plan = btsFormsExpectedItems_(definition, data); var items = btsFormsCheckPrefix_(form, plan);
        if (!items.length) throw new Error("Partial draft refused: use explicit empty-draft resume for " + key);
        var mappingSheet = destination.getSheetByName("Map " + key);
        if (mappingSheet && mappingSheet.getLastRow() > 0 && (items.length !== plan.length || mappingSheet.getLastRow() !== btsFormsMapRows_(items, plan, data.digest).length || mappingSheet.getLastColumn() !== 6 || JSON.stringify(mappingSheet.getRange(1, 1, mappingSheet.getLastRow(), 6).getValues()) !== JSON.stringify(btsFormsMapRows_(items, plan, data.digest)))) throw new Error("Partial draft refused: existing mapping mismatch " + key);
        candidates.push({ key: key, definition: definition, form: form, plan: plan, items: items, mappingSheet: mappingSheet });
      });
      if (!candidates.length) throw new Error("Partial draft refused: no registered building form.");
      // All existing drafts were checked before any write. Finish at most one existing form per explicit run.
      var current = candidates[0];
      current.items.forEach(function (item, index) { btsFormsRestoreValidation_(item, current.plan[index]); });
      for (var index = current.items.length; index < current.plan.length; index++) btsFormsAppendExpected_(current.form, current.plan[index]);
      var finalItems = btsFormsCheckPrefix_(current.form, current.plan);
      if (!btsFormsDestinationId_(current.form)) current.form.setDestination(FormApp.DestinationType.SPREADSHEET, state.spreadsheetId);
      if (current.form.isPublished() || current.form.isAcceptingResponses() || current.form.getResponses().length !== 0) throw new Error("Partial draft refused: final closure/response check failed.");
      var rows = btsFormsMapRows_(finalItems, current.plan, data.digest);
      var mapping = current.mappingSheet || destination.insertSheet("Map " + current.key);
      if (mapping.getLastRow() === 0) mapping.getRange(1, 1, rows.length, 6).setValues(rows);
      var completed = { status: "complete", formId: current.form.getId(), digest: data.digest, phase: current.definition.phase, language: current.definition.language, editUrl: current.form.getEditUrl(), itemsSignature: btsFormsSignature_(current.form) };
      props.setProperty(rootKey + ":" + current.key, JSON.stringify(completed)); records[current.key] = completed;
      state.status = Object.keys(records).length === data.forms.length ? "complete" : "creating"; props.setProperty(rootKey, JSON.stringify(state));
      var result = { status: state.status === "complete" ? "drafts_closed_unpublished" : "drafts_partially_complete_closed_unpublished", resumedKey: current.key, formId: current.form.getId(), digest: data.digest, completedForms: Object.keys(records).length, expectedForms: data.forms.length };
      Logger.log(JSON.stringify(result, null, 2)); return result;
    } finally { lock.releaseLock(); }
  }
  function repairEmptyLateSurveyDraftTitles() {
    var data = BTS_GOOGLE_FORMS_DRAFT_DATA_;
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var props = PropertiesService.getScriptProperties();
      var rootKey = "BTS_FORMS_DRAFT_V1";
      var saved = props.getProperty(rootKey);
      var state = saved ? JSON.parse(saved) : null;
      if (!state || state.status !== "creating" || !state.instrumentVersion || !state.digest || !state.spreadsheetId || !Object.keys(state.forms || {}).length) {
        throw new Error("Empty draft title repair refused: expected a registered interrupted draft.");
      }
      var verified = Object.keys(state.forms).map(function (key) {
        var record = JSON.parse(props.getProperty(rootKey + ":" + key) || "null");
        var definition = data.forms.filter(function (entry) { return entry.phase + "_" + entry.language === key; })[0];
        if (!definition || !record || record.status !== "building" || record.digest !== state.digest || record.formId !== state.forms[key]) {
          throw new Error("Empty draft title repair refused: invalid registry " + key);
        }
        var expectedTitle = btsFormsTitle_(definition, { instrumentVersion: state.instrumentVersion });
        var form = FormApp.openById(record.formId);
        var actualTitle = form.getTitle();
        if (!form.supportsAdvancedResponderPermissions() || form.isPublished() || form.isAcceptingResponses() ||
            form.getItems().length !== 0 || form.getResponses().length !== 0 || btsFormsDestinationId_(form) ||
            (actualTitle !== "" && actualTitle !== expectedTitle)) {
          throw new Error("Empty draft title repair refused: unsafe or changed draft " + key + " (" + record.formId + ")");
        }
        return { key: key, form: form, expectedTitle: expectedTitle };
      });
      // Title-only operation, after every registered form passes. Never migrate, add questions, or write Properties/Sheets here.
      var repaired = verified.map(function (entry) {
        entry.form.setTitle(entry.expectedTitle);
        if (entry.form.getTitle() !== entry.expectedTitle || entry.form.isPublished() || entry.form.isAcceptingResponses()) {
          throw new Error("Empty draft title repair verification failed: " + entry.key + " (" + entry.form.getId() + ")");
        }
        return { key: entry.key, formId: entry.form.getId(), title: entry.expectedTitle };
      });
      var result = { status: "empty_draft_titles_repaired", instrumentVersion: state.instrumentVersion, digest: state.digest, forms: repaired };
      Logger.log(JSON.stringify(result, null, 2));
      return result;
    } finally { lock.releaseLock(); }
  }
  function reportLateSurveyDraftStatus() {
    var data = BTS_GOOGLE_FORMS_DRAFT_DATA_;
    var props = PropertiesService.getScriptProperties();
    var rootKey = "BTS_FORMS_DRAFT_V1";
    var saved = props.getProperty(rootKey);
    var state = saved ? JSON.parse(saved) : null;
    var report = { mode: "read_only", currentInstrumentVersion: data.instrumentVersion, currentDigest: data.digest, root: null, forms: [] };
    if (state) {
      report.root = { status: state.status, instrumentVersion: state.instrumentVersion, digest: state.digest, spreadsheetId: state.spreadsheetId };
      Object.keys(state.forms || {}).forEach(function (key) {
        var recordText = props.getProperty(rootKey + ":" + key);
        var record = recordText ? JSON.parse(recordText) : null;
        var definition = data.forms.filter(function (entry) { return entry.phase + "_" + entry.language === key; })[0];
        var entry = { key: key, registeredFormId: state.forms[key], record: record ? { status: record.status, formId: record.formId, digest: record.digest } : null,
          expectedTitle: definition ? btsFormsTitle_(definition, { instrumentVersion: state.instrumentVersion }) : null,
          expectedCurrentTitle: definition ? btsFormsTitle_(definition, data) : null };
        // Inspect only the ID registered at the root; never enumerate other Properties or answer content.
        try {
          var form = FormApp.openById(state.forms[key]);
          function read(name, action) { try { entry[name] = action(); } catch (error) { entry[name + "Error"] = String(error.message || error); } }
          read("supportsAdvanced", function () { return form.supportsAdvancedResponderPermissions(); });
          read("isPublished", function () { return form.isPublished(); });
          read("isAcceptingResponses", function () { return form.isAcceptingResponses(); });
          read("countItems", function () { return form.getItems().length; });
          read("countResponses", function () { return form.getResponses().length; });
          read("actualTitle", function () { return form.getTitle(); });
          read("destinationId", function () { return btsFormsDestinationId_(form); });
        } catch (error) { entry.openError = String(error.message || error); }
        report.forms.push(entry);
      });
    }
    Logger.log(JSON.stringify(report, null, 2));
    return report;
  }
  function btsFormsMigrateEmpty_(state, data, props, rootKey) {
    var keys = Object.keys(state.forms);
    if (!keys.length || state.status !== "creating" || !state.instrumentVersion || !state.spreadsheetId || state.digest === data.digest) {
      throw new Error("Empty draft migration refused: requires an older, registered, interrupted empty draft.");
    }
    var oldData = { digest: state.digest, instrumentVersion: state.instrumentVersion, forms: data.forms };
    var verified = keys.map(function (key) {
      var record = JSON.parse(props.getProperty(rootKey + ":" + key) || "null");
      return { key: key, form: btsFormsEmptyResume_(key, record, state, oldData) };
    });
    var spreadsheet = SpreadsheetApp.openById(state.spreadsheetId);
    var manifest = spreadsheet.getSheetByName("Draft manifest");
    if (!manifest || spreadsheet.getSheets().length !== 1) throw new Error("Empty draft migration refused: expected only the original private Draft manifest sheet.");
    var rows = manifest.getRange(1, 1, 5, 2).getValues();
    if (rows.length !== 5 || rows[0][0] !== "Status" || rows[0][1] !== "REVIEW ONLY — unpublished / 研究確認専用・未公開" ||
        rows[1][0] !== "Instrument" || rows[1][1] !== state.instrumentVersion || rows[2][0] !== "Digest" || rows[2][1] !== state.digest ||
        rows[3][0] !== "Purpose" || rows[3][1] !== "Separate draft response destination; no production integration") {
      throw new Error("Empty draft migration refused: original manifest/version/digest does not match the registry.");
    }
    // All forms and the private manifest are verified before the first mutation. Never remove items, responses or files.
    var previous = { digest: state.digest, instrumentVersion: state.instrumentVersion, migratedAt: new Date().toISOString() };
    verified.forEach(function (entry) {
      var definition = data.forms.filter(function (row) { return row.phase + "_" + row.language === entry.key; })[0];
      entry.form.setTitle(btsFormsTitle_(definition, data));
      props.setProperty(rootKey + ":" + entry.key, JSON.stringify({ status: "building", formId: entry.form.getId(), digest: data.digest }));
    });
    manifest.getRange(1, 1, 5, 2).setValues(btsFormsManifestValues_(data));
    state.digest = data.digest;
    state.instrumentVersion = data.instrumentVersion;
    state.emptyDraftMigration = previous;
    props.setProperty(rootKey, JSON.stringify(state));
  }
  function btsFormsBuild_(resumeEmpty, migrateEmpty) {
    var data = BTS_GOOGLE_FORMS_DRAFT_DATA_;
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var props = PropertiesService.getScriptProperties();
      var rootKey = "BTS_FORMS_DRAFT_V1";
      var saved = props.getProperty(rootKey);
      var state = saved ? JSON.parse(saved) : { digest: data.digest, instrumentVersion: data.instrumentVersion, status: "creating", spreadsheetId: "", forms: {} };
      if (migrateEmpty) btsFormsMigrateEmpty_(state, data, props, rootKey);
      if (state.digest !== data.digest) throw new Error("Existing Forms instrument digest differs. Do not overwrite it. Use a NEW Apps Script project for a revised draft.");
      var records = {};
      var resumable = {};
      Object.keys(state.forms).forEach(function (key) {
        var record = JSON.parse(props.getProperty(rootKey + ":" + key) || "null");
        if (resumeEmpty && record && record.status === "building") {
          resumable[key] = btsFormsEmptyResume_(key, record, state, data);
          return;
        }
        if (!record || record.status !== "complete") throw new Error("Interrupted draft exists: " + key + " (" + state.forms[key] + "). Inspect it manually; automatic retry will not duplicate or delete it.");
        if (record.formId !== state.forms[key] || record.digest !== data.digest || record.phase + "_" + record.language !== key ||
            !data.forms.some(function (definition) { return definition.phase + "_" + definition.language === key; })) {
          throw new Error("Draft registry identity mismatch; no form opened: " + key);
        }
        btsFormsVerify_(FormApp.openById(record.formId), record, state.spreadsheetId);
        records[key] = record;
      });
      if (resumeEmpty && Object.keys(resumable).length === 0) throw new Error("Empty draft resume refused: no registered building draft. Use createLateSurveyDraftForms for a normal run.");
      if (!state.spreadsheetId) {
        var sheet = SpreadsheetApp.create("[DRAFT CLOSED] Blue Ticket Simulator Forms " + data.instrumentVersion);
        state.spreadsheetId = sheet.getId();
        props.setProperty(rootKey, JSON.stringify(state));
        sheet.getSheets()[0].setName("Draft manifest").getRange(1, 1, 5, 2).setValues(btsFormsManifestValues_(data));
      }
      var finishedThisRun = 0;
      data.forms.forEach(function (definition) {
        var key = definition.phase + "_" + definition.language;
        if (records[key] || finishedThisRun >= 1) return;
        var title = btsFormsTitle_(definition, data);
        var form = resumable[key] || FormApp.create(title, false); // Never transiently publish a new form.
        state.forms[key] = form.getId();
        props.setProperty(rootKey, JSON.stringify(state)); // Register immediately; interrupted builds never silently duplicate.
        props.setProperty(rootKey + ":" + key, JSON.stringify({ status: "building", formId: form.getId(), digest: data.digest }));
        if (!resumable[key]) form.setTitle(title); // New unpublished Google forms can have a document name but an empty body title.
        btsFormsClose_(form);
        form.setCollectEmail(false).setIsQuiz(false).setPublishingSummary(false).setAllowResponseEdits(false)
          .setShowLinkToRespondAgain(false).setLimitOneResponsePerUser(false).setShuffleQuestions(false).setProgressBar(true)
          .setDescription(btsFormsDescription_(data)).setConfirmationMessage(btsFormsConfirmation_());
        var participant = form.addTextItem().setTitle(definition.language === "ja" ? "研究用参加者ID（下書き確認用）" : "Study participant ID (draft review only)")
          .setHelpText("[participant_id] " + (definition.language === "ja" ? "氏名・メールアドレスを書かないでください。所属店舗・条件はここでは選択しません。" : "Do not enter your name or email. Store and condition are not selected here."))
          .setRequired(true).setValidation(FormApp.createTextValidation().requireTextMatchesPattern("^[A-Za-z]{4}[0-9]{2}$").setHelpText("4 letters + 2 digits, e.g. ABCD12 / 英字4文字＋数字2桁").build());
        var mapping = [{ sourceId: "participant_id", type: "text", itemId: String(participant.getId()), imageItemId: null, title: participant.getTitle() }];
        definition.items.forEach(function (source) {
          mapping.push(btsFormsAdd_(form, source, data));
          // The Web renderer adds an independent optional other-text field to every multi item.
          // A built-in Forms 'Other' choice would change the original choices and requiredness.
          if (source.type === "multi") {
            var other = form.addTextItem().setTitle(source.title + (definition.language === "ja" ? " — その他の内容（任意）" : " — Other details (optional)"))
              .setHelpText("[" + source.id + "_other]").setRequired(false);
            mapping.push({ sourceId: source.id + "_other", type: "other_text", itemId: String(other.getId()), imageItemId: null, title: other.getTitle() });
          }
        });
        form.setDestination(FormApp.DestinationType.SPREADSHEET, state.spreadsheetId);
        btsFormsClose_(form);
        // Keep every Script Property safely below its 9 KB value quota: mappings live in the private manifest sheet.
        var compact = { status: "complete", formId: form.getId(), digest: data.digest, phase: definition.phase, language: definition.language, editUrl: form.getEditUrl(), itemsSignature: btsFormsSignature_(form) };
        var destination = SpreadsheetApp.openById(state.spreadsheetId);
        var manifest = destination.getSheetByName("Map " + key) || destination.insertSheet("Map " + key);
        manifest.getRange(1, 1, mapping.length + 1, 6).setValues([["source_id", "source_type", "form_item_id", "image_item_id", "title", "instrument_digest"]].concat(mapping.map(function (row) { return [row.sourceId, row.type, row.itemId, row.imageItemId || "", row.title, data.digest]; })));
        props.setProperty(rootKey + ":" + key, JSON.stringify(compact));
        records[key] = compact;
        finishedThisRun++;
      });
      state.status = Object.keys(records).length === data.forms.length ? "complete" : "creating";
      props.setProperty(rootKey, JSON.stringify(state));
      var result = { status: state.status === "complete" ? "drafts_closed_unpublished" : "drafts_partially_complete_closed_unpublished", completedForms: Object.keys(records).length, expectedForms: data.forms.length, digest: data.digest, spreadsheetUrl: SpreadsheetApp.openById(state.spreadsheetId).getUrl(), forms: Object.keys(records).map(function (key) { return { key: key, editUrl: records[key].editUrl, formId: records[key].formId }; }) };
      Logger.log(JSON.stringify(result, null, 2));
      return result;
    } finally { lock.releaseLock(); }
  }
}

function sourceFor(data) {
  const runtime = googleFormsRuntime.toString();
  return "/** GENERATED by scripts/build-google-forms.js; REVIEW-ONLY, NEVER publishes. */\nvar BTS_GOOGLE_FORMS_DRAFT_DATA_ = " + JSON.stringify(data) + ";\n" + runtime.slice(runtime.indexOf("{") + 1, runtime.lastIndexOf("}")) + "\n";
}
async function build(root, options = {}) {
  const sharp = options.rasterize ? null : resolveSharp();
  const data = await instrument(root, options.rasterize || (svg => sharp(svg, { density: 144 }).resize({ width: 1280 }).png().toBuffer()));
  const target = safeFile(root, "gas/Forms.gs");
  const source = sourceFor(data);
  fs.writeFileSync(target, source);
  const assetsDirectory = safeFile(root, "gas/forms-assets");
  fs.mkdirSync(assetsDirectory, { recursive: true });
  for (const [relative, image] of Object.entries(data.images)) fs.writeFileSync(path.join(assetsDirectory, path.basename(relative, ".svg") + ".png"), Buffer.from(image.base64, "base64"));
  return { target, digest: data.digest, formCount: data.forms.length, imageCount: Object.keys(data.images).length, bytes: Buffer.byteLength(source), data };
}
if (require.main === module) build(path.resolve(__dirname, "..")).then(result => console.log(JSON.stringify({ path: result.target, digest: result.digest, forms: result.formCount, images: result.imageCount, bytes: result.bytes }, null, 2))).catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { instrument, sourceFor, build };
