import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import type { DraftTask } from "@shared/schema";
import { createSoloIssueForTask, createBatchedFleetTracker, groupDrafts, composeMergedTask } from "../github-sync";
import { filterAllowedRepos } from "@shared/allowed-repos";

export function registerDraftTasksRoutes(app: Express) {
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
    // DNA-9: only reconcile from allow-listed planning repos.
    const repos = filterAllowedRepos([cfg.default_gh_repo, cfg.frontend_gh_repo, cfg.hub_gh_repo]);
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
}
