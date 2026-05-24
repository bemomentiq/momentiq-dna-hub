# CLEANUP-5 dead-code audit (#27)

Audit of `server/` and `shared/` for orphaned exports, unused helpers, and dead
code paths after CLEANUP-1..4 landed. Tooling: `ts-prune` + `depcheck` + manual
grep of every flagged symbol.

## Removed

### Unused exports

- `server/sentry.ts` — `sentryRequestHandler()` no-op middleware. No callers; the
  Sentry SDK's `setupExpressErrorHandler` is what `installSentryErrorHandler`
  uses.
- `server/explorer/neon-signals.ts` — `signalsCacheAgeSeconds()` diagnostic
  helper. Not wired to any route or log call.
- `server/explorer/direct-targets.ts` — `DIRECT_TARGETS` matrix const. The
  actual `DIRECT_TARGETS` consumed by `fleet-routes.ts` is re-exported from
  `direct-dispatch.ts` (which re-exports `LEGACY_DIRECT_TARGETS as
  DIRECT_TARGETS`). The new matrix-shaped const had no consumers.
- `shared/dna-focus-areas.ts` — `focusAreaSchema` (zod refinement). No route
  validates focus_area through this schema; ingest uses string + nullable
  fallback to `(uncategorized)`. Also dropped the now-unused `zod` import.
- `client/src/lib/types.ts` — `ActionExtras`, `AutonomyAction`, `Rollups`,
  `RoadmapItem`, `RoadmapPhase`, `FeedItem`, `Feed`, `HitlBurden`,
  `DataPipeline`. All SID-era types from pages removed during the content
  platform redesign. Pages that survive (`HitlBurden.tsx`, `DataPipeline.tsx`)
  declare their own DNA-shaped local types and never imported these.

### Unused npm dependencies

Dropped from `package.json` after confirming zero imports across `client/`,
`server/`, `shared/`, `scripts/`, `tests/`, `script/`, and config files:

- `@hookform/resolvers` — no `useForm({ resolver: ... })` callers.
- `@jridgewell/trace-mapping` — transitive of vite/drizzle-kit; not directly
  imported.
- `framer-motion` — no `motion.*` imports.
- `next-themes` — no `<ThemeProvider>` mount.
- `react-icons` — no `Fa*`/`Hi*`/`Md*` imports (the repo uses `lucide-react`).
- `tw-animate-css` — no CSS or JS import.
- `ws` — no direct WebSocket usage; vite/drizzle bring their own ws as a
  transitive when they need it.
- `zod-validation-error` — no `fromZodError` / `toValidationError` callers.
- `@tailwindcss/vite` — `vite.config.ts` does not register this plugin; the
  project uses the PostCSS pipeline (`postcss.config.js` + `tailwindcss`).
- `@types/ws` — paired with the removed `ws` dep.
- `bufferutil` (optionalDependencies) — `ws`-paired perf addon; obsolete once
  `ws` is gone.

Also pruned `ws` and `zod-validation-error` from the `script/build.ts` esbuild
allowlist.

## Kept (intentional remaining findings)

### ts-prune

- `shared/schema.ts` insert/select-row type pairs: `InsertCronConfig`,
  `PrBabysitterRun`, `InsertPrBabysitterRun`, `TestDebugRun`,
  `InsertTestDebugRun`, `SkillUpdate`, `InsertSkillUpdate`,
  `ReadinessSnapshot`, `InsertReadinessSnapshot`. These follow the
  drizzle-zod convention of co-declaring each table's row type + insert
  schema; storage.ts consumes them structurally (via `typeof
  tbl.$inferInsert`) rather than by named import. Removing them would diverge
  from the file's pattern and reintroduce them at the next schema edit.
- `client/src/components/data-table/index.ts` and
  `client/src/components/states/index.ts` re-exports — these barrel files
  are the canonical import path used by ~12 pages; ts-prune false-positives
  when traversing re-export chains.

### depcheck

- `autoprefixer`, `postcss` — used by `postcss.config.js`; depcheck cannot
  parse the JS config so it flags both. Both are required for the Tailwind
  build pipeline.
- "Missing" deps reported by depcheck (`@shared/schema`,
  `@shared/dna-focus-areas`) — tsconfig path aliases, not npm packages.
- "Missing" `nanoid` — used only by `server/vite.ts`, which is dynamically
  imported in dev mode (`server/index.ts:106`). nanoid is currently resolved
  as a hoisted transitive. Pre-existing; out of scope for this audit.

### Other candidates examined and kept

- `server/digest.ts` — actively imported by `server/routes.ts` to back
  `POST /api/digest/post`. Not orphaned.
- `server/explorer/kalodata-signals.ts` — DNA Kalodata signals, explicitly
  flagged in the issue as KEEP.
- `server/explorer/neon-signals.ts` — used by `server/explorer/prompt.ts` to
  inject live production signals into the Explorer briefing. The SQL targets
  legacy SID tables (`cos_runs`, `cos_run_queue`, `hitl_decision_log`); when
  `NEON_READ_URL` isn't set, it returns a graceful "unavailable" stub. Kept
  as-is — narrowing the Explorer prompt's signal sources is a separate scope.
- `shared/action-extras.ts` — not present (already removed in an earlier
  CLEANUP PR).

## Verification

- `npm run check` clean.
- `npm run build` clean (client + server bundles).
- `ts-prune` remaining findings are the documented deliberate ones above.
- `depcheck` remaining findings are the documented false positives above.

## Numbers

| Category | Count |
|---|---|
| Source files touched | 6 |
| npm deps removed | 10 + 1 optional |
| Lines removed from `client/src/lib/types.ts` | 92 |
| Lines removed from `package.json` | 15 |
| Lines removed from other source files | ~30 |
| Lockfile entries removed (`package-lock.json`) | ~500 |
