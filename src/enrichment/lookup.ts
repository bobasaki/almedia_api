import { campaignBaseKey } from "../migration/cell-utils";
import type { EnrichmentSourceLink, StoredChannelEnrichment } from "./types";

export interface EnrichmentLinkLookup {
  findChannelEnrichment(
    sourceType: EnrichmentSourceLink["sourceType"],
    sourceKey: string,
  ): StoredChannelEnrichment | null;
}

/**
 * Resolve an enrichment using the exact campaign link first, then the
 * normalized creator key. The fallback covers campaign variants that were
 * added after an enrichment run or that use a suffix such as `_R2_LB`.
 */
export function findCampaignEnrichment(
  lookup: EnrichmentLinkLookup,
  campaignName: string,
): StoredChannelEnrichment | null {
  return lookup.findChannelEnrichment("campaign", campaignName)
    ?? lookup.findChannelEnrichment("channel_key", campaignBaseKey(campaignName));
}
