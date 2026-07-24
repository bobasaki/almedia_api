import type { PlanTarget, RevenueTarget } from "../migration/types";
import type { BookingsStore } from "./store";

/**
 * Seed plan targets from the migrated `data/migration/targets.json`.
 *
 * The Plan Q3 tab uses bare month names; the tracker is the Q3 2026 plan, so
 * they map onto one calendar year (override per seed run if that changes).
 */

const MONTH_NUMBERS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export function monthNameToIso(name: string, year: number): string {
  const monthNumber = MONTH_NUMBERS[name.trim().toLowerCase()];
  if (!monthNumber) throw new Error(`Unknown month name: "${name}"`);
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

export interface TargetsFile {
  targets: PlanTarget[];
  revenueTargets: RevenueTarget[];
}

export interface SeedSummary {
  targets: number;
  revenueTargets: number;
}

export function seedTargets(store: BookingsStore, file: TargetsFile, year: number): SeedSummary {
  for (const target of file.targets) {
    store.upsertTarget({
      cm: target.cm,
      market: target.market,
      month: monthNameToIso(target.month, year),
      budgetEur: target.budgetEur,
      tierCounts: target.tierCounts,
    });
  }
  for (const revenue of file.revenueTargets) {
    store.upsertRevenueTarget({
      month: monthNameToIso(revenue.month, year),
      totalEur: revenue.totalEur,
    });
  }
  return { targets: file.targets.length, revenueTargets: file.revenueTargets.length };
}
