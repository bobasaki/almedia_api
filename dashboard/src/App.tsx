import { useEffect, useState } from "react";

import { BookingsView } from "./bookings/BookingsView";
import { ScorecardView } from "./bookings/ScorecardView";
import { InsightsView } from "./insights/InsightsView";
import { InvoicesView } from "./invoices/InvoicesView";
import { PerformanceView } from "./performance/PerformanceView";

const VIEWS = [
  { id: "insights", label: "Insights" },
  { id: "bookings", label: "Bookings" },
  { id: "scorecard", label: "Scorecard" },
  { id: "performance", label: "Performance" },
  { id: "invoices", label: "Invoices" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

function viewFromHash(): ViewId {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return VIEWS.some((view) => view.id === hash) ? (hash as ViewId) : "insights";
}

export function App() {
  const [view, setView] = useState<ViewId>(viewFromHash);

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const selectView = (id: ViewId) => {
    window.location.hash = `/${id}`;
    setView(id);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">A</div>
        <div className="brand-copy">
          <span>Freecash x ARCH.</span>
          <strong>Campaign tracker</strong>
        </div>
        <nav className="nav-tabs" aria-label="Dashboard sections">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="nav-tab"
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => selectView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {view === "insights" && <InsightsView />}
      {view === "bookings" && <BookingsView />}
      {view === "scorecard" && <ScorecardView />}
      {view === "performance" && <PerformanceView />}
      {view === "invoices" && <InvoicesView />}

      <footer>Private agency data · stays on this server</footer>
    </div>
  );
}
