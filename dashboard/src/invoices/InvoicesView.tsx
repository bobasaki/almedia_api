import { useMemo, useState } from "react";

import { InfoTip } from "../InfoTip";
import { dimensionOptions, filterDeals } from "../insights/enrich";
import { formatPct, formatUsd, timeAgo } from "../insights/format";
import "../insights/insights.css";
import {
  buildInvoiceBatches,
  COST_INVOICED_THROUGH,
  type BatchMember,
  type InvoiceBatch,
} from "../insights/invoicing";
import { monthLabel } from "../labels";
import type { InsightFilters } from "../insights/types";
import { ALL_FILTERS } from "../insights/types";
import { useDealsData } from "../insights/useDealsData";
import "./invoices.css";

/**
 * Invoices — a standalone billing view. Campaigns are grouped by publish month.
 * Stage 1 (cost) is invoiced up front the month a campaign publishes; Stage 2
 * (performance fee) is billed the next month, once the batch's blended return
 * settles. The Freecash client is already invoiced for cost through
 * COST_INVOICED_THROUGH (no fees yet), so the view foregrounds what is still due.
 */

function markupLabel(markup: number): string {
  return `+${Math.round(markup * 100)}%`;
}

const INVOICED_LABEL = monthLabel(COST_INVOICED_THROUGH);

function BatchMemberRow({
  member,
  onToggle,
}: {
  member: BatchMember;
  onToggle: (member: BatchMember) => void;
}) {
  const matured = member.status === "matured";
  return (
    <li className={`invoice-row batch-member${member.included ? " is-included" : ""}`}>
      <label className="invoice-check">
        <input
          type="checkbox"
          checked={member.included}
          disabled={matured}
          onChange={() => onToggle(member)}
          title={matured ? "Matured channels always count toward the fee" : "Add to the fee blend"}
        />
        <span className="invoice-name">
          {member.channelName}
          {member.round !== null && <em className="invoice-round">R{member.round}</em>}
          {!matured && (
            <em className="batch-maturing">{member.daysRemaining ? `${member.daysRemaining}d left` : "maturing"}</em>
          )}
        </span>
      </label>
      <span className="invoice-meta">
        {formatPct(member.memberReturn)} · own {markupLabel(member.ownTier.markup)}
        {member.included && member.performanceFee > 0
          ? ` · fee +${formatUsd(member.performanceFee)}`
          : ""}
      </span>
      <strong className="invoice-amount">{formatUsd(member.cost)}</strong>
    </li>
  );
}

/** Cost chip: green when already invoiced, amber with the amount when still due. */
function CostChip({ batch }: { batch: InvoiceBatch }) {
  if (batch.costInvoiced) {
    return <span className="chip chip-done">✓ Cost invoiced</span>;
  }
  return <span className="chip chip-due">Cost due {formatUsd(batch.baseTotal)}</span>;
}

/** Fee chip: pending while the cohort matures, then the amount due (or none). */
function FeeChip({ batch }: { batch: InvoiceBatch }) {
  if (!batch.feeSettled) {
    return <span className="chip chip-pending">Fee pending</span>;
  }
  if (batch.performanceFee > 0) {
    return <span className="chip chip-fee">Fee due +{formatUsd(batch.performanceFee)}</span>;
  }
  return <span className="chip chip-none">No fee</span>;
}

function MonthRow({
  batch,
  onToggle,
}: {
  batch: InvoiceBatch;
  onToggle: (member: BatchMember) => void;
}) {
  return (
    <details className="month-row">
      <summary className="month-summary">
        <span className="month-name">
          {batch.label}
          <em className="month-count">{batch.memberCount} {batch.memberCount === 1 ? "campaign" : "campaigns"}</em>
        </span>
        <span className="month-tags">
          <CostChip batch={batch} />
          <FeeChip batch={batch} />
        </span>
        <span className="month-blend">
          {batch.feeSettled ? "blended" : "so far"} {formatPct(batch.blendedReturn)} · {batch.tier.label}
        </span>
        <span className="month-total">{formatUsd(batch.amount)}</span>
        <span className="month-chevron" aria-hidden="true">▾</span>
      </summary>

      <div className="month-body">
        <p className="batch-stages">
          <span>
            <strong>Stage 1 · Cost</strong> {formatUsd(batch.baseTotal)} —{" "}
            {batch.costInvoiced ? (
              <span className="tone-text-good">invoiced in {batch.label}</span>
            ) : (
              <span className="tone-text-bad">due in {batch.label}</span>
            )}
          </span>
          <span>
            <strong>Stage 2 · Performance fee</strong>{" "}
            {!batch.feeSettled ? (
              <>pending — cohort still maturing ({batch.maturingCount} to go)</>
            ) : batch.performanceFee > 0 ? (
              <>
                <span className="tone-text-good">+{formatUsd(batch.performanceFee)}</span> due in{" "}
                {monthLabel(batch.feeMonth)}
              </>
            ) : (
              <>none — blended return under 100%</>
            )}
          </span>
        </p>
        <p className="batch-sub">
          {batch.includedCount} of {batch.memberCount} matured · INT {formatUsd(batch.intTotal)}
          {batch.maturingCount > 0 ? ` · ${batch.maturingCount} maturing, tick to add to the fee blend` : ""}
        </p>
        <ul className="invoice-list batch-members">
          {batch.members.map((member) => (
            <BatchMemberRow key={member.campaignName} member={member} onToggle={onToggle} />
          ))}
        </ul>
      </div>
    </details>
  );
}

export function InvoicesView() {
  const data = useDealsData();
  const [month, setMonth] = useState<string>("all");
  const [includedCampaigns, setIncludedCampaigns] = useState<ReadonlySet<string>>(new Set());

  const filters: InsightFilters = useMemo(() => ({ ...ALL_FILTERS, month }), [month]);
  const filtered = useMemo(() => filterDeals(data.deals, filters), [data.deals, filters]);
  const monthOptions = useMemo(() => dimensionOptions(data.deals).month, [data.deals]);
  const batches = useMemo(
    () => buildInvoiceBatches(filtered, includedCampaigns),
    [filtered, includedCampaigns],
  );

  const totals = useMemo(() => {
    let costDue = 0;
    let costInvoiced = 0;
    let feesDue = 0;
    let feesPending = 0;
    let campaigns = 0;
    for (const batch of batches) {
      campaigns += batch.memberCount;
      if (batch.costInvoiced) costInvoiced += batch.baseTotal;
      else costDue += batch.baseTotal;
      if (batch.feeSettled) feesDue += batch.performanceFee;
      else feesPending += batch.performanceFee;
    }
    return {
      costDue,
      costInvoiced,
      feesDue,
      feesPending,
      campaigns,
      dueNow: costDue + feesDue,
      costAll: costDue + costInvoiced,
    };
  }, [batches]);

  // Campaigns with a cost but no publish date can't be placed in a month.
  const undated = useMemo(() => {
    let cost = 0;
    let count = 0;
    for (const deal of filtered) {
      if (deal.cost === null || !Number.isFinite(deal.cost) || deal.cost <= 0) continue;
      const key = deal.publishedAt?.slice(0, 7);
      if (!key || !/^\d{4}-\d{2}$/.test(key)) {
        cost += deal.cost;
        count += 1;
      }
    }
    return { cost, count };
  }, [filtered]);

  const toggleInclude = (member: BatchMember) => {
    if (member.status === "matured") return; // matured channels always count toward the fee
    setIncludedCampaigns((current) => {
      const next = new Set(current);
      if (next.has(member.campaignName)) next.delete(member.campaignName);
      else next.add(member.campaignName);
      return next;
    });
  };

  if (data.loading) {
    return (
      <div className="loading-state">
        <div className="loader" aria-hidden="true" />
        <h1>Loading channels to invoice…</h1>
        <p>Live Almedia costs and returns join the tracker.</p>
      </div>
    );
  }

  return (
    <main className="dashboard invoices-page">
      <section className="hero">
        <div>
          <p className="eyebrow">Billing · what's still to invoice</p>
          <div className="hero-title-row">
            <h1>Invoices</h1>
            <InfoTip label="How invoicing works" align="start">
              <p>
                <strong>Two stages per campaign, both in USD.</strong> Grouped by the month a
                campaign published.
              </p>
              <ul>
                <li>
                  <span className="info-tip-term">Stage 1 · Cost</span> — the raw Almedia cost,
                  invoiced up front the month it publishes (matured or not).
                </li>
                <li>
                  <span className="info-tip-term">Stage 2 · Performance fee</span> = Σ INT × (1 +
                  commission) − Σ cost (INT = cost ÷ 1.2), billed the next month once the batch's
                  return settles. Floored at zero.
                </li>
                <li>
                  <span className="info-tip-term">Blended return</span> = Σ media spend (return % ×
                  cost ÷ 100) ÷ Σ cost picks one commission tier for the month's matured cohort.
                </li>
                <li>
                  <span className="info-tip-term">Already invoiced</span> — the client is paid up on
                  cost through {INVOICED_LABEL}. No performance fees have been billed yet.
                </li>
              </ul>
            </InfoTip>
          </div>
          <p className="hero-copy">
            Cost is invoiced up front through <strong>{INVOICED_LABEL}</strong>; performance fees
            have not been billed yet. Everything below marks what is still due — cost for later
            months, and the fee owed on each settled month.
          </p>
        </div>
        <div className="hero-side">
          <div className="view-actions">
            <p>
              {data.refreshing ? "Refreshing…" : `Updated ${timeAgo(data.fetchedAt)}`} ·{" "}
              {totals.campaigns} campaigns
            </p>
            <button
              type="button"
              className="button"
              disabled={data.refreshing}
              onClick={() => data.refresh(true)}
            >
              <span className={`refresh-icon ${data.refreshing ? "spinning" : ""}`} aria-hidden="true">
                ⟳
              </span>
              Refresh
            </button>
          </div>
        </div>
      </section>

      {data.error && (
        <div className="inline-error" role="alert">
          {data.error}
        </div>
      )}

      <div className="kpi-grid invoices-kpis">
        <div className="kpi-card kpi-accent">
          <p>To invoice now</p>
          <strong>{formatUsd(totals.dueNow)}</strong>
          <span>unbilled cost + settled performance fees</span>
        </div>
        <div className="kpi-card">
          <p>Performance fees due</p>
          <strong className={totals.feesDue > 0 ? "tone-text-good" : undefined}>
            {formatUsd(totals.feesDue)}
          </strong>
          <span>
            on settled months
            {totals.feesPending > 0 ? ` · ${formatUsd(totals.feesPending)} still maturing` : ""}
          </span>
        </div>
        <div className="kpi-card">
          <p>Cost to invoice</p>
          <strong>{formatUsd(totals.costDue)}</strong>
          <span>publish months after {INVOICED_LABEL}</span>
        </div>
        <div className="kpi-card">
          <p>Already invoiced</p>
          <strong>{formatUsd(totals.costInvoiced)}</strong>
          <span>cost up front through {INVOICED_LABEL}</span>
        </div>
      </div>

      <div className="filters invoices-filters">
        <label>
          <span>Month</span>
          <select value={month} onChange={(event) => setMonth(event.target.value)}>
            <option value="all">All months</option>
            {monthOptions.map((value) => (
              <option key={value} value={value}>
                {/^\d{4}-\d{2}$/.test(value) ? monthLabel(value) : value}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="button"
          disabled={month === "all"}
          onClick={() => setMonth("all")}
        >
          Clear
        </button>
      </div>

      {batches.length === 0 ? (
        <div className="panel invoices-empty">
          <p className="widget-empty">No campaigns with Almedia cost for this month.</p>
        </div>
      ) : (
        <section className="panel invoices-months" aria-label="Invoices by publish month">
          <header className="invoices-col-head">
            <h2>By publish month</h2>
            <span>{batches.length} {batches.length === 1 ? "month" : "months"} · click a month to expand</span>
          </header>
          <div className="month-list">
            {batches.map((batch) => (
              <MonthRow key={batch.month} batch={batch} onToggle={toggleInclude} />
            ))}
          </div>
        </section>
      )}

      <p className="widget-footnote invoices-footnote">
        Cost (Stage 1) is billed the month a campaign publishes; the performance fee (Stage 2) = Σ
        INT × (1 + commission) − Σ cost bills the next month, floored at zero. Commission comes from
        the month's blended return (&lt;100% +20% · 100% +25% · 110% +30% · 130% +40% · 150% +50% ·
        180% +60% · 250% +80% · ≥330% +100%). Matured = 14+ days since publish. Months with no
        published campaigns don't appear.
        {undated.count > 0
          ? ` ${undated.count} campaign${undated.count === 1 ? "" : "s"} (${formatUsd(undated.cost)}) ${undated.count === 1 ? "has" : "have"} a cost but no publish date, so ${undated.count === 1 ? "it isn't" : "they aren't"} scheduled to a month.`
          : ""}
      </p>
    </main>
  );
}
