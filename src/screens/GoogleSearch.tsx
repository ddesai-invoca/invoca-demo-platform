import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProfile } from "../data/ProfileContext";
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

/* ------------------------------------------------------------- the screen */

export function GoogleSearch() {
  const { profile } = useProfile();
  const d = derive(profile);
  const [query, setQuery] = useState(d.query);

  const md = profile.reports.marketingDashboard;
  const campaign = md.breakdowns.find((b) => /Campaign/i.test(b.title))?.rows[0]?.name
    ?? `${profile.customerName} Search`;
  const href = paidClickUrl(d.domain, campaign, query, profile.id);

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
  const adTitle = (() => {
    const wide = `${d.hero} in ${d.shortCity} | ${profile.bookingTerm}s This Week`;
    return wide.length <= 62 ? wide
      : `${d.hero} | ${profile.bookingTerm}s in ${d.shortCity}`;
  })();

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
  const st = profile.reports.voiceScreenpop?.state;
  const locLabel = d.city.includes(",") ? d.city
    : st ? `${d.shortCity}, ${st}` : d.shortCity;

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
          <span className="gs-loc-pill"><Icon d={P.target} size={16} />Use precise location</span>
          <span className="gs-kebab"><Icon d={P.kebab} size={16} /></span>
        </div>

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
