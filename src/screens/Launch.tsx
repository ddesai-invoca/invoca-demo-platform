import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_SHARE_DAYS } from "../data/shareDefaults";
import { ShareDemoButton } from "../components/ShareDemoButton";
import Tooltip from "../components/Tooltip";
import { useNavigate } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useDemoLibrary } from "../data/DemoLibraryContext";
import { useAiAssistant } from "../data/AiAssistantContext";
import { CustomerProfile } from "../data/schema";
import { SEED_IDS } from "../data/profiles";
import { EVENTS, eventGroupOf } from "../data/eventDemos";
import { generateProfile } from "../data/generateStream";
import BulkGenerate from "../components/BulkGenerate";
import EventSheetButton, { type EventSheetState } from "../components/EventSheetButton";
import DemoMarkButton from "../components/DemoMarkButton";

/* Where a prospect opens (both a fresh generation and revisiting one) — the
   demo starts on the Marketing Performance dashboard. */
const LANDING = "/dashboards/marketing";

/* The pieces the engine builds, in display order, with a rough weight for the
   progress bar (research + report are the heavy sequential prefix). The `key`
   matches the phase name the engine streams via SSE (onProgress). */
/* "skipped" is a phase an Agent-Studio-only generation never runs. Without it a
   skipped phase would sit at "pending" forever and the weighted bar could never
   reach 100 — the same invisible-progress trap as a phase missing from
   BUILD_STEPS below. */
type StepStatus = "pending" | "building" | "done" | "skipped";
const BUILD_STEPS: { key: string; label: string; weight: number }[] = [
  { key: "research", label: "Researching the business & website", weight: 10 },
  { key: "terms", label: "Identifying key metrics & terminology", weight: 3 },
  { key: "digitalInsights", label: "Digital Journey & Call Attribution report", weight: 1 },
  /* The Marketing Performance dashboard is generated as THREE concurrent phases
     (it used to be one call and was 70% of the wall clock — see the comment above
     generateDashboardCore in engine/core.ts). Three rows, because each one has to
     appear in the checklist or its progress is invisible; the labels name real
     sections of that dashboard rather than leaking the engine's phase keys. */
  { key: "dashboard", label: "Marketing Performance dashboard", weight: 1 },
  { key: "dashboardChannels", label: "Source, Medium & Campaign breakdowns", weight: 2 },
  { key: "dashboardSegments", label: "Product Category & Region breakdowns", weight: 2 },
  { key: "opsDashboard", label: "Marketing & Operations dashboard", weight: 1 },
  { key: "aiAgentConversion", label: "AI Agent Conversion dashboard", weight: 1 },
  { key: "aiMessagingImpact", label: "AI Messaging Impact dashboard", weight: 1 },
  { key: "qualityManagement", label: "QM Actionable Insights dashboard", weight: 1 },
  { key: "qmInstantInsights", label: "QM Instant Insights dashboard", weight: 1 },
  { key: "signalManager", label: "Signal library", weight: 1 },
  { key: "callReview", label: "Call Review", weight: 1 },
  { key: "callDetail", label: "Call Detail drill-in", weight: 1 },
  { key: "conversationIntelligence", label: "Conversation Intelligence", weight: 1 },
  { key: "smsConversationIntelligence", label: "AI SMS Conversation Intelligence", weight: 1 },
  { key: "voiceConversationIntelligence", label: "AI Voice Conversation Intelligence", weight: 1 },
  { key: "agentConfig", label: "Agent Studio configuration", weight: 1 },
  { key: "screenpops", label: "Voice & SMS Screenpops", weight: 1 },
  { key: "voiceRoutingDemo", label: "Voice Routing demo", weight: 1 },
];
const TOTAL_WEIGHT = BUILD_STEPS.reduce((s, st) => s + st.weight, 0);

/* A row in the prospect list — either a shared-library demo (has a creator) or a
   built-in/locally-cached sample (doesn't), or a demo tagged into an EVENT
   section like "dallas" below (see the note there). */
type EntryGroup = string;

/* Section order + headers — each is now its own dropdown.
   ⚠️ THE THIRD ELEMENT IS "ALWAYS SHOW, EVEN EMPTY" — every other section omits
   it and is hidden when it has no rows (see the `!rows.length` skip below). The
   Dallas section keeps it even now that demos ARE tagged into it, because its
   rows come from the SERVER: with the library unreachable the app falls back to
   local profiles only, and a conference roster that silently vanishes reads as
   the demos having been deleted rather than as an offline library. */
const GROUP_ORDER: [EntryGroup, string, boolean?][] = [
  ["mine", "My demos"],
  ["team", "Team demos"],
  /* ⚠️ DERIVED FROM `EVENTS`, NOT LISTED HERE — a second event used to mean editing
     this table AND the ternary below, and a third would have meant editing both
     again. `alwaysShow` is true for every event for the reason the Dallas note
     gives: its rows come from the SERVER, so with the library unreachable a
     conference roster that silently vanishes reads as the demos having been
     deleted rather than as an offline library. */
  ...EVENTS.map(({ group, label }) => [group, label, true] as [EntryGroup, string, boolean?]),
  ["sample", "Samples"],
];

/* One self-contained library dropdown (one per group). Owns its search text +
   open state + outside-click close, and filters its own rows by prospect,
   industry, or creator name/email. */
function LibraryPicker({ label, entries, renderRow, action }: {
  label: string; entries: Entry[]; renderRow: (e: Entry) => ReactNode;
  /** ⚠️ OPT-IN AND DEFAULTED ABSENT, so My demos / Team demos / Samples render
   *  byte-identically — only an EVENT section carries a control. */
  action?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      /* ⚠️⚠️ A PORTALLED POPOVER IS "OUTSIDE" BY DOM AND INSIDE BY INTENT.
         The mark panel is portalled to <body> to escape this list's own scroll
         box, so a plain contains() test closes the dropdown on the very
         MOUSEDOWN that is choosing a status — the row unmounts and the option's
         own CLICK never fires, which reads as the control doing nothing.
         Measured: picking a status changed the button and wrote nothing to the
         server. Same trap the Create Workflow channel popup already records.
         Anything flagged `data-picker-safe` counts as part of the picker. */
      if (t?.closest?.("[data-picker-safe]")) return;
      if (ref.current && !ref.current.contains(t)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) =>
        e.name.toLowerCase().includes(q) ||
        e.industry.toLowerCase().includes(q) ||
        /* The source-list name, so pasting "H. LEE MOFFITT CANCER CENTER AND
           RESEARCH INSTITUTE, INC." off the original spreadsheet still finds the
           row now displayed as "Moffitt Cancer Center". */
        (e.listedAs ?? "").toLowerCase().includes(q) ||
        (e.creator?.name ?? "").toLowerCase().includes(q) ||
        (e.creator?.email ?? "").toLowerCase().includes(q))
    : entries;

  return (
    <div className="prospect-picker" ref={ref}>
      <div className="prospect-picker-label">
        {label}
        <span className="prospect-picker-count">{entries.length}</span>
        {action}
      </div>
      <div className="prospect-select">
        <div className={"prospect-search" + (open ? " open" : "")}>
          <span className="material-icons prospect-search-icon">search</span>
          <input
            type="text"
            placeholder={`Search ${label.toLowerCase()}…`}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
          />
          <span className="material-icons prospect-caret" onClick={() => setOpen((o) => !o)}>expand_more</span>
        </div>
        {open && (
          <div className="prospect-dropdown">
            {filtered.length === 0 ? (
              /* ⚠️ A SECTION WITH NO ROWS AT ALL (entries.length === 0, e.g. an
                 "always show" placeholder like 2026 Dallas Invoca Summit) reads
                 "Nothing matches ''" if it uses the search-miss copy — there was
                 no search, so blaming the empty query is misleading. */
              <div className="prospect-empty">
                {entries.length === 0 ? "No demos in this section yet." : `Nothing matches "${query}"`}
              </div>
            ) : (
              filtered.map((e) => renderRow(e))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface Entry {
  id: string;
  name: string;
  industry: string;
  creator?: { name: string; email: string };
  mine: boolean;
  inLibrary: boolean;
  /* Name of the admin who last edited it, when that is not the creator. */
  editedBy?: string;
  group: EntryGroup;
  /* Verbatim name from the list an event roster came from — searched, not shown. */
  listedAs?: string;
}

export function Launch() {
  const { profiles, addProfile, removeProfile, setProfileId } = useProfile();
  const { demos, me, admin, isMine, openDemo, createDemo, duplicateDemo, deleteDemo } = useDemoLibrary();

  /* ⚠️ WHICH EVENTS HAVE A SHEET, FETCHED ONCE. The URL half comes back only for an
     admin — the SERVER decides that, so a client that lied would just collect 403s
     on the PUT. Re-read after a save so the chip and the trigger label move without
     a reload. */
  const [eventCfg, setEventCfg] =
    useState<{ admin: boolean; sheetsConnected: boolean; events: EventSheetState[] } | null>(null);
  const loadEvents = useCallback(() => {
    fetch("/api/events")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setEventCfg(j))
      /* The library already degrades to local profiles when the API is unreachable;
         an absent config simply renders no control rather than an error. */
      .catch(() => {});
  }, []);
  useEffect(loadEvents, [loadEvents]);
  /* ⚠️ `/auth/sheets` lands back on `/?sheets=connected`. Without stripping it a refresh
     would keep re-announcing the connection; the same tidy-up `?drive=connected` does. */
  useEffect(() => {
    if (new URLSearchParams(location.search).get("sheets") === "connected") {
      window.history.replaceState({}, "", location.pathname);
    }
  }, []);
  const { hydrateDemo } = useAiAssistant();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [shareOnLaunch, setShareOnLaunch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, StepStatus>>({});
  const [, setTick] = useState(0);
  const stepStartRef = useRef<Record<string, number>>({});

  // Delete confirmation + which row is mid-open. Each library dropdown owns its
  // own search + open state (see LibraryPicker below).
  const [pendingDelete, setPendingDelete] = useState<Entry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // While generating, tick every 0.5s so the % bar can creep smoothly even when a
  // single phase (research) runs for minutes — otherwise it looks frozen.
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(id);
  }, [busy]);

  /* One list, three groups: MY demos (library demos I own + prospects I generated
     locally but haven't published), the TEAM library (demos other people created),
     and SAMPLES (the bundled seed prospects, which belong to no one). Search
     matches the prospect, the industry, OR the creator's name or email. */
  const libraryIds = new Set(demos.map((d) => d.id));
  const entries: Entry[] = [
    ...demos.map((d) => {
      const mine = isMine(d);
      return {
        id: d.id, name: d.prospect, industry: d.industry,
        creator: d.creator, mine, inLibrary: true,
        /* Only set when an admin last edited someone else's demo, so the row can
           say so. Comparing against the CREATOR (not against me) is what makes
           it an audit line rather than a "you edited this" note. */
        editedBy: d.updatedBy && d.updatedBy.email.toLowerCase() !== d.creator?.email?.toLowerCase()
          ? d.updatedBy.name : undefined,
        /* An EVENT demo is filed under its event, whoever owns it — the roster is
           the point, not whose copy it is. Ordinary demos split mine/team. */
        group: (eventGroupOf(d.event) ?? (mine ? "mine" : "team")) as EntryGroup,
        listedAs: d.listedAs,
      };
    }),
    ...profiles.filter((p) => !libraryIds.has(p.id)).map((p) => ({
      id: p.id, name: p.customerName, industry: p.industry,
      creator: undefined, mine: false, inLibrary: false,
      // A locally-generated prospect is the user's own (just unpublished); the
      // code-defined seeds are shared samples.
      group: (SEED_IDS.has(p.id) ? "sample" : "mine") as EntryGroup,
    })),
  ];

  function open(id: string) {
    setProfileId(id);
    navigate(LANDING);
  }

  /* Library demos hold their profile server-side — fetch it, register it, open it. */
  async function openEntry(e: Entry) {
    if (!e.inLibrary) return open(e.id);
    setBusyId(e.id);
    const loaded = await openDemo(e.id);
    setBusyId(null);
    if (!loaded) { setError(`Couldn't open ${e.name}.`); return; }
    const profile = CustomerProfile.safeParse(loaded.demo.profile);
    if (!profile.success) { setError(`${e.name} couldn't be loaded (its data doesn't match the current schema).`); return; }
    addProfile(profile.data);
    hydrateDemo(loaded.demo.id, loaded.demo.customizations, loaded.canEdit, loaded.demo.creator);
    open(profile.data.id);
  }

  /* Push a demo that only exists in this browser up to the shared library, so the
     rest of the team can see it. Demos generated before the library existed (and
     the bundled samples) are otherwise stranded locally. */
  async function publish(e: Entry) {
    const p = profiles.find((x) => x.id === e.id);
    if (!p) return;
    setBusyId(e.id);
    const demo = await createDemo(p);
    setBusyId(null);
    if (!demo) { setError(`Couldn't publish ${e.name} to the library.`); return; }
    await openEntry({ ...e, id: demo.id, mine: true, creator: demo.creator, inLibrary: true });
  }

  /* "Make it mine" — server-side copy, then open the copy for editing. */
  async function duplicate(e: Entry) {
    setBusyId(e.id);
    const copy = await duplicateDemo(e.id);
    setBusyId(null);
    if (!copy) { setError(`Couldn't duplicate ${e.name}.`); return; }
    await openEntry({ ...e, id: copy.id, mine: true, creator: copy.creator, inLibrary: true, group: "mine" });
  }

  /* One prospect row. Ownership/state decides the meta line + which actions show:
     mine → delete; someone else's → duplicate; local unpublished → publish.
     A project ADMIN also gets delete on other people's library demos, since the
     server now accepts it. Duplicate stays available either way: making a copy is
     still often what you want, even with the rights to edit in place. */
  function renderRow(e: Entry) {
    const canDelete = e.inLibrary ? (e.mine || admin) : !SEED_IDS.has(e.id);
    return (
      <div key={e.id} className="prospect-option" onClick={() => openEntry(e)}>
        <div className="prospect-option-text">
          <span className="prospect-name">{e.name}</span>
          <span className="prospect-meta">
            {e.industry}
            {e.group === "team" && e.creator && <> · <span className="prospect-owner">{e.creator.name}</span></>}
            {e.editedBy && <> · <span className="prospect-owner">edited by {e.editedBy}</span></>}
            {e.group === "mine" && !e.inLibrary && <> · <span className="prospect-owner">Not published</span></>}
          </span>
        </div>
        <span className="prospect-actions">
          {busyId === e.id && <span className="prospect-spin" aria-label="Opening" />}
          {/* ⚠️ LIBRARY DEMOS ONLY. A mark is stored server-side against the demo
              id, so a local unpublished profile has nothing to attach one to —
              offering the control there would be a button that silently fails. */}
          {e.inLibrary && <DemoMarkButton demoId={e.id} name={e.name} />}
          {/* ⚠️ LIBRARY DEMOS ONLY — a local unpublished profile has no demo record for a
              link to point at — and ADMINS ONLY while the feature is piloted (10/7/2026).
              ⚠️ This is the cosmetic half: `admin` comes from the SERVER, and the server
              refuses share creation from anyone else regardless of what the browser shows.
              Hidden rather than disabled, because a greyed control invites "why not me?" */}
          {e.inLibrary && admin && <ShareDemoButton demoId={e.id} name={e.name} />}
          {!e.inLibrary && !SEED_IDS.has(e.id) && (
            <Tooltip label="Publish to the team library so colleagues can open it">
            <button
              className="prospect-dup"
              aria-label={`Publish ${e.name}`}
              onClick={(ev) => { ev.stopPropagation(); void publish(e); }}
            >
              <span className="material-icons">cloud_upload</span>
            </button>
            </Tooltip>
          )}
          {e.inLibrary && !e.mine && (
            <Tooltip label="Make your own editable copy — the original stays with its owner">
            <button
              className="prospect-dup"
              aria-label={`Duplicate ${e.name}`}
              onClick={(ev) => { ev.stopPropagation(); void duplicate(e); }}
            >
              <span className="material-icons">content_copy</span>
            </button>
            </Tooltip>
          )}
          {/* ⚠️ The delete label states the REAL consequence, and it differs: deleting a
              library demo removes it for the whole team, which is the one thing here
              that cannot be taken back. Same wording as the confirm dialog, so the
              hover and the dialog cannot say different things.
              ⚠️ The comment sits OUTSIDE the `&&` — a JSX comment inside it would be a
              second child of an expression that may return only one element. */}
          {canDelete && (
            <Tooltip
              label={e.inLibrary
                ? "Delete this demo from the team library — it goes for everyone, and cannot be undone"
                : "Delete this demo — this cannot be undone"}
            >
            <button
              className="prospect-delete"
              aria-label={`Delete ${e.name}`}
              onClick={(ev) => { ev.stopPropagation(); setPendingDelete(e); }}
            >
              <span className="material-icons">delete_outline</span>
            </button>
            </Tooltip>
          )}
        </span>
      </div>
    );
  }

  // Overall % — done steps count fully; the in-flight step eases up asymptotically
  // from when it started building, so the bar ALWAYS creeps forward (never frozen),
  // even while one long phase (research) runs for minutes. research/report ramp
  // slower since they're the long sequential prefix. Capped <100 until the real
  // "done" event navigates.
  const RAMP_MS: Record<string, number> = { research: 90000, terms: 15000 };
  const now = Date.now();
  /* A skipped phase is removed from the DENOMINATOR rather than counted as
     done: leaving it in would strand the bar short of 100, and counting it as
     complete would claim work that never happened. */
  const skippedWeight = BUILD_STEPS.reduce((s, st) => s + (statuses[st.key] === "skipped" ? st.weight : 0), 0);
  const doneWeight = BUILD_STEPS.reduce((s, st) => {
    const status = statuses[st.key];
    if (status === "skipped") return s;
    if (status === "done") return s + st.weight;
    if (status === "building") {
      const elapsed = now - (stepStartRef.current[st.key] ?? now);
      const frac = Math.min(0.92, 1 - Math.exp(-elapsed / (RAMP_MS[st.key] ?? 15000)));
      return s + st.weight * frac;
    }
    return s;
  }, 0);
  const pct = Math.min(99, Math.round((doneWeight / Math.max(1, TOTAL_WEIGHT - skippedWeight)) * 100));

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmedName = name.trim();
    let trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) { setError("Enter both a prospect name and a website URL."); return; }
    if (!/^https?:\/\//i.test(trimmedUrl)) trimmedUrl = "https://" + trimmedUrl;

    setError(null);
    setStatuses({});
    stepStartRef.current = {};
    setBusy(true);

    try {
      /* ⚠️ THE SSE READER LIVES IN `src/data/generateStream.ts` NOW (10/8/2026), shared
         with the bulk-generate panel — see the note there on why a second copy would
         drift. The two fields are still all this form sends: the advanced settings panel
         is unmounted (9/25/2026, "remove the advanced settings options for now") and
         nothing server-side was removed, so `/api/generate` still accepts `steer`,
         `scope` and `sources`. */
      const finalProfile = await generateProfile({
        name: trimmedName,
        url: trimmedUrl,
        onPhase: (phase, status) => {
          if (status === "building" && !stepStartRef.current[phase]) stepStartRef.current[phase] = Date.now();
          setStatuses((prev) => ({ ...prev, [phase]: status }));
        },
      });

      const profile = CustomerProfile.parse(finalProfile);
      // Publish to the shared library under your name. If the library is
      // unreachable, fall back to the old local-only behavior rather than
      // losing a demo the user just waited minutes for.
      const demo = await createDemo(profile);
      const saved = demo ? { ...profile, id: demo.id } : profile;
      addProfile(saved);
      if (demo) hydrateDemo(demo.id, { overrides: {}, tiles: {} }, true, demo.creator);
      /* ⚠️⚠️ **AFTER the demo is published, and it CANNOT fail the launch.** A share
         points at a demo record, so there is nothing to point at until `createDemo`
         returns — and an SE who just waited three minutes must not lose the prospect
         because a link could not be made. The failure is reported where it can be acted
         on (the share button on the row), not by discarding the demo. */
      /* ⚠️ ADMIN-GATED like the checkbox that sets it, and NOT only because the
         checkbox is hidden: `admin` arrives from the server asynchronously, so the
         flag and the request must read the same answer at the moment it is used. */
      if (shareOnLaunch && admin && demo) {
        try {
          await fetch(`/api/demos/${encodeURIComponent(demo.id)}/shares`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ days: DEFAULT_SHARE_DAYS, password: "", prospect: profile.customerName }),
          });
        } catch { /* the row's share button is the recovery path */ }
      }
      open(saved.id);
    } catch (err: any) {
      setError(err?.message || "Something went wrong generating this prospect.");
      setBusy(false);
    }
  }

  return (
    <div className="launch-page">
      <div className="launch-card">
        <img className="launch-logo" src="/logo.png" alt="Invoca" />
        <h1 className="launch-title">Launch a demo</h1>
        <p className="launch-sub">
          Enter a prospect's name and website. We'll research their business and spin up the
          Invoca platform pre-loaded with their data.
        </p>

        {busy ? (
          <div className="launch-loading">
            <div className="launch-progress-head">
              <span className="launch-progress-title">Building {name.trim() || "the prospect"}'s Invoca platform…</span>
              <span className="launch-progress-pct">{pct}%</span>
            </div>
            <div className="launch-progress-track">
              <div className="launch-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <ul className="launch-steps">
              {BUILD_STEPS.map((st) => {
                const s = statuses[st.key] ?? "pending";
                return (
                  <li key={st.key} className={"launch-step launch-step-" + s}>
                    <span className="launch-step-ic">
                      {s === "done" ? (
                        <span className="material-icons">check_circle</span>
                      ) : s === "building" ? (
                        <span className="launch-step-spin" />
                      ) : s === "skipped" ? (
                        /* Said outright rather than left looking pending — an
                           Agent-Studio-only run deliberately does not build these. */
                        <span className="material-icons">remove_circle_outline</span>
                      ) : (
                        <span className="material-icons">radio_button_unchecked</span>
                      )}
                    </span>
                    <span className="launch-step-label">{st.label}</span>
                    {s === "skipped" && <span className="launch-step-skip">skipped</span>}
                  </li>
                );
              })}
            </ul>
            <div className="launch-hint">This takes a few minutes — building {BUILD_STEPS.length} pieces of the platform.</div>
          </div>
        ) : (
          <form className="launch-form" onSubmit={launch}>
            <label className="launch-field">
              <span>Prospect name</span>
              <input
                type="text" value={name} autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Shady Blinds"
              />
            </label>
            <label className="launch-field">
              <span>Website URL</span>
              <input
                type="text" value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="e.g. https://www.shadyblindsnow.com"
              />
            </label>
            {/* ⚠️ Above the button and opt-IN: a link that reaches a prospect is not a
                thing to create by accident, and the password defaults to the prospect's
                own name, so it is guessable by anyone holding the URL.
                ⚠️ ADMINS ONLY while the feature is piloted — and a non-admin never sees it,
                so they cannot tick a box whose request the server would then refuse. */}
            {admin && <label className="launch-share">
              <input
                type="checkbox"
                checked={shareOnLaunch}
                onChange={(e) => setShareOnLaunch(e.target.checked)}
              />
              <span>Make this demo shareable</span>
            </label>}
            {/* ⚠️ A DISCLOSURE, CLOSED BY DEFAULT — the launch form is two fields and a
                button and must stay that way at rest.
                ⚠️ **NAMED FOR WHAT IT IS, AND IT SITS ABOVE THE BUTTON** (asked for
                10/8/2026: *"move the advanced settings above the 'Launch Demo' button and
                call it Bulk Generation"*). It was "Advanced", which was the word in the
                request that prompted it — but it holds exactly one thing, and a generic
                label on a single-purpose control is how somebody never finds it. Saying
                so also keeps it clear of the old `AdvancedSettings` panel (custom prompt,
                scope, Gong, Drive), which was removed from this form on request and must
                not come back by having a drawer called "Advanced" to live in. */}
            <details className="launch-bulk">
              <summary>Bulk Generation</summary>
              <BulkGenerate />
            </details>
            {error && <div className="launch-error">{error}</div>}
            <button className="launch-btn" type="submit">Launch demo</button>
          </form>
        )}

        {entries.length > 0 && !busy && (
          <div className="launch-recent">
            <div className="launch-recent-head">
              Demo library
              {me && <span className="launch-me">signed in as {me.name}</span>}
            </div>
            <div className="launch-pickers">
              {GROUP_ORDER.map(([g, label, alwaysShow]) => {
                const rows = entries.filter((e) => e.group === g);
                if (!rows.length && !alwaysShow) return null;
                const ev = EVENTS.find((e) => e.group === g);
                return (
                  <LibraryPicker key={g} label={label} entries={rows} renderRow={renderRow}
                    action={ev ? (
                      <EventSheetButton
                        event={ev.key} label={label} admin={!!eventCfg?.admin}
                        connected={!!eventCfg?.sheetsConnected} connectedAs={me?.email}
                        state={eventCfg?.events.find((x) => x.key === ev.key)}
                        onSaved={loadEvents}
                      />
                    ) : undefined} />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {pendingDelete && (
        <div className="confirm-overlay" onClick={() => setPendingDelete(null)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-icon"><span className="material-icons">warning_amber</span></div>
            <h2 className="confirm-title">Delete this prospect?</h2>
            <p className="confirm-text">
              Are you sure you want to delete <strong>{pendingDelete.name}</strong>?
              {/* Deleting a COLLEAGUE'S demo is the one irreversible thing admin
                  rights unlock, so the dialog has to say whose it is. Without
                  this the copy read identically to deleting your own. */}
              {!pendingDelete.mine && pendingDelete.creator && (
                <> It belongs to <strong>{pendingDelete.creator.name}</strong>, and you are deleting it as an admin.</>
              )}
              {pendingDelete.inLibrary && " This removes it from the team library for everyone."} This can't be undone.
            </p>
            <div className="confirm-actions">
              <button className="confirm-cancel" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button
                className="confirm-delete"
                onClick={() => {
                  const target = pendingDelete;
                  setPendingDelete(null);
                  // Drop the local cache too — otherwise a deleted library demo
                  // reappears in the list as an orphaned local "Sample".
                  if (target.inLibrary) void deleteDemo(target.id);
                  removeProfile(target.id);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
