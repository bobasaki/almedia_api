import { describe, expect, it } from "vitest";

import type { InvoiceRecord } from "../../../src/bookings/types";
import { buildInvoiceView, invoiceAmount, invoiceTier } from "./invoicing";
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
  it("maps return to the right commission tier on inclusive lower bounds", () => {
    expect(invoiceTier(50).id).toBe("c20");
    expect(invoiceTier(79).id).toBe("c20");
    expect(invoiceTier(80).id).toBe("c25"); // threshold is inclusive
    expect(invoiceTier(84).id).toBe("c25");
    expect(invoiceTier(85).id).toBe("c30");
    expect(invoiceTier(92).id).toBe("c30");
    expect(invoiceTier(93).id).toBe("c40");
    expect(invoiceTier(100).id).toBe("c50");
    expect(invoiceTier(112).id).toBe("c50");
    expect(invoiceTier(113).id).toBe("c60");
    expect(invoiceTier(139).id).toBe("c80");
    expect(invoiceTier(150).id).toBe("c100");
    expect(invoiceTier(900).id).toBe("c100");
    expect(invoiceTier(null).id).toBe("c20"); // missing return → base
  });

  it("invoices INT price (cost / 1.2) marked up by the tier commission", () => {
    // cost 12,000 → INT 10,000
    expect(invoiceAmount(12_000, 50)).toBe(12_000); // base +20% → INT × 1.2 = cost
    expect(invoiceAmount(12_000, 80)).toBe(12_500); // +25%
    expect(invoiceAmount(12_000, 100)).toBe(15_000); // +50%
    expect(invoiceAmount(12_000, 150)).toBe(20_000); // +100%
    expect(invoiceAmount(12_000, 300)).toBe(20_000); // +100% (open-ended top)
    expect(invoiceAmount(null, 50)).toBeNull();
  });
});

describe("buildInvoiceView", () => {
  it("groups matured channels into tiers and excludes cost-less deals", () => {
    // costs divisible by 1.2 → INT 10k / 20k / 5k
    const deals = [
      deal({ channelKey: "A", publishedAt: MATURED, cost: 12_000, returnPct: 90 }), // c30 → INT × 1.3 = 13,000
      deal({ channelKey: "B", publishedAt: MATURED, cost: 24_000, returnPct: 120 }), // c60 → INT × 1.6 = 32,000
      deal({ channelKey: "C", publishedAt: MATURED, cost: 6_000, returnPct: 400 }), // c100 → INT × 2.0 = 10,000
      deal({ channelKey: "D", publishedAt: MATURED, cost: null }), // no cost → excluded
    ];
    const view = buildInvoiceView(deals, [], NOW);

    expect(view.matured).toHaveLength(3);
    const countById = Object.fromEntries(view.tiers.map((t) => [t.tier.id, t.count]));
    expect(countById.c30).toBe(1);
    expect(countById.c60).toBe(1);
    expect(countById.c100).toBe(1);
    // 13,000 + 32,000 + 10,000
    expect(view.maturedTotal).toBe(55_000);
    expect(view.outstanding).toBe(55_000); // nothing invoiced yet
    expect(view.maturing).toHaveLength(0);
  });

  it("separates maturing channels and marks invoiced ones", () => {
    const deals = [deal({ channelKey: "M", publishedAt: FRESH, cost: 12_000, returnPct: 50 })];
    const record: InvoiceRecord = {
      campaignName: "M",
      channelName: "M",
      invoicedAt: "2026-08-18T12:00:00Z",
      maturedAtInvoice: false,
      cost: 12_000,
      returnPct: 50,
      tier: "c20",
      amount: 12_000, // INT 10k × 1.2 = cost
    };
    const view = buildInvoiceView(deals, [record], NOW);

    expect(view.maturing).toHaveLength(1);
    expect(view.maturing[0].invoiced).toBe(true);
    expect(view.maturing[0].daysRemaining).toBeGreaterThan(0);
  });

  it("computes a top-up when an early-invoiced channel matures into a higher tier", () => {
    // cost 12k → INT 10k. Invoiced early at 90% return (c30, €13k). Now matured at 250% (c100, €20k).
    const deals = [deal({ channelKey: "J", publishedAt: MATURED, cost: 12_000, returnPct: 250 })];
    const record: InvoiceRecord = {
      campaignName: "J",
      channelName: "J",
      invoicedAt: "2026-08-05T00:00:00Z",
      maturedAtInvoice: false,
      cost: 12_000,
      returnPct: 90,
      tier: "c30",
      amount: 13_000,
    };
    const view = buildInvoiceView(deals, [record], NOW);

    expect(view.topUps).toHaveLength(1);
    expect(view.topUps[0]).toMatchObject({
      invoicedTier: "c30",
      maturedTier: "c100",
      topUp: 7_000, // 20,000 − 13,000
      tierJumped: true,
    });
    expect(view.topUpTotal).toBe(7_000);
  });

  it("does not top up a channel that was already matured when invoiced", () => {
    const deals = [deal({ channelKey: "K", publishedAt: MATURED, cost: 12_000, returnPct: 250 })];
    const record: InvoiceRecord = {
      campaignName: "K",
      channelName: "K",
      invoicedAt: "2026-08-19T00:00:00Z",
      maturedAtInvoice: true,
      cost: 12_000,
      returnPct: 250,
      tier: "c100",
      amount: 20_000,
    };
    const view = buildInvoiceView(deals, [record], NOW);

    expect(view.topUps).toHaveLength(0);
    expect(view.matured[0].invoiced).toBe(true);
    expect(view.outstanding).toBe(0);
  });
});
