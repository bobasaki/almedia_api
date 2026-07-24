import { useMemo } from "react";

import { formatShare } from "../format";
import type { Deal } from "../types";

/** % of published content — booked deals that actually went live. */

export function PublishedWidget({ deals }: { deals: Deal[] }) {
  const stats = useMemo(() => {
    const withStatus = deals.filter((deal) => deal.status !== null);
    const count = (statuses: string[]) =>
      withStatus.filter((deal) => statuses.includes(deal.status ?? "")).length;
    const live = count(["booked", "published", "longterm"]);
    const published = count(["published", "longterm"]);
    return {
      share: live > 0 ? published / live : null,
      published,
      booked: count(["booked"]),
      pipeline: count(["pipeline"]),
      dropped: count(["dropped"]),
      longterm: count(["longterm"]),
    };
  }, [deals]);

  const angle = (stats.share ?? 0) * 360;
  const tone = stats.share === null ? "neutral" : stats.share >= 0.7 ? "good" : stats.share >= 0.4 ? "warn" : "bad";

  return (
    <>
      <div className="published-layout">
        <div
          className={`donut tone-donut-${tone}`}
          style={{ ["--donut-angle" as string]: `${angle}deg` }}
          role="img"
          aria-label={`${formatShare(stats.share)} of booked content published`}
        >
          <strong>{formatShare(stats.share)}</strong>
          <span>published</span>
        </div>
        <ul className="published-legend">
          <li>
            <strong>{stats.published}</strong> published <em>({stats.longterm} longterm)</em>
          </li>
          <li>
            <strong>{stats.booked}</strong> booked, awaiting publication
          </li>
          <li>
            <strong>{stats.pipeline}</strong> in pipeline
          </li>
          <li>
            <strong>{stats.dropped}</strong> dropped
          </li>
        </ul>
      </div>
      <p className="widget-footnote">Published + longterm as a share of all booked deals</p>
    </>
  );
}
