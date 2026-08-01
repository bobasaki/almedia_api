import { useMemo } from "react";

import { bookingSuggestions, type Suggestion } from "../suggestions";
import type { Deal } from "../types";

/**
 * Booking suggestions — concrete, data-grounded actions for CLs and CMs, read
 * straight off the matured returns in view (no AI needed). One button hands the
 * whole set to the analyst to expand into a shareable brief.
 */

const KIND_LABEL: Record<Suggestion["kind"], string> = {
  "book-more": "Book more",
  "creator-profile": "Creator profile",
  rebook: "Rebook",
  platform: "Platform",
  size: "Deal size",
  reduce: "Reduce",
};

const KIND_TONE: Record<Suggestion["kind"], string> = {
  "book-more": "good",
  "creator-profile": "good",
  rebook: "good",
  platform: "neutral",
  size: "neutral",
  reduce: "bad",
};

interface SuggestionsWidgetProps {
  deals: Deal[];
  onAsk: (prompt: string) => void;
  aiReady: boolean;
}

export function SuggestionsWidget({ deals, onAsk, aiReady }: SuggestionsWidgetProps) {
  const suggestions = useMemo(() => bookingSuggestions(deals), [deals]);

  if (suggestions.length === 0) {
    return (
      <p className="widget-empty">
        Not enough matured returns yet to suggest bookings. Suggestions appear once campaigns pass 14
        days and returns settle.
      </p>
    );
  }

  const askForBrief = () => {
    const lines = suggestions.map((item) => `- ${item.headline}: ${item.detail}`).join("\n");
    onAsk(
      "Turn these booking suggestions into a short, shareable brief for CMs. " +
        "Group by book more, rebook, and reduce, keep every number, and add the next concrete step per line. " +
        "Only use the evidence in the current view.\n\n" +
        lines,
    );
  };

  return (
    <>
      <ul className="suggestion-list">
        {suggestions.map((item) => (
          <li key={item.id} className={`suggestion-item tone-edge-${KIND_TONE[item.kind]}`}>
            <div className="suggestion-head">
              <span className={`suggestion-tag tone-${KIND_TONE[item.kind]}`}>
                {KIND_LABEL[item.kind]}
              </span>
              <strong>{item.headline}</strong>
            </div>
            <p>{item.detail}</p>
            <span className="suggestion-metric">{item.metric}</span>
          </li>
        ))}
      </ul>
      <div className="suggestion-actions">
        <button type="button" className="button" disabled={!aiReady} onClick={askForBrief}>
          Draft booking brief with AI
        </button>
      </div>
      <p className="widget-footnote">
        Based only on matured returns (14+ days since publish) in the current view.
      </p>
    </>
  );
}
