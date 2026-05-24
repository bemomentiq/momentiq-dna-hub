# momentiq-dna-hub

**DNA Hub** — the operator surface for the
[`bemomentiq/momentiq-dna`](https://github.com/bemomentiq/momentiq-dna) video
pipeline. Reads live DNA state (corpus, A/B runs, IDS scoring, Veo spend,
Thompson bandit), surfaces it through a React control panel, and dispatches
autonomous agent lanes against the DNA product repos.

This repo is **not** a generic autonomy framework. The reusable template lives
at [`bemomentiq/autonomy-hub`](https://github.com/bemomentiq/autonomy-hub).
DNA Hub is a forked, DNA-scoped instance — it knows about themes, IDS, Veo
3.1, ScriptSage, and the 15 DNA roadmap focus areas, and it dispatches against
exactly four content-platform repos.

Production: <https://momentiq-dna-hub-2.pplx.app> (Railway).
Operator runbook: [`docs/RUNBOOK.md`](docs/RUNBOOK.md).
Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## What it dispatches against

| Repo | Role |
|---|---|
| [`bemomentiq/momentiq-dna`](https://github.com/bemomentiq/momentiq-dna) | TikTok Shop UGC corpus, Thompson 8-attr bandit, Veo 3.1 / Vertex / Pollo / Seedance dispatch, IDS scoring, LoRA drift |
| [`bemomentiq/momentiq-dna-hub`](https://github.com/bemomentiq/momentiq-dna-hub) | This repo — operator console + autonomy dispatcher |
| [`bemomentiq/momentiq-scriptsage-backend`](https://github.com/bemomentiq/momentiq-scriptsage-backend) | Script + video generation API, Stripe billing, admin/jobs |
| [`bemomentiq/momentiq-scriptsage-frontend`](https://github.com/bemomentiq/momentiq-scriptsage-frontend) | Creator-facing video creation UI |

Every Explorer / Executor / PR-babysitter / Test-debug run targets one of
these four. Out-of-scope repos (partner-center, anything SID-era) have been
removed from the dispatch path.

---

## Autonomy lanes

| Lane | Trigger | Role |
|---|---|---|
| **Explorer** | Cron / manual | Scans the 4 content repos, reads live DNA state, files epic-shaped GitHub issues tagged with one of 15 DNA focus areas |
| **Epic-Executor** | Cron / auto-resume | Plans + ships 3–7 related PRs as a coordinated epic against `momentiq-dna` |
| **PR-Babysitter** | GitHub webhook (`/api/pr-babysitter/webhook`) | Diagnoses + fixes failing CI on open PRs, rebases, conditionally merges |
| **Test-Debug** | Cron (4h) | E2E probes against the DNA pipeline; auto-files findings as issues |
| **Consolidation** | Cron (1h) | Cross-lane reconciliation + Slack digest |

Dispatch path: hub → SSH tunnel → mini (`mini-4` or `mini-5` per
`server/explorer/direct-targets.ts`) → `claude` or `codex` CLI inline. The
GKE codex-lane path is **not** wired in this instance — direct-SSH-to-mini is
the only live target. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §2
for the full dispatch flow.

---

## Page → API → data source map

| Route | API | Upstream |
|---|---|---|
| `/` (Overview) | `/api/overview/dna-kpis`, `/api/content-platform/overview` | DNA + ScriptSage + Neon |
| `/exec` (Executive brief) | `/api/overview/dna-kpis`, `/api/content-platform/promotion-candidates` | DNA |
| `/themes`, `/themes/:slug` | `/api/content-platform/themes[/:slug]` | DNA `dna.theme_optimal_configs` |
| `/ab-runs` | `/api/content-platform/ab-runs?status=` | DNA |
| `/scoring` | `/api/content-platform/ids-distribution?window_days=` | DNA |
| `/bandit` | `/api/content-platform/bandit/{state,learning-metrics,regret}` | DNA Thompson posteriors |
| `/scriptsage` | `/api/content-platform/scriptsage[/failures\|/errors\|/funnel\|/queue-health]` | ScriptSage backend |
| `/veo-cost` | `/api/content-platform/veo-cost?window_days=` | DNA |
| `/subscriptions` | `/api/content-platform/subscriptions` | ScriptSage backend |
| `/pipeline` | `/api/data-pipeline/stages` | local (7-stage canonical roadmap) |
| `/pipeline-health` | `/api/content-platform/health` | live probes (DNA · ScriptSage · Kalodata) |
| `/roadmap` | `/api/content-platform/roadmap` | GitHub milestones + `epic:*` labels |
| `/issues` | `/api/gh-issues?state=&labels=` | GitHub Issues API |
| `/hitl` | `/api/hitl/queue`, `/api/hitl/burden` | local sqlite |
| `/autonomy`, `/fleet`, `/backlog`, `/explorer`, `/run` | `/api/autonomy/*`, `/api/fleet/*` | local sqlite (run state) |

All upstream reads are wrapped in a 30–60s in-process TTL cache so the hub
doesn't hammer DNA / ScriptSage on every page load. Null upstream results
get a shorter 10s negative TTL. Cache introspection at
`/api/content-platform/cache`; bust with
`POST /api/content-platform/cache/bust?prefix=`.

---

## Local development

```bash
npm install
npm run dev   # express + Vite on :5000
```

`DATABASE_URL` is optional — better-sqlite3 will create a local `data.db` if
unset. Without `DNA_API_BASE` / `SCRIPTSAGE_API_BASE` set, the hub still
boots and each section renders an "(not configured)" empty state instead of
crashing.

Typecheck, build, E2E:

```bash
npm run check        # tsc
npm run build        # tsx script/build.ts — server bundle + Vite client
npm run test:e2e     # Playwright
npm run smoke        # tsx scripts/smoke-test.ts
```

---

## Environment

Both env vars and `cron_config` DB columns are honored (env wins). The DB
column path lets operators flip URLs without redeploys, via the autonomy
page. See [`docs/RUNBOOK.md`](docs/RUNBOOK.md) §2 for the full list with
rotation procedures.

| Env var | DB column | Purpose |
|---|---|---|
| `HUB_TOKEN` | — | Shared secret enforced on `/api/*` via `X-Hub-Token` header (required in prod) |
| `GH_PAT` / `GH_TOKEN` / `GITHUB_TOKEN` | `github_token` | GitHub access for issues, roadmap, PR-babysitter (required) |
| `SENTRY_DSN` | — | Error capture (recommended) |
| `DATABASE_URL` | — | Postgres URL; falls back to local sqlite (`data.db`) when unset |
| `DNA_API_BASE` | `dna_api_base` | momentiq-dna service base URL |
| `DNA_API_TOKEN` | `dna_api_token` | optional bearer for DNA |
| `SCRIPTSAGE_API_BASE` | `scriptsage_api_base` | scriptsage-backend base URL |
| `SCRIPTSAGE_API_TOKEN` | `scriptsage_api_token` | optional bearer for ScriptSage |
| `KALODATA_API_URL` | `companion_site_url` | companion signals + health probe |
| `SLACK_WEBHOOK_URL` | `slack_webhook_url` | nightly digest sink |

---

## Repo layout

- `server/` — Express + better-sqlite3. `routes.ts` is the single mount
  point; `clients/{dna,scriptsage,health,cache,dna-kpis}.ts` wrap upstream
  services with TTL caching.
- `server/explorer/` — the five autonomy lanes (Explorer, Executor /
  fleet-routes, PR-babysitter, test-debug, consolidation) plus the direct
  SSH dispatch path (`direct-dispatch.ts`, `direct-ssh.ts`,
  `direct-targets.ts`, `cascade-dispatch.ts`).
- `client/` — Vite + React 18 + TanStack Query + shadcn/ui + wouter (hash
  routing for static-host friendliness).
- `shared/schema.ts` — Drizzle table definitions (sqlite dialect).
- `shared/dna-focus-areas.ts` — the 15 canonical DNA roadmap focus areas
  that all Explorer findings + draft tasks must tag.
- `shared/dna-pipeline-stages.ts` — the canonical 7-stage DNA pipeline
  surfaced on `/pipeline`.

---

## Contributing

For agents (Claude Code, codex, aider, etc.) — read
[`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) first. They define
the in-scope skills, repos, and conventions for this hub.

For humans:

1. Pick (or file) an issue in `bemomentiq/momentiq-dna-hub`. Hub-side work
   is tagged `area:hub`; DNA-product work belongs in
   `bemomentiq/momentiq-dna`.
2. Keep changes scoped — one concern per PR. The Explorer/Executor lanes
   actively file PRs; humans rebasing on top of them is friction.
3. Match the conventional-commit / `[PREFIX-N]` style visible in
   `git log --oneline`.
4. `npm run check && npm run test:e2e` before pushing.
5. Update [`docs/RUNBOOK.md`](docs/RUNBOOK.md) in the same PR if you change
   operator behavior, env vars, or dashboards.

---

## Deploy

The hub runs anywhere Node 20+ runs. Production is Railway with deploys
triggered by `git push origin main`. Build is `tsx script/build.ts` (server
bundle to `dist/index.cjs` + Vite client build); `npm start` runs the
production node entrypoint. Full deploy + rollback procedure in
[`docs/RUNBOOK.md`](docs/RUNBOOK.md) §3–4.

After deploy, smoke-test:

```bash
curl -sS https://momentiq-dna-hub-2.pplx.app/api/health | jq
curl -sS -H "X-Hub-Token: $HUB_TOKEN" \
  https://momentiq-dna-hub-2.pplx.app/api/autonomy/queue | jq '. | length'
```

---

## Out of scope

- Generic autonomy-hub framework features (those land in
  `bemomentiq/autonomy-hub`).
- Public-facing creator docs (creator UI lives in
  `momentiq-scriptsage-frontend`).
- Partner-center, SID-era endpoints, and any non-DNA product surfaces —
  removed during the DNA content-platform redesign (see merged PR history).
