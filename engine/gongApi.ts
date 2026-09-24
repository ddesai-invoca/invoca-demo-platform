import type { ContextSource } from "./genContext.ts";

/* =============================================================================
   gongApi.ts — look this prospect up in Gong, as the SE would
   -----------------------------------------------------------------------------
   Gong is a SERVICE credential (docs/INTEGRATIONS.md): one Access Key + Secret
   works for every SE, no per-user consent. Unlike Drive, there is no specific
   link to paste — the SE only has a prospect name and a website, so this has to
   FIND the right calls itself, then synthesise what they're worth knowing.

   Verified against this project's own real, live Gong workspace while writing
   this (never against invented shapes): Basic Auth with base64(accessKey:
   accessKeySecret), GET /v2/calls for lightweight metadata, POST
   /v2/calls/extensive for the AI-generated brief/keyPoints/trackers plus, where
   Gong's Salesforce integration has linked one, the CRM Account's Website field
   and the Opportunity's own "next steps" notes.

   ⚠️⚠️ THERE IS NO "SEARCH BY COMPANY" ENDPOINT — confirmed by probing the real
   API, not assumed. `/v2/calls` returns everything in a date window (2,002 calls
   in 60 days on this workspace alone) with no account filter. The workable
   signal, also confirmed on real data, is that INTERNAL CALL TITLES NAME THE
   ACCOUNT ("Orlando Health Discussion", "SERVPRO+Invoca: Immersion Day
   Alignment", "Barco Products IFS Demo") — so this searches titles, not a CRM
   lookup, and only calls `/v2/calls/extensive` (the expensive, content-bearing
   endpoint) for the handful of titles that already look like a match.

   ⚠️ A COLD PROSPECT RETURNS NOTHING, ON PURPOSE. Per docs/INTEGRATIONS.md, a
   prospect with no recorded Gong calls must not fabricate a brief — the caller
   gets `null` and the panel says so plainly, the same as the Drive/document
   path's other honest-empty states.
   ============================================================================= */

const GONG_BASE = "https://api.gong.io";

function accessKey(): string { return process.env.GONG_ACCESS_KEY || ""; }
function accessSecret(): string { return process.env.GONG_SECRET || ""; }

function authHeader(): string {
  return "Basic " + Buffer.from(`${accessKey()}:${accessSecret()}`).toString("base64");
}

/* Windows tried NEWEST first, each a distinct range so nothing is re-fetched.
   Most prospects being demoed have talked to Invoca recently, so the common
   case costs one or two cheap pages; a match from months ago still costs
   something bounded rather than nothing. */
const WINDOWS: { fromDays: number; toDays: number }[] = [
  { fromDays: 14, toDays: 0 },
  { fromDays: 45, toDays: 14 },
  { fromDays: 120, toDays: 45 },
];
/** Exported so the audit can assert the page budget is actually enforced,
 *  rather than re-typing the same number and hoping it never drifts. */
export const MAX_PAGES = 25;
const MAX_MATCHES = 5;
const MAX_ENRICH_CHARS = 6_000;

const isoDaysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

/** Exported so the audit can call the REAL matching/cross-check logic rather
 *  than a copy of it, per this repo's standing rule for anything with real
 *  behavior riding on it (see e.g. `signalTiers.ts`'s CONCEPT_HARD_PHRASES). */
export function domainOf(raw: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/* ⚠️⚠️ MATCHING IS ON NORMALISED TOKENS, NOT ON THE TYPED STRING — reported
   directly: *"the actual name on gong is 'AVI & Co.' but it should still find
   it if i type 'Avi and Co' or 'Avi & Co'"*. An exact-phrase regex fails every
   one of those variants, and an SE does not know how somebody else punctuated
   a meeting title months ago.

   Both sides collapse to word tokens, so `&` / `and`, "Co." / "Co", casing and
   every comma or slash become the same thing:
     "AVI & Co. / Invoca"  →  [avi, co, invoca]
     "Avi and Co" · "Avi & Co" · "AVI & Co." · "Avi Co"  →  [avi, co]

   ⚠️ CONJUNCTIONS AND ARTICLES ARE DROPPED FROM BOTH SIDES, which is what makes
   "&" and "and" and nothing-at-all equivalent without the needle having to
   guess which one was typed. */
const JOIN_TOKENS = new Set(["and", "the", "of"]);

export function normTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t && !JOIN_TOKENS.has(t));
}

/* Legal suffixes an SE might type but a Gong meeting title almost never
   carries ("Moffitt Cancer Center, Inc." vs "Moffitt Cancer Center Sync"). */
const SUFFIX_TOKENS = new Set([
  "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "corp", "corporation", "co", "company", "plc",
]);

/**
 * The token phrases worth looking for, most specific first: the name as typed,
 * then the same thing with trailing legal suffixes dropped.
 *
 * ⚠️⚠️ SUFFIXES ARE ONLY DROPPED WHILE MORE THAN TWO TOKENS REMAIN, and that
 * floor is the guard against the fuzziness going too far. Without it
 * "Avi & Co" → [avi, co] → [avi], and a bare one-token phrase would happily
 * claim any unrelated call whose title mentions that word. Keeping ≥2 tokens
 * means every generated phrase still has to match as a real phrase. (A
 * genuinely one-word company the SE types as one word is unaffected — that IS
 * their whole search term, not something this inferred.)
 */
export function searchPhrases(name: string): string[][] {
  const full = normTokens(name);
  if (!full.length) return [];
  const trimmed = [...full];
  while (trimmed.length > 2 && SUFFIX_TOKENS.has(trimmed[trimmed.length - 1])) trimmed.pop();
  return trimmed.length === full.length ? [full] : [full, trimmed];
}

/* A contiguous run of tokens, compared WHOLE — which is a stronger version of
   the word-boundary rule this repo already insists on: "cat" can never match
   inside "catering", because tokens are equal or they are not. */
function containsPhrase(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

export function titleMentions(title: string, name: string): boolean {
  const hay = normTokens(title);
  return searchPhrases(name).some((p) => containsPhrase(hay, p));
}

interface CallStub { id: string; title: string; scheduled: string }

async function listCallsInWindow(fromIso: string, toIso: string, budget: { pages: number }): Promise<CallStub[]> {
  const out: CallStub[] = [];
  let cursor: string | undefined;
  while (budget.pages > 0) {
    budget.pages--;
    const params = new URLSearchParams({ fromDateTime: fromIso, toDateTime: toIso });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`${GONG_BASE}/v2/calls?${params}`, { headers: { Authorization: authHeader() } });
    if (!res.ok) throw new Error(`Gong /v2/calls returned ${res.status}`);
    const data: any = await res.json();
    for (const c of data.calls ?? []) {
      if (c?.id && typeof c.title === "string") out.push({ id: c.id, title: c.title, scheduled: c.scheduled });
    }
    cursor = data.records?.cursor;
    if (!cursor || !(data.calls?.length > 0)) break;
  }
  return out;
}

async function findCandidateCalls(prospectName: string): Promise<CallStub[]> {
  const budget = { pages: MAX_PAGES };
  const matches: CallStub[] = [];
  for (const w of WINDOWS) {
    if (matches.length >= MAX_MATCHES || budget.pages <= 0) break;
    const calls = await listCallsInWindow(isoDaysAgo(w.fromDays), isoDaysAgo(w.toDays), budget);
    for (const c of calls) if (titleMentions(c.title, prospectName)) matches.push(c);
  }
  /* Newest first — a call from last week is worth more to a demo than one
     from four months ago, and MAX_MATCHES trims to the most useful ones. */
  matches.sort((a, b) => (a.scheduled < b.scheduled ? 1 : a.scheduled > b.scheduled ? -1 : 0));
  return matches.slice(0, MAX_MATCHES);
}

interface EnrichedCall {
  scheduled: string;
  title: string;
  brief?: string;
  keyPoints: string[];
  trackers: string[];
  nextSteps?: string;
  accountWebsite?: string;
}

async function enrichCalls(ids: string[]): Promise<EnrichedCall[]> {
  if (!ids.length) return [];
  const res = await fetch(`${GONG_BASE}/v2/calls/extensive`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      filter: { callIds: ids },
      contentSelector: {
        context: "Extended",
        exposedFields: { content: { trackers: true, brief: true, keyPoints: true } },
      },
    }),
  });
  if (!res.ok) throw new Error(`Gong /v2/calls/extensive returned ${res.status}`);
  const data: any = await res.json();
  const out: EnrichedCall[] = [];
  for (const call of data.calls ?? []) {
    const meta = call.metaData ?? {};
    const content = call.content ?? {};
    let accountWebsite: string | undefined;
    let nextSteps: string | undefined;
    for (const sys of call.context ?? []) {
      for (const obj of sys.objects ?? []) {
        if (obj.objectType === "Account") {
          const f = (obj.fields ?? []).find((x: any) => x.name === "Website");
          if (f?.value) accountWebsite = String(f.value);
        }
        if (obj.objectType === "Opportunity") {
          const f = (obj.fields ?? []).find((x: any) => x.name === "Next_Steps__c");
          /* Only the MOST RECENT entry — this field is a running log an AE
             appends to, and the rest is more internal negotiation history than
             a demo needs. */
          if (f?.value) nextSteps = String(f.value).split("\n")[0];
        }
      }
    }
    out.push({
      scheduled: meta.scheduled,
      title: meta.title,
      brief: typeof content.brief === "string" ? content.brief : undefined,
      keyPoints: Array.isArray(content.keyPoints) ? content.keyPoints.map((k: any) => k?.text).filter(Boolean) : [],
      trackers: Array.isArray(content.trackers)
        ? content.trackers.filter((t: any) => t?.count > 0).map((t: any) => `${t.name} (${t.count})`)
        : [],
      nextSteps,
      accountWebsite,
    });
  }
  return out;
}

function synthesize(calls: EnrichedCall[]): ContextSource | null {
  if (!calls.length) return null;
  const parts: string[] = [];
  for (const c of calls) {
    const date = c.scheduled ? new Date(c.scheduled).toISOString().slice(0, 10) : "unknown date";
    parts.push(`Call on ${date} — "${c.title}"`);
    if (c.brief) parts.push(c.brief);
    if (c.keyPoints.length) parts.push("Key points: " + c.keyPoints.join(" · "));
    if (c.trackers.length) parts.push("Topics detected: " + c.trackers.join(", "));
    if (c.nextSteps) parts.push("Most recent CRM next step on record: " + c.nextSteps);
    parts.push("");
  }
  const text = parts.join("\n").trim();
  if (!text) return null;
  return { label: "Gong — account call history", text: text.slice(0, MAX_ENRICH_CHARS) };
}

/**
 * Look a prospect up in Gong and return a synthesised brief, or null if this
 * server has no credential, or the prospect has no calls Gong can find.
 * Never throws for "nothing found" — only for a real request failure, which
 * the caller is expected to catch and treat as "Gong unavailable right now"
 * rather than failing whatever asked for this.
 */
export async function gongLookup(prospectName: string, prospectUrl: string): Promise<ContextSource | null> {
  if (!accessKey() || !accessSecret()) return null;
  const candidates = await findCandidateCalls(prospectName);
  if (!candidates.length) return null;

  const enriched = await enrichCalls(candidates.map((c) => c.id));
  /* Cross-check against the prospect's OWN domain when Gong's Salesforce link
     supplies one. A call with no CRM link at all is kept — the title match was
     already the full account name, not a guess — but a call that DOES carry a
     different company's website is dropped rather than trusted. */
  const targetDomain = domainOf(prospectUrl);
  const verified = enriched.filter((c) => {
    if (!c.accountWebsite || !targetDomain) return true;
    const d = domainOf(c.accountWebsite);
    return !d || d === targetDomain || d.includes(targetDomain) || targetDomain.includes(d);
  });

  return synthesize(verified);
}
