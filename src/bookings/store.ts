import { DatabaseSync } from "node:sqlite";

import { normalizeChannelKey } from "../migration/cell-utils";
import {
  channelEnrichmentResultSchema,
  type ChannelEnrichmentResult,
  type EnrichmentSourceLink,
  type StoredChannelEnrichment,
} from "../enrichment/types";
import type {
  Booking,
  BookingInput,
  BookingPatch,
  BookingStatus,
  InvoiceRecord,
  MonthlyRevenueTarget,
  Target,
  TargetInput,
} from "./types";
import { BOOKING_STATUSES } from "./types";

/**
 * SQLite-backed store for bookings and plan targets, on Node's built-in
 * `node:sqlite`. Pass `":memory:"` for tests.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_name TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  channel_url TEXT,
  country TEXT,
  cm TEXT,
  platform TEXT,
  vertical TEXT,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'pipeline',
  activation TEXT,
  num_activations INTEGER,
  contract_signed INTEGER NOT NULL DEFAULT 0,
  contract_url TEXT,
  published_at TEXT,
  int_budget REAL,
  ext_budget REAL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  month TEXT,
  note TEXT,
  video_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookings_month ON bookings(month);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cm TEXT NOT NULL,
  market TEXT NOT NULL,
  month TEXT NOT NULL,
  budget_eur REAL NOT NULL,
  tier_under_10k INTEGER NOT NULL DEFAULT 0,
  tier_10k_20k INTEGER NOT NULL DEFAULT 0,
  tier_20k_50k INTEGER NOT NULL DEFAULT 0,
  tier_over_50k INTEGER NOT NULL DEFAULT 0,
  UNIQUE (cm, market, month)
);

CREATE TABLE IF NOT EXISTS revenue_targets (
  month TEXT PRIMARY KEY,
  total_eur REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS dashboard_layouts (
  profile TEXT PRIMARY KEY,
  layout TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  campaign_name TEXT PRIMARY KEY,
  channel_name TEXT NOT NULL,
  invoiced_at TEXT NOT NULL,
  matured_at_invoice INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL,
  return_pct REAL,
  tier TEXT NOT NULL,
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_enrichments (
  channel_id TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_enrichment_links (
  source_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  PRIMARY KEY (source_type, source_key)
);
CREATE INDEX IF NOT EXISTS idx_channel_enrichment_links_channel
  ON channel_enrichment_links(channel_id);
`;

type Row = Record<string, string | number | bigint | null>;

function text(row: Row, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function num(row: Row, key: string): number | null {
  const value = row[key];
  return value === null || value === undefined ? null : Number(value);
}

function toBooking(row: Row): Booking {
  const status = String(row.status) as BookingStatus;
  return {
    id: Number(row.id),
    channelName: String(row.channel_name),
    channelKey: String(row.channel_key),
    channelUrl: text(row, "channel_url"),
    country: text(row, "country"),
    cm: text(row, "cm"),
    platform: text(row, "platform"),
    vertical: text(row, "vertical"),
    category: text(row, "category"),
    status: BOOKING_STATUSES.includes(status) ? status : "pipeline",
    activation: text(row, "activation"),
    numActivations: num(row, "num_activations"),
    contractSigned: Number(row.contract_signed) === 1,
    contractUrl: text(row, "contract_url"),
    publishedAt: text(row, "published_at"),
    intBudget: num(row, "int_budget"),
    extBudget: num(row, "ext_budget"),
    currency: String(row.currency),
    month: text(row, "month"),
    note: text(row, "note"),
    videoUrl: text(row, "video_url"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toTarget(row: Row): Target {
  return {
    id: Number(row.id),
    cm: String(row.cm),
    market: String(row.market),
    month: String(row.month),
    budgetEur: Number(row.budget_eur),
    tierCounts: {
      under10k: Number(row.tier_under_10k),
      from10kTo20k: Number(row.tier_10k_20k),
      from20kTo50k: Number(row.tier_20k_50k),
      over50k: Number(row.tier_over_50k),
    },
  };
}

function toInvoice(row: Row): InvoiceRecord {
  return {
    campaignName: String(row.campaign_name),
    channelName: String(row.channel_name),
    invoicedAt: String(row.invoiced_at),
    maturedAtInvoice: Number(row.matured_at_invoice) === 1,
    cost: Number(row.cost),
    returnPct: num(row, "return_pct"),
    tier: String(row.tier),
    amount: Number(row.amount),
  };
}

function parseStoredEnrichment(
  row: Row,
  links: EnrichmentSourceLink[],
): StoredChannelEnrichment | null {
  try {
    const result = channelEnrichmentResultSchema.parse(JSON.parse(String(row.result_json)));
    return {
      result,
      links,
      updatedAt: String(row.updated_at),
    };
  } catch {
    return null;
  }
}

/** Column values for the mutable subset of a booking, keyed by column name. */
function bookingColumns(input: BookingInput | BookingPatch): Map<string, string | number | null> {
  const columns = new Map<string, string | number | null>();
  const setText = (column: string, value: string | null | undefined) => {
    if (value !== undefined) columns.set(column, value === "" ? null : value);
  };
  if (input.channelName !== undefined) {
    columns.set("channel_name", input.channelName);
    columns.set("channel_key", normalizeChannelKey(input.channelName));
  }
  setText("channel_url", input.channelUrl);
  setText("country", input.country);
  setText("cm", input.cm);
  setText("platform", input.platform);
  setText("vertical", input.vertical);
  setText("category", input.category);
  if (input.status !== undefined) columns.set("status", input.status);
  setText("activation", input.activation);
  if (input.numActivations !== undefined) columns.set("num_activations", input.numActivations);
  if (input.contractSigned !== undefined) columns.set("contract_signed", input.contractSigned ? 1 : 0);
  setText("contract_url", input.contractUrl);
  setText("published_at", input.publishedAt);
  if (input.intBudget !== undefined) columns.set("int_budget", input.intBudget);
  if (input.extBudget !== undefined) columns.set("ext_budget", input.extBudget);
  if (input.currency !== undefined) columns.set("currency", input.currency);
  setText("month", input.month);
  setText("note", input.note);
  setText("video_url", input.videoUrl);
  return columns;
}

export class BookingsStore {
  private readonly db: DatabaseSync;
  private readonly now: () => Date;

  constructor(path: string, options: { now?: () => Date } = {}) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
    this.migrate();
    this.now = options.now ?? (() => new Date());
  }

  /** Add enrichment columns to databases created before they existed. */
  private migrate(): void {
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(bookings)").all() as Row[]).map((row) =>
        String(row.name),
      ),
    );
    for (const column of ["vertical", "category"]) {
      if (!columns.has(column)) {
        this.db.exec(`ALTER TABLE bookings ADD COLUMN ${column} TEXT`);
      }
    }
  }

  close(): void {
    this.db.close();
  }

  listBookings(): Booking[] {
    const rows = this.db
      .prepare("SELECT * FROM bookings ORDER BY month DESC, id DESC")
      .all() as Row[];
    return rows.map(toBooking);
  }

  getBooking(id: number): Booking | null {
    const row = this.db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as Row | undefined;
    return row ? toBooking(row) : null;
  }

  createBooking(input: BookingInput): Booking {
    const timestamp = this.now().toISOString();
    const columns = bookingColumns({ status: "pipeline", currency: "EUR", ...input });
    columns.set("created_at", timestamp);
    columns.set("updated_at", timestamp);

    const names = [...columns.keys()];
    const statement = this.db.prepare(
      `INSERT INTO bookings (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    );
    const result = statement.run(...columns.values());
    const created = this.getBooking(Number(result.lastInsertRowid));
    if (!created) throw new Error("Booking insert did not persist");
    return created;
  }

  updateBooking(id: number, patch: BookingPatch): Booking | null {
    if (!this.getBooking(id)) return null;
    const columns = bookingColumns(patch);
    columns.set("updated_at", this.now().toISOString());

    const assignments = [...columns.keys()].map((name) => `${name} = ?`).join(", ");
    this.db.prepare(`UPDATE bookings SET ${assignments} WHERE id = ?`).run(...columns.values(), id);
    return this.getBooking(id);
  }

  deleteBooking(id: number): boolean {
    const result = this.db.prepare("DELETE FROM bookings WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  listTargets(): Target[] {
    const rows = this.db
      .prepare("SELECT * FROM targets ORDER BY month, cm, market")
      .all() as Row[];
    return rows.map(toTarget);
  }

  upsertTarget(input: TargetInput): Target {
    this.db
      .prepare(
        `INSERT INTO targets (cm, market, month, budget_eur, tier_under_10k, tier_10k_20k, tier_20k_50k, tier_over_50k)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (cm, market, month) DO UPDATE SET
           budget_eur = excluded.budget_eur,
           tier_under_10k = excluded.tier_under_10k,
           tier_10k_20k = excluded.tier_10k_20k,
           tier_20k_50k = excluded.tier_20k_50k,
           tier_over_50k = excluded.tier_over_50k`,
      )
      .run(
        input.cm,
        input.market,
        input.month,
        input.budgetEur,
        input.tierCounts.under10k,
        input.tierCounts.from10kTo20k,
        input.tierCounts.from20kTo50k,
        input.tierCounts.over50k,
      );
    const row = this.db
      .prepare("SELECT * FROM targets WHERE cm = ? AND market = ? AND month = ?")
      .get(input.cm, input.market, input.month) as Row;
    return toTarget(row);
  }

  listRevenueTargets(): MonthlyRevenueTarget[] {
    const rows = this.db
      .prepare("SELECT * FROM revenue_targets ORDER BY month")
      .all() as Row[];
    return rows.map((row) => ({ month: String(row.month), totalEur: Number(row.total_eur) }));
  }

  upsertRevenueTarget(target: MonthlyRevenueTarget): void {
    this.db
      .prepare(
        `INSERT INTO revenue_targets (month, total_eur) VALUES (?, ?)
         ON CONFLICT (month) DO UPDATE SET total_eur = excluded.total_eur`,
      )
      .run(target.month, target.totalEur);
  }

  countTargets(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM targets").get() as Row;
    return Number(row.n);
  }

  /** Read the saved dashboard layout for a profile, or null when unset. */
  getDashboardLayout(profile: string): unknown | null {
    const row = this.db
      .prepare("SELECT layout FROM dashboard_layouts WHERE profile = ?")
      .get(profile) as Row | undefined;
    if (!row) return null;
    try {
      return JSON.parse(String(row.layout)) as unknown;
    } catch {
      return null;
    }
  }

  /** Upsert the dashboard layout for a profile (e.g. the shared "team" view). */
  saveDashboardLayout(profile: string, layout: unknown): void {
    this.db
      .prepare(
        `INSERT INTO dashboard_layouts (profile, layout, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (profile) DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at`,
      )
      .run(profile, JSON.stringify(layout), this.now().toISOString());
  }

  /** Every invoice snapshot, newest first. */
  listInvoices(): InvoiceRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM invoices ORDER BY invoiced_at DESC")
      .all() as Row[];
    return rows.map(toInvoice);
  }

  /** Mark a campaign invoiced (or update its snapshot), keyed by campaign name. */
  upsertInvoice(record: InvoiceRecord): InvoiceRecord {
    this.db
      .prepare(
        `INSERT INTO invoices
           (campaign_name, channel_name, invoiced_at, matured_at_invoice, cost, return_pct, tier, amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (campaign_name) DO UPDATE SET
           channel_name = excluded.channel_name,
           invoiced_at = excluded.invoiced_at,
           matured_at_invoice = excluded.matured_at_invoice,
           cost = excluded.cost,
           return_pct = excluded.return_pct,
           tier = excluded.tier,
           amount = excluded.amount`,
      )
      .run(
        record.campaignName,
        record.channelName,
        record.invoicedAt,
        record.maturedAtInvoice ? 1 : 0,
        record.cost,
        record.returnPct,
        record.tier,
        record.amount,
      );
    const row = this.db
      .prepare("SELECT * FROM invoices WHERE campaign_name = ?")
      .get(record.campaignName) as Row;
    return toInvoice(row);
  }

  /** Un-mark a campaign; returns true when a record was removed. */
  deleteInvoice(campaignName: string): boolean {
    const result = this.db.prepare("DELETE FROM invoices WHERE campaign_name = ?").run(campaignName);
    return Number(result.changes) > 0;
  }

  /** Persist a complete, versioned enrichment and connect it to its source records. */
  upsertChannelEnrichment(
    result: ChannelEnrichmentResult,
    links: EnrichmentSourceLink[] = [],
  ): StoredChannelEnrichment {
    const validated = channelEnrichmentResultSchema.parse(result);
    const timestamp = this.now().toISOString();
    this.db
      .prepare(
        `INSERT INTO channel_enrichments (channel_id, result_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (channel_id) DO UPDATE SET
           result_json = excluded.result_json,
           updated_at = excluded.updated_at`,
      )
      .run(validated.channel.id, JSON.stringify(validated), timestamp);

    const saveLink = this.db.prepare(
      `INSERT INTO channel_enrichment_links (source_type, source_key, channel_id)
       VALUES (?, ?, ?)
       ON CONFLICT (source_type, source_key) DO UPDATE SET channel_id = excluded.channel_id`,
    );
    for (const link of links) {
      const sourceKey = link.sourceKey.trim();
      if (!sourceKey) continue;
      saveLink.run(link.sourceType, sourceKey, validated.channel.id);
    }

    return this.getChannelEnrichment(validated.channel.id)!;
  }

  getChannelEnrichment(channelId: string): StoredChannelEnrichment | null {
    const row = this.db
      .prepare("SELECT * FROM channel_enrichments WHERE channel_id = ?")
      .get(channelId) as Row | undefined;
    if (!row) return null;
    const linkRows = this.db
      .prepare(
        `SELECT source_type, source_key
         FROM channel_enrichment_links
         WHERE channel_id = ?
         ORDER BY source_type, source_key`,
      )
      .all(channelId) as Row[];
    const links = linkRows.map((link) => ({
      sourceType: String(link.source_type) as EnrichmentSourceLink["sourceType"],
      sourceKey: String(link.source_key),
    }));
    return parseStoredEnrichment(row, links);
  }

  findChannelEnrichment(
    sourceType: EnrichmentSourceLink["sourceType"],
    sourceKey: string,
  ): StoredChannelEnrichment | null {
    const row = this.db
      .prepare(
        `SELECT enrichment.*
         FROM channel_enrichments enrichment
         JOIN channel_enrichment_links link ON link.channel_id = enrichment.channel_id
         WHERE link.source_type = ? AND link.source_key = ?`,
      )
      .get(sourceType, sourceKey) as Row | undefined;
    if (!row) return null;
    return this.getChannelEnrichment(String(row.channel_id));
  }

  listChannelEnrichments(): StoredChannelEnrichment[] {
    const rows = this.db
      .prepare("SELECT channel_id FROM channel_enrichments ORDER BY updated_at DESC")
      .all() as Row[];
    return rows.flatMap((row) => {
      const stored = this.getChannelEnrichment(String(row.channel_id));
      return stored ? [stored] : [];
    });
  }
}
