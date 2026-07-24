import { getMaturityInfo, type MaturityStatus } from "../analytics";
import type { InvoiceRecord } from "../../../src/bookings/types";
import { roundOf } from "./charts";
import type { Deal } from "./types";

/**
 * Client billing model. The Almedia `cost` field already embeds our base 20%
 * commission, so the internal (INT) price is `cost / 1.2`. We invoice the
 * company off that INT price plus a commission that steps up with the channel's
 * return — `invoice = (cost / 1.2) × (1 + commission)`. The commission IS the
 * markup on INT: at the base tier `(cost / 1.2) × 1.2 = cost`, so sub-80%
 * channels bill at exactly the Almedia cost; a 150% return bills INT × 2.0.
 * The "blended return %" from the rate card is the channel's own returnPct,
 * used as the inclusive lower bound that unlocks each tier:
 *
 *   return < 80%       → 20%   (the fixed base — everything 0–80%)
 *   return ≥ 80%       → 25%
 *   return ≥ 85%       → 30%
 *   return ≥ 93%       → 40%
 *   return ≥ 100%      → 50%
 *   return ≥ 113%      → 60%
 *   return ≥ 139%      → 80%
 *   return ≥ 150%      → 100%
 *
 * Matured channels (14+ days) can be invoiced at their final tier. A channel
 * that hasn't matured can be invoiced early; we snapshot the amount at that
 * moment and, once it matures, charge the difference if it climbed a tier.
 */

export type InvoiceTierId = "c20" | "c25" | "c30" | "c40" | "c50" | "c60" | "c80" | "c100";

export interface InvoiceTier {
  id: InvoiceTierId;
  label: string;
  /** Commission fraction added on top of cost, e.g. 0.25 → cost × 1.25. */
  markup: number;
  /** Exclusive upper bound of returnPct for this tier (Infinity for the top). */
  maxReturn: number;
}

export const INVOICE_TIERS: readonly InvoiceTier[] = [
  { id: "c20", label: "< 80%", markup: 0.2, maxReturn: 80 },
  { id: "c25", label: "80–84%", markup: 0.25, maxReturn: 85 },
  { id: "c30", label: "85–92%", markup: 0.3, maxReturn: 93 },
  { id: "c40", label: "93–99%", markup: 0.4, maxReturn: 100 },
  { id: "c50", label: "100–112%", markup: 0.5, maxReturn: 113 },
  { id: "c60", label: "113–138%", markup: 0.6, maxReturn: 139 },
  { id: "c80", label: "139–149%", markup: 0.8, maxReturn: 150 },
  { id: "c100", label: "≥ 150%", markup: 1, maxReturn: Infinity },
];

/** The tier a return falls into. A missing return is treated as the base tier. */
export function invoiceTier(returnPct: number | null): InvoiceTier {
  const value = returnPct ?? 0;
  return INVOICE_TIERS.find((tier) => value < tier.maxReturn) ?? INVOICE_TIERS[INVOICE_TIERS.length - 1];
}

/** The base 20% commission already baked into the Almedia cost field. */
export const BASE_MARKUP = 0.2;

/** The internal price: Almedia cost with the embedded base commission stripped. */
export function intPrice(cost: number): number {
  return cost / (1 + BASE_MARKUP);
}

/** The amount to invoice: INT price (cost / 1.2) plus the return-based commission markup. */
export function invoiceAmount(cost: number | null, returnPct: number | null): number | null {
  if (cost === null || !Number.isFinite(cost)) return null;
  return intPrice(cost) * (1 + invoiceTier(returnPct).markup);
}

function tierIndex(id: string): number {
  const index = INVOICE_TIERS.findIndex((tier) => tier.id === id);
  return index === -1 ? 0 : index;
}

/**
 * A readable creator label. Booked channels carry their real name; campaign-only
 * deals fall back to the raw Almedia campaign name, so strip its `_PLATFORM_R#`
 * suffix (the round shows as its own badge). Casing/spacing is preserved.
 */
function displayName(channelName: string): string {
  return channelName.replace(/_[A-Za-z0-9]+_R\d+[A-Za-z0-9]*$/i, "").trim() || channelName;
}

/** A campaign that can be invoiced, with its live tier and amount. */
export interface InvoiceLine {
  /** Unique Almedia campaign name — the invoice identity. */
  campaignName: string;
  /** Human-facing channel/creator name. */
  channelName: string;
  /** Round number parsed from the campaign name (e.g. R2), when present. */
  round: number | null;
  cost: number;
  returnPct: number | null;
  tier: InvoiceTier;
  amount: number;
  status: MaturityStatus;
  daysRemaining: number | null;
  invoiced: boolean;
}

/** A campaign invoiced before maturity that has since matured higher. */
export interface TopUpLine {
  campaignName: string;
  channelName: string;
  round: number | null;
  invoicedAmount: number;
  invoicedTier: InvoiceTierId;
  maturedAmount: number;
  maturedTier: InvoiceTierId;
  /** Extra to invoice now: matured amount − amount already invoiced (never negative). */
  topUp: number;
  tierJumped: boolean;
}

export interface TierSummary {
  tier: InvoiceTier;
  count: number;
  /** Sum of Almedia cost in this tier. */
  base: number;
  /** Sum of invoice amounts in this tier. */
  amount: number;
}

export interface InvoiceView {
  /** All matured channels grouped into tiers. */
  tiers: TierSummary[];
  /** Matured channels, richest first, each flagged if already invoiced. */
  matured: InvoiceLine[];
  /** Total invoice value of all matured channels. */
  maturedTotal: number;
  /** Value of matured channels not yet invoiced. */
  outstanding: number;
  /** Non-matured channels — early-invoice candidates, each flagged if invoiced. */
  maturing: InvoiceLine[];
  /** Early-invoiced channels that matured into a bigger bill. */
  topUps: TopUpLine[];
  topUpTotal: number;
}

/** A deal can be invoiced only once we have a cost to mark up and a campaign key. */
function isEligible(deal: Deal): deal is Deal & { cost: number; campaignName: string } {
  return (
    deal.campaignName !== null &&
    deal.cost !== null &&
    Number.isFinite(deal.cost) &&
    deal.cost > 0
  );
}

function toLine(
  deal: Deal & { cost: number; campaignName: string },
  invoiced: boolean,
  now: Date,
): InvoiceLine {
  const maturity = getMaturityInfo(deal.publishedAt, now);
  return {
    campaignName: deal.campaignName,
    channelName: displayName(deal.channelName),
    round: roundOf(deal.campaignName),
    cost: deal.cost,
    returnPct: deal.returnPct,
    tier: invoiceTier(deal.returnPct),
    amount: invoiceAmount(deal.cost, deal.returnPct) ?? 0,
    status: maturity.status,
    daysRemaining: maturity.daysRemaining,
    invoiced,
  };
}

/**
 * Categorise the current deals against the saved invoice records into the
 * matured tier breakdown, the maturing early-invoice list, and top-ups due.
 * Keyed per campaign, so a creator's separate rounds bill independently.
 */
export function buildInvoiceView(
  deals: Deal[],
  records: InvoiceRecord[],
  now: Date = new Date(),
): InvoiceView {
  const recordByKey = new Map(records.map((record) => [record.campaignName, record]));
  const eligible = deals.filter(isEligible);

  const matured: InvoiceLine[] = [];
  const maturing: InvoiceLine[] = [];
  const topUps: TopUpLine[] = [];

  for (const deal of eligible) {
    const record = recordByKey.get(deal.campaignName);
    const line = toLine(deal, record !== undefined, now);

    if (line.status === "matured") {
      matured.push(line);
      // Invoiced before maturity, then matured: charge the difference if it grew.
      if (record && !record.maturedAtInvoice) {
        const maturedTier = invoiceTier(deal.returnPct);
        const topUp = Math.max(0, line.amount - record.amount);
        const tierJumped = tierIndex(maturedTier.id) > tierIndex(record.tier);
        if (topUp > 0 || tierJumped) {
          topUps.push({
            campaignName: deal.campaignName,
            channelName: line.channelName,
            round: line.round,
            invoicedAmount: record.amount,
            invoicedTier: (record.tier as InvoiceTierId) ?? "base",
            maturedAmount: line.amount,
            maturedTier: maturedTier.id,
            topUp,
            tierJumped,
          });
        }
      }
    } else {
      maturing.push(line);
    }
  }

  matured.sort((a, b) => b.amount - a.amount);
  maturing.sort((a, b) => b.amount - a.amount);
  topUps.sort((a, b) => b.topUp - a.topUp);

  const tiers: TierSummary[] = INVOICE_TIERS.map((tier) => {
    const rows = matured.filter((line) => line.tier.id === tier.id);
    return {
      tier,
      count: rows.length,
      base: rows.reduce((sum, line) => sum + line.cost, 0),
      amount: rows.reduce((sum, line) => sum + line.amount, 0),
    };
  });

  return {
    tiers,
    matured,
    maturedTotal: matured.reduce((sum, line) => sum + line.amount, 0),
    outstanding: matured.filter((line) => !line.invoiced).reduce((sum, line) => sum + line.amount, 0),
    maturing,
    topUps,
    topUpTotal: topUps.reduce((sum, line) => sum + line.topUp, 0),
  };
}
