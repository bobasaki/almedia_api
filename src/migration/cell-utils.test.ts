import { describe, expect, it } from "vitest";

import {
  campaignBaseKey,
  cellText,
  headerIndex,
  matchMonthHeader,
  normalizeChannelKey,
  normalizeCurrency,
  parseBoolean,
  parseNumeric,
  parseSheetDate,
} from "./cell-utils";

describe("matchMonthHeader", () => {
  it("matches exact month names", () => {
    expect(matchMonthHeader("August")).toBe("August");
    expect(matchMonthHeader("  july ")).toBe("July");
  });

  it("matches country-tab arrow headers", () => {
    expect(matchMonthHeader("JULY ⬇️")).toBe("July");
    expect(matchMonthHeader("SEPTEMBER ⬇️")).toBe("September");
  });

  it("rejects creator names that start with a month", () => {
    expect(matchMonthHeader("August Vlogs")).toBeNull();
    expect(matchMonthHeader("MayLee")).toBeNull();
  });

  it("rejects blanks and non-months", () => {
    expect(matchMonthHeader("")).toBeNull();
    expect(matchMonthHeader(null)).toBeNull();
    expect(matchMonthHeader("FAILED (FOR NOW) ⬇️")).toBeNull();
  });
});

describe("parseSheetDate", () => {
  it("handles Date objects", () => {
    expect(parseSheetDate(new Date("2025-09-05T00:00:00Z"))).toBe("2025-09-05");
  });

  it("handles day-first slash and dot formats", () => {
    expect(parseSheetDate("04/07/2026")).toBe("2026-07-04");
    expect(parseSheetDate("29/06/2026")).toBe("2026-06-29");
    expect(parseSheetDate("05.03.2026.")).toBe("2026-03-05");
  });

  it("handles ISO-ish strings", () => {
    expect(parseSheetDate("2025-09-05 00:00:00")).toBe("2025-09-05");
  });

  it("handles Excel serials", () => {
    expect(parseSheetDate(46_204)).toBe("2026-07-01");
  });

  it("rejects garbage", () => {
    expect(parseSheetDate("September Budget")).toBeNull();
    expect(parseSheetDate("13/13/2026")).toBeNull();
    expect(parseSheetDate("")).toBeNull();
    expect(parseSheetDate(12)).toBeNull();
  });
});

describe("parseNumeric", () => {
  it("passes numbers through", () => {
    expect(parseNumeric(500)).toBe(500);
    expect(parseNumeric(0)).toBe(0);
  });

  it("parses formatted strings", () => {
    expect(parseNumeric("500.0")).toBe(500);
    expect(parseNumeric("€1,400")).toBe(1400);
    expect(parseNumeric("1400,50")).toBe(1400.5);
  });

  it("returns null for blanks and text", () => {
    expect(parseNumeric("")).toBeNull();
    expect(parseNumeric("Arbitrary")).toBeNull();
    expect(parseNumeric(null)).toBeNull();
  });
});

describe("parseBoolean / normalizeCurrency / cellText", () => {
  it("parses booleans from cells", () => {
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean("FALSE")).toBe(false);
    expect(parseBoolean("True")).toBe(true);
    expect(parseBoolean(null)).toBe(false);
  });

  it("normalizes currency symbols", () => {
    expect(normalizeCurrency("€")).toBe("EUR");
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("")).toBeNull();
  });

  it("trims cell text", () => {
    expect(cellText("  hi ")).toBe("hi");
    expect(cellText(undefined)).toBe("");
  });
});

describe("channel keys", () => {
  it("normalizes names to uppercase alphanumerics", () => {
    expect(normalizeChannelKey("ASMR Fixy")).toBe("ASMRFIXY");
    expect(normalizeChannelKey("penny.rogers.home")).toBe("PENNYROGERSHOME");
    expect(normalizeChannelKey("Bożena \"Bowi\" Cisło")).toBe("BOZENABOWICISLO");
  });

  it("strips campaign suffixes", () => {
    expect(campaignBaseKey("ASMRFIXY_YT_R1")).toBe("ASMRFIXY");
    expect(campaignBaseKey("SKOPZZOR_YT_R2")).toBe("SKOPZZOR");
    expect(campaignBaseKey("KUCHENTV_YT_R2_LB")).toBe("KUCHENTV");
    expect(campaignBaseKey("CREATOR_IGS_R3LB")).toBe("CREATOR");
    expect(campaignBaseKey("PLAIN")).toBe("PLAIN");
  });
});

describe("headerIndex", () => {
  it("maps labels case-insensitively and keeps the first occurrence", () => {
    const map = headerIndex(["Name", "CM", "", "Final Price", "name"]);
    expect(map.get("name")).toBe(0);
    expect(map.get("final price")).toBe(3);
    expect(map.has("")).toBe(false);
  });
});
