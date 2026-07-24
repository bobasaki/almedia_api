import { useMemo, useState } from "react";

import { groupByDimension } from "../enrich";
import { formatEur } from "../format";
import type { Deal, DimensionId } from "../types";
import { BarList, type BarRow } from "./BarList";

/**
 * Budget per CM / country / category — committed internal budget with live
 * Almedia spend alongside, switchable between the three dimensions.
 */

const BUDGET_DIMENSIONS: Array<{ id: DimensionId; label: string }> = [
  { id: "cm", label: "Per CM" },
  { id: "country", label: "Per country" },
  { id: "category", label: "Per category" },
];

export function BudgetWidget({ deals }: { deals: Deal[] }) {
  const [dimension, setDimension] = useState<DimensionId>("cm");

  const rows = useMemo<BarRow[]>(
    () =>
      groupByDimension(deals, dimension)
        .filter((group) => group.intBudget > 0 || group.cost > 0)
        .map((group) => ({
          key: group.key,
          value: Math.max(group.intBudget, group.cost),
          display: formatEur(group.intBudget > 0 ? group.intBudget : group.cost),
          meta:
            group.intBudget > 0 && group.cost > 0
              ? `${formatEur(group.cost)} spent live`
              : group.intBudget > 0
                ? "booked"
                : "live spend only",
          tone: "neutral" as const,
        })),
    [deals, dimension],
  );

  return (
    <>
      <div className="segmented" role="tablist" aria-label="Budget dimension">
        {BUDGET_DIMENSIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={dimension === id}
            onClick={() => setDimension(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <BarList rows={rows} empty="No budgets recorded for the current filters." />
      <p className="widget-footnote">INT budget from the tracker · live spend from Almedia</p>
    </>
  );
}
