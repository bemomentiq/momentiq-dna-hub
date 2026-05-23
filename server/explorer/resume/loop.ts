// Auto-resume + reaper loop (split from auto-resume.ts).

import { storage } from "../../storage";
import { computeExplorerPauseDecision, setExplorerPaused, isOrganizerDue } from "../backlog-organizer";
import {
  type Kind,
  inFlightCount,
  isExecutorQueueEmpty,
  pickLane,
  isAuditDue,
  isTestDebugDue,
  isConsolidationDue,
} from "./inflight";
import {
  dispatchExplorer,
  dispatchAudit,
  dispatchTestDebug,
  dispatchExecutor,
  dispatchConsolidation,
  dispatchOrganizer,
} from "./dispatchers";

const lastDispatchAt: Record<Kind, number> = { explorer: 0, executor: 0, audit: 0, test_debug: 0, consolidation: 0, organizer: 0 };

// Cascade: primary CC dispatch → if fails, mini-5 direct-tunnel
async function dispatchWithCascade(kind: Kind): Promise<void> {
  // Consolidation dispatches directly to CC (fire-and-forget) — no fleet cascade needed
  if (kind === "consolidation") {
    const r = await dispatchConsolidation();
    if (r.ok) {
      console.log(`[auto-resume] consolidation dispatched cc_task_id=${r.run_id}`);
    } else {
      console.error(`[auto-resume] consolidation dispatch failed: ${r.error}`);
    }
    return;
  }

  // Organizer dispatches directly to CC (fire-and-forget)
  if (kind === "organizer") {
    const r = await dispatchOrganizer();
    if (r.ok) {
      console.log(`[auto-resume] organizer dispatched cc_task_id=${r.run_id}`);
    } else {
      console.error(`[auto-resume] organizer dispatch failed: ${r.error}`);
    }
    return;
  }

  const cfg = storage.getCronConfig();
  const { primary, fallback } = pickLane(kind);
  const fn = kind === "explorer" ? dispatchExplorer
    : kind === "audit" ? dispatchAudit
    : kind === "test_debug" ? dispatchTestDebug
    : dispatchExecutor;

  const r1 = await fn(primary, fallback);
  if (r1.ok) {
    console.log(`[auto-resume] ${kind} dispatched on ${primary} run_id=${r1.run_id}`);
    return;
  }

  console.warn(`[auto-resume] ${kind} primary ${primary} failed: ${r1.error}; trying fallback ${fallback}`);
  const r2 = await fn(fallback, primary);
  if (r2.ok) {
    console.log(`[auto-resume] ${kind} dispatched on ${fallback} (fallback) run_id=${r2.run_id}`);
    return;
  }

  // Both lanes failed — cascade to mini-5 if enabled
  if (!(cfg as any).mini5_fallback_enabled) {
    console.error(`[auto-resume] ${kind} BOTH lanes failed, mini5 fallback disabled. Giving up this tick.`);
    return;
  }

  console.warn(`[auto-resume] ${kind} BOTH primary lanes failed; cascading to mini-5 direct-tunnel`);
  // Use the same endpoints with -direct executor variants which route via SSH-via-CC to mini-5
  const direct = kind === "explorer" ? "pin-codex-direct" : "pin-codex-direct";
  const directFb = kind === "explorer" ? "pin-claude-direct" : "pin-claude-direct";
  const r3 = await fn(direct, directFb);
  if (r3.ok) {
    console.log(`[auto-resume] ${kind} mini-5 direct dispatched run_id=${r3.run_id}`);
  } else {
    console.error(`[auto-resume] ${kind} mini-5 direct ALSO failed: ${r3.error}`);
  }
}

async function tick(): Promise<void> {
  let cfg: any;
  try {
    cfg = storage.getCronConfig();
  } catch {
    return;
  }
  if (!cfg.enabled) return;

  // Master loop toggle — when off the whole in-process auto-resume loop is halted
  if (cfg.autonomous_indefinite_loop === false) {
    console.log("[auto-resume] autonomous_indefinite_loop is OFF — skipping tick");
    return;
  }

  const now = Date.now();
  const minGapMs = (cfg.auto_resume_min_gap_sec ?? 30) * 1000;

  for (const kind of ["explorer", "executor", "audit", "test_debug", "consolidation", "organizer"] as Kind[]) {
    const flagKey = kind === "explorer" ? "auto_resume_explorer"
      : kind === "audit" ? "auto_resume_audit"
      : kind === "test_debug" ? "auto_resume_test_debug"
      : kind === "consolidation" ? "consolidation_cron_enabled"
      : kind === "organizer" ? "organizer_cron_enabled"
      : "auto_resume_executor";
    if (!(cfg as any)[flagKey]) continue;

    const elapsed = now - lastDispatchAt[kind];
    if (elapsed < minGapMs) continue;

    // Per-kind cap
    const maxConcurrent = kind === "explorer"
      ? (cfg.auto_resume_explorer_max ?? cfg.auto_resume_max_concurrent ?? 3)
      : kind === "audit"
      ? ((cfg as any).auto_resume_audit_max ?? 1)
      : kind === "test_debug"
      ? ((cfg as any).auto_resume_test_debug_max ?? 1)
      : kind === "consolidation" || kind === "organizer"
      ? 1
      : (cfg.auto_resume_executor_max ?? cfg.auto_resume_max_concurrent ?? 3);

    const inFlight = await inFlightCount(kind);
    if (inFlight >= maxConcurrent) continue;

    // Explorer-specific: dynamic pause check (open-cap + novelty-floor heuristic)
    if (kind === "explorer") {
      const decision = computeExplorerPauseDecision();
      if (decision.pause) {
        setExplorerPaused(decision.reason ?? "unknown");
        console.log(`[auto-resume] Explorer paused: ${decision.reason}`);
        continue;
      }
      setExplorerPaused(null);
    }

    // Executor-specific: back off if queue was drained (consecutive QUEUE_EMPTY pickups)
    if (kind === "executor" && isExecutorQueueEmpty()) {
      console.log(`[auto-resume] executor queue is empty (last 2 completed runs reported QUEUE_EMPTY); waiting for Explorer to propose new work`);
      continue;
    }

    // Audit-specific: only dispatch if audit_interval_hours have passed since the last audit run
    if (kind === "audit") {
      const intervalHours = (cfg as any).audit_interval_hours ?? 6;
      if (!isAuditDue(intervalHours)) {
        console.log(`[auto-resume] audit not yet due (interval=${intervalHours}h); skipping tick`);
        continue;
      }
    }

    // Test-debug: interval-gated (default 4h)
    if (kind === "test_debug") {
      const intervalHours = (cfg as any).test_debug_interval_hours ?? 4;
      if (!isTestDebugDue(intervalHours)) {
        console.log(`[auto-resume] test_debug not yet due (interval=${intervalHours}h); skipping tick`);
        continue;
      }
    }

    // Consolidation: interval-gated (default 1h)
    if (kind === "consolidation") {
      const intervalHours = (cfg as any).consolidation_cron_interval_hours ?? 1;
      if (!isConsolidationDue(intervalHours)) {
        console.log(`[auto-resume] consolidation not yet due (interval=${intervalHours}h); skipping tick`);
        continue;
      }
    }

    // Organizer: interval-gated (default 30 min)
    if (kind === "organizer") {
      const intervalMinutes = (cfg as any).organizer_cron_interval_minutes ?? 30;
      if (!isOrganizerDue(intervalMinutes)) {
        console.log(`[auto-resume] organizer not yet due (interval=${intervalMinutes}min); skipping tick`);
        continue;
      }
    }

    lastDispatchAt[kind] = now;
    // Fire-and-forget so a slow dispatch doesn't block the other kind
    dispatchWithCascade(kind).catch((err) => {
      console.error(`[auto-resume] ${kind} dispatch threw:`, err?.message ?? err);
    });
  }
}

let started = false;
export function startAutoResumer() {
  if (started) return;
  started = true;
  console.log("[auto-resume] started; polling every 30s");
  setInterval(() => {
    tick().catch((err) => console.error("[auto-resume] tick error:", err?.message ?? err));
  }, 30_000);
  // Kick once on boot after a 10s delay so server is fully up
  setTimeout(() => tick().catch(() => {}), 10_000);
}

// ============ Auto-reaper ============
// Marks any ExplorerRun or FleetRun stuck in 'running' beyond stale_run_max_age_sec as failed.
// Runs every 60s. Module-level state exposes last reap telemetry to /api/autonomy/status.

export let lastReapedCount = 0;
export let lastReapedAt: string | null = null;

async function reaperTick(): Promise<void> {
  let cfg: any;
  try {
    cfg = storage.getCronConfig();
  } catch {
    return;
  }
  const maxAgeSec: number = cfg.stale_run_max_age_sec ?? 2400;

  const explorer = storage.markStaleExplorerRunsFailed(maxAgeSec);
  const fleet = storage.markStaleFleetRunsFailed(maxAgeSec);
  const total = explorer.count + fleet.count;

  if (total > 0) {
    lastReapedCount = total;
    lastReapedAt = new Date().toISOString();
    console.log(
      `[reaper] reaped ${total} stale run(s) (explorer: ${explorer.ids.join(",") || "none"} | fleet: ${fleet.ids.join(",") || "none"}) older than ${maxAgeSec}s`,
    );
  }
}

let reaperStarted = false;
export function startReaper() {
  if (reaperStarted) return;
  reaperStarted = true;
  console.log("[reaper] started; scanning for stale runs every 60s");
  setInterval(() => {
    reaperTick().catch((err) => console.error("[reaper] tick error:", err?.message ?? err));
  }, 60_000);
  // Initial scan after 15s so DB is ready
  setTimeout(() => reaperTick().catch(() => {}), 15_000);
}
