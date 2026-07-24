import {
  cellText,
  headerIndex,
  matchMonthHeader,
  normalizeChannelKey,
  normalizeCurrency,
  parseBoolean,
  parseNumeric,
  parseSheetDate,
} from "./cell-utils";
import type {
  CellMatrix,
  CellValue,
  LongtermActivation,
  PipelineEntry,
  PlanTarget,
  RevenueTarget,
  SheetBooking,
  WorkbookParseResult,
} from "./types";

/**
 * Parsers for the "[INT] Freecash x ARCH." tracker workbook.
 *
 * Every parser locates columns by header label (not fixed index) so the v1
 * and v2 tab layouts — which differ by inserted columns — both parse.
 */

/** Tabs that hold no migratable data (dashboards, lookups, perf import). */
export const SKIPPED_SHEETS = new Set([
  "Dashboard",
  "How to use",
  "Longterm Performance",
  "FirstTimeRebooking",
  "💡 Best Performers (For) Refere",
  "values",
  "country_template",
  "database",
  "Original CSV",
]);

/** The tracker is fresh from August 2026 — pre-v2 history is not migrated. */
const LEGACY_SHEET = /^legacy/i;

const NON_DATA_LABELS = [/^channel name$/i, /^ext sheet:/i, /^colors legend/i, /^sync from ext/i];

function isNonDataLabel(text: string): boolean {
  return NON_DATA_LABELS.some((pattern) => pattern.test(text));
}

function pick(row: readonly CellValue[], columns: Map<string, number>, ...labels: string[]): CellValue {
  for (const label of labels) {
    const index = columns.get(label);
    if (index !== undefined) return row[index];
  }
  return undefined;
}

function textOrNull(value: CellValue): string | null {
  const text = cellText(value);
  return text === "" ? null : text;
}

/**
 * Parse a bookings tab: the v2 "Campaigns"/"Dropouts" layout (Status, CM,
 * Platform, Month…) and the older "Legacy Q…" layout (no Status/CM) share a
 * header row starting with "Channel Name" and use month section headers.
 */
export function parseBookingsTab(rows: CellMatrix, sheetName: string): SheetBooking[] {
  const headerRowIndex = rows.findIndex((row) => cellText(row[0]) === "Channel Name");
  if (headerRowIndex === -1) return [];
  const columns = headerIndex(rows[headerRowIndex]);

  const bookings: SheetBooking[] = [];
  let currentMonth: string | null = null;

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const first = cellText(row[0]);
    const monthHeader = matchMonthHeader(row[0]);
    if (monthHeader) {
      currentMonth = monthHeader;
      continue;
    }
    if (!first || isNonDataLabel(first)) continue;

    const explicitMonth = textOrNull(pick(row, columns, "month"));
    bookings.push({
      channelName: first,
      channelKey: normalizeChannelKey(first),
      channelUrl: textOrNull(pick(row, columns, "channel url")),
      country: textOrNull(pick(row, columns, "country")),
      status: textOrNull(pick(row, columns, "status")),
      cm: textOrNull(pick(row, columns, "cm")),
      platform: textOrNull(pick(row, columns, "platform")),
      activation: textOrNull(pick(row, columns, "activation")),
      numActivations: parseNumeric(pick(row, columns, "number of activations")),
      contractUrl: textOrNull(pick(row, columns, "contract")),
      contractSigned: parseBoolean(pick(row, columns, "contract signed", "signed")),
      publishedAt: parseSheetDate(pick(row, columns, "publication date")),
      intBudget: parseNumeric(pick(row, columns, "int budget")),
      extBudget: parseNumeric(pick(row, columns, "ext budget")),
      currency: normalizeCurrency(pick(row, columns, "currency")),
      note: textOrNull(pick(row, columns, "note")),
      videoUrl: textOrNull(pick(row, columns, "upload link")),
      month: explicitMonth ?? currentMonth,
      sourceSheet: sheetName,
      sourceRow: i + 1,
    });
  }
  return bookings;
}

/** Parse the "Plan Q3" tab: CM–market monthly budgets, tier counts, targets. */
export function parsePlanTab(rows: CellMatrix): {
  targets: PlanTarget[];
  revenueTargets: RevenueTarget[];
} {
  const monthsRow = rows[0] ?? [];
  const labelsRow = rows[1] ?? [];

  // Column layout repeats per month: Budget, <10k€, 10k€–20k€, 20k€–50k€, 50k€+
  const monthBlocks: Array<{ month: string; budgetCol: number; tierCols: number[] }> = [];
  monthsRow.forEach((cell, index) => {
    const month = matchMonthHeader(cell);
    if (!month) return;
    if (cellText(labelsRow[index]).toLowerCase() !== "budget") return;
    monthBlocks.push({ month, budgetCol: index, tierCols: [index + 1, index + 2, index + 3, index + 4] });
  });

  const targets: PlanTarget[] = [];
  const revenueTargets: RevenueTarget[] = [];

  for (let i = 2; i < rows.length; i += 1) {
    const row = rows[i];
    const label = cellText(row[0]);
    if (!label) continue;

    if (/revenue\s+q3\s+targets/i.test(label)) {
      for (const block of monthBlocks) {
        const total = parseNumeric(row[block.budgetCol]);
        if (total !== null) revenueTargets.push({ month: block.month, totalEur: total });
      }
      continue;
    }
    if (/total$/i.test(label)) continue;

    const dash = label.indexOf("-");
    if (dash === -1) continue;
    const cm = label.slice(0, dash).trim();
    const market = label.slice(dash + 1).trim();

    for (const block of monthBlocks) {
      const budget = parseNumeric(row[block.budgetCol]) ?? 0;
      const [under10k, from10kTo20k, from20kTo50k, over50k] = block.tierCols.map(
        (col) => parseNumeric(row[col]) ?? 0,
      );
      targets.push({
        cm,
        market,
        month: block.month,
        budgetEur: budget,
        tierCounts: { under10k, from10kTo20k, from20kTo50k, over50k },
      });
    }
  }
  return { targets, revenueTargets };
}

const FAILED_SECTION = /^failed\b/i;

/** Parse a country scouting tab (e.g. "IT - Miro"): month sections + FAILED. */
export function parseCountryTab(rows: CellMatrix, sheetName: string): PipelineEntry[] {
  const headerRowIndex = rows.findIndex(
    (row) => cellText(row[0]) === "Name" && cellText(row[2]) === "Context",
  );
  if (headerRowIndex === -1) return [];
  const columns = headerIndex(rows[headerRowIndex]);

  const entries: PipelineEntry[] = [];
  let currentMonth: string | null = null;
  let inFailedSection = false;

  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const first = cellText(row[0]);
    const monthHeader = matchMonthHeader(row[0]);
    if (monthHeader) {
      currentMonth = monthHeader;
      inFailedSection = false;
      continue;
    }
    if (FAILED_SECTION.test(first)) {
      inFailedSection = true;
      currentMonth = null;
      continue;
    }
    if (!first) continue;

    entries.push({
      name: first,
      channelKey: normalizeChannelKey(first),
      cm: textOrNull(pick(row, columns, "cm")),
      context: textOrNull(pick(row, columns, "context")),
      channelUrl: textOrNull(pick(row, columns, "channel url")),
      platform: textOrNull(pick(row, columns, "platform")),
      activation: textOrNull(pick(row, columns, "activation")),
      numActivations: parseNumeric(pick(row, columns, "no. of activations", "number of activations")),
      rate: textOrNull(pick(row, columns, "rate")),
      counteroffer: textOrNull(pick(row, columns, "counteroffer")),
      finalPrice: parseNumeric(pick(row, columns, "final price")),
      currency: normalizeCurrency(pick(row, columns, "currency")),
      comment: textOrNull(pick(row, columns, "arch. comment")),
      month: currentMonth,
      failed: inFailedSection,
      sourceSheet: sheetName,
      sourceRow: i + 1,
    });
  }
  return entries;
}

/** Parse the "Longterm" tab: activation rows below the "Name" header. */
export function parseLongtermTab(rows: CellMatrix): LongtermActivation[] {
  const headerRowIndex = rows.findIndex((row) => cellText(row[0]) === "Name");
  if (headerRowIndex === -1) return [];
  const columns = headerIndex(rows[headerRowIndex]);

  const activations: LongtermActivation[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const name = cellText(row[0]);
    if (!name) continue;
    activations.push({
      name,
      channelKey: normalizeChannelKey(name),
      channelUrl: textOrNull(pick(row, columns, "channel url")),
      country: textOrNull(pick(row, columns, "country")),
      numActivations: parseNumeric(pick(row, columns, "number of activations")),
      intPriceTotal: parseNumeric(pick(row, columns, "int price (total)")),
      extPriceTotal: parseNumeric(pick(row, columns, "ext price (total)")),
      videosLive: textOrNull(pick(row, columns, "videos live")),
      cm: textOrNull(pick(row, columns, "cm")),
      month: textOrNull(pick(row, columns, "month")),
      sourceRow: i + 1,
    });
  }
  return activations;
}

function isCountryTab(rows: CellMatrix): boolean {
  return rows.some((row) => cellText(row[0]) === "Name" && cellText(row[2]) === "Context");
}

function isBookingsTab(rows: CellMatrix): boolean {
  return rows.some((row) => cellText(row[0]) === "Channel Name");
}

/** Parse every recognizable sheet in the workbook. */
export function parseWorkbook(sheets: Record<string, CellMatrix>): WorkbookParseResult {
  const result: WorkbookParseResult = {
    bookings: [],
    targets: [],
    revenueTargets: [],
    pipeline: [],
    longterm: [],
    skippedSheets: [],
  };

  for (const [name, rows] of Object.entries(sheets)) {
    if (SKIPPED_SHEETS.has(name) || name.startsWith("_") || LEGACY_SHEET.test(name)) {
      result.skippedSheets.push(name);
      continue;
    }
    if (name === "Plan Q3") {
      const { targets, revenueTargets } = parsePlanTab(rows);
      result.targets.push(...targets);
      result.revenueTargets.push(...revenueTargets);
    } else if (name === "Longterm") {
      result.longterm.push(...parseLongtermTab(rows));
    } else if (isBookingsTab(rows)) {
      result.bookings.push(...parseBookingsTab(rows, name));
    } else if (isCountryTab(rows)) {
      result.pipeline.push(...parseCountryTab(rows, name));
    } else {
      result.skippedSheets.push(name);
    }
  }
  return result;
}
