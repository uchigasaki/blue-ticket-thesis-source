/**
 * Blue Ticket Simulator - 後期3群比較実験用 Google Apps Script
 *
 * このスクリプトは、必ず新しいテスト用スプレッドシートと新しい
 * Webアプリデプロイで検証してから利用してください。既存の前期用
 * エンドポイントやスプレッドシートへ直接上書きしないでください。
 *
 * スプレッドシートID、APIキー、秘密値はコードへ埋め込まない設計です。
 * コンテナバインドされたスプレッドシートを使用します。
 */

var BTS_CONDITIONS_ = ["no_image", "original", "improved"];
var BTS_STORES_ = ["A", "B", "C"];
var BTS_SCHEMA_VERSION_ = 2;
var BTS_DEFAULT_EXPERIMENT_ID_ = "blue-ticket-simulator-late-3group";
var BTS_DEFAULT_ALLOCATION_VERSION_ = "2026-late-v1";
var BTS_ASSIGNMENT_METHOD_ = "gas_min_count_v1";
var BTS_LOCK_TIMEOUT_MS_ = 15000;
var BTS_MAX_POST_BYTES_ = 1000000;
var BTS_SPREADSHEET_PROPERTY_ = "BTS_SPREADSHEET_ID";

var BTS_SHEETS_ = [
  {
    name: "logs",
    headers: [
      // Legacy v1 columns: keep these first nine columns and their order unchanged.
      "created_at",
      "session_id",
      "participant_id",
      "email",
      "language",
      "summary_json",
      "pre_survey_json",
      "post_survey_json",
      "answers_json",
      // v2 extension columns: append only.
      "schema_version",
      "submission_id",
      "experiment_id",
      "app_version",
      "participant_id_normalized",
      "store_id",
      "condition",
      "experiment_date",
      "start_time",
      "end_time",
      "assignment_id",
      "allocation_version",
      "allocation_method",
      "allocation_status",
      "consent_json",
      "phase_times_json",
      "client_run_id",
      "content_version",
      "common_correction_version",
      "instrument_version"
    ]
  },
  {
    name: "followup_queue",
    headers: [
      // Legacy v1 columns: keep these first eleven columns and their order unchanged.
      "created_at",
      "send_at",
      "sent_at",
      "session_id",
      "participant_id",
      "email",
      "language",
      "delivery_mode",
      "forms_json",
      "subject",
      "body",
      // v2 extension columns: append only.
      "followup_id",
      "submission_id",
      "experiment_id",
      "assignment_id",
      "participant_id_normalized",
      "store_id",
      "condition",
      "status",
      "last_error"
    ]
  },
  {
    name: "Assignments",
    headers: [
      "assigned_at",
      "assignment_id",
      "request_id",
      "experiment_id",
      "allocation_version",
      "session_id",
      "participant_id",
      "participant_id_normalized",
      "participant_key",
      "store_id",
      "condition",
      "assignment_method",
      "client_candidate_condition",
      "counts_before_json",
      "status",
      "is_test",
      "client_run_id"
    ]
  },
  {
    name: "Participants",
    headers: [
      "received_at",
      "submission_id",
      "schema_version",
      "experiment_id",
      "app_version",
      "assignment_id",
      "allocation_version",
      "allocation_method",
      "allocation_status",
      "session_id",
      "participant_id",
      "participant_id_normalized",
      "store_id",
      "condition",
      "language",
      "experiment_date",
      "start_time",
      "simulation_completed_at",
      "end_time",
      "consent_version",
      "consent_given",
      "consent_given_at",
      "overall_accuracy",
      "situation_score",
      "system_score",
      "completion_status",
      "client_run_id",
      "content_version",
      "common_correction_version",
      "instrument_version"
    ]
  },
  {
    name: "QuestionLogs",
    headers: [
      "received_at",
      "event_id",
      "submission_id",
      "schema_version",
      "experiment_id",
      "assignment_id",
      "session_id",
      "participant_id",
      "participant_id_normalized",
      "store_id",
      "condition",
      "phase",
      "question_id",
      "question_order",
      "attempt_no",
      "selected_answer",
      "correct_answer",
      "is_correct",
      "response_time_ms",
      "question_started_at",
      "answered_at",
      "timestamp",
      "answer_change_count",
      "screen_dwell_time_ms",
      "feedback_started_at",
      "feedback_ended_at",
      "explanation_view_time_ms",
      "content_version",
      "common_correction_version",
      "instrument_version"
    ]
  },
  {
    name: "Contact",
    headers: [
      "created_at",
      "contact_id",
      "followup_id",
      "submission_id",
      "experiment_id",
      "assignment_id",
      "session_id",
      "participant_id",
      "participant_id_normalized",
      "store_id",
      "condition",
      "email",
      "language",
      "send_at",
      "sent_at",
      "status",
      "last_error"
    ]
  },
  {
    name: "FollowUp",
    headers: [
      "created_at",
      "followup_id",
      "submission_id",
      "experiment_id",
      "assignment_id",
      "session_id",
      "participant_id",
      "participant_id_normalized",
      "store_id",
      "condition",
      "requested",
      "send_at",
      "delivery_mode",
      "forms_json",
      "response_completed_at",
      "answers_json",
      "status",
      "allocation_version",
      "token_hash",
      "token_expires_at",
      "window_ends_at",
      "instrument_version",
      "instrument_hash",
      "response_submission_id",
      "response_received_at",
      "response_started_at",
      "response_language",
      "response_timing",
      "response_payload_hash",
      "question_ids_json",
      "optional_question_ids_json",
      "content_version",
      "common_correction_version"
    ]
  },
  {
    name: "SubmissionReceipts",
    headers: [
      "received_at",
      "submission_id",
      "schema_version",
      "experiment_id",
      "session_id",
      "participant_id",
      "participant_id_normalized",
      "store_id",
      "condition",
      "status",
      "completed_at",
      "last_error",
      "assignment_id",
      "allocation_version",
      "event_type",
      "followup_id",
      "payload_hash"
    ]
  }
];

/**
 * JSONP assignment and receipt-status endpoint.
 *
 * Disabled by default. Every route requires the short-lived test-only gate
 * documented in docs/GAS_AND_SHEETS.md, or the separate production adapter.
 */
function doGet(e) {
  var parameters = e && e.parameter ? e.parameter : {};
  var callback = stringValue_(parameters.callback).trim();

  var submittedCredential = stringValue_(parameters.test_access_token);
  if (!isValidCallback_(callback) || (/^[a-f0-9]{64}$/.test(submittedCredential) && callback.indexOf(submittedCredential) !== -1)) {
    return jsonOutput_({
      ok: false,
      error: "invalid_callback",
      message: "callback must be a simple JavaScript identifier of 1-64 characters."
    });
  }

  try {
    if (PropertiesService.getScriptProperties().getProperty("BTS_HTTP_MODE") === "production") {
      if (typeof btsProductionGet_ !== "function") throw new Error("production_disabled");
      return jsonpOutput_(callback, btsProductionGet_(parameters, new Date()));
    }
    var gate = authorizeHttpTest_(parameters, new Date());
    var cleanParameters = withoutHttpTestCredential_(parameters);
    assertHttpTestData_(cleanParameters, 0, gate.accessToken);
    if (Number(cleanParameters.schema_version) !== 2 || String(cleanParameters.schema_version) !== "2") throw new Error("http_test_schema_required");
    var result;
    if (parameters.action === "assign") {
      assertHttpTestScope_(cleanParameters, gate);
      result = assignParticipant_(normalizeAssignmentRequest_(cleanParameters), gate);
    } else if (parameters.action === "receipt") {
      assertHttpTestScope_(cleanParameters, gate);
      result = getReceiptStatus_(normalizeReceiptRequest_(cleanParameters), gate);
    } else if (parameters.action === "followup") {
      result = getFollowup_(cleanParameters, new Date(), gate);
    } else {
      throw new Error("invalid_action");
    }
    return jsonpOutput_(callback, result);
  } catch (error) {
    return jsonpOutput_(callback, {
      ok: false,
      error: publicErrorCode_(error),
      message: publicErrorMessage_(error)
    });
  }
}

/**
 * Completion endpoint. Test mode accepts synthetic v2 payloads only.
 * Legacy v1 compatibility remains internal and is never exposed by this route.
 */
function doPost(e) {
  var receivedAt = new Date();

  try {
    var contents = e && e.postData ? stringValue_(e.postData.contents) : "";
    if (!contents) throw new Error("empty_body");
    if (contents.length > BTS_MAX_POST_BYTES_) throw new Error("payload_too_large");

    var body;
    try {
      body = JSON.parse(contents);
    } catch (_parseError) {
      throw new Error("invalid_json");
    }

    if (PropertiesService.getScriptProperties().getProperty("BTS_HTTP_MODE") === "production") {
      if (typeof btsProductionPost_ !== "function") throw new Error("production_disabled");
      return jsonOutput_(btsProductionPost_(body, receivedAt));
    }
    var gate = authorizeHttpTest_(body, receivedAt);
    body = withoutHttpTestCredential_(body);
    assertHttpTestData_(body, 0, gate.accessToken);
    assertHttpSyntheticAnswers_(body);
    if (body.schema_version !== 2) throw new Error("http_test_schema_required");
    assertHttpTestScope_(body, gate);
    assertHttpNestedIdentity_(body, body, gate);

    var result;
    if (body && body.event_type === "followup") {
      result = persistFollowupResponse_(body, receivedAt, gate);
    } else {
      if (body && body.event_type && body.event_type !== "completion") throw new Error("invalid_event_type");
      var payload = normalizeCompletionPayload_(body, receivedAt);
      result = persistCompletion_(payload, receivedAt, gate);
    }
    return jsonOutput_(result);
  } catch (error) {
    return jsonOutput_({
      ok: false,
      error: publicErrorCode_(error),
      message: publicErrorMessage_(error)
    });
  }
}

/** The isolated test path requires ALL short-lived test-only settings.
 * Production uses the separate Production.gs gate. Never put this test access
 * token in source, logs, returned data, or participant links.
 */
function httpTestSettings_(now) {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty("BTS_HTTP_MODE") !== "test" || p.getProperty("BTS_EMAIL_ENABLED") !== "false") throw new Error("http_test_disabled");
  var expiresText = stringValue_(p.getProperty("BTS_HTTP_TEST_EXPIRES_AT"));
  var expires = asDate_(expiresText);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiresText) || !expires ||
      expires.getTime() <= now.getTime() || expires.getTime() > now.getTime() + 86400000) throw new Error("http_test_disabled");
  var experiment = stringValue_(p.getProperty("BTS_HTTP_TEST_EXPERIMENT_ID"));
  var allocation = stringValue_(p.getProperty("BTS_HTTP_TEST_ALLOCATION_VERSION"));
  var token = stringValue_(p.getProperty("BTS_HTTP_TEST_ACCESS_TOKEN"));
  var spreadsheetId = stringValue_(p.getProperty("BTS_HTTP_TEST_SPREADSHEET_ID"));
  if (!/^bts-(?:http|smoke)-[A-Za-z0-9_-]{1,100}$/.test(experiment) ||
      !/^bts-(?:http|smoke)-[A-Za-z0-9_-]{1,100}$/.test(allocation) ||
      !/^[a-f0-9]{64}$/.test(token) || !spreadsheetId || spreadsheetId !== p.getProperty(BTS_SPREADSHEET_PROPERTY_)) throw new Error("http_test_disabled");
  var participants;
  try { participants = JSON.parse(p.getProperty("BTS_HTTP_TEST_PARTICIPANTS") || "null"); }
  catch (_error) { throw new Error("http_test_disabled"); }
  if (!isPlainObject_(participants) || !Object.keys(participants).length || Object.keys(participants).length > 30 ||
      Object.keys(participants).some(function(id) { return !/^QA[A-Z]{2}\d{2}$/.test(id) || BTS_STORES_.indexOf(participants[id]) < 0; })) throw new Error("http_test_disabled");
  return { experimentId: experiment, allocationVersion: allocation, participants: participants,
    spreadsheetId: spreadsheetId, accessToken: token, expiresAt: expiresText };
}

function authorizeHttpTest_(input, now) {
  var gate = httpTestSettings_(now);
  var candidate = isPlainObject_(input) ? stringValue_(input.test_access_token) : "";
  if (!/^[a-f0-9]{64}$/.test(candidate)) throw new Error("http_test_unauthorized");
  var difference = 0;
  for (var i = 0; i < 64; i += 1) difference |= candidate.charCodeAt(i) ^ gate.accessToken.charCodeAt(i);
  if (difference) throw new Error("http_test_unauthorized");
  return gate;
}

function withoutHttpTestCredential_(input) {
  // JSON own __proto__ must not become an inherited email/identity during copy.
  var output = Object.create(null);
  Object.keys(input).forEach(function(key) { if (key !== "test_access_token") output[key] = input[key]; });
  return output;
}

function initializeBtsHttpTestSecret() {
  var p = PropertiesService.getScriptProperties();
  var created = !p.getProperty("BTS_HTTP_TEST_ACCESS_TOKEN");
  if (created) p.setProperty("BTS_HTTP_TEST_ACCESS_TOKEN", sha256Hex_(Utilities.getUuid() + "|" + Utilities.getUuid()));
  // Deliberately neither enable HTTP nor print/return the credential.
  return { created: created, property: "BTS_HTTP_TEST_ACCESS_TOKEN" };
}

function assertHttpTestData_(value, depth, credential) {
  depth = depth || 0;
  if (depth > 20) throw new Error("http_test_data_rejected");
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    // Synthetic tests use codes/opaque IDs/timestamps, never prose, addresses,
    // names or real questionnaire text. This is not a general-purpose PII detector.
    if (value.length > 180 || !/^[A-Za-z0-9_:.+\/-]*$/.test(value) || (credential && value.indexOf(credential) !== -1)) throw new Error("http_test_data_rejected");
    return;
  }
  if (!Array.isArray(value) && !isPlainObject_(value)) throw new Error("http_test_data_rejected");
  Object.keys(value).forEach(function(key) {
    if (["__proto__", "constructor", "prototype"].indexOf(key) !== -1) throw new Error("http_test_data_rejected");
    assertHttpTestData_(key, depth + 1, credential);
    var normalizedKey = key.toLowerCase().replace(/[^a-z]/g, "");
    if (["email", "emailaddress", "mail", "mailaddress", "name", "fullname", "firstname", "lastname", "displayname", "address", "phone", "phonenumber", "telephone", "contact", "birthday", "birthdate", "dateofbirth", "freetext", "comment", "othertext", "emailpreview", "testaccesstoken"].indexOf(normalizedKey) >= 0 &&
        value[key] !== "" && value[key] !== null && value[key] !== undefined) throw new Error("http_test_data_rejected");
    assertHttpTestData_(value[key], depth + 1, credential);
  });
}

function assertHttpSyntheticAnswers_(body) {
  function answer(value) {
    if (value === null || typeof value === "number" || typeof value === "boolean") return;
    if (typeof value === "string" && /^(?:[A-F]|yes|no|none|true|false|[0-9]{1,3}|)$/.test(value)) return;
    if (Array.isArray(value)) { value.forEach(answer); return; }
    if (isPlainObject_(value)) { Object.keys(value).forEach(function(key) { if (!/^[A-F]$/.test(key)) throw new Error("http_test_data_rejected"); answer(value[key]); }); return; }
    throw new Error("http_test_data_rejected");
  }
  ["pre_survey", "post_survey"].forEach(function(key) {
    if (body[key] && (!isPlainObject_(body[key]) || Object.keys(body[key]).length)) throw new Error("http_test_data_rejected");
  });
  if (body.summary && (!isPlainObject_(body.summary) || Object.keys(body.summary).some(function(key) {
    return ["synthetic_http", "synthetic_smoke", "overall_accuracy"].indexOf(key) < 0 ||
      ["number", "boolean"].indexOf(typeof body.summary[key]) < 0;
  }))) throw new Error("http_test_data_rejected");
  if (body.event_type === "followup") {
    if (!isPlainObject_(body.answers)) throw new Error("http_test_data_rejected");
    Object.keys(body.answers).forEach(function(key) { answer(body.answers[key]); });
  } else if (body.answers && (!Array.isArray(body.answers) || body.answers.length)) throw new Error("http_test_data_rejected");
  if (body.question_logs && !Array.isArray(body.question_logs)) throw new Error("http_test_data_rejected");
  (body.question_logs || []).forEach(function(row) {
    if (!isPlainObject_(row)) throw new Error("http_test_data_rejected");
    if (hasOwn_(row, "selected_answer")) answer(row.selected_answer);
    if (hasOwn_(row, "correct_answer")) answer(row.correct_answer);
  });
}

function httpIdentity_(value) {
  return {
    experimentId: stringValue_(value.experiment_id !== undefined ? value.experiment_id : value.experimentId),
    allocationVersion: stringValue_(value.allocation_version !== undefined ? value.allocation_version : value.allocationVersion || (value.allocation || {}).allocation_version),
    participantIdNormalized: stringValue_(value.participant_id_normalized || value.participantIdNormalized || value.participant_id || value.participantId).toUpperCase(),
    storeId: stringValue_(value.store_id || value.storeId || value.store).toUpperCase()
  };
}

function assertHttpTestScope_(value, gate) {
  var identity = httpIdentity_(value);
  if (identity.experimentId !== gate.experimentId || identity.allocationVersion !== gate.allocationVersion ||
      !hasOwn_(gate.participants, identity.participantIdNormalized) || gate.participants[identity.participantIdNormalized] !== identity.storeId) throw new Error("http_test_scope_rejected");
  ["participant_id", "participantId", "participant_id_normalized", "participantIdNormalized"].forEach(function(key) {
    if (hasOwn_(value, key) && stringValue_(value[key]).toUpperCase() !== identity.participantIdNormalized) throw new Error("http_test_scope_rejected");
  });
  return identity;
}

function assertHttpNestedIdentity_(value, parent, gate) {
  if (!value || typeof value !== "object") return;
  var identity = assertHttpTestScope_(parent, gate);
  var expected = { experiment_id: identity.experimentId, allocation_version: identity.allocationVersion,
    participant_id: identity.participantIdNormalized, participant_id_normalized: identity.participantIdNormalized,
    store_id: identity.storeId, condition: parent.condition, session_id: parent.session_id,
    assignment_id: parent.assignment_id || (parent.allocation || {}).assignment_id };
  Object.keys(value).forEach(function(key) {
    if (hasOwn_(expected, key) && expected[key] !== undefined && stringValue_(value[key]) !== stringValue_(expected[key])) throw new Error("http_test_scope_rejected");
    if (value[key] && typeof value[key] === "object") assertHttpNestedIdentity_(value[key], parent, gate);
  });
}

function assertHttpTestSpreadsheet_(spreadsheet, gate) {
  var current = httpTestSettings_(new Date());
  if (JSON.stringify(canonicalFollowupValue_(current)) !== JSON.stringify(canonicalFollowupValue_(gate)) ||
      spreadsheet.getId() !== gate.spreadsheetId || spreadsheet.getName().indexOf("BTS 後期3群比較 接続検証 ") !== 0) throw new Error("http_test_disabled");
}

function assertHttpStoredScope_(row, gate, expected) {
  if (!row) throw new Error("http_test_parent_rejected");
  var identity = assertHttpTestScope_(row, gate);
  if (row.email || row.sent_at || (hasOwn_(row, "schema_version") && String(row.schema_version) !== "2")) throw new Error("http_test_parent_rejected");
  if (expected && JSON.stringify(identity) !== JSON.stringify(assertHttpTestScope_(expected, gate))) throw new Error("http_test_parent_rejected");
  return row;
}

function httpFindRow_(spreadsheet, sheetName, key, value) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  return sheet ? findRowByValue_(sheet, sheetDefinition_(sheetName), key, value) : null;
}

function assertHttpLogScope_(spreadsheet, row, gate, expected) {
  // Historic QuestionLogs has no allocation_version column; resolve it through
  // its actual stored assignment instead of changing existing rows or hashes.
  var assignment = httpFindRow_(spreadsheet, "Assignments", "assignment_id", row.assignment_id);
  assertHttpStoredScope_(assignment && assignment.object, gate, expected);
  var resolved = {};
  Object.keys(row).forEach(function(key) { resolved[key] = row[key]; });
  resolved.allocation_version = assignment.object.allocation_version;
  assertHttpStoredScope_(resolved, gate, expected);
  if (row.condition !== assignment.object.condition) throw new Error("http_test_parent_rejected");
}

function assertHttpParentChain_(spreadsheet, row, gate, requireParticipant) {
  assertHttpStoredScope_(row, gate);
  var assignment = httpFindRow_(spreadsheet, "Assignments", "assignment_id", row.assignment_id);
  assertHttpStoredScope_(assignment && assignment.object, gate, row);
  if (assignment.object.condition !== row.condition) throw new Error("http_test_parent_rejected");
  var parentId = row.event_type === "followup" ? "" : row.submission_id;
  var followup = row.followup_id ? httpFindRow_(spreadsheet, "FollowUp", "followup_id", row.followup_id)
    : row.submission_id ? httpFindRow_(spreadsheet, "FollowUp", "submission_id", row.submission_id) : null;
  if (followup) {
    assertHttpStoredScope_(followup.object, gate, row);
    parentId = followup.object.submission_id;
    if (followup.object.assignment_id !== row.assignment_id || followup.object.condition !== row.condition || followup.object.session_id !== row.session_id) throw new Error("http_test_parent_rejected");
  } else if (row.event_type === "followup" || row.followup_id) throw new Error("http_test_parent_rejected");
  var parent = parentId ? httpFindRow_(spreadsheet, "Participants", "submission_id", parentId) : null;
  if (parent) {
    assertHttpStoredScope_(parent.object, gate, row);
    if (parent.object.assignment_id !== row.assignment_id || parent.object.condition !== row.condition || parent.object.session_id !== row.session_id) throw new Error("http_test_parent_rejected");
  } else if (requireParticipant) throw new Error("http_test_parent_rejected");
  if (parentId) {
    var legacy = httpFindRow_(spreadsheet, "logs", "submission_id", parentId);
    if (legacy) {
      assertHttpStoredScope_(legacy.object, gate, row);
      if (legacy.object.assignment_id !== row.assignment_id || legacy.object.condition !== row.condition || legacy.object.session_id !== row.session_id) throw new Error("http_test_parent_rejected");
    }
    // Legacy logs can contain email; any linked Contact/queue is disallowed
    // even when a caller presents an otherwise valid synthetic parent/token.
    if (httpFindRow_(spreadsheet, "Contact", "submission_id", parentId) ||
        httpFindRow_(spreadsheet, "followup_queue", "submission_id", parentId)) throw new Error("http_test_parent_rejected");
  }
}

function assertHttpCompletionRows_(spreadsheet, payload, gate) {
  var identity = { experiment_id: payload.experimentId, allocation_version: payload.allocationVersion,
    participant_id_normalized: payload.participantIdNormalized, store_id: payload.storeId,
    assignment_id: payload.assignmentId, session_id: payload.sessionId, condition: payload.condition,
    submission_id: payload.submissionId };
  assertHttpParentChain_(spreadsheet, identity, gate, false);
  ["logs", "Participants", "SubmissionReceipts", "FollowUp", "Contact", "followup_queue"].forEach(function(name) {
    var existing = httpFindRow_(spreadsheet, name, "submission_id", payload.submissionId);
    if (existing) {
      if (name === "Contact" || name === "followup_queue") throw new Error("http_test_parent_rejected");
      assertHttpStoredScope_(existing.object, gate, identity);
      assertHttpParentChain_(spreadsheet, existing.object, gate, false);
    }
  });
  payload.questionLogs.forEach(function(row) {
    var existing = httpFindRow_(spreadsheet, "QuestionLogs", "event_id", row.event_id);
    if (existing) {
      assertHttpLogScope_(spreadsheet, existing.object, gate, identity);
      if (existing.object.submission_id !== payload.submissionId) throw new Error("http_test_parent_rejected");
    }
  });
}

/**
 * Run manually once in a NEW spreadsheet before testing or deployment.
 * Existing compatible legacy headers are extended on the right; reordered or
 * conflicting headers cause an error instead of silently corrupting data.
 */
function setupSheets() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("no_active_spreadsheet");
  var createdOrVerified = [];

  BTS_SHEETS_.forEach(function(definition) {
    var sheet = ensureSheet_(spreadsheet, definition);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, definition.headers.length)
      .setFontWeight("bold")
      .setBackground("#d9eaf7");
    createdOrVerified.push(definition.name);
  });

  PropertiesService.getScriptProperties()
    .setProperty(BTS_SPREADSHEET_PROPERTY_, spreadsheet.getId());
  SpreadsheetApp.flush();
  var result = {
    ok: true,
    spreadsheet_name: spreadsheet.getName(),
    sheets: createdOrVerified
  };
  Logger.log(JSON.stringify(result));
  return result;
}

/**
 * Install this as a time-driven trigger only after the test spreadsheet and
 * email delivery have been verified. The ScriptLock prevents overlapping
 * triggers from sending the same queued row twice.
 */
function sendDueFollowups() {
  if (PropertiesService.getScriptProperties().getProperty("BTS_HTTP_MODE") === "production") {
    if (typeof btsSendDueProductionFollowups_ !== "function") throw new Error("production_email_unavailable");
    return btsSendDueProductionFollowups_(new Date());
  }
  // Off until the researcher explicitly enables delivery in Script Properties.
  if (PropertiesService.getScriptProperties().getProperty("BTS_EMAIL_ENABLED") !== "true") {
    return { checked: 0, sent: 0, failed: 0, skipped: 0, disabled: true };
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BTS_LOCK_TIMEOUT_MS_)) {
    throw new Error("followup_sender_busy");
  }

  try {
    var spreadsheet = requireActiveSpreadsheet_();
    var definition = sheetDefinition_("followup_queue");
    var sheet = ensureSheet_(spreadsheet, definition);
    var contactDefinition = sheetDefinition_("Contact");
    var contactSheet = ensureSheet_(spreadsheet, contactDefinition);
    var followupDefinition = sheetDefinition_("FollowUp");
    var followupSheet = ensureSheet_(spreadsheet, followupDefinition);
    var headerMap = headerMap_(definition.headers);
    var lastRow = sheet.getLastRow();
    var result = { checked: 0, sent: 0, failed: 0, skipped: 0 };

    if (lastRow < 2) return result;

    var values = sheet.getRange(2, 1, lastRow - 1, definition.headers.length).getValues();
    var now = new Date();

    values.forEach(function(row, index) {
      result.checked += 1;
      var sheetRow = index + 2;
      var sentAt = row[headerMap.sent_at];
      var queueStatus = stringValue_(row[headerMap.status]).toLowerCase();
      var email = unsheetText_(row[headerMap.email]).trim();
      var subject = unsheetText_(row[headerMap.subject]);
      var messageBody = unsheetText_(row[headerMap.body]);
      var sendAt = asDate_(row[headerMap.send_at]);
      var followupId = stringValue_(row[headerMap.followup_id]);

      if (
        sentAt ||
        queueStatus === "sent" ||
        queueStatus === "sending" ||
        !email ||
        !sendAt ||
        sendAt.getTime() > now.getTime()
      ) {
        result.skipped += 1;
        return;
      }

      try {
        validateEmail_(email);
        if (stringValue_(row[headerMap.delivery_mode]) === "web_token") {
          var followupRecord = findRowByValue_(followupSheet, followupDefinition, "followup_id", followupId);
          if (!followupRecord || followupRecord.object.response_completed_at || now > asDate_(followupRecord.object.token_expires_at)) {
            result.skipped += 1;
            return;
          }
          var followupLink = completionFollowupLink_(spreadsheet, stringValue_(followupRecord.object.submission_id));
          if (!followupLink) throw new Error("invalid_followup_token");
          var english = stringValue_(row[headerMap.language]) === "en";
          subject = english ? "Blue Ticket Simulator: one-week follow-up" : "Blue Ticket Simulator：1週間後アンケート";
          messageBody = (english
            ? "Thank you for participating. Please complete the common follow-up survey using your personal link below. Do not share this link.\n\n"
            : "ご参加ありがとうございました。以下の専用リンクから1週間後アンケートにご回答ください。このリンクは他の人に共有しないでください。\n\n") + followupLink.url;
        }
        sheet.getRange(sheetRow, headerMap.status + 1).setValue("sending");
        SpreadsheetApp.flush();
        MailApp.sendEmail(email, subject, messageBody);
        sheet.getRange(sheetRow, headerMap.sent_at + 1).setValue(new Date());
        sheet.getRange(sheetRow, headerMap.status + 1).setValue("sent");
        sheet.getRange(sheetRow, headerMap.last_error + 1).setValue("");
        updateFollowupDeliveryStatus_(
          contactSheet,
          contactDefinition,
          followupSheet,
          followupDefinition,
          followupId,
          "sent",
          ""
        );
        result.sent += 1;
      } catch (error) {
        var errorMessage = publicErrorMessage_(error).slice(0, 500);
        sheet.getRange(sheetRow, headerMap.status + 1).setValue("error");
        sheet.getRange(sheetRow, headerMap.last_error + 1)
          .setValue(sheetSafe_(errorMessage));
        updateFollowupDeliveryStatus_(
          contactSheet,
          contactDefinition,
          followupSheet,
          followupDefinition,
          followupId,
          "error",
          errorMessage
        );
        result.failed += 1;
      }
    });

    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function normalizeAssignmentRequest_(parameters) {
  // store_id and client_run_id are the canonical v2 parameter names used by
  // experiment-context.js. The shorter legacy aliases remain accepted.
  var storeId = stringValue_(parameters.store_id || parameters.store).trim().toUpperCase();
  if (BTS_STORES_.indexOf(storeId) === -1) throw new Error("invalid_store");

  var participantId = stringValue_(parameters.participant_id).trim();
  if (!/^[A-Za-z]{4}\d{2}$/.test(participantId)) throw new Error("invalid_participant_id");
  var participantIdNormalized = participantId.toUpperCase();

  var experimentId = stringValue_(parameters.experiment_id || BTS_DEFAULT_EXPERIMENT_ID_).trim();
  var allocationVersion = stringValue_(parameters.allocation_version || BTS_DEFAULT_ALLOCATION_VERSION_).trim();
  var schemaVersion = Number(parameters.schema_version);
  var appVersion = stringValue_(parameters.app_version).trim();
  if (schemaVersion !== BTS_SCHEMA_VERSION_) throw new Error("invalid_schema_version");
  validateSafeIdentifier_(experimentId, "invalid_experiment_id");
  validateSafeIdentifier_(allocationVersion, "invalid_allocation_version");
  validateSafeIdentifier_(appVersion, "invalid_app_version");

  var sessionId = stringValue_(parameters.session_id).trim();
  if (sessionId && !isValidOpaqueId_(sessionId, 160)) throw new Error("invalid_session_id");

  var participantKey = [
    experimentId,
    allocationVersion,
    storeId,
    participantIdNormalized
  ].join("|");

  var requestId = stringValue_(parameters.client_run_id || parameters.request_id).trim();
  if (!requestId) requestId = "req_" + sha256Hex_("assign|" + participantKey).slice(0, 32);
  if (!isValidOpaqueId_(requestId, 160)) throw new Error("invalid_request_id");

  return {
    requestId: requestId,
    clientRunId: requestId,
    schemaVersion: schemaVersion,
    appVersion: appVersion,
    experimentId: experimentId,
    allocationVersion: allocationVersion,
    sessionId: sessionId,
    participantId: participantId,
    participantIdNormalized: participantIdNormalized,
    participantKey: participantKey,
    storeId: storeId
  };
}

function normalizeReceiptRequest_(parameters) {
  var schemaVersion = Number(parameters.schema_version);
  if (schemaVersion !== BTS_SCHEMA_VERSION_) throw new Error("invalid_schema_version");
  var submissionId = stringValue_(parameters.submission_id).trim();
  if (!isValidSubmissionId_(submissionId)) throw new Error("invalid_submission_id");

  var experimentId = stringValue_(parameters.experiment_id).trim();
  var allocationVersion = stringValue_(parameters.allocation_version).trim();
  var assignmentId = stringValue_(parameters.assignment_id).trim();
  var participantIdNormalized = stringValue_(
    parameters.participant_id_normalized || parameters.participant_id
  ).trim().toUpperCase();
  var storeId = stringValue_(parameters.store_id || parameters.store).trim().toUpperCase();
  var condition = stringValue_(parameters.condition).trim();
  var supplied = [
    experimentId,
    allocationVersion,
    assignmentId,
    participantIdNormalized,
    storeId,
    condition
  ]
    .filter(function(value) { return Boolean(value); }).length;

  if (supplied !== 6) throw new Error("incomplete_receipt_identity");
  validateSafeIdentifier_(experimentId, "invalid_experiment_id");
  validateSafeIdentifier_(allocationVersion, "invalid_allocation_version");
  if (!isValidOpaqueId_(assignmentId, 160)) throw new Error("invalid_assignment_id");
  if (!/^[A-Z]{4}\d{2}$/.test(participantIdNormalized)) {
    throw new Error("invalid_participant_id");
  }
  if (BTS_STORES_.indexOf(storeId) === -1) throw new Error("invalid_store");
  if (BTS_CONDITIONS_.indexOf(condition) === -1) throw new Error("invalid_condition");

  return {
    schemaVersion: schemaVersion,
    submissionId: submissionId,
    identityChecked: true,
    experimentId: experimentId,
    allocationVersion: allocationVersion,
    assignmentId: assignmentId,
    participantIdNormalized: participantIdNormalized,
    storeId: storeId,
    condition: condition,
    token: stringValue_(parameters.token).trim()
  };
}

function getReceiptStatus_(request, gate) {
  var spreadsheet = requireActiveSpreadsheet_();
  var definition = sheetDefinition_("SubmissionReceipts");
  if (gate) {
    assertHttpTestSpreadsheet_(spreadsheet, gate);
    assertHttpTestScope_(request, gate);
    var assignment = httpFindRow_(spreadsheet, "Assignments", "assignment_id", request.assignmentId);
    assertHttpStoredScope_(assignment && assignment.object, gate, request);
    if (assignment.object.condition !== request.condition) throw new Error("http_test_parent_rejected");
  }
  var sheet = gate ? spreadsheet.getSheetByName("SubmissionReceipts") : ensureSheet_(spreadsheet, definition);
  var receipt = findRowByValue_(
    sheet,
    definition,
    "submission_id",
    request.submissionId
  );

  if (!receipt) {
    return {
      ok: true,
      action: "receipt",
      schema_version: request.schemaVersion,
      found: false,
      submission_id: request.submissionId,
      status: "missing",
      duplicate: false,
      identity_checked: true,
      identity_match: null,
      conflict: false,
      experiment_id: request.experimentId,
      allocation_version: request.allocationVersion,
      assignment_id: request.assignmentId,
      participant_id_normalized: request.participantIdNormalized,
      store_id: request.storeId,
      condition: request.condition,
      received_at: "",
      completed_at: "",
      last_error: ""
    };
  }

  var object = receipt.object;
  if (gate) {
    assertHttpStoredScope_(object, gate, request);
    assertHttpParentChain_(spreadsheet, object, gate, object.status === "complete");
  }
  if (stringValue_(object.event_type) === "followup") {
    var tokenRecord = findFollowupByToken_(spreadsheet, request.token);
    if (gate) assertHttpParentChain_(spreadsheet, tokenRecord.object, gate, true);
    if (stringValue_(tokenRecord.object.followup_id) !== stringValue_(object.followup_id)) {
      throw new Error("invalid_followup_token");
    }
  }
  var status = stringValue_(object.status).toLowerCase();
  if (["processing", "error", "complete"].indexOf(status) === -1) status = "error";

  var storedIdentity = {
    experimentId: stringValue_(object.experiment_id),
    allocationVersion: stringValue_(object.allocation_version),
    assignmentId: stringValue_(object.assignment_id),
    participantIdNormalized: stringValue_(object.participant_id_normalized),
    storeId: stringValue_(object.store_id),
    condition: stringValue_(object.condition)
  };
  var identityMatch =
    storedIdentity.experimentId === request.experimentId &&
    storedIdentity.allocationVersion === request.allocationVersion &&
    storedIdentity.assignmentId === request.assignmentId &&
    storedIdentity.participantIdNormalized === request.participantIdNormalized &&
    storedIdentity.storeId === request.storeId &&
    storedIdentity.condition === request.condition;
  if (!identityMatch) throw new Error("receipt_identity_mismatch");

  return {
    ok: true,
    action: "receipt",
    schema_version: request.schemaVersion,
    found: true,
    submission_id: request.submissionId,
    status: status,
    duplicate: status === "complete",
    identity_checked: true,
    identity_match: true,
    conflict: false,
    experiment_id: storedIdentity.experimentId,
    allocation_version: storedIdentity.allocationVersion,
    assignment_id: storedIdentity.assignmentId,
    participant_id_normalized: storedIdentity.participantIdNormalized,
    store_id: storedIdentity.storeId,
    condition: storedIdentity.condition,
    received_at: isoString_(object.received_at),
    completed_at: isoString_(object.completed_at),
    last_error: stringValue_(object.last_error),
    event_type: stringValue_(object.event_type || "completion"),
    followup_id: stringValue_(object.followup_id),
    followup: status === "complete" && stringValue_(object.event_type) !== "followup"
      ? completionFollowupLink_(spreadsheet, request.submissionId) : null
  };
}

function assignParticipant_(request, gate, production) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BTS_LOCK_TIMEOUT_MS_)) throw new Error("assignment_busy");

  try {
    var spreadsheet = requireActiveSpreadsheet_();
    var definition = sheetDefinition_("Assignments");
    if (production) btsAssertProductionSpreadsheet_(spreadsheet, production);
    if (gate) { assertHttpTestSpreadsheet_(spreadsheet, gate); assertHttpTestScope_(request, gate); }
    if (gate) {
      var prior = httpFindRow_(spreadsheet, "Assignments", "participant_key", request.participantKey);
      if (prior) assertHttpStoredScope_(prior.object, gate, request);
    }
    if (production) {
      var productionPrior = httpFindRow_(spreadsheet, "Assignments", "participant_key", request.participantKey);
      if (productionPrior) return btsProductionAssignmentResponse_(productionPrior.object, true, request, production);
      btsProductionCheckEnrollment_(request, production, spreadsheet.getSheetByName("Assignments"));
    }
    var sheet = ensureSheet_(spreadsheet, definition);
    var existing = findRowByValue_(sheet, definition, "participant_key", request.participantKey);

    if (existing) {
      if (!existing.object.assignment_id || BTS_CONDITIONS_.indexOf(existing.object.condition) === -1) {
        throw new Error("corrupt_assignment_record");
      }
      return assignmentResponse_(existing.object, true, request);
    }

    var counts = { no_image: 0, original: 0, improved: 0 };
    readSheetObjects_(sheet, definition).forEach(function(row) {
      if (
        stringValue_(row.experiment_id) === request.experimentId &&
        stringValue_(row.allocation_version) === request.allocationVersion &&
        stringValue_(row.store_id) === request.storeId &&
        BTS_CONDITIONS_.indexOf(stringValue_(row.condition)) !== -1 &&
        stringValue_(row.status).toLowerCase() !== "void" &&
        stringValue_(row.is_test).toLowerCase() !== "true"
      ) {
        if (gate) assertHttpStoredScope_(row, gate);
        counts[stringValue_(row.condition)] += 1;
      }
    });

    var deterministicOrder = deterministicConditionOrder_(request.participantKey);
    var clientCandidateCondition = deterministicOrder[0];
    var minimum = Math.min(counts.no_image, counts.original, counts.improved);
    var condition = deterministicOrder.filter(function(candidate) {
      return counts[candidate] === minimum;
    })[0];

    var assignedAt = new Date();
    var assignmentId = Utilities.getUuid();
    var record = {
      assigned_at: assignedAt,
      assignment_id: assignmentId,
      request_id: request.requestId,
      client_run_id: request.clientRunId,
      experiment_id: request.experimentId,
      allocation_version: request.allocationVersion,
      session_id: request.sessionId,
      participant_id: request.participantId,
      participant_id_normalized: request.participantIdNormalized,
      participant_key: request.participantKey,
      store_id: request.storeId,
      condition: condition,
      assignment_method: BTS_ASSIGNMENT_METHOD_,
      client_candidate_condition: clientCandidateCondition,
      counts_before_json: JSON.stringify(counts),
      status: "confirmed",
      is_test: false
    };

    appendMappedRow_(sheet, definition, record);
    SpreadsheetApp.flush();
    return production ? btsProductionAssignmentResponse_(record, false, request, production) : assignmentResponse_(record, false, request);
  } finally {
    lock.releaseLock();
  }
}

function assignmentResponse_(record, reused, request) {
  return {
    ok: true,
    reused: Boolean(reused),
    schema_version: request.schemaVersion,
    app_version: request.appVersion,
    client_run_id: request.clientRunId,
    assignment_id: stringValue_(record.assignment_id),
    experiment_id: stringValue_(record.experiment_id),
    allocation_version: stringValue_(record.allocation_version),
    participant_id: stringValue_(record.participant_id_normalized || record.participant_id),
    participant_id_normalized: stringValue_(record.participant_id_normalized),
    store_id: stringValue_(record.store_id),
    condition: stringValue_(record.condition),
    assignment_method: stringValue_(record.assignment_method),
    client_candidate_condition: stringValue_(record.client_candidate_condition),
    status: stringValue_(record.status),
    assigned_at: isoString_(record.assigned_at)
  };
}

function normalizeCompletionPayload_(body, receivedAt) {
  if (!isPlainObject_(body)) throw new Error("invalid_payload");

  var hasSchemaVersion = hasOwn_(body, "schema_version");
  var rawSchemaVersion = hasSchemaVersion ? body.schema_version : 1;
  var schemaVersionText = stringValue_(rawSchemaVersion).trim();
  if (
    (hasSchemaVersion && typeof rawSchemaVersion !== "number" && typeof rawSchemaVersion !== "string") ||
    !/^[1-9]\d*$/.test(schemaVersionText)
  ) {
    throw new Error("invalid_schema_version");
  }
  var schemaVersion = Number(schemaVersionText);
  if (!isFinite(schemaVersion)) throw new Error("invalid_schema_version");
  if (schemaVersion !== 1 && schemaVersion !== BTS_SCHEMA_VERSION_) {
    throw new Error("invalid_schema_version");
  }
  var isV2 = schemaVersion === BTS_SCHEMA_VERSION_;

  var participantId = stringValue_(body.participant_id).trim();
  if (isV2 && !/^[A-Za-z]{4}\d{2}$/.test(participantId)) {
    throw new Error("invalid_participant_id");
  }
  if (!isV2 && participantId.length > 160) throw new Error("invalid_participant_id");
  var participantIdNormalized = participantId.toUpperCase();

  var storeId = stringValue_(body.store_id).trim().toUpperCase();
  var condition = stringValue_(body.condition).trim();
  if (isV2 && BTS_STORES_.indexOf(storeId) === -1) throw new Error("invalid_store");
  if (isV2 && BTS_CONDITIONS_.indexOf(condition) === -1) throw new Error("invalid_condition");
  if (!isV2 && storeId && BTS_STORES_.indexOf(storeId) === -1) storeId = "";
  if (!isV2 && condition && BTS_CONDITIONS_.indexOf(condition) === -1) condition = "";

  var submissionId = stringValue_(body.submission_id).trim();
  if (isV2 && !isValidSubmissionId_(submissionId)) throw new Error("invalid_submission_id");
  if (!submissionId) submissionId = "legacy_" + Utilities.getUuid();

  var experimentId = stringValue_(
    isV2 ? body.experiment_id : (body.experiment_id || BTS_DEFAULT_EXPERIMENT_ID_)
  ).trim();
  if (isV2) validateSafeIdentifier_(experimentId, "invalid_experiment_id");
  if (!experimentId) experimentId = BTS_DEFAULT_EXPERIMENT_ID_;

  var email = stringValue_(body.email).trim();
  if (email) validateEmail_(email);

  var allocation = isPlainObject_(body.allocation) ? body.allocation : {};
  var consent = isPlainObject_(body.consent) ? body.consent : {};
  var phaseTimes = isPlainObject_(body.phase_times) ? body.phase_times : {};
  var followup = isPlainObject_(body.followup) ? body.followup : {};
  var summary = isPlainObject_(body.summary) ? body.summary : {};
  var followupResponse = isPlainObject_(body.followup_response) ? body.followup_response : {};

  var allocationVersion = stringValue_(
    isV2
      ? allocation.allocation_version
      : (allocation.allocation_version || body.allocation_version || BTS_DEFAULT_ALLOCATION_VERSION_)
  ).trim();
  if (isV2) validateSafeIdentifier_(allocationVersion, "invalid_allocation_version");
  // v2 binds the completion to the server-issued allocation object. Keep the
  // top-level alias only for legacy payload parsing; it must not let a v2
  // request bypass the allocation.assignment_id requirement.
  var assignmentId = stringValue_(
    isV2 ? allocation.assignment_id : (allocation.assignment_id || body.assignment_id)
  ).trim();
  if (isV2 && !isValidOpaqueId_(assignmentId, 160)) throw new Error("assignment_mismatch");

  var experimentDate = stringValue_(body.experiment_date).trim();
  if (experimentDate && !/^\d{4}-\d{2}-\d{2}$/.test(experimentDate)) {
    throw new Error("invalid_experiment_date");
  }
  if (!experimentDate) {
    experimentDate = Utilities.formatDate(receivedAt, "Asia/Tokyo", "yyyy-MM-dd");
  }

  var answers = Array.isArray(body.answers) ? body.answers : [];
  var questionLogs = Array.isArray(body.question_logs) ? body.question_logs : [];
  // Optional for older v2/legacy clients. Never infer an old record's content version.
  var versions = {};
  ["content_version", "common_correction_version", "instrument_version"].forEach(function(key) {
    versions[key] = stringValue_(body[key]).trim();
    if (versions[key]) validateSafeIdentifier_(versions[key], "invalid_content_version");
  });

  return {
    raw: body,
    schemaVersion: schemaVersion,
    isV2: isV2,
    submissionId: submissionId,
    experimentId: experimentId,
    appVersion: stringValue_(body.app_version),
    contentVersion: versions.content_version,
    commonCorrectionVersion: versions.common_correction_version,
    instrumentVersion: versions.instrument_version,
    sessionId: stringValue_(body.session_id),
    participantId: participantId,
    participantIdNormalized: participantIdNormalized,
    email: email,
    language: stringValue_(body.language),
    storeId: storeId,
    condition: condition,
    experimentDate: experimentDate,
    startTime: stringValue_(body.start_time || body.session_started_at),
    endTime: stringValue_(body.end_time || body.post_survey_completed_at || body.simulation_completed_at),
    simulationCompletedAt: stringValue_(body.simulation_completed_at),
    postSurveyCompletedAt: stringValue_(body.post_survey_completed_at),
    allocation: allocation,
    allocationVersion: allocationVersion,
    assignmentId: assignmentId,
    clientRunId: stringValue_(allocation.client_run_id || allocation.request_id || body.client_run_id),
    consent: consent,
    phaseTimes: phaseTimes,
    followup: followup,
    followupResponse: followupResponse,
    summary: summary,
    preSurvey: isPlainObject_(body.pre_survey) ? body.pre_survey : {},
    postSurvey: isPlainObject_(body.post_survey) ? body.post_survey : {},
    answers: answers,
    questionLogs: questionLogs,
    completionStatus: stringValue_(body.completion_status || "completed")
  };
}

function persistCompletion_(payload, receivedAt, gate, production) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BTS_LOCK_TIMEOUT_MS_)) throw new Error("logging_busy");

  var receiptContext = null;
  try {
    var spreadsheet = requireActiveSpreadsheet_();
    if (production) btsProductionValidatePayload_(payload, production, spreadsheet, receivedAt);
    if (gate) {
      assertHttpTestSpreadsheet_(spreadsheet, gate);
      assertHttpTestScope_(payload, gate);
      assertHttpCompletionRows_(spreadsheet, payload, gate);
    }

    // Reject an invalid v2 allocation before creating/extending any target
    // sheet. The assignment check itself is read-only.
    if (payload.isV2) {
      assertAssignmentMatchesPayload_(
        spreadsheet.getSheetByName("Assignments"),
        payload
      );
      if (payload.followup.requested === true) {
        var followupSettings = followupDeploymentSettings_();
        if (payload.followup.instrument_version !== followupSettings.instrumentVersion) throw new Error("followup_instrument_mismatch");
        if (!asDate_(payload.endTime)) throw new Error("invalid_followup_time");
      }
    }

    var sheets = {};
    BTS_SHEETS_.forEach(function(definition) {
      sheets[definition.name] = ensureSheet_(spreadsheet, definition);
    });

    var receiptsDefinition = sheetDefinition_("SubmissionReceipts");
    var receiptsSheet = sheets.SubmissionReceipts;
    var existingReceipt = findRowByValue_(
      receiptsSheet,
      receiptsDefinition,
      "submission_id",
      payload.submissionId
    );

    if (payload.isV2 && existingReceipt) {
      assertReceiptIdentity_(existingReceipt.object, payload);
      if (stringValue_(existingReceipt.object.event_type) === "followup") throw new Error("submission_id_conflict");
    }

    if (payload.isV2 && existingReceipt && stringValue_(existingReceipt.object.status) === "complete") {
      return {
        ok: true,
        duplicate: true,
        schema_version: payload.schemaVersion,
        submission_id: payload.submissionId
      };
    }

    if (existingReceipt) {
      receiptContext = existingReceipt;
      updateMappedRow_(receiptsSheet, receiptsDefinition, receiptContext.rowIndex, {
        status: "processing",
        last_error: ""
      });
    } else {
      appendMappedRow_(receiptsSheet, receiptsDefinition, {
        received_at: receivedAt,
        submission_id: payload.submissionId,
        schema_version: payload.schemaVersion,
        experiment_id: payload.experimentId,
        session_id: payload.sessionId,
        participant_id: payload.participantId,
        participant_id_normalized: payload.participantIdNormalized,
        store_id: payload.storeId,
        condition: payload.condition,
        status: "processing",
        completed_at: "",
        last_error: "",
        assignment_id: payload.assignmentId,
        allocation_version: payload.allocationVersion,
        event_type: "completion",
        payload_hash: production ? payload.productionPayloadHash : ""
      });
      receiptContext = findRowByValue_(
        receiptsSheet,
        receiptsDefinition,
        "submission_id",
        payload.submissionId
      );
    }

    writeLegacyLog_(sheets.logs, payload, receivedAt);
    writeParticipant_(sheets.Participants, payload, receivedAt);
    writeQuestionLogs_(sheets.QuestionLogs, payload, receivedAt);
    writeContactAndFollowup_(sheets, payload, receivedAt);

    updateMappedRow_(receiptsSheet, receiptsDefinition, receiptContext.rowIndex, {
      status: "complete",
      completed_at: new Date(),
      last_error: ""
    });
    SpreadsheetApp.flush();

    return {
      ok: true,
      duplicate: false,
      schema_version: payload.schemaVersion,
      submission_id: payload.submissionId
    };
  } catch (error) {
    if (receiptContext) {
      try {
        var spreadsheetForError = requireActiveSpreadsheet_();
        var receiptDefinitionForError = sheetDefinition_("SubmissionReceipts");
        var receiptSheetForError = ensureSheet_(spreadsheetForError, receiptDefinitionForError);
        updateMappedRow_(receiptSheetForError, receiptDefinitionForError, receiptContext.rowIndex, {
          status: "error",
          last_error: publicErrorMessage_(error).slice(0, 500)
        });
        SpreadsheetApp.flush();
      } catch (_receiptError) {
        // Preserve the original error. A later retry with the same submission_id
        // will scan every target sheet before appending.
      }
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function writeLegacyLog_(sheet, payload, receivedAt) {
  var definition = sheetDefinition_("logs");
  appendUniqueMapped_(sheet, definition, "submission_id", payload.submissionId, {
    // First nine values intentionally mirror the original README doPost sample.
    created_at: receivedAt,
    session_id: payload.sessionId,
    participant_id: payload.participantId,
    // Preserve the legacy column, but v2 contact details live only in the
    // private contact/dispatch sheets, not the answer export.
    email: payload.isV2 ? "" : payload.email,
    language: payload.language,
    summary_json: jsonString_(payload.summary, {}),
    pre_survey_json: jsonString_(payload.preSurvey, {}),
    post_survey_json: jsonString_(payload.postSurvey, {}),
    answers_json: jsonString_(payload.answers, []),
    // Appended v2 metadata.
    schema_version: payload.schemaVersion,
    submission_id: payload.submissionId,
    experiment_id: payload.experimentId,
    app_version: payload.appVersion,
    participant_id_normalized: payload.participantIdNormalized,
    store_id: payload.storeId,
    condition: payload.condition,
    experiment_date: payload.experimentDate,
    start_time: payload.startTime,
    end_time: payload.endTime,
    assignment_id: payload.assignmentId,
    allocation_version: payload.allocationVersion,
    allocation_method: stringValue_(payload.allocation.method || payload.allocation.assignment_method),
    allocation_status: stringValue_(payload.allocation.status),
    consent_json: jsonString_(payload.consent, {}),
    phase_times_json: jsonString_(payload.phaseTimes, {}),
    client_run_id: payload.clientRunId,
    content_version: payload.contentVersion,
    common_correction_version: payload.commonCorrectionVersion,
    instrument_version: payload.instrumentVersion
  });
}

function writeParticipant_(sheet, payload, receivedAt) {
  var definition = sheetDefinition_("Participants");
  var summary = payload.summary;
  appendUniqueMapped_(sheet, definition, "submission_id", payload.submissionId, {
    received_at: receivedAt,
    submission_id: payload.submissionId,
    schema_version: payload.schemaVersion,
    experiment_id: payload.experimentId,
    app_version: payload.appVersion,
    assignment_id: payload.assignmentId,
    allocation_version: payload.allocationVersion,
    allocation_method: stringValue_(payload.allocation.method || payload.allocation.assignment_method),
    allocation_status: stringValue_(payload.allocation.status),
    client_run_id: payload.clientRunId,
    session_id: payload.sessionId,
    participant_id: payload.participantId,
    participant_id_normalized: payload.participantIdNormalized,
    store_id: payload.storeId,
    condition: payload.condition,
    language: payload.language,
    experiment_date: payload.experimentDate,
    start_time: payload.startTime,
    simulation_completed_at: payload.simulationCompletedAt,
    end_time: payload.endTime,
    consent_version: stringValue_(payload.consent.version),
    consent_given: payload.consent.given === true,
    consent_given_at: stringValue_(payload.consent.given_at),
    overall_accuracy: valueOrBlank_(summary.overall_accuracy),
    situation_score: valueOrBlank_(summary.situation_score),
    system_score: valueOrBlank_(summary.system_score),
    completion_status: payload.completionStatus,
    content_version: payload.contentVersion,
    common_correction_version: payload.commonCorrectionVersion,
    instrument_version: payload.instrumentVersion
  });
}

function writeQuestionLogs_(sheet, payload, receivedAt) {
  var definition = sheetDefinition_("QuestionLogs");
  var source = payload.questionLogs.length ? payload.questionLogs : payload.answers;

  source.forEach(function(item, index) {
    if (!isPlainObject_(item)) return;
    var questionId = stringValue_(item.question_id).trim();
    if (!questionId) return;

    var phase = stringValue_(item.phase || "learning").trim();
    if (["pre", "learning", "post", "followup"].indexOf(phase) === -1) {
      phase = "learning";
    }

    var eventId = stringValue_(item.event_id).trim();
    if (!isValidOpaqueId_(eventId, 180)) {
      eventId = "evt_" + sha256Hex_([
        payload.submissionId,
        phase,
        questionId,
        String(index)
      ].join("|")).slice(0, 40);
    }

    appendUniqueMapped_(sheet, definition, "event_id", eventId, {
      received_at: receivedAt,
      event_id: eventId,
      submission_id: payload.submissionId,
      schema_version: payload.schemaVersion,
      experiment_id: payload.experimentId,
      assignment_id: payload.assignmentId,
      session_id: payload.sessionId,
      participant_id: payload.participantId,
      participant_id_normalized: payload.participantIdNormalized,
      store_id: payload.storeId,
      condition: payload.condition,
      phase: phase,
      question_id: questionId,
      question_order: valueOrDefault_(item.question_order, index + 1),
      attempt_no: valueOrDefault_(item.attempt_no, 1),
      selected_answer: answerCellValue_(item.selected_answer),
      correct_answer: answerCellValue_(item.correct_answer),
      is_correct: hasOwn_(item, "is_correct") ? item.is_correct : "",
      response_time_ms: valueOrBlank_(item.response_time_ms),
      question_started_at: stringValue_(item.question_started_at),
      answered_at: stringValue_(item.answered_at),
      timestamp: stringValue_(item.timestamp || item.answered_at),
      answer_change_count: valueOrBlank_(item.answer_change_count),
      screen_dwell_time_ms: valueOrBlank_(item.screen_dwell_time_ms),
      feedback_started_at: stringValue_(item.feedback_started_at),
      feedback_ended_at: stringValue_(item.feedback_ended_at),
      explanation_view_time_ms: valueOrBlank_(item.explanation_view_time_ms),
      content_version: stringValue_(payload.contentVersion),
      common_correction_version: stringValue_(payload.commonCorrectionVersion),
      instrument_version: stringValue_(payload.instrumentVersion)
    });
  });
}

function followupDeploymentSettings_() {
  var properties = PropertiesService.getScriptProperties();
  var publicUrl = stringValue_(properties.getProperty("BTS_PUBLIC_APP_URL")).trim();
  var version = stringValue_(properties.getProperty("BTS_FOLLOWUP_INSTRUMENT_VERSION")).trim();
  var hash = stringValue_(properties.getProperty("BTS_FOLLOWUP_INSTRUMENT_HASH")).trim().toLowerCase();
  var questionIds = stringValue_(properties.getProperty("BTS_FOLLOWUP_QUESTION_IDS")).split(",").map(function(id) { return id.trim(); }).filter(Boolean);
  var optionalIds = stringValue_(properties.getProperty("BTS_FOLLOWUP_OPTIONAL_QUESTION_IDS")).split(",").map(function(id) { return id.trim(); }).filter(Boolean);
  if (!/^https:\/\/[^\s?#]+\/$/.test(publicUrl)) throw new Error("followup_not_configured");
  validateSafeIdentifier_(version, "followup_not_configured");
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("followup_not_configured");
  if (!questionIds.length || questionIds.some(function(id, index) { return !/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(id) || questionIds.indexOf(id) !== index; }) ||
    optionalIds.some(function(id, index) { return questionIds.indexOf(id) === -1 || optionalIds.indexOf(id) !== index; })) throw new Error("followup_not_configured");
  return { publicUrl: publicUrl, instrumentVersion: version, instrumentHash: hash, questionIds: questionIds, optionalIds: optionalIds };
}

function followupToken_(followupId, createSecret) {
  var properties = PropertiesService.getScriptProperties();
  var secret = properties.getProperty("BTS_FOLLOWUP_TOKEN_SECRET");
  if (!secret && createSecret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    properties.setProperty("BTS_FOLLOWUP_TOKEN_SECRET", secret);
  }
  if (!secret) throw new Error("followup_not_configured");
  return Utilities.computeHmacSha256Signature("bts-followup-v2|" + followupId, secret)
    .map(function(byte) { return ("0" + (byte < 0 ? byte + 256 : byte).toString(16)).slice(-2); }).join("");
}

function writeWebFollowup_(sheets, payload, receivedAt) {
  // A declined follow-up creates neither a token nor a contact/queue record.
  if (payload.followup.requested !== true) return;
  var settings = followupDeploymentSettings_();
  if (payload.followup.instrument_version && payload.followup.instrument_version !== settings.instrumentVersion) {
    throw new Error("followup_instrument_mismatch");
  }
  var completedAt = asDate_(payload.endTime);
  if (!completedAt) throw new Error("invalid_followup_time");
  var due = new Date(completedAt.getTime() + 7 * 86400000);
  var followupId = "followup_" + sha256Hex_(payload.experimentId + "|" + payload.submissionId).slice(0, 40);
  var token = followupToken_(followupId, true);
  var definition = sheetDefinition_("FollowUp");
  appendUniqueMapped_(sheets.FollowUp, definition, "followup_id", followupId, {
    created_at: receivedAt, followup_id: followupId, submission_id: payload.submissionId,
    experiment_id: payload.experimentId, allocation_version: payload.allocationVersion,
    assignment_id: payload.assignmentId, session_id: payload.sessionId,
    participant_id: payload.participantId, participant_id_normalized: payload.participantIdNormalized,
    store_id: payload.storeId, condition: payload.condition, requested: true,
    send_at: due.toISOString(), delivery_mode: payload.followup.delivery_mode === "google_forms" ? "google_forms" : "web_token", forms_json: "[]", status: "scheduled",
    token_hash: sha256Hex_(token), token_expires_at: new Date(due.getTime() + 30 * 86400000).toISOString(),
    window_ends_at: new Date(due.getTime() + 7 * 86400000).toISOString(),
    instrument_version: settings.instrumentVersion, instrument_hash: settings.instrumentHash,
    question_ids_json: JSON.stringify(settings.questionIds), optional_question_ids_json: JSON.stringify(settings.optionalIds),
    content_version: payload.contentVersion, common_correction_version: payload.commonCorrectionVersion
  });
  if (!payload.email) return;
  appendUniqueMapped_(sheets.Contact, sheetDefinition_("Contact"), "followup_id", followupId, {
    created_at: receivedAt, contact_id: "contact_" + sha256Hex_(followupId).slice(0, 40),
    followup_id: followupId, submission_id: payload.submissionId, experiment_id: payload.experimentId,
    assignment_id: payload.assignmentId, session_id: payload.sessionId, participant_id: payload.participantId,
    participant_id_normalized: payload.participantIdNormalized, store_id: payload.storeId,
    condition: payload.condition, email: payload.email, language: payload.language, send_at: due.toISOString(), status: "queued"
  });
  appendUniqueMapped_(sheets.followup_queue, sheetDefinition_("followup_queue"), "followup_id", followupId, {
    created_at: receivedAt, send_at: due.toISOString(), session_id: payload.sessionId,
    participant_id: payload.participantId, email: payload.email, language: payload.language,
    delivery_mode: payload.followup.delivery_mode === "google_forms" ? "google_forms" : "web_token", forms_json: "[]", subject: "", body: "",
    followup_id: followupId, submission_id: payload.submissionId, experiment_id: payload.experimentId,
    assignment_id: payload.assignmentId, participant_id_normalized: payload.participantIdNormalized,
    store_id: payload.storeId, condition: payload.condition, status: "queued"
  });
}

function findFollowupByToken_(spreadsheet, token) {
  if (!/^[a-f0-9]{64}$/.test(stringValue_(token))) throw new Error("invalid_followup_token");
  var sheet = spreadsheet.getSheetByName("FollowUp");
  if (!sheet) throw new Error("invalid_followup_token");
  var record = findRowByValue_(sheet, sheetDefinition_("FollowUp"), "token_hash", sha256Hex_(token));
  if (!record || record.object.requested !== true) throw new Error("invalid_followup_token");
  return record;
}

function completionFollowupLink_(spreadsheet, submissionId) {
  var sheet = spreadsheet.getSheetByName("FollowUp");
  if (!sheet) return null;
  var record = findRowByValue_(sheet, sheetDefinition_("FollowUp"), "submission_id", submissionId);
  if (!record || record.object.requested !== true || !record.object.token_hash) return null;
  var token = followupToken_(record.object.followup_id, false);
  if (sha256Hex_(token) !== stringValue_(record.object.token_hash)) throw new Error("invalid_followup_token");
  return {
    followup_id: stringValue_(record.object.followup_id),
    url: followupDeploymentSettings_().publicUrl + "followup.html#token=" + token,
    due_at: isoString_(record.object.send_at), expires_at: isoString_(record.object.token_expires_at)
  };
}

function followupIdentity_(record) {
  var result = {};
  ["followup_id", "experiment_id", "allocation_version", "assignment_id", "session_id", "participant_id",
    "participant_id_normalized", "store_id", "condition", "instrument_version", "instrument_hash"].forEach(function(key) {
    result[key] = stringValue_(record[key]);
  });
  result.parent_submission_id = stringValue_(record.submission_id);
  return result;
}

function getFollowup_(parameters, now, gate) {
  if (Number(parameters.schema_version) !== BTS_SCHEMA_VERSION_) throw new Error("invalid_schema_version");
  var spreadsheet = requireActiveSpreadsheet_();
  if (gate) assertHttpTestSpreadsheet_(spreadsheet, gate);
  var record = findFollowupByToken_(spreadsheet, stringValue_(parameters.token)).object;
  if (gate) {
    assertHttpParentChain_(spreadsheet, record, gate, true);
    assertHttpNestedIdentity_(parameters, record, gate);
  }
  var due = asDate_(record.send_at);
  var expires = asDate_(record.token_expires_at);
  if (!due || !expires) throw new Error("invalid_followup_token");
  var status = record.response_completed_at ? "completed"
    : now.getTime() > expires.getTime() ? "expired" : now.getTime() < due.getTime() ? "not_due" : "ready";
  var response = followupIdentity_(record);
  response.ok = true;
  response.action = "followup";
  response.schema_version = BTS_SCHEMA_VERSION_;
  response.status = status;
  response.due_at = due.toISOString();
  response.expires_at = expires.toISOString();
  response.window_ends_at = isoString_(record.window_ends_at);
  response.server_time = now.toISOString();
  // Additional response metadata is kept out of the historic identity hash.
  response.content_version = stringValue_(record.content_version);
  response.common_correction_version = stringValue_(record.common_correction_version);
  return response;
}

function normalizeFollowupResponse_(body, record, receivedAt) {
  if (body.schema_version !== BTS_SCHEMA_VERSION_) throw new Error("invalid_schema_version");
  if (!isValidSubmissionId_(body.submission_id)) throw new Error("invalid_submission_id");
  var identity = followupIdentity_(record);
  Object.keys(identity).forEach(function(key) {
    if (key === "instrument_hash") return;
    if (stringValue_(body[key]) !== identity[key]) throw new Error("followup_identity_mismatch");
  });
  if (!/^[a-f0-9]{64}$/.test(stringValue_(record.instrument_hash)) || stringValue_(body.instrument_hash) !== stringValue_(record.instrument_hash)) {
    throw new Error("followup_instrument_mismatch");
  }
  if (["ja", "en"].indexOf(body.language) === -1) throw new Error("invalid_followup_payload");
  var start = asDate_(body.started_at);
  var end = asDate_(body.completed_at);
  var due = asDate_(record.send_at);
  var expires = asDate_(record.token_expires_at);
  if (!start || !end || !due || !expires || start > end || end.getTime() > receivedAt.getTime() + 300000 || start < due) {
    throw new Error("invalid_followup_time");
  }
  if (!isPlainObject_(body.answers) || !Array.isArray(body.question_logs) || !body.question_logs.length || body.question_logs.length > 200) {
    throw new Error("invalid_followup_payload");
  }
  var expectedIds;
  var optionalIds;
  try { expectedIds = JSON.parse(record.question_ids_json); optionalIds = JSON.parse(record.optional_question_ids_json || "[]"); }
  catch (_error) { throw new Error("followup_not_configured"); }
  if (!Array.isArray(expectedIds) || !expectedIds.length || !Array.isArray(optionalIds)) throw new Error("followup_not_configured");
  if (JSON.stringify(body.question_logs.map(function(row) { return row && row.question_id; })) !== JSON.stringify(expectedIds)) {
    throw new Error("invalid_followup_question_log");
  }
  expectedIds.forEach(function(id) {
    var answer = body.answers[id];
    if (optionalIds.indexOf(id) === -1 && (answer === undefined || answer === null ||
      (Array.isArray(answer) ? !answer.length : !stringValue_(answer).trim()))) throw new Error("invalid_followup_payload");
  });
  var seenQuestions = {};
  var seenEvents = {};
  body.question_logs.forEach(function(row, index) {
    if (!isPlainObject_(row) || row.phase !== "followup" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(stringValue_(row.question_id)) ||
      !isValidOpaqueId_(row.event_id, 180) || seenQuestions[row.question_id] || seenEvents[row.event_id] || row.question_order !== index + 1) {
      throw new Error("invalid_followup_question_log");
    }
    seenQuestions[row.question_id] = true;
    seenEvents[row.event_id] = true;
    ["assignment_id", "session_id", "participant_id_normalized", "store_id", "condition"].forEach(function(key) {
      if (stringValue_(row[key]) !== identity[key]) throw new Error("followup_identity_mismatch");
    });
    if (!hasOwn_(body.answers, row.question_id) || JSON.stringify(body.answers[row.question_id]) !== JSON.stringify(row.selected_answer)) {
      throw new Error("invalid_followup_question_log");
    }
    ["response_time_ms", "screen_dwell_time_ms", "answer_change_count"].forEach(function(key) {
      if (typeof row[key] !== "number" || !isFinite(row[key]) || row[key] < 0) throw new Error("invalid_followup_question_log");
    });
    var answered = asDate_(row.answered_at);
    var questionStart = asDate_(row.question_started_at);
    if (!answered || !questionStart || questionStart < start || questionStart > answered || answered > end) throw new Error("invalid_followup_time");
  });
  if (Object.keys(body.answers).length !== body.question_logs.length) throw new Error("invalid_followup_payload");
  return {
    schemaVersion: BTS_SCHEMA_VERSION_, submissionId: body.submission_id, experimentId: identity.experiment_id,
    allocationVersion: identity.allocation_version, assignmentId: identity.assignment_id, sessionId: identity.session_id,
    participantId: identity.participant_id, participantIdNormalized: identity.participant_id_normalized,
    storeId: identity.store_id, condition: identity.condition, questionLogs: body.question_logs, answers: [],
    start: start, end: end, due: due, expires: expires,
    payloadHash: sha256Hex_(JSON.stringify(canonicalFollowupValue_({
      identity: identity, language: body.language, instrument_hash: body.instrument_hash,
      started_at: body.started_at, completed_at: body.completed_at, answers: body.answers, question_logs: body.question_logs
    })))
  };
}

function canonicalFollowupValue_(value) {
  if (Array.isArray(value)) return value.map(canonicalFollowupValue_);
  if (isPlainObject_(value)) {
    var result = {};
    Object.keys(value).sort().forEach(function(key) { result[key] = canonicalFollowupValue_(value[key]); });
    return result;
  }
  return value;
}

function persistFollowupResponse_(body, receivedAt, gate) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BTS_LOCK_TIMEOUT_MS_)) throw new Error("logging_busy");
  var receiptContext = null;
  var receiptSheet;
  var receiptDefinition = sheetDefinition_("SubmissionReceipts");
  try {
    var spreadsheet = requireActiveSpreadsheet_();
    if (gate) { assertHttpTestSpreadsheet_(spreadsheet, gate); assertHttpTestScope_(body, gate); }
    var record = findFollowupByToken_(spreadsheet, body.token);
    if (gate) {
      assertHttpStoredScope_(record.object, gate, body);
      assertHttpParentChain_(spreadsheet, record.object, gate, true);
      var previousReceipt = httpFindRow_(spreadsheet, "SubmissionReceipts", "submission_id", body.submission_id);
      if (previousReceipt) { assertHttpStoredScope_(previousReceipt.object, gate, body); assertHttpParentChain_(spreadsheet, previousReceipt.object, gate, false); }
      (body.question_logs || []).forEach(function(row) {
        var stored = httpFindRow_(spreadsheet, "QuestionLogs", "event_id", row.event_id);
        if (stored) { assertHttpLogScope_(spreadsheet, stored.object, gate, body); if (stored.object.submission_id !== body.submission_id) throw new Error("http_test_parent_rejected"); }
      });
    }
    var payload = normalizeFollowupResponse_(body, record.object, receivedAt);
    assertAssignmentMatchesPayload_(spreadsheet.getSheetByName("Assignments"), payload);
    // The learning version belongs to the parent completion, not this browser's claim.
    var parent = findRowByValue_(spreadsheet.getSheetByName("Participants"), sheetDefinition_("Participants"),
      "submission_id", record.object.submission_id);
    payload.contentVersion = stringValue_(parent && parent.object.content_version);
    payload.commonCorrectionVersion = stringValue_(parent && parent.object.common_correction_version);
    payload.instrumentVersion = stringValue_(record.object.instrument_version);
    receiptSheet = spreadsheet.getSheetByName("SubmissionReceipts");
    var receipt = findRowByValue_(receiptSheet, receiptDefinition, "submission_id", payload.submissionId);
    if (receipt) {
      assertReceiptIdentity_(receipt.object, payload);
      if (receipt.object.event_type !== "followup" || receipt.object.followup_id !== body.followup_id ||
        stringValue_(receipt.object.session_id) !== payload.sessionId) throw new Error("submission_id_conflict");
      if (stringValue_(receipt.object.payload_hash) !== payload.payloadHash) throw new Error("submission_id_conflict");
      if (receipt.object.status === "complete") return { ok: true, duplicate: true, schema_version: 2, submission_id: payload.submissionId, event_type: "followup" };
    }
    if (record.object.response_submission_id && record.object.response_submission_id !== payload.submissionId) throw new Error("followup_already_completed");
    if (receivedAt < payload.due) throw new Error("followup_not_due");
    if (receivedAt > payload.expires) throw new Error("followup_expired");
    var logSheet = spreadsheet.getSheetByName("QuestionLogs");
    body.question_logs.forEach(function(row) {
      var stored = findRowByValue_(logSheet, sheetDefinition_("QuestionLogs"), "event_id", row.event_id);
      if (stored && (stored.object.submission_id !== payload.submissionId || stored.object.question_id !== row.question_id)) throw new Error("followup_event_conflict");
    });
    if (!receipt) {
      appendMappedRow_(receiptSheet, receiptDefinition, {
        received_at: receivedAt, submission_id: payload.submissionId, schema_version: 2,
        experiment_id: payload.experimentId, session_id: payload.sessionId, participant_id: payload.participantId,
        participant_id_normalized: payload.participantIdNormalized, store_id: payload.storeId, condition: payload.condition,
        assignment_id: payload.assignmentId, allocation_version: payload.allocationVersion,
        event_type: "followup", followup_id: body.followup_id, status: "processing", payload_hash: payload.payloadHash
      });
      receipt = findRowByValue_(receiptSheet, receiptDefinition, "submission_id", payload.submissionId);
    }
    receiptContext = receipt;
    updateMappedRow_(receiptSheet, receiptDefinition, receipt.rowIndex, { status: "processing", last_error: "" });
    writeQuestionLogs_(logSheet, payload, receivedAt);
    updateMappedRow_(spreadsheet.getSheetByName("FollowUp"), sheetDefinition_("FollowUp"), record.rowIndex, {
      status: "completed", response_submission_id: payload.submissionId,
      response_completed_at: payload.end.toISOString(), response_received_at: receivedAt,
      response_started_at: payload.start.toISOString(), response_language: body.language,
      response_timing: receivedAt > asDate_(record.object.window_ends_at) ? "late" : "in_window",
      answers_json: JSON.stringify(body.answers), response_payload_hash: payload.payloadHash
    });
    updateMappedRow_(receiptSheet, receiptDefinition, receipt.rowIndex, { status: "complete", completed_at: receivedAt, last_error: "" });
    SpreadsheetApp.flush();
    return { ok: true, duplicate: false, schema_version: 2, submission_id: payload.submissionId, event_type: "followup" };
  } catch (error) {
    if (receiptContext) updateMappedRow_(receiptSheet, receiptDefinition, receiptContext.rowIndex, { status: "error", last_error: publicErrorMessage_(error) });
    throw error;
  } finally { lock.releaseLock(); }
}

/** Read-only counts; never returns addresses/tokens and never erases rows. */
function reportContactRetention() {
  var properties = PropertiesService.getScriptProperties();
  var days = Number(properties.getProperty("BTS_CONTACT_RETENTION_DAYS") || 90);
  if (!isFinite(days) || days < 1 || Math.floor(days) !== days) throw new Error("invalid_retention_days");
  var cutoff = Date.now() - days * 86400000;
  var spreadsheet = requireActiveSpreadsheet_();
  var result = { dry_run: true, deleted: 0, retention_days: days, candidate_counts: {} };
  ["Contact", "followup_queue", "logs"].forEach(function(name) {
    var sheet = spreadsheet.getSheetByName(name);
    result.candidate_counts[name] = sheet ? readSheetObjects_(sheet, sheetDefinition_(name)).filter(function(row) {
      var created = asDate_(row.created_at);
      return Boolean(row.email && created && created.getTime() < cutoff);
    }).length : 0;
  });
  Logger.log(JSON.stringify(result));
  return result;
}

function writeContactAndFollowup_(sheets, payload, receivedAt) {
  if (payload.isV2) {
    writeWebFollowup_(sheets, payload, receivedAt);
    return;
  }
  var followup = payload.followup;
  var preview = isPlainObject_(followup.email_preview) ? followup.email_preview : {};
  var forms = Array.isArray(preview.forms) ? preview.forms : [];
  var requested = hasOwn_(followup, "requested") ? followup.requested === true : Boolean(payload.email);
  var followupId = stringValue_(
    followup.followup_id ||
    payload.followupResponse.followup_id ||
    payload.raw.followup_id
  ).trim();
  if (!isValidOpaqueId_(followupId, 180)) {
    followupId = "followup_" + sha256Hex_([
      payload.experimentId,
      payload.assignmentId || payload.submissionId,
      payload.participantIdNormalized,
      payload.storeId
    ].join("|")).slice(0, 40);
  }

  var contactDefinition = sheetDefinition_("Contact");
  if (payload.email) {
    var contactId = "contact_" + sha256Hex_(followupId + "|" + payload.email.toLowerCase()).slice(0, 40);
    appendUniqueMapped_(sheets.Contact, contactDefinition, "contact_id", contactId, {
      created_at: receivedAt,
      contact_id: contactId,
      followup_id: followupId,
      submission_id: payload.submissionId,
      experiment_id: payload.experimentId,
      assignment_id: payload.assignmentId,
      session_id: payload.sessionId,
      participant_id: payload.participantId,
      participant_id_normalized: payload.participantIdNormalized,
      store_id: payload.storeId,
      condition: payload.condition,
      email: payload.email,
      language: payload.language,
      send_at: stringValue_(followup.send_at),
      sent_at: "",
      status: requested ? "queued" : "collected",
      last_error: ""
    });
  }

  var followupDefinition = sheetDefinition_("FollowUp");
  var followupValues = {
    created_at: receivedAt,
    followup_id: followupId,
    submission_id: payload.submissionId,
    experiment_id: payload.experimentId,
    assignment_id: payload.assignmentId,
    session_id: payload.sessionId,
    participant_id: payload.participantId,
    participant_id_normalized: payload.participantIdNormalized,
    store_id: payload.storeId,
    condition: payload.condition,
    requested: requested,
    send_at: stringValue_(followup.send_at),
    delivery_mode: stringValue_(followup.delivery_mode),
    forms_json: jsonString_(forms, []),
    response_completed_at: stringValue_(payload.followupResponse.completed_at),
    answers_json: jsonString_(payload.followupResponse.answers, {}),
    status: payload.followupResponse.completed_at ? "completed" : (requested ? "queued" : "not_requested")
  };
  var existingFollowup = findRowByValue_(sheets.FollowUp, followupDefinition, "followup_id", followupId);
  if (!existingFollowup) {
    appendMappedRow_(sheets.FollowUp, followupDefinition, followupValues);
  } else if (payload.followupResponse.completed_at) {
    updateMappedRow_(sheets.FollowUp, followupDefinition, existingFollowup.rowIndex, {
      response_completed_at: followupValues.response_completed_at,
      answers_json: followupValues.answers_json,
      status: "completed"
    });
  } else if (requested && existingFollowup.object.requested !== true) {
    updateMappedRow_(sheets.FollowUp, followupDefinition, existingFollowup.rowIndex, {
      submission_id: payload.submissionId,
      requested: true,
      send_at: followupValues.send_at,
      delivery_mode: followupValues.delivery_mode,
      forms_json: followupValues.forms_json,
      status: "queued"
    });
  }

  if (payload.email && requested && preview.subject && preview.body) {
    var queueDefinition = sheetDefinition_("followup_queue");
    appendUniqueMapped_(sheets.followup_queue, queueDefinition, "followup_id", followupId, {
      // First eleven values intentionally mirror the original README queue.
      created_at: receivedAt,
      send_at: stringValue_(followup.send_at),
      sent_at: "",
      session_id: payload.sessionId,
      participant_id: payload.participantId,
      email: payload.email,
      language: payload.language,
      delivery_mode: stringValue_(followup.delivery_mode),
      forms_json: jsonString_(forms, []),
      subject: stringValue_(preview.subject),
      body: stringValue_(preview.body),
      // Appended v2 metadata.
      followup_id: followupId,
      submission_id: payload.submissionId,
      experiment_id: payload.experimentId,
      assignment_id: payload.assignmentId,
      participant_id_normalized: payload.participantIdNormalized,
      store_id: payload.storeId,
      condition: payload.condition,
      status: "queued",
      last_error: ""
    });
  }
}

function updateFollowupDeliveryStatus_(
  contactSheet,
  contactDefinition,
  followupSheet,
  followupDefinition,
  followupId,
  status,
  errorMessage
) {
  if (!followupId) return;

  var contact = findRowByValue_(contactSheet, contactDefinition, "followup_id", followupId);
  if (contact) {
    updateMappedRow_(contactSheet, contactDefinition, contact.rowIndex, {
      sent_at: status === "sent" ? new Date() : contact.object.sent_at,
      status: status,
      last_error: errorMessage
    });
  }

  var followup = findRowByValue_(followupSheet, followupDefinition, "followup_id", followupId);
  if (followup && stringValue_(followup.object.status) !== "completed") {
    updateMappedRow_(followupSheet, followupDefinition, followup.rowIndex, {
      status: status === "sent" ? "sent" : "email_error"
    });
  }
}

function assertReceiptIdentity_(receipt, payload) {
  var comparisons = [
    ["experiment_id", payload.experimentId],
    ["allocation_version", payload.allocationVersion],
    ["assignment_id", payload.assignmentId],
    ["participant_id_normalized", payload.participantIdNormalized],
    ["store_id", payload.storeId],
    ["condition", payload.condition]
  ];
  for (var i = 0; i < comparisons.length; i += 1) {
    var header = comparisons[i][0];
    var expected = stringValue_(comparisons[i][1]);
    if (stringValue_(receipt[header]) !== expected) {
      throw new Error("submission_id_conflict");
    }
  }
}

function assertAssignmentMatchesPayload_(sheet, payload) {
  var definition = sheetDefinition_("Assignments");
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < definition.headers.length) {
    throw new Error("assignment_mismatch");
  }

  var actualHeaders = sheet.getRange(1, 1, 1, definition.headers.length).getValues()[0];
  for (var i = 0; i < definition.headers.length; i += 1) {
    if (stringValue_(actualHeaders[i]) !== definition.headers[i]) {
      throw new Error("assignment_mismatch");
    }
  }

  var assignment = findRowByValue_(
    sheet,
    definition,
    "assignment_id",
    payload.assignmentId
  );
  if (!assignment) throw new Error("assignment_mismatch");

  var object = assignment.object;
  var matches =
    stringValue_(object.experiment_id) === payload.experimentId &&
    stringValue_(object.allocation_version) === payload.allocationVersion &&
    stringValue_(object.store_id) === payload.storeId &&
    stringValue_(object.participant_id_normalized) === payload.participantIdNormalized &&
    stringValue_(object.condition) === payload.condition &&
    stringValue_(object.status).toLowerCase() === "confirmed" &&
    stringValue_(object.is_test).toLowerCase() !== "true";
  if (!matches) throw new Error("assignment_mismatch");
}

function deterministicConditionOrder_(participantKey) {
  return BTS_CONDITIONS_.slice().sort(function(left, right) {
    var leftHash = sha256Hex_(participantKey + "|" + left);
    var rightHash = sha256Hex_(participantKey + "|" + right);
    if (leftHash < rightHash) return -1;
    if (leftHash > rightHash) return 1;
    return left < right ? -1 : (left > right ? 1 : 0);
  });
}

function sha256Hex_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    stringValue_(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(byte) {
    var unsigned = byte < 0 ? byte + 256 : byte;
    return ("0" + unsigned.toString(16)).slice(-2);
  }).join("");
}

function requireActiveSpreadsheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty(BTS_SPREADSHEET_PROPERTY_);
  if (!spreadsheetId) throw new Error("no_configured_spreadsheet");
  return SpreadsheetApp.openById(spreadsheetId);
}

function sheetDefinition_(name) {
  for (var i = 0; i < BTS_SHEETS_.length; i += 1) {
    if (BTS_SHEETS_[i].name === name) return BTS_SHEETS_[i];
  }
  throw new Error("unknown_sheet_definition");
}

function ensureSheet_(spreadsheet, definition) {
  var sheet = spreadsheet.getSheetByName(definition.name);
  if (!sheet) sheet = spreadsheet.insertSheet(definition.name);

  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    ensureSheetColumnCapacity_(sheet, definition.headers.length);
    sheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
    return sheet;
  }

  var existingColumnCount = sheet.getLastColumn();
  var existingHeaders = sheet.getRange(1, 1, 1, existingColumnCount).getValues()[0];
  var comparableCount = Math.min(existingHeaders.length, definition.headers.length);
  for (var i = 0; i < comparableCount; i += 1) {
    if (stringValue_(existingHeaders[i]) !== definition.headers[i]) {
      throw new Error("header_mismatch:" + definition.name + ":column_" + String(i + 1));
    }
  }

  if (existingHeaders.length < definition.headers.length) {
    // Verify all existing headers before any structural change. Extend only at
    // the physical grid's end so existing columns and participant data stay put.
    ensureSheetColumnCapacity_(sheet, definition.headers.length);
    var missing = definition.headers.slice(existingHeaders.length);
    sheet.getRange(1, existingHeaders.length + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function ensureSheetColumnCapacity_(sheet, requiredColumns) {
  var currentColumns = sheet.getMaxColumns();
  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
}

function headerMap_(headers) {
  var map = {};
  headers.forEach(function(header, index) {
    map[header] = index;
  });
  return map;
}

function appendMappedRow_(sheet, definition, valuesByHeader) {
  var row = definition.headers.map(function(header) {
    return sheetSafe_(hasOwn_(valuesByHeader, header) ? valuesByHeader[header] : "");
  });
  sheet.appendRow(row);
}

function appendUniqueMapped_(sheet, definition, uniqueHeader, uniqueValue, valuesByHeader) {
  if (uniqueValue && findRowByValue_(sheet, definition, uniqueHeader, uniqueValue)) {
    return false;
  }
  appendMappedRow_(sheet, definition, valuesByHeader);
  return true;
}

function updateMappedRow_(sheet, definition, rowIndex, valuesByHeader) {
  var map = headerMap_(definition.headers);
  Object.keys(valuesByHeader).forEach(function(header) {
    if (!hasOwn_(map, header)) throw new Error("unknown_header:" + definition.name + ":" + header);
    sheet.getRange(rowIndex, map[header] + 1).setValue(sheetSafe_(valuesByHeader[header]));
  });
}

function findRowByValue_(sheet, definition, header, expectedValue) {
  var map = headerMap_(definition.headers);
  if (!hasOwn_(map, header)) throw new Error("unknown_header:" + definition.name + ":" + header);
  if (sheet.getLastRow() < 2) return null;

  var values = sheet.getRange(2, map[header] + 1, sheet.getLastRow() - 1, 1).getValues();
  var target = stringValue_(expectedValue);
  for (var i = 0; i < values.length; i += 1) {
    if (stringValue_(values[i][0]) === target) {
      var rowIndex = i + 2;
      var rowValues = sheet.getRange(rowIndex, 1, 1, definition.headers.length).getValues()[0];
      return {
        rowIndex: rowIndex,
        object: objectFromRow_(definition.headers, rowValues)
      };
    }
  }
  return null;
}

function readSheetObjects_(sheet, definition) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, definition.headers.length)
    .getValues()
    .map(function(row) {
      return objectFromRow_(definition.headers, row);
    });
}

function objectFromRow_(headers, row) {
  var object = {};
  headers.forEach(function(header, index) {
    object[header] = row[index];
  });
  return object;
}

function jsonpOutput_(callback, value) {
  var json = JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return ContentService
    .createTextOutput(callback + "(" + json + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function jsonOutput_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function isValidCallback_(callback) {
  return /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(callback);
}

function validateSafeIdentifier_(value, errorCode) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new Error(errorCode);
  }
}

function isValidOpaqueId_(value, maximumLength) {
  var text = stringValue_(value);
  if (!text || text.length > maximumLength) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text);
}

function isValidSubmissionId_(value) {
  var text = stringValue_(value);
  return text.length >= 8 && text.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text);
}

function validateEmail_(email) {
  var value = stringValue_(email).trim();
  if (
    !value ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  ) {
    throw new Error("invalid_email");
  }
}

function answerCellValue_(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value) || isPlainObject_(value)) return JSON.stringify(value);
  return value;
}

function jsonString_(value, defaultValue) {
  var selected = value === undefined || value === null ? defaultValue : value;
  return JSON.stringify(selected);
}

function sheetSafe_(value) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value) || isPlainObject_(value)) value = JSON.stringify(value);
  var text = stringValue_(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function unsheetText_(value) {
  var text = stringValue_(value);
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

function stringValue_(value) {
  return value === undefined || value === null ? "" : String(value);
}

function isPlainObject_(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function hasOwn_(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function valueOrBlank_(value) {
  return value === undefined || value === null ? "" : value;
}

function valueOrDefault_(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : value;
}

function asDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (!value) return null;
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function isoString_(value) {
  var date = asDate_(value);
  return date ? date.toISOString() : stringValue_(value);
}

function publicErrorCode_(error) {
  var message = error && error.message ? stringValue_(error.message) : "internal_error";
  var code = message.split(":")[0];
  return /^[a-z0-9_]+$/.test(code) ? code : "internal_error";
}

function publicErrorMessage_(error) {
  var code = publicErrorCode_(error);
  var messages = {
    http_test_disabled: "HTTP test access is disabled or the short-lived test configuration is invalid.",
    production_disabled: "Production collection is disabled.",
    production_closed: "Collection is outside the configured study period.",
    production_enrollment_not_open: "New participation opens on the announced recruitment start date.",
    production_enrollment_closed: "The recruitment period for new participation has ended.",
    production_completion_closed: "The deadline for completing the initial Web session has passed.",
    production_session_conflict: "This participant ID already belongs to another session. Contact the researcher.",
    production_unauthorized: "The participant session credential is invalid.",
    production_review_required: "Researcher review is required before collection can open.",
    http_test_unauthorized: "A valid private test access credential is required.",
    http_test_schema_required: "Test HTTP requests require explicit schema_version 2; legacy input is disabled.",
    http_test_scope_rejected: "The request is outside the fixed synthetic test scope.",
    http_test_parent_rejected: "The stored parent chain does not meet the synthetic test restrictions.",
    http_test_data_rejected: "Only the documented synthetic codes are permitted; personal data and free text are disabled.",
    invalid_callback: "Invalid JSONP callback.",
    invalid_action: "Only action=assign, action=receipt, or action=followup is supported by doGet.",
    invalid_event_type: "Unsupported event_type.",
    followup_not_configured: "The follow-up deployment settings are incomplete.",
    invalid_followup_token: "This follow-up link is invalid.",
    followup_identity_mismatch: "The follow-up identity does not match its original participation.",
    followup_instrument_mismatch: "The follow-up instrument version does not match.",
    invalid_followup_payload: "The follow-up response is incomplete.",
    invalid_followup_question_log: "The follow-up question log is invalid.",
    invalid_followup_time: "The follow-up response timing is invalid.",
    followup_not_due: "The one-week follow-up is not open yet.",
    followup_expired: "This follow-up link has expired.",
    followup_already_completed: "This follow-up has already been completed.",
    followup_event_conflict: "The follow-up event ID conflicts with an existing response.",
    invalid_store: "store must be A, B, or C.",
    invalid_participant_id: "participant_id must be four letters followed by two digits.",
    invalid_experiment_id: "Invalid experiment_id.",
    invalid_allocation_version: "Invalid allocation_version.",
    invalid_app_version: "Invalid app_version.",
    invalid_assignment_id: "Invalid assignment_id.",
    invalid_session_id: "Invalid session_id.",
    invalid_request_id: "Invalid request_id.",
    invalid_submission_id: "A valid 8-160 character submission_id is required.",
    invalid_schema_version: "schema_version must be legacy version 1 or current version 2.",
    incomplete_receipt_identity: "receipt requires experiment_id, allocation_version, assignment_id, participant_id_normalized, store_id, and condition.",
    receipt_identity_mismatch: "The receipt identity does not match this submission_id.",
    submission_id_conflict: "submission_id was already used for a different participant or condition.",
    assignment_mismatch: "The v2 assignment_id does not match the assigned experiment, allocation, participant, store, and condition.",
    invalid_condition: "condition must be no_image, original, or improved.",
    invalid_experiment_date: "experiment_date must use YYYY-MM-DD.",
    invalid_email: "Invalid email address.",
    empty_body: "Request body is empty.",
    payload_too_large: "Request body is too large.",
    invalid_json: "Request body is not valid JSON.",
    invalid_payload: "Request body must be a JSON object.",
    assignment_busy: "Assignment service is busy. Retry with the same client_run_id.",
    logging_busy: "Logging service is busy. Retry with the same submission_id.",
    followup_sender_busy: "Follow-up sender is already running.",
    no_active_spreadsheet: "This script must be bound to a spreadsheet.",
    no_configured_spreadsheet: "Run setupSheets from the bound spreadsheet before deploying the web app.",
    corrupt_assignment_record: "Existing assignment record is incomplete. Contact the researcher."
  };
  return messages[code] || "The request could not be completed. Check the Apps Script execution log.";
}
