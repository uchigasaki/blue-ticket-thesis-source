/**
 * Offline, pure Forms response validation. NOT a trigger, authentication layer,
 * production connector, or an alternative entry point into Code.gs.
 * See docs/GOOGLE_FORMS_INGESTION.md before connecting this module.
 */
function normalizeFormsResponse_(trusted, event, ingestedAt, answerKeys) {
  function fail(code) { throw new Error("forms_" + code); }
  function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function nonempty(value) { return typeof value === "string" && value.trim().length > 0; }
  function safeId(value) { return nonempty(value) && ["__proto__", "prototype", "constructor"].indexOf(value) < 0; }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail("invalid_timestamp");
    var parsed = new Date(value);
    if (!isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail("invalid_timestamp");
    return parsed.getTime();
  }
  if (!object(trusted) || !object(trusted.identity) || !object(trusted.instrument) || !object(trusted.registry) || !object(event)) fail("invalid_context");
  var identity = {};
  ["experiment_id", "allocation_version", "assignment_id", "session_id", "participant_id_normalized", "store_id", "condition"].forEach(function (key) {
    if (!nonempty(trusted.identity[key])) fail("invalid_identity");
    identity[key] = trusted.identity[key];
  });
  if (identity.participant_id_normalized.length !== 6 || !/^[A-Z]{4}[0-9]{2}$/.test(identity.participant_id_normalized)) fail("invalid_identity");
  // This is an identity supplied by the caller, NOT evidence of authentication.
  var instrument = trusted.instrument;
  var registry = trusted.registry;
  ["experimentId", "instrumentVersion", "instrumentHash", "digest", "phase", "language"].forEach(function (key) {
    if (!nonempty(instrument[key]) || registry[key] !== instrument[key]) fail("instrument_mismatch");
  });
  if (identity.experiment_id !== instrument.experimentId ||
      !/^[a-f0-9]{64}$/.test(instrument.instrumentHash) || !/^[a-f0-9]{64}$/.test(instrument.digest) ||
      ["pre", "post", "followup"].indexOf(instrument.phase) < 0 || ["ja", "en"].indexOf(instrument.language) < 0) fail("instrument_mismatch");
  if (!nonempty(registry.formId) || event.formId !== registry.formId || !nonempty(event.responseId)) fail("form_mismatch");
  // Google and server times must be independently extracted, never synthesized.
  var submittedMs = date(event.submittedAt);
  if (submittedMs > date(ingestedAt)) fail("invalid_timestamp");
  if (!Array.isArray(instrument.items) || !instrument.items.length || !Array.isArray(registry.itemMap) || !Array.isArray(event.itemResponses)) fail("invalid_context");

  var googleTypes = { single: "MULTIPLE_CHOICE", multi: "CHECKBOX", scale: "SCALE", number: "TEXT", text: "PARAGRAPH_TEXT", notice: "SECTION_HEADER" };
  var specs = Object.create(null);
  var ordered = [];
  function add(spec) {
    if (!safeId(spec.id) || own(specs, spec.id)) fail("invalid_instrument");
    specs[spec.id] = spec;
    ordered.push(spec);
  }
  add({ id: "participant_id", type: "text", googleType: "TEXT", required: true, identityOnly: true });
  instrument.items.forEach(function (source) {
    if (!object(source) || !safeId(source.id) || !own(googleTypes, source.type) ||
        (own(source, "optional") && typeof source.optional !== "boolean")) fail("invalid_instrument");
    var spec = { id: source.id, type: source.type, googleType: googleTypes[source.type], required: source.optional !== true, image: !!source.image };
    if (source.type === "single" || source.type === "multi") {
      if (!Array.isArray(source.choices) || !source.choices.length) fail("invalid_instrument");
      spec.choices = source.choices.slice();
      spec.choices.forEach(function (choice, index) {
        if (!nonempty(choice) || spec.choices.indexOf(choice) !== index) fail("invalid_instrument");
      });
    }
    if (source.type === "scale") {
      spec.points = source.points === undefined ? [1, 2, 3, 4] : source.points;
      if (!Array.isArray(spec.points) || spec.points.length < 3 || [0, 1].indexOf(spec.points[0]) < 0 || spec.points[spec.points.length - 1] < 3 || spec.points[spec.points.length - 1] > 10) fail("invalid_instrument");
      spec.points.forEach(function (point, index) { if (point !== spec.points[0] + index) fail("invalid_instrument"); });
    }
    if (source.type === "number") {
      if (typeof source.min !== "number" || !isFinite(source.min) || typeof source.max !== "number" || !isFinite(source.max) || source.min > source.max) fail("invalid_instrument");
      spec.min = source.min; spec.max = source.max;
    }
    add(spec);
    // Mirrors the generator: every multi has an independent optional TEXT item.
    if (source.type === "multi") add({ id: source.id + "_other", type: "other_text", googleType: "TEXT", required: false });
  });

  var byItemId = Object.create(null);
  var mappedSources = Object.create(null);
  function registerItem(id, spec) {
    if (!safeId(id) || own(byItemId, id)) fail("invalid_item_map");
    byItemId[id] = spec;
  }
  if (registry.itemMap.length !== ordered.length) fail("invalid_item_map");
  registry.itemMap.forEach(function (row) {
    if (!object(row) || !safeId(row.sourceId) || !own(specs, row.sourceId) || own(mappedSources, row.sourceId)) fail("invalid_item_map");
    var spec = specs[row.sourceId];
    if (row.sourceType !== spec.type || row.instrumentDigest !== instrument.digest) fail("invalid_item_map");
    registerItem(row.itemId, spec);
    if (spec.image) registerItem(row.imageItemId, { type: "image" });
    else if (row.imageItemId !== "" && row.imageItemId !== null && row.imageItemId !== undefined) fail("invalid_item_map");
    mappedSources[spec.id] = true;
  });

  // Keys are optional and supplied explicitly by the trusted server only.
  var scoringKeys = Object.create(null);
  if (answerKeys !== undefined) {
    if (!object(answerKeys)) fail("invalid_answer_keys");
    Object.keys(answerKeys).forEach(function (id) {
      if (!own(specs, id) || ["single", "multi"].indexOf(specs[id].type) < 0) fail("invalid_answer_keys");
      var spec = specs[id];
      var codes = spec.choices.map(function (choice) {
        // Parse trusted complete choices only, after exact response membership.
        var match = choice.match(/^([A-Z])(?:[.．、:\s]|$)/);
        if (!match) fail("invalid_answer_keys");
        return match[1];
      });
      codes.forEach(function (code, index) { if (codes.indexOf(code) !== index) fail("invalid_answer_keys"); });
      var key = answerKeys[id];
      if (spec.type === "single" ? typeof key !== "string" : !Array.isArray(key)) fail("invalid_answer_keys");
      var values = Array.isArray(key) ? key.slice() : [key];
      if (!values.length) fail("invalid_answer_keys");
      values.forEach(function (value, index) { if (typeof value !== "string" || codes.indexOf(value) < 0 || values.indexOf(value) !== index) fail("invalid_answer_keys"); });
      scoringKeys[id] = { codes: codes, expected: values.sort() };
    });
  }

  var provided = Object.create(null);
  var seen = Object.create(null);
  event.itemResponses.forEach(function (row) {
    if (!object(row) || !safeId(row.itemId) || !own(byItemId, row.itemId) || own(seen, row.itemId)) fail("invalid_response_item");
    seen[row.itemId] = true;
    var spec = byItemId[row.itemId];
    if (spec.type === "notice" || spec.type === "image" || row.type !== spec.googleType || !own(row, "response")) fail("invalid_response_item");
    provided[spec.id] = row.response;
  });
  var answers = {};
  var records = [];
  ordered.forEach(function (spec) {
    if (spec.type === "notice") return;
    var present = own(provided, spec.id);
    var value = present ? provided[spec.id] : undefined;
    if (present && (spec.type === "multi" ? !Array.isArray(value) :
        spec.type === "scale" ? typeof value !== "string" && typeof value !== "number" : typeof value !== "string")) fail("invalid_answer_type");
    var empty = !present || (Array.isArray(value) ? !value.length : typeof value === "string" && !value.trim());
    if (empty && spec.required) fail("required_answer_missing");
    if (empty) value = spec.type === "multi" ? [] : null;
    else if (spec.identityOnly) {
      // No regex-shaped ID, display title, condition, or store field establishes identity.
      if (value.length !== 6 || !/^[A-Za-z]{4}[0-9]{2}$/.test(value) || value.toUpperCase() !== identity.participant_id_normalized) fail("participant_mismatch");
    } else if (spec.type === "single") {
      if (spec.choices.indexOf(value) < 0) fail("invalid_choice");
    } else if (spec.type === "multi") {
      value.forEach(function (choice, index) { if (typeof choice !== "string" || spec.choices.indexOf(choice) < 0 || value.indexOf(choice) !== index) fail("invalid_choice"); });
      // A checkbox response has set semantics, with stable instrument order.
      value = spec.choices.filter(function (choice) { return value.indexOf(choice) >= 0; });
    } else if (spec.type === "scale") {
      if (spec.points.map(String).indexOf(String(value)) < 0) fail("invalid_scale");
      value = Number(value);
    } else if (spec.type === "number") {
      // TEXT number responses remain strings until syntax/range are checked.
      if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) fail("invalid_number");
      value = Number(value);
      if (!isFinite(value) || value < spec.min || value > spec.max) fail("invalid_number");
    }
    if (spec.identityOnly) return;
    var correct = null;
    if (own(scoringKeys, spec.id) && !empty) {
      var key = scoringKeys[spec.id];
      var selected = (Array.isArray(value) ? value : [value]).map(function (choice) { return key.codes[spec.choices.indexOf(choice)]; }).sort();
      correct = same(selected, key.expected);
    }
    answers[spec.id] = value;
    records.push({ question_id: spec.id, source_type: spec.type, selected_answer: Array.isArray(value) ? value.slice() : value,
      is_correct: correct, measurement_mode: "forms", question_started_at: null, answered_at: null,
      response_time_ms: null, screen_dwell_time_ms: null, answer_change_count: null });
  });
  // Fixed allowlist. Never spread/serialize input identity, event, registry, keys,
  // credential, token, respondent email, response URL, or unknown input fields.
  return { schema_version: "bts.forms.normalized.v1", measurement_mode: "forms", identity: identity,
    phase: instrument.phase, language: instrument.language, instrument_version: instrument.instrumentVersion,
    instrument_hash: instrument.instrumentHash, instrument_digest: instrument.digest,
    form_id: registry.formId, google_response_id: event.responseId,
    google_submitted_at: event.submittedAt, ingested_at: ingestedAt,
    started_at: null, completed_at: null, response_time_ms: null, screen_dwell_time_ms: null, answer_change_count: null,
    question_logs: [], answers: answers, answer_records: records };
}
