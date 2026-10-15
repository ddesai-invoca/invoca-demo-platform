/* =============================================================================
   CustomCrm — a scheduling CRM the SMS agent books into, live
   -----------------------------------------------------------------------------
   Rebuilt 10/15/2026 from a coworker's Chicago Summit widget (The Carpet Guys):
   the week calendar on the left, the "New Lead" panel on the right, and the
   appointment the SMS agent books landing on the grid as it happens. Reached from
   the Custom CRM tile on Integrations; standalone like the Salesforce screens,
   because it is somebody else's system, not Invoca's.

   ⚠️ **LIVE BY CONSTRUCTION, NOT BY A NEW CHANNEL.** The Preview Agent already
   writes its conversation to `SmsCaptureContext` after every turn, and that store
   syncs across tabs on the `storage` event. So the SE opens this in one tab and
   the Preview Agent in another, exactly as the reference video does, and nothing
   new had to carry the data between them.

   ⚠️ **TODAY'S CONVERSATION ONLY.** The calendar's days are relative to today, so
   a booking read from a conversation captured on another day would land on the
   wrong date. An older capture is simply not shown.

   CSS is `.ccr-*` and nothing else.
   ============================================================================= */

import { useEffect, useMemo, useRef, useState } from "react";
import { useProfile } from "../data/ProfileContext";
import { useSmsCapture } from "../data/SmsCaptureContext";
import { derive } from "../data/prospectPlace";
import {
  crmCalendar, crmStateFrom, crmConnection, setCrmConnected, crmDetails, hourLabel, ymd,
  CRM_START_HOUR, CRM_END_HOUR, type CrmDay,
} from "../data/customCrm";

const HOUR_PX = 64;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const longDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const shortDay = (iso: string) => new Date(iso + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const minutesOf = (t: string) => {
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(t);
  return m ? ((Number(m[1]) % 12) + (m[3] === "PM" ? 12 : 0)) * 60 + Number(m[2]) : null;
};

export function CustomCrm({ embedded = false, convId }: {
  embedded?: boolean;
  /** Beside the phone: show exactly the conversation that phone is having (null = not started). */
  convId?: string | null;
} = {}) {
  const { profile } = useProfile();
  const { capturedFor } = useSmsCapture();
  const now = new Date();
  const todayIso = ymd(now);
  const days = useMemo(() => crmCalendar(profile.id, new Date()), [profile.id, todayIso]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The connect switch. First visit connects, so the demo works without hunting for it; the
     pill says so and turns it off. */
  const [connected, setConnected] = useState(() => crmConnection(profile.id) !== "off");
  useEffect(() => {
    if (crmConnection(profile.id) === null) setCrmConnected(profile.id, true);
    setConnected(crmConnection(profile.id) !== "off");
  }, [profile.id]);
  const toggle = () => { const on = !connected; setCrmConnected(profile.id, on); setConnected(on); };

  /* "Clear" hides the conversation on screen; a New Chat in the Preview Agent starts a new
     one, which shows up by itself. */
  const [cleared, setCleared] = useState<string | null>(null);
  const conv = (embedded && convId !== undefined
    ? capturedFor(profile.id).find((c) => c.id === convId && c.id !== cleared)
    : capturedFor(profile.id).find((c) => c.date === longDate(now) && c.id !== cleared)) ?? null;
  const st = useMemo(() => crmStateFrom(conv, days), [conv, days]);

  const booking = (profile.bookingTerm || "Appointment");
  const place = useMemo(() => { try { return derive(profile).shortCity; } catch { return ""; } }, [profile]);
  const status = st.booking ? "booked" : st.selected ? "selected" : st.offers.length ? "offering" : st.conversation.length ? "in_progress" : "idle";
  const STATUS: Record<string, string> = { idle: "Waiting", in_progress: "In conversation", offering: "Offering times", selected: "Slot picked", booked: "Appointment submitted" };

  /* Project tags: the prospect's own product categories the customer named. */
  const customerText = st.conversation.filter((m) => m.who === "customer").map((m) => m.text).join(" ");
  /* The key facts the customer gave: what they stated, plus the AI-extracted signals that
     `/api/analyze` adds to this conversation a beat after each turn. See `crmDetails`. */
  const signalNames = (conv?.signals ?? []).map((x) => x.name).join("\n");
  const tags = useMemo(() => {
    const bd = profile.reports?.marketingDashboard?.breakdowns?.find((b) => /product category/i.test(b.title));
    return crmDetails(customerText, signalNames ? signalNames.split("\n") : [], (bd?.rows ?? []).map((r) => r.name));
  }, [profile, customerText, signalNames]);
  const request = st.conversation.find((m) => m.who === "customer")?.text ?? "";

  const focusDate = st.booking?.date ?? st.selected?.date ?? st.offers[0]?.date ?? null;
  const focusDay = days.find((d) => d.date === focusDate);
  const full = new Set(st.checked.filter((c) => c.found === 0).map((c) => c.date));

  /* The booking arrives once: a booking already on screen when the page loads does not animate. */
  const seenBooking = useRef<string | null | undefined>(undefined);
  const bookingSig = st.booking ? `${st.booking.id}|${st.booking.date}|${st.booking.time}` : null;
  const [arriving, setArriving] = useState(false);
  const [toast, setToast] = useState(false);
  useEffect(() => {
    if (seenBooking.current === undefined) { seenBooking.current = bookingSig; return; }
    if (bookingSig && bookingSig !== seenBooking.current) {
      setArriving(true); setToast(true);
      const t1 = setTimeout(() => setArriving(false), 4500);
      const t2 = setTimeout(() => setToast(false), 6500);
      seenBooking.current = bookingSig;
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    seenBooking.current = bookingSig;
  }, [bookingSig]);

  /* Values flash when they change, never on first paint. */
  const painted = useRef(false);
  useEffect(() => { painted.current = true; });

  /* Scroll the grid to whatever just happened. */
  const gridRef = useRef<HTMLDivElement>(null);
  const target = st.booking?.time ?? st.selected?.time ?? st.offers[0]?.time ?? null;
  useEffect(() => {
    const el = gridRef.current;
    const min = target ? minutesOf(target) : null;
    if (!el || min == null) return;
    const y = ((min - CRM_START_HOUR * 60) / 60) * HOUR_PX - 60;
    if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - 160) el.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }, [target]);

  const kv = (label: string, value: string | null | undefined, wait = "Waiting…") => (
    <><span className="ccr-k">{label}</span>
      {value
        ? <span key={value} className={"ccr-v" + (painted.current ? " ccr-flash" : "")}>{value}</span>
        : <span className="ccr-v ccr-wait">{wait}</span>}</>
  );
  const step = (done: boolean, label: string, sub?: string) => (
    <li className={done ? "ccr-ok" : ""}><i aria-hidden="true" /><span>{label}{done && sub ? <small>{sub}</small> : null}</span></li>
  );

  const apptDate = st.booking ? focusDay?.label : focusDay?.label;
  const apptTime = st.booking ? st.booking.time
    : st.selected ? st.selected.time
    : st.offers.length ? `Offered: ${st.offers.filter((o) => o.date === focusDate).map((o) => o.time).join(", ")}` : null;
  const contactDone = !!(st.lead.name && st.lead.phone && (st.lead.address || st.lead.email));
  const followUp = [
    ...(!st.lead.email ? ["Email address for the confirmation"] : []),
    ...(!st.lead.address ? ["Street address for the visit"] : []),
    `Anything to prepare before the ${booking.toLowerCase()}`,
  ];
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="ccr">
      <header className="ccr-top">
        <div className="ccr-brand">
          <div className="ccr-wordmark">{profile.customerName}</div>
          <div className="ccr-divider" />
          <div className="ccr-app">{cap(booking)} Scheduling</div>
        </div>
        <div className="ccr-spacer" />
        {!embedded && (
          <a className="ccr-open" href="/agent-studio/agent/preview" target="_blank" rel="noopener">
            <span className="material-icons" aria-hidden="true">sms</span>Open Preview Agent
          </a>
        )}
        <button className={"ccr-live" + (connected ? " on" : "")} onClick={toggle}
          title={connected ? "The SMS agent books into this calendar. Click to disconnect." : "Click to connect the SMS agent to this calendar."}>
          <i />{connected ? "AI Agent connected" : "Connect AI Agent"}
        </button>
        {conv && <button className="ccr-clear" onClick={() => setCleared(conv.id)}>Clear</button>}
        <div className="ccr-today">{now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
      </header>

      <div className="ccr-wrap">
        <section className="ccr-cal">
          <div className={"ccr-toast" + (toast ? " on" : "")} role="status">
            <b>New appointment booked</b>
            {st.booking && <small>#{st.booking.id} · {st.lead.name || "New customer"} · {shortDay(st.booking.date)} at {st.booking.time}</small>}
          </div>
          <div className="ccr-tool">
            <h2>{cap(booking)}s</h2>
            <span className="ccr-range">{shortDay(days[0].date)} – {shortDay(days[6].date)}</span>
            {(place || st.zip) && <span className="ccr-area">Service area: <b>{[place, st.zip].filter(Boolean).join(" · ")}</b></span>}
          </div>
          <div className="ccr-legend">
            <span><i className="ccr-sw offer" />Offered by AI Agent</span>
            <span><i className="ccr-sw busy" />Booked</span>
            <span><i className="ccr-sw new" />Booked by AI Agent</span>
          </div>
          <div className="ccr-grid" ref={gridRef}>
            <div className="ccr-days">
              <div />
              {days.map((d) => {
                const n = st.offers.filter((o) => o.date === d.date).length;
                return (
                  <div key={d.date} className={"ccr-dh" + (d.date === todayIso ? " today" : "") + (d.date === focusDate ? " focus" : "")}>
                    <div className="ccr-w">{d.weekday.slice(0, 3)}</div>
                    <div className="ccr-n">{new Date(d.date + "T12:00").getDate()}</div>
                    {full.has(d.date) ? <div className="ccr-no">Checked · full</div>
                      : n && !st.booking && d.date === focusDate ? <div className="ccr-yes">{n} openings</div> : null}
                  </div>
                );
              })}
            </div>
            <div className="ccr-body" style={{ height: (CRM_END_HOUR - CRM_START_HOUR) * HOUR_PX }}>
              <div className="ccr-hours">
                {Array.from({ length: CRM_END_HOUR - CRM_START_HOUR }, (_, i) => (
                  <div key={i}>{i === 0 ? "" : hourLabel(CRM_START_HOUR + i).replace(":00", "")}</div>
                ))}
              </div>
              {days.map((d) => <Column key={d.date} d={d} st={st} today={todayIso} full={full.has(d.date) || d.closed}
                focus={d.date === focusDate} arriving={arriving} nowMin={nowMin} name={st.lead.name} />)}
            </div>
          </div>
        </section>

        <aside className="ccr-side">
          <div className="ccr-sh"><h3>New Lead</h3><span className={"ccr-chip " + status}>{STATUS[status]}</span></div>
          <div className="ccr-sec">
            <h4>Customer</h4>
            <div className="ccr-kv">
              {kv("Name", st.lead.name)}
              {kv("Phone", st.lead.phone)}
              {kv("Address", st.lead.address)}
              {kv("ZIP", st.zip ? `${st.zip}  ✓ in service area` : null)}
              {kv("Email", st.lead.email)}
            </div>
          </div>
          <div className="ccr-sec">
            <h4>Project</h4>
            {request ? (
              <>
                {tags.length > 0 && <div className="ccr-tags">{tags.map((t) => <span key={t} className="ccr-tag">{t}</span>)}</div>}
                <div className="ccr-quote">“{request}”</div>
              </>
            ) : <div className="ccr-empty">Waiting for the customer's request</div>}
          </div>
          <div className="ccr-sec">
            <h4>Appointment</h4>
            <div className="ccr-kv">
              {kv("Date", apptDate)}
              {kv("Time", apptTime)}
              {st.offers.length > 0 && kv("Type", cap(booking))}
              {kv("Status", st.booking ? "Submitted" : st.selected ? "Slot picked" : st.offers.length ? "Offering times" : null)}
              {kv("Booking ID", st.booking ? `#${st.booking.id}` : null)}
              {st.conversation.length > 0 && kv("Source", "AI Messaging Agent (SMS)")}
            </div>
          </div>
          <div className="ccr-sec">
            <h4>What the AI Agent did</h4>
            <ul className="ccr-steps">
              {step(!!request, "Understood the request", tags.slice(0, 2).join(" · "))}
              {step(!!st.zip, "Confirmed service area", `ZIP ${st.zip ?? ""}${place ? " · " + place.toUpperCase() : ""}`)}
              {step(st.offers.length > 0 || !!st.booking, "Checked live availability",
                `${st.checked.length ? "Checked " + st.checked.map((c) => days.find((d) => d.date === c.date)?.weekday.slice(0, 3)).join(", ") + " · " : ""}${st.offers.length} openings found`)}
              {step(contactDone, "Collected contact details", ["name", "phone", st.lead.address ? "address" : "", st.lead.email ? "email" : ""].filter(Boolean).join(", "))}
              {step(!!st.booking, "Booked the appointment", st.booking ? `#${st.booking.id} · submitted` : "")}
            </ul>
          </div>
          <div className="ccr-sec">
            <h4>Confirm on the follow-up call</h4>
            <ul className="ccr-list">{followUp.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Column({ d, st, today, full, focus, arriving, nowMin, name }: {
  d: CrmDay; st: ReturnType<typeof crmStateFrom>; today: string; full: boolean; focus: boolean;
  arriving: boolean; nowMin: number; name?: string;
}) {
  const top = (min: number) => ((min - CRM_START_HOUR * 60) / 60) * HOUR_PX + 1;
  const h = HOUR_PX - 3;
  const booked = st.booking && st.booking.date === d.date ? st.booking : null;
  const offers = st.offers.filter((o) => o.date === d.date && !(booked && booked.time === o.time));
  return (
    <div className={"ccr-col" + (focus ? " focus" : "") + (d.date < today ? " past" : "") + (full ? " none" : "")}>
      {d.busy.map((t) => {
        const m = minutesOf(t);
        return m == null ? null : (
          <div key={"b" + t} className="ccr-ev busy" style={{ top: top(m), height: h }}><div className="t">{t}</div><div>Booked</div></div>
        );
      })}
      {offers.map((o) => {
        const m = minutesOf(o.time);
        const picked = !booked && st.selected?.date === o.date && st.selected?.time === o.time;
        return m == null ? null : (
          <div key={"o" + o.time} className={"ccr-ev offer" + (picked ? " picked" : "")} style={{ top: top(m), height: h }}>
            <div className="t">{o.time}</div><div>{picked ? "Picked" : "Available"}</div><div>{picked ? "Booking…" : "Offered"}</div>
          </div>
        );
      })}
      {booked && (() => {
        const m = minutesOf(booked.time);
        return m == null ? null : (
          <div className={"ccr-ev new" + (arriving ? " arrive" : "")} style={{ top: top(m), height: h }} title={`${name ?? ""} · ${booked.time}`}>
            <span className="tag">New · AI</span><div className="t">{name || "New appointment"}</div><div>{booked.time}</div>
          </div>
        );
      })()}
      {d.date === today && nowMin > CRM_START_HOUR * 60 && nowMin < CRM_END_HOUR * 60 && (
        <div className="ccr-nowline" style={{ top: ((nowMin - CRM_START_HOUR * 60) / 60) * HOUR_PX }} />
      )}
    </div>
  );
}
