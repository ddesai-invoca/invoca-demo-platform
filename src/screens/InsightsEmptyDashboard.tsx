import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { DashAssistant, usePageDataWithLabels } from "../components/GeneratedTiles";
import { useProfile } from "../data/ProfileContext";
import { useAiAssistant } from "../data/AiAssistantContext";
import { DASHBOARD_TEMPLATES, type DashboardTemplate } from "../data/dashboardTemplates";
import { DashboardConfigDrawer } from "../components/DashboardConfigDrawer";
import type { InsightsDashboard } from "../data/insightsDashboards";

/* =============================================================================
   A freshly created dashboard, before it has any tiles.
   -----------------------------------------------------------------------------
   Measured off the capture (8/23/2026):

     illustration   an SVG, 320 x 220 (viewBox 0 0 300 204)
     copy           "Use a template or add a tile to get started."
                      16/700 #15243E, centred
     Add Tile       #2666F9 on white, 14/500, padding 8px 12px, radius 3, 36 tall
     panel          #F5F6FA, 1px #E7E9EB, radius 8
     panel heading  "Dashboard Templates", 16/400 #15243E, UPPERCASED IN CSS,
                      padding 24px 0 24px 24px
     card           316 x 120, padding 24; title 16/700 with 12px under it;
                      body 16/400 #15243E

   ⚠️ THE HEADING IS SENTENCE CASE IN THE DOM AND UPPERCASE ON SCREEN. Its text content
   is "Dashboard Templates" with `text-transform: uppercase` — worth writing down because
   the obvious reading of the screenshot is a literal "DASHBOARD TEMPLATES" string, and
   that would break the moment anyone selects or searches the text.

   ⚠️ THE ILLUSTRATION IS INVOCA'S OWN, EXTRACTED VERBATIM to `public/insights-empty.svg`
   — 170 paths and gradients, per the standing "use the real icons" rule. It is referenced
   as an `<img>`, NOT inlined: at ~100KB it would otherwise land in the single bundle that
   every screen loads.

   ⚠️ ONE OF THE THREE TEMPLATE CARDS IS LIVE. "Lead Conversion Dashboard" opens the
   measured "Dashboard Configuration" drawer (`DashboardConfigDrawer` +
   `dashboardTemplates.ts`); the other two stay inert because their drawers have not been
   captured, and reusing Lead Conversion's five categories for an SMS dashboard would put
   invented labels in front of a prospect. What SAVE builds is still open for all three —
   saving on the live account would have written to a real customer's dashboard.
   ============================================================================= */

const LABELS = {
  emptyCopy: "Use a template or add a tile to get started.",
  templatesHeading: "Dashboard Templates",
} as const;

export function InsightsEmptyDashboard({ dashboard, onTemplateSave }: {
  dashboard: InsightsDashboard;
  /** Called with the SE's five choices when the configuration drawer is saved. */
  onTemplateSave?: (name: string, picks: Record<string, string>) => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { profile, profileId } = useProfile();
  const { tilesFor } = useAiAssistant();
  /* Registers this dashboard as the AI scope like every other screen, so the top-bar
     sparkle and undo work here and the two headings are renameable rather than literals. */
  const data = usePageDataWithLabels({ title: dashboard.name }, LABELS);

  /* ⚠️ THE EMPTY STATE IS A STATE, NOT THE SCREEN. Once a tile lands, the illustration
     and the templates panel go — a dashboard that still says "add a tile to get started"
     above the tile you just added reads as the add having failed. Same scope key
     `DashAssistant` renders from (`<profileId>::<encoded pathname>`), so the two cannot
     disagree about whether this dashboard has anything on it. */
  const empty = tilesFor(`${profileId}::${pathname}`).length === 0;

  /* Add Tile carries THIS dashboard, so what gets built lands here rather than on the
     Summary Dashboard, which is where a hardcoded destination used to put it. */
  const addTileHref = `/insights/add-tile?to=${encodeURIComponent(pathname)}`;

  /* Which template card's Dashboard Configuration drawer is open, or null. */
  const [configuring, setConfiguring] = useState<DashboardTemplate | null>(null);

  return (
    <div className="ind-page ied-page">
      {/* ⚠️ THE HEADER STRUCTURE IS InsightsDashboard's, COPIED EXACTLY: a div holding the
          crumb and the title, then a sibling `.ind-actions`. Guessing at it (a `.ind-titlerow`
          wrapper and an `.ind-breadcrumb` class, neither of which exists) laid the title out
          right-aligned with the buttons wrapped underneath. The `.ind-*` rules are reused
          READ-ONLY here, per the Connect AI note — no edits, only an `.ied-*` addition. */}
      <div className="ind-head">
        <div>
          <Link to="/insights" className="ind-crumb">INSIGHTS &amp; ANALYTICS</Link>
          <h1 className="ind-title">{data.title}</h1>
        </div>
        <div className="ind-actions">
          <button className="ind-ask" type="button">
            <span className="material-icons">auto_awesome</span>Ask
          </button>
          <button className="ied-addtile" type="button" onClick={() => navigate(addTileHref)}>
            <span className="material-icons">add</span>Add Tile
          </button>
          <span className="material-icons ind-kebab">more_vert</span>
        </div>
      </div>

      {/* ⚠️ THE DESCRIPTION IS NOT RENDERED HERE, and that is the measurement rather than an
          omission: the captured liveboard header carries the crumb and the title and nothing
          else. It was previously printed under the title, where it read as a stray word in
          the corner. It is still collected by the New Dashboard modal and stored on the
          dashboard — put it back on screen only against a capture that shows one. */}
      {empty ? (
        /* ⚠️ ONE CENTRED COLUMN holding both blocks, which is what the capture measures:
           `align-items: center` with a 24px gap, so each child is sized by its own content
           and centred. Rendering them as full-width siblings of the header — the first
           attempt — stretched the panel across the page and the cards with it. */
        <div className="ied-body">
          <div className="ied-empty">
            <img className="ied-art" src="/insights-empty.svg" alt="" width={320} height={220} />
            <p className="ied-copy">{data.labels.emptyCopy}</p>
            <button type="button" className="ied-addtile" onClick={() => navigate(addTileHref)}>
              <span className="material-icons">add</span>Add Tile
            </button>
          </div>

          <div className="ied-templates">
            <section className="ied-panel">
              <h2 className="ied-templates-head">{data.labels.templatesHeading}</h2>
              <div className="ied-cards">
                {DASHBOARD_TEMPLATES.map((t) => (
                  /* ⚠️ A CARD IS A BUTTON ONLY WHERE ITS DRAWER IS CAPTURED. The live cards
                     are all `cursor: pointer`, but only Lead Conversion's configuration is
                     measured. The other two stay inert rather than opening a drawer whose
                     categories we would have to invent, and they carry no pointer cursor,
                     so nothing implies they work. */
                  t.fields
                    ? <button className="ied-card ied-card--on" key={t.name} type="button"
                        onClick={() => setConfiguring(t)}>
                        <h3 className="ied-card-title">{t.name}</h3>
                        <p className="ied-card-body">{t.body}</p>
                      </button>
                    : <article className="ied-card" key={t.name}>
                        <h3 className="ied-card-title">{t.name}</h3>
                        <p className="ied-card-body">{t.body}</p>
                      </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {/* Tiles added from Add Tile land here, so the dashboard fills up in place — the
          same `variant="ts"` assistant every other Insights screen uses, keyed to this
          route, so its tiles belong to THIS dashboard and no other. */}
      {/* ⚠️ SAVE STORES THE CHOICES AND CLOSES. What a template BUILDS is the one thing
          the capture cannot show — saving on the live account would have written to a
          real customer's dashboard — so no tile layout is invented here. */}
      <DashboardConfigDrawer
        template={configuring}
        profile={profile}
        dashboardName={dashboard.name}
        onCancel={() => setConfiguring(null)}
        onSave={(name, picks) => { setConfiguring(null); onTemplateSave?.(name, picks); }}
      />

      <DashAssistant variant="ts" />
      <span hidden>{profile.id}</span>
    </div>
  );
}
