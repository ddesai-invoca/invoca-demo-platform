/* =============================================================================
   Replicate — the prospect's OWN booking page, with its form wired into the demo
   -----------------------------------------------------------------------------
   Asked for from the Book online menu (9/12/2026): *"add another button called replicate, and
   what it does is, it replicates the given webpage with the form on it, so that way when the
   form is completed and 'submitted' on the fake replicated website then it can actually take
   the information from the form and do stuff with it. like create a SMS workflow with the
   information from lead form."*

   ⚠️⚠️ **THIS IS NOT THE THING THAT WAS REJECTED EARLIER, AND THE DIFFERENCE MATTERS.** The
   section in CLAUDE.md that ends the Book online beat at the click rejected replicating
   *ServiceTitan's* form — one form that matches nobody, on a product only 2 of 15 prospects
   use. Replicating whatever is actually AT THE URL is per-prospect by construction, which is
   exactly the objection that killed the earlier idea.

   ⚠️⚠️ **THE CAPTURE IS MADE BY A BROWSER, AND THAT IS NOT A PREFERENCE.** Measured before
   building: Aptive's booking page serves **zero `<form>` elements** to `curl` and renders
   **one with 38 inputs** in a browser; AutoNation **403s** a server fetch and loads normally
   in a real one. These forms are JavaScript widgets. A server-side "replicate on demand"
   would hand an SE a formless, unstyled page — silently — for roughly nine prospects in ten.
   So captures are made once, by `scripts/capture-replica.js`, and SHIP IN THE REPO. **The SE
   installs nothing and clicks one button.**

   ⚠️⚠️ **EVERY CAPTURE IS NEUTRALISED AT CAPTURE TIME, AND RE-CHECKED HERE.** AutoNation's is
   a **Salesforce Web-to-Lead** form (`00N1U00000Utmts` and friends are Salesforce custom
   field ids) and Aptive's posts to Aptive's own lead API. A replica that kept its `action`
   would file a REAL lead at the prospect's own company the first time it was demoed. The
   serializer strips `action`/`method`/`target`/`onsubmit`, every `formaction`, every `on*`
   handler, and all scripts and iframes; `ReplicaPage` refuses to render a file that still
   carries a form action. Two layers, because this one is not recoverable if it goes wrong.

   ⚠️ **FIELD NAMES ARE THE PROSPECT'S OWN, READ OFF THE REAL FORM.** No guessing and no
   normalising at capture time — `fields` below maps THIS form's actual input names onto what
   the demo needs, so the replica stays a faithful copy and the mapping is the only thing that
   knows about our side.

   ⚠️⚠️ **ADDING ONE IS NOW THE REPLICATE BUTTON'S JOB, NOT A HAND-EDIT HERE.** Paste a URL,
   click Replicate: the server loads it in a real browser, downloads it as a standalone HTML
   file, marks its lead fields, and saves it to the persistent store
   (`engine/replicaStore.ts`) — which survives a restart, unlike this file, which is only
   read at build time. `npm run capture` is the terminal twin of the same pipeline, for
   scripting or a one-off test. Neither writes anything below; `REPLICAS` here stays fixed at
   the two demos that ship in the repo itself. `scripts/capture-replica.js` (browser console)
   remains for a page only YOUR browser can reach — behind a login, or past a challenge the
   service cannot clear.

   ⚠️ **SIZE: these are 1.7–2.9MB each**, served as static files (never bundled), so this is a
   per-prospect feature rather than something to run across all 145.
   ============================================================================= */

/* ⚠️ RE-EXPORTED, NOT REDEFINED — see the header of `leadFields.ts` for why the rules had to
   move out of this file. Every existing importer keeps working. */
export type { ReplicaFieldMap, LeadKind, FieldSignals } from "./leadFields.ts";
export { classifySignals, readReplicaForm } from "./leadFields.ts";
import type { ReplicaFieldMap, FieldSignals, LeadKind } from "./leadFields.ts";
import { classifySignals } from "./leadFields.ts";

/* ⚠️ RE-EXPORTED, NOT REDEFINED — the static registry and its two lookups moved to
   `replicaRegistry.ts` so `server.ts` can read them without dragging this DOM-heavy
   module into the node project. See that file's header. Every existing importer of
   `replicaPages.ts` keeps working. */
export type { ReplicaPage } from "./replicaRegistry.ts";
export { replicaFor, replicaExpired, replicaBySlug, replicaSlugs } from "./replicaRegistry.ts";

/* =============================================================================
   deriveFieldMap — work out what a form's fields MEAN, from the rendered form
   -----------------------------------------------------------------------------
   ⚠️⚠️ **THIS REPLACED HAND-MAPPING EVERY PROSPECT, which was the slow and fragile step.**
   `first_name` on one site is `firstName` on the next and `00NRl000001soAX` on a Salesforce
   Web-to-Lead form; writing that table per prospect is both a chore and a silent failure when
   it is wrong (the submit produces a lead with no name and the feature reads as broken).

   ⚠️ **IT RUNS ON THE LIVE DOCUMENT, NOT ON THE HTML TEXT.** The iframe gives us the real
   form, so `type`, `autocomplete`, the resolved `<label>` and actual visibility are all
   available — far stronger signals than a regex over markup, and it is how a Salesforce custom
   field id gets classified at all (its NAME is meaningless; its label says "Comments").

   ⚠️ **THE RIGHT FORM IS THE ONE WITH THE MOST LEAD FIELDS, not the first.** A captured page
   carries several (AutoNation's has six: the lead form plus site search, newsletter and nav
   filters), and picking `forms[0]` lands on the search box.
   ============================================================================= */

interface Candidate { name: string; kind: LeadKind | null; label: string }

/** Read one live control's signals, then apply the shared rules. */
function classify(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): Candidate {
  /* ⚠️⚠️ **ALL OF `el.labels`, JOINED — NOT JUST THE FIRST.** A split name field can carry TWO
     `<label for=…>` elements pointing at the same id (a group legend plus a per-field
     sub-label): measured on keywhitman.com, `wpforms-371-field_0` resolves `el.labels` to
     `["Name *", "First"]`, and reading only index 0 threw away the one word that actually
     distinguishes it from its sibling. `classifySignals`' own bare-word rule depends on
     seeing "First" at all. */
  const label = (
    (el.labels && el.labels.length && [...el.labels].map((l) => l.textContent || "").join(" ")) ||
    el.getAttribute("aria-label") ||
    (el as HTMLInputElement).placeholder ||
    ""
  ).replace(/\s+/g, " ").trim();
  const signals: FieldSignals = {
    tag: el.tagName,
    type: ((el as HTMLInputElement).type || "").toLowerCase(),
    name: el.name || "",
    id: el.id || "",
    autocomplete: el.getAttribute("autocomplete") || "",
    label,
  };
  return { name: el.name || el.id || "", kind: classifySignals(signals), label };
}

/**
 * This document plus every same-origin child document.
 *
 * ⚠️⚠️ **A CAPTURED FORM CAN LIVE IN A FRAME, AND LOOKING ONLY AT THE TOP DOCUMENT MISSES IT
 * ENTIRELY.** greenixpc.com's contact form is a HubSpot embed whose fields exist only inside a
 * same-origin iframe; the page around it has 0 inputs. The capture embeds such frames as
 * `srcdoc`, which inherits our origin, so their `contentDocument` is readable here — that is
 * the whole reason this works and the reason no `sandbox` may ever be added to those frames.
 */
export function replicaDocs(doc: Document): Document[] {
  const out: Document[] = [doc];
  for (const f of Array.from(doc.querySelectorAll("iframe"))) {
    let d: Document | null = null;
    try { d = (f as HTMLIFrameElement).contentDocument; } catch { d = null; }
    if (d?.documentElement) out.push(d);
  }
  return out;
}

/* =============================================================================
   What the page itself says after a submit
   -----------------------------------------------------------------------------
   Asked directly: *"are you able to also replicate what happens when someone click submit.
   like sometime it goes to a different page, or sometimes it just says thank you etc."*

   ⚠⚠ **MANY SITES ALREADY SHIP THEIR CONFIRMATION IN THE PAGE, HIDDEN**, and where they do
   this is a faithful replication rather than an invention: Aptive's capture carries a real
   `hidden` panel reading "Thank You! A pest control specialist will contact you shortly… What
   happens next…". Revealing it is exactly what the site's own script does; the words are the
   prospect's own.

   ⚠⚠ **AND MANY DO NOT, WHICH IS WHY THIS MUST FAIL CLOSED.** Measured across the captures:
   Greenix's HubSpot form carries only the CSS that would STYLE a `.submitted-message` — the text
   arrives from HubSpot's JS after the POST, and a replica strips JS — while Reyes Law and
   AutoNation carry no trace at all. Showing a generic "Thanks!" there would be inventing a
   company's own confirmation copy, which this repo refuses everywhere else. No block, no change:
   the submit stays silent exactly as it does today, and the SE can point at the real thank-you
   page instead (see the "After submit" field on the Book online menu).
   ============================================================================= */
const CONFIRM_HINT = /(thank[-_ ]?you|form[-_ ]?success|success[-_ ]?message|submitted[-_ ]?message|confirmation|form[-_ ]?sent)/i;

/** Is this element hidden right now, by any of the three routes a site actually uses? */
function isHidden(el: HTMLElement): boolean {
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !!cs && (cs.display === "none" || cs.visibility === "hidden");
}

/**
 * The page's own hidden confirmation, or null when it does not have one.
 * Exported so the audit tests the real rule against the real captures.
 */
export function findConfirmation(doc: Document): HTMLElement | null {
  const seen = doc.querySelectorAll<HTMLElement>("[class],[id],[data-testid]");
  let best: HTMLElement | null = null;
  for (const el of Array.from(seen)) {
    const key = `${el.className || ""} ${el.id || ""} ${el.getAttribute("data-testid") || ""}`;
    if (!CONFIRM_HINT.test(key)) continue;
    if (el.tagName === "FORM" || el.querySelector("input, textarea, select")) continue;
    if (!isHidden(el)) continue;
    /* ⚠️ **IT HAS TO CARRY REAL WORDS.** A styled-but-empty shell (HubSpot leaves one) and a
       bare icon wrapper both match the class hint and would reveal a blank box — which reads as
       the page breaking on submit, the worst of the three outcomes. */
    if ((el.textContent || "").trim().length < 12) continue;
    /* ⚠️ **PREFER THE OUTERMOST MATCH, AND THE TEST READS THE OTHER WAY ROUND.** The heading,
       the icon and the body copy are usually separate matching nodes inside ONE panel; keeping
       the innermost would reveal "Thank You!" and lose "what happens next". So `el` only wins
       when it CONTAINS the incumbent. (Written inverted first: `best.contains(el)` replaces the
       panel with its own child — harmless on Aptive, whose children are not independently
       hidden, and wrong on any page whose inner block is.) */
    if (!best || el.contains(best)) best = el;
  }
  return best;
}

/**
 * Reveal that confirmation and retire the form, the way the site's own script would.
 * Returns false when the page has none, so the caller can fall back rather than guess.
 */
export function revealConfirmation(doc: Document, fullName?: string): boolean {
  const panel = findConfirmation(doc);
  if (!panel) return false;
  panel.removeAttribute("hidden");
  panel.removeAttribute("aria-hidden");
  /* `important`, because whatever hid it is usually a stylesheet rule rather than an inline
     style, and a plain assignment loses to it silently. */
  panel.style.setProperty("display", "block", "important");
  panel.style.setProperty("visibility", "visible", "important");

  /* The form it replaces goes away — a thank-you panel sitting above a still-editable form
     reads as the submit not having happened. */
  for (const form of Array.from(doc.querySelectorAll<HTMLElement>("form"))) {
    if (!panel.contains(form)) form.style.setProperty("display", "none", "important");
  }

  /* ⚠️ **A SLOT THE PAGE LEFT FOR THE NAME IS FILLED, AND ONLY WHEN IT IS EMPTY.** Aptive's
     panel carries `<span class="aptive-form__thankyou-name"></span>` for its own script to fill.
     It is their template's own slot, so using it is still replication rather than invention —
     and an EMPTY element is the guard: anything already carrying text is left alone. */
  /* ⚠️ **THE NAME COMES FROM THE MAPPED LEAD, NOT THE RAW FIELD BAG.** `values` is keyed by
     the form's OWN input names (`firstName`, `hs-firstname`, `wpforms[fields][3]`…), so there is
     no `values.name` to read — written that way first, and the slot silently stayed empty.
     `readReplicaForm` is what already resolves those through the field map. */
  const first = (fullName || "").trim().split(/\s+/)[0];
  if (first) {
    for (const slot of Array.from(panel.querySelectorAll<HTMLElement>("[class*='name' i]"))) {
      if ((slot.textContent || "").trim() === "" && !slot.querySelector("*")) { slot.textContent = first; break; }
    }
  }
  panel.scrollIntoView({ block: "center" });
  return true;
}

/**
 * Grow every embedded FORM frame to the height of its own content, and return how many moved.
 *
 * ⚠⚠ **A CAPTURED THIRD-PARTY FORM IS FROZEN AT WHATEVER HEIGHT ITS HOST JS LAST GAVE IT,
 * AND THAT CUTS THE SUBMIT BUTTON OFF.** Reported directly against greenixpc.com: *"you need to
 * also make sure that the submission button is also always replicated, for example i dont see
 * one for greenix."* Measured on that replica: the HubSpot frame renders **402x498** while its
 * document is **600** tall, putting the Submit input at **527** — 29px past the bottom edge,
 * with no scrollbar to reach it. The button was captured, wired and working; it was simply not
 * on screen. Normally the embed's own script posts its height to the page and the page resizes
 * the frame, and that script is exactly what a replica strips.
 *
 * ⚠ **IT ONLY EVER GROWS.** Shrinking a frame to its content would clip a page whose embed is
 * deliberately taller than its document, and nothing here knows which is which.
 * ⚠ **FORM FRAMES ONLY** — a chat widget or an ad iframe reports a large document too, and
 * stretching those would push the real page apart for no gain.
 */
export function fitEmbeddedFrames(doc: Document): number {
  let grown = 0;
  for (const d of replicaDocs(doc)) {
    for (const el of Array.from(d.querySelectorAll("iframe"))) {
      const f = el as HTMLIFrameElement;
      let inner: Document | null = null;
      try { inner = f.contentDocument; } catch { inner = null; }
      if (!inner?.body || !inner.querySelector("form")) continue;
      const need = Math.max(inner.documentElement?.scrollHeight ?? 0, inner.body.scrollHeight);
      if (need > f.clientHeight + 1) { f.style.height = `${need}px`; grown++; }
    }
  }
  return grown;
}

/* Unfillable regardless of how the page happens to be laid out this frame. */
const UNFILLABLE_TYPE = /^(hidden|submit|button|reset|image|file)$/;

/** A marked control we can trust without waiting for layout — see `deriveFieldMap`. */
function markedUsable(el: Element): boolean {
  const e = el as HTMLInputElement;
  if (!e.name && !e.id) return false;
  if (e.disabled) return false;
  return !UNFILLABLE_TYPE.test((e.type || "").toLowerCase());
}

/** Is this control something a person actually fills in? */
function usable(el: Element): boolean {
  const e = el as HTMLInputElement;
  if (!e.name && !e.id) return false;
  if (e.disabled) return false;
  const t = (e.type || "").toLowerCase();
  if (["hidden", "submit", "button", "reset", "image", "file"].includes(t)) return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * Read a rendered document and return the form that looks like a lead form, plus what its
 * fields mean. `score` is how many identifiable lead fields it found — 0 means "no lead form
 * on this page", which the caller should surface rather than pretend.
 */
export function deriveFieldMap(doc: Document): { map: ReplicaFieldMap; score: number; formIndex: number } {
  /* ⚠️⚠️ **A CAPTURE ALREADY KNOWS THE ANSWER — READ IT RATHER THAN RE-DERIVING IT.**
     `npm run capture` stamps `data-lead` on each field of the form it picked, so for a captured
     page this is a lookup: no scoring, no dependence on `getBoundingClientRect` (which returns
     zeros while the page is still laying out), and no chance of picking a different form than
     the one the capture was validated against.

     ⚠️⚠️ **AND IT DELIBERATELY DOES NOT ASK ABOUT LAYOUT — measured, because asking made the
     banner lie.** `usable` requires a non-zero `getBoundingClientRect`, which is false for a
     few frames while the iframe lays out; binding in that window made a page with five marked
     fields report "no fillable form" before correcting itself once layout finished. On a
     captured page the fields are already known to be real: the capture refused to write a file
     without a lead form, and `audit:replicas` re-checks the file on disk. So markers are
     trusted on the durable signals (present, enabled, fillable type, readable key) and the
     derivation below keeps the layout test, where it is the only signal available. */
  const marked = replicaDocs(doc).flatMap((d) => Array.from(d.querySelectorAll("[data-lead]"))).filter(markedUsable);
  if (marked.length) {
    const map: ReplicaFieldMap = { name: [], extra: {} };
    let first = "", last = "", full = "", score = 0;
    for (const el of marked) {
      const e = el as HTMLInputElement;
      const key = e.name || e.id;
      if (!key) continue;
      switch (el.getAttribute("data-lead")) {
        case "email": if (!map.email) { map.email = key; score++; } break;
        case "phone": if (!map.phone) { map.phone = key; score++; } break;
        case "zip": if (!map.zip) { map.zip = key; score++; } break;
        case "message": if (!map.message) { map.message = key; score++; } break;
        case "firstName": if (!first) { first = key; score++; } break;
        case "lastName": if (!last) { last = key; score++; } break;
        case "fullName": if (!full) { full = key; score++; } break;
        case "company": if (!map.extra!.Company) { map.extra!["Company"] = key; } break;
      }
    }
    map.name = first || last ? [first, last].filter(Boolean) : (full ? [full] : []);
    map.extra = Object.fromEntries(Object.entries(map.extra ?? {}).map(([label, k]) => [k, label]));
    if (map.name.length) {
      score++;
      const form = (marked[0] as Element).closest("form");
      const formIndex = form ? Array.from(doc.querySelectorAll("form")).indexOf(form) : -1;
      return { map, score, formIndex };
    }
  }

  let best: { map: ReplicaFieldMap; score: number; formIndex: number } =
    { map: { name: [] }, score: 0, formIndex: -1 };

  const forms = replicaDocs(doc).flatMap((d) => Array.from(d.querySelectorAll("form")));
  forms.forEach((form, formIndex) => {
    const controls = Array.from(form.querySelectorAll("input,select,textarea")).filter(usable);
    const map: ReplicaFieldMap = { name: [], extra: {} };
    let first = "", last = "", full = "", score = 0;

    for (const el of controls) {
      const c = classify(el as HTMLInputElement);
      if (!c.kind || !c.name) continue;
      switch (c.kind as string) {
        case "email": if (!map.email) { map.email = c.name; score++; } break;
        case "phone": if (!map.phone) { map.phone = c.name; score++; } break;
        case "zip": if (!map.zip) { map.zip = c.name; score++; } break;
        /* Longest free-text field wins — a one-line "subject" should not beat the textarea. */
        case "message": if (!map.message || el.tagName === "TEXTAREA") { map.message = c.name; score++; } break;
        case "firstName": if (!first) { first = c.name; score++; } break;
        case "lastName": if (!last) { last = c.name; score++; } break;
        case "fullName": if (!full) { full = c.name; score++; } break;
        case "company": if (!map.extra!.Company) { map.extra!["Company"] = c.name; } break;
      }
    }
    /* First+last beats a single full-name field when a form has both. */
    map.name = first || last ? [first, last].filter(Boolean) : (full ? [full] : []);
    /* `extra` is keyed label -> name in the classifier above but read name -> label; flip it. */
    map.extra = Object.fromEntries(Object.entries(map.extra ?? {}).map(([label, n]) => [n, label]));
    if (map.name.length) score++;
    if (score > best.score) best = { map, score, formIndex };
  });

  return best;
}


