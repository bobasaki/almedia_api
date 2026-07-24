import { useMemo, useState } from "react";

import { enrichmentOverview, verticalPerformance } from "./enrich";
import { formatCount, formatEur, formatPct, formatShare } from "./format";
import type { Deal, VerticalPerformance } from "./types";

type SortMode = "spend" | "return" | "engagement";

function returnTone(value: number | null): string {
  if (value === null) return "neutral";
  if (value > 100) return "good";
  if (value >= 80) return "neutral";
  if (value >= 50) return "warn";
  return "bad";
}

function sortRows(rows: VerticalPerformance[], mode: SortMode): VerticalPerformance[] {
  return [...rows].sort((a, b) => {
    if (mode === "return") return (b.avgReturnPct ?? -1) - (a.avgReturnPct ?? -1);
    if (mode === "engagement") {
      return (b.avgEngagementRatePct ?? -1) - (a.avgEngagementRatePct ?? -1);
    }
    return b.cost - a.cost;
  });
}

export function VerticalInsightsPanel({
  deals,
  onSelectVertical,
}: {
  deals: Deal[];
  onSelectVertical: (vertical: string) => void;
}) {
  const [sort, setSort] = useState<SortMode>("spend");
  const overview = useMemo(() => enrichmentOverview(deals), [deals]);
  const rows = useMemo(
    () => sortRows(verticalPerformance(deals), sort).slice(0, 12),
    [deals, sort],
  );

  return (
    <section className="panel vertical-insights-panel" aria-labelledby="vertical-insights-heading">
      <header className="vertical-insights-header">
        <div>
          <p className="eyebrow">Enrichment intelligence</p>
          <h2 id="vertical-insights-heading">Vertical performance</h2>
          <p>
            Compare controlled verticals by commercial performance and creator quality.
          </p>
        </div>
        <div className="segmented" role="tablist" aria-label="Sort verticals">
          {([
            ["spend", "Spend"],
            ["return", "Return"],
            ["engagement", "Engagement"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={sort === id}
              onClick={() => setSort(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="vertical-overview">
        <article>
          <span>Enrichment coverage</span>
          <strong>{formatShare(overview.coverageShare)}</strong>
          <small>{overview.enrichedCampaigns} of {overview.campaigns} campaigns</small>
        </article>
        <article>
          <span>Controlled verticals</span>
          <strong>{overview.verticals}</strong>
          <small>up to two per campaign</small>
        </article>
        <article>
          <span>Avg engagement</span>
          <strong>{formatPct(overview.avgEngagementRatePct, 1)}</strong>
          <small>{overview.enrichedCreators} enriched creators</small>
        </article>
        <article>
          <span>Low safety risk</span>
          <strong>{formatShare(overview.brandSafeShare)}</strong>
          <small>of assessed creators</small>
        </article>
      </div>

      {rows.length === 0 ? (
        <p className="widget-empty">No enrichment-derived verticals match the current filters.</p>
      ) : (
        <div className="vertical-table-wrap">
          <table className="vertical-performance-table">
            <thead>
              <tr>
                <th>Vertical</th>
                <th className="numeric">Campaigns</th>
                <th className="numeric">Spend</th>
                <th className="numeric">Return</th>
                <th className="numeric">Views</th>
                <th className="numeric">D7 purchases</th>
                <th className="numeric">Engagement</th>
                <th className="numeric">Low risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.vertical}>
                  <td>
                    <button
                      type="button"
                      className="vertical-filter-button"
                      onClick={() => onSelectVertical(row.vertical)}
                    >
                      {row.vertical}
                    </button>
                  </td>
                  <td className="numeric">{row.campaigns}</td>
                  <td className="numeric">{formatEur(row.cost)}</td>
                  <td className={`numeric tone-text-${returnTone(row.avgReturnPct)}`}>
                    {formatPct(row.avgReturnPct)}
                  </td>
                  <td className="numeric">{formatCount(row.views)}</td>
                  <td className="numeric">{formatCount(row.d7Purchases)}</td>
                  <td className="numeric">{formatPct(row.avgEngagementRatePct, 1)}</td>
                  <td className="numeric">{formatShare(row.brandSafeShare)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="vertical-insights-note">
        Select a vertical to filter every insight and the AI analyst. Multi-vertical campaigns are
        included in each relevant vertical.
      </p>
    </section>
  );
}
