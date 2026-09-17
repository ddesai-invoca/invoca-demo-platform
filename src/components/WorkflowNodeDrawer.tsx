import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  PHONE_PROMPT, SMS_ACTION_LABEL, SMS_ACTION_OPTIONS, SMS_CALLBACK_SIGNAL,
  SMS_DESTINATION_PLACEHOLDER, SMS_DESTINATION_PROMPT, actionCopy, collectOnSwitch, isVoiceKind,
  nodeActionFields, type ActionKind, type NodeDrawer,
} from "../data/workflowDrawers";

/* =============================================================================
   WorkflowNodeDrawer — what a node of the flow diagram opens
   -----------------------------------------------------------------------------
   Three shells behind one component, measured off six captures of the real page, each
   saved with a different drawer open (8/26/2026). **Those captures serialised their emotion
   CSS**, so unlike the call screen every number here is a real computed style.

   ⚠️⚠️ **EDITABLE WHEN — AND ONLY WHEN — IT IS TOLD WHERE TO WRITE (9/17/2026).** Asked for
   directly, with the empty-Qualify template attached as the reference: "the fields in the
   drawers are greyed out but i want you to make them white", and "add the Add functionality".
   The grey is the REAL product's read-only state (measured: every field in the twelve configured
   captures carries `disabled`, 12 `Mui-disabled` classes, and no footer at all); the empty
   template is the editable one, with white fields, an Add button and a Cancel / Apply footer.

   So this is now a real editor — but gated on `onApply` plus the drawer carrying `edits`
   paths. Without them every control stays `readOnly` exactly as before, which is what keeps
   the voice drawers byte-identical: they were signed off read-only and nobody asked to change
   them. That gate is also what stops the older failure this note used to describe — an Apply
   that appears to save while writing nowhere, the silent no-op recorded six times in
   CLAUDE.md. A field with no path is not editable, so it cannot pretend.

   ⚠️ **CANCEL REALLY DISCARDS.** Every edit lands in a local draft and only Apply commits, so
   a mid-demo keystroke in the wrong box costs nothing. That is also why the draft is keyed on
   the drawer's identity and reset when it changes: reopening a node must not show the last
   node's half-typed text.

   ⚠️ **THE COMBOBOXES ARE NOT `<select>`.** The real ones are MUI comboboxes whose options
   were not captured, so these render the closed control with its measured chevron and do not
   open. A dropdown listing invented options is worse than one that does not open.
   ============================================================================= */


/**
 * A textarea that is as tall as its text, up to `maxLines`, then scrolls.
 *
 * ⚠️ **MEASURED, NOT CHOSEN.** The real drawer's boxes come out at 46 / 69 / 161 px — exact
 * multiples of the 23px line box — so they size to their content rather than to a fixed
 * height. One 362-character rule sits at 69 with `overflow-y: auto` and its text clipped
 * mid-sentence, which is what pins the cap: a rule stops growing at THREE lines and scrolls.
 * Ours were a flat 84px, and 230px for the two marked `--tall`, so a two-sentence description
 * sat in a half-empty well.
 *
 * ⚠️ The height has to be measured from `scrollHeight` rather than derived from the character
 * count, because where the text wraps depends on the box's width — and the drawer is
 * `max-width: 100vw`, so that width genuinely changes. Re-measured on resize for the same
 * reason.
 */
function AutoTa({ value, maxLines, className = "", placeholder, onChange }: {
  value: string; maxLines: number; className?: string; placeholder?: string;
  onChange?: (v: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      const line = parseFloat(cs.lineHeight) || 23;
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      el.style.height = "auto";                       // let scrollHeight report the content
      const want = el.scrollHeight;
      const max = maxLines * line + pad;
      el.style.height = `${Math.min(want, max) + border}px`;
      el.style.overflowY = want > max ? "auto" : "hidden";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value, maxLines]);
  return (
    <textarea ref={ref} className={`wnd-ta ${className}`} value={value} placeholder={placeholder}
      readOnly={!onChange} onChange={onChange ? (e) => onChange(e.target.value) : undefined} />
  );
}

/** What Apply hands back: dot-path -> new value, ready for `applyEdits`. */
export type DrawerApply = { path: string; value: unknown }[];

/**
 * ONE combobox for all three pickers — the action, the signal and the info field.
 *
 * ⚠️ All three are the same MUI autocomplete in the capture (`signal-select`,
 * `addInfoField-select` and the Action one), so three copies would drift on the first fix.
 * Read-only when it has no `onPick`, which is how the voice drawers keep the static control.
 */
function Combo({ id, value, placeholder, options, onPick, openId, setOpenId }: {
  id: string; value: string; placeholder: string; options: string[];
  onPick?: (v: string) => void;
  openId: string | null; setOpenId: (v: string | null) => void;
}) {
  const open = openId === id;
  if (!onPick) {
    return (
      <div className={"wnd-combo" + (value ? "" : " wnd-combo--empty")}>
        <span>{value || placeholder}</span><Chevron />
      </div>
    );
  }
  return (
    <div className="wnd-pick">
      <button className={"wnd-combo wnd-combo--btn" + (value ? "" : " wnd-combo--empty")}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={(e) => { e.preventDefault(); setOpenId(open ? null : id); }}>
        <span>{value || placeholder}</span><Chevron />
      </button>
      {open ? (
        <ul className="wnd-picklist" role="listbox" aria-label={placeholder}>
          {options.length === 0 ? (
            /* ⚠️ SAYS SO RATHER THAN RENDERING AN EMPTY BOX. A prospect with no Signal Manager
               slice has no signals to offer, and a silently empty list reads as broken. */
            <li className="wnd-pickopt wnd-pickopt--none">Nothing to choose from</li>
          ) : options.map((o) => (
            <li key={o} role="option" aria-selected={o === value}
              className={"wnd-pickopt" + (o === value ? " wnd-pickopt--on" : "")}
              /* ⚠️ MOUSEDOWN, NOT CLICK: the outside-pointerdown handler would otherwise close
                 the list before the option's own click could run. */
              onMouseDown={(e) => { e.preventDefault(); onPick(o); }}>
              {o}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function WorkflowNodeDrawer({ d, onClose, onApply }: {
  d: NodeDrawer; onClose: () => void; onApply?: (edits: DrawerApply) => void;
}) {
  /* Escape closes, as the real drawer does. */
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const edits = "edits" in d ? d.edits : undefined;
  /* ⚠️ EDITING NEEDS BOTH: somewhere to write, and something to write with. Either missing and
     every control below falls back to `readOnly`, which is how the voice drawers stay as they
     were without a second component. */
  const live = !!(edits && onApply);

  /* ⚠️ THE DRAFT IS KEYED ON THE DRAWER'S IDENTITY. `d` is rebuilt on every render of the page
     (it is derived), so depending on the object would reset the draft on every keystroke;
     depending on nothing would carry one node's text into the next node opened. The title plus
     the write paths identify the node exactly. */
  const ident = useMemo(
    () => JSON.stringify([d.kind, "name" in d ? d.name : "", edits ?? null]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d.kind, "name" in d ? d.name : "", JSON.stringify(edits ?? null)],
  );
  const initial = useMemo(() => ({
    /* The action is part of the draft, so switching it is discarded by Cancel like any edit. */
    action: ("action" in d ? d.action : "inform") as ActionKind,
    destination: ("destination" in d ? d.destination : "") ?? "",
    signal: ("signal" in d ? d.signal : "") ?? "",
    collect: [...(("collect" in d ? d.collect : []) ?? [])].map((f) => f.name),
    question: ("question" in d ? d.question : "") ?? "",
    fallback: ("fallback" in d ? d.fallback : "") ?? "",
    handling: ("handling" in d ? d.handling : "") ?? "",
    looksLike: ("looksLike" in d ? d.looksLike : "") ?? "",
    segments: [...(("segments" in d ? d.segments : []) ?? [])],
    rules: [...(("rules" in d ? d.rules : []) ?? [])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ident]);
  const [draft, setDraft] = useState(initial);
  /* ⚠️ ONE OPEN AT A TIME, keyed by name rather than three booleans — which is also the right
     behaviour: opening the signal list closes the action list. */
  const [openCombo, setOpenCombo] = useState<string | null>(null);
  const [keyed, setKeyed] = useState(ident);
  if (keyed !== ident) { setKeyed(ident); setDraft(initial); setOpenCombo(null); }

  /**
   * ⚠️⚠️ CHOOSING AN ACTION RESETS THAT ACTION'S FIELDS, BECAUSE THAT IS WHAT WAS MEASURED —
   * the same node's What To Collect went from eleven entries to zero once the combobox had been
   * touched, and the instruction box came back empty with only its placeholder. Carrying the old
   * text across would leave an escalation instruction sitting under a Qualify question label.
   * ⚠️ It does NOT restore the original values when you switch back to where you started, which
   * is also measured (Inform was the original action and still showed an empty list). Cancel is
   * the way back, and it costs nothing because this all lives in the draft.
   * ⚠️ Two empty answer rows for Qualify, as the capture shows — they are DISPLAY only; `apply`
   * drops blank titles, so browsing the dropdown cannot leave empty boxes on the diagram.
   */
  const chooseAction = (k: ActionKind) => {
    setOpenCombo(null);
    setDraft((prev) => ({ ...prev, action: k, question: "", fallback: "", handling: "",
      /* The destination, the signal and the collect list are this action's configuration too,
         so they reset with the rest — measured, 11 collect fields to 0. */
      destination: "", signal: "",
      collect: collectOnSwitch(k).map((f) => f.name),
      segments: k === "qualify" ? ["", ""] : [] }));
  };

  /* ⚠️ POINTERDOWN IN THE CAPTURE PHASE, and Escape closes the LIST before the drawer.
     On bubble, a second click of the combobox would close the list here and immediately reopen
     it in the button's own onClick, so the trigger could never dismiss its own menu — the trap
     the Signal sidebar flyout and the Create Workflow combobox both already record. */
  useEffect(() => {
    if (!openCombo) return;
    /* Closes on a pointerdown outside ANY picker. Pointerdown on a DIFFERENT picker's button is
       inside `.wnd-pick`, so it does not close here and that button's own click opens it. */
    const down = (e: Event) => {
      if (!(e.target as HTMLElement).closest?.(".wnd-pick")) setOpenCombo(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpenCombo(null); } };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [openCombo]);
  const set = <K extends keyof typeof initial>(k: K, v: (typeof initial)[K]) =>
    setDraft((prev) => ({ ...prev, [k]: v }));

  /* ⚠️ ONLY WHAT CHANGED IS WRITTEN. Sending every field on every Apply would push an undo step
     for fields nobody touched and, worse, would rewrite a value the AI had edited in the
     meantime with the copy this drawer happened to open with. */
  const apply = () => {
    if (!live || !edits) { onClose(); return; }
    const out: DrawerApply = [];
    const str = (k: "question" | "fallback" | "handling" | "looksLike" | "destination" | "signal") => {
      const path = edits[k];
      if (path && draft[k] !== initial[k]) out.push({ path, value: draft[k] });
    };
    str("question"); str("fallback"); str("handling"); str("looksLike");
    str("destination"); str("signal");
    /* ⚠️ THE COLLECT LIST IS A LIST, so it is compared as one — and it is what the diagram's
       pills read, so a change here visibly resizes the node. */

    if (edits.rules && JSON.stringify(draft.rules) !== JSON.stringify(initial.rules)) {
      out.push({ path: edits.rules, value: draft.rules });
    }
    /* ⚠️⚠️ **SEGMENTS WRITE THE TREE'S CHILD NODES, NOT A LIST OF STRINGS.** The path points at
       the `paths` array the diagram draws, so an added answer has to arrive as a NODE or the
       renderer has nothing to draw and the new row silently does not appear. Existing nodes keep
       every other field they carry (action, icon, chips, their own children); only the title
       moves. A brand-new one gets the Inform default the product gives an unconfigured segment. */
    if (edits.segments && JSON.stringify(draft.segments) !== JSON.stringify(initial.segments)) {
      const was = "segmentNodes" in d ? d.segmentNodes : undefined;
      /* ⚠️⚠️ **A NEW ANSWER INHERITS ITS SIBLINGS' ACTION (9/17/2026).** Reported: an answer added
         in the "All Sales Inquiry Users" Qualify drawer came out saying **Inform**, white and
         untinted, where every other answer of that same question is a Qualify. The old default
         was a hardcoded Inform node with no `actionKind` at all, which is where both halves of
         that came from — the missing kind is what left the card white, because the tint is keyed
         on the action.
         Siblings are the right source: they are peers under one question, so the answers of a
         Qualify are Qualifies and the answers of one of THOSE are Informs — which is exactly the
         shape the capture draws. Falling back to Inform only when there is no sibling to copy. */
      const sibling = was?.[0];
      const fresh = sibling
        ? { action: sibling.action, actionIcon: sibling.actionIcon, actionKind: sibling.actionKind,
            tone: sibling.tone }
        : { action: "Inform", actionIcon: "info", actionKind: "inform", tone: "blue" };
      /* ⚠️ A BLANK ANSWER IS NOT A NODE. `Add` (and switching to Qualify, which shows two empty
         rows as the capture does) can leave an untitled row; writing it drew an empty box on the
         diagram, which is never what anyone meant. */
      const kept = draft.segments
        .map((title, i) => ({ node: was?.[i] ?? fresh, title }))
        .filter((x) => x.title.trim() !== "");
      out.push({
        path: edits.segments,
        value: kept.map((x) => ({ ...x.node, title: x.title })),
      });
    }
    /* ⚠️⚠️ THE ACTION WRITES THE NODE, THROUGH THE ONE SHAPE ALREADY PROVEN HERE — the containing
       array, exactly as `segments` has always written `…paths`. A per-field path one level deeper
       would be refused silently by `setByPath` on any demo whose override does not already reach
       it, which is this morning's `sms.extra.*` bug wearing a different hat.
       The old node is SPREAD, so its title, its lock and its own children survive. */
    if (d.kind === "action" && d.actionSlot) {
      const actionChanged = draft.action !== d.action;
      const collectChanged = JSON.stringify(draft.collect) !== JSON.stringify(initial.collect);
      if (actionChanged || collectChanged) {
        const { path, index, nodes } = d.actionSlot;
        out.push({
          path,
          value: nodes.map((n, i) => {
            if (i !== index) return n;
            const next: Record<string, unknown> = {
              ...n, ...(actionChanged ? nodeActionFields(draft.action) : {}),
            };
            /* ⚠️ THE PILLS *ARE* THE COLLECT LIST. `chooseAction` already set the draft to the
               new action's defaults, so one assignment serves both cases — and an empty list
               removes the key rather than storing `[]`, because Qualify draws no pills at all. */
            if (draft.collect.length) next.chips = draft.collect; else delete next.chips;
            return next;
          }),
        });
      }
    }
    if (out.length) onApply?.(out);
    onClose();
  };

  return (
    <div className="wnd-root" role="dialog" aria-modal="true" aria-label={d.title}>
      <div className="wnd-backdrop" onClick={onClose} />
      <div className="wnd-paper">
        <div className="wnd-head">
          <h2 className="wnd-title">{d.title}</h2>
          <button className="wnd-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div className="wnd-body">
          {d.kind === "trigger" && (
            <>
              <div className="wnd-strong">{d.summary}</div>
              {/* ⚠️ THE SMS DRAWER LISTS WHAT IS WIRED, under the count — one row per form and
                  one for the inbound number. The voice capture has none, so a drawer that passes
                  no rows renders exactly as before. */}
              {d.rows?.length ? (
                <div className="wnd-rows">
                  {d.rows.map((r) => <div className="wnd-row" key={r}>{r}</div>)}
                </div>
              ) : null}
              {/* ⚠️ `#00ACF1`, NOT the `#2666F9` accent every other link on the page uses.
                  Measured, and not something anyone would guess.
                  ⚠️ THREE LINKS ON SMS, TWO ON VOICE — the SMS capture adds "Go to forms",
                  which is the one its own trigger rows point at. Driven by the data rather than
                  hardcoded, so neither channel has to know about the other. */}
              <div className="wnd-links">
                {(d.links ?? ["Go to campaigns", "Go to promo numbers"]).map((l, i) => (
                  <span key={l}>
                    {i > 0 ? <span className="wnd-pipe">|</span> : null}
                    <a className="wnd-link" href="#" onClick={(e) => e.preventDefault()}>{l}</a>
                  </span>
                ))}
              </div>
            </>
          )}

          {d.kind === "intent" && (
            <>
              {/* Title-case in the DOM, uppercased in CSS — so a screenshot reading of
                  "INTENT NAME" would have baked the wrong string into the markup. */}
              <div className="wnd-eyebrow">Intent Name</div>
              <div className="wnd-value">{d.name}</div>

              <label className="wnd-label">What does this intent look like?</label>
              <AutoTa value={live ? draft.looksLike : d.looksLike} maxLines={8}
                onChange={live && edits?.looksLike ? (v) => set("looksLike", v) : undefined} />

              <label className="wnd-label">How would you like to define the conversation rules?</label>
              {/* ⚠️ NO RULES MEANS AN EMPTY STATE, NOT EMPTY ROWS — and this corrects an earlier
                  reading of mine. The first capture of Need Support showed three blank rule
                  boxes and I took that for the default; a capture of the same drawer at rest
                  shows `addList-empty-state` with the italic line below, so those three blanks
                  were someone having pressed Add three times. Rendering them by default
                  invented a shape the product does not start in. */}
              {(live ? draft.rules : d.rules).length === 0 && (
                <p className="wnd-empty">No conversation rules defined yet</p>
              )}
              {(live ? draft.rules : d.rules).map((r, i) => (
                <div className="wnd-rulerow" key={i}>
                  <AutoTa value={r} maxLines={3} className="wnd-ta--rule" placeholder="Enter rule..."
                    onChange={live && edits?.rules
                      ? (v) => set("rules", draft.rules.map((x, j) => (j === i ? v : x)))
                      : undefined} />
                  <button className="wnd-del" aria-label="Remove rule"
                    onClick={(e) => { e.preventDefault();
                      if (live && edits?.rules) set("rules", draft.rules.filter((_, j) => j !== i)); }}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                      <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </div>
              ))}
              <button className="wnd-add" onClick={(e) => { e.preventDefault();
                if (live && edits?.rules) set("rules", [...draft.rules, ""]); }}>
                <span className="material-icons">add</span>Add
              </button>
            </>
          )}

          {d.kind === "action" && (() => {
            /* ⚠️⚠️ THE ACTION IS A REAL PICKER (9/17/2026), and its five options are the
               product's own — measured from five captures of ONE drawer with the combobox
               switched between them. They are not five labels over one shape: Schedule Callback
               has no instruction box at all and a FIXED signal chip, Qualify alone has no Signal
               and no What To Collect, and only two of the five carry a destination row.
               ⚠️ READ-ONLY WHERE THERE IS NOWHERE TO WRITE. The picker needs `actionSlot`, which
               only the live SMS drawers carry, so every voice drawer keeps the static combobox it
               was signed off with. */
            const canPick = live && !!d.actionSlot;
            const kind = canPick ? draft.action : d.action;
            const switched = kind !== d.action;
            const copy = actionCopy(d.channel === "sms" ? "sms" : "voice", kind);
            /* Unswitched, every field is the spec's own — so the voice drawers and a freshly
               opened SMS drawer are byte-identical to before this shipped. */
            const dest = switched ? SMS_DESTINATION_PROMPT[kind] : d.destinationPrompt;
            const collect = switched ? collectOnSwitch(kind) : (d.collect ?? []);
            const phone = switched ? undefined : d.phone;
            return (
            <>
              <label className="wnd-label">Action</label>
              {/* ⚠️ THE LIST'S GEOMETRY IS THE SCREENSHOT PLUS THIS APP'S OWN ALREADY-MEASURED
                  combobox popup (options 32 tall at `6px 16px`, 16/400, paper radius 3, the MUI
                  shadow) — the open listbox is in NO capture, because all five saved with
                  `aria-expanded=false`. Flagged rather than presented as measured. */}
              <Combo id="action" value={copy.label} placeholder="Select action..."
                options={SMS_ACTION_OPTIONS.map((k) => SMS_ACTION_LABEL[k])}
                onPick={canPick
                  ? (label) => {
                      const k = SMS_ACTION_OPTIONS.find((x) => SMS_ACTION_LABEL[x] === label);
                      if (k) chooseAction(k);
                    }
                  : undefined}
                openId={openCombo} setOpenId={setOpenCombo} />

              <div className="wnd-strong wnd-strong--section">Description</div>
              {/* ⚠️ THE COPY IS PER CHANNEL. Four strings differ between the voice captures and
                  the SMS ones — see the table in `workflowDrawers.ts`. Sharing one table would
                  put "transfer them to the right queue" on a text conversation. */}
              <p className="wnd-prose">{copy.description}</p>

              {kind === "qualify" ? (
                <>
                  <label className="wnd-label wnd-label--info">{copy.prompt}<InfoDot /></label>
                  <input className="wnd-input" value={live ? draft.question : (d.question ?? "")}
                    readOnly={!(live && edits?.question)}
                    onChange={live && edits?.question ? (e) => set("question", e.target.value) : undefined} />
                  <label className="wnd-label wnd-label--info">Answers/Segments<InfoDot /></label>
                  {/* ⚠️ EACH ANSWER IS A CHILD NODE'S TITLE, so typing here renames a box on the
                      row below and Add draws a new one. That is the whole reason Apply writes the
                      tree's `paths` array rather than a list of strings. */}
                  {(live ? draft.segments : (d.segments ?? [])).map((seg, i) => (
                    <div className="wnd-rulerow" key={i}>
                      <input className="wnd-input wnd-input--row" value={seg}
                        placeholder="Answer 1, Answer 2, etc."
                        readOnly={!(live && edits?.segments)}
                        onChange={live && edits?.segments
                          ? (e) => set("segments", draft.segments.map((x, j) => (j === i ? e.target.value : x)))
                          : undefined} />
                      {live && edits?.segments ? (
                        <button className="wnd-del" aria-label="Remove answer"
                          onClick={(e) => { e.preventDefault();
                            set("segments", draft.segments.filter((_, j) => j !== i)); }}>
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
                            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <button className="wnd-add" onClick={(e) => { e.preventDefault();
                    if (live && edits?.segments) set("segments", [...draft.segments, ""]); }}>
                    <span className="material-icons">add</span>Add
                  </button>
                  <label className="wnd-label wnd-label--info">
                    If the agent can't determine the answer<InfoDot />
                  </label>
                  <AutoTa value={live ? draft.fallback : (d.fallback ?? "")} maxLines={4}
                    onChange={live && edits?.fallback ? (v) => set("fallback", v) : undefined} />
                </>
              ) : (
                <>
                  {/* ⚠️⚠️ SCHEDULE CALLBACK HAS NO INSTRUCTION BOX — measured, it goes Description
                      straight to Signal. `copy.prompt` is null for it, and the label is not
                      rendered rather than rendered empty. */}
                  {copy.prompt ? (
                    <>
                      <label className="wnd-label wnd-label--info">{copy.prompt}<InfoDot /></label>
                      {/* One rule for every action that has one: it grows to its own content, so
                          the six numbered routing steps and the two-line escalation instruction
                          each get the height they need without a per-action modifier. */}
                      <AutoTa value={live ? draft.handling : (d.handling ?? "")} maxLines={10}
                        onChange={live && edits?.handling ? (v) => set("handling", v) : undefined} />
                    </>
                  ) : null}
                  {/* ⚠️ THE PHONE ROW IS VOICE-ONLY, measured: an SMS Inform drawer goes straight
                      from the instruction box to Signal, and the SMS ESCALATE drawer asks for a
                      destination instead — as an empty combobox, not a number. */}
                  {phone !== undefined && isVoiceKind(kind) ? (
                    <>
                      <label className="wnd-label wnd-label--info">
                        {PHONE_PROMPT[kind as "inform" | "escalate"]}<InfoDot />
                      </label>
                      <input className="wnd-input" readOnly value={phone} />
                    </>
                  ) : null}
                  {/* ⚠️⚠️ AN INPUT, NOT A PICKER — measured `<input name=destination type=text>`
                      in both the original and the switched captures. We had been rendering an
                      invented `Select a destination...` combobox here. */}
                  {dest ? (
                    <>
                      <label className="wnd-label wnd-label--info">{dest}<InfoDot /></label>
                      <input className="wnd-input" value={live ? draft.destination : (d.destination ?? "")}
                        placeholder={switched ? SMS_DESTINATION_PLACEHOLDER[kind] : d.destinationPlaceholder}
                        readOnly={!(live && edits?.destination)}
                        onChange={live && edits?.destination
                          ? (e) => set("destination", e.target.value) : undefined} />
                    </>
                  ) : null}

                  {/* ⚠️⚠️ CALLBACK'S SIGNAL IS A FIXED CHIP, NOT A PICKER, and its label carries no
                      "(optional)" — that action always fires this one signal, so there is nothing
                      to choose. Measured: a filled MUI info chip, 20px tall at radius 100px. */}
                  {kind === "callback" ? (
                    <>
                      <label className="wnd-label wnd-label--info">Signal<InfoDot /></label>
                      <div className="wnd-signal">{SMS_CALLBACK_SIGNAL}</div>
                    </>
                  ) : (
                    <>
                      <label className="wnd-label wnd-label--info">
                        Signal <span className="wnd-optional">(optional)</span><InfoDot />
                      </label>
                      {/* ⚠️ THE OPTIONS ARE THE PROSPECT'S OWN SIGNALS, off the Signal Manager
                          list, so one offered here is one that account actually has. */}
                      <Combo id="signal" value={live ? draft.signal : (d.signal ?? "")}
                        placeholder="Select a signal..." options={d.signalChoices ?? []}
                        onPick={live && edits?.signal
                          ? (v) => { set("signal", v); setOpenCombo(null); } : undefined}
                        openId={openCombo} setOpenId={setOpenCombo} />
                    </>
                  )}

                  <div className="wnd-strong wnd-strong--section">
                    What To Collect <span className="wnd-optional">(optional)</span>
                  </div>
                  <p className="wnd-help">
                    This is primarily used to gather information about an individual and data fields
                    captured can be sent to various systems through integrations or custom webhooks.
                  </p>
                  {/* ⚠️ THE LIST IS EDITABLE NOW: each chip's × removes that field and the
                      picker below appends one. The × was drawn from the start and did nothing,
                      which is the dead-control shape this repo keeps paying for. */}
                  {(live && !!d.actionSlot ? draft.collect.map((n) => ({
                      name: n,
                      help: (d.infoChoices ?? []).find((o) => o.name === n)?.help ?? "",
                    })) : collect).map((f) => (
                    <div key={f.name}>
                      <span className="wnd-chip">
                        {f.name}
                        {live && !!d.actionSlot ? (
                          <button className="wnd-chip-x" aria-label={`Remove ${f.name}`}
                            onClick={(e) => { e.preventDefault();
                              set("collect", draft.collect.filter((x) => x !== f.name)); }}>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                              <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12z" />
                            </svg>
                          </button>
                        ) : (
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                            <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12z" />
                          </svg>
                        )}
                      </span>
                      {f.help ? <p className="wnd-help">{f.help}</p> : null}
                    </div>
                  ))}
                  <label className="wnd-label">Add Info Field</label>
                  {/* ⚠️ ALREADY-ADDED FIELDS ARE NOT OFFERED AGAIN — the same field twice on one
                      node is not a state the product can mean. */}
                  <Combo id="info" value="" placeholder="Select an info field..."
                    options={(d.infoChoices ?? []).map((o) => o.name)
                      .filter((n) => !(live && !!d.actionSlot ? draft.collect : collect.map((c) => c.name)).includes(n))}
                    onPick={live && !!d.actionSlot
                      ? (v) => { set("collect", [...draft.collect, v]); setOpenCombo(null); } : undefined}
                    openId={openCombo} setOpenId={setOpenCombo} />
                </>
              )}
            </>);
          })()}
        </div>

        {/* ⚠️ ONE button on the trigger drawer and TWO everywhere else — measured, and the
            trigger's is the FILLED one reading "Close", not an outlined Cancel. */}
        <div className="wnd-foot">
          {d.kind === "trigger" ? (
            <button className="wnd-btn wnd-btn--primary" onClick={onClose}>Close</button>
          ) : (
            <>
              <button className="wnd-btn wnd-btn--ghost" onClick={onClose}>Cancel</button>
              <button className="wnd-btn wnd-btn--primary" onClick={apply}>Apply</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg className="wnd-chev" viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
      <path d="M7 10l5 5 5-5z" />
    </svg>
  );
}

/** The little ⓘ beside most labels on the real drawers. */
function InfoDot() {
  return (
    <svg className="wnd-info" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8" />
    </svg>
  );
}
