import { describe, expect, it } from "vitest";

import {
  crossTab,
  efficiencyPoints,
  maturityMix,
  monthlyTrend,
  returnDistribution,
  roundAnalysis,
  roundOf,
  spendConcentration,
  unitEconomics,
} from "./charts";
import type { Deal } from "./types";

function deal(overrides: Partial<Deal>): Deal {
  const result: Deal = {
    channelKey: "CHAN",
    channelName: "Channel",
    campaignName: "CHAN_YT_R1",
    videoUrl: null,
    platform: "youtube",
    publishedAt: "2026-07-13",
    cost: 1000,
    expectedCpm: 20,
    viewCount: 50_000,
    returnPct: 90,
    signupsPct: 0.02,
    d7Purchases: 100,
    roasReturn: 0.9,
    appuD14: null,
    expectedViews: 50_000,
    deliveryPct: 100,
    cm: "Lucija P",
    country: "PL",
    vertical: "gaming",
    verticals: ["gaming"],
    category: "integration",
    hasEnrichment: false,
    creatorFollowers: null,
    creatorTypicalViews: null,
    creatorEngagementRatePct: null,
    creatorContentFormat: null,
    creatorBrandFit: null,
    creatorSafetyRisk: null,
    status: "published",
    intBudget: 12_000,
    extBudget: 15_000,
    month: "2026-07",
    sizeTier: "10-20k",
    hasCampaign: true,
    hasBooking: true,
    ...overrides,
  };
  if (overrides.vertical !== undefined && overrides.verticals === undefined) {
    result.verticals = overrides.vertical ? [overrides.vertical] : [];
  }
  return result;
}

describe("returnDistribution", () => {
  it("buckets measured deals into tier bands and ignores unmeasured", () => {
    const { bands, measured } = returnDistribution([
      deal({ returnPct: 30, cost: 100 }),
      deal({ returnPct: 65, cost: 200 }),
      deal({ returnPct: 95, cost: 300 }),
      deal({ returnPct: 120, cost: 400 }),
      deal({ returnPct: 200, cost: 500 }),
      deal({ returnPct: null, cost: 999 }),
    ]);
    expect(measured).toBe(5);
    expect(bands.map((band) => band.deals)).toEqual([1, 1, 1, 1, 1]);
    expect(bands[0]).toMatchObject({ label: "<50%", cost: 100, tone: "bad" });
    expect(bands[4]).toMatchObject({ label: "≥150%", cost: 500, tone: "good" });
  });

  it("puts the tier boundaries in the higher band", () => {
    const { bands } = returnDistribution([
      deal({ returnPct: 50 }),
      deal({ returnPct: 80 }),
      deal({ returnPct: 100 }),
    ]);
    // 50 → "50–80%", 80 → "80–100%", 100 → "100–150%"
    expect(bands[1].deals).toBe(1);
    expect(bands[2].deals).toBe(1);
    expect(bands[3].deals).toBe(1);
    expect(bands[0].deals).toBe(0);
  });

  it("returns a null median when nothing is measured", () => {
    expect(returnDistribution([deal({ returnPct: null })]).medianReturnPct).toBeNull();
  });
});

describe("unitEconomics", () => {
  it("computes each metric over its own valid cohort (signupsPct is a fraction)", () => {
    const metrics = unitEconomics([
      deal({ cost: 1_000, viewCount: 50_000, expectedViews: 40_000, signupsPct: 0.02, d7Purchases: 100 }),
      deal({ cost: 3_000, viewCount: 100_000, expectedViews: 100_000, signupsPct: 0.03, d7Purchases: 300 }),
    ]);
    // realised CPM = 4000 / 150000 actual views * 1000
    expect(metrics.realisedCpm).toBeCloseTo((4_000 / 150_000) * 1000, 6);
    // expected CPM on the same basis = 4000 / 140000 expected views * 1000
    expect(metrics.expectedCpm).toBeCloseTo((4_000 / 140_000) * 1000, 6);
    // signups = 50000*0.02 + 100000*0.03 = 1000 + 3000 = 4000
    expect(metrics.signups).toBeCloseTo(4_000, 6);
    // signup rate = 4000 / 150000
    expect(metrics.signupRate).toBeCloseTo(4_000 / 150_000, 8);
    // cost 4000 / 4000 signups → €1
    expect(metrics.costPerSignup).toBeCloseTo(1, 6);
    // purchases = 400, cost 4000 → €10
    expect(metrics.costPerPurchase).toBeCloseTo(10, 6);
    expect(metrics.measuredCampaigns).toBe(2);
  });

  it("ignores booking-only rows with no campaign", () => {
    const metrics = unitEconomics([deal({ hasCampaign: false, viewCount: null, cost: null })]);
    expect(metrics.views).toBe(0);
    expect(metrics.realisedCpm).toBeNull();
    expect(metrics.costPerSignup).toBeNull();
  });

  it("weights APPU by the users behind each campaign (modeled signups)", () => {
    // Campaign A: 50000 * 0.02 = 1000 users, APPU 2; B: 100000 * 0.03 = 3000 users, APPU 6.
    // Weighted APPU = (2*1000 + 6*3000) / 4000 = 20000/4000 = 5.
    const metrics = unitEconomics([
      deal({ viewCount: 50_000, signupsPct: 0.02, appuD14: 2 }),
      deal({ viewCount: 100_000, signupsPct: 0.03, appuD14: 6 }),
    ]);
    expect(metrics.appuD14).toBeCloseTo(5, 6);
  });

  it("returns a null APPU when no campaign carries one", () => {
    expect(unitEconomics([deal({ appuD14: null })]).appuD14).toBeNull();
  });
});

describe("crossTab", () => {
  it("builds a spend-ordered return matrix over two dimensions", () => {
    const table = crossTab(
      [
        deal({ country: "PL", vertical: "gaming", cost: 1_000, returnPct: 120 }),
        deal({ country: "PL", vertical: "finance", cost: 3_000, returnPct: 40 }),
        deal({ country: "US", vertical: "gaming", cost: 500, returnPct: 90 }),
      ],
      "country",
      "vertical",
    );
    // PL leads on spend (4000 vs 500); finance leads gaming (3000 vs 1500)
    expect(table.rows).toEqual(["PL", "US"]);
    expect(table.cols).toEqual(["finance", "gaming"]);
    const plGaming = table.cells.find((c) => c.row === "PL" && c.col === "gaming");
    expect(plGaming).toMatchObject({ avgReturnPct: 120, deals: 1, cost: 1_000 });
    // empty intersection (US × finance) is omitted
    expect(table.cells.find((c) => c.row === "US" && c.col === "finance")).toBeUndefined();
  });
});

describe("spendConcentration", () => {
  it("ranks channels by spend with cumulative shares and an others bucket", () => {
    const result = spendConcentration(
      [
        deal({ channelName: "A", cost: 5_000 }),
        deal({ channelName: "B", cost: 3_000 }),
        deal({ channelName: "C", cost: 2_000 }),
      ],
      2,
    );
    expect(result.totalCost).toBe(10_000);
    expect(result.rows.map((r) => r.channelName)).toEqual(["A", "B"]);
    expect(result.rows[0]).toMatchObject({ share: 0.5, cumulativeShare: 0.5 });
    expect(result.rows[1].cumulativeShare).toBeCloseTo(0.8, 10);
    expect(result.othersCost).toBe(2_000);
    expect(result.topShare).toBeCloseTo(0.8, 10);
  });

  it("sums repeated channels and skips costless rows", () => {
    const result = spendConcentration([
      deal({ channelName: "A", cost: 1_000 }),
      deal({ channelName: "A", cost: 500 }),
      deal({ channelName: "B", cost: null }),
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ channelName: "A", cost: 1_500 });
  });
});

describe("efficiencyPoints", () => {
  it("keeps only measured, priced deals and tones them by tier", () => {
    const points = efficiencyPoints([
      deal({ channelName: "A", cost: 1_000, returnPct: 120 }),
      deal({ channelName: "B", cost: 1_000, returnPct: 40 }),
      deal({ channelName: "C", cost: null, returnPct: 90 }),
      deal({ channelName: "D", cost: 1_000, returnPct: null }),
    ]);
    expect(points.map((p) => p.channelName)).toEqual(["A", "B"]);
    expect(points[0].tone).toBe("good");
    expect(points[1].tone).toBe("bad");
  });
});

describe("monthlyTrend", () => {
  it("groups campaigns by publish month, cost-weighted and time-sorted", () => {
    const trend = monthlyTrend([
      deal({ publishedAt: "2026-06-10", cost: 1_000, returnPct: 60 }),
      deal({ publishedAt: "2026-07-05", cost: 1_000, returnPct: 100 }),
      deal({ publishedAt: "2026-07-25", cost: 3_000, returnPct: 200 }),
      deal({ hasCampaign: false, publishedAt: "2026-07-01", cost: null }),
    ]);
    expect(trend.map((point) => point.month)).toEqual(["2026-06", "2026-07"]);
    // July cost-weighted return = (100*1000 + 200*3000) / 4000 = 175
    const july = trend.find((point) => point.month === "2026-07");
    expect(july).toMatchObject({ cost: 4_000, deals: 2, measured: 2 });
    expect(july?.avgReturnPct).toBeCloseTo(175, 6);
  });
});

describe("roundOf", () => {
  it("parses the round suffix and returns null when absent", () => {
    expect(roundOf("ASMRFIXY_YT_R1")).toBe(1);
    expect(roundOf("BASTOSTV_YT_R4")).toBe(4);
    expect(roundOf("DORESAA_IGR_R2")).toBe(2);
    expect(roundOf("GIANMARCOZAGATO")).toBeNull();
    expect(roundOf(null)).toBeNull();
  });
});

describe("roundAnalysis", () => {
  it("buckets by round, tracks rebooking, and buckets R4+", () => {
    const result = roundAnalysis([
      deal({ channelKey: "A", campaignName: "A_YT_R1", cost: 1_000, returnPct: 50 }),
      deal({ channelKey: "A", campaignName: "A_YT_R2", cost: 1_000, returnPct: 90 }),
      deal({ channelKey: "B", campaignName: "B_YT_R5", cost: 2_000, returnPct: 120 }),
      deal({ channelKey: "C", campaignName: "C", cost: 500, returnPct: 40 }), // no suffix → R1
    ]);
    expect(result.rounds.map((r) => r.label)).toEqual(["R1", "R2", "R4+"]);
    // A booked twice and B booked (round 5) → 2 of 3 channels rebooked
    expect(result.totalChannels).toBe(3);
    expect(result.rebookedChannels).toBe(2);
    expect(result.rebookRate).toBeCloseTo(2 / 3, 10);
    const r1 = result.rounds.find((r) => r.round === 1);
    // R1 cost-weighted return = (50*1000 + 40*500) / 1500
    expect(r1?.avgReturnPct).toBeCloseTo((50 * 1_000 + 40 * 500) / 1_500, 6);
    expect(r1?.channels).toBe(2);
  });
});

describe("maturityMix", () => {
  const now = new Date("2026-07-21T00:00:00Z");
  it("splits campaigns into matured / maturing / unknown", () => {
    const mix = maturityMix(
      [
        deal({ publishedAt: "2026-06-01", cost: 1_000, returnPct: 90 }), // matured (>14d)
        deal({ publishedAt: "2026-07-18", cost: 2_000, returnPct: 30 }), // maturing (<14d)
        deal({ publishedAt: null, cost: 500, returnPct: 10 }), // unknown
      ],
      now,
    );
    expect(mix.matured).toMatchObject({ deals: 1, cost: 1_000, avgReturnPct: 90 });
    expect(mix.maturing).toMatchObject({ deals: 1, cost: 2_000, avgReturnPct: 30 });
    expect(mix.unknown.deals).toBe(1);
  });
});
