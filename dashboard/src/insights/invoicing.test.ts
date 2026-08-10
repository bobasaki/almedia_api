import { describe, expect, it } from "vitest";

import {
  blendedReturn,
  buildInvoiceBatches,
  buildInvoiceMonths,
  invoiceAmount,
  invoiceTier,
} from "./invoicing";
import type { Deal } from "./types";

/** Minimal deal factory — only the fields invoicing reads. */
function deal(overrides: Partial<Deal> & { channelKey: string }): Deal {
  return {
    channelName: overrides.channelKey,
    campaignName: overrides.channelKey,
    videoUrl: null,
    platform: null,
    publishedAt: null,
    cost: 10_000,
    expectedCpm: null,
    viewCount: null,
    returnPct: 50,
    signupsPct: null,
    d7Purchases: null,
    roasReturn: null,
    appuD14: null,
    expectedViews: null,
    deliveryPct: null,
    cm: null,
    country: null,
    vertical: null,
    verticals: [],
    category: null,
    hasEnrichment: false,
    creatorFollowers: null,
    creatorTypicalViews: null,
    creatorEngagementRatePct: null,
    creatorContentFormat: null,
    creatorBrandFit: null,
    creatorSafetyRisk: null,
    status: null,
    intBudget: null,
    extBudget: null,
    month: null,
    sizeTier: null,
    hasCampaign: true,
    hasBooking: false,
    ...overrides,
  };
}

const NOW = new Date("2026-08-20T00:00:00Z");
const MATURED = "2026-08-01T00:00:00Z"; // 19 days before NOW → matured
const FRESH = "2026-08-18T00:00:00Z"; // 2 days before NOW → maturing

describe("invoiceTier / invoiceAmount", () => {
  it("maps the return % to the right commission tier on inclusive lower bounds", () => {
    expect(invoiceTier(50).id).toBe("c20");
    expect(invoiceTier(99).id).toBe("c20");
    expect(invoiceTier(100).id).toBe("c25"); // threshold is inclusive
    expect(invoiceTier(109).id).toBe("c25");
    expect(invoiceTier(110).id).toBe("c30");
    expect(invoiceTier(129).id).toBe("c30");
    expect(invoiceTier(130).id).toBe("c40");
    expect(invoiceTier(149).id).toBe("c40");
    expect(invoiceTier(150).id).toBe("c50");
    expect(invoiceTier(179).id).toBe("c50");
    expect(invoiceTier(180).id).toBe("c60");
    expect(invoiceTier(249).id).toBe("c60");
    expect(invoiceTier(250).id).toBe("c80");
    expect(invoiceTier(329).id).toBe("c80");
    expect(invoiceTier(330).id).toBe("c100");
    expect(invoiceTier(900).id).toBe("c100");
    expect(invoiceTier(null).id).toBe("c20"); // missing return → base
  });

  it("gives the full client charge: INT price (cost / 1.2) marked up by the tier commission", () => {
    // cost 12,000 → INT 10,000
    expect(invoiceAmount(12_000, 50)).toBe(12_000); // base +20% → INT × 1.2 = cost
    expect(invoiceAmount(12_000, 100)).toBe(12_500); // +25%
    expect(invoiceAmount(12_000, 150)).toBe(15_000); // +50%
    expect(invoiceAmount(12_000, 330)).toBe(20_000); // +100%
    expect(invoiceAmount(12_000, 900)).toBe(20_000); // +100% (open-ended top)
    expect(invoiceAmount(null, 50)).toBeNull();
  });
});

describe("blendedReturn", () => {
  it("blends media spend against INT (the return multiple x that picks the tier)", () => {
    // Σ INT 10,000. Σ media spend 20,000 → 200%.
    const value = blendedReturn([
      { int: 5_000, mediaSpend: 15_000 },
      { int: 5_000, mediaSpend: 5_000 },
    ]);
    expect(value).toBeCloseTo(200, 6);
  });

  it("uses INT, not cost, as the denominator (the PDF's June example)", () => {
    // INT 178,622.50, media spend 185,766.23 → x = 1.04 = 104% (86.7% against cost).
    const value = blendedReturn([{ int: 178_622.5, mediaSpend: 185_766.23 }]);
    expect(value).toBeCloseTo(104, 1);
    expect(invoiceTier(value!).id).toBe("c25"); // 100 ≤ 104 < 110 → +25%
  });

  it("counts INT even with no media spend yet, and is null with no INT", () => {
    expect(blendedReturn([{ int: 5_000, mediaSpend: null }])).toBe(0); // 0 / 5,000
    expect(blendedReturn([])).toBeNull();
  });
});

describe("buildInvoiceBatches", () => {
  it("bills the whole month at the tier its blended media-spend return earns", () => {
    // INT = cost ÷ 1.2 → 5k each, Σ INT 10,000. Media spend = returnPct × cost ÷ 100 → 18,000
    // and 6,000. Blended on INT: 24,000 / 10,000 = 240% → c60 (180 ≤ 240 < 250).
    const deals = [
      deal({ channelKey: "A", publishedAt: MATURED, cost: 6_000, returnPct: 300 }),
      deal({ channelKey: "B", publishedAt: MATURED, cost: 6_000, returnPct: 100 }),
    ];
    const batches = buildInvoiceBatches(deals, new Set(), NOW);

    expect(batches).toHaveLength(1);
    const batch = batches[0];
    expect(batch.month).toBe("2026-08");
    expect(batch.blendedReturn).toBeCloseTo(240, 6);
    expect(batch.tier.id).toBe("c60");
    expect(batch.intTotal).toBe(10_000); // Σ INT = Σ cost ÷ 1.2
    expect(batch.baseTotal).toBe(12_000); // Σ Almedia cost billed up front
    expect(batch.performanceFee).toBe(4_000); // ΣINT × 1.6 − Σcost = 16,000 − 12,000
    expect(batch.amount).toBe(16_000); // 12,000 cost + 4,000 fee = ΣINT × 1.6
    expect(batch.memberCount).toBe(2);
    expect(batch.includedCount).toBe(2);
    expect(batch.maturingCount).toBe(0);
    expect(batch.feeSettled).toBe(true); // whole cohort matured

    // Each member at the batch tier: INT 5k × 1.6 − cost 6k = 2,000 fee; up front = cost 6,000.
    const byName = Object.fromEntries(batch.members.map((m) => [m.campaignName, m]));
    expect(byName.A.baseAmount).toBe(6_000);
    expect(byName.A.int).toBe(5_000);
    expect(byName.A.mediaSpend).toBe(18_000);
    expect(byName.A.performanceFee).toBe(2_000);
    expect(byName.B.performanceFee).toBe(2_000);
  });

  it("bills cost up front for every campaign but fees only the matured cohort", () => {
    const deals = [
      deal({ channelKey: "DONE", publishedAt: MATURED, cost: 6_000, returnPct: 300 }),
      deal({ channelKey: "YOUNG", publishedAt: FRESH, cost: 9_000, returnPct: 300 }),
    ];
    const batch = buildInvoiceBatches(deals, new Set(), NOW)[0];

    expect(batch.memberCount).toBe(2);
    expect(batch.includedCount).toBe(1); // only the matured one drives the fee
    expect(batch.maturingCount).toBe(1);
    expect(batch.feeSettled).toBe(false);
    expect(batch.baseTotal).toBe(15_000); // 6,000 + 9,000 — every campaign's cost up front
    // Fee on the matured cohort only. Return on INT: 18,000 / 5,000 = 360% → c100 (1.0);
    // INT 5,000 × 2.0 − 6,000 = 4,000. (Against cost it is 300%, but INT is the denominator.)
    expect(batch.blendedReturn).toBeCloseTo(360, 6);
    expect(batch.tier.id).toBe("c100");
    expect(batch.performanceFee).toBe(4_000);
    expect(batch.amount).toBe(19_000); // 15,000 cost + 4,000 fee
  });

  it("marks cost invoiced through the cutoff month", () => {
    const deals = [
      deal({ channelKey: "OLD", publishedAt: "2026-05-10T00:00:00Z", cost: 6_000, returnPct: 50 }),
      deal({ channelKey: "NEW", publishedAt: "2026-07-10T00:00:00Z", cost: 6_000, returnPct: 50 }),
    ];
    const byMonth = Object.fromEntries(
      buildInvoiceBatches(deals, new Set(), NOW).map((b) => [b.month, b]),
    );
    expect(byMonth["2026-05"].costInvoiced).toBe(true); // on or before 2026-06
    expect(byMonth["2026-07"].costInvoiced).toBe(false); // after the cutoff
  });

  it("floors the fee at zero when the blend sits at or below the base tier", () => {
    // cost 6k → INT 5k. Media spend 2,880. On INT: 2,880 / 5,000 = 57.6% → c20 (base, < 100%).
    // INT × 1.2 = cost, so fee 0.
    const deals = [deal({ channelKey: "LOW", publishedAt: MATURED, cost: 6_000, returnPct: 48 })];
    const batch = buildInvoiceBatches(deals, new Set(), NOW)[0];

    expect(batch.blendedReturn).toBeCloseTo(57.6, 6);
    expect(batch.tier.id).toBe("c20");
    expect(batch.baseTotal).toBe(6_000);
    expect(batch.performanceFee).toBe(0);
    expect(batch.amount).toBe(6_000); // just the cost already invoiced
    expect(batch.members[0].performanceFee).toBe(0);
  });

  it("re-blends and can jump the batch tier when a maturing member is opted in", () => {
    const deals = [
      deal({ channelKey: "MAT", publishedAt: MATURED, cost: 6_000, returnPct: 48 }),
      deal({ channelKey: "FRESH", publishedAt: FRESH, cost: 6_000, returnPct: 480 }),
    ];

    // Without the maturing member: only the 48% flop counts → c20, fee floored to 0.
    const before = buildInvoiceBatches(deals, new Set(), NOW)[0];
    expect(before.tier.id).toBe("c20");
    expect(before.performanceFee).toBe(0);
    expect(before.includedCount).toBe(1);
    expect(before.maturingCount).toBe(1);
    expect(before.baseTotal).toBe(12_000); // both costs billed up front, matured or not

    // Opt the maturing giant in: media spend 2,880 + 28,800 = 31,680 / 10,000 INT = 316.8% → c80.
    const after = buildInvoiceBatches(deals, new Set(["FRESH"]), NOW)[0];
    expect(after.tier.id).toBe("c80");
    expect(after.baseTotal).toBe(12_000);
    expect(after.performanceFee).toBe(6_000); // 10,000 × 1.8 − 12,000
    expect(after.includedCount).toBe(2);
  });

  it("excludes campaigns with no publish date or no cost", () => {
    const deals = [
      deal({ channelKey: "NOCOST", publishedAt: MATURED, cost: null, returnPct: 100 }),
      deal({ channelKey: "NODATE", publishedAt: null, cost: 12_000, returnPct: 100 }),
      deal({ channelKey: "OK", publishedAt: MATURED, cost: 12_000, returnPct: 100 }),
    ];
    const batches = buildInvoiceBatches(deals, new Set(), NOW);
    expect(batches).toHaveLength(1);
    expect(batches[0].members).toHaveLength(1);
    expect(batches[0].members[0].campaignName).toBe("OK");
  });

  it("orders batches most-recent publish month first", () => {
    const deals = [
      deal({ channelKey: "OLD", publishedAt: "2026-05-02T00:00:00Z", cost: 6_000, returnPct: 50 }),
      deal({ channelKey: "NEW", publishedAt: "2026-07-02T00:00:00Z", cost: 6_000, returnPct: 50 }),
    ];
    const batches = buildInvoiceBatches(deals, new Set(), NOW);
    expect(batches.map((b) => b.month)).toEqual(["2026-07", "2026-05"]);
    expect(batches[0].feeMonth).toBe("2026-08"); // fee bills the month after publish
  });
});

describe("buildInvoiceMonths", () => {
  it("puts this month's cost and last month's fee on the same calendar invoice", () => {
    // June batch: two matured campaigns → c60, cost 12,000, fee 4,000 (lands July).
    // July batch: two matured campaigns → c60, cost 12,000, fee 4,000 (lands August).
    const deals = [
      deal({ channelKey: "JUN-A", publishedAt: "2026-06-01T00:00:00Z", cost: 6_000, returnPct: 300 }),
      deal({ channelKey: "JUN-B", publishedAt: "2026-06-01T00:00:00Z", cost: 6_000, returnPct: 100 }),
      deal({ channelKey: "JUL-A", publishedAt: "2026-07-01T00:00:00Z", cost: 6_000, returnPct: 300 }),
      deal({ channelKey: "JUL-B", publishedAt: "2026-07-01T00:00:00Z", cost: 6_000, returnPct: 100 }),
    ];
    const batches = buildInvoiceBatches(deals, new Set(), NOW);
    const months = Object.fromEntries(buildInvoiceMonths(batches).map((m) => [m.month, m]));

    // The July invoice = July's new cost + June's carried fee.
    expect(months["2026-07"].newCost).toBe(12_000);
    expect(months["2026-07"].carriedFee).toBe(4_000); // June's fee, now settled
    expect(months["2026-07"].feeBatch?.month).toBe("2026-06");
    expect(months["2026-07"].feeSettled).toBe(true);
    expect(months["2026-07"].total).toBe(16_000);

    // June's own invoice carries no prior fee here (no May batch).
    expect(months["2026-06"].newCost).toBe(12_000);
    expect(months["2026-06"].carriedFee).toBe(0);
    expect(months["2026-06"].total).toBe(12_000);

    // A trailing fee-only month appears for July's fee, with no new cost.
    expect(months["2026-08"].newCost).toBe(0);
    expect(months["2026-08"].costBatch).toBeNull();
    expect(months["2026-08"].carriedFee).toBe(4_000);
    expect(months["2026-08"].total).toBe(4_000);
  });

  it("keeps a still-maturing fee out of the billable total as pending", () => {
    // The August batch has a matured + a fresh member, so its fee is not settled.
    // That fee lands on the September invoice, where it must sit as pending.
    const deals = [
      deal({ channelKey: "DONE", publishedAt: MATURED, cost: 6_000, returnPct: 300 }),
      deal({ channelKey: "YOUNG", publishedAt: FRESH, cost: 9_000, returnPct: 300 }),
    ];
    const batches = buildInvoiceBatches(deals, new Set(), NOW);
    expect(batches[0].month).toBe("2026-08");
    expect(batches[0].feeSettled).toBe(false);

    const months = Object.fromEntries(buildInvoiceMonths(batches).map((m) => [m.month, m]));
    const september = months["2026-09"]; // August's fee lands here
    expect(september.newCost).toBe(0);
    expect(september.feeSettled).toBe(false);
    expect(september.carriedFee).toBe(0); // not billable while maturing
    expect(september.feePending).toBeGreaterThan(0);
    expect(september.total).toBe(0); // pending fee excluded from the total
  });

  it("carries no fee for a base-tier month", () => {
    const deals = [
      deal({ channelKey: "LOW", publishedAt: "2026-06-01T00:00:00Z", cost: 6_000, returnPct: 48 }),
    ];
    const batches = buildInvoiceBatches(deals, new Set(), NOW);
    const months = Object.fromEntries(buildInvoiceMonths(batches).map((m) => [m.month, m]));
    // July would carry June's fee, but the base tier floors it to zero.
    expect(months["2026-07"].carriedFee).toBe(0);
    expect(months["2026-07"].feePending).toBe(0);
    expect(months["2026-07"].total).toBe(0);
  });
});
