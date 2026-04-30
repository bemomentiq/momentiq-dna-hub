// When the Perplexity schedule_cron fires, it calls POST /api/explorer/trigger to create
// a new queued run and receive the dispatch payload. It then runs the subagent and PUTs
// the results to /api/explorer/runs/:id/ingest.
//
// The server ALSO maintains a soft "should have fired by now" check so the dashboard can
// show staleness if the cron misses a cycle.
import type { Express } from "express";
import { storage } from "../storage";
import { buildDispatchPayload } from "./prompt";

export function registerDispatchRoutes(app: Express) {
  // Trigger endpoint — called by external cron OR manual UI.
  // Returns the full dispatch payload (prompt + metadata) for whoever will run it.
  app.post("/api/explorer/trigger", async (req, res) => {
    const cfg = storage.getCronConfig();
    const trigger = (req.body?.trigger as string) || "cron";

    // If cron is disabled and this is a cron trigger, refuse.
    if (trigger === "cron" && !cfg.enabled) {
      return void res.status(423).json({ error: "cron_disabled", next_due_at: null });
    }

    const run = storage.createRun({
      started_at: new Date().toISOString(),
      status: "queued",
      trigger,
      model: cfg.model,
    });
    // Compute next_due_at
    const next = new Date(Date.now() + cfg.interval_minutes * 60_000);
    storage.updateCronConfig({ next_due_at: next.toISOString() });
    res.json({ run, dispatch: await buildDispatchPayload(run.id), cc_api_url: cfg.cc_api_url });
  });

  // Staleness diagnostic
  app.get("/api/explorer/health", (_req, res) => {
    const cfg = storage.getCronConfig();
    const stats = storage.stats();
    const now = Date.now();
    const dueAt = cfg.next_due_at ? new Date(cfg.next_due_at).getTime() : null;
    const overdueMs = dueAt && dueAt < now ? now - dueAt : 0;
    res.json({
      enabled: cfg.enabled,
      interval_minutes: cfg.interval_minutes,
      last_run_at: cfg.last_run_at,
      next_due_at: cfg.next_due_at,
      overdue_minutes: Math.round(overdueMs / 60_000),
      runs_total: stats.totalRuns,
      runs_completed: stats.completed,
      runs_failed: stats.failed,
    });
  });
}
