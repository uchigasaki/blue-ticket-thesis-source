/** Production HTTP adapter. No public/shared API key is embedded in the site.
 * Disabled until the owner configures a separate production Sheet and the
 * actual content-bound review record. Installing this file enables nothing.
 */
function btsProductionCapacityValid_(value, maximum) {
  // Unlimited enrollment must be an explicit owner choice, never an omitted,
  // null, zero or malformed setting that silently disables a protection.
  return value === "unlimited" || Number.isInteger(value) && value >= 1 && value <= maximum;
}
function btsProductionValidateScheduleReview_(config, review, now) {
  var opened = asDate_(config.opensAt), closed = asDate_(config.closesAt);
  var enrollmentClosed = asDate_(config.enrollmentClosesAt);
  var enrollmentOpened = config.enrollmentOpensAt === undefined ? opened : asDate_(config.enrollmentOpensAt);
  if (!opened || !closed || opened >= closed || typeof config.enrollmentClosesAt !== "string" || !enrollmentClosed ||
      enrollmentClosed <= opened || enrollmentClosed >= closed || !enrollmentOpened || enrollmentOpened < opened || enrollmentOpened >= enrollmentClosed ||
      config.enrollmentOpensAt !== undefined && typeof config.enrollmentOpensAt !== "string") throw new Error("production_not_configured");
  if (config.completionClosesAt !== undefined) {
    var completionClosed = asDate_(config.completionClosesAt);
    if (typeof config.completionClosesAt !== "string" || !completionClosed || completionClosed < enrollmentClosed ||
        closed.getTime() < completionClosed.getTime() + 37 * 86400000) throw new Error("production_not_configured");
  }
  var reviewedAt = review && asDate_(review.reviewedAt);
  if (!review || typeof review.reviewer !== "string" || !review.reviewer.trim() || !reviewedAt || reviewedAt > now || review.contentSha256 !== config.contentHash ||
      !isPlainObject_(review.approvals) || ["noImageScenes", "improvedContent", "conditionNeutralPostSurvey", "lateEvaluationInstruments", "followupInstrumentAndUrl"].some(function(key) { return review.approvals[key] !== true; })) throw new Error("production_review_required");
}
function btsProductionSettings_(now, preparation) {
  now = now || new Date();
  var p = PropertiesService.getScriptProperties();
  if (preparation === true) {
    if (p.getProperty("BTS_HTTP_MODE") !== "disabled" || p.getProperty("BTS_PRODUCTION_ENABLED") !== "false" || p.getProperty("BTS_EMAIL_ENABLED") !== "false") throw new Error("production_disable_before_setup");
  } else if (p.getProperty("BTS_HTTP_MODE") !== "production" || p.getProperty("BTS_PRODUCTION_ENABLED") !== "true") throw new Error("production_disabled");
  var config, review;
  try { config = JSON.parse(p.getProperty("BTS_PRODUCTION_CONFIG") || "null"); review = JSON.parse(p.getProperty("BTS_PRODUCTION_REVIEW") || "null"); }
  catch (_) { throw new Error("production_not_configured"); }
  if (!isPlainObject_(config) || preparation !== true && !isPlainObject_(review)) throw new Error("production_not_configured");
  ["experimentId", "allocationVersion", "appVersion", "contentVersion", "commonCorrectionVersion", "instrumentVersion"].forEach(function(key) {
    if (typeof config[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(config[key])) throw new Error("production_not_configured");
  });
  if (/^bts-(?:http|smoke)-/.test(config.experimentId) || config.followupMode !== "google_forms" ||
      typeof config.spreadsheetId !== "string" || !config.spreadsheetId || config.spreadsheetId !== p.getProperty("BTS_SPREADSHEET_ID") ||
      config.spreadsheetId === p.getProperty("BTS_HTTP_TEST_SPREADSHEET_ID") ||
      !/^[a-f0-9]{64}$/.test(config.contentHash || "") || !/^[a-f0-9]{64}$/.test(config.instrumentHash || "") ||
      !/^https:\/\/[A-Za-z0-9.-]+\/(?:[A-Za-z0-9_.-]+\/)*$/.test(config.publicAppUrl || "") ||
      preparation !== true && (!btsProductionCapacityValid_(config.maxAssignments, 10000) ||
      !btsProductionCapacityValid_(config.maxDailyAssignments, 1000))) throw new Error("production_not_configured");
  var opened = asDate_(config.opensAt), closed = asDate_(config.closesAt);
  if (preparation !== true) {
    if (!opened || !closed || opened >= closed || now < opened || now >= closed) throw new Error("production_closed");
    btsProductionValidateScheduleReview_(config, review, now);
  }
  var followup = followupDeploymentSettings_();
  if (followup.publicUrl !== config.publicAppUrl || followup.instrumentVersion !== config.instrumentVersion || followup.instrumentHash !== config.instrumentHash ||
      !/^[a-f0-9]{64}$/.test(p.getProperty("BTS_PRODUCTION_PARTICIPANT_SECRET") || "")) throw new Error("production_not_configured");
  config.mode = "production";
  return config;
}

/** Only for creating CLOSED resources, not HTTP, triggers, publishing or mail. */
function btsProductionPreparationSettings_() {
  return btsProductionSettings_(new Date(), true);
}

function btsAssertProductionSpreadsheet_(spreadsheet, config) {
  var current = btsProductionSettings_(new Date());
  if (JSON.stringify(canonicalFollowupValue_(current)) !== JSON.stringify(canonicalFollowupValue_(config)) ||
      spreadsheet.getId() !== config.spreadsheetId || spreadsheet.getName().indexOf("BTS 後期3群比較 本番 ") !== 0) throw new Error("production_wrong_spreadsheet");
}

function btsProductionCleanInput_(input, depth) {
  depth = depth || 0;
  if (depth > 20) throw new Error("production_invalid_input");
  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "number") { if (!isFinite(input)) throw new Error("production_invalid_input"); return input; }
  if (typeof input === "string") { if (input.length > 20000) throw new Error("production_invalid_input"); return input; }
  if (Array.isArray(input)) {
    if (input.length > 2000) throw new Error("production_invalid_input");
    return input.map(function(value) { return btsProductionCleanInput_(value, depth + 1); });
  }
  if (!isPlainObject_(input)) throw new Error("production_invalid_input");
  var out = Object.create(null);
  Object.keys(input).forEach(function(key) {
    if (["__proto__", "constructor", "prototype"].indexOf(key) >= 0 || key.length > 160) throw new Error("production_invalid_input");
    if (["participant_token", "test_access_token"].indexOf(key) >= 0) {
      if (depth !== 0 || key === "test_access_token") throw new Error("production_invalid_input");
      return;
    }
    out[key] = btsProductionCleanInput_(input[key], depth + 1);
  });
  return out;
}

function btsProductionScope_(record, config) {
  if (!record || record.experiment_id !== config.experimentId || record.allocation_version !== config.allocationVersion ||
      BTS_STORES_.indexOf(record.store_id) < 0 || BTS_CONDITIONS_.indexOf(record.condition) < 0 ||
      !/^[A-Z]{4}\d{2}$/.test(record.participant_id_normalized || "") || record.schema_version && Number(record.schema_version) !== 2) throw new Error("production_parent_mismatch");
}

function btsProductionParticipantToken_(record) {
  var secret = PropertiesService.getScriptProperties().getProperty("BTS_PRODUCTION_PARTICIPANT_SECRET");
  if (!/^[a-f0-9]{64}$/.test(secret || "")) throw new Error("production_not_configured");
  return Utilities.computeHmacSha256Signature("bts-participant-v1|" + [record.experiment_id, record.allocation_version, record.assignment_id,
    record.participant_id_normalized, record.store_id, record.session_id, record.client_run_id].join("|"), secret)
    .map(function(b) { return ("0" + ((b + 256) % 256).toString(16)).slice(-2); }).join("");
}

function btsConstantTokenEqual_(actual, expected) {
  if (typeof actual !== "string" || !/^[a-f0-9]{64}$/.test(actual) || typeof expected !== "string" || expected.length !== 64) return false;
  var difference = 0;
  for (var i = 0; i < 64; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

function btsProductionAssignmentResponse_(record, reused, request, config) {
  btsProductionScope_(record, config);
  if (record.status !== "confirmed" || record.is_test === true || String(record.is_test) === "true" ||
      record.client_run_id !== request.clientRunId || record.session_id !== request.sessionId) throw new Error("production_session_conflict");
  var response = assignmentResponse_(record, reused, request);
  response.session_id = record.session_id;
  response.participant_token = btsProductionParticipantToken_(record);
  return response;
}

function btsProductionCheckEnrollment_(request, config, sheet, now) {
  if (request.experimentId !== config.experimentId || request.allocationVersion !== config.allocationVersion || request.appVersion !== config.appVersion ||
      !/^[A-Za-z0-9_-]{20,160}$/.test(request.clientRunId) || !/^[A-Za-z0-9_-]{20,160}$/.test(request.sessionId)) throw new Error("production_version_mismatch");
  now = now || new Date();
  var enrollmentClosed = asDate_(config.enrollmentClosesAt);
  if (typeof config.enrollmentClosesAt !== "string" || !enrollmentClosed) throw new Error("production_not_configured");
  var enrollmentOpened = asDate_(config.enrollmentOpensAt === undefined ? config.opensAt : config.enrollmentOpensAt);
  if (!enrollmentOpened) throw new Error("production_not_configured");
  if (now < enrollmentOpened) throw new Error("production_enrollment_not_open");
  // Called under the assignment lock only after an existing exact-session
  // record has been checked. Existing completion/receipt/follow-up/mail paths
  // keep using the longer operating deadline, not this intake deadline.
  if (now >= enrollmentClosed) throw new Error("production_enrollment_closed");
  if (!sheet) return;
  var records = readSheetObjects_(sheet, sheetDefinition_("Assignments")).filter(function(row) { return row.experiment_id === config.experimentId && row.allocation_version === config.allocationVersion; });
  var today = now.toISOString().slice(0, 10);
  if (config.maxAssignments !== "unlimited" && records.length >= config.maxAssignments ||
      config.maxDailyAssignments !== "unlimited" && records.filter(function(row) { return isoString_(row.assigned_at).slice(0, 10) === today; }).length >= config.maxDailyAssignments) throw new Error("production_capacity_reached");
}

function btsProductionVerifyParticipant_(spreadsheet, assignmentId, token, sessionId, config) {
  btsAssertProductionSpreadsheet_(spreadsheet, config);
  var row = httpFindRow_(spreadsheet, "Assignments", "assignment_id", assignmentId);
  btsProductionScope_(row && row.object, config);
  if (row.object.session_id !== sessionId || row.object.status !== "confirmed" || String(row.object.is_test) === "true" ||
      !btsConstantTokenEqual_(token, btsProductionParticipantToken_(row.object))) throw new Error("production_unauthorized");
  return row.object;
}

function btsProductionFollowupParent_(spreadsheet, record, config) {
  btsProductionScope_(record, config);
  var assignment = httpFindRow_(spreadsheet, "Assignments", "assignment_id", record.assignment_id);
  var participant = httpFindRow_(spreadsheet, "Participants", "submission_id", record.submission_id);
  var receipt = httpFindRow_(spreadsheet, "SubmissionReceipts", "submission_id", record.submission_id);
  [assignment, participant, receipt].forEach(function(row) {
    btsProductionScope_(row && row.object, config);
    ["assignment_id", "session_id", "participant_id_normalized", "store_id", "condition"].forEach(function(key) {
      if (row.object[key] !== record[key]) throw new Error("production_parent_mismatch");
    });
  });
  if (receipt.object.status !== "complete" || record.delivery_mode !== "google_forms" ||
      record.instrument_version !== config.instrumentVersion || record.instrument_hash !== config.instrumentHash ||
      record.content_version !== config.contentVersion || record.common_correction_version !== config.commonCorrectionVersion) throw new Error("production_parent_mismatch");
  return record;
}

function btsProductionGet_(parameters, now) {
  var config = btsProductionSettings_(now);
  var input = btsProductionCleanInput_(parameters);
  if (String(input.schema_version) !== "2") throw new Error("invalid_schema_version");
  if (parameters.participant_token && String(input.callback || "").indexOf(parameters.participant_token) >= 0) throw new Error("production_invalid_input");
  if (input.action === "assign") {
    if (!input.client_run_id || !input.session_id) throw new Error("production_invalid_input");
    var request = normalizeAssignmentRequest_(input);
    if (request.experimentId !== config.experimentId || request.allocationVersion !== config.allocationVersion || request.appVersion !== config.appVersion) throw new Error("production_version_mismatch");
    return assignParticipant_(request, null, config);
  }
  var spreadsheet = requireActiveSpreadsheet_();
  btsAssertProductionSpreadsheet_(spreadsheet, config);
  if (input.action === "receipt") {
    var receiptRequest = normalizeReceiptRequest_(input);
    var assignment = btsProductionVerifyParticipant_(spreadsheet, receiptRequest.assignmentId, parameters.participant_token, input.session_id, config);
    if (assignment.experiment_id !== receiptRequest.experimentId || assignment.allocation_version !== receiptRequest.allocationVersion ||
        assignment.participant_id_normalized !== receiptRequest.participantIdNormalized || assignment.store_id !== receiptRequest.storeId || assignment.condition !== receiptRequest.condition) throw new Error("production_parent_mismatch");
    return getReceiptStatus_(receiptRequest);
  }
  if (input.action === "followup") {
    if (["ja", "en"].indexOf(input.language) < 0) throw new Error("production_invalid_input");
    if (String(input.callback || "").indexOf(String(input.token || "!")) >= 0) throw new Error("production_invalid_input");
    var record = findFollowupByToken_(spreadsheet, input.token).object;
    btsProductionFollowupParent_(spreadsheet, record, config);
    var response = getFollowup_(input, now);
    response.measurement_mode = "forms";
    if (response.status === "ready") {
      if (typeof btsFormsFollowupLink_ !== "function") throw new Error("production_forms_unavailable");
      response.forms = btsFormsFollowupLink_(spreadsheet, record, input.language, now);
    }
    return response;
  }
  throw new Error("invalid_action");
}

function btsProductionValidatePayload_(payload, config, spreadsheet, now) {
  btsAssertProductionSpreadsheet_(spreadsheet, config);
  if (typeof btsValidateProductionPostImageExposure_ === "function") btsValidateProductionPostImageExposure_(payload);
  var assignment = btsProductionVerifyParticipant_(spreadsheet, payload.assignmentId, payload.productionToken, payload.sessionId, config);
  if (payload.experimentId !== config.experimentId || payload.allocationVersion !== config.allocationVersion || payload.appVersion !== config.appVersion ||
      payload.contentVersion !== config.contentVersion || payload.commonCorrectionVersion !== config.commonCorrectionVersion || payload.instrumentVersion !== config.instrumentVersion ||
      payload.clientRunId !== assignment.client_run_id || payload.participantIdNormalized !== assignment.participant_id_normalized || payload.storeId !== assignment.store_id || payload.condition !== assignment.condition ||
      payload.consent.given !== true || ["ja", "en"].indexOf(payload.language) < 0 || payload.followup.delivery_mode !== "google_forms" ||
      payload.followup.requested !== Boolean(payload.email)) throw new Error("production_payload_mismatch");
  var start = asDate_(payload.startTime), end = asDate_(payload.endTime), consent = asDate_(payload.consent.given_at);
  if (!start || !end || !consent || start > end || consent > end || end.getTime() > now.getTime() + 300000 || now.getTime() - end.getTime() > 7 * 86400000) throw new Error("production_invalid_time");
  if (payload.followup.requested && typeof btsFormsFollowupLink_ !== "function") throw new Error("production_forms_unavailable");
  ["Participants", "SubmissionReceipts"].forEach(function(name) {
    var found = httpFindRow_(spreadsheet, name, "assignment_id", payload.assignmentId);
    if (found && found.object.submission_id !== payload.submissionId) throw new Error("production_already_completed");
  });
  payload.questionLogs.forEach(function(log) {
    if (!isPlainObject_(log) || ["pre", "learning", "post"].indexOf(log.phase) < 0 ||
        log.experiment_id !== config.experimentId || log.assignment_id !== payload.assignmentId || log.session_id !== payload.sessionId ||
        log.participant_id_normalized !== payload.participantIdNormalized || log.store_id !== payload.storeId || log.condition !== payload.condition ||
        log.content_version !== config.contentVersion || log.common_correction_version !== config.commonCorrectionVersion || log.instrument_version !== config.instrumentVersion) throw new Error("production_log_mismatch");
  });
  var existing = httpFindRow_(spreadsheet, "SubmissionReceipts", "submission_id", payload.submissionId);
  if (existing && existing.object.payload_hash !== payload.productionPayloadHash) throw new Error("submission_id_conflict");
  // Exact saved retries remain recoverable, but a first completion after the
  // owner-approved deadline must not create follow-ups beyond service close.
  if (!existing && config.completionClosesAt !== undefined && now >= asDate_(config.completionClosesAt)) throw new Error("production_completion_closed");
}

function btsProductionPost_(body, now) {
  var config = btsProductionSettings_(now);
  var input = btsProductionCleanInput_(body);
  if (input.schema_version !== 2) throw new Error("invalid_schema_version");
  if (input.event_type && input.event_type !== "completion") throw new Error("production_forms_only");
  if (JSON.stringify(input).indexOf(String(body.participant_token || "!invalid!")) >= 0) throw new Error("production_invalid_input");
  var payload = normalizeCompletionPayload_(input, now);
  payload.productionToken = body.participant_token;
  payload.productionPayloadHash = sha256Hex_(JSON.stringify(canonicalFollowupValue_(input)));
  return persistCompletion_(payload, now, null, config);
}

/** Owner-only manual preparation. Never sends email or starts a trigger. */
function initializeBtsProductionParticipantSecret() {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty("BTS_PRODUCTION_ENABLED") === "true") throw new Error("production_disable_before_setup");
  if (!p.getProperty("BTS_PRODUCTION_PARTICIPANT_SECRET")) p.setProperty("BTS_PRODUCTION_PARTICIPANT_SECRET", sha256Hex_(Utilities.getUuid() + "|" + Utilities.getUuid()));
  return { configured: true, enabled: false };
}
