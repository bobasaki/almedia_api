import type { Scorecard, ScorecardRow } from "../../../src/bookings/scorecard";
import { campaignBaseKey } from "../../../src/migration/cell-utils";
import { getMaturityInfo, getReturnTier, type ReturnTierId } from "../analytics";
import { canonicalVertical, deriveVerticals } from "../performance/verticals";
import type {
  Booking,
  Campaign,
  Deal,
  DimensionGroup,
  DimensionId,
  EnrichmentOverview,
  InsightFilters,
  PainPoint,
  SizeTier,
  VerticalPerformance,
} from "./types";
import { DIMENSIONS, UNASSIGNED } from "./types";

/** Pure joins and aggregations behind the Insights view. No I/O. */

export function sizeTierOf(amount: number | null): SizeTier | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  if (amount < 10_000) return "<10k";
  if (amount < 20_000) return "10-20k";
  if (amount <= 50_000) return "20-50k";
  return ">50k";
}

function expectedViewsOf(cost: number | null, expectedCpm: number | null): number | null {
  if (cost === null || expectedCpm === null || expectedCpm <= 0) return null;
  return (cost / expectedCpm) * 1000;
}

function deliveryOf(viewCount: number | null, expectedViews: number | null): number | null {
  if (viewCount === null || expectedViews === null || expectedViews <= 0) return null;
  return (viewCount / expectedViews) * 100;
}

function dealFromCampaign(campaign: Campaign, booking: Booking | undefined): Deal {
  const expectedViews = expectedViewsOf(campaign.cost, campaign.expectedCpm);
  const budgetForTier = booking?.intBudget ?? campaign.cost;
  const derivedVerticals = deriveVerticals(campaign.enrichment);
  const bookingVertical = canonicalVertical(booking?.vertical) ?? booking?.vertical ?? null;
  const verticals = derivedVerticals.length > 0
    ? derivedVerticals
    : bookingVertical
      ? [bookingVertical]
      : [];
  return {
    channelKey: campaignBaseKey(campaign.campaignName),
    channelName: booking?.channelName ?? campaign.channelName ?? campaign.campaignName,
    campaignName: campaign.campaignName,
    videoUrl: campaign.videoUrl ?? booking?.videoUrl ?? null,
    platform: booking?.platform ?? campaign.platform,
    publishedAt: campaign.publishedAt?.slice(0, 10) ?? booking?.publishedAt ?? null,
    cost: campaign.cost,
    expectedCpm: campaign.expectedCpm,
    viewCount: campaign.viewCount,
    returnPct: campaign.returnPct,
    signupsPct: campaign.signupsPct,
    d7Purchases: campaign.d7Purchases,
    roasReturn: campaign.roasReturn,
    expectedViews,
    deliveryPct: deliveryOf(campaign.viewCount, expectedViews),
    cm: booking?.cm ?? null,
    country: campaign.country || booking?.country || null,
    vertical: verticals[0] ?? null,
    verticals,
    category: booking?.category ?? campaign.enrichment?.metrics.contentFormat.dominant ?? null,
    hasEnrichment: campaign.enrichment !== null && campaign.enrichment !== undefined,
    creatorFollowers: campaign.enrichment?.metrics.followers ?? null,
    creatorTypicalViews: campaign.enrichment?.metrics.typicalViews.median ?? null,
    creatorEngagementRatePct: campaign.enrichment?.metrics.typicalEngagementRatePct ?? null,
    creatorContentFormat: campaign.enrichment?.metrics.contentFormat.dominant ?? null,
    creatorBrandFit: campaign.enrichment?.classification.brandFit.suitability ?? null,
    creatorSafetyRisk: campaign.enrichment?.classification.brandSafety.risk ?? null,
    status: booking?.status ?? null,
    intBudget: booking?.intBudget ?? null,
    extBudget: booking?.extBudget ?? null,
    month: booking?.month ?? campaign.publishedAt?.slice(0, 7) ?? null,
    sizeTier: sizeTierOf(budgetForTier),
    hasCampaign: true,
    hasBooking: booking !== undefined,
  };
}

function dealFromBooking(booking: Booking): Deal {
  const vertical = canonicalVertical(booking.vertical) ?? booking.vertical;
  return {
    channelKey: booking.channelKey,
    channelName: booking.channelName,
    campaignName: null,
    videoUrl: booking.videoUrl,
    platform: booking.platform,
    publishedAt: booking.publishedAt,
    cost: null,
    expectedCpm: null,
    viewCount: null,
    returnPct: null,
    signupsPct: null,
    d7Purchases: null,
    roasReturn: null,
    expectedViews: null,
    deliveryPct: null,
    cm: booking.cm,
    country: booking.country,
    vertical,
    verticals: vertical ? [vertical] : [],
    category: booking.category,
    hasEnrichment: false,
    creatorFollowers: null,
    creatorTypicalViews: null,
    creatorEngagementRatePct: null,
    creatorContentFormat: null,
    creatorBrandFit: null,
    creatorSafetyRisk: null,
    status: booking.status,
    intBudget: booking.intBudget,
    extBudget: booking.extBudget,
    month: booking.month,
    sizeTier: sizeTierOf(booking.intBudget),
    hasCampaign: false,
    hasBooking: true,
  };
}

/**
 * Join live campaigns with internal bookings by normalized channel key.
 * One deal row per campaign; bookings without a matching campaign (pipeline,
 * not yet live) become metric-less rows so budgets and counts stay complete.
 */
export function joinDeals(campaigns: Campaign[], bookings: Booking[]): Deal[] {
  const byKey = new Map<string, Booking>();
  for (const booking of bookings) {
    // Prefer the most advanced booking per key (last write wins is fine —
    // listBookings is ordered newest first, so keep the first seen).
    if (!byKey.has(booking.channelKey)) byKey.set(booking.channelKey, booking);
  }

  const matchedKeys = new Set<string>();
  const deals = campaigns.map((campaign) => {
    const key = campaignBaseKey(campaign.campaignName);
    const booking = byKey.get(key);
    if (booking) matchedKeys.add(key);
    return dealFromCampaign(campaign, booking);
  });

  const unmatched = bookings
    .filter((booking) => !matchedKeys.has(booking.channelKey))
    .map(dealFromBooking);
  return [...deals, ...unmatched];
}

export function dimensionValue(deal: Deal, dimension: DimensionId): string {
  if (dimension === "vertical") return deal.verticals[0] ?? UNASSIGNED;
  const value = deal[dimension];
  return value === null || value === "" ? UNASSIGNED : String(value);
}

/** Multi-value dimensions (currently vertical) participate through every assigned value. */
export function dimensionValues(deal: Deal, dimension: DimensionId): string[] {
  if (dimension === "vertical") {
    return deal.verticals.length > 0 ? [...new Set(deal.verticals)] : [UNASSIGNED];
  }
  return [dimensionValue(deal, dimension)];
}

export function filterDeals(deals: Deal[], filters: InsightFilters): Deal[] {
  const active = DIMENSIONS.filter(({ id }) => filters[id] !== "all");
  if (active.length === 0) return deals;
  return deals.filter((deal) =>
    active.every(({ id }) => dimensionValues(deal, id).includes(filters[id])),
  );
}

/** Distinct values per dimension, for filter dropdowns. */
export function dimensionOptions(deals: Deal[]): Record<DimensionId, string[]> {
  const options = {} as Record<DimensionId, string[]>;
  for (const { id } of DIMENSIONS) {
    const values = new Set(deals.flatMap((deal) => dimensionValues(deal, id)));
    options[id] = [...values].sort((a, b) =>
      a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : a.localeCompare(b),
    );
  }
  return options;
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

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

function share(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export function groupByDimension(deals: Deal[], dimension: DimensionId): DimensionGroup[] {
  const groups = new Map<string, Deal[]>();
  for (const deal of deals) {
    for (const key of dimensionValues(deal, dimension)) {
      groups.set(key, [...(groups.get(key) ?? []), deal]);
    }
  }

  return [...groups.entries()]
    .map(([key, rows]) => {
      const expectedViews = sum(rows.map((row) => row.expectedViews));
      const actualViews = sum(rows.map((row) => row.viewCount));
      const withStatus = rows.filter((row) => row.status !== null);
      const live = withStatus.filter((row) =>
        ["booked", "published", "longterm"].includes(row.status ?? ""),
      );
      const published = withStatus.filter((row) =>
        ["published", "longterm"].includes(row.status ?? ""),
      );
      const dropped = withStatus.filter((row) => row.status === "dropped");
      const { value: avgReturnPct, measured } = weightedReturn(rows);
      return {
        key,
        deals: rows.length,
        cost: sum(rows.map((row) => row.cost)),
        intBudget: sum(rows.map((row) => row.intBudget)),
        expectedViews,
        actualViews,
        deliveryPct: expectedViews > 0 ? (actualViews / expectedViews) * 100 : null,
        avgReturnPct,
        measured,
        publishedShare: share(published.length, live.length),
        droppedShare: share(dropped.length, withStatus.length),
      };
    })
    .sort((a, b) => b.cost + b.intBudget - (a.cost + a.intBudget));
}

export interface InsightTotals {
  deals: number;
  campaigns: number;
  markets: number;
  cost: number;
  intBudget: number;
  expectedViews: number;
  actualViews: number;
  deliveryPct: number | null;
  avgReturnPct: number | null;
  publishedShare: number | null;
}

export function totalsOf(deals: Deal[]): InsightTotals {
  const expectedViews = sum(deals.map((deal) => deal.expectedViews));
  const actualViews = sum(deals.map((deal) => deal.viewCount));
  const withStatus = deals.filter((deal) => deal.status !== null);
  const live = withStatus.filter((deal) =>
    ["booked", "published", "longterm"].includes(deal.status ?? ""),
  );
  const published = withStatus.filter((deal) =>
    ["published", "longterm"].includes(deal.status ?? ""),
  );
  return {
    deals: deals.length,
    campaigns: deals.filter((deal) => deal.hasCampaign).length,
    markets: new Set(
      deals
        .map((deal) => deal.country)
        .filter((country): country is string => country !== null && country !== ""),
    ).size,
    cost: sum(deals.map((deal) => deal.cost)),
    intBudget: sum(deals.map((deal) => deal.intBudget)),
    expectedViews,
    actualViews,
    deliveryPct: expectedViews > 0 ? (actualViews / expectedViews) * 100 : null,
    avgReturnPct: weightedReturn(deals).value,
    publishedShare: share(published.length, live.length),
  };
}

function average(values: Array<number | null>): number | null {
  const measured = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return measured.length > 0
    ? measured.reduce((total, value) => total + value, 0) / measured.length
    : null;
}

/** User-facing enrichment coverage for the current filtered campaign cohort. */
export function enrichmentOverview(deals: Deal[]): EnrichmentOverview {
  const campaigns = deals.filter((deal) => deal.hasCampaign);
  const enrichedCampaigns = campaigns.filter((deal) => deal.hasEnrichment);
  const creators = new Map<string, Deal>();
  for (const deal of enrichedCampaigns) {
    if (!creators.has(deal.channelKey)) creators.set(deal.channelKey, deal);
  }
  const creatorRows = [...creators.values()];
  const withSafety = creatorRows.filter((deal) => deal.creatorSafetyRisk !== null);
  const safeCreators = withSafety.filter((deal) => deal.creatorSafetyRisk === "low");

  return {
    campaigns: campaigns.length,
    enrichedCampaigns: enrichedCampaigns.length,
    coverageShare: campaigns.length > 0 ? enrichedCampaigns.length / campaigns.length : null,
    enrichedCreators: creatorRows.length,
    verticals: new Set(campaigns.flatMap((deal) => deal.verticals)).size,
    avgEngagementRatePct: average(creatorRows.map((deal) => deal.creatorEngagementRatePct)),
    brandSafeShare: withSafety.length > 0 ? safeCreators.length / withSafety.length : null,
  };
}

/** Performance and creator-quality signals attributed to each controlled vertical. */
export function verticalPerformance(deals: Deal[]): VerticalPerformance[] {
  const groups = new Map<string, Deal[]>();
  for (const deal of deals.filter((row) => row.hasCampaign)) {
    for (const vertical of new Set(deal.verticals)) {
      groups.set(vertical, [...(groups.get(vertical) ?? []), deal]);
    }
  }

  return [...groups.entries()]
    .map(([vertical, rows]) => {
      const creators = new Map<string, Deal>();
      for (const deal of rows.filter((row) => row.hasEnrichment)) {
        if (!creators.has(deal.channelKey)) creators.set(deal.channelKey, deal);
      }
      const creatorRows = [...creators.values()];
      const withSafety = creatorRows.filter((deal) => deal.creatorSafetyRisk !== null);
      const { value: avgReturnPct, measured } = weightedReturn(rows);
      return {
        vertical,
        campaigns: rows.length,
        measuredReturns: measured,
        enrichedCreators: creatorRows.length,
        cost: sum(rows.map((row) => row.cost)),
        views: sum(rows.map((row) => row.viewCount)),
        d7Purchases: sum(rows.map((row) => row.d7Purchases)),
        avgReturnPct,
        avgEngagementRatePct: average(creatorRows.map((row) => row.creatorEngagementRatePct)),
        avgFollowers: average(creatorRows.map((row) => row.creatorFollowers)),
        brandSafeShare:
          withSafety.length > 0
            ? withSafety.filter((row) => row.creatorSafetyRisk === "low").length / withSafety.length
            : null,
      };
    })
    .sort((a, b) => b.cost - a.cost);
}

/** Best measurable deals, ranked by return %, for the per-CM leaderboard. */
export function bestDealsByCm(
  deals: Deal[],
  topPerCm = 3,
): Array<{ cm: string; avgReturnPct: number | null; deals: Deal[] }> {
  const withReturn = deals.filter((deal) => deal.returnPct !== null);
  const byCm = new Map<string, Deal[]>();
  for (const deal of withReturn) {
    const cm = deal.cm ?? UNASSIGNED;
    byCm.set(cm, [...(byCm.get(cm) ?? []), deal]);
  }
  return [...byCm.entries()]
    .map(([cm, rows]) => ({
      cm,
      avgReturnPct: weightedReturn(rows).value,
      deals: [...rows]
        .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0))
        .slice(0, topPerCm),
    }))
    .sort((a, b) => (b.avgReturnPct ?? -1) - (a.avgReturnPct ?? -1));
}

const PAIN_DIMENSIONS: DimensionId[] = ["country", "vertical", "sizeTier"];
const MIN_MEASURED = 2;
const MIN_DEALS_FOR_PUBLISHING = 3;

/** Rule-based pain points per market / vertical / client size. */
export function painPoints(deals: Deal[]): PainPoint[] {
  const points: PainPoint[] = [];
  const label = (dimension: DimensionId) =>
    DIMENSIONS.find((entry) => entry.id === dimension)?.label ?? dimension;

  for (const dimension of PAIN_DIMENSIONS) {
    for (const group of groupByDimension(deals, dimension)) {
      if (group.key === UNASSIGNED && dimension !== "sizeTier") continue;
      const where = `${label(dimension)} ${group.key}`;

      if (group.avgReturnPct !== null && group.measured >= MIN_MEASURED) {
        if (group.avgReturnPct < 50) {
          points.push({
            dimension,
            key: group.key,
            severity: "high",
            issue: "low-return",
            detail: `${where}: avg return ${group.avgReturnPct.toFixed(0)}% across ${group.measured} measured deals — drop tier; renegotiate or exit.`,
          });
        } else if (group.avgReturnPct < 80) {
          points.push({
            dimension,
            key: group.key,
            severity: "medium",
            issue: "low-return",
            detail: `${where}: avg return ${group.avgReturnPct.toFixed(0)}% — rebook only with price adjustment.`,
          });
        }
      }

      if (group.deliveryPct !== null && group.expectedViews > 0 && group.deliveryPct < 70) {
        points.push({
          dimension,
          key: group.key,
          severity: group.deliveryPct < 50 ? "high" : "medium",
          issue: "under-delivery",
          detail: `${where}: views delivered at ${group.deliveryPct.toFixed(0)}% of expectation (${Math.round(group.actualViews).toLocaleString()} vs ${Math.round(group.expectedViews).toLocaleString()}) — CPMs are priced too optimistically.`,
        });
      }

      if (
        group.publishedShare !== null &&
        group.deals >= MIN_DEALS_FOR_PUBLISHING &&
        group.publishedShare < 0.5
      ) {
        points.push({
          dimension,
          key: group.key,
          severity: "medium",
          issue: "publishing-lag",
          detail: `${where}: only ${(group.publishedShare * 100).toFixed(0)}% of booked deals are published — chase creators or restructure timelines.`,
        });
      }

      if (group.droppedShare !== null && group.droppedShare > 0.25 && group.deals >= 4) {
        points.push({
          dimension,
          key: group.key,
          severity: "high",
          issue: "high-dropout",
          detail: `${where}: ${(group.droppedShare * 100).toFixed(0)}% of deals dropped — review outreach quality and deal terms.`,
        });
      }
    }
  }

  const severityRank = { high: 0, medium: 1 } as const;
  return points.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

export function returnTierOf(deal: Deal): ReturnTierId | null {
  return getReturnTier(deal.returnPct);
}

const MAX_DIGEST_CHARS = 190_000;
const CANDIDATE_LIMITS = [40, 20, 10, 5, 0] as const;
const MAX_PLAN_ROWS = 60;
const MAX_SEGMENT_ROWS = 10;
const MAX_PAIN_POINTS = 30;

function compactText(value: string | null, maxLength = 160): string | null {
  if (value === null || value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function nextIsoMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 7);
}

function matchesPlanFilter(value: string | null, filter: string): boolean {
  if (filter === "all") return true;
  return filter === UNASSIGNED ? value === null || value === "" : value === filter;
}

function filterPlanRows(scorecard: Scorecard, filters: InsightFilters): ScorecardRow[] {
  return scorecard.rows.filter(
    (row) =>
      matchesPlanFilter(row.cm, filters.cm) &&
      matchesPlanFilter(row.market, filters.country) &&
      matchesPlanFilter(row.month, filters.month),
  );
}

/**
 * Compact, coverage-labelled JSON evidence for the analyst. Candidate and plan
 * sections disclose truncation so the model cannot present a partial list as
 * exhaustive. Return-tier actions are separated from non-matured campaigns.
 */
export function buildDigest(
  deals: Deal[],
  filters: InsightFilters,
  scorecard: Scorecard | null = null,
  now: Date = new Date(),
): string {
  const round = (value: number | null) =>
    value === null ? null : Math.round(value * 10) / 10;
  const activeFilters = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== "all"),
  );
  const groupSummary = (dimension: DimensionId) => {
    const groups = groupByDimension(deals, dimension);
    const rows = groups.slice(0, MAX_SEGMENT_ROWS).map((group) => ({
      [dimension]: group.key,
      deals: group.deals,
      costEur: Math.round(group.cost),
      intBudgetEur: Math.round(group.intBudget),
      avgReturnPct: round(group.avgReturnPct),
      deliveryPct: round(group.deliveryPct),
      publishedShare: round(group.publishedShare === null ? null : group.publishedShare * 100),
    }));
    return {
      totalGroups: groups.length,
      includedGroups: rows.length,
      truncated: rows.length < groups.length,
      rows,
    };
  };

  const dealLine = (deal: Deal) => ({
    channel: compactText(deal.channelName),
    campaign: compactText(deal.campaignName),
    cm: deal.cm,
    market: deal.country,
    verticals: deal.verticals,
    category: deal.category,
    enrichment: deal.hasEnrichment
      ? {
          followers: round(deal.creatorFollowers),
          typicalViews: round(deal.creatorTypicalViews),
          engagementRatePct: round(deal.creatorEngagementRatePct),
          contentFormat: deal.creatorContentFormat,
          brandFit: deal.creatorBrandFit,
          safetyRisk: deal.creatorSafetyRisk,
        }
      : null,
    platform: deal.platform,
    status: deal.status,
    month: deal.month,
    publishedAt: deal.publishedAt,
    maturity: getMaturityInfo(deal.publishedAt, now),
    costEur: round(deal.cost),
    intBudgetEur: round(deal.intBudget),
    extBudgetEur: round(deal.extBudget),
    expectedCpmEur: round(deal.expectedCpm),
    realisedCpmEur:
      deal.cost !== null && deal.viewCount !== null && deal.viewCount > 0
        ? round((deal.cost / deal.viewCount) * 1000)
        : null,
    deliveryAlignedCostEur:
      deal.cost !== null && deal.deliveryPct !== null
        ? round((deal.cost * Math.min(deal.deliveryPct, 100)) / 100)
        : null,
    actualViews: round(deal.viewCount),
    expectedViews: round(deal.expectedViews),
    returnPct: round(deal.returnPct),
    deliveryPct: round(deal.deliveryPct),
  });

  const maturityStatus = (deal: Deal) => getMaturityInfo(deal.publishedAt, now).status;
  const maturedWithReturn = deals.filter(
    (deal) => deal.returnPct !== null && maturityStatus(deal) === "matured",
  );
  const longterm = maturedWithReturn
    .filter((deal) => (deal.returnPct ?? 0) > 100)
    .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0));
  const rebook = maturedWithReturn
    .filter((deal) => (deal.returnPct ?? 0) >= 80 && (deal.returnPct ?? 0) <= 100)
    .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0));
  const priceAdjustment = maturedWithReturn
    .filter((deal) => (deal.returnPct ?? 0) >= 50 && (deal.returnPct ?? 0) < 80)
    .sort((a, b) => (a.returnPct ?? 0) - (b.returnPct ?? 0));
  const drop = maturedWithReturn
    .filter((deal) => (deal.returnPct ?? 0) < 50)
    .sort((a, b) => (a.returnPct ?? 0) - (b.returnPct ?? 0));
  const underDelivery = deals
    .filter(
      (deal) =>
        deal.deliveryPct !== null &&
        deal.deliveryPct < 100 &&
        maturityStatus(deal) === "matured",
    )
    .sort((a, b) => (a.deliveryPct ?? 0) - (b.deliveryPct ?? 0));
  const notActionableYet = deals
    .filter((deal) => deal.hasCampaign && maturityStatus(deal) !== "matured")
    .sort((a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""));

  const planFilterKeys = new Set(["cm", "country", "month"]);
  const ignoredPlanFilters = Object.keys(activeFilters).filter((key) => !planFilterKeys.has(key));
  const relevantPlanRows = scorecard ? filterPlanRows(scorecard, filters) : [];
  const planRows = relevantPlanRows
    .map((row) => ({
      cm: row.cm,
      market: row.market,
      month: row.month,
      targetEur: row.targetEur,
      committedEur: row.bookedEur,
      remainingEur:
        row.targetEur === null ? null : Math.max(0, row.targetEur - row.bookedEur),
      overTargetEur:
        row.targetEur === null ? null : Math.max(0, row.bookedEur - row.targetEur),
      utilizationPct: round(row.utilization === null ? null : row.utilization * 100),
      pacePct: round(row.pace === null ? null : row.pace * 100),
      targetTiers: row.targetTiers,
      bookedTiers: row.bookedTiers,
      counts: row.counts,
      dropoutPct: round(row.dropoutRate === null ? null : row.dropoutRate * 100),
    }))
    .sort((a, b) => (b.remainingEur ?? -1) - (a.remainingEur ?? -1));

  const candidateRows = [longterm, rebook, priceAdjustment, drop, underDelivery, notActionableYet];
  const candidateGroup = (rows: Deal[], limit: number) => {
    const included = rows.slice(0, limit).map(dealLine);
    return {
      total: rows.length,
      included: included.length,
      truncated: included.length < rows.length,
      deals: included,
    };
  };
  const enrichmentSummary = enrichmentOverview(deals);
  const verticalSummary = verticalPerformance(deals).slice(0, MAX_SEGMENT_ROWS);

  const createDigest = (candidateLimit: number) => {
    const candidates = {
      longterm: candidateGroup(longterm, candidateLimit),
      rebook: candidateGroup(rebook, candidateLimit),
      priceAdjustment: candidateGroup(priceAdjustment, candidateLimit),
      drop: candidateGroup(drop, candidateLimit),
      underDelivery: candidateGroup(underDelivery, candidateLimit),
      notActionableYet: candidateGroup(notActionableYet, candidateLimit),
    };
    const includedPlanRows = planRows.slice(0, MAX_PLAN_ROWS);
    return JSON.stringify({
      snapshot: {
        generatedAt: now.toISOString(),
        currentMonth: now.toISOString().slice(0, 7),
        nextCalendarMonth: nextIsoMonth(now),
        activeFilters,
      },
      evidenceRules: {
        returnActionsRequireMaturity: "matured means at least 14 days since publishedAt",
        candidateGroupsComplete: candidateRows.every((rows) => rows.length <= candidateLimit),
        candidateLimitPerGroup: candidateLimit,
        planScope: "Plan rows are CM × market × month; other active filters cannot narrow plan totals.",
      },
      totals: totalsOf(deals),
      enrichment: {
        overview: {
          campaigns: enrichmentSummary.campaigns,
          enrichedCampaigns: enrichmentSummary.enrichedCampaigns,
          coveragePct: round(
            enrichmentSummary.coverageShare === null
              ? null
              : enrichmentSummary.coverageShare * 100,
          ),
          enrichedCreators: enrichmentSummary.enrichedCreators,
          controlledVerticals: enrichmentSummary.verticals,
          avgEngagementRatePct: round(enrichmentSummary.avgEngagementRatePct),
          lowSafetyRiskSharePct: round(
            enrichmentSummary.brandSafeShare === null
              ? null
              : enrichmentSummary.brandSafeShare * 100,
          ),
        },
        verticalPerformance: verticalSummary.map((vertical) => ({
            vertical: vertical.vertical,
            campaigns: vertical.campaigns,
            measuredReturns: vertical.measuredReturns,
            enrichedCreators: vertical.enrichedCreators,
            cost: Math.round(vertical.cost),
            views: Math.round(vertical.views),
            d7Purchases: Math.round(vertical.d7Purchases),
            avgReturnPct: round(vertical.avgReturnPct),
            avgEngagementRatePct: round(vertical.avgEngagementRatePct),
            avgFollowers: round(vertical.avgFollowers),
            lowSafetyRiskSharePct: round(
              vertical.brandSafeShare === null ? null : vertical.brandSafeShare * 100,
            ),
          })),
      },
      segments: {
        byCm: groupSummary("cm"),
        byMarket: groupSummary("country"),
        byVertical: groupSummary("vertical"),
        byCategory: groupSummary("category"),
        bySize: groupSummary("sizeTier"),
      },
      candidates,
      plan: scorecard
        ? {
            available: true,
            appliedFilters: Object.fromEntries(
              Object.entries(activeFilters).filter(([key]) => planFilterKeys.has(key)),
            ),
            ignoredFilters: ignoredPlanFilters,
            totalRows: planRows.length,
            includedRows: includedPlanRows.length,
            truncated: includedPlanRows.length < planRows.length,
            rows: includedPlanRows,
          }
        : {
            available: false,
            reason: "Scorecard data was unavailable for this snapshot.",
            ignoredFilters: ignoredPlanFilters,
            totalRows: 0,
            includedRows: 0,
            truncated: false,
            rows: [],
          },
      unmeasured: {
        missingReturn: deals.filter((deal) => deal.returnPct === null).length,
        missingDelivery: deals.filter((deal) => deal.deliveryPct === null).length,
        unknownMaturity: deals.filter(
          (deal) => getMaturityInfo(deal.publishedAt, now).status === "unknown",
        ).length,
      },
      painPoints: painPoints(deals)
        .slice(0, MAX_PAIN_POINTS)
        .map((point) => compactText(point.detail, 300)),
    });
  };

  for (const candidateLimit of CANDIDATE_LIMITS) {
    const digest = createDigest(candidateLimit);
    if (digest.length <= MAX_DIGEST_CHARS) return digest;
  }

  return JSON.stringify({
    snapshot: { generatedAt: now.toISOString(), activeFilters },
    totals: totalsOf(deals),
    error: "Detailed evidence exceeded the analyst context limit.",
  });
}
