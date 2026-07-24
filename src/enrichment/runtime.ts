import process from "node:process";

import {
  DEFAULT_ENRICHMENT_MODEL,
  FallbackContentAnalysisAdapter,
  OpenAiContentAnalysisAdapter,
  RuleBasedContentAnalysisAdapter,
} from "./analysis-adapters";
import { createChannelEnrichmentService } from "./service";
import type { ChannelEnrichmentService } from "./types";
import { YouTubeDataApiAdapter } from "./youtube-adapter";

export interface RuntimeEnrichmentOptions {
  youtubeApiKey?: string;
  openAiApiKey?: string;
  openAiModel?: string;
  disableAi?: boolean;
}

/** Build the default adapters from environment variables, keeping secrets server-side. */
export function createRuntimeChannelEnrichmentService(
  options: RuntimeEnrichmentOptions = {},
): ChannelEnrichmentService {
  const youtubeApiKey = options.youtubeApiKey?.trim() || process.env.YOUTUBE_API_KEY?.trim() || "";
  const openAiApiKey = options.openAiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
  const openAiModel =
    options.openAiModel?.trim() ||
    process.env.OPENAI_ENRICHMENT_MODEL?.trim() ||
    DEFAULT_ENRICHMENT_MODEL;
  const youtube = new YouTubeDataApiAdapter({ apiKey: youtubeApiKey });

  if (options.disableAi || !openAiApiKey) {
    return createChannelEnrichmentService({
      youtube,
      analyzer: new RuleBasedContentAnalysisAdapter({
        warning: {
          code: "AI_ANALYSIS_UNAVAILABLE",
          message: "OPENAI_API_KEY is not configured, so metadata heuristics were used.",
        },
      }),
    });
  }

  return createChannelEnrichmentService({
    youtube,
    analyzer: new FallbackContentAnalysisAdapter(
      new OpenAiContentAnalysisAdapter({
        apiKey: openAiApiKey,
        model: openAiModel,
      }),
    ),
  });
}
