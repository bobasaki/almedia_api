import { describe, expect, it } from "vitest";

import { joinChannelsToCampaigns } from "./join-campaigns";

describe("joinChannelsToCampaigns", () => {
  const campaigns = [
    "ASMRFIXY_YT_R1",
    "ASMRFIXY_YT_R2",
    "DIABEUU_YT_R1",
    "MARIUSZSTANKIEWICZ_YT_R1",
    "UNRELATED_YT_R1",
  ];

  it("matches exact base keys and groups rebookings", () => {
    const report = joinChannelsToCampaigns(["ASMRFIXY", "DIABEUU"], campaigns);
    const fixy = report.matches.find((m) => m.channelKey === "ASMRFIXY");
    expect(fixy?.confidence).toBe("exact");
    expect(fixy?.campaignNames).toEqual(["ASMRFIXY_YT_R1", "ASMRFIXY_YT_R2"]);
    expect(report.stats.matchedChannels).toBe(2);
    expect(report.stats.matchedCampaigns).toBe(3);
  });

  it("falls back to prefix matches for truncated names", () => {
    const report = joinChannelsToCampaigns(["MARIUSZSTANKIE"], campaigns);
    expect(report.matches[0]).toMatchObject({
      confidence: "prefix",
      campaignNames: ["MARIUSZSTANKIEWICZ_YT_R1"],
    });
  });

  it("never prefix-matches short keys", () => {
    const report = joinChannelsToCampaigns(["ASMR"], campaigns);
    expect(report.matches).toHaveLength(0);
    expect(report.unmatchedChannelKeys).toEqual(["ASMR"]);
  });

  it("reports unmatched campaigns and dedupes channel keys", () => {
    const report = joinChannelsToCampaigns(["DIABEUU", "DIABEUU", "NOBODY"], campaigns);
    expect(report.stats.channels).toBe(2);
    expect(report.unmatchedChannelKeys).toEqual(["NOBODY"]);
    expect(report.unmatchedCampaignNames).toContain("UNRELATED_YT_R1");
  });
});
