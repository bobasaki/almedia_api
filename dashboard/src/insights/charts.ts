import { getMaturityInfo } from "../analytics";
import { dimensionValues } from "./enrich";
import type { Deal, DimensionId } from "./types";

/**
 * Pure aggregations for the standard performance-marketing charts:
 * return distribution, unit economics, a segment cross-tab (heatmap), spend
 * concentration (Pareto), the monthly return trend, rebooking / round-over-round
 * lift, and the maturity mix. No I/O.
 */

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

// ── Return distribution (histogram) ─────────────────────────────────────────

export type ReturnTone = "bad" | "warn" | "neutral" | "good";

export interface ReturnBand {
  label: string;
  /** Inclusive lower bound, exclusive upper bound (Infinity for the top band). */
  min: number;
  max: number;
  tone: ReturnTone;
  deals: number;
  /** Almedia spend sitting in this band (EUR). */
  cost: number;
}

const RETURN_BANDS: ReadonlyArray<Omit<ReturnBand, "deals" | "cost">> = [
  { label: "<50%", min: -Infinity, max: 50, tone: "bad" },
  { label: "50–80%", min: 50, max: 80, tone: "warn" },
  { label: "80–100%", min: 80, max: 100, tone: "neutral" },
  { label: "100–150%", min: 100, max: 150, tone: "good" },
  { label: "≥150%", min: 150, max: Infinity, tone: "good" },
];

export interface ReturnDistribution {
  bands: ReturnBand[];
  /** Deals carrying a measured return %. */
  measured: number;
  /** Cost-weighted median return %, or null when nothing is measured. */
  medianReturnPct: number | null;
}

export function returnDistribution(deals: Deal[]): ReturnDistribution {
  const measuredDeals = deals.filter((deal) => deal.returnPct !== null);
  const bands: ReturnBand[] = RETURN_BANDS.map((band) => {
    const rows = measuredDeals.filter(
      (deal) => (deal.returnPct as number) >= band.min && (deal.returnPct as number) < band.max,
    );
    return { ...band, deals: rows.length, cost: sum(rows.map((row) => row.cost)) };
  });

  const sorted = [...measuredDeals].sort(
    (a, b) => (a.returnPct as number) - (b.returnPct as number),
  );
  const medianReturnPct =
    sorted.length === 0
      ? null
      : (sorted[Math.floor((sorted.length - 1) / 2)].returnPct as number);

  return { bands, measured: measuredDeals.length, medianReturnPct };
}

// ── Unit economics (CPA view) ────────────────────────────────────────────────

export interface UnitEconomics {
  views: number;
  /** Almedia-modeled signups = Σ views × signupsPct (signupsPct is a fraction). */
  signups: number;
  d7Purchases: number;
  cost: number;
  /** Realised eCPM = cost ÷ views × 1000. */
  realisedCpm: number | null;
  /** Cost-weighted expected CPM the prices were set on. */
  expectedCpm: number | null;
  /** Signups ÷ views, as a fraction. */
  signupRate: number | null;
  costPerSignup: number | null;
  costPerPurchase: number | null;
  measuredCampaigns: number;
}

/** signupsPct is a view→signup rate (fraction); absolute signups = views × rate. */
function signupsOf(deal: Deal): number | null {
  if (deal.viewCount === null || deal.signupsPct === null) return null;
  return deal.viewCount * deal.signupsPct;
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/**
 * Cost-efficiency metrics. Each figure is computed over the cohort that
 * actually carries its inputs, so partial data never distorts the rest. These
 * are unit costs, deliberately NOT chained into a conversion funnel: Almedia's
 * signup and purchase figures are independently modeled and do not nest.
 */
export function unitEconomics(deals: Deal[]): UnitEconomics {
  const withCampaign = deals.filter((deal) => deal.hasCampaign);
  const costOf = (rows: Deal[]) => sum(rows.map((row) => row.cost));

  const viewCohort = withCampaign.filter(
    (deal) => deal.cost !== null && deal.viewCount !== null,
  );
  const signupCohort = viewCohort.filter((deal) => deal.signupsPct !== null);
  const purchaseCohort = withCampaign.filter(
    (deal) => deal.cost !== null && deal.d7Purchases !== null,
  );
  // Expected and realised CPM share this cohort and the same cost÷views basis,
  // so the two bars are directly comparable and track the delivery metric.
  const cpmCohort = viewCohort.filter((deal) => deal.expectedViews !== null);

  const cohortViews = sum(cpmCohort.map((deal) => deal.viewCount));
  const cohortExpectedViews = sum(cpmCohort.map((deal) => deal.expectedViews));
  const signups = sum(signupCohort.map(signupsOf));
  const signupViews = sum(signupCohort.map((deal) => deal.viewCount));
  const purchases = sum(purchaseCohort.map((deal) => deal.d7Purchases));

  return {
    views: sum(withCampaign.map((deal) => deal.viewCount)),
    signups,
    d7Purchases: sum(withCampaign.map((deal) => deal.d7Purchases)),
    cost: costOf(withCampaign),
    realisedCpm: cohortViews > 0 ? (costOf(cpmCohort) / cohortViews) * 1000 : null,
    expectedCpm: cohortExpectedViews > 0 ? (costOf(cpmCohort) / cohortExpectedViews) * 1000 : null,
    signupRate: ratio(signups, signupViews),
    costPerSignup: ratio(costOf(signupCohort), signups),
    costPerPurchase: ratio(costOf(purchaseCohort), purchases),
    measuredCampaigns: viewCohort.length,
  };
}

// ── Segment cross-tab (heatmap) ──────────────────────────────────────────────

export interface HeatCell {
  row: string;
  col: string;
  avgReturnPct: number | null;
  cost: number;
  deals: number;
  measured: number;
}

export interface CrossTab {
  rows: string[];
  cols: string[];
  cells: HeatCell[];
}

/** Cost-weighted average return for one segment intersection. */
function weightedReturn(deals: Deal[]): { value: number | null; measured: number } {
  let weighted = 0;
  let weight = 0;
  let measured = 0;
  for (const deal of deals) {
    if (deal.returnPct !== null && deal.cost !== null && deal.cost > 0) {
      weighted += deal.returnPct * deal.cost;
      weight += deal.cost;
      measured += 1;
    }
  }
  return { value: weight > 0 ? weighted / weight : null, measured };
}

/**
 * Two-dimensional return matrix (e.g. market × vertical). Rows and columns are
 * ordered by total spend so the busiest segments lead.
 */
export function crossTab(
  deals: Deal[],
  rowDim: DimensionId,
  colDim: DimensionId,
): CrossTab {
  const spendByKey = (dimension: DimensionId) => {
    const totals = new Map<string, number>();
    for (const deal of deals) {
      for (const key of dimensionValues(deal, dimension)) {
        totals.set(key, (totals.get(key) ?? 0) + (deal.cost ?? deal.intBudget ?? 0));
      }
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  };

  const rows = spendByKey(rowDim);
  const cols = spendByKey(colDim);
  const cells: HeatCell[] = [];
  for (const row of rows) {
    for (const col of cols) {
      const group = deals.filter(
        (deal) =>
          dimensionValues(deal, rowDim).includes(row) &&
          dimensionValues(deal, colDim).includes(col),
      );
      if (group.length === 0) continue;
      const { value, measured } = weightedReturn(group);
      cells.push({
        row,
        col,
        avgReturnPct: value,
        cost: sum(group.map((deal) => deal.cost)),
        deals: group.length,
        measured,
      });
    }
  }
  return { rows, cols, cells };
}

// ── Spend concentration (Pareto) ─────────────────────────────────────────────

export interface ConcentrationRow {
  channelName: string;
  cost: number;
  /** Share of total spend for this single channel. */
  share: number;
  /** Cumulative share through this row (rows are spend-descending). */
  cumulativeShare: number;
}

export interface Concentration {
  rows: ConcentrationRow[];
  /** Spend not shown in the top-N rows (EUR). */
  othersCost: number;
  totalCost: number;
  /** Share of spend carried by the top-N channels. */
  topShare: number;
}

/** Pareto view of spend: the top-N channels by cost with cumulative share. */
export function spendConcentration(deals: Deal[], topN = 10): Concentration {
  const byChannel = new Map<string, number>();
  for (const deal of deals) {
    if (deal.cost === null || deal.cost <= 0) continue;
    byChannel.set(deal.channelName, (byChannel.get(deal.channelName) ?? 0) + deal.cost);
  }

  const ranked = [...byChannel.entries()].sort((a, b) => b[1] - a[1]);
  const totalCost = ranked.reduce((total, [, cost]) => total + cost, 0);
  const top = ranked.slice(0, topN);

  let running = 0;
  const rows: ConcentrationRow[] = top.map(([channelName, cost]) => {
    running += cost;
    return {
      channelName,
      cost,
      share: totalCost > 0 ? cost / totalCost : 0,
      cumulativeShare: totalCost > 0 ? running / totalCost : 0,
    };
  });

  const othersCost = totalCost - running;
  return {
    rows,
    othersCost,
    totalCost,
    topShare: totalCost > 0 ? running / totalCost : 0,
  };
}

// ── Efficiency scatter (cost vs return) ──────────────────────────────────────

export interface ScatterPoint {
  channelName: string;
  cost: number;
  returnPct: number;
  views: number | null;
  tone: ReturnTone;
}

function toneOfReturn(returnPct: number): ReturnTone {
  if (returnPct > 100) return "good";
  if (returnPct >= 80) return "neutral";
  if (returnPct >= 50) return "warn";
  return "bad";
}

/** One point per measured deal: spend on X, return% on Y, views as bubble size. */
export function efficiencyPoints(deals: Deal[]): ScatterPoint[] {
  return deals
    .filter((deal) => deal.returnPct !== null && deal.cost !== null && deal.cost > 0)
    .map((deal) => ({
      channelName: deal.channelName,
      cost: deal.cost as number,
      returnPct: deal.returnPct as number,
      views: deal.viewCount,
      tone: toneOfReturn(deal.returnPct as number),
    }));
}

// ── Monthly return trend ─────────────────────────────────────────────────────

export interface TrendPoint {
  /** YYYY-MM. */
  month: string;
  /** "Jul 26". */
  label: string;
  cost: number;
  avgReturnPct: number | null;
  deals: number;
  measured: number;
}

function monthLabel(month: string): string {
  const parsed = new Date(`${month}-01T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return month;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * Cost-weighted return and spend per publish month — the executive "how are we
 * trending" read. Grouped by the campaign's publish month so it tracks realised
 * performance timing, not when a deal was booked.
 */
export function monthlyTrend(deals: Deal[]): TrendPoint[] {
  const groups = new Map<string, Deal[]>();
  for (const deal of deals) {
    if (!deal.hasCampaign) continue;
    const month = deal.publishedAt?.slice(0, 7) ?? deal.month;
    if (!month) continue;
    groups.set(month, [...(groups.get(month) ?? []), deal]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rows]) => {
      const { value, measured } = weightedReturn(rows);
      return {
        month,
        label: monthLabel(month),
        cost: sum(rows.map((row) => row.cost)),
        avgReturnPct: value,
        deals: rows.length,
        measured,
      };
    });
}

// ── Rebooking / round-over-round lift ────────────────────────────────────────

/** Booking round parsed from the campaign name suffix (…_R2); null when absent. */
export function roundOf(campaignName: string | null): number | null {
  if (!campaignName) return null;
  const match = /_R(\d+)\b/i.exec(campaignName);
  return match ? Number(match[1]) : null;
}

export interface RoundGroup {
  round: number;
  /** "R1" … "R4+". */
  label: string;
  channels: number;
  deals: number;
  cost: number;
  avgReturnPct: number | null;
  measured: number;
}

export interface RoundAnalysis {
  rounds: RoundGroup[];
  /** Distinct channels booked more than once (max round ≥ 2). */
  rebookedChannels: number;
  totalChannels: number;
  rebookRate: number | null;
}

const MAX_ROUND_BUCKET = 4;

/**
 * Round-over-round performance: does return improve as we re-engage a creator?
 * A campaign with no round suffix counts as round 1 (a first/only booking).
 * Rounds at or above 4 are bucketed together.
 */
export function roundAnalysis(deals: Deal[]): RoundAnalysis {
  const withCampaign = deals.filter((deal) => deal.hasCampaign);

  const buckets = new Map<number, Deal[]>();
  const maxRoundByChannel = new Map<string, number>();
  for (const deal of withCampaign) {
    const round = roundOf(deal.campaignName) ?? 1;
    const bucket = Math.min(round, MAX_ROUND_BUCKET);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), deal]);
    maxRoundByChannel.set(
      deal.channelKey,
      Math.max(maxRoundByChannel.get(deal.channelKey) ?? 0, round),
    );
  }

  const rounds: RoundGroup[] = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, rows]) => {
      const { value, measured } = weightedReturn(rows);
      return {
        round,
        label: round >= MAX_ROUND_BUCKET ? `R${MAX_ROUND_BUCKET}+` : `R${round}`,
        channels: new Set(rows.map((row) => row.channelKey)).size,
        deals: rows.length,
        cost: sum(rows.map((row) => row.cost)),
        avgReturnPct: value,
        measured,
      };
    });

  const totalChannels = maxRoundByChannel.size;
  const rebookedChannels = [...maxRoundByChannel.values()].filter((round) => round >= 2).length;
  return {
    rounds,
    rebookedChannels,
    totalChannels,
    rebookRate: totalChannels > 0 ? rebookedChannels / totalChannels : null,
  };
}

// ── Maturity mix ─────────────────────────────────────────────────────────────

export interface MaturityBucket {
  deals: number;
  cost: number;
  avgReturnPct: number | null;
  measured: number;
}

export interface MaturityMix {
  matured: MaturityBucket;
  maturing: MaturityBucket;
  unknown: MaturityBucket;
}

function maturityBucket(deals: Deal[]): MaturityBucket {
  const { value, measured } = weightedReturn(deals);
  return {
    deals: deals.length,
    cost: sum(deals.map((deal) => deal.cost)),
    avgReturnPct: value,
    measured,
  };
}

/**
 * Split live campaigns by maturity (Almedia gives a single return snapshot, not
 * a maturation curve, so this is the honest stand-in: a matured return is
 * trustworthy; a maturing one is still accruing and should not be judged yet).
 */
export function maturityMix(deals: Deal[], now: Date = new Date()): MaturityMix {
  const withCampaign = deals.filter((deal) => deal.hasCampaign);
  const byStatus = { matured: [] as Deal[], maturing: [] as Deal[], unknown: [] as Deal[] };
  for (const deal of withCampaign) {
    byStatus[getMaturityInfo(deal.publishedAt, now).status].push(deal);
  }
  return {
    matured: maturityBucket(byStatus.matured),
    maturing: maturityBucket(byStatus.maturing),
    unknown: maturityBucket(byStatus.unknown),
  };
}
