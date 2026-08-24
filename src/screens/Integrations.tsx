import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

/* =============================================================================
   Integrations — the IN-PLATFORM page, replacing the old marketing-site copy.
   -----------------------------------------------------------------------------
   Real URL `/networks/2160/action_collections/ui`. Measured off the LIVE page 8/24/2026
   (Invoca's own React, same-origin) plus a SingleFile capture for the logos, so every
   value here is a computed style rather than a screenshot estimate.

     page        h1 "Integrations" 24/36 #15243E
     search      274 x 36, 1px #E7E9EB, radius 3, white, 16/23 text, 24px search icon
                   #66708E; 60px under the h1 and 30px above the first heading
     heading     h2 sentence-case in the DOM, UPPERCASED IN CSS, 16.5/19.8 #868E96,
                   19.5px below
     tile        white, radius 8, shadow `0 4px 4px rgba(0,0,0,.2)`, NO border,
                   cursor pointer, inner padding 13px, logo 50 x 50, name 16.5/24 #343A40
     stripe      an 8px-wide DIV down the left edge, coloured by state
     badge       10px/10px, padding 6.5px, radius 100px, `text-transform: capitalize`
     grid        Bootstrap: 4 columns >= 1400, 3 >= 1200, 2 >= 576, 1 below;
                   30px gutter, 30px row gap

   ⚠️ THE COLOURED LEFT EDGE IS AN 8px DIV, NOT A BORDER, and the SAME three-colour
   palette dresses both that stripe and the badge chip:
     integrated  #ABE5BC on #0D5400      ready  #B0CDFF on #003399
     learnMore   #E7E0F9 on #440066
   Every tile has one, including "Learn More" — the lilac is just quiet enough to read as
   no stripe at all in a screenshot.

   ⚠️ THE HEADINGS ARE SENTENCE CASE IN THE DOM ("Integrated", "Library") and uppercased
   in CSS — the same trap the DASHBOARD TEMPLATES heading records, and it breaks the moment
   anyone selects or searches the text.

   ⚠️ 4 COLUMNS NEEDS >= 1400px OF LAYOUT VIEWPORT, and measuring once nearly got this
   wrong: at `innerWidth` 1406 the grid rendered THREE columns, because the classic
   scrollbar takes the layout viewport under Bootstrap's 1400 xxl breakpoint while
   `innerWidth` still reads 1406. Re-measured at 1500: four columns, `matchMedia` true.

   ⚠️ THE CARD LIST IS INVOCA'S OWN CATALOGUE and is NOT re-skinned — every name is a real
   third-party product, identical in every account, exactly like the Semantic Signal
   library. The per-account part is which ones are Integrated / Ready To Integrate, kept as
   captured: they name no customer, and a blank Integrated section would read as a broken
   page.

   ⚠️ ONE CARD FROM THE CAPTURE IS DELIBERATELY OMITTED: "TEST - Do not turn live", which
   is an internal artifact of that account and not something to put in front of a prospect.

   ⚠️ LOGOS ARE THE REAL ONES, extracted verbatim from the capture to
   `public/icons/integrations/` (46 files) per the standing use-the-real-icons rule — 44
   raster logos, 2 inline SVGs (Custom Webhooks, Invoca APIs), and Favorite Actions is a
   Material `star_border` ligature exactly as the live page renders it. HubSpot and HubSpot
   MCP SHARE one file, which is the same icon-sharing the Add Tile picker documents.
   Oversized ones were resampled to 160px (1.68MB -> 492KB) since they render at 50px; they
   are files under `public/`, so none of this reaches the single bundle.
   ============================================================================= */

type State = "integrated" | "ready" | "learn";

interface Card {
  name: string;
  state: State;
  /** A file in public/icons/integrations/. */
  icon?: string;
  /** Favorite Actions is a Material ligature on the live page, not an image. */
  material?: string;
  /** Where this card goes. Omitted = inert, see below. */
  to?: string;
}

const BADGE: Record<State, string> = {
  integrated: "Integrated", ready: "Ready To Integrate", learn: "Learn More",
};

/* ⚠️ ChatGPT Ads AND Google Ads SIT HERE, NOT IN THE LIBRARY — moved on request 8/24/2026
   because this demo HAS both journeys built (the captured Google Ads console and the ChatGPT
   sponsored-ad screen), so "Integrated" is the true state for this account rather than
   "Learn More". A deliberate departure from the capture, where both are library cards; the
   captured account has neither built. They keep their alphabetical position, which is how
   the live INTEGRATED list is ordered. */
const INTEGRATED: Card[] = [
  { name: "ChatGPT Ads", state: "integrated", icon: "chatgpt-ads.png", to: "/integrations/chatgpt" },
  { name: "Custom Webhooks", state: "integrated", icon: "custom-webhooks.svg" },
  { name: "Google Ads", state: "integrated", icon: "google-ads.png", to: "/integrations/google-ads" },
  { name: "Invoca APIs", state: "integrated", icon: "invoca-apis.svg" },
  { name: "Sales Cloud", state: "integrated", icon: "sales-cloud.png", to: "/salesforce" },
];

/* ⚠️ ONLY TWO CARDS NAVIGATE, and that is the whole point of this screen for the demo:
   Google Ads keeps the existing click-through to the captured Google Ads console, and
   ChatGPT Ads opens the sponsored-ad screen. Everything else is INERT — the live cards
   open Invoca's own documentation, which we have not captured, and a card that navigates
   somewhere invented is worse than one that does nothing. Inert cards get no pointer
   cursor, so nothing implies otherwise. */
const LIBRARY: Card[] = [
  { name: "Favorite Actions", state: "ready", material: "star_border" },
  { name: "Adobe Analytics", state: "learn", icon: "adobe-analytics.png" },
  { name: "Adobe Experience Platform", state: "learn", icon: "adobe-experience-platform.png" },
  { name: "Agent Voice ID", state: "learn", icon: "agent-voice-id.png" },
  { name: "CDK CRM", state: "learn", icon: "cdk-crm.jpg" },
  { name: "Contentsquare", state: "learn", icon: "contentsquare.png" },
  { name: "Criteo", state: "learn", icon: "criteo.png" },
  { name: "DealerSocket", state: "learn", icon: "dealersocket.jpg" },
  { name: "Dynamic Yield", state: "learn", icon: "dynamic-yield.png" },
  { name: "Email", state: "learn", icon: "email.png" },
  { name: "Facebook Conversions API", state: "learn", icon: "facebook-conversions-api.png" },
  { name: "Fortellis", state: "learn", icon: "fortellis.jpg" },
  { name: "Freshpaint", state: "learn", icon: "freshpaint.png" },
  { name: "Google Analytics 4", state: "learn", icon: "google-analytics-4.png" },
  { name: "Google Campaign Manager", state: "learn", icon: "google-campaign-manager.png" },
  { name: "Google Local Services Ads (LSA)", state: "learn", icon: "google-local-services-ads-lsa.png" },
  { name: "Google Universal Analytics", state: "learn", icon: "google-universal-analytics.png" },
  { name: "HubSpot", state: "learn", icon: "hubspot.png" },
  { name: "HubSpot MCP", state: "learn", icon: "hubspot.png" },
  { name: "Impact.com", state: "learn", icon: "impact-com.png" },
  { name: "Innovid", state: "learn", icon: "innovid.png" },
  { name: "Invoca for AdWords", state: "ready", icon: "invoca-for-adwords.png" },
  { name: "LinkedIn Ads", state: "learn", icon: "linkedin-ads.png" },
  { name: "Medallia", state: "learn", icon: "medallia.png" },
  { name: "MSFT Ads Conversions API", state: "learn", icon: "msft-ads-conversions-api.png" },
  { name: "Optimizely", state: "learn", icon: "optimizely.png" },
  { name: "Pinterest", state: "learn", icon: "pinterest.png" },
  { name: "Piwik PRO", state: "learn", icon: "piwik-pro.png" },
  { name: "Reddit Ads", state: "learn", icon: "reddit-ads.png" },
  { name: "Roku Ads", state: "learn", icon: "roku-ads.png" },
  { name: "Salesforce MCP", state: "learn", icon: "salesforce-mcp.png" },
  { name: "Search Ads 360", state: "learn", icon: "search-ads-360.png" },
  { name: "Segment", state: "learn", icon: "segment.png" },
  { name: "Slack", state: "learn", icon: "slack.png" },
  { name: "Snapchat", state: "learn", icon: "snapchat.png" },
  { name: "StackAdapt", state: "learn", icon: "stackadapt.png" },
  { name: "Tealium", state: "learn", icon: "tealium.png" },
  { name: "The Trade Desk", state: "learn", icon: "the-trade-desk.jpg" },
  { name: "TikTok", state: "learn", icon: "tiktok.png" },
  { name: "tvScientific", state: "learn", icon: "tvscientific.png" },
  { name: "Vibe", state: "learn", icon: "vibe.jpg" },
  { name: "VinSolutions", state: "learn", icon: "vinsolutions.png" },
  { name: "VWO", state: "learn", icon: "vwo.jpg" },
];

export function Integrations() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const match = (c: Card) => c.name.toLowerCase().includes(q.trim().toLowerCase());
  const integrated = useMemo(() => INTEGRATED.filter(match), [q]);
  const library = useMemo(() => LIBRARY.filter(match), [q]);

  const Tile = ({ c }: { c: Card }) => {
    const go = c.to ? () => navigate(c.to!) : undefined;
    return (
      <div className="itg-col">
        <div className={"itg-tile" + (go ? " itg-tile--on" : "")}
          onClick={go} role={go ? "button" : undefined} tabIndex={go ? 0 : undefined}
          onKeyDown={go ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } } : undefined}>
          <div className={"itg-stripe itg-stripe--" + c.state} />
          <div className="itg-body">
            <div className="itg-logo">
              {c.material
                ? <span className="material-icons itg-material">{c.material}</span>
                : <img src={"/icons/integrations/" + c.icon} alt="" />}
            </div>
            <div className="itg-meta">
              <span className={"itg-badge itg-badge--" + c.state}>{BADGE[c.state]}</span>
              <span className="itg-name">{c.name}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="itg-page">
      {/* The h1 sits in its own band with a 1px rule under it — see `.itg-head`. */}
      <div className="itg-head">
        <h1 className="itg-h1">Integrations</h1>
      </div>

      <div className="itg-search">
        <span className="material-icons itg-search-icon">search</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Integrations" />
      </div>

      {integrated.length > 0 && (
        <section className="itg-section">
          <h2 className="itg-h2">Integrated</h2>
          <div className="itg-row">{integrated.map((c) => <Tile c={c} key={c.name} />)}</div>
        </section>
      )}

      {library.length > 0 && (
        <section className="itg-section">
          <h2 className="itg-h2">Library</h2>
          <div className="itg-row">{library.map((c) => <Tile c={c} key={c.name} />)}</div>
        </section>
      )}

      {integrated.length + library.length === 0 && (
        <p className="itg-empty">No integrations match &ldquo;{q.trim()}&rdquo;.</p>
      )}
    </div>
  );
}
