import { Link, useParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { SldsIcon } from "../components/SldsIcon";
import { SfGlobalHeader, SfContextBar, SfTodoBar } from "../components/SalesforceChrome";
import { salesforceLeadDetail } from "../data/salesforceLeadDetail";

/* =============================================================================
   Lead record page — what clicking a name on the Leads list opens
   -----------------------------------------------------------------------------
   Built off `reference/salesforce/lead-detail-v1.html`, measured at 1920.

   ⚠️ THE INVOCA CAPTURED ATTRIBUTION SECTION IS FILLED, WHICH THE CAPTURE'S IS
   NOT — asked for directly. Every value comes from data another screen already
   shows; see the header comment in `src/data/salesforceLeadDetail.ts`. Address
   Information and Additional Information stay blank, as captured and as asked.

   ⚠️ THE DUPLICATES CARD IS OMITTED, and that is a decision rather than an
   oversight. The capture's Related column opens with "We found 38 potential
   duplicates of this Lead" — true of that org, and impossible here: this demo's
   list is ten leads deduplicated by name, so a duplicate warning would contradict
   the screen an SE just came from. Flagged rather than rendered with an invented
   count.
   ============================================================================= */

/** A field row: label 13/600 #2E2E2E over a 13px value, with a 1px #C9C9C9 rule. */
function Field({ label, children, tall }: { label: string; children?: React.ReactNode; tall?: boolean }) {
  return (
    <div className={"sld-field" + (tall ? " sld-field--tall" : "")}>
      <div className="sld-flabel">{label}</div>
      <div className="sld-fval">
        <span className="sld-fvaltext">{children}</span>
        <SldsIcon name="pencil" size={14} className="sld-fedit" />
      </div>
    </div>
  );
}

/** A collapsible section: the grey band is a BUTTON, not the container. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sld-section">
      <h3 className="sld-sect-h">
        <span className="sld-sect-btn">
          <SldsIcon name="chevrondown" size={16} className="sld-sect-chev" />
          {title}
        </span>
      </h3>
      <div className="sld-grid">{children}</div>
    </div>
  );
}

const STAGES = ["New", "Contacted", "Nurturing", "Unqualified", "Converted"];

export function SalesforceLeadDetail() {
  const { profile } = useProfile();
  const { slug = "" } = useParams();
  const d = salesforceLeadDetail(profile, slug);

  /* ⚠️ FAILS CLOSED on a slug this prospect has no lead for — the same rule the
     created-workflow route documents. A plausible page for a lead that does not
     exist is worse than a refusal. */
  if (!d) {
    return (
      <div className="sfh-root">
        <SfGlobalHeader />
        <SfContextBar active="Leads" />
        <div className="sld-page">
          <div className="sld-missing">
            <h1>Lead not found</h1>
            <p>This prospect has no lead by that name. <Link to="/salesforce/leads">Back to My Leads</Link></p>
          </div>
        </div>
        <SfTodoBar />
      </div>
    );
  }

  const { lead, attribution: a } = d;
  const name = `${lead.first} ${lead.last}`.trim();

  return (
    <div className="sfh-root">
      <SfGlobalHeader />
      <SfContextBar active="Leads" />

      <div className="sld-page">
        {/* ---- record header ---------------------------------------------- */}
        <div className="sld-head">
          <div className="sld-headrow">
            {/* ⚠️ `#06A59A` HERE, `#1B96FF` ON THE LIST VIEW — both measured, on their
                own captures. Left as measured rather than unified; flagged. */}
            <span className="sld-entity"><SldsIcon name="lead" size={20} /></span>
            <div className="sld-headtext">
              <div className="sld-eyebrow">Lead</div>
              <h1 className="sld-title">{name}</h1>
            </div>
            <div className="sld-headbtns">
              <span className="sld-btn sld-btn--solo"><SldsIcon name="add" size={14} />Follow</span>
              <span className="sld-bgrp">
                <span className="sld-btn sld-btn--first">Convert</span>
                <span className="sld-btn">Edit</span>
                <span className="sld-btn">New Case</span>
                <span className="sld-btn sld-btn--icon sld-btn--last"><SldsIcon name="triangledown" size={14} /></span>
              </span>
            </div>
          </div>

          <div className="sld-highlights">
            {[["Title", ""], ["Company", ""], ["Phone", lead.phone], ["Email", lead.email]].map(([l, v]) => (
              <div className="sld-hl" key={l}>
                <div className="sld-hl-label">{l}</div>
                <div className={"sld-hl-val" + (v && l !== "Title" && l !== "Company" ? " sld-hl-val--link" : "")}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ---- the path ---------------------------------------------------- */}
        <div className="sld-path">
          <ul className="sld-stages">
            {STAGES.map((st, i) => (
              <li className={"sld-stage" + (i === 0 ? " sld-stage--current" : "")} key={st}>
                <span className="sld-stage-t">{st}</span>
              </li>
            ))}
          </ul>
          <span className="sld-complete"><SldsIcon name="todo" size={14} />Mark Status as Complete</span>
        </div>

        {/* ---- two columns ------------------------------------------------- */}
        <div className="sld-cols">
          <div className="sld-left">
            <div className="sld-tabs">
              {["Activity", "Details", "Chatter"].map((t) => (
                <span className={"sld-tab" + (t === "Details" ? " sld-tab--on" : "")} key={t}>{t}</span>
              ))}
            </div>

            <div className="sld-card">
              <div className="sld-grid">
                <Field label="Lead Owner" tall><span className="sld-link">{d.owner}</span></Field>
                <Field label="Lead Status">{lead.status}</Field>
                <Field label="Name">{name}</Field>
                <Field label="Phone"><span className="sld-link">{lead.phone}</span></Field>
                <Field label="Company" />
                <Field label="Email"><span className="sld-link">{lead.email}</span></Field>
                <Field label="Title" />
                <Field label="Rating" />
                <Field label="SMS Opt In">{lead.smsOptIn}</Field>
                <Field label="" />
                <Field label="Invoca Attribution ID">{lead.attributionId}</Field>
              </div>

              <Section title="Invoca Captured Attribution">
                <Field label="Line of Business">{a.lineOfBusiness}</Field>
                <Field label="Marketing Source">{a.marketingSource}</Field>
                <Field label="Product of Interest">{a.productOfInterest}</Field>
                <Field label="Marketing Medium">{a.marketingMedium}</Field>
                <Field label="Product Category">{a.productCategory}</Field>
                <Field label="Marketing Campaign">{a.marketingCampaign}</Field>
                <Field label="Product Name">{a.productName}</Field>
                <Field label="Marketing Search Terms">{a.marketingSearchTerms}</Field>
                <Field label="Product Promotion">{a.productPromotion}</Field>
                <Field label="Website Journey">{a.websiteJourney}</Field>
                <Field label="" />
                <Field label="Website Calling Page">{a.websiteCallingPage}</Field>
              </Section>

              {/* Deliberately empty, as captured and as asked. */}
              <Section title="Address Information">
                <Field label="Address" />
                <Field label="Website" />
              </Section>
              <Section title="Additional Information">
                <Field label="No. of Employees" />
                <Field label="Lead Source" />
                <Field label="Annual Revenue" />
                <Field label="Industry" />
                <Field label="Description" />
                <Field label="" />
                <Field label="Created By"><span className="sld-link">{d.owner}</span>, {d.createdAt}</Field>
                <Field label="Last Modified By"><span className="sld-link">{d.owner}</span>, {d.modifiedAt}</Field>
              </Section>

              <Section title="Custom Links">
                <div className="sld-links">
                  {["Google Search", "Google Maps", "Send Gmail", "Google News", "Hoovers Profile"].map((t) => (
                    <span className="sld-link" key={t}>{t}</span>
                  ))}
                </div>
              </Section>
            </div>
          </div>

          <div className="sld-right">
            <div className="sld-rcard">
              <div className="sld-rhead">
                <span className="sld-rent sld-rent--call"><img src="/icons/salesforce/invoca-call-log.png" alt="" /></span>
                <span className="sld-rtitle">Invoca Call Log (1)</span>
                <span className="sld-ribtn"><SldsIcon name="triangledown" size={14} /></span>
              </div>
              <div className="sld-rbody">
                <Link className="sld-link" to={`/salesforce/call-log/${d.callLogName}`}>{d.callLogName}</Link>
              </div>
              <div className="sld-rfoot"><span className="sld-link">View All</span></div>
            </div>

            <div className="sld-rcard">
              <div className="sld-rhead">
                <span className="sld-rent sld-rent--camp"><SldsIcon name="guidance" size={20} /></span>
                <span className="sld-rtitle">Campaign History (0)</span>
                <span className="sld-ribtn"><SldsIcon name="triangledown" size={14} /></span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SfTodoBar />
    </div>
  );
}
