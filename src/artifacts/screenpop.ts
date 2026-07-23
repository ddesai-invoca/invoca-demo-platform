/* Shared renderer for the CTI "screen pop" artifacts (Voice Screenpop and SMS
   Screenpop). Both use the identical agent-desktop shell with Invoca Pre-Call
   Intelligence; only a handful of channel-specific strings differ. The voice/
   sms wrappers (voiceScreenpop.ts / smsScreenpop.ts) map their typed data slice
   onto ScreenpopCore and call renderScreenpop().
   Source shells: reference/gumloop/{Voice,SMS} Screenpop.html. */

export interface ScreenpopCore {
  brandName: string;
  callerName: string;
  callerPhone: string;
  campaign: string;
  tagGreen: string;
  tagBlue: string;
  estimatedValue: string;
  googleSearch: string;
  websiteSearch: string;
  callingWebpage: string;
  products: string;
  cartId: string;
  serviceable: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  digitalJourney: string;
  intent: string;
  coverage: string;
  // Channel-specific bits
  channelTitle: string;        // "Inbound Call" | "Inbound SMS"
  aiSectionLabel: string;      // "AI Voice Agent" | "AI SMS Agent"
  thirdRowLabel: string;       // "Switch Intent" | "Appointment"
  thirdRowValue: string;
  overlayEmoji: string;        // "📞" | "💬"
  overlayTitle: string;        // "Call Connected" | "SMS Connected"
  overlaySubtitle: string;     // "You're now speaking with X." | "Continuing SMS conversation with X."
  greetingLabel: string;       // "Suggested Greeting:" | "Suggested Reply:"
  greeting: string;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/* Escape for safe insertion into HTML text/attribute contexts. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderScreenpop(d: ScreenpopCore): string {
  const brandInitial = (d.brandName.trim()[0] ?? "C").toUpperCase();
  const callerInitials = initials(d.callerName) || "--";
  const b = esc;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>${b(d.brandName)} — ${b(d.channelTitle)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Open Sans', sans-serif; background: #f0f2f5; color: #1e293b; height: 100vh; overflow: hidden; }
  .app { display: flex; height: 100vh; }

  /* Sidebar */
  .sidebar { width: 56px; background: #ffffff; display: flex; flex-direction: column; align-items: center; padding-top: 12px; border-right: 1px solid #e2e8f0; z-index: 10; }
  .sidebar .logo { width: 32px; height: 32px; background: linear-gradient(135deg, #0E7C7B, #16A394); border-radius: 8px; margin-bottom: 24px; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; font-size: 14px; }
  .sidebar .nav-item { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; border-radius: 10px; margin-bottom: 6px; cursor: pointer; color: #94a3b8; transition: all .2s; position: relative; }
  .sidebar .nav-item:hover { background: #f1f5f9; color: #475569; }
  .sidebar .nav-item.active { background: #f0fdf4; color: #0E7C7B; }
  .sidebar .nav-item .badge { position: absolute; top: 4px; right: 4px; width: 16px; height: 16px; background: #ef4444; border-radius: 50%; font-size: 9px; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }

  /* Left Panel */
  .left-panel { width: 280px; background: #ffffff; border-right: 1px solid #e2e8f0; display: flex; flex-direction: column; }
  .left-header { padding: 16px; border-bottom: 1px solid #e2e8f0; }
  .left-header h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; margin-bottom: 8px; }
  .caller-id { padding: 20px 16px; text-align: center; border-bottom: 1px solid #e2e8f0; }
  .caller-id .direction { font-size: 12px; color: #0891b2; margin-bottom: 2px; }
  .caller-id .phone { font-size: 26px; font-weight: 700; color: #0f172a; letter-spacing: .5px; }
  .caller-id .name { font-size: 14px; color: #64748b; margin-top: 2px; }

  .media-controls { padding: 16px; border-bottom: 1px solid #e2e8f0; }
  .media-controls .section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 10px; }
  .ctrl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ctrl-btn { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; text-align: center; cursor: pointer; transition: all .15s; color: #64748b; font-size: 12px; }
  .ctrl-btn:hover { background: #f1f5f9; border-color: #cbd5e1; color: #334155; }
  .ctrl-btn svg { display: block; margin: 0 auto 4px; }
  .ctrl-btn.wide { grid-column: span 2; }

  .queue-section { padding: 16px; flex: 1; }
  .queue-section .section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 8px; }
  .queue-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #64748b; margin-bottom: 6px; }

  .end-call-area { padding: 16px; }
  .end-call-btn { width: 100%; padding: 12px; background: #dc2626; border: none; border-radius: 10px; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; transition: background .15s; display: none; align-items: center; justify-content: center; gap: 8px; }
  .end-call-btn:hover { background: #b91c1c; }

  /* Main */
  .main { flex: 1; display: flex; flex-direction: column; position: relative; }
  .top-bar { height: 48px; background: #ffffff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; }
  .status-pill { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px; }
  .status-pill.ready { background: #f0fdf4; color: #16a34a; }
  .status-pill.oncall { background: #f0fdf4; color: #0E7C7B; }
  .status-pill .dot { width: 7px; height: 7px; border-radius: 50%; }
  .status-pill.ready .dot { background: #16a34a; }
  .status-pill.oncall .dot { background: #0E7C7B; animation: pulse-dot 1.5s infinite; }
  .top-right { display: flex; align-items: center; gap: 16px; }
  .top-right .time { font-size: 12px; color: #94a3b8; font-variant-numeric: tabular-nums; }
  .top-right .icon-btn { width: 32px; height: 32px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #94a3b8; }
  .main-content { flex: 1; position: relative; overflow: hidden; }

  /* Ringing */
  #ringingState { position: absolute; inset: 0; display: flex; align-items: stretch; justify-content: center; z-index: 5; background: #f8fafc; }
  .ring-left { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; position: relative; overflow: hidden; }
  .ring-bg { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(26,76,138,.05) 0%, transparent 60%); pointer-events: none; }
  .ring-pulse { position: absolute; left: calc(50% - 100px); top: calc(50% - 100px); width: 200px; height: 200px; border-radius: 50%; border: 2px solid rgba(26,76,138,.15); animation: ring-expand 2s ease-out infinite; pointer-events: none; }
  .ring-pulse:nth-child(2) { animation-delay: .66s; }
  .ring-pulse:nth-child(3) { animation-delay: 1.33s; }
  @keyframes ring-expand { 0% { transform: scale(.5); opacity: 1; } 100% { transform: scale(2.5); opacity: 0; } }
  .ring-avatar { width: 96px; height: 96px; border-radius: 50%; background: linear-gradient(135deg, #0E7C7B, #16A394); display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 700; color: #fff; z-index: 2; box-shadow: 0 4px 24px rgba(26,76,138,.25); margin-bottom: 16px; }
  .ring-name { font-size: 24px; font-weight: 700; color: #0f172a; z-index: 2; }
  .ring-phone { font-size: 14px; color: #64748b; z-index: 2; margin-top: 2px; }
  .ring-label { font-size: 13px; color: #0E7C7B; z-index: 2; margin-top: 12px; font-weight: 600; letter-spacing: .5px; animation: blink 1.2s step-end infinite; }
  @keyframes blink { 50% { opacity: .3; } }
  .ring-actions { display: flex; gap: 24px; margin-top: 32px; z-index: 2; }
  .ring-action-btn { width: 64px; height: 64px; border-radius: 50%; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform .15s, box-shadow .15s; }
  .ring-action-btn:hover { transform: scale(1.1); }
  .ring-action-btn.accept { background: #0E7C7B; box-shadow: 0 4px 20px rgba(26,76,138,.35); }
  .ring-action-btn.accept:hover { box-shadow: 0 4px 28px rgba(26,76,138,.5); }
  .ring-action-btn.decline { background: #dc2626; box-shadow: 0 4px 20px rgba(220,38,38,.25); }
  .ring-icon-animated svg { animation: wiggle .4s ease-in-out infinite; transform-origin: center top; }
  @keyframes wiggle { 0%,100% { transform: rotate(0); } 25% { transform: rotate(12deg); } 75% { transform: rotate(-12deg); } }

  /* Pre-Call Panel */
  .precall-panel { flex: 1; max-width: 440px; background: #ffffff; border-left: 1px solid #e2e8f0; z-index: 20; overflow: hidden; animation: slideIn .4s ease-out; display: flex; flex-direction: column; }
  @keyframes slideIn { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  .precall-header { background: linear-gradient(135deg, #0E7C7B, #16A394); padding: 14px 18px; display: flex; align-items: center; gap: 10px; }
  .precall-header svg { flex-shrink: 0; }
  .precall-header .title { font-size: 13px; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: .8px; }
  .precall-header .powered { font-size: 10px; color: rgba(255,255,255,.75); margin-left: auto; }
  .precall-body { padding: 16px 18px; flex: 1; overflow-y: auto; }
  .precall-campaign { font-size: 11px; color: #0E7C7B; margin-bottom: 2px; }
  .precall-caller { font-size: 18px; font-weight: 700; color: #0f172a; }
  .precall-meta { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
  .precall-tag { font-size: 11px; padding: 4px 10px; border-radius: 20px; font-weight: 600; }
  .precall-tag.green { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
  .precall-tag.blue { background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }
  .precall-divider { height: 1px; background: #e2e8f0; margin: 12px 0; }
  .precall-section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 10px; }
  .precall-row { display: flex; padding: 5px 0; font-size: 13px; }
  .precall-row .key { width: 160px; color: #64748b; flex-shrink: 0; }
  .precall-row .val { color: #1e293b; font-weight: 500; }
  .precall-row .val.highlight { color: #16a34a; font-weight: 700; }
  .precall-row .val.link { color: #2563eb; }
  .precall-footer { padding: 12px 18px; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; }
  .precall-ok-btn { padding: 6px 28px; background: #0E7C7B; border: none; border-radius: 8px; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; transition: background .15s; }
  .precall-ok-btn:hover { background: #0a6147; }

  /* Active Call */
  #activeState { position: absolute; inset: 0; display: none; flex-direction: column; background: #f8fafc; }
  .active-header { padding: 24px 32px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 16px; background: #fff; }
  .active-avatar { width: 52px; height: 52px; border-radius: 50%; background: linear-gradient(135deg, #0E7C7B, #16A394); display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 700; color: #fff; }
  .active-info h2 { font-size: 20px; font-weight: 700; color: #0f172a; }
  .active-info p { font-size: 13px; color: #64748b; }
  .active-timer-area { margin-left: auto; text-align: right; }
  .active-timer { font-size: 28px; font-weight: 700; color: #0E7C7B; font-variant-numeric: tabular-nums; }
  .active-timer-label { font-size: 11px; color: #94a3b8; }
  .tabs { display: flex; border-bottom: 1px solid #e2e8f0; padding: 0 32px; background: #fff; }
  .tab { padding: 12px 20px; font-size: 13px; color: #94a3b8; cursor: pointer; border-bottom: 2px solid transparent; font-weight: 600; transition: all .15s; }
  .tab:hover { color: #475569; }
  .tab.active { color: #0E7C7B; border-bottom-color: #0E7C7B; }
  .tab-content { flex: 1; overflow-y: auto; padding: 24px 32px; }
  .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .detail-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  .detail-card .label { font-size: 10px; text-transform: uppercase; letter-spacing: .8px; color: #94a3b8; margin-bottom: 4px; }
  .detail-card .value { font-size: 15px; font-weight: 600; color: #1e293b; }
  .detail-card .value.link { color: #2563eb; }
  .detail-card.wide { grid-column: span 2; }

  /* Bottom Bar */
  .bottom-bar { height: 40px; background: #ffffff; border-top: 1px solid #e2e8f0; display: flex; align-items: center; padding: 0 20px; font-size: 11px; color: #94a3b8; gap: 24px; }
  .bottom-bar .stat-label { color: #94a3b8; }
  .bottom-bar .stat-value { color: #64748b; font-weight: 600; margin-left: 4px; }
  .bottom-bar .invoca-tag { margin-left: auto; display: flex; align-items: center; gap: 5px; color: #0E7C7B; font-weight: 600; font-size: 11px; }

  /* Greeting Overlay */
  #greetingOverlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 100; align-items: center; justify-content: center; }
  .greeting-box { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px 40px; text-align: center; box-shadow: 0 12px 48px rgba(0,0,0,.15); animation: popIn .3s ease-out; max-width: 520px; }
  @keyframes popIn { from { transform: scale(.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  .greeting-box .emoji { font-size: 48px; margin-bottom: 12px; }
  .greeting-box h2 { font-size: 20px; color: #0f172a; margin-bottom: 6px; }
  .greeting-box p { font-size: 14px; color: #64748b; line-height: 1.5; }
  .greeting-box .script { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; margin-top: 16px; font-size: 14px; color: #1e293b; line-height: 1.6; text-align: left; }
  .greeting-box .script strong { color: #2563eb; }
  .greeting-box button { margin-top: 20px; padding: 10px 32px; background: #0E7C7B; border: none; border-radius: 10px; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; transition: background .15s; }
  .greeting-box button:hover { background: #0a6147; }

  @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
</style>
</head>
<body>
<div class="app">

  <!-- Sidebar -->
  <div class="sidebar">
    <div class="logo">${b(brandInitial)}</div>
    <div class="nav-item" title="Home"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L9 4l6 5.5"/><path d="M5 8.5V15h3v-3h2v3h3V8.5"/></svg></div>
    <div class="nav-item active" title="Calls"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 12.7c-.7-.5-1.5-.8-2.3-.8-.9 0-1.6.4-2 .8l-.7.7c-1.5-.8-2.9-1.9-4-3.2l.7-.7c.4-.4.8-1.1.8-2 0-.8-.3-1.6-.8-2.3L6.8 3.8C6.3 3.3 5.6 3 4.8 3 3.8 3 3 3.8 3 4.8c0 4.4 2.5 8.3 6 10.2 1.1.6 2.3 1 3.5 1 1 0 1.8-.8 1.8-1.8 0-.8-.3-1.5-.8-2z"/></svg><span class="badge" id="callBadge">1</span></div>
    <div class="nav-item" title="Voicemail"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="10" r="3"/><circle cx="12.5" cy="10" r="3"/><line x1="5.5" y1="13" x2="12.5" y2="13"/></svg></div>
    <div class="nav-item" title="Contacts"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="3"/><path d="M3 16c0-3 2.7-5 6-5s6 2 6 5"/></svg></div>
    <div class="nav-item" title="Activity"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="7"/><path d="M9 5v4l2.5 2.5"/></svg></div>
  </div>

  <!-- Left Panel -->
  <div class="left-panel">
    <div class="left-header"><h3>Current Call</h3></div>
    <div class="caller-id">
      <div class="direction">Inbound · ${b(d.campaign)}</div>
      <div class="phone">${b(d.callerPhone)}</div>
      <div class="name">${b(d.callerName)}</div>
    </div>
    <div class="media-controls">
      <div class="section-label">Media Controls</div>
      <div class="ctrl-grid">
        <div class="ctrl-btn"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="3" height="10" rx="1"/><rect x="10" y="3" width="3" height="10" rx="1"/></svg>Hold</div>
        <div class="ctrl-btn"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8h6m0 0l-2.5-2.5M11 8l-2.5 2.5"/></svg>Transfer</div>
        <div class="ctrl-btn"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v7m0 0l-2.5-2.5M8 10l2.5-2.5M4 13h8"/></svg>Park</div>
        <div class="ctrl-btn"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="8" r="2.5"/><circle cx="11" cy="8" r="2.5"/><path d="M7.5 8h1"/></svg>Conference</div>
        <div class="ctrl-btn wide"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="3" fill="#ef4444" opacity=".8"/><circle cx="8" cy="8" r="5.5"/></svg>Record Call</div>
      </div>
    </div>
    <div class="queue-section">
      <div class="section-label">Personal Queue</div>
      <div class="queue-item"><span>Waiting</span><span>0</span></div>
      <div class="queue-item"><span>Callbacks</span><span>0</span></div>
    </div>
    <div class="end-call-area">
      <button class="end-call-btn" id="endCallBtn" onclick="resetDemo()">
        <svg width="18" height="18" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><path d="M2 10c0-3.5 2.5-7 7-7s7 3.5 7 7"/><path d="M1.5 10.5l1.5 3 2.5-1.5M16.5 10.5l-1.5 3-2.5-1.5"/></svg>
        END CALL
      </button>
    </div>
  </div>

  <!-- Main -->
  <div class="main">
    <div class="top-bar">
      <div class="status-pill ready" id="statusPill"><span class="dot"></span><span id="statusText">Incoming Call</span></div>
      <div class="top-right">
        <span class="time" id="topTime">--:--</span>
        <div class="icon-btn"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6l6 4 6-4"/></svg></div>
        <div class="icon-btn"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M6 2v12"/></svg></div>
      </div>
    </div>
    <div class="main-content">

      <!-- RINGING -->
      <div id="ringingState">
        <div class="ring-left">
          <div class="ring-bg"></div>
          <div class="ring-pulse"></div><div class="ring-pulse"></div><div class="ring-pulse"></div>
          <div class="ring-avatar">${b(callerInitials)}</div>
          <div class="ring-name">${b(d.callerName)}</div>
          <div class="ring-phone">${b(d.callerPhone)}</div>
          <div class="ring-label ring-icon-animated" style="display:flex;align-items:center;gap:6px;">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 10c0-3.5 2.5-6 6-6s6 2.5 6 6"/><path d="M5 10c0-1.5 1-3 3-3s3 1.5 3 3"/><circle cx="8" cy="10" r="1" fill="currentColor"/></svg>
            INCOMING CALL
          </div>
          <div class="ring-actions">
            <button class="ring-action-btn decline" onclick="resetDemo()" title="Decline">
              <svg width="28" height="28" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><path d="M4 14c0-5 4-10 10-10s10 5 10 10"/><path d="M3 14.5l2 4 3.5-2M25 14.5l-2 4-3.5-2"/></svg>
            </button>
            <button class="ring-action-btn accept" onclick="answerCall()" title="Answer" id="answerBtn">
              <svg width="28" height="28" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><path d="M22 16.9c-1-.7-2-.9-3-.9-1.2 0-2.2.5-2.8 1.1l-1 1c-2-1.1-4-2.7-5.5-4.5l1-1C11 12.1 11.5 11.2 11.5 10c0-1.1-.4-2.2-1.1-3L8.8 5.3C8.2 4.7 7.3 4.3 6.3 4.3 5 4.3 4 5.3 4 6.5c0 6 3.5 11.5 8.3 14.1 1.5.8 3.2 1.4 4.9 1.4 1.3 0 2.5-1 2.5-2.5 0-1.1-.4-2-.8-2.6z"/></svg>
            </button>
          </div>
        </div>

        <!-- Pre-Call Data -->
        <div class="precall-panel" id="precallPanel">
          <div class="precall-header">
            <svg width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M4 15V5a2 2 0 012-2h8a2 2 0 012 2v10"/><path d="M2 15h16"/><path d="M7 8h6M7 11h4"/></svg>
            <span class="title">Pre-Call Intelligence</span>
            <span class="powered">Powered by Invoca</span>
          </div>
          <div class="precall-body">
            <div class="precall-campaign">Campaign: ${b(d.campaign)}</div>
            <div class="precall-caller">${b(d.callerName)}</div>
            <div class="precall-meta" style="margin-top:10px;">
              <span class="precall-tag green">${b(d.tagGreen)}</span>
              <span class="precall-tag blue">${b(d.tagBlue)}</span>
            </div>
            <div class="precall-divider"></div>
            <div class="precall-section-label">Digital Journey</div>
            <div class="precall-row"><span class="key">Estimated Value</span><span class="val highlight" style="font-size:15px;">${b(d.estimatedValue)}</span></div>
            <div class="precall-row"><span class="key">Google Search</span><span class="val">${b(d.googleSearch)}</span></div>
            <div class="precall-row"><span class="key">Website Search</span><span class="val">${b(d.websiteSearch)}</span></div>
            <div class="precall-row"><span class="key">Calling Webpage</span><span class="val link">${b(d.callingWebpage)}</span></div>
            <div class="precall-row"><span class="key">Products</span><span class="val">${b(d.products)}</span></div>
            <div class="precall-row"><span class="key">Shopping Cart ID</span><span class="val">${b(d.cartId)}</span></div>
            <div class="precall-row"><span class="key">Other Party Number</span><span class="val">${b(d.callerPhone)}</span></div>
            <div class="precall-row"><span class="key">Serviceable Address</span><span class="val highlight">${b(d.serviceable)}</span></div>
            <div class="precall-row"><span class="key">Email</span><span class="val">${b(d.email)}</span></div>
            <div class="precall-row"><span class="key">Street</span><span class="val">${b(d.street)}</span></div>
            <div class="precall-row"><span class="key">City</span><span class="val">${b(d.city)}</span></div>
            <div class="precall-row"><span class="key">State</span><span class="val">${b(d.state)}</span></div>
            <div class="precall-row"><span class="key">Zip</span><span class="val">${b(d.zip)}</span></div>
            <div class="precall-row" style="flex-direction:column;gap:4px;"><span class="key">PreCall Digital Journey</span><span class="val link" style="font-size:12px;word-break:break-all;">${b(d.digitalJourney)}</span></div>
            <div class="precall-divider"></div>
            <div class="precall-section-label">${b(d.aiSectionLabel)}</div>
            <div class="precall-row"><span class="key">Intent</span><span class="val highlight">${b(d.intent)}</span></div>
            <div class="precall-row"><span class="key">Coverage</span><span class="val highlight">${b(d.coverage)}</span></div>
            <div class="precall-row"><span class="key">${b(d.thirdRowLabel)}</span><span class="val highlight">${b(d.thirdRowValue)}</span></div>
          </div>
          <div class="precall-footer">
            <button class="precall-ok-btn" onclick="dismissPrecall()">Got It</button>
          </div>
        </div>
      </div>

      <!-- ACTIVE CALL -->
      <div id="activeState">
        <div class="active-header">
          <div class="active-avatar">${b(callerInitials)}</div>
          <div class="active-info">
            <h2>${b(d.callerName)}</h2>
            <p>${b(d.callerPhone)} · Inbound · ${b(d.campaign)}</p>
          </div>
          <div class="active-timer-area">
            <div class="active-timer" id="callTimer">0:00</div>
            <div class="active-timer-label">Call Duration</div>
          </div>
        </div>
        <div class="tabs">
          <div class="tab active">Interaction</div>
          <div class="tab">History</div>
          <div class="tab">Contact Record</div>
          <div class="tab">Notes</div>
        </div>
        <div class="tab-content">
          <div class="detail-grid">
            <div class="detail-card" style="border:2px solid #16a34a; background:#f0fdf4;"><div class="label">Estimated Value</div><div class="value" style="color:#15803d; font-size:28px; font-weight:800;">${b(d.estimatedValue)}</div></div>
            <div class="detail-card"><div class="label">Products</div><div class="value">${b(d.products)}</div></div>
            <div class="detail-card wide"><div class="label">Google Search Query</div><div class="value">${b(d.googleSearch)}</div></div>
            <div class="detail-card"><div class="label">Website Search</div><div class="value">${b(d.websiteSearch)}</div></div>
            <div class="detail-card"><div class="label">Calling Webpage</div><div class="value" style="color:#2563eb;">${b(d.callingWebpage)}</div></div>
            <div class="detail-card"><div class="label">Shopping Cart ID</div><div class="value">${b(d.cartId)}</div></div>
            <div class="detail-card"><div class="label">Other Party Number</div><div class="value">${b(d.callerPhone)}</div></div>
            <div class="detail-card"><div class="label">Serviceable Address</div><div class="value" style="color:#16a34a;">${b(d.serviceable)}</div></div>
            <div class="detail-card"><div class="label">Email</div><div class="value">${b(d.email)}</div></div>
            <div class="detail-card"><div class="label">Street</div><div class="value">${b(d.street)}</div></div>
            <div class="detail-card"><div class="label">City</div><div class="value">${b(d.city)}</div></div>
            <div class="detail-card"><div class="label">State</div><div class="value">${b(d.state)}</div></div>
            <div class="detail-card"><div class="label">Zip</div><div class="value">${b(d.zip)}</div></div>
            <div class="detail-card wide"><div class="label">PreCall Digital Journey</div><div class="value link" style="font-size:13px;">${b(d.digitalJourney)}</div></div>
            <div class="detail-card wide" style="border:2px solid #0E7C7B;background:#f0fdf4;"><div class="label" style="color:#0E7C7B;">${b(d.aiSectionLabel)}</div><div class="value" style="font-size:13px;line-height:1.6;"><div style="margin-bottom:4px;"><strong>Intent</strong> ${b(d.intent)}</div><div style="margin-bottom:4px;"><strong>Coverage</strong> ${b(d.coverage)}</div><div style="margin-bottom:4px;"><strong>${b(d.thirdRowLabel)}</strong> ${b(d.thirdRowValue)}</div></div></div>
          </div>
        </div>
      </div>

    </div>
    <div class="bottom-bar">
      <span><span class="stat-label">ACD Status:</span><span class="stat-value" id="acdStatus">Ready</span></span>
      <span><span class="stat-label">Calls:</span><span class="stat-value">0</span></span>
      <span><span class="stat-label">Callbacks:</span><span class="stat-value">0</span></span>
      <span><span class="stat-label">Longest Wait:</span><span class="stat-value">0:00</span></span>
      <span class="invoca-tag">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="4"/><path d="M6 4v2l1.5 1.5"/></svg>
        Invoca Signal Data Active
      </span>
    </div>
  </div>
</div>

<!-- Greeting Overlay -->
<div id="greetingOverlay">
  <div class="greeting-box">
    <div class="emoji">${b(d.overlayEmoji)}</div>
    <h2>${b(d.overlayTitle)}</h2>
    <p>${b(d.overlaySubtitle)}</p>
    <div class="script">
      <strong>${b(d.greetingLabel)}</strong><br>
      ${b(d.greeting)}</div>
    <button onclick="closeGreeting()">Start Conversation</button>
  </div>
</div>

<script>
  let callTimerInterval = null;
  let callSeconds = 0;

  function updateClock() {
    const now = new Date();
    document.getElementById('topTime').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  updateClock();
  setInterval(updateClock, 30000);

  function answerCall() {
    document.getElementById('ringingState').style.display = 'none';
    document.getElementById('activeState').style.display = 'flex';
    document.getElementById('endCallBtn').style.display = 'flex';
    document.getElementById('callBadge').style.display = 'none';
    const pill = document.getElementById('statusPill');
    pill.className = 'status-pill oncall';
    document.getElementById('statusText').textContent = 'On Call';
    document.getElementById('acdStatus').textContent = 'On Call';
    document.getElementById('greetingOverlay').style.display = 'flex';
    callSeconds = 0;
    callTimerInterval = setInterval(() => {
      callSeconds++;
      const m = Math.floor(callSeconds / 60);
      const s = callSeconds % 60;
      document.getElementById('callTimer').textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
  }

  function dismissPrecall() {
    document.getElementById('precallPanel').style.opacity = '0.4';
  }

  function closeGreeting() {
    document.getElementById('greetingOverlay').style.display = 'none';
  }

  function resetDemo() {
    clearInterval(callTimerInterval);
    document.getElementById('ringingState').style.display = 'flex';
    document.getElementById('activeState').style.display = 'none';
    document.getElementById('endCallBtn').style.display = 'none';
    document.getElementById('greetingOverlay').style.display = 'none';
    document.getElementById('callBadge').style.display = 'flex';
    document.getElementById('callTimer').textContent = '0:00';
    document.getElementById('precallPanel').style.opacity = '1';
    const pill = document.getElementById('statusPill');
    pill.className = 'status-pill ready';
    document.getElementById('statusText').textContent = 'Incoming Call';
    document.getElementById('acdStatus').textContent = 'Ready';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const ringing = document.getElementById('ringingState').style.display !== 'none';
      const greeting = document.getElementById('greetingOverlay').style.display !== 'none';
      if (greeting) { closeGreeting(); e.preventDefault(); }
      else if (ringing) { answerCall(); e.preventDefault(); }
    }
    if (e.key === 'Escape') { resetDemo(); }
  });
</script>
</body>
</html>`;
}
