"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const release = require("../scripts/release-lib.js");

let assertions = 0;
function check(condition, message) { assert.ok(condition, message); assertions += 1; }
function rejects(fn, pattern, message) { assert.throws(fn, pattern, message); assertions += 1; }
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bts-release-test-"));
function put(relative, content) {
  const target = path.join(temporaryRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function script(name, value) {
  // Reuse the shipped shared validator, then supply explicit fixture settings.
  const validation = name === "EXPERIMENT_CONFIG" ? fs.readFileSync(path.join(__dirname, "../experiment-config.js"), "utf8") : "";
  return validation + "\nwindow." + name + " = " + JSON.stringify(value) + ";\n";
}
const config = {
  schemaVersion: 2, appVersion: "fixture.1", experimentId: "fixture", allocationVersion: "allocation-fixture",
  contentVersion: "fixture-content-v2", commonCorrectionVersion: "fixture-correction-v1",
  serverEndpoint: "https://script.google.com/macros/s/RELEASE_FIXTURE_ONLY/exec",
  deploymentUrl: "https://release-fixture.github.io/study/",
  followupMode: "google_forms",
  studyInformation: {
    researcherName: {ja: "試験用研究者", en: "Fixture researcher"},
    contactEmail: "fixture@research.invalid",
    retentionMonths: {contact: 6, rawResponses: 6, analysisData: 6},
    ownerOnlyAccess: true
  }
};
const evaluation = {
  instrumentVersion: "fixture-instrument-v1",
  extensions: { followup: { ja: [{ id: "f1", title: "日本語", type: "single", choices: ["A", "B"] }], en: [{ id: "f1", title: "English", type: "single", choices: ["A", "B"] }] } },
  futureItems: { followup: { ja: [], en: [] } }, answerKeys: { followup: { f1: "B" } }, researcherApprovals: {}
};
try {
  check(release.canonicalJson({ z: 1, a: { b: 2, a: 1 } }) === '{"a":{"a":1,"b":2},"z":1}', "Canonical JSON must recursively sort object keys");
  check(release.canonicalJson(["B", "A"]) === '["B","A"]', "Canonical JSON must preserve instrument item and answer order");
  rejects(() => release.safeFile(temporaryRoot, "../secret"), /Unsafe/, "Release paths must reject parent traversal");
  rejects(() => release.safeFile(temporaryRoot, "assets/../../secret"), /Unsafe/, "Nested parent traversal must be rejected");
  check(release.stripTestHelpers("before;\n// BTS_TEST_HELPERS_BEGIN\nwindow.__BTS_LATE_TEST__={};\n// BTS_TEST_HELPERS_END\nafter;") === "before;\n\nafter;", "Release must remove the entire explicitly marked helper block");
  rejects(() => release.stripTestHelpers("window.__BTS_LATE_TEST__={};"), /Unmarked/, "Unmarked browser helpers must block a release");
  rejects(() => release.stripTestHelpers("// BTS_TEST_HELPERS_BEGIN"), /Unbalanced/, "Missing end markers must block a release");
  rejects(() => release.stripTestHelpers("// BTS_TEST_HELPERS_END\n// BTS_TEST_HELPERS_BEGIN"), /Reversed/, "Reversed helper markers must block a release");

  put("data.js", script("APP_DATA", { config: { logEndpoint: "https://script.google.com/macros/s/OLD_FIXTURE_ONLY/exec" }, questions: [{ id: "q1", image: "scene.png", title: { ja: "Frozen question", en: "Frozen question" } }], survey: { ja: [{ id: "pre1", title: "Frozen pre item" }], en: [{ id: "pre1", title: "Frozen pre item" }] }, postSurvey: { ja: [], en: [] } }));
  const correctionSource = script("COMMON_CORRECTIONS", { version: "fixture-correction-v1", contentVersion: "fixture-content-v2", baselineVariant: "corrected-common", learning: { q1: { title: { ja: "Corrected question", en: "Corrected question" } } }, sources: [{ title: "Fixture legal source" }] }) + 'window.FROZEN_APP_DATA=window.APP_DATA;window.APP_DATA=JSON.parse(JSON.stringify(window.FROZEN_APP_DATA));window.APP_DATA.questions[0].title=window.COMMON_CORRECTIONS.learning.q1.title;window.APP_DATA.survey.ja[0].title="Corrected pre item";window.APP_DATA.survey.en[0].title="Corrected pre item";\n';
  put("common-corrections.js", correctionSource);
  put("experiment-config.js", script("EXPERIMENT_CONFIG", config));
  put("condition-overlays.js", script("CONDITION_OVERLAYS", { conditions: { original: {}, no_image: { readyForProduction: true, questions: {} }, improved: { readyForProduction: true, questions: { q1: { explanationImage: "assets/transfer.svg" } } } } }));
  put("evaluation-data.js", script("EVALUATION_DATA", evaluation));
  put("experiment-context.js", "window.EXPERIMENT_CONTEXT = {getReadinessReport:function(options){return {ready:true,production:options.production,errors:[]};},mergeSurveyItems:function(base,phase,options){return base.concat(window.EVALUATION_DATA.extensions[phase]?.[options.language]||[],window.EVALUATION_DATA.futureItems[phase]?.[options.language]||[]);}};\n");
  for (const file of ["app.js", "followup-app.js", "connection-check.js"]) put(file, "window.loaded=true;\n// BTS_TEST_HELPERS_BEGIN\nwindow.__BTS_LATE_TEST__ = {};\n// BTS_TEST_HELPERS_END\n");
  for (const file of ["styles.css", "condition-styles.css"]) put(file, "body { color: black; }\n");
  const indexHtml = '<!doctype html><html><head>' + ["data.js", "common-corrections.js", "experiment-config.js", "condition-overlays.js", "evaluation-data.js", "experiment-context.js", "app.js"].map(file => '<script src="./' + file + '"></script>').join("") + '</head><body><div id="app"></div></body></html>';
  for (const file of ["index.html", "followup.html"]) put(file, indexHtml);
  const connectionHtml = '<!doctype html><html><head><script src="./experiment-config.js"></script><script src="./connection-check.js"></script></head><body>Connection check only</body></html>';
  put("connection-check.html", connectionHtml);
  put("assets/scene.png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Review figure</text></svg>';
  put("assets/transfer.svg", svg);
  put("assets/unreferenced-secret.txt", "DO NOT SHIP");
  put("docs/private.md", "DO NOT SHIP");
  put("gas/Code.gs", "DO NOT SHIP");
  put("gas/Forms.gs", "DO NOT SHIP");
  put("gas/Production.gs", "DO NOT SHIP");
  put("gas/FormsProduction.gs", "DO NOT SHIP");
  put("raw-data/responses.json", "DO NOT SHIP");
  put("gas/appsscript.json", "DO NOT SHIP");
  put("scripts/build-google-forms.js", "DO NOT SHIP");
  put("scripts/build-install-page.js", "DO NOT SHIP");
  put("dist/gas-install-fixture/index.html", "DO NOT SHIP");
  put("tests/secret.json", "DO NOT SHIP");
  const manifest = { files: ["data.js", "styles.css", "assets/scene.png"].map(relative => {
    const content = fs.readFileSync(path.join(temporaryRoot, relative));
    put("baseline-original/" + relative, content);
    return { path: relative, sha256: release.sha256(content), bytes: content.length };
  }) };
  put("baseline-manifest.json", JSON.stringify(manifest));
  const context = release.loadExperiment(temporaryRoot);
  check(context.APP_DATA.questions[0].title.ja === "Corrected question" && context.FROZEN_APP_DATA.questions[0].title.ja === "Frozen question", "Release loader must apply common corrections to a copy while keeping frozen data intact");
  check(release.sharedSurveyContent(context).pre.ja[0].title === "Corrected pre item", "Effective review surveys must show corrected base content");
  const reviewedContent = release.reviewContent(context, manifest, temporaryRoot);
  check(reviewedContent.commonCorrections.version === "fixture-correction-v1" && reviewedContent.correctedBase.questions[0].title.en === "Corrected question", "Review digest must include correction metadata and corrected comparison baseline");
  check(reviewedContent.commonCorrectionsSourceSha256 === release.sha256(correctionSource), "Review digest must bind the actual correction source bytes");
  const expectedInstrument = { instrumentVersion: evaluation.instrumentVersion, items: evaluation.extensions.followup, answerKeys: evaluation.answerKeys.followup };
  check(release.followupInstrumentSha256(context) === release.sha256(release.canonicalJson(expectedInstrument)), "Followup digest must match the GAS canonical instrument contract");
  const changedInstrument = JSON.parse(JSON.stringify(expectedInstrument));
  changedInstrument.answerKeys.f1 = "A";
  check(release.sha256(release.canonicalJson(changedInstrument)) !== release.followupInstrumentSha256(context), "Followup digest must bind scoring keys, not only item text");
  const properties = release.gasScriptProperties(context);
  check(properties.BTS_FOLLOWUP_QUESTION_IDS === "f1" && properties.BTS_FOLLOWUP_OPTIONAL_QUESTION_IDS === "", "GAS question IDs must derive from current ordered non-notice items");
  check(properties.BTS_PUBLIC_APP_URL === config.deploymentUrl && properties.BTS_FOLLOWUP_INSTRUMENT_HASH === release.followupInstrumentSha256(context) && !Object.hasOwn(properties, "BTS_FOLLOWUP_TOKEN_SECRET"), "Exported GAS properties must bind current public URL and instrument without inventing or exporting a secret");
  const template = release.reviewTemplate(context, manifest, temporaryRoot);
  check(template.reviewer === "" && template.reviewedAt === "" && Object.values(template.approvals).every(value => value === false), "Generated template must never fabricate approval");
  const productionTemplate = release.productionPropertiesTemplate(temporaryRoot);
  const productionConfig = JSON.parse(productionTemplate.BTS_PRODUCTION_CONFIG);
  const productionReview = JSON.parse(productionTemplate.BTS_PRODUCTION_REVIEW);
  check(productionTemplate.BTS_HTTP_MODE === "disabled" && productionTemplate.BTS_PRODUCTION_ENABLED === "false" && productionTemplate.BTS_EMAIL_ENABLED === "false", "Production preparation template never enables HTTP, enrollment, or email");
  check(productionConfig.contentHash === template.contentSha256 && productionConfig.instrumentHash === properties.BTS_FOLLOWUP_INSTRUMENT_HASH && productionConfig.followupMode === "google_forms" && productionConfig.appVersion === config.appVersion, "Production template binds exact client versions and content/instrument hashes");
  check(productionConfig.spreadsheetId === "" && productionConfig.opensAt === "" && productionConfig.enrollmentClosesAt === "" && productionConfig.closesAt === "" && productionConfig.maxAssignments === null && productionConfig.maxDailyAssignments === null, "Preparation never invents a storage destination, enrollment window, or sample size");
  check(productionReview.reviewer === "" && productionReview.reviewedAt === "" && Object.values(productionReview.approvals).every(value => value === false) && Object.keys(productionTemplate).every(key => !/SECRET|TOKEN/.test(key)), "Preparation never fabricates research review or exports credentials");
  const now = Date.parse("2026-09-15T10:00:00Z");
  const record = { ...template, reviewer: "Fixture reviewer", reviewedAt: "2026-09-15T09:00:00Z", approvals: Object.fromEntries(release.REVIEW_APPROVALS.map(key => [key, true])) };
  check(release.validateReview(record, template.contentSha256, now).length === 0, "A genuine-shaped complete review record can pass");
  check(release.validateReview({ ...record, reviewer: " " }, template.contentSha256, now).length > 0, "A blank reviewer must block production");
  check(release.validateReview({ ...record, reviewedAt: "2026-09-16T00:00:00Z" }, template.contentSha256, now).length > 0, "Future-dated review must block production");
  check(release.validateReview(record, "changed-content", now).length > 0, "Stale content approval must block production");
  check(release.validateReview({ ...record, approvals: { ...record.approvals, improvedContent: false } }, template.contentSha256, now).length > 0, "Missing content approval must block production");
  check(release.analyze(temporaryRoot, { mode: "preview", now }).ready, "Local preview can build without pretending production approval");
  check(!release.analyze(temporaryRoot, { mode: "production", now }).ready, "Production without a review record must fail closed");
  check(release.analyze(temporaryRoot, { mode: "production", review: record, now }).ready, "A complete production fixture can pass every release gate");
  put("connection-check.html", connectionHtml.replace('./connection-check.js', 'https://outside.invalid/connection.js'));
  check(release.analyze(temporaryRoot, { mode: "preview", now }).errors.some(error => error.includes("connection-check.html references a resource outside")), "Diagnostic resources must obey the same public release allowlist");
  put("connection-check.html", connectionHtml.replace('./connection-check.js', './app.js'));
  check(release.analyze(temporaryRoot, { mode: "preview", now }).errors.some(error => error.includes("non-writing diagnostic once in order")), "Connection diagnostics must not silently load the participation app");
  put("connection-check.html", connectionHtml);
  put("experiment-config.js", script("EXPERIMENT_CONFIG", { ...config, studyInformation: {} }));
  const missingStudyInformation = release.analyze(temporaryRoot, { mode: "production", review: record, now });
  check(missingStudyInformation.errors.some(error => error.includes("studyInformation.researcherName.ja")), "Production requires participant-visible researcher/contact/retention information independently of content adoption");
  check(missingStudyInformation.contentSha256 === template.contentSha256 && !missingStudyInformation.errors.some(error => error.includes("contentSha256 does not match")), "Changing public operational information does not invalidate the adopted content hash");
  const unconfiguredPreview = release.analyze(temporaryRoot, { mode: "preview", now });
  check(unconfiguredPreview.ready && !unconfiguredPreview.productionReady && unconfiguredPreview.warnings.some(error => error.includes("studyInformation")), "Local review preview remains available while public operational information is incomplete");
  put("experiment-config.js", "window.EXPERIMENT_CONFIG=" + JSON.stringify(config) + ";");
  check(release.analyze(temporaryRoot, { mode: "production", review: record, now }).errors.some(error => error.includes("validation is missing")), "A missing shared validator cannot bypass the public-information release gate");
  put("experiment-config.js", script("EXPERIMENT_CONFIG", config));
  put("index.html", indexHtml.replace('<script src="./common-corrections.js"></script>', ""));
  check(release.analyze(temporaryRoot, { mode: "preview", now }).errors.some(error => error.includes("once in order")), "Shipping the correction file without actually loading it must block a release");
  put("index.html", indexHtml.replace('<script src="./common-corrections.js">', '<script async src="./common-corrections.js">'));
  check(release.analyze(temporaryRoot, { mode: "preview", now }).errors.some(error => error.includes("once in order")), "Async common correction loading must block a release because it can race APP_DATA consumers");
  put("index.html", indexHtml);
  put("common-corrections.js", correctionSource + "// Changed correction source\n");
  check(release.analyze(temporaryRoot, { mode: "production", review: record, now }).errors.some(error => error.includes("contentSha256 does not match")), "Changing correction source bytes must invalidate an existing approval");
  put("common-corrections.js", correctionSource);
  put("assets/transfer.svg", svg.replace("Review figure", "Changed figure"));
  check(release.analyze(temporaryRoot, { mode: "production", review: record, now }).errors.some(error => error.includes("contentSha256 does not match")), "Changing a new SVG byte must invalidate the content approval even when its path is unchanged");
  put("assets/transfer.svg", svg);
  put("evaluation-data.js", script("EVALUATION_DATA", { ...evaluation, contentReviewIssues: [{ id: "law-mismatch", severity: "blocking", status: "open" }] }));
  check(release.analyze(temporaryRoot, { mode: "production", review: record, now }).errors.some(error => error.includes("Unresolved blocking content issue")), "An unresolved factual issue must block production independently of reviewer booleans");
  put("evaluation-data.js", script("EVALUATION_DATA", evaluation));
  const preview = release.build(temporaryRoot, { mode: "preview", now });
  const previewHtml = fs.readFileSync(path.join(preview.directory, "index.html"), "utf8");
  check(previewHtml.includes("研究内容確認用プレビュー") && previewHtml.includes("connect-src 'none'") && previewHtml.includes("form-action 'none'"), "Preview must visibly identify itself and block outbound connections and forms");
  let onReady;
  let policy;
  let blockedMessage;
  const guardSandbox = {
    location: { hostname: "not-local.github.io" }, window: {}, navigator: { sendBeacon() { return true; } }, XMLHttpRequest: function () {},
    document: {
      createElement() { return { style: {} }; },
      head: { appendChild(element) { policy = element; } },
      body: { replaceChildren(element) { blockedMessage = element; } },
      addEventListener(event, handler) { if (event === "DOMContentLoaded") onReady = handler; }
    }
  };
  vm.runInNewContext(previewHtml.match(/<script>([\s\S]*?)<\/script>/)[1], guardSandbox);
  onReady();
  check(policy.content === "script-src 'none'" && blockedMessage.textContent.includes("ローカルプレビュー専用"), "Nonlocal preview must block both entry pages without assuming an app container exists");
  check(guardSandbox.navigator.sendBeacon() === false, "Preview must disable beacon sends");
  check(!fs.readFileSync(path.join(preview.directory, "app.js"), "utf8").includes("__BTS_LATE_TEST__"), "Preview artifact must exclude test helpers too");
  for (const excluded of ["docs", "tests", "gas", "gas/Forms.gs", "gas/Production.gs", "gas/FormsProduction.gs", "gas/appsscript.json", "raw-data", "scripts", "dist", "dist/gas-install-fixture/index.html", "baseline-original", "baseline-manifest.json", "assets/unreferenced-secret.txt"]) check(!fs.existsSync(path.join(preview.directory, excluded)), "Build must exclude " + excluded);
  check(fs.existsSync(path.join(preview.directory, "followup.html")) && fs.existsSync(path.join(preview.directory, "followup-app.js")), "Followup page and application must ship together");
  check(fs.existsSync(path.join(preview.directory, "connection-check.html")) && fs.existsSync(path.join(preview.directory, "connection-check.js")), "Non-writing public connection diagnostics must ship together");
  check(fs.readFileSync(path.join(preview.directory, "common-corrections.js"), "utf8") === correctionSource, "Public build must include the common correction layer");
  check(preview.manifest.files.every(file => release.sha256(fs.readFileSync(path.join(preview.directory, file.path))) === file.sha256), "Artifact manifest must match every shipped byte");
  check(preview.manifest.contentVersion === config.contentVersion && preview.manifest.commonCorrectionVersion === config.commonCorrectionVersion && preview.manifest.baselineVariant === "corrected-common", "Release manifest must identify the corrected content and comparison-baseline versions");
  check(preview.manifest.followupMode === "google_forms", "Release manifest makes Forms-only follow-up explicit");
  const review = release.writeReview(temporaryRoot, { now: now + 1000 });
  const researchReview = fs.readFileSync(path.join(review.directory, "research-review.html"), "utf8");
  check(researchReview.includes("Corrected question") && researchReview.includes("Corrected pre item") && researchReview.includes("共通訂正後の比較基準"), "Review page must display effective corrected learning and shared survey content");
  check(researchReview.includes("google_forms") && researchReview.includes("no per-item response time"), "Review page discloses Forms-only follow-up and measurement limitations");
  check(JSON.parse(fs.readFileSync(path.join(review.directory, "production-script-properties.template.json"), "utf8")).BTS_HTTP_MODE === "disabled", "Private review artifact contains only disabled production preparation settings");
  check(researchReview.includes("Frozen question") && researchReview.includes("後期の表示基準ではない"), "Review page must identify frozen content as archive rather than the current B baseline");
  check(fs.readFileSync(path.join(review.directory, "assets/transfer.svg"), "utf8") === svg, "Review artifact must freeze a visible copy of the actual SVG");
  check(JSON.parse(fs.readFileSync(path.join(review.directory, "gas-script-properties.template.json"), "utf8")).BTS_FOLLOWUP_QUESTION_IDS === "f1", "Review artifact must include matching non-secret GAS properties");
  rejects(() => release.build(temporaryRoot, { mode: "preview", now }), /EEXIST/, "Build must not overwrite an existing release directory");
  const production = release.build(temporaryRoot, { mode: "production", review: record, now: now + 1000 });
  check(!fs.readFileSync(path.join(production.directory, "index.html"), "utf8").includes("Preview network disabled"), "Production artifact must not accidentally contain preview network guards");
  put("experiment-config.js", script("EXPERIMENT_CONFIG", { ...config, followupMode: "web_token" }));
  const oldMode = release.analyze(temporaryRoot, { mode: "production", review: record, now });
  check(oldMode.errors.some(error => error.includes("followupMode must be google_forms")), "Public release cannot silently re-enable Web follow-up collection");
  check(oldMode.errors.some(error => error.includes("contentSha256 does not match")), "Follow-up mode change invalidates the content-bound review record");
  put("experiment-config.js", script("EXPERIMENT_CONFIG", { ...config, serverEndpoint: "https://script.google.com/macros/s/OLD_FIXTURE_ONLY/exec" }));
  check(release.analyze(temporaryRoot, { mode: "production", review: record, now }).errors.some(error => error.includes("first-term")), "Reusing first-term GAS must block production");
  put("experiment-config.js", script("EXPERIMENT_CONFIG", { ...config, deploymentUrl: "http://localhost:8765/" }));
  check(release.analyze(temporaryRoot, { mode: "production", review: record, now }).errors.some(error => error.includes("actual HTTPS")), "A localhost production URL must be rejected");
  put("experiment-config.js", script("EXPERIMENT_CONFIG", config));
  put("assets/scene.png", "changed");
  check(release.analyze(temporaryRoot, { mode: "preview", now }).errors.some(error => error.includes("Frozen source mismatch")), "Changing frozen source assets must block every release mode");
  console.log(`PASS: ${assertions} release assertions`);
} finally {
  const resolved = path.resolve(temporaryRoot);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith("bts-release-test-")) throw new Error("Refusing unsafe fixture cleanup.");
  fs.rmSync(resolved, { recursive: true, force: true });
}
