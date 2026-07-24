import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

import { seedTargets, type TargetsFile } from "../src/bookings/seed";
import { BookingsStore } from "../src/bookings/store";

/**
 * Seed (or re-seed) plan targets into the bookings database from the
 * migrated tracker output. The dashboard server also does this automatically
 * on first run; use this CLI to re-apply after a fresh `pnpm migrate:sheet`.
 *
 *   pnpm bookings:seed
 *   pnpm bookings:seed -- --file data/migration/targets.json --db data/bookings.db --year 2026
 */

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main(): Promise<void> {
  const projectRoot = resolve(import.meta.dirname, "..");
  const filePath = resolve(projectRoot, argValue("file", "data/migration/targets.json"));
  const dbPath = resolve(projectRoot, argValue("db", "data/bookings.db"));
  const year = Number(argValue("year", "2026"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new Error(`--year must be a calendar year, got "${argValue("year", "2026")}"`);
  }

  const file = JSON.parse(await readFile(filePath, "utf-8")) as TargetsFile;
  if (!Array.isArray(file.targets)) {
    throw new Error(`${filePath} does not look like migrate-sheet targets output`);
  }

  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new BookingsStore(dbPath);
  try {
    const summary = seedTargets(store, file, year);
    console.error(
      `Seeded ${summary.targets} plan targets and ${summary.revenueTargets} revenue targets into ${dbPath}`,
    );
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
