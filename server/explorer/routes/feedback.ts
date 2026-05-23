import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";

export function registerFeedbackRoutes(app: Express) {
  // ============ PR-outcome attribution ============
  // Heat formula:
  //   merged   → +1.0 (capped at 10)
  //   failed   → -0.5 (floor at 0.1)
  //   reverted → -1.5 (floor at 0.1)

  const OUTCOME_DELTAS: Record<string, number> = {
    merged: 1.0,
    failed: -0.5,
    reverted: -1.5,
  };

  // POST /api/feedback/pr-merged
  // Body: { run_id, ci_cycles?, reviewer_comments?, outcome }
  app.post("/api/feedback/pr-merged", (req, res) => {
    const body = z.object({
      run_id: z.number().int(),
      ci_cycles: z.number().int().default(0),
      reviewer_comments: z.number().int().default(0),
      outcome: z.enum(["merged", "failed", "reverted"]),
    }).parse(req.body);

    const delta = OUTCOME_DELTAS[body.outcome] ?? 0;

    // Resolve source explorer run: fleet run → cc_task_id → draft_tasks → run_id
    // Fall back to bumping via fleet run id directly if not resolvable.
    const fleetRun = storage.getFleetRun(body.run_id);
    let sourceRunId: number | null = null;
    if (fleetRun?.gh_pr_url) {
      // Try to find the draft task that seeded this PR
      const tasks = storage.listDraftTasks({ limit: 200 });
      const matched = tasks.find(
        (t) => t.cc_task_id === fleetRun.cc_task_id && fleetRun.cc_task_id != null,
      );
      if (matched?.run_id) sourceRunId = matched.run_id;
    }

    // Record outcome
    const record = storage.recordPrOutcome({
      run_id: body.run_id,
      source_run_id: sourceRunId ?? undefined,
      gh_pr_url: fleetRun?.gh_pr_url ?? null,
      outcome: body.outcome,
      ci_cycles: body.ci_cycles,
      reviewer_comments: body.reviewer_comments,
      reward_delta: delta,
      created_at: new Date().toISOString(),
    });

    // Apply heat bump to ledger entries linked to the source explorer run
    if (sourceRunId != null) {
      storage.bumpLedgerHeatForRun(sourceRunId, delta);
    }
    // Also bump via fleet run id in case ledger entries used fleet run id as source_run_id
    storage.bumpLedgerHeatForRun(body.run_id, delta);

    res.json({ ok: true, record, delta, source_run_id: sourceRunId });
  });

  // GET /api/feedback/outcomes — last 50 pr_outcome records
  app.get("/api/feedback/outcomes", (_req, res) => {
    res.json(storage.listPrOutcomes(50));
  });
}
