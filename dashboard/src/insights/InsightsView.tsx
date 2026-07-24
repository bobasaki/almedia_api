import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Responsive,
  useContainerWidth,
  type LayoutItem,
  type ResponsiveLayouts,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";

import { buildDigest, dimensionOptions, filterDeals, totalsOf } from "./enrich";
import { formatCount, formatEur, formatPct, timeAgo } from "./format";
import { GridWidget } from "./GridWidget";
import "./insights.css";
import type { Deal, DimensionId, InsightFilters } from "./types";
import { ALL_FILTERS, DIMENSIONS } from "./types";
import { useAnalystChat } from "./useAnalystChat";
import { useDashboardLayout } from "./useDashboardLayout";
import { useDealsData } from "./useDealsData";
import { VerticalInsightsPanel } from "./VerticalInsightsPanel";
import { ActionPlanWidget } from "./widgets/ActionPlanWidget";
import { AiAnalystWidget } from "./widgets/AiAnalystWidget";
import { BestDealsWidget } from "./widgets/BestDealsWidget";
import { BudgetWidget } from "./widgets/BudgetWidget";
import { ConcentrationWidget } from "./widgets/ConcentrationWidget";
import { EfficiencyWidget } from "./widgets/EfficiencyWidget";
import { HeatmapWidget } from "./widgets/HeatmapWidget";
import { MaturityWidget } from "./widgets/MaturityWidget";
import { PainPointsWidget } from "./widgets/PainPointsWidget";
import { PublishedWidget } from "./widgets/PublishedWidget";
import { RebookingWidget } from "./widgets/RebookingWidget";
import { ReturnDistributionWidget } from "./widgets/ReturnDistributionWidget";
import { ReturnsWidget } from "./widgets/ReturnsWidget";
import { TrendWidget } from "./widgets/TrendWidget";
import { UnitEconomicsWidget } from "./widgets/UnitEconomicsWidget";
import { ViewsWidget } from "./widgets/ViewsWidget";

/**
 * The Insights tab: live Almedia data joined with the internal tracker on a
 * responsive, drag-and-resize widget grid. One filter bar drives every widget
 * and the AI analyst; the layout is a shared team view persisted server-side.
 */

const LAYOUT_PROFILE = "team";
const ROW_HEIGHT = 40;
const GRID_MARGIN: [number, number] = [18, 18];

const BREAKPOINTS = { lg: 1200, md: 900, sm: 600, xs: 0 } as const;
const COLS = { lg: 12, md: 8, sm: 4, xs: 1 } as const;

interface WidgetContext {
  filtered: Deal[];
  chat: ReturnType<typeof useAnalystChat>;
}

interface WidgetMeta {
  id: string;
  title: string;
  eyebrow: string;
  render: (ctx: WidgetContext) => ReactNode;
  wide?: boolean;
}

const WIDGETS: WidgetMeta[] = [
  { id: "returns", title: "Returns by parameter", eyebrow: "Outreach steering", render: ({ filtered }) => <ReturnsWidget deals={filtered} /> },
  { id: "views", title: "Views vs realised views", eyebrow: "Where we stand", render: ({ filtered }) => <ViewsWidget deals={filtered} /> },
  { id: "published", title: "Published content", eyebrow: "Delivery pipeline", render: ({ filtered }) => <PublishedWidget deals={filtered} /> },
  { id: "distribution", title: "Return distribution", eyebrow: "Portfolio spread", render: ({ filtered }) => <ReturnDistributionWidget deals={filtered} /> },
  { id: "funnel", title: "Unit economics", eyebrow: "CPM · cost per signup / purchase", render: ({ filtered }) => <UnitEconomicsWidget deals={filtered} /> },
  { id: "heatmap", title: "Segment heatmap", eyebrow: "Return by two dimensions", render: ({ filtered }) => <HeatmapWidget deals={filtered} /> },
  { id: "budget", title: "Budget", eyebrow: "Per CM · country · category", render: ({ filtered }) => <BudgetWidget deals={filtered} /> },
  { id: "bestdeals", title: "Best deals per CM", eyebrow: "Leaderboard", render: ({ filtered }) => <BestDealsWidget deals={filtered} /> },
  { id: "painpoints", title: "Pain points", eyebrow: "Market · vertical · size", render: ({ filtered }) => <PainPointsWidget deals={filtered} /> },
  { id: "concentration", title: "Spend concentration", eyebrow: "Pareto · dependency risk", render: ({ filtered }) => <ConcentrationWidget deals={filtered} /> },
  { id: "efficiency", title: "Efficiency scatter", eyebrow: "Spend vs return", render: ({ filtered }) => <EfficiencyWidget deals={filtered} /> },
  { id: "trend", title: "Return trend", eyebrow: "By publish month", render: ({ filtered }) => <TrendWidget deals={filtered} /> },
  { id: "rebooking", title: "Rebooking & round lift", eyebrow: "Do re-bookings pay off?", render: ({ filtered }) => <RebookingWidget deals={filtered} /> },
  { id: "maturity", title: "Maturity mix", eyebrow: "Matured vs still accruing", render: ({ filtered }) => <MaturityWidget deals={filtered} /> },
  {
    id: "actionplan",
    title: "Action plan",
    eyebrow: "Template — draft with the analyst",
    render: ({ chat }) => (
      <ActionPlanWidget onAsk={chat.send} aiReady={chat.configured === true && !chat.streaming} />
    ),
  },
  {
    id: "analyst",
    title: "AI analyst",
    eyebrow: "Grounded on the current view",
    wide: true,
    render: ({ chat }) => (
      <AiAnalystWidget
        messages={chat.messages}
        streaming={chat.streaming}
        configured={chat.configured}
        error={chat.error}
        onSend={chat.send}
        onClear={chat.clear}
      />
    ),
  },
];

/** Build the default lg layout: standard widgets 3-across, the analyst full-width. */
function buildDefaultLayout(): ResponsiveLayouts {
  const standard = WIDGETS.filter((widget) => !widget.wide);
  const lg: LayoutItem[] = standard.map((widget, index) => ({
    i: widget.id,
    x: (index % 3) * 4,
    y: Math.floor(index / 3) * 9,
    w: 4,
    h: 9,
    minW: 3,
    minH: 5,
  }));
  let wideY = Math.ceil(standard.length / 3) * 9;
  for (const widget of WIDGETS.filter((widget) => widget.wide)) {
    lg.push({ i: widget.id, x: 0, y: wideY, w: 12, h: 10, minW: 6, minH: 6 });
    wideY += 10;
  }
  return { lg };
}

const DEFAULT_LAYOUTS = buildDefaultLayout();

export function InsightsView() {
  const data = useDealsData();
  const [filters, setFilters] = useState<InsightFilters>(ALL_FILTERS);
  const { layouts, onLayoutChange, commit, reset, customized } = useDashboardLayout(
    LAYOUT_PROFILE,
    DEFAULT_LAYOUTS,
  );
  const { width, containerRef, mounted } = useContainerWidth();

  const filtered = useMemo(() => filterDeals(data.deals, filters), [data.deals, filters]);
  const options = useMemo(() => dimensionOptions(data.deals), [data.deals]);
  const totals = useMemo(() => totalsOf(filtered), [filtered]);

  const getContext = useCallback(
    () => buildDigest(filtered, filters, data.scorecard),
    [data.scorecard, filtered, filters],
  );
  const chat = useAnalystChat(getContext);

  const setFilter = (id: DimensionId, value: string) =>
    setFilters((current) => ({ ...current, [id]: value }));
  const hasActiveFilters = DIMENSIONS.some(({ id }) => filters[id] !== "all");

  if (data.loading) {
    return (
      <div className="loading-state">
        <div className="loader" aria-hidden="true" />
        <h1>Joining live Almedia data with the tracker…</h1>
        <p>Campaign metrics, bookings, and enrichment load together.</p>
      </div>
    );
  }

  const ctx: WidgetContext = { filtered, chat };

  return (
    <main className="dashboard insights">
      <section className="hero">
        <div>
          <p className="eyebrow">Live · auto-updates every 5 minutes</p>
          <h1>Insights</h1>
          <p className="hero-copy">
            Almedia campaign performance joined with the booking tracker. Drag and resize widgets to
            shape the shared team view; filters below drive every widget and the AI analyst.
          </p>
        </div>
        <div className="hero-side">
          <div className="view-actions">
            <p>
              {data.refreshing ? "Refreshing…" : `Updated ${timeAgo(data.fetchedAt)}`} ·{" "}
              {totals.deals} deals in view
            </p>
            <button
              type="button"
              className="button"
              disabled={data.refreshing}
              onClick={() => data.refresh(true)}
            >
              <span className={`refresh-icon ${data.refreshing ? "spinning" : ""}`} aria-hidden="true">
                ⟳
              </span>
              Refresh
            </button>
            {customized && (
              <button type="button" className="button ghost" onClick={reset}>
                Reset layout
              </button>
            )}
          </div>
        </div>
      </section>

      {data.error && (
        <div className="inline-error" role="alert">
          {data.error}
        </div>
      )}

      <div className="filters insights-filters">
        {DIMENSIONS.map(({ id, label }) => (
          <label key={id}>
            <span>{label}</span>
            <select value={filters[id]} onChange={(event) => setFilter(id, event.target.value)}>
              <option value="all">All</option>
              {options[id].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button
          type="button"
          className="button"
          disabled={!hasActiveFilters}
          onClick={() => setFilters(ALL_FILTERS)}
        >
          Clear filters
        </button>
      </div>

      <div className="kpi-grid insights-kpis">
        <div className="kpi-card">
          <p>Live spend</p>
          <strong>{formatEur(totals.cost)}</strong>
          <span>
            {totals.campaigns} campaigns across {totals.markets} {totals.markets === 1 ? "market" : "markets"}
          </span>
        </div>
        <div className="kpi-card">
          <p>Booked budget (INT)</p>
          <strong>{formatEur(totals.intBudget)}</strong>
          <span>from the internal tracker</span>
        </div>
        <div className="kpi-card">
          <p>Avg return</p>
          <strong>{formatPct(totals.avgReturnPct)}</strong>
          <span>cost-weighted · &gt;100% goes longterm</span>
        </div>
        <div className="kpi-card">
          <p>View delivery</p>
          <strong>{formatPct(totals.deliveryPct)}</strong>
          <span>
            {formatCount(totals.actualViews)} of {formatCount(totals.expectedViews)} expected
          </span>
        </div>
      </div>

      <VerticalInsightsPanel
        deals={filtered}
        onSelectVertical={(vertical) => setFilter("vertical", vertical)}
      />

      <div className="grid-canvas" ref={containerRef}>
        {mounted && (
          <Responsive
            width={width}
            layouts={layouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            margin={GRID_MARGIN}
            containerPadding={[0, 0]}
            dragConfig={{
              handle: ".widget-header",
              cancel: ".widget-header-extra, button, select, input, a",
            }}
            resizeConfig={{ handles: ["se"] }}
            onLayoutChange={onLayoutChange}
            onDragStop={commit}
            onResizeStop={commit}
          >
            {WIDGETS.map((widget) => (
              <GridWidget
                key={widget.id}
                title={widget.title}
                eyebrow={widget.eyebrow}
                body={widget.render(ctx)}
              />
            ))}
          </Responsive>
        )}
      </div>
    </main>
  );
}
