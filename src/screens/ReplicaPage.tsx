import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useQuoteCaptures } from "../data/QuoteCaptureContext";
import { readReplicaForm, deriveFieldMap, replicaDocs, fitEmbeddedFrames, revealConfirmation } from "../data/replicaPages";
import { useBookingOverride } from "../data/bookingOverride";
import { derive } from "../data/prospectPlace";
import { useLocationOverride } from "../data/locationOverride";

/* =============================================================================
   /replica — the page at a pasted URL, with its form wired into the demo
   -----------------------------------------------------------------------------
   Asked for directly (9/13/2026): *"i need the behavior to be that i paste a URL and when user
   clicks Replicate, it should replicate the page, and that page will more than likely have a
   form on it."* So **Replicate uses the URL in the box**, fetched on demand by
   `engine/replicate.ts`. Measured: 400–900ms for a live page.

   ⚠️⚠️ **A CAPTURED COPY WINS WHERE ONE EXISTS, and the banner says which you are looking at.**
   A server fetch cannot run the page's JavaScript, so a site that builds its form in JS serves
   no form at all (measured: Aptive gives zero, AutoNation 403s entirely). For those we ship a
   browser-made capture, and it is strictly better. Anything else is fetched live. Two sources,
   one screen, and never a silent choice between them.

   ⚠️⚠️ **ZERO FIELDS IS REPORTED, NOT RENDERED AS SUCCESS.** The worst outcome available here
   is a perfectly styled page with no form on it, shown as though it worked — the SE only finds
   out in front of a customer. When the fetch comes back with nothing fillable, the screen says
   so and names the reason.

   ⚠️⚠️ **THE IFRAME IS SAME-ORIGIN BY CONSTRUCTION.** `/api/replicate` serves the page from our
   own origin, so `contentDocument` is readable and the form can be wired — the inverse of the
   ThoughtSpot and LSA-quote frames this repo documents as unreadable. Never add a `sandbox`
   that omits `allow-same-origin`; every interception below would silently stop.
   ============================================================================= */

/**
 * Read what the person typed.
 *
 * ⚠️⚠️ **NOT `form.elements` ALONE — ON A REAL PAGE IT IS OFTEN EMPTY.** Measured on Mr.
 * Rooter's contact page: all four forms report **zero** associated elements while the inputs
 * are plainly there and filled. Their markup nests forms, and the HTML parser re-parents the
 * controls out of the form they appear to be inside, so `form.elements` collects nothing and
 * the submit produced a blank lead. So the form is the HINT and the DOCUMENT is the source:
 * every named control is read, whichever form it did or did not end up associated with.
 *
 * ⚠️ **A FILLED VALUE BEATS AN EMPTY DUPLICATE.** Real pages carry the same field name more
 * than once (a mobile copy of the form beside the desktop one, or a hidden second step), and
 * last-one-wins turns a filled form into an empty one.
 */
function collectValues(doc: Document, form?: HTMLFormElement): Record<string, string> {
  const values: Record<string, string> = {};
  const take = (el: HTMLInputElement) => {
    /* ⚠️⚠️ **`name` OR `id` — AND REQUIRING `name` ALONE WAS A REAL, SILENT BUG.** Measured on
       Mr. Rooter's contact form, whose inputs are `<input type="text" id="short-form-req-name">`
       with **no `name` attribute at all** — normal for a form its own JavaScript submits.
       `deriveFieldMap` already keys on `name || id`, so the map named fields this collector then
       skipped, and every submit produced "no name and no way to reach them" over a form the SE
       had plainly filled in. The two must agree on what identifies a field. */
    const key = el.name || el.id;
    if (!key) return;
    if (el.type === "checkbox" || el.type === "radio") {
      if (el.checked) values[key] = el.value || "on";
      return;
    }
    const v = el.value ?? "";
    if (values[key] && !v) return;              // never let an empty twin win
    values[key] = v;
  };
  if (form) for (const el of Array.from(form.elements) as HTMLInputElement[]) take(el);
  for (const el of Array.from(doc.querySelectorAll("input,select,textarea")) as HTMLInputElement[]) take(el);
  return values;
}

/** Bind a served page: neutralise again, kill navigation, and turn submit into a demo event. */
export function wireFrame(doc: Document, onSubmit: (values: Record<string, string>) => void): { forms: number; buttons: number; dismissers: number } {
  /* Second layer of neutralisation. `engine/replicate.ts` (or the capture tool) already
     stripped these; a real lead filed at the prospect's own company is the one failure here
     that cannot be taken back. */
  doc.querySelectorAll("form").forEach((f) => {
    f.removeAttribute("action"); f.removeAttribute("method"); f.removeAttribute("target");
  });
  doc.querySelectorAll("[formaction]").forEach((b) => b.removeAttribute("formaction"));

  /* Navigation would take the SE off to the live site mid-demo. */
  doc.querySelectorAll("a[href]").forEach((a) => a.addEventListener("click", (e) => e.preventDefault()));

  /* ⚠️ CAPTURE PHASE, on the DOCUMENT. A page carries several forms (AutoNation's has six) and
     the one that matters is whichever the SE fills. */
  doc.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSubmit(collectValues(doc, e.target as HTMLFormElement));
  }, true);

  /* ⚠️⚠️ **CLICKS ARE INTERCEPTED AT THE DOCUMENT, NOT PER BUTTON — and the per-button version
     silently destroyed the demo.** A `<form>` whose `action` we stripped submits to its OWN
     URL, so any submit we fail to catch RELOADS THE FRAME and wipes everything typed. The
     first version only bound to buttons where `closest("form")` succeeded; on Mr. Rooter's page
     the markup nests forms and the parser re-parents the controls, so that lookup fails, the
     click was never prevented, the frame reloaded, and the lead came back empty — which reads
     as "the form didn't work" rather than "the page reloaded".

     Catching it on the document in the CAPTURE phase means nothing has to be true about the
     markup. It also covers the two artefacts of removing the page's JavaScript: a button that
     is `type="button"` (its script would have submitted) and one that is `disabled` (its script
     would have enabled it) — neither fires a submit event on its own. */
  let buttons = 0;
  const SUBMITTISH = /submit|send|get|request|start|continue|contact|quote|book|schedule|next/i;
  doc.querySelectorAll('button, input[type="button"], input[type="submit"]').forEach((b) => {
    const el = b as HTMLInputElement;
    if (!SUBMITTISH.test(`${(b.textContent || el.value || "").trim()} ${b.getAttribute("name") || ""}`)) return;
    buttons++;
    b.removeAttribute("disabled");
  });

  /* =========================================================================
     ⚠️⚠️ **THE POPUP THAT COVERS THE PAGE HAS A CLOSE BUTTON, AND REMOVING THE PAGE'S
     JAVASCRIPT IS WHAT KILLED IT.** Measured on `aviandco.com/schedule-an-appointment`: the
     replica arrives with a Klaviyo newsletter modal at `z-index: 90000` over the whole page and
     a cookie banner across the bottom, exactly as the live site shows them — faithful, and
     completely stuck. Its "Close dialog" button and the banner's "close popup" were both
     inert, so the SE could neither dismiss the overlay nor reach the appointment form behind
     it. A control that does nothing when clicked is the one thing this repo will not ship.

     ⚠️ **DISMISSED, NOT DELETED AT LOAD.** Stripping the overlay during sanitize would be the
     easy fix and the wrong one: the live site really does open with that modal, and a replica
     that quietly differs from the page it claims to copy is how this feature lost trust the
     first time. It appears, and now it closes.

     ⚠️ REGISTERED BEFORE THE SUBMIT INTERCEPTOR BELOW. Capture-phase listeners on the same node
     run in registration order, so this one gets to stop a dismiss click before anything else
     interprets it. No label is in both sets ("Close"/"Accept" are not submit-shaped), but the
     ordering is what keeps that from mattering. */
  const DISMISSISH = /\bclose\b|\bdismiss\b|no thanks|not now|maybe later|\baccept\b|got it|×|✕|✖|⨯/i;
  /* ⚠️ SHORT LABELS ONLY, AND NEVER A FORM CONTROL. "Accept" is a dismiss; "I accept the terms
     and conditions" is a consent checkbox on the very form we want filled in, and hiding its
     overlay ancestor would take the form with it. Every real dismiss control is terse.

     ⚠️⚠️ **EACH LABEL IS MEASURED ON ITS OWN, AND JOINING THEM IS WHAT BROKE THIS.** Klaviyo's
     button carries `aria-label="Close dialog"` AND the text "Close dialog"; concatenated that
     is 25 characters, so a 24-character cap rejected the single most important dismiss control
     on the page — the modal stayed up and the fix looked like it had done nothing. Measured in
     the browser against the live replica, not reasoned about. */
  const isDismiss = (el: Element): boolean => {
    if (/^(INPUT|TEXTAREA|SELECT|LABEL|OPTION)$/.test(el.tagName)) return false;
    const labels = [el.getAttribute("aria-label") || "", (el.textContent || "").trim()];
    return labels.some((t) => t.length > 0 && t.length <= 24 && DISMISSISH.test(t));
  };
  let dismissers = 0;
  doc.querySelectorAll('button, a[role="button"], [aria-label]').forEach((b) => {
    if (isDismiss(b)) dismissers++;
  });
  doc.addEventListener("click", (e) => {
    const el = (e.target as Element | null)?.closest?.('button, a, a[role="button"], [aria-label]');
    if (!el) return;
    if (!isDismiss(el)) return;
    e.preventDefault();
    e.stopPropagation();
    /* ⚠️ THE OUTERMOST POSITIONED ANCESTOR, not the button's own box. The close control sits
       several levels inside the thing that needs to disappear, and hiding the button alone
       leaves the overlay in place looking broken. Walking up and keeping the LAST match gets
       the whole modal rather than an inner panel. */
    const view = doc.defaultView;
    let node: Element | null = el;
    let overlay: HTMLElement | null = null;
    for (let i = 0; node && i < 14; i++, node = node.parentElement) {
      const st = view?.getComputedStyle(node);
      if (!st) break;
      const z = parseInt(st.zIndex || "", 10);
      if ((st.position === "fixed" || st.position === "absolute") && (Number.isNaN(z) ? false : z >= 10)) {
        overlay = node as HTMLElement;
      }
      if (node.tagName === "DIALOG") overlay = node as HTMLElement;
    }
    /* Fall back to the control itself, so the click still visibly does something rather than
       nothing at all. */
    (overlay ?? (el as HTMLElement)).style.display = "none";

    /* ⚠️⚠️ **A DARKENING BACKDROP IS OFTEN A SIBLING OF THE BANNER, NOT ITS ANCESTOR — and the
       walk above cannot find a sibling.** Measured on valetliving.com/contact/support/
       (OneTrust): `.onetrust-pc-dark-filter` is a SEPARATE child of `#onetrust-consent-sdk`,
       sitting BESIDE `#onetrust-banner-sdk` rather than wrapping it — full viewport
       (1092x901), `position: fixed`, `z-index: 2147483645`, `rgba(0,0,0,.5)`. Hiding the
       banner (the ancestor walk's only find) left this in place: it goes from an obvious
       white box to a faint grey wash once the banner is gone, so it barely reads as still
       there, and it keeps swallowing every click and keystroke meant for the form beneath it
       — exactly the reported "even after closing it I can't write in the form".

       So after taking down the ancestor overlay, sweep the WHOLE document for anything else
       still covering the viewport and take that down too. Bounded to elements that are
       actually overlay-shaped (fixed/absolute AND near-full-viewport) so ordinary page
       chrome is never touched — a sticky header or a fixed side rail is never both hundreds
       of pixels tall and nearly the full window width at once, which a backdrop always is. */
    const vw = view?.innerWidth, vh = view?.innerHeight;
    if (view && vw && vh) {
      doc.querySelectorAll<HTMLElement>("*").forEach((n) => {
        if (n === overlay || n.style.display === "none") return;
        const st = view.getComputedStyle(n);
        if (st.display === "none" || st.visibility === "hidden") return;
        if (st.position !== "fixed" && st.position !== "absolute") return;
        const r = n.getBoundingClientRect();
        if (r.width >= vw * 0.9 && r.height >= vh * 0.9) n.style.display = "none";
      });
    }
  }, true);

  let last = 0;
  doc.addEventListener("click", (e) => {
    const el = (e.target as Element | null)?.closest?.('button, input[type="button"], input[type="submit"], a[role="button"]');
    if (!el) return;
    const label = `${(el.textContent || (el as HTMLInputElement).value || "").trim()} ${el.getAttribute("name") || ""}`;
    if (!SUBMITTISH.test(label)) return;
    e.preventDefault();
    e.stopPropagation();
    /* The click and the form's own submit can both arrive; one lead per gesture. */
    if (Date.now() - last < 400) return;
    last = Date.now();
    onSubmit(collectValues(doc, (el.closest("form") as HTMLFormElement) ?? undefined));
  }, true);

  return { forms: doc.querySelectorAll("form").length, buttons, dismissers };
}

interface Probe {
  ok: boolean; error?: string; finalUrl?: string; title?: string;
  formFields?: number; forms?: number; ms?: number; bytes?: number;
  via?: "render" | "unblock" | "fetch"; fallbackReason?: string;
}

export function ReplicaPageScreen() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useProfile();
  /* The SE's "after submit, show this page", set on the Book online menu — see that panel. */
  const { thankYou } = useBookingOverride(profile.id);
  /* ⚠⚠ **RESOLVED WHEN THE PAGE OPENS, NOT WHEN SUBMIT IS PRESSED.** Looking it up on submit
     would put a round trip (and possibly a live fetch) between the click and the confirmation,
     which is the one moment of this beat anyone is watching. Resolving up front makes the
     submit a single src assignment. */
  const [thanksSrc, setThanksSrc] = useState("");
  useEffect(() => {
    if (!thankYou) { setThanksSrc(""); return; }
    let alive = true;
    fetch(`/api/replicate/lookup?url=${encodeURIComponent(thankYou)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        /* A capture if one exists, otherwise the live fetch — the same two sources the main
           frame already uses, so a thank-you page needs no separate capture step to work. */
        setThanksSrc(j?.ok
          ? (j.source === "static" ? `/replicas/${j.file}` : `/api/replicas/dyn/${j.file}`)
          : `/api/replicate?url=${encodeURIComponent(thankYou)}`);
      })
      .catch(() => { if (alive) setThanksSrc(`/api/replicate?url=${encodeURIComponent(thankYou)}`); });
    return () => { alive = false; };
  }, [thankYou]);

  /* ⚠⚠ **READ THROUGH A REF, NOT A DEPENDENCY.** The submit handlers are bound once per frame
     load; adding `thanksSrc` to that effect would RE-WIRE every form each time the lookup
     resolves, and the resolution lands AFTER the first bind — so a value read from the closure
     would be the empty string exactly when it matters. The ref is read at click time. */
  const thanksRef = useRef("");
  useEffect(() => { thanksRef.current = thanksSrc; }, [thanksSrc]);
  const { add: addQuote } = useQuoteCaptures();
  const loc = useLocationOverride(profile.id);
  const d = derive(profile, loc.place ?? undefined);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [err, setErr] = useState("");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [mapped, setMapped] = useState<number | null>(null);

  const url = params.get("url") || "";

  /* ⚠️⚠️ **A CAPTURE CAN LIVE IN TWO PLACES, AND THIS IS THE ONE PLACE THAT CHECKS BOTH.** The
     two library demos (Aptive, AutoNation) ship as static files and resolve instantly, with no
     network call, from the compile-time registry. Everything the Replicate button makes lives
     in the persistent store instead (survives a restart, which the button was built for) and
     needs one lookup to `/api/replicate/capture`'s twin, `/api/replicate/lookup`. `undefined`
     means "still checking" — kept distinct from `null` ("checked; nothing exists") so the
     screen never flashes "no fillable form" while the dynamic lookup is still in flight. */
  const [captured, setCaptured] = useState<
    | { source: "static" | "dynamic"; file: string; sourceUrl: string; capturedAt: string; label: string; fields?: ReturnType<typeof deriveFieldMap>["map"] }
    | null
    | undefined
  >(undefined);

  useEffect(() => {
    let alive = true;
    setCaptured(undefined);

    /* ⚠⚠ **THE SERVER DECIDES WHICH CAPTURE EXISTS — THE BROWSER CANNOT, AND ASSUMING IT
       COULD IS WHAT PRODUCED A BLANK SCREEN ON PRODUCTION.** This used to short-circuit on the
       BUNDLED registry (`replicaFor`/`replicaBySlug`) and never ask at all. That registry ships
       in the JS; the capture files it names are git-ignored, so on a deploy the client asserted
       a static hit, framed `/replicas/aptive.html`, and got the SPA shell back — the app
       rendering itself inside the iframe, blank, while the capture Replicate had genuinely just
       made sat unused in the dynamic store. Only the server can see its own disk, and its
       lookup now checks the file before claiming a static hit, so one round trip is the whole
       answer. The `undefined` ("still checking") state this already models is what makes the
       extra hop invisible — the screen shows "Opening…" rather than a wrong verdict. */
    if (!slug && !url) { setCaptured(null); return; }

    const qs = slug ? `slug=${encodeURIComponent(slug)}` : `url=${encodeURIComponent(url)}`;
    fetch(`/api/replicate/lookup?${qs}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setCaptured(j?.ok ? { source: j.source, file: j.file, sourceUrl: j.sourceUrl, capturedAt: j.capturedAt, label: j.label, fields: j.fields ?? undefined } : null);
      })
      .catch(() => { if (alive) setCaptured(null); });
    return () => { alive = false; };
  }, [slug, url]);

  /* Still resolving which capture (if any) applies — nothing has failed, nothing is ready yet. */
  const resolving = captured === undefined;
  const src = resolving
    ? ""
    : captured
      ? (captured.source === "static" ? `/replicas/${captured.file}` : `/api/replicas/dyn/${captured.file}`)
      : url ? `/api/replicate?url=${encodeURIComponent(url)}` : "";
  const nothing = !resolving && !src;

  /* Metadata for the banner and the honest "no form here" verdict. Only for a live fetch — a
     capture is known-good because `audit:replicas` checks it on disk. */
  useEffect(() => {
    /* ⚠️ `captured !== null`, NOT `captured` — while it is `undefined` (still resolving) this
       must NOT start a live probe. That race is exactly what made the button look broken
       before: a live fetch racing the real capture lookup and sometimes winning. */
    if (captured !== null || !url) return;
    let alive = true;
    setProbe(null);
    fetch(`/api/replicate/probe?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setProbe(j); })
      .catch(() => { if (alive) setProbe({ ok: false, error: "Could not reach that page." }); });
    return () => { alive = false; };
  }, [captured, url]);

  useEffect(() => {
    if (nothing) return;
    const frame = frameRef.current;
    if (!frame) return;
    const bind = () => {
      const doc = frame.contentDocument;
      if (!doc) { setErr("The replica could not be read."); return; }
      const fields = captured?.fields ?? deriveFieldMap(doc).map;
      /* ⚠️⚠️ **EVERY SAME-ORIGIN DOCUMENT GETS WIRED, NOT JUST THE TOP ONE.** greenixpc.com's
         form is a HubSpot embed inside a frame, so binding only `doc` left the fields visible
         and completely dead — no submit, no lead. Each document is wired with its own
         collector, so whichever one the SE actually fills is the one read. */
      const docs = replicaDocs(doc);
      /* ⚠️⚠️ **THE AUTHORITATIVE COUNT COMES FROM THE RENDERED PAGE, NOT THE HTML TEXT.**
         Measured on National Van Lines: the fetched HTML contains 32 input elements and the
         rendered page has ZERO a person can fill — they are hidden until the site's own
         JavaScript reveals them. Reporting the text count said "32 fields" over a page with
         nothing on it, which is the precise failure this screen is supposed to prevent. */
      setMapped([...fields.name, fields.phone, fields.email, fields.zip, fields.message].filter(Boolean).length);
      const onSubmit = async (values: Record<string, string>): Promise<boolean> => {
        const read = readReplicaForm(fields, values);
        if (!read.ok) { setErr("That form did not include a name and a way to reach them, so no lead was created."); return false; }
        setErr("");
        /* ⚠️ THE ZIP BECOMES A CITY, because the lead payload names a place and the captured
           real one reads "Location: Lowell". Falls back to the raw ZIP rather than making the
           SE wait on a network call that may not answer. */
        let where = read.zip || d.shortCity;
        if (/^\d{5}$/.test(read.zip)) {
          try {
            const r = await fetch(`/api/zip?zip=${encodeURIComponent(read.zip)}`);
            const j = await r.json().catch(() => ({}));
            if (r.ok && j?.place?.label) where = String(j.place.label).split(",")[0].trim();
          } catch { /* keep the ZIP */ }
        }
        /* ⚠️⚠️ **THE LEAD AND ITS SMS WORKFLOW STILL GET CREATED — ONLY THE ON-SCREEN
           CONFIRMATION WAS REMOVED.** Asked for directly, alongside the top bar below: "its ok
           that nothing is said when the submit button is pressed, i want you to still create
           the lead and SMS Workflow tho." `addQuote` is what both Salesforce Leads and the
           generated SMS workflow (`quoteWorkflow.ts`, `useExtraWorkflows`) derive from, so
           leaving this call in place is the entire fix — nothing downstream needed to change.
           `setSent` (the green "Lead created for X" banner) is gone; see the render below. */
        addQuote(profile.id, {
          id: String(Date.now()), iso: new Date().toISOString(), business: profile.customerName,
          name: read.name, message: read.message, service: "",
          how: read.phone ? "sms" : "email", contact: read.phone || read.email,
          location: where, source: "web",
        });
        return true;
      };
      /* ⚠⚠ **THE REVEAL IS PER DOCUMENT, WHICH IS WHY IT IS WRAPPED HERE RATHER THAN INSIDE
         `onSubmit`.** A captured form can live in an embedded frame (greenixpc.com's does), and
         the confirmation that belongs to it lives in THAT document — the shared `onSubmit`
         closure has no idea which one was actually submitted. Each frame is wired with its own
         wrapper, so whichever the SE fills is the one that answers.
         ⚠️ **THE LEAD IS CREATED FIRST AND THE REVEAL CANNOT AFFECT IT.** `onSubmit` is async and
         is deliberately not awaited: the Salesforce lead and its SMS workflow are what the beat
         is FOR, and a DOM helper throwing must never be able to take them down with it. */
      for (const d of docs) {
        wireFrame(d, (values) => {
          /* ⚠⚠ **ONLY SAY THANK YOU IF A LEAD WAS ACTUALLY CREATED.** A submit with no usable
             name or contact is refused above and reports why; revealing the page's own
             confirmation over that error would have the screen thanking someone while telling
             them it failed — the never-claim-success rule this repo applies everywhere. */
          void onSubmit(values).then((created) => {
            if (!created) return;
            /* ⚠️ **THE SE'S OWN PAGE WINS OVER THE PAGE'S HIDDEN ONE.** Setting "after submit"
               is an explicit instruction about this exact moment; a confirmation block we
               merely recognised is the fallback for when nobody gave one. */
            if (thanksRef.current) { frame.src = thanksRef.current; return; }
            const read = readReplicaForm(fields, values);
            try { revealConfirmation(d, read.name); } catch { /* the page simply keeps its form */ }
          });
        });
      }
      /* ⚠⚠ **AND THE EMBED HAS TO BE TALL ENOUGH TO SHOW ITS OWN SUBMIT BUTTON.** A captured
         third-party form frame keeps the height its host script last set, and the script that
         would grow it is stripped — on greenixpc.com that left Submit 29px below the frame's
         edge with no scrollbar, so the form read as having no way to send it. Run TWICE: once
         now, and once after the fonts and images that change a form's height have settled. */
      fitEmbeddedFrames(doc);
      refit = setTimeout(() => fitEmbeddedFrames(doc), 600);
    };
    let refit: ReturnType<typeof setTimeout> | undefined;
    frame.addEventListener("load", bind);
    /* ⚠️⚠️ **`about:blank` REPORTS `readyState === "complete"`, AND THAT MADE THE BANNER LIE.**
       A freshly created iframe already has a contentDocument — the blank one — so this guard,
       meant to catch a frame that had finished loading before the effect ran, fired against an
       empty page: no forms, no markers, `mapped` set to 0, and the banner said "no fillable
       form" over a captured page with five. It corrected itself when the real `load` arrived,
       which is worse than being slow — an SE glancing at it sees the feature not working.
       Measured by sampling the banner every 20ms from the click. */
    const doc0 = frame.contentDocument;
    if (doc0 && doc0.readyState === "complete" && doc0.URL !== "about:blank") bind();
    return () => { frame.removeEventListener("load", bind); clearTimeout(refit); };
  }, [nothing, captured, src, profile.id, profile.customerName, addQuote, d.shortCity]);

  /* ⚠️ A ONE-LINE STATE, NOT A SPINNER SCREEN — this only shows for the moment it takes to ask
     the server "is this already captured", which is a local disk read, not a network fetch. By
     the time the button's own 30-90s capture finishes, `/replica` navigates to a URL the lookup
     resolves on its very first render. */
  if (resolving) {
    return <div style={{ padding: 40, fontFamily: "system-ui, sans-serif", color: "#5b6577" }}>Opening…</div>;
  }

  if (nothing) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 20 }}>Nothing to replicate</h1>
        <p style={{ color: "#5b6577" }}>Open this from Replicate in the Book online menu, with a URL in the box.</p>
        <button onClick={() => navigate(-1)}>Go back</button>
      </div>
    );
  }

  /* Zero fillable fields is the outcome that must never look like success — see the header.
     Judged on what the rendered page actually offers (`mapped`), which is only known once the
     frame has loaded; until then there is nothing to claim either way. */
  const liveNoForm = !captured && mapped === 0;
  const liveFailed = !captured && probe?.ok === false;

  /* ⚠️⚠️ **THE TOP BAR AND THE GREEN "LEAD CREATED" CONFIRMATION ARE GONE, BOTH BY REQUEST —
     "removed these 2 bars as they are not a part of the page."** The whole point of a replica
     is that it looks like the prospect's real site; a strip of our own chrome across the top,
     and a banner announcing a Salesforce lead across the middle, are both exactly the kind of
     seam that breaks that illusion. There is deliberately no replacement affordance for "back"
     — the browser's own back button already returns to Google Search, since navigating here
     pushed a real history entry, and adding a floating control just to get back would be the
     same kind of seam this removal is for.
     ⚠️ Submitting the form is unaffected: `addQuote` above still runs on every submit, so the
     Salesforce lead and its SMS workflow are created exactly as before — only the on-screen
     announcement of that is gone. Error states (`.rep-err` / `.rep-note` below) are UNCHANGED:
     those exist for the case where the replica itself is broken (no form, blocked fetch), which
     is a different situation from "submission is safe and stays quiet" and wasn't part of what
     was asked here. */
  return (
    <div className="rep-root">
      {liveFailed && <div className="rep-err">{probe?.error}</div>}
      {/* ⚠️ THE LESS ACCURATE COPY SAYS SO. A page missing its lazy images and injected icons
          looks like a badly built replica rather than a fallback, and the SE has no way to tell
          the difference — which is exactly how this feature lost trust the first time. */}
      {!captured && probe?.ok && probe.via === "fetch" && probe.fallbackReason && (
        <div className="rep-note">Showing the fast copy — {probe.fallbackReason}</div>
      )}
      {liveNoForm && (
        <div className="rep-err">
          <b>Nothing to fill in on this page.</b> Its form is built by JavaScript, which a server
          fetch cannot run{probe?.formFields ? ` (the HTML carries ${probe.formFields} hidden inputs, none of them usable)` : ""}.
          The page itself is real. A browser-made capture of this URL would work — see
          <code> scripts/capture-replica.js</code>.
        </div>
      )}
      {err && <div className="rep-err">{err}</div>}

      <iframe ref={frameRef} className="rep-frame" src={src}
        title={`${profile.customerName} booking page (replica)`} />
    </div>
  );
}
