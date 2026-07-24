import { useMemo, useState } from "react";

import { dimensionOptions, filterDeals } from "../insights/enrich";
import { formatEur, formatPct, timeAgo } from "../insights/format";
import "../insights/insights.css";
import { buildInvoiceView, type InvoiceLine } from "../insights/invoicing";
import type { DimensionId, InsightFilters } from "../insights/types";
import { ALL_FILTERS, DIMENSIONS } from "../insights/types";
import { useDealsData } from "../insights/useDealsData";
import { useInvoices } from "../insights/useInvoices";
import "./invoices.css";

/**
 * Invoices — a standalone billing view. Matured channels are grouped into
 * markup tiers ready to invoice; channels can be invoiced before maturity via
 * the checkbox, and any tier climb once they mature surfaces as a top-up due.
 * Shares the live deals feed and the CM/market filter bar with Insights.
 */

function markupLabel(markup: number): string {
  return `+${Math.round(markup * 100)}%`;
}

function InvoiceRow({
  line,
  onToggle,
  showCountdown,
}: {
  line: InvoiceLine;
  onToggle: (line: InvoiceLine) => void;
  showCountdown?: boolean;
}) {
  return (
    <li className="invoice-row">
      <label className="invoice-check">
        <input type="checkbox" checked={line.invoiced} onChange={() => onToggle(line)} />
        <span className="invoice-name">
          {line.channelName}
          {line.round !== null && <em className="invoice-round">R{line.round}</em>}
        </span>
      </label>
      <span className="invoice-meta">
        {formatPct(line.returnPct)} · {markupLabel(line.tier.markup)}
        {showCountdown && line.daysRemaining ? ` · ${line.daysRemaining}d left` : ""}
      </span>
      <strong className="invoice-amount">{formatEur(line.amount)}</strong>
    </li>
  );
}

export function InvoicesView() {
  const data = useDealsData();
  const [filters, setFilters] = useState<InsightFilters>(ALL_FILTERS);
  const { records, loading: invoicesLoading, error: invoicesError, mark, unmark } = useInvoices();

  const filtered = useMemo(() => filterDeals(data.deals, filters), [data.deals, filters]);
  const options = useMemo(() => dimensionOptions(data.deals), [data.deals]);
  const view = useMemo(() => buildInvoiceView(filtered, records), [filtered, records]);

  const setFilter = (id: DimensionId, value: string) =>
    setFilters((current) => ({ ...current, [id]: value }));
  const hasActiveFilters = DIMENSIONS.some(({ id }) => filters[id] !== "all");

  const toggle = (line: InvoiceLine) => {
    if (line.invoiced) {
      unmark(line.campaignName);
      return;
    }
    mark({
      campaignName: line.campaignName,
      channelName: line.channelName,
      invoicedAt: new Date().toISOString(),
      maturedAtInvoice: line.status === "matured",
      cost: line.cost,
      returnPct: line.returnPct,
      tier: line.tier.id,
      amount: line.amount,
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

  const nothing = view.matured.length === 0 && view.maturing.length === 0;

  return (
    <main className="dashboard invoices-page">
      <section className="hero">
        <div>
          <p className="eyebrow">Billing · INT (cost ÷ 1.2) + return commission</p>
          <h1>Invoices</h1>
          <p className="hero-copy">
            Matured channels grouped into billing tiers. Tick a channel when invoiced; invoice
            maturing ones early and any tier climb at maturity shows up as a top-up.
          </p>
        </div>
        <div className="hero-side">
          <div className="view-actions">
            <p>
              {data.refreshing ? "Refreshing…" : `Updated ${timeAgo(data.fetchedAt)}`} ·{" "}
              {records.length} invoiced
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

      <div className="filters insights-filters">
        {DIMENSIONS.map(({ id, label }) => (
          <label key={id}>
            <span>{label}</span>
            <select value={filters[id]} onChange={(event) => setFilter(id, event.target.value)}>
              <option value="all">All</option>
              {options[id].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ))}
        <button
          type="button"
          className="button"
          disabled={!hasActiveFilters}
          onClick={() => setFilters(ALL_FILTERS)}
        >
          Clear filters
        </button>
      </div>

      <div className="kpi-grid invoices-kpis">
        <div className="kpi-card">
          <p>Outstanding (matured)</p>
          <strong>{formatEur(view.outstanding)}</strong>
          <span>matured value not yet invoiced</span>
        </div>
        <div className="kpi-card">
          <p>Matured total</p>
          <strong>{formatEur(view.maturedTotal)}</strong>
          <span>{view.matured.length} channels past day 14</span>
        </div>
        <div className="kpi-card">
          <p>Top-ups due</p>
          <strong className={view.topUpTotal > 0 ? "tone-text-good" : undefined}>
            {formatEur(view.topUpTotal)}
          </strong>
          <span>{view.topUps.length} matured into a higher tier</span>
        </div>
        <div className="kpi-card">
          <p>Channels invoiced</p>
          <strong>{records.length}</strong>
          <span>{view.maturing.length} still maturing</span>
        </div>
      </div>

      {invoicesError && (
        <div className="inline-error" role="alert">
          {invoicesError}
        </div>
      )}

      {nothing ? (
        <div className="panel invoices-empty">
          <p className="widget-empty">No channels with Almedia cost for the current filters.</p>
        </div>
      ) : (
        <div className="invoices-layout">
          <section className="panel invoices-col" aria-label="Matured channels">
            <header className="invoices-col-head">
              <h2>Matured — ready to invoice</h2>
              <span>{formatEur(view.outstanding)} outstanding</span>
            </header>

            <ul className="invoice-tiers">
              {view.tiers.map((row) => (
                <li key={row.tier.id}>
                  <span className="invoice-tier-label">
                    {row.tier.label} <em>{markupLabel(row.tier.markup)}</em>
                  </span>
                  <span className="invoice-tier-meta">
                    {row.count} {row.count === 1 ? "channel" : "channels"} · {formatEur(row.amount)}
                  </span>
                </li>
              ))}
            </ul>

            <p className="widget-subheading">Tick when invoiced</p>
            {view.matured.length === 0 ? (
              <p className="widget-empty">No matured channels for the current filters.</p>
            ) : (
              <ul className="invoice-list invoice-list-tall">
                {view.matured.map((line) => (
                  <InvoiceRow key={line.campaignName} line={line} onToggle={toggle} />
                ))}
              </ul>
            )}
          </section>

          <section className="panel invoices-col" aria-label="Maturing and top-ups">
            <header className="invoices-col-head">
              <h2>Maturing — invoice early</h2>
              <span>tracked to day 14</span>
            </header>
            {view.maturing.length === 0 ? (
              <p className="widget-empty">Nothing maturing for the current filters.</p>
            ) : (
              <ul className="invoice-list invoice-list-tall">
                {view.maturing.map((line) => (
                  <InvoiceRow key={line.campaignName} line={line} onToggle={toggle} showCountdown />
                ))}
              </ul>
            )}

            <p className="widget-subheading">Top-ups due · matured into a higher tier</p>
            {view.topUps.length === 0 ? (
              <p className="widget-empty">No top-ups outstanding.</p>
            ) : (
              <ul className="invoice-list">
                {view.topUps.map((row) => (
                  <li key={row.campaignName} className="invoice-row">
                    <span className="invoice-name">
                      {row.channelName}
                      {row.round !== null && <em className="invoice-round">R{row.round}</em>}
                    </span>
                    <span className="invoice-meta">
                      {formatEur(row.invoicedAmount)} → {formatEur(row.maturedAmount)}
                      {row.tierJumped && <em className="tier-jump">tier ↑</em>}
                    </span>
                    <strong className="invoice-amount tone-text-good">
                      +{formatEur(row.topUp)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <p className="widget-footnote invoices-footnote">
        Invoice = INT (cost ÷ 1.2) × commission by return (&lt;80% +20% · 80% +25% · 85% +30% · 93%
        +40% · 100% +50% · 113% +60% · 139% +80% · ≥150% +100%). Matured = 14+ days since publish.
        {invoicesLoading ? " · loading invoice status…" : ""}
      </p>
    </main>
  );
}
