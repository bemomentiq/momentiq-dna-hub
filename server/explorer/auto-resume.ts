// Always-on auto-resume orchestrator.
// Polls every 30s. If auto_resume_{explorer,executor} is enabled in cron_config,
// and the in-flight count for that kind is below auto_resume_max_concurrent,
// it auto-dispatches a new run. Each dispatch picks the lane with lowest current
// load (codex vs claude), and auto-cascades to mini-5 direct on hard failure.
//
// Idempotent: skips if a dispatch happened in the last auto_resume_min_gap_sec.
//
// This file is now a thin barrel re-exporting the modules under ./resume/.
// The implementation was split into:
//   resume/inflight.ts    — inFlightCount, isExecutorQueueEmpty, pickLane, due-checks
//   resume/dispatchers.ts — per-lane dispatch functions
//   resume/loop.ts        — dispatchWithCascade, tick, reaperTick, start*, reap telemetry
//
// lastReapedCount / lastReapedAt are mutable module-level values updated by the
// reaper and read by routes.ts. They are re-exported as ES module live bindings
// (export { ... } from) so consumers always observe the latest value.

export { startAutoResumer, startReaper, lastReapedCount, lastReapedAt } from "./resume/loop";
