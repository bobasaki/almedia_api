import { describe, expect, it } from "vitest";

import {
  YouTubeDataApiAdapter,
  parseIsoDurationSeconds,
  parseYouTubeReference,
} from "./youtube-adapter";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("YouTube reference parsing", () => {
  it("accepts channel IDs, handles, channel URLs, and video/Shorts URLs", () => {
    expect(parseYouTubeReference("UC1234567890123456789012")).toMatchObject({
      kind: "channel_id",
    });
    expect(parseYouTubeReference("@creator")).toEqual({
      kind: "handle",
      value: "creator",
      resolvedVia: "handle",
    });
    expect(parseYouTubeReference("https://youtube.com/channel/UC1234567890123456789012")).toMatchObject({
      kind: "channel_id",
    });
    expect(parseYouTubeReference("https://youtu.be/abcdefghijk")).toEqual({
      kind: "video",
      value: "abcdefghijk",
      resolvedVia: "video",
    });
    expect(parseYouTubeReference("https://youtube.com/shorts/abcdefghijk")).toMatchObject({
      kind: "video",
    });
  });

  it("parses ISO-8601 YouTube durations", () => {
    expect(parseIsoDurationSeconds("PT1H2M3S")).toBe(3723);
    expect(parseIsoDurationSeconds("PT45S")).toBe(45);
    expect(parseIsoDurationSeconds("invalid")).toBeNull();
  });
});

describe("YouTube Data API adapter", () => {
  it("resolves a video to its channel and normalizes recent public content", async () => {
    const calls: URL[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = new URL(String(input));
      calls.push(url);
      const path = url.pathname.split("/").at(-1);
      const part = url.searchParams.get("part");
      if (path === "videos" && part === "snippet") {
        return json({
          items: [
            {
              id: "abcdefghijk",
              snippet: {
                channelId: "UC1234567890123456789012",
                title: "Source video",
                description: "",
                publishedAt: "2026-07-20T00:00:00Z",
                liveBroadcastContent: "none",
              },
            },
          ],
        });
      }
      if (path === "channels") {
        return json({
          items: [
            {
              id: "UC1234567890123456789012",
              snippet: {
                title: "Test Creator",
                description: "Gaming creator",
                customUrl: "@testcreator",
                publishedAt: "2020-01-01T00:00:00Z",
                country: "pl",
                thumbnails: {
                  high: { url: "https://img.example/channel.jpg" },
                },
              },
              statistics: {
                viewCount: "50000",
                subscriberCount: "1000",
                hiddenSubscriberCount: false,
                videoCount: "30",
              },
              contentDetails: {
                relatedPlaylists: { uploads: "UU123" },
              },
              topicDetails: {
                topicCategories: ["https://en.wikipedia.org/wiki/Action_game"],
              },
              brandingSettings: {
                channel: { keywords: '"gaming creator" reviews' },
              },
            },
          ],
        });
      }
      if (path === "playlistItems") {
        return json({
          items: [{ contentDetails: { videoId: "video000001" } }],
        });
      }
      if (path === "videos") {
        return json({
          items: [
            {
              id: "video000001",
              snippet: {
                channelId: "UC1234567890123456789012",
                title: "Fast review #shorts",
                description: "A quick review",
                publishedAt: "2026-07-22T00:00:00Z",
                tags: ["gaming", "shorts"],
                categoryId: "20",
                liveBroadcastContent: "none",
              },
              statistics: {
                viewCount: "2500",
                likeCount: "100",
                commentCount: "20",
              },
              contentDetails: { duration: "PT45S" },
            },
          ],
        });
      }
      throw new Error(`Unexpected request ${url.pathname}?${url.searchParams}`);
    };
    const adapter = new YouTubeDataApiAdapter({
      apiKey: "test-key",
      fetchFn,
      maxRetries: 0,
    });

    const result = await adapter.collect("https://youtu.be/abcdefghijk", 20);

    expect(calls).toHaveLength(4);
    expect(result.input.resolvedVia).toBe("video");
    expect(result.channel).toMatchObject({
      id: "UC1234567890123456789012",
      handle: "@testcreator",
      country: "PL",
      subscribers: 1000,
      topics: ["Action game"],
      keywords: ["gaming creator", "reviews"],
    });
    expect(result.recentContent[0]).toMatchObject({
      id: "video000001",
      durationSeconds: 45,
      views: 2500,
      likes: 100,
      comments: 20,
      format: "short",
    });
    expect(result.warnings).toContainEqual({
      code: "FEWER_UPLOADS_THAN_REQUESTED",
      message: "Only 1 public upload was available out of 20 requested.",
    });
  });

  it("rejects malformed provider responses before normalization", async () => {
    const adapter = new YouTubeDataApiAdapter({
      apiKey: "test-key",
      fetchFn: async () => json({ items: [{ unexpected: true }] }),
      maxRetries: 0,
    });

    await expect(adapter.collect("https://youtu.be/abcdefghijk", 20)).rejects.toMatchObject({
      code: "YOUTUBE_INVALID_RESPONSE",
    });
  });
});
