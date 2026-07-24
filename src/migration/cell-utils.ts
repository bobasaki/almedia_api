import type { CellValue } from "./types";

/**
 * Cell-level helpers shared by the workbook parsers. All functions are pure.
 *
 * Date strings in the workbook are day-first ("04/07/2026" = 4 July 2026) —
 * the tracker is maintained by a European team and the Apps Script wrote
 * dd/mm/yyyy throughout.
 */

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_LOOKUP = new Map(MONTHS.map((month) => [month.toLowerCase(), month]));

/** Excel serial-date epoch (1899-12-30, accounting for the 1900 leap bug). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/**
 * Month-section header match. Accepts the exact month name (Campaigns/Legacy
 * tabs) or the "JULY ⬇️" style used on country tabs. A creator called
 * "August Vlogs" does not match.
 */
export function matchMonthHeader(value: CellValue): string | null {
  const raw = cellText(value);
  if (!raw) return null;
  const exact = MONTH_LOOKUP.get(raw.toLowerCase());
  if (exact) return exact;
  const firstWord = raw.split(/\s+/)[0]?.toLowerCase() ?? "";
  const prefixed = MONTH_LOOKUP.get(firstWord);
  if (prefixed && raw.includes("⬇")) return prefixed;
  return null;
}

/** Parse a cell into an ISO `yyyy-mm-dd` date string, or null. */
export function parseSheetDate(value: CellValue): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toIsoDay(value);
  }
  if (typeof value === "number") {
    if (value < 20_000 || value > 80_000) return null; // not a plausible serial
    return toIsoDay(new Date(EXCEL_EPOCH_MS + value * MS_PER_DAY));
  }
  const raw = cellText(value);
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return buildIsoDay(iso[1], iso[2], iso[3]);

  // dd/mm/yyyy or dd.mm.yyyy (optionally with a trailing dot)
  const dayFirst = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})\.?$/);
  if (dayFirst) return buildIsoDay(dayFirst[3], dayFirst[2], dayFirst[1]);

  return null;
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildIsoDay(year: string, month: string, day: string): string | null {
  const monthNum = Number(month);
  const dayNum = Number(day);
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return null;
  return `${year}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
}

/** Parse a money/count cell into a number, or null when blank/unparseable. */
export function parseNumeric(value: CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = cellText(value);
  if (!raw) return null;
  const cleaned = raw.replace(/[€$£\s]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  const parsed = Number(cleaned.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseBoolean(value: CellValue): boolean {
  if (typeof value === "boolean") return value;
  const raw = cellText(value).toLowerCase();
  return raw === "true" || raw === "yes" || raw === "1";
}

export function normalizeCurrency(value: CellValue): string | null {
  const raw = cellText(value).toUpperCase();
  if (!raw) return null;
  if (raw === "€") return "EUR";
  if (raw === "$") return "USD";
  if (raw === "£") return "GBP";
  return raw;
}

const CHANNEL_KEY_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[łŁ]/g, "l"],
  [/[øØ]/g, "o"],
  [/[đĐ]/g, "d"],
  [/ß/g, "ss"],
];

/**
 * Normalize a channel/influencer name into the join key used to match
 * Almedia campaign names: uppercase ASCII alphanumerics only.
 * "ASMR Fixy" -> "ASMRFIXY" (matches campaign base "ASMRFIXY" of
 * "ASMRFIXY_YT_R1").
 */
export function normalizeChannelKey(name: string): string {
  let result = name;
  for (const [pattern, replacement] of CHANNEL_KEY_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Strip the `_PLATFORM_R#` suffix from an Almedia campaign name and
 * normalize the remainder: "ASMRFIXY_YT_R1" -> "ASMRFIXY".
 */
export function campaignBaseKey(campaignName: string): string {
  return normalizeChannelKey(campaignName.replace(/_[A-Z0-9]+_R\d+(?:_?[A-Z0-9]+)*$/i, ""));
}

/** Map header labels (trimmed, lowercased) to their column index. */
export function headerIndex(row: readonly CellValue[]): Map<string, number> {
  const map = new Map<string, number>();
  row.forEach((cell, index) => {
    const label = cellText(cell).toLowerCase();
    if (label && !map.has(label)) map.set(label, index);
  });
  return map;
}
