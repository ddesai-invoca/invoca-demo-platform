/* =============================================================================
   replicaCapture — stamp the field meanings INTO the HTML, once, at capture time
   -----------------------------------------------------------------------------
   Asked for after the live path worked but cost 15.7 seconds and a fight with Cloudflare every
   time: *"make it faster and avoid any problems with 'prove you are not a bot', can you just
   download the standalone html for that page and use that, and inject something in the form
   fields so you can read it."*

   ⚠️⚠️ **THE BOT WALL IS FOUGHT ONCE, HERE, AND NEVER AGAIN IN FRONT OF A CUSTOMER.** A capture
   is a static file under `public/replicas/`, so opening it touches nobody's server: no render
   service, no Cloudflare challenge, no 15-second wait, and nothing that can be down mid-demo.
   The live path stays for URLs nobody has captured yet.

   ⚠️⚠️ **AND THE FIELD NAMES ARE WHY THE MARKERS ARE NOT OPTIONAL.** `aviandco.com` builds its
   appointment form in Klaviyo, and its inputs have NO `name` at all — only ids like
   `first_name_01JATZXB7E742ATZXVTCGPV77W`, which are generated per render. A field map written
   against those ids is correct for exactly one capture and silently wrong after the next one.
   A `data-lead` attribute stamped on the control survives both, and makes reading the submitted
   form a lookup instead of a re-derivation.

   ⚠️ **SAME RULES AS THE BROWSER, NOT A SECOND COPY OF THEM.** `classifySignals` in
   `src/data/replicaPages.ts` decides what a control means; this file only feeds it signals
   scraped from markup. `audit:replicas` asserts both front ends agree on one fixture, because
   two drifting classifiers would produce a lead with no name and no error.

   ⚠️ **NO DOM, AND NO PARSER DEPENDENCY.** This is tag-level rewriting over the sanitized HTML.
   It cannot resolve CSS visibility the way the browser can, which is precisely why the runtime
   still checks that a marked control is usable and falls back to deriving the map — see
   `deriveFieldMap`.
   ============================================================================= */

/* ⚠️ `leadFields.ts`, NOT `replicaPages.ts` — that module is full of `HTMLInputElement` and
   this one compiles under `tsconfig.node.json`, which has no DOM lib on purpose. */
import {
  classifySignals, type FieldSignals, type LeadKind, type ReplicaFieldMap,
} from "../src/data/leadFields.ts";

/** Read one attribute out of a start tag, quoted or bare. */
function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : "";
}

/* Controls a person cannot fill in. The browser also drops zero-sized ones; markup cannot
   see that, so the runtime re-checks. */
const UNFILLABLE = /^(hidden|submit|button|reset|image|file)$/i;

interface Control { start: number; end: number; tag: string; formIndex: number; signals: FieldSignals }

/**
 * Add `data-lead="<kind>"` to the lead form's fields and `data-lead-form="1"` to the form.
 * Returns the rewritten HTML plus the map those markers describe.
 */
export function markLeadFields(html: string): {
  html: string; map: ReplicaFieldMap; score: number; marked: number; formIndex: number;
} {
  /* ---- 1. label text by `for`, so an opaque name can still be classified ----
     ⚠️⚠️ **APPENDED, NOT "FIRST WINS" — a split name field can carry TWO `<label for>`
     elements pointing at one id.** Measured on keywhitman.com (WPForms): a hidden group
     legend "Name *" appears in the markup before a hidden per-field sub-label "First", both
     `for="wpforms-371-field_0"`. Keeping only the first gave `classifySignals` "Name *" and
     dropped the one word — "First" — that actually distinguishes the field from its sibling.
     Matches `classify()`'s browser-side fix in `replicaPages.ts`: same bug, same join. */
  const labelFor = new Map<string, string>();
  for (const m of html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    const id = attr(`<label${m[1]}>`, "for");
    if (!id) continue;
    const text = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const prior = labelFor.get(id);
    labelFor.set(id, prior ? `${prior} ${text}` : text);
  }

  /* ---- 2. walk the tags once, tracking which form each control sits in -----
     ⚠️ A STACK, NOT A COUNTER. Pages nest forms (Mr. Rooter's does), and a control belongs to
     the innermost one that is still open where it appears. */
  const controls: Control[] = [];
  const formTags: { start: number; end: number; index: number }[] = [];
  const open: number[] = [];
  let formCount = 0;

  const TAGS = /<(form|\/form|input|select|textarea)\b([^>]*)>/gi;
  for (const m of html.matchAll(TAGS)) {
    const kind = m[1].toLowerCase();
    const start = m.index!;
    const end = start + m[0].length;
    if (kind === "form") {
      const index = formCount++;
      formTags.push({ start, end, index });
      open.push(index);
      continue;
    }
    if (kind === "/form") { open.pop(); continue; }

    const tag = m[0];
    const type = (kind === "input" ? attr(tag, "type") || "text" : "").toLowerCase();
    if (UNFILLABLE.test(type)) continue;
    const name = attr(tag, "name");
    const id = attr(tag, "id");
    if (!name && !id && !attr(tag, "placeholder") && !attr(tag, "aria-label")) continue;
    controls.push({
      start, end, tag,
      formIndex: open.length ? open[open.length - 1] : -1,
      signals: {
        tag: kind.toUpperCase(),
        type,
        name, id,
        autocomplete: attr(tag, "autocomplete"),
        label: (labelFor.get(id) || attr(tag, "aria-label") || attr(tag, "placeholder") || "")
          .replace(/\s+/g, " ").trim(),
      },
    });
  }

  /* ---- 3. score every form, and the best one wins ------------------------
     ⚠️ THE MOST LEAD FIELDS, NOT THE FIRST FORM. `aviandco.com` carries six: site search twice,
     an account login, a newsletter box, a short Klaviyo popup and the real appointment form.
     Picking `forms[0]` lands on the search box. */
  let best = { formIndex: -1, score: 0, picks: [] as { c: Control; kind: LeadKind }[] };
  for (let fi = 0; fi < formCount; fi++) {
    const mine = controls.filter((c) => c.formIndex === fi);
    const picks: { c: Control; kind: LeadKind }[] = [];
    const taken = new Set<LeadKind>();
    let score = 0;
    for (const c of mine) {
      const kind = classifySignals(c.signals);
      if (!kind) continue;
      /* One control per meaning — the first wins, except a textarea always beats a one-line
         "subject" for the message field, matching the browser's rule. */
      if (taken.has(kind)) {
        if (!(kind === "message" && c.signals.tag === "TEXTAREA")) continue;
        const i = picks.findIndex((p) => p.kind === "message");
        if (i >= 0) picks.splice(i, 1);
        score--;
      }
      taken.add(kind);
      picks.push({ c, kind });
      score++;
    }
    if (score > best.score) best = { formIndex: fi, score, picks };
  }
  if (best.formIndex < 0) return { html, map: { name: [] }, score: 0, marked: 0, formIndex: -1 };

  /* ---- 4. rewrite, from the END so earlier offsets stay valid ------------- */
  type Edit = { start: number; end: number; text: string };
  const edits: Edit[] = [];
  const map: ReplicaFieldMap = { name: [], extra: {} };
  let first = "", last = "", full = "";

  for (const { c, kind } of best.picks) {
    /* ⚠️ A KEY IS GUARANTEED HERE. `collectValues` reads `name || id`, and a Klaviyo control can
       have neither; without this the field would be marked and still unreadable. */
    let key = c.signals.name || c.signals.id;
    let tag = c.tag;
    if (!key) {
      key = `replica_${kind}`;
      tag = tag.replace(/^<(\w+)/, `<$1 name="${key}"`);
    }
    tag = tag.replace(/^<(\w+)/, `<$1 data-lead="${kind}"`);
    edits.push({ start: c.start, end: c.end, text: tag });

    switch (kind) {
      case "email": map.email = key; break;
      case "phone": map.phone = key; break;
      case "zip": map.zip = key; break;
      case "message": map.message = key; break;
      case "firstName": first = key; break;
      case "lastName": last = key; break;
      case "fullName": full = key; break;
      case "company": map.extra!["Company"] = key; break;
    }
  }
  map.name = first || last ? [first, last].filter(Boolean) : (full ? [full] : []);
  /* `extra` is built label -> key above but read key -> label; flip it, as the browser does. */
  map.extra = Object.fromEntries(Object.entries(map.extra ?? {}).map(([label, k]) => [k, label]));

  const form = formTags.find((f) => f.index === best.formIndex)!;
  edits.push({
    start: form.start, end: form.end,
    text: html.slice(form.start, form.end).replace(/^<form/i, '<form data-lead-form="1"'),
  });

  let out = html;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  /* `score` counts identified fields; the browser adds one for having a name at all, so match
     it here rather than reporting two different numbers for the same form. */
  const score = best.score + (map.name.length ? 1 : 0);
  return { html: out, map, score, marked: best.picks.length, formIndex: best.formIndex };
}

/* =============================================================================
   captureReplica — the ONE pipeline both the terminal command and the button use
   -----------------------------------------------------------------------------
   Everything from "load a real browser" to "here is a safe, marked, self-contained HTML
   string" lives here once, so the CLI (`scripts/capture-url.ts`) and the button's API route
   cannot end up enforcing different safety rules. Persisting the result to disk is the
   CALLER's job (`engine/replicaStore.ts`) — this function only produces bytes.
   ============================================================================= */
import { freezePage } from "./freezePage.ts";
import { sanitizeReplica } from "./replicate.ts";

export interface CaptureOk {
  ok: true;
  html: string;
  title: string;
  finalUrl: string;
  formIndex: number;
  fieldsMarked: number;
  map: ReplicaFieldMap;
}
export interface CaptureFail { ok: false; reasons: string[] }

/** Load `url` in a real browser, freeze its assets, and mark its lead fields. */
export async function captureReplica(url: string): Promise<CaptureOk | CaptureFail> {
  const f = await freezePage(url);
  const clean = sanitizeReplica(f.html, f.finalUrl);
  const title = (f.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim().slice(0, 120);

  /* ⚠️ THE LEAD FORM CAN LIVE ON THE PAGE OR INSIDE A SAME-ORIGIN FRAME (greenixpc.com's is a
     HubSpot embed with no top-level form at all) — each document is scored on its own and the
     best one wins, mirroring `deriveFieldMap` at runtime. */
  let marked = markLeadFields(clean.html);
  let winningFrame: string | null = null;
  const markedFrameHtml = new Map<string, string>();
  for (const fr of f.frames) {
    const frClean = sanitizeReplica(fr.html, f.finalUrl);
    const m = markLeadFields(frClean.html);
    markedFrameHtml.set(fr.id, m.score > 0 ? m.html : frClean.html);
    if (m.score > marked.score) { marked = m; winningFrame = fr.id; }
  }

  let html = winningFrame ? clean.html : marked.html;
  for (const [id, frHtml] of markedFrameHtml) {
    const esc = frHtml.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    html = html.replace(
      new RegExp(`<iframe\\b[^>]*data-replica-frame\\s*=\\s*["']?${id}["']?[^>]*>`, "i"),
      (tag) => `${tag.replace(/\/?>$/, "")} srcdoc="${esc}">`,
    );
  }

  /* ⚠️ THE SAME REFUSALS `scripts/capture-url.ts` used to apply inline — moved here so the API
     route enforces them too, not just the terminal command. */
  const live = html.replace(/<!--[\s\S]*?-->/g, "");
  const reasons: string[] = [];
  if (/<form[^>]*\saction\s*=/i.test(live)) reasons.push("a form still carries an action");
  if (/<script[\s>]/i.test(live)) reasons.push("a live script survived");
  const strayFrames = (live.match(/<iframe\b[^>]*>/gi) || []).filter((t) => !/\sdata-replica-frame\s*=/i.test(t)).length;
  if (strayFrames) reasons.push(`${strayFrames} iframe(s) survived that were not ours`);
  if (/\son(?:click|submit|load|change|input|focus|blur|error)\s*=/i.test(live)) reasons.push("an inline handler survived");
  if (!/<base\b/i.test(html)) reasons.push("no <base href>, so anything not embedded would 404");
  if (marked.score === 0) reasons.push("no lead form was found on the page");
  if (!marked.map.name.length) reasons.push("no name field was identified");
  if (reasons.length) return { ok: false, reasons };

  return {
    ok: true, html, title, finalUrl: f.finalUrl,
    formIndex: marked.formIndex, fieldsMarked: marked.marked, map: marked.map,
  };
}
