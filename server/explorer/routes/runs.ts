import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { buildDispatchPayload } from "../prompt";
import type { DraftTask } from "@shared/schema";
import { createSoloIssueForTask, createBatchedFleetTracker, groupDrafts, composeMergedTask, inferArea, pickRepoForTask } from "../github-sync";
import { FOCUS_AREA_IDS } from "@shared/dna-focus-areas";

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
    // DNA roadmap focus_area — optional in Zod so older Explorer dispatches don't
    // 400, but enforced at the prompt level. Findings without it surface as
    // (uncategorized) in the UI.
    focus_area: z
      .string()
      .refine((v) => (FOCUS_AREA_IDS as readonly string[]).includes(v), {
        message: `focus_area must be one of: ${FOCUS_AREA_IDS.join(", ")}`,
      })
      .optional()
      .nullable(),
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

export function registerRunsRoutes(app: Express) {
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
        focus_area: f.focus_area ?? null,
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
}
