import { describe, expect, it } from "vitest";

import { monthLabel, platformLabel } from "./labels";

describe("platformLabel", () => {
  it("uses each platform's own brand capitalisation", () => {
    expect(platformLabel("youtube")).toBe("YouTube");
    expect(platformLabel("tiktok")).toBe("TikTok");
    expect(platformLabel("instagram")).toBe("Instagram");
  });

  it("is case-insensitive on the input", () => {
    expect(platformLabel("YOUTUBE")).toBe("YouTube");
    expect(platformLabel("TikTok")).toBe("TikTok");
  });

  it("title-cases unknown platforms and handles empties", () => {
    expect(platformLabel("kwai")).toBe("Kwai");
    expect(platformLabel(null)).toBe("—");
    expect(platformLabel("")).toBe("—");
  });
});

describe("monthLabel", () => {
  it("shows the full year so it never reads as a calendar day", () => {
    expect(monthLabel("2026-07")).toBe("Jul 2026");
    expect(monthLabel("2026-12")).toBe("Dec 2026");
  });

  it("returns the raw value when it cannot be parsed", () => {
    expect(monthLabel("not-a-month")).toBe("not-a-month");
  });
});
