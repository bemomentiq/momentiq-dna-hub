# momentiq-dna-hub

Operator console + autonomy hub for the **AI Content Platform** powering
[content.bemomentiq.com](https://content.bemomentiq.com). Spans:

| Repo | Role |
|---|---|
| [`bemomentiq/momentiq-dna`](https://github.com/bemomentiq/momentiq-dna) | TikTok Shop UGC corpus, A/B prompt experiments, Thompson bandit, Veo 3.1 calls, indistinguishability scoring |
| [`bemomentiq/momentiq-scriptsage-backend`](https://github.com/bemomentiq/momentiq-scriptsage-backend) | Script + video generation API, Stripe billing, admin/jobs |
| [`bemomentiq/momentiq-scriptsage-frontend`](https://github.com/bemomentiq/momentiq-scriptsage-frontend) | Creator-facing video creation UI |
| (`gke-queue`, `image-engine` if/when wired) | Adjacent generation infrastructure |

## Sections

| Route | Surface |
|---|---|
| `/` | Content Platform overview — corpus, active A/B, IDS median 7d, Veo spend 7d, ScriptSage throughput, MRR, open issues |
| `/exec` | Markdown executive brief (topline, promotion candidates, blockers, Veo spend) |
| `/themes` | Per-theme champion configs (`dna.theme_optimal_configs`) |
| `/themes/:slug` | Theme drill-down — variants, judge verdicts, lineage, Veo cost/ROI |
| `/ab-runs` | A/B experiments — running / completed / promoted / rejected, promotion-gate badges |
| `/scoring` | 5-dimension indistinguishability scorecard + overall hero |
| `/scriptsage` | Script/video generation throughput, fallback %, error %, job health |
| `/veo-cost` | Veo 3.1 spend + ROI by theme (7/14/30d) |
| `/subscriptions` | Active users, MRR, tier mix, top users by credit burn |
| `/roadmap` | Live GitHub milestones + `epic:*` issue groups across the 4 content repos |
| `/issues` | Cross-repo GitHub issues (filterable) |
| `/autonomy` | 5-lane autonomy engine status (Explorer · Executor · PR-babysitter · Test-debug · Consolidation) |
| `/explorer`, `/fleet`, `/backlog`, `/run/:id` | Operational lanes |

## Autonomy lanes

| Lane | Trigger | Role |
|---|---|---|
| **Explorer** | Cron | Scans the content repos + companion signals, files epic-shaped issues |
| **Epic-Executor** | Cron / auto-resume | Plans + ships 3–7 related PRs as coordinated epics |
| **PR-Babysitter** | GitHub webhook | Diagnoses + fixes failing CI, rebases, conditionally merges |
| **Test-Debug** | Cron (4h) | E2E probes against the AI Content Platform; auto-files findings |
| **Consolidation** | Cron | Periodic cross-lane reconciliation and digest |

## Environment

Both env vars and `cron_config` DB columns are honored (env wins). DB lets
operators flip URLs without redeploys, via the autonomy page.

| Env var | DB column | Purpose |
|---|---|---|
| `DNA_API_BASE` | `dna_api_base` | momentiq-dna service base URL |
| `DNA_API_TOKEN` | `dna_api_token` | optional bearer for DNA |
| `SCRIPTSAGE_API_BASE` | `scriptsage_api_base` | scriptsage-backend base URL |
| `SCRIPTSAGE_API_TOKEN` | `scriptsage_api_token` | optional bearer for ScriptSage |
| `GKE_QUEUE_API_BASE` | `gke_queue_api_base` | adjacent prod (optional) |
| `IMAGE_ENGINE_API_BASE` | `image_engine_api_base` | adjacent prod (optional) |
| `GITHUB_TOKEN` / `GH_TOKEN` | `github_token` | for `/api/gh-issues`, milestones, roadmap |
| `KALODATA_API_URL` | `companion_site_url` | companion signals + health probe |
| `SLACK_WEBHOOK_URL` | `slack_webhook_url` | nightly digest sink |

## Content-platform endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/content-platform/overview` | Aggregated dashboard payload (corpus, A/B, IDS, Veo, ScriptSage, subs) |
| GET | `/api/content-platform/themes` | `dna.theme_optimal_configs` proxy |
| GET | `/api/content-platform/themes/:slug` | Per-theme variants + lineage |
| GET | `/api/content-platform/ab-runs?status=&limit=` | A/B runs (filterable) |
| GET | `/api/content-platform/ids-distribution?window_days=7` | 5-dimension IDS distribution |
| GET | `/api/content-platform/veo-cost?window_days=7\|14\|30` | Veo spend + ROI per theme |
| GET | `/api/content-platform/scriptsage` | ScriptSage throughput + jobs |
| GET | `/api/content-platform/subscriptions` | MRR, active users, tier mix |
| GET | `/api/content-platform/roadmap` | Live GitHub milestones + epic groups |
| GET | `/api/content-platform/promotion-candidates` | A/B runs clearing IDS≥0.85 + Δ≥0.10 |
| GET | `/api/content-platform/health` | Live reachability probes (DNA · ScriptSage · Kalodata) |
| GET | `/api/content-platform/cache` | Cache introspection |
| POST | `/api/content-platform/cache/bust?prefix=` | Bust cache (all or prefixed) |

All upstream reads are wrapped in a 30–60s in-process TTL cache so the hub
doesn't hammer DNA / ScriptSage on every page load. Null upstream results
get a shorter 10s negative TTL.

## Local dev

```bash
npm install
npm run dev   # express + Vite on :5000
```

`DATABASE_URL` is optional — better-sqlite3 will create a local file if unset.
Without `DNA_API_BASE` / `SCRIPTSAGE_API_BASE` set, the hub still boots and
each section renders an "(not configured)" empty-state instead of crashing.

## Architecture

- `server/` — Express + better-sqlite3. `routes.ts` is the single mount
  point; `clients/{dna,scriptsage,health,cache}.ts` wrap upstream services.
- `client/` — Vite + React 18 + TanStack Query + shadcn/ui + wouter (hash
  routing for static-host friendliness).
- `shared/schema.ts` — Drizzle table definitions (sqlite dialect).
- `server/explorer/`, `server/digest.ts` — autonomy engine + Slack digest.

## Deploy

The hub runs anywhere Node 20+ runs. We currently host on
[pplx.app](https://momentiq-dna-hub.pplx.app). Set the env vars above (or
edit the `cron_config` table directly), wire the GitHub webhook at
`/api/pr-babysitter/webhook`, and you're done.
