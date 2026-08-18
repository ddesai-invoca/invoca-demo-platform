import { useNavigate } from "react-router-dom";

/* =============================================================================
   InsightsAddTile — what "+ Add Tile" opens on an Insights & Analytics dashboard.
   -----------------------------------------------------------------------------
   Measured off the LIVE authenticated page (8/18/2026), /networks/2160/insights,
   not from a screenshot:

     content surface  #fff, NO radius, fills the shell's content area
     h1 "Add Tile"    24px / 400 / #15243e
     section label    20px / 400 / #15243e
     grid             repeat(auto-fill, minmax(320px, 1fr)), 16px gap — FLUID.
                      Measured at three widths: 983px available -> 2 columns,
                      1349 -> 4, 1769 -> 5. A fixed 2-column grid is wrong the
                      moment the window is anything but narrow.
     card             white, 2px solid #e7e9eb, radius 3, NO shadow, cursor pointer,
                      padding 24, flex COLUMN with a 12px gap. Height is content-
                      driven (144 narrow, 164 wide, as the description rewraps).
     icon             40 x 40 at (26, 26) inside the card
     card title       16px / 700 / #15243e
     card description 16px / 400 / #15243e
     "Back"           text button, ink #2666f9, 14px/500, pad 8/12, radius 3
     font             Lato (Invoca's own, as everywhere outside the ThoughtSpot embed)

   THREE THINGS A SCREENSHOT GETS WRONG, all verified by computed style. The third
   is the one that actually broke the first build of this screen, and the lesson is
   general: A SINGLE-WIDTH MEASUREMENT IS NOT A MEASUREMENT. Check a narrow and a
   wide viewport before believing any layout.

     • "CUSTOM" and "TEMPLATES" are NOT small uppercase labels. They compute to
       20px/400 with `text-transform: none` — the words are simply typed in capitals.
       Styling them as letter-spaced 12px eyebrows, which is what they look like,
       would be visibly wrong next to the real thing.
     • The card description is NOT grey. It computes to #15243e, the same ink as the
       title; only the weight differs. It reads grey because it sits at 400 next
       to a 700 title.

     • The card is a COLUMN, not an icon beside a stacked title and description.
       At one width the difference is a subtle indent; at 1920, where the columns
       narrow to 341px, the indent visibly eats the description. Its first child is
       a centred row of [icon, title]; the description is a separate child at the
       card's own left padding.

   THE ICONS ARE THE REAL ONES. They are 40x40 base64 SVGs embedded in the live page;
   they are Invoca's own artwork in Invoca's own internal tool, so they are extracted
   verbatim into public/icons/add-tile/ rather than approximated. Substituting Material
   Icons, as the first version did, was wrong: the real set has its own palette
   (#1643D5 #5185FA #2666F9 #7DA3FB #B0CDFF, #2CBF58, #33E5C9, #FFD800, axis #5B6577),
   only TEN unique files cover the fourteen cards, and Build With AI's sparkle is
   gradient-filled. None of that survives a lookalike.
   ============================================================================= */

/* `icon` is a file in public/icons/add-tile/, pulled from the live page. Several are
   SHARED, exactly as the real product shares them: one line icon across Single and
   Multi-Line, one clock icon across Calls by Hour and Day of Week, and one table icon
   across all three Reports. Giving each its own glyph, which is what I did first, is
   wrong in a way that is obvious side by side. */
interface Tile { title: string; desc: string; icon: string }

/* Copy is verbatim from the live page, em dashes included. The house rule against
   dashes covers GENERATED demo prose, not replicated product chrome: changing
   Invoca's own wording would make the replica wrong. */
const CUSTOM: Tile[] = [
  { title: "Build With AI", icon: "", 
    desc: "Explore your data without a visualization in mind. Describe your question and AI builds the chart." },
  { title: "Custom Tile", icon: "custom-tile",
    desc: "Build exactly what you need — choose your own data, layout, and visual style with no preset constraints." },
];

const TEMPLATES: Tile[] = [
  { title: "Single Line Chart Over Time", icon: "line",
    desc: "Track how a single measure changes across a time period to quickly spot trends, dips, or growth at a glance." },
  { title: "Multi-Line Chart Over Time", icon: "line",
    desc: "Analyze how different measures change over time to reveal patterns and their relationships." },
  { title: "Pie Chart", icon: "pie",
    desc: "Understand how parts contribute to the whole, simplifying proportions and distribution." },
  { title: "Stacked Bar", icon: "stacked-bar",
    desc: "Compare totals by category and see the breakdown of each segment—great for identifying size and composition." },
  { title: "Dual Y-Axis", icon: "dual-axis",
    desc: "Compares two data scales (like revenue and percentage) on one chart with left and right vertical axes." },
  { title: "Geo Heatmap", icon: "geo-heatmap",
    desc: "Map data by location to quickly identify regional concentrations, hotspots, or gaps." },
  { title: "KPI", icon: "kpi",
    desc: "Show a key performance indicator with its trend over time to quickly assess if you're on track, ahead, or behind." },
  { title: "Metric", icon: "metric",
    desc: "Show a single, key number for a quick glance at what matters most." },
  { title: "Calls by Hour", icon: "calls-by-time",
    desc: "Shows call volume by hour so you can spot your busiest and slowest times at a glance." },
  { title: "Calls by Day of Week", icon: "calls-by-time",
    desc: "Analyze how calls are distributed across the week, broken down day by day." },
  { title: "Details Report", icon: "report",
    desc: "Offers a granular, row-level view of raw data for a look at the individual records behind your numbers." },
  { title: "Summary Report", icon: "report",
    desc: "Get a condensed, aggregated view of your data in a table that highlights the most important figure." },
  { title: "Transactions Report", icon: "report",
    desc: "Offers a granular view of transaction data to look at individual events." },
];

/* BUILD WITH AI'S SPARKLE IS GRADIENT-FILLED, not a flat colour — the live page keeps
   a hidden <defs> holding a teal -> blue -> purple linearGradient and paints the icon
   with url(#...). The glyph itself is Material's auto_awesome, so only the fill was
   ever wrong. A flat purple looks plausible alone and clearly duller side by side. */
function AiSparkle() {
  return (
    <svg className="iat-icon" width={40} height={40} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="iat-ai" x1="1" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#66ebd7" />
          <stop offset="0.5" stopColor="#7da3fb" />
          <stop offset="1" stopColor="#a182e5" />
        </linearGradient>
      </defs>
      <path fill="url(#iat-ai)" d="m19 9 1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25z" />
    </svg>
  );
}

export function InsightsAddTile() {
  const navigate = useNavigate();
  /* Where "Back" and every card return to. The dashboard is the only place this
     screen is reachable from, so there is one destination. */
  const back = () => navigate("/insights/dashboard/Summary%20Dashboard");

  const Card = ({ t, accent }: { t: Tile; accent?: boolean }) => (
    <button className={"iat-card" + (accent ? " iat-card--ai" : "")} type="button"
      onClick={() => {
        /* Build With AI is real: it hands off to the Ask drawer we already have.
           The template cards are the visual picker only until each template is
           built, so they return to the dashboard rather than silently doing
           nothing under the cursor. */
        if (t.title === "Build With AI") navigate("/insights/dashboard/Summary%20Dashboard?ask=1");
        else back();
      }}>
      {/* THE CARD IS A COLUMN, not an icon beside a stacked title+description.
          Measured on the live page: the card is flex-column with a 12px gap; its
          first child is a centred ROW of [40px icon, title], and the description is
          the SECOND child at the card's own left padding, spanning the full width.
          Nesting the description beside the icon indents it under the title, which is
          what made this look wrong — most obviously on a wide window, where the
          columns narrow and the indent eats the text. */}
      <span className="iat-card-top">
        {t.icon
          ? <img className="iat-icon" src={`/icons/add-tile/${t.icon}.svg`} alt="" width={40} height={40} />
          : <AiSparkle />}
        <span className="iat-card-title">{t.title}</span>
      </span>
      <span className="iat-card-desc">{t.desc}</span>
    </button>
  );

  return (
    <div className="iat-page">
      <h1 className="iat-h1">Add Tile</h1>

      <p className="iat-section">CUSTOM</p>
      <div className="iat-grid">
        {CUSTOM.map((t) => <Card key={t.title} t={t} accent={t.title === "Build With AI"} />)}
      </div>

      <p className="iat-section">TEMPLATES</p>
      <div className="iat-grid">
        {TEMPLATES.map((t) => <Card key={t.title} t={t} />)}
      </div>

      <div className="iat-foot">
        <button className="iat-back" type="button" onClick={back}>Back</button>
      </div>
    </div>
  );
}
