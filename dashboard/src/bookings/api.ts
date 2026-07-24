import type { Scorecard } from "../../../src/bookings/scorecard";
import type {
  Booking,
  BookingInput,
  BookingPatch,
  MonthlyRevenueTarget,
  Target,
} from "../../../src/bookings/types";

/** Typed fetch helpers for the bookings REST API. */

export interface TargetsPayload {
  targets: Target[];
  revenueTargets: MonthlyRevenueTarget[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return body;
}

export function fetchBookings(signal?: AbortSignal): Promise<Booking[]> {
  return request<{ bookings: Booking[] }>("/api/bookings", { signal }).then((r) => r.bookings);
}

export function createBooking(input: BookingInput): Promise<Booking> {
  return request<{ booking: Booking }>("/api/bookings", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((r) => r.booking);
}

export function patchBooking(id: number, patch: BookingPatch): Promise<Booking> {
  return request<{ booking: Booking }>(`/api/bookings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }).then((r) => r.booking);
}

export function deleteBooking(id: number): Promise<void> {
  return request<{ deleted: number }>(`/api/bookings/${id}`, { method: "DELETE" }).then(() => undefined);
}

export function fetchTargets(signal?: AbortSignal): Promise<TargetsPayload> {
  return request<TargetsPayload>("/api/targets", { signal });
}

export function fetchScorecard(signal?: AbortSignal): Promise<Scorecard> {
  return request<Scorecard>("/api/scorecard", { signal });
}
