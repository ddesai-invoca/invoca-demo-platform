import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
import { useLocationOverride } from "../data/locationOverride";
import { useQuoteCaptures } from "../data/QuoteCaptureContext";
import { bookingPath } from "../data/bookingPath";
import { useBookingOverride, type BookingOverride } from "../data/bookingOverride";
import {
  derive, trackedSiteUrl, tileXY, MAPBOX_TOKEN, Z, TS,
} from "../data/prospectPlace";

/* GOOGLE SEARCH RESULTS, with the prospect holding the top sponsored slot.

   Reached from the green "Network" chip in the top bar, and it is the front of
   the same story the ChatGPT placement tells: a buyer searches, the prospect
   pays for the first slot, the click lands on their site carrying the paid
   parameters, and THAT is the visit Invoca stitches to the call that follows.

   Matched to a SingleFile capture of the real dark-theme results page
   (google.com/search?q=alarm+systems+%26+security+near+me), measured rather
   than eyeballed. The values that shape everything below:
     page #22242a · text #e8e8e8 · secondary #9e9e9e · muted #bdc1c6
     link #99c3ff · place action #a8c7fa · hairline #444746 · pill #2c2e35
     search pill #4d5156, 694x52, radius 26 · results column x=122, width 652
     result title 22/28 · sitelink 18/26 · place name 18/24 · Places head 28/36
     ad name 14/20 #dadce0 · ad url 12/18 #bdc1c6 · favicon 28px white circle
     local pack 876 wide, radius 12, map column 438 wide
   "Google Sans" is not bundled (no webfont here), so headings fall back to
   Roboto/Arial. That is the one deliberate difference from the capture.

   Two rules from the ChatGPT screen carry over verbatim:
     1. the FIRST sponsored slot is always the prospect (in both ad blocks), and
     2. the map is the prospect's own location, never a generic one.

   Everything is derived from the profile via prospectPlace.ts, which the
   ChatGPT screen shares, so both screens put the prospect in the same city
   against the same competitors. No schema change, no generation phase. */

/* Competitors, directories and review counts here are INVENTED, built from the
   city plus the industry. The capture's own results name real businesses
   (Yelp, ADT, Vivint) with real snippets and real ratings, and reproducing that
   shape with fabricated copy would put words in a named company's mouth. The
   rival names come from prospectPlace.ts, which already rejects any candidate
   that collides with the prospect's own name. */

const LOGO = "M83.4 23.08a7.4 7.4 0 0 0 6.34-3.52l-2.3-1.5a4.8 4.8 0 0 1-3.9 2.2 4.6 4.6 0 0 1-3.99-2.4l10.33-4.39a7 7 0 0 0-.28-1.07c-1.23-3.16-3.38-4.6-6.28-4.6-4.42 0-7.43 3.22-7.43 7.68 0 4.56 3.17 7.6 7.5 7.6m-4.51-7.61v-.17c0-2.93 1.68-4.9 4.32-4.9 1.26 0 2.39.57 3.15 1.9zM74.3 2.41h-3.08v20.23h3.08zM61.77 29.2q7.18 0 7.17-8.22V8.23h-2.93v1.8h-.06c-.92-1.43-2.66-2.23-4.62-2.23-4.24 0-6.82 3.23-6.82 7.54 0 4.3 2.51 7.46 6.93 7.46a5.5 5.5 0 0 0 4.47-2.26h.1v1.31c0 2.9-1.5 4.6-4.29 4.6-1.82 0-3.03-1-3.92-2.68l-2.66 1.17c1.4 2.96 3.4 4.26 6.63 4.26m0-9.2c-2.59 0-4.24-1.9-4.24-4.75 0-2.74 1.64-4.71 4.25-4.71s4.23 1.83 4.23 4.7c0 2.9-1.7 4.76-4.24 4.76m-16.01 3.1c4.44 0 7.6-3.24 7.6-7.72 0-4.4-3.12-7.67-7.6-7.67-4.24 0-7.57 3-7.57 7.67 0 4.45 3.15 7.73 7.57 7.73m0-2.68c-2.68 0-4.56-2.2-4.56-5.04s1.98-4.99 4.56-4.99c2.73 0 4.57 2.2 4.57 5 0 2.87-1.88 5.03-4.57 5.03M29.33 23.1c4.41 0 7.6-3.23 7.6-7.72 0-4.4-3.12-7.67-7.6-7.67-4.23 0-7.57 3-7.57 7.67 0 4.45 3.15 7.73 7.57 7.73m0-2.68c-2.68 0-4.56-2.2-4.56-5.04s1.98-4.99 4.56-4.99c2.73 0 4.57 2.2 4.57 5 0 2.87-1.88 5.03-4.57 5.03M10.35 23.1c5.89.06 9.9-3.9 9.9-9.98q0-.75-.14-1.7h-9.8v2.93h6.87c-.36 3.83-3.06 5.82-6.76 5.82-4.15 0-7.33-3.12-7.33-7.66 0-4.47 3.03-7.6 7.33-7.6 2.16 0 3.76.67 5.35 2.3l2.05-2.14c-1.8-2.1-4.4-3.1-7.44-3.1-5.9 0-10.49 4.43-10.49 10.5 0 5.8 4.43 10.58 10.46 10.64";

/* Thin line icons, same approach as the ChatGPT screen: the filled Material set
   the app bundles reads far too heavy against this background. */
const P: Record<string, string> = {
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  close: "M6 6l12 12M18 6L6 18",
  mic: "M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 11a7 7 0 0 1-14 0M12 18v4",
  lens: "M4 4h5l2-2h2l2 2h5v14H4zM12 15a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  share: "M12 16V3M7 8l5-5 5 5M4 16v4h16v-4",
  apps: "M5 5h2v2H5zM11 5h2v2h-2zM17 5h2v2h-2zM5 11h2v2H5zM11 11h2v2h-2zM17 11h2v2h-2zM5 17h2v2H5zM11 17h2v2h-2zM17 17h2v2h-2z",
  pin: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 1v3M12 20v3M1 12h3M20 12h3",
  kebab: "M12 7h.01M12 12h.01M12 17h.01",
  chevRight: "M9 6l6 6-6 6",
  chevUp: "M6 15l6-6 6 6",
  chevDown: "M6 9l6 6 6-6",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18",
  directions: "M12 2l10 10-10 10L2 12 12 2zM12 8v4h4",
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
};

/* =============================================================================
   THE LSA UNIT'S ICONS — FILLED, and extracted VERBATIM from the capture
   -----------------------------------------------------------------------------
   ⚠️⚠️ **THESE ARE DELIBERATELY NOT THE THIN STROKE GLYPHS `P` HOLDS.** That set exists
   because the app's own filled Material icons read too heavy for this page's CHROME (the
   search pill, the tabs). The LSA unit is the opposite case: its icons ARE Google's filled
   Material set, measured off the capture at `fill: rgb(168,199,250)` — so the real paths are
   lifted whole, per the standing "USE THE REAL ICONS" rule, and rendered with `<Icon fill />`.
   Re-drawing them as outlines would be approximating an icon we have verbatim.
   ============================================================================= */
const LSA_P: Record<string, string> = {
  /* "Get quote" and the header's "Get competitive quotes" — the same 18px glyph in both. */
  quote: "M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H4V4h16v12z M6 12h12v2H6zm0-3h12v2H6zm0-3h12v2H6z",
  calendar: "M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z",
  /* 20px in the capture where the other two are 18px, and left that way. */
  phone: "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
  moreVert: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  expandMore: "M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z",
  /* The quote dialog's own glyphs, from the same capture. */
  arrowBack: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  people: "M15 8c0-1.42-.5-2.73-1.33-3.76.42-.14.86-.24 1.33-.24 2.21 0 4 1.79 4 4s-1.79 4-4 4c-.43 0-.84-.09-1.23-.21-.03-.01-.06-.02-.1-.03A5.98 5.98 0 0 0 15 8zm1.66 5.13C18.03 14.06 19 15.32 19 17v3h4v-3c0-2.18-3.58-3.47-6.34-3.87zM9 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0 9c-2.7 0-5.8 1.29-6 2.01V18h12v-1c-.2-.71-3.3-2-6-2M9 4c2.21 0 4 1.79 4 4s-1.79 4-4 4-4-1.79-4-4 1.79-4 4-4zm0 9c2.67 0 8 1.34 8 4v3H1v-3c0-2.66 5.33-4 8-4z",
  check: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
};

function Icon({ d, size = 18, fill = false }: { d: string; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"}
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* Deterministic per prospect, so an SE who revisits sees the same page and the
   same click URL rather than numbers that move under them. */
function hash(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 2147483647;
  return h;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/* A Google click identifier. Real ones are an opaque base64url blob, and it is
   the parameter that makes a click a PAID click, so the demo URL has to carry
   one. Generated from the prospect id, not at random, so the URL is stable. */
function gclid(seed: string): string {
  let h = hash(seed) || 1;
  let s = "Cj0KCQjw";
  for (let i = 0; i < 44; i++) {
    h = (h * 1103515245 + 12345) % 2147483648;
    /* The HIGH bits. Reading h % 64 takes the low six bits of a power-of-two
       LCG, whose period there is a handful of steps, and the id came out as
       "Cj0KCQjwAAAAAAAAAAA4AAAA..." — visibly not an opaque token. */
    s += B64[(h >>> 13) % 64];
  }
  return s;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/* The prospect's site as a PAID click: the Google click id, the utm set an
   agency would put on a search ad, and Invoca's own opportunity reference.
   The campaign is the prospect's real top campaign from the Marketing
   Performance dashboard, so the click the SE demos here is traceable to a row
   they can then open in the platform. Built with URL() so it survives a domain
   that already has a query string. */
function paidClickUrl(domain: string, campaign: string, query: string, seed: string): string {
  const u = new URL(trackedSiteUrl(domain));      // carries oppref already
  u.searchParams.set("utm_source", "google");
  u.searchParams.set("utm_medium", "cpc");
  u.searchParams.set("utm_campaign", slugify(campaign));
  u.searchParams.set("utm_term", query);
  u.searchParams.set("utm_content", "text_ad_1");
  u.searchParams.set("gclid", gclid(seed));
  return u.toString();
}

/* =============================================================================
   "Book online" — a tracked handoff, and deliberately nothing more (9/12/2026)
   -----------------------------------------------------------------------------
   ⚠️⚠️ **MEASURED: GOOGLE DOES NOT HOST THIS FORM.** In the capture, "Book online" is an
   `<a href>` to `google.com/localservices/booking?ebd=<base64>`, and that blob decodes to the
   advertiser's OWN booking system plus a Reserve-with-Google token. Of the eight advertisers
   in the capture: **six go to ServiceTitan** (`book.servicetitan.com/<tenant-id>`), Roto-Rooter
   goes to its own `rotorooter.com/schedule-service/?zipCode=…`, and one goes to a third-party
   form builder. Every destination carries `rwg_token=AE37R_…`.

   ⚠️⚠️ **SO THERE IS NO BOOKING FORM TO REPLICATE, AND THAT IS WHY THIS BEAT ENDS AT THE
   CLICK.** Two separate reasons, both measured:
     1. Even among ServiceTitan advertisers the form is per-TENANT — services, fields and
        branding are configured per business, so one replica matches none of them.
     2. ServiceTitan is a HOME-SERVICES product, and only **2 of the 15 prospects** on disk are
        home services. The other 13 are healthcare, hotels, auto, insurance, senior living,
        retail and moving; Orlando Health does not book through ServiceTitan.
   A generic booking page was designed and rejected for the same reason a generic one always is
   here: it would be a form nobody's prospect actually uses, presented as theirs.

   ⚠️ **AND NOTHING COMES BACK, WHICH IS HONEST RATHER THAN A GAP.** A real third-party form is
   cross-origin, submitting it would create a real booking at a real business, and `rwg_token`
   is Google's tag, not Invoca's. What makes a form submission reach Invoca in the real world is
   **InvocaJS deployed on the advertiser's own booking page** — the hidden field it injects —
   which is a property of that page, not of this click. So the click is tagged (`oppref`, the
   same token every outbound link on this screen carries) and the story stops there.

   ⚠️ The `rwg_token` is FABRICATED per prospect for exactly the reason `gclid` already is on
   this screen: it is the parameter that marks a booking click as coming from the ad, so a demo
   URL that omitted it would be missing the thing being demonstrated. Deterministic, so the URL
   an SE opens twice is the same URL.
   ============================================================================= */
function bookingHandoffUrl(domain: string, campaign: string, seed: string): string {
  const u = new URL(trackedSiteUrl(domain));      // carries oppref already
  /* ⚠️⚠️ **THE BOOKING PAGE, NOT THE HOME PAGE — see `bookingPath`.** Reported directly:
     *"the book online link is just taking them to their website, it needs to take them to the
     actual page to what happens when they click book online, for example when you click on the
     book online for Roto Rooter it takes them to URL: www.rotorooter.com/schedule-service/…
     and not the home page."* Correct, and the decoded `ebd=` blobs say the same: the handoff
     lands on the advertiser's own BOOKING page. Unknown prospect -> "/", which is the home
     page and is never a 404. */
  u.pathname = bookingPath(domain);
  u.searchParams.set("utm_source", "google");
  /* Local Services Ads are their own medium — not `cpc`, which the text ad already uses. */
  u.searchParams.set("utm_medium", "lsa");
  u.searchParams.set("utm_campaign", slugify(campaign));
  u.searchParams.set("utm_content", "book_online");
  u.searchParams.set("rwg_token", `AE37R_${gclid(`rwg:${seed}`).slice(8, 44)}`);
  return u.toString();
}

/* ---------------------------------------------------------------- the header */

function Header({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const [draft, setDraft] = useState(query);
  const navigate = useNavigate();

  /* The logo is the way back into the platform, the same convention the saved
     Google Ads console page uses. history.back() keeps the screen the SE came
     from; a direct load has nothing to go back to, so it falls to Dashboards. */
  const back = () =>
    window.history.length > 1 ? navigate(-1) : navigate("/dashboards");

  return (
    <header className="gs-head">
      <div className="gs-head-row">
        <button className="gs-logo" onClick={back} aria-label="Back to the demo platform">
          <svg width="92" height="30" viewBox="0 0 92 30"><path fill="#fff" d={LOGO} /></svg>
        </button>

        {/* Editable, and Enter re-renders the page around the new wording. It
            does NOT search: the results stay the prospect's, which is the point
            of the screen. A frozen box reads as broken, so this is the honest
            middle ground. */}
        <form className="gs-pill" onSubmit={(e) => { e.preventDefault(); onQuery(draft); }}>
          <input className="gs-input" value={draft} aria-label="Search"
            onChange={(e) => setDraft(e.target.value)} />
          <button type="button" className="gs-pill-btn" aria-label="Clear"
            onClick={() => setDraft("")}><Icon d={P.close} size={20} /></button>
          <span className="gs-pill-div" />
          <span className="gs-pill-btn gs-mic"><Icon d={P.mic} size={20} /></span>
          <span className="gs-pill-btn gs-lens"><Icon d={P.lens} size={20} /></span>
          <button type="submit" className="gs-pill-btn gs-go" aria-label="Search">
            <Icon d={P.search} size={20} />
          </button>
        </form>

        <div className="gs-head-icons">
          <span className="gs-hi"><Icon d={P.share} size={20} /></span>
          <span className="gs-hi"><Icon d={P.apps} size={20} fill /></span>
          <span className="gs-avatar">D</span>
        </div>
      </div>

      <nav className="gs-tabs">
        {["AI Mode", "All", "Shopping", "Maps", "Images", "Forums", "Videos"].map((t) => (
          <span key={t} className={"gs-tab" + (t === "All" ? " gs-tab-on" : "")}>{t}</span>
        ))}
        <span className="gs-tab">More <Icon d={P.chevDown} size={14} /></span>
        <span className="gs-tab gs-tools">Tools <Icon d={P.chevDown} size={14} /></span>
      </nav>
    </header>
  );
}

/* ------------------------------------------------------------------- the ads */

interface Ad {
  brand: string; domain: string; url: string; title: string; body: string;
  prospect: boolean; sitelinks?: string[]; chips?: string[];
  visits?: string; rating?: string; phone?: string; href?: string;
}

function Favicon({ ad }: { ad: Ad }) {
  const [failed, setFailed] = useState(false);
  /* Only the prospect gets a real icon (Google's favicon service). The rivals
     are invented, so a convincing logo is the wrong kind of convincing. */
  if (ad.prospect && !failed) {
    return (
      <span className="gs-fav">
        <img src={`https://www.google.com/s2/favicons?sz=64&domain=${ad.domain}`}
          alt="" onError={() => setFailed(true)} />
      </span>
    );
  }
  return <span className="gs-fav gs-fav-alt" aria-hidden="true">{ad.brand[0]}</span>;
}

function AdBlock({ ad }: { ad: Ad }) {
  /* The headline is a real link ONLY for the prospect. The rivals keep the
     styling so the block reads right, but they go nowhere. */
  return (
    <div className="gs-ad">
      <div className="gs-ad-head">
        <Favicon ad={ad} />
        <span className="gs-ad-id">
          <span className="gs-ad-brand">{ad.brand}</span>
          <span className="gs-ad-url">
            {ad.href ? (
              <a href={ad.href} target="_blank" rel="noopener noreferrer">{ad.url}</a>
            ) : ad.url}
            <span className="gs-kebab"><Icon d={P.kebab} size={16} /></span>
          </span>
        </span>
      </div>

      {ad.href ? (
        <a className="gs-ad-title" href={ad.href} target="_blank" rel="noopener noreferrer">
          {ad.title}
        </a>
      ) : <span className="gs-ad-title">{ad.title}</span>}
      <div className="gs-ad-body">{ad.body}</div>

      {ad.rating && <div className="gs-ad-rating">Rating for {ad.domain}: {ad.rating}</div>}

      {/* Inline sitelink chips, the second block's format in the capture. */}
      {ad.chips && (
        <div className="gs-chips">
          {ad.chips.map((c) => <span key={c} className="gs-chip">{c}</span>)}
        </div>
      )}

      {ad.phone && (
        <div className="gs-ad-call">
          <Icon d={P.phone} size={14} /> Call {ad.phone}
        </div>
      )}

      {ad.visits && <div className="gs-ad-visits">{ad.visits} visits in past month</div>}

      {/* Stacked sitelink rows, the first block's format: hairline separated,
          each 50px tall with a chevron pinned right. */}
      {ad.sitelinks && (
        <div className="gs-sitelinks">
          {ad.sitelinks.map((s) => (
            <div className="gs-sitelink" key={s}>
              <span>{s}</span><Icon d={P.chevRight} size={20} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- the local pack */

interface Place {
  name: string; rating: string; reviews: string; type: string; area: string;
  phone?: string; hours: string; note: string; prospect: boolean;
  sponsored?: boolean; href?: string;
}

function PackMap({ d, places }: { d: ReturnType<typeof derive>; places: Place[] }) {
  const [broken, setBroken] = useState(false);
  const [lat, lon] = d.coords;
  const c = tileXY(lat, lon);
  const cx = c.x * TS, cy = c.y * TS;

  /* Same renderer as the ChatGPT screen's map, for the same reason: Google's
     dark map is a navy basemap with pale roads, and Mapbox's night style is the
     closest thing we can serve as a single <img>. CARTO's dark basemap is
     near-black grayscale, which is visibly not this. */
  const src = MAPBOX_TOKEN
    ? "https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/static/"
      + `${lon},${lat},${Z - 1},0/440x620@2x`
      + `?access_token=${MAPBOX_TOKEN}&logo=false&attribution=false`
    : null;

  return (
    <div className="gs-map">
      {broken ? <div className="gs-map-off" /> : src ? (
        <img className="gs-map-img" src={src} alt={`Map of ${d.city}`}
          onError={() => setBroken(true)} />
      ) : (
        <div className="gs-tiles">
          {[-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => {
            const tx = Math.floor(c.x) + dx, ty = Math.floor(c.y) + dy;
            return (
              <img key={`${tx}/${ty}`} alt="" draggable={false} className="gs-tile"
                src={`https://a.basemaps.cartocdn.com/dark_all/${Z}/${tx}/${ty}@2x.png`}
                onError={() => setBroken(true)}
                style={{ left: tx * TS - cx + 220, top: ty * TS - cy + 310 }} />
            );
          }))}
        </div>
      )}

      {/* Pins sit at fixed offsets from the centre. We know the prospect's city,
          not each business's street address, and the rivals have no address at
          all, so pretending to plot them would be the fake part. */}
      {places.filter((p) => !p.sponsored).map((pl, i) => (
        <span key={pl.name + i} className={"gs-pin" + (pl.prospect ? " gs-pin-on" : "")}
          style={{ left: `${[52, 30, 68, 41][i]}%`, top: `${[34, 52, 58, 72][i]}%` }}>
          <Icon d={P.pin} size={pl.prospect ? 22 : 18} fill />
          <span className="gs-pin-label">{pl.name}</span>
        </span>
      ))}

      <button className="gs-map-open">Open in Maps</button>
      <div className="gs-map-zoom">
        <button aria-label="Zoom in"><Icon d={P.plus} size={16} /></button>
        <button aria-label="Zoom out"><Icon d={P.minus} size={16} /></button>
      </div>
      <span className="gs-map-attr">Map data © Mapbox © OpenStreetMap</span>
    </div>
  );
}

function PlaceRow({ pl }: { pl: Place }) {
  return (
    <div className="gs-place">
      <div className="gs-place-main">
        {pl.sponsored && <span className="gs-spons-tag">Sponsored</span>}
        <span className="gs-place-name">{pl.name}</span>
        <span className="gs-place-stars">
          <span className="gs-rate">{pl.rating}</span>
          <span className="gs-stars" aria-hidden="true">★★★★★</span>
          <span className="gs-revs">({pl.reviews})</span>
          <span className="gs-dot">·</span>{pl.type}
        </span>
        <span className="gs-place-meta">{pl.area}{pl.phone ? ` · ${pl.phone}` : ""}</span>
        {/* Only the leading word is green in the capture ("Open · Closes 6 PM"),
            not the closing time. */}
        <span className="gs-place-hours">
          <b>{pl.hours.split(" · ")[0]}</b>
          {pl.hours.includes(" · ") ? ` · ${pl.hours.split(" · ")[1]}` : ""}
        </span>
        <span className="gs-place-note">
          <span className="gs-quote-ic" aria-hidden="true">”</span>{pl.note}
        </span>
      </div>
      <div className="gs-place-acts">
        {pl.href ? (
          <a className="gs-act" href={pl.href} target="_blank" rel="noopener noreferrer">
            <span className="gs-act-ic"><Icon d={P.globe} size={18} /></span>Website
          </a>
        ) : (
          <span className="gs-act">
            <span className="gs-act-ic"><Icon d={P.globe} size={18} /></span>Website
          </span>
        )}
        <span className="gs-act">
          <span className="gs-act-ic"><Icon d={P.directions} size={18} /></span>Directions
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- organic results */

interface Organic {
  brand: string; url: string; title: string; body: string;
  rating?: string; prospect?: boolean; href?: string;
}

function OrganicResult({ r }: { r: Organic }) {
  return (
    <div className="gs-res">
      <div className="gs-res-head">
        <span className={"gs-fav" + (r.prospect ? "" : " gs-fav-alt")}>
          {r.prospect ? <img src={`https://www.google.com/s2/favicons?sz=64&domain=${r.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}`} alt="" /> : r.brand[0]}
        </span>
        <span className="gs-ad-id">
          <span className="gs-ad-brand">{r.brand}</span>
          <span className="gs-ad-url">{r.url}<span className="gs-kebab"><Icon d={P.kebab} size={16} /></span></span>
        </span>
      </div>
      {r.href ? (
        <a className="gs-res-title" href={r.href} target="_blank" rel="noopener noreferrer">{r.title}</a>
      ) : <span className="gs-res-title">{r.title}</span>}
      <div className="gs-ad-body">{r.body}</div>
      {r.rating && (
        <div className="gs-res-rating">
          <span className="gs-rate">{r.rating.split("|")[0]}</span>
          <span className="gs-stars" aria-hidden="true">★★★★★</span>
          <span className="gs-revs">({r.rating.split("|")[1]})</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------- Local Services Ads */

/* =============================================================================
   Local Services Ads — two rows before the first Sponsored Results block
   -----------------------------------------------------------------------------
   Asked for directly, from a screenshot of a real LSA unit ("Sponsored Plumbers
   | Duluth"): Google's OTHER paid unit, shown above the text ads, for local
   trade categories (Google Guarantee-style). The prospect leads it, the same
   rule every other paid slot on this page follows; the second row is one of
   the SAME invented rivals the local pack already builds (`rivals[0]`), so
   this isn't a third set of invented business names.

   ⚠️⚠️ **THE HEADER NOUN IS A TRADE-PROFESSIONAL PLURAL ("Plumbers",
   "Electricians"), NOT `d.seg`.** `d.seg` is a product/category noun
   ("Window Treatments", "Vision Care") built for ad copy elsewhere on this
   page, and reads wrong as "Sponsored Window Treatmentss | Duluth" — wrong
   word class AND wrong pluralisation. `providerNoun()` below is a keyword
   table over `profile.industry`, the same shape as `vocabFor` in
   insightsCatalog.ts, with a generic `${seg} Providers` fallback so a
   vertical not in the table still reads as a real business category rather
   than crashing or printing nothing.

   ⚠️⚠️ **MEASURED OFF A REAL CAPTURE (9/12/2026), NOT THE SCREENSHOT.** A first pass
   authored this from the screenshot alone and was wrong in six ways that a picture cannot
   settle — every one of them is now a measured value, listed at the `.gs-lsa-*` rules in
   standalone.css. The ones worth naming here because they are invisible in a screenshot:
     • the heading is **20px Google Sans**, not the 16px the "Sponsored Results" heading uses,
       and it carries **no underline** — the first version borrowed `.gs-spons-head` whole;
     • the status line is **NOT all green**. Only the leading phrase ("Open 24 hours") is
       `#6dd58c`; the ` · ` and the badge after it are `#bfbfbf` — the same split
       `.gs-place-hours b` already does one section down, which the screenshot reads as a
       single green line;
     • the secondary text is **`#bfbfbf`**, which is neither `--gs-2` (#9e9e9e) nor
       `--gs-mut`; the LSA unit simply uses its own grey;
     • "Show more" is a **372x40 pill centred ON TOP of a full-width 1px rule**, not a
       standalone pill — the rule runs the whole 652 and the pill covers its middle.

   ⚠️ **THE PHOTOS ARE REAL TOO (9/12/2026).** The capture's rows carry 92x92
   `object-fit: cover` photographs, and so do these — the prospect's own via Places, the
   rival's from a curated per-vertical table. See `LSA_PHOTO` below for where each comes
   from and why they are two different sources. This block previously argued for an
   initial-letter tile instead; that is now only the last-resort fallback.
   ============================================================================= */
const PROVIDER_NOUN: [RegExp, string][] = [
  [/plumb/i, "Plumbers"],
  [/electric/i, "Electricians"],
  [/hvac|heating|air condition/i, "HVAC Companies"],
  [/roof/i, "Roofers"],
  [/pest/i, "Pest Control Companies"],
  [/mov(e|ing)/i, "Moving Companies"],
  [/lock/i, "Locksmiths"],
  [/garage door/i, "Garage Door Companies"],
  [/tree/i, "Tree Services"],
  [/window|blind|shutter|treatment/i, "Window Treatment Companies"],
  [/security|alarm/i, "Security Companies"],
  [/law|legal|attorney/i, "Lawyers"],
  [/insur/i, "Insurance Agents"],
  [/financ|advisor|wealth/i, "Financial Advisors"],
  [/real estate|realt/i, "Real Estate Agents"],
  [/auto|tire|car (dealer|repair)/i, "Auto Repair Shops"],
  [/dental|dentist/i, "Dentists"],
  [/health|medical|clinic|hospital|physician|doctor/i, "Doctors"],
  [/senior|home care|caregiv/i, "Home Care Providers"],
  [/pool/i, "Pool Services"],
  [/paint/i, "Painters"],
  [/landscap|lawn/i, "Landscapers"],
  [/carpet|floor/i, "Flooring Companies"],
  [/clean/i, "Cleaning Companies"],
];

function providerNoun(industry: string, seg: string): string {
  for (const [re, noun] of PROVIDER_NOUN) if (re.test(industry)) return noun;
  /* ⚠️ `${seg} Providers` ALONE PRINTED "Sponsored Hotels Providers | Santa Barbara" on
     Marriott. `industrySeg` returns a category noun that is ALREADY PLURAL about half the
     time ("Hotels", "Health Systems", "Care Services"), and the header wants a plural — so
     an already-plural seg is the answer as it stands, and only a singular one ("Vision
     Care") needs the suffix. `ss` is excluded so a word like "Fitness" is not read as plural. */
  return /s$/i.test(seg) && !/ss$/i.test(seg) ? seg : `${seg} Providers`;
}

/* =============================================================================
   THE ROW PHOTOS — real, and sourced differently for the two rows on purpose
   -----------------------------------------------------------------------------
   Asked for directly (9/12/2026), replacing the initial-letter tiles this shipped with:
   "I want the thumbnail pictures to be real pictures, so ofcourse for the prospect it
   should be a real pic, but for the made up ad in the 2nd row, you can choose whatever
   relevant real pic."

   ⚠️⚠️ **THE PROSPECT'S PHOTO IS THE PROSPECT'S OWN, VIA THE CHAIN ChatGptAd ALREADY
   USES** — `/api/place` (a real Google Places listing photo of the actual business),
   then `/api/og-image`, then the letter tile. Both endpoints already exist on BOTH
   server twins and `engine/places.ts` already REJECTS a listing whose name does not
   match the prospect, which is what stops this showing some other company's storefront.
   Measured live: AutoNation, Orlando Health and Roto-Rooter all return a real photo.

   ⚠️⚠️ **THE RIVAL'S IS A STOCK PHOTO, AND IT MUST NOT COME FROM PLACES.** Querying
   Places for an INVENTED name ("Miami Automotive Retail") would either find nothing or,
   worse, attach a real local business's photograph to a business this demo made up —
   the misattribution `nameMatches` exists to prevent. So the second row draws from a
   curated per-vertical table instead: nobody's specific storefront, just the trade.

   ⚠️ **FREE-LICENCE UNSPLASH IDS ONLY.** Every id below was harvested from Unsplash's
   own search and filtered to `images.unsplash.com/photo-…`; Unsplash+ results
   (`plus.unsplash.com/premium_photo-…`) are deliberately excluded because that tier
   carries a different licence. All 25 were verified to load at the exact 184x184 params
   used here — a 404 would silently fall back to the letter tile and look like the
   feature not working. */
const LSA_PHOTO: Record<string, string> = {
  "Plumbers": "1676210134188-4c05dd172f89",
  "Electricians": "1682345262055-8f95f3c513ea",
  "HVAC Companies": "1698479603408-1a66a6d9e80f",
  "Roofers": "1635424824849-1b09bdcc55b1",
  "Pest Control Companies": "1581578017093-cd30fce4eeb7",
  "Moving Companies": "1730154838368-c37b1fdebcf6",
  "Locksmiths": "1609770231080-e321deccc34c",
  "Garage Door Companies": "1647843097965-3686dadb7b84",
  "Tree Services": "1626828476637-5bd713ef9f22",
  "Window Treatment Companies": "1609534117141-ff9f20450902",
  "Security Companies": "1496368077930-c1e31b4e5b44",
  "Lawyers": "1758518731462-d091b0b4ed0d",
  "Insurance Agents": "1562564055-71e051d33c19",
  "Financial Advisors": "1628348068343-c6a848d2b6dd",
  "Real Estate Agents": "1770199105692-9e52ff137cad",
  "Auto Repair Shops": "1615906655593-ad0386982a0f",
  "Dentists": "1598256989800-fe5f95da9787",
  "Doctors": "1612349317150-e413f6a5b16d",
  "Home Care Providers": "1762955911431-4c44c7c3f408",
  "Pool Services": "1558617320-e695f0d420de",
  "Painters": "1717281234297-3def5ae3eee1",
  "Landscapers": "1558904541-efa843a96f01",
  "Flooring Companies": "1585128792020-803d29415281",
  "Cleaning Companies": "1740657254989-42fe9c3b8cce",
  /* Any vertical not in the table (`${seg} Providers`) gets a neutral open-for-business
     storefront rather than a trade it does not practise. */
  _default: "1575663620136-5ebbfcc2c597",
  /* ⚠️ A SEPARATE GENERIC FOR THE PROSPECT'S FALLBACK, and it exists to stop a COLLISION:
     with one generic, a prospect that has no real photo drew the same image as the rival
     directly beneath it — two identical photos side by side, which is worse than the letter
     tile it replaced. Service vans read as a local-services business without naming one. */
  _prospect: "1587813369290-091c9d432daf",
};

const unsplash = (id: string) => `https://images.unsplash.com/photo-${id}?w=184&h=184&fit=crop&q=80`;

/** The rival's photo for a vertical, at the tile's own 2x size. */
function stockPhoto(noun: string): string {
  return unsplash(LSA_PHOTO[noun] ?? LSA_PHOTO._default);
}

/** The stand-in when the prospect has no real photo — never the rival's image. */
function prospectStockPhoto(): string {
  return unsplash(LSA_PHOTO._prospect);
}

/* =============================================================================
   ⚠️⚠️ A LOGO IS NOT A PHOTO, AND THE og:image FALLBACK IS FULL OF THEM
   -----------------------------------------------------------------------------
   Measured across the library, of the 8 prospects whose site returns an og:image at all:
   Roto-Rooter's is its LOGO, Goosehead's a logo mark, National Van Lines' a logo, and
   Continuing Life's a "Great Place To Work" AWARD BADGE. `og:image` is authored for a WIDE
   link-preview card, so square-cropping one slices the wordmark in half — it reads as a
   broken tile, not as a business.

   ⚠️ **THIS IS NOT A HYPOTHETICAL PATH.** Places answering is what keeps those four off the
   screen today, and a server with no Places key configured is a SUPPORTED state — in which
   EVERY prospect falls through to og:image and four of eight show a cropped logo. So the
   fallback is guarded: an og:image that names itself a logo/badge/icon is skipped in favour
   of the vertical's stock photo, which always reads as a real trade photo.

   ⚠️ **AND THE GUARD IS DELIBERATELY NOT A PRECEDENCE CHANGE.** Preferring og:image whenever
   it does NOT look like a logo was tried on paper and rejected against the same measurement:
   for all seven prospects carrying both sources the Places photo is the better 92x92, and the
   two worst og images (Comfort Keepers' banner cropping to "…e Care …vates …man Spirit",
   Aptive's to "ptive") have innocent filenames — `og-img.jpg` and `image.jpg` — that no
   filename rule can catch. Places stays first. */
const LOGOISH = /logo|wordmark|brandmark|badge|favicon|sprite|seal|award|certified|gptw|great[-_]?place/i;

function looksLikeLogo(url: string): boolean {
  try { return LOGOISH.test(new URL(url).pathname); } catch { return LOGOISH.test(url); }
}

/* "6800" -> "6.8K", "4000" -> "4K", "845" -> "845" — the capture's own shape. */
function formatReviewCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}K`;
}

/* Both halves of the green status line are real, generic Google Guarantee-style
   verification badges — never a specific real accreditation body (the capture's
   own "BBB A+ rated" / "Bryant factory authorized" name real, specific programs,
   which would be inventing a credential for a fictional business). */
const LSA_STATUS: [string, string][] = [
  ["Open now", "Licensed & insured"],
  ["Open 24 hours", "Background checked"],
  ["Open now", "Locally owned & operated"],
  ["Open 24 hours", "Same-day service available"],
];

interface LsaProvider { name: string; rating: string; prospect: boolean }

/**
 * @param noun          the vertical, which picks the rival's stock photo
 * @param prospectPhoto the prospect's OWN photo once /api/place (or og:image) answers;
 *                      undefined until then, and the tile falls back rather than flashing
 */
function lsaRow(pv: LsaProvider, noun: string, prospectPhoto?: string) {
  const seed = pv.name;
  const reviews = 400 + (hash(`${seed}::lsa-reviews`) % 8800);
  const years = 5 + (hash(`${seed}::lsa-years`) % 38);
  const [openPhrase, badge] = LSA_STATUS[hash(`${seed}::lsa-status`) % LSA_STATUS.length];
  const hue = hash(`${seed}::lsa-hue`) % 360;
  return {
    ...pv, reviews: formatReviewCount(reviews), years, openPhrase, badge,
    /* The quote dialog's "Contacted by N people in the last week". The capture reads a
       round 100; hashed here so two businesses do not claim the same number. */
    contacted: 20 + (hash(`${seed}::lsa-contacted`) % 180),
    /* ⚠️ THE PROSPECT'S OWN PHOTO ALWAYS WINS; the vertical's stock photo is only the
       stand-in when there is no real one. Measured across the library: 12 of 15 prospects
       resolve a genuine Places photo, and the 3 that do not are Shady Blinds, Surfside
       Healthcare and Marriott — two of which are FICTIONAL businesses, i.e. exactly the
       "made up" case a stock photo was authorised for, and the third names reservation
       centres rather than a hotel (which is why it falls back on location too). A generic
       trade photo claims nothing about them; a letter tile beside a photograph just looks
       unfinished. */
    photo: pv.prospect ? (prospectPhoto ?? prospectStockPhoto()) : stockPhoto(noun),
    thumbBg: `hsl(${hue}, 32%, 24%)`,
  };
}

/**
 * The 92x92 photo tile.
 *
 * ⚠️ THE LETTER TILE IS NOW ONLY A FALLBACK, not the design: it renders when there is no
 * photo to show (no Places key configured, a prospect Places cannot match, or an image that
 * fails to load). A broken-image glyph in a demo is worse than a deliberate-looking tile.
 */
function LsaThumb({ src, name, bg }: { src?: string; name: string; bg: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="gs-lsa-thumb gs-lsa-thumb-alt" style={{ background: bg }} aria-hidden="true">
        {name[0]}
      </span>
    );
  }
  return (
    <span className="gs-lsa-thumb">
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    </span>
  );
}

/* One action: the measured 44px circle over a centred 14/18 label.
   ⚠️ INTERACTIVE ONLY WHEN IT REALLY GOES SOMEWHERE — "Get quote" opens the dialog and
   "Book online" is a tracked handoff to the advertiser's own booking page. "Get phone number"
   has no captured destination and stays an inert span, the same rule the inert place actions
   on this page already follow: a control that looks clickable and does nothing is worse than
   one that plainly does not.
   ⚠️ AND ONLY ON THE PROSPECT'S ROW. The rival is an invented business with an invented
   domain, so linking its booking button would open a 404 — the same reason its ad headline is
   inert while the prospect's is a real link. */
function LsaAct({ d, size, label, onClick, href, onContextMenu, title }: {
  d: string; size: number; label: string; onClick?: () => void; href?: string;
  /* ⚠️ BOTH OPT-IN AND DEFAULTED ABSENT, so every other action renders exactly as before —
     only the prospect's "Book online" passes them. See `BookingLinkMenu`. */
  onContextMenu?: (e: React.MouseEvent) => void; title?: string;
}) {
  const inner = (
    <>
      <span className="gs-lsa-act-ic"><Icon d={d} size={size} fill /></span>
      <span className="gs-lsa-act-label">{label}</span>
    </>
  );
  if (href) {
    return (
      <a className="gs-lsa-act gs-lsa-act-on" href={href} target="_blank" rel="noopener noreferrer"
        onContextMenu={onContextMenu} title={title}>
        {inner}
      </a>
    );
  }
  return onClick
    ? <button className="gs-lsa-act gs-lsa-act-on" onClick={onClick}>{inner}</button>
    : <span className="gs-lsa-act">{inner}</span>;
}

function LsaRow({ row, noun, city, onQuote, bookHref, onBookMenu }: {
  row: ReturnType<typeof lsaRow>; noun: string; city: string; onQuote?: () => void;
  /* The advertiser's own booking page, tracked — see bookingHandoffUrl. */
  bookHref?: string;
  /* Right-click on the prospect's "Book online" — see BookingLinkMenu. */
  onBookMenu?: (e: React.MouseEvent) => void;
}) {
  /* ⚠️ THE ACTION SET VARIES PER ADVERTISER IN THE CAPTURE — its first row carries two
     buttons and its second three, which is what gives the unit its real texture. The
     prospect gets the full set (Get quote is the one this demo is about); the rival gets
     the two-button version, so the pair reproduces that shape rather than two identical rows. */
  return (
    <div className="gs-lsa-row">
      <LsaThumb src={row.photo} name={row.name} bg={row.thumbBg} />
      <div className="gs-lsa-main">
        <span className="gs-lsa-name">{row.name}</span>
        {/* ⚠️ The rating, the count and the category are ONE line, all #bfbfbf; only the
            stars carry colour. `--fill` drives the partial star, the way the real
            gradient bar does — see the .gs-lsa-stars rule. */}
        <span className="gs-lsa-line">
          {row.rating}
          <span className="gs-lsa-stars" aria-hidden="true"
            style={{ "--fill": `${(parseFloat(row.rating) / 5) * 100}%` } as React.CSSProperties}>
            ★★★★★
          </span>
          ({row.reviews}) <span className="gs-lsa-sep">·</span> {noun}
        </span>
        <span className="gs-lsa-line">
          {row.years}+ years in business <span className="gs-lsa-sep">·</span> Serves {city}
        </span>
        {/* Leading phrase green, the rest grey — measured, not the all-green the
            screenshot reads as. */}
        <span className="gs-lsa-line">
          <b>{row.openPhrase}</b> <span className="gs-lsa-sep">·</span> {row.badge}
        </span>
      </div>
      <div className="gs-lsa-acts">
        {row.prospect && <LsaAct d={LSA_P.quote} size={18} label="Get quote" onClick={onQuote} />}
        <LsaAct d={LSA_P.calendar} size={18} label="Book online"
          href={row.prospect ? bookHref : undefined}
          onContextMenu={row.prospect ? onBookMenu : undefined}
          /* ⚠️ THE ONLY THING ADVERTISING THE RIGHT-CLICK, and it is a native tooltip so the
             page at rest is still byte-for-byte the capture. Precedent on this very screen:
             "Use precise location" carries one for the same reason. */
          title={row.prospect ? "Right-click to change where this link goes" : undefined} />
        <LsaAct d={LSA_P.phone} size={20} label="Get phone number" />
      </div>
    </div>
  );
}

/* =============================================================================
   "Get quote" — the Send request dialog (9/12/2026)
   -----------------------------------------------------------------------------
   Asked for directly: "Build what happens when someone clicks the 'Get Quote' button."

   MEASURED off a second SingleFile capture taken with the dialog OPEN
   (`reference/google-search/lsa-quote-v1.html`), the same method the unit itself used.

   ⚠️⚠️ **THE DIALOG'S CONTENT IS INSIDE AN IFRAME, AND ITS SANDBOX OMITS
   `allow-same-origin`** — so `contentDocument` is null and nothing in it can be measured
   from the parent. SingleFile stores the frame in a **`srcdoc` attribute** (1,002,710
   chars here), so the way in is to EXTRACT that to its own file and serve it, exactly as
   CLAUDE.md already records for the ThoughtSpot frame. Stripping the sandbox to get in is
   both the wrong instinct and blocked. ⚠️ And measure the frame at **700x748**, the size
   the iframe actually gets in the parent — its layout is responsive, so measuring it at
   the browser's own width would have recorded a column width the dialog never renders.

   Measured values, all of them:
     scrim      rgba(0,0,0,.6), fixed, z 9997
     dialog     700 wide x 752, CENTRED both axes, radius 8, overflow hidden,
                shadow `0 5px 26px rgba(0,0,0,.5), 0 20px 28px rgba(0,0,0,.5)`
     surface    #1f1f1f — the FRAME's own body colour, NOT the page's #22242a
     header     64 tall; back button 48x48 at x=20,y=8 (icon 24); title x=88,
                400 18/24 Google Sans #dadce0
     body       content inset 24 each side (652 wide), first block 8px under the header
     business   photo 52x65 radius 8 overflow hidden, 12px gap, text column at x=88;
                name 400 18/24 Google Sans #e8e8e8; rating/meta 400 14/18 Roboto #e8e8e8;
                the two meta icons 16px #8ab4f8
     labels     400 16px Roboto #e8e8e8
     field      MDC notched outline: 1px #bdc1c6, radius 4; text 400 16/24 Roboto #e8eaed
     message    outlined box 636x128, textarea padded 0 16
     helper     400 12/14 Roboto #9aa0a6, with the counter right-aligned
     name/phone 313 wide (half column), 56 tall
     radio      40x40 target, 20x20 ring 2px #8ab4f8, 10x10 dot; label 400 14/20 #bfbfbf
     legal      400 12/16 Roboto #bfbfbf, links #99c3ff
     footer     52 tall; two buttons 321x36, 10px apart, spanning the 652
     No thanks  bg #1f1f1f, 1px #3c4043, radius 36, pad 0 23, 14/18 Google Sans #8ab4f8
     Send       bg #8ab4f8, no border, radius 36, pad 0 24, 14/18 Google Sans #1f1f1f

   ⚠️ **THE CAPTURE'S SELECT IS IN ITS FOCUSED STATE** (blue floating label, blue outline)
   because it had focus when the page was saved. A freshly opened dialog has nothing
   focused, so the resting grey is what is built here and the blue is the `:focus` rule.

   ⚠️ **WHAT HAPPENS AFTER "Send" IS NOT IN THE CAPTURE**, so the confirmation is AUTHORED,
   not measured — and it is deliberately built from the dialog's own already-measured parts
   (same header, same business block, same button) rather than inventing new Google chrome.
   Capture the real one and this should be replaced.
   ============================================================================= */

interface QuoteTarget {
  name: string; rating: string; reviews: string; photo?: string; thumbBg: string;
  /** "Contacted by N people in the last week" — hashed per business, like every other figure here. */
  contacted: number;
}

function QuoteDialog({ target, services, onClose, onSend }: {
  target: QuoteTarget; services: string[]; onClose: () => void;
  onSend: (q: { name: string; message: string; service: string; how: "sms" | "email"; contact: string }) => void;
}) {
  const [message, setMessage] = useState("");
  const [service, setService] = useState("");
  const [name, setName] = useState("");
  const [how, setHow] = useState<"sms" | "email">("sms");
  const [contact, setContact] = useState("");
  const [sent, setSent] = useState(false);
  const firstRef = useRef<HTMLTextAreaElement | null>(null);

  /* Escape closes, and the message field takes focus on open — it is the one field the
     dialog exists to collect, and the Send button is disabled until it has content. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => firstRef.current?.focus(), 60);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(t); };
  }, [onClose]);

  /* Measured: Send is the filled button and the form is not submittable empty. The real
     dialog shows "Type a message to continue" as the message field's helper, which is the
     same rule stated in words. */
  const canSend = message.trim().length > 0 && name.trim().length > 0 && contact.trim().length > 0;

  const biz = (
    <div className="gs-q-biz">
      <span className="gs-q-thumb" style={{ background: target.thumbBg }}>
        {target.photo
          ? <img src={target.photo} alt="" />
          : <span className="gs-q-thumb-alt">{target.name[0]}</span>}
      </span>
      <div className="gs-q-biz-main">
        <div className="gs-q-biz-name">{target.name}</div>
        <div className="gs-q-biz-row">
          {target.rating}
          <span className="gs-lsa-stars" aria-hidden="true"
            style={{ "--fill": `${(parseFloat(target.rating) / 5) * 100}%` } as React.CSSProperties}>
            ★★★★★
          </span>
          ({target.reviews})
        </div>
        <div className="gs-q-biz-row gs-q-biz-meta">
          <Icon d={LSA_P.quote} size={16} fill />Typically replies in a few min
        </div>
        <div className="gs-q-biz-row gs-q-biz-meta">
          <Icon d={LSA_P.people} size={16} fill />Contacted by {target.contacted} people in the last week
        </div>
      </div>
    </div>
  );

  return (
    <div className="gs-q-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="gs-q" role="dialog" aria-modal="true"
        aria-label={`Send request to ${target.name}`}>
        <div className="gs-q-head">
          <button className="gs-q-back" onClick={onClose} aria-label="Back">
            <Icon d={LSA_P.arrowBack} size={24} fill />
          </button>
          <h2 className="gs-q-title">
            {sent ? "Request sent" : `Send request to ${target.name}`}
          </h2>
        </div>

        {sent ? (
          /* ⚠️ AUTHORED, NOT MEASURED — see the note above. Built from the dialog's own
             parts so it cannot drift from the form it replaces. */
          <>
            <div className="gs-q-body">
              {biz}
              <div className="gs-q-sent">
                <span className="gs-q-sent-ic"><Icon d={LSA_P.check} size={24} fill /></span>
                <p className="gs-q-sent-h">Your request was sent</p>
                <p className="gs-q-sent-p">
                  {target.name} typically replies in a few minutes. You will hear back
                  {how === "sms" ? " by text or phone call" : " by email"} at {contact}.
                </p>
              </div>
            </div>
            <div className="gs-q-foot">
              <button className="gs-q-btn gs-q-btn-fill gs-q-btn-wide" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <div className="gs-q-body">
              {biz}

              <div className="gs-q-sec">
                <div className="gs-q-label">Your message</div>
                <div className="gs-q-field gs-q-field-area">
                  <textarea ref={firstRef} maxLength={600} value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Give details like what you need done and how soon you need it" />
                </div>
                <div className="gs-q-help">
                  <span>{message.trim() ? " " : "Type a message to continue"}</span>
                  <span>{message.length}/600</span>
                </div>
              </div>

              <div className="gs-q-sec">
                <div className="gs-q-label">Service (optional)</div>
                <div className="gs-q-field gs-q-select">
                  <select value={service} onChange={(e) => setService(e.target.value)}
                    aria-label="Choose the service you need">
                    <option value="">Choose the service you need</option>
                    {services.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span className="gs-q-chev"><Icon d={LSA_P.expandMore} size={24} fill /></span>
                </div>
              </div>

              <div className="gs-q-sec">
                <div className="gs-q-label">Name</div>
                <div className="gs-q-field gs-q-half">
                  <input maxLength={50} value={name} placeholder="Name"
                    onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="gs-q-help gs-q-half">
                  <span>{name.trim() ? " " : "Enter your name"}</span>
                  <span>{name.length}/50</span>
                </div>
              </div>

              <div className="gs-q-sec">
                <div className="gs-q-label">How would you like to hear back?</div>
                {([["sms", "SMS or phone call"], ["email", "Email"]] as const).map(([v, label]) => (
                  <label className="gs-q-radio" key={v}>
                    <input type="radio" name="gs-q-how" checked={how === v}
                      onChange={() => { setHow(v); setContact(""); }} />
                    <span className="gs-q-radio-ring" aria-hidden="true" />
                    {label}
                  </label>
                ))}
                <div className="gs-q-field gs-q-half">
                  <input value={contact} onChange={(e) => setContact(e.target.value)}
                    placeholder={how === "sms" ? "Phone Number" : "Email"}
                    inputMode={how === "sms" ? "tel" : "email"} />
                </div>
                <div className="gs-q-help gs-q-half">
                  <span>{contact.trim() ? " "
                    : how === "sms" ? "Enter a valid phone number" : "Enter a valid email"}</span>
                </div>
              </div>

              {/* Verbatim from the capture — it is Google's own disclosure, not copy we write. */}
              <p className="gs-q-legal">
                Google will pass the information you’ve submitted, including contact information
                provided above to the business you have selected, subject to Google’s{" "}
                <a>privacy policy</a> and <a>data use terms</a>. You’ll receive recurring messages.
                Text STOP to cancel. Message &amp; data rates may apply. This site is protected by
                reCAPTCHA and the Google <a>Privacy Policy</a> and <a>Terms of Service</a> apply.
              </p>
            </div>

            <div className="gs-q-foot">
              <button className="gs-q-btn" onClick={onClose}>No thanks</button>
              <button className="gs-q-btn gs-q-btn-fill" disabled={!canSend}
                onClick={() => {
                  /* ⚠️ RECORDED BEFORE THE CONFIRMATION IS SHOWN. The two things this creates
                     — a Salesforce lead and an SMS workflow — are what the beat is for, and
                     the SE often closes this tab the moment they read "Request sent". */
                  onSend({ name: name.trim(), message: message.trim(), service, how, contact: contact.trim() });
                  setSent(true);
                }}>Send</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The whole unit: header, the rows, and the "Show more" pill over its rule. */
/* =============================================================================
   Right-click "Book online" -> point it anywhere (9/12/2026)
   -----------------------------------------------------------------------------
   Asked for directly: *"when i right click on the book online it gives the user the option to
   enter the URL where they want the button to take them to when its click, so there will def
   be a default place it goes, but the user can also change it."*

   ⚠️⚠️ **A RIGHT-CLICK IS THE WHOLE REASON THIS CAN EXIST ON A REPLICA SCREEN.** Every pixel
   here is measured against a capture of the real Google unit, and this file's own rule is that
   an affordance of OURS must not change what a prospect sees. At rest this adds nothing — no
   control, no marker, not even when an override is in force — so the unit still diffs clean
   against the capture. Same argument as the hover-revealed Ask AI sparkle in the top bar.

   ⚠️ **THE INPUT OPENS PRE-FILLED WITH WHERE THE BUTTON GOES RIGHT NOW**, so the common edit
   (take the default and change one path segment) is a tweak rather than a retype, and the SE
   can always read the current destination even when they came only to check it.

   ⚠️ **THE DEFAULT IS SHOWN UNDERNEATH WHENEVER AN OVERRIDE IS IN FORCE.** Nothing else on
   screen says the link has been re-pointed, so this line and the Reset beside it are the only
   way back — hiding what was replaced is what would make the override a trap a week later.
   ============================================================================= */
function BookingLinkMenu({ at, current, fallback, onSet, onClear, onClose, thankYou, onSetThankYou }: {
  at: { x: number; y: number };
  current: string;
  /** The tracked default, shown only when the SE has replaced it. */
  fallback: string | null;
  onSet: (raw: string) => string | null;
  onClear: () => void;
  onClose: () => void;
  /* ⚠⚠ **WHERE THE REPLICA GOES AFTER A SUBMIT — the SE's answer for a form whose real
     confirmation a replica cannot reproduce.** Where the page already SHIPS its confirmation
     hidden in the markup (Aptive does) the replica reveals that on its own and this stays
     empty; it is for the other two cases, measured on the captures we have: a HubSpot or
     Marketo form whose message is delivered by JS (Greenix), and a form that redirects to a
     separate thank-you page. Neither is discoverable from the capture, and inventing a
     company's confirmation copy is what this repo refuses everywhere — so the SE, who knows
     the real page, supplies it. */
  thankYou: string | null;
  onSetThankYou: (raw: string) => string | null;
}) {
  const [value, setValue] = useState(current);
  const [err, setErr] = useState("");
  /* Replicate ENDS here now: it saves the link and reports "Complete" rather than
     navigating, so the panel needs a third state beside idle and fetching. */
  const [done, setDone] = useState(false);
  const [thanks, setThanks] = useState(thankYou ?? "");
  const [thanksMsg, setThanksMsg] = useState("");
  /* Replicate does the whole capture HERE, so the wait happens where the SE just clicked and
     the page is on disk by the time anyone opens it. It used to navigate to the replica at the
     end; now it saves the link instead (see the success branch below), so this panel is the
     only place the progress is ever reported. */
  const [fetching, setFetching] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* ⚠️ SELECT ALL, THEN SCROLL BACK TO THE START — and the scroll has to be set explicitly.
     A plain `.select()` leaves the caret at the END and the field follows it, so a tracked
     default (which is mostly query string) opened showing `…&rwg_token=AE37R_…` with the
     domain — the one part the SE is looking for — out of view. Selecting BACKWARD is the
     documented way to put the focus at 0, and measured here it is not enough on its own:
     direction came back "backward" with `scrollLeft` still at 16. So the assignment is what
     actually does the work; the direction is kept because it is the honest intent. */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, el.value.length, "backward");
    el.scrollLeft = 0;
  }, []);

  /* ⚠️ POINTERDOWN IN THE CAPTURE PHASE. On bubble, the next right-click on the same button
     closes the panel here and the button's own handler immediately reopens it, so it can never
     be dismissed by the control that opened it — the identical trap already recorded for the
     Signal sidebar flyout and the Create-Workflow combobox. */
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [onClose]);

  const replicate = async () => {
    const target = value.trim();
    if (!target || fetching) return;
    setErr("");
    setDone(false);
    setFetching(true);
    const t0 = Date.now();
    /* ⚠️ A LIVE COUNTER, NOT A SPINNER. A capture already on disk answers in well under a
       second; a fresh one is a real browser loading the page and downloading its assets, which
       is 30-90 seconds. A static spinner leaves the SE unable to tell "working" from "hung". */
    const tick = setInterval(() => setElapsed(Date.now() - t0), 50);
    try {
      /* ⚠️⚠️ **ONE CALL DOES BOTH JOBS.** The server checks its persistent store first — if
         this domain was captured before (even in a previous session, even after a restart) it
         answers immediately; only a domain nobody has captured triggers an actual browser load.
         That single round trip is the whole feature: no separate "is this cached" check on our
         side to keep in sync with the server's. */
      const r = await fetch("/api/replicate/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const j = await r.json().catch(() => ({}));
      clearInterval(tick);
      setFetching(false);
      /* ⚠️ A FAILURE STAYS HERE rather than navigating to a broken page. The SE can fix the URL
         in the box they are already looking at. */
      if (!j?.ok) { setErr(j?.error || "Could not replicate that page."); return; }
      /* ⚠️⚠️ **IT SAVES THE LINK INSTEAD OF NAVIGATING — asked for directly:** "once its
         done, just show complete, but dont go to it, auto save the page, so when the user
         click book online it goes to the replicated page." Opening the replica here threw the
         SE off the search screen they were demoing from, and left them to come back and set
         the link by hand; the capture is on disk either way, so the useful end of the action
         is the DESTINATION being set, not a page they have already decided to show later.
         ⚠️ **THROUGH `onSet`, NOT A SECOND WRITER.** It is the same store the typed URL uses,
         so this inherits the validation, the per-prospect key, the persistence and the Reset
         that puts the tracked default back — and the "Default: …" line appears underneath the
         moment it lands, which is what tells the SE the link was actually re-pointed. */
      const replica = `/replica?url=${encodeURIComponent(target)}`;
      const msg = onSet(replica);
      if (msg) { setErr(msg); return; }
      /* ⚠⚠ **THE BOX HAS TO BECOME THE REPLICA TOO, AND LEAVING IT ALONE WAS A REAL BUG.**
         Reported as "it still takes me to the real website": the SE replicated, the link WAS
         re-pointed — and then clicked **Save**, which stores whatever is in the input, i.e. the
         original site URL, silently clobbering the replica that had just landed. That click is
         the natural next move now that the panel STAYS OPEN instead of navigating away, so the
         old flow never exposed it. It also broke this panel's own rule that the field shows
         where the button goes RIGHT NOW. With the box holding the replica, Save re-saves the
         same thing, reopening shows it, and there is no way to overwrite it by accident.
         ⚠ `setValue` fires no `onChange`, so the Complete state deliberately survives this —
         only a human editing the field clears it. */
      setValue(replica);
      setDone(true);
    } catch {
      clearInterval(tick);
      setFetching(false);
      setErr("Could not reach that page.");
    }
  };

  const save = () => {
    const msg = onSet(value);
    if (msg) { setErr(msg); return; }
    onClose();
  };

  /* Clamped so a right-click near the right or bottom edge does not open a panel half
     off-screen. Fixed positioning, anchored to the cursor, like any context menu. */
  const W = 380;
  const left = Math.min(at.x, Math.max(8, window.innerWidth - W - 8));
  const top = Math.min(at.y, Math.max(8, window.innerHeight - 168));

  /* ⚠️⚠️ **A COMPLETION PERCENTAGE, ESTIMATED THE SAME WAY THE LAUNCH SCREEN'S BUILD BAR
     ALREADY IS — asked for directly, in place of the raw elapsed-seconds counter.** There is
     no byte count to measure a real percentage against (a capture is "the browser is somewhere
     in a 7-90 second render", not a download with a Content-Length), so a real percentage
     would have to be invented regardless of the label. `Launch.tsx` solved exactly this for
     generation progress: ease toward a ceiling asymptotically so the bar always creeps forward
     and never looks frozen, and never claim 100 before the real response arrives. Same
     `1 - e^(-t/ramp)` curve, capped at 99 while still fetching. `RAMP_MS` is tuned to this
     feature's own measured range rather than copied — a cached hit answers in well under a
     second (the bar barely moves before the panel closes), a fresh render is 7-90s, so 25s
     gets the bar into the 80s by the time a slow capture is still only half done, instead of
     pinning near 0 for the whole wait or maxing out long before it finishes. */
  const RAMP_MS = 25_000;
  const pct = fetching ? Math.min(99, Math.round((1 - Math.exp(-elapsed / RAMP_MS)) * 100)) : 0;

  return (
    <div ref={panelRef} className="gs-lnk" style={{ left, top, width: W }}
      role="dialog" aria-label="Book online link">
      <div className="gs-lnk-title">Book online opens</div>
      <input
        ref={inputRef}
        className="gs-lnk-input"
        value={value}
        spellCheck={false}
        aria-label="Destination URL"
        placeholder="https://example.com/book"
        onChange={(e) => { setValue(e.target.value); setErr(""); setDone(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") onClose();
        }}
      />
      {/* ⚠️ SHOWN, NOT SWALLOWED — a rejected URL has to say which rule it broke, or the Save
          that appears to do nothing reads as the feature being broken. */}
      {err && <div className="gs-lnk-err">{err}</div>}
      {fallback && !err && (
        <div className="gs-lnk-note">Default: <span>{fallback}</span></div>
      )}
      {/* ⚠️⚠️ **ITS OWN ROW, FULL WIDTH — NOT SQUEEZED INTO THE BUTTON ROW.** It used to sit
          beside Replicate inside `.gs-lnk-acts`, and the panel is 380px wide: Replicate
          ("Replicating…") plus a 96px bar plus its label plus Cancel plus Save added up to
          more than the 356px of padded content, with no wrap set — so the row simply ran past
          the panel's own rounded border. Reported directly: "the replicate button goes outside
          the box." Giving the bar a full-width row of its own, above the buttons, means the
          button row's width never depends on whether a fetch is in flight. */}
      {/* ⚠️ **THE BAR FINISHES AT 100 RATHER THAN DISAPPEARING.** A progress bar that vanishes
          at the end is indistinguishable from one that was cancelled, and this flow no longer
          navigates away to prove it worked — so the same row stays put, fills, and says so. */}
      {(fetching || done) && (
        <div className="gs-lnk-prog" aria-live="polite">
          <span className="gs-lnk-prog-bar">
            <span className="gs-lnk-prog-fill" style={{ width: done ? "100%" : `${pct}%` }} />
          </span>
          {done
            ? <span className="gs-lnk-prog-pct gs-lnk-prog-done">Complete</span>
            : <span className="gs-lnk-prog-pct">{pct}%</span>}
        </div>
      )}
      {/* ⚠️ **A SECOND ROW, NOT A SECOND MENU.** Both fields describe the same page, and the SE
          is already here having just replicated it — a separate surface for "what happens after
          submit" is one more place to forget. Saved on blur so a half-typed URL is never stored;
          the message says which outcome it got, because a silent save is indistinguishable from
          a refused one on a demo the SE cannot edit. */}
      <div className="gs-lnk-after">
        <label className="gs-lnk-after-lbl" htmlFor="gs-lnk-thanks">After submit, show</label>
        <input
          id="gs-lnk-thanks"
          className="gs-lnk-input"
          value={thanks}
          spellCheck={false}
          placeholder="Optional — the page's own thank-you URL"
          onChange={(e) => { setThanks(e.target.value); setThanksMsg(""); }}
          onBlur={() => {
            const v = thanks.trim();
            if (!v || v === (thankYou ?? "")) return;
            const msg = onSetThankYou(v);
            setThanksMsg(msg ?? "Saved");
          }}
        />
        {thanksMsg && <div className={thanksMsg === "Saved" ? "gs-lnk-note" : "gs-lnk-err"}>{thanksMsg}</div>}
      </div>
      <div className="gs-lnk-acts">
        {/* ⚠️ OFFERED ONLY WHEN A CAPTURE EXISTS FOR THIS PROSPECT. A Replicate button that
            opened a "nobody has captured this yet" page would be a dead control, which this
            repo forbids — the route still fails closed if somebody types the URL. */}
        {/* ⚠️ REPLICATE USES THE URL IN THE BOX, not a pre-registered page. That was asked for
            directly — "i paste a URL and when user clicks Replicate, it should replicate the
            page" — and the earlier version silently opened a capture regardless of what was
            typed, which is the worst kind of wrong: it looks like it worked. `/replica` decides
            whether to serve a browser-made capture (better, where we have one for that host) or
            to fetch the page live, and says which on screen. */}
        <button className={"gs-lnk-btn gs-lnk-rep" + (done ? " gs-lnk-done" : "")}
          title={done
            ? "Book online now opens this replica"
            : "Build a working copy of this page, with its form wired into the demo"}
          disabled={!value.trim() || fetching || done}
          onClick={() => void replicate()}>
          {fetching ? "Replicating…" : done ? "Complete" : "Replicate"}
        </button>
        {/* Only offered once there is something to undo, so an untouched menu is two buttons. */}
        {fallback && (
          <button className="gs-lnk-btn" onClick={() => { onClear(); onClose(); }}>Reset</button>
        )}
        <button className="gs-lnk-btn" onClick={onClose}>Cancel</button>
        <button className="gs-lnk-btn gs-lnk-save" onClick={save} disabled={!value.trim()}>Save</button>
      </div>
    </div>
  );
}

function LsaUnit({ rows, noun, city, services, onSend, bookHref, bookDefault, book }: {
  rows: ReturnType<typeof lsaRow>[]; noun: string; city: string; services: string[];
  onSend: (q: { name: string; message: string; service: string; how: "sms" | "email"; contact: string }) => void;
  bookHref: string;
  /** The tracked default, for the menu's "Default:" line. */
  bookDefault: string;
  book: BookingOverride;
}) {
  const [quoteFor, setQuoteFor] = useState<ReturnType<typeof lsaRow> | null>(null);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <div className="gs-lsa">
      <div className="gs-lsa-head">
        <div className="gs-lsa-head-row">
          {/* ⚠️ THE HEADING IS ONE LINE, as measured (the header is a fixed 36 + 8). Our
              provider nouns run longer than the capture's "Plumbers" — "Window Treatment
              Companies | Santa Barbara" wrapped to two lines and grew the header — so the
              TEXT ellipsises and the kebab stays put, the same nowrap treatment the row's
              business name already carries. */}
          <h3 className="gs-lsa-title">
            <span className="gs-lsa-title-text">Sponsored {noun} | {city}</span>
            <span className="gs-lsa-kebab"><Icon d={LSA_P.moreVert} size={18} fill /></span>
          </h3>
          <button className="gs-lsa-cta">
            <Icon d={LSA_P.quote} size={18} fill />Get competitive quotes
          </button>
        </div>
      </div>
      <div className="gs-lsa-rows">
        {rows.map((r) => (
          <LsaRow key={r.name} row={r} noun={noun} city={city} bookHref={bookHref}
            onQuote={r.prospect ? () => setQuoteFor(r) : undefined}
            onBookMenu={(e) => {
              e.preventDefault();          // our menu instead of the browser's
              setMenuAt({ x: e.clientX, y: e.clientY });
            }} />
        ))}
      </div>
      {/* The rule runs the full column and the pill sits ON it, covering the middle. */}
      <div className="gs-lsa-more">
        <span className="gs-lsa-more-pill">
          Show more<Icon d={LSA_P.expandMore} size={20} fill />
        </span>
      </div>

      {menuAt && (
        <BookingLinkMenu at={menuAt} current={bookHref}
          thankYou={book.thankYou} onSetThankYou={book.setThankYou}
          fallback={book.url ? bookDefault : null}
          onSet={book.set} onClear={book.clear} onClose={() => setMenuAt(null)} />
      )}

      {quoteFor && (
        <QuoteDialog services={services} onClose={() => setQuoteFor(null)} onSend={onSend}
          target={{
            name: quoteFor.name, rating: quoteFor.rating, reviews: quoteFor.reviews,
            photo: quoteFor.photo, thumbBg: quoteFor.thumbBg, contacted: quoteFor.contacted,
          }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- the screen */

/* =============================================================================
   The "Use precise location" pill, made real (9/8/2026)
   -----------------------------------------------------------------------------
   Google's own pill is inert chrome in the capture; asked for directly, it now takes a ZIP
   and re-points the whole screen — the ads, the local pack, the map and the footer, since
   every one of those reads the same resolved place.

   ⚠️ **IT LOOKS EXACTLY AS CAPTURED UNTIL IT IS CLICKED.** The resting state is the same
   pill with the same target glyph and the same words, so a screenshot of this screen is
   unchanged; the input only exists while it is open. Making it visibly a form would be
   adding a control Google does not show.
   ============================================================================= */
function LocationPill({ loc }: { loc: ReturnType<typeof useLocationOverride> }) {
  const [open, setOpen] = useState(false);
  const [zip, setZip] = useState("");
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const submit = async () => {
    setErr("");
    const msg = await loc.apply(zip);
    if (msg) { setErr(msg); return; }
    setZip(""); setOpen(false);
  };

  if (!open) {
    return (
      <>
        <button className="gs-loc-pill" onClick={() => { setErr(""); setOpen(true); }}
          title="Set the search location by ZIP code">
          <Icon d={P.target} size={16} />Use precise location
        </button>
        {/* Only shown once a ZIP is in force, so the default screen is untouched. */}
        {loc.place && (
          <button className="gs-loc-reset" onClick={loc.clear}
            title="Back to this business's own location">Reset</button>
        )}
      </>
    );
  }
  return (
    <span className="gs-loc-form">
      <Icon d={P.target} size={16} />
      <input
        ref={inputRef}
        className="gs-loc-input"
        value={zip}
        inputMode="numeric"
        maxLength={5}
        placeholder="ZIP code"
        aria-label="ZIP code"
        /* Digits only, so the field cannot hold something the endpoint will reject. */
        onChange={(e) => { setZip(e.target.value.replace(/\D/g, "").slice(0, 5)); setErr(""); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
          if (e.key === "Escape") { setOpen(false); setErr(""); setZip(""); }
        }}
      />
      <button className="gs-loc-go" onClick={() => void submit()} disabled={loc.busy || zip.length !== 5}>
        {loc.busy ? "…" : "Set"}
      </button>
      {/* ⚠️ THE FAILURE IS SHOWN, NOT SWALLOWED. An unknown ZIP resolves to nothing rather
          than to an approximation, so the SE has to be told which one it was. */}
      {err && <span className="gs-loc-err">{err}</span>}
    </span>
  );
}

export function GoogleSearch() {
  const { profile } = useProfile();
  /* ⚠️ THE SE'S OWN ZIP WINS OVER THE PROSPECT'S OWN LOCATION, and nothing else does.
     `derive` takes it as an argument rather than reading the store itself, so the module
     stays a pure function of (profile, choice) and the ChatGPT screen resolves the SAME way
     from the SAME choice — the whole reason prospectPlace is shared. */
  const loc = useLocationOverride(profile.id);
  const d = derive(profile, loc.place ?? undefined);
  const [query, setQuery] = useState(d.query);

  /* ⚠️ THE SE'S OWN URL WINS OVER THE BOOKING-PATH TABLE, and the default is still computed
     so the menu can show what was replaced and Reset can restore it. Same shape as `loc`
     above: the hook holds the choice, the screen decides what to do with it. */
  const book = useBookingOverride(profile.id);
  const bookDefault = bookingHandoffUrl(d.domain, d.adCampaign, profile.id);

  /* ⚠️ THE PROSPECT'S REAL PHOTO FOR THE LSA ROW, on the SAME chain ChatGptAd uses and for
     its stated reason: Places FIRST (a real listing photo of the actual business, and
     `engine/places.ts` rejects a name mismatch so it cannot be somebody else's storefront),
     then og:image, which is unreliable precisely for the enterprise prospects that matter
     because their sites 403 a server-side fetch. Null all the way through is fine — the
     tile falls back to its initial square rather than showing a broken image. */
  const [lsaPhoto, setLsaPhoto] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setLsaPhoto(null);                      // a prospect switch must not keep the old photo
    (async () => {
      try {
        const q = new URLSearchParams({ name: profile.customerName, city: d.shortCity });
        const j = await (await fetch(`/api/place?${q}`)).json();
        if (live && j.place?.photoUrl) { setLsaPhoto(j.place.photoUrl); return; }
      } catch { /* fall through to og:image */ }
      if (!d.domain) return;
      try {
        const j = await (await fetch(`/api/og-image?domain=${encodeURIComponent(d.domain)}`)).json();
        /* A logo or an award badge cropped into a 92px photo slot reads as broken, so it is
           skipped and the stock trade photo stands in instead — see looksLikeLogo above. */
        if (live && j.url && !looksLikeLogo(j.url)) setLsaPhoto(j.url);
      } catch { /* falls back to the stock photo, then the initial tile */ }
    })();
    return () => { live = false; };
  }, [profile.customerName, d.shortCity, d.domain]);

  /* ⚠️ THE CLICK NAMES THE CAMPAIGN THAT ACTUALLY MATCHED, not simply row 0. `adCreative`
     pairs the search term to a campaign by word overlap and the headline leads with that
     campaign's creative, so the utm has to be the same campaign or the ad's copy and its
     tracking disagree about which one served it. */
  const href = paidClickUrl(d.domain, d.adCampaign, query, profile.id);

  /* The number in the ad is the whole reason this screen exists: it is the
     Invoca tracking number that gets swapped in per click, and the bridge from
     this page to every call report in the platform. 555 is the reserved
     fictional exchange, so it cannot ring a real business, while the area code
     is the prospect's own so it still reads local. */
  const area = /\((\d{3})\)/.exec(d.phone)?.[1] ?? "805";
  const phone = `(${area}) 555-${String(1000 + (hash(profile.id) % 9000))}`;

  /* Headlines wrap past roughly 62 characters at 22px in a 652px column, and the
     capture's sit on one line. A long product name ("Smart Home Security
     Systems") blows the budget, so the city moves into the second clause rather
     than being dropped: the ad still says where it is. */
  /* ⚠️ THE HEADLINE IS THE PROSPECT'S OWN CAMPAIGN CREATIVE, built in `prospectPlace` beside
     the keyword it answers, so the ad's copy, its `utm_campaign` and the search term all come
     from one place and tell one story. It replaced
     `${hero} in ${city} | ${bookingTerm}s This Week`, which was the same sentence for every
     prospect with three words swapped. See adCreative() for what each slot is. */
  const adTitle = d.adHeadline;

  /* The chip and the footer want "City, ST", the format the capture shows.
     `d.city` is the prospect's STATED area, which can be a region ("Orlando and
     Central Florida") and reads wrong in a location chip, so rebuild it from
     the short city plus the screenpop state. */
  /* Only append the state when the derived label does NOT already carry one.
     Testing shortCity (which is split ON the comma, so it never has one) meant
     the state was appended even to a label that already ended in a state, and
     Reyes Law rendered "Santa Barbara, TX": the city came from prospectPlace's
     FALLBACK location while the state came from the live screenpop. That is the
     same label/coordinate mismatch prospectPlace itself warns about, so the two
     halves have to come from one source or the other, never both. */
  /* ⚠️⚠️ THIS READ `voiceScreenpop.state` — THE CALLER'S STATE — UNTIL 9/8/2026, which is the
     "Santa Barbara, TX" bug prospectPlace warns about, still live in this screen. `derive`
     now returns the state that belongs to the city it resolved, so there is nothing to
     recombine and the two halves cannot disagree. */
  const locLabel = d.city.includes(",") ? d.city : `${d.shortCity}, ${d.state}`;

  /* prospectPlace builds rival names from six templates and drops any that
     collide with the prospect's own name, so in principle a name could come
     back undefined. Everything below calls .toLowerCase() on these, so they get
     a fallback here rather than crashing the screen. */
  const rivals = d.places.filter((p) => !p.prospect).map((p, i) => ({
    ...p,
    name: p.name ?? `${d.seg} ${["Group", "Partners", "Services"][i] ?? "Co"}`,
  }));
  const rivalDomain = (n: string) =>
    `${n.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`;

  /* Ad copy templates have to survive every vertical on disk, from a hospital
     to a car dealer, so they lean on the canonical terms the engine already
     chose (bookingTerm, product categories, industry) and claim nothing a
     business might not offer. No promises of "free", and no dashes: joined
     clauses are what make copy read as machine written. */
  const prospectAd = (extra: Partial<Ad> = {}): Ad => ({
    brand: d.domain, domain: d.domain, url: `https://www.${d.domain}`,
    title: adTitle,
    body: `Local ${d.seg.toLowerCase()} covering ${d.others.slice(0, 2).join(" and ")}. `
      + `Talk to a specialist and book a ${d.booking} at a time that suits you. `
      + `Serving ${d.city}.`,
    prospect: true, phone, href, ...extra,
  });

  const topAds: Ad[] = [
    prospectAd({
      sitelinks: [d.hero, d.others[0] ?? `Book a ${profile.bookingTerm}`,
        `${profile.bookingTerm} Availability in ${d.shortCity}`],
    }),
    {
      brand: rivals[0].name, domain: rivalDomain(rivals[0].name),
      url: `https://www.${rivalDomain(rivals[0].name)}`,
      title: `${rivals[0].name} | ${d.seg} in ${d.shortCity}`,
      body: `Established local ${d.seg.toLowerCase()} team. Request pricing online `
        + `or over the phone. Serving ${d.shortCity} and the surrounding area.`,
      prospect: false,
    },
    {
      brand: rivals[1].name, domain: rivalDomain(rivals[1].name),
      url: `https://www.${rivalDomain(rivals[1].name)}`,
      title: `${rivals[1].name} | Compare Options and Pricing`,
      body: `Straightforward pricing on ${d.hero.toLowerCase()}. Book online in `
        + `minutes. Weekend availability at selected locations.`,
      prospect: false,
    },
    {
      brand: rivals[2].name, domain: rivalDomain(rivals[2].name),
      url: `https://www.${rivalDomain(rivals[2].name)}`,
      title: `${rivals[2].name} | ${profile.bookingTerm}s Available`,
      body: `A broad range of services in one place. See what is available near `
        + `you this week.`,
      prospect: false,
    },
  ];

  /* The second block repeats the rule: the prospect leads it too. */
  const lowerAds: Ad[] = [
    prospectAd({
      /* Title case, and the shorter second clause: `offer` is written as prose
         for the ChatGPT card ("Consultation availability this week"), which
         reads wrong as a paid headline and ran to two lines here. */
      title: `${d.offer.replace(/\b\w/g, (c) => c.toUpperCase())} | ${d.shortCity}`,
      chips: [d.hero, `Book a ${profile.bookingTerm}`, d.others[0] ?? "Our Services",
        `${d.shortCity} Locations`],
      visits: "100K+",
      phone: undefined,
    }),
    {
      brand: rivals[0].name, domain: rivalDomain(rivals[0].name),
      url: `https://www.${rivalDomain(rivals[0].name)}`,
      title: `${d.seg} in ${d.shortCity} | Request a Quote`,
      body: `Local team, transparent pricing, no obligation quotes. Serving `
        + `${d.shortCity} and nearby.`,
      rating: `4.7 · 371 reviews`, visits: "50K+", prospect: false,
      chips: ["New Customer Offers", "Locations", "Pricing"],
    },
  ];

  /* The pack: the prospect first, then the rivals, then the prospect AGAIN as a
     sponsored place. The capture does exactly that (the same business appears
     organically and as a paid place), and it is the clearest way to show the
     prospect buying both slots. */
  const packPlace = (i: number, sponsored = false): Place => {
    const p = d.places[i];
    const revs = 400 + ((hash(p.name) % 1600));
    return {
      name: p.name, rating: p.rating, reviews: revs.toLocaleString(),
      type: d.seg, area: p.prospect ? d.address : `${d.shortCity} area`,
      phone: p.prospect ? phone : undefined,
      hours: sponsored ? "Open 24 hours" : (i % 2 ? "Open · Closes 6 PM" : "Open · Closes 5 PM"),
      note: sponsored
        ? `${profile.bookingTerm}s available this week. Speak to the ${d.shortCity} team.`
        : p.a,
      prospect: p.prospect, sponsored,
      href: p.prospect ? (sponsored ? href : trackedSiteUrl(d.domain)) : undefined,
    };
  };
  const places: Place[] = [packPlace(0), packPlace(1), packPlace(2), packPlace(0, true)];

  /* The LSA unit: the prospect, then one of the same invented rivals `places`
     already carries — reusing `d.places[1].rating` (the rating `derive()` gave
     that same rival) rather than inventing a second, disagreeing figure. */
  /* =============================================================================
     Sending the quote request is what creates the two things in the platform
     -----------------------------------------------------------------------------
     Asked for directly: *"When send is click, it should create a lead in salesforce, and
     also create a SMS Workflow based on what is shared in the form."*

     ⚠️ **STORED ONCE, READ BY BOTH.** The submission goes into `QuoteCaptureContext` — the
     SMS/Voice capture stores' third sibling — and the Leads tab and Agent Studio each DERIVE
     their view from it (`liveQuoteLead`, `quoteWorkflow`). Writing a lead and a workflow
     separately at submit time would be two records of one event, free to drift; this way
     there is one record and two readers.
     ⚠️ **AND IT IS USUALLY A DIFFERENT TAB.** The search screen is opened from the top bar's
     Network chip and the platform is left behind it, so the store writes synchronously and
     the context listens for `storage` — otherwise the lead and the workflow would not appear
     until somebody refreshed. */
  const { add: addQuote } = useQuoteCaptures();
  const recordQuote = (q: {
    name: string; message: string; service: string; how: "sms" | "email"; contact: string;
  }) => {
    addQuote(profile.id, {
      id: String(Date.now()),
      iso: new Date().toISOString(),
      business: profile.customerName,
      /* Google's LSA lead payload names the consumer's city and the form never asks for it,
         so it comes from the location this ad was served in — the same value the unit prints
         as "Serves <city>", and the one an SE can re-point with the ZIP pill. */
      location: d.shortCity,
      ...q,
    });
  };

  const lsaNoun = providerNoun(profile.industry, d.seg);
  const lsaRows = [
    lsaRow({ name: profile.customerName, rating: d.places[0].rating, prospect: true }, lsaNoun, lsaPhoto ?? undefined),
    lsaRow({ name: rivals[0].name, rating: d.places[1]?.rating ?? "4.7", prospect: false }, lsaNoun),
  ];

  const dirDomain = `${d.shortCity.toLowerCase().replace(/[^a-z0-9]+/g, "")}directory.com`;
  const guideDomain = `guideto${d.shortCity.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`;
  const base = query.replace(/^best\s+/i, "").replace(/\s+near me$/i, "");

  const organicTop: Organic[] = [
    {
      brand: `${d.shortCity} Directory`, url: `https://www.${dirDomain} › ${slugify(d.seg)}`,
      title: `Top 10 Best ${d.seg} in ${d.shortCity} | Updated 2026`,
      body: `A ranked list of ${d.seg.toLowerCase()} providers near ${d.city}, with `
        + `opening hours, service areas and verified reviews for each one.`,
      rating: "4.4|1,689",
    },
    {
      brand: profile.customerName, prospect: true, href: trackedSiteUrl(d.domain),
      url: `https://www.${d.domain} › ${slugify(d.hero)}`,
      title: `${d.hero} | ${profile.customerName}`,
      body: `Book a ${d.booking} with the ${d.shortCity} team. ${d.others.slice(0, 2).join(", ")} `
        + `and more, with availability confirmed over the phone.`,
    },
    {
      brand: rivals[0].name, url: `https://www.${rivalDomain(rivals[0].name)} › services`,
      title: `${d.seg} Services in ${d.shortCity}`,
      body: `${rivals[0].name} covers ${d.shortCity} and the surrounding area with `
        + `${d.seg.toLowerCase()} services for homes and businesses.`,
    },
    {
      brand: `Guide to ${d.shortCity}`, url: `https://www.${guideDomain} › ${slugify(base)}`,
      title: `${d.seg} in ${d.shortCity}: What to Know Before You Book`,
      body: `How to compare providers, what a ${d.booking} usually covers, and the `
        + `questions worth asking before you commit.`,
    },
  ];

  const organicLower: Organic[] = [
    {
      brand: rivals[1].name, url: `https://www.${rivalDomain(rivals[1].name)} › locations`,
      title: `${d.hero} Near ${d.shortCity}`,
      body: `${rivals[1].name} serves ${d.city}. Call for more information about `
        + `availability in your area.`,
    },
    {
      brand: rivals[2].name, url: `https://www.${rivalDomain(rivals[2].name)} › about`,
      title: `${rivals[2].name} | Services and Locations`,
      body: `A broad range of ${d.seg.toLowerCase()} services, with online booking `
        + `and weekend availability at selected locations.`,
    },
    {
      brand: `${d.shortCity} Directory`, url: `https://www.${dirDomain} › reviews`,
      title: `TOP 10 BEST ${d.seg} in ${d.shortCity}`,
      body: `Reader ranked providers for ${base} in ${d.city}, refreshed monthly `
        + `from verified customer reviews.`,
      rating: "4.3|2,015",
    },
  ];

  const pasf = [
    `${base} near ${d.shortCity.toLowerCase()}`,
    `${base} prices`,
    `best ${base} near me`,
    `${profile.customerName.toLowerCase()} ${base}`,
    `${base} reviews`,
  ];

  return (
    <div className="gs-page">
      <Header query={query} onQuery={setQuery} />

      <div className="gs-body">
        <div className="gs-loc">
          <Icon d={P.pin} size={16} />
          <b>{locLabel}</b>
          <LocationPill loc={loc} />
          <span className="gs-kebab"><Icon d={P.kebab} size={16} /></span>
        </div>

        {/* ⚠️ THE SERVICE LIST IS THE PROSPECT'S OWN PRODUCT CATEGORIES. The capture's
            dropdown was closed when it was saved, so its options are NOT measured — but
            "the service you need" is exactly what `Conversions by Product Category`
            already holds for every prospect, so this re-skins for free and can never
            offer a service the business does not sell. */}
        <LsaUnit rows={lsaRows} noun={lsaNoun} city={d.shortCity}
          services={[d.hero, ...d.others].filter(Boolean)} onSend={recordQuote}
          bookDefault={bookDefault} bookHref={book.url ?? bookDefault} book={book} />

        <h2 className="gs-spons-head">Sponsored Results</h2>
        {topAds.map((a) => <AdBlock key={a.brand + a.title} ad={a} />)}
        <div className="gs-hide"><span>Hide sponsored results <Icon d={P.chevUp} size={16} /></span></div>

        <h2 className="gs-places-head">Places</h2>
        <div className="gs-pack">
          <div className="gs-pack-list">
            {places.map((pl, i) => <PlaceRow key={pl.name + i} pl={pl} />)}
            <div className="gs-more">More places <Icon d={P.chevRight} size={16} /></div>
          </div>
          <PackMap d={d} places={places} />
        </div>

        {organicTop.map((r) => <OrganicResult key={r.title} r={r} />)}

        <h2 className="gs-spons-head">Sponsored Results</h2>
        {lowerAds.map((a) => <AdBlock key={a.brand + a.title} ad={a} />)}
        <div className="gs-hide"><span>Hide sponsored results <Icon d={P.chevUp} size={16} /></span></div>

        {organicLower.map((r) => <OrganicResult key={r.title} r={r} />)}

        <h2 className="gs-pasf-head">People also search for</h2>
        <div className="gs-pasf">
          {pasf.map((t) => (
            <span className="gs-pasf-item" key={t}>
              <span>{t}</span><Icon d={P.search} size={16} />
            </span>
          ))}
        </div>

        <div className="gs-pager">
          <span className="gs-goo">G<b>ooooooooo</b>gle</span>
          <span className="gs-pages">
            <b>1</b>{[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <a key={n}>{n}</a>)}
            <a className="gs-next">Next</a>
          </span>
        </div>
      </div>

      <footer className="gs-foot">
        <div className="gs-foot-in">
          <div className="gs-foot-top">Results are not personalized</div>
          <div className="gs-foot-mid">
            <Icon d={P.pin} size={14} /> <b>{locLabel}</b>
            <span className="gs-dot">·</span>From your IP address
            <span className="gs-dot">·</span><a>Update location</a>
          </div>
          <div className="gs-foot-links">
            <a>Help</a><a>Send feedback</a><a>Privacy</a><a>Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
