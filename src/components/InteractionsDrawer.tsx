import { useEffect } from "react";
import type { Interaction, InteractionKind } from "../data/interactions";

/* The right-hand "interaction details" drawer, opened by clicking a bar, a trend
   dot or a donut slice on a saved Insights dashboard.

   MEASURED, not eyeballed. Unlike the dashboard tiles themselves (ThoughtSpot
   builds those at runtime, so the SingleFile capture has no DOM to measure), this
   drawer is Invoca's own MUI markup and serialises in full. Everything below comes
   off the capture "Insights & Analytics drawer｜ Invoca for Healthcare 2.0
   (8_5_2026 11:53:49 PM)": an 800px right-anchored paper with 24px padding over a
   50%-black backdrop, a 225ms cubic-bezier(0,0,.2,1) slide, a two-line header in
   #5b6577, and a 12px-gap column of 184px-tall cards bordered #e7e9eb at radius 8. */

/* Type badges. CALL and SMS are the exact fills and Material paths from the
   capture (blue-90 #122aa6 with the phone glyph, #89005f with the chat glyph).
   LEAD does not appear in the capture — that drawer was opened on a call metric —
   so its green is read off the user's screenshot and matched to the nearest real
   token, green-70 #129922. Change it if a capture ever shows otherwise. */
const KINDS: Record<InteractionKind, { label: string; fill: string; path: string }> = {
  call: {
    label: "Call", fill: "#122aa6",
    path: "M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99",
  },
  sms: {
    label: "SMS", fill: "#89005f",
    path: "M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m-2 12H6v-2h12zm0-3H6V9h12zm0-3H6V6h12z",
  },
  lead: {
    label: "Lead", fill: "#129922",
    path: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m-5 14H7v-2h7zm3-4H7v-2h10zm0-4H7V7h10z",
  },
};

const CLOCK =
  "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8";
const CLOCK_HAND = "M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z";

export interface DrawerRequest {
  /* The TILE's name, which is what the real header shows — the capture reads
     "Conversations/Metrics Over Time", not the metric. */
  title: string;
  /* WHICH number was clicked: the series and bucket for a bar, the slice for a
     donut. The real drawer drops this (the user already knows what they clicked),
     but on a demo screen shown to a room it is worth stating plainly. */
  metric: string;
  count: number;
  date: string;
}

export function InteractionsDrawer({ req, items, onClose }: {
  req: DrawerRequest; items: Interaction[]; onClose: () => void;
}) {
  /* Escape closes it, which the MUI drawer does for free and a hand-built one does
     not. Without this the only way out is the X or the backdrop. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="idr-root" role="presentation">
      <div className="idr-backdrop" onClick={onClose} />
      <aside className="idr-panel" role="dialog" aria-modal="true" aria-label={req.title}>
        <div className="idr-head">
          <div className="idr-headtext">
            <span className="idr-title">{req.title}</span>
            <span className="idr-count">{req.count.toLocaleString("en-US")} interactions</span>
            <span className="idr-metric">{req.metric}</span>
          </div>
          <button className="idr-close" type="button" aria-label="close drawer" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="idr-list">
          {items.map((it) => {
            const k = KINDS[it.kind];
            return (
              <article className="idr-card" key={it.id}>
                <div className="idr-card-head">
                  <div className="idr-kind">
                    <span className="idr-badge" style={{ background: k.fill }}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={k.path} /></svg>
                    </span>
                    <span className="idr-kind-label">{k.label}</span>
                  </div>
                  <span className="idr-date">{it.date}</span>
                </div>
                <span className="idr-id">{it.id}</span>
                <div className="idr-summary">
                  <span>{it.summary ?? "No AI Summary available."}</span>
                </div>
                <div className="idr-dur">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={CLOCK} /><path d={CLOCK_HAND} />
                  </svg>
                  <span>{it.duration}</span>
                </div>
              </article>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
