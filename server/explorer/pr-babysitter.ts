import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storage } from "../storage";

const WEBHOOK_SECRET = process.env.PR_BABYSITTER_WEBHOOK_SECRET || "";

function verifySignature(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return true; // dev mode: skip verification
  const expected = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function registerPrBabysitterRoutes(app: Express) {
  // HMAC-verified GitHub webhook
  app.post("/api/pr-babysitter/webhook", async (req: Request, res: Response) => {
    const sig = (req.headers["x-hub-signature-256"] as string) || "";
    const raw = JSON.stringify(req.body);
    if (sig && !verifySignature(raw, sig)) {
      return void res.status(401).json({ error: "Invalid webhook signature" });
    }

    const event = req.headers["x-github-event"] as string;
    const payload = req.body;

    // Only handle check_run / pull_request events relevant to CI
    if (!["check_run", "check_suite", "pull_request"].includes(event)) {
      return void res.json({ ok: true, skipped: true, reason: `event '${event}' not handled` });
    }

    const prNumber: number | undefined =
      payload.check_run?.pull_requests?.[0]?.number ||
      payload.check_suite?.pull_requests?.[0]?.number ||
      payload.pull_request?.number;
    const prUrl: string | undefined =
      payload.check_run?.pull_requests?.[0]?.html_url ||
      payload.pull_request?.html_url;
    const repo: string = payload.repository?.full_name || "bemomentiq/momentiq-dna";
    const ciStatus: string = payload.check_run?.conclusion || payload.check_suite?.conclusion || "pending";

    if (!prNumber) {
      return void res.json({ ok: true, skipped: true, reason: "no PR number in payload" });
    }

    // Only react to failures that need babysitting
    if (!["failure", "action_required", "timed_out"].includes(ciStatus)) {
      return void res.json({ ok: true, skipped: true, reason: `ci_status '${ciStatus}' does not need babysitting` });
    }

    const db = storage.getDb();
    const run = db
      .prepare(
        `INSERT INTO pr_babysitter_runs (started_at, status, trigger, repo, pr_number, pr_url, ci_status)
         VALUES (?, 'queued', 'webhook', ?, ?, ?, ?) RETURNING *`
      )
      .get(new Date().toISOString(), repo, prNumber, prUrl ?? null, ciStatus) as any;

    // TODO: dispatch actual babysitter agent via fleet dispatch
    // For now, record the queued run and return
    return void res.json({ ok: true, run_id: run.id, pr_number: prNumber, repo });
  });

  // Manual trigger endpoint
  app.post("/api/pr-babysitter/dispatch", async (req: Request, res: Response) => {
    const { repo = "bemomentiq/momentiq-dna", pr_number } = req.body || {};
    if (!pr_number) return void res.status(400).json({ error: "pr_number required" });

    const db = storage.getDb();
    const run = db
      .prepare(
        `INSERT INTO pr_babysitter_runs (started_at, status, trigger, repo, pr_number)
         VALUES (?, 'queued', 'manual', ?, ?) RETURNING *`
      )
      .get(new Date().toISOString(), repo, pr_number) as any;

    return void res.json({ ok: true, run_id: run.id });
  });

  // List recent runs
  app.get("/api/pr-babysitter/runs", (_req: Request, res: Response) => {
    const db = storage.getDb();
    const runs = db.prepare("SELECT * FROM pr_babysitter_runs ORDER BY id DESC LIMIT 50").all();
    return void res.json(runs);
  });
}
