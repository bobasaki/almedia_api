import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import type { BookingsStore } from "../src/bookings/store";

/**
 * REST routes for the dashboard's saved widget layout, mounted by the server:
 *
 *   GET /api/layout?profile=team   the saved responsive layout, or null
 *   PUT /api/layout                upsert the layout for a profile
 *
 * With no auth yet the default profile is the shared "team" view; the schema
 * is keyed by profile so it becomes per-user unchanged once auth lands.
 */

const MAX_BODY_BYTES = 256 * 1024;

/** Profiles are opaque keys; keep them to a safe, bounded charset. */
const profileSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "profile must be alphanumeric, dash, or underscore")
  .default("team");

/** A single react-grid-layout item. Extra keys (minW, static, …) pass through. */
const layoutItemSchema = z
  .object({
    i: z.string().min(1),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
  })
  .loose();

/** Map of breakpoint name → array of grid items. */
const layoutsSchema = z.record(z.string(), z.array(layoutItemSchema));

const putBodySchema = z.object({
  profile: profileSchema,
  layout: layoutsSchema,
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

/** Route a request; returns false when the path is not a layout route. */
export async function handleLayoutApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  store: BookingsStore,
): Promise<boolean> {
  if (url.pathname !== "/api/layout") return false;

  try {
    if (request.method === "GET") {
      const profile = profileSchema.safeParse(url.searchParams.get("profile") ?? undefined);
      if (!profile.success) return validationError(response, profile.error), true;
      sendJson(response, 200, { layout: store.getDashboardLayout(profile.data) });
      return true;
    }

    if (request.method === "PUT") {
      const parsed = putBodySchema.safeParse(await readJsonBody(request));
      if (!parsed.success) return validationError(response, parsed.error), true;
      store.saveDashboardLayout(parsed.data.profile, parsed.data.layout);
      sendJson(response, 200, { ok: true });
      return true;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = /body/i.test(message) || error instanceof SyntaxError ? 400 : 500;
    sendJson(response, status, { error: status === 400 ? message : "Internal error" });
    if (status === 500) console.error("layout-api:", error);
  }
  return true;
}
