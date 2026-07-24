import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { fetchAllCampaigns } from "../src/almedia/agency-data";
import { BookingsStore } from "../src/bookings/store";
import {
  createRuntimeChannelEnrichmentService,
  runAlmediaChannelEnrichment,
} from "../src/enrichment/index";

interface CliOptions {
  input?: string;
  recentVideoLimit: number;
  refreshAfterHours: number;
  concurrency: number;
  limit?: number;
  disableAi: boolean;
  help: boolean;
}

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function positiveNumber(value: string, flag: string, maximum?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || (maximum !== undefined && parsed > maximum)) {
    throw new Error(
      `${flag} must be a positive number${maximum === undefined ? "" : ` no greater than ${maximum}`}.`,
    );
  }
  return parsed;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    recentVideoLimit: 20,
    refreshAfterHours: 168,
    concurrency: 2,
    disableAi: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--force") options.refreshAfterHours = 0;
    else if (arg === "--no-ai") options.disableAi = true;
    else if (arg === "--input") {
      options.input = valueAfter(args, index, arg);
      index += 1;
    } else if (arg === "--recent-videos") {
      options.recentVideoLimit = positiveNumber(valueAfter(args, index, arg), arg, 50);
      index += 1;
    } else if (arg === "--refresh-hours") {
      options.refreshAfterHours = positiveNumber(valueAfter(args, index, arg), arg);
      index += 1;
    } else if (arg === "--concurrency") {
      options.concurrency = positiveNumber(valueAfter(args, index, arg), arg, 10);
      index += 1;
    } else if (arg === "--limit") {
      options.limit = positiveNumber(valueAfter(args, index, arg), arg);
      index += 1;
    } else {
      throw new Error(`Unknown option "${arg}". Run with --help for usage.`);
    }
  }
  return options;
}

function usage(): string {
  return `Enrich YouTube creators and persist versioned results in the bookings database.

Usage:
  pnpm enrich:channels -- --input <youtube-url-or-channel-id>
  pnpm enrich:channels

Without --input, distinct YouTube creators are collected from the Almedia API,
matched to local bookings, enriched, and linked back to their campaign records.

Options:
  --input <value>          Enrich one channel ID, handle, channel URL, or video URL
  --recent-videos <1-50>  Recent uploads to analyze (default: 20)
  --refresh-hours <n>      Reuse results newer than n hours (default: 168)
  --force                  Ignore cached enrichments
  --concurrency <1-10>     Channels processed in parallel (default: 2)
  --limit <n>              Limit channels in an Almedia batch
  --no-ai                  Use deterministic metadata analysis only
  --help                   Show this message`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const projectRoot = resolve(import.meta.dirname, "..");
  const dataDir = join(projectRoot, "data");
  mkdirSync(dataDir, { recursive: true });
  const store = new BookingsStore(process.env.BOOKINGS_DB_PATH ?? join(dataDir, "bookings.db"));
  try {
    const service = createRuntimeChannelEnrichmentService({ disableAi: options.disableAi });
    if (options.input) {
      const result = await service.enrich({
        input: options.input,
        recentVideoLimit: options.recentVideoLimit,
      });
      store.upsertChannelEnrichment(result, [
        { sourceType: "manual", sourceKey: options.input },
      ]);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const almediaApiKey = process.env.ALMEDIA_API_KEY?.trim();
    if (!almediaApiKey) {
      throw new Error("ALMEDIA_API_KEY is required for batch enrichment from Almedia.");
    }
    const baseUrl = process.env.ALMEDIA_BASE_URL?.trim();
    const almedia = await fetchAllCampaigns({
      apiKey: almediaApiKey,
      ...(baseUrl ? { baseUrl } : {}),
    });
    const summary = await runAlmediaChannelEnrichment({
      campaigns: almedia.campaigns,
      bookings: store.listBookings(),
      service,
      persistence: store,
      recentVideoLimit: options.recentVideoLimit,
      refreshAfterHours: options.refreshAfterHours,
      concurrency: options.concurrency,
      limit: options.limit,
      onProgress: (message) => console.error(message),
    });
    console.log(JSON.stringify({ agency: almedia.agency, ...summary }, null, 2));
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
