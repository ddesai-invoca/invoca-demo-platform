/* =============================================================================
   npm run audit:rep — the AE lookup resolves the right person, or refuses
   -----------------------------------------------------------------------------
   The risk here is not that the feature looks broken; it is that it WORKS and
   emails the wrong colleague. A Salesforce `Website LIKE '%domain%'` genuinely
   returns unrelated accounts (measured against the real CRM: `%att.com%` matches
   allianceatt.com and two junk records, `%optimum.com%` matches solaroptimum.com
   and groupe-optimum.com), and one domain genuinely maps to duplicate accounts
   owned by DIFFERENT people. So every check below is about who is told.

   ⚠️⚠️ **IT RUNS AGAINST A MOCKED `fetch`, NEVER THE REAL SALESFORCE.** An audit
   that depends on somebody else's service is flaky by construction and cannot run
   on a machine with no credential — the same rule `audit:advanced` follows for
   Gong. What is exercised is the REAL `lookupRep`, not a copy of its rules.
   ============================================================================= */
import fs from "node:fs";
import { lookupRep, sameSite, looksLikeSandbox, salesforceConfigured } from "../engine/salesforceApi.ts";

let bad = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const no = (m: string) => { bad++; console.log(`  FAIL  ${m}`); };

const read = (f: string) => fs.readFileSync(f, "utf8");
/* Comments are stripped before matching: several files here legitimately NAME the
   thing being forbidden while explaining why it is forbidden, and a check that
   reddens on correct documentation gets deleted as a nuisance. */
const code = (f: string) =>
  read(f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/* ---- 1. the matcher --------------------------------------------------------- */
console.log("\nDomain matching — the LIKE is a prefilter, this is the matcher\n");

const SAME: [string, string, boolean][] = [
  ["https://www.claffeypools.com/", "claffeypools.com", true],
  ["careers.moffitt.org", "moffitt.org", true],
  ["MOFFITT.ORG", "moffitt.org", true],
  /* Every one of these was returned by the real `LIKE` query and must NOT match. */
  ["allianceatt.com", "att.com", false],
  ["solaroptimum.com", "optimum.com", false],
  ["groupe-optimum.com", "optimum.com", false],
  ["notclaffeypools.com", "claffeypools.com", false],
  ["", "att.com", false],
];
for (const [a, b, want] of SAME) {
  sameSite(a, b) === want
    ? ok(`sameSite(${a || "''"}, ${b}) = ${want}`)
    : no(`sameSite(${a || "''"}, ${b}) should be ${want}`);
}

const SANDBOX: [string, boolean][] = [
  ["Ai Media Group - Sandbox", true],
  ["AutoNation - Demo", true],
  ["Acme (Test)", true],
  /* ⚠️ A trailing qualifier, never a word anywhere in the name — "Demo Ranch" and
     "Test Valley Homes" are companies. */
  ["Demo Ranch", false],
  ["AutoNation, Inc", false],
];
for (const [n, want] of SANDBOX) {
  looksLikeSandbox(n) === want ? ok(`looksLikeSandbox("${n}") = ${want}`)
    : no(`looksLikeSandbox("${n}") should be ${want}`);
}

/* ---- 2. the lookup, against a mocked Salesforce ----------------------------- */
console.log("\nlookupRep — resolves, or refuses and says why\n");

const realFetch = globalThis.fetch;
async function withSf(records: any[] | Error, run: () => Promise<void>) {
  process.env.SALESFORCE_CLIENT_ID = "id";
  process.env.SALESFORCE_CLIENT_SECRET = "secret";
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.includes("/services/oauth2/token"))
      return new Response(JSON.stringify({ access_token: "t", instance_url: "https://x.my.salesforce.com", expires_in: 3600 }), { status: 200 });
    if (records instanceof Error)
      return new Response(JSON.stringify([{ message: records.message }]), { status: 400 });
    return new Response(JSON.stringify({ records }), { status: 200 });
  }) as typeof fetch;
  try { await run(); } finally {
    globalThis.fetch = realFetch;
    delete process.env.SALESFORCE_CLIENT_ID;
    delete process.env.SALESFORCE_CLIENT_SECRET;
  }
}
const acct = (Id: string, Name: string, Website: string, owner: string, email: string, IsActive = true) =>
  ({ Id, Name, Website, Owner: { Name: owner, Email: email, IsActive } });

/* Unconfigured is a SUPPORTED state — it must report, never throw. */
{
  delete process.env.SALESFORCE_CLIENT_ID;
  delete process.env.SALESFORCE_CLIENT_SECRET;
  const r = await lookupRep("https://claffeypools.com");
  !r.rep && /isn't connected/i.test(r.reason ?? "")
    ? ok("no credential: refuses and names the reason, no throw")
    : no("no credential should refuse with a readable reason");
}

await withSf([acct("1", "Claffey Pools", "https://www.claffeypools.com", "Jacob Burkhardt", "jburkhardt@invoca.com")], async () => {
  const r = await lookupRep("https://claffeypools.com/");
  r.rep?.ownerEmail === "jburkhardt@invoca.com" && r.candidates.length === 0
    ? ok("one matching account resolves to its owner")
    : no("a single clean match should resolve");
});

/* ⚠️⚠️ THE CHECK THIS FILE EXISTS FOR: the LIKE's own bleed must be dropped. */
await withSf([
  acct("1", "AT&T Services", "https://www.att.com", "Megan Gast", "mgast@invoca.com"),
  acct("2", "Alliance Mobile", "https://allianceatt.com", "Someone Else", "else@invoca.com"),
  acct("3", "At Home", "http://www.att.com/", "Megan Gast", "mgast@invoca.com"),
], async () => {
  const r = await lookupRep("https://www.att.com");
  r.rep?.ownerEmail === "mgast@invoca.com"
    ? ok("a substring match on another domain is dropped, not trusted")
    : no("allianceatt.com must not count as att.com");
});

/* Two records, ONE owner — not an ambiguity, and it must not ask. */
await withSf([
  acct("1", "AutoNation - Demo", "https://autonation.com", "Chase Howland", "chowland@invoca.com"),
  acct("2", "AutoNation, Inc", "https://www.autonation.com", "Chase Howland", "chowland@invoca.com"),
], async () => {
  const r = await lookupRep("https://autonation.com");
  r.rep?.ownerEmail === "chowland@invoca.com" && r.candidates.length === 0
    ? ok("duplicate accounts with the SAME owner resolve without asking")
    : no("two records owned by one person is not an ambiguity");
});

/* Two owners — it must REFUSE and hand back both. */
await withSf([
  acct("1", "Aptive Environmental", "https://goaptive.com", "Alyssa Croley", "acroley@invoca.com"),
  acct("2", "Aptive Environmental, LLC", "https://www.goaptive.com", "Alexander Burghardt", "aburghardt@invoca.com"),
], async () => {
  const r = await lookupRep("https://goaptive.com");
  !r.rep && r.candidates.length === 2
    ? ok("two different owners refuses and returns both candidates")
    : no("different owners must never be guessed between");
});

/* A sandbox record is dropped — but only while something survives. */
await withSf([
  acct("1", "Ai Media Group - Sandbox", "https://aimediagroup.com", "Alyson Hyder", "ahyder@invoca.com"),
  acct("2", "Ai Media Group", "https://aimediagroup.com", "Michelle Allmond", "mallmond@invoca.com"),
], async () => {
  const r = await lookupRep("https://aimediagroup.com");
  r.rep?.ownerEmail === "mallmond@invoca.com"
    ? ok("a sandbox twin is dropped in favour of the real account")
    : no("the sandbox record should not win");
});
await withSf([acct("1", "Ai Media Group - Sandbox", "https://aimediagroup.com", "Alyson Hyder", "ahyder@invoca.com")], async () => {
  const r = await lookupRep("https://aimediagroup.com");
  /* ⚠️ FAIL OPEN ON FILTERING: dropping the only candidate turns "we found it and
     it looks like a sandbox" into "nothing matches", which sends an SE hunting
     for a record that is right there. */
  r.rep?.ownerEmail === "ahyder@invoca.com"
    ? ok("a filter never empties the list — the only candidate survives")
    : no("narrowing must not drop the last candidate");
});

/* An inactive owner loses to an active one, and survives alone. */
await withSf([
  acct("1", "Acme", "https://acme.com", "Left The Company", "gone@invoca.com", false),
  acct("2", "Acme Corp", "https://acme.com", "Current Owner", "cur@invoca.com", true),
], async () => {
  const r = await lookupRep("https://acme.com");
  r.rep?.ownerEmail === "cur@invoca.com" ? ok("an active owner beats an inactive one")
    : no("an inactive owner should not be preferred");
});

await withSf([], async () => {
  const r = await lookupRep("https://nowhere.example");
  !r.rep && /no salesforce account/i.test(r.reason ?? "")
    ? ok("no match refuses with the domain named")
    : no("an empty result should say which domain found nothing");
});

await withSf(new Error("INVALID_SESSION_ID"), async () => {
  const r = await lookupRep("https://claffeypools.com");
  !r.rep && !!r.reason ? ok("a Salesforce error is reported, never thrown")
    : no("a failing query must come back as a reason");
});

await withSf([{ Id: "1", Name: "No Owner", Website: "https://acme.com", Owner: null }], async () => {
  const r = await lookupRep("https://acme.com");
  !r.rep && /no owner email/i.test(r.reason ?? "")
    ? ok("an account with no owner email refuses") : no("a null Owner must not resolve");
});

{
  const r = await lookupRep("");
  !r.rep && !!r.reason ? ok("a demo with no website refuses rather than querying")
    : no("an empty website should refuse");
}

/* ---- 3. the send guards ------------------------------------------------------ */
console.log("\nThe notification — server-resolved, org-only, opt-in\n");

const api = code("engine/demoApi.ts");

/* ⚠️⚠️ THE ONE THAT MATTERS: the recipient may never come off the request body.
   This app sends from the maintainer's own Gmail, so accepting a `to` would make
   any signed-in SE able to mail anywhere as them. */
/\bbody\??\.(to|email|ownerEmail|recipient)\b/.test(api)
  ? no("demoApi reads a recipient address off the request body")
  : ok("the recipient never comes from the request body");

/* ⚠️ SLICED TO THE FUNCTION'S OWN BODY rather than matched within a character
   window — the first version used a 200-char window that the signature and the
   configured-guard already exceeded, so it failed on correct code. A window is a
   guess about formatting; the body is the thing the invariant is about. */
const notifyBody = api.slice(api.indexOf("async function notifyRep"));
notifyBody.includes("lookupRep(rec.websiteUrl)")
  ? ok("notifyRep resolves the rep itself, from the demo's own website")
  : no("notifyRep must resolve the address server-side");

/candidates\.find\(\(c\) => c\.accountId === accountId\)/.test(api)
  ? ok("a client-supplied accountId is matched against the resolved set")
  : no("an accountId from the browser must be checked, not looked up");

/endsWith\(`@\$\{domain\}`\)/.test(api)
  ? ok("the recipient must be inside the org's own email domain")
  : no("the send guard on the org domain is missing");

/orgEmailDomain/.test(api)
  ? ok("that domain comes from the one shared definition")
  : no("the org domain must come from engine/appEnv.ts, not a second copy");

/* Opt-in: nothing is sent unless the request asked for it. */
/body\?\.notify \? await notifyRep\(/.test(api)
  ? ok("nothing is emailed unless the mark asked to notify")
  : no("notification must be opt-in per mark");

const ctx = code("src/data/DemoLibraryContext.tsx");
/notify: true, accountId/.test(ctx) && !/ownerEmail:|to:/.test(ctx.split("/api/demos/${demoId}/mark")[1] ?? "")
  ? ok("the client sends only a flag and a choice, never an address")
  : no("the client must not send an address");

const btn = code("src/components/DemoMarkButton.tsx");
/useState\(false\)[\s\S]{0,80}?const \[rep/.test(btn) || /const \[notify, setNotify\] = useState\(false\)/.test(btn)
  ? ok("the notify control starts OFF")
  : no("notify must default to off");

/if \(!on \|\| rep \|\| repLoading\) return;/.test(btn)
  ? ok("the lookup fires on the tick, not on opening the panel")
  : no("opening the panel must not spend a SOQL query");

/if \(r\.ok && notify\) setSent\(/.test(btn)
  ? ok("the panel reports what happened to the email instead of just closing")
  : no("a closed panel is not evidence anybody was told");

/* ---- 4. wiring ---------------------------------------------------------------- */
console.log("\nWiring — both twins, and the public status flag\n");

for (const [f, label] of [["server.ts", "server.ts"], ["vite.config.ts", "the dev twin"]] as const) {
  const src = code(f);
  /salesforceConfigured/.test(src) ? ok(`${label} reports salesforceConfigured`) : no(`${label} is missing the status flag`);
  /handleDemoApi\([\s\S]{0,160}?base\)/.test(src) ? ok(`${label} passes a base URL for the email link`) : no(`${label} does not pass baseUrl`);
}

const status = code("engine/status.ts");
/salesforceConfigured: input\.salesforceConfigured/.test(status)
  ? ok("/api/status publishes it as a BOOLEAN passed in by the caller")
  : no("status must take the flag from its caller");
/SALESFORCE_CLIENT_SECRET|SALESFORCE_CLIENT_ID/.test(status)
  ? no("/api/status is PUBLIC and must never read a credential value")
  : ok("/api/status reads no Salesforce credential");

/\/rep/.test(api) && /\(\\\/duplicate\|\\\/mark\|\\\/rep\)\?/.test(api.replace(/\\/g, "\\\\")) || /\/duplicate\|\\\/mark\|\\\/rep/.test(api)
  ? ok("GET /api/demos/:id/rep is routed")
  : no("the rep route is not in the demo-route matcher");

const mail = code("engine/mailer.ts");
/replyTo: opts\.seEmail/.test(mail)
  ? ok("Reply goes to the SE who gave the demo, not the sending account")
  : no("the AE's reply must reach the SE");
/subject: `\$\{opts\.status\}:/.test(mail)
  ? ok("the status leads the subject, which is what an AE triages on")
  : no("the subject should carry the status");


/* ---- 5. the two auth paths ---------------------------------------------------- */
console.log("\nSalesforce auth — a refresh token OR a connected app\n");

const sfSrc = code("engine/salesforceApi.ts");
{
  for (const k of ["SALESFORCE_REFRESH_TOKEN", "SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET"]) delete process.env[k];
  !salesforceConfigured() ? ok("neither credential = not configured") : no("nothing set should not read as configured");

  process.env.SALESFORCE_REFRESH_TOKEN = "5Aep8…";
  salesforceConfigured() ? ok("a refresh token alone is enough (the CLI path, no admin)")
    : no("a refresh token alone should configure it");

  /* ⚠️ THE SHAPE THE CLI ACTUALLY WRITES: a refresh token and no secret, because
     `PlatformCLI` is a PUBLIC client. Sending a secret there fails the exchange. */
  let grant = "", sentSecret = true, usedClient = "";
  const rf = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    if (url.includes("/services/oauth2/token")) {
      const b = new URLSearchParams(String(init?.body));
      grant = b.get("grant_type") ?? "";
      sentSecret = b.has("client_secret");
      usedClient = b.get("client_id") ?? "";
      return new Response(JSON.stringify({ access_token: "t", instance_url: "https://invoca.my.salesforce.com" }), { status: 200 });
    }
    return new Response(JSON.stringify({ records: [] }), { status: 200 });
  }) as typeof fetch;
  await lookupRep("https://claffeypools.com");
  globalThis.fetch = rf;
  grant === "refresh_token" ? ok("it exchanges the refresh token, not client credentials") : no(`grant was "${grant}"`);
  usedClient === "PlatformCLI" ? ok("it defaults to Salesforce's own PlatformCLI app") : no(`client_id was "${usedClient}"`);
  !sentSecret ? ok("no client_secret is sent — PlatformCLI is a public client") : no("a secret must not be sent on the CLI path");
  delete process.env.SALESFORCE_REFRESH_TOKEN;
}
/instance_url \|\| process\.env\.SALESFORCE_INSTANCE_URL/.test(sfSrc)
  ? ok("the token response's own instance_url wins over the configured one")
  : no("a My Domain org needs the response's instance_url");

console.log("\nGmail — the notification comes FROM the SE who marked it\n");

const auth = code("googleAuth.ts");
const mailSrc = code("engine/mailer.ts");
const store = code("engine/gmailTokens.ts");

/auth\/gmail-connect/.test(auth) ? ok("/auth/gmail-connect exists") : no("the per-SE consent route is missing");

/* ⚠️ OPEN TO ANY SIGNED-IN SE, unlike /auth/gmail which mints the SHARED
   sender and is admin-only. Sliced to the handler's own body so the admin gate
   on the neighbouring route cannot satisfy it. */
{
  const i = auth.indexOf('app.get("/auth/gmail-connect"');
  const body = auth.slice(i, auth.indexOf("app.get(", i + 10));
  i >= 0 && !/isAdmin\(/.test(body)
    ? ok("it is per-user, NOT admin-gated (that is /auth/gmail's job)")
    : no("the per-SE route must not be admin-gated");
  /gmail\.send/.test(body) ? ok("it asks for the gmail.send scope") : no("without gmail.send it cannot send");
  /access_type: "offline"/.test(body) && /prompt: "consent"/.test(body)
    ? ok("offline + consent, or Google returns no refresh token at all")
    : no("the refresh token needs access_type=offline and prompt=consent");
}

/* ⚠️⚠️ **RE-AIMED 9/24/2026, NOT LOOSENED — THIS CHECK ASSERTED THE OPPOSITE.**
   It used to require the sign-in scope stay identity-only, on the argument that a
   send capability should be consented to where it is used. That was overruled
   directly (*"it should automatically just be sent as that user, they dont need
   to click anything"*), and a separate Connect step is exactly what "click
   anything" means. The INVARIANT is now that the grant rides sign-in and is
   actually captured — a widened scope that nobody stores would show the scary
   consent screen and still send from the platform mailbox, i.e. all of the cost
   and none of the benefit. */
{
  const i = auth.indexOf('app.get("/auth/login"');
  const body = auth.slice(i, auth.indexOf("app.get(", i + 10));
  /gmail\.send/.test(body) ? ok("the sign-in scope carries gmail.send") : no("sign-in must request the send scope");
  /access_type: "offline"/.test(body) ? ok("sign-in asks offline, or no refresh token ever comes back") : no("sign-in needs access_type=offline");
  /* ⚠️ And it must NOT set prompt=consent, which would re-show the consent
     screen on every single sign-in. */
  !/prompt: "consent"/.test(body)
    ? ok("sign-in does not force consent every time")
    : no("prompt=consent on the gate turns a one-time grant into a nag");
}
/if \(tok\.refresh_token\) saveGmailToken\(email, tok\.refresh_token\)/.test(auth)
  ? ok("the send token is stored on an ordinary sign-in, and only when present")
  : no("a widened scope that stores nothing is all cost and no benefit");

/saveGmailToken\(acct, tok\.refresh_token\)/.test(auth)
  ? ok("the per-SE token is STORED, not displayed")
  : no("a colleague's send credential must never be rendered on screen");
/gmailTokenPage\(acct, tok\.refresh_token\)/.test(auth)
  ? ok("the ADMIN leg still displays its one shared token, as before")
  : no("the shared-sender leg changed unexpectedly");

/* The two state prefixes must not be prefixes of one another, or every per-SE
   consent takes the admin branch and prints somebody's credential. */
!"gmailc:".startsWith("gmail:") && /startsWith\("gmailc:"\)/.test(auth)
  ? ok("the gmailc: and gmail: state prefixes cannot collide")
  : no("the two Gmail consent legs can be confused for one another");

/sendAs\?: string/.test(mailSrc) ? ok("sendMail takes a sendAs") : no("sendMail cannot send as anyone");
/replyTo: from/.test(mailSrc)
  ? ok("sending as the SE makes From and Reply-To the same person")
  : no("a message sent as the SE should not carry a foreign Reply-To");
/falling back to the platform mailbox/.test(mailSrc)
  ? ok("a dead personal grant falls back rather than losing the notification")
  : no("the fallback must not be removed");
/getGmailToken\(sendAs\)/.test(mailSrc) ? ok("it reads the SE's own stored token") : no("sendAs is not resolved to a token");

/* ⚠️⚠️ ORDER: the personal mailbox is tried BEFORE the shared-sender guard. An
   org with only per-user tokens and no platform account is a supported setup,
   and with `mailConfigured()` first every notification would refuse as "not
   configured" while a good personal token sat on disk. The non-production guard
   must still come first — nothing sends off production, whoever the sender is. */
{
  const body = mailSrc.slice(mailSrc.indexOf("export async function sendMail"));
  const prod = body.indexOf("isProduction()");
  const personal = body.indexOf("if (sendAs)");
  const shared = body.indexOf("if (!mailConfigured())");
  prod >= 0 && personal > prod && shared > personal
    ? ok("personal mailbox is tried before the shared-sender guard, and after the production guard")
    : no("sendMail's guard order would refuse a per-user-only server");
}

const notifyBody2 = api.slice(api.indexOf("async function notifyRep"));
/\}\), user\.email\)/.test(notifyBody2)
  ? ok("the AE notification is sent as the SE who marked the demo")
  : no("the notification does not pass the SE as the sender");

/* ⚠️ THE FEEDBACK MAIL MUST **NOT** BE SENT AS ANYONE — it is from the platform
   to the maintainer, and sending it as the submitter would be a different claim. */
const fb = code("engine/feedbackApi.ts");
/sendMail\([^)]*\),\s*[a-zA-Z]/.test(fb)
  ? no("a feedback email is being sent as a person")
  : ok("feedback mail still comes from the platform, not from a person");

/gmail-tokens/.test(store) && !/drive-tokens/.test(store)
  ? ok("the send token has its own directory, separate from Drive's")
  : no("Gmail and Drive tokens must not share a store");

for (const [f, label] of [["server.ts", "server.ts"], ["vite.config.ts", "the dev twin"]] as const) {
  const src = code(f);
  /api\/gmail-status/.test(src) ? ok(`${label} serves /api/gmail-status`) : no(`${label} is missing gmail-status`);
  /api\/gmail\/disconnect/.test(src) ? ok(`${label} serves /api/gmail/disconnect`) : no(`${label} is missing the disconnect`);
}

/auth\/gmail-connect/.test(code("src/components/DemoMarkButton.tsx"))
  ? ok("the panel offers to connect, rather than hiding the fallback")
  : no("the SE is never told which mailbox it sends from");

console.log(bad ? `\n${bad} FAILED\n` : "\nAll checks passed\n");
process.exit(bad ? 1 : 0);
