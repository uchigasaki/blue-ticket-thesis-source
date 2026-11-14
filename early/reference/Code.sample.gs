function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logs = ss.getSheetByName('logs');
  const queue = ss.getSheetByName('followup_queue');
  const body = JSON.parse(e.postData.contents);

  logs.appendRow([
    new Date(),
    body.session_id,
    body.participant_id,
    body.email || '',
    body.language,
    JSON.stringify(body.summary),
    JSON.stringify(body.pre_survey),
    JSON.stringify(body.post_survey),
    JSON.stringify(body.answers)
  ]);

  if (body.email && body.followup && body.followup.email_preview) {
    queue.appendRow([
      new Date(),
      body.followup.send_at,
      '',
      body.session_id,
      body.participant_id,
      body.email,
      body.language,
      body.followup.delivery_mode,
      JSON.stringify(body.followup.email_preview.forms),
      body.followup.email_preview.subject,
      body.followup.email_preview.body
    ]);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function sendDueFollowups() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('followup_queue');
  const values = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const sendAt = new Date(row[1]);
    const sentAt = row[2];
    const email = row[5];
    const subject = row[9];
    const body = row[10];

    if (!sentAt && email && sendAt <= now) {
      MailApp.sendEmail(email, subject, body);
      sheet.getRange(i + 1, 3).setValue(new Date());
    }
  }
}