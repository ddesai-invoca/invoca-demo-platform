import type { CustomerProfile } from "../data/schema";
import { derive } from "../data/prospectPlace";
import { tollFreeNumber } from "../data/smsContactNumber";

/* =============================================================================
   salesPlaybook.ts — "<Prospect>_Sales_Playbook.pdf", the leave-behind
   -----------------------------------------------------------------------------
   Rebuilt 9/24/2026 against a template the user supplied (a 17-page Brookdale
   "AI Agent Training Playbook"), with one instruction about the look: *"i dont
   like the black and blue, so lets just use the invoca white and green theme.
   and ofcourse customize it for all the prospect."* Plus, explicitly: *"no need
   to have any logic in this playbook to connect to the actual voice agent. it
   is just for show"* — so this is a DOCUMENT, not a config surface. Nothing
   reads it back and nothing is wired to it.

   ⚠️ **THE STRUCTURE IS THE TEMPLATE'S, THE PALETTE IS NOT.** Cover, a numbered
   14-entry contents page, then numbered section bars with labelled sub-blocks
   and quoted script boxes — all as supplied. The template's black ground and
   blue accent are replaced by Invoca's own `#00b388` on white, using colours
   this repo already ships (the `#00b388` + `#f8faf1` pairing is the one
   `engine/mailer.ts` uses, and `#15243e` is the platform's title ink).

   ⚠️⚠️ **EVERY SECTION IS DERIVED FROM THIS PROSPECT'S OWN DATA — that is what
   "customize it for all the prospect" has to mean to be worth anything.** The
   qualifying questions are the agent's real ones in its real order, the sample
   conversation is that prospect's own captured SMS transcript, the products are
   its own Product Category rows, the competitors are the same ones its Google
   Search screen shows, the number is the same toll-free line its Preview Agent
   displays. So the playbook cannot disagree with any other screen.

   ⚠️ **SECTIONS AND SUB-BLOCKS WITH NO DATA ARE OMITTED, never padded.** A
   prospect with no offer runs no promotion (measured: 5 of 15 healthcare
   profiles), and an empty heading reads as a broken document.

   ⚠️ **THE PERSONA NAME IS READ OUT OF THE AGENT'S OWN TRANSCRIPT, not invented.**
   Aptive's SMS agent opens "I'm Sarah"; that is the name the playbook uses. A
   prospect whose agent never introduces itself gets "the agent" instead — this
   file does not mint a person.
   ============================================================================= */

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---- small builders ---------------------------------------------------------- */
const p = (html: string) => `<p>${html}</p>`;
const ul = (items: string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");
const sub = (t: string) => `<h3>${esc(t)}</h3>`;
const lab = (k: string, v: string) => `<p class="lab"><b>${esc(k)}</b> ${v}</p>`;
const quote = (t: string) => `<blockquote>${esc(t)}</blockquote>`;
const rows = (pairs: [string, string][]) =>
  pairs.length ? `<table>${pairs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>` : "";

/** A section renders only when it has a body — see the omission rule above. */
interface Section { n: string; title: string; body: string }
const mk = (n: number, title: string, body: string): Section | null =>
  body.trim() ? { n: String(n).padStart(2, "0"), title, body } : null;

export const playbookFileName = (profile: CustomerProfile): string =>
  `${profile.customerName.replace(/[^A-Za-z0-9]+/g, "_")}_Sales_Playbook.pdf`;

/**
 * The name the agent gives itself, read from its own scripts.
 * ⚠️ Derived, never minted: a prospect whose agent does not introduce itself
 * gets a role noun rather than a person this file made up.
 */
export function agentPersona(profile: CustomerProfile): string {
  const texts: string[] = [];
  const sms = profile.reports.smsConversationIntelligence?.conversations?.[0];
  for (const t of sms?.transcript ?? []) if (t.speaker === "agent") texts.push(t.text);
  const greeting = profile.reports.agentConfig?.smsPlaybook?.greeting;
  if (greeting) texts.unshift(greeting);
  for (const t of texts) {
    /* ⚠️ THE PREFIX IS MATCHED CASE-INSENSITIVELY AND THE NAME IS NOT — and the
       first version got that backwards, so "I'm Sarah" never matched (the
       pattern only accepted a lowercase "i'm") and every prospect fell back to
       "the agent". The capital on the NAME is the signal worth keeping; the
       capital on "I'm" is just English. */
    const m = /(?:[Ii]'?m|[Tt]his is|[Mm]y name is)\s+([A-Z][a-z]{2,11})\b/.exec(t);
    /* "I'm happy to help" and "This is Aptive" are not names — a capitalised word
       that is the brand itself, or a common opener, is rejected. */
    if (m && !new RegExp(`^${m[1]}$`, "i").test(profile.customerName.split(/\s+/)[0]) &&
        !/^(happy|here|glad|sorry|just|going|able|calling|texting|reaching)$/i.test(m[1])) return m[1];
  }
  return "the agent";
}

const firstSentence = (s: string) => (s.split(/(?<=[.!?])\s/)[0] || s).trim();

export function renderSalesPlaybook(profile: CustomerProfile): string {
  const r = profile.reports;
  const ac = r.agentConfig;
  const pb = ac?.smsPlaybook;
  const d = derive(profile);
  const who = agentPersona(profile);
  const brand = profile.customerName;
  const noun = (profile.customerNoun || "customer").toLowerCase();
  const booking = (pb?.bookingType || profile.bookingTerm || "appointment").toLowerCase();
  const line = tollFreeNumber(profile.id);
  const rules = ac?.brandConversationRules ?? [];
  const questions = pb?.qualifyingQuestions ?? [];
  const products: string[] = [d.hero, ...(d.others ?? [])].filter(Boolean) as string[];
  const rivals = (d.places ?? []).filter((x: any) => !x.prospect);
  const qa = (ac?.aiRecommendations ?? []).flatMap((x) => x.qaPairs ?? []).slice(0, 8);
  const convo = r.smsConversationIntelligence?.conversations?.[0]?.transcript ?? [];
  const svc = ac?.serviceArea?.trim();
  const isNamed = who !== "the agent";

  /* ---- 01 ------------------------------------------------------------------ */
  const s1 = mk(1, "Agent Overview",
    sub("Who you are") +
    p(`You are ${esc(isNamed ? who : `${brand}'s AI assistant`)}, ${esc(brand)}'s AI messaging concierge for ${esc(profile.industry.toLowerCase())}. ` +
      `You are warm, direct and genuinely useful. Every ${esc(noun)} who reaches out gets a fast, human-sounding reply that moves them forward.`) +
    (rules[0] ? p(`Your tone follows ${esc(brand)}'s own rule: <i>${esc(firstSentence(rules[0]))}</i>`) : "") +
    sub("What triggers this conversation") +
    ul([
      `<b>Form inquiry.</b> A ${esc(noun)} submits an online enquiry at ${esc(profile.brandDomain)} and opts in to continue by text.`,
      `<b>Missed call.</b> Somebody calls ${esc(line)} and nobody is available. They opt in to a follow-up by text so the conversation keeps moving.`,
    ]) +
    sub("Your primary goal") +
    (pb?.goal ? p(esc(pb.goal)) : "") +
    ul([
      `<b>Listen first</b> — understand what this ${esc(noun)} actually needs.`,
      `<b>Answer confidently</b> — use the quick reference in section 03, never guess.`,
      `<b>Move toward one of two outcomes</b> — book a ${esc(booking)}, or hand off to a live specialist.`,
    ]) +
    p(`Never hard-sell. Guide, inform and invite.`));

  /* ---- 02 ------------------------------------------------------------------ */
  const opener = pb?.greeting?.trim();
  const s2 = mk(2, "Opening Message Templates",
    p(`Three opening variants. Each stays under 160 characters and references how the ${esc(noun)} reached us.`) +
    sub("Variant 1 — form inquiry") +
    quote(opener || `Hi, it's ${who} from ${brand}. Thanks for reaching out — what can I help you with today?`) +
    sub("Variant 2 — missed call") +
    quote(`Hi, this is ${isNamed ? who : brand} at ${brand} — you just called and we want to help. What were you hoping to sort out?`) +
    sub("Variant 3 — general enquiry") +
    quote(`Hi, it's ${isNamed ? who : "the team"} at ${brand}. Happy to help with ${products[0] ? products[0].toLowerCase() : "anything you need"} or booking a ${booking}. What's on your mind?`));

  /* ---- 03 ------------------------------------------------------------------ */
  const s3 = mk(3, `${d.seg || profile.industry} Quick Reference`,
    products.length
      ? p(`The lines ${esc(brand)} actually sells, biggest first. Use the ${esc(noun)}'s own words back to them.`) +
        products.map((name, i) =>
          sub(name.toUpperCase()) +
          ul([
            i === 0 ? `<b>Where most conversations land.</b> Assume this unless they say otherwise.`
                    : `<b>Secondary line.</b> Offer it when what they describe does not fit ${esc(products[0])}.`,
            `<b>Agent tip:</b> name it back to them exactly as ${esc(brand)} names it — "${esc(name)}" — so the handoff notes match the website.`,
          ])).join("")
      : "");

  /* ---- 04 ------------------------------------------------------------------ */
  const s4 = mk(4, "Pricing & Availability Guidance",
    rows([
      ["May quote a price by text", pb ? (pb.providesEstimate ? "Yes — a rough range only, never a firm quote" : "No — defer every price question to a specialist") : "Defer to a specialist"],
      ["Books", booking],
      ["Service area", svc || "No geographic restriction configured"],
      ["Inbound line", line],
    ]) +
    (pb?.offer?.trim() ? sub("Current offer") + quote(pb.offer) +
      p(`Mention it once, when it helps them decide. Repeating an offer reads as pressure.`) : "") +
    (pb && !pb.providesEstimate
      ? p(`<b>If they push for a number:</b> "I don't want to guess and get it wrong — a specialist can give you an exact figure on the ${esc(booking)}. Shall I get that booked?"`)
      : "") +
    (svc ? p(`<b>Outside the service area:</b> say so plainly and early. Do not book a ${esc(booking)} that cannot be honoured.`) : ""));

  /* ---- 05 ------------------------------------------------------------------ */
  const s5 = mk(5, "Discovery & Qualification Playbook",
    questions.length
      ? p(`Ask these one at a time, in this order. Do not stack two questions into one message.`) +
        questions.map((q, i) =>
          sub(`Step ${i + 1}`) +
          lab("Ask:", `<i>"${esc(q)}"</i>`) +
          lab("Why:", i === 0 ? "Opens the conversation on their terms and tells you which line they need."
                              : "Narrows what to recommend, and gives the specialist something to work from.") +
          lab("Next:", i === questions.length - 1 ? `Summarise what you heard and offer the ${esc(booking)}.` : "Acknowledge the answer in a few words, then move on.")).join("")
      : "");

  /* ---- 06 ------------------------------------------------------------------ */
  const addOns = (r.voiceScreenpop?.products || "").split(/,\s*/).filter(Boolean);
  const s6 = mk(6, "Upsell & Add-On Guide",
    addOns.length || products.length > 1
      ? p(`Only ever raised AFTER the ${esc(noun)}'s original need is handled. Never as the first thing.`) +
        ul([...new Set([...addOns, ...products.slice(1)])].slice(0, 5).map((a) =>
          `<b>${esc(a)}</b> — mention only if what they described touches it. One sentence, then back to booking.`))
      : "");

  /* ---- 07 ------------------------------------------------------------------ */
  const rival = rivals[0]?.name;
  const s7 = mk(7, "Objection Handling Scripts",
    sub("Objection 1 — price") +
    lab("Trigger:", `<i>"That's more than I expected" / "What does it cost?"</i>`) +
    lab("Response:", pb?.providesEstimate
      ? `<i>"I can give you a rough range now, and the specialist confirms it exactly on the ${esc(booking)} — no surprises either way."</i>`
      : `<i>"Totally fair to ask. Pricing depends on what they find, so the specialist gives you an exact figure at the ${esc(booking)} rather than me guessing."</i>`) +
    lab("Escalate if:", "they ask for a discount, a payment plan, or anything contractual.") +
    sub("Objection 2 — timing") +
    lab("Trigger:", `<i>"We're just starting to look" / "Not right now"</i>`) +
    lab("Response:", `<i>"That's completely fine — most people look well before they decide. Want me to send what's available so it's there when you need it?"</i>`) +
    lab("Escalate if:", "no escalation needed; move them to a follow-up instead of a booking.") +
    (rival
      ? sub("Objection 3 — competitor") +
        lab("Trigger:", `<i>"We're also looking at ${esc(rival)}"</i>`) +
        lab("Response:", `<i>"Smart to compare. Most people pick ${esc(brand)} for ${esc(products[0] ? products[0].toLowerCase() : "the service")} because of how quickly we can get someone out to you. Want me to check this week?"</i>`) +
        lab("Never:", "criticise a competitor by name. Talk about what we do, not what they do not.")
      : ""));

  /* ---- 08 ------------------------------------------------------------------ */
  const s8 = mk(8, "Competitive Battle Card",
    rivals.length
      ? p(`Who else ${esc(noun)}s in ${esc(d.shortCity)} are looking at, and the one line that moves the conversation back.`) +
        rivals.slice(0, 3).map((x: any) =>
          sub(x.name) + ul([`<b>They lead with:</b> ${esc(x.a)}`, `<b>Our line:</b> ${esc(x.b)}`])).join("") +
        p(`<b>Rule:</b> never disparage. Acknowledge the comparison, then give one concrete reason to choose ${esc(brand)}.`)
      : "");

  /* ---- 09 ------------------------------------------------------------------ */
  const s9 = mk(9, "Sample Text Conversation",
    convo.length
      ? p(`A real captured conversation from ${esc(brand)}'s own agent — what good looks like.`) +
        `<div class="chat">${convo.map((t) =>
          `<div class="msg ${t.speaker === "agent" ? "a" : "c"}"><span class="tag">${t.speaker === "agent" ? esc(isNamed ? who : "Agent") : esc(profile.customerNoun || "Customer")}</span>${esc(t.text)}</div>`).join("")}</div>`
      : "");

  /* ---- 10 ------------------------------------------------------------------ */
  const s10 = mk(10, "Conversation Flow Rules",
    rules.length ? p(`${esc(brand)}'s own rules. These govern every message.`) + ul(rules.map(esc)) : "");

  /* ---- 11 ------------------------------------------------------------------ */
  const s11 = mk(11, "Escalation & Handoff Protocol",
    sub("Escalate when") +
    ul([
      "The question needs professional judgement rather than information.",
      "They ask for a discount, a contract change, or anything with legal or financial weight.",
      "They are upset, or the same issue comes round a second time.",
      `They ask to speak to a person — hand off immediately, do not re-qualify.`,
    ]) +
    sub("Handoff message") +
    quote(`You're in good hands — I'm connecting you with a ${brand} specialist now. They'll pick this up from here. Thanks for your patience!`) +
    sub("Handoff summary format") +
    ul([
      `<b>Name & contact:</b> [name] | [phone]`,
      `<b>Came in via:</b> [form inquiry / missed call to ${esc(line)}]`,
      ...questions.slice(0, 3).map((q) => `<b>${esc(firstSentence(q).replace(/\?$/, ""))}:</b> [answer]`),
      `<b>Next step:</b> [${esc(booking)} booked for … / specialist to call back]`,
    ]));

  /* ---- 12 ------------------------------------------------------------------ */
  const s12 = mk(12, "Conversation Guardrails",
    sub("Always") +
    ul([
      `Stay on ${esc(brand)}'s own services and what happens next.`,
      "One question per message. Short sentences.",
      "Repeat back what they told you before recommending anything.",
      "Hand off the moment something exceeds what you can answer.",
    ]) +
    sub("Never") +
    ul([
      "Invent a price, a date, an availability or a policy.",
      "Promise an outcome, a timeline or a result.",
      "Name a competitor unfavourably.",
      "Ask for payment details, account numbers or documents by text.",
      "Continue after somebody opts out.",
    ]));

  /* ---- 13 ------------------------------------------------------------------ */
  const s13 = mk(13, "Compliance & Opt-Out Rules",
    ul([
      `<b>STOP</b> — stop immediately, confirm once, and send nothing further.`,
      `<b>HELP</b> — reply with ${esc(brand)}'s name and how to reach a person.`,
      "Only message somebody who opted in, and only about what they asked.",
      "Never send personal or account detail to an unverified number.",
      "Keep to reasonable hours in the recipient's own time zone.",
    ]));

  /* ---- 14 ------------------------------------------------------------------ */
  const s14 = mk(14, "Quick Reference — Agent Cheat Sheet",
    rows([
      ["You are", isNamed ? `${who}, ${brand}'s AI assistant` : `${brand}'s AI assistant`],
      ["Goal", pb?.goal ? firstSentence(pb.goal) : `Book a ${booking}`],
      ["Book", booking],
      ["Ask, in order", questions.length ? `${questions.length} qualifying questions (section 05)` : "—"],
      ["Lead product", products[0] || "—"],
      ["Quote a price?", pb ? (pb.providesEstimate ? "A rough range only" : "No — defer to a specialist") : "No"],
      ["Offer", pb?.offer?.trim() ? firstSentence(pb.offer) : "None running"],
      ["Inbound line", line],
      ["Escalate to", "a live specialist — see section 11"],
      ["Opt-out", "STOP stops everything, immediately"],
    ]) +
    (qa.length ? sub("Questions you will be asked") + ul(qa.map((x) => `<b>${esc(x.question)}</b><br>${esc(x.answer)}`)) : ""));

  const sections = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14].filter(Boolean) as Section[];

  const toc = sections.map((s) =>
    `<li><span class="tn">${s.n}</span><span class="tt">${esc(s.title.toUpperCase())}</span></li>`).join("");

  const body = sections.map((s) => `
    <section class="sec">
      <div class="bar"><span class="num">${s.n}</span><h2>${esc(s.title.toUpperCase())}</h2></div>
      <div class="secbody">${s.body}</div>
    </section>`).join("");

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(playbookFileName(profile))}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  /* Invoca white + green. #00b388 is the brand green this repo already ships;
     #f8faf1 beside it is the pairing engine/mailer.ts uses. */
  :root { --g:#00b388; --g-deep:#00795f; --g-ink:#00624d; --ink:#15243e; --body:#343a40;
          --muted:#5b6577; --line:#e7e9eb; --wash:#f4fbf8; }
  * { box-sizing:border-box; }
  body { margin:0; background:#eef0f2; color:var(--body);
         font:15px/1.65 Lato,"Avenir","Museo Sans",system-ui,-apple-system,sans-serif; }
  .bartop { position:sticky; top:0; z-index:5; display:flex; align-items:center; justify-content:space-between;
            gap:16px; padding:10px 20px; background:#fff; border-bottom:1px solid var(--line); }
  .bartop span { font-size:13px; color:var(--muted); }
  .bartop button { font:inherit; font-size:13px; font-weight:700; cursor:pointer; color:#fff;
                   background:var(--g); border:0; border-radius:3px; padding:8px 16px; }
  .doc { max-width:840px; margin:24px auto 64px; background:#fff; }

  /* cover */
  .cover { padding:96px 72px 72px; border-top:8px solid var(--g); }
  .cover .brand { color:var(--g-ink); font-weight:700; font-size:17px; letter-spacing:.01em; }
  .cover h1 { font-size:52px; line-height:1.08; margin:14px 0 18px; color:var(--ink); font-weight:700; letter-spacing:-.01em; }
  .cover .lede { font-size:18px; color:var(--g-ink); margin:0 0 56px; }
  .meta { display:flex; gap:56px; border-top:1px solid var(--line); padding-top:20px; }
  .meta div span { display:block; font-size:11px; letter-spacing:.09em; text-transform:uppercase; color:var(--g-ink); font-weight:700; }
  .meta div b { display:block; font-size:15px; color:var(--ink); font-weight:700; margin-top:4px; }

  /* contents */
  .toc { padding:56px 72px 64px; }
  .toc h2 { font-size:13px; letter-spacing:.1em; text-transform:uppercase; color:#fff;
            background:var(--g); margin:0 0 22px; padding:11px 18px; border-radius:3px; }
  .toc ol { list-style:none; margin:0; padding:0; }
  .toc li { display:flex; gap:18px; align-items:baseline; padding:9px 4px; border-bottom:1px solid var(--line); }
  .tn { color:var(--g); font-weight:700; font-variant-numeric:tabular-nums; }
  .tt { font-size:14px; letter-spacing:.03em; color:var(--ink); }

  /* sections */
  .sec { padding:0 72px; break-inside:auto; }
  .sec:first-of-type { padding-top:8px; }
  .bar { display:flex; align-items:stretch; margin:44px 0 20px; border-radius:3px; overflow:hidden;
         background:var(--g); break-after:avoid; }
  .num { display:flex; align-items:center; padding:0 16px; background:var(--g-deep); color:#fff;
         font-weight:700; font-variant-numeric:tabular-nums; }
  .bar h2 { margin:0; padding:11px 18px; font-size:15px; font-weight:700; letter-spacing:.07em;
            text-transform:uppercase; color:#fff; }
  .secbody > :first-child { margin-top:0; }
  h3 { font-size:13px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
       color:var(--g-ink); margin:22px 0 8px; break-after:avoid; }
  p { margin:0 0 12px; }
  .lab { margin:0 0 6px; }
  .lab b { color:var(--ink); }
  ul { margin:0 0 14px; padding-left:20px; }
  li { margin:5px 0; }
  blockquote { margin:0 0 14px; padding:13px 18px; background:var(--wash);
               border-left:3px solid var(--g); border-radius:0 4px 4px 0; font-style:italic; color:var(--ink); }
  table { width:100%; border-collapse:collapse; margin:0 0 14px; }
  th { text-align:left; width:210px; font-weight:700; color:var(--ink); vertical-align:top; padding:8px 14px 8px 0;
       border-bottom:1px solid var(--line); }
  td { padding:8px 0; color:var(--muted); border-bottom:1px solid var(--line); vertical-align:top; }

  /* sample conversation */
  .chat { margin:0 0 14px; }
  .msg { position:relative; margin:0 0 8px; padding:10px 14px; border-radius:10px; max-width:86%; font-size:14px; }
  .msg .tag { display:block; font-size:10px; letter-spacing:.08em; text-transform:uppercase; font-weight:700; margin-bottom:3px; }
  .msg.a { background:var(--wash); border:1px solid #cdeee2; margin-right:auto; }
  .msg.a .tag { color:var(--g-ink); }
  .msg.c { background:#f5f6fa; border:1px solid var(--line); margin-left:auto; }
  .msg.c .tag { color:var(--muted); }

  .foot { margin:48px 72px 0; padding:14px 0 40px; border-top:2px solid var(--g);
          display:flex; justify-content:space-between; font-size:12px; color:var(--muted); }

  @media print {
    .bartop { display:none; }
    body { background:#fff; }
    .doc { margin:0; max-width:none; }
    .cover, .toc { break-after:page; }
    .sec { break-inside:auto; }
    .bar { break-after:avoid; }
  }
  @media (max-width:720px) {
    .cover, .toc, .sec { padding-left:24px; padding-right:24px; }
    .foot { margin-left:24px; margin-right:24px; }
    .cover h1 { font-size:36px; }
    .meta { gap:24px; flex-wrap:wrap; }
  }
</style></head>
<body>
  <div class="bartop">
    <span>${esc(playbookFileName(profile))}</span>
    <button onclick="window.print()">Save as PDF</button>
  </div>

  <div class="doc">
    <header class="cover">
      <div class="brand">${esc(brand)}</div>
      <h1>AI Agent<br>Training Playbook</h1>
      <p class="lede">Equip your messaging agent to qualify ${esc(noun)}s, handle objections and book ${esc(booking)}s.</p>
      <div class="meta">
        <div><span>Powered by</span><b>Invoca AI Agent Platform</b></div>
        <div><span>Version</span><b>1.0 — Demo Edition</b></div>
        <div><span>Prepared</span><b>${esc(today)}</b></div>
      </div>
    </header>

    <nav class="toc"><h2>Table of Contents</h2><ol>${toc}</ol></nav>

    ${body}

    <div class="foot"><span>Powered by Invoca · Confidential</span><span>${esc(brand)}</span></div>
  </div>
</body></html>`;
}
