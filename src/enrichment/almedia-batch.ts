import type { AlmediaCampaign } from "../almedia/agency-data";
import type { Booking } from "../bookings/types";
import { campaignBaseKey } from "../migration/cell-utils";
import type {
  ChannelEnrichmentResult,
  ChannelEnrichmentService,
  EnrichmentSourceLink,
  StoredChannelEnrichment,
} from "./types";

export interface EnrichmentPersistence {
  findChannelEnrichment(
    sourceType: EnrichmentSourceLink["sourceType"],
    sourceKey: string,
  ): StoredChannelEnrichment | null;
  upsertChannelEnrichment(
    result: ChannelEnrichmentResult,
    links?: EnrichmentSourceLink[],
  ): StoredChannelEnrichment;
}

interface EnrichmentTask {
  channelKey: string;
  reference: string;
  links: EnrichmentSourceLink[];
}

export interface AlmediaEnrichmentFailure {
  channelKey: string;
  reference: string | null;
  error: string;
}

export interface AlmediaEnrichmentSummary {
  discovered: number;
  enriched: number;
  skippedFresh: number;
  skippedNoReference: number;
  failed: number;
  failures: AlmediaEnrichmentFailure[];
}

export interface RunAlmediaChannelEnrichmentOptions {
  campaigns: AlmediaCampaign[];
  bookings?: Booking[];
  service: ChannelEnrichmentService;
  persistence: EnrichmentPersistence;
  recentVideoLimit?: number;
  refreshAfterHours?: number;
  concurrency?: number;
  limit?: number;
  now?: () => Date;
  onProgress?: (message: string) => void;
}

function uniqueLinks(links: EnrichmentSourceLink[]): EnrichmentSourceLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.sourceType}:${link.sourceKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildTasks(
  campaigns: AlmediaCampaign[],
  bookings: Booking[],
): { tasks: EnrichmentTask[]; skippedNoReference: AlmediaEnrichmentFailure[] } {
  const youtube = campaigns.filter((campaign) => campaign.platform.toLowerCase() === "youtube");
  const byChannelKey = new Map<string, AlmediaCampaign[]>();
  for (const campaign of youtube) {
    const key = campaignBaseKey(campaign.campaignName);
    byChannelKey.set(key, [...(byChannelKey.get(key) ?? []), campaign]);
  }
  const bookingByKey = new Map<string, Booking>();
  for (const booking of bookings) {
    if (!bookingByKey.has(booking.channelKey)) bookingByKey.set(booking.channelKey, booking);
  }

  const tasks: EnrichmentTask[] = [];
  const skippedNoReference: AlmediaEnrichmentFailure[] = [];
  for (const [channelKey, rows] of byChannelKey) {
    const sorted = [...rows].sort(
      (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
    );
    const booking = bookingByKey.get(channelKey);
    const reference =
      sorted.find((campaign) => campaign.videoUrl)?.videoUrl ??
      booking?.channelUrl ??
      booking?.videoUrl ??
      null;
    if (!reference) {
      skippedNoReference.push({
        channelKey,
        reference: null,
        error: "No YouTube channel or video URL was available from Almedia or the matching booking.",
      });
      continue;
    }
    tasks.push({
      channelKey,
      reference,
      links: uniqueLinks([
        { sourceType: "channel_key", sourceKey: channelKey },
        ...rows.map((campaign) => ({
          sourceType: "campaign" as const,
          sourceKey: campaign.campaignName,
        })),
        ...(booking
          ? [{ sourceType: "booking" as const, sourceKey: String(booking.id) }]
          : []),
      ]),
    });
  }
  return { tasks, skippedNoReference };
}

/**
 * Enrich every distinct YouTube creator found in an Almedia campaign snapshot.
 *
 * This integration runner is deliberately separate from the core service. It
 * joins results to campaign names/channel keys through a replaceable persistence
 * interface and continues when individual channels fail.
 */
export async function runAlmediaChannelEnrichment(
  options: RunAlmediaChannelEnrichmentOptions,
): Promise<AlmediaEnrichmentSummary> {
  const now = options.now ?? (() => new Date());
  const refreshAfterMs = (options.refreshAfterHours ?? 168) * 60 * 60 * 1000;
  const recentVideoLimit = options.recentVideoLimit ?? 20;
  const concurrency = Math.max(1, Math.min(10, options.concurrency ?? 2));
  const built = buildTasks(options.campaigns, options.bookings ?? []);
  const tasks = options.limit === undefined ? built.tasks : built.tasks.slice(0, options.limit);
  const failures: AlmediaEnrichmentFailure[] = [];
  let enriched = 0;
  let skippedFresh = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      const task = tasks[index];
      if (!task) continue;

      const existing = options.persistence.findChannelEnrichment("channel_key", task.channelKey);
      const generatedAt = existing ? Date.parse(existing.result.meta.generatedAt) : Number.NaN;
      if (
        existing &&
        refreshAfterMs > 0 &&
        Number.isFinite(generatedAt) &&
        now().getTime() - generatedAt < refreshAfterMs
      ) {
        skippedFresh += 1;
        options.onProgress?.(`Skipped fresh enrichment for ${task.channelKey}`);
        continue;
      }

      try {
        const result = await options.service.enrich({
          input: task.reference,
          recentVideoLimit,
        });
        options.persistence.upsertChannelEnrichment(result, task.links);
        enriched += 1;
        options.onProgress?.(`Enriched ${task.channelKey} as ${result.channel.title}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          channelKey: task.channelKey,
          reference: task.reference,
          error: message,
        });
        options.onProgress?.(`Failed ${task.channelKey}: ${message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));

  return {
    discovered: built.tasks.length + built.skippedNoReference.length,
    enriched,
    skippedFresh,
    skippedNoReference: built.skippedNoReference.length,
    failed: failures.length,
    failures: [...built.skippedNoReference, ...failures],
  };
}
