import { z } from "zod";

import { BOOKING_STATUSES } from "./types";

/** Request-boundary validation for the bookings API. */

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((value) => (value ? value : null));

const isoMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM")
  .nullish()
  .transform((value) => value ?? null);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "publishedAt must be YYYY-MM-DD")
  .nullish()
  .transform((value) => value ?? null);

const money = z.number().finite().min(0).nullish().transform((value) => value ?? null);

export const bookingInputSchema = z.object({
  channelName: z.string().trim().min(1, "channelName is required").max(200),
  channelUrl: optionalText,
  country: optionalText,
  cm: optionalText,
  platform: optionalText,
  vertical: optionalText,
  category: optionalText,
  status: z.enum(BOOKING_STATUSES).default("pipeline"),
  activation: optionalText,
  numActivations: z.number().int().min(0).nullish().transform((value) => value ?? null),
  contractSigned: z.boolean().default(false),
  contractUrl: optionalText,
  publishedAt: isoDate,
  intBudget: money,
  extBudget: money,
  currency: z.enum(["EUR", "USD", "GBP"]).default("EUR"),
  month: isoMonth,
  note: optionalText,
  videoUrl: optionalText,
});

// .partial() alone would still apply the .default() values, silently
// resetting status/currency/contractSigned on every sparse patch.
export const bookingPatchSchema = bookingInputSchema.partial().extend({
  status: z.enum(BOOKING_STATUSES).optional(),
  contractSigned: z.boolean().optional(),
  currency: z.enum(["EUR", "USD", "GBP"]).optional(),
});

export type ValidatedBookingInput = z.infer<typeof bookingInputSchema>;
export type ValidatedBookingPatch = z.infer<typeof bookingPatchSchema>;
