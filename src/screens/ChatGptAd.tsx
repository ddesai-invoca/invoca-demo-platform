import { useState } from "react";
import { useProfile } from "../data/ProfileContext";

/* ChatGPT sponsored placement — reached from the ChatGPT Ads tile on the Invoca
   Exchange, the same way the Google Ads console page is. It's the AI-channel
   counterpart: the buyer asks an assistant for a recommendation, the prospect
   comes back as a Sponsored result with a phone number, and THAT is the call
   Invoca then attributes.

   Two states in one screen. It opens on the real chatgpt.com landing state
   (dark, "What's on your mind today?"), matched to a SingleFile capture of
   https://chatgpt.com/ — colours are the capture's own dark-theme tokens:
     surface #000 · composer #303030 · border #ffffff26
     text #f3f3f3 / secondary #ffffffb3 / tertiary #ffffff94
   Submitting the composer switches to the answer + the sponsored card.

   Unlike the Exchange and Google Ads pages this is NOT served as a static
   capture: the answer and the ad are re-skinned per prospect, so it has to be
   React. The chrome is matched to the capture; the sponsored placement itself
   is a mock-up of the format, which is why the disclaimer stays on the page. */

/* `serviceArea` is written for the AI agent's system prompt, so it's a full
   paragraph ("the greater Santa Barbara, California area — ZIP codes starting
   with 931…"). An ad needs a place name, so trim it to one and give up
   (returning undefined) rather than print something that doesn't read as a
   place — the copy is written to work with or without it. */
function shortArea(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw
    .split(/[—(,;]/)[0]                                  // drop ZIP-code asides
    .replace(/^\s*(the\s+)?(greater\s+)?/i, "")
    .replace(/\s+(metro(politan)?\s+)?area\s*$/i, "")
    .trim();
  return s && s.length <= 34 ? s : undefined;
}

/* Turn an industry string into something that reads as a business name.
   Naively taking the first "&" segment gave Vector Security "Home" (from
   "Home & Business Security / Alarm Monitoring"), so prefer whichever side of
   the "&" actually has two words: "Business Security", "Vision Care",
   "Health Systems", "Window Treatments". */
function industrySeg(industry: string): string {
  const head = industry.split(/[/,]/)[0].trim();
  const parts = head.split("&").map((x) => x.trim()).filter(Boolean);
  const pick = parts.find((x) => x.split(/\s+/).length >= 2) ?? parts[0] ?? industry;
  return pick.replace(/\b\w/g, (c) => c.toUpperCase());
}

function derive(p: ReturnType<typeof useProfile>["profile"]) {
  const r = p.reports;
  const products = r.marketingDashboard.breakdowns
    .find((b) => /Product Category/i.test(b.title))?.rows.map((x) => x.name) ?? [];
  // The hero product is the biggest category. `searchSuggestions` sometimes has
  // a better, more specific word ("lasik", "tempur-pedic") — but it's a list of
  // CALL-REVIEW search terms, so it's just as likely to hold a process word,
  // which turns the query into nonsense ("best appointment near me", "best
  // entrance fee near me"). Take it only when it looks like a product.
  const hero = products[0] ?? p.industry;
  const term = r.callReview?.searchSuggestions?.[0];
  const isProcessWord =
    !term ||
    new RegExp(`\\b${term}\\b`, "i").test(p.bookingTerm) ||
    /appoint|consult|tour|quote|estimate|price|pricing|cost|fee|financ|warrant|install|monitor|cancel|schedul|book|drive|service|support|billing/i.test(term);

  // The avatar is the CALLER from the screenpop, not the prospect — the person
  // searching here is the same one who shows up on the agent's screen later.
  const caller = r.voiceScreenpop?.callerName ?? "";
  const initials = caller.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]).join("").toUpperCase() || "A";

  /* Where the map centres. Preference order, per the brief: the prospect's own
     stated area first, then the screenpop location (populated for every
     prospect on disk), then San Francisco as the explicit fallback. There is no
     true HQ field on the profile — if we ever want one it has to come from the
     engine, since only research knows it. */
  const area0 = shortArea(r.agentConfig?.serviceArea);
  const vs = r.voiceScreenpop;
  const city = area0
    ?? (vs?.city ? `${vs.city}${vs.state ? `, ${vs.state}` : ""}` : undefined)
    ?? "San Francisco, CA";

  /* The organic results. The prospect is ALWAYS first. The others are built
     from the city + category rather than invented business names — this is a
     mock-up, and naming plausible-sounding real competitors with fabricated
     star ratings is not something to put on a screen. */
  /* A short city for business names and the footer. The full label can be a
     region ("Dallas–Fort Worth Metroplex", "Orlando and Central Florida"),
     which reads wrong inside a name — "Dallas–Fort Worth Metroplex Vision
     Care". Cut at the first dash or "and". */
  const shortCity = city.split(",")[0].split(/\s*[–—-]\s*|\s+and\s+/i)[0].trim();
  /* Competitor names are built from the CITY + the industry, not the product
     category. Product-based templates broke on healthcare — Key-Whitman's
     category is "LASIK / EVO ICL", which produced "LASIK / EVO ICL Warehouse".
     The industry's first segment ("Ophthalmology", "Window treatments") reads
     as a business name in every vertical. Bullets are neutral for the same
     reason: "off-the-shelf sizes" is nonsense for an eye clinic. */
  const seg = industrySeg(p.industry);
  const places = [
    { name: p.customerName, rating: "4.9", type: hero, prospect: true,
      a: `Free ${p.bookingTerm.toLowerCase()}s, and they quote a firm number rather than a range.`,
      b: "Strong reviews for getting people booked in quickly." },
    { name: `${shortCity} ${seg}`, rating: "4.7", type: seg, prospect: false,
      a: "Long-established locally, with a high volume of reviews.",
      b: "Good if you want to talk options through in person first." },
    { name: `Premier ${seg}`, rating: "4.6", type: seg, prospect: false,
      a: "Competitive on price, though waits can run longer at busy times.",
      b: "Worth a call if budget is the deciding factor." },
    { name: `${seg} of ${shortCity}`, rating: "4.4", type: seg, prospect: false,
      a: "Broad range of services, less specialised in any one of them.",
      b: "Fine for something straightforward." },
  ];

  return {
    city, shortCity, places,
    query: `best ${(isProcessWord ? hero : term!).toLowerCase()} near me`,
    hero,
    others: products.slice(1, 4),
    brand: p.customerName,
    domain: p.brandDomain,
    icon: r.voiceRoutingDemo?.brandIcon ?? "◆",
    phone: r.voiceScreenpop?.callerPhone ?? "(805) 555-0142",
    // NOT "Free <booking>" — that's a false claim for verticals where the
    // booking is a medical appointment. Availability works everywhere.
    offer: `${p.bookingTerm} availability this week`,
    area: shortArea(r.agentConfig?.serviceArea),
    booking: p.bookingTerm.toLowerCase(),
    initials,
  };
}

/* Stroke icons rather than the app's filled material set — the real page uses
   thin line icons and the filled ones read far too heavy against black. */
const P: Record<string, string> = {
  compose: "M4 20h4L18.5 9.5a2.121 2.121 0 0 0-3-3L5 17v3z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  chat: "M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z",
  plus: "M12 5v14M5 12h14",
  mic: "M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3zM19 11a7 7 0 0 1-14 0M12 18v4",
  image: "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6",
  pencil: "M4 20h4L18.5 9.5a2.121 2.121 0 0 0-3-3L5 17v3z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18",
  panel: "M4 5h16v14H4zM10 5v14",
  chevron: "M6 9l6 6 6-6",
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  pin: "M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  copy: "M9 9h10v12H9zM5 15H3V3h12v2",
  up: "M7 22V10l5-8 1 1-1.5 6H21l-2.5 13H7z",
  down: "M17 2v12l-5 8-1-1 1.5-6H3L5.5 2H17z",
  share: "M12 16V3M7 8l5-5 5 5M4 16v4h16v-4",
  refresh: "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5",
};

/* Real dark basemap tiles (CARTO "dark_all", built on OpenStreetMap). No API
   key, no SDK — just <img> tiles positioned by the standard slippy-map
   projection, which is why this is a few lines rather than a map library.
   If the first tile fails to load we fall back to a flat panel, so a demo with
   no network shows something map-shaped rather than broken images. */
const CITY_LL: Record<string, [number, number]> = {
  "san francisco": [37.7749, -122.4194], "santa barbara": [34.4208, -119.6982],
  "los angeles": [34.0522, -118.2437], "san diego": [32.7157, -117.1611],
  "thousand oaks": [34.1706, -118.8376], "sacramento": [38.5816, -121.4944],
  "san jose": [37.3382, -121.8863], "portland": [45.5152, -122.6784],
  "seattle": [47.6062, -122.3321], "phoenix": [33.4484, -112.0740],
  "denver": [39.7392, -104.9903], "dallas": [32.7767, -96.7970],
  "fort worth": [32.7555, -97.3308], "houston": [29.7604, -95.3698],
  "austin": [30.2672, -97.7431], "san antonio": [29.4241, -98.4936],
  "orlando": [28.5383, -81.3792], "winter park": [28.6000, -81.3392],
  "tampa": [27.9506, -82.4572], "miami": [25.7617, -80.1918],
  "jacksonville": [30.3322, -81.6557], "atlanta": [33.7490, -84.3880],
  "charlotte": [35.2271, -80.8431], "raleigh": [35.7796, -78.6382],
  "nashville": [36.1627, -86.7816], "chicago": [41.8781, -87.6298],
  "detroit": [42.3314, -83.0458], "minneapolis": [44.9778, -93.2650],
  "kansas city": [39.0997, -94.5786], "columbus": [39.9612, -82.9988],
  "cleveland": [41.4993, -81.6944], "pittsburgh": [40.4406, -79.9959],
  "philadelphia": [39.9526, -75.1652], "new york": [40.7128, -74.0060],
  "boston": [42.3601, -71.0589], "baltimore": [39.2904, -76.6122],
  "washington": [38.9072, -77.0369], "richmond": [37.5407, -77.4360],
  "las vegas": [36.1699, -115.1398], "salt lake city": [40.7608, -111.8910],
  "duluth": [34.0029, -84.1446],
};

/* An exact key lookup silently mismatched: "Dallas–Fort Worth Metroplex" isn't
   a key, so it fell back to San Francisco while the label still read Dallas —
   a wrong map is worse than an obviously generic one. So scan for the longest
   table key CONTAINED in the string ("dallas" inside the Metroplex, "greater
   Orlando and Central Florida" → orlando). San Francisco stays the fallback
   only when nothing matches at all. */
function cityLatLng(city: string): [number, number] {
  const s = city.toLowerCase();
  let best = "";
  for (const k of Object.keys(CITY_LL)) {
    if (s.includes(k) && k.length > best.length) best = k;
  }
  return CITY_LL[best] ?? CITY_LL["san francisco"];
}

const Z = 12, TS = 256;

function tileXY(lat: number, lon: number) {
  const n = 2 ** Z;
  const r = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  };
}

function MapCard({ d }: { d: ReturnType<typeof derive> }) {
  const [broken, setBroken] = useState(false);
  const [lat, lon] = cityLatLng(d.city);
  const c = tileXY(lat, lon);
  const cx = c.x * TS, cy = c.y * TS;
  const cols = [-2, -1, 0, 1, 2], rows = [-1, 0, 1];

  return (
    <div className="cg-map">
      {broken ? <div className="cg-map-offline" /> : (
        <div className="cg-tiles">
          {rows.flatMap((dy) => cols.map((dx) => {
            const tx = Math.floor(c.x) + dx, ty = Math.floor(c.y) + dy;
            return (
              <img key={`${tx}/${ty}`} alt="" draggable={false} className="cg-tile"
                src={`https://a.basemaps.cartocdn.com/dark_all/${Z}/${tx}/${ty}@2x.png`}
                onError={() => setBroken(true)}
                style={{ left: tx * TS - cx, top: ty * TS - cy }} />
            );
          }))}
        </div>
      )}

      {/* Pins sit at fixed offsets from centre rather than real coordinates —
          we know the city, not each business's street address. */}
      {d.places.slice(0, 3).map((pl, i) => (
        <div key={pl.name} className="cg-pin"
          style={{ left: `${[50, 68, 33][i]}%`, top: `${[28, 44, 52][i]}%` }}>
          <span className="cg-pin-badge">★ {pl.rating}</span>
          <span className="cg-pin-label">{pl.name}</span>
        </div>
      ))}

      <button className="cg-map-expand">Expand <Icon d={P.expand} size={13} /></button>
      <span className="cg-map-attr">© OpenStreetMap · CARTO</span>

      <div className="cg-places">
        {d.places.slice(0, 2).map((pl) => (
          <div className="cg-place" key={pl.name}>
            <span className="cg-place-img" aria-hidden="true">{pl.prospect ? d.icon : "▦"}</span>
            <span className="cg-place-txt">
              <span className="cg-place-name">{pl.name}</span>
              <span className="cg-place-meta">★ {pl.rating} • {pl.type}</span>
              <span className="cg-place-open">Open now</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function ChatGptAd() {
  const { profile } = useProfile();
  const d = derive(profile);

  const [text, setText] = useState("");
  const [asked, setAsked] = useState<string | null>(null);

  /* The landing state is a faithful copy, so there's no suggestion row seeded
     with the prospect's query to click — the SE types it. As a shortcut that
     costs nothing visually, submitting an EMPTY composer asks the prospect
     query instead of doing nothing, so Enter alone gets to the placement. */
  function submit(q: string) {
    const v = q.trim() || d.query;
    setAsked(v);
    setText("");
  }

  return (
    <div className="cg-root">
      <nav className="cg-rail">
        {/* Clicking the mark returns to the Exchange, the way the Google Ads
            page returns by clicking its logo. */}
        <a className="cg-rail-mark" href="/integrations" title="Back to Invoca Exchange">
          <img src="/chatgpt/mark.svg" alt="" width="24" height="25" />
        </a>
        <button className="cg-rail-btn" title="New chat"
          onClick={() => { setAsked(null); setText(""); }}><Icon d={P.compose} /></button>
        <button className="cg-rail-btn" title="Search chats"><Icon d={P.search} /></button>
        <button className="cg-rail-btn" title="Library"><Icon d={P.chat} /></button>
        <span className="cg-avatar">{d.initials}</span>
      </nav>

      <div className="cg-main">
        <header className="cg-top">
          <span className="cg-top-name">ChatGPT<Icon d={P.chevron} size={16} /></span>
          <span className="cg-top-right">
            <span className="cg-upgrade"><span className="cg-spark">✦</span>Upgrade</span>
            <span className="cg-panel"><Icon d={P.panel} /></span>
          </span>
        </header>

        {asked === null ? (
          /* ---------- landing state, matched to the capture ---------- */
          <div className="cg-splash">
            <h1 className="cg-headline">What&rsquo;s on your mind today?</h1>
            <Composer value={text} onChange={setText} onSubmit={() => submit(text)} />
            <div className="cg-chips">
              <button className="cg-chip"><Icon d={P.image} /><span>Create an image</span></button>
              <button className="cg-chip"><Icon d={P.pencil} /><span>Write or edit</span></button>
              <button className="cg-chip"><Icon d={P.globe} /><span>Search the web</span></button>
            </div>
          </div>
        ) : (
          /* ---------- answer + the sponsored placement ---------- */
          <>
            <div className="cg-thread">
              <div className="cg-user"><span>{asked}</span></div>

              <MapCard d={d} />
              <div className="cg-feedback">Give feedback</div>

              {/* Vertical-neutral by design: this same copy has to read naturally
                  for window treatments, security, healthcare and auto. */}
              <div className="cg-answer">
                <p>If you&rsquo;re in the {d.city} area, here are some well-rated options nearby:</p>
                <ol className="cg-list">
                  {d.places.map((pl) => (
                    <li key={pl.name}>
                      <span className="cg-list-name">{pl.name}</span>{" "}
                      <span className="cg-list-city">({d.shortCity})</span>
                      <ul><li>{pl.a}</li><li>{pl.b}</li></ul>
                    </li>
                  ))}
                </ol>
                <p>
                  If you mainly want this <strong>sorted quickly</strong>, {d.places[0].name} is the
                  one most people call first — they&rsquo;ll give you a firm number over the phone
                  rather than a range, and {d.area ? `they cover ${d.area}` : "they cover this area"}.
                </p>
                <p>If you tell me:</p>
                <ul>
                  <li>what you need it for, and</li>
                  <li>your <strong>budget</strong>,</li>
                </ul>
                <p>I can narrow this down to the best option for you and estimate the total cost.</p>
              </div>

              <div className="cg-loc">
                <Icon d={P.pin} size={14} />{d.shortCity} &nbsp;•&nbsp;
                <span className="cg-loc-link">Use precise location</span>
              </div>

              <div className="cg-toolrow">
                {[P.copy, P.up, P.down, P.share, P.refresh].map((ic, i) => (
                  <span className="cg-tool" key={i}><Icon d={ic} size={17} /></span>
                ))}
                <span className="cg-tool cg-dots">···</span>
                <span className="cg-sources">Sources</span>
              </div>

              {/* THE SPONSORED SLOT — always the prospect. This is the whole
                  point of the screen: the call starts here. */}
              <div className="cg-adwrap">
                <div className="cg-ad">
                  <div className="cg-ad-logo" aria-hidden="true">{d.icon}</div>
                  <div className="cg-ad-body">
                    <div className="cg-ad-row">
                      <span className="cg-ad-domain">{d.domain}</span>
                      <span className="cg-ad-badge">Ad</span>
                    </div>
                    <div className="cg-ad-head">{d.offer}</div>
                    <div className="cg-ad-sub">
                      Speak to a specialist about {d.hero.toLowerCase()} and what it&rsquo;ll
                      actually cost &mdash; no obligation.
                    </div>
                    <a className="cg-call" href={`tel:${d.phone.replace(/[^\d+]/g, "")}`}>
                      <span className="material-icons">call</span>{d.phone}
                    </a>
                  </div>
                </div>
                <p className="cg-adnote">
                  Ads do not influence the answers you get from ChatGPT. Your chats stay private.{" "}
                  <span className="cg-loc-link">Learn about ads and personalization &rsaquo;</span>
                </p>
              </div>

              <p className="cg-mistakes">ChatGPT can make mistakes. Check important info.</p>
            </div>

            <div className="cg-dock">
              <Composer value={text} onChange={setText} onSubmit={() => submit(text)} />
              <p className="cg-disclaimer">
                Demo mock-up of a sponsored placement — not a live ChatGPT session.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Composer({ value, onChange, onSubmit }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void;
}) {
  return (
    <form className="cg-composer" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <button type="button" className="cg-cbtn"><Icon d={P.plus} /></button>
      {/* Enter is handled explicitly rather than leaning on the form's implicit
          submission, which didn't fire here even with a real submit button. */}
      <input className="cg-input" value={value} placeholder="Ask anything"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit(); } }} />
      <button type="button" className="cg-cbtn"><Icon d={P.mic} /></button>
      <button type="submit" className="cg-voice" aria-label="Send">
        <span /><span /><span /><span />
      </button>
    </form>
  );
}
