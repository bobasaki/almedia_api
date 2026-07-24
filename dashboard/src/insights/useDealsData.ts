import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Scorecard } from "../../../src/bookings/scorecard";
import type { Booking } from "../../../src/bookings/types";
import type { Campaign, CampaignPayload } from "../types";
import { joinDeals } from "./enrich";
import type { Deal } from "./types";

/**
 * Loads live Almedia campaigns + internal bookings, joins them into deals,
 * and re-polls in the background so the dashboard stays current on a wall
 * screen without anyone pressing refresh.
 */

const POLL_INTERVAL_MS = 5 * 60 * 1000;

interface DealsData {
  deals: Deal[];
  campaigns: Campaign[];
  bookings: Booking[];
  scorecard: Scorecard | null;
  fetchedAt: Date | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: (force?: boolean) => void;
}

async function fetchJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export function useDealsData(): DealsData {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (force: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRefreshing(true);
    try {
      const [campaignPayload, bookingsPayload, scorecardPayload] = await Promise.all([
        fetchJson<CampaignPayload>(
          `/api/campaigns${force ? "?refresh=1" : ""}`,
          controller.signal,
        ),
        fetchJson<{ bookings: Booking[] }>("/api/bookings", controller.signal),
        fetchJson<Scorecard>("/api/scorecard", controller.signal),
      ]);
      setCampaigns(campaignPayload.campaigns);
      setBookings(bookingsPayload.bookings);
      setScorecard(scorecardPayload);
      setFetchedAt(new Date());
      setError(null);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Could not load dashboard data");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(false), POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [load]);

  const refresh = useCallback((force = true) => void load(force), [load]);
  const deals = useMemo(() => joinDeals(campaigns, bookings), [campaigns, bookings]);

  return { deals, campaigns, bookings, scorecard, fetchedAt, loading, refreshing, error, refresh };
}
