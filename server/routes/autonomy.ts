import type { Express } from "express";
import { storage } from "../storage";
import { computeCascadeStats } from "../explorer/cascade-dispatch";
import { lastReapedCount, lastReapedAt } from "../explorer/auto-resume";

export function registerAutonomyRoutes(app: Express) {
  // ============ Autonomy status ============
  // Snapshot of the always-on engine: resume flags, concurrency caps, in-flight counts.
  app.get("/api/autonomy/status", (_req, res) => {
    const cfg = storage.getCronConfigSafe() as any;
    const explorerInFlight = storage.listRuns(50).filter((r) => r.status === "running" || r.status === "queued" || r.status === "planning").length;
    const executorInFlight = storage.listFleetRuns({ kind: "executor_cron", status: "running" }).length
      + storage.listFleetRuns({ kind: "executor_cron", status: "queued" }).length
      + storage.listFleetRuns({ kind: "executor_cron", status: "planning" as any }).length;
    const adHocInFlight = storage.listFleetRuns({ kind: "ad_hoc", status: "running" }).length;
    const auditInFlight = storage.listFleetRuns({ kind: "audit_cron", status: "running" }).length
      + storage.listFleetRuns({ kind: "audit_cron", status: "queued" }).length;
    const lastExplorer = storage.listRuns(1)[0];
    const lastExecutor = storage.listFleetRuns({ kind: "executor_cron", limit: 1 })[0];
    const lastAudit = storage.listFleetRuns({ kind: "audit_cron", limit: 1 })[0];
    const db = storage.getDb();
    const lastTestDebug = (db as any).prepare("SELECT * FROM test_debug_runs ORDER BY id DESC LIMIT 1").get() as any;
    const lastPrBabysitter = (db as any).prepare("SELECT * FROM pr_babysitter_runs ORDER BY id DESC LIMIT 1").get() as any;
    res.json({
      auto_resume: {
        explorer: !!cfg.auto_resume_explorer,
        executor: !!cfg.auto_resume_executor,
        max_concurrent: cfg.auto_resume_max_concurrent,
        min_gap_sec: cfg.auto_resume_min_gap_sec,
        // Per-kind caps + master loop toggle (AH-PHASE4-2)
        autonomous_indefinite_loop: cfg.autonomous_indefinite_loop !== false,
        explorer_max: cfg.auto_resume_explorer_max ?? 3,
        executor_max: cfg.auto_resume_executor_max ?? 3,
      },
      mini5_fallback_enabled: !!cfg.mini5_fallback_enabled,
      in_flight: { explorer: explorerInFlight, executor: executorInFlight, ad_hoc: adHocInFlight },
      last_explorer: lastExplorer ? { id: lastExplorer.id, status: lastExplorer.status, started_at: lastExplorer.started_at } : null,
      last_executor: lastExecutor ? { id: lastExecutor.id, status: lastExecutor.status, started_at: lastExecutor.started_at, pr_url: lastExecutor.gh_pr_url } : null,
      audit: {
        enabled: !!(cfg as any).auto_resume_audit,
        max: (cfg as any).auto_resume_audit_max ?? 1,
        interval_hours: (cfg as any).audit_interval_hours ?? 6,
        in_flight: auditInFlight,
        last_run_at: lastAudit?.started_at ?? null,
        last_status: lastAudit?.status ?? null,
      },
      test_debug: {
        enabled: !!(cfg as any).auto_resume_test_debug,
        max: (cfg as any).auto_resume_test_debug_max ?? 1,
        interval_hours: (cfg as any).test_debug_interval_hours ?? 4,
        last_run_at: lastTestDebug?.started_at ?? null,
        last_status: lastTestDebug?.status ?? null,
        last_findings_count: lastTestDebug?.findings_count ?? null,
      },
      pr_babysitter: {
        enabled: !!(cfg as any).pr_babysitter_enabled,
        last_run_at: lastPrBabysitter?.started_at ?? null,
        last_status: lastPrBabysitter?.status ?? null,
        last_pr_number: lastPrBabysitter?.pr_number ?? null,
      },
      consolidation: {
        enabled: !!(cfg as any).consolidation_cron_enabled,
        interval_hours: (cfg as any).consolidation_cron_interval_hours ?? 1,
        last_run_at: (cfg as any).consolidation_last_run_at ?? null,
        last_cc_task_id: (cfg as any).consolidation_last_cc_task_id ?? null,
      },
      reaper: {
        stale_run_max_age_sec: cfg.stale_run_max_age_sec ?? 2400,
        last_reaped_count: lastReapedCount,
        last_reaped_at: lastReapedAt,
      },
      cascade_stats: (() => {
        // Count last 50 runs across fleet + explorer runs by mini×provider
        const fleetMarkers = storage.listFleetRuns({ limit: 50 }).map((r) => (r as any).direct_marker ?? null);
        const explorerMarkers = storage.listRuns(50).map((r) =>
          r.error?.startsWith("direct:") ? r.error.replace(/^direct:/, "") : null
        );
        return computeCascadeStats([...fleetMarkers, ...explorerMarkers]);
      })(),
      ts: new Date().toISOString(),
    });
  });

  // ============ Autonomy dashboard endpoints ============

  // GET /api/autonomy/timeline — merged ExplorerRun + FleetRun list, desc by started_at, last 50
  app.get("/api/autonomy/timeline", (_req, res) => {
    const explorerRuns = storage.listRuns(50).map((r) => ({
      id: `explorer-${r.id}`,
      kind: "explorer" as const,
      status: r.status,
      started_at: r.started_at,
      finished_at: r.finished_at ?? null,
      duration_ms: r.duration_ms,
      lane: r.trigger,
      label: `Explorer #${r.id}`,
      error: r.error ?? null,
    }));
    const fleetRunsList = storage.listFleetRuns({ limit: 50 }).map((r) => ({
      id: `fleet-${r.id}`,
      kind: r.kind as string,
      status: r.status,
      started_at: r.started_at,
      finished_at: r.finished_at ?? null,
      duration_ms: r.duration_ms,
      lane: r.executor,
      label: `${r.kind === "executor_cron" ? "Executor" : "Ad-hoc"} #${r.id}`,
      error: r.error ?? null,
    }));
    const all = [...explorerRuns, ...fleetRunsList]
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 50);
    res.json(all);
  });

  // GET /api/autonomy/queue — drafts ranked by ev_score desc (uses priority order)
  app.get("/api/autonomy/queue", (_req, res) => {
    const PRIORITY_ORDER: Record<string, number> = { p0: 4, p1: 3, p2: 2, p3: 1 };
    const drafts = storage.listDraftTasks({ status: "proposed", limit: 200 });
    const ranked = drafts
      .map((d) => {
        const evScore = (d as any).ev_score ?? PRIORITY_ORDER[d.priority] ?? 0;
        return { ...d, ev_score: evScore };
      })
      .sort((a, b) => {
        const evDiff = (b as any).ev_score - (a as any).ev_score;
        if (evDiff !== 0) return evDiff;
        return PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      })
      .slice(0, 15);
    res.json(ranked);
  });
}
