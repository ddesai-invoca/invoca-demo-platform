/* =============================================================================
   renderService — a REAL browser renders the page, somewhere that is not our server
   -----------------------------------------------------------------------------
   Asked for after a live test of `https://ridgeline-roofing.com/` came back wrong three ways:
   *"assets weren't loaded, like the video playing in the background of the form; the formatting
   of the header is off; Icon SVG are missing… instead of replicating with speed, i rather do
   accuracy."*

   ⚠️⚠️ **ALL THREE SYMPTOMS WERE ONE CAUSE, AND IT IS NOT FIXABLE ON THE SERVER.** That page
   carries 21 `data-src` attributes and 62 `loading="lazy"` images, so nothing has a real `src`
   until its JavaScript runs; its icons are injected by JS; and its layout needs JS-applied
   classes. Measured after letting a browser run it: **104 of 104 images resolve**, the
   background video gains a source, and the header lays out correctly. A plain fetch cannot
   produce any of that.

   ⚠️⚠️ **IT RUNS OFF-BOX BECAUSE UPTIME IS THE TOP PRIORITY, and an in-process fallback would
   NOT have protected it.** Render enforces memory PER CONTAINER, so a Chromium sharing this
   service's container counts against the same limit; when that limit is crossed the kernel
   kills the process and **no `catch` block runs**. The whole platform restarts and every SE
   mid-demo drops. Putting the browser in somebody else's container makes the worst case "a
   less accurate replica", which is the trade that was actually asked for.

   ⚠️ **NO NPM DEPENDENCY.** Browserless's `/content` endpoint takes a URL and returns rendered
   HTML, so this is a `fetch` — no Playwright, no puppeteer-core, no Chromium download. This
   repo has already rejected a 26MB SDK for one button (`engine/voicePreview.ts`), and the same
   reasoning applies.

   ⚠️ **UNCONFIGURED IS A SUPPORTED STATE, not an error.** With no `BROWSERLESS_TOKEN` this
   reports "not configured" and `fetchReplica` uses its plain fetch exactly as before. Nothing
   about the feature is gated on somebody buying something.
   ============================================================================= */

const ENDPOINT_DEFAULT = "https://production-sfo.browserless.io/content";
/* Long enough for a heavy marketing page to settle, short enough that an SE is not left
   staring at a progress bar. The caller falls back the moment this is exceeded. */
const RENDER_TIMEOUT_MS = 20_000;
/* How long to let lazy loaders and JS-injected content settle after the DOM is ready. */
const LAZY_SETTLE_MS = 4_000;

export class RenderUnavailable extends Error {}

export function renderConfigured(): boolean {
  return Boolean(process.env.BROWSERLESS_TOKEN);
}

/* ---- circuit breaker -----------------------------------------------------
   ⚠️ WITHOUT THIS, A DEAD RENDERER COSTS EVERY SE THE FULL TIMEOUT. If the service is down or
   the token is wrong, each Replicate click would sit for 20 seconds before falling back. After
   a few consecutive failures we stop asking and go straight to the fast path, then try again
   once the window passes. */
const TRIP_AFTER = 3;
const COOLDOWN_MS = 5 * 60 * 1000;
let consecutiveFailures = 0;
let trippedAt = 0;

export function renderBreakerOpen(): boolean {
  if (consecutiveFailures < TRIP_AFTER) return false;
  if (Date.now() - trippedAt > COOLDOWN_MS) {   // cooled off — allow one probe through
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

/** Exposed so the audit can drive the breaker rather than describing it. */
export function renderBreakerState(): { failures: number; open: boolean } {
  return { failures: consecutiveFailures, open: renderBreakerOpen() };
}

export function resetRenderBreaker(): void {
  consecutiveFailures = 0;
  trippedAt = 0;
}

function noteFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= TRIP_AFTER) trippedAt = Date.now();
}

/**
 * Ask the render service for the page as a browser sees it.
 * Throws `RenderUnavailable` for anything the caller should fall back from.
 */
export async function renderViaService(url: string): Promise<{ html: string; ms: number }> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new RenderUnavailable("No render service configured.");
  if (renderBreakerOpen()) throw new RenderUnavailable("Render service is in cooldown after repeated failures.");

  const base = process.env.BROWSERLESS_URL || ENDPOINT_DEFAULT;
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RENDER_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({
        url,
        /* ⚠️⚠️ **`domcontentloaded` PLUS A FIXED WAIT, NOT `networkidle2` — MEASURED, AND IT
           HALVES THE TIME FOR IDENTICAL OUTPUT.** On ridgeline-roofing.com, three option sets
           against the real service:
             networkidle2 + bestAttempt          14.0s   100 images, video, 617KB
             domcontentloaded + 4s wait           7.0s   100 images, video, 616KB  <- chosen
             the same + a tall viewport           7.1s   104 images, but a BROKEN hero
           A marketing page with a chat widget and analytics beacons never goes quiet, so
           `networkidle2` just burns the timeout and `bestAttempt` returns what it had anyway.
           Four seconds is what the lazy loaders and the injected SVG actually need. */
        gotoOptions: { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS - 5000 },
        waitForTimeout: LAZY_SETTLE_MS,
        /* ⚠️⚠️ **A NORMAL VIEWPORT, AND A TALL ONE ACTIVELY BROKE FIDELITY.** Trying to drag
           more below-the-fold lazy images into range with `height: 2400` won four extra images
           and wrecked the hero: that page sizes its hero in `vh`, so a 2400px-tall viewport
           made it 2400px tall and two carousel slides' text rendered on top of each other —
           the exact "formatting of the header is off" complaint, reintroduced by an
           optimisation. Fidelity is the whole point of this path; a few unresolved images
           below the fold cost nothing next to a broken hero. Verified by screenshotting the
           served result against the live site at 1440x900. */
        viewport: { width: 1440, height: 900 },
        /* ⚠️ RETURN WHAT IT HAS RATHER THAN NOTHING. Without this a perfectly good render is
           thrown away on a timeout and the SE silently gets the worse page. */
        bestAttempt: true,
      }),
    });
    clearTimeout(timer);

    if (!res.ok) {
      noteFailure();
      const detail = res.status === 401 ? "the token was rejected" : `HTTP ${res.status}`;
      throw new RenderUnavailable(`Render service failed (${detail}).`);
    }
    const html = await res.text();
    /* An empty or stub body means the target blocked the renderer — see Browserless's own
       bot-detection note. Treat it as a failure so the caller falls back and says something. */
    if (html.length < 500 || !/<html/i.test(html)) {
      noteFailure();
      throw new RenderUnavailable("Render service returned an empty page (the site may block automation).");
    }
    consecutiveFailures = 0;
    return { html, ms: Date.now() - started };
  } catch (e: unknown) {
    clearTimeout(timer);
    if (e instanceof RenderUnavailable) throw e;
    noteFailure();
    const aborted = (e as Error)?.name === "AbortError";
    throw new RenderUnavailable(
      aborted ? `Render timed out after ${RENDER_TIMEOUT_MS / 1000}s.` : "Could not reach the render service.",
    );
  }
}

/* =============================================================================
   Stage two — `/unblock`, for a site that refuses the plain renderer
   -----------------------------------------------------------------------------
   ⚠️⚠️ **A BOT WALL IS A 200, AND THE OLD STUB GUARD LET IT THROUGH.** Measured on
   `https://www.aviandco.com/schedule-an-appointment`: `/content` returned HTTP 200 with a
   24,462-byte document titled "Just a moment…" — well past the 500-byte floor and it does
   contain `<html`, so it was sanitized, cached and served as the replica. The SE got a
   Cloudflare interstitial with the banner cheerfully saying "rendered in a browser". Detecting
   the wall by its own words is the only thing that separates it from a real page.

   ⚠️ **THAT SITE BLOCKS THIS MACHINE TOO, so it is not a datacenter-IP problem.** curl from the
   laptop, with and without a browser User-Agent: HTTP 403 both times. The challenge wants a
   real browser fingerprint plus the solved cookie, which is exactly what `/unblock` does and
   what a plain fetch can never do. Measured: `/unblock` returned the real page (198KB,
   "Schedule an Appointment - Avi & Co.") in 8 seconds.

   ⚠️⚠️ **THE SECOND REASON TO ESCALATE IS A PAGE WITH NO LEAD FIELD.** That page's appointment
   form is a Klaviyo widget injected by a third-party script well after our 4s settle, so even
   an unblocked render with no wait came back with only the site search, the account login and
   the newsletter box. Waiting on a lead-shaped field is what actually produced First Name /
   Last Name / Phone / Email / date / notes. A replica with nothing to fill in is useless for
   the one thing this feature exists to demo.

   ⚠️⚠️ **A `waitForSelector` THAT NEVER MATCHES RETURNS 408 AND NO CONTENT — MEASURED.** So the
   wait is only ever a bonus, never the thing the result depends on: when the page genuinely has
   no lead field we keep what we already had rather than serving nothing. The fixed-wait retry
   exists ONLY for the bot-wall case, where "what we already had" is a challenge page.
   ============================================================================= */

/* The wall names itself. Cloudflare's interstitial, its "Attention Required" page, and the
   generic "checking your browser" variants all carry one of these. */
const BOT_WALL =
  /just a moment|performing security verification|checking your browser|attention required!\s*\|\s*cloudflare|cf-browser-verification|enable javascript and cookies to continue/i;

/* A lead-shaped field: a phone or a given name. Deliberately NOT "any input" — every page has a
   search box, and Magento pages ship an email+password login that would satisfy a looser test. */
const LEAD_FIELD_SELECTOR =
  'input[type="tel"],input[autocomplete*="tel"],input[name*="phone"],input[id*="phone"],input[placeholder*="Phone"],input[autocomplete*="given-name"],input[name*="first_name"],input[name*="firstname"],input[placeholder*="First Name"]';

/** The same test as the selector above, run against returned HTML rather than a live DOM. */
const LEAD_FIELD_HINT =
  /type="tel"|autocomplete="[^"]*tel|name="[^"]*phone|id="[^"]*phone|placeholder="[^"]*Phone|autocomplete="[^"]*given-name|name="[^"]*first[_-]?name|placeholder="[^"]*First Name/i;

/** True when the "page" is really a bot challenge. Never serve one as a replica. */
export function looksBotWalled(html: string): boolean {
  return BOT_WALL.test(html);
}

/** True when there is nothing on the page a lead form could be filled into. */
export function lacksLeadField(html: string): boolean {
  return !LEAD_FIELD_HINT.test(html);
}

/* `/unblock` carries the cost of a stealth browser plus solving the challenge, so it gets a
   longer budget than `/content` — but only on the escalation path, never for a page that
   already rendered fine. */
const UNBLOCK_TIMEOUT_MS = 45_000;
/* Long enough for a third-party form script to mount (Klaviyo needed more than four seconds),
   short enough that a formless page is not a 30-second wait. */
const UNBLOCK_SELECTOR_MS = 12_000;
const UNBLOCK_SETTLE_MS = 6_000;

async function postUnblock(url: string, wait: Record<string, unknown>): Promise<string> {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) throw new RenderUnavailable("No render service configured.");
  /* ⚠️ DERIVED, NOT HARD-CODED, so a self-hosted BROWSERLESS_URL still reaches its own host.
     An override that does not name `/content` gets `/unblock` appended to its origin rather
     than silently POSTing the unblock body at the content endpoint. */
  const configured = process.env.BROWSERLESS_URL || ENDPOINT_DEFAULT;
  const base = /\/content\b/.test(configured)
    ? configured.replace(/\/content\b/, "/unblock")
    : new URL("/unblock", configured).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UNBLOCK_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({
        url,
        content: true,
        /* Nothing else is wanted back: a screenshot and a live browser endpoint are both
           billable work this path has no use for. */
        browserWSEndpoint: false,
        cookies: false,
        screenshot: false,
        ttl: 0,
        ...wait,
      }),
    });
    clearTimeout(timer);
    /* ⚠️ 408 IS THE SELECTOR TIMING OUT, and the body is empty — the caller decides whether to
       retry without a selector or to keep what it already had. */
    if (!res.ok) {
      throw new RenderUnavailable(
        res.status === 408
          ? "Nothing lead-shaped appeared on the page."
          : `The unblocking renderer failed (HTTP ${res.status}).`,
      );
    }
    const j = (await res.json().catch(() => null)) as { content?: string } | null;
    const html = j?.content || "";
    if (html.length < 500 || !/<html/i.test(html)) {
      throw new RenderUnavailable("The unblocking renderer returned an empty page.");
    }
    return html;
  } catch (e: unknown) {
    clearTimeout(timer);
    if (e instanceof RenderUnavailable) throw e;
    const aborted = (e as Error)?.name === "AbortError";
    throw new RenderUnavailable(
      aborted ? `Unblocking timed out after ${UNBLOCK_TIMEOUT_MS / 1000}s.` : "Could not reach the unblocking renderer.",
    );
  }
}

/**
 * Render through the stealth/unblocking endpoint.
 * `allowFixedWaitRetry` is for the bot-wall case only — see the block comment above.
 * Throws `RenderUnavailable` for anything the caller should fall back from.
 */
export async function renderViaUnblock(
  url: string,
  opts: { allowFixedWaitRetry?: boolean } = {},
): Promise<{ html: string; ms: number }> {
  if (renderBreakerOpen()) throw new RenderUnavailable("Render service is in cooldown after repeated failures.");
  const started = Date.now();
  try {
    const html = await postUnblock(url, {
      waitForSelector: { selector: LEAD_FIELD_SELECTOR, timeout: UNBLOCK_SELECTOR_MS },
    });
    consecutiveFailures = 0;
    return { html, ms: Date.now() - started };
  } catch (e: unknown) {
    const selectorMissed = e instanceof RenderUnavailable && /lead-shaped/.test(e.message);
    /* A missed selector says nothing about the service's health, so it must not count toward the
       breaker — otherwise replicating three formless pages would disable the accurate path for
       five minutes. */
    if (!selectorMissed) noteFailure();
    if (!(selectorMissed && opts.allowFixedWaitRetry)) throw e;
    try {
      const html = await postUnblock(url, { waitForTimeout: UNBLOCK_SETTLE_MS });
      consecutiveFailures = 0;
      return { html, ms: Date.now() - started };
    } catch (e2: unknown) {
      noteFailure();                      // this one IS the service failing
      throw e2;
    }
  }
}
