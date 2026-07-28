import { useProfile } from "../data/ProfileContext";

/* ChatGPT sponsored placement — a standalone page for the demo click-through,
   the AI-channel counterpart to the Google Ads console copy at
   /integrations/google-ads. The story it tells: the buyer asks an assistant for
   a recommendation, sees the prospect as a Sponsored result, and taps to call —
   and that call is the one Invoca then attributes.

   It is a MOCK-UP of the placement format, not a copy of a shipped OpenAI
   screen, and it lives only inside the sales demo.

   Everything is DERIVED from the existing profile rather than a new schema
   slice + engine phase, so every prospect already on disk gets this screen with
   no regeneration. If the copy starts to feel templated across verticals,
   the upgrade path is an optional `chatGptAd` slice that this falls back from. */

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

const article = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");

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
  const query = `best ${(isProcessWord ? hero : term).toLowerCase()} near me`;

  return {
    query,
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
  };
}

export function ChatGptAd() {
  const { profile } = useProfile();
  const d = derive(profile);

  return (
    <div className="cg-root">
      <aside className="cg-side">
        <div className="cg-side-top">
          <span className="cg-mark cg-mark-sm" aria-hidden="true"><span className="material-icons">auto_awesome</span></span>
          <span className="cg-new">New chat</span>
        </div>
        <div className="cg-side-label">Today</div>
        {[d.query, `${d.hero} cost breakdown`, `${d.booking} checklist`].map((t) => (
          <div key={t} className={"cg-side-item" + (t === d.query ? " cg-side-active" : "")}>{t}</div>
        ))}
      </aside>

      <main className="cg-main">
        <header className="cg-head">ChatGPT</header>

        <div className="cg-thread">
          <div className="cg-user"><span>{d.query}</span></div>

          <div className="cg-assistant">
            <span className="cg-mark" aria-hidden="true"><span className="material-icons">auto_awesome</span></span>
            {/* Deliberately vertical-neutral advice: this same copy has to read
                naturally for window treatments, security, healthcare and auto,
                so it leans on how people shop rather than product specifics. */}
            <div className="cg-answer">
              <p>
                It depends a lot on what you actually need and who's available near
                you, but there are three things worth checking before you decide:
              </p>
              <ul>
                <li><strong>Get a real number, not a range.</strong> Advertised pricing is a starting point — the number that matters is the one for your specific situation.</li>
                <li><strong>Ask what's actually included.</strong> The headline number usually leaves out things you'll end up paying for anyway.</li>
                <li><strong>Check availability first.</strong> Lead times vary widely between providers, and the fastest one isn't always the cheapest.</li>
              </ul>
              <p>
                The quickest way to get a firm answer is to talk to someone directly —
                and most places can get you in for {article(d.booking)} {d.booking} quickly
                {d.area ? `. Here's one covering ${d.area}` : ""}:
              </p>
            </div>
          </div>

          {/* The sponsored placement — the whole point of the screen. */}
          <div className="cg-sponsored">
            <div className="cg-sponsored-label">Sponsored</div>
            <div className="cg-ad">
              <div className="cg-ad-icon" aria-hidden="true">{d.icon}</div>
              <div className="cg-ad-body">
                <div className="cg-ad-brand">
                  {d.brand}
                  <span className="cg-ad-domain">{d.domain}</span>
                </div>
                <div className="cg-ad-head">{d.offer} — book by phone in under a minute</div>
                <div className="cg-ad-sub">
                  Speak to a specialist about {d.hero.toLowerCase()}
                  {d.others.length ? `, ${d.others.join(", ").toLowerCase()}` : ""} and
                  what it'll actually cost — no obligation.
                </div>
                <div className="cg-ad-actions">
                  <a className="cg-call" href={`tel:${d.phone.replace(/[^\d+]/g, "")}`}>
                    <span className="material-icons">call</span>{d.phone}
                  </a>
                  <button className="cg-visit">Visit site</button>
                </div>
              </div>
            </div>
            <div className="cg-sponsored-foot">
              Sponsored results are paid placements. ChatGPT may earn a commission.
            </div>
          </div>
        </div>

        <div className="cg-composer">
          <div className="cg-input">
            <span>Ask anything</span>
            <span className="material-icons cg-send">arrow_upward</span>
          </div>
          <p className="cg-disclaimer">
            Demo mock-up of a sponsored placement — not a live ChatGPT session.
          </p>
        </div>
      </main>
    </div>
  );
}
