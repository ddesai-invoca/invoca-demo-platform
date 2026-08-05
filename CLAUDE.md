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

### Sidebar (left nav)
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
