import { useMemo } from "react";

import { spendConcentration } from "../charts";
import { formatEur, formatShare } from "../format";
import type { Deal } from "../types";

/**
 * Spend concentration (Pareto) — how much of the budget rides on a handful of
 * channels. A dependency-risk read: the cumulative line climbing steeply means
 * a few creators carry the portfolio.
 */
export function ConcentrationWidget({ deals }: { deals: Deal[] }) {
  const { rows, othersCost, totalCost, topShare } = useMemo(
    () => spendConcentration(deals, 10),
    [deals],
  );

  if (rows.length === 0) {
    return <p className="widget-empty">No campaign spend for the current filters.</p>;
  }

  const maxShare = Math.max(...rows.map((row) => row.share));

  return (
    <>
      <p className="concentration-lead">
        Top {rows.length} channels carry <strong>{formatShare(topShare)}</strong> of{" "}
        {formatEur(totalCost)} spend
      </p>
      <ul className="bar-list">
        {rows.map((row) => (
          <li key={row.channelName} className="bar-row">
            <div className="bar-row-heading">
              <span className="bar-row-label">{row.channelName}</span>
              <span className="bar-row-value">
                {formatShare(row.share)}
                <em>{formatEur(row.cost)}</em>
              </span>
            </div>
            <div className="bar-track">
              <i
                className="bar-fill tone-neutral"
                style={{ width: `${Math.max(2, (row.share / maxShare) * 100)}%` }}
              />
              <i
                className="bar-cumulative"
                style={{ left: `${row.cumulativeShare * 100}%` }}
                aria-hidden="true"
              />
            </div>
          </li>
        ))}
      </ul>
      {othersCost > 0 && (
        <p className="widget-footnote">
          + {formatEur(othersCost)} across the remaining channels · tick marks show cumulative share
        </p>
      )}
    </>
  );
}
