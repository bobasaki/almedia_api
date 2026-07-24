import type { Booking, BookingStatus, MonthlyRevenueTarget, Target } from "./types";

/**
 * Scorecard: booked vs plan-target budget per CM x market x month, plus
 * company-level monthly totals. Pure functions — inject `now` for pace.
 *
 * A booking counts toward "booked" once it is committed (booked, published,
 * or longterm). Pipeline entries are shown but not counted; dropped entries
 * feed the dropout rate: dropped / (dropped + committed).
 */

const COMMITTED_STATUSES: ReadonlySet<BookingStatus> = new Set(["booked", "published", "longterm"]);

export interface TierCounts {
  under10k: number;
  from10kTo20k: number;
  from20kTo50k: number;
  over50k: number;
}

export type StatusCounts = Record<BookingStatus, number>;

export interface ScorecardRow {
  cm: string | null;
  market: string | null;
  /** ISO YYYY-MM. */
  month: string;
  targetEur: number | null;
  targetTiers: TierCounts | null;
  bookedEur: number;
  bookedTiers: TierCounts;
  counts: StatusCounts;
  /** bookedEur / targetEur, null without a target. */
  utilization: number | null;
  /** utilization vs elapsed share of the month; only for the current month. */
  pace: number | null;
  dropoutRate: number | null;
}

export interface ScorecardMonth {
  month: string;
  targetEur: number | null;
  bookedEur: number;
  counts: StatusCounts;
  utilization: number | null;
  pace: number | null;
  dropoutRate: number | null;
}

export interface Scorecard {
  months: ScorecardMonth[];
  rows: ScorecardRow[];
  /** Bookings without a target month — not represented in any row. */
  unscheduledCount: number;
}

function emptyStatusCounts(): StatusCounts {
  return { pipeline: 0, booked: 0, published: 0, longterm: 0, dropped: 0 };
}

function emptyTierCounts(): TierCounts {
  return { under10k: 0, from10kTo20k: 0, from20kTo50k: 0, over50k: 0 };
}

function tierOf(intBudget: number): keyof TierCounts {
  if (intBudget < 10_000) return "under10k";
  if (intBudget < 20_000) return "from10kTo20k";
  if (intBudget < 50_000) return "from20kTo50k";
  return "over50k";
}

/** ISO month (YYYY-MM) containing `now`, in UTC. */
export function isoMonthOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** Share of the month elapsed at `now`, 0..1, in UTC. */
export function monthElapsedFraction(now: Date): number {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const monthStart = Date.UTC(year, month, 1);
  const nextMonthStart = Date.UTC(year, month + 1, 1);
  return (now.getTime() - monthStart) / (nextMonthStart - monthStart);
}

function ratio(numerator: number, denominator: number | null): number | null {
  return denominator === null || denominator <= 0 ? null : numerator / denominator;
}

function dropoutRate(counts: StatusCounts): number | null {
  const committed = counts.booked + counts.published + counts.longterm;
  return ratio(counts.dropped, counts.dropped + committed);
}

function pace(utilization: number | null, month: string, now: Date): number | null {
  if (utilization === null || month !== isoMonthOf(now)) return null;
  const elapsed = monthElapsedFraction(now);
  return elapsed > 0 ? utilization / elapsed : null;
}

// CM names contain spaces, so join group keys on a control character.
const KEY_SEPARATOR = "\u001F";

function groupKey(cm: string | null, market: string | null, month: string): string {
  return [cm ?? "", market ?? "", month].join(KEY_SEPARATOR);
}

interface Accumulator {
  bookedEur: number;
  bookedTiers: TierCounts;
  counts: StatusCounts;
}

function accumulate(bookings: readonly Booking[]): Map<string, Accumulator> {
  const groups = new Map<string, Accumulator>();
  for (const booking of bookings) {
    if (!booking.month) continue;
    const key = groupKey(booking.cm, booking.country, booking.month);
    const group = groups.get(key) ?? {
      bookedEur: 0,
      bookedTiers: emptyTierCounts(),
      counts: emptyStatusCounts(),
    };
    group.counts[booking.status] += 1;
    if (COMMITTED_STATUSES.has(booking.status)) {
      group.bookedEur += booking.intBudget ?? 0;
      if (booking.intBudget !== null) group.bookedTiers[tierOf(booking.intBudget)] += 1;
    }
    groups.set(key, group);
  }
  return groups;
}

/** Build the scorecard from bookings, plan targets, and revenue targets. */
export function buildScorecard(
  bookings: readonly Booking[],
  targets: readonly Target[],
  revenueTargets: readonly MonthlyRevenueTarget[],
  now: Date,
): Scorecard {
  const groups = accumulate(bookings);
  const rows: ScorecardRow[] = [];
  const seenKeys = new Set<string>();

  for (const target of targets) {
    const key = groupKey(target.cm, target.market, target.month);
    seenKeys.add(key);
    const group = groups.get(key);
    const bookedEur = group?.bookedEur ?? 0;
    const counts = group?.counts ?? emptyStatusCounts();
    const utilization = ratio(bookedEur, target.budgetEur);
    rows.push({
      cm: target.cm,
      market: target.market,
      month: target.month,
      targetEur: target.budgetEur,
      targetTiers: target.tierCounts,
      bookedEur,
      bookedTiers: group?.bookedTiers ?? emptyTierCounts(),
      counts,
      utilization,
      pace: pace(utilization, target.month, now),
      dropoutRate: dropoutRate(counts),
    });
  }

  // Bookings whose CM/market/month has no plan target still surface as rows.
  for (const [key, group] of groups) {
    if (seenKeys.has(key)) continue;
    const [cm, market, month] = key.split(KEY_SEPARATOR);
    rows.push({
      cm: cm || null,
      market: market || null,
      month,
      targetEur: null,
      targetTiers: null,
      bookedEur: group.bookedEur,
      bookedTiers: group.bookedTiers,
      counts: group.counts,
      utilization: null,
      pace: null,
      dropoutRate: dropoutRate(group.counts),
    });
  }

  rows.sort(
    (a, b) =>
      a.month.localeCompare(b.month) ||
      (a.cm ?? "").localeCompare(b.cm ?? "") ||
      (a.market ?? "").localeCompare(b.market ?? ""),
  );

  const monthKeys = [
    ...new Set([...rows.map((row) => row.month), ...revenueTargets.map((t) => t.month)]),
  ].sort();
  const revenueByMonth = new Map(revenueTargets.map((t) => [t.month, t.totalEur]));

  const months: ScorecardMonth[] = monthKeys.map((month) => {
    const monthRows = rows.filter((row) => row.month === month);
    const bookedEur = monthRows.reduce((total, row) => total + row.bookedEur, 0);
    const counts = monthRows.reduce((total, row) => {
      for (const status of Object.keys(total) as BookingStatus[]) total[status] += row.counts[status];
      return total;
    }, emptyStatusCounts());
    const targetEur =
      revenueByMonth.get(month) ??
      (monthRows.some((row) => row.targetEur !== null)
        ? monthRows.reduce((total, row) => total + (row.targetEur ?? 0), 0)
        : null);
    const utilization = ratio(bookedEur, targetEur);
    return {
      month,
      targetEur,
      bookedEur,
      counts,
      utilization,
      pace: pace(utilization, month, now),
      dropoutRate: dropoutRate(counts),
    };
  });

  return {
    months,
    rows,
    unscheduledCount: bookings.filter((booking) => !booking.month).length,
  };
}
