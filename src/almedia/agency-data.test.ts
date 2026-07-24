import { describe, expect, it } from "vitest";

import {
  AlmediaApiError,
  fetchAgencyDataPage,
  fetchAllCampaigns,
  type AgencyDataInput,
} from "./agency-data";
import {
  agencyDataResponse,
  immatureCampaign,
  makeCampaign,
  matureCampaign,
} from "./fixtures";

type FetchStep = () => Response;

interface RecordedCall {
  url: URL;
  authorization: string | null;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

/** Build a fetch stub that returns each step in order (repeating the last). */
function stubFetch(steps: FetchStep[]) {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchFn = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: new URL(String(input)), authorization: headers.get("authorization") });
    const step = steps[Math.min(index, steps.length - 1)]!;
    index += 1;
    return step();
  }) as unknown as typeof fetch;

  return { fetchFn, calls };
}

/** Base input: no network, no real sleeping. */
function inputWith(overrides: Partial<AgencyDataInput> & { fetchFn: typeof fetch }): AgencyDataInput {
  return {
    apiKey: "chak_test_key",
    sleepFn: () => Promise.resolve(),
    ...overrides,
  };
}

describe("fetchAgencyDataPage", () => {
  it("returns a normalized page and preserves nulls", async () => {
    const unpublishedCampaign = makeCampaign({
      campaign_name: "BRAND_DRAFT",
      published_at: null,
    });
    const { fetchFn } = stubFetch([
      () =>
        jsonResponse(
          agencyDataResponse([matureCampaign, immatureCampaign, unpublishedCampaign]),
        ),
    ]);

    const page = await fetchAgencyDataPage(inputWith({ fetchFn }));

    expect(page.agency).toBe("YourAgency");
    expect(page.campaigns).toHaveLength(3);

    const [mature, immature, unpublished] = page.campaigns;
    expect(mature).toMatchObject({
      campaignName: "BRAND_YT_R1",
      platform: "youtube",
      country: "DE",
      expectedCpm: 12.5,
      roasReturn: 1.12,
      d7Purchases: 210,
      channelName: "Brand Creator",
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(mature!.publishedAt).toBeInstanceOf(Date);
    expect(mature!.publishedAt?.toISOString().slice(0, 10)).toBe("2026-03-01");

    // Immature campaign keeps its nulls instead of coercing to 0.
    expect(immature!.roasReturn).toBeNull();
    expect(immature!.appuD14).toBeNull();
    expect(immature!.d7Purchases).toBeNull();
    expect(immature!.viewCount).toBe(12000);
    // Channel name carries through; the video URL is absent until published.
    expect(immature!.channelName).toBe("Brand Creator TT");
    expect(immature!.videoUrl).toBeNull();
    expect(unpublished!.publishedAt).toBeNull();
  });

  it("defaults channelName/videoUrl to null when the API omits them", async () => {
    const { fetchFn } = stubFetch([
      () =>
        jsonResponse(
          agencyDataResponse([
            makeCampaign({ channel_name: undefined, video_url: undefined }),
          ]),
        ),
    ]);

    const page = await fetchAgencyDataPage(inputWith({ fetchFn }));

    expect(page.campaigns[0]?.channelName).toBeNull();
    expect(page.campaigns[0]?.videoUrl).toBeNull();
  });

  it("trims and normalizes campaign country codes", async () => {
    const { fetchFn } = stubFetch([
      () => jsonResponse(agencyDataResponse([makeCampaign({ country: " de " })])),
    ]);

    const page = await fetchAgencyDataPage(inputWith({ fetchFn }));

    expect(page.campaigns[0]?.country).toBe("DE");
  });

  it("sends the Bearer token and limit/offset query params", async () => {
    const { fetchFn, calls } = stubFetch([() => jsonResponse(agencyDataResponse([]))]);

    await fetchAgencyDataPage(inputWith({ fetchFn, limit: 250, offset: 500 }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.authorization).toBe("Bearer chak_test_key");
    expect(calls[0]!.url.pathname).toBe("/v1/agency-data-api");
    expect(calls[0]!.url.searchParams.get("limit")).toBe("250");
    expect(calls[0]!.url.searchParams.get("offset")).toBe("500");
  });

  it("throws ALMEDIA_API_KEY_MISSING when the key is empty", async () => {
    const { fetchFn } = stubFetch([() => jsonResponse(agencyDataResponse([]))]);
    await expect(
      fetchAgencyDataPage(inputWith({ fetchFn, apiKey: "  " })),
    ).rejects.toMatchObject({ code: "ALMEDIA_API_KEY_MISSING" });
  });

  it("throws ALMEDIA_API_KEY_INVALID_FORMAT when the prefix is wrong", async () => {
    const { fetchFn } = stubFetch([() => jsonResponse(agencyDataResponse([]))]);
    await expect(
      fetchAgencyDataPage(inputWith({ fetchFn, apiKey: "sk_live_nope" })),
    ).rejects.toMatchObject({ code: "ALMEDIA_API_KEY_INVALID_FORMAT" });
  });

  it("throws ALMEDIA_AUTH_FAILED on 401", async () => {
    const { fetchFn } = stubFetch([
      () => jsonResponse({ error: "unauthorized" }, { status: 401 }),
    ]);
    await expect(fetchAgencyDataPage(inputWith({ fetchFn }))).rejects.toMatchObject({
      code: "ALMEDIA_AUTH_FAILED",
      status: 401,
    });
  });

  it("throws ALMEDIA_INVALID_RESPONSE when the body shape is wrong", async () => {
    const { fetchFn } = stubFetch([
      () => jsonResponse({ agency: "YourAgency", count: 1 }), // missing campaigns
    ]);
    await expect(fetchAgencyDataPage(inputWith({ fetchFn }))).rejects.toMatchObject({
      code: "ALMEDIA_INVALID_RESPONSE",
    });
  });

  it("throws ALMEDIA_INVALID_RESPONSE when the body is not JSON", async () => {
    const { fetchFn } = stubFetch([
      () => new Response("<html>oops</html>", { status: 200, headers: { "content-type": "application/json" } }),
    ]);
    await expect(fetchAgencyDataPage(inputWith({ fetchFn }))).rejects.toMatchObject({
      code: "ALMEDIA_INVALID_RESPONSE",
    });
  });

  it("throws ALMEDIA_REQUEST_FAILED on a network error", async () => {
    const { fetchFn } = stubFetch([
      () => {
        throw new TypeError("network down");
      },
    ]);
    await expect(
      fetchAgencyDataPage(inputWith({ fetchFn, maxRetries: 0 })),
    ).rejects.toMatchObject({ code: "ALMEDIA_REQUEST_FAILED" });
  });
});

describe("retry behavior", () => {
  it("retries a 429 and then succeeds", async () => {
    const { fetchFn, calls } = stubFetch([
      () => jsonResponse({ error: "rate limited" }, { status: 429 }),
      () => jsonResponse(agencyDataResponse([matureCampaign])),
    ]);

    const page = await fetchAgencyDataPage(inputWith({ fetchFn }));

    expect(page.campaigns).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("gives up with ALMEDIA_RATE_LIMITED after exhausting retries", async () => {
    const { fetchFn, calls } = stubFetch([
      () => jsonResponse({ error: "rate limited" }, { status: 429 }),
    ]);

    await expect(
      fetchAgencyDataPage(inputWith({ fetchFn, maxRetries: 2 })),
    ).rejects.toMatchObject({ code: "ALMEDIA_RATE_LIMITED" });
    expect(calls).toHaveLength(3); // initial + 2 retries
  });

  it("retries a 500 and then throws ALMEDIA_SERVER_ERROR when persistent", async () => {
    const { fetchFn, calls } = stubFetch([
      () => jsonResponse({ error: "boom" }, { status: 500 }),
    ]);

    await expect(
      fetchAgencyDataPage(inputWith({ fetchFn, maxRetries: 1 })),
    ).rejects.toMatchObject({ code: "ALMEDIA_SERVER_ERROR", status: 500 });
    expect(calls).toHaveLength(2);
  });

  it("honors the Retry-After header for the backoff delay", async () => {
    const delays: number[] = [];
    const { fetchFn } = stubFetch([
      () => jsonResponse({ error: "slow down" }, { status: 429, headers: { "retry-after": "2" } }),
      () => jsonResponse(agencyDataResponse([matureCampaign])),
    ]);

    await fetchAgencyDataPage({
      apiKey: "chak_test_key",
      fetchFn,
      sleepFn: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });

    expect(delays).toEqual([2000]);
  });
});

describe("fetchAllCampaigns", () => {
  it("pages until a short page is returned", async () => {
    const pageOne = [makeCampaign({ campaign_name: "A" }), makeCampaign({ campaign_name: "B" })];
    const pageTwo = [makeCampaign({ campaign_name: "C" })];
    const { fetchFn, calls } = stubFetch([
      () => jsonResponse(agencyDataResponse(pageOne, { limit: 2, offset: 0 })),
      () => jsonResponse(agencyDataResponse(pageTwo, { limit: 2, offset: 2 })),
    ]);

    const result = await fetchAllCampaigns(inputWith({ fetchFn, limit: 2 }));

    expect(result.pages).toBe(2);
    expect(result.campaigns.map((c) => c.campaignName)).toEqual(["A", "B", "C"]);
    expect(calls.map((call) => call.url.searchParams.get("offset"))).toEqual(["0", "2"]);
  });

  it("stops when a full first page is followed by an empty page", async () => {
    const pageOne = [makeCampaign({ campaign_name: "A" }), makeCampaign({ campaign_name: "B" })];
    const { fetchFn, calls } = stubFetch([
      () => jsonResponse(agencyDataResponse(pageOne, { limit: 2, offset: 0 })),
      () => jsonResponse(agencyDataResponse([], { limit: 2, offset: 2 })),
    ]);

    const result = await fetchAllCampaigns(inputWith({ fetchFn, limit: 2 }));

    expect(result.pages).toBe(2);
    expect(result.campaigns).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it("makes a single request when the first page is already short", async () => {
    const { fetchFn, calls } = stubFetch([
      () => jsonResponse(agencyDataResponse([matureCampaign], { limit: 500, offset: 0 })),
    ]);

    const result = await fetchAllCampaigns(inputWith({ fetchFn }));

    expect(result.pages).toBe(1);
    expect(calls).toHaveLength(1);
  });
});
