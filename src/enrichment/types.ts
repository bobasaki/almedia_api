import { z } from "zod";

export const ENRICHMENT_SCHEMA_VERSION = "1.0" as const;

export const contentFormatSchema = z.enum(["short", "long_form", "live", "unknown"]);
export type ContentFormat = z.infer<typeof contentFormatSchema>;

export const enrichmentWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});
export type EnrichmentWarning = z.infer<typeof enrichmentWarningSchema>;

export const recentContentItemSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  title: z.string(),
  description: z.string(),
  publishedAt: z.string().datetime(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  views: z.number().int().nonnegative().nullable(),
  likes: z.number().int().nonnegative().nullable(),
  comments: z.number().int().nonnegative().nullable(),
  tags: z.array(z.string()),
  categoryId: z.string().nullable(),
  liveStatus: z.enum(["none", "upcoming", "live", "completed"]),
  format: contentFormatSchema,
});
export type RecentContentItem = z.infer<typeof recentContentItemSchema>;

export const publicChannelSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  handle: z.string().nullable(),
  description: z.string(),
  country: z.string().nullable(),
  publishedAt: z.string().datetime(),
  thumbnailUrl: z.string().url().nullable(),
  subscribers: z.number().int().nonnegative().nullable(),
  subscribersHidden: z.boolean(),
  totalViews: z.number().int().nonnegative().nullable(),
  totalVideos: z.number().int().nonnegative().nullable(),
  topics: z.array(z.string()),
  keywords: z.array(z.string()),
});
export type PublicChannel = z.infer<typeof publicChannelSchema>;

export const creatorMetricsSchema = z.object({
  followers: z.number().int().nonnegative().nullable(),
  totalViews: z.number().int().nonnegative().nullable(),
  totalVideos: z.number().int().nonnegative().nullable(),
  typicalViews: z.object({
    median: z.number().nonnegative().nullable(),
    average: z.number().nonnegative().nullable(),
    sampleSize: z.number().int().nonnegative(),
  }),
  typicalEngagementRatePct: z.number().nonnegative().nullable(),
  typicalViewsPerFollowerPct: z.number().nonnegative().nullable(),
  contentFormat: z.object({
    dominant: contentFormatSchema,
    mix: z.array(
      z.object({
        format: contentFormatSchema,
        count: z.number().int().nonnegative(),
        sharePct: z.number().min(0).max(100),
      }),
    ),
  }),
  uploadActivity: z.object({
    lastUploadAt: z.string().datetime().nullable(),
    daysSinceLastUpload: z.number().nonnegative().nullable(),
    uploadsLast30Days: z.number().int().nonnegative(),
    uploadsLast90Days: z.number().int().nonnegative(),
    uploadsPerWeek: z.number().nonnegative().nullable(),
  }),
});
export type CreatorMetrics = z.infer<typeof creatorMetricsSchema>;

export const creatorClassificationSchema = z.object({
  niche: z.string().min(1),
  topics: z.array(z.string()),
  language: z.object({
    primary: z.string().min(1),
    other: z.array(z.string()),
  }),
  audiencePositioning: z.string().min(1),
  brandFit: z.object({
    suitability: z.enum(["high", "medium", "low", "unknown"]),
    categories: z.array(z.string()),
    rationale: z.string().min(1),
  }),
  brandSafety: z.object({
    risk: z.enum(["low", "medium", "high", "unknown"]),
    concerns: z.array(z.string()),
    rationale: z.string().min(1),
  }),
});
export type CreatorClassification = z.infer<typeof creatorClassificationSchema>;

export const channelEnrichmentResultSchema = z.object({
  schemaVersion: z.literal(ENRICHMENT_SCHEMA_VERSION),
  input: z.object({
    value: z.string().min(1),
    resolvedVia: z.enum([
      "channel_id",
      "handle",
      "username",
      "custom_url",
      "video",
    ]),
  }),
  channel: publicChannelSchema,
  recentContent: z.array(recentContentItemSchema),
  metrics: creatorMetricsSchema,
  classification: creatorClassificationSchema,
  summary: z.string().min(1),
  confidence: z.object({
    overall: z.number().min(0).max(1),
    dataCompleteness: z.number().min(0).max(1),
    analysis: z.number().min(0).max(1),
    reasons: z.array(z.string()),
  }),
  warnings: z.array(enrichmentWarningSchema),
  meta: z.object({
    generatedAt: z.string().datetime(),
    youtubeDataSource: z.literal("youtube_data_api_v3"),
    analyzer: z.string().min(1),
    recentVideoLimit: z.number().int().min(1).max(50),
  }),
});
export type ChannelEnrichmentResult = z.infer<typeof channelEnrichmentResultSchema>;

export interface RawChannelSnapshot {
  input: {
    value: string;
    resolvedVia: ChannelEnrichmentResult["input"]["resolvedVia"];
  };
  channel: PublicChannel;
  recentContent: RecentContentItem[];
  warnings: EnrichmentWarning[];
}

export interface ContentAnalysis {
  classification: CreatorClassification;
  summary: string;
  confidence: number;
  analyzer: string;
  warnings?: EnrichmentWarning[];
}

export interface YouTubeChannelAdapter {
  collect(input: string, recentVideoLimit: number): Promise<RawChannelSnapshot>;
}

export interface ContentAnalysisAdapter {
  analyze(snapshot: RawChannelSnapshot, metrics: CreatorMetrics): Promise<ContentAnalysis>;
}

export interface ChannelEnrichmentInput {
  /** YouTube channel URL, channel ID, handle, username URL, or video/Shorts URL. */
  input: string;
  /** Number of newest public uploads to inspect. Defaults to 20; maximum 50. */
  recentVideoLimit?: number;
}

export interface ChannelEnrichmentService {
  enrich(input: ChannelEnrichmentInput): Promise<ChannelEnrichmentResult>;
}

export interface EnrichmentSourceLink {
  sourceType: "campaign" | "channel_key" | "booking" | "manual";
  sourceKey: string;
}

export interface StoredChannelEnrichment {
  result: ChannelEnrichmentResult;
  links: EnrichmentSourceLink[];
  updatedAt: string;
}
