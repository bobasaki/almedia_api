import { describe, expect, it } from "vitest";

import {
  DEFAULT_ENRICHMENT_MODEL,
  FallbackContentAnalysisAdapter,
  RuleBasedContentAnalysisAdapter,
} from "./analysis-adapters";
import { createChannelEnrichmentService } from "./service";
import type {
  ContentAnalysisAdapter,
  RawChannelSnapshot,
  YouTubeChannelAdapter,
} from "./types";

const snapshot: RawChannelSnapshot = {
  input: {
    value: "https://www.youtube.com/watch?v=abcdefghijk",
    resolvedVia: "video",
  },
  channel: {
    id: "UC1234567890123456789012",
    url: "https://www.youtube.com/channel/UC1234567890123456789012",
    title: "Build & Play",
    handle: "@buildandplay",
    description: "Gaming and technology tutorials",
    country: "PL",
    publishedAt: "2020-01-01T00:00:00.000Z",
    thumbnailUrl: null,
    subscribers: 1000,
    subscribersHidden: false,
    totalViews: 50_000,
    totalVideos: 30,
    topics: ["Gaming"],
    keywords: ["gaming", "technology"],
  },
  recentContent: [
    {
      id: "video000001",
      url: "https://www.youtube.com/watch?v=video000001",
      title: "Short build #shorts",
      description: "",
      publishedAt: "2026-07-22T00:00:00.000Z",
      durationSeconds: 45,
      views: 100,
      likes: 10,
      comments: 0,
      tags: ["gaming", "shorts"],
      categoryId: "20",
      liveStatus: "none",
      format: "short",
    },
    {
      id: "video000002",
      url: "https://www.youtube.com/watch?v=video000002",
      title: "Another quick build",
      description: "",
      publishedAt: "2026-07-15T00:00:00.000Z",
      durationSeconds: 55,
      views: 200,
      likes: 10,
      comments: 10,
      tags: ["gaming"],
      categoryId: "20",
      liveStatus: "none",
      format: "short",
    },
    {
      id: "video000003",
      url: "https://www.youtube.com/watch?v=video000003",
      title: "Full PC build tutorial",
      description: "",
      publishedAt: "2026-06-01T00:00:00.000Z",
      durationSeconds: 900,
      views: 1000,
      likes: 0,
      comments: 0,
      tags: ["technology"],
      categoryId: "28",
      liveStatus: "none",
      format: "long_form",
    },
  ],
  warnings: [],
};

class FakeYouTube implements YouTubeChannelAdapter {
  async collect(): Promise<RawChannelSnapshot> {
    return snapshot;
  }
}

const fakeAnalysis: ContentAnalysisAdapter = {
  async analyze() {
    return {
      classification: {
        niche: "gaming technology",
        topics: ["pc building", "gaming"],
        language: { primary: "en", other: [] },
        audiencePositioning: "Practical PC builders and gamers.",
        brandFit: {
          suitability: "high" as const,
          categories: ["gaming", "technology"],
          rationale: "Strong topical alignment.",
        },
        brandSafety: {
          risk: "low" as const,
          concerns: [],
          rationale: "No concerns in sampled metadata.",
        },
      },
      summary: "A practical gaming and PC-building creator.",
      confidence: 0.9,
      analyzer: "fake-ai-v1",
    };
  },
};

describe("channel enrichment service", () => {
  it("uses Terra as the default AI enrichment model", () => {
    expect(DEFAULT_ENRICHMENT_MODEL).toBe("gpt-5.6-terra");
  });

  it("returns the versioned contract with normalized metrics and adapter analysis", async () => {
    const service = createChannelEnrichmentService({
      youtube: new FakeYouTube(),
      analyzer: fakeAnalysis,
      now: () => new Date("2026-07-23T00:00:00.000Z"),
    });

    const result = await service.enrich({
      input: snapshot.input.value,
      recentVideoLimit: 20,
    });

    expect(result).toMatchObject({
      schemaVersion: "1.0",
      channel: { id: "UC1234567890123456789012", subscribers: 1000 },
      metrics: {
        followers: 1000,
        typicalViews: { median: 200, average: 433.33, sampleSize: 3 },
        typicalEngagementRatePct: 10,
        typicalViewsPerFollowerPct: 20,
        contentFormat: { dominant: "short" },
        uploadActivity: {
          lastUploadAt: "2026-07-22T00:00:00.000Z",
          daysSinceLastUpload: 1,
          uploadsLast30Days: 2,
          uploadsLast90Days: 3,
        },
      },
      classification: { niche: "gaming technology" },
      summary: "A practical gaming and PC-building creator.",
      meta: {
        analyzer: "fake-ai-v1",
        generatedAt: "2026-07-23T00:00:00.000Z",
        recentVideoLimit: 20,
      },
    });
    expect(result.confidence.overall).toBeGreaterThan(0.65);
  });

  it("falls back to rule-based analysis when the primary AI adapter fails", async () => {
    const failingAi: ContentAnalysisAdapter = {
      async analyze() {
        throw new Error("provider unavailable");
      },
    };
    const service = createChannelEnrichmentService({
      youtube: new FakeYouTube(),
      analyzer: new FallbackContentAnalysisAdapter(
        failingAi,
        new RuleBasedContentAnalysisAdapter(),
      ),
      now: () => new Date("2026-07-23T00:00:00.000Z"),
    });

    const result = await service.enrich({ input: snapshot.input.value });

    expect(result.meta.analyzer).toBe("rule_based_metadata_v1");
    expect(result.classification.niche).toBe("gaming");
    expect(result.warnings).toContainEqual({
      code: "AI_ANALYSIS_FAILED",
      message: "The configured AI analysis provider failed, so metadata heuristics were used.",
    });
  });
});
