// Consolidation Cron Lane (Lane 5)
// Fires every N hours (default 1h), builds a consolidation briefing, and POSTs it
// to the CC /api/tasks endpoint. Round-robins across mini-1..mini-5 as the executor.
// No local execution — the fleet picks up the CC task.

import { storage } from "../storage";

const CC_API = process.env.CC_API_URL || "https://command-center-api-production-96e2.up.railway.app";
const CC_KEY = process.env.AGENT_API_KEY || process.env.CC_API_KEY || "miq-cmd-center-2026";
const MINIS = ["mini-1", "mini-2", "mini-3", "mini-4", "mini-5"];

export async function dispatchConsolidationToCC(): Promise<{ ok: boolean; task_id?: number; error?: string }> {
  const cfg = storage.getCronConfig() as any;
  const gist: string =
    cfg.consolidation_briefing_gist ||
    "https://gist.githubusercontent.com/Alexelsea/5fd8d54e9abed9b47aebf44fd09137b5/raw/db802ac8eb8ae4fe9f5c09f6c727eb970f00bd0d/briefing.md";
  const intervalHours: number = cfg.consolidation_cron_interval_hours ?? 1;

  const executor = pickMini(cfg);
  const now = new Date().toISOString();

  const briefing = `## Goal
Fetch the full consolidation briefing from ${gist} and execute end-to-end. Consolidate all from-explorer-* labeled issues on bemomentiq/momentiq-dna into a clean 6-phase Epic->Task hierarchy with EV scores. Dedupe + merge duplicates.

## Context
Continual consolidation lane. Fired by momentiq-dna-hub consolidation_cron every ${intervalHours}h. Hub run record N/A (CC-routed).

## Files
- /tmp/briefing.md after curl fetch
- /tmp/dna-final-hierarchy.md (deliverable)
- GitHub issues on bemomentiq/momentiq-dna

## Implementation
1. curl -sS -o /tmp/briefing.md '${gist}'
2. cat /tmp/briefing.md
3. Execute every phase 0-5 of the briefing.

## Acceptance
- 6 phase trackers exist with proper child-epic checkboxes
- Every from-explorer-* issue is parented (kept / merged / absorbed)
- /tmp/dna-final-hierarchy.md rendered cleanly with stats

## Out-of-scope
- No code changes
- Don't touch repos other than bemomentiq/momentiq-dna

## Commit + PR
- No PR (backlog organization run)

## Notes
- Idempotent — safe to run hourly
- Fired by momentiq-dna-hub at ${now}`;

  const payload = {
    projectSlug: "momentiq-dna",
    title: `[DNA-CONSOLIDATION-CRON] ${now.slice(0, 16)}Z auto-consolidation`,
    description: "Hourly auto-consolidation of from-explorer-* issues",
    agentBriefing: briefing,
    status: "planned",
    priority: "p2",
    executor,
    taskType: "dev_task",
    repoUrl: "https://github.com/bemomentiq/momentiq-dna",
    automatable: true,
    effortEstimate: "medium",
    laneAffinity: "claude",
  };

  try {
    const r = await fetch(`${CC_API}/api/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CC_KEY}`,
        "x-api-key": CC_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const text = await r.text();
      return { ok: false, error: `${r.status}: ${text.slice(0, 200)}` };
    }
    const j = (await r.json()) as any;
    const taskId: number | undefined = j?.id ?? j?.taskId ?? undefined;
    const nextIdx: number = ((cfg.consolidation_last_mini_idx ?? 0) + 1) % MINIS.length;
    storage.updateCronConfig({
      consolidation_last_run_at: now,
      consolidation_last_cc_task_id: taskId ?? null,
      consolidation_last_mini_idx: nextIdx,
    } as any);
    return { ok: true, task_id: taskId };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

function pickMini(cfg: any): string {
  const idx: number = ((cfg.consolidation_last_mini_idx ?? 0)) % MINIS.length;
  return MINIS[idx];
}
