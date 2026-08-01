import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Layout, ResponsiveLayouts } from "react-grid-layout";

/**
 * Loads the shared team dashboard layout from the server, keeps it as the
 * controlled state for the responsive grid, and persists changes back on
 * drag/resize end (debounced). No auth yet, so every browser reads and writes
 * the same "team" profile — the day auth lands, `profile` becomes the user id.
 */

const SAVE_DEBOUNCE_MS = 600;

/** Normalise to the fields that define a layout, so equality ignores RGL noise. */
function layoutKey(layouts: ResponsiveLayouts): string {
  const normalised: Record<string, Array<[string, number, number, number, number]>> = {};
  for (const [breakpoint, items] of Object.entries(layouts)) {
    normalised[breakpoint] = [...(items ?? [])]
      .map((item): [string, number, number, number, number] => [item.i, item.x, item.y, item.w, item.h])
      .sort((a, b) => a[0].localeCompare(b[0]));
  }
  return JSON.stringify(normalised);
}

/**
 * Merge a saved layout with the current defaults so widgets added to the code
 * after a layout was saved still appear. Saved positions win for widgets the
 * user already arranged; any default widget missing from the saved set is
 * appended below (never overlapping) so a new widget is never lost or crammed
 * into a 1×1 cell by react-grid-layout's auto-placement.
 */
function mergeSavedWithDefaults(
  defaults: ResponsiveLayouts,
  saved: ResponsiveLayouts,
): ResponsiveLayouts {
  const merged: ResponsiveLayouts = { ...defaults };
  for (const [breakpoint, savedItemsRaw] of Object.entries(saved)) {
    const savedItems = savedItemsRaw ?? [];
    const savedIds = new Set(savedItems.map((item) => item.i));
    const defaultItems = (defaults as Record<string, Layout | undefined>)[breakpoint] ?? [];
    let nextY = savedItems.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    const appended = defaultItems
      .filter((item) => !savedIds.has(item.i))
      .map((item) => {
        const placed = { ...item, x: 0, y: nextY };
        nextY += item.h;
        return placed;
      });
    (merged as Record<string, Layout>)[breakpoint] = [...savedItems, ...appended];
  }
  return merged;
}

interface DashboardLayout {
  layouts: ResponsiveLayouts;
  onLayoutChange: (current: Layout, all: ResponsiveLayouts) => void;
  commit: () => void;
  reset: () => void;
  customized: boolean;
  loaded: boolean;
}

export function useDashboardLayout(profile: string, defaults: ResponsiveLayouts): DashboardLayout {
  const [layouts, setLayouts] = useState<ResponsiveLayouts>(defaults);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<ResponsiveLayouts>(defaults);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/layout?profile=${encodeURIComponent(profile)}`, { signal: controller.signal })
      .then((response) => response.json() as Promise<{ layout?: ResponsiveLayouts | null }>)
      .then((body) => {
        if (body.layout && typeof body.layout === "object") {
          const merged = mergeSavedWithDefaults(defaults, body.layout);
          setLayouts(merged);
          latest.current = merged;
        }
      })
      .catch(() => {
        // Offline or first run: fall back to the built-in defaults already in state.
      })
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, [profile, defaults]);

  const persist = useCallback(
    (next: ResponsiveLayouts) => {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void fetch("/api/layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile, layout: next }),
        }).catch(() => {
          // A failed save just leaves the previous server value; local state stays.
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [profile],
  );

  // Keep controlled state in sync with the grid; persistence happens on commit.
  const onLayoutChange = useCallback((_current: Layout, all: ResponsiveLayouts) => {
    latest.current = all;
    setLayouts(all);
  }, []);

  // Called on drag/resize end — a genuine user edit worth saving.
  const commit = useCallback(() => {
    if (!loaded) return;
    persist(latest.current);
  }, [loaded, persist]);

  const reset = useCallback(() => {
    setLayouts(defaults);
    latest.current = defaults;
    persist(defaults);
  }, [defaults, persist]);

  const customized = useMemo(() => layoutKey(layouts) !== layoutKey(defaults), [layouts, defaults]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  return { layouts, onLayoutChange, commit, reset, customized, loaded };
}
