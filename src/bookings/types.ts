/**
 * Types for the bookings module — the internal replacement for the
 * "[INT] Freecash x ARCH." tracker sheet. One `bookings` table with a
 * `status` field replaces the Campaigns, Longterm, Dropouts, and country
 * scouting tabs; `targets` mirrors the Plan Q3 tab.
 *
 * Months are ISO `YYYY-MM` strings everywhere (the sheet's "August" section
 * headers are mapped during seeding).
 */

export const BOOKING_STATUSES = [
  "pipeline",
  "booked",
  "published",
  "longterm",
  "dropped",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface Booking {
  id: number;
  channelName: string;
  /** Normalized join key against API campaign names (e.g. "ASMRFIXY"). */
  channelKey: string;
  channelUrl: string | null;
  /** Market code as used in Plan targets (PL, US, UK, CA, FR, ES, DE, NL, IT…). */
  country: string | null;
  cm: string | null;
  platform: string | null;
  /** Enrichment: content vertical of the channel (gaming, finance, lifestyle…). */
  vertical: string | null;
  /** Enrichment: deal/content category (integration, dedicated, shorts…). */
  category: string | null;
  status: BookingStatus;
  activation: string | null;
  numActivations: number | null;
  contractSigned: boolean;
  contractUrl: string | null;
  /** ISO date (YYYY-MM-DD) of publication, once live. */
  publishedAt: string | null;
  intBudget: number | null;
  /** Client-facing price; convention EXT = INT / 0.8. */
  extBudget: number | null;
  currency: string;
  /** Target month, ISO YYYY-MM. */
  month: string | null;
  note: string | null;
  videoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields a caller provides when creating a booking. */
export interface BookingInput {
  channelName: string;
  channelUrl?: string | null;
  country?: string | null;
  cm?: string | null;
  platform?: string | null;
  vertical?: string | null;
  category?: string | null;
  status?: BookingStatus;
  activation?: string | null;
  numActivations?: number | null;
  contractSigned?: boolean;
  contractUrl?: string | null;
  publishedAt?: string | null;
  intBudget?: number | null;
  extBudget?: number | null;
  currency?: string;
  month?: string | null;
  note?: string | null;
  videoUrl?: string | null;
}

export type BookingPatch = Partial<BookingInput>;

/** One CM × market × month plan target (from the Plan Q3 tab). */
export interface Target {
  id: number;
  cm: string;
  market: string;
  /** ISO YYYY-MM. */
  month: string;
  budgetEur: number;
  tierCounts: {
    under10k: number;
    from10kTo20k: number;
    from20kTo50k: number;
    over50k: number;
  };
}

export type TargetInput = Omit<Target, "id">;

/** Company-level monthly revenue target (ISO YYYY-MM). */
export interface MonthlyRevenueTarget {
  month: string;
  totalEur: number;
}

/**
 * A snapshot taken when a campaign is marked invoiced, keyed by its unique
 * Almedia campaign name (one per round/placement, so a creator's R1/R2 mature
 * and bill separately). When invoiced before maturity, this preserves the
 * amount billed so any tier climb at maturity can be topped up. `tier` holds an
 * invoice-tier id (see dashboard invoicing), kept as a string to avoid coupling
 * the billing tiers into the bookings domain.
 */
export interface InvoiceRecord {
  /** Unique Almedia campaign name — the invoice identity. */
  campaignName: string;
  /** Human-facing channel/creator name for display. */
  channelName: string;
  /** ISO timestamp when marked invoiced. */
  invoicedAt: string;
  /** True when the campaign had already matured at invoice time (no top-up expected). */
  maturedAtInvoice: boolean;
  /** Almedia cost at invoice time (EUR). */
  cost: number;
  /** Return % at invoice time. */
  returnPct: number | null;
  /** Invoice-tier id at invoice time. */
  tier: string;
  /** Amount invoiced (EUR). */
  amount: number;
}
