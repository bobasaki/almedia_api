# Almedia Agency Data API — client (test harness)

Standalone, read-only client for the [Almedia Agency Data API](https://api.almedia.tools).
Built to the `scouting-platform` integrations convention so it drops into
`backend/packages/integrations/src/almedia/` unchanged when it's time to integrate.

## Setup

```bash
pnpm install
```

## Test (offline — no API key needed)

The client is fully proven against fixtures with an injected `fetchFn`, so no
network access is required.

```bash
pnpm test        # run once
pnpm test:watch  # watch mode
pnpm typecheck   # tsc --noEmit
```

## Live smoke-test (once you have a key)

```bash
cp .env.example .env       # then paste your chak_ key into .env
pnpm pull                  # all campaigns as JSON to stdout
pnpm pull -- --format csv  # as CSV
pnpm pull -- --out campaigns.csv --format csv
pnpm pull -- --limit 200
```

`ALMEDIA_API_KEY` is read from `.env` (which is gitignored) or the environment.

## YouTube creator enrichment

The standalone enrichment module accepts a YouTube channel ID, handle, channel
URL, regular video URL, or Shorts URL. It resolves the owning channel, collects
public channel facts and up to 50 recent uploads, normalizes the response,
calculates creator metrics, classifies the creator, and returns one versioned
result. The core entrypoint is:

```ts
import { enrichYouTubeChannel } from "./src/enrichment";

const result = await enrichYouTubeChannel(
  { input: "https://youtube.com/@creator", recentVideoLimit: 20 },
  { youtube: youtubeAdapter, analyzer: analysisAdapter },
);
```

`createChannelEnrichmentService(...)` is the reusable service form. It has no
UI or storage dependency; YouTube collection and content analysis are injected
adapters. The default runtime uses YouTube Data API v3 plus OpenAI structured
analysis when configured. Without OpenAI, or if the AI request fails, the
process returns all YouTube metrics and a lower-confidence metadata-based
classification with an explicit warning.

Add secrets to `.env` (never commit the real values):

```bash
YOUTUBE_API_KEY=your_youtube_data_api_v3_key
OPENAI_API_KEY=your_optional_openai_key
# Optional:
# OPENAI_ENRICHMENT_MODEL=gpt-5.6-terra
```

Enrich and persist one creator:

```bash
pnpm enrich:channels -- --input "https://youtu.be/VIDEO_ID"
```

Enrich every distinct YouTube creator in the live Almedia campaign feed:

```bash
pnpm enrich:channels
pnpm enrich:channels -- --limit 10 --recent-videos 20
pnpm enrich:channels -- --force       # ignore results newer than 7 days
pnpm enrich:channels -- --no-ai       # deterministic metadata analysis only
```

The batch prefers the newest Almedia `video_url`, falls back to a matching
booking channel/video URL, and continues when one creator fails. Results are
stored once per YouTube channel in `data/bookings.db` and linked to every
related Almedia campaign name, normalized channel key, and booking. Almedia is
read-only in this project, so persistence and “upload” happen in the local
application database rather than by writing back to Almedia.

The dashboard server exposes:

- `GET /api/enrichments` — full persisted results and source links
- `GET /api/enrichments/:channelId` — one full result
- `GET /api/enrichments?sourceType=campaign&sourceKey=CAMPAIGN_NAME` — lookup by source
- `POST /api/enrichments` — enrich and persist one input
- `GET /api/campaigns` — each campaign includes a compact `enrichment` field when linked

Example manual request:

```bash
curl -X POST http://127.0.0.1:4173/api/enrichments \
  -H 'Content-Type: application/json' \
  -d '{"input":"https://youtube.com/@creator","recentVideoLimit":20}'
```

The stable `schemaVersion: "1.0"` output contains:

```text
channelEnrichment
├── input + normalized channel profile
├── recentContent[]
├── metrics
│   ├── followers, typical views, engagement, views/follower
│   ├── content-format mix
│   └── upload activity
├── classification
│   ├── niche, topics, and language
│   ├── audience positioning and brand fit
│   └── metadata-based brand-safety screen
├── summary
├── confidence
└── warnings + generation metadata
```

Brand-safety classification covers sampled public titles, descriptions, tags,
and channel metadata. It is intentionally labeled as a metadata screen, not a
substitute for visual, audio, transcript, or human review.

## Dashboard

Start the private campaign dashboard locally:

```bash
pnpm dashboard
```

Then open [http://127.0.0.1:4173](http://127.0.0.1:4173). The app has four views:

- **Insights** — the floating, auto-updating analysis dashboard. Live Almedia
  campaigns are joined to the internal tracker by normalized channel key into
  one "deal" row type, then enriched (vertical, category, deal-size tier). One
  filter bar (market, vertical, CM, category, platform, size, status, month)
  drives all draggable widgets *and* the AI analyst at once. Widgets float on
  a free canvas — drag by the header, positions persist per browser, **Reset
  layout** restores defaults. Below 980px the canvas stacks into a column and
  dragging is disabled. Data re-polls every 5 minutes; **Refresh** forces a new
  Almedia pull. Widgets: Returns by parameter, Views vs realised views, Return
  distribution (histogram across the decision tiers), Unit economics (realised
  vs expected eCPM, cost per signup / D7 purchase), Segment heatmap
  (market × vertical by default; cost-weighted return across any two dimensions), Budget (per
  CM/country/category), Best deals per CM, Pain points (market/vertical/size),
  Spend concentration (a Pareto of channel-level dependency risk), Efficiency
  scatter (spend vs return, bubble = views), Return trend (cost-weighted return
  by publish month), Rebooking & round lift (does re-engaging a creator pay off,
  parsed from the `_R1…_R4` campaign-name rounds), Maturity mix (matured vs
  still-accruing return, since Almedia gives a single snapshot not a maturation
  curve), Action plan (a template — each section is drafted by the AI against the
  current view), and the AI analyst chat. The standard-chart aggregations live in
  `dashboard/src/insights/charts.ts` (pure functions, covered by `charts.test.ts`).
- **Bookings** — the tracker-sheet replacement. A deal entry form (formerly the
  country scouting tabs) plus one bookings table with a status pipeline —
  `pipeline → booked → published → longterm`, or `dropped` — replacing the
  Campaigns, Longterm, and Dropouts tabs. Status is editable inline; EXT price
  auto-fills at INT ÷ 0.8. Data lives in `data/bookings.db` (SQLite via
  Node's built-in `node:sqlite`, gitignored).
- **Scorecard** — committed budget (booked + published + longterm) vs the Plan
  targets per CM × market × month, with deal-size tier progress, pace vs the
  elapsed share of the current month, dropout rate, and company-level monthly
  totals against the revenue targets.
- **Performance** — the original campaign analytics: date, platform, and
  campaign filters; KPI summaries; monthly and platform charts;
  a four-tier return decision view; a sortable campaign table; and filtered CSV
  export. Return tiers are `>100%` Longterm, `80–100%` Rebooking, `50–<80%`
  Rebooking with price adjustment, and `<50%` Drop.
  Campaigns can also be filtered by maturity: **Matured** at 14 or more days since
  publication, **Maturing** before day 14, or **Unknown** when no publish date exists.

On first start the server seeds plan targets from `data/migration/targets.json`
(Plan Q3 month names map onto 2026) if the targets table is empty. Re-seed
manually after a fresh `pnpm migrate:sheet` with:

```bash
pnpm bookings:seed   # options: --file …/targets.json --db data/bookings.db --year 2026
```

The API key stays on the local Node server and is never sent to the browser.
Campaign responses are cached in memory for one hour; **Refresh data** forces a
new API pull.

### AI analyst (Insights tab)

The integrated analyst uses OpenAI's Responses API (`gpt-5.6-sol` by default). Create a
project-scoped key in the [OpenAI dashboard](https://platform.openai.com/api-keys), add
`OPENAI_API_KEY` to `.env`, and restart the dashboard to enable it:

```bash
OPENAI_API_KEY=your_key_here
# Optional model override:
# OPENAI_MODEL=gpt-5.6-sol
```

Without a key, the dashboard works fully and the chat shows setup instructions. Each
question is grounded on a compact JSON digest of the data *currently in view*
(filters applied), so answers cite real numbers. The key stays on the Node
server — `dashboard/ai-api.ts` proxies `/api/ai/chat` and streams the answer to
the browser as SSE; the browser never sees the key. OpenAI response storage is
disabled for this route (`store: false`). The Action-plan widget is a
template on purpose: each section ("Focus", "Rebook & extend", …) sends a
scoped prompt to the analyst rather than being pre-filled.

For a production-mode local build:

```bash
pnpm dashboard:build
pnpm dashboard:start
```

## Tracker migration (Freecash x ARCH. Google Sheet)

One-time migration of the "[INT] Freecash x ARCH." tracker workbook into
database-ready JSON, so the spreadsheet workflow can move into this app:

```bash
pnpm migrate:sheet -- --file tracker.xlsx --campaigns campaigns.json
```

Writes to `data/migration/` (gitignored):

- `bookings.json` — deals from the Campaigns/Dropouts tabs (month sections
  resolved, day-first dates normalized to ISO, budgets parsed)
- `targets.json` — Plan Q3 targets per CM × market × month plus company
  revenue targets
- `pipeline.json` — scouting entries from country tabs (e.g. "IT - Miro")
- `longterm.json` — Longterm tab activation rows
- `join-report.json` — sheet channels matched to API campaign names via
  normalized keys (`"ASMR Fixy"` → `ASMRFIXY` → `ASMRFIXY_YT_R1`); ~94% of
  API campaigns match a sheet channel

The tracker starts fresh from August 2026, so `Legacy *` tabs are skipped
entirely. Column mapping is header-name based, so layout drift (inserted
columns) doesn't break parsing. Parsers are pure functions over cell
matrices (`src/migration/`), fully covered by Vitest without xlsx I/O.

## Layout

```
src/almedia/agency-data.ts   the client — ports into integrations as-is
src/almedia/agency-data.test.ts   Vitest suite (injected fetchFn, no network)
src/almedia/fixtures.ts      sample payloads from the API docs
src/enrichment/              standalone YouTube enrichment service + replaceable adapters
src/migration/               tracker workbook parsers + campaign-name join
src/bookings/                bookings SQLite store, validation, scorecard calcs
src/index.ts                 package entrypoint
scripts/pull.ts              throwaway live CLI (not ported)
scripts/enrich-channels.ts    one-channel or Almedia batch enrichment CLI
scripts/migrate-sheet.ts     tracker xlsx -> data/migration/*.json CLI
scripts/seed-bookings.ts     seed plan targets into data/bookings.db
dashboard/                   private React dashboard + local server (bookings API)
```

## API surface

- `fetchAgencyDataPage(input)` — one page.
- `fetchAllCampaigns(input)` — pages through everything (offset += limit until a short page).
- `AlmediaApiError` with a typed `.code`:
  `ALMEDIA_API_KEY_MISSING` · `ALMEDIA_API_KEY_INVALID_FORMAT` · `ALMEDIA_AUTH_FAILED` ·
  `ALMEDIA_RATE_LIMITED` · `ALMEDIA_SERVER_ERROR` · `ALMEDIA_INVALID_RESPONSE` · `ALMEDIA_REQUEST_FAILED`

`input`: `{ apiKey, baseUrl?, limit?, offset?, maxRetries?, maxPages?, fetchFn?, sleepFn? }`.
Transient failures (429/5xx/network) are retried with exponential backoff, honoring `Retry-After`.
Responses are normalized to camelCase `AlmediaCampaign` objects, including the campaign `country`, with a parsed `publishedAt` Date;
`null` metric fields (immature campaigns) are preserved.

## Porting into scouting-platform (later)

1. Copy `src/almedia/agency-data.ts` (+ test) → `backend/packages/integrations/src/almedia/`.
2. Add `export * from "./almedia/agency-data";` to that package's `src/index.ts`.
3. Add Prisma snapshot models + a pg-boss `almedia.sync` worker (`0 * * * *`) for hourly
   snapshot-with-dedup — mirroring `hubspot-object-sync-schedule-worker.ts`.
