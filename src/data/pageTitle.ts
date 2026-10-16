/* =============================================================================
   pageTitle: what the browser tab says on each screen (10/15/2026)
   -----------------------------------------------------------------------------
   Asked for directly: *"change the tab heading name based on what page they are
   in"*. Every tab used to read "invoca-demo-platform", so a row of open demo tabs
   was indistinguishable and the one in front of a prospect named our repo.

   `<Page> | <prospect>` on the Invoca screens of a demo (asked for 10/15/2026: "instead of
   Invoca in the name, put the prospect name"), so each open demo tab says whose it is.
   Our own tool pages (Launch, Feedback, Release Notes, Follow-ups) belong to no prospect
   and keep `| Invoca`, as does any page before a profile has loaded.
   The third-party replicas (Salesforce, Google, ChatGPT) name THEIR product, since
   that is the screen being shown, and the tab icon stays Invoca's either way.

   ⚠️ A DASHBOARD'S TITLE IS ITS OWN ON-SCREEN TITLE, read off the profile, so the
   tab and the page heading cannot disagree (and a hotel's re-skinned title reads
   as theirs). The literal is only the fallback for a profile without that slice.
   ⚠️ `null` MEANS "THE PAGE SETS ITS OWN" (the Preview Agent names the workflow it
   is previewing, which only that page knows). No em dashes: tab text is read.
   Pure and React-free so `audit:app` can call it for every route.
   ============================================================================= */
import type { CustomerProfile } from "./schema";

/** Our own tool's pages: not part of any prospect's demo. */
const TOOL = new Set(["/", "/launch", "/feedback", "/release-notes", "/follow-ups"]);

type Titled = { title?: string } | undefined;
const titleOf = (slice: Titled, fallback: string) => slice?.title?.trim() || fallback;

/** Dashboards: the route's own on-screen heading, else a sensible name. */
function dashboardTitle(slug: string, p: CustomerProfile | null): string | null {
  const r = p?.reports;
  switch (slug) {
    case "marketing": return titleOf(r?.marketingDashboard, "Marketing Performance Dashboard");
    case "marketing-ops": return titleOf(r?.opsDashboard, "Marketing & Operations Performance");
    case "ai-agent-conversion": return titleOf(r?.aiAgentConversion, "AI Agent Conversion Dashboard");
    case "ai-messaging-impact": return titleOf(r?.aiMessagingImpact, "AI Messaging Impact");
    case "quality-management": return titleOf(r?.qualityManagement, "QM Actionable Insights");
    case "qm-instant-insights": return titleOf(r?.qmInstantInsights, "QM Instant Insights");
    case "location-comparison": return "Location Performance Comparison";
    case "ai-conversion-by-location": return "AI Conversion by Location";
    default: return null;
  }
}

const EXACT: Record<string, string> = {
  "/": "Launch a Demo",
  "/launch": "Launch a Demo",
  "/feedback": "Feedback & Feature Requests",
  "/release-notes": "Release Notes",
  "/follow-ups": "Follow-ups",
  "/integrations": "Integrations",
  "/integrations/custom-crm": "Custom CRM",
  "/insights": "Insights & Analytics",
  "/insights/add-tile": "Add Tile",
  "/insights/call": "Call Details",
  "/ts-gallery": "Chart Gallery",
  "/reports": "My Reports",
  "/reports/digital-insights": "Digital Journey & Call Attribution Report",
  "/reports/conversation-intelligence": "Conversation Intelligence",
  "/reports/conversation-intelligence/silver": "Conversation Intelligence (Silver)",
  "/reports/conversation-intelligence/gold": "Conversation Intelligence (Gold)",
  "/reports/sms-conversation-intelligence": "AI SMS Conversation Intelligence",
  "/reports/sms-conversation-intelligence/lsa": "AI SMS Conversation Intelligence (LSA)",
  "/reports/voice-conversation-intelligence": "AI Voice Conversation Intelligence",
  "/dashboards": "Manage Dashboards",
  "/call-review": "Call Review",
  "/call-review/detail": "Call Details",
  "/agent-studio": "Agent Studio",
  "/agent-studio/agent": "Agent Settings",
  "/agent-studio/agent/knowledge": "Knowledge Sources",
  "/agent-studio/agent/recommendations": "AI Recommendations",
  "/signal": "Manage Signals",
  "/signal/rule": "Edit Rule Signal",
  "/signal/new": "New Signal",
  "/signal/new/semantic": "Semantic Signal Library",
  "/signal/new/semantic/activate": "New Semantic Signal",
  "/signal/ai-studio": "Signal AI Studio",
  "/signal/discovery": "Signal Discovery",
  "/profiles": "Profiles",
  "/campaigns": "Campaigns",
  "/lead-forms": "Lead Forms",
  "/publishers": "Publishers",
  "/promo-numbers": "Promo Numbers",
  "/score": "Score",
  "/labs": "Labs",
  "/settings": "Settings",
};

/** Somebody else's product: the tab names that product, not Invoca. */
const SALESFORCE: Record<string, string> = {
  "/salesforce": "Home",
  "/salesforce/calendar": "Calendar",
  "/salesforce/leads": "Leads",
  "/salesforce/call-log": "Invoca Call Log",
};

/** Pages that title themselves: the Preview Agent, and the two hand-offs to saved static
    copies (the Invoca Exchange and the Google Ads console carry their real titles). */
export const SETS_OWN = new Set(["/agent-studio/agent/preview", "/invoca-exchange", "/integrations/google-ads"]);

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** The tab title for a route, or null when the page sets its own. */
export function pageTitle(pathname: string, profile: CustomerProfile | null = null): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  if (SETS_OWN.has(path)) return null;

  if (SALESFORCE[path]) return `${SALESFORCE[path]} | Salesforce`;
  let m = /^\/salesforce\/leads\/[^/]+$/.exec(path);
  if (m) return "Lead | Salesforce";
  m = /^\/salesforce\/call-log\/([^/]+)$/.exec(path);
  if (m) return `${decode(m[1])} | Salesforce`;
  if (path === "/google-search") return "Google Search";
  if (path === "/integrations/chatgpt") return "ChatGPT";
  if (path === "/replica" || path.startsWith("/replica/")) return "Booking Page";

  const name = profile?.customerName?.trim();
  const SUFFIX = name && !TOOL.has(path) ? ` | ${name}` : " | Invoca";

  if (EXACT[path]) return EXACT[path] + SUFFIX;

  m = /^\/dashboards\/([^/]+)$/.exec(path);
  if (m) {
    const t = dashboardTitle(m[1], profile);
    // Several dashboard headings already end "(Aptive)"; the suffix names them now.
    if (t) return (name ? t.replace(` (${name})`, "") : t) + SUFFIX;
  }
  m = /^\/insights\/dashboard\/([^/]+)$/.exec(path);
  if (m) return decode(m[1]) + SUFFIX;
  if (/^\/insights\/add-tile\/[^/]+$/.test(path)) return "Add Tile" + SUFFIX;
  if (/^\/agent-studio\/agent\/workflow\/(new\/)?[^/]+$/.test(path)) return "Agent Workflow" + SUFFIX;
  if (/^\/signal\/ai-studio\/verify\/[^/]+$/.test(path)) return "Verify Labels" + SUFFIX;
  if (/^\/reports\/artifact\/[^/]+$/.test(path)) return "AI Artifact" + SUFFIX;

  return "Invoca";
}
