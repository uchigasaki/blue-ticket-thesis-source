"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const baselineRoot = path.join(root, "baseline-original");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "baseline-manifest.json"), "utf8"));

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
    clear() { values.clear(); }
  };
}

function makeSandbox(search = "?store=A&condition=original") {
  const location = {
    hostname: "localhost",
    href: `http://localhost/${search}`,
    search
  };
  const sandbox = {
    URL,
    URLSearchParams,
    Uint8Array,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Set,
    Map,
    Promise,
    console,
    setTimeout,
    clearTimeout,
    crypto: crypto.webcrypto,
    location,
    sessionStorage: memoryStorage()
  };
  sandbox.window = sandbox;
  return vm.createContext(sandbox);
}

function runClassicScript(context, relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

function json(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadExperiment(search) {
  const context = makeSandbox(search);
  [
    "data.js",
    "common-corrections.js",
    "experiment-config.js",
    "condition-overlays.js",
    "evaluation-data.js",
    "experiment-context.js"
  ].forEach(file => runClassicScript(context, file));
  return context;
}

async function main() {
  let assertions = 0;
  const check = (condition, message) => {
    assert.ok(condition, message);
    assertions += 1;
  };

  for (const entry of manifest.files) {
    const filePath = path.join(baselineRoot, entry.path);
    check(fs.existsSync(filePath), `Frozen baseline file is missing: ${entry.path}`);
    check(fs.statSync(filePath).size === entry.bytes, `Frozen baseline size changed: ${entry.path}`);
    check(sha256(filePath) === entry.sha256, `Frozen baseline hash changed: ${entry.path}`);
  }

  const frozenWorkingFiles = [
    "data.js",
    "styles.css",
    "事前事後アンケート答え管理.txt",
    "assets/q1_narrow_road.png",
    "assets/q2_sidewalk_pedestrians.png",
    "assets/q3_yellow_signal.png",
    "assets/q4_stop_line.png",
    "assets/q5_railroad.png",
    "assets/q6_parallel.png",
    "assets/q7_light.png"
  ];
  for (const relativePath of frozenWorkingFiles) {
    check(
      sha256(path.join(root, relativePath)) === sha256(path.join(baselineRoot, relativePath)),
      `Condition B frozen asset changed: ${relativePath}`
    );
  }

  const context = loadExperiment("?store=A&condition=original");
  const data = context.APP_DATA;
  const api = context.EXPERIMENT_CONTEXT;
  const validateStudyInformation = context.BTS_PUBLIC_STUDY_INFORMATION.validate;
  const informationNow = Date.parse("2026-09-29T00:00:00+09:00");
  const validStudyInformation = {
    researcherName: {ja: "確認用研究者", en: "Fixture researcher"}, contactEmail: "fixture@research.invalid",
    retentionMonths: {contact: 6, rawResponses: 6, analysisData: 6}, ownerOnlyAccess: true
  };
  check(validateStudyInformation(validStudyInformation, informationNow).length === 0, "Explicit valid public operational information can pass");
  check(context.EXPERIMENT_CONFIG.studyInformation.researcherName.ja === "内ヶ崎優斗" && context.EXPERIMENT_CONFIG.studyInformation.researcherName.en === "内ヶ崎優斗" && context.EXPERIMENT_CONFIG.studyInformation.contactEmail === "archive@example.invalid" && Object.values(context.EXPERIMENT_CONFIG.studyInformation.retentionMonths).every(value => value === 6), "Archive retains the researcher name and retention fields and uses a dummy email");
  check(context.EXPERIMENT_CONFIG.studyInformation.ownerOnlyAccess === true, "The received owner-only viewing/deletion choice is recorded");
  for (const invalid of [undefined, null, [], {}, {...validStudyInformation, researcherName: {ja: "", en: "Fixture researcher"}}, {...validStudyInformation, researcherName: {ja: "確認用研究者", en: " "}}, {...validStudyInformation, ownerOnlyAccess: false}]) {
    check(validateStudyInformation(invalid, informationNow).length > 0, "Missing or incomplete public study information is rejected");
  }
  for (const contactEmail of ["", "a@example.com", "a@x.test,b@y.test", "a@x.test\nb@y.test", "Display Name <a@x.test>", "a@x.test?subject=hello", "a@bad_domain.test"]) {
    check(validateStudyInformation({...validStudyInformation, contactEmail}, informationNow).some(error => error.includes("contactEmail")), "Public contact must be a single non-placeholder plain email: " + JSON.stringify(contactEmail));
  }
  for (const key of ["contact", "rawResponses", "analysisData"]) {
    for (const months of ["", "無期限", "6", 0, -1, 6.5, 121, null, Infinity]) {
      check(validateStudyInformation({...validStudyInformation, retentionMonths: {...validStudyInformation.retentionMonths, [key]: months}}, informationNow).some(error => error.includes("retentionMonths." + key)), "Each data class requires an explicit finite whole-month retention period: " + key + " / " + months);
    }
  }
  check(validateStudyInformation({...validStudyInformation, retentionMonths: {contact: 1, rawResponses: 120, analysisData: 6}}, informationNow).length === 0, "Month-based retention permits distinct explicit periods for the three data classes");

  // Historical preservation and the corrected late-term baseline are distinct contracts.
  const historicalContext = makeSandbox();
  runClassicScript(historicalContext, "baseline-original/data.js");
  const historical = historicalContext.APP_DATA;
  check(JSON.stringify(context.FROZEN_APP_DATA) === JSON.stringify(historical), "The common correction layer must preserve all historical data, not only the file hash");
  check(data !== context.FROZEN_APP_DATA && Object.isFrozen(data.questions[0]), "Runtime late-term data must be a separate frozen copy");
  check(context.COMMON_CORRECTIONS.version === context.EXPERIMENT_CONFIG.commonCorrectionVersion && context.COMMON_CORRECTIONS.contentVersion === context.EXPERIMENT_CONFIG.contentVersion, "Content and common correction versions must be explicit and aligned");
  check(context.EXPERIMENT_CONFIG.appVersion !== "2.1.0-review.1" && context.EVALUATION_DATA.instrumentVersion === "2026-late-instrument-v2", "Corrected material must not reuse the old app or survey version");
  const changedLearning = [];
  data.questions.forEach((question, index) => {
    const old = historical.questions[index];
    if (JSON.stringify(question) !== JSON.stringify(old)) changedLearning.push(question.id);
    for (const field of ["id", "type", "image", "correct", "correct_groups", "groups", "group_labels", "score_domain", "log_type"]) {
      check(JSON.stringify(question[field]) === JSON.stringify(old[field]), `Common corrections must not alter the ${field} contract of ${question.id}`);
    }
  });
  check(JSON.stringify(changedLearning) === JSON.stringify(["q3", "q7", "q9"]), "Only the three approved learning questions may differ from the historical baseline");
  check(JSON.stringify(data.introCards) === JSON.stringify(historical.introCards) && JSON.stringify(data.ui) === JSON.stringify(historical.ui) && JSON.stringify(data.config) === JSON.stringify(historical.config), "Unrelated intro/UI/legacy configuration must remain historical");
  for (const language of ["ja", "en"]) {
    for (const [key, expected] of [["survey", ["pre_q8", "pre_q12"]], ["postSurvey", ["post_q3", "post_q7", "post_q8"]]]) {
      const changed = data[key][language].filter((item, index) => JSON.stringify(item) !== JSON.stringify(historical[key][language][index])).map(item => item.id);
      check(JSON.stringify(changed) === JSON.stringify(expected), `Only corresponding ${key}/${language} items may be corrected`);
      data[key][language].forEach((item, index) => {
        check(item.id === historical[key][language][index].id && item.type === historical[key][language][index].type, `Common corrections must retain ${key}/${language} item ID, order, and type`);
      });
    }
  }
  const q3 = data.questions.find(item => item.id === "q3");
  const q7 = data.questions.find(item => item.id === "q7");
  const q9 = data.questions.find(item => item.id === "q9");
  check(q3.body.ja.includes("安全に停止できる") && q3.body.en.includes("stop safely"), "Yellow-signal learning premises must make safe stopping explicit in both languages");
  check(q3.result_ok.ja.includes("例外") && q3.result_ok.en.includes("except"), "All groups must receive the yellow-signal unsafe-stop exception, not only C");
  check(q7.body.ja.includes("日没") && q7.body.en.includes("after sunset") && q7.result_ok.ja.includes("推奨") && q7.result_ok.en.includes("recommendation"), "Lighting content must distinguish nighttime obligation from early-lighting recommendation");
  check(q9.choices.B.ja.includes("通話") && q9.choices.B.en.includes("called a friend") && q9.choices.C.ja.includes("手に持ち") && q9.choices.C.en.includes("in your hand"), "Phone classification examples must now be handheld calling and handheld screen-gazing");
  check(q9.body.ja.includes("16歳以上") && q9.body.ja.includes("実際の交通の危険は生じていない") && q9.body.en.includes("not caused an actual traffic danger"), "Phone classification must state age and absence of actual danger");
  check(!q9.choices.C.ja.includes("ホルダー") && !q9.choices.C.en.includes("holder"), "The mounted-phone blue-ticket example must not survive in corrected choice C");
  check(context.EVALUATION_DATA.contentReviewIssues.every(issue => issue.status === "resolved" && issue.note.includes("内ヶ崎優斗")), "Current metadata must retain the actual named adoption receipt");
  check(Object.values(context.EVALUATION_DATA.researcherApprovals).every(value => value === true) && context.EVALUATION_DATA.contentReviewIssues[3].note.includes("未実証"), "Adoption flags do not claim statistical equivalence");

  const missingCorrection = makeSandbox();
  ["data.js", "experiment-config.js", "condition-overlays.js", "evaluation-data.js", "experiment-context.js"].forEach(file => runClassicScript(missingCorrection, file));
  check(missingCorrection.EXPERIMENT_CONTEXT.getReadinessReport({ production: false }).errors.some(error => error.includes("common-correction layer")), "Omitting the correction script must fail closed even in preview");
  const mismatchedContent = json(context.EXPERIMENT_CONFIG);
  mismatchedContent.contentVersion = "old-content";
  check(api.getReadinessReport({ production: false, config: mismatchedContent }).errors.some(error => error.includes("content versions must match")), "Mismatched content-version configuration must fail closed");
  let doubleApplyError = false;
  try { runClassicScript(context, "common-corrections.js"); } catch (error) { doubleApplyError = /exactly once/.test(error.message); }
  check(doubleApplyError, "A duplicate common correction script must not relabel the corrected data as historical");

  check(api.validateConfiguration().valid, "Experiment configuration structure must be valid");
  check(api.validateOverlayStructure().valid, "Condition overlay structure must be valid");
  check(api.getReadinessReport({ location: context.location }).ready, "Local development must be structurally runnable");
  const unapprovedEvaluation = json(context.EVALUATION_DATA);
  Object.keys(unapprovedEvaluation.researcherApprovals).forEach(key => { unapprovedEvaluation.researcherApprovals[key] = false; });
  const blockedProduction = api.getReadinessReport({ production: true, evaluationData: unapprovedEvaluation });
  check(!blockedProduction.ready, "Production must fail closed while researcher TODOs remain");
  check(blockedProduction.errors.some(error => error.includes("Researcher approval is missing")), "Researcher approvals must remain production gates");

  // Explicit empty fixtures keep missing-content gates tested after real drafts are populated.
  const emptyOverlays = json(context.CONDITION_OVERLAYS);
  Object.values(emptyOverlays.conditions.no_image.questions).forEach(question => { question.sceneDescription = { ja: "", en: "" }; });
  Object.values(emptyOverlays.conditions.improved.questions).forEach(question => {
    Object.keys(question).forEach(field => { question[field] = null; });
  });
  const emptyEvaluation = json(context.EVALUATION_DATA);
  emptyEvaluation.excludedBaseIds = { pre: [], post: [], followup: [] };
  emptyEvaluation.contentReviewIssues = [];
  for (const phase of ["pre", "post", "followup"]) {
    for (const section of ["extensions", "futureItems"]) emptyEvaluation[section][phase] = { ja: [], en: [] };
    const base = phase === "pre" ? data.survey.ja : phase === "post" ? data.postSurvey.ja : [];
    emptyEvaluation.answerKeys[phase] = Object.fromEntries(Object.entries(emptyEvaluation.answerKeys[phase]).filter(([id]) => base.some(item => item.id === id)));
  }
  const emptyReport = api.getReadinessReport({ production: true, overlays: emptyOverlays, evaluationData: emptyEvaluation });
  check(emptyReport.errors.some(error => error.includes(" en sceneDescription")), "A must require English scene descriptions while English UI is enabled");
  check(emptyReport.errors.some(error => error.includes("Condition improved has no")), "C must not become production-ready while it is identical to B");
  check(emptyReport.errors.some(error => error.includes("items for followup")), "Follow-up evaluation content must remain a production gate");

  const productionConfig = json(context.EXPERIMENT_CONFIG);
  productionConfig.serverEndpoint = "https://example.test/exec";
  productionConfig.deploymentUrl = "https://example.test/late-study/";
  const productionOverlays = json(context.CONDITION_OVERLAYS);
  productionOverlays.conditions.no_image.readyForProduction = true;
  Object.values(productionOverlays.conditions.no_image.questions).forEach(question => {
    question.sceneDescription = { ja: "研究者承認済みの場面説明", en: "Researcher-approved scene description" };
  });
  productionOverlays.conditions.improved.readyForProduction = true;
  Object.values(productionOverlays.conditions.improved.questions).forEach(question => {
    question.keyPoint = { ja: "研究者承認済みの改善要素", en: "Researcher-approved support" };
  });
  const productionEvaluation = json(emptyEvaluation);
  productionEvaluation.readyForProduction = true;
  Object.keys(productionEvaluation.researcherApprovals).forEach(key => {
    productionEvaluation.researcherApprovals[key] = true;
  });
  for (const phase of ["pre", "post", "followup"]) {
    const id = `late_${phase}_01`;
    productionEvaluation.extensions[phase].ja = [{
      id, type: "single", title: `${phase}の研究者承認済み項目`, choices: ["A．選択肢1", "B．選択肢2"], optional: false
    }];
    productionEvaluation.extensions[phase].en = [{
      id, type: "single", title: `Researcher-approved ${phase} item`, choices: ["A. Choice 1", "B. Choice 2"], optional: false
    }];
  }
  check(api.validateEvaluationStructure(productionEvaluation, productionConfig).valid, "A well-formed bilingual shared evaluation must pass structural validation");
  check(api.getReadinessReport({
    production: true,
    config: productionConfig,
    overlays: productionOverlays,
    evaluationData: productionEvaluation
  }).ready, "Fully populated researcher-approved production inputs must be capable of passing the fail-closed gate");

  const contentIssueEvaluation = json(productionEvaluation);
  contentIssueEvaluation.contentReviewIssues = [{ id: "baseline-law-review", status: "unresolved", severity: "blocking" }];
  check(api.getReadinessReport({ production: true, config: productionConfig, overlays: productionOverlays, evaluationData: contentIssueEvaluation }).errors.some(error => error.includes("Unresolved blocking content review issue")), "Approval booleans must not bypass an unresolved legal/content issue");
  contentIssueEvaluation.contentReviewIssues[0].status = "resolved";
  check(api.getReadinessReport({ production: true, config: productionConfig, overlays: productionOverlays, evaluationData: contentIssueEvaluation }).ready, "Recorded issue resolution can pass when all other production inputs are ready");
  const noDeploymentConfig = json(productionConfig);
  noDeploymentConfig.deploymentUrl = "";
  check(api.getReadinessReport({ production: true, config: noDeploymentConfig, overlays: productionOverlays, evaluationData: productionEvaluation }).errors.some(error => error.includes("deploymentUrl")), "Tokenized followup requires an explicit production base URL");

  const emptyObjectEvaluation = json(productionEvaluation);
  for (const phase of ["pre", "post", "followup"]) {
    for (const language of ["ja", "en"]) emptyObjectEvaluation.extensions[phase][language] = [{}];
  }
  const emptyObjectReport = api.validateEvaluationStructure(emptyObjectEvaluation, productionConfig);
  check(!emptyObjectReport.valid && emptyObjectReport.errors.some(error => error.includes("safe non-empty id")), "Placeholder objects must not pass evaluation readiness");
  check(!api.getReadinessReport({
    production: true,
    config: productionConfig,
    overlays: productionOverlays,
    evaluationData: emptyObjectEvaluation
  }).ready, "Malformed non-empty evaluation arrays must remain production-blocking");

  const duplicateEvaluation = json(productionEvaluation);
  duplicateEvaluation.extensions.pre.ja[0].id = "age";
  duplicateEvaluation.extensions.pre.en[0].id = "age";
  check(api.validateEvaluationStructure(duplicateEvaluation, productionConfig).errors.some(error => error.includes("duplicates survey id age")), "Shared evaluation ids must not duplicate frozen survey ids");

  const mismatchedLanguageEvaluation = json(productionEvaluation);
  mismatchedLanguageEvaluation.extensions.post.en[0].id = "late_post_other";
  check(api.validateEvaluationStructure(mismatchedLanguageEvaluation, productionConfig).errors.some(error => error.includes("ja/en item ids and order must match")), "Japanese and English evaluation item ids must match");

  const unsupportedEvaluation = json(productionEvaluation);
  unsupportedEvaluation.extensions.followup.ja[0].type = "mystery";
  unsupportedEvaluation.extensions.followup.en[0].type = "mystery";
  check(api.validateEvaluationStructure(unsupportedEvaluation, productionConfig).errors.some(error => error.includes("unsupported type mystery")), "Unknown evaluation item types must be rejected");

  const missingAltEvaluation = json(productionEvaluation);
  missingAltEvaluation.extensions.post.ja[0].image = "./assets/transfer.png";
  missingAltEvaluation.extensions.post.en[0].image = "./assets/transfer.png";
  check(api.validateEvaluationStructure(missingAltEvaluation, productionConfig).errors.some(error => error.includes("requires non-empty imageAlt")), "Evaluation images must require alt text in each language");

  const unknownKeyEvaluation = json(productionEvaluation);
  unknownKeyEvaluation.answerKeys.followup.unknown_item = "A";
  check(api.validateEvaluationStructure(unknownKeyEvaluation, productionConfig).errors.some(error => error.includes("contains unknown id unknown_item")), "Answer keys must reference known shared or frozen evaluation ids");

  check(api.parseStore("?store=a") === "A", "Store codes must normalize to uppercase");
  check(api.parseStore("?store=%20A%20") === "A", "Store codes must normalize surrounding whitespace");
  check(api.parseStore("?store=D") === null, "Unknown stores must be rejected");
  check(api.parseStore("") === null, "Missing store must be rejected");
  check(api.parseStore("?store=A&store=B") === null, "Duplicate store parameters must be rejected");
  check(api.parseStore("?store=A&store=A") === null, "Repeated store parameters must be rejected even when values match");
  check(api.parseStore("?store=%20") === null, "Whitespace-only store values must be rejected");
  check(api.normalizeParticipantId(" bike33 ") === "BIKE33", "Participant IDs must normalize for joins");
  check(api.validateParticipantId("bike33"), "Existing lowercase participant IDs must remain accepted");
  check(!api.validateParticipantId("BIKE3"), "Malformed participant IDs must be rejected");

  const revisionState = {};
  check(!api.recordControlRevision(revisionState, "answer|B", true), "First multi-select choice must be answer construction, not a revision");
  check(!api.recordControlRevision(revisionState, "answer|C", true), "Adding a second required choice must not count as a revision");
  check(api.recordControlRevision(revisionState, "answer|B", false), "Unchecking a previously selected choice must count as a revision");
  check(api.recordControlRevision(revisionState, "answer|B", true), "Rechecking a revised choice must count as a revision");
  const classifyState = {};
  check(!api.recordControlRevision(classifyState, "class_A", "ticket"), "First classification for A must not count as a revision");
  check(!api.recordControlRevision(classifyState, "class_B", "warning"), "First classification for B must not count as a revision");
  check(!api.recordControlRevision(classifyState, "class_C", "criminal"), "First classification for C must not count as a revision");
  check(api.recordControlRevision(classifyState, "class_B", "ticket"), "Changing an existing classification must count as one revision");

  for (const baseQuestion of data.questions) {
    const original = api.derivePresentationQuestion(baseQuestion, "original");
    check(original === baseQuestion, `Condition B must preserve the shared corrected base object identity for ${baseQuestion.id}`);

    const noImage = api.derivePresentationQuestion(baseQuestion, "no_image");
    check(json(noImage.choices) && JSON.stringify(json(noImage.choices)) === JSON.stringify(json(baseQuestion.choices)), `A choices changed for ${baseQuestion.id}`);
    check(JSON.stringify(json(noImage.correct ?? noImage.correct_groups)) === JSON.stringify(json(baseQuestion.correct ?? baseQuestion.correct_groups)), `A answer key changed for ${baseQuestion.id}`);
    if (baseQuestion.image) {
      check(noImage !== baseQuestion, `A must derive an image-free view for ${baseQuestion.id}`);
      check(noImage.image === null, `A must omit the learning image for ${baseQuestion.id}`);
      check(baseQuestion.image.endsWith(".png"), `Base image was mutated for ${baseQuestion.id}`);
      check(Object.prototype.hasOwnProperty.call(noImage, "sceneDescription"), `A sceneDescription field missing for ${baseQuestion.id}`);
    } else {
      check(noImage === baseQuestion, `A must not copy image-free baseline question ${baseQuestion.id}`);
    }

    const improved = api.derivePresentationQuestion(baseQuestion, "improved");
    check(improved !== baseQuestion, `C must expose an extension view for ${baseQuestion.id}`);
    check(improved.image === baseQuestion.image, `C image path changed for ${baseQuestion.id}`);
    check(JSON.stringify(json(improved.choices)) === JSON.stringify(json(baseQuestion.choices)), `C choices changed for ${baseQuestion.id}`);
    check(JSON.stringify(json(improved.correct ?? improved.correct_groups)) === JSON.stringify(json(baseQuestion.correct ?? baseQuestion.correct_groups)), `C answer key changed for ${baseQuestion.id}`);
    ["keyPoint", "okExample", "ngExample", "decisionRule", "decisionFlow", "highlight", "explanationImage", "explanationImageAlt", "feedbackByAnswer"].forEach(field => {
      check(Object.prototype.hasOwnProperty.call(improved, field), `C extension field ${field} missing for ${baseQuestion.id}`);
    });
  }

  const expectedPreKeys = {
    pre_q6: ["B", "C"], pre_q7: ["B", "C"], pre_q8: "B", pre_q9: "B",
    pre_q10: ["B", "C"], pre_q11: ["A", "C"], pre_q12: ["A", "C"]
  };
  const expectedPostKeys = {
    post_q1: ["B", "C"], post_q2: ["B", "C"], post_q3: "B", post_q4: "B",
    post_q5: ["B", "C"], post_q6: ["A", "C"], post_q7: ["A", "C"],
    post_q8: "D", post_q9: "B", post_q10: "A"
  };
  for (const [questionId, answer] of Object.entries(expectedPreKeys)) {
    check(JSON.stringify(json(api.lookupAnswerKey("pre", questionId))) === JSON.stringify(answer), `Pre answer key mismatch: ${questionId}`);
  }
  for (const [questionId, answer] of Object.entries(expectedPostKeys)) {
    check(JSON.stringify(json(api.lookupAnswerKey("post", questionId))) === JSON.stringify(answer), `Post answer key mismatch: ${questionId}`);
  }
  check(api.lookupAnswerKey("post", "post_understanding") === null, "Subjective items must not receive invented answer keys");

  for (const language of ["ja", "en"]) {
    check(api.mergeSurveyItems(data.survey[language], "pre", { language, evaluationData: emptyEvaluation }) === data.survey[language], `Empty shared pre extension must preserve ${language} array identity`);
    check(api.mergeSurveyItems(data.postSurvey[language], "post", { language, evaluationData: emptyEvaluation }) === data.postSurvey[language], `Empty shared post extension must preserve ${language} array identity`);
  }

  const excludedEvaluation = json(emptyEvaluation);
  excludedEvaluation.excludedBaseIds.post = ["post_scenario_helpful", "post_useful_content"];
  check(api.validateEvaluationStructure(excludedEvaluation, productionConfig).valid, "Common subjective exclusions must be structurally valid");
  for (const language of ["ja", "en"]) {
    const filtered = api.mergeSurveyItems(data.postSurvey[language], "post", { language, evaluationData: excludedEvaluation });
    check(!filtered.some(item => excludedEvaluation.excludedBaseIds.post.includes(item.id)), `Image-specific items must be omitted from all late conditions in ${language}`);
    check(data.postSurvey[language].some(item => item.id === "post_scenario_helpful"), "Exclusions must not mutate frozen survey data");
  }
  excludedEvaluation.excludedBaseIds.post.push("post_q1");
  check(api.validateEvaluationStructure(excludedEvaluation, productionConfig).errors.some(error => error.includes("cannot exclude an objective")), "Objective baseline exclusions must not silently leave orphan answer keys");
  excludedEvaluation.excludedBaseIds.post = ["unknown_id"];
  check(api.validateEvaluationStructure(excludedEvaluation, productionConfig).errors.some(error => error.includes("unknown bilingual base id")), "Unknown exclusion ids must fail validation");

  const payloadConfig = json(context.EXPERIMENT_CONFIG);
  const payloadIdentity = {
    session_id: "session_payload_001",
    participant_id: "TEST01",
    participant_id_normalized: "TEST01",
    assignment_id: "assignment_payload_001",
    store_id: "A",
    condition: "original",
    language: "ja"
  };
  const payloadState = {
    schemaVersion: payloadConfig.schemaVersion,
    appVersion: payloadConfig.appVersion,
    submissionId: "submission_payload_001",
    sessionId: payloadIdentity.session_id,
    participantId: payloadIdentity.participant_id,
    participantIdNormalized: payloadIdentity.participant_id_normalized,
    email: "qa@example.test",
    lang: "ja",
    storeId: "A",
    condition: "original",
    experimentDate: "2026-08-24",
    sessionStartedAt: "2026-08-24T10:00:00.000Z",
    completedAt: "2026-08-24T10:10:00.000Z",
    postSurveyCompletedAt: "2026-08-24T10:12:00.000Z",
    consent: true,
    consentGivenAt: "2026-08-24T10:01:00.000Z",
    assignment: {
      schemaVersion: payloadConfig.schemaVersion,
      experimentId: payloadConfig.experimentId,
      appVersion: payloadConfig.appVersion,
      allocationVersion: payloadConfig.allocationVersion,
      assignmentId: payloadIdentity.assignment_id,
      clientRunId: "client_payload_001",
      sessionId: payloadIdentity.session_id,
      participantToken: "a".repeat(64),
      storeId: "A",
      participantId: "TEST01",
      condition: "original",
      source: "server",
      method: payloadConfig.assignmentMethod,
      status: "confirmed",
      reused: false,
      assignedAt: "2026-08-24T10:02:00.000Z"
    },
    phaseTimes: {
      pre_started_at: "2026-08-24T10:00:00.000Z",
      pre_completed_at: "2026-08-24T10:02:00.000Z",
      learning_started_at: "2026-08-24T10:02:00.000Z",
      learning_completed_at: "2026-08-24T10:10:00.000Z",
      post_started_at: "2026-08-24T10:10:00.000Z",
      post_completed_at: "2026-08-24T10:12:00.000Z"
    },
    preSurveyAnswers: { age: "20" },
    postSurveyAnswers: { post_understanding: "4" },
    preSurveyLogs: [{
      ...payloadIdentity,
      event_id: "submission_payload_001:pre:age:1",
      phase: "pre",
      question_id: "age",
      question_order: 1,
      selected_answer: "20",
      correct_answer: null,
      is_correct: null,
      answered_at: "2026-08-24T10:01:30.000Z",
      timestamp: "2026-08-24T10:01:30.000Z",
      response_time_ms: 1500,
      screen_dwell_time_ms: 90000,
      answer_change_count: 0,
      explanation_view_time_ms: null
    }],
    answers: [{
      ...payloadIdentity,
      event_id: "submission_payload_001:learning:q1:1",
      phase: "learning",
      question_id: "q1",
      question_order: 1,
      selected_answer: "B|C",
      correct_answer: "B|C",
      is_correct: true,
      answered_at: "2026-08-24T10:05:00.000Z",
      timestamp: "2026-08-24T10:05:00.000Z",
      response_time_ms: 3000,
      screen_dwell_time_ms: 3000,
      answer_change_count: 1,
      explanation_view_time_ms: 2500
    }],
    postSurveyLogs: [{
      ...payloadIdentity,
      event_id: "submission_payload_001:post:post_understanding:1",
      phase: "post",
      question_id: "post_understanding",
      question_order: 1,
      selected_answer: "4",
      correct_answer: null,
      is_correct: null,
      answered_at: "2026-08-24T10:11:30.000Z",
      timestamp: "2026-08-24T10:11:30.000Z",
      response_time_ms: 2000,
      screen_dwell_time_ms: 90000,
      answer_change_count: 0,
      explanation_view_time_ms: null
    }]
  };
  const completionPayload = api.buildCompletionPayload({
    config: payloadConfig,
    data: json(data),
    state: payloadState,
    summary: { overall_accuracy: 100, situation_score: 100, system_score: 0 },
    followupEmailPreview: { subject: "test", body: "test" },
    nowMs: Date.parse("2026-08-24T10:12:00.000Z")
  });
  check(completionPayload.participant_id_normalized === "TEST01" && completionPayload.store_id === "A" && completionPayload.condition === "original", "Completion payload must preserve the assigned participant/store/condition identity");
  check(completionPayload.allocation.assignment_id === payloadIdentity.assignment_id && completionPayload.allocation.allocation_version === payloadConfig.allocationVersion, "Completion payload must preserve the confirmed allocation identity");
  check(JSON.stringify(json(completionPayload.question_logs.map(row => row.phase))) === JSON.stringify(["pre", "learning", "post"]), "Completion payload must combine all three phases in a deterministic order");
  check(completionPayload.question_logs.every(row => row.participant_id_normalized === "TEST01" && row.store_id === "A" && row.condition === "original" && row.assignment_id === payloadIdentity.assignment_id), "Every completion question log must share the participant/store/condition/assignment identity");
  check(completionPayload.start_time === payloadState.sessionStartedAt && completionPayload.end_time === payloadState.postSurveyCompletedAt, "Completion payload must preserve explicit start and end timestamps");
  check(completionPayload.followup.send_at === "2026-08-31T10:12:00.000Z" && completionPayload.followup.requested, "Follow-up scheduling must be deterministic and tied to email consent data");
  check(completionPayload.instrument_version === context.EVALUATION_DATA.instrumentVersion && completionPayload.followup.instrument_version === context.EVALUATION_DATA.instrumentVersion, "Completion and followup must bind the same instrument version");
  check(completionPayload.content_version === context.EXPERIMENT_CONFIG.contentVersion && completionPayload.common_correction_version === context.EXPERIMENT_CONFIG.commonCorrectionVersion && completionPayload.baseline_variant === "late_common_corrected_v1", "Completion payload must identify the corrected common baseline");
  check(completionPayload.summary.content_version === completionPayload.content_version && completionPayload.summary.common_correction_version === completionPayload.common_correction_version, "Legacy summary_json exports must also retain the content correction versions");
  check(completionPayload.question_logs.every(row => row.content_version === completionPayload.content_version && row.common_correction_version === completionPayload.common_correction_version && row.instrument_version === completionPayload.instrument_version), "Every question-log row must be independently distinguishable by content, correction, and instrument versions");
  check(completionPayload.question_logs.every(row => row.experiment_id === payloadConfig.experimentId), "Every pre/learning/post log carries the production experiment binding");
  check(completionPayload.followup.delivery_mode === "google_forms" && completionPayload.followup.email_preview === null, "Forms-only followup must never use frozen URLs or client email previews");
  check(completionPayload.participant_token === payloadState.assignment.participantToken && !JSON.stringify(completionPayload.question_logs).includes(payloadState.assignment.participantToken), "Scoped participant capability belongs only at the transport envelope, never question logs");
  for (const change of [{ participantToken: "" }, { participantToken: "short" }, { sessionId: "other_session_001" }]) {
    const changedState = json(payloadState); Object.assign(changedState.assignment, change);
    assert.throws(() => api.buildCompletionPayload({ config: payloadConfig, data: json(data), state: changedState }), error => error.code === "INVALID_COMPLETION_STATE"); assertions++;
  }

  const corruptPayloadState = json(payloadState);
  corruptPayloadState.answers[0].condition = "improved";
  let corruptPayloadError = null;
  try {
    api.buildCompletionPayload({ config: payloadConfig, data: json(data), state: corruptPayloadState, nowMs: 0 });
  } catch (error) {
    corruptPayloadError = error;
  }
  check(corruptPayloadError?.code === "INVALID_COMPLETION_STATE", "A cross-condition learning log must be rejected before local completion or network send");

  const duplicateEventState = json(payloadState);
  duplicateEventState.postSurveyLogs[0].event_id = duplicateEventState.preSurveyLogs[0].event_id;
  let duplicateEventError = null;
  try {
    api.buildCompletionPayload({ config: payloadConfig, data: json(data), state: duplicateEventState, nowMs: 0 });
  } catch (error) {
    duplicateEventError = error;
  }
  check(duplicateEventError?.code === "INVALID_COMPLETION_STATE", "Duplicate event ids must be rejected before local completion or network send");

  const storage = memoryStorage();
  const firstAssignment = await api.getOrCreateAssignment({
    participantId: "bike33",
    store: "A",
    search: "?store=A&condition=improved",
    location: { hostname: "localhost", href: "http://localhost/?store=A&condition=improved", search: "?store=A&condition=improved" },
    storage
  });
  const secondAssignment = await api.getOrCreateAssignment({
    participantId: "BIKE33",
    store: "A",
    search: "?store=A&condition=no_image",
    location: { hostname: "localhost", href: "http://localhost/?store=A&condition=no_image", search: "?store=A&condition=no_image" },
    storage
  });
  check(firstAssignment.condition === "improved", "Local condition override must work for testing");
  check(secondAssignment.assignmentId === firstAssignment.assignmentId, "Cached assignment must remain stable");
  check(secondAssignment.condition === firstAssignment.condition, "Condition must not change after assignment");

  const invalidCacheVariants = [
    ["appVersion", "stale-app", "stale app version"],
    ["status", "processing", "unconfirmed status"],
    ["method", "unknown_method", "unexpected allocation method"],
    ["clientRunId", "short", "malformed client run id"],
    ["assignedAt", "not-a-date", "invalid assignment timestamp"]
  ];
  invalidCacheVariants.forEach(([field, value, label]) => {
    const invalidCacheStorage = memoryStorage();
    const invalidCacheKey = api.assignmentCacheKey("A", "BIKE33", context.EXPERIMENT_CONFIG);
    invalidCacheStorage.setItem(invalidCacheKey, JSON.stringify({ ...firstAssignment, [field]: value }));
    check(api.loadCachedAssignment("A", "BIKE33", {
      config: context.EXPERIMENT_CONFIG,
      storage: invalidCacheStorage
    }) === null, `Assignment cache must reject ${label}`);
    check(invalidCacheStorage.getItem(invalidCacheKey) === null, `Rejected ${label} cache must be removed`);
  });

  const brokenStorage = {
    getItem() { return null; },
    setItem() { throw new Error("blocked"); },
    removeItem() {}
  };
  let storageFailure = null;
  try {
    await api.getOrCreateAssignment({
      participantId: "FAIL01",
      store: "A",
      search: "?store=A&condition=original",
      location: { hostname: "localhost", href: "http://localhost/?store=A&condition=original", search: "?store=A&condition=original" },
      storage: brokenStorage
    });
  } catch (error) {
    storageFailure = error;
  }
  check(storageFailure && storageFailure.code === "STORAGE_UNAVAILABLE", "Assignment must fail closed when stable browser storage is unavailable");

  const receiptConfig = json(context.EXPERIMENT_CONFIG);
  receiptConfig.serverEndpoint = "https://example.test/exec";
  function assignmentDocument(overrides = {}) {
    return {
      createElement() { return { async: false, src: "", parentNode: null, onerror: null }; },
      head: {
        appendChild(script) {
          script.parentNode = { removeChild() {} };
          const requestUrl = new URL(script.src);
          const callback = requestUrl.searchParams.get(receiptConfig.jsonp.callbackParameter);
          const payload = Object.assign({
            ok: true,
            reused: false,
            schema_version: receiptConfig.schemaVersion,
            app_version: receiptConfig.appVersion,
            client_run_id: requestUrl.searchParams.get("client_run_id"),
            session_id: requestUrl.searchParams.get("session_id"),
            participant_token: "b".repeat(64),
            assignment_id: "assignment_remote_001",
            experiment_id: requestUrl.searchParams.get("experiment_id"),
            allocation_version: requestUrl.searchParams.get("allocation_version"),
            participant_id: requestUrl.searchParams.get("participant_id"),
            participant_id_normalized: requestUrl.searchParams.get("participant_id"),
            store_id: requestUrl.searchParams.get("store_id"),
            condition: "original",
            assignment_method: "gas_min_count_v1",
            status: "confirmed",
            assigned_at: "2026-08-24T10:00:00.000Z"
          }, overrides);
          context[callback](payload);
        }
      }
    };
  }
  const remoteLocation = { hostname: "example.test", href: "https://example.test/", search: "?store=A" };
  const remoteAssignment = await api.getOrCreateAssignment({
    config: productionConfig,
    overlays: productionOverlays,
    evaluationData: productionEvaluation,
    participantId: "NETW24",
    store: "A",
    location: remoteLocation,
    storage: memoryStorage(),
    document: assignmentDocument()
  });
  check(remoteAssignment.status === "confirmed" && remoteAssignment.assignmentId === "assignment_remote_001", "A complete matching server assignment must be accepted and normalized");
  check(remoteAssignment.participantToken === "b".repeat(64) && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/.test(remoteAssignment.sessionId), "Confirmed assignment retains the scoped capability and bound session privately");
  const capabilityCache = memoryStorage();
  api.saveCachedAssignment(remoteAssignment, { config: productionConfig, storage: capabilityCache });
  check(api.loadCachedAssignment("A", "NETW24", { config: productionConfig, storage: capabilityCache }).participantToken === remoteAssignment.participantToken, "Assignment capability survives a safe private cache round trip");
  let sessionMismatch;
  try { await api.getOrCreateAssignment({ config: productionConfig, overlays: productionOverlays, evaluationData: productionEvaluation, participantId: "NETW24", store: "A", sessionId: "other_session_001", location: remoteLocation, storage: capabilityCache }); }
  catch (error) { sessionMismatch = error; }
  check(sessionMismatch?.code === "ASSIGNMENT_SESSION_MISMATCH", "An existing remote assignment cannot move to a new session");
  let cachedApprovalBypass;
  try { await api.getOrCreateAssignment({ config: productionConfig, evaluationData: unapprovedEvaluation, participantId: "NETW24", store: "A", sessionId: remoteAssignment.sessionId, location: remoteLocation, storage: capabilityCache }); }
  catch (error) { cachedApprovalBypass = error; }
  check(Boolean(cachedApprovalBypass), "A cached capability cannot bypass actual unresolved production approvals");
  const capabilityKey = api.assignmentCacheKey("A", "NETW24", productionConfig);
  capabilityCache.setItem(capabilityKey + ":client-run-id", "private_run_001");
  api.clearCachedAssignment("A", "NETW24", { config: productionConfig, storage: capabilityCache });
  check(capabilityCache.getItem(capabilityKey) === null && capabilityCache.getItem(capabilityKey + ":client-run-id") === null, "Ending a saved assignment clears both capability cache and stable client run ID");

  async function assignmentRecoveryFixture(outcomes) {
    const originalSetTimeout = context.setTimeout, originalClearTimeout = context.clearTimeout;
    const timers = new Map(), requests = [], records = new Map(), cache = memoryStorage();
    let nextTimer = 0;
    context.setTimeout = (fn, delay) => { const id = ++nextTimer; timers.set(id, {fn, delay, cleared:false}); return id; };
    context.clearTimeout = id => { if(timers.has(id)) timers.get(id).cleared = true; };
    const document = {createElement: () => ({}), head: {appendChild(script) {
      script.parentNode = {removeChild: () => { script.removed = true; }};
      const url = new URL(script.src), params = Object.fromEntries(url.searchParams.entries());
      const callback = params.callback, outcome = outcomes[requests.length] || "success";
      requests.push({params, script});
      if(outcome.startsWith("reject:")) {
        context[callback]({ok:false, error:outcome.slice(7), message:"assignment_busy"});
        return;
      }
      const key = [params.experiment_id, params.allocation_version, params.store_id, params.participant_id].join("|");
      const reused = records.has(key);
      let payload = records.get(key);
      if(!payload) {
        payload = {ok:true, reused:false, schema_version:productionConfig.schemaVersion, app_version:params.app_version,
          client_run_id:params.client_run_id, session_id:params.session_id, participant_token:"c".repeat(64),
          assignment_id:"assignment_recovery_001", experiment_id:params.experiment_id, allocation_version:params.allocation_version,
          participant_id:params.participant_id, participant_id_normalized:params.participant_id, store_id:params.store_id,
          condition:"original", assignment_method:"gas_min_count_v1", status:"confirmed", assigned_at:"2026-09-29T00:00:00Z"};
        records.set(key, payload);
      }
      if(outcome === "timeout") {
        const waiting = [...timers.values()].find(timer => !timer.cleared && timer.delay !== 360000);
        waiting.fn();
      } else if(outcome === "network") script.onerror();
      else context[callback]({...payload, reused, ...(outcome === "invalid" ? {store_id:"C"} : {})});
    }}};
    let result, error;
    try {
      try {
        result = await api.getOrCreateAssignment({config:productionConfig, overlays:productionOverlays,
          evaluationData:productionEvaluation, participantId:"RTRY29", store:"B", sessionId:"retry_session_12345678901234567890",
          location:remoteLocation, storage:cache, document});
      } catch(caught) { error = caught; }
      const tombstones = requests.filter(request => typeof context[request.params.callback] === "function");
      tombstones.forEach(request => context[request.params.callback]({ok:true, condition:"improved", participant_token:"must-not-be-accepted"}));
      const cached = api.loadCachedAssignment("B", "RTRY29", {config:productionConfig, storage:cache});
      [...timers.values()].filter(timer => timer.delay === 360000).forEach(timer => timer.fn());
      return {result, error, requests, records, cached, tombstones: tombstones.length,
        callbacksRemoved:requests.every(request => context[request.params.callback] === undefined),
        scriptsRemoved:requests.every(request => request.script.removed),
        requestTimeouts:[...timers.values()].filter(timer => timer.delay !== 360000)};
    } finally { context.setTimeout = originalSetTimeout; context.clearTimeout = originalClearTimeout; }
  }
  for (const failure of ["timeout", "network", "reject:assignment_busy"]) {
    const recovery = await assignmentRecoveryFixture([failure, "success"]);
    check(recovery.requests.length === 2 && recovery.result?.status === "confirmed" && recovery.result.storeId === "B", "One automatic retry recovers transient assignment failure: " + failure);
    const stable = request => Object.fromEntries(Object.entries(request.params).filter(([key]) => key !== "callback"));
    check(JSON.stringify(stable(recovery.requests[0])) === JSON.stringify(stable(recovery.requests[1])), "Retry preserves the complete participant/session/client-run request: " + failure);
    check(recovery.requests[0].params.callback !== recovery.requests[1].params.callback, "Each attempt uses an independent JSONP callback: " + failure);
    check(recovery.requests.every(request => request.script.crossOrigin === "anonymous" && request.script.referrerPolicy === "no-referrer"), "Public GAS requests exclude Google account credentials and referrer on every attempt: " + failure);
    check(recovery.records.size === 1 && recovery.result.assignmentId === "assignment_recovery_001", "Delayed delivery never allocates a second server record: " + failure);
    check(recovery.result.reused === (failure !== "reject:assignment_busy"), "A committed but undelivered assignment is explicitly returned as reused: " + failure);
    check(recovery.requestTimeouts.every(timer => timer.delay === productionConfig.jsonp.timeoutMs), "Each bounded attempt uses the configured public JSONP timeout: " + failure);
    check(recovery.cached?.participantToken === "c".repeat(64) && recovery.cached.condition === "original", "Late response cannot replace the retry result or cache: " + failure);
    check(recovery.callbacksRemoved && recovery.scriptsRemoved && recovery.requestTimeouts.every(timer => timer.cleared), "Callbacks, scripts and request timers are cleaned up after recovery: " + failure);
    check(failure === "reject:assignment_busy" ? recovery.tombstones === 0 : recovery.tombstones === 1, "Only aborted network attempts retain a bounded no-op late callback: " + failure);
  }
  for (const failure of ["timeout", "network", "reject:assignment_busy"]) {
    const stopped = await assignmentRecoveryFixture([failure, failure, "success"]);
    check(stopped.requests.length === 2 && !stopped.result && Boolean(stopped.error), "Assignment recovery is bounded to two requests: " + failure);
    check(stopped.cached === null && stopped.callbacksRemoved && stopped.scriptsRemoved, "Exhausted recovery never caches an unconfirmed assignment or leaks callbacks: " + failure);
  }
  for (const failure of ["reject:production_session_conflict", "reject:production_enrollment_not_open", "reject:production_enrollment_closed", "reject:production_unauthorized", "reject:production_version_mismatch", "reject:internal_error", "invalid"]) {
    const stopped = await assignmentRecoveryFixture([failure, "success"]);
    check(stopped.requests.length === 1 && Boolean(stopped.error) && stopped.cached === null, "Non-transient rejection or invalid identity must not be retried: " + failure);
  }

  async function captureRejectedAssignment(participantId, overrides) {
    try {
      await api.getOrCreateAssignment({
        config: productionConfig,
        overlays: productionOverlays,
        evaluationData: productionEvaluation,
        participantId,
        store: "A",
        location: remoteLocation,
        storage: memoryStorage(),
        document: assignmentDocument(overrides)
      });
      return null;
    } catch (error) {
      return error;
    }
  }
  const staleExperiment = await captureRejectedAssignment("STAL24", { experiment_id: "stale-experiment" });
  check(staleExperiment?.code === "INVALID_ASSIGNMENT_RESPONSE", "Assignments from a stale experiment endpoint must be rejected before caching");
  const staleAllocation = await captureRejectedAssignment("VERS24", { allocation_version: "old-allocation" });
  check(staleAllocation?.code === "INVALID_ASSIGNMENT_RESPONSE", "Assignments from a stale allocation version must be rejected before caching");
  const staleSchema = await captureRejectedAssignment("SCHE24", { schema_version: 1 });
  check(staleSchema?.code === "INVALID_ASSIGNMENT_RESPONSE", "Assignments using a stale schema version must be rejected before caching");
  const staleApp = await captureRejectedAssignment("APPS24", { app_version: "old-app" });
  check(staleApp?.code === "INVALID_ASSIGNMENT_RESPONSE", "Assignments from a stale app protocol must be rejected before caching");
  const wrongMethod = await captureRejectedAssignment("METH24", { assignment_method: "unknown_method" });
  check(wrongMethod?.code === "INVALID_ASSIGNMENT_RESPONSE", "Assignments using an unexpected allocation method must be rejected before caching");
  const wrongRun = await captureRejectedAssignment("RUNS24", { client_run_id: "different_client_run" });
  check(wrongRun?.code === "INVALID_ASSIGNMENT_RESPONSE", "Assignment responses must echo the current client run id");
  const unconfirmedAssignment = await captureRejectedAssignment("WAIT24", { status: "processing" });
  check(unconfirmedAssignment?.code === "INVALID_ASSIGNMENT_RESPONSE", "Unconfirmed assignment responses must be rejected before learning starts");
  const malformedAssignmentId = await captureRejectedAssignment("OPAQ24", { assignment_id: "bad id" });
  check(malformedAssignmentId?.code === "INVALID_ASSIGNMENT_RESPONSE", "Malformed opaque assignment ids must be rejected before caching");
  const missingIdentity = await captureRejectedAssignment("MISS24", { store_id: null });
  check(missingIdentity?.code === "INVALID_ASSIGNMENT_RESPONSE", "Assignment responses must carry explicit participant and store identity");
  const invalidAssignedAt = await captureRejectedAssignment("TIME24", { assigned_at: "not-a-date" });
  check(invalidAssignedAt?.code === "INVALID_ASSIGNMENT_RESPONSE", "Assignment responses must carry a valid assignment timestamp");
  for (const change of [{ participant_token: null }, { participant_token: "bad" }, { session_id: "other_session_001" }]) {
    const rejected = await captureRejectedAssignment("CAPS24", change);
    check(rejected?.code === "INVALID_ASSIGNMENT_RESPONSE" && !JSON.stringify(rejected).includes("b".repeat(64)), "Malformed capability/session response is rejected without embedding credentials in errors");
  }

  function receiptDocument(overrides = {}) {
    return {
      createElement() { return { async: false, src: "", parentNode: null, onerror: null }; },
      head: {
        appendChild(script) {
          script.parentNode = { removeChild() {} };
          const requestUrl = new URL(script.src);
          check(requestUrl.searchParams.get("participant_token") === "b".repeat(64) && requestUrl.searchParams.get("session_id") === "session_test_001", "Receipt lookup carries the scoped capability and bound session");
          const callback = requestUrl.searchParams.get(receiptConfig.jsonp.callbackParameter);
          context[callback](Object.assign({
          ok: true,
          action: "receipt",
          schema_version: receiptConfig.schemaVersion,
          found: true,
          status: "complete",
          duplicate: true,
          identity_checked: true,
          identity_match: true,
          conflict: false,
          submission_id: "submit_test_001",
          experiment_id: receiptConfig.experimentId,
          allocation_version: receiptConfig.allocationVersion,
          assignment_id: "assignment_test_001",
          participant_id_normalized: "BIKE33",
          store_id: "A",
          condition: "original",
          completed_at: "2026-08-24T10:00:00.000Z"
          }, overrides));
        }
      }
    }
  }
  const receipt = await api.getSubmissionReceipt({
    config: receiptConfig,
    submissionId: "submit_test_001",
    participantId: "bike33",
    storeId: "A",
    condition: "original",
    assignmentId: "assignment_test_001",
    sessionId: "session_test_001",
    participantToken: "b".repeat(64),
    location: { hostname: "example.test", href: "https://example.test/", search: "" },
    document: receiptDocument()
  });
  check(receipt.complete && receipt.status === "complete", "Opaque POST delivery must be confirmed through the readable receipt API");

  async function captureRejectedReceipt(overrides) {
    try {
      await api.getSubmissionReceipt({
        config: receiptConfig,
        submissionId: "submit_test_001",
        participantId: "BIKE33",
        storeId: "A",
        condition: "original",
        assignmentId: "assignment_test_001",
        sessionId: "session_test_001",
        participantToken: "b".repeat(64),
        location: { hostname: "example.test", href: "https://example.test/", search: "" },
        document: receiptDocument(overrides)
      });
      return null;
    } catch (error) {
      return error;
    }
  }
  check((await captureRejectedReceipt({ schema_version: 1 }))?.code === "INVALID_RECEIPT_RESPONSE", "Receipt responses from a stale schema must be rejected");
  check((await captureRejectedReceipt({ allocation_version: "old-allocation" }))?.code === "INVALID_RECEIPT_RESPONSE", "Receipt responses from another allocation version must be rejected");
  check((await captureRejectedReceipt({ identity_match: false }))?.code === "INVALID_RECEIPT_RESPONSE", "Receipt completion requires an explicit matching identity proof");

  const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
  async function completionTransportFixture(outcome, receiptComplete = true) {
    const timers = new Map(), posts = [], receipts = [], pending = new Map();
    let nextTimer = 0;
    const payload = {submission_id:"submission_transport_fixture", participant_id_normalized:"POST02", store_id:"C", condition:"original",
      allocation:{assignment_id:"assignment_transport_fixture"}, session_id:"session_transport_fixture", participant_token:"d".repeat(64)};
    const transport = {
      AbortController, LOG_ENDPOINT:"https://fixture.invalid/exec", IS_LOCAL:false,
      EXPERIMENT_CONFIG:{jsonp:{timeoutMs:45000}, localhost:{disableNetwork:false}, logging:{receiptPollAttempts:2, receiptPollDelayMs:1}},
      window:{location:{hostname:"fixture.invalid"}, setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, {fn, delay}); if(delay < 1000) queueMicrotask(() => { timers.delete(id); fn(); }); return id; }, clearTimeout(id) { timers.delete(id); }},
      buildCompletionPayload:() => payload,
      savePendingSubmission(value, attempts = 0, lastError = "") { pending.set(value.submission_id, {value, attempts, lastError}); return true; },
      clearPendingSubmission:id => pending.delete(id),
      EXPERIMENT:{async getSubmissionReceipt(request) { receipts.push(request); return {complete:receiptComplete, status:receiptComplete ? "complete" : "missing"}; }},
      fetch(endpoint, options) {
        posts.push({endpoint, options});
        if(outcome === "reject") return Promise.reject(new Error("fixture network failure"));
        if(outcome === "timeout") return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("fixture abort")), {once:true}));
        return Promise.resolve({type:"opaque"});
      }
    };
    vm.runInNewContext(appSource.slice(appSource.indexOf("async function postPayload("), appSource.indexOf("let pendingRetryInProgress")), transport);
    const sending = transport.sendCompletionLog();
    check(posts.length === 1 && pending.has(payload.submission_id), "Completion saves one pending payload before its only POST: " + outcome);
    check([...timers.values()].some(timer => timer.delay === 45000), "Completion POST has a bounded 45-second timeout: " + outcome);
    if(outcome === "timeout") [...timers.values()][0].fn();
    const result = await sending;
    check(timers.size === 0, "Completion POST timer is released after success, failure or abort: " + outcome);
    check(posts.length === 1 && receipts.length === (receiptComplete ? 1 : 2), "Receipt checking continues after an ambiguous POST without another POST: " + outcome);
    check(posts[0].options.mode === "no-cors" && posts[0].options.credentials === "omit" && posts[0].options.referrerPolicy === "no-referrer", "Completion transport keeps anonymous no-referrer delivery: " + outcome);
    check(receipts.every(request => request.submissionId === payload.submission_id && request.sessionId === payload.session_id && request.assignmentId === payload.allocation.assignment_id && request.participantToken === payload.participant_token), "Receipt polling retains the exact pending submission identity: " + outcome);
    check(result.status === (receiptComplete ? "sent" : "pending") && pending.has(payload.submission_id) === !receiptComplete, "Only a confirmed receipt removes the pending completion: " + outcome);
    if(outcome === "timeout") check(posts[0].options.signal.aborted, "A hung completion POST is actually aborted");
    if(!receiptComplete) check(pending.get(payload.submission_id).value === payload && pending.get(payload.submission_id).attempts === 1, "Unconfirmed completion retains the original payload for later retry");
  }
  await completionTransportFixture("success");
  await completionTransportFixture("reject");
  await completionTransportFixture("timeout");
  await completionTransportFixture("timeout", false);
  const informationContext = {
    EXPERIMENT_CONFIG: {studyInformation: json(validStudyInformation)},
    window: {BTS_PUBLIC_STUDY_INFORMATION: {validate: info => validateStudyInformation(info, informationNow)}},
    IS_LOCAL: false, state: {lang: "ja"},
    escapeHtml: value => String(value).replace(/[&<>"']/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[char]))
  };
  vm.runInNewContext(appSource.slice(appSource.indexOf("function studyInformationErrors()"), appSource.indexOf("let bootstrapError")) + appSource.slice(appSource.indexOf("function renderStudyInformation()"), appSource.indexOf("function renderPreSurvey()")), informationContext);
  check(informationContext.requireStudyInformation() === undefined, "Configured public study information permits the start guard");
  const japaneseInformation = informationContext.renderStudyInformation();
  check(japaneseInformation.includes("確認用研究者") && japaneseInformation.includes("fixture@research.invalid") && japaneseInformation.includes("研究者本人のみ") && japaneseInformation.split("取得日から6か月").length === 4 && japaneseInformation.includes("自動削除しません"), "Japanese pre-consent notice displays public identity/contact, separate six-month periods, and researcher-managed rather than automatic deletion");
  informationContext.state.lang = "en";
  check(informationContext.renderStudyInformation().includes("Fixture researcher") && informationContext.renderStudyInformation().includes("The researcher only") && informationContext.renderStudyInformation().split("6 calendar months from acquisition").length === 4 && informationContext.renderStudyInformation().includes("does not delete data automatically"), "English pre-consent notice provides the same operational information");
  informationContext.EXPERIMENT_CONFIG.studyInformation.researcherName.en = '<img src=x onerror="bad()">';
  const escapedInformation = informationContext.renderStudyInformation();
  check(escapedInformation.includes("&lt;img") && !escapedInformation.includes("<img") && !escapedInformation.includes("mailto:"), "Public operational values are rendered as escaped text, not HTML or active URL input");
  informationContext.EXPERIMENT_CONFIG.studyInformation = {};
  let studyGuardError;
  try { informationContext.requireStudyInformation(); } catch(error) { studyGuardError = error; }
  check(studyGuardError?.code === "STUDY_INFORMATION_NOT_READY", "Missing operational information blocks the public participation guard before assignment");
  informationContext.IS_LOCAL = true;
  check(informationContext.requireStudyInformation() === undefined && informationContext.renderStudyInformation().includes("Local preview") && informationContext.renderStudyInformation().includes("not configured"), "Local preview remains usable and explicitly marks pending operational information");
  informationContext.state.lang = "ja";
  check(informationContext.renderStudyInformation().includes("準備中") && informationContext.renderStudyInformation().includes("本番の参加受付は開始できません"), "Japanese local preview does not imply readiness or invented retention dates");
  check(appSource.indexOf("requireStudyInformation();", appSource.indexOf("async function submitPreSurvey")) < appSource.indexOf("state.participantId =", appSource.indexOf("async function submitPreSurvey")), "Submit rechecks the operational guard before reading responses or requesting an assignment");
  check(appSource.indexOf("${renderStudyInformation()}") < appSource.indexOf('<input id="participant"'), "Operational information appears before identity and consent inputs");
  const experimentContextSource = fs.readFileSync(path.join(root, "experiment-context.js"), "utf8");
  const loggingSource = `${appSource}\n${experimentContextSource}`;
  [
    "schema_version", "submission_id", "participant_id_normalized", "store_id", "condition",
    "experiment_date", "start_time", "end_time", "question_logs", "phase: \"learning\"",
    "answer_change_count", "explanation_view_time_ms", "mode: \"no-cors\"",
    "getSubmissionReceipt", "listPendingSubmissions", "retryPendingSubmissions"
  ].forEach(fragment => check(loggingSource.includes(fragment), `Required app/log field missing: ${fragment}`));
  check(!appSource.includes("questionSelectionHistory.length - 1"), "Answer construction must not be misreported as answer changes");
  check(appSource.includes("INTRO_ADVANCE_LOCK_MS = 500"), "Intro navigation must retain a real double-click lock window");
  check(!appSource.includes("introAdvanceLocked = false; }, 0"), "Intro double-click lock must not be released on the next event-loop tick");
  check(appSource.includes('document.documentElement.lang = state.lang === "en" ? "en" : "ja"'), "Restored English sessions must restore the document language");
  check(appSource.includes("textOf(q.sceneDescription).trim()"), "Whitespace-only A scene descriptions must not render");
  check(appSource.includes("textOf(q[field]).trim()"), "Whitespace-only C support fields must not render");
  check(appSource.includes("textOf(q.explanationImage).trim()"), "Whitespace-only C image paths must not render");
  check(appSource.includes('role="alert" tabindex="-1"'), "Question validation errors must be announced and focusable");
  check(appSource.includes('class="error-summary" role="alert" tabindex="-1"'), "Survey error summaries must be announced and focusable");
  check(!appSource.slice(appSource.indexOf("function downloadCsv()"), appSource.indexOf("function suspendActiveTiming()")).match(/participant_token|participantToken/), "CSV exports never include the participant capability");
  check(appSource.includes('console.error("Condition assignment failed", error?.code || "ASSIGNMENT_FAILED")'), "Assignment errors do not print capability-bearing server objects");
  check(appSource.includes("Googleフォームの原回答") && appSource.includes("scoped credential for matching participation") && appSource.includes("per-question response time"), "Bilingual consent discloses Forms credential handling and unavailable per-item timing");
  check(appSource.includes("共有端末") && appSource.includes("On a shared device"), "Bilingual shared-device cleanup guidance is visible");
  const cleanupCalls = { assignment: 0, pending: 0, session: 0, writes: 0, alerts: 0, reloads: 0 };
  const cleanupContext = { IS_LOCAL: false, sessionEnding: false, SESSION_STORAGE_KEY: "fixture-session", STORE_ID: "A", state: { participantId: "TEST01", submissionId: "fixture_submission_001", lang: "ja", logDeliveryStatus: "pending", screen: "final" },
    EXPERIMENT: { validateParticipantId: () => true, clearCachedAssignment: () => cleanupCalls.assignment++ },
    clearPendingSubmission: () => cleanupCalls.pending++, clearSessionState: () => cleanupCalls.session++,
    sessionStorage: { setItem: () => cleanupCalls.writes++, getItem: () => "" }, Date,
    window: { alert: () => cleanupCalls.alerts++, location: { reload: () => { cleanupCalls.reloads++; cleanupContext.suspendActiveTiming(); cleanupContext.persistState(); } } } };
  vm.runInNewContext(appSource.slice(appSource.indexOf("function restartExperiment()"), appSource.indexOf("function sharedDeviceMessage()")) + appSource.slice(appSource.indexOf("function persistState()"), appSource.indexOf("function clearSessionState()")) + appSource.slice(appSource.indexOf("function suspendActiveTiming()"), appSource.indexOf('window.addEventListener("beforeunload"')), cleanupContext);
  cleanupContext.restartExperiment();
  check(cleanupCalls.alerts === 1 && cleanupCalls.assignment === 0 && cleanupCalls.pending === 0 && cleanupCalls.reloads === 0, "Ending an unconfirmed session does not destroy pending responses or retry credentials");
  cleanupContext.state.logDeliveryStatus = "sent";
  cleanupContext.restartExperiment();
  check(cleanupCalls.assignment === 1 && cleanupCalls.pending === 1 && cleanupCalls.session === 1 && cleanupCalls.reloads === 1, "Confirmed session end clears scoped assignment and retry/session data");
  check(cleanupCalls.writes === 0, "beforeunload or a late state callback cannot re-persist credentials after session cleanup");

  const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const scriptOrder = ["data.js", "experiment-config.js", "condition-overlays.js", "evaluation-data.js", "experiment-context.js", "app.js"];
  let lastIndex = -1;
  for (const script of scriptOrder) {
    const index = indexSource.indexOf(script);
    check(index > lastIndex, `Script load order is wrong at ${script}`);
    lastIndex = index;
  }

  const gasPath = path.join(root, "gas", "Code.gs");
  if (fs.existsSync(gasPath)) {
    const gas = fs.readFileSync(gasPath, "utf8");
    ["LockService", "Assignments", "QuestionLogs", "SubmissionReceipts", "submission_id", "doGet", "doPost", "receipt"].forEach(fragment => {
      check(gas.includes(fragment), `GAS implementation is missing ${fragment}`);
    });
  }

  console.log(`PASS: ${assertions} assertions`);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
