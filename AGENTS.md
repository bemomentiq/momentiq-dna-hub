# AGENTS.md — momentiq-dna-hub

If you are an autonomous agent (codex, aider, cursor, gpt-engineer, lane-fleet
runner, etc.) that has just landed in this repo: read this file before
touching anything else. It tells you what this repo IS, what skills to load,
and what NOT to load.

## What this repo is

This is **DNA Hub** — the operator surface for
`bemomentiq/momentiq-dna`. It is NOT a generic autonomy-hub template, and
it is NOT any of the other historical Momentiq operator consoles. The
product repo you are reasoning about is `bemomentiq/momentiq-dna`; this
repo only dispatches against it (and the three sibling content-platform
repos listed in the README).

Scoping signal: if the issue you are working on names themes, IDS, Veo 3.1,
ScriptSage, Thompson bandit, DNA-knob, LoRA drift, or one of the 15 DNA
focus areas in `shared/dna-focus-areas.ts`, you are in the right place. If
it names a non-DNA product surface (anything outside the 15 focus areas
above, including the legacy SID action-grid), politely refuse and ask the
issue author to refile against the correct repo.

## Skills to load

Load these and ONLY these for any task in this repo:

- `mcc-roadmap-specialist-dna` — the 15 DNA roadmap focus areas
  (kalodata-gemini-extraction, dna-knob-config, video-engines,
  tts-voice-lock, thompson-8-attrs, dr-ips-router, compliance-gate,
  gmv-max, ids-bandit-ingest, lora-drift-distill, control-panel,
  api-v1-dna-tests, observability, promotion-gates, data-corpus).
  See `shared/dna-focus-areas.ts` for the canonical list.
- `vidgen-continuity-ops` — Veo 3.1 / Vertex / Pollo / Seedance dispatch,
  TTS + voice-lock, post-processing M11–M28 conventions.
- `codex-fleet` — FLEET-style master-tracker + sibling-issue conventions
  (see `server/explorer/prompt.ts` for the canonical 8-H2 agentBriefing
  format).

## Skills to NOT load

These were applicable in earlier (pre-DNA-redesign) incarnations of the hub
or belong to sibling product repos. Loading them in this repo wastes context
and produces off-target suggestions:

- Anything from the pre-redesign era (action-grid, money-path,
  action-classifier, rollups, exec-brief.md). Those endpoints were
  intentionally removed during the content-platform redesign.
- Any product-domain skill whose name does not match the LOAD list above.
  This includes adjacent Momentiq operator surfaces — they live in their
  own repos and have their own skills.
- Generic autonomy-hub skills — those live in `bemomentiq/autonomy-hub`.
- `mcc-roadmap-specialist` (without the `-dna` suffix) — that one targets
  a different product.

## Where to file work

- Hub-side bugs / features (this repo): file in
  `bemomentiq/momentiq-dna-hub`, tag `area:hub`.
- DNA-product work (pipeline, scoring, bandit, engines): file in
  `bemomentiq/momentiq-dna`, tag with the matching DNA focus area.
- ScriptSage backend or frontend: file in the respective scriptsage repo.

The Explorer lane auto-files into the right repo based on the finding's
`focus_area` — you do not need to override that.

## Conventions for changes in this repo

- TypeScript strict mode. `npm run check` must pass (`tsc`).
- Add E2E coverage for new routes: `tests/` is Playwright; run with
  `npm run test:e2e`.
- All upstream calls go through `server/clients/*.ts` so the TTL cache
  + null-on-unconfigured pattern is preserved.
- New routes mount in `server/routes.ts` (or one of the `explorer/*-routes.ts`
  registrars). The `hubAuth()` middleware enforces `X-Hub-Token`; only
  `/api/health` and `/api/pr-babysitter/webhook` are exempt.
- Commit style: match `[PREFIX-N]` from `git log --oneline -20` (e.g.
  `[DNA-1]`, `[CLEANUP-6]`). PR titles use conventional-commit verbs
  (`docs:`, `feat:`, `fix:`, `refactor:`).

## Dispatch path (so you understand what calls you)

Hub Express server → CC `POST /api/tasks` (DNA project `14920`, built in
`server/explorer/cc-dispatch.ts`) → a GKE codex-lane (`gke-codex-lane-1..13`)
runs `claude` or `codex` with the briefing this repo built in
`server/explorer/prompt.ts`. CC owns lane selection + resilience. The legacy
direct-SSH-to-mini path (`mini-4`/`mini-5`) was removed in the CC→GKE
migration. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §2 for the full
picture.

## Don't

- Do NOT add features for product domains that aren't DNA. If your finding
  is for a non-DNA product surface, file it in that product's own repo
  instead.
- Do NOT re-introduce pre-redesign endpoints (`/api/actions`,
  `/api/rollups`, `/api/money-path`, etc.) — they were intentionally
  removed during the content-platform redesign.
- Do NOT skip the TTL cache when calling DNA / ScriptSage upstream. Page
  loads will hammer them otherwise.
- Do NOT push to `main` directly. Open a PR; if you are an automated lane,
  the supervisor will open the PR for you after you commit and exit.

## Files to read first

1. `README.md` — operator-facing overview.
2. `docs/ARCHITECTURE.md` — dispatch flow, data-source map, schema.
3. `docs/RUNBOOK.md` — operator runbook (incident response).
4. `shared/dna-focus-areas.ts` — the 15 canonical work units.
5. `shared/dna-pipeline-stages.ts` — the canonical 7-stage pipeline.
6. `server/explorer/prompt.ts` — the Explorer briefing template the
   lanes use; copy its 8-H2 structure for any agent-facing issue you file.
