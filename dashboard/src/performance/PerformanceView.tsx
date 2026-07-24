import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  filterCampaigns,
  getMaturityInfo,
  getReturnTier,
  monthlyPerformance,
  platformGroups,
  RETURN_TIERS,
  returnTierGroups,
  sum,
  weightedAverage,
  type MonthlyPerformance,
} from "../analytics";
import type { Campaign, CampaignFilters, CampaignPayload } from "../types";
import type { StoredChannelEnrichment } from "../../../src/enrichment/types";
import { deriveVerticals } from "./verticals";

const compactNumber = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const wholeNumber = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const decimalNumber = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const detailNumber = new Intl.NumberFormat("en", { maximumFractionDigits: 4 });
const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const timeFormatter = new Intl.DateTimeFormat("en", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const EMPTY_FILTERS: CampaignFilters = {
  platform: "all",
  country: "all",
  returnTier: "all",
  maturity: "all",
  from: "",
  to: "",
  search: "",
};

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : "—";
}

function formatMetric(
  value: number | null,
  kind: "number" | "decimal" | "percent" | "return" | "roas" = "number",
): string {
  if (value === null) return "—";
  if (kind === "decimal") return decimalNumber.format(value);
  if (kind === "percent") return `${decimalNumber.format(value * 100)}%`;
  if (kind === "return") return `${decimalNumber.format(value)}%`;
  if (kind === "roas") return `${decimalNumber.format(value)}×`;
  return wholeNumber.format(value);
}

function platformLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function KpiCard({
  label,
  value,
  context,
}: {
  label: string;
  value: string;
  context: string;
}) {
  return (
    <article className="kpi-card">
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{context}</span>
    </article>
  );
}

function PerformanceChart({ data }: { data: MonthlyPerformance[] }) {
  if (data.length === 0) {
    return <div className="empty-chart">No dated campaigns match these filters.</div>;
  }

  const width = 900;
  const height = 310;
  const margin = { top: 24, right: 50, bottom: 50, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxCost = Math.max(...data.map((item) => item.cost), 1);
  const maxRoas = Math.max(...data.map((item) => item.roas ?? 0), 1);
  const step = plotWidth / data.length;
  const barWidth = Math.max(8, Math.min(34, step * 0.52));
  const x = (index: number) => margin.left + step * index + step / 2;
  const costY = (value: number) => margin.top + plotHeight - (value / maxCost) * plotHeight;
  const roasY = (value: number) => margin.top + plotHeight - (value / maxRoas) * plotHeight;
  const points = data
    .map((item, index) => (item.roas === null ? null : `${x(index)},${roasY(item.roas)}`))
    .filter(Boolean)
    .join(" ");
  const tickEvery = Math.max(1, Math.ceil(data.length / 7));

  return (
    <svg
      className="performance-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby="performance-chart-title performance-chart-description"
    >
      <title id="performance-chart-title">Monthly cost and lifetime ROAS</title>
      <desc id="performance-chart-description">
        Bars show total campaign cost per month and the line shows cost-weighted lifetime ROAS.
      </desc>
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
        const y = margin.top + plotHeight * (1 - fraction);
        return (
          <g key={fraction}>
            <line className="chart-gridline" x1={margin.left} x2={width - margin.right} y1={y} y2={y} />
            <text className="chart-axis-label" x={margin.left - 10} y={y + 4} textAnchor="end">
              {compactNumber.format(maxCost * fraction)}
            </text>
            <text className="chart-axis-label" x={width - margin.right + 10} y={y + 4} textAnchor="start">
              {(maxRoas * fraction).toFixed(1)}×
            </text>
          </g>
        );
      })}
      {data.map((item, index) => {
        const top = costY(item.cost);
        return (
          <g key={item.key}>
            <rect
              className="chart-bar"
              x={x(index) - barWidth / 2}
              y={top}
              width={barWidth}
              height={margin.top + plotHeight - top}
              rx={4}
            >
              <title>{`${item.label}: ${wholeNumber.format(item.cost)} cost across ${item.campaigns} campaigns`}</title>
            </rect>
            {(index % tickEvery === 0 || index === data.length - 1) && (
              <text className="chart-axis-label" x={x(index)} y={height - 20} textAnchor="middle">
                {item.label}
              </text>
            )}
          </g>
        );
      })}
      {points && <polyline className="chart-line" points={points} fill="none" />}
      {data.map((item, index) =>
        item.roas === null ? null : (
          <circle className="chart-point" key={item.key} cx={x(index)} cy={roasY(item.roas)} r={4}>
            <title>{`${item.label}: ${decimalNumber.format(item.roas)}× lifetime ROAS`}</title>
          </circle>
        ),
      )}
    </svg>
  );
}

type SortKey =
  | "campaignName"
  | "campaignSource"
  | "channelName"
  | "platform"
  | "country"
  | "publishedAt"
  | "cost"
  | "expectedCpm"
  | "viewCount"
  | "signupsPct"
  | "roasD7pD14"
  | "roasReturn"
  | "returnPct"
  | "appuD14"
  | "d7Purchases";

function returnTierLabel(value: number | null): string {
  const tier = getReturnTier(value);
  return RETURN_TIERS.find((item) => item.id === tier)?.label ?? "Unclassified";
}

function maturityLabel(publishedAt: string | null): { status: string; label: string } {
  const maturity = getMaturityInfo(publishedAt);
  if (maturity.status === "matured") return { status: "matured", label: "Matured" };
  if (maturity.status === "maturing") {
    return {
      status: "maturing",
      label: `Maturing · ${maturity.daysRemaining ?? "—"}d`,
    };
  }
  return { status: "unknown", label: "Unknown" };
}

function detailLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function DetailGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="campaign-detail-grid">
      {items.map((item) => (
        <div className="campaign-detail-item" key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChipList({ values }: { values: string[] }) {
  if (values.length === 0) return <span className="detail-empty">—</span>;
  return (
    <div className="detail-chips">
      {values.map((value) => <span key={value}>{value}</span>)}
    </div>
  );
}

function EnrichmentDetails({
  stored,
  summary,
}: {
  stored: StoredChannelEnrichment | null;
  summary: Campaign["enrichment"];
}) {
  const result = stored?.result ?? summary;
  if (!result) return null;

  const { channel, metrics, classification } = result;
  const recentContent = stored?.result.recentContent ?? [];
  const channelTitle = channel.title || "Enriched creator";
  const channelReference = channel.handle ?? channel.url;
  const reachItems: Array<{ label: string; value: ReactNode }> = [
    {
      label: "Subscribers",
      value: channel.subscribersHidden ? "Hidden" : formatMetric(channel.subscribers),
    },
    { label: "Channel views", value: formatMetric(channel.totalViews) },
    { label: "Published videos", value: formatMetric(channel.totalVideos) },
    { label: "Typical views", value: formatMetric(metrics.typicalViews.median) },
    { label: "Average views", value: formatMetric(metrics.typicalViews.average) },
    { label: "Engagement rate", value: formatMetric(metrics.typicalEngagementRatePct, "return") },
    { label: "Views per follower", value: formatMetric(metrics.typicalViewsPerFollowerPct, "return") },
    { label: "Content format", value: detailLabel(metrics.contentFormat.dominant) },
    { label: "Uploads per week", value: formatMetric(metrics.uploadActivity.uploadsPerWeek, "decimal") },
    { label: "Last upload", value: formatDate(metrics.uploadActivity.lastUploadAt) },
  ];
  const audienceItems: Array<{ label: string; value: ReactNode }> = [
    { label: "Niche", value: classification.niche },
    { label: "Primary language", value: classification.language.primary },
    { label: "Brand fit", value: detailLabel(classification.brandFit.suitability) },
    { label: "Safety risk", value: detailLabel(classification.brandSafety.risk) },
  ];

  return (
    <div className="resolved-enrichment">
      <div className="resolved-channel-heading">
        <div>
          <span>Creator enrichment</span>
          <a className="resolved-channel-link" href={channel.url} target="_blank" rel="noopener noreferrer">
            {channelTitle} ↗
          </a>
          <p>{channelReference}</p>
        </div>
        <span className="resolved-channel-count">1 channel</span>
      </div>

      <section className="creator-summary-card" aria-labelledby="creator-summary-heading">
        <h4 id="creator-summary-heading">Creator overview</h4>
        <p>{result.summary}</p>
        {channel.description && <p className="creator-description">{channel.description}</p>}
      </section>

      <section className="enrichment-subsection" aria-labelledby="creator-reach-heading">
        <h4 id="creator-reach-heading">Reach and activity</h4>
        <DetailGrid items={reachItems} />
      </section>

      <section className="enrichment-subsection" aria-labelledby="creator-audience-heading">
        <h4 id="creator-audience-heading">Audience and suitability</h4>
        <DetailGrid items={audienceItems} />
        <div className="user-facing-notes">
          <article>
            <span>Audience positioning</span>
            <p>{classification.audiencePositioning}</p>
          </article>
          <article>
            <span>Topics</span>
            <ChipList values={classification.topics} />
          </article>
          <article>
            <span>Brand categories</span>
            <ChipList values={classification.brandFit.categories} />
            <p>{classification.brandFit.rationale}</p>
          </article>
          <article>
            <span>Brand safety</span>
            <ChipList values={classification.brandSafety.concerns} />
            <p>{classification.brandSafety.rationale}</p>
          </article>
        </div>
      </section>

      {recentContent.length > 0 && (
        <details className="recent-content-details">
          <summary>Recent content from this channel ({recentContent.length})</summary>
          <div className="recent-content-list">
            {recentContent.slice(0, 5).map((item) => (
              <article className="recent-content-item" key={item.id}>
                <div>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title || "Untitled video"} ↗</a>
                  <p>{formatDate(item.publishedAt)} · {detailLabel(item.format)}</p>
                </div>
                <dl>
                  <div><dt>Views</dt><dd>{formatMetric(item.views)}</dd></div>
                  <div><dt>Likes</dt><dd>{formatMetric(item.likes)}</dd></div>
                  <div><dt>Comments</dt><dd>{formatMetric(item.comments)}</dd></div>
                </dl>
              </article>
            ))}
            {recentContent.length > 5 && (
              <p className="recent-content-note">Showing the latest 5 of {recentContent.length} analyzed videos.</p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function CampaignDetailDialog({
  campaign,
  onClose,
}: {
  campaign: Campaign;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const maturity = maturityLabel(campaign.publishedAt);
  const [fullEnrichment, setFullEnrichment] = useState<StoredChannelEnrichment | null>(null);
  const [enrichmentLoading, setEnrichmentLoading] = useState(true);
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    const channelId = campaign.enrichment?.channel.id;
    const controller = new AbortController();
    const loadFullEnrichment = async () => {
      try {
        const endpoint = channelId
          ? `/api/enrichments/${encodeURIComponent(channelId)}`
          : `/api/enrichments?sourceType=campaign&sourceKey=${encodeURIComponent(campaign.campaignName)}`;
        const response = await fetch(endpoint, {
          signal: controller.signal,
        });
        const body = (await response.json()) as {
          enrichment?: StoredChannelEnrichment;
          enrichments?: StoredChannelEnrichment[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(body.error ?? "Unable to load complete enrichment data");
        }
        setFullEnrichment(body.enrichment ?? body.enrichments?.[0] ?? null);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setEnrichmentError(caught instanceof Error ? caught.message : "Unable to load complete enrichment data");
      } finally {
        if (!controller.signal.aborted) setEnrichmentLoading(false);
      }
    };

    void loadFullEnrichment();
    return () => controller.abort();
  }, [campaign.campaignName, campaign.enrichment?.channel.id]);

  const campaignDetails: Array<{ label: string; value: ReactNode }> = [
    { label: "Campaign", value: campaign.campaignName },
    {
      label: "Vertical",
      value: (() => {
        const verticals = deriveVerticals(fullEnrichment?.result ?? campaign.enrichment);
        return verticals.length > 0
          ? <div className="vertical-chips">{verticals.map((vertical) => <span key={vertical}>{vertical}</span>)}</div>
          : "—";
      })(),
    },
    { label: "Campaign channel", value: campaign.channelName ?? "—" },
    { label: "Platform", value: platformLabel(campaign.platform) },
    { label: "Country", value: campaign.country },
    { label: "Published", value: formatDate(campaign.publishedAt) },
    { label: "Cost", value: campaign.cost === null ? "—" : detailNumber.format(campaign.cost) },
    { label: "Expected CPM", value: formatMetric(campaign.expectedCpm, "decimal") },
    { label: "Views", value: formatMetric(campaign.viewCount) },
    { label: "Signups", value: formatMetric(campaign.signupsPct, "percent") },
    { label: "D7 → D14 ROAS", value: formatMetric(campaign.roasD7pD14, "roas") },
    { label: "Lifetime ROAS", value: formatMetric(campaign.roasReturn, "roas") },
    { label: "Return", value: formatMetric(campaign.returnPct, "return") },
    { label: "APPU D14", value: formatMetric(campaign.appuD14, "decimal") },
    { label: "D7 purchases", value: formatMetric(campaign.d7Purchases) },
    { label: "Action", value: returnTierLabel(campaign.returnPct) },
    { label: "Maturity", value: maturity.label },
    {
      label: "Published video",
      value: campaign.videoUrl
        ? <a href={campaign.videoUrl} target="_blank" rel="noopener noreferrer">Open video ↗</a>
        : "—",
    },
  ];

  return (
    <dialog
      className="campaign-detail-dialog"
      ref={dialogRef}
      aria-labelledby="campaign-detail-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article className="campaign-detail-card">
        <header className="campaign-detail-header">
          <div>
            <p className="eyebrow">Performance row</p>
            <h2 id="campaign-detail-title">{campaign.campaignName}</h2>
            <div className="campaign-detail-badges">
              <span className={`platform platform-${campaign.platform}`}>{platformLabel(campaign.platform)}</span>
              <span className={`tier-badge tier-${getReturnTier(campaign.returnPct) ?? "unclassified"}`}>
                {returnTierLabel(campaign.returnPct)}
              </span>
              <span className={`maturity-badge maturity-${maturity.status}`}>{maturity.label}</span>
            </div>
          </div>
          <button className="detail-close" type="button" aria-label="Close campaign details" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="campaign-detail-body">
          <section className="campaign-detail-section" aria-labelledby="campaign-data-heading">
            <div className="campaign-detail-section-heading">
              <p className="eyebrow">Complete record</p>
              <h3 id="campaign-data-heading">Campaign data</h3>
            </div>
            <DetailGrid items={campaignDetails} />
          </section>

          <section className="campaign-detail-section" aria-labelledby="creator-data-heading">
            <div className="campaign-detail-section-heading">
              <p className="eyebrow">Creator profile</p>
              <h3 id="creator-data-heading">Complete enrichment data</h3>
            </div>
            {enrichmentLoading && (
              <p className="detail-loading" role="status">Loading recent content and full enrichment metadata…</p>
            )}
            {enrichmentError && (
              <p className="detail-warning" role="alert">
                {enrichmentError}. The available enrichment summary is shown below.
              </p>
            )}
            {(fullEnrichment || campaign.enrichment) ? (
              <EnrichmentDetails stored={fullEnrichment} summary={campaign.enrichment} />
            ) : !enrichmentLoading && (
              <p className="detail-unavailable">No creator enrichment is attached to this campaign.</p>
            )}
          </section>
        </div>
      </article>
    </dialog>
  );
}

function CampaignTable({ campaigns }: { campaigns: Campaign[] }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "publishedAt",
    direction: "desc",
  });
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const selectedRowRef = useRef<HTMLElement | null>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...campaigns].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null) return 1;
      if (bv === null) return -1;
      return (typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv))) * direction;
    });
  }, [campaigns, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };

  const sortLabel = (key: SortKey) => (sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : "");

  const openDetails = (campaign: Campaign) => {
    selectedRowRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setSelectedCampaign(campaign);
  };

  const closeDetails = () => {
    setSelectedCampaign(null);
    window.requestAnimationFrame(() => selectedRowRef.current?.focus());
  };

  const scrollTable = (direction: -1 | 1) => {
    const container = tableWrapRef.current;
    if (!container) return;
    container.scrollBy({
      left: direction * Math.max(320, container.clientWidth * 0.78),
      behavior: "smooth",
    });
  };

  return (
    <>
      <div className="table-scroll-controls">
        <span>Scroll to see every performance field</span>
        <div>
          <button type="button" aria-label="Scroll table left" onClick={() => scrollTable(-1)}>←</button>
          <button type="button" aria-label="Scroll table right" onClick={() => scrollTable(1)}>→</button>
        </div>
      </div>
      <div
        className="table-wrap"
        id="performance-table-scroll-region"
        ref={tableWrapRef}
        role="region"
        aria-label="Scrollable campaign performance table"
        tabIndex={0}
      >
        <table className="performance-table">
        <thead>
          <tr>
            <th><button onClick={() => toggleSort("campaignName")}>Campaign{sortLabel("campaignName")}</button></th>
            <th><button onClick={() => toggleSort("campaignSource")}>Source{sortLabel("campaignSource")}</button></th>
            <th><button onClick={() => toggleSort("channelName")}>Channel{sortLabel("channelName")}</button></th>
            <th><button onClick={() => toggleSort("platform")}>Platform{sortLabel("platform")}</button></th>
            <th><button onClick={() => toggleSort("country")}>Country{sortLabel("country")}</button></th>
            <th><button onClick={() => toggleSort("publishedAt")}>Published{sortLabel("publishedAt")}</button></th>
            <th className="numeric"><button onClick={() => toggleSort("cost")}>Cost{sortLabel("cost")}</button></th>
            <th className="numeric"><button onClick={() => toggleSort("expectedCpm")}>Expected CPM{sortLabel("expectedCpm")}</button></th>
            <th className="numeric"><button onClick={() => toggleSort("viewCount")}>Views{sortLabel("viewCount")}</button></th>
            <th className="numeric"><button onClick={() => toggleSort("signupsPct")}>Signups{sortLabel("signupsPct")}</button></th>
            <th className="numeric"><button onClick={() => toggleSort("roasD7pD14")}>D7 → D14 ROAS{sortLabel("roasD7pD14")}</button></th>
            <th className="numeric"><button onClick={() => toggleSort("roasReturn")}>Lifetime ROAS{sortLabel("roasReturn")}</button></th>
            <th className="numeric"><button onClick={() => toggleSort("returnPct")}>Return{sortLabel("returnPct")}</button></th>
            <th className="numeric"><button onClick={() => toggleSort("appuD14")}>APPU D14{sortLabel("appuD14")}</button></th>
            <th className="numeric"><button onClick={() => toggleSort("d7Purchases")}>D7 purchases{sortLabel("d7Purchases")}</button></th>
            <th className="action-column">Action</th>
            <th>Maturity</th>
            <th>Video</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((campaign, index) => {
            const maturity = maturityLabel(campaign.publishedAt);
            return (
            <tr
              className="performance-row"
              key={`${campaign.campaignName}-${campaign.publishedAt ?? "undated"}-${index}`}
              onClick={() => openDetails(campaign)}
            >
              <td className="campaign-name">
                <button
                  className="row-detail-button"
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={`Open all data for ${campaign.campaignName}`}
                >
                  {campaign.campaignName}
                </button>
              </td>
              <td>{campaign.campaignSource}</td>
              <td className="channel-cell">{campaign.channelName ?? "—"}</td>
              <td><span className={`platform platform-${campaign.platform}`}>{platformLabel(campaign.platform)}</span></td>
              <td>{campaign.country}</td>
              <td>{formatDate(campaign.publishedAt)}</td>
              <td className="numeric">{formatMetric(campaign.cost)}</td>
              <td className="numeric">{formatMetric(campaign.expectedCpm, "decimal")}</td>
              <td className="numeric">{formatMetric(campaign.viewCount)}</td>
              <td className="numeric">{formatMetric(campaign.signupsPct, "percent")}</td>
              <td className="numeric">{formatMetric(campaign.roasD7pD14, "roas")}</td>
              <td className="numeric">{formatMetric(campaign.roasReturn, "roas")}</td>
              <td className="numeric metric-emphasis">{formatMetric(campaign.returnPct, "return")}</td>
              <td className="numeric">{formatMetric(campaign.appuD14, "decimal")}</td>
              <td className="numeric">{formatMetric(campaign.d7Purchases)}</td>
              <td className="action-column"><span className={`tier-badge tier-${getReturnTier(campaign.returnPct) ?? "unclassified"}`}>{returnTierLabel(campaign.returnPct)}</span></td>
              <td><span className={`maturity-badge maturity-${maturity.status}`}>{maturity.label}</span></td>
              <td>
                {campaign.videoUrl ? (
                  <a
                    className="video-link"
                    href={campaign.videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open published video"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    Open ↗
                  </a>
                ) : "—"}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="table-empty">No campaigns match the current filters.</p>}
      </div>
      {selectedCampaign && <CampaignDetailDialog campaign={selectedCampaign} onClose={closeDetails} />}
    </>
  );
}

function downloadCsv(campaigns: Campaign[]): void {
  const headers: Array<keyof Campaign> = [
    "campaignName", "channelName", "campaignSource", "platform", "country", "publishedAt", "cost", "expectedCpm",
    "viewCount", "signupsPct", "roasD7pD14", "roasReturn", "returnPct", "appuD14", "d7Purchases", "videoUrl",
  ];
  const escape = (value: unknown) => {
    if (value === null) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = [headers.join(","), ...campaigns.map((row) => headers.map((key) => escape(row[key])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "campaigns-filtered.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function PerformanceView() {
  const [payload, setPayload] = useState<CampaignPayload | null>(null);
  const [filters, setFilters] = useState<CampaignFilters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false, signal?: AbortSignal) => {
    force ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns${force ? "?refresh=1" : ""}`, { signal });
      const body = (await response.json()) as CampaignPayload | { error?: string };
      if (!response.ok) throw new Error("error" in body ? body.error : "Unable to load campaigns");
      setPayload(body as CampaignPayload);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "Unable to load campaigns");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  const platforms = useMemo(
    () => [...new Set(payload?.campaigns.map((campaign) => campaign.platform) ?? [])].sort(),
    [payload],
  );
  const countries = useMemo(
    () => [...new Set(payload?.campaigns.map((campaign) => campaign.country) ?? [])].sort(),
    [payload],
  );
  const filtered = useMemo(
    () => filterCampaigns(payload?.campaigns ?? [], filters),
    [payload, filters],
  );
  const tierBaseCampaigns = useMemo(
    () => filterCampaigns(payload?.campaigns ?? [], { ...filters, returnTier: "all" }),
    [payload, filters],
  );
  const tierStats = useMemo(() => returnTierGroups(tierBaseCampaigns), [tierBaseCampaigns]);
  const months = useMemo(() => monthlyPerformance(filtered), [filtered]);
  const platformStats = useMemo(() => platformGroups(filtered), [filtered]);
  const totalCost = sum(filtered, "cost");
  const totalViews = sum(filtered, "viewCount");
  const totalPurchases = sum(filtered, "d7Purchases");
  const lifetimeRoas = weightedAverage(filtered, "roasReturn", "cost");
  const maxPlatformRoas = Math.max(...platformStats.map((item) => item.roas ?? 0), 1);

  if (loading && !payload) {
    return (
      <main className="loading-state" aria-live="polite">
        <div className="loader" />
        <h1>Loading campaign performance</h1>
        <p>Fetching the latest private agency data…</p>
      </main>
    );
  }

  if (error && !payload) {
    return (
      <main className="error-state">
        <p className="eyebrow">Dashboard unavailable</p>
        <h1>Campaign data could not be loaded</h1>
        <p>{error}</p>
        <button className="button primary" onClick={() => void load()}>Try again</button>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <section className="hero">
        <div>
          <p className="eyebrow">Performance overview</p>
          <h1>Your campaigns, clearly measured.</h1>
          <p className="hero-copy">Track investment, reach, purchases, and return across every publishing platform.</p>
        </div>
        <div className="hero-side">
          <div className="record-count">
            <strong>{wholeNumber.format(filtered.length)}</strong>
            <span>of {wholeNumber.format(payload?.count ?? 0)} campaigns</span>
          </div>
          <div className="view-actions">
            <p>Updated {payload ? timeFormatter.format(new Date(payload.fetchedAt)) : "—"}</p>
            <button className="button" disabled={refreshing} onClick={() => void load(true)}>
              <span className={refreshing ? "refresh-icon spinning" : "refresh-icon"}>↻</span>
              {refreshing ? "Refreshing" : "Refresh data"}
            </button>
          </div>
        </div>
      </section>

      {error && <div className="inline-error" role="alert">Refresh failed: {error}</div>}

      <section className="filters" aria-label="Campaign filters">
        <label className="search-field">
          <span>Search campaign</span>
          <input
            type="search"
            placeholder="Campaign or channel"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </label>
        <label>
          <span>Platform</span>
          <select value={filters.platform} onChange={(event) => setFilters({ ...filters, platform: event.target.value })}>
            <option value="all">All platforms</option>
            {platforms.map((platform) => <option key={platform} value={platform}>{platformLabel(platform)}</option>)}
          </select>
        </label>
        <label>
          <span>Country</span>
          <select value={filters.country} onChange={(event) => setFilters({ ...filters, country: event.target.value })}>
            <option value="all">All countries</option>
            {countries.map((country) => <option key={country} value={country}>{country}</option>)}
          </select>
        </label>
        <label>
          <span>Return tier</span>
          <select value={filters.returnTier} onChange={(event) => setFilters({ ...filters, returnTier: event.target.value })}>
            <option value="all">All return tiers</option>
            {RETURN_TIERS.map((tier) => <option key={tier.id} value={tier.id}>{tier.label} · {tier.range}</option>)}
          </select>
        </label>
        <label>
          <span>Maturity</span>
          <select value={filters.maturity} onChange={(event) => setFilters({ ...filters, maturity: event.target.value })}>
            <option value="all">All maturity</option>
            <option value="matured">Matured · 14+ days</option>
            <option value="maturing">Maturing · under 14 days</option>
            <option value="unknown">Unknown publish date</option>
          </select>
        </label>
        <label>
          <span>From</span>
          <input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} />
        </label>
        <label>
          <span>To</span>
          <input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} />
        </label>
        <button className="button ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button>
      </section>

      <section className="kpi-grid" aria-label="Key performance indicators">
        <KpiCard label="Total cost" value={compactNumber.format(totalCost)} context={`${filtered.length} selected campaigns`} />
        <KpiCard label="Total views" value={compactNumber.format(totalViews)} context={`${totalViews ? decimalNumber.format((totalCost / totalViews) * 1000) : "—"} cost per 1K views`} />
        <KpiCard label="D7 purchases" value={compactNumber.format(totalPurchases)} context={`${totalViews ? decimalNumber.format((totalPurchases / totalViews) * 1000) : "—"} per 1K views`} />
        <KpiCard label="Lifetime ROAS" value={lifetimeRoas === null ? "—" : `${decimalNumber.format(lifetimeRoas)}×`} context="Cost-weighted average" />
      </section>

      <section className="panel tier-panel" aria-labelledby="return-tier-heading">
        <div className="panel-heading">
          <div><p className="eyebrow">Decision view</p><h2 id="return-tier-heading">Return action tiers</h2></div>
          <p className="tier-note">
            {filters.returnTier === "all"
              ? "Select a tier to filter the dashboard"
              : `${RETURN_TIERS.find((tier) => tier.id === filters.returnTier)?.label ?? "Tier"} selected`}
          </p>
        </div>
        <div className="tier-strip" role="img" aria-label="Share of campaigns in each return action tier">
          {tierStats.map((tier) => (
            <span
              className={`tier-segment tier-${tier.id}`}
              key={tier.id}
              style={{ width: `${tier.share * 100}%` }}
              title={`${tier.label}: ${tier.count} campaigns`}
            />
          ))}
        </div>
        <div className="tier-grid">
          {tierStats.map((tier) => (
            <button
              type="button"
              className={`tier-summary tier-${tier.id}`}
              key={tier.id}
              aria-pressed={filters.returnTier === tier.id}
              aria-label={`Filter by ${tier.label}, ${tier.range}, ${tier.count} campaigns`}
              onClick={() =>
                setFilters((current) => ({
                  ...current,
                  returnTier: current.returnTier === tier.id ? "all" : tier.id,
                }))
              }
            >
              <div><span className="tier-dot" /><strong>{tier.label}</strong></div>
              <b>{wholeNumber.format(tier.count)}</b>
              <p>{tier.range} · {tier.averageReturn === null ? "—" : `${decimalNumber.format(tier.averageReturn)}% avg.`}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="chart-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Trend</p><h2>Cost and lifetime ROAS</h2></div>
            <div className="legend"><span><i className="bar-key" /> Cost</span><span><i className="line-key" /> ROAS</span></div>
          </div>
          <PerformanceChart data={months} />
        </article>

        <article className="panel platform-panel">
          <div className="panel-heading"><div><p className="eyebrow">Mix</p><h2>By platform</h2></div></div>
          <div className="platform-list">
            {platformStats.map((item) => (
              <div className="platform-row" key={item.platform}>
                <div className="platform-row-heading">
                  <span>{platformLabel(item.platform)}</span>
                  <strong>{formatMetric(item.roas, "roas")}</strong>
                </div>
                <div className="platform-track"><i style={{ width: `${((item.roas ?? 0) / maxPlatformRoas) * 100}%` }} /></div>
                <p>{item.campaigns} campaigns · {compactNumber.format(item.views)} views · {compactNumber.format(item.cost)} cost</p>
              </div>
            ))}
            {platformStats.length === 0 && <p className="table-empty">No platform data for this selection.</p>}
          </div>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading table-heading">
          <div>
            <p className="eyebrow">Campaign detail</p>
            <h2>All performance rows</h2>
            <p className="table-help">Every campaign field is included. Slide left or right, then select any row to view enrichment in its detail card.</p>
          </div>
          <button className="button" disabled={filtered.length === 0} onClick={() => downloadCsv(filtered)}>Export filtered CSV</button>
        </div>
        <CampaignTable campaigns={filtered} />
      </section>
    </main>
  );
}
