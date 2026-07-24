import { describe, expect, it } from "vitest";

import type { Scorecard } from "../../../src/bookings/scorecard";
import type { Booking } from "../../../src/bookings/types";
import type { Campaign } from "../types";
import {
  bestDealsByCm,
  buildDigest,
  dimensionOptions,
  enrichmentOverview,
  filterDeals,
  groupByDimension,
  joinDeals,
  painPoints,
  sizeTierOf,
  totalsOf,
  verticalPerformance,
} from "./enrich";
import { ALL_FILTERS, UNASSIGNED } from "./types";

function campaign(overrides: Partial<Campaign>): Campaign {
  return {
    campaignName: "ASMRFIXY_YT_R1",
    campaignSource: "Arch",
    platform: "youtube",
    country: "PL",
    publishedAt: "2026-07-13T18:00:20.000Z",
    cost: 1000,
    expectedCpm: 20,
    viewCount: 40_000,
    signupsPct: null,
    roasD7pD14: null,
    roasReturn: null,
    returnPct: 90,
    appuD14: null,
    d7Purchases: null,
    channelName: "ASMR Fixy",
    videoUrl: "https://www.youtube.com/watch?v=asmrfixy",
    ...overrides,
  };
}

function booking(overrides: Partial<Booking>): Booking {
  return {
    id: 1,
    channelName: "ASMR Fixy",
    channelKey: "ASMRFIXY",
    channelUrl: null,
    country: "PL",
    cm: "Lucija P",
    platform: "youtube",
    status: "published",
    activation: null,
    numActivations: null,
    contractSigned: true,
    contractUrl: null,
    publishedAt: "2026-07-13",
    intBudget: 12_000,
    extBudget: 15_000,
    currency: "EUR",
    month: "2026-07",
    note: null,
    videoUrl: null,
    vertical: "gaming",
    category: "integration",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function enrichedCreator(): NonNullable<Campaign["enrichment"]> {
  return {
    channel: {
      id: "channel",
      url: "https://youtube.com/channel/channel",
      title: "Geo Creator",
      handle: "@geocreator",
      description: "Competitive geography gaming and quizzes.",
      country: "ES",
      publishedAt: "2020-01-01T00:00:00.000Z",
      thumbnailUrl: null,
      subscribers: 50_000,
      subscribersHidden: false,
      totalViews: 5_000_000,
      totalVideos: 200,
      topics: ["geography", "gaming"],
      keywords: ["geoguessr"],
    },
    metrics: {
      followers: 50_000,
      totalViews: 5_000_000,
      totalVideos: 200,
      typicalViews: { median: 35_000, average: 40_000, sampleSize: 20 },
      typicalEngagementRatePct: 4.4,
      typicalViewsPerFollowerPct: 70,
      contentFormat: { dominant: "long_form", mix: [] },
      uploadActivity: {
        lastUploadAt: "2026-07-20T00:00:00.000Z",
        daysSinceLastUpload: 2,
        uploadsLast30Days: 12,
        uploadsLast90Days: 36,
        uploadsPerWeek: 3,
      },
    },
    classification: {
      niche: "spanish-language geography gaming",
      topics: ["geoguessr", "geography quizzes", "maps"],
      language: { primary: "Spanish", other: [] },
      audiencePositioning: "Geography and GeoGuessr fans.",
      brandFit: {
        suitability: "high",
        categories: ["gaming", "education", "travel"],
        rationale: "Strong fit.",
      },
      brandSafety: { risk: "low", concerns: [], rationale: "Low risk." },
    },
    summary: "An active geography gaming creator.",
    confidence: { overall: 0.9, dataCompleteness: 0.9, analysis: 0.9, reasons: [] },
    warnings: [],
    meta: {
      generatedAt: "2026-07-20T00:00:00.000Z",
      youtubeDataSource: "youtube_data_api_v3",
      analyzer: "test",
      recentVideoLimit: 20,
    },
  };
}

describe("sizeTierOf", () => {
  it("maps budgets onto the plan tiers", () => {
    expect(sizeTierOf(5_000)).toBe("<10k");
    expect(sizeTierOf(10_000)).toBe("10-20k");
    expect(sizeTierOf(20_000)).toBe("20-50k");
    expect(sizeTierOf(50_000)).toBe("20-50k");
    expect(sizeTierOf(50_001)).toBe(">50k");
    expect(sizeTierOf(null)).toBeNull();
  });
});

describe("joinDeals", () => {
  it("joins campaigns to bookings via the normalized channel key", () => {
    const deals = joinDeals([campaign({})], [booking({})]);

    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({
      channelKey: "ASMRFIXY",
      channelName: "ASMR Fixy",
      cm: "Lucija P",
      vertical: "Gaming",
      verticals: ["Gaming"],
      hasCampaign: true,
      hasBooking: true,
      expectedViews: 50_000,
      deliveryPct: 80,
      sizeTier: "10-20k",
    });
  });

  it("uses the campaign market when it differs from the booking market", () => {
    const [deal] = joinDeals(
      [campaign({ country: "DE" })],
      [booking({ country: "PL" })],
    );

    expect(deal?.country).toBe("DE");
  });

  it("keeps unmatched campaigns and unmatched bookings as separate rows", () => {
    const deals = joinDeals(
      [campaign({ campaignName: "PHILFLIX_YT_R1" })],
      [booking({ channelKey: "DIABEUU", channelName: "Diabeuu", status: "pipeline" })],
    );

    expect(deals).toHaveLength(2);
    const [fromCampaign, fromBooking] = deals;
    expect(fromCampaign).toMatchObject({ hasBooking: false, cm: null, country: "PL" });
    expect(fromBooking).toMatchObject({ hasCampaign: false, cost: null, status: "pipeline" });
  });

  it("joins multiple campaign rounds of one channel to the same booking", () => {
    const deals = joinDeals(
      [campaign({}), campaign({ campaignName: "ASMRFIXY_YT_R2", returnPct: 120 })],
      [booking({})],
    );
    expect(deals).toHaveLength(2);
    expect(deals.every((deal) => deal.cm === "Lucija P")).toBe(true);
  });

  it("uses controlled enrichment verticals and exposes creator-quality metrics", () => {
    const deals = joinDeals(
      [campaign({ enrichment: enrichedCreator(), d7Purchases: 40 })],
      [booking({ vertical: "finance" })],
    );
    const [deal] = deals;

    expect(deal).toMatchObject({
      vertical: "Education",
      verticals: ["Education", "Gaming"],
      hasEnrichment: true,
      creatorFollowers: 50_000,
      creatorTypicalViews: 35_000,
      creatorEngagementRatePct: 4.4,
      creatorBrandFit: "high",
      creatorSafetyRisk: "low",
    });
    expect(filterDeals(deals, { ...ALL_FILTERS, vertical: "Gaming" })).toHaveLength(1);
    expect(dimensionOptions(deals).vertical).toEqual(["Education", "Gaming"]);
    expect(groupByDimension(deals, "vertical").map((group) => group.key)).toEqual([
      "Education",
      "Gaming",
    ]);

    expect(enrichmentOverview(deals)).toMatchObject({
      campaigns: 1,
      enrichedCampaigns: 1,
      verticals: 2,
      coverageShare: 1,
      brandSafeShare: 1,
    });
    expect(verticalPerformance(deals)).toEqual([
      expect.objectContaining({
        vertical: "Education",
        campaigns: 1,
        d7Purchases: 40,
        avgEngagementRatePct: 4.4,
      }),
      expect.objectContaining({
        vertical: "Gaming",
        campaigns: 1,
        d7Purchases: 40,
        avgEngagementRatePct: 4.4,
      }),
    ]);
  });
});

describe("filtering and grouping", () => {
  const deals = joinDeals(
    [
      campaign({}),
      campaign({ campaignName: "PHILFLIX_YT_R1", country: "DE", cost: 500, returnPct: 30, viewCount: 5_000 }),
    ],
    [
      booking({}),
      booking({
        id: 2,
        channelKey: "PHILFLIX",
        channelName: "Philflix",
        country: "DE",
        cm: "Miro",
        vertical: "entertainment",
        intBudget: 4_000,
      }),
    ],
  );

  it("filters by any dimension, mapping null to Unassigned", () => {
    expect(filterDeals(deals, { ...ALL_FILTERS, country: "PL" })).toHaveLength(1);
    expect(filterDeals(deals, { ...ALL_FILTERS, vertical: "Entertainment" })).toHaveLength(1);
    expect(filterDeals(deals, { ...ALL_FILTERS, cm: UNASSIGNED })).toHaveLength(0);
  });

  it("lists dimension options with Unassigned last", () => {
    const mixed = [...deals, ...joinDeals([campaign({ campaignName: "NOBOOKING_YT_R1" })], [])];
    const options = dimensionOptions(mixed);
    expect(options.cm).toEqual(["Lucija P", "Miro", UNASSIGNED]);
  });

  it("aggregates cost-weighted return and delivery per group", () => {
    const groups = groupByDimension(deals, "cm");
    const lucija = groups.find((group) => group.key === "Lucija P");
    const miro = groups.find((group) => group.key === "Miro");

    expect(lucija).toMatchObject({ deals: 1, cost: 1000, avgReturnPct: 90 });
    expect(miro?.avgReturnPct).toBe(30);
    // PHILFLIX expected views: 500 / 20 * 1000 = 25k; delivered 5k = 20%
    expect(miro?.deliveryPct).toBeCloseTo(20);
  });

  it("computes totals across the filtered set", () => {
    const totals = totalsOf(deals);
    expect(totals.deals).toBe(2);
    expect(totals.markets).toBe(2);
    expect(totals.cost).toBe(1500);
    expect(totals.intBudget).toBe(16_000);
    // Weighted return: (90*1000 + 30*500) / 1500 = 70
    expect(totals.avgReturnPct).toBe(70);
    expect(totals.publishedShare).toBe(1);
  });
});

describe("pain points and best deals", () => {
  it("flags low-return and under-delivery groups with enough evidence", () => {
    const deals = joinDeals(
      [
        campaign({ campaignName: "A_YT_R1", country: "FR", returnPct: 20, cost: 1000, viewCount: 10_000 }),
        campaign({ campaignName: "B_YT_R1", country: "FR", returnPct: 40, cost: 1000, viewCount: 12_000 }),
      ],
      [
        booking({ id: 1, channelKey: "A", channelName: "A", country: "FR" }),
        booking({ id: 2, channelKey: "B", channelName: "B", country: "FR" }),
      ],
    );

    const points = painPoints(deals);
    const issues = points.filter((point) => point.key === "FR").map((point) => point.issue);
    expect(issues).toContain("low-return");
    expect(issues).toContain("under-delivery");
    expect(points[0]?.severity).toBe("high");
  });

  it("does not flag low-return on a single measured deal", () => {
    const deals = joinDeals(
      [campaign({ campaignName: "A_YT_R1", returnPct: 20, viewCount: 60_000 })],
      [booking({ id: 1, channelKey: "A", channelName: "A", country: "FR" })],
    );
    expect(painPoints(deals).filter((point) => point.issue === "low-return")).toHaveLength(0);
  });

  it("ranks CMs by weighted return with their top deals", () => {
    const deals = joinDeals(
      [
        campaign({ campaignName: "A_YT_R1", returnPct: 150, cost: 1000 }),
        campaign({ campaignName: "B_YT_R1", returnPct: 40, cost: 1000 }),
      ],
      [
        booking({ id: 1, channelKey: "A", channelName: "A", cm: "Ana" }),
        booking({ id: 2, channelKey: "B", channelName: "B", cm: "Ben" }),
      ],
    );

    const leaderboard = bestDealsByCm(deals);
    expect(leaderboard[0]).toMatchObject({ cm: "Ana", avgReturnPct: 150 });
    expect(leaderboard[1]?.deals[0]?.channelName).toBe("B");
  });
});

describe("buildDigest", () => {
  it("produces parseable JSON with totals, groups, and active filters", () => {
    const deals = joinDeals([campaign({})], [booking({})]);
    const digest = JSON.parse(buildDigest(deals, { ...ALL_FILTERS, country: "PL" })) as {
      snapshot: { activeFilters: Record<string, string> };
      totals: { deals: number };
      segments: { byMarket: { rows: Array<{ country: string }> } };
    };

    expect(digest.snapshot.activeFilters).toEqual({ country: "PL" });
    expect(digest.totals.deals).toBe(1);
    expect(digest.segments.byMarket.rows[0]?.country).toBe("PL");
  });

  it("separates matured decisions from campaigns that are still maturing", () => {
    const deals = joinDeals(
      [
        campaign({ campaignName: "MATURE_YT_R1", publishedAt: "2026-06-01T00:00:00Z", returnPct: 80 }),
        campaign({ campaignName: "FRESH_YT_R1", publishedAt: "2026-07-25T00:00:00Z", returnPct: 20 }),
      ],
      [
        booking({ id: 1, channelKey: "MATURE", channelName: "Mature", month: "2026-08" }),
        booking({ id: 2, channelKey: "FRESH", channelName: "Fresh", month: "2026-08" }),
      ],
    );
    const digest = JSON.parse(
      buildDigest(deals, ALL_FILTERS, null, new Date("2026-08-01T00:00:00Z")),
    ) as {
      candidates: Record<string, { total: number; deals: Array<Record<string, unknown>> }>;
    };

    expect(digest.candidates.rebook?.total).toBe(1);
    expect(digest.candidates.priceAdjustment?.total).toBe(0);
    expect(digest.candidates.drop?.total).toBe(0);
    expect(digest.candidates.notActionableYet?.total).toBe(1);
    expect(digest.candidates.rebook?.deals[0]).toMatchObject({
      channel: "Mature",
      returnPct: 80,
      expectedCpmEur: 20,
      realisedCpmEur: 25,
      deliveryAlignedCostEur: 800,
      maturity: { status: "matured", daysRemaining: 0 },
    });
  });

  it("includes filtered plan headroom and discloses unsupported plan filters", () => {
    const scorecard: Scorecard = {
      months: [],
      unscheduledCount: 0,
      rows: [
        {
          cm: "Lucija P",
          market: "PL",
          month: "2026-08",
          targetEur: 100_000,
          targetTiers: { under10k: 2, from10kTo20k: 3, from20kTo50k: 1, over50k: 0 },
          bookedEur: 30_000,
          bookedTiers: { under10k: 1, from10kTo20k: 1, from20kTo50k: 0, over50k: 0 },
          counts: { pipeline: 2, booked: 1, published: 1, longterm: 0, dropped: 0 },
          utilization: 0.3,
          pace: 0.6,
          dropoutRate: 0,
        },
      ],
    };
    const filters = {
      ...ALL_FILTERS,
      country: "PL",
      vertical: "gaming",
      month: "2026-08",
    };
    const digest = JSON.parse(
      buildDigest([], filters, scorecard, new Date("2026-07-22T00:00:00Z")),
    ) as {
      plan: {
        appliedFilters: Record<string, string>;
        ignoredFilters: string[];
        rows: Array<{ remainingEur: number; utilizationPct: number; pacePct: number }>;
      };
    };

    expect(digest.plan.appliedFilters).toEqual({ country: "PL", month: "2026-08" });
    expect(digest.plan.ignoredFilters).toEqual(["vertical"]);
    expect(digest.plan.rows[0]).toMatchObject({
      remainingEur: 70_000,
      utilizationPct: 30,
      pacePct: 60,
    });
  });

  it("labels candidate truncation and keeps the digest below the request limit", () => {
    const campaigns = Array.from({ length: 41 }, (_, index) =>
      campaign({
        campaignName: `CHANNEL${index}_YT_R1`,
        publishedAt: "2026-06-01T00:00:00Z",
        returnPct: 120 + index,
      }),
    );
    const bookings = Array.from({ length: 41 }, (_, index) =>
      booking({
        id: index + 1,
        channelKey: `CHANNEL${index}`,
        channelName: `Channel ${index}`,
      }),
    );
    const digestText = buildDigest(
      joinDeals(campaigns, bookings),
      ALL_FILTERS,
      null,
      new Date("2026-08-01T00:00:00Z"),
    );
    const digest = JSON.parse(digestText) as {
      evidenceRules: { candidateGroupsComplete: boolean };
      candidates: { longterm: { total: number; included: number; truncated: boolean } };
    };

    expect(digest.candidates.longterm).toMatchObject({ total: 41, included: 40, truncated: true });
    expect(digest.evidenceRules.candidateGroupsComplete).toBe(false);
    expect(digestText.length).toBeLessThanOrEqual(190_000);
  });
});
