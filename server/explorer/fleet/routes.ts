// Fleet dispatch route registration (split from fleet-routes.ts).

import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { isDirectExecutor, spawnDirectAgent, pollDirectRun, reapDeadDirectRuns, DIRECT_TARGETS, type DirectExecutor } from "../direct-dispatch";
import { dispatchWithCascade } from "../cascade-dispatch";
import { buildExecutorBriefing, buildEpicExecutorBriefing, buildCodebaseAuditBriefing, buildAdHocBriefing } from "./briefings";
import { ccDispatch, fetchGhContext } from "./dispatch-helpers";

// ============ Routes ============

export function registerFleetRoutes(app: Express) {
  const prodHost = process.env.NODE_ENV === "production" ? "https://momentiq-dna-hub.pplx.app/port/5000" : "http://localhost:5000";
  const hubBase = process.env.NODE_ENV === "production" ? "https://momentiq-dna-hub.pplx.app/port/5000" : "http://localhost:5000";

  // List fleet runs (executor + ad-hoc)
  app.get("/api/fleet/runs", (req, res) => {
    const kind = (req.query.kind as string) || undefined;
    const status = (req.query.status as string) || undefined;
    res.json(storage.listFleetRuns({ kind, status, limit: 80 }));
  });

  // Get one fleet run
  app.get("/api/fleet/runs/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const run = storage.getFleetRun(id);
    if (!run) return void res.status(404).json({ error: "not found" });
    res.json(run);
  });

  // PATCH a fleet run (lanes call this to report progress)
  app.patch("/api/fleet/runs/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const updates = z.object({
      status: z.enum(["queued", "running", "planning", "completed", "failed", "cancelled"]).optional(),
      summary: z.string().optional(),
      error: z.string().optional().nullable(),
      cc_task_status: z.string().optional().nullable(),
      gh_pr_url: z.string().optional().nullable(),
      gh_pr_state: z.string().optional().nullable(),
      gh_issue_numbers_json: z.string().optional(),
      plan_markdown: z.string().optional().nullable(),
      next_pickup: z.string().optional().nullable(),
      finished_at: z.string().optional().nullable(),
    }).parse(req.body);
    const final: any = { ...updates };
    // Snapshot old state before mutating
    const prevRun = storage.getFleetRun(id);
    if (final.status === "completed" || final.status === "failed" || final.status === "cancelled") {
      final.finished_at = final.finished_at || new Date().toISOString();
      if (prevRun) final.duration_ms = new Date(final.finished_at).getTime() - new Date(prevRun.started_at).getTime();
    }
    const u = storage.updateFleetRun(id, final);
    if (!u) return void res.status(404).json({ error: "not found" });

    // Fire-and-forget PR-outcome attribution
    const prodHost = process.env.PROD_HOST || "http://localhost:5000";
    const newPrState = final.gh_pr_state;
    const prevPrState = prevRun?.gh_pr_state;
    if (newPrState === "merged" && prevPrState !== "merged") {
      // Merged — positive heat bump
      fetch(`${prodHost}/api/feedback/pr-merged`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: id,
          ci_cycles: 0,
          reviewer_comments: 0,
          outcome: "merged",
        }),
      }).catch(() => { /* fire-and-forget */ });
    } else if (
      (final.status === "failed" || newPrState === "closed") &&
      prevRun?.status !== "failed" &&
      prevRun?.status !== "cancelled"
    ) {
      // Count amend cycles from the error field or a heuristic; trigger penalty after 3+
      const ciCycles = (final.ci_cycles as number) ?? 0;
      if (ciCycles >= 3) {
        fetch(`${prodHost}/api/feedback/pr-merged`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            run_id: id,
            ci_cycles: ciCycles,
            reviewer_comments: 0,
            outcome: "failed",
          }),
        }).catch(() => { /* fire-and-forget */ });
      }
    }

    res.json(u);
  });

  // Cancel a fleet run
  app.post("/api/fleet/runs/:id/cancel", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const run = storage.getFleetRun(id);
    if (!run) return void res.status(404).json({ error: "not found" });
    if (run.status === "completed" || run.status === "failed") return void res.status(409).json({ error: `already ${run.status}` });
    const u = storage.updateFleetRun(id, { status: "cancelled", finished_at: new Date().toISOString() });
    res.json(u);
  });

  // ==================== REPLAY ====================
  // Re-dispatch a failed or cancelled fleet run with the same agent_briefing + kind + executor.
  // Creates a new fleet_runs row linked to the original via parent_run_id.
  app.post("/api/fleet/runs/:id/replay", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return void res.status(400).json({ error: "invalid id" });
    const original = storage.getFleetRun(id);
    if (!original) return void res.status(404).json({ error: "not found" });
    if (original.status !== "failed" && original.status !== "cancelled") {
      return void res.status(409).json({ error: `cannot replay a run with status '${original.status}' — only failed or cancelled runs can be replayed` });
    }

    const cfg = storage.getCronConfig() as any;
    const executor = original.executor || "pin-codex";
    const direct = isDirectExecutor(executor as DirectExecutor);
    const directTgt = direct ? DIRECT_TARGETS[executor as DirectExecutor] : null;

    // 1. Create new run row, copying key fields from original and linking parent_run_id.
    const newRun = storage.createFleetRun({
      kind: original.kind,
      started_at: new Date().toISOString(),
      status: "queued",
      trigger: "replay",
      executor,
      fallback_executor: original.fallback_executor,
      model: directTgt?.model ?? original.model,
      priority: original.priority,
      repo_url: original.repo_url,
      gh_issue_numbers_json: original.gh_issue_numbers_json,
      user_prompt: original.user_prompt,
      agent_briefing: original.agent_briefing,
      parent_run_id: original.id,
    } as any);

    // 2. Dispatch — direct path or CC queue path, matching the original run's executor.
    if (direct) {
      const spawn = await spawnDirectAgent({
        cc_api_url: cfg.cc_api_url,
        cc_api_key: cfg.cc_api_key,
        executor: executor as DirectExecutor,
        run_id: newRun.id,
        agent_briefing: original.agent_briefing,
        hub_status_url: hubBase,
        repo_url: original.repo_url,
      });
      if (!spawn.ok) {
        storage.updateFleetRun(newRun.id, { status: "failed", error: spawn.error ?? "spawn failed", finished_at: new Date().toISOString() });
        return void res.status(502).json({ error: "direct spawn failed", detail: spawn.error });
      }
      storage.updateFleetRun(newRun.id, {
        status: "running",
        direct_marker: spawn.pid ? `agentId=${spawn.agentId};pid=${spawn.pid};workdir=${spawn.workdir}` : null,
      } as any);
      return void res.json({ ok: true, run: newRun, executor, direct: true, parent_run_id: original.id });
    }

    // CC queue path (executor_cron or ad_hoc non-direct)
    const replayTitle = original.kind === "ad_hoc"
      ? `[AH-REPLAY-R${newRun.id}] (replay of #${original.id}) ${(original.user_prompt ?? original.agent_briefing).split("\n")[0].slice(0, 70)}`
      : `[AH-REPLAY-R${newRun.id}] Executor replay (orig #${original.id})`;

    const dispatch = await ccDispatch({
      cc_api_url: cfg.cc_api_url,
      cc_api_key: cfg.cc_api_key,
      title: replayTitle,
      description: `Replay of fleet run #${original.id} (${original.kind}, ${original.status}). Same briefing re-dispatched.`,
      projectSlug: cfg.default_cc_project_slug || "momentiq-dna",
      repoUrl: original.repo_url,
      priority: original.priority,
      executor,
      agentBriefing: original.agent_briefing,
      relevantSkills: ["codex-fleet", "mcc-roadmap-specialist-dna"],
      taskType: "dev_task",
    });

    if (!dispatch.ok) {
      storage.updateFleetRun(newRun.id, { status: "failed", error: dispatch.error, finished_at: new Date().toISOString() });
      return void res.status(502).json({ error: "CC dispatch failed", detail: dispatch.error });
    }

    storage.updateFleetRun(newRun.id, { status: "running", cc_task_id: dispatch.cc_task_id ?? null });
    res.json({ ok: true, run: newRun, cc_task_id: dispatch.cc_task_id, executor, parent_run_id: original.id });
  });

  // ==================== EXECUTOR CRON DISPATCH ====================
  // Called by the executor cron each fire. Creates a fleet run + dispatches to fleet.
  app.post("/api/executor/dispatch", async (req, res) => {
    const cfg = storage.getCronConfig();
    const trigger = (req.body?.trigger as string) || "executor_cron";
    const executor = (req.body?.executor as string) || "pin-codex";
    const fallback = (req.body?.fallback_executor as string) || "pin-claude";
    const priority = (req.body?.priority as string) || "p1";
    const projectSlug = (req.body?.project_slug as string) || "momentiq-dna";
    // Default repo: backend (most issues land there)
    const repoUrl = (req.body?.repo_url as string) || `https://github.com/${cfg.default_gh_repo}`;

    // 1. Create the run row
    const run = storage.createFleetRun({
      kind: "executor_cron",
      started_at: new Date().toISOString(),
      status: "queued",
      trigger,
      executor,
      fallback_executor: fallback,
      model: executor === "pin-codex" ? "gpt_5_5" : "claude_opus_4_7",
      priority,
      repo_url: repoUrl,
      gh_issue_numbers_json: "[]",
      agent_briefing: "",
    });

    // 2. Build the briefing — inject compounding-learning context (prior 25 executor runs + Hub ledger + pickup directive)
    storage.compactStaleFleetSummaries("executor_cron", 25);
    const priorExecRuns = storage.listFleetRuns({ kind: "executor_cron", limit: 40 })
      .filter((r) => r.id !== run.id && (r.status === "completed" || r.status === "failed" || r.summary))
      .slice(0, 25)
      .map((r) => ({
        id: r.id,
        started_at: r.started_at,
        summary: r.summary || "",
        plan_markdown: (r as any).plan_markdown,
        next_pickup: (r as any).next_pickup,
        gh_pr_url: r.gh_pr_url,
        status: r.status,
      }));
    // Latest completed executor run with a real next_pickup is the explicit handoff
    const latestPickup = priorExecRuns.find((r) => r.next_pickup && !r.next_pickup.startsWith("[compacted]"))?.next_pickup ?? null;
    const ledgerForExec = storage.listLedger(20).map((l) => ({
      pattern: l.pattern,
      heat: l.heat,
      seen_count: l.seen_count,
    }));

    const epicMode = Boolean((cfg as any).epic_mode);
    const repos = [cfg.default_gh_repo, cfg.frontend_gh_repo, (cfg as any).hub_gh_repo].filter(Boolean);
    const baseOpts = {
      run_id: run.id,
      repos,
      hub_status_url: hubBase,
      ingest_url: `${prodHost}/api/fleet/runs/${run.id}`,
      cc_api_url: cfg.cc_api_url,
      cc_api_key: cfg.cc_api_key,
      prior_summaries: priorExecRuns,
      ledger: ledgerForExec,
      latest_next_pickup: latestPickup,
    };
    const briefing = epicMode
      ? buildEpicExecutorBriefing(baseOpts)
      : buildExecutorBriefing({ ...baseOpts, open_issue_count: undefined });
    storage.updateFleetRun(run.id, { agent_briefing: briefing });

    // 3. Dispatch via 4-way cascade (mini-4 primary, mini-5 fallback; codex primary provider).
    // Cron-triggered executor runs go through direct SSH, not CC queue.
    const preferredProvider = executor === "pin-claude" ? "claude" as const : "codex" as const;
    const dispatch = await dispatchWithCascade({
      kind: "executor",
      runId: run.id,
      briefing,
      preferredProvider,
      preferredMini: "mini-4",
      hubStatusUrl: `${prodHost}/api/fleet/runs/${run.id}`,
      ccApiUrl: cfg.cc_api_url,
      ccApiKey: cfg.cc_api_key,
    });

    if (!dispatch.ok) {
      storage.updateFleetRun(run.id, { status: "failed", error: dispatch.error, finished_at: new Date().toISOString() });
      return void res.status(502).json({ error: "cascade dispatch failed", detail: dispatch.error, attempts: dispatch.attempts });
    }

    storage.updateFleetRun(run.id, {
      status: "running",
      ...(dispatch.directMarker ? { direct_marker: dispatch.directMarker } : {}),
    } as any);
    res.json({
      ok: true,
      run_id: run.id,
      pid: dispatch.pid,
      final_target: dispatch.finalTarget,
      cascade_index: dispatch.cascadeIndex,
      model_pin: dispatch.model ?? "gpt_5_5",
      attempts: dispatch.attempts,
      direct_marker: dispatch.directMarker,
    });
  });

  // ==================== EPIC EXECUTOR DISPATCH ====================
  app.post("/api/executor/dispatch-epic", async (req, res) => {
    const cfg = storage.getCronConfig();
    const trigger = (req.body?.trigger as string) || "executor_cron";
    const executor = (req.body?.executor as string) || "pin-codex";
    const fallback = (req.body?.fallback_executor as string) || "pin-claude";
    const priority = (req.body?.priority as string) || "p1";
    const repoUrl = (req.body?.repo_url as string) || `https://github.com/${cfg.default_gh_repo}`;

    const run = storage.createFleetRun({
      kind: "executor_cron",
      started_at: new Date().toISOString(),
      status: "queued",
      trigger,
      executor,
      fallback_executor: fallback,
      model: executor === "pin-codex" ? "gpt_5_5" : "claude_opus_4_7",
      priority,
      repo_url: repoUrl,
      gh_issue_numbers_json: "[]",
      agent_briefing: "",
    });

    storage.compactStaleFleetSummaries("executor_cron", 25);
    const priorExecRuns = storage.listFleetRuns({ kind: "executor_cron", limit: 20 })
      .filter((r) => r.id !== run.id && (r.status === "completed" || r.status === "failed" || r.summary))
      .slice(0, 10)
      .map((r) => ({ id: r.id, started_at: r.started_at, summary: r.summary || "", next_pickup: (r as any).next_pickup, gh_pr_url: r.gh_pr_url, status: r.status }));
    const latestPickup = priorExecRuns.find((r) => r.next_pickup && !r.next_pickup.startsWith("[compacted]"))?.next_pickup ?? null;
    const ledgerForExec = storage.listLedger(20).map((l) => ({ pattern: l.pattern, heat: l.heat, seen_count: l.seen_count }));

    const briefing = buildEpicExecutorBriefing({
      run_id: run.id,
      repos: [cfg.default_gh_repo, cfg.frontend_gh_repo, (cfg as any).hub_gh_repo].filter(Boolean),
      hub_status_url: hubBase,
      ingest_url: `${prodHost}/api/fleet/runs/${run.id}`,
      cc_api_url: cfg.cc_api_url,
      cc_api_key: cfg.cc_api_key,
      prior_summaries: priorExecRuns,
      ledger: ledgerForExec,
      latest_next_pickup: latestPickup,
    });
    storage.updateFleetRun(run.id, { agent_briefing: briefing });

    const preferredProvider = executor === "pin-claude" ? "claude" as const : "codex" as const;
    const dispatch = await dispatchWithCascade({
      kind: "executor",
      runId: run.id,
      briefing,
      preferredProvider,
      preferredMini: "mini-4",
      hubStatusUrl: `${prodHost}/api/fleet/runs/${run.id}`,
      ccApiUrl: cfg.cc_api_url,
      ccApiKey: cfg.cc_api_key,
    });

    if (!dispatch.ok) {
      storage.updateFleetRun(run.id, { status: "failed", error: dispatch.error, finished_at: new Date().toISOString() });
      return void res.status(502).json({ error: "cascade dispatch failed", detail: dispatch.error, attempts: dispatch.attempts });
    }

    storage.updateFleetRun(run.id, {
      status: "running",
      ...(dispatch.directMarker ? { direct_marker: dispatch.directMarker } : {}),
    } as any);
    res.json({ ok: true, run_id: run.id, mode: "epic", pid: dispatch.pid, final_target: dispatch.finalTarget, cascade_index: dispatch.cascadeIndex });
  });

  // Executor fallback: re-dispatch SAME run to claude lane
  app.post("/api/executor/dispatch/fallback", async (req, res) => {
    const runId = parseInt((req.query.run_id as string) || (req.body?.run_id as string) || "0", 10);
    if (!runId) return void res.status(400).json({ error: "run_id required" });
    const run = storage.getFleetRun(runId);
    if (!run) return void res.status(404).json({ error: "not found" });
    if (run.status === "completed") return void res.status(409).json({ error: "already completed" });

    const cfg = storage.getCronConfig();
    const fallbackExecutor = (req.body?.executor as string) || run.fallback_executor || "pin-claude";

    const dispatch = await ccDispatch({
      cc_api_url: cfg.cc_api_url,
      cc_api_key: cfg.cc_api_key,
      title: `[AH-EXEC-R${runId}-FB] Fallback executor: ${fallbackExecutor}`,
      description: `FALLBACK for executor run #${runId}. Primary lane stalled. Re-dispatching to ${fallbackExecutor} (${fallbackExecutor === "pin-claude" ? "claude_opus_4_7 thinking" : "gpt_5_5"}).`,
      projectSlug: "momentiq-dna",
      repoUrl: run.repo_url,
      priority: "p0",
      executor: fallbackExecutor,
      agentBriefing: `## Goal\nFALLBACK dispatch for Autonomy Hub executor run #${runId}. Primary lane (gpt_5_5) did not complete in time.\n\n${run.agent_briefing}`,
      relevantSkills: ["codex-fleet", "mcc-roadmap-specialist-dna"],
      taskType: "dev_task",
    });

    if (!dispatch.ok) return void res.status(502).json({ error: "CC fallback dispatch failed", detail: dispatch.error });
    storage.updateFleetRun(runId, { error: `cc_task_fb:${dispatch.cc_task_id ?? "?"} (was ${run.error ?? "-"})` });
    res.json({ ok: true, run_id: runId, fallback_cc_task_id: dispatch.cc_task_id, executor: fallbackExecutor });
  });

  // ==================== AD-HOC RUN DISPATCH (immediate, p0, concurrent) ====================
  // Two paths:
  //  - executor in {pin-codex, pin-claude, unassigned}  → CC queue (FIFO).
  //  - executor in {pin-codex-direct, pin-claude-direct} → SSH-via-CC into mini-5,
  //    spawn agent inline. Concurrent to whatever CC is doing.
  app.post("/api/run/dispatch", async (req, res) => {
    const body = z.object({
      user_prompt: z.string().min(3).max(8000),
      repo: z.enum(["backend", "frontend", "hub"]).default("backend"),
      executor: z.enum(["pin-codex", "pin-claude", "unassigned", "pin-codex-direct", "pin-claude-direct"]).default("pin-codex"),
      priority: z.enum(["p0", "p1", "p2", "p3"]).default("p0"),
    }).parse(req.body);

    const cfg = storage.getCronConfig() as any;
    const repoName = body.repo === "frontend"
      ? cfg.frontend_gh_repo
      : body.repo === "hub"
      ? (cfg as any).hub_gh_repo
      : cfg.default_gh_repo;
    const repoUrl = `https://github.com/${repoName}`;
    const direct = isDirectExecutor(body.executor);
    const directTgt = direct ? DIRECT_TARGETS[body.executor as DirectExecutor] : null;

    // 1. Create the run row
    const run = storage.createFleetRun({
      kind: "ad_hoc",
      started_at: new Date().toISOString(),
      status: "queued",
      trigger: direct ? "user_run_button_direct" : "user_run_button",
      executor: body.executor,
      fallback_executor: body.executor === "pin-codex" ? "pin-claude" : body.executor === "pin-codex-direct" ? "pin-claude-direct" : null,
      model: directTgt?.model ?? (body.executor === "pin-codex" ? "gpt_5_5" : body.executor === "pin-claude" ? "claude_opus_4_7" : "unassigned"),
      priority: body.priority,
      repo_url: repoUrl,
      gh_issue_numbers_json: "[]",
      user_prompt: body.user_prompt,
      agent_briefing: "",
    });

    // 2. Pull GH context (recent PRs + open issues) for richer briefing
    const ghToken = cfg.github_token || process.env.GITHUB_TOKEN || null;
    const ghCtx = await fetchGhContext(repoName, ghToken);

    const briefing = buildAdHocBriefing({
      run_id: run.id,
      user_prompt: body.user_prompt,
      repo_url: repoUrl,
      hub_status_url: hubBase,
      recent_prs: ghCtx.recent_prs,
      open_issues: ghCtx.open_issues,
      loaded_skills: ["codex-fleet", "mcc-roadmap-specialist-dna"],
    });
    storage.updateFleetRun(run.id, { agent_briefing: briefing });

    // ---------- DIRECT PATH ----------
    if (direct) {
      const spawn = await spawnDirectAgent({
        cc_api_url: cfg.cc_api_url,
        cc_api_key: cfg.cc_api_key,
        executor: body.executor as DirectExecutor,
        run_id: run.id,
        agent_briefing: briefing,
        hub_status_url: hubBase,
        repo_url: repoUrl,
      });
      if (!spawn.ok) {
        storage.updateFleetRun(run.id, { status: "failed", error: spawn.error ?? "spawn failed", finished_at: new Date().toISOString() });
        return void res.status(502).json({ error: "direct spawn failed", detail: spawn.error });
      }
      // Store direct-dispatch marker in its own column (not in error)
      storage.updateFleetRun(run.id, {
        status: "running",
        direct_marker: spawn.pid ? `agentId=${spawn.agentId};pid=${spawn.pid};workdir=${spawn.workdir}` : null,
      } as any);
      return void res.json({
        ok: true,
        run,
        executor: body.executor,
        model_pin: spawn.model,
        direct: true,
        agentId: spawn.agentId,
        agent: spawn.agent,
        pid: spawn.pid,
        workdir: spawn.workdir,
      });
    }

    // ---------- CC QUEUE PATH ----------
    const dispatch = await ccDispatch({
      cc_api_url: cfg.cc_api_url,
      cc_api_key: cfg.cc_api_key,
      title: `[AH-ADHOC-R${run.id}] ${body.user_prompt.split("\n")[0].slice(0, 80)}`,
      description: `Ad-hoc fleet run dispatched from Autonomy Hub. User prompt: ${body.user_prompt.slice(0, 200)}`,
      projectSlug: "momentiq-dna",
      repoUrl,
      priority: body.priority,
      executor: body.executor,
      agentBriefing: briefing,
      relevantSkills: ["codex-fleet", "mcc-roadmap-specialist-dna"],
      taskType: "dev_task",
    });

    if (!dispatch.ok) {
      storage.updateFleetRun(run.id, { status: "failed", error: dispatch.error, finished_at: new Date().toISOString() });
      return void res.status(502).json({ error: "CC dispatch failed", detail: dispatch.error });
    }

    storage.updateFleetRun(run.id, { status: "running", cc_task_id: dispatch.cc_task_id ?? null });
    res.json({
      ok: true,
      run,
      cc_task_id: dispatch.cc_task_id,
      executor: body.executor,
      model_pin: body.executor === "pin-codex" ? "gpt_5_5" : body.executor === "pin-claude" ? "claude_opus_4_7 (thinking)" : "unassigned",
    });
  });

  // ==================== DIRECT RUN POLL ====================
  // Live tail of stdout/stderr for a direct run. The /run + /fleet UIs poll this
  // every few seconds while a direct run is in 'running' state.
  app.get("/api/fleet/runs/:id/poll", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const run = storage.getFleetRun(id);
    if (!run) return void res.status(404).json({ error: "not found" });
    if (!isDirectExecutor(run.executor)) {
      return void res.json({ ok: true, direct: false, message: "not a direct run; nothing to poll" });
    }
    // Read marker from direct_marker column (preferred) or fall back to legacy error-field marker
    const markerStr = (run as any).direct_marker || (run.error?.startsWith("direct:") ? run.error.replace(/^direct:/, "") : "");
    const marker = markerStr.match(/^agentId=([^;]+);pid=(\d+);workdir=(.+)$/);
    if (!marker) return void res.json({ ok: true, direct: true, message: "no marker; spawn may have failed" });
    const [, agentId, pidStr, workdir] = marker;
    const cfg = storage.getCronConfig();
    const polled = await pollDirectRun({
      cc_api_url: cfg.cc_api_url,
      cc_api_key: cfg.cc_api_key,
      agentId,
      workdir,
      pid: parseInt(pidStr, 10),
    });

    // Auto-mark completed/failed when the agent has exited (don't make the user click reap).
    // Trust the EXIT CODE only — codex emits ERROR-level logs (rate-limit telemetry,
    // refresh attempts) even on successful runs, so stderr-keyword sniffing is unreliable.
    if (polled.ok && polled.exited && (run.status === "running" || run.status === "queued")) {
      const exitCode = polled.exit_signal?.trim();
      const finalStatus = exitCode === "0" ? "completed" : "failed";
      const summaryFromStdout = polled.stdout_tail.trim().split("\n").slice(-3).join(" │ ").slice(0, 500);
      storage.updateFleetRun(id, {
        status: finalStatus,
        finished_at: new Date().toISOString(),
        summary: summaryFromStdout || (finalStatus === "completed" ? "(empty stdout but exit 0)" : ""),
        error: finalStatus === "failed" ? polled.stderr_tail.slice(-500) : null,
      } as any);
    }
    res.json({ direct: true, run_id: id, agentId, workdir, ...polled });
  });

  // ==================== AUDIT CRON DISPATCH ====================
  // Creates a fleet_runs row with kind='audit_cron' and dispatches the Codebase Audit Agent.
  // Can be triggered manually (POST /api/audit/dispatch) or by the auto-resumer every N hours.
  app.post("/api/audit/dispatch", async (req, res) => {
    const cfg = storage.getCronConfig() as any;
    const trigger = (req.body?.trigger as string) || "audit_cron";
    const executor = (req.body?.executor as string) || "pin-codex";
    const fallback = (req.body?.fallback_executor as string) || "pin-claude";
    const priority = (req.body?.priority as string) || "p1";
    const repoUrl = (req.body?.repo_url as string) || `https://github.com/${cfg.default_gh_repo}`;

    // 1. Create the run row (kind='audit_cron')
    const run = storage.createFleetRun({
      kind: "audit_cron",
      started_at: new Date().toISOString(),
      status: "queued",
      trigger,
      executor,
      fallback_executor: fallback,
      model: executor === "pin-claude" ? "claude_opus_4_7" : "gpt_5_5",
      priority,
      repo_url: repoUrl,
      gh_issue_numbers_json: "[]" ,
      agent_briefing: "",
    });

    // 2. Build audit briefing — inject current ledger for dedup context
    const ledgerForAudit = storage.listLedger(20).map((l) => ({
      pattern: l.pattern,
      heat: l.heat,
      seen_count: l.seen_count,
    }));

    const auditRepos = [
      cfg.default_gh_repo,
      cfg.frontend_gh_repo,
      cfg.hub_gh_repo,
    ].filter(Boolean) as string[];

    // The audit agent PUTs results into an explorer run so we need one to ingest into
    const explorerRun = storage.createRun({
      started_at: new Date().toISOString(),
      status: "running",
      trigger: "audit_cron",
      model: cfg.model || "claude_opus_4_7",
    });

    const briefing = buildCodebaseAuditBriefing({
      run_id: explorerRun.id,
      repos: auditRepos,
      hub_status_url: hubBase,
      ledger: ledgerForAudit,
    });
    storage.updateFleetRun(run.id, { agent_briefing: briefing });
    storage.updateRun(explorerRun.id, { summary: `Audit fleet run #${run.id}` } as any);

    // 3. Dispatch via 4-way cascade
    const preferredProvider = executor === "pin-claude" ? "claude" as const : "codex" as const;
    const dispatch = await dispatchWithCascade({
      kind: "executor",
      runId: run.id,
      briefing,
      preferredProvider,
      preferredMini: "mini-4",
      hubStatusUrl: `${prodHost}/api/fleet/runs/${run.id}`,
      ccApiUrl: cfg.cc_api_url,
      ccApiKey: cfg.cc_api_key,
    });

    if (!dispatch.ok) {
      storage.updateFleetRun(run.id, { status: "failed", error: dispatch.error, finished_at: new Date().toISOString() });
      return void res.status(502).json({ error: "cascade dispatch failed", detail: dispatch.error, attempts: dispatch.attempts });
    }

    storage.updateFleetRun(run.id, {
      status: "running",
      ...(dispatch.directMarker ? { direct_marker: dispatch.directMarker } : {}),
    } as any);
    res.json({
      ok: true,
      run_id: run.id,
      explorer_run_id: explorerRun.id,
      pid: dispatch.pid,
      final_target: dispatch.finalTarget,
      cascade_index: dispatch.cascadeIndex,
      model_pin: dispatch.model ?? "gpt_5_5",
      attempts: dispatch.attempts,
      direct_marker: dispatch.directMarker,
    });
  });

  // ==================== REAPER ENDPOINT ====================
  // Marks dead direct runs as failed/completed. Called manually or by an external
  // monitor (we'll expose a button on /fleet for this).
  app.post("/api/fleet/reap-dead-direct-runs", async (_req, res) => {
    const cfg = storage.getCronConfig();
    const out = await reapDeadDirectRuns({ cc_api_url: cfg.cc_api_url, cc_api_key: cfg.cc_api_key });
    res.json(out);
  });
}
