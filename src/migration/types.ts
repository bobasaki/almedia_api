/**
 * Types for the one-time migration of the "[INT] Freecash x ARCH." tracker
 * workbook into a clean, database-ready shape.
 *
 * A `CellMatrix` is a sheet as raw rows of cell values — the xlsx I/O lives
 * only in `scripts/migrate-sheet.ts`, so every parser here is pure and
 * testable with inline fixtures.
 */

export type CellValue = string | number | boolean | Date | null | undefined;
export type CellMatrix = CellValue[][];

/** One booked (or historical) influencer deal from Campaigns/Legacy tabs. */
export interface SheetBooking {
  channelName: string;
  channelKey: string;
  channelUrl: string | null;
  country: string | null;
  status: string | null;
  cm: string | null;
  platform: string | null;
  activation: string | null;
  numActivations: number | null;
  contractUrl: string | null;
  contractSigned: boolean;
  publishedAt: string | null;
  intBudget: number | null;
  extBudget: number | null;
  currency: string | null;
  note: string | null;
  videoUrl: string | null;
  month: string | null;
  sourceSheet: string;
  sourceRow: number;
}

/** One CM × market × month target from the Plan Q3 tab. */
export interface PlanTarget {
  cm: string;
  market: string;
  month: string;
  budgetEur: number;
  tierCounts: {
    under10k: number;
    from10kTo20k: number;
    from20kTo50k: number;
    over50k: number;
  };
}

/** Company-level revenue target for one month (Plan Q3 bottom row). */
export interface RevenueTarget {
  month: string;
  totalEur: number;
}

/** One scouting/pipeline entry from a country tab (e.g. "IT - Miro"). */
export interface PipelineEntry {
  name: string;
  channelKey: string;
  cm: string | null;
  context: string | null;
  channelUrl: string | null;
  platform: string | null;
  activation: string | null;
  numActivations: number | null;
  rate: string | null;
  counteroffer: string | null;
  finalPrice: number | null;
  currency: string | null;
  comment: string | null;
  month: string | null;
  failed: boolean;
  sourceSheet: string;
  sourceRow: number;
}

/** One long-term activation row from the Longterm tab. */
export interface LongtermActivation {
  name: string;
  channelKey: string;
  channelUrl: string | null;
  country: string | null;
  numActivations: number | null;
  intPriceTotal: number | null;
  extPriceTotal: number | null;
  videosLive: string | null;
  cm: string | null;
  month: string | null;
  sourceRow: number;
}

export interface WorkbookParseResult {
  bookings: SheetBooking[];
  targets: PlanTarget[];
  revenueTargets: RevenueTarget[];
  pipeline: PipelineEntry[];
  longterm: LongtermActivation[];
  /** Sheets that were present but intentionally not parsed. */
  skippedSheets: string[];
}
