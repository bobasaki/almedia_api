import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import process from "node:process";

import { createServer as createViteServer, type ViteDevServer } from "vite";

import {
  AlmediaApiError,
  fetchAllCampaigns,
  type AlmediaCampaign,
} from "../src/almedia/agency-data";
import { seedTargets, type TargetsFile } from "../src/bookings/seed";
import { BookingsStore } from "../src/bookings/store";
import { findCampaignEnrichment } from "../src/enrichment/lookup";
import type { ChannelEnrichmentResult } from "../src/enrichment/types";
import { handleAiApi } from "./ai-api";
import { handleBookingsApi } from "./bookings-api";
import { handleEnrichmentApi } from "./enrichment-api";
import { handleInvoicesApi } from "./invoices-api";
import { handleLayoutApi } from "./layout-api";

const HOST = "127.0.0.1";
const PORT = Number(process.env.DASHBOARD_PORT ?? process.env.PORT ?? 4173);
const CACHE_TTL_MS = 60 * 60 * 1000;
const dashboardRoot = resolve(import.meta.dirname);
const productionRoot = resolve(import.meta.dirname, "../dist/dashboard");
const projectRoot = resolve(import.meta.dirname, "..");
const isProduction = process.argv.includes("--production");

/** Open the bookings database, seeding plan targets on first run. */
async function openBookingsStore(): Promise<BookingsStore> {
  const dataDir = join(projectRoot, "data");
  mkdirSync(dataDir, { recursive: true });
  const store = new BookingsStore(process.env.BOOKINGS_DB_PATH ?? join(dataDir, "bookings.db"));

  const targetsPath = join(dataDir, "migration", "targets.json");
  if (store.countTargets() === 0 && existsSync(targetsPath)) {
    const file = JSON.parse(await readFile(targetsPath, "utf-8")) as TargetsFile;
    // The migrated Plan tab is the Q3 2026 plan; month names map onto 2026.
    const summary = seedTargets(store, file, 2026);
    console.log(
      `Seeded ${summary.targets} plan targets and ${summary.revenueTargets} revenue targets from data/migration/targets.json`,
    );
  }
  return store;
}

interface CampaignPayload {
  agency: string;
  count: number;
  campaigns: AlmediaCampaign[];
  fetchedAt: string;
  refreshAfter: string;
}

interface CachedPayload {
  value: CampaignPayload;
  expiresAt: number;
}

let cache: CachedPayload | undefined;
let inFlight: Promise<CampaignPayload> | undefined;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function loadCampaigns(forceRefresh: boolean): Promise<CampaignPayload> {
  const now = Date.now();
  if (!forceRefresh && cache && cache.expiresAt > now) {
    return cache.value;
  }
  if (inFlight) {
    return inFlight;
  }

  const apiKey = process.env.ALMEDIA_API_KEY;
  if (!apiKey) {
    throw new Error("ALMEDIA_API_KEY is not set in .env");
  }

  inFlight = fetchAllCampaigns({ apiKey }).then((result) => {
    const value = {
      agency: result.agency,
      count: result.campaigns.length,
      campaigns: result.campaigns,
      fetchedAt: new Date().toISOString(),
      refreshAfter: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
    };
    cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  });

  try {
    return await inFlight;
  } finally {
    inFlight = undefined;
  }
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  store: BookingsStore,
): Promise<boolean> {
  if (url.pathname !== "/api/campaigns") {
    return false;
  }
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  try {
    const payload = await loadCampaigns(url.searchParams.get("refresh") === "1");
    const campaigns = payload.campaigns.map((campaign) => {
      const stored = findCampaignEnrichment(store, campaign.campaignName);
      const enrichment = stored
        ? ({
            channel: stored.result.channel,
            metrics: stored.result.metrics,
            classification: stored.result.classification,
            summary: stored.result.summary,
            confidence: stored.result.confidence,
            warnings: stored.result.warnings,
            meta: stored.result.meta,
          } satisfies Omit<ChannelEnrichmentResult, "schemaVersion" | "input" | "recentContent">)
        : null;
      return { ...campaign, enrichment };
    });
    sendJson(response, 200, { ...payload, campaigns });
  } catch (error) {
    const status = error instanceof AlmediaApiError && error.status ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unable to load campaign data";
    sendJson(response, status, { error: message });
  }
  return true;
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function serveProductionFile(requestPath: string, response: ServerResponse): Promise<void> {
  const decodedPath = decodeURIComponent(requestPath);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const candidate = normalize(join(productionRoot, relativePath));
  const safeCandidate = candidate === productionRoot || candidate.startsWith(`${productionRoot}/`)
    ? candidate
    : join(productionRoot, "index.html");

  try {
    await access(safeCandidate);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(safeCandidate)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(safeCandidate).pipe(response);
  } catch {
    const index = await readFile(join(productionRoot, "index.html"));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(index);
  }
}

async function start(): Promise<void> {
  const bookingsStore = await openBookingsStore();
  let vite: ViteDevServer | undefined;
  if (!isProduction) {
    vite = await createViteServer({
      root: dashboardRoot,
      configFile: resolve(dashboardRoot, "vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? HOST}`);
    if (await handleApi(request, response, url, bookingsStore)) {
      return;
    }
    if (await handleBookingsApi(request, response, url, bookingsStore)) {
      return;
    }
    if (await handleLayoutApi(request, response, url, bookingsStore)) {
      return;
    }
    if (await handleInvoicesApi(request, response, url, bookingsStore)) {
      return;
    }
    if (await handleEnrichmentApi(request, response, url, bookingsStore)) {
      return;
    }
    if (await handleAiApi(request, response, url)) {
      return;
    }
    if (vite) {
      vite.middlewares(request, response);
      return;
    }
    await serveProductionFile(url.pathname, response);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Almedia dashboard: http://${HOST}:${PORT}`);
  });
}

start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
