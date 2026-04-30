// Consolidation cron lane — dispatches a DNA issue-consolidation task to CC /api/tasks.
// Fires every N hours (default 1h). Separate from Explorer/Executor caps.

import { storage } from "../storage";

const CC_API = process.env.CC_API_URL || "https://command-center-api-production-96e2.up.railway.app";
const CC_KEY = process.env.CC_API_KEY || "miq-cmd-center-2026";

const MINIS = ["mini-1", "mini-2", "mini-3", "mini-4", "mini-5"];

function pickHealthyMini(): string {
  const cfg = storage.getCronConfig();
  const idx = ((cfg.consolidation_last_mini_idx ?? 0) % MINIS.length);
  storage.updateCronConfig({ consolidation_last_mini_idx: idx + 1 });
  return MINIS[idx];
}

export async function dispatchConsolidationToCC(): Promise<{ ok: boolean; task_id?: number; error?: string }> {
  const cfg = storage.getCronConfig();
  const gist: string = cfg.consolidation_briefing_gist || "";
  if (!gist) return { ok: false, error: "no consolidation_briefing_gist configured" };

  const intervalHours: number = cfg.consolidation_cron_interval_hours;
  const executor = pickHealthyMini();

  const briefing = `## Goal
Fetch the full consolidation briefing from ${gist} and execute end-to-end. Consolidate all from-explorer-* labeled issues on bemomentiq/momentiq-dna into a clean 6-phase Epic->Task hierarchy with EV scores. Dedupe + merge duplicates.

## Context
Continual consolidation lane. Fired by momentiq-dna-hub's consolidation_cron every ${intervalHours}h. CC-routed to ${executor}.

## Files
- /tmp/briefing.md (after curl fetch)
- /tmp/dna-final-hierarchy.md (deliverable)
- GitHub issues on bemomentiq/momentiq-dna

## Implementation
1. curl -sS -o /tmp/briefing.md '${gist}'
2. cat /tmp/briefing.md
3. Execute every phase 0-5 of the briefing.

## Acceptance
- 6 phase trackers exist with proper child-epic checkboxes
- Every from-explorer-* issue is parented (kept / merged / absorbed)
- Every epic has phase-N + ev:<score> + effort:S/M/L labels
- /tmp/dna-final-hierarchy.md rendered cleanly with stats

## Out-of-scope
- No code changes
- Don't touch repos other than bemomentiq/momentiq-dna

## Commit + PR
- No PR (backlog organization run)

## Notes
- Idempotent — safe to run hourly; skip work that's already done
- Fired by momentiq-dna-hub at ${new Date().toISOString()}`;

  const payload = {
    projectSlug: "momentiq-dna",
    title: `[DNA-CONSOLIDATION-CRON] ${new Date().toISOString().slice(0, 16)}Z auto-consolidation`,
    description: "Hourly auto-consolidation of from-explorer-* issues",
    agentBriefing: briefing,
    status: "planned",
    priority: "p2",
    executor,
    taskType: "dev_task",
    repoUrl: "https://github.com/bemomentiq/momentiq-dna",
    automatable: true,
    effortEstimate: "medium",
    relevantSkills: ["auto-build"],
    laneAffinity: "claude",
  };

  try {
    const r = await fetch(`${CC_API}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": CC_KEY },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const text = (await r.text()).slice(0, 200);
      return { ok: false, error: `${r.status}: ${text}` };
    }
    const j = (await r.json()) as any;
    const taskId: number = j.id ?? j.task_id ?? j.taskId ?? null;
    storage.updateCronConfig({
      consolidation_last_run_at: new Date().toISOString(),
      consolidation_last_cc_task_id: taskId,
    });
    return { ok: true, task_id: taskId };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
