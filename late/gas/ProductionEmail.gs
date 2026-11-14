/** Production-only, one-recipient MailApp sender. Loading this file sends nothing.
 * Requires Code.gs, Production.gs and FormsProduction.gs in the SAME project.
 * Never changes sheet headers, creates a Form, issues a credential, or retries
 * an ambiguous send. See PRODUCTION_EMAIL.md before owner activation.
 */
var BTS_PRODUCTION_EMAIL_LEDGER_ = "BTS_PRODUCTION_EMAIL_DAILY_V1";
var BTS_PRODUCTION_EMAIL_TRIGGER_ = "BTS_PRODUCTION_EMAIL_TRIGGER_V1";

function btsEmailFail_(reason) { throw new Error("production_email_" + reason); }
function btsEmailApproved_() {
  var p = PropertiesService.getScriptProperties();
  return p.getProperty("BTS_EMAIL_ENABLED") === "true" && p.getProperty("BTS_PRODUCTION_EMAIL_APPROVED") === "true";
}
function btsEmailInteger_(key, fallback, maximum) {
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (raw === null) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw) || String(Number(raw)) !== raw || Number(raw) > maximum) btsEmailFail_("limits");
  return Number(raw);
}
function btsEmailDate_(value) {
  // Sheets can return a Date, or our writer's UTC ISO string. No loose parser
  // coercion of blanks, booleans, numeric days, locale dates, or rolled dates.
  if (value instanceof Date && isFinite(value.getTime())) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) btsEmailFail_("time");
  var parsed = new Date(value);
  if (!isFinite(parsed.getTime()) || parsed.toISOString() !== value.replace(/Z$/, value.indexOf(".") < 0 ? ".000Z" : "Z")) btsEmailFail_("time");
  return parsed;
}
function btsEmailLedger_(now) {
  var today = now.toISOString().slice(0, 10);
  var raw = PropertiesService.getScriptProperties().getProperty(BTS_PRODUCTION_EMAIL_LEDGER_);
  if (raw === null) return { day: today, attempts: 0 };
  var ledger;
  try { ledger = JSON.parse(raw); } catch (_) { btsEmailFail_("ledger"); }
  if (!ledger || Object.keys(ledger).sort().join(",") !== "attempts,day" ||
      typeof ledger.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ledger.day) ||
      !Number.isInteger(ledger.attempts) || ledger.attempts < 0 || ledger.attempts > 100 || ledger.day > today) btsEmailFail_("ledger");
  if (btsEmailDate_(ledger.day + "T00:00:00.000Z").toISOString().slice(0, 10) !== ledger.day) btsEmailFail_("ledger");
  return ledger.day === today ? ledger : { day: today, attempts: 0 };
}
function btsEmailTables_(spreadsheet) {
  var tables = {};
  ["followup_queue", "Contact", "FollowUp", "Participants", "SubmissionReceipts", "Assignments"].forEach(function(name) {
    var definition = sheetDefinition_(name), sheet = spreadsheet.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 1 || sheet.getLastRow() > 20001 || sheet.getLastColumn() !== definition.headers.length ||
        JSON.stringify(sheet.getRange(1, 1, 1, definition.headers.length).getValues()[0]) !== JSON.stringify(definition.headers)) btsEmailFail_("storage");
    tables[name] = { sheet: sheet, definition: definition, records: readSheetObjects_(sheet, definition).map(function(row, index) {
      return { object: row, rowIndex: index + 2 };
    }) };
  });
  return tables;
}
function btsEmailOne_(table, key, value) {
  if (typeof value !== "string" || !isValidOpaqueId_(value, 180)) btsEmailFail_("identity");
  var matches = table.records.filter(function(row) { return row.object[key] === value; });
  if (matches.length !== 1) btsEmailFail_("identity");
  return matches[0];
}
function btsEmailSame_(row, expected, fields) {
  fields.forEach(function(key) { if (row[key] !== expected[key]) btsEmailFail_("parent"); });
}
function btsEmailAddress_(value) {
  var email = unsheetText_(value);
  // MailApp accepts a comma-separated recipient list. Explicitly reject it,
  // display-name syntax, quoted local parts, controls and header injection.
  if (email.length > 254 || /[\x00-\x20\x7f]/.test(email) || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email)) btsEmailFail_("recipient");
  validateEmail_(email);
  return email;
}
function btsEmailCandidate_(tables, queued, config, now, spreadsheet) {
  var q = queued.object;
  var queue = btsEmailOne_(tables.followup_queue, "followup_id", q.followup_id);
  var contact = btsEmailOne_(tables.Contact, "followup_id", q.followup_id);
  var followup = btsEmailOne_(tables.FollowUp, "followup_id", q.followup_id);
  var f = followup.object, c = contact.object;
  var participant = btsEmailOne_(tables.Participants, "submission_id", q.submission_id).object;
  var receipt = btsEmailOne_(tables.SubmissionReceipts, "submission_id", q.submission_id).object;
  var assignment = btsEmailOne_(tables.Assignments, "assignment_id", q.assignment_id).object;
  [tables.followup_queue, tables.Contact, tables.FollowUp, tables.Participants].forEach(function(table) {
    if (btsEmailOne_(table, "assignment_id", q.assignment_id).object.submission_id !== q.submission_id) btsEmailFail_("parent");
  });
  btsProductionFollowupParent_(spreadsheet, f, config);
  var identity = ["experiment_id", "assignment_id", "session_id", "participant_id_normalized", "store_id", "condition"];
  [c, f, participant, receipt, assignment].forEach(function(row) { btsEmailSame_(row, q, identity); });
  [c, f, participant, receipt].forEach(function(row) { btsEmailSame_(row, q, ["submission_id"]); });
  [f, participant, receipt, assignment].forEach(function(row) {
    if (row.allocation_version !== config.allocationVersion) btsEmailFail_("parent");
  });
  // A participant may answer through their existing landing link before the
  // hourly mail job. Completed/in-progress Forms work must not block others.
  if (f.response_completed_at || f.response_submission_id || f.response_received_at || f.response_payload_hash || f.status === "completed" || f.status === "processing_forms") return null;
  if (queue.rowIndex !== queued.rowIndex || q.status !== "queued" || q.sent_at || q.delivery_mode !== "google_forms" ||
      c.status !== "queued" || c.sent_at || f.status !== "scheduled" || f.requested !== true || f.delivery_mode !== "google_forms" ||
      f.response_completed_at || f.response_submission_id || f.response_received_at || f.response_payload_hash ||
      f.followup_id !== "followup_" + sha256Hex_(config.experimentId + "|" + q.submission_id).slice(0, 40) ||
      c.contact_id !== "contact_" + sha256Hex_(f.followup_id).slice(0, 40) ||
      assignment.status !== "confirmed" || (assignment.is_test !== false && assignment.is_test !== "false") ||
      assignment.assignment_method !== BTS_ASSIGNMENT_METHOD_ || participant.completion_status !== "completed" ||
      participant.allocation_status !== "confirmed" || participant.allocation_method !== BTS_ASSIGNMENT_METHOD_ ||
      Number(participant.schema_version) !== 2 || Number(receipt.schema_version) !== 2 ||
      participant.consent_given !== true || participant.consent_version !== config.experimentId + ":" + config.appVersion ||
      participant.app_version !== config.appVersion || participant.content_version !== config.contentVersion ||
      participant.common_correction_version !== config.commonCorrectionVersion || participant.instrument_version !== config.instrumentVersion ||
      participant.client_run_id !== assignment.client_run_id || !assignment.client_run_id ||
      receipt.status !== "complete" || receipt.event_type !== "completion" || !/^[a-f0-9]{64}$/.test(receipt.payload_hash || "") ||
      ["ja", "en"].indexOf(q.language) < 0 || q.language !== c.language || q.language !== participant.language) btsEmailFail_("parent");
  if (btsEmailAddress_(q.email) !== btsEmailAddress_(c.email)) btsEmailFail_("recipient");
  var end = btsEmailDate_(participant.end_time), due = btsEmailDate_(f.send_at), expires = btsEmailDate_(f.token_expires_at);
  var received = btsEmailDate_(participant.received_at), completed = btsEmailDate_(receipt.completed_at);
  var consent = btsEmailDate_(participant.consent_given_at);
  if (due.getTime() !== end.getTime() + 7 * 86400000 || btsEmailDate_(q.send_at).getTime() !== due.getTime() ||
      btsEmailDate_(c.send_at).getTime() !== due.getTime() || expires.getTime() !== due.getTime() + 30 * 86400000 ||
      btsEmailDate_(f.window_ends_at).getTime() !== due.getTime() + 7 * 86400000 || consent > end ||
      end > received || received > completed || completed > now) btsEmailFail_("time");
  if (now < due || now >= expires) return null;
  var link = completionFollowupLink_(spreadsheet, q.submission_id);
  var prefix = config.publicAppUrl + "followup.html#token=";
  if (!link || link.followup_id !== f.followup_id || typeof link.url !== "string" || link.url.slice(0, prefix.length) !== prefix ||
      !/^[a-f0-9]{64}$/.test(link.url.slice(prefix.length)) || sha256Hex_(link.url.slice(prefix.length)) !== f.token_hash ||
      btsEmailDate_(link.due_at).getTime() !== due.getTime() || btsEmailDate_(link.expires_at).getTime() !== expires.getTime()) btsEmailFail_("link");
  return { queue: queue, contact: contact, followup: followup, email: btsEmailAddress_(c.email), language: q.language, link: link.url };
}
function btsEmailState_(tables, candidate, status, now, reason) {
  // Queue first: even interruption between writes prevents automatic retries.
  updateMappedRow_(tables.followup_queue.sheet, tables.followup_queue.definition, candidate.queue.rowIndex,
    { status: status, sent_at: status === "sent" ? now : "", last_error: reason || "" });
  updateMappedRow_(tables.Contact.sheet, tables.Contact.definition, candidate.contact.rowIndex,
    { status: status, sent_at: status === "sent" ? now : "", last_error: reason || "" });
  updateMappedRow_(tables.FollowUp.sheet, tables.FollowUp.definition, candidate.followup.rowIndex, { status: status });
}

function btsSendDueProductionFollowups_(now) {
  var result = { checked: 0, sent: 0, send_unknown: 0, skipped: 0, disabled: false, limited: false };
  if (!btsEmailApproved_()) { result.disabled = true; return result; }
  now = btsEmailDate_(now || new Date());
  var runStarted = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BTS_LOCK_TIMEOUT_MS_)) btsEmailFail_("busy");
  try {
    if (!btsEmailApproved_()) { result.disabled = true; return result; }
    var config = btsProductionSettings_(now), spreadsheet = requireActiveSpreadsheet_();
    btsAssertProductionSpreadsheet_(spreadsheet, config);
    var batch = btsEmailInteger_("BTS_PRODUCTION_EMAIL_BATCH_LIMIT", 5, 10);
    var daily = btsEmailInteger_("BTS_PRODUCTION_EMAIL_DAILY_LIMIT", 20, 100);
    var ledger = btsEmailLedger_(now);
    var quota = MailApp.getRemainingDailyQuota();
    if (!Number.isInteger(quota) || quota < 0) btsEmailFail_("quota");
    var limit = Math.min(batch, daily - ledger.attempts, quota);
    if (limit <= 0) { result.limited = true; return result; }
    var tables = btsEmailTables_(spreadsheet), candidates = [];
    // Validate the selected batch fully before its first state change or email.
    for (var i = 0; i < tables.followup_queue.records.length; i++) {
      var queued = tables.followup_queue.records[i];
      result.checked++;
      if (queued.object.status !== "queued" || queued.object.sent_at) { result.skipped++; continue; }
      var candidate = btsEmailCandidate_(tables, queued, config, now, spreadsheet);
      if (!candidate) { result.skipped++; continue; }
      candidates.push(candidate);
      if (candidates.length >= limit) { result.limited = true; break; }
    }
    if (!candidates.length) return result;
    if (typeof btsFormsProductionReadiness_ !== "function") btsEmailFail_("forms_unavailable");
    var readiness = btsFormsProductionReadiness_(now);
    if (!readiness || readiness.ready !== true || readiness.measurement_mode !== "forms" ||
        JSON.stringify(readiness.languages) !== '["ja","en"]') btsEmailFail_("forms_unavailable");
    for (var index = 0; index < candidates.length; index++) {
      if (Date.now() - runStarted > 240000) { result.limited = true; break; }
      var attemptNow = new Date(now.getTime() + Math.max(0, Date.now() - runStarted));
      if (!btsEmailApproved_()) { result.disabled = true; break; }
      var currentConfig = btsProductionSettings_(attemptNow);
      if (JSON.stringify(canonicalFollowupValue_(currentConfig)) !== JSON.stringify(canonicalFollowupValue_(config))) btsEmailFail_("settings_changed");
      // Re-read parent/consent/status immediately before each send, under the
      // same ScriptLock used by completion and Forms ingestion.
      tables = btsEmailTables_(spreadsheet);
      var currentQueue = btsEmailOne_(tables.followup_queue, "followup_id", candidates[index].queue.object.followup_id);
      var current = btsEmailCandidate_(tables, currentQueue, config, attemptNow, spreadsheet);
      if (!current) { result.skipped++; continue; }
      ledger = btsEmailLedger_(attemptNow);
      quota = MailApp.getRemainingDailyQuota();
      if (!Number.isInteger(quota) || quota < 0) btsEmailFail_("quota");
      if (!quota || ledger.attempts >= daily) { result.limited = true; break; }
      btsEmailState_(tables, current, "sending", attemptNow, "");
      SpreadsheetApp.flush();
      // Count BEFORE attempting MailApp, including uncertain outcomes. No PII.
      ledger.attempts++;
      PropertiesService.getScriptProperties().setProperty(BTS_PRODUCTION_EMAIL_LEDGER_, JSON.stringify(ledger));
      var english = current.language === "en";
      var subject = english ? "Blue Ticket Simulator: one-week follow-up" : "Blue Ticket Simulator：1週間後アンケート";
      var body = (english
        ? "Thank you for participating. Participation in the one-week follow-up is voluntary. Use your personal link below to continue to Google Forms. Do not share this link. If you no longer wish to participate, you can ignore this email. This invitation will not be automatically repeated.\n\n"
        : "ご参加ありがとうございました。1週間後アンケートへの協力は任意です。以下の専用リンクからGoogleフォームへお進みください。このリンクは他の人に共有しないでください。協力を希望しない場合は回答する必要はありません。この案内を自動で再送することはありません。\n\n") + current.link;
      try {
        // Never use editable queue subject/body, CC/BCC, GmailApp or raw Form URLs.
        MailApp.sendEmail(current.email, subject, body);
        var sentAt = new Date(now.getTime() + Math.max(0, Date.now() - runStarted));
        btsEmailState_(tables, current, "sent", sentAt, "");
        SpreadsheetApp.flush();
        result.sent++;
      } catch (_) {
        // MailApp cannot prove non-delivery after an exception. Persistence
        // errors after successful send are equally ambiguous: DO NOT retry.
        try { btsEmailState_(tables, current, "send_unknown", attemptNow, "delivery_unconfirmed_do_not_retry"); SpreadsheetApp.flush(); }
        catch (_storageError) { /* Already flushed sending is a terminal retry guard. */ }
        result.send_unknown++;
        break;
      }
    }
    return result;
  } finally { lock.releaseLock(); }
}

/** Owner-run wrapper or its single time-driven trigger. No HTTP route. */
function sendBtsProductionFollowupEmails() { return btsSendDueProductionFollowups_(new Date()); }

/** Explicit owner action ONLY. Never sends, deletes or replaces a trigger. */
function installBtsProductionEmailTrigger() {
  if (!btsEmailApproved_()) btsEmailFail_("disabled");
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BTS_LOCK_TIMEOUT_MS_)) btsEmailFail_("busy");
  try {
    var now = new Date(), config = btsProductionSettings_(now), spreadsheet = requireActiveSpreadsheet_();
    btsAssertProductionSpreadsheet_(spreadsheet, config);
    if (typeof btsFormsProductionReadiness_ !== "function" || btsFormsProductionReadiness_(now).ready !== true) btsEmailFail_("forms_unavailable");
    btsEmailInteger_("BTS_PRODUCTION_EMAIL_BATCH_LIMIT", 5, 10);
    btsEmailInteger_("BTS_PRODUCTION_EMAIL_DAILY_LIMIT", 20, 100);
    var p = PropertiesService.getScriptProperties(), saved = p.getProperty(BTS_PRODUCTION_EMAIL_TRIGGER_);
    var triggers = ScriptApp.getProjectTriggers();
    if (triggers.some(function(t) { return t.getHandlerFunction() === "sendDueFollowups"; })) btsEmailFail_("legacy_trigger");
    var matches = triggers.filter(function(t) { return t.getHandlerFunction() === "sendBtsProductionFollowupEmails"; });
    if (matches.length > 1) btsEmailFail_("trigger");
    if (matches.length) {
      if (String(matches[0].getUniqueId()) !== saved || String(matches[0].getEventType()) !== String(ScriptApp.EventType.CLOCK) ||
          String(matches[0].getTriggerSource()) !== String(ScriptApp.TriggerSource.CLOCK)) btsEmailFail_("trigger");
      return { installed: true, reused: true, sendsByThisCall: 0 };
    }
    if (saved) btsEmailFail_("trigger");
    var trigger = ScriptApp.newTrigger("sendBtsProductionFollowupEmails").timeBased().everyHours(1).create();
    p.setProperty(BTS_PRODUCTION_EMAIL_TRIGGER_, String(trigger.getUniqueId()));
    return { installed: true, reused: false, sendsByThisCall: 0 };
  } finally { lock.releaseLock(); }
}
