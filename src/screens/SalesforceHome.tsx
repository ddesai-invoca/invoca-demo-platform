import { useProfile } from "../data/ProfileContext";

/* =============================================================================
   Salesforce — Seller Home. Screen 1 of the Sales Cloud flow.
   -----------------------------------------------------------------------------
   Reached from the **Sales Cloud** tile on Integrations. Real URL
   `invocaforhealthcare.lightning.force.com/lightning/page/home`. Measured off a SingleFile
   capture (8/24/2026), which serialises Lightning's own SLDS stylesheet, so every value
   below is a computed style rather than a screenshot estimate.

     global header   50 tall
     nav bar         40 tall, white, 3px #0070D2 bottom border
     page            #F3F3F3 behind white cards
     "Seller Home"   the banner heading, with the greeting beside it at 300 13/49 #444444
     card            457.7 x 333, white, radius 4, 1px #C9C9C9,
                       shadow `0 2px 2px rgba(0,0,0,.1)`
     card title      700 16/20 #181818; subtitle 13/19.5
     hero value      300 28/35 #2E2E2E over a 13/19.5 label
     donut           150 x 150, circle r=72, stroke-width 6, track #E5E5E5
     legend dot      10px circle; pill radius 4, padding 4px 9.6px, 26 tall
     footer button   full width, 32 tall, 1px #747474, radius 4, ink #0176D3
     42px between legend rows

   ⚠️ A REACT REPLICA, NOT AN EXACT-COPY PAGE, and that is a departure from the
   third-party-console convention (Google Ads and the Invoca Exchange are saved HTML). The
   reason is the FLOW: the next screens have to show the appointment the SMS AI agent just
   booked and open it with the conversation's own values, so these screens need prospect
   data and real navigation. A 1.6MB Lightning document can do neither.

   ⚠️ THE CAPTURED ORG IS EMPTY — $0 pipeline, 0 contacts, 0 leads, 5 accounts with no
   activity — and that is reproduced rather than filled in. This is the SE's own Salesforce,
   not the prospect's, so inventing a pipeline here would be inventing Invoca's numbers, and
   the one thing on this screen that IS the demo (the Invoca call records under Recent
   Records) is derived from the prospect instead.

   ⚠️ THE THREE LEGEND PALETTES ARE MEASURED PAIRS, not one colour at two opacities:
     open   dot #06A59A  pill #ACF3E4  ink #056764
     won    dot #0D9DDA  pill #CFE9FE  ink #05628A
     lost   dot #FE5C4C  pill #FEDED8  ink #BA0517
   ============================================================================= */

/* Tabs verbatim from the capture's nav, in order. `Calendar` is where this flow goes next.
   ⚠️ The capture's DOM also carries an "<X> List" entry per tab — those are the dropdown
   items, not tabs, and counting them gives 20 where the bar shows 16. */
const TABS = [
  "Home", "Opportunities", "Leads", "Tasks", "Files", "Accounts", "Contacts", "Campaigns",
  "Dashboards", "Reports", "Chatter", "Groups", "Calendar", "People", "Cases", "Forecasts",
];
/** Which tabs carry a dropdown chevron in the capture. Chatter and Forecasts do not. */
const NO_CHEVRON = new Set(["Home", "Chatter", "Forecasts"]);

type Tone = "open" | "won" | "lost";

function Ring({ value, label, tone }: { value: string; label: string; tone?: Tone }) {
  /* 150x150 with r=72 and a 6px stroke, so the ring sits just inside the box. A full ring
     is what the capture draws — nothing here is a partial arc. */
  const stroke = tone === "lost" ? "#FE5C4C" : "#E5E5E5";
  return (
    <div className="sfh-ring">
      <svg width={150} height={150} aria-hidden="true">
        <circle cx={75} cy={75} r={72} fill="none" stroke={stroke} strokeWidth={6} />
      </svg>
      <span className="sfh-ring-value">{value}</span>
      <span className="sfh-ring-label">{label}</span>
    </div>
  );
}

function Legend({ rows }: { rows: { tone: Tone; text: string }[] }) {
  return (
    <ul className="sfh-legend">
      {rows.map((r) => (
        <li className="sfh-legend-row" key={r.text}>
          <span className={"sfh-dot sfh-dot--" + r.tone} />
          <span className={"sfh-pill sfh-pill--" + r.tone}>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Card({ title, subtitle, children, action }: {
  title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <article className="sfh-card">
      <h2 className="sfh-card-title">{title}</h2>
      {subtitle ? <p className="sfh-card-sub">{subtitle}</p> : null}
      <div className="sfh-card-body">{children}</div>
      {action ? <div className="sfh-card-foot">{action}</div> : null}
    </article>
  );
}

const Btn = ({ children }: { children: React.ReactNode }) => (
  /* Inert: the capture's buttons open Salesforce list views, which are not part of this
     flow. Only the Calendar tab navigates, so nothing else takes a pointer. */
  <span className="sfh-btn">{children}</span>
);

export function SalesforceHome() {
  const { profile } = useProfile();

  /* ⚠️ RECENT RECORDS IS THE ONE DATA-BEARING TILE, and it is the prospect's own: the
     caller from the Voice Screenpop plus real Invoca call record ids, so the record an SE
     opens here is the same call the rest of the demo talks about. The capture's own rows
     are that account's (`Michael Pierce`, `INVOCA-000257…`), which name a real person. */
  const caller = profile.reports.voiceScreenpop?.callerName ?? "Jessica Harper";
  /* `callDetail.callId` and the CI report's first call id — the same two calls the Call
     Detail and Conversation Intelligence screens open, so an SE clicking a record here is
     looking at a call the rest of the demo already knows about. */
  const ids = [
    profile.reports.callDetail?.callId,
    profile.reports.conversationIntelligence?.calls?.[0]?.id,
  ].filter(Boolean) as string[];
  const recents = [
    { icon: "contact", label: caller },
    { icon: "lead", label: caller },
    ...ids.map((id) => ({ icon: "call" as const, label: `INVOCA-${id.replace(/\W/g, "").slice(0, 8)}` })),
  ].slice(0, 5);

  return (
    <div className="sfh-root">
      {/* Global header. The search field is decorative here — the flow uses the Calendar
          tab, and a Salesforce global search we cannot answer would be a dead end. */}
      <div className="sfh-globalhead">
        <span className="sfh-cloud" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="34" height="34">
            <path fill="#00A1E0" d="M10 6a4 4 0 0 1 3.5 2.1A3.4 3.4 0 0 1 19 11a3 3 0 0 1-.6 5.9H7.5A4.5 4.5 0 0 1 6.6 8 4 4 0 0 1 10 6z" />
          </svg>
        </span>
        <div className="sfh-search"><span className="material-icons">search</span>Search...</div>
        <div className="sfh-globalicons">
          {["star", "add", "cloud", "help", "settings", "notifications"].map((i) => (
            <span className="material-icons" key={i}>{i === "star" ? "star" : i}</span>
          ))}
          <span className="sfh-avatar" />
        </div>
      </div>

      {/* App nav. */}
      <nav className="sfh-nav">
        <span className="material-icons sfh-waffle">apps</span>
        <span className="sfh-app">Sales</span>
        <ul className="sfh-tabs">
          {TABS.map((t) => (
            <li className={"sfh-tab" + (t === "Home" ? " sfh-tab--on" : "")} key={t}>
              {/* ⚠️ EVERY TAB IS INERT UNTIL ITS SCREEN EXISTS, Calendar included. Calendar
                  is the next step in this flow and there is no `*` catch-all in the router,
                  so linking it before screen 2 lands would put a BLANK page mid-demo behind
                  a tab that looks live. Flip it to a Link to /salesforce/calendar in the
                  same commit that adds the screen. */}
              <span className="sfh-tab-link">{t}</span>
              {NO_CHEVRON.has(t) ? null : <span className="material-icons sfh-chev">expand_more</span>}
            </li>
          ))}
        </ul>
        <span className="material-icons sfh-pencil">edit</span>
      </nav>

      <div className="sfh-page">
        <div className="sfh-banner">
          <h1 className="sfh-h1">Seller Home</h1>
          <p className="sfh-greet">Good afternoon. Let&rsquo;s get selling!</p>
        </div>

        <div className="sfh-grid">
          <Card title="Close Deals" subtitle="Opportunities owned by me and closing this quarter"
            action={<Btn>View Opportunities</Btn>}>
            <Ring value="$0" label="Total Pipeline" />
            <Legend rows={[
              { tone: "open", text: "$0 Open" },
              { tone: "won", text: "$0 Won" },
              { tone: "lost", text: "$0 Lost" },
            ]} />
          </Card>

          <Card title="Plan My Accounts" subtitle="Accounts owned by me"
            action={<Btn>View Accounts</Btn>}>
            <Ring value="5" label="Accounts" tone="lost" />
            <Legend rows={[
              { tone: "open", text: "0 Upcoming Activity" },
              { tone: "won", text: "0 Past Activity" },
              { tone: "lost", text: "5 No Activity" },
            ]} />
          </Card>

          <Card title="Grow Relationships" subtitle="Contacts owned by me and created in the last 90 days"
            action={<Btn>View Contacts</Btn>}>
            <Ring value="0" label="Contacts" />
            <Legend rows={[
              { tone: "open", text: "0 Upcoming Activity" },
              { tone: "won", text: "0 Past Activity" },
              { tone: "lost", text: "0 No Activity" },
            ]} />
          </Card>

          <Card title="Build Pipeline" subtitle="Leads owned by me and created in the last 30 days"
            action={<Btn>View Leads</Btn>}>
            <Ring value="0" label="Leads" />
            {/* The capture shows a lone grey dot and a warning triangle here, not a legend. */}
            <div className="sfh-warn">
              <span className="sfh-dot sfh-dot--none" />
              <span className="material-icons sfh-warn-icon">warning</span>
            </div>
          </Card>

          <Card title="My Goals" subtitle="Set personal weekly or monthly goals for emails, calls, and meetings."
            action={<span className="sfh-btn sfh-btn--brand">Set goals</span>}>
            <div className="sfh-goals" aria-hidden="true">
              <span className="sfh-goal-c">+</span>
              <span className="sfh-goal-c">&#10003;</span>
              <span className="sfh-goal-c sfh-goal-c--on">&#9733;</span>
              <span className="sfh-goal-c" />
            </div>
          </Card>

          <Card title="Today's Events" action={<Btn>View Calendar</Btn>}>
            <p className="sfh-empty">Looks like you&rsquo;re free and clear the rest of the day.</p>
          </Card>

          <Card title="Today's Tasks" action={<Btn>View All</Btn>}>
            <p className="sfh-empty">Nothing due today. Be a go-getter, and check back soon.</p>
          </Card>

          <Card title="Recent Records" action={<Btn>View All</Btn>}>
            <ul className="sfh-recents">
              {recents.map((r, i) => (
                <li className="sfh-recent" key={r.label + i}>
                  <span className={"sfh-rec-icon sfh-rec-icon--" + r.icon}>
                    <span className="material-icons">
                      {r.icon === "call" ? "call" : r.icon === "lead" ? "badge" : "workspace_premium"}
                    </span>
                  </span>
                  <span className="sfh-rec-label">{r.label}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
