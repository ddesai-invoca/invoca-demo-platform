import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";

/* Signal → Manage Signals → a rule signal → Edit Rule Signal.
   `/signal/rule` (the real one is /manage_signals/rule_signal/edit/<id>), matched to the
   captures "Edit Rule Signal" (one condition) and "Edit Rule Signal 2" (four conditions plus
   the advanced section), both 8/6/2026.

   MEASURED — this page is Invoca's own MUI markup and serialises in full:
     left rail   -> "Click conditions below to build a rule", a terminal search, then three
                    groups whose headings are 16px/20px bold over a divider
     terminal    -> `border: 2px solid rgb(38,102,249)` — the blue-outlined pills
     canvas      -> chips 16px radius, each followed by a white value box (1px #d0d3d8,
                    4px radius, 4px 8px) and an "and/or" select 70px wide
     footer      -> Back on the left, Cancel + Save on the right

   THE SIGNAL NAME comes from the row that was clicked (?name=), so opening "Consultation
   Booked (Conversion)" on Shady Blinds shows that name rather than the capture's
   "Appointment Booked (Conversion)". Everything else on the page is Invoca's own rule-builder
   vocabulary — the 31 terminals are platform features, identical in every account, and are
   NOT re-skinned. */

interface TerminalGroup { title: string; items: string[] }

/* All 31 terminals, verbatim and in the capture's order. */
const TERMINALS: TerminalGroup[] = [
  {
    title: "Call Details",
    items: [
      "Duration", "Connect Duration", "Phone Type", "SMS Sent", "During Hours",
      "Repeat Caller", "Spoken Phrases", "End of Call Reason", "Agent Handle Time",
      "Agent Talk Percent", "Caller Talk Percent", "Overtalk Time", "Silence Percent",
      "Longest Agent Monologue Time", "Sentiment", "Interaction Type", "Missed Opportunity",
      "Answered By Agent", "Not Answered By Agent", "Answered By Voicemail", "Voicemail Left",
    ],
  },
  {
    title: "Reported Data",
    items: ["Signal", "Previous Signal", "RingPool Parameter", "Marketing Data", "Adwords Data"],
  },
  {
    title: "Invoca Platform Details",
    items: [
      "Advertiser Name", "Affiliate Name", "Campaign Name",
      "Promo Number Media Type", "Promo Number Description",
    ],
  },
];

interface Condition {
  id: number;
  terminal: string;
  /* The white box beside the chip. It is rendered ONLY when the condition has a value —
     in the capture just Spoken Phrases does, and the other three chips sit alone with the
     next "and" straight after them. Rendering an empty box for every condition also made
     the row wrap a condition early. */
  value?: string;
  /* The join to the PREVIOUS condition. The first condition has none. */
  join?: "and" | "or";
}

let nextId = 100;

export function EditRuleSignal() {
  const navigate = useNavigate();
  const { profile } = useProfile();
  const [params] = useSearchParams();
  const name = params.get("name") || `${profile.bookingTerm} Booked (Conversion)`;

  const [signalName, setSignalName] = useState(name);
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"Builder" | "Text">("Builder");
  const [search, setSearch] = useState("");
  /* Opens on the capture's own starting state: one Spoken Phrases condition. */
  const [conditions, setConditions] = useState<Condition[]>([
    { id: 1, terminal: "Spoken Phrases", value: "1054 phrases any time after IVR ..." },
  ]);
  const [revenue, setRevenue] = useState("");
  const [tag, setTag] = useState("Conversion");
  const [syndicate, setSyndicate] = useState(false);

  /* CLICKING A TERMINAL APPENDS A CONDITION, which is the whole point of the left rail —
     the user asked for "as signals are added from the left side to the middle". Everything
     after the first gets an "and" join, which the real builder defaults to and which can then
     be switched to "or". */
  const addTerminal = (t: string) =>
    setConditions((c) => [...c, { id: nextId++, terminal: t, join: "and" }]);

  const removeAt = (id: number) =>
    setConditions((c) => {
      const out = c.filter((x) => x.id !== id);
      /* The first condition must never keep a join — deleting the head would otherwise leave
         a dangling "and" in front of the rule. */
      if (out[0]) out[0] = { ...out[0], join: undefined };
      return out;
    });

  const setJoin = (id: number, join: "and" | "or") =>
    setConditions((c) => c.map((x) => (x.id === id ? { ...x, join } : x)));

  const q = search.trim().toLowerCase();
  const groups = q
    ? TERMINALS.map((g) => ({ ...g, items: g.items.filter((i) => i.toLowerCase().includes(q)) }))
      .filter((g) => g.items.length)
    : TERMINALS;

  /* The TEXT view renders the same rule as a sentence, which is what the toggle is for. */
  const asText = conditions
    .map((c, i) => `${i ? ` ${c.join ?? "and"} ` : ""}${c.terminal}${c.value ? ` (${c.value})` : ""}`)
    .join("");

  return (
    <div className="ers-page">
      <div className="ers-head">
        <h1 className="ers-title">Edit Rule Signal</h1>
      </div>

      <div className="ers-body">
        <label className="ers-label" htmlFor="ers-name">Rule Signal Name</label>
        <input id="ers-name" className="ers-input" value={signalName}
          onChange={(e) => setSignalName(e.target.value)} />

        <label className="ers-label" htmlFor="ers-desc">Description</label>
        <textarea id="ers-desc" className="ers-textarea" value={description}
          placeholder="Optional: Enter a description for this Signal"
          onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="ers-builder">
        <aside className="ers-rail">
          <p className="ers-rail-lede">Click conditions below to build a rule</p>
          <input className="ers-input ers-search" value={search} placeholder="Search terminals..."
            aria-label="Search terminals" onChange={(e) => setSearch(e.target.value)} />
          {groups.map((g) => (
            <div className="ers-group" key={g.title}>
              <span className="ers-group-title">{g.title}</span>
              <hr className="ers-group-rule" />
              <ul className="ers-terminals">
                {g.items.map((t) => (
                  <li key={t}>
                    <button type="button" className="ers-terminal" onClick={() => addTerminal(t)}>
                      {t}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {!groups.length && <p className="ers-empty">No terminals match &ldquo;{search}&rdquo;.</p>}
        </aside>

        <section className="ers-canvas-wrap">
          <div className="ers-toggle" role="group" aria-label="Rule view">
            {(["Builder", "Text"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m}
                className={`ers-toggle-btn${mode === m ? " ers-toggle-on" : ""}`}
                onClick={() => setMode(m)}>{m.toUpperCase()}</button>
            ))}
          </div>

          {mode === "Builder" ? (
            <div className="ers-canvas">
              {conditions.map((c, i) => (
                <div className="ers-expr" key={c.id}>
                  {i > 0 && (
                    <select className="ers-join" value={c.join ?? "and"}
                      aria-label="Join" onChange={(e) => setJoin(c.id, e.target.value as "and" | "or")}>
                      <option value="and">and</option>
                      <option value="or">or</option>
                    </select>
                  )}
                  <span className="ers-chip">
                    {c.terminal}
                    <button type="button" className="ers-chip-x" aria-label={`Remove ${c.terminal}`}
                      onClick={() => removeAt(c.id)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                      </svg>
                    </button>
                  </span>
                  {c.value && <span className="ers-value">{c.value}</span>}
                </div>
              ))}
              {!conditions.length && (
                <p className="ers-empty">Click a condition on the left to start the rule.</p>
              )}
            </div>
          ) : (
            <div className="ers-canvas ers-canvas-text">
              <code>{asText || "No conditions yet."}</code>
            </div>
          )}
        </section>
      </div>

      <div className="ers-body">
        <label className="ers-label" htmlFor="ers-apply">Apply this to</label>
        <select id="ers-apply" className="ers-select ers-select-sm" defaultValue="All Campaigns">
          <option>All Campaigns</option>
          <option>Selected Campaigns</option>
        </select>

        <h2 className="ers-advanced">ADVANCED OPTIONS</h2>

        <label className="ers-label" htmlFor="ers-rev">
          Auto Applied Revenue <span className="material-icons ers-info">info</span>
        </label>
        <div className="ers-money">
          <span>$</span>
          <input id="ers-rev" value={revenue} placeholder="Ex. 100.00"
            onChange={(e) => setRevenue(e.target.value)} />
        </div>

        <label className="ers-label" htmlFor="ers-tag">
          Tag this Signal <span className="material-icons ers-info">info</span>
        </label>
        <select id="ers-tag" className="ers-select ers-select-sm" value={tag}
          onChange={(e) => setTag(e.target.value)}>
          <option>Conversion</option>
          <option>Qualification</option>
          <option>Quality</option>
          <option>None</option>
        </select>

        <h3 className="ers-sub">Syndication</h3>
        <label className="ers-check">
          <input type="checkbox" checked={syndicate} onChange={(e) => setSyndicate(e.target.checked)} />
          Allow this signal to be shared across accounts.
        </label>

        <label className="ers-label" htmlFor="ers-std">
          Standard Data Field Name (For Invoca Employees Only)
        </label>
        <select id="ers-std" className="ers-select ers-select-sm" defaultValue="">
          <option value="">Select a standard data field</option>
        </select>

        <a className="ers-docs" href="#docs" onClick={(e) => e.preventDefault()}>
          View documentation on Signal rules
        </a>
      </div>

      <div className="ers-foot">
        <button className="ers-back" type="button" onClick={() => navigate("/signal")}>Back</button>
        <div className="ers-foot-right">
          <button className="ers-cancel" type="button" onClick={() => navigate("/signal")}>Cancel</button>
          <button className="ers-save" type="button" onClick={() => navigate("/signal")}>Save</button>
        </div>
      </div>
    </div>
  );
}
