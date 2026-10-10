import type { DemoPlan } from "../../engine/demoPlan";
import { surfaceById, type DemoSurface } from "../data/demoSurfaces";

/* =============================================================================
   CustomPrompt — write what you want, read back what will be built, confirm
   -----------------------------------------------------------------------------
   Asked for 10/9/2026, under *Make this demo shareable* on the launch form:
   *"allow this custom prompt to drop down a text box where the user can write exactly
   what they want the demo to generate once they hit Launch Demo. I want you to confirm
   with them your understanding of what they are asking. Once they hit Confirm, then
   generate, so they're not having to waste their time."*

   ⚠️⚠️ **THE CONFIRM STEP SITS ON THE LAUNCH BUTTON, NOT ON A SECOND "REVIEW" BUTTON,
   AND THAT IS WHAT THE REQUEST SAYS.** A review button beside Launch is a control most
   people never press, which leaves the three-minute mistake exactly where it was. So
   with a prompt written, the first Launch click reads it back; the second one builds.
   An empty prompt is unchanged: one click, straight to generating, exactly as before.

   ⚠️ **A DISCLOSURE, CLOSED BY DEFAULT.** The launch form is two fields and a button and
   has to stay that way at rest, which is the same rule Bulk Generation sits under.
   ============================================================================= */

/** What the parent holds while the SE is deciding. */
export interface PlanState { prompt: string; plan: DemoPlan }

export async function requestPlan(input: {
  prospect: string; url: string; prompt: string; surfaces: DemoSurface[]; bulk?: boolean;
}): Promise<DemoPlan> {
  const res = await fetch("/api/demo-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    /* ⚠️ ONLY THE THREE FIELDS THE PLANNER NEEDS. `base` is a function and the rest is
       this prospect's whole dataset; sending the surface objects whole would both fail
       to serialise and put the demo's data in a request that does not need it. */
    body: JSON.stringify({
      prospect: input.prospect, url: input.url, prompt: input.prompt, bulk: !!input.bulk,
      surfaces: input.surfaces.map((s) => ({ id: s.id, label: s.label, what: s.what })),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || "Could not read that back.");
  return body.plan as DemoPlan;
}

export function CustomPrompt({ value, onChange, disabled, bulk }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  bulk?: boolean;
}) {
  return (
    <div className="dcp-field">
      <label className="dcp-label" htmlFor={bulk ? "dcp-bulk" : "dcp-one"}>
        {bulk ? "What should every demo in this roster do?" : "What should this demo do?"}
      </label>
      <textarea
        id={bulk ? "dcp-bulk" : "dcp-one"}
        className="dcp-text"
        value={value}
        disabled={disabled}
        rows={5}
        onChange={(e) => onChange(e.target.value)}
        placeholder={bulk
          ? "e.g. These are all healthcare systems. Lead with the voice agent, have it screen for urgency and route to the right department, and make the SMS agent handle appointment reminders."
          : "e.g. Make the SMS agent book pest control treatments and ask which pest they are seeing first. Give the voice agent an after hours flow that takes a callback number. On the Marketing dashboard, add a Cancellations column to the Campaign table."}
      />
      <p className="dcp-hint">
        {bulk
          ? "Written once, read back once, then applied to every prospect in the upload."
          : "Leave it blank to build the demo the usual way. Anything you write here is read back to you before anything runs."}
      </p>
    </div>
  );
}

/**
 * The confirm screen. Everything on it is what will actually happen: each row names one
 * screen and the change going to it, and `cannot` names the parts this platform has no
 * way to do.
 */
export function PlanReview({ plan, prompt, onEdit, onConfirm, confirmLabel }: {
  plan: DemoPlan;
  prompt: string;
  onEdit: () => void;
  onConfirm: () => void;
  confirmLabel: string;
}) {
  return (
    <div className="dcp-review">
      <h2 className="dcp-review-title">Here is what I understood</h2>
      <p className="dcp-understood">{plan.understood}</p>

      {plan.steer && (
        <div className="dcp-block">
          <div className="dcp-block-head">
            <span className="material-icons">auto_awesome</span>
            While it generates
          </div>
          <p className="dcp-steer">{plan.steer}</p>
        </div>
      )}

      {/* ⚠️⚠️ **ZERO EDITS IS SAID OUT LOUD, NOT LEFT AS AN ABSENT BLOCK.** A real run came
          back with a steer and NO items while its summary promised three screen changes,
          and with the block simply hidden the screen described changes and listed none.
          Saying "none" lets the SE reword before spending the three minutes, which is the
          entire point of this step. */}
      {plan.steer && !plan.items.length && (
        <div className="dcp-block">
          <div className="dcp-block-head">
            <span className="material-icons">edit_note</span>
            Per screen changes
          </div>
          <p className="dcp-steer">
            None. Everything above comes from how the demo generates. If you expected a
            specific screen to change, name the screen and the change and I will read it
            back again.
          </p>
        </div>
      )}

      {plan.items.length > 0 && (
        <div className="dcp-block">
          <div className="dcp-block-head">
            <span className="material-icons">edit_note</span>
            Then {plan.items.length === 1 ? "this change" : `these ${plan.items.length} changes`}
          </div>
          <ul className="dcp-items">
            {plan.items.map((i, n) => (
              <li className="dcp-item" key={n}>
                {/* The surface's own label, never the id: "sms-agent" is a key, not something
                    an SE reads. */}
                <span className="dcp-item-where">{surfaceById(i.surface)?.label ?? i.surface}</span>
                <span className="dcp-item-says">{i.says}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ⚠️ SAID UP FRONT, NOT DISCOVERED AFTERWARDS. A request for a colour or a layout
          change cannot be done by any path in this platform, so without this the SE waits
          three minutes to find that part of their prompt did nothing at all. */}
      {plan.cannot.length > 0 && (
        <div className="dcp-block dcp-block--cannot">
          <div className="dcp-block-head">
            <span className="material-icons">info</span>
            What I cannot do
          </div>
          <ul className="dcp-cannot">
            {plan.cannot.map((c, n) => <li key={n}>{c}</li>)}
          </ul>
        </div>
      )}

      {!plan.steer && !plan.items.length && (
        <p className="dcp-empty">
          I could not turn that into anything this platform can change. Try naming the screen
          and the change, for example "on the SMS agent, ask for a postcode first".
        </p>
      )}

      <details className="dcp-yours">
        <summary>What you wrote</summary>
        <p>{prompt}</p>
      </details>

      <div className="dcp-actions">
        <button type="button" className="dcp-btn dcp-btn--ghost" onClick={onEdit}>Edit what I wrote</button>
        <button
          type="button"
          className="dcp-btn"
          onClick={onConfirm}
          disabled={!plan.steer && !plan.items.length}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
