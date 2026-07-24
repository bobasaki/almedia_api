import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import { buildScorecard } from "../src/bookings/scorecard";
import type { BookingsStore } from "../src/bookings/store";
import { bookingInputSchema, bookingPatchSchema } from "../src/bookings/validation";

/**
 * REST routes for the bookings module, mounted by the dashboard server:
 *
 *   GET    /api/bookings        all bookings
 *   POST   /api/bookings        create (zod-validated)
 *   PATCH  /api/bookings/:id    sparse update
 *   DELETE /api/bookings/:id    delete
 *   GET    /api/targets         plan + revenue targets
 *   GET    /api/scorecard       booked vs target per CM/market/month
 */

const MAX_BODY_BYTES = 64 * 1024;

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

function handleBookingCollection(
  request: IncomingMessage,
  response: ServerResponse,
  store: BookingsStore,
): Promise<void> | void {
  if (request.method === "GET") {
    sendJson(response, 200, { bookings: store.listBookings() });
    return;
  }
  if (request.method === "POST") {
    return readJsonBody(request).then((body) => {
      const parsed = bookingInputSchema.safeParse(body);
      if (!parsed.success) return validationError(response, parsed.error);
      sendJson(response, 201, { booking: store.createBooking(parsed.data) });
    });
  }
  sendJson(response, 405, { error: "Method not allowed" });
}

function handleBookingItem(
  request: IncomingMessage,
  response: ServerResponse,
  store: BookingsStore,
  id: number,
): Promise<void> | void {
  if (request.method === "PATCH") {
    return readJsonBody(request).then((body) => {
      const parsed = bookingPatchSchema.safeParse(body);
      if (!parsed.success) return validationError(response, parsed.error);
      const updated = store.updateBooking(id, parsed.data);
      if (!updated) return sendJson(response, 404, { error: `Booking ${id} not found` });
      sendJson(response, 200, { booking: updated });
    });
  }
  if (request.method === "DELETE") {
    if (!store.deleteBooking(id)) return sendJson(response, 404, { error: `Booking ${id} not found` });
    sendJson(response, 200, { deleted: id });
    return;
  }
  sendJson(response, 405, { error: "Method not allowed" });
}

/** Route a request; returns false when the path is not a bookings route. */
export async function handleBookingsApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  store: BookingsStore,
): Promise<boolean> {
  const itemMatch = /^\/api\/bookings\/(\d+)$/.exec(url.pathname);
  const isCollection = url.pathname === "/api/bookings";
  const isTargets = url.pathname === "/api/targets";
  const isScorecard = url.pathname === "/api/scorecard";
  if (!itemMatch && !isCollection && !isTargets && !isScorecard) return false;

  try {
    if (isCollection) {
      await handleBookingCollection(request, response, store);
    } else if (itemMatch) {
      await handleBookingItem(request, response, store, Number(itemMatch[1]));
    } else if (isTargets) {
      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed" });
      } else {
        sendJson(response, 200, {
          targets: store.listTargets(),
          revenueTargets: store.listRevenueTargets(),
        });
      }
    } else if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
    } else {
      const scorecard = buildScorecard(
        store.listBookings(),
        store.listTargets(),
        store.listRevenueTargets(),
        new Date(),
      );
      sendJson(response, 200, scorecard);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = /body/i.test(message) || error instanceof SyntaxError ? 400 : 500;
    sendJson(response, status, { error: status === 400 ? message : "Internal error" });
    if (status === 500) console.error("bookings-api:", error);
  }
  return true;
}
