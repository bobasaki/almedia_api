import type { ReactNode } from "react";

/** Horizontal bar rows used by the returns / budget / views widgets. */

export interface BarRow {
  key: string;
  value: number | null;
  display: string;
  meta?: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}

interface BarListProps {
  rows: BarRow[];
  /** Scale bars against this max; defaults to the largest row value. */
  max?: number;
  empty?: ReactNode;
}

export function BarList({ rows, max, empty }: BarListProps) {
  const values = rows.map((row) => row.value ?? 0);
  const scale = max ?? Math.max(...values, 1);
  if (rows.length === 0) {
    return <p className="widget-empty">{empty ?? "No data for the current filters."}</p>;
  }
  return (
    <ul className="bar-list">
      {rows.map((row) => (
        <li key={row.key} className="bar-row">
          <div className="bar-row-heading">
            <span className="bar-row-label">{row.key}</span>
            <span className="bar-row-value">
              {row.display}
              {row.meta && <em>{row.meta}</em>}
            </span>
          </div>
          <div className="bar-track">
            <i
              className={`bar-fill tone-${row.tone ?? "neutral"}`}
              style={{ width: `${Math.min(100, Math.max(2, ((row.value ?? 0) / scale) * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
