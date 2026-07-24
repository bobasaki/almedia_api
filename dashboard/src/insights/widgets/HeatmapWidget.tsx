import { useMemo, useState } from "react";

import { crossTab, type HeatCell } from "../charts";
import { formatEur, formatPct } from "../format";
import type { DimensionId } from "../types";
import { DIMENSIONS } from "../types";
import type { Deal } from "../types";

/**
 * Segment heatmap — cost-weighted return across two dimensions (default
 * market × vertical). The single most direct "where should we push next month"
 * read: green cells with real spend behind them are where to lean in.
 */

const AXES = DIMENSIONS.filter(({ id }) => id !== "status" && id !== "month");

function toneOf(cell: HeatCell): string {
  if (cell.avgReturnPct === null) return "empty";
  if (cell.avgReturnPct > 100) return "good";
  if (cell.avgReturnPct >= 80) return "neutral";
  if (cell.avgReturnPct >= 50) return "warn";
  return "bad";
}

export function HeatmapWidget({ deals }: { deals: Deal[] }) {
  // Country now comes directly from Almedia, so the intended market × vertical
  // steering view remains populated even for campaigns without a booking row.
  const [rowDim, setRowDim] = useState<DimensionId>("country");
  const [colDim, setColDim] = useState<DimensionId>("vertical");

  const table = useMemo(() => crossTab(deals, rowDim, colDim), [deals, rowDim, colDim]);
  const byKey = useMemo(() => {
    const map = new Map<string, HeatCell>();
    for (const cell of table.cells) map.set(`${cell.row}|${cell.col}`, cell);
    return map;
  }, [table]);

  const rows = table.rows.slice(0, 8);
  const cols = table.cols.slice(0, 8);

  return (
    <>
      <div className="widget-controls">
        <label className="widget-control">
          <span>Rows</span>
          <select value={rowDim} onChange={(event) => setRowDim(event.target.value as DimensionId)}>
            {AXES.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="widget-control">
          <span>Columns</span>
          <select value={colDim} onChange={(event) => setColDim(event.target.value as DimensionId)}>
            {AXES.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows.length === 0 || cols.length === 0 ? (
        <p className="widget-empty">Not enough data to cross these dimensions.</p>
      ) : (
        <div className="heatmap-scroll">
          <table className="heatmap">
            <thead>
              <tr>
                <th aria-hidden="true" />
                {cols.map((col) => (
                  <th key={col} scope="col">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row}>
                  <th scope="row">{row}</th>
                  {cols.map((col) => {
                    const cell = byKey.get(`${row}|${col}`);
                    if (!cell) return <td key={col} className="heat-cell empty" />;
                    return (
                      <td
                        key={col}
                        className={`heat-cell tone-${toneOf(cell)}`}
                        title={`${row} · ${col}\n${formatPct(cell.avgReturnPct)} return · ${formatEur(
                          cell.cost,
                        )} · ${cell.deals} deals`}
                      >
                        <span className="heat-value">{formatPct(cell.avgReturnPct)}</span>
                        <span className="heat-meta">{formatEur(cell.cost)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="widget-footnote">
        Cost-weighted return per cell · green &gt;100% · hover for deal count · top 8 × 8 by spend
      </p>
    </>
  );
}
