import { z } from "zod";

/**
 * Client for the Almedia Agency Data API (read-only campaign performance feed).
 *
 * Written to the scouting-platform `backend/packages/integrations` convention:
 * a Zod-validated input object with an injectable `fetchFn`, a typed error-code
 * union, Zod-validated responses, and snake_case -> camelCase normalization.
 * This file is intended to drop into `integrations/src/almedia/` unchanged.
 */

const DEFAULT_BASE_URL = "https://api.almedia.tools";
const AGENCY_DATA_PATH = "/v1/agency-data-api";
const API_KEY_PREFIX = "chak_";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const DEFAULT_OFFSET = 0;

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_MAX_PAGES = 1000;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 30_000;

type FetchLike = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

export const ALMEDIA_PLATFORMS = ["youtube", "instagram", "tiktok"] as const;
export type AlmediaKnownPlatform = (typeof ALMEDIA_PLATFORMS)[number];
// Accept new platforms without failing validation, while keeping autocomplete.
export type AlmediaPlatform = AlmediaKnownPlatform | (string & {});

export type AlmediaErrorCode =
  | "ALMEDIA_API_KEY_MISSING"
  | "ALMEDIA_API_KEY_INVALID_FORMAT"
  | "ALMEDIA_AUTH_FAILED"
  | "ALMEDIA_RATE_LIMITED"
  | "ALMEDIA_SERVER_ERROR"
  | "ALMEDIA_INVALID_RESPONSE"
  | "ALMEDIA_REQUEST_FAILED";

export interface AlmediaApiErrorOptions {
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

export class AlmediaApiError extends Error {
  readonly code: AlmediaErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    code: AlmediaErrorCode,
    message: string,
    options: AlmediaApiErrorOptions = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AlmediaApiError";
    this.code = code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export const agencyDataInputSchema = z.object({
  apiKey: z.string().trim().min(1),
  baseUrl: z.string().trim().url().default(DEFAULT_BASE_URL),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(DEFAULT_OFFSET),
  maxRetries: z.number().int().min(0).default(DEFAULT_MAX_RETRIES),
  maxPages: z.number().int().min(1).default(DEFAULT_MAX_PAGES),
  fetchFn: z.custom<FetchLike>().optional(),
  sleepFn: z.custom<SleepFn>().optional(),
});

export type AgencyDataInput = z.input<typeof agencyDataInputSchema>;

const rawCampaignSchema = z.object({
  campaign_name: z.string(),
  campaign_source: z.string(),
  platform: z.string().min(1),
  country: z.string().trim().min(1),
  published_at: z.string().nullable(),
  cost: z.number().nullable(),
  expected_cpm: z.number().nullable(),
  view_count: z.number().nullable(),
  signups_pct: z.number().nullable(),
  roas_d7p_d14: z.number().nullable(),
  roas_return: z.number().nullable(),
  return_pct: z.number().nullable(),
  appu_d14: z.number().nullable(),
  d7_purchases: z.number().nullable(),
  channel_name: z.string().nullable().default(null),
  video_url: z.string().nullable().default(null),
});

const agencyDataResponseSchema = z.object({
  agency: z.string(),
  count: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  campaigns: z.array(rawCampaignSchema),
});

/** A campaign row, normalized to camelCase with a parsed publish date. */
export interface AlmediaCampaign {
  campaignName: string;
  campaignSource: string;
  platform: AlmediaPlatform;
  country: string;
  publishedAt: Date | null;
  cost: number | null;
  expectedCpm: number | null;
  viewCount: number | null;
  signupsPct: number | null;
  roasD7pD14: number | null;
  roasReturn: number | null;
  returnPct: number | null;
  appuD14: number | null;
  d7Purchases: number | null;
  /** Human-readable creator/channel name from the platform. */
  channelName: string | null;
  /** Direct link to the published video, when available. */
  videoUrl: string | null;
}

export interface AgencyDataPage {
  agency: string;
  count: number;
  limit: number;
  offset: number;
  campaigns: AlmediaCampaign[];
}

export interface AllCampaignsResult {
  agency: string;
  campaigns: AlmediaCampaign[];
  pages: number;
}

interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  limit: number;
  offset: number;
  maxRetries: number;
  maxPages: number;
  fetchFn: FetchLike;
  sleepFn: SleepFn;
}

const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function parseDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function normalizeCampaign(raw: z.infer<typeof rawCampaignSchema>): AlmediaCampaign {
  return {
    campaignName: raw.campaign_name,
    campaignSource: raw.campaign_source,
    platform: raw.platform,
    country: raw.country.toUpperCase(),
    publishedAt: parseDate(raw.published_at),
    cost: raw.cost,
    expectedCpm: raw.expected_cpm,
    viewCount: raw.view_count,
    signupsPct: raw.signups_pct,
    roasD7pD14: raw.roas_d7p_d14,
    roasReturn: raw.roas_return,
    returnPct: raw.return_pct,
    appuD14: raw.appu_d14,
    d7Purchases: raw.d7_purchases,
    channelName: raw.channel_name?.trim() || null,
    videoUrl: raw.video_url?.trim() || null,
  };
}

function resolveConfig(input: AgencyDataInput): ResolvedConfig {
  const rawKey = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
  if (!rawKey) {
    throw new AlmediaApiError(
      "ALMEDIA_API_KEY_MISSING",
      "No Almedia API key provided. Set ALMEDIA_API_KEY or pass `apiKey`.",
    );
  }
  if (!rawKey.startsWith(API_KEY_PREFIX)) {
    throw new AlmediaApiError(
      "ALMEDIA_API_KEY_INVALID_FORMAT",
      `Almedia API key should start with "${API_KEY_PREFIX}".`,
    );
  }

  const parsed = agencyDataInputSchema.parse(input);
  const fetchFn = parsed.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new AlmediaApiError(
      "ALMEDIA_REQUEST_FAILED",
      "No fetch implementation available. Pass `fetchFn` or run on Node 18+.",
    );
  }

  return {
    apiKey: parsed.apiKey,
    baseUrl: parsed.baseUrl,
    limit: parsed.limit,
    offset: parsed.offset,
    maxRetries: parsed.maxRetries,
    maxPages: parsed.maxPages,
    fetchFn,
    sleepFn: parsed.sleepFn ?? defaultSleep,
  };
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) {
    return undefined;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return undefined;
}

function isRetryable(code: AlmediaErrorCode): boolean {
  return (
    code === "ALMEDIA_RATE_LIMITED" ||
    code === "ALMEDIA_SERVER_ERROR" ||
    code === "ALMEDIA_REQUEST_FAILED"
  );
}

function backoffDelayMs(attempt: number): number {
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function performPageRequest(
  config: ResolvedConfig,
  offset: number,
): Promise<AgencyDataPage> {
  const url = new URL(AGENCY_DATA_PATH, config.baseUrl);
  url.searchParams.set("limit", String(config.limit));
  url.searchParams.set("offset", String(offset));

  let response: Response;
  try {
    response = await config.fetchFn(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
    });
  } catch (cause) {
    throw new AlmediaApiError(
      "ALMEDIA_REQUEST_FAILED",
      `Network request to Almedia failed: ${describeError(cause)}`,
      { cause },
    );
  }

  if (response.status === 401) {
    throw new AlmediaApiError(
      "ALMEDIA_AUTH_FAILED",
      "Almedia API key is missing, invalid, or has been revoked (HTTP 401).",
      { status: 401 },
    );
  }
  if (response.status === 429) {
    throw new AlmediaApiError(
      "ALMEDIA_RATE_LIMITED",
      "Almedia rate limit exceeded (HTTP 429). Back off and retry.",
      { status: 429, retryAfterMs: parseRetryAfterMs(response.headers) },
    );
  }
  if (response.status >= 500) {
    throw new AlmediaApiError(
      "ALMEDIA_SERVER_ERROR",
      `Almedia server error (HTTP ${response.status}).`,
      { status: response.status },
    );
  }
  if (!response.ok) {
    throw new AlmediaApiError(
      "ALMEDIA_REQUEST_FAILED",
      `Unexpected Almedia response (HTTP ${response.status}).`,
      { status: response.status },
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new AlmediaApiError(
      "ALMEDIA_INVALID_RESPONSE",
      "Almedia response body was not valid JSON.",
      { cause },
    );
  }

  const parsed = agencyDataResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new AlmediaApiError(
      "ALMEDIA_INVALID_RESPONSE",
      `Almedia response did not match the expected shape: ${parsed.error.message}`,
      { cause: parsed.error },
    );
  }

  return {
    agency: parsed.data.agency,
    count: parsed.data.count,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
    campaigns: parsed.data.campaigns.map(normalizeCampaign),
  };
}

async function withRetry<T>(
  fn: () => Promise<T>,
  config: Pick<ResolvedConfig, "maxRetries" | "sleepFn">,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const canRetry =
        error instanceof AlmediaApiError &&
        isRetryable(error.code) &&
        attempt < config.maxRetries;

      if (!canRetry) {
        throw error;
      }

      const delayMs =
        (error as AlmediaApiError).retryAfterMs ?? backoffDelayMs(attempt);
      attempt += 1;
      await config.sleepFn(delayMs);
    }
  }
}

/**
 * Fetch a single page of campaigns. Retries transient failures (429/5xx/network)
 * with exponential backoff, honoring a `Retry-After` header when present.
 */
export async function fetchAgencyDataPage(
  input: AgencyDataInput,
): Promise<AgencyDataPage> {
  const config = resolveConfig(input);
  return withRetry(() => performPageRequest(config, config.offset), config);
}

/**
 * Page through every campaign, starting at offset 0 and advancing by `limit`
 * until a short/empty page is returned (per the API's paging contract).
 */
export async function fetchAllCampaigns(
  input: AgencyDataInput,
): Promise<AllCampaignsResult> {
  const config = resolveConfig(input);
  const campaigns: AlmediaCampaign[] = [];
  let agency = "";
  let offset = 0;
  let pages = 0;

  for (;;) {
    if (pages >= config.maxPages) {
      throw new AlmediaApiError(
        "ALMEDIA_REQUEST_FAILED",
        `Paging exceeded the safety cap of ${config.maxPages} pages.`,
      );
    }

    const page = await withRetry(
      () => performPageRequest(config, offset),
      config,
    );

    agency = page.agency;
    campaigns.push(...page.campaigns);
    pages += 1;

    if (page.campaigns.length < config.limit) {
      break;
    }
    offset += config.limit;
  }

  return { agency, campaigns, pages };
}
