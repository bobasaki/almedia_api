import { z } from "zod";

import { calculateCreatorMetrics } from "./metrics";
import {
  ENRICHMENT_SCHEMA_VERSION,
  channelEnrichmentResultSchema,
  type ChannelEnrichmentInput,
  type ChannelEnrichmentResult,
  type ChannelEnrichmentService,
  type ContentAnalysis,
  type ContentAnalysisAdapter,
  type EnrichmentWarning,
  type YouTubeChannelAdapter,
} from "./types";

const enrichmentInputSchema = z.object({
  input: z.string().trim().min(1),
  recentVideoLimit: z.number().int().min(1).max(50).default(20),
});

function roundConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

function dataCompletenessOf(
  followersKnown: boolean,
  recentContentCount: number,
  recentVideoLimit: number,
): number {
  const channelScore = followersKnown ? 0.35 : 0.2;
  const contentScore = Math.min(0.65, (recentContentCount / Math.min(10, recentVideoLimit)) * 0.65);
  return roundConfidence(channelScore + contentScore);
}

function normalizedLabels(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function normalizeAnalysis(analysis: ContentAnalysis): ContentAnalysis {
  return {
    ...analysis,
    summary: analysis.summary.trim(),
    classification: {
      ...analysis.classification,
      niche: analysis.classification.niche.trim().toLowerCase(),
      topics: normalizedLabels(analysis.classification.topics),
      language: {
        primary: analysis.classification.language.primary.trim().toLowerCase(),
        other: normalizedLabels(analysis.classification.language.other),
      },
      audiencePositioning: analysis.classification.audiencePositioning.trim(),
      brandFit: {
        ...analysis.classification.brandFit,
        categories: normalizedLabels(analysis.classification.brandFit.categories),
        rationale: analysis.classification.brandFit.rationale.trim(),
      },
      brandSafety: {
        ...analysis.classification.brandSafety,
        concerns: analysis.classification.brandSafety.concerns
          .map((concern) => concern.trim())
          .filter(Boolean),
        rationale: analysis.classification.brandSafety.rationale.trim(),
      },
    },
  };
}

export interface CreateChannelEnrichmentServiceOptions {
  youtube: YouTubeChannelAdapter;
  analyzer: ContentAnalysisAdapter;
  now?: () => Date;
}

/**
 * Create the single storage- and UI-independent enrichment service.
 *
 * External providers are injected, so YouTube and AI implementations can be
 * replaced without changing the orchestration or output contract.
 */
export function createChannelEnrichmentService(
  options: CreateChannelEnrichmentServiceOptions,
): ChannelEnrichmentService {
  const now = options.now ?? (() => new Date());

  return {
    async enrich(rawInput: ChannelEnrichmentInput): Promise<ChannelEnrichmentResult> {
      const input = enrichmentInputSchema.parse(rawInput);
      const snapshot = await options.youtube.collect(input.input, input.recentVideoLimit);
      const generatedAt = now();
      const metrics = calculateCreatorMetrics(snapshot.channel, snapshot.recentContent, generatedAt);

      let analysis;
      const warnings: EnrichmentWarning[] = [...snapshot.warnings];
      try {
        analysis = normalizeAnalysis(await options.analyzer.analyze(snapshot, metrics));
        warnings.push(...(analysis.warnings ?? []));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Content analysis adapter failed without a fallback: ${message}`, {
          cause: error,
        });
      }

      const dataCompleteness = dataCompletenessOf(
        snapshot.channel.subscribers !== null,
        snapshot.recentContent.length,
        input.recentVideoLimit,
      );
      const analysisConfidence = roundConfidence(analysis.confidence);
      const confidenceReasons = [
        `${snapshot.recentContent.length} recent public uploads were available for analysis.`,
        snapshot.channel.subscribers === null
          ? "The channel hides its public subscriber count."
          : "The public subscriber count was available.",
      ];
      if (analysis.analyzer.startsWith("rule_based")) {
        confidenceReasons.push("Classification used metadata heuristics rather than a configured AI model.");
      }

      return channelEnrichmentResultSchema.parse({
        schemaVersion: ENRICHMENT_SCHEMA_VERSION,
        input: snapshot.input,
        channel: snapshot.channel,
        recentContent: snapshot.recentContent,
        metrics,
        classification: analysis.classification,
        summary: analysis.summary,
        confidence: {
          overall: roundConfidence(dataCompleteness * 0.55 + analysisConfidence * 0.45),
          dataCompleteness,
          analysis: analysisConfidence,
          reasons: confidenceReasons,
        },
        warnings,
        meta: {
          generatedAt: generatedAt.toISOString(),
          youtubeDataSource: "youtube_data_api_v3",
          analyzer: analysis.analyzer,
          recentVideoLimit: input.recentVideoLimit,
        },
      });
    },
  };
}

/** Convenience function for callers that do not need to retain the service. */
export async function enrichYouTubeChannel(
  input: ChannelEnrichmentInput,
  options: CreateChannelEnrichmentServiceOptions,
): Promise<ChannelEnrichmentResult> {
  return createChannelEnrichmentService(options).enrich(input);
}
