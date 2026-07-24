import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import type { BookingsStore } from "../src/bookings/store";

/**
 * REST routes for invoice snapshots, mounted by the dashboard server:
 *
 *   GET    /api/invoices                    all invoice snapshots
 *   PUT    /api/invoices                    mark a campaign invoiced (upsert)
 *   DELETE /api/invoices?campaignName=NAME  un-mark a campaign
 *
 * A record is a point-in-time snapshot of what a campaign was billed, so a
 * pre-maturity invoice can be topped up once it matures. Keyed by the unique
 * Almedia campaign name (arbitrary text — spaces, accents, and dashes appear).
 */

const MAX_BODY_BYTES = 16 * 1024;

const campaignNameSchema = z.string().trim().min(1).max(256);

const invoiceSchema = z.object({
  campaignName: campaignNameSchema,
  channelName: z.string().trim().min(1).max(256),
  invoicedAt: z.string().datetime(),
  maturedAtInvoice: z.boolean(),
  cost: z.number().nonnegative(),
  returnPct: z.number().nullable(),
  tier: z.enum(["c20", "c25", "c30", "c40", "c50", "c60", "c80", "c100"]),
  amount: z.number().nonnegative(),
});

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text) throw new Error("Request body is empty");
  return JSON.parse(text) as unknown;
}

function validationError(response: ServerResponse, error: z.ZodError): void {
  const details = error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`);
  sendJson(response, 400, { error: details.join("; ") });
}

/** Route a request; returns false when the path is not an invoices route. */
export async function handleInvoicesApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  store: BookingsStore,
): Promise<boolean> {
  if (url.pathname !== "/api/invoices") return false;

  try {
    if (request.method === "GET") {
      sendJson(response, 200, { invoices: store.listInvoices() });
      return true;
    }

    if (request.method === "PUT") {
      const parsed = invoiceSchema.safeParse(await readJsonBody(request));
      if (!parsed.success) return validationError(response, parsed.error), true;
      sendJson(response, 200, { invoice: store.upsertInvoice(parsed.data) });
      return true;
    }

    if (request.method === "DELETE") {
      const key = campaignNameSchema.safeParse(url.searchParams.get("campaignName") ?? "");
      if (!key.success) return validationError(response, key.error), true;
      const deleted = store.deleteInvoice(key.data);
      if (!deleted) return sendJson(response, 404, { error: `No invoice for ${key.data}` }), true;
      sendJson(response, 200, { deleted: key.data });
      return true;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = /body/i.test(message) || error instanceof SyntaxError ? 400 : 500;
    sendJson(response, status, { error: status === 400 ? message : "Internal error" });
    if (status === 500) console.error("invoices-api:", error);
  }
  return true;
}
