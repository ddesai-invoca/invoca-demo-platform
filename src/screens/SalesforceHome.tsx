import { useProfile } from "../data/ProfileContext";
import { SldsIcon } from "../components/SldsIcon";

/* =============================================================================
   Salesforce — Seller Home. Screen 1 of the Sales Cloud flow.
   -----------------------------------------------------------------------------
   Reached from the **Sales Cloud** tile on Integrations. Real URL
   `lightning.force.com/lightning/page/home`. REBUILT 8/24/2026 after the first pass was
   reported wrong on six counts; everything below is measured off the capture's rendered DOM
   rather than inferred, and each correction is called out where it lives.

     face          the SYSTEM stack (`-apple-system, system-ui, "Segoe UI", Roboto, …`),
                     13px base, ink #181818 — Lightning embeds no webfont here
     global header 50 tall
     context bar   40 tall, white, 3px #0070D2 bottom rule, padding-left 24
     nav item      37 tall, link 13/19.5 #181818, padding 0 12
     page          #F3F3F3
     h1            "Seller Home" 300 28px/49px #181818
     card          457.7 wide, 333 tall (row 1), white, radius 4, 1px #C9C9C9,
                     shadow `0 2px 2px rgba(0,0,0,.1)`
       header      32 tall, padding 12px 16px 0, then 12 of margin
       body        inset 12 either side, 230 tall on a row-1 card
       footer      57 tall, padding 12px 16px, border-top 1px #C9C9C9
       button      423.7 x 32, padding 0 16
     ring          150 x 150, circle r=72 stroke-width 6; value +48.8 from the ring top,
                     label +83.8
     legend        rows on a 42px pitch, 10px dot then the pill 12px later
   ============================================================================= */

/* ⚠️ CORRECTION 1 — THE ICONS ARE REAL SLDS GLYPHS, not Material ligatures. See
   `SldsIcon.tsx`: every path is serialised out of the capture, on SLDS's 520 grid. */

/* ⚠️ CORRECTION 2 — THE FACE IS THE SYSTEM STACK AND THE H1 IS 300 28px/49px. The first
   build had a 24px/400 h1 and let the platform's Lato leak in. The 49px line box on a 28px
   glyph is what gives the banner its 55px height and sits the greeting on its baseline. */

/* ⚠️ CORRECTION 3 — THE CONTEXT BAR SPANS THE FULL WIDTH. Measured: the bar is the viewport
   width and `.navCenter` inside it is `flex: 1 1 0%`, so the tab strip fills everything
   between the app name and the pencil. The first build let the strip size to its content. */

/* ⚠️ CORRECTION 4 — THE ACTIVE TAB IS A PALE BLUE WASH, NOT AN UNDERLINE.
   `slds-is-active` computes to `background: rgba(0,112,210,.1)` with NO bottom border, and
   its label stays #181818 at weight 400. The first build drew a 3px brand underline and
   turned the label blue and bold, which is a different product's tab entirely. */

const TABS = [
  "Home", "Opportunities", "Leads", "Tasks", "Files", "Accounts", "Contacts", "Campaigns",
  "Dashboards", "Reports", "Chatter", "Groups", "Calendar", "People", "Cases", "Forecasts",
];
/** Chatter and Forecasts carry no dropdown in the capture; everything else does. */
const NO_CHEVRON = new Set(["Chatter", "Forecasts"]);

type Tone = "open" | "won" | "lost" | "none";

/* ⚠️ CORRECTION 5 — THE RING IS ONE FULL CIRCLE, r=72 at stroke-width 6 inside a 150 box,
   with its value and label positioned from the ring's own top (+48.8 / +83.8) rather than
   centred by flexbox. Plan My Accounts' ring is the lost coral; the rest are the track. */
function Ring({ value, label, tone = "none" }: { value: string; label: string; tone?: Tone }) {
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

/* ⚠️ CORRECTION 6 — THE CARD IS THREE MEASURED BANDS, not one padded block: a 32px header
   (padding 12/16/0 plus 12 of margin), a body inset 12 either side, and a 57px footer behind
   a 1px rule. The first build used a single 16px padding and centred everything, which is
   why the spacing read wrong on every tile. */
function Card({ title, subtitle, action, tall, children }: {
  title: string; subtitle?: string; action?: React.ReactNode; tall?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className={"sfh-card" + (tall ? " sfh-card--tall" : "")}>
      <div className="sfh-card-head">
        <h2 className="sfh-card-title">{title}</h2>
      </div>
      <div className="sfh-card-body">
        {subtitle ? <p className="sfh-card-sub">{subtitle}</p> : null}
        <div className="sfh-card-content">{children}</div>
      </div>
      {action ? <div className="sfh-card-foot">{action}</div> : null}
    </article>
  );
}

/* Inert: the capture's buttons open Salesforce list views, which are not in this flow. */
const Btn = ({ children }: { children: React.ReactNode }) => (
  <span className="sfh-btn">{children}</span>
);

export function SalesforceHome() {
  const { profile } = useProfile();

  /* Recent Records is the one data-bearing tile, and it is the prospect's own — the capture's
     rows name a real person in that org. The object kinds and their tile colours ARE the
     capture's: Opportunity #FF5D2D, Contact #9602C7, custom Invoca Call Log #8b85f9. */
  const caller = profile.reports.voiceScreenpop?.callerName ?? "Jessica Harper";
  const ids = [
    profile.reports.callDetail?.callId,
    profile.reports.conversationIntelligence?.calls?.[0]?.id,
    profile.reports.conversationIntelligence?.calls?.[1]?.id,
  ].filter(Boolean) as string[];
  const recents = [
    { kind: "opportunity" as const, label: caller },
    { kind: "contact" as const, label: caller },
    ...ids.map((id) => ({ kind: "call" as const,
      label: `INVOCA-${id.replace(/\W/g, "").slice(0, 8).toUpperCase()}` })),
  ].slice(0, 5);

  return (
    <div className="sfh-root">
      <header className="sfh-globalhead">
        {/* The Salesforce cloud mark. The capture's own logo `<img>` carries NO src (it
            serialised as `class="icon noicon"`), so this is drawn to shape — the one mark on
            this screen that is not verbatim. */}
        <span className="sfh-logo" aria-label="Salesforce">
          <svg viewBox="0 0 60 42" width="36" height="26" aria-hidden="true">
            <path fill="#00A1E0" d="M25 9a11 11 0 0118 3 13 13 0 0117 12 12 12 0 01-12 12H20A11 11 0 018 25a11 11 0 016-10 13 13 0 0111-6z" />
          </svg>
        </span>

        <div className="sfh-search">
          <SldsIcon name="search" size={14} className="sfh-search-icon" />
          <span className="sfh-search-ph">Search...</span>
        </div>

        <div className="sfh-globalicons">
          <span className="sfh-gi sfh-gi--star">&#9733;</span>
          <span className="sfh-gi sfh-gi--tri"><SldsIcon name="triangledown" size={12} /></span>
          <span className="sfh-gi sfh-gi--add"><SldsIcon name="add" size={16} /></span>
          <span className="sfh-gi"><SldsIcon name="guidance" size={20} /></span>
          <span className="sfh-gi"><SldsIcon name="help" size={20} /></span>
          <span className="sfh-gi"><SldsIcon name="setup" size={20} /></span>
          <span className="sfh-gi"><SldsIcon name="notification" size={20} /></span>
          <span className="sfh-avatar" />
        </div>
      </header>

      <nav className="sfh-bar">
        <span className="sfh-waffle" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => <i key={i} />)}
        </span>
        <span className="sfh-app">Sales</span>
        {/* flex: 1 — this is what makes the strip span the bar. */}
        <ul className="sfh-tabs">
          {TABS.map((t) => (
            <li className={"sfh-tab" + (t === "Home" ? " sfh-tab--on" : "")} key={t}>
              {/* ⚠️ EVERY TAB IS INERT UNTIL ITS SCREEN EXISTS, Calendar included — there is
                  no `*` catch-all in the router, so a link now would put a blank page
                  mid-demo behind a tab that looks live. */}
              <span className="sfh-tab-link">{t}</span>
              {NO_CHEVRON.has(t) ? null
                : <SldsIcon name="chevrondown" size={14} className="sfh-tab-chev" />}
            </li>
          ))}
        </ul>
        <span className="sfh-barpencil"><SldsIcon name="pencil" size={14} /></span>
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

          <Card title="Grow Relationships"
            subtitle="Contacts owned by me and created in the last 90 days"
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
            {/* The capture shows a lone grey dot and the amber warning glyph here, not a
                three-row legend. */}
            <div className="sfh-warnrow">
              <span className="sfh-dot sfh-dot--none" />
              <SldsIcon name="warning" size={24} className="sfh-warn-icon" />
            </div>
          </Card>

          <Card title="My Goals"
            subtitle="Set personal weekly or monthly goals for emails, calls, and meetings."
            tall action={<span className="sfh-btn sfh-btn--brand">Set goals</span>}>
            <span className="sfh-goalgear"><SldsIcon name="settings" size={14} /></span>
            <div className="sfh-goals" aria-hidden="true">
              <span className="sfh-goal-c"><SldsIcon name="add" size={14} /></span>
              <span className="sfh-goal-c">&#10003;</span>
              <span className="sfh-goal-c sfh-goal-c--on">&#9733;</span>
              <span className="sfh-goal-c" />
            </div>
          </Card>

          <Card title="Today's Events" tall action={<Btn>View Calendar</Btn>}>
            <p className="sfh-empty">Looks like you&rsquo;re free and clear the rest of the day.</p>
          </Card>

          <Card title="Today's Tasks" tall action={<Btn>View All</Btn>}>
            <p className="sfh-empty">Nothing due today. Be a go-getter, and check back soon.</p>
          </Card>

          <Card title="Recent Records" tall action={<Btn>View All</Btn>}>
            <ul className="sfh-recents">
              {recents.map((r, i) => (
                <li className="sfh-recent" key={r.label + i}>
                  <span className={"sfh-ent sfh-ent--" + r.kind}>
                    {r.kind === "call"
                      ? <SldsIcon name="call" size={20} className="sfh-ent-glyph" />
                      : <img src={`/icons/salesforce/${r.kind}.png`} alt="" width={32} height={32} />}
                  </span>
                  <span className="sfh-rec-label">{r.label}</span>
                </li>
              ))}
            </ul>
          </Card>
          {/* ⚠️ THE SALESBLAZER CARD IS PART OF THE PAGE and was missing from the first
              build. Its banner image is extracted verbatim (a webp data URI in the capture);
              the copy is Salesforce's own marketing text, not re-skinned, and both links are
              inert — they open salesforce.com in the real page. */}
          <article className="sfh-card sfh-card--sb">
            <div className="sfh-card-head"><h2 className="sfh-card-title">Salesblazer</h2></div>
            <div className="sfh-card-body">
              <img className="sfh-sb-img" src="/icons/salesforce/salesblazer.webp" alt=""
                width={423} height={100} />
              <p className="sfh-sb-head">
                How Salesforce Migrated 30,000+ Sellers to Spiff, a Single Comp Management Tool
                <SldsIcon name="newwindow" size={16} className="sfh-sb-ext" />
              </p>
              <p className="sfh-sb-body">
                A methodical, six-step approach with broad buy-in and phased rollout ensured
                success.
              </p>
              <p className="sfh-sb-read">9 minute read</p>
            </div>
            <div className="sfh-card-foot">
              <span className="sfh-btn">
                Join the Community
                <SldsIcon name="newwindow" size={16} className="sfh-sb-ext" />
              </span>
            </div>
          </article>
        </div>
      </div>

      <footer className="sfh-todo">
        <SldsIcon name="todo" size={14} className="sfh-todo-icon" />
        <span>To Do List</span>
      </footer>
    </div>
  );
}
