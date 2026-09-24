/* =============================================================================
   audit-advanced.ts — the launch form's Advanced settings
   -----------------------------------------------------------------------------
   Custom prompt, Agent-Studio-only, attached documents, and the Gong / Drive /
   Slack context providers. Every one of these fails QUIETLY if it breaks:

     • the custom prompt reaches the model by riding on the research brief, so a
       refactor that stops appending it leaves a field the SE types into that
       changes nothing — the silent no-op this repo has recorded six times;
     • Agent-Studio-only skips phases by resolving `undefined` into a
       POSITIONALLY destructured pool, so a mis-wrapped phase would shift every
       slice one place left and render as data rather than as a fault;
     • a skipped phase that emitted no progress event would sit at "pending"
       forever and the % bar could never reach 100;
     • a provider that reports `configured` without a credential would offer a
       context source the server cannot fetch.
   ============================================================================= */
import { readFileSync, existsSync } from "node:fs";

let fail = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => { console.log(`  FAIL  ${m}`); fail++; };
const read = (p: string) => readFileSync(p, "utf8");
/* Comments stripped before any source match — an audit here has fired on its own
   documentation before, and a check that reddens on correct code gets deleted. */
const code = (p: string) => read(p).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

/* ── the context block ───────────────────────────────────────────────────── */
console.log("\nGeneration context\n");

const { contextBlock, hasContext, contextProvenance, parseGenerationRequest } =
  await import("../engine/genContext.ts");

hasContext(undefined) === false && contextBlock(undefined) === ""
  ? ok("no context adds nothing to the prompt (the default path is untouched)")
  : bad("an empty context still injects a block, so every default generation carries it");

const sample = {
  steer: "Use healthcare language instead of sales.",
  sources: [{ label: "Q4 strategy.docx", text: "Lead with the SMS agent." }],
};
const block = contextBlock(sample);
block.includes("healthcare language")
  ? ok("the custom prompt reaches the prompt block")
  : bad("the custom prompt is missing from the block");
block.includes("Q4 strategy.docx") && block.includes("Lead with the SMS agent")
  ? ok("an attached document's label and text both reach the block")
  : bad("attached document text is missing from the block");

/* ⚠️⚠️ THE PRECEDENCE SENTENCE IS THE POINT. `reskin()` tells every phase to keep
   the structure identical; a custom prompt asking for another column fights that
   directly, and this repo's own history records the result — a self-contradicting
   prompt is worse than either rule, because the model picks one at random. */
/STRUCTURAL RULES WIN/.test(block)
  ? ok("the block states that the structural rules beat the custom prompt")
  : bad("the precedence sentence is gone — a custom prompt can now fight the structure rules");
/do NOT invent facts/i.test(block)
  ? ok("the block forbids inventing facts the context does not contain")
  : bad("nothing stops the model treating the context as source data to copy");

/* A pasted book must not push the research brief out of 20 prompts. */
const huge = contextBlock({ sources: [{ label: "big.txt", text: "x".repeat(50_000) }] });
huge.length < 12_000
  ? ok(`a 50k-character document is clamped (block is ${huge.length} chars)`)
  : bad(`a huge document is not clamped — block came out ${huge.length} chars`);

/* ── the request parser (one parser, two servers) ────────────────────────── */
console.log("\nRequest parsing\n");

const parsed = parseGenerationRequest({
  name: "X", url: "y", steer: "  trim me  ", scope: "agent",
  sources: [{ label: "a.docx", text: "hello" }, { label: "", text: "  " }, { text: "no label" }],
});
parsed.scope === "agent" ? ok("scope \"agent\" is accepted") : bad("scope \"agent\" was not accepted");
parseGenerationRequest({ scope: "everything" }).scope === "full"
  ? ok("an unknown scope falls back to a FULL generation")
  /* Failing the other way silently skips 13 phases, which is the more damaging
     way to be wrong: a thin demo that looks finished. */
  : bad("an unknown scope does not fall back to full — it could silently skip 13 phases");
parseGenerationRequest({}).scope === "full"
  ? ok("no scope means a full generation")
  : bad("a missing scope does not default to full");
parsed.context.steer === "trim me" ? ok("the steer is trimmed") : bad(`steer not trimmed: ${JSON.stringify(parsed.context.steer)}`);
parsed.context.sources?.length === 2
  ? ok("empty-text sources are dropped, text-only sources are kept and labelled")
  : bad(`expected 2 usable sources, got ${parsed.context.sources?.length}`);
parsed.context.sources?.every((s) => s.label.trim())
  ? ok("every kept source has a label")
  : bad("a source came through with no label");

/* ── provenance ─────────────────────────────────────────────────────────── */
console.log("\nProvenance\n");

const prov = contextProvenance(sample, "agent");
prov.scope === "agent" && !!prov.at
  ? ok("the profile records the scope and when it was generated")
  : bad("provenance is missing the scope or the timestamp");
/* ⚠️ LABELS ONLY. A demo record is readable by the whole team; a strategy doc
   pasted into one would travel with it forever. */
!JSON.stringify(prov).includes("Lead with the SMS agent")
  ? ok("provenance records document LABELS, never the document text")
  : bad("the document's text is stored on the profile — it would travel with the demo");
JSON.stringify(prov).includes("Q4 strategy.docx")
  ? ok("the document label is recorded, so an odd demo can be traced to its context")
  : bad("no record of which documents steered the generation");

/* ── the engine wiring ──────────────────────────────────────────────────── */
console.log("\nEngine wiring\n");

const core = code("engine/core.ts");

/* ⚠️ THE WHOLE MECHANISM: the context rides on `brief`, which is already
   interpolated into every phase prompt. If this line goes, the panel keeps
   working and changes nothing. */
/const brief = researched \+ contextBlock\(opts\.context\)/.test(core)
  ? ok("the context is appended to the research brief (reaching all 20 phases)")
  : bad("the context no longer rides on the brief — the custom prompt would be a silent no-op");

/* ⚠️ AND IT HAS TO LAND BEFORE `generateTerms`, which picks bookingTerm and
   customerNoun. "Use healthcare language" must reach the phase that decides
   Patient vs Customer, or the vocabulary is settled before anything else. */
core.indexOf("contextBlock(opts.context)") < core.indexOf("generateTerms(client, name, brief)")
  ? ok("the context is in place before generateTerms picks the vocabulary")
  : bad("generateTerms runs before the context is appended — a steer could not change Patient vs Customer");

/* Concurrency: a module-level global would leak one SE's prompt into another's
   generation (two SEs at once, or the canary overlapping a real run). */
!/^(const|let|var)\s+\w*[sS]teer\w*\s*=/m.test(core)
  ? ok("no module-level steer state (so concurrent generations cannot cross-talk)")
  : bad("a module-level steer variable exists — concurrent generations could leak into each other");

const AGENT_KEEP = ["agentConfig", "digitalInsights", "dashboard", "dashboardChannels", "dashboardSegments"];
const kept = AGENT_KEEP.filter((p) => new RegExp(`\\(\\) => phase\\("${p}"`).test(core));
kept.length === AGENT_KEEP.length
  ? ok(`the ${AGENT_KEEP.length} phases an agent-only run needs are never skipped`)
  /* digitalInsights and marketingDashboard (the dashboard trio) are REQUIRED by
     CustomerProfile — skipping them fails the final Zod parse. */
  : bad(`these must always run but are skippable: ${AGENT_KEEP.filter((p) => !kept.includes(p)).join(", ")}`);

const wrapped = (core.match(/maybe\("/g) ?? []).length;
wrapped >= 13
  ? ok(`${wrapped} phases are skippable on an agent-only run`)
  : bad(`only ${wrapped} phases are skippable — expected at least 13`);

/* ⚠️ RESOLVING undefined, NOT FILTERING THE ARRAY. The pool's results are
   destructured positionally; dropping an entry shifts every slice after it. */
/return Promise\.resolve\(undefined\)/.test(core) && !/\.filter\([^)]*\)\s*,\s*CONCURRENCY/.test(core)
  ? ok("a skipped phase resolves undefined rather than being filtered out of the pool")
  : bad("phases look filtered out of the pool — positional destructuring would silently shift");

/* ⚠️ A SKIPPED PHASE STILL REPORTS, or the checklist spins forever. */
/progress\(\{ phase: label, status: "skip" \}\)/.test(core)
  ? ok("a skipped phase still emits a progress event")
  : bad("skipped phases report nothing — the checklist would sit at pending and the bar never finish");

/* ── the launch screen ──────────────────────────────────────────────────── */
console.log("\nLaunch screen\n");

const launch = code("src/screens/Launch.tsx");
const adv = code("src/components/AdvancedSettings.tsx");

/* Untouched settings must send the request the form always sent. */
/\.\.\.\(adv\.steer\.trim\(\) \? \{ steer/.test(launch) &&
/\.\.\.\(adv\.agentOnly \? \{ scope: "agent" \}/.test(launch) &&
/\.\.\.\(adv\.docs\.length \? \{ sources/.test(launch)
  ? ok("all three settings are sent, and omitted when untouched")
  : bad("a setting is not conditionally added to the request body");

/skipped/.test(launch) && /skippedWeight/.test(launch)
  ? ok("the launch checklist and the weighted bar both handle a skipped phase")
  : bad("the launch screen does not handle the skip status");
/TOTAL_WEIGHT - skippedWeight/.test(launch)
  ? ok("skipped phases leave the bar's denominator, so it still reaches 100")
  : bad("skipped weight is not removed from the total — the bar would stall short");

/useState\(false\)/.test(adv) && /Advanced settings/.test(adv)
  ? ok("the panel is collapsed by default")
  : bad("the panel is not collapsed by default");
/adv-on-dot/.test(adv)
  ? ok("a collapsed panel shows a dot when settings are in use")
  : bad("a collapsed panel could hide that it will change the generation");
/\.length\.toLocaleString\(\)/.test(adv)
  ? ok("an attached document reports its character count (proof it was read)")
  : bad("no character count on an attached document — a silent empty extraction would look fine");

/* ── providers ──────────────────────────────────────────────────────────── */
console.log("\nContext providers\n");

const { gongConfigured, slackConfigured, driveConfigured } = await import("../engine/integrations.ts");
for (const [name, fn, vars] of [
  ["Gong", gongConfigured, ["GONG_ACCESS_KEY", "GONG_SECRET"]],
  ["Slack", slackConfigured, ["SLACK_BOT_TOKEN"]],
  ["Drive", driveConfigured, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_DRIVE_ENABLED"]],
] as const) {
  const saved = vars.map((v) => process.env[v]);
  for (const v of vars) delete process.env[v];
  const off = fn();
  for (const v of vars) process.env[v] = "x";
  if (vars.includes("GOOGLE_DRIVE_ENABLED" as never)) process.env.GOOGLE_DRIVE_ENABLED = "1";
  const on = fn();
  vars.forEach((v, i) => { if (saved[i] === undefined) delete process.env[v]; else process.env[v] = saved[i]!; });
  off === false && on === true
    ? ok(`${name} reports configured only when its credential is present`)
    : bad(`${name} misreports configuration (without=${off}, with=${on})`);
}

const status = code("engine/status.ts");
["gongConfigured", "slackConfigured", "driveConfigured"].every((k) => status.includes(k))
  ? ok("/api/status reports all three providers")
  : bad("a provider is missing from /api/status, so the panel cannot know about it");
/* PUBLIC endpoint: booleans only, never a credential's value. */
!/GONG_SECRET|SLACK_BOT_TOKEN|process\.env\.GONG/.test(status)
  ? ok("status reads no credential VALUES (it is a public endpoint)")
  : bad("engine/status.ts touches a credential value — that endpoint is public");

existsSync("docs/INTEGRATIONS.md")
  ? ok("docs/INTEGRATIONS.md exists (what to obtain per provider)")
  : bad("docs/INTEGRATIONS.md is missing, and the panel points at it");

/* ── Google Drive: per-user OAuth ───────────────────────────────────────── */
console.log("\nGoogle Drive (per-user OAuth)\n");

/* A throwaway disk, set BEFORE driveTokens.ts is ever imported — DATA_DIR is
   resolved once at module load, so this only works because it is the first
   thing in the whole audit chain that touches that module. */
process.env.DATA_DIR = `/tmp/audit-advanced-drive-${process.pid}`;
const driveTokens = await import("../engine/driveTokens.ts");
const testEmail = "audit-test@invoca.com";
driveTokens.hasDriveToken(testEmail) === false
  ? ok("an SE who has never connected Drive has no stored token")
  : bad("hasDriveToken reports true before anything was ever saved");
driveTokens.saveDriveToken(testEmail, "a-fake-refresh-token");
driveTokens.hasDriveToken(testEmail) === true && driveTokens.getDriveToken(testEmail) === "a-fake-refresh-token"
  ? ok("connecting stores the refresh token and it reads back exactly")
  : bad("a saved token did not read back correctly");
driveTokens.removeDriveToken(testEmail);
driveTokens.hasDriveToken(testEmail) === false
  ? ok("disconnecting actually removes the stored token, not just hides it")
  : bad("removeDriveToken did not clear the stored token");

const { fetchPrivateGoogleDocText, DriveReconnectError } = await import("../engine/driveApi.ts");
const realFetch = globalThis.fetch;
async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>) {
  globalThis.fetch = impl as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = realFetch; }
}

/* No token at all: refused before ever calling Google. */
try {
  await fetchPrivateGoogleDocText("https://docs.google.com/document/d/x/edit", testEmail);
  bad("fetchPrivateGoogleDocText did not refuse an SE with no connected Drive");
} catch (e) {
  e instanceof DriveReconnectError
    ? ok("no stored token → refused as a reconnect case, before any network call")
    : bad(`wrong error for no stored token: ${(e as Error).message}`);
}

/* A dead refresh token (Google's invalid_grant) — must be a DriveReconnectError
   AND must clear the stored token, so the panel's next check already shows
   disconnected rather than a token that keeps failing the same way forever. */
driveTokens.saveDriveToken(testEmail, "dead-token");
try {
  await withFetch(async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token"))
      return { ok: false, json: async () => ({ error: "invalid_grant" }) } as Response;
    throw new Error("should not reach Drive API with no access token");
  }, () => fetchPrivateGoogleDocText("https://docs.google.com/document/d/x/edit", testEmail));
  bad("a dead refresh token was not refused");
} catch (e) {
  e instanceof DriveReconnectError && !driveTokens.hasDriveToken(testEmail)
    ? ok("a dead refresh token (invalid_grant) is a reconnect case, and the stored token is cleared")
    : bad(`a dead refresh token was mishandled: ${(e as Error).message}, cleared=${!driveTokens.hasDriveToken(testEmail)}`);
}

/* A live call 401ing mid-flight (access revoked after the access token was
   already minted) must ALSO be a reconnect case, not a bare "not found." */
driveTokens.saveDriveToken(testEmail, "token-that-401s-live");
try {
  await withFetch(async (url) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) return { ok: true, json: async () => ({ access_token: "t", expires_in: 3600 }) } as Response;
    if (u.includes("drive/v3/files/")) return { ok: false, status: 401, json: async () => ({}) } as Response;
    throw new Error("unexpected fetch: " + u);
  }, () => fetchPrivateGoogleDocText("https://docs.google.com/document/d/x/edit", testEmail));
  bad("a live 401 from the Drive API was not refused");
} catch (e) {
  e instanceof DriveReconnectError
    ? ok("a live 401 from the Drive API is also a reconnect case (not a bare 'not found')")
    : bad(`a live 401 was mishandled: ${(e as Error).message}`);
}

/* An unrelated failure (file genuinely not found / no access) must NOT be a
   DriveReconnectError — the doc-link endpoint uses exactly that distinction to
   decide whether to fall back to the public-export path. */
driveTokens.saveDriveToken(testEmail, "a-live-token");
try {
  await withFetch(async (url) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) return { ok: true, json: async () => ({ access_token: "t", expires_in: 3600 }) } as Response;
    if (u.includes("drive/v3/files/")) return { ok: false, status: 404, json: async () => ({}) } as Response;
    throw new Error("unexpected fetch: " + u);
  }, () => fetchPrivateGoogleDocText("https://docs.google.com/document/d/x/edit", testEmail));
  bad("a genuine 'not found' was not refused");
} catch (e) {
  !(e instanceof DriveReconnectError)
    ? ok("a genuine 'not found' is NOT a reconnect case, so the doc-link endpoint can fall back to public")
    : bad("a plain 'not found' was misclassified as a reconnect case — the public fallback would never run");
}

/* The success path: a native Google Doc exports as plain text. */
try {
  const result = await withFetch(async (url) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) return { ok: true, json: async () => ({ access_token: "t", expires_in: 3600 }) } as Response;
    if (u.includes("/export?mimeType=text/plain")) return { ok: true, text: async () => "the actual doc text" } as Response;
    if (u.includes("drive/v3/files/")) return { ok: true, json: async () => ({ name: "Strategy Doc", mimeType: "application/vnd.google-apps.document" }) } as Response;
    throw new Error("unexpected fetch: " + u);
  }, () => fetchPrivateGoogleDocText("https://docs.google.com/document/d/x/edit", testEmail));
  result.text === "the actual doc text" && result.label === "Strategy Doc"
    ? ok("a native Google Doc reads its real name and exports its real text")
    : bad(`a native Google Doc export came back wrong: ${JSON.stringify(result)}`);
} catch (e) {
  bad(`the success path threw: ${(e as Error).message}`);
}
driveTokens.removeDriveToken(testEmail);

/* ⚠️ A dead access-token cache must not survive a reconnect: the accessTokenFor
   cache is keyed by email and is never cleared just by saving a NEW token, so a
   stale cached access token from a revoked connection could otherwise outlive
   the reconnect until it expires on its own. */
const server = code("server.ts");
/hasDriveToken\(email\)/.test(server) && /fetchPrivateGoogleDocText/.test(server) && /DriveReconnectError/.test(server)
  ? ok("server.ts's doc-link route tries the private path and distinguishes DriveReconnectError")
  : bad("server.ts's doc-link route is missing the private-Drive wiring");
/instanceof DriveReconnectError\) return res\.status\(400\)/.test(server)
  ? ok("server.ts returns a reconnect error as-is rather than falling back to public")
  : bad("server.ts does not special-case a reconnect error — it would fall back and confuse the SE");
/app\.get\("\/api\/drive-status"/.test(server) && /app\.post\("\/api\/drive\/disconnect"/.test(server)
  ? ok("server.ts serves both /api/drive-status and /api/drive/disconnect")
  : bad("server.ts is missing one of the Drive status/disconnect routes");

const viteConfig = code("vite.config.ts");
/\/api\/drive-status/.test(viteConfig) && /\/api\/drive\/disconnect/.test(viteConfig) && /fetchPrivateGoogleDocText/.test(viteConfig)
  ? ok("vite.config.ts's dev twin carries the same Drive routes as server.ts")
  : bad("the dev twin is missing Drive wiring server.ts has — the two servers would disagree");

const authSrc = code("googleAuth.ts");
/app\.get\("\/auth\/drive"/.test(authSrc)
  ? ok("/auth/drive exists")
  : bad("/auth/drive is missing");
/* ⚠️ Drive must be open to any signed-in SE — unlike /auth/gmail, which mints
   ONE shared credential and is deliberately admin-gated. Checked by requiring
   NO isAdmin() call between the /auth/drive handler and the next app.get. */
(() => {
  const start = authSrc.indexOf('app.get("/auth/drive"');
  const end = authSrc.indexOf("app.get(", start + 10);
  const body = authSrc.slice(start, end === -1 ? undefined : end);
  !body.includes("isAdmin(")
    ? ok("/auth/drive is open to any signed-in SE, not admin-gated like /auth/gmail")
    : bad("/auth/drive checks isAdmin() — Drive should be per-user, not admin-only");
})();
/state\.startsWith\("drive:"\)/.test(authSrc) && /saveDriveToken\(acct, tok\.refresh_token\)/.test(authSrc)
  ? ok("the callback's drive: branch stores the refresh token rather than displaying it")
  : bad("the drive: callback branch does not store the token the way Gmail's branch displays it");

const advTsx = code("src/components/AdvancedSettings.tsx");
/interface DriveStatus/.test(advTsx) && !/drive: boolean/.test(advTsx)
  ? ok("Drive status is tracked separately from the Gong/Slack service-credential table")
  : bad("Drive is still folded into the generic provider table — it needs its own per-user state");
/href="\/auth\/drive"/.test(advTsx)
  ? ok("the panel's Connect control links to /auth/drive")
  : bad("no link to /auth/drive in the panel — Connect would do nothing");
/api\/drive\/disconnect/.test(advTsx)
  ? ok("the panel's Disconnect control calls /api/drive/disconnect")
  : bad("no call to /api/drive/disconnect — Disconnect would do nothing");
/drive=connected/.test(advTsx)
  ? ok("the panel opens itself after the /auth/drive round trip so the SE sees it connected")
  : bad("nothing reopens the panel after connecting — the SE would see no change");

/* ── Gong: a search, not a link ─────────────────────────────────────────── */
console.log("\nGong (search-based, no per-item link)\n");

const gong = await import("../engine/gongApi.ts");

/* Token matching — whole tokens, so it is fuzzier about punctuation and
   conjunctions while STILL being stricter than a substring. */
gong.titleMentions("Orlando Health Discussion", "Orlando Health")
  ? ok("a real call title is matched against the prospect name")
  : bad("a title that plainly names the account was not matched");
gong.titleMentions("Invoca X Summit Orthopedics", "Summit Orthopedics")
  ? ok("a multi-word name matches as a whole phrase")
  : bad("a multi-word phrase match failed");

/* ⚠️ THE REPORTED CASE: Gong titles it "AVI & Co." and an SE cannot be expected
   to know that. Every one of these has to find it. */
const AVI_TITLE = "AVI & Co. / Invoca";
for (const typed of ["Avi and Co", "Avi & Co", "AVI & Co.", "avi and co.", "Avi Co", "Avi & Co., Inc."]) {
  gong.titleMentions(AVI_TITLE, typed)
    ? ok(`"${typed}" finds a call titled "${AVI_TITLE}"`)
    : bad(`"${typed}" did NOT find "${AVI_TITLE}" — the & / and / punctuation variants must all match`);
}
/* ...and the fuzziness must not become a substring match. */
!gong.titleMentions("Aviation Co Weekly Ops", "Avi & Co")
  ? ok('"Avi & Co" does NOT match "Aviation Co Weekly Ops" (whole tokens, not substrings)')
  : bad('"Avi" matched inside "Aviation" — the token compare is not whole-token');
!gong.titleMentions("Orlando Utilities Health Fair", "Orlando Health")
  ? ok("a phrase still has to be CONTIGUOUS — scattered tokens are not a match")
  : bad("scattered tokens matched, so any two words in a title would claim the account");
!gong.titleMentions("Catering Co Weekly Sync", "Cat")
  ? ok("a short name does NOT match as a bare substring of an unrelated word")
  : bad("'Cat' matched inside 'Catering' — this is the exact class of bug this repo has hit before");
gong.titleMentions("Cat Financial Demo", "Cat")
  ? ok("...but the same short name DOES match as its own whole token")
  : bad("a short name failed to match even as a real whole-token occurrence");
gong.titleMentions("Moffitt Cancer Center Sync", "Moffitt Cancer Center, Inc.")
  ? ok("a typed legal suffix is dropped, so the full legal name still finds the informal title")
  : bad("a trailing 'Inc.' stopped a real match");
/* ⚠️⚠️ THE FLOOR ON SUFFIX-STRIPPING: never below two tokens, or "Avi & Co"
   would degrade to the bare token "avi" and claim anything. */
gong.searchPhrases("Avi & Co").every((p) => p.length >= 2)
  ? ok("suffix-stripping never produces a one-token phrase from a two-token name")
  : bad(`searchPhrases("Avi & Co") produced a phrase shorter than 2 tokens: ${JSON.stringify(gong.searchPhrases("Avi & Co"))}`);
!gong.titleMentions("Avi Jewelry Roadshow", "Avi & Co")
  ? ok("...so an unrelated 'Avi ...' title is not claimed by a search for 'Avi & Co'")
  : bad("'Avi & Co' matched an unrelated title on one token — the ≥2-token floor is not holding");
JSON.stringify(gong.normTokens("AVI & Co. / Invoca")) === JSON.stringify(["avi", "co", "invoca"])
  ? ok("normTokens folds &/punctuation/case and drops conjunctions")
  : bad(`normTokens produced ${JSON.stringify(gong.normTokens("AVI & Co. / Invoca"))}`);
gong.domainOf("https://www.orlandohealth.com/careers") === "orlandohealth.com" &&
gong.domainOf("orlandohealth.com") === "orlandohealth.com"
  ? ok("domainOf strips protocol, path and www consistently either way")
  : bad("domainOf normalises a URL and a bare domain differently");

/* Full-flow tests against a MOCKED fetch — never the real Gong API, so this
   passes with no credential on the machine running it. */
const gongRealFetch = globalThis.fetch;
async function withGongFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  globalThis.fetch = impl as typeof fetch;
  try { return await run(); } finally { globalThis.fetch = gongRealFetch; }
}
function withGongEnv<T>(run: () => T): T {
  const savedKey = process.env.GONG_ACCESS_KEY, savedSecret = process.env.GONG_SECRET;
  process.env.GONG_ACCESS_KEY = "test-key"; process.env.GONG_SECRET = "test-secret";
  try { return run(); }
  finally {
    if (savedKey === undefined) delete process.env.GONG_ACCESS_KEY; else process.env.GONG_ACCESS_KEY = savedKey;
    if (savedSecret === undefined) delete process.env.GONG_SECRET; else process.env.GONG_SECRET = savedSecret;
  }
}

/* No credential at all: refused before any network call. */
{
  delete process.env.GONG_ACCESS_KEY; delete process.env.GONG_SECRET;
  let calls = 0;
  const result = await withGongFetch(async () => { calls++; throw new Error("should never fetch"); },
    () => gong.gongLookup("Anyone", "https://example.com"));
  result === null && calls === 0
    ? ok("with no credential, gongLookup returns null and makes zero network calls")
    : bad(`gongLookup should have short-circuited (result=${result}, calls=${calls})`);
}

/* A matching title, enriched, no CRM link present — kept, per the design note
   that a title match alone is specific enough to trust when there is nothing
   to cross-check against. */
await withGongEnv(() => withGongFetch(async (url) => {
  const u = String(url);
  if (u.includes("/v2/calls?")) {
    return { ok: true, json: async () => ({
      records: { totalRecords: 1 }, calls: [{ id: "c1", title: "Acme Corp Demo", scheduled: "2026-08-01T00:00:00Z" }],
    }) } as Response;
  }
  if (u.includes("/v2/calls/extensive")) {
    return { ok: true, json: async () => ({ calls: [{
      metaData: { scheduled: "2026-08-01T00:00:00Z", title: "Acme Corp Demo" },
      content: { brief: "Discussed pricing and rollout timeline.", keyPoints: [{ text: "Wants a Q4 start" }], trackers: [{ name: "Competitor Mention", count: 2 }] },
      context: [],
    }] }) } as Response;
  }
  throw new Error("unexpected fetch: " + u);
}, () => gong.gongLookup("Acme Corp", "https://www.acme.com"))).then((result) => {
  result?.label === "Gong — account call history" &&
  result.text.includes("Discussed pricing") &&
  result.text.includes("Wants a Q4 start") &&
  result.text.includes("Competitor Mention")
    ? ok("a real match with no CRM link is kept, and the brief/key points/trackers all reach the text")
    : bad(`the synthesized source was wrong: ${JSON.stringify(result)}`);
});

/* A matching title whose linked CRM Account is a DIFFERENT company — dropped,
   proving the cross-check actually filters rather than merely existing. */
await withGongEnv(() => withGongFetch(async (url) => {
  const u = String(url);
  if (u.includes("/v2/calls?")) {
    return { ok: true, json: async () => ({
      records: { totalRecords: 1 }, calls: [{ id: "c2", title: "Acme Corp Demo", scheduled: "2026-08-01T00:00:00Z" }],
    }) } as Response;
  }
  if (u.includes("/v2/calls/extensive")) {
    return { ok: true, json: async () => ({ calls: [{
      metaData: { scheduled: "2026-08-01T00:00:00Z", title: "Acme Corp Demo" },
      content: { brief: "Wrong company entirely." },
      context: [{ system: "Salesforce", objects: [{ objectType: "Account", fields: [{ name: "Website", value: "totallydifferent.com" }] }] }],
    }] }) } as Response;
  }
  throw new Error("unexpected fetch: " + u);
}, () => gong.gongLookup("Acme Corp", "https://www.acme.com"))).then((result) => {
  result === null
    ? ok("a title match whose linked CRM Account is a DIFFERENT domain is dropped, not trusted")
    : bad("the domain cross-check did not filter a genuinely mismatched account");
});

/* Nothing matches anywhere: confirms the search actually widens across more
   than one time window rather than giving up after the first. */
await withGongEnv(() => {
  const seen = new Set<string>();
  return withGongFetch(async (url) => {
    const u = String(url);
    const params = new URL(u).searchParams;
    seen.add(`${params.get("fromDateTime")}|${params.get("toDateTime")}`);
    return { ok: true, json: async () => ({ records: { totalRecords: 0 }, calls: [] }) } as Response;
  }, async () => { await gong.gongLookup("Nobody Matches This", "https://example.com"); return seen; });
}).then((seen) => {
  seen.size >= 3
    ? ok(`no match anywhere widens across all ${seen.size} time windows before giving up`)
    : bad(`only queried ${seen.size} distinct window(s) — widening may have stopped early`);
});

/* A pathological "infinite pages, never matches" workspace must still
   terminate — the page BUDGET is what stops it, not luck. */
await withGongEnv(() => {
  let pageCalls = 0;
  return withGongFetch(async (url) => {
    const u = String(url);
    if (!u.includes("/v2/calls?")) throw new Error("unexpected fetch: " + u);
    pageCalls++;
    return { ok: true, json: async () => ({
      records: { totalRecords: 999999, cursor: "next" },
      calls: [{ id: `x${pageCalls}`, title: "Never Matches Anything", scheduled: "2026-08-01T00:00:00Z" }],
    }) } as Response;
  }, async () => { await gong.gongLookup("Distinct Prospect Name", "https://example.com"); return pageCalls; });
}).then((pageCalls) => {
  pageCalls > 0 && pageCalls <= gong.MAX_PAGES
    ? ok(`an endlessly-paginating workspace still stops at the page budget (${pageCalls} <= ${gong.MAX_PAGES})`)
    : bad(`page budget was not enforced — made ${pageCalls} calls against a cap of ${gong.MAX_PAGES}`);
});

/* ⚠️ THE URL IS OPTIONAL. It only ever feeds the CRM cross-check, so a search
   with no URL must still work — requiring it is what once made the panel's
   button a dead end before the launch form was filled in. Note this mock's
   account resolves to a DIFFERENT domain and is still kept, which is the
   cross-check correctly standing down rather than silently passing. */
await withGongEnv(() => withGongFetch(async (url) => {
  const u = String(url);
  if (u.includes("/v2/calls?")) {
    return { ok: true, json: async () => ({
      records: { totalRecords: 1 }, calls: [{ id: "c3", title: "Acme Corp Demo", scheduled: "2026-08-01T00:00:00Z" }],
    }) } as Response;
  }
  if (u.includes("/v2/calls/extensive")) {
    return { ok: true, json: async () => ({ calls: [{
      metaData: { scheduled: "2026-08-01T00:00:00Z", title: "Acme Corp Demo" },
      content: { brief: "Found with no URL to cross-check against." },
      context: [{ system: "Salesforce", objects: [{ objectType: "Account", fields: [{ name: "Website", value: "somethingelse.com" }] }] }],
    }] }) } as Response;
  }
  throw new Error("unexpected fetch: " + u);
}, () => gong.gongLookup("Acme Corp", ""))).then((result) => {
  result?.text.includes("no URL to cross-check")
    ? ok("a search with NO url still works (the cross-check stands down rather than dropping everything)")
    : bad("gongLookup returned nothing when given no URL — the button would be a dead end again");
});

/* Wiring: both servers, and the panel. */
!/gong:\s*p\.key\)|key:\s*"gong"/.test(advTsx)
  ? ok("Gong is no longer a generic inert row in the 'Pull context from' list")
  : bad("Gong is still listed in PROVIDERS — it should have its own real control instead");
/adv-lookup-input/.test(advTsx) && /gongQuery \?\? prospectName/.test(advTsx)
  ? ok("the Gong row has its own editable search box, seeded from the prospect name")
  : bad("no editable Gong search term — a lookup button with nothing to type into is a dead end");
/disabled=\{disabled \|\| busyGong \|\| !integrations\?\.gong \|\| !gongTerm\.trim\(\)\}/.test(advTsx)
  ? ok("the button is gated on the SEARCH TERM (and the credential), not on the launch form's URL")
  : bad("the Gong button's disabled condition still depends on something other than the search term");
/* ⚠️ SCOPED TO THE GONG HANDLER'S OWN BODY. A whole-file scan matches
   /api/generate's `if (!name || !url)`, which legitimately DOES require both —
   the first version of this check failed on correct code for exactly that
   reason, which is the probe-not-code fault this file keeps recording. */
const handlerBody = (src: string, startMark: string, nextMark: RegExp): string => {
  const start = src.indexOf(startMark);
  if (start < 0) return "";
  const rest = src.slice(start + startMark.length);
  const end = rest.search(nextMark);
  return end < 0 ? rest : rest.slice(0, end);
};
const gongHandler = handlerBody(server, 'app.post("/api/gong-lookup"', /app\.(post|get|use)\(/);
gongHandler && !/if \(!name \|\| !url\)/.test(gongHandler) && /if \(!name\) return res\.status\(400\)/.test(gongHandler)
  ? ok("server.ts's Gong handler requires only a name, not a URL")
  : bad("server.ts's Gong handler still refuses a search without a URL");
const gongDevHandler = handlerBody(viteConfig, "'/api/gong-lookup'", /server\.middlewares\.use\(/);
gongDevHandler && !/if \(!name \|\| !url\)/.test(gongDevHandler) && /if \(!name\)/.test(gongDevHandler)
  ? ok("the dev twin's Gong handler agrees that the URL is optional")
  : bad("the dev twin still requires a URL — the two servers would disagree");
/Look up Gong/.test(advTsx) && /api\/gong-lookup/.test(advTsx)
  ? ok("the panel has a real 'Look up Gong' control that calls /api/gong-lookup")
  : bad("no working Gong lookup control found in AdvancedSettings.tsx");
/prospectName/.test(advTsx) && /prospectUrl/.test(advTsx)
  ? ok("the panel receives the live prospect name/URL rather than a stale copy")
  : bad("AdvancedSettings does not take prospectName/prospectUrl — Look up Gong would have nothing to search");
const launchTsx = code("src/screens/Launch.tsx");
/prospectName=\{name\}/.test(launchTsx) && /prospectUrl=\{url\}/.test(launchTsx)
  ? ok("Launch.tsx passes the live form fields down to the panel")
  : bad("Launch.tsx does not pass the current name/url into AdvancedSettings");
/app\.post\("\/api\/gong-lookup"/.test(server)
  ? ok("server.ts serves POST /api/gong-lookup")
  : bad("server.ts is missing /api/gong-lookup");
/\/api\/gong-lookup/.test(viteConfig) && /gongLookup/.test(viteConfig)
  ? ok("vite.config.ts's dev twin carries the same Gong route as server.ts")
  : bad("the dev twin is missing the Gong route server.ts has — the two servers would disagree");

/* ── document extraction ────────────────────────────────────────────────── */
console.log("\nDocument extraction\n");

const { extractDocText } = await import("../engine/docText.ts");
extractDocText(Buffer.from("hello there"), "a.md") === "hello there"
  ? ok("plain text extracts")
  : bad("plain text did not extract");
for (const [file, want] of [["x.pdf", /PDF isn't supported/], ["x.doc", /re-save it as .docx/], ["x.zip", /only /]] as const) {
  try { extractDocText(Buffer.from("x"), file); bad(`${file} was accepted but should be refused`); }
  catch (e) {
    want.test((e as Error).message)
      ? ok(`${file} is refused with an explanation`)
      : bad(`${file} refused with an unhelpful message: ${(e as Error).message}`);
  }
}
/* ⚠️ THE REAL FILE IS THE TEST. A hand-rolled ZIP reader that works on one file
   and not another is the reason this is checked against a real Word export. */
const realDocx = "/Users/ddesai/Downloads/Copy of Orlando Health SMS Agent ER Scnarios.docx";
if (!existsSync(realDocx)) console.log("  note  no sample .docx on this machine — skipping the real-file check");
else {
  const text = extractDocText(readFileSync(realDocx), "sample.docx");
  text.length > 3000 && text.includes("Orlando Health") && text.split("\n").length > 20
    ? ok(`a real Word .docx extracts (${text.length} chars, ${text.split("\n").length} lines with paragraphs preserved)`)
    : bad(`the real .docx extracted poorly: ${text.length} chars, ${text.split("\n").length} lines`);
}

console.log(fail ? `\n${fail} check(s) failed\n` : "\nAll advanced-settings checks passed\n");
process.exit(fail ? 1 : 0);
