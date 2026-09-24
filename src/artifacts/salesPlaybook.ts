import type { CustomerProfile } from "../data/schema";

/* =============================================================================
   salesPlaybook.ts — the document behind "<Prospect>_Sales_Playbook.pdf"
   -----------------------------------------------------------------------------
   Every profile's Knowledge Sources table lists a playbook document, and until
   now no such file existed — the row was a name with nothing behind it. Asked
   for directly: *"for the PDF it opens the playbook"*.

   ⚠️⚠️ **IT IS DERIVED FROM THE AGENT'S REAL CONFIG, NOT WRITTEN.** Every line
   on the page is something this prospect's agent actually uses: the greeting it
   opens with, the qualifying questions it asks IN ORDER, the offer it makes, the
   brand conversation rules that govern its tone, its service area, and the Q&A
   pairs generated from that prospect's own call transcripts. So the document is
   a true rendering of the thing the table claims the agent learned from —
   nobody's invented sales copy. It is also why it re-skins for all 91 profiles
   for free, with no engine phase and no schema change.
   ⚠️ SECTIONS WITH NO DATA ARE OMITTED, never padded. A prospect with no offer
   genuinely runs no promotion (measured: 5 of 15 on the healthcare accounts),
   and an empty "Current Offer" heading reads as a broken document.

   ⚠️⚠️ **IT IS HTML IN A NEW TAB, NOT A GENERATED PDF, AND THAT IS A BUNDLE
   DECISION.** This app ships as ONE chunk with no code splitting (load-bearing
   for the service worker), so a PDF library lands on every page load for a
   button most sessions never press. It reuses the Blob-URL mechanism the three
   Gumloop artifacts already use (`src/artifacts/index.ts`), which is the
   established way this repo opens a standalone document. `window.print()` is
   wired to the header so anyone who genuinely needs a file can save one.
   ============================================================================= */

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const list = (items: string[]) => items.map((i) => `<li>${esc(i)}</li>`).join("");

/** The filename the Knowledge Sources table shows for this prospect. */
export const playbookFileName = (profile: CustomerProfile): string =>
  `${profile.customerName.replace(/[^A-Za-z0-9]+/g, "_")}_Sales_Playbook.pdf`;

export function renderSalesPlaybook(profile: CustomerProfile): string {
  const ac = profile.reports.agentConfig;
  const pb = ac?.smsPlaybook;
  const rules = ac?.brandConversationRules ?? [];
  /* The Q&A the agent answers from — the same pairs the AI Recommendations
     screen opens in its edit modal, so the two cannot disagree. */
  const qa = (ac?.aiRecommendations ?? []).flatMap((r) => r.qaPairs ?? []).slice(0, 12);

  const section = (title: string, body: string) =>
    body ? `<section><h2>${esc(title)}</h2>${body}</section>` : "";

  const facts: [string, string | undefined][] = [
    ["Industry", profile.industry],
    ["Website", profile.brandDomain],
    ["Books", pb?.bookingType],
    ["Conversation goal", pb?.goal],
    ["Service area", ac?.serviceArea],
    ["Quotes a price over text", pb ? (pb.providesEstimate ? "Yes" : "No — defers to a specialist") : undefined],
  ];
  const factRows = facts
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v!)}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(playbookFileName(profile))}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { --ink:#15243e; --muted:#5b6577; --line:#e7e9eb; --accent:#2666f9; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f6f7f9; color:var(--ink);
         font:16px/1.6 Lato,system-ui,-apple-system,"Segoe UI",sans-serif; }
  .bar { position:sticky; top:0; display:flex; align-items:center; justify-content:space-between;
         gap:16px; padding:10px 20px; background:#fff; border-bottom:1px solid var(--line); }
  .bar span { font-size:13px; color:var(--muted); }
  .bar button { font:inherit; font-size:13px; font-weight:700; cursor:pointer; color:#fff;
                background:var(--accent); border:0; border-radius:3px; padding:8px 14px; }
  .paper { max-width:760px; margin:28px auto 64px; background:#fff; border:1px solid var(--line);
           border-radius:6px; padding:56px 64px; box-shadow:0 1px 1px rgba(0,0,0,.06),0 1px 5px rgba(0,0,0,.06); }
  .eyebrow { font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); }
  h1 { font-size:30px; line-height:1.25; margin:6px 0 4px; }
  .sub { color:var(--muted); margin:0 0 28px; }
  h2 { font-size:15px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
       color:var(--muted); margin:34px 0 10px; padding-bottom:6px; border-bottom:1px solid var(--line); }
  ol,ul { margin:0; padding-left:22px; }
  li { margin:6px 0; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; width:210px; font-weight:700; vertical-align:top; padding:7px 12px 7px 0; }
  td { padding:7px 0; color:var(--muted); }
  .quote { margin:0; padding:14px 18px; background:#f8faf1; border-left:3px solid #00b388;
           border-radius:0 6px 6px 0; }
  .qa { margin:14px 0; }
  .qa p { margin:0; }
  .qa .q { font-weight:700; }
  .qa .a { color:var(--muted); }
  .foot { margin-top:40px; padding-top:14px; border-top:1px solid var(--line);
          font-size:12px; color:var(--muted); }
  @media print { .bar { display:none; } body { background:#fff; }
                 .paper { border:0; box-shadow:none; margin:0; max-width:none; padding:0; } }
</style></head>
<body>
  <div class="bar">
    <span>${esc(playbookFileName(profile))}</span>
    <button onclick="window.print()">Save as PDF</button>
  </div>
  <article class="paper">
    <div class="eyebrow">AI Agent Playbook</div>
    <h1>${esc(profile.customerName)}</h1>
    <p class="sub">What the agent knows, asks and aims for on every conversation.</p>

    ${section("At a glance", factRows ? `<table>${factRows}</table>` : "")}
    ${pb?.greeting ? section("Opening message", `<blockquote class="quote">${esc(pb.greeting)}</blockquote>`) : ""}
    ${pb?.qualifyingQuestions?.length
      ? section("Qualifying questions", `<p class="sub" style="margin:0 0 10px">Asked one at a time, in this order.</p><ol>${list(pb.qualifyingQuestions)}</ol>`)
      : ""}
    ${pb?.offer?.trim() ? section("Current offer", `<blockquote class="quote">${esc(pb.offer)}</blockquote>`) : ""}
    ${rules.length ? section("Brand conversation rules", `<ul>${list(rules)}</ul>`) : ""}
    ${qa.length
      ? section("Common questions", qa.map((p) =>
          `<div class="qa"><p class="q">${esc(p.question)}</p><p class="a">${esc(p.answer)}</p></div>`).join(""))
      : ""}

    <p class="foot">Generated from ${esc(profile.customerName)}’s agent configuration in Invoca Agent Studio.</p>
  </article>
</body></html>`;
}
