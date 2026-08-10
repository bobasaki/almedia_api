import { getMaturityInfo, type MaturityStatus } from "../analytics";
import { monthLabel } from "../labels";
import { roundOf } from "./charts";
import type { Deal } from "./types";

/**
 * Client billing model (two calendar months, in USD — the Almedia `cost` field
 * is dollars). Every campaign is invoiced twice:
 *
 *   1. Publish month  → the raw Almedia `cost` for each campaign.
 *   2. Next month     → a performance fee on the whole month's batch.
 *
 * The Almedia `cost` embeds our base 20%, so the internal price is `INT =
 * cost / 1.2`. The month's blended return picks one commission tier, and the
 * client's total charge for that batch is `Σ INT × (1 + commission)`. Since the
 * cost was already invoiced up front, the performance fee is the remainder:
 *
 *   performance fee = Σ INT × (1 + commission) − Σ cost
 *
 * At the base tier (commission 20%) `INT × 1.2 = cost`, so the fee is exactly
 * zero and only the up-front cost is billed. The commission steps up with the
 * batch's blended return on internal cost — `Σ media spend ÷ Σ INT`, the PDF's
 * return multiple `x` (shown here ×100). The denominator is INT, NOT cost: on a
 * batch that returns 86.7% against cost, INT is 1.2× smaller, so `x` is 104% and
 * the fee is real. Tiers are inclusive lower bounds from the rate card (the "min
 * return" column is a decimal, shown here ×100):
 *
 *   return < 100%      → 20%   (the fixed base — the fee is zero here)
 *   return ≥ 100%      → 25%
 *   return ≥ 110%      → 30%
 *   return ≥ 130%      → 40%
 *   return ≥ 150%      → 50%
 *   return ≥ 180%      → 60%
 *   return ≥ 250%      → 80%
 *   return ≥ 330%      → 100%
 *
 * Matured channels (14+ days) can be invoiced at their final tier. A channel
 * that hasn't matured can be invoiced early; we snapshot the amount at that
 * moment and, once it matures, charge the difference if it climbed a tier.
 */

export type InvoiceTierId = "c20" | "c25" | "c30" | "c40" | "c50" | "c60" | "c80" | "c100";

export interface InvoiceTier {
  id: InvoiceTierId;
  label: string;
  /** Commission fraction on top of INT, e.g. 0.25 → client charge INT × 1.25. */
  markup: number;
  /** Exclusive upper bound of the return % for this tier (Infinity for the top). */
  maxReturn: number;
}

export const INVOICE_TIERS: readonly InvoiceTier[] = [
  { id: "c20", label: "< 100%", markup: 0.2, maxReturn: 100 },
  { id: "c25", label: "100–109%", markup: 0.25, maxReturn: 110 },
  { id: "c30", label: "110–129%", markup: 0.3, maxReturn: 130 },
  { id: "c40", label: "130–149%", markup: 0.4, maxReturn: 150 },
  { id: "c50", label: "150–179%", markup: 0.5, maxReturn: 180 },
  { id: "c60", label: "180–249%", markup: 0.6, maxReturn: 250 },
  { id: "c80", label: "250–329%", markup: 0.8, maxReturn: 330 },
  { id: "c100", label: "≥ 330%", markup: 1, maxReturn: Infinity },
];

/** The tier a return % falls into. A missing return is treated as the base tier. */
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

/**
 * The full client charge for a campaign across both months: INT price (cost /
 * 1.2) marked up by the return-based commission. The up-front cost invoice plus
 * the next month's performance fee add up to exactly this.
 */
export function invoiceAmount(cost: number | null, returnPct: number | null): number | null {
  if (cost === null || !Number.isFinite(cost)) return null;
  return intPrice(cost) * (1 + invoiceTier(returnPct).markup);
}

/**
 * A readable creator label. Booked channels carry their real name; campaign-only
 * deals fall back to the raw Almedia campaign name, so strip its `_PLATFORM_R#`
 * suffix (the round shows as its own badge). Casing/spacing is preserved.
 */
function displayName(channelName: string): string {
  return channelName.replace(/_[A-Za-z0-9]+_R\d+[A-Za-z0-9]*$/i, "").trim() || channelName;
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

/**
 * Media spend a campaign drove — the revenue people spent because of it:
 * `returnPct × cost / 100` (a campaign's return is exactly media spend ÷ cost).
 * Null until a return figure lands.
 */
export function mediaSpend(returnPct: number | null, cost: number | null): number | null {
  if (returnPct === null || !Number.isFinite(returnPct)) return null;
  if (cost === null || !Number.isFinite(cost)) return null;
  return (returnPct * cost) / 100;
}

/**
 * The batch's blended return on internal cost — Σ media spend ÷ Σ INT × 100,
 * the PDF's return multiple `x` (shown ×100). The denominator is INT, NOT cost:
 * the commission tier is selected on how the media spend compares to what we
 * actually pay creators, so a batch returning 86.7% against cost is 104% against
 * INT (INT is 1.2× smaller). A member with no measured return yet still counts
 * its INT in the denominator, dragging the blend down. This single number picks
 * one commission tier for the whole batch. Null when Σ INT is zero.
 */
export function blendedReturn(
  members: ReadonlyArray<{ int: number; mediaSpend: number | null }>,
): number | null {
  let spend = 0;
  let int = 0;
  for (const member of members) {
    int += member.int;
    spend += member.mediaSpend ?? 0;
  }
  return int > 0 ? (spend / int) * 100 : null;
}

/** A campaign inside a monthly batch, with whether it counts toward the bill. */
export interface BatchMember {
  /** Unique Almedia campaign name — the invoice identity. */
  campaignName: string;
  channelName: string;
  round: number | null;
  /** Almedia cost (USD) — invoiced up front in the publish month. */
  cost: number;
  /** INT price = Almedia cost ÷ 1.2 (USD). */
  int: number;
  /** Media spend the campaign drove = returnPct × cost ÷ 100 (USD); null until a return lands. */
  mediaSpend: number | null;
  /** This member's own return % against cost (media spend ÷ cost × 100); null with no return yet. */
  memberReturn: number | null;
  /**
   * The tier this member would earn on its own — per-channel reference. Selected
   * on the INT-based return (memberReturn × 1.2), the same denominator the batch
   * fee uses, so it can read higher than the against-cost `memberReturn` shown.
   */
  ownTier: InvoiceTier;
  status: MaturityStatus;
  daysRemaining: number | null;
  /** Publish month key this member belongs to, e.g. "2026-08". */
  month: string;
  /** Counted in the bill now — every matured member, plus any opted-in maturing one. */
  included: boolean;
  /** Stage 1: the Almedia cost billed up front in the publish month. */
  baseAmount: number;
  /**
   * Stage 2: this member's share of the batch performance fee, billed the next
   * calendar month — max(0, INT × (1 + batch commission) − cost). Zero for a
   * member not counted in the batch, or when the batch sits at the base tier.
   */
  performanceFee: number;
}

/**
 * One publish month's batch invoice. Stage 1 (cost up front) bills the raw
 * Almedia cost of EVERY campaign published that month, regardless of maturity —
 * the cost is known the moment it publishes. Stage 2 (performance fee) waits for
 * the return: only matured (or opted-in) members set the blended return, which
 * picks one commission tier, and the fee tops the matured cohort's already-billed
 * cost up to Σ INT × (1 + commission). Strong performers carry the flops.
 */
export interface InvoiceBatch {
  month: string;
  label: string;
  /** Every campaign published that month, largest cost first. */
  members: BatchMember[];
  /** Total campaigns published that month. */
  memberCount: number;
  /** Matured (or opted-in) channels — these set the blended return and the fee. */
  includedCount: number;
  /** Still-maturing channels available to opt into the fee blend. */
  maturingCount: number;
  /** Blended return on internal cost = Σ media spend ÷ Σ INT × 100 across the included members. */
  blendedReturn: number | null;
  /** The single commission tier the fee bills at. */
  tier: InvoiceTier;
  /** Σ INT price (cost ÷ 1.2) across the included members — the fee basis. */
  intTotal: number;
  /** Stage 1: Σ Almedia cost of EVERY member — billed up front in the publish month. */
  baseTotal: number;
  /**
   * Stage 2: the performance fee on the matured cohort — Σ INT × (1 + commission)
   * − Σ cost — billed the next calendar month. Floored at 0: at the base 20% tier
   * INT × 1.2 = cost, so nothing extra is billed.
   */
  performanceFee: number;
  /** Total client bill for the month = baseTotal + performanceFee. */
  amount: number;
  /** The calendar month the performance fee is billed, e.g. publish "2026-06" → "2026-07". */
  feeMonth: string;
  /** The up-front cost for this publish month has already been invoiced. */
  costInvoiced: boolean;
  /** The whole cohort has matured, so the performance fee is final (not still moving). */
  feeSettled: boolean;
}

/** The calendar month after a `YYYY-MM` key, e.g. "2026-12" → "2027-01". */
function nextMonth(month: string): string {
  const [year, index] = month.split("-").map(Number);
  const rolled = index >= 12 ? { year: year + 1, index: 1 } : { year, index: index + 1 };
  return `${rolled.year}-${String(rolled.index).padStart(2, "0")}`;
}

/** The calendar month before a `YYYY-MM` key, e.g. "2026-01" → "2025-12". */
export function prevMonth(month: string): string {
  const [year, index] = month.split("-").map(Number);
  const rolled = index <= 1 ? { year: year - 1, index: 12 } : { year, index: index - 1 };
  return `${rolled.year}-${String(rolled.index).padStart(2, "0")}`;
}

/** Round a dollar amount to cents; `|| 0` normalises a rounded −0 back to 0. */
function toCents(value: number): number {
  return Math.round(value * 100) / 100 || 0;
}

/**
 * The Freecash client was invoiced the up-front cost (Stage 1 only, no
 * performance fees) for every publish month through this key. Later months' cost
 * and every month's performance fee are still outstanding.
 */
export const COST_INVOICED_THROUGH = "2026-06";

/**
 * Group eligible campaigns by publish month into batch invoices. INT is derived
 * from the Almedia cost (cost ÷ 1.2), so every campaign with a cost is billable.
 * Stage 1 (cost up front) counts EVERY member — cost is billed the month a
 * campaign publishes, matured or not. Stage 2 (the fee) counts only matured
 * members, plus any maturing one whose name is in `includedCampaigns`; opting one
 * in re-blends the return and can move the fee tier. Most recent month first.
 */
export function buildInvoiceBatches(
  deals: Deal[],
  includedCampaigns: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): InvoiceBatch[] {
  const byMonth = new Map<string, BatchMember[]>();

  for (const deal of deals.filter(isEligible)) {
    if (!deal.publishedAt) continue;
    const month = deal.publishedAt.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const maturity = getMaturityInfo(deal.publishedAt, now);
    const int = intPrice(deal.cost);
    const spend = mediaSpend(deal.returnPct, deal.cost);
    const memberReturn = deal.returnPct;
    const member: BatchMember = {
      campaignName: deal.campaignName,
      channelName: displayName(deal.channelName),
      round: roundOf(deal.campaignName),
      cost: deal.cost,
      int,
      mediaSpend: spend,
      memberReturn,
      ownTier: invoiceTier(memberReturn === null ? null : memberReturn * (1 + BASE_MARKUP)),
      status: maturity.status,
      daysRemaining: maturity.daysRemaining,
      month,
      included: maturity.status === "matured" || includedCampaigns.has(deal.campaignName),
      baseAmount: deal.cost,
      performanceFee: 0,
    };
    byMonth.set(month, [...(byMonth.get(month) ?? []), member]);
  }

  // A member's performance fee: its full client charge (INT × (1 + commission))
  // minus the cost already invoiced up front, floored at zero.
  const memberFee = (int: number, cost: number, markup: number): number =>
    toCents(Math.max(0, int * (1 + markup) - cost));

  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, members]) => {
      const included = members.filter((member) => member.included);
      const blended = blendedReturn(included);
      const tier = invoiceTier(blended);
      const intTotal = included.reduce((sum, member) => sum + member.int, 0);
      const includedCost = included.reduce((sum, member) => sum + member.cost, 0);
      // Stage 1 bills the cost of every campaign published this month, matured or not.
      const baseTotal = members.reduce((sum, member) => sum + member.cost, 0);
      // Stage 2 tops the matured cohort's cost up to its full commissioned charge.
      const performanceFee = toCents(Math.max(0, intTotal * (1 + tier.markup) - includedCost));
      const maturingCount = members.filter((member) => member.status !== "matured").length;
      const withFee = members.map((member) => ({
        ...member,
        performanceFee: member.included ? memberFee(member.int, member.cost, tier.markup) : 0,
      }));
      return {
        month,
        label: monthLabel(month),
        members: withFee.sort((a, b) => b.cost - a.cost),
        memberCount: members.length,
        includedCount: included.length,
        maturingCount,
        blendedReturn: blended,
        tier,
        intTotal,
        baseTotal,
        performanceFee,
        amount: baseTotal + performanceFee,
        feeMonth: nextMonth(month),
        costInvoiced: month <= COST_INVOICED_THROUGH,
        feeSettled: maturingCount === 0,
      };
    });
}

/**
 * One calendar month's actual invoice. A publish-month batch spans two invoices
 * (cost now, fee next month), so the money that lands on any single month's
 * invoice is two different batches: THIS month's cost plus LAST month's fee. This
 * regroups the publish-month batches by the calendar month they are billed, so a
 * July row reads "July cost + June fee = July invoice".
 */
export interface InvoiceMonth {
  /** The calendar month this invoice is sent, e.g. "2026-07". */
  month: string;
  label: string;
  /** Stage 1 cost from campaigns published THIS month (the same-month batch). */
  newCost: number;
  /** Whether that cost has already been invoiced (publish month ≤ cutoff). */
  costInvoiced: boolean;
  /** The publish batch whose cost lands this month; null if none published. */
  costBatch: InvoiceBatch | null;
  /** Stage 2 fee carried from LAST month's batch — settled and billable now. */
  carriedFee: number;
  /** Fee from last month's batch still maturing (not yet billable). */
  feePending: number;
  /** Whether last month's batch has settled, so its fee is final. */
  feeSettled: boolean;
  /** The prior publish batch whose fee lands this month; null if none. */
  feeBatch: InvoiceBatch | null;
  /** Total billable on this month's invoice = newCost + carriedFee. */
  total: number;
}

/**
 * Regroup publish-month batches into the calendar months they are actually
 * invoiced. Each batch contributes its cost to its own publish month and its
 * performance fee to the next month, so a calendar month collects at most one
 * cost batch and one fee batch. Most recent invoice month first.
 */
export function buildInvoiceMonths(batches: InvoiceBatch[]): InvoiceMonth[] {
  interface Accumulator {
    month: string;
    newCost: number;
    costInvoiced: boolean;
    costBatch: InvoiceBatch | null;
    carriedFee: number;
    feePending: number;
    feeSettled: boolean;
    feeBatch: InvoiceBatch | null;
  }

  const byMonth = new Map<string, Accumulator>();
  const ensure = (month: string): Accumulator => {
    const existing = byMonth.get(month);
    if (existing) return existing;
    const created: Accumulator = {
      month,
      newCost: 0,
      costInvoiced: true,
      costBatch: null,
      carriedFee: 0,
      feePending: 0,
      feeSettled: true,
      feeBatch: null,
    };
    byMonth.set(month, created);
    return created;
  };

  for (const batch of batches) {
    // Cost lands the month the batch publishes. One batch per publish month, so
    // a direct assignment of the invoiced flag is correct.
    const costRow = ensure(batch.month);
    costRow.newCost += batch.baseTotal;
    costRow.costBatch = batch;
    costRow.costInvoiced = batch.costInvoiced;

    // Fee lands the month after. Settled fees are billable now; a still-maturing
    // batch's fee is only an estimate, so it sits in feePending.
    const feeRow = ensure(batch.feeMonth);
    feeRow.feeBatch = batch;
    if (batch.feeSettled) {
      feeRow.carriedFee += batch.performanceFee;
    } else {
      feeRow.feePending += batch.performanceFee;
      feeRow.feeSettled = false;
    }
  }

  return [...byMonth.values()]
    .map((row) => ({
      ...row,
      label: monthLabel(row.month),
      total: row.newCost + row.carriedFee,
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}
