import { describe, expect, it, vi } from "vitest";

import type { AlmediaCampaign } from "../almedia/agency-data";
import {
  runAlmediaChannelEnrichment,
  type EnrichmentPersistence,
} from "./almedia-batch";
import type {
  ChannelEnrichmentResult,
  EnrichmentSourceLink,
  StoredChannelEnrichment,
} from "./types";

function campaign(name: string, videoUrl: string | null): AlmediaCampaign {
  return {
    campaignName: name,
    campaignSource: "Arch",
    platform: "youtube",
    country: "PL",
    publishedAt: new Date("2026-07-01T00:00:00Z"),
    cost: 1000,
    expectedCpm: 20,
    viewCount: 100_000,
    signupsPct: null,
    roasD7pD14: null,
    roasReturn: null,
    returnPct: null,
    appuD14: null,
    d7Purchases: null,
    channelName: "Creator",
    videoUrl,
  };
}

describe("Almedia channel enrichment batch", () => {
  it("deduplicates campaign rounds and links the saved result to every source", async () => {
    const links: EnrichmentSourceLink[][] = [];
    const persistence: EnrichmentPersistence = {
      findChannelEnrichment: () => null,
      upsertChannelEnrichment: (result, nextLinks = []) => {
        links.push(nextLinks);
        return { result, links: nextLinks, updatedAt: "2026-07-23T00:00:00Z" };
      },
    };
    const result = {
      channel: { id: "UC123", title: "Creator" },
    } as ChannelEnrichmentResult;
    const enrich = vi.fn(async () => result);

    const summary = await runAlmediaChannelEnrichment({
      campaigns: [
        campaign("CREATOR_YT_R1", "https://youtu.be/abcdefghijk"),
        campaign("CREATOR_YT_R2", "https://youtu.be/lmnopqrstuv"),
      ],
      service: { enrich },
      persistence,
      concurrency: 2,
    });

    expect(enrich).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      discovered: 1,
      enriched: 1,
      skippedFresh: 0,
      failed: 0,
    });
    expect(links[0]).toEqual([
      { sourceType: "channel_key", sourceKey: "CREATOR" },
      { sourceType: "campaign", sourceKey: "CREATOR_YT_R1" },
      { sourceType: "campaign", sourceKey: "CREATOR_YT_R2" },
    ]);
  });

  it("skips fresh stored results and reports channels without a usable URL", async () => {
    const existing = {
      result: {
        meta: { generatedAt: "2026-07-22T00:00:00Z" },
      },
    } as StoredChannelEnrichment;
    const persistence: EnrichmentPersistence = {
      findChannelEnrichment: () => existing,
      upsertChannelEnrichment: () => existing,
    };
    const enrich = vi.fn();

    const summary = await runAlmediaChannelEnrichment({
      campaigns: [
        campaign("FRESH_YT_R1", "https://youtu.be/abcdefghijk"),
        campaign("NOURL_YT_R1", null),
      ],
      service: { enrich },
      persistence,
      now: () => new Date("2026-07-23T00:00:00Z"),
    });

    expect(enrich).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      discovered: 2,
      enriched: 0,
      skippedFresh: 1,
      skippedNoReference: 1,
      failed: 0,
    });
    expect(summary.failures[0]?.channelKey).toBe("NOURL");
  });
});
