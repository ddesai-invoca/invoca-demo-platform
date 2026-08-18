import { useNavigate } from "react-router-dom";

/* =============================================================================
   InsightsAddTile — what "+ Add Tile" opens on an Insights & Analytics dashboard.
   -----------------------------------------------------------------------------
   Measured off the LIVE authenticated page (8/18/2026), /networks/2160/insights,
   not from a screenshot:

     content surface  #fff, NO radius, fills the shell's content area
     h1 "Add Tile"    24px / 400 / #15243e
     section label    20px / 400 / #15243e
     grid             2 columns, 16px gap
     card             484 x 144, white, 2px solid #e7e9eb, radius 3, NO shadow,
                      cursor pointer; inner flex, gap 12, padding 24
     icon             40 x 40 at (26, 26) inside the card
     card title       16px / 700 / #15243e
     card description 16px / 400 / #15243e
     "Back"           text button, ink #2666f9, 14px/500, pad 8/12, radius 3
     font             Lato (Invoca's own, as everywhere outside the ThoughtSpot embed)

   TWO THINGS THE SCREENSHOT GETS WRONG, both verified by computed style:

     • "CUSTOM" and "TEMPLATES" are NOT small uppercase labels. They compute to
       20px/400 with `text-transform: none` — the words are simply typed in capitals.
       Styling them as letter-spaced 12px eyebrows, which is what they look like,
       would be visibly wrong next to the real thing.
     • The card description is NOT grey. It computes to #15243e, the same ink as the
       title; only the weight differs. It reads grey because it sits at 400 next
       to a 700 title.

   The real icons are 40x40 <img> assets. Those are Invoca's artwork and are not
   ours to copy, so each card uses a Material Icon chosen to match the shape and
   colour of the original. That is the one deliberate divergence on this screen.
   ============================================================================= */

interface Tile { title: string; desc: string; icon: string; tone: string }

/* Copy is verbatim from the live page, em dashes included. The house rule against
   dashes covers GENERATED demo prose, not replicated product chrome: changing
   Invoca's own wording would make the replica wrong. */
const CUSTOM: Tile[] = [
  { title: "Build With AI", icon: "auto_awesome", tone: "#7b5ea7",
    desc: "Explore your data without a visualization in mind. Describe your question and AI builds the chart." },
  { title: "Custom Tile", icon: "bar_chart", tone: "#2666f9",
    desc: "Build exactly what you need — choose your own data, layout, and visual style with no preset constraints." },
];

const TEMPLATES: Tile[] = [
  { title: "Single Line Chart Over Time", icon: "show_chart", tone: "#2666f9",
    desc: "Track how a single measure changes across a time period to quickly spot trends, dips, or growth at a glance." },
  { title: "Multi-Line Chart Over Time", icon: "multiline_chart", tone: "#2666f9",
    desc: "Analyze how different measures change over time to reveal patterns and their relationships." },
  { title: "Pie Chart", icon: "pie_chart", tone: "#0aa06e",
    desc: "Understand how parts contribute to the whole, simplifying proportions and distribution." },
  { title: "Stacked Bar", icon: "stacked_bar_chart", tone: "#2666f9",
    desc: "Compare totals by category and see the breakdown of each segment—great for identifying size and composition." },
  { title: "Dual Y-Axis", icon: "insert_chart", tone: "#0aa06e",
    desc: "Compares two data scales (like revenue and percentage) on one chart with left and right vertical axes." },
  { title: "Geo Heatmap", icon: "public", tone: "#e4126f",
    desc: "Map data by location to quickly identify regional concentrations, hotspots, or gaps." },
  { title: "KPI", icon: "trending_up", tone: "#2666f9",
    desc: "Show a key performance indicator with its trend over time to quickly assess if you're on track, ahead, or behind." },
  { title: "Metric", icon: "looks_one", tone: "#0aa06e",
    desc: "Show a single, key number for a quick glance at what matters most." },
  { title: "Calls by Hour", icon: "schedule", tone: "#2666f9",
    desc: "Shows call volume by hour so you can spot your busiest and slowest times at a glance." },
  { title: "Calls by Day of Week", icon: "date_range", tone: "#0aa06e",
    desc: "Analyze how calls are distributed across the week, broken down day by day." },
  { title: "Details Report", icon: "list_alt", tone: "#5b6577",
    desc: "Offers a granular, row-level view of raw data for a look at the individual records behind your numbers." },
  { title: "Summary Report", icon: "summarize", tone: "#5b6577",
    desc: "Get a condensed, aggregated view of your data in a table that highlights the most important figure." },
  { title: "Transactions Report", icon: "receipt_long", tone: "#5b6577",
    desc: "Offers a granular view of transaction data to look at individual events." },
];

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
      <span className="material-icons iat-icon" style={{ color: t.tone }}>{t.icon}</span>
      <span className="iat-card-text">
        <span className="iat-card-title">{t.title}</span>
        <span className="iat-card-desc">{t.desc}</span>
      </span>
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
