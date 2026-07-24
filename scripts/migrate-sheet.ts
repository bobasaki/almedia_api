import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import * as XLSX from "xlsx";

import { joinChannelsToCampaigns } from "../src/migration/join-campaigns";
import { parseWorkbook } from "../src/migration/parse-workbook";
import type { CellMatrix } from "../src/migration/types";

/**
 * One-time migration CLI: parses the "[INT] Freecash x ARCH." tracker
 * workbook into clean JSON, ready to seed a database.
 *
 *   pnpm migrate:sheet -- --file "~/Downloads/[INT] Freecash x ARCH. - Prod v2 (2).xlsx"
 *   pnpm migrate:sheet -- --file tracker.xlsx --campaigns campaigns.json --out data/migration
 *
 * Outputs (to --out, default data/migration/):
 *   bookings.json        deals from Campaigns + Dropouts + Legacy tabs
 *   targets.json         Plan Q3 targets per CM x market x month (+ revenue)
 *   pipeline.json        scouting entries from country tabs
 *   longterm.json        Longterm tab activations
 *   join-report.json     sheet channels matched to API campaign names
 */

interface CliOptions {
  file: string;
  out: string;
  campaigns?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = { out: "data/migration" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--":
        break;
      case "--file":
        if (!next) throw new Error("--file requires an xlsx path");
        options.file = next;
        i += 1;
        break;
      case "--out":
        if (!next) throw new Error("--out requires a directory");
        options.out = next;
        i += 1;
        break;
      case "--campaigns":
        if (!next) throw new Error("--campaigns requires a JSON path (pnpm pull output)");
        options.campaigns = next;
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.file) throw new Error("--file <tracker.xlsx> is required");
  return options as CliOptions;
}

async function workbookToMatrices(filePath: string): Promise<Record<string, CellMatrix>> {
  // XLSX.read on a buffer — the ESM build has no fs bindings for readFile.
  const workbook = XLSX.read(await readFile(filePath), { cellDates: true });
  const sheets: Record<string, CellMatrix> = {};
  for (const name of workbook.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json<CellMatrix[number]>(workbook.Sheets[name], {
      header: 1,
      raw: true,
      defval: null,
    });
  }
  return sheets;
}

async function loadCampaignNames(filePath: string): Promise<string[]> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { campaigns?: unknown }).campaigns)
  ) {
    throw new Error(`${filePath} does not look like pnpm pull output ({ campaigns: [...] })`);
  }
  return (parsed as { campaigns: Array<{ campaignName?: unknown }> }).campaigns
    .map((campaign) => campaign.campaignName)
    .filter((name): name is string => typeof name === "string");
}

async function writeJson(dir: string, name: string, data: unknown): Promise<void> {
  const path = join(dir, name);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.error(`Wrote ${path}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const sheets = await workbookToMatrices(options.file);
  const result = parseWorkbook(sheets);

  await mkdir(options.out, { recursive: true });
  await writeJson(options.out, "bookings.json", result.bookings);
  await writeJson(options.out, "targets.json", {
    targets: result.targets,
    revenueTargets: result.revenueTargets,
  });
  await writeJson(options.out, "pipeline.json", result.pipeline);
  await writeJson(options.out, "longterm.json", result.longterm);

  console.error(
    `\nParsed: ${result.bookings.length} bookings, ${result.targets.length} targets, ` +
      `${result.pipeline.length} pipeline entries, ${result.longterm.length} longterm rows.`,
  );
  if (result.skippedSheets.length) {
    console.error(`Skipped sheets: ${result.skippedSheets.join(", ")}`);
  }

  if (options.campaigns) {
    const campaignNames = await loadCampaignNames(options.campaigns);
    const channelKeys = result.bookings.map((booking) => booking.channelKey);
    const report = joinChannelsToCampaigns(channelKeys, campaignNames);
    await writeJson(options.out, "join-report.json", report);
    const { stats } = report;
    console.error(
      `\nJoin vs API: ${stats.matchedCampaigns}/${stats.campaigns} campaigns matched ` +
        `(${Math.round((stats.matchedCampaigns / Math.max(stats.campaigns, 1)) * 100)}%), ` +
        `${stats.matchedChannels}/${stats.channels} sheet channels matched.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
