import type { Express } from "express";
import { storage } from "../storage";
import { buildDigestMarkdown } from "../digest";
import { dispatchConsolidationToCC } from "../explorer/consolidation";
import { dispatchOrganizerToCC, computeExplorerPauseDecision, type OrganizerScope } from "../explorer/backlog-organizer";
import { getHitlQueue, computeHitlBurden } from "../hitl";

export function registerOpsRoutes(app: Express) {
  // HITL (human-in-the-loop) review queue — DR/IPS lints, RAI softener,
  // brand-safety. Returns pending items so the HitlBurden page can render
  // the worklist.
  app.get("/api/hitl/queue", (_req, res) => {
    const items = getHitlQueue();
    res.json({ items, fetched_at: new Date().toISOString() });
  });

  // HITL burden aggregates — queue depth, avg review time, by-gate, by-reviewer,
  // hour-of-day x day-of-week heatmap, bottleneck, % auto-passed.
  app.get("/api/hitl/burden", (_req, res) => {
    res.json(computeHitlBurden());
  });

  // ── Consolidation cron (5th lane) ─────────────────────────────────────────
  // POST /api/consolidation/dispatch-now — manual on-demand dispatch
  app.post("/api/consolidation/dispatch-now", async (_req, res) => {
    try {
      const result = await dispatchConsolidationToCC();
      if (!result.ok) {
        return void res.status(500).json({ error: result.error });
      }
      return void res.json({ ok: true, cc_task_id: result.cc_task_id, executor: result.executor });
    } catch (err: any) {
      return void res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ── Backlog Organizer (6th lane) ─────────────────────────────────────────
  // POST /api/organizer/dispatch-now — manual on-demand dispatch
  app.post("/api/organizer/dispatch-now", async (req, res) => {
    try {
      const scope = (req.body?.scope as OrganizerScope) ?? { kind: "full_backlog" };
      const result = await dispatchOrganizerToCC(scope);
      if (!result.ok) {
        return void res.status(500).json({ error: result.error });
      }
      return void res.json({ ok: true, cc_task_id: result.cc_task_id, executor: result.executor });
    } catch (err: any) {
      return void res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // GET /api/organizer/state — current organizer config + last run + pause decision
  app.get("/api/organizer/state", (_req, res) => {
    try {
      const cfg = storage.getCronConfig() as any;
      const pauseDecision = computeExplorerPauseDecision();
      return void res.json({
        enabled: !!cfg.organizer_cron_enabled,
        interval_minutes: cfg.organizer_cron_interval_minutes ?? 30,
        last_run_at: cfg.organizer_last_run_at ?? null,
        last_stats: cfg.organizer_last_stats_json
          ? (() => { try { return JSON.parse(cfg.organizer_last_stats_json); } catch { return null; } })()
          : null,
        explorer_paused_reason: cfg.explorer_paused_reason ?? null,
        explorer_max_open_issues: cfg.explorer_max_open_issues ?? 1000,
        explorer_dynamic_pause_enabled: !!cfg.explorer_dynamic_pause_enabled,
        explorer_novelty_floor: cfg.explorer_novelty_floor ?? 2,
        pause_decision: pauseDecision,
      });
    } catch (err: any) {
      return void res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ── Digest endpoint (AH-10X-05) ──────────────────────────────────────────
  // POST /api/digest/post — build the overnight digest markdown and optionally
  // post it to the configured Slack webhook.
  app.post("/api/digest/post", async (_req, res) => {
    try {
      const markdown = await buildDigestMarkdown();
      const cfg = storage.getCronConfig() as any;
      const webhookUrl: string | null = cfg.slack_webhook_url ?? null;

      let posted = false;
      if (webhookUrl) {
        try {
          const slackResp = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: markdown }),
          });
          posted = slackResp.ok;
        } catch (postErr: any) {
          // Log but don't fail the endpoint — caller still gets markdown
          console.error("[digest] Slack post error:", postErr?.message ?? postErr);
        }
      }

      return void res.json({ markdown, posted });
    } catch (err: any) {
      return void res.status(500).json({ error: err?.message ?? String(err) });
    }
  });
}
