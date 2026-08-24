import { useProfile } from "../data/ProfileContext";
import { SldsIcon } from "../components/SldsIcon";
import { SfGlobalHeader, SfContextBar, SfTodoBar } from "../components/SalesforceChrome";

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

/* ⚠️ CORRECTIONS 3 AND 4 (the full-width strip, and the active tab being a pale blue WASH
   rather than an underline) now live in `SalesforceChrome.tsx`, shared with the Calendar
   screen so the two cannot drift. */


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
function Card({ title, subtitle, action, tall, control, children }: {
  title: string; subtitle?: string; action?: React.ReactNode; tall?: boolean;
  /* ⚠️ THE TOP-RIGHT CONTROL IS A BORDERED 32px BUTTON, measured at x=393.3 y=13 with
     `1px solid #747474`. It is ROUND on My Goals (`border-radius: 240px`) and SQUARE on
     Today's Tasks (radius 4) — two different SLDS button variants, and drawing either as a
     bare glyph is what made the first two passes read as not-Salesforce. */
  control?: { icon: string; round?: boolean };
  children: React.ReactNode;
}) {
  return (
    <article className={"sfh-card" + (tall ? " sfh-card--tall" : "")}>
      <div className="sfh-card-head">
        <h2 className="sfh-card-title">{title}</h2>
        {control ? (
          <span className={"sfh-iconbtn" + (control.round ? " sfh-iconbtn--round" : "")}>
            <SldsIcon name={control.icon} size={14} />
          </span>
        ) : null}
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
      <SfGlobalHeader />

      <SfContextBar active="Home" />

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

          {/* ⚠️ THE FOUR GOAL CIRCLES ARE ONE ILLUSTRATION, 127 x 126, not four DOM circles.
              The first two passes hand-built them out of spans, which is why their size,
              overlap and the avatar glyph were all wrong. Extracted verbatim.
              ⚠️ AND "Set goals" IS A PILL INSIDE THE BODY (90.3 x 32, radius 240,
              centred at y=343.5), NOT a full-width footer button — this card has no
              `.slds-card__footer` at all. */}
          <Card title="My Goals"
            subtitle="Set personal weekly or monthly goals for emails, calls, and meetings."
            tall control={{ icon: "settings", round: true }}>
            <div className="sfh-goalwrap">
              <img className="sfh-goalart" src="/icons/salesforce/goals-rings.svg" alt=""
                width={127} height={126} />
              <span className="sfh-pillbtn">Set goals</span>
            </div>
          </Card>

          {/* ⚠️ THE EMPTY STATES CARRY SLDS ILLUSTRATIONS — 257x108 and 256x90, both
              extracted verbatim. Leaving them out is why these two tiles looked bare. */}
          <Card title="Today's Events" tall action={<Btn>View Calendar</Btn>}>
            <div className="sfh-illus">
              <img src="/icons/salesforce/illus-events.svg" alt="" width={257} height={108} />
              <p className="sfh-empty">Looks like you&rsquo;re free and clear the rest of the day.</p>
            </div>
          </Card>

          <Card title="Today's Tasks" tall control={{ icon: "chevrondown" }}
            action={<Btn>View All</Btn>}>
            <div className="sfh-illus">
              <img src="/icons/salesforce/illus-tasks.svg" alt="" width={256} height={90} />
              <p className="sfh-empty">Nothing due today. Be a go-getter, and check back soon.</p>
            </div>
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

      <SfTodoBar />
    </div>
  );
}
