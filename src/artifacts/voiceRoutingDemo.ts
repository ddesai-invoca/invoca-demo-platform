import type { VoiceRoutingDemo } from "../data/schema";

/* Renders the Voice Routing Demo artifact (animated live call-routing) as a
   self-contained HTML document. Shell/animation are fixed; caller, brand,
   attribution, queues and the turn-by-turn conversation are injected from `d`.
   Source shell: reference/gumloop/Voice Routing Demo.html. */

/* Escape for HTML text/attribute contexts. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* JSON for safe embedding in a <script> (prevents </script> break-out; the
   < still decodes to "<" at runtime so any <strong> in the data renders). */
function jsonSafe(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

const FILL_CLASSES = ["sales", "service", "support"];

export function renderVoiceRoutingDemo(d: VoiceRoutingDemo): string {
  const queueItems = d.queues
    .map((qz, i) => {
      const fill = FILL_CLASSES[i] ?? "support";
      return `      <div class="q-item">
        <div class="q-top"><span class="q-name" id="qn-${esc(qz.id)}">${esc(qz.name)}</span><span class="q-pct" id="qp-${esc(qz.id)}">—</span></div>
        <div class="q-track"><div class="q-fill ${fill}" id="qb-${esc(qz.id)}"></div></div>
      </div>`;
    })
    .join("\n");

  const winner = d.queues[0]?.name ?? "";
  const signalCount = d.convo.reduce((n, t) => n + t.sigs.length, 0);
  const queueIds = d.queues.map((q) => q.id);
  // The page JS reads each turn's `q` as an id→pct object (setQ does q[id]); the
  // schema stores it as an array aligned to queues[], so key it by id for injection.
  const convoForInject = d.convo.map((t) => ({
    role: t.role,
    text: t.text,
    sigs: t.sigs,
    q: Object.fromEntries(d.queues.map((qz, i) => [qz.id, t.q[i] ?? 0])),
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(d.brandName)} — Live Call Routing Demo</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');

  :root {
    --inv-green:#00B388; --inv-navy:#0B1B2B; --inv-dark:#0F2236;
    --inv-mid:#152D44; --inv-card:#1A3550;
    --blue:#4A9FE5; --gold:#E8B84B; --purple:#8B6CF6;
    --orange:#F5A623; --red:#EF5350; --teal:#26C6DA;
    --text-white:#F1F5F9; --text-light:#CBD5E1; --text-muted:#7B8FA3;
    --border-dark:rgba(255,255,255,.07); --surface:#0E1E30;
  }
  *{margin:0;padding:0;box-sizing:border-box;}
  body{
    font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;
    background:var(--inv-navy);color:var(--text-white);
    overflow:hidden;height:100vh;width:100vw;
  }
  .shell{
    display:grid;
    grid-template-columns:290px 1fr 330px;
    grid-template-rows:56px 1fr 64px;
    height:100vh;
  }
  /* ── Topbar ── */
  .topbar{
    grid-column:1/-1;background:var(--inv-dark);
    border-bottom:1px solid var(--border-dark);
    display:flex;align-items:center;justify-content:space-between;padding:0 20px;
  }
  .topbar-left{display:flex;align-items:center;gap:10px;}
  .inv-logo-icon{
    width:28px;height:28px;border-radius:6px;
    background:linear-gradient(135deg,var(--inv-green),#00D4A0);
    display:flex;align-items:center;justify-content:center;
  }
  .inv-logo-icon svg{width:16px;height:16px;fill:#0B2A1C;}
  .topbar-sep{width:1px;height:20px;background:var(--border-dark);margin:0 4px;}
  .topbar-badge{font-size:11px;font-weight:700;letter-spacing:.05em;color:var(--inv-green);text-transform:uppercase;}
  .topbar-right{display:flex;align-items:center;gap:12px;}
  .live-pill{
    display:flex;align-items:center;gap:6px;
    background:rgba(0,179,136,.15);border:1px solid rgba(0,179,136,.3);
    color:var(--inv-green);border-radius:99px;padding:3px 10px;
    font-size:11px;font-weight:600;opacity:0;transition:opacity .4s;
  }
  .live-dot{width:7px;height:7px;border-radius:50%;background:var(--inv-green);animation:blink 1.4s infinite;}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.35}}
  .timer-display{font-size:14px;font-weight:600;color:var(--text-muted);font-variant-numeric:tabular-nums;min-width:50px;text-align:right;}
  /* ── Left ── */
  .left{background:var(--inv-dark);border-right:1px solid var(--border-dark);padding:20px 16px;overflow-y:auto;}
  .section-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:14px;}
  .caller-hero{
    background:var(--inv-mid);border-radius:12px;padding:16px;margin-bottom:14px;
    opacity:0;transform:translateY(6px);transition:all .45s ease;
  }
  .caller-hero.show{opacity:1;transform:none;}
  .caller-ring{
    width:48px;height:48px;border-radius:50%;
    background:linear-gradient(135deg,var(--inv-green),#00D4A0);
    display:flex;align-items:center;justify-content:center;margin:0 auto 10px;
  }
  .caller-ring.ringing{animation:ringpulse 1.2s infinite;}
  @keyframes ringpulse{0%,100%{box-shadow:0 0 0 0 rgba(0,179,136,.5)}50%{box-shadow:0 0 0 12px rgba(0,179,136,0)}}
  .caller-ring svg{width:22px;height:22px;fill:#0B2A1C;}
  .caller-info{text-align:center;}
  .caller-info h3{font-size:15px;font-weight:700;margin-bottom:2px;}
  .caller-info p{font-size:12px;color:var(--text-muted);}
  .brand-card{
    background:var(--inv-mid);border-radius:10px;padding:12px 14px;
    display:flex;align-items:center;gap:10px;margin-bottom:14px;
    opacity:0;transform:translateY(6px);transition:all .4s ease .1s;
  }
  .brand-card.show{opacity:1;transform:none;}
  .brand-icon{font-size:22px;line-height:1;}
  .brand-detail h4{font-size:13px;font-weight:700;}
  .brand-detail p{font-size:11px;color:var(--text-muted);}
  .id-badge{
    display:inline-flex;align-items:center;gap:5px;
    background:rgba(0,179,136,.12);border:1px solid rgba(0,179,136,.3);
    border-radius:99px;padding:3px 10px;font-size:11px;font-weight:600;
    color:var(--inv-green);margin-bottom:14px;
    opacity:0;transform:translateY(4px);transition:all .35s ease;
  }
  .id-badge.show{opacity:1;transform:none;}
  .attr-group{margin-bottom:6px;}
  .attr-row{
    display:flex;align-items:flex-start;gap:8px;
    padding:7px 0;border-bottom:1px solid var(--border-dark);
    opacity:0;transform:translateX(-6px);transition:all .3s ease;
  }
  .attr-row:last-child{border-bottom:none;}
  .attr-row.show{opacity:1;transform:none;}
  .attr-row.hl .attr-v{color:var(--inv-green);font-weight:600;}
  .attr-k{min-width:90px;flex-shrink:0;font-size:11px;color:var(--text-muted);}
  .attr-v{flex:1;text-align:right;font-size:11px;line-height:1.4;}
  /* ── Center ── */
  .center{background:var(--surface);display:flex;flex-direction:column;position:relative;overflow:hidden;}
  .conv-head{padding:14px 18px;border-bottom:1px solid var(--border-dark);display:flex;align-items:center;gap:10px;flex-shrink:0;}
  .wave{height:32px;display:flex;align-items:center;gap:2px;padding:0 4px;}
  .wbar{width:3px;min-height:3px;border-radius:2px;background:var(--inv-green);opacity:.2;transition:height .07s,opacity .07s;}
  .wave.on .wbar{opacity:1;}
  .msg-area{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:14px;}
  .msg{display:flex;gap:10px;opacity:0;transform:translateY(8px);transition:all .35s ease;}
  .msg.vis{opacity:1;transform:none;}
  .msg.agent{flex-direction:row-reverse;}
  .avi{width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:16px;background:var(--inv-mid);}
  .msg-body{max-width:78%;}
  .msg-who{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;}
  .msg.agent .msg-who{text-align:right;}
  .bubble{background:var(--inv-mid);border-radius:12px;padding:10px 13px;font-size:13px;line-height:1.5;}
  .msg.caller .bubble{border-top-left-radius:3px;}
  .msg.agent .bubble{background:rgba(0,179,136,.15);border:1px solid rgba(0,179,136,.2);border-top-right-radius:3px;}
  .ai-tag{
    display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;
    border-radius:99px;padding:2px 8px;margin-top:5px;margin-right:4px;
    opacity:0;transform:scale(.9);transition:all .2s ease;
  }
  .ai-tag.vis{opacity:1;transform:scale(1);}
  .ai-tag.intent{background:rgba(0,179,136,.15);color:var(--inv-green);border:1px solid rgba(0,179,136,.3);}
  .ai-tag.signal{background:rgba(74,159,229,.15);color:var(--blue);border:1px solid rgba(74,159,229,.3);}
  .ai-tag.sentiment{background:rgba(139,108,246,.15);color:var(--purple);border:1px solid rgba(139,108,246,.3);}
  .ai-tag.upsell{background:rgba(232,184,75,.15);color:var(--gold);border:1px solid rgba(232,184,75,.3);}
  .ai-tag.issue{background:rgba(239,83,80,.15);color:var(--red);border:1px solid rgba(239,83,80,.3);}
  .dots-wrap{padding:10px 18px;display:flex;align-items:center;gap:6px;min-height:36px;}
  .dots{display:none;}
  .dots.on{display:flex;gap:5px;}
  .dots span{width:7px;height:7px;border-radius:50%;background:var(--text-muted);animation:bounce .9s infinite;}
  .dots span:nth-child(2){animation-delay:.15s;}
  .dots span:nth-child(3){animation-delay:.3s;}
  @keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}
  .ai-think-bar{padding:6px 18px;display:flex;align-items:center;gap:8px;background:rgba(0,179,136,.06);border-top:1px solid rgba(0,179,136,.1);min-height:32px;}
  .ai-think{display:none;}
  .ai-think.on{display:flex;align-items:center;gap:8px;}
  .spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(0,179,136,.2);border-top-color:var(--inv-green);animation:spin .8s linear infinite;flex-shrink:0;}
  @keyframes spin{to{transform:rotate(360deg)}}
  .ai-think span{font-size:11px;color:var(--text-muted);}
  /* ── Right ── */
  .right{background:var(--inv-dark);border-left:1px solid var(--border-dark);padding:20px 16px;overflow-y:auto;display:flex;flex-direction:column;gap:16px;}
  .rcard{background:var(--inv-mid);border-radius:12px;padding:14px;}
  .rcard-head{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
  .rcard-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .rcard-icon svg{width:16px;height:16px;fill:#fff;}
  .rcard-title{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted);}
  .q-item{margin-bottom:12px;}
  .q-item:last-child{margin-bottom:0;}
  .q-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;}
  .q-name{font-size:11px;color:var(--text-light);}
  .q-pct{font-size:11px;font-weight:700;color:var(--text-muted);}
  .q-name.sel,.q-pct.sel{color:var(--inv-green);}
  .q-track{height:6px;background:rgba(255,255,255,.07);border-radius:3px;overflow:hidden;}
  .q-fill{height:100%;border-radius:3px;width:0;transition:width .6s cubic-bezier(.4,0,.2,1);}
  .q-fill.sales{background:var(--gold);}
  .q-fill.service{background:var(--blue);}
  .q-fill.support{background:var(--orange);}
  .q-fill.sel{background:var(--inv-green);}
  .sig{display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-dark);opacity:0;transform:translateX(6px);transition:all .3s ease;}
  .sig:last-child{border-bottom:none;}
  .sig.vis{opacity:1;transform:none;}
  .sig-dot{font-size:10px;margin-top:1px;flex-shrink:0;}
  .sig-dot.green{color:var(--inv-green);}
  .sig-dot.blue{color:var(--blue);}
  .sig-dot.orange{color:var(--orange);}
  .sig-dot.red{color:var(--red);}
  .sig-dot.purple{color:var(--purple);}
  .sig-txt{font-size:11px;line-height:1.45;}
  /* ── Bot bar ── */
  .bot{
    grid-column:1/-1;background:var(--inv-dark);border-top:1px solid var(--border-dark);
    display:flex;align-items:center;justify-content:center;gap:14px;padding:0 20px;
  }
  .btn{padding:8px 22px;border-radius:8px;font-size:12px;font-weight:700;border:none;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:6px;font-family:'Inter',sans-serif;}
  .btn-go{background:#19D27D;color:#0B2A1C;border-radius:999px;padding:0 20px;box-shadow:0 0 0 3px rgba(25,210,125,.25);font-weight:700;min-width:44px;height:38px;}
  .btn-go:hover{background:#15bc6e;box-shadow:0 0 0 5px rgba(25,210,125,.2);}
  .btn-go:disabled{opacity:.45;cursor:not-allowed;}
  .btn-rst{background:rgba(255,255,255,.07);color:var(--text-light);border:1px solid var(--border-dark);height:38px;}
  .btn-rst:hover{background:rgba(255,255,255,.12);}
  .spd{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);}
  .spd select{background:var(--inv-mid);color:var(--text-light);border:1px solid var(--border-dark);border-radius:6px;padding:4px 8px;font-size:11px;font-family:'Inter',sans-serif;cursor:pointer;}
  /* ── Overlay ── */
  .overlay{position:absolute;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .4s;z-index:10;}
  .overlay.on{opacity:1;pointer-events:all;}
  .routed-card{background:#fff;border-radius:20px;padding:36px 44px;text-align:center;box-shadow:0 24px 80px rgba(0,0,0,.18);transform:scale(.85);opacity:0;transition:all .5s cubic-bezier(.22,1,.36,1);position:relative;max-width:340px;width:90%;}
  .routed-card.vis{transform:scale(1);opacity:1;}
  .routed-close{position:absolute;top:14px;right:14px;width:28px;height:28px;border-radius:50%;border:none;background:#F1F5F9;cursor:pointer;display:flex;align-items:center;justify-content:center;}
  .routed-close:hover{background:#E2E8F0;}
  .routed-check{width:52px;height:52px;border-radius:50%;background:#19D27D;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;}
  .routed-check svg{width:28px;height:28px;fill:#fff;}
  .routed-card h2{font-size:20px;font-weight:800;color:#0B2A1C;margin-bottom:6px;}
  .routed-card .sub{font-size:12px;color:#64748B;margin-bottom:20px;line-height:1.5;}
  .queue-badge{display:inline-flex;align-items:center;gap:8px;background:#F1F5F9;border-radius:10px;padding:10px 16px;font-size:13px;font-weight:700;color:#0B2A1C;margin-bottom:20px;}
  .queue-badge svg{color:#19D27D;}
  .routed-stats{display:flex;gap:28px;justify-content:center;margin-top:18px;padding-top:18px;border-top:1px solid #E2E8F0;}
  .routed-stat{text-align:center;}
  .routed-stat h4{font-size:20px;font-weight:800;color:#0B2A1C;}
  .routed-stat span{font-size:11px;color:#64748B;}
</style>
</head>
<body>
<div class="shell">

  <!-- TOPBAR -->
  <div class="topbar">
    <div class="topbar-left">
      <div class="inv-logo-icon"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
      <div class="topbar-sep"></div>
      <div class="topbar-badge">AI Voice Agent</div>
    </div>
    <div class="topbar-right">
      <div class="live-pill" id="livePill"><div class="live-dot"></div>Live Call</div>
      <div class="timer-display" id="timer">00:00</div>
    </div>
  </div>

  <!-- LEFT — CALLER INTELLIGENCE -->
  <div class="left">
    <div class="section-label">Caller Intelligence</div>

    <div class="caller-hero" id="callerHero">
      <div class="caller-ring" id="callerRing">
        <svg viewBox="0 0 24 24"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
      </div>
      <div class="caller-info">
        <h3>${esc(d.callerPhone)}</h3>
        <p>${esc(d.callerLocation)}</p>
      </div>
    </div>

    <div class="brand-card" id="brandCard">
      <div class="brand-icon">${esc(d.brandIcon)}</div>
      <div class="brand-detail">
        <h4>${esc(d.brandName)}</h4>
        <p>${esc(d.brandDomain)}</p>
      </div>
    </div>

    <div class="id-badge" id="idBadge">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
      ${esc(d.idBadge)}
    </div>

    <div class="section-label">Attribution</div>
    <div class="attr-group" id="attrGroup"></div>

    <div class="section-label" style="margin-top:14px;">Visitor History</div>
    <div class="attr-group" id="attrGroup2"></div>
  </div>

  <!-- CENTER — CONVERSATION -->
  <div class="center">
    <div class="conv-head">
      <div class="wave" id="wave"></div>
    </div>
    <div class="msg-area" id="msgArea"></div>
    <div class="dots-wrap">
      <div class="dots" id="dots"><span></span><span></span><span></span></div>
    </div>
    <div class="ai-think-bar">
      <div class="ai-think" id="aiThink"><div class="spin"></div><span>Analyzing conversation…</span></div>
    </div>
    <div class="overlay" id="overlay">
      <div class="routed-card" id="routedCard">
        <button class="routed-close" onclick="closeRouting()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <div class="routed-check"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg></div>
        <h2>Caller Routed</h2>
        <p class="sub">${esc(d.routedSubtitle)}</p>
        <div class="queue-badge">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          ${esc(winner)}
        </div>
        <div class="routed-stats">
          <span id="finalTime" style="display:none"></span>
          <div class="routed-stat"><h4>${signalCount}</h4><span>Signals</span></div>
        </div>
      </div>
    </div>
  </div>

  <!-- RIGHT — AI ROUTING ENGINE -->
  <div class="right">
    <div class="section-label">AI Routing Engine</div>
    <div class="rcard">
      <div class="rcard-head">
        <div class="rcard-icon" style="background:linear-gradient(135deg,var(--purple),var(--blue))">
          <svg viewBox="0 0 24 24"><path d="M12 2a9 9 0 00-9 9c0 3.07 1.64 5.64 4 7.28V21a1 1 0 001 1h8a1 1 0 001-1v-2.72A8.96 8.96 0 0021 11a9 9 0 00-9-9z"/></svg>
        </div>
        <div class="rcard-title">Queue Probability</div>
      </div>
      <div class="ai-think" id="aiThinkQ"><div class="spin"></div><span>Analyzing…</span></div>
${queueItems}
    </div>
    <div class="rcard">
      <div class="rcard-head">
        <div class="rcard-icon" style="background:linear-gradient(135deg,var(--orange),#F5C842)">
          <svg viewBox="0 0 24 24"><path d="M12 2L1 21h22L12 2zm0 4l7.53 13H4.47L12 6z"/></svg>
        </div>
        <div class="rcard-title">Signals Detected</div>
      </div>
      <div id="sigArea"></div>
    </div>
  </div>

  <!-- BOTTOM BAR -->
  <div class="bot">
    <button class="btn btn-go" id="playBtn" onclick="go()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    </button>
    <button class="btn btn-rst" onclick="reset()">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
      Reset
    </button>
    <div class="spd">Speed
      <select id="spdSel">
        <option value="1.6">0.5×</option>
        <option value="1" selected>1×</option>
        <option value="0.55">1.5×</option>
        <option value="0.28">3×</option>
      </select>
    </div>
  </div>

</div>
<script>
// ── DATA (injected by generator) ──
const ATTR1 = ${jsonSafe(d.attribution)};
const ATTR2 = ${jsonSafe(d.visitorHistory)};
const CONVO = ${jsonSafe(convoForInject)};
const QUEUES = ${jsonSafe(queueIds)};

// ── State ──
let playing=false, tmo=null, secs=0, tInt=null;

// ── Waveform ──
const waveEl = document.getElementById('wave');
for(let i=0;i<80;i++){const b=document.createElement('div');b.className='wbar';waveEl.appendChild(b);}
let wId;
function waveOn(){waveEl.classList.add('on');wTick();}
function wTick(){waveEl.querySelectorAll('.wbar').forEach(b=>{b.style.height=(3+Math.random()*18)+'px';b.style.opacity=.25+Math.random()*.7;});wId=requestAnimationFrame(()=>setTimeout(wTick,70));}
function waveOff(){cancelAnimationFrame(wId);waveEl.classList.remove('on');waveEl.querySelectorAll('.wbar').forEach(b=>{b.style.height='3px';b.style.opacity='.2';});}

// ── Timer ──
function startTimer(){secs=0;tInt=setInterval(()=>{secs++;document.getElementById('timer').textContent=String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0');},1000);}
function stopTimer(){clearInterval(tInt);}

// ── Queues ──
function setQ(q){QUEUES.forEach(k=>{const pct=q[k]||0;document.getElementById('qb-'+k).style.width=pct+'%';document.getElementById('qp-'+k).textContent=pct+'%';});}
function hlQ(k){QUEUES.forEach(x=>{const on=x===k;['qb-','qp-','qn-'].forEach(p=>{document.getElementById(p+x).classList.toggle('sel',on);});});}

// ── Build attribution rows dynamically ──
function buildAttrRows(items, containerId, dataAttr) {
  const container = document.getElementById(containerId);
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'attr-row' + (item.highlight ? ' hl' : '');
    row.setAttribute(dataAttr, '');
    row.innerHTML = \`<span class="attr-k">\${item.label}</span><span class="attr-v">\${item.value}</span>\`;
    container.appendChild(row);
  });
}
buildAttrRows(ATTR1, 'attrGroup',  'data-attr');
buildAttrRows(ATTR2, 'attrGroup2', 'data-attr2');

// ── Messages ──
function addMsg(m){
  const a=document.getElementById('msgArea');
  const d=document.createElement('div');d.className='msg '+m.role;
  const av=m.role==='caller'?'👤':'🤖';
  let tg='';if(m.tags&&m.tags.length)tg=m.tags.map(t=>\`<div class="ai-tag \${t.type}">⚡ \${t.label}</div>\`).join('');
  d.innerHTML=\`<div class="avi">\${av}</div><div class="msg-body"><div class="msg-who">\${m.role==='caller'?'Caller':'AI Agent'}</div><div class="bubble">\${m.text}</div>\${tg}</div>\`;
  a.appendChild(d);
  requestAnimationFrame(()=>{d.classList.add('vis');a.scrollTop=a.scrollHeight;});
  setTimeout(()=>d.querySelectorAll('.ai-tag').forEach((t,i)=>setTimeout(()=>t.classList.add('vis'),i*180)),350);
}

// ── Signals ──
function addSigs(sigs){
  const a=document.getElementById('sigArea');
  (sigs||[]).forEach((s,i)=>{
    const d=document.createElement('div');d.className='sig';
    d.innerHTML=\`<div class="sig-dot \${s.c}">●</div><div class="sig-txt">\${s.t}</div>\`;
    a.appendChild(d);setTimeout(()=>d.classList.add('vis'),i*180+250);
  });
}

// ── Speed ──
function spd(){return parseFloat(document.getElementById('spdSel').value);}

// ── Attribution reveal ──
function showAttr(){
  const s=spd();
  document.getElementById('callerHero').classList.add('show');
  document.getElementById('callerRing').classList.add('ringing');
  document.getElementById('brandCard').classList.add('show');
  document.querySelectorAll('[data-attr]').forEach((r,i)=>setTimeout(()=>r.classList.add('show'),i*40*s));
  setTimeout(()=>document.getElementById('idBadge').classList.add('show'),300*s);
  document.querySelectorAll('[data-attr2]').forEach((r,i)=>setTimeout(()=>r.classList.add('show'),(350+i*40)*s));
}

// ── Step ──
function step(idx){
  if(idx>=CONVO.length){
    setTimeout(()=>{
      hlQ(QUEUES[0]);
      document.getElementById('aiThink').classList.remove('on');
      waveOff();
      document.getElementById('callerRing').classList.remove('ringing');
      setTimeout(()=>{
        document.getElementById('finalTime').textContent=secs+'s';
        document.getElementById('overlay').classList.add('on');
        setTimeout(()=>document.getElementById('routedCard').classList.add('vis'),80);
        stopTimer();playing=false;document.getElementById('playBtn').disabled=false;
      },700*spd());
    },1200*spd());
    return;
  }
  const m=CONVO[idx],s=spd();
  document.getElementById('dots').classList.add('on');
  document.getElementById('aiThink').classList.add('on');
  setTimeout(()=>{
    document.getElementById('dots').classList.remove('on');
    addMsg(m);
    setTimeout(()=>{setQ(m.q);addSigs(m.sigs);},250*s);
    tmo=setTimeout(()=>step(idx+1),2200*s);
  },1300*s);
}

// ── Go ──
function go(){
  if(playing)return;
  playing=true;
  document.getElementById('playBtn').disabled=true;
  document.getElementById('livePill').style.opacity='1';
  showAttr();waveOn();startTimer();
  const initQ={};QUEUES.forEach(k=>initQ[k]=Math.round(100/QUEUES.length));
  setTimeout(()=>{setQ(initQ);step(0);},600*spd());
}

// ── Close routing card ──
function closeRouting(){
  document.getElementById('overlay').classList.remove('on');
  document.getElementById('routedCard').classList.remove('vis');
}

// ── Reset ──
function reset(){
  playing=false;clearTimeout(tmo);stopTimer();waveOff();
  document.getElementById('timer').textContent='00:00';
  document.getElementById('livePill').style.opacity='0';
  document.getElementById('playBtn').disabled=false;
  document.getElementById('msgArea').innerHTML='';
  document.getElementById('sigArea').innerHTML='';
  document.getElementById('dots').classList.remove('on');
  document.getElementById('aiThink').classList.remove('on');
  document.getElementById('overlay').classList.remove('on');
  document.getElementById('routedCard').classList.remove('vis');
  document.getElementById('callerHero').classList.remove('show');
  document.getElementById('callerRing').classList.remove('ringing');
  document.getElementById('brandCard').classList.remove('show');
  document.getElementById('idBadge').classList.remove('show');
  document.querySelectorAll('[data-attr],[data-attr2]').forEach(r=>r.classList.remove('show'));
  const zeroQ={};QUEUES.forEach(k=>zeroQ[k]=0);
  setQ(zeroQ);
  QUEUES.forEach(k=>document.getElementById('qp-'+k).textContent='—');
  hlQ(null);
}
reset();
</script>
</body>
</html>`;
}
