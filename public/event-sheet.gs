/**
 * Invoca demo platform — event follow-up sheet
 * =============================================================================
 * Paste this into a Google Sheet's Apps Script editor, deploy it as a Web app,
 * and paste the resulting /exec URL into the event's "Connected sheet" box on the
 * demo platform's launch screen.
 *
 *   Extensions > Apps Script  ->  paste this  ->  Deploy > New deployment
 *   Type: Web app   Execute as: Me   Who has access: Anyone
 *
 * "Anyone" is what lets the platform's server POST to it without a Google
 * credential. The URL is the only secret, it is stored server-side, and it is
 * shown only to a project admin — but treat it like one: anyone holding it can
 * append to this sheet. Re-deploy to rotate it.
 *
 * WHAT IT DOES
 * -----------
 * One row per prospect, keyed on `demoId` (hidden in column A). A mark for a
 * prospect that is already in the sheet UPDATES its row; a new one is appended.
 * Clearing a mark on the platform empties the status and notes but keeps the row,
 * so the history of who was demoed does not disappear.
 */

/** ⚠️ COLUMN ORDER IS THE HEADER ROW. Add a column by adding it here; existing
 *  rows keep their values because every write is addressed by this list. */
var COLUMNS = [
  'Demo ID',        // the upsert key — safe to hide, do not delete or reorder away
  'Prospect',
  'Website',
  'Status',
  'Notes',
  'Who was in the room',
  'Demoed by',
  'Email',
  'Marked at',
  'Event',
  'Open demo',
  'Source'          // production / staging / local — a local row is a test
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  /* ⚠️ A CONFERENCE MEANS SEVERAL SEs SUBMITTING AT ONCE. Without the lock two
     appends can resolve to the same row number and one silently overwrites the
     other. 30s is generous; the work inside is milliseconds. */
  lock.waitLock(30000);
  try {
    var body = JSON.parse(e.postData.contents);
    var sheet = sheetFor_(body.event);
    var head = ensureHeader_(sheet);

    /* ⚠️⚠️ ONLY WHAT THE PAYLOAD ACTUALLY CARRIES. An earlier version wrote every known
       column on every post, so a message that omitted a field BLANKED it — and the
       "mark cleared" post, which sends little more than the id, wiped the prospect's own
       name out of its row and left a line nobody could identify. Build the patch from
       what is present; a removal then clears exactly the five fields it should. */
    var patch = {};
    if (body.demoId) patch['Demo ID'] = body.demoId;
    if (body.prospect) patch['Prospect'] = body.prospect;
    if (body.website) patch['Website'] = body.website;
    if (body.event) patch['Event'] = body.event;
    if (body.demoUrl) patch['Open demo'] = body.demoUrl;
    if (body.env) patch['Source'] = body.env;
    patch['Marked at'] = body.at || new Date().toISOString();

    if (body.action === 'removed') {
      /* The row stays — that this prospect was demoed is the one fact the sheet exists
         to hold, and it must survive somebody tidying up a status. */
      patch['Status'] = '';
      patch['Notes'] = '';
      patch['Who was in the room'] = '';
      patch['Demoed by'] = '';
      patch['Email'] = '';
    } else {
      patch['Status'] = body.status || '';
      patch['Notes'] = body.note || '';
      patch['Who was in the room'] = body.attendees || '';
      patch['Demoed by'] = body.markedBy || '';
      patch['Email'] = body.markedByEmail || '';
    }

    var row = findRow_(sheet, head, body.demoId);
    if (row > 0) {
      /* Read the existing line first so a column this post says nothing about — including
         one somebody added by hand — keeps its value. */
      var line = sheet.getRange(row, 1, 1, head.length).getValues()[0];
      head.forEach(function (name, i) {
        if (patch[name] !== undefined) line[i] = patch[name];
      });
      sheet.getRange(row, 1, 1, head.length).setValues([line]);
    } else {
      sheet.appendRow(head.map(function (name) {
        return patch[name] !== undefined ? patch[name] : '';
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

/** A tab per event, so one sheet can serve several. Created on first write. */
function sheetFor_(event) {
  var name = event || 'Demos';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** ⚠️ READS THE EXISTING HEADER RATHER THAN IMPOSING ONE, so a column somebody
 *  added by hand (an owner, a next step) survives every later write. Only the
 *  columns this script knows about are missing ones appended. */
function ensureHeader_(sheet) {
  var width = sheet.getLastColumn();
  var head = width ? sheet.getRange(1, 1, 1, width).getValues()[0].map(String) : [];
  var missing = COLUMNS.filter(function (c) { return head.indexOf(c) === -1; });
  if (missing.length) {
    sheet.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
    head = head.concat(missing);
    sheet.getRange(1, 1, 1, head.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return head;
}

/** The row holding this demo id, or 0. */
function findRow_(sheet, head, demoId) {
  if (!demoId) return 0;
  var col = head.indexOf('Demo ID') + 1;
  var last = sheet.getLastRow();
  if (col < 1 || last < 2) return 0;
  var ids = sheet.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(demoId)) return i + 2;
  }
  return 0;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
