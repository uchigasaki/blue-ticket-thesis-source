/** Closed-resource preparation only. The installation builder supplies the
 * non-secret BTS_PRODUCTION_BUILD_ snapshot. No study approval is supplied.
 */
function prepareBtsProductionWorkspace() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BTS_LOCK_TIMEOUT_MS_)) throw new Error("production_setup_busy");
  try {
    var p = PropertiesService.getScriptProperties();
    if ([null, "disabled"].indexOf(p.getProperty("BTS_HTTP_MODE")) < 0 ||
        [null, "false"].indexOf(p.getProperty("BTS_PRODUCTION_ENABLED")) < 0 ||
        [null, "false"].indexOf(p.getProperty("BTS_EMAIL_ENABLED")) < 0 ||
        p.getProperty("BTS_PRODUCTION_EMAIL_APPROVED") === "true") throw new Error("production_disable_before_setup");
    if (typeof BTS_PRODUCTION_BUILD_ === "undefined" || !isPlainObject_(BTS_PRODUCTION_BUILD_)) throw new Error("production_build_missing");
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet || spreadsheet.getName().indexOf("BTS 後期3群比較 本番 ") !== 0 ||
        spreadsheet.getId() === p.getProperty("BTS_HTTP_TEST_SPREADSHEET_ID") ||
        p.getProperty("BTS_SPREADSHEET_ID") && p.getProperty("BTS_SPREADSHEET_ID") !== spreadsheet.getId()) throw new Error("production_wrong_spreadsheet");
    // Preparation cannot silently migrate or overwrite a used study database.
    spreadsheet.getSheets().forEach(function(sheet) {
      if (sheet.getLastRow() > 1 || sheet.getLastRow() === 1 && !BTS_SHEETS_.some(function(definition) {
        return definition.name === sheet.getName() && sheet.getLastColumn() === definition.headers.length &&
          JSON.stringify(sheet.getRange(1, 1, 1, definition.headers.length).getValues()[0]) === JSON.stringify(definition.headers);
      })) throw new Error("production_setup_nonempty");
    });
    var proposed = JSON.parse(JSON.stringify(BTS_PRODUCTION_BUILD_));
    var config = JSON.parse(proposed.BTS_PRODUCTION_CONFIG);
    var review = JSON.parse(proposed.BTS_PRODUCTION_REVIEW);
    if (proposed.BTS_HTTP_MODE !== "disabled" || proposed.BTS_PRODUCTION_ENABLED !== "false" || proposed.BTS_EMAIL_ENABLED !== "false" ||
        !isPlainObject_(review) || review.reviewer !== "" || review.reviewedAt !== "" || review.contentSha256 !== config.contentHash ||
        !isPlainObject_(review.approvals) || Object.keys(review.approvals).sort().join(",") !== "conditionNeutralPostSurvey,followupInstrumentAndUrl,improvedContent,lateEvaluationInstruments,noImageScenes" ||
        Object.keys(review.approvals).some(function(key) { return review.approvals[key] !== false; }) ||
        config.spreadsheetId !== "" || config.opensAt !== "" || config.enrollmentClosesAt !== "" || config.closesAt !== "" || config.maxAssignments !== null || config.maxDailyAssignments !== null ||
        Object.keys(proposed).some(function(key) { return ["BTS_PUBLIC_APP_URL", "BTS_FOLLOWUP_INSTRUMENT_VERSION", "BTS_FOLLOWUP_INSTRUMENT_HASH",
          "BTS_FOLLOWUP_QUESTION_IDS", "BTS_FOLLOWUP_OPTIONAL_QUESTION_IDS", "BTS_HTTP_MODE", "BTS_PRODUCTION_ENABLED", "BTS_EMAIL_ENABLED", "BTS_PRODUCTION_CONFIG", "BTS_PRODUCTION_REVIEW"].indexOf(key) < 0; })) throw new Error("production_build_invalid");
    config.spreadsheetId = spreadsheet.getId();
    proposed.BTS_PRODUCTION_CONFIG = JSON.stringify(config);
    proposed.BTS_SPREADSHEET_ID = spreadsheet.getId();
    proposed.BTS_PRODUCTION_EMAIL_APPROVED = "false";
    Object.keys(proposed).forEach(function(key) {
      var prior = p.getProperty(key);
      if (prior !== null && prior !== proposed[key]) throw new Error("production_setup_config_conflict");
    });
    // Every flag remains OFF; existing properties (including secrets) are never
    // rewritten. Failed validation removes only properties first added here.
    var addedProperties = [];
    try {
      Object.keys(proposed).forEach(function(key) {
        if (p.getProperty(key) === null) {
          addedProperties.push(key);
          p.setProperty(key, proposed[key]);
        }
      });
      if (p.getProperty("BTS_PRODUCTION_PARTICIPANT_SECRET") === null) {
        addedProperties.push("BTS_PRODUCTION_PARTICIPANT_SECRET");
        initializeBtsProductionParticipantSecret();
      }
      btsProductionPreparationSettings_();
    } catch (error) {
      var rollbackFailed = false;
      addedProperties.forEach(function(key) {
        try { p.deleteProperty(key); } catch (_) { rollbackFailed = true; }
      });
      if (rollbackFailed) throw new Error("production_setup_rollback_failed");
      throw error;
    }
    // From this point, preserve all properties and any created sheets if a
    // sheet operation fails. No existing data is ever rolled back or deleted.
    BTS_SHEETS_.forEach(function(definition) { ensureSheet_(spreadsheet, definition); });
    SpreadsheetApp.flush();
    var result = { status: "prepared_closed", spreadsheetId: spreadsheet.getId(),
      appVersion: config.appVersion, httpEnabled: false, emailEnabled: false, triggersCreated: 0, reviewsApproved: false };
    Logger.log(JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}
