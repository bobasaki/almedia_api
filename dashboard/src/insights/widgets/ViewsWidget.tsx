import { useMemo } from "react";

import { totalsOf } from "../enrich";
import { formatCount, formatPct } from "../format";
import type { Deal } from "../types";

/**
 * Views vs realised views — where delivery stands against what the CPM
 * pricing promised, with the biggest under-deliverers called out.
 */

export function ViewsWidget({ deals }: { deals: Deal[] }) {
  const totals = useMemo(() => totalsOf(deals), [deals]);
  const laggards = useMemo(
    () =>
      deals
        .filter((deal) => deal.deliveryPct !== null && deal.expectedViews !== null)
        .sort((a, b) => (a.deliveryPct ?? 0) - (b.deliveryPct ?? 0))
        .slice(0, 4),
    [deals],
  );

  const delivery = totals.deliveryPct;
  const deliveryTone = delivery === null ? "neutral" : delivery >= 90 ? "good" : delivery >= 70 ? "warn" : "bad";

  return (
    <>
      <div className="views-summary">
        <div>
          <p>Expected views</p>
          <strong>{formatCount(totals.expectedViews)}</strong>
        </div>
        <div>
          <p>Realised views</p>
          <strong>{formatCount(totals.actualViews)}</strong>
        </div>
        <div>
          <p>Delivery</p>
          <strong className={`tone-text-${deliveryTone}`}>{formatPct(delivery)}</strong>
        </div>
      </div>
      <div className="views-track" role="img" aria-label={`Delivery ${formatPct(delivery)}`}>
        <i
          className={`bar-fill tone-${deliveryTone}`}
          style={{ width: `${Math.min(100, Math.max(2, delivery ?? 0))}%` }}
        />
      </div>
      {laggards.length > 0 && (
        <div className="views-laggards">
          <p className="widget-subheading">Biggest under-deliverers</p>
          <ul>
            {laggards.map((deal) => (
              <li key={deal.campaignName ?? deal.channelKey}>
                <span>{deal.channelName}</span>
                <span className="tone-text-bad">{formatPct(deal.deliveryPct)}</span>
                <em>
                  {formatCount(deal.viewCount)} of {formatCount(deal.expectedViews)}
                </em>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="widget-footnote">Expected views = cost ÷ expected CPM × 1000</p>
    </>
  );
}
