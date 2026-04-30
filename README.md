# momentiq-dna-hub

Autonomous 4-lane development hub targeting [`bemomentiq/momentiq-dna`](https://github.com/bemomentiq/momentiq-dna).

Adapted from [autonomy-hub](https://github.com/bemomentiq/autonomy-hub) with four specialized operational lanes.

## Lanes

| Lane | Trigger | Role |
|---|---|---|
| **Explorer** | Cron (hourly) | Scans DNA repo + Kalodata companion signals, files epic-shaped issues |
| **Epic-Executor** | Cron / auto-resume | Plans + ships 3–7 related PRs as coordinated epics |
| **PR-Babysitter** | GitHub webhook | Diagnoses + fixes failing CI, rebases, conditionally merges |
| **Test-Debug** | Cron (4h) | E2E probes against control panel, pipeline, and hub; auto-files findings |

## New endpoints (vs autonomy-hub template)

| Method | Path | Description |
|---|---|---|
| POST | `/api/pr-babysitter/webhook` | HMAC-verified GitHub CI webhook |
| POST | `/api/pr-babysitter/dispatch` | Manual PR babysitter trigger |
| GET | `/api/pr-babysitter/runs` | List recent babysitter runs |
| POST | `/api/test-debug/dispatch` | Manual test-debug trigger |
| GET/PATCH | `/api/test-debug/runs/:id` | Read/update a test-debug run |
| GET | `/api/test-debug/runs` | List recent test-debug runs |
| POST | `/api/skills/update` | Agents log learned skill diffs (Phase 5b) |
| GET | `/api/skills/updates` | List skill updates |
| PATCH | `/api/skills/updates/:id/apply` | Mark a skill update applied |

## Schema additions

Four new tables: `pr_babysitter_runs`, `test_debug_runs`, `skill_updates`, `readiness_snapshots`.

## Companion signals

Explorer fetches live readiness + roadmap state from the Kalodata platform, injecting completion percentages and blocked items into its planning context.

## Setup

```bash
cp .env.example .env
# Fill in DATABASE_URL, GH_TOKEN, PR_BABYSITTER_WEBHOOK_SECRET, KALODATA_API_URL
npm install
npm run db:push
npm run dev
```

## Deploy

Railway (Docker). Set env vars via Railway dashboard. Configure GitHub webhook to point at `/api/pr-babysitter/webhook` with content type `application/json`.
