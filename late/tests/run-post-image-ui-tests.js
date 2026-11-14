"use strict";

// Isolated frontend functions and fake DOM/storage only. Never sends study data.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const release = require("../scripts/release-lib.js");
const root = path.resolve(__dirname, "..");
const actual = release.loadExperiment(root);
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const currentVersion = "2026-10-post-pov-v1";
const legacyVersion = "2026-late-post-diagram-v1";
const copy = value => JSON.parse(JSON.stringify(value));
let assertions = 0;
function check(value, message) { assertions++; assert.ok(value, message); }
function section(first, next) {
  const start = source.indexOf(first);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, "Expected frontend source section " + first);
  return source.slice(start, end);
}
const functions = [
  section("function createInitialState(){", "const app ="),
  section("function readSessionState(){", "function persistState(){"),
  section("function postSurveyHasStarted(saved){", "function refreshActiveQuestions(){"),
  section("function startPostSurvey(){", "function submitPostSurvey(e){"),
  section("function buildSummary(){", "function buildCompletionPayload(){")
].join("\n");

function revision(language, version) {
  const old = version === legacyVersion;
  return [
    {id: "late_post_transfer_notice", type: "notice", text: `${language}:${old ? "diagram" : "rider POV"}`},
    {id: "late_post_transfer_stop", type: "single", title: `${language}:stop:${version}`, image: `assets/late-post-stop${old ? ".svg" : "-pov-v1.png"}`, imageAlt: `${language}:${version}:stop`, imageVersion: version, required: true, choices: ["A. go", "B. stop", "C. slow"]},
    {id: "late_post_transfer_pedestrian", type: "single", title: `${language}:pedestrian:${version}`, image: `assets/late-post-pedestrian${old ? ".svg" : "-pov-v1.png"}`, imageAlt: `${language}:${version}:pedestrian`, imageVersion: version, required: true, choices: ["A. stop", "B. bell", "C. pass"]}
  ];
}
function harness(options = {}) {
  const stored = new Map();
  const writes = [];
  const removed = [];
  const snapshots = [];
  const rendered = [];
  const evaluation = options.actual ? copy(actual.EVALUATION_DATA) : {
    postImageVersion: currentVersion,
    legacyPostImageVersion: legacyVersion,
    postImageRevisions: Object.fromEntries([currentVersion, legacyVersion].map(version => [version,
      Object.fromEntries(["ja", "en"].map(language => [language, revision(language, version)]))])),
    extensions: {post: Object.fromEntries(["ja", "en"].map(language => [language, [
      ...revision(language, currentVersion), {id: "untouched_extension", type: "likert", title: "untouched"}
    ]]))}
  };
  if(options.editEvaluation) options.editEvaluation(evaluation);
  const config = options.actual ? copy(actual.EXPERIMENT_CONFIG) : {schemaVersion: 2, appVersion: "2.2.0-review.1", contentVersion: "2026-late-content-v2", commonCorrectionVersion: "2026-09-common-law-v1", studyInformation: {contactEmail: "fixture@research.invalid"}};
  const app = {innerHTML: ""};
  const sandbox = {
    Date, JSON, Object, Array, Map, Set, Number, Math, console,
    EXPERIMENT_CONFIG: config, STORE_ID: "B", SESSION_STORAGE_KEY: "fixture:active-session",
    DATA: options.actual ? copy(actual.APP_DATA) : {survey: {ja: [], en: []}, postSurvey: {ja: [{id: "untouched_base", type: "likert", title: "original base"}], en: [{id: "untouched_base", type: "likert", title: "original base"}]}, questions: [{id: "q1", score_domain: "situation"}, {id: "q2", score_domain: "system"}]},
    EVALUATION_DATA: evaluation,
    EXPERIMENT: {mergeSurveyItems(base, phase, settings) { return options.actual ? actual.EXPERIMENT_CONTEXT.mergeSurveyItems(base, phase, {...settings, evaluationData: evaluation}) : base.concat(evaluation.extensions[phase][settings.language]); }},
    createId: (() => {let id = 0; return () => `fixture_${++id}`;})(), localDateString: () => "2026-10-10",
    sessionStorage: {getItem: key => stored.get(key) ?? null, setItem: (key, value) => {stored.set(key, value); writes.push([key, value]);}, removeItem: key => {stored.delete(key); removed.push(key);}},
    restoredStateIsValid: () => true,
    app, layout: html => html, escapeHtml: value => String(value ?? ""), surveyErrorSummary: () => "",
    renderSurveyFields(items) {rendered.push(copy(items)); return items.map(item => item.image ? `<img src="${item.image}" alt="${item.imageAlt}">` : item.text || item.title).join("\n");},
    $: () => ({addEventListener() {}}), bindSurveyTracking() {}, submitPostSurvey() {},
    persistState() {snapshots.push(copy(sandbox.state)); stored.set("fixture:active-session", JSON.stringify(sandbox.state)); return true;},
    setScreen(screen) {sandbox.state.screen = screen; sandbox.persistState(); sandbox.renderPostSurvey();}
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(functions, context, {filename: "app.js:post-image-functions"});
  sandbox.state = context.createInitialState();
  sandbox.state.score = 1;
  if(options.saved) {
    stored.set("fixture:active-session", JSON.stringify({...copy(sandbox.state), ...copy(options.saved)}));
    sandbox.state = context.readSessionState();
  }
  return {context, config, app, stored, writes, removed, snapshots, rendered, evaluation,
    get state() {return sandbox.state;}, restore(saved) {stored.set("fixture:active-session", JSON.stringify({...copy(sandbox.state), ...copy(saved)})); sandbox.state = context.readSessionState(); return sandbox.state;}};
}

const fresh = harness();
check(fresh.state.postImageVersion === null, "Initial state does not claim exposure before the post-survey");
fresh.context.surveyItems("post");
check(fresh.state.postImageVersion === null && fresh.snapshots.length === 0, "Inspecting survey items does not pin or persist exposure");
fresh.state.screen = "result";
fresh.context.startPostSurvey();
check(fresh.state.screen === "post" && fresh.state.postImageVersion === currentVersion, "Entering post-survey pins the approved rider-POV version");
check(Boolean(fresh.state.phaseTimes.post_started_at) && fresh.snapshots.every(snapshot => snapshot.postImageVersion === currentVersion), "The transition is never saved as an unmarked, already-started post-survey");
check(fresh.app.innerHTML.includes("late-post-stop-pov-v1.png") && fresh.app.innerHTML.includes("late-post-pedestrian-pov-v1.png") && fresh.app.innerHTML.includes("rider POV") && !fresh.app.innerHTML.includes(".svg"), "New post-survey renders both photographs and the matching notice");
check(fresh.rendered[0].find(item => item.id === "untouched_base").title === "original base" && fresh.rendered[0].find(item => item.id === "untouched_extension").title === "untouched", "Base and unrelated extension items are retained");
check(JSON.stringify(fresh.rendered[0].find(item => item.id === "late_post_transfer_stop").choices) === '["A. go","B. stop","C. slow"]', "Image selection preserves response choices and question IDs");
const selectedRevision = JSON.stringify(fresh.evaluation.postImageRevisions);
fresh.state.postSurveyAnswers.late_post_transfer_stop = "B. stop";
fresh.context.renderPostSurvey();
check(fresh.state.postImageVersion === currentVersion && fresh.state.postSurveyAnswers.late_post_transfer_stop === "B. stop", "Validation rerender retains the exact exposure and drafted answer");
check(JSON.stringify(fresh.evaluation.postImageRevisions) === selectedRevision, "Rendering never mutates the configured revision definitions");
check(fresh.context.buildSummary().post_image_version === currentVersion, "Completion summary records the actual selected post image version");

const footprints = [
  {screen: "post"}, {screen: "final"}, {screen: "resume", resumeScreen: "post"}, {screen: "resume", resumeScreen: "final"},
  {screen: "result", phaseTimes: {post_started_at: "2026-10-09T12:00:00.000Z"}},
  {screen: "result", postSurveyAnswers: {late_post_transfer_stop: "B. stop"}},
  {screen: "result", postSurveyLogs: [{question_id: "late_post_transfer_stop"}]},
  {screen: "result", surveyTimings: {pre: {}, post: {late_post_transfer_stop: {startedAt: "2026-10-09T12:00:00.000Z"}}}},
  {screen: "post", postSurveyCompletedAt: "2026-10-09T12:00:00.000Z"}
];
for(const saved of footprints) {
  const legacy = harness({saved});
  check(legacy.state.postImageVersion === legacyVersion, "Existing post footprint pins legacy diagrams: " + JSON.stringify(saved));
  const answers = JSON.stringify(legacy.state.postSurveyAnswers);
  legacy.context.renderPostSurvey();
  check(legacy.app.innerHTML.includes("late-post-stop.svg") && legacy.app.innerHTML.includes("late-post-pedestrian.svg") && legacy.app.innerHTML.includes("diagram") && !legacy.app.innerHTML.includes("-pov-v1.png"), "Restored legacy state uses old assets, old titles and old notice together");
  check(legacy.removed.length === 0 && JSON.stringify(legacy.state.postSurveyAnswers) === answers && legacy.context.buildSummary().post_image_version === legacyVersion, "Restoration retains prior answers and marks rather than relabels legacy exposure");
}
for(const screen of ["language", "pre", "intro", "question", "feedback", "result"]) {
  const before = harness({saved: {screen}});
  check(before.state.postImageVersion === null, "A restored pre-post session remains eligible for approved images: " + screen);
  before.state.screen = "result";
  before.context.startPostSurvey();
  check(before.state.postImageVersion === currentVersion && before.removed.length === 0, "An old session that has not entered post-survey can continue into the new images");
}
for(const lang of ["ja", "en"]) {
  for(const postImageVersion of [currentVersion, legacyVersion]) {
    const page = harness({saved: {lang, screen: "post", postImageVersion, postSurveyAnswers: {draft: "retained"}}});
    page.context.renderPostSurvey();
    check(page.state.postImageVersion === postImageVersion && page.app.innerHTML.includes(lang + ":" + postImageVersion + ":stop"), "Explicit revision and language survive restoration: " + lang + "/" + postImageVersion);
    check(page.state.postSurveyAnswers.draft === "retained" && page.removed.length === 0, "Explicit revision restoration does not clear the participant's draft");
  }
}

const unknown = harness({saved: {screen: "post", participantId: "FIXTURE01", postImageVersion: "future-or-invalid-version", postSurveyAnswers: {draft: "do not delete"}}});
const unknownStored = unknown.stored.get("fixture:active-session");
unknown.context.renderPostSurvey();
check(unknown.app.innerHTML.includes("POST_IMAGE_REVISION_UNAVAILABLE") && !unknown.app.innerHTML.includes("<form"), "An unknown explicit revision stops with a recoverable, static error");
check(unknown.state.participantId === "FIXTURE01" && unknown.state.postSurveyAnswers.draft === "do not delete" && unknown.state.postImageVersion === "future-or-invalid-version", "Unknown revision does not replace identity, answers, or selected version");
check(unknown.removed.length === 0 && unknown.stored.get("fixture:active-session") === unknownStored && unknown.snapshots.length === 0, "Unknown revision neither removes nor rewrites the saved session");
assert.throws(() => unknown.context.buildSummary(), error => error.code === "POST_IMAGE_REVISION_UNAVAILABLE");
assertions++;
const missingLegacy = harness({saved: {screen: "post", postSurveyAnswers: {draft: "retained"}}, editEvaluation: evaluation => {delete evaluation.legacyPostImageVersion;}});
missingLegacy.context.renderPostSurvey();
check(missingLegacy.app.innerHTML.includes("POST_IMAGE_REVISION_UNAVAILABLE") && missingLegacy.state.postSurveyAnswers.draft === "retained" && missingLegacy.snapshots.length === 0 && missingLegacy.removed.length === 0, "A missing legacy version never silently relabels an existing post draft as new photographs");
for(const editEvaluation of [
  evaluation => {delete evaluation.postImageRevisions[currentVersion];},
  evaluation => {evaluation.postImageRevisions[currentVersion].ja = [];},
  evaluation => {evaluation.postImageRevisions[currentVersion].ja.push({id: "unrelated", type: "notice"});},
  evaluation => {evaluation.postImageRevisions[currentVersion].ja.push(copy(evaluation.postImageRevisions[currentVersion].ja[0]));}
]) {
  const broken = harness({editEvaluation});
  broken.state.screen = "result";
  broken.context.startPostSurvey();
  check(broken.state.screen === "result" && broken.state.postImageVersion === null && broken.snapshots.length === 0 && broken.app.innerHTML.includes("POST_IMAGE_REVISION_UNAVAILABLE"), "Unavailable or inconsistent revisions stop before marking or saving post exposure");
}
check(source.includes('rows.push(["session","post_image_version",state.postImageVersion || ""]);'), "Local CSV retains the independent image revision marker");

// Integration with the real authored data, not just a revision-shaped fixture.
check(actual.EVALUATION_DATA.postImageVersion === currentVersion && actual.EVALUATION_DATA.legacyPostImageVersion === legacyVersion, "Authored data declares the exact current and legacy image revisions");
for(const language of ["ja", "en"]) {
  const revisions = actual.EVALUATION_DATA.postImageRevisions;
  check(revisions[currentVersion][language].map(item => item.id).join(",") === "late_post_transfer_notice,late_post_transfer_stop,late_post_transfer_pedestrian", "The real current revision includes the matching notice and both image questions: " + language);
  check(revisions[legacyVersion][language].map(item => item.id).join(",") === "late_post_transfer_notice,late_post_transfer_stop,late_post_transfer_pedestrian", "The real legacy revision retains the matching notice and both diagram questions: " + language);
  for(const version of [currentVersion, legacyVersion]) {
    const page = harness({actual: true, saved: {lang: language, screen: "post", postImageVersion: version}});
    page.context.renderPostSurvey();
    check(page.rendered.length === 1 && !page.app.innerHTML.includes("POST_IMAGE_REVISION_UNAVAILABLE"), "The real authored revision renders without error: " + language + "/" + version);
    const items = page.rendered[0];
    const notice = items.find(item => item.id === "late_post_transfer_notice");
    check(version === currentVersion ? /生成画像|generated first-person/.test(notice.title) : /模式図|diagrams/.test(notice.title), "The real notice describes the selected image format rather than another revision");
    check(items.find(item => item.id === "late_post_transfer_stop").image.endsWith(version === currentVersion ? "-pov-v1.png" : ".svg") && items.find(item => item.id === "late_post_transfer_pedestrian").image.endsWith(version === currentVersion ? "-pov-v1.png" : ".svg"), "The real survey loads both assets from one pinned revision");
  }
  for(const id of ["late_post_transfer_stop", "late_post_transfer_pedestrian"]) {
    const old = revisions[legacyVersion][language].find(item => item.id === id);
    const revised = revisions[currentVersion][language].find(item => item.id === id);
    for(const field of ["id", "type", "choices", "construct", "score_domain", "optional"]) {
      check(JSON.stringify(old[field]) === JSON.stringify(revised[field]), "Non-presentation field is unchanged for " + language + "/" + id + "/" + field);
    }
    check(revised.imageVersion === currentVersion && revised.modality === "first_person_generated_image" && old.modality === "diagram", "Current and legacy image metadata are distinguishable without changing answer keys");
  }
  const groupRenders = ["no_image", "original", "improved"].map(condition => {
    const page = harness({actual: true, saved: {lang: language, screen: "post", condition, postImageVersion: currentVersion}});
    page.context.renderPostSurvey();
    return JSON.stringify(page.rendered[0]);
  });
  check(new Set(groupRenders).size === 1, "All three learning conditions use the identical post-survey images and questions: " + language);
}
check(actual.EVALUATION_DATA.answerKeys.post.late_post_transfer_stop === "B" && actual.EVALUATION_DATA.answerKeys.post.late_post_transfer_pedestrian === "A", "The two transfer answer keys are unchanged");
check(release.followupInstrumentSha256(actual) === "d81ef3857a96f7c2c44c9937f6f942091e7fe1270db455180ccf517851e0d7d0", "The week-one Google Forms instrument, questions and keys are unchanged");
check(actual.EXPERIMENT_CONFIG.appVersion === "2.2.0-review.1" && actual.EXPERIMENT_CONFIG.contentVersion === "2026-late-content-v2" && actual.EVALUATION_DATA.instrumentVersion === "2026-late-instrument-v2", "Core versions remain compatible with already-issued assignments and follow-up links");
for(const [relativePath, expectedHash] of [
  ["assets/late-post-stop-pov-v1.png", "2d68bbf8e3412e6a9f09fad6ea11a7fe156bae8664f07330fbd7d086fde8ad77"],
  ["assets/late-post-pedestrian-pov-v1.png", "c395d36e235d8cb50dbb6b568ddfa92cf2acb122b49de1dca808d2f7f35e2bff"]
]) {
  const bytes = fs.readFileSync(path.join(root, relativePath));
  check(crypto.createHash("sha256").update(bytes).digest("hex") === expectedHash, "The selected asset is exactly the user-approved generated image: " + relativePath);
  check(bytes.readUInt32BE(16) === 1536 && bytes.readUInt32BE(20) === 1024, "The selected image keeps the approved landscape resolution");
}
check(fs.existsSync(path.join(root, "assets/late-post-stop.svg")) && fs.existsSync(path.join(root, "assets/late-post-pedestrian.svg")), "Legacy diagram assets remain available for already-started post sessions");
console.log("PASS: " + assertions + " post-image revision UI assertions (fake DOM/storage only)");
