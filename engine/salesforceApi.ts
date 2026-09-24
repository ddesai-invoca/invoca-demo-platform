/* =============================================================================
   salesforceApi.ts — who is the AE on this prospect's account?
   -----------------------------------------------------------------------------
   Asked for as an extension of "mark as demoed": *"is there a way to see who the
   sales rep is on the salesforce account and ping them with status and comment"*.
   The rep is `Account.Owner` — that part is easy. Finding the right ACCOUNT is
   the whole of this file.

   ⚠️⚠️ **MATCHING BY NAME PINGS THE WRONG PERSON, AND THAT WAS MEASURED AGAINST
   THE REAL CRM BEFORE ANY OF THIS WAS WRITTEN.** SOQL `Name LIKE '%…%'` over the
   Dallas roster returned:
     • `%PMG%`       -> KPMG, EPMG
     • `%Aptive%`    -> Adaptive, Adaptive Biotechnologies, CaptiveAire, Captive Resources
     • `%Riverbend%` -> "Mednik Riverbend", a medical group rather than the pool company
     • `%Moffitt%`   -> "Moffitt Fan Corporation"
   The same substring trap CLAUDE.md already records for "car" matching "care".
   So the key is the demo's own WEBSITE DOMAIN, which is on `DemoRecord` already.

   ⚠️⚠️ **AND `Website LIKE '%domain%'` BLEEDS TOO — the LIKE is a coarse
   PREFILTER, never the matcher.** Measured on the same 16 domains:
     • `%att.com%`     also matched `allianceatt.com`, plus two accounts ("At Home",
       "eadys") whose Website field is junk and literally reads att.com
     • `%optimum.com%` also matched `groupe-optimum.com` and `solaroptimum.com`
   So every candidate is re-checked in CODE against the registrable domain, which
   is what `sameSite()` below does and what the audit pins.

   ⚠️⚠️ **IT RESOLVES OR IT REFUSES; IT NEVER GUESSES.** Duplicate accounts for
   one domain with DIFFERENT owners are real and common (`goaptive.com` ->
   "Aptive Environmental"/Alyssa Croley AND "Aptive Environmental, LLC"/Alexander
   Burghardt). Guessing there emails a colleague about an account that is not
   theirs, which is the one failure here that cannot be taken back. Ambiguity
   returns the CANDIDATES and the caller asks a human.

   ⚠️ **A SERVICE CREDENTIAL, NOT AN ASSISTANT'S CONNECTOR** — the distinction
   `engine/integrations.ts` exists to make. The Salesforce MCP connector a Claude
   session holds is authenticated as the person chatting and is unreachable from
   this server; the app needs a Connected App of its own. Same shape as Gong: one
   setup, every SE benefits, nobody consents to anything. Unconfigured is a
   SUPPORTED state — every entry point below reports why rather than throwing.
   docs/INTEGRATIONS.md carries what to obtain.
   ============================================================================= */

import crypto from "node:crypto";
import { domainOf } from "./gongApi.ts";

const API_VERSION = "v60.0";

const loginUrl = () =>
  (process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com").replace(/\/+$/, "");

/* ⚠️⚠️ **TWO WAYS IN, AND THE REFRESH TOKEN WINS WHEN BOTH ARE SET.** They are
   the two rows of docs/INTEGRATIONS.md §4:
     • REFRESH TOKEN — minted by `sf org login web` against Salesforce's own
       built-in `PlatformCLI` connected app. No app to create, no admin, ~10
       minutes. Every lookup reads as whoever ran that command.
     • CLIENT CREDENTIALS — a Connected App an admin sets up once. Reads as a
       dedicated service user and survives any one person leaving.
   The refresh token is checked first because it is the interim: an org that
   later provisions a proper Connected App sets the pair and clears the token,
   rather than having to reason about precedence.
   ⚠️ NOTHING ELSE IN THIS FILE KNOWS WHICH ONE IS IN USE — `soql()` just asks
   for a token — which is what makes the swap a config change rather than a
   rewrite. */
const refreshAuth = (): boolean => !!process.env.SALESFORCE_REFRESH_TOKEN;
const clientCredsAuth = (): boolean =>
  !!(process.env.SALESFORCE_CLIENT_ID && process.env.SALESFORCE_CLIENT_SECRET);

export const salesforceConfigured = (): boolean => refreshAuth() || clientCredsAuth();

/** One rep, and the account they own that we matched. */
export interface RepCandidate {
  accountId: string;
  accountName: string;
  website: string;
  ownerName: string;
  ownerEmail: string;
  ownerActive: boolean;
}

export interface RepLookup {
  /** The registrable domain we searched on, for the UI to name. */
  domain: string;
  /** Resolved unambiguously, or null. */
  rep: RepCandidate | null;
  /** Populated only when more than one distinct owner survived — pick one. */
  candidates: RepCandidate[];
  /** Why nothing resolved, in words a person can act on. */
  reason?: string;
}

const none = (domain: string, reason: string): RepLookup => ({ domain, rep: null, candidates: [], reason });

/* ---- auth -------------------------------------------------------------------
   OAuth 2.0 CLIENT CREDENTIALS on a Connected App: the app authenticates as
   itself, which is what makes this a one-time setup rather than a per-SE consent
   (Drive is per-user precisely because strategy docs live in personal Drives; an
   account owner does not).

   ⚠️ Cached until a minute before expiry, the same margin `mailer.gmailAccessToken`
   uses — a token that expires mid-request reads as an outage. No background
   refresher: the next call mints one. */
let token: { value: string; instance: string; expires: number; auth: string } | null = null;

/**
 * A fingerprint of WHICH credential minted the cached token.
 *
 * ⚠️⚠️ **THE CACHE IS KEYED ON IT, AND THAT IS A CORRECTNESS FIX RATHER THAN
 * BOOKKEEPING.** Without it, a token minted from one credential keeps being
 * served after the credential CHANGES — so an org that graduates from the CLI
 * refresh token to a proper Connected App goes on querying as the old identity
 * until somebody restarts the process, with nothing on screen to say so. Caught
 * by `audit:rep`, where a second test's mock was silently answered from the
 * first test's cache.
 * ⚠️ HASHED, so no part of a secret is retained to be logged or inspected later.
 */
function authFingerprint(): string {
  const raw = refreshAuth()
    ? `refresh:${process.env.SALESFORCE_REFRESH_TOKEN}:${process.env.SALESFORCE_CLIENT_ID ?? ""}`
    : `cc:${process.env.SALESFORCE_CLIENT_ID}:${process.env.SALESFORCE_CLIENT_SECRET}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
}

async function accessToken(): Promise<{ value: string; instance: string }> {
  const auth = authFingerprint();
  if (token && token.auth === auth && Date.now() < token.expires) return token;
  const body = refreshAuth()
    ? new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: process.env.SALESFORCE_REFRESH_TOKEN!,
        /* ⚠️ `PlatformCLI` IS SALESFORCE'S OWN CONNECTED APP, PRE-INSTALLED IN
           EVERY ORG — that is the whole reason this path needs no admin. It is a
           PUBLIC client, so it takes no secret; sending one is not merely
           unnecessary, it makes the exchange fail. The default is what the CLI
           itself writes into `~/.sfdx/<username>.json`, so a paste of that file's
           values works with no extra variable. */
        client_id: process.env.SALESFORCE_CLIENT_ID || "PlatformCLI",
        ...(process.env.SALESFORCE_CLIENT_SECRET ? { client_secret: process.env.SALESFORCE_CLIENT_SECRET } : {}),
      })
    : new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SALESFORCE_CLIENT_ID!,
        client_secret: process.env.SALESFORCE_CLIENT_SECRET!,
      });
  const r = await fetch(`${loginUrl()}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.access_token) {
    /* Salesforce puts the actionable part in `error_description` ("client
       credentials flow not enabled for this connected app"), so surface it. */
    throw new Error(j?.error_description || j?.error || `Salesforce auth failed (${r.status})`);
  }
  token = {
    auth,
    value: j.access_token,
    /* ⚠️ THE RESPONSE'S OWN `instance_url` IS AUTHORITATIVE and comes back on
       both grants — an org on a My Domain host answers from somewhere the login
       URL does not name, and querying the login host instead returns 404s that
       read as a broken credential. `SALESFORCE_INSTANCE_URL` is only a fallback
       for the same value the CLI already wrote down. */
    instance: String(j.instance_url || process.env.SALESFORCE_INSTANCE_URL || loginUrl()).replace(/\/+$/, ""),
    /* Salesforce omits expires_in on this flow; the session default is 2h and we
       ask for far less, so a short cache is the conservative read. */
    expires: Date.now() + (Number(j.expires_in) ? Number(j.expires_in) * 1000 : 30 * 60_000) - 60_000,
  };
  return token;
}

async function soql<T>(q: string): Promise<T[]> {
  const t = await accessToken();
  const r = await fetch(`${t.instance}/services/data/${API_VERSION}/query?q=${encodeURIComponent(q)}`, {
    headers: { authorization: `Bearer ${t.value}` },
  });
  if (r.status === 401) {
    /* A dead session is cleared rather than retried in a loop — the next call
       mints a fresh token, the same self-healing `driveApi` does on a 401. */
    token = null;
    throw new Error("Salesforce rejected the session. Check the connected app's credentials.");
  }
  const j: any = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.[0]?.message || j?.message || `Salesforce query failed (${r.status})`);
  return (j?.records ?? []) as T[];
}

/* ---- matching ---------------------------------------------------------------- */

/**
 * Do these two hostnames name the same site?
 *
 * ⚠️⚠️ **EQUAL, OR A DOT-SUFFIX — NEVER `includes`.** That one rule is what kills
 * every bleed the LIKE lets through, checked against the real results:
 *   sameSite("allianceatt.com",  "att.com")     -> false  (not ".att.com")
 *   sameSite("solaroptimum.com", "optimum.com") -> false
 *   sameSite("groupe-optimum.com","optimum.com")-> false
 *   sameSite("careers.moffitt.org","moffitt.org")-> TRUE   (a real subdomain)
 * A public-suffix list would be more correct and is not worth the dependency; a
 * CRM Website field is a company's own site, not a `*.co.uk` edge case.
 */
export function sameSite(a: string, b: string): boolean {
  const x = domainOf(a);
  const y = domainOf(b);
  if (!x || !y) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/**
 * A sandbox / demo / test copy of a real account.
 *
 * ⚠️ MEASURED SHAPES, not a guess: "Ai Media Group - Sandbox", "AutoNation - Demo".
 * The qualifier is a TRAILING suffix, so this deliberately does not match a word
 * anywhere in the name — "Demo Ranch" is a company.
 */
export function looksLikeSandbox(name: string): boolean {
  return /[-–—(\[]\s*(sandbox|demo|test|training|do not use|dupe|duplicate)\s*[)\]]?\s*$/i.test(name.trim());
}

/**
 * ⚠️⚠️ **A FILTER NEVER EMPTIES THE LIST.** Dropping every candidate turns
 * "we found the account but it looks like a sandbox" into "no account found",
 * which sends an SE hunting for a record that is right there. So each narrowing
 * applies only while something survives it — fail OPEN on filtering, and fail
 * CLOSED on sending (which is `rep === null`).
 */
const narrow = <T,>(rows: T[], keep: (r: T) => boolean): T[] => {
  const kept = rows.filter(keep);
  return kept.length ? kept : rows;
};

/* ---- the lookup --------------------------------------------------------------- */

interface AccountRow {
  Id: string;
  Name: string;
  Website: string | null;
  Owner: { Name: string; Email: string; IsActive: boolean } | null;
}

/**
 * Resolve the account executive for one prospect website.
 *
 * NEVER THROWS — every failure comes back as a `reason`, because this is called
 * to decorate a one-click action at conference pace and an exception there would
 * take the mark down with it.
 */
export async function lookupRep(websiteUrl: string): Promise<RepLookup> {
  const domain = domainOf(websiteUrl);
  if (!domain) return none("", "This demo has no website to match on.");
  if (!salesforceConfigured()) return none(domain, "Salesforce isn't connected on this server.");

  let rows: AccountRow[];
  try {
    /* The LIKE is the coarse prefilter; `sameSite` below is the matcher. Escaping
       the quote is belt-and-braces — `domainOf` has already been through `new URL`,
       so a hostname cannot contain one. */
    const like = domain.replace(/'/g, "\\'");
    rows = await soql<AccountRow>(
      `SELECT Id, Name, Website, Owner.Name, Owner.Email, Owner.IsActive ` +
      `FROM Account WHERE Website LIKE '%${like}%' LIMIT 50`,
    );
  } catch (e: any) {
    return none(domain, e?.message || "Salesforce lookup failed.");
  }

  const exact = rows.filter((r) => r.Website && sameSite(r.Website, domain));
  if (!exact.length) {
    return none(domain, `No Salesforce account matches ${domain}.`);
  }

  let cands: RepCandidate[] = exact
    .filter((r) => r.Owner?.Email)
    .map((r) => ({
      accountId: r.Id,
      accountName: r.Name,
      website: r.Website ?? "",
      ownerName: r.Owner!.Name,
      ownerEmail: r.Owner!.Email.toLowerCase(),
      ownerActive: !!r.Owner!.IsActive,
    }));
  if (!cands.length) {
    return none(domain, `The Salesforce account for ${domain} has no owner email.`);
  }

  cands = narrow(cands, (c) => !looksLikeSandbox(c.accountName));
  cands = narrow(cands, (c) => c.ownerActive);

  /* ⚠️ DE-DUPED BY OWNER, NOT BY ACCOUNT — and that distinction is what makes
     most duplicates harmless. "AutoNation - Demo" and "AutoNation, Inc" are two
     records with the SAME owner (Chase Howland), so there is exactly one person
     to tell and nothing to ask about. Only genuinely different owners are an
     ambiguity. */
  const byOwner = new Map<string, RepCandidate>();
  for (const c of cands) if (!byOwner.has(c.ownerEmail)) byOwner.set(c.ownerEmail, c);
  const owners = [...byOwner.values()];

  if (owners.length === 1) return { domain, rep: owners[0], candidates: [] };
  return {
    domain,
    rep: null,
    candidates: owners,
    reason: `${owners.length} Salesforce accounts match ${domain} with different owners.`,
  };
}
