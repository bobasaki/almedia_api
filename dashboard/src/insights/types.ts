import type { Booking } from "../../../src/bookings/types";
import type { Campaign } from "../types";

/**
 * The Insights view works on one unified row type: a "deal" — an internal
 * booking joined (by normalized channel key) with the live Almedia campaigns
 * it produced. Campaign-only and booking-only rows are kept too, so nothing
 * silently drops out of totals.
 */

export const SIZE_TIERS = ["<10k", "10-20k", "20-50k", ">50k"] as const;
export type SizeTier = (typeof SIZE_TIERS)[number];

export interface Deal {
  /** Normalized join key, e.g. "ASMRFIXY". */
  channelKey: string;
  channelName: string;
  campaignName: string | null;
  /** Direct link to the published video, when the platform provides one. */
  videoUrl: string | null;
  platform: string | null;
  publishedAt: string | null;
  /** Almedia spend for this campaign (EUR). */
  cost: number | null;
  expectedCpm: number | null;
  viewCount: number | null;
  returnPct: number | null;
  /** Almedia funnel + ROAS metrics, carried through for unit-economics charts. */
  signupsPct: number | null;
  d7Purchases: number | null;
  roasReturn: number | null;
  /** Average payment per user by day 14 (APPU) — spend quality of acquired users. */
  appuD14: number | null;
  /** cost / expectedCpm × 1000 — the views the price was based on. */
  expectedViews: number | null;
  /** viewCount / expectedViews × 100. */
  deliveryPct: number | null;
  /** Internal tracker ownership (null when the campaign has no booking yet). */
  cm: string | null;
  /** Campaign market from Almedia, falling back to the tracker for booking-only rows. */
  country: string | null;
  /** Internal tracker enrichment (null when the campaign has no booking yet). */
  vertical: string | null;
  /** Up to two controlled, enrichment-derived verticals. */
  verticals: string[];
  category: string | null;
  hasEnrichment: boolean;
  creatorFollowers: number | null;
  creatorTypicalViews: number | null;
  creatorEngagementRatePct: number | null;
  creatorContentFormat: string | null;
  creatorBrandFit: string | null;
  creatorSafetyRisk: string | null;
  status: Booking["status"] | null;
  intBudget: number | null;
  extBudget: number | null;
  month: string | null;
  /** Deal-size tier from intBudget (falling back to campaign cost). */
  sizeTier: SizeTier | null;
  hasCampaign: boolean;
  hasBooking: boolean;
}

export const DIMENSIONS = [
  { id: "cm", label: "CM" },
  { id: "country", label: "Market" },
  { id: "vertical", label: "Vertical" },
  { id: "category", label: "Category" },
  { id: "platform", label: "Platform" },
  { id: "sizeTier", label: "Size" },
  { id: "status", label: "Status" },
  { id: "month", label: "Month" },
] as const;

export type DimensionId = (typeof DIMENSIONS)[number]["id"];

/** "all" means no filter on that dimension. */
export type InsightFilters = Record<DimensionId, string>;

export const ALL_FILTERS: InsightFilters = {
  cm: "all",
  country: "all",
  vertical: "all",
  category: "all",
  platform: "all",
  sizeTier: "all",
  status: "all",
  month: "all",
};

export const UNASSIGNED = "Unassigned";

export interface DimensionGroup {
  key: string;
  deals: number;
  /** Almedia spend (EUR). */
  cost: number;
  /** Internal booked budget (EUR, INT). */
  intBudget: number;
  expectedViews: number;
  actualViews: number;
  deliveryPct: number | null;
  /** Cost-weighted average return %. */
  avgReturnPct: number | null;
  /** Deals with a measured return, used to qualify averages. */
  measured: number;
  publishedShare: number | null;
  droppedShare: number | null;
}

export interface PainPoint {
  dimension: DimensionId;
  key: string;
  severity: "high" | "medium";
  issue: "low-return" | "under-delivery" | "publishing-lag" | "high-dropout";
  detail: string;
}

export interface VerticalPerformance {
  vertical: string;
  campaigns: number;
  measuredReturns: number;
  enrichedCreators: number;
  cost: number;
  views: number;
  d7Purchases: number;
  avgReturnPct: number | null;
  avgEngagementRatePct: number | null;
  avgFollowers: number | null;
  brandSafeShare: number | null;
}

export interface EnrichmentOverview {
  campaigns: number;
  enrichedCampaigns: number;
  coverageShare: number | null;
  enrichedCreators: number;
  verticals: number;
  avgEngagementRatePct: number | null;
  brandSafeShare: number | null;
}

export type { Booking, Campaign };
