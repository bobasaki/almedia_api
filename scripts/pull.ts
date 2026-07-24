import { writeFile } from "node:fs/promises";
import process from "node:process";

import {
  AlmediaApiError,
  fetchAllCampaigns,
  type AlmediaCampaign,
} from "../src/almedia/agency-data";

/**
 * Throwaway CLI to smoke-test the client against the live API once a real key
 * is available. This file does NOT get ported into scouting-platform.
 *
 *   pnpm pull                       # JSON to stdout
 *   pnpm pull -- --format csv       # CSV to stdout
 *   pnpm pull -- --out data.csv --format csv
 *   pnpm pull -- --limit 200
 */

interface CliOptions {
  format: "json" | "csv";
  out?: string;
  limit?: number;
  baseUrl?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { format: "json" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--":
        // pnpm may forward the conventional argument separator to the script.
        break;
      case "--format":
        if (next !== "json" && next !== "csv") {
          throw new Error('--format must be "json" or "csv"');
        }
        options.format = next;
        i += 1;
        break;
      case "--out":
        if (!next) throw new Error("--out requires a file path");
        options.out = next;
        i += 1;
        break;
      case "--limit":
        if (!next) throw new Error("--limit requires a number");
        options.limit = Number(next);
        i += 1;
        break;
      case "--base-url":
        if (!next) throw new Error("--base-url requires a URL");
        options.baseUrl = next;
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

const CSV_COLUMNS: Array<keyof AlmediaCampaign> = [
  "campaignName",
  "campaignSource",
  "platform",
  "country",
  "publishedAt",
  "cost",
  "expectedCpm",
  "viewCount",
  "signupsPct",
  "roasD7pD14",
  "roasReturn",
  "returnPct",
  "appuD14",
  "d7Purchases",
];

function csvCell(value: AlmediaCampaign[keyof AlmediaCampaign]): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function toCsv(campaigns: AlmediaCampaign[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = campaigns.map((campaign) =>
    CSV_COLUMNS.map((column) => csvCell(campaign[column])).join(","),
  );
  return [header, ...rows].join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const apiKey = process.env.ALMEDIA_API_KEY;
  if (!apiKey) {
    console.error(
      "ALMEDIA_API_KEY is not set. Copy .env.example to .env and add your chak_ key,\n" +
        "or export ALMEDIA_API_KEY before running `pnpm pull`.",
    );
    process.exitCode = 1;
    return;
  }

  const result = await fetchAllCampaigns({
    apiKey,
    ...(options.baseUrl ?? process.env.ALMEDIA_BASE_URL
      ? { baseUrl: options.baseUrl ?? process.env.ALMEDIA_BASE_URL }
      : {}),
    ...(options.limit ? { limit: options.limit } : {}),
  });

  console.error(
    `Fetched ${result.campaigns.length} campaigns for ${result.agency} across ${result.pages} page(s).`,
  );

  const output =
    options.format === "csv"
      ? toCsv(result.campaigns)
      : JSON.stringify(
          { agency: result.agency, count: result.campaigns.length, campaigns: result.campaigns },
          null,
          2,
        );

  if (options.out) {
    await writeFile(options.out, output, "utf8");
    console.error(`Wrote ${options.out}`);
  } else {
    process.stdout.write(`${output}\n`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof AlmediaApiError) {
    console.error(`[${error.code}] ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  process.exitCode = 1;
});
