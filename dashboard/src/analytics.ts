import { monthLabel } from "./labels";
import type { Campaign, CampaignFilters } from "./types";

export const RETURN_TIERS = [
  { id: "longterm", label: "Longterm", range: "> 100%" },
  { id: "rebooking", label: "Rebooking", range: "80–100%" },
  { id: "price_adjusted", label: "Rebooking · price adjusted", range: "50–<80%" },
  { id: "drop", label: "Drop", range: "< 50%" },
] as const;

export type ReturnTierId = (typeof RETURN_TIERS)[number]["id"];
export type MaturityStatus = "matured" | "maturing" | "unknown";

const MATURITY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface MaturityInfo {
  status: MaturityStatus;
  daysRemaining: number | null;
}

export function getMaturityInfo(
  publishedAt: string | null,
  now: Date = new Date(),
): MaturityInfo {
  if (!publishedAt) return { status: "unknown", daysRemaining: null };
  const publishedTime = Date.parse(publishedAt);
  if (Number.isNaN(publishedTime)) return { status: "unknown", daysRemaining: null };
  const matureAt = publishedTime + MATURITY_DAYS * DAY_MS;
  if (now.getTime() >= matureAt) return { status: "matured", daysRemaining: 0 };
  return {
    status: "maturing",
    daysRemaining: Math.max(1, Math.ceil((matureAt - now.getTime()) / DAY_MS)),
  };
}

export function getReturnTier(value: number | null): ReturnTierId | null {
  if (value === null) return null;
  if (value > 100) return "longterm";
  if (value >= 80) return "rebooking";
  if (value >= 50) return "price_adjusted";
  return "drop";
}

export interface MonthlyPerformance {
  key: string;
  label: string;
  cost: number;
  roas: number | null;
  campaigns: number;
}

export function sum(campaigns: Campaign[], field: keyof Campaign): number {
  return campaigns.reduce((total, campaign) => {
    const value = campaign[field];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

export function weightedAverage(
  campaigns: Campaign[],
  valueField: keyof Campaign,
  weightField: keyof Campaign,
): number | null {
  let weightedTotal = 0;
  let totalWeight = 0;
  for (const campaign of campaigns) {
    const value = campaign[valueField];
    const weight = campaign[weightField];
    if (typeof value === "number" && typeof weight === "number" && weight > 0) {
      weightedTotal += value * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? weightedTotal / totalWeight : null;
}

export function filterCampaigns(
  campaigns: Campaign[],
  filters: CampaignFilters,
  now: Date = new Date(),
): Campaign[] {
  const query = filters.search.trim().toLocaleLowerCase();
  return campaigns.filter((campaign) => {
    const date = campaign.publishedAt?.slice(0, 10) ?? "";
    return (
      (filters.platform === "all" || campaign.platform === filters.platform) &&
      (!filters.country || filters.country === "all" || campaign.country === filters.country) &&
      (!filters.returnTier || filters.returnTier === "all" || getReturnTier(campaign.returnPct) === filters.returnTier) &&
      (!filters.maturity || filters.maturity === "all" || getMaturityInfo(campaign.publishedAt, now).status === filters.maturity) &&
      (!filters.from || (date && date >= filters.from)) &&
      (!filters.to || (date && date <= filters.to)) &&
      (!query ||
        campaign.campaignName.toLocaleLowerCase().includes(query) ||
        (campaign.channelName?.toLocaleLowerCase().includes(query) ?? false))
    );
  });
}

export function returnTierGroups(campaigns: Campaign[]): Array<{
  id: ReturnTierId;
  label: string;
  range: string;
  count: number;
  share: number;
  averageReturn: number | null;
}> {
  const classifiedCount = campaigns.filter((campaign) => getReturnTier(campaign.returnPct) !== null).length;
  return RETURN_TIERS.map((tier) => {
    const rows = campaigns.filter((campaign) => getReturnTier(campaign.returnPct) === tier.id);
    const returns = rows
      .map((campaign) => campaign.returnPct)
      .filter((value): value is number => value !== null);
    return {
      ...tier,
      count: rows.length,
      share: classifiedCount > 0 ? rows.length / classifiedCount : 0,
      averageReturn: returns.length > 0
        ? returns.reduce((total, value) => total + value, 0) / returns.length
        : null,
    };
  });
}

export function monthlyPerformance(campaigns: Campaign[]): MonthlyPerformance[] {
  const groups = new Map<string, Campaign[]>();
  for (const campaign of campaigns) {
    if (!campaign.publishedAt) continue;
    const key = campaign.publishedAt.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), campaign]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => ({
      key,
      label: monthLabel(key),
      cost: sum(rows, "cost"),
      roas: weightedAverage(rows, "roasReturn", "cost"),
      campaigns: rows.length,
    }));
}

export function platformGroups(campaigns: Campaign[]): Array<{
  platform: string;
  campaigns: number;
  cost: number;
  views: number;
  roas: number | null;
}> {
  const platforms = [...new Set(campaigns.map((campaign) => campaign.platform))].sort();
  return platforms.map((platform) => {
    const rows = campaigns.filter((campaign) => campaign.platform === platform);
    return {
      platform,
      campaigns: rows.length,
      cost: sum(rows, "cost"),
      views: sum(rows, "viewCount"),
      roas: weightedAverage(rows, "roasReturn", "cost"),
    };
  });
}
