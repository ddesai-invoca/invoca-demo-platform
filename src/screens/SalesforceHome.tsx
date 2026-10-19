import { useMemo } from "react";
import { useProfile } from "../data/ProfileContext";
import { usePageData } from "../components/GeneratedTiles";
import { StandaloneAi } from "../components/StandaloneAi";
import { SldsIcon } from "../components/SldsIcon";
import { SfGlobalHeader, SfContextBar, SfTodoBar } from "../components/SalesforceChrome";
import { newestCallLogName } from "../data/salesforceCallLog";

/* =============================================================================
   Salesforce — Seller Home. Screen 1 of the Sales Cloud flow.
   -----------------------------------------------------------------------------
   Reached from the **Sales Cloud** tile on Integrations. REBUILT AGAIN 8/27/2026 against a
   NEWER capture, `reference/salesforce/seller-home-v2.html`
   (`invocafforhomeservices.lightning.force.com/lightning/page/home`), because Salesforce has
   restyled the whole page. Every number below is a computed style off that capture's rendered
   DOM, measured at BOTH 1500 and 1920.

   | | 8/24 capture | THIS capture |
   |---|---|---|
   | card | radius 4, 1px `#C9C9C9`, `0 2px 2px` shadow | **radius 20, no border, no shadow** |
   | card heights | 333 / 370.5 / 396.5 | **338 / 366.5 / 400** |
   | card title | `700 16/20` `#181818` | **`400 20px/25px` `#03234D`** |
   | subtitle | `13/16` `#181818` | `400 13/19.5` **`#5C5C5C`** |
   | footer button | full width, radius 4, `#0176D3` | **centred pill**, radius 240, **`#0250D9`**, 600 |
   | h1 | `300 28/49` `#181818` | **`300 32px/56px` `#03234D`** |
   | ring value | `300 28/33` | **`300 32px/40px`** |
   | legend pill | radius 4 | **radius 8** |
   | brand button | `#0176D3` | **`#066AFE`** |
   | cards | 8 | **9** (row 3 is Salesblazer alone) |

   ⚠️⚠️ **THE CARD BODY IS TWO 50% COLUMNS, EACH CENTRING ITS CONTENT — and only measuring at
   two widths shows it.** The ring starts 34px into the body at 1500 and 30px at 1920, and the
   legend's dot 63.65 and 60 into the right half; centring each in half the body gives
   (218.35-150)/2 = 34.2 and (210-150)/2 = 30, and the legend's (218.35-90.1)/2 = 64.1 and
   (210-90.1)/2 = 60. All four land. Fixed offsets reproduce one width and drift at the other.

   ⚠️ **PLAN MY ACCOUNTS' RING IS TWO FILLED ARCS, NOT A STROKE.** Measured `<path>` elements
   with outer r=75 and inner r=69 (a 6px band), filled `#0D9DDA` for the 1 past-activity
   account and `#FE5C4C` for the 3 with none — a quarter and three quarters of 4. A single
   full ring (Close Deals, Grow Relationships, Build Pipeline) really is a `<circle r=72>` with
   a 6px stroke, so both shapes are reproduced as the page draws them.

   ⚠️ **THE RECORD TILES ARE THE WHOLE IMAGE.** The box around each 32px glyph measures
   TRANSPARENT at radius 0 — the object colour is baked into the PNG. The older build painted
   a coloured tile behind it, which doubles the colour up.
   ⚠️ **THE LEAD GLYPH IS NOT IN THE CAPTURE**: its data URI is `<rect fill-opacity="0"/>`, the
   same empty placeholder the older capture had for the call-log icon. It is drawn here and
   flagged; everything else is the real artwork, extracted verbatim.
   ============================================================================= */

type Tone = "open" | "won" | "lost" | "none";
type Seg = { tone: Tone; n: number };

/* One ring. A single tone draws the real page's `<circle r=72>` with a 6px stroke; two or
   more draw filled arcs (outer r=75, inner r=69), which is exactly how Plan My Accounts is
   built in the capture. */
const TONE_HEX: Record<Tone, string> = {
  open: "#06A59A", won: "#0D9DDA", lost: "#FE5C4C", none: "#E5E5E5",
};

/** A donut segment as a filled path, in the capture's own geometry. */
function arc(from: number, to: number): string {
  const R = 75, r = 69, c = 75;
  const pt = (rad: number, a: number) => [c + rad * Math.sin(a), c - rad * Math.cos(a)];
  const big = to - from > Math.PI ? 1 : 0;
  const [x1, y1] = pt(R, from), [x2, y2] = pt(R, to);
  const [x3, y3] = pt(r, to), [x4, y4] = pt(r, from);
  return `M ${x1} ${y1} A ${R} ${R} 0 ${big} 1 ${x2} ${y2} L ${x3} ${y3} A ${r} ${r} 0 ${big} 0 ${x4} ${y4} Z`;
}

function Ring({ value, label, segments }: {
  value: string; label: string; segments?: { tone: Tone; n: number }[];
}) {
  const parts = (segments ?? []).filter((s) => s.n > 0);
  const total = parts.reduce((a, b) => a + b.n, 0);
  let at = 0;
  return (
    <div className="sfh-ring">
      {/* viewBox, so the ring scales when a narrow card shrinks it. */}
      <svg viewBox="0 0 150 150" aria-hidden="true">
        {parts.length > 1 ? parts.map((p) => {
          const from = at; at += (p.n / total) * Math.PI * 2;
          return <path key={p.tone} d={arc(from, at)} fill={TONE_HEX[p.tone]} />;
        }) : (
          <circle cx="75" cy="75" r="72" fill="none" strokeWidth="6"
            stroke={parts.length === 1 ? TONE_HEX[parts[0].tone] : "#E5E5E5"} />
        )}
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
function Card({ title, subtitle, action, tall, control, children, variant }: {
  title: string; subtitle?: string; action?: React.ReactNode; tall?: boolean;
  control?: { icon: string; round?: boolean }; children: React.ReactNode;
  /* Opt-in, off for every other card: My Goals is the one tile whose body has to fill the
     card so its pill can sit a measured 21px off the bottom. */
  variant?: "goals";
}) {
  return (
    <article className={"sfh-card" + (tall ? " sfh-card--tall" : "") + (variant ? " sfh-card--" + variant : "")}>
      <div className="sfh-card-head">
        <h2 className="sfh-card-title">{title}</h2>
        {control ? (
          <span className={"sfh-iconbtn" + (control.round ? " sfh-iconbtn--round" : "")}>
            <SldsIcon name={control.icon} size={16} />
          </span>
        ) : null}
      </div>
      <div className="sfh-card-body">
        {subtitle ? <p className="sfh-card-sub">{subtitle}</p> : null}
        {/* ⚠️ TWO 50% COLUMNS. A ring card puts the ring in the left half and the legend in
            the right, each centred in its own half — the rule that holds at both widths (see
            the header note). A card with one child simply fills the row. */}
        <div className="sfh-card-content">
          {Array.isArray(children) && children.length === 2
            ? (children as React.ReactNode[]).map((c, i) => (
                <div className="sfh-card-col" key={i}>{c}</div>
              ))
            : children}
        </div>
      </div>
      {action ? <div className="sfh-card-foot">{action}</div> : null}
    </article>
  );
}

/** The footer's centred pill: radius 240, 1px #5C5C5C, ink #0250D9, weight 600. */
function Btn({ children }: { children: React.ReactNode }) {
  return <span className="sfh-btn">{children}</span>;
}

export function SalesforceHome() {
  const { profile } = useProfile();

  /* ⚠️ RECENT RECORDS IS THE ONE DATA-BEARING TILE, and it stays the PROSPECT'S — the
     capture's own rows name real people in that org (Bethany Jorgensen, Bill Hyatt). The
     object MIX is the capture's: two Leads, an Invoca Call Log record, an Account and a
     Contact, which is also the mix that makes the Invoca integration the point of the page. */
  const caller = profile.reports.voiceScreenpop?.callerName ?? "Jessica Harper";
  const second = profile.reports.callDetail?.agent ?? "Bill Hyatt";
  /* ⚠️ THE CALL LOG RECORD NAME IS AN 8-DIGIT AUTO-NUMBER, and this used to build
     `INVOCA-<the Invoca call id>` -> "INVOCA-0597627F". Both captures say otherwise:
     this one's own row reads **INVOCA-00001888** and the Invoca Call Log list view's
     records are `INVOCA-00001889` and neighbours. So the two screens disagreed about
     one record's name in one org. It comes from `salesforceCallLog` now, which owns
     that object's numbering, and the row is genuinely the newest record in the list
     the Invoca Call Log tab shows. */
  const callLogName = newestCallLogName(profile);
  const recentsBase = [
    { kind: "lead" as const, file: "lead", label: caller },
    { kind: "lead" as const, file: "lead", label: second },
    { kind: "call" as const, file: "invoca-call-log", label: callLogName },
    { kind: "account" as const, file: "account", label: `${profile.customerName} ${profile.bookingTerm}` },
    { kind: "contact" as const, file: "contact", label: caller },
  ];
  /* ⚠️ EVERYTHING THIS PAGE SHOWS IS REGISTERED DATA (10/16/2026), the standing rule that Ask AI
     may change any data on any page. The org is empty in the capture ($0 pipeline, 0 contacts),
     and those values stay the defaults; an SE who wants a fuller pipeline asks for one. */
  const base = useMemo(() => ({
    title: "Seller Home",
    greeting: "Good evening, Bill. Let\u2019s get selling!",
    cards: [
      { title: "Close Deals", subtitle: "Opportunities owned by me and closing this quarter", action: "View Opportunities",
        value: "$0", label: "Total Pipeline", segments: [] as Seg[],
        legend: [{ tone: "open" as Tone, text: "$0 Open" }, { tone: "won" as Tone, text: "$0 Won" }, { tone: "lost" as Tone, text: "$0 Lost" }] },
      { title: "Plan My Accounts", subtitle: "Accounts owned by me", action: "View Accounts",
        value: "4", label: "Accounts", segments: [{ tone: "won" as Tone, n: 1 }, { tone: "lost" as Tone, n: 3 }],
        legend: [{ tone: "open" as Tone, text: "0 Upcoming Activity" }, { tone: "won" as Tone, text: "1 Past Activity" }, { tone: "lost" as Tone, text: "3 No Activity" }] },
      { title: "Grow Relationships", subtitle: "Contacts owned by me and created in the last 90 days", action: "View Contacts",
        value: "0", label: "Contacts", segments: [] as Seg[],
        legend: [{ tone: "open" as Tone, text: "0 Upcoming Activity" }, { tone: "won" as Tone, text: "0 Past Activity" }, { tone: "lost" as Tone, text: "0 No Activity" }] },
      { title: "Build Pipeline", subtitle: "Leads owned by me and created in the last 30 days", action: "View Leads",
        value: "5", label: "Leads", segments: [{ tone: "lost" as Tone, n: 5 }],
        legend: [{ tone: "open" as Tone, text: "0 Upcoming Activity" }, { tone: "won" as Tone, text: "0 Past Activity" }, { tone: "lost" as Tone, text: "5 No Activity" }] },
    ],
    recents: recentsBase,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [caller, second, callLogName, profile.customerName, profile.bookingTerm]);
  const d = usePageData(base);
  const recents = d.recents;

  return (
    <div className="sfh-root">
      <StandaloneAi />
      <SfGlobalHeader />

      <SfContextBar active="Home" />

      <div className="sfh-page">
        <div className="sfh-banner">
          <h1 className="sfh-h1">Seller Home</h1>
          {/* The greeting is a 13px span sharing the h1's own 56px line box, so it sits on
              the title's baseline rather than in a band of its own. */}
          <p className="sfh-greet">{d.greeting}</p>
        </div>

        <div className="sfh-grid">
          {/* The four ring cards are DATA now (10/16/2026), so Ask AI can change any figure,
              label or legend row. The capture's values are the defaults, in its order. */}
          {d.cards.map((c) => (
            <Card key={c.title} title={c.title} subtitle={c.subtitle} action={<Btn>{c.action}</Btn>}>
              <Ring value={c.value} label={c.label} segments={c.segments?.length ? c.segments : undefined} />
              <Legend rows={c.legend} />
            </Card>
          ))}

          {/* ⚠️ THE FOUR GOAL CIRCLES ARE ONE ILLUSTRATION, 127 x 126, not four DOM circles.
              The first two passes hand-built them out of spans, which is why their size,
              overlap and the avatar glyph were all wrong. Extracted verbatim.
              ⚠️ AND "Set goals" IS A PILL INSIDE THE BODY (90.3 x 32, radius 240), NOT a
              full-width footer button — this card has no `.slds-card__footer` at all. It is
              anchored 21px off the CARD's bottom, not placed by the flow above it: the art
              takes the slack, so a subtitle that wraps to a second line no longer pushes the
              pill out through the bottom edge. */}
          <Card title="My Goals"
            subtitle="Set personal weekly or monthly goals for emails, calls, and meetings."
            tall variant="goals" control={{ icon: "settings", round: true }}>
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
                    {/* ⚠️ EVERY ROW GETS A COLOURED CIRCLE — the glyph PNGs are white artwork
                        on transparent, and the object's colour is the tile behind them
                        (`.slds-media__figure`, radius 100%). Lead alone needs its glyph drawn,
                        because the capture ships an empty rect for it. */}
                    {r.kind === "lead"
                      ? <SldsIcon name="lead" size={20} className="sfh-ent-glyph" />
                      : <img src={`/icons/salesforce/${r.file}.png`} alt="" width={32} height={32} />}
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
