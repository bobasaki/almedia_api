import { z } from "zod";

import type {
  ChannelEnrichmentResult,
  ContentFormat,
  EnrichmentWarning,
  RawChannelSnapshot,
  RecentContentItem,
  YouTubeChannelAdapter,
} from "./types";

const DEFAULT_BASE_URL = "https://www.googleapis.com/youtube/v3";
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 500;

type FetchLike = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;
type ResolvedVia = ChannelEnrichmentResult["input"]["resolvedVia"];

export type YouTubeErrorCode =
  | "YOUTUBE_API_KEY_MISSING"
  | "YOUTUBE_AUTH_FAILED"
  | "YOUTUBE_RATE_LIMITED"
  | "YOUTUBE_NOT_FOUND"
  | "YOUTUBE_INVALID_RESPONSE"
  | "YOUTUBE_REQUEST_FAILED";

export class YouTubeApiError extends Error {
  readonly code: YouTubeErrorCode;
  readonly status?: number;

  constructor(code: YouTubeErrorCode, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "YouTubeApiError";
    this.code = code;
    this.status = options.status;
  }
}

const thumbnailSchema = z.object({ url: z.string().url() }).passthrough();
const thumbnailsSchema = z
  .object({
    default: thumbnailSchema.optional(),
    medium: thumbnailSchema.optional(),
    high: thumbnailSchema.optional(),
    standard: thumbnailSchema.optional(),
    maxres: thumbnailSchema.optional(),
  })
  .default({});

const channelListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        snippet: z.object({
          title: z.string(),
          description: z.string().default(""),
          customUrl: z.string().optional(),
          publishedAt: z.string().datetime(),
          thumbnails: thumbnailsSchema,
          country: z.string().optional(),
        }),
        statistics: z
          .object({
            viewCount: z.string().optional(),
            subscriberCount: z.string().optional(),
            hiddenSubscriberCount: z.boolean().default(false),
            videoCount: z.string().optional(),
          })
          .default({ hiddenSubscriberCount: false }),
        contentDetails: z.object({
          relatedPlaylists: z.object({ uploads: z.string().optional() }).default({}),
        }),
        topicDetails: z
          .object({
            topicCategories: z.array(z.string()).default([]),
          })
          .optional(),
        brandingSettings: z
          .object({
            channel: z
              .object({
                keywords: z.string().optional(),
                country: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

const videoListItemSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({
    channelId: z.string().min(1),
    title: z.string(),
    description: z.string().default(""),
    publishedAt: z.string().datetime(),
    tags: z.array(z.string()).default([]),
    categoryId: z.string().optional(),
    liveBroadcastContent: z.enum(["none", "upcoming", "live"]).default("none"),
  }),
  statistics: z
    .object({
      viewCount: z.string().optional(),
      likeCount: z.string().optional(),
      commentCount: z.string().optional(),
    })
    .optional(),
  contentDetails: z.object({ duration: z.string().optional() }).optional(),
  liveStreamingDetails: z
    .object({
      actualStartTime: z.string().optional(),
      actualEndTime: z.string().optional(),
      scheduledStartTime: z.string().optional(),
    })
    .optional(),
});

const videoListSchema = z.object({
  items: z.array(videoListItemSchema).default([]),
});

const playlistItemsSchema = z.object({
  items: z
    .array(
      z.object({
        contentDetails: z.object({ videoId: z.string().min(1) }),
      }),
    )
    .default([]),
});

const searchListSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.object({ channelId: z.string().min(1) }),
      }),
    )
    .default([]),
});

const youtubeErrorSchema = z.object({
  error: z
    .object({
      message: z.string().optional(),
      errors: z.array(z.object({ reason: z.string().optional() }).passthrough()).optional(),
    })
    .optional(),
});

export interface YouTubeReference {
  kind: "channel_id" | "handle" | "username" | "custom_url" | "video";
  value: string;
  resolvedVia: ResolvedVia;
}

function cleanHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
}

/**
 * Parse all supported public YouTube references without making a request.
 * Unknown YouTube channel paths fall back to the search-based custom URL route.
 */
export function parseYouTubeReference(raw: string): YouTubeReference {
  const value = raw.trim();
  if (!value) {
    throw new YouTubeApiError("YOUTUBE_NOT_FOUND", "A YouTube channel or video reference is required.");
  }
  if (/^UC[\w-]{22}$/.test(value)) {
    return { kind: "channel_id", value, resolvedVia: "channel_id" };
  }
  if (/^@[\w.-]+$/.test(value)) {
    return { kind: "handle", value: value.slice(1), resolvedVia: "handle" };
  }
  if (/^[\w-]{11}$/.test(value)) {
    return { kind: "video", value, resolvedVia: "video" };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch (cause) {
    throw new YouTubeApiError(
      "YOUTUBE_NOT_FOUND",
      "Input must be a YouTube channel URL, channel ID, handle, or video URL.",
      { cause },
    );
  }
  const host = cleanHost(url.hostname);
  if (host === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0];
    if (videoId) return { kind: "video", value: videoId, resolvedVia: "video" };
  }
  if (host !== "youtube.com") {
    throw new YouTubeApiError("YOUTUBE_NOT_FOUND", `Unsupported YouTube host "${url.hostname}".`);
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (url.pathname === "/watch") {
    const videoId = url.searchParams.get("v");
    if (videoId) return { kind: "video", value: videoId, resolvedVia: "video" };
  }
  if (["shorts", "embed", "live"].includes(parts[0] ?? "") && parts[1]) {
    return { kind: "video", value: parts[1], resolvedVia: "video" };
  }
  if (parts[0] === "channel" && parts[1]) {
    return { kind: "channel_id", value: parts[1], resolvedVia: "channel_id" };
  }
  if (parts[0]?.startsWith("@")) {
    return { kind: "handle", value: parts[0].slice(1), resolvedVia: "handle" };
  }
  if (parts[0] === "user" && parts[1]) {
    return { kind: "username", value: parts[1], resolvedVia: "username" };
  }
  if (parts[0] === "c" && parts[1]) {
    return { kind: "custom_url", value: parts[1], resolvedVia: "custom_url" };
  }
  if (parts[0]) {
    return { kind: "custom_url", value: parts[0], resolvedVia: "custom_url" };
  }
  throw new YouTubeApiError("YOUTUBE_NOT_FOUND", "The YouTube URL does not identify a channel or video.");
}

function parsePublicCount(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

export function parseIsoDurationSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  return Math.round(days * 86_400 + hours * 3600 + minutes * 60 + seconds);
}

function topicName(url: string): string {
  const tail = url.split("/").filter(Boolean).at(-1) ?? url;
  try {
    return decodeURIComponent(tail).replaceAll("_", " ");
  } catch {
    return tail.replaceAll("_", " ");
  }
}

function splitKeywords(value: string | undefined): string[] {
  if (!value) return [];
  return (value.match(/"[^"]+"|\S+/g) ?? [])
    .map((keyword) => keyword.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
}

function formatOf(
  durationSeconds: number | null,
  title: string,
  tags: string[],
  liveStatus: RecentContentItem["liveStatus"],
): ContentFormat {
  if (liveStatus !== "none") return "live";
  const shortMarker = /(^|\s)#?shorts?(\s|$)/i.test(`${title} ${tags.join(" ")}`);
  if (durationSeconds !== null && (durationSeconds <= 60 || (durationSeconds <= 180 && shortMarker))) {
    return "short";
  }
  return durationSeconds === null ? "unknown" : "long_form";
}

function liveStatusOf(
  item: z.infer<typeof videoListItemSchema>,
): RecentContentItem["liveStatus"] {
  if (item.snippet.liveBroadcastContent === "live") return "live";
  if (item.snippet.liveBroadcastContent === "upcoming") return "upcoming";
  if (item.liveStreamingDetails?.actualStartTime) return "completed";
  return "none";
}

function normalizeVideo(item: z.infer<typeof videoListItemSchema>): RecentContentItem {
  const durationSeconds = parseIsoDurationSeconds(item.contentDetails?.duration);
  const liveStatus = liveStatusOf(item);
  return {
    id: item.id,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}`,
    title: item.snippet.title.trim(),
    description: item.snippet.description.trim(),
    publishedAt: new Date(item.snippet.publishedAt).toISOString(),
    durationSeconds,
    views: parsePublicCount(item.statistics?.viewCount),
    likes: parsePublicCount(item.statistics?.likeCount),
    comments: parsePublicCount(item.statistics?.commentCount),
    tags: item.snippet.tags.map((tag) => tag.trim()).filter(Boolean),
    categoryId: item.snippet.categoryId ?? null,
    liveStatus,
    format: formatOf(durationSeconds, item.snippet.title, item.snippet.tags, liveStatus),
  };
}

export interface YouTubeDataApiAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
  sleepFn?: SleepFn;
  maxRetries?: number;
}

export class YouTubeDataApiAdapter implements YouTubeChannelAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly sleepFn: SleepFn;
  private readonly maxRetries: number;

  constructor(options: YouTubeDataApiAdapterOptions) {
    this.apiKey = options.apiKey.trim();
    if (!this.apiKey) {
      throw new YouTubeApiError(
        "YOUTUBE_API_KEY_MISSING",
        "No YouTube API key provided. Set YOUTUBE_API_KEY or pass apiKey.",
      );
    }
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.sleepFn =
      options.sleepFn ??
      ((ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }));
    this.maxRetries = options.maxRetries ?? MAX_RETRIES;
  }

  private async request<T>(
    path: string,
    query: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    url.searchParams.set("key", this.apiKey);

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.fetchFn(url, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        const body = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          const parsedError = youtubeErrorSchema.safeParse(body);
          const reason = parsedError.success
            ? parsedError.data.error?.errors?.[0]?.reason
            : undefined;
          const providerMessage = parsedError.success ? parsedError.data.error?.message : undefined;
          const code: YouTubeErrorCode =
            response.status === 400 || response.status === 401 || response.status === 403
              ? reason === "quotaExceeded" || reason === "rateLimitExceeded"
                ? "YOUTUBE_RATE_LIMITED"
                : "YOUTUBE_AUTH_FAILED"
              : response.status === 404
                ? "YOUTUBE_NOT_FOUND"
                : response.status === 429
                  ? "YOUTUBE_RATE_LIMITED"
                  : "YOUTUBE_REQUEST_FAILED";
          const error = new YouTubeApiError(
            code,
            providerMessage ?? `YouTube Data API request failed (HTTP ${response.status}).`,
            { status: response.status },
          );
          if (
            attempt < this.maxRetries &&
            (response.status === 429 || response.status >= 500)
          ) {
            lastError = error;
            await this.sleepFn(BASE_RETRY_DELAY_MS * 2 ** attempt);
            continue;
          }
          throw error;
        }
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          throw new YouTubeApiError(
            "YOUTUBE_INVALID_RESPONSE",
            `YouTube response for ${path} did not match the expected shape: ${parsed.error.message}`,
            { cause: parsed.error },
          );
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof YouTubeApiError) throw error;
        lastError = error;
        if (attempt < this.maxRetries) {
          await this.sleepFn(BASE_RETRY_DELAY_MS * 2 ** attempt);
          continue;
        }
      }
    }
    throw new YouTubeApiError(
      "YOUTUBE_REQUEST_FAILED",
      `Network request to YouTube failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      { cause: lastError },
    );
  }

  private async resolveChannelId(reference: YouTubeReference): Promise<string> {
    if (reference.kind === "channel_id") return reference.value;
    if (reference.kind === "video") {
      const response = await this.request(
        "videos",
        { part: "snippet", id: reference.value, maxResults: "1" },
        videoListSchema,
      );
      const channelId = response.items[0]?.snippet.channelId;
      if (!channelId) {
        throw new YouTubeApiError(
          "YOUTUBE_NOT_FOUND",
          `No public YouTube video was found for "${reference.value}".`,
        );
      }
      return channelId;
    }
    if (reference.kind === "handle" || reference.kind === "username") {
      const lookup: Record<string, string> =
        reference.kind === "handle"
          ? { forHandle: reference.value }
          : { forUsername: reference.value };
      const response = await this.request(
        "channels",
        { part: "id", ...lookup },
        z.object({ items: z.array(z.object({ id: z.string().min(1) })).default([]) }),
      );
      const channelId = response.items[0]?.id;
      if (!channelId) {
        throw new YouTubeApiError(
          "YOUTUBE_NOT_FOUND",
          `No public YouTube channel was found for "${reference.value}".`,
        );
      }
      return channelId;
    }

    const response = await this.request(
      "search",
      { part: "snippet", q: reference.value, type: "channel", maxResults: "1" },
      searchListSchema,
    );
    const channelId = response.items[0]?.id.channelId;
    if (!channelId) {
      throw new YouTubeApiError(
        "YOUTUBE_NOT_FOUND",
        `No public YouTube channel was found for custom URL "${reference.value}".`,
      );
    }
    return channelId;
  }

  async collect(rawInput: string, recentVideoLimit: number): Promise<RawChannelSnapshot> {
    const reference = parseYouTubeReference(rawInput);
    const channelId = await this.resolveChannelId(reference);
    const channelResponse = await this.request(
      "channels",
      {
        part: "snippet,statistics,contentDetails,topicDetails,brandingSettings",
        id: channelId,
        maxResults: "1",
      },
      channelListSchema,
    );
    const rawChannel = channelResponse.items[0];
    if (!rawChannel) {
      throw new YouTubeApiError(
        "YOUTUBE_NOT_FOUND",
        `No public YouTube channel was found for "${rawInput}".`,
      );
    }

    const warnings: EnrichmentWarning[] = [];
    if (reference.kind === "custom_url") {
      warnings.push({
        code: "CUSTOM_URL_SEARCH_MATCH",
        message: "The legacy/custom channel URL was resolved through YouTube search; verify the matched channel.",
      });
    }
    if (rawChannel.statistics.hiddenSubscriberCount) {
      warnings.push({
        code: "SUBSCRIBERS_HIDDEN",
        message: "The channel hides its public subscriber count, so follower-relative metrics are unavailable.",
      });
    }
    const subscribers = rawChannel.statistics.hiddenSubscriberCount
      ? null
      : parsePublicCount(rawChannel.statistics.subscriberCount);
    const totalViews = parsePublicCount(rawChannel.statistics.viewCount);
    const totalVideos = parsePublicCount(rawChannel.statistics.videoCount);
    if (!rawChannel.statistics.hiddenSubscriberCount && subscribers === null) {
      warnings.push({
        code: "SUBSCRIBER_COUNT_UNAVAILABLE",
        message: "YouTube did not return a usable public subscriber count.",
      });
    }
    if (totalViews === null || totalVideos === null) {
      warnings.push({
        code: "PARTIAL_CHANNEL_STATISTICS",
        message: "One or more public lifetime channel statistics were unavailable.",
      });
    }

    const uploadsPlaylistId = rawChannel.contentDetails.relatedPlaylists.uploads;
    let recentContent: RecentContentItem[] = [];
    if (!uploadsPlaylistId) {
      warnings.push({
        code: "UPLOADS_PLAYLIST_UNAVAILABLE",
        message: "YouTube did not return a public uploads playlist for this channel.",
      });
    } else {
      const playlist = await this.request(
        "playlistItems",
        {
          part: "contentDetails",
          playlistId: uploadsPlaylistId,
          maxResults: String(recentVideoLimit),
        },
        playlistItemsSchema,
      );
      const videoIds = playlist.items.map((item) => item.contentDetails.videoId);
      if (videoIds.length > 0) {
        const details = await this.request(
          "videos",
          {
            part: "snippet,statistics,contentDetails,liveStreamingDetails",
            id: videoIds.join(","),
            maxResults: String(videoIds.length),
          },
          videoListSchema,
        );
        const byId = new Map(details.items.map((item) => [item.id, item]));
        recentContent = videoIds.flatMap((id) => {
          const item = byId.get(id);
          return item ? [normalizeVideo(item)] : [];
        });
        if (recentContent.length < videoIds.length) {
          warnings.push({
            code: "PARTIAL_VIDEO_DETAILS",
            message: `${videoIds.length - recentContent.length} recent uploads were private, deleted, or otherwise unavailable.`,
          });
        }
      }
    }
    if (recentContent.length === 0) {
      warnings.push({
        code: "NO_RECENT_CONTENT",
        message: "No public recent uploads were available, so content metrics and classification are limited.",
      });
    } else if (recentContent.length < recentVideoLimit) {
      const available = recentContent.length;
      warnings.push({
        code: "FEWER_UPLOADS_THAN_REQUESTED",
        message: `Only ${available} public ${available === 1 ? "upload was" : "uploads were"} available out of ${recentVideoLimit} requested.`,
      });
    }

    const thumbnail =
      rawChannel.snippet.thumbnails.maxres ??
      rawChannel.snippet.thumbnails.standard ??
      rawChannel.snippet.thumbnails.high ??
      rawChannel.snippet.thumbnails.medium ??
      rawChannel.snippet.thumbnails.default;
    const handle = rawChannel.snippet.customUrl?.startsWith("@")
      ? rawChannel.snippet.customUrl
      : null;

    return {
      input: { value: rawInput.trim(), resolvedVia: reference.resolvedVia },
      channel: {
        id: rawChannel.id,
        url: `https://www.youtube.com/channel/${encodeURIComponent(rawChannel.id)}`,
        title: rawChannel.snippet.title.trim(),
        handle,
        description: rawChannel.snippet.description.trim(),
        country:
          rawChannel.snippet.country?.toUpperCase() ??
          rawChannel.brandingSettings?.channel?.country?.toUpperCase() ??
          null,
        publishedAt: new Date(rawChannel.snippet.publishedAt).toISOString(),
        thumbnailUrl: thumbnail?.url ?? null,
        subscribers,
        subscribersHidden: rawChannel.statistics.hiddenSubscriberCount,
        totalViews,
        totalVideos,
        topics: (rawChannel.topicDetails?.topicCategories ?? []).map(topicName),
        keywords: splitKeywords(rawChannel.brandingSettings?.channel?.keywords),
      },
      recentContent,
      warnings,
    };
  }
}
