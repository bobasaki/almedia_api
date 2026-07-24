import type { BookingStatus } from "../../../src/bookings/types";

/** Shared display formatting for the bookings and scorecard views. */

const monthFormatter = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });
const eurFormatter = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const compactEur = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pipeline: "Pipeline",
  booked: "Booked",
  published: "Published",
  longterm: "Longterm",
  dropped: "Dropped",
};

/** "2026-08" → "Aug 2026". */
export function formatMonth(isoMonth: string | null): string {
  if (!isoMonth) return "—";
  const date = new Date(`${isoMonth}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? isoMonth : monthFormatter.format(date);
}

export function formatEur(value: number | null): string {
  return value === null ? "—" : `€${eurFormatter.format(value)}`;
}

export function formatEurCompact(value: number | null): string {
  return value === null ? "—" : `€${compactEur.format(value)}`;
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

/** Current month as ISO YYYY-MM (UTC). */
export function currentIsoMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
