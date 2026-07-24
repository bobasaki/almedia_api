import { useMemo } from "react";

import { monthlyTrend } from "../charts";
import { formatEur, formatPct } from "../format";
import type { Deal } from "../types";

/**
 * Monthly return trend — cost-weighted return as a line over the 100% longterm
 * threshold, with spend as faint columns behind for context. The executive
 * "are we trending up or down" read across publish months.
 */

const W = 440;
const H = 250;
const PAD = { top: 16, right: 14, bottom: 30, left: 40 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

function toneOf(returnPct: number | null): string {
  if (returnPct === null) return "neutral";
  if (returnPct > 100) return "good";
  if (returnPct >= 80) return "neutral";
  if (returnPct >= 50) return "warn";
  return "bad";
}

export function TrendWidget({ deals }: { deals: Deal[] }) {
  const points = useMemo(() => monthlyTrend(deals), [deals]);

  const geometry = useMemo(() => {
    const measured = points.filter((point) => point.avgReturnPct !== null);
    const dataMax = Math.max(160, ...measured.map((point) => point.avgReturnPct ?? 0));
    const maxReturn = Math.min(dataMax, 300);
    const maxCost = Math.max(1, ...points.map((point) => point.cost));
    const step = points.length > 1 ? PLOT_W / (points.length - 1) : 0;
    const x = (index: number) =>
      points.length > 1 ? PAD.left + index * step : PAD.left + PLOT_W / 2;
    const y = (returnPct: number) =>
      PAD.top + PLOT_H - (Math.min(returnPct, maxReturn) / maxReturn) * PLOT_H;
    const barWidth = Math.min(34, points.length > 1 ? step * 0.5 : 60);
    return { maxReturn, maxCost, x, y, barWidth };
  }, [points]);

  if (points.length === 0) {
    return <p className="widget-empty">No live campaigns with a publish date for these filters.</p>;
  }

  const linePath = points
    .map((point, index) =>
      point.avgReturnPct === null
        ? null
        : { x: geometry.x(index), y: geometry.y(point.avgReturnPct) },
    )
    .filter((node): node is { x: number; y: number } => node !== null)
    .map((node, index) => `${index === 0 ? "M" : "L"}${node.x},${node.y}`)
    .join(" ");

  const hundredY = geometry.y(100);

  return (
    <>
      <svg
        className="scatter"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Monthly return trend"
        preserveAspectRatio="xMidYMid meet"
      >
        {[0, 100, geometry.maxReturn].map((tick) => (
          <g key={tick}>
            <line
              className="scatter-grid"
              x1={PAD.left}
              x2={W - PAD.right}
              y1={geometry.y(tick)}
              y2={geometry.y(tick)}
            />
            <text className="scatter-axis" x={PAD.left - 6} y={geometry.y(tick) + 3} textAnchor="end">
              {Math.round(tick)}%
            </text>
          </g>
        ))}
        {/* spend columns behind */}
        {points.map((point, index) => {
          const height = (point.cost / geometry.maxCost) * PLOT_H;
          return (
            <rect
              key={`bar-${point.month}`}
              className="trend-bar"
              x={geometry.x(index) - geometry.barWidth / 2}
              y={PAD.top + PLOT_H - height}
              width={geometry.barWidth}
              height={Math.max(0, height)}
            >
              <title>
                {point.label}: {formatEur(point.cost)} spend · {point.deals} deals
              </title>
            </rect>
          );
        })}
        {/* 100% reference */}
        <line className="scatter-ref" x1={PAD.left} x2={W - PAD.right} y1={hundredY} y2={hundredY} />
        {/* return line + dots */}
        {linePath && <path className="trend-line" d={linePath} fill="none" />}
        {points.map((point, index) =>
          point.avgReturnPct === null ? null : (
            <circle
              key={`dot-${point.month}`}
              className={`scatter-dot tone-${toneOf(point.avgReturnPct)}`}
              cx={geometry.x(index)}
              cy={geometry.y(point.avgReturnPct)}
              r={4.5}
            >
              <title>
                {point.label}: {formatPct(point.avgReturnPct)} return · {formatEur(point.cost)}
              </title>
            </circle>
          ),
        )}
        {/* month labels */}
        {points.map((point, index) => (
          <text
            key={`label-${point.month}`}
            className="scatter-axis"
            x={geometry.x(index)}
            y={H - 8}
            textAnchor="middle"
          >
            {point.label}
          </text>
        ))}
      </svg>
      <p className="widget-footnote">
        Cost-weighted return per publish month · dashed line = 100% · columns = spend
        {geometry.maxReturn === 300 ? " · return axis capped at 300%" : ""}
      </p>
    </>
  );
}
