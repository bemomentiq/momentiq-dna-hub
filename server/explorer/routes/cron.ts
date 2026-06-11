import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { ALLOWED_REPOS, isAllowedRepo } from "@shared/allowed-repos";

export function registerCronRoutes(app: Express) {
  // ============ Cron config ============
  app.get("/api/cron-config", (_req, res) => res.json(storage.getCronConfigSafe()));
  app.patch("/api/cron-config", (req, res) => {
    // DNA-9: planning-surface repos are locked to the allow-list. A non-allowed
    // repo must fail closed with a 400 (not the generic 500 ZodError path), so
    // we safeParse and surface field errors instead of letting .parse() throw.
    const repoField = z.string().refine(isAllowedRepo, {
      message: `repo must be one of: ${ALLOWED_REPOS.join(", ")}`,
    });
    const schema = z.object({
      enabled: z.boolean().optional(),
      interval_minutes: z.number().int().min(5).max(1440).optional(),
      model: z.string().optional(),
      max_ledger_entries: z.number().int().min(10).max(200).optional(),
      max_prior_summaries: z.number().int().min(1).max(30).optional(),
      cc_api_url: z.string().url().optional(),
      cc_api_key: z.string().optional(),
      default_cc_project_slug: z.string().optional(),
      auto_create_gh_issues: z.boolean().optional(),
      default_gh_repo: repoField.optional(),
      frontend_gh_repo: repoField.optional(),
      hub_gh_repo: repoField.optional(),
      batch_same_area: z.boolean().optional(),
      batch_min_siblings: z.number().int().min(2).max(20).optional(),
      github_token: z.string().optional().nullable(),
      airtable_api_key: z.string().optional().nullable(),
      monday_api_key: z.string().optional().nullable(),
      google_drive_oauth: z.string().optional().nullable(),
      focus_mission: z.string().optional().nullable(),
      auto_resume_explorer: z.boolean().optional(),
      auto_resume_executor: z.boolean().optional(),
      auto_resume_max_concurrent: z.number().int().min(1).max(8).optional(),
      auto_resume_min_gap_sec: z.number().int().min(10).max(600).optional(),
      mini5_fallback_enabled: z.boolean().optional(),
      // Per-kind caps + master loop toggle (AH-PHASE4-2)
      autonomous_indefinite_loop: z.boolean().optional(),
      auto_resume_explorer_max: z.number().int().min(1).max(10).optional(),
      auto_resume_executor_max: z.number().int().min(1).max(10).optional(),
      // Slack webhook URL for daily digest (AH-10X-05)
      slack_webhook_url: z.string().url().optional().nullable(),
      // Codebase audit agent (AH-10X-09)
      auto_resume_audit: z.boolean().optional(),
      auto_resume_audit_max: z.number().int().min(1).max(10).optional(),
      audit_interval_hours: z.number().int().min(1).max(168).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({
        error: "Invalid cron config",
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const updates = parsed.data;

    // If interval_minutes changed, recompute next_due_at
    const current = storage.getCronConfig();
    const finalUpdates: any = { ...updates };
    if (updates.interval_minutes && updates.interval_minutes !== current.interval_minutes) {
      const next = new Date(Date.now() + updates.interval_minutes * 60_000);
      finalUpdates.next_due_at = next.toISOString();
    }
    // GitHub PAT is handled separately so we capture last4 + saved-at metadata for UI display
    const ghToken = finalUpdates.github_token;
    delete finalUpdates.github_token;
    // Slack webhook URL is stored via setSlackWebhookUrl to keep safe-getter in sync
    const slackWebhook = finalUpdates.slack_webhook_url;
    delete finalUpdates.slack_webhook_url;
    storage.updateCronConfig(finalUpdates);
    if (typeof ghToken === "string" && ghToken.trim().length > 0) {
      storage.setGithubToken(ghToken);
    }
    if (slackWebhook !== undefined) {
      storage.setSlackWebhookUrl(slackWebhook);
    }
    res.json(storage.getCronConfigSafe());
  });
}
