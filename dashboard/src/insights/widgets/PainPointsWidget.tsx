import { useMemo, useState } from "react";

import { painPoints } from "../enrich";
import type { Deal, DimensionId } from "../types";

/** Pain points by market / vertical / client size, rule-derived from data. */

const TABS: Array<{ id: DimensionId | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "country", label: "By market" },
  { id: "vertical", label: "By vertical" },
  { id: "sizeTier", label: "By size" },
];

export function PainPointsWidget({ deals }: { deals: Deal[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const points = useMemo(() => painPoints(deals), [deals]);
  const visible = tab === "all" ? points : points.filter((point) => point.dimension === tab);

  return (
    <>
      <div className="segmented" role="tablist" aria-label="Pain point dimension">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="widget-empty">
          No pain points detected here. Either healthy, or not enough measured deals yet.
        </p>
      ) : (
        <ul className="pain-list">
          {visible.map((point) => (
            <li key={`${point.dimension}-${point.key}-${point.issue}`}>
              <span className={`pain-badge pain-${point.severity}`}>
                {point.severity === "high" ? "High" : "Medium"}
              </span>
              <p>{point.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
