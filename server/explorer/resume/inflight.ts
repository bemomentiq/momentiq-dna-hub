// In-flight counting, lane selection, and due-checks for the auto-resume loop
// (split from auto-resume.ts).

import { storage } from "../../storage";

export type Kind = "explorer" | "executor" | "audit" | "test_debug" | "consolidation" | "organizer";

export async function inFlightCount(kind: Kind): Promise<number> {
  if (kind === "explorer") {
    return storage.listRuns(50).filter((r) => r.status === "running" || r.status === "queued" || r.status === "planning").length;
  }
  if (kind === "audit") {
    return storage.listFleetRuns({ kind: "audit_cron", status: "running" }).length
      + storage.listFleetRuns({ kind: "audit_cron", status: "queued" }).length;
  }
  if (kind === "test_debug") {
    return storage.listFleetRuns({ kind: "test_debug_cron", status: "running" }).length
      + storage.listFleetRuns({ kind: "test_debug_cron", status: "queued" }).length;
  }
  // Consolidation and Organizer dispatch externally to CC — always 0 in-flight from Hub perspective
  if (kind === "consolidation" || kind === "organizer") {
    return 0;
  }
  return storage.listFleetRuns({ kind: "executor_cron", status: "running" }).length
    + storage.listFleetRuns({ kind: "executor_cron", status: "queued" }).length
    + storage.listFleetRuns({ kind: "executor_cron", status: "planning" as any }).length;
}

// Check if the executor queue is effectively empty based on the most recent completed run's next_pickup.
// If the last completed run wrote QUEUE_EMPTY, we back off until the Explorer proposes new work.
export function isExecutorQueueEmpty(): boolean {
  const recent = storage.listFleetRuns({ kind: "executor_cron", limit: 10 })
    .filter((r) => r.status === "completed")
    .slice(0, 3);
  if (!recent.length) return false;
  const queueEmptyCount = recent.filter((r) => ((r as any).next_pickup || "").startsWith("QUEUE_EMPTY")).length;
  // If the last 2+ completed runs both said QUEUE_EMPTY, back off
  return queueEmptyCount >= 2;
}

// Pick which lane to dispatch on based on current load distribution.
// Round-robin between codex and claude; if a lane has been used in the last 60s, prefer the other.
export function pickLane(kind: Kind): { primary: string; fallback: string } {
  const recentRuns = kind === "explorer"
    ? storage.listRuns(8)
    : storage.listFleetRuns({ kind: "executor_cron", limit: 8 });
  const recentExecutors = recentRuns.map((r: any) => r.executor || "");
  const codexCount = recentExecutors.filter((e) => e === "pin-codex").length;
  const claudeCount = recentExecutors.filter((e) => e === "pin-claude").length;
  // Whichever has fewer recent runs gets the new slot
  if (codexCount <= claudeCount) {
    return { primary: "pin-codex", fallback: "pin-claude" };
  }
  return { primary: "pin-claude", fallback: "pin-codex" };
}

// Check whether enough time has passed since the last audit run (audit_interval_hours gating).
// Only dispatch a new audit if the last audit_cron run started more than N hours ago (or never).
export function isAuditDue(intervalHours: number): boolean {
  const runs = storage.listFleetRuns({ kind: "audit_cron", limit: 1 });
  if (!runs.length) return true;
  const lastRun = runs[0];
  const lastAt = new Date(lastRun.started_at).getTime();
  const elapsedHours = (Date.now() - lastAt) / (1000 * 60 * 60);
  return elapsedHours >= intervalHours;
}

export function isTestDebugDue(intervalHours: number): boolean {
  const runs = storage.listFleetRuns({ kind: "test_debug_cron", limit: 1 });
  if (!runs.length) return true;
  const lastRun = runs[0];
  const lastAt = new Date(lastRun.started_at).getTime();
  const elapsedHours = (Date.now() - lastAt) / (1000 * 60 * 60);
  return elapsedHours >= intervalHours;
}

// Check whether enough time has passed since the last consolidation dispatch.
// Gates based on consolidation_last_run_at stored in cron_config (not a fleet_run row).
export function isConsolidationDue(intervalHours: number): boolean {
  const cfg = storage.getCronConfig() as any;
  const lastRunAt: string | null = cfg.consolidation_last_run_at ?? null;
  if (!lastRunAt) return true;
  const lastAt = new Date(lastRunAt).getTime();
  const elapsedHours = (Date.now() - lastAt) / (1000 * 60 * 60);
  return elapsedHours >= intervalHours;
}
