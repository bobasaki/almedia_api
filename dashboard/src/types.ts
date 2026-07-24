import type { ChannelEnrichmentResult } from "../../src/enrichment/types";

export type CampaignEnrichment = Omit<
  ChannelEnrichmentResult,
  "schemaVersion" | "input" | "recentContent"
>;

export interface Campaign {
  campaignName: string;
  campaignSource: string;
  platform: string;
  country: string;
  publishedAt: string | null;
  cost: number | null;
  expectedCpm: number | null;
  viewCount: number | null;
  signupsPct: number | null;
  roasD7pD14: number | null;
  roasReturn: number | null;
  returnPct: number | null;
  appuD14: number | null;
  d7Purchases: number | null;
  channelName: string | null;
  videoUrl: string | null;
  enrichment?: CampaignEnrichment | null;
}

export interface CampaignPayload {
  agency: string;
  count: number;
  campaigns: Campaign[];
  fetchedAt: string;
  refreshAfter: string;
}

export interface CampaignFilters {
  platform: string;
  country: string;
  returnTier: string;
  maturity: string;
  from: string;
  to: string;
  search: string;
}
