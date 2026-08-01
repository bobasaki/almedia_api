import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  Responsive,
  useContainerWidth,
  type LayoutItem,
  type ResponsiveLayouts,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";

import { InfoTip } from "../InfoTip";
import { platformLabel } from "../labels";
import { buildDigest, dimensionOptions, filterDeals, totalsOf } from "./enrich";
import { formatCount, formatEur, formatMoney, formatPct, timeAgo } from "./format";
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
import { SuggestionsWidget } from "./widgets/SuggestionsWidget";
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
  /** Plain-language "what this shows", surfaced through the widget's (i). */
  info: ReactNode;
  render: (ctx: WidgetContext) => ReactNode;
  wide?: boolean;
}

const WIDGETS: WidgetMeta[] = [
  {
    id: "suggestions",
    title: "Booking suggestions",
    eyebrow: "What to book next",
    info: (
      <>
        <p>
          <strong>Booking calls for CLs and CMs</strong>, based on the numbers in view: which niches
          to book more of, which channels to rebook, which creator profile to look for, and where to
          cut back.
        </p>
        <p>
          Every line uses only <span className="info-tip-term">matured</span> returns (14+ days since
          publish), so a suggestion is never based on a deal that is still settling. Use the button to
          turn them into a shareable brief with the AI analyst.
        </p>
      </>
    ),
    render: ({ filtered, chat }) => (
      <SuggestionsWidget
        deals={filtered}
        onAsk={chat.send}
        aiReady={chat.configured === true && !chat.streaming}
      />
    ),
  },
  {
    id: "returns",
    title: "Returns by parameter",
    eyebrow: "Outreach steering",
    info: (
      <>
        <p>
          <strong>Cost-weighted average return %</strong>, grouped by whatever you pick (CM, market,
          vertical, platform, size). Bigger spend counts for more, so it reflects where the money
          actually landed.
        </p>
        <p>
          Colours follow the action tiers: green over 100% (longterm), grey 80 to 100% (rebook), amber
          50 to 80% (adjust price), red under 50% (drop).
        </p>
      </>
    ),
    render: ({ filtered }) => <ReturnsWidget deals={filtered} />,
  },
  {
    id: "views",
    title: "Views vs realised views",
    eyebrow: "Where we stand",
    info: (
      <p>
        Compares the <strong>views we expected</strong> (based on the price we paid) against the
        <strong> views actually delivered</strong>. A shortfall means the CPMs were priced too
        optimistically for that segment.
      </p>
    ),
    render: ({ filtered }) => <ViewsWidget deals={filtered} />,
  },
  {
    id: "published",
    title: "Published content",
    eyebrow: "Delivery pipeline",
    info: (
      <p>
        How many booked deals have actually <strong>published</strong> versus still pending. A low
        published share flags creators to chase or timelines to fix.
      </p>
    ),
    render: ({ filtered }) => <PublishedWidget deals={filtered} />,
  },
  {
    id: "distribution",
    title: "Return distribution",
    eyebrow: "Portfolio spread",
    info: (
      <p>
        How the portfolio's <strong>spend spreads across return bands</strong> (under 50% up to 150%
        or more). Shows whether returns are healthy overall or carried by a few winners, plus the
        cost-weighted median.
      </p>
    ),
    render: ({ filtered }) => <ReturnDistributionWidget deals={filtered} />,
  },
  {
    id: "funnel",
    title: "Unit economics",
    eyebrow: "CPM · cost per user · APPU",
    info: (
      <>
        <p>
          What acquisition <strong>costs and returns per user</strong>. Expected vs realised eCPM
          shows delivery quality; cost per signup and per D7 purchase show efficiency.
        </p>
        <p>
          <span className="info-tip-term">APPU · D14</span> is the average payment per user by day 14:
          how much an acquired user has paid back, weighted by the number of users behind each
          campaign. Higher APPU means the users we acquired are paying back more. Signups and
          purchases are modeled by Almedia and don't chain into a single funnel.
        </p>
      </>
    ),
    render: ({ filtered }) => <UnitEconomicsWidget deals={filtered} />,
  },
  {
    id: "heatmap",
    title: "Segment heatmap",
    eyebrow: "Return by two dimensions",
    info: (
      <p>
        Cost-weighted return across <strong>two dimensions at once</strong> (market by vertical by
        default). Green cells with real spend behind them are where to focus; red cells are where to
        cut back. Hover any cell for its deal count.
      </p>
    ),
    render: ({ filtered }) => <HeatmapWidget deals={filtered} />,
  },
  {
    id: "budget",
    title: "Budget",
    eyebrow: "Per CM · country · category",
    info: (
      <p>
        <strong>Live Almedia spend and booked INT budget</strong>, broken down per CM, market, or
        category. Use it to see who is spending where.
      </p>
    ),
    render: ({ filtered }) => <BudgetWidget deals={filtered} />,
  },
  {
    id: "bestdeals",
    title: "Best deals per CM",
    eyebrow: "Leaderboard",
    info: (
      <p>
        Each CM's <strong>top-returning deals</strong>. Shows who is sourcing the strongest channels
        and which deals to use as examples.
      </p>
    ),
    render: ({ filtered }) => <BestDealsWidget deals={filtered} />,
  },
  {
    id: "painpoints",
    title: "Pain points",
    eyebrow: "Market · vertical · size",
    info: (
      <p>
        <strong>Problem segments</strong> flagged automatically (low return, under-delivery,
        publishing lag, or high dropout) by market, vertical, and deal size, ranked by severity so the
        biggest issues show first.
      </p>
    ),
    render: ({ filtered }) => <PainPointsWidget deals={filtered} />,
  },
  {
    id: "concentration",
    title: "Spend concentration",
    eyebrow: "Pareto · dependency risk",
    info: (
      <p>
        How much of the budget sits with the <strong>top few channels</strong> (a Pareto view). High
        concentration is a risk: if a top channel drops off, a big slice of return goes with it.
      </p>
    ),
    render: ({ filtered }) => <ConcentrationWidget deals={filtered} />,
  },
  {
    id: "efficiency",
    title: "Efficiency scatter",
    eyebrow: "Spend vs return",
    info: (
      <p>
        Every measured deal plotted by <strong>spend (x) against return % (y)</strong>, with bubble
        size for views. Top-right is big spend paying off; bottom-right is big spend underperforming
        and worth a closer look.
      </p>
    ),
    render: ({ filtered }) => <EfficiencyWidget deals={filtered} />,
  },
  {
    id: "trend",
    title: "Return trend",
    eyebrow: "By publish month",
    info: (
      <p>
        Cost-weighted <strong>return by publish month</strong> as a line, with spend as columns behind
        it. A quick read on whether returns are trending up or down. The dashed line marks the 100%
        longterm threshold.
      </p>
    ),
    render: ({ filtered }) => <TrendWidget deals={filtered} />,
  },
  {
    id: "rebooking",
    title: "Rebooking & round lift",
    eyebrow: "Do re-bookings pay off?",
    info: (
      <p>
        Return by <strong>booking round</strong> (R1, R2, R3). Does re-engaging a creator improve
        performance? Also shows the rebook rate: the share of channels booked more than once.
      </p>
    ),
    render: ({ filtered }) => <RebookingWidget deals={filtered} />,
  },
  {
    id: "maturity",
    title: "Maturity mix",
    eyebrow: "Matured vs still accruing",
    info: (
      <p>
        Splits live campaigns into <strong>matured</strong> (14+ days, return is trustworthy) and
        <strong> still accruing</strong>. A maturing return is not final, so read it with caution.
      </p>
    ),
    render: ({ filtered }) => <MaturityWidget deals={filtered} />,
  },
  {
    id: "actionplan",
    title: "Action plan",
    eyebrow: "Template · draft with the analyst",
    info: (
      <p>
        A <strong>template of the recurring monthly plan sections</strong> (focus, rebook, price,
        drop, scouting). Each button sends that section to the AI analyst to draft against the data in
        view. Edit it before sharing.
      </p>
    ),
    render: ({ chat }) => (
      <ActionPlanWidget onAsk={chat.send} aiReady={chat.configured === true && !chat.streaming} />
    ),
  },
  {
    id: "analyst",
    title: "AI analyst",
    eyebrow: "Grounded on the current view",
    wide: true,
    info: (
      <p>
        Ask questions in plain English. The analyst answers <strong>only from the data currently in
        view</strong> (the filtered deals, segments, and plan), so its answers change as you change
        the filters. It won't invent numbers that aren't in the snapshot.
      </p>
    ),
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
          <div className="hero-title-row">
            <h1>Insights</h1>
            <InfoTip label="What the Insights page shows" align="start">
              <p>
                <strong>Live Almedia campaign performance joined with the internal booking
                tracker.</strong> One filter bar drives every widget below and the AI analyst.
              </p>
              <p>How the page is laid out:</p>
              <ul>
                <li>
                  <span className="info-tip-term">KPI cards</span>: spend, booked budget, average
                  return, view delivery, and APPU for the current filters.
                </li>
                <li>
                  <span className="info-tip-term">Vertical performance</span>: every niche compared on
                  return and creator quality. Click one to filter everything.
                </li>
                <li>
                  <span className="info-tip-term">Widget grid</span>: booking suggestions, returns,
                  unit economics, heatmap, trend and more. Each has its own (i). Drag and resize to
                  shape the shared team view.
                </li>
              </ul>
              <p>Every number reflects only the deals left after your filters.</p>
            </InfoTip>
          </div>
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
                  {id === "platform" ? platformLabel(value) : value}
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
        <div className="kpi-card">
          <p>APPU · D14</p>
          <strong>{formatMoney(totals.avgAppuD14)}</strong>
          <span>avg. payment per user · weighted by users</span>
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
                info={widget.info}
                body={widget.render(ctx)}
              />
            ))}
          </Responsive>
        )}
      </div>
    </main>
  );
}
