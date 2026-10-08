# Connecting an event to a Google Sheet

Two paths. The first is what the dialog leads with and is one click plus a pasted link;
the second needs no Google grant at all and is four steps.

## 1. Paste a link (recommended)

**One-time, by whoever administers the Google Cloud project:**

1. In the Cloud Console for the project that already holds this app's OAuth client,
   **enable the Google Sheets API**.
2. On the **OAuth consent screen**, add the scope
   `https://www.googleapis.com/auth/spreadsheets`.

That is all. There is no new OAuth client, no service-account key, and no new redirect
URI — `/auth/sheets` reuses the existing `/auth/callback`, distinguished by its state
prefix, exactly as `/auth/drive` and `/auth/gmail-connect` do.

**Then, per event, by any project admin:**

1. Launch screen → the event's section → **Connect a sheet**.
2. **Connect Google Sheets** (once per admin, not per event).
3. Paste the sheet's link, or press **Or create one for this event**.

Everyone's demo notes are then written with that admin's connection. Nobody else grants
anything, and nobody else needs edit access to the sheet.

⚠️ The grant belongs to a person. If they revoke it or leave, rows stop and the mark
dialog says to reconnect. Re-connect as somebody else and the event carries on.

## 2. Apps Script webhook (no Google grant needed)

Use this if the org will not enable the scope above. In the same dialog, open
**Can't connect Google? Use a script instead**, then:

1. Open the sheet → **Extensions › Apps Script**.
2. Paste in `public/event-sheet.gs` (the dialog's **Copy the script** button hands you
   the same file).
3. **Deploy › New deployment › Web app** — execute as **Me**, access **Anyone**.
4. Paste the `/exec` address back into the dialog.

"Anyone" is what lets the server POST without a credential. The URL is the only secret:
it is stored server-side, shown only to admins, and re-deploying rotates it.

## The two tabs

### Demo Notes
One tab, **Demo Notes** — the sheet's first tab, renamed (a tab that already holds
something is left alone and a new one is added instead). One row per prospect:

| Prospect | Website | Status | Notes | Audience | Date/Time | Open demo |
|---|---|---|---|---|---|---|

Re-submitting notes for the same prospect updates that row; clearing a mark empties the
status, notes and audience but keeps the row. Columns you add by hand are preserved.

⚠️ The row is matched on **Prospect**, so two demos with the same prospect name share a
row — including the same prospect across two different events, since everything lands on
one tab. **Date/Time** is Chicago time (US Central), written by the server so it does not
depend on the spreadsheet's own timezone.

### Activity

Who opened a shared demo, and what they did in it. One **main row per prospect** carrying
the totals, with a **subline per person** indented under it — several people on one
prospect do not produce several top-level rows.

| Prospect / Person | Opened | SMS demos | Voice demos | First seen | Last seen |
|---|---|---|---|---|---|
| **United Veterinary Care** | 3 | 2 | 1 | … | … |
| ↳ buyer@unitedvetcare.com | 2 | 2 | | … | … |
| ↳ cto@unitedvetcare.com | 1 | | 1 | … | … |

Most recently active prospect first. Counts are **conversations, not messages**: the SMS
capture reports itself after every turn, and the server counts each conversation once by
its own id.

⚠️ **The email is self-declared.** It is what somebody typed on the unlock page, and they
are not made to prove it — they could not be, because the password is derivable from that
page. This records who *said* they were opening the demo. Somebody who clicked "I already
have the password" shows as `(no email given)`.

⚠️ **This tab is rewritten whole on every event**, scoped to the demos in that event. The
server holds the truth (`DATA_DIR/activity`), so a sheet connected later is filled in with
everything that already happened.

## Styling

Both tabs are set in the product's own palette and its own face (Lato): a header band in
the Invoca brand green `#00b388` with white bold text, a frozen header row, sized columns,
a wrapping Notes column, a hairline under every row, and — on Activity — prospect rows
picked out in bold on the pale green `#f4fbf8` with the counts in `#00624d`. It is applied
on every write, so a sheet you create by hand picks it up as soon as the first row lands.

Every colour here is one the platform already uses elsewhere (the sales playbook and the
notification emails use the same set), so the sheet reads as part of the product. The
counts use the deeper `#00624d` rather than the brand green, which is a background colour
and is close to unreadable as small text on white.

⚠️ Styling is **cosmetic and never fails a write**: if it errors, the row is already in.

⚠️ **The Apps Script fallback does Demo Notes only** — no Activity tab and no styling.
Those need `batchUpdate` calls that would make the script far larger than the thing it is
a fallback for. If you need Activity, use the Connect Google path.

---

One tab, **Demo Notes** — the sheet's first tab, renamed (a tab that already holds
something is left alone and a new one is added instead). One row per prospect:

| Prospect | Website | Status | Notes | Audience | Date/Time | Open demo |
|---|---|---|---|---|---|---|

Re-submitting notes for the same prospect updates that row; clearing a mark empties the
status, notes and audience but keeps the row. Columns you add by hand are preserved.

⚠️ The row is matched on **Prospect**, so two demos with the same prospect name share a
row — including the same prospect across two different events, since everything lands on
one tab. **Date/Time** is Chicago time (US Central), written by the server so it does not
depend on the spreadsheet's own timezone.
