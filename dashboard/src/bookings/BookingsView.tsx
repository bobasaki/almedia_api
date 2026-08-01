import { useCallback, useEffect, useMemo, useState } from "react";

import type { Booking, BookingStatus, Target } from "../../../src/bookings/types";
import { BOOKING_STATUSES } from "../../../src/bookings/types";
import { InfoTip } from "../InfoTip";
import { deleteBooking, fetchBookings, fetchTargets, patchBooking } from "./api";
import { BookingForm } from "./BookingForm";
import { formatEur, formatMonth, STATUS_LABELS } from "./format";

/**
 * Booking pipeline view — the sheet's Campaigns/Longterm/Dropouts/country
 * tabs collapsed into one table with a status field.
 */

const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

interface Filters {
  status: BookingStatus | "all";
  cm: string;
  month: string;
  search: string;
}

const EMPTY_FILTERS: Filters = { status: "all", cm: "all", month: "all", search: "" };

function StatusSelect({
  booking,
  onChange,
}: {
  booking: Booking;
  onChange: (status: BookingStatus) => void;
}) {
  return (
    <select
      className={`status-select status-${booking.status}`}
      value={booking.status}
      aria-label={`Status for ${booking.channelName}`}
      onChange={(event) => onChange(event.target.value as BookingStatus)}
    >
      {BOOKING_STATUSES.map((status) => (
        <option key={status} value={status}>{STATUS_LABELS[status]}</option>
      ))}
    </select>
  );
}

export function BookingsView() {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchBookings(controller.signal), fetchTargets(controller.signal)])
      .then(([loadedBookings, loadedTargets]) => {
        setBookings(loadedBookings);
        setTargets(loadedTargets.targets);
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Unable to load bookings");
      });
    return () => controller.abort();
  }, []);

  const replaceBooking = useCallback((next: Booking) => {
    setBookings((current) =>
      current ? current.map((item) => (item.id === next.id ? next : item)) : current,
    );
  }, []);

  const changeStatus = async (booking: Booking, status: BookingStatus) => {
    replaceBooking({ ...booking, status }); // optimistic
    try {
      replaceBooking(await patchBooking(booking.id, { status }));
      setError(null);
    } catch (caught) {
      replaceBooking(booking); // roll back
      setError(caught instanceof Error ? caught.message : "Status update failed");
    }
  };

  const remove = async (booking: Booking) => {
    if (!window.confirm(`Delete "${booking.channelName}"? This cannot be undone.`)) return;
    try {
      await deleteBooking(booking.id);
      setBookings((current) => current?.filter((item) => item.id !== booking.id) ?? current);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Delete failed");
    }
  };

  const cms = useMemo(
    () => [...new Set([...targets.map((t) => t.cm), ...(bookings ?? []).map((b) => b.cm ?? "")])]
      .filter(Boolean)
      .sort(),
    [targets, bookings],
  );
  const months = useMemo(
    () => [...new Set((bookings ?? []).map((b) => b.month ?? ""))].filter(Boolean).sort().reverse(),
    [bookings],
  );

  const filtered = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return (bookings ?? []).filter(
      (booking) =>
        (filters.status === "all" || booking.status === filters.status) &&
        (filters.cm === "all" || booking.cm === filters.cm) &&
        (filters.month === "all" || booking.month === filters.month) &&
        (!search || booking.channelName.toLowerCase().includes(search)),
    );
  }, [bookings, filters]);

  const statusCounts = useMemo(() => {
    const counts = new Map<BookingStatus, number>();
    for (const booking of bookings ?? []) {
      counts.set(booking.status, (counts.get(booking.status) ?? 0) + 1);
    }
    return counts;
  }, [bookings]);

  if (!bookings && !error) {
    return (
      <main className="loading-state" aria-live="polite">
        <div className="loader" />
        <h1>Loading bookings</h1>
        <p>Opening the local booking database…</p>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <section className="hero">
        <div>
          <p className="eyebrow">Booking pipeline</p>
          <div className="hero-title-row">
            <h1>Every deal, one table.</h1>
            <InfoTip label="What the Bookings page shows" align="start">
              <p>
                <strong>The deal pipeline.</strong> The tracker sheet's Campaigns, Longterm, and
                Dropouts tabs in one table, with a status on each row.
              </p>
              <ul>
                <li>
                  <span className="info-tip-term">Status chips</span>: counts per stage, click to
                  filter. A deal moves from <em>pipeline</em> to <em>booked</em> to <em>published</em>{" "}
                  to <em>longterm</em>, or is <em>dropped</em>.
                </li>
                <li>
                  <span className="info-tip-term">Add form</span>: log a new deal. The INT budget sets
                  the EXT price automatically.
                </li>
                <li>
                  <span className="info-tip-term">INT vs EXT</span>: INT is our internal booked budget;
                  EXT is the client-facing price (INT ÷ 0.8).
                </li>
                <li>
                  <span className="info-tip-term">Activation</span>: the offer or mechanic booked, with
                  how many activations.
                </li>
              </ul>
              <p>Committed budget is booked plus published plus longterm. Dropped deals don't count.</p>
            </InfoTip>
          </div>
          <p className="hero-copy">
            Scout, book, publish, and track dropouts. The tracker sheet workflow without the sheet.
          </p>
        </div>
        <div className="record-count">
          <strong>{filtered.length}</strong>
          <span>of {bookings?.length ?? 0} deals</span>
        </div>
      </section>

      {error && <div className="inline-error" role="alert">{error}</div>}

      <div className="status-chips" role="group" aria-label="Filter by status">
        {BOOKING_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            className={`status-chip status-${status}`}
            aria-pressed={filters.status === status}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                status: current.status === status ? "all" : status,
              }))
            }
          >
            <strong>{statusCounts.get(status) ?? 0}</strong> {STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      <BookingForm
        targets={targets}
        onCreated={(booking) => setBookings((current) => [booking, ...(current ?? [])])}
      />

      <section className="filters bookings-filters" aria-label="Booking filters">
        <label className="search-field">
          <span>Search channel</span>
          <input
            type="search"
            placeholder="Channel name"
            value={filters.search}
            onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          />
        </label>
        <label>
          <span>CM</span>
          <select value={filters.cm} onChange={(event) => setFilters({ ...filters, cm: event.target.value })}>
            <option value="all">All CMs</option>
            {cms.map((cm) => <option key={cm} value={cm}>{cm}</option>)}
          </select>
        </label>
        <label>
          <span>Month</span>
          <select
            value={filters.month}
            onChange={(event) => setFilters({ ...filters, month: event.target.value })}
          >
            <option value="all">All months</option>
            {months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
          </select>
        </label>
        <button className="button ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading table-heading">
          <div><p className="eyebrow">Deals</p><h2>Booking table</h2></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Channel</th>
                <th>CM</th>
                <th>Market</th>
                <th>Month</th>
                <th>Status</th>
                <th className="secondary-column">Activation</th>
                <th className="numeric">INT</th>
                <th className="numeric secondary-column">EXT</th>
                <th className="secondary-column">Contract</th>
                <th className="secondary-column">Published</th>
                <th className="action-column"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((booking) => (
                <tr key={booking.id}>
                  <td className="campaign-name">
                    {booking.channelUrl ? (
                      <a href={booking.channelUrl} target="_blank" rel="noreferrer">{booking.channelName}</a>
                    ) : (
                      booking.channelName
                    )}
                    {booking.note && <span className="booking-note">{booking.note}</span>}
                  </td>
                  <td>{booking.cm ?? "—"}</td>
                  <td>{booking.country ?? "—"}</td>
                  <td>{formatMonth(booking.month)}</td>
                  <td>
                    <StatusSelect booking={booking} onChange={(status) => void changeStatus(booking, status)} />
                  </td>
                  <td className="secondary-column">
                    {booking.activation ?? "—"}
                    {booking.numActivations !== null && ` ×${booking.numActivations}`}
                  </td>
                  <td className="numeric metric-emphasis">{formatEur(booking.intBudget)}</td>
                  <td className="numeric secondary-column">{formatEur(booking.extBudget)}</td>
                  <td className="secondary-column">{booking.contractSigned ? "✓ signed" : "—"}</td>
                  <td className="secondary-column">
                    {booking.publishedAt ? dateFormatter.format(new Date(booking.publishedAt)) : "—"}
                  </td>
                  <td className="action-column">
                    <button
                      type="button"
                      className="button ghost danger"
                      aria-label={`Delete ${booking.channelName}`}
                      onClick={() => void remove(booking)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="table-empty">
              {bookings?.length === 0
                ? "No deals yet. Add the first one above."
                : "No deals match the current filters."}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
