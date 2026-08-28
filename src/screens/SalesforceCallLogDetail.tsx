import { Link, useParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { SldsIcon } from "../components/SldsIcon";
import { SfGlobalHeader, SfContextBar, SfTodoBar } from "../components/SalesforceChrome";
import { salesforceCallLogRecord, type SfField, type SfSignalRow } from "../data/salesforceCallLogRecord";

/* =============================================================================
   Invoca Call Log record page — what the INVOCA-… link opens
   -----------------------------------------------------------------------------
   Built off `reference/salesforce/call-log-detail-v1.html`, measured at 1920 the
   same way as the other Salesforce screens.

   ⚠️ THE HEADER IS A FULL-BLEED 80px `#F3F3F3` BAND, not the inset rounded slab the
   Lead record page carries. Same family of page, different chrome, both measured on
   their own captures.

   ⚠️ SIGNALS AND CUSTOM DATA ARE COLLAPSED FROM THE CAPTURE'S PAIRED GENERIC FIELDS
   into one row each, and Enriched Caller Data is cut from 23 fields to 8 — all three
   asked for directly. See the header comment in `salesforceCallLogRecord.ts` for what
   the capture actually stores and why collapsing it is what those rows mean.
   ============================================================================= */

/** A field row: label 13/600 `#2E2E2E` over a 13px `#181818` value, with a 1px rule. */
function Field({ f }: { f: SfField }) {
  /* An empty name renders as a spacer, which is how the capture fills an odd column. */
  if (!f.name) return <div className="clr-field clr-field--spacer" />;
  return (
    <div className="clr-field">
      {/* ⚠️ THE 1px SEPARATOR IS ON THIS INNER BOX, NOT THE ITEM — measured. The item is
          610.5 wide with 12px of padding, and the rule spans only the 586.5 inside it, so
          putting the border on the outer element draws it 24px too wide. */}
      <div className="clr-fbox">
        <div className="clr-flabel">{f.name}</div>
        <div className="clr-fval">
          <span className="clr-fvaltext">
            {f.value === "__PLAY__"
              ? <img className="clr-play" src="/icons/salesforce/play-recording.png" alt="PLAY RECORDING" />
              : f.value}
          </span>
          <SldsIcon name="pencil" size={14} className="clr-fedit" />
        </div>
      </div>
    </div>
  );
}

/** A collapsible section: the grey band is a BUTTON inside the h3, as on the Lead page. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="clr-section">
      <h3 className="clr-sect-h">
        <span className="clr-sect-btn">
          <SldsIcon name="chevrondown" size={16} className="clr-sect-chev" />
          {title}
        </span>
      </h3>
      <div className="clr-grid">{children}</div>
    </div>
  );
}

/**
 * ONE ROW ACROSS BOTH COLUMNS: the name on the left, what it holds on the right.
 *
 * ⚠️ THIS IS THE SHAPE ASKED FOR, and it is NOT the stacked label-over-value the rest
 * of the page uses: "for signals the left column is the name and the right column is a
 * check … Custom Data: left column is the name of the data and the right column is the
 * value of the name." Rendering these as ordinary fields instead puts TWO DIFFERENT
 * KEYS on one row, each with its own value underneath — which is what the capture's
 * generic `Customer Business Object Name 0` / `Value 0` pairing already looks like once
 * the generic labels are stripped, i.e. exactly the thing being collapsed.
 */
function PairRow({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <>
      <div className="clr-field clr-field--pair">
        <div className="clr-fbox"><div className="clr-flabel">{name}</div></div>
      </div>
      <div className="clr-field clr-field--pair">
        <div className="clr-fbox">
          <div className="clr-fval">
            <span className="clr-fvaltext">{children}</span>
            <SldsIcon name="pencil" size={14} className="clr-fedit" />
          </div>
        </div>
      </div>
    </>
  );
}

/** One signal: its name on the left, a check (or the dashed box) on the right. */
function SignalRow({ s }: { s: SfSignalRow }) {
  return (
    <PairRow name={s.name}>
      {/* ⚠️ THE UNFIRED STATE IS A DASHED SQUARE, not an absence — see the note on
          `checkboxdash` in SldsIcon. Drawing nothing would make a signal that did not
          fire look like a field the page failed to render. */}
      <SldsIcon name={s.fired ? "check" : "checkboxdash"} size={16}
        className={"clr-check" + (s.fired ? " clr-check--on" : "")} />
    </PairRow>
  );
}

export function SalesforceCallLogDetail() {
  const { profile } = useProfile();
  const { name = "" } = useParams();
  const d = salesforceCallLogRecord(profile, name);

  /* Fails closed on a record this prospect's org has no row for. */
  if (!d) {
    return (
      <div className="sfh-root">
        <SfGlobalHeader />
        <SfContextBar active="Invoca Call Log" />
        <div className="clr-page">
          <div className="clr-missing">
            <h1>Record not found</h1>
            <p>
              This prospect has no Invoca Call Log record by that name.{" "}
              <Link to="/salesforce/call-log">Back to Recently Viewed</Link>
            </p>
          </div>
        </div>
        <SfTodoBar />
      </div>
    );
  }

  return (
    <div className="sfh-root">
      <SfGlobalHeader />
      <SfContextBar active="Invoca Call Log" />

      <div className="clr-page">
        {/* ---- the full-bleed record header ------------------------------- */}
        <div className="clr-head">
          {/* #8B85F9 — the same purple the Call Log list and Seller Home's record tile
              carry. One object, one colour, measured on all three captures. */}
          <span className="clr-entity"><img src="/icons/salesforce/invoca-call-log.png" alt="" /></span>
          <div className="clr-headtext">
            <div className="clr-eyebrow">Invoca Call Log</div>
            <h1 className="clr-title">{d.name}</h1>
          </div>
          <div className="clr-headbtns">
            <span className="clr-bgrp">
              <span className="clr-btn clr-btn--first">New Contact</span>
              <span className="clr-btn">Edit</span>
              <span className="clr-btn">New Opportunity</span>
              <span className="clr-btn clr-btn--icon clr-btn--last">
                <SldsIcon name="triangledown" size={14} />
              </span>
            </span>
          </div>
        </div>

        {/* ---- two columns ------------------------------------------------ */}
        <div className="clr-cols">
          <div className="clr-left">
            <div className="clr-tabs">
              {["Related", "Details"].map((t) => (
                <span className={"clr-tab" + (t === "Details" ? " clr-tab--on" : "")} key={t}>{t}</span>
              ))}
              <span className="clr-tab clr-tab--more">
                More<SldsIcon name="triangledown" size={12} className="clr-tab-chev" />
              </span>
            </div>

            <div className="clr-card">
              {/* The unlabelled top section: the object's lookups. */}
              <div className="clr-grid">
                {d.relations.map((f, i) => (
                  f.name === "Lead" && d.lead
                    ? (
                      <div className="clr-field" key={`${f.name}-${i}`}>
                        <div className="clr-fbox">
                        <div className="clr-flabel">Lead</div>
                        <div className="clr-fval">
                          <span className="clr-fvaltext">
                            {/* ⚠️ THE ONE LIVE LINK ON THIS PAGE, and it closes the loop:
                                the lead links here and this links back. */}
                            <Link className="clr-link" to={`/salesforce/leads/${d.lead.slug}`}>{d.lead.name}</Link>
                          </span>
                          <SldsIcon name="pencil" size={14} className="clr-fedit" />
                        </div>
                        </div>
                      </div>
                    )
                    : <Field f={f} key={`${f.name}-${i}`} />
                ))}
              </div>

              <Section title="Call Data">
                {d.callData.map((f, i) => <Field f={f} key={`${f.name}-${i}`} />)}
              </Section>

              <Section title="Caller Data">
                {d.callerData.map((f, i) => <Field f={f} key={`${f.name}-${i}`} />)}
              </Section>

              <Section title="Enriched Caller Data">
                {d.enriched.map((f, i) => <Field f={f} key={`${f.name}-${i}`} />)}
              </Section>

              <Section title="Campaign Data">
                {d.campaign.map((f, i) => <Field f={f} key={`${f.name}-${i}`} />)}
              </Section>

              <Section title="Signals">
                {d.signals.map((s) => <SignalRow s={s} key={s.name} />)}
              </Section>

              <Section title="Custom Data">
                {d.customData.map((f) => <PairRow name={f.name} key={f.name}>{f.value}</PairRow>)}
                {/* Created By and Last Modified By are ordinary record fields, not custom
                    data pairs, so they keep the stacked treatment the rest of the page uses
                    — as the capture has them. */}
                <Field f={{ name: "Created By", value: `${d.owner}, ${d.createdAt}` }} />
                <Field f={{ name: "Last Modified By", value: `${d.owner}, ${d.modifiedAt}` }} />
              </Section>
            </div>
          </div>

          {/* ---- the Activity panel ---------------------------------------- */}
          <div className="clr-right">
            <div className="clr-tabs clr-tabs--right">
              <span className="clr-tab clr-tab--on">Activity</span>
            </div>
            <div className="clr-rcard">
              <div className="clr-pubrow">
                {[["calendar", "#F5A623"], ["todo", "#2CBF58"], ["call", "#0D9DDA"], ["email", "#747474"]].map(([ic, bg]) => (
                  <span className="clr-pub" key={ic}>
                    <span className="clr-pub-ic" style={{ background: bg }}><SldsIcon name={ic} size={14} /></span>
                    <span className="clr-pub-caret"><SldsIcon name="triangledown" size={10} /></span>
                  </span>
                ))}
              </div>
              <div className="clr-filters">Filters: All time • All activities • All types</div>
              <div className="clr-actlinks">
                <span className="clr-link">Refresh</span><span className="clr-dot">•</span>
                <span className="clr-link">Expand All</span><span className="clr-dot">•</span>
                <span className="clr-link">View All</span>
              </div>
              <div className="clr-actband">
                <SldsIcon name="chevrondown" size={14} className="clr-sect-chev" />Upcoming &amp; Overdue
              </div>
              {/* The capture's own empty state, verbatim — this org logs no activities
                  against a call record, and inventing a task history here would claim
                  follow-up the rest of the demo never shows. */}
              <div className="clr-empty">
                <div>No activities to show.</div>
                <div>Get started by sending an email, scheduling a task, and more.</div>
              </div>
              <div className="clr-empty clr-empty--past">
                No past activity. Past meetings and tasks marked as done show up here.
              </div>
            </div>
          </div>
        </div>
      </div>

      <SfTodoBar />
    </div>
  );
}
