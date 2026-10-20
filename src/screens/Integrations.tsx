import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePageData } from "../components/GeneratedTiles";

/* =============================================================================
   Integrations — Invoca's NEW in-platform page (10/20/2026).
   -----------------------------------------------------------------------------
   Rebuilt off a SingleFile capture of the live page (reference/integrations-v2.html,
   network 1847 `/action_collections/ui`) and a screen recording of its tag filtering.
   Every value is the capture's own Titan/MUI CSS:

     header     h1 24/36 #15243E, padding 16px 24px 8px, then a 1px #E7E9EB rule
     search     max 360 (flex 1 1 240), 32 tall outlined, radius 4, placeholder #5B6577
     view       tile/table toggle on #E7E9EB, padding 3; selected white + MUI shadow
     tags       32 tall pills, 2px #D0D3D8, 700 14px #5B6577, capitalized; gap 6px.
                Hover: white, border #445065. SELECTED (from the video): #E7E9EB fill,
                #445065 border, #15243E text. "Clear All" follows, hidden when nothing is
     sections   600 16/20 heading, 12px to the grid; 24px between sections
     grid       2 / 3 / 4 columns at 0 / 900 / 1200px, 16px gap
     card       2px #E7E9EB border, radius 3, a 4px LEFT stripe (green #2CBF58 when
                connected or a tool, #E7E9EB when available), padding 12px 16px;
                logo 36, 12px, name 16/20; tags 22 tall, 1px #E7E9EB, 12/16 #5B6577,
                "Agentic" 1px #B0CDFF, #11228C with a sparkle

   ⚠️ FILTERING, read off the video: tags filter Connected AND Available; Tools has no
   tags, so it disappears while a tag is on; any section left empty disappears. SEVERAL
   tags may be on at once (the user's choice when asked; the video only ever showed one),
   and a card shows when it carries ANY of them.
   ⚠️ THE TABLE VIEW IS NOT IN THE CAPTURE OR THE VIDEO. It is built on the user's say-so
   from the same data and the same filtering; replace it if a capture of the real one turns up.
   ⚠️ CONNECTED HOLDS OUR FOUR BUILT JOURNEYS as well as the captured account's own (asked
   for: "keep all of the existing integrations that I have built. Just add them to the top
   section"): Google Ads, Sales Cloud, ChatGPT Ads and Custom CRM, each still opening its
   screen. ChatGPT Ads moved up from Available. Every other card is inert, because the live
   cards open Invoca's own setup pages, which are not captured.
   ⚠️ "TEST - Do not turn live" is omitted, as before: an internal artifact of that account.
   ⚠️ LOGOS ARE THE CAPTURE'S OWN (public/icons/integrations-v2/), resized to 144px; four
   came from CSS background-images rather than <img> (Google Ads, Sales Cloud, Invoca for
   AdWords, Microsoft Advertising), and two declared as JPEG were really WebP and AVIF.
   ============================================================================= */

interface Card {
  name: string;
  tags: string[];
  /** An image path under public/. */
  icon?: string;
  /** Custom CRM is ours, drawn as a Material ligature. */
  material?: string;
  /** Where this card goes. Omitted = inert. */
  to?: string;
}

/* The filter row, in the capture's order. Lower case "and" as in the DOM; CSS capitalizes. */
const TAGS = ["Agentic", "Collaboration", "Compliance and Privacy", "CRM", "Customer Data Platform",
  "Digital Advertising", "Experience Management", "Performance Marketing", "Personalization",
  "Programmatic Advertising", "Scheduling", "Social Advertising", "Tag Management", "TV and Video Ads",
  "Web Analytics"];

const CONNECTED: Card[] = [
  { name: "Adobe Experience Platform", tags: ["Customer Data Platform", "Personalization", "Web Analytics"], icon: "/icons/integrations-v2/adobe-experience-platform.png" },
  { name: "Agent Voice ID", tags: [], icon: "/icons/integrations-v2/agent-voice-id.png" },
  { name: "ChatGPT Ads", tags: ["Digital Advertising"], icon: "/icons/integrations-v2/chatgpt-ads.png", to: "/integrations/chatgpt" },
  { name: "Custom CRM", tags: ["CRM", "Scheduling"], material: "event_available", to: "/integrations/custom-crm" },
  { name: "Email", tags: [], icon: "/icons/integrations-v2/email.png" },
  { name: "Facebook Conversions API", tags: ["Social Advertising"], icon: "/icons/integrations-v2/facebook-conversions-api.png" },
  { name: "Google Ads", tags: [], icon: "/icons/integrations-v2/google-ads.png", to: "/integrations/google-ads" },
  { name: "Google Universal Analytics", tags: [], icon: "/icons/integrations-v2/google-universal-analytics.png" },
  { name: "HubSpot", tags: ["CRM"], icon: "/icons/integrations-v2/hubspot.png" },
  { name: "Sales Cloud", tags: [], icon: "/icons/integrations-v2/sales-cloud.png", to: "/salesforce" },
  { name: "Slack", tags: ["Collaboration"], icon: "/icons/integrations-v2/slack.png" },
  { name: "Snapchat", tags: ["Social Advertising"], icon: "/icons/integrations-v2/snapchat.png" },
  { name: "Tealium", tags: ["Customer Data Platform", "Tag Management"], icon: "/icons/integrations-v2/tealium.png" },
];

const TOOLS: Card[] = [
  { name: "Custom Webhooks", tags: [], icon: "/icons/integrations/custom-webhooks.svg" },
  { name: "Invoca APIs", tags: [], icon: "/icons/integrations/invoca-apis.svg" },
];

const AVAILABLE: Card[] = [
  { name: "Adobe Analytics", tags: ["Web Analytics"], icon: "/icons/integrations-v2/adobe-analytics.png" },
  { name: "Calendly MCP", tags: ["Agentic", "Scheduling"], icon: "/icons/integrations-v2/calendly-mcp.png" },
  { name: "CDK CRM", tags: [], icon: "/icons/integrations-v2/cdk-crm.jpg" },
  { name: "Contentsquare", tags: ["Web Analytics"], icon: "/icons/integrations-v2/contentsquare.png" },
  { name: "Criteo", tags: ["Programmatic Advertising"], icon: "/icons/integrations-v2/criteo.png" },
  { name: "DealerSocket", tags: [], icon: "/icons/integrations-v2/dealersocket.jpg" },
  { name: "Dentrix Ascend", tags: ["Agentic", "CRM", "Scheduling"], icon: "/icons/integrations-v2/dentrix-ascend.webp" },
  { name: "Dynamic Yield", tags: ["Personalization"], icon: "/icons/integrations-v2/dynamic-yield.png" },
  { name: "Epic", tags: ["Agentic", "CRM"], icon: "/icons/integrations-v2/epic.png" },
  { name: "ezyVet", tags: ["Agentic", "Scheduling"], icon: "/icons/integrations-v2/ezyvet.avif" },
  { name: "Fortellis", tags: [], icon: "/icons/integrations-v2/fortellis.jpg" },
  { name: "Freshpaint", tags: ["Compliance and Privacy"], icon: "/icons/integrations-v2/freshpaint.png" },
  { name: "Google Analytics 4", tags: ["Web Analytics"], icon: "/icons/integrations-v2/google-analytics-4.png" },
  { name: "Google Campaign Manager", tags: ["Digital Advertising", "Programmatic Advertising"], icon: "/icons/integrations-v2/google-campaign-manager.png" },
  { name: "Google Local Services Ads (LSA)", tags: [], icon: "/icons/integrations-v2/google-local-services-ads-lsa.png" },
  { name: "HubSpot MCP", tags: ["Agentic", "CRM"], icon: "/icons/integrations-v2/hubspot-mcp.png" },
  { name: "Impact.com", tags: ["Performance Marketing"], icon: "/icons/integrations-v2/impact-com.png" },
  { name: "Innovid", tags: ["TV and Video Ads"], icon: "/icons/integrations-v2/innovid.png" },
  { name: "Invoca for AdWords", tags: [], icon: "/icons/integrations-v2/invoca-for-adwords.png" },
  { name: "LinkedIn Ads", tags: ["Social Advertising"], icon: "/icons/integrations-v2/linkedin-ads.png" },
  { name: "Medallia", tags: ["Experience Management"], icon: "/icons/integrations-v2/medallia.png" },
  { name: "Microsoft Advertising", tags: [], icon: "/icons/integrations-v2/microsoft-advertising.png" },
  { name: "Microsoft Dynamics 365 MCP", tags: ["Agentic", "CRM"], icon: "/icons/integrations-v2/microsoft-dynamics-365-mcp.png" },
  { name: "MNTN", tags: ["TV and Video Ads"], icon: "/icons/integrations-v2/mntn.png" },
  { name: "MSFT Ads Conversions API", tags: ["Digital Advertising"], icon: "/icons/integrations-v2/msft-ads-conversions-api.png" },
  { name: "NexHealth", tags: ["Agentic", "CRM", "Scheduling"], icon: "/icons/integrations-v2/nexhealth.png" },
  { name: "Nextdoor Ads Manager", tags: ["Social Advertising"], icon: "/icons/integrations-v2/nextdoor-ads-manager.png" },
  { name: "Optimizely", tags: ["Personalization"], icon: "/icons/integrations-v2/optimizely.png" },
  { name: "Pinterest", tags: ["Social Advertising"], icon: "/icons/integrations-v2/pinterest.png" },
  { name: "Piwik PRO", tags: ["Web Analytics"], icon: "/icons/integrations-v2/piwik-pro.png" },
  { name: "Reddit Ads", tags: ["Social Advertising"], icon: "/icons/integrations-v2/reddit-ads.png" },
  { name: "Roku Ads", tags: ["TV and Video Ads"], icon: "/icons/integrations-v2/roku-ads.png" },
  { name: "Salesforce MCP", tags: ["Agentic", "CRM"], icon: "/icons/integrations-v2/salesforce-mcp.png" },
  { name: "Search Ads 360", tags: ["Digital Advertising"], icon: "/icons/integrations-v2/search-ads-360.png" },
  { name: "Segment", tags: ["Customer Data Platform", "Personalization"], icon: "/icons/integrations-v2/segment.png" },
  { name: "ServiceTitan", tags: ["Agentic", "CRM", "Scheduling"], icon: "/icons/integrations-v2/servicetitan.png" },
  { name: "StackAdapt", tags: ["Programmatic Advertising"], icon: "/icons/integrations-v2/stackadapt.png" },
  { name: "The Trade Desk", tags: ["Programmatic Advertising"], icon: "/icons/integrations-v2/the-trade-desk.jpg" },
  { name: "TikTok", tags: ["Social Advertising"], icon: "/icons/integrations-v2/tiktok.png" },
  { name: "tvScientific", tags: ["TV and Video Ads"], icon: "/icons/integrations-v2/tvscientific.png" },
  { name: "Vibe", tags: ["TV and Video Ads"], icon: "/icons/integrations-v2/vibe.jpg" },
  { name: "VinSolutions", tags: ["CRM"], icon: "/icons/integrations-v2/vinsolutions.png" },
  { name: "VWO", tags: ["Personalization"], icon: "/icons/integrations-v2/vwo.jpg" },
  { name: "Zoom", tags: ["Agentic", "Scheduling"], icon: "/icons/integrations-v2/zoom.png" },
];

const PAGE_BASE = { title: "Integrations", connected: CONNECTED, tools: TOOLS, available: AVAILABLE };
const ALL_CARDS = [...CONNECTED, ...TOOLS, ...AVAILABLE];

/* MUI's AutoAwesome, verbatim from the capture's Agentic chip and filter button. */
const SPARK = "m19 9 1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25z";
const Spark = () => <svg className="itg-spark" viewBox="0 0 24 24" aria-hidden="true"><path d={SPARK} /></svg>;

type Section = { key: "connected" | "tools" | "available"; title: string; cards: Card[]; on: boolean };

export function Integrations() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [view, setView] = useState<"tiles" | "table">("tiles");

  /* Registered as page data (the standing rule that Ask AI may change any data on any page).
     Where a card navigates, the destination stays the app's own, matched back by name. */
  const data = usePageData(PAGE_BASE);
  const keepTo = (c: Card): Card => ({ ...c, tags: c.tags ?? [], to: ALL_CARDS.find((o) => o.name === c.name)?.to });
  const term = q.trim().toLowerCase();
  const lc = picked.map((t) => t.toLowerCase());
  const match = (c: Card) => (!term || c.name.toLowerCase().includes(term))
    && (!lc.length || c.tags.some((t) => lc.includes(t.toLowerCase())));
  const sections: Section[] = useMemo(() => [
    { key: "connected", title: "Connected Integrations", cards: (data.connected ?? CONNECTED).map(keepTo).filter(match), on: true },
    /* Tools carry no tags, so a tag filter leaves nothing to show there, as in the video. */
    { key: "tools", title: "Tools", cards: (data.tools ?? TOOLS).map(keepTo).filter(match), on: true },
    { key: "available", title: "Available Integrations", cards: (data.available ?? AVAILABLE).map(keepTo).filter(match), on: false },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [term, picked.join("|"), data.connected, data.tools, data.available]);
  const shown = sections.filter((s) => s.cards.length > 0);
  const toggle = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const open = (c: Card) => (c.to ? () => navigate(c.to!) : undefined);
  const keys = (go?: () => void) => (go ? {
    role: "button" as const, tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } },
  } : {});
  const Logo = ({ c }: { c: Card }) => (c.material
    ? <span className="material-icons itg-material" aria-hidden="true">{c.material}</span>
    : <img className="itg-logo" src={c.icon} alt={`${c.name} logo`} />);
  const Tags = ({ c }: { c: Card }) => (c.tags.length ? (
    <div className="itg-tags">
      {c.tags.map((t) => t === "Agentic"
        ? <span key={t} className="itg-tag itg-tag-agentic"><Spark />Agentic</span>
        : <span key={t} className="itg-tag">{t}</span>)}
    </div>
  ) : null);

  return (
    <div className="itg-page">
      <div className="itg-head"><h1 className="itg-h1">Integrations</h1></div>
      <hr className="itg-rule" />

      <div className="itg-body">
        <div className="itg-controls">
          <div className="itg-search">
            <svg className="itg-search-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Integrations" aria-label="Search Integrations" />
          </div>
          <div className="itg-filters">
            <div className="itg-views" role="group" aria-label="Integration view">
              <button type="button" className={"itg-view" + (view === "tiles" ? " itg-view-on" : "")} aria-pressed={view === "tiles"}
                aria-label="Tile view" onClick={() => setView("tiles")}>
                <span className="itg-ico-grid" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>
              </button>
              <button type="button" className={"itg-view" + (view === "table" ? " itg-view-on" : "")} aria-pressed={view === "table"}
                aria-label="Table view" onClick={() => setView("table")}>
                <span className="itg-ico-list" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i}><i /><b /></span>)}</span>
              </button>
            </div>
            {TAGS.map((t) => (
              <button key={t} type="button" className={"itg-filter" + (picked.includes(t) ? " itg-filter-on" : "")}
                aria-pressed={picked.includes(t)} onClick={() => toggle(t)}>
                {t === "Agentic" && <Spark />}{t}
              </button>
            ))}
            {/* Always laid out, hidden while nothing is picked, as in the capture, so the row never shifts. */}
            <button type="button" className={"itg-clear" + (picked.length ? "" : " itg-clear-off")}
              disabled={!picked.length} aria-hidden={!picked.length} onClick={() => setPicked([])}>Clear All</button>
          </div>
        </div>

        {shown.map((s) => (
          <section key={s.key} className="itg-section">
            <h2 className="itg-h2">{s.title}</h2>
            {view === "tiles" ? (
              <div className="itg-grid">
                {s.cards.map((c) => {
                  const go = open(c);
                  return (
                    <div key={c.name} className={"itg-card" + (go ? " itg-card-on" : "")} onClick={go} {...keys(go)}>
                      <div className={"itg-stripe" + (s.on ? " itg-stripe-on" : "")} />
                      <div className="itg-card-body">
                        <div className="itg-card-top"><Logo c={c} /><span className="itg-name" title={c.name}>{c.name}</span></div>
                        <Tags c={c} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="itg-table" role="table" aria-label={s.title}>
                <div className="itg-tr itg-th" role="row">
                  <span role="columnheader">Integration</span><span role="columnheader">Categories</span><span role="columnheader">Status</span>
                </div>
                {s.cards.map((c) => {
                  const go = open(c);
                  return (
                    <div key={c.name} className={"itg-tr" + (go ? " itg-card-on" : "")} role="row" onClick={go} {...keys(go)}>
                      <span role="cell" className="itg-td-name"><Logo c={c} /><span className="itg-name">{c.name}</span></span>
                      <span role="cell">{c.tags.length ? <Tags c={c} /> : <span className="itg-none">None</span>}</span>
                      <span role="cell"><span className={"itg-status" + (s.on ? " itg-status-on" : "")}>{s.on ? (s.key === "tools" ? "Tool" : "Connected") : "Available"}</span></span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))}

        {shown.length === 0 && <p className="itg-empty">No integrations match.</p>}
      </div>
    </div>
  );
}
