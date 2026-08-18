import { useEffect, useMemo, useRef, useState } from "react";
import { buildCatalog, TEMPLATE_SPECS, type TemplateField } from "../data/insightsCatalog";
import type { CustomerProfile } from "../data/schema";

/* =============================================================================
   InsightsConfigDrawer — the "Configuration" panel behind every chart template.
   -----------------------------------------------------------------------------
   Measured off the LIVE authenticated drawer (8/18/2026), Add Tile > any template:

     panel            position fixed, right 0, top 0, width 500, z-index 1200,
                      white, MUI elevation-16 shadow, padding 16px 16px 0
     "Configuration"  H1 24px / 400 / #15243e, margin 4px 0
     section heading  12px / 400 / #15243e, TEXT-TRANSFORM: UPPERCASE
     field label      16px / 400 / #15243e
     combobox         452 wide x 37 tall, 16px text, outlined
     Cancel           text button, ink #2666f9, 14px/500, pad 8/12
     Create           STARTS DISABLED: bg #e7e9eb, ink #a1a7b2
     Name             pre-filled with the template's own name

   THE SECTION HEADING IS THE TRAP ON THIS SCREEN. Its source text is
   "Data Display Options" at 12px and the CAPITALS COME FROM CSS. The Add Tile picker
   one screen earlier does the opposite: "CUSTOM" is 20px with literal capitals and
   `text-transform: none`. Copying either treatment to the other is visibly wrong, and
   the DOM only gives it up if you compare textContent against innerText.

   WHICH CATALOGUE EACH FIELD OFFERS comes from insightsCatalog's per-template spec,
   which was built from the live option COUNTS (121 measures vs 250 dimensions) rather
   than from field names — so Pie Chart's Category offers dimensions and its
   Size (Rank) offers measures, as on the real thing.
   ============================================================================= */

export interface CreatedTile { template: string; name: string; measures: string[]; dimensions: string[] }

export function InsightsConfigDrawer({
  template, profile, onCancel, onCreate,
}: {
  template: string | null;
  profile: CustomerProfile;
  onCancel: () => void;
  onCreate: (t: CreatedTile) => void;
}) {
  const spec = template ? TEMPLATE_SPECS[template] : undefined;
  const catalog = useMemo(() => buildCatalog(profile), [profile]);

  const [name, setName] = useState("");
  /* One slot per field; a repeatable field holds a list that "+ Add" grows. */
  const [values, setValues] = useState<string[][]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const nameRef = useRef<HTMLInputElement | null>(null);

  /* Opening a template resets the form and pre-fills Name with the template's own
     name, as the live drawer does. Without the reset the previous template's
     selections bleed into the next one. */
  useEffect(() => {
    if (!template || !spec) return;
    setName(template);
    setValues(spec.dataFields.map(() => [""]));
    setChecks({});
    const t = setTimeout(() => nameRef.current?.focus(), 240);
    return () => clearTimeout(t);
  }, [template, spec]);

  const open = !!template && !!spec;

  /* Create is enabled only once every REQUIRED field has a value, which is why the
     live button starts greyed. Optional fields (Calls by Hour's Categories) do not
     gate it. */
  const ready = !!spec && name.trim().length > 0 && spec.dataFields.every((f, i) =>
    f.optional ? true : (values[i]?.[0] ?? "").trim().length > 0);

  const optionsFor = (f: TemplateField) => (f.kind === "measure" ? catalog.measures : catalog.dimensions);

  const setSlot = (fi: number, si: number, v: string) =>
    setValues((prev) => prev.map((row, i) => (i === fi ? row.map((x, j) => (j === si ? v : x)) : row)));

  const addSlot = (fi: number) =>
    setValues((prev) => prev.map((row, i) => (i === fi ? [...row, ""] : row)));

  const submit = () => {
    if (!ready || !spec || !template) return;
    const measures: string[] = [];
    const dimensions: string[] = [];
    spec.dataFields.forEach((f, i) => {
      for (const v of values[i] ?? []) {
        if (!v.trim()) continue;
        (f.kind === "measure" ? measures : dimensions).push(v);
      }
    });
    onCreate({ template, name: name.trim(), measures, dimensions });
  };

  return (
    <>
      <div className={"icd-backdrop" + (open ? " icd-backdrop--on" : "")} onClick={onCancel} aria-hidden="true" />
      <aside className={"icd" + (open ? " icd--open" : "")} role="dialog" aria-modal="true"
        aria-label="Configuration" inert={!open}>
        <h1 className="icd-title">Configuration</h1>

        <div className="icd-body">
          <label className="icd-label" htmlFor="icd-name">Name</label>
          <input id="icd-name" ref={nameRef} className="icd-input" value={name}
            onChange={(e) => setName(e.target.value)} />

          {spec && spec.dataFields.length > 0 && (
            <p className="icd-section">Data Display Options</p>
          )}

          {spec?.dataFields.map((f, fi) => (
            <div className="icd-field" key={f.label}>
              <span className="icd-label">
                {f.label}
                {f.optional && <span className="icd-optional"> (optional)</span>}
              </span>
              {(values[fi] ?? [""]).map((v, si) => (
                <select key={si} className="icd-select" value={v}
                  onChange={(e) => setSlot(fi, si, e.target.value)}>
                  <option value="" />
                  {optionsFor(f).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ))}
              {/* "+ Add" only where the live drawer has it: Multi-Line's Attributes and
                  the Calls-by templates' Categories. */}
              {f.repeatable && (
                <button className="icd-add" type="button" onClick={() => addSlot(fi)}>Add</button>
              )}
            </div>
          ))}

          {spec?.chartOptions?.length ? (
            <>
              <p className="icd-section">Chart Display Options</p>
              {spec.chartOptions.map((o) => (
                <label className="icd-check" key={o}>
                  <input type="checkbox" checked={!!checks[o]}
                    onChange={(e) => setChecks((p) => ({ ...p, [o]: e.target.checked }))} />
                  <span>{o}</span>
                </label>
              ))}
            </>
          ) : null}
        </div>

        <div className="icd-foot">
          <button className="icd-cancel" type="button" onClick={onCancel}>Cancel</button>
          <button className="icd-create" type="button" disabled={!ready} onClick={submit}
            title={ready ? "" : "Choose a name and every required option first"}>
            Create
          </button>
        </div>
      </aside>
    </>
  );
}
