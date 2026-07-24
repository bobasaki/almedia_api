import { useMemo } from "react";

import { roundAnalysis } from "../charts";
import { formatEur, formatPct, formatShare } from "../format";
import type { Deal } from "../types";
import { BarList, type BarRow } from "./BarList";

/**
 * Rebooking & round-over-round lift — does return improve as we re-engage a
 * creator? Rebook rate is the agency-compounding metric; the bars show
 * cost-weighted return per booking round (parsed from the campaign name).
 */
function toneOf(returnPct: number | null): BarRow["tone"] {
  if (returnPct === null) return "neutral";
  if (returnPct > 100) return "good";
  if (returnPct >= 80) return "neutral";
  if (returnPct >= 50) return "warn";
  return "bad";
}

export function RebookingWidget({ deals }: { deals: Deal[] }) {
  const { rounds, rebookedChannels, totalChannels, rebookRate } = useMemo(
    () => roundAnalysis(deals),
    [deals],
  );

  if (totalChannels === 0) {
    return <p className="widget-empty">No live campaigns for the current filters.</p>;
  }

  const rows: BarRow[] = rounds.map((group) => ({
    key: group.label,
    value: group.avgReturnPct,
    display: formatPct(group.avgReturnPct),
    meta: `${group.channels} channel${group.channels === 1 ? "" : "s"} · ${formatEur(group.cost)}`,
    tone: toneOf(group.avgReturnPct),
  }));

  return (
    <>
      <p className="concentration-lead">
        Rebook rate <strong>{formatShare(rebookRate)}</strong> · {rebookedChannels} of{" "}
        {totalChannels} channels booked more than once
      </p>
      <BarList
        rows={rows}
        max={Math.max(120, ...rows.map((row) => row.value ?? 0))}
        empty="No rounds to compare yet."
      />
      <p className="widget-footnote">
        Cost-weighted return per booking round · rising bars mean re-engaged creators pay off
      </p>
    </>
  );
}
