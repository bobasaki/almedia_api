import { campaignBaseKey } from "./cell-utils";

/**
 * Join sheet bookings (keyed by normalized channel name) to Almedia API
 * campaigns (keyed by the base of the `NAME_PLATFORM_R#` naming convention).
 *
 * Exact key equality is preferred; a prefix match (either direction, both
 * keys > 4 chars) catches truncations like "MARIUSZSTANKIE…" vs the full
 * channel name. Verified against the July 2026 export: 94% of API campaigns
 * match a sheet channel.
 */

export type JoinConfidence = "exact" | "prefix";

export interface CampaignMatch {
  channelKey: string;
  campaignNames: string[];
  confidence: JoinConfidence;
}

export interface JoinReport {
  matches: CampaignMatch[];
  unmatchedChannelKeys: string[];
  unmatchedCampaignNames: string[];
  stats: {
    channels: number;
    campaigns: number;
    matchedChannels: number;
    matchedCampaigns: number;
  };
}

const MIN_PREFIX_LENGTH = 5;

export function joinChannelsToCampaigns(
  channelKeys: readonly string[],
  campaignNames: readonly string[],
): JoinReport {
  const campaignsByBase = new Map<string, string[]>();
  for (const name of campaignNames) {
    const base = campaignBaseKey(name);
    const existing = campaignsByBase.get(base);
    if (existing) existing.push(name);
    else campaignsByBase.set(base, [name]);
  }

  const uniqueChannels = [...new Set(channelKeys)].filter((key) => key !== "");
  const matches: CampaignMatch[] = [];
  const unmatchedChannelKeys: string[] = [];
  const matchedCampaigns = new Set<string>();

  const bases = [...campaignsByBase.keys()];
  for (const channelKey of uniqueChannels) {
    const exact = campaignsByBase.get(channelKey);
    if (exact) {
      matches.push({ channelKey, campaignNames: exact, confidence: "exact" });
      exact.forEach((name) => matchedCampaigns.add(name));
      continue;
    }
    if (channelKey.length >= MIN_PREFIX_LENGTH) {
      const prefixNames = bases
        .filter(
          (base) =>
            base.length >= MIN_PREFIX_LENGTH &&
            (base.startsWith(channelKey) || channelKey.startsWith(base)),
        )
        .flatMap((base) => campaignsByBase.get(base) ?? []);
      if (prefixNames.length > 0) {
        matches.push({ channelKey, campaignNames: prefixNames, confidence: "prefix" });
        prefixNames.forEach((name) => matchedCampaigns.add(name));
        continue;
      }
    }
    unmatchedChannelKeys.push(channelKey);
  }

  return {
    matches,
    unmatchedChannelKeys,
    unmatchedCampaignNames: campaignNames.filter((name) => !matchedCampaigns.has(name)),
    stats: {
      channels: uniqueChannels.length,
      campaigns: campaignNames.length,
      matchedChannels: matches.length,
      matchedCampaigns: matchedCampaigns.size,
    },
  };
}
