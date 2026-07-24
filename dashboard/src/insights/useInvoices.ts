import { useCallback, useEffect, useRef, useState } from "react";

import type { InvoiceRecord } from "../../../src/bookings/types";

/**
 * Loads invoice snapshots from the server and exposes optimistic mark/unmark
 * so the checkbox feels instant. Records are shared team-wide (no auth yet),
 * same as the bookings and layout state.
 */

interface InvoicesState {
  records: InvoiceRecord[];
  loading: boolean;
  error: string | null;
  mark: (record: InvoiceRecord) => void;
  unmark: (campaignName: string) => void;
}

export function useInvoices(): InvoicesState {
  const [records, setRecords] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    fetch("/api/invoices", { signal: controller.signal })
      .then((response) => response.json() as Promise<{ invoices?: InvoiceRecord[] }>)
      .then((body) => setRecords(body.invoices ?? []))
      .catch(() => {
        if (!controller.signal.aborted) setError("Could not load invoice status");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  const mark = useCallback((record: InvoiceRecord) => {
    // Optimistic: show it invoiced immediately, reconcile/rollback on failure.
    setRecords((current) => [
      record,
      ...current.filter((r) => r.campaignName !== record.campaignName),
    ]);
    setError(null);
    fetch("/api/invoices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
      })
      .catch(() => {
        setRecords((current) => current.filter((r) => r.campaignName !== record.campaignName));
        setError("Could not save invoice — try again");
      });
  }, []);

  const unmark = useCallback((campaignName: string) => {
    const previous = { current: undefined as InvoiceRecord | undefined };
    setRecords((current) => {
      previous.current = current.find((r) => r.campaignName === campaignName);
      return current.filter((r) => r.campaignName !== campaignName);
    });
    setError(null);
    fetch(`/api/invoices?campaignName=${encodeURIComponent(campaignName)}`, { method: "DELETE" })
      .then((response) => {
        if (!response.ok && response.status !== 404) throw new Error(String(response.status));
      })
      .catch(() => {
        if (previous.current) setRecords((current) => [previous.current!, ...current]);
        setError("Could not update invoice — try again");
      });
  }, []);

  return { records, loading, error, mark, unmark };
}
