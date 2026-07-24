import { describe, expect, it, vi } from "vitest";

import { findCampaignEnrichment } from "./lookup";
import type { StoredChannelEnrichment } from "./types";

const stored = { result: {}, links: [], updatedAt: "2026-07-24T00:00:00Z" } as unknown as StoredChannelEnrichment;

describe("findCampaignEnrichment", () => {
  it("prefers the exact campaign link", () => {
    const findChannelEnrichment = vi.fn().mockReturnValue(stored);

    expect(findCampaignEnrichment({ findChannelEnrichment }, "KUCHENTV_YT_R2_LB")).toBe(stored);
    expect(findChannelEnrichment).toHaveBeenCalledTimes(1);
    expect(findChannelEnrichment).toHaveBeenCalledWith("campaign", "KUCHENTV_YT_R2_LB");
  });

  it("falls back to the normalized channel key", () => {
    const findChannelEnrichment = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(stored);

    expect(findCampaignEnrichment({ findChannelEnrichment }, "KUCHENTV_YT_R2_LB")).toBe(stored);
    expect(findChannelEnrichment).toHaveBeenNthCalledWith(2, "channel_key", "KUCHENTV");
  });
});
