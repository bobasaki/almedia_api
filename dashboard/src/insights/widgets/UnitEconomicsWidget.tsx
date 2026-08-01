import { useMemo } from "react";

import { unitEconomics } from "../charts";
import { formatCount, formatEur, formatMoney, formatPct } from "../format";
import type { Deal } from "../types";

/**
 * Unit economics — the CPA cost view. Realised vs expected eCPM shows delivery
 * quality; cost per signup / D7 purchase shows what acquisition actually costs.
 * These are unit costs, not a nested funnel: Almedia's signup and purchase
 * figures are independently modeled, so we never chain them into conversions.
 */
export function UnitEconomicsWidget({ deals }: { deals: Deal[] }) {
  const metrics = useMemo(() => unitEconomics(deals), [deals]);

  if (metrics.measuredCampaigns === 0) {
    return <p className="widget-empty">No live campaign metrics for the current filters.</p>;
  }

  const cpmScale = Math.max(metrics.realisedCpm ?? 0, metrics.expectedCpm ?? 0, 1);
  const cpmBars = [
    { label: "Expected CPM", value: metrics.expectedCpm, tone: "tone-neutral" },
    { label: "Realised eCPM", value: metrics.realisedCpm, tone: "tone-good" },
  ];

  return (
    <>
      <p className="widget-subheading">CPM · priced vs delivered</p>
      <ul className="bar-list">
        {cpmBars.map((bar) => (
          <li key={bar.label} className="bar-row">
            <div className="bar-row-heading">
              <span className="bar-row-label">{bar.label}</span>
              <span className="bar-row-value">{formatEur(bar.value)}</span>
            </div>
            <div className="bar-track">
              <i
                className={`bar-fill ${bar.tone}`}
                style={{ width: `${Math.max(2, ((bar.value ?? 0) / cpmScale) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      <div className="stat-row">
        <div className="stat">
          <span>Signup rate</span>
          <strong>{formatPct(metrics.signupRate === null ? null : metrics.signupRate * 100, 2)}</strong>
        </div>
        <div className="stat">
          <span>Cost / signup</span>
          <strong>{formatEur(metrics.costPerSignup)}</strong>
        </div>
        <div className="stat">
          <span>Cost / D7 purchase</span>
          <strong>{formatEur(metrics.costPerPurchase)}</strong>
        </div>
        <div className="stat">
          <span>D7 purchases</span>
          <strong>{formatCount(metrics.d7Purchases)}</strong>
        </div>
        <div className="stat">
          <span>APPU · D14</span>
          <strong>{formatMoney(metrics.appuD14)}</strong>
        </div>
      </div>
      <p className="widget-footnote">
        {metrics.measuredCampaigns} campaigns with view data · {formatCount(metrics.views)} views ·
        signups &amp; purchases are Almedia-modeled
      </p>
    </>
  );
}
