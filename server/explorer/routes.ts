import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { buildExplorerPrompt, buildDispatchPayload } from "./prompt";
import type { DraftTask } from "@shared/schema";
import { createSoloIssueForTask, createIssueForTask, createBatchedFleetTracker, groupDrafts, composeMergedTask, inferArea, pickRepoForTask } from "./github-sync";
import { dispatchWithCascade } from "./cascade-dispatch";

// Build a Fleet-style agentBriefing for the Explorer run.
// Wraps the Opus prompt as an 8-H2 compliant task that a Codex or Claude lane
// can execute directly against the SID repo clone.
function buildFleetBriefing(run_id: number, ingestUrl: string, corePrompt: string): string {
  return `## Goal
Run Autonomy Hub Explorer cycle #${run_id} — investigate SID codebase + recent activity, surface findings + draft tasks, PUT results back to the Autonomy Hub.

## Context
The Autonomy Hub (https://momentiq-dna-hub.pplx.app) tracks SID's 40 canonical autonomy actions and their production-readiness. It needs an autonomous codebase explorer to continuously surface gaps, distill learning patterns, and draft optimally-batched follow-up tasks in CC's 8-H2 schema. This task IS that cycle.

Run_id: ${run_id} (unique identifier; the platform expects you to PUT results to a URL containing this id).

## Files
You are running inside the bemomentiq/momentiq-dna repo clone. Read-only exploration of:
- domains/autonomy/cos/quality/ (scorers, runner, dimensions)
- domains/autonomy/cos/pr-pipeline/ (auto_revert_rule path)
- domains/autonomy/campaign-workflows/ (sampling + pa-pipeline + reactivation)
- domains/platform/automations/action-handlers/ (40 handlers)
- migrations/ (last 10 files to spot recent schema changes)
- Any file changed in the last 48h (git log --since="48 hours ago")

DO NOT edit any files. This is a READ-ONLY exploration task.

## Implementation
1. Run: \`git log --oneline --since="48 hours ago" | head -30\` to see what recently shipped
2. Run: \`gh pr list --state merged --limit 20 --search "merged:>$(date -d '48 hours ago' -I)"\` for merged PRs
3. Run: \`gh issue list --state open --limit 30 --label "autonomy"\` for open blockers
4. Read the full explorer prompt embedded below under EXPLORER_PROMPT — it contains prior-run summaries, the heat-sorted learning ledger, the 40-action snapshot, and output-schema instructions. Follow its instructions precisely.
5. Compose STRICT JSON (no surrounding prose) matching the schema documented in EXPLORER_PROMPT.
6. PUT your JSON to ${ingestUrl} with header \`Content-Type: application/json\`. Expected 200 response \`{"ok":true,"counts":{...}}\`. On 400, fix the JSON shape and retry once.
7. When ingest succeeds, PATCH this CC task to status="completed" and include the autonomy-hub run_id in the PR body (no actual code PR needed for this task — it’s exploration).

## Acceptance
- Ingest endpoint returns HTTP 200 on PUT
- Autonomy Hub /api/explorer/runs/${run_id} shows status="completed" with findings_count ≥ 2
- JSON payload produced 0-3 ledger_patterns and 2-6 draft_tasks
- No code modifications made to the SID repo

## Out-of-scope
- Implementing any of the draft tasks (they go into Autonomy Hub backlog for user review)
- Modifying cos_action_registry, scorers, or handlers
- Creating SID PRs (this is exploration, not coding)

## Commit + PR
No PR needed. This task completes when the PUT succeeds. Mark task status="completed" via PATCH /api/tasks/:id when done.

## Notes
- Keep the investigation bounded: ~10 min wall-clock, ~20 LLM calls max
- De-dupe findings against the ledger + prior summaries embedded in EXPLORER_PROMPT
- Every finding needs ≥1 piece of evidence (PR #, file:line, SQL count)
- Every draft task needs an 8-H2 agentBriefing with live-data citation
- If ingest fails with 5xx, PATCH /api/tasks/:id with status="manual_review_required" instead of retrying

---

## EXPLORER_PROMPT

${corePrompt}
`;
}

const ingestSchema = z.object({
  summary: z.string().max(2000),
  next_gameplan: z.string().max(1500),
  next_pickup: z.string().max(500).optional().nullable(),
  findings: z.array(z.object({
    severity: z.enum(["low", "medium", "high", "critical"]),
    category: z.enum(["gap_to_prod", "training_data", "eval", "drift", "optimization", "architecture", "risk"]),
    title: z.string().max(200),
    body: z.string().max(2000),
    action_name: z.string().optional().nullable(),
    phase_id: z.string().optional().nullable(),
    evidence: z.array(z.string()).optional().default([]),
  })).max(20),
  ledger_patterns: z.array(z.object({
    pattern: z.string().max(200),
    context: z.string().max(800),
  })).max(10).default([]),
  draft_tasks: z.array(z.object({
    title: z.string().max(140),
    description: z.string().max(2000),
    project_slug: z.string(),
    repo_url: z.string().url(),
    priority: z.enum(["p0", "p1", "p2", "p3"]),
    task_type: z.string().optional().default("dev_task"),
    automatable: z.boolean().optional().default(true),
    relevant_skills: z.array(z.string()).optional().default([]),
    effort_estimate: z.string().max(60),
    executor: z.string().optional().default("unassigned"),
    agent_briefing: z.string().max(15000),
    batch_id: z.string().optional().nullable(),
  })).max(15).default([]),
  tokens_total: z.number().optional().default(0),
});

export function registerExplorerRoutes(app: Express) {
  // ============ Cron config ============
  app.get("/api/cron-config", (_req, res) => res.json(storage.getCronConfigSafe()));
  app.patch("/api/cron-config", (req, res) => {
    const updates = z.object({
      enabled: z.boolean().optional(),
      interval_minutes: z.number().int().min(5).max(1440).optional(),
      model: z.string().optional(),
      max_ledger_entries: z.number().int().min(10).max(200).optional(),
      max_prior_summaries: z.number().int().min(1).max(30).optional(),
      cc_api_url: z.string().url().optional(),
      cc_api_key: z.string().optional(),
      default_cc_project_slug: z.string().optional(),
      auto_create_gh_issues: z.boolean().optional(),
      default_gh_repo: z.string().optional(),
      frontend_gh_repo: z.string().optional(),
      hub_gh_repo: z.string().optional(),
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
    }).parse(req.body);

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

  // ============ Runs ============
  // Manually create a run (returns the prompt + dispatch payload to feed run_subagent)
  app.post("/api/explorer/runs", async (req, res) => {
    const trigger = (req.body?.trigger as string) || "manual";
    const cfg = storage.getCronConfig();
    const run = storage.createRun({
      started_at: new Date().toISOString(),
      status: "queued",
      trigger,
      model: cfg.model,
    });
    res.json({
      run,
      dispatch: await buildDispatchPayload(run.id),
    });
  });

  // Re-dispatch a failed or cancelled explorer run with the same briefing.
  // Creates a new explorer_runs row linked to the original via parent_run_id.
  app.post("/api/explorer/runs/:id/replay", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return void res.status(400).json({ error: "invalid id" });
    const original = storage.getRun(id);
    if (!original) return void res.status(404).json({ error: "not found" });
    if (original.status !== "failed" && original.status !== "cancelled") {
      return void res.status(409).json({ error: `cannot replay a run with status '${original.status}' — only failed or cancelled runs can be replayed` });
    }
    const cfg = storage.getCronConfig();
    const newRun = storage.createRun({
      started_at: new Date().toISOString(),
      status: "queued",
      trigger: "replay",
      model: original.model || cfg.model,
      parent_run_id: original.id,
    } as any);
    res.json({ ok: true, run: newRun, dispatch: buildDispatchPayload(newRun.id), parent_run_id: original.id });
  });

  // Mark run as running (or report progress). Accepts status, error, and next_pickup.
  // next_pickup is the fluid-chain handoff written at the end of each run so the NEXT
  // Explorer run can continue where this one left off without re-planning from scratch.
  app.patch("/api/explorer/runs/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const updates = z.object({
      status: z.enum(["queued", "running", "completed", "failed"]).optional(),
      error: z.string().optional().nullable(),
      next_pickup: z.string().max(500).optional().nullable(),
    }).parse(req.body);
    const updated = storage.updateRun(id, updates as any);
    if (!updated) return void res.status(404).json({ error: "not found" });
    res.json(updated);
  });

  // List runs
  app.get("/api/explorer/runs", (_req, res) => res.json(storage.listRuns(50)));
  app.get("/api/explorer/runs/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const run = storage.getRun(id);
    if (!run) return void res.status(404).json({ error: "not found" });
    const findings = storage.listFindings({ run_id: id });
    const drafts = storage.listDraftTasks({ limit: 50 }).filter((t) => t.run_id === id);
    res.json({ run, findings, draft_tasks: drafts });
  });

  // The big one: ingest a completed run's structured output
  app.put("/api/explorer/runs/:id/ingest", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const run = storage.getRun(id);
    if (!run) return void res.status(404).json({ error: "run not found" });

    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      return void res.status(400).json({ error: "validation failed", issues: parsed.error.issues.slice(0, 5) });
    }
    const data = parsed.data;
    const now = new Date().toISOString();
    const cfg = storage.getCronConfig();

    // Persist findings
    let findingsCount = 0;
    for (const f of data.findings) {
      storage.createFinding({
        run_id: id, created_at: now, severity: f.severity, category: f.category,
        title: f.title, body: f.body,
        action_name: f.action_name ?? null, phase_id: f.phase_id ?? null,
        evidence_json: JSON.stringify(f.evidence ?? []),
        status: "open",
      });
      findingsCount++;
    }

    // Persist ledger (upsert with heat dedup)
    let ledgerCount = 0;
    for (const p of data.ledger_patterns) {
      storage.upsertLedger(p.pattern, p.context, id);
      ledgerCount++;
    }
    storage.decayAndPrune(cfg.max_ledger_entries);

    // Persist draft tasks
    const batchId = data.draft_tasks[0]?.batch_id ?? `ah-explore-${now.slice(0, 10)}-r${id}`;
    let draftsCount = 0;
    const createdDrafts: DraftTask[] = [];
    for (const t of data.draft_tasks) {
      const area = inferArea({
        title: t.title, description: t.description, agent_briefing: t.agent_briefing,
        relevant_skills_json: JSON.stringify(t.relevant_skills ?? []),
        area: null,
      } as any);
      const created = storage.createDraftTask({
        run_id: id,
        created_at: now,
        status: "proposed",
        title: t.title, description: t.description, project_slug: t.project_slug,
        repo_url: t.repo_url, priority: t.priority, task_type: t.task_type,
        automatable: t.automatable, executor: t.executor,
        relevant_skills_json: JSON.stringify(t.relevant_skills ?? []),
        effort_estimate: t.effort_estimate,
        agent_briefing: t.agent_briefing,
        batch_id: t.batch_id ?? batchId,
        area,
      });
      createdDrafts.push(created);
      draftsCount++;
    }

    // ============ Batch optimizer ============
    // When cfg.batch_same_area is enabled AND a group has >=cfg.batch_min_siblings,
    // we create a merged master task and mark the siblings merged_into_id=master.id.
    let mergedGroups = 0;
    if (cfg.batch_same_area && createdDrafts.length >= cfg.batch_min_siblings) {
      const groups = groupDrafts(createdDrafts, { default_gh_repo: cfg.default_gh_repo, frontend_gh_repo: cfg.frontend_gh_repo });
      for (const g of groups) {
        if (g.tasks.length < cfg.batch_min_siblings) continue;
        const merged = composeMergedTask(g, id);
        const master = storage.createDraftTask({
          run_id: id, created_at: now, status: "proposed",
          title: merged.title, description: merged.description,
          project_slug: merged.project_slug, repo_url: merged.repo_url,
          priority: merged.priority, task_type: "dev_task", automatable: true, executor: "unassigned",
          relevant_skills_json: merged.relevant_skills_json, effort_estimate: merged.effort_estimate,
          agent_briefing: merged.agent_briefing, batch_id: merged.batch_id, area: merged.area,
        });
        // Mark siblings as superseded by this master
        for (const t of g.tasks) {
          storage.updateDraftTask(t.id, { merged_into_id: master.id, status: "superseded" as any });
        }
        mergedGroups++;
      }
    }

    // ============ Auto-create GH issues ============
    // If cfg.auto_create_gh_issues is true:
    //   - For each group with >= batch_min_siblings (already merged into a master in step above):
    //     create FLEET-style master tracker + N children on GitHub
    //   - For each remaining solo draft: create standalone issue
    let ghIssuesCreated = 0;
    if (cfg.auto_create_gh_issues) {
      const activeThisRun = storage.listDraftTasks({ limit: 100 }).filter((t) => t.run_id === id && !t.gh_issue_number);
      // Masters (not superseded, created by optimizer above) get the FLEET tracker treatment
      const masters = activeThisRun.filter((t) => t.status === "proposed" && (t.batch_id?.startsWith("ah-master-") ?? false));
      for (const master of masters) {
        const children = storage.listDraftTasks({ limit: 100 }).filter((x) => x.merged_into_id === master.id);
        const fakeGroup = { key: "x", repo: pickRepoForTask(master, { default_gh_repo: cfg.default_gh_repo, frontend_gh_repo: cfg.frontend_gh_repo }), area: master.area ?? "general", priority: master.priority, tasks: children };
        if (fakeGroup.tasks.length === 0) continue;
        const r = await createBatchedFleetTracker(fakeGroup, { source_url: `https://momentiq-dna-hub.pplx.app/#/backlog`, run_id: id });
        if (r.master.ok) {
          storage.updateDraftTask(master.id, {
            gh_issue_number: r.master.number ?? null,
            gh_repo: fakeGroup.repo,
            gh_issue_url: r.master.url ?? null,
            gh_synced_at: new Date().toISOString(),
          });
          ghIssuesCreated += 1 + r.children.filter((c) => c.result.ok).length;
        }
      }
      // Solos: drafts that weren't merged into a master
      const solos = activeThisRun.filter((t) => t.status !== "superseded" && !t.gh_issue_number && !(t.batch_id?.startsWith("ah-master-") ?? false));
      for (const t of solos) {
        const r = await createSoloIssueForTask(t, { source_url: `https://momentiq-dna-hub.pplx.app/#/backlog`, run_id: id });
        if (r.ok) ghIssuesCreated++;
      }
    }

    // Mark run complete
    storage.updateRun(id, {
      status: "completed",
      finished_at: now,
      summary: data.summary,
      next_gameplan: data.next_gameplan,
      next_pickup: data.next_pickup ?? null,
      findings_count: findingsCount,
      ledger_entries_count: ledgerCount,
      draft_tasks_count: draftsCount,
      tokens_total: data.tokens_total ?? 0,
      duration_ms: new Date(now).getTime() - new Date(run.started_at).getTime(),
    } as any);

    // Update cron config last_run_at + next_due_at
    const next = new Date(Date.now() + cfg.interval_minutes * 60_000);
    storage.updateCronConfig({ last_run_at: now, next_due_at: next.toISOString() });

    res.json({ ok: true, counts: { findings: findingsCount, ledger: ledgerCount, draft_tasks: draftsCount, merged_groups: mergedGroups, gh_issues_created: ghIssuesCreated } });
  });

  // ============ Findings ============
  app.get("/api/findings", (req, res) => {
    const status = (req.query.status as string) || undefined;
    const action_name = (req.query.action_name as string) || undefined;
    res.json(storage.listFindings({ status, action_name, limit: 200 }));
  });
  app.patch("/api/findings/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const updates = z.object({ status: z.enum(["open", "accepted", "dismissed", "superseded"]).optional() }).parse(req.body);
    const u = storage.updateFinding(id, updates);
    if (!u) return void res.status(404).json({ error: "not found" });
    res.json(u);
  });

  // ============ Ledger ============
  app.get("/api/ledger", (_req, res) => res.json(storage.listLedger(50)));

  // ============ Draft tasks + ship to CC ============
  app.get("/api/draft-tasks", (req, res) => {
    const status = (req.query.status as string) || undefined;
    res.json(storage.listDraftTasks({ status, limit: 200 }));
  });
  app.patch("/api/draft-tasks/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const updates = z.object({
      status: z.enum(["proposed", "accepted", "dismissed", "shipped", "superseded"]).optional(),
      gh_issue_number: z.number().int().optional().nullable(),
      gh_issue_url: z.string().url().optional().nullable(),
      gh_repo: z.string().optional().nullable(),
      gh_synced_at: z.string().optional().nullable(),
      merged_into_id: z.number().int().optional().nullable(),
      area: z.string().optional().nullable(),
    }).parse(req.body);
    const u = storage.updateDraftTask(id, updates as any);
    if (!u) return void res.status(404).json({ error: "not found" });
    res.json(u);
  });

  // Ship a draft task (or batch) to CC's POST /api/tasks/bulk
  app.post("/api/draft-tasks/ship", async (req, res) => {
    const body = z.object({ ids: z.array(z.number().int()).min(1).max(20) }).parse(req.body);
    const cfg = storage.getCronConfig();
    const drafts = body.ids.map((id) => storage.getDraftTask(id)).filter(Boolean) as DraftTask[];
    if (drafts.length === 0) return void res.status(404).json({ error: "no drafts found" });

    const ccPayload = drafts.map((d) => ({
      title: d.title,
      description: d.description,
      projectSlug: d.project_slug,
      repoUrl: d.repo_url,
      priority: d.priority,
      taskType: d.task_type,
      automatable: !!d.automatable,
      relevantSkills: JSON.parse(d.relevant_skills_json || "[]"),
      effortEstimate: d.effort_estimate,
      executor: d.executor,
      status: "planned",
      agentBriefing: d.agent_briefing,
    }));

    try {
      const r = await fetch(`${cfg.cc_api_url}/api/tasks/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": cfg.cc_api_key },
        body: JSON.stringify(ccPayload),
      });
      const text = await r.text();
      if (!r.ok) {
        return void res.status(502).json({ error: "CC API rejected", status: r.status, body: text });
      }
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch {}
      const ccTasks: any[] = Array.isArray(parsed) ? parsed : (parsed?.tasks ?? parsed?.created ?? []);
      const now = new Date().toISOString();
      drafts.forEach((d, i) => {
        const cc = ccTasks[i];
        storage.updateDraftTask(d.id, {
          status: "shipped",
          shipped_at: now,
          cc_task_id: cc?.id ?? cc?.taskId ?? null,
        });
      });
      res.json({ ok: true, shipped: drafts.length, cc_response: parsed });
    } catch (err: any) {
      res.status(500).json({ error: "fetch failed", message: err?.message });
    }
  });

  // Dispatch a run to the Fleet via Command Center — IMMEDIATE execution
  // (vs the hourly cron). Creates an Autonomy Hub run, then POSTs a 8-H2
  // task to CC /api/tasks/bulk so a healthy lane picks it up within ~90s.
  //
  // Lane / model mapping:
  //   executor: 'pin-codex'  → codex Mini lane → gpt_5_5
  //   executor: 'pin-claude' → claude Mini lane → claude_opus_4_7 (thinking)
  //   executor: 'unassigned' → CC routes to either based on health
  //
  // Optional fallback: if `fallback_executor` is provided, the response includes
  // a fallback_task spec the caller can dispatch later if the primary stalls.
  // The /api/explorer/dispatch-fleet/fallback endpoint actually performs that
  // fallback dispatch when invoked.
  app.post("/api/explorer/dispatch-fleet", async (req, res) => {
    const cfg = storage.getCronConfig();
    const trigger = (req.body?.trigger as string) || "manual_fleet";
    const repoUrl = (req.body?.repo_url as string) || "https://github.com/bemomentiq/momentiq-dna";
    const projectSlug = (req.body?.project_slug as string) || "momentiq-dna";
    const executor = (req.body?.executor as string) || "pin-codex"; // default to gpt_5_5 lane
    const fallbackExecutor = (req.body?.fallback_executor as string) || "pin-claude";
    const priority = (req.body?.priority as string) || "p1";

    // 1. Create the run row
    const run = storage.createRun({
      started_at: new Date().toISOString(),
      status: "queued",
      trigger,
      model: executor === "pin-codex" ? "gpt_5_5" : executor === "pin-claude" ? "claude_opus_4_7" : cfg.model,
    });

    // 2. Build the prompt + the fleet-shaped briefing
    const prodHost = process.env.NODE_ENV === "production" ? "https://momentiq-dna-hub.pplx.app/port/5000" : "http://localhost:5000";
    const ingestUrl = `${prodHost}/api/explorer/runs/${run.id}/ingest`;
    const corePrompt = await buildExplorerPrompt(run.id);
    const fleetBriefing = buildFleetBriefing(run.id, ingestUrl, corePrompt);

    const ccTask = {
      title: `[AH-EXPLORER-R${run.id}] Run Autonomy Hub Explorer cycle (read-only investigation)`,
      description: `Autonomous codebase exploration cycle for the Autonomy Hub. Read-only investigation of SID's 40 autonomy actions; surfaces findings + drafts back to Autonomy Hub run #${run.id} via PUT to ${ingestUrl}. Triggered ${trigger} at ${new Date().toISOString()}.`,
      projectSlug,
      repoUrl,
      priority,
      taskType: "investigation",
      automatable: true,
      relevantSkills: ["sid-autonomy-actions-catalog", "momentiq-sid-completion-tracker", "codex-fleet"],
      effortEstimate: "30 min",
      executor,
      status: "planned",
      agentBriefing: fleetBriefing,
    };

    // 3. Dispatch via 4-way cascade (mini-4 primary, mini-5 fallback).
    // Cron-triggered explorer runs go through direct SSH, not CC queue.
    const preferredProvider = executor === "pin-claude" ? "claude" as const : "codex" as const;
    const dispatch = await dispatchWithCascade({
      kind: "explorer",
      runId: run.id,
      briefing: fleetBriefing,
      preferredProvider,
      preferredMini: "mini-4",
      hubStatusUrl: `${prodHost}/api/explorer/runs/${run.id}/ingest`,
      ccApiUrl: cfg.cc_api_url,
      ccApiKey: cfg.cc_api_key,
    });

    if (!dispatch.ok) {
      storage.updateRun(run.id, { status: "failed", error: `cascade dispatch failed: ${dispatch.error}`, finished_at: new Date().toISOString() });
      return void res.status(502).json({ error: "cascade dispatch failed", detail: dispatch.error, attempts: dispatch.attempts });
    }

    // 4. Promote run to "running" with direct_marker for reaper + cascade_stats
    storage.updateRun(run.id, {
      status: "running",
      error: dispatch.directMarker ? `direct:${dispatch.directMarker}` : null,
    });
    res.json({
      ok: true,
      run,
      pid: dispatch.pid,
      final_target: dispatch.finalTarget,
      cascade_index: dispatch.cascadeIndex,
      model_pin: dispatch.model ?? "gpt_5_5",
      ingest_url: ingestUrl,
      executor,
      attempts: dispatch.attempts,
      direct_marker: dispatch.directMarker,
      fallback_url: `${prodHost}/api/explorer/dispatch-fleet/fallback?run_id=${run.id}`,
    });
  });

  // Fallback dispatch: re-dispatches the SAME explorer run to the fallback lane
  // (claude_opus_4_7 thinking) if the primary (gpt_5_5) hasn't completed within
  // the caller's grace window. Idempotent on run state — returns 409 if the
  // run is already completed.
  app.post("/api/explorer/dispatch-fleet/fallback", async (req, res) => {
    const runId = parseInt((req.query.run_id as string) || (req.body?.run_id as string) || "0", 10);
    if (!runId) return void res.status(400).json({ error: "run_id required" });
    const run = storage.getRun(runId);
    if (!run) return void res.status(404).json({ error: "run not found" });
    if (run.status === "completed") {
      return void res.status(409).json({ error: "run already completed", run });
    }

    const cfg = storage.getCronConfig();
    const fallbackExecutor = (req.body?.executor as string) || "pin-claude";
    const projectSlug = (req.body?.project_slug as string) || "momentiq-dna";
    const repoUrl = (req.body?.repo_url as string) || "https://github.com/bemomentiq/momentiq-dna";
    const priority = (req.body?.priority as string) || "p0"; // bump priority on fallback

    const prodHost = process.env.NODE_ENV === "production" ? "https://momentiq-dna-hub.pplx.app/port/5000" : "http://localhost:5000";
    const ingestUrl = `${prodHost}/api/explorer/runs/${run.id}/ingest`;
    const corePrompt = await buildExplorerPrompt(run.id);
    const fleetBriefing = buildFleetBriefing(run.id, ingestUrl, corePrompt);

    const ccTask = {
      title: `[AH-EXPLORER-R${run.id}-FB] Fallback: Autonomy Hub Explorer cycle on ${fallbackExecutor}`,
      description: `FALLBACK dispatch for explorer run #${run.id}. Primary lane stalled or failed; this re-dispatches to ${fallbackExecutor} (claude_opus_4_7 thinking) with bumped priority. Same ingest URL.`,
      projectSlug,
      repoUrl,
      priority,
      taskType: "investigation",
      automatable: true,
      relevantSkills: ["sid-autonomy-actions-catalog", "momentiq-sid-completion-tracker", "codex-fleet"],
      effortEstimate: "30 min",
      executor: fallbackExecutor,
      status: "planned",
      agentBriefing: `## Goal\nFALLBACK dispatch for Autonomy Hub Explorer run #${run.id} — the primary lane (gpt_5_5) did not complete in time. Use Claude Opus 4.7 with extended thinking to investigate + ingest results.\n\n${fleetBriefing}`,
    };

    try {
      const r = await fetch(`${cfg.cc_api_url}/api/tasks/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": cfg.cc_api_key },
        body: JSON.stringify([ccTask]),
      });
      const text = await r.text();
      if (!r.ok) {
        return void res.status(502).json({ error: "CC fallback dispatch failed", status: r.status, body: text });
      }
      const parsed: any = (() => { try { return JSON.parse(text); } catch { return null; } })();
      const ccTasks: any[] = Array.isArray(parsed) ? parsed : (parsed?.tasks ?? parsed?.created ?? []);
      const ccTaskId = ccTasks[0]?.id ?? ccTasks[0]?.taskId ?? null;
      storage.updateRun(run.id, { error: `cc_task_fb:${ccTaskId ?? "?"} (was ${run.error ?? "-"})` });
      res.json({ ok: true, run_id: run.id, fallback_cc_task_id: ccTaskId, executor: fallbackExecutor, model_pin: "claude_opus_4_7 (thinking)" });
    } catch (err: any) {
      res.status(500).json({ error: "fetch failed", message: err?.message });
    }
  });

  // ============ GitHub issue sync ============
  // Sync one or more drafts to GitHub issues. If `merge: true`, run the batch optimizer
  // first; if false, sync each draft to its own issue.
  app.post("/api/draft-tasks/sync-github", async (req, res) => {
    const body = z.object({
      ids: z.array(z.number().int()).min(1).max(50),
      merge: z.boolean().optional().default(false),
    }).parse(req.body);
    const cfg = storage.getCronConfig();
    const drafts = body.ids.map((id) => storage.getDraftTask(id)).filter(Boolean) as DraftTask[];
    if (drafts.length === 0) return void res.status(404).json({ error: "no drafts" });

    const results: { draft_id: number; ok: boolean; gh?: { number?: number; url?: string }; error?: string }[] = [];

    if (body.merge && drafts.length >= cfg.batch_min_siblings) {
      // FLEET tracker pattern: 1 master + N children per group
      const groups = groupDrafts(drafts, { default_gh_repo: cfg.default_gh_repo, frontend_gh_repo: cfg.frontend_gh_repo });
      const now = new Date().toISOString();
      for (const g of groups) {
        if (g.tasks.length < cfg.batch_min_siblings) {
          for (const t of g.tasks) {
            const r = await createSoloIssueForTask(t, { source_url: "https://momentiq-dna-hub.pplx.app/#/backlog", run_id: drafts[0].run_id });
            results.push({ draft_id: t.id, ok: r.ok, gh: r.ok ? { number: r.number, url: r.url } : undefined, error: r.error });
          }
          continue;
        }
        // Local-DB master record (for the Backlog UI to render the merged-row)
        const merged = composeMergedTask(g, drafts[0].run_id);
        const master = storage.createDraftTask({
          run_id: drafts[0].run_id, created_at: now, status: "proposed",
          title: merged.title, description: merged.description,
          project_slug: merged.project_slug, repo_url: merged.repo_url,
          priority: merged.priority, task_type: "dev_task", automatable: true, executor: "unassigned",
          relevant_skills_json: merged.relevant_skills_json, effort_estimate: merged.effort_estimate,
          agent_briefing: merged.agent_briefing, batch_id: merged.batch_id, area: merged.area,
        });
        for (const t of g.tasks) {
          storage.updateDraftTask(t.id, { merged_into_id: master.id, status: "superseded" as any });
        }
        // GitHub: master tracker + N children
        const fleet = await createBatchedFleetTracker(g, { source_url: "https://momentiq-dna-hub.pplx.app/#/backlog", run_id: drafts[0].run_id });
        if (fleet.master.ok) {
          storage.updateDraftTask(master.id, {
            gh_issue_number: fleet.master.number ?? null,
            gh_repo: g.repo,
            gh_issue_url: fleet.master.url ?? null,
            gh_synced_at: new Date().toISOString(),
          });
        }
        results.push({ draft_id: master.id, ok: fleet.master.ok, gh: fleet.master.ok ? { number: fleet.master.number, url: fleet.master.url } : undefined, error: fleet.master.error });
        for (const c of fleet.children) {
          results.push({ draft_id: c.draft_id, ok: c.result.ok, gh: c.result.ok ? { number: c.result.number, url: c.result.url } : undefined, error: c.result.error });
        }
      }
    } else {
      // No merge — one issue per draft
      for (const d of drafts) {
        if (d.gh_issue_number) {
          results.push({ draft_id: d.id, ok: true, gh: { number: d.gh_issue_number, url: d.gh_issue_url ?? undefined }, error: "already_synced" });
          continue;
        }
        const r = await createSoloIssueForTask(d, { source_url: "https://momentiq-dna-hub.pplx.app/#/backlog", run_id: d.run_id });
        results.push({ draft_id: d.id, ok: r.ok, gh: r.ok ? { number: r.number, url: r.url } : undefined, error: r.error });
      }
    }
    res.json({ ok: true, results });
  });

  // Backfill: sync ALL existing un-synced, non-superseded, non-dismissed drafts.
  // Useful for one-shot migration.
  app.post("/api/draft-tasks/sync-github-all", async (req, res) => {
    const body = z.object({ merge: z.boolean().optional().default(true) }).parse(req.body);
    const all = storage.listDraftTasks({ limit: 200 }).filter((t) => !t.gh_issue_number && t.status !== "superseded" && t.status !== "dismissed");
    if (all.length === 0) return void res.json({ ok: true, results: [], message: "nothing to sync" });
    // Reuse the per-batch endpoint logic via direct call shape
    const cfg = storage.getCronConfig();
    const results: any[] = [];
    if (body.merge && all.length >= cfg.batch_min_siblings) {
      const groups = groupDrafts(all, { default_gh_repo: cfg.default_gh_repo, frontend_gh_repo: cfg.frontend_gh_repo });
      const now = new Date().toISOString();
      for (const g of groups) {
        if (g.tasks.length < cfg.batch_min_siblings) {
          for (const t of g.tasks) {
            const r = await createSoloIssueForTask(t, { source_url: "https://momentiq-dna-hub.pplx.app/#/backlog", run_id: t.run_id });
            results.push({ draft_id: t.id, ok: r.ok, gh: r.ok ? { number: r.number, url: r.url } : undefined, error: r.error });
          }
          continue;
        }
        const merged = composeMergedTask(g, g.tasks[0].run_id);
        const master = storage.createDraftTask({
          run_id: g.tasks[0].run_id, created_at: now, status: "proposed",
          title: merged.title, description: merged.description,
          project_slug: merged.project_slug, repo_url: merged.repo_url,
          priority: merged.priority, task_type: "dev_task", automatable: true, executor: "unassigned",
          relevant_skills_json: merged.relevant_skills_json, effort_estimate: merged.effort_estimate,
          agent_briefing: merged.agent_briefing, batch_id: merged.batch_id, area: merged.area,
        });
        for (const t of g.tasks) {
          storage.updateDraftTask(t.id, { merged_into_id: master.id, status: "superseded" as any });
        }
        const fleet = await createBatchedFleetTracker(g, { source_url: "https://momentiq-dna-hub.pplx.app/#/backlog", run_id: g.tasks[0].run_id });
        if (fleet.master.ok) {
          storage.updateDraftTask(master.id, {
            gh_issue_number: fleet.master.number ?? null,
            gh_repo: g.repo,
            gh_issue_url: fleet.master.url ?? null,
            gh_synced_at: new Date().toISOString(),
          });
        }
        results.push({ draft_id: master.id, ok: fleet.master.ok, gh: fleet.master.ok ? { number: fleet.master.number, url: fleet.master.url } : undefined, error: fleet.master.error, merged_count: g.tasks.length });
        for (const c of fleet.children) results.push({ draft_id: c.draft_id, ok: c.result.ok, gh: c.result.ok ? { number: c.result.number, url: c.result.url } : undefined, error: c.result.error });
      }
    } else {
      for (const d of all) {
        const r = await createSoloIssueForTask(d, { source_url: "https://momentiq-dna-hub.pplx.app/#/backlog", run_id: d.run_id });
        results.push({ draft_id: d.id, ok: r.ok, gh: r.ok ? { number: r.number, url: r.url } : undefined, error: r.error });
      }
    }
    res.json({ ok: true, count: results.length, results });
  });

  // ============ Reconcile from GitHub ============
  // Pulls issues with the `autonomy-hub` label from both configured repos and
  // upserts any that are missing from local draft_tasks. This lets the cron
  // task file issues directly via gh CLI (bypassing this server) and still
  // have them appear on the Backlog UI on next load.
  app.post("/api/draft-tasks/reconcile-from-github", async (req, res) => {
    const cfg = storage.getCronConfig() as any;
    const token = cfg.github_token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GH_ENTERPRISE_TOKEN;
    if (!token || String(token).length < 10) {
      return void res.status(400).json({ error: "GitHub token not configured. Set Explorer Settings → GitHub PAT." });
    }
    const repos = [cfg.default_gh_repo, cfg.frontend_gh_repo, cfg.hub_gh_repo].filter(Boolean);
    const seen = new Set<string>();
    let added = 0;
    let updated = 0;
    const errors: string[] = [];

    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };

    for (const repo of repos) {
      try {
        // Pull last 100 autonomy-hub issues, both states, sorted by updated desc
        const r = await fetch(`https://api.github.com/repos/${repo}/issues?state=all&labels=autonomy-hub&per_page=100&sort=updated&direction=desc`, { headers });
        if (!r.ok) {
          errors.push(`${repo} ${r.status}`);
          continue;
        }
        const issues = (await r.json()) as any[];
        for (const iss of issues) {
          if (iss.pull_request) continue; // GH API merges PRs in; skip
          const key = `${repo}#${iss.number}`;
          if (seen.has(key)) continue;
          seen.add(key);

          // Try to find an existing draft by gh_issue_number+repo
          const existing = storage.listDraftTasks({ limit: 500 }).find(
            (t) => t.gh_issue_number === iss.number && t.gh_repo === repo,
          );

          // Map issue → draft fields
          const labelNames: string[] = (iss.labels || []).map((l: any) => (typeof l === "string" ? l : l.name)).filter(Boolean);
          const priorityLabel = labelNames.find((n) => n.startsWith("priority:")) || "priority:p2";
          const areaLabel = labelNames.find((n) => n.startsWith("area:"))?.slice(5) || "general";
          const isTracker = labelNames.includes("tracker");
          const closed = iss.state === "closed";
          const status = closed ? "shipped" : (isTracker ? "proposed" : "proposed");

          if (!existing) {
            // New: insert with minimal body. Use issue body as agent_briefing fallback.
            storage.createDraftTask({
              run_id: 0,
              created_at: iss.created_at,
              status: status as any,
              title: iss.title,
              description: (iss.body || "").slice(0, 1000),
              project_slug: cfg.default_cc_project_slug,
              repo_url: `https://github.com/${repo}`,
              priority: priorityLabel.replace("priority:", ""),
              task_type: "dev_task",
              automatable: true,
              executor: "unassigned",
              relevant_skills_json: "[]",
              effort_estimate: "unknown",
              agent_briefing: iss.body || "",
              batch_id: isTracker ? `gh-master-${repo}-${iss.number}` : `gh-import-${repo}`,
              area: areaLabel,
              gh_issue_number: iss.number,
              gh_repo: repo,
              gh_issue_url: iss.html_url,
              gh_synced_at: new Date().toISOString(),
            } as any);
            added++;
          } else {
            // Existing: refresh status + merge-state if it changed
            const patches: any = { gh_synced_at: new Date().toISOString() };
            if (closed && existing.status !== "shipped") {
              patches.status = "shipped";
              updated++;
            }
            // Pull issue body in case the Explorer updated it (e.g. progress checkbox tick)
            if ((iss.body || "") && existing.agent_briefing !== iss.body) {
              patches.agent_briefing = iss.body;
              patches.description = (iss.body || "").slice(0, 1000);
            }
            if (Object.keys(patches).length > 1) {
              storage.updateDraftTask(existing.id, patches);
            }
          }
        }
      } catch (err: any) {
        errors.push(`${repo}: ${err?.message ?? err}`);
      }
    }

    res.json({ ok: true, repos, added, updated, errors });
  });

  // ============ Stats ============
  app.get("/api/explorer/stats", (_req, res) => res.json(storage.stats()));
  app.get("/api/explorer/stats/v2", (_req, res) => res.json(storage.explorerStats()));

  // Get prompt for a run (useful for manual subagent dispatch / debugging)
  app.get("/api/explorer/runs/:id/prompt", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    res.type("text/plain").send(await buildExplorerPrompt(id));
  });

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
