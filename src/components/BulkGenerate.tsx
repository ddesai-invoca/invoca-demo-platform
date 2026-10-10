import { useRef, useState } from "react";
import { CustomerProfile } from "../data/schema";
import { EVENTS } from "../data/eventDemos";
import { useDemoLibrary } from "../data/DemoLibraryContext";
import { useProfile } from "../data/ProfileContext";
import { generateProfile } from "../data/generateStream";
import { parseRoster, ROSTER_TEMPLATE, ROSTER_MAX, type ParsedRoster } from "../data/rosterImport";
import { CustomPrompt, PlanProgress, PlanReview, requestPlan, usePlanProgress } from "./CustomPrompt";
import { SURFACES } from "../data/demoSurfaces";
import { applyPlan } from "../data/applyPlan";
import { useAiAssistant } from "../data/AiAssistantContext";
import type { DemoPlan } from "../../engine/demoPlan";

/* =============================================================================
   BulkGenerate — a filled-in template becomes a whole event roster
   -----------------------------------------------------------------------------
   Asked for 10/8/2026: *"add a advance settings and have a mass generate option
   (maybe they can download a template and fill in the information and then upload
   it) and also allow them to pick which event they want to add it to."*

   ⚠️⚠️ **A NEW PANEL, NOT THE OLD `AdvancedSettings` ONE REMOUNTED.** That component
   still exists and is still audited, but it holds the custom prompt, scope toggle,
   Gong and Drive — all of which were removed from this form on request ("remove the
   advanced settings options for now"). Putting it back to reach one new control would
   quietly undo that.

   ⚠️⚠️ **ONE AT A TIME, IN THE BROWSER, DELIBERATELY.** `scripts/generate-event-demos.ts`
   already exists for a 59-row roster and runs 3-wide over hours; this is the in-app
   path for the size an SE actually assembles between sessions. Sequential because the
   engine's own pool is already 6-wide per prospect — stacking browser-side parallelism
   on top buys little and makes a rate limit everybody's problem at once.
   ⚠️ **CONSEQUENCE, STATED ON SCREEN: the tab has to stay open.** ~2-3 minutes per
   prospect, so 20 rows is about an hour.
   ============================================================================= */

type RowState = "waiting" | "building" | "done" | "failed" | "skipped";

interface Progress {
  name: string;
  state: RowState;
  detail?: string;
}

export default function BulkGenerate() {
  const { createDemo, demos } = useDemoLibrary();
  const { addProfile } = useProfile();
  const { registerBase, applyEdits, addTile, effectiveData } = useAiAssistant();
  const [parsed, setParsed] = useState<ParsedRoster | null>(null);
  const [fileName, setFileName] = useState("");
  const [event, setEvent] = useState("");
  const [rows, setRows] = useState<Progress[]>([]);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  /* ⚠️ **ONE PROMPT FOR THE WHOLE ROSTER**, which is what was asked for. A per-row column
     in the template was the other option and was turned down: it makes the template harder
     to fill in and the confirm step would have to cover twenty different plans.
     ⚠️ `planFor` pins the plan to the exact text it was built from, so an edit after
     confirming re-reads rather than running something nobody agreed to. */
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<DemoPlan | null>(null);
  const [planFor, setPlanFor] = useState("");
  const [planning, setPlanning] = useState(false);
  const planPct = usePlanProgress(planning);

  function downloadTemplate() {
    const blob = new Blob([ROSTER_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "prospect-roster-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function onFile(file: File) {
    setErr(null);
    const text = await file.text();
    const p = parseRoster(text);
    setFileName(file.name);
    setParsed(p);
    setRows(p.rows.map((r) => ({ name: r.name, state: "waiting" as RowState })));
    if (!p.rows.length) setErr("No usable rows — the file needs a name and a website on each line.");
  }

  /* ⚠️⚠️ **THE SAME CONFIRM STEP AS THE SINGLE LAUNCH, AND IT MATTERS MORE HERE.** A
     misread prompt costs one demo on the launch form and an HOUR across twenty rows, so
     Generate reads the prompt back first and only builds on the second press. With no
     prompt written this branch is never entered and the panel behaves exactly as before. */
  async function run() {
    if (!parsed?.rows.length || running || planning) return;
    const wanted = prompt.trim();
    if (wanted && (!plan || planFor !== wanted)) {
      setErr(null);
      setPlanning(true);
      try {
        const got = await requestPlan({ prospect: "", url: "", prompt: wanted, surfaces: SURFACES, bulk: true });
        setPlan(got);
        setPlanFor(wanted);
      } catch (e: any) {
        setErr(e?.message || "Could not read that back.");
      } finally { setPlanning(false); }
      return;
    }
    await build();
  }

  async function build() {
    if (!parsed?.rows.length) return;
    const confirmed = prompt.trim() ? plan : null;
    setRunning(true);
    setErr(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    /* ⚠️ RESUMABLE BY CONSTRUCTION, the same rule the 59-row seeder follows: a prospect
       the library already holds is SKIPPED rather than built again. A roster is hours of
       work, and a dropped connection partway through must not mean starting over. */
    const existing = new Set(demos.map((d) => d.prospect.trim().toLowerCase()));

    for (let i = 0; i < parsed.rows.length; i++) {
      if (ctl.signal.aborted) break;
      const row = parsed.rows[i];
      if (existing.has(row.name.trim().toLowerCase())) {
        setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "skipped", detail: "already in the library" } : x)));
        continue;
      }
      setRows((r) => r.map((x, j) => (j === i ? { ...x, state: "building", detail: "researching…" } : x)));
      try {
        const raw = await generateProfile({
          name: row.name,
          url: row.url,
          signal: ctl.signal,
          /* The steer half, on every row of the roster. */
          ...(confirmed?.steer ? { steer: confirmed.steer } : {}),
          onPhase: (phase, status) =>
            setRows((r) => r.map((x, j) => (j === i && status === "building" ? { ...x, detail: phase } : x))),
        });
        const profile = CustomerProfile.parse(raw);
        const demo = await createDemo(profile, undefined, event || undefined);
        /* Same fallback the single launch takes: a library that is unreachable must not
           lose a prospect somebody just waited three minutes for. */
        addProfile(demo ? { ...profile, id: demo.id } : profile);
        /* ⚠️ APPLIED PER ROW, AFTER THAT ROW IS PUBLISHED, AND IT CANNOT FAIL THE ROW.
           Each prospect gets its own scope keys, so the plan lands on the demo it was
           generated for rather than on whichever one happened to be open. */
        if (confirmed?.items.length && demo) {
          setRows((r) => r.map((x, j) => (j === i ? { ...x, detail: "applying your changes…" } : x)));
          try {
            await applyPlan(confirmed, profile, demo.id,
              { registerBase, applyEdits, addTile, effectiveData }, undefined, ctl.signal);
          } catch { /* reported per item; never loses the prospect */ }
        }
        setRows((r) => r.map((x, j) => (j === i
          ? { ...x, state: "done", detail: demo ? undefined : "built, but not published" } : x)));
      } catch (e: unknown) {
        if (ctl.signal.aborted) break;
        /* ⚠️ ONE FAILURE DOES NOT STOP THE ROSTER. A single site that blocks a
           datacenter IP would otherwise take the other 39 prospects with it; the row
           carries its own reason and the run moves on. */
        setRows((r) => r.map((x, j) => (j === i
          ? { ...x, state: "failed", detail: (e as Error)?.message || "generation failed" } : x)));
      }
    }
    abortRef.current = null;
    setRunning(false);
  }

  const done = rows.filter((r) => r.state === "done").length;
  const failed = rows.filter((r) => r.state === "failed").length;
  const skipped = rows.filter((r) => r.state === "skipped").length;
  const minutes = parsed ? Math.round(parsed.rows.length * 2.5) : 0;

  return (
    <div className="blk">
      <p className="blk-lede">
        Build a whole roster at once. Download the template, fill in a prospect name and
        website per row, and upload it.
      </p>

      <div className="blk-actions">
        <button type="button" className="evs-ghost" onClick={downloadTemplate}>
          <span className="material-icons">download</span>Download template
        </button>
        <button type="button" className="evs-ghost" onClick={() => fileRef.current?.click()} disabled={running}>
          <span className="material-icons">upload_file</span>{fileName || "Upload a filled template"}
        </button>
        <input
          ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }}
        />
      </div>

      <label className="blk-label" htmlFor="blk-event">Add them to</label>
      <select id="blk-event" className="blk-select" value={event} disabled={running}
        onChange={(e) => setEvent(e.target.value)}>
        {/* ⚠️ "No event" IS FIRST AND IS THE DEFAULT — filing a roster under a conference
            nobody picked is the harder mistake to undo of the two. */}
        <option value="">No event — just My demos</option>
        {EVENTS.map((ev) => <option key={ev.key} value={ev.key}>{ev.label}</option>)}
      </select>

      <div className="dcp-inline">
        <CustomPrompt bulk value={prompt} disabled={running || planning} onChange={(v) => {
          setPrompt(v);
          /* Editing invalidates a confirmed plan — see the note on `planFor`. */
          if (plan) setPlan(null);
        }} />
      </div>

      {parsed && (
        <div className="blk-summary">
          <strong>{parsed.rows.length}</strong> prospect{parsed.rows.length === 1 ? "" : "s"} ready
          {parsed.rows.length > 0 && <> · roughly {minutes} minute{minutes === 1 ? "" : "s"}, and this tab has to stay open</>}
          {parsed.skipped.length > 0 && (
            <ul className="blk-skips">
              {parsed.skipped.slice(0, 8).map((s) => (
                <li key={s.line}>Line {s.line} skipped — {s.reason}</li>
              ))}
              {parsed.skipped.length > 8 && <li>…and {parsed.skipped.length - 8} more</li>}
            </ul>
          )}
        </div>
      )}

      {err && <div className="evs-err">{err}</div>}

      {!running && plan && planFor === prompt.trim() && (
        <PlanReview
          plan={plan}
          prompt={planFor}
          confirmLabel={`Confirm and build ${parsed?.rows.length ?? 0}`}
          onEdit={() => setPlan(null)}
          onConfirm={() => void build()}
        />
      )}

      {rows.length > 0 && (
        <ol className="blk-rows">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className={"blk-row blk-row--" + r.state}>
              <span className="blk-row-name">{r.name}</span>
              <span className="blk-row-state">
                {r.state === "done" ? "Built"
                  : r.state === "failed" ? `Failed — ${r.detail}`
                  : r.state === "skipped" ? `Skipped — ${r.detail}`
                  : r.state === "building" ? (r.detail ?? "building…")
                  : "waiting"}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="blk-foot">
        {running ? (
          <>
            <span className="blk-count">{done + failed + skipped} of {rows.length}</span>
            {/* ⚠️ STOP ABORTS THE REQUEST IN FLIGHT AND KEEPS EVERYTHING ALREADY BUILT —
                every finished prospect is already published, so nothing is rolled back. */}
            <button type="button" className="evs-unlink" onClick={() => abortRef.current?.abort()}>Stop</button>
          </>
        ) : (
          <button type="button" className="dmk-submit" disabled={!parsed?.rows.length || planning} onClick={run}>
            {planning ? <PlanProgress pct={planPct} />
              : done + failed + skipped > 0 ? "Run again"
              : `Generate ${parsed?.rows.length ?? 0}`}
          </button>
        )}
      </div>
      {rows.length > 0 && !running && (
        <div className="blk-hint">
          {done} built{failed ? `, ${failed} failed` : ""}{skipped ? `, ${skipped} already in the library` : ""}.
          {parsed && parsed.rows.length > ROSTER_MAX ? ` Only the first ${ROSTER_MAX} rows are used.` : ""}
        </div>
      )}
    </div>
  );
}
