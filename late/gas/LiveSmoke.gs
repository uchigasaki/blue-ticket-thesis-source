/**
 * TEST SHEET ONLY. Install beside Code.gs, then manually run runBtsLiveSmoke.
 * This exercises Apps Script + Sheets in-process, NOT the deployed HTTP URL.
 * No real participant/contact data, email, triggers, deletion, or public links.
 */
function runBtsLiveSmoke() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var properties = PropertiesService.getScriptProperties();
  var experiment = "bts-smoke-live-v1";
  btsSmokeGuard_(spreadsheet, properties, experiment);
  var original = {};
  var allowedParticipants = {};
  ["A", "B", "C"].forEach(function(store) {
    for (var number = 1; number <= 3; number += 1) allowedParticipants["QA" + store + "X0" + number] = store;
  });
  var overrides = {
    BTS_HTTP_MODE: "test",
    BTS_HTTP_TEST_SPREADSHEET_ID: spreadsheet.getId(),
    BTS_HTTP_TEST_EXPERIMENT_ID: experiment,
    BTS_HTTP_TEST_ALLOCATION_VERSION: "bts-smoke-allocation-v1",
    BTS_HTTP_TEST_PARTICIPANTS: JSON.stringify(allowedParticipants),
    BTS_HTTP_TEST_EXPIRES_AT: new Date(Date.now() + 30 * 60000).toISOString(),
    BTS_HTTP_TEST_ACCESS_TOKEN: sha256Hex_(Utilities.getUuid() + "|" + Utilities.getUuid()),
    BTS_EMAIL_ENABLED: "false",
    BTS_PUBLIC_APP_URL: "https://example.invalid/bts-smoke/",
    BTS_FOLLOWUP_INSTRUMENT_VERSION: "bts-smoke-instrument-v1",
    BTS_FOLLOWUP_INSTRUMENT_HASH: sha256Hex_(JSON.stringify(canonicalFollowupValue_({
      instrumentVersion: "bts-smoke-instrument-v1", items: ["smoke_q1"], answerKeys: { smoke_q1: "A" }
    }))),
    BTS_FOLLOWUP_QUESTION_IDS: "smoke_q1",
    BTS_FOLLOWUP_OPTIONAL_QUESTION_IDS: ""
  };
  // Keep the synthetic secret privately so reruns reproduce the same token.
  // The actual follow-up secret is restored even if a smoke assertion fails.
  var smokeSecret = properties.getProperty("BTS_SMOKE_TOKEN_SECRET");
  if (!smokeSecret) {
    smokeSecret = Utilities.getUuid() + Utilities.getUuid();
    properties.setProperty("BTS_SMOKE_TOKEN_SECRET", smokeSecret);
  }
  overrides.BTS_FOLLOWUP_TOKEN_SECRET = smokeSecret;
  Object.keys(overrides).forEach(function(key) { original[key] = properties.getProperty(key); });
  var checks = [];
  function check(value, name) {
    if (!value) throw new Error("bts_smoke_failed:" + name);
    checks.push(name);
  }
  try {
    Object.keys(overrides).forEach(function(key) { properties.setProperty(key, overrides[key]); });
    setupSheets();
    var assignments = [];
    ["A", "B", "C"].forEach(function(store) {
      var counts = { no_image: 0, original: 0, improved: 0 };
      for (var number = 1; number <= 3; number += 1) {
        var participant = "QA" + store + "X0" + number;
        var parameters = {
          action: "assign", schema_version: 2, app_version: "bts-smoke-v1",
          experiment_id: experiment, allocation_version: "bts-smoke-allocation-v1",
          participant_id: participant, store_id: store,
          session_id: "bts-smoke-session-" + participant,
          client_run_id: "bts-smoke-run-" + participant
        };
        var assignment = btsSmokeGet_(parameters);
        check(assignment.ok && assignment.status === "confirmed", "assignment_" + participant);
        counts[assignment.condition] += 1;
        assignments.push(assignment);
        var repeated = btsSmokeGet_(parameters);
        check(repeated.reused && repeated.assignment_id === assignment.assignment_id &&
          repeated.condition === assignment.condition, "reuse_" + participant);
      }
      check(counts.no_image === 1 && counts.original === 1 && counts.improved === 1, "balance_" + store);
    });

    // Synthetic backdating covers the ready path immediately; never backdate real data.
    var past = btsSmokeCompletion_(assignments[0], -8 * 86400000);
    var future = btsSmokeCompletion_(assignments[1], 0);
    [past, future].forEach(function(payload) {
      var result = btsSmokePost_(payload);
      check(result.ok, "completion_" + payload.participant_id);
      var before = btsSmokeSnapshot_(spreadsheet);
      check(btsSmokePost_(payload).duplicate, "completion_duplicate_" + payload.participant_id);
      check(btsSmokeSnapshot_(spreadsheet) === before, "completion_no_duplicate_writes_" + payload.participant_id);
      var receipt = btsSmokeGet_(btsSmokeReceipt_(payload));
      check(receipt.ok && receipt.status === "complete" && receipt.identity_match, "completion_receipt_" + payload.participant_id);
    });
    var beforeInvalid = btsSmokeSnapshot_(spreadsheet);
    var invalid = btsSmokeGet_({ action: "followup", schema_version: 2, token: "invalid-smoke-token" });
    check(invalid.error === "invalid_followup_token", "invalid_token_rejected");
    check(btsSmokeSnapshot_(spreadsheet) === beforeInvalid, "invalid_token_no_writes");

    var pastLink = completionFollowupLink_(spreadsheet, past.submission_id);
    var pastToken = pastLink.url.split("#token=")[1];
    var opened = btsSmokeGet_({ action: "followup", schema_version: 2, token: pastToken });
    check(opened.ok && (opened.status === "ready" || opened.status === "completed"), "ready_or_idempotent_completed");
    check(opened.assignment_id === past.allocation.assignment_id && opened.session_id === past.session_id &&
      opened.participant_id_normalized === past.participant_id && opened.store_id === past.store_id &&
      opened.condition === past.condition, "followup_parent_binding");
    var record = findFollowupByToken_(spreadsheet, pastToken).object;
    check(record.token_hash === sha256Hex_(pastToken) && btsSmokeSnapshot_(spreadsheet).indexOf(pastToken) === -1,
      "only_token_hash_in_cells");
    var response = btsSmokeResponse_(opened, pastToken, record);
    var countBefore = spreadsheet.getSheetByName("Participants").getLastRow();
    check(btsSmokePost_(response).ok, "followup_post");
    check(spreadsheet.getSheetByName("Participants").getLastRow() === countBefore, "followup_no_second_participant");
    var afterFollowup = btsSmokeSnapshot_(spreadsheet);
    check(btsSmokePost_(response).duplicate, "followup_duplicate");
    check(btsSmokeSnapshot_(spreadsheet) === afterFollowup, "followup_no_duplicate_writes");
    var followupReceipt = btsSmokeReceipt_(past);
    followupReceipt.submission_id = response.submission_id;
    followupReceipt.token = pastToken;
    var receipt = btsSmokeGet_(followupReceipt);
    check(receipt.ok && receipt.status === "complete" && receipt.event_type === "followup" &&
      receipt.followup_id === opened.followup_id, "followup_receipt");

    // A supplied boundary timestamp keeps this guard test repeatable on later days.
    // It does not replace Date or alter the server clock.
    var futureLink = completionFollowupLink_(spreadsheet, future.submission_id);
    var futureToken = futureLink.url.split("#token=")[1];
    var futureRecord = findFollowupByToken_(spreadsheet, futureToken).object;
    var due = asDate_(futureRecord.send_at);
    var beforeDue = new Date(due.getTime() - 1);
    var notDue = getFollowup_({ schema_version: 2, token: futureToken }, beforeDue);
    check(notDue.status === "not_due", "future_due_get_rejected");
    var early = btsSmokeResponse_(notDue, futureToken, futureRecord, due);
    var earlyError = "";
    var beforeEarly = btsSmokeSnapshot_(spreadsheet);
    try { persistFollowupResponse_(early, beforeDue); } catch (error) { earlyError = error.message; }
    check(earlyError === "followup_not_due", "future_due_post_rejected");
    check(btsSmokeSnapshot_(spreadsheet) === beforeEarly, "future_due_no_writes");
    check(spreadsheet.getSheetByName("Contact").getLastRow() === 1 &&
      spreadsheet.getSheetByName("followup_queue").getLastRow() === 1, "no_contacts_or_email_queue");
    var result = {
      status: "PASS", scope: "Apps Script and Sheets in-process only; not deployed HTTP",
      experiment_id: experiment, checks_passed: checks.length,
      checks: checks, data_rows: btsSmokeCounts_(spreadsheet),
      email_sent: 0, triggers_created: 0, deleted_rows: 0,
      synthetic_instrument: true, real_instrument_reviewed: false
    };
    Logger.log(JSON.stringify(result));
    return result;
  } finally {
    Object.keys(overrides).forEach(function(key) {
      if (original[key] === null) properties.deleteProperty(key);
      else properties.setProperty(key, original[key]);
    });
  }
}

function btsSmokeGuard_(spreadsheet, properties, experiment) {
  if (!spreadsheet || spreadsheet.getName().indexOf("BTS 後期3群比較 接続検証 ") !== 0) {
    throw new Error("bts_smoke_wrong_spreadsheet");
  }
  if (properties.getProperty("BTS_EMAIL_ENABLED") === "true") throw new Error("bts_smoke_email_enabled");
  var configured = properties.getProperty(BTS_SPREADSHEET_PROPERTY_);
  if (configured && configured !== spreadsheet.getId()) throw new Error("bts_smoke_spreadsheet_mismatch");
  spreadsheet.getSheets().forEach(function(sheet) {
    if (!sheet.getLastRow()) return;
    var definition = BTS_SHEETS_.filter(function(item) { return item.name === sheet.getName(); })[0];
    if (!definition || sheet.getLastColumn() > definition.headers.length) throw new Error("bts_smoke_non_smoke_data");
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.some(function(header, index) { return header !== definition.headers[index]; })) {
      throw new Error("bts_smoke_non_smoke_data");
    }
    readSheetObjects_(sheet, definition).forEach(function(row) {
      if (row.experiment_id !== experiment || !/^QA[ABC]X0[1-3]$/.test(String(row.participant_id || row.participant_id_normalized)) ||
        row.email || row.sent_at) throw new Error("bts_smoke_non_smoke_data");
    });
  });
}

function btsSmokeGet_(parameters) {
  var input = {};
  Object.keys(parameters).forEach(function(key) { input[key] = parameters[key]; });
  input.callback = "btsSmokeCallback";
  input.test_access_token = PropertiesService.getScriptProperties().getProperty("BTS_HTTP_TEST_ACCESS_TOKEN");
  var text = doGet({ parameter: input }).getContent();
  return JSON.parse(text.slice("btsSmokeCallback(".length, -2));
}

function btsSmokePost_(payload) {
  var input = {};
  Object.keys(payload).forEach(function(key) { input[key] = payload[key]; });
  input.test_access_token = PropertiesService.getScriptProperties().getProperty("BTS_HTTP_TEST_ACCESS_TOKEN");
  return JSON.parse(doPost({ postData: { contents: JSON.stringify(input) } }).getContent());
}

function btsSmokeCompletion_(assignment, offset) {
  var submissionId = "bts-smoke-completion-" + assignment.participant_id;
  var stored = findRowByValue_(requireActiveSpreadsheet_().getSheetByName("Participants"),
    sheetDefinition_("Participants"), "submission_id", submissionId);
  var end = stored ? asDate_(stored.object.end_time) : new Date(Date.now() + offset - 1000);
  return {
    event_type: "completion", schema_version: 2, submission_id: submissionId,
    experiment_id: assignment.experiment_id, app_version: "bts-smoke-v1",
    session_id: "bts-smoke-session-" + assignment.participant_id,
    participant_id: assignment.participant_id, participant_id_normalized: assignment.participant_id,
    store_id: assignment.store_id, condition: assignment.condition, language: "ja",
    experiment_date: end.toISOString().slice(0, 10),
    start_time: new Date(end.getTime() - 60000).toISOString(), end_time: end.toISOString(),
    allocation: { assignment_id: assignment.assignment_id, allocation_version: assignment.allocation_version,
      method: "gas_min_count_v1", status: "confirmed", client_run_id: "bts-smoke-run-" + assignment.participant_id },
    consent: { version: "synthetic-smoke-only", given: true }, phase_times: {},
    summary: { synthetic_smoke: true }, pre_survey: {}, post_survey: {}, answers: [],
    question_logs: [{ event_id: "bts-smoke-learning-" + assignment.participant_id, phase: "learning",
      question_id: "smoke_learning_q1", question_order: 1, selected_answer: "A", correct_answer: "A", is_correct: true }],
    followup: { requested: true, delivery_mode: "web_token", instrument_version: "bts-smoke-instrument-v1" },
    completion_status: "completed"
  };
}

function btsSmokeReceipt_(payload) {
  return { action: "receipt", schema_version: 2, submission_id: payload.submission_id,
    experiment_id: payload.experiment_id, allocation_version: payload.allocation.allocation_version,
    assignment_id: payload.allocation.assignment_id, participant_id_normalized: payload.participant_id,
    store_id: payload.store_id, condition: payload.condition };
}

function btsSmokeResponse_(identity, token, record, forcedTime) {
  var start = forcedTime || asDate_(record.response_started_at) || new Date(Date.now() - 1000);
  var end = forcedTime || asDate_(record.response_completed_at) || start;
  var response = followupIdentity_(record);
  response.event_type = "followup";
  response.schema_version = 2;
  response.token = token;
  response.submission_id = "bts-smoke-response-" + identity.participant_id;
  response.language = "ja";
  response.started_at = start.toISOString();
  response.completed_at = end.toISOString();
  response.answers = { smoke_q1: "A" };
  response.question_logs = [{
    event_id: "bts-smoke-followup-" + identity.participant_id, phase: "followup", question_id: "smoke_q1", question_order: 1,
    assignment_id: identity.assignment_id, session_id: identity.session_id,
    participant_id_normalized: identity.participant_id_normalized, store_id: identity.store_id, condition: identity.condition,
    selected_answer: "A", correct_answer: "A", is_correct: true,
    question_started_at: start.toISOString(), answered_at: end.toISOString(),
    response_time_ms: end.getTime() - start.getTime(), screen_dwell_time_ms: end.getTime() - start.getTime(), answer_change_count: 0
  }];
  return response;
}

function btsSmokeSnapshot_(spreadsheet) {
  return JSON.stringify(BTS_SHEETS_.map(function(definition) {
    var sheet = spreadsheet.getSheetByName(definition.name);
    return sheet ? sheet.getRange(1, 1, sheet.getLastRow(), definition.headers.length).getValues() : null;
  }));
}

function btsSmokeCounts_(spreadsheet) {
  var counts = {};
  BTS_SHEETS_.forEach(function(definition) {
    counts[definition.name] = spreadsheet.getSheetByName(definition.name).getLastRow() - 1;
  });
  return counts;
}
