/**
 * Invoca demo platform — event follow-up sheet (fallback path)
 * =============================================================================
 * Only needed if your org will not enable the Google Sheets API. The simpler way
 * is in the app: Connect Google once, then paste the sheet's link.
 *
 * To use this instead:
 *   Extensions > Apps Script  ->  paste this  ->  Deploy > New deployment
 *   Type: Web app   Execute as: Me   Who has access: Anyone
 * then paste the /exec URL into the event's dialog, under
 * "Can't connect Google? Use a script instead".
 *
 * "Anyone" is what lets the platform POST without a Google credential. The URL is
 * the only secret: it is stored server-side, shown only to admins, and
 * re-deploying rotates it.
 *
 * WHAT IT DOES
 * -----------
 * One tab, "Demo Notes", one row per prospect, keyed on the Prospect column.
 * Re-submitting notes for the same prospect updates that row. Clearing a mark in
 * the platform empties the status and notes but keeps the row, so the record that
 * they were demoed survives.
 *
 * ⚠️ IT DOES NO FIELD MAPPING AND NO DATE MATHS. The platform sends `cells` — a
 * heading-to-value map already in the sheet's own column names and already in
 * Chicago time — so this file and the app cannot disagree about what a row holds.
 * Adding a column is a change in the app, not here.
 */

/** ⚠️ ONE TAB FOR EVERYTHING. It used to be one per event. */
var TAB_NAME = 'Demo Notes';

/** ⚠️ The upsert key. Must match the app's KEY_COLUMN. */
var KEY_COLUMN = 'Prospect';

function doPost(e) {
  var lock = LockService.getScriptLock();
  /* ⚠️ A CONFERENCE MEANS SEVERAL PEOPLE SUBMITTING AT ONCE. Without the lock two
     appends can resolve to the same row number and one silently overwrites the
     other. 30s is generous; the work inside is milliseconds. */
  lock.waitLock(30000);
  try {
    var body = JSON.parse(e.postData.contents);
    var cells = body.cells || {};
    var sheet = sheetFor_();
    var head = ensureHeader_(sheet, Object.keys(cells));

    var key = cells[KEY_COLUMN];
    var row = findRow_(sheet, head, key);
    if (row > 0) {
      /* Read the row first so a column this post says nothing about — including one
         somebody added by hand — keeps its value. */
      var line = sheet.getRange(row, 1, 1, head.length).getValues()[0];
      head.forEach(function (name, i) {
        if (cells[name] !== undefined) line[i] = cells[name];
      });
      sheet.getRange(row, 1, 1, head.length).setValues([line]);
    } else {
      sheet.appendRow(head.map(function (name) {
        return cells[name] !== undefined ? cells[name] : '';
      }));
      row = sheet.getLastRow();
    }
    return reply_({ ok: true, row: row, updated: row > 0 });
  } catch (err) {
    return reply_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * The one tab everything is written to.
 *
 * ⚠️ THE FIRST SHEET, RENAMED — but NOT if it already holds something. Renaming a
 * populated Sheet1 and writing a header into row 1 would overwrite real data in a
 * document somebody pasted rather than created, which is a one-way loss in their
 * file. An existing "Demo Notes" wins; otherwise the first sheet is used when it is
 * empty, and a new tab is added when it is not.
 */
function sheetFor_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var existing = ss.getSheetByName(TAB_NAME);
  if (existing) return existing;

  var first = ss.getSheets()[0];
  if (first && first.getLastRow() === 0 && first.getLastColumn() === 0) {
    first.setName(TAB_NAME);
    return first;
  }
  return ss.insertSheet(TAB_NAME);
}

/** ⚠️ READS THE EXISTING HEADER RATHER THAN IMPOSING ONE, so a column somebody added
 *  by hand survives every later write — and so does one the app has since stopped
 *  sending, which simply goes unwritten rather than being deleted. */
function ensureHeader_(sheet, wanted) {
  var width = sheet.getLastColumn();
  var head = width ? sheet.getRange(1, 1, 1, width).getValues()[0].map(String) : [];
  var missing = wanted.filter(function (c) { return head.indexOf(c) === -1; });
  if (missing.length) {
    sheet.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    head = head.concat(missing);
    sheet.getRange(1, 1, 1, head.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return head;
}

/** The row holding this prospect, or 0. */
function findRow_(sheet, head, key) {
  if (!key) return 0;
  var col = head.indexOf(KEY_COLUMN) + 1;
  var last = sheet.getLastRow();
  if (col < 1 || last < 2) return 0;
  var vals = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(key)) return i + 2;
  }
  return 0;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
