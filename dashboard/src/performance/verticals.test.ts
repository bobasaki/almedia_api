import { describe, expect, it } from "vitest";

import type { CampaignEnrichment } from "../types";
import { deriveVerticals } from "./verticals";

function enrichment(overrides: {
  niche: string;
  topics?: string[];
  categories?: string[];
  summary?: string;
}): CampaignEnrichment {
  return {
    channel: {
      id: "channel",
      url: "https://youtube.com/channel/channel",
      title: "Creator",
      handle: "@creator",
      description: "",
      country: "ES",
      publishedAt: "2020-01-01T00:00:00.000Z",
      thumbnailUrl: null,
      subscribers: 10_000,
      subscribersHidden: false,
      totalViews: 1_000_000,
      totalVideos: 100,
      topics: [],
      keywords: [],
    },
    metrics: {
      followers: 10_000,
      totalViews: 1_000_000,
      totalVideos: 100,
      typicalViews: { median: 20_000, average: 25_000, sampleSize: 20 },
      typicalEngagementRatePct: 4,
      typicalViewsPerFollowerPct: 200,
      contentFormat: { dominant: "long_form", mix: [] },
      uploadActivity: {
        lastUploadAt: "2026-07-01T00:00:00.000Z",
        daysSinceLastUpload: 1,
        uploadsLast30Days: 4,
        uploadsLast90Days: 12,
        uploadsPerWeek: 1,
      },
    },
    classification: {
      niche: overrides.niche,
      topics: overrides.topics ?? [],
      language: { primary: "Spanish", other: [] },
      audiencePositioning: "",
      brandFit: {
        suitability: "high",
        categories: overrides.categories ?? [],
        rationale: "Suitable",
      },
      brandSafety: { risk: "low", concerns: [], rationale: "Safe" },
    },
    summary: overrides.summary ?? "",
    confidence: { overall: 0.9, dataCompleteness: 0.9, analysis: 0.9, reasons: [] },
    warnings: [],
    meta: {
      generatedAt: "2026-07-01T00:00:00.000Z",
      youtubeDataSource: "youtube_data_api_v3",
      analyzer: "test",
      recentVideoLimit: 20,
    },
  };
}

describe("deriveVerticals", () => {
  it("maps geography gaming enrichment to the two strongest controlled verticals", () => {
    expect(deriveVerticals(enrichment({
      niche: "spanish-language geography gaming",
      topics: ["geoguessr", "geography quizzes", "maps", "countries and capitals"],
      categories: ["gaming", "education", "travel"],
    }))).toEqual(["Education", "Gaming"]);
  });

  it("maps true-crime documentary enrichment without returning more than two values", () => {
    const result = deriveVerticals(enrichment({
      niche: "true crime documentary podcast",
      topics: ["criminal cases", "mystery", "society"],
    }));
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("Crimes");
    expect(result).toContain("Documentary");
  });

  it("returns no guess when enrichment is unavailable", () => {
    expect(deriveVerticals(null)).toEqual([]);
  });
});
