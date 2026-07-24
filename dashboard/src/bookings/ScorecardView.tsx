import { useEffect, useMemo, useState } from "react";

import type { Scorecard, ScorecardRow, TierCounts } from "../../../src/bookings/scorecard";
import { fetchScorecard } from "./api";
import { currentIsoMonth, formatEurCompact, formatMonth, formatPercent } from "./format";

/**
 * Scorecard view — booked vs Plan targets per CM × market × month, the
 * replacement for the sheet's Dashboard tab.
 */

const TIER_LABELS: Array<{ key: keyof TierCounts; label: string }> = [
  { key: "under10k", label: "<10k" },
  { key: "from10kTo20k", label: "10–20k" },
  { key: "from20kTo50k", label: "20–50k" },
  { key: "over50k", label: "50k+" },
];

function paceBadge(pace: number | null): { className: string; label: string } | null {
  if (pace === null) return null;
  if (pace >= 1) return { className: "pace-ahead", label: `${formatPercent(pace)} pace · on track` };
  if (pace >= 0.75) return { className: "pace-close", label: `${formatPercent(pace)} pace` };
  return { className: "pace-behind", label: `${formatPercent(pace)} pace · behind` };
}

function ProgressBar({ utilization }: { utilization: number | null }) {
  if (utilization === null) return <div className="progress-track progress-untargeted" />;
  const width = Math.min(1, utilization) * 100;
  return (
    <div className="progress-track">
      <i className={utilization >= 1 ? "progress-fill progress-done" : "progress-fill"} style={{ width: `${width}%` }} />
    </div>
  );
}

function TierChips({ row }: { row: ScorecardRow }) {
  if (!row.targetTiers) return <span className="tier-note">no plan</span>;
  return (
    <span className="tier-chips">
      {TIER_LABELS.map(({ key, label }) => {
        const planned = row.targetTiers?.[key] ?? 0;
        const booked = row.bookedTiers[key];
        if (planned === 0 && booked === 0) return null;
        return (
          <span
            key={key}
            className={booked >= planned ? "chip chip-done" : "chip"}
            title={`${label}: ${booked} booked of ${planned} planned`}
          >
            {label} {booked}/{planned}
          </span>
        );
      })}
    </span>
  );
}

export function ScorecardView() {
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<string>("all");

  useEffect(() => {
    const controller = new AbortController();
    fetchScorecard(controller.signal)
      .then((loaded) => {
        setScorecard(loaded);
        const current = currentIsoMonth();
        if (loaded.rows.some((row) => row.month === current)) setMonthFilter(current);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Unable to load the scorecard");
      });
    return () => controller.abort();
  }, []);

  const rows = useMemo(
    () =>
      (scorecard?.rows ?? []).filter((row) => monthFilter === "all" || row.month === monthFilter),
    [scorecard, monthFilter],
  );
  const monthOptions = useMemo(
    () => [...new Set((scorecard?.rows ?? []).map((row) => row.month))].sort(),
    [scorecard],
  );

  if (!scorecard && !error) {
    return (
      <main className="loading-state" aria-live="polite">
        <div className="loader" />
        <h1>Loading scorecard</h1>
        <p>Comparing bookings against the plan…</p>
      </main>
    );
  }

  if (error && !scorecard) {
    return (
      <main className="error-state">
        <p className="eyebrow">Scorecard unavailable</p>
        <h1>The scorecard could not be loaded</h1>
        <p>{error}</p>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <section className="hero">
        <div>
          <p className="eyebrow">Plan vs booked</p>
          <h1>Are we on pace?</h1>
          <p className="hero-copy">
            Committed budget (booked, published, longterm) against each CM's monthly plan target.
          </p>
        </div>
      </section>

      <section className="month-grid" aria-label="Monthly totals">
        {scorecard?.months.map((month) => {
          const badge = paceBadge(month.pace);
          return (
            <article className="panel month-card" key={month.month}>
              <p className="eyebrow">{formatMonth(month.month)}</p>
              <strong>
                {formatEurCompact(month.bookedEur)}
                <span> / {formatEurCompact(month.targetEur)}</span>
              </strong>
              <ProgressBar utilization={month.utilization} />
              <p className="month-meta">
                {formatPercent(month.utilization)} of target
                {month.dropoutRate !== null && ` · ${formatPercent(month.dropoutRate)} dropout`}
                {month.counts.pipeline > 0 && ` · ${month.counts.pipeline} in pipeline`}
              </p>
              {badge && <span className={`pace-badge ${badge.className}`}>{badge.label}</span>}
            </article>
          );
        })}
        {scorecard?.months.length === 0 && (
          <p className="table-empty">No targets or dated bookings yet — seed targets or add deals first.</p>
        )}
      </section>

      {scorecard !== null && scorecard.unscheduledCount > 0 && (
        <div className="inline-error" role="note">
          {scorecard.unscheduledCount} booking{scorecard.unscheduledCount === 1 ? "" : "s"} have no
          target month and are not counted here.
        </div>
      )}

      <section className="panel table-panel">
        <div className="panel-heading table-heading">
          <div><p className="eyebrow">Breakdown</p><h2>CM × market targets</h2></div>
          <label className="month-filter">
            <span>Month</span>
            <select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
              <option value="all">All months</option>
              {monthOptions.map((month) => (
                <option key={month} value={month}>{formatMonth(month)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>CM</th>
                <th>Market</th>
                <th>Month</th>
                <th className="numeric">Booked</th>
                <th className="numeric">Target</th>
                <th className="progress-column">Progress</th>
                <th className="secondary-column">Deal sizes</th>
                <th className="numeric secondary-column">Committed</th>
                <th className="numeric secondary-column">Dropout</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const committed = row.counts.booked + row.counts.published + row.counts.longterm;
                const badge = paceBadge(row.pace);
                return (
                  <tr key={`${row.cm}-${row.market}-${row.month}`}>
                    <td className="campaign-name">{row.cm ?? "—"}</td>
                    <td>{row.market ?? "—"}</td>
                    <td>{formatMonth(row.month)}</td>
                    <td className="numeric metric-emphasis">{formatEurCompact(row.bookedEur)}</td>
                    <td className="numeric">{formatEurCompact(row.targetEur)}</td>
                    <td className="progress-column">
                      <div className="progress-cell">
                        <ProgressBar utilization={row.utilization} />
                        <span>{row.targetEur === null ? "no plan" : formatPercent(row.utilization)}</span>
                        {badge && <span className={`pace-badge ${badge.className}`}>{badge.label}</span>}
                      </div>
                    </td>
                    <td className="secondary-column"><TierChips row={row} /></td>
                    <td className="numeric secondary-column">
                      {committed}
                      {row.counts.pipeline > 0 && <span className="booking-note">+{row.counts.pipeline} pipeline</span>}
                    </td>
                    <td className="numeric secondary-column">{formatPercent(row.dropoutRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="table-empty">No rows for this month.</p>}
        </div>
      </section>
    </main>
  );
}
