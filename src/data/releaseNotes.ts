/* =============================================================================
   releaseNotes.ts — what shipped, in the tool, for the people using it
   -----------------------------------------------------------------------------
   Asked for 9/10/2026: release notes *"from the very beginning"*. The platform
   deploys continuously (a push to main IS the release), so there are no version
   numbers to hang these off — entries are dated, newest first.

   ⚠️ THE BACKFILL IS RECONSTRUCTED FROM GIT HISTORY, NOT WRITTEN AT THE TIME.
   284 commits between 2026-07-23 and 2026-09-09 were read and curated; the
   commit subjects in this repo are unusually outcome-shaped, which is what made
   that honest rather than invented. Two consequences worth knowing:
     • The early weeks are COARSER. Late July shipped in bursts of twenty small
       commits a day, so those days are summarised at the feature level while
       recent entries can afford a line per change.
     • Anything invisible to an SE is deliberately absent — refactors, captures,
       audit scripts, documentation, and the many "record why X" commits. This is
       not a changelog of the repository; it is a list of things that changed for
       someone using the tool.

   ⚠️ ADDING AN ENTRY IS PART OF SHIPPING A USER-VISIBLE CHANGE. Put it at the
   TOP of `RELEASES`. A curated file rots the moment it stops being updated in
   the same commit as the work, and nothing enforces this but the habit — a
   generated-from-commits version was considered and rejected, because "Record
   two deploy findings from shipping the drain" is a true commit subject and
   useless to an SE.

   ⚠️⚠️ PRODUCT-WIDE ONLY — NOTHING PROSPECT-SPECIFIC. Asked for directly
   (9/10/2026): *"only add items that apply to the whole product, not anything
   that is prospect specific like the 'Orlando Health's ER Messaging'."* An entry
   has to be true for anyone using the tool, whichever demo they open.

     • a CAPABILITY belongs here — "a demo can carry extra agent workflows".
     • the INSTANCE of it does not — the five ER workflows built on one
       healthcare demo, a second workflow added to one jeweller, one prospect's
       own SMS tree.
     • ⚠️ AND "NOT PROSPECT-SPECIFIC" IS NOT THE SAME AS "DOES NOT NAME A
       PROSPECT", which is the trap. Three entries had to come out of the backfill
       that named nobody and were still scoped to one demo: the AI Conversion by
       Location dashboard (gated to a single prospect), and Signal AI Silver/Gold
       on the date it shipped for one account only — it earned its entry three
       days later, when it became derived for every prospect. Ask what an SE on a
       DIFFERENT demo would see, not whether a name appears in the sentence.

   `npm run audit:app` enforces the name half of this by scanning every entry
   against the customerName of every profile and demo on disk. The SCOPE half it
   cannot check, so that judgement is on whoever writes the entry.
   ============================================================================= */

/** new = you can do something you could not before · improved = it does the same
 *  thing better · fixed = it was wrong and now is not. */
export type ChangeKind = "new" | "improved" | "fixed";

export interface Change { kind: ChangeKind; text: string }

export interface Release {
  /** ISO date. The day it reached the live site. */
  date: string;
  /** One line for the day, so the list can be scanned without opening anything. */
  title: string;
  changes: Change[];
}

const n = (text: string): Change => ({ kind: "new", text });
const i = (text: string): Change => ({ kind: "improved", text });
const f = (text: string): Change => ({ kind: "fixed", text });

export const RELEASES: Release[] = [
  {
    date: "2026-09-10",
    title: "One menu instead of a corner full of buttons",
    changes: [
      n("Support, Inbox and Read.Me moved into a single menu at the top right of the launch screen."),
      n("These release notes, reachable from that menu."),
      f("Feedback and feature requests now reach the maintainer the moment you send them. Nothing had been notifying anyone, so submissions could sit unread — if you sent something and heard nothing back, that is why."),
    ],
  },
  {
    date: "2026-09-09",
    title: "Demos can be grouped into an event section",
    changes: [
      n("The launch screen can file demos under an event of their own, separate from My demos and Team demos — the first one is the 2026 Dallas Invoca Summit."),
      n("Searching a section also matches the name a demo was listed under, so pasting a row from a source list still finds it."),
      f("Some prospects were showing a Santa Barbara location on the search screen instead of one of their own offices."),
      f("A sponsored-ad headline could promise a free booking when the prospect's own campaign was named that way."),
    ],
  },
  {
    date: "2026-09-08",
    title: "A search screen that tells the truth, and Ask AI reaching the SMS agent",
    changes: [
      n("Ask AI configures an SMS workflow's agent now, not just its diagram — the opening message and its ordered steps."),
      i("The Google search screen shows a city the business actually operates in, and you can point it at any US ZIP yourself."),
      i("The sponsored ad runs the prospect's own campaign creative on a real search term from its dashboard."),
      i("Workflow diagram rows sit level, and the connector no longer crowds the Conversation Start box."),
      i("The SMS thread header shows a toll-free number rather than the prospect's name, which is what a real thread from a business looks like."),
    ],
  },
  {
    date: "2026-09-03",
    title: "Ask AI can direct the voice agent, and a call can book",
    changes: [
      n("Tell Ask AI what you want the voice agent to do and it reconfigures the whole agent — steps, questions, rules, voice — with a progress bar while it thinks."),
      n("A booking voice agent that books the appointment itself instead of routing the caller."),
      n("A booked call creates the Salesforce lead, and the calendar appointment opens it."),
      n("An Agent Voice picker on a workflow's Details tab: six voices, previewable, applied to the next call."),
      i("All voice runs through LiveKit now."),
      f("Two places where Ask AI reported an edit had applied and nothing actually changed."),
      f("The AI conversation reports no longer show human-agent QA signals, on calls where no human was involved."),
    ],
  },
  {
    date: "2026-09-02",
    title: "A voice agent that remembers what it was told",
    changes: [
      f("The agent stopped re-asking for a ZIP or a name the caller had already given."),
      i("A service-area list can offer the caller the nearest location instead of turning them away."),
      i("A cold start now shows a warming-up notice with a live countdown instead of an error."),
      f("Chips wrap inside their box on every workflow leaf, not just the voice tree's."),
    ],
  },
  {
    date: "2026-08-28",
    title: "What the integration writes into Salesforce",
    changes: [
      n("The Salesforce Lead record page, with the Invoca Captured Attribution section filled from the prospect's own data."),
      n("The Invoca Call Log record page — field by field, what Invoca writes into Salesforce."),
      f("Restored the Call Detail screen's styling, which a component rebuild had removed as collateral."),
    ],
  },
  {
    date: "2026-08-27",
    title: "The routing demo builds from the call you just had",
    changes: [
      n("Finish a voice call and the Voice Routing Demo and screenpop are built from that conversation, routed to the department the agent actually named."),
      n("Signal AI Silver and Gold reports for every prospect, derived from its own call."),
      n("The Create Workflow modal, and the empty workflow it builds."),
      n("The Salesforce Leads list."),
      i("The pre-call intelligence story re-skins to the location the caller named, so the attribution and the transcript agree."),
    ],
  },
  {
    date: "2026-08-26",
    title: "The voice agent follows the diagram",
    changes: [
      n("The voice agent's call flow is derived from the workflow diagram, so changing the diagram changes the call."),
      n("Ask AI configures the voice agent, not just draws its diagram."),
      n("Both user-group nodes branch into use cases, so support callers get their own questions and queue."),
      n("Clicking a node in the diagram opens its configuration drawer."),
      n("Every prospect gets the Qualify-and-Route voice template."),
      i("The diagram fits on screen, and its zoom controls work."),
    ],
  },
  {
    date: "2026-08-25",
    title: "Live voice calls",
    changes: [
      n("Start Call on a voice workflow places a real spoken call with the agent, running on LiveKit."),
      i("The call honours Ask AI's edits to the agent."),
    ],
  },
  {
    date: "2026-08-24",
    title: "Integrations, and the first Salesforce screens",
    changes: [
      n("The in-platform Integrations page, with the Google Ads and ChatGPT journeys reachable from it."),
      n("Salesforce Seller Home and Calendar."),
      i("The SMS workflow's four node names match the product's, which does not let you rename them."),
    ],
  },
  {
    date: "2026-08-23",
    title: "Report tiles, and dashboards you build yourself",
    changes: [
      n("Details, Summary and Transactions Report tile templates."),
      n("Create your own Insights dashboard and land new tiles on it."),
      i("The column picker opens expanded, and the chosen columns can be dragged into order."),
    ],
  },
  {
    date: "2026-08-21",
    title: "Six more tile templates",
    changes: [
      n("Stacked Bar, Dual Y-Axis, Geo Heatmap, KPI, Metric, and Calls by Hour / Day of Week."),
    ],
  },
  {
    date: "2026-08-20",
    title: "Charts that drill in, and a deploy you do not notice",
    changes: [
      n("Single Line, Multi-Line and Pie chart templates, rebuilt against the real tiles."),
      n("Clicking any datum on an Insights tile opens the interactions drawer."),
      i("A deploy no longer interrupts the site: requests in flight finish, and a page loaded mid-deploy heals itself."),
    ],
  },
  {
    date: "2026-08-18",
    title: "Add Tile",
    changes: [
      n("Add a tile to an Insights dashboard: a template picker, a configuration drawer, and a column picker for the reports."),
      n("Build With AI — ask for a chart in a sentence and get the tile."),
      i("New tiles render in the real ThoughtSpot look rather than the Dashboards one."),
    ],
  },
  {
    date: "2026-08-17",
    title: "Signal screens, and Ask AI you can trust on a tile",
    changes: [
      n("The New Semantic Signal activation screen, Signal AI Studio, and Verify Labels."),
      n("Every dashboard tile can be edited or hidden, including the derived ones."),
      f("An edit made from a tile's own AI button could land on a different tile; it now stays in the tile you opened."),
      i("Ask AI can add and remove columns, tiles, chart series, pie slices and axis points."),
    ],
  },
  {
    date: "2026-08-14",
    title: "Support, and somewhere for it to go",
    changes: [
      n("A Support form for feedback and feature requests, with screenshots attached, and an email when yours is done."),
      n("An admin inbox with a count of what is still open."),
    ],
  },
  {
    date: "2026-08-13",
    title: "The docs ship with the tool, and the Preview Agent listens",
    changes: [
      n("Read.Me — the full documentation, inside the app, no account needed."),
      n("Four ways to change what the Preview Agent asks: one at a time, paste a list, import a file, or name a use case."),
      n("The agent's opening message is editable and addresses the customer by name."),
      i("Preview Workflow got everything Preview Agent has, including its own AI button."),
      i("The phone restarts itself when you change the agent's configuration, so you are never testing a stale one."),
    ],
  },
  {
    date: "2026-08-06",
    title: "Insights & Analytics",
    changes: [
      n("The Summary Dashboard, three reports, a call detail page, and charts that respond to a hover and a click."),
    ],
  },
  {
    date: "2026-08-05",
    title: "Two dashboards for managers",
    changes: [
      n("Location Performance Comparison — every location side by side, reconciling with the other dashboards."),
      n("A Lead Form Performance Summary tile on the Marketing dashboard."),
      i("Every Call Outcome Summary now opens on the highest-volume row with the worst conversion and closes on the smallest with the best, which is the point an SE makes from it."),
    ],
  },
  {
    date: "2026-08-04",
    title: "Editable report columns",
    changes: [
      n("Ask AI can add, remove, rename and move the columns of the Digital Journey report."),
    ],
  },
  {
    date: "2026-07-30",
    title: "The workflow diagram is data",
    changes: [
      n("Ask AI can add, remove and rename branches on a workflow diagram — the layout is computed, so a new branch draws its own connectors."),
      n("Preview Workflow on an SMS workflow opens a chat drawer that tests the same agent as the phone."),
      n("A nightly self-check generates a demo end to end and reports whether anything regressed."),
      i("The Marketing Performance dashboard generates far faster, bringing a full demo under three minutes."),
    ],
  },
  {
    date: "2026-07-29",
    title: "Ask AI on every page",
    changes: [
      n("Ask AI and undo on every screen, from the top bar — data only, never the design."),
      n("The Google search results screen, with the prospect in the top sponsored slot and a tracked click into their site."),
      n("Project admins can edit and delete any demo, with the change attributed."),
      i("Every heading renders from data, so the AI can actually rename what you point at."),
    ],
  },
  {
    date: "2026-07-28",
    title: "The ChatGPT sponsored placement",
    changes: [
      n("A ChatGPT sponsored-ad screen with a real map, and the prospect's own photos, ratings and hours."),
      n("An expanded map view, opened from the prospect's place card."),
      n("A demo can carry extra agent workflows beyond the built-in Voice and SMS pair, each with its own playbook."),
      i("Em dashes are swept out of every generated demo, because dash-joined prose reads as machine-written."),
      i("Workflow diagrams and the voice agent's prompt re-skin per prospect."),
    ],
  },
  {
    date: "2026-07-27",
    title: "Numbers that look real, and the Signal screen",
    changes: [
      n("The Signal screen — Manage Signals, with real Signal rule syntax re-skinned per prospect."),
      i("Every demo was rebuilt around one canonical month and one business, and nothing lands on a round number any more."),
      i("Research got roughly ten times faster, which is most of a demo's wait."),
    ],
  },
  {
    date: "2026-07-26",
    title: "A shared team library",
    changes: [
      n("Demos live on the server, so the whole team sees the same list rather than whatever their own browser generated."),
      n("My demos and Team demos are separate sections on the launch screen."),
    ],
  },
  {
    date: "2026-07-24",
    title: "The Google Ads walkthrough",
    changes: [
      n("The Google Ads console re-skins to each prospect, with a three-page conversions walkthrough."),
    ],
  },
  {
    date: "2026-07-23",
    title: "The first version",
    changes: [
      n("Enter a prospect's name and website and get a clickable Invoca demo with every screen tailored to their business."),
    ],
  },
];

/** The newest release's date — what the menu compares against to show "New". */
export const LATEST_RELEASE = RELEASES[0]?.date ?? "";

const SEEN_KEY = "invoca-demo:release-notes-seen";

/* ⚠️ EVERY READ AND WRITE IS GUARDED. localStorage throws outright in some
   contexts (a private window, site data blocked), and this runs on the launch
   screen — the first thing anyone opens — so an unguarded access takes down the
   whole page to decide whether to draw a two-word chip. */
export function unseenRelease(): boolean {
  if (!LATEST_RELEASE) return false;
  try {
    return (localStorage.getItem(SEEN_KEY) ?? "") < LATEST_RELEASE;
  } catch {
    /* Can't tell — say no. A chip that cannot be dismissed is worse than one
       that never appears, because it stops meaning anything. */
    return false;
  }
}

export function markReleasesSeen(): void {
  try { localStorage.setItem(SEEN_KEY, LATEST_RELEASE); } catch { /* nothing to do */ }
}
