import { describe, expect, it } from "vitest";

import {
  filterCampaigns,
  getMaturityInfo,
  getReturnTier,
  monthlyPerformance,
  returnTierGroups,
  weightedAverage,
} from "./analytics";
import type { Campaign, CampaignFilters } from "./types";

function campaign(overrides: Partial<Campaign>): Campaign {
  return {
    campaignName: "Campaign",
    campaignSource: "Agency",
    platform: "youtube",
    country: "DE",
    publishedAt: "2026-07-01T00:00:00.000Z",
    cost: 100,
    expectedCpm: 10,
    viewCount: 1000,
    signupsPct: 0.02,
    roasD7pD14: 0.5,
    roasReturn: 1,
    returnPct: 0.1,
    appuD14: 2,
    d7Purchases: 20,
    channelName: "Creator",
    videoUrl: null,
    ...overrides,
  };
}

describe("dashboard analytics", () => {
  it("calculates cost-weighted ROAS", () => {
    const rows = [
      campaign({ cost: 100, roasReturn: 1 }),
      campaign({ cost: 300, roasReturn: 2 }),
    ];
    expect(weightedAverage(rows, "roasReturn", "cost")).toBe(1.75);
  });

  it("filters by platform, date, and campaign name", () => {
    const rows = [
      campaign({ campaignName: "Summer YouTube", publishedAt: "2026-06-12T00:00:00Z" }),
      campaign({
        campaignName: "Winter TikTok",
        platform: "tiktok",
        publishedAt: "2025-12-01T00:00:00Z",
      }),
    ];
    expect(
      filterCampaigns(rows, {
        platform: "youtube",
        country: "DE",
        returnTier: "all",
        maturity: "all",
        from: "2026-01-01",
        to: "2026-12-31",
        search: "summer",
      }),
    ).toHaveLength(1);
  });

  it("groups performance chronologically by month", () => {
    const rows = [
      campaign({ publishedAt: "2026-07-02T00:00:00Z" }),
      campaign({ publishedAt: "2026-06-02T00:00:00Z" }),
    ];
    expect(monthlyPerformance(rows).map((month) => month.key)).toEqual(["2026-06", "2026-07"]);
  });

  it("uses the agreed return tier boundaries", () => {
    expect(getReturnTier(100.01)).toBe("longterm");
    expect(getReturnTier(100)).toBe("rebooking");
    expect(getReturnTier(80)).toBe("rebooking");
    expect(getReturnTier(79.99)).toBe("price_adjusted");
    expect(getReturnTier(50)).toBe("price_adjusted");
    expect(getReturnTier(49.99)).toBe("drop");
    expect(getReturnTier(null)).toBeNull();
  });

  it("summarizes campaign counts by return tier", () => {
    const groups = returnTierGroups([
      campaign({ returnPct: 125 }),
      campaign({ returnPct: 90 }),
      campaign({ returnPct: 65 }),
      campaign({ returnPct: 20 }),
    ]);
    expect(groups.map((group) => group.count)).toEqual([1, 1, 1, 1]);
    expect(groups.map((group) => group.share)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("filters the campaign view by return tier", () => {
    const rows = [
      campaign({ campaignName: "Longterm", returnPct: 120 }),
      campaign({ campaignName: "Rebooking", returnPct: 90 }),
    ];
    const filtered = filterCampaigns(rows, {
      platform: "all",
      country: "all",
      returnTier: "longterm",
      maturity: "all",
      from: "",
      to: "",
      search: "",
    });
    expect(filtered.map((row) => row.campaignName)).toEqual(["Longterm"]);
  });

  it("marks campaigns as matured exactly 14 days after publication", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    expect(getMaturityInfo("2026-07-01T12:00:00Z", now)).toEqual({
      status: "matured",
      daysRemaining: 0,
    });
    expect(getMaturityInfo("2026-07-02T12:00:00Z", now)).toEqual({
      status: "maturing",
      daysRemaining: 1,
    });
    expect(getMaturityInfo(null, now)).toEqual({ status: "unknown", daysRemaining: null });
  });

  it("filters the campaign view by maturity", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    const rows = [
      campaign({ campaignName: "Matured", publishedAt: "2026-07-01T12:00:00Z" }),
      campaign({ campaignName: "Maturing", publishedAt: "2026-07-10T12:00:00Z" }),
      campaign({ campaignName: "Unknown", publishedAt: null }),
    ];
    const filtered = filterCampaigns(
      rows,
      {
        platform: "all",
        country: "all",
        returnTier: "all",
        maturity: "matured",
        from: "",
        to: "",
        search: "",
      },
      now,
    );
    expect(filtered.map((row) => row.campaignName)).toEqual(["Matured"]);
  });

  it("treats filter fields missing from stale browser state as All", () => {
    const staleFilters = {
      platform: "all",
      from: "",
      to: "",
      search: "",
    } as CampaignFilters;
    expect(filterCampaigns([campaign({})], staleFilters)).toHaveLength(1);
  });

  it("filters campaigns by country", () => {
    const rows = [campaign({ country: "DE" }), campaign({ country: "US" })];
    const filtered = filterCampaigns(rows, {
      platform: "all",
      country: "DE",
      returnTier: "all",
      maturity: "all",
      from: "",
      to: "",
      search: "",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.country).toBe("DE");
  });
});
