const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

class MockRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount || 1;
    this.columnCount = columnCount || 1;
  }

  getValues() {
    return Array.from({ length: this.rowCount }, (_unused, rowOffset) =>
      Array.from({ length: this.columnCount }, (_unusedColumn, columnOffset) =>
        this.sheet.getCell(this.row + rowOffset, this.column + columnOffset)
      )
    );
  }

  setValues(values) {
    if (!Array.isArray(values) || values.length !== this.rowCount) {
      throw new Error("MockRange.setValues row count mismatch");
    }
    values.forEach((row, rowOffset) => {
      if (!Array.isArray(row) || row.length !== this.columnCount) {
        throw new Error("MockRange.setValues column count mismatch");
      }
      row.forEach((value, columnOffset) => {
        this.sheet.setCell(this.row + rowOffset, this.column + columnOffset, value);
      });
    });
    return this;
  }

  setValue(value) {
    this.sheet.setCell(this.row, this.column, value);
    return this;
  }

  setFontWeight() {
    return this;
  }

  setBackground() {
    return this;
  }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.frozenRows = 0;
    this.maxColumns = 26;
    this.columnInsertions = [];
  }

  getCell(row, column) {
    const storedRow = this.rows[row - 1];
    if (!storedRow || storedRow[column - 1] === undefined) return "";
    return storedRow[column - 1];
  }

  setCell(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push("");
    this.rows[row - 1][column - 1] = value;
  }

  getRange(row, column, rowCount, columnCount) {
    if (column < 1 || column + (columnCount || 1) - 1 > this.maxColumns) {
      throw new Error("MockSheet range exceeds physical column capacity: " + this.name);
    }
    return new MockRange(this, row, column, rowCount, columnCount);
  }

  getMaxColumns() {
    return this.maxColumns;
  }

  insertColumnsAfter(afterPosition, howMany) {
    if (!Number.isInteger(afterPosition) || afterPosition < 1 || afterPosition > this.maxColumns ||
      !Number.isInteger(howMany) || howMany < 1) throw new Error("Invalid mock column insertion");
    this.rows.forEach(row => {
      if (row.length > afterPosition) row.splice(afterPosition, 0, ...Array(howMany).fill(""));
    });
    this.columnInsertions.push({ afterPosition, howMany });
    this.maxColumns += howMany;
    return this;
  }

  getLastRow() {
    let lastRow = 0;
    this.rows.forEach((row, index) => {
      if (row.some(isFilledCell)) lastRow = index + 1;
    });
    return lastRow;
  }

  getLastColumn() {
    let lastColumn = 0;
    this.rows.forEach(row => {
      row.forEach((value, index) => {
        if (isFilledCell(value)) lastColumn = Math.max(lastColumn, index + 1);
      });
    });
    return lastColumn;
  }

  appendRow(row) {
    if (this.failNextAppendError) {
      const error = this.failNextAppendError;
      this.failNextAppendError = null;
      throw error;
    }
    this.rows.push(row.slice());
  }

  setFrozenRows(count) {
    this.frozenRows = count;
    return this;
  }
}

class MockSpreadsheet {
  constructor() {
    this.id = "mock-blue-ticket-spreadsheet";
    this.name = "Blue Ticket GAS mock";
    this.sheets = {};
  }

  getId() {
    return this.id;
  }

  getName() {
    return this.name;
  }

  getSheetByName(name) {
    return this.sheets[name] || null;
  }

  insertSheet(name) {
    if (this.sheets[name]) throw new Error("Duplicate mock sheet: " + name);
    const sheet = new MockSheet(name);
    this.sheets[name] = sheet;
    return sheet;
  }

  deleteSheet(sheet) {
    if (!sheet || this.sheets[sheet.name] !== sheet) {
      throw new Error("Unknown mock sheet");
    }
    delete this.sheets[sheet.name];
  }
}

class MockTextOutput {
  constructor(text) {
    this.text = text;
    this.mimeType = null;
  }

  setMimeType(mimeType) {
    this.mimeType = mimeType;
    return this;
  }

  getContent() {
    return this.text;
  }
}

function isFilledCell(value) {
  return value !== "" && value !== null && value !== undefined;
}

function installGasMocks() {
  const spreadsheet = new MockSpreadsheet();
  const scriptProperties = {};
  let uuidSequence = 0;
  let locked = false;

  global.SpreadsheetApp = {
    getActiveSpreadsheet: () => spreadsheet,
    openById: spreadsheetId => {
      if (spreadsheetId !== spreadsheet.getId()) {
        throw new Error("Unknown mock spreadsheet: " + spreadsheetId);
      }
      return spreadsheet;
    },
    flush: () => {}
  };

  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: key => scriptProperties[key] || null,
      setProperty: (key, value) => {
        scriptProperties[key] = String(value);
      },
      deleteProperty: key => { delete scriptProperties[key]; }
    })
  };

  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => {
        if (locked) return false;
        locked = true;
        return true;
      },
      releaseLock: () => {
        locked = false;
      }
    })
  };

  global.ContentService = {
    MimeType: {
      JSON: "application/json",
      JAVASCRIPT: "application/javascript"
    },
    createTextOutput: text => new MockTextOutput(text)
  };

  global.Utilities = {
    Charset: { UTF_8: "UTF-8" },
    DigestAlgorithm: { SHA_256: "SHA-256" },
    computeDigest: (_algorithm, value) =>
      Array.from(crypto.createHash("sha256").update(String(value), "utf8").digest())
        .map(byte => byte > 127 ? byte - 256 : byte),
    computeHmacSha256Signature: (value, secret) =>
      Array.from(crypto.createHmac("sha256", String(secret)).update(String(value), "utf8").digest())
        .map(byte => byte > 127 ? byte - 256 : byte),
    formatDate: value => new Date(value).toISOString().slice(0, 10),
    getUuid: () => {
      uuidSequence += 1;
      return "00000000-0000-4000-8000-" + String(uuidSequence).padStart(12, "0");
    }
  };

  global.MailApp = { sent: [], sendEmail: (email, subject, body) => { MailApp.sent.push({ email, subject, body }); } };
  global.Logger = { log: () => {} };

  return spreadsheet;
}

let assertionCount = 0;

function assertTrue(value, message) {
  assertionCount += 1;
  if (!value) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  assertionCount += 1;
  if (actual !== expected) {
    throw new Error(message + "\nexpected: " + String(expected) + "\nactual:   " + String(actual));
  }
}

function assertDeepEqual(actual, expected, message) {
  assertionCount += 1;
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(message + "\nexpected: " + expectedJson + "\nactual:   " + actualJson);
  }
}

function parseJsonOutput(output) {
  return JSON.parse(output.getContent());
}

function parseJsonpOutput(output, callback) {
  const text = output.getContent();
  const prefix = callback + "(";
  assertTrue(text.startsWith(prefix) && text.endsWith(");"), "JSONP envelope is valid");
  return JSON.parse(text.slice(prefix.length, -2));
}

function requestJsonp(parameters) {
  // Historical business-logic coverage is internal, not permission to expose
  // legacy or mail routes over HTTP. runHttpGateTests exercises real entrypoints.
  const callback = "mockCallback";
  let result;
  try {
    if (parameters.action === "assign") result = assignParticipant_(normalizeAssignmentRequest_(parameters));
    else if (parameters.action === "receipt") result = getReceiptStatus_(normalizeReceiptRequest_(parameters));
    else if (parameters.action === "followup") result = getFollowup_(parameters, new Date());
    else throw new Error("invalid_action");
  } catch (error) { result = { ok: false, error: publicErrorCode_(error), message: publicErrorMessage_(error) }; }
  return parseJsonpOutput(jsonpOutput_(callback, result), callback);
}

function postJson(payload) {
  try {
    if (payload.event_type === "followup") return persistFollowupResponse_(payload, new Date());
    return persistCompletion_(normalizeCompletionPayload_(payload, new Date()), new Date());
  } catch (error) { return { ok: false, error: publicErrorCode_(error), message: publicErrorMessage_(error) }; }
}

function spreadsheetSnapshot(spreadsheet) {
  const snapshot = {};
  Object.keys(spreadsheet.sheets).sort().forEach(name => {
    snapshot[name] = spreadsheet.sheets[name].rows;
  });
  return JSON.stringify(snapshot);
}

function sheetRowCounts(spreadsheet) {
  const counts = {};
  Object.keys(spreadsheet.sheets).sort().forEach(name => {
    counts[name] = spreadsheet.sheets[name].getLastRow();
  });
  return counts;
}

function makeV2Payload(assignment, submissionId) {
  return {
    schema_version: 2,
    submission_id: submissionId,
    experiment_id: BTS_DEFAULT_EXPERIMENT_ID_,
    app_version: "gas-mock-test",
    content_version: "mock-content-v2",
    common_correction_version: "mock-common-law-v1",
    instrument_version: "mock-instrument-v2",
    session_id: "session_mock_0001",
    participant_id: "TEST01",
    participant_id_normalized: "TEST01",
    store_id: "A",
    condition: assignment.condition,
    experiment_date: "2026-08-24",
    start_time: "2026-08-24T01:00:00.000Z",
    end_time: "2026-08-24T01:05:00.000Z",
    allocation: {
      assignment_id: assignment.assignment_id,
      allocation_version: BTS_DEFAULT_ALLOCATION_VERSION_,
      method: "gas_min_count_v1",
      status: "confirmed",
      client_run_id: "run_mock_0001"
    },
    consent: { version: "test", given: true },
    phase_times: {},
    summary: { overall_accuracy: 1 },
    pre_survey: {},
    post_survey: {},
    answers: [],
    question_logs: [
      {
        event_id: "event_mock_0001",
        phase: "learning",
        question_id: "question_1",
        question_order: 1,
        selected_answer: "A",
        correct_answer: "A",
        is_correct: true
      }
    ],
    followup: { requested: false },
    completion_status: "completed"
  };
}

function receiptIdentity(assignment) {
  return {
    schema_version: BTS_SCHEMA_VERSION_,
    experiment_id: BTS_DEFAULT_EXPERIMENT_ID_,
    allocation_version: BTS_DEFAULT_ALLOCATION_VERSION_,
    assignment_id: assignment.assignment_id,
    participant_id_normalized: "TEST01",
    store_id: "A",
    condition: assignment.condition
  };
}

function runSheetCapacityTests() {
  const definition = sheetDefinition_("FollowUp");
  const freshBook = new MockSpreadsheet();
  const fresh = ensureSheet_(freshBook, definition);
  assertEqual(fresh.getMaxColumns(), definition.headers.length, "new FollowUp grid extends to the required 31 columns");
  assertDeepEqual(fresh.columnInsertions, [{ afterPosition: 26, howMany: definition.headers.length - 26 }], "new grid appends only its missing columns");
  assertDeepEqual(fresh.rows[0], definition.headers, "31 headers fit in newly extended grid");
  ensureSheet_(freshBook, definition);
  assertEqual(fresh.columnInsertions.length, 1, "repeated ensureSheet adds no extra columns");

  const legacyBook = new MockSpreadsheet();
  const legacy = legacyBook.insertSheet("FollowUp");
  legacy.appendRow(definition.headers.slice(0, 17));
  legacy.appendRow(Array.from({ length: 17 }, (_value, index) => "legacy-value-" + index));
  const legacyValues = legacy.rows[1].slice();
  ensureSheet_(legacyBook, definition);
  assertDeepEqual(legacy.rows[1], legacyValues, "legacy participant values stay unchanged during column extension");
  assertDeepEqual(legacy.rows[0], definition.headers, "compatible legacy headers extend on the right");
  assertDeepEqual(legacy.columnInsertions, [{ afterPosition: 26, howMany: definition.headers.length - 26 }], "legacy grid only adds the physical-column deficit");

  const wideBook = new MockSpreadsheet();
  const wide = wideBook.insertSheet("FollowUp");
  wide.maxColumns = 50;
  ensureSheet_(wideBook, definition);
  assertEqual(wide.getMaxColumns(), 50, "an already wide grid is never shrunk");
  assertEqual(wide.columnInsertions.length, 0, "sufficient capacity performs no insertion");

  const conflictBook = new MockSpreadsheet();
  const conflict = conflictBook.insertSheet("FollowUp");
  conflict.appendRow(["unrelated-heading"]);
  conflict.appendRow(["existing-data"]);
  const conflictSnapshot = JSON.stringify(conflict.rows);
  let conflictMessage = "";
  try { ensureSheet_(conflictBook, definition); } catch (error) { conflictMessage = error.message; }
  assertTrue(conflictMessage.startsWith("header_mismatch:"), "conflicting schema is rejected");
  assertEqual(conflict.getMaxColumns(), 26, "header mismatch never expands the grid");
  assertEqual(conflict.columnInsertions.length, 0, "header mismatch has no structural mutations");
  assertEqual(JSON.stringify(conflict.rows), conflictSnapshot, "header mismatch leaves all values unchanged");
}

function run() {
  const spreadsheet = installGasMocks();
  const codePath = path.resolve(__dirname, "..", "gas", "Code.gs");
  const source = fs.readFileSync(codePath, "utf8");
  vm.runInThisContext(source, { filename: codePath });

  runSheetCapacityTests();

  const setupResult = setupSheets();
  assertTrue(setupResult.ok, "setupSheets succeeds");
  assertEqual(Object.keys(spreadsheet.sheets).length, BTS_SHEETS_.length, "all GAS sheets are created");

  const assignments = [];
  for (let participantNumber = 1; participantNumber <= 6; participantNumber += 1) {
    const participantId = "TEST" + String(participantNumber).padStart(2, "0");
    const response = requestJsonp({
      action: "assign",
      schema_version: BTS_SCHEMA_VERSION_,
      app_version: "2.0.0-foundation.5",
      experiment_id: BTS_DEFAULT_EXPERIMENT_ID_,
      allocation_version: BTS_DEFAULT_ALLOCATION_VERSION_,
      client_run_id: "run_assign_" + String(participantNumber).padStart(2, "0"),
      participant_id: participantId,
      store_id: "A"
    });
    assertTrue(response.ok, "assignment " + participantNumber + " succeeds");
    assignments.push(response);
  }

  const conditionCounts = { no_image: 0, original: 0, improved: 0 };
  assignments.forEach(assignment => {
    conditionCounts[assignment.condition] += 1;
  });
  assertDeepEqual(
    conditionCounts,
    { no_image: 2, original: 2, improved: 2 },
    "six assignments are balanced 2/2/2 within one store"
  );

  const originalAssignment = assignments[0];
  const repeatedAssignment = requestJsonp({
    action: "assign",
    schema_version: BTS_SCHEMA_VERSION_,
    app_version: "2.0.0-foundation.5",
    experiment_id: BTS_DEFAULT_EXPERIMENT_ID_,
    allocation_version: BTS_DEFAULT_ALLOCATION_VERSION_,
    client_run_id: "a_different_retry_id",
    participant_id: "TEST01",
    store_id: "A"
  });
  assertTrue(repeatedAssignment.reused, "a repeated participant assignment is marked reused");
  assertEqual(repeatedAssignment.client_run_id, "a_different_retry_id", "a reused assignment echoes the current client_run_id");
  assertEqual(repeatedAssignment.schema_version, BTS_SCHEMA_VERSION_, "assignment response echoes the requested schema version");
  assertEqual(repeatedAssignment.app_version, "2.0.0-foundation.5", "assignment response echoes the requested app version");
  assertEqual(repeatedAssignment.assignment_id, originalAssignment.assignment_id, "assignment_id remains fixed");
  assertEqual(repeatedAssignment.condition, originalAssignment.condition, "condition remains fixed");
  assertEqual(spreadsheet.getSheetByName("Assignments").getLastRow(), 7, "reassignment adds no row");

  const invalidAssignmentSchema = requestJsonp({
    action: "assign",
    schema_version: 1,
    app_version: "2.0.0-foundation.5",
    experiment_id: BTS_DEFAULT_EXPERIMENT_ID_,
    allocation_version: BTS_DEFAULT_ALLOCATION_VERSION_,
    client_run_id: "run_invalid_schema",
    participant_id: "PROT01",
    store_id: "A"
  });
  assertEqual(invalidAssignmentSchema.error, "invalid_schema_version", "assignment rejects a stale schema protocol");
  const missingAssignmentApp = requestJsonp({
    action: "assign",
    schema_version: BTS_SCHEMA_VERSION_,
    experiment_id: BTS_DEFAULT_EXPERIMENT_ID_,
    allocation_version: BTS_DEFAULT_ALLOCATION_VERSION_,
    client_run_id: "run_missing_app",
    participant_id: "APIV01",
    store_id: "A"
  });
  assertEqual(missingAssignmentApp.error, "invalid_app_version", "assignment requires an explicit app version");
  assertEqual(spreadsheet.getSheetByName("Assignments").getLastRow(), 7, "invalid assignment protocols add no row");

  const payload = makeV2Payload(originalAssignment, "submission_mock_0001");
  const malformedVersion = JSON.parse(JSON.stringify(payload));
  malformedVersion.content_version = "=1+1";
  const beforeMalformedVersion = spreadsheetSnapshot(spreadsheet);
  assertEqual(postJson(malformedVersion).error, "invalid_content_version", "invalid version metadata is rejected before writes");
  assertEqual(spreadsheetSnapshot(spreadsheet), beforeMalformedVersion, "invalid version metadata does not change Sheets");

  const missingLogSheet = spreadsheet.getSheetByName("logs");
  spreadsheet.deleteSheet(missingLogSheet);
  const badAssignmentPayload = JSON.parse(JSON.stringify(payload));
  badAssignmentPayload.submission_id = "submission_bad_assignment_0001";
  badAssignmentPayload.allocation.assignment_id = "assignment_unknown_0001";
  const beforeBadAssignment = spreadsheetSnapshot(spreadsheet);
  const badAssignmentResult = postJson(badAssignmentPayload);
  assertEqual(badAssignmentResult.error, "assignment_mismatch", "an unknown assignment is rejected");
  assertEqual(
    spreadsheetSnapshot(spreadsheet),
    beforeBadAssignment,
    "assignment mismatch writes no rows and creates no target sheet or header"
  );
  assertEqual(spreadsheet.getSheetByName("logs"), null, "rejected assignment does not recreate logs");
  setupSheets();

  ["2x", 1.5, true, 0, 3].forEach((invalidSchemaVersion, index) => {
    const invalidPayload = JSON.parse(JSON.stringify(payload));
    invalidPayload.submission_id = "submission_bad_schema_" + String(index).padStart(4, "0");
    invalidPayload.schema_version = invalidSchemaVersion;
    const beforeInvalidSchema = spreadsheetSnapshot(spreadsheet);
    const invalidResult = postJson(invalidPayload);
    assertEqual(invalidResult.error, "invalid_schema_version", "invalid schema_version is rejected");
    assertEqual(spreadsheetSnapshot(spreadsheet), beforeInvalidSchema, "invalid schema_version writes nothing");
  });

  const identity = receiptIdentity(originalAssignment);
  const missingReceipt = requestJsonp(Object.assign({
    action: "receipt",
    submission_id: payload.submission_id
  }, identity));
  assertEqual(missingReceipt.status, "missing", "receipt reports missing before POST");
  assertEqual(missingReceipt.identity_match, null, "missing receipt has no stored identity match");
  Object.keys(identity).forEach(key => {
    assertEqual(missingReceipt[key], identity[key], "missing receipt echoes requested " + key);
  });

  const incompleteIdentity = Object.assign({}, identity);
  delete incompleteIdentity.assignment_id;
  const incompleteReceipt = requestJsonp(Object.assign({
    action: "receipt",
    submission_id: payload.submission_id
  }, incompleteIdentity));
  assertEqual(
    incompleteReceipt.error,
    "incomplete_receipt_identity",
    "receipt rejects an incomplete identity"
  );

  const staleSchemaReceipt = requestJsonp(Object.assign({
    action: "receipt",
    submission_id: payload.submission_id,
    schema_version: 1
  }, identity, { schema_version: 1 }));
  assertEqual(staleSchemaReceipt.error, "invalid_schema_version", "receipt rejects a stale schema protocol");

  const shortIdReceipt = requestJsonp(Object.assign({
    action: "receipt",
    submission_id: "short"
  }, identity));
  assertEqual(shortIdReceipt.error, "invalid_submission_id", "receipt rejects a short submission_id");

  spreadsheet.getSheetByName("logs").failNextAppendError = new Error("forced_mock_failure");
  const failedPost = postJson(payload);
  assertTrue(!failedPost.ok, "a forced persistence failure rejects the first POST");
  assertEqual(failedPost.error, "forced_mock_failure", "the forced persistence error is reported safely");

  const receiptDefinition = sheetDefinition_("SubmissionReceipts");
  const receiptRow = findRowByValue_(
    spreadsheet.getSheetByName("SubmissionReceipts"),
    receiptDefinition,
    "submission_id",
    payload.submission_id
  );
  assertTrue(Boolean(receiptRow), "failed persistence still leaves an idempotency receipt");

  const errorReceipt = requestJsonp(Object.assign({
    action: "receipt",
    submission_id: payload.submission_id
  }, identity));
  assertEqual(errorReceipt.status, "error", "receipt reports a real POST persistence error");
  assertTrue(Boolean(errorReceipt.last_error), "error receipt contains a safe non-empty error message");
  assertTrue(!errorReceipt.duplicate, "error is not complete/duplicate");

  updateMappedRow_(spreadsheet.getSheetByName("SubmissionReceipts"), receiptDefinition, receiptRow.rowIndex, {
    status: "processing"
  });
  const processingReceipt = requestJsonp(Object.assign({
    action: "receipt",
    submission_id: payload.submission_id
  }, identity));
  assertEqual(processingReceipt.status, "processing", "receipt reports processing");
  assertTrue(!processingReceipt.duplicate, "processing is not complete/duplicate");

  updateMappedRow_(spreadsheet.getSheetByName("SubmissionReceipts"), receiptDefinition, receiptRow.rowIndex, {
    status: "error",
    last_error: errorReceipt.last_error
  });
  const recoveredPost = postJson(payload);
  assertTrue(recoveredPost.ok && !recoveredPost.duplicate, "retrying the same failed submission completes it");
  ["logs", "Participants", "QuestionLogs"].forEach(name => {
    const savedVersion = findRowByValue_(spreadsheet.getSheetByName(name), sheetDefinition_(name), "submission_id", payload.submission_id).object;
    ["content_version", "common_correction_version", "instrument_version"].forEach(key => {
      assertEqual(savedVersion[key], payload[key], name + " preserves " + key);
    });
  });

  let completeReceipt = requestJsonp(Object.assign({
    action: "receipt",
    submission_id: payload.submission_id
  }, identity));
  assertEqual(completeReceipt.status, "complete", "receipt reports complete after retry");
  assertTrue(completeReceipt.identity_match, "complete receipt identity matches");
  assertTrue(completeReceipt.duplicate, "complete receipt marks the submission as already stored");
  Object.keys(identity).forEach(key => {
    assertEqual(completeReceipt[key], identity[key], "complete receipt returns stored " + key);
  });

  const alternateReceiptIdentityValues = {
    experiment_id: "blue-ticket-simulator-other",
    allocation_version: "2026-late-v2",
    assignment_id: "assignment_different_0001",
    participant_id_normalized: "TEST02",
    store_id: "B",
    condition: BTS_CONDITIONS_.find(condition => condition !== originalAssignment.condition)
  };
  Object.keys(alternateReceiptIdentityValues).forEach(key => {
    const conflictingReceipt = requestJsonp(Object.assign({
      action: "receipt",
      submission_id: payload.submission_id
    }, identity, {
      [key]: alternateReceiptIdentityValues[key]
    }));
    assertEqual(
      conflictingReceipt.error,
      "receipt_identity_mismatch",
      "receipt rejects a different " + key
    );
    assertDeepEqual(
      Object.keys(conflictingReceipt).sort(),
      ["error", "message", "ok"],
      "receipt mismatch for " + key + " returns only fail-closed error keys"
    );
  });

  const beforeDuplicateCounts = sheetRowCounts(spreadsheet);
  const beforeDuplicateSnapshot = spreadsheetSnapshot(spreadsheet);
  const duplicatePost = postJson(payload);
  assertTrue(duplicatePost.ok && duplicatePost.duplicate, "repeated v2 POST is acknowledged as duplicate");
  assertDeepEqual(sheetRowCounts(spreadsheet), beforeDuplicateCounts, "duplicate POST adds no rows to any sheet");
  assertEqual(
    spreadsheetSnapshot(spreadsheet),
    beforeDuplicateSnapshot,
    "duplicate POST does not modify existing stored values"
  );

  const assignmentIdentityMismatches = [
    {
      label: "experiment_id",
      mutate: mismatchPayload => {
        mismatchPayload.experiment_id = "blue-ticket-simulator-other";
      }
    },
    {
      label: "allocation_version",
      mutate: mismatchPayload => {
        mismatchPayload.allocation.allocation_version = "2026-late-v2";
      }
    },
    {
      label: "participant_id_normalized",
      mutate: mismatchPayload => {
        mismatchPayload.participant_id = "TEST02";
        mismatchPayload.participant_id_normalized = "TEST02";
      }
    },
    {
      label: "store_id",
      mutate: mismatchPayload => {
        mismatchPayload.store_id = "B";
      }
    },
    {
      label: "condition",
      mutate: mismatchPayload => {
        mismatchPayload.condition = BTS_CONDITIONS_.find(
          condition => condition !== originalAssignment.condition
        );
      }
    }
  ];
  assignmentIdentityMismatches.forEach((testCase, index) => {
    const mismatchPayload = JSON.parse(JSON.stringify(payload));
    mismatchPayload.submission_id = "submission_assignment_mismatch_" + String(index).padStart(4, "0");
    testCase.mutate(mismatchPayload);
    const beforeMismatch = spreadsheetSnapshot(spreadsheet);
    const mismatchResult = postJson(mismatchPayload);
    assertEqual(
      mismatchResult.error,
      "assignment_mismatch",
      "assignment rejects a different " + testCase.label
    );
    assertEqual(
      spreadsheetSnapshot(spreadsheet),
      beforeMismatch,
      "assignment mismatch for " + testCase.label + " writes nothing"
    );
  });

  const expectedLegacyLogsHeaders = [
    "created_at",
    "session_id",
    "participant_id",
    "email",
    "language",
    "summary_json",
    "pre_survey_json",
    "post_survey_json",
    "answers_json"
  ];
  const expectedLegacyQueueHeaders = [
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
    "body"
  ];
  assertDeepEqual(
    sheetDefinition_("logs").headers.slice(0, 9),
    expectedLegacyLogsHeaders,
    "logs keeps the legacy first nine headers"
  );
  assertDeepEqual(
    sheetDefinition_("followup_queue").headers.slice(0, 11),
    expectedLegacyQueueHeaders,
    "followup_queue keeps the legacy first eleven headers"
  );

  const legacyPayload = {
    session_id: "legacy_session_0001",
    participant_id: "OLDX01",
    email: "legacy@example.com",
    language: "ja",
    session_started_at: "2026-08-24T02:00:00.000Z",
    simulation_completed_at: "2026-08-24T02:04:00.000Z",
    post_survey_completed_at: "2026-08-24T02:05:00.000Z",
    followup: {
      requested: true,
      send_at: "2026-08-31T02:05:00.000Z",
      delivery_mode: "email",
      email_preview: {
        forms: ["https://example.invalid/form"],
        subject: "Legacy subject",
        body: "Legacy body"
      }
    },
    summary: { legacy_score: 3 },
    pre_survey: { pre: "value" },
    post_survey: { post: "value" },
    answers: [{ question_id: "legacy_question", selected_answer: "A" }]
  };
  const legacyPost = postJson(legacyPayload);
  assertTrue(legacyPost.ok, "legacy v1 POST remains accepted");
  const legacyVersions = findRowByValue_(spreadsheet.getSheetByName("Participants"), sheetDefinition_("Participants"), "participant_id", "OLDX01").object;
  ["content_version", "common_correction_version", "instrument_version"].forEach(key => {
    assertEqual(legacyVersions[key], "", "legacy absent " + key + " remains blank, not inferred");
  });

  const logsSheet = spreadsheet.getSheetByName("logs");
  const legacyLogsRow = logsSheet.rows[logsSheet.getLastRow() - 1].slice(0, 9);
  assertTrue(legacyLogsRow[0] instanceof Date, "legacy logs created_at remains the first value");
  assertDeepEqual(
    legacyLogsRow.slice(1),
    [
      "legacy_session_0001",
      "OLDX01",
      "legacy@example.com",
      "ja",
      JSON.stringify(legacyPayload.summary),
      JSON.stringify(legacyPayload.pre_survey),
      JSON.stringify(legacyPayload.post_survey),
      JSON.stringify(legacyPayload.answers)
    ],
    "legacy logs values remain in the original first-nine order"
  );

  const queueSheet = spreadsheet.getSheetByName("followup_queue");
  const legacyQueueRow = queueSheet.rows[queueSheet.getLastRow() - 1].slice(0, 11);
  assertTrue(legacyQueueRow[0] instanceof Date, "legacy queue created_at remains the first value");
  assertDeepEqual(
    legacyQueueRow.slice(1),
    [
      legacyPayload.followup.send_at,
      "",
      legacyPayload.session_id,
      legacyPayload.participant_id,
      legacyPayload.email,
      legacyPayload.language,
      legacyPayload.followup.delivery_mode,
      JSON.stringify(legacyPayload.followup.email_preview.forms),
      legacyPayload.followup.email_preview.subject,
      legacyPayload.followup.email_preview.body
    ],
    "legacy queue values remain in the original first-eleven order"
  );

  runFollowupTests(spreadsheet, originalAssignment);
  runHttpGateTests();
  console.log("PASS: " + assertionCount + " assertions");
}

function runHttpGateTests() {
  const spreadsheet = installGasMocks();
  spreadsheet.name = "BTS 後期3群比較 接続検証 HTTP mock";
  const p = PropertiesService.getScriptProperties();
  const credential = "a".repeat(64); // Fixed FAKE credential, local fixture only.
  const get = (parameters, token = credential) => parseJsonpOutput(doGet({ parameter: Object.assign({ callback: "httpTestCallback", test_access_token: token }, parameters) }), "httpTestCallback");
  const post = (payload, token = credential) => parseJsonOutput(doPost({ postData: { contents: JSON.stringify(Object.assign({ test_access_token: token }, payload)) } }));
  const request = { action: "assign", schema_version: 2, app_version: "bts-http-test-v1", experiment_id: "bts-http-test-v1",
    allocation_version: "bts-http-allocation-v1", participant_id: "QAAX01", store_id: "A", session_id: "bts-http-session-QAAX01", client_run_id: "bts-http-run-QAAX01" };
  const rejectWithoutWrites = (fn, expected, label) => {
    const before = spreadsheetSnapshot(spreadsheet);
    const output = fn();
    assertEqual(output.error, expected, label);
    assertEqual(spreadsheetSnapshot(spreadsheet), before, label + " changes no cells");
    assertTrue(!JSON.stringify(output).includes(credential), label + " never echoes test access credential");
  };
  rejectWithoutWrites(() => get(request), "http_test_disabled", "GET is disabled with no HTTP properties");
  rejectWithoutWrites(() => post({ schema_version: 2 }), "http_test_disabled", "POST is disabled with no HTTP properties");
  assertEqual(Object.keys(spreadsheet.sheets).length, 0, "disabled requests do not create even headers");
  let capturedLogs = [];
  Logger.log = value => capturedLogs.push(String(value));
  const initialized = initializeBtsHttpTestSecret();
  const randomSecret = p.getProperty("BTS_HTTP_TEST_ACCESS_TOKEN");
  assertTrue(initialized.created && /^[a-f0-9]{64}$/.test(randomSecret), "manual initializer creates a nonprinted random secret");
  assertTrue(!JSON.stringify(initialized).includes(randomSecret) && !capturedLogs.join("").includes(randomSecret), "initializer never returns or logs the secret");
  assertTrue(!initializeBtsHttpTestSecret().created && p.getProperty("BTS_HTTP_TEST_ACCESS_TOKEN") === randomSecret, "initializer does not rotate an existing secret");
  assertEqual(p.getProperty("BTS_HTTP_MODE"), null, "secret initialization cannot enable HTTP");
  setupSheets();
  const settings = {
    BTS_HTTP_MODE: "test", BTS_EMAIL_ENABLED: "false", BTS_HTTP_TEST_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
    BTS_HTTP_TEST_EXPERIMENT_ID: request.experiment_id, BTS_HTTP_TEST_ALLOCATION_VERSION: request.allocation_version,
    BTS_HTTP_TEST_PARTICIPANTS: JSON.stringify({ QAAX01: "A", QAAX02: "A", QABX01: "B" }),
    BTS_HTTP_TEST_ACCESS_TOKEN: credential, BTS_HTTP_TEST_SPREADSHEET_ID: spreadsheet.getId()
  };
  Object.entries(settings).forEach(([key, value]) => p.setProperty(key, value));
  for (const key of Object.keys(settings)) {
    p.deleteProperty(key);
    rejectWithoutWrites(() => get(request), "http_test_disabled", "missing " + key + " disables GET");
    rejectWithoutWrites(() => post({ schema_version: 2 }), "http_test_disabled", "missing " + key + " disables POST");
    p.setProperty(key, settings[key]);
  }
  for (const [key, value] of [
    ["BTS_HTTP_MODE", "production"], ["BTS_HTTP_MODE", "disabled"], ["BTS_EMAIL_ENABLED", "true"],
    ["BTS_HTTP_TEST_EXPIRES_AT", new Date(Date.now() - 1000).toISOString()], ["BTS_HTTP_TEST_EXPIRES_AT", new Date(Date.now() + 48 * 3600000).toISOString()],
    ["BTS_HTTP_TEST_EXPIRES_AT", "tomorrow"], ["BTS_HTTP_TEST_EXPERIMENT_ID", BTS_DEFAULT_EXPERIMENT_ID_],
    ["BTS_HTTP_TEST_ALLOCATION_VERSION", BTS_DEFAULT_ALLOCATION_VERSION_], ["BTS_HTTP_TEST_PARTICIPANTS", "{}"],
    ["BTS_HTTP_TEST_PARTICIPANTS", '{"REAL01":"A"}'], ["BTS_HTTP_TEST_PARTICIPANTS", '{"QAAX01":"X"}'],
    ["BTS_HTTP_TEST_PARTICIPANTS", "{"], ["BTS_HTTP_TEST_ACCESS_TOKEN", "weak"], ["BTS_HTTP_TEST_SPREADSHEET_ID", "another-sheet"]
  ]) {
    p.setProperty(key, value);
    rejectWithoutWrites(() => get(request), key === "BTS_HTTP_MODE" && value === "production" ? "production_disabled" : "http_test_disabled", "invalid " + key + " fails closed");
    p.setProperty(key, settings[key]);
  }
  for (const token of ["", "b".repeat(64), "short"]) {
    rejectWithoutWrites(() => get(request, token), "http_test_unauthorized", "invalid access credential blocks GET");
    rejectWithoutWrites(() => post({ schema_version: 2 }, token), "http_test_unauthorized", "invalid access credential blocks POST");
  }
  for (const mutation of [{ experiment_id: "bts-http-other" }, { allocation_version: "bts-http-other" }, { participant_id: "QAAX99" }, { store_id: "B" }, { participant_id_normalized: "QAAX02" }]) {
    rejectWithoutWrites(() => get(Object.assign({}, request, mutation)), "http_test_scope_rejected", "assign scope is pinned " + Object.keys(mutation)[0]);
  }
  rejectWithoutWrites(() => get(Object.assign({}, request, { schema_version: 1 })), "http_test_schema_required", "HTTP GET rejects legacy schema");
  const missingSchema = Object.assign({}, request); delete missingSchema.schema_version;
  rejectWithoutWrites(() => get(missingSchema), "http_test_schema_required", "HTTP GET rejects missing schema");
  spreadsheet.name = "Production study";
  rejectWithoutWrites(() => get(request), "http_test_disabled", "non-test Sheet name blocks HTTP");
  spreadsheet.name = "BTS 後期3群比較 接続検証 HTTP mock";
  const assignment = get(request);
  assertTrue(assignment.ok, "authorized test assignment succeeds");
  assertTrue(get(request).reused, "authorized duplicate assignment is stable");
  const reflected = doGet({ parameter: Object.assign({}, request, { callback: credential, test_access_token: credential }) }).getContent();
  assertTrue(!reflected.includes(credential) && JSON.parse(reflected).error === "invalid_callback", "callback cannot reflect the supplied access secret");
  const make = (id, requested) => {
    const payload = makeV2Payload(assignment, id);
    Object.assign(payload, { experiment_id: request.experiment_id, app_version: request.app_version,
      participant_id: request.participant_id, participant_id_normalized: request.participant_id,
      session_id: request.session_id, start_time: new Date(Date.now() - 8 * 86400000 - 60000).toISOString(), end_time: new Date(Date.now() - 8 * 86400000).toISOString(),
      summary: { synthetic_http: true }, followup: { requested: Boolean(requested), delivery_mode: "web_token", instrument_version: "bts-http-instrument-v1" } });
    payload.allocation.allocation_version = request.allocation_version;
    payload.question_logs[0].event_id = "bts-http-event-" + id;
    return payload;
  };
  const payload = make("bts-http-completion-001", false);
  for (const version of [undefined, 1, "2"]) {
    const changed = Object.assign({}, payload); if (version === undefined) delete changed.schema_version; else changed.schema_version = version;
    rejectWithoutWrites(() => post(changed), "http_test_schema_required", "HTTP POST allows explicit numeric schema2 only");
  }
  for (const mutation of [{ email: "someone@example.invalid" }, { name: "Person" }, { summary: { comment: "Name" } },
    { summary: { synthetic_http: credential } }, { pre_survey: { age: 21 } }, { answers: ["Someone"] },
    { question_logs: [{ selected_answer: "Alice" }] }, { summary: { arbitrary_text: "name" } },
    { phase_times: { [credential]: 1 } }, { phase_times: { "person@example.invalid": 1 } }]) {
    rejectWithoutWrites(() => post(Object.assign({}, payload, mutation)), "http_test_data_rejected", "HTTP rejects personal/free text input " + Object.keys(mutation)[0]);
  }
  const nestedWrongIdentity = JSON.parse(JSON.stringify(payload)); nestedWrongIdentity.question_logs[0].participant_id_normalized = "QAAX02";
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const polluted = JSON.parse(JSON.stringify(payload));
    Object.defineProperty(polluted, key, { value: { email: "person@example.invalid" }, enumerable: true });
    rejectWithoutWrites(() => parseJsonOutput(doPost({ postData: { contents: JSON.stringify(polluted).replace('{', '{"test_access_token":"' + credential + '",') } })), "http_test_data_rejected", "HTTP rejects own prototype-affecting key " + key);
    const nested = JSON.parse(JSON.stringify(payload));
    Object.defineProperty(nested.phase_times, key, { value: { email: "person@example.invalid" }, enumerable: true });
    rejectWithoutWrites(() => post(nested), "http_test_data_rejected", "HTTP rejects nested prototype-affecting key " + key);
  }
  rejectWithoutWrites(() => post(nestedWrongIdentity), "http_test_scope_rejected", "nested question identity cannot switch allowed participants");
  for (const mutation of [{ experiment_id: "bts-http-other" }, { participant_id: "QAAX02", participant_id_normalized: "QAAX02" }, { store_id: "B" }]) {
    const changed = Object.assign({}, payload, mutation);
    const expected = mutation.participant_id ? "http_test_parent_rejected" : "http_test_scope_rejected";
    rejectWithoutWrites(() => post(changed), expected, "completion binds request and actual parent assignment");
  }
  assertTrue(post(payload).ok, "authorized synthetic completion succeeds without followup URL");
  const completedSnapshot = spreadsheetSnapshot(spreadsheet);
  assertTrue(post(payload).duplicate, "authorized duplicate completion remains idempotent");
  assertEqual(spreadsheetSnapshot(spreadsheet), completedSnapshot, "duplicate HTTP completion changes no cells");
  const receiptRequest = Object.assign({}, request, { action: "receipt", submission_id: payload.submission_id, assignment_id: assignment.assignment_id,
    participant_id_normalized: request.participant_id, condition: assignment.condition });
  assertEqual(get(receiptRequest).status, "complete", "HTTP completion receipt succeeds");
  assertEqual(get(Object.assign({}, receiptRequest, { submission_id: "bts-http-missing-001" })).status, "missing", "missing receipt is allowed only with a real authorized assignment");
  rejectWithoutWrites(() => get(Object.assign({}, receiptRequest, { submission_id: "bts-http-missing-001", assignment_id: "bts-http-unknown-assignment" })), "http_test_parent_rejected", "missing receipt cannot bypass parent assignment validation");
  rejectWithoutWrites(() => get(Object.assign({}, receiptRequest, { participant_id: "QAAX02", participant_id_normalized: "QAAX02" })), "http_test_parent_rejected", "receipt cannot inspect another allowed participant");
  rejectWithoutWrites(() => get(Object.assign({}, receiptRequest, { experiment_id: "bts-http-other" })), "http_test_scope_rejected", "receipt cannot inspect another test experiment");
  const corrupt = (sheetName, key, value, field, replacement, invoke, error) => {
    const definition = sheetDefinition_(sheetName);
    const row = findRowByValue_(spreadsheet.getSheetByName(sheetName), definition, key, value);
    const original = row.object[field];
    updateMappedRow_(spreadsheet.getSheetByName(sheetName), definition, row.rowIndex, { [field]: replacement });
    rejectWithoutWrites(invoke, error, "stored " + sheetName + "." + field + " is also checked");
    updateMappedRow_(spreadsheet.getSheetByName(sheetName), definition, row.rowIndex, { [field]: original });
  };
  corrupt("Assignments", "assignment_id", assignment.assignment_id, "participant_id_normalized", "QAAX02", () => get(request), "http_test_scope_rejected");
  corrupt("Participants", "submission_id", payload.submission_id, "experiment_id", "bts-http-other", () => get(receiptRequest), "http_test_scope_rejected");
  corrupt("logs", "submission_id", payload.submission_id, "email", "person@example.invalid", () => post(payload), "http_test_parent_rejected");
  corrupt("Participants", "submission_id", payload.submission_id, "schema_version", 1, () => get(receiptRequest), "http_test_parent_rejected");
  corrupt("Assignments", "assignment_id", assignment.assignment_id, "participant_id", "REAL01", () => get(Object.assign({}, request, { participant_id: "QAAX02" })), "http_test_scope_rejected");
  corrupt("SubmissionReceipts", "submission_id", payload.submission_id, "store_id", "B", () => get(receiptRequest), "http_test_scope_rejected");
  p.setProperty("BTS_PUBLIC_APP_URL", "https://example.invalid/http-test/");
  p.setProperty("BTS_FOLLOWUP_INSTRUMENT_VERSION", "bts-http-instrument-v1");
  p.setProperty("BTS_FOLLOWUP_INSTRUMENT_HASH", "c".repeat(64));
  p.setProperty("BTS_FOLLOWUP_QUESTION_IDS", "smoke_q1");
  p.setProperty("BTS_FOLLOWUP_OPTIONAL_QUESTION_IDS", "");
  const withFollowup = make("bts-http-followup-parent-001", true);
  assertTrue(post(withFollowup).ok, "authorized synthetic followup can be scheduled without email");
  const token = completionFollowupLink_(spreadsheet, withFollowup.submission_id).url.split("#token=")[1];
  const followupRequest = { action: "followup", schema_version: 2, token };
  const opened = get(followupRequest);
  assertTrue(opened.ok && opened.status === "ready", "authorized HTTP followup GET resolves allowed parent");
  rejectWithoutWrites(() => get(Object.assign({}, followupRequest, { experiment_id: "bts-http-other" })), "http_test_scope_rejected", "followup GET rejects a supplied conflicting experiment");
  rejectWithoutWrites(() => get(Object.assign({}, followupRequest, { participant_id_normalized: "QAAX02" })), "http_test_scope_rejected", "followup GET rejects a supplied conflicting allowed participant");
  const response = Object.fromEntries(["followup_id", "experiment_id", "allocation_version", "assignment_id", "session_id", "participant_id", "participant_id_normalized", "store_id", "condition", "parent_submission_id", "instrument_version", "instrument_hash"].map(key => [key, opened[key]]));
  const now = new Date(Date.now() - 1000).toISOString();
  Object.assign(response, { event_type: "followup", schema_version: 2, submission_id: "bts-http-followup-response-001", token, language: "ja", started_at: now, completed_at: now, answers: { smoke_q1: "A" }, question_logs: [{
    event_id: "bts-http-followup-event-001", phase: "followup", question_id: "smoke_q1", question_order: 1, assignment_id: opened.assignment_id,
    session_id: opened.session_id, participant_id_normalized: opened.participant_id_normalized, store_id: opened.store_id, condition: opened.condition,
    selected_answer: "A", correct_answer: "A", is_correct: true, question_started_at: now, answered_at: now, response_time_ms: 0, screen_dwell_time_ms: 0, answer_change_count: 0
  }] });
  corrupt("FollowUp", "followup_id", opened.followup_id, "experiment_id", "bts-http-other", () => get(followupRequest), "http_test_scope_rejected");
  corrupt("logs", "submission_id", withFollowup.submission_id, "email", "person@example.invalid", () => get(followupRequest), "http_test_parent_rejected");
  corrupt("logs", "submission_id", withFollowup.submission_id, "email", "person@example.invalid", () => post(response), "http_test_parent_rejected");
  corrupt("Participants", "submission_id", withFollowup.submission_id, "experiment_id", "bts-http-other", () => post(response), "http_test_scope_rejected");
  assertTrue(post(response).ok, "HTTP followup POST succeeds only for the allowed parent chain");
  const followupSnapshot = spreadsheetSnapshot(spreadsheet);
  assertTrue(post(response).duplicate, "HTTP followup retry is idempotent");
  assertEqual(spreadsheetSnapshot(spreadsheet), followupSnapshot, "HTTP followup retry changes no cells");
  const followupReceipt = Object.assign({}, receiptRequest, { submission_id: response.submission_id, token });
  assertEqual(get(followupReceipt).status, "complete", "authorized HTTP followup receipt succeeds");
  corrupt("Participants", "submission_id", withFollowup.submission_id, "experiment_id", "bts-http-other", () => get(followupReceipt), "http_test_scope_rejected");
  for (const name of ["Contact", "followup_queue"]) {
    const sheet = spreadsheet.getSheetByName(name);
    appendMappedRow_(sheet, sheetDefinition_(name), { submission_id: withFollowup.submission_id });
    rejectWithoutWrites(() => get(followupRequest), "http_test_parent_rejected", "followup GET rejects linked " + name);
    rejectWithoutWrites(() => post(response), "http_test_parent_rejected", "followup POST rejects linked " + name);
    rejectWithoutWrites(() => get(followupReceipt), "http_test_parent_rejected", "followup receipt rejects linked " + name);
    sheet.rows.pop(); // Local fixture restoration only, not a Google operation.
  }
  for (const route of [() => get(request), () => get(receiptRequest), () => get(followupRequest), () => get(followupReceipt), () => post(payload), () => post(response)]) {
    p.setProperty("BTS_HTTP_MODE", "disabled");
    rejectWithoutWrites(route, "http_test_disabled", "mode disable closes each HTTP route");
    p.setProperty("BTS_HTTP_MODE", "test");
    p.setProperty("BTS_EMAIL_ENABLED", "true");
    rejectWithoutWrites(route, "http_test_disabled", "email enable closes each HTTP route");
    p.setProperty("BTS_EMAIL_ENABLED", "false");
  }
  assertEqual(spreadsheet.getSheetByName("Contact").getLastRow(), 1, "HTTP tests collect no contacts");
  assertEqual(spreadsheet.getSheetByName("followup_queue").getLastRow(), 1, "HTTP tests create no mail queue");
  assertEqual(MailApp.sent.length, 0, "HTTP tests send no email");
  assertTrue(!spreadsheetSnapshot(spreadsheet).includes(credential) && !capturedLogs.join("").includes(credential), "test access credential is never persisted or logged");
}

function runFollowupTests(spreadsheet, assignment) {
  const properties = PropertiesService.getScriptProperties();
  const beforeSettings = spreadsheetSnapshot(spreadsheet);
  const completion = makeV2Payload(assignment, "completion_followup_mock_001");
  completion.language = "ja";
  completion.email = "followup@example.invalid";
  completion.session_id = "session_followup_mock_001";
  completion.start_time = new Date(Date.now() - 8 * 86400000 - 600000).toISOString();
  completion.end_time = new Date(Date.now() - 8 * 86400000).toISOString();
  completion.question_logs = [];
  completion.followup = { requested: true, instrument_version: "2026-late-instrument-v1" };
  assertEqual(postJson(completion).error, "followup_not_configured", "requested followup requires deployment settings");
  assertEqual(spreadsheetSnapshot(spreadsheet), beforeSettings, "missing followup settings writes nothing");
  properties.setProperty("BTS_PUBLIC_APP_URL", "https://example.invalid/late/");
  properties.setProperty("BTS_FOLLOWUP_INSTRUMENT_VERSION", "2026-late-instrument-v1");
  properties.setProperty("BTS_FOLLOWUP_INSTRUMENT_HASH", "a".repeat(64));
  assertEqual(postJson(completion).error, "followup_not_configured", "followup requires explicit expected question IDs");
  properties.setProperty("BTS_FOLLOWUP_QUESTION_IDS", "followup_q1,followup_optional");
  properties.setProperty("BTS_FOLLOWUP_OPTIONAL_QUESTION_IDS", "followup_optional");
  properties.setProperty("BTS_FOLLOWUP_INSTRUMENT_HASH", "");
  assertEqual(postJson(completion).error, "followup_not_configured", "followup requires an instrument hash before storing parent records");
  assertEqual(spreadsheetSnapshot(spreadsheet), beforeSettings, "missing instrument hash writes nothing");
  properties.setProperty("BTS_FOLLOWUP_INSTRUMENT_HASH", "a".repeat(64));
  const staleCompletion = JSON.parse(JSON.stringify(completion));
  staleCompletion.followup.instrument_version = "old-version";
  assertEqual(postJson(staleCompletion).error, "followup_instrument_mismatch", "completion rejects stale followup instrument before writes");
  assertEqual(spreadsheetSnapshot(spreadsheet), beforeSettings, "instrument mismatch writes nothing");

  const declined = makeV2Payload(assignment, "completion_followup_declined_001");
  declined.question_logs = [];
  declined.email = "declined@example.invalid";
  const declinedBefore = ["FollowUp", "Contact", "followup_queue"].map(name => spreadsheet.getSheetByName(name).getLastRow());
  assertTrue(postJson(declined).ok, "declined followup accepts normal completion");
  assertDeepEqual(["FollowUp", "Contact", "followup_queue"].map(name => spreadsheet.getSheetByName(name).getLastRow()), declinedBefore,
    "declined followup creates no token, contact, or queue row");

  assertTrue(postJson(completion).ok, "requested followup completion succeeds");
  const followupDefinition = sheetDefinition_("FollowUp");
  const followupSheet = spreadsheet.getSheetByName("FollowUp");
  const record = findRowByValue_(followupSheet, followupDefinition, "submission_id", completion.submission_id);
  assertTrue(Boolean(record), "completion creates followup parent record");
  assertEqual(record.object.content_version, completion.content_version, "followup snapshots parent learning content version");
  assertEqual(record.object.common_correction_version, completion.common_correction_version, "followup snapshots parent common correction version");
  assertEqual(Date.parse(record.object.send_at) - Date.parse(completion.end_time), 7 * 86400000, "followup due is exactly seven days after completion");
  const link = completionFollowupLink_(spreadsheet, completion.submission_id);
  const token = new URL(link.url).hash.slice("#token=".length);
  assertTrue(/^[a-f0-9]{64}$/.test(token), "followup URL contains a capability token");
  assertTrue(!link.url.includes("TEST01") && !link.url.includes("store="), "URL contains no participant/store labels");
  assertEqual(record.object.token_hash, sha256Hex_(token), "only token hash binds stored followup");
  assertTrue(!spreadsheetSnapshot(spreadsheet).includes(token), "raw token is never stored in any spreadsheet cell");
  const completionReceipt = requestJsonp(Object.assign({ action: "receipt", submission_id: completion.submission_id }, receiptIdentity(assignment)));
  assertEqual(completionReceipt.followup.url, link.url, "confirmed completion receipt returns stable followup link");
  const afterCompletion = spreadsheetSnapshot(spreadsheet);
  assertTrue(postJson(completion).duplicate, "duplicate completion reuses original followup");
  assertEqual(spreadsheetSnapshot(spreadsheet), afterCompletion, "duplicate completion does not create a second token or queue row");

  const invalidGet = requestJsonp({ action: "followup", schema_version: 2, token: "0".repeat(64) });
  assertEqual(invalidGet.error, "invalid_followup_token", "unknown followup token rejected");
  assertEqual(spreadsheetSnapshot(spreadsheet), afterCompletion, "unknown token creates no participant or rows");
  assertEqual(requestJsonp({ action: "followup", schema_version: 1, token }).error, "invalid_schema_version", "followup GET requires schema2");
  const beforeDue = getFollowup_({ schema_version: 2, token }, new Date(Date.parse(record.object.send_at) - 1));
  assertEqual(beforeDue.status, "not_due", "followup cannot open before seven-day due");
  const opened = requestJsonp({ action: "followup", schema_version: 2, token });
  assertEqual(opened.status, "ready", "due followup opens");
  ["participant_id", "participant_id_normalized", "store_id", "condition", "assignment_id", "session_id"].forEach(key => {
    const expected = key === "assignment_id" ? assignment.assignment_id : completion[key];
    assertEqual(opened[key], expected, "followup fixes parent " + key);
  });
  assertEqual(getFollowup_({ schema_version: 2, token }, new Date(Date.parse(record.object.token_expires_at) + 1)).status, "expired", "expired token cannot open");

  const startedAt = new Date(Date.now() - 60000).toISOString();
  const completedAt = new Date(Date.now() - 1000).toISOString();
  const response = Object.fromEntries(["followup_id", "experiment_id", "allocation_version", "assignment_id", "session_id", "participant_id", "participant_id_normalized", "store_id", "condition", "parent_submission_id", "instrument_version", "instrument_hash"].map(key => [key, opened[key]]));
  Object.assign(response, { event_type: "followup", schema_version: 2, token, submission_id: "followup_response_mock_001", language: "ja",
    started_at: startedAt, completed_at: completedAt, answers: { followup_q1: "A", followup_optional: "" } });
  response.question_logs = [{ event_id: "followup_event_mock_001", phase: "followup", question_id: "followup_q1", question_order: 1,
    assignment_id: opened.assignment_id, session_id: opened.session_id, participant_id_normalized: opened.participant_id_normalized,
    store_id: opened.store_id, condition: opened.condition, selected_answer: "A", correct_answer: "A", is_correct: true,
    question_started_at: startedAt, answered_at: completedAt, response_time_ms: 59000, screen_dwell_time_ms: 60000, answer_change_count: 0 }];
  response.question_logs.push(Object.assign({}, response.question_logs[0], {
    event_id: "followup_event_optional_001", question_id: "followup_optional", question_order: 2,
    selected_answer: "", correct_answer: null, is_correct: null
  }));
  const identityMutations = { parent_submission_id: "wrong_parent_001", participant_id_normalized: "TEST02", session_id: "wrong_session_001",
    condition: BTS_CONDITIONS_.find(value => value !== opened.condition), store_id: "B", assignment_id: "wrong_assignment_001" };
  Object.entries(identityMutations).forEach(([key, value]) => {
    const changed = JSON.parse(JSON.stringify(response)); changed[key] = value;
    const before = spreadsheetSnapshot(spreadsheet);
    assertEqual(postJson(changed).error, "followup_identity_mismatch", "followup rejects changed parent " + key);
    assertEqual(spreadsheetSnapshot(spreadsheet), before, "parent mismatch writes nothing: " + key);
  });
  const wrongToken = Object.assign({}, response, { token: "0".repeat(64) });
  assertEqual(postJson(wrongToken).error, "invalid_followup_token", "followup POST requires genuine token");
  assertEqual(postJson(Object.assign({}, response, { instrument_hash: "b".repeat(64) })).error, "followup_instrument_mismatch", "followup rejects changed instrument hash");
  const wrongLog = JSON.parse(JSON.stringify(response)); wrongLog.question_logs[0].condition = identityMutations.condition;
  assertEqual(postJson(wrongLog).error, "followup_identity_mismatch", "question log cannot change condition");
  const wrongAnswer = JSON.parse(JSON.stringify(response)); wrongAnswer.answers.followup_q1 = "B";
  assertEqual(postJson(wrongAnswer).error, "invalid_followup_question_log", "answers and question logs must agree");
  const blankAnswer = JSON.parse(JSON.stringify(response)); blankAnswer.answers.followup_q1 = ""; blankAnswer.question_logs[0].selected_answer = "";
  assertEqual(postJson(blankAnswer).error, "invalid_followup_payload", "required followup answer cannot be blank");
  const missingQuestion = JSON.parse(JSON.stringify(response)); missingQuestion.question_logs.pop(); delete missingQuestion.answers.followup_optional;
  assertEqual(postJson(missingQuestion).error, "invalid_followup_question_log", "even an optional item must have its expected log entry");
  const reordered = JSON.parse(JSON.stringify(response)); reordered.question_logs.reverse();
  assertEqual(postJson(reordered).error, "invalid_followup_question_log", "followup item order is fixed");
  const collision = JSON.parse(JSON.stringify(response)); collision.question_logs[0].event_id = "event_mock_0001";
  assertEqual(postJson(collision).error, "followup_event_conflict", "followup cannot steal completion event ID");
  const futureStarted = Object.assign({}, response, { started_at: new Date(Date.now() + 600000).toISOString() });
  assertEqual(postJson(futureStarted).error, "invalid_followup_time", "invalid followup response timestamps rejected");
  const beforeEarly = spreadsheetSnapshot(spreadsheet);
  let earlyError = "";
  try { persistFollowupResponse_(response, new Date(Date.parse(record.object.send_at) - 1)); } catch (error) { earlyError = error.message; }
  assertTrue(["invalid_followup_time", "followup_not_due"].includes(earlyError), "early POST is rejected");
  assertEqual(spreadsheetSnapshot(spreadsheet), beforeEarly, "early POST writes nothing");

  spreadsheet.getSheetByName("QuestionLogs").failNextAppendError = new Error("forced_followup_failure");
  assertEqual(postJson(response).error, "forced_followup_failure", "mocked partial failure reported");
  const followupReceiptRequest = Object.assign({ action: "receipt", submission_id: response.submission_id, token }, receiptIdentity(assignment));
  assertEqual(requestJsonp(followupReceiptRequest).status, "error", "failed followup has error receipt");
  const beforeCompleteCounts = sheetRowCounts(spreadsheet);
  properties.setProperty("BTS_FOLLOWUP_QUESTION_IDS", "a_future_question");
  properties.setProperty("BTS_FOLLOWUP_OPTIONAL_QUESTION_IDS", "");
  assertTrue(postJson(response).ok, "same followup submission recovers after failure");
  assertEqual(record.object.question_ids_json, '["followup_q1","followup_optional"]', "question contract is snapshotted when token is created");
  const saved = findRowByValue_(followupSheet, followupDefinition, "followup_id", opened.followup_id).object;
  assertEqual(saved.response_submission_id, response.submission_id, "followup response joins original parent row");
  assertEqual(saved.status, "completed", "followup status complete");
  assertEqual(saved.response_timing, "in_window", "followup timing records in-window response");
  assertEqual(saved.answers_json, JSON.stringify(response.answers), "followup answers preserved");
  assertEqual(spreadsheet.getSheetByName("Participants").getLastRow(), beforeCompleteCounts.Participants, "followup creates no second participant");
  const savedLog = findRowByValue_(spreadsheet.getSheetByName("QuestionLogs"), sheetDefinition_("QuestionLogs"), "event_id", "followup_event_mock_001").object;
  assertEqual(savedLog.phase, "followup", "question log has followup phase");
  assertEqual(savedLog.session_id, completion.session_id, "question log preserves original session");
  assertEqual(savedLog.assignment_id, assignment.assignment_id, "question log preserves original assignment");
  assertEqual(savedLog.content_version, completion.content_version, "followup log uses stored parent content version");
  assertEqual(savedLog.common_correction_version, completion.common_correction_version, "followup log uses stored parent correction version");
  assertEqual(savedLog.instrument_version, record.object.instrument_version, "followup log uses stored followup instrument, not parent test instrument");
  const receipt = requestJsonp(followupReceiptRequest);
  assertEqual(receipt.status, "complete", "followup receipt confirms persistence");
  assertEqual(receipt.event_type, "followup", "receipt identifies followup event");
  assertEqual(receipt.followup_id, opened.followup_id, "receipt binds correct parent followup");
  assertEqual(requestJsonp(Object.assign({}, followupReceiptRequest, { token: "0".repeat(64) })).error, "invalid_followup_token", "followup receipt requires token");
  const beforeDuplicate = spreadsheetSnapshot(spreadsheet);
  assertTrue(postJson(response).duplicate, "duplicate followup POST accepted idempotently");
  assertEqual(spreadsheetSnapshot(spreadsheet), beforeDuplicate, "duplicate followup changes no cells");
  const changedDuplicate = JSON.parse(JSON.stringify(response)); changedDuplicate.answers.followup_q1 = "B"; changedDuplicate.question_logs[0].selected_answer = "B";
  assertEqual(postJson(changedDuplicate).error, "submission_id_conflict", "same submission cannot overwrite answers");
  assertEqual(postJson(Object.assign({}, response, { submission_id: "followup_response_second_001" })).error, "followup_already_completed", "new submission cannot answer same token twice");
  assertEqual(requestJsonp({ action: "followup", schema_version: 2, token }).status, "completed", "reopening a used link reports completed");

  const disabledSender = sendDueFollowups();
  assertTrue(disabledSender.disabled, "email delivery is OFF by default");
  assertEqual(MailApp.sent.length, 0, "default sender invokes no email call");
  const emailCompletion = JSON.parse(JSON.stringify(completion));
  emailCompletion.submission_id = "completion_followup_email_001";
  emailCompletion.email = "delivery-test@example.invalid";
  assertTrue(postJson(emailCompletion).ok, "separate parent can schedule mock email delivery");
  const emailLink = completionFollowupLink_(spreadsheet, emailCompletion.submission_id);
  properties.setProperty("BTS_EMAIL_ENABLED", "true");
  const enabledSender = sendDueFollowups();
  assertTrue(enabledSender.sent > 0, "explicitly enabled mock sender processes due queue entries");
  const delivered = MailApp.sent.filter(entry => entry.email === emailCompletion.email);
  assertEqual(delivered.length, 1, "due participant receives exactly one mock email");
  assertTrue(delivered[0].body.includes(emailLink.url), "mock email includes the stored parent's personal followup link");
  assertTrue(!delivered[0].body.includes(emailCompletion.participant_id), "email body does not expose participant ID");
  const sentCount = MailApp.sent.length;
  sendDueFollowups();
  assertEqual(MailApp.sent.length, sentCount, "sent or completed queue entries are not mailed again");
  properties.setProperty("BTS_EMAIL_ENABLED", "false");
  properties.setProperty("BTS_CONTACT_RETENTION_DAYS", "1");
  const retentionBefore = spreadsheetSnapshot(spreadsheet);
  const retention = reportContactRetention();
  assertTrue(retention.dry_run && retention.deleted === 0, "retention report is dry-run only");
  assertEqual(spreadsheetSnapshot(spreadsheet), retentionBefore, "retention report never deletes or changes cells");
  assertTrue(!JSON.stringify(retention).includes("@"), "retention report reveals no email addresses");
}

try {
  run();
} catch (error) {
  console.error("FAIL after " + assertionCount + " assertions");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
