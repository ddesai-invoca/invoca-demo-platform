import { useMemo, useRef, useEffect } from "react";
import { useProfile } from "../data/ProfileContext";
import { useSmsCapture } from "../data/SmsCaptureContext";
import { SldsIcon } from "../components/SldsIcon";
import { SfGlobalHeader, SfContextBar, SfTodoBar } from "../components/SalesforceChrome";
import { bookedEvent } from "../data/salesforceEvent";

/* =============================================================================
   Salesforce — Calendar (week view). Screen 2 of the Sales Cloud flow.
   -----------------------------------------------------------------------------
   What the Calendar tab opens. REBUILT 8/24/2026 from Lightning's OWN AUTHORED CSS RULES,
   read out of the capture's stylesheet rather than inferred from computed boxes — the grid's
   line colour, line frequency, column shading and vertical offsets are all in rules that a
   box-by-box measurement cannot show. The corrections that mattered:

     time ruler    80px wide (the first build used 60)
     columns       1920 tall with `margin-top: 20px`, `border-left 1px #C9C9C9`
                     (the first build had #E5E5E5 and no offset)
     shading       ONLY `.pastDay` is shaded #F3F3F3; today and future have no rule at all,
                     so they are white
     gridlines     a background GRADIENT — 1px rgba(0,0,0,.1) every 40px, i.e. every HALF
                     hour. The first build drew white 1px borders every 80px: wrong colour,
                     half the frequency, and the wrong mechanism
     hour label    offset -10px with a WHITE ground, so it interrupts the line
     day header    55 tall on a 40px line, with a ::after column tick starting at 40px
     chip column   `calc(100% - 0.75rem)`, chip padding-bottom 1px

   Still measured off computed boxes: page header 69.5 over a 1px #C9C9C9 rule; kicker
   13/19.5 over the range at 700 18/22.5; buttons 32 tall, 1px #747474, radius 4, ink
   #0176D3; GMT 11px/40 #757575; chip #5A93B1 radius 4 padding 2px 4px 0; rail 304 wide;
   rail heading 700 16/24; mini td 40 holding a 32px circle.

     page header   69.5 tall, border-bottom 1px #C9C9C9
     "Calendar"    13/19.5 #181818 over the range at 700 18px/22.5
     buttons       32 tall, 1px #747474, radius 4, ink #0176D3 on white
     GMT label     11px/40 #757575
     day header    13px/40 #181818, centred, column 157.1 wide
     HOUR PITCH    80px — 24 rows, so the grid body is 1920 tall
     hour label    13/19.5 #444444, 23 from the left
     event chip    146.1 wide, 81 tall for one hour, bg #5A93B1, radius 4,
                     padding 2px 4px 0; title 700 12px, time 12px, both #181818
     right rail    304 wide, white
     mini cell     40 x 40, 12/18; out-of-month days #C9C9C9
     rail heading  700 16/24

   ⚠️ THE GRID OPENS SCROLLED, not at midnight. 24 rows at 80px is 1920px of body and the
   working day is in the middle of it; the capture's own second screenshot sits at ~9am. The
   scroller is set once on mount so the appointment is on screen without the SE hunting.
   ============================================================================= */

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const HOUR_PX = 80;

/** "12am", "1am" … "11pm" — the capture's own label set, 24 of them. */
const HOURS = Array.from({ length: 24 }, (_, h) => {
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${ampm}`;
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

export function SalesforceCalendar() {
  const { profile, profileId } = useProfile();
  const { capturedFor } = useSmsCapture();
  const body = useRef<HTMLDivElement | null>(null);

  /* The newest live capture wins; otherwise the seeded conversation. */
  const captured = capturedFor(profileId)[0];
  const ev = useMemo(() => bookedEvent(profile, captured), [profile, captured]);

  /* ⚠️ THE WEEK IS DERIVED FROM THE DEMO'S OWN CLOCK, and the appointment is placed INSIDE
     it — the capture shows Aug 2-8 because that SE had navigated back, which is that
     session's state, not the screen's design. Sunday-based to match the grid. */
  const { weekStart, todayIso, todayMidnight } = useMemo(() => {
    const now = new Date();
    const s = new Date(now);
    s.setDate(now.getDate() - now.getDay());
    s.setHours(0, 0, 0, 0);
    const mid = new Date(now); mid.setHours(0, 0, 0, 0);
    return { weekStart: s, todayIso: now.toDateString(), todayMidnight: mid };
  }, []);

  const dayOf = (i: number) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  };
  const first = dayOf(0), last = dayOf(6);
  const rangeLabel =
    `${MONTHS[first.getMonth()]} ${first.getDate()}, ${first.getFullYear()}–` +
    `${MONTHS[last.getMonth()]} ${last.getDate()}, ${last.getFullYear()}`;

  /* Open the grid on the working day rather than at midnight. */
  useEffect(() => {
    if (body.current) body.current.scrollTop = Math.max(0, (ev.startHour - 4) * HOUR_PX);
  }, [ev.startHour]);

  /* The mini calendar: six weeks from the Sunday on or before the 1st. */
  const monthCells = useMemo(() => {
    const anchor = dayOf(3);
    const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(1 - firstOfMonth.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return { d, inMonth: d.getMonth() === anchor.getMonth(),
        isToday: d.toDateString() === todayIso };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, todayIso]);
  const monthAnchor = dayOf(3);

  return (
    <div className="sfh-root sfc-root">
      <SfGlobalHeader />
      <SfContextBar active="Calendar" />

      {/* ---- page header ---- */}
      <div className="sfc-head">
        {/* ⚠️ `calendar-tile`, NOT `calendar` — the glyph WAS extracted, and referencing a name
            that is not in PATHS made SldsIcon return null, so the tile rendered as an empty
            purple square. A missing key fails silently; there is no such icon as "calendar". */}
        <span className="sfc-head-icon"><SldsIcon name="calendar-tile" size={32} /></span>
        <div className="sfc-head-text">
          <p className="sfc-head-kicker">Calendar</p>
          <h1 className="sfc-head-range">{rangeLabel}</h1>
        </div>
        <div className="sfc-head-actions">
          <span className="sfc-nudge"><SldsIcon name="chevronleft" size={12} /></span>
          <span className="sfc-nudge"><SldsIcon name="chevronright" size={12} /></span>
          <span className="sfc-btn">Today</span>
          <span className="sfc-icobtn"><SldsIcon name="refresh" size={14} /></span>
          <span className="sfc-icobtn sfc-icobtn--split">
            <SldsIcon name="calendar-sm" size={14} />
            <SldsIcon name="triangledown" size={12} />
          </span>
          <span className="sfc-btn sfc-btn--new">New Event</span>
          <span className="sfc-icobtn sfc-icobtn--on"><SldsIcon name="rows" size={14} /></span>
        </div>
      </div>

      <div className="sfc-split">
        {/* ---- the week grid ---- */}
        <div className="sfc-grid">
          {/* The GMT label lives in the 80px ruler; the header row is padded to clear it. */}
          <div className="sfc-dayheads-wrap">
            <span className="sfc-gmt">GMT &minus;7</span>
            <div className="sfc-dayheads">
              {DAYS.map((d, i) => (
                <span className="sfc-dayhead" key={d}>{d} {dayOf(i).getDate()}</span>
              ))}
            </div>
          </div>

          <div className="sfc-body" ref={body}>
            <div className="sfc-hours">
              {HOURS.map((h) => (
                <span className="sfc-hour" key={h}><span>{h}</span></span>
              ))}
            </div>
            <div className="sfc-cols">
              {DAYS.map((d, i) => {
                /* ⚠️ ONLY A PAST DAY IS SHADED. Lightning styles `.pastDay` and leaves the
                   base column with no background at all, so today and future days are
                   white — measured from the ABSENCE of a rule, which a computed box on a
                   capture of an all-past week could never have told me. */
                const past = dayOf(i) < todayMidnight;
                return (
                  <div className={"sfc-col" + (past ? " sfc-col--past" : "")} key={d}>
                    {/* the half-hour gridlines are this layer's background gradient */}
                    <div className="sfc-eventlist" />
                    <div className="sfc-eventwrap">
                      {i === ev.dayIndex ? (
                        <div className="sfc-event"
                          style={{ top: ev.startHour * HOUR_PX, height: ev.hours * HOUR_PX }}>
                          <span className="sfc-event-box">
                            <span className="sfc-event-title">{ev.title}</span>
                            <span className="sfc-event-time">{ev.timeLabel}</span>
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ---- right rail ---- */}
        <aside className="sfc-rail">
          <div className="sfc-mini-head">
            <span className="sfc-mini-nudge"><SldsIcon name="triangleleft" size={10} /></span>
            <span className="sfc-mini-month">{MONTHS[monthAnchor.getMonth()].toUpperCase()}</span>
            <span className="sfc-mini-nudge"><SldsIcon name="triangleright" size={10} /></span>
            <span className="sfc-mini-year">
              {monthAnchor.getFullYear()}<SldsIcon name="triangledown" size={10} />
            </span>
          </div>
          <div className="sfc-mini">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <span className="sfc-mini-dow" key={d}>{d}</span>
            ))}
            {monthCells.map(({ d, inMonth, isToday }) => (
              <span key={d.toISOString()}
                className={"sfc-mini-cell"
                  + (inMonth ? "" : " sfc-mini-cell--out")
                  + (isToday ? " sfc-mini-cell--today" : "")}>
                <span className="sfc-mini-day">{d.getDate()}</span>
              </span>
            ))}
          </div>

          <div className="sfc-rail-sec">
            <h2 className="sfc-rail-head">My Calendars</h2>
            <span className="sfh-iconbtn sfh-iconbtn--round"><SldsIcon name="settings" size={14} /></span>
          </div>
          <div className="sfc-cal-row">
            <span className="sfc-swatch" />
            <span className="sfc-cal-name">My Events</span>
            <span className="sfh-iconbtn"><SldsIcon name="triangledown" size={12} /></span>
          </div>

          <div className="sfc-rail-sec">
            <h2 className="sfc-rail-head">Other Calendars</h2>
            <span className="sfh-iconbtn sfh-iconbtn--round"><SldsIcon name="settings" size={14} /></span>
          </div>
        </aside>
      </div>

      <SfTodoBar />
    </div>
  );
}
