/* =============================================================================
   core.ts — the reusable demo generation pipeline
   -----------------------------------------------------------------------------
   Input:  a customer name + website URL (+ optional API key / progress hook)
   Output: a validated CustomerProfile object.

   Both the CLI (engine/generate.ts) and the dev-server endpoint
   (POST /api/generate, wired in vite.config.ts) call generateProfile().

   Pipeline:
     1. RESEARCH  — Claude reads the customer's site (web_fetch + web_search)
                    and writes a business brief.
     2. GENERATE  — Claude turns the brief into demo data, constrained to the
                    schema via structured outputs, then Zod-validated.
   ============================================================================= */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CustomerProfile, DigitalInsightsReport, DashboardView, CallReviewView, CallDetailView, OpsDashboardView, AiAgentConversionView, AiMessagingImpactView, ConversationIntelligenceView, SmsConversationIntelligenceView, VoiceConversationIntelligenceView, AgentConfigView, VoiceScreenpop, SmsScreenpop, VoiceRoutingDemo, QualityManagementView, QmInstantInsightsView } from "../src/data/schema.ts";

const MODEL = "claude-opus-4-8";
const FAST_MODEL = "claude-haiku-4-5-20251001";

/* Identity + canonical terminology, chosen FAST up-front (a tiny call before the pool)
   since bookingTerm/customerNoun/qualifiedCallTerm/conversionTerm are reused by every
   section. The heavy Digital Insights table is generated SEPARATELY as a pool phase
   (generateDigitalInsights) — nothing else reads it, so it needn't block the pool. */
const TermsOutput = z.object({
  networkName: z.string(),
  industry: z.string(),
  bookingTerm: z.string(),
  customerNoun: z.string(),
  qualifiedCallTerm: z.string(),
  conversionTerm: z.string(),
});

/* Prepended to every generation prompt: force the model to re-skin ALL wording to
   the prospect's vertical, while keeping each section's structure identical. */
function reskin(name: string): string {
  return (
    `RE-SKIN EVERYTHING to ${name}'s industry. Use the exact terminology THIS business/vertical uses for: what it calls its customers (customer/patient/member/client/guest/rider…), its products & services, its locations (store/branch/showroom/clinic/dealership/gym…), its call reasons, and its conversion events. ` +
    `Keep each section's STRUCTURE identical (same number of columns, KPI tiles/groups, rows, and chart series) — only the wording and the numbers change to fit ${name}. ` +
    `Never leave a generic or wrong-industry label (e.g. don't say "Purchase"/"Warranty"/"Showroom"/"Customer" if a different word fits ${name} better). ` +
    `Keep ONLY these platform-fixed labels verbatim: "Marketing Source", "Marketing Medium", "Marketing Campaign", "Marketing Search Term(s)", "Call Count", and "Total Revenue (Sale Amount)".`
  );
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
export function domainOf(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

/* ---- JSON Schema for structured outputs ----------------------------------
   Convert the Zod schema, then force Anthropic's requirements: every object
   gets additionalProperties:false and a complete `required` list. */
function sanitize(node: any): any {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node && typeof node === "object") {
    for (const k of Object.keys(node)) node[k] = sanitize(node[k]);
    if (node.type === "object" && node.properties) {
      node.additionalProperties = false;
      node.required = Object.keys(node.properties);
    }
  }
  return node;
}
function toSchema(zodType: any): any {
  const raw = z.toJSONSchema(zodType, { target: "draft-2020-12" }) as any;
  delete raw.$schema;
  return sanitize(raw);
}

/* Run async task thunks with at most `limit` in flight at once, preserving result
   order + types (tuple in → tuple out). Beats fixed Promise.all batches: a freed
   slot immediately starts the next task instead of waiting for a whole batch's
   slowest member, so fast phases never leave a slot idle. Peak concurrency == limit
   (same rate-limit headroom as the old batches). */
async function runPool<T extends readonly (() => Promise<unknown>)[] | []>(
  tasks: T,
  limit: number,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: any[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

type Progress = (e: { phase: string; status: "start" | "done" }) => void;

/* ---- The pipeline (parameterized; no module-level globals) ----------------
   Uses STREAMING: with large max_tokens + high effort a phase can exceed the
   SDK's 10-minute non-streaming ceiling (which throws before the request is even
   sent), so we stream and await the final message. */
async function structured<T>(client: Anthropic, zodType: any, prompt: string, maxTokens: number, model: string = MODEL): Promise<T> {
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    // `thinking: adaptive` and `output_config.effort` are Opus-only — Haiku
    // (FAST_MODEL) 400s on either, so gate both to MODEL.
    ...(model === MODEL ? { thinking: { type: "adaptive" } } : {}),
    output_config: {
      ...(model === MODEL ? { effort: "high" } : {}),
      format: { type: "json_schema", schema: toSchema(zodType) },
    },
    messages: [{ role: "user", content: prompt }],
  } as any);
  const response = await stream.finalMessage();
  const text = (response.content.find((b: any) => b.type === "text") as any)?.text;
  if (!text) throw new Error("Generation produced no output.");
  return zodType.parse(JSON.parse(text)) as T;
}

async function research(client: Anthropic, name: string, url: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        `Research the company "${name}" whose website is ${url}. ` +
        `Fetch that URL and search the web as needed. Produce a concise brief covering:\n` +
        `- what the business sells and its industry\n` +
        `- their main product/service CATEGORIES and 8–15 specific product/service NAMES with realistic US price points\n` +
        `- for each product, a one-line "components/features" description\n` +
        `- the marketing channels they likely use (Paid Search, Social Media, Organic, etc.) and plausible campaign names\n` +
        `- realistic search terms a customer would use\n` +
        `- their site's navigation structure (for "Home / Category / Subcategory" journeys)\n` +
        `Prioritize the homepage plus 1–2 key product/service/category pages (and a targeted search only if needed); STOP as soon as you have enough to write the brief — do NOT exhaustively crawl the site.\n` +
        `Base it on their ACTUAL site content where possible. Return prose, no preamble.`,
    },
  ];
  const tools = [
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
    { type: "web_search_20260209", name: "web_search", max_uses: 2 },
  ] as any;

  let response = await client.messages.create({ model: MODEL, max_tokens: 8000, thinking: { type: "adaptive" }, tools, messages });
  let guard = 0;
  while (response.stop_reason === "pause_turn" && guard++ < 4) {
    messages.push({ role: "assistant", content: response.content });
    response = await client.messages.create({ model: MODEL, max_tokens: 8000, thinking: { type: "adaptive" }, tools, messages });
  }
  const brief = response.content.filter((b) => b.type === "text").map((b: any) => b.text).join("\n").trim();
  if (!brief) throw new Error("Research produced no brief.");
  return brief;
}

/* FAST prefix call: pick the identity + canonical terminology only (tiny output).
   Runs before the pool because every pool phase reuses these terms. */
function generateTerms(client: Anthropic, name: string, brief: string) {
  return structured<z.infer<typeof TermsOutput>>(
    client,
    TermsOutput,
    `Using this business brief, choose the canonical identity + terminology for ${name}'s Invoca demo.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n\n` +
      `Requirements:\n` +
      `- networkName: "Invoca for <vertical>" (e.g. "Invoca for Automotive").\n` +
      `- industry: short phrase.\n` +
      `- bookingTerm: the industry-appropriate word for what THIS business schedules with a new customer — a short, Title-Case, SINGULAR noun. Pick what truly fits: e.g. "Consultation", "Appointment", "Estimate", "Tour", "Test Drive", "Service Appointment", "Demo". This term is reused across the whole platform.\n` +
      `- customerNoun: the Title-Case SINGULAR word THIS business uses for a customer ("Customer", "Patient", "Member", "Client", "Guest", "Rider", …). Reused across the platform.\n` +
      `- qualifiedCallTerm: what THIS business calls a sales-QUALIFIED inbound call in its dashboards — the "Sales Call" equivalent (e.g. "Sales Call", "Residency Inquiry", "New Patient Call", "Sales Inquiry"). Title-Case. Reused VERBATIM across every dashboard so terminology stays consistent.\n` +
      `- conversionTerm: the Title-Case noun for a WON, revenue-generating conversion for THIS business — the "Purchase / Job Complete" equivalent (the closed sale/outcome), e.g. "Purchase", "Reservation Booked", "Membership Sold", "New Patient", "Move-In", "Job Won". This is DISTINCT from the bookingTerm (which is only the scheduled visit). Reused VERBATIM across every dashboard.`,
    1200
  );
}

/* The Digital Journey & Call Attribution report table — the heavy part of the old
   report call, now generated as its own pool phase (needs only brief + bookingTerm). */
function generateDigitalInsights(client: Anthropic, name: string, brandDomain: string, brief: string, bookingTerm: string) {
  return structured<z.infer<typeof DigitalInsightsReport>>(
    client,
    DigitalInsightsReport,
    `Using this business brief, produce the Invoca "Digital Journey & Call Attribution Report" table for ${name}.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n\n` +
      `Requirements:\n` +
      `- title: exactly → "Digital Journey & Call Attribution Report"\n` +
      `- dateRange: "Jan 19, 2026 - Jan 24, 2026". filterLabel: "Marketing Source: 3 selected". chartLegend: "Total Interactions".\n` +
      `- chart: 6 daily points (01/19–01/24). yMax = clean round number above the tallest bar; yTicks = 5 evenly spaced values ending at yMax.\n` +
      `- dimensionColumns: exactly ["Marketing Source","Marketing Medium","Marketing Campaign","Marketing Search Term","Full Landing Page URL","Website Journey"].\n` +
      `- signalColumns: exactly [{label:"Answered by Agent",badges:["Rule"]},{label:"${bookingTerm} Discussed (Industry)",badges:["Keyword Spotting","Rule"]},{label:"${bookingTerm} Booked (Conversion)",badges:["Keyword Spotting","Rule"]}].\n` +
      `- rows: 18–24 realistic interactions specific to THIS business. Sources: Paid Search / Social Media / Organic; mediums: cpc / Bing / Instagram / Facebook / Organic. Search terms "—" for social/organic. Landing page URLs must use the domain ${brandDomain} with utm params. Website Journey like "Home / Category / Subcategory". Each row's "signals" is 3 booleans aligned to signalColumns; make most rows' first signal (Answered by Agent) true and order the rows so the true ones come first (the table is sorted by that column descending), and vary the other two realistically.`,
    16000
  );
}

function generateDashboard(client: Anthropic, name: string, brief: string, bookingTerm: string, qualifiedCallTerm: string, conversionTerm: string) {
  return structured<z.infer<typeof DashboardView>>(
    client,
    DashboardView,
    `Using this business brief, produce the Invoca "Marketing Performance Dashboard" for ${name}.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n` +
      `The metric labels below are a TEMPLATE — keep the same count/shape. Two conversion terms are GIVEN and MUST be used VERBATIM everywhere they appear: the sales-qualified inbound call is "${qualifiedCallTerm}", and a won revenue conversion is "${conversionTerm}". Re-skin only the OTHER outcome words that don't fit ${name} (e.g. "Warranty Call" → a real call type; "Quote Discussed" → "Estimate Discussed"/"Pricing Discussed"; "Unqualified Lead" → the fitting term). Keep "Call Count" and "Total Revenue (Sale Amount)" verbatim.\n\n` +
      `- title: "Marketing Performance Dashboard (${name})". dateRange: "1/19/2026-1/24/2026".\n` +
      `- kpiGroups: exactly these 3, each 4 tiles (values as strings; percents "84%"; currency "$945,910"; counts may use commas):\n` +
      `  1) "Call Performance Summary": Call Count, ${qualifiedCallTerm} (Percent), ${conversionTerm} (Percent), Total Revenue (Sale Amount)\n` +
      `  2) "Non-Sales Inquiries": Call Count (same value), Support Call (Percent), Billing Call (Percent), Warranty Call (Percent)\n` +
      `  3) "${qualifiedCallTerm} Breakout Metrics": ${qualifiedCallTerm} (Percent), Quote Discussed (Percent), Unqualified Lead (Percent), ${conversionTerm} (Percent)\n` +
      `- breakdowns (in this order), each metricColumns=["Call Count","Quote Discussed (Percent)","${conversionTerm} (Percent)","Total Revenue (Sale Amount)"] with 4–5 rows; call counts roughly sum to the total Call Count:\n` +
      `  • Calls by Source / "Source: Call Outcome Summary" / "Marketing Source" / hasDonut:true\n` +
      `  • Calls by Medium / "Medium: Call Outcome Summary" / "Marketing Medium" / hasDonut:true\n` +
      `  • Calls by Campaign / "Campaign: Call Outcome Summary" / "Marketing Campaign" / hasDonut:true\n` +
      `  • Calls by Search Term / "Search Term: Call Outcome Summary" / "Marketing Search Term" / hasDonut:true\n` +
      `  • Conversions by Product Category / "Conversions by Product Category" / "Product Category" / hasDonut:false, with metricColumns col 2 = "${bookingTerm} Set (Industry) (Percent)"\n` +
      `  • Calls by Region / "Region Summary" / "Location Region" / hasDonut:true (US regions: South/West/Northeast/Midwest)\n` +
      `- salesCallBreakoutGraph: yLabel "${qualifiedCallTerm} (Count)", xLabels the 6 dates, series in order "${qualifiedCallTerm} (Count)","Quote Discussed (Count)","Unqualified Lead (Count)","${conversionTerm} (Count)", each 6 daily counts (${qualifiedCallTerm} highest).\n` +
      `- productCategoryGraph: yLabel "${conversionTerm} (Count)", xLabels the 6 dates, series = the SAME top product categories as the Product Category breakdown, each 6 daily ${conversionTerm} counts.\n` +
      `All numbers plausible for THIS business.`,
    20000
  );
}

function generateCallReview(client: Anthropic, name: string, brief: string, bookingTerm: string) {
  const bt = bookingTerm.toLowerCase();
  return structured<z.infer<typeof CallReviewView>>(
    client,
    CallReviewView,
    `Using this business brief, produce Invoca "Call Review" demo data for ${name} — a list of scored, AI-summarized inbound phone calls.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n\n` +
      `- shownCount: "66 Calls". totalNote: "total of 222 calls from Jan 1 to Oct 31". scoreDisplay: "Quality Score". sortBy: "Highest Score". dateRange: "01/01/2025-10/31/2025".\n` +
      `- calls: exactly 15 items, each a realistic inbound phone call to THIS business, SORTED BY score DESCENDING (highest first):\n` +
      `  • scoreLabel: "Quality Score" for every call.\n` +
      `  • score: integer 34–92, strictly descending across the 15 calls, with a realistic spread.\n` +
      `  • summary: 2–4 sentences naming a specific caller (first + last name), their reason for calling tied to THIS business's actual products/services, what the agent did, and the outcome. Vary scenarios: consultations/quotes, scheduling, order status, delivery/installation issues, warranty/repair, billing disputes, cancellations, complaints. Higher scores read smoother/positive; lower scores have more friction/dissatisfaction.\n` +
      `  • date: like "Jun 3, 2:42 PM" (vary months Jan–Oct and times). duration: like "1m 30s" (0m 40s–3m 30s).\n` +
      `  • agent: a first name (Oscar, Lila, Rosey, Lee, Mary, Sue, Mike, Jennifer, Rose…); use "No Agent" for exactly ONE call that rolled to voicemail.\n` +
      `  • scorecards: 7 or 8. comments: usually 0, with 1–2 on a couple of calls. negativeSentiment: 6–40, LOWER for high-score calls and HIGHER for low-score/negative calls.\n` +
      `  • evaluated: true for 2–3 calls, false for the rest.\n` +
      `  • converted: boolean. TRUE only when the caller booked/scheduled a NEW ${bt} on this call; FALSE for order status, delivery/installation issues, warranty/repair, billing disputes, cancellations, complaints, and the voicemail. 5–7 of the 15 should be true. This drives the "${bookingTerm}: Scheduled" Signals filter, so it MUST be consistent with each summary.\n` +
      `  • IMPORTANT: the 4th call (calls[3]) MUST be a NEW-CUSTOMER consultation/scheduling intake call (they call to schedule and the agent collects their details), with evaluated:true, converted:true, and a score in the 70s (70–79). It drills into the Call Detail page.\n` +
      `- searchSuggestions: EXACTLY 6 short lowercase Global-Transcript-Search demo terms for a manager to click (products, services, or common call reasons for THIS business — e.g. a product line, "warranty", "installation", "cancel"). CRITICAL: each term MUST literally appear (as a substring) in AT LEAST TWO of the call summaries you wrote above, so clicking it always returns results.`,
    12000
  );
}

/* Call Detail — the drill-in for the 4th (evaluated) call: a new-customer intake
   call with scorecard, signals, prompts, transcript, AI summary, and a comment. */
function generateCallDetail(client: Anthropic, name: string, brief: string, bookingTerm: string) {
  const bt = bookingTerm.toLowerCase();
  return structured<z.infer<typeof CallDetailView>>(
    client,
    CallDetailView,
    `Produce Invoca "Call Detail" demo data for ${name} — the drill-in for ONE evaluated inbound call: a NEW-CUSTOMER ${bt}/intake call where the caller schedules and the agent collects their details.\n\n` +
      `BRIEF:\n${brief}\n\n${reskin(name)}\n\n` +
      `- callId "0597-627F62F2570D". agent a full name (e.g. "Marcus Bell"). date like "Jun 6, 2:28 PM". duration "4m 12s".\n` +
      `- scorecardName "BASE SKILLS". scorecardPercent 78. scorecardPoints "70/90 Points".\n` +
      `- scorecardRows: EXACTLY 10. Names specific to THIS business's intake ("(QA) Proper Greeting", "(QA) Proper Close", "Capture Full Name", capture steps for what this business qualifies on, "Capture Email", etc.). EXACTLY 7 rows status "met" points "10/10", 2 rows status "unmet" points "0/10", 1 row status "na" points "—/—".\n` +
      `- signalsMet 13, signalsUnmet 26, signalsNa 25. metSignals: ~13 signal names grounded in the call; unmetSignals: ~10 names; naSignals: ~7 names not applicable to an intake (order/delivery/billing/return).\n` +
      `- prompts: EXACTLY 3 — "Is the customer trying to solve a specific problem?", "What are the customer's expectations?", "How could the agent handle the call better?" — each with a 1–2 sentence answer specific to this call.\n` +
      `- convStart "00:16". transcript: 16–20 turns { speaker "agent" or "caller", time (mm:ss ascending 00:00→~02:14), text }. A realistic ${bt} intake: greet → get name → qualify (specific to THIS business) → confirm service area/ZIP → capture contact (use "****" for a redacted phone/email turn) → book the ${bt} → close. Start and end with the agent.\n` +
      `- aiSummary: 3–5 sentences summarizing the call.\n` +
      `- comment: { author "Kyle Paklaian", audience "Everyone", date "Oct 22, 2:55 PM", text a coaching note addressed to "@<agent's first name>" praising the structure and suggesting 1–2 improvements (empathy, capturing the email, setting expectations for the visit) }.`,
    9000,
    FAST_MODEL
  );
}

function generateOpsDashboard(client: Anthropic, name: string, brief: string, bookingTerm: string, customerNoun: string) {
  return structured<z.infer<typeof OpsDashboardView>>(
    client,
    OpsDashboardView,
    `Using this business brief, produce the Invoca "Marketing and Operations Performance with Revenue" dashboard for ${name}.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n` +
      `Everywhere below: <BOOK> = "${bookingTerm}" (<BOOK>s = plural); <CUST> = "${customerNoun}" (<CUST>s = plural). Use them consistently, uppercasing inside ALL-CAPS group titles.\n` +
      `- title: "Marketing and Operations Performance with Revenue". dateRange: "8/11/2025-8/16/2025".\n` +
      `- kpiGroups: exactly 3 (values are strings):\n` +
      `  1) "MARKETING DRIVEN CALLS": Call Count (e.g. "5,139"), "Avg. Duration" ("2:56"), "Avg. Revenue (Sale Amount)" ("$340.67"), "Total Revenue (Sale Amount)" ("$1,750,719").\n` +
      `  2) "NEW <CUST> ACQUISITION": "Caller Type: New <CUST>s (Count)", "Caller Type: New <CUST>s (Percent)", "<BOOK>: Scheduled (Count)", "<BOOK>: Scheduled (Percent)".\n` +
      `  3) "EXISTING <CUST>s & RESCHEDULING": "Caller Type: Existing <CUST> (Count)", "Caller Type: Existing <CUST> (Percent)", "<BOOK>: Canceled (Percent)".\n` +
      `- marketingSections: exactly 4 — Source, Medium, Campaign, Search Terms. Each = { chartTitle, chart, tableTitle, table }. chart = { legend, axisMax, axisTicks (evenly spaced, ending at axisMax), axisSuffix, bars:[{name,value,display}] } where display is the drawn label ("55%" or "1,880"):\n` +
      `  • Source: chartTitle "MARKETING: Source (<BOOK>s)"; legend "<BOOK>: Scheduled (Percent)", axisMax 60, axisTicks [0,10,20,30,40,50,60], axisSuffix "%", 4 bars (sources by scheduled %, desc). tableTitle "MARKETING: Source (Calls resulting in <BOOK>s)"; columns ["Marketing Source","Call Count","<BOOK>: Scheduled (Percent)","Total Revenue (Sale Amount)"], 5 rows.\n` +
      `  • Medium: chartTitle "MARKETING: Medium (Calls)"; legend "Call Count", axisSuffix "", 5 bars by call count. tableTitle "MARKETING: Medium (Calls resulting in <BOOK>s)"; columns ["Marketing Medium","Call Count","<BOOK>: Scheduled (Percent)"], 5 rows.\n` +
      `  • Campaign: chartTitle "MARKETING: Campaign (Calls)"; legend "Call Count", 5 bars by call count (this business's campaign names). tableTitle "MARKETING: Campaign (Calls resulting in <BOOK>s)"; columns ["Marketing Campaign","Call Count","<BOOK>: Scheduled (Percent)","Total Revenue (Sale Amount)"], 4 rows.\n` +
      `  • Search Terms: chartTitle "MARKETING: Search Terms (Calls)"; legend "Call Count", 5 bars by call count (business-specific search terms). tableTitle "MARKETING: Search Terms (Calls resulting in <BOOK>s)"; columns ["Marketing Search Terms","<BOOK>: Scheduled (Percent)"], 4 rows.\n` +
      `- webpagesTitle "Webpages driving New <CUST>s"; webpages.columns ["Product Category","Call Count","<BOOK>: Scheduled (Percent)","Caller Type: New <CUST>s (Percent)"], 4 rows = this business's product/service categories.\n` +
      `- locationTitle "Location Call Handling"; locationHandling.columns ["Location","Call Count","Call Not Answered (Count)","Voice Mail (Percent)","<BOOK>: Scheduled (Percent)"], 4 rows = this business's actual location type (stores/branches/showrooms/clinics/dealerships/gyms — use real-sounding location names for ${name}).\n` +
      `- noBookingChart: yLabel "Call Count", xLabels ["08/11","08/12","08/13","08/14","08/15","08/16"], series = the 5 top reasons calls DON'T convert for THIS business (adapt to the industry; e.g. Reschedule, ${bookingTerm}, Billing, Cancel, Scheduling), each 6 daily counts (first two largest).\n` +
      `All numbers plausible and specific to ${name}. Every bar's value must be ≤ its chart's axisMax.`,
    22000
  );
}

/* AI Agent Conversion Dashboard (3rd dashboard) — how AI-agent interactions
   convert. Reuses the KpiGroup/Breakdown/MultiSeriesChart shapes; adds the six
   conversion cards. FAST_MODEL keeps it quick. */
function generateAiAgentConversionDashboard(client: Anthropic, name: string, brief: string, bookingTerm: string, _customerNoun: string, qualifiedCallTerm: string, conversionTerm: string) {
  return structured<z.infer<typeof AiAgentConversionView>>(
    client,
    AiAgentConversionView,
    `Using this business brief, produce Invoca "AI Agent Conversion Dashboard" demo data for ${name} — how AI-agent interactions convert into ${bookingTerm}s and revenue.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n\n` +
      `- title "AI Agent Conversion Dashboard". dateRange "1/19/2026-1/24/2026".\n` +
      `- summary: title "AI Agent Performance Summary", tiles EXACTLY [ {label:"Interactions", value: an integer ~1000-1500}, {label:"${qualifiedCallTerm} (Percent)", value like "84%"}, {label:"${conversionTerm} (Percent)", value like "45%"}, {label:"Total Revenue (Sale Amount)", value like "$945,910"} ].\n` +
      `- conversionCards: EXACTLY 6. Titles in this order: "LEAD FORM (Conversions): Live Agent", "LEAD FORM (Conversions): SMS Agent & Live Agent", "LEAD FORM (Conversions): SMS Agent Assist", "Voice Agent (Conversions): Live Agent", "Voice Agent (Conversions): Voice Agent & Live Agent", "Voice Agent (Conversions): Voice Agent". chips first value: LEAD FORM cards (1–3) use "Interaction Type: Form Fill"; Voice Agent cards (4–6) use "Interaction Type: Voice". The other two chips follow the pattern: cards 1&4 [..., "SMS Engaged: No","Live Agent Call: Yes"]; cards 2&5 [..., "SMS Engaged: Yes","Live Agent Call: Yes"]; cards 3&6 [..., "SMS Engaged: Yes","Live Agent Call: No"]. Each card tiles EXACTLY [ {label:"${conversionTerm} (Percent)", value like "21%"}, {label:"Total Revenue (Sale Amount)", value like "$27,760"} ]. ${conversionTerm} % should INCREASE across each group (agent-assisted / agent-only convert best).\n` +
      `- breakdowns: EXACTLY 5.\n` +
      `  • Four with hasDonut:true: "Calls by Source"/"Source: Call Outcome Summary"/dimension "Marketing Source"; "Calls by Medium"/"Medium: Call Outcome Summary"/"Marketing Medium"; "Calls by Campaign"/"Campaign: Call Outcome Summary"/"Marketing Campaign" (campaign names SPECIFIC to ${name}); "Calls by Search Term"/"Search Term: Call Outcome Summary"/"Marketing Search Term" (real search queries a ${name} customer would type).\n` +
      `    Each: metricColumns ["Call Count","${bookingTerm} Scheduled (Percent)","${conversionTerm} (Percent)","Total Revenue (Sale Amount)"]; exactly 5 rows sorted by Call Count DESC (metrics aligned as [count, a %, a %, "$"+amount]); and donutTotal = an integer 15-30% LARGER than the sum of the 5 rows' Call Counts.\n` +
      `  • One with hasDonut:false: title & tableTitle "Conversions by Product Category", dimension "Product Category", metricColumns ["Call Count","${bookingTerm} Scheduled (Percent)","${conversionTerm} (Percent)","Total Revenue (Sale Amount)"], exactly 5 product/service-category rows for ${name}.\n` +
      `- productCategoryGraph: stacked bar. yLabel "${conversionTerm} (Count)". xLabels ["01/19","01/20","01/21","01/22","01/23"]. series = one per product category (SAME names and order as the Product Category table rows), each with 5 small integer values (2-16).\n` +
      `All numbers realistic and internally consistent. Re-skin every campaign, search term, and product category to ${name}'s actual business.`,
    9000,
    FAST_MODEL
  );
}

/* AI Messaging Impact dashboard (4th) — Human-vs-AI story. Keeps the reference
   layout/labels; re-skins the Common Topics categories + amounts to the prospect. */
function generateAiMessagingImpact(client: Anthropic, name: string, brief: string, bookingTerm: string, _customerNoun: string) {
  return structured<z.infer<typeof AiMessagingImpactView>>(
    client,
    AiMessagingImpactView,
    `Using this business brief, produce Invoca "AI Messaging Impact on Lead Capture & Revenue (Human vs AI)" demo data for ${name} — contrasting AI-agent messaging (this month) vs human-only (last month). AI must dramatically outperform human on EVERY metric.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n\n` +
      `- title "AI Messaging Impact on Lead Capture & Revenue (Human vs AI)". dateRange "This Month".\n` +
      `- aiLeadEngagement: title "AI Agent Lead Engagement (This Month)", tiles [{label:"Form Submits", value ~1000-1600}, {label:"Avg. Speed to Lead", value "0:01"}, {label:"AI SMS Engagement Rate", value ~"80-90%"}].\n` +
      `- aiAppointmentPerformance: title "AI Agent ${bookingTerm} Performance (This Month)", tiles [{label:"${bookingTerm} Scheduled (Percent)", ~"20-30%"}, {label:"${bookingTerm} Scheduled (Count)", ~250-400}, {label:"Total Revenue (Sale Amount)", a large "$" amount like "$1,743,824"}].\n` +
      `- humanLeadEngagement: title "Human-Only Lead Engagement (Last Month)", chip "Last Month", tiles [{label:"Form Submits", ~700-1000}, {label:"Avg. Speed to Lead", a SLOW time like "19:23:20"}, {label:"Human SMS Engagement Rate", ~"30-40%"}].\n` +
      `- humanAppointmentPerformance: title "Human ${bookingTerm} Performance (Last Month)", chip "Last Month", tiles [{label:"${bookingTerm} Scheduled (Percent)", LOW ~"2-5%"}, {label:"${bookingTerm} Scheduled (Count)", LOW ~20-40}, {label:"Total Revenue (Sale Amount)", a much smaller "$" like "$168,673"}].\n` +
      `- trendTitle "AI-Assisted ${bookingTerm} Trend". trendChip "AI-Assisted Conversions". trendChart: yLabel "Count", xLabels = 49 daily dates from "07/01" to "08/18", series ONE named "${bookingTerm} Scheduled" whose 49 integer values are flat ~70-85 through 08/01, then JUMP to ~170-190 from 08/02 onward (AI turned on), with small day-to-day wobble and one small dip.\n` +
      `- aiOpportunities: title "AI-Assisted Opportunities", tiles [{label:"SMS Opt-In Count", ~1000-1400}, {label:"SMS Opt-In Rate", ~"85-90%"}, {label:"Total Messages", ~9000-12000}].\n` +
      `- aiLeadNurture: title "AI Lead Nurture", tiles [{label:"AI SMS Callback Scheduled (Count)", ~600-800}, {label:"AI SMS Callback Scheduled (Percent)", ~"55-65%"}, {label:"AI SMS Callback Completed (Count)", slightly below the scheduled count}, {label:"AI SMS Callback Completed (Percent)", ~"95-98%"}].\n` +
      `- commonTopicsTitle "Common Topics". commonTopicsChart: yLabel "${bookingTerm} Scheduled (Count)", xLabels 6 recent daily dates like "04/18".."04/23", series = 5 topic categories SPECIFIC to ${name} (what customers message about), each with 6 small integer values (0-12); make one day near-zero and one the tallest.\n` +
      `All numbers realistic and internally consistent. Re-skin every topic to ${name}'s business.`,
    7000,
    FAST_MODEL
  );
}

function generateConversationIntelligence(client: Anthropic, name: string, brief: string, bookingTerm: string, customerNoun: string) {
  return structured<z.infer<typeof ConversationIntelligenceView>>(
    client,
    ConversationIntelligenceView,
    `Using this business brief, produce Invoca "Conversation Intelligence" demo data for ${name} — the deep-dive analysis of ONE inbound phone call.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n\n` +
      `- title: exactly "Conversation intelligence". dateRange: "Aug 11, 2025 - Aug 16, 2025". callCount: "5,139 calls". pagerLabel: "1 of 52".\n` +
      `- calls: exactly 10 items for the left-hand list, each { time like "8/11/25 12:02 am" (all within Aug 11–16, 2025, ascending), id like "F57B-817F0292530D" (4 hex chars, dash, 12 hex chars, uppercase) }.\n` +
      `- duration: the selected call's length like "2:22" (between 1:30 and 3:00).\n` +
      `- transcript: 18–22 turns of a realistic inbound call to THIS business, alternating speaker "agent" and "caller" (start and end with "agent"). Each turn { speaker, time (mm:ss, strictly increasing, last ≈ duration), text, highlights }. The call: a NEW customer inquires about THIS business's actual products/services, the agent gathers name + needs, recommends specific products, offers the business's booking (consultation/appointment/quote), and SCHEDULES it, closing politely. highlights = array of 0–3 EXACT substrings from that turn's text to emphasize (greeting phrases, the booking being scheduled, product names, closing phrases); use [] when none.\n` +
      `- signals: 8–10 MET SIGNALS specific to THIS business, each { name, badges (subset of ["Keyword Spotting","Rule","Keypress"]), count (0 to hide, else 2–4) }. Include quality signals like "(QA) Proper Greeting" and "(QA) Proper Close" (both with a count), "Answered by Agent" (["Rule"], count 0), a "Caller Type: New ${customerNoun}" signal (["Keyword Spotting","Rule","Keypress"], count 2), a "${bookingTerm}: Scheduled" signal, and 2–3 product/intent signals.\n` +
      `- scoreValue: integer 70–90. scoreLabel: "BASE SKILLS".\n` +
      `- aiSummary: an AI recap of THE TRANSCRIPT ABOVE (must be consistent with it): { summary: 3–4 sentences naming the caller, their need, the products recommended, and the ${bookingTerm.toLowerCase()} that was scheduled; keyPoints: 4–6 short bullet highlights (new ${customerNoun.toLowerCase()}, needs, products, the booking, contact captured); sentiment: "Positive" | "Neutral" | "Negative" (Positive for a smooth booked call); outcome: a short disposition line like "${bookingTerm} booked — Thursday 10 AM" }.\n` +
      `All content plausible and specific to ${name}.`,
    16000
  );
}

function generateSmsConversationIntelligence(client: Anthropic, name: string, brief: string, bookingTerm: string, customerNoun: string) {
  return structured<z.infer<typeof SmsConversationIntelligenceView>>(
    client,
    SmsConversationIntelligenceView,
    `Using this business brief, produce Invoca "AI SMS Conversation Intelligence" demo data for ${name} — a list of AI-SMS text conversations.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n\n` +
      `- countLabel "5,139 calls". dateRange "Aug 11, 2025 - Aug 16, 2025". pagerLabel "1 of 52".\n` +
      `- conversations: exactly 4.\n` +
      `  • conversations[0] is ACTIVE (active:true) — a full realistic AI-SMS conversation for THIS business:\n` +
      `    - id like "C516-117FE212560D" (4 hex chars, dash, 12 hex chars, UPPERCASE). time like "8/16/25 10:55 pm". date "March 10, 2026".\n` +
      `    - transcript: 12–18 turns, each { speaker: "agent" or "consumer", time (like "6:21 AM", ascending), text }. NO emojis, plain SMS text. The agent runs the qualify→(estimate or recap)→book flow toward a ${bookingTerm}: intro + any offer, ask ONE qualifying question at a time, then propose a specific day/time, and confirm with a reminder + a callback number. Alternate speakers; start and end with the agent.\n` +
      `    - signals: 6–8 { name, badges (subset of ["Keyword Spotting","Rule","Keypress"]), count (0–2) } grounded in the conversation. Include "(QA) Proper Greeting", "(QA) Proper Close", "${bookingTerm}: Scheduled", "Caller Type: New ${customerNoun}", "Qualified Lead", and 1–2 product/intent signals.\n` +
      `    - smsInfo: realistic metadata → callRecordId (=id), smsStartTime ("3/10/26 6:21 am"), destinationPhone ("877-936-2933"), totalMessages (the message count as a string), source (same phone), promoNumberDescription "SMS", smsEngaged "Yes", smsOptIn "Yes", smsOptOut "No", sessionStatus "Active", callerId (a real-looking phone), repeatCaller "No", city + region (a real US city + 2-letter state), phoneType "Mobile", displayName/firstName/lastName (a plausible customer name), gender, destinationTimeZone ("Pacific Time (US & Canada)"), finalCampaign "Default: SMS Campaign", finalCampaignId "9970305".\n` +
      `  • conversations[1..3] are INACTIVE shells: active:false, a unique id (same hex format), time (like "8/16/25 10:5X pm"), date "", transcript [], signals [], and smsInfo with all fields set to empty strings "".\n`,
    7000,
    FAST_MODEL
  );
}

/* AI Voice Conversation Intelligence — the voice sibling of the SMS report: a
   list of AI-voice phone calls (1 active example + 3 inactive shells). */
function generateVoiceConversationIntelligence(client: Anthropic, name: string, brief: string, bookingTerm: string, customerNoun: string) {
  return structured<z.infer<typeof VoiceConversationIntelligenceView>>(
    client,
    VoiceConversationIntelligenceView,
    `Using this business brief, produce Invoca "AI Voice Conversation Intelligence" demo data for ${name} — a list of AI-voice phone calls.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n\n` +
      `- countLabel "3,027 calls". dateRange "Aug 11, 2025 - Aug 16, 2025". pagerLabel "1 of 31".\n` +
      `- conversations: exactly 4.\n` +
      `  • conversations[0] is ACTIVE (active:true) — a full realistic AI-voice phone call for THIS business:\n` +
      `    - id like "A417-2C9FE314770D" (4 hex chars, dash, 12 hex chars, UPPERCASE). time like "8/16/25 4:12 pm". date "March 10, 2026".\n` +
      `    - transcript: 12–18 turns, each { speaker: "agent" or "consumer", time (like "4:12 PM", ascending), text }. SPOKEN, natural phone-call language (contractions, e.g. "Yeah, sure."), NO emojis. Say numbers/prices/times the way they'd be spoken aloud (e.g. "ten percent", "thirty-six by forty-eight inches", a phone number as "eight oh five, eight eight eight, two four two four"). The agent runs the qualify→(estimate or recap)→book flow toward a ${bookingTerm}: greet + any offer, ask ONE qualifying question at a time, then propose a specific day/time, and confirm with a reminder + a callback number. Alternate speakers; start and end with the agent.\n` +
      `    - signals: 6–8 { name, badges (subset of ["Keyword Spotting","Rule","Keypress"]), count (0–2) } grounded in the call. Include "(QA) Proper Greeting", "(QA) Proper Close", "${bookingTerm}: Scheduled", "Caller Type: New ${customerNoun}", "Qualified Lead", and 1–2 product/intent signals.\n` +
      `    - voiceInfo: realistic metadata → callRecordId (=id), callStartTime ("3/10/26 4:12 pm"), duration (like "5:47"), destinationPhone ("877-936-2933"), source (a real-looking promo phone), promoNumberDescription "Voice — Paid Search", connectionStatus "Connected", callerId (a real-looking phone), repeatCaller "No", city + region (a real US city + 2-letter state), phoneType "Mobile", displayName/firstName/lastName (a plausible customer name), gender, destinationTimeZone ("Pacific Time (US & Canada)"), finalCampaign "Default: Voice Campaign", finalCampaignId "9970118".\n` +
      `  • conversations[1..3] are INACTIVE shells: active:false, a unique id (same hex format), time (like "8/16/25 3:5X pm"), date "", transcript [], signals [], and voiceInfo with all fields set to empty strings "".\n`,
    7000,
    FAST_MODEL
  );
}

/* The two CTI "screen pop" leave-behinds (Voice + SMS), generated together so the
   caller data is coherent and it's a single fast call. Rendered client-side by
   src/artifacts into self-contained HTML shown in My Reports. */
const ScreenpopsOutput = z.object({
  voiceScreenpop: VoiceScreenpop,
  smsScreenpop: SmsScreenpop,
});
function generateScreenpops(client: Anthropic, name: string, brief: string, bookingTerm: string, _customerNoun: string) {
  return structured<z.infer<typeof ScreenpopsOutput>>(
    client,
    ScreenpopsOutput,
    `Using this business brief, produce data for two Invoca CTI "screen pop" demo artifacts for ${name}: a Voice Screenpop (inbound phone lead) and an SMS Screenpop (inbound text lead). Each is an agent-desktop pop showing Invoca Pre-Call Intelligence about the caller.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n\n` +
      `Both objects: brandName = "${name}". Invent TWO DIFFERENT plausible local leads (different people, phones, addresses) for THIS business, each in a realistic city/state/ZIP inside a service area this business would cover.\n` +
      `For EACH of voiceScreenpop and smsScreenpop set every field:\n` +
      `- callerName (a person's full name), callerPhone (like "(805) 555-0142").\n` +
      `- campaign: a realistic marketing campaign name for THIS business (e.g. "<product/service> - <city> Acquisition").\n` +
      `- tagGreen "✓ In Service Area". tagBlue "New ${bookingTerm} Lead".\n` +
      `- estimatedValue: a plausible dollar deal value for THIS business (e.g. "$2,400").\n` +
      `- googleSearch + websiteSearch: realistic search queries a customer of THIS business would type.\n` +
      `- callingWebpage: a plausible path on this business's site (e.g. "/<product-or-service>").\n` +
      `- products: 2 real product/service names this business offers, comma-separated.\n` +
      `- cartId: like "XX-4827K" (2–3 letters from the brand + dash + 4 alnum).\n` +
      `- serviceable "Yes". email (from the caller name). street, city, state (2-letter), zip (matching the city).\n` +
      `- digitalJourney: a "/home › /a › /b › /a" style path of 3–4 pages on this site.\n` +
      `- intent: one line — the caller's specific need for THIS business.\n` +
      `- coverage: "ZIP <zip> confirmed - <city> serviceable".\n` +
      `voiceScreenpop.switchIntent: one line on urgency / likelihood to switch/buy now (e.g. "High - remodeling now, wants an in-home ${bookingTerm.toLowerCase()} this week").\n` +
      `voiceScreenpop.greeting: a natural SPOKEN suggested greeting the agent would say, naming the caller + ${name} + their need + offering to book a ${bookingTerm.toLowerCase()}.\n` +
      `smsScreenpop.appointment: a ${bookingTerm} the SMS agent ALREADY booked, with a specific day/time (e.g. "In-home ${bookingTerm.toLowerCase()} w/ specialist - Thu Jul 17, 10:00 AM").\n` +
      `smsScreenpop.greeting: a suggested SMS reply from a named rep at ${name}, referencing the already-booked ${bookingTerm.toLowerCase()} and offering to answer questions.\n` +
      `Keep everything specific to ${name}'s actual products/services and consistent within each lead.`,
    4000,
    FAST_MODEL
  );
}

/* ---- Quality Management dashboard (5th) -----------------------------------
   The model generates only the compact re-skinnable content (KPI values, agent
   names/rows, weekly stacks); the engine composes the fixed chart scaffolding
   and deterministic daily points, so the long daily arrays are reliable. */
function qmDays(barBase: number, barAmp: number, lineBase: number, lineAmp: number, withLine: boolean) {
  const pts: { label: string; bar: number; line?: number }[] = [];
  for (let i = 0; i < 34; i++) {
    const m = i < 31 ? 1 : 2;
    const day = i < 31 ? i + 1 : i - 30;
    const label = `${String(m).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
    const bar = Math.round(barBase + barAmp * Math.sin(i * 0.9) + (i % 5) * 1.2);
    const p: { label: string; bar: number; line?: number } = { label, bar };
    if (withLine) p.line = Math.round(lineBase + lineAmp * Math.sin(i * 0.7 + 1) + (i % 4) * 1.1);
    pts.push(p);
  }
  return pts;
}
const QmAgentRow = z.object({
  agent: z.string(),
  score: z.number(),      // scorecard average %
  conv: z.number(),       // conversion %
  revenue: z.string(),    // "$1,802"
  callCount: z.string(),  // "28"
});
const QmGen = z.object({
  conversionNoun: z.string(),        // the conversion event, Title Case, e.g. "Consultation Booked"
  salesOppCallCount: z.string(),
  salesOppBuyingIntent: z.string(),
  salesConvCount: z.string(),
  salesConvRevenue: z.string(),
  greetingPct: z.string(),
  askedForSalePct: z.string(),
  infoGatheringPct: z.string(),
  callEtiquettePct: z.string(),
  newCustomerSalesPct: z.string(),
  lostAgents: z.array(z.object({ name: z.string(), value: z.number() })), // 5, small ints (1–5)
  weeklyAgents: z.array(z.object({ name: z.string(), values: z.array(z.number()) })), // 4 agents × 5 weeks
  bottomRows: z.array(QmAgentRow), // 5–6, low scores (~40–42%)
  topRows: z.array(QmAgentRow),    // 5–6, higher scores (~46–49%)
});
function composeQm(g: z.infer<typeof QmGen>): z.infer<typeof QualityManagementView> {
  const convCount = `${g.conversionNoun} (Count)`;
  const convPct = `${g.conversionNoun} (Percent)`;
  const scoreCol = "New Customer Sales Combination Scorecard (Average)";
  const cols = ["Agent", scoreCol, convPct, "Total Revenue (Sale Amount)", "Call Count"];
  const mkBars = (rows: z.infer<typeof QmAgentRow>[]) => ({
    legend: "New Customer Sales Combination Scorecard", axisMax: 50, axisTicks: [0, 10, 20, 30, 40, 50], axisSuffix: "%",
    bars: rows.map((r) => ({ name: r.agent, value: r.score, display: `${r.score}%` })),
  });
  const mkTable = (rows: z.infer<typeof QmAgentRow>[]) => ({
    columns: cols,
    rows: rows.map((r) => ({ cells: [r.agent, `${r.score}%`, `${r.conv}%`, r.revenue, r.callCount] })),
  });
  const lostMax = Math.max(5, ...g.lostAgents.map((a) => a.value));
  return {
    title: "QM | Actionable Insights Dashboard",
    dateRange: "1/1/2025-2/28/2025",
    salesOpportunities: { title: "Sales Opportunities", chips: ["Answered by Agent: Yes"], tiles: [{ label: "Call Count", value: g.salesOppCallCount }, { label: "Buying Intent (Industry) (Count)", value: g.salesOppBuyingIntent }] },
    salesConversions: { title: "Sales Conversions", chips: ["2 Filters"], tiles: [{ label: convCount, value: g.salesConvCount }, { label: "Total Revenue (Sale Amount)", value: g.salesConvRevenue }] },
    callsNeedingReview: { title: "Calls Needing Review - Lost Sales Opportunities", chips: ["5 Filters"], chart: { legend: "New Customer Sales Fail (Range & Count)", axisMax: lostMax, axisTicks: Array.from({ length: lostMax + 1 }, (_, i) => i), axisSuffix: "", bars: g.lostAgents.map((a) => ({ name: a.name, value: a.value, display: String(a.value) })) } },
    highestConvertingAgents: { yLabel: convCount, xLabels: ["Dec 29-Jan 4", "Jan 5-11", "Jan 12-18", "Jan 19-25", "Jan 26-Feb 1", "Feb 2-8", "Feb 9-15", "Feb 16-22", "Feb 23-Mar 1"], series: g.weeklyAgents.map((a) => ({ name: a.name, values: a.values })) },
    baselineSkills: { title: "Baseline Skills", chips: [], tiles: [{ label: "Proper Greeting (Scorecard) (Percent)", value: g.greetingPct }, { label: "Asked for the Sale (Scorecard) (Percent)", value: g.askedForSalePct }] },
    scoredCalls: { title: "Scored Calls", chips: [], tiles: [{ label: "Information Gathering (Average)", value: g.infoGatheringPct }, { label: "Call Etiquette (Average)", value: g.callEtiquettePct }, { label: "New Customer Sales (Average)", value: g.newCustomerSalesPct }] },
    baselineQualityScore: { title: "Baseline Sales Quality Score", cadence: "Daily", barLabel: scoreCol, average: 45, yMax: 75, yTicks: [0, 25, 50, 75], suffix: "%", points: qmDays(44, 6, 0, 0, false) },
    bottomByAgentBar: { title: "Bottom Quality Scores by Agent", chips: ["New Customer Sales Combination Scorecard: Applied"], chart: mkBars(g.bottomRows), pager: "1 - 6 of 30" },
    bottomByAgentTable: { title: "Bottom Quality Scores by Agent", chips: ["New Customer Sales Combination Scorecard: Applied"], table: mkTable(g.bottomRows) },
    topByAgentBar: { title: "Top Quality Scores by Agent", chips: [], chart: mkBars(g.topRows), pager: "1 - 6 of 30" },
    qualityByAgentTable: { title: "Quality Scores by Agent", chips: [], table: mkTable(g.topRows) },
    trendingToConversion: { title: "Trending Sales Quality Score to Conversion", cadence: "Daily", barLabel: scoreCol, lineLabel: convCount, yMax: 60, yTicks: [0, 20, 40, 60], suffix: "%", rightLabel: convCount, rightMax: 60, rightTicks: [0, 15, 30, 45, 60], points: qmDays(44, 6, 32, 10, true) },
    trendingToRevenue: { title: "Trending Sales Quality Score to Revenue", cadence: "Daily", barLabel: scoreCol, lineLabel: "Total Revenue (Sale Amount)", yMax: 60, yTicks: [0, 20, 40, 60], suffix: "%", rightLabel: "Total Revenue (Sale Amount)", rightMax: 6000, rightTicks: [0, 2000, 4000, 6000], rightPrefix: "$", points: qmDays(44, 6, 3200, 1100, true) },
  };
}
async function generateQualityManagement(client: Anthropic, name: string, brief: string, bookingTerm: string): Promise<z.infer<typeof QualityManagementView>> {
  const g = await structured<z.infer<typeof QmGen>>(
    client,
    QmGen,
    `Using this business brief, produce compact data for the Invoca "QM | Actionable Insights Dashboard" (a QA/scorecard dashboard) for ${name}.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n\n` +
      `- conversionNoun: the business's conversion event in Title Case, consistent with the booking term "${bookingTerm}" (e.g. "${bookingTerm} Booked").\n` +
      `- salesOppCallCount (like "4,526"), salesOppBuyingIntent (like "1,802"), salesConvCount (like "1,403"), salesConvRevenue (like "$95,945").\n` +
      `- greetingPct "95%", askedForSalePct "47%", infoGatheringPct "38.28%", callEtiquettePct "96.64%", newCustomerSalesPct "76.42%" (use realistic but similar values).\n` +
      `- lostAgents: EXACTLY 5 { name (a plausible agent full name), value (small int 1–5) }.\n` +
      `- weeklyAgents: EXACTLY 5 { name (agent), values (EXACTLY 9 small ints, one per week, trending UP toward the last week) }.\n` +
      `- bottomRows: EXACTLY 5 { agent, score (~40–42, one decimal), conv (int %), revenue (like "$1,802"), callCount (like "28") } — the LOWEST scoring agents.\n` +
      `- topRows: EXACTLY 5 { agent, score (~46–49), conv (int %), revenue, callCount } — the HIGHEST scoring agents.\n` +
      `Use realistic agent names; keep everything specific to ${name}. Do NOT include daily time-series arrays.`,
    3500,
    FAST_MODEL
  );
  return composeQm(g);
}

/* ---- QM Instant Insights dashboard (6th) ----------------------------------
   QA/contact-center metrics are generic across verticals, so the model just
   supplies realistic values + evaluator names; the engine composes the cards,
   table, and the two trend charts (deterministic points). */
const QmInstantGen = z.object({
  callCount: z.string(),
  avgHandleTime: z.string(),   // "1:29"
  notAnswered: z.string(),
  negSentiment: z.string(),
  callerTalkPct: z.string(),
  agentTalkPct: z.string(),
  avgOvertalk: z.string(),     // "0:00"
  silencePct: z.string(),
  qaEvalAvg: z.string(),
  introAvg: z.string(),
  phoneEtiquetteAvg: z.string(),
  problemResolutionAvg: z.string(),
  evaluators: z.array(z.object({ name: z.string(), count: z.string(), intro: z.string(), phone: z.string(), problem: z.string() })), // 3
});
function composeQmInstant(g: z.infer<typeof QmInstantGen>): z.infer<typeof QmInstantInsightsView> {
  return {
    title: "QM | Instant Insights Dashboard",
    dateRange: "1/1/2025-2/28/2025",
    trendingEssentialMetrics: {
      title: "Trending Essential Metrics", cadence: "Daily", barLabel: "Negative Sentiment (Percent)", lineLabel: "Average Agent Handle Time",
      linePrimary: true, yMin: 78, yMax: 105, yTicks: [80, 88, 96, 104], suffix: "", tickLabels: ["1:20", "1:28", "1:36", "1:44"],
      rightLabel: "Negative Sentiment (Percent)", rightMax: 120, rightTicks: [0, 40, 80, 120], rightSuffix: "%",
      points: (() => { const p = qmDays(4, 2, 90, 6, true); p[12].line = 101; p[12].bar = 50; return p; })(),
    },
    essentialMetrics: { title: "Essential Metrics", chips: [], tiles: [{ label: "Call Count", value: g.callCount }, { label: "Average Agent Handle Time", value: g.avgHandleTime }, { label: "Not Answered by Agent (Count)", value: g.notAnswered }, { label: "Negative Sentiment (Count)", value: g.negSentiment }] },
    trendingAnswerRate: {
      title: "Trending Answer Rate", cadence: "Daily", lineLabel: "Answered by Agent (Percent)",
      linePrimary: true, yMin: 65, yMax: 100, yTicks: [65, 70, 75, 80, 85, 90, 95, 100], suffix: "%",
      points: qmDays(0, 0, 79, 7, true).map((p) => ({ label: p.label, line: p.line })),
    },
    contactCenterMetrics: { title: "Contact Center Metrics", chips: [], tiles: [{ label: "Caller Talk Time %", value: g.callerTalkPct }, { label: "Agent Talk Time %", value: g.agentTalkPct }, { label: "Average Overtalk Time", value: g.avgOvertalk }, { label: "Silence Time %", value: g.silencePct }] },
    overallEvaluationScore: { title: "Overall Evaluation Score", chips: [], tiles: [{ label: "QA Evaluation Form (Average)", value: g.qaEvalAvg }] },
    evaluationRollup: { title: "Evaluation Rollup", chips: [], tiles: [{ label: "Introduction (Average)", value: g.introAvg }, { label: "Phone Etiquette (Average)", value: g.phoneEtiquetteAvg }, { label: "Problem Resolution (Average)", value: g.problemResolutionAvg }] },
    scoredCallsByEvaluator: { title: "Scored Calls by Evaluator", chips: [], table: { columns: ["Evaluated By", "Evaluated (Count)", "Introduction (Average)", "Phone Etiquette (Average)", "Problem Resolution (Average)"], rows: g.evaluators.map((e) => ({ cells: [e.name, e.count, e.intro, e.phone, e.problem] })) } },
  };
}
async function generateQmInstantInsights(client: Anthropic, name: string, brief: string): Promise<z.infer<typeof QmInstantInsightsView>> {
  const g = await structured<z.infer<typeof QmInstantGen>>(
    client,
    QmInstantGen,
    `Produce compact data for the Invoca "QM | Instant Insights Dashboard" (a QA at-a-glance dashboard) for ${name}. These are generic contact-center QA metrics — supply realistic values.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `- callCount (like "5,651"), avgHandleTime (mm:ss like "1:29"), notAnswered (like "199"), negSentiment (like "342").\n` +
      `- callerTalkPct "32%", agentTalkPct "59%", avgOvertalk "0:00", silencePct "9%" (realistic, similar).\n` +
      `- qaEvalAvg (like "73%"), introAvg (like "76.67%"), phoneEtiquetteAvg (like "78.8%"), problemResolutionAvg (like "50.67%").\n` +
      `- evaluators: EXACTLY 3 { name (a QA evaluator full name), count (like "3"), intro, phone, problem (percentages like "83.33%") }.\n` +
      `Keep values realistic; vary them a little from the examples.`,
    1500,
    FAST_MODEL
  );
  return composeQmInstant(g);
}

/* The animated "live call routing" leave-behind: the AI voice agent qualifies a
   caller turn-by-turn and routes to the winning team (always queues[0]). */
function generateVoiceRoutingDemo(client: Anthropic, name: string, brandDomain: string, brief: string, bookingTerm: string) {
  return structured<z.infer<typeof VoiceRoutingDemo>>(
    client,
    VoiceRoutingDemo,
    `Using this business brief, produce data for the Invoca "AI Voice Agent — Live Call Routing" demo for ${name}: an animated inbound call where the AI qualifies the caller and routes them to the right team.\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n\n` +
      `- brandName "${name}". brandDomain "www.${brandDomain}". brandIcon: a SINGLE emoji that fits this business.\n` +
      `- callerPhone like "+1 (805) 555-0142". callerLocation "City, ST" (a realistic city in this business's service area).\n` +
      `- idBadge "New Visitor".\n` +
      `- attribution: EXACTLY 6 {label, value, highlight?} rows: Source ("Google"), Medium ("Paid Search"), Campaign (realistic for THIS business), Keyword (a real customer search, highlight:true), Calling Page (a path on the site, highlight:true), Device ("Mobile - iOS").\n` +
      `- visitorHistory: EXACTLY 3 {label, value, highlight?} rows: Pages Viewed (2 product/service names, highlight:true), Quote Started ("Yes - not submitted", highlight:true), Location (same city).\n` +
      `- queues: EXACTLY 3 {id, name}. id = short snake_case. queues[0] is the WINNING route and MUST be the high-value new-business path toward a ${bookingTerm.toLowerCase()} (e.g. name "${bookingTerm} - New Project"). queues[1] and [2] are other realistic routes for THIS business (e.g. existing-order/support, general support).\n` +
      `- convo: EXACTLY 5 turns, alternating starting with agent (agent, caller, agent, caller, agent). Each { role: "agent"|"caller", text (natural spoken phone language, re-skinned to THIS business; the agent qualifies toward booking a ${bookingTerm.toLowerCase()} and the LAST agent turn routes the caller to queues[0]'s team), sigs (array; agent turns usually [] , caller turns 2–3 { c, t }), q (an array of EXACTLY 3 percentages, positionally aligned to the queues array, summing ~100) }.\n` +
      `  • sigs: c is one of "green" | "blue" | "orange" | "purple"; t is a SHORT phrase that MAY wrap a key term in <strong>…</strong> (e.g. "<strong>New project</strong> - custom install"). Ground them in what the caller just said (product interest, quantity/scope, urgency, confirmed service area).\n` +
      `  • q: probabilities must trend so queues[0] climbs to ~95–96 by the final turn while the others fall.\n` +
      `- routedSubtitle "AI Agent qualified caller intent and matched to the right team".\n` +
      `Keep everything specific to ${name}'s actual products/services.`,
    5000,
    FAST_MODEL
  );
}

function generateAgentConfig(client: Anthropic, name: string, _brandDomain: string, brief: string, bookingTerm: string) {
  return structured<z.infer<typeof AgentConfigView>>(
    client,
    AgentConfigView,
    `Using this business brief, produce the Invoca Agent Studio configuration for ${name}'s AI agent (a scheduling/intake assistant that answers questions and books the business's ${bookingTerm.toLowerCase()}).\n\n` +
      `BRIEF:\n${brief}\n\n` +
      `${reskin(name)}\n\n` +
      `- brandConversationRules: exactly 3 rules, each ONE string of 1–2 sentences, each starting with a short label + colon. They describe how the AI SMS agent runs a qualify-then-book conversation (NO emojis). Make them specific to THIS business:\n` +
      `  1) Intro + offer: introduce yourself as ${name}'s AI agent helping with a personalized quote, mention a plausible current offer/incentive if one fits, and ask if they'd like to get started.\n` +
      `  2) Qualify one question at a time: list the 4–5 key qualifying questions for THIS business (quantity, sizes/measurements, material/type/model, timeline, and ZIP code to confirm service availability).\n` +
      `  3) Estimate then book: confirm you service their ZIP, give a preliminary price RANGE based on what they shared, recommend a consultation with a specialist for an exact quote, propose a specific day/time, and confirm they'll get a reminder text before the appointment with a number to call.\n` +
      `- knowledgeSources: exactly 5 items the agent "learned" the business from:\n` +
      `  • 1 Document named "${name.replace(/[^A-Za-z0-9]+/g, "_")}_Sales_Playbook.pdf", type "Document", lastUpdated "03/11/2026 10:21 AM".\n` +
      `  • 4 Web Links to THIS business's MAIN pages, type "Web Link", lastUpdated "03/11/2026 10:02 AM". Each "name" MUST be a SHORT human-readable page label (e.g. "Homepage", "Services & Specialties", "Locations", "Find a Provider", "Book an Appointment") specific to ${name} — NOT a raw URL.\n` +
      `- aiRecommendations: exactly 2 AI Q&A recommendation cards built from call transcripts:\n` +
      `  1) title "Qa pairs - 2026-03-11 13:12", updated "07/09/2026 3:29 PM", enabled true. payload = a JSON STRING of the form {"task_data_type":"application/json","EXISTING_CUSTOMER":[{"topic":"...","question":"...","answer":"..."}, ...]} with 2 realistic existing-customer Q&A pairs for THIS business (e.g. warranty/order status/reschedule), answers 1–2 sentences. ALSO include qaPairs: exactly 20 {question, answer} pairs = the most common customer questions from call transcripts for THIS business, each answer 1–2 sentences, on-brand, steering toward booking the consultation/appointment and never quoting exact pricing.\n` +
      `  2) title "Intent follow up - 2026-03-11 13:12", updated "07/09/2026 3:29 PM", enabled false. payload = a JSON STRING of the form {"task_data_type":"application/json","NEW_CUSTOMER":[{"intent":"...","follow_up_message":"..."}, ...]} with 2 realistic new-customer intents (e.g. schedule the booking, request a quote) whose follow_up_message confirms/advances toward the booking.\n` +
      `- smsPlaybook: the plan for the LIVE SMS agent conversation, chosen by SMART JUDGMENT from what THIS business actually does (use the brief above):\n` +
      `  • bookingType: the single most fitting thing this business would schedule with a new customer, INCLUDING modality — and it MUST be consistent with the platform booking term "${bookingTerm}" (you may add modality, e.g. if the term is "${bookingTerm}" use something like "virtual ${bookingTerm.toLowerCase()}" or "in-home ${bookingTerm.toLowerCase()}"). Examples of the shape: "virtual consultation", "in-home estimate", "showroom tour", "test drive", "service appointment".\n` +
      `  • providesEstimate: true ONLY if this business would realistically give a rough PRICE/ESTIMATE over text (quote-based trades: blinds, remodeling, roofing, HVAC, auto repair, movers). false for businesses that just book a visit/tour/appointment with no upfront pricing (gyms, salons/spas, dealerships booking a test drive, real estate tours, medical/dental).\n` +
      `  • offer: a plausible current incentive to book now (e.g. "Save 10% when you book today") ONLY if it fits this business; otherwise "".\n` +
      `  • goal: one sentence for what the conversation drives toward for THIS business.\n` +
      `  • qualifyingQuestions: 4–6 ordered, business-specific questions the agent asks ONE at a time to qualify the customer; end with asking for their ZIP code / location to confirm service availability where relevant.\n` +
      `- serviceArea: if ${name} is a LOCAL / in-home / regional service business with a limited geographic area, a short phrase naming that serviceable area including a ZIP hint (e.g. "the greater Austin, Texas area — ZIP codes starting with 787"). If ${name} serves nationally or is online/e-commerce with no geographic limit, set this to an EMPTY string "".\n` +
      `Keep everything realistic and specific to ${name}'s actual products/services.`,
    10000
  );
}

/* ---- Public entry point --------------------------------------------------- */
export async function generateProfile(
  name: string,
  url: string,
  opts: { apiKey?: string; onProgress?: Progress } = {}
): Promise<z.infer<typeof CustomerProfile>> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const progress = opts.onProgress ?? (() => {});
  // maxRetries lets the SDK back off + retry 429/529 ("overloaded") automatically —
  // important now that the post-report phases fire concurrently (see below).
  const client = new Anthropic({ apiKey, maxRetries: 4 });

  const slug = slugify(name);
  const brandDomain = domainOf(url);

  progress({ phase: "research", status: "start" });
  const brief = await research(client, name, url);
  progress({ phase: "research", status: "done" });
  progress({ phase: "terms", status: "start" });
  const terms = await generateTerms(client, name, brief);
  progress({ phase: "terms", status: "done" });
  const bookingTerm = terms.bookingTerm;
  const customerNoun = terms.customerNoun;
  const qualifiedCallTerm = terms.qualifiedCallTerm;
  const conversionTerm = terms.conversionTerm;
  /* Everything after the terms call depends ONLY on the brief + the 4 canonical terms
     (not on each other), so the 15 remaining phases — INCLUDING the heavy Digital
     Insights table (nothing reads it until final assembly) — run through a
     CONCURRENCY-LIMITED POOL, ordered LONGEST-PROCESSING-TIME FIRST so a heavy phase
     never starts late and tails the makespan. CONCURRENCY=6 fits the ~6 Opus phases in
     the first wave; the client's maxRetries + a small per-phase start jitter keep
     429/529 bursts down. `phase` retries ONCE on ANY rejection (rescues a one-off
     malformed-JSON/Zod failure) and logs each phase's wall-clock. */
  const CONCURRENCY = 6;
  const phase = <T,>(label: string, run: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    progress({ phase: label, status: "start" });
    const done = (r: T): T => {
      console.log(`[phase] ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      progress({ phase: label, status: "done" });
      return r;
    };
    const retry = (e: any): Promise<T> => {
      console.log(`[phase] ${label} retry after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${e?.message ?? e}`);
      progress({ phase: label, status: "start" });
      return run().then(done);
    };
    // small random stagger so the pool workers don't all hit the API in the same instant
    return new Promise<void>((res) => setTimeout(res, Math.floor(Math.random() * 350))).then(run).then(done, retry);
  };

  const [
    dashboard, agentConfig, callReview, digitalInsights, conversationIntelligence,
    opsDashboard, callDetail, voiceConversationIntelligence, smsConversationIntelligence, aiAgentConversion,
    qualityManagement, voiceRoutingDemo, screenpops, aiMessagingImpact, qmInstantInsights,
  ] = await runPool([
    () => phase("dashboard", () => generateDashboard(client, name, brief, bookingTerm, qualifiedCallTerm, conversionTerm)),
    () => phase("agentConfig", () => generateAgentConfig(client, name, brandDomain, brief, bookingTerm)),
    () => phase("callReview", () => generateCallReview(client, name, brief, bookingTerm)),
    () => phase("digitalInsights", () => generateDigitalInsights(client, name, brandDomain, brief, bookingTerm)),
    () => phase("conversationIntelligence", () => generateConversationIntelligence(client, name, brief, bookingTerm, customerNoun)),
    () => phase("opsDashboard", () => generateOpsDashboard(client, name, brief, bookingTerm, customerNoun)),
    () => phase("callDetail", () => generateCallDetail(client, name, brief, bookingTerm)),
    () => phase("voiceConversationIntelligence", () => generateVoiceConversationIntelligence(client, name, brief, bookingTerm, customerNoun)),
    () => phase("smsConversationIntelligence", () => generateSmsConversationIntelligence(client, name, brief, bookingTerm, customerNoun)),
    () => phase("aiAgentConversion", () => generateAiAgentConversionDashboard(client, name, brief, bookingTerm, customerNoun, qualifiedCallTerm, conversionTerm)),
    () => phase("qualityManagement", () => generateQualityManagement(client, name, brief, bookingTerm)),
    () => phase("voiceRoutingDemo", () => generateVoiceRoutingDemo(client, name, brandDomain, brief, bookingTerm)),
    () => phase("screenpops", () => generateScreenpops(client, name, brief, bookingTerm, customerNoun)),
    () => phase("aiMessagingImpact", () => generateAiMessagingImpact(client, name, brief, bookingTerm, customerNoun)),
    () => phase("qmInstantInsights", () => generateQmInstantInsights(client, name, brief)),
  ], CONCURRENCY);

  /* Gumloop leave-behinds → clickable rows in My Reports. All three are rendered
     from the data above (src/artifacts), so every prospect gets them complete. */
  const artStamp = new Date()
    .toLocaleString("en-US", { month: "numeric", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit", hour12: true })
    .replace(",", "")
    .toLowerCase();
  const gumloopArtifacts = [
    { id: "voice-screenpop", name: "Voice Screenpop", status: "complete" as const, createdAt: artStamp },
    { id: "sms-screenpop", name: "SMS Screenpop", status: "complete" as const, createdAt: artStamp },
    { id: "voice-routing-demo", name: "Voice Routing Demo", status: "complete" as const, createdAt: artStamp },
  ];

  const profile = {
    id: slug,
    customerName: name,
    websiteUrl: url,
    brandDomain,
    networkName: terms.networkName,
    industry: terms.industry,
    bookingTerm,
    customerNoun,
    reports: { digitalInsights, marketingDashboard: dashboard, callReview, callDetail, opsDashboard, aiAgentConversion, aiMessagingImpact, qualityManagement, qmInstantInsights, conversationIntelligence, smsConversationIntelligence, voiceConversationIntelligence, agentConfig, voiceScreenpop: screenpops.voiceScreenpop, smsScreenpop: screenpops.smsScreenpop, voiceRoutingDemo, gumloopArtifacts },
  };
  // Final guardrail: validate against the canonical schema.
  return CustomerProfile.parse(profile);
}
