# Context integrations: Gong, Google Drive, Slack, Salesforce

The launch form's **Advanced settings** panel can pull context about a prospect
from Gong, Google Drive and Slack, and feed it into the generation so the demo
leads with the signals, agent channel and dashboards that the actual
conversations with that prospect suggest.

**Gong and Google Drive are built and live.** Slack is the one still **off**
until this server has its own credential for it — see section 3 for what that
would take. Google Drive is section 2 (a pasted link already works with no
credential at all for anything shared publicly, section 0; connecting Drive
only adds reach into private, internal docs). Gong is section 1.

---

## ⚠️⚠️ First, the thing that surprises everyone

**An assistant's connectors are not this server's credentials.**

A Claude session can hold Gong, Slack and Drive connectors, authenticated as the
person chatting. Those live inside Claude. The deployed app on Render cannot
reach them — there is no path from `engine/core.ts` to somebody's chat session.
So "Claude can already read Gong" does not make the app able to.

The app needs its own credential per provider, and the three providers use
**three different auth models**. That is not an inconsistency to tidy up; it is
what each vendor actually offers, and it decides how much setup each one costs.

| | model | who it reads as | setup cost | "works for everyone"? |
|---|---|---|---|---|
| **Gong** | one service credential | the app | one key, once | **Yes**, immediately |
| **Google Drive** | per-user OAuth | the signed-in SE | reuses the existing client | Yes, after each SE consents once |
| **Slack** | workspace app | a bot | needs approval | Yes, once installed |

**Okta does not help here.** Okta is sign-in identity — it gets a person *into*
things. It does not grant this server permission to read Gong calls or Slack
messages; those are SaaS APIs with their own auth. Federating login through Okta
still leaves you needing a Gong key and a Slack app.

---

## 1. Gong — BUILT (9/10/2026)

Gong is the one where your instinct was exactly right: **connect it once and it
works for every SE.** Gong's API uses a workspace-level Access Key + Secret, so
the app calls Gong as itself rather than as each person.

**What to set**

1. Gong → **Company Settings → Ecosystem → API** (needs a Gong admin).
2. Create an **API key**. Gong shows an **Access Key** and an **Access Key
   Secret** once — the secret is not shown again.
3. Set on the Render service:
   ```
   GONG_ACCESS_KEY=...
   GONG_SECRET=...
   ```
4. **Restart the service**, then check `/api/status` shows
   `"integrations": { "gongConfigured": true, ... }`.

**There is no plain toggle — Gong gets its own search box and a real "Look up
Gong" button** under "Pull context from" on the launch form's Advanced settings
panel, alongside Slack. Unlike Drive, there is no specific doc to point at, so
clicking the button searches Gong itself and, if it finds anything, adds a
result chip exactly like an attached document or a pasted link — same visible
proof-of-read (a character count), same remove button.

⚠️ **The search box follows the Prospect name field until you edit it, then
it's yours** — so the common case is one click, but a search that finds nothing
can be retried against whatever Gong actually calls that account ("ORMC", a
shorter form) instead of dead-ending. **Only the name is required**; the
Website URL is used solely for the CRM cross-check below and the search works
without it.

**How the search actually works, verified against this project's own live Gong
workspace rather than assumed:** Gong's API has **no "look this account up"
endpoint** — `/v2/calls` returns every call in a date window with no company
filter (2,002 calls in 60 days on this workspace alone). What *does* work,
confirmed on real data, is that people **name their Gong-recorded meetings
after the account** ("Orlando Health Discussion", "Barco Products IFS Demo",
"SERVPRO+Invoca: Immersion Day Alignment") — so `engine/gongApi.ts` searches
call **titles** for the prospect's name as a whole phrase, starting with the
last 14 days and widening to 45 then 120 only if nothing turns up, capped at 25
pages total either way. For whatever it finds, it fetches the AI-written brief,
key points and detected topics via `/v2/calls/extensive`, plus — where Gong's
Salesforce integration has linked a CRM Account — that account's own
`Website` field, which it cross-checks against the prospect's URL and drops
any call that resolves to a **different** company. With no URL given, that
cross-check simply stands down (title matching alone decides) rather than
dropping everything — which is what makes the URL optional.

**What it gives the generation:** one context source labelled "Gong — account
call history": recent call dates, the AI brief, key points, which tracked
topics actually came up, and the most recent CRM "next steps" note where one
exists — themes, objections, next steps, the same promise this section always
made.

⚠️ **It only works for a prospect Gong actually has recent, TITLED calls for.**
A cold prospect, or one whose calls are titled generically, returns nothing —
verified live: "Orlando Health" finds real calls, "Goosehead" (a real customer)
currently does not, because nothing in the last four months happens to be
titled that way. The panel says so plainly ("No Gong calls found for ‹name›")
rather than implying a personalization that did not happen. Most of the 2026
Dallas Summit roster will fall in the "nothing found" case, same as it always
would have.
⚠️ **The name does NOT have to be punctuated the way Gong punctuated it.** Both
sides collapse to word tokens first, so `&` ≡ `and` ≡ nothing, casing, periods,
commas and slashes all stop mattering, and a typed "Inc."/"LLC" is dropped:
typing **"Avi and Co"**, "Avi & Co", "AVI & Co.", "Avi Co" or "Avi & Co., Inc."
all find a call titled **"AVI & Co. <> Invoca"** — verified live against the
real workspace, all four returning the same two calls.
⚠️ **It is still a CONTIGUOUS whole-token phrase, which is what keeps the
fuzziness honest.** "Avi & Co" does not match "Aviation Co Weekly Ops" (tokens
are equal or they are not — "avi" ≠ "aviation"), and "Orlando Health" does not
match "Orlando Utilities Health Fair" (the tokens have to be adjacent). Legal
suffixes are only stripped while **more than two tokens remain**, so "Avi & Co"
can never degrade to the bare token "avi" and start claiming unrelated calls.
A short or common name therefore still *undermatches* rather than overmatching
— a generic word claiming the wrong company is the worse failure.

⚠️ **Everyone shares the app's Gong visibility.** A service credential sees what
it is scoped to see, for every SE. Scope the key to the workspace you want
demoed against and no more.

---

## 0. Pasting a Google Doc link already works, no credential needed

The Advanced settings panel's Strategy document field takes a pasted Google Doc / Drive
link **today**, separately from the OAuth integration below. `engine/driveLink.ts` fetches
the doc's public plain-text export (`docs.google.com/document/d/<id>/export?format=txt`),
which Google serves with no auth for a doc shared **"Anyone with the link can view."** A
doc that is not shared that way redirects to a Google sign-in page, and the panel reports
that as "isn't shared with Anyone with the link" rather than failing silently.

This is NOT the per-user OAuth Drive integration in section 2 below — it needs no server
credential, no `GOOGLE_DRIVE_ENABLED`, and no consent flow, but it also only ever works for
a doc an SE has deliberately made link-shareable. A private company Drive doc still needs
the OAuth path.

## 2. Google Drive — BUILT (9/10/2026)

Unlike Gong and Slack, this one is done — turning it on is an admin setting the
credential, then each SE clicking one button, not a new code change.

The app **already has a Google OAuth client**, because that is what signs
everyone in. Drive needed one more scope on it, not a new vendor — the same
shape the Gmail sending route (`/auth/gmail`) already proved, though Drive is
**per-user, not admin-only**: `/auth/drive` is open to any signed-in SE, and
each SE's own refresh token is stored server-side (`engine/driveTokens.ts`,
under `DATA_DIR/drive-tokens/`, the same disk the demo library and feedback
board already use — never in git, never logged) rather than displayed once for
someone to paste into an env var. That is the real difference from Gmail: Gmail
mints ONE shared credential for the sending account; Drive mints one PER SE.

**What to turn on**

1. Google Cloud Console → the project holding the existing OAuth client → enable
   the **Google Drive API**.
2. Add the scope **`https://www.googleapis.com/auth/drive.readonly`** to the
   OAuth consent screen.
3. Set on the Render service:
   ```
   GOOGLE_DRIVE_ENABLED=1
   ```
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are already there — if sign-in
   works, they are set. That is why Drive has its own flag: the credential
   exists, what is missing is the granted scope, so the auth-gate boolean cannot
   stand in for it.
4. **Restart the service**, then check `/api/status` shows
   `"integrations": { "driveConfigured": true, ... }`.

**Each SE then connects their own account, once**: open Advanced settings on
the launch form, and the Google Drive row shows a **Connect** button once the
server capability above is on. It walks through the same consent screen sign-in
already uses, plus the one added scope, and comes back to a **Connected**
state — no token to copy, no page to read. **Disconnect** removes the stored
token immediately (it does not also revoke it with Google; revoking the app's
access from `myaccount.google.com/permissions` is the belt-and-braces version).

**What it gives the generation:** pasting a Google Doc link into Advanced
settings — a *private*, internal one now, not only a publicly-shared one —
reads that doc's text as context. `engine/driveApi.ts` calls the Drive API v3
as the connected SE (`files.get` for the mimeType, then `files.export` for a
native Google Doc or a raw download through the existing `.docx`/`.txt` reader
for anything else uploaded to Drive). The paste-a-link field tries this path
FIRST when the SE has connected, and falls back to the credential-free
public-export path (section 0 above, `engine/driveLink.ts`) automatically — so
connecting Drive only ever widens what a pasted link can reach, it never
narrows it.

⚠️ **A dead connection (revoked, or the grant removed on Google's side) is
reported plainly rather than silently swallowed** — the paste-a-link field
says "reconnect it in Advanced settings" instead of falling back to the public
path and giving a confusing "isn't shared" error for a doc that plainly is
shared with that SE.

⚠️ **Per-user is the right model and worth the extra consent step.** Strategy
docs live in individual and team Drives. A service account with domain-wide
delegation would avoid the consent, and would also let the app read every
document in the company — a far larger blast radius than this feature earns.

---

## 3. Slack — expect this one to stall

**What to get**

1. A Slack app installed to the workspace, with **`search:read`** (plus
   `channels:history` / `groups:history` for the channels you want readable).
2. Set on the Render service:
   ```
   SLACK_BOT_TOKEN=xoxb-...
   ```

⚠️ **This is an approval, not a variable.** Installing a Slack app to an Invoca
workspace needs workspace-admin sign-off. This project already has a **declined
feature request on record** — *"Slack notification when my demo finishes
generating"* — closed with the note *"Nice idea, but it needs a Slack app and
approval. Revisit if more people ask."* The same blocker applies here, so treat
Slack as last and plan for it not to happen.

---

## 4. Salesforce — BUILT (9/23/2026)

**What it powers:** the optional "tell the account exec" half of marking a demo.
The platform resolves the prospect's Salesforce **Account** and emails its
**Owner** with the status and the SE's note.

### The fast path: a CLI refresh token (no admin, ~10 minutes)

This is what to do first. It uses Salesforce's own pre-installed `PlatformCLI`
connected app, so there is no app to create and nobody to ask.

```bash
npm i -g @salesforce/cli      # or: brew install salesforcedx
sf org login web              # log into the PRODUCTION org, click Allow
cat ~/.sfdx/<your-username>.json
```

Take `refreshToken` and `instanceUrl` from that file into the environment:

```
SALESFORCE_REFRESH_TOKEN=<refreshToken>
SALESFORCE_INSTANCE_URL=<instanceUrl>     # optional, the token response wins
```

⚠️ **No `SALESFORCE_CLIENT_SECRET`.** `PlatformCLI` is a *public* client — the
code defaults `SALESFORCE_CLIENT_ID` to it and sends no secret, because sending
one makes the exchange fail.

**What you are accepting by using it:** every lookup reads as *you*, so
Salesforce's API audit log shows your user for everybody's marks. It is a
read-only `SELECT` on Account — nothing is written, no record is touched — but
it also **stops working if your account is deactivated**. Good bridge, not a
destination.

### The durable path: a Connected App

**What to obtain** — a Salesforce admin does this once, and it then works for
every SE (same shape as Gong; nobody consents to anything):

1. Setup → App Manager → **New Connected App**.
2. Enable OAuth Settings, scope **`api`** (`Manage user data via APIs`). A
   callback URL is required by the form but unused by this flow — any https URL.
3. On the connected app's **policies**: tick **Enable Client Credentials Flow**
   and set a **Run As** user.
   ⚠️ Without both, the token endpoint answers *"client credentials flow not
   enabled for this connected app"* — which the platform surfaces verbatim
   rather than swallowing.
4. That run-as user needs **read** on Account and User. Nothing writes.
5. Put the consumer key/secret in the environment:

```
SALESFORCE_CLIENT_ID=<consumer key>
SALESFORCE_CLIENT_SECRET=<consumer secret>
# only for a sandbox or a My Domain login host:
# SALESFORCE_LOGIN_URL=https://test.salesforce.com
```

**Verify:** `GET /api/status` → `integrations.salesforceConfigured: true`, then
tick "Tell the account exec" on any demo's flag — it names the owner before
anything is sent.

### ⚠️⚠️ The match is on the WEBSITE DOMAIN, and that was measured, not chosen

Matching by NAME pings the wrong person. Against the real CRM, `Name LIKE`:

| searched | also returned |
|---|---|
| `%PMG%` | KPMG, EPMG |
| `%Aptive%` | Adaptive, Adaptive Biotechnologies, CaptiveAire, Captive Resources |
| `%Riverbend%` | "Mednik Riverbend" — a medical group, not the pool company |
| `%Moffitt%` | "Moffitt Fan Corporation" |

So the key is `DemoRecord.websiteUrl`. **But `Website LIKE '%domain%'` bleeds
too** — `%att.com%` also matched `allianceatt.com` plus two junk records whose
Website field literally reads att.com, and `%optimum.com%` matched
`solaroptimum.com` and `groupe-optimum.com`. The `LIKE` is only a coarse
prefilter; `sameSite()` re-checks every candidate in code (equal, or a
dot-suffix — never `includes`).

### Who the notification comes from

**The SE who marked the demo — automatically, with nothing to click.** Asked
for directly: *"it should automatically just be sent as that user, they dont
need to click anything"*.

- **`gmail.send` is part of the SIGN-IN scope.** The grant rides the login
  everyone already performs, and `/auth/callback` stores the refresh token when
  Google returns one (first grant only — it never overwrites a stored token with
  nothing on later sign-ins). By the time anyone marks a demo, their mailbox is
  connected because they logged in.
- `From` is their address, the message lands in **their** Sent folder, and a
  reply reaches them naturally.
- Tokens live per SE in `engine/gmailTokens.ts`, in their own directory —
  **not** shared with Drive's, because the two are revoked independently.

⚠️ **The consequence, stated plainly: the Google consent screen now says "Send
email on your behalf."** It is all-or-nothing, so somebody who declines cannot
use the platform at all. That is the price of removing the click, and it was
the explicit trade.

⚠️ **`/auth/gmail-connect` survives as a recovery path only.** Anyone whose
session predates the widened scope has no token yet; it heals on their next
sign-in, and the panel says so rather than demanding anything. Until then their
notifications come from the platform mailbox with their name in the body.

⚠️ **Workspace domain-wide delegation was still rejected.** It is the only
*other* zero-click route, and it lets this server send as anyone at Invoca with
no consent from anybody — a far larger grant than each person allowing it for
themselves, and it needs a super-admin. CLAUDE.md already turned it down for
Drive's read scope; send is strictly worse.

### What it refuses to do

- **Duplicate accounts with different owners** (`goaptive.com` → two "Aptive
  Environmental" records, two AEs) come back as **candidates**; the SE picks.
  Guessing would tell the wrong colleague about an account that is not theirs.
- **Nothing is emailed unless the SE ticks the box**, per demo.
- **The recipient is resolved server-side and must be `@invoca.com`.** The
  browser only ever sends a flag and, when asked, which candidate.

---

## Until any of them are connected

The custom-prompt field reaches the generation through **exactly the same
path** as an integration's output would (see `engine/genContext.ts` — a typed
prompt, a document's text and an integration pull are all one thing to the
model). So pasting the relevant notes into the custom prompt gets the same
result today, just by hand instead of automatically.

## Where the code goes when Slack's credential lands

- `engine/integrations.ts` — one `*Configured()` per provider, read by
  `/api/status` and used by BOTH servers. That is the only place that decides
  whether a provider is available; the panel and the endpoints follow it.
- `engine/genContext.ts` — a provider's output becomes a `ContextSource`
  (`{ label, text }`) and needs nothing else: the prompt injection, the
  per-source cap, the precedence wording and the provenance recording all
  already handle it.
- Look at `engine/gongApi.ts` for the shape a search-based provider takes (no
  specific item to point at, so it searches and returns `ContextSource | null`)
  and `POST /api/gong-lookup` for the endpoint shape — Slack's own workspace
  search would very likely follow the same two pieces.

## Where Gong's code actually lives (already built)

- `engine/gongApi.ts` — `gongLookup(name, url)`: searches `/v2/calls` titles in
  progressively wider recent windows, enriches matches via
  `/v2/calls/extensive`, cross-checks against the prospect's URL using
  Salesforce Account data where Gong's CRM link supplies it, and returns a
  `ContextSource | null` — never throws for "nothing found."
- `POST /api/gong-lookup` (both servers) — what the panel's "Look up Gong"
  button calls; `{name, url}` in, `{label, chars, text}` or a plain `{error}`
  out (a 404 for "nothing found," not a 500 — it isn't a failure).
- The button lives under **"Pull context from,"** alongside Slack — corrected
  on request after first landing next to Strategy document. That section's
  real purpose isn't "toggle an integration," it is "personalize the demo
  deeper than wording": which dashboard actually matters, whether the story
  is an SMS or a voice agent, which report and which signals (including
  Signal AI Gold) it leads with — exactly what custom prompt and strategy
  document already do, just read from an actual conversation instead of typed
  or uploaded by hand. See the header comment in `AdvancedSettings.tsx`.

## Where Drive's code actually lives (already built)

- `googleAuth.ts` — `/auth/drive` (open to any signed-in SE) and the `drive:`
  branch of `/auth/callback`, which stores the refresh token rather than
  displaying it.
- `engine/driveTokens.ts` — one JSON file per SE, on the same `DATA_DIR` disk
  as the demo library. `saveDriveToken` / `getDriveToken` / `hasDriveToken` /
  `removeDriveToken`.
- `engine/driveApi.ts` — `fetchPrivateGoogleDocText(url, email)`: mints a
  short-lived access token from the stored refresh token (cached per SE until
  near expiry, same pattern as `engine/mailer.ts`'s Gmail token), then calls
  the Drive API. Throws `DriveReconnectError` specifically for a dead
  connection, so the caller can tell that apart from an ordinary "not found."
- `GET /api/drive-status` / `POST /api/drive/disconnect` (both servers) — what
  the Advanced panel's Drive row reads and calls.
- `POST /api/generate/doc-link` (both servers) — tries `driveApi.ts` first
  when the SE has connected, then falls back to `engine/driveLink.ts`'s
  public-export path.
