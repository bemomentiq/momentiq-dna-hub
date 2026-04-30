import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { dispatchWithCascade } from "./cascade-dispatch";

const DEFAULT_SURFACES = ["control-panel", "pipeline", "hub"];

export function buildTestDebugBriefing(opts: {
  run_id: number;
  surfaces: string[];
  hub_url: string;
}): string {
  const { run_id, surfaces, hub_url } = opts;
  return `## Goal
Run Test-Debug E2E probes (#${run_id}) against the momentiq-dna deployed surfaces: ${surfaces.join(", ")}.

## Context
This lane runs every 4 hours to catch regressions in the deployed DNA control panel, pipeline, and this hub itself.
Hub run record: GET ${hub_url}/api/test-debug/runs/${run_id}

## Implementation
For each surface:
1. Fetch the health endpoint (or home page if no /health) — assert HTTP 200.
2. Run 2–3 smoke checks (e.g. critical API endpoints return valid JSON, UI loads without JS errors).
3. If any check fails, file a GitHub issue in bemomentiq/momentiq-dna with label 'test-debug-finding'.

## Acceptance
- All surfaces probed
- Failures filed as GitHub issues with label 'test-debug-finding'
- PATCH ${hub_url}/api/test-debug/runs/${run_id} with {status:"completed", findings_count, filed_issue_numbers_json, summary}

## Out-of-scope
- Fixing the issues (Explorer/Executor lanes do that)
- Modifying any deployed code
`;
}

export function registerTestDebugRoutes(app: Express) {
  app.post("/api/test-debug/dispatch", async (req: Request, res: Response) => {
    const { surfaces = DEFAULT_SURFACES, trigger = "manual" } = req.body || {};
    const db = storage.getDb();

    const run = db
      .prepare(
        `INSERT INTO test_debug_runs (started_at, status, trigger, surfaces_json)
         VALUES (?, 'queued', ?, ?) RETURNING *`
      )
      .get(new Date().toISOString(), trigger, JSON.stringify(surfaces)) as any;

    const cfg = storage.getCronConfig() as any;
    const hubUrl = cfg.hub_url || process.env.HUB_URL || "https://momentiq-dna-hub.up.railway.app";

    const briefing = buildTestDebugBriefing({ run_id: run.id, surfaces, hub_url: hubUrl });

    try {
      await dispatchWithCascade({
        kind: "executor",
        runId: run.id,
        briefing,
        preferredProvider: (cfg.executor || "pin-claude") === "pin-claude" ? "claude" : "codex",
        hubStatusUrl: `${hubUrl}/api/test-debug/runs/${run.id}`,
        ccApiUrl: cfg.cc_api_url || process.env.CC_API_URL || "",
        ccApiKey: cfg.cc_api_key || process.env.CC_API_KEY || "",
      });
      db.prepare("UPDATE test_debug_runs SET status='running' WHERE id=?").run(run.id);
    } catch (err: any) {
      db.prepare("UPDATE test_debug_runs SET status='failed', error=? WHERE id=?").run(String(err), run.id);
    }

    return void res.json({ ok: true, run_id: run.id });
  });

  app.patch("/api/test-debug/runs/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, findings_count, filed_issue_numbers_json, summary, error } = req.body || {};
    const db = storage.getDb();
    db.prepare(
      `UPDATE test_debug_runs SET
        status=COALESCE(?, status),
        findings_count=COALESCE(?, findings_count),
        filed_issue_numbers_json=COALESCE(?, filed_issue_numbers_json),
        summary=COALESCE(?, summary),
        error=COALESCE(?, error),
        finished_at=CASE WHEN ? IN ('completed','failed') THEN ? ELSE finished_at END
       WHERE id=?`
    ).run(status ?? null, findings_count ?? null, filed_issue_numbers_json ?? null, summary ?? null, error ?? null, status ?? null, new Date().toISOString(), id);
    return void res.json({ ok: true });
  });

  app.get("/api/test-debug/runs", (_req: Request, res: Response) => {
    const db = storage.getDb();
    const runs = db.prepare("SELECT * FROM test_debug_runs ORDER BY id DESC LIMIT 50").all();
    return void res.json(runs);
  });

  app.get("/api/test-debug/runs/:id", (req: Request, res: Response) => {
    const db = storage.getDb();
    const run = db.prepare("SELECT * FROM test_debug_runs WHERE id=?").get(req.params.id);
    if (!run) return void res.status(404).json({ error: "not found" });
    return void res.json(run);
  });
}
