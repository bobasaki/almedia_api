import { useMemo, useState } from "react";

import { platformLabel } from "../../labels";
import { groupByDimension } from "../enrich";
import { formatEur, formatPct } from "../format";
import type { Deal, DimensionId } from "../types";
import { DIMENSIONS } from "../types";
import { BarList, type BarRow } from "./BarList";

/**
 * Returns by parameter — cost-weighted average return % grouped by any
 * dimension, colored by the rebooking tiers so CLs/CMs can see at a glance
 * where outreach and booking should shift next month.
 */

const GROUPABLE = DIMENSIONS.filter(({ id }) => id !== "status");

function toneOf(returnPct: number): BarRow["tone"] {
  if (returnPct > 100) return "good";
  if (returnPct >= 80) return "neutral";
  if (returnPct >= 50) return "warn";
  return "bad";
}

export function ReturnsWidget({ deals }: { deals: Deal[] }) {
  const [dimension, setDimension] = useState<DimensionId>("country");

  const rows = useMemo<BarRow[]>(
    () =>
      groupByDimension(deals, dimension)
        .filter((group) => group.avgReturnPct !== null)
        .sort((a, b) => (b.avgReturnPct ?? 0) - (a.avgReturnPct ?? 0))
        .map((group) => ({
          key: dimension === "platform" ? platformLabel(group.key) : group.key,
          value: group.avgReturnPct,
          display: formatPct(group.avgReturnPct),
          meta: `${group.measured} measured · ${formatEur(group.cost)}`,
          tone: toneOf(group.avgReturnPct ?? 0),
        })),
    [deals, dimension],
  );

  return (
    <>
      <label className="widget-control">
        <span>Group by</span>
        <select
          value={dimension}
          onChange={(event) => setDimension(event.target.value as DimensionId)}
        >
          {GROUPABLE.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <BarList
        rows={rows}
        max={Math.max(120, ...rows.map((row) => row.value ?? 0))}
        empty="No measured returns yet for the current filters."
      />
      <p className="widget-footnote">
        Cost-weighted return · &gt;100% longterm · 80–100% rebook · 50–80% adjust price · &lt;50%
        drop
      </p>
    </>
  );
}
