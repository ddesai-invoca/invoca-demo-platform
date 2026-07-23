/* =============================================================================
   schema.ts — THE CANONICAL CUSTOMER PROFILE
   -----------------------------------------------------------------------------
   One Zod schema is the single source of truth for a demo customer. Every
   screen reads a *view* of this object, and the AI generation engine emits
   data validated against it — so a customer's data is consistent everywhere.

   Zod gives us BOTH:
     • runtime validation (guard AI-generated data before it hits a screen)
     • static TS types (derived below — no duplicate type definitions)

   As we add screens, extend `reports` (and add shared primitives) here. The
   compiler will then flag every screen that needs updating.
   ============================================================================= */

import { z } from "zod";

/* ---- Shared primitives ---------------------------------------------------- */
export const ChartPoint = z.object({
  date: z.string(), // e.g. "01/19"
  value: z.number(),
});

/* A signal column in the report — an Invoca "Signal" (Rule / Keyword Spotting
   detection) shown as a green check / gray cancel per call. The trailing
   columns of the Digital Journey & Call Attribution Report are these signals. */
export const SignalColumn = z.object({
  label: z.string(),                // "Answered by Agent"
  badges: z.array(z.string()),      // ["Rule"] | ["Keyword Spotting","Rule"]
});

/* One interaction row in the Digital Journey & Call Attribution report.
   `signals` is aligned positionally to DigitalInsightsReport.signalColumns. */
export const InteractionRow = z.object({
  marketingSource: z.string(),      // Organic | Paid Search | Social Media | ...
  marketingMedium: z.string(),      // Instagram | cpc | Bing | Organic | ...
  marketingCampaign: z.string(),
  marketingSearchTerm: z.string(),  // "—" when not applicable
  landingPageUrl: z.string(),
  websiteJourney: z.string(),       // "Home / Category / Subcategory"
  signals: z.array(z.boolean()),    // one per signalColumns entry (true = detected)
});

/* ---- Screen views --------------------------------------------------------- */
export const DigitalInsightsReport = z.object({
  title: z.string(),
  dateRange: z.string(),            // "Jan 19, 2026 - Jan 24, 2026"
  filterLabel: z.string(),          // "Marketing Source: 3 selected"
  chartLegend: z.string(),          // "Total Interactions"
  yMax: z.number(),
  yTicks: z.array(z.number()),
  chart: z.array(ChartPoint),
  dimensionColumns: z.array(z.string()),  // leading text columns (after the Details icon)
  signalColumns: z.array(SignalColumn),   // trailing signal columns (check / cancel)
  rows: z.array(InteractionRow),
});

/* ---- Marketing Performance Dashboard view --------------------------------- */
export const KpiTile = z.object({
  label: z.string(),   // "Call Count", "Sales Call (Percent)"
  value: z.string(),   // "628", "84%", "$945,910" — string preserves formatting
});
export const KpiGroup = z.object({
  title: z.string(),               // "Call Performance Summary"
  tiles: z.array(KpiTile),         // 4 tiles per group
});

/* One breakdown = a donut + its "Call Outcome Summary" table. The donut % is
   derived from each row's first metric (Call Count) share, so a single rows
   array drives both visuals. */
export const BreakdownRow = z.object({
  name: z.string(),                // "Paid Search", "cpc", "The Privacy Project"
  metrics: z.array(z.string()),    // aligned to metricColumns, e.g. ["361","67%","49%","$759,620"]
});
export const Breakdown = z.object({
  title: z.string(),               // "Calls by Source"
  tableTitle: z.string(),          // "Source: Call Outcome Summary"
  dimensionColumn: z.string(),     // "Marketing Source"
  metricColumns: z.array(z.string()), // ["Call Count","Quote Discussed (Percent)","Purchase (Percent)","Total Revenue (Sale Amount)"]
  hasDonut: z.boolean(),           // false for table-only breakdowns
  donutTotal: z.number().optional(), // donut %-label denominator (share of grand total incl. a long tail); defaults to sum of shown rows
  rows: z.array(BreakdownRow),
});

/* Multi-series chart used for both the Sales Call Breakout line graph and the
   Conversions by Product Category stacked bar graph. Series render in order
   using the shared chart palette. */
export const ChartSeries = z.object({
  name: z.string(),                // "Sales Call (Count)" / "Shutters"
  values: z.array(z.number()),     // one per xLabel
});
export const MultiSeriesChart = z.object({
  yLabel: z.string(),              // "Sales Call (Count)" / "Purchase (Count)"
  xLabels: z.array(z.string()),    // ["01/19", ... "01/24"]
  series: z.array(ChartSeries),
});

export const DashboardView = z.object({
  title: z.string(),               // "Marketing Performance Dashboard (Shady Blinds)"
  dateRange: z.string(),           // "1/19/2026-1/24/2026"
  kpiGroups: z.array(KpiGroup),    // [0]=Call Performance, [1]=Non-Sales, [2]=Sales Call Breakout Metrics (2x2)
  salesCallBreakoutGraph: MultiSeriesChart, // line chart beside the 2x2 breakout metrics
  breakdowns: z.array(Breakdown),  // donut+table pairs; the Product Category one has hasDonut:false (table only)
  productCategoryGraph: MultiSeriesChart,   // stacked bar chart beside the Product Category table
});

/* ---- Call Review view ----------------------------------------------------- */
/* One call card in the Call Review list. Mirrors the live console: a score, an
   AI summary, call metadata, and three stats (scorecards applied, comment
   threads, negative-sentiment score). */
export const CallReviewItem = z.object({
  scoreLabel: z.string(),        // "Quality Score"
  score: z.number(),             // 0–100 (rendered as "%")
  summary: z.string(),           // AI call summary
  date: z.string(),              // "Jun 3, 2:42 PM"
  agent: z.string(),             // "Oscar" | "No Agent"
  duration: z.string(),          // "1m 30s"
  scorecards: z.number(),        // # scorecards applied
  comments: z.number(),          // # comment threads
  negativeSentiment: z.number(), // negative-sentiment score
  evaluated: z.boolean(),        // shows the "Evaluated" badge
  converted: z.boolean().optional(), // did the primary conversion signal (the booking) fire on this call — drives the Signals filter
});
export const CallReviewView = z.object({
  shownCount: z.string(),        // "66 Calls"
  totalNote: z.string(),         // "total of 222 calls from Jan 1 to Oct 31"
  scoreDisplay: z.string(),      // "Quality Score"
  sortBy: z.string(),            // "Highest Score"
  dateRange: z.string(),         // "01/01/2025-10/31/2025"
  calls: z.array(CallReviewItem),
  searchSuggestions: z.array(z.string()).optional(), // per-prospect Global Transcript Search demo terms (each present in ≥1 summary)
});

/* ---- Call Detail view -----------------------------------------------------
   The page opened by clicking a call in Call Review. Left rail: review status +
   evaluation + Scorecard (expandable to signal rows) + Signals (expandable to
   Met/Unmet/Not-Applicable) + Prompts; center: transcript; right: AI summary +
   comment. Re-skinned per prospect (a scheduling/intake call). */
export const CallDetailScorecardRow = z.object({
  name: z.string(),              // "(QA) Proper Greeting" / "Capture Full Name"
  points: z.string(),           // "10/10" | "0/10" | "—/—"
  status: z.enum(["met", "unmet", "na"]),
});
export const CallDetailTurn = z.object({
  speaker: z.enum(["agent", "caller"]),
  time: z.string(),             // "00:14"
  text: z.string(),             // "****" for redacted PII
});
export const CallDetailPrompt = z.object({ question: z.string(), answer: z.string() });
export const CallDetailComment = z.object({
  author: z.string(), audience: z.string(), date: z.string(), text: z.string(),
});
export const CallDetailView = z.object({
  callId: z.string(),           // "0597-627F62F2570D"
  agent: z.string(),            // "Marcus Bell"
  date: z.string(),             // "Aug 11, 2:48 AM"
  duration: z.string(),         // "4m 12s"
  scorecardName: z.string(),    // "BASE SKILLS"
  scorecardPercent: z.number(), // 78
  scorecardPoints: z.string(),  // "70/90 Points"
  scorecardRows: z.array(CallDetailScorecardRow),
  signalsMet: z.number(),       // 13
  signalsUnmet: z.number(),     // 26
  signalsNa: z.number(),        // 25
  metSignals: z.array(z.string()),
  unmetSignals: z.array(z.string()),
  naSignals: z.array(z.string()),
  prompts: z.array(CallDetailPrompt),
  convStart: z.string(),        // "00:16"
  transcript: z.array(CallDetailTurn),
  aiSummary: z.string(),
  comment: CallDetailComment.optional(),
});

/* ---- Marketing & Operations Performance dashboard (2nd dashboard) --------- */
/* Horizontal bar chart: one metric across categories. `display` is the label
   drawn in the bar ("55%" or "1,880"); `value` drives the bar length. */
export const OpsBar = z.object({ name: z.string(), value: z.number(), display: z.string() });
export const OpsBarChart = z.object({
  legend: z.string(),              // "Appointment: Scheduled (Percent)" / "Call Count"
  axisMax: z.number(),
  axisTicks: z.array(z.number()),
  axisSuffix: z.string(),          // "%" or "" (counts)
  bars: z.array(OpsBar),
});
/* Generic table (header row + string cells) for the ops dashboard. */
export const OpsTable = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.object({ cells: z.array(z.string()) })),
});
/* A "MARKETING: X" row = a bar chart (left) + a table (right). */
export const OpsMarketingSection = z.object({
  chartTitle: z.string(),
  chart: OpsBarChart,
  tableTitle: z.string(),
  table: OpsTable,
});
export const OpsDashboardView = z.object({
  title: z.string(),               // "Marketing and Operations Performance with Revenue"
  dateRange: z.string(),           // "8/11/2025-8/16/2025"
  kpiGroups: z.array(KpiGroup),    // [Marketing Driven Calls, New Customer Acquisition, Existing Customers & Rescheduling]
  marketingSections: z.array(OpsMarketingSection), // Source / Medium / Campaign / Search Terms
  webpagesTitle: z.string(),       // "Webpages driving New Customers"
  webpages: OpsTable,
  locationTitle: z.string(),       // "Location Call Handling"
  locationHandling: OpsTable,
  noBookingChart: MultiSeriesChart, // "Top Reasons for No Booking" stacked bar
});

/* ---- AI Agent Conversion dashboard (3rd dashboard) -----------------------
   Shows how AI-agent interactions convert. A summary tile group, six small
   "conversion" cards (Lead Form + Voice Agent, each with filter chips + 2 tiles),
   four donut+table breakdowns (Source/Medium/Campaign/Search Term), and a
   product-category table + stacked bar. Reuses KpiGroup/Breakdown/MultiSeriesChart. */
export const ConversionCard = z.object({
  title: z.string(),               // "LEAD FORM (Conversions): Live Agent"
  chips: z.array(z.string()),      // ["Interaction Type: Form Fill","SMS Engaged: No","Live Agent Call: Yes"]
  tiles: z.array(KpiTile),         // [Job Complete (Percent), Total Revenue (Sale Amount)]
});
export const AiAgentConversionView = z.object({
  title: z.string(),               // "AI Agent Conversion Dashboard"
  dateRange: z.string(),           // "1/19/2026-1/24/2026"
  summary: KpiGroup,               // "AI Agent Performance Summary" (4 tiles)
  conversionCards: z.array(ConversionCard), // 6 cards (3 Lead Form + 3 Voice Agent)
  breakdowns: z.array(Breakdown),  // Source/Medium/Campaign/Search Term (hasDonut) + Product Category (table-only)
  productCategoryGraph: MultiSeriesChart,   // stacked bar beside the Product Category table
});

/* ---- AI Messaging Impact dashboard (4th dashboard) -----------------------
   Human-vs-AI story: paired KPI cards (AI This Month vs Human Last Month) for
   lead engagement + appointment performance, an AI-assisted appointment trend
   line, AI opportunity/nurture tiles, and a "Common Topics" stacked bar.
   A KPI card = a title, an optional grey chip, and 3–4 tiles. */
export const AimKpiCard = z.object({
  title: z.string(),               // "AI Agent Lead Engagement (This Month)"
  chip: z.string().optional(),     // "Last Month" | "AI-Assisted Conversions"
  tiles: z.array(KpiTile),         // 3–4 tiles
});
export const AiMessagingImpactView = z.object({
  title: z.string(),               // "AI Messaging Impact on Lead Capture & Revenue (Human vs AI)"
  dateRange: z.string(),           // "This Month" (first toolbar pill)
  aiLeadEngagement: AimKpiCard,
  aiAppointmentPerformance: AimKpiCard,
  humanLeadEngagement: AimKpiCard,        // chip "Last Month"
  humanAppointmentPerformance: AimKpiCard, // chip "Last Month"
  trendTitle: z.string(),          // "AI-Assisted Appointment Trend"
  trendChip: z.string(),           // "AI-Assisted Conversions"
  trendChart: MultiSeriesChart,    // single-series line ("Appointment Scheduled")
  aiOpportunities: AimKpiCard,
  aiLeadNurture: AimKpiCard,
  commonTopicsTitle: z.string(),   // "Common Topics"
  commonTopicsChart: MultiSeriesChart,     // stacked bar (topics re-skinned per prospect)
});

/* ---- Quality Management dashboard (5th dashboard) ------------------------
   "QM | Actionable Insights Dashboard": QA/scorecard-oriented. Reuses KpiGroup-
   style cards (ConversionCard, title+chips+tiles), HBarChart (OpsBarChart),
   StackedBarChart (MultiSeriesChart), dash-tables (OpsTable), plus one new chart
   type (BarLineChart): vertical bars with an optional red average line and/or an
   overlaid data line. Re-skinned per prospect. */
export const QmBarPanel = z.object({   // a titled HBar panel (with filter chips)
  title: z.string(),
  chips: z.array(z.string()),
  chart: OpsBarChart,
  pager: z.string().optional(),        // e.g. "1 - 6 of 30" (shown as a footer)
});
export const QmTablePanel = z.object({ // a titled table panel (with filter chips)
  title: z.string(),
  chips: z.array(z.string()),
  table: OpsTable,
});
export const QmBarLinePoint = z.object({
  label: z.string(),               // x label, e.g. "01/19"
  bar: z.number().optional(),      // bar height (omit for line-only charts)
  line: z.number().optional(),     // overlaid line value at this point
});
export const QmBarLine = z.object({
  title: z.string(),
  cadence: z.string(),             // "Daily" | "Weekly"
  barLabel: z.string().optional(), // legend for the bars
  lineLabel: z.string().optional(),// legend for the line
  average: z.number().optional(),  // draws a red dashed average line (Baseline Quality Score)
  yMin: z.number().optional(),     // non-zero axis floor (zoomed charts, e.g. Answer Rate 65–100%)
  yMax: z.number(),
  yTicks: z.array(z.number()),
  suffix: z.string(),              // "%" | "" (used when tickLabels absent)
  tickLabels: z.array(z.string()).optional(), // custom y labels aligned to yTicks (e.g. time "1:20")
  linePrimary: z.boolean().optional(),        // line is the dominant blue series, bars secondary orange
  /* Optional SECOND (right) y-axis the overlaid line is plotted against (dual-axis
     Trending charts: bars=left %, line=right count/revenue). */
  rightLabel: z.string().optional(),
  rightMin: z.number().optional(),
  rightMax: z.number().optional(),
  rightTicks: z.array(z.number()).optional(),
  rightPrefix: z.string().optional(),   // "$"
  rightSuffix: z.string().optional(),
  points: z.array(QmBarLinePoint),
});
export const QualityManagementView = z.object({
  title: z.string(),               // "QM | Actionable Insights Dashboard"
  dateRange: z.string(),           // "1/1/2025-2/28/2025"
  salesOpportunities: ConversionCard,      // chip "Answered by Agent: Yes"; Call Count + Buying Intent (Industry) (Count)
  salesConversions: ConversionCard,        // chip "2 Filters"; New Service Activation (Count) + Total Revenue (Sale Amount)
  callsNeedingReview: QmBarPanel,          // "Calls Needing Review - Lost Sales Opportunities" (HBar by agent)
  highestConvertingAgents: MultiSeriesChart, // stacked bar, weekly, agents stacked
  baselineSkills: ConversionCard,          // Proper Greeting (Scorecard) (Percent) + Asked for the Sale (Scorecard) (Percent)
  scoredCalls: ConversionCard,             // Information Gathering / Call Etiquette / New Customer Sales (Average)
  baselineQualityScore: QmBarLine,         // vertical bars + red average line (Daily)
  bottomByAgentBar: QmBarPanel,            // "Bottom Quality Scores by Agent" (HBar)
  bottomByAgentTable: QmTablePanel,        // "Bottom Quality Scores by Agent" (table)
  topByAgentBar: QmBarPanel,               // "Top Quality Scores by Agent" (HBar)
  qualityByAgentTable: QmTablePanel,       // "Quality Scores by Agent" (table)
  trendingToConversion: QmBarLine,         // bars + orange line (Daily)
  trendingToRevenue: QmBarLine,            // bars + orange line (Daily)
});

/* ---- QM Instant Insights dashboard (6th dashboard) -----------------------
   "QM | Instant Insights Dashboard": QA at-a-glance. Reuses ConversionCard KPI
   cards, QmTablePanel, and BarLineChart (now supports line-primary, a non-zero
   yMin, and custom time y-labels). Re-skinned per prospect. */
export const QmInstantInsightsView = z.object({
  title: z.string(),               // "QM | Instant Insights Dashboard"
  dateRange: z.string(),
  trendingEssentialMetrics: QmBarLine,  // line (Avg Agent Handle Time, blue) + bars (Negative Sentiment, orange); time y-axis
  essentialMetrics: ConversionCard,     // Call Count / Avg Agent Handle Time / Not Answered by Agent / Negative Sentiment
  trendingAnswerRate: QmBarLine,        // line only, zoomed (Answered by Agent %, 65–100)
  contactCenterMetrics: ConversionCard, // Caller Talk % / Agent Talk % / Avg Overtalk / Silence %
  overallEvaluationScore: ConversionCard, // single tile: QA Evaluation Form (Average)
  evaluationRollup: ConversionCard,     // Introduction / Phone Etiquette / Problem Resolution (Average)
  scoredCallsByEvaluator: QmTablePanel, // table: Evaluated By / Evaluated (Count) / 3 skill averages
});

/* ---- Conversation Intelligence (per-call analysis) view ------------------- */
/* The deep-dive on ONE interaction: call list (left), audio player + transcript
   (center), Signals + Call Scoring (right). */
export const CITranscriptTurn = z.object({
  speaker: z.enum(["agent", "caller"]),
  time: z.string(),                          // "0:04"
  text: z.string(),
  highlights: z.array(z.string()),           // phrases to bold+underline (signal keyword matches); [] if none
});
export const CICall = z.object({
  time: z.string(),                          // "8/11/25 12:02 am"
  id: z.string(),                            // "F57B-817F0292530D"
});
/* A met signal in the right rail: a green-check detection with its badges
   (Keyword Spotting / Rule / Keypress) and an optional match count. */
export const CISignal = z.object({
  name: z.string(),                          // "(QA) Proper Close"
  badges: z.array(z.string()),               // ["Keyword Spotting","Rule"]
  count: z.number(),                         // trailing match count; 0 = hide
});
/* AI Summary tab — an AI-generated recap of the selected call. */
export const CIAiSummary = z.object({
  summary: z.string(),                       // 3-4 sentence paragraph recap of the call
  keyPoints: z.array(z.string()),            // 4-6 bullet highlights
  sentiment: z.string(),                     // "Positive" | "Neutral" | "Negative"
  outcome: z.string(),                       // short disposition, e.g. "Consultation booked for Thursday 10 AM"
});
export const ConversationIntelligenceView = z.object({
  title: z.string(),                         // "Conversation intelligence"
  dateRange: z.string(),                     // "Aug 11, 2025 - Aug 16, 2025"
  callCount: z.string(),                     // "5,139 calls"
  pagerLabel: z.string(),                    // "1 of 52"
  calls: z.array(CICall),                    // left-hand call list
  duration: z.string(),                      // "2:22" (selected call length)
  transcript: z.array(CITranscriptTurn),     // selected call transcript
  signals: z.array(CISignal),                // MET SIGNALS (right rail)
  scoreValue: z.number(),                    // 78 (Call Scoring donut)
  scoreLabel: z.string(),                    // "BASE SKILLS"
  aiSummary: CIAiSummary.optional(),          // AI Summary tab content (optional: profiles predating this field still validate)
});

/* ---- AI SMS Conversation Intelligence report ------------------------------
   The SMS sibling of Conversation Intelligence: a list of AI-SMS conversations
   (only the top ones are "active" with a full transcript/signals/metadata; the
   rest are inactive shells). Closing the Preview Agent prepends the SE's just-had
   chat as a new active conversation at the top. */
export const SmsTurn = z.object({
  speaker: z.enum(["consumer", "agent"]),
  time: z.string(),                          // "6:21 AM"
  text: z.string(),
});
/* The "SMS Info" tab metadata cards. Mostly generic telephony/consumer fields;
   a few (city/region, campaign, promo) re-skin per prospect. */
export const SmsInfo = z.object({
  callRecordId: z.string(),
  smsStartTime: z.string(),
  destinationPhone: z.string(),
  totalMessages: z.string(),
  source: z.string(),
  promoNumberDescription: z.string(),
  smsEngaged: z.string(),
  smsOptIn: z.string(),
  smsOptOut: z.string(),
  sessionStatus: z.string(),
  callerId: z.string(),
  repeatCaller: z.string(),
  city: z.string(),
  region: z.string(),
  phoneType: z.string(),
  displayName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  gender: z.string(),
  destinationTimeZone: z.string(),
  finalCampaign: z.string(),
  finalCampaignId: z.string(),
});
export const SmsConversation = z.object({
  id: z.string(),                            // "C516-117FE212560D"
  time: z.string(),                          // "8/16/25 10:55 pm"
  active: z.boolean(),                        // full transcript/signals/info vs. list-only shell
  date: z.string(),                          // "March 10, 2026" divider (active only)
  transcript: z.array(SmsTurn),              // [] for inactive
  signals: z.array(CISignal),                // [] for inactive (Analysis tab)
  smsInfo: SmsInfo.optional(),               // present for active
});
export const SmsConversationIntelligenceView = z.object({
  countLabel: z.string(),                    // "5,139 calls"
  dateRange: z.string(),                     // "Aug 11, 2025 - Aug 16, 2025"
  pagerLabel: z.string(),                    // "1 of 52"
  conversations: z.array(SmsConversation),   // 1 active example + 3 inactive shells
});

/* ---- AI Voice Conversation Intelligence report ----------------------------
   The voice sibling of the SMS report: a list of AI-voice phone calls (top ones
   active with transcript/signals/call metadata; rest inactive shells). Ending a
   Preview-Agent voice call prepends the SE's just-had call as a new active call
   at the top. */
export const VoiceTurn = z.object({
  speaker: z.enum(["consumer", "agent"]),
  time: z.string(),                          // "6:21 AM"
  text: z.string(),
});
/* The "Call Info" tab metadata cards — call-appropriate telephony/consumer fields. */
export const VoiceInfo = z.object({
  callRecordId: z.string(),
  callStartTime: z.string(),
  duration: z.string(),                      // "3:12"
  destinationPhone: z.string(),
  source: z.string(),
  promoNumberDescription: z.string(),
  connectionStatus: z.string(),              // "Connected"
  callerId: z.string(),
  repeatCaller: z.string(),
  city: z.string(),
  region: z.string(),
  phoneType: z.string(),
  displayName: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  gender: z.string(),
  destinationTimeZone: z.string(),
  finalCampaign: z.string(),
  finalCampaignId: z.string(),
});
export const VoiceConversation = z.object({
  id: z.string(),                            // "C516-117FE212560D"
  time: z.string(),                          // "8/16/25 10:55 pm"
  active: z.boolean(),                        // full transcript/signals/info vs. list-only shell
  date: z.string(),                          // "March 10, 2026" divider (active only)
  transcript: z.array(VoiceTurn),            // [] for inactive
  signals: z.array(CISignal),                // [] for inactive (Analysis tab)
  voiceInfo: VoiceInfo.optional(),           // present for active
});
export const VoiceConversationIntelligenceView = z.object({
  countLabel: z.string(),                    // "5,139 calls"
  dateRange: z.string(),                     // "Aug 11, 2025 - Aug 16, 2025"
  pagerLabel: z.string(),                    // "1 of 52"
  conversations: z.array(VoiceConversation), // 1 active example + 3 inactive shells
});

/* ---- Agent Studio: agent configuration (per-agent editor) ----------------- */
/* The agent's "Agent Settings" page. Names derive from the profile (agent &
   brand = customerName, profile = networkName); the business-specific part is
   the Brand Conversation Rules, which the engine generates per prospect. */
/* A knowledge source the agent can reference — a document or a website link the
   agent "learned" the business from. Type drives the row icon + Refresh column. */
export const KnowledgeSource = z.object({
  name: z.string(),                             // "Shady_Blinds_Sales_Playbook.pdf" or a URL
  type: z.enum(["Document", "Web Link"]),
  lastUpdated: z.string(),                       // "03/11/2026 10:21 AM"
});
/* One AI-generated question/answer pair (from call-transcript data). Shown in
   the "Edit AI Generated Q&A" modal opened from the Qa pairs card. */
export const QaPair = z.object({
  question: z.string(),
  answer: z.string(),
});
/* An AI-generated Q&A / intent recommendation card (built from call transcripts).
   `payload` is the JSON blob shown (truncated) in the card; `qaPairs`, when
   present, is the full list opened in the edit modal (the "Qa pairs" card). */
export const AiRecommendation = z.object({
  title: z.string(),                             // "Qa pairs - 2026-03-11 13:12"
  updated: z.string(),                           // "07/09/2026 3:29 PM"
  enabled: z.boolean(),                          // toggle state
  payload: z.string(),                           // JSON preview text
  qaPairs: z.array(QaPair).optional(),           // top ~20 Q&A pairs (Qa pairs card)
});
/* The live SMS-agent conversation plan, chosen per prospect from research so the
   content AND the thing being scheduled fit THIS business (a blinds co. books a
   consultation + quote; a dealership books a test drive; a gym books a tour). */
export const SmsPlaybook = z.object({
  goal: z.string(),                              // what the conversation drives toward
  bookingType: z.string(),                       // what to schedule, incl. modality: "virtual consultation" | "in-home estimate" | "showroom tour" | "test drive" | "appointment" …
  offer: z.string(),                             // incentive to book ("" if none)
  providesEstimate: z.boolean(),                 // does this business quote a rough price over text?
  qualifyingQuestions: z.array(z.string()),      // ordered, business-specific questions (one at a time)
});
export const AgentConfigView = z.object({
  brandConversationRules: z.array(z.string()),  // business-specific behavior rules (3–4)
  knowledgeSources: z.array(KnowledgeSource).optional(),  // docs + main website pages
  aiRecommendations: z.array(AiRecommendation).optional(), // AI Q&A recommendations from transcripts
  smsPlaybook: SmsPlaybook.optional(),           // drives the live Preview Agent SMS conversation
  /* Geographic area the business serves — used by the Voice agent to gate new
     orders by ZIP (empty/absent = national/online business, no gating). */
  serviceArea: z.string().optional(),
});

/* ---- Voice Screenpop artifact --------------------------------------------
   Data for the CTI "screen pop" leave-behind: an inbound-call agent-desktop
   with Invoca Pre-Call Intelligence. The HTML shell/interactions are fixed
   (rendered by src/artifacts/voiceScreenpop.ts); only these data points
   re-skin per prospect. */
export const VoiceScreenpop = z.object({
  brandName: z.string(),          // "Shady Blinds" (contact-center brand shown in the CTI)
  callerName: z.string(),         // "Jessica Harper"
  callerPhone: z.string(),        // "(805) 555-0142"
  campaign: z.string(),           // "Custom Blinds — Santa Barbara Acquisition"
  tagGreen: z.string(),           // "✓ In Service Area"
  tagBlue: z.string(),            // "New Consultation Lead"
  estimatedValue: z.string(),     // "$2,400"
  googleSearch: z.string(),       // "custom motorized shades near me"
  websiteSearch: z.string(),      // "motorized shades installation"
  callingWebpage: z.string(),     // "/motorized-shades"
  products: z.string(),           // "Motorized Shades, Plantation Shutters"
  cartId: z.string(),             // "SB-4827K"
  serviceable: z.string(),        // "Yes"
  email: z.string(),              // "j.harper@gmail.com"
  street: z.string(),             // "3275 Cliff Drive"
  city: z.string(),               // "Santa Barbara"
  state: z.string(),              // "CA"
  zip: z.string(),                // "93109"
  digitalJourney: z.string(),     // "/home › /motorized-shades › /request-consultation › /motorized-shades"
  intent: z.string(),             // AI Voice Agent intent line
  coverage: z.string(),           // AI Voice Agent coverage line
  switchIntent: z.string(),       // AI Voice Agent switch-intent line
  greeting: z.string(),           // suggested greeting script
});

/* ---- SMS Screenpop artifact ----------------------------------------------
   Same CTI screen-pop shell as Voice, in SMS flavor: the third AI row is an
   "Appointment" already booked by the SMS agent (vs Voice's "Switch Intent").
   Rendered by src/artifacts/smsScreenpop.ts. */
export const SmsScreenpop = z.object({
  brandName: z.string(),
  callerName: z.string(),
  callerPhone: z.string(),
  campaign: z.string(),
  tagGreen: z.string(),
  tagBlue: z.string(),
  estimatedValue: z.string(),
  googleSearch: z.string(),
  websiteSearch: z.string(),
  callingWebpage: z.string(),
  products: z.string(),
  cartId: z.string(),
  serviceable: z.string(),
  email: z.string(),
  street: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  digitalJourney: z.string(),
  intent: z.string(),
  coverage: z.string(),
  appointment: z.string(),        // e.g. "Call w/ design consultant - Thu Jul 17, 10:00 AM"
  greeting: z.string(),           // suggested SMS reply
});

/* ---- Voice Routing Demo artifact ------------------------------------------
   Data for the animated "live call routing" leave-behind: the AI voice agent
   qualifies a caller turn-by-turn, queue probabilities shift live, signals are
   detected, and the caller is routed to the winning team. The winning queue is
   always queues[0]. Rendered by src/artifacts/voiceRoutingDemo.ts. */
export const VrdAttr = z.object({
  label: z.string(),
  value: z.string(),
  highlight: z.boolean().optional(),
});
export const VrdTurn = z.object({
  role: z.enum(["agent", "caller"]),
  text: z.string(),
  sigs: z.array(z.object({ c: z.string(), t: z.string() })),  // c = color (green|blue|orange|red|purple); t may contain <strong>
  q: z.array(z.number()),                                      // per-queue probability %, positionally aligned to queues[] (z.record isn't allowed in strict structured-output schemas)
});
export const VoiceRoutingDemo = z.object({
  brandName: z.string(),          // "Shady Blinds"
  brandDomain: z.string(),        // "www.shadyblindsnow.com"
  brandIcon: z.string(),          // an emoji, e.g. "🪟"
  callerPhone: z.string(),        // "+1 (805) 555-0142"
  callerLocation: z.string(),     // "Santa Barbara, CA"
  idBadge: z.string(),            // "New Visitor"
  attribution: z.array(VrdAttr),  // ATTR1
  visitorHistory: z.array(VrdAttr), // ATTR2
  queues: z.array(z.object({ id: z.string(), name: z.string() })), // 3; queues[0] is the winner
  convo: z.array(VrdTurn),        // the call, turn by turn
  routedSubtitle: z.string(),     // routed-card subtitle line
});

/* ---- Gumloop artifacts ----------------------------------------------------
   Three HTML leave-behinds produced by an external Gumloop agent that only
   needs the customer URL. They're generated in parallel with the platform demo
   and surface as clickable rows in My Reports. Each carries a live status so
   the row can show "Creating…" → "Complete" (or "Failed") without a refresh,
   and either inline `html` (self-contained, rendered via <iframe srcDoc>) or a
   hosted `url` (rendered via <iframe src>). */
export const GumloopArtifact = z.object({
  id: z.string(),                    // "voice-screenpop" | "sms-screenpop" | "voice-routing-demo"
  name: z.string(),                  // row label: "Voice Screenpop" | "SMS Screenpop" | "Voice Routing Demo"
  status: z.enum(["creating", "complete", "failed"]),
  runId: z.string().optional(),      // Gumloop run id (for polling status)
  html: z.string().optional(),       // self-contained HTML → <iframe srcDoc>
  url: z.string().optional(),        // hosted URL → <iframe src>
  createdAt: z.string().optional(),  // display timestamp for the My Reports row
});

/* ---- The customer profile ------------------------------------------------- */
export const CustomerProfile = z.object({
  id: z.string(),                   // slug: "shady-blinds"
  customerName: z.string(),         // "Shady Blinds"
  websiteUrl: z.string(),           // "https://www.shadyblindsnow.com/"
  brandDomain: z.string(),          // "shadyblindsnow.com"
  networkName: z.string(),          // shown in the top-bar network selector
  industry: z.string(),             // "Window treatments & home services"
  /* The industry-appropriate word for what this business schedules — a short,
     Title-Case, singular noun used consistently across the platform's booking
     labels (report signals, dashboard metrics, workflow, etc.). e.g.
     "Consultation" | "Appointment" | "Estimate" | "Tour" | "Test Drive". */
  bookingTerm: z.string(),
  /* The industry-appropriate word for a customer — Title-Case singular:
     "Customer" | "Patient" | "Member" | "Client" | "Guest". */
  customerNoun: z.string(),

  // Each screen is a view of the profile. Add new screens here as we build them.
  reports: z.object({
    digitalInsights: DigitalInsightsReport,
    marketingDashboard: DashboardView,
    callReview: CallReviewView.optional(),   // only some customers have Call Review data
    callDetail: CallDetailView.optional(),   // the drill-in for the 4th (evaluated) call
    opsDashboard: OpsDashboardView.optional(), // 2nd dashboard: Marketing & Operations Performance
    aiAgentConversion: AiAgentConversionView.optional(), // 3rd dashboard: AI Agent Conversion
    aiMessagingImpact: AiMessagingImpactView.optional(), // 4th dashboard: AI Messaging Impact (Human vs AI)
    qualityManagement: QualityManagementView.optional(), // 5th dashboard: QM Actionable Insights
    qmInstantInsights: QmInstantInsightsView.optional(), // 6th dashboard: QM Instant Insights
    conversationIntelligence: ConversationIntelligenceView.optional(), // per-call analysis view
    smsConversationIntelligence: SmsConversationIntelligenceView.optional(), // AI SMS conversation report
    voiceConversationIntelligence: VoiceConversationIntelligenceView.optional(), // AI Voice call report
    agentConfig: AgentConfigView.optional(),  // Agent Studio: agent configuration editor
    gumloopArtifacts: z.array(GumloopArtifact).optional(), // 3 Gumloop HTML leave-behinds → My Reports rows
    voiceScreenpop: VoiceScreenpop.optional(),   // data for the Voice Screenpop artifact
    smsScreenpop: SmsScreenpop.optional(),        // data for the SMS Screenpop artifact
    voiceRoutingDemo: VoiceRoutingDemo.optional(), // data for the Voice Routing Demo artifact
    // aiAgents: AIAgentsView,           ← future
  }),
});

/* ---- Generation output ----------------------------------------------------
   The subset the AI engine produces from a customer URL. The engine wraps this
   with identity fields (id / customerName / websiteUrl / brandDomain) it
   already knows, then validates the whole thing against CustomerProfile. */
export const GenerationOutput = z.object({
  networkName: z.string(),   // e.g. "Invoca for Automotive"
  industry: z.string(),      // e.g. "Tires & automotive service"
  bookingTerm: z.string(),   // e.g. "Test Drive" | "Appointment" | "Consultation"
  customerNoun: z.string(),  // e.g. "Member" | "Patient" | "Customer"
  digitalInsights: DigitalInsightsReport,
  marketingDashboard: DashboardView,
  callReview: CallReviewView,
  callDetail: CallDetailView,
  opsDashboard: OpsDashboardView,
  aiAgentConversion: AiAgentConversionView,
  aiMessagingImpact: AiMessagingImpactView,
  conversationIntelligence: ConversationIntelligenceView,
  smsConversationIntelligence: SmsConversationIntelligenceView,
  voiceConversationIntelligence: VoiceConversationIntelligenceView,
  agentConfig: AgentConfigView,
});

/* ---- Derived static types (no hand-written duplicates) -------------------- */
export type ChartPoint = z.infer<typeof ChartPoint>;
export type SignalColumn = z.infer<typeof SignalColumn>;
export type InteractionRow = z.infer<typeof InteractionRow>;
export type DigitalInsightsReport = z.infer<typeof DigitalInsightsReport>;
export type KpiTile = z.infer<typeof KpiTile>;
export type KpiGroup = z.infer<typeof KpiGroup>;
export type BreakdownRow = z.infer<typeof BreakdownRow>;
export type Breakdown = z.infer<typeof Breakdown>;
export type ChartSeries = z.infer<typeof ChartSeries>;
export type MultiSeriesChart = z.infer<typeof MultiSeriesChart>;
export type DashboardView = z.infer<typeof DashboardView>;
export type CallReviewItem = z.infer<typeof CallReviewItem>;
export type CallReviewView = z.infer<typeof CallReviewView>;
export type CallDetailScorecardRow = z.infer<typeof CallDetailScorecardRow>;
export type CallDetailTurn = z.infer<typeof CallDetailTurn>;
export type CallDetailPrompt = z.infer<typeof CallDetailPrompt>;
export type CallDetailComment = z.infer<typeof CallDetailComment>;
export type CallDetailView = z.infer<typeof CallDetailView>;
export type OpsBarChart = z.infer<typeof OpsBarChart>;
export type OpsTable = z.infer<typeof OpsTable>;
export type OpsMarketingSection = z.infer<typeof OpsMarketingSection>;
export type OpsDashboardView = z.infer<typeof OpsDashboardView>;
export type ConversionCard = z.infer<typeof ConversionCard>;
export type AiAgentConversionView = z.infer<typeof AiAgentConversionView>;
export type AimKpiCard = z.infer<typeof AimKpiCard>;
export type AiMessagingImpactView = z.infer<typeof AiMessagingImpactView>;
export type QmBarPanel = z.infer<typeof QmBarPanel>;
export type QmTablePanel = z.infer<typeof QmTablePanel>;
export type QmBarLinePoint = z.infer<typeof QmBarLinePoint>;
export type QmBarLine = z.infer<typeof QmBarLine>;
export type QualityManagementView = z.infer<typeof QualityManagementView>;
export type QmInstantInsightsView = z.infer<typeof QmInstantInsightsView>;
export type CITranscriptTurn = z.infer<typeof CITranscriptTurn>;
export type CICall = z.infer<typeof CICall>;
export type CISignal = z.infer<typeof CISignal>;
export type CIAiSummary = z.infer<typeof CIAiSummary>;
export type ConversationIntelligenceView = z.infer<typeof ConversationIntelligenceView>;
export type SmsTurn = z.infer<typeof SmsTurn>;
export type SmsInfo = z.infer<typeof SmsInfo>;
export type SmsConversation = z.infer<typeof SmsConversation>;
export type SmsConversationIntelligenceView = z.infer<typeof SmsConversationIntelligenceView>;
export type VoiceTurn = z.infer<typeof VoiceTurn>;
export type VoiceInfo = z.infer<typeof VoiceInfo>;
export type VoiceConversation = z.infer<typeof VoiceConversation>;
export type VoiceConversationIntelligenceView = z.infer<typeof VoiceConversationIntelligenceView>;
export type KnowledgeSource = z.infer<typeof KnowledgeSource>;
export type QaPair = z.infer<typeof QaPair>;
export type AiRecommendation = z.infer<typeof AiRecommendation>;
export type SmsPlaybook = z.infer<typeof SmsPlaybook>;
export type AgentConfigView = z.infer<typeof AgentConfigView>;
export type GumloopArtifact = z.infer<typeof GumloopArtifact>;
export type VoiceScreenpop = z.infer<typeof VoiceScreenpop>;
export type SmsScreenpop = z.infer<typeof SmsScreenpop>;
export type VoiceRoutingDemo = z.infer<typeof VoiceRoutingDemo>;
export type CustomerProfile = z.infer<typeof CustomerProfile>;
export type GenerationOutput = z.infer<typeof GenerationOutput>;

/* ---- Validation helper (used by the generation engine) -------------------- */
export function parseProfile(data: unknown): CustomerProfile {
  return CustomerProfile.parse(data);
}
