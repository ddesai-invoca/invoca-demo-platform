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
  voiceConversationIntelligence→agentConfig→qualityManagement→qmInstantInsights→screenpops→voiceRoutingDemo pipeline
  (16 phases; returns a validated `CustomerProfile` with report, six dashboards,
  Call Review, Conversation Intelligence, the SMS + Voice conversation reports, and
  the Agent Studio config per prospect).
  `engine/generate.ts` (the CLI) and the dev endpoint both call it.
  ⚠️ `structured()` MUST use streaming (`messages.stream().finalMessage()`) — the SDK
  throws on any non-streaming call it estimates could exceed 10 min (large max_tokens),
  which was silently failing every generation at the ops phase. The SMS-conversation
  phase uses the FAST model (Haiku) via `structured(..., FAST_MODEL)`.
  ⚡ **Perf: <=3min (optimized 2026-07-22).** Critical path = `research()` → `generateTerms()`
  (tiny, fast) → a **concurrency-limited pool of 15 phases**. Key wins, in order of impact:
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
| Manage Dashboards | `/dashboards` | Profile-driven (React) | ✅ list page the Dashboards nav lands on; one row per built dashboard (add rows in `ManageDashboards.tsx` as more are built) |
| Marketing Performance Dashboard | `/dashboards/marketing` | Profile-driven (React) | ✅ built, swaps per customer; opened from the Manage Dashboards list |
| Marketing & Operations Performance | `/dashboards/marketing-ops` | Profile-driven (React) | ✅ 2nd dashboard (`reports.opsDashboard`, optional): KPI groups + 4 HBarChart+table sections + 2 tables + stacked "No Booking" chart. Reuses dashboard-1 CSS; engine generates it per prospect |
| AI Agent Conversion Dashboard | `/dashboards/ai-agent-conversion` | Profile-driven (React) | ✅ 3rd dashboard (`reports.aiAgentConversion`, optional), built from screenshots (`AiAgentConversionDashboard.tsx`): "AI Agent Performance Summary" KPI group + **6 conversion cards** (Lead Form + Voice Agent, each with filter chips + Job Complete% / Total Revenue tiles, `.aac-*` CSS) + 4 donut+table breakdowns (Source/Medium/Campaign/Search Term; donut %-labels use `Breakdown.donutTotal`) + Product Category table + StackedBarChart. Reuses the shared `.dash-`/`.breakdown-`/`.kpi-` template + DonutChart/StackedBarChart; engine generates it per prospect |
| Quality Management (QM Actionable Insights) | `/dashboards/quality-management` | Profile-driven (React) | ✅ 5th dashboard (`reports.qualityManagement`, optional), matched to the real Invoca page (`reference/quality-management/*.html`, network 2982). **Layout = the real 3-col gridstack**: Row1 Sales Opportunities **2/3** \| Sales Conversions **1/3** (`.qm-row-21`); Rows 2/3/5/6 left **1/3** \| right **2/3** (`.qm-row-13`); Rows 4/7/8 full width. 13 tiles: 4 KPI cards (ConversionCard title+chips+tiles), Calls Needing Review + Bottom/Top Quality Scores HBars (the two by-agent bars show a `pager` "1 - 6 of 30"), Highest Converting Agents stacked bar (**9 weeks × 5 agents**), Bottom/Quality Scores tables, and 3 **BarLineChart**s: Baseline Sales Quality Score (bars + red dashed avg line w/ a value badge) + the two Trending charts (**dual-axis**: bars=left %, orange line=right count/revenue via `rightLabel/rightMax/rightTicks/rightPrefix`). Platform metric labels verbatim; agents/scorecards/vertical terms re-skinned. Engine composes scaffolding + deterministic daily points; model generates compact `QmGen` content |
| QM Instant Insights | `/dashboards/qm-instant-insights` | Profile-driven (React) | ✅ 6th dashboard (`reports.qmInstantInsights`, optional), matched to the real Invoca page (`reference/quality-management/*Instant*.html`, network 2982). QA at-a-glance: Trending Essential Metrics full-width (BarLineChart, **line-primary + DUAL-axis**: blue AHT line on left time axis, orange Negative-Sentiment **bars on the RIGHT axis** 0–120%; passed `height={150}` = 50% shorter), Essential Metrics **2/3** \| Trending Answer Rate **1/3** (`.qm-row-21`; answer rate = line-only, zoomed `yMin` 65–100), Contact Center Metrics, Overall Evaluation Score **1/3** \| Evaluation Rollup **2/3** (`.qm-row-13`), Scored Calls by Evaluator table. `BarLineChart` supports the SECONDARY series on the right axis (bars-on-right when `linePrimary`, else line-on-right). Engine composes charts; model supplies compact values (`QmInstantGen`) |
| AI Messaging Impact (Human vs AI) | `/dashboards/ai-messaging-impact` | Profile-driven (React) | ✅ 4th dashboard (`reports.aiMessagingImpact`, optional), built from screenshots (`AiMessagingImpactDashboard.tsx`): paired **1/3 + 2/3 KPI cards** (`.aim-row`) — AI (This Month) vs Human (Last Month, grey chip) for Lead Engagement + Appointment Performance — then AI-Assisted Appointment Trend **LineChart** (49 daily pts, flat→jump; sparse x-labels), AI-Assisted Opportunities + AI Lead Nurture tiles, and a **Common Topics** StackedBarChart re-skinned to the prospect (window-treatment topics for Shady Blinds). Reuses the shared template; engine generates it per prospect |
| Invoca Exchange (Integrations) | `/integrations` | **Exact static copy** (identical for all customers) | ✅ real page served |
| Google Ads Search Keywords | `/integrations/google-ads` | **Exact static copy** | ✅ real page served |
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

### The Integrations click-through (demo circuit)
Sidebar **Integrations** → `/integrations` → `StaticRedirect` to `/invoca-exchange.html`
→ click the **Google Ads** tile (JS override injected in the HTML) → `/integrations/google-ads`
→ `StaticRedirect` to `/google-ads.html` → click the **Google Ads logo (top-left)** → back to `/dashboards`.

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
- ✅ **Engine** — 16 phases (research→report→dashboard→callReview→callDetail→opsDashboard→aiAgentConversion→aiMessagingImpact→conversationIntelligence→smsConversationIntelligence→voiceConversationIntelligence→agentConfig→qualityManagement→qmInstantInsights→screenpops→voiceRoutingDemo), verified (streaming; re-skin confirmed on a gym: Tour/Member). qualityManagement + last 2 phases (Haiku) re-skin the QM dashboard + 3 Gumloop artifacts per prospect. **SingleFile browser extension** is the way to capture a real Invoca (emotion/MUI SPA) page as self-contained standalone HTML (renders styled, unlike native "Webpage, Complete")
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
