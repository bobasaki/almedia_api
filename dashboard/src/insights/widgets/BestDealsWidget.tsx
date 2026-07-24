import { useMemo } from "react";

import { bestDealsByCm } from "../enrich";
import { formatEur, formatPct } from "../format";
import type { Deal } from "../types";

/** Per-CM leaderboard: who is landing the best-returning deals right now. */

export function BestDealsWidget({ deals }: { deals: Deal[] }) {
  const leaderboard = useMemo(() => bestDealsByCm(deals, 3), [deals]);

  if (leaderboard.length === 0) {
    return <p className="widget-empty">No measured deals for the current filters.</p>;
  }

  return (
    <>
      <ol className="cm-leaderboard">
        {leaderboard.map(({ cm, avgReturnPct, deals: top }, index) => (
          <li key={cm}>
            <div className="cm-row">
              <span className="cm-rank">{index + 1}</span>
              <strong className="cm-name">{cm}</strong>
              <span
                className={`cm-return ${
                  (avgReturnPct ?? 0) >= 100
                    ? "tone-text-good"
                    : (avgReturnPct ?? 0) >= 50
                      ? "tone-text-warn"
                      : "tone-text-bad"
                }`}
              >
                {formatPct(avgReturnPct)} avg
              </span>
            </div>
            <ul className="cm-deals">
              {top.map((deal) => (
                <li key={deal.campaignName ?? deal.channelKey}>
                  {deal.videoUrl ? (
                    <a
                      className="video-link"
                      href={deal.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open published video"
                    >
                      {deal.channelName} ↗
                    </a>
                  ) : (
                    <span>{deal.channelName}</span>
                  )}
                  <em>
                    {deal.country ?? "–"} · {formatEur(deal.cost)}
                  </em>
                  <span className="cm-deal-return">{formatPct(deal.returnPct)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className="widget-footnote">Ranked by cost-weighted return across measured campaigns</p>
    </>
  );
}
