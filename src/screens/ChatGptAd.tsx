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

const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");

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

  return {
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
};

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

              {/* Deliberately vertical-neutral advice: this same copy has to read
                  naturally for window treatments, security, healthcare and auto,
                  so it leans on how people shop rather than product specifics. */}
              <div className="cg-answer">
                <p>
                  It depends a lot on what you actually need and who&rsquo;s available near
                  you, but there are three things worth checking before you decide:
                </p>
                <ul>
                  <li><strong>Get a real number, not a range.</strong> Advertised pricing is a starting point — the number that matters is the one for your specific situation.</li>
                  <li><strong>Ask what&rsquo;s actually included.</strong> The headline number usually leaves out things you&rsquo;ll end up paying for anyway.</li>
                  <li><strong>Check availability first.</strong> Lead times vary widely between providers, and the fastest one isn&rsquo;t always the cheapest.</li>
                </ul>
                <p>
                  The quickest way to get a firm answer is to talk to someone directly —
                  and most places can get you in for {article(d.booking)} {d.booking} quickly
                  {d.area ? `. Here's one covering ${d.area}` : ""}:
                </p>
              </div>

              <div className="cg-sponsored">
                <div className="cg-sponsored-label">Sponsored</div>
                <div className="cg-ad">
                  <div className="cg-ad-icon" aria-hidden="true">{d.icon}</div>
                  <div className="cg-ad-body">
                    <div className="cg-ad-brand">
                      {d.brand}<span className="cg-ad-domain">{d.domain}</span>
                    </div>
                    <div className="cg-ad-head">{d.offer} — book by phone in under a minute</div>
                    <div className="cg-ad-sub">
                      Speak to a specialist about {d.hero.toLowerCase()}
                      {d.others.length ? `, ${d.others.join(", ").toLowerCase()}` : ""} and
                      what it&rsquo;ll actually cost — no obligation.
                    </div>
                    <div className="cg-ad-actions">
                      <a className="cg-call" href={`tel:${d.phone.replace(/[^\d+]/g, "")}`}>
                        <span className="material-icons">call</span>{d.phone}
                      </a>
                      <button className="cg-visit">Visit site</button>
                    </div>
                  </div>
                </div>
                <div className="cg-sponsored-foot">Sponsored results are paid placements.</div>
              </div>
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
