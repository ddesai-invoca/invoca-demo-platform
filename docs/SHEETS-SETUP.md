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

Every SE's demo notes are then written with that admin's connection. Nobody else grants
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

## What lands in the sheet

One tab per event, one row per prospect, keyed on a hidden **Demo ID** column.
Re-submitting notes for the same prospect updates that row; clearing a mark empties the
status and notes but keeps the row. Columns you add by hand are preserved.
