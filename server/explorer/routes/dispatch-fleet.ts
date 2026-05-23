import type { Express } from "express";
import { storage } from "../../storage";
import { buildExplorerPrompt } from "../prompt";
import { dispatchWithCascade } from "../cascade-dispatch";

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

export function registerDispatchFleetRoutes(app: Express) {
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
      description: `Autonomous codebase exploration cycle for the DNA Hub. Read-only investigation of the momentiq AI Content Platform (Veo 3.1, Thompson bandit, ScriptSage); surfaces findings + drafts back to DNA Hub run #${run.id} via PUT to ${ingestUrl}. Triggered ${trigger} at ${new Date().toISOString()}.`,
      projectSlug,
      repoUrl,
      priority,
      taskType: "investigation",
      automatable: true,
      relevantSkills: ["mcc-roadmap-specialist-dna", "codex-fleet"],
      effortEstimate: "30 min",
      executor,
      status: "planned",
      agentBriefing: fleetBriefing,
    };

    // 3. Dispatch to a GKE codex-lane via CC (project 14920).
    const preferredProvider = executor === "pin-claude" ? "claude" as const : "codex" as const;
    const dispatch = await dispatchWithCascade({
      kind: "explorer",
      runId: run.id,
      briefing: fleetBriefing,
      preferredProvider,
      repoUrl,
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
      relevantSkills: ["mcc-roadmap-specialist-dna", "codex-fleet"],
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
}
