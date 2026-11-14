"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");

const SITE_FILES = ["index.html", "followup.html", "connection-check.html", "connection-check.js", "styles.css", "condition-styles.css", "data.js", "common-corrections.js", "experiment-config.js", "condition-overlays.js", "evaluation-data.js", "experiment-context.js", "app.js", "followup-app.js"];
const CLASSIC_FILES = ["data.js", "common-corrections.js", "experiment-config.js", "condition-overlays.js", "evaluation-data.js", "experiment-context.js"];
const REVIEW_APPROVALS = ["noImageScenes", "improvedContent", "conditionNeutralPostSurvey", "lateEvaluationInstruments", "followupInstrumentAndUrl"];
const MARKER_BEGIN = "// BTS_TEST_HELPERS_BEGIN";
const MARKER_END = "// BTS_TEST_HELPERS_END";

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
function json(value) { return JSON.parse(JSON.stringify(value)); }
function read(root, relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }
function safeFile(root, relative) {
  const normalized = String(relative).replace(/\\/g, "/");
  if (!normalized || path.isAbsolute(normalized) || normalized.split("/").some(part => part === ".." || part === "." || !part)) throw new Error("Unsafe release path: " + relative);
  const full = path.resolve(root, normalized);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new Error("Path escapes release root: " + relative);
  let current = path.resolve(root);
  for (const part of normalized.split("/")) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Release symlinks are not allowed: " + relative);
  }
  return full;
}
function loadExperiment(root) {
  const location = { hostname: "localhost", href: "http://localhost/?store=A", search: "?store=A" };
  const sandbox = { URL, URLSearchParams, Uint8Array, Date, Math, JSON, Object, Array, Set, Map, Promise, console, setTimeout, clearTimeout, crypto: crypto.webcrypto, location };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  CLASSIC_FILES.forEach(file => vm.runInContext(read(root, file), context, { filename: file, timeout: 5000 }));
  return context;
}
function followupInstrument(context) {
  const evaluation = context.EVALUATION_DATA;
  const items = {};
  for (const language of ["ja", "en"]) items[language] = [...(evaluation.extensions?.followup?.[language] || []), ...(evaluation.futureItems?.followup?.[language] || [])];
  return { instrumentVersion: evaluation.instrumentVersion || "", items, answerKeys: evaluation.answerKeys?.followup || {} };
}
function followupInstrumentSha256(context) { return sha256(canonicalJson(followupInstrument(context))); }
function gasScriptProperties(context) {
  const instrument = followupInstrument(context);
  const questions = instrument.items.ja.filter(item => item.type !== "notice");
  return {
    BTS_PUBLIC_APP_URL: context.EXPERIMENT_CONFIG.deploymentUrl || "",
    BTS_FOLLOWUP_INSTRUMENT_VERSION: instrument.instrumentVersion,
    BTS_FOLLOWUP_INSTRUMENT_HASH: followupInstrumentSha256(context),
    BTS_FOLLOWUP_QUESTION_IDS: questions.map(item => item.id).join(","),
    BTS_FOLLOWUP_OPTIONAL_QUESTION_IDS: questions.filter(item => item.optional === true).map(item => item.id).join(",")
  };
}
function productionPropertiesTemplate(root) {
  const report = analyze(root, { mode: "preview" });
  const config = report.context.EXPERIMENT_CONFIG;
  return {
    ...gasScriptProperties(report.context),
    BTS_HTTP_MODE: "disabled", BTS_PRODUCTION_ENABLED: "false", BTS_EMAIL_ENABLED: "false",
    BTS_PRODUCTION_CONFIG: JSON.stringify({
      experimentId: config.experimentId, allocationVersion: config.allocationVersion, appVersion: config.appVersion,
      contentVersion: config.contentVersion, commonCorrectionVersion: config.commonCorrectionVersion,
      instrumentVersion: report.context.EVALUATION_DATA.instrumentVersion, followupMode: config.followupMode,
      contentHash: report.contentSha256, instrumentHash: report.followupInstrumentSha256,
      publicAppUrl: config.deploymentUrl || "", spreadsheetId: "", opensAt: "", enrollmentClosesAt: "", closesAt: "",
      maxAssignments: null, maxDailyAssignments: null
    }),
    BTS_PRODUCTION_REVIEW: JSON.stringify(report.reviewTemplate)
  };
}
function sharedSurveyContent(context) {
  const result = {};
  for (const phase of ["pre", "post", "followup"]) {
    result[phase] = {};
    for (const language of ["ja", "en"]) {
      const base = phase === "pre" ? context.APP_DATA.survey?.[language] : phase === "post" ? context.APP_DATA.postSurvey?.[language] : [];
      result[phase][language] = json(context.EXPERIMENT_CONTEXT.mergeSurveyItems(base || [], phase, { language }));
    }
  }
  return result;
}
function reviewContent(context, manifest, root) {
  const overlays = json(context.CONDITION_OVERLAYS);
  Object.values(overlays.conditions || {}).forEach(condition => { delete condition.readyForProduction; });
  const evaluation = json(context.EVALUATION_DATA);
  delete evaluation.readyForProduction;
  delete evaluation.researcherApprovals;
  delete evaluation.researchReview;
  delete evaluation.reviewRecord;
  const assets = root ? assetPaths(context).map(asset => {
    const relative = localReference(asset);
    const full = safeFile(root, relative);
    return { path: relative, sha256: fs.existsSync(full) ? sha256(fs.readFileSync(full)) : null };
  }) : [];
  return {
    experimentId: context.EXPERIMENT_CONFIG.experimentId,
    allocationVersion: context.EXPERIMENT_CONFIG.allocationVersion,
    contentVersion: context.EXPERIMENT_CONFIG.contentVersion || "",
    commonCorrectionVersion: context.EXPERIMENT_CONFIG.commonCorrectionVersion || "",
    followupMode: context.EXPERIMENT_CONFIG.followupMode || "",
    baselineVariant: context.COMMON_CORRECTIONS?.baselineVariant || "",
    baseline: manifest.files.map(file => ({ path: file.path, sha256: file.sha256 })),
    commonCorrections: json(context.COMMON_CORRECTIONS || null),
    commonCorrectionsSourceSha256: root ? sha256(fs.readFileSync(safeFile(root, "common-corrections.js"))) : null,
    correctedBase: json({ introCards: context.APP_DATA.introCards || [], questions: context.APP_DATA.questions || [], survey: context.APP_DATA.survey || {}, postSurvey: context.APP_DATA.postSurvey || {} }),
    sharedSurveys: sharedSurveyContent(context),
    assets,
    overlays,
    evaluation
  };
}
function reviewTemplate(context, manifest, root) {
  return { reviewer: "", reviewedAt: "", contentSha256: sha256(canonicalJson(reviewContent(context, manifest, root))), approvals: Object.fromEntries(REVIEW_APPROVALS.map(key => [key, false])) };
}
function validateReview(record, digest, now = Date.now()) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return ["Research review record is missing. Generate a template with --print-review-template."];
  if (typeof record.reviewer !== "string" || !record.reviewer.trim()) errors.push("Review record requires the actual reviewer name.");
  const timestamp = Date.parse(record.reviewedAt);
  if (typeof record.reviewedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(record.reviewedAt) || !Number.isFinite(timestamp) || timestamp > now) errors.push("Review record requires a valid past or current ISO timestamp with timezone.");
  if (record.contentSha256 !== digest) errors.push("Review record contentSha256 does not match the current research content.");
  for (const approval of REVIEW_APPROVALS) if (record.approvals?.[approval] !== true) errors.push("Review approval is missing: " + approval + ".");
  return errors;
}
function stripTestHelpers(source) {
  const begins = source.split(MARKER_BEGIN).length - 1;
  const ends = source.split(MARKER_END).length - 1;
  if (begins !== ends || begins > 1) throw new Error("Unbalanced test-helper release markers.");
  let clean = source;
  if (begins === 1) {
    const start = source.indexOf(MARKER_BEGIN);
    const end = source.indexOf(MARKER_END);
    if (end <= start) throw new Error("Reversed test-helper release markers.");
    clean = source.slice(0, start) + source.slice(end + MARKER_END.length);
  }
  if (clean.includes("__BTS_LATE_TEST__")) throw new Error("Unmarked test helpers must not enter release files.");
  return clean;
}
function assetPaths(context) {
  const found = new Set();
  function add(value) {
    if (typeof value === "string" && value.trim()) found.add(value.trim());
    else if (value && typeof value === "object") Object.values(value).forEach(add);
  }
  function visit(value, baseline) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "image" || key === "explanationImage") {
        // Frozen learning questions store only a filename; the original renderer
        // adds ./assets/. Overlay/evaluation image values are already full paths.
        add(baseline && key === "image" && typeof child === "string" && child && !child.includes("/") ? "./assets/" + child : child);
      } else visit(child, baseline);
    }
  }
  visit(context.APP_DATA, true);
  visit(context.CONDITION_OVERLAYS, false);
  visit(context.EVALUATION_DATA, false);
  return [...found].sort();
}
function localReference(value) {
  if (/^(?:https?:|data:|blob:|\/\/|#|mailto:)/i.test(value)) throw new Error("Release resource must be local: " + value);
  const decoded = decodeURIComponent(value.split(/[?#]/)[0]).replace(/^\.\//, "");
  if (!decoded || !/^assets\/[\w./-]+\.(?:png|jpe?g|webp|gif|svg)$/i.test(decoded)) throw new Error("Unsupported release asset: " + value);
  return decoded;
}
function validateUrls(context) {
  const config = context.EXPERIMENT_CONFIG;
  const errors = [];
  if (config.followupMode !== "google_forms") errors.push("Production followupMode must be google_forms; public form URLs must be issued by the verified server.");
  try {
    const endpoint = new URL(config.serverEndpoint);
    if (endpoint.protocol !== "https:" || endpoint.hostname !== "script.google.com" || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.pathname) || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error();
    if (config.serverEndpoint === context.APP_DATA?.config?.logEndpoint || config.serverEndpoint === context.APP_DATA?.logEndpoint) errors.push("Production endpoint must be the separately deployed late-study GAS, not the frozen first-term endpoint.");
  } catch (_) { errors.push("serverEndpoint must be an HTTPS Google Apps Script /macros/s/<deployment>/exec URL."); }
  try {
    const deployment = new URL(config.deploymentUrl);
    if (deployment.protocol !== "https:" || deployment.username || deployment.password || deployment.search || deployment.hash || /^(?:localhost|127\.|\[?::1\]?$)/i.test(deployment.hostname) || /(?:^|\.)example\.(?:com|org|net|test)$/i.test(deployment.hostname)) throw new Error();
    if (!deployment.pathname.endsWith("/")) errors.push("deploymentUrl must end with / so followup.html resolves in the same release.");
  } catch (_) { errors.push("deploymentUrl must be the actual HTTPS site base URL."); }
  return errors;
}
function analyze(root, options = {}) {
  const errors = [];
  const warnings = [];
  const manifest = JSON.parse(read(root, "baseline-manifest.json"));
  const context = loadExperiment(root);
  for (const entry of manifest.files) {
    const baseline = safeFile(root, "baseline-original/" + entry.path);
    if (!fs.existsSync(baseline) || sha256(fs.readFileSync(baseline)) !== entry.sha256 || fs.statSync(baseline).size !== entry.bytes) errors.push("Frozen baseline mismatch: " + entry.path);
    if (entry.path === "data.js" || entry.path === "styles.css" || entry.path.startsWith("assets/") || entry.path === "事前事後アンケート答え管理.txt") {
      const current = safeFile(root, entry.path);
      if (!fs.existsSync(current) || sha256(fs.readFileSync(current)) !== entry.sha256) errors.push("Frozen source mismatch: " + entry.path);
    }
  }
  const files = SITE_FILES.slice();
  for (const asset of assetPaths(context)) {
    try { files.push(localReference(asset)); } catch (error) { errors.push(error.message); }
  }
  for (const relative of [...new Set(files)]) {
    try {
      const full = safeFile(root, relative);
      if (!fs.existsSync(full) || !fs.statSync(full).isFile()) { errors.push("Missing site file: " + relative); continue; }
      if (relative.endsWith(".js")) new vm.Script(stripTestHelpers(read(root, relative)), { filename: relative });
    } catch (error) { errors.push(error.message); }
  }
  const allowed = new Set(files);
  for (const html of ["index.html", "followup.html", "connection-check.html"]) {
    if (!fs.existsSync(path.join(root, html))) continue;
    const source = read(root, html);
    for (const match of source.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)) {
      const ref = match[1].split(/[?#]/)[0].replace(/^\.\//, "");
      if (!allowed.has(ref)) errors.push(html + " references a resource outside the site allowlist: " + match[1]);
    }
    if (html === "index.html") {
      const scriptRefs = [...source.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(match => ({ ref: match[1].split(/[?#]/)[0].replace(/^\.\//, ""), tag: match[0] }));
      const expected = CLASSIC_FILES.concat("app.js");
      const actual = scriptRefs.filter(item => expected.includes(item.ref));
      if (actual.map(item => item.ref).join("|") !== expected.join("|") || actual.some(item => /\sasync(?:\s|=|>)/i.test(item.tag))) errors.push("index.html must load data.js, common-corrections.js, configuration, overlays, evaluation, context, and app once in order without async.");
    }
    if (html === "connection-check.html") {
      const scripts = [...source.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)].map(match => ({ ref: match[1].split(/[?#]/)[0].replace(/^\.\//, ""), tag: match[0] }));
      if (scripts.map(item => item.ref).join("|") !== "experiment-config.js|connection-check.js" || scripts.some(item => /\s(?:async|defer)(?:\s|=|>)/i.test(item.tag))) errors.push("connection-check.html must load only configuration and the non-writing diagnostic once in order.");
    }
  }
  const structural = context.EXPERIMENT_CONTEXT.getReadinessReport({ production: false });
  errors.push(...structural.errors);
  const production = context.EXPERIMENT_CONTEXT.getReadinessReport({ production: true });
  const template = reviewTemplate(context, manifest, root);
  const record = options.review || context.EXPERIMENT_CONFIG.researchReview || context.EVALUATION_DATA.researchReview;
  const studyInformationErrors = typeof context.BTS_PUBLIC_STUDY_INFORMATION?.validate === "function"
    ? context.BTS_PUBLIC_STUDY_INFORMATION.validate(context.EXPERIMENT_CONFIG.studyInformation, options.now)
    : ["Public study-information validation is missing from experiment-config.js."];
  const productionErrors = [...production.errors, ...validateUrls(context), ...studyInformationErrors, ...validateReview(record, template.contentSha256, options.now)];
  const reviewIssues = context.EVALUATION_DATA.contentReviewIssues || [];
  for (const issue of Array.isArray(reviewIssues) ? reviewIssues : []) {
    if (!issue || typeof issue !== "object") continue; // Application structure validation reports malformed records.
    if ((issue.severity === "blocking" || issue.blocking === true) && issue.status !== "resolved") productionErrors.push("Unresolved blocking content issue: " + String(issue.id || issue.title || "unnamed issue") + ".");
  }
  if (!context.EVALUATION_DATA.instrumentVersion) productionErrors.push("Followup instrumentVersion is missing.");
  if (options.mode === "production") errors.push(...productionErrors);
  else warnings.push(...productionErrors);
  return { ready: errors.length === 0, productionReady: errors.length === 0 && productionErrors.length === 0, mode: options.mode || "preview", appVersion: context.EXPERIMENT_CONFIG.appVersion, errors: [...new Set(errors)], warnings: [...new Set(warnings)], files: [...new Set(files)].sort(), contentSha256: template.contentSha256, followupInstrumentSha256: followupInstrumentSha256(context), reviewTemplate: template, context, manifest };
}
function previewGuard() {
  return `<script>(function(){"use strict";var local=/^(localhost|127\\.0\\.0\\.1|\\[?::1\\]?)$/.test(location.hostname);window.fetch=function(){return Promise.reject(new Error("Preview network disabled"));};XMLHttpRequest.prototype.open=function(){throw new Error("Preview network disabled");};if(navigator.sendBeacon)navigator.sendBeacon=function(){return false;};if(!local){var policy=document.createElement("meta");policy.httpEquiv="Content-Security-Policy";policy.content="script-src 'none'";document.head.appendChild(policy);document.addEventListener("DOMContentLoaded",function(){var message=document.createElement("main");message.style.cssText="padding:24px;font:20px/1.6 sans-serif";message.textContent="Preview: serve this folder on localhost. / ローカルプレビュー専用です。";document.body.replaceChildren(message);});}})();</script>`;
}
function previewHtml(source) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'">`;
  const notice = `<aside role="note" style="padding:12px;background:#fff0b3;color:#302500;text-align:center;font:16px sans-serif">研究内容確認用プレビュー・データ送信なし / Review preview — no data is sent</aside>`;
  return source.replace(/<head>/i, "<head>" + policy + previewGuard()).replace(/<body>/i, "<body>" + notice);
}
function timestamp(now) { return new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function outputDirectory(root, name) {
  const directory = safeFile(root, "dist/" + name);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory); // Never overwrite an earlier review/release.
  return directory;
}
function build(root, options = {}) {
  if (!["preview", "production"].includes(options.mode)) throw new Error("Build requires explicit --preview or --production.");
  const report = analyze(root, options);
  if (!report.ready) throw new Error("Release blocked:\n" + report.errors.join("\n"));
  if (!/^[A-Za-z0-9._-]+$/.test(report.appVersion)) throw new Error("Unsafe appVersion for release directory.");
  const out = outputDirectory(root, report.appVersion + "-" + timestamp(options.now || Date.now()) + "-" + options.mode);
  for (const relative of report.files) {
    const source = safeFile(root, relative);
    const target = safeFile(out, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (/\.js$/.test(relative)) fs.writeFileSync(target, stripTestHelpers(fs.readFileSync(source, "utf8")));
    else if (/\.html$/.test(relative) && options.mode === "preview") fs.writeFileSync(target, previewHtml(fs.readFileSync(source, "utf8")));
    else fs.copyFileSync(source, target);
  }
  const artifact = { schemaVersion: 1, mode: options.mode, appVersion: report.appVersion, contentVersion: report.context.EXPERIMENT_CONFIG.contentVersion || "", commonCorrectionVersion: report.context.EXPERIMENT_CONFIG.commonCorrectionVersion || "", followupMode: report.context.EXPERIMENT_CONFIG.followupMode, baselineVariant: report.context.COMMON_CORRECTIONS?.baselineVariant || "", contentSha256: report.contentSha256, followupInstrumentSha256: report.followupInstrumentSha256, gasScriptProperties: gasScriptProperties(report.context), files: report.files.map(relative => ({ path: relative, sha256: sha256(fs.readFileSync(safeFile(out, relative))) })) };
  fs.writeFileSync(path.join(out, "release-manifest.json"), JSON.stringify(artifact, null, 2) + "\n");
  return { directory: out, report, manifest: artifact };
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }
function writeReview(root, options = {}) {
  const report = analyze(root, { ...options, mode: "preview" });
  const out = outputDirectory(root, "review-" + report.appVersion + "-" + timestamp(options.now || Date.now()));
  const figures = [];
  for (const asset of assetPaths(report.context)) {
    const relative = localReference(asset);
    const source = safeFile(root, relative);
    if (!fs.existsSync(source)) continue;
    const target = safeFile(out, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    figures.push(`<figure><img src="${escapeHtml(relative)}" alt="確認用図：${escapeHtml(relative)}" loading="lazy" style="max-width:100%;max-height:550px"><figcaption>${escapeHtml(relative)} — ${sha256(fs.readFileSync(source))}</figcaption></figure>`);
  }
  const sections = [
    ["追跡の収集方式 / Follow-up collection mode", { followupMode: report.context.EXPERIMENT_CONFIG.followupMode, route: "Personal landing → server identity/due/expiry validation → verified prefilled Google Form → server-confirmed acceptance", measurement: "Web pre/learning/post unchanged. Forms-only follow-up has no per-item response time or answer-change measurements.", approval: "This report and setup template do not approve research or authorize publication." }],
    ["全群共通の法規訂正・根拠 / Common legal corrections and sources", report.context.COMMON_CORRECTIONS],
    ["B群：共通訂正後の比較基準 / B: corrected common comparison baseline", report.context.APP_DATA.questions],
    ["全群共通の説明カード / Shared introduction cards", report.context.APP_DATA.introCards || []],
    ["A群：画像のない場面説明 / A: scene descriptions", report.context.CONDITION_OVERLAYS.conditions.no_image],
    ["C群：改善内容 / C: learning support", report.context.CONDITION_OVERLAYS.conditions.improved],
    ["実際に表示する共通評価（日本語・英語） / Effective shared instruments", sharedSurveyContent(report.context)],
    ["共通評価の追加設定と採点キー / Shared instrument configuration and scoring", report.context.EVALUATION_DATA],
    ["保存用：未訂正の前期学習原本（後期の表示基準ではない） / Archived original learning content (not the late-study baseline)", report.context.FROZEN_APP_DATA?.questions || []]
  ];
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blue Ticket Simulator 研究内容確認</title><style>body{max-width:1000px;margin:32px auto;padding:0 20px;font:16px/1.6 sans-serif;color:#152433}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f7;padding:20px}h2{margin-top:40px}code,figcaption{overflow-wrap:anywhere}figure{margin:24px 0;padding:16px;border:1px solid #d1dfe9}</style></head><body><h1>研究内容の確認資料</h1><p>ビルド ${escapeHtml(report.appVersion)}。この資料は現在の実装値を表示します。承認者・承認日時は未入力のままです。</p><p>内容 SHA-256: <code>${report.contentSha256}</code></p><p>Follow-up instrument SHA-256: <code>${report.followupInstrumentSha256}</code></p>${sections.map(([title, data]) => `<h2>${escapeHtml(title)}</h2><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`).join("")}<h2>参照図の保存コピー</h2>${figures.join("")}<h2>本番判定</h2><pre>${escapeHtml([...report.errors, ...report.warnings].join("\n") || "Local production checks passed; live deployment checks are separate.")}</pre></body></html>`;
  fs.writeFileSync(path.join(out, "research-review.html"), html);
  fs.writeFileSync(path.join(out, "research-review.template.json"), JSON.stringify(report.reviewTemplate, null, 2) + "\n");
  fs.writeFileSync(path.join(out, "review-content.json"), JSON.stringify(reviewContent(report.context, report.manifest, root), null, 2) + "\n");
  fs.writeFileSync(path.join(out, "gas-script-properties.template.json"), JSON.stringify(gasScriptProperties(report.context), null, 2) + "\n");
  fs.writeFileSync(path.join(out, "production-script-properties.template.json"), JSON.stringify(productionPropertiesTemplate(root), null, 2) + "\n");
  return { directory: out, report };
}

module.exports = { SITE_FILES, REVIEW_APPROVALS, canonicalJson, sha256, safeFile, loadExperiment, followupInstrument, followupInstrumentSha256, gasScriptProperties, productionPropertiesTemplate, sharedSurveyContent, reviewContent, reviewTemplate, validateReview, validateUrls, stripTestHelpers, analyze, build, writeReview };
