/* =============================================================================
   leadFields — what a form field MEANS, with no DOM in sight
   -----------------------------------------------------------------------------
   ⚠️⚠️ **THIS EXISTS BECAUSE THE SAME RULES RUN IN NODE AND IN THE BROWSER, and the type
   checker is what forced the split honestly.** `tsconfig.node.json` compiles `engine/` with
   `lib: ["ES2023"]` and no DOM, so `engine/replicaCapture.ts` importing `replicaPages.ts`
   (which is full of `HTMLInputElement`) failed `npm run typecheck` with sixteen errors even
   though `tsc --noEmit` on the app config was clean. Rather than widen the Node lib — which
   would let real DOM mistakes into server code — the DOM-free half lives here.

   ⚠️ **ONE SET OF RULES, TWO FRONT ENDS.** `replicaPages.ts` feeds `classifySignals` a live
   element; `engine/replicaCapture.ts` feeds it attributes scraped from HTML text so it can
   stamp `data-lead` into a capture. `audit:replicas` asserts they agree on a fixture, because
   two drifting copies would produce a lead with the wrong field in it and no error anywhere.

   ⚠️ `replicaPages.ts` RE-EXPORTS everything here, so existing importers are unchanged.
   ============================================================================= */

export interface ReplicaFieldMap {
  /** Input names that together make the caller's name, in order. */
  name: string[];
  phone?: string;
  email?: string;
  /** A 5-digit ZIP, used to resolve the lead's city the same way the LSA quote does. */
  zip?: string;
  /** A free-text field, if the form has one — this becomes the SMS agent's quoted opener. */
  message?: string;
  /** Anything else worth carrying onto the lead, as input name -> label. */
  extra?: Record<string, string>;
}

/** Every meaning a lead field can carry. */
export type LeadKind =
  | "email" | "phone" | "zip" | "message"
  | "firstName" | "lastName" | "fullName" | "company";

/**
 * Everything the classifier is allowed to look at.
 *
 * ⚠️⚠️ **A PLAIN BAG, DELIBERATELY — because the SAME RULES now run in two places.** The
 * browser reads these off a live element; `engine/replicaCapture.ts` reads them off HTML text
 * with no DOM at all, so it can stamp the meanings INTO a capture at capture time. If the two
 * had their own copies of these rules they would drift, and the failure would be a lead with a
 * missing name — silent, and exactly what `deriveFieldMap` was written to stop.
 */
export interface FieldSignals {
  /** "INPUT" | "SELECT" | "TEXTAREA". */
  tag: string;
  /** The input's type, lowercased. Empty for select/textarea. */
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  /** Resolved `<label>`, else aria-label, else placeholder. */
  label: string;
}

/** What one control MEANS, from its signals alone. The single source of these rules. */
export function classifySignals(s: FieldSignals): LeadKind | null {
  const name = s.name || s.id || "";
  const ac = s.autocomplete.toLowerCase();
  /* The label carries the meaning when the name does not, which is the whole reason a
     Salesforce field id can be classified at all. */
  const hay = `${name} ${s.label} ${ac}`.toLowerCase();
  const is = (re: RegExp) => re.test(hay);

  if (s.type === "email" || ac === "email" || is(/\be-?mail\b/)) return "email";
  if (s.type === "tel" || /^tel/.test(ac) || is(/\b(phone|mobile|telephone)\b/)) return "phone";
  if (is(/\b(zip|postal|postcode)\b/) || ac === "postal-code") return "zip";
  /* ⚠️⚠️ **`s?` — AND WITHOUT IT THE PLURAL LABELS ALL MISSED, which are the common ones.**
     Measured: "Comment" classified and "Comments" did not, because `\b` needs a non-word
     character after the match. Same for Notes, Details and Questions — and those are exactly
     what a Salesforce Web-to-Lead form labels its free-text field, which is the case the header
     of this file claims is handled. AutoNation's capture is one of those forms. */
  if (s.tag === "TEXTAREA" || is(/\b(message|comment|note|detail|describe|question|tell us)s?\b/)) return "message";
  if (is(/\b(first.?name|fname|given.?name)\b/) || ac === "given-name") return "firstName";
  if (is(/\b(last.?name|lname|surname|family.?name)\b/) || ac === "family-name") return "lastName";
  /* ⚠️⚠️ **A SPLIT NAME FIELD'S OWN SUB-LABEL IS OFTEN JUST "First"/"Last" — the whole word,
     nothing else — and it gets swamped once every label sharing that id is joined into one
     string.** Measured on keywhitman.com/lasik/schedule-online/ (WPForms): the input carries
     TWO `<label for=…>` elements pointing at the same id — a hidden group legend "Name *" and
     a hidden sub-label "First" — so the joined text is "Name * First", which matches neither
     `first.?name` nor a bare "first". Scoped tight so it cannot fire on ordinary prose ("How
     did you FIRST hear about us?"): only a name/id using the bracket/underscore/hyphen
     convention every major form builder uses for a split name field (`[first]`, `_last`,
     `-first`), or a label that IS the bare word and nothing else. */
  /* ⚠️⚠️ ANCHORED AT BOTH ENDS — the first version only anchored the START and misclassified
     "last_visit" as a last-name field (it starts with "last" followed by a delimiter, exactly
     what the pattern was looking for). "first"/"last" must be the FINAL token — optionally
     followed by one closing bracket, for the array-style `[first]` convention — never merely
     the first token of a longer field name. */
  const nameToken = name.toLowerCase().match(/(?:^|[[_-])(first|last)\]?$/);
  const bareLabel = s.label.trim().toLowerCase();
  if (nameToken?.[1] === "first" || bareLabel === "first") return "firstName";
  if (nameToken?.[1] === "last" || bareLabel === "last") return "lastName";
  if (is(/\b(full.?name|your.?name)\b/) || /^name$/.test(name.toLowerCase()) || ac === "name") return "fullName";
  if (is(/\b(company|business|organi[sz]ation|employer)\b/)) return "company";
  return null;
}

/**
 * Pull the demo's fields out of a submitted replica form.
 *
 * ⚠️ TOLERANT BY DESIGN: a captured form can change under us if the page is re-captured, and a
 * missing field must degrade to an empty string rather than throw inside a submit handler the
 * SE is watching. `ok` says whether enough came back to build a lead at all.
 */export function readReplicaForm(
  fields: ReplicaFieldMap,
  values: Record<string, string>,
): { name: string; phone: string; email: string; zip: string; message: string; extra: Record<string, string>; ok: boolean } {
  const get = (k?: string) => (k ? (values[k] ?? "").trim() : "");
  const name = fields.name.map((k) => get(k)).filter(Boolean).join(" ").trim();
  const phone = get(fields.phone);
  const email = get(fields.email);
  const extra: Record<string, string> = {};
  for (const [k, label] of Object.entries(fields.extra ?? {})) {
    const v = get(k);
    if (v) extra[label] = v;
  }
  return {
    name, phone, email,
    zip: get(fields.zip),
    message: get(fields.message),
    extra,
    /* A name plus SOME way to reach them is the floor for a lead worth creating. */
    ok: Boolean(name && (phone || email)),
  };
}

/* =============================================================================
   ⚠️⚠️ **HOW LONG A FROZEN CAPTURE LIVES — 10 DAYS, asked for as the price of self-containment:**
   *"regarding the size you can delete it after 10 days."* A frozen capture embeds its CSS,
   fonts and images, so it is measured in megabytes rather than kilobytes and is not something
   to accumulate.

   ⚠️⚠️ **EXPIRY DEGRADES, IT DOES NOT BREAK.** Past this age `replicaFor` stops offering the
   capture and the URL falls back to the live render path — slower, and it has to get past the
   site's bot check again, but it WORKS. An expiring capture that left a dead link behind would
   be worse than never capturing it.
   ============================================================================= */
export const TTL_DAYS = 10;

/** Days since a `capturedAt` date (YYYY-MM-DD). Returns 0 for anything unparseable. */
export function captureAgeDays(capturedAt: string, now: Date = new Date()): number {
  const t = Date.parse(`${capturedAt}T00:00:00Z`);
  if (Number.isNaN(t)) return 0;
  return Math.floor((now.getTime() - t) / 86_400_000);
}
