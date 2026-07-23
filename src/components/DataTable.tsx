import type { InteractionRow, SignalColumn } from "../data/schema";

interface Props {
  dimensionColumns: string[];
  signalColumns: SignalColumn[];
  rows: InteractionRow[];
}

/* Dimension fields map to dimensionColumns in order (after the Details icon). */
const FIELD_ORDER: (keyof InteractionRow)[] = [
  "marketingSource",
  "marketingMedium",
  "marketingCampaign",
  "marketingSearchTerm",
  "landingPageUrl",
  "websiteJourney",
];

/* Columns the live report renders as non-sortable (no sort caret). */
const NO_SORT = new Set(["Full Landing Page URL"]);

export function DataTable({ dimensionColumns, signalColumns, rows }: Props) {
  return (
    <div className="table-scroll">
      <table className="report">
        <thead>
          <tr>
            <th className="no-sort col-details">Details</th>
            {dimensionColumns.map((c) => (
              <th key={c} className={NO_SORT.has(c) ? "no-sort" : undefined}>
                {c}
              </th>
            ))}
            {signalColumns.map((c, i) => (
              /* the first signal column is the sorted (desc) column in the live report */
              <th key={c.label} className={`col-signal${i === 0 ? " sorted-desc" : ""}`}>
                <span className="signal-head">
                  <span className="signal-head-label">{c.label}</span>
                  {c.badges.map((b) => (
                    <span key={b} className="badge-secondary">{b}</span>
                  ))}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              <td className="details">
                <span className="material-icons detail-icon">find_in_page</span>
              </td>
              {FIELD_ORDER.map((field) => (
                <td
                  key={field}
                  className={field === "landingPageUrl" ? "landing" : undefined}
                  title={field === "landingPageUrl" ? String(row[field]) : undefined}
                >
                  {row[field] as string}
                </td>
              ))}
              {signalColumns.map((c, ci) => (
                <td key={c.label} className="signal-cell">
                  {row.signals[ci] ? (
                    <i className="material-icons signal-yes">check_circle</i>
                  ) : (
                    <i className="material-icons signal-no">cancel</i>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
