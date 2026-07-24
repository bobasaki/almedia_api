import { useMemo } from "react";

import { returnDistribution } from "../charts";
import { formatEur, formatPct } from "../format";
import type { Deal } from "../types";

/**
 * Return distribution — how the measured portfolio spreads across the decision
 * tiers. A count histogram (bars) with the spend sitting in each band, so a lot
 * of deals in a thin-return band reads differently from a lot of money there.
 */
export function ReturnDistributionWidget({ deals }: { deals: Deal[] }) {
  const { bands, measured, medianReturnPct } = useMemo(
    () => returnDistribution(deals),
    [deals],
  );
  const maxDeals = Math.max(1, ...bands.map((band) => band.deals));

  if (measured === 0) {
    return <p className="widget-empty">No measured returns yet for the current filters.</p>;
  }

  return (
    <>
      <div className="histogram" role="img" aria-label="Return distribution by tier">
        {bands.map((band) => (
          <div className="histogram-col" key={band.label}>
            <span className="histogram-count">{band.deals}</span>
            <div className="histogram-track">
              <i
                className={`histogram-bar tone-${band.tone}`}
                style={{ height: `${(band.deals / maxDeals) * 100}%` }}
              />
            </div>
            <span className="histogram-label">{band.label}</span>
            <span className="histogram-meta">{formatEur(band.cost)}</span>
          </div>
        ))}
      </div>
      <p className="widget-footnote">
        {measured} measured deals · median return {formatPct(medianReturnPct)} · bars are deal
        count, figure below is spend in the band
      </p>
    </>
  );
}
