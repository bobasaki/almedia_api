import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { monthNameToIso, seedTargets } from "./seed";
import { BookingsStore } from "./store";
import { bookingInputSchema, bookingPatchSchema } from "./validation";
import type { ChannelEnrichmentResult } from "../enrichment/types";

function enrichmentResult(): ChannelEnrichmentResult {
  return {
    schemaVersion: "1.0",
    input: { value: "https://youtu.be/abcdefghijk", resolvedVia: "video" },
    channel: {
      id: "UC1234567890123456789012",
      url: "https://www.youtube.com/channel/UC1234567890123456789012",
      title: "ASMR Fixy",
      handle: "@asmrfixy",
      description: "ASMR creator",
      country: "PL",
      publishedAt: "2020-01-01T00:00:00.000Z",
      thumbnailUrl: null,
      subscribers: 100_000,
      subscribersHidden: false,
      totalViews: 10_000_000,
      totalVideos: 200,
      topics: ["asmr"],
      keywords: ["relaxing"],
    },
    recentContent: [],
    metrics: {
      followers: 100_000,
      totalViews: 10_000_000,
      totalVideos: 200,
      typicalViews: { median: null, average: null, sampleSize: 0 },
      typicalEngagementRatePct: null,
      typicalViewsPerFollowerPct: null,
      contentFormat: {
        dominant: "unknown",
        mix: [
          { format: "short", count: 0, sharePct: 0 },
          { format: "long_form", count: 0, sharePct: 0 },
          { format: "live", count: 0, sharePct: 0 },
          { format: "unknown", count: 0, sharePct: 0 },
        ],
      },
      uploadActivity: {
        lastUploadAt: null,
        daysSinceLastUpload: null,
        uploadsLast30Days: 0,
        uploadsLast90Days: 0,
        uploadsPerWeek: null,
      },
    },
    classification: {
      niche: "asmr",
      topics: ["relaxation"],
      language: { primary: "pl", other: [] },
      audiencePositioning: "Polish-speaking relaxation audience.",
      brandFit: {
        suitability: "high",
        categories: ["wellness"],
        rationale: "Strong topical fit.",
      },
      brandSafety: {
        risk: "low",
        concerns: [],
        rationale: "No concerns in sampled metadata.",
      },
    },
    summary: "Polish ASMR creator.",
    confidence: {
      overall: 0.7,
      dataCompleteness: 0.5,
      analysis: 0.8,
      reasons: ["Public profile available."],
    },
    warnings: [],
    meta: {
      generatedAt: "2026-08-03T10:00:00.000Z",
      youtubeDataSource: "youtube_data_api_v3",
      analyzer: "test",
      recentVideoLimit: 20,
    },
  };
}

describe("BookingsStore", () => {
  let store: BookingsStore;
  let clock: Date;

  beforeEach(() => {
    clock = new Date("2026-08-03T10:00:00Z");
    store = new BookingsStore(":memory:", { now: () => clock });
  });

  afterEach(() => {
    store.close();
  });

  it("creates a booking with defaults and derives the channel key", () => {
    const booking = store.createBooking({ channelName: "ASMR Fixy" });

    expect(booking.id).toBe(1);
    expect(booking.channelKey).toBe("ASMRFIXY");
    expect(booking.status).toBe("pipeline");
    expect(booking.currency).toBe("EUR");
    expect(booking.contractSigned).toBe(false);
    expect(booking.createdAt).toBe("2026-08-03T10:00:00.000Z");
  });

  it("round-trips enrichment fields and clears them with empty strings", () => {
    const booking = store.createBooking({
      channelName: "ASMR Fixy",
      vertical: "gaming",
      category: "integration",
    });
    expect(booking.vertical).toBe("gaming");
    expect(booking.category).toBe("integration");

    const patched = store.updateBooking(booking.id, { vertical: "", category: "shorts" });
    expect(patched?.vertical).toBeNull();
    expect(patched?.category).toBe("shorts");
  });

  it("stores one channel enrichment and links it to campaigns, keys, and bookings", () => {
    const result = enrichmentResult();
    const stored = store.upsertChannelEnrichment(result, [
      { sourceType: "campaign", sourceKey: "ASMRFIXY_YT_R1" },
      { sourceType: "channel_key", sourceKey: "ASMRFIXY" },
      { sourceType: "booking", sourceKey: "42" },
    ]);

    expect(stored.result).toEqual(result);
    expect(store.findChannelEnrichment("campaign", "ASMRFIXY_YT_R1")?.result.channel.id).toBe(
      result.channel.id,
    );
    expect(store.findChannelEnrichment("channel_key", "ASMRFIXY")?.result.summary).toBe(
      "Polish ASMR creator.",
    );
    expect(store.listChannelEnrichments()).toHaveLength(1);
  });

  it("round-trips a fully populated booking", () => {
    const booking = store.createBooking({
      channelName: "Diabeuu",
      channelUrl: "https://youtube.com/diabeuu",
      country: "PL",
      cm: "Lucija P",
      platform: "youtube",
      status: "booked",
      activation: "1x YTI",
      numActivations: 2,
      contractSigned: true,
      publishedAt: "2026-08-15",
      intBudget: 2500,
      extBudget: 3125,
      currency: "EUR",
      month: "2026-08",
      note: "rebooking candidate",
    });

    expect(store.getBooking(booking.id)).toEqual(booking);
    expect(booking).toMatchObject({
      country: "PL",
      status: "booked",
      numActivations: 2,
      contractSigned: true,
      intBudget: 2500,
      extBudget: 3125,
      month: "2026-08",
    });
  });

  it("updates only patched fields, re-deriving the key on rename", () => {
    clock = new Date("2026-08-03T10:00:00Z");
    const booking = store.createBooking({ channelName: "Old Name", intBudget: 1000 });

    clock = new Date("2026-08-04T09:00:00Z");
    const updated = store.updateBooking(booking.id, { channelName: "Łukasz TV", status: "dropped" });

    expect(updated).toMatchObject({
      channelName: "Łukasz TV",
      channelKey: "LUKASZTV",
      status: "dropped",
      intBudget: 1000,
      createdAt: "2026-08-03T10:00:00.000Z",
      updatedAt: "2026-08-04T09:00:00.000Z",
    });
  });

  it("returns null when updating and false when deleting a missing booking", () => {
    expect(store.updateBooking(999, { status: "booked" })).toBeNull();
    expect(store.deleteBooking(999)).toBe(false);

    const booking = store.createBooking({ channelName: "Someone" });
    expect(store.deleteBooking(booking.id)).toBe(true);
    expect(store.listBookings()).toHaveLength(0);
  });

  it("upserts targets on the cm+market+month key", () => {
    const first = store.upsertTarget({
      cm: "Miro",
      market: "US",
      month: "2026-08",
      budgetEur: 50_000,
      tierCounts: { under10k: 0, from10kTo20k: 2, from20kTo50k: 1, over50k: 0 },
    });
    const second = store.upsertTarget({
      cm: "Miro",
      market: "US",
      month: "2026-08",
      budgetEur: 60_000,
      tierCounts: { under10k: 1, from10kTo20k: 2, from20kTo50k: 1, over50k: 0 },
    });

    expect(second.id).toBe(first.id);
    expect(store.listTargets()).toHaveLength(1);
    expect(store.listTargets()[0]).toMatchObject({ budgetEur: 60_000, tierCounts: { under10k: 1 } });
  });

  it("stores monthly revenue targets keyed by month", () => {
    store.upsertRevenueTarget({ month: "2026-08", totalEur: 560_000 });
    store.upsertRevenueTarget({ month: "2026-08", totalEur: 600_000 });

    expect(store.listRevenueTargets()).toEqual([{ month: "2026-08", totalEur: 600_000 }]);
  });

  it("returns null for an unsaved dashboard layout and round-trips a saved one", () => {
    expect(store.getDashboardLayout("team")).toBeNull();

    const layout = { lg: [{ i: "returns", x: 0, y: 0, w: 4, h: 11 }] };
    store.saveDashboardLayout("team", layout);
    expect(store.getDashboardLayout("team")).toEqual(layout);

    const next = { lg: [{ i: "returns", x: 4, y: 0, w: 6, h: 12 }] };
    store.saveDashboardLayout("team", next);
    expect(store.getDashboardLayout("team")).toEqual(next);
    expect(store.getDashboardLayout("other")).toBeNull();
  });

  it("upserts, lists, and deletes invoice snapshots by channel key", () => {
    expect(store.listInvoices()).toEqual([]);

    const record = {
      campaignName: "ASMRFIXY_YT_R1",
      channelName: "ASMR Fixy",
      invoicedAt: "2026-08-03T10:00:00.000Z",
      maturedAtInvoice: false,
      cost: 10_000,
      returnPct: 90,
      tier: "base",
      amount: 12_000,
    };
    const saved = store.upsertInvoice(record);
    expect(saved).toEqual(record);
    expect(store.listInvoices()).toEqual([record]);

    // Upsert updates in place (still one row) when it matures higher.
    const matured = { ...record, maturedAtInvoice: false, returnPct: 150, tier: "mid", amount: 14_000 };
    store.upsertInvoice(matured);
    expect(store.listInvoices()).toEqual([matured]);

    expect(store.deleteInvoice("ASMRFIXY_YT_R1")).toBe(true);
    expect(store.deleteInvoice("ASMRFIXY_YT_R1")).toBe(false);
    expect(store.listInvoices()).toEqual([]);
  });
});

describe("seedTargets", () => {
  it("maps sheet month names to ISO months and reports counts", () => {
    const store = new BookingsStore(":memory:");
    const summary = seedTargets(
      store,
      {
        targets: [
          {
            cm: "Lucija P",
            market: "PL",
            month: "July",
            budgetEur: 60_000,
            tierCounts: { under10k: 0, from10kTo20k: 2, from20kTo50k: 1, over50k: 0 },
          },
        ],
        revenueTargets: [{ month: "September", totalEur: 740_000 }],
      },
      2026,
    );

    expect(summary).toEqual({ targets: 1, revenueTargets: 1 });
    expect(store.listTargets()[0].month).toBe("2026-07");
    expect(store.listRevenueTargets()).toEqual([{ month: "2026-09", totalEur: 740_000 }]);
    store.close();
  });

  it("rejects unknown month names", () => {
    expect(() => monthNameToIso("Augustus", 2026)).toThrow(/Unknown month name/);
  });
});

describe("bookingInputSchema", () => {
  it("applies defaults and normalizes empty strings to null", () => {
    const parsed = bookingInputSchema.parse({ channelName: "  ASMR Fixy  ", channelUrl: "" });
    expect(parsed).toMatchObject({
      channelName: "ASMR Fixy",
      channelUrl: null,
      status: "pipeline",
      currency: "EUR",
      contractSigned: false,
    });
  });

  it("rejects bad months, statuses, and negative budgets", () => {
    expect(bookingInputSchema.safeParse({ channelName: "X", month: "August" }).success).toBe(false);
    expect(bookingInputSchema.safeParse({ channelName: "X", status: "ghosted" }).success).toBe(false);
    expect(bookingInputSchema.safeParse({ channelName: "X", intBudget: -5 }).success).toBe(false);
    expect(bookingInputSchema.safeParse({ channelName: "" }).success).toBe(false);
  });

  it("allows sparse patches", () => {
    expect(bookingPatchSchema.parse({ status: "longterm" })).toEqual({ status: "longterm" });
  });
});
