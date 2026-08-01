import { getMaturityInfo } from "../analytics";
import { platformLabel } from "../labels";
import { crossTab } from "./charts";
import { groupByDimension } from "./enrich";
import { formatCount, formatEur, formatPct } from "./format";
import type { Deal } from "./types";

/**
 * Concrete booking recommendations for CLs and CMs, derived from the deals
 * currently in view. Every suggestion is grounded on matured, measured returns
 * (a return only counts 14+ days after publish) so we never tell someone to
 * lean into a segment that is still accruing. Each line names the exact action
 * and the number behind it: "book more X niche", "book channels averaging Y
 * views at Z% ER", "rebook these N channels". Pure — no I/O.
 */

export type SuggestionKind =
  | "book-more"
  | "creator-profile"
  | "rebook"
  | "platform"
  | "size"
  | "reduce";

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  priority: "high" | "medium";
  /** Short imperative title, e.g. "Book more Gaming". */
  headline: string;
  /** Full sentence with the supporting evidence. */
  detail: string;
  /** Compact stat chip, e.g. "128% return · €42k · 6 deals". */
  metric: string;
}

/** Minimum measured deals before a segment is trustworthy enough to recommend. */
const MIN_MEASURED = 2;
const MIN_CREATORS = 3;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Round a view count to a friendly "book channels averaging ~X" figure. */
function roundViews(value: number): number {
  if (value >= 1_000_000) return Math.round(value / 100_000) * 100_000;
  if (value >= 100_000) return Math.round(value / 10_000) * 10_000;
  if (value >= 10_000) return Math.round(value / 1_000) * 1_000;
  return Math.round(value / 100) * 100;
}

export function bookingSuggestions(deals: Deal[], now: Date = new Date()): Suggestion[] {
  const matured = deals.filter(
    (deal) =>
      deal.returnPct !== null &&
      getMaturityInfo(deal.publishedAt, now).status === "matured",
  );

  const suggestions: Suggestion[] = [];

  // ── Book more: strongest verticals (niches) by cost-weighted return ─────────
  const verticals = groupByDimension(matured, "vertical")
    .filter(
      (group) =>
        group.key !== "Unassigned" &&
        group.measured >= MIN_MEASURED &&
        group.avgReturnPct !== null &&
        group.avgReturnPct >= 90,
    )
    .sort((a, b) => (b.avgReturnPct ?? 0) - (a.avgReturnPct ?? 0))
    .slice(0, 3);
  for (const group of verticals) {
    suggestions.push({
      id: `vertical-${group.key}`,
      kind: "book-more",
      priority: (group.avgReturnPct ?? 0) >= 100 ? "high" : "medium",
      headline: `Book more ${group.key}`,
      detail: `${group.key} creators return ${formatPct(group.avgReturnPct)} cost-weighted across ${group.measured} matured deals, one of the strongest niches. Book more of it next month.`,
      metric: `${formatPct(group.avgReturnPct)} return · ${formatEur(group.cost)} · ${group.measured} deals`,
    });
  }

  // ── Book more: best market × vertical pairings ──────────────────────────────
  const pairings = crossTab(matured, "country", "vertical")
    .cells.filter(
      (cell) =>
        cell.row !== "Unassigned" &&
        cell.col !== "Unassigned" &&
        cell.measured >= MIN_MEASURED &&
        cell.avgReturnPct !== null &&
        cell.avgReturnPct >= 100,
    )
    .sort((a, b) => (b.avgReturnPct ?? 0) - (a.avgReturnPct ?? 0))
    .slice(0, 2);
  for (const cell of pairings) {
    suggestions.push({
      id: `pair-${cell.row}-${cell.col}`,
      kind: "book-more",
      priority: "high",
      headline: `Book more ${cell.col} in ${cell.row}`,
      detail: `${cell.col} in ${cell.row} returns ${formatPct(cell.avgReturnPct)} across ${cell.measured} matured deals. Ask CMs to source more ${cell.col} creators in ${cell.row}.`,
      metric: `${formatPct(cell.avgReturnPct)} return · ${formatEur(cell.cost)} · ${cell.deals} deals`,
    });
  }

  // ── Creator profile: the shape of channels that actually paid off ───────────
  const winners = matured.filter(
    (deal) =>
      (deal.returnPct ?? 0) >= 100 &&
      deal.hasEnrichment &&
      deal.creatorTypicalViews !== null,
  );
  if (winners.length >= MIN_CREATORS) {
    const medianViews = median(
      winners.map((deal) => deal.creatorTypicalViews as number),
    );
    const medianEr = median(
      winners
        .map((deal) => deal.creatorEngagementRatePct)
        .filter((value): value is number => value !== null),
    );
    if (medianViews !== null) {
      const erPart =
        medianEr !== null ? ` at ${formatPct(medianEr, 1)}+ engagement` : "";
      suggestions.push({
        id: "creator-profile",
        kind: "creator-profile",
        priority: "high",
        headline: "Look for this creator profile",
        detail: `Channels that returned over 100% average about ${formatCount(roundViews(medianViews))} typical views${erPart}. Look for creators that fit this profile.`,
        metric: `${formatCount(roundViews(medianViews))} views${medianEr !== null ? ` · ${formatPct(medianEr, 1)} ER` : ""} · ${winners.length} channels`,
      });
    }
  }

  // ── Rebook / extend: matured channels already earning it ────────────────────
  const rebookable = matured
    .filter((deal) => (deal.returnPct ?? 0) >= 80)
    .sort((a, b) => (b.returnPct ?? 0) - (a.returnPct ?? 0));
  if (rebookable.length > 0) {
    const names = [...new Set(rebookable.map((deal) => deal.channelName))].slice(0, 4);
    const extra = rebookable.length - names.length;
    suggestions.push({
      id: "rebook",
      kind: "rebook",
      priority: "high",
      headline: `Rebook ${rebookable.length} proven channel${rebookable.length === 1 ? "" : "s"}`,
      detail: `${names.join(", ")}${extra > 0 ? ` and ${extra} more` : ""} are matured at 80%+ return. Line them up for a rebooking or longterm deal.`,
      metric: `${rebookable.length} channels ≥80% return`,
    });
  }

  // ── Platform steer: where the money works best ──────────────────────────────
  const platforms = groupByDimension(matured, "platform")
    .filter(
      (group) =>
        group.key !== "Unassigned" &&
        group.measured >= MIN_MEASURED &&
        group.avgReturnPct !== null,
    )
    .sort((a, b) => (b.avgReturnPct ?? 0) - (a.avgReturnPct ?? 0));
  if (platforms.length >= 2) {
    const best = platforms[0];
    const worst = platforms[platforms.length - 1];
    if ((best.avgReturnPct ?? 0) - (worst.avgReturnPct ?? 0) >= 20) {
      suggestions.push({
        id: `platform-${best.key}`,
        kind: "platform",
        priority: "medium",
        headline: `Shift budget toward ${platformLabel(best.key)}`,
        detail: `${platformLabel(best.key)} returns ${formatPct(best.avgReturnPct)} vs ${formatPct(worst.avgReturnPct)} on ${platformLabel(worst.key)}. Weight new bookings toward ${platformLabel(best.key)}.`,
        metric: `${platformLabel(best.key)} ${formatPct(best.avgReturnPct)} · ${platformLabel(worst.key)} ${formatPct(worst.avgReturnPct)}`,
      });
    }
  }

  // ── Deal size: which cheque size performs ───────────────────────────────────
  const sizes = groupByDimension(matured, "sizeTier")
    .filter(
      (group) =>
        group.key !== "Unassigned" &&
        group.measured >= MIN_MEASURED &&
        group.avgReturnPct !== null,
    )
    .sort((a, b) => (b.avgReturnPct ?? 0) - (a.avgReturnPct ?? 0));
  if (sizes.length >= 2 && (sizes[0].avgReturnPct ?? 0) >= 100) {
    const best = sizes[0];
    suggestions.push({
      id: `size-${best.key}`,
      kind: "size",
      priority: "medium",
      headline: `${best.key} deals are performing well`,
      detail: `${best.key} bookings return ${formatPct(best.avgReturnPct)} across ${best.measured} matured deals, a reliable deal size to keep filling.`,
      metric: `${best.key} · ${formatPct(best.avgReturnPct)} return`,
    });
  }

  // ── Reduce: niches / markets to ease off ────────────────────────────────────
  for (const dimension of ["vertical", "country"] as const) {
    const worst = groupByDimension(matured, dimension)
      .filter(
        (group) =>
          group.key !== "Unassigned" &&
          group.measured >= MIN_MEASURED &&
          group.avgReturnPct !== null &&
          group.avgReturnPct < 50,
      )
      .sort((a, b) => (a.avgReturnPct ?? 0) - (b.avgReturnPct ?? 0))[0];
    if (worst) {
      suggestions.push({
        id: `reduce-${dimension}-${worst.key}`,
        kind: "reduce",
        priority: "medium",
        headline: `Ease off ${worst.key}`,
        detail: `${worst.key} is returning only ${formatPct(worst.avgReturnPct)} across ${worst.measured} matured deals. Pause new bookings or renegotiate price before committing more.`,
        metric: `${formatPct(worst.avgReturnPct)} return · ${formatEur(worst.cost)}`,
      });
    }
  }

  const priorityRank = { high: 0, medium: 1 } as const;
  return suggestions.sort(
    (a, b) => priorityRank[a.priority] - priorityRank[b.priority],
  );
}
