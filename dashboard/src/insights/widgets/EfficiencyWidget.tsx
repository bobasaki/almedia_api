import { useMemo } from "react";

import { efficiencyPoints } from "../charts";
import { formatCount, formatEur, formatPct } from "../format";
import type { Deal } from "../types";

/**
 * Efficiency scatter — spend (X) against return % (Y), bubble size by views.
 * The efficient frontier at a glance: points above the 100% line are longterm
 * candidates, and big cheap bubbles high up are the deals to clone.
 */

const W = 440;
const H = 280;
const PAD = { top: 16, right: 16, bottom: 34, left: 44 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export function EfficiencyWidget({ deals }: { deals: Deal[] }) {
  const points = useMemo(() => efficiencyPoints(deals), [deals]);

  const scales = useMemo(() => {
    const maxCost = Math.max(1, ...points.map((point) => point.cost));
    const dataMax = Math.max(160, ...points.map((point) => point.returnPct));
    // Cap the axis so a single runaway return doesn't flatten the rest; points
    // above the cap pin to the top edge (flagged in the footnote).
    const maxReturn = Math.min(dataMax, 300);
    const clipped = dataMax > maxReturn;
    const maxViews = Math.max(1, ...points.map((point) => point.views ?? 0));
    const x = (cost: number) => PAD.left + (cost / maxCost) * PLOT_W;
    const y = (returnPct: number) =>
      PAD.top + PLOT_H - (Math.min(returnPct, maxReturn) / maxReturn) * PLOT_H;
    const r = (views: number | null) => 4 + Math.sqrt((views ?? 0) / maxViews) * 9;
    return { maxCost, maxReturn, clipped, x, y, r };
  }, [points]);

  if (points.length === 0) {
    return <p className="widget-empty">No measured, priced deals for the current filters.</p>;
  }

  const hundredY = scales.y(100);
  const yTicks = [0, 100, 200, scales.maxReturn].filter(
    (tick, index, all) => all.indexOf(tick) === index && tick <= scales.maxReturn,
  );

  return (
    <>
      <svg
        className="scatter"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Spend versus return scatter"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Y grid + labels */}
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              className="scatter-grid"
              x1={PAD.left}
              x2={W - PAD.right}
              y1={scales.y(tick)}
              y2={scales.y(tick)}
            />
            <text className="scatter-axis" x={PAD.left - 6} y={scales.y(tick) + 3} textAnchor="end">
              {Math.round(tick)}%
            </text>
          </g>
        ))}
        {/* 100% breakeven-to-longterm reference */}
        <line
          className="scatter-ref"
          x1={PAD.left}
          x2={W - PAD.right}
          y1={hundredY}
          y2={hundredY}
        />
        {/* points */}
        {points.map((point, index) => (
          <circle
            key={`${point.channelName}-${index}`}
            className={`scatter-dot tone-${point.tone}`}
            cx={scales.x(point.cost)}
            cy={scales.y(point.returnPct)}
            r={scales.r(point.views)}
          >
            <title>
              {point.channelName}: {formatPct(point.returnPct)} return · {formatEur(point.cost)} ·{" "}
              {formatCount(point.views)} views
            </title>
          </circle>
        ))}
        {/* X axis labels */}
        <text className="scatter-axis" x={PAD.left} y={H - 8} textAnchor="start">
          €0
        </text>
        <text className="scatter-axis" x={W - PAD.right} y={H - 8} textAnchor="end">
          {formatEur(scales.maxCost)}
        </text>
      </svg>
      <p className="widget-footnote">
        {points.length} deals · X spend · Y return · bubble = views · dashed line = 100% (longterm
        threshold){scales.clipped ? ` · returns above ${scales.maxReturn}% pinned to the top` : ""}
      </p>
    </>
  );
}
