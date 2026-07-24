import type {
  ContentFormat,
  CreatorMetrics,
  PublicChannel,
  RecentContentItem,
} from "./types";

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function formatMix(items: RecentContentItem[]): CreatorMetrics["contentFormat"] {
  const formats: ContentFormat[] = ["short", "long_form", "live", "unknown"];
  const counts = new Map<ContentFormat, number>(formats.map((format) => [format, 0]));
  for (const item of items) {
    counts.set(item.format, (counts.get(item.format) ?? 0) + 1);
  }
  const total = items.length;
  const mix = formats.map((format) => {
    const count = counts.get(format) ?? 0;
    return {
      format,
      count,
      sharePct: total > 0 ? round((count / total) * 100) : 0,
    };
  });
  const dominant =
    total === 0
      ? "unknown"
      : mix.reduce((best, item) => (item.count > best.count ? item : best)).format;
  return { dominant, mix };
}

/** Calculate deterministic creator metrics from normalized public YouTube data. */
export function calculateCreatorMetrics(
  channel: PublicChannel,
  recentContent: RecentContentItem[],
  now = new Date(),
): CreatorMetrics {
  const viewSamples = recentContent
    .map((item) => item.views)
    .filter((value): value is number => value !== null);
  const engagementSamples = recentContent.flatMap((item) => {
    if (item.views === null || item.views <= 0) return [];
    const likes = item.likes ?? 0;
    const comments = item.comments ?? 0;
    if (item.likes === null && item.comments === null) return [];
    return [((likes + comments) / item.views) * 100];
  });
  const typicalViews = median(viewSamples);
  const publishedTimes = recentContent
    .map((item) => Date.parse(item.publishedAt))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a);
  const nowMs = now.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const newest = publishedTimes[0];
  const oldest = publishedTimes[publishedTimes.length - 1];
  const observedDays =
    newest !== undefined && oldest !== undefined ? Math.max(1, (newest - oldest) / dayMs) : null;
  const uploadsPerWeek =
    observedDays === null || publishedTimes.length < 2
      ? null
      : round(((publishedTimes.length - 1) / observedDays) * 7);

  return {
    followers: channel.subscribers,
    totalViews: channel.totalViews,
    totalVideos: channel.totalVideos,
    typicalViews: {
      median: typicalViews === null ? null : round(typicalViews),
      average: viewSamples.length === 0 ? null : round(average(viewSamples) ?? 0),
      sampleSize: viewSamples.length,
    },
    typicalEngagementRatePct:
      engagementSamples.length === 0 ? null : round(median(engagementSamples) ?? 0),
    typicalViewsPerFollowerPct:
      typicalViews === null || channel.subscribers === null || channel.subscribers <= 0
        ? null
        : round((typicalViews / channel.subscribers) * 100),
    contentFormat: formatMix(recentContent),
    uploadActivity: {
      lastUploadAt: newest === undefined ? null : new Date(newest).toISOString(),
      daysSinceLastUpload:
        newest === undefined ? null : round(Math.max(0, (nowMs - newest) / dayMs), 1),
      uploadsLast30Days: publishedTimes.filter((time) => time <= nowMs && nowMs - time <= 30 * dayMs)
        .length,
      uploadsLast90Days: publishedTimes.filter((time) => time <= nowMs && nowMs - time <= 90 * dayMs)
        .length,
      uploadsPerWeek,
    },
  };
}
