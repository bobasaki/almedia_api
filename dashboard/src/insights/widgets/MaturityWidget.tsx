import { useMemo } from "react";

import { maturityMix } from "../charts";
import { formatEur, formatPct } from "../format";
import type { Deal } from "../types";

/**
 * Maturity mix — matured vs still-accruing spend. Almedia gives a single return
 * snapshot, not a maturation curve, so this is the honest guardrail: a matured
 * return can be acted on; a maturing one is incomplete and shouldn't be judged.
 */

function toneClass(returnPct: number | null): string {
  if (returnPct === null) return "tone-text-neutral";
  if (returnPct > 100) return "tone-text-good";
  if (returnPct >= 80) return "tone-text-neutral";
  if (returnPct >= 50) return "tone-text-warn";
  return "tone-text-bad";
}

export function MaturityWidget({ deals }: { deals: Deal[] }) {
  const mix = useMemo(() => maturityMix(deals), [deals]);
  const total = mix.matured.deals + mix.maturing.deals + mix.unknown.deals;

  if (total === 0) {
    return <p className="widget-empty">No live campaigns for the current filters.</p>;
  }

  const totalCost = mix.matured.cost + mix.maturing.cost + mix.unknown.cost;
  const segments = [
    { key: "matured", label: "Matured", bucket: mix.matured, tone: "tone-good" },
    { key: "maturing", label: "Maturing", bucket: mix.maturing, tone: "tone-warn" },
    { key: "unknown", label: "No date", bucket: mix.unknown, tone: "tone-neutral" },
  ];

  return (
    <>
      <div className="maturity-bar" role="img" aria-label="Spend by maturity">
        {segments.map((segment) =>
          segment.bucket.cost <= 0 ? null : (
            <i
              key={segment.key}
              className={`maturity-seg ${segment.tone}`}
              style={{ width: `${(segment.bucket.cost / totalCost) * 100}%` }}
              title={`${segment.label}: ${formatEur(segment.bucket.cost)} · ${segment.bucket.deals} deals`}
            />
          ),
        )}
      </div>

      <div className="stat-row">
        <div className="stat">
          <span>Matured return</span>
          <strong className={toneClass(mix.matured.avgReturnPct)}>
            {formatPct(mix.matured.avgReturnPct)}
          </strong>
        </div>
        <div className="stat">
          <span>Maturing return</span>
          <strong className={toneClass(mix.maturing.avgReturnPct)}>
            {formatPct(mix.maturing.avgReturnPct)}
          </strong>
        </div>
        <div className="stat">
          <span>Matured deals</span>
          <strong>{mix.matured.deals}</strong>
        </div>
        <div className="stat">
          <span>Maturing deals</span>
          <strong>{mix.maturing.deals}</strong>
        </div>
      </div>
      <p className="widget-footnote">
        Matured = 14+ days since publish · maturing returns are still accruing, judge them later
      </p>
    </>
  );
}
