/**
 * Sample API payloads for tests and offline development, mirroring the shapes
 * in the Almedia Agency Data API docs.
 */

export interface RawCampaign {
  campaign_name: string;
  campaign_source: string;
  platform: string;
  country: string;
  published_at: string | null;
  cost: number | null;
  expected_cpm: number | null;
  view_count: number | null;
  signups_pct: number | null;
  roas_d7p_d14: number | null;
  roas_return: number | null;
  return_pct: number | null;
  appu_d14: number | null;
  d7_purchases: number | null;
  channel_name: string | null;
  video_url: string | null;
}

export interface RawAgencyDataResponse {
  agency: string;
  count: number;
  limit: number;
  offset: number;
  campaigns: RawCampaign[];
}

/** A fully-matured campaign (from the docs example). */
export const matureCampaign: RawCampaign = {
  campaign_name: "BRAND_YT_R1",
  campaign_source: "YourAgency",
  platform: "youtube",
  country: "DE",
  published_at: "2026-03-01",
  cost: 1000,
  expected_cpm: 12.5,
  view_count: 84000,
  signups_pct: 0.021,
  roas_d7p_d14: 0.63,
  roas_return: 1.12,
  return_pct: 0.1,
  appu_d14: 3.4,
  d7_purchases: 210,
  channel_name: "Brand Creator",
  video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
};

/** A freshly-published campaign whose downstream metrics haven't matured yet. */
export const immatureCampaign: RawCampaign = {
  campaign_name: "BRAND_TT_NEW",
  campaign_source: "YourAgency",
  platform: "tiktok",
  country: "US",
  published_at: "2026-07-14",
  cost: 500,
  expected_cpm: 9,
  view_count: 12000,
  signups_pct: null,
  roas_d7p_d14: null,
  roas_return: null,
  return_pct: null,
  appu_d14: null,
  d7_purchases: null,
  channel_name: "Brand Creator TT",
  video_url: null,
};

export function makeCampaign(overrides: Partial<RawCampaign> = {}): RawCampaign {
  return { ...matureCampaign, ...overrides };
}

export function agencyDataResponse(
  campaigns: RawCampaign[],
  options: { agency?: string; limit?: number; offset?: number } = {},
): RawAgencyDataResponse {
  return {
    agency: options.agency ?? "YourAgency",
    count: campaigns.length,
    limit: options.limit ?? 500,
    offset: options.offset ?? 0,
    campaigns,
  };
}
