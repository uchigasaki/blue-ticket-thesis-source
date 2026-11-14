"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadExperiment, canonicalJson, sha256, followupInstrumentSha256 } = require("../scripts/release-lib");
const root = path.resolve(__dirname, "..");
let checks = 0;
function check(condition, message) { checks++; assert.ok(condition, message); }
function equal(actual, expected, message) { checks++; assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
const context = loadExperiment(root);
const forms = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, "gas/Forms.gs"), "utf8"), forms, { timeout: 5000 });
const core = vm.createContext({}); // No FormApp, Utilities, services, clock, or logging.
vm.runInContext(fs.readFileSync(path.join(root, "gas/FormsResponseCore.gs"), "utf8"), core, { timeout: 5000 });
const data = clone(forms.BTS_GOOGLE_FORMS_DRAFT_DATA_);
const ingestedAt = "2026-09-25T01:00:03.000Z";
function run(f, keys = f.keys) { return core.normalizeFormsResponse_(f.trusted, f.event, f.ingestedAt, keys); }
function refuses(fixture, change, code, message) {
  const changed = clone(fixture);
  change(changed);
  checks++;
  assert.throws(() => run(changed), error => error.message === "forms_" + code, message);
}
function fixture(definition, index) {
  const phase = definition.phase, language = definition.language;
  const baseline = phase === "pre" ? context.APP_DATA.survey[language] : phase === "post" ? context.APP_DATA.postSurvey[language] : [];
  const items = clone(context.EXPERIMENT_CONTEXT.mergeSurveyItems(baseline, phase, { language }));
  equal(definition.items, items, "generated definition matches actual merged " + phase + "/" + language);
  const keys = clone(context.EVALUATION_DATA.answerKeys[phase]);
  const instrumentHash = phase === "followup" ? followupInstrumentSha256(context) : sha256(canonicalJson({ instrumentVersion: data.instrumentVersion, phase, items, keys }));
  const instrument = { experimentId: data.experimentId, instrumentVersion: data.instrumentVersion, instrumentHash, digest: data.digest, phase, language, items };
  // Exercise the actual generator's plan and Map export, not a hand-built twin.
  const plan = forms.btsFormsExpectedItems_(definition, data);
  const fakeItems = Array.from(plan, (_spec, i) => ({ getId: () => String(100000 + index * 1000 + i) }));
  const mapRows = forms.btsFormsMapRows_(fakeItems, plan, data.digest);
  equal(mapRows[0], ["source_id", "source_type", "form_item_id", "image_item_id", "title", "instrument_digest"], "actual Map columns");
  const itemMap = Array.from(mapRows.slice(1), row => ({ sourceId: row[0], sourceType: row[1], itemId: row[2], imageItemId: row[3], instrumentDigest: row[5] }));
  const registry = { experimentId: instrument.experimentId, instrumentVersion: instrument.instrumentVersion, instrumentHash, digest: data.digest, phase, language, formId: "synthetic-form-" + index, itemMap };
  const identity = { experiment_id: data.experimentId, allocation_version: context.EXPERIMENT_CONFIG.allocationVersion, assignment_id: "synthetic-assignment", session_id: "synthetic-session", participant_id_normalized: "ABCD12", store_id: "A", condition: "original" };
  const itemResponses = [];
  itemMap.forEach(row => {
    const spec = plan.find(spec => spec.sourceId === row.sourceId);
    if (spec.type === "SECTION_HEADER") return;
    const source = items.find(item => item.id === row.sourceId);
    let response;
    if (row.sourceId === "participant_id") response = identity.participant_id_normalized;
    else if (!source) response = "independent optional details";
    else if (source.type === "single" || source.type === "multi") {
      const key = keys[source.id];
      const selectedCodes = key === undefined ? ["A"] : Array.isArray(key) ? key : [key];
      const selected = source.choices.filter(choice => selectedCodes.includes(choice[0]));
      response = source.type === "multi" ? selected : selected[0];
    } else if (source.type === "scale") response = String((source.points || [1, 2, 3, 4])[0]);
    else if (source.type === "number") response = "20";
    else response = "optional research comment";
    itemResponses.push({ itemId: row.itemId, type: spec.type, response });
  });
  return { trusted: { identity, instrument, registry }, event: { formId: registry.formId, responseId: "synthetic-response-" + index, submittedAt: "2026-09-25T01:00:00.000Z", itemResponses }, ingestedAt, keys };
}
function answer(f, id) {
  const mapped = f.trusted.registry.itemMap.find(row => row.sourceId === id);
  return f.event.itemResponses.find(row => row.itemId === mapped.itemId);
}
function removeAnswer(f, id) {
  const row = answer(f, id);
  f.event.itemResponses = f.event.itemResponses.filter(value => value !== row);
}
const fixtures = data.forms.map(fixture);
check(fixtures.length === 6, "all six phase/language variants");
const covered = new Set();
fixtures.forEach(f => {
  freeze(f);
  const original = JSON.stringify(f);
  const result = run(f);
  check(JSON.stringify(f) === original, "pure function does not mutate frozen inputs");
  equal(result.identity, f.trusted.identity, "authoritative identity copied through allowlist");
  check(result.measurement_mode === "forms" && result.phase === f.trusted.instrument.phase && result.language === f.trusted.instrument.language, "phase/language provenance");
  check(!Object.hasOwn(result.answers, "participant_id"), "hand-entered participant ID excluded from analytic answers");
  check(result.answer_records.filter(row => row.is_correct !== null).every(row => row.is_correct === true), "existing explicitly supplied keys grade full correct responses");
  check(result.answer_records.filter(row => row.is_correct !== null).length === Object.keys(f.keys).length, "only actual scored source IDs graded");
  const noKeys = core.normalizeFormsResponse_(f.trusted, f.event, f.ingestedAt);
  check(noKeys.answer_records.every(row => row.is_correct === null), "omitted keys never infer a correct answer");
  check(result.google_submitted_at !== result.ingested_at, "submission time and ingestion time remain distinct");
  equal(result.question_logs, [], "Forms creates no fake browser question logs");
  for (const field of ["started_at", "completed_at", "response_time_ms", "screen_dwell_time_ms", "answer_change_count"]) check(result[field] === null, "unmeasured aggregate " + field);
  check(result.answer_records.every(row => ["question_started_at", "answered_at", "response_time_ms", "screen_dwell_time_ms", "answer_change_count"].every(key => row[key] === null)), "unmeasured item timings and changes stay null");
  const reordered = clone(f); reordered.event.itemResponses.reverse(); reordered.trusted.registry.itemMap.reverse();
  equal(run(reordered), clone(result), "mapping relies on exact IDs, never response/map position");
  for (const item of f.trusted.instrument.items) {
    covered.add(item.type);
    if (item.type === "notice") {
      check(!Object.hasOwn(result.answers, item.id), "notice is not an answer");
      refuses(f, x => x.event.itemResponses.push({ itemId: x.trusted.registry.itemMap.find(row => row.sourceId === item.id).itemId, type: "SECTION_HEADER", response: "" }), "invalid_response_item", "notice response rejected");
      continue;
    }
    if (!item.optional) {
      refuses(f, x => removeAnswer(x, item.id), "required_answer_missing", "omitted required " + item.id);
      refuses(f, x => { answer(x, item.id).response = item.type === "multi" ? [] : " "; }, "required_answer_missing", "empty required " + item.id);
    } else {
      const missing = clone(f); removeAnswer(missing, item.id);
      check(run(missing).answers[item.id] === null, "omitted optional text is null");
    }
    refuses(f, x => { answer(x, item.id).response = { secret: "must not leak" }; }, "invalid_answer_type", "object answer rejected");
    refuses(f, x => { answer(x, item.id).type = "UNKNOWN"; }, "invalid_response_item", "item type mismatch rejected");
    if (item.choices) {
      item.choices.forEach(choice => {
        const alternate = clone(f); answer(alternate, item.id).response = item.type === "multi" ? [choice] : choice;
        equal(run(alternate).answers[item.id], item.type === "multi" ? [choice] : choice, "exact choice accepted in original language");
      });
      refuses(f, x => { answer(x, item.id).response = item.type === "multi" ? ["A. forged choice"] : "A. forged choice"; }, "invalid_choice", "choice prefix does not grant membership");
      if (Object.hasOwn(f.keys, item.id)) {
        if (item.type === "single") {
          const wrong = clone(f); answer(wrong, item.id).response = item.choices.find(choice => choice[0] !== f.keys[item.id]);
          check(run(wrong).answer_records.find(row => row.question_id === item.id).is_correct === false, "actual single-choice wrong answer scores false");
        } else {
          const partial = clone(f); answer(partial, item.id).response = answer(partial, item.id).response.slice(0, 1);
          check(run(partial).answer_records.find(row => row.question_id === item.id).is_correct === false, "actual multi-choice partial set scores false");
          const extra = clone(f); answer(extra, item.id).response.push(item.choices.find(choice => !f.keys[item.id].includes(choice[0])));
          check(run(extra).answer_records.find(row => row.question_id === item.id).is_correct === false, "actual multi-choice extra selection scores false");
        }
      }
      if (item.type === "multi") {
        refuses(f, x => { answer(x, item.id).response = [item.choices[0], item.choices[0]]; }, "invalid_choice", "duplicate checkbox selection rejected");
        const separate = clone(f); removeAnswer(separate, item.id + "_other");
        check(run(separate).answers[item.id + "_other"] === null, "other text optional independently of selected choices");
        const otherOnly = clone(f); answer(otherOnly, item.id + "_other").response = "present without an Other choice";
        check(run(otherOnly).answers[item.id + "_other"] === "present without an Other choice", "generator's separate other text remains independent");
        const reverse = clone(f); answer(reverse, item.id).response = item.choices.slice().reverse();
        equal(run(reverse).answers[item.id], item.choices, "checkbox normalization follows instrument order");
      }
    }
    if (item.type === "scale") {
      for (const point of item.points || [1, 2, 3, 4]) {
        const scale = clone(f); answer(scale, item.id).response = String(point);
        check(run(scale).answers[item.id] === point, "every declared scale point accepted");
      }
      for (const invalid of ["0", "5", "1.5", "01", "1e0", NaN]) refuses(f, x => { answer(x, item.id).response = invalid; }, "invalid_scale", "undeclared scale point rejected");
    }
    if (item.type === "number") {
      for (const number of [item.min, item.max, 20.5]) {
        const range = clone(f); answer(range, item.id).response = String(number);
        check(run(range).answers[item.id] === number, "number bounds match existing min/max instrument contract");
      }
      for (const invalid of [String(item.min - 1), String(item.max + 1), "Infinity", "20 years", "0x20", "2e1"]) refuses(f, x => { answer(x, item.id).response = invalid; }, "invalid_number", "invalid/out of range age rejected");
    }
  }
  for (const row of f.trusted.registry.itemMap.filter(row => row.imageItemId)) refuses(f, x => x.event.itemResponses.push({ itemId: row.imageItemId, type: "IMAGE", response: "image" }), "invalid_response_item", "image cannot become a response");
  for (const property of ["experimentId", "instrumentVersion", "instrumentHash", "digest", "phase", "language"]) refuses(f, x => { x.trusted.registry[property] = "mismatch"; }, "instrument_mismatch", "registry pins " + property);
  refuses(f, x => { x.event.formId = "another-form"; }, "form_mismatch", "exact registered form required");
  refuses(f, x => { answer(x, "participant_id").response = "WXYZ99"; }, "participant_mismatch", "regex-valid handwritten ID cannot override verified identity");
  for (const participantId of ["abcd12", "AbCd12"]) {
    const mixedCase = clone(f); answer(mixedCase, "participant_id").response = participantId;
    equal(run(mixedCase).identity, f.trusted.identity, "generator-permitted case variants match verified uppercase identity");
  }
  for (const participantId of [" ABCD12", "ABCD12 ", "ABCD12\n", "ABC12", "ABCDE12", "ABCD123", "ABCD１2", "AB12CD", "ÄBCD12"]) refuses(f, x => { answer(x, "participant_id").response = participantId; }, "participant_mismatch", "participant input must match actual generator shape without trimming");
  for (const participantId of ["abcd12", "AbCd12", " ABCD12", "ABCD12 ", "ABCD12\n", "ABC12", "ABCD123"]) refuses(f, x => { x.trusted.identity.participant_id_normalized = participantId; }, "invalid_identity", "trusted participant identity must already have canonical uppercase shape");
  refuses(f, x => { delete x.trusted.identity.assignment_id; }, "invalid_identity", "participant text cannot replace trusted assignment");
  refuses(f, x => { x.event.itemResponses.push(clone(x.event.itemResponses[0])); }, "invalid_response_item", "duplicate item response rejected");
  refuses(f, x => { x.event.itemResponses.push({ itemId: "unknown", type: "TEXT", response: "injected" }); }, "invalid_response_item", "unknown item IDs rejected");
  refuses(f, x => { x.trusted.registry.itemMap.pop(); }, "invalid_item_map", "missing map row rejected");
  refuses(f, x => { x.trusted.registry.itemMap[1].sourceId = x.trusted.registry.itemMap[0].sourceId; }, "invalid_item_map", "duplicate source ID rejected");
  refuses(f, x => { x.trusted.registry.itemMap[1].itemId = x.trusted.registry.itemMap[0].itemId; }, "invalid_item_map", "duplicate Google item ID rejected");
  refuses(f, x => { x.trusted.registry.itemMap[1].sourceType = "text"; }, "invalid_item_map", "map source type must match instrument");
  refuses(f, x => { x.trusted.registry.itemMap[0].instrumentDigest = "bad"; }, "invalid_item_map", "each map row binds to instrument digest");
  refuses(f, x => { x.trusted.registry.itemMap[0].sourceId = "unknown"; }, "invalid_item_map", "unknown source map rejected");
  refuses(f, x => { x.keys.unknown = "A"; }, "invalid_answer_keys", "unknown scoring source rejected");
  refuses(f, x => { x.keys[Object.keys(x.keys)[0]] = "Z"; }, "invalid_answer_keys", "invalid key not silently scored");
  refuses(f, x => { x.event.submittedAt = "2026-09-25T01:00:04.000Z"; }, "invalid_timestamp", "future submission rejected");
  refuses(f, x => { x.event.submittedAt = "2026-02-30T01:00:00.000Z"; }, "invalid_timestamp", "invalid calendar date rejected");
  refuses(f, x => { x.event.submittedAt = "2026-09-25 01:00:00"; }, "invalid_timestamp", "timezone-free timestamp rejected");
  // Unknown input fields contain credential sentinels; no output/error may echo them.
  const secret = "DO-NOT-EXPORT-RAW-CREDENTIAL-87931";
  const injected = clone(f);
  for (const obj of [injected.trusted, injected.trusted.identity, injected.trusted.instrument, injected.trusted.registry, injected.event, ...injected.event.itemResponses, ...injected.trusted.registry.itemMap]) {
    obj.token = secret; obj.secret = secret; obj.rawCredential = secret;
    obj.respondentEmail = secret; obj.editResponseUrl = secret; obj.started_at = secret; obj.is_correct = secret;
  }
  equal(run(injected), clone(result), "allowlist ignores credentials, emails, URLs, submitted timing and scores");
  check(!JSON.stringify(run(injected)).includes(secret), "no secret field leakage");
  injected.event.itemResponses.push({ itemId: secret, type: secret, response: secret });
  checks++;
  assert.throws(() => run(injected), error => error.message === "forms_invalid_response_item" && !error.stack.includes(secret), "errors never echo raw inputs");
});
equal([...covered].sort(), ["multi", "notice", "number", "scale", "single", "text"], "all instrument item types covered");
console.log(JSON.stringify({ status: "passed", checks, forms: fixtures.length, productionReady: false, note: "Offline core only; no trigger, authentication, real submission, researcher review, or pilot." }, null, 2));
