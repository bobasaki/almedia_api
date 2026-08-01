/**
 * The action plan stays a template on purpose: CLs generate the actual plan
 * by sending each section to the AI analyst, grounded on the current view.
 */

interface ActionPlanWidgetProps {
  onAsk: (prompt: string) => void;
  aiReady: boolean;
}

const SECTIONS = [
  {
    title: "Booking targets",
    hint: "Exact 'book more X' calls for CMs",
    prompt:
      "Write a BOOKING TARGETS section: concrete, quotable instructions a CM can act on this week. Do not use em dashes. Using only matured segment performance and the creator enrichment in the snapshot, produce up to 6 bullets in the imperative form 'Book more <niche/market/platform>, <supporting number>' and, where enrichment supports it, 'Book channels averaging ~<views> typical views at <ER>% engagement (that profile returned <return%>)'. Every bullet must cite a real number from the data. Skip any claim the snapshot can't support.",
  },
  {
    title: "Focus",
    hint: "Markets & verticals to prioritise next month",
    prompt:
      "Draft the FOCUS section for the applicable plan month. Prioritise up to 3 market × vertical opportunities using matured returns, delivery, and plan.remainingEur. Name the month and give one supporting number per bullet. If plan scope ignores an active filter, state that caveat.",
  },
  {
    title: "Rebook & extend",
    hint: "Channels earning a rebooking or longterm deal",
    prompt:
      "Draft the REBOOK & EXTEND section using only candidates.rebook and candidates.longterm. List each visible matured channel with return %, delivery %, and the next step. If either group is truncated, state its omitted count instead of implying the list is complete.",
  },
  {
    title: "Price adjustments",
    hint: "Deals to renegotiate before rebooking",
    prompt:
      "Draft the PRICE ADJUSTMENTS section using matured candidates.priceAdjustment (50–<80%) and candidates.underDelivery. For each visible channel, cite return %, delivery %, expected versus realised CPM, and use deliveryAlignedCostEur as the opening price anchor when present. If an input is missing, do not invent an exact correction.",
  },
  {
    title: "Drop / replace",
    hint: "Deals below the drop threshold",
    prompt:
      "Draft the DROP / REPLACE section using only matured candidates.drop. For each visible channel, cite return %, cost, market, and vertical, then recommend a replacement profile supported by stronger segments in the snapshot. Never classify candidates.notActionableYet as drops. State omitted counts if truncated.",
  },
  {
    title: "Scouting priorities",
    hint: "Where CMs should push outreach next",
    prompt:
      "Draft the SCOUTING PRIORITIES section for the applicable plan month. Combine plan.remainingEur with matured segment performance to name up to 5 CM × market × vertical × size opportunities. Do not claim vertical- or size-level plan headroom because plan rows are only CM × market × month; label that part as a performance-based recommendation.",
  },
];

export function ActionPlanWidget({ onAsk, aiReady }: ActionPlanWidgetProps) {
  return (
    <>
      <ol className="plan-sections">
        {SECTIONS.map((section) => (
          <li key={section.title}>
            <div className="plan-copy">
              <strong>{section.title}</strong>
              <p>{section.hint}</p>
            </div>
            <button
              type="button"
              className="button"
              disabled={!aiReady}
              onClick={() => onAsk(section.prompt)}
            >
              Draft with AI
            </button>
          </li>
        ))}
      </ol>
      <p className="widget-footnote">
        Kept as a template on purpose. Generate each section with the analyst against the data
        currently in view, then edit before sharing.
      </p>
    </>
  );
}
