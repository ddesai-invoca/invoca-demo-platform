# Invoca Demo Platform — Project Guide

## What this is
A **demo-generation platform** for Invoca Sales Engineers. It replicates Invoca
platform screens as **templates**, then customizes all the on-screen data for a
given prospect from just a **customer name + website URL**. Goal: an SE enters a
name + URL and gets a fully clickable, on-brand Invoca demo tailored to that
prospect (report data, dashboard, campaigns, products, etc.).

The end state is a clickable React app mirroring the Invoca platform, where every
data-driven screen reads from one **canonical customer profile** that an AI
**generation engine** produces per customer.

## Tech stack
- **Vite + React + TypeScript**, **React Router**, **Zod** (schema + validation)
- Node 25 (runs `.ts` directly for the engine)
- Anthropic SDK (`@anthropic-ai/sdk`) for the generation engine

## Run it
```bash
cd /Users/ddesai/invoca-demo-platform
npm run dev          # Vite dev server → http://localhost:5173/
npm run generate -- --name "Customer" --url https://customer.com/   # AI generate a demo customer
npx tsc --noEmit -p tsconfig.app.json   # typecheck
```
The generate command needs `ANTHROPIC_API_KEY` in `.env` (already created; git-ignored).
The same key powers the in-app **Launch screen** (live generation), so `npm run dev`
must run with `.env` present.

## Shared team demo library (server-backed)
Demos are stored **on the server** so the whole team sees the same list, not just
whoever's browser generated them. Storage = **one JSON file per demo on Render's
persistent disk** (`engine/demoStore.ts`: `$DATA_DIR` → `/var/data` or `/data` if
mounted → `<repo>/.data` locally, git-ignored). `engine/demoApi.ts` is a
transport-agnostic handler (`handleDemoApi`) mounted by BOTH `server.ts` (prod) and
the `demoLibraryApi()` plugin in `vite.config.ts` (dev) — keep them in sync.

Routes: `GET /api/me`, `GET|POST /api/demos`, `GET|PATCH|DELETE /api/demos/:id`,
`POST /api/demos/:id/duplicate`.

### Checking the live deploy from outside the gate: `GET /api/status`
`curl -s https://invoca-demo-platform.onrender.com/api/status | python3 -m json.tool`

**PUBLIC** — registered ahead of the auth gate in `server.ts`, the same way
`/healthz` is, because the whole point is answering "did my push actually reach
the live site?" without signing in. One shared implementation in
`engine/status.ts`, served by BOTH `server.ts` and a `statusApi()` Vite plugin so
the two can't drift.

Reports: `commit`/`commitShort`/`branch`/`service` (Render supplies
`RENDER_GIT_COMMIT` etc. free — **null locally, which is how you tell a dev server
from the real deploy**), `bootedAt`, `uptimeSeconds`, `node`, a demo **count**,
`storage.persistent` (is the Render disk actually mounted, or are demos about to
be lost on redeploy?), and `integrations` as **booleans**.

⚠️ **It is public, so adding a field publishes it.** No prospect names, no demo
ids, no emails, no key values — counts and booleans only. Anything naming a
customer belongs behind the gate.

⚠️ **Every key presence is passed IN by the caller, never read from
`process.env` inside `status.ts`.** The first version read them directly and
reported the Places and Mapbox keys as `false` on the dev server even though
`.env` had both: Vite does not put `.env` into `process.env`, it exposes it via
`loadEnv()`. A status endpoint that under-reports configuration is worse than
none — it sends you hunting for a key that was already set.
⚠️ `mapboxTokenInServerEnv` is named for what it measures: the frontend needs
that token at **BUILD** time, so runtime presence does NOT prove the deployed
bundle carries it.

### The nightly canary: `GET /api/canary` (PUBLIC) + a 2am self-check
`engine/canary.ts` runs ONE full `generateProfile()` at **~5am Eastern**, times
every phase, audits the result, and **throws the profile away**. Armed from
`server.ts`'s `scheduleCanary()`; `CANARY=off` disables it, `CANARY_HOUR_ET`
overrides the hour, `CANARY_ON_BOOT=1` runs one immediately for wiring checks.
⚠️ **Two claude.ai routines read `/api/canary` at 6:00 and 6:30 ET, i.e. AFTER
this.** Moving the canary hour without moving them means they report on the
PREVIOUS morning's run and a real failure goes unnoticed for a day.

**Why it lives in the web process** and not in a cloud agent or a Render cron:
`generateProfile()` needs `ANTHROPIC_API_KEY`, and the deployed service is the one
place that already has it. That means **no new endpoint that bypasses the Google
gate, and no secret handed to anything else** — the scheduled cloud agent that
reacts to a regression only reads the PUBLIC result, so it needs no credential.
(The rejected alternative was a token-guarded generate route, which would have
required pasting that token into a routine's prompt.)

⚠️ **The profile is NEVER persisted** — not to the demo library, not to
`src/data/generated`. Only a small result record goes to `DATA_DIR/canary.json`
(last 30 runs). "Generate then delete" leaves junk behind whenever the run dies
between the two steps; this cannot, and it can never put a fake prospect in front
of the team. Verified end to end: `generated/` file count unchanged after a run.

⚠️ **Fixed rotating targets, deliberately not random.** Research time swings with
site size (measured 60s vs 85s across two prospects) — far larger than any
regression worth catching. Three stable sites rotate by day-of-year and each run is
compared against `history` for **its own `targetIndex`**.

⚠️ **`/api/canary` is PUBLIC** (registered before `installAuth`, like
`/api/status`), so adding a field publishes it. `toPublic()` deliberately omits the
target **names and URLs**: they are real companies, and a public endpoint implying
they are Invoca prospects is the exact leak `/api/status` was careful about.
`targetIndex` is enough to compare like with like.

`prefixSeconds` is **measured** as `research + terms` (the serial pre-pool time,
~40% of wall clock). It used to be derived as `total − longest phase`, which is
only correct while a POOL phase is the longest — the moment research becomes the
longest phase that formula silently reports nonsense. `slowestPhase` likewise
excludes research/terms, since those are serial and don't bound the pool.

The audit covers what **Zod does not**: the fields other screens silently fall back
on (the Search Term row the Google Ads keyword needs, the Product Category its ad
group needs, `smsPlaybook.qualifyingQuestions`, `brandDomain`, `bookingTerm`), the
canonical breakdown order, the dashboard **arithmetic** (complete partitions summing
to the call total, top-5s summing to less), and dash-joined prose. 13 checks on a
current profile. Tested in BOTH directions — silent on good profiles and actually
firing on 8 deliberately corrupted ones, because a check that never fires is
indistinguishable from no check.

Measured: 201.6s on a real run (budget 300s), 20 phases captured, 0 audit failures.

**Reacting to a regression is a scheduled cloud agent**, not this code: it reads
`/api/canary` and, if `needsAttention`, opens a **PULL REQUEST**. It must never push
to `main` — main auto-deploys, and a 2am agent must not deploy. See
[[invoca-demo-status-and-next-step]] in user memory for the routine id.

### "Lead Form Performance Summary" — Marketing Performance dashboard
A KPI card directly UNDER "Call Performance Summary", same 4-tile shape so the two
read as a channel pair: Lead Form Count · the prospect's engagement-rate tile · the
conversion percent · revenue.

**Derived in the screen, folded into the registered page data** (so the assistant can
edit its values and rename its labels like any built-in tile, and undo covers it). No
schema slice and no engine phase, so all 19 profiles on disk get it.

Anchors live in **`src/data/leadForms.ts`**, shared with the Location Comparison
scorecard so the two screens cannot disagree about the form count:
`aiMessagingImpact.aiLeadEngagement` → Form Submits + its engagement-rate tile, and
`aiAgentConversion`'s "LEAD FORM (Conversions)" cards for revenue and conversion.
⚠️ Conversion is **revenue-weighted** across those cohorts, not a straight mean — a
plain average of 24/28/31% lets the smallest cohort drag the headline number.
⚠️ The **conversion and revenue LABELS are read off the neighbouring call card's
tiles**, so the pair stays consistent per vertical ("Watch Sold" for a watch dealer,
"Policy Bound" for an insurer, "Move Booked" for a mover) instead of hardcoding one
prospect's vocabulary. Returns null and the card is omitted when the anchors are
missing. Sanity-checked across all 19 profiles: form revenue is always a fraction of
call revenue, never larger.

### The "volume is not value" story — now ENFORCED, not just asked for
Every Call Outcome Summary must open on the highest-volume row with the WORST
conversion rate and close on the smallest with the BEST, because that contrast is the
SE's line: "your biggest channel is not your best channel."

⚠️ **It was silently not holding, and in four profiles was exactly INVERTED** — the
biggest row carried the BEST rate on all six breakdowns, so the tile said the opposite
of the story. Audited 2026-08-05: autonation / continuing-life / key-whitman /
orlando-health inverted on all 6, mattress-firm on 4, and two RECENT profiles missed it
on one each (Product Category, Region). Prompt-only, nothing verified it, invisible
until an SE told that story on a call.

The likely cause was ambiguity: every breakdown has TWO percent columns and
`outcomeStory()` said "the WORST rate" without saying which. It now names the
**conversion column (index 2)** explicitly — col 1 is Quote Discussed, or
"<booking> Set (Industry)" on Product Category — states the rule as "first row lowest,
last row highest", says it applies to EVERY breakdown including Product Category and
Region, and tells the model to re-read the column before returning.

**Enforced by the canary**: 12 checks (both halves × 6 breakdowns). Same
instruct-then-enforce pairing as the dashes and rule 2, and the fix is verified rather
than assumed — regenerating AutoNation took it from **12 story failures to 0**, with
every breakdown rising monotonically (Campaign 14→17→21→25→33%).
⚠️ Reading column 1 by mistake is how a first pass at this check mis-scored Product
Category; the conversion column is index 2 on every breakdown shape.

### Location Performance Comparison (`/dashboards/location-comparison`)
A per-location scorecard for the prospect's MANAGERS: a card per location, then the
locations side by side — share of calls (donut), booking-rate ranking (HBarChart) and
a full-width head-to-head table with a metric per ROW and a location per COLUMN, which
is the orientation that lets a manager read one row and see who is ahead.

**Derived, not generated.** Everything comes from `opsDashboard.locationHandling` plus
the Marketing dashboard's KPI totals — no schema slice, no engine phase, so all 19
profiles on disk get it immediately, generation stays at ~2m45s, and the numbers AGREE
with the other dashboards instead of being a second conflicting set. Same approach as
`InsightsDashboard`. Listed in Manage Dashboards only when `locationHandling.rows` is
non-empty (every prospect currently has 4 rows).

⚠️ **The reconciliation is the point.** `locationHandling` is a complete partition:
measured on Avi & Co its rows sum to 5,943 calls = the Marketing dashboard's Call
Count exactly. **Revenue is split by BOOKINGS, then normalised to the company total**
(verified: the four parts sum to $21,628,598 to the dollar). Splitting by call volume
instead would imply every location converts identically, which contradicts the booking
rates printed right beside it — a 31% booker and a 19% booker would show the same
revenue-per-call. Columns a prospect can add up have to add up.

**Lead forms are per-location too**, derived from two real anchors rather than an
invented call:form ratio — `aiMessagingImpact.aiLeadEngagement`'s **Form Submits**
(Avi & Co: 1,247) and the sum of `aiAgentConversion`'s **LEAD FORM (Conversions)**
revenue tiles ($6,346,140). Volume splits by call share (the only per-location signal
the profile has); each location's forms convert at ITS OWN booking rate; form revenue
follows form bookings. `apportion()` makes both columns sum EXACTLY to their published
totals — verified 1,247 and $6,346,140 to the unit. If either anchor is missing the
lead-form rows are simply omitted, because a fabricated form count beside real call
counts is worse than none.

⚠️ There is deliberately **no "Form Booked (Percent)" row**. Form bookings are derived
FROM the call booking rate, so that row rendered identical to "Booked (Percent)" —
two matching percentage rows imply two independent measurements when only one exists.
Replaced with **Revenue per Lead Form**, which carries the same signal honestly.
⚠️ Revenue is labelled **"Form-Attributed"**, never "Total": it is the lead-form
channel cut, NOT an amount to add to the call revenue row above it. There is no totals
row on this table, so nothing sums them.

⚠️ **No new CSS**, per the request to keep the design identical: every class is one
another dashboard already uses (`.dash-page` / `.dash-card` / `.kpi-grid` / `.kpi-tile`
/ `.breakdown-row` / `.dash-table` / `.donut-wrap`), including `.aac-conv-grid` for the
cards row. Its column count is set from the data (`repeat(min(n,4), 1fr)`) — the same
pattern the AI Messaging cards use — so four locations sit on one row rather than
leaving an orphan card under three.

Columns are found by HEADER (`/call count/i`, `/not answered/i`, …), never by index, so
the engine reordering `locationHandling.columns` cannot silently swap Calls for
Voicemail. Headings go through `usePageDataWithLabels`, so the AI can rename any of
them and the edit belongs to this page alone.

### ⚠️ STANDING RULE for every Insights & Analytics screen: charts are interactive
**Every chart on an Insights & Analytics report must do three things**, and this applies to
reports built in future, not just the two that exist:

1. **Highlight on hover, fade the rest.** Bars fade to `0.22`, donut slices to `0.16` (plus a
   `0.28` halo just outside the hovered slice), phase bands to `0.14`. Multi-series charts
   fade by SERIES, not by single bar — pointing at a teal bar keeps every teal bar saturated,
   which isolates one metric across all rows. A heatmap is the exception: it **lightens** the
   hovered cell (`brightness(1.14)`) instead of dimming its neighbours, because on a colour
   ramp fading the others would change the very thing the colour encodes.
2. **Show a metrics panel.** Always `.ind-tip` — one CSS definition shared by every chart on
   every Insights screen, so they cannot drift. Positioned in PERCENTAGES of the chart's
   viewBox inside a `position: relative` wrapper (`.ica-chartwrap`, `.ind-timewrap`,
   `.ind-trendwrap`, `.donut-hoverwrap`); the svg scales with its column, so px drifts.
   Flip the panel toward the middle of the chart past the midpoint so it stays in the card.
3. **Open the interaction drawer on click** (`InteractionsDrawer` + `buildInteractions`),
   with the tile name as the title and what was clicked as the metric.

Every one of those fades **eases** — `transition: opacity 180ms ease`, one duration across all
of them. ⚠️ Transition `opacity` ONLY, never `all`: the hover panels are positioned with
left/top percentages and React reuses the same element as the pointer moves between bars, so
transitioning position makes the panel glide across the chart a beat behind the cursor. The
selectors are scoped so the six shared dashboards gain nothing — the donut's rule hangs off
`.donut-hoverwrap`, which only exists when `hover` is passed.

Bars sit `BAR_GAP = 4` units apart, and the two bars in a grouped row **touch** (the gap goes
between groups) — a group is one row of data, so its bars belong together.

Only the Summary Dashboard's FIRST bar sets `pinFirst`/`topCallHref`; no other chart offers a
clickable call, because the demo has one transcript.

### Insights & Analytics → Details Report (the flat call grid)
`/insights/dashboard/Details Report` (`InsightsDetailsReport.tsx` + `src/data/detailsReport.ts`,
`.idt-*`), from the capture "Insights & Analytics - Reports｜ Invoca for Healthcare 2.0"
(8/6/2026, network 2160, dashboard 4f3a7106). One row per call, 17 columns, a UNIQUE COUNT
footer under every column.

**Only 7 headers survived the capture** — the grid is ThoughtSpot-rendered, so there is no
body and no footer in the DOM. Five more come off the screenshot; the report scrolls further
right than the screenshot reaches, so **columns 13+ are unknown** and the last five are named
from headers verified on OTHER screens (the Digital Journey report, the Marketing dashboards).
Add the real ones if a wider screenshot turns up; do not guess further.

Chrome differences from the other two reports, all from the screenshot: **no Ask pill, no Add
Tile** (kebab only), and the filter chip is **unset** — "Call Start Time (Select)" with a lock
icon at the FAR RIGHT (`.idt-filters` overrides the justification; `.ind-filters` is untouched).
Because the filter is unset the report spans ~2 years, not the dashboards' one month.

No chart hover/drawer — the standing rule above is about CHARTS and this screen has none. Rows
are deliberately inert; the one openable call belongs to the Summary Dashboard's first bar.

Three traps this screen walked into, all fixed and all worth not repeating:
- **`hash % (endMs - startMs)` silently does nothing** over a 2-year span: that is 65 billion
  ms and a shifted 32-bit hash tops out near 134 million, so all 200 rows landed in the same
  1.5 days. Spread by day and second-of-day separately.
- **`MM/DD/YYYY` does not sort chronologically as a string** — "01/02/2024" compares before
  "12/06/2023" — so the TIME PERIOD footer came out backwards. Each row carries its real
  timestamp; the footer takes min/max off that.
- **"Repeat Caller (Invoca)" must be decided walking FORWARD in time**, not in generation
  order (which is hash order). Deciding it at generation and then sorting newest-first for
  display left a caller's oldest call flagged as a repeat. Verified: each caller's first call
  reads No, later ones Yes.

It renders **200 rows and says 200**. The real one says "Showing 1,000 of many rows" and
virtualises; 1,000 × 17 is 17,000 live cells, which stutters on a projector, and claiming
1,000 while showing 200 is catchable by anyone who scrolls. The footer's UNIQUE COUNTs describe
the WHOLE dataset (call record ids = the profile's own call total), which is consistent with a
caption that says "of many rows".

### Insights & Analytics → Connect AI (the agentic-rollout report)
`/insights/dashboard/Connect AI` (`InsightsConnectAi.tsx` + `src/data/connectAi.ts`, `.ica-*`),
from the capture "Insights & Analytics Connect AI｜ Invoca for Healthcare 2.0" (8/6/2026,
network 2160, dashboard c925e7d5). `/insights/dashboard/:name` now goes through
**`InsightsReport.tsx`**, which dispatches on the report name — the route stays one path
because the real product's does. `Details Report` still falls through to the Summary
Dashboard until its contents are defined.

The report is ONE argument: rolling out the AI agent lifted answer rate and bookings. Every
tile is the same month cut into **three phases** (Pre Agentic → Voice Agentic Only → Full
Agentic). Derived, so no engine phase and no schema slice: volume and revenue come from
`marketingDashboard` (the same rows Marketing Performance and the Summary Dashboard use),
handle time from `callDetail`, the vertical-specific intent from `aiMessagingImpact`.

**What is designed rather than measured** — and this is the honest bit: no profile records
when a prospect switched the agent on, because it never happened. The rollout curve
(answer rate 49→73→90%, booking rate 19→26→44%) is the capture's shape, jittered per
prospect, with each phase's rate built as the previous plus a positive step so a jitter can
never invert the story. What keeps it defensible is that the TOTALS it splits are real, and
they reconcile on screen: the three phase revenues sum to the headline, the three
appointment counts sum to "…: Scheduled", voice + messaging + phase 1 = total revenue, the
intent heatmap partitions the Full phase's interactions, and the cancellation bars sum to
the last tile. Verified all of those.

Three places where the real dashboard is internally inconsistent and this one deliberately
is not (a demo where a prospect can add the numbers up must survive it):
- The capture's phase tile reads **34%** where its own table reads 25% for the same phase.
  Here the tile and the table are the same computation, so they agree.
- The last tile puts a **count** (27) under the label "Revenue Retained". Here it shows
  actual revenue — cancellations saved × this month's revenue per booking — with the count
  as a sub-label.
- `signalsUnmet`/`signalsNa` (see below) — same class of problem, filed as an engine fix.

Intents come from the booking term plus generic service intents (Reschedule, Cancel,
Billing, General Info) plus ONE vertical topic, **not** from `commonTopicsChart` alone:
those series are TOPICS, and for a blinds company they render "Blinds / Shades / Shutters"
under a heading that says "Consumer Intents", which is wrong in a way prospects notice.

`.ind-*` header/filter/card rules are reused READ-ONLY. Never edit one for this page — add
an `.ica-*` override. Verified Summary Dashboard and Details Report are byte-identical
after the route change (same KPIs 48,293 / 20,224 / 28,069, same donut labels with counts,
trend + bar charts still present, no `.ica-page`).

### Insights & Analytics: chart click → interaction drawer → ONE call
Every datum on the Summary Dashboard drills in. Clicking a **bar**, a **weekly-trend
point** or a **donut slice** opens the right-hand interaction drawer
(`InteractionsDrawer.tsx` + `src/data/interactions.ts`), measured off the capture
"Insights & Analytics drawer" (8/5/2026) — 800px paper, 225ms slide, 184px cards, exact
badge fills for CALL `#122aa6` and SMS `#89005f` (LEAD's green is off a screenshot, not
the capture). Rows are DERIVED: the summaries are the prospect's own Call Review
summaries; ids, channel mix and durations are pure functions of profile + metric + date.

**Exactly ONE card opens a call**: the top card of the drawer opened by the **first bar**
(leftmost group, first series). That drawer sets `pinFirst` — which replaces its top card
with the prospect's own `reports.callDetail` record, so the card and the page agree on id,
duration and summary — plus `topCallHref`. Every other card is inert and has no pointer
cursor. The reason is that the demo has ONE transcript: thirty cards opening the same
transcript under thirty different ids is a lie, and a transcript per card would mean
generating thirty of them. Widen this only by generating real per-call transcripts.

The call page is **`/insights/call`** (`InsightsCallDetail.tsx`, `.icd-*`), from the
capture "Insights & Analytics - Showing Call｜ Invoca for Forrester" (8/6/2026). It is NOT
`/call-review/detail` — that is a different Invoca screen with its own `.cd-*` styles and
is deliberately untouched. Both exist on purpose.

Everything on it is derived from `reports.callDetail` (+ `digitalInsights.rows[0]` for
attribution, `voiceScreenpop` for the caller), so no engine phase and no schema slice:
- **Sentiment** counts genuinely positive vs trouble turns in the transcript and scores on
  the RATIO. Bare "thank you" does NOT count as a positive moment (every polite call has
  them; that is what the Proper Greeting / Helpful Agent scorecard signals measure) and
  the score must not sit on its clamp — the first version read "Positive (74)" where 74
  was the ceiling.
- **Found Phrases** under a met signal are looked up IN THE TRANSCRIPT (signal name →
  words ≥5 chars → first matching turn → the matched word plus two more), with the real
  speaker and timestamp. A signal with no hits renders as a plain "Rule" signal and "No
  spoken phrases found", which is what the capture shows for rule-only signals.
- **Signal group badges use the LIST LENGTH**, not `signalsUnmet` / `signalsNa`: the engine
  writes 26 and 25 for those on every generated prospect while the name arrays hold 5-15,
  so the badge would contradict the list it expands. Filed as a separate engine fix;
  `CallDetail.tsx` still shows the declared counts.
- The **player is visual only** (no call audio exists, same as `CallDetail.tsx`); its
  marker strip is one dot per transcript turn at that turn's own timestamp.
- **Coaching** and **Deliveries** show honest empty states rather than invented records;
  **Comments** renders the real `callDetail.comment`.

### AI column editing — Digital Journey report ONLY
The assistant can add / remove / rename / move the **leading columns** of the Digital
Journey & Call Attribution Report, including inserting one to the LEFT of Marketing
Source. Deliberately scoped to that ONE table: the dashboards' breakdown tables,
chart series, xLabels and every table's ROW count are still blocked.

⚠️ **The model does NOT emit the new rows.** It returns `kind:"editColumn"` with only
`{op, index, toIndex, header, values}` — where the column goes and one value per row —
and **`src/data/columnEdits.ts` splices it into the current data**. That is not
fastidiousness: asked to emit full cell lists and copy the untouched columns verbatim,
Haiku rewrote `cpc`→`Google Ads`, swapped real tracked URLs for invented ones, wrote
the literal placeholder `Home / Category / Subcategory` into a live demo, renamed a
header it was told to leave alone, and covered 5 of 21 rows. Prompting harder took it
from 7 rows to 5. Splicing makes preservation **structural**.

⚠️ `InteractionRow.cells` (optional) holds the generalized leading cells;
`dimensionColumns` is the header list. Rows without `cells` fall back
**header-driven** (`leadingCells` in `DataTable.tsx`): each header takes the field it
NAMES, and an unmatched header renders empty. An earlier version padded at the end,
which put Marketing Source under a new "Location" heading and shifted every value one
column left — a table that reads as data rather than as a bug.

⚠️ **Two bugs here existed only in the COMPOSITION of separately-passing parts**, so
test the join, not just the pieces:
- `editGuard` blocked every `rows.N.cells` edit because `cells` is absent until the
  first column edit and `undefined → array` is a type flip. The header edit applied,
  all 21 value edits were dropped, and you got a correctly-placed **empty** column.
  Now `undefined → array` is allowed on `LENGTH_IS_CONTENT` paths only (array only —
  `undefined → string` is still blocked, and the first fix was too broad until a test
  caught it).
- `table.report` was `width: 100%`, so extra columns squeezed rather than overflowed
  and `.table-scroll`'s `overflow-x` had nothing to scroll. Now `min-width: 100%;
  width: max-content` — same look at 9 columns, scrolls past that (measured: 2801px
  table in a 1010px wrapper).

⚠️ The drawer reports what actually landed ("I filled 20 of 21 rows"). An empty or
partial column must never read as success — the model's `values` count varies run to
run, and silence there looks like the feature half-working.

### Dashes in prospect data: swept at the SOURCE
`generateProfile()` in `engine/core.ts` runs `sweepValue()` over the assembled
profile before the final Zod parse, so the CLI, the dev endpoint, the prod
endpoint and the library publish ALL get clean data with nobody remembering a
script. `NO_DASH_RULE` in the prompt asks; this makes sure — the same
instruct-then-enforce pairing as `stripDashes` for the live agents' replies.
Prompt-only was not enough: the two most recently generated prospects arrived
with 24 dash-joined clauses between them and were only caught weeks later by
running `scripts/strip-dashes.ts` by hand, after both had been demoed.

One rule set in `engine/dashSweep.ts`, used by three callers (generation, the boot
migration, the script) so they cannot drift. **Em dashes are NOT banned outright,
only in prose** — audited across all 11 profiles: every remaining em dash is a
lone `—` table placeholder meaning "no value", which is real Invoca UI. Kept by
design: placeholders, compound words ("Certified Pre-Owned", "Tempur-Pedic"),
numeric ranges, and anything under a `dateRange`/`url`/`id`-style key
("Jan 1, 2026 - Jan 31, 2026" must keep its dash).
`npx tsx scripts/strip-dashes.ts --dry` re-audits at any time.

### ⚠️ Any server-side write to a demo MUST bump `updatedAt`
`DemoLibraryContext`'s self-heal only refetches when the library's `updatedAt` is
newer than the copy the browser cached. Both boot migrations
(`engine/dashSweep.ts`, `engine/demoPatches.ts`) wrote the file with a raw
`fs.writeFileSync` and left `updatedAt` alone, which made **every server-side
migration invisible to the very mechanism added to catch them** — the server was
correct and each already-loaded browser kept rendering the old content forever.
That is the "Bill is still seeing the old conversation" failure, and its real root
cause: the self-heal could never fire because nothing moved the timestamp it
watches. Both now bump it. If you add another writer, bump it too.
Note the boot migrations run in **`server.ts` only** — the Vite dev server does
not, so a local `.data` is only migrated once you actually run the prod entry.

**Ownership** (server-enforced — the frontend lock is convenience only):
- Anyone signed in can **list and view** every demo.
- Only the **creator** can PATCH/DELETE theirs (others get a 403 telling them to duplicate).
- Anyone can **duplicate** someone else's → a copy owned by them, named
  `<prospect> (copy)` (both `prospect` and `profile.customerName`) so the library and
  the customer switcher never show two identical entries.
- **PROJECT ADMINS can PATCH/DELETE every demo.** `ADMINS` in `engine/demoApi.ts`
  (currently `ddesai@invoca.com`) **plus** anything in the `DEMO_ADMIN_EMAILS` env
  var, comma separated. The env var is **additive on purpose**: replacing the list
  would mean `DEMO_ADMIN_EMAILS=bill@invoca.com`, meant as "Bill too", silently
  strips the project admin of access — the exact problem admin exists to fix. Read
  at module load, so adding an admin on Render needs a **restart, not a redeploy**.
  `owns()` and `isAdmin()` combine in ONE `canWrite()` helper so PATCH and DELETE
  can't drift apart.
  - **Admin is not ownership.** An admin write never reassigns `creator`; it sets
    `updatedBy` instead, so the library still shows whose demo it is, the owner
    keeps their rights, and the Launch row shows "· edited by <name>" when an
    admin last touched it. That audit line is the counterpart to the extra power.
  - The frontend gets `admin` from `GET /api/me` and `GET /api/demos` (the SERVER
    decides — a client that lied would just collect 403s). `useDemoLibrary()`
    exposes `admin` + `canManage(d)`; the Ask AI edit layer needed no change
    because it already keys off the server's `canEdit`.
  - Deleting someone else's demo is the one irreversible thing admin unlocks, so
    the confirm dialog names the owner ("It belongs to A Colleague, and you are
    deleting it as an admin").
  - ⚠️ Off-gate local dev is `local@dev`, which is NOT an admin, so the admin path
    cannot be exercised locally without temporarily adding it to `ADMINS`
    (`.claude/launch.json` does NOT pass env vars through — verified).

Identity comes from the Google sign-in gate (`googleAuth.ts` → `currentUser(req)`,
`@invoca.com` only); off-gate local dev is `Local Dev <local@dev>`.

Frontend: `src/data/DemoLibraryContext.tsx` (`useDemoLibrary()`). If the API is
unreachable it sets `available=false` and the app falls back to the local/bundled
profiles it always used. The **Launch screen** renders library demos + any local-only
profiles in one list: creator shown per row ("You" in blue, else their name), search
matches **prospect / industry / creator name / creator email**, others' demos get a
**Duplicate** button, only yours get **Delete**, and local-only demos get a **Publish**
(`cloud_upload`) button that pushes them to the library. A freshly generated prospect
is published automatically.

**AI edits are per-demo and persist server-side.** `AiAssistantContext.hydrateDemo(id,
customizations, canEdit, creator)` loads a demo's saved AI layer into the store (server
keys are bare pathnames like `/dashboards/marketing`; the store prefixes them
`<demoId>::<path>`), and an effect saves the active demo's slice back via PATCH,
**debounced 800ms**, owner-only, guarded by `lastSyncedRef` so loading doesn't
immediately re-save. On someone else's demo `readOnly` is true: `mutate`/`applyEdits`/
`undo` no-op, and the Ask AI drawer shows a "view only" banner and declines any
create/editData/editTile result.

### Ask AI + Undo on EVERY page (top bar, hover-revealed)
`TopBar.tsx` carries a sparkle (`auto_awesome`) and an undo, immediately left of
the star. They **always occupy their layout space and only fade opacity**, which
is what makes an invisible zone hoverable — `display:none`/`width:0` would leave
nothing to aim at. Revealed on hover of `.tb-ai` and on `:focus-visible`, so they
are not mouse-only, and absent from screenshots and live demos.

Scope key is `${profileId}::${pathname}` — the SAME key the dashboards already
used — so **nothing is dashboard-specific: a new screen gets both for free** by
calling `usePageData(profile.reports.<slice>)` (an alias of `useDashboardData`;
the six dashboards keep the old name). Opted in so far: digital-insights, the
three CI reports, Call Review, Call Detail, agent config / knowledge / AI
recommendations, Signal, and the Insights dashboard.

The three rules, and where each is actually enforced:
1. **Never spills to another page** — structural. Overrides are stored per page
   key and only read back by that page. Verified: editing revenue on
   `/dashboards/marketing` and a heading on `/insights/dashboard/...` produced TWO
   separate override keys and TWO separate undo stacks.
   ⚠️ **The guard that makes this true is in `AiAssistantDrawer`**:
   `registerScope` is only called by screens that HAVE data and **nothing clears
   it on navigation**, so `active` can still point at the last such screen. The
   drawer therefore honours the scope ONLY when `active.key === ${profileId}::${pathname}`,
   and otherwise treats the page as having nothing to edit. Without that check,
   the top-bar sparkle on a list page would silently edit the dashboard you were
   on two clicks ago — an invisible cross-page spill. Keep it.
2. **Never CSS/design/template** — enforced three ways, not one:
   - **CSS is structurally impossible.** No data value reaches a `className` or a
     `style` attribute (the few data-driven classNames are boolean toggles between
     states the designer already built), and nothing renders data as raw HTML —
     the single `dangerouslySetInnerHTML` is a hardcoded SVG in a no-props
     component. Verified by grep, not assumed.
   - **The prompt declines it** — "make the titles bigger and the background
     navy" was refused, no override written, computed style unchanged.
   - **`src/data/editGuard.ts` blocks SHAPE changes in code** (`applyEdits`).
     ⚠️ This was prompt-only and is the one real hole the audit found: the model
     was told not to change array lengths or value types, and `applyEdits` applied
     whatever came back. Array length **is** layout — `gridTemplateColumns:
     repeat(${tiles.length}, 1fr)` on the AI Messaging cards, a table's row count,
     a chart's series and legend — so "add a series" was a template change wearing
     a data costume, and a type flip (string → array) breaks the component. Both
     are now dropped with a `[ai]` console warning. 12 unit cases cover it: same
     length reshape allowed, add/remove/row-delete/type-flip blocked, null ↔ value
     allowed (a legitimate data state). Same instruct-then-enforce pairing the dash
     rule needed.
3. **Data only** (metrics, titles, names, signals) — that is what `editData` does.

**Undo is per page**, so it can never change a screen you are not looking at. It
greys out (opacity .38, still revealed on hover so its absence never reads as the
feature missing) when the current page's stack is empty.

### The workflow diagram is DATA — the AI can reshape it
`components/WorkflowTree.tsx` is ONE renderer for every Agent Studio flow diagram.
It replaced four hand-positioned trees (SMS, Voice, the National Van Lines split,
and the extra-workflow tree), each of which carried its own node coordinates and
SVG line endpoints — which is why adding a branch used to mean writing a new
component: **the geometry WAS the code**.

Now the **layout is computed** from the model: every leaf takes a column, a branch
centres over its own leaves, the connector bus spans only the outermost branches,
and a second fork appears when a branch has more than one leaf. So "add a branch",
"remove that path" and "split this into two teams" all just work.

`deriveTree(profile, isSms, channelLabel)` reproduces what the old trees rendered,
from `voiceCopy` — no schema change and no engine phase, so every prospect on disk
gets an editable diagram. `SHAPE` holds per-prospect shape defaults (National Van
Lines' two-team split, previously a 100-line component, is now a branch with two
leaves). `extraTree` maps an extra workflow's flatter branches onto the same model.

⚠️ **`editGuard` lets `branches`/`leaves`/`chips` change length.** On a workflow
screen the tree's shape IS the content, so that exemption is deliberate — and it is
only safe BECAUSE the layout is computed: a new branch positions itself and draws
its own connectors instead of landing on top of something. Chart series and table
rows are still blocked. Node styling, sizes, colours and the icon set are not data
and remain out of reach, so rule 2 still holds.

⚠️ **Tile creation is now dashboard-only** (`canCreateTiles` from the drawer,
`pathname.startsWith("/dashboards/")`). Asked to "add a third branch", the model
first answered by creating a KPI TILE — which a workflow page never renders, so it
reported success and nothing appeared. When the flag is false the prompt forbids
`kind:"create"` and requires an `editData` edit that appends to the right list.

⚠️ **Connector endpoints are MEASURED from the nodes, never offsets.** They used to
leave a node at `top + 54` (trigger/start) and `top + 108` (intent), and both were
wrong — which surfaced as two bugs that looked unrelated:
- **SMS** intent nodes are 43px and 64px tall (the title "Existing Customer Support"
  wraps, "Consultation" does not), so real bottoms are 283/304 — but the line was
  drawn `348 → 344`. **A 4px line pointing UPWARDS: no connector visible at all.**
- **Voice** nodes are taller and the leaf row lower, so the same `+108` gave a
  correctly-directed line that **started ~24px BELOW the node** — a stub floating in
  space, attached to nothing.

A hardcoded height cannot survive text that wraps, a re-skinned label, or the AI
renaming a node — all of which this component exists to support. Each node now
reports its own `offsetHeight` (layout effect for the first paint and model changes,
plus a `ResizeObserver` for a later reflow that changes no prop), and every branch
uses ITS OWN intent height. `offsetHeight` is the layout box, so the wrapper's
`transform: scale()` doesn't distort it. `FALLBACK` covers only the frame before the
first measurement. Verified on all three shapes: SMS `283/304 → 344`, Voice
`428/446 → 528`, and the National Van Lines split `428 → 470` sub-bus → two
`470 → 528` drops — zero gaps at the nodes, no inverted lines.

⚠️ `.wf-canvas` has `padding-bottom: 136px` so the zoom cluster (`bottom: 16px`,
104px tall) can never be overlapped by a tall tree. That replaced a per-tree
`min-height` override which only fixed the one hand-built tree it was written for.

### Preview Workflow (SMS): the chat drawer that tests the same agent
`components/WorkflowChatPreview.tsx`. On an SMS workflow page **Preview Workflow**
slides in a right-side chat drawer — the SMS counterpart to the Voice page's
call drawer. Before this the SMS button rendered and **did nothing** (`onClick`
was `if (!isSms) …`).

Matched to the real page (network 1847 `/ai_agents/edit/25/workflow/114`) from a
SingleFile capture. It is an **embedded chat widget**, not a platform component, so
its own stylesheet is the source of truth and the values are MEASURED:
`.cloud{width:400px}` → 400px panel · header `h-[50px]` `rgb(231,233,235)` on
`rgb(21,36,62)`, 6px top radius · host bubble white / guest bubble
`rgb(231,233,235)`, both 6px radius, 16px, `px-4 py-2` · rows carry a 50px margin
on the opposite side so a long line never spans the full width · textarea
min-height 56px / max 128px, placeholder "Type your question" · footer
`Last Updated: <date>` 13px `rgb(48,50,53)`. Header title is
`Preview Workflow - <workflow> (Draft)`, with the capture's tabler-refresh
**Reset Chat** and a close X. Positioned like its sibling `.vp-drawer`.

⚠️ **It tests the SAME agent as the Preview Agent screen.** Both build their brain
from `buildSmsBrain()` in **`src/data/smsBrain.ts`** (which also owns
`askSmsAgent()` — the `/api/chat` call, its transient-failure backoff, and the
markdown strip), so the questions, order and rules are identical **by
construction**. Two local copies of that object would drift on the first edit, and
an SE who tunes questions on one screen and sees different behaviour on the other
has been shown a lie. Verified live: asked "i need a home insurance quote", the
drawer replied with Goosehead's configured question 1 **verbatim**.

⚠️ **It must NEVER call `usePageData`.** The workflow page has already registered
its DIAGRAM as the AI scope and `registerScope` is last-write-wins, so a second
registration here would silently repoint that page's sparkle from the tree to the
agent config — killing "add a branch" with no visible cause. It reads the Preview
Agent page's EFFECTIVE config via `effectiveData(`${profileId}::${SMS_AGENT_SCOPE_PATH}`)`,
which registers nothing and still picks up edits made over there (right behaviour:
two views of one agent). Verified: with the drawer open, the Ask AI drawer's scope
still reads "…- SMS workflow".

⚠️ It deliberately does **not** capture to the SMS Conversation Intelligence
report. The iPhone Preview Agent does that and it is the demo's headline move; a
second capture source would file the same conversation twice. This drawer is a test
bench, not a demo beat.

### Preview Agent: the AI sets exactly what the phone asks
The sparkle + undo sit **top-LEFT** on `/agent-studio/agent/preview` — that route
renders outside the app shell, so there is no top bar to hang them on. Same
hover-to-reveal contract (`.pp-ai` reuses `.tb-ai-btn`), and `SmsPreviewPage`
renders `<AiAssistantDrawer />` itself, because AppShell only renders it for
in-shell screens and without that the sparkle opens nothing.

**The edit reaches the LIVE agent**: `useBrain` in `PhonePreview.tsx` reads the
EFFECTIVE agent config via `usePageData`, not `profile.reports.agentConfig`, so
"ask for the ZIP code first" changes the very next reply rather than being a note
in a panel. Scope key is the usual `<profileId>::<pathname>`, so these edits and
their undo stack belong to this page alone.

Two things had to change for "exactly what questions" to be literally true:
- **`editGuard` lets question lists change length.** The array-length rule exists
  because length drives layout, but a list of questions is content — "ask three
  instead of five" is a data change, and blocking it made the feature useless.
  `LENGTH_IS_CONTENT` matches the edit PATH so the exemption stays narrow; chart
  series and table rows are still blocked.
- **`engine/chat.ts` numbers the questions and forbids reordering.** They used to
  be a bullet list under "adapt naturally to what the customer says", which read
  as a menu: asked for ZIP → service → timing, the agent skipped straight to the
  second question. Now numbered, with "IN THIS EXACT ORDER, do not skip, do not
  reorder, do not add your own". Verified live: it asks the ZIP first, verbatim.
  ⚠️ Node-cached — restart the dev server after editing that prompt.

**Headings that were literals are now DATA** — `usePageDataWithLabels(base, LABELS)`
folds a screen's `LABELS` constant into the object registered as the page scope, so
the assistant sees them at `labels.<key>`, edits store under the page key like any
other, and undo covers them. No schema change and no engine phase, so every
prospect already on disk gets it. Used by `InsightsDashboard` (all 13 headings and
metric labels) and `MarketingDashboard` ("Sales Call Breakout Graph"). The final
spread means an override saved before a label key existed falls back to the default
instead of rendering `undefined`.

⚠️ **A literal heading is worse than a missing feature**: the assistant accepts
"rename this to X", writes the edit, and the screen does not budge — a silent
no-op. If you add a heading a user might want renamed, put it in that screen's
LABELS, not in the JSX.

**What deliberately STAYS hardcoded** (audited: 334 user-visible literals across
the screens, and these are the right ones to leave): Invoca's own product
vocabulary — page names ("Call Review", "Agent Studio"), filter labels ("Filters",
"Speaker", "Sort By:"), Call Detail rail sections ("SCORECARDS", "TRANSCRIPT"),
table headers ("Name", "Shared Status"), ThoughtSpot footers ("UNIQUE COUNT",
"TOTAL"), the dimension columns ("Marketing Source"), and workflow node labels
("Triggered by"). Plus third-party chrome on the Google and ChatGPT screens, and
the Launch screen (our tool, not the demo). That is the template, and rule 2 keeps
the AI out of it. The six platform dashboards were already fully data-driven.

## Launch screen & live generation (the front door)
`/` and `/launch` render `src/screens/Launch.tsx` (full-page, outside the AppShell).
An SE enters a prospect **name + URL** → **Launch** → the app POSTs to
`/api/generate`, which **streams progress back as Server-Sent Events**. The Launch
screen renders a **live build checklist** (all 16 pieces — research, report, each
dashboard, Call Review/Detail, the CI reports, Agent config, artifacts) that flips
each item pending → building (spinner) → ✓ as the engine emits `{phase,status}`
events, plus a weighted **% bar** (research+report weighted 10/6 vs 1 since they're the
long sequential prefix; the currently-building phase's contribution also eases up
**asymptotically over time** via a 0.5s tick + `RAMP_MS`, so the bar always creeps
and never looks frozen — critical because for big sites research alone can run
~4-5 min and would otherwise sit flat). On the final `{type:"done",profile}` event it validates +
routes into the platform re-skinned to that prospect. `BUILD_STEPS` in `Launch.tsx`
maps engine phase keys → friendly labels; the frontend reads the SSE stream via
`res.body.getReader()` (splitting on `\n\n`). Opening a prospect (fresh generation OR one-click
revisit) lands on the **Marketing Performance dashboard** (`/dashboards/marketing`)
— the demo's start screen; change the `LANDING` const in `Launch.tsx` to move it.
The screen also has a **"Your prospects" searchable dropdown** (all known customers,
filter by name/industry) for instant one-click revisit — no regeneration/API cost.
Generated prospects show a **delete** (trash) icon → a **confirm modal** ("are you
sure") → `removeProfile(id)` (state + localStorage + the on-disk JSON via
`POST /api/delete-profile`, so it doesn't reload on restart). Seed profiles
(`SEED_IDS` in `profiles.ts`, e.g. Shady Blinds) are code-defined and show NO delete.

Flow of the pieces:
- **`engine/core.ts`** — `generateProfile(name, url, {apiKey})` is the reusable
  research→report→dashboard→callReview→callDetail→opsDashboard→aiAgentConversion→
  aiMessagingImpact→conversationIntelligence→smsConversationIntelligence→
  voiceConversationIntelligence→agentConfig→qualityManagement→qmInstantInsights→signalManager→screenpops→voiceRoutingDemo pipeline
  (17 phases; returns a validated `CustomerProfile` with report, six dashboards,
  Call Review, Conversation Intelligence, the SMS + Voice conversation reports, and
  the Agent Studio config per prospect).
  `engine/generate.ts` (the CLI) and the dev endpoint both call it.
  ⚠️ `structured()` MUST use streaming (`messages.stream().finalMessage()`) — the SDK
  throws on any non-streaming call it estimates could exceed 10 min (large max_tokens),
  which was silently failing every generation at the ops phase. The SMS-conversation
  phase uses the FAST model (Haiku) via `structured(..., FAST_MODEL)`.
  ⚡ **Perf: <=3min (optimized 2026-07-22).** Critical path = `research()` → `generateTerms()`
  (tiny, fast) → a **concurrency-limited pool of 16 phases**. Key wins, in order of impact:
  (1) **`report` split**: the old `generateReport` blocked the pool for ~50s to hand off 6
  short strings. Now `generateTerms()` (schema = just the 6 identity/canonical terms, max_tokens
  1200) runs in the prefix (~15s), and the heavy 18-24-row Digital Insights table is
  `generateDigitalInsights()` — a normal **pool phase** (nothing reads `digitalInsights` until
  final assembly, so no race; bookingTerm is threaded in for its signalColumns). (2)
  **`runPool(tasks, CONCURRENCY=6)`** ordered **longest-processing-time first (LPT)** so a heavy
  Opus phase never starts late and tails the makespan. (3) **`research()` trimmed**: web_fetch
  5→3, web_search 5→2, pause_turn loop 6→4, + a "prioritize homepage/key pages, stop early" hint
  — this is the ONLY lever for big multi-page sites (research dominated their time). `runPool`
  preserves tuple types (`| []` trick). `phase(label,run)` retries **ONCE on ANY rejection**
  (rescues a one-off malformed-JSON/Zod failure — do NOT restrict to transient codes) with a
  small random start-jitter to soften the 6-wide burst, and logs `[phase] <name>: <s>s`.
  **Measured: Continuing Life 217s→159s; Orlando Health (large site) ~360s→~123s — both under
  3min, quality intact (17 report sections, rich re-skinned data, consistent terminology).**
  To add a phase: append a `() => phase(...)` thunk to the `runPool` array (place it by expected
  duration for LPT), add a slot to the destructure, and add it to the `reports:{}` assembly.
  ⚡ **The Marketing Performance dashboard is THREE phases, not one (split 2026-07-30).**
  As one call it WAS the makespan: **180s of a 258s generation**, with all fifteen other
  phases idle behind it (measured on Roto-Rooter). It is the biggest output in the
  pipeline — 3 KPI groups, SIX breakdowns of 5 rows × 4 metric columns (120 cells) and
  two multi-series charts — and `effort:"high"` had to hold every arithmetic rule in
  `scaleRules()` across all of it in one pass. Now:
  `dashboard` (KPI tiles + the breakout line chart that rolls up into them) ·
  `dashboardChannels` (Source/Medium/Campaign/Search Term) ·
  `dashboardSegments` (Product Category + the chart plotting the SAME categories, + Region).
  ⚠️ **This is only safe because the numbers are pinned BEFORE the pool starts.**
  `buildScale()` fixes total calls, revenue, won sales, bookings and answer rate, and
  `scaleRules()` hands the SAME figures to every phase, so the three pieces agree by
  construction rather than by luck. **If you ever make a dashboard number depend on
  another phase's OUTPUT instead of on `Scale`, these have to merge back.** The split
  also follows the real internal dependencies, so nothing that must match is separated.
  ⚠️ `breakdowns` is **order-sensitive, in two different ways**. `MarketingDashboard`
  splits the array **by flag**: `filter(hasDonut)` renders the donut+table tiles in
  **array order**, and `find(!hasDonut)` pulls the single Product Category one out to sit
  beside `productCategoryGraph` — so on screen the donut sequence reads Source, Medium,
  Campaign, Search Term, **Region**, with Product Category in its own section further
  down, even though the array holds it fifth. Separately, `prospectPlace.derive()` and
  `google-ads-demo.js` look rows up **by title**. `assembleDashboard()` rebuilds the
  canonical array order (Source, Medium, Campaign, Search Term, Product Category, Region)
  and matches the four channel breakdowns **by title** so a model that reorders its own
  array still lands them right. Do not append.
  Round-trip tested against all 9 real dashboards on disk: cut each into the three
  slices, reassemble, byte-identical — plus a shuffled-array case.
  ⚠️ A new phase key must also be added to **`BUILD_STEPS` in `Launch.tsx`** or its
  progress is invisible on the live build checklist (and its weight missing from the bar).
  ⚠️ **Model param support:** `thinking:{type:"adaptive"}` and `output_config.effort`
  are **Opus-only** — `structured()` gates BOTH to `MODEL`; Haiku (FAST_MODEL) 400s on
  either. Strict structured-output schemas can't use `z.record()` (→ `additionalProperties`
  object); use a positional array instead (see `VrdTurn.q`).
  ⚠️ **Engine IS now type-checked:** `tsconfig.node.json` includes `engine` (it didn't
  before — that's how a missing `CallDetailView` import + these param bugs went unnoticed;
  no full generation had been run in a while). Run BOTH `tsc -p tsconfig.app.json` and
  `-p tsconfig.node.json`.
- **`/api/generate`** — a Vite dev-server plugin in `vite.config.ts`
  (`configureServer`). **Streams Server-Sent Events** (`text/event-stream`): a
  `{type:"progress",phase,status}` event for every phase start/done (fed by
  `generateProfile`'s `onProgress` callback → `Progress` type `{phase,status}`),
  then sends the final `{type:"done",profile}` (or `{type:"error",error}`) and ONLY
  THEN writes `src/data/generated/<slug>.json` (write-after-done, in its own try/catch,
  so a disk error can't discard a profile the user waited minutes for). Reads the key via `loadEnv`. NOTE: this is a **dev-only**
  endpoint; hosting the app for real would need a proper backend/serverless fn.
  The plugin unwatches `src/data/generated` so writing a file mid-demo doesn't
  trigger a page reload.
- **`/api/chat`** — sibling Vite dev-server plugin. `POST { brain, messages, voice? }` →
  `engine/chat.ts` `chatReply()` (fast **Haiku** model) → `{ reply }`. Powers BOTH
  the Agent Studio **Preview Agent** iPhone SMS chat (`PhonePreview.tsx`) and, with
  `voice: true`, the live **Voice-agent phone call** (`VoiceCall.tsx`). The two
  channels are DIFFERENT use cases and `buildSystem(brain, voice)` branches
  accordingly: **SMS = sales** (qualify → quote → book a consultation, from the
  `smsPlaybook`); **Voice = qualify-and-ROUTE** (`buildVoiceSystem` — two paths,
  new-order vs existing/support, never sells/quotes/resolves, hands off to a team).
  The `brain` is built client-side from the active profile's `agentConfig` (same
  brand rules/knowledge feed both). Key stays server-side. NOTE: `engine/chat.ts` is dynamically
  imported and Node-cached, so editing its prompt needs a dev-server restart to
  take effect (the client also strips markdown as a safety net). Same caching
  caveat for `engine/analyze.ts` and `engine/core.ts` — restart after editing.
- **`/api/analyze`** — sibling plugin. `POST { customerName, bookingTerm, customerNoun,
  channel?, transcript }` → `engine/analyze.ts` `analyzeSms()` (fast Haiku) → `{ signals }`.
  Called when the SE ends a Preview Agent session, to extract the captured
  conversation's Analysis signals. Shared by BOTH the SMS chat and the Voice call;
  `channel` (`"sms"`|`"voice"`) only tunes the prompt wording.
- **`/api/ai-assistant`** — sibling plugin. `POST { customerName, dashboardTitle,
  dataContext, question, focus, history }` → `engine/assistant.ts` `askAssistant()`
  (fast Haiku, `output_config.json_schema`, max_tokens 8000) → `{ result }`. Powers
  the **"Ask AI"** drawer on every dashboard. `focus` scopes it (whole dashboard vs
  one tile). `result.kind` is one of: `"answer"` (text / scenario suggestions),
  `"create"` (a new tile spec — `tileType` kpi/line/bar/pie), `"editData"` (path
  edits `[{path,value}]` into the dashboard DATA — value is JSON-encoded; paths use
  dot OR bracket notation), or `"editTile"` (replacement spec for a focused
  generated tile). **DATA-ONLY**: the prompt forbids structural/CSS/layout/color
  changes and array-length changes (edits target scalar leaves or same-length chart
  series); styling requests are declined. All numbers come strictly from
  `dataContext`. Same Node-cache caveat — restart the dev server after editing
  `engine/assistant.ts`.
- **`/api/tts`** — sibling plugin. `POST { text, voiceId? }` → **audio/mpeg** (MP3)
  bytes from the configured provider (`engine/tts.ts`, key server-side). Powers the
  premium human voice on the live Voice call. **Two providers**: **Deepgram Aura**
  (`DEEPGRAM_API_KEY`, optional `DEEPGRAM_MODEL`) and **ElevenLabs**
  (`ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID` / `ELEVENLABS_MODEL_ID`).
  Provider is chosen by `TTS_PROVIDER` (`deepgram`|`elevenlabs`), else auto:
  Deepgram if its key is set, else ElevenLabs. Returns a JSON error (501 when the
  chosen provider's key is missing) so `VoiceCall.tsx` falls back to the browser
  voice. Same Node-cache caveat — restart the dev server after editing `engine/tts.ts`.
- **`SmsCaptureContext`** (`src/data/SmsCaptureContext.tsx`) — session store of
  Preview-Agent-captured SMS conversations, keyed by prospect id, **persisted to
  localStorage** (`invoca-demo:sms-captures`) with a **7-day TTL** (pruned on load,
  capped 25/prospect). `addCaptured` prepends; `patchCaptured` fills in signals.
  The SMS report merges these (newest first) ahead of the seed conversations.
- **`VoiceCaptureContext`** (`src/data/VoiceCaptureContext.tsx`) — identical sibling
  for captured **voice calls** (`invoca-demo:voice-captures`, 7-day TTL, capped 25).
  Ending a Preview-Agent voice call prepends the call here; the AI Voice
  Conversation Intelligence report merges these ahead of its seed.
- **`ProfileContext`** holds the customer list in state with `addProfile()`, and
  **persists to localStorage** (`invoca-demo:profiles` + `:activeId`) so generated
  customers and the active selection survive a browser refresh. Durable record is
  still the JSON files (picked up by the `import.meta.glob` in `profiles.ts` on the
  next dev-server start). TopBar's network switcher + the Launch list read from context.
- Known nit: seed `mavis` + generated `mavis-tires-and-brakes` show as two
  "Invoca for Automotive" entries — de-dupe later if it bothers a live demo.

## Core architecture
1. **Canonical customer profile** — `src/data/schema.ts` defines a Zod
   `CustomerProfile` (identity + `reports.digitalInsights` + `reports.marketingDashboard`).
   This is the single source of truth; every screen reads a slice of it, so a
   customer's data is consistent across all screens. Zod gives runtime validation
   (guards AI output) + derived TS types.
2. **Profile-driven screens** — read the active profile via `useProfile()`
   (`src/data/ProfileContext.tsx`). The **top-bar network selector doubles as the
   customer switcher** — pick a customer and the whole app re-skins.
3. **Generation engine** — `engine/generate.ts`: URL → researches the site
   (web_fetch/web_search) → generates data constrained to the schema
   (structured outputs) → Zod-validates → writes `src/data/generated/<slug>.json`,
   which the app **auto-loads** via `import.meta.glob` and adds to the switcher.
4. **Exact-copy static pages** — some screens must look EXACTLY like a real page
   and are identical for every customer (marketing/console pages). These are saved
   real HTML served from `public/*.html` (see below), not React rebuilds.

## File map
```
src/
  tokens/tokens.css        Design tokens (measured Invoca colors/type) + fonts (Lato/Material Icons, bundled in public/fonts)
  styles/app.css           App component + layout styles
  styles/standalone.css    (mostly legacy; the exact-copy pages carry their own CSS)
  data/
    schema.ts              Zod CustomerProfile + DashboardView + GenerationOutput + types  ← EXTEND HERE for new screens
                             (DigitalInsightsReport now has dimensionColumns + signalColumns;
                              InteractionRow = 6 dimension fields + signals:boolean[] aligned to signalColumns)
    ProfileContext.tsx     useProfile() + ProfileProvider (active customer)
    profiles.ts            Registry: seed profiles + import.meta.glob('./generated/*.json')
    profiles/shadyBlinds.ts   Seed profile (real captured data) — the reference customer
    profiles/mavis.ts         Seed profile (hand-authored auto-service analog)
    generated/*.json          Engine output (auto-loaded, Zod-validated on load; INVALID/old-schema files are skipped with a readable console warning, NOT fatal — one stale file can't crash the app)
  components/              Sidebar, TopBar, Pill, Card, BarChart, DonutChart, LineChart, StackedBarChart, DataTable, nav.tsx (NAV config + exact SVG icons: ProfilesIcon/CallReviewIcon/AgentStudioIcon/LeadFormsIcon), DashHeaderActions + DashTileMenu (shared dashboard actions; the AI sparkle — DashTileAi/DashTileToggle put it on EVERY tile incl. charts — opens the Ask AI drawer), AiAssistantDrawer + GeneratedTiles (DashAssistant + useDashboardData hook) + DashboardBoundary (the Ask AI feature: chat, data edits, undo, error safety net)
  screens/
    DigitalInsights.tsx     "Digital Journey & Call Attribution Report" (chart + interactions table w/ dimension + signal columns)
    CallReview.tsx          Call Review list: filters panel + call cards (score % / AI summary / meta + 3 stats: scorecards ✓, comments 💬, negative-sentiment 😠 red). Reads reports.callReview (optional). The **Signals** filter is INTERACTIVE: clicking it opens a two-panel modal (`.sig-*`) — 10-signal list (only the top, `${bookingTerm}: Scheduled`, is active) × Yes/No/Not Applied checkboxes; Apply → removable pill in the field + live-filters the list off each call's `converted` flag (fallback: `didConvert()` keyword heuristic). **Global Transcript Search** is also live: a substring match over each call's summary (the per-call transcript-derived text we have) with matched terms highlighted (`Highlight` / `.cr-hl`) and count updating; composes (AND) with the Signals filter. The input's **placeholder** shows 3 per-prospect example terms (`i.e. term1, term2, term3`) so the SE never has to guess what to type for a new prospect: curated `reports.callReview.searchSuggestions` (engine-generated, each present in ≥2 summaries) validated against the real summaries, with a client-side `extractTerms()` fallback (top doc-frequency words) for older profiles. Both filters **reset on prospect switch** (`useEffect` on `profile.id`) so a stale term never strands the list on 0 Calls. 4th call drills into Call Detail (tracked by object ref so it survives filtering).
    ManageDashboards.tsx    Dashboards landing = a list of dashboards (Name/Shared Status/Owned By/Last Modified); click a name → that dashboard. Add a row here per new dashboard.
    MarketingDashboard.tsx  Marketing Performance Dashboard (KPI groups, donut+table breakdowns, line + stacked charts)
    MarketingOpsDashboard.tsx  "Marketing & Operations Performance with Revenue" dashboard (reuses dashboard-1 CSS + HBarChart + StackedBarChart). Adapt: to add a 3rd dashboard, add a schema view + shadyBlinds data + a screen + a route + a ManageDashboards row + an engine phase.
    Placeholder.tsx         Fallback for nav items not yet built
  layout/AppShell.tsx     Sidebar + TopBar + <Outlet>
  App.tsx                 Router: in-shell routes for built screens/placeholders; standalone routes for exact-copy pages
engine/
  generate.ts             The generation engine (3 phases: research → report → dashboard)
  README.md               How to run the engine
public/
  invoca-exchange.html    EXACT copy of invoca.com/integrations (+ "Integrations and Apps _ Invoca_files/" assets)
  google-ads.html         EXACT copy of the Shady Blinds Google Ads "Search Keywords" console (+ its _files folder)
  logo.png, fonts/        Invoca logo + bundled Lato/Material Icons woff2
```

## Screens & their patterns
| Screen | Route | Pattern | Status |
|---|---|---|---|
| My Reports | `/reports` | Profile-driven (React) | ✅ landing page the **Reports** nav opens (Saved/Requested/Subscriptions tabs, search, paginated table). Lists the built reports; rows link to them. List is derived from `customerName` + which optional reports the profile has — no schema/engine change. `DigitalInsights` breadcrumb "My Reports" links back here. Also lists the 3 **Gumloop artifacts** (see below) as "AI Artifact" rows: the **Schedule Status** column shows a dash for complete artifacts (only Creating…/Failed render a label — "Complete" was intentionally removed), and a complete row **opens the artifact standalone in a NEW browser tab** (Blob URL, no platform chrome) via `openArtifact`. Table row borders live on the `<td>`s (the Name cell's flex is on an inner `<div>`, NOT the `<td>`, so all cell borders align); report-title links are `#2666f9` |
| Gumloop artifacts (Voice Screenpop / SMS Screenpop / Voice Routing Demo) | opened in a new tab from My Reports | Template (self-contained HTML) | ✅ 3 HTML "leave-behinds" originally from an external Gumloop agent. Since the Gumloop API key isn't available, they're **replicated in-house**: `src/artifacts/*` renders each from a typed data slice on the profile (`reports.voiceScreenpop` / `smsScreenpop` / `voiceRoutingDemo`) — the two screen pops share one shell (`screenpop.ts`; CTI agent-desktop with Invoca Pre-Call Intelligence, ringing→answer→active-call), the routing demo (`voiceRoutingDemo.ts`) is the animated live-call-routing (queues climb, signals detected, routed-outcome card). `renderArtifact(profile, id)` resolves id→HTML; `openArtifact` serves it via Blob URL in a new tab. `reports.gumloopArtifacts[]` carries the My Reports rows (id/name/status/createdAt; optional html/url for a future real Gumloop hookup). Sources: `reference/gumloop/*.html`. Gumloop API trigger is scaffolded in `.env.example` (`GUMLOOP_*`) for whenever the key exists, but not required |
| Digital Journey & Call Attribution report | `/reports/digital-insights` | Profile-driven (React) | ✅ built, swaps per customer — matched pixel-for-pixel to the live report (saved_report 52517). Opened from My Reports |
| Conversation Intelligence | `/reports/conversation-intelligence` | Profile-driven (React) | ✅ per-call analysis view (call details, network 2160). 3-col: call list / audio player + transcript (keyword highlights) / right rail with **interactive tabs**: **Analysis** (Signals + Call Scoring ring), **AI Summary** (AI recap of the selected call — paragraph + sentiment pill + outcome line + key-point bullets, from `aiSummary` which is `.optional()` so profiles predating it show a graceful "regenerate to include it" fallback), **Call Info** (call metadata from the selected call), plus Comments/Deliveries empty-state placeholders. `reports.conversationIntelligence` (optional); Shady Blinds hand-authored + engine generates it (incl. `aiSummary`, grounded in the transcript) per prospect. Opened from My Reports (2nd row, shown only when the profile has the data) |
| AI SMS Conversation Intelligence | `/reports/sms-conversation-intelligence` | Profile-driven (React) + **live capture** | ✅ SMS sibling of CI (network 2160 details). 3-col: conversation list / SMS transcript (Consumer person + AI-Agent purple sparkle) / tabs **Analysis** (signals) · **SMS Info** (4 metadata cards) · Comments. `reports.smsConversationIntelligence` (optional): **1 active example** (re-skinned, full transcript+signals+SMS Info) + **3 inactive shells** (id/time only, real-looking, non-clickable). **Headline feature:** closing the Agent Studio **Preview Agent** captures that chat via `SmsCaptureContext` and **prepends it as a new active conversation at the top** — captures accumulate (multiple stack) and **persist to localStorage with a 7-day TTL** (survive reloads for a week, then auto-expire; keyed per prospect, capped 25). Its Analysis signals are extracted fast via `POST /api/analyze` (Haiku) on close. Opened from My Reports (3rd row) |
| AI Voice Conversation Intelligence | `/reports/voice-conversation-intelligence` | Profile-driven (React) + **live capture** | ✅ Voice sibling of the SMS report — same 3-col layout (`VoiceConversationIntelligence.tsx`, reuses `.ci-`/`.sci-` styles): call list / spoken transcript / tabs **Analysis** (signals) · **Call Info** (call metadata cards: Call Record ID, Duration, Source, Connection Status, Consumer Data, Enhanced Caller Profile, Campaign Data) · Comments. `reports.voiceConversationIntelligence` (optional): **1 active example** (re-skinned) + **3 inactive shells**. **Headline feature:** ending the Agent Studio Voice **Preview** call (End Call, or drawer close mid-call) captures the call via `VoiceCaptureContext` and **prepends it as a new active call at the top** — accumulates + **persists to localStorage 7-day TTL**. Signals extracted via `POST /api/analyze` (channel `voice`) on end. Opened from My Reports (4th row) |
| Call Review | `/call-review` | Profile-driven (React) | ✅ built, matched to live (network 1750). `reports.callReview` is optional; Shady Blinds is hand-authored and the engine now generates it per prospect too. Customers without it (e.g. seed Mavis) show an empty state. The **4th call** (index 3) is always evaluated + 70s Quality Score and is **clickable → Call Detail**. The **Signals filter is live**: modal picks Yes/No/Not Applied on the conversion signal (`${bookingTerm}: Scheduled`) → pill + filters calls by each call's `converted` flag |
| Call Detail | `/call-review/detail` | Profile-driven (React) + interactive | ✅ drill-in from the 4th Call Review call (`CallDetail.tsx`, `reports.callDetail`, optional), matched to Invoca. 3 columns: left rail (Review Status checkbox, Evaluation select, **Scorecard** [click to expand → signal rows w/ met/unmet/na icons + points], **Signals** [click to expand → Met/Unmet/Not-Applicable groups, each expands to its signal list], Prompts accordions) · center transcript (search, Agent/Caller turns, "Estimated Conversation Start" divider, redacted PII shown as ****) · right AI Summary (agent/date/duration) + Comment. Sticky bottom audio bar. Re-skinned per prospect (a new-customer intake call); engine generates it |
| Agent Studio | `/agent-studio` | Profile-driven (React) | ✅ built, matched to live (network 2751 /ai_agents). One agent + two workflows (Voice + SMS) **derived from `customerName`** — no schema/engine change. Every row (agent + both workflows) links to the agent config editor |
| Agent configuration editor | `/agent-studio/agent` | Profile-driven (React) | ✅ the "Agent Settings" page opened from a workflow row (network 2751 /ai_agents/edit). Shared chrome in `AgentStudioLayout` (header + left sub-nav + sticky Cancel/Save/Publish footer); sub-nav icons match live MUI set (library_books/school/auto_awesome/transform). Agent Name/Brand = `customerName`, Profile = `networkName`; **Brand Conversation Rules** from `reports.agentConfig` (optional, engine-generated; component falls back to name-derived defaults). Sidebar keeps Agent Studio active (NavLink descendant match) |
| Knowledge Sources | `/agent-studio/agent/knowledge` | Profile-driven (React) | ✅ Agent Studio sub-page (uses `AgentStudioLayout`). Table of docs + main website links the agent learned from (Status/Name/Type/Last Updated/Refresh); search + Upload/Add-Web-Links buttons + pagination. From `reports.agentConfig.knowledgeSources` (optional; falls back to brand-domain-derived defaults), engine-generated per prospect. **Feeds the planned SMS agent's knowledge** |
| AI Recommendations | `/agent-studio/agent/recommendations` | Profile-driven (React) | ✅ Agent Studio sub-page (uses `AgentStudioLayout`). AI Q&A recommendation cards from call transcripts, each with an on/off toggle (interactive), sparkle+title (blue when on, grayed when off), updated date, and a truncated JSON payload. Clicking the **Qa pairs** card opens the **"Edit AI Generated Q&A" modal** — top ~20 {question,answer} pairs (`aiRecommendations[].qaPairs`), scrollable, Cancel/Done. From `reports.agentConfig.aiRecommendations` (optional; falls back to defaults), engine-generated per prospect. **Q&A pairs + intent follow-ups feed the planned SMS agent** |
| Agent Workflow (Definition) | `/agent-studio/agent/workflow/:channel` | Template (React) | ✅ Agent Studio sub-page (uses `AgentStudioLayout`); opened from a workflow in the left sub-nav or the Agent Studio table (voice/sms). Definition/Details tabs + Flow/Table toggle + dotted-canvas **flow diagram** (`AgentWorkflow.tsx`) — **channel-specific tree**: **SMS** (`FlowTree`) = Triggered by → Conversation Start → Sales Inquiry / Need Support → green "Schedule `<bookingTerm>`" leaf (chips Consumer Name/Interest) + orange "Support & Escalate" leaf, zoom + minimap. **Voice** (`VoiceFlowTree`) = the qualify-and-route tree, **matched to Invoca's real Voice workflow** (`agent-management-v2` HTML): **248px** nodes in two columns (48px gap), **exact MUI SVG icons** (Bolt/Chat/ShoppingCart/Headset/AltRoute, grey `#5b6577`), intent nodes carry caller-intent subtitles; green "**Inform & Route**" leaf (AltRoute icon, chips Room Type/Product Type/Timeline) + orange "**Support & Escalate**" leaf (chips Order Number/Order Issue), leaf-action colors from Invoca tokens (green `#0d7a3e` / orange `#b33b00`); "2 campaigns" trigger, taller canvas, minimap hidden. Buttons are **channel-specific**: **SMS** shows **Preview Agent** (filled, opens the iPhone chat) + **Preview Workflow**; **Voice** shows only **Preview Workflow**, which slides in a right-side **voice-preview drawer** (`VoicePreviewIllustration.tsx`: gray header bar, calls illustration, "Preview Your Voice Agent"; starts 20% down / 80% height, no dim). **Start Call** launches the live **Voice call** (`VoiceCall.tsx`) inside the drawer body; End/close returns to the empty state. Template; title/channel from profile + `:channel` |
| Preview Agent (live SMS chat) | **own browser tab** `/agent-studio/agent/preview` (opened via `window.open` from Agent Workflow's Preview Agent button; `SmsPreviewPage.tsx` → `PhonePreview.tsx` `mode="page"`, full-page dark `.phone-page` fixed inset:0, outside the app shell) | Profile-driven (React) + live AI | ✅ iPhone mockup where the SE role-plays a customer texting in; the SMS agent replies **live** via `POST /api/chat`. **Captured to the AI SMS Conversation Intelligence report PROGRESSIVELY** (not on close): a `useEffect` on `messages` upserts the conversation (stable `ConvBase` id/time/callerId per session) after every turn and debounces `POST /api/analyze` (1.2s) to fill signals — all while the tab is open, so nothing is lost when it closes and signals actually get generated (the old capture-on-close killed the analyze fetch). Because it runs in a SEPARATE tab, `SmsCaptureContext` writes localStorage **synchronously** and a **`storage` event listener syncs the report tab live** (no refresh). `PhonePreview` still supports `mode="modal"` (legacy) but the button opens the tab. (fast **Haiku** model, `engine/chat.ts`). System prompt built from the profile's agent brain (customerName, industry, `brandConversationRules`, Q&A `qaPairs`, knowledge-source names). Agent opens with a greeting, keeps SMS-short one-question-at-a-time, qualifies, and **confirms a day/time by text** (no booking card). Green outgoing / gray incoming bubbles, typing indicator, markdown stripped. Dev-only endpoint (key server-side, like `/api/generate`) |
| Voice Call (live phone call) | Start Call in the voice drawer (`VoiceCall.tsx`) | Profile-driven (React) + live AI | ✅ Realtime spoken call, **Claude stays the brain**. Ears = browser **SpeechRecognition** (STT); brain = Haiku via `POST /api/chat { voice: true }` — a **DIFFERENT prompt from SMS: qualify-and-ROUTE** (`buildVoiceSystem` in `engine/chat.ts`), NOT the SMS sales flow. Two paths: **new order** → **ZIP first** (serviceable-area gate, demo rule: only ZIP **`12345`** is out-of-area → apologize (naming `agentConfig.serviceArea`) + stop, no routing; **any other ZIP proceeds**; empty serviceArea = national business, no gate) → room → style → timeline → route (urgent = hot lead to a design consultant; browsing → browse support), and **existing order/support** → order number → issue type → route to the right team (delivery→fulfillment, installation→installation support, else→support). Never quotes prices/availability/promos, never resolves — only qualifies + hands off. mouth = **premium voice** (Deepgram Aura or ElevenLabs) via `POST /api/tts` (`engine/tts.ts`, key server-side) played through an `HTMLAudioElement`, with an automatic **fallback to the browser voice** when no provider key is set/errors (never silent). **Strictly turn-based** — the agent always finishes its turn before listening; the caller talking does NOT interrupt it (**barge-in off by default**, `ALLOW_BARGE_IN = false`; flip to re-enable talk-over via Web Audio VAD). Web Audio VAD stays on only to drive the listening mic meter. Turn state machine connecting→speaking→listening→thinking; all async work gated behind an `aliveRef` (StrictMode-safe). Call UI: purple AI-glyph avatar with speaking/listening pulse rings, status + call timer, live-captions transcript, ref-driven mic meter (via `--vc-level` CSS var, no re-renders), Mute + Keypad + red End controls. **On End Call** (or drawer close mid-call) the call is captured via `VoiceCaptureContext` and **prepended to the AI Voice Conversation Intelligence report** (transcript + call info instant; signals via `/api/analyze`). A **"type instead" fallback** shows when the mic is blocked/unsupported (and is how it's verified in the preview pane, which has no mic). Chrome/Edge only for real voice; STT no-ops silently elsewhere. Voice/model overridable via `ELEVENLABS_VOICE_ID` / `ELEVENLABS_MODEL_ID` (default model `eleven_multilingual_v2` — best/most human; use `eleven_turbo_v2_5`/`eleven_flash_v2_5` for lower latency) |
| Signal (Manage Signals) | `/signal` | Profile-driven (React) | ✅ matched to the real Invoca page (`reference/signal/manage-signals.html`, network 1847 `/manage_signals`). Two hero cards (Upload Signal Records / View API Documentation) over a MUI-DataGrid-style table. **Column widths come straight off the capture's inline styles** — checkbox 50 / Name 200 / Status 100 / five 123.8 columns / Rules 197 / Created At 150 / Last Updated 150 / Actions 123.8, header row 56px — so the columns land where the real ones do. `reports.signalManager` (optional): **10 signals covering three groups** — 3 CONVERSIONS (tagged "Conversion", one is `<bookingTerm> Booked (Conversion)`), 3–4 QUALITY (scorecard-backed), the rest PRODUCT / INTENT (product interest, price sensitivity, competitor named). `rules` holds REAL Signal syntax (`voice_signal = any(1, ["phrase (Agent)", …])`, `scorecard[Name] < 60 and duration > 45 sec`, `duration < 1 min`) with the spotted phrases re-skinned — that string is what makes the screen read as the product rather than a mock-up. **The single conversion row renders FIRST**, then the rest name-sorted like the real grid — a deliberate deviation (the real one is purely name-sorted) because a later screen drills into that row and it must not be buried. `SignalManager.tsx` re-applies the order at render, so a generated prospect leads with its conversion whatever order the model emitted. The Rules cell line-clamps to 4 lines (the real one ellipsises), which is what keeps row heights compact. Emotion's runtime CSS did NOT serialise into the saved page, so colours came from our tokens measured against the screenshot. Engine phase `signalManager` generates it per prospect |
| Manage Dashboards | `/dashboards` | Profile-driven (React) | ✅ list page the Dashboards nav lands on; one row per built dashboard (add rows in `ManageDashboards.tsx` as more are built) |
| Marketing Performance Dashboard | `/dashboards/marketing` | Profile-driven (React) | ✅ built, swaps per customer; opened from the Manage Dashboards list |
| Marketing & Operations Performance | `/dashboards/marketing-ops` | Profile-driven (React) | ✅ 2nd dashboard (`reports.opsDashboard`, optional): KPI groups + 4 HBarChart+table sections + 2 tables + stacked "No Booking" chart. Reuses dashboard-1 CSS; engine generates it per prospect |
| AI Agent Conversion Dashboard | `/dashboards/ai-agent-conversion` | Profile-driven (React) | ✅ 3rd dashboard (`reports.aiAgentConversion`, optional), built from screenshots (`AiAgentConversionDashboard.tsx`): "AI Agent Performance Summary" KPI group + **6 conversion cards** (Lead Form + Voice Agent, each with filter chips + Job Complete% / Total Revenue tiles, `.aac-*` CSS) + 4 donut+table breakdowns (Source/Medium/Campaign/Search Term; donut %-labels use `Breakdown.donutTotal`) + Product Category table + StackedBarChart. Reuses the shared `.dash-`/`.breakdown-`/`.kpi-` template + DonutChart/StackedBarChart; engine generates it per prospect |
| Quality Management (QM Actionable Insights) | `/dashboards/quality-management` | Profile-driven (React) | ✅ 5th dashboard (`reports.qualityManagement`, optional), matched to the real Invoca page (`reference/quality-management/*.html`, network 2982). **Layout = the real 3-col gridstack**: Row1 Sales Opportunities **2/3** \| Sales Conversions **1/3** (`.qm-row-21`); Rows 2/3/5/6 left **1/3** \| right **2/3** (`.qm-row-13`); Rows 4/7/8 full width. 13 tiles: 4 KPI cards (ConversionCard title+chips+tiles), Calls Needing Review + Bottom/Top Quality Scores HBars (the two by-agent bars show a `pager` "1 - 6 of 30"), Highest Converting Agents stacked bar (**9 weeks × 5 agents**), Bottom/Quality Scores tables, and 3 **BarLineChart**s: Baseline Sales Quality Score (bars + red dashed avg line w/ a value badge) + the two Trending charts (**dual-axis**: bars=left %, orange line=right count/revenue via `rightLabel/rightMax/rightTicks/rightPrefix`). Platform metric labels verbatim; agents/scorecards/vertical terms re-skinned. Engine composes scaffolding + deterministic daily points; model generates compact `QmGen` content |
| QM Instant Insights | `/dashboards/qm-instant-insights` | Profile-driven (React) | ✅ 6th dashboard (`reports.qmInstantInsights`, optional), matched to the real Invoca page (`reference/quality-management/*Instant*.html`, network 2982). QA at-a-glance: Trending Essential Metrics full-width (BarLineChart, **line-primary + DUAL-axis**: blue AHT line on left time axis, orange Negative-Sentiment **bars on the RIGHT axis** 0–120%; passed `height={150}` = 50% shorter), Essential Metrics **2/3** \| Trending Answer Rate **1/3** (`.qm-row-21`; answer rate = line-only, zoomed `yMin` 65–100), Contact Center Metrics, Overall Evaluation Score **1/3** \| Evaluation Rollup **2/3** (`.qm-row-13`), Scored Calls by Evaluator table. `BarLineChart` supports the SECONDARY series on the right axis (bars-on-right when `linePrimary`, else line-on-right). Engine composes charts; model supplies compact values (`QmInstantGen`) |
| AI Messaging Impact (Human vs AI) | `/dashboards/ai-messaging-impact` | Profile-driven (React) | ✅ 4th dashboard (`reports.aiMessagingImpact`, optional), built from screenshots (`AiMessagingImpactDashboard.tsx`): paired **1/3 + 2/3 KPI cards** (`.aim-row`) — AI (This Month) vs Human (Last Month, grey chip) for Lead Engagement + Appointment Performance — then AI-Assisted Appointment Trend **LineChart** (49 daily pts, flat→jump; sparse x-labels), AI-Assisted Opportunities + AI Lead Nurture tiles, and a **Common Topics** StackedBarChart re-skinned to the prospect (window-treatment topics for Shady Blinds). Reuses the shared template; engine generates it per prospect |
| Invoca Exchange (Integrations) | `/integrations` | **Exact static copy** (identical for all customers) | ✅ real page served |
| Google Ads Search Keywords | `/integrations/google-ads` | **Exact static copy** | ✅ real page served |
| Google Ads AI + undo (in-page) | n/a | Static + JS | The Ads page is a saved document, NOT a React screen, so the platform's Ask AI drawer cannot render there. `google-ads-demo.js` injects a compact equivalent: sparkle + undo left of the Ads **SEARCH** icon, hover-revealed on `.iga-zone` (same always-hold-layout-space-and-fade contract as the top bar), a small drawer, and the SAME `/api/ai-assistant` endpoint. **Rule 2 is structural here**: an edit only lands when its path names one of six fields (`keyword`, `campaign`, `adGroup`, `conversion`, `impressions`, `clicks`) and its value is a string or number, so there is no route from a reply to CSS or layout whatever the model returns. State persists per prospect (`invoca-demo:google-ads-ai::<id>`) and undo is one step at a time. ⚠️ Two traps found while building it: the capture ships **"Material Icons Extended"**, not "Material Icons" (asking for the latter renders the ligature as the literal text `auto_awesome`, 119px wide), and the injected `demo-back-nav` click rule now **excludes `.iga-zone`/`.iga-wrap`** — it is capture-phase so the assistant cannot stop it, and the drawer's backdrop covers the `x<255, y<60` logo region, so dismissing the drawer there used to navigate out of the page. ⚠️ A null field means "keep the capture's own value", so `ORIGINAL` snapshots each cell's text BEFORE the first write; without it, undoing impressions back to null left the edited number on screen instead of restoring 1,560. |
| Google Ads per-prospect overrides | n/a | Static + JS re-skin | `public/google-ads-demo.js` re-skins the captured console from the active profile in localStorage, all from the prospect's OWN dashboard data: **keyword** = the top `Calls by Search Term` row (a real phrase somebody types, e.g. "emergency room near me" — it used to be `callReview.searchSuggestions[0]`, which are single transcript words like "monitoring" and read as a transcript search rather than a paid keyword), **ad group** = a `Conversions by Product Category` row picked by word overlap with the keyword (an ad group contains its keywords, so "used cars…" in a "New Cars" ad group looked fake; **two** shared words minimum, because one matched "continuing CARE" to "Memory Care" over the better "Independent Living"), and **conversion** = `<bookingTerm> Booked` ("Appointment Booked", "Tour Booked"). `OVERRIDES` is now EMPTY on purpose: the vector-security entry set the keyword by hand to exactly what the Search Term row already returns, so it was pure drift risk. Both defaults are borrowed from other screens and can read wrong for an ads account (searchSuggestions are single CALL REVIEW transcript words like "monitoring", not phrases anyone types into Google). Fix that in the `OVERRIDES` table at the top of that file, keyed by profile id, NOT in the profile: editing `searchSuggestions` makes the Call Review search placeholder suggest a term matching no summary, and editing `bookingTerm` renames the Agent Workflow leaf, the dashboard KPIs and the CI signals with it. Currently overridden: **vector-security** (keyword "home security systems near me", conversion term "Quote") |
| Google Search results | `/google-search` | Profile-driven (React) | ✅ dark-theme google.com/search with the PROSPECT in the top sponsored slot, opened from the green **Network** chip in the top bar (`TopBar.tsx`; the chip is a button, the `<select>` beside it is still the customer switcher). Matched to a SingleFile capture, measured off the rendered DOM: page `#22242a`, text `#e8e8e8`, link `#99c3ff`, place action `#a8c7fa`, hairline `#444746`, pill `#2c2e35`, search pill `#4d5156` 694x52 r26, results column x=122 w=652, result title 22/28, sitelink 18/26, place name 18/24, Places head 28/36, local pack 876 wide with a 438 map column. Sections in capture order: location chip, Sponsored Results (4 ads, stacked sitelink rows on the first), Places pack (list + Mapbox night map with pins, prospect repeated as a Sponsored place), organic results, a SECOND Sponsored Results block (inline chips + visits line), more organic, People also search for, Goooogle pager, footer. **Clicking the prospect's ad opens their site with the paid parameters**: `oppref` + `utm_source=google` + `utm_medium=cpc` + `utm_campaign=<their top campaign from the Marketing Performance dashboard>` + `utm_term=<the query>` + `utm_content` + a deterministic `gclid`. Only the prospect's ad is a real link; the rivals are inert by design. The ad's call extension uses the reserved **555** exchange with the prospect's own area code, so it reads local but cannot ring a real business. The search box is editable and Enter re-renders the wording (and `utm_term`) without pretending to search. The logo goes back to where the SE came from. "Google Sans" is not bundled, so headings fall back to Roboto/Arial |
| All other nav items | various | Placeholder | ⏳ not built |

### Signal → Semantic Signal Library (`/signal/new/semantic`)
`SemanticSignalLibrary.tsx` + `.ssl-*`, from the capture "Semantic Signals｜ Invoca For
Telecom 2.0" (8/6/2026; real URL `/manage_signals/semantic_signal/template`). Reached from
Semantic Signal's SELECT on the type-select. Fifteen template cards, each with a speaker chip
(Agent/Caller), the Invoca publisher mark, a 3-line-clamped description and an Activate button.

Measured, since this page serialises in full: grid 1/2/3 columns at 0/600/900px with a 24px
gap; card `min-height: 280px` / `max-height: 400px` with the MUI elevation-1 shadow and a
`translateY` lift on hover; title 20px/28px with `flex: 1` (that is what pushes the speaker
chip right); speaker `rgb(102,112,142)`; body clamped to 3 lines; Activate pushed right with
`margin-left: auto`.

**THE 15 TEMPLATES ARE INVOCA'S OWN and must NOT be re-skinned per prospect.** This is the
platform's stock library — identical in every account — and the descriptions are Invoca
product copy. The prospect's own signals live on Manage Signals, which IS profile-driven. The
publisher mark is inlined SVG (`#02B388`), not the capture's base64 `<img>`.

The search box filters on name AND description, so "resistance" finds Objection Handling and
"hold" finds Put On Hold. A title-only filter would be a prop. Activate returns to Manage
Signals until the activation flow is built (and it stops propagation, or it would also open
the drawer on its way past).

**Hover LIFTS AND TINTS** — `translateY(-0.25rem)` with `background-color: rgb(212,224,254)`
(titan blue-10), `rgb(176,205,255)` on active. Both are the capture's own values; the lift
alone was half the effect.

**Clicking a tile opens a 500px right drawer** (`.sdr-*`, capture "Semantic Signals 2"):
title, publisher, description, Spoken By, Suggested Use, the phrase list, and a sticky
Close/Activate footer the list scrolls under. Same MuiDrawer chrome as the Insights
interaction drawer but the SMALL width token — 500px against that one's 800px.

⚠️ **PHRASE PROVENANCE IS UNEVEN — see the note atop `src/data/semanticSignals.ts`.** Only
ONE drawer was open when the capture was saved, so "Ask for Appointment" has all 44 of its
real phrases; "Ask for Sale" and "Competitor Mention" have the 13 and 14 visible in the
screenshots (real, but cut off by the viewport); the other **12 templates' phrases are
AUTHORED, not captured**, and their Suggested Use is inferred. Replace any list marked
`captured: false` when a real drawer capture turns up.

### Signal → Edit Rule Signal (`/signal/rule`)
`EditRuleSignal.tsx` + `.ers-*`, from the captures "Edit Rule Signal" (one condition) and
"Edit Rule Signal 2" (four, plus the advanced section), both 8/6/2026; real URL
`/manage_signals/rule_signal/edit/<id>`. **Every signal row on Manage Signals opens it**,
carrying its own name in `?name=`, so a Shady Blinds row titled "Consultation Booked
(Conversion)" heads the editor with that, not the capture's "Appointment Booked".

Measured: terminals are literally `border: 2px solid rgb(38,102,249)`; chips 16px radius; the
join select 70px; the value box 1px `rgb(208,211,216)` at 4px radius. **All 31 terminals are
verbatim** in three groups (Call Details 21, Reported Data 5, Invoca Platform Details 5) —
Invoca's rule-builder vocabulary, identical in every account, NOT re-skinned.

**The rail actually builds the rule.** Clicking a terminal appends a condition with an "and"
join (switchable to "or"); the × removes one; TEXT renders the same rule as a sentence. Two
things that only show up once it is interactive:
- Deleting the FIRST condition must strip the new head's join, or the rule renders with a
  dangling "and" in front of it.
- A value box renders **only for a condition that has a value**. In the capture just Spoken
  Phrases does; the other three chips sit bare with the next "and" straight after. Rendering
  an empty box for every condition also wrapped the row a condition early.

### Signal → New: the source type-select (`/signal/new`)
`SignalTypeSelect.tsx` + `.sts-*`, from the capture "Signal /new signal.html" (the real URL
is `/manage_signals/type-select`). Reached from **New Signal** on Manage Signals, which is
now a `<Link>`. Three cards — Semantic Signal (with the NEW! corner ribbon), Signal AI Studio
(Recommended), Rule-based Signal — over a divider and a Cancel button.

This page is Invoca's own MUI markup and serialises in full, so every value is measured:
lede 24px/36px `rgb(81,133,250)` with 32px below; cards 3px radius, 1px border, no shadow;
ribbon a 110px square clipping a `-45deg` band in `#5185fa` at `700 15px/1` uppercase.

**The illustrations are Invoca's own icon sprite**, lifted out of the capture to
`public/signal-sprite.png` — 4468×236 drawn at `background-size: 2234px`, i.e. a 2x asset, so
the capture's `background-position` values are used verbatim (`-706px 0` splash, `-1618px
-27px` semantic, `-1859px -31px` AI, `-2051px -27px` rules). Using the sprite beats cropping
four images by hand, and the rest of the platform's illustrations are in it if a later Signal
screen needs one.

Nothing here is re-skinned per prospect: every word is Invoca product copy describing Invoca
features, and no customer data appears on the page.

⚠️ The grid is `repeat(auto-fit, minmax(290px, 1fr))`, not `repeat(3, 1fr)` with a
breakpoint. Two reasons: a fixed three-up squeezes the text column to ~160px on a narrow
window, and **grid only equalises card heights within a ROW** — when it wrapped to one column
the cards stopped matching and the three SELECT links fell out of line. At the reference's
width all three sit in one row at 517px and their SELECTs share a baseline.

SELECT and Cancel both return to `/signal` for now; point each SELECT at its builder as those
screens arrive.

### Sidebar (left nav)
**Signal opens a FLYOUT, it does not navigate.** A `NavItem` with a `submenu` renders as a
`<button>` instead of a `NavLink` and opens a dark panel beside the rail — measured off the
capture "Signal /Singal Box.html": 230px wide, `left: 82px`, `#2c3951`, radius 5, shadow
`0 2px 4px rgba(12,0,51,.2)`, 12px bottom padding only; heading 20px/28px bold uppercase at
`24px 24px 12px`; links 16px/16px at `6px 24px`. Signal is the only item with one today; any
item can have one.

Three things that are easy to get wrong here:
- The panel must be **`position: fixed`**, anchored to the button's own rect. `.nav-scroll`
  is `overflow-x: hidden`, so anything positioned inside the rail is clipped at 86px.
- It **follows its rail item as the rail scrolls.** Reading the button's top once at click
  time leaves the panel behind the moment the nav scrolls, so a `useLayoutEffect` re-reads
  the rect on the SCROLL CONTAINER's scroll event (`.nav-scroll` scrolls, not the window)
  plus window scroll and resize. Layout effect, not effect, so it is never painted at a
  stale offset. Verified delta 0 at every scroll position across the rail's full range.
- The outside-click listener runs on **`pointerdown` in the capture phase**. On bubble, a
  second click of the Signal item would close the panel here and immediately reopen it in the
  button's own onClick.
- `button.nav-item` needs the browser's button styling removed so it sits flush with the
  `<a>` items; everything else comes from the shared `.nav-item` rule so the two cannot drift.

The parent highlights for any route beneath it (`/signal/discovery` keeps Signal green), and
navigating closes the panel. Destinations: Manage Signals -> `/signal` (SignalManager, real),
Signal AI Studio -> `/signal/ai-studio` and Signal Discovery -> `/signal/discovery`, both
**Placeholders awaiting captures**.

Matched **exactly** to the live network 2751 nav: **14 items** in order —
Dashboards, Call Review, Agent Studio, Profiles, Campaigns, Lead Forms (NEW),
Publishers, Promo Numbers, Reports, Integrations, Signal, Score, Labs, Settings.
The main list scrolls (`.nav-scroll`) and **Settings is pinned to the bottom**,
like the real rail. Active item = green text/icon + `4px` green left bar
(`#0a830e`) + `#f5f6fa` background; icons 24px, labels 12px, items 60px tall.
Icons are the real glyphs: Material Icons ligatures where the platform uses them
(dashboard, phone_forwarded, supervisor_account, dialpad, equalizer, device_hub,
explore, assignment_turned_in, settings) and exact inline SVG for the custom
glyphs (Call Review, Agent Studio, Profiles, Lead Forms, Labs) in `nav.tsx`.
⚠️ The full nav has 14 items — the list scrolls, so don't assume the last item
you can see is the last item (that mistake once dropped Integrations/Signal/
Score/Labs). Re-derive the whole set from the saved HTML's `data-nav` `<li>`s.

### Dashboard styling (matched to live, from saved "Dashboard _ Invoca for Home Services.html")
The dashboard is a gray page (`--color-bg-page`) with a grid of **white tile
cards**, each: white bg, `border-radius:4px`, soft two-layer shadow
`0 1px 1px 0 rgba(0,0,0,.1), 0 1px 5px 0 rgba(0,0,0,.1)`, ~10px gaps.
GOTCHA: the saved HTML is the dashboard **builder/edit** view (gs-id="builder"),
which renders tiles FLAT (no shadow). Don't measure tile borders/shadows from it
— the view-mode style lives in `common-3b9dc252.css`
(`.grid-stack-item-content{...box-shadow:0 1px 1px..., 0 1px 5px...}`). Font sizes
DO measure correctly off the rendered builder nodes.
Measured values now in the demo: page title 29.7px; tile titles (h2) 26.4px
`#3d3d3d`; KPI value 36px/700 `#15243e`, label 14px; KPI divider = `::before`
bar **4px × 63px `#f5f6fa`** between cells (not full-height borders). Breakdown
tables use `table.dash-table` (NOT `table.report`): th 14px/700 `#343a40` with
1px `#e7e9eb` bottom rule; td 14px, 12px padding, 1px `#e7e9eb` top rule, **no
striping, no sort carets**. Chart palettes: donut `#2666f9 #129922 #f5575a
#009788 #a182e5`; line/stacked `#2666f9 #ff7045 #f3cb00 #00d1b4 #a182e5`;
gridlines `#e7e9eb`. **Chart legends** (`StackedBarChart`/`LineChart`) truncate
long series names to fit their slot with an "…" (full name kept in an SVG `<title>`
for hover) so they never overlap the next legend item.
**Shared header/chip conventions (all dashboards must match):** every dashboard
header uses the SAME `.title-actions` set — `file_download`, `history`, a blue
**Add Tile** `.save-btn`, then `more_vert`. Accent color is **`#2666f9`**: the
Add Tile button (white `+`), the "Manage Dashboards" `.breadcrumb a`, and chart
blue. Header icons (download/history/kebab) are `#5b6577` to match the topbar
star. Filter chips (`.aac-chip`, used by AI Agent Conversion / QM / QM Instant /
AI Messaging) are **pills** (`border-radius: 999px`). AI Agent Conversion: LEAD
FORM cards use "Interaction Type: Form Fill", Voice Agent cards use "Interaction
Type: Voice".
Gotcha: the saved dashboard HTML doesn't render as-is (gridstack/MUI position
tiles at runtime) — reconstruct by absolutely positioning `.grid-stack-item`s
from their `gs-x/y/w/h` attrs (3-col grid) and clamping `svg.MuiSvgIcon-root`
to 24px, then measure computed styles.

### UI convention: show the customer name, not the network name
Across the whole app, display `profile.customerName` (e.g. "Shady Blinds"), NOT
`profile.networkName` ("Invoca for Home Services"). The top-bar network selector
and the Launch "Your prospects" list already do this. `networkName` stays in the
data but isn't shown. Apply this to any new screen that would surface it.

### Page chrome & backgrounds (matched to live)
Gray chrome, white content: **topbar `#f6f7f9`**, **sidebar `#f5f6fa`**, page `#f6f7f9`.
The Digital Journey report is one **white panel** (`.report-surface`: `#fff`, 1px
border, `0 2px 4px` shadow, top-left corner rounded `5px`). `.main` is **full-bleed
(no padding)** so that panel sits flush against the sidebar/topbar like the real
page — non-report screens add their own padding (`.dash-page`; `.placeholder` self-pads).

### Before Invoca sees the call: the two paid-placement screens
`src/data/prospectPlace.ts` is shared by **`GoogleSearch.tsx`** and
**`ChatGptAd.tsx`** and owns everything both need to agree on: `derive(profile)`
(location, the invented rivals, hero product, the search query, the offer),
`CITY_LL`/`lookupLL`/`DEFAULT_PLACE` (geocoding, fallback Santa Barbara),
`trackedSiteUrl()` (the `oppref` token) and the Mapbox helpers. It lives outside
both screens because the same prospect must land in the same city against the
same competitors on both, and two copies would drift on the first fix.
⚠️ **Label and coordinates must always resolve TOGETHER.** `derive` falls back
label-and-all when it cannot geocode; recombining a fallback city with a live
screenpop state printed "Santa Barbara, TX" for Reyes Law. If you build a
location string, take BOTH halves from one source.
⚠️ Competitor names, directories and review counts on both screens are
**invented** from city + industry. The real captures name real businesses with
real ratings; reproducing that shape with fabricated copy would put words in a
named company's mouth. `derive` also rejects any rival name sharing two
significant words with the prospect (that is what stopped "Orlando Health
Systems" appearing beside the real Orlando Health).

### The Integrations click-through (demo circuit)
Sidebar **Integrations** → `/integrations` → `StaticRedirect` to `/invoca-exchange.html`
→ click the **Google Ads** tile (JS override injected in the HTML) → `/integrations/google-ads`
→ `StaticRedirect` to `/google-ads.html` → click the **Google Ads logo (top-left)** → back to `/dashboards`.

⚠️ **Testing the exact-copy pages: use a REAL click, never `el.click()` or a
synthetic `MouseEvent`.** The injected `demo-back-nav` script in
`public/google-ads.html` treats any click with `clientX < 255 && clientY < 60` as
the Google Ads logo and navigates to `/dashboards`. A synthetic MouseEvent
defaults those to 0/0, so it ALWAYS trips the back-nav wherever you aimed it,
which looks exactly like the Next/Prev walkthrough being broken. It is not: the
walkthrough works fine when clicked at real coordinates.

### How the exact-copy pages were made (reproduce if a page changes)
Server-side `curl` gets a different A/B variant than a real browser, so:
1. Open the real page in a browser, **File → Save Page As → "Webpage, Complete"**.
2. Drop the `.html` + its `_files/` folder into `public/`.
3. Process the HTML: for SPA pages (Google Ads) **strip all `<script>` tags** so the
   saved rendered DOM displays statically instead of re-hydrating and blanking;
   remove chat/consent widgets (Qualified/OneTrust) and any width constraints they
   injected; inject the click overrides (Google Ads tile → demo; logo → dashboard).
   (Processing scripts were run from scratch; not committed — re-create as needed.)
- The Exchange page loads GT America font + logos from Invoca's CDN (needs internet).
- These render the **desktop layout at ≥992px** (they're the real responsive pages).

## Signal AI Studio
- `src/screens/SignalAiStudio.tsx`, route `/signal/ai-studio` (replaced the Placeholder).
  Reached from the Signal flyout's middle item. Real page: `/networks/2751/label_groups/manage`.
- Values MEASURED off the live page 8/17/2026: page bg `#f6f7f9`; h1 24px/400; New AI Model
  `#2666f9` 14px/500 radius 3 pad 8/12; info banner bg `#d4e0fe` ink `#11228c` 14px radius 3;
  row card white, 1px `#e7e9eb`, radius 5, shadow `0 2px 4px rgba(12,0,51,.2)`, 12px gap;
  model name 16px/700; label line 16px/400; Round chip `#e7e9eb` / `#5b6577` / 12px /
  radius 16; action button **outlined** (white, `1px rgba(38,102,249,.5)`, ink `#2666f9`,
  12px/500, 32px tall) -- the leaf holding "Label Calls" has NO chrome, it is on the
  ancestor `<button>`, so measure the button not the text.
- **TWO cards.** The live capture had four (it also carried a `quote, sales_call,
  service_call` intent model and one named from `profile.networkName`); trimmed on request
  to the two that carry the story. Keep one of each ROUND state so both action buttons stay
  visible on screen.
- **Card 2's label re-skins; card 1's deliberately does not.**
  - Card 2 is `${snake(profile.bookingTerm)}_set` -- THAT PROSPECT'S LEAD CONVERSION.
    `bookingTerm` is the same field the platform renders as "<term> Booked (Conversion)"
    everywhere else, so this is the right source, not an approximation of one. Snake_case
    the WHOLE term or "Test Drive" becomes `drive_set`. Verified across the library:
    `consultation_set`, `estimate_set`, `quote_set`, `lifestyle_visit_set`,
    `installation_appointment_set`, `service_appointment_set`, `appointment_set`.
  - Card 1 stays `sales_qualified_lead` -- a generic qualification model that reads the
    same in every Invoca account. Re-skinning it would invent an account-specific name for
    something that is not account-specific.
  - Derived in the component: no schema change, no engine phase, so every profile already
    on disk gets it and generation time is unchanged.
- **Creation dates are HASHED from the profile id, never `new Date()`.** The page shows
  "Created on ..." timestamps; if they moved on every open, an SE could not rehearse
  against the screen or screenshot it twice the same way. Anchored before the demo's
  January 2026 window so a model reads as trained before the calls it scored. Verified
  identical across reloads.
- `Round 0` gets "Label Calls", a round-tripped model gets "Verify Labels". That is the
  only thing driving which button appears.
- The chevron expands to show the row's own labels as chips. What the real page reveals was
  not captured, so it deliberately shows only what the row already knows rather than
  inventing training statistics a prospect might ask us to explain.

## USE THE REAL ICONS (standing rule for every replica)
Never substitute a lookalike glyph. Material Icons stood in for the Add Tile picker's
artwork and it was wrong in four ways at once, none of which a screenshot shows:

- **The real set has its own palette** -- #1643D5 #5185FA #2666F9 #7DA3FB #B0CDFF,
  #2CBF58 green, #33E5C9 teal, #FFD800 yellow, #5B6577 axis grey. Flat single-colour
  Material glyphs read as a different product.
- **Icons are SHARED.** Fourteen Add Tile cards use only TEN files: one line icon
  across Single and Multi-Line, one clock across Calls by Hour and Day of Week, one
  table across all three Reports. Giving each card its own glyph invents distinctions
  the product does not make.
- **Some are gradient-filled.** Build With AI paints Material's auto_awesome path with
  a hidden `<defs>` linearGradient (#66ebd7 -> #7da3fb -> #a182e5). Flat purple looks
  plausible alone and clearly duller side by side.
- **viewBoxes differ** (most are 48x48; calls-by-time is 25x24), so sizing has to come
  from CSS rather than the file.

HOW TO EXTRACT THEM. On the live page the icons are `<img>` elements whose `src` is a
base64 data URI. Read the srcs with `javascript_tool`, then decode to real files:

    printf '%s' "<base64>" | base64 -d > public/icons/<screen>/<name>.svg

Verify the decoded byte count against the length the page reports -- a truncated tool
result would otherwise write a silently broken file. For anything over ~8KB of base64,
fetch it in halves and concatenate; one 14KB string risks being clipped.

Dedupe FIRST (group the srcs and count unique assets) so the shared files are obvious
before any are written. These are Invoca's own icons in Invoca's own internal tool, so
extracting them verbatim is correct; approximating them is not.

## ONE CSS PREFIX PER SCREEN (standing rule)
Two screens sharing a class prefix is a bug that presents as "the design is off", which
is the worst possible symptom because it sends you re-measuring geometry that is already
correct. The tile Configuration drawer and the Insights CALL DETAIL screen both used
`.icd-`, and three names collided outright: **`icd-body`, `icd-field`, `icd-title`**.
Call detail's `.icd-body`/`.icd-field` are flex containers and its `.icd-title` is
26px/600, so the drawer's 452px fields measured **52.7px wide**, one label came out
**248px tall**, and its 24px/400 title was overridden. Every value in the drawer's own
CSS was right.

The drawer is now **`.itc-`**. Before adding a screen's styles, grep for the prefix:

    comm -12 <(grep -o 'xyz-[a-z-]*' A.tsx | sort -u) <(grep -o 'xyz-[a-z-]*' B.tsx | sort -u)

⚠️ A prefix rename must also catch the **BARE base class**. `.icd` -> `.itc` is not
covered by replacing `icd-`, so the panel kept `className="icd"` against a stylesheet
that only defined `.itc` and the drawer rendered with no styling at all.

## Insights & Analytics: the three Reports are DIFFERENT surfaces
`src/data/insightsColumns.ts` holds the measured group -> column membership, extracted by
walking the accordions in saved captures of all three live builders. Do not infer
grouping from column names: the keyword rules that preceded this put Agent under Contact
Center Metrics and a third of the catalogue into "Short Text Fields".

| Report | Groups | Sidebar |
|---|---|---|
| Details | 20 | Reorder columns, seeded with Call Record ID |
| Summary | 11, **measures only** | **Group By** + Reorder, seeded with nothing |
| Transactions | 21 (Details + RingPool Details) | Reorder, seeded with Call Record ID **and** Transaction ID |

⚠️ **A SUMMARY COUNTS BOOLEAN FLAGS**, which is why Summary first came out two groups
short. Live Summary shows Signals with 75 columns and Voice AI with 5 — signal names and
"Voice AI Agent Engaged" and friends. None reads as a metric, but a summary counts them.
The tell is STRUCTURAL, not lexical: each has a `<name> (T/F)` twin in its own group, so
`countableFlags()` finds them from the group's own contents and therefore works for a
prospect's generated signals without naming any of them.

⚠️ **Our column totals are LOWER than the captured account's and that is correct**
(234 v 371). Almost all of the difference is Signals: that healthcare account has 75
configured signals (150 entries with twins), Shady Blinds has 11. Do not "fix" it by
padding the list with that account's signals — the whole point is deriving from the
prospect. Scores is the same story.

⚠️ **The checkbox grid is a BREAKPOINT, not `auto-fill minmax()`.** Measured 653px -> 2
columns and 1439px -> 3. No single minimum satisfies both (it would have to be >359 and
<=326 simultaneously), so it is MUI's lg breakpoint: 3 columns at >=1200px, 2 below.
A single-width measurement cannot tell these apart, which is the whole reason for the
two-width rule below.

⚠️ **The three reports share ONE route pattern**, so React Router reuses the component
when only `:report` changes and `useState(sidebarFor(kind).seeded)` never re-runs.
Transactions showed Details' single seeded column and Summary showed one it should not
have had at all. Reset on `kind` change, and test by navigating in an order built to
expose stale state (details -> transactions -> summary -> details), not by loading each
report fresh.

The Configuration drawer's dropdown is a **floating searchable popup**, not a native
`<select>`: paper 450 wide, max-height 375, radius 3, MUI shadow, padding 8px 0; options
32px tall (20px line box + 6px padding — the default line-height makes them 36) at
padding 6px 16px, 16px/400. Typing filters, which is the only way 250 options is usable.
Drawer content insets **24px** (8 beyond the panel's own 16), fields **452** wide, combo
`h=37` border `1px #e7e9eb` radius 4.

⚠️ **The combobox toggles on `mousedown`, and must NOT also open on focus.** With
`onClick` toggling and `onFocus` opening, the FIRST click looked dead: the order is
mousedown -> focus -> click, so focus opened the popup and the click handler toggled it
straight shut; the second click worked only because the input was already focused and
fired no focus event. Mousedown runs before focus, so one handler owns the state. A
keyboard user gets no mousedown, so ArrowDown / Enter opens the list instead.
⚠️ This class of bug is invisible to `el.click()` and synthetic events, which skip the
focus step entirely. Verify a toggle with REAL clicks at real coordinates — the same
lesson the Google Ads back-nav note records.

## MEASURE AT MORE THAN ONE WIDTH (standing rule for every replica)
A single-width measurement is not a measurement. The Add Tile picker was built from
a 1134px viewport and looked right there; at 1920 the real page shows FIVE columns,
not two, and the card's description sits below the icon rather than beside it. Both
were invisible at the width I checked.

Before believing any layout:
- measure the live page at a NARROW and a WIDE viewport (1134 and 1920 are the two
  used here; a third in between pins down a fluid grid);
- solve for the authored rule rather than hard-coding what one width happened to
  show. Three data points -- 983px available -> 2 columns, 1349 -> 4, 1769 -> 5 --
  identify `repeat(auto-fill, minmax(320px, 1fr))` uniquely;
- check whether a card's HEIGHT is fixed or content-driven. Add Tile's cards measure
  144 tall narrow and 164 wide, because the description rewraps; a fixed height would
  clip on a wide screen;
- re-measure the replica at the SAME widths and compare numbers, not screenshots.

The Browser pane can resize (`resize_window`) and is already signed in to the live
account, so this costs one extra call per width. Claude in Chrome cannot help here:
it only exposes tabs inside its own tab group, so it cannot read a tab the user
already had open.

## INSIGHTS & ANALYTICS IS A CROSS-ORIGIN IFRAME — where the design system actually lives
The tab is an `<iframe>` on **invoca.thoughtspot.cloud** (1224x790 at a 1312 viewport).
Nothing inside it is reachable: no DOM, no computed styles, no SVG geometry, and
**the mouse wheel and Page Down do not scroll it** from the browser pane. A capture of
the page does not serialise its contents either, which is the real reason the earlier
Details Report note says "no body and no footer in the DOM".

**But the design system is not inside the frame — it is in the PARENT window**, and it
is exact rather than measured:

    window._tsEmbedSDK.embedConfig.customizations.style.customCSS.variables   // 90 tokens
    window._tsEmbedSDK.embedConfig.customizations.style.customCSS.rules_UNSTABLE  // 51 rules

All 90 are saved verbatim in **`src/tokens/thoughtspot.css`** (loaded from `main.tsx`),
so any Insights screen can say `var(--ts-var-liveboard-tile-border-radius)` rather than
hardcoding a guess. Re-read that object whenever the real page is restyled.
⚠️ Do NOT `JSON.stringify` the SDK object — it holds DOM nodes with React fibers and
throws on the circular structure. Walk it and skip anything `instanceof Node`.

**Three things this proved wrong**, each of which had been in this file or the CSS:
1. **The font is Lato, not optimo-plain.** Every `*-font-family` token is
   `Lato, Avenir, Avenir-Book, "Museo Sans", sans-serif`. optimo-plain is ThoughtSpot's
   DEFAULT and Invoca overrides it, so Insights uses the SAME face as the rest of the
   platform. `.ind-page` asked for optimo-plain and fell back to Helvetica Neue, so
   every Insights screen was rendering in **Helvetica**. Now `var(--ts-var-root-font-family)`.
2. **Tiles are 8px radius with a 1px `#e7e9eb` border and NO shadow.** The Dashboards
   tab is 4px radius with a two-layer shadow and no border. That one difference is most
   of why the two tabs read as different products.
3. **The liveboard page is WHITE** (`--ts-var-liveboard-layout-background: #ffffff`),
   not the platform's `#f6f7f9`. Dashboards is grey-page-with-white-cards; Insights is
   white-on-white separated by borders.

Other values worth knowing, all from the token map: viz title `#15243e` / description
`#5b6577`; **axis data labels AND axis titles are both `#5b6577`**; every hover and
selected state across menus, lists, chips and legends is `#d4e0fe`; buttons
`#2666f9` -> hover `#1c53e9` -> active `#1643d5` at radius 3, secondary/tertiary
`#f3f4f5` on `#5b6577`; icon buttons are radius **100px**; checkboxes `#2666f9` checked,
border `#e7e9eb`, hover border `#2666f9`, disabled `#a1a7b2`, error `#e4131b`; chips
`#e7e9eb`/`#5b6577` going to `#d4e0fe`/`#15243e` when active.

`rules_UNSTABLE` is chrome surgery, not chart styling: it hides ThoughtSpot's own
header, edit button and logo, makes the filter bar sticky, and fully specifies the
**"Ask" / Spotter pill** —
`linear-gradient(135deg, #ccf8f2 0%, #e5fbf8 38%, #e9f0fe 72%, #e7e0f9 100%)`,
`1px solid #d4e0fe`, radius `3.5rem`, text `#007e73`, hovering to
`#99f2e4 -> #ccf8f2 -> #d4e0fe -> #e7e0f9` with text `#009788`, and a sparkle drawn as
a `::before` data-URI SVG.

### Reading inside the frame: the SingleFile capture route (this WORKS)
The series palette and all chart geometry are not in the embed config, but a SingleFile
capture does serialise the frame. How to get at it:

1. SingleFile saves the frame into a **`srcdoc` attribute** on `#_thoughtspot-embed`
   (9.4MB of it). The rendered Highcharts SVG, the tables and the inline heatmap
   colours are all in there.
2. **Do NOT try to read it through the iframe.** Its `sandbox` attribute omits
   `allow-same-origin`, so `contentDocument` is null. Stripping the sandbox to get in
   is both the wrong instinct and blocked as a security bypass.
3. **Extract the `srcdoc` to its own file instead**: unescape the attribute, strip
   `<script>` tags (saved SPA pages re-hydrate and blank themselves; the DOM you want
   is already serialised), write it to `public/__m/ts.html`, and open that. Now
   everything is same-origin and every computed style is readable.
4. Vite needs a restart to serve a new `public/` file, and avoid `&` in the name.

That capture yielded 12 charts: 1 area sparkline, 1 grouped column (4 series), 4 pies,
1 single line, 1 multi-line (3 series), 1 dual-axis (column + line), 1 horizontal bar,
plus KPI/metric tiles and 28 tables.

**The palette is a SYSTEM, not a list** — 8 hues x 5 steps = 40 colours, in
`src/data/tsPalette.ts`. A chart takes the first n BASE hues; a donut needing more than
8 slices continues into the tints of hues already used, which is why big donuts show
pale and dark relatives of earlier slices. Approximating this is what makes a replica
read as "close but off".
⚠️ **Series order differs BY CHART TYPE.** Lines and areas start at blue
(#2666F9, #00DEBC, #FFD800); the grouped column starts at GREEN
(#2CBF58, #FFD800, #00DEBC, #2666F9), confirmed against its own legend swatches. There
is no single global sequence.

**The "show heat map" table ramp** is a pale cyan lerp, #f8fdfe -> #b5ecf2, and it is
normalised **per COLUMN**. `heatColor(v, min, max)` reproduces all 16 sampled stops to
within 2/255.
⚠️ Pass that column's own bounds. Checking it against the whole table's range (1..825,
where 825 is another column's value) made a correct function look broken — the test was
wrong, not the code, which is the usual direction of travel here.

**Two layers decide every chart value.** Invoca overrides only the 90 tokens; ThoughtSpot's
own CSS uses a wider set with fallbacks (`var(--ts-var-chart-y-axis-line-color, #e0e0e0)`).
Override wins where it exists, ThoughtSpot's default applies everywhere else — so axis
LABELS are Invoca's `#5b6577` while axis LINES are `#e0e0e0` and legend TEXT is `#777e8b`.
⚠️ **1rem = 14px in ThoughtSpot**, so convert their rem values by /14. `.5714…rem` is 8px.
⚠️ **Charts are Lato, TABLES ARE NOT.** ThoughtSpot's table CSS sets
`optimo-plain, "Helvetica Neue", Helvetica, Arial` explicitly, which beats the inherited
Lato. Both read off the same captured document, so it is not an artefact.

**A tall viewport DOES render the whole liveboard**, which is the one trick that works
for surveying layout when scrolling will not: `resize_window` to something like
1600x4000 and the frame lays out every tile at once. The screenshot is downscaled at
that size, so it is good for INVENTORY and useless for colour or geometry.

## The `ts-` component layer (built 8/18/2026)
`src/components/ts/` + `src/styles/ts.css`, with the palette in `src/data/tsPalette.ts`
and the tokens in `src/tokens/thoughtspot.css`. Import from `components/ts` (the barrel),
never the individual files. Gallery bench at **`/ts-gallery`** — every template on one
page with capture-shaped data, so the layer can be checked side by side at two widths.
Nothing links to it and no prospect sees it.

Components: `TsTile` (frame + HTML legend) · `TsLine` (single, multi, area) · `TsColumn`
(grouped and stacked) · `TsBar` (horizontal) · `TsDualAxis` · `TsPie` (pie and donut) ·
`TsKpi` / `TsMetric` / `TsTrend` · `TsTable` (with the heat map).

**Why a separate layer rather than more opt-in props on `DonutChart`.** The Dashboards
components had already grown `colors`, `onSlice`, `slicePct`, `label` and `geom` for
Insights' benefit, and the tab still looked like Dashboards because apart from one donut
it WAS Dashboards. A `.ts-` prefix in its own stylesheet makes "changes stay in their
tab" structural instead of a matter of care. Do not put `.dash-`, `.kpi-` or `.ind-`
selectors in `ts.css`.

Every value is measured. The ones most likely to be "tidied" back to wrong:
- **NO GRIDLINES.** Every grid path in the capture is `stroke: none`. Dashboards draws
  #e7e9eb ones, so the instinct is to add them. Their absence is a big part of the look.
- **The legend is HTML**, 212px on the right, 12px CIRCULAR swatches, 24px rows, 12px
  `#777e8b`. In-svg legend text would scale with the chart.
- **Pies carry outside data labels with leader lines** reading `Label - count (pct%)` at
  12px `#5b6577` (16 labels, 16 connectors in the capture). Columns and lines carry
  NONE. Leaving the pie labels off made the donuts read as a different chart.
  ⚠️ Labels are pushed apart per side to a 16px minimum: nine slices put several
  mid-angles within a couple of degrees and the small-slice labels stack illegibly.
- **Columns are 22 wide with a 5px gap, square corners.** A group nearly fills its band
  (103 of 111 measured), so the fit rule is "band minus an 8px gutter", NOT a fraction
  of the band — capping at 0.72 gave 17.2/3.9 where the measured 22/5 fitted fine.
- **KPI value ink is `#1d232f`, its label `#15243e`.** Two different inks in one tile,
  because Invoca overrides the label colour and the big number falls back to
  ThoughtSpot's own. Using one for both reads as slightly off.
- Tiles: 8px radius, 1px `#e7e9eb`, AND a faint `0 2px 4px rgba(0,0,0,.05)` — both.
- Donut hole is exactly 50% of the outer radius; plot inset is 68/15 on every cartesian
  chart; lines are 2px; area fill is the line colour at 20%.

All series data goes through `fitValues`/`fitCells`, so the renderers stay TOTAL and the
AI can edit values without crashing one — the precondition the four standing AI rules
put on any `LENGTH_IS_CONTENT` path.

**New tiles from Add Tile render through this layer**; the existing Insights screens
still use their own charts. `DashAssistant` gained a `variant` prop (`"dash"` by
default, `"ts"` on `InsightsDashboard`) and `TsTileCard` draws the SAME
`GeneratedTile` with the ThoughtSpot components. `TileCard` is untouched, so the six
Dashboards keep their card and charts to the pixel. Both Add Tile paths land here: the
Configuration drawer (via `buildTile`) and the Report column picker.
⚠️ **`TsTileCard` keeps the AI identity byte-identical** — same `data-genid`, same
`DashTileAi` focus object. Those are what rule 3 and "remove this tile" key off, and
re-rendering a tile while quietly changing its id is the silent-no-op this repo has
already been bitten by twice. Verified end to end: a table tile and a line tile both
built through the real flows, rendered with `.ts-table` / `.ts-svg`, zero `.dash-card`
leakage, and remove still works.

⚠️ **`.ind-page table { font-family: inherit }` IN app.css BEATS A BARE `.ts-table`.**
Specificity 0,1,1 against 0,1,0, so the ThoughtSpot table rendered in **Lato** on the
Insights dashboard while `ts.css` plainly said optimo-plain. Written as
`.ts-tablewrap .ts-table` (0,2,0) to win outright — relying on `ts.css` importing after
`app.css` would only TIE, and a tie decided by import order is too fragile. This is the
cross-screen interference the one-prefix-per-screen rule warns about, showing up through
a bare TAG selector rather than a shared class name, so grepping prefixes would not have
caught it. Check computed style on the real screen, not just in the gallery.

Verified after building: 22/5 bars (⚠️ read as VIEWBOX units at the time — see "Charts are
drawn 1:1"; the same bars rendered at 14.8 real px in that tile), 0 gridlines, 212px legend
with 12px round swatches,
axis 12px `#5b6577` on `#e0e0e0` lines, slice order continuing into the blue tint at
slice 9, table 11.9px Helvetica with a 13/700 header, 40 heat cells normalised per
column. Dashboards re-checked unchanged: 4px radius, two-layer shadow, 21 cards, donut
350x260, KPI 48,293, and its 12 gridlines still present.

## ⚠️ STANDING RULE: the completed template IS the design, and only DATA varies
Agreed 2026-08-20, and it applies to every Insights & Analytics template as each one is
finished. **"Single Line Chart Over Time" is the first completed template and is the
reference.** Once a template is signed off:

- **The look is FROZEN.** Canvas and plot insets, the absence of gridlines, tick counts
  and step progression, the zoomed y floor, HTML axis titles at 12px/600, the dotted
  partial tail, the tile frame, the hover-fade and the interaction drawer. None of it is
  a per-tile decision and none of it is editable by the AI (rule 1).
- **Only the DATA changes**, driven by the attribute the SE picks: the values, their
  magnitude, their format, and the axis title that names them.
- **The window is NOT the attribute's business.** It comes from the dashboard's filter
  (`marketingDashboard.dateRange`), so every tile on a dashboard covers the same period.

⚠️ **What "only the data changes" actually requires, and does NOT yet hold.** Measured
2026-08-20 across seven attributes: the template apportions EVERY attribute as if it
were an additive count, which is right for Call Count (48,293 exactly) and Answered, and
wrong for everything else:

| attribute | got | why it is wrong |
|---|---|---|
| Revenue (Sale Amount) | 4,744,086..8,907,516 | renders bare, needs `$` on the ticks |
| Publisher Conversion **Rate** | 13..23 summing to 100 | a rate does not SUM across weeks; each week has its own |
| Agent **Handle Time** | 55..99 summing to 420 | an average per call, not a monthly total of 420 seconds |
| Sentiment **Score** | 58..99 summing to 420 | a score does not sum either |

**BUILT — `src/data/insightsMeasures.ts` (2026-08-20).** Every measure has a KIND
(count / money / flag / percent / duration / score / rank) which decides three things:
whether a series PARTITIONS a total or carries a LEVEL per period, the tick format, and
the aggregation word. Verified across all 108 of Shady Blinds' measures.

| kind | additive | series | tick | title |
|---|---|---|---|---|
| count, money, flag | yes | partition of a total | `6.1K`, `$4.7M` | **Total** `<measure>` |
| percent, duration, score, rank | no | level per period | `71%`, `2:43`, `82`, `#7` | `<measure>`, **no prefix** |

⚠️ **"Average" was WRONG and a capture corrected it.** The multi-line capture's own axis
titles and legend read `Total Call Count` for the count but `Answered by Agent (%)` and
`Appointment: Scheduled (%)` VERBATIM for the percents. ThoughtSpot prefixes an additive
aggregation and leaves everything else exactly as the measure is named, so
`aggregationWord` returns `""` for the non-additive kinds. Percent is the only
non-additive kind a capture has actually shown; duration, score and rank follow by
inference, not by separate measurement.

Classified by NAME SHAPE plus a short override list, not by enumerating 108 measures —
that is what makes it survive the next generated prospect, whose measures do not exist
yet. A long override list means the families are miscut.

⚠️ **FAMILY ORDER MATTERS, and three real measures prove it.** Rank is tested BEFORE
money and percent, and the `X: gt Y` threshold shape before duration:
- "Publisher Commissions **Ranking**" contains "commission" -> money by a naive rule
- "Publisher Conversion **Rate** Ranking" contains "rate" -> percent by a naive rule
- "**Duration**: gt 1-minute" contains "duration" -> a duration, when it counts calls

⚠️ **Three defects the classification report caught, all invisible in a type check:**
- **Same-family money printed the SAME figure.** "Earned" and "Paid" both came out
  $2,636,798 and "Fees" matched "Advertiser Fees" to the dollar, because the share was a
  constant per branch and the seed went unused. A seeded +/-15% spread fixes it; Revenue
  stays EXACT so it still agrees with the dashboards.
- **"Total Total Messages."** The measure is named "Total Messages", so the prefix
  doubled. `axisTitleFor` skips the word when the name already starts with one.
- **IVR Duration read longer than the call.** The sliver band (monologue, silence,
  overtalk, dead air, hold, offset) needed `ivr` in it, or a 30-second IVR leg rendered
  at 5:34 against a 2:35 call.

⚠️ Percent and flag are UNEXERCISED by Shady Blinds — its catalogue has no rate measure
(which is why the question resolver maps "Answer Rate" onto the count "Answered") and no
`(T/F)` measures. Both were verified against synthetic names instead; do not assume they
are dead code.

⚠️ **A known limit, recorded rather than papered over:** levels are independent per
measure, so "Connected Duration" can exceed "Duration" if a chart shows both. Harmless
while a line chart shows ONE measure; if Multi-Line ever plots two durations together,
they need a shared anchor.

**Multi-Line makes this reachable now** (it plots several measures at once), but each
series gets its OWN axis and scale, so two durations no longer have to agree to look
right — the contradiction would only be in the numbers, not the picture. Still worth a
shared anchor if an SE ever puts "Duration" and "Connected Duration" side by side.

## Template: "Single Line Chart Over Time" (measured 8/20/2026)
Re-measured from a capture of the REAL tile, and the first build was wrong in seven ways.
`buildTile`'s `"Single Line Chart Over Time"` case + `weeklySpan()` in
`src/data/insightsTileData.ts`.

| | first build | the real tile |
|---|---|---|
| points | 5 week buckets, "Wk 1" labels | **5 week-start dates**, `MM/DD/YYYY` |
| y ticks | `8,000` | **`8K`** compact from 1,000 up |
| tick count | 6 | **8** (`0..8K by 1K`) |
| x labels | "Jan 1-4" | **`12/29/2025` … `01/26/2026`**, Monday-aligned |
| axis titles | none | **`Total <measure>` + `Weekly Call Start Time`** |
| last segment | solid | **dotted**, `stroke-dasharray: 2,2` |
| under the chart | "Call Count over the reporting period" | **nothing** |

⚠️ **A TILE HONOURS THE DASHBOARD'S FILTER — do not re-derive this.** The first rebuild
spanned TWO YEARS, reasoning from a capture whose tile ran 07/2024 to 08/2026 and
concluding "a new tile carries no date filter". Wrong: our Summary Dashboard shows a chip
reading `Call Start Time Between (01/01/2026 <= 01/31/2026)`, and a tile plotting two
years under that chip contradicts the filter a prospect is reading. The captured tile was
built somewhere the filter was not applied.

The window comes from `marketingDashboard.dateRange` — **the same field the chip renders
from** — so the two can never disagree. Corroborated by the grouped-column capture, whose
x axis reads 12/29/2025, 01/05/2026, 01/12/2026, 01/19/2026, 01/26/2026: five
Monday-aligned WEEK-START dates for a one-month filter.

⚠️ **Buckets are weighted by IN-RANGE DAYS**, which is what makes it a complete partition:
Jan 1-31 is 4 + 7 + 7 + 7 + 6 = 31 days across five Monday weeks, so the first and last
buckets are genuinely smaller, the values sum to EXACTLY the prospect's own call total
(verified 48,293), and the last week being partial is also why the final segment is
dotted.

⚠️ **THE Y TITLE IS CENTRED BY TRANSFORM ORDER, AND THE ORDER IS EASY TO GET BACKWARDS.**
Written `rotate(180deg) translateY(-50%)` the translate applies FIRST and the rotation
then flips its direction, so the -50% that should centre the label becomes +50% and the
title sits **154px below** the plot centre (measured; the computed matrix read +76.97
instead of -76.97). It must be `translateY(-50%) rotate(180deg)` — rotate in place about
the centre, then translate in the final space. Verify by comparing the label's centre
against the plot's, not by eye: a title that is merely low still looks plausible.

⚠️ **AXIS TITLES ARE HTML, NOT SVG TEXT.** `axis-label-title`, 12px/**600**/`#5b6577`.
No `.highcharts-axis-title` exists in ANY captured chart's svg, so this was wrong on
every ts chart, not just this one. They live in `TsAxisTitles` and are positioned in
PERCENTAGES, the same reason the legend is HTML and the hover panel uses percentages.

⚠️ **THE LEFT PLOT INSET IS CONTENT-DERIVED.** An earlier note here said "68 on every
cartesian chart". Re-measuring gave **62** where the y labels read `8K` and 68 where they
read `600` — it tracks the widest tick label. `leftInsetFor()` reproduces both exactly.

⚠️ **`niceTicks` count is 8 and 2.5 is NOT an allowed step.** Both from captures, not
taste: count 8 reproduces the line chart's `0..8K by 1K` (9 labels) AND the column
chart's `0..600 by 100` (7 labels). At count 6 the line chart drew **2.5K** steps, which
no captured axis uses anywhere.

⚠️ **Calendar ticks only apply when there are enough points to thin.** The grouped
column's five weekly dates all sit inside one month, so a 4-month rule there would print
one label and drop the rest. Gated on `> 12` categories.

⚠️ **THE Y AXIS DOES NOT START AT ZERO ON A LINE CHART, AND THE LOWEST POINT SITS ON THE
X AXIS.** The floor is the EXACT data minimum, not the tick below it. Flooring to a tick
is the obvious reading of the captured 100..550 axis and it leaves up to a full step of
gap — measured, a $4.74M minimum floored to $4M sat **12% up the axis** and 2:32 floored
to 2:30 sat 8% up, both of which read as the line hovering. `niceScale(min, max,
zeroBased)`: step from the DATA RANGE (not the max), floor = the min itself, top = max
plus ~5% headroom snapped UP to a tick. Verified 0px gap on every tile.

The TICKS above the floor are still round (`$6M $7M $8M …`) so the axis stays readable,
and the bottom label is the real minimum. A nice tick landing within 35% of a step of
that floor label is DROPPED — two labels a few pixels apart is worse than one, which is
why the Revenue axis reads `$4.7M $6M $7M …` with no `$5M`.

⚠️ **BARS, COLUMNS AND AREAS KEEP A ZERO BASELINE.** A bar's length and an area's fill
ARE the magnitude, so a non-zero floor overstates every difference — the captured column
chart runs 0..600 even though its smallest group is ~48. `zeroBased` is a parameter, not
a preference: lines zoom, everything whose size encodes the value does not.
⚠️ A zoom that RESOLVES to zero is not a broken zoom. The gallery's sample spans 87..503,
and 87 floored at a step of 100 is 0 — so that bench chart still reads 0..600 and is
correct. Check the arithmetic before "fixing" it.

⚠️ **Kept from the two-year attempt, because it will matter again for any long series:
a fresh hash per bucket is UNCORRELATED and renders as a perfect SAWTOOTH.** Over 112
weekly points at +/-14% it drew a metronome climbing the chart, which reads as synthetic
at a glance. If a long span is ever wanted, smooth the jitter across neighbours (a 3-week
moving average measured 42% direction flips against a sawtooth's ~100%) rather than
raising or lowering its amplitude. The five-bucket window keeps a modest +/-8% wobble,
since with five points a large jitter reads as noise rather than as a busy week.

⚠️ **`{ label: "Attribute", kind: "measure" }` IS CORRECT — do not "fix" it.** The field
looks mislabelled (it offers measures under the word "Attribute") and is verbatim right:
the capture has `<label id=measure-label><span>Attribute</span></label>`. The `id` also
independently confirms the `kind: "measure"` classification, which was originally inferred
from live option COUNTS — two signals agreeing.

## Template: "Multi-Line Chart Over Time" (measured 8/20/2026)
`TsMultiLine` in `src/components/ts/TsCharts.tsx` + `buildTile`'s
`"Multi-Line Chart Over Time"` case. Measured from a capture holding four of them (2, 3
and 4 series, plus a 4-series percent variant), so every number below has at least two
independent confirmations.

**It INHERITS the frozen single-line design** — canvas, plot insets, no gridlines, tick
count 8, the exact-minimum y floor, HTML axis titles, the dotted partial tail, the tile
frame, the window from the dashboard filter. Three things are genuinely new:

| | how |
|---|---|
| several lines | `#2666F9`, `#00DEBC`, `#FFD800`, `#2CBF58` in order, from `TS_SERIES_LINE` |
| an axis PER series | series 0 on the left, 1..n stacked rightward, **each on its own scale** |
| the legend | top-**right**, `align-self: flex-start`, 204px, 24px rows, 12px round dots |

⚠️ **EVERY SERIES GETS ITS OWN Y AXIS AND ITS OWN SCALE — they are not shared.** Measured
axis lines at x = 68 / 555 / 607 / 672: the left axis, then the plot's right edge, then
+52, then +65. The first right-hand axis sits ON the plot edge. The plot NARROWS as series
are added: measured 626 / 561 / 487 for 2 / 3 / 4 series.

Right-hand tick labels are `anchor="start"` 15px outside their axis line, and the rotated
title then sits in the space between those labels and the NEXT axis line.

⚠️ **THOSE GAPS ARE CONTENT-DERIVED, NOT CONSTANTS — and freezing them as 52 and 65 was a
real bug the user caught.** The first version explained the difference as "the first gap
really is narrower than the rest". It is not. The capture's first right axis printed the
single label `0` and its second printed `91%`; each gap is just wide enough for that
axis's own labels plus its title. One rule reproduces both:

```
gap = 15 (label offset) + widestChars * 6 + 7 + titleBand + 6
  "0"   -> 15 +  6 + 7 + 18 + 6 = 52   (measured 52)
  "91%" -> 15 + 18 + 7 + 18 + 6 = 64   (measured 65)
```

`rightAxisLayout()` in `tsChart.ts` takes the FORMATTED labels each right axis will print
and returns the line and title positions. With the frozen constants, a `$4.7M` money axis
put its title 7px INSIDE its own tick labels and straddling the next axis line — the
reported defect. This is the same mistake `leftInsetFor` exists to avoid on the left, 40
lines up in the same file.

⚠️ **THE TITLE BAND IS ITS MEASURED 18px — RESOLVED BY DRAWING 1:1.** Historical, because
it explains the shape of the bug: the titles are HTML at a fixed 12px, and while the svg
scaled with its column a title's 18px band cost `18 / scale` viewBox units — measured **16
units at scale 1.12 and 35.5 at 0.508**, same title. Reserving a flat 18 is why the
collision was invisible in a wide bench tile and obvious in a half-width dashboard tile.
Charts are now drawn at 1:1 (see "Charts are drawn 1:1" below) so the band is simply 18 and
the conversion is gone.

Verified at two widths after the fix — every title clears its own labels and the next axis
line: at scale 1.12, gaps of 2.6 / 7.1px past the labels and 6px before the next line; at
0.508, 2.5 / 7.1 and 6. The `/ts-gallery` specimen deliberately mixes a count, a money and
a duration measure so the widest label case (`$4.7M` beside `2:32`) is always on the bench;
a specimen with narrow labels would not have shown this.

⚠️ **A FLAT SERIES COLLAPSES TO ONE TICK, IT DOES NOT DRAW AN AXIS OF ZEROS.** The
capture's all-zero series rendered a single `0` label at mid-height with the line across
the middle. `niceScale` returns `{min: v-1, max: v+1, ticks: [v]}` for a flat series so a
measure with no variation in the window still reads as a level rather than as an empty
axis.

⚠️ **THE LEGEND IS TOP-ALIGNED, and `align-self: center` was a guess I had to unlearn.**
Measured y = 0 against the tile body on all four charts. It is asserted in the
non-regression check (`legendTopAligned: 0`), because vertical centring looks perfectly
reasonable in isolation.

⚠️ **THE LEGEND USES THE AXIS TITLE FORM, not the bare measure name.** The capture's
legend reads `Total Call Count` and `Answered by Agent (%)` — character for character its
axis titles. Showing `Call Count` in the legend beside an axis that says `Total Call
Count` reads as two different measures.

⚠️ **`TsMultiLine` is a SIBLING of `TsLine`, deliberately not an overload.** `TsLine` is
signed off as the frozen single-line template; adding multi-axis branches inside it would
put the reference implementation one bad conditional away from changing. `TsTileCard`
picks by `series.length > 1`. The single-line path is untouched — re-verified after this
build: 2 axis lines, 0 gridlines.

Multi-Line uses the same five-week window as single-line, from the same
`marketingDashboard.dateRange` field, so every tile on a dashboard still covers one period.

⚠️ **THE CHART FILLS THE TILE; ITS HEIGHT IS NOT DERIVED FROM ITS WIDTH.** Reported: the
x axis stopped well short of the bottom of the tile where the real instance reaches it.
Cause: `.ts-svg { height: auto }` derives the svg's height from its WIDTH through the
viewBox, so a chart that gives 212px to a legend is proportionally SHORTER than the
legend-less chart beside it, and the grid stretches both tiles to the taller one. Measured
in the reported pairing: single-line's x title sat 15px off the tile bottom, multi-line's
sat **114px** off.

ThoughtSpot sizes its chart to the container box in BOTH dimensions. `useVbBox` measures
the wrapper and the viewBox HEIGHT is derived from the real aspect ratio, so the geometry
stretches without distorting text. After the fix both x titles sit at 15px, and the
multi-line svg went 310x292 -> 310x391.

Two CSS facts, each of which cost a wrong attempt and both recorded in `ts.css`:
- **`height: 100%`, not `align-items: stretch`.** The wrapper's parent is `.ts-tile-viz`,
  an intermediate BLOCK, so the body's stretch never reaches it — measured tile 445, body
  391, wrapper still 292. A percentage height resolves against `.ts-tile-viz`, which the
  flex row DID stretch.
- **The intrinsic height is a `padding-top` spacer, not `aspect-ratio`.** `aspect-ratio`
  makes a flex item's cross size definite, so nothing can grow it afterwards. Some
  intrinsic height is required or the wrapper and the svg size off each other and collapse
  to zero.

`.ts-tile` also became a flex column so the body can receive the height the grid gives the
tile. A no-op for a tile that is already the tallest in its row.

⚠️ **THE FALLBACK IS THE MEASURED BASELINE, and that is what makes this safe.** When a tile
is NOT stretched, `.ts-tile-viz` is auto-height, the percentage cannot resolve, and the
wrapper falls back to the spacer — verified on `/ts-gallery`, where the span-2 multi-line
tile still renders viewBox exactly `748 704`. So the signed-off geometry is untouched
wherever nothing is stretching the tile.

Scope: `.ts-tile` / `.ts-chartwrap` appear only in the ts layer, `GeneratedTiles` and the
gallery. Dashboards re-checked after this change — 21 `dash-card`s, 4px radius, `display:
block`, zero `.ts-tile` — so this stayed inside the Insights tab.

✅ **RESOLVED — this was recorded here as open and is now done.** svg text scaled with the
viewBox while the HTML axis titles stayed 12px, so ticks and titles drifted apart and two
tiles in one row rendered different text sizes. Fixed by drawing at 1:1; see the next
section.

## Hover on every ts- template (8/20/2026)
`TsTip` + `useTsHover` + `TsPointMarker` in `TsShell.tsx`, `.ts-tip` in `ts.css`.

Every chart template answers a hover the same way: a dark tooltip, the hovered series at
full strength, everything else faded. Verified across all of them:

| template | tooltip | fade | point marker |
|---|---|---|---|
| Single Line | dark | one series | yes |
| Multi-Line | dark | 1 / 0.22 / 0.22 | yes |
| Dual Y-Axis | dark | bars 0.22 | yes (line) |
| Grouped Column, Stacked Bar, Calls by Hour | dark | 1 / 0.22 | no |
| Pie, Donut | dark | 1 / 0.16 | no |

KPI, Metric and the table templates have no hover: there is no data point to hover, and
ThoughtSpot does not put a tooltip on a table cell.

⚠️ **THE TOOLTIP IS `.ind-tip`, COPIED VALUE FOR VALUE — do not restyle it independently.**
`.ts-tip` began as a white two-column panel (key left, value right), which was a guess and
the only tooltip on the tab that did not match the others. `.ind-tip` was measured off the
reference, so `.ts-tip` now takes every value from it: `#2f3a4a`, 4px radius, `12px 16px`
padding, 13px/1.45, and a stacked `label:` / value pair with a 10px gap before the next.
Verified identical: computed style and row weights match character for character on a
dashboard showing both.

⚠️ **`.ind-tip` IS NOT INSIGHTS-ONLY. `DonutChart` renders it, and DonutChart appears on
MarketingDashboard, AiAgentConversionDashboard and LocationComparisonDashboard.** I changed
`.ind-tip-k/-v` believing them inverted and had to revert it: that edit reached three
Dashboards screens, which the one-screen rule forbids. The claim was also weaker than I
stated — the reference screenshots cannot settle 400 vs 600 in white text on a dark panel.
Left as measured, with the reach recorded at the rule. **If it is ever settled, change both
tooltips together.**

**The hovered line thickens by 1px and gets a marker.** `TS_LINE_W + 1` is Highcharts'
`lineWidthPlus` default, and Highcharts is what ThoughtSpot renders. The marker follows
`.ind-trenddot` (series colour, 3px white ring) plus the faint colour halo the reference
screenshots show. `activePoint` was added to `useTsHover` for it, separate from
`activeSeries` so the fade-only charts are untouched.

⚠️ **HOVER TARGETS ON A LINE ARE ONE TRACKER PATH, NOT A CIRCLE PER POINT.** Point-only
targets meant hovering the line BETWEEN two points did nothing — a user had to find a data
point. Each line series now carries an invisible tracker: the same path geometry with a
transparent `TS_TRACKER_W` (14px) stroke and `pointer-events: stroke`, which hit-tests the
stroke region regardless of paint. `onMouseMove` picks the nearest point with
`nearestIndex()` and sets series + point + tooltip. This is Highcharts' `stickyTracking`,
which is what ThoughtSpot renders. Applies to Single Line, Multi-Line and the Dual Y-Axis
line; the column, bar and pie templates keep hovering their own shapes and gained no
tracker.

⚠️ **THE POINTER-TO-DATA CONVERSION IS `e.clientX - svgRect.left`, AND IT IS ONLY THAT
SIMPLE BECAUSE CHARTS ARE DRAWN 1:1** — one user unit is one CSS pixel. Two traps: the
reference must be the SVG's rect, NOT the path's (`getBoundingClientRect` on the path starts
at its leftmost point, and compensating for that by hand was the first, wrong version); and
if the svg ever scales again this needs the viewBox conversion restored. `nearestIndex`
carries the warning.

Verified by probing mid-segment rather than at points: at 15% and 45% between two points the
tooltip reports the earlier one, at 55% and 85% the later one — the crossover sits exactly
at the midpoint — while the hovered series shows strokes `2,3,2` and opacity `0.22,1,0.22`
and the marker appears.

⚠️ **CLICK-TO-SELECT ON A LINE NOW USES `hv.activePoint`,** since there is no per-point
element to carry the index. Correct by construction — `onMouseMove` always sets the point
before a click can land — but UNEXERCISED: no caller passes `onSelect` to a ts- chart yet.
Check it when the interaction drawer is wired to Insights tiles.

⚠️ **VERIFYING HOVER: `computer{action:"hover"}` DOES NOT REACH REACT on these svg children
— it produced no tooltip at a coordinate where `elementFromPoint` returned the hit circle.**
A real `left_click` does (its genuine mouseover fires first), and that is how the behaviour
was confirmed end to end. For a SCREENSHOT of a live hover, note the screenshot action
itself moves the pointer and clears the state; freeze it first by stopping `mouseout` /
`pointerout` in the capture phase, then reload to undo.

## Clicking a datum opens the interactions drawer (8/20/2026)
`DashAssistant` (ts variant) owns the drawer; `TsTileCard` passes `onPick` to every chart.

Every data point on a generated Insights tile opens the same `InteractionsDrawer` the
built-in cards use, and **the top card always links to the call summary**.

⚠️ **`topCallHref` USED TO BE SET ON EXACTLY ONE DRAWER** — the bar chart's first bar —
reasoning that thirty cards opening one transcript under thirty different ids would be a
lie. Requested changed 8/20/2026, and `pinFirst` is what makes it honest: it REPLACES the
top card with the prospect's own `callDetail` record, so the card and the detail page always
agree on id, duration and summary. Verified end to end — drawer card `0597-627F62F2570D`
opens `/insights/call?...` showing the same id, its AI summary, a 19-turn transcript and a
pager matching the drawer's count. All three built-in sites (weekly trend, every bar, the
four donuts) now link too; a non-first bar was checked specifically, since that was the
case with no link before.

⚠️ **THE HEADER COUNTS INTERACTIONS, NOT THE MEASURE — and this is easy to get wrong
because the built-in cards never hit it.** They only ever pass call counts. A ts tile's
clicked series can be money, a percent, a duration or a score, and passing the value
straight through made a revenue click read **"8,907,516 interactions"** with 30 cards. Only
`count` and `flag` measures ARE numbers of calls; everything else uses `interactionsAt()`,
which reads the bucket's own call count from the same window machinery every tile uses.
Verified: clicking Call Count and clicking Revenue in the same week both report 11,415.

The card date comes from the category when it is a `MM/DD/YYYY` bucket and from
`rangeStartIso()` otherwise — a pie slice or a day-of-week column has no date of its own,
which is the same choice the built-in donuts make.

⚠️ **THE DRAWER IS ON THE `ts` VARIANT ONLY.** The same `DashAssistant` renders the
Dashboards tab's generated tiles, which have their own card design and no drawer. Verified
after this change: `/dashboards/marketing` has 21 dash-cards, zero `.idr-root`. The
`/ts-gallery` bench stays inert too — it uses `TsTile` directly and passes no `onSelect`.

## Charts are drawn 1:1 (the whole ts- layer, 8/20/2026)
`useTsBox` in `TsShell.tsx` + `.ts-chartwrap--fill` in `ts.css`.

**Every ts chart's svg viewBox is the container's PIXEL size. It is not a fixed box that
scales.** ThoughtSpot's charts are Highcharts, which always sets the viewBox to the
container's exact pixel size — so the capture's `748 704` WAS its pixel size, and every
constant measured off it (the 68px left inset, the 15px tick offset, the 18px title band,
the 22/5 bars, the axis gaps) is a PIXEL measurement.

⚠️ **THE OLD FIXED-VIEWBOX MODEL MADE THOSE CONSTANTS TRUE AT EXACTLY ONE WIDTH, and it
caused three separate reported or measured defects before it was replaced:**
- a title reserved 18 units where it needed 30, so it landed on its own tick labels and
  across the next axis line
- a multi-line chart could not reach the bottom of its tile
- two tiles in the SAME ROW rendered **16px and 13.5px** tick labels, because each scaled
  by its own width

**Verification, which is the real argument for it.** At each template's own measured canvas
the constants now land exactly:

| pinned canvas | measured | capture |
|---|---|---|
| single line 846x633 | plot top **15**, bottom **579** (=633-54), height **564** | 564 |
| single line 846x633 | plot left **68** (`600` ticks) | 62 for `8K`; 843-62 = **781** |
| grouped column 634.5x449 | bar **22**, gap **5**, rendering at **21.98 real px** | 22 / 5 |

The single-line plot width reads 775 against the capture's 781 for the documented reason:
our specimen's widest tick is `600` (inset 68) where the capture's was `8K` (inset 62).
Content-derived, as designed.

⚠️ **"THE BARS ARE 22" WAS NOT A PIXEL CHECK BEFORE THIS.** It read `getAttribute("width")`,
a viewBox number. In the tile it was measured in, a 634.5-wide viewBox rendered into a 427px
box, so those 22 units were **14.8 real pixels**. Any invariant asserted in viewBox units
only meant something at 1:1. Pin the canvas and assert rendered pixels.

⚠️ **1:1 REQUIRES AN EXPLICIT HEIGHT, because the svg can no longer derive one.** With
`height: auto` the svg's height came from its width through the viewBox; now the viewBox
comes from the box, so the two would size off each other and collapse to zero. Hence
`height: 100%` plus a `padding-top` spacer carrying the template's own measured ratio
(`--ts-ar`, set per chart by `useTsBox`). Both details, and the two wrong attempts that
found them, are recorded at the rule itself in `ts.css`.

⚠️ **AT 1:1 A NARROW TILE RUNS OUT OF ROOM INSTEAD OF SHRINKING.** This is the real cost and
it is handled, not hoped about: a `@container ts-tile (max-width: 700px)` query moves the
legend under the chart, which hands back the 212px it was taking. Measured on a 560px tile:
the chart went 314px -> 526px. It is a CONTAINER query because what matters is how wide
THIS tile is, and two tiles in one row differ. It replaced a viewport media query at the
same 700px, which got exactly the half-width-tile-on-a-wide-screen case wrong.

⚠️ **AND IT IS SCOPED TO `needsWidth`, WHICH IT HAD TO BE.** Unscoped it moved the legend on
the pie, donut and column tiles too — measured, their legends went from 0 to 452/456/480px
below the body top. Those were signed off with a right-hand legend and have no right-hand
axes to make room for. Only a chart with right-hand axes opts in, which today means
multi-line.

**A tile with the legend below is still FULLY used — do not read the gap as dead space.** On
the reported pairing the multi-line chart is 624 tall plus a 32px legend row = 656, exactly
the single-line's 656 svg. The original bug was 114px of nothing; 47px of legend is not the
same thing.

⚠️ **A PRE-EXISTING DEFECT 1:1 EXPOSED, fixed in the same pass.** `TsDualAxis` computed its
column width as `min(TS_COLUMN_W * 4, b.width * 0.55)` — an 88px cap and a 55%-of-band
heuristic predating the measured 22/5 fit rule, never brought in line when `TsColumn` was
corrected. It drew an **88px** column beside the grouped chart's 22px one, in the same
layer, off the same capture. It rendered at 82px on screen before 1:1, so 1:1 did not cause
it. Now uses TsColumn's rule and measures 22.

Scope: `.ts-tile` / `.ts-chartwrap` appear only in the ts layer, `GeneratedTiles` and the
gallery. Dashboards re-verified after this change — 21 `dash-card`s, 4px radius, `display:
block`, 14 svgs, 22 `chart-axis`, 25 `bar-label`s, KPI 48,293, and zero `ts-` elements.

## Build With AI -> "Create Tile with AI" (the question-to-tile drawer)
`src/components/InsightsCreateTileAi.tsx` (`.icta-`) + `src/data/insightsQuestions.ts`.
**Build With AI** on Add Tile opens its OWN drawer there; it used to navigate to
`${DASH}?ask=1`, which threw the SE onto a different screen and into the general Ask
drawer, which EDITS a page rather than creating a tile.

⚠️ **PROVENANCE: SCREENSHOT, NOT CAPTURE.** The HTML supplied with the request was the
earlier Data Display Options capture (byte-identical, 845,047 bytes) with no "Create
Tile with AI" markup in it. So layout and copy are read off the screenshot — 814px
panel, 22px/400 title, 30px/700 hero, the composer well, the 36px send circle — while
every colour, font and radius comes from the measured `--ts-var-*` tokens. Re-measure
from a capture with the drawer OPEN when one exists.
The resting state is deliberately bare (hero + composer only, as the screenshot shows);
the question catalogue sits behind a collapsed "Need ideas?".

**A QUESTION RESOLVES TO A TEMPLATE CHOICE, NOT A DRAWING.** `resolveQuestion` returns
`{template, name, measures, dimensions}` and hands it to `buildTile` — the same function
the Configuration drawer uses — so an AI tile is byte-identical in shape to a hand-built
one and inherits the ts- geometry for free. That is the standing architecture's rule
that answers come from editing the TEMPLATES.

**It is deterministic and local, no model call.** `parseQuestionList` already set the
precedent, but the binding reason is the architecture's "a number never changes once
shown": a per-answer model call returning 34% then 41% for the same question is exactly
what that forbids. Verified: the same question twice produces byte-identical tiles.

⚠️ **Questions are TOKENISED and the catalogue is FILTERED per prospect.** The examples
came from a healthcare account (Facility, Specialty, Medicare, Insurance Type).
`{BOOKING}/{LOCATION}/{CATEGORY}/{PAYMENT}` resolve through `vocabFor`, and
`questionsFor()` then drops any question this prospect's data cannot answer. Measured:
Shady Blinds offers 46/47 under a "Consultations" category, AutoNation offers 46/47
under "Test Drives", and every offered question resolves on both. Offering a chip that
answers "I could not match that" is worse than not offering it.

### The matcher, and four wrong turns it took
Getting phrase -> measure right took four iterations, each of which LOOKED right:
1. **Overlap alone, plus a `?? "Call Count"` fallback.** Every unmatched question became
   a confident Call Count tile: "Appointments by Facility" on a blinds account and
   "purple monkey dishwasher" both produced one. A tile answering a question nobody
   asked is the worst outcome available, because it looks right. Fallback removed;
   the count is used only when a DIMENSION resolved and no measure was named.
2. **Coverage measured on the QUESTION.** Sounded equivalent, was not: questions carry
   words no measure name contains ("volume", "avg", "channel", "hour"), so 15 of 47
   catalogue questions started declining. Coverage is measured on the OPTION.
3. **Rejecting an all-generic overlap.** Refused "Total Call Count" — whose only
   significant word is the generic "call" — against the measure literally named Call
   Count. The rule is narrower: if the question named a SPECIFIC word, the match must
   contain one. "Appointment Conversion Rate" names "appointment", which "Publisher
   Conversion Rate Ranking" lacks, so that similarity is refused.
4. **Plural-only stemming.** "Answer Rate" could not reach the measure "Answered".
   Stem drops a trailing "s", then "ed", then "e", applied to both sides.

Also: parenthetical qualifiers are excluded from the coverage denominator, because
"(Sale Amount)" and "(Seconds)" are not part of what a metric is called — counting them
put "Total Revenue" at 0.41 against "Revenue (Sale Amount)", just under the bar. And a
question naming only a DIMENSION ("Not Completed Reason Breakdown") becomes a count by
that dimension, which is what a pie already is.

### The Insights Ask drawer can create tiles now (it used to refuse)
`InsightsAskDrawer` hardcoded `canCreateTiles: false`, with the reason "this screen
registers its data but does not render GeneratedTiles, so a tile created here would be
stored and never drawn". **That reason expired** the moment `InsightsDashboard` started
rendering `<DashAssistant variant="ts" />`: asked for "Bar chart of Call Count by
Marketing Medium" the assistant answered "This page cannot add new tiles", a refusal
that was correct when written and became a bug when the surface arrived. Now `true`, and
`/insights/` is in `AiAssistantDrawer`'s `canCreateTiles` list too so the top-bar sparkle
can create there as well.
⚠️ **A `create` result must be PLACED, not just described.** The drawer only read
`result.answer`, so a model "create" would have been reported and never rendered — the
silent-success shape this repo keeps hitting. It now calls `addTile` on the page's own
encoded scope key.

**Explicit chart requests take the DETERMINISTIC path** (`resolveQuestion` + `buildTile`,
no model call), gated on `WANTS_TILE` so "how many calls did we get?" is still answered
rather than turned into a tile. Verified live: the exact question from the refusal now
builds a 6-bar column of the prospect's own mediums (cpc, Organic, Bing, Brochure,
Facebook, Instagram) at 22px `#2CBF58` with 0 gridlines.

⚠️ **A NAMED chart type overrides the inferred shape.** "Create a pie chart of Call
Count by Marketing Source" hit the "X by Y" rule and returned a column: the user said
pie. `NAMED_TYPE` wins, except where the question names a surface with its own template
("Calls by Hour"), which says more about the data than "bar" says about the drawing.
⚠️ **The request wrapper must be stripped BEFORE matching, not just before titling.**
Left in, "line" and "chart" count as significant words the measure has to contain, so
"show me a line chart of Call Volume Over Time" matched nothing at all. Stripping it also
gives the tile a clean heading, since the chart type is already visible in the chart.

⚠️ **The catalogue IS the regression test.** Every listed question is one that resolves,
so a matcher change that breaks one shows up immediately. Run
`npx tsx` over `questionsFor` + `resolveQuestion` after touching any of it.

Verified end to end with the drawer: typing "Revenue by Marketing Campaign" resolved to
a Stacked Bar of Revenue (Sale Amount) by Marketing Campaign, and "Add to dashboard"
landed a tile rendering through the ts- layer (22px `#2CBF58` bars, 0 gridlines, no
`.dash-card` leakage).

## INSIGHTS & ANALYTICS — the standing architecture (agreed 8/18/2026)
Context for every I&A screen we build. Not yet implemented; this is the contract.

### Two phases
- **Phase 1** = everything the platform already generates (`research -> terms -> an
  18-phase concurrency-6 pool` in `engine/core.ts`). It ends where it does today and
  the SE starts using the platform immediately.
- **Phase 2** = Insights & Analytics, kicked off when Phase 1 SAVES, and it runs
  **SERVER-SIDE against the saved demo**. Not in the browser: closing the tab or
  navigating away must not leave a half-generated tab, it runs ONCE per demo, and a
  colleague opening that demo later finds it finished.
- Opening the tab mid-run shows a PROGRESS BAR; opening it after shows the tab. The
  existing `progress({ phase, status })` callback already feeds a real percentage, so
  the bar reports actual phases rather than a timer.

### The data pool
- I&A derives from the PHASE-1 DATA. It never invents a parallel universe: 10
  campaign sources in the pool means 10 rows on screen, 48,293 calls means 48,293,
  and every filter narrows that same pool.
- **MINT ONCE, THEN REUSE FOREVER.** Phase 2 mints the dimensions the pool lacks
  (measured against a real profile: repeat callers, monologue duration,
  commitment-to-help, words of interest, facility, specialty, transfer rate).
- **MINT ON DEMAND, THEN PERSIST.** When someone later asks for something Phase 2
  did not mint -- "top locations by call volume", say -- generate it THEN, write it
  back, and read it from there ever after. The rule is that a number never changes
  once it has been shown: asking twice, or building a tile from an answer, must agree.
  A per-answer invention that returns 34% and then 41% is the failure this avoids.
- **RE-SKIN EVERY DIMENSION PER INDUSTRY**, the way `bookingTerm` already works.
  "Specialty" is a product line for a retailer and a service type for a plumber;
  "facility" is a showroom or store; "insurance type" is a finance/payment method.
  A blinds company must never show "Medicare".

### Ask AI in this tab
- Creates DASHBOARDS, creates and removes TILES, edits any data (numbers,
  percentages, titles, charts), and answers questions about the data. The four
  standing AI-button rules above apply unchanged -- skeleton, CSS, fonts and colours
  are never editable, and a tile's own button only ever changes that tile.
- **ANSWERS DEFAULT TO A TABLE.** Paragraph, line and pie only when asked for.
- The visualisation TEMPLATES the user supplies are the foundation: new tiles and
  assets are produced by editing those templates, not by inventing a look per answer.

### Open point to settle before building the write-back
Minting on demand WRITES to a saved demo, and demo editing is server-enforced
(creator or admin). An SE asking a question on a colleague's demo cannot write to it.
Planned default unless told otherwise: persist to the demo when the asker may edit it,
otherwise keep the minted dimension in that session's override layer so their view is
still self-consistent, and never silently fail.

## THE FOUR STANDING AI-BUTTON RULES (Dashboards tab + Reports tab)
These are the user's standing rules, not a one-off request. `npm run audit:ai` checks
them statically; it has caught a real regression already, so run it after touching any
dashboard, report, the drawer, the guard or the prompt.

**Rule 1 — presentation is NEVER editable.** CSS, fonts, colours, spacing, and WHICH
KIND of chart a built-in tile is. Structurally true, not just prompted: no data value
reaches a `className` or `style` (the only data-driven classes are boolean toggles
between designed states), and chart type is chosen in JSX. The prompt also declines
restyle and change-the-chart-type requests, verified live.

**Rule 2 — all the DATA is editable.** Numbers, percentages, titles, chart values
("show a massive dip on Jan 5th" -> that series' value at that index), add/remove a
COLUMN, add/remove a TILE, add/remove a chart SERIES, pie SLICE or axis POINT.
- Length used to be blocked because length drives layout. The safety MOVED, it did not
  disappear: `chartFit.ts` (fitValues/fitCells) makes renderers TOTAL, and only then
  does `editGuard`'s LENGTH_IS_CONTENT allow those shapes. **Do not add a pattern to
  that list until the renderer can survive the wrong length.** It stays an allow-list;
  TYPE changes are blocked everywhere, always.
- `fitValues` returns null for an EMPTY series and the caller skips it: a new series
  must not draw a flat line along y=0, which reads as a real measurement of zero.
- Column ops cover BOTH table shapes -- `dimensionColumns`/`cells` (Digital Journey)
  and `metricColumns`/`metrics` (dashboard breakdowns) -- via `resolveTableShape`,
  and take the FOCUSED table's path so a breakdown edits its own columns.
- "Delete a tile" HIDES it (`hidden` per scope key, keyed by tile id) and never
  destroys data, so Undo and "put it back" are free. `HiddenTileStyles` emits one
  `:has()` rule per hidden tile; that is app CSS keyed off app state, not the model
  writing CSS.

**Rule 3 — a tile's own AI button changes ONLY that tile.**
- The tile declares its id/path; `findTilePath` derives it from the page data when a
  screen does not, and REFUSES when a heading is ambiguous rather than guessing.
- A card is not always one subtree: `<stem>Title` siblings (`trendTitle` +
  `trendChip` + `trendChart`) resolve to the sibling GROUP, so focus paths can be a
  LIST. An explicit prop always beats the lookup, and must, wherever two cards share
  a heading but read different data (Product Category table vs its graph).
- `constrainToFocus` ENFORCES it: keep what is inside, remap a same-container
  wrong-index edit onto the focused tile, DROP the rest and say so.
- **When you filter or reorder a list before rendering, keep the original index**
  (`map((b,i)=>({b,i}))`). Building a path from a filtered index is the original bug.

**Rule 4 — the header AI button applies to the whole page.** Scope `dashboard`.

### Traps this cost us, do not re-learn them
- **A self-contradicting prompt is worse than either rule.** Adding "you MAY add
  columns" while leaving "NEVER change the number of rows/series" made the model pick
  the prohibition, and "add a Total Calls column" came back as a plain answer. The
  canary now fails if the old line reappears.
- **Interpolating an array into the prompt.** Widening `path` to `string | string[]`
  told the model its data lived at `"trendTitle,trendChip,trendChart"`; every edit was
  then discarded for being outside the focus.
- **"I couldn't map that change" vs "I refused it."** Reporting confusion when the
  truth is refusal sends the user off rewording a request that was understood.
- **The Reports screens did not render `<DashAssistant />`.** Both "add a tile" and
  hiding were silent no-ops there until it was added.
- **Measure against the profile you rendered.** A coverage figure comparing Shady
  Blinds headings to Big O Tires data read 57/77 when the truth was 68/77.
- **`Lead Form Performance Summary` IS editable** — an earlier note here claiming it
  was not was wrong. It is computed by `deriveLeadFormGroup`, but MarketingDashboard
  FOLDS the derived group into the data it registers (`leadFormSummary`), so edits
  target `leadFormSummary.*`, the override sits on top of the re-derived value, and
  they persist. The claim came from measuring `findTilePath` against the raw profile
  instead of the object the page registers — check the registered data, not the seed.
  Verified live: Lead Form Count 24,867 -> 31,402, and its labels and title too.
- **A card with no `path` uses its HEADING as its tile id.** `data-tile={tileId(path)
  ?? title}` on the head, and the drawer resolves hide targets with the same fallback.
  Both sides must agree or hiding silently does nothing; the canary checks that. This
  is what makes every card hideable without threading a path through ~35 call sites.
- Source-text checks are not runtime checks: `data-tile={tileId(path)}` LOOKS tagged
  but React omits the attribute when no path is passed, so those cards could not be
  hidden while every file read as correct. The fallback above closes it.

## Ask AI: focused edits must land on the focused tile
- **The bug, for the record.** Renaming the "Conversions by Product Category" tile
  with the AI silently failed: the drawer said "Updated the tile title", that tile
  did not change, and "Calls by Region" got renamed instead. Reproduced 6/6 against
  the real endpoint, focused and named alike -- deterministic, not flaky.
- **Cause: render order is not array order.** MarketingDashboard did
  `filter(b => b.hasDonut)` and rendered those first, then the one table-only
  breakdown LAST. So Product Category is 6th on screen but index 4 in the array, and
  index 5 renders 5th. The model reasons about the page as RENDERED, counted the
  tile it could see, and returned `breakdowns.5.title`. It landed on the single tile
  whose screen position disagrees with its index -- i.e. exactly the one being edited.
- **Two things I checked first that were NOT the cause**, so nobody re-checks them:
  the 12,000-char `dataContext` truncation in AiAssistantDrawer (the payload is only
  ~6KB and the title sits at offset ~4,200 in all 20 profiles), and the prompt, which
  explicitly permits editing "a title/label".
- **Fix, in three parts:**
  1. The tile declares its own path. `AssistantFocus.path`, an OPT-IN prop threaded
     `CardHead -> DashTileMenu/DashTileToggle -> DashTileAi`. Tiles that pass nothing
     behave exactly as before.
  2. The prompt is told the path outright ("THIS TILE'S DATA IS AT ... every edit
     path MUST begin with it; do NOT count tiles by screen position"). 4/4 correct
     after, vs 0/6 before.
  3. `constrainToFocus()` in editGuard.ts ENFORCES it, because instructing is not
     guaranteeing: an edit already inside the focused path is kept; a same-container
     wrong-index edit is REMAPPED onto the focused tile when that leaf exists there;
     anything else is DROPPED and the drawer says so rather than reporting a clean
     success. 7 unit tests including the negatives (never invents a key, no-ops
     without a path).
- **Keep the index when you filter.** Any dashboard that reorders or filters an array
  before rendering must carry the original index (`map((b,i)=>({b,i}))`) and pass
  `path={`breakdowns.${i}`}`. Done for MarketingDashboard and
  AiAgentConversionDashboard, which share the layout. A new screen that filters
  without doing this reintroduces the bug silently.

## Verify Labels (Signal AI Studio > Verify Labels)
- `src/screens/VerifyLabels.tsx` + `src/data/verifyCalls.ts`, route
  `/signal/ai-studio/verify/:modelId?label=&name=&round=&p=`. Reached from the
  "Verify Labels" button on a Signal AI Studio row. Real page:
  `/networks/2160/label_groups/manage/verify_calls/532?round=5&folderId=...&callId=...`.
  Only the row whose action IS "Verify Labels" navigates; "Label Calls" is a
  different flow we have not built and stays inert.
- Values MEASURED off a SingleFile save of the live page (8/17/2026). **Two of them
  the screenshot actively misleads about, so do not re-derive either from an image:**
  - The accuracy readout is NOT a percentage bar. Four layers: track `#e7e9eb` r5;
    a darker `#b8bdc5` band covering only 80-100% (radius `0 5 5 0`); a HATCHED
    confidence interval (`repeating-linear-gradient(135deg, rgba(38,102,249,.3)...)`,
    1px `#2666f9`); a 1px point-estimate tick; and a chip labelling the interval.
    Live values: interval 89.7->97.6%, tick 93.5%, chip "90%-98%".
  - **"Save & Next Call" is OUTLINED white** (bg `#fff`, border
    `1px rgba(38,102,249,.5)`, ink `#2666f9`), not the filled primary it looks like.
    "Review Last Call" and "Train AI Model" are the disabled greys
    (bg `#e7e9eb`, border `#d0d3d8`, ink `#a1a7b2`).
- Other measured values: eyebrow `<a>` 12px/700 `#2666f9` **uppercased via CSS**
  (DOM text is mixed case); h1 24px/400; card white `2px #e7e9eb` r3 w468 pad24;
  "Signal Activated" chip bg `#abe5bc` ink `#0d5400` r16; T:/F: and description
  16px/400 `#66708e`; segmented True/False/Not Sure = three JOINED outlined buttons
  ~138x36 with **border-radius 0**, selected bg `#d4e0fe`, 20px icons; Verified
  Calls bar 165x18 (live 47.5%); transcript turn rules 2px r5, **agent `#855ede`,
  caller `#e4126f`**.
- "Predicted by AI" is a bracket over WHICHEVER button the AI chose (the cell is
  `position: relative`), not a fixed label. Bracket = top rule + two 14px end ticks
  + a 10px centre stem in `#5b6577`.
- **THE FIVE CALLS ARE DERIVED, NOT GENERATED.** Slots 1 and 3 are the profile's own
  `reports.callDetail.transcript` and `reports.conversationIntelligence.transcript`
  (real, prospect-specific, and `callDetail` already has this page's exact shape:
  `speaker`/`time`/`text` with `****` redaction). The other three are templates
  filled from `customerName`/`bookingTerm`, plus two fallbacks so a profile missing
  either report still shows five. No engine phase: generation time is unchanged and
  every one of the ~60 saved demos gets the screen. Adding a phase instead would
  have left them all empty until regenerated.
- **The AI is deliberately WRONG on call 4.** If it were right on all five the SE
  clicks True five times, accuracy sits at 100%, and no prospect believes it. Call 4
  is a price shopper using every scheduling phrase and committing to nothing; the AI
  says True, the honest answer is False, and disagreeing visibly drops the interval
  (verified: 82-99% -> 73-99%, back out of the grey target band).
- Accuracy = **how often the human AGREED with the AI**; the human is ground truth,
  so nothing stores a "real" answer. A 95% Wald interval on that rate, which is why
  it narrows as calls are verified. Two deliberate departures: the variance is
  floored so a perfect run still shows a band instead of a zero-width line, and the
  ends clamp to [40, 99] so it cannot draw past the track.
- **"Not Sure" advances but scores nothing** - no T/F, no accuracy move. You cannot
  measure agreement against an answer the reviewer declined to give.
- **"Review Last Call" UN-APPLIES its save** (`Saved` records carry the delta).
  Without that, stepping back and re-saving counts the same call twice and quietly
  inflates the accuracy an SE is standing in front of. Verified round-trip exact.
- **`convStartIndex()` compares SECONDS, never strings.** Real data breaks string
  equality both ways: the Shady Blinds seed has `convStart: "00:00"` and three saved
  demos have `"00:16"` with no turn at exactly that second, so an exact match drew no
  marker at all and did it silently. Index 0 IS a legitimate position (7 of 11
  profiles have a first turn at 00:16, and a marker there says the record began 16s
  before anyone spoke); only `00:00` is vacuous and suppressed. An earlier version
  refused index 0 and so drew nothing on those 7.
- `?p=<profileId>` stamps the owning prospect. **A model belongs to one account**, so
  switching the network selector invalidates the label, name and hashed date: without
  the guard the page showed `consultation_set` over National Van Lines' calls. On
  mismatch it redirects to `/signal/ai-studio`.
- Article agreement matters here: `labelDescription()` picks "a"/"an", or every
  vowel-initial booking term reads "for a estimate" in a sentence a prospect is
  looking straight at.
- CSS trap: hover is written `.vl-seg-btn:not(.vl-seg-btn--on):hover`. As a plain
  `:hover` it ties `--on` on specificity and wins by order, so the selected button
  turned hover-blue under the pointer and read as unselected.
- "Train AI Model" stays disabled with an explanatory `title`, matching the capture.
  Ask AI is scoped to the label and its description only; transcripts are out of
  scope because an edit could contradict the AI prediction shown beside them.

## New Semantic Signal (the library's Activate flow)
- `src/screens/SemanticSignalActivate.tsx`, route
  `/signal/new/semantic/activate?trackerId=146&standardDataFieldName=$.<name>`. The query
  string matches the real page, so the template is identified the way Invoca identifies it
  and a refresh or a pasted link still resolves.
- Values MEASURED off the live page 8/14/2026, not eyeballed: rail 296px, MUI vertical tabs
  48px min-height / 12-16 padding / 16px, selected `#d4e0fe` with a 2px `#2666f9` indicator
  on the RIGHT edge, `text-transform: none`; h1 24px/400; label 16px/700; input 16px,
  padding 6px 8px, radius 3px; Phrases 20px/700; Save `#2666f9` 14px/500. Ink `#15243e`.
  The only value taken from the SCREENSHOT is the small-caps "ADVANCED OPTIONS" divider,
  because the live DOM probe for it matched the TAB, not the section heading.
- **The rail SCROLLS, it does not swap panels.** All three sections render at once and the
  tabs jump to them, which is what the real page does. A tab-panel version looks identical
  on load and is wrong the moment anyone clicks.
- ⚠️ **Smooth scrolling cannot be used on `.main` in this app's browser.** Measured:
  `scrollTo({behavior:"smooth"})` leaves `scrollTop` at 0 while a plain jump to 600 lands
  at 600; setting CSS `scroll-behavior: smooth` then breaks the plain write as well, so
  NOTHING scrolls; a rAF tween is no good either because rAF does not run when the pane is
  not painting. The jump is a plain clamped `scrollTop` assignment. Don't "improve" it.
- ⚠️ **Programmatic `scrollTop` fires no scroll event here**, so testing a scroll-spy by
  assigning `scrollTop` proves nothing. Verify with real clicks or a real wheel gesture.
- The spy listens at `document` with `capture: true` (scroll does not bubble) and resolves
  the scroller on EVERY event: resolving it once in an effect ran before layout settled,
  found nothing scrollable, and silently never attached.
- **The last section is anchored to the bottom of the scroll.** It starts inside the final
  viewport so it can never reach the top, and without that clamp clicking "Advanced
  Options" jumped correctly and the scroll event immediately re-selected "Phrases", which
  reads as the click having failed.
- Phrases are NOT re-skinned per prospect: the stock library is identical in every Invoca
  account (`data/semanticSignals.ts`). The live measurement confirmed all 44 "Ask for
  Appointment" phrases match that file verbatim.
- **Only `captured: true` templates activate.** Today that is exactly the top row (Ask for
  Appointment, Ask for Sale, Competitor Mention); the other twelve carry phrase lists
  AUTHORED IN THIS REPO, and opening a form full of invented Invoca content in front of a
  prospect is worse than a button that declines. Their button is visibly disabled, not
  silently inert. Gated on the FLAG, not a list of names: capture a real list, flip
  `captured: true`, and that card starts working with no component change.
- Note the activation screen costs NO generation time. Its phrases are static template
  data, so the gate is about provenance, not speed.

## Preview Agent: changing the agent's questions (4 ways)
- The Ask AI drawer on `/agent-studio/agent/preview` can change
  `smsPlaybook.qualifyingQuestions` four ways: **one by one**, **paste a list**,
  **import a file**, **or name a use case** and let the assistant rewrite them all.
- **The split is deliberate.** Paste and import are **local, no model call**
  (`src/data/questionImport.ts` -> `parseQuestionList`). The user already typed the exact
  words; sending them through Haiku to be echoed is the same mistake `AssistantColumnOp`
  documents (it paraphrases, reorders, drops the tail). One-by-one and use-case ARE
  judgement, so those go to the assistant.
- `parseQuestionList` handles: numbered/bulleted lists, a `Questions` header line,
  CSV/TSV with or without a header (finds a `question`/`prompt`/`ask` column, honours
  `"quoted, fields"`), a single run-on paragraph split on `?`, dedupe, and a
  `MAX_QUESTIONS` cap that is **reported, never silent**.
- **Preview Workflow has its OWN sparkle**, in the chat drawer's header beside Reset,
  with its own undo. **Both are hidden until the header is hovered** (`.wcp-icon-hover`,
  `focus-within` for the keyboard): Reset and Close are part of the real Invoca widget,
  the sparkle and undo are ours, so at rest the replica matches the capture. They hold
  their layout space and only fade, or the header reflows under the cursor.
- **It opens the drawer on the LEFT** (`side: "left"` on the focus). The chat is on the
  right and the whole point is watching it pick the edit up, so the drawer must not cover
  it: no backdrop (which would dim AND swallow clicks on the chat), `pointer-events` only
  on the panel, and a width of `min(420px, max(300px, calc(100vw - 412px)))` so it yields
  to the 400px chat instead of sliding under it. Verified side by side at 766px. It edits the SMS agent (greeting + questions). The workflow page's
  top-bar sparkle edits the DIAGRAM and nothing else. Two different things, two buttons:
  one button doing both was the confusing version.
- **How a preview's sparkle gets its own scope**: `openDrawer({ scope: "agent", key,
  questionPath, label })`. An `agent` focus CARRIES its scope, and the drawer synthesises
  the active scope from it instead of the page's. That keeps exactly one scope in play per
  opening, so `applyEdits`, the undo stack, the question tools and the model context all
  work unchanged. Do NOT solve this by registering a second scope: `registerScope` is
  last-write-wins and would repoint the page's sparkle away from its own data.
- `registerBase(key, data)` seeds a foreign scope's base WITHOUT making it active.
  `applyEdits` returns 0 for a key with no base, so an SE who opens Preview Workflow
  without ever visiting the Preview Agent tab would make edits that silently did nothing.
  Fills only, never overwrites: the owning page registers a richer object.
- The workflow chat also restarts on a config change (`.wcp-restart`) and uses the shared
  `resolveGreeting`.
- **The tools are OPT-IN via the scope's `questionPath`** (`usePageData(base, { questionPath })`).
  Four screens register `agentConfig` -- Agent Config, AI Recommendations, Knowledge
  Sources and this preview -- so all four have a question list in their data. Gating on
  "the data has questions" would light up three screens nobody asked to change. Verified:
  the tools appear on the preview only.
- **`editGuard` already exempts `qualifyingQuestions`** from the array-length rule
  (`LENGTH_IS_CONTENT`), which is what lets add/remove work here and nowhere else.
- **Assistant-written questions get `stripGeneratedDashes()`** in the drawer before
  `applyEdits`. `engine/chat.ts::stripDashes` only cleans the agent's live replies, so a
  generated question kept its em dash ("stay in touch-text, email, or phone?"). Pasted and
  imported lists are NOT cleaned -- the user's own punctuation stays verbatim.
- The list in the drawer reads from EFFECTIVE data, so it updates live and is the
  confirmation that an edit landed. Undo covers the local paths too.
- **The phone restarts itself when the config changes.** `PhonePreview` compares a
  serialised `brain` across renders; on a change it clears the thread, drops the
  conversation identity (so the chat that already happened stays in the SMS report as
  its own record rather than being overwritten), re-issues the greeting under the new
  config, and flashes `.phone-restart` OUTSIDE the phone frame -- the screen itself has
  to stay a believable iMessage mockup. Serialise the WHOLE brain: the questions live
  under `brain.playbook`, and picking `brain.questions` / `goal` / `bookingType` reads
  as `undefined` for all three, so the signature never changes and nothing restarts.
- **The greeting is editable data too.** `smsPlaybook.greeting` (OPTIONAL in the schema,
  so every existing profile and saved demo still parses). Precedence in `buildSmsBrain`:
  an extra workflow's scripted `openingMessage`, then the stored greeting, then
  `defaultGreeting()` derived from `bookingType` + `offer`. Derived rather than
  engine-generated so nothing needs regenerating; the `offer` goes in VERBATIM as its own
  sentence, because splicing it mid-sentence needs the first letter lowercased and that
  mangles "72 Hour Sale" and brand names. Side effect: the opening line is now identical
  on every run, where the model used to improvise it per load.
- **The greeting addresses the customer by name** via a literal `{name}` token, resolved by
  `resolveGreeting()` in `smsBrain.ts` from `reports.voiceScreenpop.callerName` (falls back
  to "there"). That name is deliberate: the SMS thread and the Voice Screenpop then name the
  SAME customer instead of inventing a second one. The token is STORED, never the resolved
  name, so a demo shown against a different caller still addresses the right person.
  The drawer shows the RESOLVED text (it must match the phone) but sends the RAW token to
  the model, and the prompt forbids a hard-coded first name. One resolver, called by both
  the phone and the drawer, or the two drift on the fallback.
- **Three traps, all hit while building this:**
  1. `editGuard` blocked the FIRST greeting write. `undefined -> string` is a type flip, and
     the field does not exist until someone sets it. Fixed with `CREATABLE_WHEN_ABSENT`
     (narrow, named list). Same shape as the `cells` bug already documented there.
  2. Even unblocked, the model wrote the new greeting to **`brandConversationRules.0`**,
     overwriting a real brand rule, because `smsPlaybook.greeting` was NOT IN THE DATA it
     was shown (it was derived). The drawer now injects the derived greeting into the
     serialised context, so the model edits a field it can actually see. **If a value is
     on screen but not in `dataContext`, the model will write it somewhere else.**
  3. Both failures were SILENT and the model reported success both times. Never trust the
     assistant's prose confirmation; assert against the data or the rendered value.
- **NURTURE = RE-ENGAGEMENT.** Someone who was interested, then went quiet (stopped
  replying, or a rep could not reach them); the agent picks that thread back up, finds
  what stalled it, and still drives to a booking. It is NOT a cold opener and NOT a
  no-booking newsletter. `schema.ts` already said this for the extra nurture workflows
  ("re-engage prospects who went quiet after intake"). Each use-case chip carries a
  `brief` (a paragraph, not the label) because a one-word label lets the model invent
  its own meaning, and `engine/assistant.ts` states the nurture definition too.

## Feedback / Support & feature requests
- The launch-form button is **Support** (`.fb-fab`); inside, the two kinds are
  **Feedback / Support** and **Feature request**. The board splits them into TABS,
  because one is "something is broken" and the other is a backlog: mixed together you
  read past the wrong kind to find the one you came for. Each tab shows its own count
  and how many are still open.
- **Button**: `src/components/FeedbackButton.tsx` ("Support"), beside Read.Me in the `LaunchCorner`
  stack (`App.tsx`). Opens a modal rather than routing away: someone has a thought about
  the tool WHILE using it, and making them leave the page is how you get no feedback.
- **Board**: `/feedback` (`src/screens/FeedbackBoard.tsx`), full-page outside the shell,
  because it is about the TOOL, not a prospect's demo.
- **Getting there**: `InboxButton` in the corner stack, **admin only** (it renders null
  otherwise, so a normal SE never sees it), with a badge of how many are still open. The
  badge is the point as much as the button: a passive signal beats a board you forget.
  It shows no badge at zero, because a permanent "0" trains you to stop reading it.
  - Placement is **provisional** (the alternative was folding it into Support as a split
    control). It is one line in `LaunchCorner` and its own component, so moving it is a
    deletion plus a chevron, and nothing else in the feature knows where it lives.
  - It fetches `GET /api/feedback?summary=1` -> counts only, 79 bytes vs 1.6KB for the full
    list on four items. Rendering a badge must not download everyone's submissions, and
    that gap grows with the backlog.
  - The in-form link reads "See all submissions" for an admin and "See what I've sent" for
    everyone else; same summary call decides.
- **Visibility is server-side** (`engine/feedbackApi.ts`): a submitter sees only their own
  items, an admin (`isAdmin`, same list as the demo library) sees all and can change
  status. The list is filtered BEFORE serialising, so someone else's text never reaches a
  browser that shouldn't have it. A client-side filter would be a suggestion.
- **The submitter comes from the SESSION**, never the request body. No name/email fields to
  fill in or spoof, and the completion email always has a real address.
- **Storage**: `engine/feedbackStore.ts`, one JSON per item under `DATA_DIR/feedback/`,
  atomic write, same Render disk as the demos. No database for a handful of items a week.
- **Attachments** (up to 5, 10MB each) land in `DATA_DIR/feedback-files/<id>/`. Uploaded as
  RAW BYTES to `POST /api/feedback/:id/files?name=&type=`, one call per file, after the item
  exists. Not base64 in the JSON: it inflates a third and two screenshots would blow the
  body limit. A failed upload does NOT fail the submission; the names are reported instead.
  - `server.ts` registers `express.raw()` for that path BEFORE `express.json()`, or a PNG
    is rejected as malformed JSON. The Vite dev twin concatenates **Buffers**, never
    strings, which would corrupt every byte above 0x7F.
  - **Serving is the security story.** The stored filename is rebuilt from scratch
    (`safeName`) and resolve-checked, so `../../../server.ts` becomes `2-server.ts` inside
    the item's own directory (verified). Types are an ALLOW-list. Downloads set `nosniff`,
    and only RASTER images are `inline` — **SVG is deliberately served as a download**,
    because an inline SVG on this origin can run script and read the session.
  - Only the submitter can attach; only the submitter or an admin can download.
- **Query params must be DECODED.** `qs()` returning a raw value made `image%2Fpng` fail the
  allow-list, so every image upload 415'd while `name` (decoded separately) looked fine.
  It decodes now, and splits on the FIRST `=` only.
- **Email**: `engine/mailer.ts`, sent FROM your own address TO the submitter's sign-in
  address. TWO routes, tried in order:
  1. **Gmail API** (what is actually used). Invoca's Workspace **blocks app passwords**
     ("The setting you are looking for is not available for your account"), so SMTP was a
     dead end. This reuses the SIGN-IN OAuth client plus a refresh token minted once at
     **`/auth/gmail`** (admin only). That route reuses the EXISTING `/auth/callback`
     redirect URI, distinguished by a `gmail:` state prefix, so nothing new has to be
     registered in the Cloud Console beyond adding the `gmail.send` scope.
     - `access_type=offline` **and** `prompt=consent` are both required. Without the
       prompt Google reuses a prior grant and returns no refresh token at all, which is
       the classic "it worked but there is no token" dead end. The callback says so
       explicitly if it happens.
     - The token is shown ONCE on a page and never written to disk or logged.
     - Access tokens are cached until a minute before expiry; no background refresher.
  2. **SMTP app password**, kept for a tenant that allows them. Chosen over a transactional provider: no
  vendor, no DNS verification, and a reply lands in a real inbox.
  - `SMTP_APP_PASSWORD` is a Google **app password**, not the account password.
  - **Unconfigured is a supported state.** No SMTP vars means the feature works end to end
    and the would-be email is logged. `emailEnabled` is reported by the API so the form
    and the board never PROMISE an email that cannot be sent.
  - Fires only on entering a `TERMINAL` status (currently just `Complete`), and only once:
    `notifiedAt` is stamped on a successful send, so re-saving cannot mail twice. It is NOT
    stamped on a failed send, so an item completed before SMTP existed still notifies later.
  - `sendMail` never throws. A notification failure must not fail the status change that
    triggered it, or the admin sees an error for an item that already saved.
  - The title is user text and goes into HTML email: it is escaped (verified).

## Read.Me button + the in-app docs
- `src/components/ReadmeButton.tsx`, mounted **once in `App.tsx`** inside `<BrowserRouter>`
  but outside `<Routes>`. Fixed bottom-right pill, `.readme-fab` in `app.css`.
- **It renders ONLY on the launch form** (`SHOW_ON = ["/", "/launch"]`). Everything past
  that form is a replica of Invoca's product shown to a prospect, and a floating
  internal-docs button on a dashboard reads as ours rather than theirs. The launch form is
  the one screen that IS our tool. It is an ALLOW-list, not a deny-list, so a new route
  defaults to not carrying it.
- There are deliberately **no overlay-hide CSS rules** for it. `.aiad`, `.idr-root`,
  `.sdr-root` and `.vp-root` all live inside the app shell, which the launch form is not
  part of, so those selectors could never match. Don't re-add them.
- **The docs ship with the app.** `public/readme.html` is copied into `dist/` by the build and
  served by `express.static`, so `/readme.html` works on Render, on `npm run serve`, and in
  dev. No external host, no claude.ai account needed. Opens in a new tab so an SE mid-demo
  doesn't lose their place. Two tabs inside it: "The short version" and "Technical detail".
- **It reads its own deployment.** A small inline script fetches `/api/status` (public, counts
  and booleans only) and fills the commit SHA and *every* printed demo count. The count is a
  **class** (`.s-demos`, 8 instances incl. one SVG `<tspan>`), not an id -- wiring only the
  masthead left the prose saying 58 while the chip said 9. Writes are guarded: off Render
  `commitShort` is null, so the printed SHA stands. Update that printed SHA when it drifts.
- `.mast` / `.tabs` sit **outside** `.wrap`, so they must not carry `.wrap`'s negative inset
  margins -- `margin: 0 -30px` there pushed 60px past the viewport and scrolled the whole page
  sideways. They're full-bleed already; padding alone gets the look.
- Hidden (`opacity: 0; pointer-events: none`) whenever an overlay is open, keyed off the real
  open-state selectors via **`body:has(...)`**: `.aiad--open` (Ask AI, z-3000) and the z-1200
  full-viewport drawers `.idr-root` / `.sdr-root` / `.vp-root`. **Add new overlays here.**
  It must be `body:has()`, not `.app:has()` -- the button is mounted above `.app`, so an
  `.app`-scoped selector silently stops matching.
- **Two different demo counts, both correct.** `/api/status.demos` is `listDemos().length`,
  the shared library on the server disk -- that is what the doc prints. The Launch picker's
  "My demos" adds locally-registered profiles that were never published, so it reads higher.
  Don't "fix" one to match the other.
- `ARCHITECTURE.md` is the Markdown source of truth; keep it and `readme.html` in sync.

## `.env` and the dev server (a silent-config trap)
- `vite.config.ts` reads `.env` with `loadEnv()`, which returns an OBJECT and does **not**
  populate `process.env`. The API plugins are handed the few values they need explicitly,
  but the **engine modules they dynamically import read `process.env` directly**
  (`DEMO_ADMIN_EMAILS` in `demoApi`, `SMTP_*` in `mailer`, `DATA_DIR` in `demoStore`).
  Under `npm run dev` all of those were empty regardless of what `.env` said.
- Symptoms are silent, which is why this cost time: admin-only UI simply never appeared
  locally, and a completion email would never have sent while the code looked correct.
- Fixed at the top of `defineConfig`: every `loadEnv` key is copied onto `process.env`
  unless a real shell variable already set it (so `FOO=1 npm run dev` still wins).
- `npm start` / `npm run serve` were never affected: they use
  `node --env-file-if-exists=.env`, which populates `process.env` properly.
- **Engine changes need a dev-server RESTART**, not just a save: those modules are
  dynamically imported and Node-cached. A stale one answers new routes with the old
  shape, which is how `?summary=1` came back as a full list.

## Generation: optional fields become REQUIRED (a real bug, twice bitten)
- `toSchema()` in `engine/core.ts` runs `sanitize()`, which sets
  `required = Object.keys(properties)` on every object. That is deliberate (strict
  structured output has no optionals) and it means **every `.optional()` field in a
  generated type is forced onto the model**.
- That is fine for content the model should invent, and **wrong for any field the APP
  writes later**. `InteractionRow.cells` is written by `columnEdits` when a column is
  added; forcing it made the model emit a 2-entry `cells` against 6 `dimensionColumns`,
  and `leadingCells` preferred it, so the Digital Journey report rendered an interaction
  count under "Marketing Source" and revenue under "Marketing Medium" while the six
  correct values sat unused in the same row. Hit `autonation` (a bundled seed, in git)
  and every demo generated after 2026-08-04.
- **Fix pattern**: generate with a type that omits app-owned fields, e.g.
  `DIGITAL_INSIGHTS_GEN = DigitalInsightsReport.extend({ rows: z.array(InteractionRow.omit({ cells: true })) })`.
  Adding a new app-written row field? Add it to that omit list in the same commit.
- **`leadingCells` now only trusts `cells` when `cells.length === headers.length`.** A
  mismatched array is damage, not data, so it falls back to the named fields. This is
  what makes demos ALREADY saved with the bad array render correctly, including live ones
  nobody is going to re-generate.
- **Four layers now stop this recurring**, because the schema omit alone is one edit away
  from being undone:
  1. `DIGITAL_INSIGHTS_GEN` omits app-owned fields from the generation schema.
  2. `stripAppOwnedFields()` deletes them from the result anyway, whatever comes back.
  3. `auditProfile()` (engine/canary.ts) has four Digital Journey checks: canonical
     dimension columns, no app-owned `cells`, signals aligned to signalColumns, and no
     blank marketing values. The nightly canary runs them on a fresh prospect.
  4. `npm run audit` runs those SAME rules over every seed in `src/data/generated` and
     every local demo in `.data/demos`, exits non-zero on failure, needs no network.
     Run it before a push that touches the engine or the report.
  Each check was verified to FAIL on its own broken shape, not merely to pass on good data.
- Switching profiles in a test: `invoca-demo:activeId` is a **raw string**, not JSON.
  `JSON.stringify(id)` writes `"autonation"` with quotes, no profile matches, and the app
  silently falls back to Shady Blinds, so the test "passes" against the wrong prospect.

## Conventions & decisions
- **Data-driven**: never hard-code screen data in components; put it in the profile/schema.
- **Re-skin EVERY data point to the prospect's vertical.** No industry-specific wording is
  hard-coded — the engine generates all labels/values for the business (products, campaigns,
  locations, call reasons, conversion events, customer terminology, transcript, Q&A…). Each
  generation prompt is prefixed with a shared `reskin(name)` directive (in `engine/core.ts`)
  that says: use THIS vertical's terminology everywhere, keep each section's STRUCTURE
  identical (column/group/series counts), only wording + numbers change. Just a few platform
  labels stay verbatim: "Marketing Source/Medium/Campaign/Search Term", "Call Count",
  "Total Revenue (Sale Amount)".
  - **Canonical terms** are chosen once (in the fast `generateTerms` prefix call) and threaded through every
    section for consistency: **`bookingTerm`** (Title-Case singular: "Consultation" |
    "Appointment" | "Estimate" | "Tour" | "Test Drive"…) and **customerNoun** ("Customer" |
    "Patient" | "Member" | "Client" | "Guest"…). `bookingTerm` is stored on the profile
    (`profile.bookingTerm`) and read by UI (Agent Workflow leaf "Schedule `<bookingTerm>`");
    it drives Digital Insights signals ("`<bookingTerm>` Discussed/Booked"), Marketing
    dashboard ("`<bookingTerm>` Set"), Ops dashboard ("`<bookingTerm>`: Scheduled"),
    Conversation Intelligence ("`<bookingTerm>`: Scheduled"). `customerNoun` drives the Ops
    "Caller Type: New/Existing `<customerNoun>`" labels + CI signal. The SMS agent also has
    `agentConfig.smsPlaybook` (bookingType + modality, qualifying questions, offer, etc.).
  - Two MORE canonical conversion terms come from `report` (`ReportOutput`) — **`qualifiedCallTerm`**
    (the sales-qualified inbound call, e.g. "Sales Call"/"Residency Inquiry"/"New Patient Call")
    and **`conversionTerm`** (the won revenue outcome, e.g. "Purchase"/"Move-In"/"Job Won") —
    threaded into the conversion dashboards (**Marketing Performance, AI Agent Conversion, AI
    Messaging Impact**) so their funnel labels are IDENTICAL across the platform (no more
    per-dashboard drift like "Sales Call"/"Job Complete"/"In-Home Tour"). These two are
    engine-internal (used at generation time; not persisted on the profile). AI Messaging's
    booking labels all use `bookingTerm` (never "In-Home <bookingTerm>" or "Appointment").
    ⚠️ QM dashboards still use their own "Sales Quality Score"/"Sales Opportunities" wording
    (Invoca product-feature names, not yet canonicalized).
  - When adding a screen with any industry-specific label, read it from the profile
    (`bookingTerm`) or generate it per-business — never type "Consultation"/"Customer"/
    "Appointment"/product terms literally.
- **One canonical profile** feeds all screens (consistency across screens is the whole point).
- **Exact-copy** (saved real HTML) is used ONLY for pages that are identical for every
  customer and must be pixel-perfect (marketing/3rd-party consoles). Everything
  customer-specific is profile-driven React.
- **TypeScript + Zod** chosen deliberately (multi-dev, evolving schema): changing the
  schema surfaces every screen that needs updating at compile time.
- **⚠️ ALWAYS ASK the user which URL to read/build from before replicating any screen.**
  (Also saved in user memory.) Don't pick a screen/variant yourself.
- **⚠️ A CHANGE FOR ONE SCREEN STAYS ON THAT SCREEN.** When the user asks for something on a
  named tab ("on Insights & Analytics…", "on this dashboard…"), no other screen may change
  look or behaviour — even when the fix lives in a component six screens share, and even when
  the change would arguably improve them too. Widening the blast radius is a separate ask.
  The pattern for shared components is **OPT-IN props defaulted to today's behaviour**:
  `DonutChart` grew `colors`, `onSlice`, `slicePct`, `label` and `geom` this way, so Insights
  gets a 740×340 box with `name - count (pct%)` labels, no inner percent, column-aligned
  labels and a click-to-drawer, while the six dashboards keep 350×260, their inner percents,
  name-only labels and no cursor. Same rule for CSS: scope it (`.ind-page .donut-svg`), never
  edit the shared selector. THEN PROVE IT — load one of the other screens and assert the old
  values (see the Insights donut work: viewBox, inside-percent count, label text, font size,
  max-width and cursor all re-checked on `/dashboards/marketing`). Two earlier violations
  were caught only because someone looked: an `.ind-split` change would have narrowed every
  breakdown, and a label-alignment fix was moments from moving labels on all seven donuts.

## How a screen gets built (workflow) + environment
The proven loop for replicating an Invoca screen (used for report, dashboard, Call
Review, Agent Studio, Manage Dashboards, ops dashboard):
1. User provides the real page's **saved HTML + `_files/` + a screenshot + the URL**
   (ALWAYS ask for the URL first — see conventions). Assets live in
   `~/Documents/Lovable Project/*.html`.
2. These are heavy SPAs whose CSS is JS-injected (emotion), so the static save renders
   UNSTYLED. Method: copy to the scratchpad, strip `<script>` tags, serve over a local
   `python3 -m http.server`, open in the Browser-pane, and read **computed styles** off
   the live DOM (colors/fonts/px) + extract structure/labels/SVG icon paths via grep.
   When emotion CSS is absent, measure from the screenshot + reuse our tokens, then
   iterate visually against the screenshot.
3. Build the React screen + data (in `shadyBlinds.ts`), reusing existing CSS/components;
   verify in the Browser-pane preview at the screenshot's width; iterate pixel-by-pixel.

**Dev server / preview:** `.claude/launch.json` defines `invoca-demo` (npm run dev on
port 5173, autoPort:false). Start/refresh with `preview_start {name:"invoca-demo"}`;
it holds the app in the Browser pane. Navigate within it via `preview_eval`
(`location.assign('/path')`) and check with `preview_screenshot` / `preview_eval`
(the `mcp__Claude_Browser__navigate` tool is not always available; preview_* are).
`npm run dev` reads `.env` for `ANTHROPIC_API_KEY` (powers `/api/generate`).

## Status summary
- ✅ Foundation: Vite/React/TS/Zod/Router, tokens, components, app shell, 14-item nav
- ✅ **Digital Journey report** — pixel-matched, signal columns, per-customer
- ✅ **Marketing Performance dashboard** — pixel-matched (white tile cards, KPI tiles 147px
  tall w/ 4×63px `#f5f6fa` dividers, donut cards 460px w/ height capped, split metrics 440px)
- ✅ **Call Review** — filter box is a `#f5f6fa` independently-scrolling panel (full height);
  gray tiles on white; score weight 400
- ✅ **Agent Studio** — one agent + 2 workflows from `customerName`
- ✅ **Manage Dashboards** — Dashboards nav lands here; lists all four dashboards
- ✅ **Marketing & Operations dashboard** (`/dashboards/marketing-ops`) — `HBarChart`
  (bars 42px; labels hug left via `--hbar-lw:96px` + small left padding; continuous
  vertical gridlines via a single `.hbar-grid` overlay over the track area — matched
  to the real Invoca), even-column tables (`.ops-page .dash-table` fixed layout),
  existing-customers card = 1 big + 2 aligned percents
- ✅ **Launch screen** (`/` and `/launch`) + live generation via `/api/generate`;
  generated profiles persist (files + localStorage); customer name shown, not network name
- ✅ **Engine** — 17 phases (research→report→dashboard→callReview→callDetail→opsDashboard→aiAgentConversion→aiMessagingImpact→conversationIntelligence→smsConversationIntelligence→voiceConversationIntelligence→agentConfig→qualityManagement→qmInstantInsights→screenpops→voiceRoutingDemo), verified (streaming; re-skin confirmed on a gym: Tour/Member). qualityManagement + last 2 phases (Haiku) re-skin the QM dashboard + 3 Gumloop artifacts per prospect. **SingleFile browser extension** is the way to capture a real Invoca (emotion/MUI SPA) page as self-contained standalone HTML (renders styled, unlike native "Webpage, Complete")
  live on Terminix; ran on Mavis earlier
- ✅ Integrations + Google Ads — exact static copies, click-through verified
- Seed: `shady-blinds` (reference, hand-authored — the working instance), `mavis`.
  Generated files: `mavis-tires-and-brakes`, `terminix`, `davy-tree`.
- **Working style (from user, in memory):** iterate on Shady Blinds directly; mirror any
  NEW data-driven feature into `engine/core.ts` so new prospects get it. Pure design
  changes are shared CSS and apply to everyone.

## Deferred polish (TODO)
0. **ZERO-DOWNTIME DEPLOYS — route B built 2026-08-20, ONE CHECK OUTSTANDING.**
   Goal: a push must not interrupt the live site, even for someone hitting refresh
   mid-deploy.
   ⚠️ **The blocker is the PERSISTENT DISK, not the plan or the health check.** A Render
   disk attaches to ONE instance at a time, so the old instance must stop to release it
   before the new one boots. **MEASURED on the 2026-08-20 deploy: ~40 seconds where the
   origin answered nothing at all** (two consecutive 20s polls got no response; the new
   instance reported 42s uptime when it answered). Do not re-investigate the health check.
   Route B (no infra change) is now built:
   - **SIGTERM/SIGINT drain in `server.ts`.** `/healthz` returns 503 once draining, idle
     keep-alive sockets are dropped at once (`closeIdleConnections`, or an idle browser
     socket holds the drain open for the whole budget), in-flight requests finish, and a
     10s `DRAIN_TIMEOUT_MS` forces exit so an open SSE stream cannot outlast the host's
     patience. **Proven:** SIGTERM sent 1.2s into a throttled 3.5s bundle download — the
     download completed WHOLE (1,850,317 bytes, HTTP 200) while a NEW request during the
     drain was refused, so the test could have failed.
   - **`public/sw.js` + prod-only registration in `main.tsx`.** Navigations are
     network-first and cache the shell; `/assets/*` is cache-first (safe only because the
     names are content-hashed); `/api/*`, `/auth/*`, `/healthz` are never cached. A
     refresh inside the window renders the cached shell instead of the browser error page.
     `npm run test:sw` drives the real handlers against stubs — 10 checks including the two
     traps that would hurt production: a 302 auth redirect must NOT become the shell, and
     nothing under `/api` may ever be cached. Verified the suite FAILS when the guard is
     removed. **KILL switch at the top of sw.js** — set `KILL = true` and deploy to make
     every client unregister and drop its caches. Do that instead of deleting the file;
     deleting it leaves registered workers running forever.
   - **GET-only retry + self-heal in `DemoLibraryContext`.** Three retries with backoff,
     and ⚠️ **only for idempotent requests** — the same `api()` helper also carries
     createDemo/duplicateDemo/deleteDemo/saveCustomizations, and a retried POST that
     actually succeeded would duplicate a demo or re-send a delete. Plus a bounded 3s poll
     while the library is unavailable, so a page loaded mid-deploy heals itself instead of
     waiting for someone to refresh.
   ⚠️ **STILL UNVERIFIED, and needs a real browser:** service-worker REGISTRATION. The
   in-app browser pane fails with "unknown error occurred when fetching the script" even
   though the server returns 200 `application/javascript`, and the Chrome tool refuses
   localhost. The logic is tested; the registration is not. Check once on the deployed
   site: DevTools → Application → Service Workers shows sw.js activated, then Network →
   Offline → reload should still render the app. The self-heal poll is likewise only
   verified by construction — the poll correctly stays idle while the library is
   reachable, which is also why it could not be exercised without an actual outage.
   ⚠️ **THE SINGLE BUNDLE IS LOAD-BEARING, AND THE SERVICE WORKER MAKES IT MORE SO.** The
   build is one hashed JS file with NO code splitting, so a cached shell and a cached
   bundle are always a consistent pair. Introduce code splitting and a cached shell could
   ask for a lazy chunk that was never cached and no longer exists — a white screen
   mid-demo, worse than the problem this solves.
   ✅ **CORRECTED: the boot migrations were NOT a problem.** This file previously called
   them "synchronous fs loops over 117 demos" delaying `/healthz`. Both are marker-guarded
   and the markers were written 2026-07-29, so they cost **0.1ms and 0.3ms** (timed). The
   117-demo loop ran once, months ago. Nothing to fix; do not "optimise" it.
   Route **A (structural)** is still the real fix if the window must go to zero: move demo
   storage off the disk (Postgres or S3/R2 behind `engine/demoStore.ts`, already a narrow
   read/write/list interface), then remove the disk and get real rolling deploys. Requires
   the user to provision the store — the assistant cannot create accounts or keys.
   For "I say push and it deploys": a **Render Deploy Hook URL** in git-ignored `.env`
   (single-purpose; cannot read env vars or delete services), then poll `/api/status`
   until `commitShort` matches. A full Render API key was declined as too broad.
1. **Engine revenue-example leak**: the generation prompt uses "$945,910" as an example,
   and generated customers copy it verbatim as Total Revenue. Fix in `engine/generate.ts`
   (dashboard prompt) — use a placeholder or instruct it to compute from calls × rate × price.
2. **Duplicate Mavis**: both the hand-authored seed `mavis` and the engine-generated
   `mavis-tires-and-brakes` show "Invoca for Automotive" in the switcher. Remove the seed
   (`src/data/profiles/mavis.ts` + its entry in `profiles.ts`) now that the engine works —
   OR keep mavis as a hand-tuned reference. (Note: schema requires all profiles to have both
   reports; if removing mavis, ensure nothing else references it.)
3. Optional: dashboard donut small-slice label crowding; dashed trend line on the stacked bar.

## Next steps (options)
- **More screens** — extract from the live app and templatize (ask the user for the URL first).
  Candidates: AI Agents / Signal, other report types, Call Review.
- **"New Demo" in-app UI** — a form (name + URL) that runs the engine and adds the customer
  to the switcher, so SEs never touch the terminal (Phase 4).
- Fully offline exact-copy pages (localize GT America + logo assets) if needed.

## Gotchas
- **Structured-output "grammar too large"**: generating the full profile in one structured
  call fails. The engine splits into separate calls (report, then dashboard). Keep any new
  screen's generation as its own call.
- **Exact-copy pages need internet** (CDN fonts/logos) and render desktop layout at ≥992px.
- **Dev server** is long-running; if navigation fails, restart `npm run dev`.
- Reference: the original single-page report clone lives at `/Users/ddesai/invoca-report-clone/`
  (plain HTML/JS) — the proof-of-concept before this React platform.

- ⚠️ **`.fbb-page` is the board's full-page wrapper** (`min-height: 100vh`). Reusing that
  class name for a small meta span gave it a viewport-tall minimum, stretched the flex row
  it sat in, and left a ~900px hole in every card with a `page` value. The meta span is
  `.fbb-from`. Check for an existing class before reusing a name in `app.css`.
