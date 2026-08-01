import { describe, expect, it } from "vitest";

import { bookingSuggestions } from "./suggestions";
import type { Deal } from "./types";

/** Fixed "now" so maturity is deterministic (deals below publish in June/July). */
const NOW = new Date("2026-08-01T00:00:00Z");

function deal(overrides: Partial<Deal>): Deal {
  const result: Deal = {
    channelKey: "CHAN",
    channelName: "Channel",
    campaignName: "CHAN_YT_R1",
    videoUrl: null,
    platform: "youtube",
    publishedAt: "2026-07-01", // 31 days before NOW → matured
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

describe("bookingSuggestions", () => {
  it("returns nothing when there are no matured measured deals", () => {
    const maturing = deal({ publishedAt: "2026-07-30" }); // 2 days before NOW
    expect(bookingSuggestions([maturing], NOW)).toEqual([]);
  });

  it("recommends booking more of a strong niche with the supporting number", () => {
    const deals = [
      deal({ channelKey: "A", vertical: "gaming", returnPct: 130, cost: 5000 }),
      deal({ channelKey: "B", vertical: "gaming", returnPct: 120, cost: 5000 }),
    ];
    const suggestions = bookingSuggestions(deals, NOW);
    const bookMore = suggestions.find((s) => s.id === "vertical-gaming");
    expect(bookMore).toBeDefined();
    expect(bookMore?.kind).toBe("book-more");
    expect(bookMore?.headline).toContain("gaming");
    expect(bookMore?.detail).toMatch(/125%|12\d%/); // cost-weighted ~125%
  });

  it("counts channels earning a rebooking", () => {
    const deals = [
      deal({ channelKey: "A", channelName: "Alpha", returnPct: 140 }),
      deal({ channelKey: "B", channelName: "Beta", returnPct: 85 }),
      deal({ channelKey: "C", channelName: "Gamma", returnPct: 60 }), // below 80, excluded
    ];
    const rebook = bookingSuggestions(deals, NOW).find((s) => s.kind === "rebook");
    expect(rebook).toBeDefined();
    expect(rebook?.headline).toContain("2 proven");
    expect(rebook?.detail).toContain("Alpha");
  });

  it("flags a weak niche to ease off", () => {
    const deals = [
      deal({ channelKey: "A", vertical: "finance", returnPct: 30, cost: 4000 }),
      deal({ channelKey: "B", vertical: "finance", returnPct: 40, cost: 4000 }),
    ];
    const reduce = bookingSuggestions(deals, NOW).find((s) => s.kind === "reduce");
    expect(reduce).toBeDefined();
    expect(reduce?.headline).toContain("finance");
  });

  it("derives a winning creator profile from enriched high-returners", () => {
    const deals = [
      deal({ channelKey: "A", returnPct: 130, hasEnrichment: true, creatorTypicalViews: 48_000, creatorEngagementRatePct: 6 }),
      deal({ channelKey: "B", returnPct: 120, hasEnrichment: true, creatorTypicalViews: 52_000, creatorEngagementRatePct: 7 }),
      deal({ channelKey: "C", returnPct: 115, hasEnrichment: true, creatorTypicalViews: 50_000, creatorEngagementRatePct: 5 }),
    ];
    const profile = bookingSuggestions(deals, NOW).find((s) => s.kind === "creator-profile");
    expect(profile).toBeDefined();
    expect(profile?.detail).toMatch(/views/);
    expect(profile?.metric).toMatch(/ER/);
  });

  it("only uses matured returns — maturing deals never drive a suggestion", () => {
    const deals = [
      deal({ channelKey: "A", vertical: "gaming", returnPct: 130, publishedAt: "2026-07-31" }),
      deal({ channelKey: "B", vertical: "gaming", returnPct: 130, publishedAt: "2026-07-31" }),
    ];
    expect(bookingSuggestions(deals, NOW)).toEqual([]);
  });
});
