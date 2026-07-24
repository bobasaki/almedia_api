import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import type { BookingsStore } from "../src/bookings/store";
import { createRuntimeChannelEnrichmentService } from "../src/enrichment/runtime";
import type { ChannelEnrichmentService } from "../src/enrichment/types";
import { YouTubeApiError } from "../src/enrichment/youtube-adapter";

const MAX_BODY_BYTES = 64 * 1024;
const linkSchema = z.object({
  sourceType: z.enum(["campaign", "channel_key", "booking", "manual"]),
  sourceKey: z.string().trim().min(1).max(500),
});
const requestSchema = z.object({
  input: z.string().trim().min(1).max(2000),
  recentVideoLimit: z.number().int().min(1).max(50).default(20),
  links: z.array(linkSchema).max(1000).default([]),
});

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text) throw new Error("Request body is empty");
  return JSON.parse(text) as unknown;
}

function youtubeStatus(error: YouTubeApiError): number {
  if (error.code === "YOUTUBE_NOT_FOUND") return 404;
  if (error.code === "YOUTUBE_RATE_LIMITED") return 429;
  if (error.code === "YOUTUBE_API_KEY_MISSING") return 503;
  return 502;
}

/** REST boundary for manual enrichment and persisted result reads. */
export async function handleEnrichmentApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  store: BookingsStore,
  getService: () => ChannelEnrichmentService = createRuntimeChannelEnrichmentService,
): Promise<boolean> {
  const itemMatch = /^\/api\/enrichments\/([^/]+)$/.exec(url.pathname);
  const isCollection = url.pathname === "/api/enrichments";
  if (!itemMatch && !isCollection) return false;

  try {
    if (itemMatch) {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed" });
        return true;
      }
      const channelId = decodeURIComponent(itemMatch[1]!);
      const enrichment = store.getChannelEnrichment(channelId);
      if (!enrichment) {
        sendJson(response, 404, { error: `Enrichment for channel ${channelId} not found` });
      } else {
        sendJson(response, 200, { enrichment });
      }
      return true;
    }

    if (request.method === "GET") {
      const sourceType = url.searchParams.get("sourceType");
      const sourceKey = url.searchParams.get("sourceKey");
      if (sourceType !== null || sourceKey !== null) {
        const parsedSourceType = linkSchema.shape.sourceType.safeParse(sourceType);
        if (!parsedSourceType.success || !sourceKey) {
          sendJson(response, 400, {
            error: "sourceType and sourceKey must both be provided, with a supported sourceType",
          });
          return true;
        }
        const enrichment = store.findChannelEnrichment(
          parsedSourceType.data,
          sourceKey,
        );
        sendJson(response, 200, { enrichments: enrichment ? [enrichment] : [] });
      } else {
        sendJson(response, 200, { enrichments: store.listChannelEnrichments() });
      }
      return true;
    }
    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }

    const parsed = requestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      sendJson(response, 400, {
        error: parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
          .join("; "),
      });
      return true;
    }
    const result = await getService().enrich({
      input: parsed.data.input,
      recentVideoLimit: parsed.data.recentVideoLimit,
    });
    const enrichment = store.upsertChannelEnrichment(result, [
      { sourceType: "manual", sourceKey: parsed.data.input },
      ...parsed.data.links,
    ]);
    sendJson(response, 201, { enrichment });
  } catch (error) {
    const status =
      error instanceof YouTubeApiError
        ? youtubeStatus(error)
        : error instanceof SyntaxError || (error instanceof Error && /body/i.test(error.message))
          ? 400
          : 500;
    sendJson(response, status, {
      error: status === 500 ? "Channel enrichment failed" : error instanceof Error ? error.message : "Request failed",
    });
    if (status === 500) console.error("enrichment-api:", error);
  }
  return true;
}
