import { useMemo, useState } from "react";

import { InfoTip } from "../InfoTip";
import { formatPct, formatUsd, timeAgo } from "../insights/format";
import "../insights/insights.css";
import {
  buildInvoiceBatches,
  buildInvoiceMonths,
  prevMonth,
  COST_INVOICED_THROUGH,
  type BatchMember,
  type InvoiceBatch,
  type InvoiceMonth,
} from "../insights/invoicing";
import { monthLabel } from "../labels";
import { useDealsData } from "../insights/useDealsData";
import "./invoices.css";

/**
 * Invoices — a standalone billing view. The money that lands on any single
 * calendar month's invoice comes from two different publish batches: THIS
 * month's cost plus LAST month's performance fee. The view leads with an
 * invoice-month lens (e.g. the July invoice = July cost + June fee) and keeps a
 * per-publish-month accordion below for the campaign-level detail. The Freecash
 * client is already invoiced for cost through COST_INVOICED_THROUGH (no fees
 * yet), so the view foregrounds what is still due.
 */

function markupLabel(markup: number): string {
  return `+${Math.round(markup * 100)}%`;
}

const INVOICED_LABEL = monthLabel(COST_INVOICED_THROUGH);

/**
 * One calendar month's invoice, split into its two components: cost from
 * campaigns published this month, and the performance fee carried from last
 * month's batch. This is the answer to "how much do I invoice in July, and how
 * much of it is June's fee".
 */
function InvoiceMonthCard({ month: m }: { month: InvoiceMonth }) {
  const feeFrom = m.feeBatch?.label ?? monthLabel(prevMonth(m.month));
  const hasFee = m.feeBatch !== null && (m.carriedFee > 0 || m.feePending > 0);
  return (
    <article className="im-card">
      <header className="im-card-head">
        <span className="im-card-month">{m.label}</span>
        <span className="im-card-total">{formatUsd(m.total)}</span>
      </header>
      <dl className="im-lines">
        <div className="im-line">
          <dt>
            <span className="im-line-title">New cost</span>
            <span className="im-line-note">
              {m.costBatch ? `from campaigns published in ${m.label}` : "no campaigns published"}
            </span>
          </dt>
          <dd>
            <span className="im-line-amt">{formatUsd(m.newCost)}</span>
            {m.costBatch ? (
              m.costInvoiced ? (
                <span className="chip chip-done">✓ invoiced</span>
              ) : (
                <span className="chip chip-due">due</span>
              )
            ) : null}
          </dd>
        </div>
        <div className="im-line">
          <dt>
            <span className="im-line-title">Performance fee</span>
            <span className="im-line-note">carried from {feeFrom}</span>
          </dt>
          <dd>
            {!hasFee ? (
              <>
                <span className="im-line-amt is-zero">{formatUsd(0)}</span>
                <span className="chip chip-none">no fee</span>
              </>
            ) : !m.feeSettled ? (
              <>
                <span className="im-line-amt">~{formatUsd(m.feePending)}</span>
                <span className="chip chip-pending">maturing</span>
              </>
            ) : m.carriedFee > 0 ? (
              <>
                <span className="im-line-amt">{formatUsd(m.carriedFee)}</span>
                <span className="chip chip-fee">due</span>
              </>
            ) : (
              <>
                <span className="im-line-amt is-zero">{formatUsd(0)}</span>
                <span className="chip chip-none">no fee</span>
              </>
            )}
          </dd>
        </div>
      </dl>
      <footer className="im-card-foot">
        <span>To invoice in {m.label}</span>
        <strong>{formatUsd(m.total)}</strong>
      </footer>
    </article>
  );
}

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
            <strong>Stage 1 · Cost</strong> {formatUsd(batch.baseTotal)},{" "}
            {batch.costInvoiced ? (
              <span className="tone-text-good">invoiced in {batch.label}</span>
            ) : (
              <span className="tone-text-bad">due on the {batch.label} invoice</span>
            )}
          </span>
          <span>
            <strong>Stage 2 · Performance fee</strong>{" "}
            {!batch.feeSettled ? (
              <>pending, cohort still maturing ({batch.maturingCount} to go)</>
            ) : batch.performanceFee > 0 ? (
              <>
                <span className="tone-text-good">+{formatUsd(batch.performanceFee)}</span>, lands on
                the {monthLabel(batch.feeMonth)} invoice
              </>
            ) : (
              <>none, blended return under 100%</>
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

  // Batches are built from every deal so each fee cohort is complete; the month
  // filter narrows the display, never the fee math.
  const allBatches = useMemo(
    () => buildInvoiceBatches(data.deals, includedCampaigns),
    [data.deals, includedCampaigns],
  );
  const invoiceMonths = useMemo(() => buildInvoiceMonths(allBatches), [allBatches]);
  const monthOptions = useMemo(() => invoiceMonths.map((entry) => entry.month), [invoiceMonths]);

  const selectedLabel = month === "all" ? null : monthLabel(month);

  // The month filter is the calendar INVOICE month. Selecting July shows the July
  // invoice-month card, and the two publish batches feeding it: July (cost) and
  // June (fee).
  const visibleMonths = useMemo(
    () => (month === "all" ? invoiceMonths : invoiceMonths.filter((entry) => entry.month === month)),
    [invoiceMonths, month],
  );
  const visibleBatches = useMemo(() => {
    if (month === "all") return allBatches;
    const keep = new Set([month, prevMonth(month)]);
    return allBatches.filter((batch) => keep.has(batch.month));
  }, [allBatches, month]);

  const totals = useMemo(() => {
    let costDue = 0;
    let costInvoiced = 0;
    let feesDue = 0;
    let feesPending = 0;
    for (const entry of visibleMonths) {
      if (entry.costInvoiced) costInvoiced += entry.newCost;
      else costDue += entry.newCost;
      feesDue += entry.carriedFee;
      feesPending += entry.feePending;
    }
    return { costDue, costInvoiced, feesDue, feesPending, dueNow: costDue + feesDue };
  }, [visibleMonths]);

  const campaignCount = useMemo(
    () => visibleBatches.reduce((sum, batch) => sum + batch.memberCount, 0),
    [visibleBatches],
  );

  // Campaigns with a cost but no publish date can't be placed in a month.
  const undated = useMemo(() => {
    let cost = 0;
    let count = 0;
    for (const deal of data.deals) {
      if (deal.cost === null || !Number.isFinite(deal.cost) || deal.cost <= 0) continue;
      const key = deal.publishedAt?.slice(0, 7);
      if (!key || !/^\d{4}-\d{2}$/.test(key)) {
        cost += deal.cost;
        count += 1;
      }
    }
    return { cost, count };
  }, [data.deals]);

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
                <strong>Each calendar month's invoice has two parts, both in USD.</strong> A campaign
                is billed across two months, so any single invoice mixes two batches.
              </p>
              <ul>
                <li>
                  <span className="info-tip-term">New cost</span> — the raw Almedia cost of campaigns
                  published that same month, invoiced up front (matured or not).
                </li>
                <li>
                  <span className="info-tip-term">Carried fee</span> — last month's performance fee,
                  Σ INT × (1 + commission) − Σ cost (INT = cost ÷ 1.2), billed once that batch's
                  return settles. So June's fee lands on the July invoice.
                </li>
                <li>
                  <span className="info-tip-term">Blended return</span> = Σ media spend (return % ×
                  cost ÷ 100) ÷ Σ INT picks one commission tier for the month's matured cohort.
                </li>
                <li>
                  <span className="info-tip-term">Already invoiced</span> — the client is paid up on
                  cost through {INVOICED_LABEL}. No performance fees have been billed yet.
                </li>
              </ul>
            </InfoTip>
          </div>
          <p className="hero-copy">
            Each month's invoice is <strong>this month's cost plus last month's performance fee</strong>.
            June's fee is billed in July, so the July invoice mixes new July cost with the June fee.
            Cost is invoiced up front through <strong>{INVOICED_LABEL}</strong>; no performance fees
            have been billed yet, so everything below marks what is still due.
          </p>
        </div>
        <div className="hero-side">
          <div className="view-actions">
            <p>
              {data.refreshing ? "Refreshing…" : `Updated ${timeAgo(data.fetchedAt)}`} ·{" "}
              {campaignCount} campaigns
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
          <p>To invoice {selectedLabel ? `in ${selectedLabel}` : "now"}</p>
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
          <span>Invoice month</span>
          <select value={month} onChange={(event) => setMonth(event.target.value)}>
            <option value="all">All months</option>
            {monthOptions.map((value) => (
              <option key={value} value={value}>
                {monthLabel(value)}
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

      {visibleMonths.length === 0 ? (
        <div className="panel invoices-empty">
          <p className="widget-empty">No invoice activity for this month.</p>
        </div>
      ) : (
        <>
          <section className="panel invoice-month-panel" aria-label="Invoices by calendar month">
            <header className="invoices-col-head">
              <h2>By invoice month</h2>
              <span>what lands on each calendar month's invoice</span>
            </header>
            <div className="invoice-month-grid">
              {visibleMonths.map((entry) => (
                <InvoiceMonthCard key={entry.month} month={entry} />
              ))}
            </div>
          </section>

          <section className="panel invoices-months" aria-label="Publish batches feeding the invoices">
            <header className="invoices-col-head">
              <h2>By publish month</h2>
              <span>
                {visibleBatches.length} {visibleBatches.length === 1 ? "batch" : "batches"} · the
                campaign detail behind each fee
              </span>
            </header>
            <div className="month-list">
              {visibleBatches.map((batch) => (
                <MonthRow key={batch.month} batch={batch} onToggle={toggleInclude} />
              ))}
            </div>
          </section>
        </>
      )}

      <p className="widget-footnote invoices-footnote">
        Each calendar month's invoice = new cost (campaigns published that month, billed up front) +
        the performance fee carried from the previous month's batch. The fee = Σ INT × (1 +
        commission) − Σ cost, floored at zero, where commission comes from the batch's blended return
        (&lt;100% +20% · 100% +25% · 110% +30% · 130% +40% · 150% +50% · 180% +60% · 250% +80% ·
        ≥330% +100%). Matured = 14+ days since publish. Months with no activity don't appear.
        {undated.count > 0
          ? ` ${undated.count} campaign${undated.count === 1 ? "" : "s"} (${formatUsd(undated.cost)}) ${undated.count === 1 ? "has" : "have"} a cost but no publish date, so ${undated.count === 1 ? "it isn't" : "they aren't"} scheduled to a month.`
          : ""}
      </p>
    </main>
  );
}
